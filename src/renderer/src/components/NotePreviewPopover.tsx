import { useEffect, useState } from 'react'
import {
  useFloating,
  offset,
  flip,
  shift,
  autoUpdate,
  FloatingPortal,
} from '@floating-ui/react'
import type { Note, TagWithSource } from '../types/note'
import { useTranslations } from '../i18n'

interface NotePreviewPopoverProps {
  note: Note
  anchorEl: HTMLElement | null
  onClose: () => void
  onMouseEnter?: () => void
}

export function NotePreviewPopover({ note, anchorEl, onClose, onMouseEnter }: NotePreviewPopoverProps) {
  const t = useTranslations()
  const [tags, setTags] = useState<TagWithSource[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const { refs, floatingStyles } = useFloating({
    placement: 'right-start',
    middleware: [
      offset(8),
      flip({ fallbackPlacements: ['left-start', 'right-end', 'left-end'] }),
      shift({ padding: 8 }),
    ],
    whileElementsMounted: autoUpdate,
  })

  // Set anchor element
  useEffect(() => {
    if (anchorEl) {
      refs.setReference(anchorEl)
    }
  }, [anchorEl, refs])

  // Load tags
  useEffect(() => {
    let mounted = true
    setIsLoading(true)

    window.electron.tag.getByNote(note.id)
      .then((result) => {
        if (mounted) {
          setTags(result)
          setIsLoading(false)
        }
      })
      .catch((err) => {
        console.error('Failed to load tags:', err)
        if (mounted) {
          setIsLoading(false)
        }
      })

    return () => {
      mounted = false
    }
  }, [note.id])

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

  const hasSummary = note.ai_summary && note.ai_summary.trim().length > 0
  const hasContent = hasSummary || tags.length > 0

  // Don't show if no content and not loading
  if (!isLoading && !hasContent) {
    return null
  }

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={floatingStyles}
        className="z-50 w-56 max-h-80 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg shadow-lg overflow-hidden"
        onMouseEnter={onMouseEnter}
        onMouseLeave={onClose}
      >
        {isLoading ? (
          <div className="p-4 flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-[var(--color-muted)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="flex flex-col max-h-80">
            {/* Summary section */}
            {hasSummary && (
              <div
                className="p-3 overflow-y-auto flex-1 scrollbar-thin"
                style={{ maxHeight: '120px' }}
              >
                <p className="text-[0.8rem] text-[var(--color-text)] leading-relaxed whitespace-pre-wrap">
                  {note.ai_summary}
                </p>
              </div>
            )}

            {/* Tags section */}
            {tags.length > 0 && (
              <div className={`px-3 pb-3 pt-2.5 ${hasSummary ? 'border-t border-[var(--color-divider)]' : ''}`}>
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <span
                      key={tag.id}
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[0.7rem] ${
                        tag.source === 'ai'
                          ? 'text-[var(--color-accent)]'
                          : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)]'
                      }`}
                      style={tag.source === 'ai' ? { backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)' } : undefined}
                    >
                      {tag.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Empty state */}
            {!hasSummary && tags.length === 0 && (
              <div className="p-4 text-center text-[var(--color-muted)] text-[0.8rem]">
                {t.noteList.noContent}
              </div>
            )}
          </div>
        )}
      </div>
    </FloatingPortal>
  )
}
