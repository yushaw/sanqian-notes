import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../shared/local-resource-id', () => ({
  createLocalResourceId: vi.fn((notebookId: string, relativePath: string) => `local:${notebookId}:${relativePath}`),
}))

vi.mock('../../database', () => ({
  listLocalNoteMetadata: vi.fn(() => []),
  getLocalNoteMetadata: vi.fn(() => null),
  ensureLocalNoteIdentity: vi.fn(() => null),
  moveLocalNoteIdentity: vi.fn(() => 0),
  renameLocalNoteIdentityPath: vi.fn(() => 0),
  deleteLocalNoteIdentityByPath: vi.fn(() => 0),
  renameLocalNoteMetadataPath: vi.fn(() => 0),
  deleteLocalNoteMetadataByPath: vi.fn(() => 0),
  updateLocalNoteMetadata: vi.fn(() => null),
  replaceAIPopupRefsForNote: vi.fn(),
}))

vi.mock('../../local-note-tags', () => ({
  areLocalTagNameListsEqual: vi.fn(() => true),
  extractLocalTagNamesFromTiptapContent: vi.fn(() => []),
}))

import { createLocalResourceId } from '../../../shared/local-resource-id'
import { ensureLocalNoteIdentity, listLocalNoteMetadata } from '../../database'
import { buildLocalNoteMetadataByIdMap, ensureLocalNoteIdentityForPath } from './local-note-helpers'

describe('local-note-helpers notebook id semantics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preserves notebookIds surrounding spaces when querying metadata map', () => {
    buildLocalNoteMetadataByIdMap(['  nb-1  ', '  nb-1  ', 'nb-1', '   '] as any)

    expect(listLocalNoteMetadata).toHaveBeenCalledWith({
      notebookIds: ['  nb-1  ', 'nb-1'],
    })
  })

  it('fails closed when explicit notebookIds filter is empty', () => {
    const metadataById = buildLocalNoteMetadataByIdMap([])

    expect(metadataById.size).toBe(0)
    expect(listLocalNoteMetadata).not.toHaveBeenCalled()
  })

  it('fails closed when explicit notebookIds filter has only invalid values', () => {
    const metadataById = buildLocalNoteMetadataByIdMap(['   ', null, 7] as any)

    expect(metadataById.size).toBe(0)
    expect(listLocalNoteMetadata).not.toHaveBeenCalled()
  })

  it('builds metadata map keys from exact notebook_id value', () => {
    vi.mocked(listLocalNoteMetadata).mockReturnValue([
      {
        notebook_id: '  nb-1  ',
        relative_path: 'docs/a.md',
        is_favorite: false,
        is_pinned: false,
        ai_summary: null,
        summary_content_hash: null,
        tags: [],
        ai_tags: [],
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ] as any)

    const metadataById = buildLocalNoteMetadataByIdMap(['  nb-1  '])

    expect(createLocalResourceId).toHaveBeenCalledWith('  nb-1  ', 'docs/a.md')
    expect(metadataById.get('local:  nb-1  :docs/a.md')).toBeTruthy()
  })

  it('returns null when ensured identity note_uid is trim alias', () => {
    vi.mocked(ensureLocalNoteIdentity).mockReturnValue({
      note_uid: ' legacy:UID-42 ',
    } as any)

    expect(ensureLocalNoteIdentityForPath('nb-1', 'docs/a.md')).toBeNull()
  })

  it('canonicalizes uppercase UUID identity note_uid', () => {
    vi.mocked(ensureLocalNoteIdentity).mockReturnValue({
      note_uid: 'EF84FB2A-8F5E-4E21-BD24-E1D6F2627D53',
    } as any)

    expect(ensureLocalNoteIdentityForPath('nb-1', 'docs/a.md')).toBe('ef84fb2a-8f5e-4e21-bd24-e1d6f2627d53')
  })
})
