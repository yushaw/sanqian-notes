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

  it('parses legacy local document ids for backward compatibility', () => {
    expect(parseLocalResourceId('nb-1:docs/plan.md')).toEqual({
      notebookId: 'nb-1',
      relativePath: 'docs/plan.md',
      noteUid: null,
      scheme: 'legacy-path',
    })
  })

  it('creates and parses uid-based resource ids', () => {
    const id = createLocalResourceIdFromUid('nb-1', 'EF84FB2A-8F5E-4E21-BD24-E1D6F2627D53')
    expect(id).toBe('local:nb-1:uid:ef84fb2a-8f5e-4e21-bd24-e1d6f2627d53')
    const parsed = parseLocalResourceId(id)
    expect(parsed).toEqual({
      notebookId: 'nb-1',
      relativePath: '',
      noteUid: 'ef84fb2a-8f5e-4e21-bd24-e1d6f2627d53',
      scheme: 'uid',
    })
    expect(parsed ? isLocalResourceUidRef(parsed) : false).toBe(true)
  })

  it('returns null for invalid ids', () => {
    expect(parseLocalResourceId('note-1')).toBeNull()
    expect(parseLocalResourceId('urn:uuid:abc')).toBeNull()
    expect(parseLocalResourceId('local:nb-1')).toBeNull()
    expect(parseLocalResourceId('local::x')).toBeNull()
    expect(parseLocalResourceId('local:nb-1:%ZZ')).toBeNull()
    expect(parseLocalResourceId('local:nb-1:uid:not-a-uuid')).toBeNull()
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
