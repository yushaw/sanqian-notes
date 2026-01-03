/**
 * useAIWriting Hook
 *
 * Provides AI writing operations with streaming text replacement/insertion in the editor.
 * All prompts come from AIAction database - no hardcoded prompts here.
 *
 * For 'replace' mode, shows a preview with accept/reject/regenerate options.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import type { Editor } from '@tiptap/react'
import { DOMParser as ProseMirrorDOMParser, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { type AIContext, formatAIPrompt } from '../utils/aiContext'
import { type AIErrorCode, getAIErrorCode } from '../utils/aiErrors'
import { aiPreviewPluginKey, type AIPreviewBlock } from '../components/extensions/AIPreview'

// Re-export for backward compatibility
export type { AIErrorCode as AIWritingErrorCode }

/**
 * Convert extended Markdown to HTML for Tiptap insertContent
 * Supports:
 * - **bold**, __bold__
 * - *italic*, _italic_
 * - ~~strike~~
 * - `code`
 * - ==highlight==
 * - ++underline++
 * - [text](url) → standard link
 * - [[text|noteId]] or [[text|noteId:targetType:targetValue]] → note link
 */
function markdownToHtml(text: string): string {
  return text
    // Note links: [[text|noteId]] or [[text|noteId:targetType:targetValue]]
    // Must be processed before standard links to avoid conflicts
    .replace(/\[\[(.+?)\|([^\]]+)\]\]/g, (_match, linkText, meta) => {
      const parts = meta.split(':')
      const noteId = parts[0] || ''
      const targetType = parts[1] || 'note'
      const targetValue = parts[2] || ''

      let attrs = `data-note-link data-note-id="${noteId}" data-note-title="${linkText}"`
      if (targetType !== 'note') {
        attrs += ` data-target-type="${targetType}"`
      }
      if (targetValue) {
        attrs += ` data-target-value="${targetValue}"`
      }
      return `<span class="note-link" ${attrs}>${linkText}</span>`
    })
    // Standard links: [text](url)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    // Bold: **text** or __text__
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    // Italic: *text* or _text_ (but not inside words)
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
    .replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '<em>$1</em>')
    // Strikethrough: ~~text~~
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    // Highlight: ==text==
    .replace(/==(.+?)==/g, '<mark>$1</mark>')
    // Underline: ++text++
    .replace(/\+\+(.+?)\+\+/g, '<u>$1</u>')
    // Inline code: `text`
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}

/**
 * Check if text contains any Markdown formatting
 */
function hasMarkdownFormatting(text: string): boolean {
  // Check for any supported Markdown syntax
  const patterns = [
    /\*\*.+?\*\*/,           // bold **
    /__.+?__/,               // bold __
    /(?<!\*)\*(?!\*).+?(?<!\*)\*(?!\*)/,  // italic *
    /(?<!_)_(?!_).+?(?<!_)_(?!_)/,        // italic _
    /~~.+?~~/,               // strikethrough
    /`.+?`/,                 // code
    /==.+?==/,               // highlight
    /\+\+.+?\+\+/,           // underline
    /\[.+?\]\(.+?\)/,        // standard link
    /\[\[.+?\|.+?\]\]/       // note link
  ]
  return patterns.some(pattern => pattern.test(text))
}

/**
 * Replace content in transaction with Markdown-formatted inline content
 */
function replaceWithFormattedContent(
  tr: Transaction,
  from: number,
  to: number,
  content: string,
  editor: Editor
): void {
  if (hasMarkdownFormatting(content)) {
    const html = markdownToHtml(content)
    const div = document.createElement('div')
    div.innerHTML = `<p>${html}</p>`
    const parser = ProseMirrorDOMParser.fromSchema(editor.schema)
    const parsedDoc = parser.parse(div)
    const inlineContent = parsedDoc.firstChild?.content
    if (inlineContent) {
      tr.replaceWith(from, to, inlineContent)
      return
    }
  }
  tr.replaceWith(from, to, editor.schema.text(content))
}

/**
 * Create a new paragraph node with Markdown-formatted content
 */
function createFormattedParagraph(content: string, editor: Editor): ProseMirrorNode | null {
  const html = hasMarkdownFormatting(content)
    ? markdownToHtml(content)
    : content
  const div = document.createElement('div')
  div.innerHTML = `<p>${html}</p>`
  const parser = ProseMirrorDOMParser.fromSchema(editor.schema)
  const parsedDoc = parser.parse(div)
  return parsedDoc.firstChild
}

// Insert mode: replace selection or insert after
export type InsertMode = 'replace' | 'insertAfter'

/**
 * Find a block node by its blockId and return its text content range
 */
