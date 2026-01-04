/**
 * 索引服务测试
 *
 * 测试 chunk 级增量索引的核心逻辑
 */
import { describe, it, expect } from 'vitest'
import type { NoteChunk } from '../types'
import { computeContentHash } from '../utils'
import { diffChunks, extractTextFromTiptap } from '../indexing-service'

// 辅助函数：创建测试用的 NoteChunk
function createChunk(
  noteId: string,
  index: number,
  text: string,
  hash: string
): NoteChunk {
  return {
    chunkId: `${noteId}:${index}`,
    noteId,
    notebookId: 'nb1',
    chunkIndex: index,
    chunkText: text,
    chunkHash: hash,
    charStart: 0,
    charEnd: text.length,
    heading: null,
    createdAt: new Date().toISOString()
  }
}

describe('diffChunks - Chunk 级增量更新核心算法', () => {
  describe('基本场景', () => {
    it('空旧 chunks，全部新增', () => {
      const oldChunks: NoteChunk[] = []
      const newChunks = [
        createChunk('note1', 0, '内容A', 'hash_a'),
        createChunk('note1', 1, '内容B', 'hash_b')
      ]

      const result = diffChunks(oldChunks, newChunks)

      expect(result.toAdd).toHaveLength(2)
      expect(result.toDelete).toHaveLength(0)
      expect(result.unchanged).toHaveLength(0)
    })

    it('空新 chunks，全部删除', () => {
      const oldChunks = [
        createChunk('note1', 0, '内容A', 'hash_a'),
        createChunk('note1', 1, '内容B', 'hash_b')
      ]
      const newChunks: NoteChunk[] = []

      const result = diffChunks(oldChunks, newChunks)

      expect(result.toAdd).toHaveLength(0)
      expect(result.toDelete).toHaveLength(2)
      expect(result.unchanged).toHaveLength(0)
    })

    it('完全相同，全部 unchanged', () => {
      const oldChunks = [
        createChunk('note1', 0, '内容A', 'hash_a'),
        createChunk('note1', 1, '内容B', 'hash_b')
      ]
      const newChunks = [
        createChunk('note1', 0, '内容A', 'hash_a'),
        createChunk('note1', 1, '内容B', 'hash_b')
      ]

      const result = diffChunks(oldChunks, newChunks)

      expect(result.toAdd).toHaveLength(0)
      expect(result.toDelete).toHaveLength(0)
      expect(result.unchanged).toHaveLength(2)
    })

    it('完全不同，全部替换', () => {
      const oldChunks = [
        createChunk('note1', 0, '旧内容A', 'old_hash_a'),
        createChunk('note1', 1, '旧内容B', 'old_hash_b')
      ]
      const newChunks = [
        createChunk('note1', 0, '新内容A', 'new_hash_a'),
        createChunk('note1', 1, '新内容B', 'new_hash_b')
      ]

      const result = diffChunks(oldChunks, newChunks)

      expect(result.toAdd).toHaveLength(2)
      expect(result.toDelete).toHaveLength(2)
      expect(result.unchanged).toHaveLength(0)
    })
  })

  describe('部分变更场景', () => {
    it('只修改第一个 chunk', () => {
      const oldChunks = [
        createChunk('note1', 0, '旧内容', 'old_hash'),
        createChunk('note1', 1, '不变内容', 'same_hash')
      ]
      const newChunks = [
        createChunk('note1', 0, '新内容', 'new_hash'),
        createChunk('note1', 1, '不变内容', 'same_hash')
      ]

      const result = diffChunks(oldChunks, newChunks)

      expect(result.toAdd).toHaveLength(1)
      expect(result.toAdd[0].chunkHash).toBe('new_hash')
      expect(result.toDelete).toHaveLength(1)
      expect(result.toDelete[0].chunkHash).toBe('old_hash')
      expect(result.unchanged).toHaveLength(1)
      expect(result.unchanged[0].chunkHash).toBe('same_hash')
    })

    it('只修改最后一个 chunk', () => {
      const oldChunks = [
        createChunk('note1', 0, '不变A', 'hash_a'),
        createChunk('note1', 1, '不变B', 'hash_b'),
        createChunk('note1', 2, '旧内容', 'old_hash')
      ]
      const newChunks = [
        createChunk('note1', 0, '不变A', 'hash_a'),
        createChunk('note1', 1, '不变B', 'hash_b'),
        createChunk('note1', 2, '新内容', 'new_hash')
      ]

      const result = diffChunks(oldChunks, newChunks)

      expect(result.toAdd).toHaveLength(1)
      expect(result.toDelete).toHaveLength(1)
      expect(result.unchanged).toHaveLength(2)
    })

    it('在中间插入新 chunk', () => {
      const oldChunks = [
        createChunk('note1', 0, '内容A', 'hash_a'),
        createChunk('note1', 1, '内容C', 'hash_c')
      ]
      const newChunks = [
        createChunk('note1', 0, '内容A', 'hash_a'),
        createChunk('note1', 1, '内容B（新）', 'hash_b'),
        createChunk('note1', 2, '内容C', 'hash_c')
      ]

      const result = diffChunks(oldChunks, newChunks)

      expect(result.toAdd).toHaveLength(1)
      expect(result.toAdd[0].chunkHash).toBe('hash_b')
      expect(result.toDelete).toHaveLength(0)
      expect(result.unchanged).toHaveLength(2)
    })

    it('删除中间的 chunk', () => {
      const oldChunks = [
        createChunk('note1', 0, '内容A', 'hash_a'),
        createChunk('note1', 1, '内容B', 'hash_b'),
        createChunk('note1', 2, '内容C', 'hash_c')
      ]
      const newChunks = [
        createChunk('note1', 0, '内容A', 'hash_a'),
        createChunk('note1', 1, '内容C', 'hash_c')
      ]

      const result = diffChunks(oldChunks, newChunks)

      expect(result.toAdd).toHaveLength(0)
      expect(result.toDelete).toHaveLength(1)
      expect(result.toDelete[0].chunkHash).toBe('hash_b')
      expect(result.unchanged).toHaveLength(2)
    })
  })

  describe('边界情况', () => {
    it('chunk 顺序变化但内容相同', () => {
      const oldChunks = [
        createChunk('note1', 0, '内容A', 'hash_a'),
        createChunk('note1', 1, '内容B', 'hash_b')
      ]
      // 相同 hash 但不同顺序
      const newChunks = [
        createChunk('note1', 0, '内容B', 'hash_b'),
        createChunk('note1', 1, '内容A', 'hash_a')
      ]

      const result = diffChunks(oldChunks, newChunks)

      // 基于 hash 比较，所以都是 unchanged
      expect(result.toAdd).toHaveLength(0)
      expect(result.toDelete).toHaveLength(0)
      expect(result.unchanged).toHaveLength(2)
    })

    it('unchanged chunk 复用旧 chunkId（保持 embedding 关联）', () => {
      // 旧 chunks 使用旧格式 chunkId
      const oldChunks = [
        { ...createChunk('note1', 0, '不变内容A', 'hash_a'), chunkId: 'note1:old_id_a' },
        { ...createChunk('note1', 1, '会变内容B', 'hash_b'), chunkId: 'note1:old_id_b' },
        { ...createChunk('note1', 2, '不变内容C', 'hash_c'), chunkId: 'note1:old_id_c' }
      ]
      // 新 chunks 使用新格式 chunkId（noteId:hash）
      const newChunks = [
        { ...createChunk('note1', 0, '不变内容A', 'hash_a'), chunkId: 'note1:hash_a' },
        { ...createChunk('note1', 1, '新内容X', 'hash_x'), chunkId: 'note1:hash_x' },
        { ...createChunk('note1', 2, '不变内容C', 'hash_c'), chunkId: 'note1:hash_c' }
      ]

      const result = diffChunks(oldChunks, newChunks)

      // 检查 unchanged chunks 复用了旧 chunkId
      expect(result.unchanged).toHaveLength(2)
      const unchangedA = result.unchanged.find(c => c.chunkHash === 'hash_a')
      const unchangedC = result.unchanged.find(c => c.chunkHash === 'hash_c')
      expect(unchangedA?.chunkId).toBe('note1:old_id_a')  // 复用旧 ID
      expect(unchangedC?.chunkId).toBe('note1:old_id_c')  // 复用旧 ID

      // 新增的 chunk 使用新 chunkId
      expect(result.toAdd).toHaveLength(1)
      expect(result.toAdd[0].chunkId).toBe('note1:hash_x')

      // 旧的 B 被删除
      expect(result.toDelete).toHaveLength(1)
      expect(result.toDelete[0].chunkId).toBe('note1:old_id_b')
    })

    it('null hash 的旧 chunk 应该被删除并重建', () => {
      const oldChunks = [
        createChunk('note1', 0, '内容A', null as unknown as string), // null hash（迁移前的数据）
        createChunk('note1', 1, '内容B', 'hash_b')
      ]
      const newChunks = [
        createChunk('note1', 0, '内容A', 'hash_a'),
        createChunk('note1', 1, '内容B', 'hash_b')
      ]

      const result = diffChunks(oldChunks, newChunks)

      // null hash 不会被匹配，所以 hash_a 是新增
      expect(result.toAdd).toHaveLength(1)
      expect(result.toAdd[0].chunkHash).toBe('hash_a')
      // null hash 的旧数据应该被删除（迁移逻辑）
      expect(result.toDelete).toHaveLength(1)
      expect(result.toDelete[0].chunkHash).toBe(null)
      expect(result.unchanged).toHaveLength(1)
    })

    it('处理大量 chunks', () => {
      const count = 100
      const oldChunks = Array.from({ length: count }, (_, i) =>
        createChunk('note1', i, `内容${i}`, `hash_${i}`)
      )
      // 修改偶数索引的 chunk
      const newChunks = Array.from({ length: count }, (_, i) =>
        createChunk('note1', i, `内容${i}`, i % 2 === 0 ? `new_hash_${i}` : `hash_${i}`)
      )

      const result = diffChunks(oldChunks, newChunks)

      expect(result.toAdd).toHaveLength(50) // 偶数索引
      expect(result.toDelete).toHaveLength(50)
      expect(result.unchanged).toHaveLength(50) // 奇数索引
    })
  })

  describe('真实场景模拟', () => {
    it('用户在文档末尾添加一段话', () => {
      const oldChunks = [
        createChunk('note1', 0, '第一段', 'hash_1'),
        createChunk('note1', 1, '第二段', 'hash_2')
      ]
      const newChunks = [
        createChunk('note1', 0, '第一段', 'hash_1'),
        createChunk('note1', 1, '第二段', 'hash_2'),
        createChunk('note1', 2, '新添加的第三段', 'hash_3')
      ]

      const result = diffChunks(oldChunks, newChunks)

      expect(result.toAdd).toHaveLength(1)
      expect(result.toDelete).toHaveLength(0)
      expect(result.unchanged).toHaveLength(2)
    })

    it('用户修改文档中间的一个标题', () => {
      const oldChunks = [
        createChunk('note1', 0, '# 介绍\n\n内容...', 'hash_intro'),
        createChunk('note1', 1, '# 方法\n\n详细描述...', 'hash_method'),
        createChunk('note1', 2, '# 结论\n\n总结...', 'hash_conclusion')
      ]
      const newChunks = [
        createChunk('note1', 0, '# 介绍\n\n内容...', 'hash_intro'),
        createChunk('note1', 1, '# 实验方法\n\n详细描述...', 'hash_method_new'), // 修改了标题
        createChunk('note1', 2, '# 结论\n\n总结...', 'hash_conclusion')
      ]

      const result = diffChunks(oldChunks, newChunks)

      expect(result.toAdd).toHaveLength(1)
      expect(result.toAdd[0].chunkText).toContain('实验方法')
      expect(result.toDelete).toHaveLength(1)
      expect(result.toDelete[0].chunkText).toContain('# 方法')
      expect(result.unchanged).toHaveLength(2)
    })

    it('用户删除整个段落', () => {
      const oldChunks = [
        createChunk('note1', 0, '保留的段落A', 'hash_a'),
        createChunk('note1', 1, '要删除的段落', 'hash_delete'),
        createChunk('note1', 2, '保留的段落B', 'hash_b')
      ]
      const newChunks = [
        createChunk('note1', 0, '保留的段落A', 'hash_a'),
        createChunk('note1', 1, '保留的段落B', 'hash_b')
      ]

      const result = diffChunks(oldChunks, newChunks)

      expect(result.toAdd).toHaveLength(0)
      expect(result.toDelete).toHaveLength(1)
      expect(result.toDelete[0].chunkHash).toBe('hash_delete')
      expect(result.unchanged).toHaveLength(2)
    })

    it('笔记包含重复内容（相同 hash 的多个 chunks）', () => {
      // 旧 chunks: 两个相同内容的段落
      const oldChunks = [
        { ...createChunk('note1', 0, '重复的引用', 'same_hash'), chunkId: 'note1:same_hash:0' },
        { ...createChunk('note1', 1, '中间内容', 'hash_mid'), chunkId: 'note1:hash_mid:1' },
        { ...createChunk('note1', 2, '重复的引用', 'same_hash'), chunkId: 'note1:same_hash:2' }
      ]
      // 新 chunks: 仍然有两个相同内容的段落（顺序变了）
      const newChunks = [
        { ...createChunk('note1', 0, '重复的引用', 'same_hash'), chunkId: 'note1:same_hash:0' },
        { ...createChunk('note1', 1, '重复的引用', 'same_hash'), chunkId: 'note1:same_hash:1' },
        { ...createChunk('note1', 2, '中间内容', 'hash_mid'), chunkId: 'note1:hash_mid:2' }
      ]

      const result = diffChunks(oldChunks, newChunks)

      // 两个 same_hash 都应该能匹配到旧的（复用 embedding）
      expect(result.unchanged).toHaveLength(3)
      expect(result.toAdd).toHaveLength(0)
      expect(result.toDelete).toHaveLength(0)

      // 验证复用了旧 chunkId
      const unchangedHashes = result.unchanged.map(c => c.chunkHash)
      expect(unchangedHashes.filter(h => h === 'same_hash')).toHaveLength(2)
    })

    it('新增一个与已有内容相同的段落', () => {
      const oldChunks = [
        { ...createChunk('note1', 0, '唯一内容', 'hash_unique'), chunkId: 'note1:hash_unique:0' }
      ]
      // 新增一个与现有内容相同的段落
      const newChunks = [
        { ...createChunk('note1', 0, '唯一内容', 'hash_unique'), chunkId: 'note1:hash_unique:0' },
        { ...createChunk('note1', 1, '唯一内容', 'hash_unique'), chunkId: 'note1:hash_unique:1' }
      ]

      const result = diffChunks(oldChunks, newChunks)

      // 第一个匹配旧的，第二个是新增
      expect(result.unchanged).toHaveLength(1)
      expect(result.toAdd).toHaveLength(1)
      expect(result.toDelete).toHaveLength(0)
    })
  })
})

