/**
 * Markdown ↔ TipTap 转换模块
 *
 * 提供 Markdown 和 TipTap JSON 之间的双向转换
 * 用于 SDK Tools API，让 AI 能够使用 Markdown 格式操作笔记内容
 */

import { tiptapToMarkdown, jsonToMarkdown, tiptapToMarkdownWithMeta, jsonToMarkdownWithMeta, getAllHeadings, getAllHeadingsFromJson } from './tiptap-to-markdown'
export { tiptapToMarkdown, jsonToMarkdown, tiptapToMarkdownWithMeta, jsonToMarkdownWithMeta, getAllHeadings, getAllHeadingsFromJson }
export type { DocumentHeading, ConvertResult } from './tiptap-to-markdown'
export { markdownToTiptap, markdownToTiptapString } from './markdown-to-tiptap'
export { mergePreservingBlockIds, mergeDocumentsJson, nodesContentEqual } from './tiptap-merge'

/**
 * 检测内容格式
 *
 * @param content - 内容字符串
 * @returns 'tiptap' | 'markdown' | 'plain'
 */
export function detectFormat(content: string): 'tiptap' | 'markdown' | 'plain' {
  if (!content || typeof content !== 'string') return 'plain'

  const trimmed = content.trim()

  // 尝试解析为 JSON
  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object' && parsed.type === 'doc') {
      return 'tiptap'
    }
  } catch {
    // 不是 JSON
  }

  // 检测是否像 Markdown
  const markdownPatterns = [
    /^#{1,6}\s+\S/m,                    // 标题
    /\*\*[^*]+\*\*/,                    // 粗体
    /(?<!\*)\*[^*\s][^*]*\*(?!\*)/,     // 斜体
    /\[([^\]]+)\]\(([^)]+)\)/,          // 链接
    /^\s*[-*+]\s+\S/m,                  // 无序列表
    /^\s*\d+\.\s+\S/m,                  // 有序列表
    /```[\s\S]*?```/,                   // 代码块
    /^>\s+\S/m,                         // 引用
    /\$\$[\s\S]+?\$\$/,                 // 块级公式
    /^\s*[-*]\s+\[[ x]\]/mi,            // 任务列表
  ]

  let matchCount = 0
  for (const pattern of markdownPatterns) {
    if (pattern.test(trimmed)) {
      matchCount++
      if (matchCount >= 2) return 'markdown'
    }
  }

  // 单一明确的 Markdown 特征
  if (matchCount === 1) {
    if (/^#{1,6}\s+\S/.test(trimmed)) return 'markdown'
    if (/^```/.test(trimmed)) return 'markdown'
  }

  return 'plain'
}

/**
 * 计算内容字数
 *
 * @param content - TipTap JSON 字符串或 Markdown
 * @returns 字数
 */
export function countWords(content: string): number {
  if (!content) return 0

  // 如果是 TipTap JSON，先转为 Markdown
  let text = content
  const format = detectFormat(content)

  if (format === 'tiptap') {
    try {
      text = jsonToMarkdown(content)
    } catch {
      return 0
    }
  }

  // 移除 Markdown 语法
  text = text
    .replace(/```[\s\S]*?```/g, '')  // 代码块
    .replace(/`[^`]+`/g, '')          // 行内代码
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')  // 图片
    .replace(/\[([^\]]*)\]\([^)]+\)/g, '$1') // 链接 - 保留链接文字
    .replace(/[#*_~`]/g, '')          // 格式符号
    .replace(/^\s*[-*+]\s+/gm, '')    // 列表标记
    .replace(/^\s*\d+\.\s+/gm, '')    // 有序列表标记
    .replace(/^\s*>\s*/gm, '')        // 引用标记

  // 计算中文字符和英文单词
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length
  const englishWords = text
    .replace(/[\u4e00-\u9fff]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 0).length

  return chineseChars + englishWords
}
