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

  // 处理高亮: ==text== -> 特殊标记
  result = result.replace(/==([^=]+)==/g, '\x00HIGHLIGHT_START\x00$1\x00HIGHLIGHT_END\x00')

  // 处理下划线: ++text++ -> 特殊标记
  result = result.replace(/\+\+([^+]+)\+\+/g, '\x00UNDERLINE_START\x00$1\x00UNDERLINE_END\x00')

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
            src: imgToken.href,
            alt: imgToken.text || ''
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
      const mathMatch = text.match(/^\$\$([\s\S]+?)\$\$$/)
      if (mathMatch) {
        return [{
          type: 'mathematics',
          attrs: { latex: mathMatch[1].trim(), display: 'yes' }
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
      // 简单处理 HTML，作为段落文本
      return [{ type: 'paragraph', content: [{ type: 'text', text: htmlToken.text }] }]
    }

    case 'space':
      return []

    default:
      return []
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

  return {
    type: 'doc',
    content: processedContent
  }
}

/**
 * 将 Markdown 转换为 TipTap JSON 字符串
 */
export function markdownToTiptapString(markdown: string): string {
  const doc = markdownToTiptap(markdown)
  return JSON.stringify(doc)
}
