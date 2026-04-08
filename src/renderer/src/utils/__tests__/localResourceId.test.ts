import { describe, expect, it } from 'vitest'
import {
  createLocalResourceId,
  createLocalResourceIdFromUid,
  getLocalSearchFileTitle,
  isLocalResourceId,
  isLocalResourceUidRef,
  parseLocalResourceId,
} from '../localResourceId'

describe('localResourceId', () => {
  it('creates and parses resource id', () => {
    const id = createLocalResourceId('nb-1', 'foo/bar/hello world.md')
    expect(id).toBe('local:nb-1:foo%2Fbar%2Fhello%20world.md')
    expect(parseLocalResourceId(id)).toEqual({
      notebookId: 'nb-1',
      relativePath: 'foo/bar/hello world.md',
      noteUid: null,
      scheme: 'path',
    })
  })

  it('preserves notebook id surrounding spaces in canonical ids', () => {
    const id = createLocalResourceId('  nb-1  ', 'docs/plan.md')
    expect(id).toBe('local:  nb-1  :docs%2Fplan.md')
    expect(parseLocalResourceId(id)).toEqual({
      notebookId: '  nb-1  ',
      relativePath: 'docs/plan.md',
      noteUid: null,
      scheme: 'path',
    })
  })

  it('encodes notebook id when it contains colon and parses back losslessly', () => {
    const id = createLocalResourceId('team:project', 'docs/plan.md')
    expect(id).toBe('local:nbenc:team%3Aproject:docs%2Fplan.md')
    expect(parseLocalResourceId(id)).toEqual({
      notebookId: 'team:project',
      relativePath: 'docs/plan.md',
      noteUid: null,
      scheme: 'path',
    })
  })

  it('normalizes slashes when creating ids', () => {
    const id = createLocalResourceId('nb-1', '\\foo\\bar\\a.md')
    expect(id).toBe('local:nb-1:foo%2Fbar%2Fa.md')
  })

  it('normalizes duplicated separators and trailing slash in ids', () => {
    const id = createLocalResourceId('nb-1', '/foo//bar///')
    expect(id).toBe('local:nb-1:foo%2Fbar')
    expect(parseLocalResourceId(id)).toEqual({
      notebookId: 'nb-1',
      relativePath: 'foo/bar',
      noteUid: null,
      scheme: 'path',
    })
  })

  it('normalizes dot path aliases in ids', () => {
    const id = createLocalResourceId('nb-1', './foo/./bar.md')
    expect(id).toBe('local:nb-1:foo%2Fbar.md')
    expect(parseLocalResourceId(id)).toEqual({
      notebookId: 'nb-1',
      relativePath: 'foo/bar.md',
      noteUid: null,
      scheme: 'path',
    })
  })

  it('preserves parent traversal segments in ids', () => {
    const id = createLocalResourceId('nb-1', 'docs/../plan.md')
    expect(id).toBe('local:nb-1:docs%2F..%2Fplan.md')
    expect(parseLocalResourceId(id)).toEqual({
      notebookId: 'nb-1',
      relativePath: 'docs/../plan.md',
      noteUid: null,
      scheme: 'path',
    })
  })

  it('normalizes unicode relative paths to NFC', () => {
    const id = createLocalResourceId('nb-1', 'Cafe\u0301.md')
    expect(id).toBe('local:nb-1:Caf%C3%A9.md')
    expect(parseLocalResourceId(id)).toEqual({
      notebookId: 'nb-1',
      relativePath: 'Café.md',
      noteUid: null,
      scheme: 'path',
    })
  })

  it('preserves intentional leading or trailing spaces in file names', () => {
    const id = createLocalResourceId('nb-1', ' folder/note.md ')
    expect(id).toBe('local:nb-1:%20folder%2Fnote.md%20')
    expect(parseLocalResourceId(id)).toEqual({
      notebookId: 'nb-1',
      relativePath: ' folder/note.md ',
      noteUid: null,
      scheme: 'path',
    })
  })

  it('parses canonical ids with dot aliases into normalized relative paths', () => {
    expect(parseLocalResourceId('local:nb-1:.%2Ffirst.md')).toEqual({
      notebookId: 'nb-1',
      relativePath: 'first.md',
      noteUid: null,
      scheme: 'path',
    })
  })

  it('parses legacy local document ids for backward compatibility', () => {
    expect(parseLocalResourceId('nb-1:docs/plan.md')).toEqual({
      notebookId: 'nb-1',
      relativePath: 'docs/plan.md',
      noteUid: null,
      scheme: 'legacy-path',
    })
  })

  it('preserves notebook id surrounding spaces in legacy ids', () => {
    expect(parseLocalResourceId('  nb-1  :docs/plan.md')).toEqual({
      notebookId: '  nb-1  ',
      relativePath: 'docs/plan.md',
      noteUid: null,
      scheme: 'legacy-path',
    })
  })

  it('creates and parses uid-based resource ids', () => {
    const id = createLocalResourceIdFromUid('  nb-1  ', 'EF84FB2A-8F5E-4E21-BD24-E1D6F2627D53')
    expect(id).toBe('local:  nb-1  :uid:ef84fb2a-8f5e-4e21-bd24-e1d6f2627d53')
    const parsed = parseLocalResourceId(id)
    expect(parsed).toEqual({
      notebookId: '  nb-1  ',
      relativePath: '',
      noteUid: 'ef84fb2a-8f5e-4e21-bd24-e1d6f2627d53',
      scheme: 'uid',
    })
    expect(parsed ? isLocalResourceUidRef(parsed) : false).toBe(true)
  })

  it('encodes notebook id for uid references when notebook id contains colon', () => {
    const id = createLocalResourceIdFromUid('team:project', 'EF84FB2A-8F5E-4E21-BD24-E1D6F2627D53')
    expect(id).toBe('local:nbenc:team%3Aproject:uid:ef84fb2a-8f5e-4e21-bd24-e1d6f2627d53')
    expect(parseLocalResourceId(id)).toEqual({
      notebookId: 'team:project',
      relativePath: '',
      noteUid: 'ef84fb2a-8f5e-4e21-bd24-e1d6f2627d53',
      scheme: 'uid',
    })
  })

  it('parses legacy canonical path ids with raw ":" notebook id', () => {
    expect(parseLocalResourceId('local:team:project:docs%2Fplan.md')).toEqual({
      notebookId: 'team:project',
      relativePath: 'docs/plan.md',
      noteUid: null,
      scheme: 'path',
    })
  })

  it('parses legacy canonical uid ids with raw ":" notebook id', () => {
    expect(parseLocalResourceId('local:team:project:uid:ef84fb2a-8f5e-4e21-bd24-e1d6f2627d53')).toEqual({
      notebookId: 'team:project',
      relativePath: '',
      noteUid: 'ef84fb2a-8f5e-4e21-bd24-e1d6f2627d53',
      scheme: 'uid',
    })
  })

  it('parses historical local uid alias format', () => {
    expect(parseLocalResourceId('local:uid:nb-1:ef84fb2a-8f5e-4e21-bd24-e1d6f2627d53')).toEqual({
      notebookId: 'nb-1',
      relativePath: '',
      noteUid: 'ef84fb2a-8f5e-4e21-bd24-e1d6f2627d53',
      scheme: 'uid',
    })
    expect(parseLocalResourceId('local:uid:nb-1:legacy:UID-42')).toEqual({
      notebookId: 'nb-1',
      relativePath: '',
      noteUid: 'legacy:UID-42',
      scheme: 'uid',
    })
  })

  it('keeps backward compatibility when notebook id equals encoded marker prefix', () => {
    expect(parseLocalResourceId('local:nbenc:docs%2Fplan.md')).toEqual({
      notebookId: 'nbenc',
      relativePath: 'docs/plan.md',
      noteUid: null,
      scheme: 'path',
    })
    expect(parseLocalResourceId('local:nbenc:uid:ef84fb2a-8f5e-4e21-bd24-e1d6f2627d53')).toEqual({
      notebookId: 'nbenc',
      relativePath: '',
      noteUid: 'ef84fb2a-8f5e-4e21-bd24-e1d6f2627d53',
      scheme: 'uid',
    })
  })

  it('keeps legacy opaque uid references lossless', () => {
    const id = createLocalResourceIdFromUid('nb-1', 'legacy:UID-42')
    expect(id).toBe('local:nb-1:uid:legacy:UID-42')
    expect(parseLocalResourceId(id)).toEqual({
      notebookId: 'nb-1',
      relativePath: '',
      noteUid: 'legacy:UID-42',
      scheme: 'uid',
    })
  })

  it('rejects uid trim aliases', () => {
    expect(parseLocalResourceId('local:nb-1:uid: legacy ')).toBeNull()
    expect(() => createLocalResourceIdFromUid('nb-1', ' legacy ')).toThrow('invalid local note uid')
  })

  it('rejects blank notebook ids in historical uid alias format', () => {
    const malformedWithSpaces = parseLocalResourceId('local:uid:   :ef84fb2a-8f5e-4e21-bd24-e1d6f2627d53')
    const malformedEmptyNotebook = parseLocalResourceId('local:uid::ef84fb2a-8f5e-4e21-bd24-e1d6f2627d53')
    expect(malformedWithSpaces ? isLocalResourceUidRef(malformedWithSpaces) : false).toBe(false)
    expect(malformedEmptyNotebook ? isLocalResourceUidRef(malformedEmptyNotebook) : false).toBe(false)
  })

  it('returns null for invalid ids', () => {
    expect(parseLocalResourceId('note-1')).toBeNull()
    expect(parseLocalResourceId('urn:uuid:abc')).toBeNull()
    expect(parseLocalResourceId('local:nb-1')).toBeNull()
    expect(parseLocalResourceId('local::x')).toBeNull()
    expect(parseLocalResourceId('local:   :docs%2Fplan.md')).toBeNull()
    const malformedLegacyUidAlias = parseLocalResourceId('local:uid:   :ef84fb2a-8f5e-4e21-bd24-e1d6f2627d53')
    expect(malformedLegacyUidAlias ? isLocalResourceUidRef(malformedLegacyUidAlias) : false).toBe(false)
    expect(parseLocalResourceId('   :docs/plan.md')).toBeNull()
    expect(parseLocalResourceId('local:nb-1:%ZZ')).toBeNull()
  })

  it('fails closed for non-string id inputs', () => {
    const nonStringInputs: unknown[] = [
      undefined,
      null,
      123,
      true,
      {},
      [],
      Symbol('local-id'),
    ]
    for (const input of nonStringInputs) {
      expect(parseLocalResourceId(input)).toBeNull()
      expect(isLocalResourceId(input)).toBe(false)
    }
  })

  it('rejects blank notebook id when creating canonical ids', () => {
    expect(() => createLocalResourceId('', 'docs/plan.md'))
      .toThrow('invalid local resource notebook id')
    expect(() => createLocalResourceId('   ', 'docs/plan.md'))
      .toThrow('invalid local resource notebook id')
    expect(() => createLocalResourceIdFromUid('', 'EF84FB2A-8F5E-4E21-BD24-E1D6F2627D53'))
      .toThrow('invalid local resource notebook id')
  })

  it('rejects blank relative path when creating path-based canonical ids', () => {
    expect(() => createLocalResourceId('nb-1', ''))
      .toThrow('invalid local resource relative path')
    expect(() => createLocalResourceId('nb-1', '   '))
      .toThrow('invalid local resource relative path')
    expect(() => createLocalResourceId('nb-1', './'))
      .toThrow('invalid local resource relative path')
  })

  it('detects canonical and legacy local resource ids', () => {
    expect(isLocalResourceId('local:nb-1:file.md')).toBe(true)
    expect(isLocalResourceId('local:nb-1:uid:ef84fb2a-8f5e-4e21-bd24-e1d6f2627d53')).toBe(true)
    expect(isLocalResourceId('nb-1:docs/plan.md')).toBe(true)
    expect(isLocalResourceId('note-1')).toBe(false)
    expect(isLocalResourceId('urn:uuid:abc')).toBe(false)
  })

  it('extracts search title from relative path', () => {
    expect(getLocalSearchFileTitle('foo/bar/readme.md')).toBe('readme')
    expect(getLocalSearchFileTitle('folder\\a\\test.txt')).toBe('test')
    expect(getLocalSearchFileTitle('no-ext')).toBe('no-ext')
  })
})
