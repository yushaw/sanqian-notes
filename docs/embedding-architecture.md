# Embedding 架构设计方案

> 本文档记录 Notes 与 Sanqian 在 AI Embedding 能力上的架构设计方案对比与实施细节。

## 背景

Notes 需要接入 AI 能力，核心需求是**语义搜索**（Semantic Search）：用户可以用自然语言搜索笔记内容，而不仅仅是关键词匹配。

实现语义搜索的核心技术是 **Embedding**：
1. 将文本转换为高维向量（如 1536 维）
2. 通过向量相似度计算找到语义相关的内容

### 技术栈选型

- **Embedding 模型**: OpenAI text-embedding-3-small / 本地模型 (Ollama)
- **向量存储**: sqlite-vec（SQLite 扩展，嵌入式向量数据库）
- **SDK**: @anthropic/sanqian-sdk（与 Sanqian 通信）

---

## 方案对比

### 方案 A：Sanqian 只提供 Embedding API

```
┌─────────────────────────────────────────────────────────────┐
│                        Notes                                 │
│                                                             │
│   ┌────────────────┐         ┌────────────────────────┐    │
│   │   notes.db     │         │  notes_vectors.db      │    │
│   │   (业务数据)    │         │  (sqlite-vec)          │    │
│   │                │         │                        │    │
│   │  - 笔记内容     │         │  - doc_id              │    │
│   │  - 笔记本      │         │  - chunk_text          │    │
│   │  - 标签        │         │  - embedding           │    │
│   │  - 回收站      │         │  - content_hash        │    │
│   └────────────────┘         └────────────────────────┘    │
│           │                           ↑                     │
│           │ 内容变更                   │ 存储向量             │
│           ▼                           │                     │
│   ┌────────────────────────────────────────────────────┐   │
│   │              Embedding Manager                      │   │
│   │                                                    │   │
│   │  1. content hash 判断是否需要更新                    │   │
│   │  2. 文本分块 (chunking)                             │   │
│   │  3. 调用 Sanqian SDK 生成向量                       │   │
│   │  4. 存入本地 sqlite-vec                            │   │
│   │  5. 提供本地语义搜索                                │   │
│   └────────────────────────────────────────────────────┘   │
│                           │                                 │
└───────────────────────────┼─────────────────────────────────┘
                            │ SDK 调用 (无状态)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                       Sanqian                                │
│                                                             │
│   ┌────────────────────────────────────────────────────┐   │
│   │              Embedding Service                      │   │
│   │                                                    │   │
│   │   generate(texts: string[]) → number[][]           │   │
│   │                                                    │   │
│   │   - 调用 LLM API (OpenAI / Ollama)                  │   │
│   │   - 纯计算，不存储任何数据                           │   │
│   │   - 统一管理 API Key                                │   │
│   │   - 可切换不同 embedding 模型                        │   │
│   └────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### 职责划分

| 组件 | 职责 | 存储 |
|-----|------|------|
| **Notes** | 业务数据 + 向量存储 + 分块 + 检索 | `notes.db` + `notes_vectors.db` |
| **Sanqian** | Embedding 生成 (纯 API) | 无 |

#### 优点

1. **数据主权完整** - 所有数据（包括向量）都在 Notes 本地
2. **离线可搜索** - 向量已存本地，搜索不依赖 Sanqian（仅查询向量生成需要）
3. **简单清晰** - Sanqian 就是个 API 代理，无状态
4. **隐私性强** - 内容不出本机

#### 缺点

1. **Notes 需要常驻问题** - Notes 关闭时无法更新索引（可通过启动时增量同步解决）
2. **无法跨应用搜索** - 不能同时搜索 Notes 和 TodoList 的内容
3. **重复实现** - 每个 App 都要实现向量存储和检索逻辑

#### 业界案例

- **LangChain CacheBackedEmbeddings**: 远程 API 生成 + 本地缓存存储
- **Obsidian Copilot**: 支持 OpenAI/Ollama embedding，向量存在 vault 本地
- **Rewind AI (早期)**: 完全本地处理和存储

---

### 方案 B：Sanqian 托管向量索引

```
┌─────────────────────────────────────────────────────────────┐
│                        Notes                                 │
│                                                             │
│   ┌────────────────────────────────────────────────────┐   │
│   │                    notes.db                         │   │
│   │                                                    │   │
│   │   - 笔记完整内容 (数据主权)                          │   │
│   │   - 笔记本                                          │   │
│   │   - 标签                                            │   │
│   │   - 回收站                                          │   │
│   └────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           │ 内容变更时通知                   │
│                           ▼                                 │
└───────────────────────────┼─────────────────────────────────┘
                            │ SDK: embedding.sync({ id, content, ... })
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   Sanqian (常驻服务)                         │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐  │
│   │              Embedding Service                       │  │
│   │                                                     │  │
│   │  ┌──────────────┐  ┌──────────────┐                │  │
│   │  │   Embedder   │  │ Vector Store │                │  │
│   │  │  (生成向量)   │  │ (sqlite-vec) │                │  │
│   │  └──────────────┘  └──────────────┘                │  │
│   │         │                   │                       │  │
│   │         ▼                   ▼                       │  │
│   │  ┌─────────────────────────────────────────────┐   │  │
│   │  │              向量索引库                       │   │  │
│   │  │                                             │   │  │
│   │  │  namespace: "notes"   → Notes 的向量          │   │  │
│   │  │  namespace: "todos"   → TodoList 的向量       │   │  │
│   │  │  namespace: "..."     → 其他 App              │   │  │
│   │  └─────────────────────────────────────────────┘   │  │
│   └─────────────────────────────────────────────────────┘  │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐  │
│   │              Search Service                          │  │
│   │                                                     │  │
│   │   search({ query, namespaces }) → results           │  │
│   │                                                     │  │
│   │   - 跨 namespace 搜索                                │  │
│   │   - 返回 doc_id + score + 片段预览                   │  │
│   └─────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### 职责划分

