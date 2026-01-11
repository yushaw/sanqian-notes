/**
 * 单篇笔记导出模块
 *
 * 支持导出为 Markdown 和 PDF 格式
 */

import { BrowserWindow, dialog, app } from 'electron'
import { writeFile, mkdir, copyFile, unlink } from 'fs/promises'
import { existsSync, readFileSync } from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { createRequire } from 'module'
import { getNoteById, getNotes, searchNotes } from '../database'
import { jsonToMarkdown } from '../markdown/tiptap-to-markdown'
import { getUserDataPath } from '../attachment'
import katex from 'katex'
import hljs from 'highlight.js'

/** Wait time for CSS rendering before PDF generation (ms) */
const PDF_RENDER_DELAY_MS = 200

// ============ PDF 预览模板（内联） ============

const PDF_STYLES = `
/* PDF Export Styles - Light Theme */
@page { size: A4; margin: 2cm; }
* { box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 14px; line-height: 1.7; color: #1a1a1a; background: white; margin: 0; padding: 20px;
}
.document { max-width: 100%; margin: 0 auto; }
.document-title {
  font-size: 28px; font-weight: 600; margin: 0 0 24px 0;
  padding-bottom: 16px; border-bottom: 1px solid #e5e7eb; color: #111;
}
h1, h2, h3, h4, h5, h6 { margin: 1.5em 0 0.5em 0; font-weight: 600; line-height: 1.3; color: #111; }
h1 { font-size: 1.75em; } h2 { font-size: 1.5em; } h3 { font-size: 1.25em; } h4 { font-size: 1.1em; }
p { margin: 0.75em 0; }
a { color: #2563eb; text-decoration: none; }
strong { font-weight: 600; }
em { font-style: italic; }
del { text-decoration: line-through; color: #888; }
mark { background-color: #fef08a; padding: 0.1em 0.2em; border-radius: 2px; }
ul, ol { margin: 0.75em 0; padding-left: 1.5em; }
li { margin: 0.25em 0; }
li > p { margin: 0; }
.task-list { list-style: none; padding-left: 0; }
.task-item { display: flex; align-items: flex-start; gap: 8px; }
.task-item input[type="checkbox"] { margin-top: 4px; width: 16px; height: 16px; }
blockquote {
  margin: 1em 0; padding: 0.5em 1em; border-left: 3px solid #d1d5db;
  background: #f9fafb; color: #4b5563;
}
blockquote p { margin: 0.5em 0; }
code {
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace; font-size: 0.9em;
  background: #f3f4f6; padding: 0.15em 0.4em; border-radius: 4px; color: #24292e;
}
pre { margin: 1em 0; padding: 1em; background: #f6f8fa; border: 1px solid #e1e4e8; border-radius: 8px; overflow-x: auto; }
pre code { background: transparent; padding: 0; font-size: 13px; line-height: 1.5; color: #24292e; }
table { width: 100%; border-collapse: collapse; margin: 1em 0; font-size: 0.95em; }
th, td { border: 1px solid #d1d5db; padding: 8px 12px; text-align: left; }
th { background: #f3f4f6; font-weight: 600; }
tr:nth-child(even) td { background: #f9fafb; }
img { max-width: 100%; height: auto; border-radius: 4px; }
hr { border: none; border-top: 1px solid #e5e7eb; margin: 2em 0; }
.callout {
  margin: 1em 0; padding: 12px 16px; border-radius: 8px;
  border-left: 4px solid var(--callout-color, #64748b); background: var(--callout-bg, #f8fafc);
}
.callout-title { font-weight: 600; margin-bottom: 8px; color: var(--callout-color, #64748b); }
.callout-content { color: #374151; }
.callout-note { --callout-color: #64748b; --callout-bg: #f8fafc; }
.callout-tip { --callout-color: #059669; --callout-bg: #ecfdf5; }
.callout-warning { --callout-color: #d97706; --callout-bg: #fffbeb; }
.callout-danger { --callout-color: #dc2626; --callout-bg: #fef2f2; }
.callout-info { --callout-color: #4f46e5; --callout-bg: #eef2ff; }
details { margin: 1em 0; padding: 12px 16px; border: 1px solid #e5e7eb; border-radius: 8px; background: #fafafa; }
summary { font-weight: 500; cursor: pointer; padding: 4px 0; }
.math-block { margin: 1em 0; text-align: center; overflow-x: auto; }
video, audio { max-width: 100%; margin: 1em 0; border-radius: 8px; }
/* Mermaid 图表样式 */
.mermaid-container { margin: 1em 0; text-align: left; background: #f6f8fa; padding: 1em; border-radius: 8px; border: 1px solid #e1e4e8; }
.mermaid-container svg { max-width: 100%; height: auto; }
.mermaid-source { margin: 0; background: transparent; border: none; }
.mermaid-source code { background: transparent; font-size: 12px; }
.mermaid-note { margin: 8px 0 0 0; font-size: 12px; color: #6a737d; }
/* 文件附件 */
.file-attachment { display: inline-flex; align-items: center; padding: 2px 8px; background: #f3f4f6; border-radius: 4px; font-size: 0.9em; }
.file-attachment a { color: #2563eb; text-decoration: none; }
/* 脚注 */
.footnote-ref { color: #2563eb; cursor: help; }
/* 嵌入块 */
.embed-block { margin: 1em 0; padding: 16px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; }
.embed-title { font-weight: 600; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #e5e7eb; color: #374151; }
.embed-content { color: #4b5563; }
.embed-note .embed-content { max-height: 400px; overflow: hidden; }
/* 引用块 */
.transclusion-block { margin: 1em 0; padding: 16px; background: #fefce8; border-left: 3px solid #eab308; border-radius: 4px; }
.transclusion-title { font-weight: 600; margin-bottom: 12px; color: #92400e; }
.transclusion-content { color: #78350f; }
/* 数据视图 */
.dataview-block { margin: 1em 0; padding: 16px; background: #f3f4f6; border-radius: 8px; }
.dataview-query { margin-bottom: 12px; padding: 8px; background: #e5e7eb; border-radius: 4px; }
.dataview-query code { background: transparent; padding: 0; font-size: 12px; }
.dataview-results { margin: 0; padding-left: 1.5em; }
.dataview-results li { margin: 4px 0; }
/* AI 任务 */
.agent-task { margin: 1em 0; padding: 12px; background: #f0f9ff; border-left: 3px solid #0ea5e9; border-radius: 4px; }
/* 笔记链接 */
.note-link { color: #6366f1; background: #eef2ff; padding: 0 4px; border-radius: 2px; }
/* Highlight.js GitHub Light Theme (内联) */
.hljs { color: #24292e; background: #f6f8fa; }
.hljs-comment, .hljs-quote { color: #6a737d; font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-subst { color: #d73a49; font-weight: normal; }
.hljs-string, .hljs-doctag, .hljs-addition { color: #22863a; }
.hljs-number, .hljs-literal { color: #005cc5; }
.hljs-built_in, .hljs-builtin-name { color: #005cc5; }
.hljs-function .hljs-title, .hljs-title.function_ { color: #6f42c1; }
.hljs-class .hljs-title, .hljs-title.class_ { color: #6f42c1; }
.hljs-attr, .hljs-attribute { color: #005cc5; }
.hljs-variable, .hljs-template-variable { color: #e36209; }
.hljs-type { color: #d73a49; }
.hljs-tag { color: #22863a; }
.hljs-name { color: #22863a; }
.hljs-selector-id, .hljs-selector-class { color: #6f42c1; }
.hljs-regexp, .hljs-link { color: #032f62; }
.hljs-symbol, .hljs-bullet { color: #005cc5; }
.hljs-meta { color: #6a737d; }
.hljs-deletion { color: #b31d28; background: #ffeef0; }
.hljs-addition { color: #22863a; background: #e6ffec; }
.hljs-emphasis { font-style: italic; }
.hljs-strong { font-weight: bold; }
@media print {
  body { padding: 0; }
  pre { white-space: pre-wrap; word-wrap: break-word; }
  h1, h2, h3, h4, h5, h6 { page-break-after: avoid; }
  pre, blockquote, table, .callout, details { page-break-inside: avoid; }
  img { page-break-inside: avoid; }
}
`

