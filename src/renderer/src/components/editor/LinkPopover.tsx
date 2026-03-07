import { useState, useEffect, useRef, useCallback } from 'react'
import {
  useFloating,
  offset,
  flip,
  shift,
  autoUpdate,
  FloatingPortal,
} from '@floating-ui/react'
import type { Editor } from '@tiptap/react'
import { useTranslations } from '../../i18n'

interface LinkPopoverProps {
  editor: Editor
  anchorEl: HTMLElement | null
  href: string
  /** Start in edit mode (URL input) */
  editMode?: boolean
  /** Whether this popover was triggered by hover (auto-close on mouse leave) */
  isHover?: boolean
  /** Saved editor selection range (captured before focus was lost) */
  savedSelection?: { from: number; to: number } | null
  onHoverEnter?: () => void
  onHoverLeave?: () => void
  onClose: () => void
}

export function LinkPopover({
  editor,
  anchorEl,
  href,
  editMode = false,
  isHover = false,
  savedSelection,
  onHoverEnter,
  onHoverLeave,
  onClose,
}: LinkPopoverProps) {
  const t = useTranslations()
  const [isEditing, setIsEditing] = useState(editMode)
  const [url, setUrl] = useState(href)
  const inputRef = useRef<HTMLInputElement>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)

  const { refs, floatingStyles } = useFloating({
    placement: 'bottom',
    middleware: [
      offset(6),
      flip({ fallbackPlacements: ['top', 'bottom-start', 'top-start'] }),
      shift({ padding: 8 }),
    ],
    whileElementsMounted: autoUpdate,
  })

  useEffect(() => {
    if (anchorEl) {
      refs.setReference(anchorEl)
    }
  }, [anchorEl, refs])

  // Reset state when href changes
  useEffect(() => {
    setUrl(href)
    setIsEditing(editMode)
  }, [href, editMode])

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing) {
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [isEditing])

  // Close on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Close on click outside
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleMouseDown)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleMouseDown)
    }
  }, [onClose])

  const handlePopoverMouseEnter = useCallback(() => {
    if (isHover && !isEditing) {
      onHoverEnter?.()
    }
  }, [isEditing, isHover, onHoverEnter])

  const handlePopoverMouseLeave = useCallback(() => {
    if (isHover && !isEditing) {
      onHoverLeave?.()
    }
  }, [isHover, isEditing, onHoverLeave])

  // Position cursor inside the link before operating on it
  const focusOnLink = useCallback(() => {
    if (!anchorEl) return
    const pos = editor.view.posAtDOM(anchorEl, 0)
    if (pos >= 0) {
      editor.commands.setTextSelection(pos)
    }
  }, [editor, anchorEl])

  const handleSave = useCallback(() => {
    const trimmed = url.trim()
    if (!trimmed) {
      // Empty URL = remove link
      focusOnLink()
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      onClose()
      return
    }

    let didSave = false

    if (savedSelection && savedSelection.from !== savedSelection.to) {
      didSave = editor.chain().setTextSelection(savedSelection).setLink({ href: trimmed }).run()
      if (didSave) {
        editor.commands.focus()
      }
    } else {
      // Cursor on existing link - update it
      focusOnLink()
      didSave = editor.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run()
    }

    if (didSave) {
      onClose()
    }
  }, [editor, url, onClose, focusOnLink, savedSelection])

  const handleRemoveLink = useCallback(() => {
    // Position cursor inside the link first (hover popover may not have cursor on link)
    focusOnLink()
    editor.chain().focus().extendMarkRange('link').unsetLink().run()
    onClose()
  }, [editor, onClose, focusOnLink])

  const handleOpenExternal = useCallback(() => {
    if (href) {
      window.electron.shell.openExternal(href)
    }
    onClose()
  }, [href, onClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }, [handleSave, onClose])

  // Truncate URL for display
  const displayUrl = href.length > 50 ? href.substring(0, 47) + '...' : href

  return (
    <FloatingPortal>
      <div
        ref={(el) => {
          popoverRef.current = el
          refs.setFloating(el)
        }}
        style={floatingStyles}
        className="link-popover"
        onMouseEnter={handlePopoverMouseEnter}
        onMouseLeave={handlePopoverMouseLeave}
      >
        {isEditing ? (
          <div className="link-popover-edit">
            <input
              ref={inputRef}
              type="text"
              className="link-popover-input"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t.contextMenu.linkUrlPlaceholder}
            />
            <button
              className="link-popover-cancel-btn"
              onClick={onClose}
              title="Escape"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            <button
              className="link-popover-save-btn"
              onClick={handleSave}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </button>
          </div>
        ) : (
          <div className="link-popover-preview">
            <span className="link-popover-url" title={href}>{displayUrl}</span>
            <div className="link-popover-actions">
              <button
                className="link-popover-btn"
                onClick={() => setIsEditing(true)}
                title={t.contextMenu.editLink}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
              <button
                className="link-popover-btn"
                onClick={handleOpenExternal}
                title={t.contextMenu.openLink}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </button>
              <button
                className="link-popover-btn link-popover-btn-danger"
                onClick={handleRemoveLink}
                title={t.contextMenu.removeLink}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m18.84 12.25 1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="m5.17 11.75-1.71 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  <line x1="8" y1="2" x2="8" y2="5" />
                  <line x1="2" y1="8" x2="5" y2="8" />
                  <line x1="16" y1="19" x2="16" y2="22" />
                  <line x1="19" y1="16" x2="22" y2="16" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>
    </FloatingPortal>
  )
}
