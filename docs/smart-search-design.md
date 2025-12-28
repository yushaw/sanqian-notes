# 智能搜索技术方案

> 基于 Embedding 的语义搜索实现设计，参考 sanqian 技术栈和业界最佳实践

---

## 一、概述

### 1.1 目标

为散墨笔记实现**智能搜索**功能，包括：
1. **语义搜索** - 基于含义而非关键词搜索
2. **混合搜索** - 融合关键词 + 语义，取长补短
3. **Q&A 问答** - 与笔记库对话（Phase 2）

### 1.2 核心架构决策

| 维度 | 决策 | 理由 |
|-----|------|------|
| **Embedding 调用** | Notes 自己维护 | 离线可搜索，不依赖 Sanqian |
| **向量存储** | sqlite-vec (Notes 本地) | 复用 sanqian 技术栈，轻量级 |
| **Embedding 模型配置** | Notes 自己配置 | 灵活支持云端/本地模型 |
| **AI Agent** | 复用 Sanqian | Q&A 问答时使用 |

### 1.3 参考实现

- **sanqian**: `backend/core/memory/chunking.py` - 分块策略
- **sanqian**: `backend/core/tools/search_index.py` - 三源混合搜索
- **sanqian**: `backend/config/config.py` - Embedding 配置
- **Smart Connections**: 事件驱动增量索引

---

## 二、整体架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        散墨笔记 (Notes App)                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │                    搜索层 (Search Layer)                        │    │
│  │                                                                │    │
│  │   用户查询  ──────▶  ┌─────────────────────────────────┐       │    │
│  │                      │       HybridSearchService       │       │    │
│  │                      │                                 │       │    │
│  │                      │   ┌─────────┐  ┌─────────┐     │       │    │
│  │                      │   │  LIKE   │  │ Vector  │     │       │    │
│  │                      │   │ 关键词   │  │  语义   │     │       │    │
│  │                      │   └────┬────┘  └────┬────┘     │       │    │
│  │                      │        │            │          │       │    │
│  │                      │        └─────┬──────┘          │       │    │
│  │                      │              │ RRF 融合         │       │    │
│  │                      │              ▼                 │       │    │
│  │                      │        排序结果                 │       │    │
│  │                      └─────────────────────────────────┘       │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                                       │                                 │
│  ┌────────────────────────────────────▼───────────────────────────┐    │
│  │                   索引层 (Index Layer)                          │    │
│  │                                                                │    │
│  │   ┌──────────────────────────────────────────────────────┐    │    │
│  │   │              EmbeddingIndexManager                    │    │    │
│  │   │                                                      │    │    │
│  │   │   笔记变更 ───▶ Dirty Queue ───▶ 后台处理器           │    │    │
│  │   │                      │              │                │    │    │
│  │   │                      │              ▼                │    │    │
│  │   │                      │     ┌──────────────────┐      │    │    │
│  │   │                      │     │  ChunkingService │      │    │    │
│  │   │                      │     │  (分块 + 提取)    │      │    │    │
│  │   │                      │     └────────┬─────────┘      │    │    │
│  │   │                      │              │                │    │    │
│  │   │                      │              ▼                │    │    │
│  │   │                      │     ┌──────────────────┐      │    │    │
│  │   │                      │     │  Embedding API   │      │    │    │
│  │   │                      │     │  (云端/本地)      │      │    │    │
│  │   │                      │     └────────┬─────────┘      │    │    │
│  │   │                      │              │                │    │    │
│  │   │                      │              ▼                │    │    │
│  │   │                      └─────▶ sqlite-vec 存储         │    │    │
│  │   └──────────────────────────────────────────────────────┘    │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │                   存储层 (Storage Layer)                        │    │
│  │                                                                │    │
│  │   ┌────────────────────┐    ┌────────────────────────────┐    │    │
│  │   │     notes.db       │    │     notes_vectors.db       │    │    │
│  │   │    (业务数据)       │    │      (sqlite-vec)          │    │    │
│  │   │                    │    │                            │    │    │
│  │   │  - notes           │    │  - note_embeddings (vec0)  │    │    │
│  │   │  - notebooks       │    │  - note_chunks (元数据)     │    │    │
│  │   │  - tags            │    │  - embedding_config        │    │    │
│  │   └────────────────────┘    └────────────────────────────┘    │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ (Q&A 问答时)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Sanqian (AI Agent)                               │
│                                                                         │
│   检索到相关笔记后，通过 Sanqian Agent 生成回答                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 三、数据模型设计

### 3.1 向量数据库表结构

```sql
-- notes_vectors.db (使用 better-sqlite3 + sqlite-vec 扩展)

-- 笔记块元数据表
CREATE TABLE note_chunks (
    chunk_id TEXT PRIMARY KEY,          -- 格式: "{note_id}:{chunk_index}"
    note_id TEXT NOT NULL,              -- 关联笔记 ID
    chunk_index INTEGER NOT NULL,       -- 块索引 (0-based)
    chunk_text TEXT NOT NULL,           -- 块原文 (用于搜索结果展示)
    char_start INTEGER,                 -- 在原文中的起始位置
    char_end INTEGER,                   -- 在原文中的结束位置
    heading TEXT,                       -- 所属标题 (如有)
    created_at TEXT NOT NULL,

    UNIQUE(note_id, chunk_index)
);

-- 笔记索引状态表
CREATE TABLE note_index_status (
    note_id TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,         -- 内容 hash (判断是否需要更新)
    chunk_count INTEGER NOT NULL,       -- 块数量
    model_name TEXT NOT NULL,           -- 使用的 embedding 模型
    indexed_at TEXT NOT NULL,           -- 索引时间
    status TEXT DEFAULT 'indexed'       -- indexed / pending / error
);

-- Embedding 配置表
CREATE TABLE embedding_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- 向量表 (sqlite-vec)
CREATE VIRTUAL TABLE note_embeddings USING vec0(
    chunk_id TEXT PRIMARY KEY,          -- 关联 note_chunks.chunk_id
    embedding FLOAT[1536],              -- 向量维度 (可配置)
    +note_id TEXT,                      -- auxiliary column, 用于过滤
    +text_hash TEXT                     -- auxiliary column, 用于缓存判断
);

-- 索引
CREATE INDEX idx_chunks_note_id ON note_chunks(note_id);
CREATE INDEX idx_status_updated ON note_index_status(indexed_at);
```

