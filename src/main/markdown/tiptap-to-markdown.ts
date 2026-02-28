/**
 * TipTap JSON to Markdown 转换
 *
 * 将 TipTap 编辑器的 JSON 格式转换为 Markdown 文本
 * 用于 SDK Tools API，让 AI 能够理解和操作笔记内容
 */

import { formatAIPopupMarkerComment } from '../../shared/ai-popup-marker'

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

/** Heading 匹配模式 */
type HeadingMatch = 'exact' | 'contains' | 'startsWith'

/** 转义 HTML 属性值 */
function escapeAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 文档 heading 信息 */
export interface DocumentHeading {
  /** Heading 级别 (1-6) */
  level: number
  /** Heading 文本 */
  text: string
  /** 所在行号（从 1 开始，近似值） */
  line: number
}

interface ConvertOptions {
  /** 只提取指定章节（如 "## 第一章"） */
  heading?: string
  /** Heading 匹配模式，默认 'exact' */
  headingMatch?: HeadingMatch
  /** 起始行号（从 1 开始） */
  offset?: number
  /** 返回行数限制 */
  limit?: number
}

/** 转换结果（带分页信息） */
export interface ConvertResult {
  /** Markdown 内容 */
  content: string
  /** 总行数 */
  totalLines: number
  /** 返回的行范围 */
  returnedLines?: { from: number; to: number }
  /** 是否还有更多内容 */
  hasMore?: boolean
}

interface ConvertContext {
  /** 当前列表嵌套深度 */
  listDepth: number
  /** 当前有序列表的序号 */
  orderedListIndex: number
  /** 是否在引用块内 */
  inBlockquote: boolean
}

function extractTextFromTextContainer(node: TiptapNode): string {
  if (!node.content || node.content.length === 0) return ''
  let result = ''
  for (const child of node.content) {
    if (child.type === 'text') {
      result += child.text || ''
      continue
    }
    if (child.type === 'hardBreak') {
      result += '\n'
      continue
    }
    result += extractPlainText(child)
  }
  return result
}

function isLegacyFrontmatterCodeBlock(node: TiptapNode): boolean {
  const language = (node.attrs?.language as string | undefined) || ''
  return node.type === 'codeBlock' && language === 'yaml-frontmatter'
}