// 获取 node_modules 中的 CSS 文件
function getKatexCss(): string {
  try {
    const require = createRequire(import.meta.url)
    const katexCssPath = require.resolve('katex/dist/katex.min.css')
    return readFileSync(katexCssPath, 'utf-8')
  } catch (err) {
    console.warn('[PDF Export] Failed to load KaTeX CSS:', err)
    return ''
  }
}

// highlight.js GitHub 主题的核心样式（fallback）
const HLJS_FALLBACK_CSS = `
.hljs{color:#24292e;background:#f6f8fa}
.hljs-comment,.hljs-quote{color:#6a737d;font-style:italic}
.hljs-keyword,.hljs-selector-tag{color:#d73a49}
.hljs-string,.hljs-addition{color:#22863a}
.hljs-number,.hljs-literal,.hljs-built_in{color:#005cc5}
.hljs-function .hljs-title,.hljs-title.function_{color:#6f42c1}
.hljs-attr,.hljs-attribute{color:#005cc5}
.hljs-variable{color:#e36209}
`

function getHighlightCss(): string {
  try {
    const require = createRequire(import.meta.url)
    const hljsCssPath = require.resolve('highlight.js/styles/github.css')
    return readFileSync(hljsCssPath, 'utf-8')
  } catch (err) {
    console.warn('[PDF Export] Failed to load highlight.js CSS, using fallback:', err)
    return HLJS_FALLBACK_CSS
  }
}

