/**
 * IndexingService - 知识库自动索引服务
 *
 * 功能：
 * - 监听笔记变更，自动触发索引
 * - Throttle 60s + Debounce 5s 防止频繁调用
 * - 内容变化检测 (contentHash)
 * - 索引队列管理
 * - 进度通知
 */

import crypto from 'crypto'
import { BrowserWindow } from 'electron'
import {
  getEmbeddingConfig,
  insertNoteChunks,
  deleteNoteChunks,
  insertEmbeddings,
  deleteNoteEmbeddings,
  updateNoteIndexStatus,
  getNoteIndexStatus,
  deleteNoteIndexStatus,
  clearAllIndexData
} from './database'
import { chunkNote } from './chunking'
import { getEmbeddings } from './api'
import type { NoteIndexStatus } from './types'

// 配置常量
const DEBOUNCE_DELAY = 5000 // 5 秒
const THROTTLE_INTERVAL = 60000 // 60 秒
const MIN_CONTENT_LENGTH = 100 // 最小内容长度
const MAX_BATCH_SIZE = 10 // 每批处理的笔记数

// Pending 笔记信息
interface PendingNote {
  noteId: string
  notebookId: string
  content: string
  timestamp: number
  timeoutId?: NodeJS.Timeout
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
 * 计算内容哈希
 */
function computeContentHash(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex').slice(0, 16)
}

/**
 * 从 Tiptap JSON 提取纯文本
 */
function extractTextFromTiptap(jsonContent: string): string {
  try {
    const doc = JSON.parse(jsonContent)
    return extractTextFromNode(doc)
  } catch {
    // 如果不是 JSON，直接返回
    return jsonContent
  }
}

function extractTextFromNode(node: unknown): string {
  if (!node || typeof node !== 'object') return ''

  const n = node as { type?: string; text?: string; content?: unknown[] }

  if (n.type === 'text' && typeof n.text === 'string') {
    return n.text
  }

  if (Array.isArray(n.content)) {
    return n.content.map(extractTextFromNode).join('\n')
  }

  return ''
}

/**
 * 检测内容是否有变化
 */
function hasContentChanged(oldHash: string, newHash: string): boolean {
  return oldHash !== newHash
}

class IndexingService {
  private pendingNotes: Map<string, PendingNote> = new Map()
  private indexQueue: string[] = []
  private isProcessing = false
  private throttleTimer: NodeJS.Timeout | null = null
  private mainWindow: BrowserWindow | null = null
  private isRunning = false

  /**
   * 设置主窗口引用（用于发送进度通知）
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  /**
   * 启动服务
   */
  start(): void {
    if (this.isRunning) return
    this.isRunning = true

    // 启动 throttle 定时器
    this.throttleTimer = setInterval(() => {
      this.checkPendingNotes()
    }, THROTTLE_INTERVAL)

    console.log('[IndexingService] Started')
  }

  /**
   * 停止服务（同步清理，不等待正在进行的索引）
   * 注意：Electron will-quit 事件不会等待 async，所以这里用同步清理
   */
  stop(): void {
    this.isRunning = false

    // 清除 throttle 定时器
    if (this.throttleTimer) {
      clearInterval(this.throttleTimer)
      this.throttleTimer = null
    }

    // 清除所有 pending 的 debounce 定时器
    for (const pending of this.pendingNotes.values()) {
      if (pending.timeoutId) {
        clearTimeout(pending.timeoutId)
      }
    }
    this.pendingNotes.clear()
    this.indexQueue = []

    console.log('[IndexingService] Stopped')
  }

  /**
   * 标记笔记为待索引
   */
  markPending(noteId: string, notebookId: string, content: string): void {
    if (!this.isRunning) return

    const config = getEmbeddingConfig()
    if (!config.enabled) return

    // 提取纯文本
    const text = extractTextFromTiptap(content)

    // 内容太短，不索引
    if (text.length < MIN_CONTENT_LENGTH) {
      console.log(`[IndexingService] Note ${noteId} too short (${text.length} chars), skipping`)
      return
    }

    // 清除之前的 debounce 定时器
    const existing = this.pendingNotes.get(noteId)
    if (existing?.timeoutId) {
      clearTimeout(existing.timeoutId)
    }

    // 设置新的 debounce 定时器
    const timeoutId = setTimeout(() => {
      this.onDebounceComplete(noteId)
    }, DEBOUNCE_DELAY)

    this.pendingNotes.set(noteId, {
      noteId,
      notebookId: notebookId || '',
      content,
      timestamp: Date.now(),
      timeoutId
    })

    console.log(`[IndexingService] Note ${noteId} marked as pending`)
  }

  /**
   * 从待处理列表移除笔记
   */
  removeFromPending(noteId: string): void {
    const pending = this.pendingNotes.get(noteId)
    if (pending?.timeoutId) {
      clearTimeout(pending.timeoutId)
    }
    this.pendingNotes.delete(noteId)
  }

