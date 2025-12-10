import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

// 生成 6 位随机 block ID
export function generateBlockId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

// 验证 block ID 格式（只允许字母、数字、短横线）
export function isValidBlockId(id: string): boolean {
  return /^[a-zA-Z0-9-]+$/.test(id)
}

// Block 类型定义
export interface BlockInfo {
  id: string
  type: string
  text: string
  pos: number
}

// 从编辑器中提取所有 blocks
export function extractBlocks(editor: {
  state: { doc: { descendants: (callback: (node: unknown, pos: number) => boolean | void) => void } }
}): BlockInfo[] {
  const blocks: BlockInfo[] = []

  editor.state.doc.descendants((node: unknown, pos: number) => {
    const n = node as { type?: { name?: string }; attrs?: { blockId?: string }; textContent?: string }
    if (!n.type?.name) return

    // 只处理顶级块节点
    const blockTypes = ['paragraph', 'heading', 'blockquote', 'codeBlock', 'bulletList', 'orderedList', 'taskList', 'table', 'horizontalRule']
    if (blockTypes.includes(n.type.name)) {
      const blockId = n.attrs?.blockId || ''
      const text = n.textContent || ''

      // 跳过空段落
      if (n.type.name === 'paragraph' && !text.trim()) {
        return
      }

      blocks.push({
        id: blockId,
        type: n.type.name,
        text: text.slice(0, 100), // 限制预览长度
        pos,
      })
    }
  })

  return blocks
}

// 从编辑器中提取所有标题
export function extractHeadings(editor: {
  state: { doc: { descendants: (callback: (node: unknown, pos: number) => boolean | void) => void } }
}): { level: number; text: string; pos: number; blockId?: string }[] {
  const headings: { level: number; text: string; pos: number; blockId?: string }[] = []

  editor.state.doc.descendants((node: unknown, pos: number) => {
    const n = node as { type?: { name?: string }; attrs?: { level?: number; blockId?: string }; textContent?: string }
    if (n.type?.name === 'heading') {
      headings.push({
        level: n.attrs?.level || 1,
        text: n.textContent || '',
        pos,
        blockId: n.attrs?.blockId,
      })
    }
  })

  return headings
}

// BlockId 扩展 - 为所有块级节点添加 blockId 属性
export const BlockId = Extension.create({
  name: 'blockId',

  addGlobalAttributes() {
    return [
      {
        // 应用到所有块级节点
        types: [
          'paragraph',
          'heading',
          'blockquote',
          'codeBlock',
          'bulletList',
          'orderedList',
          'taskList',
          'listItem',
          'taskItem',
          'table',
          'tableRow',
          'tableCell',
          'tableHeader',
          'horizontalRule',
          'image',
        ],
        attributes: {
          blockId: {
            default: null,
            parseHTML: element => element.getAttribute('data-block-id'),
            renderHTML: attributes => {
              if (!attributes.blockId) {
                return {}
              }
              return { 'data-block-id': attributes.blockId }
            },
          },
        },
      },
    ]
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('blockIdPlugin'),
        // 可以在这里添加更多逻辑，比如自动为新节点生成 ID
      }),
    ]
  },
})

export default BlockId
