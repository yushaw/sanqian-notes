import type { Editor } from '@tiptap/react'

/**
 * 光标位置信息，基于 block ID
 * 用于在不同编辑器实例间同步光标位置
 */
export interface CursorInfo {
  blockId: string       // 光标所在 block 的 ID
  offsetInBlock: number // 光标在 block 内的偏移
}

/**
 * 从编辑器获取当前光标的 block ID 和偏移
 */
export function getCursorInfo(editor: Editor | null): CursorInfo | null {
  if (!editor) return null

  const { state } = editor
  const { selection } = state
  const pos = selection.anchor

  // 找到光标所在的 block 节点
  const $pos = state.doc.resolve(pos)

  // 从当前位置向上找到最近的有 blockId 的节点
  for (let depth = $pos.depth; depth >= 0; depth--) {
    const node = $pos.node(depth)
    const blockId = node.attrs?.blockId
    if (blockId) {
      // 计算在 block 内的偏移
      const blockStart = $pos.start(depth)
      const offsetInBlock = pos - blockStart
      return { blockId, offsetInBlock }
    }
  }

  // 如果没找到 blockId，使用绝对位置作为备用方案
  return { blockId: `__pos__${pos}`, offsetInBlock: 0 }
}

/**
 * 根据 block ID 设置光标位置
 * @returns 是否成功找到并设置光标
 */
export function setCursorByBlockId(editor: Editor | null, cursorInfo: CursorInfo): boolean {
  if (!editor) return false

  const { blockId, offsetInBlock } = cursorInfo

  // 检查是否是绝对位置备用方案
  if (blockId.startsWith('__pos__')) {
    const pos = parseInt(blockId.replace('__pos__', ''), 10)
    const docSize = editor.state.doc.content.size
    const targetPos = Math.min(pos, docSize)
    editor.commands.setTextSelection(targetPos)
    editor.commands.focus()
    return true
  }

  let found = false

  // 遍历文档找到对应的 block
  editor.state.doc.descendants((node, pos) => {
    if (found) return false
    if (node.attrs?.blockId === blockId) {
      // 找到了 block，计算目标位置
      // pos 是 block 的起始位置，+1 跳过 block 开始标记
      const targetPos = Math.min(pos + 1 + offsetInBlock, pos + node.nodeSize - 1)
      editor.commands.setTextSelection(targetPos)
      editor.commands.focus()
      found = true
      return false
    }
    return true
  })

  return found
}
