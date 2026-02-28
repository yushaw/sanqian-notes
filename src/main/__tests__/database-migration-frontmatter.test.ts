import { describe, expect, it } from 'vitest'
import { collectLegacyFrontmatterContentUpdates, migrateLegacyFrontmatterDocContent } from '../database'

describe('legacy frontmatter content migration', () => {
  it('converts leading yaml-frontmatter codeBlock to frontmatter node', () => {
    const legacy = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          attrs: { language: 'yaml-frontmatter', blockId: 'abc123' },
          content: [{ type: 'text', text: 'tags:\n  - AI' }],
        },
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Title' }],
        },
      ],
    })

    const migrated = migrateLegacyFrontmatterDocContent(legacy)
    expect(migrated).not.toBeNull()

    const parsed = JSON.parse(migrated!) as {
      type: string
      content: Array<{ type: string; attrs?: Record<string, unknown>; content?: unknown[] }>
    }

    expect(parsed.type).toBe('doc')
    expect(parsed.content[0]?.type).toBe('frontmatter')
    expect(parsed.content[0]?.attrs).toEqual({ blockId: 'abc123' })
    expect(parsed.content[1]?.type).toBe('heading')
  })

  it('returns null when document is already using frontmatter node', () => {
    const content = JSON.stringify({
      type: 'doc',
      content: [{ type: 'frontmatter', content: [{ type: 'text', text: 'tags:\n  - AI' }] }],
    })

    expect(migrateLegacyFrontmatterDocContent(content)).toBeNull()
  })

  it('returns null when yaml-frontmatter codeBlock is not the first node', () => {
    const content = JSON.stringify({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'codeBlock', attrs: { language: 'yaml-frontmatter' }, content: [{ type: 'text', text: 'tags:\n  - AI' }] },
      ],
    })

    expect(migrateLegacyFrontmatterDocContent(content)).toBeNull()
  })

  it('returns null for non-json content', () => {
    expect(migrateLegacyFrontmatterDocContent('# plain markdown')).toBeNull()
  })

  it('collects only notes that require migration', () => {
    const notes = [
      {
        id: 'a',
        content: JSON.stringify({
          type: 'doc',
          content: [{ type: 'codeBlock', attrs: { language: 'yaml-frontmatter' }, content: [{ type: 'text', text: 'k: v' }] }],
        }),
      },
      {
        id: 'b',
        content: JSON.stringify({
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
        }),
      },
      {
        id: 'c',
        content: 'not-json',
      },
    ]

    const updates = collectLegacyFrontmatterContentUpdates(notes)
    expect(updates).toHaveLength(1)
    expect(updates[0]?.id).toBe('a')

    const migratedDoc = JSON.parse(updates[0]!.content) as { content: Array<{ type: string }> }
    expect(migratedDoc.content[0]?.type).toBe('frontmatter')
  })
})
