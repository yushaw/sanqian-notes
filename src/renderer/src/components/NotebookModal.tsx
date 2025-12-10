import { useState } from 'react'
import { useTranslations } from '../i18n'
import type { Notebook } from '../types/note'

interface NotebookModalProps {
  notebook?: Notebook | null  // null = create new, existing = edit
  onSave: (data: { name: string; color: string }) => void
  onDelete?: () => void
  onClose: () => void
}

// Muted, zen-style colors
const COLORS = [
  '#78716C', // Stone
  '#64748B', // Slate
  '#6B7280', // Gray
  '#71717A', // Zinc
  '#737373', // Neutral
  '#7C7A73', // Warm Gray
  '#8B7355', // Tan
  '#8B8589', // Taupe
]

export function NotebookModal({ notebook, onSave, onDelete, onClose }: NotebookModalProps) {
  const t = useTranslations()
  const [name, setName] = useState(notebook?.name || '')
  const [color, setColor] = useState(notebook?.color || COLORS[0])
  const isEditing = !!notebook

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (name.trim()) {
      onSave({ name: name.trim(), color })
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-sm bg-[var(--color-card)] rounded-xl shadow-[var(--shadow-elevated)] overflow-hidden animate-fade-in-up">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
          <h2 className="text-[15px] font-semibold text-[var(--color-text)]">
            {isEditing ? t.actions.edit : t.sidebar.addNotebook}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-all duration-150"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Name input */}
          <div>
            <label className="block text-[13px] font-medium text-[var(--color-text)] mb-1.5">
              {t.sidebar.notebooks}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.sidebar.addNotebook}
              autoFocus
              className="w-full px-3 py-2 text-[13px] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-accent)] transition-colors"
            />
          </div>

          {/* Color picker */}
          <div>
            <label className="block text-[13px] font-medium text-[var(--color-text)] mb-1.5">
              Color
            </label>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-6 h-6 rounded-full transition-all duration-150 ${
                    color === c ? 'ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[var(--color-card)] scale-110' : 'hover:scale-105'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-2">
            {isEditing && onDelete ? (
              <button
                type="button"
                onClick={onDelete}
                className="px-3 py-1.5 text-[13px] text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-md transition-all duration-150"
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
                className="px-3 py-1.5 text-[13px] text-[var(--color-muted)] hover:text-[var(--color-text)] bg-[var(--color-surface)] rounded-md transition-all duration-150"
              >
                {t.actions.cancel}
              </button>
              <button
                type="submit"
                disabled={!name.trim()}
                className="px-3 py-1.5 text-[13px] text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] rounded-md transition-all duration-150 disabled:opacity-50"
              >
                {t.actions.save}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
