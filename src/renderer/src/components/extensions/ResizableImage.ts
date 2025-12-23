import Image from '@tiptap/extension-image'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { NodeSelection } from '@tiptap/pm/state'
import { ResizableImageView } from '../ResizableImageView'

export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) => {
          const width = element.getAttribute('width')
          return width ? parseInt(width, 10) : null
        },
        renderHTML: (attributes) => {
          if (!attributes.width) return {}
          return { width: attributes.width }
        },
      },
      height: {
        default: null,
        parseHTML: (element) => {
          const height = element.getAttribute('height')
          return height ? parseInt(height, 10) : null
        },
        renderHTML: (attributes) => {
          if (!attributes.height) return {}
          return { height: attributes.height }
        },
      },
      align: {
        default: 'left',
        parseHTML: (element) => element.getAttribute('data-align') || 'left',
        renderHTML: (attributes) => ({ 'data-align': attributes.align }),
      },
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView)
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('resizableImageKeyHandler'),
        props: {
          handleKeyDown: (view, event) => {
            const { state } = view
            const { selection } = state

            // 只处理 NodeSelection 且选中的是图片
            if (!(selection instanceof NodeSelection)) return false
            if (selection.node.type.name !== this.name) return false

            // 忽略功能键和修饰键
            if (event.key.length !== 1 && event.key !== 'Enter') return false
            if (event.ctrlKey || event.metaKey || event.altKey) return false

            // 在图片后新起一行并插入字符
            const pos = selection.to
            const tr = state.tr

            if (event.key === 'Enter') {
              // Enter 键：只在图片后新起一行
              tr.insert(pos, state.schema.nodes.paragraph.create())
              tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)))
            } else {
              // 其他字符：新起一行并插入该字符
              const textNode = state.schema.text(event.key)
              const paragraph = state.schema.nodes.paragraph.create(null, textNode)
              tr.insert(pos, paragraph)
              // 将光标移动到插入字符之后
              tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 2)))
            }

            view.dispatch(tr)
            return true
          },
        },
      }),
    ]
  },
})
