# 散墨笔记 AI Agents & Tools 详细设计

> 基于 Sanqian SDK 的 Agent 和 Tools 设计规范

---

## 目录

1. [设计原则](#设计原则)
2. [Agents 设计](#agents-设计)
3. [Tools 设计](#tools-设计)
4. [User Context 设计](#user-context-设计)
5. [Prompts 设计](#prompts-设计)

---

## 设计原则

### Agent 设计原则

1. **最小化原则** - 只创建必要的 Agent，避免过度设计
2. **职责明确** - 每个 Agent 有清晰的职责边界
3. **Prompt 驱动** - 通过 System Prompt 控制行为，而不是创建新 Agent
4. **工具分离** - 需要操作数据的用 Tools，纯文本处理不需要 Tools

### Tools 设计原则

1. **单一职责** - 每个 Tool 只做一件事
2. **描述详尽** - Description 要写清楚何时用、怎么用、返回什么
3. **参数明确** - 每个参数都要有清晰的描述和类型
4. **错误友好** - 返回清晰的错误信息

### Context 设计原则

1. **按需同步** - 只在需要时同步 User Context
2. **格式简洁** - 用自然语言描述，便于 LLM 理解
3. **最小必要** - 只传递必要的信息，避免 token 浪费

---

## Agents 设计

### 设计决策

**为什么只需要 2 个 Agent？**

- **notes:assistant** - 带 Tools，用于对话和操作笔记
- **notes:writing** - 不带 Tools，用于文本处理

**为什么不需要更多 Agent？**

- 翻译、总结、润色等都是 `notes:writing` 的不同 Prompt
- 通过调整 System Prompt 即可实现不同功能
- 避免过度设计，简化维护成本

---

### 1. notes:assistant（笔记助手）

**职责**：
- 搜索和查找笔记
- 回答基于笔记内容的问题
- 创建和编辑笔记
- 管理笔记（删除、更新等）

**使用场景**：
- AI 侧边面板对话
- 需要操作笔记数据的场景

**Tools**：
- `search_notes` - 搜索笔记
- `get_note` - 获取笔记详情
- `create_note` - 创建新笔记
- `update_note` - 更新笔记
- `delete_note` - 删除笔记（需用户确认）
- `get_tags` - 获取标签列表

**System Prompt**：

```
你是散墨笔记的 AI 助手。你可以帮助用户：
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
4. 创建笔记后告知用户笔记标题和 ID
5. 如果用户问到笔记内容，先用 search_notes 找到相关笔记，再用 get_note 获取详情
6. 引用笔记时使用「笔记标题」格式
```

**配置**：

```typescript
{
  agent_id: 'notes:assistant',
  name: '笔记助手',
  description: '帮助你管理笔记、搜索内容、整理知识',
  system_prompt: '...',  // 见上面
  tools: [
    'search_notes',
    'get_note',
    'create_note',
    'update_note',
    'delete_note',
    'get_tags'
  ]
}
```

---

### 2. notes:writing（写作助手）

**职责**：
- 改善文字表达
- 翻译（中英互译）
- 总结提取
- 解释概念
- 续写内容
- 生成大纲

**使用场景**：
- 选中文本操作（润色、翻译、总结等）
- 斜杠命令（/ai 续写、/ai 大纲等）
- 不需要操作笔记数据的场景

**Tools**：无（纯文本处理）

**Base System Prompt**：

```
你是专业的写作助手。你擅长：
- 改善文字表达，修复语法错误
- 简化复杂内容，保留核心信息
- 扩写简短内容，添加细节
- 中英文互译
- 总结长文，提取要点
- 解释概念和术语
- 根据上文续写
- 生成文章大纲

工作规范：
1. 保持原意，不要添加原文没有的观点
2. 保持格式（列表、段落等）
3. 保持语言（中文用中文，英文用英文）
4. 只输出结果，不解释修改内容
5. 翻译时保持原文风格和专业术语
```

**配置**：

```typescript
{
  agent_id: 'notes:writing',
  name: '写作助手',
  description: '帮助你改善文字表达、翻译、总结',
  system_prompt: '...',  // 见上面
  tools: []  // 不需要工具
}
```

---

## Tools 设计

### 1. search_notes

**描述**：搜索笔记。支持在标题和内容中搜索关键词。

**参数**：

```typescript
{
  query: string        // 必需，搜索关键词
  limit?: number       // 可选，返回结果数量上限，默认 10
}
```

**返回**：

```typescript
Array<{
  id: string           // 笔记 ID
  title: string        // 笔记标题
  preview: string      // 匹配内容的预览（带上下文）
  updated_at: string   // 更新时间
}>
```

**示例**：

```typescript
// 输入
{
  query: "AI 设计",
  limit: 5
}

// 输出
[
  {
    id: "123",
    title: "散墨笔记 AI 能力设计",
    preview: "...基于 Sanqian SDK 的 AI 设计方案...",
    updated_at: "2024-12-22T10:00:00Z"
  },
  ...
]
```

**实现**：

```typescript
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
```

---

### 2. get_note

**描述**：获取指定笔记的详细内容。

**参数**：

```typescript
{
  note_id: string      // 必需，笔记 ID
}
```

**返回**：

```typescript
{
  id: string           // 笔记 ID
  title: string        // 标题
  content: string      // 纯文本内容
  created_at: string   // 创建时间
  updated_at: string   // 更新时间
}
```

**错误**：
- 如果笔记不存在或已删除，抛出 `Error('Note not found')`

**实现**：

```typescript
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
    content: extractText(note.content),  // 从 Tiptap JSON 提取纯文本
    created_at: note.created_at,
    updated_at: note.updated_at
  }
}
```

---

### 3. create_note

**描述**：创建一篇新笔记。

**参数**：

```typescript
{
  title: string        // 必需，笔记标题
  content?: string     // 可选，笔记内容（纯文本或 Markdown）
}
```

**返回**：

```typescript
{
  id: string           // 新笔记的 ID
  title: string        // 笔记标题
  message: string      // 成功消息
}
```

**示例**：

```typescript
// 输入
{
  title: "AI 学习笔记",
  content: "今天学习了 Transformer 架构"
}

// 输出
{
  id: "abc123",
  title: "AI 学习笔记",
  message: "笔记「AI 学习笔记」已创建"
}
```

**实现**：

```typescript
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
```

---

### 4. update_note

**描述**：更新现有笔记。可以修改标题或追加内容。

**参数**：

```typescript
{
  note_id: string         // 必需，要更新的笔记 ID
  title?: string          // 可选，新标题
  append_content?: string // 可选，要追加的内容
}
```

**返回**：

```typescript
{
  id: string              // 笔记 ID
  message: string         // 成功消息
}
```

**注意**：
- `title` 和 `append_content` 至少提供一个
- `append_content` 会追加到笔记末尾，不会覆盖原有内容

**实现**：

```typescript
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
```

---

### 5. delete_note

**描述**：删除笔记（移到回收站）。这是危险操作，需要用户确认。

**参数**：

```typescript
{
  note_id: string      // 必需，要删除的笔记 ID
}
```

**返回**：

```typescript
{
  id: string           // 笔记 ID
  message: string      // 成功消息
}
```

**HITL（Human-in-the-Loop）**：
- 设置 `requiresApproval: true`
- Sanqian 会自动弹出确认对话框
- 只有用户点击确认后才会执行

**配置**：

```typescript
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
  requiresApproval: true  // 需要用户确认
}
```

**实现**：

```typescript
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
```

---

### 6. get_tags

**描述**：获取所有标签列表。

**参数**：无

**返回**：

```typescript
Array<{
  id: string           // 标签 ID
  name: string         // 标签名称
  color?: string       // 标签颜色
  count: number        // 使用该标签的笔记数量
}>
```

**注意**：Phase 1 暂不实现，返回空数组

**实现**：

```typescript
async function handleGetTags(args: {}) {
  // TODO: Phase 2+ 实现标签系统后补充
  return []
}
```

---

## User Context 设计

### Context 结构

```typescript
interface NotesUserContext {
  // 当前笔记
  currentNote: {
    id: string
    title: string
    wordCount: number
  } | null

  // 选中的文本
  selectedText: string | null

  // 侧边栏视图
  sidebarView: 'notes' | 'trash' | 'search'
}
```

### Context 同步

**Renderer → Main**：

```typescript
// src/renderer/src/hooks/useAIContext.ts

export function useAIContext(editor: Editor | null, noteId: string | null) {
  useEffect(() => {
    if (!editor || !noteId) {
      window.electron.context.sync({
        currentNote: null,
        selectedText: null
      })
      return
    }

    const updateContext = () => {
      const { from, to } = editor.state.selection
      const selectedText = from !== to
        ? editor.state.doc.textBetween(from, to)
        : null

      const wordCount = editor.state.doc.textContent.length

      window.electron.context.sync({
        currentNote: {
          id: noteId,
          title: currentNoteTitle,
          wordCount
        },
        selectedText
      })
    }

    editor.on('selectionUpdate', updateContext)
    updateContext()

    return () => {
      editor.off('selectionUpdate', updateContext)
    }
  }, [editor, noteId])
}
```

**Main Process**：

```typescript
// src/main/context.ts

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
```

### Context 注入

在发送给 Sanqian 之前，在第一条 user 消息前注入 User Context：

```typescript
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

## Prompts 设计

### 写作操作 Prompts

基于 `notes:writing` Agent，通过不同的 System Prompt 实现不同功能：

#### 1. 润色 (Improve)

```typescript
{
  system: `你是专业的文字编辑。请改善以下文字的表达，修复语法错误，让它更流畅自然。

规则：
- 保持原意，不要添加新内容
- 保持格式（列表、段落等）
- 保持语言（中文或英文）
- 只输出结果，不要解释`,

  user: `{selectedText}`
}
```

#### 2. 简化 (Simplify)

```typescript
{
  system: `你是专业的文字编辑。请简化以下内容，让它更简洁易懂。

规则：
- 去除冗余的修饰词和重复表达
- 用更简单的词汇
- 保留核心信息
- 目标是减少 30-50% 的篇幅
- 只输出结果`,

  user: `{selectedText}`
}
```

#### 3. 扩写 (Expand)

```typescript
{
  system: `你是专业的写作助手。请扩写以下内容，添加更多细节和解释。

规则：
- 添加相关的细节、例子或解释
- 保持原有的观点和风格
- 目标是扩展到原文的 1.5-2 倍长度
- 只输出结果`,

  user: `{selectedText}`
}
```

#### 4. 翻译 (Translate)

```typescript
{
  system: `你是专业的翻译专家。请将以下内容翻译成{targetLang}。

规则：
- 准确传达原文含义
- 译文要自然流畅，不要翻译腔
- 保持原文的风格（正式/轻松）
- 保持 Markdown 格式
- 专有名词、代码保持原样
- 只输出翻译结果`,

  user: `{selectedText}`
}
```

#### 5. 总结 (Summarize)

```typescript
{
  system: `你是内容分析专家。请总结以下内容的要点。

规则：
- 摘要长度约为原文的 15-25%
- 保留核心观点和关键结论
- 使用完整的句子
- 按重要性组织
- 只输出摘要`,

  user: `{selectedText}`
}
```

#### 6. 解释 (Explain)

```typescript
{
  system: `你是知识渊博的老师。请用简单易懂的语言解释以下内容。

格式：
1. 简洁定义（1-2 句话）
2. 详细解释（用类比或例子）
3. 相关概念或延伸（可选）

规则：
- 通俗易懂
- 避免循环定义
- 如果是代码，解释功能和关键步骤`,

  user: `{selectedText}`
}
```

### 生成操作 Prompts

#### 7. 续写 (Continue)

```typescript
{
  system: `你是专业的写作助手。请根据上文风格和内容，自然地续写。

规则：
- 观察上文的语气和人称
- 保持相同的时态
- 不要重复上文已有的内容
- 续写 1-3 个段落
- 自然结束，不要戛然而止
- 直接续写，不要加前缀`,

  user: `请续写以下内容：\n\n{textBeforeCursor}`
}
```

#### 8. 大纲 (Outline)

```typescript
{
  system: `你是专业的写作顾问。请为以下主题生成一个结构清晰的大纲。

规则：
- 3-5 个主要章节（## 一级标题）
- 每个章节下 2-4 个子标题（### 二级标题）
- 层级不要太深（最多 2-3 层）
- 逻辑连贯，有引入和总结
- 标题简洁（5-15 个字）
- 只输出大纲，使用 Markdown 格式`,

  user: `{topic}`
}
```

#### 9. 头脑风暴 (Brainstorm)

```typescript
{
  system: `你是创意顾问。请围绕以下主题进行头脑风暴，生成多个相关的想法和角度。

规则：
- 生成 8-12 个想法
- 用 bullet point 列表（- 开头）
- 每个想法一句话，简洁有力
- 覆盖不同角度和层面
- 鼓励创新和跨界思维`,

  user: `{topic}`
}
```

---

## Prompts 管理

建议使用配置文件管理 Prompts：

```typescript
// src/main/prompts.ts

export const WRITING_PROMPTS = {
  improve: {
    system: '...',
    getUserMessage: (text: string) => text
  },

  simplify: {
    system: '...',
    getUserMessage: (text: string) => text
  },

  translate: {
    system: (targetLang: string) => `你是专业的翻译专家。请将以下内容翻译成${targetLang}...`,
    getUserMessage: (text: string) => text
  },

  continue: {
    system: '...',
    getUserMessage: (text: string) => `请续写以下内容：\n\n${text}`
  },

  outline: {
    system: '...',
    getUserMessage: (topic: string) => topic
  },

  brainstorm: {
    system: '...',
    getUserMessage: (topic: string) => topic
  }
}

// 使用示例
export function getWritingMessages(
  action: keyof typeof WRITING_PROMPTS,
  input: string,
  options?: { targetLang?: string }
): Array<{ role: string; content: string }> {
  const prompt = WRITING_PROMPTS[action]
  const systemContent = typeof prompt.system === 'function'
    ? prompt.system(options?.targetLang || '英文')
    : prompt.system

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: prompt.getUserMessage(input) }
  ]
}
```

---

## 更新日志

| 日期 | 更新内容 |
|------|----------|
| 2024-12-20 | 初版设计 |
| 2024-12-22 | 基于 Sanqian SDK 简化重写，只保留 2 个 Agent 和 6 个 Tools |
