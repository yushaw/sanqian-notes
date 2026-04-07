/**
 * TrashList component tests
 *
 * @vitest-environment jsdom
 */
import { describe, it, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { Note } from '../../types/note'
import { TrashList } from '../TrashList'
import { expectHeaderOnlyDragRegion, expectNoDragControl } from './dragRegionContract'

vi.mock('../../i18n', () => ({
  useTranslations: () => ({
    noteList: {
      untitled: 'Untitled',
      noContent: 'No content',
    },
    trash: {
      title: 'Trash',
      empty: 'Trash is empty',
      emptyTrash: 'Empty Trash',
      restore: 'Restore',
      permanentDelete: 'Delete Forever',
      daysRemaining: '{n} days remaining',
      deleteConfirmTitle: 'Delete permanently?',
      deleteConfirmMessage: 'Delete {name} forever?',
      emptyConfirmTitle: 'Empty trash?',
      emptyConfirmMessage: 'This cannot be undone.',
    },
    actions: {
      cancel: 'Cancel',
      delete: 'Delete',
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

const now = '2026-02-20T12:00:00.000Z'

function createNote(id: string, title: string): Note {
  return {
    id,
    title,
    content: '{"type":"doc","content":[]}',
    notebook_id: null,
    folder_path: null,
    is_daily: false,
    daily_date: null,
    is_favorite: false,
    is_pinned: false,
    revision: 1,
    created_at: now,
    updated_at: now,
    deleted_at: now,
    ai_summary: null,
    tags: [],
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('TrashList', () => {
  it('limits drag-region to header strip instead of whole trash list container', () => {
    const { container } = render(
      <TrashList
        notes={[]}
        onRestore={vi.fn()}
        onPermanentDelete={vi.fn()}
        onEmptyTrash={vi.fn()}
      />
    )

    expectHeaderOnlyDragRegion({ container, rootSelector: '[data-trash-list]' })
  })

  it('keeps empty-trash action as no-drag control', () => {
    render(
      <TrashList
        notes={[createNote('note-1', 'First')]}
        onRestore={vi.fn()}
        onPermanentDelete={vi.fn()}
        onEmptyTrash={vi.fn()}
      />
    )

    const emptyTrashButton = screen.getByRole('button', { name: 'Empty Trash' })
    expectNoDragControl(emptyTrashButton)
  })
})
