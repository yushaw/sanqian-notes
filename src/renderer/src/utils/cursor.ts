import type { Editor } from '@tiptap/react'

/**
 * 光标位置信息，基于 block ID
 * 用于在不同编辑器实例间同步光标位置
 */
export interface CursorInfo {
  blockId: string       // 光标所在 block 的 ID
  offsetInBlock: number // 光标在 block 内的偏移
  absolutePos: number   // 绝对位置作为 fallback
}

/**
 * 光标上下文信息，用于 SDK context
 * 提供更有意义的位置描述（标题 + 段落内容）
 */
export interface CursorContext {
  /** 光标最近的标题（如 "## 第一章"） */
  nearestHeading: string | null
  /** 光标所在段落的文本内容 */
  currentParagraph: string | null
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
      return { blockId, offsetInBlock, absolutePos: pos }
    }
  }

  // 如果没找到 blockId，使用绝对位置作为备用方案
  return { blockId: `__pos__${pos}`, offsetInBlock: 0, absolutePos: pos }
}

/**
 * 根据 block ID 设置光标位置
 * @returns 是否成功找到并设置光标
 */
export function setCursorByBlockId(editor: Editor | null, cursorInfo: CursorInfo): boolean {
  if (!editor) return false

  const { blockId, offsetInBlock, absolutePos } = cursorInfo

  // 检查是否是绝对位置备用方案
  if (blockId.startsWith('__pos__')) {
    const pos = parseInt(blockId.replace('__pos__', ''), 10)
    const docSize = editor.state.doc.content.size
    const targetPos = Math.max(1, Math.min(pos, docSize))
    try {
      editor.commands.setTextSelection(targetPos)
      editor.commands.focus()
    } catch {
      editor.commands.setTextSelection(1)
      editor.commands.focus()
    }
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
      try {
        editor.commands.setTextSelection(targetPos)
        editor.commands.focus()
        found = true
      } catch {
        // 位置无效，继续搜索或使用 fallback
      }
      return false
    }
    return true
  })

  // 如果没找到目标 block（可能被删除了），使用保存的绝对位置作为 fallback
  // 绝对位置比遍历最后一个 block 更准确，因为它是原始光标位置
  if (!found) {
    const docSize = editor.state.doc.content.size
    // 使用原始绝对位置，但不能超过文档大小
    // 确保至少为 1（跳过 doc 开始标记），避免选区在 doc 外部
    const targetPos = Math.max(1, Math.min(absolutePos, docSize))
    try {
      editor.commands.setTextSelection(targetPos)
      editor.commands.focus()
    } catch {
      // 如果位置无效，fallback 到文档开头
      editor.commands.setTextSelection(1)
      editor.commands.focus()
    }
  }

  return found
}

/**
 * 从编辑器获取光标上下文（最近标题 + 当前段落）
 */
export function getCursorContext(editor: Editor | null): CursorContext | null {
  if (!editor) return null

  const { state } = editor
  const { selection } = state
  const pos = selection.anchor

  let nearestHeading: string | null = null
  let currentParagraph: string | null = null

  // 遍历文档找到光标位置之前最近的标题，以及当前段落
  // 使用容器对象避免 TypeScript 闭包类型推断问题
  const found: {
    heading: { level: number; text: string } | null
    paragraph: string | null
  } = { heading: null, paragraph: null }

  state.doc.descendants((node, nodePos) => {
    const nodeEnd = nodePos + node.nodeSize

    // 记录所有经过的标题（在光标之前）
    if (node.type.name === 'heading' && nodePos < pos) {
      const level = node.attrs.level as number
      const text = node.textContent
      found.heading = { level, text }
    }

    // 找到光标所在的块
    if (nodePos <= pos && pos <= nodeEnd) {
      if (node.isBlock && node.textContent) {
        found.paragraph = node.textContent
      }
    }

    return true
  })

  if (found.heading) {
    nearestHeading = '#'.repeat(found.heading.level) + ' ' + found.heading.text
  }

  if (found.paragraph) {
    currentParagraph = found.paragraph
  }

  // 如果两者都没有，返回 null
  if (!nearestHeading && !currentParagraph) {
    return null
  }

  return { nearestHeading, currentParagraph }
}
