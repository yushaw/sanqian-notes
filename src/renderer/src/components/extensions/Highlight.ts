import Highlight from '@tiptap/extension-highlight'
import { markInputRule, markPasteRule } from '@tiptap/core'

// Markdown 语法 ==text== 的正则
const highlightInputRegex = /(?:^|\s)(==(?!\s)([^=]+)(?<!\s)==)$/
const highlightPasteRegex = /(?:^|\s)(==(?!\s)([^=]+)(?<!\s)==)/g

export const CustomHighlight = Highlight.extend({
  // 设置 inclusive: false，使得在高亮文本末尾输入时不继承高亮
  inclusive: false,

  addInputRules() {
    return [
      markInputRule({
        find: highlightInputRegex,
        type: this.type,
      }),
    ]
  },

  addPasteRules() {
    return [
      markPasteRule({
        find: highlightPasteRegex,
        type: this.type,
      }),
    ]
  },
}).configure({
  multicolor: true,
  HTMLAttributes: {
    class: 'highlight',
  },
})
