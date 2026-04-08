import { describe, expect, it } from 'vitest'
import type { LocalNoteMetadata, Note } from '../../types/note'
import {
  applyLocalNoteMetadataToNote,
  buildLocalNoteMetadataMap,
  normalizeLocalRelativePath,
} from '../localFolderNavigation'

const now = '2026-02-26T12:00:00.000Z'

function createLocalNote(id: string): Note {
  return {
    id,
    title: 'Local Note',
    content: '{}',
    notebook_id: 'local-nb',
    folder_path: null,
    is_daily: false,
    daily_date: null,
    is_favorite: false,
    is_pinned: false,
    revision: 0,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    ai_summary: 'fallback summary',
    tags: [{ id: 'local-tag:old', name: 'Old', source: 'user' }],
  }
}

describe('localFolderNavigation metadata helpers', () => {
  it('normalizes slash and dot aliases for local relative paths', () => {
    expect(normalizeLocalRelativePath('./docs//notes/./a.md')).toBe('docs/notes/a.md')
  })

  it('preserves parent traversal segments when normalizing local relative paths', () => {
    expect(normalizeLocalRelativePath('docs/../notes/a.md')).toBe('docs/../notes/a.md')
  })

  it('preserves leading and trailing spaces in path segments', () => {
    expect(normalizeLocalRelativePath(' folder/note.md ')).toBe(' folder/note.md ')
  })

  it('returns null for blank local relative paths', () => {
    expect(normalizeLocalRelativePath(' \t ')).toBeNull()
  })

  it('keeps tags-only metadata rows in local metadata map', () => {
    const items: LocalNoteMetadata[] = [{
      notebook_id: 'local-nb',
      relative_path: 'folder/a.md',
      is_favorite: false,
      is_pinned: false,
      ai_summary: null,
      tags: ['Project'],
      updated_at: now,
    }]

    const mapped = buildLocalNoteMetadataMap(items)
    expect(mapped['local:local-nb:folder%2Fa.md']).toBeDefined()
  })

  it('applies metadata tags to local note when metadata includes tags', () => {
    const note = createLocalNote('local:local-nb:folder%2Fa.md')
    const metadataById: Record<string, LocalNoteMetadata> = {
      'local:local-nb:folder%2Fa.md': {
        notebook_id: 'local-nb',
        relative_path: 'folder/a.md',
        is_favorite: true,
        is_pinned: true,
        ai_summary: 'summary',
        tags: ['Project', 'AI'],
        updated_at: now,
      },
    }

    const updated = applyLocalNoteMetadataToNote(note, metadataById)
    expect(updated.is_favorite).toBe(true)
    expect(updated.is_pinned).toBe(true)
    expect(updated.ai_summary).toBe('summary')
    expect(updated.tags).toEqual([
      { id: 'local-tag:user:project', name: 'Project', source: 'user' },
      { id: 'local-tag:user:ai', name: 'AI', source: 'user' },
    ])
  })

  it('preserves original note tags when metadata row has no tags', () => {
    const note = createLocalNote('local:local-nb:folder%2Fa.md')
    const metadataById: Record<string, LocalNoteMetadata> = {
      'local:local-nb:folder%2Fa.md': {
        notebook_id: 'local-nb',
        relative_path: 'folder/a.md',
        is_favorite: true,
        is_pinned: false,
        ai_summary: null,
        tags: [],
        updated_at: now,
      },
    }

    const updated = applyLocalNoteMetadataToNote(note, metadataById)
    expect(updated.tags).toEqual(note.tags)
  })
})
