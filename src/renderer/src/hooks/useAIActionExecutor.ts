/**
 * useAIActionExecutor Hook
 *
 * Provides unified AI action execution with loading indicators for all modes:
 * - popup: Insert sparkle icon, stream result to popup
 * - replace/insert: Insert temp sparkle icon, execute action, cleanup on complete
 *
 * This hook wraps useAIWriting and handles the UI feedback (sparkle icons) consistently.
 */

import { useCallback, useRef } from 'react'
import type { Editor } from '@tiptap/react'
import { v4 as uuidv4 } from 'uuid'
import { useAIWriting, type InsertMode } from './useAIWriting'
import { getAIContext, formatAIPrompt, type AIContext } from '../utils/aiContext'
import { createPopup, updatePopupContent, updatePopupStreaming, deletePopup } from '../utils/popupStorage'
import { toast } from '../utils/toast'
import type { AIAction } from '../../../shared/types'

/** Options for useAIActionExecutor hook */
export interface UseAIActionExecutorOptions {
  editor: Editor | null
  onComplete?: () => void
  onError?: (errorCode: string) => void
  /** Translation object with ai messages */
  t: { ai: { connectionFailed: string; noContentToProcess: string } }
}

/** Return type of useAIActionExecutor hook */
export interface UseAIActionExecutorReturn {
  /** Execute an AI action (gets context automatically) */
  executeAction: (action: AIAction) => void
  /** Execute an AI action with pre-fetched context */
  executeActionWithContext: (action: AIAction, context: AIContext) => void
  /** Execute with raw parameters (for shortcuts/slash commands) */
  executeWithParams: (prompt: string, actionName: string, mode: 'popup' | 'replace' | 'insert') => void
  /** Whether an AI action is currently processing */
  isProcessing: boolean
  /** Cancel the current AI action */
  cancel: () => void
  /** Force cleanup all temp loading icons (for emergency cleanup) */
  cleanupTempIcons: () => void
}

