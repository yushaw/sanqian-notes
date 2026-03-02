import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../path-compat', () => ({
  normalizeRelativeSlashPath: vi.fn(),
}))
vi.mock('../../database', () => ({
  getLocalNoteIdentityByPath: vi.fn(),
  getLocalNoteIdentityUidsByNotebook: vi.fn(),
  getLocalNoteMetadata: vi.fn(),
  updateLocalNoteMetadata: vi.fn(),
  ensureLocalNoteIdentity: vi.fn(),
  replaceAIPopupRefsForNote: vi.fn(),
  deleteLocalNoteMetadataByPath: vi.fn(),
  deleteLocalNoteIdentityByPath: vi.fn(),
}))
vi.mock('../../local-note-tags', () => ({
  extractLocalTagNamesFromTiptapContent: vi.fn(),
  areLocalTagNameListsEqual: vi.fn(),
}))
vi.mock('../../../shared/local-resource-id', () => ({
  createLocalResourceId: vi.fn(),
  parseLocalResourceId: vi.fn(),
}))
vi.mock('../../note-gateway', () => ({
  buildCanonicalLocalResourceId: vi.fn(),
}))
vi.mock('../../embedding', () => ({
  indexingService: { deleteNoteIndex: vi.fn() },
  getAllIndexStatus: vi.fn(),
}))
vi.mock('../../local-folder/path', () => ({
  ALLOWED_EXTENSIONS: new Set(['.md', '.txt']),
}))

import { normalizeRelativeSlashPath } from '../../path-compat'
import {
  getLocalNoteIdentityByPath,
  getLocalNoteIdentityUidsByNotebook,
  getLocalNoteMetadata,
  updateLocalNoteMetadata,
  ensureLocalNoteIdentity,
  replaceAIPopupRefsForNote,
} from '../../database'
import {
  extractLocalTagNamesFromTiptapContent,
  areLocalTagNameListsEqual,
} from '../../local-note-tags'
import { createLocalResourceId, parseLocalResourceId } from '../../../shared/local-resource-id'
import { buildCanonicalLocalResourceId } from '../../note-gateway'
import { indexingService, getAllIndexStatus } from '../../embedding'

