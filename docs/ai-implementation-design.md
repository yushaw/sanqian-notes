# 散墨笔记 AI 能力实现设计

> 基于业界调研和 TodoList 实践，设计散墨笔记的 AI 能力架构

---

## 目录

1. [设计原则](#设计原则)
2. [整体架构](#整体架构)
3. [交互层设计](#一交互层设计)
4. [AI Service 层设计](#二ai-service-层设计)
5. [数据层设计](#三数据层设计)
6. [Agent 与 Tools 设计](#四agent-与-tools-设计)
7. [用户上下文设计](#五用户上下文设计)
8. [实现路线图](#六实现路线图)

---

## 设计原则

1. **场景驱动**：不同场景用不同交互，对话框不是唯一入口
2. **本地优先**：支持本地模型，保护用户隐私
3. **渐进增强**：核心功能不依赖 AI，AI 是增强而非必需
4. **流式响应**：所有生成类操作都应流式输出
5. **可撤销**：所有 AI 操作都可以撤销

---

## 整体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                           交互层                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────┐  │
│  │  选中文本菜单  │  │   斜杠命令    │  │  AI 侧边面板  │  │ Ghost   │  │
│  │  (右键/快捷键) │  │  (/ai xxx)   │  │  (对话/推荐)  │  │ Text    │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └────┬────┘  │
│         │                 │                 │               │       │
│         └─────────────────┴─────────────────┴───────────────┘       │
│                                   │                                  │
├───────────────────────────────────┼──────────────────────────────────┤
│                           AI Service 层                              │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                      AIService (单例)                          │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │ │
│  │  │ PromptMgr   │  │ ContextMgr  │  │     StreamHandler       │ │ │
│  │  │ (模板管理)   │  │ (上下文构建) │  │     (流式处理)          │ │ │
│  │  └─────────────┘  └─────────────┘  └─────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                   │                                  │
├───────────────────────────────────┼──────────────────────────────────┤
│                           Provider 层                                │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │
│  │  Sanqian SDK    │  │  Direct API     │  │   Local Model       │  │
│  │  (统一管理)      │  │  (OpenAI/Claude)│  │   (Ollama)          │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────┘  │
│                                   │                                  │
├───────────────────────────────────┼──────────────────────────────────┤
│                           数据层                                     │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                        SQLite                                   ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ ││
│  │  │   notes     │  │  embeddings │  │   ai_conversations      │ ││
│  │  │  (笔记表)    │  │  (向量表)    │  │   (对话历史)            │ ││
│  │  └─────────────┘  └─────────────┘  └─────────────────────────┘ ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

---

## 一、交互层设计

### 1.1 选中文本菜单

**触发方式**：
- 选中文本后右键菜单
- 快捷键 `⌘J` 打开 AI 菜单

**功能列表**：
| 功能 | 快捷键 | 描述 |
|------|--------|------|
| 润色 | `⌘J I` | 改善表达，修复语法 |
| 简化 | `⌘J S` | 让内容更简洁易懂 |
| 扩写 | `⌘J E` | 让内容更详细 |
| 翻译 | `⌘J T` | 中英互译 |
| 总结 | `⌘J M` | 生成摘要 |
| 解释 | `⌘J X` | 解释选中概念 |

**交互流程**：
```
选中文本 → ⌘J → 显示 AI 菜单 → 选择操作 →
→ 流式生成 → 弹窗预览 → 确认替换/插入
```

**UI 设计**：
```
┌──────────────────────────────┐
│  ✨ AI 助手                  │
├──────────────────────────────┤
│  📝 润色改写        ⌘J I     │
│  📐 简化语言        ⌘J S     │
│  📖 扩写详述        ⌘J E     │
│  🌐 翻译            ⌘J T     │
│  📋 总结摘要        ⌘J M     │
│  💡 解释说明        ⌘J X     │
├──────────────────────────────┤
│  🗣️ 自定义指令...            │
└──────────────────────────────┘
```

### 1.2 斜杠命令

**触发方式**：输入 `/ai` 或 `/`

**命令列表**：
| 命令 | 描述 |
|------|------|
| `/ai` | 通用 AI 指令（自由输入） |
| `/ai 续写` | 根据上文继续写作 |
| `/ai 大纲` | 生成文章大纲 |
| `/ai 头脑风暴` | 围绕主题生成想法 |
| `/ai 表格` | 将内容转换为表格 |

**交互流程**：
```
输入 /ai → 显示命令菜单/输入框 →
→ 回车确认 → 流式生成 → 直接插入光标处
```

### 1.3 AI 侧边面板

**触发方式**：
- 工具栏按钮
- 快捷键 `⌘⇧J`

**功能**：
- 对话式交互（Q&A）
- 基于当前笔记/选中内容对话
- 基于整个笔记库对话（需要 Embedding）
- 相关笔记推荐
- 对话历史

**布局**：
```
┌─────────────────────────────────────────┐
│  AI 助手                         [×]    │
├─────────────────────────────────────────┤
│  ┌─────────────────────────────────┐    │
│  │ 💬 对话  │ 🔗 相关笔记           │    │
│  └─────────────────────────────────┘    │
│                                         │
│  [用户消息气泡]                          │
│                                         │
│  [AI 回复气泡 - 流式显示]                │
│                                         │
│  [Tool Call 状态指示]                    │
│                                         │
├─────────────────────────────────────────┤
│  [输入框]                    [发送]     │
│  📎 当前笔记 │ 📚 整个笔记库             │
└─────────────────────────────────────────┘
```

### 1.4 Ghost Text（可选，Phase 3）

**触发方式**：
- 打字暂停 500ms 后自动触发
- 仅在空行或句末触发

**交互**：
- Tab 接受全部
- → 接受一个词
- Esc 或继续打字忽略

---

## 二、AI Service 层设计

### 2.1 核心接口

```typescript
// src/main/ai/types.ts

export interface AIProvider {
  id: string
  name: string
  chat(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<ChatEvent>
  embed?(text: string): Promise<number[]>
  isAvailable(): Promise<boolean>
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

export interface ChatOptions {
  model?: string
  temperature?: number
  maxTokens?: number
  tools?: ToolDefinition[]
  stream?: boolean
}

export interface ChatEvent {
  type: 'text' | 'tool_call' | 'done' | 'error'
  content?: string
  tool_call?: ToolCall
  error?: string
}
```

### 2.2 Prompt 模板管理

```typescript
// src/main/ai/prompts.ts

export const PROMPTS = {
  // 写作辅助
  improve: {
    system: '你是一个专业的文字编辑。请改善以下文字的表达，修复语法错误，让它更流畅自然。保持原意，不要添加新内容。',
    user: '请润色以下内容：\n\n{content}'
  },

  simplify: {
    system: '你是一个专业的文字编辑。请简化以下内容，让它更简洁易懂。保持核心信息，去除冗余。',
    user: '请简化以下内容：\n\n{content}'
  },

  expand: {
    system: '你是一个专业的写作助手。请扩写以下内容，添加更多细节和解释，让它更丰富完整。',
    user: '请扩写以下内容：\n\n{content}'
  },

  translate: {
    system: '你是一个专业的翻译。请将以下内容翻译成{targetLang}。保持原文风格和格式。',
    user: '{content}'
  },

  summarize: {
    system: '你是一个专业的内容分析师。请总结以下内容的要点，生成简洁的摘要。',
    user: '请总结以下内容：\n\n{content}'
  },

  explain: {
    system: '你是一个知识渊博的老师。请用简单易懂的语言解释以下概念或内容。',
    user: '请解释以下内容：\n\n{content}'
  },

  // 生成类
  continue: {
    system: '你是一个专业的写作助手。请根据上文风格和内容，继续写作。不要重复上文，直接续写。',
    user: '请续写以下内容：\n\n{content}'
  },

  outline: {
    system: '你是一个专业的写作顾问。请为以下主题生成一个结构清晰的大纲。',
    user: '请为以下主题生成大纲：\n\n{topic}'
  },

  brainstorm: {
    system: '你是一个创意顾问。请围绕以下主题进行头脑风暴，生成多个相关的想法和角度。',
    user: '请围绕以下主题进行头脑风暴：\n\n{topic}'
  }
}
```

### 2.3 上下文构建

```typescript
// src/main/ai/context.ts

export interface NoteContext {
  currentNote: {
    id: string
    title: string
    content: string      // 当前笔记内容（可能截断）
    wordCount: number
  } | null
  selectedText: string | null
  cursorPosition: {
    paragraph: number    // 当前段落索引
    offset: number       // 段落内偏移
  } | null
  recentNotes: Array<{   // 最近编辑的笔记
    id: string
    title: string
    preview: string
  }>
}

export function buildContextPrompt(context: NoteContext, t: Translations): string {
  const parts: string[] = []

  if (context.currentNote) {
    parts.push(t.context.currentNote
      .replace('{title}', context.currentNote.title)
      .replace('{wordCount}', String(context.currentNote.wordCount)))
  }

  if (context.selectedText) {
    parts.push(t.context.selectedText
      .replace('{text}', truncate(context.selectedText, 200)))
  }

  if (context.recentNotes.length > 0) {
    const notesList = context.recentNotes
      .map(n => `「${n.title}」`)
      .join('、')
    parts.push(t.context.recentNotes
      .replace('{count}', String(context.recentNotes.length))
      .replace('{list}', notesList))
  }

  return parts.join('。') + '。'
}
```

---

## 三、数据层设计

### 3.1 数据库 Schema 扩展

```sql
-- 笔记 Embedding 表
CREATE TABLE IF NOT EXISTS note_embeddings (
  note_id TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
  embedding BLOB NOT NULL,           -- 向量数据 (Float32Array 序列化)
  embedding_model TEXT NOT NULL,     -- 使用的模型 (e.g., 'text-embedding-3-small')
  content_hash TEXT NOT NULL,        -- 内容哈希，用于检测是否需要更新
  updated_at TEXT NOT NULL
);

-- 段落级 Embedding 表（可选，用于更精细的检索）
CREATE TABLE IF NOT EXISTS paragraph_embeddings (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  paragraph_index INTEGER NOT NULL,  -- 段落在笔记中的索引
  content TEXT NOT NULL,             -- 段落内容
  embedding BLOB NOT NULL,
  embedding_model TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_paragraph_embeddings_note ON paragraph_embeddings(note_id);

-- AI 对话历史表
CREATE TABLE IF NOT EXISTS ai_conversations (
  id TEXT PRIMARY KEY,
  title TEXT,
  note_id TEXT REFERENCES notes(id) ON DELETE SET NULL,  -- 关联的笔记（可选）
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,                -- 'user' | 'assistant' | 'system' | 'tool'
  content TEXT NOT NULL,
  tool_calls TEXT,                   -- JSON: ToolCall[]
  tool_call_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_ai_messages_conversation ON ai_messages(conversation_id);
```

### 3.2 Embedding 服务

```typescript
// src/main/ai/embedding.ts

import { AIProvider } from './types'
import { getDb } from '../database'
import crypto from 'crypto'

export class EmbeddingService {
  private provider: AIProvider
  private model: string

  constructor(provider: AIProvider, model = 'text-embedding-3-small') {
    this.provider = provider
    this.model = model
  }

  /**
   * 为笔记生成 Embedding
   */
  async embedNote(noteId: string, content: string): Promise<void> {
    if (!this.provider.embed) {
      throw new Error('Provider does not support embedding')
    }

    const contentHash = crypto.createHash('md5').update(content).digest('hex')
    const db = getDb()

    // 检查是否需要更新
    const existing = db.prepare(
      'SELECT content_hash FROM note_embeddings WHERE note_id = ?'
    ).get(noteId) as { content_hash: string } | undefined

    if (existing?.content_hash === contentHash) {
      return // 内容未变化，跳过
    }

    // 生成 Embedding
    const embedding = await this.provider.embed(content)
    const embeddingBlob = Buffer.from(new Float32Array(embedding).buffer)

    // 存储
    db.prepare(`
      INSERT OR REPLACE INTO note_embeddings
      (note_id, embedding, embedding_model, content_hash, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(noteId, embeddingBlob, this.model, contentHash)
  }

  /**
   * 批量更新所有笔记的 Embedding
   */
  async embedAllNotes(onProgress?: (current: number, total: number) => void): Promise<void> {
    const db = getDb()
    const notes = db.prepare(
      'SELECT id, title, content FROM notes WHERE is_deleted = 0'
    ).all() as Array<{ id: string; title: string; content: string }>

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i]
      const textContent = this.extractText(note.content)
      await this.embedNote(note.id, `${note.title}\n\n${textContent}`)
      onProgress?.(i + 1, notes.length)
    }
  }

  /**
   * 语义搜索
   */
  async searchSimilar(query: string, limit = 5): Promise<Array<{
    noteId: string
    title: string
    score: number
  }>> {
    if (!this.provider.embed) {
      throw new Error('Provider does not support embedding')
    }

    const queryEmbedding = await this.provider.embed(query)
    const db = getDb()

    // 获取所有 embeddings 并计算相似度
    const rows = db.prepare(`
      SELECT ne.note_id, n.title, ne.embedding
      FROM note_embeddings ne
      JOIN notes n ON n.id = ne.note_id
      WHERE n.is_deleted = 0
    `).all() as Array<{ note_id: string; title: string; embedding: Buffer }>

    const results = rows.map(row => {
      const embedding = new Float32Array(row.embedding.buffer)
      const score = this.cosineSimilarity(queryEmbedding, Array.from(embedding))
      return {
        noteId: row.note_id,
        title: row.title,
        score
      }
    })

    // 按相似度排序
    results.sort((a, b) => b.score - a.score)

    return results.slice(0, limit)
  }

  /**
   * 获取相关笔记（基于当前笔记的 Embedding）
   */
  async getRelatedNotes(noteId: string, limit = 5): Promise<Array<{
    noteId: string
    title: string
    score: number
  }>> {
    const db = getDb()
    const current = db.prepare(
      'SELECT embedding FROM note_embeddings WHERE note_id = ?'
    ).get(noteId) as { embedding: Buffer } | undefined

    if (!current) {
      return []
    }

    const currentEmbedding = new Float32Array(current.embedding.buffer)

    const rows = db.prepare(`
      SELECT ne.note_id, n.title, ne.embedding
      FROM note_embeddings ne
      JOIN notes n ON n.id = ne.note_id
      WHERE n.is_deleted = 0 AND ne.note_id != ?
    `).all(noteId) as Array<{ note_id: string; title: string; embedding: Buffer }>

    const results = rows.map(row => {
      const embedding = new Float32Array(row.embedding.buffer)
      const score = this.cosineSimilarity(
        Array.from(currentEmbedding),
        Array.from(embedding)
      )
      return {
        noteId: row.note_id,
        title: row.title,
        score
      }
    })

    results.sort((a, b) => b.score - a.score)
    return results.slice(0, limit)
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0
    let normA = 0
    let normB = 0
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
  }

  private extractText(content: string): string {
    // 从 Tiptap JSON 中提取纯文本
    try {
      const doc = JSON.parse(content)
      return this.extractTextFromNode(doc)
    } catch {
      return content
    }
  }

  private extractTextFromNode(node: any): string {
    if (!node) return ''
    if (node.type === 'text') return node.text || ''
    if (node.content) {
      return node.content.map((n: any) => this.extractTextFromNode(n)).join(' ')
    }
    return ''
  }
}
```

### 3.3 向量搜索优化（未来）

当笔记数量较大时，可考虑：

1. **SQLite VSS 扩展**：使用 sqlite-vss 插件支持向量索引
2. **分块存储**：将长笔记分成段落级 Embedding
3. **增量更新**：只更新变化的笔记
4. **本地缓存**：缓存常用查询结果

---

## 四、Agent 与 Tools 设计

### 4.1 Agent 配置

```typescript
// src/main/ai/agent.ts

export const NOTES_AGENT_CONFIG = {
  agent_id: 'notes-assistant',
  name: {
    zh: '笔记助手',
    en: 'Notes Assistant'
  },
  description: {
    zh: '帮助你管理笔记、搜索内容、整理知识',
    en: 'Help you manage notes, search content, organize knowledge'
  },
  system_prompt: {
    zh: `你是散墨笔记的 AI 助手。你可以帮助用户：
- 搜索和查找笔记
- 回答基于笔记内容的问题
- 创建和编辑笔记
- 整理和组织知识

你有以下工具可以使用：
- search_notes: 搜索笔记
- get_note: 获取笔记详情
- create_note: 创建新笔记
- update_note: 更新笔记
- get_related_notes: 获取相关笔记

当用户询问时，优先使用工具获取准确信息，而不是猜测。
回答要简洁、准确、有帮助。`,
    en: `You are the AI assistant for Sanqian Notes. You can help users:
- Search and find notes
- Answer questions based on note content
- Create and edit notes
- Organize knowledge

You have the following tools:
- search_notes: Search notes
- get_note: Get note details
- create_note: Create new note
- update_note: Update note
- get_related_notes: Get related notes

When users ask, prefer using tools to get accurate information rather than guessing.
Answers should be concise, accurate, and helpful.`
  },
  tools: [
    'search_notes',
    'get_note',
    'create_note',
    'update_note',
    'get_related_notes'
  ]
}
```

### 4.2 Tools 定义

```typescript
// src/main/ai/tools.ts

import { ToolDefinition } from './types'
import { getDb } from '../database'
import { EmbeddingService } from './embedding'

export function buildNoteTools(
  embeddingService: EmbeddingService,
  t: ToolTranslations
): ToolDefinition[] {
  return [
    // ==================== 搜索笔记 ====================
    {
      name: 'search_notes',
      description: t.searchNotes.description,
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: t.searchNotes.params.query
          },
          semantic: {
            type: 'boolean',
            description: t.searchNotes.params.semantic
          },
          limit: {
            type: 'number',
            description: t.searchNotes.params.limit
          }
        },
        required: ['query']
      },
      handler: async (args: { query: string; semantic?: boolean; limit?: number }) => {
        const limit = args.limit || 10

        if (args.semantic) {
          // 语义搜索
          const results = await embeddingService.searchSimilar(args.query, limit)
          return results.map(r => ({
            id: r.noteId,
            title: r.title,
            relevance: r.score
          }))
        } else {
          // 关键词搜索
          const db = getDb()
          const notes = db.prepare(`
            SELECT id, title, content
            FROM notes
            WHERE is_deleted = 0
              AND (title LIKE ? OR content LIKE ?)
            ORDER BY updated_at DESC
            LIMIT ?
          `).all(`%${args.query}%`, `%${args.query}%`, limit)

          return notes.map((n: any) => ({
            id: n.id,
            title: n.title,
            preview: extractPreview(n.content, args.query)
          }))
        }
      }
    },

    // ==================== 获取笔记详情 ====================
    {
      name: 'get_note',
      description: t.getNote.description,
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: t.getNote.params.id
          }
        },
        required: ['id']
      },
      handler: async (args: { id: string }) => {
        const db = getDb()
        const note = db.prepare(`
          SELECT id, title, content, created_at, updated_at
          FROM notes
          WHERE id = ? AND is_deleted = 0
        `).get(args.id) as any

        if (!note) {
          throw new Error('Note not found')
        }

        return {
          id: note.id,
          title: note.title,
          content: extractText(note.content),
          createdAt: note.created_at,
          updatedAt: note.updated_at
        }
      }
    },

    // ==================== 创建笔记 ====================
    {
      name: 'create_note',
      description: t.createNote.description,
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: t.createNote.params.title
          },
          content: {
            type: 'string',
            description: t.createNote.params.content
          }
        },
        required: ['title']
      },
      handler: async (args: { title: string; content?: string }) => {
        const db = getDb()
        const id = crypto.randomUUID()
        const now = new Date().toISOString()

        // 构建 Tiptap 文档结构
        const doc = {
          type: 'doc',
          content: args.content ? [
            { type: 'paragraph', content: [{ type: 'text', text: args.content }] }
          ] : []
        }

        db.prepare(`
          INSERT INTO notes (id, title, content, created_at, updated_at, is_deleted, is_pinned)
          VALUES (?, ?, ?, ?, ?, 0, 0)
        `).run(id, args.title, JSON.stringify(doc), now, now)

        return { id, title: args.title, created: true }
      }
    },

    // ==================== 更新笔记 ====================
    {
      name: 'update_note',
      description: t.updateNote.description,
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: t.updateNote.params.id
          },
          title: {
            type: 'string',
            description: t.updateNote.params.title
          },
          append_content: {
            type: 'string',
            description: t.updateNote.params.appendContent
          }
        },
        required: ['id']
      },
      handler: async (args: { id: string; title?: string; append_content?: string }) => {
        const db = getDb()
        const now = new Date().toISOString()

        if (args.title) {
          db.prepare('UPDATE notes SET title = ?, updated_at = ? WHERE id = ?')
            .run(args.title, now, args.id)
        }

        if (args.append_content) {
          // 追加内容到笔记末尾
          const note = db.prepare('SELECT content FROM notes WHERE id = ?').get(args.id) as any
          if (note) {
            const doc = JSON.parse(note.content)
            doc.content.push({
              type: 'paragraph',
              content: [{ type: 'text', text: args.append_content }]
            })
            db.prepare('UPDATE notes SET content = ?, updated_at = ? WHERE id = ?')
              .run(JSON.stringify(doc), now, args.id)
          }
        }

        return { id: args.id, updated: true }
      }
    },

    // ==================== 获取相关笔记 ====================
    {
      name: 'get_related_notes',
      description: t.getRelatedNotes.description,
      parameters: {
        type: 'object',
        properties: {
          note_id: {
            type: 'string',
            description: t.getRelatedNotes.params.noteId
          },
          limit: {
            type: 'number',
            description: t.getRelatedNotes.params.limit
          }
        },
        required: ['note_id']
      },
      handler: async (args: { note_id: string; limit?: number }) => {
        const results = await embeddingService.getRelatedNotes(args.note_id, args.limit || 5)
        return results.map(r => ({
          id: r.noteId,
          title: r.title,
          relevance: r.score
        }))
      }
    }
  ]
}

