import { describe, expect, it } from 'vitest'
import {
  areLocalTagNameListsEqual,
  extractLocalTagNamesFromTiptapContent,
  mapLocalTagNamesToTagWithSource,
  normalizeLocalTagNames,
} from '../local-note-tags'

describe('local-note-tags', () => {
  it('extracts tags from frontmatter and hashtags', () => {
    const tiptap = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'frontmatter',
          content: [{ type: 'text', text: 'tags:\n  - Project\n  - AI\n' }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Ship #Release and #ai today' },
          ],
        },
      ],
    })

    expect(extractLocalTagNamesFromTiptapContent(tiptap)).toEqual(['Project', 'AI', 'Release'])
  })

  it('ignores hashtags inside code/math contexts', () => {
    const tiptap = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Need #real-tag here' },
            { type: 'text', text: ' #fake-inline-code', marks: [{ type: 'code' }] },
          ],
        },
        {
          type: 'codeBlock',
          content: [{ type: 'text', text: 'const x = \"#fake-code-tag\"' }],
        },
        {
          type: 'mathematics',
          attrs: { latex: '#fake-math-tag' },
          content: [{ type: 'text', text: '#fake-math-tag' }],
        },
      ],
    })

    expect(extractLocalTagNamesFromTiptapContent(tiptap)).toEqual(['real-tag'])
  })

  it('normalizes and deduplicates tag names', () => {
    expect(normalizeLocalTagNames(['  #Project ', 'project', 'AI!!!', '', '  '])).toEqual([
      'Project',
      'AI',
    ])
  })

  it('maps local tag names to TagWithSource shape', () => {
    expect(mapLocalTagNamesToTagWithSource(['Project', 'AI'])).toEqual([
      { id: 'local-tag:user:project', name: 'Project', source: 'user' },
      { id: 'local-tag:user:ai', name: 'AI', source: 'user' },
    ])
  })

  it('compares tag lists by semantic equality', () => {
    expect(areLocalTagNameListsEqual(['Project', 'AI'], ['project', 'ai'])).toBe(true)
    expect(areLocalTagNameListsEqual(['Project', 'AI'], ['ai', 'project'])).toBe(true)
    expect(areLocalTagNameListsEqual(['Project'], ['AI'])).toBe(false)
  })
})
