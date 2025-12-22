# 散墨笔记 AI 能力实现设计

> 基于 Sanqian SDK 和 TodoList 实践，设计散墨笔记的 AI 能力架构

---

## 目录

1. [设计原则](#设计原则)
2. [整体架构](#整体架构)
3. [交互层设计](#一交互层设计)
4. [集成层设计](#二集成层设计)
5. [数据层设计](#三数据层设计)
6. [实现路线图](#四实现路线图)
7. [可复用的 TodoList 代码](#五可复用的-todolist-代码)

---

## 设计原则

1. **场景驱动**：不同场景用不同交互，对话框不是唯一入口
2. **复用优先**：最大化复用 TodoList 的 AI 实现
3. **渐进增强**：核心功能不依赖 AI，AI 是增强而非必需
4. **流式响应**：所有生成类操作都应流式输出
5. **可撤销**：所有 AI 操作都可以撤销

---

## 整体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                        散墨笔记 (Notes App)                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │                     交互层 (UI)                             │    │
│  │  • 选中文本菜单 (⌘J)                                        │    │
│  │  • 斜杠命令 (/ai xxx)                                       │    │
│  │  • AI 侧边面板 (ChatPanel)                                  │    │
│  │  • 结果预览弹窗                                              │    │
│  └───────────────────┬────────────────────────────────────────┘    │
│                      │                                              │
│  ┌───────────────────▼────────────────────────────────────────┐    │
│  │                集成层 (Main Process)                        │    │
│  │                                                             │    │
│  │  ┌──────────────────────────────────────────────────────┐  │    │
│  │  │         Sanqian SDK Client                          │  │    │
│  │  │  • 初始化连接                                        │  │    │
│  │  │  • 注册私有 Agent                                    │  │    │
│  │  │  • 注册 Tools (笔记 CRUD)                            │  │    │
│  │  │  • 同步 User Context                                │  │    │
│  │  └──────────────────────────────────────────────────────┘  │    │
│  │                                                             │    │
│  │  ┌──────────────────────────────────────────────────────┐  │    │
│  │  │         IPC Handlers                                │  │    │
│  │  │  • agent:chatStream - 流式对话                       │  │    │
│  │  │  • agent:parseNote - 解析笔记                        │  │    │
│  │  │  • agent:listConversations - 对话历史                │  │    │
│  │  │  • context:sync - 同步上下文                         │  │    │
│  │  └──────────────────────────────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ WebSocket
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   Sanqian 中央服务 (独立进程)                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  • Agent 管理 (notes:assistant, notes:writing 等)                   │
│  • 对话历史存储 (conversations, messages)                           │
│  • LLM Provider 管理 (OpenAI, Claude, Ollama...)                   │
│  • Tool 执行协调 (调用 Notes App 的工具)                            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 关键架构决策

1. **Sanqian 是中央服务，不是库**
   - Sanqian 作为独立进程运行（WebSocket Server）
   - Notes App 通过 SDK 连接到 Sanqian
   - Sanqian 管理 Agent、对话历史、LLM 调用
   - Notes App 只需注册工具，响应工具调用

2. **对话历史由 Sanqian 管理**
   - Notes App 不需要自己的 `ai_conversations` 表
   - 通过 SDK 的 `listConversations()`, `getConversation()` 访问历史

3. **Embedding 暂不实现**
   - Phase 1-2 不做语义搜索
   - 先用关键词搜索满足基本需求
   - Phase 3+ 再考虑 Embedding（可能在 Sanqian 层实现）

---

## 一、交互层设计

### 1.1 选中文本菜单

**触发方式**：
- 选中文本后右键菜单
- 快捷键 `⌘J` 打开 AI 菜单

**功能列表**：
| 功能 | 快捷键 | Agent | 描述 |
|------|--------|-------|------|
| 润色 | `⌘J I` | notes:writing | 改善表达，修复语法 |
| 简化 | `⌘J S` | notes:writing | 让内容更简洁易懂 |
| 扩写 | `⌘J E` | notes:writing | 让内容更详细 |
| 翻译 | `⌘J T` | notes:writing | 中英互译 |
| 总结 | `⌘J M` | notes:writing | 生成摘要 |
| 解释 | `⌘J X` | notes:writing | 解释选中概念 |

**实现方式**：
```typescript
// 不使用 Tools，直接发送给 writing Agent
const messages = [
  {
    role: 'system',
    content: getWritingSystemPrompt(action) // improve/simplify/translate/...
  },
  {
    role: 'user',
    content: selectedText
  }
]

// 流式响应
for await (const event of sdk.chatStream('notes:writing', messages)) {
  if (event.type === 'text') {
    // 更新预览窗口
    appendToPreview(event.content)
  }
}
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

**预览弹窗**：
```
┌─────────────────────────────────────────┐
│  AI 润色结果                     [×]    │
├─────────────────────────────────────────┤
│                                         │
│  [流式显示生成的内容...]                │
│  [打字机效果]                            │
│                                         │
├─────────────────────────────────────────┤
│  [取消]  [插入]  [替换]                 │
└─────────────────────────────────────────┘
```

### 1.2 斜杠命令

**触发方式**：输入 `/ai` 或 `/`

**命令列表**：
| 命令 | Agent | 描述 |
|------|-------|------|
| `/ai` | notes:writing | 通用 AI 指令（自由输入） |
| `/ai 续写` | notes:writing | 根据上文继续写作 |
| `/ai 大纲` | notes:writing | 生成文章大纲 |
| `/ai 头脑风暴` | notes:writing | 围绕主题生成想法 |

**实现方式**：
```typescript
// 续写示例
const messages = [
  {
    role: 'system',
    content: '你是写作助手。根据上文风格和内容续写。不要重复上文，直接续写。'
  },
  {
    role: 'user',
    content: `请续写以下内容：\n\n${getTextBeforeCursor(500)}`
  }
]

// 流式插入到光标位置
for await (const event of sdk.chatStream('notes:writing', messages)) {
  if (event.type === 'text') {
    insertAtCursor(event.content)
  }
}
```

### 1.3 AI 侧边面板（ChatPanel）

**触发方式**：
- 工具栏按钮
- 快捷键 `⌘⇧J`

**功能**：
- 对话式交互（Q&A）
- 基于当前笔记对话
- 使用 Tools 操作笔记（搜索、创建、更新）
- 对话历史

**布局**：
```
┌─────────────────────────────────────────┐
│  AI 助手                         [×]    │
├─────────────────────────────────────────┤
│  ┌─────────────────────────────────┐    │
│  │ 💬 对话  │ 📝 历史               │    │
│  └─────────────────────────────────┘    │
│                                         │
│  [用户消息]                              │
│                                         │
│  [AI 回复 - 流式显示]                    │
│                                         │
│  [🔧 正在调用工具: search_notes...]      │
│                                         │
├─────────────────────────────────────────┤
│  [输入框]                    [发送]     │
│  💡 当前笔记：散墨笔记设计文档             │
└─────────────────────────────────────────┘
```

**实现方式**：
- **90% 复用 TodoList 的 ChatPanel.tsx**
- 修改：工具提示文案、样式、上下文显示
- 核心逻辑完全一致

---

## 二、集成层设计

### 2.1 Sanqian SDK 初始化

**参考 TodoList**: `src/main/sanqian-sdk.ts`

```typescript
// src/main/sanqian-sdk.ts

import { SanqianSDK } from '@sanqian/sdk'

let sdk: SanqianSDK | null = null

export async function initializeSanqianSDK(): Promise<void> {
  if (sdk) return

  sdk = new SanqianSDK({
    appName: 'sanqian-notes',
    debug: import.meta.env.DEV
  })

  // 尝试连接（非阻塞）
  try {
    await sdk.connect()
    console.log('[Sanqian] Connected')
  } catch (err) {
    console.warn('[Sanqian] Failed to connect, will retry when ChatPanel opens:', err)
  }

  // 注册工具
  registerNoteTools()
}

export function getSanqianSDK(): SanqianSDK | null {
  return sdk
}
```

### 2.2 Tools 注册

```typescript
// src/main/sanqian-tools.ts

import { ToolDefinition } from '@sanqian/sdk'
import { getDb } from './database'

export function registerNoteTools(): void {
  const sdk = getSanqianSDK()
  if (!sdk) return

  const tools: ToolDefinition[] = [
    // ==================== 搜索笔记 ====================
    {
      name: 'search_notes',
      description: '搜索笔记。支持在标题和内容中搜索关键词。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索关键词'
          },
          limit: {
            type: 'number',
            description: '返回结果数量上限，默认 10',
            default: 10
          }
        },
        required: ['query']
      }
    },

    // ==================== 获取笔记 ====================
    {
      name: 'get_note',
      description: '获取指定笔记的详细内容。',
      parameters: {
        type: 'object',
        properties: {
          note_id: {
            type: 'string',
            description: '笔记 ID'
          }
        },
        required: ['note_id']
      }
    },

    // ==================== 创建笔记 ====================
    {
      name: 'create_note',
      description: '创建一篇新笔记。',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: '笔记标题'
          },
          content: {
            type: 'string',
            description: '笔记内容（可选，Markdown 格式）'
          }
        },
        required: ['title']
      }
    },

    // ==================== 更新笔记 ====================
    {
      name: 'update_note',
      description: '更新现有笔记。可以修改标题或追加内容。',
      parameters: {
        type: 'object',
        properties: {
          note_id: {
            type: 'string',
            description: '要更新的笔记 ID'
          },
          title: {
            type: 'string',
            description: '新标题（可选）'
          },
          append_content: {
            type: 'string',
            description: '要追加到笔记末尾的内容（可选，Markdown 格式）'
          }
        },
        required: ['note_id']
      }
    },

    // ==================== 删除笔记 ====================
    {
      name: 'delete_note',
      description: '删除笔记（移到回收站）。这是危险操作，需要用户确认。',
      parameters: {
        type: 'object',
        properties: {
          note_id: {
            type: 'string',
            description: '要删除的笔记 ID'
          }
        },
        required: ['note_id']
      },
      requiresApproval: true // HITL: 需要用户确认
    },

    // ==================== 获取标签 ====================
    {
      name: 'get_tags',
      description: '获取所有标签列表。',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  ]

  // 注册工具处理器
  sdk.registerTools(tools, async (toolName, args) => {
    switch (toolName) {
      case 'search_notes':
        return handleSearchNotes(args)
      case 'get_note':
        return handleGetNote(args)
      case 'create_note':
        return handleCreateNote(args)
      case 'update_note':
        return handleUpdateNote(args)
      case 'delete_note':
        return handleDeleteNote(args)
      case 'get_tags':
        return handleGetTags(args)
      default:
        throw new Error(`Unknown tool: ${toolName}`)
    }
  })
}

// Tool Handlers
async function handleSearchNotes(args: { query: string; limit?: number }) {
  const db = getDb()
  const limit = args.limit || 10

  const notes = db.prepare(`
    SELECT id, title, content, updated_at
    FROM notes
    WHERE is_deleted = 0
      AND (title LIKE ? OR content LIKE ?)
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(`%${args.query}%`, `%${args.query}%`, limit)

  return notes.map((n: any) => ({
    id: n.id,
    title: n.title,
    preview: extractPreview(n.content, args.query, 100),
    updated_at: n.updated_at
  }))
}

async function handleGetNote(args: { note_id: string }) {
  const db = getDb()
  const note = db.prepare(`
    SELECT id, title, content, created_at, updated_at
    FROM notes
    WHERE id = ? AND is_deleted = 0
  `).get(args.note_id)

  if (!note) {
    throw new Error('Note not found')
  }

  return {
    id: note.id,
    title: note.title,
    content: extractText(note.content),
    created_at: note.created_at,
    updated_at: note.updated_at
  }
}

async function handleCreateNote(args: { title: string; content?: string }) {
  const db = getDb()
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  // 构建 Tiptap 文档
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

  return {
    id,
    title: args.title,
    message: `笔记「${args.title}」已创建`
  }
}

async function handleUpdateNote(args: {
  note_id: string
  title?: string
  append_content?: string
}) {
  const db = getDb()
  const now = new Date().toISOString()

  if (args.title) {
    db.prepare('UPDATE notes SET title = ?, updated_at = ? WHERE id = ?')
      .run(args.title, now, args.note_id)
  }

  if (args.append_content) {
    const note = db.prepare('SELECT content FROM notes WHERE id = ?').get(args.note_id)
    if (note) {
      const doc = JSON.parse(note.content)
      doc.content.push({
        type: 'paragraph',
        content: [{ type: 'text', text: args.append_content }]
      })
      db.prepare('UPDATE notes SET content = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(doc), now, args.note_id)
    }
  }

  return {
    id: args.note_id,
    message: '笔记已更新'
  }
}

async function handleDeleteNote(args: { note_id: string }) {
  const db = getDb()
  const now = new Date().toISOString()

  db.prepare('UPDATE notes SET is_deleted = 1, updated_at = ? WHERE id = ?')
    .run(now, args.note_id)

  return {
    id: args.note_id,
    message: '笔记已移至回收站'
  }
}

async function handleGetTags(args: {}) {
  // TODO: 实现标签系统后补充
  return []
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

### 2.3 Agent 配置

```typescript
// src/main/sanqian-agent.ts

export const NOTES_AGENTS = {
  // 笔记助手 - 带 Tools，用于对话
  assistant: {
    agent_id: 'notes:assistant',
    name: '笔记助手',
    description: '帮助你管理笔记、搜索内容、整理知识',
    system_prompt: `你是散墨笔记的 AI 助手。你可以帮助用户：
- 搜索和查找笔记
- 回答基于笔记内容的问题
- 创建和编辑笔记
- 整理和组织知识

你有以下工具可以使用：
- search_notes: 搜索笔记
- get_note: 获取笔记详情
- create_note: 创建新笔记
- update_note: 更新笔记
- delete_note: 删除笔记（需用户确认）
- get_tags: 获取标签列表

工作规范：
1. 当用户询问时，优先使用工具获取准确信息，而不是猜测
2. 回答要简洁、准确、有帮助
3. 删除笔记前必须确认
4. 创建笔记后告知用户笔记标题和 ID`,
    tools: [
      'search_notes',
      'get_note',
      'create_note',
      'update_note',
      'delete_note',
      'get_tags'
    ]
  },

  // 写作助手 - 不带 Tools，用于文本处理
  writing: {
    agent_id: 'notes:writing',
    name: '写作助手',
    description: '帮助你改善文字表达、翻译、总结',
    system_prompt: `你是专业的写作助手。你擅长：
- 改善文字表达，修复语法错误
- 简化复杂内容，保留核心信息
- 扩写简短内容，添加细节
- 中英文互译
- 总结长文，提取要点
- 解释概念和术语

工作规范：
1. 保持原意，不要添加原文没有的观点
2. 保持格式（列表、段落等）
3. 保持语言（中文用中文，英文用英文）
4. 只输出结果，不解释修改内容`,
    tools: []
  }
}

export async function syncPrivateAgents(): Promise<void> {
  const sdk = getSanqianSDK()
  if (!sdk) return

  await sdk.ensureReady()

  for (const config of Object.values(NOTES_AGENTS)) {
    await sdk.createOrUpdateAgent(config)
  }

  console.log('[Sanqian] Private agents synced')
}
```

### 2.4 User Context 同步

**参考 TodoList**: `src/main/index.ts` 中的 `context:sync` handler

```typescript
// src/main/context.ts

interface NotesUserContext {
  currentNote: {
    id: string
    title: string
    wordCount: number
  } | null
  selectedText: string | null
  sidebarView: 'notes' | 'trash' | 'search'
}

let userContext: NotesUserContext = {
  currentNote: null,
  selectedText: null,
  sidebarView: 'notes'
}

export function setUserContext(ctx: Partial<NotesUserContext>): void {
  userContext = { ...userContext, ...ctx }
}

export function getLLMContext(): string {
  const parts: string[] = []

  if (userContext.currentNote) {
    parts.push(`当前笔记：《${userContext.currentNote.title}》(${userContext.currentNote.wordCount} 字)`)
  } else {
    parts.push('当前未打开笔记')
  }

  if (userContext.selectedText) {
    const preview = userContext.selectedText.length > 100
      ? userContext.selectedText.slice(0, 100) + '...'
      : userContext.selectedText
    parts.push(`已选中文本：${preview}`)
  }

  parts.push(`侧边栏视图：${userContext.sidebarView}`)

  return parts.join('\n')
}

// IPC Handler
ipcMain.on('context:sync', (_, ctx: Partial<NotesUserContext>) => {
  setUserContext(ctx)
})
```

### 2.5 IPC Handlers

**参考 TodoList**: `src/main/index.ts`

```typescript
// src/main/index.ts

import { ipcMain } from 'electron'
import { getSanqianSDK, syncPrivateAgents } from './sanqian-sdk'
import { getLLMContext } from './context'

// ==================== agent:chatStream ====================
ipcMain.on('agent:chatStream', async (event, data) => {
  const { streamId, agentId, messages } = data
  const sdk = getSanqianSDK()

  if (!sdk) {
    event.reply('agent:chatStream', {
      streamId,
      event: { type: 'error', error: 'Sanqian SDK not initialized' }
    })
    return
  }

  try {
    await sdk.ensureReady()
    await syncPrivateAgents()

    // 在第一条 user 消息前注入 User Context
    const messagesWithContext = injectContext(messages)

    for await (const evt of sdk.chatStream(agentId, messagesWithContext)) {
      event.reply('agent:chatStream', { streamId, event: evt })
    }
  } catch (err: any) {
    event.reply('agent:chatStream', {
      streamId,
      event: { type: 'error', error: err.message }
    })
  }
})

// ==================== agent:listConversations ====================
ipcMain.handle('agent:listConversations', async (_, agentId: string) => {
  const sdk = getSanqianSDK()
  if (!sdk) throw new Error('Sanqian SDK not initialized')

  await sdk.ensureReady()
  return await sdk.listConversations(agentId)
})

// ==================== agent:getConversation ====================
ipcMain.handle('agent:getConversation', async (_, conversationId: string) => {
  const sdk = getSanqianSDK()
  if (!sdk) throw new Error('Sanqian SDK not initialized')

  await sdk.ensureReady()
  return await sdk.getConversation(conversationId)
})

// ==================== agent:deleteConversation ====================
ipcMain.handle('agent:deleteConversation', async (_, conversationId: string) => {
  const sdk = getSanqianSDK()
  if (!sdk) throw new Error('Sanqian SDK not initialized')

  await sdk.ensureReady()
  return await sdk.deleteConversation(conversationId)
})

// 辅助函数：注入 User Context
function injectContext(messages: any[]): any[] {
  const context = getLLMContext()
  const firstUserIndex = messages.findIndex(m => m.role === 'user')

  if (firstUserIndex === -1) return messages

  const result = [...messages]
  result.splice(firstUserIndex, 0, {
    role: 'system',
    content: `## 用户当前状态\n\n${context}`
  })

  return result
}
```

---

## 三、数据层设计

### 3.1 Notes 数据库（现有）

```sql
-- Notes 只需要笔记数据，不需要 AI 相关表
-- 对话历史由 Sanqian 管理

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,        -- Tiptap JSON
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  is_deleted INTEGER DEFAULT 0,
  is_pinned INTEGER DEFAULT 0
);

-- 将来的标签系统（Phase 2+）
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS note_tags (
  note_id TEXT REFERENCES notes(id) ON DELETE CASCADE,
  tag_id TEXT REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);
```

### 3.2 Sanqian 数据库（由 Sanqian 管理）

```sql
-- 这些表在 Sanqian 服务端，Notes App 不需要创建

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  app_name TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  title TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT REFERENCES conversations(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls TEXT,
  created_at TEXT NOT NULL
);
```

---

## 四、实现路线图

### Phase 1：基础对话能力（1 周）

**目标**：复用 TodoList，实现 AI 侧边面板对话

**任务**：
- [x] 复制 TodoList 的 SDK 初始化代码
- [ ] 定义笔记工具集（6 个工具）
- [ ] 实现工具处理器（CRUD 操作）
- [ ] 定义 2 个 Agent（assistant, writing）
- [ ] 实现 User Context 同步
- [ ] 复制 TodoList 的 IPC 处理器
- [ ] **复制 TodoList 的 ChatPanel 组件**（90% 复用）
- [ ] 调整样式和文案

**复用程度**：~80%
**预计工作量**：3-5 天（主要是工具处理器和样式调整）

---

### Phase 2：选中文本操作（1 周）

**目标**：实现润色、翻译、总结等文本处理功能

**任务**：
- [ ] 实现 AI 菜单 UI（⌘J 触发）
- [ ] 实现预览弹窗（流式显示结果）
- [ ] 实现 6 种文本操作的 System Prompt
- [ ] 实现替换/插入逻辑
- [ ] 添加撤销支持
- [ ] 快捷键绑定

**复用程度**：~50%（流式处理逻辑可复用，UI 需要新做）
**预计工作量**：4-6 天

---

### Phase 3：斜杠命令（3-5 天）

**目标**：实现 /ai 续写、大纲等生成功能

**任务**：
- [ ] 实现斜杠命令解析
- [ ] 实现命令菜单 UI
- [ ] 实现续写、大纲等 Prompt
- [ ] 实现流式插入到光标位置

**复用程度**：~60%（流式逻辑复用）
**预计工作量**：3-5 天

---

### Phase 4：优化和完善（1 周）

**目标**：错误处理、性能优化、用户体验提升

**任务**：
- [ ] 错误提示优化
- [ ] 加载状态优化
- [ ] 快捷键优化
- [ ] 国际化（中英文）
- [ ] 设置页面（Sanqian 连接状态、模型选择等）
- [ ] 文档和帮助

**预计工作量**：5-7 天

---

### Phase 5+：高级功能（未来）

- [ ] 标签系统
- [ ] 智能标签推荐（基于笔记内容）
- [ ] 笔记模板生成
- [ ] 语音输入（Whisper）
- [ ] 批量操作（批量总结、批量打标签）

---

## 五、可复用的 TodoList 代码

### 完全复用（几乎不需要修改）

| 文件 | 用途 | 修改程度 |
|------|------|----------|
| `src/main/sanqian-sdk.ts` | SDK 初始化、连接管理 | 改 appName |
| `src/preload/index.ts` | IPC 桥接 | 几乎不改 |
| `src/renderer/src/types/chat.ts` | 类型定义 | 几乎不改 |

### 大量复用（调整样式和文案）

| 文件 | 用途 | 修改程度 |
|------|------|----------|
| `src/renderer/src/components/ChatPanel.tsx` | 对话 UI | ~10% 修改（样式、图标、文案） |
| `src/renderer/src/components/ChatMessage.tsx` | 消息组件 | ~5% 修改（样式） |
| `src/renderer/src/hooks/useTypewriter.ts` | 打字机效果 | 几乎不改 |

### 参考实现（核心逻辑复用）

| 文件 | 用途 | 如何复用 |
|------|------|----------|
| `src/main/index.ts` (IPC handlers) | 处理 agent:chatStream 等 | 复制逻辑，改工具处理 |
| `src/main/context.ts` (假设) | User Context 管理 | 改为笔记上下文 |

### 需要新写的部分

| 功能 | 原因 |
|------|------|
| 工具处理器 (search_notes, create_note 等) | 笔记特定逻辑 |
| AI 菜单 UI | TodoList 没有选中文本操作 |
| 预览弹窗 | TodoList 没有文本替换场景 |
| 斜杠命令 UI | TodoList 没有 |

---

## 更新日志

| 日期 | 更新内容 |
|------|----------|
| 2024-12-20 | 初版设计 |
| 2024-12-22 | 基于 Sanqian SDK 和 TodoList 实现重写，明确复用策略 |
