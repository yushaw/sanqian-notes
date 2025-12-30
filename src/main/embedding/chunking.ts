/**
 * 知识库 - 文本分块模块
 *
 * 基于业界最佳实践（2025）实现分块策略：
 * - RecursiveCharacterTextSplitter（中文优化）
 * - Chunk size: 800 chars (~300 tokens)
 * - Overlap: 100 chars (12.5%)
 * - Markdown 格式自动检测与优化分块
 *
 * 参考: sanqian/backend/core/memory/chunking.py
 */

import type { NoteChunk } from './types'
import { computeContentHash } from './utils'

// 分块配置
export const CHUNK_SIZE = 800 // 字符数（约 300 tokens）
export const CHUNK_OVERLAP = 100 // 重叠字符数（12.5%）
export const MIN_CHUNK_SIZE = 100 // 最小分块阈值

/**
 * 分块服务
 */
export class ChunkingService {
  private chunkSize: number
  private chunkOverlap: number

  // 通用分隔符（中文优化）
  private baseSeparators = [
    '\n\n', // 段落
    '\n', // 换行
    '。', // 中文句号
    '！', // 中文感叹号
    '？', // 中文问号
    '；', // 中文分号
    '. ', // 英文句号+空格
    '! ', // 英文感叹号+空格
    '? ', // 英文问号+空格
    '，', // 中文逗号
    ', ', // 英文逗号+空格
    ' ', // 空格
    '' // 字符级别（最后手段）
  ]

  constructor(chunkSize: number = CHUNK_SIZE, chunkOverlap: number = CHUNK_OVERLAP) {
    this.chunkSize = chunkSize
    this.chunkOverlap = chunkOverlap
  }

  /**
   * 对笔记内容进行分块
   *
   * @param noteId - 笔记 ID
   * @param notebookId - 笔记本 ID
   * @param text - 笔记文本内容
   * @returns 分块列表
   */
  chunkNote(noteId: string, notebookId: string, text: string): NoteChunk[] {
    if (!text || text.trim().length === 0) {
      return []
    }

    const now = new Date().toISOString()

    // 短文本不分块
    if (!this.shouldChunk(text)) {
      const hash = computeContentHash(text)
      return [
        {
          // chunkId = noteId:hash:index
          // - hash 用于增量更新时匹配内容
          // - index 用于区分相同内容的不同 chunks（防碰撞）
          chunkId: `${noteId}:${hash}:0`,
          noteId,
          notebookId,
          chunkIndex: 0,
          chunkText: text,
          chunkHash: hash,
          charStart: 0,
          charEnd: text.length,
          heading: null,
          createdAt: now
        }
      ]
    }

    // 执行分块
    const chunksText = this.recursiveSplit(text)
    const positions = this.computeChunkPositions(text, chunksText)

    // 构建 NoteChunk 对象
    // 注意：index 仅用于区分相同 hash 的 chunks，diffChunks 仍按 hash 匹配
    return chunksText.map((content, i) => {
      const hash = computeContentHash(content)
      return {
        chunkId: `${noteId}:${hash}:${i}`,
        noteId,
        notebookId,
        chunkIndex: i,
        chunkText: content,
        chunkHash: hash,
        charStart: positions[i][0],
        charEnd: positions[i][1],
        heading: this.extractHeading(content),
        createdAt: now
      }
    })
  }

  /**
   * 判断文本是否需要分块
   */
  shouldChunk(text: string): boolean {
    return text.length > this.chunkSize
  }

  /**
   * 检测文本是否为 Markdown 格式
   */
  private isMarkdown(text: string): boolean {
    const sample = text.slice(0, 1500)
    let featuresFound = 0

    // 标题特征
    const hasHeader =
      sample.includes('\n# ') ||
      sample.startsWith('# ') ||
      sample.includes('\n## ') ||
      sample.startsWith('## ') ||
      sample.includes('\n### ') ||
      sample.startsWith('### ')

    if (hasHeader) {
      featuresFound++
      // 多级标题额外加分
      const headerLevels = [
        sample.includes('\n# ') || sample.startsWith('# '),
        sample.includes('\n## ') || sample.startsWith('## '),
        sample.includes('\n### ') || sample.startsWith('### ')
      ].filter(Boolean).length

      if (headerLevels >= 2) {
        featuresFound++
      }
    }

    // 代码块
    if (sample.includes('```')) featuresFound++
    // 链接
    if (sample.includes('](')) featuresFound++
    // 列表
    if (sample.includes('\n- ') || sample.includes('\n* ') || sample.includes('\n1. '))
      featuresFound++
    // 引用
    if (sample.includes('\n> ')) featuresFound++
    // 粗体/斜体
    if (sample.includes('**') || sample.includes('__')) featuresFound++
    // 水平线
    if (sample.includes('\n---') || sample.includes('\n***')) featuresFound++

    return featuresFound >= 2
  }

  /**
   * 递归分割文本
   */
  private recursiveSplit(text: string): string[] {
    if (this.isMarkdown(text)) {
      return this.splitMarkdown(text)
    } else {
      const chunks = this.splitTextRecursive(text, this.baseSeparators)
      return this.applyOverlap(chunks)
    }
  }

