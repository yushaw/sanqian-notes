import { describe, expect, it } from 'vitest'
import type { LocalFolderTreeResult, LocalNoteMetadata, Note, Notebook, NotebookStatus } from '../../types/note'
import { buildAllSourceLocalNotes, buildAllSourceNotes, mergeAllSourceNotes } from '../allSourceNotes'

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
    isPinned?: boolean
    isDaily?: boolean
    updatedAt?: string
  }
): Note {
  return {
    id,
    title: id,
    content: '[]',
    notebook_id: null,
    folder_path: null,
    is_daily: options?.isDaily ?? false,
    daily_date: null,
    is_favorite: false,
    is_pinned: options?.isPinned ?? false,
    revision: 1,
    created_at: now,
    updated_at: options?.updatedAt ?? now,
    deleted_at: null,
    ai_summary: null,
    tags: [],
  }
}

function createLocalTree(notebookId: string, files: Array<{ relativePath: string; mtimeMs: number }>): LocalFolderTreeResult {
  return {
    notebook_id: notebookId,
    root_path: `/tmp/${notebookId}`,
    scanned_at: now,
    tree: [],
    files: files.map((file, index) => ({
      id: `${notebookId}-${index}`,
      name: file.relativePath.split('/').pop() || file.relativePath,
      file_name: file.relativePath.split('/').pop() || file.relativePath,
      relative_path: file.relativePath,
      folder_relative_path: '',
      folder_depth: 0,
      extension: 'md',
      size: 100,
      mtime_ms: file.mtimeMs,
      root_path: `/tmp/${notebookId}`,
    })),
  }
}

