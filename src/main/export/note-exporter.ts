/**
 * 单篇笔记导出模块
 *
 * 支持导出为 Markdown 和 PDF 格式
 */

import { BrowserWindow, dialog, app } from 'electron'
import { writeFile, mkdir, copyFile, unlink, readFile, open, access } from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import { createRequire } from 'module'
import {
  getLiveNotesForDataviewProjection,
  getNotebooks,
  getLocalFolderMounts,
  listLocalNoteMetadata,
} from '../database'
import { jsonToMarkdown } from '../markdown/tiptap-to-markdown'
import { getUserDataPath } from '../attachment'
import { t } from '../i18n'
// katex and hljs are lazy-loaded to avoid ~300KB parse cost at app startup.
// They are only needed for PDF export (code highlighting + math rendering).
let _katex: typeof import('katex').default | null = null
let _hljs: typeof import('highlight.js').default | null = null

async function ensureExportLibs(): Promise<void> {
  const [katexMod, hljsMod] = await Promise.all([
    _katex ? Promise.resolve(null) : import('katex'),
    _hljs ? Promise.resolve(null) : import('highlight.js'),
  ])
  if (katexMod) _katex = katexMod.default
  if (hljsMod) _hljs = hljsMod.default
}
import { buildCanonicalLocalResourceId, buildNoteFromResolvedResource, resolveNoteResourceAsync } from '../note-gateway'
import { scanLocalFolderMountForSearchAsync } from '../local-folder'
import { forEachWithConcurrency, resolvePositiveIntegerEnv, yieldEvery } from '../import-export/utils/cooperative'
import type { LocalNoteMetadata } from '../../shared/types'

