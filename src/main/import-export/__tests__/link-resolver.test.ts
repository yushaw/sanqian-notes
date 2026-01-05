/**
 * 内部链接解析器测试
 */
import { describe, it, expect } from 'vitest'
import { resolveWikiLinksInContent } from '../utils/link-resolver'

describe('resolveWikiLinksInContent', () => {
  it('应该解析简单的 wiki 链接 [[title]]', () => {
    const content = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '参考 [[其他笔记]] 了解更多。' }],
        },
      ],
    })

    const titleToNoteId = new Map([['其他笔记', 'note-123']])

    const result = resolveWikiLinksInContent(content, titleToNoteId)
    const parsed = JSON.parse(result)

    // 应该拆分为多个节点
    expect(parsed.content[0].content.length).toBe(3)

    // 中间节点应该是链接
    const linkNode = parsed.content[0].content[1]
    expect(linkNode.text).toBe('其他笔记')
    expect(linkNode.marks).toBeDefined()
    expect(linkNode.marks[0].type).toBe('link')
    expect(linkNode.marks[0].attrs.href).toBe('sanqian://note/note-123')
  })

  it('应该处理带别名的 wiki 链接 [[title|alias]]', () => {
    const content = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '查看 [[长标题笔记|简称]]。' }],
        },
      ],
    })

    const titleToNoteId = new Map([['长标题笔记', 'note-456']])

    const result = resolveWikiLinksInContent(content, titleToNoteId)
    const parsed = JSON.parse(result)

    const linkNode = parsed.content[0].content[1]
    expect(linkNode.text).toBe('简称') // 显示别名
    expect(linkNode.marks[0].attrs.href).toBe('sanqian://note/note-456')
  })

  it('应该标记未找到的链接', () => {
    const content = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '链接到 [[不存在的笔记]]。' }],
        },
      ],
    })

    const titleToNoteId = new Map<string, string>()

    const result = resolveWikiLinksInContent(content, titleToNoteId)
    const parsed = JSON.parse(result)

    const linkNode = parsed.content[0].content[1]
    expect(linkNode.text).toBe('不存在的笔记')
    expect(linkNode.marks[0].attrs.href).toContain('note-not-found')
  })

  it('应该保留现有的 marks', () => {
    const content = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: '**粗体中的 [[链接]]**',
              marks: [{ type: 'bold' }],
            },
          ],
        },
      ],
    })

    const titleToNoteId = new Map([['链接', 'note-789']])

    const result = resolveWikiLinksInContent(content, titleToNoteId)
    const parsed = JSON.parse(result)

    // 链接节点应该同时有 bold 和 link marks
    const linkNode = parsed.content[0].content.find(
      (n: { text?: string }) => n.text === '链接'
    )
    expect(linkNode).toBeDefined()
    expect(linkNode.marks.length).toBe(2)
    expect(linkNode.marks.some((m: { type: string }) => m.type === 'bold')).toBe(true)
    expect(linkNode.marks.some((m: { type: string }) => m.type === 'link')).toBe(true)
  })

  it('应该处理多个链接', () => {
    const content = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '[[笔记A]] 和 [[笔记B]] 以及 [[笔记C]]' }],
        },
      ],
    })

    const titleToNoteId = new Map([
      ['笔记a', 'id-a'],
      ['笔记b', 'id-b'],
      ['笔记c', 'id-c'],
    ])

    const result = resolveWikiLinksInContent(content, titleToNoteId)
    const parsed = JSON.parse(result)

    // 应该有 5 个节点：链接A, " 和 ", 链接B, " 以及 ", 链接C
    expect(parsed.content[0].content.length).toBe(5)
  })

  it('应该递归处理嵌套节点', () => {
    const content = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: '列表项包含 [[链接]]' }],
                },
              ],
            },
          ],
        },
      ],
    })

    const titleToNoteId = new Map([['链接', 'note-list']])

    const result = resolveWikiLinksInContent(content, titleToNoteId)
    const parsed = JSON.parse(result)

    // 深层嵌套的链接应该被解析
    const paragraph = parsed.content[0].content[0].content[0]
    const linkNode = paragraph.content.find((n: { text?: string }) => n.text === '链接')
    expect(linkNode).toBeDefined()
    expect(linkNode.marks[0].type).toBe('link')
  })

  it('应该处理没有 wiki 链接的内容', () => {
    const content = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '普通文本，没有链接。' }],
        },
      ],
    })

    const titleToNoteId = new Map([['something', 'id']])

    const result = resolveWikiLinksInContent(content, titleToNoteId)
    expect(result).toBe(content) // 应该保持不变
  })

  it('应该处理无效 JSON gracefully', () => {
    const content = 'not valid json'
    const titleToNoteId = new Map<string, string>()

    const result = resolveWikiLinksInContent(content, titleToNoteId)
    expect(result).toBe(content) // 应该返回原内容
  })

  it('应该忽略大小写匹配标题', () => {
    const content = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '链接到 [[My Note]]' }],
        },
      ],
    })

    const titleToNoteId = new Map([['my note', 'note-case']])

    const result = resolveWikiLinksInContent(content, titleToNoteId)
    const parsed = JSON.parse(result)

    const linkNode = parsed.content[0].content[1]
    expect(linkNode.marks[0].attrs.href).toBe('sanqian://note/note-case')
  })

  it('应该处理带 # 锚点的链接', () => {
    const content = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '参考 [[笔记#标题]] 的内容' }],
        },
      ],
    })

    const titleToNoteId = new Map([['笔记', 'note-anchor']])

    const result = resolveWikiLinksInContent(content, titleToNoteId)
    const parsed = JSON.parse(result)

    // 带锚点的链接，显示完整文本但链接到笔记
    const linkNode = parsed.content[0].content[1]
    expect(linkNode.text).toBe('笔记#标题')
  })

  it('应该处理空内容数组', () => {
    const content = JSON.stringify({
      type: 'doc',
      content: [],
    })

    const titleToNoteId = new Map([['test', 'id']])

    const result = resolveWikiLinksInContent(content, titleToNoteId)
    const parsed = JSON.parse(result)

    expect(parsed.content).toEqual([])
  })

  it('应该处理没有 content 的节点', () => {
    const content = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'horizontalRule',
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '[[链接]]' }],
        },
      ],
    })

    const titleToNoteId = new Map([['链接', 'note-hr']])

    const result = resolveWikiLinksInContent(content, titleToNoteId)
    const parsed = JSON.parse(result)

    // horizontalRule 应该保持不变
    expect(parsed.content[0].type).toBe('horizontalRule')
    // paragraph 中的链接应该被解析
    expect(parsed.content[1].content[0].marks[0].type).toBe('link')
  })
})