function findBlockByIdInEditor(editor: Editor, blockId: string): { textFrom: number; textTo: number } | null {
  let result: { textFrom: number; textTo: number } | null = null

  editor.state.doc.descendants((node, pos) => {
    if (result) return false // Already found, stop traversing

    if (node.isBlock && node.isTextblock && node.attrs.blockId === blockId) {
      const textFrom = pos + 1
      const textTo = pos + node.nodeSize - 1
      result = { textFrom, textTo }
      return false // Stop traversing
    }
    return true
  })

  return result
}

/**
 * Simple streaming XML parser state for parsing <block id="N">content</block>
 */
interface BlockParserState {
  currentBlockId: string | null
  currentContent: string
  buffer: string
}

/**
 * Parse streaming text for <block id="N">content</block> format
 * Returns parsed blocks and remaining buffer
 */
function parseStreamingBlocks(
  text: string,
  state: BlockParserState
): { completedBlocks: Array<{ id: string; content: string }>; state: BlockParserState } {
  const completedBlocks: Array<{ id: string; content: string }> = []
  let buffer = state.buffer + text
  let currentBlockId = state.currentBlockId
  let currentContent = state.currentContent

  while (true) {
    if (currentBlockId === null) {
      // Looking for <block id="N">
      const match = buffer.match(/<block\s+id="(\d+)">/i)
      if (match) {
        currentBlockId = match[1]
        currentContent = ''
        buffer = buffer.slice(match.index! + match[0].length)
      } else {
        // No complete tag found, keep buffer for next chunk
        break
      }
    } else {
      // Inside a block, looking for </block>
      const endIndex = buffer.indexOf('</block>')
      if (endIndex !== -1) {
        // Found end tag
        currentContent += buffer.slice(0, endIndex)
        completedBlocks.push({ id: currentBlockId, content: currentContent })
        buffer = buffer.slice(endIndex + '</block>'.length)
        currentBlockId = null
        currentContent = ''
      } else {
        // No end tag yet
        // Check if buffer ends with a potential partial tag (e.g., "</", "</bl", "</block")
        const potentialTagStart = buffer.lastIndexOf('<')
        if (potentialTagStart !== -1 && buffer.length - potentialTagStart < '</block>'.length) {
          // Might be a partial closing tag, keep it in buffer
          currentContent += buffer.slice(0, potentialTagStart)
          buffer = buffer.slice(potentialTagStart)
        } else {
          // No potential partial tag, accumulate all
          currentContent += buffer
          buffer = ''
        }
        break
      }
    }
  }

  return {
    completedBlocks,
    state: { currentBlockId, currentContent, buffer }
  }
}

interface UseAIWritingOptions {
  editor: Editor | null
  onStart?: () => void
  onComplete?: () => void
  onError?: (errorCode: AIErrorCode) => void
}

interface StreamEvent {
  type: 'text' | 'thinking' | 'tool_call' | 'tool_result' | 'done' | 'error' | 'interrupt'
  content?: string
  error?: string
}

