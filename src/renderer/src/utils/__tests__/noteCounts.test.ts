import { describe, expect, it } from 'vitest'
import type { LocalFolderTreeResult, Note, Notebook } from '../../types/note'
import { buildNotebookNoteCounts, buildSmartViewNoteCounts, sumLocalNotebookCounts } from '../noteCounts'

const now = '2026-02-26T12:00:00.000Z'

function createNotebook(
  id: string,
  sourceType: Notebook['source_type']
): Notebook {
  return {
    id,
    name: id,
    source_type: sourceType,
    order_index: 0,
    created_at: now,
  }
}

function createNote(
  id: string,
  options?: {
    notebookId?: string
    isDaily?: boolean
    dailyDate?: string | null
    isFavorite?: boolean
    updatedAt?: string
  }
): Note {
  return {
    id,
    title: id,
    content: '[]',
    notebook_id: options?.notebookId ?? null,
    folder_path: null,
    is_daily: options?.isDaily ?? false,
    daily_date: options?.dailyDate ?? null,
    is_favorite: options?.isFavorite ?? false,
    is_pinned: false,
    revision: 1,
    created_at: now,
    updated_at: options?.updatedAt ?? now,
    deleted_at: null,
    ai_summary: null,
    tags: [],
  }
}

function createLocalTree(notebookId: string, fileCount: number): LocalFolderTreeResult {
  return {
    notebook_id: notebookId,
    root_path: `/tmp/${notebookId}`,
    scanned_at: now,
    tree: [],
    files: Array.from({ length: fileCount }, (_, index) => ({
      id: `${notebookId}-${index + 1}`,
      name: `note-${index + 1}`,
      file_name: `note-${index + 1}.md`,
      relative_path: `note-${index + 1}.md`,
      folder_relative_path: '',
      folder_depth: 0,
      extension: 'md',
      size: 100,
      mtime_ms: Date.parse(now),
      root_path: `/tmp/${notebookId}`,
    })),
  }
}

