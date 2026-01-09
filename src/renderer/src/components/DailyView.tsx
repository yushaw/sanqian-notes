import { useState, useCallback, useMemo } from 'react'
import { DailyCalendar } from './DailyCalendar'
import { useI18n, useTranslations } from '../i18n'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { formatDailyDate } from '../utils/dateFormat'
import { getPreview } from '../utils/notePreview'
import type { Note } from '../types/note'

interface DailyViewProps {
  dailyNotes: Note[]
  selectedNoteId: string | null
  onSelectNote: (id: string) => void
  onCreateDaily: (date: string) => void
  onToggleFavorite: (id: string) => void
  onDeleteNote: (id: string) => void
  onOpenInNewTab?: (id: string) => void
  isSidebarCollapsed?: boolean
}

interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  noteId: string | null
  isFavorite: boolean
}

export function DailyView({
  dailyNotes,
  selectedNoteId,
  onSelectNote,
  onCreateDaily,
  onToggleFavorite,
  onDeleteNote,
  onOpenInNewTab,
  isSidebarCollapsed = false
}: DailyViewProps) {
  const { isZh } = useI18n()
  const t = useTranslations()

  // Current selected date for calendar
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  })

  // Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    noteId: null,
    isFavorite: false,
  })

  // Dates that have daily notes
  const datesWithContent = useMemo(() => {
    return dailyNotes
      .filter(n => n.daily_date)
      .map(n => n.daily_date!)
  }, [dailyNotes])

  // Handle date selection from calendar
  const handleSelectDate = useCallback((date: string) => {
    setSelectedDate(date)

    // Find if there's a daily note for this date
    const existingDaily = dailyNotes.find(n => n.daily_date === date)
    if (existingDaily) {
      onSelectNote(existingDaily.id)
    }
  }, [dailyNotes, onSelectNote])

  // Handle creating new daily
  const handleCreateDaily = useCallback(() => {
    onCreateDaily(selectedDate)
  }, [selectedDate, onCreateDaily])

  // Check if selected date has a daily note
  const selectedDateHasDaily = useMemo(() => {
    return dailyNotes.some(n => n.daily_date === selectedDate)
  }, [dailyNotes, selectedDate])

  // Context menu handlers
  const handleContextMenu = (e: React.MouseEvent, note: Note) => {
    e.preventDefault()
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      noteId: note.id,
      isFavorite: note.is_favorite,
    })
  }

  const closeContextMenu = () => {
    setContextMenu(prev => ({ ...prev, visible: false }))
  }

  // Build context menu items
  const getContextMenuItems = useCallback((): ContextMenuItem[] => {
    if (!contextMenu.noteId) return []

    return [
      // Open in new tab
      ...(onOpenInNewTab ? [{
        label: t.noteList.openInNewTab,
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
          </svg>
        ),
        onClick: () => onOpenInNewTab(contextMenu.noteId!)
      }] : []),
      // Favorite/Unfavorite
      {
        label: contextMenu.isFavorite ? t.noteList.unfavorite : t.noteList.favorite,
        icon: (
          <svg className="w-4 h-4" fill={contextMenu.isFavorite ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
          </svg>
        ),
        onClick: () => onToggleFavorite(contextMenu.noteId!)
      },
      // Divider
      { label: '', onClick: () => {}, divider: true },
      // Delete
      {
        label: t.actions.delete,
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        ),
        danger: true,
        onClick: () => onDeleteNote(contextMenu.noteId!)
      }
    ]
  }, [contextMenu.noteId, contextMenu.isFavorite, t, onToggleFavorite, onDeleteNote, onOpenInNewTab])

  return (
    <div className="daily-view">
      {/* Calendar with integrated header */}
      <DailyCalendar
        selectedDate={selectedDate}
        datesWithContent={datesWithContent}
        onSelectDate={handleSelectDate}
        showCreateButton={!selectedDateHasDaily}
        onCreateDaily={handleCreateDaily}
        isSidebarCollapsed={isSidebarCollapsed}
      />

      {/* Divider */}
      <div className="daily-view-divider" />

      {/* Daily notes list */}
      <div className="daily-view-list">
        {dailyNotes.length === 0 ? (
          <div className="daily-view-empty">
            {isZh ? '还没有日记' : 'No daily notes yet'}
          </div>
        ) : (
          dailyNotes.map(note => {
            const isSelected = note.id === selectedNoteId
            const preview = getPreview(note.content)

            return (
              <div
                key={note.id}
                className={`daily-view-item ${isSelected ? 'selected' : ''}`}
                onClick={() => {
                  onSelectNote(note.id)
                  if (note.daily_date) {
                    setSelectedDate(note.daily_date)
                  }
                }}
                onContextMenu={(e) => handleContextMenu(e, note)}
              >
                <div className="daily-view-item-date">
                  {note.daily_date ? formatDailyDate(note.daily_date, isZh) : ''}
                </div>
                <div className="daily-view-item-preview">
                  {preview || (isZh ? '空白日记' : 'Empty daily')}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Context Menu */}
      <ContextMenu
        visible={contextMenu.visible}
        x={contextMenu.x}
        y={contextMenu.y}
        items={getContextMenuItems()}
        onClose={closeContextMenu}
      />
    </div>
  )
}
