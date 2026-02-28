import { useState, useCallback, useMemo, useEffect } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { useInternalFolderDialogs } from '../components/app/InternalFolderDialogs'
import { useNotebookDeleteDialog } from '../components/app/NotebookDeleteDialog'
import { DESTRUCTIVE_FLUSH_WAIT_TIMEOUT_MS } from './editor-update-types'
import {
  buildInternalFolderTree,
  hasInternalFolderPath,
  hasLocalFolderNodes,
  normalizeInternalFolderPath,
} from '../utils/localFolderNavigation'
import type {
  Note,
  Notebook,
  NotebookFolder,
  NotebookFolderTreeNode,
  LocalFolderTreeResult,
} from '../types/note'

// ---------------------------------------------------------------------------
// Hook options & return type
// ---------------------------------------------------------------------------

export interface UseNotebookManagementOptions {
  // State
  notebooks: Notebook[]
  notes: Note[]
  notebookFolders: NotebookFolder[]
  selectedNotebookId: string | null
  selectedInternalFolderPath: string | null
  localFolderTree: LocalFolderTreeResult | null
  localNotebookHasChildFolders: Record<string, boolean>

  // State setters
  setNotebooks: Dispatch<SetStateAction<Notebook[]>>
  setNotebookFolders: Dispatch<SetStateAction<NotebookFolder[]>>
  setNotes: Dispatch<SetStateAction<Note[]>>
  setTrashNotes: Dispatch<SetStateAction<Note[]>>
  setSelectedNotebookId: Dispatch<SetStateAction<string | null>>
  setSelectedSmartView: Dispatch<SetStateAction<import('../types/note').SmartViewId | null>>
  setIsTypewriterMode: Dispatch<SetStateAction<boolean>>
  setSelectedNoteIds: Dispatch<SetStateAction<string[]>>
  setAnchorNoteId: Dispatch<SetStateAction<string | null>>
  setSelectedInternalFolderPath: Dispatch<SetStateAction<string | null>>

  // From editor queue
  clearEditorUpdateRuntimeState: (noteId: string, keepPending?: boolean) => void
  flushQueuedEditorUpdatesForNotes: (noteIds: string[], timeoutMs?: number) => Promise<boolean>
  notifyFlushRequired: () => void

  // From local folder
  localOpenFileRef: MutableRefObject<{ notebookId: string; relativePath: string } | null>
  localAutoDraftRef: MutableRefObject<{ notebookId: string; relativePath: string; initialContent?: string } | null>
  flushLocalFileSave: () => Promise<void>
  cleanupLocalAutoDraftIfNeeded: (
    target: { notebookId: string; relativePath: string } | null,
    options?: { skipFlush?: boolean },
  ) => Promise<void>
  cleanupUnmountedLocalNotebook: (notebookId: string) => void
  resetLocalEditorState: () => void

  // From note CRUD
  refreshInternalNotebookData: () => Promise<void>
}

export interface NotebookManagementAPI {
  // Modal state
  showNotebookModal: boolean
  editingNotebook: Notebook | null
  closeNotebookModal: () => void

  // Callbacks
  refreshNotebookFolders: () => Promise<NotebookFolder[]>
  handleSelectInternalFolder: (folderPath: string | null) => void
  isSelectedNotebookInternal: () => boolean
  handleReorderNotebooks: (orderedIds: string[]) => Promise<void>
  handleAddNotebook: () => void
  handleEditNotebook: (notebook: Notebook) => void
  handleSaveNotebook: (data: { name: string; icon: string }) => Promise<void>
  handleConfirmDeleteNotebook: (notebook: Notebook) => Promise<void>
  handleDeleteNotebook: () => Promise<void>

  // Derived values
  contextNotebook: Notebook | null | undefined
  notebookHasChildFolders: Record<string, boolean>
  isInternalNotebookSelected: boolean
  selectedNotebookInternalFolders: NotebookFolder[]
  selectedNotebookInternalNotes: Note[]
  internalFolderTreeNodes: NotebookFolderTreeNode[]

  // Dialog APIs
  internalFolderDialogs: ReturnType<typeof useInternalFolderDialogs>
  notebookDeleteDialog: ReturnType<typeof useNotebookDeleteDialog>
}

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

