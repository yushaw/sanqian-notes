import { useCallback, useRef } from 'react'
import { flushSync } from 'react-dom'
import type { EditorNoteUpdate } from './editor-update-types'
import { DESTRUCTIVE_FLUSH_WAIT_TIMEOUT_MS } from './editor-update-types'
import type { Note, Notebook, SmartViewId, NotebookFolder, NotebookStatus, LocalNoteMetadata } from '../types/note'
import type { Translations } from '../i18n'
import { toast } from '../utils/toast'
import { formatDailyDate } from '../utils/dateFormat'
import { isLocalResourceId, createLocalResourceId } from '../utils/localResourceId'
import {
  getRelativePathDisplayName,
  isInternalPathInSubtree,
  stripLocalFileExtension,
} from '../utils/localFolderNavigation'
import { runUnifiedSearch } from '../utils/unifiedSearch'
import { compareNotesByPinnedAndUpdated } from '../utils/noteSort'

// ---------------------------------------------------------------------------
// Top-level helpers (moved from App.tsx)
// ---------------------------------------------------------------------------

const BULK_NOTE_PATCH_CONCURRENCY = 8

type ConcurrencyTaskResult<T> =
  | { item: T; ok: true }
  | { item: T; ok: false; error: unknown }

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<ConcurrencyTaskResult<T>[]> {
  if (items.length === 0) return []

  const maxConcurrency = Math.max(1, Math.min(concurrency, items.length))
  let index = 0
  const results: ConcurrencyTaskResult<T>[] = []

  await Promise.all(
    Array.from({ length: maxConcurrency }, async () => {
      while (true) {
        const currentIndex = index++
        if (currentIndex >= items.length) break
        const item = items[currentIndex]
        try {
          await worker(item)
          results.push({ item, ok: true })
        } catch (error) {
          results.push({ item, ok: false, error })
        }
      }
    })
  )

  return results
}

// ---------------------------------------------------------------------------
// Hook options & return type
// ---------------------------------------------------------------------------

export interface UseNoteCRUDOptions {
  // State
  notebooks: Notebook[]
  notes: Note[]
  notesRef: React.MutableRefObject<Note[]>
  allSourceLocalNotes: Note[]
  selectedNotebookId: string | null
  selectedSmartView: SmartViewId | null
  selectedInternalFolderPath: string | null
  isZh: boolean
  t: Translations

  // State setters
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>
  setTrashNotes: React.Dispatch<React.SetStateAction<Note[]>>
  setNotebookFolders: React.Dispatch<React.SetStateAction<NotebookFolder[]>>
  setSelectedNoteIds: React.Dispatch<React.SetStateAction<string[]>>
  setAnchorNoteId: React.Dispatch<React.SetStateAction<string | null>>

  // From editor queue (Phase 1)
  pendingEditorUpdatesRef: React.MutableRefObject<Map<string, EditorNoteUpdate>>
  flushQueuedEditorUpdates: (noteId: string | null, timeoutMs?: number) => Promise<boolean>
  flushQueuedEditorUpdatesForNotes: (noteIds: string[], timeoutMs?: number) => Promise<boolean>
  processEditorUpdateQueue: (noteId: string) => Promise<void>
  clearEditorUpdateRuntimeState: (noteId: string, keepPending?: boolean) => void
  notifyFlushRequired: () => void
  applyNonEditorNotePatch: (id: string, patch: Record<string, unknown>) => Promise<Note | null>

  // From local folder state (Phase 2+3)
  selectedLocalNotebookStatus: NotebookStatus | undefined
  createLocalFileWithoutDialog: (options?: {
    preferredName?: string
    autoDraft?: boolean
    openAfterCreate?: boolean
  }) => Promise<{ relativePath: string; file?: { tiptap_content?: string } } | null>
  updateLocalNoteBusinessMetadata: (noteId: string, patch: { is_favorite?: boolean; is_pinned?: boolean; ai_summary?: string | null }) => Promise<LocalNoteMetadata | null>
  localEditorNoteRef: React.MutableRefObject<Note | null>
  localNoteMetadataById: Record<string, LocalNoteMetadata>

  // Navigation callbacks (ref to break circular dependency with selectSingleNote)
  selectSingleNoteRef: React.MutableRefObject<(noteId: string) => void>
  createTab: (noteId?: string) => void
}

