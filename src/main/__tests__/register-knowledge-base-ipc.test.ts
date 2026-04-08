import { describe, expect, it, vi } from 'vitest'
import { EMBEDDING_MAX_DIMENSIONS } from '../embedding/types'
import type { EmbeddingConfig } from '../embedding/types'
import type { KnowledgeBaseIpcDeps } from '../ipc/register-knowledge-base-ipc'
import { registerKnowledgeBaseIpc } from '../ipc/register-knowledge-base-ipc'

type Handler = (...args: unknown[]) => unknown

function createIpcMainLike() {
  const channels = new Map<string, Handler>()
  return {
    channels,
    ipcMainLike: {
      handle: vi.fn((channel: string, listener: Handler) => {
        channels.set(channel, listener)
      }),
    },
  }
}

const BASE_CONFIG: EmbeddingConfig = {
  enabled: true,
  source: 'custom',
  apiType: 'openai',
  apiUrl: 'https://api.openai.com/v1/embeddings',
  apiKey: 'sk-test',
  modelName: 'text-embedding-3-small',
  dimensions: 1536,
}

function createDeps(overrides: Partial<KnowledgeBaseIpcDeps> = {}): KnowledgeBaseIpcDeps {
  return {
    getEmbeddingConfig: vi.fn(() => BASE_CONFIG),
    setEmbeddingConfig: vi.fn(() => ({ indexCleared: false, modelChanged: false })),
    fetchEmbeddingConfigFromSanqian: vi.fn(async () => ({ available: false })),
    fetchRerankConfigFromSanqian: vi.fn(async () => ({ available: false })),
    getDimensionsForModel: vi.fn(() => 1536),
    testEmbeddingAPI: vi.fn(async () => ({ success: true, dimensions: 1536 })),
    getIndexStats: vi.fn(() => ({ totalChunks: 0, totalEmbeddings: 0, indexedNotes: 0, pendingNotes: 0, errorNotes: 0 })),
    getLastIndexedTime: vi.fn(() => null),
    cancelPendingLocalNotebookIndexSync: vi.fn(),
    clearAllIndexData: vi.fn(),
    getQueueStatus: vi.fn(() => ({ pending: 0, queue: 0, processing: false })),
    triggerFullKnowledgeBaseRebuild: vi.fn(() => ({ scheduled: true, total: 0 })),
    semanticSearch: vi.fn(async () => [{ noteId: 'n1' }]),
    hybridSearch: vi.fn(async () => [{ noteId: 'n2' }]),
    ...overrides,
  }
}

