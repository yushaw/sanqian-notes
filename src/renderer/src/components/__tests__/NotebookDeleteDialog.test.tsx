/**
 * NotebookDeleteDialog regression tests
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Notebook } from '../../types/note'
import { useNotebookDeleteDialog } from '../app/NotebookDeleteDialog'

vi.mock('../../i18n', () => ({
  useTranslations: () => ({
    notebook: {
      deleteConfirmTitle: 'Delete Notebook',
      deleteConfirmMessage: 'Delete "{name}" forever?',
      unmountConfirmTitle: 'Unmount Folder',
      unmountConfirmMessage: 'Unmount "{name}"?',
    },
    actions: {
      cancel: 'Cancel',
      delete: 'Delete',
    },
  }),
}))

function createNotebook(overrides?: Partial<Notebook>): Notebook {
  return {
    id: 'nb-1',
    name: 'Primary',
    icon: 'logo:notes',
    source_type: 'internal',
    order_index: 0,
    created_at: '2026-03-01T00:00:00.000Z',
    ...overrides,
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useNotebookDeleteDialog', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('keeps dialog open when confirm callback returns false', async () => {
    const onConfirmDelete = vi.fn(async () => false)
    let api: ReturnType<typeof useNotebookDeleteDialog> | null = null

    function Harness() {
      api = useNotebookDeleteDialog({ onConfirmDelete })
      return api.renderDialog()
    }

    render(<Harness />)

    await act(async () => {
      api?.requestDelete(createNotebook())
    })

    const deleteButton = screen.getByRole('button', { name: 'Delete' })
    await act(async () => {
      fireEvent.click(deleteButton)
    })

    await waitFor(() => {
      expect(onConfirmDelete).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByRole('dialog', { name: 'Delete Notebook' })).toBeInTheDocument()
    expect(deleteButton).not.toBeDisabled()
  })

  it('closes dialog when confirm callback returns true', async () => {
    const onConfirmDelete = vi.fn(async () => true)
    let api: ReturnType<typeof useNotebookDeleteDialog> | null = null

    function Harness() {
      api = useNotebookDeleteDialog({ onConfirmDelete })
      return api.renderDialog()
    }

    render(<Harness />)

    await act(async () => {
      api?.requestDelete(createNotebook())
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    })

    await waitFor(() => {
      expect(onConfirmDelete).toHaveBeenCalledTimes(1)
    })
    expect(screen.queryByRole('dialog', { name: 'Delete Notebook' })).not.toBeInTheDocument()
  })

  it('prevents duplicate confirm clicks while submit is in progress', async () => {
    const deferred = createDeferred<boolean>()
    const onConfirmDelete = vi.fn(() => deferred.promise)
    let api: ReturnType<typeof useNotebookDeleteDialog> | null = null

    function Harness() {
      api = useNotebookDeleteDialog({ onConfirmDelete })
      return api.renderDialog()
    }

    render(<Harness />)

    await act(async () => {
      api?.requestDelete(createNotebook())
    })

    const deleteButton = screen.getByRole('button', { name: 'Delete' })
    const cancelButton = screen.getByRole('button', { name: 'Cancel' })

    await act(async () => {
      fireEvent.click(deleteButton)
      fireEvent.click(deleteButton)
      fireEvent.click(cancelButton)
    })

    expect(onConfirmDelete).toHaveBeenCalledTimes(1)
    expect(deleteButton).toBeDisabled()
    expect(cancelButton).toBeDisabled()
    expect(screen.getByRole('dialog', { name: 'Delete Notebook' })).toBeInTheDocument()

    await act(async () => {
      deferred.resolve(true)
      await deferred.promise
    })

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Delete Notebook' })).not.toBeInTheDocument()
    })
  })

  it('swallows confirm callback exception and keeps dialog open', async () => {
    const onConfirmDelete = vi.fn(async () => {
      throw new Error('boom')
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let api: ReturnType<typeof useNotebookDeleteDialog> | null = null

    function Harness() {
      api = useNotebookDeleteDialog({ onConfirmDelete })
      return api.renderDialog()
    }

    render(<Harness />)

    await act(async () => {
      api?.requestDelete(createNotebook())
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    })

    await waitFor(() => {
      expect(onConfirmDelete).toHaveBeenCalledTimes(1)
    })
    expect(errorSpy).toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Delete Notebook' })).toBeInTheDocument()
  })
})
