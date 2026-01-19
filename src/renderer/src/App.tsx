import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { Sidebar } from './components/Sidebar'
import { NoteList } from './components/NoteList'
import { TrashList } from './components/TrashList'
import { DailyView } from './components/DailyView'
import { Editor, type EditorHandle } from './components/Editor'
import { EditorErrorBoundary } from './components/ErrorBoundary'
import { Settings } from './components/Settings'
import { NotebookModal } from './components/NotebookModal'
import { TypewriterMode } from './components/TypewriterMode'
import { AIChatDialog, openChatWithContext } from './components/AIChatDialog'
import { IMAGE_LIGHTBOX_EVENT } from './components/ResizableImageView'
import { TabBar } from './components/TabBar'
import { PaneLayout } from './components/PaneLayout'
import { TabProvider, useTabs } from './contexts/TabContext'
import { ThemeProvider } from './theme'
import { I18nProvider, useTranslations, useI18n } from './i18n'
import { getCursorInfo, setCursorByBlockId, type CursorInfo, type CursorContext } from './utils/cursor'
import { formatDailyDate } from './utils/dateFormat'
import { toast } from './utils/toast'
import { useChatShortcut } from './utils/shortcut'
import { RECENT_DAYS, type Note, type Notebook, type NoteSearchFilter, type SmartViewId } from './types/note'

// 全局 Lightbox 组件
function ImageLightbox() {
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [imageAlt, setImageAlt] = useState<string>('')
  const [scale, setScale] = useState(1)
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null)
  const [isReady, setIsReady] = useState(false)

  // 计算合适的初始缩放比例（fit to screen，最多 200%）
  const calculateFitScale = useCallback((naturalWidth: number, naturalHeight: number) => {
    const maxWidth = window.innerWidth * 0.9
    const maxHeight = window.innerHeight * 0.9
    const fitScale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight)
    return Math.min(fitScale, 2)
  }, [])

  // 预加载图片，获取尺寸后再显示
  useEffect(() => {
    const handleOpen = (e: CustomEvent<{ src: string; alt?: string }>) => {
      const { src, alt } = e.detail
      setImageAlt(alt || '')

      // 预加载图片
      const img = new Image()
      img.onload = () => {
        const initialScale = calculateFitScale(img.naturalWidth, img.naturalHeight)
        setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight })
        setScale(initialScale)
        setImageSrc(src)
        // 下一帧显示，确保状态已更新
        requestAnimationFrame(() => setIsReady(true))
      }
      img.onerror = () => {
        console.error('Failed to load image:', src)
        // 加载失败时重置状态
        setImageSrc(null)
        setIsReady(false)
      }
      img.src = src
    }

    window.addEventListener(IMAGE_LIGHTBOX_EVENT, handleOpen as EventListener)
    return () => window.removeEventListener(IMAGE_LIGHTBOX_EVENT, handleOpen as EventListener)
  }, [calculateFitScale])

  const handleZoomIn = useCallback(() => {
    setScale(s => Math.min(s + 0.25, 3))
  }, [])

  const handleZoomOut = useCallback(() => {
    setScale(s => Math.max(s - 0.25, 0.25))
  }, [])

  const handleResetZoom = useCallback(() => {
    if (naturalSize) {
      setScale(calculateFitScale(naturalSize.width, naturalSize.height))
    }
  }, [naturalSize, calculateFitScale])

  const handleClose = useCallback(() => {
    setImageSrc(null)
    setImageAlt('')
    setScale(1)
    setNaturalSize(null)
    setIsReady(false)
  }, [])

  // 键盘事件
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!imageSrc) return
      if (e.key === 'Escape') {
        handleClose()
      } else if (e.key === '+' || e.key === '=') {
        handleZoomIn()
      } else if (e.key === '-') {
        handleZoomOut()
      } else if (e.key === '0') {
        handleResetZoom()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [imageSrc, handleClose, handleZoomIn, handleZoomOut, handleResetZoom])

  if (!imageSrc || !isReady) return null

  return createPortal(
    <div className="lightbox-overlay" onClick={handleClose}>
      <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
        <img
          src={imageSrc}
          alt={imageAlt}
          className="lightbox-image"
          style={{ transform: `scale(${scale})` }}
        />
      </div>

      {/* 缩放控制栏 */}
      <div className="lightbox-controls" onClick={(e) => e.stopPropagation()}>
        <button className="lightbox-control-btn" onClick={handleZoomOut} aria-label="Zoom out">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="8" y1="11" x2="14" y2="11" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
        <span className="lightbox-scale">{Math.round(scale * 100)}%</span>
        <button className="lightbox-control-btn" onClick={handleZoomIn} aria-label="Zoom in">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="11" y1="8" x2="11" y2="14" />
            <line x1="8" y1="11" x2="14" y2="11" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
      </div>

      <button className="lightbox-close" onClick={handleClose} aria-label="Close">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>,
    document.body
  )
}

