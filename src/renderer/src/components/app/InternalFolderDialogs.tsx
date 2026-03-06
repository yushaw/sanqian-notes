import { useState, useCallback } from 'react'
import { useTranslations } from '../../i18n'
import { Dialog } from '../Dialog'
import { toast } from '../../utils/toast'
import {
  MAX_INTERNAL_FOLDER_DEPTH,
  buildInternalFolderTree,
  findInternalFolderNodeByPath,
  getInternalFolderDepth,
  getInternalFolderDisplayName,
  isInternalPathInSubtree,
  normalizeInternalFolderPath,
  replaceInternalFolderPrefix,
} from '../../utils/localFolderNavigation'
import type { Note, NotebookFolder } from '../../types/note'

interface InternalCreateFolderDialogState {
  parentFolderPath: string | null
}

interface InternalRenameFolderDialogState {
  folderPath: string
  displayName: string
  initialName: string
}

interface InternalDeleteFolderDialogState {
  folderPath: string
  displayName: string
  affectedNoteCount: number
}

export interface InternalFolderDialogsDeps {
  selectedNotebookId: string | null
  isSelectedNotebookInternal: () => boolean
  notes: Note[]
  notebookFolders: NotebookFolder[]
  refreshNotebookFolders: () => Promise<unknown>
  refreshInternalNotebookData: () => Promise<void>
  onFolderPathChange: (updater: (prev: string | null) => string | null) => void
  onDeletedNoteIds?: (ids: string[]) => void
}

function resolveInternalFolderErrorMessage(
  errorCode: string,
  t: ReturnType<typeof useTranslations>,
): string {
  switch (errorCode) {
    case 'NOTEBOOK_FOLDER_INVALID_NAME':
      return t.notebook.createErrorInvalidName
    case 'NOTEBOOK_FOLDER_ALREADY_EXISTS':
      return t.notebook.createErrorAlreadyExists
    case 'NOTEBOOK_FOLDER_DEPTH_LIMIT':
      return t.notebook.createErrorDepthLimit
    case 'NOTEBOOK_FOLDER_NOT_FOUND':
      return t.notebook.createErrorParentMissing
    case 'NOTEBOOK_NOT_FOUND':
    case 'NOTEBOOK_NOT_INTERNAL':
    default:
      return t.notebook.createErrorGeneric
  }
}

