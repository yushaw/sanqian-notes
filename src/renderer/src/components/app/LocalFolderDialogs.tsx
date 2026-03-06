import { useState, useCallback } from 'react'
import { useTranslations } from '../../i18n'
import { Dialog } from '../Dialog'
import { toast } from '../../utils/toast'
import {
  getRelativePathDepth,
  getRelativePathDisplayName,
  replaceRelativePathPrefix,
} from '../../utils/localFolderNavigation'
import { createLocalResourceId } from '../../utils/localResourceId'
import type {
  Notebook,
  LocalFolderTreeResult,
  LocalFolderFileErrorCode,
  LocalFolderAffectedMount,
} from '../../types/note'

interface LocalCreateDialogState {
  kind: 'file' | 'folder'
  parentRelativePath: string | null
}

interface LocalRenameDialogState {
  kind: 'file' | 'folder'
  relativePath: string
  displayName: string
  initialName: string
}

interface LocalDeleteDialogState {
  kind: 'file' | 'folder'
  relativePath: string
  displayName: string
  affectedMounts: LocalFolderAffectedMount[]
}

export interface LocalFolderDialogsDeps {
  selectedNotebookId: string | null
  notebooks: Notebook[]
  localFolderTree: LocalFolderTreeResult | null
  selectedLocalFilePath: string | null
  selectedLocalFolderPath: string | null

  // Helpers
  resolveLocalCreateParentPath: (options?: {
    parentRelativePath?: string | null
    fileRelativePath?: string | null
  }) => string | null
  getDefaultLocalCreateName: (kind: 'file' | 'folder', parentRelativePath: string | null) => string
  resolveLocalFileErrorMessage: (errorCode: LocalFolderFileErrorCode) => string

  // File operations
  openLocalFile: (relativePath: string) => Promise<unknown>
  flushLocalFileSave: () => Promise<unknown>
  suppressLocalWatchRefresh: (notebookId: string) => void
  refreshLocalFolderTree: (notebookId: string, opts?: { showLoading?: boolean }) => Promise<unknown>

  // Ref-based checks
  getOpenFileInfo: () => { notebookId: string; relativePath: string } | null

  // State sync callbacks
  onSelectionChange: (updates: { localFilePath?: string | null; localFolderPath?: string | null }) => void
  onMetadataMigrate: (notebookId: string, oldPath: string, newPath: string, kind: 'file' | 'folder') => void
  onMetadataRemove: (notebookId: string, relativePath: string, kind: 'file' | 'folder') => void
  onAutoDraftClearIfNeeded: (notebookId: string, relativePath: string, kind: 'file' | 'folder') => void
  onLocalEditorClear: () => void

  // For updating allViewLocalEditorTarget on rename
  allViewLocalEditorTarget: { noteId: string; notebookId: string; relativePath: string } | null
  setAllViewLocalEditorTarget: import('react').Dispatch<import('react').SetStateAction<{ noteId: string; notebookId: string; relativePath: string } | null>>
}