describe('buildAllSourceNotes', () => {
  it('merges internal and local notes for all view and excludes daily notes', () => {
    const notes = [
      createNote('i-1', { updatedAt: '2026-02-26T11:00:00.000Z' }),
      createNote('i-daily', { isDaily: true, updatedAt: '2026-02-26T12:00:00.000Z' }),
    ]
    const notebooks = [
      createNotebook('internal-1', 'internal'),
      createNotebook('local-1', 'local-folder'),
    ]

    const result = buildAllSourceNotes({
      notes,
      notebooks,
      localFolderTreeCache: {
        'local-1': createLocalTree('local-1', [
          { relativePath: 'folder/local-a.md', mtimeMs: Date.parse('2026-02-26T10:00:00.000Z') },
        ]),
      },
      localFolderStatuses: {
        'local-1': 'active',
      },
    })

    expect(result.map((note) => note.id)).toEqual([
      'i-1',
      'local:local-1:folder%2Flocal-a.md',
    ])
  })

  it('keeps pinned internal notes above local notes', () => {
    const notes = [
      createNote('i-normal', { updatedAt: '2026-02-26T11:00:00.000Z' }),
      createNote('i-pinned', { isPinned: true, updatedAt: '2026-02-20T11:00:00.000Z' }),
    ]
    const notebooks = [
      createNotebook('local-1', 'local-folder'),
    ]

    const result = buildAllSourceNotes({
      notes,
      notebooks,
      localFolderTreeCache: {
        'local-1': createLocalTree('local-1', [
          { relativePath: 'local-latest.md', mtimeMs: Date.parse('2026-02-26T12:00:00.000Z') },
        ]),
      },
      localFolderStatuses: {
        'local-1': 'active',
      },
    })

    expect(result.map((note) => note.id)).toEqual([
      'i-pinned',
      'local:local-1:local-latest.md',
      'i-normal',
    ])
  })

  it('excludes local notes when notebook status is not active', () => {
    const notes = [createNote('i-1')]
    const notebooks = [createNotebook('local-1', 'local-folder')]

    const statuses: Record<string, NotebookStatus> = { 'local-1': 'missing' }
    const result = buildAllSourceNotes({
      notes,
      notebooks,
      localFolderTreeCache: {
        'local-1': createLocalTree('local-1', [
          { relativePath: 'local-hidden.md', mtimeMs: Date.parse('2026-02-26T12:00:00.000Z') },
        ]),
      },
      localFolderStatuses: statuses,
    })

    expect(result.map((note) => note.id)).toEqual(['i-1'])
  })

  it('builds local notes only from active local notebooks', () => {
    const notebooks = [
      createNotebook('internal-1', 'internal'),
      createNotebook('local-active', 'local-folder'),
      createNotebook('local-missing', 'local-folder'),
    ]

    const localOnly = buildAllSourceLocalNotes({
      notebooks,
      localFolderTreeCache: {
        'local-active': createLocalTree('local-active', [
          { relativePath: 'folder/a.md', mtimeMs: Date.parse('2026-02-26T10:00:00.000Z') },
        ]),
        'local-missing': createLocalTree('local-missing', [
          { relativePath: 'folder/b.md', mtimeMs: Date.parse('2026-02-26T10:00:00.000Z') },
        ]),
      },
      localFolderStatuses: {
        'local-active': 'active',
        'local-missing': 'missing',
      },
    })

    expect(localOnly.map((note) => note.id)).toEqual([
      'local:local-active:folder%2Fa.md',
    ])
  })

  it('keeps local notes when status snapshot is temporarily missing', () => {
    const localOnly = buildAllSourceLocalNotes({
      notebooks: [createNotebook('local-1', 'local-folder')],
      localFolderTreeCache: {
        'local-1': createLocalTree('local-1', [
          { relativePath: 'folder/a.md', mtimeMs: Date.parse('2026-02-26T10:00:00.000Z') },
        ]),
      },
      localFolderStatuses: {},
    })

    expect(localOnly.map((note) => note.id)).toEqual([
      'local:local-1:folder%2Fa.md',
    ])
  })

  it('merges internal and local notes with all-source ordering', () => {
    const internalNotes = [
      createNote('i-pinned', { isPinned: true, updatedAt: '2026-02-20T11:00:00.000Z' }),
      createNote('i-normal', { updatedAt: '2026-02-26T11:00:00.000Z' }),
    ]
    const localNotes = buildAllSourceLocalNotes({
      notebooks: [createNotebook('local-1', 'local-folder')],
      localFolderTreeCache: {
        'local-1': createLocalTree('local-1', [
          { relativePath: 'local-latest.md', mtimeMs: Date.parse('2026-02-26T12:00:00.000Z') },
        ]),
      },
      localFolderStatuses: {
        'local-1': 'active',
      },
    })

    const merged = mergeAllSourceNotes(internalNotes, localNotes)

    expect(merged.map((note) => note.id)).toEqual([
      'i-pinned',
      'local:local-1:local-latest.md',
      'i-normal',
    ])
  })

  it('applies local metadata to synthesized local notes', () => {
    const localId = 'local:local-1:folder%2Fa.md'
    const metadata: Record<string, LocalNoteMetadata> = {
      [localId]: {
        notebook_id: 'local-1',
        relative_path: 'folder/a.md',
        is_favorite: true,
        is_pinned: true,
        ai_summary: 'metadata summary',
        updated_at: now,
      },
    }

    const localOnly = buildAllSourceLocalNotes({
      notebooks: [createNotebook('local-1', 'local-folder')],
      localFolderTreeCache: {
        'local-1': createLocalTree('local-1', [
          { relativePath: 'folder/a.md', mtimeMs: Date.parse('2026-02-26T10:00:00.000Z') },
        ]),
      },
      localFolderStatuses: {
        'local-1': 'active',
      },
      localNoteMetadataById: metadata,
    })

    expect(localOnly).toHaveLength(1)
    expect(localOnly[0].id).toBe(localId)
    expect(localOnly[0].is_favorite).toBe(true)
    expect(localOnly[0].is_pinned).toBe(true)
    expect(localOnly[0].ai_summary).toBe('metadata summary')
  })
})
