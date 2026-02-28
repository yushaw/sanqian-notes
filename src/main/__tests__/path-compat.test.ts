import { describe, expect, it } from 'vitest'
import {
  isCaseInsensitivePlatform,
  normalizeComparablePath,
  normalizeComparablePathForFileSystem,
  normalizeRelativeSlashPath,
  toSlashPath,
} from '../path-compat'

describe('path-compat', () => {
  it('normalizes path comparisons by platform semantics', () => {
    expect(normalizeComparablePath('C:\\Vault\\Notes', 'win32')).toBe('c:\\vault\\notes')
    expect(normalizeComparablePath('/Users/Alice/Notes', 'darwin')).toBe('/users/alice/notes')
    expect(normalizeComparablePath('/var/Notes', 'linux')).toBe('/var/Notes')
  })

  it('converts backslashes to slash paths', () => {
    expect(toSlashPath('docs\\Plan\\index.md')).toBe('docs/Plan/index.md')
  })

  it('normalizes relative slash paths for identity use', () => {
    expect(normalizeRelativeSlashPath('/docs//Plan///index.md')).toBe('docs/Plan/index.md')
    expect(normalizeRelativeSlashPath('folder/')).toBe('folder')
  })

  it('flags case-insensitive platforms', () => {
    expect(isCaseInsensitivePlatform('win32')).toBe(true)
    expect(isCaseInsensitivePlatform('darwin')).toBe(true)
    expect(isCaseInsensitivePlatform('linux')).toBe(false)
  })

  it('normalizes with filesystem-aware platform defaults', () => {
    expect(normalizeComparablePathForFileSystem('C:\\Vault\\Notes', 'C:\\Vault\\Notes', 'win32')).toBe('c:\\vault\\notes')
    expect(normalizeComparablePathForFileSystem('/var/Notes', '/var/Notes', 'linux')).toBe('/var/Notes')
  })
})