export function useInternalFolderDialogs(deps: InternalFolderDialogsDeps) {
  const t = useTranslations()
  const {
    selectedNotebookId,
    isSelectedNotebookInternal,
    notes,
    notebookFolders,
    refreshNotebookFolders,
    refreshInternalNotebookData,
    onFolderPathChange,
    onDeletedNoteIds,
  } = deps

  const [createDialog, setCreateDialog] = useState<InternalCreateFolderDialogState | null>(null)
  const [createName, setCreateName] = useState('')
  const [createSubmitting, setCreateSubmitting] = useState(false)
  const [renameDialog, setRenameDialog] = useState<InternalRenameFolderDialogState | null>(null)
  const [renameName, setRenameName] = useState('')
  const [renameSubmitting, setRenameSubmitting] = useState(false)
  const [deleteDialog, setDeleteDialog] = useState<InternalDeleteFolderDialogState | null>(null)
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)

  const getDefaultFolderName = useCallback((parentFolderPath: string | null): string => {
    const baseName = t.notebook.defaultNewSubfolder
    const existingNames = new Set<string>()
    if (!selectedNotebookId) return baseName

    const notebookNotes = notes.filter((note) => note.notebook_id === selectedNotebookId && !note.is_daily)
    const notebookFolderEntries = notebookFolders.filter((folder) => folder.notebook_id === selectedNotebookId)
    const treeNodes = buildInternalFolderTree(notebookFolderEntries, notebookNotes)

    if (!parentFolderPath) {
      for (const node of treeNodes) {
        existingNames.add(node.name.toLowerCase())
      }
    } else {
      const parentNode = findInternalFolderNodeByPath(treeNodes, parentFolderPath)
      for (const child of parentNode?.children || []) {
        existingNames.add(child.name.toLowerCase())
      }
    }

    let index = 1
    while (true) {
      const candidate = index === 1 ? baseName : `${baseName} ${index}`
      if (!existingNames.has(candidate.toLowerCase())) {
        return candidate
      }
      index += 1
    }
  }, [notebookFolders, notes, selectedNotebookId, t.notebook.defaultNewSubfolder])

  const handleOpenCreate = useCallback((parentFolderPath: string | null) => {
    if (!selectedNotebookId || !isSelectedNotebookInternal()) return
    const normalizedParentPath = normalizeInternalFolderPath(parentFolderPath)
    if (getInternalFolderDepth(normalizedParentPath) >= MAX_INTERNAL_FOLDER_DEPTH) {
      toast(t.notebook.createErrorDepthLimit, { type: 'info' })
      return
    }
    setCreateDialog({ parentFolderPath: normalizedParentPath })
    setCreateName(getDefaultFolderName(normalizedParentPath))
  }, [
    getDefaultFolderName,
    isSelectedNotebookInternal,
    selectedNotebookId,
    t.notebook.createErrorDepthLimit,
  ])

  const handleConfirmCreate = useCallback(async () => {
    if (!selectedNotebookId || !createDialog || !isSelectedNotebookInternal()) return
    const folderName = createName.trim()
    if (!folderName) {
      toast(t.notebook.createErrorInvalidName, { type: 'error' })
      return
    }

    setCreateSubmitting(true)
    try {
      const result = await window.electron.notebookFolder.create({
        notebook_id: selectedNotebookId,
        parent_folder_path: createDialog.parentFolderPath,
        folder_name: folderName,
      })
      if (!result.success) {
        toast(resolveInternalFolderErrorMessage(result.errorCode, t), { type: 'error' })
        return
      }

      setCreateDialog(null)
      setCreateName('')
      onFolderPathChange(() => result.result.folder_path)
      await refreshNotebookFolders()
    } catch (error) {
      console.error('Failed to create internal folder:', error)
      toast(t.notebook.createErrorGeneric, { type: 'error' })
    } finally {
      setCreateSubmitting(false)
    }
  }, [
    createDialog,
    createName,
    isSelectedNotebookInternal,
    onFolderPathChange,
    refreshNotebookFolders,
    selectedNotebookId,
    t,
  ])

  const handleOpenRename = useCallback((folderPath: string) => {
    if (!selectedNotebookId || !isSelectedNotebookInternal()) return
    const normalizedPath = normalizeInternalFolderPath(folderPath)
    if (!normalizedPath) return
    const displayName = getInternalFolderDisplayName(normalizedPath)
    setRenameDialog({
      folderPath: normalizedPath,
      displayName,
      initialName: displayName,
    })
    setRenameName(displayName)
  }, [isSelectedNotebookInternal, selectedNotebookId])

  const handleConfirmRename = useCallback(async () => {
    if (!selectedNotebookId || !renameDialog || !isSelectedNotebookInternal()) return
    const nextName = renameName.trim()
    if (!nextName) {
      toast(t.notebook.createErrorInvalidName, { type: 'error' })
      return
    }

    setRenameSubmitting(true)
    try {
      const result = await window.electron.notebookFolder.rename({
        notebook_id: selectedNotebookId,
        folder_path: renameDialog.folderPath,
        new_name: nextName,
      })
      if (!result.success) {
        toast(resolveInternalFolderErrorMessage(result.errorCode, t), { type: 'error' })
        return
      }

      const oldFolderPath = renameDialog.folderPath
      const nextFolderPath = result.result.folder_path

      setRenameDialog(null)
      setRenameName('')
      onFolderPathChange((prev) => {
        if (!prev) return prev
        const replaced = replaceInternalFolderPrefix(prev, oldFolderPath, nextFolderPath)
        return replaced ?? prev
      })
      await refreshInternalNotebookData()
    } catch (error) {
      console.error('Failed to rename internal folder:', error)
      toast(t.notebook.createErrorGeneric, { type: 'error' })
    } finally {
      setRenameSubmitting(false)
    }
  }, [
    renameDialog,
    renameName,
    isSelectedNotebookInternal,
    onFolderPathChange,
    refreshInternalNotebookData,
    selectedNotebookId,
    t,
  ])

  const handleRequestDelete = useCallback((folderPath: string) => {
    if (!selectedNotebookId || !isSelectedNotebookInternal()) return
    const normalizedPath = normalizeInternalFolderPath(folderPath)
    if (!normalizedPath) return

    const affectedNoteCount = notes
      .filter((note) => note.notebook_id === selectedNotebookId && !note.is_daily)
      .filter((note) =>
      isInternalPathInSubtree(note.folder_path, normalizedPath)
      ).length

    setDeleteDialog({
      folderPath: normalizedPath,
      displayName: getInternalFolderDisplayName(normalizedPath),
      affectedNoteCount,
    })
  }, [isSelectedNotebookInternal, notes, selectedNotebookId])

  const handleConfirmDelete = useCallback(async () => {
    if (!selectedNotebookId || !deleteDialog || !isSelectedNotebookInternal()) return
    setDeleteSubmitting(true)

    try {
      const result = await window.electron.notebookFolder.delete({
        notebook_id: selectedNotebookId,
        folder_path: deleteDialog.folderPath,
      })
      if (!result.success) {
        toast(resolveInternalFolderErrorMessage(result.errorCode, t), { type: 'error' })
        return
      }

      if (result.result.deleted_note_ids.length > 0) {
        onDeletedNoteIds?.(result.result.deleted_note_ids)
      }

      onFolderPathChange((prev) => {
        if (!prev) return prev
        return isInternalPathInSubtree(prev, deleteDialog.folderPath) ? null : prev
      })

      setDeleteDialog(null)
      await refreshInternalNotebookData()
    } catch (error) {
      console.error('Failed to delete internal folder:', error)
      toast(t.notebook.deleteFailed, { type: 'error' })
    } finally {
      setDeleteSubmitting(false)
    }
  }, [
    deleteDialog,
    isSelectedNotebookInternal,
    onDeletedNoteIds,
    onFolderPathChange,
    refreshInternalNotebookData,
    selectedNotebookId,
    t,
  ])

  const resetDialogs = useCallback(() => {
    setCreateDialog(null)
    setCreateName('')
    setCreateSubmitting(false)
    setRenameDialog(null)
    setRenameName('')
    setRenameSubmitting(false)
    setDeleteDialog(null)
    setDeleteSubmitting(false)
  }, [])

  return {
    handleOpenCreate,
    handleOpenRename,
    handleRequestDelete,
    resetDialogs,
    renderDialogs: () => (
      <InternalFolderDialogsJSX
        createDialog={createDialog}
        createName={createName}
        createSubmitting={createSubmitting}
        renameDialog={renameDialog}
        renameName={renameName}
        renameSubmitting={renameSubmitting}
        deleteDialog={deleteDialog}
        deleteSubmitting={deleteSubmitting}
        onCreateNameChange={setCreateName}
        onRenameNameChange={setRenameName}
        onDismissCreate={() => { setCreateDialog(null); setCreateName('') }}
        onDismissRename={() => { setRenameDialog(null); setRenameName('') }}
        onDismissDelete={() => setDeleteDialog(null)}
        onConfirmCreate={handleConfirmCreate}
        onConfirmRename={handleConfirmRename}
        onConfirmDelete={handleConfirmDelete}
      />
    ),
  }
}

