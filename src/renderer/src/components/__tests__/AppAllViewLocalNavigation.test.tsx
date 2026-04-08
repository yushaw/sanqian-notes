/**
 * App all-view local navigation regression tests
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import App from '../../App'
import { expectDragRegionElement } from './dragRegionContract'

let latestSidebarProps: Record<string, unknown> | null = null
let latestNoteListProps: Record<string, unknown> | null = null

vi.mock('../Sidebar', () => ({
  Sidebar: (props: Record<string, unknown>) => {
    latestSidebarProps = props
    const notebooks = (props.notebooks as Array<{ source_type?: string }> | undefined) || []
    const localNotebook = notebooks.find((notebook) => notebook.source_type === 'local-folder')
    const onDeleteNotebook = props.onDeleteNotebook as ((notebook: unknown) => void) | undefined
    const onAddLocalFolder = props.onAddLocalFolder as (() => void) | undefined
    return (
      <div data-testid="sidebar-stub">
        <button
          data-testid="add-local-folder"
          disabled={Boolean(props.localFolderMountMutationSubmitting)}
          onClick={() => onAddLocalFolder?.()}
        >
          add-local-folder
        </button>
        <button
          data-testid="delete-local-notebook"
          disabled={!localNotebook}
          onClick={() => {
            if (!localNotebook) return
            onDeleteNotebook?.(localNotebook)
          }}
        >
          delete-local-notebook
        </button>
      </div>
    )
  },
}))

vi.mock('../NoteList', () => ({
  NoteList: (props: Record<string, unknown>) => {
    latestNoteListProps = props
    const notes = (props.notes as Array<{ id: string }> | undefined) || []
    const localNote = notes.find((note) => note.id.startsWith('local:'))
    const internalNote = notes.find((note) => !note.id.startsWith('local:'))
    const onSelectNote = props.onSelectNote as ((id: string) => void) | undefined

    return (
      <div data-testid="note-list-stub">
        <button
          data-testid="open-local-from-all"
          disabled={!localNote}
          onClick={() => localNote && onSelectNote?.(localNote.id)}
        >
          open-local
        </button>
        <button
          data-testid="open-internal-from-all"
          disabled={!internalNote}
          onClick={() => internalNote && onSelectNote?.(internalNote.id)}
        >
          open-internal
        </button>
        <div data-testid="local-note-id">{localNote?.id || ''}</div>
      </div>
    )
  },
}))

vi.mock('../LocalFolderNoteList', () => ({
  LocalFolderNoteList: () => <div data-testid="local-folder-note-list-stub" />,
}))

vi.mock('../TrashList', () => ({
  TrashList: () => <div data-testid="trash-list-stub" />,
}))

vi.mock('../DailyView', () => ({
  DailyView: () => <div data-testid="daily-view-stub" />,
}))

vi.mock('../Editor', async () => {
  const React = await import('react')
  return {
    Editor: React.forwardRef(function EditorStub(props: Record<string, unknown>, _ref) {
      const note = (props.note as { id?: string; content?: string } | null | undefined) || null
      const onUpdate = props.onUpdate as ((id: string, updates: { title?: string; content?: string }) => void) | undefined
      return (
        <div>
          <div
            data-testid="editor-stub"
            data-note-id={note?.id || ''}
            data-note-content={note?.content || ''}
          />
          <button
            data-testid="editor-stub-trigger-update"
            onClick={() => {
              if (!note?.id) return
              onUpdate?.(note.id, { content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"ai-updated"}]}]}' })
            }}
          >
            trigger-update
          </button>
        </div>
      )
    }),
  }
})

vi.mock('../ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: ReactNode }) => <>{children}</>,
  EditorErrorBoundary: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('../Settings', () => ({
  Settings: () => <div data-testid="settings-stub" />,
}))

vi.mock('../NotebookModal', () => ({
  NotebookModal: () => <div data-testid="notebook-modal-stub" />,
}))

vi.mock('../TypewriterMode', () => ({
  TypewriterMode: () => <div data-testid="typewriter-stub" />,
}))

vi.mock('../AIChatDialog', () => ({
  AIChatDialog: () => null,
  openChatWithContext: vi.fn(),
}))

vi.mock('../TabBar', () => ({
  TabBar: () => <div data-testid="tabbar-stub" />,
}))

vi.mock('../PaneLayout', () => ({
  PaneLayout: ({ renderEmpty }: { renderEmpty?: () => ReactNode }) => (
    <div data-testid="panelayout-stub">{renderEmpty?.()}</div>
  ),
}))

vi.mock('../ResizableImageView', () => ({
  IMAGE_LIGHTBOX_EVENT: 'image-lightbox-open',
}))

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function createElectronMock() {
  const now = '2026-02-26T00:00:00.000Z'
  const internalNotebook = {
    id: 'nb-1',
    name: 'Internal',
    icon: 'logo:notes',
    source_type: 'internal' as const,
    created_at: now,
    updated_at: now,
  }
  const localNotebook = {
    id: 'local-1',
    name: 'Local Notebook',
    icon: 'logo:notes',
    source_type: 'local-folder' as const,
    created_at: now,
    updated_at: now,
  }

  const localTree = {
    notebook_id: 'local-1',
    root_path: '/tmp/local-notebook',
    scanned_at: now,
    tree: [],
    files: [
      {
        id: 'local-file-1',
        name: 'First Local Note',
        file_name: 'first.md',
        relative_path: 'first.md',
        folder_relative_path: '',
        folder_depth: 0,
        extension: 'md' as const,
        size: 10,
        mtime_ms: 1,
        root_path: '/tmp/local-notebook',
      },
    ],
  }

  let localFileText = 'hello'
  let onDataChangedHandler: (() => void | Promise<void>) | null = null
  let onLocalFolderChangedHandler: ((event: {
    notebook_id: string
    status: 'active' | 'missing' | 'permission_required'
    reason?: 'status_changed' | 'content_changed' | 'rescan_required'
    sequence?: number
    changed_relative_path?: string | null
  }) => void | Promise<void>) | null = null

  const getTree = vi.fn(async () => ({ success: true as const, result: localTree }))

  const internalNote = {
    id: 'n-1',
    notebook_id: 'nb-1',
    title: 'Internal Note',
    content: '{"type":"doc","content":[]}',
    folder_path: null,
    is_daily: false,
    daily_date: null,
    is_favorite: false,
    is_pinned: false,
    revision: 1,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    ai_summary: null,
    tags: [],
  }

  const allSourceLocalNote = {
    id: 'local:local-1:first.md',
    notebook_id: 'local-1',
    title: 'First Local Note',
    content: '{"type":"doc","content":[]}',
    folder_path: null,
    is_daily: false,
    daily_date: null,
    is_favorite: false,
    is_pinned: false,
    revision: 0,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    ai_summary: 'Local Notebook · first.md',
    tags: [],
  }

  const readFile = vi.fn(async () => ({
    success: true as const,
    result: {
      id: 'local-file-1',
      notebook_id: 'local-1',
      name: 'First Local Note',
      file_name: 'first.md',
      relative_path: 'first.md',
      extension: 'md' as const,
      size: 12,
      mtime_ms: 2,
      tiptap_content: `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"${localFileText}"}]}]}`,
    },
  }))

  const unsubscribe = () => {}

  return {
    getTree,
    readFile,
    electron: {
      theme: {
        sync: vi.fn(),
        get: vi.fn(async () => 'light'),
        onChange: vi.fn(),
      },
      window: {
        setTitleBarOverlay: vi.fn(),
        close: vi.fn(),
      },
      appSettings: {
        get: vi.fn(async () => null),
        set: vi.fn(async () => true),
      },
      context: {
        sync: vi.fn(),
      },
      chatWindow: {
        toggle: vi.fn(),
        show: vi.fn(),
        showWithContext: vi.fn(),
      },
      popup: {
        onContinueInChat: vi.fn(() => unsubscribe),
      },
      note: {
        getAll: vi.fn(async (options?: { includeLocal?: boolean }) => (
          options?.includeLocal ? [internalNote, allSourceLocalNote] : [internalNote]
        )),
        getById: vi.fn(async () => null),
        getByIds: vi.fn(async () => []),
        add: vi.fn(async () => null),
        updateSafe: vi.fn(async () => ({ status: 'updated', note: null })),
        update: vi.fn(async () => null),
        delete: vi.fn(async () => true),
        search: vi.fn(async () => []),
        createDemo: vi.fn(async () => null),
        checkIndex: vi.fn(async () => true),
        onDataChanged: vi.fn((callback: () => void | Promise<void>) => {
          onDataChangedHandler = callback
          return unsubscribe
        }),
        onSummaryUpdated: vi.fn(() => unsubscribe),
        onNavigate: vi.fn(() => unsubscribe),
      },
      notebook: {
        getAll: vi.fn(async () => [internalNotebook, localNotebook]),
        add: vi.fn(async () => internalNotebook),
        update: vi.fn(async () => internalNotebook),
        delete: vi.fn(async () => true),
        reorder: vi.fn(async () => true),
      },
      notebookFolder: {
        list: vi.fn(async () => []),
        create: vi.fn(async () => ({ success: true, result: { id: 'f1', notebook_id: 'nb-1', folder_path: 'a', created_at: now, updated_at: now } })),
        rename: vi.fn(async () => ({ success: true, result: { id: 'f1', notebook_id: 'nb-1', folder_path: 'a', created_at: now, updated_at: now } })),
        delete: vi.fn(async () => ({ success: true, result: { deleted_note_ids: [] } })),
      },
      trash: {
        getAll: vi.fn(async () => []),
        cleanup: vi.fn(async () => undefined),
        restore: vi.fn(async () => true),
        permanentDelete: vi.fn(async () => true),
        empty: vi.fn(async () => 0),
      },
      daily: {
        create: vi.fn(async () => null),
      },
      localFolder: {
        list: vi.fn(async () => ({
          success: true as const,
          result: {
            mounts: [{
              notebook: localNotebook,
              mount: {
                notebook_id: 'local-1',
                root_path: '/tmp/local-notebook',
                canonical_root_path: '/tmp/local-notebook',
                status: 'active' as const,
                created_at: now,
                updated_at: now,
              },
            }],
          },
        })),
        getTree,
        search: vi.fn(async () => ({ success: true, result: { hits: [] } })),
        listNoteMetadata: vi.fn(async () => ({ success: true, result: { items: [] } })),
        updateNoteMetadata: vi.fn(async () => ({ success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' })),
        onChanged: vi.fn((callback: (event: {
          notebook_id: string
          status: 'active' | 'missing' | 'permission_required'
          reason?: 'status_changed' | 'content_changed' | 'rescan_required'
          sequence?: number
          changed_relative_path?: string | null
        }) => void | Promise<void>) => {
          onLocalFolderChangedHandler = callback
          return unsubscribe
        }),
        readFile,
        saveFile: vi.fn(async () => ({ success: true, result: { size: 12, mtime_ms: 2 } })),
        createFile: vi.fn(async () => ({ success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' })),
        createFolder: vi.fn(async () => ({ success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' })),
        renameEntry: vi.fn(async () => ({ success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' })),
        analyzeDelete: vi.fn(async () => ({ success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' })),
        deleteEntry: vi.fn(async () => ({ success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' })),
        selectRoot: vi.fn<() => Promise<{ success: boolean; root_path?: string; errorCode?: string }>>(async () => ({
          success: false,
          errorCode: 'LOCAL_MOUNT_DIALOG_CANCELED',
        })),
        mount: vi.fn(async () => ({ success: false, errorCode: 'LOCAL_MOUNT_INVALID_PATH' })),
        relink: vi.fn(async () => ({ success: false, errorCode: 'LOCAL_MOUNT_INVALID_PATH' })),
        openInFileManager: vi.fn<() => Promise<{ success: boolean; errorCode?: string }>>(async () => ({
          success: false,
          errorCode: 'LOCAL_NOTEBOOK_NOT_FOUND',
        })),
        unmount: vi.fn<() => Promise<{ success: boolean; errorCode?: string }>>(async () => ({ success: true })),
      },
    },
    setLocalFileText: (text: string) => {
      localFileText = text
    },
    setLocalTreeFiles: (files: typeof localTree.files) => {
      localTree.files = files
    },
    triggerDataChanged: async () => {
      if (onDataChangedHandler) {
        await onDataChangedHandler()
      }
    },
    triggerLocalFolderChanged: async (
      input: (
        | 'active'
        | 'missing'
        | 'permission_required'
        | {
          status?: 'active' | 'missing' | 'permission_required'
          reason?: 'status_changed' | 'content_changed' | 'rescan_required'
          sequence?: number
          changed_relative_path?: string | null
        }
      ) = 'active'
    ) => {
      const payload = typeof input === 'string' ? { status: input } : input
      if (onLocalFolderChangedHandler) {
        await onLocalFolderChangedHandler({
          notebook_id: 'local-1',
          status: payload.status || 'active',
          reason: payload.reason,
          sequence: payload.sequence,
          changed_relative_path: payload.changed_relative_path ?? null,
        })
      }
    },
  }
}

describe('App all-view local navigation', () => {
  beforeEach(() => {
    latestSidebarProps = null
    latestNoteListProps = null
    localStorage.clear()
    localStorage.setItem('sanqian-notes-last-view', 'all')
    localStorage.setItem('sanqian-notes-last-note', 'n-1')
    localStorage.removeItem('sanqian-notes-last-notebook')

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        media: '(prefers-color-scheme: dark)',
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('opens local file from all view without switching selected notebook', async () => {
    const { electron, readFile, getTree } = createElectronMock()
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: electron,
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByTestId('add-local-folder')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('open-local-from-all'))

    await waitFor(() => {
      expect(readFile).toHaveBeenCalledWith({
        notebook_id: 'local-1',
        relative_path: 'first.md',
      })
    })
    expect(getTree).toHaveBeenCalledTimes(1)

    expect(latestSidebarProps?.selectedNotebookId).toBeNull()
    expect(latestSidebarProps?.selectedSmartView === 'all' || latestSidebarProps?.selectedSmartView === null).toBe(true)
    expect(latestNoteListProps?.selectedNoteIds).toEqual(['local:local-1:first.md'])

    await waitFor(() => {
      expect(screen.getByTestId('editor-stub')).toHaveAttribute('data-note-id', 'local:local-1:first.md')
    })
  })

  it('refreshes opened local editor content when SDK data change updates local file', async () => {
    const { electron, setLocalFileText, triggerDataChanged } = createElectronMock()
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: electron,
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByTestId('add-local-folder')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('open-local-from-all'))

    await waitFor(() => {
      expect(screen.getByTestId('editor-stub')).toHaveAttribute('data-note-content', expect.stringContaining('hello'))
    })

    setLocalFileText('world')
    await act(async () => {
      await triggerDataChanged()
    })

    await waitFor(() => {
      expect(screen.getByTestId('editor-stub')).toHaveAttribute('data-note-content', expect.stringContaining('world'))
    })
  })

  it('refreshes opened local editor content when local watcher reports active change', async () => {
    const { electron, setLocalFileText, triggerLocalFolderChanged } = createElectronMock()
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: electron,
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByTestId('add-local-folder')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('open-local-from-all'))

    await waitFor(() => {
      expect(screen.getByTestId('editor-stub')).toHaveAttribute('data-note-content', expect.stringContaining('hello'))
    })

    setLocalFileText('watcher')
    await act(async () => {
      await triggerLocalFolderChanged({
        status: 'active',
        reason: 'content_changed',
        changed_relative_path: 'first.md',
        sequence: 1,
      })
      await new Promise((resolve) => setTimeout(resolve, 220))
    })

    await waitFor(() => {
      expect(screen.getByTestId('editor-stub')).toHaveAttribute('data-note-content', expect.stringContaining('watcher'))
    })
  })

  it('skips local editor refresh when watcher change path does not target opened file', async () => {
    const { electron, readFile, setLocalFileText, triggerLocalFolderChanged } = createElectronMock()
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: electron,
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByTestId('add-local-folder')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('open-local-from-all'))

    await waitFor(() => {
      expect(screen.getByTestId('editor-stub')).toHaveAttribute('data-note-content', expect.stringContaining('hello'))
    })

    const readCountAfterOpen = readFile.mock.calls.length
    setLocalFileText('should-not-refresh')
    await act(async () => {
      await triggerLocalFolderChanged({
        status: 'active',
        reason: 'content_changed',
        changed_relative_path: 'other.md',
        sequence: 2,
      })
      await new Promise((resolve) => setTimeout(resolve, 220))
    })

    expect(readFile).toHaveBeenCalledTimes(readCountAfterOpen)
    expect(screen.getByTestId('editor-stub')).toHaveAttribute('data-note-content', expect.stringContaining('hello'))
  })

  it('ignores stale watcher sequence for opened local editor refresh', async () => {
    const { electron, setLocalFileText, triggerLocalFolderChanged } = createElectronMock()
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: electron,
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByTestId('add-local-folder')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('open-local-from-all'))

    await waitFor(() => {
      expect(screen.getByTestId('editor-stub')).toHaveAttribute('data-note-content', expect.stringContaining('hello'))
    })

    setLocalFileText('newer')
    await act(async () => {
      await triggerLocalFolderChanged({
        status: 'active',
        reason: 'content_changed',
        changed_relative_path: 'first.md',
        sequence: 10,
      })
      await new Promise((resolve) => setTimeout(resolve, 220))
    })
    await waitFor(() => {
      expect(screen.getByTestId('editor-stub')).toHaveAttribute('data-note-content', expect.stringContaining('newer'))
    })

    setLocalFileText('stale-should-be-ignored')
    await act(async () => {
      await triggerLocalFolderChanged({
        status: 'active',
        reason: 'content_changed',
        changed_relative_path: 'first.md',
        sequence: 9,
      })
      await new Promise((resolve) => setTimeout(resolve, 220))
    })

    expect(screen.getByTestId('editor-stub')).toHaveAttribute('data-note-content', expect.stringContaining('newer'))
  })

  it('refreshes opened local editor when watcher reports status_changed active', async () => {
    const { electron, setLocalFileText, triggerLocalFolderChanged } = createElectronMock()
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: electron,
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByTestId('add-local-folder')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('open-local-from-all'))

    await waitFor(() => {
      expect(screen.getByTestId('editor-stub')).toHaveAttribute('data-note-content', expect.stringContaining('hello'))
    })

    setLocalFileText('relinked')
    await act(async () => {
      await triggerLocalFolderChanged({
        status: 'active',
        reason: 'status_changed',
        sequence: 20,
        changed_relative_path: null,
      })
      await new Promise((resolve) => setTimeout(resolve, 220))
    })

    await waitFor(() => {
      expect(screen.getByTestId('editor-stub')).toHaveAttribute('data-note-content', expect.stringContaining('relinked'))
    })
  })

  it('ignores in-flight local file read after mount becomes unavailable', async () => {
    const pendingRead = createDeferred<{
      success: true
      result: {
        id: string
        notebook_id: string
        name: string
        file_name: string
        relative_path: string
        extension: 'md'
        size: number
        mtime_ms: number
        tiptap_content: string
      }
    }>()
    const { electron, triggerLocalFolderChanged } = createElectronMock()
    electron.localFolder.readFile = vi
      .fn(async () => pendingRead.promise) as typeof electron.localFolder.readFile

    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: electron,
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByTestId('open-local-from-all')).toBeEnabled()
    })

    fireEvent.click(screen.getByTestId('open-local-from-all'))

    await waitFor(() => {
      expect(electron.localFolder.readFile).toHaveBeenCalledWith({
        notebook_id: 'local-1',
        relative_path: 'first.md',
      })
    })

    await act(async () => {
      await triggerLocalFolderChanged({
        status: 'missing',
        reason: 'status_changed',
        sequence: 30,
      })
    })

    await waitFor(() => {
      expect(screen.queryByTestId('editor-stub')).toBeNull()
    })

    await act(async () => {
      pendingRead.resolve({
        success: true,
        result: {
          id: 'local-file-1',
          notebook_id: 'local-1',
          name: 'First Local Note',
          file_name: 'first.md',
          relative_path: 'first.md',
          extension: 'md',
          size: 12,
          mtime_ms: 2,
          tiptap_content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"late-data"}]}]}',
        },
      })
      await Promise.resolve()
    })

    expect(screen.queryByTestId('editor-stub')).toBeNull()
  })

  it('serializes recover-local-folder flow and disables recover button while in progress', async () => {
    const now = '2026-02-26T00:00:00.000Z'
    const { electron, triggerLocalFolderChanged } = createElectronMock()
    const selectRootDeferred = createDeferred<{ success: true; root_path: string }>()
    electron.localFolder.getTree = vi.fn(async () => ({
      success: false as const,
      errorCode: 'LOCAL_MOUNT_UNAVAILABLE' as const,
      mount_status: 'missing' as const,
    })) as any
    electron.localFolder.selectRoot = vi.fn(() => selectRootDeferred.promise) as any
    electron.localFolder.relink = vi.fn(async () => ({
      success: true as const,
      result: {
        notebook_id: 'local-1',
        root_path: '/tmp/local-notebook',
        canonical_root_path: '/tmp/local-notebook',
        status: 'active' as const,
        created_at: now,
        updated_at: now,
      },
    })) as any

    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: electron,
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByTestId('add-local-folder')).toBeInTheDocument()
    })

    await act(async () => {
      const onSelectNotebook = latestSidebarProps?.onSelectNotebook as ((id: string) => void) | undefined
      onSelectNotebook?.('local-1')
    })
    await waitFor(() => {
      expect(screen.getByTestId('local-folder-note-list-stub')).toBeInTheDocument()
    })

    await act(async () => {
      await triggerLocalFolderChanged({
        status: 'missing',
        reason: 'status_changed',
        sequence: 32,
      })
    })

    const recoverButton = await screen.findByTestId('local-folder-recover-button')
    fireEvent.click(recoverButton)
    fireEvent.click(recoverButton)

    await waitFor(() => {
      expect(electron.localFolder.selectRoot).toHaveBeenCalledTimes(1)
    })
    expect(recoverButton).toBeDisabled()
    expect(electron.localFolder.relink).not.toHaveBeenCalled()

    await act(async () => {
      selectRootDeferred.resolve({ success: true, root_path: '/tmp/local-notebook' })
      await selectRootDeferred.promise
    })

    await waitFor(() => {
      expect(electron.localFolder.relink).toHaveBeenCalledTimes(1)
    })
    expect(electron.localFolder.relink).toHaveBeenCalledWith({
      notebook_id: 'local-1',
      root_path: '/tmp/local-notebook',
    })
  })

  it('auto-relinks existing missing mount when recover hits canonical duplicate', async () => {
    const now = '2026-02-26T00:00:00.000Z'
    const { electron, triggerLocalFolderChanged } = createElectronMock()
    const secondaryLocalNotebook = {
      id: 'local-2',
      name: 'Local Notebook 2',
      icon: 'logo:notes',
      source_type: 'local-folder' as const,
      created_at: now,
      updated_at: now,
    }

    electron.notebook.getAll = vi.fn(async () => ([
      {
        id: 'nb-1',
        name: 'Internal',
        icon: 'logo:notes',
        source_type: 'internal' as const,
        created_at: now,
        updated_at: now,
      },
      {
        id: 'local-1',
        name: 'Local Notebook',
        icon: 'logo:notes',
        source_type: 'local-folder' as const,
        created_at: now,
        updated_at: now,
      },
      secondaryLocalNotebook,
    ])) as any

    electron.localFolder.list = vi.fn(async () => ({
      success: true as const,
      result: {
        mounts: [
          {
            notebook: {
              id: 'local-1',
              name: 'Local Notebook',
              icon: 'logo:notes',
              source_type: 'local-folder' as const,
              created_at: now,
              updated_at: now,
            },
            mount: {
              notebook_id: 'local-1',
              root_path: '/tmp/local-notebook',
              canonical_root_path: '/tmp/local-notebook',
              status: 'missing' as const,
              created_at: now,
              updated_at: now,
            },
          },
          {
            notebook: secondaryLocalNotebook,
            mount: {
              notebook_id: 'local-2',
              root_path: '/tmp/local-notebook',
              canonical_root_path: '/tmp/local-notebook',
              status: 'missing' as const,
              created_at: now,
              updated_at: now,
            },
          },
        ],
      },
    })) as any

    electron.localFolder.getTree = vi.fn(async (notebookId: string) => {
      if (notebookId === 'local-2') {
        return {
          success: true as const,
          result: {
            notebook_id: 'local-2',
            root_path: '/tmp/local-notebook',
            scanned_at: now,
            tree: [],
            files: [],
          },
        }
      }
      return {
        success: false as const,
        errorCode: 'LOCAL_MOUNT_UNAVAILABLE' as const,
        mount_status: 'missing' as const,
      }
    }) as any

    electron.localFolder.selectRoot = vi.fn(async () => ({
      success: true as const,
      root_path: '/tmp/local-notebook',
    })) as any
    electron.localFolder.relink = vi.fn(async (input: { notebook_id: string; root_path: string }) => {
      if (input.notebook_id === 'local-1') {
        return {
          success: false as const,
          errorCode: 'LOCAL_MOUNT_ALREADY_EXISTS' as const,
          existing_mount: {
            notebook_id: 'local-2',
            status: 'missing' as const,
          },
        }
      }
      return {
        success: true as const,
        result: {
          notebook_id: 'local-2',
          root_path: '/tmp/local-notebook',
          canonical_root_path: '/tmp/local-notebook',
          status: 'active' as const,
          created_at: now,
          updated_at: now,
        },
      }
    }) as any

    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: electron,
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByTestId('add-local-folder')).toBeInTheDocument()
    })

    await act(async () => {
      const onSelectNotebook = latestSidebarProps?.onSelectNotebook as ((id: string) => void) | undefined
      onSelectNotebook?.('local-1')
    })
    await waitFor(() => {
      expect(screen.getByTestId('local-folder-note-list-stub')).toBeInTheDocument()
    })

    await act(async () => {
      await triggerLocalFolderChanged({
        status: 'missing',
        reason: 'status_changed',
        sequence: 44,
      })
    })

    const recoverButton = await screen.findByTestId('local-folder-recover-button')
    fireEvent.click(recoverButton)

    await waitFor(() => {
      expect(electron.localFolder.relink).toHaveBeenCalledTimes(2)
    })
    expect(electron.localFolder.relink).toHaveBeenNthCalledWith(1, {
      notebook_id: 'local-1',
      root_path: '/tmp/local-notebook',
    })
    expect(electron.localFolder.relink).toHaveBeenNthCalledWith(2, {
      notebook_id: 'local-2',
      root_path: '/tmp/local-notebook',
    })
    expect(latestSidebarProps?.selectedNotebookId).toBe('local-2')
  })

  it('renders local editor shell as full-height flex column', async () => {
    const { electron } = createElectronMock()
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: electron,
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByTestId('open-local-from-all')).toBeEnabled()
    })

    fireEvent.click(screen.getByTestId('open-local-from-all'))

    const shell = await screen.findByTestId('local-editor-shell')
    expect(shell).toHaveClass('flex')
    expect(shell).toHaveClass('flex-col')
    expect(shell).toHaveClass('flex-1')
    expect(shell).toHaveClass('min-h-0')
  })

  it('renders draggable header while app is in initial loading state', async () => {
    const { electron } = createElectronMock()
    const notesDeferred = createDeferred<Awaited<ReturnType<typeof electron.note.getAll>>>()
    electron.note.getAll = vi.fn(() => notesDeferred.promise) as typeof electron.note.getAll
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: electron,
    })

    render(<App />)

    const dragRegion = await screen.findByTestId('app-loading-drag-region')
    expectDragRegionElement(dragRegion)

    await act(async () => {
      notesDeferred.resolve([
        {
          id: 'n-1',
          notebook_id: 'nb-1',
          title: 'Internal Note',
          content: '{"type":"doc","content":[]}',
          folder_path: null,
          is_daily: false,
          daily_date: null,
          is_favorite: false,
          is_pinned: false,
          revision: 1,
          created_at: '2026-02-26T00:00:00.000Z',
          updated_at: '2026-02-26T00:00:00.000Z',
          deleted_at: null,
          ai_summary: null,
          tags: [],
        },
      ])
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByTestId('add-local-folder')).toBeInTheDocument()
    })
  })

  it('renders draggable header when local editor shows empty placeholder', async () => {
    const { electron } = createElectronMock()
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: electron,
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByTestId('add-local-folder')).toBeInTheDocument()
    })

    await act(async () => {
      const onSelectNotebook = latestSidebarProps?.onSelectNotebook as ((id: string) => void) | undefined
      onSelectNotebook?.('local-1')
    })

    await waitFor(() => {
      expect(screen.getByTestId('local-folder-note-list-stub')).toBeInTheDocument()
    })

    expect(screen.queryByTestId('editor-stub')).toBeNull()
    const dragRegion = await screen.findByTestId('local-editor-empty-drag-region')
    expectDragRegionElement(dragRegion)
  })

  it('renders draggable header when trash view editor area is empty', async () => {
    const { electron } = createElectronMock()
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: electron,
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByTestId('add-local-folder')).toBeInTheDocument()
    })

    await act(async () => {
      const onSelectSmartView = latestSidebarProps?.onSelectSmartView as ((id: string) => void) | undefined
      onSelectSmartView?.('trash')
    })

    await waitFor(() => {
      expect(screen.getByTestId('trash-list-stub')).toBeInTheDocument()
    })

    const dragRegion = await screen.findByTestId('trash-empty-drag-region')
    expectDragRegionElement(dragRegion)
  })

  it('persists local editor updates to localFolder.saveFile', async () => {
    const { electron } = createElectronMock()
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: electron,
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByTestId('open-local-from-all')).toBeEnabled()
    })

    fireEvent.click(screen.getByTestId('open-local-from-all'))

    await waitFor(() => {
      expect(screen.getByTestId('editor-stub')).toHaveAttribute('data-note-content', expect.stringContaining('hello'))
    })

    vi.useFakeTimers()
    try {
      fireEvent.click(screen.getByTestId('editor-stub-trigger-update'))

      await act(async () => {
        vi.advanceTimersByTime(1200)
        await Promise.resolve()
      })

      expect(electron.localFolder.saveFile).toHaveBeenCalledWith(expect.objectContaining({
        notebook_id: 'local-1',
        relative_path: 'first.md',
        tiptap_content: expect.stringContaining('ai-updated'),
      }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps pending local save for explicit retry after transient write failure', async () => {
    const { electron } = createElectronMock()
    const saveFile = vi.fn()
      .mockResolvedValueOnce({ success: false as const, errorCode: 'LOCAL_FILE_WRITE_FAILED' as const })
      .mockResolvedValueOnce({ success: true as const, result: { size: 13, mtime_ms: 3 } })
    electron.localFolder.saveFile = saveFile as unknown as typeof electron.localFolder.saveFile

    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: electron,
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByTestId('open-local-from-all')).toBeEnabled()
    })

    fireEvent.click(screen.getByTestId('open-local-from-all'))

    await waitFor(() => {
      expect(screen.getByTestId('editor-stub')).toHaveAttribute('data-note-content', expect.stringContaining('hello'))
    })

    vi.useFakeTimers()
    fireEvent.click(screen.getByTestId('editor-stub-trigger-update'))

    await act(async () => {
      vi.advanceTimersByTime(1200)
      await Promise.resolve()
    })

    expect(saveFile).toHaveBeenCalledTimes(1)

    vi.useRealTimers()
    fireEvent.click(screen.getByTestId('open-internal-from-all'))

    await waitFor(() => {
      expect(saveFile).toHaveBeenCalledTimes(2)
    })
    expect(saveFile).toHaveBeenNthCalledWith(2, expect.objectContaining({
      notebook_id: 'local-1',
      relative_path: 'first.md',
      tiptap_content: expect.stringContaining('ai-updated'),
    }))
  })

  it('cancels pending local save when mount becomes unavailable', async () => {
    const { electron, triggerLocalFolderChanged } = createElectronMock()
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: electron,
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByTestId('open-local-from-all')).toBeEnabled()
    })

    fireEvent.click(screen.getByTestId('open-local-from-all'))

    await waitFor(() => {
      expect(screen.getByTestId('editor-stub')).toHaveAttribute('data-note-content', expect.stringContaining('hello'))
    })

    vi.useFakeTimers()
    try {
      fireEvent.click(screen.getByTestId('editor-stub-trigger-update'))

      await act(async () => {
        await triggerLocalFolderChanged({
          status: 'missing',
          reason: 'status_changed',
          sequence: 31,
        })
      })

      expect(screen.queryByTestId('editor-stub')).toBeNull()

      await act(async () => {
        vi.advanceTimersByTime(1500)
        await Promise.resolve()
      })

      expect(electron.localFolder.saveFile).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('restores saved all-view local note on startup without clearing selection', async () => {
    const { electron, readFile } = createElectronMock()
    localStorage.setItem('sanqian-notes-last-note', 'local:local-1:first.md')
    localStorage.setItem('sanqian_notes_tabs_v2', JSON.stringify([
      {
        id: 'tab-1',
        layout: 'pane-1',
        panes: { 'pane-1': { noteId: 'n-1' } },
        focusedPaneId: 'pane-1',
        createdAt: 1,
      },
    ]))
    localStorage.setItem('sanqian_notes_active_tab', 'tab-1')

    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: electron,
    })

    render(<App />)

    await waitFor(() => {
      expect(readFile).toHaveBeenCalledWith({
        notebook_id: 'local-1',
        relative_path: 'first.md',
      })
    })

    await waitFor(() => {
      expect(localStorage.getItem('sanqian-notes-last-note')).toBe('local:local-1:first.md')
    })
    expect(latestSidebarProps?.selectedNotebookId).toBeNull()
    expect(latestSidebarProps?.selectedSmartView === 'all' || latestSidebarProps?.selectedSmartView === null).toBe(true)
    expect(latestNoteListProps?.selectedNoteIds).toEqual(['local:local-1:first.md'])

    await waitFor(() => {
      expect(screen.getByTestId('editor-stub')).toHaveAttribute('data-note-id', 'local:local-1:first.md')
    })
  })

  it('normalizes saved all-view local note path alias on startup', async () => {
    const { electron, readFile } = createElectronMock()
    localStorage.setItem('sanqian-notes-last-note', 'local:local-1:.%2Ffirst.md')
    localStorage.setItem('sanqian_notes_tabs_v2', JSON.stringify([
      {
        id: 'tab-1',
        layout: 'pane-1',
        panes: { 'pane-1': { noteId: 'n-1' } },
        focusedPaneId: 'pane-1',
        createdAt: 1,
      },
    ]))
    localStorage.setItem('sanqian_notes_active_tab', 'tab-1')

    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: electron,
    })

    render(<App />)

    await waitFor(() => {
      expect(readFile).toHaveBeenCalledWith({
        notebook_id: 'local-1',
        relative_path: 'first.md',
      })
    })

    await waitFor(() => {
      expect(localStorage.getItem('sanqian-notes-last-note')).toBe('local:local-1:first.md')
    })
    expect(latestNoteListProps?.selectedNoteIds).toEqual(['local:local-1:first.md'])

    await waitFor(() => {
      expect(screen.getByTestId('editor-stub')).toHaveAttribute('data-note-id', 'local:local-1:first.md')
    })
  })

  it('clears all-view local editor after unmounting local notebook', async () => {
    const { electron } = createElectronMock()
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: electron,
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByTestId('open-local-from-all')).toBeEnabled()
    })

    fireEvent.click(screen.getByTestId('open-local-from-all'))

    await waitFor(() => {
      expect(screen.getByTestId('editor-stub')).toHaveAttribute('data-note-id', 'local:local-1:first.md')
    })

    fireEvent.click(screen.getByTestId('delete-local-notebook'))

    const dialog = await screen.findByRole('dialog')
    const buttons = within(dialog).getAllByRole('button')
    fireEvent.click(buttons[buttons.length - 1])

    await waitFor(() => {
      expect(electron.localFolder.unmount).toHaveBeenCalledWith('local-1')
    })
    await waitFor(() => {
      expect(screen.getByTestId('local-note-id').textContent).toBe('')
    })
    await waitFor(() => {
      expect(screen.queryByTestId('editor-stub')).toBeNull()
    })
  })

  it('clears all-view local editor target when opened file disappears from refreshed tree', async () => {
    const { electron, setLocalTreeFiles, triggerLocalFolderChanged } = createElectronMock()
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: electron,
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByTestId('open-local-from-all')).toBeEnabled()
    })

    fireEvent.click(screen.getByTestId('open-local-from-all'))

    await waitFor(() => {
      expect(screen.getByTestId('editor-stub')).toHaveAttribute('data-note-id', 'local:local-1:first.md')
    })

    setLocalTreeFiles([])
    await act(async () => {
      await triggerLocalFolderChanged({
        status: 'active',
        reason: 'content_changed',
        changed_relative_path: 'first.md',
        sequence: 41,
      })
      await new Promise((resolve) => setTimeout(resolve, 220))
    })

    await waitFor(() => {
      expect(screen.getByTestId('tabbar-stub')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('local-editor-shell')).toBeNull()
  })

  it('keeps unmount confirmation open when local notebook unmount fails', async () => {
    const { electron } = createElectronMock()
    electron.localFolder.unmount = vi.fn(async () => ({
      success: false as const,
      errorCode: 'LOCAL_MOUNT_PATH_UNREACHABLE' as const,
    }))
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: electron,
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByTestId('open-local-from-all')).toBeEnabled()
    })

    fireEvent.click(screen.getByTestId('open-local-from-all'))
    await waitFor(() => {
      expect(screen.getByTestId('editor-stub')).toHaveAttribute('data-note-id', 'local:local-1:first.md')
    })

    fireEvent.click(screen.getByTestId('delete-local-notebook'))
    const dialog = await screen.findByRole('dialog')
    const buttons = within(dialog).getAllByRole('button')
    fireEvent.click(buttons[buttons.length - 1])

    await waitFor(() => {
      expect(electron.localFolder.unmount).toHaveBeenCalledWith('local-1')
    })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByTestId('local-note-id').textContent).toBe('local:local-1:first.md')
    expect(screen.getByTestId('editor-stub')).toHaveAttribute('data-note-id', 'local:local-1:first.md')
  })

  it('keeps UI convergent when mount succeeds but notebook refresh fails', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { electron } = createElectronMock()
    const now = '2026-02-26T00:00:00.000Z'
    const mountedNotebook = {
      id: 'local-2',
      name: 'New Local',
      icon: 'logo:notes',
      source_type: 'local-folder' as const,
      created_at: now,
      updated_at: now,
    }

    let getAllCallCount = 0
    const baselineNotebooks = await electron.notebook.getAll()
    electron.notebook.getAll = vi.fn(async () => {
      getAllCallCount += 1
      if (getAllCallCount === 1) return baselineNotebooks
      throw new Error('refresh failed')
    })
    electron.localFolder.selectRoot = vi.fn(async () => ({
      success: true as const,
      root_path: '/tmp/new-local',
    })) as any
    electron.localFolder.mount = vi.fn(async () => ({
      success: true,
      result: {
        notebook: mountedNotebook,
        mount: {
          notebook_id: 'local-2',
          root_path: '/tmp/new-local',
          canonical_root_path: '/tmp/new-local',
          status: 'active' as const,
          created_at: now,
          updated_at: now,
        },
      },
    })) as any

    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: electron,
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByTestId('open-local-from-all')).toBeEnabled()
    })

    fireEvent.click(screen.getByTestId('add-local-folder'))

    await waitFor(() => {
      expect(electron.localFolder.mount).toHaveBeenCalledWith({ root_path: '/tmp/new-local' })
    })
    await waitFor(() => {
      const notebooks = (latestSidebarProps?.notebooks as Array<{ id: string }> | undefined) || []
      expect(notebooks.some((item) => item.id === 'local-2')).toBe(true)
    })
    expect(latestSidebarProps?.selectedNotebookId).toBe('local-2')
    consoleWarnSpy.mockRestore()
  })

  it('serializes add-local-folder flow and ignores duplicate clicks while selecting root', async () => {
    const { electron } = createElectronMock()
    const selectRootDeferred = createDeferred<{ success: true; root_path: string }>()
    const now = '2026-02-26T00:00:00.000Z'
    const mountedNotebook = {
      id: 'local-2',
      name: 'Second Local Notebook',
      icon: 'logo:notes',
      source_type: 'local-folder' as const,
      created_at: now,
      updated_at: now,
    }

    electron.localFolder.selectRoot = vi.fn(() => selectRootDeferred.promise) as any
    electron.localFolder.mount = vi.fn(async () => ({
      success: true as const,
      result: {
        notebook: mountedNotebook,
        mount: {
          notebook_id: 'local-2',
          root_path: '/tmp/local-2',
          canonical_root_path: '/tmp/local-2',
          status: 'active' as const,
          created_at: now,
          updated_at: now,
        },
      },
    })) as any

    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: electron,
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByTestId('add-local-folder')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('add-local-folder'))
    fireEvent.click(screen.getByTestId('add-local-folder'))

    await waitFor(() => {
      expect(electron.localFolder.selectRoot).toHaveBeenCalledTimes(1)
    })
    expect(electron.localFolder.mount).not.toHaveBeenCalled()

    await act(async () => {
      selectRootDeferred.resolve({ success: true, root_path: '/tmp/local-2' })
      await selectRootDeferred.promise
    })

    await waitFor(() => {
      expect(electron.localFolder.mount).toHaveBeenCalledTimes(1)
    })
    expect(electron.localFolder.mount).toHaveBeenCalledWith({ root_path: '/tmp/local-2' })
  })

  it('redirects to existing notebook when mount path already exists', async () => {
    const { electron } = createElectronMock()
    electron.localFolder.selectRoot = vi.fn(async () => ({
      success: true as const,
      root_path: '/tmp/local-notebook',
    })) as any
    electron.localFolder.mount = vi.fn(async () => ({
      success: false,
      errorCode: 'LOCAL_MOUNT_ALREADY_EXISTS',
      existing_mount: {
        notebook_id: 'local-1',
        status: 'active' as const,
      },
    })) as any

    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: electron,
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByTestId('open-local-from-all')).toBeEnabled()
    })

    fireEvent.click(screen.getByTestId('add-local-folder'))

    await waitFor(() => {
      expect(electron.localFolder.mount).toHaveBeenCalledWith({ root_path: '/tmp/local-notebook' })
    })
    await waitFor(() => {
      expect(latestSidebarProps?.selectedNotebookId).toBe('local-1')
    })
    expect(electron.localFolder.relink).not.toHaveBeenCalled()
  })

  it('auto-relinks existing missing mount when mounting same folder again', async () => {
    const { electron, getTree } = createElectronMock()
    const now = '2026-02-26T00:00:00.000Z'
    electron.localFolder.list = vi.fn(async () => ({
      success: true as const,
      result: {
        mounts: [{
          notebook: {
            id: 'local-1',
            name: 'Local Notebook',
            icon: 'logo:notes',
            source_type: 'local-folder',
            created_at: now,
            updated_at: now,
          },
          mount: {
            notebook_id: 'local-1',
            root_path: '/tmp/local-notebook',
            canonical_root_path: '/tmp/local-notebook',
            status: 'missing',
            created_at: now,
            updated_at: now,
          },
        }],
      },
    })) as any
    electron.localFolder.selectRoot = vi.fn(async () => ({
      success: true as const,
      root_path: '/tmp/local-notebook',
    })) as any
    electron.localFolder.mount = vi.fn(async () => ({
      success: false,
      errorCode: 'LOCAL_MOUNT_ALREADY_EXISTS',
      existing_mount: {
        notebook_id: 'local-1',
        status: 'missing' as const,
      },
    })) as any
    electron.localFolder.relink = vi.fn(async () => ({
      success: true,
      result: {
        notebook_id: 'local-1',
        root_path: '/tmp/local-notebook',
        canonical_root_path: '/tmp/local-notebook',
        status: 'active' as const,
        created_at: now,
        updated_at: now,
      },
    })) as any

    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: electron,
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByTestId('add-local-folder')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('add-local-folder'))

    await waitFor(() => {
      expect(electron.localFolder.relink).toHaveBeenCalledWith({
        notebook_id: 'local-1',
        root_path: '/tmp/local-notebook',
      })
    })
    await waitFor(() => {
      expect(latestSidebarProps?.selectedNotebookId).toBe('local-1')
    })
    expect(getTree).toHaveBeenCalledWith('local-1')
  })

  it('keeps local entries in all view when notebook list misses local notebook snapshot', async () => {
    const { electron } = createElectronMock()
    const baselineNotebooks = await electron.notebook.getAll()
    const getAllInternalOnly = vi.fn(async () => (
      baselineNotebooks.filter((notebook) => notebook.source_type !== 'local-folder')
    ))
    electron.notebook.getAll = getAllInternalOnly as typeof electron.notebook.getAll

    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: electron,
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByTestId('open-local-from-all')).toBeEnabled()
    })

    expect(screen.getByTestId('local-note-id').textContent).toBe('local:local-1:first.md')
  })

  it('keeps saved local selection when initial notebook load fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { electron, readFile } = createElectronMock()
    electron.notebook.getAll = vi.fn(async () => {
      throw new Error('load failed')
    })
    localStorage.setItem('sanqian-notes-last-note', 'local:local-1:first.md')
    localStorage.setItem('sanqian_notes_tabs_v2', JSON.stringify([
      {
        id: 'tab-1',
        layout: 'pane-1',
        panes: { 'pane-1': { noteId: 'n-1' } },
        focusedPaneId: 'pane-1',
        createdAt: 1,
      },
    ]))
    localStorage.setItem('sanqian_notes_active_tab', 'tab-1')

    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: electron,
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByTestId('note-list-stub')).toBeInTheDocument()
    })

    expect(localStorage.getItem('sanqian-notes-last-note')).toBe('local:local-1:first.md')
    expect(readFile).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalled()
  })
})
