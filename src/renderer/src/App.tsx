import { useState, useMemo, useDeferredValue, useCallback, useEffect, useRef } from 'react'
import { Dialog } from './components/Dialog'
import { Sidebar } from './components/Sidebar'
import { NoteList } from './components/NoteList'
import { LocalFolderNoteList } from './components/LocalFolderNoteList'
import { TrashList } from './components/TrashList'
import { DailyView } from './components/DailyView'
import { Editor, type EditorHandle } from './components/Editor'
import { EditorColumnShell } from './components/EditorColumnShell'
import { ErrorBoundary, EditorErrorBoundary } from './components/ErrorBoundary'
import { Settings } from './components/Settings'
import { NotebookModal } from './components/NotebookModal'
import { TypewriterMode } from './components/TypewriterMode'
import { AIChatDialog, openChatWithContext } from './components/AIChatDialog'
import { ImageLightbox } from './components/ImageLightbox'
import { TabBar } from './components/TabBar'
import { PaneLayout } from './components/PaneLayout'
import { TabProvider, useTabs } from './contexts/TabContext'
import { UpdateProvider } from './contexts/UpdateContext'
import { useEditorUpdateQueue } from './hooks/useEditorUpdateQueue'
import { useLocalFolderState } from './hooks/useLocalFolderState'
import { useNoteCRUD } from './hooks/useNoteCRUD'
import { useNotebookManagement } from './hooks/useNotebookManagement'
import { useNoteNavigation, STORAGE_KEY_VIEW, STORAGE_KEY_NOTEBOOK, STORAGE_KEY_NOTE } from './hooks/useNoteNavigation'
import { useEditorContextState } from './hooks/useEditorContextState'
import { useGlobalKeyboardShortcuts } from './hooks/useGlobalKeyboardShortcuts'
import { useNoteDataChangedReload } from './hooks/useNoteDataChangedReload'
import { useSummaryUpdateListener } from './hooks/useSummaryUpdateListener'
import { ThemeProvider } from './theme'
import { I18nProvider, useTranslations, useI18n } from './i18n'
import { getCursorInfo, setCursorByBlockId, type CursorInfo } from './utils/cursor'
import { useChatShortcut } from './utils/shortcut'
import {
  buildLocalNoteMetadataMap,
  mergeLocalNotebookStatuses,
  mergeNotebooksWithLocalMounts,
} from './utils/localFolderNavigation'
import {
  type Note,
  type Notebook,
  type SmartViewId,
  type NotebookFolder,
  type LocalFolderNotebookMount,
} from './types/note'
import { parseLocalResourceId } from './utils/localResourceId'
import { buildAllSourceLocalNotes, mergeAllSourceNotes } from './utils/allSourceNotes'
import { applyViewTypeFilter } from '../../shared/note-filters'

const EMPTY_NOTES: Note[] = []

