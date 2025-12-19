/**
 * TypewriterToolbar - 打字机模式底部工具栏
 *
 * 功能：字数统计、全屏切换、退出按钮
 * 交互：鼠标靠近底部显示，5秒无操作或移出区域后隐藏
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslations } from '../i18n'

// ==================== 图标 ====================

const Icons = {
  fullscreen: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  ),
  exitFullscreen: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 14 10 14 10 20" />
      <polyline points="20 10 14 10 14 4" />
      <line x1="14" y1="10" x2="21" y2="3" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  ),
  exit: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
}

// ==================== 常量 ====================

const TRIGGER_ZONE_HEIGHT = 150 // 底部触发区域高度（px）
const AUTO_HIDE_DELAY = 5000    // 自动隐藏延迟（ms）

// ==================== 类型 ====================

interface TypewriterToolbarProps {
  wordCount: number
  selectedWordCount: number | null
  onToggleFullscreen: () => void
  onExit: () => void
  isFullscreen: boolean
}

// ==================== 组件 ====================

export function TypewriterToolbar({
  wordCount,
  selectedWordCount,
  onToggleFullscreen,
  onExit,
  isFullscreen,
}: TypewriterToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null)
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const [isVisible, setIsVisible] = useState(false)
  const t = useTranslations()

  // 重置隐藏计时器
  const resetHideTimer = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current)
    }
    hideTimeoutRef.current = setTimeout(() => {
      setIsVisible(false)
    }, AUTO_HIDE_DELAY)
  }, [])

  // 监听鼠标位置
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const isInTriggerZone = e.clientY > window.innerHeight - TRIGGER_ZONE_HEIGHT

      if (isInTriggerZone) {
        setIsVisible(true)
        resetHideTimer()
      } else {
        if (hideTimeoutRef.current) {
          clearTimeout(hideTimeoutRef.current)
        }
        setIsVisible(false)
      }
    }

    window.addEventListener('mousemove', handleMouseMove)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current)
      }
    }
  }, [resetHideTimer])

  const handleMouseEnter = useCallback(() => {
    setIsVisible(true)
    resetHideTimer()
  }, [resetHideTimer])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
  }, [])

  return (
    <div
      className={`typewriter-toolbar ${isVisible ? 'visible' : ''}`}
      ref={toolbarRef}
      onMouseDown={handleMouseDown}
      onMouseEnter={handleMouseEnter}
      onMouseMove={resetHideTimer}
    >
      <div className="typewriter-toolbar-inner">
        <div className="typewriter-toolbar-left">
          <span className="typewriter-wordcount">
            {selectedWordCount !== null
              ? `${selectedWordCount} / ${wordCount} ${t.typewriter.wordCount}`
              : `${wordCount} ${t.typewriter.wordCount}`
            }
          </span>
        </div>

        <div className="typewriter-toolbar-right">
          <button
            className="typewriter-toolbar-btn"
            onClick={onToggleFullscreen}
            title={isFullscreen ? t.typewriter.window : t.typewriter.fullscreen}
          >
            <span className="toolbar-icon">{isFullscreen ? Icons.exitFullscreen : Icons.fullscreen}</span>
            <span className="toolbar-label">{isFullscreen ? t.typewriter.window : t.typewriter.fullscreen}</span>
          </button>

          <button
            className="typewriter-toolbar-btn typewriter-toolbar-exit"
            onClick={onExit}
            title={`${t.typewriter.exit} (ESC)`}
          >
            <span className="toolbar-icon">{Icons.exit}</span>
            <span className="toolbar-label">{t.typewriter.exit}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
