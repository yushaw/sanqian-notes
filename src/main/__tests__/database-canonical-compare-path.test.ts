import { describe, expect, it } from 'vitest'
import { buildCanonicalComparePath } from '../database/helpers'

describe('database canonical compare path', () => {
  it('falls back to root path when canonical root is blank', () => {
    const expected = buildCanonicalComparePath('/tmp/root-a', '/tmp/root-a')
    expect(buildCanonicalComparePath('   ', '/tmp/root-a')).toBe(expected)
    expect(buildCanonicalComparePath('', '/tmp/root-a')).toBe(expected)
  })

  it('uses trimmed canonical root when canonical root is surrounded by spaces', () => {
    const expected = buildCanonicalComparePath('/tmp/root-a', '/tmp/root-a')
    expect(buildCanonicalComparePath(' /tmp/root-a ', '/tmp/root-a')).toBe(expected)
  })

  it('normalizes relative segments against root path fallback', () => {
    const expected = buildCanonicalComparePath('/tmp/root-a', '/tmp/root-a')
    expect(buildCanonicalComparePath('   ', '/tmp/root-a/../root-a')).toBe(expected)
  })
})