/** Wait time for CSS/fonts rendering before PDF generation (ms) */
const PDF_RENDER_DELAY_MS = 500
const NOTE_EXPORT_ATTACHMENT_COPY_CONCURRENCY = resolvePositiveIntegerEnv(
  'NOTE_EXPORT_ATTACHMENT_COPY_CONCURRENCY',
  4,
  { min: 1, max: 16 }
)
const NOTE_EXPORT_ATTACHMENT_COPY_YIELD_INTERVAL = resolvePositiveIntegerEnv(
  'NOTE_EXPORT_ATTACHMENT_COPY_YIELD_INTERVAL',
  8,
  { min: 1, max: 4096 }
)
const NOTE_EXPORT_REFERENCE_PRELOAD_MAX_DEPTH = resolvePositiveIntegerEnv(
  'NOTE_EXPORT_REFERENCE_PRELOAD_MAX_DEPTH',
  3,
  { min: 1, max: 8 }
)
const NOTE_EXPORT_REFERENCE_PRELOAD_MAX_NOTES = resolvePositiveIntegerEnv(
  'NOTE_EXPORT_REFERENCE_PRELOAD_MAX_NOTES',
  128,
  { min: 16, max: 4096 }
)
const IMAGE_SIGNATURE_READ_BYTES = 1024

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
.mermaid-container { margin: 1em 0; text-align: center; background: #f6f8fa; padding: 1em; border-radius: 8px; border: 1px solid #e1e4e8; overflow-x: auto; }
.mermaid-container svg { max-width: 100%; height: auto; }
.mermaid-container .mermaid { background: transparent; }
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
/* 目录块 */
.toc-block { margin: 1em 0; padding: 16px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; }
.toc-block .toc-title { font-weight: 600; margin-bottom: 12px; color: #374151; font-size: 14px; }
.toc-block .toc-list { margin: 0; padding: 0; list-style: none; }
.toc-block .toc-list li { margin: 4px 0; color: #4b5563; font-size: 14px; }
.toc-block .toc-level-1 { padding-left: 0; font-weight: 500; }
.toc-block .toc-level-2 { padding-left: 1em; }
.toc-block .toc-level-3 { padding-left: 2em; color: #6b7280; }
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

// 获取 KaTeX CSS 并将字体转为 base64 内联
async function getKatexCssWithInlineFonts(): Promise<string> {
  try {
    const require = createRequire(import.meta.url)
    const katexCssPath = require.resolve('katex/dist/katex.min.css')
    const katexDir = path.dirname(katexCssPath)
    let css = await readFile(katexCssPath, 'utf-8')

    const fontInlineMap = new Map<string, string>()
    for (const match of css.matchAll(/url\(fonts\/([^)]+)\)/g)) {
      const fontFile = match[1]
      if (!fontFile || fontInlineMap.has(fontFile)) {
        continue
      }

      const fontPath = path.join(katexDir, 'fonts', fontFile)
      try {
        const fontData = await readFile(fontPath)
        const base64 = fontData.toString('base64')
        const ext = path.extname(fontFile).toLowerCase()
        const mimeType = ext === '.woff2' ? 'font/woff2' :
          ext === '.woff' ? 'font/woff' :
            ext === '.ttf' ? 'font/ttf' : 'application/octet-stream'
        fontInlineMap.set(fontFile, `url(data:${mimeType};base64,${base64})`)
      } catch (err) {
        console.warn(`[PDF Export] Failed to inline font: ${fontFile}`, err)
      }
    }

    // 将字体文件 URL 替换为 base64 data URI
    if (fontInlineMap.size > 0) {
      css = css.replace(/url\(fonts\/([^)]+)\)/g, (match, fontFile) => {
        return fontInlineMap.get(fontFile) || match
      })
    }

    return css
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

async function getHighlightCss(): Promise<string> {
  try {
    const require = createRequire(import.meta.url)
    const hljsCssPath = require.resolve('highlight.js/styles/github.css')
    return await readFile(hljsCssPath, 'utf-8')
  } catch (err) {
    console.warn('[PDF Export] Failed to load highlight.js CSS, using fallback:', err)
    return HLJS_FALLBACK_CSS
  }
}

// 缓存 PDF 模板
let cachedPdfTemplate: string | null = null
let cachedPdfTemplatePromise: Promise<string> | null = null

// 获取 Mermaid JS（从 node_modules）
async function getMermaidJs(): Promise<string> {
  try {
    const require = createRequire(import.meta.url)
    const mermaidPath = require.resolve('mermaid/dist/mermaid.min.js')
    return await readFile(mermaidPath, 'utf-8')
  } catch (err) {
    console.warn('[PDF Export] Failed to load Mermaid JS:', err)
    return ''
  }
}

// 生成 PDF HTML 模板（不依赖外部 CDN）
async function getPdfTemplate(): Promise<string> {
  if (cachedPdfTemplate) return cachedPdfTemplate
  if (cachedPdfTemplatePromise) return cachedPdfTemplatePromise

  cachedPdfTemplatePromise = (async () => {
    const [katexCss, hljsCss, mermaidJs] = await Promise.all([
      getKatexCssWithInlineFonts(),
      getHighlightCss(),
      getMermaidJs(),
    ])

    return `<!DOCTYPE html>
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
  <script>${mermaidJs}</script>
  <script>
    if (typeof mermaid !== 'undefined') {
      mermaid.initialize({ startOnLoad: false, theme: 'neutral' });
      window.renderMermaid = async function() {
        await mermaid.run({ nodes: document.querySelectorAll('.mermaid') });
      };
    } else {
      window.renderMermaid = function() { return Promise.resolve(); };
    }
  </script>
</head>
<body>
  <div class="document">
    <h1 id="title" class="document-title"></h1>
    <div id="content" class="document-content"></div>
  </div>
</body>
</html>`
  })()
    .then((template) => {
      cachedPdfTemplate = template
      return template
    })
    .catch((error) => {
      cachedPdfTemplatePromise = null
      throw error
    })

  return cachedPdfTemplatePromise
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

const ATTACHMENT_LINK_EXTENSIONS = new Set([
  // 视频
  '.mp4', '.webm', '.mov', '.avi', '.mkv',
  // 音频
  '.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac',
  // 文档
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  // 压缩包
  '.zip', '.rar', '.7z', '.tar', '.gz',
])

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp',
])

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function normalizeAttachmentPath(rawPath: string): string {
  let normalized = decodeURIComponentSafe(rawPath.trim())

  if (normalized.startsWith('attachment://')) {
    normalized = normalized.slice('attachment://'.length)
  } else if (normalized.startsWith('sanqian://attachment/')) {
    normalized = normalized.slice('sanqian://attachment/'.length)
  }

  return normalized
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
}

function isExternalPath(src: string): boolean {
  const lower = src.trim().toLowerCase()
  return (
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('data:') ||
    lower.startsWith('mailto:') ||
    lower.startsWith('#')
  )
}

function getPathExtname(filePath: string): string {
  const withoutQuery = filePath.split(/[?#]/, 1)[0]
  return path.extname(withoutQuery).toLowerCase()
}

function encodePathSegments(relativePath: string): string {
  return relativePath
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/')
}

async function pathExists(pathToCheck: string): Promise<boolean> {
  try {
    await access(pathToCheck)
    return true
  } catch {
    return false
  }
}

async function resolveAttachmentSourcePath(relativePath: string): Promise<string | null> {
  const userDataPath = getUserDataPath()
  const normalized = relativePath.replace(/^\/+/, '')

  const candidates = [path.join(userDataPath, normalized)]
  if (!normalized.startsWith('attachments/')) {
    candidates.push(path.join(userDataPath, 'attachments', normalized))
  }

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate
    }
  }

  return null
}

function replaceAttachmentReferences(content: string, relativePath: string, assetPath: string): string {
  const pathVariants = new Set([relativePath, encodePathSegments(relativePath)])
  let updated = content

  for (const variant of pathVariants) {
    const escapedVariant = escapeRegExp(variant)

    updated = updated
      .replace(new RegExp(`\\]\\(sanqian://attachment/${escapedVariant}\\)`, 'g'), `](${assetPath})`)
      .replace(new RegExp(`\\]\\(attachment://${escapedVariant}\\)`, 'g'), `](${assetPath})`)
      .replace(new RegExp(`\\]\\(${escapedVariant}\\)`, 'g'), `](${assetPath})`)
      .replace(new RegExp(`src=(["'])sanqian://attachment/${escapedVariant}\\1`, 'g'), `src=$1${assetPath}$1`)
      .replace(new RegExp(`src=(["'])attachment://${escapedVariant}\\1`, 'g'), `src=$1${assetPath}$1`)
      .replace(new RegExp(`src=(["'])${escapedVariant}\\1`, 'g'), `src=$1${assetPath}$1`)
  }

  return updated
}

/**
 * 从 Markdown 内容中提取附件路径
 */
function extractAttachmentReferences(markdown: string): Array<{ relativePath: string; isImage: boolean }> {
  const refs = new Map<string, { isImage: boolean }>()

  const addRef = (rawPath: string, isImage: boolean): void => {
    const normalized = normalizeAttachmentPath(rawPath)
    if (!normalized) return
    const existing = refs.get(normalized)
    if (existing) {
      if (isImage) existing.isImage = true
      return
    }
    refs.set(normalized, { isImage })
  }

  // 匹配图片: ![alt](path)
  const imageRegex = /!\[[^\]]*\]\(([^)]+)\)/g
  let match
  while ((match = imageRegex.exec(markdown)) !== null) {
    const src = match[1].trim()
    if (!isExternalPath(src)) {
      addRef(src, true)
    }
  }

  // 匹配文件链接: [text](path)
  const attachmentRegex = /\[[^\]]*\]\(([^)]+)\)/g
  while ((match = attachmentRegex.exec(markdown)) !== null) {
    const src = match[1].trim()
    if (isExternalPath(src)) {
      continue
    }
    const normalized = normalizeAttachmentPath(src)
    if (ATTACHMENT_LINK_EXTENSIONS.has(getPathExtname(normalized))) {
      addRef(normalized, false)
    }
  }

  // 匹配媒体标签: <video src="..."> 或 <audio src='...'>
  const mediaRegex = /<(?:video|audio)\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi
  while ((match = mediaRegex.exec(markdown)) !== null) {
    const src = match[1].trim()
    if (!isExternalPath(src)) {
      addRef(src, false)
    }
  }

  return [...refs.entries()].map(([relativePath, meta]) => ({
    relativePath,
    isImage: meta.isImage,
  }))
}