describe('noteCounts helpers', () => {
  it('builds notebook counts with local priority: live tree > cache > fallback', () => {
    const regularNotes = [
      createNote('n-1', { notebookId: 'internal-1' }),
      createNote('n-2', { notebookId: 'internal-1' }),
      createNote('n-3', { notebookId: 'internal-2' }),
    ]
    const notebooks = [
      createNotebook('internal-1', 'internal'),
      createNotebook('internal-2', 'internal'),
      createNotebook('local-live', 'local-folder'),
      createNotebook('local-cache', 'local-folder'),
      createNotebook('local-fallback', 'local-folder'),
    ]

    const counts = buildNotebookNoteCounts(notebooks, regularNotes, {
      localFolderTree: createLocalTree('local-live', 4),
      localFolderTreeCache: {
        'local-live': createLocalTree('local-live', 7),
        'local-cache': createLocalTree('local-cache', 3),
      },
      localNotebookNoteCounts: {
        'local-fallback': 2,
      },
    })

    expect(counts).toEqual({
      'internal-1': 2,
      'internal-2': 1,
      'local-live': 4,
      'local-cache': 3,
      'local-fallback': 2,
    })
  })

  it('calculates all smart view count as internal regular notes plus local totals', () => {
    const notes = [
      createNote('n-1', {
        notebookId: 'internal-1',
        updatedAt: '2026-02-26T11:00:00.000Z',
      }),
      createNote('n-2', {
        notebookId: 'internal-1',
        updatedAt: '2026-02-20T11:00:00.000Z',
        isFavorite: true,
      }),
      createNote('d-1', {
        notebookId: 'internal-1',
        isDaily: true,
        dailyDate: '2026-02-26',
        isFavorite: true,
        updatedAt: '2026-02-26T07:00:00.000Z',
      }),
    ]
    const notebooks = [
      createNotebook('internal-1', 'internal'),
      createNotebook('local-live', 'local-folder'),
      createNotebook('local-cache', 'local-folder'),
      createNotebook('local-fallback', 'local-folder'),
    ]

    const counts = buildSmartViewNoteCounts({
      notes,
      notebooks,
      trashCount: 5,
      recentThresholdMs: Date.parse('2026-02-24T00:00:00.000Z'),
      localFolderTree: createLocalTree('local-live', 4),
      localFolderTreeCache: {
        'local-cache': createLocalTree('local-cache', 3),
      },
      localNotebookNoteCounts: {
        'local-fallback': 2,
      },
    })

    expect(counts).toEqual({
      all: 11,
      daily: 1,
      recent: 1,
      favorites: 2,
      trash: 5,
      notebooks: {
        'internal-1': 2,
        'local-live': 4,
        'local-cache': 3,
        'local-fallback': 2,
      },
    })
  })

  it('sums only local notebook counts', () => {
    const notebooks = [
      createNotebook('internal-1', 'internal'),
      createNotebook('local-1', 'local-folder'),
      createNotebook('local-2', 'local-folder'),
    ]

    const localTotal = sumLocalNotebookCounts(notebooks, {
      'internal-1': 99,
      'local-1': 4,
      'local-2': 6,
    })

    expect(localTotal).toBe(10)
  })

  it('treats non-active local notebooks as zero in counts', () => {
    const notes = [
      createNote('n-1', { notebookId: 'internal-1' }),
    ]
    const notebooks = [
      createNotebook('internal-1', 'internal'),
      createNotebook('local-missing', 'local-folder'),
    ]

    const counts = buildSmartViewNoteCounts({
      notes,
      notebooks,
      trashCount: 0,
      recentThresholdMs: Date.parse('2026-02-01T00:00:00.000Z'),
      localFolderTree: null,
      localFolderTreeCache: {
        'local-missing': createLocalTree('local-missing', 5),
      },
      localNotebookNoteCounts: {
        'local-missing': 5,
      },
      localFolderStatuses: {
        'local-missing': 'missing',
      },
    })

    expect(counts).toEqual({
      all: 1,
      daily: 0,
      recent: 1,
      favorites: 0,
      trash: 0,
      notebooks: {
        'internal-1': 1,
        'local-missing': 0,
      },
    })
  })

  it('does not use persisted fallback count for active notebook without fresh tree cache', () => {
    const notes = [createNote('n-1', { notebookId: 'internal-1' })]
    const notebooks = [
      createNotebook('internal-1', 'internal'),
      createNotebook('local-active', 'local-folder'),
    ]

    const counts = buildSmartViewNoteCounts({
      notes,
      notebooks,
      trashCount: 0,
      recentThresholdMs: Date.parse('2026-02-01T00:00:00.000Z'),
      localFolderTree: null,
      localFolderTreeCache: {},
      localNotebookNoteCounts: {
        'local-active': 9,
      },
      localFolderStatuses: {
        'local-active': 'active',
      },
    })

    expect(counts).toEqual({
      all: 1,
      daily: 0,
      recent: 1,
      favorites: 0,
      trash: 0,
      notebooks: {
        'internal-1': 1,
        'local-active': 0,
      },
    })
  })

  it('supports localFavoriteCount override when local note snapshots are unavailable', () => {
    const notes = [createNote('n-1', { notebookId: 'internal-1' })]
    const notebooks = [
      createNotebook('internal-1', 'internal'),
      createNotebook('local-1', 'local-folder'),
    ]

    const counts = buildSmartViewNoteCounts({
      notes,
      notebooks,
      trashCount: 0,
      recentThresholdMs: Date.parse('2026-02-01T00:00:00.000Z'),
      localFolderTree: null,
      localFolderTreeCache: {},
      localNotebookNoteCounts: { 'local-1': 0 },
      localFavoriteCount: 2,
    })

    expect(counts.favorites).toBe(2)
  })
})