### 3.2 Embedding 配置数据结构

```typescript
// src/shared/types/embedding.ts

export interface EmbeddingConfig {
  // API 配置
  apiType: 'openai' | 'zhipu' | 'local' | 'custom'
  apiUrl: string           // 如 "https://api.openai.com/v1/embeddings"
  apiKey: string           // API 密钥 (加密存储)
  modelName: string        // 如 "text-embedding-3-small"

  // 向量配置
  dimensions: number       // 向量维度, 默认 1536

  // 分块配置
  chunkSize: number        // 块大小 (字符), 默认 800
  chunkOverlap: number     // 重叠大小 (字符), 默认 100

  // 索引配置
  autoIndex: boolean       // 是否自动索引, 默认 true
  indexDelay: number       // 索引延迟 (ms), 默认 5000
}

// 预设配置
export const EMBEDDING_PRESETS: Record<string, Partial<EmbeddingConfig>> = {
  'openai-small': {
    apiType: 'openai',
    apiUrl: 'https://api.openai.com/v1/embeddings',
    modelName: 'text-embedding-3-small',
    dimensions: 1536
  },
  'openai-large': {
    apiType: 'openai',
    apiUrl: 'https://api.openai.com/v1/embeddings',
    modelName: 'text-embedding-3-large',
    dimensions: 3072
  },
  'zhipu': {
    apiType: 'zhipu',
    apiUrl: 'https://open.bigmodel.cn/api/paas/v4/embeddings',
    modelName: 'embedding-3',
    dimensions: 2048
  },
  'local-bge': {
    apiType: 'local',
    apiUrl: 'http://localhost:11434/api/embeddings',
    modelName: 'bge-m3',
    dimensions: 1024
  }
}
```

---

## 四、Tiptap JSON 内容提取

### 4.1 内容提取策略

Tiptap 存储的是 ProseMirror JSON 格式，需要提取为纯文本用于 embedding。

**提取规则**：
1. **保留结构信息** - 标题用 # 表示，列表用 - 表示
2. **保留语义边界** - 段落间用换行分隔
3. **过滤无关内容** - 图片、附件只保留描述/标题
4. **保留代码块** - 代码块内容可能有意义

```typescript
// src/main/embedding/content-extractor.ts

interface ExtractedContent {
  text: string              // 提取的纯文本
  headings: HeadingInfo[]   // 标题信息 (用于分块)
  wordCount: number         // 字数统计
}

interface HeadingInfo {
  level: number             // 标题级别 1-6
  text: string              // 标题文本
  charStart: number         // 在提取文本中的位置
}

/**
 * 从 Tiptap JSON 提取纯文本
 */
export function extractContent(doc: TiptapDocument): ExtractedContent {
  const parts: string[] = []
  const headings: HeadingInfo[] = []
  let currentPos = 0

  function processNode(node: TiptapNode, depth = 0): void {
    switch (node.type) {
      case 'heading': {
        const level = node.attrs?.level || 1
        const text = extractNodeText(node)
        const prefix = '#'.repeat(level) + ' '
        const headingText = prefix + text

        headings.push({
          level,
          text,
          charStart: currentPos
        })

        parts.push(headingText)
        currentPos += headingText.length + 1  // +1 for newline
        break
      }

      case 'paragraph': {
        const text = extractNodeText(node)
        if (text.trim()) {
          parts.push(text)
          currentPos += text.length + 1
        }
        break
      }

      case 'bulletList':
      case 'orderedList': {
        if (node.content) {
          node.content.forEach((item, index) => {
            const prefix = node.type === 'orderedList' ? `${index + 1}. ` : '- '
            const text = extractNodeText(item)
            const listItem = prefix + text
            parts.push(listItem)
            currentPos += listItem.length + 1
          })
        }
        break
      }

      case 'taskList': {
        if (node.content) {
          node.content.forEach(item => {
            const checked = item.attrs?.checked ? '[x]' : '[ ]'
            const text = extractNodeText(item)
            const taskItem = `${checked} ${text}`
            parts.push(taskItem)
            currentPos += taskItem.length + 1
          })
        }
        break
      }

      case 'codeBlock': {
        const lang = node.attrs?.language || ''
        const code = extractNodeText(node)
        const codeBlock = `\`\`\`${lang}\n${code}\n\`\`\``
        parts.push(codeBlock)
        currentPos += codeBlock.length + 1
        break
      }

      case 'blockquote': {
        const text = extractNodeText(node)
        const quote = text.split('\n').map(line => `> ${line}`).join('\n')
        parts.push(quote)
        currentPos += quote.length + 1
        break
      }

      case 'callout': {
        const title = node.attrs?.title || ''
        const content = extractNodeText(node)
        const callout = title ? `[${title}] ${content}` : content
        parts.push(callout)
        currentPos += callout.length + 1
        break
      }

      case 'table': {
        // 表格转为 Markdown 格式
        const tableText = extractTableText(node)
        parts.push(tableText)
        currentPos += tableText.length + 1
        break
      }

      case 'image': {
        // 只保留 alt 描述
        const alt = node.attrs?.alt
        if (alt) {
          parts.push(`[图片: ${alt}]`)
          currentPos += alt.length + 10
        }
        break
      }

      case 'fileAttachment': {
        const filename = node.attrs?.filename
        if (filename) {
          parts.push(`[附件: ${filename}]`)
          currentPos += filename.length + 10
        }
        break
      }

      case 'doc': {
        node.content?.forEach(child => processNode(child, depth))
        break
      }

      default: {
        // 递归处理子节点
        if (node.content) {
          node.content.forEach(child => processNode(child, depth + 1))
        }
      }
    }
  }

  processNode(doc)

  const text = parts.join('\n')

  return {
    text,
    headings,
    wordCount: countWords(text)
  }
}

