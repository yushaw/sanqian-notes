/**
 * IndexingService - 知识库自动索引服务
 *
 * 功能：
 * - 笔记失焦时触发增量索引
 * - Chunk 级增量更新（基于 hash 对比）
 * - 只索引变化的 chunks，复用未变化的
 * - 进度通知
 *
 * 参考: LangChain Indexing API
 */

import type { WebContents } from 'electron'
import {
  getEmbeddingConfig,
  insertNoteChunks,
  deleteChunksByIds,
  insertEmbeddings,
  deleteEmbeddingsByChunkIds,
  deleteNoteChunks,
  deleteNoteEmbeddings,
  updateNoteIndexStatus,
  getNoteIndexStatus,
  deleteNoteIndexStatus,
  getNoteChunks,
  updateChunksMetadata,
  clearAllIndexData
} from './database'
import { chunkNote } from './chunking'
import { getEmbeddings } from './api'
import { computeContentHash } from './utils'
import type { NoteChunk, NoteIndexStatus } from './types'
import { generateSummary } from '../summary-service'
import { getNoteSummaryInfo } from '../database'

// 摘要触发阈值：Chunk 变化率超过 30% 时重新生成摘要
const SUMMARY_CHANGE_THRESHOLD = 0.3

/**
 * 触发 AI Summary 生成（如果需要）
 */
function triggerSummary(noteId: string, reason: string): void {
  console.log(`[IndexingService] Note ${noteId} triggering summary (${reason})`)
  generateSummary(noteId).catch((err) => {
    console.error(`[IndexingService] Summary generation failed for ${noteId}:`, err)
  })
}

// 配置常量
const MIN_CONTENT_LENGTH = 100 // 最小内容长度
const MAX_BATCH_SIZE = 10 // 每批处理的笔记数

/**
 * Chunk 差异对比结果
 */
export interface ChunkDiffResult {
  toAdd: NoteChunk[]
  toDelete: NoteChunk[]
  unchanged: NoteChunk[]
}

/**
 * 对比新旧 chunks，返回需要添加、删除、未变化的列表
 *
 * 关键：
 * - unchanged 的 chunk 复用旧 chunkId，只更新位置元数据
 * - 支持重复内容（相同 hash 的多个 chunks）
 *
 * 导出供测试使用
 */
export function diffChunks(oldChunks: NoteChunk[], newChunks: NoteChunk[]): ChunkDiffResult {
  // 构建 hash -> oldChunks[] 的映射（支持重复 hash）
  const oldHashMap = new Map<string, NoteChunk[]>()
  for (const chunk of oldChunks) {
    if (chunk.chunkHash) {
      const list = oldHashMap.get(chunk.chunkHash) || []
      list.push(chunk)
      oldHashMap.set(chunk.chunkHash, list)
    }
  }

  // 记录已使用的旧 chunkId（用于判断哪些需要删除）
  const usedOldChunkIds = new Set<string>()

  // 分类
  const toAdd: NoteChunk[] = []
  const unchanged: NoteChunk[] = []

  for (const newChunk of newChunks) {
    const oldChunkList = newChunk.chunkHash ? oldHashMap.get(newChunk.chunkHash) : null

    // 找一个未使用的旧 chunk
    const oldChunk = oldChunkList?.find(c => !usedOldChunkIds.has(c.chunkId))

    if (oldChunk) {
      // 匹配成功：复用旧 chunkId，但更新位置等元数据
      usedOldChunkIds.add(oldChunk.chunkId)
      unchanged.push({
        ...newChunk,
        chunkId: oldChunk.chunkId  // 复用旧 ID，保持 embedding 关联
      })
    } else {
      // 新增的 chunk
      toAdd.push(newChunk)
    }
  }

  // 未被匹配的旧 chunks 需要删除
  const toDelete: NoteChunk[] = []
  for (const chunk of oldChunks) {
    // 空 hash 的旧数据（迁移前的数据）或未被匹配的都需要删除
    if (!chunk.chunkHash || !usedOldChunkIds.has(chunk.chunkId)) {
      toDelete.push(chunk)
    }
  }

  return { toAdd, toDelete, unchanged }
}

