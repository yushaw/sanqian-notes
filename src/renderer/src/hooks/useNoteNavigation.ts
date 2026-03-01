import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import type { MutableRefObject, RefObject } from 'react'
import { flushSync } from 'react-dom'
import type { EditorHandle } from '../components/Editor'
import type {
  Note,
  Notebook,
  SmartViewId,
  LocalFolderTreeResult,
  NotebookStatus,
  LocalNoteMetadata,
} from '../types/note'
import { RECENT_DAYS } from '../types/note'
import type { Translations } from '../i18n'
import { toast } from '../utils/toast'
import { formatDailyDate } from '../utils/dateFormat'
import { setAndPersistNoteScrollPosition } from '../utils/noteScrollStorage'
import { buildSmartViewNoteCounts, type SmartViewNoteCounts } from '../utils/noteCounts'
import { mergeAllSourceNotes } from '../utils/allSourceNotes'
import { isInternalPathInSubtree } from '../utils/localFolderNavigation'
import { resolveSearchResultNavigationTarget } from '../utils/searchResultNavigation'
import { isLocalResourceId, parseLocalResourceId } from '../utils/localResourceId'
import { compareNotesByPinnedAndUpdated } from '../utils/noteSort'
import type { CursorContext } from '../utils/cursor'

// ---------------------------------------------------------------------------
// localStorage keys for navigation state persistence
// ---------------------------------------------------------------------------

export const STORAGE_KEY_VIEW = 'sanqian-notes-last-view'
export const STORAGE_KEY_NOTEBOOK = 'sanqian-notes-last-notebook'
export const STORAGE_KEY_NOTE = 'sanqian-notes-last-note'

// ---------------------------------------------------------------------------
// Hook options & return type
// ---------------------------------------------------------------------------

export interface UseNoteNavigationOptions {
  // State from App
  selectedSmartView: SmartViewId | null
  selectedNotebookId: string | null
  selectedNoteIds: string[]
  allViewLocalEditorTarget: { noteId: string; notebookId: string; relativePath: string } | null
  anchorNoteId: string | null
  selectedInternalFolderPath: string | null
  notebooks: Notebook[]
  notes: Note[]
  allSourceLocalNotes: Note[]
  globalSmartViewNotes: Note[]
  trashNotes: Note[]
  isLoading: boolean

  // State setters from App
  setSelectedSmartView: React.Dispatch<React.SetStateAction<SmartViewId | null>>
  setSelectedNotebookId: React.Dispatch<React.SetStateAction<string | null>>
  setSelectedNoteIds: React.Dispatch<React.SetStateAction<string[]>>
  setAllViewLocalEditorTarget: React.Dispatch<React.SetStateAction<{ noteId: string; notebookId: string; relativePath: string } | null>>
  setAnchorNoteId: React.Dispatch<React.SetStateAction<string | null>>
  setSelectedInternalFolderPath: React.Dispatch<React.SetStateAction<string | null>>
  setIsTypewriterMode: React.Dispatch<React.SetStateAction<boolean>>
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>

  // Editor ref (for scroll position capture)
  editorRef: RefObject<EditorHandle | null>

  // Tab context
  tabFocusedNoteId: string | null
  focusedPaneId: string | null
  openNoteInPane: (noteId: string) => void
  findPaneWithNote: (noteId: string) => { tabId: string; paneId: string } | null
  selectTab: (tabId: string) => void
  focusPane: (paneId: string, tabId?: string) => void
  createTab: (noteId?: string) => void

  // From editor queue (Phase 1)
  flushQueuedEditorUpdates: (noteId: string | null, timeoutMs?: number) => Promise<boolean>
  notifyFlushTimeout: () => void
  triggerIndexCheck: (noteId: string | null, fallbackNote?: Note | null) => void

  // From local folder (Phase 2+3)
  localFolderTreeCache: Record<string, LocalFolderTreeResult>
  localFolderTreeDirty: Record<string, boolean>
  localFolderStatuses: Record<string, NotebookStatus>
  localEditorNote: Note | null
  isLocalFolderNotebookSelected: boolean
  isAllSourceViewActive: boolean
  isAllViewLocalEditorActive: boolean
  isGlobalLocalAwareView: boolean
  shouldRenderLocalEditor: boolean
  localNoteMetadataById: Record<string, LocalNoteMetadata>
  localFolderTree: LocalFolderTreeResult | null
  localNotebookNoteCounts: Record<string, number>
  flushLocalFileSave: () => Promise<void>
  cleanupLocalAutoDraftIfNeeded: (
    target: { notebookId: string; relativePath: string } | null,
    options?: { skipFlush?: boolean },
  ) => Promise<void>
  openLocalFile: (relativePath: string, notebookId: string) => Promise<unknown>
  refreshLocalFolderTree: (notebookId: string, options?: { showLoading?: boolean }) => Promise<unknown>
  resetLocalEditorState: () => void
  localOpenFileRef: MutableRefObject<{ notebookId: string; relativePath: string } | null>

  // From note CRUD (Phase 4)
  deleteEmptyNoteIfNeeded: (noteId: string | null) => Promise<void>