/**
 * 提取节点内的纯文本
 */
function extractNodeText(node: TiptapNode): string {
  if (node.type === 'text') {
    return node.text || ''
  }

  if (node.content) {
    return node.content.map(extractNodeText).join('')
  }

  return ''
}

/**
 * 表格转 Markdown
 */
function extractTableText(table: TiptapNode): string {
  if (!table.content) return ''

  const rows: string[][] = []

  for (const row of table.content) {
    if (row.type !== 'tableRow' || !row.content) continue

    const cells: string[] = []
    for (const cell of row.content) {
      cells.push(extractNodeText(cell))
    }
    rows.push(cells)
  }

  if (rows.length === 0) return ''

  // 构建 Markdown 表格
  const lines: string[] = []

  // 表头
  lines.push('| ' + rows[0].join(' | ') + ' |')
  lines.push('| ' + rows[0].map(() => '---').join(' | ') + ' |')

  // 表体
  for (let i = 1; i < rows.length; i++) {
    lines.push('| ' + rows[i].join(' | ') + ' |')
  }

  return lines.join('\n')
}

/**
 * 统计字数 (中英文混合)
 */
function countWords(text: string): number {
  // 中文按字数，英文按词数
  const chinese = text.match(/[\u4e00-\u9fa5]/g) || []
  const english = text.match(/[a-zA-Z]+/g) || []
  return chinese.length + english.length
}
```

---

## 五、分块策略 (Chunking)

### 5.1 参考 sanqian ChunkingService

复用 sanqian 的分块策略，针对笔记场景优化：

```typescript
// src/main/embedding/chunking-service.ts

// 配置常量 (参考 sanqian + 业界最佳实践)
const CHUNK_SIZE = 800          // 字符 (~300 tokens)
const CHUNK_OVERLAP = 100       // 字符 (12.5%)
const MIN_CHUNK_SIZE = 100      // 最小块大小

// 中文优化分隔符 (优先级从高到低)
const SEPARATORS = [
  '\n\n',     // 段落
  '\n',       // 换行
  '。',       // 中文句号
  '！',       // 中文感叹号
  '？',       // 中文问号
  '；',       // 中文分号
  '. ',       // 英文句号+空格
  '! ',       // 英文感叹号+空格
  '? ',       // 英文问号+空格
  '，',       // 中文逗号
  ', ',       // 英文逗号+空格
  ' ',        // 空格
  ''          // 字符级 (最后手段)
]

export interface TextChunk {
  index: number           // 块索引
  content: string         // 块内容
  charStart: number       // 在原文中的起始位置
  charEnd: number         // 在原文中的结束位置
  heading?: string        // 所属标题 (如有)
}

export class ChunkingService {
  private chunkSize: number
  private chunkOverlap: number

  constructor(options: {
    chunkSize?: number
    chunkOverlap?: number
  } = {}) {
    this.chunkSize = options.chunkSize || CHUNK_SIZE
    this.chunkOverlap = options.chunkOverlap || CHUNK_OVERLAP
  }

  /**
   * 对笔记内容进行分块
   *
   * 策略 (参考 LangChain MarkdownHeaderTextSplitter):
   * 1. 先按标题分割成 sections
   * 2. 对过大的 section 用通用分隔符二次分割
   * 3. 应用 overlap
   */
  chunkNote(content: ExtractedContent): TextChunk[] {
    const { text, headings } = content

    if (text.length <= this.chunkSize) {
      // 短文本不分块
      return [{
        index: 0,
        content: text,
        charStart: 0,
        charEnd: text.length,
        heading: headings[0]?.text
      }]
    }

    // 1. 按标题分割成 sections
    const sections = this.splitBySections(text, headings)

    // 2. 对过大的 section 二次分割
    const chunks: TextChunk[] = []
    let chunkIndex = 0

    for (const section of sections) {
      if (section.content.length <= this.chunkSize) {
        chunks.push({
          index: chunkIndex++,
          content: section.content,
          charStart: section.charStart,
          charEnd: section.charEnd,
          heading: section.heading
        })
      } else {
        // 二次分割
        const subChunks = this.recursiveSplit(section.content)
        const withOverlap = this.applyOverlap(subChunks)

        for (const subContent of withOverlap) {
          chunks.push({
            index: chunkIndex++,
            content: subContent,
            charStart: section.charStart, // 简化处理
            charEnd: section.charEnd,
            heading: section.heading
          })
        }
      }
    }

    return chunks
  }

