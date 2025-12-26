/**
 * AICustomInput - A small input popup for custom AI prompts
 *
 * Appears near the selection when user clicks "Custom prompt..."
 * Supports Enter to submit, Escape to cancel.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslations } from '../i18n'

interface AICustomInputProps {
  position: { x: number; y: number }
  onSubmit: (prompt: string) => void
  onClose: () => void
}

export function AICustomInput({ position, onSubmit, onClose }: AICustomInputProps) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const t = useTranslations()

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Adjust position to stay within viewport
  const adjustedPosition = { ...position }
  const inputWidth = 280
  const inputHeight = 80

  if (adjustedPosition.x + inputWidth > window.innerWidth) {
    adjustedPosition.x = window.innerWidth - inputWidth - 10
  }
  if (adjustedPosition.y + inputHeight > window.innerHeight) {
    adjustedPosition.y = window.innerHeight - inputHeight - 10
  }
  if (adjustedPosition.x < 10) {
    adjustedPosition.x = 10
  }
  if (adjustedPosition.y < 10) {
    adjustedPosition.y = 10
  }

  // Handle submit
  const handleSubmit = useCallback(() => {
    const trimmed = value.trim()
    if (trimmed) {
      onSubmit(trimmed)
    }
  }, [value, onSubmit])

  // Handle key down
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }, [handleSubmit, onClose])

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    // Delay to prevent immediate close
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 100)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [onClose])

  return (
    <div
      ref={containerRef}
      className="ai-custom-input"
      style={{
        position: 'fixed',
        left: adjustedPosition.x,
        top: adjustedPosition.y,
        zIndex: 10001
      }}
    >
      <div className="ai-custom-input-label">
        {t.contextMenu.aiCustomPlaceholder}
      </div>
      <div className="ai-custom-input-row">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t.contextMenu.aiCustomPlaceholder}
          className="ai-custom-input-field"
        />
        <button
          onClick={handleSubmit}
          disabled={!value.trim()}
          className="ai-custom-input-submit"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  )
}