| 组件 | 职责 | 存储 |
|-----|------|------|
| **Notes** | 业务数据（笔记内容）| `notes.db` |
| **Sanqian** | Embedding 生成 + 向量存储 + 检索服务 | `sanqian_vectors.db` |

#### 关键设计

1. **Namespace 隔离** - 不同 App 的向量通过 namespace 隔离
2. **只存索引不存原文** - Sanqian 存储的是向量和元数据，不是笔记原文
3. **原始数据仍在 App** - 搜索返回 doc_id，App 根据 id 获取完整内容

#### 优点

1. **常驻服务** - Sanqian 始终运行，可以及时更新索引
2. **跨应用搜索** - 可以同时搜索 Notes、TodoList 等多个 App 的内容
3. **统一管理** - 向量模型、存储策略集中管理
4. **App 更轻量** - Notes 不需要引入 sqlite-vec 依赖

#### 缺点

1. **依赖 Sanqian** - 搜索必须 Sanqian 在线
2. **数据分散** - 向量索引不在 App 本地（但原始数据仍在）
3. **架构复杂** - Sanqian 需要维护多租户向量库

#### 业界案例

- **Apple Spotlight**: 系统级 mds daemon 统一管理索引，App 通过 Core Spotlight API 提交内容
- **Windows Search Indexer**: SearchIndexer.exe 常驻服务，统一索引所有 App 内容
- **Constella**: 多端 App + 中心化 Weaviate 向量库
- **Pinecone Multi-tenancy**: namespace 隔离不同租户/应用的向量

---

## 方案对比总结

| 维度 | 方案 A (API Only) | 方案 B (托管向量) |
|------|------------------|------------------|
| **向量存储位置** | Notes 本地 | Sanqian |
| **Sanqian 角色** | 纯计算 API | 计算 + 存储 + 检索 |
| **数据主权** | 完全在 App | 原文在 App，向量在 Sanqian |
| **离线搜索** | ✅ 可以 | ❌ 需要 Sanqian 在线 |
| **跨应用搜索** | ❌ 不支持 | ✅ 支持 |
| **App 复杂度** | 较高（需实现向量存储） | 较低 |
| **Sanqian 复杂度** | 低 | 较高 |
| **业界参考** | LangChain, Obsidian | Spotlight, Windows Search |

---

## 方案 A 详细实施

### 1. Sanqian SDK 扩展

```typescript
// @anthropic/sanqian-sdk 新增接口

interface EmbeddingAPI {
  /**
   * 生成文本向量 (无状态)
   */
  generate(params: {
    texts: string[]
    model?: string  // 默认使用 Sanqian 配置的模型
  }): Promise<{
    embeddings: number[][]
    model: string
    dimensions: number
    usage: { tokens: number }
  }>
}

// 使用示例
const { embeddings } = await sdk.embedding.generate({
  texts: ['这是一段笔记内容', '另一段内容']
})
// embeddings = [[0.1, 0.2, ...], [0.3, 0.4, ...]]
```