// --- JSX rendering (pure presentational) ---

interface InternalFolderDialogsJSXProps {
  createDialog: InternalCreateFolderDialogState | null
  createName: string
  createSubmitting: boolean
  renameDialog: InternalRenameFolderDialogState | null
  renameName: string
  renameSubmitting: boolean
  deleteDialog: InternalDeleteFolderDialogState | null
  deleteSubmitting: boolean
  onCreateNameChange: (name: string) => void
  onRenameNameChange: (name: string) => void
  onDismissCreate: () => void
  onDismissRename: () => void
  onDismissDelete: () => void
  onConfirmCreate: () => void
  onConfirmRename: () => void
  onConfirmDelete: () => void
}

function InternalFolderDialogsJSX(props: InternalFolderDialogsJSXProps) {
  const t = useTranslations()
  const {
    createDialog, createName, createSubmitting,
    renameDialog, renameName, renameSubmitting,
    deleteDialog, deleteSubmitting,
    onCreateNameChange, onRenameNameChange,
    onDismissCreate, onDismissRename, onDismissDelete,
    onConfirmCreate, onConfirmRename, onConfirmDelete,
  } = props
  const createTitle = t.notebook.createSubfolderDialogTitle

  return (
    <>
      {/* Internal Folder Create Dialog */}
      <Dialog
        open={!!createDialog}
        onClose={() => { if (!createSubmitting) onDismissCreate() }}
        ariaLabel={createTitle}
      >
        <form onSubmit={(event) => { event.preventDefault(); onConfirmCreate() }}>
          <div className="p-5">
            <h2 className="text-[1rem] font-semibold text-[var(--color-text)] mb-3 select-none">
              {createTitle}
            </h2>
            <label className="text-[0.8rem] text-[var(--color-text-secondary)] select-none">
              {t.notebook.createNameLabel}
            </label>
            <input
              value={createName}
              onChange={(event) => onCreateNameChange(event.target.value)}
              placeholder={t.notebook.createNamePlaceholderFolder}
              autoFocus
              className="mt-2 w-full px-3 py-2 rounded-lg bg-black/5 dark:bg-white/5 text-[0.867rem] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-accent)]/40"
            />
          </div>
          <div className="flex justify-end gap-2 px-5 pb-5">
            <button
              type="button"
              onClick={() => { if (!createSubmitting) onDismissCreate() }}
              className="px-4 py-2 text-[0.867rem] text-[var(--color-text)] bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 rounded-lg transition-all duration-150 select-none"
            >
              {t.actions.cancel}
            </button>
            <button
              type="submit"
              disabled={createSubmitting}
              className="px-4 py-2 text-[0.867rem] text-white bg-[var(--color-accent)] hover:opacity-90 rounded-lg transition-all duration-150 select-none disabled:opacity-60"
            >
              {t.actions.add}
            </button>
          </div>
        </form>
      </Dialog>

      {/* Internal Folder Rename Dialog */}
      <Dialog
        open={!!renameDialog}
        onClose={() => { if (!renameSubmitting) onDismissRename() }}
        ariaLabel={t.notebook.renameFolderDialogTitle}
      >
        <form onSubmit={(event) => { event.preventDefault(); onConfirmRename() }}>
          <div className="p-5">
            <h2 className="text-[1rem] font-semibold text-[var(--color-text)] mb-2 select-none">
              {t.notebook.renameFolderDialogTitle}
            </h2>
            {renameDialog && (
              <p className="text-[0.8rem] text-[var(--color-text-secondary)] select-none">
                {t.notebook.renameTargetLabel.replace('{name}', renameDialog.displayName)}
              </p>
            )}
            <label className="mt-3 block text-[0.8rem] text-[var(--color-text-secondary)] select-none">
              {t.notebook.renameNameLabel}
            </label>
            <input
              type="text"
              value={renameName}
              onChange={(event) => onRenameNameChange(event.target.value)}
              placeholder={t.notebook.renameNamePlaceholderFolder}
              autoFocus
              className="mt-2 w-full px-3 py-2 rounded-lg bg-black/5 dark:bg-white/5 text-[0.867rem] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-accent)]/40"
            />
          </div>
          <div className="flex justify-end gap-2 px-5 pb-5">
            <button
              type="button"
              onClick={() => { if (!renameSubmitting) onDismissRename() }}
              className="px-4 py-2 text-[0.867rem] text-[var(--color-text)] bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 rounded-lg transition-all duration-150 select-none"
            >
              {t.actions.cancel}
            </button>
            <button
              type="submit"
              disabled={renameSubmitting}
              className="px-4 py-2 text-[0.867rem] text-white bg-[var(--color-accent)] hover:opacity-90 rounded-lg transition-all duration-150 select-none disabled:opacity-60"
            >
              {t.actions.rename}
            </button>
          </div>
        </form>
      </Dialog>

      {/* Internal Folder Delete Dialog */}
      <Dialog
        open={!!deleteDialog}
        onClose={() => { if (!deleteSubmitting) onDismissDelete() }}
        ariaLabel={t.notebook.deleteFolderConfirmTitle}
        maxWidth="max-w-md"
      >
        <div className="p-5">
          <h2 className="text-[1rem] font-semibold text-[var(--color-text)] mb-2 select-none">
            {t.notebook.deleteFolderConfirmTitle}
          </h2>
          {deleteDialog && (
            <p className="text-[0.867rem] text-[var(--color-text-secondary)] select-none">
              {t.notebook.deleteInternalFolderConfirmMessage
                .replace('{name}', deleteDialog.displayName)
                .replace('{count}', String(deleteDialog.affectedNoteCount))}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 pb-5">
          <button
            onClick={() => { if (!deleteSubmitting) onDismissDelete() }}
            className="px-4 py-2 text-[0.867rem] text-[var(--color-text)] bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 rounded-lg transition-all duration-150 select-none"
          >
            {t.actions.cancel}
          </button>
          <button
            onClick={onConfirmDelete}
            disabled={deleteSubmitting}
            className="px-4 py-2 text-[0.867rem] text-white bg-red-500 hover:bg-red-600 rounded-lg transition-all duration-150 select-none disabled:opacity-60"
          >
            {t.actions.delete}
          </button>
        </div>
      </Dialog>
    </>
  )
}
