/**
 * HTML Comment Extension
 *
 * 用于存储 PDF 导入时的 HTML 注释（如图片描述、页码等）
 * 数据保留但不渲染显示
 */

import { Node } from '@tiptap/core'

export const HtmlComment = Node.create({
  name: 'htmlComment',
  group: 'block',
  atom: true, // 原子节点，不可编辑

  addAttributes() {
    return {
      content: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-comment-content') || '',
        renderHTML: (attributes) => ({
          'data-comment-content': attributes.content,
        }),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-html-comment]',
        getAttrs: (element) => {
          const el = element as HTMLElement
          return {
            content: el.getAttribute('data-comment-content') || '',
          }
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    // 渲染为隐藏的空 div，保留数据但不显示
    return [
      'div',
      {
        ...HTMLAttributes,
        'data-html-comment': '',
        style: 'display: none;',
      },
    ]
  },
})
