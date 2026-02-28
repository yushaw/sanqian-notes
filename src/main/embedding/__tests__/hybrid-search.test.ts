/**
 * Hybrid search behavior tests with mocked retrieval.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../api', () => ({
  getEmbedding: vi.fn()
}))

vi.mock('../database', () => ({
  getEmbeddingConfig: vi.fn(),
  getNoteIndexStatus: vi.fn(),
  searchEmbeddings: vi.fn(),
  searchEmbeddingsInNotebook: vi.fn(),
  searchKeyword: vi.fn()
}))

vi.mock('../../database', () => ({
  getNotesByIds: vi.fn(),
  getLocalNoteIdentityByUid: vi.fn(),
  getLocalNoteMetadata: vi.fn(),
}))

import { getEmbedding } from '../api'
import {
  getEmbeddingConfig,
  getNoteIndexStatus,
  searchEmbeddings,
  searchEmbeddingsInNotebook,
  searchKeyword
} from '../database'
import { getLocalNoteIdentityByUid, getLocalNoteMetadata, getNotesByIds } from '../../database'
import { configureQueryRewrite, expandQuery, hybridSearch } from '../semantic-search'

type MockVectorRow = {
  chunkId: string
  noteId: string
  notebookId: string
  chunkText: string
  distance: number
  score: number
  charStart: number
  charEnd: number
  chunkIndex: number
}

describe('hybridSearch', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(getEmbeddingConfig).mockReturnValue({
      enabled: true,
      source: 'custom',
      apiType: 'custom',
      apiUrl: '',
      apiKey: '',
      modelName: 'test',
      dimensions: 3
    })
    vi.mocked(getNoteIndexStatus).mockReturnValue(null)
    vi.mocked(searchEmbeddingsInNotebook).mockReturnValue([])
    vi.mocked(getNotesByIds).mockReturnValue([])
    vi.mocked(getLocalNoteIdentityByUid).mockReturnValue(null)
    vi.mocked(getLocalNoteMetadata).mockReturnValue(null)
  })

  it('uses rewritten + cleaned query for embeddings', async () => {
    configureQueryRewrite({
      enabled: true,
      rewriteFn: async () => 'How to use vector database efficiently'
    })

    vi.mocked(getEmbedding).mockResolvedValue([0.1, 0.2, 0.3])
    vi.mocked(searchEmbeddings).mockReturnValue([])
    vi.mocked(searchKeyword).mockReturnValue([])

    await hybridSearch('What is vector database?', {
      conversationHistory: [{ role: 'user', content: 'prev' }]
    })

    const expected = expandQuery('How to use vector database efficiently').cleaned
    expect(getEmbedding).toHaveBeenCalledWith(expected)
  })

  it('uses quoted phrases combined with cleaned query for keyword search', async () => {
    vi.mocked(getEmbedding).mockResolvedValue([0.1, 0.2, 0.3])
    vi.mocked(searchEmbeddings).mockReturnValue([])
    vi.mocked(searchKeyword).mockReturnValue([])

    await hybridSearch('search "vector database" performance')

    // Quoted phrases + cleaned query (without quotes) for better recall
    expect(searchKeyword).toHaveBeenCalledWith(
      'vector database search performance',
      expect.any(Number),
      undefined
    )
  })

  it('returns empty when vector-only results are below threshold', async () => {
    vi.mocked(getEmbedding).mockResolvedValue([0.1, 0.2, 0.3])

    const lowScore: MockVectorRow[] = [
      {
        chunkId: 'c1',
        noteId: 'n1',
        notebookId: 'nb',
        chunkText: 'low relevance',
        distance: 10,
        score: 0.1,
        charStart: 0,
        charEnd: 12,
        chunkIndex: 0
      }
    ]

    vi.mocked(searchEmbeddings).mockReturnValue(lowScore)
    vi.mocked(searchKeyword).mockReturnValue([])

    const results = await hybridSearch('random query')
    expect(results).toEqual([])
  })

  it('aggregates multiple chunks for the same note', async () => {
    vi.mocked(getEmbedding).mockResolvedValue([0.1, 0.2, 0.3])

    const vectorRows: MockVectorRow[] = [
      {
        chunkId: 'c1',
        noteId: 'n1',
        notebookId: 'nb',
        chunkText: 'alpha',
        distance: 0.3,
        score: 0.9,
        charStart: 0,
        charEnd: 5,
        chunkIndex: 0
      },
      {
        chunkId: 'c2',
        noteId: 'n1',
        notebookId: 'nb',
        chunkText: 'beta',
        distance: 0.4,
        score: 0.85,
        charStart: 200, // Gap > 100 to avoid chunk merge
        charEnd: 204,
        chunkIndex: 1
      }
    ]

    const keywordRows = [
      {
        chunkId: 'c3',
        noteId: 'n2',
        notebookId: 'nb',
        chunkText: 'gamma',
        matchCount: 2,
        charStart: 0,
        charEnd: 5,
        chunkIndex: 0
      }
    ]

    vi.mocked(searchEmbeddings).mockReturnValue(vectorRows)
    vi.mocked(searchKeyword).mockReturnValue(keywordRows)

    const results = await hybridSearch('test query', { limit: 5 })
    const note1 = results.find((r) => r.noteId === 'n1')
    const note2 = results.find((r) => r.noteId === 'n2')

    expect(note1?.matchedChunks.length).toBe(2)
    expect(note2?.matchedChunks.length).toBe(1)
  })

  it('keeps local resource ids when filter viewType is all', async () => {
    vi.mocked(getEmbedding).mockResolvedValue([0.1, 0.2, 0.3])
    vi.mocked(searchEmbeddings).mockReturnValue([
      {
        chunkId: 'c1',
        noteId: 'local:nb-local:foo.md',
        notebookId: 'nb-local',
        chunkText: 'local result',
        distance: 0.2,
        score: 0.92,
        charStart: 0,
        charEnd: 12,
        chunkIndex: 0
      }
    ])
    vi.mocked(searchKeyword).mockReturnValue([])

    const results = await hybridSearch('local query', {
      filter: { viewType: 'all' }
    })
    expect(results.map((item) => item.noteId)).toContain('local:nb-local:foo.md')
  })

  it('drops unknown non-local ids when filter viewType is all', async () => {
    vi.mocked(getEmbedding).mockResolvedValue([0.1, 0.2, 0.3])
    vi.mocked(searchEmbeddings).mockReturnValue([
      {
        chunkId: 'c1',
        noteId: 'unknown-note-id',
        notebookId: 'nb',
        chunkText: 'unknown result',
        distance: 0.2,
        score: 0.92,
        charStart: 0,
        charEnd: 14,
        chunkIndex: 0
      }
    ])
    vi.mocked(searchKeyword).mockReturnValue([])

    const results = await hybridSearch('unknown query', {
      filter: { viewType: 'all' }
    })
    expect(results).toEqual([])
  })

  it('keeps local uuid ids when filter viewType is all', async () => {
    const localUid = 'ef84fb2a-8f5e-4e21-bd24-e1d6f2627d53'
    vi.mocked(getEmbedding).mockResolvedValue([0.1, 0.2, 0.3])
    vi.mocked(searchEmbeddings).mockReturnValue([
      {
        chunkId: 'c1',
        noteId: localUid,
        notebookId: 'nb-local',
        chunkText: 'local result',
        distance: 0.2,
        score: 0.92,
        charStart: 0,
        charEnd: 12,
        chunkIndex: 0
      }
    ])
    vi.mocked(searchKeyword).mockReturnValue([])
    vi.mocked(getLocalNoteIdentityByUid).mockReturnValue({
      note_uid: localUid,
      notebook_id: 'nb-local',
      relative_path: 'foo.md',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    })

    const results = await hybridSearch('local query', {
      filter: { viewType: 'all' }
    })
    expect(results.map((item) => item.noteId)).toContain(localUid)
  })
})
