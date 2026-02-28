/**
 * NoteList 组件测试
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
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
})

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

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

  it('hides dividers around selected note boundaries', () => {
    const { container } = render(
      <NoteList
        {...defaultProps}
        selectedNoteIds={['note-2']}
      />
    )

    const note1 = container.querySelector('[data-note-id="note-1"]')
    const note2 = container.querySelector('[data-note-id="note-2"]')
    const note3 = container.querySelector('[data-note-id="note-3"]')

    expect(note1).toBeTruthy()
    expect(note2).toBeTruthy()
    expect(note3).toBeTruthy()

    // note-1 divider is hidden because next item is selected
    expect(note1?.querySelector('[data-note-divider]')).toBeNull()
    // note-2 divider is hidden because itself is selected
    expect(note2?.querySelector('[data-note-divider]')).toBeNull()
    // note-3 divider keeps normal rendering
    expect(note3?.querySelector('[data-note-divider]')).not.toBeNull()
  })

  it('does not start drag payload for local search resources', () => {
    const localNote = createNote('local:nb-1:foo%2Fbar.md', 'Local hit')
    const { getByText } = render(
      <NoteList
        {...defaultProps}
        notes={[localNote]}
        selectedNoteIds={[localNote.id]}
      />
    )

    const button = getByText('Local hit').closest('button')
    expect(button).toBeTruthy()

    const setData = vi.fn()
    const dataTransfer = {
      effectAllowed: 'none',
      setData,
    }
    fireEvent.dragStart(button!, { dataTransfer })

    expect(setData).not.toHaveBeenCalled()
  })

  it('excludes local resources from drag payload when mixed selection is dragged', () => {
    const internalNote = createNote('note-1', 'Internal note')
    const localNote = createNote('local:nb-1:foo%2Fbar.md', 'Local hit')
    const { getByText } = render(
      <NoteList
        {...defaultProps}
        notes={[internalNote, localNote]}
        selectedNoteIds={[internalNote.id, localNote.id]}
      />
    )

    const internalButton = getByText('Internal note').closest('button')
    expect(internalButton).toBeTruthy()

    const setData = vi.fn()
    const dataTransfer = {
      effectAllowed: 'none',
      setData,
    }
    fireEvent.dragStart(internalButton!, { dataTransfer })

    expect(setData).toHaveBeenCalledWith('application/json', JSON.stringify([internalNote.id]))
  })

  it('prevents browser default context menu for local search resources', () => {
    const localNote = createNote('local:nb-1:foo%2Fbar.md', 'Local hit')
    const { getByText } = render(
      <NoteList
        {...defaultProps}
        notes={[localNote]}
        selectedNoteIds={[localNote.id]}
      />
    )

    const button = getByText('Local hit').closest('button')
    expect(button).toBeTruthy()

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    const dispatched = button!.dispatchEvent(event)
    expect(dispatched).toBe(false)
    expect(event.defaultPrevented).toBe(true)
  })

  it('ignores stale search responses and keeps latest search result stable', async () => {
    vi.useFakeTimers()
    try {
      const firstSearch = createDeferred<Note[]>()
      const secondSearch = createDeferred<Note[]>()
      const onSearch = vi
        .fn<(query: string) => Promise<Note[]>>()
        .mockImplementationOnce(() => firstSearch.promise)
        .mockImplementationOnce(() => secondSearch.promise)

      render(
        <NoteList
          {...defaultProps}
          onSearch={onSearch}
        />
      )

      fireEvent.click(screen.getByTitle('Search'))
      const searchInput = screen.getByPlaceholderText('Search notes')

      fireEvent.change(searchInput, { target: { value: 'first' } })
      await act(async () => {
        vi.advanceTimersByTime(160)
      })

      // While search is loading, keep current list visible and do not flash empty state.
      expect(screen.getByText('First note')).toBeInTheDocument()
      expect(screen.queryByText('No results')).not.toBeInTheDocument()

      fireEvent.change(searchInput, { target: { value: 'second' } })
      await act(async () => {
        vi.advanceTimersByTime(160)
      })

      expect(onSearch).toHaveBeenCalledTimes(2)
      expect(onSearch).toHaveBeenNthCalledWith(1, 'first')
      expect(onSearch).toHaveBeenNthCalledWith(2, 'second')

      await act(async () => {
        secondSearch.resolve([notes[1]])
        await Promise.resolve()
      })

      expect(screen.getByText('Second note')).toBeInTheDocument()
      expect(screen.queryByText('No results')).not.toBeInTheDocument()

      // Resolve stale response after latest one; UI should remain on latest result.
      await act(async () => {
        firstSearch.resolve([])
        await Promise.resolve()
      })

      expect(screen.getByText('Second note')).toBeInTheDocument()
      expect(screen.queryByText('No results')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores stale response that returns before next debounce starts', async () => {
    vi.useFakeTimers()
    try {
      const firstSearch = createDeferred<Note[]>()
      const secondSearch = createDeferred<Note[]>()
      const onSearch = vi
        .fn<(query: string) => Promise<Note[]>>()
        .mockImplementationOnce(() => firstSearch.promise)
        .mockImplementationOnce(() => secondSearch.promise)

      render(
        <NoteList
          {...defaultProps}
          onSearch={onSearch}
        />
      )

      fireEvent.click(screen.getByTitle('Search'))
      const searchInput = screen.getByPlaceholderText('Search notes')

      fireEvent.change(searchInput, { target: { value: 'first' } })
      await act(async () => {
        vi.advanceTimersByTime(160)
      })
      expect(onSearch).toHaveBeenCalledTimes(1)
      expect(onSearch).toHaveBeenNthCalledWith(1, 'first')

      fireEvent.change(searchInput, { target: { value: 'second' } })

      // Old request resolves before second debounce is fired; should be ignored.
      await act(async () => {
        firstSearch.resolve([])
        await Promise.resolve()
      })

      expect(screen.getByText('First note')).toBeInTheDocument()
      expect(screen.queryByText('No results')).not.toBeInTheDocument()

      await act(async () => {
        vi.advanceTimersByTime(160)
      })
      expect(onSearch).toHaveBeenCalledTimes(2)
      expect(onSearch).toHaveBeenNthCalledWith(2, 'second')

      await act(async () => {
        secondSearch.resolve([notes[1]])
        await Promise.resolve()
      })

      expect(screen.getByText('Second note')).toBeInTheDocument()
      expect(screen.queryByText('No results')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears no-results state immediately when query is emptied', async () => {
    vi.useFakeTimers()
    try {
      const onSearch = vi.fn<(query: string) => Promise<Note[]>>().mockResolvedValue([])

      render(
        <NoteList
          {...defaultProps}
          onSearch={onSearch}
        />
      )

      fireEvent.click(screen.getByTitle('Search'))
      const searchInput = screen.getByPlaceholderText('Search notes')

      fireEvent.change(searchInput, { target: { value: 'missing' } })
      await act(async () => {
        vi.advanceTimersByTime(160)
        await Promise.resolve()
      })

      expect(screen.getByText('No results')).toBeInTheDocument()

      fireEvent.change(searchInput, { target: { value: '' } })

      expect(screen.queryByText('No results')).not.toBeInTheDocument()
      expect(screen.getByText('First note')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not show empty states while waiting debounce after a previous no-results query', async () => {
    vi.useFakeTimers()
    try {
      const secondSearch = createDeferred<Note[]>()
      const onSearch = vi
        .fn<(query: string) => Promise<Note[]>>()
        .mockResolvedValueOnce([])
        .mockImplementationOnce(() => secondSearch.promise)

      render(
        <NoteList
          {...defaultProps}
          onSearch={onSearch}
        />
      )

      fireEvent.click(screen.getByTitle('Search'))
      const searchInput = screen.getByPlaceholderText('Search notes')

      fireEvent.change(searchInput, { target: { value: 'zzz' } })
      await act(async () => {
        vi.advanceTimersByTime(160)
        await Promise.resolve()
      })

      expect(screen.getByText('No results')).toBeInTheDocument()

      fireEvent.change(searchInput, { target: { value: 'sec' } })

      // Before debounce triggers, UI should not flash empty/no-results state.
      expect(screen.queryByText('No results')).not.toBeInTheDocument()
      expect(screen.queryByText('Empty')).not.toBeInTheDocument()
      expect(screen.getByText('First note')).toBeInTheDocument()

      await act(async () => {
        vi.advanceTimersByTime(160)
      })

      await act(async () => {
        secondSearch.resolve([notes[1]])
        await Promise.resolve()
      })

      expect(screen.getByText('Second note')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('defers search until IME composition commits', async () => {
    vi.useFakeTimers()
    try {
      const onSearch = vi.fn<(query: string) => Promise<Note[]>>().mockResolvedValue([notes[0]])

      render(
        <NoteList
          {...defaultProps}
          onSearch={onSearch}
        />
      )

      fireEvent.click(screen.getByTitle('Search'))
      const searchInput = screen.getByPlaceholderText('Search notes')

      fireEvent.compositionStart(searchInput)
      fireEvent.change(searchInput, { target: { value: 'zhong' } })

      await act(async () => {
        vi.advanceTimersByTime(220)
        await Promise.resolve()
      })

      expect(onSearch).not.toHaveBeenCalled()

      fireEvent.change(searchInput, { target: { value: '中' } })
      fireEvent.compositionEnd(searchInput)

      await act(async () => {
        vi.advanceTimersByTime(220)
        await Promise.resolve()
      })

      expect(onSearch).toHaveBeenCalledTimes(1)
      expect(onSearch).toHaveBeenCalledWith('中')
    } finally {
      vi.useRealTimers()
    }
  })
})