// 辅助函数
function extractText(content: string): string {
  try {
    const doc = JSON.parse(content)
    return extractTextFromNode(doc)
  } catch {
    return content
  }
}

function extractTextFromNode(node: any): string {
  if (!node) return ''
  if (node.type === 'text') return node.text || ''
  if (node.content) {
    return node.content.map((n: any) => extractTextFromNode(n)).join('\n')
  }
  return ''
}

function extractPreview(content: string, query: string, maxLength = 100): string {
  const text = extractText(content)
  const index = text.toLowerCase().indexOf(query.toLowerCase())
  if (index === -1) return text.slice(0, maxLength)

  const start = Math.max(0, index - 30)
  const end = Math.min(text.length, index + query.length + 70)
  let preview = text.slice(start, end)
  if (start > 0) preview = '...' + preview
  if (end < text.length) preview = preview + '...'
  return preview
}
```

### 4.3 Tools 国际化

```typescript
// src/shared/i18n/ai-tools.ts

export const toolTranslations = {
  zh: {
    searchNotes: {
      description: '搜索笔记。支持关键词搜索和语义搜索。',
      params: {
        query: '搜索关键词或问题',
        semantic: '是否使用语义搜索（理解含义而非精确匹配）',
        limit: '返回结果数量上限'
      }
    },
    getNote: {
      description: '获取指定笔记的详细内容',
      params: {
        id: '笔记 ID'
      }
    },
    createNote: {
      description: '创建一个新笔记',
      params: {
        title: '笔记标题',
        content: '笔记内容（可选）'
      }
    },
    updateNote: {
      description: '更新现有笔记',
      params: {
        id: '要更新的笔记 ID',
        title: '新标题（可选）',
        appendContent: '要追加的内容（可选）'
      }
    },
    getRelatedNotes: {
      description: '获取与指定笔记语义相关的其他笔记',
      params: {
        noteId: '笔记 ID',
        limit: '返回结果数量上限'
      }
    }
  },
  en: {
    searchNotes: {
      description: 'Search notes. Supports keyword search and semantic search.',
      params: {
        query: 'Search keyword or question',
        semantic: 'Whether to use semantic search (understand meaning rather than exact match)',
        limit: 'Maximum number of results to return'
      }
    },
    getNote: {
      description: 'Get detailed content of a specific note',
      params: {
        id: 'Note ID'
      }
    },
    createNote: {
      description: 'Create a new note',
      params: {
        title: 'Note title',
        content: 'Note content (optional)'
      }
    },
    updateNote: {
      description: 'Update an existing note',
      params: {
        id: 'ID of the note to update',
        title: 'New title (optional)',
        appendContent: 'Content to append (optional)'
      }
    },
    getRelatedNotes: {
      description: 'Get other notes semantically related to the specified note',
      params: {
        noteId: 'Note ID',
        limit: 'Maximum number of results to return'
      }
    }
  }
}
```

---

## 五、用户上下文设计

参考 TodoList 的实现，Notes 也需要维护用户当前状态：

### 5.1 上下文结构

```typescript
// src/main/ai/user-context.ts