// 缓存 PDF 模板
let cachedPdfTemplate: string | null = null

// 生成 PDF HTML 模板（不依赖外部 CDN）
function getPdfTemplate(): string {
  if (cachedPdfTemplate) return cachedPdfTemplate

  const katexCss = getKatexCss()
  const hljsCss = getHighlightCss()

  cachedPdfTemplate = `<!DOCTYPE html>
<html lang="zh-CN" style="color-scheme: light;">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light only">
  <title>PDF Export</title>
  <style>
    :root { color-scheme: light only; }
    @media (prefers-color-scheme: dark) {
      :root { color-scheme: light only; }
    }
    ${katexCss}
    ${hljsCss}
    ${PDF_STYLES}
  </style>
</head>
<body>
  <div class="document">
    <h1 id="title" class="document-title"></h1>
    <div id="content" class="document-content"></div>
  </div>
</body>
</html>`

  return cachedPdfTemplate
}

// ============ 类型定义 ============

export interface MarkdownExportOptions {
  /** 是否复制附件到同目录 */
  includeAttachments?: boolean
  /** 是否包含 Front Matter 元数据 */
  includeFrontMatter?: boolean
}

export interface PDFExportOptions {
  /** 页面大小 */
  pageSize?: 'A4' | 'Letter'
  /** 是否包含背景色 */
  includeBackground?: boolean
}

export interface ExportResult {
  success: boolean
  path?: string
  error?: string
}

// ============ 工具函数 ============

/**
 * 清理文件名，移除非法字符
 */
function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200) // 限制长度
}

/**
 * 生成 YAML Front Matter
 */
function generateFrontMatter(note: {
  title: string
  created_at: string
  updated_at: string
  is_daily: boolean
  daily_date: string | null
}): string {
  const lines = [
    '---',
    `title: ${JSON.stringify(note.title)}`,
    `created: ${note.created_at}`,
    `updated: ${note.updated_at}`,
  ]

  if (note.is_daily && note.daily_date) {
    lines.push(`daily_date: ${note.daily_date}`)
  }

  lines.push('---', '', '')
  return lines.join('\n')
}

/**
 * 从 Markdown 内容中提取附件路径
 */
function extractAttachmentPaths(markdown: string): string[] {
  const paths: string[] = []

  // 匹配图片: ![alt](path) 或 ![alt](sanqian://attachment/path)
  const imageRegex = /!\[([^\]]*)\]\((?:sanqian:\/\/attachment\/)?([^)]+)\)/g
  let match
  while ((match = imageRegex.exec(markdown)) !== null) {
    const src = match[2]
    // 只处理本地附件路径（不是 http/https）
    if (!src.startsWith('http://') && !src.startsWith('https://')) {
      paths.push(src)
    }
  }

  // 匹配视频/音频/文件附件
  const attachmentRegex = /\[([^\]]*)\]\((?:sanqian:\/\/attachment\/)?([^)]+)\)/g
  while ((match = attachmentRegex.exec(markdown)) !== null) {
    const src = match[2]
    if (!src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('#')) {
      // 检查是否是附件文件（常见格式）
      const ext = path.extname(src).toLowerCase()
      const attachmentExts = [
        // 视频
        '.mp4', '.webm', '.mov', '.avi', '.mkv',
        // 音频
        '.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac',
        // 文档
        '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
        // 压缩包
        '.zip', '.rar', '.7z', '.tar', '.gz',
      ]
      if (attachmentExts.includes(ext)) {
        paths.push(src)
      }
    }
  }

  return [...new Set(paths)] // 去重
}