  /**
   * 按标题分割成 sections
   */
  private splitBySections(
    text: string,
    headings: HeadingInfo[]
  ): Array<{
    content: string
    charStart: number
    charEnd: number
    heading?: string
  }> {
    if (headings.length === 0) {
      return [{
        content: text,
        charStart: 0,
        charEnd: text.length
      }]
    }

    const sections: Array<{
      content: string
      charStart: number
      charEnd: number
      heading?: string
    }> = []

    // 第一个标题之前的内容
    if (headings[0].charStart > 0) {
      sections.push({
        content: text.slice(0, headings[0].charStart).trim(),
        charStart: 0,
        charEnd: headings[0].charStart,
        heading: undefined
      })
    }

    // 按标题分割
    for (let i = 0; i < headings.length; i++) {
      const start = headings[i].charStart
      const end = i < headings.length - 1
        ? headings[i + 1].charStart
        : text.length

      const content = text.slice(start, end).trim()
      if (content) {
        sections.push({
          content,
          charStart: start,
          charEnd: end,
          heading: headings[i].text
        })
      }
    }

    return sections.filter(s => s.content.length > 0)
  }

  /**
   * 递归分割 (RecursiveCharacterTextSplitter)
   */
  private recursiveSplit(
    text: string,
    separators: string[] = SEPARATORS
  ): string[] {
    if (text.length <= this.chunkSize) {
      return [text]
    }

    if (separators.length === 0) {
      // 强制按字符分割
      return this.splitByChars(text)
    }

    const separator = separators[0]
    const remaining = separators.slice(1)

    if (separator === '') {
      return this.splitByChars(text)
    }

    const splits = text.split(separator)
    const chunks: string[] = []
    let current = ''

    for (let i = 0; i < splits.length; i++) {
      const piece = splits[i] + (i < splits.length - 1 ? separator : '')

      if ((current + piece).length <= this.chunkSize) {
        current += piece
      } else {
        if (current) {
          if (current.length > this.chunkSize) {
            // 递归分割
            chunks.push(...this.recursiveSplit(current, remaining))
          } else {
            chunks.push(current)
          }
        }
        current = piece
      }
    }

    if (current) {
      if (current.length > this.chunkSize && remaining.length > 0) {
        chunks.push(...this.recursiveSplit(current, remaining))
      } else {
        chunks.push(current)
      }
    }

    return chunks
  }

  /**
   * 按字符强制分割
   */
  private splitByChars(text: string): string[] {
    const chunks: string[] = []
    for (let i = 0; i < text.length; i += this.chunkSize) {
      chunks.push(text.slice(i, i + this.chunkSize))
    }
    return chunks
  }

  /**
   * 应用 overlap
   */
  private applyOverlap(chunks: string[]): string[] {
    if (chunks.length <= 1 || this.chunkOverlap === 0) {
      return chunks
    }

    return chunks.map((chunk, i) => {
      if (i === 0) return chunk

      const prevChunk = chunks[i - 1]
      const overlap = prevChunk.slice(-this.chunkOverlap)
      return overlap + chunk
    })
  }
}
```

---

## 六、索引更新策略

### 6.1 Dirty 标记 + 后台处理

参考 Smart Connections 和业界最佳实践，采用**事件驱动 + 延迟批处理**：

```typescript
// src/main/embedding/index-manager.ts

interface DirtyNote {
  noteId: string
  updatedAt: number
  retryCount: number
}

export class EmbeddingIndexManager {
  private db: Database.Database
  private config: EmbeddingConfig
  private chunkingService: ChunkingService

  // Dirty 队列
  private dirtyQueue: Map<string, DirtyNote> = new Map()
  private processingTimer: NodeJS.Timeout | null = null

  // 配置
  private readonly PROCESS_DELAY = 5000      // 5 秒延迟
  private readonly BATCH_SIZE = 10           // 批处理大小
  private readonly MAX_RETRY = 3             // 最大重试次数
  private readonly CHANGE_THRESHOLD = 0.1    // 10% 变化阈值

  constructor(options: {
    dbPath: string
    config: EmbeddingConfig
  }) {
    this.db = new Database(options.dbPath)
    this.config = options.config
    this.chunkingService = new ChunkingService({
      chunkSize: options.config.chunkSize,
      chunkOverlap: options.config.chunkOverlap
    })

    this.initTables()
    this.loadSqliteVec()
  }

  /**
   * 标记笔记需要重新索引
   */
  markDirty(noteId: string): void {
    this.dirtyQueue.set(noteId, {
      noteId,
      updatedAt: Date.now(),
      retryCount: 0
    })

    // 重置定时器
    if (this.processingTimer) {
      clearTimeout(this.processingTimer)
    }

    this.processingTimer = setTimeout(() => {
      this.processDirtyQueue()
    }, this.PROCESS_DELAY)
  }

  /**
   * 处理 Dirty 队列
   */
  private async processDirtyQueue(): Promise<void> {
    if (this.dirtyQueue.size === 0) return

    // 取出一批
    const batch = Array.from(this.dirtyQueue.values())
      .slice(0, this.BATCH_SIZE)

    console.log(`[Embedding] Processing ${batch.length} dirty notes`)

    for (const item of batch) {
      try {
        await this.indexNote(item.noteId)
        this.dirtyQueue.delete(item.noteId)
      } catch (error) {
        console.error(`[Embedding] Failed to index note ${item.noteId}:`, error)

        if (item.retryCount < this.MAX_RETRY) {
          item.retryCount++
          // 保留在队列中等待重试
        } else {
          // 超过重试次数，标记为错误
          this.markError(item.noteId, String(error))
          this.dirtyQueue.delete(item.noteId)
        }
      }
    }

    // 如果还有剩余，继续处理
    if (this.dirtyQueue.size > 0) {
      this.processingTimer = setTimeout(() => {
        this.processDirtyQueue()
      }, 1000) // 1 秒后继续
    }
  }

