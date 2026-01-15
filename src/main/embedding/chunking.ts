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

// 受保护结构的正则表达式（不能被切断的结构）
// 参考 WeKnora: https://github.com/Tencent/WeKnora
const PROTECTED_PATTERNS = {
  // 代码块: ```...```
  codeBlock: /```[\s\S]*?```/g,
  // 数学公式块: $$...$$
  mathBlock: /\$\$[\s\S]*?\$\$/g
}

// 受保护结构的标识
interface ProtectedRegion {
  start: number
  end: number
  type: 'codeBlock' | 'mathBlock' | 'table'
  content: string
}

/**
 * 分块服务
 */
export class ChunkingService {
  private chunkSize: number
  private chunkOverlap: number
  private mergeSmallChunksEnabled: boolean

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

  constructor(
    chunkSize: number = CHUNK_SIZE,
    chunkOverlap: number = CHUNK_OVERLAP,
    mergeSmallChunksEnabled: boolean = true
  ) {
    this.chunkSize = chunkSize
    this.chunkOverlap = chunkOverlap
    this.mergeSmallChunksEnabled = mergeSmallChunksEnabled
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
   * 查找文本中所有受保护的结构区域
   */
  private findProtectedRegions(text: string): ProtectedRegion[] {
    const regions: ProtectedRegion[] = []

    // 查找代码块
    const codeBlockRegex = new RegExp(PROTECTED_PATTERNS.codeBlock.source, 'g')
    let match: RegExpExecArray | null
    while ((match = codeBlockRegex.exec(text)) !== null) {
      regions.push({
        start: match.index,
        end: match.index + match[0].length,
        type: 'codeBlock',
        content: match[0]
      })
    }

    // 查找数学公式块
    const mathBlockRegex = new RegExp(PROTECTED_PATTERNS.mathBlock.source, 'g')
    while ((match = mathBlockRegex.exec(text)) !== null) {
      // 检查是否与代码块重叠（代码块内的 $$ 不算）
      const isInsideCodeBlock = regions.some(
        (r) => r.type === 'codeBlock' && match!.index >= r.start && match!.index < r.end
      )
      if (!isInsideCodeBlock) {
        regions.push({
          start: match.index,
          end: match.index + match[0].length,
          type: 'mathBlock',
          content: match[0]
        })
      }
    }

    // 查找表格（使用行扫描方式，更可靠）
    const tableRegions = this.findTableRegions(text, regions)
    regions.push(...tableRegions)

    // 按起始位置排序
    return regions.sort((a, b) => a.start - b.start)
  }

  /**
   * 通过行扫描方式查找表格区域
   * 表格特征：连续的以 | 开头和结尾的行，且包含分隔行 |---|
   */
  private findTableRegions(
    text: string,
    existingRegions: ProtectedRegion[]
  ): ProtectedRegion[] {
    const tableRegions: ProtectedRegion[] = []
    const lines = text.split('\n')
    let currentPos = 0
    let tableStartPos = -1
    let tableLines: string[] = []
    let hasSeparatorLine = false

    const isTableLine = (line: string): boolean => {
      const trimmed = line.trim()
      return trimmed.startsWith('|') && trimmed.endsWith('|')
    }

    const isSeparatorLine = (line: string): boolean => {
      // 分隔行: | --- | --- | 或 |:---|:---| 等
      const trimmed = line.trim()
      if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return false
      // 去掉首尾的 |，然后按 | 分割
      const cells = trimmed.slice(1, -1).split('|')
      // 每个单元格只能包含 -, :, 空格，且至少有一个 -
      return cells.every((cell) => /^[\s:-]*-[\s:-]*$/.test(cell))
    }

    const isInsideExistingRegion = (pos: number): boolean => {
      return existingRegions.some((r) => pos >= r.start && pos < r.end)
    }

    const saveTable = () => {
      if (tableLines.length >= 2 && hasSeparatorLine) {
        const content = tableLines.join('\n')
        tableRegions.push({
          start: tableStartPos,
          end: tableStartPos + content.length,
          type: 'table',
          content
        })
      }
      tableStartPos = -1
      tableLines = []
      hasSeparatorLine = false
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const lineStart = currentPos
      currentPos += line.length + 1 // +1 for \n

      // 跳过已有保护区域内的行
      if (isInsideExistingRegion(lineStart)) {
        if (tableStartPos !== -1) saveTable()
        continue
      }

      if (isTableLine(line)) {
        if (tableStartPos === -1) {
          tableStartPos = lineStart
        }
        tableLines.push(line)
        if (isSeparatorLine(line)) {
          hasSeparatorLine = true
        }
      } else {
        // 非表格行，保存之前的表格
        if (tableStartPos !== -1) {
          saveTable()
        }
      }
    }

    // 处理文件末尾的表格
    if (tableStartPos !== -1) {
      saveTable()
    }

    return tableRegions
  }

  /**
   * 将文本分割成单元，受保护结构作为独立单元
   * 返回: { text: string, isProtected: boolean }[]
   * 注意：保留空白文本以确保位置计算正确
   */
  private splitIntoUnits(text: string): Array<{ text: string; isProtected: boolean }> {
    const regions = this.findProtectedRegions(text)

    if (regions.length === 0) {
      return [{ text, isProtected: false }]
    }

    const units: Array<{ text: string; isProtected: boolean }> = []
    let currentPos = 0

    for (const region of regions) {
      // 添加保护区域之前的普通文本（包括空白文本，以保持位置准确）
      if (region.start > currentPos) {
        const normalText = text.slice(currentPos, region.start)
        // 只有纯空白且没有换行的才跳过，有换行的保留（可能是段落分隔）
        if (normalText.length > 0 && (normalText.trim() || normalText.includes('\n'))) {
          units.push({ text: normalText, isProtected: false })
        }
      }

      // 添加受保护的结构
      units.push({ text: region.content, isProtected: true })
      currentPos = region.end
    }

    // 添加最后一个保护区域之后的文本
    if (currentPos < text.length) {
      const remainingText = text.slice(currentPos)
      if (remainingText.length > 0 && (remainingText.trim() || remainingText.includes('\n'))) {
        units.push({ text: remainingText, isProtected: false })
      }
    }

    return units
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
   * Markdown 分块（带结构保护）
   *
   * 策略：
   * 1. 先识别受保护结构（代码块、表格、数学公式块）
   * 2. 将文本分成单元，受保护结构作为原子单元
   * 3. 对非保护单元按标题分割，再做递归分块
   * 4. 保护单元保持完整（即使超过 chunkSize）
   */
  private splitMarkdown(text: string): string[] {
    // 分割成单元
    const units = this.splitIntoUnits(text)
    const finalChunks: string[] = []

    for (const unit of units) {
      if (unit.isProtected) {
        // 受保护结构：保持完整，不切分
        // 即使超过 chunkSize，也保持完整（保证结构语义）
        finalChunks.push(unit.text)
      } else {
        // 非保护文本：正常分块流程
        // 第一阶段：按标题分割成 sections
        const sections = this.splitByHeaders(unit.text)

        // 第二阶段：对过大的 section 做二次分割
        for (const section of sections) {
          if (section.length <= this.chunkSize) {
            finalChunks.push(section)
          } else {
            const subChunks = this.splitTextRecursive(section, this.baseSeparators)
            const overlappedSubChunks = this.applyOverlap(subChunks)
            finalChunks.push(...overlappedSubChunks)
          }
        }
      }
    }

    // 合并相邻的小块（避免过度碎片化），传入原文用于验证拼接
    return this.mergeSmallChunksEnabled ? this.mergeSmallChunks(finalChunks, text) : finalChunks
  }

  /**
   * 合并相邻的小块，避免过度碎片化
   * 只有当 buffer + chunk 在原文中存在时才合并，保证 chunkText 是原文子串
   *
   * @param chunks - 待合并的 chunks
   * @param sourceText - 原始文本，用于验证拼接是否合法
   */
  private mergeSmallChunks(chunks: string[], sourceText?: string): string[] {
    if (chunks.length <= 1) return chunks

    const merged: string[] = []
    let buffer = ''

    for (const chunk of chunks) {
      if (!buffer) {
        buffer = chunk
        continue
      }

      const candidate = buffer + chunk

      // 只有当拼接结果在原文中存在且不超过 chunkSize 时才合并
      const existsInSource = sourceText ? sourceText.includes(candidate) : true
      const withinSize = candidate.length <= this.chunkSize

      if (existsInSource && withinSize) {
        buffer = candidate
      } else {
        // 不能合并，保存 buffer，开始新的
        merged.push(buffer)
        buffer = chunk
      }
    }

    if (buffer) {
      merged.push(buffer)
    }

    return merged
  }

  /**
   * 按 Markdown 标题分割
   * 保留原始分隔符以确保位置计算正确
   */
  private splitByHeaders(text: string): string[] {
    const lines = text.split('\n')
    const sections: string[] = []
    let currentSectionLines: string[] = []
    let inCodeBlock = false
    let pendingBlankLines: string[] = [] // 暂存标题前的空行

    for (const line of lines) {
      // 检测代码块边界
      if (line.startsWith('```')) {
        inCodeBlock = !inCodeBlock
        // 如果有暂存的空行，先加到当前 section
        if (pendingBlankLines.length > 0) {
          currentSectionLines.push(...pendingBlankLines)
          pendingBlankLines = []
        }
        currentSectionLines.push(line)
        continue
      }

      // 在代码块内，不识别标题
      if (inCodeBlock) {
        currentSectionLines.push(line)
        continue
      }

      // 检查是否是空行（可能是标题前的分隔符）
      if (line.trim() === '') {
        pendingBlankLines.push(line)
        continue
      }

      // 检查是否是标题行
      if (/^#{1,6}\s+.+$/.test(line)) {
        // 将暂存的空行加到前一个 section（保持原始分隔）
        if (pendingBlankLines.length > 0) {
          currentSectionLines.push(...pendingBlankLines)
          pendingBlankLines = []
        }
        if (currentSectionLines.length > 0) {
          sections.push(currentSectionLines.join('\n'))
        }
        currentSectionLines = [line]
      } else {
        // 非标题行，将暂存的空行和当前行都加到 section
        if (pendingBlankLines.length > 0) {
          currentSectionLines.push(...pendingBlankLines)
          pendingBlankLines = []
        }
        currentSectionLines.push(line)
      }
    }

    // 处理末尾
    if (pendingBlankLines.length > 0) {
      currentSectionLines.push(...pendingBlankLines)
    }
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
   * 策略：
   * 1. 尝试精确匹配（去掉 overlap 前缀后搜索）
   * 2. 如果失败，尝试匹配 chunk 开头的一小段文本
   * 3. 最后回退到估算位置
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

      let startPos: number = -1

      if (searchContent) {
        // 策略 1: 精确匹配
        startPos = text.indexOf(searchContent, currentPos)

        // 策略 2: 如果失败，尝试匹配开头的一小段（50 字符）
        if (startPos === -1 && searchContent.length > 50) {
          const shortPrefix = searchContent.slice(0, 50)
          const prefixPos = text.indexOf(shortPrefix, currentPos)
          if (prefixPos !== -1) {
            startPos = prefixPos
          }
        }

        // 策略 3: 回退到当前位置估算
        if (startPos === -1) {
          startPos = currentPos
        }
      } else {
        startPos = currentPos
      }

      // 计算位置：charStart/charEnd 应覆盖完整的 chunkContent（含 overlap）
      // 这样 text.slice(charStart, charEnd) === chunkContent
      const charStart = i === 0 ? startPos : Math.max(0, startPos - overlapOffset)
      const charEnd = Math.min(charStart + chunkContent.length, text.length)
      positions.push([charStart, charEnd])

      // 更新 currentPos：基于非 overlap 内容的结束位置，确保下一个搜索正确
      const uniqueEndPos = Math.min(startPos + searchContent.length, text.length)
      currentPos = uniqueEndPos
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
