import type { Note } from '../types/note'
import { useTranslations } from '../i18n'

interface NoteListProps {
  notes: Note[]
  selectedNoteId: string | null
  onSelectNote: (id: string) => void
  onCreateNote: () => void
}

function formatDate(dateString: string, t: { today: string; yesterday: string }): string {
  const date = new Date(dateString)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (days === 0) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } else if (days === 1) {
    return t.yesterday
  } else if (days < 7) {
    return date.toLocaleDateString([], { weekday: 'short' })
  } else {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }
}

function getPreview(content: string): string {
  if (!content || content === '[]' || content === '') {
    return ''
  }

  try {
    const parsed = JSON.parse(content)

    // Handle Tiptap JSON format
    if (parsed.type === 'doc' && parsed.content) {
      const texts: string[] = []
      const extractText = (node: { type?: string; text?: string; content?: unknown[] }) => {
        if (node.text) {
          texts.push(node.text)
        }
        if (node.content && Array.isArray(node.content)) {
          node.content.forEach(child => extractText(child as { type?: string; text?: string; content?: unknown[] }))
        }
      }
      extractText(parsed)
      return texts.join(' ').slice(0, 120)
    }

    // Handle BlockNote format (legacy)
    if (Array.isArray(parsed)) {
      for (const block of parsed) {
        if (block.content && Array.isArray(block.content)) {
          for (const item of block.content) {
            if (item.type === 'text' && item.text) {
              return item.text.slice(0, 120)
            }
          }
        }
      }
    }
  } catch {
    // If not valid JSON, return as-is
    return content.slice(0, 120)
  }
  return ''
}

export function NoteList({
  notes,
  selectedNoteId,
  onSelectNote,
  onCreateNote,
}: NoteListProps) {
  const t = useTranslations()

  return (
    <div className="w-64 h-full bg-[var(--color-card)] border-r border-[var(--color-border)] flex flex-col">
      {/* Header */}
      <div className="h-12 px-4 border-b border-[var(--color-border)] flex items-center justify-between flex-shrink-0">
        <span className="text-[13px] font-medium text-[var(--color-text-secondary)]">
          {notes.length} {notes.length === 1 ? 'note' : 'notes'}
        </span>
        <button
          onClick={onCreateNote}
          className="p-1.5 rounded-md text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-all duration-150"
          title={t.noteList.newNote}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {/* Note list */}
      <div className="flex-1 overflow-y-auto">
        {notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--color-muted)] px-6">
            <svg className="w-10 h-10 mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-[13px] text-center mb-2">{t.noteList.empty}</p>
            <button
              onClick={onCreateNote}
              className="text-[13px] text-[var(--color-accent)] hover:underline"
            >
              {t.noteList.newNote}
            </button>
          </div>
        ) : (
          <div className="py-1">
            {notes.map((note) => (
              <button
                key={note.id}
                onClick={() => onSelectNote(note.id)}
                className={`w-full text-left px-4 py-3 transition-all duration-150 border-b border-[var(--color-divider)] ${
                  selectedNoteId === note.id
                    ? 'bg-[var(--color-accent-soft)]'
                    : 'hover:bg-[var(--color-surface)]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className={`text-[14px] font-medium truncate leading-tight ${
                    selectedNoteId === note.id ? 'text-[var(--color-text)]' : 'text-[var(--color-text)]'
                  }`}>
                    {note.title || t.noteList.untitled}
                  </h3>
                  {note.is_favorite && (
                    <span className="text-[12px] flex-shrink-0 opacity-60">⭐</span>
                  )}
                </div>
                <p className="text-[12px] text-[var(--color-muted)] mt-1 line-clamp-2 leading-relaxed">
                  {getPreview(note.content) || t.noteList.noContent}
                </p>
                <p className="text-[11px] text-[var(--color-muted)] mt-1.5 opacity-60">
                  {formatDate(note.updated_at, t.date)}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
