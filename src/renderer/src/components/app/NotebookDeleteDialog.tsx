import { useState, useCallback, useRef } from 'react'
import { useTranslations } from '../../i18n'
import { Dialog } from '../Dialog'
import type { Notebook } from '../../types/note'

export interface NotebookDeleteDialogDeps {
  onConfirmDelete: (notebook: Notebook) => Promise<boolean>
}

export function useNotebookDeleteDialog(deps: NotebookDeleteDialogDeps) {
  const { onConfirmDelete } = deps
  const [notebookToDelete, setNotebookToDelete] = useState<Notebook | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isSubmittingRef = useRef(false)

  const requestDelete = useCallback((notebook: Notebook) => {
    isSubmittingRef.current = false
    setIsSubmitting(false)
    setNotebookToDelete(notebook)
  }, [])

  const handleConfirm = useCallback(async () => {
    if (!notebookToDelete || isSubmittingRef.current) return
    isSubmittingRef.current = true
    setIsSubmitting(true)
    try {
      const confirmed = await onConfirmDelete(notebookToDelete)
      if (confirmed) {
        setNotebookToDelete(null)
      }
    } catch (error) {
      console.error('[NotebookDeleteDialog] confirm delete failed:', error)
    } finally {
      isSubmittingRef.current = false
      setIsSubmitting(false)
    }
  }, [notebookToDelete, onConfirmDelete])

  const handleDismiss = useCallback(() => {
    if (isSubmittingRef.current) return
    setNotebookToDelete(null)
  }, [])

  return {
    requestDelete,
    renderDialog: () => (
      <NotebookDeleteDialogJSX
        notebook={notebookToDelete}
        isSubmitting={isSubmitting}
        onDismiss={handleDismiss}
        onConfirm={handleConfirm}
      />
    ),
  }
}

// --- JSX rendering (pure presentational) ---

interface NotebookDeleteDialogJSXProps {
  notebook: Notebook | null
  isSubmitting: boolean
  onDismiss: () => void
  onConfirm: () => void
}

function NotebookDeleteDialogJSX(props: NotebookDeleteDialogJSXProps) {
  const t = useTranslations()
  const { notebook, isSubmitting, onDismiss, onConfirm } = props

  const title = notebook
    ? (notebook.source_type === 'local-folder' ? t.notebook.unmountConfirmTitle : t.notebook.deleteConfirmTitle)
    : ''

  return (
    <Dialog open={!!notebook} onClose={onDismiss} ariaLabel={title}>
      {notebook && (
        <>
          <div className="p-5">
            <h2 className="text-[1rem] font-semibold text-[var(--color-text)] mb-2 select-none">
              {title}
            </h2>
            <p className="text-[0.867rem] text-[var(--color-text-secondary)] select-none">
              {(notebook.source_type === 'local-folder'
                ? t.notebook.unmountConfirmMessage
                : t.notebook.deleteConfirmMessage).replace('{name}', notebook.name)}
            </p>
          </div>
          <div className="flex justify-end gap-2 px-5 pb-5">
            <button
              onClick={onDismiss}
              disabled={isSubmitting}
              className="px-4 py-2 text-[0.867rem] text-[var(--color-text)] bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 rounded-lg transition-all duration-150 select-none"
            >
              {t.actions.cancel}
            </button>
            <button
              onClick={onConfirm}
              disabled={isSubmitting}
              className="px-4 py-2 text-[0.867rem] text-white bg-red-500 hover:bg-red-600 rounded-lg transition-all duration-150 select-none"
            >
              {t.actions.delete}
            </button>
          </div>
        </>
      )}
    </Dialog>
  )
}
