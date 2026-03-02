import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Pin } from 'lucide-react'
import type { Note, Notebook } from '../types/note'
import { useTranslations } from '../i18n'
import { isMacOS } from '../utils/platform'
import { formatShortcut } from '../utils/shortcut'
import { isLocalResourceId } from '../utils/localResourceId'
import { useVersionedDebouncedSearch } from '../hooks/useVersionedDebouncedSearch'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { NotePreviewPopover } from './NotePreviewPopover'
import { NoteListItem } from './NoteListItem'
import { Tooltip } from './Tooltip'

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
  isLocal: boolean
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
  const executeSearch = useCallback((query: string) => onSearch(query), [onSearch])
  const handleSearchError = useCallback((error: unknown) => {
    console.error('Failed to search notes:', error)
  }, [])
  const {
    query: searchQuery,
    result: searchResults,
    loading: searchLoading,
    hasQuery: hasSearchQuery,
    handleQueryChange: handleSearchQueryChange,
    beginComposition: beginSearchComposition,
    endComposition: endSearchComposition,
    reset: resetSearch,
  } = useVersionedDebouncedSearch<Note[]>({
    execute: executeSearch,
    debounceMs: 150,
    onError: handleSearchError,
  })
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    noteId: null,
    noteIds: [],
    isLocal: false,
    isPinned: false,
    isFavorite: false,
  })

  // Optimize selection checks with Set (O(1) instead of O(n))
  const selectedIdSet = useMemo(() => new Set(selectedNoteIds), [selectedNoteIds])
  const displayNotes = useMemo(() => {
    if (searchResults === null) return notes
    // Keep list stable when new search starts from a previous empty-result state.
    if (isSearching && hasSearchQuery && searchLoading && searchResults.length === 0) {
      return notes
    }
    return searchResults
  }, [hasSearchQuery, isSearching, notes, searchLoading, searchResults])
  const movableNotebooks = useMemo(
    () => notebooks.filter((notebook) => notebook.source_type !== 'local-folder'),
    [notebooks]
  )
  const displayNotesRef = useRef(displayNotes)
  const selectedNoteIdsRef = useRef(selectedNoteIds)
  const onSelectNoteRef = useRef(onSelectNote)
  const isSearchingRef = useRef(isSearching)
  const selectedIdSetRef = useRef(selectedIdSet)
  displayNotesRef.current = displayNotes
  selectedNoteIdsRef.current = selectedNoteIds
  onSelectNoteRef.current = onSelectNote
  isSearchingRef.current = isSearching
  selectedIdSetRef.current = selectedIdSet

  // Hover preview state
  const [hoveredNote, setHoveredNote] = useState<Note | null>(null)
  const hoveredNoteRef = useRef(hoveredNote)
  hoveredNoteRef.current = hoveredNote
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

  // 当 notes 更新时同步 hoveredNote（用于 AI summary 实时更新）
  useEffect(() => {
    if (hoveredNote) {
      const updatedNote = notes.find(n => n.id === hoveredNote.id)
      if (!updatedNote) {
        // 笔记被删除，关闭 popover
        setHoveredNote(null)
        setPreviewAnchor(null)
      } else if (updatedNote.ai_summary !== hoveredNote.ai_summary) {
        setHoveredNote(updatedNote)
      }
    }
  }, [notes, hoveredNote])

  // 搜索词变化时清除 hover 状态（列表重渲染后 anchor 会丢失）
  useEffect(() => {
    setHoveredNote(null)
    setPreviewAnchor(null)
  }, [searchQuery])

  // Cmd+F 快捷键 - 仅在中栏聚焦时生效
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement as HTMLElement | null
      const isInMiddleColumn = Boolean(activeEl?.closest('[data-note-list]'))
      const isInMiddleArea = Boolean(activeEl?.closest('[data-note-list], [data-sidebar]'))
      const isInEditable = Boolean(activeEl?.closest('input, textarea, [contenteditable="true"], .ProseMirror'))

      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        // 只有当焦点在中栏时才激活中栏搜索
        if (isInMiddleArea) {
          e.preventDefault()
          setIsSearching(true)
          setTimeout(() => searchInputRef.current?.focus(), 0)
        }
        // 否则不处理，让编辑器等其他组件处理
      }

      const hasModifier = e.metaKey || e.ctrlKey || e.altKey
      const currentDisplayNotes = displayNotesRef.current
      const currentSelectedNoteIds = selectedNoteIdsRef.current
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !hasModifier && isInMiddleColumn && !isInEditable && currentDisplayNotes.length > 0) {
        const currentSelectedId = [...currentSelectedNoteIds]
          .reverse()
          .find((id) => currentDisplayNotes.some((note) => note.id === id))
        if (!currentSelectedId) return

        const currentIndex = currentDisplayNotes.findIndex((note) => note.id === currentSelectedId)
        if (currentIndex < 0) return

        const nextIndex = e.key === 'ArrowUp'
          ? Math.max(0, currentIndex - 1)
          : Math.min(currentDisplayNotes.length - 1, currentIndex + 1)
        if (nextIndex === currentIndex) return

        e.preventDefault()
        onSelectNoteRef.current(currentDisplayNotes[nextIndex].id)
      }

      if (e.key === 'Escape' && isSearchingRef.current) {
        setIsSearching(false)
        resetSearch()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [resetSearch])

  // 键盘切换时确保选中的笔记保持在可视区域内
  useEffect(() => {
    const currentSelectedId = [...selectedNoteIds]
      .reverse()
      .find((id) => displayNotes.some((note) => note.id === id))
    if (!currentSelectedId) return

    const noteEl = document.querySelector<HTMLElement>(`[data-note-id="${currentSelectedId}"]`)
    noteEl?.scrollIntoView?.({ block: 'nearest' })
  }, [displayNotes, selectedNoteIds])

  // 聚焦搜索框
  useEffect(() => {
    if (isSearching) {
      searchInputRef.current?.focus()
    }
  }, [isSearching])

  const handleCloseSearch = useCallback(() => {
    setIsSearching(false)
    resetSearch()
  }, [resetSearch])

  // Stable context menu handler (id-based, reads note data from refs)
  const handleContextMenuNote = useCallback(
    (noteId: string, event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      const note = displayNotesRef.current.find((n) => n.id === noteId)
      if (!note) return
      const isLocal = isLocalResourceId(note.id)
      const currentSelectedNoteIds = selectedNoteIdsRef.current
      const currentSelectedIdSet = selectedIdSetRef.current
      const selectedInternalIds = currentSelectedNoteIds.filter((id) => !isLocalResourceId(id))
      const isInSelection = currentSelectedIdSet.has(note.id)
      const targetIds = !isLocal && isInSelection && selectedInternalIds.length > 1
        ? selectedInternalIds
        : [note.id]

      setContextMenu({
        visible: true,
        x: event.clientX,
        y: event.clientY,
        noteId: note.id,
        noteIds: targetIds,
        isLocal,
        isPinned: note.is_pinned,
        isFavorite: note.is_favorite,
      })
    },
    []
  )

  const closeContextMenu = () => {
    setContextMenu(prev => ({ ...prev, visible: false }))
  }

  // Stable hover preview handler (id-based, reads note data and hover state from refs)
  const handleMouseEnterNote = useCallback((noteId: string, element: HTMLElement) => {
    const note = displayNotesRef.current.find((n) => n.id === noteId)
    if (!note) return

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
    const isPopoverVisible = hoveredNoteRef.current !== null

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
  }, [])

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

  // Stable click handler
  const handleClickNote = useCallback(
    (noteId: string, event: React.MouseEvent<HTMLButtonElement>) => {
      onSelectNoteRef.current(noteId, event)
    },
    []
  )

  // Stable drag start handler
  const handleDragStartNote = useCallback(
    (noteId: string, event: React.DragEvent<HTMLButtonElement>) => {
      if (isLocalResourceId(noteId)) {
        event.preventDefault()
        return
      }
      const currentSelectedNoteIds = selectedNoteIdsRef.current
      const currentSelectedIdSet = selectedIdSetRef.current
      const selectedDraggableIds = currentSelectedNoteIds.filter((id) => !isLocalResourceId(id))
      const idsToMove = currentSelectedIdSet.has(noteId)
        ? selectedDraggableIds
        : [noteId]
      setDraggingNoteId(noteId)
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('application/json', JSON.stringify(idsToMove))
    },
    []
  )

  // Stable drag end handler
  const handleDragEndNote = useCallback(
    (event: React.DragEvent<HTMLButtonElement>) => {
      event.preventDefault()
      setDraggingNoteId(null)
    },
    []
  )

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

    if (contextMenu.isLocal) {
      return [
        ...(onOpenInNewTab ? [{
          label: t.noteList.openInNewTab,
          icon: (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
            </svg>
          ),
          onClick: () => onOpenInNewTab(contextMenu.noteId!)
        }] : []),
        {
          label: contextMenu.isPinned ? t.noteList.unpin : t.noteList.pin,
          icon: <Pin className="w-4 h-4" />,
          onClick: () => onTogglePinned(contextMenu.noteId!)
        },
        {
          label: contextMenu.isFavorite ? t.noteList.unfavorite : t.noteList.favorite,
          icon: (
            <svg className="w-4 h-4" fill={contextMenu.isFavorite ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
          ),
          onClick: () => onToggleFavorite(contextMenu.noteId!)
        },
      ]
    }

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
            ...movableNotebooks.map(notebook => ({
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
          ...movableNotebooks.map(notebook => ({
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
  }, [contextMenu.isFavorite, contextMenu.isLocal, contextMenu.isPinned, contextMenu.noteId, contextMenu.noteIds, movableNotebooks, t, onTogglePinned, onToggleFavorite, onDuplicateNote, onMoveToNotebook, onDeleteNote, onBulkDelete, onBulkMove, onBulkToggleFavorite, onOpenInNewTab])

  // Dragging state
  const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null)

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
              onChange={(e) => handleSearchQueryChange(e.target.value)}
              onCompositionStart={beginSearchComposition}
              onCompositionEnd={(e) => endSearchComposition(e.currentTarget.value)}
              onBlur={() => {
                if (!searchQuery.trim()) {
                  handleCloseSearch()
                }
              }}
              placeholder={t.noteList.searchPlaceholder}
              aria-label={t.noteList.searchPlaceholder}
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
                <Tooltip content={`${t.noteList.newNote} (${formatShortcut('Command+N')})`} placement="bottom">
                  <button
                    onClick={onCreateNote}
                    className="p-1.5 rounded-md text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-all duration-150"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                </Tooltip>
              )}
            </div>
          </>
        )}
      </div>

      {/* Note list */}
      <div className="flex-1 overflow-y-auto no-drag hide-scrollbar">
        {/* 搜索无结果状态 */}
        {isSearching && hasSearchQuery && !searchLoading && searchResults !== null && searchResults.length === 0 ? (
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
                <NoteListItem
                  key={note.id}
                  note={note}
                  isSelected={isSelected}
                  hideDivider={hideDivider}
                  isDragging={draggingNoteId === note.id}
                  noteListT={t.noteList}
                  dateT={t.date}
                  onClickNote={handleClickNote}
                  onContextMenuNote={handleContextMenuNote}
                  onMouseEnterNote={handleMouseEnterNote}
                  onMouseLeaveNote={handleNoteMouseLeave}
                  onDragStartNote={handleDragStartNote}
                  onDragEndNote={handleDragEndNote}
                />
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
          preloadedTags={hoveredNote.tags.length > 0 ? hoveredNote.tags : undefined}
        />
      )}
    </div>
  )
}
