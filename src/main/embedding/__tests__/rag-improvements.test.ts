/**
 * RAG 改进效果评估测试
 *
 * 测试内容：
 * 1. 结构保护分块 - 表格/代码块/公式块不被切断
 * 2. Query Expansion - 低召回时扩展查询
 * 3. Chunk Merge - 重叠 chunks 合并
 * 4. MMR - 结果多样性
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { ChunkingService, CHUNK_SIZE, CHUNK_OVERLAP } from '../chunking'
import { expandQuery, type ExpandedQuery } from '../semantic-search'

// ============================================
// 1. 结构保护分块测试
// ============================================

describe('Structure-Preserving Chunking', () => {
  const chunkingService = new ChunkingService(CHUNK_SIZE, CHUNK_OVERLAP)

  // 测试文档：包含表格
  const docWithTable = `
# 产品对比

这是一个产品对比表格：

| 产品 | 价格 | 评分 | 特点 |
| --- | --- | --- | --- |
| 产品A | $99 | 4.5 | 轻便、耐用 |
| 产品B | $149 | 4.8 | 高性能、续航长 |
| 产品C | $79 | 4.2 | 性价比高 |
| 产品D | $199 | 4.9 | 专业级、功能全面 |

上面的表格展示了四款产品的对比信息。

## 总结

根据以上对比，我们推荐产品B。
`.trim()

  // 测试文档：包含代码块
  const docWithCode = `
# JavaScript 教程

## 基础语法

下面是一个完整的示例代码：

\`\`\`javascript
function fibonacci(n) {
  if (n <= 1) return n;

  let prev = 0, curr = 1;
  for (let i = 2; i <= n; i++) {
    const next = prev + curr;
    prev = curr;
    curr = next;
  }
  return curr;
}

// 测试
console.log(fibonacci(10)); // 55
console.log(fibonacci(20)); // 6765
\`\`\`

这个函数使用迭代方式计算斐波那契数列。

## 进阶用法

更多内容请参考官方文档。
`.trim()

  // 测试文档：包含公式块
  const docWithMath = `
# 数学公式

## 积分公式

高斯积分的计算：

$$
\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}
$$

这是一个非常重要的积分公式。

## 矩阵运算

矩阵乘法的定义：

$$
C_{ij} = \\sum_{k=1}^{n} A_{ik} B_{kj}
$$

其中 $A$ 是 $m \\times n$ 矩阵，$B$ 是 $n \\times p$ 矩阵。
`.trim()

  // 测试文档：超长表格（强制触发切断）
  const docWithLongTable = `
# 数据分析报告

这是一份详细的数据分析报告，包含大量数据。

## 详细数据表

以下表格包含所有数据点：

| 序号 | 名称 | 数值A | 数值B | 数值C | 数值D | 数值E | 描述 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 项目Alpha | 100 | 200 | 300 | 400 | 500 | 这是Alpha项目的详细说明文字 |
| 2 | 项目Beta | 110 | 210 | 310 | 410 | 510 | 这是Beta项目的详细说明文字 |
| 3 | 项目Gamma | 120 | 220 | 320 | 420 | 520 | 这是Gamma项目的详细说明文字 |
| 4 | 项目Delta | 130 | 230 | 330 | 430 | 530 | 这是Delta项目的详细说明文字 |
| 5 | 项目Epsilon | 140 | 240 | 340 | 440 | 540 | 这是Epsilon项目的详细说明文字 |
| 6 | 项目Zeta | 150 | 250 | 350 | 450 | 550 | 这是Zeta项目的详细说明文字 |
| 7 | 项目Eta | 160 | 260 | 360 | 460 | 560 | 这是Eta项目的详细说明文字 |
| 8 | 项目Theta | 170 | 270 | 370 | 470 | 570 | 这是Theta项目的详细说明文字 |
| 9 | 项目Iota | 180 | 280 | 380 | 480 | 580 | 这是Iota项目的详细说明文字 |
| 10 | 项目Kappa | 190 | 290 | 390 | 490 | 590 | 这是Kappa项目的详细说明文字 |

以上数据来源于最新的调查统计。

## 结论

根据数据分析，推荐选择项目Gamma。
`.trim()

  // 测试文档：超长代码块（强制触发切断）
  const docWithLongCode = `
# 完整的应用程序代码

这是一个完整的Express应用程序：

\`\`\`typescript
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { PrismaClient } from '@prisma/client';

const app = express();
const prisma = new PrismaClient();

// 中间件配置
app.use(cors());
app.use(helmet());
app.use(express.json());

// 用户路由
app.get('/users', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      include: { posts: true }
    });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.post('/users', async (req, res) => {
  try {
    const { name, email } = req.body;
    const user = await prisma.user.create({
      data: { name, email }
    });
    res.status(201).json(user);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create user' });
  }
});

app.put('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email } = req.body;
    const user = await prisma.user.update({
      where: { id: parseInt(id) },
      data: { name, email }
    });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update user' });
  }
});

app.delete('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.user.delete({
      where: { id: parseInt(id) }
    });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(\`Server running on port \${PORT}\`);
});
\`\`\`

上面的代码展示了完整的CRUD操作。
`.trim()

  // 测试文档：长文档包含多个结构
  const longDocWithStructures = `
# 技术文档

## 1. 数据库设计

### 1.1 表结构

| 字段名 | 类型 | 说明 |
| --- | --- | --- |
| id | INT | 主键 |
| name | VARCHAR(100) | 名称 |
| created_at | DATETIME | 创建时间 |
| status | ENUM | 状态 |

### 1.2 索引设计

建议在以下字段上创建索引：
- id (主键索引)
- name (普通索引)
- created_at (时间索引)

## 2. API 实现

### 2.1 创建接口

\`\`\`typescript
interface CreateRequest {
  name: string;
  description?: string;
  tags: string[];
}

async function createItem(req: CreateRequest): Promise<Item> {
  const item = await db.insert('items', {
    name: req.name,
    description: req.description || '',
    tags: JSON.stringify(req.tags),
    created_at: new Date()
  });
  return item;
}
\`\`\`

### 2.2 查询接口

查询接口支持分页和过滤。

## 3. 性能优化

### 3.1 缓存策略

使用 Redis 作为缓存层，缓存热点数据。

### 3.2 数据库优化

通过以下公式计算缓存命中率：

$$
\\text{HitRate} = \\frac{\\text{CacheHits}}{\\text{CacheHits} + \\text{CacheMisses}}
$$

目标命中率应该 > 90%。
`.trim()

  /**
   * 检查 chunk 是否包含被切断的表格
   */
  function hasIncompleteTable(chunk: string): boolean {
    // 检查是否有表格开始但没有结束
    const tableStartPattern = /^\|[^|]+\|/m
    const tableHeaderPattern = /^\|\s*[-:]+\s*\|/m

    const hasStart = tableStartPattern.test(chunk)
    if (!hasStart) return false

    // 检查表格是否完整（有表头分隔行）
    const lines = chunk.split('\n')
    let inTable = false
    let hasHeader = false

    for (const line of lines) {
      if (line.startsWith('|') && line.endsWith('|')) {
        if (!inTable) inTable = true
        if (/^\|\s*[-:]+/.test(line)) hasHeader = true
      } else if (inTable && line.trim() !== '') {
        // 表格行后面紧跟非表格内容，说明表格可能被切断
        break
      }
    }

    // 如果有表格开始但没有表头，可能被切断
    if (inTable && !hasHeader) return true

    return false
  }

  /**
   * 检查 chunk 是否包含被切断的代码块
   */
  function hasIncompleteCodeBlock(chunk: string): boolean {
    const codeBlockStart = (chunk.match(/```/g) || []).length
    // 奇数个 ``` 说明代码块被切断
    return codeBlockStart % 2 !== 0
  }

  /**
   * 检查 chunk 是否包含被切断的公式块
   */
  function hasIncompleteMathBlock(chunk: string): boolean {
    const mathBlockStart = (chunk.match(/\$\$/g) || []).length
    // 奇数个 $$ 说明公式块被切断
    return mathBlockStart % 2 !== 0
  }

  /**
   * 评估分块结果的结构完整性
   */
  function evaluateChunkIntegrity(chunks: { chunkText: string }[]): {
    totalChunks: number
    incompleteTableChunks: number
    incompleteCodeChunks: number
    incompleteMathChunks: number
    integrityScore: number
  } {
    let incompleteTableChunks = 0
    let incompleteCodeChunks = 0
    let incompleteMathChunks = 0

    for (const chunk of chunks) {
      if (hasIncompleteTable(chunk.chunkText)) incompleteTableChunks++
      if (hasIncompleteCodeBlock(chunk.chunkText)) incompleteCodeChunks++
      if (hasIncompleteMathBlock(chunk.chunkText)) incompleteMathChunks++
    }

    const totalIncomplete = incompleteTableChunks + incompleteCodeChunks + incompleteMathChunks
    const integrityScore = chunks.length > 0
      ? (chunks.length - totalIncomplete) / chunks.length
      : 1

    return {
      totalChunks: chunks.length,
      incompleteTableChunks,
      incompleteCodeChunks,
      incompleteMathChunks,
      integrityScore
    }
  }

  it('should report baseline integrity for table document', () => {
    const chunks = chunkingService.chunkNote('test', 'test', docWithTable)
    const result = evaluateChunkIntegrity(chunks)

    console.log('\n=== Table Document Chunking ===')
    console.log(`Total chunks: ${result.totalChunks}`)
    console.log(`Incomplete table chunks: ${result.incompleteTableChunks}`)
    console.log(`Integrity score: ${(result.integrityScore * 100).toFixed(1)}%`)

    // 记录 baseline（当前可能有问题，改进后应该是 0）
    expect(result.totalChunks).toBeGreaterThan(0)
  })

  it('should report baseline integrity for code document', () => {
    const chunks = chunkingService.chunkNote('test', 'test', docWithCode)
    const result = evaluateChunkIntegrity(chunks)

    console.log('\n=== Code Document Chunking ===')
    console.log(`Total chunks: ${result.totalChunks}`)
    console.log(`Incomplete code chunks: ${result.incompleteCodeChunks}`)
    console.log(`Integrity score: ${(result.integrityScore * 100).toFixed(1)}%`)

    expect(result.totalChunks).toBeGreaterThan(0)
  })

  it('should report baseline integrity for math document', () => {
    const chunks = chunkingService.chunkNote('test', 'test', docWithMath)
    const result = evaluateChunkIntegrity(chunks)

    console.log('\n=== Math Document Chunking ===')
    console.log(`Total chunks: ${result.totalChunks}`)
    console.log(`Incomplete math chunks: ${result.incompleteMathChunks}`)
    console.log(`Integrity score: ${(result.integrityScore * 100).toFixed(1)}%`)

    expect(result.totalChunks).toBeGreaterThan(0)
  })

  it('should report baseline integrity for LONG TABLE document', () => {
    const chunks = chunkingService.chunkNote('test', 'test', docWithLongTable)
    const result = evaluateChunkIntegrity(chunks)

    console.log('\n=== LONG TABLE Document Chunking (CRITICAL TEST) ===')
    console.log(`Document length: ${docWithLongTable.length} chars`)
    console.log(`Total chunks: ${result.totalChunks}`)
    console.log(`Incomplete table chunks: ${result.incompleteTableChunks}`)
    console.log(`Integrity score: ${(result.integrityScore * 100).toFixed(1)}%`)

    if (result.incompleteTableChunks > 0) {
      console.log('\n[WARNING] Table was split! Chunk details:')
      chunks.forEach((chunk, i) => {
        const hasTableIssue = hasIncompleteTable(chunk.chunkText)
        if (hasTableIssue || chunk.chunkText.includes('|')) {
          console.log(`  [${i}] ${hasTableIssue ? '[BROKEN]' : '[ok]'} len=${chunk.chunkText.length}`)
          console.log(`       Preview: ${chunk.chunkText.substring(0, 100).replace(/\n/g, '\\n')}...`)
        }
      })
    }

    expect(result.totalChunks).toBeGreaterThan(0)
  })

  it('should report baseline integrity for LONG CODE document', () => {
    const chunks = chunkingService.chunkNote('test', 'test', docWithLongCode)
    const result = evaluateChunkIntegrity(chunks)

    console.log('\n=== LONG CODE Document Chunking (CRITICAL TEST) ===')
    console.log(`Document length: ${docWithLongCode.length} chars`)
    console.log(`Total chunks: ${result.totalChunks}`)
    console.log(`Incomplete code chunks: ${result.incompleteCodeChunks}`)
    console.log(`Integrity score: ${(result.integrityScore * 100).toFixed(1)}%`)

    if (result.incompleteCodeChunks > 0) {
      console.log('\n[WARNING] Code block was split! Chunk details:')
      chunks.forEach((chunk, i) => {
        const hasCodeIssue = hasIncompleteCodeBlock(chunk.chunkText)
        const backticksCount = (chunk.chunkText.match(/```/g) || []).length
        console.log(`  [${i}] ${hasCodeIssue ? '[BROKEN]' : '[ok]'} backticks=${backticksCount} len=${chunk.chunkText.length}`)
      })
    }

    expect(result.totalChunks).toBeGreaterThan(0)
  })

  it('should report baseline integrity for long mixed document', () => {
    const chunks = chunkingService.chunkNote('test', 'test', longDocWithStructures)
    const result = evaluateChunkIntegrity(chunks)

    console.log('\n=== Long Mixed Document Chunking ===')
    console.log(`Total chunks: ${result.totalChunks}`)
    console.log(`Incomplete table chunks: ${result.incompleteTableChunks}`)
    console.log(`Incomplete code chunks: ${result.incompleteCodeChunks}`)
    console.log(`Incomplete math chunks: ${result.incompleteMathChunks}`)
    console.log(`Integrity score: ${(result.integrityScore * 100).toFixed(1)}%`)

    // 打印每个 chunk 的前 100 字符，便于调试
    console.log('\nChunk previews:')
    chunks.forEach((chunk, i) => {
      const preview = chunk.chunkText.substring(0, 80).replace(/\n/g, '\\n')
      const hasIssue = hasIncompleteTable(chunk.chunkText) ||
                       hasIncompleteCodeBlock(chunk.chunkText) ||
                       hasIncompleteMathBlock(chunk.chunkText)
      console.log(`  [${i}] ${hasIssue ? '[!]' : '[ok]'} ${preview}...`)
    })

    expect(result.totalChunks).toBeGreaterThan(0)
  })

  // 结构保护已实现，验证表格/代码/公式完整性
  it('should preserve table integrity after improvement', () => {
    const chunks = chunkingService.chunkNote('test', 'test', longDocWithStructures)
    const result = evaluateChunkIntegrity(chunks)

    expect(result.incompleteTableChunks).toBe(0)
    expect(result.incompleteCodeChunks).toBe(0)
    expect(result.incompleteMathChunks).toBe(0)
    expect(result.integrityScore).toBe(1)
  })
})

// ============================================
// 2. Query Expansion 测试
// ============================================

describe('Query Expansion', () => {
  it('should remove Chinese question words', () => {
    const result = expandQuery('什么是机器学习')
    expect(result.cleaned).toBe('机器学习')
    expect(result.keywords).toContain('机器学习')
  })

  it('should remove English question words', () => {
    const result = expandQuery('what is machine learning')
    expect(result.cleaned).toBe('machine learning')
  })

  it('should extract quoted content with double quotes', () => {
    const result = expandQuery('搜索"深度学习"相关内容')
    expect(result.quotedPhrases).toContain('深度学习')
  })

  it('should extract quoted content with Chinese quotes', () => {
    const result = expandQuery('搜索"神经网络"相关内容')
    expect(result.quotedPhrases).toContain('神经网络')
  })

  it('should handle multiple quoted phrases', () => {
    const result = expandQuery('比较"React"和"Vue"的区别')
    expect(result.quotedPhrases).toContain('React')
    expect(result.quotedPhrases).toContain('Vue')
  })

  it('should preserve original query', () => {
    const result = expandQuery('请问如何配置 webpack？')
    expect(result.original).toBe('请问如何配置 webpack？')
    expect(result.cleaned).toContain('配置')
    expect(result.cleaned).toContain('webpack')
  })

  it('should handle short queries', () => {
    const result = expandQuery('RAG')
    expect(result.original).toBe('RAG')
    expect(result.cleaned).toBe('RAG')
  })

  it('should remove punctuation', () => {
    const result = expandQuery('这是什么？为什么会这样？')
    expect(result.cleaned).not.toContain('？')
  })

  it('should extract keywords from long queries', () => {
    const result = expandQuery('如何使用 Python 进行数据分析和机器学习')
    expect(result.keywords.length).toBeGreaterThan(0)
    expect(result.keywords.some((k) => k.includes('Python'))).toBe(true)
  })

  it('should print expansion results for debugging', () => {
    const testQueries = [
      '什么是深度学习？',
      'How to use React hooks?',
      '搜索"向量数据库"相关资料',
      '请问如何配置 TypeScript 的 tsconfig.json 文件？',
      '比较 PostgreSQL 和 MySQL 的性能差异'
    ]

    console.log('\n=== Query Expansion Test Results ===')
    testQueries.forEach((q) => {
      const result = expandQuery(q)
      console.log(`\nOriginal: "${q}"`)
      console.log(`  Cleaned: "${result.cleaned}"`)
      console.log(`  Keywords: [${result.keywords.join(', ')}]`)
      console.log(`  Quoted: [${result.quotedPhrases.join(', ')}]`)
    })
  })
})

// ============================================
// 3. Chunk Merge 测试
// ============================================

describe('Chunk Merge', () => {
  interface ChunkForMerge {
    chunkId: string
    noteId: string
    chunkText: string
    charStart: number
    charEnd: number
    score: number
  }

  /**
   * 合并重叠的 chunks
   */
  function mergeOverlappingChunks(chunks: ChunkForMerge[], maxGap: number = 100): ChunkForMerge[] {
    if (chunks.length <= 1) return chunks

    // 按 noteId 分组
    const byNote = new Map<string, ChunkForMerge[]>()
    for (const chunk of chunks) {
      const list = byNote.get(chunk.noteId) || []
      list.push(chunk)
      byNote.set(chunk.noteId, list)
    }

    const merged: ChunkForMerge[] = []

    for (const [noteId, noteChunks] of byNote) {
      // 按 charStart 排序
      noteChunks.sort((a, b) => a.charStart - b.charStart)

      let current = { ...noteChunks[0] }

      for (let i = 1; i < noteChunks.length; i++) {
        const next = noteChunks[i]
        const gap = next.charStart - current.charEnd

        if (gap <= maxGap) {
          // 合并
          // 计算重叠部分并拼接
          if (gap < 0) {
            // 有重叠，去掉重复部分
            const overlapLen = -gap
            current.chunkText += next.chunkText.substring(overlapLen)
          } else {
            // 有小 gap，直接拼接（可能丢失一些内容，但可接受）
            current.chunkText += '\n' + next.chunkText
          }
          current.charEnd = next.charEnd
          current.score = Math.max(current.score, next.score)
        } else {
          // 不合并，保存当前，开始新的
          merged.push(current)
          current = { ...next }
        }
      }
      merged.push(current)
    }

    return merged
  }

  it('should merge overlapping chunks from same note', () => {
    const chunks: ChunkForMerge[] = [
      { chunkId: '1', noteId: 'note1', chunkText: 'Hello world', charStart: 0, charEnd: 11, score: 0.9 },
      { chunkId: '2', noteId: 'note1', chunkText: 'world is great', charStart: 6, charEnd: 20, score: 0.8 },
    ]

    const merged = mergeOverlappingChunks(chunks)

    expect(merged.length).toBe(1)
    expect(merged[0].charStart).toBe(0)
    expect(merged[0].charEnd).toBe(20)
    expect(merged[0].score).toBe(0.9) // 取最高分
  })

  it('should not merge chunks from different notes', () => {
    const chunks: ChunkForMerge[] = [
      { chunkId: '1', noteId: 'note1', chunkText: 'Hello', charStart: 0, charEnd: 5, score: 0.9 },
      { chunkId: '2', noteId: 'note2', chunkText: 'World', charStart: 0, charEnd: 5, score: 0.8 },
    ]

    const merged = mergeOverlappingChunks(chunks)
    expect(merged.length).toBe(2)
  })

  it('should merge adjacent chunks within gap threshold', () => {
    const chunks: ChunkForMerge[] = [
      { chunkId: '1', noteId: 'note1', chunkText: 'First part', charStart: 0, charEnd: 100, score: 0.9 },
      { chunkId: '2', noteId: 'note1', chunkText: 'Second part', charStart: 150, charEnd: 250, score: 0.8 },
    ]

    const merged = mergeOverlappingChunks(chunks, 100)

    // gap = 50, 小于 maxGap=100, 应该合并
    expect(merged.length).toBe(1)
  })

  it('should not merge chunks with large gap', () => {
    const chunks: ChunkForMerge[] = [
      { chunkId: '1', noteId: 'note1', chunkText: 'First', charStart: 0, charEnd: 100, score: 0.9 },
      { chunkId: '2', noteId: 'note1', chunkText: 'Second', charStart: 500, charEnd: 600, score: 0.8 },
    ]

    const merged = mergeOverlappingChunks(chunks, 100)

    // gap = 400, 大于 maxGap=100, 不应该合并
    expect(merged.length).toBe(2)
  })
})

// ============================================
// 4. MMR (Maximal Marginal Relevance) 测试
// ============================================

describe('MMR - Maximal Marginal Relevance', () => {
  interface ScoredChunk {
    chunkId: string
    chunkText: string
    score: number
  }

  /**
   * 计算两个文本的 Jaccard 相似度
   */
  function jaccardSimilarity(text1: string, text2: string): number {
    const tokens1 = new Set(text1.toLowerCase().split(/\s+/))
    const tokens2 = new Set(text2.toLowerCase().split(/\s+/))

    const intersection = new Set([...tokens1].filter(t => tokens2.has(t)))
    const union = new Set([...tokens1, ...tokens2])

    return union.size > 0 ? intersection.size / union.size : 0
  }

  /**
   * MMR 重排序
   */
  function mmrRerank(
    chunks: ScoredChunk[],
    lambda: number = 0.7,
    topK: number = 5
  ): ScoredChunk[] {
    if (chunks.length <= 1) return chunks

    const selected: ScoredChunk[] = []
    const remaining = [...chunks]

    // 选择第一个（最高相关性）
    remaining.sort((a, b) => b.score - a.score)
    selected.push(remaining.shift()!)

    // 迭代选择
    while (selected.length < topK && remaining.length > 0) {
      let bestIdx = 0
      let bestMMR = -Infinity

      for (let i = 0; i < remaining.length; i++) {
        const candidate = remaining[i]

        // 计算与已选择结果的最大相似度
        const maxSim = Math.max(
          ...selected.map(s => jaccardSimilarity(candidate.chunkText, s.chunkText))
        )

        // MMR = λ * relevance - (1-λ) * redundancy
        const mmr = lambda * candidate.score - (1 - lambda) * maxSim

        if (mmr > bestMMR) {
          bestMMR = mmr
          bestIdx = i
        }
      }

      selected.push(remaining.splice(bestIdx, 1)[0])
    }

    return selected
  }

  it('should prefer diverse results over similar high-scoring ones', () => {
    const chunks: ScoredChunk[] = [
      { chunkId: '1', chunkText: 'machine learning is great', score: 0.95 },
      { chunkId: '2', chunkText: 'machine learning is wonderful', score: 0.93 }, // 与 1 相似
      { chunkId: '3', chunkText: 'deep neural networks work well', score: 0.85 }, // 不同主题
      { chunkId: '4', chunkText: 'machine learning algorithms', score: 0.90 }, // 与 1 相似
    ]

    const result = mmrRerank(chunks, 0.7, 3)

    // 第一个应该是最高分
    expect(result[0].chunkId).toBe('1')

    // 应该包含不同主题的结果（chunk 3），而不是全是 machine learning
    const hasChunk3 = result.some(c => c.chunkId === '3')
    expect(hasChunk3).toBe(true)

    console.log('\n=== MMR Reranking Result ===')
    result.forEach((c, i) => {
      console.log(`  ${i + 1}. [${c.chunkId}] score=${c.score.toFixed(2)} "${c.chunkText}"`)
    })
  })

  it('should return all chunks if less than topK', () => {
    const chunks: ScoredChunk[] = [
      { chunkId: '1', chunkText: 'hello', score: 0.9 },
      { chunkId: '2', chunkText: 'world', score: 0.8 },
    ]

    const result = mmrRerank(chunks, 0.7, 5)
    expect(result.length).toBe(2)
  })

  it('should respect lambda parameter', () => {
    const chunks: ScoredChunk[] = [
      { chunkId: '1', chunkText: 'apple fruit tasty', score: 0.9 },
      { chunkId: '2', chunkText: 'apple fruit delicious', score: 0.85 },
      { chunkId: '3', chunkText: 'banana yellow long', score: 0.5 },
    ]

    // lambda=1.0 只看相关性，忽略多样性
    const highLambda = mmrRerank(chunks, 1.0, 2)
    expect(highLambda[0].chunkId).toBe('1')
    expect(highLambda[1].chunkId).toBe('2') // 相似但高分

    // lambda=0.3 重视多样性
    const lowLambda = mmrRerank(chunks, 0.3, 2)
    expect(lowLambda[0].chunkId).toBe('1')
    // 第二个更可能是 chunk 3（不同主题）
  })
})

// ============================================
// 5. 综合评估报告
// ============================================

describe('RAG Improvement Summary', () => {
  it('should print improvement checklist', () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║              RAG Improvement Evaluation Report             ║
╠════════════════════════════════════════════════════════════╣
║                                                            ║
║  Phase 1: Local Improvements (No SDK changes)              ║
║  ──────────────────────────────────────────────            ║
║  [ ] 1.1 Structure-Preserving Chunking                     ║
║      - Tables not split                                    ║
║      - Code blocks not split                               ║
║      - Math blocks not split                               ║
║                                                            ║
║  [ ] 1.2 Query Expansion                                   ║
║      - Remove question words                               ║
║      - Extract quoted phrases                              ║
║      - Split long queries                                  ║
║                                                            ║
║  [ ] 1.3 Chunk Merge                                       ║
║      - Merge overlapping chunks                            ║
║      - Merge adjacent chunks (gap < threshold)             ║
║                                                            ║
║  Phase 2: SDK Integration                                  ║
║  ──────────────────────────────────────────────            ║
║  [ ] 2.1 Query Rewrite                                     ║
║      - Use conversation history                            ║
║      - LLM-based rewriting                                 ║
║                                                            ║
║  [ ] 2.2 Rerank + MMR                                      ║
║      - Call rerank API                                     ║
║      - Apply MMR for diversity                             ║
║      - Fallback when no rerank config                      ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
    `)
    expect(true).toBe(true)
  })
})
