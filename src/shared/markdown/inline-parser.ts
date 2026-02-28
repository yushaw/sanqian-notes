/**
 * Inline Markdown Parser
 *
 * Shared module for parsing inline markdown to Tiptap nodes.
 * Used by both main process (markdown-to-tiptap.ts) and renderer process (editorOutputHandler.ts).
 */

import { Marked, Token, Tokens } from 'marked'
import { parseAIPopupMarkerFromHtml } from '../ai-popup-marker'

// Isolated marked instance to avoid global state pollution
const marked = new Marked({ gfm: true, breaks: true })

// ============================================
// Type Definitions
// ============================================

export interface TiptapMark {
  type: string
  attrs?: Record<string, unknown>
}

export interface TiptapNode {
  type: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
  text?: string
  marks?: TiptapMark[]
}

function appendMarkIfCompatible(node: TiptapNode, mark: TiptapMark): void {
  if (node.type !== 'text') return

  const existingMarks = node.marks || []
  if (existingMarks.some((existing) => existing.type === mark.type)) {
    return
  }

  // TipTap/ProseMirror code mark excludes all other marks.
  if (mark.type === 'code') {
    node.marks = [mark]
    return
  }

  if (existingMarks.some((existing) => existing.type === 'code')) {
    return
  }

  node.marks = [...existingMarks, mark]
}

// ============================================
// Preprocessing (simplified for inline text)
// ============================================

/**
 * Preprocess inline text for custom syntax
 * Only handles inline-level custom syntax: highlight, underline, math
 */
function preprocessInlineText(text: string): string {
  let result = text

  // Highlight: ==text== (non-greedy to support content with = signs)
  result = result.replace(/==(.+?)==/g, '\x00HIGHLIGHT_START\x00$1\x00HIGHLIGHT_END\x00')

  // Underline: ++text++ (non-greedy to support content with + signs)
  result = result.replace(/\+\+(.+?)\+\+/g, '\x00UNDERLINE_START\x00$1\x00UNDERLINE_END\x00')

  // Protect inline math: $...$
  result = result.replace(/\$([^$\n]+)\$/g, '\x00INLINE_MATH:$1\x00')

  return result
}

// ============================================
// Core Parser (migrated from markdown-to-tiptap.ts)
// ============================================

/**
 * Parse marked inline tokens to Tiptap nodes
 * Supports: text, strong, em, del, codespan, link, image, br, escape
 * Custom syntax: ==highlight==, ++underline++
 */
