/**
 * AIExplainPopup - A floating popup for AI explanations
 *
 * Features:
 * - Draggable within the window
 * - Resizable by dragging edges
 * - Size and position persisted to localStorage
 * - Close button in top right (overlay style)
 * - Streaming markdown content
 * - Selectable text for copying
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useTranslations } from '../i18n'
import { Streamdown } from 'streamdown'
import remarkGfm from 'remark-gfm'
import { type AIContext, formatAIPrompt } from '../utils/aiContext'
import { getAIErrorCode, getAIErrorMessage } from '../utils/aiErrors'

// Memoize remarkPlugins to prevent Streamdown re-renders
const REMARK_PLUGINS = [remarkGfm]

const STORAGE_KEY = 'ai-explain-popup'
const DEFAULT_WIDTH = 360
const DEFAULT_HEIGHT = 300
const MIN_WIDTH = 280
const MIN_HEIGHT = 200
const MAX_WIDTH = 600
const MAX_HEIGHT = 500

interface StreamEvent {
  type: 'text' | 'thinking' | 'tool_call' | 'tool_result' | 'done' | 'error' | 'interrupt'
  content?: string
  error?: string
}

interface AIExplainPopupProps {
  position: { x: number; y: number }
  context: AIContext
  prompt: string
  onClose: () => void
  onContinueInChat?: (selectedText: string, explanation: string) => void
}

interface SavedState {
  width: number
  height: number
  positionPercent?: { x: number; y: number }
}

function loadSavedState(): SavedState | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return JSON.parse(saved)
  } catch {}
  return null
}

function saveState(state: SavedState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {}
}

export function AIExplainPopup({ position, context, prompt, onClose, onContinueInChat }: AIExplainPopupProps) {
  const [content, setContent] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const hasStartedRef = useRef(false) // Prevent duplicate stream starts
  const t = useTranslations()

  // Size state
  const savedState = useMemo(() => loadSavedState(), [])
  const [size, setSize] = useState({
    width: savedState?.width || DEFAULT_WIDTH,
    height: savedState?.height || DEFAULT_HEIGHT
  })

  // Dragging state
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const hasDraggedRef = useRef(false) // Track if actual drag movement occurred
  // Initialize position: use saved percentage position if exists, otherwise near cursor/selection
  const [popupPosition, setPopupPosition] = useState(() => {
    const w = savedState?.width || DEFAULT_WIDTH
    const h = savedState?.height || DEFAULT_HEIGHT

    let x: number, y: number

    if (savedState?.positionPercent) {
      // Restore from saved percentage position
      x = (savedState.positionPercent.x / 100) * window.innerWidth
      y = (savedState.positionPercent.y / 100) * window.innerHeight
    } else {
      // Default: position near cursor/selection
      x = position.x
      y = position.y
    }

    // Keep within viewport
    if (x + w > window.innerWidth - 10) x = window.innerWidth - w - 10
    if (y + h > window.innerHeight - 10) y = window.innerHeight - h - 10
    if (x < 10) x = 10
    if (y < 10) y = 10

    return { x, y }
  })

  // Resizing state
  const [isResizing, setIsResizing] = useState<string | null>(null) // 'e', 'w', 's', 'n', 'se', 'sw', 'ne', 'nw'
  const resizeStartRef = useRef({ x: 0, y: 0, width: 0, height: 0, left: 0, top: 0 })

  // Hover state for tooltips
  const [showContinueTooltip, setShowContinueTooltip] = useState(false)
  const [showDragTooltip, setShowDragTooltip] = useState(false)

  // Calculate default position near cursor/selection
  const getDefaultPosition = useCallback(() => {
    let x = position.x
    let y = position.y + 5

    // Keep within viewport
    if (x + size.width > window.innerWidth - 10) x = window.innerWidth - size.width - 10
    if (y + size.height > window.innerHeight - 10) y = position.y - size.height - 5
    if (x < 10) x = 10
    if (y < 10) y = 10

    return { x, y }
  }, [position, size])

  // Reset to default position (near cursor/selection)
  const resetToDefaultPosition = useCallback(() => {
    const defaultPos = getDefaultPosition()
    setPopupPosition(defaultPos)
    // Clear saved position so next time it uses cursor position
    const saved = loadSavedState()
    if (saved) {
      saveState({ width: saved.width, height: saved.height, positionPercent: undefined })
    }
  }, [getDefaultPosition])

  // Save state when size or position changes
  const saveCurrentState = useCallback(() => {
    const positionPercent = {
      x: (popupPosition.x / window.innerWidth) * 100,
      y: (popupPosition.y / window.innerHeight) * 100
    }
    saveState({ width: size.width, height: size.height, positionPercent })
  }, [size, popupPosition])

  // Handle drag - only from drag handle
  const handleDragHandleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    hasDraggedRef.current = false // Reset drag tracking
    setIsDragging(true)
    setDragOffset({
      x: e.clientX - popupPosition.x,
      y: e.clientY - popupPosition.y
    })
  }, [popupPosition])

  // Handle click on drag handle - reset only if no drag occurred
  const handleDragHandleClick = useCallback(() => {
    if (!hasDraggedRef.current) {
      resetToDefaultPosition()
    }
  }, [resetToDefaultPosition])

  // Handle resize start
  const handleResizeStart = useCallback((e: React.MouseEvent, direction: string) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizing(direction)
    resizeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      width: size.width,
      height: size.height,
      left: popupPosition.x,
      top: popupPosition.y
    }
  }, [size, popupPosition])

  // Handle drag and resize
  useEffect(() => {
    if (!isDragging && !isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        hasDraggedRef.current = true // Mark that actual drag movement occurred
        let newX = e.clientX - dragOffset.x
        let newY = e.clientY - dragOffset.y

        // Keep within viewport
        if (newX < 0) newX = 0
        if (newY < 0) newY = 0
        if (newX + size.width > window.innerWidth) newX = window.innerWidth - size.width
        if (newY + size.height > window.innerHeight) newY = window.innerHeight - size.height

        setPopupPosition({ x: newX, y: newY })
      }

      if (isResizing) {
        const start = resizeStartRef.current
        const deltaX = e.clientX - start.x
        const deltaY = e.clientY - start.y

        let newWidth = start.width
        let newHeight = start.height
        let newLeft = start.left
        let newTop = start.top

        // Handle horizontal resize
        if (isResizing.includes('e')) {
          newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, start.width + deltaX))
        }
        if (isResizing.includes('w')) {
          const widthDelta = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, start.width - deltaX)) - start.width
          newWidth = start.width + widthDelta
          newLeft = start.left - widthDelta
        }

        // Handle vertical resize
        if (isResizing.includes('s')) {
          newHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, start.height + deltaY))
        }
        if (isResizing.includes('n')) {
          const heightDelta = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, start.height - deltaY)) - start.height
          newHeight = start.height + heightDelta
          newTop = start.top - heightDelta
        }

        // Keep within viewport
        if (newLeft < 0) { newWidth += newLeft; newLeft = 0 }
        if (newTop < 0) { newHeight += newTop; newTop = 0 }
        if (newLeft + newWidth > window.innerWidth) newWidth = window.innerWidth - newLeft
        if (newTop + newHeight > window.innerHeight) newHeight = window.innerHeight - newTop

        setSize({ width: newWidth, height: newHeight })
        setPopupPosition({ x: newLeft, y: newTop })
      }
    }

    const handleMouseUp = () => {
      if (isDragging || isResizing) {
        saveCurrentState()
      }
      setIsDragging(false)
      setIsResizing(null)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, isResizing, dragOffset, size, saveCurrentState])

  // Convert technical errors to user-friendly messages
  const getErrorMessage = useCallback((err: unknown): string => {
    return getAIErrorMessage(getAIErrorCode(err), t)
  }, [t])

  // Start streaming on mount (only once)
  useEffect(() => {
    // Prevent duplicate stream starts
    if (hasStartedRef.current) return
    hasStartedRef.current = true

    const streamId = crypto.randomUUID()
    let accumulated = ''

    const startStream = async () => {
      try {
        await window.electron.chat.acquireReconnect()

        const cleanup = window.electron.chat.onStreamEvent((sid: string, rawEvent: unknown) => {
          if (sid !== streamId) return
          const event = rawEvent as StreamEvent

          if (event.type === 'text' && event.content) {
            accumulated += event.content
            setContent(accumulated)
          }

          if (event.type === 'done') {
            setIsLoading(false)
            cleanup()
            cleanupRef.current = null
            window.electron.chat.releaseReconnect()
          }

          if (event.type === 'error') {
            setIsLoading(false)
            setError(getErrorMessage(event.error))
            cleanup()
            cleanupRef.current = null
            window.electron.chat.releaseReconnect()
          }
        })

        if (typeof cleanup === 'function') {
          cleanupRef.current = cleanup
        }

        const { prompt: fullPrompt } = formatAIPrompt(context, prompt)
        await window.electron.chat.stream({
          streamId,
          agentId: 'writing',
          messages: [
            { role: 'user', content: fullPrompt }
          ]
        })
      } catch (err) {
        setIsLoading(false)
        setError(getErrorMessage(err))
        window.electron.chat.releaseReconnect()
      }
    }

    startStream()

    return () => {
      if (cleanupRef.current) {
        cleanupRef.current()
        cleanupRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run once on mount

  // Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Handle continue in chat
  const handleContinueInChat = useCallback(() => {
    onContinueInChat?.(context.target, content)
    onClose()
  }, [context.target, content, onContinueInChat, onClose])

  // Memoize display content
  const displayContent = useMemo(() => {
    if (!content) return ''
    return isLoading ? content + ' ▊' : content
  }, [content, isLoading])

  // Cursor style based on resize direction
  const getCursor = () => {
    if (isDragging) return 'grabbing'
    if (isResizing) {
      if (isResizing === 'e' || isResizing === 'w') return 'ew-resize'
      if (isResizing === 'n' || isResizing === 's') return 'ns-resize'
      if (isResizing === 'nw' || isResizing === 'se') return 'nwse-resize'
      if (isResizing === 'ne' || isResizing === 'sw') return 'nesw-resize'
    }
    return undefined
  }

  return (
    <div
      ref={containerRef}
      className="fixed z-[10001] bg-[var(--color-card)] rounded-xl shadow-[var(--shadow-elevated)] border border-[var(--color-border)] flex flex-col overflow-hidden"
      style={{
        left: popupPosition.x,
        top: popupPosition.y,
        width: size.width,
        height: size.height,
        cursor: isResizing ? getCursor() : undefined,
      }}
    >
      {/* Resize handles */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Edges */}
        <div className="absolute top-0 left-2 right-2 h-1.5 cursor-ns-resize pointer-events-auto" onMouseDown={e => handleResizeStart(e, 'n')} />
        <div className="absolute bottom-0 left-2 right-2 h-1.5 cursor-ns-resize pointer-events-auto" onMouseDown={e => handleResizeStart(e, 's')} />
        <div className="absolute left-0 top-2 bottom-2 w-1.5 cursor-ew-resize pointer-events-auto" onMouseDown={e => handleResizeStart(e, 'w')} />
        <div className="absolute right-0 top-2 bottom-2 w-1.5 cursor-ew-resize pointer-events-auto" onMouseDown={e => handleResizeStart(e, 'e')} />
        {/* Corners */}
        <div className="absolute top-0 left-0 w-3 h-3 cursor-nwse-resize pointer-events-auto" onMouseDown={e => handleResizeStart(e, 'nw')} />
        <div className="absolute top-0 right-0 w-3 h-3 cursor-nesw-resize pointer-events-auto" onMouseDown={e => handleResizeStart(e, 'ne')} />
        <div className="absolute bottom-0 left-0 w-3 h-3 cursor-nesw-resize pointer-events-auto" onMouseDown={e => handleResizeStart(e, 'sw')} />
        <div className="absolute bottom-0 right-0 w-3 h-3 cursor-nwse-resize pointer-events-auto" onMouseDown={e => handleResizeStart(e, 'se')} />
      </div>

      {/* Header buttons - overlay style */}
      <div className="absolute top-1.5 right-1.5 z-10 flex items-center gap-0.5">
        {/* Drag handle */}
        <div
          onMouseDown={handleDragHandleMouseDown}
          onClick={handleDragHandleClick}
          onMouseEnter={() => setShowDragTooltip(true)}
          onMouseLeave={() => setShowDragTooltip(false)}
          className={`relative p-1 rounded-md text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-black/5 dark:hover:bg-white/10 transition-colors ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="9" cy="6" r="1.5"/>
            <circle cx="15" cy="6" r="1.5"/>
            <circle cx="9" cy="12" r="1.5"/>
            <circle cx="15" cy="12" r="1.5"/>
            <circle cx="9" cy="18" r="1.5"/>
            <circle cx="15" cy="18" r="1.5"/>
          </svg>
          {/* Tooltip */}
          {showDragTooltip && !isDragging && (
            <div className="absolute top-full right-0 mt-1.5 px-2 py-1 text-xs text-white bg-gray-800 dark:bg-gray-700 rounded shadow-lg whitespace-nowrap">
              {t.ui.dragToMove} · {t.ui.clickToReset}
            </div>
          )}
        </div>
        {/* Close button */}
        <button
          onClick={onClose}
          className="p-1 rounded-md text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Content - full area, scrollable */}
      <div className="flex-1 overflow-y-auto px-3 py-2 min-h-0 cursor-text">
        {error ? (
          <div className="text-sm text-red-500">{error}</div>
        ) : content ? (
          <div className="ai-popup-markdown prose prose-sm max-w-none text-[var(--color-text)]
            prose-p:my-1 prose-p:leading-relaxed prose-p:text-[13px]
            prose-ul:my-1 prose-ul:pl-4 prose-ul:text-[13px]
            prose-ol:my-1 prose-ol:pl-4 prose-ol:text-[13px]
            prose-li:my-0.5 prose-li:leading-snug
            prose-code:px-1 prose-code:py-0.5 prose-code:bg-black/5 dark:prose-code:bg-white/10 prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none
            prose-pre:my-1 prose-pre:p-2 prose-pre:bg-black/5 dark:prose-pre:bg-white/10 prose-pre:rounded-lg prose-pre:text-xs
            prose-headings:my-1 prose-headings:font-semibold
            prose-h1:text-sm prose-h2:text-sm prose-h3:text-[13px]
            prose-blockquote:my-1 prose-blockquote:pl-3 prose-blockquote:border-l-2 prose-blockquote:border-[var(--color-accent)] prose-blockquote:italic prose-blockquote:text-[13px]
            prose-strong:font-semibold
            prose-a:text-[var(--color-accent)] prose-a:no-underline hover:prose-a:underline
          ">
            <Streamdown remarkPlugins={REMARK_PLUGINS}>
              {displayContent}
            </Streamdown>
          </div>
        ) : isLoading ? (
          <div className="text-sm text-[var(--color-muted)] flex items-center gap-2">
            <span className="inline-block w-1 h-1 bg-current rounded-full animate-pulse" />
            {t.contextMenu.aiProcessing}
          </div>
        ) : null}
      </div>

      {/* Continue in chat - floating at bottom right with tooltip */}
      {content && (
        <div className="absolute bottom-2 right-2">
          <button
            onClick={handleContinueInChat}
            onMouseEnter={() => setShowContinueTooltip(true)}
            onMouseLeave={() => setShowContinueTooltip(false)}
            disabled={isLoading && !content}
            className="p-1.5 rounded-lg bg-[var(--color-card)] border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)] shadow-sm transition-all disabled:opacity-50"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
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