function detectImageExtensionFromBuffer(buffer: Buffer): string | null {
  if (buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a) {
    return '.png'
  }
  if (buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff) {
    return '.jpg'
  }
  if (buffer.length >= 6) {
    const header6 = buffer.subarray(0, 6).toString('ascii')
    if (header6 === 'GIF87a' || header6 === 'GIF89a') {
      return '.gif'
    }
  }
  if (buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return '.webp'
  }
  if (buffer.length >= 2 &&
    buffer[0] === 0x42 &&
    buffer[1] === 0x4d) {
    return '.bmp'
  }

  const textHead = buffer.subarray(0, Math.min(buffer.length, 1024)).toString('utf-8').toLowerCase()
  if (textHead.includes('<svg')) {
    return '.svg'
  }

  return null
}

async function readFileSignature(sourcePath: string): Promise<Buffer> {
  const handle = await open(sourcePath, 'r')
  try {
    const buffer = Buffer.alloc(IMAGE_SIGNATURE_READ_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, IMAGE_SIGNATURE_READ_BYTES, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

async function ensureExportImageExtension(fileName: string, sourcePath: string, isImage: boolean): Promise<string> {
  if (!isImage) {
    return fileName
  }

  const currentExt = path.extname(fileName).toLowerCase()
  if (IMAGE_EXTENSIONS.has(currentExt)) {
    return fileName
  }

  try {
    const buffer = await readFileSignature(sourcePath)
    if (buffer.length === 0) {
      return fileName
    }
    const detectedExt = detectImageExtensionFromBuffer(buffer)
    if (!detectedExt) {
      return fileName
    }
    const baseName = currentExt ? fileName.slice(0, -currentExt.length) : fileName
    return `${baseName}${detectedExt}`
  } catch {
    return fileName
  }
}

/**
 * 复制附件到导出目录并更新 Markdown 中的路径
 */
async function copyAttachmentsAndUpdateContent(
  markdown: string,
  exportFilePath: string
): Promise<{ content: string; copiedCount: number }> {
  const exportDir = path.dirname(exportFilePath)
  const assetsDir = path.join(exportDir, 'assets')

  const attachmentRefs = extractAttachmentReferences(markdown)
  if (attachmentRefs.length === 0) {
    return { content: markdown, copiedCount: 0 }
  }

  await mkdir(assetsDir, { recursive: true })

  let updatedContent = markdown
  let copiedCount = 0

  const usedNames = new Set<string>()
  const copyPlans: Array<{
    relativePath: string
    sourcePath: string
    destinationFileName: string
    assetPath: string
  }> = []

  for (const { relativePath, isImage } of attachmentRefs) {
    const sourcePath = await resolveAttachmentSourcePath(relativePath)
    if (!sourcePath) {
      continue
    }

    // 使用目录前缀避免同名文件冲突（attachments/2026/03/photo.png -> 2026_03_photo.png）
    const pathForName = relativePath.startsWith('attachments/')
      ? relativePath.slice('attachments/'.length)
      : relativePath
    const dir = path.dirname(pathForName)
    const baseName = path.basename(pathForName)
    const originalExportName = dir && dir !== '.' ? `${dir.replace(/[\\/]/g, '_')}_${baseName}` : baseName
    const normalizedBaseName = await ensureExportImageExtension(originalExportName, sourcePath, isImage)
    let uniqueFilename = normalizedBaseName
    let counter = 1

    while (usedNames.has(uniqueFilename)) {
      const ext = path.extname(normalizedBaseName)
      const bare = ext ? normalizedBaseName.slice(0, -ext.length) : normalizedBaseName
      uniqueFilename = ext ? `${bare} (${counter})${ext}` : `${bare} (${counter})`
      counter++
    }
    usedNames.add(uniqueFilename)

    copyPlans.push({
      relativePath,
      sourcePath,
      destinationFileName: uniqueFilename,
      assetPath: `./assets/${uniqueFilename}`,
    })
  }

  const copiedAssetPathByRelativePath = new Map<string, string>()
  await forEachWithConcurrency(copyPlans, NOTE_EXPORT_ATTACHMENT_COPY_CONCURRENCY, async (plan, index) => {
    const destPath = path.join(assetsDir, plan.destinationFileName)

    try {
      await copyFile(plan.sourcePath, destPath)
      copiedCount++
      copiedAssetPathByRelativePath.set(plan.relativePath, plan.assetPath)
    } catch (error) {
      console.error(`Failed to copy attachment: ${plan.relativePath}`, error)
    }
    await yieldEvery(index + 1, NOTE_EXPORT_ATTACHMENT_COPY_YIELD_INTERVAL)
  })

  for (const { relativePath } of attachmentRefs) {
    const copiedAssetPath = copiedAssetPathByRelativePath.get(relativePath)
    if (!copiedAssetPath) {
      continue
    }
    updatedContent = replaceAttachmentReferences(updatedContent, relativePath, copiedAssetPath)
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
 * 从节点中提取纯文本
 */
function getTextFromNode(node: Record<string, unknown>): string {
  if (node.text) return node.text as string
  if (!node.content) return ''
  return (node.content as Record<string, unknown>[]).map(getTextFromNode).join('')
}

/**
 * 从文档内容中提取指定标题下的章节
 */
function extractHeadingSection(content: Record<string, unknown>[], headingText: string): Record<string, unknown>[] | null {
  const normalizedSearch = headingText.trim().toLowerCase()
  let startIndex = -1
  let startLevel = 0

  // 查找匹配的标题
  for (let i = 0; i < content.length; i++) {
    const node = content[i]
    if (node.type === 'heading') {
      const text = getTextFromNode(node).trim()
      const textLower = text.toLowerCase()

      // 精确匹配或模糊匹配
      if (text === headingText || textLower === normalizedSearch ||
          textLower.startsWith(normalizedSearch) || textLower.includes(normalizedSearch)) {
        startIndex = i
        startLevel = ((node.attrs as Record<string, unknown>)?.level as number) || 1
        break
      }
    }
  }

  if (startIndex === -1) return null

  // 收集从该标题到下一个同级或更高级标题之间的所有内容
  const result: Record<string, unknown>[] = [content[startIndex]]

  for (let i = startIndex + 1; i < content.length; i++) {
    const node = content[i]
    if (node.type === 'heading') {
      const level = ((node.attrs as Record<string, unknown>)?.level as number) || 1
      if (level <= startLevel) break
    }
    result.push(node)
  }

  return result
}

/**
 * 从文档内容中查找指定 blockId 的节点
 */
function findBlockById(content: Record<string, unknown>[], blockId: string): Record<string, unknown> | null {
  for (const node of content) {
    if ((node.attrs as Record<string, unknown>)?.blockId === blockId) {
      return node
    }
    if (node.content) {
      const found = findBlockById(node.content as Record<string, unknown>[], blockId)
      if (found) return found
    }
  }
  return null
}

/**
 * 将 TipTap JSON 转换为 HTML（用于 PDF 导出）
 * @param jsonContent JSON 内容字符串
 * @param depth 递归深度，防止无限循环
 */
function tiptapToHTML(jsonContent: string, depth = 0, renderContext?: ExportRenderContext): string {
  if (depth > 3) {
    return `<p><em>${t().export.nestingTooDeep}</em></p>`
  }
  try {
    const doc = JSON.parse(jsonContent)
    return convertNodeToHTML(doc, depth, undefined, renderContext || {})
  } catch {
    return '<p>Failed to parse content</p>'
  }
}

/**
 * 递归转换节点为 HTML
 * @param node 节点对象
 * @param depth 递归深度
 * @param rootDoc 根文档节点（用于 TOC 等需要访问全文的块）
 */
function convertNodeToHTML(
  node: Record<string, unknown>,
  depth = 0,
  rootDoc?: Record<string, unknown>,
  renderContext: ExportRenderContext = {}
): string {
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

  // 对于 doc 节点，保存为 rootDoc 供子节点使用
  const docRef = type === 'doc' ? node : rootDoc

  // 递归处理子节点
  const childHTML = content ? content.map((n) => convertNodeToHTML(n, depth, docRef, renderContext)).join('') : ''

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
        if (language && _hljs!.getLanguage(language)) {
          const highlighted = _hljs!.highlight(code, { language }).value
          return `<pre><code class="hljs language-${language}">${highlighted}</code></pre>`
        } else if (code) {
          const highlighted = _hljs!.highlightAuto(code).value
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
        const rendered = _katex!.renderToString(latex, {
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
      // 输出 Mermaid 代码块，将在 PDF 窗口中由 Mermaid.js 渲染
      return `<div class="mermaid-container"><pre class="mermaid">${escapeHTML(code)}</pre></div>`
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
      const name = attrs.name as string || t().export.attachment
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
        const embeddedNote = resolveExportNote(localPath)
        if (embeddedNote) {
          const embeddedHTML = tiptapToHTML(embeddedNote.content, depth + 1, renderContext)
          return `<div class="embed-block embed-note">
            <div class="embed-title">${escapeHTML(embeddedNote.title || t().export.untitledNote)}</div>
            <div class="embed-content">${embeddedHTML}</div>
          </div>`
        }
        return `<div class="embed-block"><em>${t().export.failedToLoadNote}</em></div>`
      }
      return `<div class="embed-block"><em>${t().export.embeddedContent}</em></div>`
    }

    case 'transclusionBlock': {
      const noteId = attrs.noteId as string || ''
      const noteName = attrs.noteName as string || ''
      const targetType = attrs.targetType as string || 'note'
      const targetValue = attrs.targetValue as string || ''

      // 获取引用笔记的内容
      const referencedNote = resolveExportNote(noteId)
      if (referencedNote) {
        let displayTitle = referencedNote.title || noteName || t().export.untitledNote
        let contentToRender = referencedNote.content

        try {
          const doc = JSON.parse(referencedNote.content)
          if (doc.content) {
            if (targetType === 'heading' && targetValue) {
              // 提取指定标题下的内容
              displayTitle += `#${targetValue}`
              const sectionNodes = extractHeadingSection(doc.content, targetValue)
              if (sectionNodes) {
                contentToRender = JSON.stringify({ type: 'doc', content: sectionNodes })
              }
            } else if (targetType === 'block' && targetValue) {
              // 提取指定 block
              displayTitle += `^${targetValue}`
              const blockNode = findBlockById(doc.content, targetValue)
              if (blockNode) {
                contentToRender = JSON.stringify({ type: 'doc', content: [blockNode] })
              }
            }
          }
        } catch {
          // 解析失败时使用完整内容
        }

        const referencedHTML = tiptapToHTML(contentToRender, depth + 1, renderContext)
        return `<div class="transclusion-block">
          <div class="transclusion-title">${escapeHTML(displayTitle)}</div>
          <div class="transclusion-content">${referencedHTML}</div>
        </div>`
      }
      return `<div class="transclusion-block"><em>${t().export.reference}: ${escapeHTML(noteName || noteId)}</em></div>`
    }

    case 'tocBlock': {
      // 从文档中提取所有 h1-h3 标题
      const headings: Array<{ level: number; text: string }> = []
      const extractHeadings = (nodes: Record<string, unknown>[] | undefined) => {
        if (!nodes) return
        for (const n of nodes) {
          if (n.type === 'heading') {
            const level = (n.attrs as Record<string, unknown>)?.level as number || 1
            if (level <= 3) {
              // 提取标题文本
              const textContent = (n.content as Record<string, unknown>[] | undefined)
                ?.map(c => (c as { text?: string }).text || '')
                .join('') || ''
              headings.push({ level, text: textContent })
            }
          }
          // 递归处理子节点（如 toggle 内的标题）
          if (n.content) {
            extractHeadings(n.content as Record<string, unknown>[])
          }
        }
      }
      extractHeadings(docRef?.content as Record<string, unknown>[] | undefined)

      if (headings.length === 0) {
        return `<nav class="toc-block"><div class="toc-title">${t().export.tableOfContents}</div><p><em>${t().export.noHeadings || 'No headings found'}</em></p></nav>`
      }

      const tocItems = headings.map(h =>
        `<li class="toc-level-${h.level}">${escapeHTML(h.text || '(empty)')}</li>`
      ).join('')
      return `<nav class="toc-block"><div class="toc-title">${t().export.tableOfContents}</div><ul class="toc-list">${tocItems}</ul></nav>`
    }

    case 'dataviewBlock': {
      const query = attrs.query as string || ''
      // 执行 dataview 查询
      const results = executeDataviewQuery(query, renderContext)
      if (results.length > 0) {
        const listItems = results.map(r => `<li><strong>${escapeHTML(r.title)}</strong></li>`).join('')
        return `<div class="dataview-block">
          <div class="dataview-query"><code>${escapeHTML(query)}</code></div>
          <ul class="dataview-results">${listItems}</ul>
        </div>`
      }
      return `<div class="dataview-block"><code>${escapeHTML(query)}</code><p><em>${t().export.noResults}</em></p></div>`
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
 * 支持基本的 LIST/TABLE + FROM 语法（all-source: internal + local-folder）
 */
interface DataviewNoteProjection {
  id: string
  title: string
  notebookId: string | null
  notebookName: string | null
  updatedAt: string
  isPinned: boolean
  tags: string[]
}

interface ExportRenderContext {
  dataviewAllSourceNotes?: DataviewNoteProjection[]
}

function buildLocalMetadataKey(notebookId: string, relativePath: string): string {
  return `${notebookId}\u0000${relativePath}`
}

function buildLocalMetadataLookup(metadataRows: LocalNoteMetadata[]): Map<string, LocalNoteMetadata> {
  const map = new Map<string, LocalNoteMetadata>()
  for (const row of metadataRows) {
    map.set(buildLocalMetadataKey(row.notebook_id, row.relative_path), row)
  }
  return map
}

async function collectDataviewAllSourceNotesAsync(): Promise<DataviewNoteProjection[]> {
  const notebooks = getNotebooks()
  const notebookNameById = new Map(notebooks.map((notebook) => [notebook.id, notebook.name]))

  const internalNotes = getLiveNotesForDataviewProjection()
  const internalItems: DataviewNoteProjection[] = internalNotes.map((note) => ({
    id: note.id,
    title: note.title,
    notebookId: note.notebook_id,
    notebookName: note.notebook_id ? (notebookNameById.get(note.notebook_id) || null) : null,
    updatedAt: note.updated_at,
    isPinned: note.is_pinned,
    tags: (note.tags || []).map((tag) => tag.name),
  }))

  const activeMounts = getLocalFolderMounts().filter((mount) => mount.mount.status === 'active')
  const metadataByPath = buildLocalMetadataLookup(
    listLocalNoteMetadata({ notebookIds: activeMounts.map((mount) => mount.notebook.id) })
  )
  const localItems: DataviewNoteProjection[] = []

  for (const mount of activeMounts) {
    let scanned: Awaited<ReturnType<typeof scanLocalFolderMountForSearchAsync>>
    try {
      scanned = await scanLocalFolderMountForSearchAsync(mount, { sortEntries: false })
    } catch {
      continue
    }

    for (const file of scanned.files) {
      const metadata = metadataByPath.get(buildLocalMetadataKey(mount.notebook.id, file.relative_path))
      localItems.push({
        id: buildCanonicalLocalResourceId({
          notebookId: mount.notebook.id,
          relativePath: file.relative_path,
        }),
        title: file.name,
        notebookId: mount.notebook.id,
        notebookName: mount.notebook.name || null,
        updatedAt: new Date(file.mtime_ms).toISOString(),
        isPinned: metadata?.is_pinned ?? false,
        tags: metadata?.tags || [],
      })
    }
  }

  return [...internalItems, ...localItems].sort((left, right) => {
    if (left.isPinned !== right.isPinned) {
      return left.isPinned ? -1 : 1
    }
    if (left.updatedAt !== right.updatedAt) {
      return right.updatedAt.localeCompare(left.updatedAt)
    }
    return left.id.localeCompare(right.id, undefined, { sensitivity: 'base', numeric: true })
  })
}

function getDataviewAllSourceNotes(renderContext?: ExportRenderContext): DataviewNoteProjection[] {
  return renderContext?.dataviewAllSourceNotes || []
}

function parseDataviewTagFilter(query: string): string | null {
  const matched = query.match(/\bFROM\s+#([^\s"']+)/i)
  if (!matched) return null
  const tag = matched[1]?.trim()
  return tag || null
}

function parseDataviewFolderFilter(query: string): string | null {
  const quoted = query.match(/\bFROM\s+"([^"]+)"/i)
  if (quoted) {
    return quoted[1].trim() || null
  }
  const plain = query.match(/\bFROM\s+([^\s#"]+)/i)
  if (!plain) return null
  return plain[1].trim() || null
}

function executeDataviewQuery(
  query: string,
  renderContext?: ExportRenderContext
): Array<{ id: string; title: string }> {
  try {
    const trimmed = query.trim()
    const upper = trimmed.toUpperCase()

    if (!upper.startsWith('LIST') && !upper.startsWith('TABLE')) {
      return []
    }

    let notes = getDataviewAllSourceNotes(renderContext)
    const tagFilter = parseDataviewTagFilter(trimmed)
    if (tagFilter) {
      const normalizedTag = tagFilter.toLowerCase()
      notes = notes.filter((note) =>
        note.tags.some((tag) => tag.toLowerCase() === normalizedTag)
      )
    } else {
      const folderFilter = parseDataviewFolderFilter(trimmed)
      if (folderFilter) {
        const normalizedFolder = folderFilter.toLowerCase()
        notes = notes.filter((note) =>
          (note.notebookName || '').toLowerCase() === normalizedFolder
          || (note.notebookId || '').toLowerCase() === normalizedFolder
        )
      }
    }

    return notes.slice(0, 20).map((note) => ({ id: note.id, title: note.title }))
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
    case 'highlight': {
      const hlColor = mark.attrs?.color as string || ''
      if (hlColor) {
        const r = parseInt(hlColor.slice(1, 3), 16)
        const g = parseInt(hlColor.slice(3, 5), 16)
        const b = parseInt(hlColor.slice(5, 7), 16)
        return `<mark style="background-color: rgba(${r}, ${g}, ${b}, 0.15)">${text}</mark>`
      }
      return `<mark>${text}</mark>`
    }
    case 'link': {
      const href = mark.attrs?.href as string || ''
      return `<a href="${escapeHTML(href)}">${text}</a>`
    }
    case 'noteLink': {
      const noteTitle = mark.attrs?.noteTitle as string || ''
      return `<span class="note-link" title="${escapeHTML(noteTitle)}">${text}</span>`
    }
    case 'textStyle': {
      const color = mark.attrs?.color as string || ''
      if (color) {
        return `<span style="color: ${escapeHTML(color)}">${text}</span>`
      }
      return text
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

type ExportResolvedNote = ReturnType<typeof buildNoteFromResolvedResource>

const exportNoteCache = new Map<string, ExportResolvedNote | null>()
const exportNoteInFlight = new Map<string, Promise<ExportResolvedNote | null>>()

function resolveExportNote(noteId: string): ExportResolvedNote | null {
  if (!exportNoteCache.has(noteId)) return null
  return exportNoteCache.get(noteId) || null
}

async function preloadExportNoteAsync(noteId: string): Promise<ExportResolvedNote | null> {
  if (exportNoteCache.has(noteId)) {
    return exportNoteCache.get(noteId) || null
  }
  const inFlight = exportNoteInFlight.get(noteId)
  if (inFlight) return inFlight

  const task = (async (): Promise<ExportResolvedNote | null> => {
    const resolved = await resolveNoteResourceAsync(noteId)
    if (!resolved.ok) {
      exportNoteCache.set(noteId, null)
      return null
    }
    const note = buildNoteFromResolvedResource(resolved.resource)
    exportNoteCache.set(noteId, note)
    return note
  })()

  exportNoteInFlight.set(noteId, task)
  try {
    return await task
  } finally {
    if (exportNoteInFlight.get(noteId) === task) {
      exportNoteInFlight.delete(noteId)
    }
  }
}

function collectReferencedNoteIdsFromTiptapContent(content: string): string[] {
  let doc: unknown
  try {
    doc = JSON.parse(content)
  } catch {
    return []
  }
  if (!doc || typeof doc !== 'object') return []

  const result = new Set<string>()
  const stack: unknown[] = [doc]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || typeof current !== 'object') continue
    const node = current as {
      type?: unknown
      attrs?: Record<string, unknown>
      content?: unknown
    }
    const nodeType = typeof node.type === 'string' ? node.type : ''
    const attrs = node.attrs || {}

    if (nodeType === 'embedBlock' && attrs.mode === 'local' && typeof attrs.localPath === 'string' && attrs.localPath.trim()) {
      result.add(attrs.localPath)
    } else if (nodeType === 'transclusionBlock' && typeof attrs.noteId === 'string' && attrs.noteId.trim()) {
      result.add(attrs.noteId)
    }

    if (Array.isArray(node.content)) {
      for (let index = 0; index < node.content.length; index += 1) {
        stack.push(node.content[index])
      }
    }
  }
  return Array.from(result)
}

async function preloadExportReferencedNotesAsync(rootContent: string): Promise<void> {
  const seen = new Set<string>()
  let frontier = collectReferencedNoteIdsFromTiptapContent(rootContent)

  for (
    let depth = 0;
    depth < NOTE_EXPORT_REFERENCE_PRELOAD_MAX_DEPTH && frontier.length > 0 && seen.size < NOTE_EXPORT_REFERENCE_PRELOAD_MAX_NOTES;
    depth += 1
  ) {
    const batch: string[] = []
    for (const noteId of frontier) {
      if (seen.has(noteId)) continue
      seen.add(noteId)
      batch.push(noteId)
      if (seen.size >= NOTE_EXPORT_REFERENCE_PRELOAD_MAX_NOTES) break
    }
    if (batch.length === 0) break

    const loadedNotes = await Promise.all(batch.map((noteId) => preloadExportNoteAsync(noteId)))
    const next = new Set<string>()
    for (const note of loadedNotes) {
      if (!note) continue
      const referencedIds = collectReferencedNoteIdsFromTiptapContent(note.content)
      for (const referencedId of referencedIds) {
        if (seen.has(referencedId)) continue
        if (seen.size + next.size >= NOTE_EXPORT_REFERENCE_PRELOAD_MAX_NOTES) break
        next.add(referencedId)
      }
    }
    frontier = Array.from(next)
  }
}

/**
 * Clear the export note cache. Call after each export operation completes.
 */
export function clearExportNoteCache(): void {
  exportNoteCache.clear()
  exportNoteInFlight.clear()
}

// ============ 导出函数 ============

/**
 * 导出笔记为 Markdown
 */
export async function exportNoteAsMarkdown(
  noteId: string,
  options: MarkdownExportOptions = {}
): Promise<ExportResult> {
  exportNoteCache.clear()
  exportNoteInFlight.clear()
  const note = await preloadExportNoteAsync(noteId)
  if (!note) {
    exportNoteCache.clear()
    exportNoteInFlight.clear()
    return { success: false, error: 'Note not found' }
  }

  try {
    // 先转换内容，检查是否有附件
    let markdown = jsonToMarkdown(note.content)
    const attachmentRefs = extractAttachmentReferences(markdown)
    const hasAttachments = attachmentRefs.length > 0 && options.includeAttachments

    // 可选：添加 Front Matter
    if (options.includeFrontMatter) {
      const frontMatter = generateFrontMatter(note)
      markdown = frontMatter + markdown
    }

    const sanitizedTitle = sanitizeFilename(note.title || 'Untitled')

    if (hasAttachments) {
      // 有附件：选择文件夹，创建 笔记名/笔记名.md + assets/
      const { filePaths, canceled } = await dialog.showOpenDialog({
        title: t().export.selectExportLocation,
        defaultPath: app.getPath('downloads'),
        properties: ['openDirectory', 'createDirectory'],
      })

      if (canceled || !filePaths || filePaths.length === 0) {
        return { success: false, error: 'canceled' }
      }

      const exportDir = path.join(filePaths[0], sanitizedTitle)
      const mdFilePath = path.join(exportDir, `${sanitizedTitle}.md`)

      // 创建导出目录
      await mkdir(exportDir, { recursive: true })

      // 复制附件并更新路径
      const { content } = await copyAttachmentsAndUpdateContent(markdown, mdFilePath)
      markdown = content

      await writeFile(mdFilePath, markdown, 'utf-8')

      return { success: true, path: exportDir }
    } else {
      // 无附件：直接保存单个 .md 文件
      const { filePath, canceled } = await dialog.showSaveDialog({
        title: t().export.exportMarkdown,
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
  } finally {
    exportNoteCache.clear()
    exportNoteInFlight.clear()
  }
}

/**
 * 导出笔记为 PDF
 */
export async function exportNoteAsPDF(
  noteId: string,
  options: PDFExportOptions = {}
): Promise<ExportResult> {
  await ensureExportLibs()
  exportNoteCache.clear()
  exportNoteInFlight.clear()
  const note = await preloadExportNoteAsync(noteId)
  if (!note) {
    exportNoteCache.clear()
    exportNoteInFlight.clear()
    return { success: false, error: 'Note not found' }
  }

  // 弹出保存对话框
  const { filePath, canceled } = await dialog.showSaveDialog({
    title: t().export.exportPDF,
    defaultPath: path.join(app.getPath('downloads'), `${sanitizeFilename(note.title || 'Untitled')}.pdf`),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  })

  if (canceled || !filePath) {
    return { success: false, error: 'canceled' }
  }

  await preloadExportReferencedNotesAsync(note.content)

  // 异步预获取 dataview 数据，避免同步文件扫描阻塞主进程
  const renderContext: ExportRenderContext = {
    dataviewAllSourceNotes: await collectDataviewAllSourceNotesAsync(),
  }

  // 转换内容为 HTML（代码高亮和数学公式已在此处预渲染）
  const contentHTML = tiptapToHTML(note.content, 0, renderContext)

  // 生成完整的 HTML 内容（使用本地 CSS，不依赖 CDN）
  const template = await getPdfTemplate()
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

    // 等待 Mermaid 图表渲染完成
    await win.webContents.executeJavaScript('window.renderMermaid ? window.renderMermaid() : Promise.resolve()')

    // 等待 CSS 样式应用和渲染完成
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
    // 确保窗口关闭不会阻止临时文件清理
    try {
      win.close()
    } catch {
      // 忽略关闭失败
    }
    try {
      await unlink(tempFile)
    } catch {
      // 忽略删除失败
    }
    exportNoteCache.clear()
    exportNoteInFlight.clear()
  }
}
