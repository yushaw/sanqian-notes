/**
 * TipTap JSON to Markdown 转换
 *
 * 将 TipTap 编辑器的 JSON 格式转换为 Markdown 文本
 * 用于 SDK Tools API，让 AI 能够理解和操作笔记内容
 */

// TipTap 节点类型定义
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
  content?: TiptapNode[]
}

interface ConvertOptions {
  /** 只提取指定章节（如 "## 第一章"） */
  heading?: string
}

interface ConvertContext {
  /** 当前列表嵌套深度 */
  listDepth: number
  /** 当前有序列表的序号 */
  orderedListIndex: number
  /** 是否在引用块内 */
  inBlockquote: boolean
}

/**
 * 应用文本标记（marks）
 */
function applyMarks(text: string, marks?: TiptapMark[]): string {
  if (!marks || marks.length === 0) return text

  let result = text

  // 按优先级排序：code 最内层，link 最外层
  const sortedMarks = [...marks].sort((a, b) => {
    const priority: Record<string, number> = {
      code: 0,
      bold: 1,
      italic: 2,
      strike: 3,
      highlight: 4,
      underline: 5,
      link: 6
    }
    return (priority[a.type] ?? 99) - (priority[b.type] ?? 99)
  })

  for (const mark of sortedMarks) {
    switch (mark.type) {
      case 'bold':
        result = `**${result}**`
        break
      case 'italic':
        result = `*${result}*`
        break
      case 'strike':
        result = `~~${result}~~`
        break
      case 'code':
        result = `\`${result}\``
        break
      case 'highlight':
        result = `==${result}==`
        break
      case 'underline':
        result = `++${result}++`
        break
      case 'link': {
        const href = mark.attrs?.href as string || ''
        result = `[${result}](${href})`
        break
      }
    }
  }

  return result
}

/**
 * 转换单个节点为 Markdown
 */
function convertNode(node: TiptapNode, ctx: ConvertContext): string {
  switch (node.type) {
    case 'text':
      return applyMarks(node.text || '', node.marks)

    case 'paragraph':
      return convertChildren(node, ctx)

    case 'heading': {
      const level = (node.attrs?.level as number) || 1
      const prefix = '#'.repeat(level)
      return `${prefix} ${convertChildren(node, ctx)}`
    }

    case 'bulletList':
      return convertListItems(node, '-', ctx)

    case 'orderedList':
      return convertOrderedListItems(node, ctx)

    case 'taskList':
      return convertTaskItems(node, ctx)

    case 'listItem':
      return convertListItem(node, ctx)

    case 'taskItem': {
      const checked = node.attrs?.checked ? 'x' : ' '
      const indent = '  '.repeat(ctx.listDepth)
      const content = convertChildren(node, ctx)
      return `${indent}- [${checked}] ${content}`
    }

    case 'blockquote':
      return convertBlockquote(node, ctx)

    case 'codeBlock': {
      const language = (node.attrs?.language as string) || ''
      const code = convertChildren(node, ctx)
      return `\`\`\`${language}\n${code}\n\`\`\``
    }

    case 'horizontalRule':
      return '---'

    case 'image': {
      const src = (node.attrs?.src as string) || ''
      const alt = (node.attrs?.alt as string) || ''
      return `![${alt}](${src})`
    }

    case 'hardBreak':
      return '\n'

    // 表格
    case 'table':
      return convertTable(node, ctx)

    case 'tableRow':
      return convertTableRow(node, ctx)

    case 'tableHeader':
    case 'tableCell':
      return convertChildren(node, ctx)

    // 数学公式（inlineMath 和 mathematics 都走这个逻辑，兼容旧数据）
    case 'inlineMath':
    case 'mathematics': {
      const latex = (node.attrs?.latex as string) || ''
      const display = node.attrs?.display === 'yes'
      if (display) {
        return `$$\n${latex}\n$$`
      }
      return `$${latex}$`
    }

    // Mermaid 图表
    case 'mermaid': {
      const code = (node.attrs?.code as string) || ''
      return `\`\`\`mermaid\n${code}\n\`\`\``
    }

    // Callout
    case 'callout': {
      const type = (node.attrs?.type as string) || 'note'
      const title = (node.attrs?.title as string) || ''
      const content = convertChildren(node, { ...ctx, inBlockquote: true })
      const titlePart = title ? ` ${title}` : ''
      const lines = content.split('\n').map(line => `> ${line}`).join('\n')
      return `> [!${type}]${titlePart}\n${lines}`
    }

    // Toggle/Details
    case 'details':
    case 'toggle': {
      const summary = (node.attrs?.summary as string) || ''
      const content = convertChildren(node, ctx)
      return `<details>\n<summary>${summary}</summary>\n\n${content}\n</details>`
    }

    default:
      // 未知节点类型，尝试转换其子节点
      return convertChildren(node, ctx)
  }
}

