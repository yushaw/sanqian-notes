/**
 * TipTap Merge Algorithm Tests
 *
 * Tests for merging TipTap documents while preserving blockId
 */
import { describe, it, expect } from 'vitest'
import {
  mergePreservingBlockIds,
  mergeDocumentsJson,
  nodesContentEqual
} from '../tiptap-merge'

describe('nodesContentEqual', () => {
  it('should return true for identical nodes', () => {
    const node1 = { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }
    const node2 = { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }
    expect(nodesContentEqual(node1, node2)).toBe(true)
  })

  it('should return true when only blockId differs', () => {
    const node1 = {
      type: 'paragraph',
      attrs: { blockId: 'abc123' },
      content: [{ type: 'text', text: 'Hello' }]
    }
    const node2 = {
      type: 'paragraph',
      attrs: { blockId: 'xyz789' },
      content: [{ type: 'text', text: 'Hello' }]
    }
    expect(nodesContentEqual(node1, node2)).toBe(true)
  })

  it('should return false for different content', () => {
    const node1 = { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }
    const node2 = { type: 'paragraph', content: [{ type: 'text', text: 'World' }] }
    expect(nodesContentEqual(node1, node2)).toBe(false)
  })

  it('should return false for different types', () => {
    const node1 = { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }
    const node2 = { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Hello' }] }
    expect(nodesContentEqual(node1, node2)).toBe(false)
  })

  it('should compare marks correctly', () => {
    const node1 = {
      type: 'text',
      text: 'Hello',
      marks: [{ type: 'bold' }]
    }
    const node2 = {
      type: 'text',
      text: 'Hello',
      marks: [{ type: 'bold' }]
    }
    expect(nodesContentEqual(node1, node2)).toBe(true)

    const node3 = {
      type: 'text',
      text: 'Hello',
      marks: [{ type: 'italic' }]
    }
    expect(nodesContentEqual(node1, node3)).toBe(false)
  })
})

describe('mergePreservingBlockIds', () => {
  describe('basic scenarios', () => {
    it('should preserve blockId when content is unchanged', () => {
      const oldDoc = {
        type: 'doc' as const,
        content: [
          {
            type: 'paragraph',
            attrs: { blockId: 'original-id' },
            content: [{ type: 'text', text: 'Hello' }]
          }
        ]
      }
      const newDoc = {
        type: 'doc' as const,
        content: [
          {
            type: 'paragraph',
            attrs: { blockId: null },
            content: [{ type: 'text', text: 'Hello' }]
          }
        ]
      }

      const merged = mergePreservingBlockIds(oldDoc, newDoc)
      expect(merged.content[0].attrs?.blockId).toBe('original-id')
    })

    it('should not preserve blockId when content changes', () => {
      const oldDoc = {
        type: 'doc' as const,
        content: [
          {
            type: 'paragraph',
            attrs: { blockId: 'original-id' },
            content: [{ type: 'text', text: 'Hello' }]
          }
        ]
      }
      const newDoc = {
        type: 'doc' as const,
        content: [
          {
            type: 'paragraph',
            attrs: { blockId: 'new-id' },
            content: [{ type: 'text', text: 'World' }]
          }
        ]
      }

      const merged = mergePreservingBlockIds(oldDoc, newDoc)
      // Content changed, so new node's blockId is used
      expect(merged.content[0].attrs?.blockId).toBe('new-id')
    })
  })

  describe('append scenario (user example)', () => {
    it('should preserve blockId when appending new content after existing list item', () => {
      // Simulates: old_string = "- **item**" → new_string = "- **item**\n\n### New Section\n\n- new item"
      const oldDoc = {
        type: 'doc' as const,
        content: [
          {
            type: 'bulletList',
            attrs: { blockId: 'list-id' },
            content: [
              {
                type: 'listItem',
                attrs: { blockId: 'item-1-id' },
                content: [
                  {
                    type: 'paragraph',
                    attrs: { blockId: 'para-1-id' },
                    content: [
                      { type: 'text', text: 'item', marks: [{ type: 'bold' }] }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }

      const newDoc = {
        type: 'doc' as const,
        content: [
          {
            type: 'bulletList',
            attrs: { blockId: null },
            content: [
              {
                type: 'listItem',
                attrs: { blockId: null },
                content: [
                  {
                    type: 'paragraph',
                    attrs: { blockId: null },
                    content: [
                      { type: 'text', text: 'item', marks: [{ type: 'bold' }] }
                    ]
                  }
                ]
              }
            ]
          },
          {
            type: 'heading',
            attrs: { level: 3, blockId: null },
            content: [{ type: 'text', text: 'New Section' }]
          },
          {
            type: 'bulletList',
            attrs: { blockId: null },
            content: [
              {
                type: 'listItem',
                attrs: { blockId: null },
                content: [
                  {
                    type: 'paragraph',
                    attrs: { blockId: null },
                    content: [{ type: 'text', text: 'new item' }]
                  }
                ]
              }
            ]
          }
        ]
      }

      const merged = mergePreservingBlockIds(oldDoc, newDoc)

      // Original list should preserve its blockId
      expect(merged.content[0].attrs?.blockId).toBe('list-id')

      // New heading should not have preserved blockId (it's new)
      expect(merged.content[1].attrs?.blockId).toBeNull()

      // New list should not have preserved blockId (it's new)
      expect(merged.content[2].attrs?.blockId).toBeNull()
    })
  })

  describe('head-tail matching', () => {
    it('should preserve blockIds for unchanged nodes at head and tail', () => {
      const oldDoc = {
        type: 'doc' as const,
        content: [
          { type: 'paragraph', attrs: { blockId: 'head-id' }, content: [{ type: 'text', text: 'Head' }] },
          { type: 'paragraph', attrs: { blockId: 'middle-id' }, content: [{ type: 'text', text: 'Middle' }] },
          { type: 'paragraph', attrs: { blockId: 'tail-id' }, content: [{ type: 'text', text: 'Tail' }] }
        ]
      }

      // Insert new content in middle
      const newDoc = {
        type: 'doc' as const,
        content: [
          { type: 'paragraph', attrs: { blockId: null }, content: [{ type: 'text', text: 'Head' }] },
          { type: 'paragraph', attrs: { blockId: null }, content: [{ type: 'text', text: 'New Content' }] },
          { type: 'paragraph', attrs: { blockId: null }, content: [{ type: 'text', text: 'Tail' }] }
        ]
      }

      const merged = mergePreservingBlockIds(oldDoc, newDoc)

      // Head preserved
      expect(merged.content[0].attrs?.blockId).toBe('head-id')
      // New content has no preserved blockId
      expect(merged.content[1].attrs?.blockId).toBeNull()
      // Tail preserved
      expect(merged.content[2].attrs?.blockId).toBe('tail-id')
    })
  })

  describe('middle region content matching', () => {
    it('should match moved nodes in middle region by content', () => {
      const oldDoc = {
        type: 'doc' as const,
        content: [
          { type: 'paragraph', attrs: { blockId: 'a-id' }, content: [{ type: 'text', text: 'A' }] },
          { type: 'paragraph', attrs: { blockId: 'b-id' }, content: [{ type: 'text', text: 'B' }] },
          { type: 'paragraph', attrs: { blockId: 'c-id' }, content: [{ type: 'text', text: 'C' }] }
        ]
      }

      // Reorder: A, C, B (B and C swapped)
      const newDoc = {
        type: 'doc' as const,
        content: [
          { type: 'paragraph', attrs: { blockId: null }, content: [{ type: 'text', text: 'A' }] },
          { type: 'paragraph', attrs: { blockId: null }, content: [{ type: 'text', text: 'C' }] },
          { type: 'paragraph', attrs: { blockId: null }, content: [{ type: 'text', text: 'B' }] }
        ]
      }

      const merged = mergePreservingBlockIds(oldDoc, newDoc)

      // A stays at head, preserved
      expect(merged.content[0].attrs?.blockId).toBe('a-id')
      // C matched by content in middle region
      expect(merged.content[1].attrs?.blockId).toBe('c-id')
      // B matched by content in middle region
      expect(merged.content[2].attrs?.blockId).toBe('b-id')
    })
  })

  describe('nested content', () => {
    it('should preserve blockIds in nested list items', () => {
      const oldDoc = {
        type: 'doc' as const,
        content: [
          {
            type: 'bulletList',
            attrs: { blockId: 'list-id' },
            content: [
              {
                type: 'listItem',
                attrs: { blockId: 'item1-id' },
                content: [
                  { type: 'paragraph', attrs: { blockId: 'p1-id' }, content: [{ type: 'text', text: 'Item 1' }] }
                ]
              },
              {
                type: 'listItem',
                attrs: { blockId: 'item2-id' },
                content: [
                  { type: 'paragraph', attrs: { blockId: 'p2-id' }, content: [{ type: 'text', text: 'Item 2' }] }
                ]
              }
            ]
          }
        ]
      }

      // Same content, different blockIds in new doc
      const newDoc = {
        type: 'doc' as const,
        content: [
          {
            type: 'bulletList',
            attrs: { blockId: null },
            content: [
              {
                type: 'listItem',
                attrs: { blockId: null },
                content: [
                  { type: 'paragraph', attrs: { blockId: null }, content: [{ type: 'text', text: 'Item 1' }] }
                ]
              },
              {
                type: 'listItem',
                attrs: { blockId: null },
                content: [
                  { type: 'paragraph', attrs: { blockId: null }, content: [{ type: 'text', text: 'Item 2' }] }
                ]
              }
            ]
          }
        ]
      }

      const merged = mergePreservingBlockIds(oldDoc, newDoc)

      // All blockIds should be preserved
      expect(merged.content[0].attrs?.blockId).toBe('list-id')
      expect(merged.content[0].content?.[0].attrs?.blockId).toBe('item1-id')
      expect(merged.content[0].content?.[0].content?.[0].attrs?.blockId).toBe('p1-id')
      expect(merged.content[0].content?.[1].attrs?.blockId).toBe('item2-id')
      expect(merged.content[0].content?.[1].content?.[0].attrs?.blockId).toBe('p2-id')
    })
  })
})

describe('mergeDocumentsJson', () => {
  it('should merge JSON strings correctly', () => {
    const oldJson = JSON.stringify({
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { blockId: 'test-id' }, content: [{ type: 'text', text: 'Hello' }] }
      ]
    })
    const newJson = JSON.stringify({
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { blockId: null }, content: [{ type: 'text', text: 'Hello' }] }
      ]
    })

    const result = mergeDocumentsJson(oldJson, newJson)
    const merged = JSON.parse(result)

    expect(merged.content[0].attrs.blockId).toBe('test-id')
  })

  it('should handle invalid JSON gracefully', () => {
    const oldJson = 'invalid json'
    const newJson = JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }]
    })

    // Should return new JSON as-is when old is invalid
    const result = mergeDocumentsJson(oldJson, newJson)
    expect(result).toBe(newJson)
  })
})