  /**
   * 索引单个笔记
   */
  async indexNote(noteId: string): Promise<void> {
    // 1. 获取笔记内容
    const note = await this.getNote(noteId)
    if (!note) {
      this.removeNoteIndex(noteId)
      return
    }

    // 2. 计算 content hash
    const contentHash = this.computeHash(note.content, this.config.modelName)

    // 3. 检查是否需要更新
    const existing = this.db.prepare(
      'SELECT content_hash FROM note_index_status WHERE note_id = ?'
    ).get(noteId) as { content_hash: string } | undefined

    if (existing?.content_hash === contentHash) {
      console.log(`[Embedding] Note ${noteId} unchanged, skipping`)
      return
    }

    // 4. 提取内容
    const doc = JSON.parse(note.content)
    const extracted = extractContent(doc)

    // 5. 检查变化量 (可选: 变化 <10% 不重新索引)
    if (existing && this.config.autoIndex) {
      const changeRatio = this.computeChangeRatio(existing.content_hash, contentHash)
      if (changeRatio < this.CHANGE_THRESHOLD) {
        console.log(`[Embedding] Note ${noteId} change ${(changeRatio * 100).toFixed(1)}% < threshold, skipping`)
        return
      }
    }

    // 6. 分块
    const chunks = this.chunkingService.chunkNote(extracted)

    if (chunks.length === 0) {
      this.removeNoteIndex(noteId)
      return
    }

    // 7. 生成 embedding
    const texts = chunks.map(c => c.content)
    const embeddings = await this.callEmbeddingAPI(texts)

    if (embeddings.length !== chunks.length) {
      throw new Error(`Embedding count mismatch: ${embeddings.length} vs ${chunks.length}`)
    }

    // 8. 事务写入
    const now = new Date().toISOString()

    this.db.transaction(() => {
      // 删除旧数据
      this.db.prepare('DELETE FROM note_chunks WHERE note_id = ?').run(noteId)
      this.db.prepare('DELETE FROM note_embeddings WHERE note_id = ?').run(noteId)

      // 插入新数据
      const insertChunk = this.db.prepare(`
        INSERT INTO note_chunks
        (chunk_id, note_id, chunk_index, chunk_text, char_start, char_end, heading, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)

      const insertEmbedding = this.db.prepare(`
        INSERT INTO note_embeddings (chunk_id, embedding, note_id, text_hash)
        VALUES (?, ?, ?, ?)
      `)

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]
        const chunkId = `${noteId}:${chunk.index}`
        const textHash = this.computeHash(chunk.content, this.config.modelName)

        insertChunk.run(
          chunkId,
          noteId,
          chunk.index,
          chunk.content,
          chunk.charStart,
          chunk.charEnd,
          chunk.heading || null,
          now
        )

        insertEmbedding.run(
          chunkId,
          JSON.stringify(embeddings[i]),
          noteId,
          textHash
        )
      }

      // 更新状态
      this.db.prepare(`
        INSERT OR REPLACE INTO note_index_status
        (note_id, content_hash, chunk_count, model_name, indexed_at, status)
        VALUES (?, ?, ?, ?, ?, 'indexed')
      `).run(noteId, contentHash, chunks.length, this.config.modelName, now)
    })()

    console.log(`[Embedding] Indexed note ${noteId}: ${chunks.length} chunks`)
  }

  /**
   * 删除笔记索引
   */
  removeNoteIndex(noteId: string): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM note_chunks WHERE note_id = ?').run(noteId)
      this.db.prepare('DELETE FROM note_embeddings WHERE note_id = ?').run(noteId)
      this.db.prepare('DELETE FROM note_index_status WHERE note_id = ?').run(noteId)
    })()
  }

  /**
   * 计算内容 hash (含模型名，切换模型后缓存失效)
   */
  private computeHash(content: string, modelName: string): string {
    const data = `${modelName}:${content}`
    return createHash('sha256').update(data).digest('hex').slice(0, 16)
  }

  /**
   * 调用 Embedding API
   */
  private async callEmbeddingAPI(texts: string[]): Promise<number[][]> {
    const { apiUrl, apiKey, modelName } = this.config

    // 批次限制 (部分 API 限制 64 条)
    const BATCH_SIZE = 48
    const allEmbeddings: number[][] = []

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE)

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          input: batch,
          model: modelName
        })
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`Embedding API error: ${response.status} ${error}`)
      }

      const data = await response.json()
      const embeddings = data.data.map((item: any) => item.embedding)
      allEmbeddings.push(...embeddings)
    }

    return allEmbeddings
  }

  // ... 其他辅助方法
}
```

### 6.2 启动时增量同步

```typescript
/**
 * 启动时同步索引
 */
async syncOnStartup(): Promise<{
  indexed: number
  skipped: number
  removed: number
}> {
  console.log('[Embedding] Starting sync...')

  // 1. 获取所有笔记 ID 和更新时间
  const notes = await this.getAllNotes()
  const noteIds = new Set(notes.map(n => n.id))

  // 2. 获取已索引的笔记
  const indexed = this.db.prepare(
    'SELECT note_id, content_hash, indexed_at FROM note_index_status'
  ).all() as Array<{
    note_id: string
    content_hash: string
    indexed_at: string
  }>

  let indexedCount = 0
  let skippedCount = 0

  // 3. 检查需要更新的笔记
  for (const note of notes) {
    const existing = indexed.find(i => i.note_id === note.id)
    const contentHash = this.computeHash(note.content, this.config.modelName)

    if (existing?.content_hash === contentHash) {
      skippedCount++
    } else {
      this.markDirty(note.id)
      indexedCount++
    }
  }

  // 4. 清理已删除的笔记
  let removedCount = 0
  for (const item of indexed) {
    if (!noteIds.has(item.note_id)) {
      this.removeNoteIndex(item.note_id)
      removedCount++
    }
  }

  console.log(`[Embedding] Sync complete: ${indexedCount} to index, ${skippedCount} skipped, ${removedCount} removed`)

  return {
    indexed: indexedCount,
    skipped: skippedCount,
    removed: removedCount
  }
}
```

---

## 七、混合搜索实现

### 7.1 三源搜索 + RRF 融合

参考 sanqian 的 `search_index.py`，实现 LIKE + Vector + RRF：

```typescript
// src/main/embedding/hybrid-search.ts

export interface SearchResult {
  noteId: string
  title: string
  chunkText: string       // 匹配的文本片段
  score: number           // 综合得分
  highlights?: string[]   // 高亮片段
}

export class HybridSearchService {
  private notesDb: Database.Database      // 笔记数据库
  private vectorDb: Database.Database     // 向量数据库
  private indexManager: EmbeddingIndexManager

  // RRF 参数
  private readonly RRF_K = 60

  // 向量搜索阈值
  private readonly VECTOR_THRESHOLD = 0.3

  /**
   * 混合搜索 (LIKE + Vector + RRF)
   */
  async search(query: string, options: {
    limit?: number
    notebookId?: string   // 限定笔记本
  } = {}): Promise<SearchResult[]> {
    const limit = options.limit || 20

    // 1. LIKE 搜索 (现有逻辑)
    const likeResults = this.searchByLike(query, limit * 2)

    // 2. Vector 搜索
    const vectorResults = await this.searchByVector(query, limit * 2)

    // 3. 如果两个都没结果，返回空
    if (likeResults.length === 0 && vectorResults.length === 0) {
      return []
    }

    // 4. 如果只有一个有结果，直接返回
    if (likeResults.length === 0) {
      return this.buildResults(vectorResults.slice(0, limit))
    }
    if (vectorResults.length === 0) {
      return this.buildResults(likeResults.slice(0, limit))
    }

    // 5. RRF 融合
    const fused = this.rrfFusion(likeResults, vectorResults)

    // 6. 构建结果
    return this.buildResults(fused.slice(0, limit))
  }

  /**
   * LIKE 关键词搜索
   */
  private searchByLike(query: string, limit: number): Array<{
    noteId: string
    score: number
    matchText: string
  }> {
    const escaped = query.trim()
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_')
    const likeQuery = `%${escaped}%`

    const rows = this.notesDb.prepare(`
      SELECT id, title, content
      FROM notes
      WHERE deleted_at IS NULL
        AND (title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')
      ORDER BY is_pinned DESC, updated_at DESC
      LIMIT ?
    `).all(likeQuery, likeQuery, limit) as Array<{
      id: string
      title: string
      content: string
    }>

    return rows.map((row, index) => {
      // 提取匹配片段
      const text = this.extractText(row.content)
      const matchIndex = text.toLowerCase().indexOf(query.toLowerCase())
      const matchText = matchIndex >= 0
        ? this.extractSnippet(text, matchIndex, query.length)
        : text.slice(0, 100)

      return {
        noteId: row.id,
        score: 1 - (index / rows.length),  // 简单排名分数
        matchText
      }
    })
  }

  /**
   * Vector 语义搜索
   */
  private async searchByVector(query: string, limit: number): Promise<Array<{
    noteId: string
    score: number
    matchText: string
  }>> {
    // 1. 生成查询向量
    const queryEmbedding = await this.indexManager.embedText(query)
    if (!queryEmbedding) {
      return []
    }

    // 2. 向量搜索
    const rows = this.vectorDb.prepare(`
      SELECT
        nc.note_id,
        nc.chunk_text,
        vec_distance_cosine(ne.embedding, ?) as distance
      FROM note_embeddings ne
      JOIN note_chunks nc ON ne.chunk_id = nc.chunk_id
      ORDER BY distance ASC
      LIMIT ?
    `).all(JSON.stringify(queryEmbedding), limit * 2) as Array<{
      note_id: string
      chunk_text: string
      distance: number
    }>

    // 3. 转换为相似度分数，过滤低于阈值的
    return rows
      .map(row => ({
        noteId: row.note_id,
        score: 1 / (1 + row.distance),
        matchText: row.chunk_text
      }))
      .filter(r => r.score >= this.VECTOR_THRESHOLD)
  }

  /**
   * RRF (Reciprocal Rank Fusion) 融合
   */
  private rrfFusion(
    likeResults: Array<{ noteId: string; score: number; matchText: string }>,
    vectorResults: Array<{ noteId: string; score: number; matchText: string }>
  ): Array<{ noteId: string; score: number; matchText: string }> {
    const scores: Map<string, {
      score: number
      matchText: string
    }> = new Map()

    // LIKE 结果贡献
    likeResults.forEach((item, rank) => {
      const existing = scores.get(item.noteId)
      const contribution = 1 / (this.RRF_K + rank + 1)

      if (existing) {
        existing.score += contribution
      } else {
        scores.set(item.noteId, {
          score: contribution,
          matchText: item.matchText
        })
      }
    })

    // Vector 结果贡献
    vectorResults.forEach((item, rank) => {
      const existing = scores.get(item.noteId)
      const contribution = 1 / (this.RRF_K + rank + 1)

      if (existing) {
        existing.score += contribution
        // 如果 vector 匹配的片段更长，使用它
        if (item.matchText.length > existing.matchText.length) {
          existing.matchText = item.matchText
        }
      } else {
        scores.set(item.noteId, {
          score: contribution,
          matchText: item.matchText
        })
      }
    })

    // 排序返回
    return Array.from(scores.entries())
      .map(([noteId, data]) => ({
        noteId,
        score: data.score,
        matchText: data.matchText
      }))
      .sort((a, b) => b.score - a.score)
  }

  /**
   * 构建最终结果
   */
  private buildResults(
    items: Array<{ noteId: string; score: number; matchText: string }>
  ): SearchResult[] {
    // 获取笔记标题
    const noteIds = items.map(i => i.noteId)
    const placeholders = noteIds.map(() => '?').join(',')

    const notes = this.notesDb.prepare(`
      SELECT id, title FROM notes WHERE id IN (${placeholders})
    `).all(...noteIds) as Array<{ id: string; title: string }>

    const noteMap = new Map(notes.map(n => [n.id, n.title]))

    return items.map(item => ({
      noteId: item.noteId,
      title: noteMap.get(item.noteId) || '未知标题',
      chunkText: item.matchText,
      score: item.score
    }))
  }

  // ... 辅助方法
}
```

---

## 八、前端界面设计

### 8.1 设计理念

**零感知升级**：用户无需改变任何操作习惯
- 搜索界面保持不变
- 后台自动使用混合搜索（如已配置）
- 设置简洁，放在 AI Tab 内

```
改动范围:

src/renderer/src/
├── components/
│   ├── Settings.tsx               # AI Tab 内添加知识库设置
│   └── KnowledgeBaseSettings.tsx  # 新增: 简洁的设置组件
└── types/
    └── embedding.ts               # 新增: 配置类型
```

### 8.2 搜索界面 (NoteList.tsx)

#### 设计原则：零感知升级

搜索界面**保持现有样式不变**，用户无需学习新操作。智能搜索在后台静默工作：

- 有 Embedding 配置 → 自动使用混合搜索（关键词 + 语义）
- 无 Embedding 配置 → 回退到原有关键词搜索

```
搜索框 (保持不变):
┌──────────────────────────────────────────┐
│ [搜索笔记...........................] [X]  │
└──────────────────────────────────────────┘

搜索结果 (保持不变):
┌──────────────────────────────────────────┐
│ 📝 笔记标题                    3小时前    │
│    预览文本内容...                        │
└──────────────────────────────────────────┘
```

#### 代码改动

仅需修改搜索调用逻辑，UI 完全不变：

```typescript
// NoteList.tsx - performSearch 函数

const performSearch = useCallback(async (query: string) => {
  if (!query.trim()) {
    setSearchResults(null)
    return
  }

  // 尝试使用智能搜索，失败则降级
  try {
    const results = await window.electron.note.search(query)
    setSearchResults(results)
  } catch (error) {
    console.error('Search error:', error)
    setSearchResults([])
  }
}, [])
```

主进程 `note.search` 内部判断：
- Embedding 已配置且可用 → 调用 HybridSearchService
- 否则 → 使用原有 LIKE 搜索

用户完全无感知，搜索结果更智能。

### 8.3 知识库设置 (Settings - AI Tab)

#### 设计原则：简约禅意

设置放在现有 AI Tab 内，保持一致性。界面简洁，只显示必要配置。

```
┌─────────────────────────────────────────────────────────────┐
│  知识库                                                      │
│  语义搜索、笔记对话，让笔记成为你的第二大脑                     │
│                                                       [开关] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  模型                                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  OpenAI text-embedding-3-small              ▾       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  API Key                                                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  sk-••••••••••••••••••••                       [👁]  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  索引状态                                                   │
│  已索引 156 篇笔记                          [重建索引]      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### 组件代码

```tsx
// 新建 KnowledgeBaseSettings.tsx

export function KnowledgeBaseSettings() {
  const t = useTranslations()
  const [config, setConfig] = useState<EmbeddingConfig | null>(null)
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null)
  const [showApiKey, setShowApiKey] = useState(false)

  // 模型预设
  const presets = [
    { id: 'openai-small', label: 'OpenAI text-embedding-3-small' },
    { id: 'openai-large', label: 'OpenAI text-embedding-3-large' },
    { id: 'zhipu', label: '智谱 embedding-3' },
    { id: 'local', label: '本地模型 (Ollama)' },
    { id: 'custom', label: '自定义' },
  ]

  return (
    <div className="space-y-4 pt-4 border-t border-black/5 dark:border-white/10">
      {/* 标题和开关 */}
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium text-[var(--color-text)]">
            {t.settings.knowledgeBase?.title || '知识库'}
          </h4>
          <p className="text-xs text-[var(--color-muted)] mt-0.5">
            {t.settings.knowledgeBase?.description || '语义搜索、笔记对话，让笔记成为你的第二大脑'}
          </p>
        </div>
        <ToggleSwitch
          checked={config?.enabled ?? false}
          onChange={handleToggleEnabled}
        />
      </div>

      {config?.enabled && (
        <>
          {/* 模型选择 */}
          <div>
            <label className="block text-xs text-[var(--color-muted)] mb-1.5">
              {t.settings.knowledgeBase?.model || '模型'}
            </label>
            <select
              value={config.apiType}
              onChange={(e) => handleSelectPreset(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg bg-black/5 dark:bg-white/5 border-none outline-none"
            >
              {presets.map(p => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>

          {/* API Key */}
          <div>
            <label className="block text-xs text-[var(--color-muted)] mb-1.5">
              API Key
            </label>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={config.apiKey || ''}
                onChange={(e) => handleConfigChange({ apiKey: e.target.value })}
                placeholder="sk-..."
                className="w-full px-3 py-2 pr-10 text-sm rounded-lg bg-black/5 dark:bg-white/5 outline-none"
              />
              <button
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[var(--color-muted)]"
              >
                {showApiKey ? '🙈' : '👁'}
              </button>
            </div>
          </div>

          {/* 索引状态 */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-[var(--color-muted)]">
              {indexStatus?.isIndexing
                ? `正在索引... ${indexStatus.indexedNotes}/${indexStatus.totalNotes}`
                : `已索引 ${indexStatus?.indexedNotes || 0} 篇笔记`
              }
            </span>
            <button
              onClick={handleRebuildIndex}
              disabled={indexStatus?.isIndexing}
              className="text-[var(--color-accent)] hover:underline disabled:opacity-50"
            >
              {t.settings.knowledgeBase?.rebuildIndex || '重建索引'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
```

#### 放置位置

在 `Settings.tsx` 的 AI Tab 中，在 `AIActionsSettings` 组件下方添加：

```tsx
{activeTab === 'ai' && (
  <div className="space-y-6">
    <AIActionsSettings />
    <KnowledgeBaseSettings />
  </div>
)}
```

### 8.4 IPC 接口

```typescript
// src/preload/index.ts

embedding: {
  getConfig: () => ipcRenderer.invoke('embedding:getConfig'),
  setConfig: (config) => ipcRenderer.invoke('embedding:setConfig', config),
  getStatus: () => ipcRenderer.invoke('embedding:getStatus'),
  rebuildIndex: () => ipcRenderer.invoke('embedding:rebuildIndex'),
}

// note.search 内部自动判断是否启用混合搜索
```

### 8.5 国际化

```typescript
// i18n/translations.ts 添加

knowledgeBase: {
  title: '知识库',
  description: '语义搜索、笔记对话，让笔记成为你的第二大脑',
  model: '模型',
  rebuildIndex: '重建索引',
}
```

---

## 九、实现计划

### Phase 1: 基础设施 (3-5 天)

- [ ] 创建 `notes_vectors.db` 数据库结构
- [ ] 集成 sqlite-vec 扩展到 better-sqlite3
- [ ] 实现 Embedding 配置存储和管理
- [ ] 实现 Embedding API 调用（支持 OpenAI/智谱）
- [ ] 添加设置页面 UI

### Phase 2: 内容处理 (2-3 天)

- [ ] 实现 Tiptap JSON 内容提取
- [ ] 移植 ChunkingService（参考 sanqian）
- [ ] 单元测试

### Phase 3: 索引管理 (3-4 天)

- [ ] 实现 EmbeddingIndexManager
- [ ] Dirty 队列 + 后台处理
- [ ] 启动时增量同步
- [ ] 笔记 CRUD 事件监听

### Phase 4: 混合搜索 (2-3 天)

- [ ] 实现 HybridSearchService
- [ ] LIKE + Vector + RRF 融合
- [ ] 增强现有搜索 UI

### Phase 5: 优化和完善 (2-3 天)

- [ ] 错误处理和重试机制
- [ ] 性能优化（批处理、缓存）
- [ ] 国际化
- [ ] 文档

### Phase 6: Q&A 问答 (未来)

- [ ] 基于检索结果的 RAG 问答
- [ ] 集成 Sanqian Agent

---

## 十、风险和注意事项

### 10.1 技术风险

| 风险 | 影响 | 缓解措施 |
|-----|------|---------|
| sqlite-vec 与 better-sqlite3 兼容性 | 高 | 提前验证，准备降级方案 |
| Embedding API 调用失败 | 中 | 重试机制，优雅降级到 LIKE 搜索 |
| 大笔记库索引性能 | 中 | 后台处理，进度提示 |
| 模型切换导致缓存失效 | 低 | content_hash 包含 model_name |

### 10.2 用户体验考量

1. **渐进增强** - 即使 Embedding 不可用，LIKE 搜索仍可用
2. **透明度** - 显示索引状态，让用户知道发生了什么
3. **可控性** - 提供手动重建索引选项
4. **隐私** - 支持本地模型，数据不出本机

---

## 参考资料

### 业界实践

- [Smart Connections - GitHub](https://github.com/brianpetro/obsidian-smart-connections)
- [Evernote Semantic Search](https://help.evernote.com/hc/en-us/articles/45706285591955-Semantic-search)
- [sqlite-vec - GitHub](https://github.com/asg017/sqlite-vec)
- [LangChain MarkdownHeaderTextSplitter](https://python.langchain.com/docs/how_to/markdown_header_metadata_splitter/)
- [RAG Chunking Best Practices 2025](https://www.firecrawl.dev/blog/best-chunking-strategies-rag-2025)

### sanqian 参考代码

- `backend/core/memory/chunking.py` - 分块实现
- `backend/core/tools/search_index.py` - 三源混合搜索
- `backend/config/config.py` - Embedding 配置
- `backend/core/database/vector.py` - sqlite-vec 封装

---

## 更新日志

| 日期 | 更新内容 |
|------|----------|
| 2024-12-28 | 初版设计，基于业界调研和 sanqian 技术栈 |
