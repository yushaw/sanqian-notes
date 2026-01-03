/**
 * AI Summary Service
 *
 * Generates AI summaries for notes using Sanqian SDK.
 * Includes text processing utilities for change detection and outline extraction.
 */

import { createHash } from 'crypto'
import { BrowserWindow } from 'electron'
import {
  getNoteById,
  getNoteSummaryInfo,
  updateNoteSummary,
  updateAITags
} from './database'
import { getClient } from './sanqian-sdk'

// ============ Constants ============

/** Minimum character count to trigger summary generation */
const MIN_CONTENT_LENGTH = 500

/** Maximum content length to send full text (characters) */
const MAX_FULL_CONTENT_LENGTH = 3000

// ============ Concurrency Control ============

/** Track notes currently being processed to prevent duplicate requests */
const processingNotes = new Set<string>()

/** Content length for outline + excerpt mode */
const EXCERPT_LENGTH = 2000

/** Maximum summary length */
const MAX_SUMMARY_LENGTH = 500

/** AI request timeout in ms (2 minutes for long content) */
const AI_TIMEOUT = 120000

// ============ Text Processing Utilities ============

/**
 * Compute MD5 hash of content
 */
export function computeHash(content: string): string {
  return createHash('md5').update(content).digest('hex')
}

/**
 * Extract plain text from BlockNote JSON content
 */
export function extractPlainText(content: string): string {
  try {
    const blocks = JSON.parse(content)
    if (!Array.isArray(blocks)) return content
    return extractTextFromBlocks(blocks)
  } catch {
    // If not valid JSON, return as-is (might be plain text)
    return content
  }
}

/**
 * Recursively extract text from BlockNote blocks
 */
function extractTextFromBlocks(blocks: unknown[]): string {
  const texts: string[] = []

  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue
    const b = block as Record<string, unknown>

    // Extract from inline content
    if (Array.isArray(b.content)) {
      for (const inline of b.content) {
        if (inline && typeof inline === 'object') {
          const i = inline as Record<string, unknown>
          if (typeof i.text === 'string') {
            texts.push(i.text)
          }
        }
      }
    }

    // Recurse into children
    if (Array.isArray(b.children)) {
      texts.push(extractTextFromBlocks(b.children))
    }
  }

  return texts.join('\n').trim()
}

/**
 * Extract outline from BlockNote JSON
 * Returns headings, first-level list items, and callouts
 */
export function extractOutline(content: string): string {
  try {
    const blocks = JSON.parse(content)
    const outline: string[] = []
    extractOutlineFromBlocks(blocks, outline, 0)
    return outline.join('\n')
  } catch {
    return ''
  }
}

function extractOutlineFromBlocks(
  blocks: unknown[],
  outline: string[],
  depth: number
): void {
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue
    const b = block as Record<string, unknown>
    const type = b.type as string

    // Get block text
    const text = getBlockText(b)
    if (!text) continue

    switch (type) {
      case 'heading': {
        const level = (b.props as Record<string, unknown>)?.level || 1
        const prefix = '#'.repeat(level as number)
        outline.push(`${prefix} ${text}`)
        break
      }
      case 'bulletListItem':
      case 'numberedListItem':
      case 'checkListItem':
        // Only include first level (depth 0)
        if (depth === 0) {
          outline.push(`- ${text}`)
        }
        break
      case 'callout':
        outline.push(`> ${text}`)
        break
    }

    // Recurse into children with increased depth
    if (Array.isArray(b.children)) {
      extractOutlineFromBlocks(b.children, outline, depth + 1)
    }
  }
}

function getBlockText(block: Record<string, unknown>): string {
  if (!Array.isArray(block.content)) return ''

  const texts: string[] = []
  for (const inline of block.content) {
    if (inline && typeof inline === 'object') {
      const i = inline as Record<string, unknown>
      if (typeof i.text === 'string') {
        texts.push(i.text)
      }
    }
  }
  return texts.join('').trim()
}

/**
 * Calculate target summary length based on content length
 */
function getTargetSummaryLength(contentLength: number): number {
  if (contentLength <= 800) {
    return Math.round(contentLength * 0.25) // 25%
  }
  if (contentLength <= 2000) {
    return Math.round(contentLength * 0.20) // 20%
  }
  if (contentLength <= 5000) {
    return Math.round(contentLength * 0.15) // 15%
  }
  // Long content: 10%, max 500
  return Math.min(Math.round(contentLength * 0.10), MAX_SUMMARY_LENGTH)
}

// ============ Summary Generation ============

interface SummaryResult {
  summary: string
  keywords: string[]
}

/**
 * Parse AI response to extract summary and keywords
 */
function parseSummaryResponse(response: string): SummaryResult {
  // Try to parse structured format: "摘要：...\n关键词：..."
  const summaryMatch = response.match(/摘要[：:]\s*(.+?)(?=\n*关键词|$)/s)
  const keywordsMatch = response.match(/关键词[：:]\s*(.+)/s)

  const summary = summaryMatch?.[1]?.trim() || response.trim()
  const keywordsStr = keywordsMatch?.[1]?.trim() || ''

  const keywords = keywordsStr
    .split(/[,，、]/)
    .map(k => k.trim())
    .filter(k => k.length > 0 && k.length < 20) // Filter out invalid keywords

  return { summary, keywords }
}