/**
 * 复制附件到导出目录并更新 Markdown 中的路径
 */
async function copyAttachmentsAndUpdateContent(
  markdown: string,
  exportFilePath: string
): Promise<{ content: string; copiedCount: number }> {
  const attachmentDir = path.join(getUserDataPath(), 'attachments')
  const exportDir = path.dirname(exportFilePath)
  const assetsDir = path.join(exportDir, 'assets')

  const attachmentPaths = extractAttachmentPaths(markdown)
  if (attachmentPaths.length === 0) {
    return { content: markdown, copiedCount: 0 }
  }

  // 创建 assets 目录
  if (!existsSync(assetsDir)) {
    await mkdir(assetsDir, { recursive: true })
  }

  let updatedContent = markdown
  let copiedCount = 0

  for (const relativePath of attachmentPaths) {
    const sourcePath = path.join(attachmentDir, relativePath)
    // 使用目录前缀避免同名文件冲突（images/photo.png -> images_photo.png）
    const dir = path.dirname(relativePath)
    const basename = path.basename(relativePath)
    const uniqueFilename = dir && dir !== '.' ? `${dir.replace(/[\\/]/g, '_')}_${basename}` : basename
    const destPath = path.join(assetsDir, uniqueFilename)

    try {
      if (existsSync(sourcePath)) {
        await copyFile(sourcePath, destPath)
        copiedCount++

        // 更新 Markdown 中的路径
        // 替换 sanqian://attachment/path 和 直接路径
        updatedContent = updatedContent
          .replace(new RegExp(`sanqian://attachment/${escapeRegExp(relativePath)}`, 'g'), `./assets/${uniqueFilename}`)
          .replace(new RegExp(`\\]\\(${escapeRegExp(relativePath)}\\)`, 'g'), `](./assets/${uniqueFilename})`)
      }
    } catch (error) {
      console.error(`Failed to copy attachment: ${relativePath}`, error)
    }
  }

  return { content: updatedContent, copiedCount }
}

/**
 * 转义正则表达式特殊字符
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 将 TipTap JSON 转换为 HTML（用于 PDF 导出）
 * @param jsonContent JSON 内容字符串
 * @param depth 递归深度，防止无限循环
 */
function tiptapToHTML(jsonContent: string, depth = 0): string {
  if (depth > 3) {
    return '<p><em>(嵌套层级过深)</em></p>'
  }
  try {
    const doc = JSON.parse(jsonContent)
    return convertNodeToHTML(doc, depth)
  } catch {
    return '<p>Failed to parse content</p>'
  }
}

/**
 * 递归转换节点为 HTML
 * @param node 节点对象
 * @param depth 递归深度
 */
