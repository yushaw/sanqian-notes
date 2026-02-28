/**
 * AIPopupMarkView - React component for AI popup mark node
 *
 * Renders a Sparkles icon with hover preview.
 * Auto-shows preview when streaming completes, stays until mouse enters then leaves.
 */

import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { createPortal } from 'react-dom'
import { Sparkles, MessageSquare, Copy, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useState, useRef, useEffect } from 'react'
import { useFloating, flip, offset, shift, autoUpdate } from '@floating-ui/react'
import { Streamdown } from 'streamdown'
import remarkGfm from 'remark-gfm'
import { getPopup, deletePopup, updatePopupContent, updatePopupStreaming, preloadPopup } from '../utils/popupStorage'
import { AI_POPUP_PREVIEW_PROSE } from '../utils/proseStyles'
import { useTranslations } from '../i18n'
import { toast } from '../utils/toast'
import { formatAIPrompt, type AIContext } from '../utils/aiContext'

const REMARK_PLUGINS = [remarkGfm]

// 时间常量
const HOVER_DELAY_MS = 300
const HIDE_DELAY_MS = 100
const STREAMING_CHECK_INTERVAL_MS = 500

// 单实例管理：当前显示预览的 popupId
let currentPreviewPopupId: string | null = null

export function AIPopupMarkView({ node, deleteNode }: NodeViewProps) {
  const { popupId } = node.attrs
  const [showPreview, setShowPreview] = useState(false)
  const [previewContent, setPreviewContent] = useState('')
  const [actionName, setActionName] = useState('')
  const [targetText, setTargetText] = useState('')
  const [storedPrompt, setStoredPrompt] = useState('')
  const [storedDocTitle, setStoredDocTitle] = useState<string | undefined>()
  const [isStreaming, setIsStreaming] = useState(false)
  const [showContinueTooltip, setShowContinueTooltip] = useState(false)
  const [hasMouseEntered, setHasMouseEntered] = useState(false) // 鼠标是否进入过预览
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null)
  const hideTimerRef = useRef<NodeJS.Timeout | null>(null)
  const streamingCheckRef = useRef<NodeJS.Timeout | null>(null)
  const wasStreamingRef = useRef(false) // 跟踪之前是否在 streaming
  const retryCleanupRef = useRef<(() => void) | null>(null)
  const retryStreamIdRef = useRef<string | null>(null)
  const retryReconnectHeldRef = useRef(false)
  const t = useTranslations()

  // Floating UI for popup positioning
  const { refs, floatingStyles } = useFloating({
    open: showPreview,
    placement: 'bottom-start',
    middleware: [
      offset(4),
      flip({ fallbackPlacements: ['top-start', 'bottom-end', 'top-end'] }),
      shift({ padding: 8 })
    ],
    whileElementsMounted: autoUpdate
  })

  const releaseRetryReconnectIfHeld = useCallback(() => {
    if (retryReconnectHeldRef.current) {
      retryReconnectHeldRef.current = false
      window.electron.chat.releaseReconnect()
    }
  }, [])

  const cancelRetryStream = useCallback(() => {
    const streamId = retryStreamIdRef.current
    if (streamId) {
      void window.electron.chat.cancelStream({ streamId }).catch(() => {})
      retryStreamIdRef.current = null
    }
  }, [])

  // 显示预览的通用函数
  const showPreviewPopup = useCallback(() => {
    if (!popupId) return

    const popupData = getPopup(popupId)
    if (!popupData?.content) return

    // 单实例：关闭其他预览
    if (currentPreviewPopupId && currentPreviewPopupId !== popupId) {
      // 触发其他组件关闭（通过自定义事件）
      window.dispatchEvent(new CustomEvent('ai-popup-close', { detail: currentPreviewPopupId }))
    }
    currentPreviewPopupId = popupId

    // 位置由 Floating UI 自动处理
    setPreviewContent(popupData.content)
    setActionName(popupData.actionName || '')
    setTargetText(popupData.targetText || '')
    setStoredPrompt(popupData.prompt || '')
    setStoredDocTitle(popupData.documentTitle)
    setShowPreview(true)
  }, [popupId])

  // 预加载 popup 数据到缓存
  useEffect(() => {
    if (popupId) {
      preloadPopup(popupId)
    }
  }, [popupId])

  // 监听其他组件的关闭事件
  useEffect(() => {
    const handleClose = (e: Event) => {
      const closePopupId = (e as CustomEvent).detail
      if (closePopupId === popupId) {
        setShowPreview(false)
        setHasMouseEntered(false)
      }
    }
    window.addEventListener('ai-popup-close', handleClose)
    return () => window.removeEventListener('ai-popup-close', handleClose)
  }, [popupId])

  // 检查 streaming 状态，streaming 结束后自动显示预览
  useEffect(() => {
    if (!popupId) return

    const checkStreaming = () => {
      const popupData = getPopup(popupId)
      const streaming = popupData?.isStreaming ?? false
      const hasContent = !!popupData?.content

      // 检测 streaming 从 true 变为 false（完成）
      if (wasStreamingRef.current && !streaming && hasContent) {
        // streaming 完成，自动显示预览
        setHasMouseEntered(false) // 重置鼠标状态
        showPreviewPopup()
      }

      wasStreamingRef.current = streaming
      setIsStreaming(streaming)

      // 有内容且 streaming 结束后停止轮询
      if (hasContent && !streaming && streamingCheckRef.current) {
        clearInterval(streamingCheckRef.current)
        streamingCheckRef.current = null
      }
    }

    // 初始检查
    const popupData = getPopup(popupId)
    wasStreamingRef.current = popupData?.isStreaming ?? false
    setIsStreaming(wasStreamingRef.current)

    // 启动定期检查（会在 streaming 完成后自动停止）
    streamingCheckRef.current = setInterval(checkStreaming, STREAMING_CHECK_INTERVAL_MS)

    return () => {
      if (streamingCheckRef.current) {
        clearInterval(streamingCheckRef.current)
      }
    }
  }, [popupId, showPreviewPopup])

  // Cleanup timers and listeners on unmount
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current)
      }
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current)
      }
      // Clean up retry stream listener
      if (retryCleanupRef.current) {
        retryCleanupRef.current()
        retryCleanupRef.current = null
      }
      cancelRetryStream()
      releaseRetryReconnectIfHeld()
      // 清理单实例状态
      if (currentPreviewPopupId === popupId) {
        currentPreviewPopupId = null
      }
    }
  }, [popupId, cancelRetryStream, releaseRetryReconnectIfHeld])

  const handleMouseEnter = useCallback(() => {
    // Cancel any pending hide
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }

    if (!popupId) return

    // 如果预览已显示，标记鼠标已进入
    if (showPreview) {
      setHasMouseEntered(true)
      return
    }

    // hover 延迟显示
    hoverTimerRef.current = setTimeout(() => {
      setHasMouseEntered(true)
      showPreviewPopup()
    }, HOVER_DELAY_MS)
  }, [popupId, showPreview, showPreviewPopup])

  const handleMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }

    // 只有鼠标进入过才会在离开时隐藏
    if (!hasMouseEntered) return

    // Delay hide to allow mouse to move to preview
    hideTimerRef.current = setTimeout(() => {
      setShowPreview(false)
      setHasMouseEntered(false)
      if (currentPreviewPopupId === popupId) {
        currentPreviewPopupId = null
      }
    }, HIDE_DELAY_MS)
  }, [hasMouseEntered, popupId])

  const handleDelete = useCallback(() => {
    cancelRetryStream()
    if (retryCleanupRef.current) {
      retryCleanupRef.current()
      retryCleanupRef.current = null
    }
    releaseRetryReconnectIfHeld()

    if (popupId) {
      void window.electron.chat.cancelStream({ streamId: popupId }).catch(() => {})
      updatePopupStreaming(popupId, false)
      // Delete popup data from storage
      deletePopup(popupId)
    }
    // Delete the node
    deleteNode()
  }, [popupId, deleteNode, cancelRetryStream, releaseRetryReconnectIfHeld])

  const handleContinueInChat = useCallback(() => {
    if (targetText && previewContent) {
      window.electron.popup.continueInChat(targetText, previewContent)
      setShowPreview(false)
    }
  }, [targetText, previewContent])

  // 复制内容
  const handleCopy = useCallback(async () => {
    if (!previewContent) return
    try {
      await navigator.clipboard.writeText(previewContent)
      toast(t.ai.copied, { type: 'success' })
    } catch {
      toast(t.ai.copyFailed, { type: 'error' })
    }
  }, [previewContent, t])

  // 重试：重新生成内容
  const handleRetry = useCallback(async () => {
    if (!popupId || !storedPrompt || !targetText || isStreaming) return

    // Clean up any existing retry stream
    cancelRetryStream()
    if (retryCleanupRef.current) {
      retryCleanupRef.current()
      retryCleanupRef.current = null
    }
    releaseRetryReconnectIfHeld()

    // 清空当前内容，开始 streaming
    setPreviewContent('')
    setIsStreaming(true)
    updatePopupContent(popupId, '')
    updatePopupStreaming(popupId, true)

    const streamId = popupId
    retryStreamIdRef.current = streamId
    let accumulated = ''

    try {
      await window.electron.chat.acquireReconnect()
      retryReconnectHeldRef.current = true

      const cleanup = window.electron.chat.onStreamEvent((sid: string, rawEvent: unknown) => {
        if (sid !== streamId) return
        const event = rawEvent as { type: string; content?: string }

        if (event.type === 'text' && event.content) {
          accumulated += event.content
          setPreviewContent(accumulated)
          updatePopupContent(popupId, accumulated)
        }

        if (event.type === 'done' || event.type === 'error') {
          setIsStreaming(false)
          updatePopupStreaming(popupId, false) // This will also flush content to database
          retryStreamIdRef.current = null
          retryCleanupRef.current = null
          cleanup()
          releaseRetryReconnectIfHeld()
        }
      })

      // Store cleanup ref for unmount handling
      retryCleanupRef.current = cleanup

      // 构建 AI 上下文
      const context: AIContext = {
        target: targetText,
        targetMarkdown: targetText,
        targetFrom: 0,
        targetTo: 0,
        before: '',
        after: '',
        documentTitle: storedDocTitle,
        hasSelection: true,
        isCrossBlock: false,
        blocks: []
      }

      const { prompt: fullPrompt } = formatAIPrompt(context, storedPrompt)
      await window.electron.chat.stream({
        streamId,
        agentId: 'writing',
        messages: [{ role: 'user', content: fullPrompt }]
      })
    } catch {
      setIsStreaming(false)
      updatePopupStreaming(popupId, false)
      retryStreamIdRef.current = null
      retryCleanupRef.current = null
      releaseRetryReconnectIfHeld()
      toast(t.ai.connectionFailed, { type: 'error' })
    }
  }, [
    popupId,
    storedPrompt,
    targetText,
    storedDocTitle,
    isStreaming,
    t,
    cancelRetryStream,
    releaseRetryReconnectIfHeld
  ])

  // 删除 popup 及图标
  const handleDeletePopup = useCallback(() => {
    setShowPreview(false)
    setHasMouseEntered(false)
    if (currentPreviewPopupId === popupId) {
      currentPreviewPopupId = null
    }
    handleDelete()
  }, [popupId, handleDelete])

  return (
    <NodeViewWrapper
      as="span"
      className="ai-popup-mark-wrapper inline-flex items-center relative"
    >
      <span
        ref={refs.setReference}
        tabIndex={0}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onKeyDown={(e) => {
          if (e.key === 'Backspace' || e.key === 'Delete') {
            e.preventDefault()
            handleDelete()
          }
        }}
        className={`inline-flex items-center justify-center w-4 h-4 p-0.5 text-[var(--color-accent)] align-middle mx-0.5 rounded transition-all ${isStreaming ? 'animate-pulse' : ''} ${showPreview ? 'bg-blue-500/20' : ''}`}
        contentEditable={false}
      >
        <Sparkles size={10} strokeWidth={1.5} />
      </span>

      {/* Hover preview popup - rendered via portal to escape TipTap's event handling */}
      {showPreview && previewContent && createPortal(
        <div
          ref={refs.setFloating}
          className="z-[9999] w-64 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg shadow-lg text-sm"
          style={floatingStyles}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {/* Header with action name and buttons */}
          <div className="flex items-center justify-between px-3 pt-2 pb-1 border-b border-[var(--color-border)]">
            <span className="text-xs font-medium text-[var(--color-muted)] truncate">
              {actionName || t.ai.result}
            </span>
            <div className="flex items-center gap-0.5 ml-2">
              <button
                onClick={handleCopy}
                className="p-1.5 rounded text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)] transition-colors"
                title={t.contextMenu.copy}
              >
                <Copy size={12} />
              </button>
              <button
                onClick={handleRetry}
                disabled={isStreaming}
                className={`p-1.5 rounded text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)] transition-colors ${isStreaming ? 'opacity-50 cursor-not-allowed animate-spin' : ''}`}
                title={t.ai.retry}
              >
                <RefreshCw size={12} />
              </button>
              <button
                onClick={handleDeletePopup}
                className="p-1.5 rounded text-[var(--color-muted)] hover:text-red-500 hover:bg-[var(--color-hover)] transition-colors"
                title={t.ai.delete}
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>

          {/* Scrollable content area */}
          <div
            className="max-h-48 overflow-y-auto overflow-x-hidden pt-2 pb-3 pl-3 pr-2 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-[var(--color-border)] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent"
          >
            <div className={`ai-popup-preview ${AI_POPUP_PREVIEW_PROSE}`}>
              <Streamdown remarkPlugins={REMARK_PLUGINS}>
                {previewContent.trim()}
              </Streamdown>
            </div>
          </div>

          {/* Continue in chat button - floating at bottom right */}
          {targetText && (
            <div className="absolute bottom-2 right-2">
              <button
                onClick={handleContinueInChat}
                onMouseEnter={() => setShowContinueTooltip(true)}
                onMouseLeave={() => setShowContinueTooltip(false)}
                className="p-1 rounded-lg bg-[var(--color-card)]/60 text-[var(--color-muted)] hover:bg-[var(--color-card)] hover:text-[var(--color-accent)] transition-all"
              >
                <MessageSquare size={12} />
              </button>
              {showContinueTooltip && (
                <div className="absolute bottom-full right-0 mb-1 px-2 py-1 text-xs text-white bg-gray-800 dark:bg-gray-700 rounded shadow-lg whitespace-nowrap">
                  {t.contextMenu.aiContinueInChat}
                </div>
              )}
            </div>
          )}
        </div>,
        document.body
      )}
    </NodeViewWrapper>
  )
}