export function useLocalFolderDialogs(deps: LocalFolderDialogsDeps) {
  const t = useTranslations()
  const {
    selectedNotebookId,
    notebooks,
    localFolderTree,
    selectedLocalFilePath,
    selectedLocalFolderPath,
    resolveLocalCreateParentPath,
    getDefaultLocalCreateName,
    resolveLocalFileErrorMessage,
    openLocalFile,
    flushLocalFileSave,
    suppressLocalWatchRefresh,
    refreshLocalFolderTree,
    getOpenFileInfo,
    onSelectionChange,
    onMetadataMigrate,
    onMetadataRemove,
    onAutoDraftClearIfNeeded,
    onLocalEditorClear,
    allViewLocalEditorTarget,
    setAllViewLocalEditorTarget,
  } = deps

  const [createDialog, setCreateDialog] = useState<LocalCreateDialogState | null>(null)
  const [createName, setCreateName] = useState('')
  const [createSubmitting, setCreateSubmitting] = useState(false)
  const [renameDialog, setRenameDialog] = useState<LocalRenameDialogState | null>(null)
  const [renameName, setRenameName] = useState('')
  const [renameSubmitting, setRenameSubmitting] = useState(false)
  const [deleteDialog, setDeleteDialog] = useState<LocalDeleteDialogState | null>(null)
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)

  // --- Open dialog handlers ---

  const handleOpenCreate = useCallback((
    kind: 'file' | 'folder',
    options?: { parentRelativePath?: string | null; fileRelativePath?: string | null }
  ) => {
    if (!selectedNotebookId) return
    const selectedNotebook = notebooks.find((item) => item.id === selectedNotebookId)
    if (!selectedNotebook || selectedNotebook.source_type !== 'local-folder') return

    const parentRelativePath = resolveLocalCreateParentPath(options)
    const canCreateFolder = getRelativePathDepth(parentRelativePath) < 3

    if (kind === 'folder' && !canCreateFolder) {
      toast(t.notebook.createErrorDepthLimit, { type: 'info' })
      return
    }

    setCreateDialog({ kind, parentRelativePath })
    setCreateName(getDefaultLocalCreateName(kind, parentRelativePath))
  }, [
    getDefaultLocalCreateName,
    notebooks,
    resolveLocalCreateParentPath,
    selectedNotebookId,
    t.notebook.createErrorDepthLimit,
  ])

  const handleOpenRename = useCallback((explicitTarget?: { kind: 'file' | 'folder'; relativePath: string }) => {
    if (!selectedNotebookId) return

    let target: { kind: 'file' | 'folder'; relativePath: string; displayName: string; initialName: string } | null = null
    if (explicitTarget) {
      if (explicitTarget.kind === 'file') {
        const explicitFile = (localFolderTree?.files || []).find((file) => file.relative_path === explicitTarget.relativePath) || null
        if (!explicitFile) return
        target = {
          kind: 'file',
          relativePath: explicitFile.relative_path,
          displayName: explicitFile.file_name,
          initialName: explicitFile.name,
        }
      } else {
        const folderName = getRelativePathDisplayName(explicitTarget.relativePath)
        target = {
          kind: 'folder',
          relativePath: explicitTarget.relativePath,
          displayName: folderName,
          initialName: folderName,
        }
      }
    } else {
      const selectedFile = selectedLocalFilePath
        ? (localFolderTree?.files || []).find((file) => file.relative_path === selectedLocalFilePath) || null
        : null
      target = selectedFile
        ? {
          kind: 'file',
          relativePath: selectedFile.relative_path,
          displayName: selectedFile.file_name,
          initialName: selectedFile.name,
        }
        : (selectedLocalFolderPath
          ? {
            kind: 'folder',
            relativePath: selectedLocalFolderPath,
            displayName: getRelativePathDisplayName(selectedLocalFolderPath),
            initialName: getRelativePathDisplayName(selectedLocalFolderPath),
          }
          : null)
    }

    if (!target) return
    setRenameDialog(target)
    setRenameName(target.initialName)
  }, [localFolderTree, selectedLocalFilePath, selectedLocalFolderPath, selectedNotebookId])

  const handleRequestDelete = useCallback(async (explicitTarget?: { kind: 'file' | 'folder'; relativePath: string }) => {
    if (!selectedNotebookId) return
    let target: { kind: 'file' | 'folder'; relativePath: string; displayName: string } | null = null
    if (explicitTarget) {
      if (explicitTarget.kind === 'file') {
        const explicitFile = (localFolderTree?.files || []).find((file) => file.relative_path === explicitTarget.relativePath) || null
        if (!explicitFile) return
        target = {
          kind: 'file',
          relativePath: explicitFile.relative_path,
          displayName: explicitFile.file_name,
        }
      } else {
        target = {
          kind: 'folder',
          relativePath: explicitTarget.relativePath,
          displayName: getRelativePathDisplayName(explicitTarget.relativePath),
        }
      }
    } else {
      const selectedFile = selectedLocalFilePath
        ? (localFolderTree?.files || []).find((file) => file.relative_path === selectedLocalFilePath) || null
        : null
      target = selectedFile
        ? {
          kind: 'file',
          relativePath: selectedFile.relative_path,
          displayName: selectedFile.file_name,
        }
        : (selectedLocalFolderPath
          ? {
            kind: 'folder',
            relativePath: selectedLocalFolderPath,
            displayName: getRelativePathDisplayName(selectedLocalFolderPath),
          }
          : null)
    }
    if (!target) return

    try {
      const analysis = await window.electron.localFolder.analyzeDelete({
        notebook_id: selectedNotebookId,
        relative_path: target.relativePath,
        kind: target.kind,
      })
      if (!analysis.success) {
        toast(resolveLocalFileErrorMessage(analysis.errorCode), { type: 'error' })
        return
      }

      setDeleteDialog({
        kind: target.kind,
        relativePath: target.relativePath,
        displayName: target.displayName,
        affectedMounts: analysis.result.affected_mounts,
      })
    } catch (error) {
      console.error('Failed to analyze local entry deletion:', error)
      toast(t.notebook.deleteFailed, { type: 'error' })
    }
  }, [
    localFolderTree,
    resolveLocalFileErrorMessage,
    selectedNotebookId,
    selectedLocalFilePath,
    selectedLocalFolderPath,
    t.notebook.deleteFailed,
  ])

  // --- Confirm handlers ---

  const handleConfirmCreate = useCallback(async () => {
    if (!selectedNotebookId || !createDialog) return
    const name = createName.trim()
    if (!name) {
      toast(t.notebook.createErrorInvalidName, { type: 'error' })
      return
    }

    setCreateSubmitting(true)
    try {
      const result = createDialog.kind === 'file'
        ? await window.electron.localFolder.createFile({
          notebook_id: selectedNotebookId,
          parent_relative_path: createDialog.parentRelativePath,
          file_name: name,
        })
        : await window.electron.localFolder.createFolder({
          notebook_id: selectedNotebookId,
          parent_relative_path: createDialog.parentRelativePath,
          folder_name: name,
        })

      if (!result.success) {
        toast(resolveLocalFileErrorMessage(result.errorCode), { type: 'error' })
        return
      }

      const createdRelativePath = result.result.relative_path
      setCreateDialog(null)
      setCreateName('')
      suppressLocalWatchRefresh(selectedNotebookId)
      await refreshLocalFolderTree(selectedNotebookId, { showLoading: false })

      if (createDialog.kind === 'file') {
        onSelectionChange({ localFolderPath: createDialog.parentRelativePath })
        await openLocalFile(createdRelativePath)
      } else {
        onSelectionChange({ localFolderPath: createdRelativePath, localFilePath: null })
      }
    } catch (error) {
      console.error('Failed to create local entry:', error)
      toast(t.notebook.createErrorGeneric, { type: 'error' })
    } finally {
      setCreateSubmitting(false)
    }
  }, [
    createDialog,
    createName,
    onSelectionChange,
    openLocalFile,
    refreshLocalFolderTree,
    resolveLocalFileErrorMessage,
    selectedNotebookId,
    suppressLocalWatchRefresh,
    t.notebook.createErrorGeneric,
    t.notebook.createErrorInvalidName,
  ])

  const handleConfirmRename = useCallback(async () => {
    if (!selectedNotebookId || !renameDialog) return
    const name = renameName.trim()
    if (!name) {
      toast(t.notebook.createErrorInvalidName, { type: 'error' })
      return
    }

    setRenameSubmitting(true)
    try {
      const currentOpenFile = getOpenFileInfo()
      const renameTouchesOpenFile = Boolean(
        currentOpenFile
        && currentOpenFile.notebookId === selectedNotebookId
        && (
          renameDialog.kind === 'file'
            ? currentOpenFile.relativePath === renameDialog.relativePath
            : currentOpenFile.relativePath === renameDialog.relativePath
              || currentOpenFile.relativePath.startsWith(`${renameDialog.relativePath}/`)
        )
      )
      if (renameTouchesOpenFile) {
        await flushLocalFileSave()
      }

      const result = await window.electron.localFolder.renameEntry({
        notebook_id: selectedNotebookId,
        relative_path: renameDialog.relativePath,
        kind: renameDialog.kind,
        new_name: name,
      })
      if (!result.success) {
        toast(resolveLocalFileErrorMessage(result.errorCode), { type: 'error' })
        return
      }

      const oldRelativePath = renameDialog.relativePath
      const newRelativePath = result.result.relative_path
      onMetadataMigrate(selectedNotebookId, oldRelativePath, newRelativePath, renameDialog.kind)

      if (renameDialog.kind === 'file') {
        if (selectedLocalFilePath === oldRelativePath) {
          onSelectionChange({ localFilePath: newRelativePath })
        }
      } else {
        const updates: { localFolderPath?: string | null; localFilePath?: string | null } = {}
        if (selectedLocalFolderPath) {
          const nextFolderPath = replaceRelativePathPrefix(selectedLocalFolderPath, oldRelativePath, newRelativePath)
          if (nextFolderPath) {
            updates.localFolderPath = nextFolderPath
          }
        }
        if (selectedLocalFilePath) {
          const nextFilePath = replaceRelativePathPrefix(selectedLocalFilePath, oldRelativePath, newRelativePath)
          if (nextFilePath) {
            updates.localFilePath = nextFilePath
          }
        }
        if (Object.keys(updates).length > 0) {
          onSelectionChange(updates)
        }
      }

      let nextOpenFilePath: string | null = null
      if (currentOpenFile && currentOpenFile.notebookId === selectedNotebookId) {
        if (renameDialog.kind === 'file') {
          if (currentOpenFile.relativePath === oldRelativePath) {
            nextOpenFilePath = newRelativePath
          }
        } else {
          nextOpenFilePath = replaceRelativePathPrefix(currentOpenFile.relativePath, oldRelativePath, newRelativePath)
        }
      }

      onAutoDraftClearIfNeeded(selectedNotebookId, oldRelativePath, renameDialog.kind)

      // Fix: update allViewLocalEditorTarget to new path
      if (allViewLocalEditorTarget && allViewLocalEditorTarget.notebookId === selectedNotebookId) {
        if (renameDialog.kind === 'file' && allViewLocalEditorTarget.relativePath === oldRelativePath) {
          setAllViewLocalEditorTarget({
            noteId: createLocalResourceId(selectedNotebookId, newRelativePath),
            notebookId: selectedNotebookId,
            relativePath: newRelativePath,
          })
        } else if (renameDialog.kind === 'folder') {
          const nextPath = replaceRelativePathPrefix(allViewLocalEditorTarget.relativePath, oldRelativePath, newRelativePath)
          if (nextPath) {
            setAllViewLocalEditorTarget({
              noteId: createLocalResourceId(selectedNotebookId, nextPath),
              notebookId: selectedNotebookId,
              relativePath: nextPath,
            })
          }
        }
      }

      setRenameDialog(null)
      setRenameName('')
      suppressLocalWatchRefresh(selectedNotebookId)
      await refreshLocalFolderTree(selectedNotebookId, { showLoading: false })

      if (nextOpenFilePath) {
        await openLocalFile(nextOpenFilePath)
      }
    } catch (error) {
      console.error('Failed to rename local entry:', error)
      toast(t.notebook.renameFailed, { type: 'error' })
    } finally {
      setRenameSubmitting(false)
    }
  }, [
    allViewLocalEditorTarget,
    flushLocalFileSave,
    getOpenFileInfo,
    onAutoDraftClearIfNeeded,
    onMetadataMigrate,
    onSelectionChange,
    openLocalFile,
    refreshLocalFolderTree,
    renameDialog,
    renameName,
    resolveLocalFileErrorMessage,
    selectedLocalFilePath,
    selectedLocalFolderPath,
    selectedNotebookId,
    setAllViewLocalEditorTarget,
    suppressLocalWatchRefresh,
    t.notebook.createErrorInvalidName,
    t.notebook.renameFailed,
  ])

  const handleConfirmDelete = useCallback(async () => {
    if (!selectedNotebookId || !deleteDialog) return
    setDeleteSubmitting(true)

    try {
      const currentOpenFile = getOpenFileInfo()
      const deletingOpenFile = Boolean(
        currentOpenFile
        && currentOpenFile.notebookId === selectedNotebookId
        && (
          deleteDialog.kind === 'file'
            ? currentOpenFile.relativePath === deleteDialog.relativePath
            : currentOpenFile.relativePath === deleteDialog.relativePath
              || currentOpenFile.relativePath.startsWith(`${deleteDialog.relativePath}/`)
        )
      )

      if (deletingOpenFile) {
        await flushLocalFileSave()
        // Disarm save mechanism immediately so that Editor's debounce firing
        // during the async delete IPC cannot re-queue saves and resurrect the file.
        onLocalEditorClear()
      }

      const result = await window.electron.localFolder.deleteEntry({
        notebook_id: selectedNotebookId,
        relative_path: deleteDialog.relativePath,
        kind: deleteDialog.kind,
      })

      if (!result.success) {
        toast(resolveLocalFileErrorMessage(result.errorCode), { type: 'error' })
        return
      }

      onMetadataRemove(selectedNotebookId, deleteDialog.relativePath, deleteDialog.kind)

      if (deleteDialog.kind === 'file') {
        if (selectedLocalFilePath === deleteDialog.relativePath) {
          onSelectionChange({ localFilePath: null })
        }
      } else {
        const updates: { localFolderPath?: string | null; localFilePath?: string | null } = {}
        if (
          selectedLocalFolderPath
          && (selectedLocalFolderPath === deleteDialog.relativePath
            || selectedLocalFolderPath.startsWith(`${deleteDialog.relativePath}/`))
        ) {
          updates.localFolderPath = null
        }
        if (
          selectedLocalFilePath
          && (selectedLocalFilePath === deleteDialog.relativePath
            || selectedLocalFilePath.startsWith(`${deleteDialog.relativePath}/`))
        ) {
          updates.localFilePath = null
        }
        if (Object.keys(updates).length > 0) {
          onSelectionChange(updates)
        }
      }

      onAutoDraftClearIfNeeded(selectedNotebookId, deleteDialog.relativePath, deleteDialog.kind)

      // onLocalEditorClear() already called before delete IPC (above) to prevent
      // save-race file resurrection.

      setDeleteDialog(null)
      suppressLocalWatchRefresh(selectedNotebookId)
      await refreshLocalFolderTree(selectedNotebookId, { showLoading: false })
    } catch (error) {
      console.error('Failed to delete local entry:', error)
      toast(t.notebook.deleteFailed, { type: 'error' })
    } finally {
      setDeleteSubmitting(false)
    }
  }, [
    deleteDialog,
    flushLocalFileSave,
    getOpenFileInfo,
    onAutoDraftClearIfNeeded,
    onLocalEditorClear,
    onMetadataRemove,
    onSelectionChange,
    refreshLocalFolderTree,
    resolveLocalFileErrorMessage,
    selectedLocalFilePath,
    selectedLocalFolderPath,
    selectedNotebookId,
    suppressLocalWatchRefresh,
    t.notebook.deleteFailed,
  ])

  // --- Reset ---

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
      <LocalFolderDialogsJSX
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