/**
 * 转换子节点
 */
function convertChildren(node: TiptapNode, ctx: ConvertContext): string {
  if (!node.content || node.content.length === 0) return ''
  return node.content.map(child => convertNode(child, ctx)).join('')
}

/**
 * 转换无序列表项
 */
function convertListItems(node: TiptapNode, marker: string, ctx: ConvertContext): string {
  if (!node.content) return ''

  const newCtx = { ...ctx, listDepth: ctx.listDepth + 1 }
  const items: string[] = []

  for (const item of node.content) {
    if (item.type === 'listItem') {
      const indent = '  '.repeat(ctx.listDepth)
      const content = convertListItemContent(item, newCtx)
      items.push(`${indent}${marker} ${content}`)
    }
  }

  return items.join('\n')
}

/**
 * 转换有序列表项
 */
function convertOrderedListItems(node: TiptapNode, ctx: ConvertContext): string {
  if (!node.content) return ''

  const newCtx = { ...ctx, listDepth: ctx.listDepth + 1 }
  const items: string[] = []
  let index = 1

  for (const item of node.content) {
    if (item.type === 'listItem') {
      const indent = '  '.repeat(ctx.listDepth)
      const content = convertListItemContent(item, newCtx)
      items.push(`${indent}${index}. ${content}`)
      index++
    }
  }

  return items.join('\n')
}

/**
 * 转换任务列表项
 */
function convertTaskItems(node: TiptapNode, ctx: ConvertContext): string {
  if (!node.content) return ''

  const newCtx = { ...ctx, listDepth: ctx.listDepth + 1 }
  const items: string[] = []

  for (const item of node.content) {
    if (item.type === 'taskItem') {
      const checked = item.attrs?.checked ? 'x' : ' '
      const indent = '  '.repeat(ctx.listDepth)
      const content = convertListItemContent(item, newCtx)
      items.push(`${indent}- [${checked}] ${content}`)
    }
  }

  return items.join('\n')
}

/**
 * 转换列表项内容（处理嵌套列表）
 */
function convertListItemContent(item: TiptapNode, ctx: ConvertContext): string {
  if (!item.content) return ''

  const parts: string[] = []
  let firstParagraph = true

  for (const child of item.content) {
    if (child.type === 'paragraph') {
      if (firstParagraph) {
        parts.push(convertChildren(child, ctx))
        firstParagraph = false
      } else {
        parts.push('\n' + '  '.repeat(ctx.listDepth) + convertChildren(child, ctx))
      }
    } else if (child.type === 'bulletList' || child.type === 'orderedList' || child.type === 'taskList') {
      // 嵌套列表
      parts.push('\n' + convertNode(child, ctx))
    } else {
      parts.push(convertNode(child, ctx))
    }
  }

  return parts.join('')
}

/**
 * 转换列表项
 */
function convertListItem(node: TiptapNode, ctx: ConvertContext): string {
  return convertListItemContent(node, ctx)
}

/**
 * 转换引用块
 */
