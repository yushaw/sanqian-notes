import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../shared/local-resource-id', () => ({
  createLocalResourceId: vi.fn((notebookId: string, relativePath: string) => `local:${notebookId}:${relativePath}`),
  parseLocalResourceId: vi.fn(() => null),
}))

vi.mock('../database', () => ({
  ensureLocalNoteIdentity: vi.fn(() => null),
  getLocalFolderMounts: vi.fn(() => []),
  getLocalNoteIdentityByUid: vi.fn(() => null),
  getLocalNoteMetadata: vi.fn(() => null),
  getNoteById: vi.fn(() => null),
  getNotebooks: vi.fn(() => []),
}))

vi.mock('../local-note-tags', () => ({
  extractLocalTagNamesFromTiptapContent: vi.fn(() => []),
  mergeLocalUserAndAITagNames: vi.fn(() => []),
}))

vi.mock('../local-folder', () => ({
  readLocalFolderFile: vi.fn(() => ({ success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' })),
}))

vi.mock('../path-compat', () => ({
  normalizeRelativeSlashPath: vi.fn((pathValue: string) => pathValue),
}))

import { createLocalResourceId } from '../../shared/local-resource-id'
import {
  ensureLocalNoteIdentity,
  getLocalFolderMounts,
  getNoteById,
  getNotebooks,
} from '../database'
import {
  buildCanonicalLocalResourceId,
  resolveNotebookForCreate,
  resolveNoteResource,
  resolveNoteResourceAsync,
} from '../note-gateway'

describe('note-gateway resolveNotebookForCreate notebook id semantics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('treats blank notebook id as internal create target', () => {
    expect(resolveNotebookForCreate('')).toEqual({ ok: true, sourceType: 'internal', notebook: null })
    expect(resolveNotebookForCreate('   ')).toEqual({ ok: true, sourceType: 'internal', notebook: null })
    expect(resolveNotebookForCreate(undefined)).toEqual({ ok: true, sourceType: 'internal', notebook: null })
  })

  it('preserves surrounding spaces and resolves exact internal notebook id', () => {
    const notebookId = '  nb-internal  '
    vi.mocked(getNotebooks).mockReturnValue([
      {
        id: notebookId,
        name: 'Internal',
        icon: 'logo:notes',
        source_type: 'internal',
        order_index: 0,
        created_at: '2026-01-01T00:00:00.000Z',
      } as any,
    ])

    const result = resolveNotebookForCreate(notebookId)
    expect(result).toMatchObject({
      ok: true,
      sourceType: 'internal',
      notebook: { id: notebookId },
    })
  })

  it('does not match trim-only notebook id aliases', () => {
    vi.mocked(getNotebooks).mockReturnValue([
      {
        id: 'nb-internal',
        name: 'Internal',
        icon: 'logo:notes',
        source_type: 'internal',
        order_index: 0,
        created_at: '2026-01-01T00:00:00.000Z',
      } as any,
    ])

    const result = resolveNotebookForCreate('  nb-internal  ')
    expect(result).toEqual({ ok: false, error: 'notebook_not_found' })
  })

  it('preserves surrounding spaces for local-folder notebook ids', () => {
    const notebookId = '  nb-local  '
    const notebook = {
      id: notebookId,
      name: 'Local',
      icon: 'logo:notes',
      source_type: 'local-folder',
      order_index: 0,
      created_at: '2026-01-01T00:00:00.000Z',
    }
    vi.mocked(getNotebooks).mockReturnValue([notebook as any])
    vi.mocked(getLocalFolderMounts).mockReturnValue([
      {
        notebook,
        mount: {
          notebook_id: notebookId,
          root_path: '/tmp/local',
          canonical_root_path: '/tmp/local',
          status: 'active',
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      } as any,
    ])

    const result = resolveNotebookForCreate(notebookId)
    expect(result).toMatchObject({
      ok: true,
      sourceType: 'local-folder',
      notebook: { id: notebookId },
      mount: { notebook: { id: notebookId } },
    })
  })
})

describe('note-gateway buildCanonicalLocalResourceId note_uid semantics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses canonicalized UUID note_uid from identity rows', () => {
    vi.mocked(ensureLocalNoteIdentity).mockReturnValue({
      note_uid: 'EF84FB2A-8F5E-4E21-BD24-E1D6F2627D53',
    } as any)

    expect(buildCanonicalLocalResourceId({
      notebookId: 'nb-1',
      relativePath: 'docs/plan.md',
    })).toBe('ef84fb2a-8f5e-4e21-bd24-e1d6f2627d53')
  })

  it('falls back to path local resource id when identity note_uid is invalid trim alias', () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(ensureLocalNoteIdentity).mockReturnValue({
      note_uid: ' EF84FB2A-8F5E-4E21-BD24-E1D6F2627D53 ',
    } as any)

    expect(buildCanonicalLocalResourceId({
      notebookId: 'nb-1',
      relativePath: 'docs/plan.md',
    })).toBe('local:nb-1:docs/plan.md')
    expect(createLocalResourceId).toHaveBeenCalledWith('nb-1', 'docs/plan.md')
    expect(consoleWarnSpy).toHaveBeenCalled()
    consoleWarnSpy.mockRestore()
  })
})

describe('note-gateway resolveNoteResource input hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fails closed for non-string id inputs in sync resolver', () => {
    expect(resolveNoteResource(undefined)).toEqual({ ok: false, errorCode: 'NOTE_NOT_FOUND' })
    expect(resolveNoteResource(null)).toEqual({ ok: false, errorCode: 'NOTE_NOT_FOUND' })
    expect(resolveNoteResource({})).toEqual({ ok: false, errorCode: 'NOTE_NOT_FOUND' })

    expect(getNoteById).not.toHaveBeenCalled()
  })

  it('fails closed for non-string id inputs in async resolver', async () => {
    await expect(resolveNoteResourceAsync(undefined)).resolves.toEqual({
      ok: false,
      errorCode: 'NOTE_NOT_FOUND',
    })
    await expect(resolveNoteResourceAsync(null)).resolves.toEqual({
      ok: false,
      errorCode: 'NOTE_NOT_FOUND',
    })
    await expect(resolveNoteResourceAsync({})).resolves.toEqual({
      ok: false,
      errorCode: 'NOTE_NOT_FOUND',
    })

    expect(getNoteById).not.toHaveBeenCalled()
  })
})
