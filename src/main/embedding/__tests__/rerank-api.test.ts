import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  setRerankConfig,
  getRerankConfig,
  isRerankAvailable,
  callRerankAPI,
  testRerankAPI
} from '../rerank-api'

describe('Rerank API', () => {
  beforeEach(() => {
    // Reset config before each test
    setRerankConfig(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('setRerankConfig / getRerankConfig', () => {
    it('should set and get config', () => {
      const config = {
        apiUrl: 'https://api.example.com/rerank',
        apiKey: 'test-key',
        modelName: 'rerank-model'
      }

      setRerankConfig(config)
      expect(getRerankConfig()).toEqual(config)
    })

    it('should return null when not configured', () => {
      expect(getRerankConfig()).toBeNull()
    })
  })

  describe('isRerankAvailable', () => {
    it('should return false when not configured', () => {
      expect(isRerankAvailable()).toBe(false)
    })

    it('should return false when config is incomplete', () => {
      setRerankConfig({
        apiUrl: 'https://api.example.com/rerank',
        apiKey: '',
        modelName: 'model'
      })
      expect(isRerankAvailable()).toBe(false)
    })

    it('should return true when fully configured', () => {
      setRerankConfig({
        apiUrl: 'https://api.example.com/rerank',
        apiKey: 'test-key',
        modelName: 'rerank-model'
      })
      expect(isRerankAvailable()).toBe(true)
    })
  })

  describe('callRerankAPI', () => {
    it('should return original order when not configured', async () => {
      const documents = [
        { id: 'doc1', text: 'first document', score: 0.8 },
        { id: 'doc2', text: 'second document', score: 0.7 }
      ]

      const result = await callRerankAPI('test query', documents)

      expect(result).toEqual([
        { id: 'doc1', score: 0.8 },
        { id: 'doc2', score: 0.7 }
      ])
    })

    it('should return empty array for empty documents', async () => {
      setRerankConfig({
        apiUrl: 'https://api.example.com/rerank',
        apiKey: 'test-key',
        modelName: 'model'
      })

      const result = await callRerankAPI('test query', [])
      expect(result).toEqual([])
    })

    it('should call API and return reranked results', async () => {
      setRerankConfig({
        apiUrl: 'https://api.example.com/rerank',
        apiKey: 'test-key',
        modelName: 'rerank-model'
      })

      const mockResponse = {
        results: [
          { index: 1, relevance_score: 0.95 },
          { index: 0, relevance_score: 0.85 }
        ]
      }

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      })

      const documents = [
        { id: 'doc1', text: 'first document', score: 0.8 },
        { id: 'doc2', text: 'second document', score: 0.7 }
      ]

      const result = await callRerankAPI('test query', documents)

      // Should be sorted by relevance_score descending
      expect(result).toEqual([
        { id: 'doc2', score: 0.95 },
        { id: 'doc1', score: 0.85 }
      ])

      // Verify fetch was called correctly
      expect(fetch).toHaveBeenCalledWith(
        'https://api.example.com/rerank',
        expect.objectContaining({
          method: 'POST',
          headers: {
            Authorization: 'Bearer test-key',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'rerank-model',
            query: 'test query',
            documents: ['first document', 'second document'],
            top_n: 2,
            return_documents: false
          })
        })
      )
    })

    it('should handle API error gracefully', async () => {
      setRerankConfig({
        apiUrl: 'https://api.example.com/rerank',
        apiKey: 'test-key',
        modelName: 'model'
      })

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error')
      })

      const documents = [
        { id: 'doc1', text: 'first', score: 0.8 },
        { id: 'doc2', text: 'second', score: 0.7 }
      ]

      const result = await callRerankAPI('test', documents)

      // Should return original order on error
      expect(result).toEqual([
        { id: 'doc1', score: 0.8 },
        { id: 'doc2', score: 0.7 }
      ])
    })

    it('should handle network error gracefully', async () => {
      setRerankConfig({
        apiUrl: 'https://api.example.com/rerank',
        apiKey: 'test-key',
        modelName: 'model'
      })

      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

      const documents = [
        { id: 'doc1', text: 'first', score: 0.8 }
      ]

      const result = await callRerankAPI('test', documents)

      expect(result).toEqual([{ id: 'doc1', score: 0.8 }])
    })
  })

  describe('testRerankAPI', () => {
    it('should return error when not configured', async () => {
      const result = await testRerankAPI()
      expect(result.success).toBe(false)
      expect(result.message).toContain('not configured')
    })

    it('should return success when API works', async () => {
      const config = {
        apiUrl: 'https://api.example.com/rerank',
        apiKey: 'test-key',
        modelName: 'rerank-model'
      }

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [
              { index: 0, relevance_score: 0.9 },
              { index: 1, relevance_score: 0.8 }
            ]
          })
      })

      const result = await testRerankAPI(config)
      expect(result.success).toBe(true)
      expect(result.message).toContain('working')
    })
  })
})
