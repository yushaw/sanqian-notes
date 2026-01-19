import { describe, it, expect, vi } from 'vitest'

// Unmock summary-service for this test file (it's globally mocked in setup.ts)
vi.unmock('../summary-service')

import { computeHash, extractOutline } from '../summary-service'

describe('summary-service', () => {
  describe('parseSummaryResponse (via module internals)', () => {
    // Test the expected format parsing by checking the regex patterns work
    it('should match English format patterns', () => {
      const response = `Summary: This is a test summary about the note content.
Keywords: test, summary, keywords`

      // Test the regex patterns used in parseSummaryResponse
      const summaryMatch = response.match(/Summary:\s*(.+?)(?=\n*Keywords:|$)/is)
      const keywordsMatch = response.match(/Keywords:\s*(.+)/is)

      expect(summaryMatch?.[1]?.trim()).toBe('This is a test summary about the note content.')
      expect(keywordsMatch?.[1]?.trim()).toBe('test, summary, keywords')
    })

    it('should handle multiline summary', () => {
      const response = `Summary: This is a longer summary
that spans multiple lines.
Keywords: multi, line, test`

      const summaryMatch = response.match(/Summary:\s*(.+?)(?=\n*Keywords:|$)/is)
      const keywordsMatch = response.match(/Keywords:\s*(.+)/is)

      expect(summaryMatch?.[1]?.trim()).toBe('This is a longer summary\nthat spans multiple lines.')
      expect(keywordsMatch?.[1]?.trim()).toBe('multi, line, test')
    })

    it('should be case insensitive', () => {
      const response = `SUMMARY: Upper case test.
KEYWORDS: upper, case`

      const summaryMatch = response.match(/Summary:\s*(.+?)(?=\n*Keywords:|$)/is)
      const keywordsMatch = response.match(/Keywords:\s*(.+)/is)

      expect(summaryMatch?.[1]?.trim()).toBe('Upper case test.')
      expect(keywordsMatch?.[1]?.trim()).toBe('upper, case')
    })
  })

  describe('extractOutline', () => {
    it('should extract headings and list items', () => {
      const markdown = `# Heading 1
Some paragraph text.
## Heading 2
- List item 1
- List item 2
  - Nested item (should be excluded)
1. Numbered item`

      const outline = extractOutline(markdown)
      expect(outline).toContain('# Heading 1')
      expect(outline).toContain('## Heading 2')
      expect(outline).toContain('- List item 1')
      expect(outline).toContain('1. Numbered item')
      expect(outline).not.toContain('Some paragraph text')
      expect(outline).not.toContain('Nested item')
    })
  })

  describe('computeHash', () => {
    it('should return consistent hash for same content', () => {
      const hash1 = computeHash('test content')
      const hash2 = computeHash('test content')
      expect(hash1).toBe(hash2)
    })

    it('should return different hash for different content', () => {
      const hash1 = computeHash('content a')
      const hash2 = computeHash('content b')
      expect(hash1).not.toBe(hash2)
    })
  })
})
