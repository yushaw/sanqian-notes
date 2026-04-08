/**
 * Markdown to TipTap JSON 转换测试
 */
import { describe, it, expect } from 'vitest'
import { markdownToTiptap } from '../markdown-to-tiptap'

// Helper to safely access nested properties
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
      // 标准 Markdown: \n\n 只是分隔符，不产生空段落
      expect(result.content).toHaveLength(2)
      expect(result.content[0].content[0].text).toBe('第一段')
      expect(result.content[1].content[0].text).toBe('第二段')
    })

    it('文件头 front matter 解析为 frontmatter 专用节点', () => {
      const result = markdownToTiptap(`---
tags:
  - AI
aliases:
  - SEO
---

# 标题
`) as AnyNode

      expect(result.content).toHaveLength(2)
      expect(result.content[0].type).toBe('frontmatter')
      expect(result.content[0].content[0].text).toContain('tags:')
      expect(result.content[0].content[0].text).toContain('aliases:')
      expect(result.content[1].type).toBe('heading')
      expect(result.content[1].content[0].text).toBe('标题')
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

    it('代码标记不与粗体叠加', () => {
      const result = markdownToTiptap('**import `evomap` package**') as AnyNode
      const content = result.content[0].content

      expect(content).toHaveLength(3)
      expect(content[0].text).toBe('import ')
      expect(content[0].marks).toContainEqual({ type: 'bold' })

      expect(content[1].text).toBe('evomap')
      expect(content[1].marks).toContainEqual({ type: 'code' })
      expect((content[1].marks || []).some((mark: { type: string }) => mark.type === 'bold')).toBe(false)

      expect(content[2].text).toBe(' package')
      expect(content[2].marks).toContainEqual({ type: 'bold' })
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
      // \n\n 只是分隔符，horizontalRule 在索引 1
      expect(result.content[0].type).toBe('paragraph')
      expect(result.content[1].type).toBe('horizontalRule')
      expect(result.content[2].type).toBe('paragraph')
    })
  })

  describe('图片', () => {
    it('基础图片', () => {
      const result = markdownToTiptap('![示例图片](https://example.com/image.png)') as AnyNode
      expect(result.content[0].type).toBe('image')
      expect(result.content[0].attrs.src).toBe('https://example.com/image.png')
      expect(result.content[0].attrs.alt).toBe('示例图片')
    })

    it('段落内图片自动拆分为块节点', () => {
      const result = markdownToTiptap('前文 ![示例图片](https://example.com/image.png) 后文') as AnyNode
      expect(result.content).toHaveLength(3)
      expect(result.content[0].type).toBe('paragraph')
      expect(result.content[0].content[0].text).toBe('前文 ')
      expect(result.content[1].type).toBe('image')
      expect(result.content[1].attrs.src).toBe('https://example.com/image.png')
      expect(result.content[2].type).toBe('paragraph')
      expect(result.content[2].content[0].text).toBe(' 后文')
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
    it('AI popup marker 注释转为 aiPopupMark 节点', () => {
      const result = markdownToTiptap('<!-- SQN_AI_POPUP {"popupId":"popup-1","createdAt":123} -->') as AnyNode
      expect(result.content[0].type).toBe('paragraph')
      expect(result.content[0].content[0].type).toBe('aiPopupMark')
      expect(result.content[0].content[0].attrs.popupId).toBe('popup-1')
      expect(result.content[0].content[0].attrs.createdAt).toBe(123)
    })

    it('段落中的 AI popup marker 注释转为行内 aiPopupMark 节点', () => {
      const result = markdownToTiptap('before <!-- SQN_AI_POPUP {"popupId":"popup-inline"} --> after') as AnyNode
      expect(result.content[0].type).toBe('paragraph')
      const paragraphContent = result.content[0].content
      expect(paragraphContent[0].type).toBe('text')
      expect(paragraphContent[0].text).toBe('before ')
      expect(paragraphContent[1].type).toBe('aiPopupMark')
      expect(paragraphContent[1].attrs.popupId).toBe('popup-inline')
      expect(paragraphContent[2].type).toBe('text')
      expect(paragraphContent[2].text).toBe(' after')
    })

    it('兼容 legacy span 形式的 AI popup marker（不残留 fallback 文本）', () => {
      const result = markdownToTiptap(
        'before <span data-ai-popup-mark data-popup-id=\"popup-legacy\" data-created-at=\"123\">✨</span> after'
      ) as AnyNode
      expect(result.content[0].type).toBe('paragraph')
      const paragraphContent = result.content[0].content
      expect(paragraphContent).toHaveLength(3)
      expect(paragraphContent[0]).toEqual({ type: 'text', text: 'before ' })
      expect(paragraphContent[1].type).toBe('aiPopupMark')
      expect(paragraphContent[1].attrs.popupId).toBe('popup-legacy')
      expect(paragraphContent[2]).toEqual({ type: 'text', text: ' after' })
    })

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

    it('行内数学公式不误匹配货币符号', () => {
      const result = markdownToTiptap('Price is $50 and formula is $E=mc^2$') as AnyNode
      const content = result.content[0].content
      // $50 should remain as plain text, only $E=mc^2$ should be inlineMath
      const mathNodes = content.filter((n: AnyNode) => n.type === 'inlineMath')
      expect(mathNodes).toHaveLength(1)
      expect(mathNodes[0].attrs.latex).toBe('E=mc^2')
      // $50 should be in plain text
      const textContent = content
        .filter((n: AnyNode) => n.type === 'text')
        .map((n: AnyNode) => n.text)
        .join('')
      expect(textContent).toContain('$50')
    })

    it('多个行内数学公式', () => {
      const result = markdownToTiptap('$a+b$ and $c+d$') as AnyNode
      const content = result.content[0].content
      const mathNodes = content.filter((n: AnyNode) => n.type === 'inlineMath')
      expect(mathNodes).toHaveLength(2)
      expect(mathNodes[0].attrs.latex).toBe('a+b')
      expect(mathNodes[1].attrs.latex).toBe('c+d')
    })

    it('块级数学公式', () => {
      const result = markdownToTiptap('$$\n\\int_0^\\infty e^{-x^2} dx\n$$') as AnyNode
      // 统一使用 inlineMath + display: 'yes'，包裹在 paragraph 中
      expect(result.content[0].type).toBe('paragraph')
      expect(result.content[0].content[0].type).toBe('inlineMath')
      expect(result.content[0].content[0].attrs.display).toBe('yes')
    })

    it('Mermaid 图表', () => {
      const result = markdownToTiptap('```mermaid\ngraph TD\n  A --> B\n```') as AnyNode
      expect(result.content[0].type).toBe('mermaid')
      expect(result.content[0].attrs.code).toBe('graph TD\n  A --> B')
    })

    it('TOC 代码块转换为 tocBlock 节点', () => {
      const result = markdownToTiptap('```toc\n```') as AnyNode
      expect(result.content[0].type).toBe('tocBlock')
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

    it('零宽空格段落转换为真正的空段落', () => {
      // tiptap-to-markdown 输出 \u200B 来保持空行
      // markdown-to-tiptap 应该将其还原为真正的空段落 { content: [] }
      // 这样用户只需一次退格就能删除空行
      const result = markdownToTiptap('第一段\n\n\u200B\n\n第二段') as AnyNode
      expect(result.content).toHaveLength(3)
      expect(result.content[0].content[0].text).toBe('第一段')
      // 中间应该是真正的空段落，没有内容
      expect(result.content[1].type).toBe('paragraph')
      expect(result.content[1].content).toEqual([])
      expect(result.content[2].content[0].text).toBe('第二段')
    })
  })
})