interface LocalFolderDialogsJSXProps {
  createDialog: LocalCreateDialogState | null
  createName: string
  createSubmitting: boolean
  renameDialog: LocalRenameDialogState | null
  renameName: string
  renameSubmitting: boolean
  deleteDialog: LocalDeleteDialogState | null
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

function LocalFolderDialogsJSX(props: LocalFolderDialogsJSXProps) {
  const t = useTranslations()
  const {
    createDialog, createName, createSubmitting,
    renameDialog, renameName, renameSubmitting,
    deleteDialog, deleteSubmitting,
    onCreateNameChange, onRenameNameChange,
    onDismissCreate, onDismissRename, onDismissDelete,
    onConfirmCreate, onConfirmRename, onConfirmDelete,
  } = props

  const createTitle = createDialog
    ? (
      createDialog.kind === 'file'
        ? t.notebook.createFileDialogTitle
        : t.notebook.createSubfolderDialogTitle
    )
    : ''
  const renameTitle = renameDialog
    ? (renameDialog.kind === 'file' ? t.notebook.renameFileDialogTitle : t.notebook.renameFolderDialogTitle)
    : ''
  const deleteTitle = deleteDialog
    ? (deleteDialog.kind === 'file' ? t.notebook.deleteFileConfirmTitle : t.notebook.deleteFolderConfirmTitle)
    : ''

  return (
    <>
      {/* Local Create Dialog */}
      <Dialog open={!!createDialog} onClose={() => { if (!createSubmitting) onDismissCreate() }} ariaLabel={createTitle}>
        {createDialog && (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              onConfirmCreate()
            }}
          >
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
                placeholder={
                  createDialog.kind === 'file'
                    ? t.notebook.createNamePlaceholderFile
                    : t.notebook.createNamePlaceholderFolder
                }
                autoFocus
                className="mt-2 w-full px-3 py-2 rounded-lg bg-black/5 dark:bg-white/5 text-[0.867rem] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-accent)]/40"
              />
            </div>
            <div className="flex justify-end gap-2 px-5 pb-5">
              <button
                type="button"
                onClick={() => {
                  if (createSubmitting) return
                  onDismissCreate()
                }}
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
        )}
      </Dialog>

