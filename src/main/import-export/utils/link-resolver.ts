/**
 * 内部链接解析工具
 * 将 [[title]] 格式的 wiki 链接解析为实际笔记链接
 */

interface TiptapMark {
  type: string
  attrs?: Record<string, unknown>
}

interface TiptapNode {
  type: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
  text?: string
  marks?: TiptapMark[]
}

interface TiptapDoc {
  type: 'doc'
  content: TiptapNode[]
}

/**
 * 解析 TipTap JSON 内容中的 wiki 链接
 * 将 [[title]] 转换为带 link mark 的文本节点
 *
 * @param content - TipTap JSON 字符串
 * @param titleToNoteId - 标题到笔记 ID 的映射
 * @returns 更新后的 TipTap JSON 字符串
 */
export function resolveWikiLinksInContent(
  content: string,
  titleToNoteId: Map<string, string>
): string {
  try {
    const doc: TiptapDoc = JSON.parse(content)

    const resolvedDoc = resolveLinksInNode(doc, titleToNoteId)

    return JSON.stringify(resolvedDoc)
  } catch {
    // 解析失败，返回原内容
    return content
  }
}

/**
 * 递归解析节点中的 wiki 链接
 */
function resolveLinksInNode(
  node: TiptapNode | TiptapDoc,
  titleToNoteId: Map<string, string>
): TiptapNode | TiptapDoc | TiptapNode[] {
  // 处理文本节点
  if (node.type === 'text' && node.text) {
    return resolveLinksInText(node as TiptapNode, titleToNoteId)
  }

  // 递归处理子节点
  if (node.content && Array.isArray(node.content)) {
    const newContent: TiptapNode[] = []

    for (const child of node.content) {
      const resolved = resolveLinksInNode(child, titleToNoteId)
      if (Array.isArray(resolved)) {
        newContent.push(...resolved)
      } else {
        newContent.push(resolved as TiptapNode)
      }
    }

    return { ...node, content: newContent }
  }

  return node
}

/**
 * 解析文本节点中的 wiki 链接
 * 可能会将一个文本节点拆分为多个节点
 */
function resolveLinksInText(
  node: TiptapNode,
  titleToNoteId: Map<string, string>
): TiptapNode | TiptapNode[] {
  const text = node.text || ''

  // 匹配 [[title]] 或 [[title|alias]]
  const wikiLinkRegex = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g

  // 检查是否包含 wiki 链接
  if (!wikiLinkRegex.test(text)) {
    return node
  }

  // 重置正则
  wikiLinkRegex.lastIndex = 0

  const result: TiptapNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = wikiLinkRegex.exec(text)) !== null) {
    const [fullMatch, title, alias] = match
    const matchStart = match.index

    // 添加链接前的文本
    if (matchStart > lastIndex) {
      const beforeText = text.slice(lastIndex, matchStart)
      if (beforeText) {  // 确保不是空字符串
        result.push({
          type: 'text',
          text: beforeText,
          ...(node.marks ? { marks: node.marks } : {}),
        })
      }
    }

    // 查找目标笔记
    const noteId = titleToNoteId.get(title.toLowerCase())
    const displayText = alias || title

    if (noteId) {
      // 找到目标笔记，创建链接
      result.push({
        type: 'text',
        text: displayText,
        marks: [
          ...(node.marks || []),
          {
            type: 'link',
            attrs: {
              href: `sanqian://note/${noteId}`,
              target: null,
            },
          },
        ],
      })
    } else {
      // 未找到目标笔记，保留原样（但移除双括号，作为普通文本）
      result.push({
        type: 'text',
        text: displayText,
        marks: [
          ...(node.marks || []),
          {
            type: 'link',
            attrs: {
              href: `sanqian://note-not-found/${encodeURIComponent(title)}`,
              target: null,
            },
          },
        ],
      })
    }

    lastIndex = matchStart + fullMatch.length
  }

  // 添加剩余文本
  if (lastIndex < text.length) {
    const afterText = text.slice(lastIndex)
    if (afterText) {  // 确保不是空字符串
      result.push({
        type: 'text',
        text: afterText,
        ...(node.marks ? { marks: node.marks } : {}),
      })
    }
  }

  // 过滤掉可能的空文本节点
  const filtered = result.filter(n => n.text !== undefined && n.text !== null && n.text !== '')

  // 如果过滤后没有节点，返回原节点
  if (filtered.length === 0) {
    return node
  }

  // 如果只有一个结果节点，直接返回
  if (filtered.length === 1) {
    return filtered[0]
  }

  return filtered
}

/**
 * 批量解析多个笔记的内部链接
 *
 * @param notes - 笔记数组 [{ id, content }]
 * @param titleToNoteId - 标题到笔记 ID 的映射
 * @returns 更新后的笔记数组 [{ id, content }]
 */
export function resolveWikiLinksInNotes(
  notes: Array<{ id: string; content: string }>,
  titleToNoteId: Map<string, string>
): Array<{ id: string; content: string }> {
  return notes.map((note) => ({
    id: note.id,
    content: resolveWikiLinksInContent(note.content, titleToNoteId),
  }))
}