  /**
   * Debounce 完成回调
   */
  private onDebounceComplete(noteId: string): void {
    const pending = this.pendingNotes.get(noteId)
    if (!pending) return

    // 清除 timeout 引用
    pending.timeoutId = undefined

    // 检查是否需要索引
    if (this.shouldIndex(pending)) {
      this.addToQueue(noteId)
      // 注意：不在这里删除 pendingNotes，让 processQueue 处理后删除
    } else {
      // 不需要索引，直接删除
      this.pendingNotes.delete(noteId)
    }
  }

  /**
   * Throttle 定时检查
   */
  private checkPendingNotes(): void {
    const now = Date.now()

    for (const [noteId, pending] of this.pendingNotes.entries()) {
      // 超过 throttle 间隔的笔记强制加入队列
      if (now - pending.timestamp >= THROTTLE_INTERVAL) {
        if (pending.timeoutId) {
          clearTimeout(pending.timeoutId)
          pending.timeoutId = undefined
        }

        if (this.shouldIndex(pending)) {
          this.addToQueue(noteId)
          // 注意：不在这里删除 pendingNotes，让 processQueue 处理后删除
        } else {
          // 不需要索引，直接删除
          this.pendingNotes.delete(noteId)
        }
      }
    }
  }

  /**
   * 判断是否需要索引
   */
  private shouldIndex(pending: PendingNote): boolean {
    const text = extractTextFromTiptap(pending.content)

    // 内容太短
    if (text.length < MIN_CONTENT_LENGTH) {
      return false
    }

    // 检查内容是否有变化
    const existingStatus = getNoteIndexStatus(pending.noteId)
    if (existingStatus) {
      const newHash = computeContentHash(text)
      const oldHash = existingStatus.contentHash

      if (!hasContentChanged(oldHash, newHash)) {
        console.log(`[IndexingService] Note ${pending.noteId} no change, skipping`)
        return false
      }
    }

    return true
  }

  /**
   * 添加到索引队列
   */
  private addToQueue(noteId: string): void {
    if (!this.indexQueue.includes(noteId)) {
      this.indexQueue.push(noteId)
      console.log(`[IndexingService] Note ${noteId} added to queue (queue size: ${this.indexQueue.length})`)

      // 触发队列处理
      this.processQueue()
    }
  }

  /**
   * 处理索引队列
   */
  async processQueue(): Promise<void> {
    if (this.isProcessing || this.indexQueue.length === 0) return

    this.isProcessing = true

    try {
      while (this.indexQueue.length > 0 && this.isRunning) {
        const noteId = this.indexQueue.shift()!
        const pending = this.pendingNotes.get(noteId)

        if (pending) {
          await this.indexNote(pending.noteId, pending.notebookId, pending.content)
          this.pendingNotes.delete(noteId)
        } else {
          // 如果不在 pending 中，可能是从数据库恢复的
          // 需要从数据库获取笔记内容
          console.log(`[IndexingService] Note ${noteId} not in pending, skipping`)
        }
      }
    } finally {
      this.isProcessing = false
    }
  }

  /**
   * 索引单个笔记
   */
  async indexNote(noteId: string, notebookId: string, content: string): Promise<boolean> {
    const config = getEmbeddingConfig()
    if (!config.enabled) return false

    const text = extractTextFromTiptap(content)

    console.log(`[IndexingService] Indexing note ${noteId} (${text.length} chars)`)

    try {
      // 1. 分块
      const chunks = chunkNote(noteId, notebookId, text)
      if (chunks.length === 0) {
        console.log(`[IndexingService] Note ${noteId} produced no chunks`)
        return false
      }

      console.log(`[IndexingService] Note ${noteId} split into ${chunks.length} chunks`)

      // 2. 获取 embeddings（先获取，成功后再删除旧数据）
      const chunkTexts = chunks.map((c) => c.chunkText)
      const embeddings = await getEmbeddings(chunkTexts)

      // 3. 删除旧数据（embedding 获取成功后再删除）
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
    this.removeFromPending(noteId)

    // 从队列中移除
    const queueIndex = this.indexQueue.indexOf(noteId)
    if (queueIndex !== -1) {
      this.indexQueue.splice(queueIndex, 1)
    }

    // 删除数据库中的索引数据
    deleteNoteChunks(noteId)
    deleteNoteEmbeddings(noteId)
    deleteNoteIndexStatus(noteId)

    console.log(`[IndexingService] Note ${noteId} index deleted`)
  }

  /**
   * 重建所有笔记索引
   */
  async rebuildAllNotes(notes: Array<{ id: string; notebook_id: string | null; content: string }>): Promise<void> {
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

      const success = await this.indexNote(note.id, note.notebook_id || '', note.content)

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
   * 获取队列状态
   */
  getQueueStatus(): { pending: number; queue: number; processing: boolean } {
    return {
      pending: this.pendingNotes.size,
      queue: this.indexQueue.length,
      processing: this.isProcessing
    }
  }

  /**
   * 发送进度通知到前端
   */
  private sendProgress(progress: IndexingProgress): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('knowledgeBase:progress', progress)
    }
  }
}

// 单例
export const indexingService = new IndexingService()
