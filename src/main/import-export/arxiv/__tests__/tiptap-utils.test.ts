import { describe, expect, it } from 'vitest'
import { prependMarkdownToTiptapContent } from '../tiptap-utils'

function collectText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const n = node as { text?: string; content?: unknown[] }
  const text = n.text || ''
  const children = Array.isArray(n.content) ? n.content.map(collectText).join('') : ''
  return text + children
}

describe('prependMarkdownToTiptapContent', () => {
  it('prepends markdown metadata and preserves existing tiptap body', () => {
    const body = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Introduction' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Body content from PDF parser.' }],
        },
      ],
    })

    const merged = prependMarkdownToTiptapContent('# Paper Title\n\n**Authors:** Alice, Bob', body)
    const parsed = JSON.parse(merged) as { type: string; content: unknown[] }

    expect(parsed.type).toBe('doc')
    expect(Array.isArray(parsed.content)).toBe(true)
    expect(collectText(parsed.content[0])).toContain('Paper Title')
    expect(collectText(parsed)).toContain('Introduction')
    expect(collectText(parsed)).toContain('Body content from PDF parser.')
  })

  it('throws when body content is invalid instead of silently dropping body', () => {
    expect(() => prependMarkdownToTiptapContent('# Only Header', '{invalid-json')).toThrow(
      /Invalid TipTap body/
    )
  })

  it('keeps body unchanged when markdown prefix is empty', () => {
    const body = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Keep me unchanged' }],
        },
      ],
    })

    const merged = prependMarkdownToTiptapContent('', body)
    const parsed = JSON.parse(merged) as { type: string; content: unknown[] }

    expect(parsed.type).toBe('doc')
    expect(collectText(parsed)).toContain('Keep me unchanged')
  })
})
