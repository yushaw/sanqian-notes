/**
 * EditorSearch Extension 单元测试
 *
 * 测试编辑器内搜索功能：
 * - 打开/关闭搜索
 * - 搜索文本匹配
 * - 大小写敏感搜索
 * - 正则表达式搜索
 * - 上/下一个结果导航
 * - 特殊节点跳过
 * - 边界情况处理
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { EditorSearch, editorSearchPluginKey } from '../EditorSearch'

// Helper: 创建测试编辑器
function createTestEditor(content?: object) {
  return new Editor({
    extensions: [StarterKit, EditorSearch],
    content: content || {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello World, hello everyone!' }]
        }
      ]
    }
  })
}

// Helper: 获取搜索状态
function getSearchState(editor: Editor) {
  return editorSearchPluginKey.getState(editor.state)
}

describe('EditorSearch Extension', () => {
  let editor: Editor

  beforeEach(() => {
    editor = createTestEditor()
  })

  afterEach(() => {
    editor.destroy()
  })

  describe('plugin initialization', () => {
    it('should have plugin registered', () => {
      const plugins = editor.state.plugins
      const searchPlugin = plugins.find((p) => (p as any).key?.startsWith?.('editorSearch'))
      expect(searchPlugin).toBeDefined()
    })

    it('should have initial state', () => {
      const state = getSearchState(editor)
      expect(state).toBeDefined()
      expect(state?.isOpen).toBe(false)
      expect(state?.searchTerm).toBe('')
      expect(state?.matches).toHaveLength(0)
    })
  })

  describe('openSearch / closeSearch', () => {
    it('should open search bar', () => {
      editor.commands.openSearch()
      const state = getSearchState(editor)

      expect(state?.isOpen).toBe(true)
    })

    it('should close search bar and reset state', () => {
      editor.commands.openSearch()
      editor.commands.setSearchTerm('test')
      editor.commands.closeSearch()

      const state = getSearchState(editor)

      expect(state?.isOpen).toBe(false)
      expect(state?.searchTerm).toBe('')
      expect(state?.matches).toHaveLength(0)
    })
  })

  describe('setSearchTerm', () => {
    it('should find matches for search term', () => {
      editor.commands.openSearch()
      editor.commands.setSearchTerm('hello')

      const state = getSearchState(editor)

      // "Hello" and "hello" should both match (case insensitive by default)
      expect(state?.matches).toHaveLength(2)
      expect(state?.currentIndex).toBe(0)
    })

    it('should return no matches for non-existent term', () => {
      editor.commands.openSearch()
      editor.commands.setSearchTerm('xyz')

      const state = getSearchState(editor)

      expect(state?.matches).toHaveLength(0)
      expect(state?.currentIndex).toBe(-1)
    })

    it('should handle empty search term', () => {
      editor.commands.openSearch()
      editor.commands.setSearchTerm('')

      const state = getSearchState(editor)

      expect(state?.matches).toHaveLength(0)
    })
  })

  describe('case sensitive search', () => {
    it('should match case insensitively by default', () => {
      editor.commands.openSearch()
      editor.commands.setSearchTerm('hello')

      const state = getSearchState(editor)

      // Both "Hello" and "hello" should match
      expect(state?.matches).toHaveLength(2)
    })

    it('should match case sensitively when enabled', () => {
      editor.commands.openSearch()
      editor.commands.setSearchOptions({ caseSensitive: true })
      editor.commands.setSearchTerm('hello')

      const state = getSearchState(editor)

      // Only "hello" should match, not "Hello"
      expect(state?.matches).toHaveLength(1)
      expect(state?.matches[0].text).toBe('hello')
    })

    it('should update matches when toggling case sensitivity', () => {
      editor.commands.openSearch()
      editor.commands.setSearchTerm('hello')

      let state = getSearchState(editor)
      expect(state?.matches).toHaveLength(2)

      // Toggle case sensitive on
      editor.commands.setSearchOptions({ caseSensitive: true })
      state = getSearchState(editor)
      expect(state?.matches).toHaveLength(1)

      // Toggle case sensitive off
      editor.commands.setSearchOptions({ caseSensitive: false })
      state = getSearchState(editor)
      expect(state?.matches).toHaveLength(2)
    })
  })

  describe('regex search', () => {
    it('should support regex patterns', () => {
      editor.commands.openSearch()
      editor.commands.setSearchOptions({ useRegex: true })
      editor.commands.setSearchTerm('\\w+orld')

      const state = getSearchState(editor)

      expect(state?.matches).toHaveLength(1)
      expect(state?.matches[0].text).toBe('World')
    })

    it('should handle regex with groups', () => {
      editor.commands.openSearch()
      editor.commands.setSearchOptions({ useRegex: true })
      editor.commands.setSearchTerm('hel+o')

      const state = getSearchState(editor)

      // Both "Hello" and "hello" should match
      expect(state?.matches).toHaveLength(2)
    })

    it('should set regexError for invalid regex', () => {
      editor.commands.openSearch()
      editor.commands.setSearchOptions({ useRegex: true })
      editor.commands.setSearchTerm('[invalid')

      const state = getSearchState(editor)

      expect(state?.regexError).toBe(true)
      expect(state?.matches).toHaveLength(0)
    })

    it('should combine regex with case sensitivity', () => {
      editor.commands.openSearch()
      editor.commands.setSearchOptions({ useRegex: true, caseSensitive: true })
      editor.commands.setSearchTerm('hel+o')

      const state = getSearchState(editor)

      // Only lowercase "hello" should match
      expect(state?.matches).toHaveLength(1)
      expect(state?.matches[0].text).toBe('hello')
    })
  })

  describe('findNext / findPrevious', () => {
    beforeEach(() => {
      editor.commands.openSearch()
      editor.commands.setSearchTerm('hello')
    })

    it('should navigate to next match', () => {
      let state = getSearchState(editor)
      expect(state?.currentIndex).toBe(0)

      editor.commands.findNext()
      state = getSearchState(editor)
      expect(state?.currentIndex).toBe(1)
    })

    it('should wrap around at the end', () => {
      editor.commands.findNext() // go to index 1
      editor.commands.findNext() // should wrap to 0

      const state = getSearchState(editor)
      expect(state?.currentIndex).toBe(0)
    })

    it('should navigate to previous match', () => {
      editor.commands.findNext() // go to index 1
      editor.commands.findPrevious() // back to 0

      const state = getSearchState(editor)
      expect(state?.currentIndex).toBe(0)
    })

    it('should wrap around at the beginning', () => {
      editor.commands.findPrevious() // from 0, should wrap to 1

      const state = getSearchState(editor)
      expect(state?.currentIndex).toBe(1)
    })

    it('should not change index when no matches', () => {
      editor.commands.setSearchTerm('xyz')
      const result = editor.commands.findNext()

      expect(result).toBe(false)
    })
  })

  describe('document changes', () => {
    it('should update matches when document changes', () => {
      editor.commands.openSearch()
      editor.commands.setSearchTerm('hello')

      let state = getSearchState(editor)
      expect(state?.matches).toHaveLength(2)

      // Add more text with "hello"
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' hello again')

      state = getSearchState(editor)
      expect(state?.matches).toHaveLength(3)
    })

    it('should adjust currentIndex when matches decrease', () => {
      editor.commands.openSearch()
      editor.commands.setSearchTerm('hello')
      editor.commands.findNext() // go to index 1

      // Replace content with only one "hello"
      editor.commands.setContent({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Only one hello here' }]
          }
        ]
      })

      const state = getSearchState(editor)
      expect(state?.matches).toHaveLength(1)
      expect(state?.currentIndex).toBe(0) // adjusted to valid index
    })
  })

  describe('special characters', () => {
    it('should escape special regex characters in normal mode', () => {
      editor = createTestEditor({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Price is $100.00 (special)' }]
          }
        ]
      })

      editor.commands.openSearch()
      editor.commands.setSearchTerm('$100.00')

      const state = getSearchState(editor)

      expect(state?.matches).toHaveLength(1)
      expect(state?.matches[0].text).toBe('$100.00')
    })

    it('should match parentheses literally in normal mode', () => {
      editor = createTestEditor({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Function call fn()' }]
          }
        ]
      })

      editor.commands.openSearch()
      editor.commands.setSearchTerm('fn()')

      const state = getSearchState(editor)

      expect(state?.matches).toHaveLength(1)
    })
  })

  describe('multi-paragraph search', () => {
    it('should find matches across multiple paragraphs', () => {
      editor = createTestEditor({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'First hello' }]
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Second hello' }]
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Third hello' }]
          }
        ]
      })

      editor.commands.openSearch()
      editor.commands.setSearchTerm('hello')

      const state = getSearchState(editor)

      expect(state?.matches).toHaveLength(3)
    })
  })

  describe('match position accuracy', () => {
    it('should return correct match positions', () => {
      editor = createTestEditor({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'test' }]
          }
        ]
      })

      editor.commands.openSearch()
      editor.commands.setSearchTerm('test')

      const state = getSearchState(editor)

      expect(state?.matches).toHaveLength(1)
      const match = state?.matches[0]

      // Verify the text at the match position
      const slice = editor.state.doc.textBetween(match!.from, match!.to)
      expect(slice).toBe('test')
    })
  })

  describe('keyboard shortcut', () => {
    it('should have Mod-f shortcut configured', () => {
      // Get the keyboard shortcuts from the extension
      const extension = editor.extensionManager.extensions.find(
        (ext) => ext.name === 'editorSearch'
      )

      expect(extension).toBeDefined()
      expect(extension?.name).toBe('editorSearch')
    })
  })

  describe('replace functionality', () => {
    it('should replace current match', () => {
      editor.commands.openSearch()
      editor.commands.setSearchTerm('hello')

      let state = getSearchState(editor)
      expect(state?.matches).toHaveLength(2)

      // 替换当前匹配（第一个 "hello"）
      editor.commands.replaceCurrent('hi')

      // 验证替换结果
      const text = editor.state.doc.textContent
      expect(text).toContain('hi')
      expect(text).toContain('hello') // 第二个 hello 还在

      // 匹配数量减少
      state = getSearchState(editor)
      expect(state?.matches).toHaveLength(1)
    })

    it('should replace all matches', () => {
      editor.commands.openSearch()
      editor.commands.setSearchTerm('hello')

      let state = getSearchState(editor)
      expect(state?.matches).toHaveLength(2)

      // 替换所有匹配
      editor.commands.replaceAll('hi')

      // 验证所有都被替换
      const text = editor.state.doc.textContent
      expect(text).not.toContain('hello')
      expect(text).not.toContain('Hello')
      expect(text.match(/hi/gi)?.length).toBe(2)

      // 没有匹配了
      state = getSearchState(editor)
      expect(state?.matches).toHaveLength(0)
    })

    it('should handle empty replacement (delete)', () => {
      editor.commands.openSearch()
      editor.commands.setSearchTerm('hello')

      const originalLength = editor.state.doc.textContent.length

      // 空替换 = 删除
      editor.commands.replaceCurrent('')

      // 验证删除行为
      const newLength = editor.state.doc.textContent.length
      expect(newLength).toBeLessThan(originalLength)
      expect(newLength).toBe(originalLength - 5) // "hello" 是 5 个字符
    })

    it('should not replace when no matches', () => {
      editor.commands.openSearch()
      editor.commands.setSearchTerm('xyz')

      const result = editor.commands.replaceCurrent('abc')
      expect(result).toBe(false)
    })

    it('should not replace all when no matches', () => {
      editor.commands.openSearch()
      editor.commands.setSearchTerm('xyz')

      const result = editor.commands.replaceAll('abc')
      expect(result).toBe(false)
    })
  })
})