function splitLeadingFrontmatter(nodes: TiptapNode[]): {
  frontmatterMarkdown: string | null
  bodyNodes: TiptapNode[]
} {
  if (nodes.length === 0) {
    return { frontmatterMarkdown: null, bodyNodes: nodes }
  }

  const firstNode = nodes[0]
  if (firstNode.type !== 'frontmatter' && !isLegacyFrontmatterCodeBlock(firstNode)) {
    return { frontmatterMarkdown: null, bodyNodes: nodes }
  }

  const yamlBody = extractTextFromTextContainer(firstNode).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd()
  const frontmatterMarkdown = yamlBody ? `---\n${yamlBody}\n---` : '---\n---'

  return {
    frontmatterMarkdown,
    bodyNodes: nodes.slice(1),
  }
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
      case 'noteLink': {
        const noteTitle = mark.attrs?.noteTitle as string || ''
        // 使用 wiki-link 格式，转义特殊字符
        const safeTitle = noteTitle.replace(/\|/g, '\\|').replace(/\]\]/g, '\\]\\]')
        result = `[[${safeTitle}|${result}]]`
        break
      }
      case 'textColor': {
        // 文字颜色在 markdown 中无法表示，保持原样
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

    case 'paragraph': {
      const content = convertChildren(node, ctx)
      // 空段落输出零宽空格，避免 join 时产生过多换行
      // 这样 markdown-to-tiptap 能正确还原为单个空段落
      return content || '\u200B'
    }

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

    case 'frontmatter': {
      const yamlBody = extractTextFromTextContainer(node).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd()
      return `\`\`\`yaml-frontmatter\n${yamlBody}\n\`\`\``
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

    // 视频
    case 'video': {
      const src = (node.attrs?.src as string) || ''
      return `<video src="${escapeAttr(src)}" controls></video>`
    }

    // 音频
    case 'audio': {
      const src = (node.attrs?.src as string) || ''
      return `<audio src="${escapeAttr(src)}" controls></audio>`
    }

    // 可调整大小的图片
    case 'resizableImage': {
      const src = (node.attrs?.src as string) || ''
      const alt = (node.attrs?.alt as string) || ''
      return `![${alt}](${src})`
    }

    // 文件附件
    case 'fileAttachment': {
      const name = (node.attrs?.name as string) || '附件'
      const src = (node.attrs?.src as string) || ''
      return `[${name}](${src})`
    }

    // 脚注
    case 'footnote': {
      const content = (node.attrs?.content as string) || ''
      const id = (node.attrs?.id as string) || ''
      return `[^${id || 'note'}]: ${content}`
    }

    // HTML 注释
    case 'htmlComment': {
      const content = (node.attrs?.content as string) || ''
      return `<!-- ${content} -->`
    }

    // 嵌入块
    case 'embedBlock': {
      const mode = (node.attrs?.mode as string) || 'url'
      const url = (node.attrs?.url as string) || ''
      const localPath = (node.attrs?.localPath as string) || ''
      const title = (node.attrs?.title as string) || ''

      if (mode === 'url' && url) {
        return `<iframe src="${escapeAttr(url)}" title="${escapeAttr(title)}"></iframe>`
      } else if (mode === 'local' && localPath) {
        return `![[${localPath}]]`
      }
      return ''
    }

    // 引用块（Transclusion）
    case 'transclusionBlock': {
      const noteId = (node.attrs?.noteId as string) || ''
      const noteName = (node.attrs?.noteName as string) || ''
      return `![[${noteName || noteId}]]`
    }

    // 目录块 (tocBlock is the current name; tableOfContents is the legacy name)
    case 'tocBlock':
    case 'tableOfContents':
      return '[TOC]'

    // 数据视图
    case 'dataviewBlock': {
      const query = (node.attrs?.query as string) || ''
      return `\`\`\`dataview\n${query}\n\`\`\``
    }

    // AI popup marker
    case 'aiPopupMark': {
      const popupId = (node.attrs?.popupId as string) || ''
      const rawCreatedAt = node.attrs?.createdAt
      const createdAt = typeof rawCreatedAt === 'number'
        ? rawCreatedAt
        : (typeof rawCreatedAt === 'string' ? Number.parseInt(rawCreatedAt, 10) : undefined)
      const marker = formatAIPopupMarkerComment({ popupId, createdAt: createdAt ?? undefined })
      return marker
    }

    // AI 任务块
    case 'agentTask': {
      const content = convertChildren(node, ctx)
      return content || ''
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
    const cellContents = cells.map(cell => convertChildren(cell, ctx).trim().replace(/\|/g, '\\|'))
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
 * 检查标题文本是否匹配
 */
function matchHeadingText(text: string, pattern: string, mode: HeadingMatch): boolean {
  const normalizedText = text.toLowerCase()
  const normalizedPattern = pattern.toLowerCase()

  switch (mode) {
    case 'contains':
      return normalizedText.includes(normalizedPattern)
    case 'startsWith':
      return normalizedText.startsWith(normalizedPattern)
    case 'exact':
    default:
      return text === pattern
  }
}

/**
 * 提取指定章节的内容
 */
function extractSection(
  nodes: TiptapNode[],
  headingPattern: string,
  matchMode: HeadingMatch = 'exact'
): TiptapNode[] {
  // 解析 heading pattern（如 "## 第一章"）
  const match = headingPattern.match(/^(#{1,6})\s+(.+)$/)

  // 如果没有 # 前缀，尝试作为纯文本搜索（自动使用 contains 模式）
  let targetLevel: number | null = null
  let targetText: string

  if (match) {
    targetLevel = match[1].length
    targetText = match[2]
  } else {
    // 纯文本模式：搜索任意级别包含该文本的 heading
    targetText = headingPattern
    if (matchMode === 'exact') {
      matchMode = 'contains' // 纯文本默认使用 contains
    }
  }

  let foundStart = false
  let startIndex = -1
  let endIndex = nodes.length
  let foundLevel = 0

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]

    if (node.type === 'heading') {
      const level = (node.attrs?.level as number) || 1
      const text = extractPlainText(node)

      if (!foundStart) {
        // 寻找匹配的标题
        const levelMatch = targetLevel === null || level === targetLevel
        if (levelMatch && matchHeadingText(text, targetText, matchMode)) {
          foundStart = true
          startIndex = i
          foundLevel = level
        }
      } else {
        // 找到下一个同级或更高级别的标题，结束
        if (level <= foundLevel) {
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
    nodes = extractSection(nodes, options.heading, options.headingMatch)
    if (nodes.length === 0) return ''
  }
  const { frontmatterMarkdown, bodyNodes } = splitLeadingFrontmatter(nodes)
  nodes = bodyNodes

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
  let content = parts.join('\n\n')
  if (frontmatterMarkdown) {
    content = content ? `${frontmatterMarkdown}\n\n${content}` : frontmatterMarkdown
  }

  // 应用 offset/limit 分页
  if (options?.offset || options?.limit) {
    const lines = content.split('\n')
    const offset = Math.max(0, (options.offset || 1) - 1) // 转为 0-based
    const limit = options.limit || lines.length

    content = lines.slice(offset, offset + limit).join('\n')
  }

  return content
}

/**
 * 将 TipTap JSON 转换为 Markdown（带分页信息）
 */
export function tiptapToMarkdownWithMeta(
  doc: TiptapDoc | Record<string, unknown> | null | undefined,
  options?: ConvertOptions
): ConvertResult {
  if (!doc || typeof doc !== 'object') return { content: '', totalLines: 0 }
  if (doc.type !== 'doc') return { content: '', totalLines: 0 }

  let nodes = (doc as TiptapDoc).content || []

  // 如果指定了章节，只提取该章节
  if (options?.heading && nodes.length > 0) {
    nodes = extractSection(nodes, options.heading, options.headingMatch)
    if (nodes.length === 0) return { content: '', totalLines: 0 }
  }
  const { frontmatterMarkdown, bodyNodes } = splitLeadingFrontmatter(nodes)
  nodes = bodyNodes

  const ctx: ConvertContext = {
    listDepth: 0,
    orderedListIndex: 1,
    inBlockquote: false
  }

  const parts: string[] = []
  for (const node of nodes) {
    parts.push(convertNode(node, ctx))
  }

  const markdownBody = parts.join('\n\n')
  const fullContent = frontmatterMarkdown
    ? (markdownBody ? `${frontmatterMarkdown}\n\n${markdownBody}` : frontmatterMarkdown)
    : markdownBody
  const allLines = fullContent.split('\n')
  const totalLines = allLines.length

  // 应用 offset/limit 分页
  if (options?.offset || options?.limit) {
    const offset = Math.max(0, (options.offset || 1) - 1) // 转为 0-based
    const limit = options.limit || totalLines

    const slicedLines = allLines.slice(offset, offset + limit)
    const from = offset + 1 // 转回 1-based
    const to = Math.min(offset + limit, totalLines)

    return {
      content: slicedLines.join('\n'),
      totalLines,
      returnedLines: { from, to },
      hasMore: to < totalLines
    }
  }

  return { content: fullContent, totalLines }
}

/**
 * 获取文档中所有的 headings
 */
export function getAllHeadings(
  doc: TiptapDoc | Record<string, unknown> | null | undefined
): DocumentHeading[] {
  if (!doc || typeof doc !== 'object') return []
  if (doc.type !== 'doc') return []

  const nodes = (doc as TiptapDoc).content || []
  const headings: DocumentHeading[] = []
  let lineCount = 1

  for (const node of nodes) {
    if (node.type === 'heading') {
      const level = (node.attrs?.level as number) || 1
      const text = extractPlainText(node)
      headings.push({ level, text, line: lineCount })
    }
    // 估算行号（每个块约占 2 行）
    lineCount += 2
  }

  return headings
}

/**
 * 从 JSON 字符串获取所有 headings
 */
export function getAllHeadingsFromJson(jsonString: string): DocumentHeading[] {
  try {
    const doc = JSON.parse(jsonString)
    return getAllHeadings(doc)
  } catch {
    return []
  }
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

/**
 * 从 JSON 字符串解析并转换为 Markdown（带分页信息）
 */
export function jsonToMarkdownWithMeta(
  jsonString: string,
  options?: ConvertOptions
): ConvertResult {
  try {
    const doc = JSON.parse(jsonString)
    return tiptapToMarkdownWithMeta(doc, options)
  } catch {
    // 如果不是有效的 JSON，返回原字符串
    const lines = jsonString.split('\n')
    return { content: jsonString, totalLines: lines.length }
  }
}