// 索引进度事件
interface IndexingProgress {
  type: 'start' | 'progress' | 'complete' | 'error'
  total?: number
  current?: number
  noteId?: string
  error?: string
}

/**
 * 从 Tiptap JSON 提取纯文本（带 Markdown 格式）
 *
 * 支持的节点类型：
 * - text: 纯文本
 * - paragraph: 段落
 * - heading: 标题（# ## ###）
 * - bulletList/orderedList: 列表（• 1. 2.）
 * - codeBlock: 代码块（```）
 * - blockquote: 引用（>）
 * - hardBreak: 换行
 */
export function extractTextFromTiptap(jsonContent: string): string {
  if (!jsonContent) return ''

  try {
    const doc = JSON.parse(jsonContent)
    if (!doc || !doc.content) return jsonContent

    return extractTextFromNodes(doc.content)
  } catch {
    // 如果不是 JSON，直接返回
    return jsonContent
  }
}

/**
 * 递归提取节点文本
 */
function extractTextFromNodes(nodes: unknown[]): string {
  const parts: string[] = []

  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue

    const n = node as {
      type?: string
      content?: unknown[]
      text?: string
      attrs?: { level?: number }
    }

    switch (n.type) {
      case 'text':
        if (n.text) parts.push(n.text)
        break

      case 'paragraph':
        if (n.content) {
          parts.push(extractTextFromNodes(n.content))
        }
        parts.push('\n')
        break

      case 'heading': {
        const level = n.attrs?.level || 1
        const prefix = '#'.repeat(level) + ' '
        if (n.content) {
          parts.push(prefix + extractTextFromNodes(n.content))
        }
        parts.push('\n')
        break
      }

      case 'bulletList':
      case 'orderedList':
        if (n.content) {
          const items = n.content as unknown[]
          items.forEach((item, idx) => {
            const itemNode = item as { type?: string; content?: unknown[] }
            if (itemNode.type === 'listItem' && itemNode.content) {
              const prefix = n.type === 'orderedList' ? `${idx + 1}. ` : '• '
              const text = extractTextFromNodes(itemNode.content).trim()
              parts.push(prefix + text + '\n')
            }
          })
        }
        break

      case 'listItem':
        if (n.content) {
          parts.push(extractTextFromNodes(n.content))
        }
        break

      case 'codeBlock':
        parts.push('```\n')
        if (n.content) {
          parts.push(extractTextFromNodes(n.content))
        }
        parts.push('\n```\n')
        break

      case 'blockquote':
        if (n.content) {
          const lines = extractTextFromNodes(n.content).split('\n')
          for (const line of lines) {
            if (line.trim()) parts.push('> ' + line + '\n')
          }
        }
        break

      case 'hardBreak':
        parts.push('\n')
        break

      default:
        // 未知类型，尝试递归提取内容
        if (n.content) {
          parts.push(extractTextFromNodes(n.content))
        }
    }
  }

  return parts.join('').replace(/\n{3,}/g, '\n\n').trim()
}

class IndexingService {
  private webContents: WebContents | null = null
  private isRunning = false
  private indexingLocks = new Set<string>()  // 防止同一笔记并发索引

  /**
   * 设置 WebContents 引用（用于发送进度通知）
   */
  setWebContents(webContents: WebContents): void {
    this.webContents = webContents
  }

  /**
   * 启动服务
   */
  start(): void {
    if (this.isRunning) return
    this.isRunning = true
    console.log('[IndexingService] Started')
  }

  /**
   * 停止服务
   */
  stop(): void {
    this.isRunning = false
    console.log('[IndexingService] Stopped')
  }

