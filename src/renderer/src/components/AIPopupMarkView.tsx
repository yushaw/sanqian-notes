/**
 * AIPopupMarkView - React component for AI popup mark node
 *
 * Renders a Sparkles icon with hover preview after 300ms.
 */

import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { createPortal } from 'react-dom'
import { Sparkles, MessageSquare } from 'lucide-react'
import { useCallback, useState, useRef, useEffect } from 'react'
import { Streamdown } from 'streamdown'
import remarkGfm from 'remark-gfm'
import { getPopup, deletePopup } from '../utils/popupStorage'
import { AI_POPUP_PREVIEW_PROSE } from '../utils/proseStyles'
import { useTranslations } from '../i18n'

const REMARK_PLUGINS = [remarkGfm]

// 时间常量
const HOVER_DELAY_MS = 300
const HIDE_DELAY_MS = 100
const STREAMING_CHECK_INTERVAL_MS = 500

export function AIPopupMarkView({ node, deleteNode }: NodeViewProps) {
  const { popupId } = node.attrs
  const [showPreview, setShowPreview] = useState(false)
  const [previewContent, setPreviewContent] = useState('')
  const [actionName, setActionName] = useState('')
  const [targetText, setTargetText] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [showContinueTooltip, setShowContinueTooltip] = useState(false)
  const [popupPosition, setPopupPosition] = useState({ top: 0, left: 0 })
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null)
  const hideTimerRef = useRef<NodeJS.Timeout | null>(null)
  const streamingCheckRef = useRef<NodeJS.Timeout | null>(null)
  const buttonRef = useRef<HTMLSpanElement>(null)
  const t = useTranslations()

  // 检查 streaming 状态（仅在 streaming 时轮询，结束后停止）
  useEffect(() => {
    if (!popupId) return

    const checkStreaming = () => {
      const popupData = getPopup(popupId)
      const streaming = popupData?.isStreaming ?? false
      setIsStreaming(streaming)

      // streaming 结束后停止轮询
      if (!streaming && streamingCheckRef.current) {
        clearInterval(streamingCheckRef.current)
        streamingCheckRef.current = null
      }
    }

    // 初始检查
    const popupData = getPopup(popupId)
    const initialStreaming = popupData?.isStreaming ?? false
    setIsStreaming(initialStreaming)

    // 仅在 streaming 时启动定期检查
    if (initialStreaming) {
      streamingCheckRef.current = setInterval(checkStreaming, STREAMING_CHECK_INTERVAL_MS)
    }

    return () => {
      if (streamingCheckRef.current) {
        clearInterval(streamingCheckRef.current)
      }
    }
  }, [popupId])

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current)
      }
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current)
      }
    }
  }, [])

  const handleMouseEnter = useCallback(() => {
    // Cancel any pending hide
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }

    if (!popupId) return

    // If already showing, don't restart timer
    if (showPreview) return

    hoverTimerRef.current = setTimeout(() => {
      const popupData = getPopup(popupId)
      if (popupData?.content && buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect()
        setPopupPosition({
          top: rect.bottom + 4,
          left: rect.left
        })
        setPreviewContent(popupData.content)
        setActionName(popupData.actionName || '')
        setTargetText(popupData.context?.targetText || '')
        setShowPreview(true)
      }
    }, HOVER_DELAY_MS)
  }, [popupId, showPreview])

  const handleMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    // Delay hide to allow mouse to move to preview
    hideTimerRef.current = setTimeout(() => {
      setShowPreview(false)
    }, HIDE_DELAY_MS)
  }, [])

  const handleDelete = useCallback(() => {
    if (popupId) {
      // Delete popup data from storage
      deletePopup(popupId)
      // Close popup window if open
      window.electron.popup.close(popupId)
    }
    // Delete the node
    deleteNode()
  }, [popupId, deleteNode])

  const handleContinueInChat = useCallback(() => {
    if (targetText && previewContent) {
      window.electron.popup.continueInChat(targetText, previewContent)
      setShowPreview(false)
    }
  }, [targetText, previewContent])

  return (
    <NodeViewWrapper
      as="span"
      className="ai-popup-mark-wrapper inline-flex items-center relative"
    >
      <span
        ref={buttonRef}
        tabIndex={0}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onKeyDown={(e) => {
          if (e.key === 'Backspace' || e.key === 'Delete') {
            e.preventDefault()
            handleDelete()
          }
        }}
        className={`inline-flex items-center justify-center w-3 h-3 text-[var(--color-accent)] align-middle mx-1 ${isStreaming ? 'animate-pulse' : ''}`}
        contentEditable={false}
      >
        <Sparkles size={10} strokeWidth={1.5} />
      </span>

      {/* Hover preview popup - rendered via portal to escape TipTap's event handling */}
      {showPreview && previewContent && createPortal(
        <div
          className="fixed z-[9999] w-64 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg shadow-lg text-sm"
          style={{ top: popupPosition.top, left: popupPosition.left }}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {/* Action name header */}
          {actionName && (
            <div className="px-3 pt-2 pb-1 text-xs font-medium text-[var(--color-muted)] border-b border-[var(--color-border)]">
              {actionName}
            </div>
          )}

          {/* Scrollable content area */}
          <div
            className={`max-h-48 overflow-y-auto overflow-x-hidden ${actionName ? 'pt-2' : 'pt-3'} pb-3 pl-3 pr-2 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-[var(--color-border)] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent`}
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
