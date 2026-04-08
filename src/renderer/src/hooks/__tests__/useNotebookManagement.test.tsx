/**
 * useNotebookManagement delete-flow regression tests
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'
import type { Note, Notebook, NotebookFolder } from '../../types/note'
import type { UseNotebookManagementOptions } from '../useNotebookManagement'
import { useNotebookManagement } from '../useNotebookManagement'

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  useInternalFolderDialogs: vi.fn(() => ({
    handleOpenCreate: vi.fn(),
    handleOpenRename: vi.fn(),
    handleRequestDelete: vi.fn(),
    resetDialogs: vi.fn(),
    renderDialogs: () => null,
  })),
  useNotebookDeleteDialog: vi.fn(() => ({
    requestDelete: vi.fn(),
    renderDialog: () => null,
  })),
}))

vi.mock('../../utils/toast', () => ({
  toast: mocks.toast,
}))

vi.mock('../../components/app/InternalFolderDialogs', () => ({
  useInternalFolderDialogs: mocks.useInternalFolderDialogs,
}))

vi.mock('../../components/app/NotebookDeleteDialog', () => ({
  useNotebookDeleteDialog: mocks.useNotebookDeleteDialog,
}))

function createNotebook(overrides?: Partial<Notebook>): Notebook {
  return {
    id: 'nb-1',
    name: 'Notebook 1',
    icon: 'logo:notes',
    source_type: 'internal',
    order_index: 0,
    created_at: '2026-03-01T00:00:00.000Z',
    ...overrides,
  }
}

function createNote(overrides?: Partial<Note>): Note {
  return {
    id: 'note-1',
    title: 'Note 1',
    content: '',
    notebook_id: 'nb-1',
    folder_path: null,
    created_at: '2026-03-01T00:00:00.000Z',
    updated_at: '2026-03-01T00:00:00.000Z',
    is_pinned: false,
    revision: 1,
    ...overrides,
  } as Note
}

function createOptions(overrides?: Partial<UseNotebookManagementOptions>): UseNotebookManagementOptions {
  const notebooks = [
    createNotebook({ id: 'nb-1', source_type: 'internal' }),
    createNotebook({ id: 'nb-2', source_type: 'internal' }),
    createNotebook({ id: 'nb-local', source_type: 'local-folder' }),
  ]
  const notes = [
    createNote({ id: 'note-1', notebook_id: 'nb-1' }),
    createNote({ id: 'note-2', notebook_id: 'nb-1' }),
    createNote({ id: 'note-3', notebook_id: 'nb-2' }),
  ]
  return {
    notebooks,
    notes,
    notebookFolders: [] as NotebookFolder[],
    selectedNotebookId: 'nb-2',
    selectedInternalFolderPath: 'docs',
    localFolderTree: null,
    localNotebookHasChildFolders: {},

    setNotebooks: vi.fn(),
    setNotebookFolders: vi.fn(),
    setNotes: vi.fn(),
    setTrashNotes: vi.fn(),
    setSelectedNotebookId: vi.fn(),
    setSelectedSmartView: vi.fn(),
    setIsTypewriterMode: vi.fn(),
    setSelectedNoteIds: vi.fn(),
    setAnchorNoteId: vi.fn(),
    setSelectedInternalFolderPath: vi.fn(),

    clearEditorUpdateRuntimeState: vi.fn(),
    flushQueuedEditorUpdatesForNotes: vi.fn(async () => true),
    notifyFlushRequired: vi.fn(),

    localOpenFileRef: {
      current: null,
    },
    localAutoDraftRef: {
      current: null,
    },
    flushLocalFileSave: vi.fn(async () => undefined),
    cleanupLocalAutoDraftIfNeeded: vi.fn(async () => undefined),
    cleanupUnmountedLocalNotebook: vi.fn(),
    resetLocalEditorState: vi.fn(),

    refreshInternalNotebookData: vi.fn(async () => undefined),
    t: {
      notebook: {
        deleteFailed: 'delete-failed',
      },
    } as any,
    ...overrides,
  }
}

describe('useNotebookManagement delete flow', () => {
  beforeEach(() => {
    mocks.toast.mockReset()
    mocks.useInternalFolderDialogs.mockClear()
    mocks.useNotebookDeleteDialog.mockClear()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('internal delete success: clears deleted selection and anchor references', async () => {
    const setSelectedNoteIdsSpy = vi.fn()
    const setAnchorNoteIdSpy = vi.fn()
    const clearEditorUpdateRuntimeState = vi.fn()
    const options = createOptions({
      setSelectedNoteIds: setSelectedNoteIdsSpy as unknown as UseNotebookManagementOptions['setSelectedNoteIds'],
      setAnchorNoteId: setAnchorNoteIdSpy as unknown as UseNotebookManagementOptions['setAnchorNoteId'],
      clearEditorUpdateRuntimeState,
    })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      writable: true,
      value: {
        notebook: {
          deleteInternalWithNotes: vi.fn(async () => ({
            success: true,
            result: {
              deleted_note_ids: ['note-1', 'note-2'],
              deleted_at: '2026-03-02T00:00:00.000Z',
            },
          })),
        },
        localFolder: {
          unmount: vi.fn(async () => ({ success: true as const })),
        },
        notebookFolder: {
          list: vi.fn(async () => []),
        },
      },
    })

    const { result } = renderHook(() => useNotebookManagement(options))
    const deletedNotebook = options.notebooks.find((item) => item.id === 'nb-1')!
    const ok = await result.current.handleConfirmDeleteNotebook(deletedNotebook)

    expect(ok).toBe(true)
    expect(window.electron.notebook.deleteInternalWithNotes).toHaveBeenCalledWith({
      notebook_id: 'nb-1',
    })
    expect(clearEditorUpdateRuntimeState).toHaveBeenCalledTimes(2)
    expect(clearEditorUpdateRuntimeState).toHaveBeenCalledWith('note-1')
    expect(clearEditorUpdateRuntimeState).toHaveBeenCalledWith('note-2')

    const selectedIdsUpdater = setSelectedNoteIdsSpy.mock.calls.at(-1)?.[0]
    expect(typeof selectedIdsUpdater).toBe('function')
    expect(selectedIdsUpdater(['note-1', 'note-3'])).toEqual(['note-3'])

    const anchorUpdater = setAnchorNoteIdSpy.mock.calls.at(-1)?.[0]
    expect(typeof anchorUpdater).toBe('function')
    expect(anchorUpdater('note-1')).toBeNull()
    expect(anchorUpdater('note-3')).toBe('note-3')
  })

  it('internal delete success on selected notebook: exits to all view and disables typewriter', async () => {
    const options = createOptions({
      selectedNotebookId: 'nb-1',
    })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      writable: true,
      value: {
        notebook: {
          deleteInternalWithNotes: vi.fn(async () => ({
            success: true,
            result: {
              deleted_note_ids: ['note-1', 'note-2'],
              deleted_at: '2026-03-02T00:00:00.000Z',
            },
          })),
        },
        localFolder: {
          unmount: vi.fn(async () => ({ success: true as const })),
        },
        notebookFolder: {
          list: vi.fn(async () => []),
        },
      },
    })

    const { result } = renderHook(() => useNotebookManagement(options))
    const deletedNotebook = options.notebooks.find((item) => item.id === 'nb-1')!
    const ok = await result.current.handleConfirmDeleteNotebook(deletedNotebook)

    expect(ok).toBe(true)
    expect(options.setSelectedNotebookId).toHaveBeenCalledWith(null)
    expect(options.setSelectedSmartView).toHaveBeenCalledWith('all')
    expect(options.setIsTypewriterMode).toHaveBeenCalledWith(false)
    expect(options.setSelectedInternalFolderPath).toHaveBeenCalledWith(null)
  })

  it('local-folder unmount failure: keeps state, returns false, and toasts error', async () => {
    const flushLocalFileSave = vi.fn(async () => undefined)
    const cleanupLocalAutoDraftIfNeeded = vi.fn(async () => undefined)
    const options = createOptions({
      selectedNotebookId: 'nb-local',
      localOpenFileRef: {
        current: { notebookId: 'nb-local', relativePath: 'a.md' },
      },
      localAutoDraftRef: {
        current: { notebookId: 'nb-local', relativePath: 'a.md' },
      },
      flushLocalFileSave,
      cleanupLocalAutoDraftIfNeeded,
    })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      writable: true,
      value: {
        localFolder: {
          unmount: vi.fn(async () => ({ success: false as const, errorCode: 'LOCAL_MOUNT_PATH_UNREACHABLE' as const })),
        },
        notebookFolder: {
          list: vi.fn(async () => []),
        },
      },
    })

    const { result } = renderHook(() => useNotebookManagement(options))
    const localNotebook = options.notebooks.find((item) => item.id === 'nb-local')!
    const ok = await result.current.handleConfirmDeleteNotebook(localNotebook)

    expect(ok).toBe(false)
    expect(flushLocalFileSave).toHaveBeenCalledTimes(1)
    expect(cleanupLocalAutoDraftIfNeeded).toHaveBeenCalledWith(null, { skipFlush: true })
    expect(options.cleanupUnmountedLocalNotebook).not.toHaveBeenCalled()
    expect(options.setSelectedNotebookId).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith('delete-failed', { type: 'error' })
  })

  it('local-folder unmount not-found: returns failure and keeps local state', async () => {
    const options = createOptions({
      selectedNotebookId: 'nb-local',
    })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      writable: true,
      value: {
        localFolder: {
          unmount: vi.fn(async () => ({ success: false as const, errorCode: 'LOCAL_NOTEBOOK_NOT_FOUND' as const })),
        },
        notebookFolder: {
          list: vi.fn(async () => []),
        },
      },
    })

    const { result } = renderHook(() => useNotebookManagement(options))
    const localNotebook = options.notebooks.find((item) => item.id === 'nb-local')!
    const ok = await result.current.handleConfirmDeleteNotebook(localNotebook)

    expect(ok).toBe(false)
    expect(window.electron.localFolder.unmount).toHaveBeenCalledWith('nb-local')
    expect(options.cleanupUnmountedLocalNotebook).not.toHaveBeenCalled()
    expect(options.setNotebooks).not.toHaveBeenCalled()
    expect(options.setNotebookFolders).not.toHaveBeenCalled()
    expect(options.setSelectedNotebookId).not.toHaveBeenCalled()
    expect(options.setSelectedSmartView).not.toHaveBeenCalled()
    expect(options.setIsTypewriterMode).not.toHaveBeenCalled()
    expect(options.setSelectedNoteIds).not.toHaveBeenCalled()
    expect(options.setAnchorNoteId).not.toHaveBeenCalled()
    expect(options.resetLocalEditorState).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith('delete-failed', { type: 'error' })
  })

  it('internal delete failure response: refreshes internal data and keeps notebook state unchanged', async () => {
    const refreshInternalNotebookData = vi.fn(async () => undefined)
    const clearEditorUpdateRuntimeState = vi.fn()
    const options = createOptions({
      refreshInternalNotebookData,
      clearEditorUpdateRuntimeState,
    })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      writable: true,
      value: {
        notebook: {
          deleteInternalWithNotes: vi.fn(async () => ({
            success: false,
            errorCode: 'NOTEBOOK_NOT_FOUND',
          })),
        },
        localFolder: {
          unmount: vi.fn(async () => ({ success: true as const })),
        },
        notebookFolder: {
          list: vi.fn(async () => []),
        },
      },
    })

    const { result } = renderHook(() => useNotebookManagement(options))
    const deletedNotebook = options.notebooks.find((item) => item.id === 'nb-1')!
    const ok = await result.current.handleConfirmDeleteNotebook(deletedNotebook)

    expect(ok).toBe(false)
    expect(window.electron.notebook.deleteInternalWithNotes).toHaveBeenCalledWith({
      notebook_id: 'nb-1',
    })
    expect(clearEditorUpdateRuntimeState).not.toHaveBeenCalled()
    expect(refreshInternalNotebookData).toHaveBeenCalledTimes(1)
    expect(options.setNotebooks).not.toHaveBeenCalled()
    expect(options.setSelectedNotebookId).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith('delete-failed', { type: 'error' })
  })

  it('internal delete exception: refreshes internal data and reports failure', async () => {
    const refreshInternalNotebookData = vi.fn(async () => undefined)
    const options = createOptions({
      refreshInternalNotebookData,
    })
    const deleteError = new Error('delete boom')
    Object.defineProperty(window, 'electron', {
      configurable: true,
      writable: true,
      value: {
        notebook: {
          deleteInternalWithNotes: vi.fn(async () => {
            throw deleteError
          }),
        },
        localFolder: {
          unmount: vi.fn(async () => ({ success: true as const })),
        },
        notebookFolder: {
          list: vi.fn(async () => []),
        },
      },
    })

    const { result } = renderHook(() => useNotebookManagement(options))
    const deletedNotebook = options.notebooks.find((item) => item.id === 'nb-1')!
    const ok = await result.current.handleConfirmDeleteNotebook(deletedNotebook)

    expect(ok).toBe(false)
    expect(window.electron.notebook.deleteInternalWithNotes).toHaveBeenCalledWith({
      notebook_id: 'nb-1',
    })
    expect(refreshInternalNotebookData).toHaveBeenCalledTimes(1)
    expect(options.setNotebooks).not.toHaveBeenCalled()
    expect(options.setSelectedNotebookId).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith('delete-failed', { type: 'error' })
  })
})
