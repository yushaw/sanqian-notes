# 散墨笔记 AI Agents & Tools 详细设计

> 场景驱动的 Agent 架构设计，包含 AI Tools 和 Local Tools

---

## 目录

1. [设计理念](#设计理念)
2. [架构总览](#架构总览)
3. [Agents 详细设计](#agents-详细设计)
4. [AI Tools 详细设计](#ai-tools-详细设计)
5. [Local Tools 详细设计](#local-tools-详细设计)
6. [调用流程示例](#调用流程示例)

---

## 设计理念

### 两类工具的区分

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           工具分类                                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   AI Tools (LLM 调用)                    Local Tools (本地调用)          │
│   ═══════════════════                    ═══════════════════            │
│                                                                         │
│   ┌─────────────────────┐               ┌─────────────────────┐        │
│   │ 注册到 Agent        │               │ 封装在前端          │        │
│   │ LLM 决定是否调用    │               │ 我们控制调用时机    │        │
│   │ 用于获取/操作数据   │               │ 用于 UI 交互操作    │        │
│   └─────────────────────┘               └─────────────────────┘        │
│                                                                         │
│   例如：                                 例如：                         │
│   - search_notes (搜索笔记)              - streamInsert (流式插入)      │
│   - get_note (获取内容)                  - streamReplace (流式替换)     │
│   - create_note (创建笔记)               - showDiffPreview (差异预览)   │
│   - get_related_notes (相关笔记)         - showGhostText (幽灵文本)     │
│                                          - withTransaction (事务包装)   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 场景化 Agent 的必要性

| 单一 Agent 问题 | 场景化 Agent 优势 |
|----------------|------------------|
| System Prompt 臃肿 | 每个 Agent 职责单一，Prompt 精简 |
| 简单任务也走 Tool Use | 无 Tool 场景直接返回，省 token |
| 参数无法差异化 | 每个场景独立配置 temperature 等 |
| 难以针对性优化 | 可以单独调优每个 Agent |

---

## 架构总览

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           用户交互入口                                   │
├─────────────────────────────────────────────────────────────────────────┤
│  选中文本 + ⌘J    │  斜杠命令 /ai    │  AI 侧边面板    │  自动触发       │
│  (润色/翻译/...)  │  (续写/大纲/...) │  (对话/问答)    │  (相关推荐)     │
└────────┬──────────┴────────┬─────────┴────────┬────────┴────────┬───────┘
         │                   │                  │                 │
         ▼                   ▼                  ▼                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           Agent 路由层                                   │
│                                                                         │
│   根据场景选择对应 Agent，构建上下文，发起请求                            │
└─────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           Agents 层                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐   │
│  │WritingAgent  │ │ContinueAgent │ │KnowledgeAgent│ │ ManageAgent  │   │
│  │   写作润色    │ │   续写补全    │ │   知识问答    │ │   笔记管理   │   │
│  │              │ │              │ │              │ │              │   │
│  │ 无 Tools     │ │ 无 Tools     │ │ 有 Tools     │ │ 有 Tools     │   │
│  │ temp: 0.3    │ │ temp: 0.7    │ │ temp: 0.5    │ │ temp: 0.3    │   │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘   │
│                                                                         │
│  ┌──────────────┐ ┌──────────────┐                                     │
│  │SummaryAgent  │ │TranslateAgent│                                     │
│  │   总结提取    │ │    翻译      │                                     │
│  │              │ │              │                                     │
│  │ 无 Tools     │ │ 无 Tools     │                                     │
│  │ temp: 0.2    │ │ temp: 0.1    │                                     │
│  └──────────────┘ └──────────────┘                                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
         │
         │ AI 返回流式内容
         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Local Tools 层                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐   │
│  │streamInsert  │ │streamReplace │ │showDiffPreview│ │showGhostText │   │
│  │  流式插入     │ │  流式替换     │ │  差异预览     │ │  幽灵文本    │   │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘   │
│                                                                         │
│  ┌──────────────┐ ┌──────────────┐                                     │
│  │withTransaction│ │ scrollFollow │                                     │
│  │  事务包装     │ │  滚动跟随     │                                     │
│  └──────────────┘ └──────────────┘                                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Agents 详细设计

### 1. WritingAgent (写作润色)

**职责**：对选中文本进行润色、简化、扩写等编辑操作

**触发方式**：
- 选中文本 + 右键菜单 → 润色/简化/扩写
- 选中文本 + `⌘J` → 选择操作

**配置**：
```typescript
const WritingAgent = {
  id: 'writing',
  name: { zh: '写作助手', en: 'Writing Assistant' },

  // 无需 Tools，直接文本处理
  tools: [],

  // 参数配置
  config: {
    temperature: 0.3,      // 低温度，保持稳定输出
    maxTokens: 2000,       // 输出不会太长
    stream: true           // 流式输出
  },

  // 子任务 Prompts
  prompts: {
    improve: {
      system: `你是专业的文字编辑。改善文字表达，修复语法错误，让内容更流畅自然。
规则：
- 保持原意，不添加新内容
- 保持原有格式（如列表、段落结构）
- 只输出修改后的内容，不要解释`,
      user: '{content}'
    },

    simplify: {
      system: `你是专业的文字编辑。简化内容，让它更简洁易懂。
规则：
- 保持核心信息，去除冗余
- 用更简单的词汇替换复杂表达
- 只输出简化后的内容，不要解释`,
      user: '{content}'
    },

    expand: {
      system: `你是专业的写作助手。扩写内容，添加更多细节和解释。
规则：
- 保持原有观点和风格
- 添加相关细节、例子或解释
- 扩展幅度约为原文的 1.5-2 倍
- 只输出扩写后的内容，不要解释`,
      user: '{content}'
    },

    formal: {
      system: `你是专业的文字编辑。将内容改写为正式、专业的语气。
规则：
- 使用正式用语，避免口语化表达
- 保持原意
- 只输出改写后的内容，不要解释`,
      user: '{content}'
    },

    casual: {
      system: `你是专业的文字编辑。将内容改写为轻松、友好的语气。
规则：
- 使用自然、亲切的表达
- 保持原意
- 只输出改写后的内容，不要解释`,
      user: '{content}'
    }
  },

  // 输出处理
  outputHandler: 'streamReplace'  // 使用 Local Tool: streamReplace
}
```

**调用流程**：
```
用户选中文本 "这个功能很好用"
     ↓
选择「润色」
     ↓
构建请求: { system: prompts.improve.system, user: "这个功能很好用" }
     ↓
发送到 LLM (stream=true)
     ↓
收到流式响应: "这" → "个" → "功" → "能" → ...
     ↓
调用 Local Tool: streamReplace(stream)
     ↓
编辑器中流式替换选中文本
```

---

### 2. TranslateAgent (翻译)

**职责**：中英文互译

**触发方式**：
- 选中文本 + 右键菜单 → 翻译
- 选中文本 + `⌘J T`

**配置**：
```typescript
const TranslateAgent = {
  id: 'translate',
  name: { zh: '翻译助手', en: 'Translator' },

  tools: [],

  config: {
    temperature: 0.1,      // 极低温度，翻译要准确
    maxTokens: 4000,       // 翻译可能较长
    stream: true
  },

  prompts: {
    toEnglish: {
      system: `你是专业的翻译。将中文翻译成英文。
规则：
- 翻译要准确、自然
- 保持原文的语气和风格
- 保持原有格式（如列表、段落结构）
- 只输出翻译结果，不要解释`,
      user: '{content}'
    },

    toChinese: {
      system: `你是专业的翻译。将英文翻译成中文。
规则：
- 翻译要准确、自然，符合中文表达习惯
- 保持原文的语气和风格
- 保持原有格式（如列表、段落结构）
- 只输出翻译结果，不要解释`,
      user: '{content}'
    },

    // 自动检测语言
    auto: {
      system: `你是专业的翻译。检测输入语言，如果是中文则翻译成英文，如果是英文则翻译成中文。
规则：
- 翻译要准确、自然
- 保持原文的语气和风格
- 保持原有格式
- 只输出翻译结果，不要解释`,
      user: '{content}'
    }
  },

  outputHandler: 'showDiffPreview'  // 翻译结果显示差异预览
}
```

---

### 3. ContinueAgent (续写补全)

**职责**：根据上下文续写内容

**触发方式**：
- 斜杠命令 `/ai 续写` 或 `/ai continue`
- 快捷键 `⌘⇧Enter`（可选）

**配置**：
```typescript
const ContinueAgent = {
  id: 'continue',
  name: { zh: '续写助手', en: 'Continue Writing' },

  tools: [],

  config: {
    temperature: 0.7,      // 较高温度，增加创造性
    maxTokens: 1000,       // 续写不宜过长
    stream: true
  },

  prompts: {
    continue: {
      system: `你是写作助手。根据上文风格和内容续写。
规则：
- 保持与上文一致的风格、语气、人称
- 自然衔接，不要重复上文
- 续写 1-3 个段落
- 直接输出续写内容，不要任何前缀或解释`,
      user: `请续写以下内容：

{beforeCursor}

---
从这里开始续写：`
    }
  },

  // 需要的上下文
  contextRequirements: {
    beforeCursor: true,    // 需要光标前的文本
    maxLength: 2000        // 最多 2000 字符
  },

  outputHandler: 'streamInsert'  // 流式插入到光标位置
}
```

---

### 4. SummaryAgent (总结提取)

**职责**：生成摘要、提取要点、提取待办

**触发方式**：
- 选中文本 + 右键 → 总结/提取要点/提取待办
- 斜杠命令 `/ai 总结`

**配置**：
```typescript
const SummaryAgent = {
  id: 'summary',
  name: { zh: '总结助手', en: 'Summarizer' },

  tools: [],

  config: {
    temperature: 0.2,      // 低温度，总结要准确
    maxTokens: 1000,
    stream: true
  },

  prompts: {
    summary: {
      system: `你是专业的内容分析师。生成简洁的摘要。
规则：
- 摘要控制在原文 20% 左右的长度
- 保留核心观点和关键信息
- 只输出摘要内容`,
      user: '请总结以下内容：\n\n{content}'
    },

    keyPoints: {
      system: `你是专业的内容分析师。提取关键要点。
规则：
- 以 bullet point 列表形式输出
- 每个要点一句话
- 按重要性排序
- 最多 7 个要点`,
      user: '请提取以下内容的关键要点：\n\n{content}'
    },

    actionItems: {
      system: `你是专业的内容分析师。从文本中提取待办事项和行动项。
规则：
- 以 checkbox 列表形式输出 (- [ ] 格式)
- 每个待办清晰、可执行
- 如果没有待办事项，回复"未发现待办事项"`,
      user: '请从以下内容中提取待办事项：\n\n{content}'
    }
  },

  outputHandler: 'streamInsert'  // 插入到选中内容后或光标位置
}
```

---

### 5. KnowledgeAgent (知识问答)

**职责**：基于笔记库回答问题

**触发方式**：
- AI 侧边面板对话
- 斜杠命令 `/ask ...`

**配置**：
```typescript
const KnowledgeAgent = {
  id: 'knowledge',
  name: { zh: '知识助手', en: 'Knowledge Assistant' },

  // 需要 Tools 来搜索和获取笔记
  tools: ['search_notes', 'get_note', 'get_related_notes'],

  config: {
    temperature: 0.5,
    maxTokens: 2000,
    stream: true
  },

  systemPrompt: {
    zh: `你是散墨笔记的知识助手。帮助用户在笔记库中查找信息、回答问题。

你可以使用以下工具：
- search_notes: 搜索笔记（支持关键词和语义搜索）
- get_note: 获取笔记详细内容
- get_related_notes: 获取相关笔记

工作原则：
1. 优先使用工具获取准确信息，不要猜测
2. 如果找不到相关信息，诚实告知
3. 回答要简洁、准确，注明信息来源（笔记标题）
4. 可以综合多篇笔记的信息来回答`,

    en: `You are the knowledge assistant for Sanqian Notes. Help users find information and answer questions from their notes.

Available tools:
- search_notes: Search notes (keyword and semantic)
- get_note: Get note details
- get_related_notes: Get related notes

Principles:
1. Use tools to get accurate info, don't guess
2. If not found, honestly say so
3. Be concise, cite sources (note titles)
4. Can synthesize info from multiple notes`
  },

  outputHandler: 'chatPanel'  // 输出到对话面板
}
```

---

### 6. ManageAgent (笔记管理)

**职责**：通过对话创建、更新、组织笔记

**触发方式**：
- AI 侧边面板对话
- 斜杠命令 `/create ...`、`/move ...`

**配置**：
```typescript
const ManageAgent = {
  id: 'manage',
  name: { zh: '管理助手', en: 'Management Assistant' },

  // 需要 Tools 来管理笔记
  tools: ['create_note', 'update_note', 'delete_note', 'search_notes'],

  config: {
    temperature: 0.3,      // 管理操作要准确
    maxTokens: 1000,
    stream: true
  },

  systemPrompt: {
    zh: `你是散墨笔记的管理助手。帮助用户创建、编辑、组织笔记。

你可以使用以下工具：
- create_note: 创建新笔记
- update_note: 更新笔记（修改标题、追加内容）
- delete_note: 删除笔记（会先确认）
- search_notes: 搜索笔记

工作原则：
1. 创建笔记时，根据内容自动生成合适的标题
2. 删除操作前要确认
3. 操作完成后简要汇报结果
4. 如果用户意图不明确，先询问澄清`,

    en: `You are the management assistant for Sanqian Notes. Help users create, edit, and organize notes.

Available tools:
- create_note: Create new note
- update_note: Update note (title, append content)
- delete_note: Delete note (confirm first)
- search_notes: Search notes

Principles:
1. Auto-generate good titles when creating
2. Confirm before deleting
3. Report results briefly after operations
4. Ask for clarification if intent is unclear`
  },

  outputHandler: 'chatPanel'
}
```

---

### 7. OutlineAgent (大纲生成)

**职责**：生成文章大纲

**触发方式**：
- 斜杠命令 `/ai 大纲 [主题]`
- `/outline [topic]`

**配置**：
```typescript
const OutlineAgent = {
  id: 'outline',
  name: { zh: '大纲助手', en: 'Outline Generator' },

  tools: [],

  config: {
    temperature: 0.6,
    maxTokens: 1500,
    stream: true
  },

  prompts: {
    generate: {
      system: `你是专业的写作顾问。为给定主题生成结构清晰的文章大纲。
规则：
- 使用 Markdown 标题格式 (## 和 ###)
- 主要章节 3-5 个
- 每个章节下可有 2-4 个子标题
- 标题简洁明了
- 直接输出大纲，不要其他解释`,
      user: '请为以下主题生成大纲：\n\n{topic}'
    },

    // 根据现有内容生成大纲
    fromContent: {
      system: `你是专业的写作顾问。分析内容并生成结构化大纲。
规则：
- 分析现有内容的逻辑结构
- 使用 Markdown 标题格式
- 保留现有内容的核心观点
- 直接输出大纲`,
      user: '请根据以下内容生成大纲：\n\n{content}'
    }
  },

  outputHandler: 'streamInsert'
}
```

---

### 8. ExplainAgent (解释说明)

**职责**：解释概念、术语、代码

**触发方式**：
- 选中文本 + 右键 → 解释
- 选中文本 + `⌘J X`

**配置**：
```typescript
const ExplainAgent = {
  id: 'explain',
  name: { zh: '解释助手', en: 'Explainer' },

  tools: [],

  config: {
    temperature: 0.4,
    maxTokens: 1500,
    stream: true
  },

  prompts: {
    explain: {
      system: `你是知识渊博的老师。用简单易懂的语言解释概念。
规则：
- 先给出简洁定义（1-2 句）
- 如有必要，举例说明
- 如有相关概念，简要提及
- 使用通俗语言，避免行话`,
      user: '请解释：{content}'
    },

    explainCode: {
      system: `你是资深程序员。解释代码的功能和逻辑。
规则：
- 说明代码做什么
- 解释关键步骤
- 如有问题，指出改进建议`,
      user: '请解释这段代码：\n\n```\n{content}\n```'
    }
  },

  outputHandler: 'showPopover'  // 显示在选中文本附近的弹窗
}
```

---

## AI Tools 详细设计

AI Tools 是注册给 LLM 调用的工具，主要用于 KnowledgeAgent 和 ManageAgent。

### 1. search_notes

```typescript
const searchNotesTool: ToolDefinition = {
  name: 'search_notes',
  description: {
    zh: '搜索笔记。支持关键词搜索和语义搜索。',
    en: 'Search notes. Supports keyword and semantic search.'
  },
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: {
          zh: '搜索关键词或问题',
          en: 'Search keywords or question'
        }
      },
      semantic: {
        type: 'boolean',
        description: {
          zh: '是否使用语义搜索（理解含义而非精确匹配）',
          en: 'Use semantic search (understand meaning, not exact match)'
        },
        default: false
      },
      limit: {
        type: 'number',
        description: {
          zh: '返回结果数量上限',
          en: 'Maximum number of results'
        },
        default: 10
      }
    },
    required: ['query']
  },

  handler: async (args: { query: string; semantic?: boolean; limit?: number }) => {
    const limit = args.limit || 10

    if (args.semantic && embeddingService) {
      // 语义搜索
      const results = await embeddingService.searchSimilar(args.query, limit)
      return {
        count: results.length,
        notes: results.map(r => ({
          id: r.noteId,
          title: r.title,
          relevance: Math.round(r.score * 100) + '%'
        }))
      }
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

      return {
        count: notes.length,
        notes: notes.map((n: any) => ({
          id: n.id,
          title: n.title,
          preview: extractPreview(n.content, args.query, 100)
        }))
      }
    }
  }
}
```

### 2. get_note

```typescript
const getNoteTool: ToolDefinition = {
  name: 'get_note',
  description: {
    zh: '获取指定笔记的详细内容',
    en: 'Get detailed content of a specific note'
  },
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: {
          zh: '笔记 ID',
          en: 'Note ID'
        }
      },
      maxLength: {
        type: 'number',
        description: {
          zh: '内容最大长度（字符数）',
          en: 'Maximum content length (characters)'
        },
        default: 3000
      }
    },
    required: ['id']
  },

  handler: async (args: { id: string; maxLength?: number }) => {
    const db = getDb()
    const note = db.prepare(`
      SELECT id, title, content, created_at, updated_at
      FROM notes
      WHERE id = ? AND is_deleted = 0
    `).get(args.id) as any

    if (!note) {
      return { error: 'Note not found' }
    }

    let textContent = extractText(note.content)
    const maxLen = args.maxLength || 3000

    if (textContent.length > maxLen) {
      textContent = textContent.slice(0, maxLen) + '... (truncated)'
    }

    return {
      id: note.id,
      title: note.title,
      content: textContent,
      wordCount: textContent.length,
      createdAt: note.created_at,
      updatedAt: note.updated_at
    }
  }
}
```

### 3. get_related_notes

```typescript
const getRelatedNotesTool: ToolDefinition = {
  name: 'get_related_notes',
  description: {
    zh: '获取与指定笔记语义相关的其他笔记',
    en: 'Get notes semantically related to the specified note'
  },
  parameters: {
    type: 'object',
    properties: {
      note_id: {
        type: 'string',
        description: {
          zh: '笔记 ID',
          en: 'Note ID'
        }
      },
      limit: {
        type: 'number',
        description: {
          zh: '返回结果数量上限',
          en: 'Maximum number of results'
        },
        default: 5
      }
    },
    required: ['note_id']
  },

  handler: async (args: { note_id: string; limit?: number }) => {
    if (!embeddingService) {
      return { error: 'Embedding service not available' }
    }

    const results = await embeddingService.getRelatedNotes(
      args.note_id,
      args.limit || 5
    )

    return {
      count: results.length,
      notes: results.map(r => ({
        id: r.noteId,
        title: r.title,
        relevance: Math.round(r.score * 100) + '%'
      }))
    }
  }
}
```

### 4. create_note

```typescript
const createNoteTool: ToolDefinition = {
  name: 'create_note',
  description: {
    zh: '创建一个新笔记',
    en: 'Create a new note'
  },
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: {
          zh: '笔记标题',
          en: 'Note title'
        }
      },
      content: {
        type: 'string',
        description: {
          zh: '笔记内容（纯文本或 Markdown）',
          en: 'Note content (plain text or Markdown)'
        }
      }
    },
    required: ['title']
  },

  handler: async (args: { title: string; content?: string }) => {
    const db = getDb()
    const id = crypto.randomUUID()
    const now = new Date().toISOString()

    // 将 Markdown 转换为 Tiptap JSON
    const doc = args.content
      ? markdownToTiptap(args.content)
      : { type: 'doc', content: [] }

    db.prepare(`
      INSERT INTO notes (id, title, content, created_at, updated_at, is_deleted, is_pinned)
      VALUES (?, ?, ?, ?, ?, 0, 0)
    `).run(id, args.title, JSON.stringify(doc), now, now)

    // 通知前端刷新
    notifyDataChange()

    return {
      success: true,
      id,
      title: args.title,
      message: `笔记「${args.title}」已创建`
    }
  }
}
```

### 5. update_note

```typescript
const updateNoteTool: ToolDefinition = {
  name: 'update_note',
  description: {
    zh: '更新现有笔记（修改标题或追加内容）',
    en: 'Update existing note (modify title or append content)'
  },
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: {
          zh: '要更新的笔记 ID',
          en: 'ID of the note to update'
        }
      },
      title: {
        type: 'string',
        description: {
          zh: '新标题（可选）',
          en: 'New title (optional)'
        }
      },
      append_content: {
        type: 'string',
        description: {
          zh: '要追加到笔记末尾的内容（可选）',
          en: 'Content to append at the end (optional)'
        }
      }
    },
    required: ['id']
  },

  handler: async (args: { id: string; title?: string; append_content?: string }) => {
    const db = getDb()
    const now = new Date().toISOString()

    // 检查笔记是否存在
    const note = db.prepare('SELECT title, content FROM notes WHERE id = ? AND is_deleted = 0')
      .get(args.id) as any

    if (!note) {
      return { error: 'Note not found' }
    }

    const updates: string[] = []

    if (args.title) {
      db.prepare('UPDATE notes SET title = ?, updated_at = ? WHERE id = ?')
        .run(args.title, now, args.id)
      updates.push(`标题已更新为「${args.title}」`)
    }

    if (args.append_content) {
      const doc = JSON.parse(note.content)
      // 追加段落
      const newParagraphs = markdownToTiptap(args.append_content).content
      doc.content.push(...newParagraphs)

      db.prepare('UPDATE notes SET content = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(doc), now, args.id)
      updates.push('内容已追加')
    }

    notifyDataChange()

    return {
      success: true,
      id: args.id,
      message: updates.join('；') || '笔记已更新'
    }
  }
}
```

### 6. delete_note

```typescript
const deleteNoteTool: ToolDefinition = {
  name: 'delete_note',
  description: {
    zh: '删除笔记（移到回收站）',
    en: 'Delete note (move to trash)'
  },
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: {
          zh: '要删除的笔记 ID',
          en: 'ID of the note to delete'
        }
      },
      confirm: {
        type: 'boolean',
        description: {
          zh: '确认删除（必须为 true 才会执行）',
          en: 'Confirm deletion (must be true to proceed)'
        }
      }
    },
    required: ['id', 'confirm']
  },

  handler: async (args: { id: string; confirm: boolean }) => {
    if (!args.confirm) {
      return {
        success: false,
        message: '请确认是否要删除这篇笔记'
      }
    }

    const db = getDb()
    const now = new Date().toISOString()

    const note = db.prepare('SELECT title FROM notes WHERE id = ? AND is_deleted = 0')
      .get(args.id) as any

    if (!note) {
      return { error: 'Note not found' }
    }

    // 软删除
    db.prepare('UPDATE notes SET is_deleted = 1, deleted_at = ?, updated_at = ? WHERE id = ?')
      .run(now, now, args.id)

    notifyDataChange()

    return {
      success: true,
      message: `笔记「${note.title}」已移至回收站`
    }
  }
}
```

---

## Local Tools 详细设计

Local Tools 是前端编辑器层面的工具，用于处理 AI 输出到 UI 的操作。

### 接口定义

```typescript
// src/renderer/src/utils/ai-editor-tools.ts

import { Editor } from '@tiptap/core'

export interface AIEditorTools {
  /**
   * 流式插入文本到光标位置
   */
  streamInsert(
    editor: Editor,
    stream: AsyncIterable<string>,
    options?: StreamInsertOptions
  ): Promise<StreamResult>

  /**
   * 流式替换选中文本
   */
  streamReplace(
    editor: Editor,
    stream: AsyncIterable<string>,
    options?: StreamReplaceOptions
  ): Promise<StreamResult>

  /**
   * 显示差异预览弹窗
   */
  showDiffPreview(
    original: string,
    generated: string,
    options?: DiffPreviewOptions
  ): Promise<DiffResult>

  /**
   * 显示 Ghost Text
   */
  showGhostText(editor: Editor, text: string): void
  hideGhostText(editor: Editor): void
  acceptGhostText(editor: Editor): void

  /**
   * 显示结果弹窗（用于解释等场景）
   */
  showPopover(
    anchor: { x: number; y: number },
    content: string,
    options?: PopoverOptions
  ): Promise<void>

  /**
   * 中断当前流式操作
   */
  abort(): void
}

// 选项类型
export interface StreamInsertOptions {
  speed?: number              // 字符间隔 (ms)，默认 15
  onToken?: (token: string) => void
  onComplete?: () => void
  onError?: (error: Error) => void
  parseMarkdown?: boolean     // 是否解析 Markdown，默认 true
}

export interface StreamReplaceOptions extends StreamInsertOptions {
  // 继承插入选项
}

export interface DiffPreviewOptions {
  title?: string
  acceptText?: string
  rejectText?: string
  position?: 'center' | 'selection'  // 弹窗位置
}

export interface DiffResult {
  action: 'accept' | 'reject' | 'cancel'
  content?: string  // accept 时返回最终内容
}

export interface StreamResult {
  success: boolean
  aborted: boolean
  insertedLength: number
  error?: Error
}

export interface PopoverOptions {
  maxWidth?: number
  autoClose?: number  // 自动关闭时间 (ms)
}
```

### 核心实现

#### 1. streamInsert

```typescript
export async function streamInsert(
  editor: Editor,
  stream: AsyncIterable<string>,
  options: StreamInsertOptions = {}
): Promise<StreamResult> {
  const {
    speed = 15,
    onToken,
    onComplete,
    onError,
    parseMarkdown = true
  } = options

  let insertedLength = 0
  let aborted = false
  const abortController = new AbortController()

  // 保存当前 abort controller 以便外部调用
  currentAbortController = abortController

  try {
    // 记录起始位置
    const startPos = editor.state.selection.from

    // 禁用历史记录（稍后统一记录）
    editor.commands.setMeta('addToHistory', false)

    // 收集完整内容用于最后的 Markdown 解析
    let fullContent = ''

    for await (const chunk of stream) {
      if (abortController.signal.aborted) {
        aborted = true
        break
      }

      fullContent += chunk
      onToken?.(chunk)

      // 逐字符插入（简单文本模式）
      if (!parseMarkdown) {
        for (const char of chunk) {
          if (abortController.signal.aborted) break
          editor.commands.insertContent(char)
          insertedLength += char.length
          await sleep(speed)
        }
      } else {
        // Markdown 模式：暂时以纯文本插入，完成后再解析
        editor.commands.insertContent(chunk)
        insertedLength += chunk.length
        await sleep(speed * chunk.length)
      }
    }

    // 如果是 Markdown 模式，完成后替换为解析后的内容
    if (parseMarkdown && !aborted && fullContent) {
      const endPos = editor.state.selection.from
      // 删除刚插入的纯文本
      editor.chain()
        .setTextSelection({ from: startPos, to: endPos })
        .deleteSelection()
        .run()

      // 插入解析后的 Markdown
      const parsed = markdownToTiptap(fullContent)
      editor.commands.insertContent(parsed)
    }

    // 恢复历史记录
    editor.commands.setMeta('addToHistory', true)

    onComplete?.()

    return {
      success: true,
      aborted,
      insertedLength
    }

  } catch (error) {
    onError?.(error as Error)
    return {
      success: false,
      aborted,
      insertedLength,
      error: error as Error
    }
  } finally {
    currentAbortController = null
  }
}

// 辅助函数
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
```

#### 2. streamReplace

```typescript
export async function streamReplace(
  editor: Editor,
  stream: AsyncIterable<string>,
  options: StreamReplaceOptions = {}
): Promise<StreamResult> {
  // 获取选中范围
  const { from, to } = editor.state.selection

  if (from === to) {
    // 没有选中内容，退化为插入
    return streamInsert(editor, stream, options)
  }

  // 保存选中的原始文本（用于可能的撤销）
  const originalText = editor.state.doc.textBetween(from, to)

  // 删除选中内容
  editor.chain()
    .setTextSelection({ from, to })
    .deleteSelection()
    .run()

  // 流式插入新内容
  const result = await streamInsert(editor, stream, options)

  // 如果被中断或失败，考虑是否需要恢复原内容
  if (result.aborted || !result.success) {
    // 可以选择恢复原内容
    // editor.commands.insertContent(originalText)
  }

  return result
}
```

#### 3. showDiffPreview

```typescript
export function showDiffPreview(
  original: string,
  generated: string,
  options: DiffPreviewOptions = {}
): Promise<DiffResult> {
  const {
    title = 'AI 生成结果',
    acceptText = '接受',
    rejectText = '取消'
  } = options

  return new Promise((resolve) => {
    // 创建弹窗 DOM
    const overlay = document.createElement('div')
    overlay.className = 'ai-diff-overlay'

    overlay.innerHTML = `
      <div class="ai-diff-modal">
        <div class="ai-diff-header">
          <h3>${title}</h3>
          <button class="ai-diff-close">×</button>
        </div>
        <div class="ai-diff-content">
          <div class="ai-diff-original">
            <div class="ai-diff-label">原文</div>
            <div class="ai-diff-text">${escapeHtml(original)}</div>
          </div>
          <div class="ai-diff-arrow">→</div>
          <div class="ai-diff-generated">
            <div class="ai-diff-label">AI 生成</div>
            <div class="ai-diff-text">${escapeHtml(generated)}</div>
          </div>
        </div>
        <div class="ai-diff-actions">
          <button class="ai-diff-reject">${rejectText}</button>
          <button class="ai-diff-accept">${acceptText}</button>
        </div>
      </div>
    `

    document.body.appendChild(overlay)

    // 绑定事件
    const cleanup = () => {
      document.body.removeChild(overlay)
    }

    overlay.querySelector('.ai-diff-close')?.addEventListener('click', () => {
      cleanup()
      resolve({ action: 'cancel' })
    })

    overlay.querySelector('.ai-diff-reject')?.addEventListener('click', () => {
      cleanup()
      resolve({ action: 'reject' })
    })

    overlay.querySelector('.ai-diff-accept')?.addEventListener('click', () => {
      cleanup()
      resolve({ action: 'accept', content: generated })
    })

    // ESC 关闭
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cleanup()
        document.removeEventListener('keydown', handleKeydown)
        resolve({ action: 'cancel' })
      }
    }
    document.addEventListener('keydown', handleKeydown)
  })
}
```

#### 4. showGhostText

```typescript
// Ghost Text 使用 Tiptap 的 Decoration 实现

import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Plugin, PluginKey } from '@tiptap/pm/state'

const ghostTextPluginKey = new PluginKey('ghostText')

export const GhostTextExtension = Extension.create({
  name: 'ghostText',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: ghostTextPluginKey,

        state: {
          init() {
            return { text: null, pos: null }
          },
          apply(tr, value) {
            const meta = tr.getMeta(ghostTextPluginKey)
            if (meta?.clear) return { text: null, pos: null }
            if (meta?.text) return { text: meta.text, pos: meta.pos }
            return value
          }
        },

        props: {
          decorations(state) {
            const { text, pos } = this.getState(state)
            if (!text || pos === null) return DecorationSet.empty

            const widget = Decoration.widget(pos, () => {
              const span = document.createElement('span')
              span.className = 'ghost-text'
              span.textContent = text
              return span
            })

            return DecorationSet.create(state.doc, [widget])
          }
        }
      })
    ]
  }
})

// 显示 Ghost Text
export function showGhostText(editor: Editor, text: string): void {
  const pos = editor.state.selection.from
  editor.view.dispatch(
    editor.state.tr.setMeta(ghostTextPluginKey, { text, pos })
  )
}

// 隐藏 Ghost Text
export function hideGhostText(editor: Editor): void {
  editor.view.dispatch(
    editor.state.tr.setMeta(ghostTextPluginKey, { clear: true })
  )
}

// 接受 Ghost Text
export function acceptGhostText(editor: Editor): void {
  const pluginState = ghostTextPluginKey.getState(editor.state)
  if (pluginState?.text) {
    editor.commands.insertContent(pluginState.text)
    hideGhostText(editor)
  }
}
```

#### 5. abort

```typescript
let currentAbortController: AbortController | null = null

export function abort(): void {
  if (currentAbortController) {
    currentAbortController.abort()
    currentAbortController = null
  }
}
```

---

## 调用流程示例

### 示例 1：选中文本润色

```
用户操作                          系统处理
─────────────────────────────────────────────────────────────────────

1. 选中 "这个功能很好用"

2. 按 ⌘J                         → 显示 AI 菜单

3. 选择「润色」                   → AgentRouter.dispatch('writing', 'improve')

                                  → 构建请求:
                                    {
                                      agent: WritingAgent,
                                      prompt: 'improve',
                                      content: "这个功能很好用",
                                      context: null
                                    }

                                  → 调用 LLM (stream=true)

4. [等待...]                      → 收到流: "此" → "功" → "能" → ...

                                  → LocalTools.streamReplace(editor, stream)

5. 看到文字逐渐替换               → 编辑器中原文被逐字替换

6. 完成                           → 创建撤销点，可用 ⌘Z 恢复
```

### 示例 2：知识问答

```
用户操作                          系统处理
─────────────────────────────────────────────────────────────────────

1. 打开 AI 侧边面板

2. 输入 "我之前写过关于 React 的笔记吗"

3. 发送                           → AgentRouter.dispatch('knowledge', 'chat')

                                  → 注入用户上下文

                                  → 调用 LLM (带 Tools)

4. [等待...]                      → LLM 决定调用 search_notes
                                    { query: "React", semantic: true }

                                  → 执行 Tool，返回结果:
                                    [{ id: "xxx", title: "React Hooks 学习笔记", relevance: "87%" }]

                                  → LLM 继续生成回复

5. 看到回复                       → "是的，你有一篇《React Hooks 学习笔记》，
                                     相关度 87%。需要我打开它吗？"

6. 点击笔记链接                   → 跳转到对应笔记
```

### 示例 3：续写

```
用户操作                          系统处理
─────────────────────────────────────────────────────────────────────

1. 写了半篇笔记，光标在末尾

2. 输入 /ai 续写                  → SlashCommand 触发

                                  → AgentRouter.dispatch('continue', 'continue')

                                  → 收集上下文:
                                    beforeCursor: "... (最近 2000 字)"

                                  → 调用 LLM (stream=true)

3. [等待...]                      → 收到流: "接" → "下" → "来" → ...

                                  → LocalTools.streamInsert(editor, stream)

4. 看到文字逐渐出现               → 内容流式插入到光标位置

5. 可随时按 Esc 中断              → LocalTools.abort()
```

---

## 更新日志

| 日期 | 更新内容 |
|------|----------|
| 2024-12-20 | 初版设计，完整的 Agents 和 Tools 体系 |
