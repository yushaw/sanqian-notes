import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Pin } from 'lucide-react'
import type { Note, Notebook } from '../types/note'
import { useTranslations } from '../i18n'
import { isMacOS } from '../utils/platform'
import { formatRelativeDate } from '../utils/dateFormat'
import { getPreview } from '../utils/notePreview'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { NotePreviewPopover } from './NotePreviewPopover'

// 检测是否为 macOS
const isMac = isMacOS()

interface NoteListProps {
  notes: Note[]
  selectedNoteIds: string[]
  title: string
  onSelectNote: (id: string, event?: React.MouseEvent) => void
  onCreateNote: () => void
  onSearch: (query: string) => Promise<Note[]>
  onTogglePinned: (id: string) => void
  onToggleFavorite: (id: string) => void
  onDeleteNote: (id: string) => void
  onDuplicateNote: (id: string) => void
  onMoveToNotebook: (noteIdOrIds: string | string[], notebookId: string | null) => void
  onBulkDelete?: (ids: string[]) => void
  onBulkMove?: (noteIdOrIds: string | string[], notebookId: string | null) => void
  onBulkToggleFavorite?: (ids: string[]) => void
  onOpenInNewTab?: (id: string) => void
  notebooks: Notebook[]
  isSidebarCollapsed?: boolean
  showCreateButton?: boolean
}

interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  noteId: string | null
  noteIds: string[]  // For bulk operations
  isPinned: boolean
  isFavorite: boolean
}