  /**
   * 笔记失焦时检查并索引
   * 这是主要的入口点，由前端在切换笔记时调用
   */
  async checkAndIndex(noteId: string, notebookId: string, content: string): Promise<boolean> {
    if (!this.isRunning) return false

    const config = getEmbeddingConfig()
    if (!config.enabled) return false

    // 防止同一笔记并发索引
    if (this.indexingLocks.has(noteId)) {
      console.log(`[IndexingService] Note ${noteId} is already being indexed, skipping`)
      return false
    }

    const text = extractTextFromTiptap(content)

    // 内容太短，不索引
    if (text.length < MIN_CONTENT_LENGTH) {
      console.log(`[IndexingService] Note ${noteId} too short (${text.length} chars), skipping`)
      return false
    }

    // 检查内容是否有变化（快速判断）
    const existingStatus = getNoteIndexStatus(noteId)
    if (existingStatus) {
      const newHash = computeContentHash(text)
      // 只有内容相同且上次成功时才跳过（允许 error 状态重试）
      if (existingStatus.contentHash === newHash && existingStatus.status === 'indexed') {
        // 即使索引没变，也要检查是否缺少 summary
        const summaryInfo = getNoteSummaryInfo(noteId)
        if (!summaryInfo?.ai_summary) {
          triggerSummary(noteId, 'no summary')
        } else {
          console.log(`[IndexingService] Note ${noteId} no change (hash match), skipping`)
        }
        return false
      }
    }

    // 加锁
    this.indexingLocks.add(noteId)

    try {
      // 执行增量索引
      return await this.indexNoteIncremental(noteId, notebookId, text)
    } finally {
      // 解锁
      this.indexingLocks.delete(noteId)
    }
  }