export function useAIActionExecutor(options: UseAIActionExecutorOptions): UseAIActionExecutorReturn {
  const { editor, onComplete, onError, t } = options

  // Track all temp popup IDs for cleanup (supports concurrent actions)
  const tempPopupIdsRef = useRef<Set<string>>(new Set())

  const runAsyncSafely = useCallback((task: Promise<unknown>, label: string) => {
    void task.catch((error) => {
      console.error(`[AI Action Executor] ${label} failed:`, error)
    })
  }, [])

  // Cleanup all temp icons
  // Collects positions first, then deletes from end to start in a single transaction
  const cleanupTempIcons = useCallback(() => {
    if (!editor || tempPopupIdsRef.current.size === 0) return

    const idsToCleanup = new Set(tempPopupIdsRef.current)
    const toDelete: { pos: number; popupId: string }[] = []

    // Collect all positions first
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'aiPopupMark' && idsToCleanup.has(node.attrs.popupId)) {
        toDelete.push({ pos, popupId: node.attrs.popupId })
      }
      return true
    })

    if (toDelete.length === 0) {
      tempPopupIdsRef.current.clear()
      return
    }

    // Sort from end to start, then delete in a single transaction
    toDelete.sort((a, b) => b.pos - a.pos)

    const { tr } = editor.state
    for (const { pos, popupId } of toDelete) {
      tr.delete(pos, pos + 1)
      runAsyncSafely(deletePopup(popupId), 'delete popup')
    }
    editor.view.dispatch(tr)

    tempPopupIdsRef.current.clear()
  }, [editor, runAsyncSafely])

  // AI Writing hook
  const { executeAction: executeAIAction, isProcessing, cancel } = useAIWriting({
    editor,
    onComplete: () => {
      cleanupTempIcons()
      onComplete?.()
    },
    onError: (errorCode) => {
      cleanupTempIcons()
      onError?.(errorCode)
    }
  })

  // Popup mode stream
  const startPopupStream = useCallback(async (popupId: string, prompt: string, context: AIContext) => {
    if (!editor) return
    const streamId = popupId
    let accumulated = ''
    let cleanup: (() => void) | null = null

    updatePopupStreaming(popupId, true)

    try {
      await window.electron.chat.acquireReconnect()

      cleanup = window.electron.chat.onStreamEvent((sid: string, rawEvent: unknown) => {
        if (sid !== streamId) return
        const event = rawEvent as { type: string; content?: string }

        if (event.type === 'text' && event.content) {
          accumulated += event.content
          updatePopupContent(popupId, accumulated)
        }

        if (event.type === 'done') {
          updatePopupStreaming(popupId, false)
          cleanup?.()
          window.electron.chat.releaseReconnect()
          onComplete?.()
        }

        if (event.type === 'error') {
          updatePopupStreaming(popupId, false)
          cleanup?.()
          window.electron.chat.releaseReconnect()
          onError?.('stream_error')
        }
      })

      const { prompt: fullPrompt } = formatAIPrompt(context, prompt)
      await window.electron.chat.stream({
        streamId,
        agentId: 'writing',
        messages: [{ role: 'user', content: fullPrompt }]
      })
    } catch (err) {
      console.error('[Popup] Stream error:', err)
      cleanup?.() // Ensure listener is cleaned up if registered
      updatePopupStreaming(popupId, false)
      runAsyncSafely(deletePopup(popupId), 'delete popup')
      editor.commands.deleteAIPopupMark(popupId)
      toast(t.ai.connectionFailed, { type: 'error' })
      window.electron.chat.releaseReconnect()
      onError?.('connection_failed')
    }
  }, [editor, onComplete, onError, runAsyncSafely, t.ai.connectionFailed])

  // Handle popup mode
  const handlePopupAction = useCallback((prompt: string, actionName: string, context: AIContext) => {
    if (!editor) return

    const popupId = uuidv4()

    runAsyncSafely(createPopup({
      popupId,
      prompt,
      actionName,
      context: {
        targetText: context.targetMarkdown,
        documentTitle: context.documentTitle
      }
    }), 'create popup')
    updatePopupStreaming(popupId, true)

    editor.chain()
      .focus()
      .setTextSelection(context.targetTo)
      .insertAIPopupMark({ popupId })
      .run()

    startPopupStream(popupId, prompt, context)
  }, [editor, runAsyncSafely, startPopupStream])

  // Handle replace/insert mode with temp icon
  const handleReplaceInsertAction = useCallback((prompt: string, actionName: string, context: AIContext, mode: 'replace' | 'insert') => {
    if (!editor) return

    const tempPopupId = uuidv4()
    tempPopupIdsRef.current.add(tempPopupId)

    runAsyncSafely(createPopup({
      popupId: tempPopupId,
      prompt,
      actionName,
      context: {
        targetText: context.targetMarkdown,
        documentTitle: context.documentTitle
      }
    }), 'create popup')
    updatePopupStreaming(tempPopupId, true)

    editor.chain()
      .focus()
      .setTextSelection(context.targetTo)
      .insertAIPopupMark({ popupId: tempPopupId })
      .run()

    const insertMode: InsertMode = mode === 'insert' ? 'insertAfter' : 'replace'
    executeAIAction(prompt, context, insertMode)
  }, [editor, executeAIAction, runAsyncSafely])

  // Internal execute logic
  const executeInternal = useCallback((
    prompt: string,
    actionName: string,
    mode: 'popup' | 'replace' | 'insert',
    context: AIContext
  ) => {
    if (!editor) return
    if (!prompt.trim() || !context.target.trim()) {
      toast(t.ai.noContentToProcess, { type: 'info' })
      return
    }

    if (mode === 'popup') {
      handlePopupAction(prompt, actionName, context)
    } else {
      handleReplaceInsertAction(prompt, actionName, context, mode)
    }
  }, [editor, handlePopupAction, handleReplaceInsertAction, t.ai.noContentToProcess])

  /**
   * Execute an AI action with proper UI feedback
   * Automatically handles popup/replace/insert modes with sparkle icons
   */
  const executeAction = useCallback((action: AIAction) => {
    if (!editor) return

    const context = getAIContext(editor)
    if (!context) {
      toast(t.ai.noContentToProcess, { type: 'info' })
      return
    }

    executeInternal(action.prompt, action.name, action.mode, context)
  }, [editor, executeInternal, t.ai.noContentToProcess])

  /**
   * Execute an AI action with custom context
   * Useful when context is already available (e.g., from context menu)
   */
  const executeActionWithContext = useCallback((action: AIAction, context: AIContext) => {
    if (!editor) return
    executeInternal(action.prompt, action.name, action.mode, context)
  }, [editor, executeInternal])

  /**
   * Execute with raw parameters (for shortcuts and slash commands)
   * Automatically gets context from editor
   */
  const executeWithParams = useCallback((
    prompt: string,
    actionName: string,
    mode: 'popup' | 'replace' | 'insert'
  ) => {
    if (!editor) return

    const context = getAIContext(editor)
    if (!context) {
      toast(t.ai.noContentToProcess, { type: 'info' })
      return
    }

    executeInternal(prompt, actionName, mode, context)
  }, [editor, executeInternal, t.ai.noContentToProcess])

  return {
    executeAction,
    executeActionWithContext,
    executeWithParams,
    isProcessing,
    cancel,
    cleanupTempIcons
  }
}
