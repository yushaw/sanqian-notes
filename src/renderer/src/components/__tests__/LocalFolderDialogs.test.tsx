/**
 * LocalFolderDialogs delete-flow regression tests
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useLocalFolderDialogs, type LocalFolderDialogsDeps } from '../app/LocalFolderDialogs'

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  analyzeDelete: vi.fn(),
  deleteEntry: vi.fn(),
}))

vi.mock('../../i18n', () => ({
  useTranslations: () => ({
    notebook: {
      createErrorDepthLimit: 'depth-limit',
      createErrorInvalidName: 'invalid-name',
      createErrorGeneric: 'create-failed',
      renameFailed: 'rename-failed',
      deleteFailed: 'delete-failed',
      deleteFileWithLocalFolderWarningTitle: 'delete-file-title',
      deleteFolderWithLocalFolderWarningTitle: 'delete-folder-title',
      deleteWithLocalFolderWarningDesc: 'delete-desc',
      cancel: 'cancel',
      delete: 'delete',
      deleteProcessing: 'deleting',
      createFileTitle: 'create-file',
      createFolderTitle: 'create-folder',
      createHintRoot: 'root-hint',
      createHintInFolder: 'folder-hint',
      save: 'save',
      renameFileTitle: 'rename-file',
      renameFolderTitle: 'rename-folder',
      createNameLabel: 'name',
      createNamePlaceholder: 'name-placeholder',
      renameNameLabel: 'rename-name',
      renameNamePlaceholder: 'rename-name-placeholder',
      createProcessing: 'creating',
      renameProcessing: 'renaming',
    },
  }),
}))

vi.mock('../../utils/toast', () => ({
  toast: mocks.toast,
}))

function createDeps(overrides?: Partial<LocalFolderDialogsDeps>): LocalFolderDialogsDeps {
  const now = '2026-03-01T00:00:00.000Z'
  return {
    selectedNotebookId: 'nb-1',
    notebooks: [{
      id: 'nb-1',
      name: 'Local',
      icon: 'logo:notes',
      source_type: 'local-folder',
      order_index: 0,
      created_at: now,
    }],
    localFolderTree: {
      notebook_id: 'nb-1',
      root_path: '/tmp/local',
      scanned_at: now,
      tree: [],
      files: [{
        id: 'f-1',
        name: 'a',
        file_name: 'a.md',
        relative_path: 'docs/a.md',
        folder_relative_path: 'docs',
        folder_depth: 2,
        extension: 'md',
        size: 10,
        mtime_ms: 1,
        root_path: '/tmp/local',
      }],
    } as any,
    selectedLocalFilePath: 'docs/a.md',
    selectedLocalFolderPath: 'docs',

    resolveLocalCreateParentPath: vi.fn(() => null),
    getDefaultLocalCreateName: vi.fn(() => 'new'),
    resolveLocalFileErrorMessage: vi.fn((code: string) => `error:${code}`),

    openLocalFile: vi.fn(async () => undefined),
    flushLocalFileSave: vi.fn(async () => undefined),
    suppressLocalWatchRefresh: vi.fn(),
    refreshLocalFolderTree: vi.fn(async () => undefined),

    getOpenFileInfo: vi.fn(() => ({
      notebookId: 'nb-1',
      relativePath: 'docs/a.md',
    })),

    onSelectionChange: vi.fn(),
    onMetadataMigrate: vi.fn(),
    onMetadataRemove: vi.fn(),
    onAutoDraftClearIfNeeded: vi.fn(),
    onLocalEditorClear: vi.fn(),

    allViewLocalEditorTarget: null,
    setAllViewLocalEditorTarget: vi.fn(),
    ...overrides,
  }
}

describe('useLocalFolderDialogs delete fallback', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.toast.mockReset()
    mocks.analyzeDelete.mockReset()
    mocks.deleteEntry.mockReset()
    mocks.analyzeDelete.mockResolvedValue({
      success: true,
      result: { affected_mounts: [] },
    })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      writable: true,
      value: {
        localFolder: {
          analyzeDelete: mocks.analyzeDelete,
          deleteEntry: mocks.deleteEntry,
        },
      },
    })
  })

  afterEach(() => {
    cleanup()
    consoleErrorSpy.mockRestore()
    vi.restoreAllMocks()
  })

  it('re-opens current file when delete API returns failure', async () => {
    mocks.deleteEntry.mockResolvedValue({
      success: false,
      errorCode: 'LOCAL_FILE_NOT_FOUND',
    })
    const deps = createDeps()
    const { result } = renderHook(() => useLocalFolderDialogs(deps))

    await act(async () => {
      await result.current.handleRequestDelete({
        kind: 'file',
        relativePath: 'docs/a.md',
      })
    })

    const dialogs = result.current.renderDialogs() as any
    await act(async () => {
      await dialogs.props.onConfirmDelete()
    })

    expect(deps.flushLocalFileSave).toHaveBeenCalledTimes(1)
    expect(deps.onLocalEditorClear).toHaveBeenCalledTimes(1)
    expect(deps.openLocalFile).toHaveBeenCalledWith('docs/a.md')
    expect(deps.refreshLocalFolderTree).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith('error:LOCAL_FILE_NOT_FOUND', { type: 'error' })
  })

  it('re-opens current file when delete API throws', async () => {
    mocks.deleteEntry.mockRejectedValue(new Error('boom'))
    const deps = createDeps()
    const { result } = renderHook(() => useLocalFolderDialogs(deps))

    await act(async () => {
      await result.current.handleRequestDelete({
        kind: 'file',
        relativePath: 'docs/a.md',
      })
    })

    const dialogs = result.current.renderDialogs() as any
    await act(async () => {
      await dialogs.props.onConfirmDelete()
    })

    expect(deps.flushLocalFileSave).toHaveBeenCalledTimes(1)
    expect(deps.onLocalEditorClear).toHaveBeenCalledTimes(1)
    expect(deps.openLocalFile).toHaveBeenCalledWith('docs/a.md')
    expect(mocks.toast).toHaveBeenCalledWith('delete-failed', { type: 'error' })
  })

  it('clears all-view local editor target when deleting the same file', async () => {
    mocks.deleteEntry.mockResolvedValue({
      success: true,
      result: { affected_mounts: [] },
    })
    const deps = createDeps({
      allViewLocalEditorTarget: {
        noteId: 'local:nb-1:docs/a.md',
        notebookId: 'nb-1',
        relativePath: 'docs/a.md',
      },
      setAllViewLocalEditorTarget: vi.fn(),
    })
    const { result } = renderHook(() => useLocalFolderDialogs(deps))

    await act(async () => {
      await result.current.handleRequestDelete({
        kind: 'file',
        relativePath: 'docs/a.md',
      })
    })

    const dialogs = result.current.renderDialogs() as any
    await act(async () => {
      await dialogs.props.onConfirmDelete()
    })

    const setTargetMock = deps.setAllViewLocalEditorTarget as ReturnType<typeof vi.fn>
    expect(setTargetMock).toHaveBeenCalled()
    const updater = setTargetMock.mock.calls.at(-1)?.[0] as
      | ((prev: { noteId: string; notebookId: string; relativePath: string } | null) => { noteId: string; notebookId: string; relativePath: string } | null)
      | undefined
    expect(typeof updater).toBe('function')
    if (!updater) return

    const next = updater({
      noteId: 'local:nb-1:docs/a.md',
      notebookId: 'nb-1',
      relativePath: 'docs/a.md',
    })
    expect(next).toBeNull()
  })

  it('clears all-view local editor target when deleting a containing folder', async () => {
    mocks.deleteEntry.mockResolvedValue({
      success: true,
      result: { affected_mounts: [] },
    })
    const deps = createDeps({
      allViewLocalEditorTarget: {
        noteId: 'local:nb-1:docs/sub/a.md',
        notebookId: 'nb-1',
        relativePath: 'docs/sub/a.md',
      },
      setAllViewLocalEditorTarget: vi.fn(),
    })
    const { result } = renderHook(() => useLocalFolderDialogs(deps))

    await act(async () => {
      await result.current.handleRequestDelete({
        kind: 'folder',
        relativePath: 'docs',
      })
    })

    const dialogs = result.current.renderDialogs() as any
    await act(async () => {
      await dialogs.props.onConfirmDelete()
    })

    const setTargetMock = deps.setAllViewLocalEditorTarget as ReturnType<typeof vi.fn>
    expect(setTargetMock).toHaveBeenCalled()
    const updater = setTargetMock.mock.calls.at(-1)?.[0] as
      | ((prev: { noteId: string; notebookId: string; relativePath: string } | null) => { noteId: string; notebookId: string; relativePath: string } | null)
      | undefined
    expect(typeof updater).toBe('function')
    if (!updater) return

    const next = updater({
      noteId: 'local:nb-1:docs/sub/a.md',
      notebookId: 'nb-1',
      relativePath: 'docs/sub/a.md',
    })
    expect(next).toBeNull()
  })

  it('keeps all-view local editor target when deleting an unrelated file', async () => {
    mocks.deleteEntry.mockResolvedValue({
      success: true,
      result: { affected_mounts: [] },
    })
    const deps = createDeps({
      allViewLocalEditorTarget: {
        noteId: 'local:nb-1:docs/keep.md',
        notebookId: 'nb-1',
        relativePath: 'docs/keep.md',
      },
      setAllViewLocalEditorTarget: vi.fn(),
    })
    const { result } = renderHook(() => useLocalFolderDialogs(deps))

    await act(async () => {
      await result.current.handleRequestDelete({
        kind: 'file',
        relativePath: 'docs/a.md',
      })
    })

    const dialogs = result.current.renderDialogs() as any
    await act(async () => {
      await dialogs.props.onConfirmDelete()
    })

    const previousTarget = {
      noteId: 'local:nb-1:docs/keep.md',
      notebookId: 'nb-1',
      relativePath: 'docs/keep.md',
    }
    const setTargetMock = deps.setAllViewLocalEditorTarget as ReturnType<typeof vi.fn>
    const updater = setTargetMock.mock.calls.at(-1)?.[0] as
      | ((prev: typeof previousTarget | null) => typeof previousTarget | null)
      | undefined
    expect(typeof updater).toBe('function')
    if (!updater) return

    expect(updater(previousTarget)).toEqual(previousTarget)
  })
})