function convertNodeToHTML(node: Record<string, unknown>, depth = 0): string {
  if (!node) return ''

  const type = node.type as string
  const attrs = (node.attrs || {}) as Record<string, unknown>
  const content = node.content as Record<string, unknown>[] | undefined
  const text = node.text as string | undefined
  const marks = node.marks as Array<{ type: string; attrs?: Record<string, unknown> }> | undefined

  // 处理文本节点
  if (type === 'text' && text) {
    let result = escapeHTML(text)
    if (marks) {
      for (const mark of marks) {
        result = applyMarkToHTML(result, mark)
      }
    }
    return result
  }

  // 递归处理子节点
  const childHTML = content ? content.map(n => convertNodeToHTML(n, depth)).join('') : ''

  switch (type) {
    case 'doc':
      return childHTML

    case 'paragraph':
      return `<p>${childHTML}</p>`

    case 'heading': {
      const level = (attrs.level as number) || 1
      return `<h${level}>${childHTML}</h${level}>`
    }

    case 'bulletList':
      return `<ul>${childHTML}</ul>`

    case 'orderedList':
      return `<ol>${childHTML}</ol>`

    case 'listItem':
      return `<li>${childHTML}</li>`

    case 'taskList':
      return `<ul class="task-list">${childHTML}</ul>`

    case 'taskItem': {
      const checked = attrs.checked ? 'checked' : ''
      return `<li class="task-item"><input type="checkbox" ${checked} disabled />${childHTML}</li>`
    }

    case 'blockquote':
      return `<blockquote>${childHTML}</blockquote>`

    case 'codeBlock': {
      const language = (attrs.language as string) || ''
      // 直接提取原始文本，不使用 childHTML（已被转义）
      const code = content?.map(n => (n as { text?: string }).text || '').join('') || ''
      // 使用 highlight.js 预渲染代码高亮
      try {
        if (language && hljs.getLanguage(language)) {
          const highlighted = hljs.highlight(code, { language }).value
          return `<pre><code class="hljs language-${language}">${highlighted}</code></pre>`
        } else if (code) {
          const highlighted = hljs.highlightAuto(code).value
          return `<pre><code class="hljs">${highlighted}</code></pre>`
        }
      } catch {
        // 高亮失败时返回原始代码
      }
      return `<pre><code class="language-${language}">${escapeHTML(code)}</code></pre>`
    }

    case 'horizontalRule':
      return '<hr />'

    case 'hardBreak':
      return '<br />'

    case 'image':
    case 'resizableImage': {
      const src = attrs.src as string || ''
      const alt = attrs.alt as string || ''
      const width = attrs.width as number | undefined
      const style = width ? ` style="width: ${width}px"` : ''
      return `<img src="${escapeHTML(src)}" alt="${escapeHTML(alt)}"${style} />`
    }

    case 'table':
      return `<table>${childHTML}</table>`

    case 'tableRow':
      return `<tr>${childHTML}</tr>`

    case 'tableHeader':
      return `<th>${childHTML}</th>`

    case 'tableCell':
      return `<td>${childHTML}</td>`

    case 'inlineMath':
    case 'mathematics': {
      const latex = attrs.latex as string || ''
      const display = attrs.display === 'yes'
      // 使用 KaTeX 预渲染数学公式
      try {
        const rendered = katex.renderToString(latex, {
          displayMode: display,
          throwOnError: false,
          output: 'html',
        })
        if (display) {
          return `<div class="math-block">${rendered}</div>`
        }
        return `<span class="math-inline">${rendered}</span>`
      } catch {
        // 渲染失败时显示原始 LaTeX
        if (display) {
          return `<div class="math-block">$$${escapeHTML(latex)}$$</div>`
        }
        return `<span class="math-inline">$${escapeHTML(latex)}$</span>`
      }
    }

    case 'mermaid': {
      const code = attrs.code as string || ''
      // Mermaid 图表显示为代码块（服务端无法渲染 SVG）
      return `<div class="mermaid-container">
        <pre class="mermaid-source"><code>${escapeHTML(code)}</code></pre>
        <p class="mermaid-note"><em>Mermaid 图表源码</em></p>
      </div>`
    }

    case 'callout': {
      const calloutType = (attrs.type as string) || 'note'
      const title = attrs.title as string || ''
      return `<div class="callout callout-${calloutType}">
        ${title ? `<div class="callout-title">${escapeHTML(title)}</div>` : ''}
        <div class="callout-content">${childHTML}</div>
      </div>`
    }

    case 'details':
    case 'toggle': {
      const summary = attrs.summary as string || ''
      return `<details>
        <summary>${escapeHTML(summary)}</summary>
        ${childHTML}
      </details>`
    }

    case 'video': {
      const src = attrs.src as string || ''
      return `<video src="${escapeHTML(src)}" controls></video>`
    }

    case 'audio': {
      const src = attrs.src as string || ''
      return `<audio src="${escapeHTML(src)}" controls></audio>`
    }

    case 'fileAttachment': {
      const name = attrs.name as string || '附件'
      const src = attrs.src as string || ''
      const size = attrs.size as number | undefined
      const sizeStr = size ? ` (${formatFileSize(size)})` : ''
      return `<span class="file-attachment"><a href="${escapeHTML(src)}">${escapeHTML(name)}${sizeStr}</a></span>`
    }

    case 'footnote': {
      const content = attrs.content as string || ''
      const id = attrs.id as string || ''
      return `<sup class="footnote-ref" data-footnote-id="${escapeHTML(id)}" title="${escapeHTML(content)}">[*]</sup>`
    }

    case 'htmlComment':
      // HTML 注释不导出
      return ''

    case 'embedBlock': {
      const mode = attrs.mode as string || 'url'
      const url = attrs.url as string || ''
      const localPath = attrs.localPath as string || ''
      const title = attrs.title as string || ''
      const height = attrs.height as number || 400

      if (mode === 'url' && url) {
        // 处理视频网站 URL，禁止自动播放
        const embedUrl = disableAutoplay(url)
        // Web 嵌入：显示 iframe
        // 使用 sandbox 限制自动播放，allow 属性不包含 autoplay
        return `<div class="embed-block embed-web">
          ${title ? `<div class="embed-title">${escapeHTML(title)}</div>` : ''}
          <iframe src="${escapeHTML(embedUrl)}" style="width:100%;height:${height}px;border:1px solid #e5e7eb;border-radius:8px;" frameborder="0" scrolling="no" sandbox="allow-top-navigation allow-same-origin allow-forms allow-scripts" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>
        </div>`
      } else if (mode === 'local' && localPath) {
        // 本地笔记嵌入：获取笔记内容
        const embeddedNote = getNoteById(localPath)
        if (embeddedNote) {
          const embeddedHTML = tiptapToHTML(embeddedNote.content, depth + 1)
          return `<div class="embed-block embed-note">
            <div class="embed-title">${escapeHTML(embeddedNote.title || '未命名笔记')}</div>
            <div class="embed-content">${embeddedHTML}</div>
          </div>`
        }
        return `<div class="embed-block"><em>无法加载笔记</em></div>`
      }
      return `<div class="embed-block"><em>嵌入内容</em></div>`
    }

    case 'transclusionBlock': {
      const noteId = attrs.noteId as string || ''
      const noteName = attrs.noteName as string || ''

      // 获取引用笔记的内容
      const referencedNote = getNoteById(noteId)
      if (referencedNote) {
        const referencedHTML = tiptapToHTML(referencedNote.content, depth + 1)
        return `<div class="transclusion-block">
          <div class="transclusion-title">${escapeHTML(referencedNote.title || noteName || '未命名笔记')}</div>
          <div class="transclusion-content">${referencedHTML}</div>
        </div>`
      }
      return `<div class="transclusion-block"><em>引用: ${escapeHTML(noteName || noteId)}</em></div>`
    }

    case 'dataviewBlock': {
      const query = attrs.query as string || ''
      // 执行 dataview 查询
      const results = executeDataviewQuery(query)
      if (results.length > 0) {
        const listItems = results.map(r => `<li><strong>${escapeHTML(r.title)}</strong></li>`).join('')
        return `<div class="dataview-block">
          <div class="dataview-query"><code>${escapeHTML(query)}</code></div>
          <ul class="dataview-results">${listItems}</ul>
        </div>`
      }
      return `<div class="dataview-block"><code>${escapeHTML(query)}</code><p><em>无结果</em></p></div>`
    }

    case 'agentTask':
      // AI 任务块显示内容
      return `<div class="agent-task">${childHTML}</div>`

    default:
      return childHTML
  }
}