  /**
   * 增量索引单个笔记（Chunk 级别）
   *
   * 核心逻辑：
   * 1. 分块并计算每个 chunk 的 hash
   * 2. 获取已有的 chunks
   * 3. 对比 hash，分类为：新增、删除、未变化
   * 4. 只为新增的 chunks 生成 embedding
   * 5. 删除旧的、插入新的
   */
  async indexNoteIncremental(noteId: string, notebookId: string, text: string): Promise<boolean> {
    const config = getEmbeddingConfig()
    if (!config.enabled) return false

    console.log(`[IndexingService] Incremental indexing note ${noteId} (${text.length} chars)`)

    try {
      // 1. 分块（每个 chunk 已包含 chunkHash）
      const newChunks = chunkNote(noteId, notebookId, text)
      if (newChunks.length === 0) {
        console.log(`[IndexingService] Note ${noteId} produced no chunks`)
        return false
      }

      // 2. 获取已有的 chunks
      const oldChunks = getNoteChunks(noteId)

      // 3. 对比 hash，分类
      const result = diffChunks(oldChunks, newChunks)

      console.log(
        `[IndexingService] Note ${noteId}: +${result.toAdd.length} -${result.toDelete.length} =${result.unchanged.length}`
      )

      // 4. 计算变化率，用于判断是否需要更新摘要
      const totalOldChunks = oldChunks.length
      const totalNewChunks = newChunks.length
      const changedChunks = result.toAdd.length + result.toDelete.length
      // 变化率 = 变化的 chunks 数 / max(新旧 chunks 总数)
      const changeRatio = changedChunks / Math.max(totalOldChunks, totalNewChunks, 1)

      // 5. 如果没有变化，检查是否需要补生成 summary
      if (result.toAdd.length === 0 && result.toDelete.length === 0) {
        console.log(`[IndexingService] Note ${noteId} no chunk changes`)
        // 即使 chunks 没变，也要检查是否缺少 summary
        const summaryInfo = getNoteSummaryInfo(noteId)
        if (!summaryInfo?.ai_summary) {
          triggerSummary(noteId, 'no summary')
        }
        return true
      }

      // 6. 先获取新 embeddings（可能失败，失败时不影响现有数据）
      let embeddings: number[][] = []
      if (result.toAdd.length > 0) {
        const chunkTexts = result.toAdd.map((c) => c.chunkText)
        embeddings = await getEmbeddings(chunkTexts)
      }

      // 7. 删除旧的 chunks 和 embeddings（在 embedding 获取成功后再删除）
      if (result.toDelete.length > 0) {
        const deleteIds = result.toDelete.map((c) => c.chunkId)
        deleteChunksByIds(deleteIds)
        deleteEmbeddingsByChunkIds(deleteIds)
      }

      // 8. 插入新 chunks 和 embeddings
      if (result.toAdd.length > 0) {
        insertNoteChunks(result.toAdd)

        const embeddingData = result.toAdd.map((chunk, i) => ({
          chunkId: chunk.chunkId,
          noteId: chunk.noteId,
          notebookId: chunk.notebookId,
          embedding: embeddings[i]
        }))
        insertEmbeddings(embeddingData)
      }

      // 9. 更新 unchanged chunks 的位置元数据（chunkIndex, charStart, charEnd 可能变化）
      if (result.unchanged.length > 0) {
        updateChunksMetadata(result.unchanged)
      }

      // 10. 更新索引状态
      const status: NoteIndexStatus = {
        noteId,
        contentHash: computeContentHash(text),
        chunkCount: newChunks.length,
        modelName: config.modelName,
        indexedAt: new Date().toISOString(),
        status: 'indexed'
      }
      updateNoteIndexStatus(status)

      console.log(`[IndexingService] Note ${noteId} indexed successfully`)

      // 11. 检查是否需要更新摘要（新笔记、变化率 > 30%、或没有摘要）
      const isNewNote = totalOldChunks === 0
      const summaryInfo = getNoteSummaryInfo(noteId)
      const noSummary = !summaryInfo?.ai_summary
      if (isNewNote || changeRatio > SUMMARY_CHANGE_THRESHOLD || noSummary) {
        const reason = isNewNote
          ? 'new note'
          : noSummary
            ? 'no summary'
            : `change: ${(changeRatio * 100).toFixed(0)}%`
        triggerSummary(noteId, reason)
      }

      // 发送进度通知
      this.sendProgress({
        type: 'progress',
        noteId
      })

      return true
    } catch (error) {
      console.error(`[IndexingService] Failed to index note ${noteId}:`, error)

      // 更新错误状态
      const status: NoteIndexStatus = {
        noteId,
        contentHash: computeContentHash(text),
        chunkCount: 0,
        modelName: config.modelName,
        indexedAt: new Date().toISOString(),
        status: 'error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error'
      }
      updateNoteIndexStatus(status)

      // 发送错误通知
      this.sendProgress({
        type: 'error',
        noteId,
        error: status.errorMessage
      })

      return false
    }
  }

  /**
   * 删除笔记索引
   */
  deleteNoteIndex(noteId: string): void {
    // 删除数据库中的索引数据
    deleteNoteChunks(noteId)
    deleteNoteEmbeddings(noteId)
    deleteNoteIndexStatus(noteId)

    console.log(`[IndexingService] Note ${noteId} index deleted`)
  }

