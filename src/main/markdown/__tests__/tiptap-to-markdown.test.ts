/**
 * TipTap JSON to Markdown 转换测试
 */
import { describe, it, expect } from 'vitest'
import { tiptapToMarkdown } from '../tiptap-to-markdown'
import { markdownToTiptap } from '../markdown-to-tiptap'

describe('tiptapToMarkdown', () => {
  describe('基础文本', () => {
    it('空文档返回空字符串', () => {
      const doc = { type: 'doc', content: [] }
      expect(tiptapToMarkdown(doc)).toBe('')
    })

    it('单个段落', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Hello World' }]
          }
        ]
      }
      expect(tiptapToMarkdown(doc)).toBe('Hello World')
    })

    it('多个段落', () => {
      const doc = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: '第一段' }] },
          { type: 'paragraph', content: [{ type: 'text', text: '第二段' }] }
        ]
      }
      expect(tiptapToMarkdown(doc)).toBe('第一段\n\n第二段')
    })

    it('空段落', () => {
      const doc = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: '前面' }] },
          { type: 'paragraph', content: [] },
          { type: 'paragraph', content: [{ type: 'text', text: '后面' }] }
        ]
      }
      expect(tiptapToMarkdown(doc)).toBe('前面\n\n\n\n后面')
    })
  })

  describe('标题', () => {
    it('一级标题', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [{ type: 'text', text: '大标题' }]
          }
        ]
      }
      expect(tiptapToMarkdown(doc)).toBe('# 大标题')
    })

    it('二级到六级标题', () => {
      const doc = {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'H2' }] },
          { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'H3' }] },
          { type: 'heading', attrs: { level: 4 }, content: [{ type: 'text', text: 'H4' }] },
          { type: 'heading', attrs: { level: 5 }, content: [{ type: 'text', text: 'H5' }] },
          { type: 'heading', attrs: { level: 6 }, content: [{ type: 'text', text: 'H6' }] }
        ]
      }
      expect(tiptapToMarkdown(doc)).toBe('## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6')
    })
  })

  describe('文本格式（marks）', () => {
    it('粗体', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '粗体文字', marks: [{ type: 'bold' }] }]
          }
        ]
      }
      expect(tiptapToMarkdown(doc)).toBe('**粗体文字**')
    })

    it('斜体', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '斜体文字', marks: [{ type: 'italic' }] }]
          }
        ]
      }
      expect(tiptapToMarkdown(doc)).toBe('*斜体文字*')
    })

    it('删除线', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '删除文字', marks: [{ type: 'strike' }] }]
          }
        ]
      }
      expect(tiptapToMarkdown(doc)).toBe('~~删除文字~~')
    })

    it('高亮', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '高亮文字', marks: [{ type: 'highlight' }] }]
          }
        ]
      }
      expect(tiptapToMarkdown(doc)).toBe('==高亮文字==')
    })

    it('行内代码', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'const x = 1', marks: [{ type: 'code' }] }]
          }
        ]
      }
      expect(tiptapToMarkdown(doc)).toBe('`const x = 1`')
    })

    it('链接', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: '点击这里',
                marks: [{ type: 'link', attrs: { href: 'https://example.com' } }]
              }
            ]
          }
        ]
      }
      expect(tiptapToMarkdown(doc)).toBe('[点击这里](https://example.com)')
    })

    it('混合格式', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: '普通' },
              { type: 'text', text: '粗体', marks: [{ type: 'bold' }] },
              { type: 'text', text: '和' },
              { type: 'text', text: '斜体', marks: [{ type: 'italic' }] }
            ]
          }
        ]
      }
      expect(tiptapToMarkdown(doc)).toBe('普通**粗体**和*斜体*')
    })

    it('嵌套格式（粗斜体）', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: '粗斜体', marks: [{ type: 'bold' }, { type: 'italic' }] }
            ]
          }
        ]
      }
      expect(tiptapToMarkdown(doc)).toBe('***粗斜体***')
    })
  })

  describe('列表', () => {
    it('无序列表', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'bulletList',
            content: [
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '项目一' }] }] },
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '项目二' }] }] }
            ]
          }
        ]
      }
      expect(tiptapToMarkdown(doc)).toBe('- 项目一\n- 项目二')
    })

    it('有序列表', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'orderedList',
            content: [
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一步' }] }] },
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '第二步' }] }] }
            ]
          }
        ]
      }
      expect(tiptapToMarkdown(doc)).toBe('1. 第一步\n2. 第二步')
    })

    it('任务列表', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'taskList',
            content: [
              { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '待办' }] }] },
              { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '已完成' }] }] }
            ]
          }
        ]
      }
      expect(tiptapToMarkdown(doc)).toBe('- [ ] 待办\n- [x] 已完成')
    })

    it('嵌套列表', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: '父项' }] },
                  {
                    type: 'bulletList',
                    content: [
                      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '子项一' }] }] },
                      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '子项二' }] }] }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
      expect(tiptapToMarkdown(doc)).toBe('- 父项\n  - 子项一\n  - 子项二')
    })
  })

  describe('代码块', () => {
    it('普通代码块', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'codeBlock',
            attrs: { language: 'javascript' },
            content: [{ type: 'text', text: 'const x = 1' }]
          }
        ]
      }
      expect(tiptapToMarkdown(doc)).toBe('```javascript\nconst x = 1\n```')
    })

    it('无语言代码块', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'codeBlock',
            content: [{ type: 'text', text: 'some code' }]
          }
        ]
      }
      expect(tiptapToMarkdown(doc)).toBe('```\nsome code\n```')
    })
  })

  describe('引用', () => {
    it('单行引用', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'blockquote',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: '这是引用' }] }
            ]
          }
        ]
      }
      expect(tiptapToMarkdown(doc)).toBe('> 这是引用')
    })

    it('多行引用', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'blockquote',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: '第一行' }] },
              { type: 'paragraph', content: [{ type: 'text', text: '第二行' }] }
            ]
          }
        ]
      }
      expect(tiptapToMarkdown(doc)).toBe('> 第一行\n>\n> 第二行')
    })
  })

  describe('分割线', () => {
    it('水平分割线', () => {
      const doc = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: '上面' }] },
          { type: 'horizontalRule' },
          { type: 'paragraph', content: [{ type: 'text', text: '下面' }] }
        ]
      }
      expect(tiptapToMarkdown(doc)).toBe('上面\n\n---\n\n下面')
    })
  })

  describe('图片', () => {
    it('基础图片', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'image', attrs: { src: 'https://example.com/image.png', alt: '示例图片' } }
            ]
          }
        ]
      }
      expect(tiptapToMarkdown(doc)).toBe('![示例图片](https://example.com/image.png)')
    })

    it('无 alt 的图片', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'image', attrs: { src: 'https://example.com/image.png' } }
            ]
          }
        ]
      }
      expect(tiptapToMarkdown(doc)).toBe('![](https://example.com/image.png)')
    })
  })

  describe('表格', () => {
    it('基础表格', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'table',
            content: [
              {
                type: 'tableRow',
                content: [
                  { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '列A' }] }] },
                  { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '列B' }] }] }
                ]
              },
              {
                type: 'tableRow',
                content: [
                  { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '值1' }] }] },
                  { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '值2' }] }] }
                ]
              }
            ]
          }
        ]
      }
      expect(tiptapToMarkdown(doc)).toBe('| 列A | 列B |\n| --- | --- |\n| 值1 | 值2 |')
    })
  })

  describe('自定义块', () => {
    it('数学公式（行内）', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: '公式：' },
              { type: 'inlineMath', attrs: { latex: 'E=mc^2' } }
            ]
          }
        ]
      }
      expect(tiptapToMarkdown(doc)).toBe('公式：$E=mc^2$')
    })

    it('数学公式（块级）', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'inlineMath',
            attrs: { latex: '\\int_0^\\infty e^{-x^2} dx', display: 'yes' }
          }
        ]
      }
      expect(tiptapToMarkdown(doc)).toBe('$$\n\\int_0^\\infty e^{-x^2} dx\n$$')
    })

    it('Mermaid 图表', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'mermaid',
            attrs: { code: 'graph TD\n  A --> B' }
          }
        ]
      }
      expect(tiptapToMarkdown(doc)).toBe('```mermaid\ngraph TD\n  A --> B\n```')
    })

    it('Callout', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'callout',
            attrs: { type: 'note', title: '注意' },
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: '这是一个提示' }] }
            ]
          }
        ]
      }
      expect(tiptapToMarkdown(doc)).toBe('> [!note] 注意\n> 这是一个提示')
    })

    it('Toggle', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'toggle',
            attrs: { open: true, summary: '点击展开' },
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: '隐藏的内容' }] }
            ]
          }
        ]
      }
      expect(tiptapToMarkdown(doc)).toBe('<details>\n<summary>点击展开</summary>\n\n隐藏的内容\n</details>')
    })
  })

  describe('章节提取', () => {
    it('提取指定章节内容', () => {
      const doc = {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '文档标题' }] },
          { type: 'paragraph', content: [{ type: 'text', text: '序言内容' }] },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '第一章' }] },
          { type: 'paragraph', content: [{ type: 'text', text: '第一章内容' }] },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '第二章' }] },
          { type: 'paragraph', content: [{ type: 'text', text: '第二章内容' }] }
        ]
      }
      expect(tiptapToMarkdown(doc, { heading: '## 第一章' })).toBe('## 第一章\n\n第一章内容')
    })

    it('提取嵌套章节', () => {
      const doc = {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '标题' }] },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '章节A' }] },
          { type: 'paragraph', content: [{ type: 'text', text: '内容A' }] },
          { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: '子章节A1' }] },
          { type: 'paragraph', content: [{ type: 'text', text: '内容A1' }] },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '章节B' }] },
          { type: 'paragraph', content: [{ type: 'text', text: '内容B' }] }
        ]
      }
      // 提取章节A，包含其子章节
      expect(tiptapToMarkdown(doc, { heading: '## 章节A' }))
        .toBe('## 章节A\n\n内容A\n\n### 子章节A1\n\n内容A1')
    })

    it('章节不存在返回空', () => {
      const doc = {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '标题' }] },
          { type: 'paragraph', content: [{ type: 'text', text: '内容' }] }
        ]
      }
      expect(tiptapToMarkdown(doc, { heading: '## 不存在的章节' })).toBe('')
    })
  })

  describe('边界情况', () => {
    it('处理 null/undefined', () => {
      expect(tiptapToMarkdown(null as unknown as Record<string, unknown>)).toBe('')
      expect(tiptapToMarkdown(undefined as unknown as Record<string, unknown>)).toBe('')
    })

    it('处理非对象输入', () => {
      expect(tiptapToMarkdown('string' as unknown as Record<string, unknown>)).toBe('')
    })

    it('处理空 content', () => {
      expect(tiptapToMarkdown({ type: 'doc' })).toBe('')
    })

    it('忽略 blockId 属性', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { blockId: 'abc123' },
            content: [{ type: 'text', text: 'Hello' }]
          }
        ]
      }
      expect(tiptapToMarkdown(doc)).toBe('Hello')
    })
  })
})