export function useNotebookManagement(options: UseNotebookManagementOptions): NotebookManagementAPI {
  const {
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
  } = options

  // ---------------------------------------------------------------------------
  // Modal state
  // ---------------------------------------------------------------------------

  const [showNotebookModal, setShowNotebookModal] = useState(false)
  const [editingNotebook, setEditingNotebook] = useState<Notebook | null>(null)

  const closeNotebookModal = useCallback(() => {
    setShowNotebookModal(false)
    setEditingNotebook(null)
  }, [])

  // ---------------------------------------------------------------------------
  // refreshNotebookFolders
  // ---------------------------------------------------------------------------

  const refreshNotebookFolders = useCallback(async () => {
    try {
      const folders = await window.electron.notebookFolder.list()
      setNotebookFolders(folders)
      return folders
    } catch (error) {
      console.error('Failed to refresh notebook folders:', error)
      return []
    }
  }, [setNotebookFolders])

  // ---------------------------------------------------------------------------
  // handleSelectInternalFolder
  // ---------------------------------------------------------------------------

  const handleSelectInternalFolder = useCallback((folderPath: string | null) => {
    setSelectedInternalFolderPath(folderPath)
  }, [setSelectedInternalFolderPath])

  // ---------------------------------------------------------------------------
  // isSelectedNotebookInternal
  // ---------------------------------------------------------------------------

  const isSelectedNotebookInternal = useCallback((): boolean => {
    if (!selectedNotebookId) return false
    const selectedNotebook = notebooks.find((notebook) => notebook.id === selectedNotebookId)
    return Boolean(selectedNotebook && selectedNotebook.source_type !== 'local-folder')
  }, [notebooks, selectedNotebookId])

  // ---------------------------------------------------------------------------
  // Internal folder dialogs
  // ---------------------------------------------------------------------------

  const internalFolderDialogs = useInternalFolderDialogs({
    selectedNotebookId,
    isSelectedNotebookInternal,
    notes,
    notebookFolders,
    refreshNotebookFolders,
    refreshInternalNotebookData,
    onFolderPathChange: (updater) => setSelectedInternalFolderPath(updater),
    onDeletedNoteIds: (ids) => {
      const deletedIdSet = new Set(ids)
      setSelectedNoteIds((prev) => prev.filter((id) => !deletedIdSet.has(id)))
      setAnchorNoteId((prev) => (prev && deletedIdSet.has(prev) ? null : prev))
    },
  })

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const contextNotebook = useMemo(
    () => (selectedNotebookId ? notebooks.find(nb => nb.id === selectedNotebookId) : null),
    [selectedNotebookId, notebooks]
  )

  const notebookHasChildFolders = useMemo(() => {
    const internalNotebookIds = new Set(notebookFolders.map((folder) => folder.notebook_id))
    for (const note of notes) {
      if (!note.notebook_id || note.is_daily) continue
      if (!normalizeInternalFolderPath(note.folder_path)) continue
      internalNotebookIds.add(note.notebook_id)
    }
    const result: Record<string, boolean> = {}

    for (const notebook of notebooks) {
      if (notebook.source_type === 'local-folder') {
        if (localFolderTree?.notebook_id === notebook.id) {
          result[notebook.id] = hasLocalFolderNodes(localFolderTree.tree)
        } else {
          result[notebook.id] = localNotebookHasChildFolders[notebook.id] ?? false
        }
        continue
      }
      result[notebook.id] = internalNotebookIds.has(notebook.id)
    }

    return result
  }, [localFolderTree, localNotebookHasChildFolders, notebookFolders, notebooks, notes])

  const isInternalNotebookSelected = Boolean(contextNotebook && contextNotebook.source_type !== 'local-folder')

  const selectedNotebookInternalFolders = useMemo(() => {
    if (!selectedNotebookId || !isInternalNotebookSelected) return []
    return notebookFolders.filter((folder) => folder.notebook_id === selectedNotebookId)
  }, [isInternalNotebookSelected, notebookFolders, selectedNotebookId])

  const selectedNotebookInternalNotes = useMemo(() => {
    if (!selectedNotebookId || !isInternalNotebookSelected) return []
    return notes.filter((note) => note.notebook_id === selectedNotebookId && !note.is_daily)
  }, [isInternalNotebookSelected, notes, selectedNotebookId])

  const internalFolderTreeNodes = useMemo(() => {
    if (!isInternalNotebookSelected) return []
    return buildInternalFolderTree(selectedNotebookInternalFolders, selectedNotebookInternalNotes)
  }, [isInternalNotebookSelected, selectedNotebookInternalFolders, selectedNotebookInternalNotes])

  // ---------------------------------------------------------------------------
  // Internal folder path cleanup effect
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!isInternalNotebookSelected) {
      setSelectedInternalFolderPath(null)
      return
    }
    if (selectedInternalFolderPath && !hasInternalFolderPath(internalFolderTreeNodes, selectedInternalFolderPath)) {
      setSelectedInternalFolderPath(null)
    }
  }, [internalFolderTreeNodes, isInternalNotebookSelected, selectedInternalFolderPath, setSelectedInternalFolderPath])

  // ---------------------------------------------------------------------------
  // handleReorderNotebooks
  // ---------------------------------------------------------------------------

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
  }, [setNotebooks])

  // ---------------------------------------------------------------------------
  // handleAddNotebook
  // ---------------------------------------------------------------------------

  const handleAddNotebook = useCallback(() => {
    setEditingNotebook(null)
    setShowNotebookModal(true)
  }, [])

  // ---------------------------------------------------------------------------
  // handleEditNotebook
  // ---------------------------------------------------------------------------

  const handleEditNotebook = useCallback((notebook: Notebook) => {
    setEditingNotebook(notebook)
    setShowNotebookModal(true)
  }, [])

  // ---------------------------------------------------------------------------
  // handleSaveNotebook
  // ---------------------------------------------------------------------------

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
  }, [editingNotebook, setNotebooks])

  // ---------------------------------------------------------------------------
  // handleConfirmDeleteNotebook
  // ---------------------------------------------------------------------------

  const handleConfirmDeleteNotebook = useCallback(async (notebook: Notebook) => {
    try {
      if (notebook.source_type === 'local-folder') {
        if (localOpenFileRef.current?.notebookId === notebook.id) {
          await flushLocalFileSave()
        }
        if (localAutoDraftRef.current?.notebookId === notebook.id) {
          await cleanupLocalAutoDraftIfNeeded(null, { skipFlush: true })
        }
        const success = await window.electron.localFolder.unmount(notebook.id)
        if (success) {
          setNotebooks(prev => prev.filter(nb => nb.id !== notebook.id))
          setNotebookFolders(prev => prev.filter(folder => folder.notebook_id !== notebook.id))
          cleanupUnmountedLocalNotebook(notebook.id)
          if (selectedNotebookId === notebook.id) {
            setSelectedNotebookId(null)
            setSelectedSmartView('all')
            setIsTypewriterMode(false)
            setSelectedNoteIds([])
            setAnchorNoteId(null)
            setSelectedInternalFolderPath(null)
            resetLocalEditorState()
          }
        }
        return
      }

      // Soft-delete all notes in this notebook first (move to trash)
      const notesInNotebook = notes.filter(n => n.notebook_id === notebook.id)
      const flushed = await flushQueuedEditorUpdatesForNotes(
        notesInNotebook.map(note => note.id),
        DESTRUCTIVE_FLUSH_WAIT_TIMEOUT_MS
      )
      if (!flushed) {
        notifyFlushRequired()
        return
      }
      for (const note of notesInNotebook) {
        await window.electron.note.delete(note.id)
        clearEditorUpdateRuntimeState(note.id)
      }

      // Delete the notebook
      const success = await window.electron.notebook.delete(notebook.id)
      if (success) {
        setNotebooks(prev => prev.filter(nb => nb.id !== notebook.id))
        setNotebookFolders(prev => prev.filter(folder => folder.notebook_id !== notebook.id))
        setNotes(prev => prev.filter(n => n.notebook_id !== notebook.id))
        // Add deleted notes to trash
        const now = new Date().toISOString()
        setTrashNotes(prev => [
          ...notesInNotebook.map(n => ({ ...n, deleted_at: now })),
          ...prev
        ])
        // If the deleted notebook was selected, go back to all notes
        if (selectedNotebookId === notebook.id) {
          setSelectedNotebookId(null)
          setSelectedSmartView('all')
          setSelectedInternalFolderPath(null)
        }
        // Remove deleted notes from selection
        const deletedIds = new Set(notesInNotebook.map(n => n.id))
        setSelectedNoteIds(prev => prev.filter(id => !deletedIds.has(id)))
      }
    } catch (error) {
      console.error('Failed to delete notebook:', error)
    }
  }, [
    clearEditorUpdateRuntimeState,
    cleanupUnmountedLocalNotebook,
    notes,
    selectedNotebookId,
    cleanupLocalAutoDraftIfNeeded,
    flushLocalFileSave,
    flushQueuedEditorUpdatesForNotes,
    notifyFlushRequired,
    resetLocalEditorState,
    localOpenFileRef,
    localAutoDraftRef,
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
  ])

  // ---------------------------------------------------------------------------
  // Notebook delete dialog
  // ---------------------------------------------------------------------------

  const notebookDeleteDialog = useNotebookDeleteDialog({
    onConfirmDelete: handleConfirmDeleteNotebook,
  })

  // ---------------------------------------------------------------------------
  // handleDeleteNotebook (from modal)
  // ---------------------------------------------------------------------------

  const handleDeleteNotebook = useCallback(async () => {
    if (!editingNotebook) return
    notebookDeleteDialog.requestDelete(editingNotebook)
    setShowNotebookModal(false)
    setEditingNotebook(null)
  }, [editingNotebook, notebookDeleteDialog.requestDelete])

  // ---------------------------------------------------------------------------
  // Return
  // ---------------------------------------------------------------------------

  return {
    // Modal state
    showNotebookModal,
    editingNotebook,
    closeNotebookModal,

    // Callbacks
    refreshNotebookFolders,
    handleSelectInternalFolder,
    isSelectedNotebookInternal,
    handleReorderNotebooks,
    handleAddNotebook,
    handleEditNotebook,
    handleSaveNotebook,
    handleConfirmDeleteNotebook,
    handleDeleteNotebook,

    // Derived values
    contextNotebook,
    notebookHasChildFolders,
    isInternalNotebookSelected,
    selectedNotebookInternalFolders,
    selectedNotebookInternalNotes,
    internalFolderTreeNodes,

    // Dialog APIs
    internalFolderDialogs,
    notebookDeleteDialog,
  }
}