/**
 * 格式化文件大小
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * 禁止视频网站自动播放
 * 通过设置 URL 参数来禁止自动播放，同时移除可能绕过限制的 muted 参数
 */
function disableAutoplay(url: string): string {
  try {
    // 处理协议相对 URL（以 // 开头）
    let fullUrl = url
    if (url.startsWith('//')) {
      fullUrl = 'https:' + url
    }

    const urlObj = new URL(fullUrl)
    const host = urlObj.hostname.toLowerCase()

    // 通用处理：删除可能触发自动播放的参数
    urlObj.searchParams.delete('autoplay')
    urlObj.searchParams.delete('auto_play')

    // YouTube
    if (host.includes('youtube.com') || host.includes('youtu.be')) {
      urlObj.searchParams.set('autoplay', '0')
      urlObj.searchParams.set('mute', '0') // YouTube 用 mute 而不是 muted
      return urlObj.toString()
    }

    // Bilibili - 禁止自动播放
    if (host.includes('bilibili.com')) {
      urlObj.searchParams.set('autoplay', '0')
      urlObj.searchParams.set('danmaku', '0') // 关闭弹幕
      return urlObj.toString()
    }

    // Vimeo
    if (host.includes('vimeo.com') || host.includes('player.vimeo.com')) {
      urlObj.searchParams.set('autoplay', '0')
      urlObj.searchParams.set('background', '0')
      urlObj.searchParams.set('autopause', '1') // 切换标签页时暂停
      return urlObj.toString()
    }

    // 腾讯视频
    if (host.includes('v.qq.com') || host.includes('qq.com')) {
      urlObj.searchParams.set('autoplay', '0')
      urlObj.searchParams.set('auto', '0')
      return urlObj.toString()
    }

    // 优酷
    if (host.includes('youku.com') || host.includes('player.youku.com')) {
      urlObj.searchParams.set('autoplay', 'false')
      return urlObj.toString()
    }

    // 抖音/TikTok
    if (host.includes('douyin.com') || host.includes('tiktok.com')) {
      urlObj.searchParams.set('autoplay', '0')
      return urlObj.toString()
    }

    // 西瓜视频
    if (host.includes('ixigua.com')) {
      urlObj.searchParams.set('autoplay', '0')
      return urlObj.toString()
    }

    // 爱奇艺
    if (host.includes('iqiyi.com')) {
      urlObj.searchParams.set('autoplay', '0')
      return urlObj.toString()
    }

    // 网易云音乐/视频
    if (host.includes('163.com') || host.includes('music.163.com')) {
      urlObj.searchParams.set('auto', '0')
      return urlObj.toString()
    }

    // 其他网站也尝试设置 autoplay=0
    urlObj.searchParams.set('autoplay', '0')
    return urlObj.toString()
  } catch {
    return url
  }
}