// 往返转换测试
describe('往返转换一致性', () => {

  it('Toggle 往返转换', () => {
    const originalDoc = {
      type: 'doc',
      content: [
        {
          type: 'toggle',
          attrs: { open: true, summary: '点击展开' },
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: '隐藏的内容' }] }
          ]
        }
      ]
    }

    // TipTap → Markdown → TipTap
    const markdown = tiptapToMarkdown(originalDoc)
    const backToTiptap = markdownToTiptap(markdown)

    expect(backToTiptap.content![0]!.type).toBe('toggle')
    expect(backToTiptap.content![0]!.attrs!.summary).toBe('点击展开')
    expect(backToTiptap.content![0]!.content![0]!.content![0]!.text).toBe('隐藏的内容')
  })

  it('Toggle 复杂内容往返转换', () => {
    const originalDoc = {
      type: 'doc',
      content: [
        {
          type: 'toggle',
          attrs: { open: true, summary: '代码示例' },
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: '下面是代码：' }] },
            {
              type: 'codeBlock',
              attrs: { language: 'javascript' },
              content: [{ type: 'text', text: 'console.log("hello")' }]
            }
          ]
        }
      ]
    }

    const markdown = tiptapToMarkdown(originalDoc)
    const backToTiptap = markdownToTiptap(markdown)

    expect(backToTiptap.content![0]!.type).toBe('toggle')
    expect(backToTiptap.content![0]!.attrs!.summary).toBe('代码示例')
    expect(backToTiptap.content![0]!.content!.length).toBeGreaterThanOrEqual(2)
  })
})
