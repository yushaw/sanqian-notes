import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Sidebar } from './components/Sidebar'
import { NoteList } from './components/NoteList'
import { TrashList } from './components/TrashList'
import { Editor, type EditorHandle } from './components/Editor'
import { Settings } from './components/Settings'
import { NotebookModal } from './components/NotebookModal'
import { TypewriterMode } from './components/TypewriterMode'
import { ThemeProvider } from './theme'
import { I18nProvider, useTranslations } from './i18n'
import { getCursorInfo, setCursorByBlockId, type CursorInfo } from './utils/cursor'
import type { Note, Notebook, SmartViewId } from './types/note'

function AppContent() {
  const t = useTranslations()
  const [notebooks, setNotebooks] = useState<Notebook[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [trashNotes, setTrashNotes] = useState<Note[]>([])
  const [selectedSmartView, setSelectedSmartView] = useState<SmartViewId | null>('all')
  const [selectedNotebookId, setSelectedNotebookId] = useState<string | null>(null)
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
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

  // Editor ref for cursor position sync
  const editorRef = useRef<EditorHandle>(null)

  // Load data from database
  useEffect(() => {
    async function loadData() {
      try {
        const [notesData, notebooksData, trashData] = await Promise.all([
          window.electron.note.getAll(),
          window.electron.notebook.getAll(),
          window.electron.trash.getAll()
        ])
        setNotes(notesData as Note[])
        setNotebooks(notebooksData as Notebook[])
        setTrashNotes(trashData as Note[])
      } catch (error) {
        console.error('Failed to load data:', error)
      } finally {
        setIsLoading(false)
      }
    }
    loadData()

    // Cleanup old trash (notes older than 30 days)
    window.electron.trash.cleanup().catch(console.error)
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
      trash: trashNotes.length,
      notebooks: notebooks.reduce((acc, nb) => {
        acc[nb.id] = notes.filter(n => n.notebook_id === nb.id).length
        return acc
      }, {} as Record<string, number>),
    }
  }, [notes, notebooks, trashNotes])

  // Get selected note
  const selectedNote = useMemo(() => {
    return notes.find(n => n.id === selectedNoteId) || null
  }, [notes, selectedNoteId])

  // Check if a note is empty (no title and no content)
  const isNoteEmpty = useCallback((note: Note | null): boolean => {
    if (!note) return false
    const hasTitle = note.title && note.title.trim() !== ''
    let hasContent = false
    if (note.content && note.content !== '[]' && note.content !== '') {
      try {
        const parsed = JSON.parse(note.content)
        // Check Tiptap format
        if (parsed.type === 'doc' && parsed.content) {
          const extractText = (node: { text?: string; content?: unknown[] }): string => {
            let text = node.text || ''
            if (node.content && Array.isArray(node.content)) {
              node.content.forEach(child => {
                text += extractText(child as { text?: string; content?: unknown[] })
              })
            }
            return text
          }
          hasContent = extractText(parsed).trim() !== ''
        }
      } catch {
        hasContent = note.content.trim() !== ''
      }
    }
    return !hasTitle && !hasContent
  }, [])

  // Delete empty note if switching away from it
  const deleteEmptyNoteIfNeeded = useCallback(async (noteId: string | null) => {
    if (!noteId) return
    const note = notes.find(n => n.id === noteId)
    if (note && isNoteEmpty(note)) {
      await window.electron.note.delete(noteId)
      setNotes(prev => prev.filter(n => n.id !== noteId))
      setTrashNotes(prev => [{
        ...note,
        deleted_at: new Date().toISOString()
      }, ...prev])
    }
  }, [notes, isNoteEmpty])

  // Handle selecting a note (with empty note cleanup)
  const handleSelectNote = useCallback(async (noteId: string) => {
    // Don't do anything if selecting the same note
    if (noteId === selectedNoteId) return

    // Delete empty note if switching away from it
    await deleteEmptyNoteIfNeeded(selectedNoteId)

    setSelectedNoteId(noteId)
  }, [selectedNoteId, deleteEmptyNoteIfNeeded])

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
    await deleteEmptyNoteIfNeeded(selectedNoteId)
    setSelectedNotebookId(id)
    setSelectedSmartView(null)
    setSelectedNoteId(null)
  }, [selectedNoteId, deleteEmptyNoteIfNeeded])

  // Handle selecting a smart view
  const handleSelectSmartView = useCallback(async (view: SmartViewId) => {
    await deleteEmptyNoteIfNeeded(selectedNoteId)
    setSelectedSmartView(view)
    setSelectedNotebookId(null)
    setSelectedNoteId(null)
  }, [selectedNoteId, deleteEmptyNoteIfNeeded])

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
      if (selectedNoteId === id) {
        setSelectedNoteId(null)
      }
    } catch (error) {
      console.error('Failed to delete note:', error)
    }
  }, [selectedNoteId, notes])

  // Handle restore note from trash
  const handleRestoreNote = useCallback(async (id: string) => {
    try {
      const success = await window.electron.trash.restore(id)
      if (success) {
        setTrashNotes(prev => {
          const restoredNote = prev.find(n => n.id === id)
          if (restoredNote) {
            setNotes(notesPrev => [{ ...restoredNote, deleted_at: null }, ...notesPrev])
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
        // If selected note was in this notebook, deselect it
        if (selectedNoteId && notesInNotebook.some(n => n.id === selectedNoteId)) {
          setSelectedNoteId(null)
        }
      }
      setNotebookToDelete(null)
    } catch (error) {
      console.error('Failed to delete notebook:', error)
    }
  }, [notebookToDelete, notes, selectedNotebookId, selectedNoteId])

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
        noteCounts={noteCounts}
      />

      {/* Note List or Trash List */}
      {selectedSmartView === 'trash' ? (
        <TrashList
          notes={trashNotes}
          onRestore={handleRestoreNote}
          onPermanentDelete={handlePermanentDelete}
          onEmptyTrash={handleEmptyTrash}
        />
      ) : (
        <NoteList
          notes={filteredNotes}
          selectedNoteId={selectedNoteId}
          title={listTitle}
          onSelectNote={handleSelectNote}
          onCreateNote={handleCreateNote}
          onSearch={(query) => window.electron.note.search(query)}
          onTogglePinned={handleTogglePinned}
          onToggleFavorite={handleToggleFavorite}
          onDeleteNote={handleDeleteNote}
        />
      )}

      {/* Editor - only show when not in trash view */}
      {selectedSmartView === 'trash' ? (
        // Empty placeholder for trash view (same background as editor)
        <div className="flex-1 bg-[var(--color-card-solid)]" />
      ) : (
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
      )}

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
