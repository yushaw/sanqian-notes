/**
 * Select - Unified dropdown component with Portal rendering
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'

export interface SelectOption {
  value: string
  label: string
  description?: string
}

interface SelectProps {
  options: SelectOption[]
  value: string | null
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
}

export function Select({ options, value, onChange, disabled, placeholder = '-' }: SelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, bottom: 0, left: 0, width: 0, openUpward: false })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const selectedOption = options.find((o) => o.value === value)

  // Calculate dropdown position with viewport boundary detection
  const updatePosition = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      const dropdownMaxHeight = 240 // max-h-60 = 15rem ≈ 240px
      const spacing = 4

      // 计算上下可用空间
      const spaceBelow = window.innerHeight - rect.bottom - spacing
      const spaceAbove = rect.top - spacing

      // 优先向下展开，空间不足时向上展开
      const openUpward = spaceBelow < dropdownMaxHeight && spaceAbove > spaceBelow

      setPosition({
        top: openUpward ? 0 : rect.bottom + spacing,
        bottom: openUpward ? window.innerHeight - rect.top + spacing : 0,
        left: rect.left,
        width: Math.max(rect.width, 200), // min width 200px
        openUpward,
      })
    }
  }, [])

  // Open dropdown
  const handleOpen = useCallback(() => {
    if (disabled) return
    updatePosition()
    setIsOpen(true)
  }, [disabled, updatePosition])

  // Close dropdown when clicking outside (use capture phase to bypass stopPropagation)
  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      const clickedTrigger = triggerRef.current?.contains(target)
      const clickedDropdown = dropdownRef.current?.contains(target)
      if (!clickedTrigger && !clickedDropdown) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside, true)
    return () => document.removeEventListener('mousedown', handleClickOutside, true)
  }, [isOpen])

  // Close on escape
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  // Update position on scroll/resize
  useEffect(() => {
    if (!isOpen) return
    const handleUpdate = () => updatePosition()
    window.addEventListener('scroll', handleUpdate, true)
    window.addEventListener('resize', handleUpdate)
    return () => {
      window.removeEventListener('scroll', handleUpdate, true)
      window.removeEventListener('resize', handleUpdate)
    }
  }, [isOpen, updatePosition])

  return (
    <>
      {/* Trigger button */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => isOpen ? setIsOpen(false) : handleOpen()}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className="flex-1 flex items-center justify-between bg-transparent text-[var(--color-text)] font-medium focus:outline-none cursor-pointer text-left disabled:opacity-50 disabled:cursor-not-allowed"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <span className="truncate">{selectedOption?.label || placeholder}</span>
        <svg
          className={`w-3 h-3 ml-1 text-[var(--color-muted)] flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown with Portal */}
      {isOpen && createPortal(
        <div
          ref={dropdownRef}
          role="listbox"
          className="fixed bg-[var(--color-card)] rounded-lg shadow-lg border border-black/10 dark:border-white/10 overflow-hidden py-1 max-h-60 overflow-y-auto"
          style={{
            ...(position.openUpward
              ? { bottom: position.bottom }
              : { top: position.top }),
            left: position.left,
            width: position.width,
            zIndex: 9999,
          }}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => {
                onChange(option.value)
                setIsOpen(false)
              }}
              className={`w-full px-3 py-1.5 text-left transition-colors ${
                option.value === value
                  ? 'bg-[var(--color-accent)]/10'
                  : 'hover:bg-black/5 dark:hover:bg-white/5'
              }`}
            >
              <div className={`text-[13px] ${
                option.value === value ? 'text-[var(--color-accent)] font-medium' : 'text-[var(--color-text)]'
              }`}>
                {option.label}
              </div>
              {option.description && (
                <div className="text-[11px] text-[var(--color-muted)] truncate">
                  {option.description}
                </div>
              )}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  )
}

export default Select