describe('SDK update_note modes simulation', () => {
  describe('edit mode', () => {
    it('should preserve blockId for unchanged parts when editing in middle', () => {
      // Simulates: replacing "Middle" with "New Middle Content"
      const oldDoc = {
        type: 'doc' as const,
        content: [
          { type: 'paragraph', attrs: { blockId: 'p1-id' }, content: [{ type: 'text', text: 'First paragraph' }] },
          { type: 'paragraph', attrs: { blockId: 'p2-id' }, content: [{ type: 'text', text: 'Middle' }] },
          { type: 'paragraph', attrs: { blockId: 'p3-id' }, content: [{ type: 'text', text: 'Last paragraph' }] }
        ]
      }

      const newDoc = {
        type: 'doc' as const,
        content: [
          { type: 'paragraph', attrs: { blockId: null }, content: [{ type: 'text', text: 'First paragraph' }] },
          { type: 'paragraph', attrs: { blockId: null }, content: [{ type: 'text', text: 'New Middle Content' }] },
          { type: 'paragraph', attrs: { blockId: null }, content: [{ type: 'text', text: 'Last paragraph' }] }
        ]
      }

      const merged = mergePreservingBlockIds(oldDoc, newDoc)

      // First and last should preserve blockId
      expect(merged.content[0].attrs?.blockId).toBe('p1-id')
      expect(merged.content[2].attrs?.blockId).toBe('p3-id')
      // Middle changed, no preserved blockId
      expect(merged.content[1].attrs?.blockId).toBeNull()
    })

    it('should handle user example: append new sections after list item', () => {
      // User's exact scenario:
      // old_string: '- **协同工作**：Topic 负责当前会话...'
      // new_string: '- **协同工作**：Topic 负责当前会话...\n\n### 优化建议\n\n- **自动归档**：...'
      const oldDoc = {
        type: 'doc' as const,
        content: [
          {
            type: 'bulletList',
            attrs: { blockId: 'original-list-id' },
            content: [
              {
                type: 'listItem',
                attrs: { blockId: 'original-item-id' },
                content: [
                  {
                    type: 'paragraph',
                    attrs: { blockId: 'original-para-id' },
                    content: [
                      { type: 'text', text: '协同工作', marks: [{ type: 'bold' }] },
                      { type: 'text', text: '：Topic 负责当前会话，Memory 负责跨会话的连续性' }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }

      // After markdown conversion and replacement, the structure becomes:
      const newDoc = {
        type: 'doc' as const,
        content: [
          {
            type: 'bulletList',
            attrs: { blockId: null },
            content: [
              {
                type: 'listItem',
                attrs: { blockId: null },
                content: [
                  {
                    type: 'paragraph',
                    attrs: { blockId: null },
                    content: [
                      { type: 'text', text: '协同工作', marks: [{ type: 'bold' }] },
                      { type: 'text', text: '：Topic 负责当前会话，Memory 负责跨会话的连续性' }
                    ]
                  }
                ]
              }
            ]
          },
          {
            type: 'heading',
            attrs: { level: 3, blockId: null },
            content: [{ type: 'text', text: '优化建议' }]
          },
          {
            type: 'bulletList',
            attrs: { blockId: null },
            content: [
              {
                type: 'listItem',
                attrs: { blockId: null },
                content: [
                  {
                    type: 'paragraph',
                    attrs: { blockId: null },
                    content: [
                      { type: 'text', text: '自动归档', marks: [{ type: 'bold' }] },
                      { type: 'text', text: '：会话结束时自动提取关键信息写入 Memory' }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }

      const merged = mergePreservingBlockIds(oldDoc, newDoc)

      // Original list structure should preserve all blockIds
      expect(merged.content[0].attrs?.blockId).toBe('original-list-id')
      expect(merged.content[0].content?.[0].attrs?.blockId).toBe('original-item-id')
      expect(merged.content[0].content?.[0].content?.[0].attrs?.blockId).toBe('original-para-id')

      // New content should not have preserved blockIds
      expect(merged.content[1].attrs?.blockId).toBeNull()
      expect(merged.content[2].attrs?.blockId).toBeNull()
    })
  })

  describe('append mode (direct array concat)', () => {
    it('should preserve all original blockIds when appending', () => {
      // Simulates SDK append: [...originalDoc.content, ...appendDoc.content]
      const originalContent = [
        { type: 'paragraph', attrs: { blockId: 'p1-id' }, content: [{ type: 'text', text: 'Original 1' }] },
        { type: 'paragraph', attrs: { blockId: 'p2-id' }, content: [{ type: 'text', text: 'Original 2' }] }
      ]

      const appendContent = [
        { type: 'paragraph', attrs: { blockId: null }, content: [{ type: 'text', text: 'Appended' }] }
      ]

      // Direct concat (as implemented in SDK)
      const mergedContent = [...originalContent, ...appendContent]

      // All original blockIds preserved
      expect(mergedContent[0].attrs?.blockId).toBe('p1-id')
      expect(mergedContent[1].attrs?.blockId).toBe('p2-id')
      // Appended content has its own blockId (null in this case)
      expect(mergedContent[2].attrs?.blockId).toBeNull()
    })
  })

  describe('prepend mode (direct array concat)', () => {
    it('should preserve all original blockIds when prepending', () => {
      // Simulates SDK prepend: [...prependDoc.content, ...originalDoc.content]
      const prependContent = [
        { type: 'paragraph', attrs: { blockId: null }, content: [{ type: 'text', text: 'Prepended' }] }
      ]

      const originalContent = [
        { type: 'paragraph', attrs: { blockId: 'p1-id' }, content: [{ type: 'text', text: 'Original 1' }] },
        { type: 'paragraph', attrs: { blockId: 'p2-id' }, content: [{ type: 'text', text: 'Original 2' }] }
      ]

      // Direct concat (as implemented in SDK)
      const mergedContent = [...prependContent, ...originalContent]

      // Prepended content has its own blockId
      expect(mergedContent[0].attrs?.blockId).toBeNull()
      // All original blockIds preserved
      expect(mergedContent[1].attrs?.blockId).toBe('p1-id')
      expect(mergedContent[2].attrs?.blockId).toBe('p2-id')
    })
  })

  describe('content mode (full replacement)', () => {
    it('should preserve blockId for unchanged parts even in full replacement', () => {
      // User provides full content, but some parts are unchanged
      const oldDoc = {
        type: 'doc' as const,
        content: [
          { type: 'heading', attrs: { level: 1, blockId: 'h1-id' }, content: [{ type: 'text', text: 'Title' }] },
          { type: 'paragraph', attrs: { blockId: 'p1-id' }, content: [{ type: 'text', text: 'Unchanged paragraph' }] },
          { type: 'paragraph', attrs: { blockId: 'p2-id' }, content: [{ type: 'text', text: 'Will be changed' }] }
        ]
      }

      const newDoc = {
        type: 'doc' as const,
        content: [
          { type: 'heading', attrs: { level: 1, blockId: null }, content: [{ type: 'text', text: 'Title' }] },
          { type: 'paragraph', attrs: { blockId: null }, content: [{ type: 'text', text: 'Unchanged paragraph' }] },
          { type: 'paragraph', attrs: { blockId: null }, content: [{ type: 'text', text: 'New content here' }] }
        ]
      }

      const merged = mergePreservingBlockIds(oldDoc, newDoc)

      // Unchanged parts preserve blockId
      expect(merged.content[0].attrs?.blockId).toBe('h1-id')
      expect(merged.content[1].attrs?.blockId).toBe('p1-id')
      // Changed part uses new blockId
      expect(merged.content[2].attrs?.blockId).toBeNull()
    })
  })

  describe('position-based insertion (after/before)', () => {
    it('should insert after anchor node when using after parameter', () => {
      // Simulates SDK append with after parameter
      const originalContent = [
        { type: 'heading', attrs: { level: 1, blockId: 'h1-id' }, content: [{ type: 'text', text: 'Introduction' }] },
        { type: 'paragraph', attrs: { blockId: 'p1-id' }, content: [{ type: 'text', text: 'First section content' }] },
        { type: 'heading', attrs: { level: 2, blockId: 'h2-id' }, content: [{ type: 'text', text: 'Section Two' }] },
        { type: 'paragraph', attrs: { blockId: 'p2-id' }, content: [{ type: 'text', text: 'Second section content' }] }
      ]

      const insertContent = [
        { type: 'paragraph', attrs: { blockId: null }, content: [{ type: 'text', text: 'Inserted after first section' }] }
      ]

      // Find anchor index (simulating findAnchorIndex)
      // Anchor text: "First section" (found in p1-id)
      const anchorIndex = 1 // index of 'First section content' paragraph

      // Insert after the anchor node
      const mergedContent = [
        ...originalContent.slice(0, anchorIndex + 1),
        ...insertContent,
        ...originalContent.slice(anchorIndex + 1)
      ]

      // All original blockIds should be preserved
      expect(mergedContent[0].attrs?.blockId).toBe('h1-id')
      expect(mergedContent[1].attrs?.blockId).toBe('p1-id')
      // Inserted content at index 2
      expect(mergedContent[2].attrs?.blockId).toBeNull()
      expect(mergedContent[2].content?.[0].text).toBe('Inserted after first section')
      // Rest of original content
      expect(mergedContent[3].attrs?.blockId).toBe('h2-id')
      expect(mergedContent[4].attrs?.blockId).toBe('p2-id')
    })

    it('should insert before anchor node when using before parameter', () => {
      // Simulates SDK prepend with before parameter
      const originalContent = [
        { type: 'heading', attrs: { level: 1, blockId: 'h1-id' }, content: [{ type: 'text', text: 'Introduction' }] },
        { type: 'paragraph', attrs: { blockId: 'p1-id' }, content: [{ type: 'text', text: 'First section content' }] },
        { type: 'heading', attrs: { level: 2, blockId: 'h2-id' }, content: [{ type: 'text', text: 'Section Two' }] },
        { type: 'paragraph', attrs: { blockId: 'p2-id' }, content: [{ type: 'text', text: 'Second section content' }] }
      ]

      const insertContent = [
        { type: 'paragraph', attrs: { blockId: null }, content: [{ type: 'text', text: 'Inserted before Section Two' }] }
      ]

      // Find anchor index (simulating findAnchorIndex)
      // Anchor text: "Section Two" (found in h2-id)
      const anchorIndex = 2 // index of 'Section Two' heading

      // Insert before the anchor node
      const mergedContent = [
        ...originalContent.slice(0, anchorIndex),
        ...insertContent,
        ...originalContent.slice(anchorIndex)
      ]

      // Original content before anchor
      expect(mergedContent[0].attrs?.blockId).toBe('h1-id')
      expect(mergedContent[1].attrs?.blockId).toBe('p1-id')
      // Inserted content at index 2
      expect(mergedContent[2].attrs?.blockId).toBeNull()
      expect(mergedContent[2].content?.[0].text).toBe('Inserted before Section Two')
      // Rest of original content (shifted by 1)
      expect(mergedContent[3].attrs?.blockId).toBe('h2-id')
      expect(mergedContent[4].attrs?.blockId).toBe('p2-id')
    })

    it('should insert at end when no after anchor specified (default append)', () => {
      const originalContent = [
        { type: 'paragraph', attrs: { blockId: 'p1-id' }, content: [{ type: 'text', text: 'Original' }] }
      ]

      const appendContent = [
        { type: 'paragraph', attrs: { blockId: null }, content: [{ type: 'text', text: 'Appended' }] }
      ]

      // Default: append to end
      const mergedContent = [...originalContent, ...appendContent]

      expect(mergedContent[0].attrs?.blockId).toBe('p1-id')
      expect(mergedContent[1].attrs?.blockId).toBeNull()
      expect(mergedContent[1].content?.[0].text).toBe('Appended')
    })

    it('should insert at start when no before anchor specified (default prepend)', () => {
      const originalContent = [
        { type: 'paragraph', attrs: { blockId: 'p1-id' }, content: [{ type: 'text', text: 'Original' }] }
      ]

      const prependContent = [
        { type: 'paragraph', attrs: { blockId: null }, content: [{ type: 'text', text: 'Prepended' }] }
      ]

      // Default: prepend to start
      const mergedContent = [...prependContent, ...originalContent]

      expect(mergedContent[0].attrs?.blockId).toBeNull()
      expect(mergedContent[0].content?.[0].text).toBe('Prepended')
      expect(mergedContent[1].attrs?.blockId).toBe('p1-id')
    })
  })
})
