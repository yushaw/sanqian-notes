import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Marked } from 'marked'
import DOMPurify from 'dompurify'
import { INLINE_MATH_GUARDED_RE, INLINE_MATH_DETECT_RE } from '../../../../shared/markdown/math-patterns'

/**
 * MarkdownPaste 扩展
 *
 * 功能：
 * 1. 检测粘贴内容是否为 Markdown
 * 2. 自动转换 Markdown 为富文本
 * 3. 支持自定义语法：Callout、Math、Mermaid、Highlight、Footnote
 */

// Isolated marked instance to avoid global state pollution
const marked = new Marked({ gfm: true, breaks: true })

// HTML 转义
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }
  return text.replace(/[&<>"']/g, (m) => map[m])
}

// 自定义 renderer 处理特殊语法
const renderer = new marked.Renderer()

// 处理代码块 - 识别 mermaid
renderer.code = function({ text, lang }) {
  if (lang === 'mermaid') {
    return `<div data-mermaid><pre class="mermaid">${escapeHtml(text)}</pre></div>`
  }
  // 普通代码块 - 保持原样，让 TipTap 的 CodeBlock 扩展处理
  return `<pre><code class="language-${escapeHtml(lang || '')}">${escapeHtml(text)}</code></pre>`
}

// 使用自定义 renderer
marked.use({ renderer })

/**
 * 预处理 Markdown，转换自定义语法为 HTML
 * 注意：需要在 marked 解析之前处理，避免冲突
 */
function preprocessMarkdown(text: string): string {
  let result = text

  // 0. 先保护代码块中的内容，避免被误处理
  const codeBlocks: string[] = []
  result = result.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match)
    return `\x00CODE_BLOCK_${codeBlocks.length - 1}\x00`
  })

  // 同样保护行内代码
  const inlineCodes: string[] = []
  result = result.replace(/`[^`]+`/g, (match) => {
    inlineCodes.push(match)
    return `\x00INLINE_CODE_${inlineCodes.length - 1}\x00`
  })

  // 1. 处理 Obsidian Callout: > [!note] Title
  // 支持多行内容
  result = result.replace(
    /^>\s*\[!(\w+)\](?:\s*(.+))?(?:\n(?:>.*)?)*$/gm,
    (match, type, title) => {
      // 提取所有 > 开头的行作为内容
      const lines = match.split('\n')
      const contentLines = lines.slice(1).map((line: string) => line.replace(/^>\s?/, ''))
      const cleanContent = contentLines.join('\n').trim()

      const titleAttr = title ? ` data-callout-title="${escapeHtml(title.trim())}"` : ''
      // 如果有内容，递归处理内容中的 Markdown
      if (cleanContent) {
        return `<div data-callout data-callout-type="${type.toLowerCase()}"${titleAttr}><p>${escapeHtml(cleanContent)}</p></div>`
      }
      return `<div data-callout data-callout-type="${type.toLowerCase()}"${titleAttr}><p></p></div>`
    }
  )

  // 2. 处理块级数学公式: $$...$$ (可能跨行)
  result = result.replace(
    /\$\$([\s\S]+?)\$\$/g,
    (_match, latex) => {
      const trimmedLatex = latex.trim()
      return `<div data-math-block><span data-type="inlineMath" data-latex="${escapeHtml(trimmedLatex)}" data-display="yes">$$${escapeHtml(trimmedLatex)}$$</span></div>`
    }
  )

  // 3. 处理行内数学公式: $...$ (see math-patterns.ts for convention details)
  result = result.replace(
    INLINE_MATH_GUARDED_RE,
    (_match, latex) => {
      const trimmedLatex = latex.trim()
      // 跳过看起来像货币的情况 (纯数字)
      if (/^\d+([.,]\d+)?$/.test(trimmedLatex)) {
        return _match
      }
      return `<span data-type="inlineMath" data-latex="${escapeHtml(trimmedLatex)}" data-display="no">$${escapeHtml(trimmedLatex)}$</span>`
    }
  )

  // 4. 处理高亮: ==text== -> <mark>text</mark>
  result = result.replace(
    /==([^=]+)==/g,
    (_match, text) => `<mark>${escapeHtml(text)}</mark>`
  )

  // 5. 处理脚注引用: [^1] -> <span data-footnote>
  // 注意：脚注定义 [^1]: xxx 会被当作普通文本，暂不处理
  result = result.replace(
    /\[\^(\w+)\](?!:)/g,
    (_match, id) => `<span data-footnote class="footnote-ref" data-id="${escapeHtml(id)}"></span>`
  )

  // 6. 恢复行内代码
  inlineCodes.forEach((code, i) => {
    result = result.replace(`\x00INLINE_CODE_${i}\x00`, code)
  })

  // 7. 恢复代码块
  codeBlocks.forEach((block, i) => {
    result = result.replace(`\x00CODE_BLOCK_${i}\x00`, block)
  })

  return result
}

/**
 * 检测文本是否像 Markdown
 * 需要至少匹配 2 个模式才认为是 Markdown（或者有明确的单一特征）
 */
export function looksLikeMarkdown(text: string): boolean {
  if (!text || text.length < 2) return false

  const patterns = [
    /^#{1,6}\s+\S/m,                          // 标题: # ## ###
    /\*\*[^*]+\*\*/,                          // 粗体: **text**
    /(?<!\*)\*[^*\s][^*]*\*(?!\*)/,           // 斜体: *text*
    /(?<!_)_[^_\s][^_]*_(?!_)/,               // 斜体: _text_
    /\[([^\]]+)\]\(([^)]+)\)/,                // 链接: [text](url)
    /^\s*[-*+]\s+\S/m,                        // 无序列表: - item
    /^\s*\d+\.\s+\S/m,                        // 有序列表: 1. item
    /```[\s\S]*?```/,                         // 代码块: ```code```
    /`[^`]+`/,                                // 行内代码: `code`
    /^\|.+\|$/m,                              // 表格: | a | b |
    /^>\s+\S/m,                               // 引用: > text
    /^>\s*\[!\w+\]/m,                         // Callout: > [!note]
    /\$\$[\s\S]+?\$\$/,                       // 块级公式: $$...$$
    INLINE_MATH_DETECT_RE,                    // 行内公式: $...$
    /==[^=]+==/,                              // 高亮: ==text==
    /^\s*[-*]\s+\[[ x]\]/mi,                  // 任务列表: - [ ] or - [x]
    /\[\^\w+\]/,                              // 脚注: [^1]
  ]

  let matchCount = 0
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      matchCount++
      if (matchCount >= 2) return true
    }
  }

  // 特殊情况：只有一个模式但很明确是 Markdown
  if (matchCount === 1) {
    // 以 # 开头的标题
    if (/^#{1,6}\s+\S/.test(text)) return true
    // 代码块
    if (/^```/.test(text)) return true
    // Callout
    if (/^>\s*\[!\w+\]/.test(text)) return true
  }

  return false
}

/**
 * 将 Markdown 转换为 HTML
 */
export function markdownToHtml(markdown: string): string {
  // 预处理自定义语法
  const preprocessed = preprocessMarkdown(markdown)

  // 使用 marked 解析标准 Markdown
  const html = marked.parse(preprocessed) as string

  // 使用 DOMPurify 清理 HTML（防止 XSS）
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      // 基础文本
      'p', 'br', 'span',
      // 标题
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      // 格式
      'strong', 'b', 'em', 'i', 'u', 's', 'del', 'mark', 'code', 'pre',
      // 列表
      'ul', 'ol', 'li',
      // 表格
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      // 其他块元素
      'blockquote', 'hr', 'div',
      // 链接和图片
      'a', 'img',
      // 任务列表
      'input',
      // details/summary (Toggle)
      'details', 'summary',
    ],
    ALLOWED_ATTR: [
      'href', 'title', 'alt', 'src', 'class',
      'type', 'checked', 'disabled',
      // 自定义属性 - 明确列出
      'data-callout', 'data-callout-type', 'data-callout-title', 'data-collapsed',
      'data-type', 'data-latex', 'data-display',
      'data-mermaid',
      'data-footnote', 'data-id',
      'data-toggle', 'data-open', 'data-summary',
      'data-math-block',
    ],
    // 不使用 ALLOW_DATA_ATTR: true，只允许明确列出的 data 属性
  })

  return clean
}

export const MarkdownPaste = Extension.create({
  name: 'markdownPaste',

  addProseMirrorPlugins() {
    const editor = this.editor

    return [
      new Plugin({
        key: new PluginKey('markdownPaste'),
        props: {
          handlePaste(_view, event) {
            const clipboardData = event.clipboardData
            if (!clipboardData) return false

            // 如果有 HTML 内容（从其他应用复制的富文本），让 TipTap 默认处理
            const html = clipboardData.getData('text/html')
            if (html && html.trim()) return false

            // 获取纯文本
            const text = clipboardData.getData('text/plain')
            if (!text || !text.trim()) return false

            // 检测是否像 Markdown
            if (!looksLikeMarkdown(text)) return false

            // 转换 Markdown 为 HTML 并插入
            const convertedHtml = markdownToHtml(text)
            editor.commands.insertContent(convertedHtml, {
              parseOptions: {
                preserveWhitespace: false,
              },
            })

            return true
          },
        },
      }),
    ]
  },
})
