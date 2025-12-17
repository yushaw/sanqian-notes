import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { Sidebar } from './components/Sidebar'
import { NoteList } from './components/NoteList'
import { Editor, type EditorHandle } from './components/Editor'
import { Settings } from './components/Settings'
import { NotebookModal } from './components/NotebookModal'
import { TypewriterMode } from './components/TypewriterMode'
import { ThemeProvider } from './theme'
import { I18nProvider } from './i18n'
import { getCursorInfo, setCursorByBlockId, type CursorInfo } from './utils/cursor'
import type { Note, Notebook, SmartViewId } from './types/note'

function AppContent() {
  const [notebooks, setNotebooks] = useState<Notebook[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [selectedSmartView, setSelectedSmartView] = useState<SmartViewId | null>('all')
  const [selectedNotebookId, setSelectedNotebookId] = useState<string | null>(null)
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  // Notebook modal state
  const [showNotebookModal, setShowNotebookModal] = useState(false)
  const [editingNotebook, setEditingNotebook] = useState<Notebook | null>(null)

  // Typewriter mode state
  const [isTypewriterMode, setIsTypewriterMode] = useState(false)
  const [typewriterCursorInfo, setTypewriterCursorInfo] = useState<CursorInfo | undefined>(undefined)

  // Editor ref for cursor position sync
  const editorRef = useRef<EditorHandle>(null)

  // Load data from database
  useEffect(() => {
    async function loadData() {
      try {
        const [notesData, notebooksData] = await Promise.all([
          window.electron.note.getAll(),
          window.electron.notebook.getAll()
        ])
        setNotes(notesData as Note[])
        setNotebooks(notebooksData as Notebook[])
      } catch (error) {
        console.error('Failed to load data:', error)
      } finally {
        setIsLoading(false)
      }
    }
    loadData()
  }, [])

  // Filter notes based on current view
  const filteredNotes = useMemo(() => {
    if (selectedNotebookId) {
      return notes.filter(n => n.notebook_id === selectedNotebookId)
    }
    switch (selectedSmartView) {
      case 'all':
        return notes
      case 'daily':
        return notes.filter(n => n.is_daily)
      case 'recent':
        // Notes updated in the last 7 days
        const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
        return notes.filter(n => new Date(n.updated_at).getTime() > weekAgo)
      case 'favorites':
        return notes.filter(n => n.is_favorite)
      default:
        return notes
    }
  }, [notes, selectedSmartView, selectedNotebookId])

  // Get note counts
  const noteCounts = useMemo(() => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    return {
      all: notes.length,
      daily: notes.filter(n => n.is_daily).length,
      recent: notes.filter(n => new Date(n.updated_at).getTime() > weekAgo).length,
      favorites: notes.filter(n => n.is_favorite).length,
      notebooks: notebooks.reduce((acc, nb) => {
        acc[nb.id] = notes.filter(n => n.notebook_id === nb.id).length
        return acc
      }, {} as Record<string, number>),
    }
  }, [notes, notebooks])

  // Get selected note
  const selectedNote = useMemo(() => {
    return notes.find(n => n.id === selectedNoteId) || null
  }, [notes, selectedNoteId])

  // Handle selecting a notebook
  const handleSelectNotebook = useCallback((id: string | null) => {
    setSelectedNotebookId(id)
    setSelectedSmartView(null)
    setSelectedNoteId(null)
  }, [])

  // Handle selecting a smart view
  const handleSelectSmartView = useCallback((view: SmartViewId) => {
    setSelectedSmartView(view)
    setSelectedNotebookId(null)
    setSelectedNoteId(null)
  }, [])

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
      setNotes(prev => [newNote as Note, ...prev])
      setSelectedNoteId((newNote as Note).id)
    } catch (error) {
      console.error('Failed to create note:', error)
    }
  }, [selectedNotebookId, selectedSmartView])

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
  const handleNoteClick = useCallback((noteId: string, target?: { type: 'heading' | 'block'; value: string }) => {
    setSelectedNoteId(noteId)
    if (target) {
      setScrollTarget(target)
    } else {
      setScrollTarget(null)
    }
  }, [])

  // 清除滚动目标的回调
  const handleScrollComplete = useCallback(() => {
    setScrollTarget(null)
  }, [])

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
    setNotes(prev => [newNote as Note, ...prev])
    return newNote as Note
  }, [selectedNotebookId])

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
  const handleSaveNotebook = useCallback(async (data: { name: string; color: string }) => {
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

  // Handle deleting notebook
  const handleDeleteNotebook = useCallback(async () => {
    if (!editingNotebook) return

    try {
      const success = await window.electron.notebook.delete(editingNotebook.id)
      if (success) {
        setNotebooks(prev => prev.filter(nb => nb.id !== editingNotebook.id))
        // If the deleted notebook was selected, go back to all notes
        if (selectedNotebookId === editingNotebook.id) {
          setSelectedNotebookId(null)
          setSelectedSmartView('all')
        }
      }
      setShowNotebookModal(false)
      setEditingNotebook(null)
    } catch (error) {
      console.error('Failed to delete notebook:', error)
    }
  }, [editingNotebook, selectedNotebookId])

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
        }
      }
      setTimeout(() => trySetCursor(), 150)
    }
  }, [selectedNoteId, scrollEditorToCursor])

  // 从 editor 获取当前光标信息
  const getCursorInfoFromEditor = useCallback((): CursorInfo => {
    const editor = editorRef.current?.getEditor()
    return getCursorInfo(editor) || { blockId: '', offsetInBlock: 0 }
  }, [])

  // Keyboard shortcut for typewriter mode (Cmd/Ctrl + Shift + T)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 't') {
        e.preventDefault()
        if (!isTypewriterMode) {
          const cursorInfo = getCursorInfoFromEditor()
          handleToggleTypewriter(cursorInfo)
        } else {
          // 如果已经在打字机模式，则退出
          setIsTypewriterMode(false)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleToggleTypewriter, getCursorInfoFromEditor, isTypewriterMode])

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-app-bg">
        <div className="text-app-muted">Loading...</div>
      </div>
    )
  }

  return (
    <div className="h-full flex bg-app-bg">
      {/* Sidebar - Notebooks & Smart Views */}
      <Sidebar
        notebooks={notebooks}
        selectedNotebookId={selectedNotebookId}
        selectedSmartView={selectedSmartView}
        onSelectNotebook={handleSelectNotebook}
        onSelectSmartView={handleSelectSmartView}
        onAddNotebook={handleAddNotebook}
        onEditNotebook={handleEditNotebook}
        onOpenSettings={handleOpenSettings}
        noteCounts={noteCounts}
      />

      {/* Note List */}
      <NoteList
        notes={filteredNotes}
        selectedNoteId={selectedNoteId}
        onSelectNote={setSelectedNoteId}
        onCreateNote={handleCreateNote}
      />

      {/* Editor */}
      <Editor
        ref={editorRef}
        note={selectedNote}
        notes={notes}
        onUpdate={handleUpdateNote}
        onNoteClick={handleNoteClick}
        onCreateNote={handleCreateNoteFromLink}
        scrollTarget={scrollTarget}
        onScrollComplete={handleScrollComplete}
        onTypewriterModeToggle={handleToggleTypewriter}
      />

      {/* Typewriter Mode - 全屏覆盖层 */}
      {isTypewriterMode && selectedNote && (
        <TypewriterMode
          note={selectedNote}
          notes={notes}
          onUpdate={handleUpdateNote}
          onNoteClick={handleNoteClick}
          onCreateNote={handleCreateNoteFromLink}
          onExit={handleExitTypewriter}
          initialCursorInfo={typewriterCursorInfo}
        />
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
    </div>
  )
}

function App() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <AppContent />
      </I18nProvider>
    </ThemeProvider>
  )
}

export default App
