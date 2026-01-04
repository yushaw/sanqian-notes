import { useState, useRef, useEffect } from 'react'
import type { Note } from '../types/note'
import { useTranslations } from '../i18n'
import { isMacOS } from '../utils/platform'
import { formatRelativeDate } from '../utils/dateFormat'
import { getPreview } from '../utils/notePreview'

// Should match TRASH_RETENTION_DAYS in database.ts
const TRASH_RETENTION_DAYS = 30
const MS_PER_DAY = 24 * 60 * 60 * 1000

// 检测是否为 macOS
const isMac = isMacOS()

interface TrashListProps {
  notes: Note[]
  onRestore: (id: string) => void
  onPermanentDelete: (id: string) => void
  onEmptyTrash: () => void
  isSidebarCollapsed?: boolean
}

interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  noteId: string | null
  noteTitle: string
}

function getDaysRemaining(deletedAt: string): number {
  const deletedDate = new Date(deletedAt)
  const now = new Date()
  const expiryDate = new Date(deletedDate.getTime() + TRASH_RETENTION_DAYS * MS_PER_DAY)
  const daysRemaining = Math.ceil((expiryDate.getTime() - now.getTime()) / MS_PER_DAY)
  return Math.max(0, daysRemaining)
}

export function TrashList({
  notes,
  onRestore,
  onPermanentDelete,
  onEmptyTrash,
  isSidebarCollapsed = false,
}: TrashListProps) {
  // macOS 且侧栏收起时隐藏标题（为红绿灯按钮留空间）
  const shouldHideTitle = isMac && isSidebarCollapsed
  const t = useTranslations()
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    noteId: null,
    noteTitle: '',
  })
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; title: string } | null>(null)
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  const handleContextMenu = (e: React.MouseEvent, note: Note) => {
    e.preventDefault()
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      noteId: note.id,
      noteTitle: note.title || t.noteList.untitled,
    })
  }

  const closeContextMenu = () => {
    setContextMenu(prev => ({ ...prev, visible: false }))
  }

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        closeContextMenu()
      }
    }
    if (contextMenu.visible) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [contextMenu.visible])

  const handleRestore = () => {
    if (contextMenu.noteId) {
      onRestore(contextMenu.noteId)
      closeContextMenu()
    }
  }

  const handlePermanentDelete = () => {
    if (contextMenu.noteId) {
      setConfirmDelete({ id: contextMenu.noteId, title: contextMenu.noteTitle })
      closeContextMenu()
    }
  }

  const confirmPermanentDelete = () => {
    if (confirmDelete) {
      onPermanentDelete(confirmDelete.id)
      setConfirmDelete(null)
    }
  }

  const handleEmptyTrash = () => {
    setConfirmEmpty(true)
  }

  const confirmEmptyTrash = () => {
    onEmptyTrash()
    setConfirmEmpty(false)
  }

  return (
    <div className="w-56 flex-shrink-0 h-full bg-[var(--color-card-solid)] border-r border-[var(--color-divider)] flex flex-col drag-region">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2 flex-shrink-0">
        {!shouldHideTitle && (
          <h2 className="text-[1rem] font-semibold text-[var(--color-text)] select-none">
            {t.trash.title}
          </h2>
        )}
        {shouldHideTitle && <div className="flex-1" />}
        {notes.length > 0 && (
          <button
            onClick={handleEmptyTrash}
            className="text-[0.8rem] text-red-500 hover:text-red-600 transition-colors select-none no-drag"
          >
            {t.trash.emptyTrash}
          </button>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto no-drag hide-scrollbar">
        {notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--color-muted)] select-none">
            <svg className="w-12 h-12 mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
            <span className="text-[0.867rem]">{t.trash.empty}</span>
          </div>
        ) : (
          <div className="py-1">
            {notes.map((note, index) => {
              const nextNote = notes[index + 1]
              const daysRemaining = note.deleted_at ? getDaysRemaining(note.deleted_at) : 30

              return (
                <div
                  key={note.id}
                  onContextMenu={(e) => handleContextMenu(e, note)}
                  className="group w-full text-left px-4 py-2.5 transition-all duration-150 hover:bg-[var(--color-surface)] select-none cursor-default relative"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-[0.933rem] font-medium truncate leading-tight text-[var(--color-text)]">
                      {note.title || t.noteList.untitled}
                    </h3>
                    <span className="text-[0.733rem] text-[var(--color-muted)] opacity-60 flex-shrink-0">
                      {note.deleted_at && formatRelativeDate(note.deleted_at, t.date)}
                    </span>
                  </div>
                  <p className="text-[0.8rem] text-[var(--color-muted)] mt-1 line-clamp-2 leading-[1.4]" style={{ minHeight: '2.8em' }}>
                    {getPreview(note.content) || t.noteList.noContent}
                  </p>
                  <div className="flex items-center justify-between mt-1">
                    <p className="text-[0.733rem] text-[var(--color-muted)] opacity-50">
                      {t.trash.daysRemaining.replace('{n}', String(daysRemaining))}
                    </p>
                    {/* Hover action buttons */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onRestore(note.id)
                        }}
                        className="p-1 rounded text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-card)] transition-all duration-150"
                        title={t.trash.restore}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
                        </svg>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setConfirmDelete({ id: note.id, title: note.title || t.noteList.untitled })
                        }}
                        className="p-1 rounded text-[var(--color-muted)] hover:text-red-500 hover:bg-[var(--color-card)] transition-all duration-150"
                        title={t.trash.permanentDelete}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  {/* Divider */}
                  {nextNote && (
                    <div className="h-px bg-[var(--color-divider)] mt-2.5 -mb-2.5" />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu.visible && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg shadow-lg py-1 min-w-[140px] select-none"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={handleRestore}
            className="w-full px-3 py-1.5 text-left text-[0.867rem] text-[var(--color-text)] hover:bg-[var(--color-surface)] flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
            </svg>
            {t.trash.restore}
          </button>
          <div className="h-px bg-[var(--color-divider)] my-1" />
          <button
            onClick={handlePermanentDelete}
            className="w-full px-3 py-1.5 text-left text-[0.867rem] text-red-500 hover:bg-[var(--color-surface)] flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            {t.trash.permanentDelete}
          </button>
        </div>
      )}

      {/* Confirm Delete Modal */}
      {confirmDelete && (
        <>
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[1000]"
            onClick={() => setConfirmDelete(null)}
          />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm bg-[var(--color-card)] rounded-xl shadow-[var(--shadow-elevated)] overflow-hidden z-[1001]">
            <div className="p-5">
              <h2 className="text-[1rem] font-semibold text-[var(--color-text)] mb-2 select-none">
                {t.trash.deleteConfirmTitle}
              </h2>
              <p className="text-[0.867rem] text-[var(--color-text-secondary)] select-none">
                {t.trash.deleteConfirmMessage.replace('{name}', confirmDelete.title)}
              </p>
            </div>
            <div className="flex justify-end gap-2 px-5 pb-5">
              <button
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 text-[0.867rem] text-[var(--color-text)] bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 rounded-lg transition-all duration-150 select-none"
              >
                {t.actions.cancel}
              </button>
              <button
                onClick={confirmPermanentDelete}
                className="px-4 py-2 text-[0.867rem] text-white bg-red-500 hover:bg-red-600 rounded-lg transition-all duration-150 select-none"
              >
                {t.actions.delete}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Confirm Empty Trash Modal */}
      {confirmEmpty && (
        <>
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[1000]"
            onClick={() => setConfirmEmpty(false)}
          />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm bg-[var(--color-card)] rounded-xl shadow-[var(--shadow-elevated)] overflow-hidden z-[1001]">
            <div className="p-5">
              <h2 className="text-[1rem] font-semibold text-[var(--color-text)] mb-2 select-none">
                {t.trash.emptyConfirmTitle}
              </h2>
              <p className="text-[0.867rem] text-[var(--color-text-secondary)] select-none">
                {t.trash.emptyConfirmMessage}
              </p>
            </div>
            <div className="flex justify-end gap-2 px-5 pb-5">
              <button
                onClick={() => setConfirmEmpty(false)}
                className="px-4 py-2 text-[0.867rem] text-[var(--color-text)] bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 rounded-lg transition-all duration-150 select-none"
              >
                {t.actions.cancel}
              </button>
              <button
                onClick={confirmEmptyTrash}
                className="px-4 py-2 text-[0.867rem] text-white bg-red-500 hover:bg-red-600 rounded-lg transition-all duration-150 select-none"
              >
                {t.trash.emptyTrash}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
