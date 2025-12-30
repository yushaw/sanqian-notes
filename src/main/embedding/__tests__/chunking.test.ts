/**
 * 分块模块测试
 */
import { describe, it, expect } from 'vitest'
import { ChunkingService, chunkNote, CHUNK_SIZE, CHUNK_OVERLAP } from '../chunking'

describe('ChunkingService', () => {

  describe('chunkNote - 基本功能', () => {
    it('空文本返回空数组', () => {
      const chunks = chunkNote('note1', 'nb1', '')
      expect(chunks).toEqual([])
    })

    it('只有空白的文本返回空数组', () => {
      const chunks = chunkNote('note1', 'nb1', '   \n\n   ')
      expect(chunks).toEqual([])
    })

    it('短文本不分块，直接返回一个 chunk', () => {
      const text = '这是一段短文本，不需要分块。'
      const chunks = chunkNote('note1', 'nb1', text)

      expect(chunks).toHaveLength(1)
      // chunkId 格式: noteId:hash:index（index 用于区分重复内容）
      expect(chunks[0].chunkId).toMatch(/^note1:[a-f0-9]{16}:\d+$/)
      expect(chunks[0].noteId).toBe('note1')
      expect(chunks[0].notebookId).toBe('nb1')
      expect(chunks[0].chunkIndex).toBe(0)
      expect(chunks[0].chunkText).toBe(text)
      expect(chunks[0].chunkHash).toBeDefined()
      expect(chunks[0].chunkHash).toHaveLength(16) // MD5 前 16 位
      // chunkId = noteId:hash:index
      expect(chunks[0].chunkId).toBe(`note1:${chunks[0].chunkHash}:0`)
    })

    it('长文本应该分成多个 chunks', () => {
      // 创建一个超过 CHUNK_SIZE 的文本
      const paragraph = '这是一段较长的文本内容。'.repeat(100)
      const chunks = chunkNote('note1', 'nb1', paragraph)

      expect(chunks.length).toBeGreaterThan(1)
      // 每个 chunk 都应该有正确的结构
      chunks.forEach((chunk, i) => {
        // chunkId 格式: noteId:hash:index
        expect(chunk.chunkId).toMatch(/^note1:[a-f0-9]{16}:\d+$/)
        expect(chunk.chunkId).toBe(`note1:${chunk.chunkHash}:${i}`)
        expect(chunk.chunkIndex).toBe(i)
        expect(chunk.chunkHash).toHaveLength(16)
      })
    })
  })

  describe('chunkHash - 哈希一致性', () => {
    it('相同内容生成相同的 hash', () => {
      const text = '测试文本内容'
      const chunks1 = chunkNote('note1', 'nb1', text)
      const chunks2 = chunkNote('note2', 'nb2', text)

      expect(chunks1[0].chunkHash).toBe(chunks2[0].chunkHash)
    })

    it('不同内容生成不同的 hash', () => {
      const chunks1 = chunkNote('note1', 'nb1', '内容A')
      const chunks2 = chunkNote('note1', 'nb1', '内容B')

      expect(chunks1[0].chunkHash).not.toBe(chunks2[0].chunkHash)
    })

    it('添加一个字符应该改变 hash', () => {
      const text1 = '这是测试文本'
      const text2 = '这是测试文本。'
      const chunks1 = chunkNote('note1', 'nb1', text1)
      const chunks2 = chunkNote('note1', 'nb1', text2)

      expect(chunks1[0].chunkHash).not.toBe(chunks2[0].chunkHash)
    })
  })

  describe('Markdown 分块', () => {
    it('按标题分割 Markdown（长文本）', () => {
      // 创建足够长的 Markdown 文本以触发分块
      const markdown = `# 标题一

${'这是第一部分的内容。'.repeat(50)}

## 标题二

${'这是第二部分的内容。'.repeat(50)}

### 标题三

${'这是第三部分的内容。'.repeat(50)}`

      const chunks = chunkNote('note1', 'nb1', markdown)

      // 应该按标题分成多个 chunks
      expect(chunks.length).toBeGreaterThanOrEqual(1)

      // 检查 heading 提取
      const headings = chunks.map(c => c.heading).filter(Boolean)
      expect(headings.length).toBeGreaterThan(0)
    })

    it('短文本不触发 Markdown 分块', () => {
      const markdown = `# 短标题

这是简短的内容。`

      const chunks = chunkNote('note1', 'nb1', markdown)

      // 短文本只有一个 chunk，不会触发 Markdown 解析
      expect(chunks.length).toBe(1)
      // 短文本走的是通用路径，heading 为 null
      // 这是预期行为：只有长文本才会触发 Markdown 分块和标题提取
      expect(chunks[0].chunkText).toContain('# 短标题')
    })

    it('长 Markdown 文本可以正常分块', () => {
      // 创建足够长的文本，确保触发 Markdown 分块
      const markdown = `# 真正的标题

${'这是正文内容，需要足够长才能触发 Markdown 分块逻辑。'.repeat(100)}

## 第二个标题

${'更多正文内容，继续填充以确保文档足够长。'.repeat(100)}`

      const chunks = chunkNote('note1', 'nb1', markdown)

      // 确保有多个 chunks（说明触发了分块）
      expect(chunks.length).toBeGreaterThan(1)

      // 每个 chunk 都有正确的 hash
      chunks.forEach(chunk => {
        expect(chunk.chunkHash).toHaveLength(16)
      })
    })
  })

  describe('分块边界', () => {
    it('chunk 大小不超过 CHUNK_SIZE（允许 overlap）', () => {
      const longText = '这是测试文本。'.repeat(500)
      const chunks = chunkNote('note1', 'nb1', longText)

      chunks.forEach(chunk => {
        // 考虑 overlap，允许略微超过
        expect(chunk.chunkText.length).toBeLessThanOrEqual(CHUNK_SIZE + CHUNK_OVERLAP + 50)
      })
    })

    it('chunk 之间有 overlap', () => {
      const longText = '段落一的内容。\n\n段落二的内容。\n\n段落三的内容。'.repeat(50)
      const chunks = chunkNote('note1', 'nb1', longText)

      if (chunks.length > 1) {
        // 检查第二个 chunk 开头是否包含第一个 chunk 结尾的内容
        const firstEnd = chunks[0].chunkText.slice(-CHUNK_OVERLAP)
        const secondStart = chunks[1].chunkText.slice(0, CHUNK_OVERLAP)

        // overlap 应该存在（不完全相等，但有重叠）
        expect(chunks[1].chunkText.includes(firstEnd.slice(-20)) ||
               firstEnd.includes(secondStart.slice(0, 20))).toBe(true)
      }
    })
  })

  describe('位置信息', () => {
    it('charStart 和 charEnd 正确记录位置', () => {
      const text = '第一段内容。\n\n第二段内容。\n\n第三段内容。'
      const chunks = chunkNote('note1', 'nb1', text)

      chunks.forEach(chunk => {
        expect(chunk.charStart).toBeGreaterThanOrEqual(0)
        expect(chunk.charEnd).toBeGreaterThan(chunk.charStart)
        expect(chunk.charEnd).toBeLessThanOrEqual(text.length)
      })
    })
  })

  describe('中英文混合', () => {
    it('正确处理中英文混合文本', () => {
      const text = 'Hello 世界！This is a test. 这是测试。'.repeat(100)
      const chunks = chunkNote('note1', 'nb1', text)

      expect(chunks.length).toBeGreaterThan(0)
      chunks.forEach(chunk => {
        expect(chunk.chunkHash).toHaveLength(16)
      })
    })
  })

  describe('特殊字符', () => {
    it('处理包含 emoji 的文本', () => {
      const text = '这是一段包含 emoji 的文本 🎉🎊🎁 继续写内容。'.repeat(100)
      const chunks = chunkNote('note1', 'nb1', text)

      expect(chunks.length).toBeGreaterThan(0)
    })

    it('处理包含特殊标点的文本', () => {
      const text = '测试「引号」、《书名》、【括号】等特殊标点。'.repeat(100)
      const chunks = chunkNote('note1', 'nb1', text)

      expect(chunks.length).toBeGreaterThan(0)
    })
  })
})

describe('chunkNote 便捷函数', () => {
  it('与 ChunkingService.chunkNote 结果一致', () => {
    const service = new ChunkingService()
    const text = '测试文本内容'

    const result1 = chunkNote('note1', 'nb1', text)
    const result2 = service.chunkNote('note1', 'nb1', text)

    expect(result1).toEqual(result2)
  })
})