/**
 * 执行简化的 Dataview 查询
 * 支持基本的 LIST FROM # 语法
 */
function executeDataviewQuery(query: string): Array<{ id: string; title: string }> {
  try {
    const trimmed = query.trim().toUpperCase()

    // 简单解析：LIST FROM #tag 或 LIST FROM "folder"
    if (trimmed.startsWith('LIST')) {
      // 提取 FROM 后的条件
      const fromMatch = query.match(/FROM\s+[#"]?([^"\s]+)"?/i)
      if (fromMatch) {
        const condition = fromMatch[1]
        // 如果是 tag（以 # 开头的条件）
        if (query.includes('#')) {
          const results = searchNotes(condition, {})
          return results.slice(0, 20).map(n => ({ id: n.id, title: n.title }))
        }
      }
      // 默认返回最近的笔记
      const notes = getNotes(20, 0)
      return notes.map(n => ({ id: n.id, title: n.title }))
    }

    // TABLE 查询也简化为列表
    if (trimmed.startsWith('TABLE')) {
      const notes = getNotes(20, 0)
      return notes.map(n => ({ id: n.id, title: n.title }))
    }

    return []
  } catch {
    return []
  }
}

/**
 * 应用文本标记为 HTML
 */
function applyMarkToHTML(text: string, mark: { type: string; attrs?: Record<string, unknown> }): string {
  switch (mark.type) {
    case 'bold':
      return `<strong>${text}</strong>`
    case 'italic':
      return `<em>${text}</em>`
    case 'strike':
      return `<del>${text}</del>`
    case 'code':
      return `<code>${text}</code>`
    case 'underline':
      return `<u>${text}</u>`
    case 'highlight':
      return `<mark>${text}</mark>`
    case 'link': {
      const href = mark.attrs?.href as string || ''
      return `<a href="${escapeHTML(href)}">${text}</a>`
    }
    case 'noteLink': {
      const noteTitle = mark.attrs?.noteTitle as string || ''
      return `<span class="note-link" title="${escapeHTML(noteTitle)}">${text}</span>`
    }
    case 'textColor': {
      const color = mark.attrs?.color as string || ''
      return `<span style="color: ${escapeHTML(color)}">${text}</span>`
    }
    default:
      return text
  }
}

/**
 * HTML 转义
 */
function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// ============ 导出函数 ============

/**
 * 导出笔记为 Markdown
 */
export async function exportNoteAsMarkdown(
  noteId: string,
  options: MarkdownExportOptions = {}
): Promise<ExportResult> {
  const note = getNoteById(noteId)
  if (!note) {
    return { success: false, error: 'Note not found' }
  }

  try {
    // 先转换内容，检查是否有附件
    let markdown = jsonToMarkdown(note.content)
    const attachmentPaths = extractAttachmentPaths(markdown)
    const hasAttachments = attachmentPaths.length > 0 && options.includeAttachments

    // 可选：添加 Front Matter
    if (options.includeFrontMatter) {
      const frontMatter = generateFrontMatter(note)
      markdown = frontMatter + markdown
    }

    const sanitizedTitle = sanitizeFilename(note.title || 'Untitled')

    if (hasAttachments) {
      // 有附件：选择文件夹，创建 笔记名/笔记名.md + assets/
      const { filePaths, canceled } = await dialog.showOpenDialog({
        title: '选择导出位置',
        defaultPath: app.getPath('downloads'),
        properties: ['openDirectory', 'createDirectory'],
      })

      if (canceled || !filePaths || filePaths.length === 0) {
        return { success: false, error: 'canceled' }
      }

      const exportDir = path.join(filePaths[0], sanitizedTitle)
      const mdFilePath = path.join(exportDir, `${sanitizedTitle}.md`)

      // 创建导出目录
      if (!existsSync(exportDir)) {
        await mkdir(exportDir, { recursive: true })
      }

      // 复制附件并更新路径
      const { content } = await copyAttachmentsAndUpdateContent(markdown, mdFilePath)
      markdown = content

      await writeFile(mdFilePath, markdown, 'utf-8')

      return { success: true, path: exportDir }
    } else {
      // 无附件：直接保存单个 .md 文件
      const { filePath, canceled } = await dialog.showSaveDialog({
        title: '导出 Markdown',
        defaultPath: path.join(app.getPath('downloads'), `${sanitizedTitle}.md`),
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      })

      if (canceled || !filePath) {
        return { success: false, error: 'canceled' }
      }

      await writeFile(filePath, markdown, 'utf-8')

      return { success: true, path: filePath }
    }
  } catch (error) {
    console.error('Export markdown failed:', error)
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * 导出笔记为 PDF
 */
export async function exportNoteAsPDF(
  noteId: string,
  options: PDFExportOptions = {}
): Promise<ExportResult> {
  const note = getNoteById(noteId)
  if (!note) {
    return { success: false, error: 'Note not found' }
  }

  // 弹出保存对话框
  const { filePath, canceled } = await dialog.showSaveDialog({
    title: '导出 PDF',
    defaultPath: path.join(app.getPath('downloads'), `${sanitizeFilename(note.title || 'Untitled')}.pdf`),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  })

  if (canceled || !filePath) {
    return { success: false, error: 'canceled' }
  }

  // 转换内容为 HTML（代码高亮和数学公式已在此处预渲染）
  const contentHTML = tiptapToHTML(note.content)

  // 生成完整的 HTML 内容（使用本地 CSS，不依赖 CDN）
  const template = getPdfTemplate()
  const fullHTML = template
    .replace('<h1 id="title" class="document-title"></h1>', `<h1 id="title" class="document-title">${escapeHTML(note.title || 'Untitled')}</h1>`)
    .replace('<div id="content" class="document-content"></div>', `<div id="content" class="document-content">${contentHTML}</div>`)

  // 写入临时文件
  const tempDir = app.getPath('temp')
  const tempFile = path.join(tempDir, `sanqian-export-${randomUUID()}.html`)
  await writeFile(tempFile, fullHTML, 'utf-8')

  // 创建隐藏窗口
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  try {
    // 加载临时文件
    await win.loadFile(tempFile)

    // 等待 CSS 样式应用（loadFile 完成后 DOM 已加载，这里等待渲染）
    await new Promise((resolve) => setTimeout(resolve, PDF_RENDER_DELAY_MS))

    // 生成 PDF
    const pdfData = await win.webContents.printToPDF({
      pageSize: options.pageSize || 'A4',
      printBackground: options.includeBackground !== false,
      margins: {
        top: 0.5,
        bottom: 0.5,
        left: 0.5,
        right: 0.5,
      },
    })

    await writeFile(filePath, pdfData)

    return { success: true, path: filePath }
  } catch (error) {
    console.error('Export PDF failed:', error)
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    win.close()
    // 清理临时文件
    try {
      await unlink(tempFile)
    } catch {
      // 忽略删除失败
    }
  }
}