export interface NoteCRUDAPI {
  refreshInternalNotebookData: () => Promise<void>
  isNoteEmpty: (note: Note | null) => boolean
  deleteEmptyNoteIfNeeded: (noteId: string | null) => Promise<void>
  emptyNoteDeleteInFlightRef: React.MutableRefObject<Set<string>>
  handleCreateNote: () => Promise<void>
  handleOpenInNewTab: (noteId: string) => void
  handleCreateDaily: (date: string) => Promise<void>
  handleUpdateNote: (id: string, updates: { title?: string; content?: string }) => void
  handleCreateNoteFromLink: (title: string) => Promise<Note>
  handleTogglePinned: (id: string) => Promise<void>
  handleToggleFavorite: (id: string) => Promise<void>
  handleMoveToNotebook: (noteIdOrIds: string | string[], notebookId: string | null) => Promise<void>
  handleMoveToFolder: (noteIdOrIds: string | string[], notebookId: string, folderPath: string) => Promise<void>
  handleDeleteNote: (id: string) => Promise<void>
  handleDuplicateNote: (id: string) => Promise<void>
  handleSearch: (query: string) => Promise<Note[]>
  handleRestoreNote: (id: string) => Promise<void>
  handlePermanentDelete: (id: string) => Promise<void>
  handleEmptyTrash: () => Promise<void>
  handleBulkDelete: (ids: string[]) => Promise<void>
  handleBulkToggleFavorite: (ids: string[]) => Promise<void>
}

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