function AppContent() {
  const t = useTranslations()
  const { isZh } = useI18n()

  // Tab system
  const {
    tabs,
    activeTab,
    focusedNoteId: tabFocusedNoteId,
    focusedPaneId,
    activeTabId,
    createTab,
    closeTab,
    openNoteInPane,
    closePane,
    splitPane,
    findPaneWithNote,
    selectTab,
    focusPane,
  } = useTabs()

  const [notebooks, setNotebooks] = useState<Notebook[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  // allSourceLocalNotes and globalSmartViewNotes are derived below via useMemo (after useLocalFolderState)
  const [trashNotes, setTrashNotes] = useState<Note[]>([])
  const [notebookFolders, setNotebookFolders] = useState<NotebookFolder[]>([])
  const [selectedInternalFolderPath, setSelectedInternalFolderPath] = useState<string | null>(null)

  // Initialize navigation state from localStorage
  const [selectedSmartView, setSelectedSmartView] = useState<SmartViewId | null>(() => {
    try {
      const savedNotebook = localStorage.getItem(STORAGE_KEY_NOTEBOOK)
      if (savedNotebook) return null // If notebook is saved, don't set smart view initially
      const saved = localStorage.getItem(STORAGE_KEY_VIEW)
      if (saved === 'all' || saved === 'daily' || saved === 'recent' || saved === 'favorites' || saved === 'trash') {
        return saved
      }
    } catch { /* ignore */ }
    return 'all'
  })
  const [selectedNotebookId, setSelectedNotebookId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_NOTEBOOK)
    } catch { /* ignore */ }
    return null
  })
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_NOTE)
      return saved ? [saved] : []
    } catch { /* ignore */ }
    return []
  })
  const initialSavedNoteIdRef = useRef<string | null | undefined>(undefined)
  if (initialSavedNoteIdRef.current === undefined) {
    try {
      initialSavedNoteIdRef.current = localStorage.getItem(STORAGE_KEY_NOTE)
    } catch {
      initialSavedNoteIdRef.current = null
    }
  }
  const [allViewLocalEditorTarget, setAllViewLocalEditorTarget] = useState<{
    noteId: string
    notebookId: string
    relativePath: string
  } | null>(null)
  // Anchor note for Shift+Click range selection (set on normal click, preserved on Cmd+Click)
  const [anchorNoteId, setAnchorNoteId] = useState<string | null>(null)

  const [showSettings, setShowSettings] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState<string | undefined>(undefined)
  const [isLoading, setIsLoading] = useState(true)

  // Typewriter mode state
  const [isTypewriterMode, setIsTypewriterMode] = useState(false)
  const [typewriterCursorInfo, setTypewriterCursorInfo] = useState<CursorInfo | undefined>(undefined)

  // Sidebar collapsed state
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)

  // Chat shortcut for global keyboard handler
  const chatShortcut = useChatShortcut()

  // Editor selection state (for context provider sync)
  const { currentBlockId, selectedText, cursorContext, handleSelectionChange } = useEditorContextState()

  // Editor ref for cursor position sync
  const editorRef = useRef<EditorHandle>(null)
  const localEditorRef = useRef<EditorHandle>(null)

  // 使用 ref 保存 notes，避免 triggerIndexCheck 依赖 notes 导致的性能问题
  const notesRef = useRef<Note[]>(notes)
  notesRef.current = notes
  // Editor update queue (cloud note save)
  const editorQueue = useEditorUpdateQueue({ notesRef, setNotes, isZh })
  const {
    pendingEditorUpdatesRef,
    flushQueuedEditorUpdates,
    flushQueuedEditorUpdatesForNotes,
    flushQueuedEditorUpdatesRef,
    processEditorUpdateQueue,
    clearEditorUpdateRuntimeState,
    notifyFlushTimeout,
    notifyFlushRequired,
    applyNonEditorNotePatch,
    triggerIndexCheck,
  } = editorQueue

  // Ref to break circular dependency: localFolder needs internalFolderDialogs.resetDialogs,
  // which lives inside notebookManagement, which in turn depends on localFolder outputs.
  const internalFolderDialogsResetRef = useRef<() => void>(() => {})

  // Local folder state (extracted hook)
  const localFolder = useLocalFolderState({
    notebooks,
    selectedNotebookId,
    selectedSmartView,
    allViewLocalEditorTarget,
    setNotebooks,
    setAllViewLocalEditorTarget,
    setSelectedNotebookId,
    setSelectedSmartView,
    setIsTypewriterMode,
    setSelectedNoteIds,
    setAnchorNoteId,
    t,
  })
  const {
    // State
    localFolderTree,
    localFolderTreeCache,
    localFolderTreeDirty,
    localNoteMetadataById,
    localNotebookNoteCounts,
    localFolderTreeLoading,
    localFolderStatuses,
    localNotebookHasChildFolders,
    selectedLocalFolderPath,
    selectedLocalFilePath,
    localEditorNote,
    localEditorLoading,
    localSaveConflictDialog,
    localSaveConflictSubmitting,
    // State setters (used in loadData / useNoteDataChangedReload)
    setLocalNoteMetadataById,
    setLocalFolderStatuses,
    // Refs (used in remaining App.tsx code)
    localOpenFileRef,
    localEditorNoteRef,
    localAutoDraftRef,
    flushLocalFileSaveRef,
    localEditorFlushRef,
    // Derived values
    isLocalFolderNotebookSelected,
    isAllSourceViewActive,
    isGlobalLocalAwareView,
    isAllViewLocalEditorActive,
    shouldRenderLocalEditor,
    activeLocalNotebookId,
    activeLocalNotebookStatus,
    selectedLocalNotebookStatus,
    localSearchMatchedPathSet,
    localSearchListLoading,
    // Search
    localSearchQuery,
    handleLocalSearchQueryChange,
    beginLocalSearchComposition,
    endLocalSearchComposition,
    // Callbacks
    warmupLocalNotebookSummaries,
    refreshLocalFolderTree,
    flushLocalFileSave,
    cleanupLocalAutoDraftIfNeeded,
    handleUpdateLocalFile,
    openLocalFile,
    handleSelectLocalFile,
    createLocalFileWithoutDialog,
    updateLocalNoteBusinessMetadata,
    handleSelectLocalFolder,
    handleResolveLocalSaveConflictReload,
    handleResolveLocalSaveConflictOverwrite,
    handleResolveLocalSaveConflictSaveAsCopy,
    refreshOpenLocalFileFromDisk,
    handleOpenLocalFolderInFileManager,
    handleAddLocalFolder,
    handleRecoverLocalFolderAccess,
    resetLocalEditorState,
    cleanupUnmountedLocalNotebook,
    commitLocalFileTitleRename,
    // Dialog hook
    localFolderDialogs,
  } = localFolder

  // Bridge: wire Editor's flushPendingSave into useLocalFolderState's flush chain
  // so that flushLocalFileSave() can flush the Editor's 300ms debounce first.
  localEditorFlushRef.current = () => localEditorRef.current?.flushPendingSave()

  // Derive allSourceLocalNotes from renderer-side cache (replaces async IPC fetch)
  const allSourceLocalNotes = useMemo(() =>
    buildAllSourceLocalNotes({
      notebooks,
      localFolderTreeCache,
      localFolderStatuses,
      localNoteMetadataById,
    }),
    [notebooks, localFolderTreeCache, localFolderStatuses, localNoteMetadataById]
  )

  // Defer notes for globalSmartViewNotes so that merge+sort (O(n log n) with Date
  // parsing) doesn't run synchronously on every keystroke during editing.
  // React schedules the deferred update during idle time, similar to the old 280ms
  // debounce but with framework-level scheduling.
  const deferredNotes = useDeferredValue(notes)

  // Derive globalSmartViewNotes from merged notes (replaces async IPC fetch)
  const globalSmartViewNotes = useMemo(() => {
    if (selectedNotebookId || selectedSmartView === 'daily' || selectedSmartView === 'trash') {
      return EMPTY_NOTES
    }
    const merged = mergeAllSourceNotes(deferredNotes, allSourceLocalNotes)
    return applyViewTypeFilter(merged, { viewType: selectedSmartView || 'all' })
  }, [deferredNotes, allSourceLocalNotes, selectedNotebookId, selectedSmartView])

  // Ref for selectSingleNote (populated below) to break circular dependency
  const selectSingleNoteRef = useRef<(noteId: string) => void>(() => {})

  // Note CRUD operations (extracted hook)
  const noteCRUD = useNoteCRUD({
    notebooks,
    notes,
    notesRef,
    allSourceLocalNotes,
    selectedNotebookId,
    selectedSmartView,
    selectedInternalFolderPath,
    isZh,
    t,
    setNotes,
    setTrashNotes,
    setNotebookFolders,
    setSelectedNoteIds,
    setAnchorNoteId,
    pendingEditorUpdatesRef,
    flushQueuedEditorUpdates,
    flushQueuedEditorUpdatesForNotes,
    processEditorUpdateQueue,
    clearEditorUpdateRuntimeState,
    notifyFlushRequired,
    applyNonEditorNotePatch,
    selectedLocalNotebookStatus,
    createLocalFileWithoutDialog,
    updateLocalNoteBusinessMetadata,
    localEditorNoteRef,
    localNoteMetadataById,
    selectSingleNoteRef,
    createTab,
  })
  const {
    refreshInternalNotebookData,
    deleteEmptyNoteIfNeeded,
    handleCreateNote,
    handleOpenInNewTab,
    handleCreateDaily,
    handleUpdateNote,
    handleCreateNoteFromLink,
    handleTogglePinned,
    handleToggleFavorite,
    handleMoveToNotebook,
    handleDeleteNote,
    handleDuplicateNote,
    handleSearch,
    handleRestoreNote,
    handlePermanentDelete,
    handleEmptyTrash,
    handleBulkDelete,
    handleBulkToggleFavorite,
  } = noteCRUD

  // Notebook management (extracted hook)
  const notebookMgmt = useNotebookManagement({
    notebooks,
    notes,
    notebookFolders,
    selectedNotebookId,
    selectedInternalFolderPath,
    localFolderTree,
    localNotebookHasChildFolders,
    setNotebooks,
    setNotebookFolders,
    setNotes,
    setTrashNotes,
    setSelectedNotebookId,
    setSelectedSmartView,
    setIsTypewriterMode,
    setSelectedNoteIds,
    setAnchorNoteId,
    setSelectedInternalFolderPath,
    clearEditorUpdateRuntimeState,
    flushQueuedEditorUpdatesForNotes,
    notifyFlushRequired,
    localOpenFileRef,
    localAutoDraftRef,
    flushLocalFileSave,
    cleanupLocalAutoDraftIfNeeded,
    cleanupUnmountedLocalNotebook,
    resetLocalEditorState,
    refreshInternalNotebookData,
  })
  const {
    showNotebookModal,
    editingNotebook,
    closeNotebookModal,
    handleSelectInternalFolder,
    handleReorderNotebooks,
    handleAddNotebook,
    handleEditNotebook,
    handleSaveNotebook,
    handleDeleteNotebook,
    contextNotebook,
    notebookHasChildFolders,
    isInternalNotebookSelected,
    internalFolderTreeNodes,
    internalFolderDialogs,
    notebookDeleteDialog,
  } = notebookMgmt
  // Wire up the ref now that internalFolderDialogs is available
  internalFolderDialogsResetRef.current = internalFolderDialogs.resetDialogs

  // Note navigation (extracted hook)
  const navigation = useNoteNavigation({
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
    internalFolderDialogsResetDialogs: internalFolderDialogs.resetDialogs,
    selectSingleNoteRef,
    initialSavedNoteIdRef,
    currentBlockId,
    selectedText,
    cursorContext,
    isZh,
    t,
  })
  const {
    selectSingleNote,
    handleSelectNote,
    handleSelectNotebook,
    handleSelectSmartView,
    handleNoteClick,
    handleScrollComplete,
    selectedNoteId,
    selectedNote,
    editorCandidateNotes,
    filteredNotes,
    noteCounts,
    listTitle,
    scrollTarget,
  } = navigation

  // Global keyboard shortcut for AI chat
  // Use capture phase to catch the event before editor intercepts it
  useEffect(() => {
    if (!chatShortcut) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Parse shortcut string (e.g., "Command+K", "Control+Shift+P")
      const parts = chatShortcut.split('+')
      const key = parts[parts.length - 1].toLowerCase()
      const needsCommand = parts.includes('Command')
      const needsControl = parts.includes('Control')
      const needsAlt = parts.includes('Alt')
      const needsShift = parts.includes('Shift')

      // Check if modifiers match
      const commandMatch = needsCommand ? e.metaKey : !e.metaKey
      const controlMatch = needsControl ? e.ctrlKey : !e.ctrlKey
      const altMatch = needsAlt ? e.altKey : !e.altKey
      const shiftMatch = needsShift ? e.shiftKey : !e.shiftKey

      // For cross-platform, Command on Mac = Ctrl on Windows/Linux
      const modifiersMatch = (needsCommand || needsControl)
        ? (e.metaKey || e.ctrlKey) && altMatch && shiftMatch
        : commandMatch && controlMatch && altMatch && shiftMatch

      if (modifiersMatch && e.key.toLowerCase() === key) {
        e.preventDefault()
        e.stopPropagation()
        window.electron.chatWindow.toggle()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true) // capture phase
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [chatShortcut])

  // Load data from database and validate restored navigation state
  useEffect(() => {
    async function loadData() {
      try {
        const [notesData, notebooksData, trashData, localMounts, notebookFolderData, localMetadataResponse] = await Promise.all([
          window.electron.note.getAll(),
          window.electron.notebook.getAll(),
          window.electron.trash.getAll(),
          window.electron.localFolder.list(),
          window.electron.notebookFolder.list(),
          window.electron.localFolder.listNoteMetadata(),
        ])
        const loadedNotes = notesData as Note[]
        const localMountSnapshots = localMounts as LocalFolderNotebookMount[]
        const loadedNotebooks = mergeNotebooksWithLocalMounts(notebooksData as Notebook[], localMountSnapshots)
        const localMetadataItems = localMetadataResponse.success ? localMetadataResponse.result.items : []
        if (!localMetadataResponse.success) {
          console.warn('[App] Failed to load local note metadata:', localMetadataResponse.errorCode)
        }
        notesRef.current = loadedNotes
        setNotes(loadedNotes)
        setNotebooks(loadedNotebooks)
        setTrashNotes(trashData as Note[])
        setNotebookFolders(notebookFolderData as NotebookFolder[])
        setLocalNoteMetadataById(buildLocalNoteMetadataMap(localMetadataItems))
        setLocalFolderStatuses((prev) => mergeLocalNotebookStatuses(prev, loadedNotebooks, localMountSnapshots))
        await warmupLocalNotebookSummaries(localMountSnapshots)

        // Validate restored navigation state
        // Check if saved notebook still exists
        const savedNotebookId = localStorage.getItem(STORAGE_KEY_NOTEBOOK)
        if (savedNotebookId) {
          const notebookExists = loadedNotebooks.some(nb => nb.id === savedNotebookId)
          if (!notebookExists) {
            // Notebook was deleted, reset to 'all' view
            setSelectedNotebookId(null)
            setSelectedSmartView('all')
            localStorage.removeItem(STORAGE_KEY_NOTEBOOK)
            localStorage.setItem(STORAGE_KEY_VIEW, 'all')
          }
        }

        // Check if saved note still exists
        const savedNoteId = localStorage.getItem(STORAGE_KEY_NOTE)
        if (savedNoteId) {
          const localRef = parseLocalResourceId(savedNoteId)
          const noteExists = (localRef && localRef.relativePath)
            ? loadedNotebooks.some(
              (notebook) => notebook.id === localRef.notebookId && notebook.source_type === 'local-folder'
            )
            : loadedNotes.some((note) => note.id === savedNoteId)
          if (!noteExists) {
            // Note was deleted, clear selection
            setSelectedNoteIds([])
            setAnchorNoteId(null)
            localStorage.removeItem(STORAGE_KEY_NOTE)
          }
        }
      } catch (error) {
        console.error('Failed to load data:', error)
      } finally {
        setIsLoading(false)
      }
    }
    loadData()

    // Cleanup old trash (notes older than 30 days)
    window.electron?.trash?.cleanup().catch(console.error)
  }, [warmupLocalNotebookSummaries])

  useNoteDataChangedReload({
    refreshLocalFolderTree,
    refreshOpenLocalFileFromDisk,
    notesRef,
    localOpenFileRef,
    pendingEditorUpdatesRef,
    setNotes,
    setNotebooks,
    setNotebookFolders,
    setLocalNoteMetadataById,
    setLocalFolderStatuses,
  })

  useSummaryUpdateListener({
    pendingEditorUpdatesRef,
    notesRef,
    setNotes,
  })

  // Listen for "continue in chat" from popup window
  useEffect(() => {
    const cleanup = window.electron.popup.onContinueInChat((selectedText, explanation) => {
      openChatWithContext({ selectedText, explanation })
    })
    return cleanup
  }, [])

  // Handle settings toggle
  const handleOpenSettings = useCallback((tab?: string) => {
    setSettingsInitialTab(tab)
    setShowSettings(true)
  }, [])

  const handleCloseSettings = useCallback(() => {
    setShowSettings(false)
    setSettingsInitialTab(undefined)
  }, [])

  // Toggle typewriter mode - 现在接收 cursorInfo 参数
  const handleToggleTypewriter = useCallback((cursorInfo: CursorInfo) => {
    setTypewriterCursorInfo(cursorInfo)
    setIsTypewriterMode(true)
  }, [])

  // 辅助函数：滚动到光标位置（带动画）
  const scrollEditorToCursor = useCallback(() => {
    const selection = window.getSelection()
    if (!selection || !selection.rangeCount) return

    const range = selection.getRangeAt(0)
    const rect = range.getBoundingClientRect()

    const scrollWrapper = document.querySelector('.zen-scroll-wrapper')
    if (!scrollWrapper) return

    const wrapperRect = scrollWrapper.getBoundingClientRect()
    const scrollTop = scrollWrapper.scrollTop
    const cursorRelativeTop = rect.top - wrapperRect.top + scrollTop

    const targetScroll = cursorRelativeTop - wrapperRect.height / 2

    scrollWrapper.scrollTo({
      top: Math.max(0, targetScroll),
      behavior: 'smooth'
    })
  }, [])

  const handleExitTypewriter = useCallback(async (cursorInfo?: CursorInfo) => {
    // 先从数据库重新加载笔记内容（因为 TypewriterMode 可能修改了内容）
    if (selectedNoteId) {
      try {
        const flushed = await flushQueuedEditorUpdates(selectedNoteId)
        if (!flushed) {
          notifyFlushTimeout()
        } else {
          const updatedNote = await window.electron.note.getById(selectedNoteId)
          if (updatedNote) {
            setNotes(prev => prev.map(n => n.id === selectedNoteId ? updatedNote as Note : n))
          }
        }
      } catch (error) {
        console.error('Failed to reload note:', error)
      }
    }

    setIsTypewriterMode(false)

    // 退出时，延迟设置光标位置（等待 Editor 重新挂载和 editor 实例创建）
    if (cursorInfo && cursorInfo.blockId) {
      const trySetCursor = (retries = 0) => {
        const editor = editorRef.current?.getEditor()
        if (editor) {
          setCursorByBlockId(editor, cursorInfo)
          setTimeout(scrollEditorToCursor, 50)
        } else if (retries < 10) {
          setTimeout(() => trySetCursor(retries + 1), 50)
        } else {
          // 重试失败后，尝试聚焦编辑器开头作为备选
          console.warn('Failed to restore cursor position after exiting typewriter mode')
          const fallbackEditor = editorRef.current?.getEditor()
          if (fallbackEditor) {
            fallbackEditor.commands.focus('start')
          }
        }
      }
      setTimeout(() => trySetCursor(), 150)
    }
  }, [flushQueuedEditorUpdates, selectedNoteId, notifyFlushTimeout, scrollEditorToCursor])

  // 从 editor 获取当前光标信息
  const getCursorInfoFromEditor = useCallback((): CursorInfo => {
    const editor = editorRef.current?.getEditor() ?? null
    return getCursorInfo(editor) || { blockId: '', offsetInBlock: 0, absolutePos: 0 }
  }, [])

  // Keyboard shortcuts
  const activePaneCount = activeTab ? Object.keys(activeTab.panes).length : 0

  useGlobalKeyboardShortcuts({
    isTypewriterMode,
    handleToggleTypewriter,
    getCursorInfoFromEditor,
    handleCreateNote,
    selectedSmartView,
    filteredNotes,
    tabFocusedNoteId,
    isLocalEditorActive: Boolean(shouldRenderLocalEditor),
    localOpenFileRef,
    flushLocalFileSaveRef,
    flushQueuedEditorUpdatesRef,
    createTab,
    closeTab,
    closePane,
    splitPane,
    focusedPaneId,
    activeTabId,
    tabCount: tabs.length,
    activePaneCount,
    setIsTypewriterMode,
    setSelectedNoteIds,
    setAnchorNoteId,
  })

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-app-bg">
        <div className="text-app-muted">{t.common?.loading || 'Loading...'}</div>
      </div>
    )
  }

  return (
    <div className="h-full flex bg-app-bg relative">
      {/* Sidebar - Notebooks & Smart Views */}
      <ErrorBoundary>
        <Sidebar
          notebooks={notebooks}
          selectedNotebookId={selectedNotebookId}
          selectedSmartView={selectedSmartView}
          onSelectNotebook={handleSelectNotebook}
          onSelectSmartView={handleSelectSmartView}
          onAddNotebook={handleAddNotebook}
          onAddLocalFolder={handleAddLocalFolder}
          onOpenLocalFolderInFileManager={handleOpenLocalFolderInFileManager}
          onEditNotebook={handleEditNotebook}
          onDeleteNotebook={notebookDeleteDialog.requestDelete}
          onOpenSettings={handleOpenSettings}
          onMoveNoteToNotebook={handleMoveToNotebook}
          onReorderNotebooks={handleReorderNotebooks}
          noteCounts={noteCounts}
          notebookHasChildFolders={notebookHasChildFolders}
          localFolderTreeNodes={isLocalFolderNotebookSelected ? (localFolderTree?.tree || []) : []}
          localFolderTreeLoading={isLocalFolderNotebookSelected && localFolderTreeLoading}
          selectedLocalFolderPath={selectedLocalFolderPath}
          onSelectLocalFolder={isLocalFolderNotebookSelected ? handleSelectLocalFolder : undefined}
          onCreateLocalFolder={isLocalFolderNotebookSelected
            ? (parentFolderPath) => localFolderDialogs.handleOpenCreate('folder', { parentRelativePath: parentFolderPath })
            : undefined}
          onRenameLocalFolder={isLocalFolderNotebookSelected
            ? (relativePath) => localFolderDialogs.handleOpenRename({ kind: 'folder', relativePath })
            : undefined}
          onDeleteLocalFolder={isLocalFolderNotebookSelected
            ? (relativePath) => { void localFolderDialogs.handleRequestDelete({ kind: 'folder', relativePath }) }
            : undefined}
          canCreateLocalFolder={selectedLocalNotebookStatus === 'active'}
          canManageLocalFolders={selectedLocalNotebookStatus === 'active'}
          internalFolderTreeNodes={isInternalNotebookSelected ? internalFolderTreeNodes : []}
          internalFolderTreeLoading={false}
          selectedInternalFolderPath={selectedInternalFolderPath}
          onSelectInternalFolder={isInternalNotebookSelected ? handleSelectInternalFolder : undefined}
          onCreateInternalFolder={isInternalNotebookSelected ? internalFolderDialogs.handleOpenCreate : undefined}
          onRenameInternalFolder={isInternalNotebookSelected ? internalFolderDialogs.handleOpenRename : undefined}
          onDeleteInternalFolder={isInternalNotebookSelected ? internalFolderDialogs.handleRequestDelete : undefined}
          canCreateInternalFolder={isInternalNotebookSelected}
          canManageInternalFolders={isInternalNotebookSelected}
          onCollapsedChange={setIsSidebarCollapsed}
        />
      </ErrorBoundary>

      {/* Note List, Daily View, or Trash List */}
      {selectedSmartView === 'trash' ? (
        <TrashList
          notes={trashNotes}
          onRestore={handleRestoreNote}
          onPermanentDelete={handlePermanentDelete}
          onEmptyTrash={handleEmptyTrash}
          isSidebarCollapsed={isSidebarCollapsed}
        />
      ) : selectedSmartView === 'daily' ? (
        <DailyView
          dailyNotes={filteredNotes}
          selectedNoteId={selectedNoteId}
          onSelectNote={handleSelectNote}
          onCreateDaily={handleCreateDaily}
          onToggleFavorite={handleToggleFavorite}
          onDeleteNote={handleDeleteNote}
          onOpenInNewTab={handleOpenInNewTab}
          isSidebarCollapsed={isSidebarCollapsed}
        />
      ) : isLocalFolderNotebookSelected ? (
        <LocalFolderNoteList
          title={localFolderTreeLoading && !localFolderTree ? `${listTitle} · ${t.common?.loading || 'Loading...'}` : listTitle}
          treeNodes={localFolderTree?.tree || []}
          files={localFolderTree?.files || []}
          isSidebarCollapsed={isSidebarCollapsed}
          showFolderTree={false}
          selectedFolderPath={selectedLocalFolderPath}
          onSelectFolder={handleSelectLocalFolder}
          selectedFilePath={selectedLocalFilePath}
          onSelectFile={handleSelectLocalFile}
          searchQuery={localSearchQuery}
          onSearchQueryChange={handleLocalSearchQueryChange}
          onSearchCompositionStart={beginLocalSearchComposition}
          onSearchCompositionEnd={endLocalSearchComposition}
          searchLoading={localSearchListLoading}
          searchMatchedPaths={localSearchMatchedPathSet}
          searchDisabled={selectedLocalNotebookStatus !== 'active'}
          onCreateFile={handleCreateNote}
          onCreateFolder={(parentFolderPath) => localFolderDialogs.handleOpenCreate('folder', { parentRelativePath: parentFolderPath })}
          onRenameEntry={localFolderDialogs.handleOpenRename}
          onDeleteEntry={(target) => void localFolderDialogs.handleRequestDelete(target)}
          canCreateFile={selectedLocalNotebookStatus === 'active'}
          canCreateFolder={selectedLocalNotebookStatus === 'active'}
          canManageEntries={selectedLocalNotebookStatus === 'active'}
        />
      ) : (
        <NoteList
          notes={filteredNotes}
          selectedNoteIds={selectedNoteIds}
          title={listTitle}
          onSelectNote={handleSelectNote}
          onCreateNote={handleCreateNote}
          onSearch={handleSearch}
          onTogglePinned={handleTogglePinned}
          onToggleFavorite={handleToggleFavorite}
          onDeleteNote={handleDeleteNote}
          onDuplicateNote={handleDuplicateNote}
          onMoveToNotebook={handleMoveToNotebook}
          onBulkDelete={handleBulkDelete}
          onBulkMove={handleMoveToNotebook}
          onBulkToggleFavorite={handleBulkToggleFavorite}
          onOpenInNewTab={handleOpenInNewTab}
          notebooks={notebooks}
          isSidebarCollapsed={isSidebarCollapsed}
          showCreateButton={selectedSmartView !== 'favorites' && contextNotebook?.source_type !== 'local-folder'}
        />
      )}

      {/* Editor Area - TabBar + PaneLayout */}
      {selectedSmartView === 'trash' ? (
        // Empty placeholder for trash view (same background as editor)
        <div className="flex-1 bg-[var(--color-card-solid)]" />
      ) : shouldRenderLocalEditor ? (
        <EditorColumnShell className="bg-[var(--color-card-solid)] no-drag">
          {activeLocalNotebookStatus !== 'active' ? (
            <div className="flex-1 flex flex-col items-center justify-center px-8 gap-3">
              <p className="text-[0.9rem] text-[var(--color-muted)] text-center">
                {activeLocalNotebookStatus === 'permission_required'
                  ? t.notebook.localFolderPermissionRequired
                  : t.notebook.localFolderMissing}
              </p>
              <button
                onClick={() => void handleRecoverLocalFolderAccess(activeLocalNotebookId || undefined)}
                className="px-3 py-1.5 text-[0.8rem] rounded-md text-white bg-[var(--color-accent)] hover:opacity-90 transition-opacity"
              >
                {t.notebook.localFolderRecoverAction}
              </button>
            </div>
          ) : localEditorNote ? (
            <EditorErrorBoundary resetKey={`local-${localEditorNote.id}`}>
              <EditorColumnShell
                testId="local-editor-shell"
                className="relative z-10 no-drag"
              >
                <Editor
                  ref={localEditorRef}
                  note={localEditorNote}
                  notes={editorCandidateNotes}
                  notebooks={notebooks}
                  titleEditable={true}
                  editable={!localEditorLoading}
                  onTitleCommit={commitLocalFileTitleRename}
                  onUpdate={handleUpdateLocalFile}
                  onNoteClick={handleNoteClick}
                  onCreateNote={handleCreateNoteFromLink}
                  onSelectNote={selectSingleNote}
                  onSelectionChange={handleSelectionChange}
                  isFocused={!localEditorLoading}
                />
                {localEditorLoading && (
                  <div
                    data-testid="local-editor-loading-overlay"
                    className="absolute inset-0 z-20 pointer-events-none flex items-center justify-center bg-[color-mix(in_srgb,var(--color-card-solid)_88%,transparent)] backdrop-blur-[1px]"
                    style={{ animation: 'editorLoadingFadeIn 150ms ease-out forwards', opacity: 0 }}
                    aria-live="polite"
                  >
                    <span className="text-[var(--color-muted)] text-[0.9rem]">
                      {t.common?.loading || 'Loading...'}
                    </span>
                  </div>
                )}
              </EditorColumnShell>
            </EditorErrorBoundary>
          ) : localEditorLoading ? (
            <div className="flex-1 flex items-center justify-center text-[var(--color-muted)]">
              {t.common?.loading || 'Loading...'}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center px-8">
              <p className="text-[0.9rem] text-[var(--color-muted)] text-center">
                {t.editor?.selectNote || 'Select a note to start editing'}
              </p>
            </div>
          )}
        </EditorColumnShell>
      ) : !isTypewriterMode ? (
        <EditorColumnShell>
          {/* TabBar */}
          <TabBar
            getNoteTitle={(noteId) => {
              const note = notes.find(n => n.id === noteId)
              const title = note?.title || t.editor?.untitled || 'Untitled'
              return typeof title === 'string' ? title : 'Untitled'
            }}
          />

          {/* PaneLayout with Editors */}
          <PaneLayout
            renderPane={(paneId, noteId, isFocused, panelCount) => {
              // noteId 为 null 表示空 pane
              const note = noteId ? notes.find(n => n.id === noteId) : null
              return (
                <EditorErrorBoundary resetKey={paneId}>
                  <Editor
                    ref={isFocused ? editorRef : undefined}
                    note={note || null}
                    paneId={paneId}
                    notes={editorCandidateNotes}
                    notebooks={notebooks}
                    onUpdate={handleUpdateNote}
                    onNoteClick={handleNoteClick}
                    onCreateNote={handleCreateNoteFromLink}
                    onSelectNote={selectSingleNote}
                    scrollTarget={isFocused ? scrollTarget : null}
                    onScrollComplete={isFocused ? handleScrollComplete : undefined}
                    onTypewriterModeToggle={handleToggleTypewriter}
                    onSelectionChange={isFocused ? handleSelectionChange : undefined}
                    showPaneControls={true}
                    onSplitHorizontal={() => splitPane('row', { fromPaneId: paneId })}
                    onSplitVertical={() => splitPane('column', { fromPaneId: paneId })}
                    onClosePane={panelCount > 1 ? () => closePane(paneId) : undefined}
                    isFocused={isFocused}
                  />
                </EditorErrorBoundary>
              )
            }}
            renderEmpty={() => (
              <div className="h-full flex flex-col bg-[var(--color-card-solid)]">
                <div className="h-[50px] flex-shrink-0" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
                <div className="flex-1 flex flex-col items-center justify-center gap-2">
                  <p className="text-lg font-medium text-[var(--color-muted)]">
                    {t.editor?.selectNote || 'Select a note to start editing'}
                  </p>
                  <p className="text-sm text-[var(--color-muted)] opacity-50">
                    {t.editor?.or || 'or'}
                  </p>
                  <button
                    onClick={async () => {
                      const newNote = await handleCreateNoteFromLink('')
                      selectSingleNote(newNote.id)
                    }}
                    className="text-sm text-[var(--color-muted)] opacity-60 hover:opacity-100 hover:bg-[var(--color-surface)] hover:text-[var(--color-text)] px-4 py-2 rounded-md transition-all"
                  >
                    {t.editor?.createNewNote || 'Create new note'}
                  </button>
                </div>
              </div>
            )}
          />
        </EditorColumnShell>
      ) : null}

      {/* Typewriter Mode - 全屏覆盖层 */}
      {!shouldRenderLocalEditor && isTypewriterMode && selectedNote && (
        <EditorErrorBoundary resetKey={`typewriter-${selectedNote.id}`}>
          <TypewriterMode
            note={selectedNote}
            notes={editorCandidateNotes}
            onUpdate={handleUpdateNote}
            onNoteClick={handleNoteClick}
            onCreateNote={handleCreateNoteFromLink}
            onExit={handleExitTypewriter}
            initialCursorInfo={typewriterCursorInfo}
          />
        </EditorErrorBoundary>
      )}

      {/* Settings Modal */}
      {showSettings && <Settings onClose={handleCloseSettings} initialTab={settingsInitialTab} />}

      {/* Notebook Modal */}
      {showNotebookModal && (
        <NotebookModal
          notebook={editingNotebook}
          onSave={handleSaveNotebook}
          onDelete={editingNotebook ? handleDeleteNotebook : undefined}
          onClose={closeNotebookModal}
        />
      )}

      {internalFolderDialogs.renderDialogs()}
      {localFolderDialogs.renderDialogs()}

      {/* Local Save Conflict Dialog */}
      <Dialog open={!!localSaveConflictDialog} onClose={() => {}} maxWidth="max-w-md" ariaLabel={t.notebook.fileConflictDialogTitle}>
        {localSaveConflictDialog && (
          <>
            <div className="p-5">
              <h2 className="text-[1rem] font-semibold text-[var(--color-text)] mb-2 select-none">
                {t.notebook.fileConflictDialogTitle}
              </h2>
              <p className="text-[0.867rem] text-[var(--color-text-secondary)] select-none">
                {t.notebook.fileConflictDialogMessage.replace('{name}', localSaveConflictDialog.displayName)}
              </p>
            </div>
            <div className="flex justify-end gap-2 px-5 pb-5">
              <button
                onClick={() => void handleResolveLocalSaveConflictReload()}
                disabled={localSaveConflictSubmitting}
                className="px-3 py-2 text-[0.8rem] text-[var(--color-text)] bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 rounded-lg transition-all duration-150 select-none disabled:opacity-60"
              >
                {t.notebook.fileConflictReload}
              </button>
              <button
                onClick={() => void handleResolveLocalSaveConflictSaveAsCopy()}
                disabled={localSaveConflictSubmitting}
                className="px-3 py-2 text-[0.8rem] text-[var(--color-text)] bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 rounded-lg transition-all duration-150 select-none disabled:opacity-60"
              >
                {t.notebook.fileConflictSaveAsCopy}
              </button>
              <button
                onClick={() => void handleResolveLocalSaveConflictOverwrite()}
                disabled={localSaveConflictSubmitting}
                className="px-3 py-2 text-[0.8rem] text-white bg-[var(--color-accent)] hover:opacity-90 rounded-lg transition-all duration-150 select-none disabled:opacity-60"
              >
                {t.notebook.fileConflictOverwrite}
              </button>
            </div>
          </>
        )}
      </Dialog>

      {notebookDeleteDialog.renderDialog()}

      {/* AI Chat Floating Button */}
      <AIChatDialog />

      {/* Image Lightbox */}
      <ImageLightbox />
    </div>
  )
}

function App() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <UpdateProvider>
          <TabProvider>
            <ErrorBoundary>
              <AppContent />
            </ErrorBoundary>
          </TabProvider>
        </UpdateProvider>
      </I18nProvider>
    </ThemeProvider>
  )
}

export default App