export function useAIWriting(options: UseAIWritingOptions) {
  const { editor, onStart, onComplete, onError } = options
  const [isProcessing, setIsProcessing] = useState(false)
  const cleanupRef = useRef<(() => void) | null>(null)
  const abortedRef = useRef(false)
  // Synchronous processing lock to prevent race conditions (checked before async operations)
  const processingLockRef = useRef(false)

  /**
   * Cancel the current AI operation
   */
  const cancel = useCallback(() => {
    abortedRef.current = true
    if (cleanupRef.current) {
      cleanupRef.current()
      cleanupRef.current = null
    }
    processingLockRef.current = false
    setIsProcessing(false)
  }, [])

  /**
   * Execute an AI writing action
   * @param prompt - The AI prompt/instruction from AIAction database
   * @param context - The AI context including target, surrounding text, and positions
   * @param insertMode - How to insert the result: 'replace' or 'insertAfter'
   */
  const executeAction = useCallback(async (
    prompt: string,
    context: AIContext,
    insertMode: InsertMode = 'replace'
  ) => {
    if (!editor || !context.target.trim() || !prompt.trim()) {
      return
    }

    // Prevent concurrent operations - synchronous check before any async work
    if (processingLockRef.current) {
      return
    }
    processingLockRef.current = true

    // Cancel any existing operation (cleanup listener)
    if (cleanupRef.current) {
      cleanupRef.current()
      cleanupRef.current = null
    }

    abortedRef.current = false
    setIsProcessing(true)
    onStart?.()

    const mode = insertMode
    const { targetFrom: from, targetTo: to, isCrossBlock } = context

    // Three replace scenarios:
    // 1. Whole block (hasSelection=false): replace from-to (block text range)
    // 2. Partial selection (hasSelection=true, isCrossBlock=false): replace from-to (selection)
    // 3. Cross-block (isCrossBlock=true): streaming with <block id="N"> format
    const useCrossBlockMode = isCrossBlock && mode === 'replace'


    // State tracking
    let hasReceivedFirstText = false
    let bufferedContent = ''    // Buffer for streaming content (all modes now accumulate without editor updates)

    // Cross-block mode state
    let blockMapping: Record<string, string> = {}  // Simple ID -> actual blockId
    let blockParserState: BlockParserState = { currentBlockId: null, currentContent: '', buffer: '' }
    let blockContentBuffers: Record<string, string> = {}  // blockId -> accumulated content (final Markdown)

    // Generate stream ID
    const streamId = crypto.randomUUID()

    // Build messages using XML format with context
    // SDK doesn't support system role, so we combine into user message
    // For insertAfter mode, force single-block format (no <block> tags needed)
    const contextForPrompt = mode === 'insertAfter'
      ? { ...context, isCrossBlock: false, blocks: [] }
      : context
    const { prompt: fullPrompt, blockMapping: mapping } = formatAIPrompt(contextForPrompt, prompt)
    if (mapping) {
      blockMapping = mapping
    }
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: fullPrompt }
    ]

    try {
      // Acquire reconnect to ensure connection
      await window.electron.chat.acquireReconnect()

      // Register stream event listener
      const cleanup = window.electron.chat.onStreamEvent((sid: string, rawEvent: unknown) => {
        const event = rawEvent as StreamEvent
        if (sid !== streamId || abortedRef.current) return

        if (event.type === 'text' && event.content) {
          let textToInsert = event.content

          // Cross-block mode: parse <block id="N"> format, accumulate content only (no editor updates during streaming)
          // This ensures clean atomic undo - all changes happen in one transaction at the end
          if (useCrossBlockMode) {
            if (!hasReceivedFirstText) {
              hasReceivedFirstText = true
              // Keep loading indicator visible during streaming
            }

            // Parse streaming XML blocks - only accumulate, don't update editor
            const parseResult = parseStreamingBlocks(textToInsert, blockParserState)
            blockParserState = parseResult.state

            // Store completed blocks content (for final atomic update)
            for (const { id, content } of parseResult.completedBlocks) {
              const actualBlockId = blockMapping[id]
              if (actualBlockId) {
                blockContentBuffers[actualBlockId] = content.trim()
              }
            }
            // Note: we don't update the editor here - all updates happen atomically in 'done' handler
            return
          }

          // Trim leading whitespace on first chunk
          if (!hasReceivedFirstText) {
            textToInsert = textToInsert.trimStart()
            if (!textToInsert) return
            hasReceivedFirstText = true
          }

          // Single-block replace mode: accumulate content only (no editor updates during streaming)
          // This ensures clean atomic undo - all changes happen in one transaction at the end
          if (mode === 'replace') {
            bufferedContent += textToInsert
            // Note: we don't update the editor here - atomic update happens in 'done' handler
            return
          }

          // insertAfter mode: also accumulate only for atomic undo
          if (mode === 'insertAfter') {
            bufferedContent += textToInsert
            // Note: we don't update the editor here - atomic update happens in 'done' handler
            return
          }
        }

        if (event.type === 'done') {

          // Cross-block mode: show preview for all blocks
          // Editor still has original content (we didn't update during streaming)
          if (useCrossBlockMode) {
            // Store any remaining content from the last block
            if (blockParserState.currentBlockId && blockParserState.currentContent) {
              const actualBlockId = blockMapping[blockParserState.currentBlockId]
              if (actualBlockId) {
                blockContentBuffers[actualBlockId] = blockParserState.currentContent.trim()
              }
            }

            // Build preview blocks with current positions
            const previewBlocks: AIPreviewBlock[] = Object.entries(blockContentBuffers)
              .map(([blockId, newText]) => {
                const pos = findBlockByIdInEditor(editor, blockId)
                if (!pos) return null
                const oldText = editor.state.doc.textBetween(pos.textFrom, pos.textTo)
                return {
                  blockId,
                  from: pos.textFrom,
                  to: pos.textTo,
                  oldText,
                  newText: newText.trim()
                }
              })
              .filter((b): b is AIPreviewBlock => b !== null)
              .sort((a, b) => a.from - b.from) // Document order for display

            if (previewBlocks.length > 0) {
              // Show preview instead of direct replacement
              editor.commands.showAIPreview({
                id: streamId,
                from: previewBlocks[0].from,
                to: previewBlocks[previewBlocks.length - 1].to,
                oldText: '',
                newText: '',
                blocks: previewBlocks,
                onAccept: () => {
                  // Defensive null check for editor (callback may be called after unmount)
                  if (!editor) return
                  // Accept: execute actual replacement (reverse order for correct position mapping)
                  const sortedBlocks = [...previewBlocks].sort((a, b) => b.from - a.from)
                  const tr = editor.state.tr
                  for (const block of sortedBlocks) {
                    const pos = findBlockByIdInEditor(editor, block.blockId)
                    if (pos) {
                      const mappedFrom = tr.mapping.map(pos.textFrom)
                      const mappedTo = tr.mapping.map(pos.textTo)
                      replaceWithFormattedContent(tr, mappedFrom, mappedTo, block.newText, editor)
                    }
                  }
                  editor.view.dispatch(tr)
                  editor.commands.hideAIPreview()
                  editor.commands.focus()
                },
                onReject: () => {
                  if (!editor) return
                  // Reject: just hide preview, keep original text
                  editor.commands.hideAIPreview()
                  editor.commands.focus()
                },
                onRegenerate: () => {
                  if (!editor) return
                  // Regenerate: hide preview and re-execute
                  editor.commands.hideAIPreview()
                  // Use setTimeout to ensure preview is hidden before re-executing
                  setTimeout(() => {
                    executeAction(prompt, context, insertMode)
                  }, 0)
                }
              })
            }
          } else if (mode === 'replace') {
            // Single block mode: show preview instead of direct replacement
            // Editor still has original content (we didn't update during streaming)
            const finalContent = bufferedContent.trimEnd()
            if (finalContent) {
              const oldText = editor.state.doc.textBetween(from, to)

              // Show preview
              editor.commands.showAIPreview({
                id: streamId,
                from,
                to,
                oldText,
                newText: finalContent,
                onAccept: () => {
                  // Defensive null check for editor (callback may be called after unmount)
                  if (!editor) return
                  // Accept: execute actual replacement
                  // Use mapped positions from plugin state to handle document changes
                  const pluginState = aiPreviewPluginKey.getState(editor.state)
                  if (!pluginState?.data) return
                  const currentFrom = pluginState.data.from
                  const currentTo = pluginState.data.to
                  const tr = editor.state.tr
                  replaceWithFormattedContent(tr, currentFrom, currentTo, finalContent, editor)
                  editor.view.dispatch(tr)
                  editor.commands.hideAIPreview()
                  editor.commands.focus()
                },
                onReject: () => {
                  if (!editor) return
                  // Reject: just hide preview
                  editor.commands.hideAIPreview()
                  editor.commands.focus()
                },
                onRegenerate: () => {
                  if (!editor) return
                  // Regenerate: hide preview and re-execute
                  editor.commands.hideAIPreview()
                  setTimeout(() => {
                    executeAction(prompt, context, insertMode)
                  }, 0)
                }
              })
            }
          } else if (mode === 'insertAfter') {
            // insertAfter mode: insert a new paragraph block after the current block
            // Editor still has original content (we didn't update during streaming)
            const finalContent = bufferedContent.trimEnd()
            if (finalContent) {
              // Find the end position of the last block (after the block node, not inside it)
              // For cross-block selection, use the last block's end position
              const blockEndPos = context.blocks && context.blocks.length > 0
                ? context.blocks[context.blocks.length - 1].to
                : (context.blockTo ?? to)
              const tr = editor.state.tr

              const newParagraph = createFormattedParagraph(finalContent, editor)
              if (newParagraph) {
                tr.insert(blockEndPos, newParagraph)
              }

              // Dispatch with history - this is the only transaction user can undo
              editor.view.dispatch(tr)
            }
          }

          if (typeof cleanup === 'function') cleanup()
          cleanupRef.current = null
          processingLockRef.current = false
          setIsProcessing(false)
          onComplete?.()
          window.electron.chat.releaseReconnect()
        }

        if (event.type === 'error') {
          if (typeof cleanup === 'function') cleanup()
          cleanupRef.current = null
          processingLockRef.current = false
          setIsProcessing(false)
          onError?.(getAIErrorCode(event.error))
          window.electron.chat.releaseReconnect()
        }
      }) as (() => void) | void

      if (typeof cleanup === 'function') {
        cleanupRef.current = cleanup
      }

      // Start streaming
      await window.electron.chat.stream({
        streamId,
        agentId: 'writing',
        messages
      })
    } catch (error) {
      processingLockRef.current = false
      setIsProcessing(false)
      onError?.(getAIErrorCode(error))
      window.electron.chat.releaseReconnect()
    }
  }, [editor, onStart, onComplete, onError])

  // Cleanup on unmount - use ref to capture latest isProcessing state
  const isProcessingRef = useRef(isProcessing)
  isProcessingRef.current = isProcessing

  useEffect(() => {
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current()
        cleanupRef.current = null
      }
      // Release reconnect if component unmounts during streaming
      if (isProcessingRef.current) {
        window.electron.chat.releaseReconnect()
      }
      processingLockRef.current = false
    }
  }, [])

  return {
    isProcessing,
    executeAction,
    cancel
  }
}
