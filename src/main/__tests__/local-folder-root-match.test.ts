import { describe, expect, it } from 'vitest'
import {
  isLocalFolderRootPathMatched,
  isLocalFolderTreeRootMatched,
  resolveComparableLocalFolderRootPath,
} from '../local-folder-root-match'

describe('local-folder-root-match', () => {
  it('does not treat different alias roots as equal without canonicalized cached root', () => {
    expect(isLocalFolderRootPathMatched('/Volumes/alias-a', {
      root_path: '/Volumes/alias-b',
      canonical_root_path: '/data/notes',
    })).toBe(false)
  })

  it('treats normalized canonical root as matched', () => {
    expect(isLocalFolderRootPathMatched('/tmp/data/../data', {
      root_path: '/tmp/alias',
      canonical_root_path: '/tmp/data',
    })).toBe(true)
  })

  it('returns false for empty cached root path', () => {
    expect(isLocalFolderRootPathMatched('', {
      root_path: '/data/notes',
      canonical_root_path: '/data/notes',
    })).toBe(false)
  })

  it('matches tree root using mount root fallback when canonical root is blank', () => {
    expect(isLocalFolderTreeRootMatched({
      root_path: '/tmp/root-a',
    }, {
      root_path: '/tmp/root-a',
      canonical_root_path: '   ',
    })).toBe(true)
  })

  it('normalizes canonical root into comparable path', () => {
    expect(resolveComparableLocalFolderRootPath({
      root_path: '/tmp/unused',
      canonical_root_path: '/tmp/data/../data',
    })).toBe(resolveComparableLocalFolderRootPath({
      root_path: '/tmp/data',
      canonical_root_path: '/tmp/data',
    }))
  })
})
