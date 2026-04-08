import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../path-compat', () => ({
  normalizeRelativeSlashPath: vi.fn(),
}))
vi.mock('../../database', () => ({
  getLocalNoteIdentityByPath: vi.fn(),
  getLocalNoteIdentityUidsByNotebook: vi.fn(),
  getLocalNoteMetadata: vi.fn(),
  updateLocalNoteMetadata: vi.fn(),
  updateLocalNoteTagsBatch: vi.fn(),
  ensureLocalNoteIdentity: vi.fn(),
  replaceAIPopupRefsForNote: vi.fn(),
  replaceAIPopupRefsForNotesBatch: vi.fn(),
  deleteLocalNoteMetadataByPath: vi.fn(),
  deleteLocalNoteIdentityByPath: vi.fn(),
}))
vi.mock('../../local-note-tags', () => ({
  extractLocalTagNamesFromTiptapContent: vi.fn(),
  areLocalTagNameListsEqual: vi.fn(),
}))
vi.mock('../../../shared/local-resource-id', () => ({
  buildLocalResourceIdPrefix: vi.fn(),
  createLocalResourceId: vi.fn(),
}))
vi.mock('../../note-gateway', () => ({
  buildCanonicalLocalResourceId: vi.fn(),
}))
vi.mock('../../embedding', () => ({
  indexingService: { deleteNoteIndex: vi.fn() },
  getIndexedNoteIdsByPrefix: vi.fn(),
  getIndexedExistingNoteIds: vi.fn(),
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
  updateLocalNoteTagsBatch,
  ensureLocalNoteIdentity,
  replaceAIPopupRefsForNote,
  replaceAIPopupRefsForNotesBatch,
} from '../../database'
import {
  extractLocalTagNamesFromTiptapContent,
  areLocalTagNameListsEqual,
} from '../../local-note-tags'
import { buildLocalResourceIdPrefix, createLocalResourceId } from '../../../shared/local-resource-id'
import { buildCanonicalLocalResourceId } from '../../note-gateway'
import {
  indexingService,
  getIndexedNoteIdsByPrefix,
  getIndexedExistingNoteIds,
} from '../../embedding'

import {
  normalizeLocalIndexSyncPath,
  resolveLocalIndexNoteId,
  deleteLegacyLocalIndexByPath,
  collectIndexedLocalNoteIdsByNotebook,
  deleteIndexedLocalNotesByNotebook,
  deleteIndexForLocalPath,
  syncLocalNoteTagsMetadata,
  syncLocalNoteTagsMetadataBatch,
  syncLocalNotePopupRefs,
  syncLocalNotePopupRefsBatch,
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
  it('collects canonical local ids by prefix', () => {
    vi.mocked(getLocalNoteIdentityUidsByNotebook).mockReturnValue(new Set())
    vi.mocked(buildLocalResourceIdPrefix).mockReturnValue('local:nb-1:')
    vi.mocked(getIndexedNoteIdsByPrefix)
      .mockReturnValueOnce(['local:nb-1:foo.md'])
      .mockReturnValueOnce([])
    vi.mocked(getIndexedExistingNoteIds).mockReturnValue([])

    const ids = collectIndexedLocalNoteIdsByNotebook('nb-1')
    expect(ids).toEqual(new Set(['local:nb-1:foo.md']))
    expect(buildLocalResourceIdPrefix).toHaveBeenCalledWith('nb-1')
    expect(getIndexedNoteIdsByPrefix).toHaveBeenCalledWith('local:nb-1:')
    expect(getIndexedNoteIdsByPrefix).toHaveBeenCalledWith('nb-1:')
  })

  it('collects legacy notebook:path ids by legacy prefix', () => {
    vi.mocked(getLocalNoteIdentityUidsByNotebook).mockReturnValue(new Set())
    vi.mocked(buildLocalResourceIdPrefix).mockReturnValue('local:nb-1:')
    vi.mocked(getIndexedNoteIdsByPrefix)
      .mockReturnValueOnce([])
      .mockReturnValueOnce(['nb-1:legacy.md'])
    vi.mocked(getIndexedExistingNoteIds).mockReturnValue([])

    const ids = collectIndexedLocalNoteIdsByNotebook('nb-1')
    expect(ids).toEqual(new Set(['nb-1:legacy.md']))
  })

  it('collects UUID ids via identity exact-match query', () => {
    vi.mocked(getLocalNoteIdentityUidsByNotebook).mockReturnValue(new Set(['uuid-1']))
    vi.mocked(buildLocalResourceIdPrefix).mockReturnValue('local:nb-1:')
    vi.mocked(getIndexedNoteIdsByPrefix)
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
    vi.mocked(getIndexedExistingNoteIds).mockReturnValue(['uuid-1'])

    const ids = collectIndexedLocalNoteIdsByNotebook('nb-1')
    expect(ids).toEqual(new Set(['uuid-1']))
    expect(getIndexedExistingNoteIds).toHaveBeenCalledWith(['uuid-1'])
  })

  it('collects canonical, legacy and UUID ids together', () => {
    vi.mocked(getLocalNoteIdentityUidsByNotebook).mockReturnValue(new Set(['uuid-1']))
    vi.mocked(buildLocalResourceIdPrefix).mockReturnValue('local:nb-1:')
    vi.mocked(getIndexedNoteIdsByPrefix)
      .mockReturnValueOnce(['local:nb-1:foo.md'])
      .mockReturnValueOnce(['nb-1:legacy.md'])
    vi.mocked(getIndexedExistingNoteIds).mockReturnValue(['uuid-1'])

    const ids = collectIndexedLocalNoteIdsByNotebook('nb-1')
    expect(ids).toEqual(new Set(['local:nb-1:foo.md', 'nb-1:legacy.md', 'uuid-1']))
  })

  it('returns empty set when no indexes exist', () => {
    vi.mocked(getLocalNoteIdentityUidsByNotebook).mockReturnValue(new Set())
    vi.mocked(buildLocalResourceIdPrefix).mockReturnValue('local:nb-1:')
    vi.mocked(getIndexedNoteIdsByPrefix)
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
    vi.mocked(getIndexedExistingNoteIds).mockReturnValue([])

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

  it('uses encoded canonical prefix for notebook ids containing colon', () => {
    vi.mocked(getLocalNoteIdentityUidsByNotebook).mockReturnValue(new Set())
    vi.mocked(buildLocalResourceIdPrefix).mockReturnValue('local:nbenc:team%3Aproject:')
    vi.mocked(getIndexedNoteIdsByPrefix)
      .mockReturnValueOnce(['local:nbenc:team%3Aproject:foo.md'])
      .mockReturnValueOnce(['local:team:project:legacy-canonical.md'])
      .mockReturnValueOnce([])
    vi.mocked(getIndexedExistingNoteIds).mockReturnValue([])

    const ids = collectIndexedLocalNoteIdsByNotebook('team:project')
    expect(ids).toEqual(new Set([
      'local:nbenc:team%3Aproject:foo.md',
      'local:team:project:legacy-canonical.md',
    ]))
    expect(buildLocalResourceIdPrefix).toHaveBeenCalledWith('team:project')
    expect(getIndexedNoteIdsByPrefix).toHaveBeenCalledWith('local:nbenc:team%3Aproject:')
    expect(getIndexedNoteIdsByPrefix).toHaveBeenCalledWith('local:team:project:')
    expect(getIndexedNoteIdsByPrefix).toHaveBeenCalledWith('team:project:')
  })
})

describe('deleteIndexedLocalNotesByNotebook', () => {
  it('deletes all collected IDs via indexingService.deleteNoteIndex', () => {
    vi.mocked(getLocalNoteIdentityUidsByNotebook).mockReturnValue(new Set(['uuid-1']))
    vi.mocked(getIndexedNoteIdsByPrefix)
      .mockReturnValueOnce(['local:nb-1:foo.md'])
      .mockReturnValueOnce([])
    vi.mocked(getIndexedExistingNoteIds).mockReturnValue(['uuid-1'])

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
    }, { repairIfNeeded: false })
    expect(indexingService.deleteNoteIndex).toHaveBeenCalledWith('uuid-from-db')
    expect(indexingService.deleteNoteIndex).toHaveBeenCalledWith('local:nb-1:foo.md')
  })

  it('falls back to identity lookup when provided noteUid has trim alias spaces', () => {
    vi.mocked(getLocalNoteIdentityByPath).mockReturnValue({ note_uid: 'uuid-from-db' } as any)
    deleteIndexForLocalPath('nb-1', 'foo.md', { noteUid: ' uuid-from-options ' })
    expect(getLocalNoteIdentityByPath).toHaveBeenCalledWith({
      notebook_id: 'nb-1',
      relative_path: 'foo.md',
    }, { repairIfNeeded: false })
    expect(indexingService.deleteNoteIndex).toHaveBeenCalledWith('uuid-from-db')
    expect(indexingService.deleteNoteIndex).toHaveBeenCalledWith('local:nb-1:foo.md')
  })

  it('skips invalid trim-alias uid from identity lookup and only deletes legacy id', () => {
    vi.mocked(getLocalNoteIdentityByPath).mockReturnValue({ note_uid: ' uuid-from-db ' } as any)
    deleteIndexForLocalPath('nb-1', 'foo.md')
    expect(indexingService.deleteNoteIndex).toHaveBeenCalledTimes(1)
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

  it('reuses provided noteUid without querying identity table', () => {
    const content = '{"type":"doc"}'
    syncLocalNotePopupRefs('nb-1', 'foo.md', content, { noteUid: 'uuid-provided' })
    expect(ensureLocalNoteIdentity).not.toHaveBeenCalled()
    expect(replaceAIPopupRefsForNote).toHaveBeenCalledWith({
      note_id: 'uuid-provided',
      source_type: 'local-folder',
      tiptap_content: content,
    })
  })

  it('falls back to identity lookup when provided noteUid has trim alias spaces', () => {
    vi.mocked(ensureLocalNoteIdentity).mockReturnValue({ note_uid: 'uuid-from-db' } as any)
    const content = '{"type":"doc"}'
    syncLocalNotePopupRefs('nb-1', 'foo.md', content, { noteUid: ' uuid-provided ' })
    expect(ensureLocalNoteIdentity).toHaveBeenCalledWith({
      notebook_id: 'nb-1',
      relative_path: 'foo.md',
    })
    expect(replaceAIPopupRefsForNote).toHaveBeenCalledWith({
      note_id: 'uuid-from-db',
      source_type: 'local-folder',
      tiptap_content: content,
    })
  })

  it('skips popup ref sync when ensured identity note_uid is trim alias', () => {
    vi.mocked(ensureLocalNoteIdentity).mockReturnValue({ note_uid: ' uuid-from-db ' } as any)
    const content = '{"type":"doc"}'
    syncLocalNotePopupRefs('nb-1', 'foo.md', content)
    expect(replaceAIPopupRefsForNote).not.toHaveBeenCalled()
  })
})

describe('syncLocalNoteTagsMetadataBatch', () => {
  beforeEach(() => {
    vi.mocked(normalizeRelativeSlashPath).mockImplementation((p: string) => p)
  })

  it('normalizes paths, extracts tags, and writes through batch DB API', () => {
    vi.mocked(extractLocalTagNamesFromTiptapContent)
      .mockReturnValueOnce(['tag-a'])
      .mockReturnValueOnce(['tag-b'])

    syncLocalNoteTagsMetadataBatch({
      notebookId: 'nb-1',
      updates: [
        { relativePath: 'a.md', tiptapContent: '{"a":1}' },
        { relativePath: 'b.md', tiptapContent: '{"b":1}' },
      ],
    })

    expect(updateLocalNoteTagsBatch).toHaveBeenCalledWith({
      notebook_id: 'nb-1',
      updates: [
        { relative_path: 'a.md', tags: ['tag-a'] },
        { relative_path: 'b.md', tags: ['tag-b'] },
      ],
    })
  })

  it('preserves notebookId surrounding spaces when forwarding batch updates', () => {
    vi.mocked(extractLocalTagNamesFromTiptapContent).mockReturnValueOnce(['tag-a'])

    syncLocalNoteTagsMetadataBatch({
      notebookId: '  nb-1  ',
      updates: [
        { relativePath: 'a.md', tiptapContent: '{"a":1}' },
      ],
    })

    expect(updateLocalNoteTagsBatch).toHaveBeenCalledWith({
      notebook_id: '  nb-1  ',
      updates: [
        { relative_path: 'a.md', tags: ['tag-a'] },
      ],
    })
  })

  it('skips invalid or empty updates', () => {
    vi.mocked(normalizeRelativeSlashPath).mockReturnValue('')
    syncLocalNoteTagsMetadataBatch({
      notebookId: 'nb-1',
      updates: [{ relativePath: '', tiptapContent: '{}' }],
    })
    expect(updateLocalNoteTagsBatch).not.toHaveBeenCalled()
  })
})

describe('syncLocalNotePopupRefsBatch', () => {
  it('forwards popup ref updates through popup batch DB API', () => {
    syncLocalNotePopupRefsBatch({
      updates: [
        { noteUid: 'uuid-a', tiptapContent: '{"old":1}' },
        { noteUid: 'uuid-a', tiptapContent: '{"new":1}' },
        { noteUid: 'uuid-b', tiptapContent: '{"b":1}' },
      ],
    })

    expect(replaceAIPopupRefsForNotesBatch).toHaveBeenCalledWith({
      source_type: 'local-folder',
      notes: [
        { note_id: 'uuid-a', tiptap_content: '{"old":1}' },
        { note_id: 'uuid-a', tiptap_content: '{"new":1}' },
        { note_id: 'uuid-b', tiptap_content: '{"b":1}' },
      ],
    })
  })

  it('skips when noteUid is missing', () => {
    syncLocalNotePopupRefsBatch({
      updates: [{ noteUid: null, tiptapContent: '{}' }],
    })
    expect(replaceAIPopupRefsForNotesBatch).not.toHaveBeenCalled()
  })

  it('skips noteUid trim aliases in popup batch updates', () => {
    syncLocalNotePopupRefsBatch({
      updates: [{ noteUid: ' uuid-a ', tiptapContent: '{"x":1}' }],
    })
    expect(replaceAIPopupRefsForNotesBatch).not.toHaveBeenCalled()
  })
})
