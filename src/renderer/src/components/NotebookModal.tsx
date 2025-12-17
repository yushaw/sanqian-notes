import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { EmojiPicker } from 'frimousse'
import { useTranslations } from '../i18n'
import type { Notebook } from '../types/note'
import notesLogo from '../assets/notes-logo.png'
import todolistLogo from '../assets/todolist-logo.png'
import sanqianLogo from '../assets/sanqian-logo.svg'
import yinianLogo from '../assets/yinian-logo.svg'

// Simple Plus icon component
function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

interface NotebookModalProps {
  notebook?: Notebook | null  // null = create new, existing = edit
  onSave: (data: { name: string; icon: string }) => void
  onDelete?: () => void
  onClose: () => void
}

// Logo-based icons with special identifiers
const LOGO_ICONS = [
  { id: 'notes', src: notesLogo, alt: 'Notes' },
  { id: 'todolist', src: todolistLogo, alt: 'Todolist' },
  { id: 'sanqian', src: sanqianLogo, alt: 'Sanqian' },
  { id: 'yinian', src: yinianLogo, alt: 'Yinian' },
]

export function NotebookModal({ notebook, onSave, onDelete, onClose }: NotebookModalProps) {
  const t = useTranslations()
  const [name, setName] = useState(notebook?.name || '')
  // Store selected icon: either a logo id (prefixed with 'logo:') or an emoji
  const [selectedIcon, setSelectedIcon] = useState(notebook?.icon || 'logo:notes')
  // Custom emoji selected from picker (shown in + button position)
  const [customEmoji, setCustomEmoji] = useState<string | null>(null)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  const pickerButtonRef = useRef<HTMLButtonElement>(null)
  const [pickerPosition, setPickerPosition] = useState({ top: 0, left: 0 })

  const isEditing = !!notebook

  // Focus input when dialog opens and initialize state
  useEffect(() => {
    if (notebook) {
      // Edit mode: initialize with existing values
      setName(notebook.name)
      setSelectedIcon(notebook.icon || 'logo:notes')
      // If the icon is not a logo, set it as custom emoji
      if (notebook.icon && !notebook.icon.startsWith('logo:')) {
        setCustomEmoji(notebook.icon)
      } else {
        setCustomEmoji(null)
      }
    } else {
      // Create mode: reset to defaults
      setName('')
      setSelectedIcon('logo:notes')
      setCustomEmoji(null)
    }
    setShowEmojiPicker(false)
    setTimeout(() => inputRef.current?.focus(), 100)
  }, [notebook])

  // Close emoji picker on click outside
  useEffect(() => {
    if (!showEmojiPicker) return
    const handleClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showEmojiPicker])

  // ESC key to close (but not when emoji picker is open)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showEmojiPicker) {
          // Close emoji picker first
          setShowEmojiPicker(false)
        } else {
          onClose()
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, showEmojiPicker])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (name.trim()) {
      onSave({ name: name.trim(), icon: selectedIcon })
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (name.trim()) {
        onSave({ name: name.trim(), icon: selectedIcon })
      }
    }
  }

  const handleLogoSelect = (logoId: string) => {
    setSelectedIcon(`logo:${logoId}`)
  }

  const handleCustomEmojiClick = () => {
    // Calculate position and toggle the picker
    if (pickerButtonRef.current) {
      const rect = pickerButtonRef.current.getBoundingClientRect()
      setPickerPosition({
        top: rect.bottom + 8,
        left: rect.left,
      })
    }
    setShowEmojiPicker(!showEmojiPicker)
  }

  const handleEmojiSelect = (emoji: string) => {
    setCustomEmoji(emoji)
    setSelectedIcon(emoji)
    setShowEmojiPicker(false)
  }

  const handleResetCustomEmoji = () => {
    // Right click to reset and reopen picker
    setCustomEmoji(null)
    if (pickerButtonRef.current) {
      const rect = pickerButtonRef.current.getBoundingClientRect()
      setPickerPosition({
        top: rect.bottom + 8,
        left: rect.left,
      })
    }
    setShowEmojiPicker(true)
  }

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[1000]"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm bg-[var(--color-card)] rounded-xl shadow-[var(--shadow-elevated)] overflow-hidden z-[1001]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/5 dark:border-white/10">
          <h2 className="text-[1rem] font-semibold text-[var(--color-text)] select-none">
            {isEditing ? t.actions.edit : t.sidebar.addNotebook}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-black/5 dark:hover:bg-white/10 transition-all duration-150"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Icon Selection */}
          <div>
            <label className="block text-[0.867rem] font-medium text-[var(--color-text)] mb-2 select-none">
              {t.notebook?.selectIcon || 'Icon'}
            </label>
            <div className="flex items-center gap-2">
              {/* Logo icons */}
              {LOGO_ICONS.map((logo) => (
                <button
                  key={logo.id}
                  type="button"
                  onClick={() => handleLogoSelect(logo.id)}
                  className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${selectedIcon === `logo:${logo.id}`
                    ? 'ring-2 ring-[var(--color-accent)]'
                    : 'border-2 border-transparent hover:bg-black/5 dark:hover:bg-white/5'
                    }`}
                  style={selectedIcon === `logo:${logo.id}` ? { backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)' } : undefined}
                >
                  <img
                    src={logo.src}
                    alt={logo.alt}
                    className="w-6 h-6 object-contain dark:invert select-none"
                    draggable={false}
                  />
                </button>
              ))}

              {/* Custom emoji / + button */}
              <button
                ref={pickerButtonRef}
                type="button"
                onClick={handleCustomEmojiClick}
                onContextMenu={(e) => {
                  e.preventDefault()
                  if (customEmoji) handleResetCustomEmoji()
                }}
                className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${customEmoji && selectedIcon === customEmoji
                  ? 'ring-2 ring-[var(--color-accent)]'
                  : customEmoji
                    ? 'border-2 border-[var(--color-border)] hover:border-[var(--color-accent)]'
                    : 'border-2 border-dashed border-[var(--color-border)] hover:border-[var(--color-accent)] hover:bg-black/5 dark:hover:bg-white/5'
                  }`}
                style={customEmoji && selectedIcon === customEmoji ? { backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)' } : undefined}
              >
                {customEmoji ? (
                  <span className="text-xl select-none">{customEmoji}</span>
                ) : (
                  <PlusIcon className="w-5 h-5 text-[var(--color-muted)]" />
                )}
              </button>
            </div>
          </div>

          {/* Name input */}
          <div>
            <label className="block text-[0.867rem] font-medium text-[var(--color-text)] mb-1.5 select-none">
              {t.notebook?.name || t.sidebar.notebooks}
            </label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t.sidebar.addNotebook}
              className="w-full px-3 py-2 text-[0.867rem] bg-black/5 dark:bg-white/5 border-none rounded-lg text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/50 transition-all"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-2">
            {isEditing && onDelete ? (
              <button
                type="button"
                onClick={onDelete}
                className="px-3 py-1.5 text-[0.867rem] text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-md transition-all duration-150 select-none"
              >
                {t.actions.delete}
              </button>
            ) : (
              <div />
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-[0.867rem] text-[var(--color-text)] bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 rounded-lg transition-all duration-150 select-none"
              >
                {t.actions.cancel}
              </button>
              <button
                type="submit"
                disabled={!name.trim()}
                className="px-4 py-2 text-[0.867rem] text-white bg-[var(--color-accent)] hover:opacity-90 rounded-lg transition-all duration-150 disabled:opacity-50 select-none"
              >
                {t.actions.save}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Emoji Picker - rendered as separate portal to avoid overflow clipping */}
      {showEmojiPicker && (
        <div
          ref={pickerRef}
          className="fixed z-[1002] bg-[var(--color-card)] rounded-xl shadow-xl border border-[var(--color-border)] overflow-hidden"
          style={{ top: pickerPosition.top, left: pickerPosition.left }}
        >
          <EmojiPicker.Root
            onEmojiSelect={(data) => handleEmojiSelect(data.emoji)}
            columns={8}
          >
            <EmojiPicker.Viewport className="h-[280px] overflow-y-auto">
              <EmojiPicker.Loading>
                <div className="flex items-center justify-center h-full text-[var(--color-muted)] text-sm select-none">
                  {t.emoji?.loading || 'Loading...'}
                </div>
              </EmojiPicker.Loading>
              <EmojiPicker.Empty>
                <div className="flex items-center justify-center h-full text-[var(--color-muted)] text-sm select-none">
                  {t.emoji?.noResults || 'No emoji found'}
                </div>
              </EmojiPicker.Empty>
              <EmojiPicker.List
                className="select-none p-1"
                components={{
                  CategoryHeader: ({ category }) => (
                    <div className="text-[0.733rem] text-[var(--color-muted)] font-medium px-2 py-1.5 sticky top-0 bg-[var(--color-card)] border-b border-[var(--color-border)] select-none">
                      {category.label}
                    </div>
                  ),
                  Row: ({ children }) => (
                    <div className="flex">{children}</div>
                  ),
                  Emoji: ({ emoji: emojiData, ...props }) => (
                    <button
                      type="button"
                      {...props}
                      className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-xl transition-colors"
                    >
                      {emojiData.emoji}
                    </button>
                  ),
                }}
              />
            </EmojiPicker.Viewport>
          </EmojiPicker.Root>
        </div>
      )}
    </>,
    document.body
  )
}