// localStorage keys for navigation state persistence
const STORAGE_KEY_VIEW = 'sanqian-notes-last-view'
const STORAGE_KEY_NOTEBOOK = 'sanqian-notes-last-notebook'
const STORAGE_KEY_NOTE = 'sanqian-notes-last-note'

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
  const [trashNotes, setTrashNotes] = useState<Note[]>([])

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
  // Anchor note for Shift+Click range selection (set on normal click, preserved on Cmd+Click)
  const [anchorNoteId, setAnchorNoteId] = useState<string | null>(null)

  const [showSettings, setShowSettings] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  // Notebook modal state
  const [showNotebookModal, setShowNotebookModal] = useState(false)
  const [editingNotebook, setEditingNotebook] = useState<Notebook | null>(null)

  // Delete confirmation state
  const [notebookToDelete, setNotebookToDelete] = useState<Notebook | null>(null)

  // Typewriter mode state
  const [isTypewriterMode, setIsTypewriterMode] = useState(false)
  const [typewriterCursorInfo, setTypewriterCursorInfo] = useState<CursorInfo | undefined>(undefined)

  // Sidebar collapsed state
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)

  // Chat shortcut for global keyboard handler
  const chatShortcut = useChatShortcut()

  // Editor selection state (for context provider sync)
  const [currentBlockId, setCurrentBlockId] = useState<string | null>(null)
  const [selectedText, setSelectedText] = useState<string | null>(null)
  const [cursorContext, setCursorContext] = useState<CursorContext | null>(null)

  // Editor ref for cursor position sync
  const editorRef = useRef<EditorHandle>(null)

  // 使用 ref 保存 notes，避免 triggerIndexCheck 依赖 notes 导致的性能问题
  const notesRef = useRef<Note[]>(notes)
  notesRef.current = notes

  // Debounce timer for index check
  const indexCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 触发增量索引检查（失焦时调用）
  // Debounce 300ms 避免快速切换时的大量 IPC 调用
  // 注意：快速切换 A→B→C 时，只有最后停留的 B 会被索引
  // A 的索引会在下次访问 A 时触发，这是可接受的权衡
  const triggerIndexCheck = useCallback((noteId: string | null) => {
    if (!noteId) return

    // 清除之前的 timer（取消排队中的索引请求）
    if (indexCheckTimerRef.current) {
      clearTimeout(indexCheckTimerRef.current)
    }

    indexCheckTimerRef.current = setTimeout(() => {
      const note = notesRef.current.find(n => n.id === noteId)
      if (note) {
        window.electron.note.checkIndex(
          note.id,
          note.notebook_id || '',
          note.content
        ).catch(console.error)
      }
    }, 300)
  }, [])

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

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (indexCheckTimerRef.current) {
        clearTimeout(indexCheckTimerRef.current)
      }
    }
  }, [])

  // Load data from database and validate restored navigation state
  useEffect(() => {
    async function loadData() {
      try {
        const [notesData, notebooksData, trashData] = await Promise.all([
          window.electron.note.getAll(),
          window.electron.notebook.getAll(),
          window.electron.trash.getAll()
        ])
        const loadedNotes = notesData as Note[]
        const loadedNotebooks = notebooksData as Notebook[]
        setNotes(loadedNotes)
        setNotebooks(loadedNotebooks)
        setTrashNotes(trashData as Note[])

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
          const noteExists = loadedNotes.some(n => n.id === savedNoteId)
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
  }, [])

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

  useEffect(() => {
    try {
      // Persist only the last selected note (single note for restore)
      const lastNoteId = selectedNoteIds[selectedNoteIds.length - 1]
      if (lastNoteId) {
        localStorage.setItem(STORAGE_KEY_NOTE, lastNoteId)
      } else {
        localStorage.removeItem(STORAGE_KEY_NOTE)
      }
    } catch { /* ignore storage errors */ }
  }, [selectedNoteIds])

  // Derive current notebook/note for context sync
  const contextNotebook = useMemo(
    () => (selectedNotebookId ? notebooks.find(nb => nb.id === selectedNotebookId) : null),
    [selectedNotebookId, notebooks]
  )
  // Last selected note ID for editor display
  const selectedNoteId = selectedNoteIds[selectedNoteIds.length - 1] || null
  // Use tab's focused note if available (for multi-tab/split scenarios)
  const contextNoteId = tabFocusedNoteId || selectedNoteId
  const contextNote = useMemo(
    () => (contextNoteId ? notes.find(n => n.id === contextNoteId) : null),
    [contextNoteId, notes]
  )

  // Handler for editor selection changes (for context provider)
  const handleSelectionChange = useCallback((blockId: string | null, text: string | null, ctx: CursorContext | null) => {
    setCurrentBlockId(blockId)
    setSelectedText(text)
    setCursorContext(ctx)
  }, [])

  // Sync user context to main process (for agent tools)
  // Depends on derived values to capture both selection changes and renames
  // Note: blockId and selectedText are only meaningful when we have valid note context
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

  // Listen for data changes from SDK tool calls
  useEffect(() => {
    const cleanup = window.electron.note.onDataChanged(async () => {
      console.log('[App] Data changed, reloading data...')
      try {
        // Reload both notes and notebooks (similar to TodoList pattern)
        const [notesData, notebooksData] = await Promise.all([
          window.electron.note.getAll(),
          window.electron.notebook.getAll()
        ])
        setNotes(notesData as Note[])
        setNotebooks(notebooksData as Notebook[])
      } catch (error) {
        console.error('[App] Failed to reload data:', error)
      }
    })
    return cleanup
  }, [])

  // Listen for summary updates (real-time update when AI generates summary)
  useEffect(() => {
    const cleanup = window.electron.note.onSummaryUpdated(async (noteId: string) => {
      console.log('[App] Summary updated for note:', noteId)
      try {
        const updatedNote = await window.electron.note.getById(noteId)
        if (updatedNote) {
          setNotes(prev => prev.map(n => n.id === noteId ? updatedNote : n))
        }
      } catch (error) {
        console.error('[App] Failed to update note summary:', error)
      }
    })
    return cleanup
  }, [])

  // Listen for "continue in chat" from popup window
  useEffect(() => {
    const cleanup = window.electron.popup.onContinueInChat((selectedText, explanation) => {
      openChatWithContext({ selectedText, explanation })
    })
    return cleanup
  }, [])

  // Filter notes based on current view
  const filteredNotes = useMemo(() => {
    if (selectedNotebookId) {
      // Notebooks only show regular notes, not daily notes
      return notes.filter(n => n.notebook_id === selectedNotebookId && !n.is_daily)
    }
    switch (selectedSmartView) {
      case 'all':
        // All notes excludes daily notes (they have their own view)
        return notes.filter(n => !n.is_daily)
      case 'daily':
        // Daily notes sorted by daily_date DESC (newest first)
        return notes
          .filter(n => n.is_daily)
          .sort((a, b) => (b.daily_date || '').localeCompare(a.daily_date || ''))
      case 'recent':
        // Notes updated in the last N days (excluding daily notes)
        const recentThreshold = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000
        return notes.filter(n => !n.is_daily && new Date(n.updated_at).getTime() > recentThreshold)
      case 'favorites':
        // Favorites can include daily notes (user explicitly favorited them)
        return notes.filter(n => n.is_favorite)
      default:
        return notes.filter(n => !n.is_daily)
    }
  }, [notes, selectedSmartView, selectedNotebookId])

  // Get note counts
  const noteCounts = useMemo(() => {
    const recentThreshold = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000
    const regularNotes = notes.filter(n => !n.is_daily)
    return {
      all: regularNotes.length,
      daily: notes.filter(n => n.is_daily).length,
      recent: regularNotes.filter(n => new Date(n.updated_at).getTime() > recentThreshold).length,
      favorites: notes.filter(n => n.is_favorite).length,
      trash: trashNotes.length,
      notebooks: notebooks.reduce((acc, nb) => {
        acc[nb.id] = regularNotes.filter(n => n.notebook_id === nb.id).length
        return acc
      }, {} as Record<string, number>),
    }
  }, [notes, notebooks, trashNotes])

  // Get selected note - use tab's focused note if available
  const effectiveNoteId = tabFocusedNoteId || selectedNoteId
  const selectedNote = useMemo(() => {
    return notes.find(n => n.id === effectiveNoteId) || null
  }, [notes, effectiveNoteId])

  // Check if a note is empty (no title and no content)
  // Atom nodes (dataview, embed, transclusion, mermaid) count as content
  const isNoteEmpty = useCallback((note: Note | null): boolean => {
    if (!note) return false
    const hasTitle = note.title && note.title.trim() !== ''
    let hasContent = false
    if (note.content && note.content !== '[]' && note.content !== '') {
      try {
        const parsed = JSON.parse(note.content)
        // Check Tiptap format
        if (parsed.type === 'doc' && parsed.content) {
          // Atom node types that count as content even without text
          const atomNodeTypes = ['dataviewBlock', 'embedBlock', 'transclusionBlock', 'mermaidBlock']
          const checkContent = (node: { type?: string; text?: string; content?: unknown[] }): boolean => {
            // Atom nodes count as content
            if (node.type && atomNodeTypes.includes(node.type)) {
              return true
            }
            // Text nodes count as content
            if (node.text && node.text.trim() !== '') {
              return true
            }
            // Recursively check children
            if (node.content && Array.isArray(node.content)) {
              return node.content.some(child =>
                checkContent(child as { type?: string; text?: string; content?: unknown[] })
              )
            }
            return false
          }
          hasContent = checkContent(parsed)
        }
      } catch {
        hasContent = note.content.trim() !== ''
      }
    }
    return !hasTitle && !hasContent
  }, [])

  // Delete empty note if switching away from it (permanently, not to trash)
  // Uses notesRef to always get the latest notes (avoids closure issues)
  const deleteEmptyNoteIfNeeded = useCallback(async (noteId: string | null) => {
    if (!noteId) return
    const note = notesRef.current.find(n => n.id === noteId)
    if (note && isNoteEmpty(note)) {
      // Empty notes are permanently deleted, not moved to trash
      await window.electron.trash.permanentDelete(noteId)
      setNotes(prev => prev.filter(n => n.id !== noteId))
    }
  }, [isNoteEmpty])

  // Track previous tabFocusedNoteId for empty note cleanup
  const prevTabFocusedNoteIdRef = useRef<string | null>(null)

  // Sync NoteList selection when pane focus changes
  // If the focused note is in the current list, select it; otherwise clear selection
  // Also check if previous note was empty and should be deleted
  useEffect(() => {
    const prevNoteId = prevTabFocusedNoteIdRef.current

    // Check if previous note was empty and delete it
    if (prevNoteId && prevNoteId !== tabFocusedNoteId) {
      deleteEmptyNoteIfNeeded(prevNoteId)
    }

    // Update selection based on new focused note
    if (tabFocusedNoteId) {
      const isInList = filteredNotes.some(n => n.id === tabFocusedNoteId)
      if (isInList) {
        setSelectedNoteIds([tabFocusedNoteId])
        setAnchorNoteId(tabFocusedNoteId)
      } else {
        // Note is not in current list (different notebook/view), clear selection
        setSelectedNoteIds([])
        setAnchorNoteId(null)
      }
    }

    // Update ref for next comparison
    prevTabFocusedNoteIdRef.current = tabFocusedNoteId
  }, [tabFocusedNoteId, filteredNotes, deleteEmptyNoteIfNeeded])

  // Helper to select a single note and set anchor (for consistency)
  // Also handles cleanup of empty notes when switching away
  const selectSingleNote = useCallback((noteId: string) => {
    const prevNoteId = selectedNoteId

    // First update selection and open new note
    setSelectedNoteIds([noteId])
    setAnchorNoteId(noteId)
    openNoteInPane(noteId)

    // Then delete previous empty note if switching away
    // Run in background without blocking selection
    if (prevNoteId && prevNoteId !== noteId) {
      deleteEmptyNoteIfNeeded(prevNoteId)
    }
  }, [selectedNoteId, deleteEmptyNoteIfNeeded, openNoteInPane])

  // Handle selecting a note (with empty note cleanup and index check)
  // Supports multi-select with Cmd/Ctrl+Click (toggle) and Shift+Click (range)
  const handleSelectNote = useCallback((noteId: string, event?: React.MouseEvent) => {
    const isMultiSelectKey = event && (event.metaKey || event.ctrlKey)
    const isRangeSelectKey = event && event.shiftKey

    // Single click without modifiers: clear selection and select only this note
    if (!isMultiSelectKey && !isRangeSelectKey) {
      // Don't do anything if selecting the same single note
      if (selectedNoteIds.length === 1 && selectedNoteIds[0] === noteId) return

      // Trigger incremental index check for the note being left
      triggerIndexCheck(selectedNoteId)

      // Delete empty note if switching away from it
      // Run in background without blocking selection
      if (selectedNoteId && selectedNoteId !== noteId) {
        deleteEmptyNoteIfNeeded(selectedNoteId)
      }

      setSelectedNoteIds([noteId])
      setAnchorNoteId(noteId)  // Set anchor on normal click

      // Open note in current pane (tab system)
      openNoteInPane(noteId)
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
          const rangeIds = filteredNotes.slice(start, end + 1).map(n => n.id)
          setSelectedNoteIds(rangeIds)
        }
      }
    }
  }, [selectedNoteIds, selectedNoteId, anchorNoteId, filteredNotes, triggerIndexCheck, deleteEmptyNoteIfNeeded, openNoteInPane])

  // Listen for note:navigate events (from Dataview, Transclusion, etc.)
  useEffect(() => {
    const handleNoteNavigate = (event: CustomEvent<{ noteId: string }>) => {
      const { noteId } = event.detail
      if (noteId) {
        handleSelectNote(noteId)
      }
    }
    window.addEventListener('note:navigate', handleNoteNavigate as EventListener)
    return () => {
      window.removeEventListener('note:navigate', handleNoteNavigate as EventListener)
    }
  }, [handleSelectNote])

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

  // Handle selecting a notebook
  const handleSelectNotebook = useCallback(async (id: string | null) => {
    // Trigger incremental index check for the note being left
    triggerIndexCheck(selectedNoteId)
    await deleteEmptyNoteIfNeeded(selectedNoteId)
    setSelectedNotebookId(id)
    setSelectedSmartView(null)
    setSelectedNoteIds([])
    setAnchorNoteId(null)
  }, [selectedNoteId, triggerIndexCheck, deleteEmptyNoteIfNeeded])

  // Handle selecting a smart view
  const handleSelectSmartView = useCallback(async (view: SmartViewId) => {
    // Trigger incremental index check for the note being left
    triggerIndexCheck(selectedNoteId)
    await deleteEmptyNoteIfNeeded(selectedNoteId)
    setSelectedSmartView(view)
    setSelectedNotebookId(null)

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
          // Use flushSync to ensure notes state is updated before selecting
          flushSync(() => {
            setNotes(prev => {
              const newNotes = [newNote as Note, ...prev]
              return newNotes.sort((a, b) => {
                if (a.is_pinned !== b.is_pinned) return b.is_pinned ? 1 : -1
                return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
              })
            })
          })
          selectSingleNote((newNote as Note).id)
        } catch (error) {
          console.error('Failed to create today daily note:', error)
          setSelectedNoteIds([])
          setAnchorNoteId(null)
        }
      }
    } else {
      setSelectedNoteIds([])
      setAnchorNoteId(null)
    }
  }, [selectedNoteId, triggerIndexCheck, deleteEmptyNoteIfNeeded, notes, isZh, selectSingleNote])

  // Handle creating a new note
  const handleCreateNote = useCallback(async () => {
    try {
      const newNote = await window.electron.note.add({
        title: '',
        content: '[]',
        notebook_id: selectedNotebookId,
        is_daily: selectedSmartView === 'daily',
        daily_date: selectedSmartView === 'daily' ? new Date().toISOString().split('T')[0] : null,
        is_favorite: false,
      })
      // Use flushSync to ensure notes state is updated before selecting
      flushSync(() => {
        setNotes(prev => {
          const newNotes = [newNote as Note, ...prev]
          // Re-sort: pinned first, then by updated_at
          return newNotes.sort((a, b) => {
            if (a.is_pinned !== b.is_pinned) return b.is_pinned ? 1 : -1
            return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
          })
        })
      })
      selectSingleNote((newNote as Note).id)
    } catch (error) {
      console.error('Failed to create note:', error)
    }
  }, [selectedNotebookId, selectedSmartView, selectSingleNote])

  // Handle opening note in new tab
  const handleOpenInNewTab = useCallback((noteId: string) => {
    createTab(noteId)
  }, [createTab])

  // Handle creating a daily note for a specific date
  const handleCreateDaily = useCallback(async (date: string) => {
    try {
      // Check if daily already exists for this date
      const existing = notes.find(n => n.is_daily && n.daily_date === date)
      if (existing) {
        selectSingleNote(existing.id)
        return
      }

      // Generate localized title
      const title = formatDailyDate(date, isZh)
      const newNote = await window.electron.daily.create(date, title)
      // Use flushSync to ensure notes state is updated before selecting
      flushSync(() => {
        setNotes(prev => {
          const newNotes = [newNote as Note, ...prev]
          return newNotes.sort((a, b) => {
            if (a.is_pinned !== b.is_pinned) return b.is_pinned ? 1 : -1
            return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
          })
        })
      })
      selectSingleNote((newNote as Note).id)
    } catch (error) {
      console.error('Failed to create daily note:', error)
    }
  }, [notes, isZh, selectSingleNote])

  // Handle updating a note
  const handleUpdateNote = useCallback(async (id: string, updates: { title?: string; content?: string }) => {
    try {
      const updatedNote = await window.electron.note.update(id, updates)
      if (updatedNote) {
        setNotes(prev => prev.map(note => note.id === id ? updatedNote as Note : note))
      }
    } catch (error) {
      console.error('Failed to update note:', error)
    }
  }, [])

  // 跳转目标（用于跳转到标题/block）
  const [scrollTarget, setScrollTarget] = useState<{ type: 'heading' | 'block'; value: string } | null>(null)

  // Handle clicking a note link (支持标题和 block 定位)
  // 智能导航逻辑：
  // 1. 如果笔记不存在，toast 提示
  // 2. 如果当前 pane 已经打开这个笔记，只处理 scrollTarget
  // 3. 如果当前 pane 是空白的，在当前 pane 打开
  // 4. 如果笔记在其他 tab/pane 已打开，跳转过去
  // 5. 否则在新 tab 打开
  const handleNoteClick = useCallback((noteId: string, target?: { type: 'heading' | 'block'; value: string }) => {
    // 检查笔记是否存在
    const noteExists = notes.some(n => n.id === noteId)
    if (!noteExists) {
      toast(t.noteLink?.noteNotFound || 'Note not found', { type: 'error' })
      return
    }

    // 设置滚动目标
    if (target) {
      setScrollTarget(target)
    } else {
      setScrollTarget(null)
    }

    // 如果当前 pane 已经打开这个笔记，不需要切换
    if (tabFocusedNoteId === noteId) {
      return
    }

    // 检查笔记是否在其他 tab/pane 已打开（优先跳转到已打开的位置）
    const existingPane = findPaneWithNote(noteId)
    if (existingPane) {
      selectTab(existingPane.tabId)
      focusPane(existingPane.paneId, existingPane.tabId)
      return
    }

    // 如果当前 pane 是空白的，在当前 pane 打开
    if (tabFocusedNoteId === null && focusedPaneId) {
      openNoteInPane(noteId)
      return
    }

    // 在新 tab 打开
    createTab(noteId)
  }, [notes, t, tabFocusedNoteId, focusedPaneId, openNoteInPane, findPaneWithNote, selectTab, focusPane, createTab])

  // Listen for note:navigate IPC events (from chat window via sanqian-notes:// links)
  useEffect(() => {
    const cleanup = window.electron.note.onNavigate((data: { noteId: string; target?: { type: 'heading' | 'block'; value: string } }) => {
      const { noteId, target } = data
      handleNoteClick(noteId, target)
    })
    return cleanup
  }, [handleNoteClick])

  // 清除滚动目标的回调
  const handleScrollComplete = useCallback((found: boolean) => {
    if (!found && scrollTarget) {
      const typeText = scrollTarget.type === 'heading'
        ? (t.noteLink?.headingNotFound || 'Heading not found')
        : (t.noteLink?.blockNotFound || 'Block not found')
      toast(`${typeText}: ${scrollTarget.value}`, { type: 'error' })
    }
    setScrollTarget(null)
  }, [scrollTarget, t])

  // Handle creating a note from link (returns the created note)
  const handleCreateNoteFromLink = useCallback(async (title: string): Promise<Note> => {
    const newNote = await window.electron.note.add({
      title,
      content: '[]',
      notebook_id: selectedNotebookId,
      is_daily: false,
      daily_date: null,
      is_favorite: false,
    })
    // 使用 flushSync 确保状态同步更新，避免 handleNoteClick 找不到新笔记
    flushSync(() => {
      setNotes(prev => {
        const newNotes = [newNote as Note, ...prev]
        // Re-sort: pinned first, then by updated_at
        return newNotes.sort((a, b) => {
          if (a.is_pinned !== b.is_pinned) return b.is_pinned ? 1 : -1
          return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        })
      })
    })
    return newNote as Note
  }, [selectedNotebookId])

  // Handle toggle pinned
  const handleTogglePinned = useCallback(async (id: string) => {
    try {
      const note = notes.find(n => n.id === id)
      if (!note) return

      const updated = await window.electron.note.update(id, { is_pinned: !note.is_pinned })
      if (updated) {
        setNotes(prev => {
          const newNotes = prev.map(n => n.id === id ? updated as Note : n)
          // Re-sort: pinned first, then by updated_at
          return newNotes.sort((a, b) => {
            if (a.is_pinned !== b.is_pinned) return b.is_pinned ? 1 : -1
            return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
          })
        })
      }
    } catch (error) {
      console.error('Failed to toggle pinned:', error)
    }
  }, [notes])

  // Handle toggle favorite
  const handleToggleFavorite = useCallback(async (id: string) => {
    try {
      const note = notes.find(n => n.id === id)
      if (!note) return

      const updated = await window.electron.note.update(id, { is_favorite: !note.is_favorite })
      if (updated) {
        setNotes(prev => prev.map(n => n.id === id ? updated as Note : n))
      }
    } catch (error) {
      console.error('Failed to toggle favorite:', error)
    }
  }, [notes])

  // Handle move note(s) to notebook - supports both single and bulk
  const handleMoveToNotebook = useCallback(async (noteIdOrIds: string | string[], notebookId: string | null) => {
    const ids = Array.isArray(noteIdOrIds) ? noteIdOrIds : [noteIdOrIds]
    try {
      for (const id of ids) {
        await window.electron.note.update(id, { notebook_id: notebookId })
      }
      setNotes(prev => prev.map(n =>
        ids.includes(n.id) ? { ...n, notebook_id: notebookId } : n
      ))
    } catch (error) {
      console.error('Failed to move note(s) to notebook:', error)
    }
  }, [])

  // Handle reorder notebooks
  const handleReorderNotebooks = useCallback(async (orderedIds: string[]) => {
    try {
      // Optimistic update: reorder local state first
      setNotebooks(prev => {
        const notebookMap = new Map(prev.map(n => [n.id, n]))
        // Only include ids that exist in current state
        const reordered = orderedIds
          .filter(id => notebookMap.has(id))
          .map((id, index) => ({ ...notebookMap.get(id)!, order_index: index }))
        // Validate: must have same count
        if (reordered.length !== prev.length) {
          console.warn('Reorder mismatch, keeping original order')
          return prev
        }
        return reordered
      })
      await window.electron.notebook.reorder(orderedIds)
    } catch (error) {
      console.error('Failed to reorder notebooks:', error)
      // Reload from database on error
      try {
        const fresh = await window.electron.notebook.getAll()
        setNotebooks(fresh)
      } catch (reloadError) {
        console.error('Failed to reload notebooks:', reloadError)
      }
    }
  }, [])

  // Handle delete note (soft delete - move to trash)
  const handleDeleteNote = useCallback(async (id: string) => {
    try {
      const noteToDelete = notes.find(n => n.id === id)
      await window.electron.note.delete(id)
      setNotes(prev => prev.filter(n => n.id !== id))
      if (noteToDelete) {
        // Add to trash with deleted_at timestamp
        setTrashNotes(prev => [{
          ...noteToDelete,
          deleted_at: new Date().toISOString()
        }, ...prev])
      }
      // Remove from selection
      setSelectedNoteIds(prev => prev.filter(nid => nid !== id))
    } catch (error) {
      console.error('Failed to delete note:', error)
    }
  }, [notes])

  // Handle duplicate note
  const handleDuplicateNote = useCallback(async (id: string) => {
    try {
      const noteToDuplicate = notes.find(n => n.id === id)
      if (!noteToDuplicate) return

      const suffix = isZh ? '副本' : 'Copy'
      const originalTitle = noteToDuplicate.title || ''

      // Strip existing copy suffix to get base title
      // Match patterns like "Title 副本", "Title 副本 2", "Title Copy", "Title Copy 3"
      const suffixPattern = new RegExp(`^(.+?)\\s*${suffix}(?:\\s*(\\d+))?$`)
      const match = originalTitle.match(suffixPattern)
      const baseTitle = match ? match[1].trim() : originalTitle

      // Find all existing copies of the base title
      const copyPattern = new RegExp(`^${baseTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+${suffix}(?:\\s+(\\d+))?$`)
      let maxNumber = 0
      for (const note of notes) {
        if (!note.title) continue
        const copyMatch = note.title.match(copyPattern)
        if (copyMatch) {
          const num = copyMatch[1] ? parseInt(copyMatch[1], 10) : 1
          if (num > maxNumber) maxNumber = num
        }
      }

      // Generate new title: "Title 副本" for first copy, "Title 副本 2" for second, etc.
      const newTitle = baseTitle
        ? (maxNumber === 0 ? `${baseTitle} ${suffix}` : `${baseTitle} ${suffix} ${maxNumber + 1}`)
        : suffix  // Handle empty title case

      const newNote = await window.electron.note.add({
        title: newTitle,
        content: noteToDuplicate.content,
        notebook_id: noteToDuplicate.notebook_id,
        is_daily: false,  // Duplicates are never daily notes
        daily_date: null,
        is_favorite: false,  // Don't copy favorite status
      })

      setNotes(prev => {
        const newNotes = [newNote as Note, ...prev]
        return newNotes.sort((a, b) => {
          if (a.is_pinned !== b.is_pinned) return b.is_pinned ? 1 : -1
          return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        })
      })
      selectSingleNote((newNote as Note).id)
    } catch (error) {
      console.error('Failed to duplicate note:', error)
    }
  }, [notes, isZh, selectSingleNote])

  // Handle search - keyword search only
  // Results are filtered based on current view (notebook, daily, favorites, etc.)
  const handleSearch = useCallback(async (query: string): Promise<Note[]> => {
    // Build filter based on current view
    const filter: NoteSearchFilter = selectedNotebookId
      ? { notebookId: selectedNotebookId }
      : { viewType: selectedSmartView || 'all' }

    return window.electron.note.search(query, filter)
  }, [selectedNotebookId, selectedSmartView])

  // Handle restore note from trash
  const handleRestoreNote = useCallback(async (id: string) => {
    try {
      const success = await window.electron.trash.restore(id)
      if (success) {
        setTrashNotes(prev => {
          const restoredNote = prev.find(n => n.id === id)
          if (restoredNote) {
            // Update updated_at to now so it appears at top of non-pinned notes
            const now = new Date().toISOString()
            const noteToRestore = { ...restoredNote, deleted_at: null, updated_at: now }
            setNotes(notesPrev => {
              const newNotes = [noteToRestore, ...notesPrev]
              // Re-sort: pinned first, then by updated_at
              return newNotes.sort((a, b) => {
                if (a.is_pinned !== b.is_pinned) return b.is_pinned ? 1 : -1
                return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
              })
            })
          }
          return prev.filter(n => n.id !== id)
        })
      }
    } catch (error) {
      console.error('Failed to restore note:', error)
    }
  }, [])

  // Handle permanent delete
  const handlePermanentDelete = useCallback(async (id: string) => {
    try {
      await window.electron.trash.permanentDelete(id)
      setTrashNotes(prev => prev.filter(n => n.id !== id))
    } catch (error) {
      console.error('Failed to permanently delete note:', error)
    }
  }, [])

  // Handle empty trash
  const handleEmptyTrash = useCallback(async () => {
    try {
      await window.electron.trash.empty()
      setTrashNotes([])
    } catch (error) {
      console.error('Failed to empty trash:', error)
    }
  }, [])

  // Handle opening notebook modal for creating
  const handleAddNotebook = useCallback(() => {
    setEditingNotebook(null)
    setShowNotebookModal(true)
  }, [])

  // Handle opening notebook modal for editing
  const handleEditNotebook = useCallback((notebook: Notebook) => {
    setEditingNotebook(notebook)
    setShowNotebookModal(true)
  }, [])

  // Handle saving notebook (create or update)
  const handleSaveNotebook = useCallback(async (data: { name: string; icon: string }) => {
    try {
      if (editingNotebook) {
        // Update existing
        const updated = await window.electron.notebook.update(editingNotebook.id, data)
        if (updated) {
          setNotebooks(prev => prev.map(nb => nb.id === editingNotebook.id ? updated as Notebook : nb))
        }
      } else {
        // Create new
        const newNotebook = await window.electron.notebook.add(data)
        setNotebooks(prev => [...prev, newNotebook as Notebook])
      }
      setShowNotebookModal(false)
      setEditingNotebook(null)
    } catch (error) {
      console.error('Failed to save notebook:', error)
    }
  }, [editingNotebook])

  // Handle showing delete confirmation
  const handleShowDeleteConfirm = useCallback((notebook: Notebook) => {
    setNotebookToDelete(notebook)
  }, [])

  // Handle confirming notebook deletion
  // Note: Database has ON DELETE SET NULL for notebook_id, but we explicitly
  // soft-delete notes first to move them to trash (better UX than orphaning them)
  const handleConfirmDeleteNotebook = useCallback(async () => {
    if (!notebookToDelete) return

    try {
      // Soft-delete all notes in this notebook first (move to trash)
      const notesInNotebook = notes.filter(n => n.notebook_id === notebookToDelete.id)
      for (const note of notesInNotebook) {
        await window.electron.note.delete(note.id)
      }

      // Delete the notebook
      const success = await window.electron.notebook.delete(notebookToDelete.id)
      if (success) {
        setNotebooks(prev => prev.filter(nb => nb.id !== notebookToDelete.id))
        setNotes(prev => prev.filter(n => n.notebook_id !== notebookToDelete.id))
        // Add deleted notes to trash
        const now = new Date().toISOString()
        setTrashNotes(prev => [
          ...notesInNotebook.map(n => ({ ...n, deleted_at: now })),
          ...prev
        ])
        // If the deleted notebook was selected, go back to all notes
        if (selectedNotebookId === notebookToDelete.id) {
          setSelectedNotebookId(null)
          setSelectedSmartView('all')
        }
        // Remove deleted notes from selection
        const deletedIds = new Set(notesInNotebook.map(n => n.id))
        setSelectedNoteIds(prev => prev.filter(id => !deletedIds.has(id)))
      }
      setNotebookToDelete(null)
    } catch (error) {
      console.error('Failed to delete notebook:', error)
    }
  }, [notebookToDelete, notes, selectedNotebookId])

  // Handle deleting notebook from modal (legacy, keep for modal delete button)
  const handleDeleteNotebook = useCallback(async () => {
    if (!editingNotebook) return
    handleShowDeleteConfirm(editingNotebook)
    setShowNotebookModal(false)
    setEditingNotebook(null)
  }, [editingNotebook, handleShowDeleteConfirm])

  // Handle settings toggle
  const handleOpenSettings = useCallback(() => {
    setShowSettings(true)
  }, [])

  const handleCloseSettings = useCallback(() => {
    setShowSettings(false)
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
        const updatedNote = await window.electron.note.getById(selectedNoteId)
        if (updatedNote) {
          setNotes(prev => prev.map(n => n.id === selectedNoteId ? updatedNote as Note : n))
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
  }, [selectedNoteId, scrollEditorToCursor])

  // 从 editor 获取当前光标信息
  const getCursorInfoFromEditor = useCallback((): CursorInfo => {
    const editor = editorRef.current?.getEditor() ?? null
    return getCursorInfo(editor) || { blockId: '', offsetInBlock: 0 }
  }, [])

  // Keyboard shortcuts
  // 使用 ref 保存最新的回调和状态，避免频繁注册/卸载事件监听器
  const isTypewriterModeRef = useRef(isTypewriterMode)
  const handleToggleTypewriterRef = useRef(handleToggleTypewriter)
  const getCursorInfoFromEditorRef = useRef(getCursorInfoFromEditor)
  const handleCreateNoteRef = useRef(handleCreateNote)
  const selectedSmartViewRef = useRef(selectedSmartView)
  const filteredNotesRef = useRef(filteredNotes)
  const tabFocusedNoteIdRef = useRef(tabFocusedNoteId)
  isTypewriterModeRef.current = isTypewriterMode
  handleToggleTypewriterRef.current = handleToggleTypewriter
  getCursorInfoFromEditorRef.current = getCursorInfoFromEditor
  handleCreateNoteRef.current = handleCreateNote
  selectedSmartViewRef.current = selectedSmartView
  filteredNotesRef.current = filteredNotes
  tabFocusedNoteIdRef.current = tabFocusedNoteId

  // 提取为原始值，避免 activeTab 对象引用导致 useEffect 频繁重绑定
  const activePaneCount = activeTab ? Object.keys(activeTab.panes).length : 0

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + Shift + T: Toggle typewriter mode
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 't') {
        e.preventDefault()
        if (!isTypewriterModeRef.current) {
          const cursorInfo = getCursorInfoFromEditorRef.current()
          handleToggleTypewriterRef.current(cursorInfo)
        } else {
          setIsTypewriterMode(false)
        }
      }
      // Cmd/Ctrl + T: New Tab
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 't') {
        e.preventDefault()
        createTab()
      }
      // Cmd/Ctrl + W: Close current pane/tab, or window if last tab with single pane
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'w') {
        e.preventDefault()
        const isLastTab = tabs.length === 1
        const isSinglePane = activePaneCount <= 1

        // 最后一个 tab 且只有一个或零个 pane 时，关闭窗口
        if (isLastTab && isSinglePane) {
          window.electron.window.close()
        } else if (focusedPaneId) {
          // 有焦点 pane，关闭 pane（如果是最后一个 pane 会关闭 tab）
          closePane(focusedPaneId)
        } else if (activeTabId) {
          // 空白 tab 没有 focusedPaneId，关闭 tab
          closeTab(activeTabId)
        }
      }
      // Cmd/Ctrl + \: Split vertical
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === '\\') {
        e.preventDefault()
        if (tabFocusedNoteIdRef.current) {
          splitPane('row')
        }
      }
      // Cmd/Ctrl + Shift + \: Split horizontal
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === '\\') {
        e.preventDefault()
        if (tabFocusedNoteIdRef.current) {
          splitPane('column')
        }
      }
      // Cmd/Ctrl + N: Create new note (not in trash view)
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'n') {
        e.preventDefault()
        // Don't create note if in trash view
        if (selectedSmartViewRef.current !== 'trash') {
          handleCreateNoteRef.current()
        }
      }
      // Cmd/Ctrl + A: Select all notes in current list (only when not in editor)
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'a') {
        // Check if focus is in an editable element
        const activeEl = document.activeElement
        const isInEditor = activeEl?.closest('.bn-editor, .ProseMirror, [contenteditable="true"], input, textarea')
        if (!isInEditor && selectedSmartViewRef.current !== 'trash') {
          e.preventDefault()
          const allIds = filteredNotesRef.current.map(n => n.id)
          if (allIds.length > 0) {
            setSelectedNoteIds(allIds)
            setAnchorNoteId(allIds[0])  // Set anchor to first note
          }
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [createTab, closeTab, closePane, focusedPaneId, activeTabId, tabs.length, activePaneCount, splitPane])

  // Bulk delete notes
  const handleBulkDelete = useCallback(async (ids: string[]) => {
    try {
      const now = new Date().toISOString()
      const notesToTrash: Note[] = []

      for (const id of ids) {
        const noteToDelete = notes.find(n => n.id === id)
        await window.electron.note.delete(id)
        if (noteToDelete) {
          notesToTrash.push({ ...noteToDelete, deleted_at: now })
        }
      }

      // Batch state updates
      setTrashNotes(prev => [...notesToTrash, ...prev])
      setNotes(prev => prev.filter(n => !ids.includes(n.id)))
      setSelectedNoteIds([])
      setAnchorNoteId(null)
    } catch (error) {
      console.error('Failed to bulk delete notes:', error)
    }
  }, [notes])

  // Bulk toggle favorite on notes
  const handleBulkToggleFavorite = useCallback(async (ids: string[]) => {
    try {
      // Set all to favorite (if any unfavorited, set all to favorite)
      const anyUnfavorited = ids.some(id => {
        const note = notes.find(n => n.id === id)
        return note && !note.is_favorite
      })
      const newFavoriteStatus = anyUnfavorited

      for (const id of ids) {
        await window.electron.note.update(id, { is_favorite: newFavoriteStatus })
      }
      setNotes(prev => prev.map(n =>
        ids.includes(n.id) ? { ...n, is_favorite: newFavoriteStatus } : n
      ))
    } catch (error) {
      console.error('Failed to bulk toggle favorite:', error)
    }
  }, [notes])

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
      <Sidebar
        notebooks={notebooks}
        selectedNotebookId={selectedNotebookId}
        selectedSmartView={selectedSmartView}
        onSelectNotebook={handleSelectNotebook}
        onSelectSmartView={handleSelectSmartView}
        onAddNotebook={handleAddNotebook}
        onEditNotebook={handleEditNotebook}
        onDeleteNotebook={handleShowDeleteConfirm}
        onOpenSettings={handleOpenSettings}
        onMoveNoteToNotebook={handleMoveToNotebook}
        onReorderNotebooks={handleReorderNotebooks}
        noteCounts={noteCounts}
        onCollapsedChange={setIsSidebarCollapsed}
      />

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
          showCreateButton={selectedSmartView !== 'favorites'}
        />
      )}

      {/* Editor Area - TabBar + PaneLayout */}
      {selectedSmartView === 'trash' ? (
        // Empty placeholder for trash view (same background as editor)
        <div className="flex-1 bg-[var(--color-card-solid)]" />
      ) : !isTypewriterMode ? (
        <div className="flex-1 flex flex-col overflow-hidden">
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
                    notes={notes}
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
        </div>
      ) : null}

      {/* Typewriter Mode - 全屏覆盖层 */}
      {isTypewriterMode && selectedNote && (
        <EditorErrorBoundary resetKey={`typewriter-${selectedNote.id}`}>
          <TypewriterMode
            note={selectedNote}
            notes={notes}
            onUpdate={handleUpdateNote}
            onNoteClick={handleNoteClick}
            onCreateNote={handleCreateNoteFromLink}
            onExit={handleExitTypewriter}
            initialCursorInfo={typewriterCursorInfo}
          />
        </EditorErrorBoundary>
      )}

      {/* Settings Modal */}
      {showSettings && <Settings onClose={handleCloseSettings} />}

      {/* Notebook Modal */}
      {showNotebookModal && (
        <NotebookModal
          notebook={editingNotebook}
          onSave={handleSaveNotebook}
          onDelete={editingNotebook ? handleDeleteNotebook : undefined}
          onClose={() => {
            setShowNotebookModal(false)
            setEditingNotebook(null)
          }}
        />
      )}

      {/* Delete Confirmation Modal */}
      {notebookToDelete && createPortal(
        <>
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[1000]"
            onClick={() => setNotebookToDelete(null)}
          />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm bg-[var(--color-card)] rounded-xl shadow-[var(--shadow-elevated)] overflow-hidden z-[1001]">
            <div className="p-5">
              <h2 className="text-[1rem] font-semibold text-[var(--color-text)] mb-2 select-none">
                {t.notebook.deleteConfirmTitle}
              </h2>
              <p className="text-[0.867rem] text-[var(--color-text-secondary)] select-none">
                {t.notebook.deleteConfirmMessage.replace('{name}', notebookToDelete.name)}
              </p>
            </div>
            <div className="flex justify-end gap-2 px-5 pb-5">
              <button
                onClick={() => setNotebookToDelete(null)}
                className="px-4 py-2 text-[0.867rem] text-[var(--color-text)] bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 rounded-lg transition-all duration-150 select-none"
              >
                {t.actions.cancel}
              </button>
              <button
                onClick={handleConfirmDeleteNotebook}
                className="px-4 py-2 text-[0.867rem] text-white bg-red-500 hover:bg-red-600 rounded-lg transition-all duration-150 select-none"
              >
                {t.actions.delete}
              </button>
            </div>
          </div>
        </>,
        document.body
      )}

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
        <TabProvider>
          <AppContent />
        </TabProvider>
      </I18nProvider>
    </ThemeProvider>
  )
}

export default App