export function parseInlineTokens(tokens: Token[]): TiptapNode[] {
  const nodes: TiptapNode[] = []
  let pendingLegacyAIPopupCloseSpan = false
  // Safety counter: if the closing </span> is never found within a reasonable
  // number of tokens, reset the flag to avoid swallowing unrelated text.
  let pendingCloseSpanTokenCount = 0
  const PENDING_CLOSE_SPAN_MAX_TOKENS = 5

  for (const token of tokens) {
    if (pendingLegacyAIPopupCloseSpan) {
      pendingCloseSpanTokenCount += 1
      if (pendingCloseSpanTokenCount > PENDING_CLOSE_SPAN_MAX_TOKENS) {
        pendingLegacyAIPopupCloseSpan = false
        pendingCloseSpanTokenCount = 0
      }
    }

    switch (token.type) {
      case 'text': {
        const textToken = token as Tokens.Text
        const text = textToken.text
        if (pendingLegacyAIPopupCloseSpan && text.trim() === '\u2728') {
          break
        }

        // Handle custom markers (highlight and underline)
        if (text.includes('\x00HIGHLIGHT_START\x00') || text.includes('\x00UNDERLINE_START\x00')) {
          let segments: { text: string; marks: TiptapMark[] }[] = [{ text, marks: [] }]

          // Process highlight markers
          segments = segments.flatMap((seg) => {
            if (!seg.text.includes('\x00HIGHLIGHT_START\x00')) return [seg]
            const parts = seg.text.split(/\x00HIGHLIGHT_START\x00|\x00HIGHLIGHT_END\x00/)
            const result: { text: string; marks: TiptapMark[] }[] = []
            for (let i = 0; i < parts.length; i++) {
              if (parts[i]) {
                result.push({
                  text: parts[i],
                  marks: i % 2 === 1 ? [...seg.marks, { type: 'highlight' }] : seg.marks,
                })
              }
            }
            return result
          })

          // Process underline markers
          segments = segments.flatMap((seg) => {
            if (!seg.text.includes('\x00UNDERLINE_START\x00')) return [seg]
            const parts = seg.text.split(/\x00UNDERLINE_START\x00|\x00UNDERLINE_END\x00/)
            const result: { text: string; marks: TiptapMark[] }[] = []
            for (let i = 0; i < parts.length; i++) {
              if (parts[i]) {
                result.push({
                  text: parts[i],
                  marks: i % 2 === 1 ? [...seg.marks, { type: 'underline' }] : seg.marks,
                })
              }
            }
            return result
          })

          for (const seg of segments) {
            nodes.push({
              type: 'text',
              text: seg.text,
              ...(seg.marks.length > 0 ? { marks: seg.marks } : {}),
            })
          }
        } else {
          nodes.push({ type: 'text', text })
        }
        break
      }

      case 'strong': {
        const strongToken = token as Tokens.Strong
        const children = parseInlineTokens(strongToken.tokens || [])
        for (const child of children) {
          appendMarkIfCompatible(child, { type: 'bold' })
          nodes.push(child)
        }
        break
      }

      case 'em': {
        const emToken = token as Tokens.Em
        const children = parseInlineTokens(emToken.tokens || [])
        for (const child of children) {
          appendMarkIfCompatible(child, { type: 'italic' })
          nodes.push(child)
        }
        break
      }

      case 'del': {
        const delToken = token as Tokens.Del
        const children = parseInlineTokens(delToken.tokens || [])
        for (const child of children) {
          appendMarkIfCompatible(child, { type: 'strike' })
          nodes.push(child)
        }
        break
      }

      case 'codespan': {
        const codeToken = token as Tokens.Codespan
        nodes.push({
          type: 'text',
          text: codeToken.text,
          marks: [{ type: 'code' }],
        })
        break
      }

      case 'link': {
        const linkToken = token as Tokens.Link
        const linkText = linkToken.tokens
          ? parseInlineTokens(linkToken.tokens)
          : [{ type: 'text', text: linkToken.text }]
        for (const child of linkText) {
          appendMarkIfCompatible(child as TiptapNode, {
            type: 'link',
            attrs: { href: linkToken.href },
          })
          nodes.push(child)
        }
        break
      }

      case 'image': {
        const imgToken = token as Tokens.Image
        nodes.push({
          type: 'image',
          attrs: {
            blockId: null,
            src: imgToken.href,
            alt: imgToken.text || '',
            title: imgToken.title || null,
            width: null,
            height: null,
            align: 'left',
          },
        })
        break
      }

      case 'html': {
        const htmlToken = token as Tokens.HTML
        const rawHtml = htmlToken.raw || htmlToken.text || ''
        const trimmedHtml = rawHtml.trim().toLowerCase()
        const marker = parseAIPopupMarkerFromHtml(rawHtml)
        if (marker) {
          if (
            trimmedHtml.startsWith('<span')
            && trimmedHtml.includes('data-ai-popup-mark')
            && !trimmedHtml.includes('</span>')
          ) {
            pendingLegacyAIPopupCloseSpan = true
            pendingCloseSpanTokenCount = 0
          } else {
            pendingLegacyAIPopupCloseSpan = false
            pendingCloseSpanTokenCount = 0
          }
          nodes.push({
            type: 'aiPopupMark',
            attrs: {
              popupId: marker.popupId,
              createdAt: marker.createdAt ?? null,
            },
          })
          break
        }
        if (pendingLegacyAIPopupCloseSpan && trimmedHtml === '</span>') {
          pendingLegacyAIPopupCloseSpan = false
          pendingCloseSpanTokenCount = 0
          break
        }
        if (rawHtml) {
          nodes.push({ type: 'text', text: rawHtml })
        }
        break
      }

      case 'br':
        nodes.push({ type: 'hardBreak' })
        break

      case 'escape': {
        const escapeToken = token as Tokens.Escape
        nodes.push({ type: 'text', text: escapeToken.text })
        break
      }

      default:
        // Try to extract raw text
        if ('raw' in token && typeof token.raw === 'string') {
          nodes.push({ type: 'text', text: token.raw })
        }
    }
  }

  return nodes
}

// ============================================
// Math Formula Post-processing
// ============================================

/**
 * Restore inline math formulas from placeholders
 */
function restoreInlineMath(nodes: TiptapNode[]): TiptapNode[] {
  const result: TiptapNode[] = []

  for (const node of nodes) {
    if (node.type === 'text' && node.text?.includes('\x00INLINE_MATH:')) {
      // Split text by math placeholders
      const parts = node.text.split(/(\x00INLINE_MATH:[^\x00]+\x00)/)

      for (const part of parts) {
        if (!part) continue

        const mathMatch = part.match(/^\x00INLINE_MATH:(.+)\x00$/)
        if (mathMatch) {
          // Convert to inlineMath node
          result.push({
            type: 'inlineMath',
            attrs: { latex: mathMatch[1] },
          })
        } else {
          // Keep original text node with marks
          result.push({
            type: 'text',
            text: part,
            ...(node.marks ? { marks: node.marks } : {}),
          })
        }
      }
    } else {
      result.push(node)
    }
  }

  return result
}

// ============================================
// Convenience Function
// ============================================

/**
 * Parse inline markdown text to Tiptap nodes
 *
 * This is the main entry point for parsing inline markdown.
 * Handles: bold, italic, strike, code, link, image, highlight, underline, math
 *
 * @param text - The inline markdown text to parse
 * @returns Array of Tiptap nodes
 */
export function parseInlineMarkdown(text: string): TiptapNode[] {
  if (!text) return []

  // 1. Preprocess custom syntax
  const preprocessed = preprocessInlineText(text)

  // 2. Use marked to parse
  const tokens = marked.lexer(preprocessed)

  // 3. Extract inline tokens from paragraph
  if (tokens.length === 0) return [{ type: 'text', text }]

  const firstToken = tokens[0]
  if (firstToken.type !== 'paragraph') {
    return [{ type: 'text', text }]
  }

  // 4. Convert to Tiptap nodes
  const nodes = parseInlineTokens((firstToken as Tokens.Paragraph).tokens || [])

  // 5. Restore math formulas
  return restoreInlineMath(nodes)
}