export interface NotesUserContext {
  // 当前笔记
  currentNote: {
    id: string
    title: string
    wordCount: number
    hasSelection: boolean
  } | null

  // 选中的文本
  selectedText: string | null

  // 光标位置信息
  cursorContext: {
    beforeText: string    // 光标前的文本（最多 500 字）
    afterText: string     // 光标后的文本（最多 200 字）
  } | null

  // 侧边栏状态
  sidebarView: 'notes' | 'trash' | 'search'

  // 搜索状态
  searchQuery: string | null
}

let userContext: NotesUserContext = {
  currentNote: null,
  selectedText: null,
  cursorContext: null,
  sidebarView: 'notes',
  searchQuery: null
}

export function setUserContext(context: Partial<NotesUserContext>): void {
  userContext = { ...userContext, ...context }
}

export function getUserContext(): NotesUserContext {
  return { ...userContext }
}
```

### 5.2 格式化为 LLM 可读

```typescript
export function formatContextForLLM(t: ContextTranslations): string {
  const parts: string[] = []
  const ctx = userContext

  // 当前笔记
  if (ctx.currentNote) {
    parts.push(t.currentNote
      .replace('{title}', ctx.currentNote.title)
      .replace('{wordCount}', String(ctx.currentNote.wordCount)))
  } else {
    parts.push(t.noNoteOpen)
  }

  // 选中文本
  if (ctx.selectedText) {
    const preview = ctx.selectedText.length > 100
      ? ctx.selectedText.slice(0, 100) + '...'
      : ctx.selectedText
    parts.push(t.selectedText.replace('{text}', preview))
  }

  // 光标上下文
  if (ctx.cursorContext && !ctx.selectedText) {
    const before = ctx.cursorContext.beforeText.slice(-100)
    parts.push(t.cursorContext.replace('{before}', before))
  }

  return parts.join('。') + '。'
}
```

### 5.3 上下文同步

```typescript
// src/renderer/src/hooks/useAIContext.ts

