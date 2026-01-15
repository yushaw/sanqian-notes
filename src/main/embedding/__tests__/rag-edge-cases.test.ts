/**
 * Edge-case tests for chunking + RAG utilities.
 */

import { describe, it, expect } from 'vitest'
import { ChunkingService } from '../chunking'
import {
  expandQuery,
  mergeOverlappingChunks,
  applyMMR,
  configureQueryRewrite,
  rewriteQuery,
  type SemanticSearchResult,
  type ConversationMessage
} from '../semantic-search'

function hasFullBlock(chunks: string[], block: string): boolean {
  return chunks.some((chunk) => chunk.includes(block))
}

describe('Query expansion edge cases', () => {
  it('removes question words and keeps core CN keyword', () => {
    const result = expandQuery('什么是向量数据库？')
    expect(result.cleaned).toContain('向量数据库')
    expect(result.cleaned).not.toContain('什么是')
  })

  it('removes question phrases in EN', () => {
    const result = expandQuery('What is vector database?')
    expect(result.cleaned).toContain('vector database')
    expect(result.cleaned.toLowerCase()).not.toContain('what is')
  })

  it('extracts quoted phrases and removes them from cleaned query', () => {
    const result = expandQuery('搜索 "向量 数据库" 相关资料')
    expect(result.quotedPhrases).toEqual(['向量 数据库'])
    expect(result.cleaned).not.toContain('向量 数据库')
  })

  it('falls back to original when cleaned is empty', () => {
    const result = expandQuery('什么是？')
    expect(result.cleaned).toBe('什么是？')
  })
})

describe('Chunking edge cases', () => {
  const chunkingService = new ChunkingService(120, 20)

  it('keeps a code block intact even when it exceeds chunk size', () => {
    const codeBlock = [
      '```ts',
      'const a = 1;',
      'const b = 2;',
      'const c = a + b;',
      'console.log(c);',
      '```'
    ].join('\n')

    const content = `# Demo\n\n${codeBlock}\n\nEnd.`
    const chunks = chunkingService.chunkNote('n1', 'nb1', content).map((c) => c.chunkText)

    expect(hasFullBlock(chunks, codeBlock)).toBe(true)
  })

  it('keeps a table intact as a protected unit', () => {
    const tableBlock = [
      '| Name | Score |',
      '| --- | --- |',
      '| A | 90 |',
      '| B | 85 |'
    ].join('\n')

    const content = `Intro\n\n${tableBlock}\n\nSummary.`
    const chunks = chunkingService.chunkNote('n2', 'nb2', content).map((c) => c.chunkText)

    expect(hasFullBlock(chunks, tableBlock)).toBe(true)
  })

  it('keeps a math block intact', () => {
    const mathBlock = ['$$', 'E = mc^2', '$$'].join('\n')
    const content = `Math:\n\n${mathBlock}\n\nDone.`
    const chunks = chunkingService.chunkNote('n3', 'nb3', content).map((c) => c.chunkText)

    expect(hasFullBlock(chunks, mathBlock)).toBe(true)
  })

  it('does not treat table-like lines inside code block as a table', () => {
    const codeBlock = [
      '```md',
      '| x | y |',
      '| --- | --- |',
      '| 1 | 2 |',
      '```'
    ].join('\n')

    const content = `Intro\n\n${codeBlock}\n\nAfter.`
    const chunks = chunkingService.chunkNote('n4', 'nb4', content).map((c) => c.chunkText)

    expect(hasFullBlock(chunks, codeBlock)).toBe(true)
  })
})

describe('Chunk merge edge cases', () => {
  it('merges overlapping chunks within the same note', () => {
    const merged = mergeOverlappingChunks([
      {
        chunkId: 'c1',
        noteId: 'n1',
        notebookId: 'nb',
        chunkText: 'Hello world, this is the first chunk.',
        score: 0.9,
        charStart: 0,
        charEnd: 38,
        chunkIndex: 0
      },
      {
        chunkId: 'c2',
        noteId: 'n1',
        notebookId: 'nb',
        chunkText: 'first chunk. And this continues.',
        score: 0.8,
        charStart: 25,
        charEnd: 57,
        chunkIndex: 1
      }
    ])

    expect(merged.length).toBe(1)
    expect(merged[0].charStart).toBe(0)
    expect(merged[0].charEnd).toBe(57)
  })

  it('does not merge chunks from different notes', () => {
    const merged = mergeOverlappingChunks([
      {
        chunkId: 'c1',
        noteId: 'n1',
        notebookId: 'nb',
        chunkText: 'Note A',
        score: 0.7,
        charStart: 0,
        charEnd: 6,
        chunkIndex: 0
      },
      {
        chunkId: 'c2',
        noteId: 'n2',
        notebookId: 'nb',
        chunkText: 'Note B',
        score: 0.6,
        charStart: 0,
        charEnd: 6,
        chunkIndex: 0
      }
    ])

    expect(merged.length).toBe(2)
  })

  it('does not merge when gap exceeds threshold', () => {
    const merged = mergeOverlappingChunks([
      {
        chunkId: 'c1',
        noteId: 'n1',
        notebookId: 'nb',
        chunkText: 'Chunk 1',
        score: 0.7,
        charStart: 0,
        charEnd: 7,
        chunkIndex: 0
      },
      {
        chunkId: 'c2',
        noteId: 'n1',
        notebookId: 'nb',
        chunkText: 'Chunk 2',
        score: 0.6,
        charStart: 200,
        charEnd: 207,
        chunkIndex: 1
      }
    ])

    expect(merged.length).toBe(2)
  })
})

describe('MMR edge cases', () => {
  it('selects diverse results when texts are very similar', () => {
    const results: SemanticSearchResult[] = [
      {
        noteId: 'n1',
        notebookId: 'nb',
        score: 0.95,
        matchedChunks: [
          { chunkId: 'c1', chunkText: 'machine learning is great', score: 0.95, charStart: 0, charEnd: 28, chunkIndex: 0 }
        ]
      },
      {
        noteId: 'n2',
        notebookId: 'nb',
        score: 0.93,
        matchedChunks: [
          { chunkId: 'c2', chunkText: 'machine learning is wonderful', score: 0.93, charStart: 0, charEnd: 33, chunkIndex: 0 }
        ]
      },
      {
        noteId: 'n3',
        notebookId: 'nb',
        score: 0.90,
        matchedChunks: [
          { chunkId: 'c3', chunkText: 'deep neural networks', score: 0.90, charStart: 0, charEnd: 20, chunkIndex: 0 }
        ]
      }
    ]

    const selected = applyMMR(results, 0.7, 2)
    const selectedIds = selected.map((r) => r.noteId)

    expect(selectedIds).toContain('n3')
  })
})

describe('Query rewrite edge cases', () => {
  it('returns original query when rewrite is disabled', async () => {
    configureQueryRewrite({ enabled: false })
    const rewritten = await rewriteQuery('hello', [])
    expect(rewritten).toBe('hello')
  })

  it('rewrites query when history is provided', async () => {
    configureQueryRewrite({
      enabled: true,
      rewriteFn: async (query: string, history: ConversationMessage[]) => {
        if (history.some((m) => m.content.includes('React'))) {
          return `${query} React`
        }
        return query
      }
    })

    const history: ConversationMessage[] = [
      { role: 'user', content: 'What is React?' },
      { role: 'assistant', content: 'React is a UI library.' }
    ]

    const rewritten = await rewriteQuery('performance tips', history)
    expect(rewritten).toBe('performance tips React')
  })
})