function convertBlockquote(node: TiptapNode, ctx: ConvertContext): string {
  if (!node.content) return ''

  const newCtx = { ...ctx, inBlockquote: true }
  const parts: string[] = []

  for (let i = 0; i < node.content.length; i++) {
    const child = node.content[i]
    const content = convertNode(child, newCtx)

    if (child.type === 'paragraph') {
      parts.push(`> ${content}`)
    } else {
      // 其他类型的内容，每行都加 >
      const lines = content.split('\n')
      parts.push(lines.map(line => `> ${line}`).join('\n'))
    }

    // 段落之间加空的引用行
    if (i < node.content.length - 1 && child.type === 'paragraph') {
      parts.push('>')
    }
  }

  return parts.join('\n')
}

/**
 * 转换表格
 */
function convertTable(node: TiptapNode, ctx: ConvertContext): string {
  if (!node.content || node.content.length === 0) return ''

  const rows: string[] = []
  let headerProcessed = false

  for (const row of node.content) {
    if (row.type !== 'tableRow') continue

    const cells = row.content || []
    const cellContents = cells.map(cell => convertChildren(cell, ctx).trim())
    rows.push(`| ${cellContents.join(' | ')} |`)

    // 在表头后添加分隔行
    if (!headerProcessed && cells.some(cell => cell.type === 'tableHeader')) {
      const separator = cells.map(() => '---').join(' | ')
      rows.push(`| ${separator} |`)
      headerProcessed = true
    }
  }

  return rows.join('\n')
}

/**
 * 转换表格行
 */
function convertTableRow(node: TiptapNode, ctx: ConvertContext): string {
  if (!node.content) return ''
  const cells = node.content.map(cell => convertChildren(cell, ctx).trim())
  return `| ${cells.join(' | ')} |`
}

/**
 * 提取指定章节的内容
 */
function extractSection(nodes: TiptapNode[], headingPattern: string): TiptapNode[] {
  // 解析 heading pattern（如 "## 第一章"）
  const match = headingPattern.match(/^(#{1,6})\s+(.+)$/)
  if (!match) return []

  const targetLevel = match[1].length
  const targetText = match[2]

  let foundStart = false
  let startIndex = -1
  let endIndex = nodes.length

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]

    if (node.type === 'heading') {
      const level = (node.attrs?.level as number) || 1
      const text = extractPlainText(node)

      if (!foundStart) {
        // 寻找匹配的标题
        if (level === targetLevel && text === targetText) {
          foundStart = true
          startIndex = i
        }
      } else {
        // 找到下一个同级或更高级别的标题，结束
        if (level <= targetLevel) {
          endIndex = i
          break
        }
      }
    }
  }

  if (startIndex === -1) return []
  return nodes.slice(startIndex, endIndex)
}

/**
 * 提取节点的纯文本内容
 */
function extractPlainText(node: TiptapNode): string {
  if (node.type === 'text') return node.text || ''
  if (!node.content) return ''
  return node.content.map(extractPlainText).join('')
}

/**
 * 将 TipTap JSON 转换为 Markdown
 *
 * @param doc - TipTap 文档 JSON
 * @param options - 转换选项
 * @returns Markdown 字符串
 */
export function tiptapToMarkdown(
  doc: TiptapDoc | Record<string, unknown> | null | undefined,
  options?: ConvertOptions
): string {
  if (!doc || typeof doc !== 'object') return ''
  if (doc.type !== 'doc') return ''

  let nodes = (doc as TiptapDoc).content || []

  // 如果指定了章节，只提取该章节
  if (options?.heading && nodes.length > 0) {
    nodes = extractSection(nodes, options.heading)
    if (nodes.length === 0) return ''
  }

  const ctx: ConvertContext = {
    listDepth: 0,
    orderedListIndex: 1,
    inBlockquote: false
  }

  const parts: string[] = []

  for (const node of nodes) {
    const converted = convertNode(node, ctx)
    parts.push(converted)
  }

  // 块级元素之间用两个换行分隔
  return parts.join('\n\n')
}

/**
 * 从 JSON 字符串解析并转换为 Markdown
 */
export function jsonToMarkdown(
  jsonString: string,
  options?: ConvertOptions
): string {
  try {
    const doc = JSON.parse(jsonString)
    return tiptapToMarkdown(doc, options)
  } catch {
    // 如果不是有效的 JSON，返回原字符串
    return jsonString
  }
}
