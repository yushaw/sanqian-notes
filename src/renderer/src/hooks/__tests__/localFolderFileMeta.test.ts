import { describe, expect, it } from 'vitest'
import { isLocalFileMetadataUnchanged } from '../localFolderFileMeta'

describe('isLocalFileMetadataUnchanged', () => {
  it('returns false when current metadata is missing', () => {
    expect(isLocalFileMetadataUnchanged(null, {
      size: 10,
      mtimeMs: 1000,
      contentHash: 'abc',
    })).toBe(false)
  })

  it('returns true when size and mtime match and hashes are equal', () => {
    expect(isLocalFileMetadataUnchanged(
      { size: 10, mtimeMs: 1000, contentHash: 'abc' },
      { size: 10, mtimeMs: 1001, contentHash: 'abc' }
    )).toBe(true)
  })

  it('returns false when one side hash is missing even if size/mtime match', () => {
    expect(isLocalFileMetadataUnchanged(
      { size: 10, mtimeMs: 1000 },
      { size: 10, mtimeMs: 1000, contentHash: 'different' }
    )).toBe(false)
  })

  it('returns true when hashes are missing but etags match', () => {
    expect(isLocalFileMetadataUnchanged(
      { size: 10, mtimeMs: 1000, etag: 'same-etag' },
      { size: 10, mtimeMs: 1001, etag: 'same-etag' }
    )).toBe(true)
  })

  it('returns false when hashes are missing and etags differ', () => {
    expect(isLocalFileMetadataUnchanged(
      { size: 10, mtimeMs: 1000, etag: 'etag-a' },
      { size: 10, mtimeMs: 1001, etag: 'etag-b' }
    )).toBe(false)
  })

  it('returns false when size differs', () => {
    expect(isLocalFileMetadataUnchanged(
      { size: 10, mtimeMs: 1000, contentHash: 'abc' },
      { size: 11, mtimeMs: 1000, contentHash: 'abc' }
    )).toBe(false)
  })

  it('returns false when mtime delta exceeds tolerance', () => {
    expect(isLocalFileMetadataUnchanged(
      { size: 10, mtimeMs: 1000, contentHash: 'abc' },
      { size: 10, mtimeMs: 1003, contentHash: 'abc' }
    )).toBe(false)
  })

  it('returns false when both hashes exist and differ', () => {
    expect(isLocalFileMetadataUnchanged(
      { size: 10, mtimeMs: 1000, contentHash: 'abc' },
      { size: 10, mtimeMs: 1000, contentHash: 'def' }
    )).toBe(false)
  })
})