  /**
   * 全量索引单个笔记（用于首次索引或强制重建）
   */
  async indexNoteFull(noteId: string, notebookId: string, content: string): Promise<boolean> {
    const config = getEmbeddingConfig()
    if (!config.enabled) return false

    const text = extractTextFromTiptap(content)

    console.log(`[IndexingService] Full indexing note ${noteId} (${text.length} chars)`)

    try {
      // 1. 分块
      const chunks = chunkNote(noteId, notebookId, text)
      if (chunks.length === 0) {
        console.log(`[IndexingService] Note ${noteId} produced no chunks`)
        return false
      }

      console.log(`[IndexingService] Note ${noteId} split into ${chunks.length} chunks`)

      // 2. 获取 embeddings
      const chunkTexts = chunks.map((c) => c.chunkText)
      const embeddings = await getEmbeddings(chunkTexts)

      // 3. 删除旧数据
      deleteNoteChunks(noteId)
      deleteNoteEmbeddings(noteId)

      // 4. 存储新分块
      insertNoteChunks(chunks)

      // 5. 存储 embeddings
      const embeddingData = chunks.map((chunk, i) => ({
        chunkId: chunk.chunkId,
        noteId: chunk.noteId,
        notebookId: chunk.notebookId,
        embedding: embeddings[i]
      }))
      insertEmbeddings(embeddingData)

      // 6. 更新索引状态
      const status: NoteIndexStatus = {
        noteId,
        contentHash: computeContentHash(text),
        chunkCount: chunks.length,
        modelName: config.modelName,
        indexedAt: new Date().toISOString(),
        status: 'indexed'
      }
      updateNoteIndexStatus(status)

      console.log(`[IndexingService] Note ${noteId} indexed successfully`)

      // 检查是否需要生成摘要
      const summaryInfo = getNoteSummaryInfo(noteId)
      if (!summaryInfo?.ai_summary) {
        triggerSummary(noteId, 'full index, no summary')
      }

      // 发送进度通知
      this.sendProgress({
        type: 'progress',
        noteId
      })

      return true
    } catch (error) {
      console.error(`[IndexingService] Failed to index note ${noteId}:`, error)

      // 更新错误状态
      const status: NoteIndexStatus = {
        noteId,
        contentHash: computeContentHash(text),
        chunkCount: 0,
        modelName: config.modelName,
        indexedAt: new Date().toISOString(),
        status: 'error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error'
      }
      updateNoteIndexStatus(status)

      // 发送错误通知
      this.sendProgress({
        type: 'error',
        noteId,
        error: status.errorMessage
      })

      return false
    }
  }

  /**
   * 重建所有笔记索引
   */
  async rebuildAllNotes(
    notes: Array<{ id: string; notebook_id: string | null; content: string }>
  ): Promise<void> {
    const config = getEmbeddingConfig()
    if (!config.enabled) {
      console.log('[IndexingService] Knowledge base disabled, skipping rebuild')
      return
    }

    console.log(`[IndexingService] Starting full rebuild for ${notes.length} notes`)

    // 清空所有索引数据
    clearAllIndexData()

    // 发送开始通知
    this.sendProgress({
      type: 'start',
      total: notes.length,
      current: 0
    })

    let successCount = 0
    let errorCount = 0

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i]
      const text = extractTextFromTiptap(note.content)

      // 跳过太短的笔记
      if (text.length < MIN_CONTENT_LENGTH) {
        // 仍然发送进度，避免进度条卡住
        this.sendProgress({
          type: 'progress',
          total: notes.length,
          current: i + 1,
          noteId: note.id
        })
        continue
      }

      // 加锁防止用户切换到正在 rebuild 的笔记时触发并发索引
      this.indexingLocks.add(note.id)
      let success: boolean
      try {
        success = await this.indexNoteFull(note.id, note.notebook_id || '', note.content)
      } finally {
        this.indexingLocks.delete(note.id)
      }

      if (success) {
        successCount++
      } else {
        errorCount++
      }

      // 发送进度
      this.sendProgress({
        type: 'progress',
        total: notes.length,
        current: i + 1,
        noteId: note.id
      })

      // 批次间隔，避免 API 过载
      if ((i + 1) % MAX_BATCH_SIZE === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }

    // 发送完成通知
    this.sendProgress({
      type: 'complete',
      total: notes.length,
      current: successCount
    })

    console.log(`[IndexingService] Rebuild complete: ${successCount} success, ${errorCount} errors`)
  }

  /**
   * 获取队列状态（兼容旧接口）
   */
  getQueueStatus(): { pending: number; queue: number; processing: boolean } {
    return {
      pending: 0,
      queue: 0,
      processing: false
    }
  }

  /**
   * 发送进度通知到前端
   */
  private sendProgress(progress: IndexingProgress): void {
    if (this.webContents && !this.webContents.isDestroyed()) {
      this.webContents.send('knowledgeBase:progress', progress)
    }
  }
}

// 单例
export const indexingService = new IndexingService()