export function useNoteCRUD(options: UseNoteCRUDOptions): NoteCRUDAPI {
  const {
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
  } = options

  const emptyNoteDeleteInFlightRef = useRef<Set<string>>(new Set())

  const moveInternalNotes = useCallback(async (
    noteIdOrIds: string | string[],
    target: { notebookId: string | null; folderPath: string | null },
    labels: {
      partialFailure: (failedCount: number, totalCount: number) => string
      logLabel: string
    }
  ) => {
    if (target.notebookId) {
      const targetNotebook = notebooks.find((nb) => nb.id === target.notebookId)
      if (targetNotebook?.source_type === 'local-folder') {
        toast(
          isZh
            ? '\u6682\u4E0D\u652F\u6301\u5C06\u5E94\u7528\u5185\u7B14\u8BB0\u79FB\u52A8\u5230\u672C\u5730\u6587\u4EF6\u5939\u7B14\u8BB0\u672C\u3002'
            : 'Moving app-internal notes into local folder notebooks is not supported yet.',
          { type: 'info' }
        )
        return
      }
    }

    const ids = Array.isArray(noteIdOrIds) ? noteIdOrIds : [noteIdOrIds]
    const uniqueIds = [...new Set(ids)].filter((id) => !isLocalResourceId(id))
    if (uniqueIds.length === 0) return

    const flushed = await flushQueuedEditorUpdatesForNotes(uniqueIds, DESTRUCTIVE_FLUSH_WAIT_TIMEOUT_MS)
    if (!flushed) {
      notifyFlushRequired()
      return
    }

    const results = await runWithConcurrency(uniqueIds, BULK_NOTE_PATCH_CONCURRENCY, async (id) => {
      const updated = await applyNonEditorNotePatch(id, {
        notebook_id: target.notebookId,
        folder_path: target.folderPath,
      })
      if (!updated) {
        throw new Error(`Note move failed: ${id}`)
      }
    })
    const failed = results.filter((result): result is { item: string; ok: false; error: unknown } => !result.ok)
    if (failed.length > 0) {
      console.warn(`[App] Partial ${labels.logLabel} failure:`, failed)
      toast(labels.partialFailure(failed.length, uniqueIds.length), { type: 'error' })
    }
  }, [applyNonEditorNotePatch, flushQueuedEditorUpdatesForNotes, isZh, notebooks, notifyFlushRequired])

  const flushNotesInsert = useCallback(
    async (updater: (prev: Note[]) => Note[]) => {
      await new Promise<void>((resolve) => {
        queueMicrotask(() => {
          flushSync(() => {
            setNotes(updater)
          })
          resolve()
        })
      })
    },
    [setNotes]
  )

  // ---------------------------------------------------------------------------
  // refreshInternalNotebookData
  // ---------------------------------------------------------------------------

  const refreshInternalNotebookData = useCallback(async () => {
    const [notesData, trashData, notebookFolderData] = await Promise.all([
      window.electron.note.getAll(),
      window.electron.trash.getAll(),
      window.electron.notebookFolder.list(),
    ])

    const mergedNotes = (notesData as Note[]).map((note) => {
      const pending = pendingEditorUpdatesRef.current.get(note.id)
      return pending ? { ...note, ...pending } : note
    })
    notesRef.current = mergedNotes
    setNotes(mergedNotes)
    setTrashNotes(trashData as Note[])
    setNotebookFolders(notebookFolderData as NotebookFolder[])
  }, [pendingEditorUpdatesRef, notesRef, setNotes, setTrashNotes, setNotebookFolders])

  // ---------------------------------------------------------------------------
  // isNoteEmpty
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // deleteEmptyNoteIfNeeded
  // ---------------------------------------------------------------------------

  const deleteEmptyNoteIfNeeded = useCallback(async (noteId: string | null) => {
    if (!noteId) return
    if (emptyNoteDeleteInFlightRef.current.has(noteId)) return

    emptyNoteDeleteInFlightRef.current.add(noteId)
    try {
      const flushed = await flushQueuedEditorUpdates(noteId, DESTRUCTIVE_FLUSH_WAIT_TIMEOUT_MS)
      if (!flushed) return

      const note = notesRef.current.find(n => n.id === noteId)
      if (!note || !isNoteEmpty(note)) return

      // Empty notes are permanently deleted, not moved to trash.
      try {
        await window.electron.trash.permanentDelete(noteId)
      } catch (error) {
        console.error('Failed to permanently delete empty note:', noteId, error)
        return
      }

      clearEditorUpdateRuntimeState(noteId)
      notesRef.current = notesRef.current.filter(n => n.id !== noteId)
      setNotes(prev => prev.filter(n => n.id !== noteId))
    } finally {
      emptyNoteDeleteInFlightRef.current.delete(noteId)
    }
  }, [clearEditorUpdateRuntimeState, flushQueuedEditorUpdates, isNoteEmpty, notesRef, setNotes])

  // ---------------------------------------------------------------------------
  // handleCreateNote
  // ---------------------------------------------------------------------------

  const handleCreateNote = useCallback(async () => {
    if (selectedNotebookId) {
      const selectedNotebook = notebooks.find(nb => nb.id === selectedNotebookId)
      if (selectedNotebook?.source_type === 'local-folder') {
        if (selectedLocalNotebookStatus !== 'active') {
          toast(
            selectedLocalNotebookStatus === 'permission_required'
              ? t.notebook.localFolderPermissionRequired
              : t.notebook.localFolderMissing,
            { type: 'error' }
          )
          return
        }
        await createLocalFileWithoutDialog({ autoDraft: true })
        return
      }
    }

    try {
      const newNote = await window.electron.note.add({
        title: '',
        content: '[]',
        notebook_id: selectedNotebookId,
        folder_path: selectedNotebookId ? selectedInternalFolderPath : null,
        is_daily: selectedSmartView === 'daily',
        daily_date: selectedSmartView === 'daily' ? new Date().toISOString().split('T')[0] : null,
        is_favorite: false,
      })
      await flushNotesInsert((prev) => {
        const newNotes = [newNote as Note, ...prev]
        return newNotes.sort(compareNotesByPinnedAndUpdated)
      })
      selectSingleNoteRef.current((newNote as Note).id)
    } catch (error) {
      console.error('Failed to create note:', error)
    }
  }, [
    createLocalFileWithoutDialog,
    flushNotesInsert,
    notebooks,
    selectedInternalFolderPath,
    selectedLocalNotebookStatus,
    selectedNotebookId,
    selectedSmartView,
    selectSingleNoteRef,
    t.notebook.localFolderMissing,
    t.notebook.localFolderPermissionRequired,
  ])

  // ---------------------------------------------------------------------------
  // handleOpenInNewTab
  // ---------------------------------------------------------------------------

  const handleOpenInNewTab = useCallback((noteId: string) => {
    createTab(noteId)
  }, [createTab])

  // ---------------------------------------------------------------------------
  // handleCreateDaily
  // ---------------------------------------------------------------------------

  const handleCreateDaily = useCallback(async (date: string) => {
    try {
      // Check if daily already exists for this date
      const existing = notes.find(n => n.is_daily && n.daily_date === date)
      if (existing) {
        selectSingleNoteRef.current(existing.id)
        return
      }

      // Generate localized title
      const title = formatDailyDate(date, isZh)
      const newNote = await window.electron.daily.create(date, title)
      await flushNotesInsert((prev) => {
        const newNotes = [newNote as Note, ...prev]
        return newNotes.sort(compareNotesByPinnedAndUpdated)
      })
      selectSingleNoteRef.current((newNote as Note).id)
    } catch (error) {
      console.error('Failed to create daily note:', error)
    }
  }, [flushNotesInsert, notes, isZh, selectSingleNoteRef])

  // ---------------------------------------------------------------------------
  // handleUpdateNote
  // ---------------------------------------------------------------------------

  const handleUpdateNote = useCallback((id: string, updates: { title?: string; content?: string }) => {
    const localNote = notesRef.current.find((note) => note.id === id)
    if (!localNote) return

    const patch: EditorNoteUpdate = {}
    if (updates.title !== undefined && updates.title !== localNote.title) patch.title = updates.title
    if (updates.content !== undefined && updates.content !== localNote.content) patch.content = updates.content
    if (Object.keys(patch).length === 0) return

    // Optimistic local update for smooth typing.
    notesRef.current = notesRef.current.map((note) => (note.id === id ? { ...note, ...patch } : note))
    setNotes(prev => prev.map(note => note.id === id ? { ...note, ...patch } : note))

    const pending = pendingEditorUpdatesRef.current.get(id)
    pendingEditorUpdatesRef.current.set(id, { ...pending, ...patch })
    void processEditorUpdateQueue(id)
  }, [notesRef, setNotes, pendingEditorUpdatesRef, processEditorUpdateQueue])

  // ---------------------------------------------------------------------------
  // handleCreateNoteFromLink
  // ---------------------------------------------------------------------------

  const handleCreateNoteFromLink = useCallback(async (title: string): Promise<Note> => {
    if (selectedNotebookId) {
      const selectedNotebook = notebooks.find(nb => nb.id === selectedNotebookId)
      if (selectedNotebook?.source_type === 'local-folder') {
        if (selectedLocalNotebookStatus !== 'active') {
          toast(
            selectedLocalNotebookStatus === 'permission_required'
              ? t.notebook.localFolderPermissionRequired
              : t.notebook.localFolderMissing,
            { type: 'error' }
          )
          throw new Error('local folder notebook is not accessible')
        }

        const created = await createLocalFileWithoutDialog({
          preferredName: title,
          openAfterCreate: false,
        })
        if (!created) {
          throw new Error('failed to create local linked note')
        }

        const displayTitle = stripLocalFileExtension(getRelativePathDisplayName(created.relativePath))
        const now = new Date().toISOString()
        return {
          id: createLocalResourceId(selectedNotebookId, created.relativePath),
          title: displayTitle || title || t.noteList.untitled,
          content: created.file?.tiptap_content || '[]',
          notebook_id: selectedNotebookId,
          folder_path: null,
          is_daily: false,
          daily_date: null,
          is_favorite: false,
          is_pinned: false,
          revision: 0,
          created_at: now,
          updated_at: now,
          deleted_at: null,
          ai_summary: null,
          tags: [],
        }
      }
    }

    const newNote = await window.electron.note.add({
      title,
      content: '[]',
      notebook_id: selectedNotebookId,
      folder_path: selectedNotebookId ? selectedInternalFolderPath : null,
      is_daily: false,
      daily_date: null,
      is_favorite: false,
    })
    await flushNotesInsert((prev) => {
      const newNotes = [newNote as Note, ...prev]
      return newNotes.sort(compareNotesByPinnedAndUpdated)
    })
    return newNote as Note
  }, [
    createLocalFileWithoutDialog,
    flushNotesInsert,
    notebooks,
    selectedInternalFolderPath,
    selectedLocalNotebookStatus,
    selectedNotebookId,
    t.noteList.untitled,
    t.notebook.localFolderMissing,
    t.notebook.localFolderPermissionRequired,
  ])

  // ---------------------------------------------------------------------------
  // handleTogglePinned
  // ---------------------------------------------------------------------------

  const handleTogglePinned = useCallback(async (id: string) => {
    try {
      const flushed = await flushQueuedEditorUpdates(id, DESTRUCTIVE_FLUSH_WAIT_TIMEOUT_MS)
      if (!flushed) {
        notifyFlushRequired()
        return
      }
      const note = notesRef.current.find((n) => n.id === id)
        || allSourceLocalNotes.find((n) => n.id === id)
        || (localEditorNoteRef.current?.id === id ? localEditorNoteRef.current : null)
      if (!note) return

      if (isLocalResourceId(id)) {
        await updateLocalNoteBusinessMetadata(id, { is_pinned: !note.is_pinned })
        return
      }

      const updated = await applyNonEditorNotePatch(id, { is_pinned: !note.is_pinned })
      if (updated) {
        setNotes(prev => {
          const newNotes = prev.map(n => n.id === id ? updated as Note : n)
          return newNotes.sort(compareNotesByPinnedAndUpdated)
        })
      }
    } catch (error) {
      console.error('Failed to toggle pinned:', error)
    }
  }, [
    allSourceLocalNotes,
    applyNonEditorNotePatch,
    flushQueuedEditorUpdates,
    localEditorNoteRef,
    notesRef,
    notifyFlushRequired,
    setNotes,
    updateLocalNoteBusinessMetadata,
  ])

  // ---------------------------------------------------------------------------
  // handleToggleFavorite
  // ---------------------------------------------------------------------------

  const handleToggleFavorite = useCallback(async (id: string) => {
    try {
      const flushed = await flushQueuedEditorUpdates(id, DESTRUCTIVE_FLUSH_WAIT_TIMEOUT_MS)
      if (!flushed) {
        notifyFlushRequired()
        return
      }
      const note = notesRef.current.find((n) => n.id === id)
        || allSourceLocalNotes.find((n) => n.id === id)
        || (localEditorNoteRef.current?.id === id ? localEditorNoteRef.current : null)
      if (!note) return

      if (isLocalResourceId(id)) {
        await updateLocalNoteBusinessMetadata(id, { is_favorite: !note.is_favorite })
        return
      }

      await applyNonEditorNotePatch(id, { is_favorite: !note.is_favorite })
    } catch (error) {
      console.error('Failed to toggle favorite:', error)
    }
  }, [
    allSourceLocalNotes,
    applyNonEditorNotePatch,
    flushQueuedEditorUpdates,
    localEditorNoteRef,
    notesRef,
    notifyFlushRequired,
    updateLocalNoteBusinessMetadata,
  ])

  // ---------------------------------------------------------------------------
  // handleMoveToNotebook
  // ---------------------------------------------------------------------------

  const handleMoveToNotebook = useCallback(async (noteIdOrIds: string | string[], notebookId: string | null) => {
    try {
      await moveInternalNotes(noteIdOrIds, { notebookId, folderPath: null }, {
        logLabel: 'move-to-notebook',
        partialFailure: (failedCount, totalCount) => (
          isZh
            ? `\u90E8\u5206\u7B14\u8BB0\u79FB\u52A8\u5931\u8D25\uFF08${failedCount}/${totalCount}\uFF09`
            : `Some notes failed to move (${failedCount}/${totalCount})`
        ),
      })
    } catch (error) {
      console.error('Failed to move note(s) to notebook:', error)
    }
  }, [isZh, moveInternalNotes])

  const handleMoveToFolder = useCallback(async (noteIdOrIds: string | string[], notebookId: string, folderPath: string) => {
    try {
      await moveInternalNotes(noteIdOrIds, { notebookId, folderPath }, {
        logLabel: 'move-to-folder',
        partialFailure: (failedCount, totalCount) => (
          isZh
            ? `\u90E8\u5206\u7B14\u8BB0\u79FB\u52A8\u5230\u6587\u4EF6\u5939\u5931\u8D25\uFF08${failedCount}/${totalCount}\uFF09`
            : `Some notes failed to move to the folder (${failedCount}/${totalCount})`
        ),
      })
    } catch (error) {
      console.error('Failed to move note(s) to folder:', error)
    }
  }, [isZh, moveInternalNotes])

  // ---------------------------------------------------------------------------
  // handleDeleteNote
  // ---------------------------------------------------------------------------

  const handleDeleteNote = useCallback(async (id: string) => {
    try {
      const flushed = await flushQueuedEditorUpdates(id, DESTRUCTIVE_FLUSH_WAIT_TIMEOUT_MS)
      if (!flushed) {
        notifyFlushRequired()
        return
      }
      const noteToDelete = notesRef.current.find(n => n.id === id)
      await window.electron.note.delete(id)
      clearEditorUpdateRuntimeState(id)
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
  }, [clearEditorUpdateRuntimeState, flushQueuedEditorUpdates, notesRef, notifyFlushRequired, setNotes, setSelectedNoteIds, setTrashNotes])

  // ---------------------------------------------------------------------------
  // handleDuplicateNote
  // ---------------------------------------------------------------------------

  const handleDuplicateNote = useCallback(async (id: string) => {
    try {
      const flushed = await flushQueuedEditorUpdates(id, DESTRUCTIVE_FLUSH_WAIT_TIMEOUT_MS)
      if (!flushed) {
        notifyFlushRequired()
        return
      }
      const noteToDuplicate = notesRef.current.find(n => n.id === id)
      if (!noteToDuplicate) return

      const suffix = isZh ? '\u526F\u672C' : 'Copy'
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
        folder_path: noteToDuplicate.folder_path,
        is_daily: false,  // Duplicates are never daily notes
        daily_date: null,
        is_favorite: false,  // Don't copy favorite status
      })

      setNotes(prev => {
        const newNotes = [newNote as Note, ...prev]
        return newNotes.sort(compareNotesByPinnedAndUpdated)
      })
      selectSingleNoteRef.current((newNote as Note).id)
    } catch (error) {
      console.error('Failed to duplicate note:', error)
    }
  }, [flushQueuedEditorUpdates, isZh, notes, notesRef, notifyFlushRequired, selectSingleNoteRef, setNotes])

  // ---------------------------------------------------------------------------
  // handleSearch
  // ---------------------------------------------------------------------------

  const handleSearch = useCallback(async (query: string): Promise<Note[]> => {
    const results = await runUnifiedSearch({
      query,
      selectedNotebookId,
      selectedSmartView,
      notebooks,
      localNoteMetadataById,
      searchInternal: (searchQuery, filter) => window.electron.note.search(searchQuery, filter),
      searchLocal: (searchQuery) => window.electron.localFolder.search({ query: searchQuery }),
    })
    if (selectedNotebookId && selectedInternalFolderPath) {
      return results.filter((note) => isInternalPathInSubtree(note.folder_path, selectedInternalFolderPath))
    }
    return results
  }, [selectedInternalFolderPath, selectedNotebookId, selectedSmartView, notebooks, localNoteMetadataById])

  // ---------------------------------------------------------------------------
  // handleRestoreNote
  // ---------------------------------------------------------------------------

  const handleRestoreNote = useCallback(async (id: string) => {
    try {
      const success = await window.electron.trash.restore(id)
      if (success) {
        // Extract restored note via updater (runs synchronously), then update notes list separately.
        let noteToRestore: Note | undefined
        setTrashNotes(prev => {
          noteToRestore = prev.find(n => n.id === id)
          return prev.filter(n => n.id !== id)
        })
        if (noteToRestore) {
          const now = new Date().toISOString()
          const restoredNote = { ...noteToRestore, deleted_at: null, updated_at: now }
          setNotes(prev => {
            const newNotes = [restoredNote, ...prev]
            return newNotes.sort(compareNotesByPinnedAndUpdated)
          })
        }
      }
    } catch (error) {
      console.error('Failed to restore note:', error)
    }
  }, [setNotes, setTrashNotes])

  // ---------------------------------------------------------------------------
  // handlePermanentDelete
  // ---------------------------------------------------------------------------

  const handlePermanentDelete = useCallback(async (id: string) => {
    try {
      await window.electron.trash.permanentDelete(id)
      setTrashNotes(prev => prev.filter(n => n.id !== id))
    } catch (error) {
      console.error('Failed to permanently delete note:', error)
    }
  }, [setTrashNotes])

  // ---------------------------------------------------------------------------
  // handleEmptyTrash
  // ---------------------------------------------------------------------------

  const handleEmptyTrash = useCallback(async () => {
    try {
      await window.electron.trash.empty()
      setTrashNotes([])
    } catch (error) {
      console.error('Failed to empty trash:', error)
    }
  }, [setTrashNotes])

  // ---------------------------------------------------------------------------
  // handleBulkDelete
  // ---------------------------------------------------------------------------

  const handleBulkDelete = useCallback(async (ids: string[]) => {
    const uniqueIds = [...new Set(ids)].filter((id) => !isLocalResourceId(id))
    if (uniqueIds.length === 0) return
    try {
      const flushed = await flushQueuedEditorUpdatesForNotes(uniqueIds, DESTRUCTIVE_FLUSH_WAIT_TIMEOUT_MS)
      if (!flushed) {
        notifyFlushRequired()
        return
      }
      const now = new Date().toISOString()
      const notesToTrash: Note[] = []

      for (const id of uniqueIds) {
        const noteToDelete = notesRef.current.find(n => n.id === id)
        await window.electron.note.delete(id)
        clearEditorUpdateRuntimeState(id)
        if (noteToDelete) {
          notesToTrash.push({ ...noteToDelete, deleted_at: now })
        }
      }

      // Batch state updates
      const deletedIdSet = new Set(uniqueIds)
      setTrashNotes(prev => [...notesToTrash, ...prev])
      setNotes(prev => prev.filter(n => !deletedIdSet.has(n.id)))
      setSelectedNoteIds([])
      setAnchorNoteId(null)
    } catch (error) {
      console.error('Failed to bulk delete notes:', error)
    }
  }, [clearEditorUpdateRuntimeState, flushQueuedEditorUpdatesForNotes, notesRef, notifyFlushRequired, setAnchorNoteId, setNotes, setSelectedNoteIds, setTrashNotes])

  // ---------------------------------------------------------------------------
  // handleBulkToggleFavorite
  // ---------------------------------------------------------------------------

  const handleBulkToggleFavorite = useCallback(async (ids: string[]) => {
    const uniqueIds = [...new Set(ids)].filter((id) => !isLocalResourceId(id))
    if (uniqueIds.length === 0) return
    try {
      const flushed = await flushQueuedEditorUpdatesForNotes(uniqueIds, DESTRUCTIVE_FLUSH_WAIT_TIMEOUT_MS)
      if (!flushed) {
        notifyFlushRequired()
        return
      }
      // Set all to favorite (if any unfavorited, set all to favorite)
      const anyUnfavorited = uniqueIds.some(id => {
        const note = notesRef.current.find(n => n.id === id)
        return note && !note.is_favorite
      })
      const newFavoriteStatus = anyUnfavorited

      const results = await runWithConcurrency(uniqueIds, BULK_NOTE_PATCH_CONCURRENCY, async (id) => {
        const updated = await applyNonEditorNotePatch(id, { is_favorite: newFavoriteStatus })
        if (!updated) {
          throw new Error(`Bulk favorite update failed: ${id}`)
        }
      })
      const failed = results.filter((result): result is { item: string; ok: false; error: unknown } => !result.ok)
      if (failed.length > 0) {
        console.warn('[App] Partial bulk favorite failure:', failed)
        toast(
          isZh
            ? `\u90E8\u5206\u7B14\u8BB0\u66F4\u65B0\u5931\u8D25\uFF08${failed.length}/${uniqueIds.length}\uFF09`
            : `Some notes failed to update (${failed.length}/${uniqueIds.length})`,
          { type: 'error' }
        )
      }
    } catch (error) {
      console.error('Failed to bulk toggle favorite:', error)
    }
  }, [applyNonEditorNotePatch, flushQueuedEditorUpdatesForNotes, isZh, notesRef, notifyFlushRequired])

  // ---------------------------------------------------------------------------
  // Return
  // ---------------------------------------------------------------------------

  return {
    refreshInternalNotebookData,
    isNoteEmpty,
    deleteEmptyNoteIfNeeded,
    emptyNoteDeleteInFlightRef,
    handleCreateNote,
    handleOpenInNewTab,
    handleCreateDaily,
    handleUpdateNote,
    handleCreateNoteFromLink,
    handleTogglePinned,
    handleToggleFavorite,
    handleMoveToNotebook,
    handleMoveToFolder,
    handleDeleteNote,
    handleDuplicateNote,
    handleSearch,
    handleRestoreNote,
    handlePermanentDelete,
    handleEmptyTrash,
    handleBulkDelete,
    handleBulkToggleFavorite,
  }
}
