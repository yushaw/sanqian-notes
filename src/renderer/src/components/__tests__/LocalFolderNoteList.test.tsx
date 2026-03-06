/**
 * LocalFolderNoteList component tests
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import type { LocalFolderFileEntry, LocalFolderTreeNode } from '../../types/note'
import { LocalFolderNoteList } from '../LocalFolderNoteList'

vi.mock('../../i18n', () => ({
  useTranslations: () => ({
    noteList: {
      searchPlaceholder: 'Search notes',
      search: 'Search',
      noResults: 'No results',
      empty: 'Empty',
      allNotes: 'All notes',
      newNote: 'New note',
    },
    notebook: {
      createFile: 'Create File',
      createFolder: 'Create Folder',
      createSubfolder: 'Create Subfolder',
    },
    actions: {
      rename: 'Rename',
      delete: 'Delete',
    },
    common: {
      loading: 'Loading...',
    },
    date: {
      today: 'Today',
      yesterday: 'Yesterday',
      dayBeforeYesterday: '2 days ago',
      daysAgo: '{n} days ago',
    },
  }),
}))

vi.mock('../../utils/platform', () => ({
  isMacOS: () => false,
}))

vi.mock('../Tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
}))

const treeNodes: LocalFolderTreeNode[] = [
  {
    id: 'folder-docs',
    name: 'Docs',
    kind: 'folder',
    relative_path: 'Docs',
    depth: 1,
    children: [],
  },
]

const files: LocalFolderFileEntry[] = [
  {
    id: 'file-readme',
    name: 'README',
    file_name: 'README.md',
    relative_path: 'Docs/README.md',
    folder_relative_path: 'Docs',
    folder_depth: 1,
    extension: 'md',
    size: 10,
    mtime_ms: 1,
    root_path: '/tmp',
  },
]

function renderList(override: Partial<ComponentProps<typeof LocalFolderNoteList>> = {}) {
  const defaultProps: ComponentProps<typeof LocalFolderNoteList> = {
    title: 'AI',
    treeNodes,
    files,
    selectedFolderPath: null,
    onSelectFolder: vi.fn(),
    selectedFilePath: null,
    onSelectFile: vi.fn(),
    searchQuery: '',
    onSearchQueryChange: vi.fn(),
    searchLoading: false,
    searchMatchedPaths: null,
    searchDisabled: false,
    onCreateFile: vi.fn(),
    onCreateFolder: vi.fn(),
    onRenameEntry: vi.fn(),
    onDeleteEntry: vi.fn(),
    canCreateFile: true,
    canCreateFolder: true,
    canManageEntries: true,
  }
  return render(<LocalFolderNoteList {...defaultProps} {...override} />)
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('LocalFolderNoteList', () => {
  it('opens search input on Ctrl+F when middle column is focused', () => {
    renderList()
    const fileButton = screen.getByText('README').closest('button')
    expect(fileButton).toBeTruthy()
    fileButton!.focus()

    fireEvent.keyDown(window, { key: 'f', ctrlKey: true })

    expect(screen.getByPlaceholderText('Search notes')).toBeInTheDocument()
  })

  it('closes search input on Escape', () => {
    renderList()
    fireEvent.click(screen.getByTitle('Search'))
    expect(screen.getByPlaceholderText('Search notes')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByPlaceholderText('Search notes')).not.toBeInTheDocument()
    expect(screen.getByTitle('Create File')).toBeInTheDocument()
  })

  it('selects next file on ArrowDown when focus is in middle list', () => {
    const onSelectFile = vi.fn()
    const fileA: LocalFolderFileEntry = {
      ...files[0],
      id: 'file-a',
      name: 'A',
      file_name: 'A.md',
      relative_path: 'Docs/A.md',
    }
    const fileB: LocalFolderFileEntry = {
      ...files[0],
      id: 'file-b',
      name: 'B',
      file_name: 'B.md',
      relative_path: 'Docs/B.md',
    }

    renderList({
      files: [fileA, fileB],
      selectedFilePath: fileA.relative_path,
      onSelectFile,
    })

    const firstButton = screen.getByText('A').closest('button')
    expect(firstButton).toBeTruthy()
    firstButton!.focus()

    fireEvent.keyDown(window, { key: 'ArrowDown' })

    expect(onSelectFile).toHaveBeenCalledWith(expect.objectContaining({ relative_path: fileB.relative_path }))
  })

  it('selects previous file on ArrowUp when focus is in middle list', () => {
    const onSelectFile = vi.fn()
    const fileA: LocalFolderFileEntry = {
      ...files[0],
      id: 'file-a',
      name: 'A',
      file_name: 'A.md',
      relative_path: 'Docs/A.md',
    }
    const fileB: LocalFolderFileEntry = {
      ...files[0],
      id: 'file-b',
      name: 'B',
      file_name: 'B.md',
      relative_path: 'Docs/B.md',
    }

    renderList({
      files: [fileA, fileB],
      selectedFilePath: fileB.relative_path,
      onSelectFile,
    })

    const secondButton = screen.getByText('B').closest('button')
    expect(secondButton).toBeTruthy()
    secondButton!.focus()

    fireEvent.keyDown(window, { key: 'ArrowUp' })

    expect(onSelectFile).toHaveBeenCalledWith(expect.objectContaining({ relative_path: fileA.relative_path }))
  })

  it('does not navigate files when focus is in search input', () => {
    const onSelectFile = vi.fn()
    renderList({ onSelectFile, selectedFilePath: files[0].relative_path })
    fireEvent.click(screen.getByTitle('Search'))

    const searchInput = screen.getByPlaceholderText('Search notes')
    searchInput.focus()
    fireEvent.keyDown(window, { key: 'ArrowDown' })

    expect(onSelectFile).not.toHaveBeenCalled()
  })

  it('keeps selected file visible after selection changes', () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: scrollIntoView,
      configurable: true,
      writable: true,
    })

    const fileA: LocalFolderFileEntry = {
      ...files[0],
      id: 'file-a',
      name: 'A',
      file_name: 'A.md',
      relative_path: 'Docs/A.md',
    }
    const fileB: LocalFolderFileEntry = {
      ...files[0],
      id: 'file-b',
      name: 'B',
      file_name: 'B.md',
      relative_path: 'Docs/B.md',
    }

    const rendered = renderList({
      files: [fileA, fileB],
      selectedFilePath: fileA.relative_path,
    })
    scrollIntoView.mockClear()

    rendered.rerender(
      <LocalFolderNoteList
        title="AI"
        treeNodes={treeNodes}
        files={[fileA, fileB]}
        selectedFolderPath={null}
        onSelectFolder={vi.fn()}
        selectedFilePath={fileB.relative_path}
        onSelectFile={vi.fn()}
        searchQuery=""
        onSearchQueryChange={vi.fn()}
        searchLoading={false}
        searchMatchedPaths={null}
        searchDisabled={false}
        onCreateFile={vi.fn()}
        onCreateFolder={vi.fn()}
        onRenameEntry={vi.fn()}
        onDeleteEntry={vi.fn()}
        canCreateFile
        canCreateFolder
        canManageEntries
      />
    )

    expect(scrollIntoView).toHaveBeenCalled()
  })

  it('shows search input in header after clicking search button', () => {
    renderList()
    expect(screen.getByTitle('Create File')).toBeInTheDocument()

    fireEvent.click(screen.getByTitle('Search'))

    expect(screen.getByPlaceholderText('Search notes')).toBeInTheDocument()
    expect(screen.queryByTitle('Create File')).not.toBeInTheDocument()
  })

  it('opens folder context menu with create-subfolder/rename/delete actions', () => {
    const onCreateFolder = vi.fn()
    const onRenameEntry = vi.fn()
    const onDeleteEntry = vi.fn()
    renderList({ onCreateFolder, onRenameEntry, onDeleteEntry })

    fireEvent.contextMenu(screen.getByText('Docs'))

    fireEvent.click(screen.getByText('Create Subfolder'))
    expect(onCreateFolder).toHaveBeenCalledWith('Docs')

    fireEvent.contextMenu(screen.getByText('Docs'))
    fireEvent.click(screen.getByText('Rename'))
    expect(onRenameEntry).toHaveBeenCalledWith({ kind: 'folder', relativePath: 'Docs' })

    fireEvent.contextMenu(screen.getByText('Docs'))
    fireEvent.click(screen.getByText('Delete'))
    expect(onDeleteEntry).toHaveBeenCalledWith({ kind: 'folder', relativePath: 'Docs' })
  })

  it('opens file context menu with rename/delete actions', () => {
    const onRenameEntry = vi.fn()
    const onDeleteEntry = vi.fn()
    renderList({ onRenameEntry, onDeleteEntry })

    fireEvent.contextMenu(screen.getByText('README'))
    fireEvent.click(screen.getByText('Rename'))
    expect(onRenameEntry).toHaveBeenCalledWith({ kind: 'file', relativePath: 'Docs/README.md' })

    fireEvent.contextMenu(screen.getByText('README'))
    fireEvent.click(screen.getByText('Delete'))
    expect(onDeleteEntry).toHaveBeenCalledWith({ kind: 'file', relativePath: 'Docs/README.md' })
  })

  it('hides create folder action on level-3 folder context menu', () => {
    const deepTree: LocalFolderTreeNode[] = [
      {
        id: 'f-a',
        name: 'A',
        kind: 'folder',
        relative_path: 'A',
        depth: 1,
        children: [
          {
            id: 'f-b',
            name: 'B',
            kind: 'folder',
            relative_path: 'A/B',
            depth: 2,
            children: [
              {
                id: 'f-c',
                name: 'C',
                kind: 'folder',
                relative_path: 'A/B/C',
                depth: 3,
                children: [],
              },
            ],
          },
        ],
      },
    ]

    renderList({ treeNodes: deepTree, files: [] })
    fireEvent.contextMenu(screen.getByText('C'))

    expect(screen.queryByText('Create Subfolder')).not.toBeInTheDocument()
    expect(screen.getByText('Rename')).toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
  })

  it('keeps current files visible while search is still loading', () => {
    renderList({
      showFolderTree: false,
      searchQuery: 'read',
      searchLoading: true,
      searchMatchedPaths: null,
    })

    expect(screen.getByText('README')).toBeInTheDocument()
    expect(screen.queryByText('No results')).not.toBeInTheDocument()
  })

  it('prefers file preview text and falls back to relative path', () => {
    const filesWithPreview: LocalFolderFileEntry[] = [
      {
        ...files[0],
        id: 'file-preview',
        relative_path: 'Docs/Preview.md',
        file_name: 'Preview.md',
        name: 'Preview',
        preview: 'This is a preview line',
      },
      {
        ...files[0],
        id: 'file-no-preview',
        relative_path: 'Docs/Fallback.md',
        file_name: 'Fallback.md',
        name: 'Fallback',
        preview: '',
      },
    ]

    renderList({ files: filesWithPreview })

    expect(screen.getByText('This is a preview line')).toBeInTheDocument()
    expect(screen.getByText('Docs/Fallback.md')).toBeInTheDocument()
  })

  it('shows empty state with create action when file list is empty', () => {
    const onCreateFile = vi.fn()
    renderList({ files: [], onCreateFile })

    expect(screen.getByText('Empty')).toBeInTheDocument()
    fireEvent.click(screen.getByText('New note'))
    expect(onCreateFile).toHaveBeenCalled()
  })

  it('renders visible selected style for selected file item', () => {
    renderList({ selectedFilePath: 'Docs/README.md' })
    const selectedButton = screen.getByText('README').closest('button')
    expect(selectedButton).toBeTruthy()
    expect(selectedButton).toHaveStyle({
      backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, var(--color-card-solid))',
    })
  })
})