/**
 * Build prompt for summary generation
 */
function buildPrompt(
  plainText: string,
  targetLength: number,
  isLongContent: boolean,
  outline?: string
): string {
  if (isLongContent && outline) {
    return `请根据以下笔记的大纲和开头部分生成摘要和关键词。

要求：
1. 摘要约 ${targetLength} 字，用一段话概括主要内容
2. 提取 3-5 个关键词，用逗号分隔

格式：
摘要：{摘要内容}
关键词：{关键词1}, {关键词2}, {关键词3}

## 大纲结构
${outline}

## 开头内容
${plainText.slice(0, EXCERPT_LENGTH)}`
  }

  return `请为以下笔记生成摘要和关键词。

要求：
1. 摘要约 ${targetLength} 字，用一段话概括主要内容
2. 提取 3-5 个关键词，用逗号分隔

格式：
摘要：{摘要内容}
关键词：{关键词1}, {关键词2}, {关键词3}

笔记内容：
${plainText}`
}

/**
 * Check if summary should be generated/regenerated for a note
 */
export function shouldGenerateSummary(
  content: string,
  existingSummaryInfo: { ai_summary: string | null; summary_content_hash: string | null } | null
): { shouldGenerate: boolean; reason: string; plainText: string; contentHash: string } {
  const plainText = extractPlainText(content)
  const contentHash = computeHash(plainText)

  // Check minimum length
  if (plainText.length < MIN_CONTENT_LENGTH) {
    return {
      shouldGenerate: false,
      reason: `Content too short (${plainText.length} < ${MIN_CONTENT_LENGTH})`,
      plainText,
      contentHash
    }
  }

  // No existing summary - should generate
  if (!existingSummaryInfo?.ai_summary || !existingSummaryInfo?.summary_content_hash) {
    return {
      shouldGenerate: true,
      reason: 'No existing summary',
      plainText,
      contentHash
    }
  }

  // Hash unchanged - no need to regenerate
  if (existingSummaryInfo.summary_content_hash === contentHash) {
    return {
      shouldGenerate: false,
      reason: 'Content unchanged (hash match)',
      plainText,
      contentHash
    }
  }

  // Hash changed - check change ratio
  // We need to get the old plain text, but we only have hash
  // For simplicity, assume significant change if hash differs
  // A more accurate approach would store old plain text, but that's expensive
  // Instead, we use a simpler heuristic: length change > 20% or hash differs
  return {
    shouldGenerate: true,
    reason: 'Content changed (hash mismatch)',
    plainText,
    contentHash
  }
}

/**
 * Generate summary for a note
 * Returns true if summary was generated successfully
 */
export async function generateSummary(noteId: string): Promise<boolean> {
  // Check if already processing this note
  if (processingNotes.has(noteId)) {
    console.log(`[Summary] Already processing ${noteId}, skipping duplicate request`)
    return false
  }

  const note = getNoteById(noteId)
  if (!note) {
    console.log(`[Summary] Note not found: ${noteId}`)
    return false
  }

  const summaryInfo = getNoteSummaryInfo(noteId)
  const checkResult = shouldGenerateSummary(note.content, summaryInfo)

  if (!checkResult.shouldGenerate) {
    console.log(`[Summary] Skipping ${noteId}: ${checkResult.reason}`)
    return false
  }

  // Mark as processing
  processingNotes.add(noteId)
  console.log(`[Summary] Generating for ${noteId}: ${checkResult.reason}`)

  const client = getClient()
  if (!client) {
    console.log('[Summary] Sanqian client not connected')
    processingNotes.delete(noteId)
    return false
  }

  try {
    const sdk = client._getSdk()
    await sdk.ensureReady()

    const { plainText, contentHash } = checkResult
    const isLongContent = plainText.length > MAX_FULL_CONTENT_LENGTH
    const outline = isLongContent ? extractOutline(note.content) : undefined
    const targetLength = getTargetSummaryLength(plainText.length)

    const prompt = buildPrompt(plainText, targetLength, isLongContent, outline)

    // Use non-streaming chat API with timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('AI request timeout')), AI_TIMEOUT)
    })

    const chatPromise = sdk.chat('writing', [
      { role: 'user', content: prompt }
    ])

    const response = await Promise.race([chatPromise, timeoutPromise])
    const aiResponse = response.message.content

    // Parse response
    const { summary, keywords } = parseSummaryResponse(aiResponse)

    // Update database
    updateNoteSummary(noteId, summary, contentHash)
    if (keywords.length > 0) {
      updateAITags(noteId, keywords)
    }

    // Notify frontend of summary update
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('summary:updated', noteId)
    }

    console.log(`[Summary] Generated for ${noteId}: ${summary.slice(0, 50)}...`)
    return true
  } catch (error) {
    console.error(`[Summary] Error generating for ${noteId}:`, error)
    return false
  } finally {
    // Always remove from processing set
    processingNotes.delete(noteId)
  }
}