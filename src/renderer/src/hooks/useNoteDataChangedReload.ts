import { useEffect } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { buildLocalNoteMetadataMap, mergeLocalNotebookStatuses, mergeNotebooksWithLocalMounts } from '../utils/localFolderNavigation'
import type {
  LocalNoteMetadata,
  Note,
  NoteInput,
  Notebook,
  NotebookFolder,
} from '../types/note'

interface UseNoteDataChangedReloadOptions {
  refreshLocalFolderTree: (notebookId: string, options?: { showLoading?: boolean }) => Promise<unknown>
  refreshOpenLocalFileFromDisk: () => Promise<void>
  notesRef: MutableRefObject<Note[]>
  localOpenFileRef: MutableRefObject<{ notebookId: string; relativePath: string } | null>
  pendingEditorUpdatesRef: MutableRefObject<Map<string, Partial<Pick<NoteInput, 'title' | 'content'>>>>
  setNotes: Dispatch<SetStateAction<Note[]>>
  setNotebooks: Dispatch<SetStateAction<Notebook[]>>
  setNotebookFolders: Dispatch<SetStateAction<NotebookFolder[]>>
  setLocalNoteMetadataById: Dispatch<SetStateAction<Record<string, LocalNoteMetadata>>>
  setLocalFolderStatuses: Dispatch<SetStateAction<Record<string, import('../types/note').NotebookStatus>>>
}

export function useNoteDataChangedReload(options: UseNoteDataChangedReloadOptions): void {
  const {
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
  } = options

  useEffect(() => {
    const cleanup = window.electron.note.onDataChanged(async () => {
      console.log('[App] Data changed, reloading data...')
      try {
        const [notesData, notebooksData, localMountsResponse, notebookFolderData, localMetadataResponse] = await Promise.all([
          window.electron.note.getAll(),
          window.electron.notebook.getAll(),
          window.electron.localFolder.list(),
          window.electron.notebookFolder.list(),
          window.electron.localFolder.listNoteMetadata(),
        ])
        const localMountSnapshots = localMountsResponse.success
          ? localMountsResponse.result.mounts
          : []
        if (!localMountsResponse.success) {
          console.warn('[App] Failed to reload local folder mounts:', localMountsResponse.errorCode)
        }
        const mergedNotebooks = mergeNotebooksWithLocalMounts(notebooksData as Notebook[], localMountSnapshots)
        const localMetadataItems = localMetadataResponse.success ? localMetadataResponse.result.items : []
        if (!localMetadataResponse.success) {
          console.warn('[App] Failed to reload local note metadata:', localMetadataResponse.errorCode)
        }
        const mergedNotes = (notesData as Note[]).map((note) => {
          const pending = pendingEditorUpdatesRef.current.get(note.id)
          return pending ? { ...note, ...pending } : note
        })
        notesRef.current = mergedNotes
        setNotes(mergedNotes)
        setNotebooks(mergedNotebooks)
        setNotebookFolders(notebookFolderData as NotebookFolder[])
        setLocalNoteMetadataById(buildLocalNoteMetadataMap(localMetadataItems))
        setLocalFolderStatuses((prev) => mergeLocalNotebookStatuses(prev, mergedNotebooks, localMountSnapshots))

        const openLocalFileSnapshot = localOpenFileRef.current
        if (openLocalFileSnapshot) {
          void refreshLocalFolderTree(openLocalFileSnapshot.notebookId, { showLoading: false })
          await refreshOpenLocalFileFromDisk()
        }
      } catch (error) {
        console.error('[App] Failed to reload data:', error)
      }
    })
    return cleanup
  }, [
    localOpenFileRef,
    notesRef,
    pendingEditorUpdatesRef,
    refreshLocalFolderTree,
    refreshOpenLocalFileFromDisk,
    setLocalFolderStatuses,
    setLocalNoteMetadataById,
    setNotebookFolders,
    setNotebooks,
    setNotes,
  ])
}