      {/* Local Rename Dialog */}
      <Dialog open={!!renameDialog} onClose={() => { if (!renameSubmitting) onDismissRename() }} ariaLabel={renameTitle}>
        {renameDialog && (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              onConfirmRename()
            }}
          >
            <div className="p-5">
              <h2 className="text-[1rem] font-semibold text-[var(--color-text)] mb-2 select-none">
                {renameTitle}
              </h2>
              <p className="text-[0.8rem] text-[var(--color-text-secondary)] select-none">
                {t.notebook.renameTargetLabel.replace('{name}', renameDialog.displayName)}
              </p>
              <label className="mt-3 block text-[0.8rem] text-[var(--color-text-secondary)] select-none">
                {t.notebook.renameNameLabel}
              </label>
              <input
                type="text"
                value={renameName}
                onChange={(event) => onRenameNameChange(event.target.value)}
                placeholder={
                  renameDialog.kind === 'file'
                    ? t.notebook.renameNamePlaceholderFile
                    : t.notebook.renameNamePlaceholderFolder
                }
                autoFocus
                className="mt-2 w-full px-3 py-2 rounded-lg bg-black/5 dark:bg-white/5 text-[0.867rem] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-accent)]/40"
              />
            </div>
            <div className="flex justify-end gap-2 px-5 pb-5">
              <button
                type="button"
                onClick={() => {
                  if (renameSubmitting) return
                  onDismissRename()
                }}
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
        )}
      </Dialog>

      {/* Local Delete Confirmation Dialog */}
      <Dialog open={!!deleteDialog} onClose={() => { if (!deleteSubmitting) onDismissDelete() }} maxWidth="max-w-md" ariaLabel={deleteTitle}>
        {deleteDialog && (
          <>
            <div className="p-5">
              <h2 className="text-[1rem] font-semibold text-[var(--color-text)] mb-2 select-none">
                {deleteTitle}
              </h2>
              <p className="text-[0.867rem] text-[var(--color-text-secondary)] select-none">
                {(deleteDialog.kind === 'file'
                  ? t.notebook.deleteFileConfirmMessage
                  : t.notebook.deleteFolderConfirmMessage).replace('{name}', deleteDialog.displayName)}
              </p>
              {deleteDialog.affectedMounts.length > 0 && (
                <div className="mt-3 px-3 py-2 rounded-lg bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)]">
                  <p className="text-[0.78rem] text-[var(--color-text)] font-medium">
                    {t.notebook.deleteImpactTitle}
                  </p>
                  <p className="mt-1 text-[0.76rem] text-[var(--color-text-secondary)]">
                    {t.notebook.deleteImpactMessage.replace(
                      '{names}',
                      deleteDialog.affectedMounts.map((mount) => mount.notebook_name).join(', ')
                    )}
                  </p>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 pb-5">
              <button
                onClick={() => {
                  if (deleteSubmitting) return
                  onDismissDelete()
                }}
                className="px-4 py-2 text-[0.867rem] text-[var(--color-text)] bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 rounded-lg transition-all duration-150 select-none"
              >
                {t.actions.cancel}
              </button>
              <button
                onClick={() => onConfirmDelete()}
                disabled={deleteSubmitting}
                className="px-4 py-2 text-[0.867rem] text-white bg-red-500 hover:bg-red-600 rounded-lg transition-all duration-150 select-none disabled:opacity-60"
              >
                {t.actions.delete}
              </button>
            </div>
          </>
        )}
      </Dialog>
    </>
  )
}
