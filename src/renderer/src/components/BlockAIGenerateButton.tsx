/**
 * BlockAIGenerateButton
 *
 * Reusable AI generation button for block-level content.
 * Shows a star icon that opens a popover with an input field.
 * Used by Mermaid, Dataview, Math blocks, etc.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { useBlockAIGenerate, type BlockType } from '../hooks/useBlockAIGenerate'
import { useI18n } from '../i18n/context'

interface BlockAIGenerateButtonProps {
  blockType: BlockType
  currentContent: string
  onGenerated: (content: string) => void
  placeholder?: string
  className?: string
}

export function BlockAIGenerateButton({
  blockType,
  currentContent,
  onGenerated,
  placeholder,
  className = ''
}: BlockAIGenerateButtonProps) {
  const { t } = useI18n()
  const [isOpen, setIsOpen] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const { generate, isGenerating, streamedContent, cancel } = useBlockAIGenerate({
    onComplete: (result) => {
      onGenerated(result)
      setIsOpen(false)
      setInputValue('')
    },
    onError: (error) => {
      console.error('[BlockAIGenerate] Error:', error)
    }
  })

  // Focus input when popover opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  // Close popover when clicking outside
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        if (!isGenerating) {
          setIsOpen(false)
        }
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, isGenerating])

  const handleSubmit = useCallback(() => {
    if (!inputValue.trim() || isGenerating) return
    generate(blockType, inputValue, currentContent)
  }, [inputValue, isGenerating, generate, blockType, currentContent])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    } else if (e.key === 'Escape') {
      if (isGenerating) {
        cancel()
      } else {
        setIsOpen(false)
      }
    }
  }

  const defaultPlaceholder = t.ai?.generatePlaceholder || 'Describe what you want to generate...'

  return (
    <div className={`block-ai-generate ${className}`}>
      <button
        ref={buttonRef}
        className="block-ai-generate-btn"
        onClick={() => setIsOpen(!isOpen)}
        title={t.ai?.generate || 'AI Generate'}
        disabled={isGenerating}
      >
        {isGenerating ? (
          <span className="block-ai-generate-spinner" />
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2l2.4 7.4H22l-6 4.6 2.3 7L12 17l-6.3 4 2.3-7-6-4.6h7.6L12 2z" />
          </svg>
        )}
      </button>

      {isOpen && (
        <div ref={popoverRef} className="block-ai-generate-popover">
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder || defaultPlaceholder}
            className="block-ai-generate-input"
            rows={2}
            disabled={isGenerating}
          />
          {isGenerating && streamedContent && (
            <div className="block-ai-generate-preview">
              <pre>{streamedContent}</pre>
            </div>
          )}
          <div className="block-ai-generate-actions">
            <button
              className="block-ai-generate-cancel"
              onClick={() => {
                if (isGenerating) {
                  cancel()
                } else {
                  setIsOpen(false)
                }
              }}
            >
              {t.actions?.cancel || 'Cancel'}
            </button>
            <button
              className="block-ai-generate-submit"
              onClick={handleSubmit}
              disabled={!inputValue.trim() || isGenerating}
            >
              {t.ai?.generate || 'Generate'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
