import { describe, it, expect, vi } from 'vitest'

vi.mock('jieba-wasm', () => ({
  cut_for_search: () => {
    throw new Error('mocked jieba failure')
  },
  with_dict: () => {}
}))

import { buildSearchTokens, tokenizeForSearch, warmupTokenizer } from '../tokenizer'

describe('tokenizer', () => {
  it('falls back to CJK bigrams when jieba fails', () => {
    const tokens = tokenizeForSearch('中文测试')
    expect(tokens).toContain('中文')
    expect(tokens).toContain('文测')
    expect(tokens).toContain('测试')
  })

  it('tokenizes ASCII words', () => {
    const tokens = tokenizeForSearch('hello world')
    expect(tokens).toContain('hello')
    expect(tokens).toContain('world')
  })

  it('buildSearchTokens joins tokens for indexing', () => {
    const tokens = buildSearchTokens('hello world')
    expect(tokens.includes('hello')).toBe(true)
    expect(tokens.includes('world')).toBe(true)
  })

  it('warmupTokenizer does not throw when jieba fails', () => {
    expect(() => warmupTokenizer()).not.toThrow()
  })
})
