/**
 * Sidebar add-menu positioning tests
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import type { Notebook, LocalFolderTreeNode, NotebookFolderTreeNode } from '../../types/note'
import { Sidebar } from '../Sidebar'

vi.mock('../../i18n', () => ({
  useTranslations: () => ({
    sidebar: {
      all: 'All Notes',
      daily: 'Daily',
      favorites: 'Favorites',
      notebooks: 'Notebooks',
      addNotebook: 'New Notebook',
      addLocalFolder: 'Add Local Folder',
      trash: 'Trash',
      collapse: 'Collapse',
      expand: 'Expand',
      settings: 'Settings',
      updateAvailable: 'Update available',
      updateReady: 'Update ready',
    },
    shortcuts: {
      title: 'Shortcuts',
      editing: 'Editing',
      newNote: 'New Note',
      newTab: 'New Tab',
      undo: 'Undo',
      redo: 'Redo',
      blocks: 'Blocks',
      slashCommand: 'Slash',
      codeBlock: 'Code Block',
      mathFormula: 'Math',
      noteLink: 'Note Link',
      textFormat: 'Text Format',
      bold: 'Bold',
      italic: 'Italic',
      underline: 'Underline',
      strikethrough: 'Strike',
      highlight: 'Highlight',
      inlineCode: 'Inline Code',
    },
    actions: {
      edit: 'Edit',
      delete: 'Delete',
      rename: 'Rename',
    },
    noteList: {
      allNotes: 'All notes',
      empty: 'Empty',
    },
    notebook: {
      createFolder: 'Create Folder',
      createSubfolder: 'New Subfolder',
      openInFileManager: 'Open in File Manager',
    },
    common: {
      loading: 'Loading...',
    },
  }),
}))

vi.mock('../../contexts/UpdateContext', () => ({
  useUpdate: () => ({
    status: 'idle',
    version: null,
    progress: 0,
    error: null,
    releaseNotes: null,
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    installUpdate: vi.fn(),
  }),
}))

vi.mock('../../utils/platform', () => ({
  isMacOS: () => false,
}))

vi.mock('../../hooks/useTodayDate', () => ({
  useTodayDateNumber: () => 25,
}))

vi.mock('../Tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
}))

const notebook: Notebook = {
  id: 'nb-1',
  name: 'Work',
  order_index: 0,
  created_at: '2026-02-25T00:00:00.000Z',
}

const localNotebook: Notebook = {
  id: 'local-1',
  name: 'AI',
  source_type: 'local-folder',
  order_index: 1,
  created_at: '2026-02-25T00:00:00.000Z',
}

function createSidebarProps(override: Partial<ComponentProps<typeof Sidebar>> = {}): ComponentProps<typeof Sidebar> {
  const defaultProps: ComponentProps<typeof Sidebar> = {
    notebooks: [notebook],
    selectedNotebookId: null,
    selectedSmartView: 'all',
    onSelectNotebook: vi.fn(),
    onSelectSmartView: vi.fn(),
    onAddNotebook: vi.fn(),
    onAddLocalFolder: vi.fn(),
    onEditNotebook: vi.fn(),
    onDeleteNotebook: vi.fn(),
    onOpenSettings: vi.fn(),
    onMoveNoteToNotebook: vi.fn(),
    onReorderNotebooks: vi.fn(),
    noteCounts: {
      all: 1,
      daily: 0,
      recent: 0,
      favorites: 0,
      trash: 0,
      notebooks: { 'nb-1': 1, 'local-1': 0 },
    },
  }

  return { ...defaultProps, ...override }
}

function renderSidebar(override: Partial<ComponentProps<typeof Sidebar>> = {}) {
  return render(
    <Sidebar {...createSidebarProps(override)} />
  )
}

function createRect(partial: Partial<DOMRect>): DOMRect {
  return {
    x: partial.x ?? 0,
    y: partial.y ?? 0,
    width: partial.width ?? 0,
    height: partial.height ?? 0,
    top: partial.top ?? 0,
    left: partial.left ?? 0,
    right: partial.right ?? 0,
    bottom: partial.bottom ?? 0,
    toJSON: () => ({}),
  } as DOMRect
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Sidebar add menu', () => {
  it('renders with fixed positioning in a portal', () => {
    renderSidebar()
    fireEvent.click(screen.getByTitle('New Notebook'))

    const menu = screen.getByTestId('sidebar-add-menu')
    expect(menu.parentElement).toBe(document.body)
    expect(menu.className).toContain('fixed')
  })

  it('clamps menu within viewport when trigger is near left edge', () => {
    renderSidebar()
    const addButton = screen.getByTitle('New Notebook')
    vi.spyOn(addButton, 'getBoundingClientRect').mockReturnValue(
      createRect({
        top: 24,
        bottom: 44,
        left: 0,
        right: 20,
        width: 20,
        height: 20,
      })
    )

    fireEvent.click(addButton)
    const menu = screen.getByTestId('sidebar-add-menu')
    expect(menu.style.left).toBe('8px')
  })

  it('renders local folder tree under selected local notebook in left sidebar', () => {
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

    renderSidebar({
      notebooks: [notebook, localNotebook],
      selectedNotebookId: localNotebook.id,
      selectedSmartView: null,
      localFolderTreeNodes: treeNodes,
      selectedLocalFolderPath: null,
      onSelectLocalFolder: vi.fn(),
    })

    fireEvent.click(screen.getAllByLabelText('Expand notebook')[0])
    expect(screen.queryByText('All notes')).not.toBeInTheDocument()
    expect(screen.getByText('Docs')).toBeInTheDocument()
  })

  it('shows notebook expand icon even when notebook is not selected if it has child folders', () => {
    renderSidebar({
      selectedNotebookId: null,
      notebookHasChildFolders: { [notebook.id]: true },
    })

    expect(screen.getByLabelText('Expand notebook')).toBeInTheDocument()
  })

  it('does not show notebook expand icon for unselected local notebook without known child folders', () => {
    renderSidebar({
      notebooks: [localNotebook],
      selectedNotebookId: null,
      selectedSmartView: null,
    })

    expect(screen.queryByLabelText('Expand notebook')).not.toBeInTheDocument()
  })

  it('selects notebook when clicking notebook expand icon', () => {
    const onSelectNotebook = vi.fn()

    renderSidebar({
      notebooks: [localNotebook],
      selectedNotebookId: null,
      selectedSmartView: null,
      onSelectNotebook,
      notebookHasChildFolders: { [localNotebook.id]: true },
    })

    fireEvent.click(screen.getAllByLabelText('Expand notebook')[0])
    expect(onSelectNotebook).toHaveBeenCalledWith(localNotebook.id)
  })

  it('toggles notebook tree when double-clicking notebook row', () => {
    renderSidebar({
      selectedNotebookId: notebook.id,
      selectedSmartView: null,
      notebookHasChildFolders: { [notebook.id]: true },
    })

    fireEvent.doubleClick(screen.getByText('Work'))
    expect(screen.getByLabelText('Collapse notebook')).toBeInTheDocument()

    fireEvent.doubleClick(screen.getByText('Work'))
    expect(screen.getByLabelText('Expand notebook')).toBeInTheDocument()
  })

  it('shows collapsed icon after switching to another notebook', () => {
    const initialProps = createSidebarProps({
      notebooks: [notebook, localNotebook],
      selectedNotebookId: notebook.id,
      selectedSmartView: null,
      notebookHasChildFolders: {
        [notebook.id]: true,
        [localNotebook.id]: true,
      },
    })

    const view = render(<Sidebar {...initialProps} />)

    fireEvent.click(screen.getAllByLabelText('Expand notebook')[0])
    expect(screen.getByLabelText('Collapse notebook')).toBeInTheDocument()

    view.rerender(
      <Sidebar
        {...initialProps}
        selectedNotebookId={localNotebook.id}
      />
    )

    expect(screen.queryByLabelText('Collapse notebook')).not.toBeInTheDocument()
  })

  it('hides create folder action in local folder menu for level-3 folder', () => {
    const treeNodes: LocalFolderTreeNode[] = [
      {
        id: 'fa',
        name: 'A',
        kind: 'folder',
        relative_path: 'A',
        depth: 1,
        children: [
          {
            id: 'fb',
            name: 'B',
            kind: 'folder',
            relative_path: 'A/B',
            depth: 2,
            children: [
              {
                id: 'fc',
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

    renderSidebar({
      notebooks: [localNotebook],
      selectedNotebookId: localNotebook.id,
      selectedSmartView: null,
      localFolderTreeNodes: treeNodes,
      selectedLocalFolderPath: null,
      onSelectLocalFolder: vi.fn(),
      onCreateLocalFolder: vi.fn(),
      onRenameLocalFolder: vi.fn(),
      onDeleteLocalFolder: vi.fn(),
      canCreateLocalFolder: true,
      canManageLocalFolders: true,
    })

    fireEvent.click(screen.getByLabelText('Expand notebook'))
    fireEvent.click(screen.getByLabelText('Expand folder'))
    fireEvent.click(screen.getByLabelText('Expand folder'))
    fireEvent.contextMenu(screen.getByText('C'))
    expect(screen.queryByText('New Subfolder')).not.toBeInTheDocument()
    expect(screen.getByText('Rename')).toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
  })

  it('toggles local folder expansion when double-clicking folder row', () => {
    const treeNodes: LocalFolderTreeNode[] = [
      {
        id: 'folder-a',
        name: 'A',
        kind: 'folder',
        relative_path: 'A',
        depth: 1,
        children: [
          {
            id: 'folder-b',
            name: 'B',
            kind: 'folder',
            relative_path: 'A/B',
            depth: 2,
            children: [],
          },
        ],
      },
    ]

    renderSidebar({
      notebooks: [localNotebook],
      selectedNotebookId: localNotebook.id,
      selectedSmartView: null,
      localFolderTreeNodes: treeNodes,
      selectedLocalFolderPath: null,
      onSelectLocalFolder: vi.fn(),
    })

    fireEvent.click(screen.getByLabelText('Expand notebook'))
    expect(screen.queryByText('B')).not.toBeInTheDocument()

    fireEvent.doubleClick(screen.getByText('A'))
    expect(screen.getByText('B')).toBeInTheDocument()

    fireEvent.doubleClick(screen.getByText('A'))
    expect(screen.queryByText('B')).not.toBeInTheDocument()
  })

  it('toggles nested local subfolder expansion when double-clicking subfolder row', () => {
    const treeNodes: LocalFolderTreeNode[] = [
      {
        id: 'folder-a',
        name: 'A',
        kind: 'folder',
        relative_path: 'A',
        depth: 1,
        children: [
          {
            id: 'folder-b',
            name: 'B',
            kind: 'folder',
            relative_path: 'A/B',
            depth: 2,
            children: [
              {
                id: 'folder-c',
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

    renderSidebar({
      notebooks: [localNotebook],
      selectedNotebookId: localNotebook.id,
      selectedSmartView: null,
      localFolderTreeNodes: treeNodes,
      selectedLocalFolderPath: null,
      onSelectLocalFolder: vi.fn(),
    })

    fireEvent.click(screen.getByLabelText('Expand notebook'))
    fireEvent.doubleClick(screen.getByText('A'))
    expect(screen.getByText('B')).toBeInTheDocument()
    expect(screen.queryByText('C')).not.toBeInTheDocument()

    fireEvent.doubleClick(screen.getByText('B'))
    expect(screen.getByText('C')).toBeInTheDocument()

    fireEvent.doubleClick(screen.getByText('B'))
    expect(screen.queryByText('C')).not.toBeInTheDocument()
  })

  it('renders internal folder tree under selected internal notebook in left sidebar', () => {
    const internalTreeNodes: NotebookFolderTreeNode[] = [
      {
        id: 'internal-folder-docs',
        name: 'Docs',
        folder_path: 'Docs',
        depth: 1,
        children: [],
      },
    ]

    renderSidebar({
      notebooks: [notebook],
      selectedNotebookId: notebook.id,
      selectedSmartView: null,
      internalFolderTreeNodes: internalTreeNodes,
      selectedInternalFolderPath: null,
      onSelectInternalFolder: vi.fn(),
    })

    fireEvent.click(screen.getByLabelText('Expand notebook'))
    expect(screen.queryByText('All notes')).not.toBeInTheDocument()
    expect(screen.getByText('Docs')).toBeInTheDocument()
  })

  it('removes notebook active background when selected internal folder is visible', () => {
    const internalTreeNodes: NotebookFolderTreeNode[] = [
      {
        id: 'internal-folder-docs',
        name: 'Docs',
        folder_path: 'Docs',
        depth: 1,
        children: [],
      },
    ]

    renderSidebar({
      notebooks: [notebook],
      selectedNotebookId: notebook.id,
      selectedSmartView: null,
      notebookHasChildFolders: { [notebook.id]: true },
      internalFolderTreeNodes: internalTreeNodes,
      selectedInternalFolderPath: 'Docs',
      onSelectInternalFolder: vi.fn(),
    })

    fireEvent.click(screen.getByLabelText('Expand notebook'))
    const notebookRow = screen.getByText('Work').closest('button')
    expect(notebookRow).not.toBeNull()
    expect(notebookRow?.getAttribute('style')).not.toContain('background-color')
  })

  it('keeps notebook active background when no internal folder is selected', () => {
    const internalTreeNodes: NotebookFolderTreeNode[] = [
      {
        id: 'internal-folder-docs',
        name: 'Docs',
        folder_path: 'Docs',
        depth: 1,
        children: [],
      },
    ]

    renderSidebar({
      notebooks: [notebook],
      selectedNotebookId: notebook.id,
      selectedSmartView: null,
      notebookHasChildFolders: { [notebook.id]: true },
      internalFolderTreeNodes: internalTreeNodes,
      selectedInternalFolderPath: null,
      onSelectInternalFolder: vi.fn(),
    })

    fireEvent.click(screen.getByLabelText('Expand notebook'))
    const notebookRow = screen.getByText('Work').closest('button')
    expect(notebookRow).not.toBeNull()
    expect(notebookRow?.getAttribute('style')).toContain('background-color')
  })

  it('hides create folder action in internal folder menu for level-3 folder', () => {
    const internalTreeNodes: NotebookFolderTreeNode[] = [
      {
        id: 'ia',
        name: 'A',
        folder_path: 'A',
        depth: 1,
        children: [
          {
            id: 'ib',
            name: 'B',
            folder_path: 'A/B',
            depth: 2,
            children: [
              {
                id: 'ic',
                name: 'C',
                folder_path: 'A/B/C',
                depth: 3,
                children: [],
              },
            ],
          },
        ],
      },
    ]

    renderSidebar({
      notebooks: [notebook],
      selectedNotebookId: notebook.id,
      selectedSmartView: null,
      internalFolderTreeNodes: internalTreeNodes,
      selectedInternalFolderPath: null,
      onSelectInternalFolder: vi.fn(),
      onCreateInternalFolder: vi.fn(),
      onRenameInternalFolder: vi.fn(),
      onDeleteInternalFolder: vi.fn(),
      canCreateInternalFolder: true,
      canManageInternalFolders: true,
    })

    fireEvent.click(screen.getByLabelText('Expand notebook'))
    fireEvent.click(screen.getByLabelText('Expand folder'))
    fireEvent.click(screen.getByLabelText('Expand folder'))
    fireEvent.contextMenu(screen.getByText('C'))
    expect(screen.queryByText('New Subfolder')).not.toBeInTheDocument()
    expect(screen.getByText('Rename')).toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
  })

  it('toggles internal folder expansion when double-clicking folder row', () => {
    const internalTreeNodes: NotebookFolderTreeNode[] = [
      {
        id: 'folder-a',
        name: 'A',
        folder_path: 'A',
        depth: 1,
        children: [
          {
            id: 'folder-b',
            name: 'B',
            folder_path: 'A/B',
            depth: 2,
            children: [],
          },
        ],
      },
    ]

    renderSidebar({
      notebooks: [notebook],
      selectedNotebookId: notebook.id,
      selectedSmartView: null,
      internalFolderTreeNodes: internalTreeNodes,
      selectedInternalFolderPath: null,
      onSelectInternalFolder: vi.fn(),
    })

    fireEvent.click(screen.getByLabelText('Expand notebook'))
    expect(screen.queryByText('B')).not.toBeInTheDocument()

    fireEvent.doubleClick(screen.getByText('A'))
    expect(screen.getByText('B')).toBeInTheDocument()

    fireEvent.doubleClick(screen.getByText('A'))
    expect(screen.queryByText('B')).not.toBeInTheDocument()
  })

  it('toggles nested internal subfolder expansion when double-clicking subfolder row', () => {
    const internalTreeNodes: NotebookFolderTreeNode[] = [
      {
        id: 'folder-a',
        name: 'A',
        folder_path: 'A',
        depth: 1,
        children: [
          {
            id: 'folder-b',
            name: 'B',
            folder_path: 'A/B',
            depth: 2,
            children: [
              {
                id: 'folder-c',
                name: 'C',
                folder_path: 'A/B/C',
                depth: 3,
                children: [],
              },
            ],
          },
        ],
      },
    ]

    renderSidebar({
      notebooks: [notebook],
      selectedNotebookId: notebook.id,
      selectedSmartView: null,
      internalFolderTreeNodes: internalTreeNodes,
      selectedInternalFolderPath: null,
      onSelectInternalFolder: vi.fn(),
    })

    fireEvent.click(screen.getByLabelText('Expand notebook'))
    fireEvent.doubleClick(screen.getByText('A'))
    expect(screen.getByText('B')).toBeInTheDocument()
    expect(screen.queryByText('C')).not.toBeInTheDocument()

    fireEvent.doubleClick(screen.getByText('B'))
    expect(screen.getByText('C')).toBeInTheDocument()

    fireEvent.doubleClick(screen.getByText('B'))
    expect(screen.queryByText('C')).not.toBeInTheDocument()
  })

  it('drops dragged notes onto an internal folder target', () => {
    const onMoveNoteToInternalFolder = vi.fn()
    const internalTreeNodes: NotebookFolderTreeNode[] = [
      {
        id: 'internal-folder-docs',
        name: 'Docs',
        folder_path: 'Docs',
        depth: 1,
        children: [],
      },
    ]

    renderSidebar({
      notebooks: [notebook],
      selectedNotebookId: notebook.id,
      selectedSmartView: null,
      internalFolderTreeNodes: internalTreeNodes,
      onSelectInternalFolder: vi.fn(),
      onMoveNoteToInternalFolder,
    })

    fireEvent.click(screen.getByLabelText('Expand notebook'))

    const dataTransfer = {
      types: ['application/json'],
      getData: vi.fn((type: string) => (type === 'application/json' ? JSON.stringify(['note-1']) : '')),
      dropEffect: 'none',
    }

    fireEvent.dragOver(screen.getByText('Docs'), { dataTransfer })
    fireEvent.drop(screen.getByText('Docs'), { dataTransfer })

    expect(onMoveNoteToInternalFolder).toHaveBeenCalledWith(['note-1'], notebook.id, 'Docs')
  })

  it('drops dragged notes onto a nested internal subfolder target', () => {
    const onMoveNoteToInternalFolder = vi.fn()
    const internalTreeNodes: NotebookFolderTreeNode[] = [
      {
        id: 'internal-folder-docs',
        name: 'Docs',
        folder_path: 'Docs',
        depth: 1,
        children: [
          {
            id: 'internal-folder-docs-product',
            name: 'Product',
            folder_path: 'Docs/Product',
            depth: 2,
            children: [],
          },
        ],
      },
    ]

    renderSidebar({
      notebooks: [notebook],
      selectedNotebookId: notebook.id,
      selectedSmartView: null,
      internalFolderTreeNodes: internalTreeNodes,
      onSelectInternalFolder: vi.fn(),
      onMoveNoteToInternalFolder,
    })

    fireEvent.click(screen.getByLabelText('Expand notebook'))
    fireEvent.click(screen.getByLabelText('Expand folder'))

    const dataTransfer = {
      types: ['application/json'],
      getData: vi.fn((type: string) => (type === 'application/json' ? JSON.stringify(['note-1']) : '')),
      dropEffect: 'none',
    }

    const productLabel = screen.getByText('Product')
    const productRow = productLabel.closest('[data-folder-path="Docs/Product"]')
    expect(productRow).not.toBeNull()

    fireEvent.dragOver(productLabel, { dataTransfer })
    expect(productRow).toHaveAttribute('data-drop-target', 'true')
    fireEvent.drop(productLabel, { dataTransfer })

    expect(onMoveNoteToInternalFolder).toHaveBeenCalledWith(['note-1'], notebook.id, 'Docs/Product')
  })

  it('shows create subfolder action in notebook context menu for internal notebook', () => {
    const onCreateInternalFolder = vi.fn()

    renderSidebar({
      notebooks: [notebook],
      selectedNotebookId: notebook.id,
      selectedSmartView: null,
      onCreateInternalFolder,
      canCreateInternalFolder: true,
    })

    fireEvent.contextMenu(screen.getByText('Work'))
    fireEvent.click(screen.getByText('New Subfolder'))
    expect(onCreateInternalFolder).toHaveBeenCalledWith(null)
  })

  it('shows open in file manager action for local notebook context menu', () => {
    const onOpenLocalFolderInFileManager = vi.fn()

    renderSidebar({
      notebooks: [localNotebook],
      selectedNotebookId: localNotebook.id,
      selectedSmartView: null,
      onOpenLocalFolderInFileManager,
    })

    fireEvent.contextMenu(screen.getByText('AI'))
    fireEvent.click(screen.getByText('Open in File Manager'))
    expect(onOpenLocalFolderInFileManager).toHaveBeenCalledWith(localNotebook.id)
  })
})