export function NoteList({
  notes,
  selectedNoteIds,
  title,
  onSelectNote,
  onCreateNote,
  onSearch,
  onTogglePinned,
  onToggleFavorite,
  onDeleteNote,
  onDuplicateNote,
  onMoveToNotebook,
  onBulkDelete,
  onBulkMove,
  onBulkToggleFavorite,
  onOpenInNewTab,
  notebooks,
  isSidebarCollapsed = false,
  showCreateButton = true,
}: NoteListProps) {
  // macOS 且侧栏收起时隐藏标题（为红绿灯按钮留空间）
  const shouldHideTitle = isMac && isSidebarCollapsed
  const t = useTranslations()
  const [isSearching, setIsSearching] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Note[] | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    noteId: null,
    noteIds: [],
    isPinned: false,
    isFavorite: false,
  })

  // Optimize selection checks with Set (O(1) instead of O(n))
  const selectedIdSet = useMemo(() => new Set(selectedNoteIds), [selectedNoteIds])

  // Hover preview state
  const [hoveredNote, setHoveredNote] = useState<Note | null>(null)
  const [previewAnchor, setPreviewAnchor] = useState<HTMLElement | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cleanup hover timers on unmount
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    }
  }, [])

  // 实时搜索
  const performSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults(null)
      return
    }
    const results = await onSearch(query)
    setSearchResults(results)
  }, [onSearch])

  // 防抖搜索
  useEffect(() => {
    const timer = setTimeout(() => {
      performSearch(searchQuery)
    }, 150)
    return () => clearTimeout(timer)
  }, [searchQuery, performSearch])

  // Cmd+F 快捷键 - 仅在中栏聚焦时生效
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 检查焦点是否在中栏（NoteList 或 Sidebar）
      const activeEl = document.activeElement
      const isInNoteList = activeEl?.closest('[data-note-list], [data-sidebar]')

      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        // 只有当焦点在中栏时才激活中栏搜索
        if (isInNoteList) {
          e.preventDefault()
          setIsSearching(true)
          setTimeout(() => searchInputRef.current?.focus(), 0)
        }
        // 否则不处理，让编辑器等其他组件处理
      }
      if (e.key === 'Escape' && isSearching) {
        setIsSearching(false)
        setSearchQuery('')
        setSearchResults(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isSearching])

  // 聚焦搜索框
  useEffect(() => {
    if (isSearching) {
      searchInputRef.current?.focus()
    }
  }, [isSearching])

  const handleCloseSearch = () => {
    setIsSearching(false)
    setSearchQuery('')
    setSearchResults(null)
  }

  // 右键菜单
  const handleContextMenu = (e: React.MouseEvent, note: Note) => {
    e.preventDefault()
    // Check if right-clicked note is in current selection
    const isInSelection = selectedIdSet.has(note.id)

    // If in selection and multiple selected, show bulk menu
    // Otherwise show single note menu (without changing selection)
    const targetIds = isInSelection && selectedNoteIds.length > 1
      ? selectedNoteIds
      : [note.id]

    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      noteId: note.id,
      noteIds: targetIds,
      isPinned: note.is_pinned,
      isFavorite: note.is_favorite,
    })
  }

  const closeContextMenu = () => {
    setContextMenu(prev => ({ ...prev, visible: false }))
  }

  // Hover preview handlers
  const handleNoteMouseEnter = useCallback((note: Note, element: HTMLElement) => {
    // Clear hover timer (prevents old hover from triggering)
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    // Clear close timer
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }

    // Check if popover is currently showing
    const isPopoverVisible = hoveredNote !== null

    // Only show preview if note has AI summary
    if (!note.ai_summary) {
      // Hide popover immediately if it's showing
      if (isPopoverVisible) {
        setHoveredNote(null)
        setPreviewAnchor(null)
      }
      return
    }

    // If popover is already showing, switch immediately; otherwise wait 1.5s
    if (isPopoverVisible) {
      setHoveredNote(note)
      setPreviewAnchor(element)
    } else {
      hoverTimerRef.current = setTimeout(() => {
        setHoveredNote(note)
        setPreviewAnchor(element)
      }, 1500)
    }
  }, [hoveredNote])

  const handleNoteMouseLeave = useCallback(() => {
    // Clear hover timer
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    // Set close timer with small delay to allow moving to popover
    closeTimerRef.current = setTimeout(() => {
      setHoveredNote(null)
      setPreviewAnchor(null)
    }, 100)
  }, [])

  const handlePopoverMouseEnter = useCallback(() => {
    // Cancel close timer when entering popover
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  const closePreview = useCallback(() => {
    setHoveredNote(null)
    setPreviewAnchor(null)
  }, [])

  // Build context menu items
  const getContextMenuItems = useCallback((): ContextMenuItem[] => {
    if (!contextMenu.noteId) return []

    const isBulk = contextMenu.noteIds.length > 1
    const count = contextMenu.noteIds.length

    // Bulk operations menu
    if (isBulk) {
      const items: ContextMenuItem[] = []

      // Bulk favorite
      if (onBulkToggleFavorite) {
        items.push({
          label: t.noteList.bulkFavorite?.replace('{n}', String(count)) || `收藏 ${count} 个`,
          icon: (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
          ),
          onClick: () => onBulkToggleFavorite(contextMenu.noteIds)
        })
      }

      // Bulk move (submenu)
      if (onBulkMove) {
        items.push({
          label: t.noteList.bulkMove?.replace('{n}', String(count)) || `移动 ${count} 个`,
          icon: (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          ),
          subItems: [
            {
              label: t.noteList.allNotes,
              onClick: () => onBulkMove(contextMenu.noteIds, null)
            },
            ...notebooks.map(notebook => ({
              label: notebook.name,
              onClick: () => onBulkMove(contextMenu.noteIds, notebook.id)
            }))
          ]
        })
      }

      // Divider before delete
      if (onBulkDelete) {
        items.push({ label: '', onClick: () => {}, divider: true })
        items.push({
          label: t.noteList.bulkDelete?.replace('{n}', String(count)) || `删除 ${count} 个`,
          icon: (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          ),
          danger: true,
          onClick: () => onBulkDelete(contextMenu.noteIds)
        })
      }

      return items
    }

    // Single note menu
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
      // Pin/Unpin
      {
        label: contextMenu.isPinned ? t.noteList.unpin : t.noteList.pin,
        icon: <Pin className="w-4 h-4" />,
        onClick: () => onTogglePinned(contextMenu.noteId!)
      },
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
      // Duplicate
      {
        label: t.noteList.duplicate,
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        ),
        onClick: () => onDuplicateNote(contextMenu.noteId!)
      },
      // Move (submenu)
      {
        label: t.noteList.move,
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
        ),
        subItems: [
          // All Notes option
          {
            label: t.noteList.allNotes,
            onClick: () => onMoveToNotebook(contextMenu.noteId!, null)
          },
          // All notebooks
          ...notebooks.map(notebook => ({
            label: notebook.name,
            onClick: () => onMoveToNotebook(contextMenu.noteId!, notebook.id)
          }))
        ]
      },
      // Divider
      { label: '', onClick: () => {}, divider: true },
      // Delete
      {
        label: t.noteList.delete,
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        ),
        danger: true,
        onClick: () => onDeleteNote(contextMenu.noteId!)
      }
    ]
  }, [contextMenu.noteId, contextMenu.noteIds, contextMenu.isPinned, contextMenu.isFavorite, notebooks, t, onTogglePinned, onToggleFavorite, onDuplicateNote, onMoveToNotebook, onDeleteNote, onBulkDelete, onBulkMove, onBulkToggleFavorite, onOpenInNewTab])

  // Dragging state
  const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null)

  const displayNotes = searchResults !== null ? searchResults : notes

  return (
    <div className="w-56 flex-shrink-0 h-full bg-[var(--color-card-solid)] border-r border-[var(--color-divider)] flex flex-col drag-region" data-note-list>
      {/* Header */}
      <div className="px-4 h-[42px] flex items-center justify-between flex-shrink-0 border-b border-black/5 dark:border-white/5">
        {isSearching ? (
          <div className="flex-1 flex items-center gap-2 no-drag min-w-0">
            {shouldHideTitle && <div className="w-[28px] flex-shrink-0" />}
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onBlur={() => {
                if (!searchQuery.trim()) {
                  handleCloseSearch()
                }
              }}
              placeholder={t.noteList.searchPlaceholder}
              className="flex-1 min-w-0 bg-transparent text-[1rem] text-[var(--color-text)] placeholder-[var(--color-muted)] outline-none"
            />
            <button
              onClick={handleCloseSearch}
              className="p-1.5 flex-shrink-0 rounded-md text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ) : (
          <>
            {!shouldHideTitle && (
              <h2 className="text-[1rem] font-semibold text-[var(--color-text)] select-none truncate min-w-0 flex-1" title={title}>
                {title}
              </h2>
            )}
            {shouldHideTitle && <div className="flex-1" />}
            <div className="flex items-center gap-1 no-drag flex-shrink-0">
              <button
                onClick={() => setIsSearching(true)}
                className="p-1.5 rounded-md text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-all duration-150"
                title={t.noteList.search}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </button>
              {showCreateButton && (
                <button
                  onClick={onCreateNote}
                  className="p-1.5 rounded-md text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-all duration-150"
                  title={t.noteList.newNote}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* Note list */}
      <div className="flex-1 overflow-y-auto no-drag hide-scrollbar">
        {/* 搜索无结果状态 */}
        {isSearching && searchResults !== null && searchResults.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--color-muted)] px-6">
            <svg className="w-10 h-10 mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <p className="text-[0.867rem] text-center select-none">{t.noteList.noResults}</p>
          </div>
        ) : displayNotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--color-muted)] px-6">
            <svg className="w-10 h-10 mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-[0.867rem] text-center mb-2 select-none">{t.noteList.empty}</p>
            {showCreateButton && (
              <button
                onClick={onCreateNote}
                className="text-[0.867rem] text-[var(--color-accent)] hover:underline select-none"
              >
                {t.noteList.newNote}
              </button>
            )}
          </div>
        ) : (
          <div className="pb-1">
            {displayNotes.map((note, index) => {
              const isSelected = selectedIdSet.has(note.id)
              const nextNote = displayNotes[index + 1]
              const isNextSelected = nextNote && selectedIdSet.has(nextNote.id)
              // 隐藏分隔线：当前选中或下一个选中时
              const hideDivider = isSelected || isNextSelected

              return (
                <button
                  key={note.id}
                  draggable
                  onClick={(e) => onSelectNote(note.id, e)}
                  onContextMenu={(e) => handleContextMenu(e, note)}
                  onMouseEnter={(e) => handleNoteMouseEnter(note, e.currentTarget)}
                  onMouseLeave={handleNoteMouseLeave}
                  onDragStart={(e) => {
                    // If dragging a selected note, drag all selected; otherwise drag only this one
                    const idsToMove = selectedIdSet.has(note.id)
                      ? selectedNoteIds
                      : [note.id]
                    setDraggingNoteId(note.id)
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('application/json', JSON.stringify(idsToMove))
                  }}
                  onDragEnd={(e) => {
                    // Prevent snap-back animation
                    e.preventDefault()
                    setDraggingNoteId(null)
                  }}
                  className={`w-full text-left px-4 py-2.5 transition-all duration-50 hover:bg-[var(--color-surface)] select-none ${draggingNoteId === note.id ? 'opacity-50' : ''}`}
                  style={isSelected ? { backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' } : undefined}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      {note.is_pinned && (
                        <Pin className="w-3.5 h-3.5 flex-shrink-0 text-[var(--color-text-muted)] opacity-50" />
                      )}
                      <h3 className="text-[0.933rem] font-medium truncate leading-tight text-[var(--color-text)]">
                        {note.title || t.noteList.untitled}
                      </h3>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {note.is_favorite && (
                        <svg className="w-3.5 h-3.5 text-amber-400" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                        </svg>
                      )}
                      <span className="text-[0.733rem] text-[var(--color-muted)] opacity-60">
                        {formatRelativeDate(note.updated_at, t.date)}
                      </span>
                    </div>
                  </div>
                  <p className="text-[0.8rem] text-[var(--color-muted)] mt-1 line-clamp-2 leading-[1.4] select-none" style={{ minHeight: '2.8em' }}>
                    {getPreview(note.content) || t.noteList.noContent}
                  </p>
                  {/* 分隔线 - 与内容区域平齐，选中时隐藏 */}
                  <div
                    className={`h-px bg-[var(--color-divider)] mt-2.5 -mb-2.5 transition-opacity duration-150 ${hideDivider ? 'opacity-0' : ''}`}
                  />
                </button>
              )
            })}
          </div>
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

      {/* Note Preview Popover */}
      {hoveredNote && previewAnchor && (
        <NotePreviewPopover
          note={hoveredNote}
          anchorEl={previewAnchor}
          onClose={closePreview}
          onMouseEnter={handlePopoverMouseEnter}
        />
      )}
    </div>
  )
}