export function useAIContext(editor: Editor | null, noteId: string | null) {
  useEffect(() => {
    if (!editor || !noteId) {
      window.electron.ai.syncContext({
        currentNote: null,
        selectedText: null,
        cursorContext: null
      })
      return
    }

    const updateContext = () => {
      const { from, to } = editor.state.selection
      const selectedText = from !== to
        ? editor.state.doc.textBetween(from, to)
        : null

      const docText = editor.state.doc.textContent
      const wordCount = docText.length

      // 获取光标上下文
      let cursorContext = null
      if (!selectedText) {
        const beforeText = editor.state.doc.textBetween(
          Math.max(0, from - 500), from
        )
        const afterText = editor.state.doc.textBetween(
          from, Math.min(editor.state.doc.content.size, from + 200)
        )
        cursorContext = { beforeText, afterText }
      }

      window.electron.ai.syncContext({
        currentNote: {
          id: noteId,
          title: currentNoteTitle,
          wordCount,
          hasSelection: !!selectedText
        },
        selectedText,
        cursorContext
      })
    }

    // 监听选择变化
    editor.on('selectionUpdate', updateContext)
    updateContext()

    return () => {
      editor.off('selectionUpdate', updateContext)
    }
  }, [editor, noteId])
}
```

---

## 六、实现路线图

### Phase 1：基础写作辅助（2-3 周）

**目标**：实现选中文本的 AI 操作

- [ ] AI Service 基础架构
  - [ ] Provider 抽象层
  - [ ] Prompt 模板系统
  - [ ] 流式响应处理
- [ ] 选中文本菜单
  - [ ] 右键菜单集成
  - [ ] 快捷键 `⌘J`
  - [ ] 操作：润色、简化、翻译、总结、解释
- [ ] 结果预览弹窗
  - [ ] 流式显示
  - [ ] 确认替换/插入/取消
- [ ] 设置页面
  - [ ] API Key 配置
  - [ ] 模型选择

### Phase 2：斜杠命令与对话面板（2-3 周）

**目标**：实现生成类功能和对话交互

- [ ] 斜杠命令扩展
  - [ ] `/ai` 通用指令
  - [ ] `/ai 续写`、`/ai 大纲` 等
- [ ] AI 侧边面板
  - [ ] 对话 UI（参考 TodoList ChatPanel）
  - [ ] 流式消息显示
  - [ ] 对话历史
- [ ] 用户上下文
  - [ ] 上下文收集与同步
  - [ ] 首条消息注入上下文

### Phase 3：知识管理（3-4 周）

**目标**：实现语义搜索和智能推荐

- [ ] Embedding 基础设施
  - [ ] 数据库 Schema
  - [ ] Embedding 服务
  - [ ] 增量更新策略
- [ ] 语义搜索
  - [ ] 搜索 API
  - [ ] UI 集成
- [ ] 相关笔记推荐
  - [ ] 侧边栏推荐面板
  - [ ] 实时更新

### Phase 4：高级功能（可选）

- [ ] Ghost Text 实时补全
- [ ] 自动标签建议
- [ ] 语音输入（Whisper）
- [ ] 本地模型支持（Ollama）

---

## 更新日志

| 日期 | 更新内容 |
|------|----------|
| 2024-12-20 | 初版设计，涵盖交互层、服务层、数据层、Agent/Tools |
