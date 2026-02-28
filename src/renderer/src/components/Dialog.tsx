import { useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'

interface DialogProps {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  maxWidth?: string
  ariaLabel: string
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Dialog({ open, onClose, children, maxWidth = 'max-w-sm', ariaLabel }: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  // Escape key
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  // Focus management: trap focus + auto-focus first element
  const handleFocusTrap = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'Tab' || !dialogRef.current) return
    const focusable = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }, [])

  useEffect(() => {
    if (!open) return
    document.addEventListener('keydown', handleFocusTrap)
    // Auto-focus: if no child has autoFocus, focus first focusable element
    requestAnimationFrame(() => {
      if (!dialogRef.current) return
      // Skip if something inside already has focus (e.g. autoFocus input)
      if (dialogRef.current.contains(document.activeElement)) return
      const first = dialogRef.current.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      first?.focus()
    })
    return () => document.removeEventListener('keydown', handleFocusTrap)
  }, [open, handleFocusTrap])

  if (!open) return null

  return createPortal(
    <>
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[1000]"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className={`fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full ${maxWidth} bg-[var(--color-card)] rounded-xl shadow-[var(--shadow-elevated)] overflow-hidden z-[1001]`}
      >
        {children}
      </div>
    </>,
    document.body
  )
}