import {
  normalizeLocalIndexSyncPath,
  resolveLocalIndexNoteId,
  deleteLegacyLocalIndexByPath,
  collectIndexedLocalNoteIdsByNotebook,
  deleteIndexedLocalNotesByNotebook,
  deleteIndexForLocalPath,
  syncLocalNoteTagsMetadata,
  syncLocalNotePopupRefs,
} from '../helpers'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('normalizeLocalIndexSyncPath', () => {
  it('returns null for null input', () => {
    expect(normalizeLocalIndexSyncPath(null)).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(normalizeLocalIndexSyncPath(undefined)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(normalizeLocalIndexSyncPath('')).toBeNull()
  })

  it('returns normalized path for valid input', () => {
    vi.mocked(normalizeRelativeSlashPath).mockReturnValue('notes/hello.md')
    expect(normalizeLocalIndexSyncPath('notes/hello.md')).toBe('notes/hello.md')
    expect(normalizeRelativeSlashPath).toHaveBeenCalledWith('notes/hello.md')
  })

  it('returns null when normalizeRelativeSlashPath returns empty string', () => {
    vi.mocked(normalizeRelativeSlashPath).mockReturnValue('')
    expect(normalizeLocalIndexSyncPath('  ')).toBeNull()
  })

  it('returns null for hidden file paths (dot-prefixed segments)', () => {
    vi.mocked(normalizeRelativeSlashPath).mockReturnValue('.hidden.md')
    expect(normalizeLocalIndexSyncPath('.hidden.md')).toBeNull()
  })

  it('returns null for paths inside hidden directories', () => {
    vi.mocked(normalizeRelativeSlashPath).mockReturnValue('.obsidian/notes.md')
    expect(normalizeLocalIndexSyncPath('.obsidian/notes.md')).toBeNull()
  })

  it('returns null for atomic-write temp files', () => {
    vi.mocked(normalizeRelativeSlashPath).mockReturnValue('.file.md.tmp-8069-1772420391486-abc123')
    expect(normalizeLocalIndexSyncPath('.file.md.tmp-8069-1772420391486-abc123')).toBeNull()
  })

  it('returns null for paths without allowed extension (directory names)', () => {
    vi.mocked(normalizeRelativeSlashPath).mockReturnValue('Ideas')
    expect(normalizeLocalIndexSyncPath('Ideas')).toBeNull()
  })

  it('returns null for paths with non-note extensions', () => {
    vi.mocked(normalizeRelativeSlashPath).mockReturnValue('image.png')
    expect(normalizeLocalIndexSyncPath('image.png')).toBeNull()
  })

  it('accepts .txt files', () => {
    vi.mocked(normalizeRelativeSlashPath).mockReturnValue('notes/readme.txt')
    expect(normalizeLocalIndexSyncPath('notes/readme.txt')).toBe('notes/readme.txt')
  })

  it('accepts .md files in subdirectories', () => {
    vi.mocked(normalizeRelativeSlashPath).mockReturnValue('Ideas/note.md')
    expect(normalizeLocalIndexSyncPath('Ideas/note.md')).toBe('Ideas/note.md')
  })
})

describe('resolveLocalIndexNoteId', () => {
  it('returns result from buildCanonicalLocalResourceId', () => {
    vi.mocked(buildCanonicalLocalResourceId).mockReturnValue('uuid-123')
    const result = resolveLocalIndexNoteId('nb-1', 'notes/hello.md')
    expect(result).toBe('uuid-123')
    expect(buildCanonicalLocalResourceId).toHaveBeenCalledWith({
      notebookId: 'nb-1',
      relativePath: 'notes/hello.md',
    })
  })
})

describe('deleteLegacyLocalIndexByPath', () => {
  it('calls deleteNoteIndex with legacy createLocalResourceId format', () => {
    vi.mocked(createLocalResourceId).mockReturnValue('local:nb-1:notes%2Fhello.md')
    deleteLegacyLocalIndexByPath('nb-1', 'notes/hello.md')
    expect(createLocalResourceId).toHaveBeenCalledWith('nb-1', 'notes/hello.md')
    expect(indexingService.deleteNoteIndex).toHaveBeenCalledWith('local:nb-1:notes%2Fhello.md')
  })
})

describe('collectIndexedLocalNoteIdsByNotebook', () => {
  it('collects legacy local:nb:path format IDs', () => {
    vi.mocked(getLocalNoteIdentityUidsByNotebook).mockReturnValue(new Set())
    vi.mocked(getAllIndexStatus).mockReturnValue([
      { noteId: 'local:nb-1:foo.md' },
      { noteId: 'local:nb-2:bar.md' },
    ] as any)
    vi.mocked(parseLocalResourceId).mockImplementation((id: string) => {
      if (id === 'local:nb-1:foo.md') return { notebookId: 'nb-1', relativePath: 'foo.md', noteUid: null, scheme: 'legacy-path' as const }
      if (id === 'local:nb-2:bar.md') return { notebookId: 'nb-2', relativePath: 'bar.md', noteUid: null, scheme: 'legacy-path' as const }
      return null
    })

    const ids = collectIndexedLocalNoteIdsByNotebook('nb-1')
    expect(ids).toEqual(new Set(['local:nb-1:foo.md']))
  })

  it('collects UUID format IDs via identity UIDs', () => {
    vi.mocked(getLocalNoteIdentityUidsByNotebook).mockReturnValue(new Set(['uuid-1', 'uuid-2']))
    vi.mocked(getAllIndexStatus).mockReturnValue([
      { noteId: 'uuid-1' },
      { noteId: 'uuid-3' },
    ] as any)
    vi.mocked(parseLocalResourceId).mockReturnValue(null)

    const ids = collectIndexedLocalNoteIdsByNotebook('nb-1')
    expect(ids).toEqual(new Set(['uuid-1']))
  })

  it('collects both legacy and UUID format IDs', () => {
    vi.mocked(getLocalNoteIdentityUidsByNotebook).mockReturnValue(new Set(['uuid-1']))
    vi.mocked(getAllIndexStatus).mockReturnValue([
      { noteId: 'local:nb-1:foo.md' },
      { noteId: 'uuid-1' },
    ] as any)
    vi.mocked(parseLocalResourceId).mockImplementation((id: string) => {
      if (id === 'local:nb-1:foo.md') return { notebookId: 'nb-1', relativePath: 'foo.md', noteUid: null, scheme: 'legacy-path' as const }
      return null
    })

    const ids = collectIndexedLocalNoteIdsByNotebook('nb-1')
    expect(ids).toEqual(new Set(['local:nb-1:foo.md', 'uuid-1']))
  })

  it('returns empty set when no indexes exist', () => {
    vi.mocked(getLocalNoteIdentityUidsByNotebook).mockReturnValue(new Set())
    vi.mocked(getAllIndexStatus).mockReturnValue([])

    const ids = collectIndexedLocalNoteIdsByNotebook('nb-1')
    expect(ids.size).toBe(0)
  })

  it('returns empty set and warns on error', () => {
    vi.mocked(getLocalNoteIdentityUidsByNotebook).mockImplementation(() => {
      throw new Error('DB error')
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const ids = collectIndexedLocalNoteIdsByNotebook('nb-1')
    expect(ids.size).toBe(0)
    expect(warnSpy).toHaveBeenCalledWith(
      '[LocalIndex] Failed to list indexed status:',
      expect.any(Error)
    )
    warnSpy.mockRestore()
  })
})

describe('deleteIndexedLocalNotesByNotebook', () => {
  it('deletes all collected IDs via indexingService.deleteNoteIndex', () => {
    vi.mocked(getLocalNoteIdentityUidsByNotebook).mockReturnValue(new Set(['uuid-1']))
    vi.mocked(getAllIndexStatus).mockReturnValue([
      { noteId: 'local:nb-1:foo.md' },
      { noteId: 'uuid-1' },
    ] as any)
    vi.mocked(parseLocalResourceId).mockImplementation((id: string) => {
      if (id === 'local:nb-1:foo.md') return { notebookId: 'nb-1', relativePath: 'foo.md', noteUid: null, scheme: 'legacy-path' as const }
      return null
    })

    deleteIndexedLocalNotesByNotebook('nb-1')
    expect(indexingService.deleteNoteIndex).toHaveBeenCalledWith('local:nb-1:foo.md')
    expect(indexingService.deleteNoteIndex).toHaveBeenCalledWith('uuid-1')
    expect(indexingService.deleteNoteIndex).toHaveBeenCalledTimes(2)
  })
})

describe('deleteIndexForLocalPath', () => {
  beforeEach(() => {
    vi.mocked(normalizeRelativeSlashPath).mockImplementation((p: string) => p)
    vi.mocked(createLocalResourceId).mockReturnValue('local:nb-1:foo.md')
  })

  it('does nothing when path normalizes to null', () => {
    vi.mocked(normalizeRelativeSlashPath).mockReturnValue('')
    deleteIndexForLocalPath('nb-1', '')
    expect(indexingService.deleteNoteIndex).not.toHaveBeenCalled()
  })

  it('deletes by provided noteUid and legacy ID', () => {
    deleteIndexForLocalPath('nb-1', 'foo.md', { noteUid: 'uuid-42' })
    expect(indexingService.deleteNoteIndex).toHaveBeenCalledWith('uuid-42')
    expect(indexingService.deleteNoteIndex).toHaveBeenCalledWith('local:nb-1:foo.md')
  })

  it('falls back to identity lookup when noteUid not provided', () => {
    vi.mocked(getLocalNoteIdentityByPath).mockReturnValue({ note_uid: 'uuid-from-db' } as any)
    deleteIndexForLocalPath('nb-1', 'foo.md')
    expect(getLocalNoteIdentityByPath).toHaveBeenCalledWith({
      notebook_id: 'nb-1',
      relative_path: 'foo.md',
    })
    expect(indexingService.deleteNoteIndex).toHaveBeenCalledWith('uuid-from-db')
    expect(indexingService.deleteNoteIndex).toHaveBeenCalledWith('local:nb-1:foo.md')
  })

  it('only deletes legacy ID when no identity found and no noteUid', () => {
    vi.mocked(getLocalNoteIdentityByPath).mockReturnValue(null)
    deleteIndexForLocalPath('nb-1', 'foo.md')
    expect(indexingService.deleteNoteIndex).toHaveBeenCalledTimes(1)
    expect(indexingService.deleteNoteIndex).toHaveBeenCalledWith('local:nb-1:foo.md')
  })
})

describe('syncLocalNoteTagsMetadata', () => {
  beforeEach(() => {
    vi.mocked(normalizeRelativeSlashPath).mockImplementation((p: string) => p)
  })

  it('skips when path normalizes to null', () => {
    vi.mocked(normalizeRelativeSlashPath).mockReturnValue('')
    syncLocalNoteTagsMetadata('nb-1', '', '{}')
    expect(extractLocalTagNamesFromTiptapContent).not.toHaveBeenCalled()
  })

  it('skips when tags are equal', () => {
    vi.mocked(extractLocalTagNamesFromTiptapContent).mockReturnValue(['tag1'])
    vi.mocked(getLocalNoteMetadata).mockReturnValue({ tags: ['tag1'] } as any)
    vi.mocked(areLocalTagNameListsEqual).mockReturnValue(true)

    syncLocalNoteTagsMetadata('nb-1', 'foo.md', '{"content":"test"}')
    expect(updateLocalNoteMetadata).not.toHaveBeenCalled()
  })

  it('updates when tags differ', () => {
    vi.mocked(extractLocalTagNamesFromTiptapContent).mockReturnValue(['tag1', 'tag2'])
    vi.mocked(getLocalNoteMetadata).mockReturnValue({ tags: ['tag1'] } as any)
    vi.mocked(areLocalTagNameListsEqual).mockReturnValue(false)

    syncLocalNoteTagsMetadata('nb-1', 'foo.md', '{"content":"test"}')
    expect(updateLocalNoteMetadata).toHaveBeenCalledWith({
      notebook_id: 'nb-1',
      relative_path: 'foo.md',
      tags: ['tag1', 'tag2'],
    })
  })
})

describe('syncLocalNotePopupRefs', () => {
  beforeEach(() => {
    vi.mocked(normalizeRelativeSlashPath).mockImplementation((p: string) => p)
  })

  it('skips when path normalizes to null', () => {
    vi.mocked(normalizeRelativeSlashPath).mockReturnValue('')
    syncLocalNotePopupRefs('nb-1', '', '{}')
    expect(ensureLocalNoteIdentity).not.toHaveBeenCalled()
  })

  it('skips when identity has no note_uid', () => {
    vi.mocked(ensureLocalNoteIdentity).mockReturnValue(null as any)
    syncLocalNotePopupRefs('nb-1', 'foo.md', '{}')
    expect(replaceAIPopupRefsForNote).not.toHaveBeenCalled()
  })

  it('syncs popup refs with correct note_uid', () => {
    vi.mocked(ensureLocalNoteIdentity).mockReturnValue({ note_uid: 'uuid-99' } as any)
    const content = '{"type":"doc"}'
    syncLocalNotePopupRefs('nb-1', 'foo.md', content)
    expect(replaceAIPopupRefsForNote).toHaveBeenCalledWith({
      note_id: 'uuid-99',
      source_type: 'local-folder',
      tiptap_content: content,
    })
  })
})
