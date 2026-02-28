/**
 * FTS 与 Embedding 索引拆分测试
 *
 * 测试场景：
 * 1. indexNoteFtsOnly - 仅建立 FTS 索引
 * 2. buildEmbeddingForNote - 为已有 FTS 的笔记补建 Embedding
 * 3. checkAndIndex - 自动补建逻辑
 * 4. 状态管理 - ftsStatus/embeddingStatus 字段
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NoteChunk, NoteIndexStatus, EmbeddingConfig } from '../types'
import { computeContentHash } from '../utils'

// Mock 依赖模块
vi.mock('../database', () => ({
  getEmbeddingConfig: vi.fn(),
  insertNoteChunks: vi.fn(),
  deleteNoteChunks: vi.fn(),
  getNoteChunks: vi.fn(),
  insertEmbeddings: vi.fn(),
  deleteNoteEmbeddings: vi.fn(),
  updateNoteIndexStatus: vi.fn(),
  getNoteIndexStatus: vi.fn(),
  deleteNoteIndexStatus: vi.fn(),
  deleteChunksByIds: vi.fn(),
  deleteEmbeddingsByChunkIds: vi.fn(),
  updateChunksMetadata: vi.fn(),
  clearAllIndexData: vi.fn(),
  scheduleFtsRebuild: vi.fn()
}))

vi.mock('../api', () => ({
  getEmbeddings: vi.fn()
}))

vi.mock('../chunking', () => ({
  chunkNote: vi.fn()
}))

vi.mock('../../summary-service', () => ({
  generateSummary: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../../database', () => ({
  getNoteSummaryInfo: vi.fn().mockReturnValue(null),
  getLocalNoteSummaryInfo: vi.fn().mockReturnValue(null),
  getLocalNoteIdentityByUid: vi.fn().mockReturnValue(null),
}))

import {
  getEmbeddingConfig,
  insertNoteChunks,
  deleteNoteChunks,
  getNoteChunks,
  insertEmbeddings,
  deleteNoteEmbeddings,
  updateNoteIndexStatus,
  getNoteIndexStatus
} from '../database'
import { getEmbeddings } from '../api'
import { chunkNote } from '../chunking'
import { generateSummary } from '../../summary-service'
import { getLocalNoteIdentityByUid, getLocalNoteSummaryInfo, getNoteSummaryInfo } from '../../database'

// 导入被测试的服务
import { IndexingService } from '../indexing-service'

// 辅助函数
function createMockChunk(noteId: string, index: number, text: string): NoteChunk {
  return {
    chunkId: `${noteId}:chunk${index}`,
    noteId,
    notebookId: 'nb1',
    chunkIndex: index,
    chunkText: text,
    chunkHash: `hash_${index}`,
    charStart: 0,
    charEnd: text.length,
    heading: null,
    createdAt: new Date().toISOString()
  }
}

function createMockStatus(
  noteId: string,
  options: {
    ftsStatus?: 'none' | 'indexed'
    embeddingStatus?: 'none' | 'indexed' | 'pending' | 'error'
    contentHash?: string
  } = {}
): NoteIndexStatus {
  return {
    noteId,
    contentHash: options.contentHash ?? 'hash123',
    chunkCount: 2,
    modelName: 'text-embedding-3-small',
    indexedAt: new Date().toISOString(),
    status: 'indexed',
    ftsStatus: options.ftsStatus ?? 'indexed',
    embeddingStatus: options.embeddingStatus ?? 'indexed'
  } as NoteIndexStatus
}

function createMockConfig(enabled: boolean): EmbeddingConfig {
  return {
    enabled,
    source: 'custom',
    apiType: 'openai',
    apiUrl: enabled ? 'https://api.openai.com/v1/embeddings' : '',
    apiKey: enabled ? 'test-key' : '',
    modelName: enabled ? 'text-embedding-3-small' : '',
    dimensions: enabled ? 1536 : 0
  }
}

// 创建一个简单的 tiptap JSON 内容
function createTiptapContent(text: string): string {
  return JSON.stringify({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text }]
      }
    ]
  })
}

// 足够长的测试文本（超过 MIN_CONTENT_LENGTH = 100）
const LONG_TEXT = '这是一段足够长的测试内容，需要超过最小长度限制才能触发索引。这段文字必须足够长，至少要有一百个字符以上，这样才能通过内容长度检查。现在继续添加更多的文字，确保总长度超过一百个字符的要求。让我们再写一些内容来确保测试能够通过。这应该足够长了吧？如果还不够的话，我再多写一点。'

describe('FTS 与 Embedding 索引拆分', () => {
  let service: IndexingService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new IndexingService()
    service.start()
    vi.mocked(getLocalNoteIdentityByUid).mockReturnValue(null)
    vi.mocked(getLocalNoteSummaryInfo).mockReturnValue(null)
  })

  describe('indexNoteFtsOnly - 仅建立 FTS 索引', () => {
    it('应该只建立 FTS 索引，不调用 embedding API', async () => {
      // 准备
      const mockChunks = [
        createMockChunk('note1', 0, '测试内容1'),
        createMockChunk('note1', 1, '测试内容2')
      ]
      vi.mocked(chunkNote).mockReturnValue(mockChunks)

      const content = createTiptapContent(LONG_TEXT)

      // 执行
      const result = await service.indexNoteFtsOnly('note1', 'nb1', content)

      // 验证
      expect(result).toBe(true)
      expect(deleteNoteChunks).toHaveBeenCalledWith('note1')
      expect(deleteNoteEmbeddings).toHaveBeenCalledWith('note1')
      expect(insertNoteChunks).toHaveBeenCalledWith(mockChunks)
      expect(getEmbeddings).not.toHaveBeenCalled() // 关键：不调用 embedding API
      expect(insertEmbeddings).not.toHaveBeenCalled()
      expect(updateNoteIndexStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          noteId: 'note1',
          ftsStatus: 'indexed',
          embeddingStatus: 'none'
        })
      )
    })

    it('内容太短时应该跳过索引', async () => {
      const content = createTiptapContent('hi') // 太短

      const result = await service.indexNoteFtsOnly('note1', 'nb1', content)

      expect(result).toBe(false)
      expect(insertNoteChunks).not.toHaveBeenCalled()
    })

    it('分块结果为空时应该返回 false', async () => {
      vi.mocked(chunkNote).mockReturnValue([])
      const content = createTiptapContent(LONG_TEXT)

      const result = await service.indexNoteFtsOnly('note1', 'nb1', content)

      expect(result).toBe(false)
    })
  })

  describe('buildEmbeddingForNote - 补建 Embedding', () => {
    it('应该为已有 FTS 的笔记补建 Embedding', async () => {
      // 准备：笔记已有 chunks
      const existingChunks = [
        createMockChunk('note1', 0, '测试内容1'),
        createMockChunk('note1', 1, '测试内容2')
      ]
      vi.mocked(getNoteChunks).mockReturnValue(existingChunks)
      vi.mocked(getEmbeddings).mockResolvedValue([[0.1, 0.2], [0.3, 0.4]])
      vi.mocked(getEmbeddingConfig).mockReturnValue(createMockConfig(true))
      vi.mocked(getNoteIndexStatus).mockReturnValue(
        createMockStatus('note1', { ftsStatus: 'indexed', embeddingStatus: 'none' })
      )

      // 执行
      const result = await service.buildEmbeddingForNote('note1')

      // 验证
      expect(result).toBe(true)
      expect(getNoteChunks).toHaveBeenCalledWith('note1')
      expect(getEmbeddings).toHaveBeenCalledWith(['测试内容1', '测试内容2'])
      expect(deleteNoteEmbeddings).toHaveBeenCalledWith('note1')
      expect(insertEmbeddings).toHaveBeenCalled()
      expect(updateNoteIndexStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          embeddingStatus: 'indexed'
        })
      )
    })

    it('embedding 禁用时应该返回 false', async () => {
      vi.mocked(getEmbeddingConfig).mockReturnValue(createMockConfig(false))

      const result = await service.buildEmbeddingForNote('note1')

      expect(result).toBe(false)
      expect(getNoteChunks).not.toHaveBeenCalled()
    })

    it('没有 chunks 时应该返回 false', async () => {
      vi.mocked(getEmbeddingConfig).mockReturnValue(createMockConfig(true))
      vi.mocked(getNoteChunks).mockReturnValue([])

      const result = await service.buildEmbeddingForNote('note1')

      expect(result).toBe(false)
      expect(getEmbeddings).not.toHaveBeenCalled()
    })

    it('embedding API 失败时应该更新错误状态', async () => {
      const existingChunks = [createMockChunk('note1', 0, '测试内容')]
      vi.mocked(getNoteChunks).mockReturnValue(existingChunks)
      vi.mocked(getEmbeddings).mockRejectedValue(new Error('API Error'))
      vi.mocked(getEmbeddingConfig).mockReturnValue(createMockConfig(true))
      vi.mocked(getNoteIndexStatus).mockReturnValue(
        createMockStatus('note1', { ftsStatus: 'indexed', embeddingStatus: 'none' })
      )

      const result = await service.buildEmbeddingForNote('note1')

      expect(result).toBe(false)
      expect(updateNoteIndexStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          embeddingStatus: 'error',
          errorMessage: 'API Error'
        })
      )
    })
  })

  describe('NoteIndexStatus 状态管理', () => {
    it('ftsStatus 和 embeddingStatus 应该独立管理', () => {
      // FTS only 状态
      const ftsOnlyStatus = createMockStatus('note1', {
        ftsStatus: 'indexed',
        embeddingStatus: 'none'
      })
      expect(ftsOnlyStatus.ftsStatus).toBe('indexed')
      expect(ftsOnlyStatus.embeddingStatus).toBe('none')

      // Full index 状态
      const fullStatus = createMockStatus('note1', {
        ftsStatus: 'indexed',
        embeddingStatus: 'indexed'
      })
      expect(fullStatus.ftsStatus).toBe('indexed')
      expect(fullStatus.embeddingStatus).toBe('indexed')

      // Error 状态
      const errorStatus = createMockStatus('note1', {
        ftsStatus: 'indexed',
        embeddingStatus: 'error'
      })
      expect(errorStatus.ftsStatus).toBe('indexed')
      expect(errorStatus.embeddingStatus).toBe('error')
    })
  })

  describe('local note behavior', () => {
    it('triggers summary for local note ids on no-change check when local summary is missing', async () => {
      vi.mocked(getEmbeddingConfig).mockReturnValue(createMockConfig(true))
      const content = createTiptapContent(LONG_TEXT)
      const status = createMockStatus('local:nb-local:foo.md', {
        contentHash: computeContentHash(LONG_TEXT),
        embeddingStatus: 'indexed',
      })
      vi.mocked(getNoteIndexStatus).mockReturnValue(status)

      const result = await service.checkAndIndex('local:nb-local:foo.md', 'nb-local', content)

      expect(result).toBe(false)
      expect(getLocalNoteSummaryInfo).toHaveBeenCalledWith({
        notebook_id: 'nb-local',
        relative_path: 'foo.md',
      })
      expect(getNoteSummaryInfo).not.toHaveBeenCalled()
      expect(generateSummary).toHaveBeenCalledWith('local:nb-local:foo.md')
    })

    it('triggers summary for local uuid note ids on no-change check when local summary is missing', async () => {
      vi.mocked(getEmbeddingConfig).mockReturnValue(createMockConfig(true))
      vi.mocked(getLocalNoteIdentityByUid).mockReturnValue({
        note_uid: 'ef84fb2a-8f5e-4e21-bd24-e1d6f2627d53',
        notebook_id: 'nb-local',
        relative_path: 'foo.md',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      })
      const content = createTiptapContent(LONG_TEXT)
      const status = createMockStatus('ef84fb2a-8f5e-4e21-bd24-e1d6f2627d53', {
        contentHash: computeContentHash(LONG_TEXT),
        embeddingStatus: 'indexed',
      })
      vi.mocked(getNoteIndexStatus).mockReturnValue(status)

      const result = await service.checkAndIndex('ef84fb2a-8f5e-4e21-bd24-e1d6f2627d53', 'nb-local', content)

      expect(result).toBe(false)
      expect(getLocalNoteSummaryInfo).toHaveBeenCalledWith({
        notebook_id: 'nb-local',
        relative_path: 'foo.md',
      })
      expect(getNoteSummaryInfo).not.toHaveBeenCalled()
      expect(generateSummary).toHaveBeenCalledWith('ef84fb2a-8f5e-4e21-bd24-e1d6f2627d53')
    })
  })
})

describe('导入后索引场景', () => {
  let service: IndexingService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new IndexingService()
    service.start()
  })

  it('buildEmbedding=false 时只建立 FTS', async () => {
    const mockChunks = [createMockChunk('note1', 0, '测试内容')]
    vi.mocked(chunkNote).mockReturnValue(mockChunks)

    const content = createTiptapContent(LONG_TEXT)

    // 模拟导入场景：buildEmbedding=false，调用 indexNoteFtsOnly
    const result = await service.indexNoteFtsOnly('note1', 'nb1', content)

    expect(result).toBe(true)
    expect(getEmbeddings).not.toHaveBeenCalled()
    expect(updateNoteIndexStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        ftsStatus: 'indexed',
        embeddingStatus: 'none'
      })
    )
  })

  it('buildEmbedding=true + embedding 启用时建立完整索引', async () => {
    vi.mocked(getEmbeddingConfig).mockReturnValue(createMockConfig(true))
    const mockChunks = [createMockChunk('note1', 0, '测试内容')]
    vi.mocked(chunkNote).mockReturnValue(mockChunks)
    vi.mocked(getEmbeddings).mockResolvedValue([[0.1, 0.2, 0.3]])
    vi.mocked(getNoteIndexStatus).mockReturnValue(null)

    const content = createTiptapContent(LONG_TEXT)

    // 模拟导入场景：buildEmbedding=true，调用 indexNoteFull
    const result = await service.indexNoteFull('note1', 'nb1', content)

    expect(result).toBe(true)
    expect(getEmbeddings).toHaveBeenCalled()
    expect(insertEmbeddings).toHaveBeenCalled()
    expect(updateNoteIndexStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        ftsStatus: 'indexed',
        embeddingStatus: 'indexed'
      })
    )
  })

  it('buildEmbedding=true + embedding 禁用时返回 false', async () => {
    vi.mocked(getEmbeddingConfig).mockReturnValue(createMockConfig(false))

    const content = createTiptapContent('这是一段足够长的测试内容')

    // 当 embedding 禁用时，indexNoteFull 返回 false
    const result = await service.indexNoteFull('note1', 'nb1', content)

    expect(result).toBe(false)
  })
})
