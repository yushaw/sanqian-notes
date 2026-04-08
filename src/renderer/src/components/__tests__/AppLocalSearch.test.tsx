/**
 * App local search race-condition regression tests
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'
import App from '../../App'

let latestLocalFolderProps: Record<string, unknown> | null = null
let latestEditorProps: Record<string, unknown> | null = null

vi.mock('../Sidebar', () => ({
  Sidebar: () => <div data-testid="sidebar-stub" />,
}))

vi.mock('../NoteList', () => ({
  NoteList: () => <div data-testid="note-list-stub" />,
}))

vi.mock('../LocalFolderNoteList', () => ({
  LocalFolderNoteList: (props: Record<string, unknown>) => {
    latestLocalFolderProps = props
    const searchQuery = (props.searchQuery as string) || ''
    const onSearchQueryChange = props.onSearchQueryChange as ((query: string) => void) | undefined
    const onSearchCompositionStart = props.onSearchCompositionStart as (() => void) | undefined
    const onSearchCompositionEnd = props.onSearchCompositionEnd as ((query: string) => void) | undefined
    const searchLoading = Boolean(props.searchLoading)
    const searchMatchedPaths = props.searchMatchedPaths as Set<string> | null | undefined
    const matchedCount = searchMatchedPaths ? searchMatchedPaths.size : null

    return (
      <div data-testid="local-folder-note-list-stub">
        <input
          data-testid="local-search-input"
          value={searchQuery}
          onChange={(event) => onSearchQueryChange?.(event.target.value)}
          onCompositionStart={() => onSearchCompositionStart?.()}
          onCompositionEnd={(event) => onSearchCompositionEnd?.(event.currentTarget.value)}
        />
        <div data-testid="local-search-loading">{String(searchLoading)}</div>
        <div data-testid="local-search-matched-count">{matchedCount === null ? 'null' : String(matchedCount)}</div>
      </div>
    )
  },
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
      latestEditorProps = props
      const editable = props.editable !== false
      return (
        <div
          data-testid="editor-stub"
          data-editor-focused={String(Boolean(props.isFocused))}
          data-editor-editable={String(Boolean(editable))}
        />
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

type LocalFolderReadMockResponse =
  | { success: true; result: unknown }
  | { success: false; errorCode: string }

type LocalFolderWatchEvent = {
  notebook_id: string
  status: 'active' | 'missing' | 'permission_required'
  reason?: 'status_changed' | 'content_changed' | 'rescan_required'
  sequence?: number
  changed_relative_path?: string | null
}

function createElectronMock(searchImpl: (input: { query: string }) => Promise<unknown>) {
  const now = '2026-02-26T00:00:00.000Z'
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

  const unsubscribe = () => {}
  let onChangedHandler: ((event: LocalFolderWatchEvent) => void | Promise<void>) | null = null

  return {
    __emitLocalFolderChanged: async (event: LocalFolderWatchEvent) => {
      if (!onChangedHandler) return
      await onChangedHandler(event)
    },
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
      getAll: vi.fn(async () => []),
      getById: vi.fn(async () => null),
      getByIds: vi.fn(async () => []),
      add: vi.fn(async () => null),
      updateSafe: vi.fn(async () => ({ status: 'updated', note: null })),
      update: vi.fn(async () => null),
      delete: vi.fn(async () => true),
      search: vi.fn(async () => []),
      createDemo: vi.fn(async () => null),
      checkIndex: vi.fn(async () => true),
      onDataChanged: vi.fn(() => unsubscribe),
      onSummaryUpdated: vi.fn(() => unsubscribe),
      onNavigate: vi.fn(() => unsubscribe),
    },
    notebook: {
      getAll: vi.fn(async () => [localNotebook]),
      add: vi.fn(async () => localNotebook),
      update: vi.fn(async () => localNotebook),
      delete: vi.fn(async () => true),
      reorder: vi.fn(async () => true),
    },
    notebookFolder: {
      list: vi.fn(async () => []),
      create: vi.fn(async () => ({ success: true, result: { id: 'f1', notebook_id: 'local-1', folder_path: 'a', created_at: now, updated_at: now } })),
      rename: vi.fn(async () => ({ success: true, result: { id: 'f1', notebook_id: 'local-1', folder_path: 'a', created_at: now, updated_at: now } })),
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
      getTree: vi.fn(async () => ({ success: true, result: localTree })),
      search: vi.fn((input: { query: string }) => searchImpl(input)),
      listNoteMetadata: vi.fn(async () => ({ success: true, result: { items: [] } })),
      updateNoteMetadata: vi.fn(async () => ({ success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' })),
      onChanged: vi.fn((callback: (event: LocalFolderWatchEvent) => void | Promise<void>) => {
        onChangedHandler = callback
        return unsubscribe
      }),
      readFile: vi.fn<(input: unknown) => Promise<LocalFolderReadMockResponse>>(async () => ({ success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' })),
      saveFile: vi.fn(async () => ({ success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' })),
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
  }
}

describe('App local search race handling', () => {
  beforeEach(() => {
    latestLocalFolderProps = null
    latestEditorProps = null
    localStorage.clear()
    localStorage.setItem('sanqian-notes-last-notebook', 'local-1')

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
    cleanup()
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('ignores stale local search response that returns before the next debounce request starts', async () => {
    const firstSearch = createDeferred<unknown>()
    const secondSearch = createDeferred<unknown>()
    const searchMock = vi
      .fn<(input: { query: string }) => Promise<unknown>>()
      .mockImplementationOnce(() => firstSearch.promise)
      .mockImplementationOnce(() => secondSearch.promise)

    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: createElectronMock((input) => searchMock(input)),
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByTestId('local-search-input')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByTestId('local-search-input'), { target: { value: 'old' } })
    await waitFor(() => {
      expect(screen.getByTestId('local-search-loading')).toHaveTextContent('true')
    })

    await waitFor(() => {
      expect(searchMock).toHaveBeenCalledTimes(1)
    })

    expect(searchMock).toHaveBeenNthCalledWith(1, expect.objectContaining({ query: 'old' }))

    fireEvent.change(screen.getByTestId('local-search-input'), { target: { value: 'new' } })
    await waitFor(() => {
      expect(screen.getByTestId('local-search-loading')).toHaveTextContent('true')
      expect(screen.getByTestId('local-search-matched-count')).toHaveTextContent('null')
    })

    // Old response returns before new debounce request starts; should be ignored.
    await act(async () => {
      firstSearch.resolve({ success: true, result: { hits: [] } })
      await Promise.resolve()
    })

    expect(latestLocalFolderProps?.searchLoading).toBe(true)
    expect(latestLocalFolderProps?.searchMatchedPaths).toBeNull()

    await waitFor(() => {
      expect(searchMock).toHaveBeenCalledTimes(2)
    })

    expect(searchMock).toHaveBeenNthCalledWith(2, expect.objectContaining({ query: 'new' }))

    await act(async () => {
      secondSearch.resolve({
        success: true,
        result: {
          hits: [{
            notebook_id: 'local-1',
            relative_path: 'first.md',
            canonical_path: '/tmp/local-notebook/first.md',
            score: 0.9,
            mtime_ms: 1,
            snippet: 'first',
          }],
        },
      })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByTestId('local-search-loading')).toHaveTextContent('false')
      expect(screen.getByTestId('local-search-matched-count')).toHaveTextContent('1')
    })
  })

  it('ignores stale local search error response while next query is pending', async () => {
    const firstSearch = createDeferred<unknown>()
    const secondSearch = createDeferred<unknown>()
    const searchMock = vi
      .fn<(input: { query: string }) => Promise<unknown>>()
      .mockImplementationOnce(() => firstSearch.promise)
      .mockImplementationOnce(() => secondSearch.promise)

    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: createElectronMock((input) => searchMock(input)),
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByTestId('local-search-input')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByTestId('local-search-input'), { target: { value: 'old' } })
    await waitFor(() => {
      expect(searchMock).toHaveBeenCalledTimes(1)
    })

    fireEvent.change(screen.getByTestId('local-search-input'), { target: { value: 'new' } })
    await waitFor(() => {
      expect(screen.getByTestId('local-search-loading')).toHaveTextContent('true')
      expect(screen.getByTestId('local-search-matched-count')).toHaveTextContent('null')
    })

    // Old request fails before new debounce search starts; should be ignored.
    await act(async () => {
      firstSearch.resolve({ success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' })
      await Promise.resolve()
    })

    expect(latestLocalFolderProps?.searchLoading).toBe(true)
    expect(latestLocalFolderProps?.searchMatchedPaths).toBeNull()

    await waitFor(() => {
      expect(searchMock).toHaveBeenCalledTimes(2)
    })
    expect(searchMock).toHaveBeenNthCalledWith(2, expect.objectContaining({ query: 'new' }))

    await act(async () => {
      secondSearch.resolve({
        success: true,
        result: {
          hits: [],
        },
      })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByTestId('local-search-loading')).toHaveTextContent('false')
      expect(screen.getByTestId('local-search-matched-count')).toHaveTextContent('0')
    })
  })

  it('defers local search until IME composition commits', async () => {
    const searchMock = vi
      .fn<(input: { query: string }) => Promise<unknown>>()
      .mockResolvedValue({ success: true, result: { hits: [] } })

    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: createElectronMock((input) => searchMock(input)),
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByTestId('local-search-input')).toBeInTheDocument()
    })

    const searchInput = screen.getByTestId('local-search-input')
    fireEvent.compositionStart(searchInput)
    fireEvent.change(searchInput, { target: { value: 'zhong' } })

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 240))
    })

    expect(searchMock).not.toHaveBeenCalled()

    fireEvent.change(searchInput, { target: { value: '中' } })
    fireEvent.compositionEnd(searchInput)

    await waitFor(() => {
      expect(searchMock).toHaveBeenCalledTimes(1)
    })
    expect(searchMock).toHaveBeenCalledWith(expect.objectContaining({ query: '中' }))
  })

  it('does not loop getTree refresh when local tree load fails', async () => {
    const searchMock = vi
      .fn<(input: { query: string }) => Promise<unknown>>()
      .mockResolvedValue({ success: true, result: { hits: [] } })
    const electronMock = createElectronMock((input) => searchMock(input))
    const getTreeMock = electronMock.localFolder.getTree as ReturnType<typeof vi.fn>
    getTreeMock.mockResolvedValue({
      success: false,
      errorCode: 'LOCAL_MOUNT_UNAVAILABLE',
      mount_status: 'missing',
    })

    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: electronMock,
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByTestId('local-search-input')).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(getTreeMock.mock.calls.length).toBeGreaterThanOrEqual(2)
    })
    const initialCalls = getTreeMock.mock.calls.length

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 240))
    })

    expect(getTreeMock).toHaveBeenCalledTimes(initialCalls)
  })

  it('keeps cached local tree visible when active watch refresh fails transiently', async () => {
    const searchMock = vi
      .fn<(input: { query: string }) => Promise<unknown>>()
      .mockResolvedValue({ success: true, result: { hits: [] } })
    const electronMock = createElectronMock((input) => searchMock(input))
    const getTreeMock = electronMock.localFolder.getTree as ReturnType<typeof vi.fn>

    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: electronMock,
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByTestId('local-search-input')).toBeInTheDocument()
    })

    await waitFor(() => {
      const files = ((latestLocalFolderProps?.files as Array<{ relative_path: string }> | undefined) || [])
      expect(files.length).toBeGreaterThan(0)
    })

    getTreeMock.mockResolvedValue({
      success: false,
      errorCode: 'LOCAL_MOUNT_PATH_UNREACHABLE',
    })

    await act(async () => {
      await electronMock.__emitLocalFolderChanged({
        notebook_id: 'local-1',
        status: 'active',
        reason: 'content_changed',
        sequence: 99,
        changed_relative_path: 'first.md',
      })
      await new Promise((resolve) => setTimeout(resolve, 240))
    })

    await waitFor(() => {
      expect(getTreeMock.mock.calls.length).toBeGreaterThan(1)
    })

    const filesAfterFailure = ((latestLocalFolderProps?.files as Array<{ relative_path: string }> | undefined) || [])
    expect(filesAfterFailure.map((file) => file.relative_path)).toContain('first.md')
  })

  it('coalesces mount status refresh calls for burst local tree failures', async () => {
    const searchMock = vi
      .fn<(input: { query: string }) => Promise<unknown>>()
      .mockResolvedValue({ success: true, result: { hits: [] } })
    const electronMock = createElectronMock((input) => searchMock(input))
    const getTreeMock = electronMock.localFolder.getTree as ReturnType<typeof vi.fn>

    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: electronMock,
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByTestId('local-search-input')).toBeInTheDocument()
    })

    const initialListCalls = (electronMock.localFolder.list as ReturnType<typeof vi.fn>).mock.calls.length
    getTreeMock.mockResolvedValue({
      success: false,
      errorCode: 'LOCAL_MOUNT_PATH_UNREACHABLE',
    })

    await act(async () => {
      await electronMock.__emitLocalFolderChanged({
        notebook_id: 'local-1',
        status: 'active',
        reason: 'content_changed',
        sequence: 100,
        changed_relative_path: 'first.md',
      })
      await new Promise((resolve) => setTimeout(resolve, 240))
      await electronMock.__emitLocalFolderChanged({
        notebook_id: 'local-1',
        status: 'active',
        reason: 'content_changed',
        sequence: 101,
        changed_relative_path: 'first.md',
      })
      await new Promise((resolve) => setTimeout(resolve, 240))
    })

    const listCallsAfterBurst = (electronMock.localFolder.list as ReturnType<typeof vi.fn>).mock.calls.length
    expect(listCallsAfterBurst - initialListCalls).toBe(1)
  })

  it('reuses in-flight local tree refresh for same notebook burst events', async () => {
    const searchMock = vi
      .fn<(input: { query: string }) => Promise<unknown>>()
      .mockResolvedValue({ success: true, result: { hits: [] } })
    const electronMock = createElectronMock((input) => searchMock(input))
    const getTreeMock = electronMock.localFolder.getTree as ReturnType<typeof vi.fn>
    const deferredTree = createDeferred<{ success: false; errorCode: 'LOCAL_MOUNT_PATH_UNREACHABLE' }>()

    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: electronMock,
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByTestId('local-search-input')).toBeInTheDocument()
    })

    const initialTreeCalls = getTreeMock.mock.calls.length
    getTreeMock.mockImplementation(() => deferredTree.promise)

    await act(async () => {
      await electronMock.__emitLocalFolderChanged({
        notebook_id: 'local-1',
        status: 'active',
        reason: 'content_changed',
        sequence: 200,
        changed_relative_path: 'first.md',
      })
      await new Promise((resolve) => setTimeout(resolve, 240))
      await electronMock.__emitLocalFolderChanged({
        notebook_id: 'local-1',
        status: 'active',
        reason: 'content_changed',
        sequence: 201,
        changed_relative_path: 'first.md',
      })
      await new Promise((resolve) => setTimeout(resolve, 240))
    })

    expect(getTreeMock.mock.calls.length - initialTreeCalls).toBe(1)

    await act(async () => {
      deferredTree.resolve({
        success: false,
        errorCode: 'LOCAL_MOUNT_PATH_UNREACHABLE',
      })
      await Promise.resolve()
    })
  })

  it('refreshes local mount statuses after mount-related search failure', async () => {
    const searchMock = vi
      .fn<(input: { query: string }) => Promise<unknown>>()
      .mockResolvedValue({ success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' })
    const electronMock = createElectronMock((input) => searchMock(input))

    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: electronMock,
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByTestId('local-search-input')).toBeInTheDocument()
    })

    const initialListCallCount = (electronMock.localFolder.list as ReturnType<typeof vi.fn>).mock.calls.length
    fireEvent.change(screen.getByTestId('local-search-input'), { target: { value: 'lost' } })

    await waitFor(() => {
      expect(searchMock).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect((electronMock.localFolder.list as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(initialListCallCount)
    })
  })

  it('does not reload when selecting the same local file repeatedly', async () => {
    const searchMock = vi
      .fn<(input: { query: string }) => Promise<unknown>>()
      .mockResolvedValue({ success: true, result: { hits: [] } })
    const electronMock = createElectronMock((input) => searchMock(input))
    const readFileMock = vi.fn<(input: unknown) => Promise<LocalFolderReadMockResponse>>().mockResolvedValue({
      success: true as const,
      result: {
        id: 'local-file-1',
        notebook_id: 'local-1',
        name: 'First Local Note',
        file_name: 'first.md',
        relative_path: 'first.md',
        extension: 'md' as const,
        size: 10,
        mtime_ms: 1,
        tiptap_content: JSON.stringify({
          type: 'doc',
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: 'hello' }],
          }],
        }),
      },
    })
    electronMock.localFolder.readFile = readFileMock

    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: electronMock,
    })

    render(<App />)

    await waitFor(() => {
      expect(latestLocalFolderProps).not.toBeNull()
    })

    const getLatestFiles = () => (
      (latestLocalFolderProps?.files as Array<{ relative_path: string }> | undefined) || []
    )
    const getLatestOnSelectFile = () => (
      latestLocalFolderProps?.onSelectFile as ((file: { relative_path: string }) => Promise<void>) | undefined
    )

    const files = getLatestFiles()
    expect(files.length).toBeGreaterThan(0)
    const targetFile = files[0]
    expect(getLatestOnSelectFile()).toBeTruthy()

    await act(async () => {
      await getLatestOnSelectFile()?.(targetFile)
    })
    await waitFor(() => {
      expect(readFileMock).toHaveBeenCalledTimes(1)
    })

    const sameFileAfterOpen = getLatestFiles()[0]
    await act(async () => {
      await getLatestOnSelectFile()?.(sameFileAfterOpen)
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(readFileMock).toHaveBeenCalledTimes(1)
  })

  it('does not reload while selecting the same local file during loading', async () => {
    const searchMock = vi
      .fn<(input: { query: string }) => Promise<unknown>>()
      .mockResolvedValue({ success: true, result: { hits: [] } })
    const firstRead = createDeferred<LocalFolderReadMockResponse>()
    const electronMock = createElectronMock((input) => searchMock(input))
    const readFileMock = vi.fn<(input: unknown) => Promise<LocalFolderReadMockResponse>>()
      .mockImplementationOnce(() => firstRead.promise)
    electronMock.localFolder.readFile = readFileMock

    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: electronMock,
    })

    render(<App />)

    await waitFor(() => {
      expect(latestLocalFolderProps).not.toBeNull()
    })

    const getLatestFiles = () => (
      (latestLocalFolderProps?.files as Array<{ relative_path: string }> | undefined) || []
    )
    const getLatestOnSelectFile = () => (
      latestLocalFolderProps?.onSelectFile as ((file: { relative_path: string }) => Promise<void>) | undefined
    )

    const targetFile = getLatestFiles()[0]
    expect(targetFile).toBeTruthy()
    expect(getLatestOnSelectFile()).toBeTruthy()

    await act(async () => {
      void getLatestOnSelectFile()?.(targetFile)
      await Promise.resolve()
    })
    expect(readFileMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      await getLatestOnSelectFile()?.(targetFile)
      await Promise.resolve()
    })

    expect(readFileMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      firstRead.resolve({
        success: true,
        result: {
          id: 'local-file-1',
          notebook_id: 'local-1',
          name: 'First Local Note',
          file_name: 'first.md',
          relative_path: 'first.md',
          extension: 'md',
          size: 10,
          mtime_ms: 1,
          tiptap_content: JSON.stringify({
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
          }),
        },
      })
      await Promise.resolve()
    })
  })

  it('keeps editor visible while next local file is loading', async () => {
    const searchMock = vi
      .fn<(input: { query: string }) => Promise<unknown>>()
      .mockResolvedValue({ success: true, result: { hits: [] } })
    const secondRead = createDeferred<unknown>()
    const electronMock = createElectronMock((input) => searchMock(input))
    const readFileMock = vi
      .fn()
      .mockResolvedValueOnce({
        success: true as const,
        result: {
          id: 'local-file-1',
          notebook_id: 'local-1',
          name: 'First Local Note',
          file_name: 'first.md',
          relative_path: 'first.md',
          extension: 'md' as const,
          size: 10,
          mtime_ms: 1,
          tiptap_content: JSON.stringify({
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }],
          }),
        },
      })
      .mockImplementationOnce(() => secondRead.promise)
    electronMock.localFolder.readFile = readFileMock

    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: electronMock,
    })

    render(<App />)

    await waitFor(() => {
      expect(latestLocalFolderProps).not.toBeNull()
    })

    const files = (latestLocalFolderProps?.files as Array<{
      id: string
      name: string
      file_name: string
      relative_path: string
      folder_relative_path: string
      folder_depth: number
      extension: 'md' | 'txt'
      size: number
      mtime_ms: number
      root_path: string
    }> | undefined) || []
    expect(files.length).toBeGreaterThan(0)
    const onSelectFile = latestLocalFolderProps?.onSelectFile as ((file: typeof files[number]) => Promise<void>) | undefined
    expect(onSelectFile).toBeTruthy()

    await act(async () => {
      await onSelectFile?.(files[0])
    })
    await waitFor(() => {
      expect(readFileMock).toHaveBeenCalledTimes(1)
      expect(screen.getByTestId('editor-stub')).toBeInTheDocument()
    })

    const nextFile = {
      ...files[0],
      id: 'local-file-2',
      name: 'Second Local Note',
      file_name: 'second.md',
      relative_path: 'second.md',
    }

    await act(async () => {
      void onSelectFile?.(nextFile)
      await Promise.resolve()
    })

    expect(readFileMock).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('editor-stub')).toBeInTheDocument()
    expect(screen.getByTestId('editor-stub')).toHaveAttribute('data-editor-focused', 'false')
    expect(screen.getByTestId('editor-stub')).toHaveAttribute('data-editor-editable', 'false')
    expect(latestEditorProps?.isFocused).toBe(false)
    expect(latestEditorProps?.editable).toBe(false)
    expect(screen.getByTestId('local-editor-loading-overlay')).toBeInTheDocument()

    await act(async () => {
      secondRead.resolve({
        success: true,
        result: {
          id: 'local-file-2',
          notebook_id: 'local-1',
          name: 'Second Local Note',
          file_name: 'second.md',
          relative_path: 'second.md',
          extension: 'md',
          size: 12,
          mtime_ms: 2,
          tiptap_content: JSON.stringify({
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'second' }] }],
          }),
        },
      })
      await Promise.resolve()
    })
  })
})
