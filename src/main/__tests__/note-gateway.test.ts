import { describe, expect, it } from 'vitest'
import {
  buildInternalEtag,
  buildLocalEtag,
  resolveIfMatchForInternal,
  resolveIfMatchForLocal,
} from '../note-gateway'

describe('note-gateway if_match', () => {
  it('accepts numeric revision for internal notes', () => {
    const check = resolveIfMatchForInternal({ id: 'note-1', revision: 3 }, 3)
    expect(check).toEqual({ ok: true, expectedRevision: 3 })
  })

  it('accepts internal etag with matching note id', () => {
    const etag = buildInternalEtag({ id: 'note-1', revision: 8 })
    const check = resolveIfMatchForInternal({ id: 'note-1', revision: 8 }, etag)
    expect(check).toEqual({ ok: true, expectedRevision: 8 })
  })

  it('accepts internal etag when note id contains ":"', () => {
    const etag = buildInternalEtag({ id: 'ext:note:1', revision: 8 })
    const check = resolveIfMatchForInternal({ id: 'ext:note:1', revision: 8 }, etag)
    expect(check).toEqual({ ok: true, expectedRevision: 8 })
  })

  it('rejects internal etag when note id mismatches', () => {
    const etag = buildInternalEtag({ id: 'note-A', revision: 2 })
    const check = resolveIfMatchForInternal({ id: 'note-B', revision: 2 }, etag)
    expect(check).toEqual({ ok: false, error: 'if_match_mismatch' })
  })

  it('accepts local etag with matching notebook and path', () => {
    const etag = buildLocalEtag({
      notebookId: 'nb-local',
      relativePath: 'docs/plan.md',
      mtimeMs: 1700000000123,
      size: 128,
    })
    const check = resolveIfMatchForLocal(
      {
        notebookId: 'nb-local',
        relativePath: 'docs/plan.md',
        mtimeMs: 1700000000123,
        size: 128,
      },
      etag
    )
    expect(check).toEqual({
      ok: true,
      expectedMtimeMs: 1700000000123,
      expectedSize: 128,
    })
  })

  it('encodes notebook id in local etag when notebook contains ":"', () => {
    const etag = buildLocalEtag({
      notebookId: 'team:project',
      relativePath: 'docs/plan.md',
      mtimeMs: 1700000000123,
      size: 128,
    })
    expect(etag).toBe('sqn-v1:local:nbenc:team%3Aproject:docs%2Fplan.md:1700000000123:128')
    const check = resolveIfMatchForLocal(
      {
        notebookId: 'team:project',
        relativePath: 'docs/plan.md',
        mtimeMs: 1700000000123,
        size: 128,
      },
      etag
    )
    expect(check).toEqual({
      ok: true,
      expectedMtimeMs: 1700000000123,
      expectedSize: 128,
    })
  })

  it('normalizes local etag path separators and duplicate slashes', () => {
    const etag = buildLocalEtag({
      notebookId: 'nb-local',
      relativePath: '\\docs\\\\plan.md',
      mtimeMs: 1700000000123,
      size: 128,
    })
    const check = resolveIfMatchForLocal(
      {
        notebookId: 'nb-local',
        relativePath: 'docs//plan.md',
        mtimeMs: 1700000000123,
        size: 128,
      },
      etag
    )
    expect(check).toEqual({
      ok: true,
      expectedMtimeMs: 1700000000123,
      expectedSize: 128,
    })
  })

  it('accepts legacy local etag path encoded with backslashes', () => {
    const legacyEtag = 'sqn-v1:local:nb-local:docs%5Cplan.md:1700000000123:128'
    const check = resolveIfMatchForLocal(
      {
        notebookId: 'nb-local',
        relativePath: 'docs/plan.md',
        mtimeMs: 1700000000123,
        size: 128,
      },
      legacyEtag
    )
    expect(check).toEqual({
      ok: true,
      expectedMtimeMs: 1700000000123,
      expectedSize: 128,
    })
  })

  it('accepts legacy local etag with raw ":" notebook id', () => {
    const legacyEtag = 'sqn-v1:local:team:project:docs%2Fplan.md:1700000000123:128'
    const check = resolveIfMatchForLocal(
      {
        notebookId: 'team:project',
        relativePath: 'docs/plan.md',
        mtimeMs: 1700000000123,
        size: 128,
      },
      legacyEtag
    )
    expect(check).toEqual({
      ok: true,
      expectedMtimeMs: 1700000000123,
      expectedSize: 128,
    })
  })

  it('accepts legacy local etag when notebook id starts with "nbenc:"', () => {
    const legacyEtag = 'sqn-v1:local:nbenc:project:docs%2Fplan.md:1700000000123:128'
    const check = resolveIfMatchForLocal(
      {
        notebookId: 'nbenc:project',
        relativePath: 'docs/plan.md',
        mtimeMs: 1700000000123,
        size: 128,
      },
      legacyEtag
    )
    expect(check).toEqual({
      ok: true,
      expectedMtimeMs: 1700000000123,
      expectedSize: 128,
    })
  })

  it('accepts local etag with matching content hash', () => {
    const etag = buildLocalEtag({
      notebookId: 'nb-local',
      relativePath: 'docs/plan.md',
      mtimeMs: 1700000000123,
      size: 128,
      contentHash: 'A'.repeat(64),
    })
    const check = resolveIfMatchForLocal(
      {
        notebookId: 'nb-local',
        relativePath: 'docs/plan.md',
        mtimeMs: 1700000000123,
        size: 128,
        contentHash: 'a'.repeat(64),
      },
      etag
    )
    expect(check).toEqual({
      ok: true,
      expectedMtimeMs: 1700000000123,
      expectedSize: 128,
      expectedContentHash: 'a'.repeat(64),
    })
  })

  it('omits malformed content hash token when building local etag', () => {
    const etag = buildLocalEtag({
      notebookId: 'nb-local',
      relativePath: 'docs/plan.md',
      mtimeMs: 1700000000123,
      size: 128,
      contentHash: 'not-a-sha256',
    })
    expect(etag).toBe('sqn-v1:local:nb-local:docs%2Fplan.md:1700000000123:128')

    const check = resolveIfMatchForLocal(
      {
        notebookId: 'nb-local',
        relativePath: 'docs/plan.md',
        mtimeMs: 1700000000123,
        size: 128,
        contentHash: 'a'.repeat(64),
      },
      etag
    )
    expect(check).toEqual({
      ok: true,
      expectedMtimeMs: 1700000000123,
      expectedSize: 128,
    })
  })

  it('rejects local etag when content hash mismatches', () => {
    const etag = buildLocalEtag({
      notebookId: 'nb-local',
      relativePath: 'docs/plan.md',
      mtimeMs: 1700000000123,
      size: 128,
      contentHash: 'a'.repeat(64),
    })
    const check = resolveIfMatchForLocal(
      {
        notebookId: 'nb-local',
        relativePath: 'docs/plan.md',
        mtimeMs: 1700000000123,
        size: 128,
        contentHash: 'b'.repeat(64),
      },
      etag
    )
    expect(check).toEqual({ ok: false, error: 'if_match_mismatch' })
  })

  it('rejects local etag when path mismatches', () => {
    const etag = buildLocalEtag({
      notebookId: 'nb-local',
      relativePath: 'docs/plan.md',
      mtimeMs: 9,
      size: 10,
    })
    const check = resolveIfMatchForLocal(
      {
        notebookId: 'nb-local',
        relativePath: 'docs/other.md',
        mtimeMs: 9,
        size: 10,
      },
      etag
    )
    expect(check).toEqual({ ok: false, error: 'if_match_mismatch' })
  })

  it('rejects malformed if_match tokens', () => {
    const internalCheck = resolveIfMatchForInternal({ id: 'note-1', revision: 1 }, 'bad-token')
    expect(internalCheck).toEqual({ ok: false, error: 'invalid_if_match' })

    const localCheck = resolveIfMatchForLocal(
      {
        notebookId: 'nb-local',
        relativePath: 'docs/plan.md',
        mtimeMs: 1,
        size: 1,
      },
      'bad-token'
    )
    expect(localCheck).toEqual({ ok: false, error: 'invalid_if_match' })
  })

  it('treats explicit empty/invalid if_match values as invalid (not absent)', () => {
    expect(resolveIfMatchForInternal({ id: 'note-1', revision: 1 }, '')).toEqual({
      ok: false,
      error: 'invalid_if_match',
    })
    expect(resolveIfMatchForInternal({ id: 'note-1', revision: 1 }, Number.NaN)).toEqual({
      ok: false,
      error: 'invalid_if_match',
    })
    expect(resolveIfMatchForInternal({ id: 'note-1', revision: 1 }, {})).toEqual({
      ok: false,
      error: 'invalid_if_match',
    })

    expect(
      resolveIfMatchForLocal(
        {
          notebookId: 'nb-local',
          relativePath: 'docs/plan.md',
          mtimeMs: 1,
          size: 1,
          contentHash: 'a'.repeat(64),
        },
        ''
      )
    ).toEqual({ ok: false, error: 'invalid_if_match' })
    expect(
      resolveIfMatchForLocal(
        {
          notebookId: 'nb-local',
          relativePath: 'docs/plan.md',
          mtimeMs: 1,
          size: 1,
          contentHash: 'a'.repeat(64),
        },
        Number.POSITIVE_INFINITY
      )
    ).toEqual({ ok: false, error: 'invalid_if_match' })
    expect(
      resolveIfMatchForLocal(
        {
          notebookId: 'nb-local',
          relativePath: 'docs/plan.md',
          mtimeMs: 1,
          size: 1,
          contentHash: 'a'.repeat(64),
        },
        { bad: true }
      )
    ).toEqual({ ok: false, error: 'invalid_if_match' })
  })

  it('rejects non-integer numeric if_match values', () => {
    expect(resolveIfMatchForInternal({ id: 'note-1', revision: 1 }, 1.5)).toEqual({
      ok: false,
      error: 'invalid_if_match',
    })
    expect(
      resolveIfMatchForLocal(
        {
          notebookId: 'nb-local',
          relativePath: 'docs/plan.md',
          mtimeMs: 1,
          size: 1,
        },
        1.5
      )
    ).toEqual({ ok: false, error: 'invalid_if_match' })
  })

  it('rejects unsafe integer tokens in encoded etags', () => {
    const unsafeInternal = 'sqn-v1:internal:note-1:9007199254740993'
    expect(resolveIfMatchForInternal({ id: 'note-1', revision: 1 }, unsafeInternal)).toEqual({
      ok: false,
      error: 'invalid_if_match',
    })

    const unsafeLocal = 'sqn-v1:local:nb-local:docs%2Fplan.md:9007199254740993:128'
    expect(
      resolveIfMatchForLocal(
        {
          notebookId: 'nb-local',
          relativePath: 'docs/plan.md',
          mtimeMs: 1,
          size: 1,
        },
        unsafeLocal
      )
    ).toEqual({ ok: false, error: 'invalid_if_match' })
  })
})
