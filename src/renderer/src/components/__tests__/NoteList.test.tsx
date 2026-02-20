/**
 * NoteList 组件测试
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'
import { NoteList } from '../NoteList'
import type { Note } from '../../types/note'

vi.mock('../../i18n', () => ({
  useTranslations: () => ({
    noteList: {
      searchPlaceholder: 'Search notes',
      search: 'Search',
      newNote: 'New note',
      noResults: 'No results',
      empty: 'Empty',
      noContent: 'No content',
      untitled: 'Untitled',
      openInNewTab: 'Open in new tab',
      pin: 'Pin',
      unpin: 'Unpin',
      favorite: 'Favorite',
      unfavorite: 'Unfavorite',
      duplicate: 'Duplicate',
      move: 'Move',
      delete: 'Delete',
      allNotes: 'All notes',
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

vi.mock('../ContextMenu', () => ({
  ContextMenu: () => null,
}))

vi.mock('../NotePreviewPopover', () => ({
  NotePreviewPopover: () => null,
}))

vi.mock('../Tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
}))

const now = '2026-02-20T12:00:00.000Z'

const createNote = (id: string, title: string): Note => ({
  id,
  title,
  content: '[]',
  notebook_id: null,
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
})

describe('NoteList keyboard navigation', () => {
  const notes = [
    createNote('note-1', 'First note'),
    createNote('note-2', 'Second note'),
    createNote('note-3', 'Third note'),
  ]

  const defaultProps = {
    notes,
    selectedNoteIds: ['note-1'],
    title: 'All notes',
    onSelectNote: vi.fn(),
    onCreateNote: vi.fn(),
    onSearch: vi.fn(async () => []),
    onTogglePinned: vi.fn(),
    onToggleFavorite: vi.fn(),
    onDeleteNote: vi.fn(),
    onDuplicateNote: vi.fn(),
    onMoveToNotebook: vi.fn(),
    notebooks: [],
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('selects next note on ArrowDown when focus is in middle note list', () => {
    const onSelectNote = vi.fn()
    render(
      <NoteList
        {...defaultProps}
        onSelectNote={onSelectNote}
      />
    )

    const firstButton = screen.getByText('First note').closest('button')
    expect(firstButton).toBeTruthy()
    firstButton!.focus()

    fireEvent.keyDown(window, { key: 'ArrowDown' })

    expect(onSelectNote).toHaveBeenCalledWith('note-2')
  })

  it('selects previous note on ArrowUp when focus is in middle note list', () => {
    const onSelectNote = vi.fn()
    render(
      <NoteList
        {...defaultProps}
        selectedNoteIds={['note-2']}
        onSelectNote={onSelectNote}
      />
    )

    const secondButton = screen.getByText('Second note').closest('button')
    expect(secondButton).toBeTruthy()
    secondButton!.focus()

    fireEvent.keyDown(window, { key: 'ArrowUp' })

    expect(onSelectNote).toHaveBeenCalledWith('note-1')
  })

  it('does not navigate notes when focus is in search input', async () => {
    const onSelectNote = vi.fn()
    render(
      <NoteList
        {...defaultProps}
        onSelectNote={onSelectNote}
      />
    )

    fireEvent.click(screen.getByTitle('Search'))
    const searchInput = await screen.findByPlaceholderText('Search notes')
    searchInput.focus()

    fireEvent.keyDown(window, { key: 'ArrowDown' })

    expect(onSelectNote).not.toHaveBeenCalled()
  })

  it('does not navigate notes with modifier keys', () => {
    const onSelectNote = vi.fn()
    render(
      <NoteList
        {...defaultProps}
        onSelectNote={onSelectNote}
      />
    )

    const firstButton = screen.getByText('First note').closest('button')
    expect(firstButton).toBeTruthy()
    firstButton!.focus()

    fireEvent.keyDown(window, { key: 'ArrowDown', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'ArrowDown', metaKey: true })
    fireEvent.keyDown(window, { key: 'ArrowDown', altKey: true })

    expect(onSelectNote).not.toHaveBeenCalled()
  })
})
