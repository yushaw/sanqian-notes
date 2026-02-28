/**
 * LocalFolderNoteList macOS-specific header behavior
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { LocalFolderFileEntry } from '../../types/note'
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
  isMacOS: () => true,
}))

vi.mock('../Tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
}))

const files: LocalFolderFileEntry[] = [{
  id: 'f1',
  name: 'README',
  file_name: 'README.md',
  relative_path: 'README.md',
  folder_relative_path: '',
  folder_depth: 1,
  extension: 'md',
  size: 10,
  mtime_ms: 1,
  root_path: '/tmp',
  preview: 'preview',
}]

function renderList(isSidebarCollapsed: boolean) {
  return render(
    <LocalFolderNoteList
      title="Ideas"
      treeNodes={[]}
      files={files}
      isSidebarCollapsed={isSidebarCollapsed}
      showFolderTree={false}
      selectedFolderPath={null}
      onSelectFolder={vi.fn()}
      selectedFilePath={files[0].relative_path}
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
}

describe('LocalFolderNoteList macOS header', () => {
  it('hides list title when sidebar is collapsed on macOS', () => {
    renderList(true)
    expect(screen.queryByRole('heading', { name: 'Ideas' })).toBeNull()
  })

  it('shows list title when sidebar is expanded on macOS', () => {
    renderList(false)
    expect(screen.getByRole('heading', { name: 'Ideas' })).toBeInTheDocument()
  })
})