### 2. Notes 向量存储

```sql
-- notes_vectors.db (sqlite-vec)

-- 文档元数据表
CREATE TABLE doc_meta (
    doc_id TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,  -- 用于判断是否需要重新 embedding
    chunk_count INTEGER,
    updated_at TEXT
);

-- 向量表
CREATE VIRTUAL TABLE embeddings USING vec0(
    chunk_id TEXT PRIMARY KEY,   -- "{doc_id}:{chunk_index}"
    doc_id TEXT,
    chunk_text TEXT,             -- 原始文本块（用于搜索结果展示）
    embedding FLOAT[1536]        -- 向量维度取决于模型
);

-- 索引
CREATE INDEX idx_embeddings_doc ON embeddings(doc_id);
```

### 3. Embedding Manager 实现

```typescript
// Notes: src/main/embedding-manager.ts

import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import { createHash } from 'crypto'

interface EmbeddingManagerConfig {
  dbPath: string
  sdk: SanqianSDK
  chunkSize?: number      // 默认 512 tokens
  chunkOverlap?: number   // 默认 50 tokens
}

export class EmbeddingManager {
  private db: Database.Database
  private sdk: SanqianSDK
  private chunkSize: number
  private chunkOverlap: number

  constructor(config: EmbeddingManagerConfig) {
    this.db = new Database(config.dbPath)
    sqliteVec.load(this.db)
    this.sdk = config.sdk
    this.chunkSize = config.chunkSize ?? 512
    this.chunkOverlap = config.chunkOverlap ?? 50
    this.initTables()
  }

  private initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS doc_meta (
        doc_id TEXT PRIMARY KEY,
        content_hash TEXT NOT NULL,
        chunk_count INTEGER,
        updated_at TEXT
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS embeddings USING vec0(
        chunk_id TEXT PRIMARY KEY,
        doc_id TEXT,
        chunk_text TEXT,
        embedding FLOAT[1536]
      );
    `)
  }

  /**
   * 计算内容哈希
   */
  private hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex').slice(0, 16)
  }

  /**
   * 文本分块 - Markdown 感知
   */
  private chunkContent(content: string): string[] {
    const chunks: string[] = []

    // 按 Markdown 标题和段落分割
    const sections = content.split(/(?=^#{1,6}\s)/m)

    for (const section of sections) {
      if (section.trim().length === 0) continue

      // 如果 section 太长，进一步按段落分割
      if (section.length > this.chunkSize * 4) {
        const paragraphs = section.split(/\n\n+/)
        let currentChunk = ''

        for (const para of paragraphs) {
          if ((currentChunk + para).length > this.chunkSize * 4) {
            if (currentChunk) chunks.push(currentChunk.trim())
            currentChunk = para
          } else {
            currentChunk += '\n\n' + para
          }
        }
        if (currentChunk) chunks.push(currentChunk.trim())
      } else {
        chunks.push(section.trim())
      }
    }

    return chunks.filter(c => c.length > 0)
  }

  /**
   * 更新笔记的 embedding
   */
  async updateNote(note: { id: string; content: string }): Promise<void> {
    const contentHash = this.hashContent(note.content)

    // 检查是否需要更新
    const existing = this.db.prepare(
      'SELECT content_hash FROM doc_meta WHERE doc_id = ?'
    ).get(note.id) as { content_hash: string } | undefined

    if (existing?.content_hash === contentHash) {
      return // 内容未变，跳过
    }

    // 分块
    const chunks = this.chunkContent(note.content)

    if (chunks.length === 0) {
      this.deleteNote(note.id)
      return
    }

    // 调用 Sanqian 生成向量
    const { embeddings } = await this.sdk.embedding.generate({
      texts: chunks
    })

    // 事务更新
    const transaction = this.db.transaction(() => {
      // 删除旧的
      this.db.prepare('DELETE FROM embeddings WHERE doc_id = ?').run(note.id)

      // 插入新的
      const insertStmt = this.db.prepare(
        'INSERT INTO embeddings (chunk_id, doc_id, chunk_text, embedding) VALUES (?, ?, ?, ?)'
      )

      for (let i = 0; i < chunks.length; i++) {
        insertStmt.run(
          `${note.id}:${i}`,
          note.id,
          chunks[i],
          new Float32Array(embeddings[i])
        )
      }

      // 更新元数据
      this.db.prepare(`
        INSERT OR REPLACE INTO doc_meta (doc_id, content_hash, chunk_count, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(note.id, contentHash, chunks.length, new Date().toISOString())
    })

    transaction()
  }

  /**
   * 删除笔记的 embedding
   */
  deleteNote(noteId: string): void {
    this.db.prepare('DELETE FROM embeddings WHERE doc_id = ?').run(noteId)
    this.db.prepare('DELETE FROM doc_meta WHERE doc_id = ?').run(noteId)
  }

  /**
   * 语义搜索
   */
  async search(query: string, limit: number = 10): Promise<SearchResult[]> {
    // 生成查询向量
    const { embeddings } = await this.sdk.embedding.generate({
      texts: [query]
    })
    const queryVec = new Float32Array(embeddings[0])

    // 向量搜索
    const results = this.db.prepare(`
      SELECT
        doc_id,
        chunk_text,
        vec_distance_cosine(embedding, ?) as distance
      FROM embeddings
      ORDER BY distance ASC
      LIMIT ?
    `).all(queryVec, limit) as Array<{
      doc_id: string
      chunk_text: string
      distance: number
    }>

    return results.map(r => ({
      docId: r.doc_id,
      chunkText: r.chunk_text,
      score: 1 - r.distance  // 转为相似度分数
    }))
  }

  /**
   * 全量同步 - 启动时调用
   */
  async syncAll(notes: Array<{ id: string; content: string }>): Promise<{
    synced: number
    skipped: number
  }> {
    let synced = 0
    let skipped = 0

    for (const note of notes) {
      const contentHash = this.hashContent(note.content)
      const existing = this.db.prepare(
        'SELECT content_hash FROM doc_meta WHERE doc_id = ?'
      ).get(note.id) as { content_hash: string } | undefined

      if (existing?.content_hash === contentHash) {
        skipped++
      } else {
        await this.updateNote(note)
        synced++
      }
    }

    // 清理已删除的笔记
    const existingIds = new Set(notes.map(n => n.id))
    const dbIds = this.db.prepare('SELECT doc_id FROM doc_meta').all() as Array<{ doc_id: string }>

    for (const { doc_id } of dbIds) {
      if (!existingIds.has(doc_id)) {
        this.deleteNote(doc_id)
      }
    }

    return { synced, skipped }
  }
}

interface SearchResult {
  docId: string
  chunkText: string
  score: number
}
```

### 4. 集成到 Notes 主进程

```typescript
// Notes: src/main/index.ts

import { EmbeddingManager } from './embedding-manager'

let embeddingManager: EmbeddingManager | null = null

app.whenReady().then(async () => {
  // ... 现有初始化代码

  // 初始化 Embedding Manager
  if (sdk) {
    embeddingManager = new EmbeddingManager({
      dbPath: join(app.getPath('userData'), 'notes_vectors.db'),
      sdk
    })

    // 启动时全量同步
    const notes = await getNotes()
    const { synced, skipped } = await embeddingManager.syncAll(
      notes.map(n => ({ id: n.id, content: n.content }))
    )
    console.log(`Embedding sync: ${synced} updated, ${skipped} skipped`)
  }
})

// 笔记更新时同步
ipcMain.handle('note:update', async (_, id, updates) => {
  const result = await updateNote(id, updates)

  // 如果内容有变化，更新 embedding
  if (updates.content && embeddingManager) {
    const note = await getNoteById(id)
    if (note) {
      await embeddingManager.updateNote({ id, content: note.content })
    }
  }

  return result
})

// 笔记删除时同步
ipcMain.handle('note:delete', async (_, id) => {
  const result = await deleteNote(id)
  embeddingManager?.deleteNote(id)
  return result
})

// 语义搜索 IPC
ipcMain.handle('note:semanticSearch', async (_, query: string) => {
  if (!embeddingManager) {
    throw new Error('Embedding manager not initialized')
  }
  return embeddingManager.search(query)
})
```

### 5. Preload API

```typescript
// Notes: src/preload/index.ts

contextBridge.exposeInMainWorld('electron', {
  // ... 现有 API

  note: {
    // ... 现有方法
    semanticSearch: (query: string) => ipcRenderer.invoke('note:semanticSearch', query),
  },
})
```

---

## 方案 B 详细实施

### 1. Sanqian SDK 扩展

```typescript
// @anthropic/sanqian-sdk 新增接口

interface EmbeddingAPI {
  /**
   * 同步文档到向量库
   */
  sync(params: {
    namespace: string
    documents: Array<{
      id: string
      content: string
      title?: string
      metadata?: Record<string, unknown>
    }>
  }): Promise<{
    synced: number
    skipped: number
    errors: Array<{ id: string; error: string }>
  }>

  /**
   * 删除文档
   */
  delete(params: {
    namespace: string
    ids: string[]
  }): Promise<{ deleted: number }>

  /**
   * 语义搜索
   */
  search(params: {
    query: string
    namespaces?: string[]  // 不指定则搜索所有
    limit?: number
    threshold?: number     // 相似度阈值 0-1
    filter?: Record<string, unknown>
  }): Promise<Array<{
    namespace: string
    docId: string
    chunkText: string
    score: number
    title?: string
    metadata?: Record<string, unknown>
  }>>

  /**
   * 获取统计信息
   */
  stats(namespace?: string): Promise<{
    namespaces: Array<{
      namespace: string
      documentCount: number
      chunkCount: number
      lastUpdated: string
    }>
  }>
}
```

### 2. Sanqian 向量存储

```sql
-- sanqian_vectors.db (sqlite-vec)

-- 文档元数据表
CREATE TABLE documents (
    id TEXT PRIMARY KEY,           -- 全局唯一: "{namespace}:{doc_id}"
    namespace TEXT NOT NULL,
    doc_id TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    title TEXT,
    metadata TEXT,                  -- JSON
    created_at TEXT,
    updated_at TEXT,

    UNIQUE(namespace, doc_id)
);

-- 向量表
CREATE VIRTUAL TABLE embeddings USING vec0(
    chunk_id TEXT PRIMARY KEY,
    doc_id TEXT,                    -- 关联 documents.id
    namespace TEXT,
    chunk_text TEXT,
    embedding FLOAT[1536]
);

-- 索引
CREATE INDEX idx_documents_namespace ON documents(namespace);
CREATE INDEX idx_embeddings_namespace ON embeddings(namespace);
CREATE INDEX idx_embeddings_doc ON embeddings(doc_id);
```

### 3. Sanqian Embedding Service

```typescript
// Sanqian: src/services/embedding-service.ts

export class EmbeddingService {
  private db: Database.Database
  private embeddingModel: string

  async sync(params: SyncParams): Promise<SyncResult> {
    const { namespace, documents } = params
    let synced = 0
    let skipped = 0
    const errors: Array<{ id: string; error: string }> = []

    for (const doc of documents) {
      try {
        const contentHash = this.hashContent(doc.content)
        const globalId = `${namespace}:${doc.id}`

        // 检查是否需要更新
        const existing = this.db.prepare(
          'SELECT content_hash FROM documents WHERE id = ?'
        ).get(globalId) as { content_hash: string } | undefined

        if (existing?.content_hash === contentHash) {
          skipped++
          continue
        }

        // 分块并生成向量
        const chunks = this.chunkContent(doc.content)
        const embeddings = await this.generateEmbeddings(chunks)

        // 事务更新
        this.db.transaction(() => {
          // 删除旧向量
          this.db.prepare('DELETE FROM embeddings WHERE doc_id = ?').run(globalId)

          // 插入新向量
          for (let i = 0; i < chunks.length; i++) {
            this.db.prepare(`
              INSERT INTO embeddings (chunk_id, doc_id, namespace, chunk_text, embedding)
              VALUES (?, ?, ?, ?, ?)
            `).run(
              `${globalId}:${i}`,
              globalId,
              namespace,
              chunks[i],
              new Float32Array(embeddings[i])
            )
          }

          // 更新文档元数据
          this.db.prepare(`
            INSERT OR REPLACE INTO documents
            (id, namespace, doc_id, content_hash, title, metadata, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            globalId,
            namespace,
            doc.id,
            contentHash,
            doc.title || null,
            JSON.stringify(doc.metadata || {}),
            new Date().toISOString()
          )
        })()

        synced++
      } catch (error) {
        errors.push({ id: doc.id, error: String(error) })
      }
    }

    return { synced, skipped, errors }
  }

  async search(params: SearchParams): Promise<SearchResult[]> {
    const { query, namespaces, limit = 10, threshold } = params

    // 生成查询向量
    const [queryEmbedding] = await this.generateEmbeddings([query])
    const queryVec = new Float32Array(queryEmbedding)

    // 构建查询
    let sql = `
      SELECT
        e.namespace,
        d.doc_id,
        e.chunk_text,
        d.title,
        d.metadata,
        vec_distance_cosine(e.embedding, ?) as distance
      FROM embeddings e
      JOIN documents d ON e.doc_id = d.id
      WHERE 1=1
    `
    const sqlParams: unknown[] = [queryVec]

    // Namespace 过滤
    if (namespaces?.length) {
      sql += ` AND e.namespace IN (${namespaces.map(() => '?').join(',')})`
      sqlParams.push(...namespaces)
    }

    // 相似度阈值
    if (threshold) {
      sql += ` AND vec_distance_cosine(e.embedding, ?) < ?`
      sqlParams.push(queryVec, 1 - threshold)
    }

    sql += ` ORDER BY distance ASC LIMIT ?`
    sqlParams.push(limit)

    const rows = this.db.prepare(sql).all(...sqlParams) as RawSearchResult[]

    return rows.map(r => ({
      namespace: r.namespace,
      docId: r.doc_id,
      chunkText: r.chunk_text,
      score: 1 - r.distance,
      title: r.title,
      metadata: JSON.parse(r.metadata || '{}')
    }))
  }

  async delete(params: DeleteParams): Promise<{ deleted: number }> {
    const { namespace, ids } = params
    let deleted = 0

    for (const id of ids) {
      const globalId = `${namespace}:${id}`

      this.db.transaction(() => {
        this.db.prepare('DELETE FROM embeddings WHERE doc_id = ?').run(globalId)
        const result = this.db.prepare('DELETE FROM documents WHERE id = ?').run(globalId)
        deleted += result.changes
      })()
    }

    return { deleted }
  }
}
```

### 4. Notes 端集成

```typescript
// Notes: src/main/sanqian-integration.ts

