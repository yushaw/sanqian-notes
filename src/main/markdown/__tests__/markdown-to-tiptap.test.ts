/**
 * Markdown to TipTap JSON 转换测试
 */
import { describe, it, expect } from 'vitest'
import { markdownToTiptap } from '../markdown-to-tiptap'

// Helper to safely access nested properties
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNode = any

describe('markdownToTiptap', () => {
  describe('基础文本', () => {
    it('空字符串返回空文档', () => {
      const result = markdownToTiptap('')
      expect(result).toEqual({ type: 'doc', content: [] })
    })

    it('单行文本', () => {
      const result = markdownToTiptap('Hello World') as AnyNode
      expect(result.type).toBe('doc')
      expect(result.content).toHaveLength(1)
      expect(result.content[0].type).toBe('paragraph')
      expect(result.content[0].content[0].text).toBe('Hello World')
    })

    it('多行文本', () => {
      const result = markdownToTiptap('第一段\n\n第二段') as AnyNode
      // 两个段落之间的空行会生成一个空段落
      expect(result.content).toHaveLength(3)
      expect(result.content[0].content[0].text).toBe('第一段')
      expect(result.content[1].type).toBe('paragraph') // 空段落
      expect(result.content[2].content[0].text).toBe('第二段')
    })
  })

  describe('标题', () => {
    it('一级标题', () => {
      const result = markdownToTiptap('# 大标题') as AnyNode
      expect(result.content[0].type).toBe('heading')
      expect(result.content[0].attrs.level).toBe(1)
      expect(result.content[0].content[0].text).toBe('大标题')
    })

    it('各级标题', () => {
      const result = markdownToTiptap('## H2\n\n### H3\n\n#### H4') as AnyNode
      expect(result.content[0].attrs.level).toBe(2)
      expect(result.content[1].attrs.level).toBe(3)
      expect(result.content[2].attrs.level).toBe(4)
    })
  })

  describe('文本格式', () => {
    it('粗体', () => {
      const result = markdownToTiptap('**粗体文字**') as AnyNode
      const text = result.content[0].content[0]
      expect(text.text).toBe('粗体文字')
      expect(text.marks).toContainEqual({ type: 'bold' })
    })

    it('斜体', () => {
      const result = markdownToTiptap('*斜体文字*') as AnyNode
      const text = result.content[0].content[0]
      expect(text.text).toBe('斜体文字')
      expect(text.marks).toContainEqual({ type: 'italic' })
    })

    it('删除线', () => {
      const result = markdownToTiptap('~~删除文字~~') as AnyNode
      const text = result.content[0].content[0]
      expect(text.text).toBe('删除文字')
      expect(text.marks).toContainEqual({ type: 'strike' })
    })

    it('行内代码', () => {
      const result = markdownToTiptap('`const x = 1`') as AnyNode
      const text = result.content[0].content[0]
      expect(text.text).toBe('const x = 1')
      expect(text.marks).toContainEqual({ type: 'code' })
    })

    it('链接', () => {
      const result = markdownToTiptap('[点击这里](https://example.com)') as AnyNode
      const text = result.content[0].content[0]
      expect(text.text).toBe('点击这里')
      expect(text.marks).toContainEqual({ type: 'link', attrs: { href: 'https://example.com' } })
    })

    it('高亮', () => {
      const result = markdownToTiptap('==高亮文字==') as AnyNode
      const text = result.content[0].content[0]
      expect(text.text).toBe('高亮文字')
      expect(text.marks).toContainEqual({ type: 'highlight' })
    })

    it('下划线', () => {
      const result = markdownToTiptap('++下划线文字++') as AnyNode
      const text = result.content[0].content[0]
      expect(text.text).toBe('下划线文字')
      expect(text.marks).toContainEqual({ type: 'underline' })
    })

    it('混合格式', () => {
      const result = markdownToTiptap('普通**粗体**和*斜体*') as AnyNode
      const content = result.content[0].content
      expect(content).toHaveLength(4)
      expect(content[0].text).toBe('普通')
      expect(content[1].text).toBe('粗体')
      expect(content[1].marks).toContainEqual({ type: 'bold' })
      expect(content[2].text).toBe('和')
      expect(content[3].text).toBe('斜体')
      expect(content[3].marks).toContainEqual({ type: 'italic' })
    })
  })

  describe('列表', () => {
    it('无序列表', () => {
      const result = markdownToTiptap('- 项目一\n- 项目二') as AnyNode
      expect(result.content[0].type).toBe('bulletList')
      expect(result.content[0].content).toHaveLength(2)
      expect(result.content[0].content[0].type).toBe('listItem')
    })

    it('有序列表', () => {
      const result = markdownToTiptap('1. 第一步\n2. 第二步') as AnyNode
      expect(result.content[0].type).toBe('orderedList')
      expect(result.content[0].content).toHaveLength(2)
    })

    it('任务列表', () => {
      const result = markdownToTiptap('- [ ] 待办\n- [x] 已完成') as AnyNode
      expect(result.content[0].type).toBe('taskList')
      expect(result.content[0].content[0].attrs.checked).toBe(false)
      expect(result.content[0].content[1].attrs.checked).toBe(true)
    })
  })

  describe('代码块', () => {
    it('带语言的代码块', () => {
      const result = markdownToTiptap('```javascript\nconst x = 1\n```') as AnyNode
      expect(result.content[0].type).toBe('codeBlock')
      expect(result.content[0].attrs.language).toBe('javascript')
      expect(result.content[0].content[0].text).toBe('const x = 1')
    })

    it('无语言的代码块', () => {
      const result = markdownToTiptap('```\nsome code\n```') as AnyNode
      expect(result.content[0].type).toBe('codeBlock')
      expect(result.content[0].attrs.language).toBe('')
    })
  })

  describe('引用', () => {
    it('单行引用', () => {
      const result = markdownToTiptap('> 这是引用') as AnyNode
      expect(result.content[0].type).toBe('blockquote')
      expect(result.content[0].content[0].content[0].text).toBe('这是引用')
    })
  })

  describe('分割线', () => {
    it('水平分割线', () => {
      const result = markdownToTiptap('上面\n\n---\n\n下面') as AnyNode
      // 空行会生成空段落，所以 horizontalRule 在索引 2
      expect(result.content[2].type).toBe('horizontalRule')
    })
  })

  describe('图片', () => {
    it('基础图片', () => {
      const result = markdownToTiptap('![示例图片](https://example.com/image.png)') as AnyNode
      expect(result.content[0].type).toBe('paragraph')
      expect(result.content[0].content[0].type).toBe('image')
      expect(result.content[0].content[0].attrs.src).toBe('https://example.com/image.png')
      expect(result.content[0].content[0].attrs.alt).toBe('示例图片')
    })
  })

  describe('表格', () => {
    it('基础表格', () => {
      const result = markdownToTiptap('| 列A | 列B |\n| --- | --- |\n| 值1 | 值2 |') as AnyNode
      expect(result.content[0].type).toBe('table')
      expect(result.content[0].content).toHaveLength(2) // header + 1 row
      expect(result.content[0].content[0].content[0].type).toBe('tableHeader')
    })

    it('HTML 表格', () => {
      const html = '<table border="1"><tr><td>A</td><td>B</td></tr><tr><td>1</td><td>2</td></tr></table>'
      const result = markdownToTiptap(html) as AnyNode
      expect(result.content[0].type).toBe('table')
      expect(result.content[0].content).toHaveLength(2) // 2 rows
      expect(result.content[0].content[0].content[0].type).toBe('tableHeader') // first row is header
      expect(result.content[0].content[0].content[0].content[0].content[0].text).toBe('A')
      expect(result.content[0].content[1].content[0].type).toBe('tableCell')
      expect(result.content[0].content[1].content[0].content[0].content[0].text).toBe('1')
    })

    it('HTML 表格带 colspan', () => {
      const html = '<table><tr><td colspan="2">Header</td></tr><tr><td>A</td><td>B</td></tr></table>'
      const result = markdownToTiptap(html) as AnyNode
      expect(result.content[0].type).toBe('table')
      expect(result.content[0].content[0].content[0].attrs?.colspan).toBe(2)
    })
  })

  describe('HTML 注释', () => {
    it('HTML 注释转为 htmlComment 节点', () => {
      const result = markdownToTiptap('<!-- This is a comment -->') as AnyNode
      expect(result.content[0].type).toBe('htmlComment')
      expect(result.content[0].attrs.content).toBe('This is a comment')
    })

    it('多行 HTML 注释', () => {
      const result = markdownToTiptap('<!-- Line 1\nLine 2 -->') as AnyNode
      expect(result.content[0].type).toBe('htmlComment')
      expect(result.content[0].attrs.content).toBe('Line 1\nLine 2')
    })

    it('混合内容中的 HTML 注释', () => {
      const result = markdownToTiptap('Hello\n\n<!-- Comment -->\n\nWorld') as AnyNode
      expect(result.content.some((n: AnyNode) => n.type === 'htmlComment')).toBe(true)
    })
  })

  describe('自定义语法', () => {
    it('行内数学公式', () => {
      const result = markdownToTiptap('公式：$E=mc^2$') as AnyNode
      const content = result.content[0].content
      expect(content).toHaveLength(2)
      expect(content[1].type).toBe('inlineMath')
      expect(content[1].attrs.latex).toBe('E=mc^2')
    })

    it('块级数学公式', () => {
      const result = markdownToTiptap('$$\n\\int_0^\\infty e^{-x^2} dx\n$$') as AnyNode
      expect(result.content[0].type).toBe('mathematics')
      expect(result.content[0].attrs.display).toBe('yes')
    })

    it('Mermaid 图表', () => {
      const result = markdownToTiptap('```mermaid\ngraph TD\n  A --> B\n```') as AnyNode
      expect(result.content[0].type).toBe('mermaid')
      expect(result.content[0].attrs.code).toBe('graph TD\n  A --> B')
    })

    it('Callout', () => {
      const result = markdownToTiptap('> [!note] 注意\n> 这是一个提示') as AnyNode
      expect(result.content[0].type).toBe('callout')
      expect(result.content[0].attrs.type).toBe('note')
      expect(result.content[0].attrs.title).toBe('注意')
    })

    it('Toggle/Details', () => {
      const result = markdownToTiptap('<details>\n<summary>点击展开</summary>\n\n隐藏的内容\n</details>') as AnyNode
      expect(result.content[0].type).toBe('toggle')
      expect(result.content[0].attrs.summary).toBe('点击展开')
      expect(result.content[0].content[0].type).toBe('paragraph')
      expect(result.content[0].content[0].content[0].text).toBe('隐藏的内容')
    })

    it('Toggle 空内容', () => {
      const result = markdownToTiptap('<details>\n<summary>标题</summary>\n</details>') as AnyNode
      expect(result.content[0].type).toBe('toggle')
      expect(result.content[0].attrs.summary).toBe('标题')
      expect(result.content[0].content).toHaveLength(1) // 空段落
    })
  })

  describe('边界情况', () => {
    it('处理 null/undefined', () => {
      expect(markdownToTiptap(null as unknown as string)).toEqual({ type: 'doc', content: [] })
      expect(markdownToTiptap(undefined as unknown as string)).toEqual({ type: 'doc', content: [] })
    })

    it('只有空白字符', () => {
      expect(markdownToTiptap('   \n\n   ')).toEqual({ type: 'doc', content: [] })
    })
  })
})