describe('register-knowledge-base-ipc', () => {
  it('registers knowledge base channels', () => {
    const { channels, ipcMainLike } = createIpcMainLike()
    registerKnowledgeBaseIpc(ipcMainLike, createDeps())

    expect(channels.has('knowledgeBase:setConfig')).toBe(true)
    expect(channels.has('knowledgeBase:testAPI')).toBe(true)
    expect(channels.has('knowledgeBase:semanticSearch')).toBe(true)
    expect(channels.has('knowledgeBase:hybridSearch')).toBe(true)
  })

  it('merges partial config before setConfig', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerKnowledgeBaseIpc(ipcMainLike, deps)

    const handler = channels.get('knowledgeBase:setConfig')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, { source: 'sanqian', dimensions: 2048 })).resolves.toEqual({
      success: true,
      indexCleared: false,
      modelChanged: false,
    })
    expect(deps.setEmbeddingConfig).toHaveBeenCalledWith({
      ...BASE_CONFIG,
      source: 'sanqian',
      dimensions: 2048,
    })
  })

  it('rejects invalid knowledgeBase:setConfig payload', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerKnowledgeBaseIpc(ipcMainLike, deps)

    const handler = channels.get('knowledgeBase:setConfig')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, { source: 'unknown' })).rejects.toThrow('knowledgeBase:setConfig payload is invalid')
    expect(deps.setEmbeddingConfig).not.toHaveBeenCalled()
  })

  it('rejects out-of-range dimensions in knowledgeBase:setConfig payload', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerKnowledgeBaseIpc(ipcMainLike, deps)

    const handler = channels.get('knowledgeBase:setConfig')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, { dimensions: EMBEDDING_MAX_DIMENSIONS + 1 })).rejects.toThrow(
      'knowledgeBase:setConfig payload is invalid'
    )
    expect(deps.setEmbeddingConfig).not.toHaveBeenCalled()
  })

  it('rejects oversized string fields in knowledgeBase:setConfig payload', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerKnowledgeBaseIpc(ipcMainLike, deps)

    const handler = channels.get('knowledgeBase:setConfig')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, { apiUrl: 'x'.repeat(4097) })).rejects.toThrow('knowledgeBase:setConfig payload is invalid')
    await expect(handler({}, { modelName: 'm'.repeat(257) })).rejects.toThrow('knowledgeBase:setConfig payload is invalid')
    expect(deps.setEmbeddingConfig).not.toHaveBeenCalled()
  })

  it('fails closed for invalid knowledgeBase:testAPI payload', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerKnowledgeBaseIpc(ipcMainLike, deps)

    const handler = channels.get('knowledgeBase:testAPI')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, { dimensions: -1 })).resolves.toEqual({
      success: false,
      error: 'Invalid config payload',
    })
    await expect(handler({}, { dimensions: EMBEDDING_MAX_DIMENSIONS + 1 })).resolves.toEqual({
      success: false,
      error: 'Invalid config payload',
    })
    expect(deps.testEmbeddingAPI).not.toHaveBeenCalled()
  })

  it('fails closed for invalid semantic search payload', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerKnowledgeBaseIpc(ipcMainLike, deps)

    const handler = channels.get('knowledgeBase:semanticSearch')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, '', { limit: 10 })).resolves.toEqual([])
    await expect(handler({}, 'query', { limit: 0 })).resolves.toEqual([])
    await expect(handler({}, 'q'.repeat(10001), { limit: 10 })).resolves.toEqual([])
    await expect(handler({}, 'query', { notebookId: 'n'.repeat(1025) })).resolves.toEqual([])
    expect(deps.semanticSearch).not.toHaveBeenCalled()
  })

  it('passes validated semantic search payload', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerKnowledgeBaseIpc(ipcMainLike, deps)

    const handler = channels.get('knowledgeBase:semanticSearch')
    expect(handler).toBeDefined()
    if (!handler) return

    await handler({}, '  query  ', { limit: 5, notebookId: 'nb-1' })
    expect(deps.semanticSearch).toHaveBeenCalledWith('query', { limit: 5, notebookId: 'nb-1' })
  })

  it('caps semantic search limit to bounded maximum', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerKnowledgeBaseIpc(ipcMainLike, deps)

    const handler = channels.get('knowledgeBase:semanticSearch')
    expect(handler).toBeDefined()
    if (!handler) return

    await handler({}, 'query', { limit: 9999, notebookId: 'nb-1' })
    expect(deps.semanticSearch).toHaveBeenCalledWith('query', { limit: 100, notebookId: 'nb-1' })
  })

  it('fails closed for invalid hybrid search payload', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerKnowledgeBaseIpc(ipcMainLike, deps)

    const handler = channels.get('knowledgeBase:hybridSearch')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, 'query', { filter: { notebookId: '' } })).resolves.toEqual([])
    await expect(handler({}, 'query', { filter: { viewType: 'archived' } })).resolves.toEqual([])
    await expect(handler({}, 'q'.repeat(10001), { limit: 5 })).resolves.toEqual([])
    expect(deps.hybridSearch).not.toHaveBeenCalled()
  })

  it('passes validated hybrid search payload', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerKnowledgeBaseIpc(ipcMainLike, deps)

    const handler = channels.get('knowledgeBase:hybridSearch')
    expect(handler).toBeDefined()
    if (!handler) return

    await handler({}, 'query', { limit: 7, filter: { notebookId: 'nb-1', viewType: 'all' } })
    expect(deps.hybridSearch).toHaveBeenCalledWith('query', {
      limit: 7,
      filter: { notebookId: 'nb-1', viewType: 'all' },
    })
  })

  it('caps hybrid search limit to bounded maximum', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerKnowledgeBaseIpc(ipcMainLike, deps)

    const handler = channels.get('knowledgeBase:hybridSearch')
    expect(handler).toBeDefined()
    if (!handler) return

    await handler({}, 'query', { limit: 2048, filter: { notebookId: 'nb-1', viewType: 'all' } })
    expect(deps.hybridSearch).toHaveBeenCalledWith('query', {
      limit: 100,
      filter: { notebookId: 'nb-1', viewType: 'all' },
    })
  })
})