export async function initSanqianIntegration() {
  // 连接 Sanqian
  await sdk.connect()

  // 启动时全量同步
  const notes = await getNotes()
  const { synced, skipped } = await sdk.embedding.sync({
    namespace: 'notes',
    documents: notes.map(n => ({
      id: n.id,
      content: n.content,
      title: n.title,
      metadata: {
        notebookId: n.notebookId,
        tags: n.tags,
        createdAt: n.createdAt
      }
    }))
  })

  console.log(`Synced to Sanqian: ${synced} updated, ${skipped} skipped`)
}

// 笔记更新时通知 Sanqian
export async function onNoteUpdated(note: Note) {
  await sdk.embedding.sync({
    namespace: 'notes',
    documents: [{
      id: note.id,
      content: note.content,
      title: note.title,
      metadata: {
        notebookId: note.notebookId,
        tags: note.tags,
        updatedAt: note.updatedAt
      }
    }]
  })
}

// 笔记删除时通知 Sanqian
export async function onNoteDeleted(noteId: string) {
  await sdk.embedding.delete({
    namespace: 'notes',
    ids: [noteId]
  })
}

// 语义搜索
export async function semanticSearch(query: string) {
  return sdk.embedding.search({
    query,
    namespaces: ['notes'],
    limit: 10
  })
}