  // From notebook management (Phase 5)
  contextNotebook: Notebook | null | undefined
  internalFolderDialogsResetDialogs: () => void

  // Ref from App (for circular dep with noteCRUD)
  selectSingleNoteRef: MutableRefObject<(noteId: string) => void>

  // Ref for initial saved note id (set during state initialization)
  initialSavedNoteIdRef: MutableRefObject<string | null | undefined>

  // Editor context state (for context sync effect)
  currentBlockId: string | null
  selectedText: string | null
  cursorContext: CursorContext | null

  // i18n
  isZh: boolean
  t: Translations
}

export interface NoteNavigationAPI {
  // Callbacks
  selectSingleNote: (noteId: string) => void
  handleSelectNote: (noteId: string, event?: React.MouseEvent) => Promise<void>
  handleSelectNotebook: (id: string | null) => Promise<void>
  handleSelectSmartView: (view: SmartViewId) => Promise<void>
  handleNoteClick: (noteId: string, target?: { type: 'heading' | 'block'; value: string }) => void
  handleScrollComplete: (found: boolean) => void
  captureNoteScrollPosition: (noteId: string | null, paneId?: string | null) => void
  hasFreshLocalTreeSnapshot: (notebookId: string) => boolean

  // Derived values for JSX
  selectedNoteId: string | null
  contextNote: Note | null
  selectedNote: Note | null
  editorCandidateNotes: Note[]
  filteredNotes: Note[]
  noteCounts: SmartViewNoteCounts
  listTitle: string
  scrollTarget: { type: 'heading' | 'block'; value: string } | null
}

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

