import { describe, expect, it } from 'vitest'
import type { LocalFolderSearchHit, LocalNoteMetadata, Note, Notebook } from '../../types/note'
import { buildLocalSearchResultNote, mergeGlobalSearchResults, shouldIncludeLocalInGlobalSearch } from '../globalSearch'

const now = '2026-02-25T12:00:00.000Z'

function createInternalNote(id: string, updatedAt: string): Note {
  return {
    id,
    title: id,
    content: '[]',
    notebook_id: null,
    folder_path: null,
    is_daily: false,
    daily_date: null,
    is_favorite: false,
    is_pinned: false,
    revision: 1,
    created_at: now,
    updated_at: updatedAt,
    deleted_at: null,
    ai_summary: null,
    tags: [],
  }
}

describe('globalSearch helpers', () => {
  it('decides whether local results should be included', () => {
    expect(shouldIncludeLocalInGlobalSearch(null, null)).toBe(true)
    expect(shouldIncludeLocalInGlobalSearch(null, 'all')).toBe(true)
    expect(shouldIncludeLocalInGlobalSearch(null, 'recent')).toBe(true)
    expect(shouldIncludeLocalInGlobalSearch(null, 'favorites')).toBe(true)
    expect(shouldIncludeLocalInGlobalSearch(null, 'daily')).toBe(false)
    expect(shouldIncludeLocalInGlobalSearch(null, 'trash')).toBe(false)
    expect(shouldIncludeLocalInGlobalSearch('nb-1', 'all')).toBe(false)
  })

  it('builds local search note with local id and path summary', () => {
    const hit: LocalFolderSearchHit = {
      notebook_id: 'local-nb',
      relative_path: 'foo/bar/a.md',
      canonical_path: '/a/b/c',
      score: 10,
      mtime_ms: Date.parse('2026-02-25T08:00:00.000Z'),
      snippet: 'hello',
    }

    const note = buildLocalSearchResultNote(hit, new Map([['local-nb', 'Work']]))
    expect(note.id).toBe('local:local-nb:foo%2Fbar%2Fa.md')
    expect(note.title).toBe('a')
    expect(note.ai_summary).toBe('Work · foo/bar/a.md')
    expect(note.content).toContain('hello')
  })

  it('applies local metadata on search results', () => {
    const hit: LocalFolderSearchHit = {
      notebook_id: 'local-nb',
      relative_path: 'foo/bar/a.md',
      canonical_path: '/a/b/c',
      score: 10,
      mtime_ms: Date.parse('2026-02-25T08:00:00.000Z'),
      snippet: 'hello',
    }
    const metadataById: Record<string, LocalNoteMetadata> = {
      'local:local-nb:foo%2Fbar%2Fa.md': {
        notebook_id: 'local-nb',
        relative_path: 'foo/bar/a.md',
        is_favorite: true,
        is_pinned: true,
        ai_summary: 'metadata summary',
        updated_at: now,
      },
    }

    const note = buildLocalSearchResultNote(hit, new Map([['local-nb', 'Work']]), metadataById)
    expect(note.is_favorite).toBe(true)
    expect(note.is_pinned).toBe(true)
    expect(note.ai_summary).toBe('metadata summary')
    expect(note.content).toContain('metadata summary')
  })

  it('merges internal and local results with stable ordering', () => {
    const internalResults = [
      createInternalNote('n-2', '2026-02-25T09:00:00.000Z'),
      createInternalNote('n-1', '2026-02-25T09:00:00.000Z'),
    ]
    const localHits: LocalFolderSearchHit[] = [
      {
        notebook_id: 'local-nb',
        relative_path: 'x.md',
        canonical_path: '/x',
        score: 1,
        mtime_ms: Date.parse('2026-02-25T10:00:00.000Z'),
        snippet: 'x',
      },
      {
        notebook_id: 'local-nb',
        relative_path: 'y.md',
        canonical_path: '/y',
        score: 1,
        mtime_ms: Date.parse('2026-02-25T09:00:00.000Z'),
        snippet: 'y',
      },
    ]
    const notebooks: Notebook[] = [
      {
        id: 'local-nb',
        name: 'Local',
        source_type: 'local-folder',
        order_index: 0,
        created_at: now,
      },
    ]

    const merged = mergeGlobalSearchResults(internalResults, localHits, notebooks, 'all')
    expect(merged.map((note) => note.id)).toEqual([
      'n-2',
      'n-1',
      'local:local-nb:x.md',
      'local:local-nb:y.md',
    ])
  })

  it('keeps only favorited local hits in favorites view', () => {
    const localHits: LocalFolderSearchHit[] = [
      {
        notebook_id: 'local-nb',
        relative_path: 'fav.md',
        canonical_path: '/fav',
        score: 10,
        mtime_ms: Date.parse('2026-02-25T10:00:00.000Z'),
        snippet: 'fav',
      },
      {
        notebook_id: 'local-nb',
        relative_path: 'normal.md',
        canonical_path: '/normal',
        score: 9,
        mtime_ms: Date.parse('2026-02-25T09:00:00.000Z'),
        snippet: 'normal',
      },
    ]
    const metadataById: Record<string, LocalNoteMetadata> = {
      'local:local-nb:fav.md': {
        notebook_id: 'local-nb',
        relative_path: 'fav.md',
        is_favorite: true,
        is_pinned: false,
        ai_summary: null,
        updated_at: now,
      },
    }

    const merged = mergeGlobalSearchResults([], localHits, [{
      id: 'local-nb',
      name: 'Local',
      source_type: 'local-folder',
      order_index: 0,
      created_at: now,
    }], 'favorites', metadataById)

    expect(merged.map((note) => note.id)).toEqual(['local:local-nb:fav.md'])
  })
})