describe('extractTextFromTiptap', () => {
  it('正确提取 Tiptap JSON 中的段落文本', () => {
    const tiptapJson = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hello ' },
            { type: 'text', text: 'World' }
          ]
        }
      ]
    })

    const text = extractTextFromTiptap(tiptapJson)
    expect(text).toContain('Hello')
    expect(text).toContain('World')
  })

  it('正确提取标题并添加 Markdown 前缀', () => {
    const tiptapJson = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: '一级标题' }]
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: '二级标题' }]
        }
      ]
    })

    const text = extractTextFromTiptap(tiptapJson)
    expect(text).toContain('# 一级标题')
    expect(text).toContain('## 二级标题')
  })

  it('正确提取无序列表', () => {
    const tiptapJson = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '项目一' }] }]
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '项目二' }] }]
            }
          ]
        }
      ]
    })

    const text = extractTextFromTiptap(tiptapJson)
    expect(text).toContain('• 项目一')
    expect(text).toContain('• 项目二')
  })

  it('正确提取有序列表', () => {
    const tiptapJson = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'orderedList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一步' }] }]
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '第二步' }] }]
            }
          ]
        }
      ]
    })

    const text = extractTextFromTiptap(tiptapJson)
    expect(text).toContain('1. 第一步')
    expect(text).toContain('2. 第二步')
  })

  it('正确提取代码块', () => {
    const tiptapJson = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          content: [{ type: 'text', text: 'const x = 1' }]
        }
      ]
    })

    const text = extractTextFromTiptap(tiptapJson)
    expect(text).toContain('```')
    expect(text).toContain('const x = 1')
  })

  it('正确提取引用块', () => {
    const tiptapJson = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: '这是引用' }] }
          ]
        }
      ]
    })

    const text = extractTextFromTiptap(tiptapJson)
    expect(text).toContain('> 这是引用')
  })

  it('非 JSON 内容直接返回原文', () => {
    const plainText = '这是普通文本'
    const text = extractTextFromTiptap(plainText)
    expect(text).toBe(plainText)
  })

  it('空内容返回空字符串', () => {
    const emptyDoc = JSON.stringify({ type: 'doc', content: [] })
    const text = extractTextFromTiptap(emptyDoc)
    expect(text).toBe('')
  })

  it('空字符串返回空字符串', () => {
    expect(extractTextFromTiptap('')).toBe('')
  })
})

describe('computeContentHash', () => {
  // computeContentHash 已在文件顶部从 utils 导入

  it('生成 16 字符的 hash', () => {
    const hash = computeContentHash('测试内容')
    expect(hash).toHaveLength(16)
  })

  it('相同内容生成相同 hash', () => {
    const hash1 = computeContentHash('相同的内容')
    const hash2 = computeContentHash('相同的内容')
    expect(hash1).toBe(hash2)
  })

  it('不同内容生成不同 hash', () => {
    const hash1 = computeContentHash('内容A')
    const hash2 = computeContentHash('内容B')
    expect(hash1).not.toBe(hash2)
  })

  it('空字符串也能生成 hash', () => {
    const hash = computeContentHash('')
    expect(hash).toHaveLength(16)
  })

  it('只有空格差异也能检测到', () => {
    const hash1 = computeContentHash('hello world')
    const hash2 = computeContentHash('hello  world')
    expect(hash1).not.toBe(hash2)
  })
})
