/**
 * Pure utility functions for parsing and extracting data from TipTap/ProseMirror documents.
 *
 * - tryParseImportedTiptapDoc: Parse imported TipTap JSON with BOM/NUL handling
 * - handleCursorPlaceholder: Find and remove cursor placeholder character
 * - extractHeadingsFromJSON: Extract heading nodes from JSON doc
 * - extractBlocksFromJSON: Extract block nodes with IDs from JSON doc
 * - extractTextFromNode: Recursively extract text from a node tree
 */

import type { Editor as TiptapEditor } from '@tiptap/react'
import type { HeadingInfo, BlockInfo } from '../NoteLinkPopup'

export const CURSOR_PLACEHOLDER = '\u2063'

export interface ImportedTiptapDoc {
  type: 'doc'
  content: unknown[]
}

export function tryParseImportedTiptapDoc(input: unknown): ImportedTiptapDoc | null {
  let current: unknown = input
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current === 'string') {
      let normalized = current.trim()
      if (!normalized) return null
      if (normalized.startsWith('\uFEFF')) {
        normalized = normalized.slice(1)
      }

      try {
        current = JSON.parse(normalized)
        continue
      } catch {
        // Some sources may include unexpected control chars in transport strings.
        const sanitized = normalized.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
        if (sanitized !== normalized) {
          try {
            current = JSON.parse(sanitized)
            continue
          } catch {
            return null
          }
        }
        return null
      }
    }

    if (!current || typeof current !== 'object') return null
    const maybeDoc = current as { type?: unknown; content?: unknown }
    if (maybeDoc.type === 'doc' && Array.isArray(maybeDoc.content)) {
      return { type: 'doc', content: maybeDoc.content }
    }

    // Some payloads may wrap JSON again under "content".
    if (typeof maybeDoc.content === 'string') {
      current = maybeDoc.content
      continue
    }

    return null
  }

  return null
}

export function handleCursorPlaceholder(editor: TiptapEditor) {
  if (editor.isDestroyed) return

  const doc = editor.state.doc
  let cursorPos: number | null = null

  doc.descendants((node, pos) => {
    if (cursorPos !== null) return false

    if (node.isText && node.text) {
      const index = node.text.indexOf(CURSOR_PLACEHOLDER)
      if (index !== -1) {
        cursorPos = pos + index
        return false
      }
    }
    return true
  })

  if (cursorPos !== null) {
    requestAnimationFrame(() => {
      if (editor.isDestroyed) return

      editor
        .chain()
        .focus()
        .deleteRange({ from: cursorPos!, to: cursorPos! + 1 })
        .setTextSelection(cursorPos!)
        .run()
    })
  }
}

export function extractTextFromNode(node: unknown): string {
  const n = node as { type?: string; text?: string; content?: unknown[] }
  if (!n || typeof n !== 'object') return ''

  if (n.text) return n.text

  if (n.content && Array.isArray(n.content)) {
    return n.content.map(child => extractTextFromNode(child)).join('')
  }

  return ''
}

export function extractHeadingsFromJSON(doc: { type: string; content?: unknown[] }): HeadingInfo[] {
  const headings: HeadingInfo[] = []
  let pos = 0

  function traverse(node: unknown) {
    const n = node as { type?: string; attrs?: { level?: number; blockId?: string }; content?: unknown[]; text?: string }
    if (!n || typeof n !== 'object') return

    if (n.type === 'heading') {
      const text = extractTextFromNode(n)
      headings.push({
        level: n.attrs?.level || 1,
        text,
        pos,
        blockId: n.attrs?.blockId,
      })
    }

    if (n.content && Array.isArray(n.content)) {
      for (const child of n.content) {
        traverse(child)
        pos++
      }
    }
  }

  if (doc.content) {
    for (const node of doc.content) {
      traverse(node)
      pos++
    }
  }

  return headings
}

export function extractBlocksFromJSON(doc: { type: string; content?: unknown[] }): BlockInfo[] {
  const blocks: BlockInfo[] = []
  let pos = 0

  const blockTypes = ['paragraph', 'heading', 'blockquote', 'codeBlock', 'bulletList', 'orderedList', 'taskList', 'table', 'horizontalRule']

  function traverse(node: unknown) {
    const n = node as { type?: string; attrs?: { blockId?: string }; content?: unknown[] }
    if (!n || typeof n !== 'object') return

    if (n.type && blockTypes.includes(n.type)) {
      const text = extractTextFromNode(n)
      if (n.type === 'paragraph' && !text.trim()) {
        pos++
        return
      }

      if (n.attrs?.blockId) {
        blocks.push({
          id: n.attrs.blockId,
          type: n.type,
          text: text.slice(0, 100),
          pos,
        })
      }
    }

    if (n.content && Array.isArray(n.content)) {
      for (const child of n.content) {
        traverse(child)
      }
    }
    pos++
  }

  if (doc.content) {
    for (const node of doc.content) {
      traverse(node)
    }
  }

  return blocks
}