// 跨应用搜索 (方案 B 独有能力)
export async function universalSearch(query: string) {
  return sdk.embedding.search({
    query,
    // 不指定 namespace，搜索所有
    limit: 10
  })
}
```

---

## 实施建议

### 推荐选择

**如果优先考虑：**
- 数据主权、离线能力、隐私 → **方案 A**
- 跨应用搜索、统一管理、App 轻量化 → **方案 B**

### 渐进式实施

可以先实施方案 A，后续如果需要跨应用搜索能力，再迁移到方案 B：

1. **Phase 1**: 实施方案 A，Notes 本地存储向量
2. **Phase 2**: 如果需要，将向量迁移到 Sanqian，升级为方案 B

两个方案的 Sanqian SDK API 可以设计为兼容，方便后续迁移。

---

## 参考资料

### 业界案例

- [LangChain Caching Embeddings](https://python.langchain.com/docs/how_to/caching_embeddings/)
- [OpenAI Embeddings Guide](https://platform.openai.com/docs/guides/embeddings)
- [sqlite-vec](https://github.com/asg017/sqlite-vec)
- [Apple Core Spotlight](https://developer.apple.com/documentation/corespotlight)
- [Pinecone Multitenancy](https://docs.pinecone.io/guides/index-data/implement-multitenancy)
- [Constella + Weaviate](https://weaviate.io/blog/vector-search-cross-platform-sync-constella)

### 技术文档

- [Building RAG on SQLite](https://blog.sqlite.ai/building-a-rag-on-sqlite)
- [Obsidian Copilot](https://github.com/logancyang/obsidian-copilot)
- [WWDC24: Semantic Search with Core Spotlight](https://developer.apple.com/videos/play/wwdc2024/10131/)
