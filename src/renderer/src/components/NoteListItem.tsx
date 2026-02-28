import { memo, useCallback } from 'react'
import { Pin } from 'lucide-react'
import type { CSSProperties, DragEvent, MouseEvent } from 'react'
import type { Translations } from '../i18n'
import type { Note } from '../types/note'
import { formatRelativeDate } from '../utils/dateFormat'
import { getPreview } from '../utils/notePreview'

const NOTE_ITEM_BASE_CLASS = 'relative w-full text-left px-4 py-2.5 transition-colors duration-75 hover:bg-[var(--color-surface)] select-none appearance-none border-0 bg-transparent outline-none ring-0 shadow-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0 focus:shadow-none focus-visible:shadow-none active:outline-none active:ring-0 active:shadow-none'
const NOTE_ITEM_DRAGGING_CLASS = 'opacity-50'
const NOTE_ITEM_SELECTED_STYLE: CSSProperties = {
  backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, var(--color-card-solid))',
  WebkitTapHighlightColor: 'transparent',
}
const NOTE_ITEM_DEFAULT_STYLE: CSSProperties = {
  WebkitTapHighlightColor: 'transparent',
}

interface NoteListItemProps {
  note: Note
  isSelected: boolean
  hideDivider: boolean
  isDragging: boolean
  noteListT: Translations['noteList']
  dateT: Translations['date']
  onClickNote: (noteId: string, event: MouseEvent<HTMLButtonElement>) => void
  onContextMenuNote: (noteId: string, event: MouseEvent<HTMLButtonElement>) => void
  onMouseEnterNote: (noteId: string, element: HTMLElement) => void
  onMouseLeaveNote: () => void
  onDragStartNote: (noteId: string, event: DragEvent<HTMLButtonElement>) => void
  onDragEndNote: (event: DragEvent<HTMLButtonElement>) => void
}

export const NoteListItem = memo(function NoteListItem({
  note,
  isSelected,
  hideDivider,
  isDragging,
  noteListT,
  dateT,
  onClickNote,
  onContextMenuNote,
  onMouseEnterNote,
  onMouseLeaveNote,
  onDragStartNote,
  onDragEndNote,
}: NoteListItemProps) {
  const noteId = note.id

  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => onClickNote(noteId, event),
    [onClickNote, noteId]
  )
  const handleContextMenu = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => onContextMenuNote(noteId, event),
    [onContextMenuNote, noteId]
  )
  const handleMouseEnter = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => onMouseEnterNote(noteId, event.currentTarget),
    [onMouseEnterNote, noteId]
  )
  const handleDragStart = useCallback(
    (event: DragEvent<HTMLButtonElement>) => onDragStartNote(noteId, event),
    [onDragStartNote, noteId]
  )

  return (
    <button
      data-note-id={noteId}
      draggable
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={onMouseLeaveNote}
      onDragStart={handleDragStart}
      onDragEnd={onDragEndNote}
      className={`${NOTE_ITEM_BASE_CLASS} ${isDragging ? NOTE_ITEM_DRAGGING_CLASS : ''}`}
      style={isSelected ? NOTE_ITEM_SELECTED_STYLE : NOTE_ITEM_DEFAULT_STYLE}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          {note.is_pinned && (
            <Pin className="w-3.5 h-3.5 flex-shrink-0 text-[var(--color-text-muted)] opacity-50" />
          )}
          <h3 className="text-[0.933rem] font-medium truncate leading-tight text-[var(--color-text)]">
            {note.title || noteListT.untitled}
          </h3>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {note.is_favorite && (
            <svg className="w-3.5 h-3.5 text-amber-400" fill="currentColor" viewBox="0 0 24 24">
              <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
            </svg>
          )}
          <span className="text-[0.733rem] text-[var(--color-muted)] opacity-60">
            {formatRelativeDate(note.updated_at, dateT)}
          </span>
        </div>
      </div>
      <p className="text-[0.8rem] text-[var(--color-muted)] mt-1 line-clamp-2 leading-[1.4] select-none" style={{ minHeight: '2.8em' }}>
        {getPreview(note.content) || noteListT.noContent}
      </p>
      {/* Do not render divider around selected blocks to avoid visible 1px seams. */}
      {!hideDivider && (
        <div data-note-divider className="absolute bottom-0 left-4 right-4 h-px bg-[var(--color-divider)]" />
      )}
    </button>
  )
})