  /**
   * Markdown 两阶段分块
   */
  private splitMarkdown(text: string): string[] {
    // 第一阶段：按标题分割成 sections
    const sections = this.splitByHeaders(text)

    // 第二阶段：对过大的 section 做二次分割
    const finalChunks: string[] = []

    for (const section of sections) {
      if (section.length <= this.chunkSize) {
        finalChunks.push(section)
      } else {
        const subChunks = this.splitTextRecursive(section, this.baseSeparators)
        const overlappedSubChunks = this.applyOverlap(subChunks)
        finalChunks.push(...overlappedSubChunks)
      }
    }

    return finalChunks
  }

  /**
   * 按 Markdown 标题分割
   */
  private splitByHeaders(text: string): string[] {
    const lines = text.split('\n')
    const sections: string[] = []
    let currentSectionLines: string[] = []
    let inCodeBlock = false

    for (const line of lines) {
      // 检测代码块边界
      if (line.startsWith('```')) {
        inCodeBlock = !inCodeBlock
        currentSectionLines.push(line)
        continue
      }

      // 在代码块内，不识别标题
      if (inCodeBlock) {
        currentSectionLines.push(line)
        continue
      }

      // 检查是否是标题行
      if (/^#{1,6}\s+.+$/.test(line)) {
        if (currentSectionLines.length > 0) {
          sections.push(currentSectionLines.join('\n'))
        }
        currentSectionLines = [line]
      } else {
        currentSectionLines.push(line)
      }
    }

    // 添加最后一个 section
    if (currentSectionLines.length > 0) {
      sections.push(currentSectionLines.join('\n'))
    }

    return sections
  }

  /**
   * 递归分割核心逻辑
   */
  private splitTextRecursive(text: string, separators: string[]): string[] {
    if (separators.length === 0) {
      return this.splitByChars(text)
    }

    const separator = separators[0]
    const remainingSeparators = separators.slice(1)

    if (separator === '') {
      return this.splitByChars(text)
    }

    const splits = text.split(separator)
    const finalChunks: string[] = []
    let currentChunk = ''

    for (let i = 0; i < splits.length; i++) {
      const piece = splits[i] + (i < splits.length - 1 ? separator : '')

      if (currentChunk.length + piece.length <= this.chunkSize) {
        currentChunk += piece
      } else {
        if (currentChunk) {
          if (currentChunk.length > this.chunkSize) {
            const subChunks = this.splitTextRecursive(currentChunk, remainingSeparators)
            finalChunks.push(...subChunks)
          } else {
            finalChunks.push(currentChunk)
          }
        }
        currentChunk = piece
      }
    }

    if (currentChunk) {
      if (currentChunk.length > this.chunkSize && remainingSeparators.length > 0) {
        const subChunks = this.splitTextRecursive(currentChunk, remainingSeparators)
        finalChunks.push(...subChunks)
      } else {
        finalChunks.push(currentChunk)
      }
    }

    return finalChunks
  }

  /**
   * 按字符强制分割
   */
  private splitByChars(text: string): string[] {
    const chunks: string[] = []
    for (let i = 0; i < text.length; i += this.chunkSize) {
      const chunk = text.slice(i, i + this.chunkSize)
      if (chunk) {
        chunks.push(chunk)
      }
    }
    return chunks
  }

  /**
   * 应用重叠策略
   */
  private applyOverlap(chunks: string[]): string[] {
    if (chunks.length <= 1 || this.chunkOverlap === 0) {
      return chunks
    }

    const overlappedChunks: string[] = []

    for (let i = 0; i < chunks.length; i++) {
      let currentChunk = chunks[i]

      // 添加前一个块的尾部重叠
      if (i > 0) {
        const prevChunk = chunks[i - 1]
        const overlapText = prevChunk.slice(-this.chunkOverlap)
        currentChunk = overlapText + currentChunk
      }

      overlappedChunks.push(currentChunk)
    }

    return overlappedChunks
  }

  /**
   * 计算每个 chunk 在原文中的位置
   */
  private computeChunkPositions(text: string, chunksText: string[]): Array<[number, number]> {
    const positions: Array<[number, number]> = []
    let currentPos = 0

    for (let i = 0; i < chunksText.length; i++) {
      const chunkContent = chunksText[i]
      let searchContent: string
      let overlapOffset: number

      if (i === 0) {
        searchContent = chunkContent
        overlapOffset = 0
      } else {
        overlapOffset = Math.min(this.chunkOverlap, chunkContent.length)
        searchContent = chunkContent.slice(overlapOffset)
      }

      let startPos: number
      if (searchContent) {
        const foundPos = text.indexOf(searchContent, currentPos)
        startPos = foundPos === -1 ? currentPos : foundPos
      } else {
        startPos = currentPos
      }

      const endPos = startPos + searchContent.length
      positions.push([startPos, endPos])
      currentPos = startPos
    }

    return positions
  }

  /**
   * 从 chunk 内容中提取标题
   */
  private extractHeading(content: string): string | null {
    const match = content.match(/^(#{1,6})\s+(.+)$/m)
    return match ? match[2].trim() : null
  }
}

// 默认实例
let defaultChunkingService: ChunkingService | null = null

/**
 * 获取默认分块服务实例
 */
export function getChunkingService(): ChunkingService {
  if (!defaultChunkingService) {
    defaultChunkingService = new ChunkingService()
  }
  return defaultChunkingService
}

/**
 * 便捷函数：对笔记内容进行分块
 */
export function chunkNote(noteId: string, notebookId: string, text: string): NoteChunk[] {
  return getChunkingService().chunkNote(noteId, notebookId, text)
}