export function useNoteNavigation(options: UseNoteNavigationOptions): NoteNavigationAPI {
  const {
    selectedSmartView,
    selectedNotebookId,
    selectedNoteIds,
    allViewLocalEditorTarget,
    anchorNoteId,
    selectedInternalFolderPath,
    notebooks,
    notes,
    allSourceLocalNotes,
    globalSmartViewNotes,
    trashNotes,
    isLoading,
    setSelectedSmartView,
    setSelectedNotebookId,
    setSelectedNoteIds,
    setAllViewLocalEditorTarget,
    setAnchorNoteId,
    setSelectedInternalFolderPath,
    setIsTypewriterMode,
    setNotes,
    editorRef,
    tabFocusedNoteId,
    focusedPaneId,
    openNoteInPane,
    findPaneWithNote,
    selectTab,
    focusPane,
    createTab,
    flushQueuedEditorUpdates,
    notifyFlushTimeout,
    triggerIndexCheck,
    localFolderTreeCache,
    localFolderTreeDirty,
    localFolderStatuses,
    localEditorNote,
    isLocalFolderNotebookSelected,
    isAllSourceViewActive,
    isAllViewLocalEditorActive,
    isGlobalLocalAwareView,
    shouldRenderLocalEditor,
    localNoteMetadataById,
    localFolderTree,
    localNotebookNoteCounts,
    flushLocalFileSave,
    cleanupLocalAutoDraftIfNeeded,
    openLocalFile,
    refreshLocalFolderTree,
    resetLocalEditorState,
    localOpenFileRef,
    deleteEmptyNoteIfNeeded,
    contextNotebook,
    internalFolderDialogsResetDialogs,
    selectSingleNoteRef,
    initialSavedNoteIdRef,
    currentBlockId,
    selectedText,
    cursorContext,
    isZh,
    t,
  } = options

  // ---------------------------------------------------------------------------
  // Refs
  // ---------------------------------------------------------------------------

  // Monotonic version to ignore stale async note-selection flows.
  const noteSelectionVersionRef = useRef(0)
  const initialLocalSelectionRestoreRef = useRef(false)
  // Track previous tabFocusedNoteId for empty note cleanup
  const prevTabFocusedNoteIdRef = useRef<string | null>(null)
  // Keep a ref so stale useCallback closures always see the latest local note
  const localEditorNoteRef = useRef<Note | null>(localEditorNote)
  localEditorNoteRef.current = localEditorNote

  // ---------------------------------------------------------------------------
  // invalidateNoteSelectionVersion
  // ---------------------------------------------------------------------------

  const invalidateNoteSelectionVersion = useCallback(() => {
    noteSelectionVersionRef.current += 1
    return noteSelectionVersionRef.current
  }, [])

  // ---------------------------------------------------------------------------
  // hasFreshLocalTreeSnapshot
  // ---------------------------------------------------------------------------

  const hasFreshLocalTreeSnapshot = useCallback((notebookId: string): boolean => {
    const cachedTree = localFolderTreeCache[notebookId]
    if (!cachedTree) return false
    return !(localFolderTreeDirty[notebookId] ?? true)
  }, [localFolderTreeCache, localFolderTreeDirty])

  // ---------------------------------------------------------------------------
  // captureNoteScrollPosition
  // ---------------------------------------------------------------------------

  const captureNoteScrollPosition = useCallback((noteId: string | null, paneId?: string | null) => {
    if (!noteId) return

    const scrollWrapper = editorRef.current?.getScrollContainer()
    if (!scrollWrapper) return

    const resolvedPaneId = paneId ?? focusedPaneId ?? null
    const scrollTop = Math.max(0, Math.floor(scrollWrapper.scrollTop))
    setAndPersistNoteScrollPosition(noteId, scrollTop, resolvedPaneId)
  }, [editorRef, focusedPaneId])

  // ---------------------------------------------------------------------------
  // Derived values (memos)
  // ---------------------------------------------------------------------------

  const editorCandidateNotes = useMemo(() => {
    if (!isGlobalLocalAwareView) return notes
    return mergeAllSourceNotes(notes, allSourceLocalNotes)
  }, [allSourceLocalNotes, isGlobalLocalAwareView, notes])

  // Last selected note ID for editor display
  const selectedNoteId = selectedNoteIds[selectedNoteIds.length - 1] || null
  // Use tab's focused note if available (for multi-tab/split scenarios)
  const contextNoteId = tabFocusedNoteId || selectedNoteId

  const contextNote = useMemo(
    () => {
      if (shouldRenderLocalEditor) {
        return localEditorNote
      }
      return contextNoteId ? notes.find((n) => n.id === contextNoteId) || null : null
    },
    [contextNoteId, shouldRenderLocalEditor, localEditorNote, notes]
  )

  // Filter notes based on current view
  const filteredNotes = useMemo(() => {
    if (selectedNotebookId) {
      const selectedNotebook = notebooks.find(nb => nb.id === selectedNotebookId)
      if (selectedNotebook?.source_type === 'local-folder') {
        return []
      }
      // Notebooks only show regular notes, not daily notes
      const notebookNotes = notes.filter(n => n.notebook_id === selectedNotebookId && !n.is_daily)
      if (!selectedInternalFolderPath) {
        return notebookNotes
      }
      return notebookNotes.filter((note) => isInternalPathInSubtree(note.folder_path, selectedInternalFolderPath))
    }
    switch (selectedSmartView) {
      case 'all':
        return globalSmartViewNotes
      case 'daily':
        // Daily notes sorted by daily_date DESC (newest first)
        return notes
          .filter(n => n.is_daily)
          .sort((a, b) => (b.daily_date || '').localeCompare(a.daily_date || ''))
      case 'recent':
        return globalSmartViewNotes
      case 'favorites':
        return globalSmartViewNotes
      default:
        return globalSmartViewNotes
    }
  }, [
    notes,
    selectedSmartView,
    selectedNotebookId,
    notebooks,
    selectedInternalFolderPath,
    globalSmartViewNotes,
  ])

  // Get note counts
  const noteCounts = useMemo(() => {
    const recentThreshold = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000
    return buildSmartViewNoteCounts({
      notes,
      notebooks,
      trashCount: trashNotes.length,
      recentThresholdMs: recentThreshold,
      localFolderTree,
      localFolderTreeCache,
      localNotebookNoteCounts,
      localFolderStatuses,
      localNotes: allSourceLocalNotes,
      localFavoriteCount: Object.values(localNoteMetadataById).filter((metadata) => metadata.is_favorite).length,
    })
  }, [
    notes,
    notebooks,
    trashNotes,
    localFolderTree,
    localFolderTreeCache,
    localNotebookNoteCounts,
    localFolderStatuses,
    allSourceLocalNotes,
    localNoteMetadataById,
  ])

  // Get selected note - use tab's focused note if available
  const effectiveNoteId = tabFocusedNoteId || selectedNoteId
  const selectedNote = useMemo(() => {
    return notes.find(n => n.id === effectiveNoteId) || null
  }, [notes, effectiveNoteId])

  // Get list title based on current view
  const listTitle = useMemo(() => {
    if (selectedNotebookId) {
      const notebook = notebooks.find(nb => nb.id === selectedNotebookId)
      return notebook?.name || ''
    }
    switch (selectedSmartView) {
      case 'all':
        return t.sidebar.all
      case 'daily':
        return t.sidebar.daily
      case 'recent':
        return t.sidebar.recent
      case 'favorites':
        return t.sidebar.favorites
      default:
        return ''
    }
  }, [selectedSmartView, selectedNotebookId, notebooks, t])

  // ---------------------------------------------------------------------------
  // scrollTarget state
  // ---------------------------------------------------------------------------

  const [scrollTarget, setScrollTarget] = useState<{ type: 'heading' | 'block'; value: string } | null>(null)

  // ---------------------------------------------------------------------------
  // selectSingleNote
  // ---------------------------------------------------------------------------

  const selectSingleNote = useCallback((noteId: string) => {
    invalidateNoteSelectionVersion()

    // Use the focused pane as the single source of truth for "leaving note".
    const prevFocusedNoteId = tabFocusedNoteId

    captureNoteScrollPosition(prevFocusedNoteId, focusedPaneId)

    // First update selection and open new note
    setSelectedNoteIds([noteId])
    setAnchorNoteId(noteId)
    openNoteInPane(noteId)

    // Then delete previous empty note if switching away
    // Run in background without blocking selection
    if (prevFocusedNoteId && prevFocusedNoteId !== noteId) {
      deleteEmptyNoteIfNeeded(prevFocusedNoteId)
    }
  }, [tabFocusedNoteId, focusedPaneId, captureNoteScrollPosition, deleteEmptyNoteIfNeeded, openNoteInPane, invalidateNoteSelectionVersion, setSelectedNoteIds, setAnchorNoteId])

  // Wire up the ref so noteCRUD can call selectSingleNote
  selectSingleNoteRef.current = selectSingleNote

  // ---------------------------------------------------------------------------
  // handleSelectNote
  // ---------------------------------------------------------------------------

  const handleSelectNote = useCallback(async (noteId: string, event?: React.MouseEvent) => {
    const selectionVersion = invalidateNoteSelectionVersion()
    const isMultiSelectKey = event && (event.metaKey || event.ctrlKey)
    const isRangeSelectKey = event && event.shiftKey
    // Use focused pane note as the only "leaving note".
    const leavingFocusedNoteId = tabFocusedNoteId
    const navigationTarget = resolveSearchResultNavigationTarget(noteId)

    if (navigationTarget.type === 'local') {
      captureNoteScrollPosition(leavingFocusedNoteId, focusedPaneId)

      if (isAllSourceViewActive) {
        setIsTypewriterMode(false)
        setSelectedNoteIds([noteId])
        setAnchorNoteId(noteId)
        setAllViewLocalEditorTarget({
          noteId,
          notebookId: navigationTarget.notebookId,
          relativePath: navigationTarget.relativePath,
        })
        if (!hasFreshLocalTreeSnapshot(navigationTarget.notebookId)) {
          void refreshLocalFolderTree(navigationTarget.notebookId, { showLoading: false })
        }
        void openLocalFile(navigationTarget.relativePath, navigationTarget.notebookId)
      }

      // In all-source view we already switched the UI and kicked off file open.
      // Keep old-note persistence work in background without blocking editor switch.
      if (!isAllSourceViewActive) {
        await flushLocalFileSave()
        if (selectionVersion !== noteSelectionVersionRef.current) return
        await cleanupLocalAutoDraftIfNeeded(
          { notebookId: navigationTarget.notebookId, relativePath: navigationTarget.relativePath },
          { skipFlush: true }
        )
        if (selectionVersion !== noteSelectionVersionRef.current) return
      }

      const flushed = await flushQueuedEditorUpdates(leavingFocusedNoteId)
      if (selectionVersion !== noteSelectionVersionRef.current) return
      if (!flushed) {
        notifyFlushTimeout()
      }

      triggerIndexCheck(leavingFocusedNoteId, localEditorNoteRef.current)
      if (leavingFocusedNoteId && leavingFocusedNoteId !== noteId) {
        deleteEmptyNoteIfNeeded(leavingFocusedNoteId)
      }

      if (isAllSourceViewActive) {
        return
      }

      setAllViewLocalEditorTarget(null)
      setSelectedNotebookId(navigationTarget.notebookId)
      setSelectedSmartView(null)
      setIsTypewriterMode(false)
      setSelectedNoteIds([])
      setAnchorNoteId(null)
      resetLocalEditorState()

      await refreshLocalFolderTree(navigationTarget.notebookId)
      if (selectionVersion !== noteSelectionVersionRef.current) return
      await openLocalFile(navigationTarget.relativePath, navigationTarget.notebookId)
      return
    }

    // Single click without modifiers: clear selection and select only this note
    if (!isMultiSelectKey && !isRangeSelectKey) {
      // Don't do anything if selecting the same single note
      if (selectedNoteIds.length === 1 && selectedNoteIds[0] === noteId) return

      captureNoteScrollPosition(leavingFocusedNoteId, focusedPaneId)
      setSelectedNoteIds([noteId])
      setAnchorNoteId(noteId)  // Set anchor on normal click
      setAllViewLocalEditorTarget(null)
      // Switch editor content immediately; persist previous note in background.
      openNoteInPane(noteId)

      if (localOpenFileRef.current) {
        await flushLocalFileSave()
        if (selectionVersion !== noteSelectionVersionRef.current) return
        await cleanupLocalAutoDraftIfNeeded(null, { skipFlush: true })
        if (selectionVersion !== noteSelectionVersionRef.current) return
        resetLocalEditorState()
      }

      const flushed = await flushQueuedEditorUpdates(leavingFocusedNoteId)
      if (selectionVersion !== noteSelectionVersionRef.current) return
      if (!flushed) {
        notifyFlushTimeout()
      }

      // Trigger incremental index check for the note being left
      triggerIndexCheck(leavingFocusedNoteId, localEditorNoteRef.current)

      // Delete empty note if switching away from it
      // Run in background without blocking selection
      if (leavingFocusedNoteId && leavingFocusedNoteId !== noteId) {
        deleteEmptyNoteIfNeeded(leavingFocusedNoteId)
      }
      return
    }

    // Cmd/Ctrl+Click: toggle selection (anchor stays unchanged)
    if (isMultiSelectKey) {
      setSelectedNoteIds(prev => {
        if (prev.includes(noteId)) {
          // Remove from selection (but keep at least one selected)
          const newIds = prev.filter(id => id !== noteId)
          return newIds.length > 0 ? newIds : prev
        } else {
          // Add to selection
          return [...prev, noteId]
        }
      })
      // Set anchor if this is first selection (no anchor yet)
      if (!anchorNoteId) {
        setAnchorNoteId(noteId)
      }
      return
    }

    // Shift+Click: range selection using anchor
    if (isRangeSelectKey) {
      const anchor = anchorNoteId || selectedNoteId
      if (anchor) {
        const currentIndex = filteredNotes.findIndex(n => n.id === noteId)
        const anchorIndex = filteredNotes.findIndex(n => n.id === anchor)
        if (currentIndex >= 0 && anchorIndex >= 0) {
          const start = Math.min(currentIndex, anchorIndex)
          const end = Math.max(currentIndex, anchorIndex)
          const rangeIds = filteredNotes
            .slice(start, end + 1)
            .map(n => n.id)
            .filter((id) => !isLocalResourceId(id))
          if (rangeIds.length > 0) {
            setSelectedNoteIds(rangeIds)
          }
        }
      }
    }
  }, [
    selectedNoteIds,
    tabFocusedNoteId,
    selectedNoteId,
    anchorNoteId,
    filteredNotes,
    focusedPaneId,
    captureNoteScrollPosition,
    cleanupLocalAutoDraftIfNeeded,
    flushLocalFileSave,
    flushQueuedEditorUpdates,
    notifyFlushTimeout,
    triggerIndexCheck,
    deleteEmptyNoteIfNeeded,
    isAllSourceViewActive,
    hasFreshLocalTreeSnapshot,
    resetLocalEditorState,
    refreshLocalFolderTree,
    openLocalFile,
    openNoteInPane,
    invalidateNoteSelectionVersion,
    localOpenFileRef,
    setSelectedNoteIds,
    setAnchorNoteId,
    setAllViewLocalEditorTarget,
    setSelectedNotebookId,
    setSelectedSmartView,
    setIsTypewriterMode,
  ])

  // ---------------------------------------------------------------------------
  // handleSelectNotebook
  // ---------------------------------------------------------------------------

  const handleSelectNotebook = useCallback(async (id: string | null) => {
    const selectionVersion = invalidateNoteSelectionVersion()
    const leavingFocusedNoteId = tabFocusedNoteId
    const shouldApplyImmediateNotebookUi = !isLocalFolderNotebookSelected && !isAllViewLocalEditorActive
    const applyNotebookSelectionUi = () => {
      setSelectedNotebookId(id)
      setSelectedSmartView(null)
      setIsTypewriterMode(false)
      setSelectedNoteIds([])
      setAnchorNoteId(null)
      setAllViewLocalEditorTarget(null)
      setSelectedInternalFolderPath(null)
      internalFolderDialogsResetDialogs()
    }

    if (shouldApplyImmediateNotebookUi) {
      applyNotebookSelectionUi()
    }

    captureNoteScrollPosition(leavingFocusedNoteId, focusedPaneId)

    await flushLocalFileSave()
    if (selectionVersion !== noteSelectionVersionRef.current) return
    await cleanupLocalAutoDraftIfNeeded(null, { skipFlush: true })
    if (selectionVersion !== noteSelectionVersionRef.current) return

    const flushed = await flushQueuedEditorUpdates(leavingFocusedNoteId)
    if (selectionVersion !== noteSelectionVersionRef.current) return
    if (!flushed) {
      notifyFlushTimeout()
    }
    // Trigger incremental index check for the note being left
    triggerIndexCheck(leavingFocusedNoteId, localEditorNoteRef.current)
    await deleteEmptyNoteIfNeeded(leavingFocusedNoteId)
    if (selectionVersion !== noteSelectionVersionRef.current) return
    if (!shouldApplyImmediateNotebookUi) {
      applyNotebookSelectionUi()
    }
    resetLocalEditorState()
  }, [
    isAllViewLocalEditorActive,
    isLocalFolderNotebookSelected,
    tabFocusedNoteId,
    focusedPaneId,
    captureNoteScrollPosition,
    cleanupLocalAutoDraftIfNeeded,
    flushLocalFileSave,
    flushQueuedEditorUpdates,
    notifyFlushTimeout,
    triggerIndexCheck,
    deleteEmptyNoteIfNeeded,
    invalidateNoteSelectionVersion,
    resetLocalEditorState,
    internalFolderDialogsResetDialogs,
    setSelectedNotebookId,
    setSelectedSmartView,
    setIsTypewriterMode,
    setSelectedNoteIds,
    setAnchorNoteId,
    setAllViewLocalEditorTarget,
    setSelectedInternalFolderPath,
  ])

  // ---------------------------------------------------------------------------
  // handleSelectSmartView
  // ---------------------------------------------------------------------------

  const handleSelectSmartView = useCallback(async (view: SmartViewId) => {
    const selectionVersion = invalidateNoteSelectionVersion()
    const leavingFocusedNoteId = tabFocusedNoteId
    const shouldApplyImmediateSmartViewUi = !isLocalFolderNotebookSelected && !isAllViewLocalEditorActive
    const applySmartViewSelectionUi = () => {
      setSelectedSmartView(view)
      setSelectedNotebookId(null)
      setSelectedInternalFolderPath(null)
      internalFolderDialogsResetDialogs()
      setSelectedNoteIds([])
      setAnchorNoteId(null)
      setAllViewLocalEditorTarget(null)
      setIsTypewriterMode(false)
    }

    if (shouldApplyImmediateSmartViewUi) {
      applySmartViewSelectionUi()
    }

    captureNoteScrollPosition(leavingFocusedNoteId, focusedPaneId)

    await flushLocalFileSave()
    if (selectionVersion !== noteSelectionVersionRef.current) return
    await cleanupLocalAutoDraftIfNeeded(null, { skipFlush: true })
    if (selectionVersion !== noteSelectionVersionRef.current) return

    const flushed = await flushQueuedEditorUpdates(leavingFocusedNoteId)
    if (selectionVersion !== noteSelectionVersionRef.current) return
    if (!flushed) {
      notifyFlushTimeout()
    }
    // Trigger incremental index check for the note being left
    triggerIndexCheck(leavingFocusedNoteId, localEditorNoteRef.current)
    await deleteEmptyNoteIfNeeded(leavingFocusedNoteId)
    if (selectionVersion !== noteSelectionVersionRef.current) return
    if (!shouldApplyImmediateSmartViewUi) {
      applySmartViewSelectionUi()
    }

    // Auto-create today's daily note when entering daily view
    if (view === 'daily') {
      const today = new Date()
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      const existingDaily = notes.find(n => n.is_daily && n.daily_date === todayStr)
      if (existingDaily) {
        selectSingleNote(existingDaily.id)
      } else {
        // Create today's daily note
        try {
          const title = formatDailyDate(todayStr, isZh)
          const newNote = await window.electron.daily.create(todayStr, title)
          if (selectionVersion !== noteSelectionVersionRef.current) return
          // Use flushSync to ensure notes state is updated before selecting
          flushSync(() => {
            setNotes(prev => {
              const newNotes = [newNote as Note, ...prev]
              return newNotes.sort(compareNotesByPinnedAndUpdated)
            })
          })
          selectSingleNote((newNote as Note).id)
        } catch (error) {
          console.error('Failed to create today daily note:', error)
          if (selectionVersion !== noteSelectionVersionRef.current) return
          setSelectedNoteIds([])
          setAnchorNoteId(null)
        }
      }
    }
    resetLocalEditorState()
  }, [
    isAllViewLocalEditorActive,
    isLocalFolderNotebookSelected,
    tabFocusedNoteId,
    focusedPaneId,
    captureNoteScrollPosition,
    cleanupLocalAutoDraftIfNeeded,
    flushLocalFileSave,
    flushQueuedEditorUpdates,
    notifyFlushTimeout,
    triggerIndexCheck,
    deleteEmptyNoteIfNeeded,
    notes,
    isZh,
    selectSingleNote,
    invalidateNoteSelectionVersion,
    resetLocalEditorState,
    internalFolderDialogsResetDialogs,
    setSelectedSmartView,
    setSelectedNotebookId,
    setSelectedInternalFolderPath,
    setSelectedNoteIds,
    setAnchorNoteId,
    setAllViewLocalEditorTarget,
    setIsTypewriterMode,
    setNotes,
  ])

  // ---------------------------------------------------------------------------
  // handleNoteClick
  // ---------------------------------------------------------------------------

  const handleNoteClick = useCallback((noteId: string, target?: { type: 'heading' | 'block'; value: string }) => {
    const navigationTarget = resolveSearchResultNavigationTarget(noteId)
    if (navigationTarget.type === 'local') {
      // Reuse local-file navigation flow to keep behavior consistent.
      void handleSelectNote(noteId)
      return
    }

    // Check if the note exists
    const noteExists = notes.some(n => n.id === noteId)
    if (!noteExists) {
      toast(t.noteLink?.noteNotFound || 'Note not found', { type: 'error' })
      return
    }

    // Save scroll position before navigating
    captureNoteScrollPosition(tabFocusedNoteId, focusedPaneId)

    // Set scroll target
    if (target) {
      setScrollTarget(target)
    } else {
      setScrollTarget(null)
    }

    // If current pane already has this note open, don't switch
    if (tabFocusedNoteId === noteId) {
      return
    }

    // Check if the note is already open in another tab/pane (prefer jumping to existing)
    const existingPane = findPaneWithNote(noteId)
    if (existingPane) {
      selectTab(existingPane.tabId)
      focusPane(existingPane.paneId, existingPane.tabId)
      return
    }

    // If current pane is empty, open in current pane
    if (tabFocusedNoteId === null && focusedPaneId) {
      openNoteInPane(noteId)
      return
    }

    // Open in new tab
    createTab(noteId)
  }, [notes, t, tabFocusedNoteId, focusedPaneId, captureNoteScrollPosition, openNoteInPane, findPaneWithNote, selectTab, focusPane, createTab, handleSelectNote])

  // ---------------------------------------------------------------------------
  // handleScrollComplete
  // ---------------------------------------------------------------------------

  const handleScrollComplete = useCallback((found: boolean) => {
    if (!found && scrollTarget) {
      const typeText = scrollTarget.type === 'heading'
        ? (t.noteLink?.headingNotFound || 'Heading not found')
        : (t.noteLink?.blockNotFound || 'Block not found')
      toast(`${typeText}: ${scrollTarget.value}`, { type: 'error' })
    }
    setScrollTarget(null)
  }, [scrollTarget, t])

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

  // Initial local selection restore
  useEffect(() => {
    if (isLoading) return
    if (initialLocalSelectionRestoreRef.current) return

    const savedNoteId = initialSavedNoteIdRef.current ?? null
    if (!savedNoteId) {
      initialLocalSelectionRestoreRef.current = true
      return
    }
    const localRef = parseLocalResourceId(savedNoteId)
    if (!localRef || !localRef.relativePath) {
      initialLocalSelectionRestoreRef.current = true
      return
    }

    const hasLocalNotebook = notebooks.some(
      (notebook) => notebook.id === localRef.notebookId && notebook.source_type === 'local-folder'
    )
    if (!hasLocalNotebook) {
      // Wait for notebooks to hydrate; local note validity cleanup is handled in loadData.
      if (notebooks.length > 0) {
        initialLocalSelectionRestoreRef.current = true
      }
      return
    }

    const shouldRestoreAllViewLocalEditor = !selectedNotebookId && (selectedSmartView === 'all' || selectedSmartView === null)
    const shouldRestoreLocalNotebookEditor = selectedNotebookId === localRef.notebookId
    if (!shouldRestoreAllViewLocalEditor && !shouldRestoreLocalNotebookEditor) {
      initialLocalSelectionRestoreRef.current = true
      return
    }
    initialLocalSelectionRestoreRef.current = true

    setIsTypewriterMode(false)
    setSelectedNoteIds([savedNoteId])
    setAnchorNoteId(savedNoteId)
    try {
      localStorage.setItem(STORAGE_KEY_NOTE, savedNoteId)
    } catch {
      // ignore storage errors
    }
    setAllViewLocalEditorTarget(
      shouldRestoreAllViewLocalEditor
        ? {
          noteId: savedNoteId,
          notebookId: localRef.notebookId,
          relativePath: localRef.relativePath,
        }
        : null
    )

    if (!hasFreshLocalTreeSnapshot(localRef.notebookId)) {
      void refreshLocalFolderTree(localRef.notebookId, { showLoading: false })
    }

    const notebookStatus = localFolderStatuses[localRef.notebookId]
    if (notebookStatus && notebookStatus !== 'active') {
      return
    }

    void (async () => {
      const opened = await openLocalFile(localRef.relativePath, localRef.notebookId)
      if (opened) return

      setAllViewLocalEditorTarget((prev) => (
        prev && prev.noteId === savedNoteId ? null : prev
      ))
      setSelectedNoteIds((prev) => (
        prev.length === 1 && prev[0] === savedNoteId ? [] : prev
      ))
      setAnchorNoteId((prev) => (prev === savedNoteId ? null : prev))
      try {
        localStorage.removeItem(STORAGE_KEY_NOTE)
      } catch {
        // ignore storage errors
      }
    })()
  }, [
    hasFreshLocalTreeSnapshot,
    isLoading,
    localFolderStatuses,
    notebooks,
    openLocalFile,
    refreshLocalFolderTree,
    selectedNotebookId,
    selectedSmartView,
    initialSavedNoteIdRef,
    setIsTypewriterMode,
    setSelectedNoteIds,
    setAnchorNoteId,
    setAllViewLocalEditorTarget,
  ])

  // Persist navigation state changes to localStorage
  useEffect(() => {
    try {
      if (selectedNotebookId) {
        localStorage.setItem(STORAGE_KEY_NOTEBOOK, selectedNotebookId)
        localStorage.removeItem(STORAGE_KEY_VIEW)
      } else {
        localStorage.removeItem(STORAGE_KEY_NOTEBOOK)
        if (selectedSmartView) {
          localStorage.setItem(STORAGE_KEY_VIEW, selectedSmartView)
        }
      }
    } catch { /* ignore storage errors */ }
  }, [selectedSmartView, selectedNotebookId])

  // Persist selected note to localStorage
  useEffect(() => {
    try {
      // Persist only the last selected note (single note for restore)
      const lastNoteId = selectedNoteIds[selectedNoteIds.length - 1]
      if (lastNoteId) {
        localStorage.setItem(STORAGE_KEY_NOTE, lastNoteId)
      } else {
        const pendingLocalRestore = (
          !initialLocalSelectionRestoreRef.current
          && Boolean(parseLocalResourceId(initialSavedNoteIdRef.current ?? '')?.relativePath)
        )
        if (pendingLocalRestore) return
        localStorage.removeItem(STORAGE_KEY_NOTE)
      }
    } catch { /* ignore storage errors */ }
  }, [selectedNoteIds, initialSavedNoteIdRef])

  // Sync user context to main process (for agent tools)
  useEffect(() => {
    window.electron.context.sync({
      currentNotebookId: contextNotebook?.id || null,
      currentNotebookName: contextNotebook?.name || null,
      currentNoteId: contextNote?.id || null,
      currentNoteTitle: contextNote?.title || null,
      // Only include cursor info if we have valid note context
      currentBlockId: contextNote ? currentBlockId : null,
      selectedText: contextNote ? selectedText : null,
      // Cursor context for SDK tools (heading + paragraph)
      cursorContext: contextNote ? cursorContext : null,
    })
  }, [contextNotebook, contextNote, currentBlockId, selectedText, cursorContext])

  // Tab focus sync / selection sync
  useEffect(() => {
    const prevNoteId = prevTabFocusedNoteIdRef.current
    const pendingLocalRestoreWithoutNotebookData = (
      !initialLocalSelectionRestoreRef.current
      && Boolean(parseLocalResourceId(initialSavedNoteIdRef.current ?? '')?.relativePath)
      && notebooks.length === 0
    )

    if (isAllViewLocalEditorActive && allViewLocalEditorTarget) {
      setSelectedNoteIds((prev) => (
        prev.length === 1 && prev[0] === allViewLocalEditorTarget.noteId
          ? prev
          : [allViewLocalEditorTarget.noteId]
      ))
      setAnchorNoteId((prev) => (prev === allViewLocalEditorTarget.noteId ? prev : allViewLocalEditorTarget.noteId))
      prevTabFocusedNoteIdRef.current = tabFocusedNoteId
      return
    }

    // Keep boot-time local selection intact when initial notebook load failed.
    if (pendingLocalRestoreWithoutNotebookData && !tabFocusedNoteId) {
      prevTabFocusedNoteIdRef.current = tabFocusedNoteId
      return
    }

    // Check if previous note was empty and delete it
    if (prevNoteId && prevNoteId !== tabFocusedNoteId) {
      deleteEmptyNoteIfNeeded(prevNoteId)
    }

    // Update selection based on new focused note
    if (tabFocusedNoteId) {
      const isInList = filteredNotes.some(n => n.id === tabFocusedNoteId)
      if (isInList) {
        setSelectedNoteIds((prev) => (
          prev.length === 1 && prev[0] === tabFocusedNoteId
            ? prev
            : [tabFocusedNoteId]
        ))
        setAnchorNoteId((prev) => (prev === tabFocusedNoteId ? prev : tabFocusedNoteId))
      } else {
        // Note is not in current list (different notebook/view), clear selection
        setSelectedNoteIds((prev) => (prev.length === 0 ? prev : []))
        setAnchorNoteId((prev) => (prev === null ? prev : null))
      }
    } else {
      // Focused pane is empty; keep list selection in sync with editor focus.
      setSelectedNoteIds((prev) => (prev.length === 0 ? prev : []))
      setAnchorNoteId((prev) => (prev === null ? prev : null))
    }

    // Update ref for next comparison
    prevTabFocusedNoteIdRef.current = tabFocusedNoteId
  }, [
    allViewLocalEditorTarget,
    deleteEmptyNoteIfNeeded,
    filteredNotes,
    isAllViewLocalEditorActive,
    notebooks.length,
    tabFocusedNoteId,
    initialSavedNoteIdRef,
    setSelectedNoteIds,
    setAnchorNoteId,
  ])

  // Listen for note:navigate events (from Dataview, Transclusion, etc.)
  useEffect(() => {
    const handleNoteNavigate = (event: CustomEvent<{ noteId: string }>) => {
      const { noteId } = event.detail
      if (noteId) {
        void handleSelectNote(noteId)
      }
    }
    window.addEventListener('note:navigate', handleNoteNavigate as EventListener)
    return () => {
      window.removeEventListener('note:navigate', handleNoteNavigate as EventListener)
    }
  }, [handleSelectNote])

  // Listen for note:navigate IPC events (from chat window via sanqian-notes:// links)
  useEffect(() => {
    const cleanup = window.electron.note.onNavigate((data: { noteId: string; target?: { type: 'heading' | 'block'; value: string } }) => {
      const { noteId, target } = data
      handleNoteClick(noteId, target)
    })
    return cleanup
  }, [handleNoteClick])

  // ---------------------------------------------------------------------------
  // Return
  // ---------------------------------------------------------------------------

  return {
    // Callbacks
    selectSingleNote,
    handleSelectNote,
    handleSelectNotebook,
    handleSelectSmartView,
    handleNoteClick,
    handleScrollComplete,
    captureNoteScrollPosition,
    hasFreshLocalTreeSnapshot,

    // Derived values for JSX
    selectedNoteId,
    contextNote,
    selectedNote,
    editorCandidateNotes,
    filteredNotes,
    noteCounts,
    listTitle,
    scrollTarget,
  }
}
