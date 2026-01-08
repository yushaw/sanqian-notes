/**
 * Markdown to TipTap JSON 转换
 *
 * 将 Markdown 文本转换为 TipTap 编辑器的 JSON 格式
 * 用于 SDK Tools API，让 AI 生成的 Markdown 能够存储为笔记内容
 */

import { marked, Token, Tokens } from 'marked'

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
  content: TiptapNode[]
}

/**
 * 解码 HTML 实体
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&') // 必须放在最后，避免二次解码
}

/**
 * 预处理 Markdown，处理自定义语法
 */
function preprocessMarkdown(markdown: string): string {
  let result = markdown

  // 保护代码块
  const codeBlocks: string[] = []
  result = result.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match)
    return `\x00CODE_BLOCK_${codeBlocks.length - 1}\x00`
  })

  // 保护行内代码
  const inlineCodes: string[] = []
  result = result.replace(/`[^`]+`/g, (match) => {
    inlineCodes.push(match)
    return `\x00INLINE_CODE_${inlineCodes.length - 1}\x00`
  })

  // 保护 data URI（base64 图片等）
  const dataUris: string[] = []
  result = result.replace(/data:[^)\s"']+/g, (match) => {
    dataUris.push(match)
    return `\x00DATA_URI_${dataUris.length - 1}\x00`
  })

  // 保护图片标签中的 src 属性（防止 base64 被处理）
  const imgTags: string[] = []
  result = result.replace(/<img[^>]+>/gi, (match) => {
    imgTags.push(match)
    return `\x00IMG_TAG_${imgTags.length - 1}\x00`
  })

  // 处理高亮: ==text== -> 特殊标记
  result = result.replace(/==([^=]+)==/g, '\x00HIGHLIGHT_START\x00$1\x00HIGHLIGHT_END\x00')

  // 处理下划线: ++text++ -> 特殊标记
  result = result.replace(/\+\+([^+]+)\+\+/g, '\x00UNDERLINE_START\x00$1\x00UNDERLINE_END\x00')

  // 恢复图片标签
  imgTags.forEach((tag, i) => {
    result = result.replace(`\x00IMG_TAG_${i}\x00`, tag)
  })

  // 恢复 data URI
  dataUris.forEach((uri, i) => {
    result = result.replace(`\x00DATA_URI_${i}\x00`, uri)
  })

  // 恢复行内代码
  inlineCodes.forEach((code, i) => {
    result = result.replace(`\x00INLINE_CODE_${i}\x00`, code)
  })

  // 恢复代码块
  codeBlocks.forEach((block, i) => {
    result = result.replace(`\x00CODE_BLOCK_${i}\x00`, block)
  })

  return result
}

/**
 * 解析行内 tokens
 */
function parseInlineTokens(tokens: Token[]): TiptapNode[] {
  const nodes: TiptapNode[] = []

  for (const token of tokens) {
    switch (token.type) {
      case 'text': {
        const textToken = token as Tokens.Text
        const text = textToken.text

        // 处理自定义标记（高亮和下划线）
        if (text.includes('\x00HIGHLIGHT_START\x00') || text.includes('\x00UNDERLINE_START\x00')) {
          // 先处理高亮
          let segments: { text: string; marks: TiptapMark[] }[] = [{ text, marks: [] }]

          // 处理高亮标记 - 需要在 filter 之前记录原始索引
          segments = segments.flatMap(seg => {
            if (!seg.text.includes('\x00HIGHLIGHT_START\x00')) return [seg]
            const parts = seg.text.split(/\x00HIGHLIGHT_START\x00|\x00HIGHLIGHT_END\x00/)
            const result: { text: string; marks: TiptapMark[] }[] = []
            for (let i = 0; i < parts.length; i++) {
              if (parts[i]) {
                result.push({
                  text: parts[i],
                  marks: i % 2 === 1 ? [...seg.marks, { type: 'highlight' }] : seg.marks
                })
              }
            }
            return result
          })

          // 处理下划线标记 - 同样需要在 filter 之前记录原始索引
          segments = segments.flatMap(seg => {
            if (!seg.text.includes('\x00UNDERLINE_START\x00')) return [seg]
            const parts = seg.text.split(/\x00UNDERLINE_START\x00|\x00UNDERLINE_END\x00/)
            const result: { text: string; marks: TiptapMark[] }[] = []
            for (let i = 0; i < parts.length; i++) {
              if (parts[i]) {
                result.push({
                  text: parts[i],
                  marks: i % 2 === 1 ? [...seg.marks, { type: 'underline' }] : seg.marks
                })
              }
            }
            return result
          })

          for (const seg of segments) {
            nodes.push({
              type: 'text',
              text: seg.text,
              ...(seg.marks.length > 0 ? { marks: seg.marks } : {})
            })
          }
        } else {
          nodes.push({ type: 'text', text })
        }
        break
      }

      case 'strong': {
        const strongToken = token as Tokens.Strong
        const children = parseInlineTokens(strongToken.tokens || [])
        for (const child of children) {
          if (child.type === 'text') {
            child.marks = [...(child.marks || []), { type: 'bold' }]
          }
          nodes.push(child)
        }
        break
      }

      case 'em': {
        const emToken = token as Tokens.Em
        const children = parseInlineTokens(emToken.tokens || [])
        for (const child of children) {
          if (child.type === 'text') {
            child.marks = [...(child.marks || []), { type: 'italic' }]
          }
          nodes.push(child)
        }
        break
      }

      case 'del': {
        const delToken = token as Tokens.Del
        const children = parseInlineTokens(delToken.tokens || [])
        for (const child of children) {
          if (child.type === 'text') {
            child.marks = [...(child.marks || []), { type: 'strike' }]
          }
          nodes.push(child)
        }
        break
      }

      case 'codespan': {
        const codeToken = token as Tokens.Codespan
        nodes.push({
          type: 'text',
          text: codeToken.text,
          marks: [{ type: 'code' }]
        })
        break
      }

      case 'link': {
        const linkToken = token as Tokens.Link
        const linkText = linkToken.tokens ? parseInlineTokens(linkToken.tokens) : [{ type: 'text', text: linkToken.text }]
        for (const child of linkText) {
          if (child.type === 'text') {
            child.marks = [...(child.marks || []), { type: 'link', attrs: { href: linkToken.href } }]
          }
          nodes.push(child)
        }
        break
      }

      case 'image': {
        const imgToken = token as Tokens.Image
        nodes.push({
          type: 'image',
          attrs: {
            blockId: null,
            src: imgToken.href,
            alt: imgToken.text || '',
            title: imgToken.title || null,
            width: null,
            height: null,
            align: 'left'
          }
        })
        break
      }

      case 'br':
        nodes.push({ type: 'hardBreak' })
        break

      case 'escape': {
        const escapeToken = token as Tokens.Escape
        nodes.push({ type: 'text', text: escapeToken.text })
        break
      }

      default:
        // 尝试提取 raw 文本
        if ('raw' in token && typeof token.raw === 'string') {
          nodes.push({ type: 'text', text: token.raw })
        }
    }
  }

  return nodes
}

/**
 * 解析单个 token
 */
function parseToken(token: Token): TiptapNode[] {
  switch (token.type) {
    case 'heading': {
      const headingToken = token as Tokens.Heading
      return [{
        type: 'heading',
        attrs: { level: headingToken.depth },
        content: parseInlineTokens(headingToken.tokens || [])
      }]
    }

    case 'paragraph': {
      const paraToken = token as Tokens.Paragraph
      const text = paraToken.raw?.trim() || ''

      // 检查是否是块级数学公式
      // 统一使用 inlineMath + display: 'yes'，包裹在 paragraph 中
      // 与用户输入 $$...$$ 创建的节点保持一致
      const mathMatch = text.match(/^\$\$([\s\S]+?)\$\$$/)
      if (mathMatch) {
        return [{
          type: 'paragraph',
          content: [{
            type: 'inlineMath',
            attrs: { latex: mathMatch[1].trim(), display: 'yes' }
          }]
        }]
      }

      // 检查是否是 Callout
      const calloutMatch = text.match(/^>\s*\[!(\w+)\](?:\s*(.+))?\n?([\s\S]*)$/)
      if (calloutMatch) {
        const [, type, title, content] = calloutMatch
        const cleanContent = content?.split('\n')
          .map(line => line.replace(/^>\s?/, ''))
          .join('\n')
          .trim() || ''

        return [{
          type: 'callout',
          attrs: { type: type.toLowerCase(), title: title?.trim() || '' },
          content: cleanContent
            ? [{ type: 'paragraph', content: [{ type: 'text', text: cleanContent }] }]
            : []
        }]
      }

      const content = parseInlineTokens(paraToken.tokens || [])

      // 检查是否只包含行内数学公式
      if (content.length === 0 && text) {
        // 解析行内数学公式
        const inlineNodes: TiptapNode[] = []
        let remaining = text

        while (remaining) {
          const inlineMathMatch = remaining.match(/^(.*?)\$([^$\n]+)\$(.*)$/)
          if (inlineMathMatch) {
            const [, before, latex, after] = inlineMathMatch
            if (before) {
              inlineNodes.push({ type: 'text', text: before })
            }
            inlineNodes.push({
              type: 'inlineMath',
              attrs: { latex }
            })
            remaining = after
          } else {
            if (remaining) {
              inlineNodes.push({ type: 'text', text: remaining })
            }
            break
          }
        }

        if (inlineNodes.length > 0) {
          return [{ type: 'paragraph', content: inlineNodes }]
        }
      }

      return [{ type: 'paragraph', content }]
    }

    case 'blockquote': {
      const quoteToken = token as Tokens.Blockquote
      const rawText = quoteToken.raw?.trim() || ''

      // 检查是否是 Callout
      const calloutMatch = rawText.match(/^>\s*\[!(\w+)\](?:\s*(.+))?\n?([\s\S]*)$/)
      if (calloutMatch) {
        const [, type, title, content] = calloutMatch
        const cleanContent = content?.split('\n')
          .map(line => line.replace(/^>\s?/, ''))
          .join('\n')
          .trim() || ''

        return [{
          type: 'callout',
          attrs: { type: type.toLowerCase(), title: title?.trim() || '' },
          content: cleanContent
            ? [{ type: 'paragraph', content: [{ type: 'text', text: cleanContent }] }]
            : []
        }]
      }

      const content: TiptapNode[] = []
      for (const childToken of quoteToken.tokens || []) {
        content.push(...parseToken(childToken))
      }
      return [{ type: 'blockquote', content }]
    }

    case 'list': {
      const listToken = token as Tokens.List
      const isTask = listToken.items.some(item => item.task)

      if (isTask) {
        return [{
          type: 'taskList',
          content: listToken.items.map(item => ({
            type: 'taskItem',
            attrs: { checked: item.checked || false },
            content: parseListItemContent(item)
          }))
        }]
      }

      if (listToken.ordered) {
        return [{
          type: 'orderedList',
          attrs: { start: listToken.start || 1 },
          content: listToken.items.map(item => ({
            type: 'listItem',
            content: parseListItemContent(item)
          }))
        }]
      }

      return [{
        type: 'bulletList',
        content: listToken.items.map(item => ({
          type: 'listItem',
          content: parseListItemContent(item)
        }))
      }]
    }

    case 'code': {
      const codeToken = token as Tokens.Code

      // Mermaid 特殊处理
      if (codeToken.lang === 'mermaid') {
        return [{
          type: 'mermaid',
          attrs: { code: codeToken.text }
        }]
      }

      return [{
        type: 'codeBlock',
        attrs: { language: codeToken.lang || '' },
        content: [{ type: 'text', text: codeToken.text }]
      }]
    }

    case 'hr':
      return [{ type: 'horizontalRule' }]

    case 'table': {
      const tableToken = token as Tokens.Table
      const rows: TiptapNode[] = []

      // Header row
      rows.push({
        type: 'tableRow',
        content: tableToken.header.map(cell => ({
          type: 'tableHeader',
          content: [{ type: 'paragraph', content: parseInlineTokens(cell.tokens) }]
        }))
      })

      // Body rows
      for (const row of tableToken.rows) {
        rows.push({
          type: 'tableRow',
          content: row.map(cell => ({
            type: 'tableCell',
            content: [{ type: 'paragraph', content: parseInlineTokens(cell.tokens) }]
          }))
        })
      }

      return [{ type: 'table', content: rows }]
    }

    case 'html': {
      const htmlToken = token as Tokens.HTML
      const htmlText = htmlToken.text.trim()

      // 检查是否是 HTML 注释
      const commentMatch = htmlText.match(/^<!--([\s\S]*?)-->$/)
      if (commentMatch) {
        return [{
          type: 'htmlComment',
          attrs: { content: commentMatch[1].trim() }
        }]
      }

      // 检查是否是 HTML 表格
      if (htmlText.startsWith('<table') && htmlText.includes('</table>')) {
        const tableNode = parseHtmlTable(htmlText)
        if (tableNode) {
          return [tableNode]
        }
      }

      // 简单处理其他 HTML，作为段落文本
      return [{ type: 'paragraph', content: [{ type: 'text', text: htmlToken.text }] }]
    }

    case 'space': {
      // space token 表示段落之间的空行
      // 每个空行都应该显示为一个空段落（不带 content 字段，与手动创建的格式一致）
      const spaceToken = token as Tokens.Space
      const newlineCount = (spaceToken.raw.match(/\n/g) || []).length
      // 2个换行 = 1个空行，3个换行 = 2个空行，以此类推
      if (newlineCount >= 2) {
        const emptyParagraphs: TiptapNode[] = []
        for (let i = 1; i < newlineCount; i++) {
          emptyParagraphs.push({ type: 'paragraph', attrs: { blockId: null } })
        }
        return emptyParagraphs
      }
      return []
    }

    default:
      return []
  }
}

/**
 * 解析 HTML 表格为 TipTap 表格节点
 *
 * TextIn API 返回的 markdown 中包含 HTML 表格，需要转换为 TipTap 格式
 */
function parseHtmlTable(html: string): TiptapNode | null {
  try {
    // 简单的 HTML 表格解析器
    const rows: TiptapNode[] = []

    // 提取所有行
    const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
    let trMatch

    let isFirstRow = true
    while ((trMatch = trRegex.exec(html)) !== null) {
      const rowHtml = trMatch[1]
      const cells: TiptapNode[] = []

      // 提取单元格（th 或 td）- 先匹配完整标签，再提取属性
      const cellRegex = /<(th|td)([^>]*)>([\s\S]*?)<\/\1>/gi
      let cellMatch

      while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
        const cellType = cellMatch[1].toLowerCase()
        const cellAttrs = cellMatch[2] || ''
        const cellContent = decodeHtmlEntities(
          cellMatch[3]
            .replace(/<[^>]+>/g, '') // 移除内部 HTML 标签
            .replace(/\n/g, ' ')
            .trim()
        )

        // 从属性字符串中提取 colspan
        const colspanMatch = cellAttrs.match(/colspan=['"]?(\d+)['"]?/i)
        const colspan = colspanMatch ? parseInt(colspanMatch[1], 10) : 1

        // 根据是否是表头或第一行决定单元格类型
        const isHeader = cellType === 'th' || isFirstRow
        const tiptapCellType = isHeader ? 'tableHeader' : 'tableCell'

        const cellNode: TiptapNode = {
          type: tiptapCellType,
          attrs: colspan > 1 ? { colspan } : undefined,
          content: [{
            type: 'paragraph',
            content: cellContent ? [{ type: 'text', text: cellContent }] : []
          }]
        }

        cells.push(cellNode)
      }

      if (cells.length > 0) {
        rows.push({
          type: 'tableRow',
          content: cells
        })
        isFirstRow = false
      }
    }

    if (rows.length === 0) {
      return null
    }

    return {
      type: 'table',
      content: rows
    }
  } catch {
    return null
  }
}

/**
 * 解析 <details> 标签序列
 *
 * marked 会把 <details> 拆分成多个 token：
 * 1. html: <details><summary>...</summary>
 * 2. paragraph/其他: 内容
 * 3. html: </details>
 *
 * 此函数收集这些 tokens 并转换为 toggle 节点
 */
function parseDetailsTokens(
  tokens: Token[],
  startIndex: number
): { node: TiptapNode; endIndex: number } | null {
  const startToken = tokens[startIndex]
  if (startToken.type !== 'html') return null

  const startHtml = startToken.raw

  // 提取 summary
  const summaryMatch = startHtml.match(/<summary>([^<]*)<\/summary>/)
  const summary = summaryMatch ? summaryMatch[1].trim() : ''

  // 收集内容 tokens 直到 </details>
  const contentTokens: Token[] = []
  let endIndex = startIndex

  for (let i = startIndex + 1; i < tokens.length; i++) {
    const token = tokens[i]

    if (token.type === 'html' && token.raw.trim() === '</details>') {
      endIndex = i
      break
    }

    contentTokens.push(token)
    endIndex = i
  }

  // 解析内容
  const content: TiptapNode[] = []
  for (const token of contentTokens) {
    content.push(...parseToken(token))
  }

  // 如果没有内容，添加一个空段落
  if (content.length === 0) {
    content.push({ type: 'paragraph', content: [] })
  }

  return {
    node: {
      type: 'toggle',
      attrs: { open: true, summary: summary || '点击展开' },
      content
    },
    endIndex
  }
}

/**
 * 解析列表项内容
 */
function parseListItemContent(item: Tokens.ListItem): TiptapNode[] {
  const content: TiptapNode[] = []

  for (const token of item.tokens || []) {
    if (token.type === 'text') {
      // 文本类型需要包装在段落中
      const textToken = token as Tokens.Text
      if (textToken.tokens) {
        content.push({
          type: 'paragraph',
          content: parseInlineTokens(textToken.tokens)
        })
      } else {
        content.push({
          type: 'paragraph',
          content: [{ type: 'text', text: textToken.text }]
        })
      }
    } else {
      content.push(...parseToken(token))
    }
  }

  return content
}

/**
 * 后处理：处理行内数学公式
 */
function postProcessMath(nodes: TiptapNode[]): TiptapNode[] {
  return nodes.map(node => {
    if (node.type === 'paragraph' && node.content) {
      const newContent: TiptapNode[] = []

      for (const child of node.content) {
        if (child.type === 'text' && child.text) {
          // 检查行内数学公式
          const parts = child.text.split(/(\$[^$\n]+\$)/)
          for (const part of parts) {
            if (!part) continue
            const mathMatch = part.match(/^\$([^$\n]+)\$$/)
            if (mathMatch) {
              newContent.push({
                type: 'inlineMath',
                attrs: { latex: mathMatch[1] }
              })
            } else {
              // 保留原有的 marks
              newContent.push({
                type: 'text',
                text: part,
                ...(child.marks ? { marks: child.marks } : {})
              })
            }
          }
        } else {
          newContent.push(child)
        }
      }

      return { ...node, content: newContent }
    }

    // 递归处理子节点
    if (node.content) {
      return { ...node, content: postProcessMath(node.content) }
    }

    return node
  })
}

/**
 * 后处理：移除空文本节点
 * TipTap 不允许空文本节点，会导致 "Empty text nodes are not allowed" 错误
 */
function removeEmptyTextNodes(nodes: TiptapNode[]): TiptapNode[] {
  return nodes
    .filter(node => {
      // 过滤掉空文本节点
      if (node.type === 'text') {
        return node.text !== undefined && node.text !== null && node.text !== ''
      }
      return true
    })
    .map(node => {
      // 递归处理子节点
      if (node.content && Array.isArray(node.content)) {
        const filteredContent = removeEmptyTextNodes(node.content)
        // 如果内容为空，某些节点类型需要特殊处理
        if (filteredContent.length === 0) {
          // 这些节点类型可以有空内容
          const allowEmptyContent = [
            'paragraph', 'heading', 'blockquote',
            'listItem', 'taskItem', 'tableCell', 'tableHeader',
            'toggle', 'callout', 'codeBlock', 'tableRow', 'table',
            'bulletList', 'orderedList', 'taskList'
          ]
          if (allowEmptyContent.includes(node.type)) {
            return { ...node, content: [] }
          }
        }
        return { ...node, content: filteredContent }
      }
      return node
    })
}

/**
 * 将 Markdown 转换为 TipTap JSON
 *
 * @param markdown - Markdown 文本
 * @returns TipTap 文档 JSON
 */
export function markdownToTiptap(markdown: string | null | undefined): TiptapDoc {
  if (!markdown || typeof markdown !== 'string') {
    return { type: 'doc', content: [] }
  }

  const trimmed = markdown.trim()
  if (!trimmed) {
    return { type: 'doc', content: [] }
  }

  // 预处理自定义语法
  const preprocessed = preprocessMarkdown(trimmed)

  // 配置 marked
  marked.setOptions({
    gfm: true,
    breaks: true
  })

  // 使用 marked 解析
  const tokens = marked.lexer(preprocessed)

  // 转换为 TipTap 节点
  const content: TiptapNode[] = []

  // 处理 tokens，需要特殊处理 <details> 标签（marked 会拆分成多个 token）
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]

    // 检测 <details> 开始标签
    if (token.type === 'html' && token.raw.trim().startsWith('<details')) {
      const result = parseDetailsTokens(tokens, i)
      if (result) {
        content.push(result.node)
        i = result.endIndex // 跳过已处理的 tokens
        continue
      }
    }

    content.push(...parseToken(token))
  }

  // 后处理：处理行内数学公式
  const processedContent = postProcessMath(content)

  // 后处理：移除空文本节点（TipTap 不允许）
  const cleanedContent = removeEmptyTextNodes(processedContent)

  return {
    type: 'doc',
    content: cleanedContent
  }
}

/**
 * 将 Markdown 转换为 TipTap JSON 字符串
 */
export function markdownToTiptapString(markdown: string): string {
  const doc = markdownToTiptap(markdown)
  return JSON.stringify(doc)
}
