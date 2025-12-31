/**
 * PopupWindow - Independent popup window for AI content
 *
 * Features:
 * - Receives popupId from URL query parameter
 * - Loads content from localStorage or receives via IPC
 * - Renders streaming markdown content
 * - Draggable title bar area (macOS)
 * - Windows/macOS 兼容：使用系统标题栏关闭按钮
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import { Streamdown } from 'streamdown'
import remarkGfm from 'remark-gfm'
import { MessageSquare } from 'lucide-react'
import { getPopup, updatePopupContent } from '../utils/popupStorage'
import { AI_POPUP_WINDOW_PROSE } from '../utils/proseStyles'
import { useTranslations } from '../i18n'

const REMARK_PLUGINS = [remarkGfm]

export default function PopupWindow() {
  const [content, setContent] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [popupId, setPopupId] = useState<string | null>(null)
  const [isDark, setIsDark] = useState(false)
  const [showContinueTooltip, setShowContinueTooltip] = useState(false)
  const [targetText, setTargetText] = useState('')  // 原始选中的文本
  const [actionName, setActionName] = useState('')  // AI 操作名称
  const t = useTranslations()

  // 检测系统主题
  useEffect(() => {
    const checkTheme = async () => {
      try {
        const theme = await window.electron.theme.get()
        setIsDark(theme === 'dark')
        document.documentElement.classList.toggle('dark', theme === 'dark')
      } catch {
        // 使用系统偏好作为 fallback
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
        setIsDark(prefersDark)
        document.documentElement.classList.toggle('dark', prefersDark)
      }
    }
    checkTheme()

    // 监听主题变化
    const cleanup = window.electron.theme.onChange?.((theme) => {
      setIsDark(theme === 'dark')
      document.documentElement.classList.toggle('dark', theme === 'dark')
    })
    return cleanup
  }, [])

  // 动态设置窗口标题
  useEffect(() => {
    document.title = actionName || t.ai.title
  }, [actionName, t.ai.title])

  // Get popupId from URL query parameter
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const id = params.get('popupId')
    setPopupId(id)

    if (id) {
      // Load saved content from localStorage
      const saved = getPopup(id)
      if (saved) {
        if (saved.content) {
          setContent(saved.content)
          setIsLoading(false)
        }
        // 保存原始选中的文本（用于接着对话）
        if (saved.context?.targetText) {
          setTargetText(saved.context.targetText)
        }
        // 保存 AI 操作名称
        if (saved.actionName) {
          setActionName(saved.actionName)
        }
      }
    }
  }, [])

  // Listen for content updates from main process
  useEffect(() => {
    if (!popupId) return

    // 使用 preload 暴露的 API 监听内容更新
    const cleanup = window.electron.popup.onContentUpdate((newContent: string) => {
      setContent(newContent)
      setIsLoading(false)
      // Persist to localStorage
      updatePopupContent(popupId, newContent)
    })

    return cleanup
  }, [popupId])

  // Handle close
  const handleClose = useCallback(() => {
    if (popupId) {
      window.electron.popup.close(popupId)
    }
  }, [popupId])

  // Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleClose])

  // 接着对话
  const handleContinueInChat = useCallback(() => {
    if (targetText && content) {
      window.electron.popup.continueInChat(targetText, content)
      handleClose()
    }
  }, [targetText, content, handleClose])

  // Display content with loading cursor
  const displayContent = useMemo(() => {
    if (!content) return ''
    const trimmed = content.trim()
    return isLoading ? trimmed + ' ▊' : trimmed
  }, [content, isLoading])

  if (!popupId) {
    return (
      <div className="h-screen flex items-center justify-center text-[var(--color-muted)]">
        {t.ui.noPopupId}
      </div>
    )
  }

  return (
    <div className={`h-screen flex flex-col ${isDark ? 'bg-[#1F1F1F]' : 'bg-white'}`}>
      {/* Title bar / drag region - 使用系统标题栏关闭按钮 */}
      <div
        className="h-7 flex items-center justify-center shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="text-xs text-[var(--color-muted)] font-medium truncate max-w-[80%]">
          {actionName || t.ai.title}
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto px-4 py-2 min-h-0">
        {content ? (
          <div className={`ai-popup-markdown ${AI_POPUP_WINDOW_PROSE}`}>
            <Streamdown remarkPlugins={REMARK_PLUGINS}>
              {displayContent}
            </Streamdown>
          </div>
        ) : isLoading ? (
          <div className="text-sm text-[var(--color-muted)] flex items-center gap-2">
            <span className="inline-block w-1 h-1 bg-current rounded-full animate-pulse" />
            {t.common.loading}
          </div>
        ) : (
          <div className="text-sm text-[var(--color-muted)]">
            {t.ui.noContent}
          </div>
        )}
      </div>

      {/* 接着对话按钮 - 右下角浮动 */}
      {content && targetText && (
        <div className="absolute bottom-2 right-2">
          <button
            onClick={handleContinueInChat}
            onMouseEnter={() => setShowContinueTooltip(true)}
            onMouseLeave={() => setShowContinueTooltip(false)}
            disabled={isLoading && !content}
            className="p-1.5 rounded-lg bg-[var(--color-card)] border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)] shadow-sm transition-all disabled:opacity-50"
          >
            <MessageSquare size={14} />
          </button>
          {/* Tooltip */}
          {showContinueTooltip && (
            <div className="absolute bottom-full right-0 mb-1.5 px-2 py-1 text-xs text-white bg-gray-800 dark:bg-gray-700 rounded shadow-lg whitespace-nowrap">
              {t.contextMenu.aiContinueInChat}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
