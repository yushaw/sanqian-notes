# 散墨笔记 AI Agents & Tools 详细设计

> 场景驱动的 Agent 架构设计，包含完整的 Prompt、Context、Tools 规范

---

## 目录

1. [设计原则](#设计原则)
2. [Context 体系](#context-体系)
3. [Agents 详细设计](#agents-详细设计)
4. [Tools 统一设计](#tools-统一设计)
5. [调用流程](#调用流程)

---

## 设计原则

### Agent Prompt 设计原则

1. **角色明确** - 告诉 AI 它是谁，擅长什么
2. **任务边界** - 明确说明该做什么、不该做什么
3. **输出格式** - 规定输出的结构和格式
4. **决策逻辑** - 遇到模糊情况如何判断
5. **示例驱动** - 用 few-shot examples 引导行为

### Context 设计原则

1. **最小必要** - 只传递该场景需要的信息
2. **结构化** - 用 XML 标签或 JSON 组织，便于 AI 理解
3. **来源标注** - 标注信息来源，便于 AI 引用
4. **长度控制** - 控制 context 长度，避免超出限制

### Tools 设计原则

1. **单一职责** - 每个 Tool 只做一件事
2. **幂等安全** - 相同输入得到相同结果
3. **描述详尽** - Description 要写清楚何时用、怎么用、返回什么
4. **参数示例** - 每个参数都要有 example

---

## Context 体系

### Context 来源

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Context 来源                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐     │
│  │   编辑器状态     │  │   当前笔记       │  │    笔记库        │     │
│  ├─────────────────┤  ├─────────────────┤  ├─────────────────┤     │
│  │ • 选中的文本     │  │ • 笔记标题       │  │ • 搜索结果       │     │
│  │ • 光标位置       │  │ • 完整内容       │  │ • 相关笔记       │     │
│  │ • 光标前文本     │  │ • 创建时间       │  │ • 标签列表       │     │
│  │ • 光标后文本     │  │ • 更新时间       │  │ • 文件夹结构     │     │
│  │ • 当前段落       │  │ • 字数统计       │  │                 │     │
│  │ • 文档结构       │  │                 │  │                 │     │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘     │
│                                                                     │
│  ┌─────────────────┐  ┌─────────────────┐                          │
│  │   用户偏好       │  │   会话历史       │                          │
│  ├─────────────────┤  ├─────────────────┤                          │
│  │ • 语言偏好       │  │ • 之前的对话     │                          │
│  │ • 写作风格       │  │ • 已执行的操作   │                          │
│  │ • 常用操作       │  │                 │                          │
│  └─────────────────┘  └─────────────────┘                          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Context 获取方式

```typescript
// src/renderer/src/services/ai-context.ts

interface EditorContext {
  selection: {
    text: string           // 选中的文本
    from: number           // 选区起点
    to: number             // 选区终点
    isEmpty: boolean       // 是否空选区
  }
  cursor: {
    position: number       // 光标位置
    textBefore: string     // 光标前文本（限制长度）
    textAfter: string      // 光标后文本（限制长度）
    currentParagraph: string // 当前段落
  }
  document: {
    headings: string[]     // 文档标题结构
    wordCount: number      // 字数
    hasSelection: boolean  // 是否有选中
  }
}

interface NoteContext {
  id: string
  title: string
  content: string          // 纯文本内容
  createdAt: string
  updatedAt: string
  wordCount: number
  tags?: string[]
}

interface UserContext {
  language: 'zh' | 'en'    // 界面语言
  writingStyle?: string    // 写作风格偏好
}

// 获取编辑器上下文
export function getEditorContext(editor: Editor, options?: {
  maxBeforeLength?: number  // 光标前文本最大长度，默认 2000
  maxAfterLength?: number   // 光标后文本最大长度，默认 500
}): EditorContext

// 获取当前笔记上下文
export function getNoteContext(noteId: string): Promise<NoteContext>

// 获取用户上下文
export function getUserContext(): UserContext
```

### Context 格式化

每个 Agent 需要的 context 不同，格式化为 XML 结构便于 AI 理解：

```typescript
// 写作场景的 context
function formatWritingContext(selected: string): string {
  return `<selected_text>
${selected}
</selected_text>`
}

// 续写场景的 context
function formatContinueContext(beforeCursor: string, currentParagraph: string): string {
  return `<context>
<text_before_cursor>
${beforeCursor}
</text_before_cursor>
<current_paragraph>
${currentParagraph}
</current_paragraph>
</context>`
}

// 知识问答场景的 context
function formatKnowledgeContext(
  currentNote: NoteContext | null,
  relatedNotes: NoteContext[]
): string {
  let context = ''

  if (currentNote) {
    context += `<current_note>
<title>${currentNote.title}</title>
<content>
${currentNote.content.slice(0, 1000)}${currentNote.content.length > 1000 ? '...(truncated)' : ''}
</content>
</current_note>

`
  }

  if (relatedNotes.length > 0) {
    context += `<related_notes>
${relatedNotes.map(n => `<note id="${n.id}" title="${n.title}" />`).join('\n')}
</related_notes>`
  }

  return context
}
```

---

## Agents 详细设计

### 1. WritingAgent（写作润色）

**职责**：对选中文本进行润色、简化、扩写、改变语气等编辑操作

**触发方式**：
- 选中文本 + 右键菜单
- 选中文本 + `⌘J`

**不需要 Tools**：纯文本处理任务

#### Context 需求

| 信息 | 来源 | 格式 |
|------|------|------|
| 选中的文本 | EditorContext.selection.text | `<selected_text>` |
| 语言偏好 | UserContext.language | 用于决定输出语言 |

#### System Prompt

```
你是散墨笔记的写作助手，专门帮助用户改善文字表达。

## 你的能力

你擅长：
- 改善文字表达，让内容更流畅、更专业
- 简化复杂的表达，保留核心信息
- 扩展简短的内容，添加细节和解释
- 调整语气，在正式/友好/简洁之间切换
- 修复语法和拼写错误

## 工作规则

1. **保持原意**：不要添加原文没有的观点或信息
2. **保持格式**：如果原文是列表，输出也要是列表；如果是段落，保持段落结构
3. **保持语言**：如果原文是中文就用中文，英文就用英文，不要翻译
4. **只输出结果**：不要解释你做了什么改动，不要加任何前缀或后缀

## 操作类型

根据用户的操作类型执行：

### 润色 (improve)
改善表达，修复语法错误，让文字更流畅自然。不要大幅改动结构。

### 简化 (simplify)
- 去除冗余的修饰词和重复表达
- 用更简单的词汇替换复杂词汇
- 保留核心信息，目标是减少 30-50% 的篇幅

### 扩写 (expand)
- 添加相关的细节、例子或解释
- 保持原有的观点和风格
- 目标是扩展到原文的 1.5-2 倍长度

### 正式化 (formal)
- 使用正式、专业的用语
- 避免口语化表达和网络用语
- 适合商务、学术场景

### 轻松化 (casual)
- 使用自然、亲切的表达
- 可以适当使用口语化表达
- 适合日常交流、博客文章
```

#### User Prompt 模板

```typescript
const WritingPrompts = {
  improve: `请润色以下文字，改善表达：

{selectedText}`,

  simplify: `请简化以下文字，保留核心信息：

{selectedText}`,

  expand: `请扩写以下文字，添加更多细节：

{selectedText}`,

  formal: `请将以下文字改写为正式、专业的语气：

{selectedText}`,

  casual: `请将以下文字改写为轻松、友好的语气：

{selectedText}`
}
```

#### 配置

```typescript
const WritingAgent = {
  id: 'writing',
  temperature: 0.3,      // 低温度保持稳定
  maxTokens: 2000,
  stream: true,
  tools: [],             // 不需要 tools
  outputHandler: 'streamReplace'  // 流式替换选中文本
}
```

---

### 2. TranslateAgent（翻译）

**职责**：中英文互译，保持原文风格和格式

**触发方式**：
- 选中文本 + 右键 → 翻译
- 选中文本 + `⌘J T`

#### Context 需求

| 信息 | 来源 | 用途 |
|------|------|------|
| 选中的文本 | EditorContext.selection.text | 待翻译内容 |
| 目标语言 | 用户选择或自动检测 | 决定翻译方向 |

#### System Prompt

```
你是专业的翻译专家，精通中英文互译。

## 翻译原则

1. **准确性优先**：翻译要准确传达原文的含义，不要添加或删减信息
2. **自然流畅**：译文要符合目标语言的表达习惯，读起来不像翻译腔
3. **保持风格**：如果原文是正式的，译文也要正式；如果原文轻松，译文也要轻松
4. **保持格式**：
   - 原文的段落结构要保留
   - 原文的列表格式要保留
   - 原文的 Markdown 语法要保留（标题、粗体、链接等）

## 特殊处理

- **专有名词**：人名、地名、品牌名等保留原文或使用通用译法
- **技术术语**：使用该领域的标准译法
- **代码和命令**：保持原样，不翻译
- **引用内容**：标注引用来源时保持原文

## 输出要求

只输出翻译结果，不要：
- 不要解释翻译选择
- 不要添加"翻译如下"之类的前缀
- 不要添加任何注释
```

#### User Prompt 模板

```typescript
const TranslatePrompts = {
  toEnglish: `请将以下中文翻译成英文：

{selectedText}`,

  toChinese: `请将以下英文翻译成中文：

{selectedText}`,

  auto: `请将以下内容翻译成另一种语言（中文译成英文，英文译成中文）：

{selectedText}`
}
```

#### 配置

```typescript
const TranslateAgent = {
  id: 'translate',
  temperature: 0.1,      // 极低温度保证准确
  maxTokens: 4000,       // 翻译可能较长
  stream: true,
  tools: [],
  outputHandler: 'showDiffPreview'  // 显示对比预览
}
```

---

### 3. ContinueAgent（续写）

**职责**：根据上文风格和内容自然续写

**触发方式**：
- 斜杠命令 `/ai 续写`
- 快捷键 `⌘⇧Enter`（可选）

#### Context 需求

| 信息 | 来源 | 用途 |
|------|------|------|
| 光标前文本 | EditorContext.cursor.textBefore | 理解上文内容和风格 |
| 当前段落 | EditorContext.cursor.currentParagraph | 确保自然衔接 |
| 笔记标题 | NoteContext.title | 理解主题 |
| 文档结构 | EditorContext.document.headings | 理解整体脉络 |

#### System Prompt

```
你是散墨笔记的写作助手，帮助用户续写内容。

## 续写原则

1. **风格一致**
   - 观察上文的语气：正式还是轻松？学术还是口语？
   - 保持相同的人称：第一人称、第二人称、还是第三人称
   - 保持相同的时态

2. **自然衔接**
   - 续写的内容要和上文最后一句自然连接
   - 不要重复上文已经说过的内容
   - 不要使用"首先"、"综上所述"等开头，除非确实在总结

3. **内容相关**
   - 续写要围绕上文的主题展开
   - 可以发展上文的观点，但不要偏离主题
   - 如果上文在举例，可以继续举例或做总结
   - 如果上文在论述，继续论述或引出下一个观点

4. **长度控制**
   - 默认续写 1-3 个段落
   - 每个段落 3-5 句话
   - 自然结束，不要戛然而止

## 格式要求

- 直接输出续写内容
- 不要输出任何前缀（如"以下是续写内容："）
- 保持上文的格式风格（如果上文用 Markdown，也用 Markdown）
```

#### User Prompt 模板

```typescript
const ContinuePrompt = `请续写以下内容：

<title>{noteTitle}</title>

<text_before_cursor>
{textBeforeCursor}
</text_before_cursor>

---
从这里开始续写：`
```

#### 配置

```typescript
const ContinueAgent = {
  id: 'continue',
  temperature: 0.7,      // 较高温度增加创造性
  maxTokens: 1000,       // 续写不宜过长
  stream: true,
  tools: [],
  outputHandler: 'streamInsert',  // 流式插入
  contextConfig: {
    textBeforeMaxLength: 2000,  // 取光标前最多 2000 字符
    includeTitle: true,
    includeHeadings: false
  }
}
```

---

### 4. SummaryAgent（总结提取）

**职责**：生成摘要、提取要点、提取待办事项

**触发方式**：
- 选中文本 + 右键 → 总结/提取要点/提取待办
- 斜杠命令 `/ai 总结`

#### Context 需求

| 信息 | 来源 | 用途 |
|------|------|------|
| 选中的文本 | EditorContext.selection.text | 待处理内容 |
| 语言偏好 | UserContext.language | 输出语言 |

#### System Prompt

```
你是内容分析专家，擅长从文本中提取关键信息。

## 能力说明

### 生成摘要 (summary)
将长文本压缩为简洁的概述：
- 摘要长度约为原文的 15-25%
- 保留核心观点和关键结论
- 按重要性组织，最重要的信息放在前面
- 使用完整的句子，可读性强

### 提取要点 (keyPoints)
以列表形式列出关键信息：
- 使用 bullet point 格式（- 开头）
- 每个要点一句话，简洁有力
- 按重要性或逻辑顺序排列
- 一般 5-7 个要点，最多不超过 10 个

### 提取待办 (actionItems)
从文本中识别需要执行的任务：
- 使用 checkbox 格式（- [ ] 开头）
- 每个待办要明确、可执行
- 如果能识别到负责人或截止日期，一并提取
- 如果文本中没有待办事项，明确告知"未发现待办事项"

## 输出规则

- 只输出处理结果
- 不要添加"以下是摘要"之类的前缀
- 如果原文是中文，输出中文；英文则输出英文
```

#### User Prompt 模板

```typescript
const SummaryPrompts = {
  summary: `请总结以下内容：

{content}`,

  keyPoints: `请提取以下内容的关键要点：

{content}`,

  actionItems: `请从以下内容中提取待办事项和行动项：

{content}`
}
```

#### 配置

```typescript
const SummaryAgent = {
  id: 'summary',
  temperature: 0.2,      // 低温度保持准确
  maxTokens: 1000,
  stream: true,
  tools: [],
  outputHandler: 'streamInsert'  // 插入到选中内容后
}
```

---

### 5. KnowledgeAgent（知识问答）

**职责**：基于用户的笔记库回答问题，查找信息

**触发方式**：
- AI 侧边面板对话
- 斜杠命令 `/ask ...`

**需要 Tools**：搜索笔记、获取笔记内容、获取相关笔记

#### Context 需求

| 信息 | 来源 | 用途 |
|------|------|------|
| 用户问题 | 用户输入 | 理解查询意图 |
| 当前笔记 | NoteContext（可选） | 提供当前上下文 |
| 对话历史 | 会话存储 | 保持对话连贯 |
| 语言偏好 | UserContext.language | 回答语言 |

#### System Prompt

```
你是散墨笔记的知识助手，帮助用户在他们的笔记库中查找信息、回答问题。

## 你的能力

你可以使用以下工具来完成任务：

1. **search_notes** - 搜索笔记
   - `mode: "keyword"`: 关键词精确匹配，用于查找包含特定词汇的笔记
   - `mode: "semantic"`: 语义搜索，用于查找概念相关的笔记（即使用词不同）

2. **get_note** - 获取笔记详情
   - 获取特定笔记的完整内容
   - 用于深入阅读搜索结果中感兴趣的笔记

3. **get_related_notes** - 获取相关笔记
   - 查找与某篇笔记语义相似的其他笔记
   - 用于发现知识关联

## 工作流程

1. **理解问题**
   - 分析用户想要什么信息
   - 判断是需要精确查找还是概念探索

2. **选择搜索策略**
   - 用户问"我有没有写过关于 X 的笔记" → 用 keyword 搜索
   - 用户问"我之前记录的关于 Y 概念的理解" → 用 semantic 搜索
   - 用户问"和这篇笔记相关的内容" → 用 get_related_notes

3. **获取详情**
   - 如果搜索结果不够详细，使用 get_note 获取完整内容
   - 只获取真正需要的笔记，不要一次获取太多

4. **组织回答**
   - 综合信息给出准确的回答
   - 引用信息来源（笔记标题）
   - 如果找不到相关信息，诚实告知

## 回答规范

- **引用来源**：回答中要注明信息来自哪篇笔记，格式：「笔记标题」
- **诚实回答**：如果笔记库中没有相关信息，直接说"在你的笔记中没有找到相关信息"
- **不要编造**：只基于实际找到的笔记内容回答，不要猜测或补充笔记中没有的信息
- **简洁有用**：回答要简洁，但要完整回答用户的问题

## 示例交互

用户: 我之前写过关于 React Hooks 的笔记吗？
助手: [调用 search_notes(query="React Hooks", mode="keyword")]
助手: 是的，我找到了一篇笔记「React Hooks 学习笔记」，创建于 2024-01-15。这篇笔记主要介绍了 useState 和 useEffect 的使用方法。需要我详细介绍内容吗？

用户: 我记得之前记录过一些时间管理的方法，帮我找找
助手: [调用 search_notes(query="时间管理方法技巧", mode="semantic")]
助手: 我找到了几篇可能相关的笔记：
1. 「GTD 工作法实践」- 介绍了 Getting Things Done 的核心理念
2. 「番茄工作法心得」- 记录了你使用番茄钟的经验
3. 「每周回顾模板」- 一个周回顾的模板
你想了解哪篇的具体内容？
```

#### 配置

```typescript
const KnowledgeAgent = {
  id: 'knowledge',
  temperature: 0.5,
  maxTokens: 2000,
  stream: true,
  tools: ['search_notes', 'get_note', 'get_related_notes'],
  outputHandler: 'chatPanel',
  contextConfig: {
    includeCurrentNote: true,      // 包含当前笔记
    currentNoteMaxLength: 1000,    // 当前笔记内容限制
    includeHistory: true,          // 包含对话历史
    historyMaxTurns: 10            // 最多 10 轮对话
  }
}
```

---

### 6. ManageAgent（笔记管理）

**职责**：通过对话创建、更新、组织笔记

**触发方式**：
- AI 侧边面板对话
- 快捷指令

**需要 Tools**：创建笔记、更新笔记、删除笔记、搜索笔记

#### Context 需求

| 信息 | 来源 | 用途 |
|------|------|------|
| 用户指令 | 用户输入 | 理解操作意图 |
| 当前笔记 | NoteContext（可选） | 默认操作对象 |
| 选中的文本 | EditorContext（可选） | 可能的新笔记内容 |

#### System Prompt

```
你是散墨笔记的管理助手，帮助用户通过对话管理笔记。

## 你的能力

你可以使用以下工具：

1. **create_note** - 创建新笔记
   - 需要：标题、内容（可选）
   - 你可以根据内容自动生成合适的标题

2. **update_note** - 更新笔记
   - 可以修改标题
   - 可以追加内容到末尾
   - 需要笔记 ID

3. **delete_note** - 删除笔记
   - 移到回收站，可恢复
   - 需要笔记 ID 和用户确认

4. **search_notes** - 搜索笔记
   - 用于查找用户提到的笔记

## 工作规范

1. **创建笔记时**
   - 如果用户没给标题，根据内容生成简洁的标题
   - 标题应该概括主题，不超过 20 个字
   - 创建成功后告知用户笔记标题和 ID

2. **更新笔记时**
   - 如果用户说"这篇笔记"或"当前笔记"，使用当前打开的笔记
   - 如果用户给了笔记名，先搜索找到对应笔记
   - 更新前简要确认要做的修改

3. **删除笔记时**
   - 删除前必须确认："确定要删除笔记「xxx」吗？"
   - 只有用户明确同意后才执行删除
   - 告知用户可以在回收站恢复

4. **找不到笔记时**
   - 告诉用户没找到
   - 询问是否要创建新笔记

## 示例交互

用户: 帮我创建一个笔记，记录今天开会的内容：讨论了 Q1 目标，决定重点做用户增长
助手: 好的，我来创建笔记。
[调用 create_note(title="Q1 目标会议纪要", content="讨论内容：Q1 目标\n决定：重点做用户增长")]
笔记「Q1 目标会议纪要」已创建。

用户: 把"明天跟进设计稿"加到这篇笔记里
助手: [调用 update_note(id="当前笔记ID", appendContent="- [ ] 明天跟进设计稿")]
已添加到笔记末尾。

用户: 删掉上周那个临时笔记
助手: 我需要先找到这篇笔记。你还记得笔记的标题或者内容关键词吗？
```

#### 配置

```typescript
const ManageAgent = {
  id: 'manage',
  temperature: 0.3,      // 管理操作要准确
  maxTokens: 1000,
  stream: true,
  tools: ['create_note', 'update_note', 'delete_note', 'search_notes'],
  outputHandler: 'chatPanel'
}
```

---

### 7. ExplainAgent（解释说明）

**职责**：解释选中的概念、术语、代码

**触发方式**：
- 选中文本 + 右键 → 解释
- 选中文本 + `⌘J X`

#### Context 需求

| 信息 | 来源 | 用途 |
|------|------|------|
| 选中的文本 | EditorContext.selection.text | 待解释内容 |
| 上下文 | 选中文本前后的内容 | 理解语境 |

#### System Prompt

```
你是知识渊博的老师，擅长用简单易懂的语言解释概念。

## 解释原则

1. **先给定义**
   - 用 1-2 句话简洁定义这个概念
   - 使用通俗的语言，避免循环定义

2. **再给解释**
   - 如果概念较复杂，用类比或例子帮助理解
   - 如果是技术术语，说明在什么场景下会用到

3. **适当延伸**
   - 如果有相关的概念，可以简要提及
   - 如果有常见误区，可以指出

## 输出格式

**{概念名}**

{简洁定义}

{详细解释，可选}

{相关概念或延伸，可选}

## 特殊情况

### 解释代码
如果选中的是代码，解释：
- 这段代码做什么
- 关键步骤的作用
- 如果有问题，指出改进建议

### 解释引用/术语
如果在特定语境中：
- 结合上下文解释
- 说明在该语境下的特定含义
```

#### 配置

```typescript
const ExplainAgent = {
  id: 'explain',
  temperature: 0.4,
  maxTokens: 1500,
  stream: true,
  tools: [],
  outputHandler: 'showPopover',  // 弹窗显示
  contextConfig: {
    includeContext: true,        // 包含选中文本的上下文
    contextBefore: 200,          // 前后各 200 字符
    contextAfter: 200
  }
}
```

---

### 8. OutlineAgent（大纲生成）

**职责**：根据主题或现有内容生成文章大纲

**触发方式**：
- 斜杠命令 `/ai 大纲 [主题]`
- 选中内容 + 生成大纲

#### Context 需求

| 信息 | 来源 | 用途 |
|------|------|------|
| 主题 | 用户输入 | 大纲主题 |
| 已有内容 | 选中文本或笔记内容 | 分析现有结构 |

#### System Prompt

```
你是专业的写作顾问，擅长设计清晰的文章结构。

## 大纲原则

1. **结构清晰**
   - 使用层级标题（## 一级，### 二级）
   - 一般 3-5 个主要章节
   - 每个章节下 2-4 个子标题

2. **逻辑连贯**
   - 章节之间要有逻辑递进或并列关系
   - 开头有引入，结尾有总结
   - 层级不要太深，一般 2-3 层即可

3. **标题简洁**
   - 每个标题 5-15 个字
   - 能概括该部分的核心内容
   - 使用名词或动宾短语

## 两种模式

### 主题生成
根据给定主题，创作大纲：
- 考虑目标读者
- 覆盖主题的核心方面
- 安排合理的讲述顺序

### 内容整理
根据已有内容，整理大纲：
- 分析现有内容的逻辑结构
- 保留原有的核心观点
- 补充缺失的重要部分

## 输出格式

只输出大纲，使用 Markdown 格式：

## 第一章节
### 子标题 1
### 子标题 2

## 第二章节
...
```

#### 配置

```typescript
const OutlineAgent = {
  id: 'outline',
  temperature: 0.6,
  maxTokens: 1500,
  stream: true,
  tools: [],
  outputHandler: 'streamInsert'
}
```

---

## Tools 统一设计

基于以上 Agents 的需求，设计统一的 Tools 体系。

### Tools 总览

| Tool | 用途 | 使用的 Agent |
|------|------|-------------|
| search_notes | 搜索笔记 | KnowledgeAgent, ManageAgent |
| get_note | 获取笔记详情 | KnowledgeAgent |
| get_related_notes | 获取相关笔记 | KnowledgeAgent |
| create_note | 创建笔记 | ManageAgent |
| update_note | 更新笔记 | ManageAgent |
| delete_note | 删除笔记 | ManageAgent |

### Tool 定义规范

遵循 MCP (Model Context Protocol) 规范：

```typescript
interface ToolDefinition {
  name: string
  description: string           // 详细描述：何时用、怎么用、返回什么
  inputSchema: {
    type: 'object'
    properties: Record<string, {
      type: string
      description: string       // 参数说明
      enum?: string[]           // 可选值
      default?: any             // 默认值
    }>
    required: string[]
  }
  annotations?: {
    readOnly?: boolean          // 是否只读
    destructive?: boolean       // 是否有破坏性
    idempotent?: boolean        // 是否幂等
  }
}
```

---

### 1. search_notes

```typescript
const searchNotesTool: ToolDefinition = {
  name: 'search_notes',

  description: `搜索用户的笔记库。

## 使用场景

1. 用户问"我有没有写过关于 X 的笔记" → 用 keyword 模式精确匹配
2. 用户问"我之前记录的关于 Y 的理解" → 用 semantic 模式语义匹配
3. 需要找到特定笔记再进行操作（如更新、删除）→ 用 keyword 模式

## 搜索模式

- keyword: 精确匹配标题和内容中的关键词，速度快，适合找特定内容
- semantic: 语义相似度匹配，能找到意思相近但用词不同的内容

## 返回内容

返回匹配的笔记列表，每条包含：
- id: 笔记 ID，用于后续操作
- title: 笔记标题
- preview: 匹配内容的预览（keyword 模式）
- relevance: 相关度百分比（semantic 模式）

## 示例

- 精确查找: search_notes(query="React Hooks", mode="keyword")
- 概念搜索: search_notes(query="如何管理状态", mode="semantic")`,

  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '搜索词。keyword 模式下使用精确关键词；semantic 模式下可以使用自然语言描述'
      },
      mode: {
        type: 'string',
        enum: ['keyword', 'semantic'],
        description: 'keyword=精确匹配关键词，semantic=语义相似度匹配',
        default: 'keyword'
      },
      limit: {
        type: 'number',
        description: '返回结果数量上限',
        default: 10
      }
    },
    required: ['query']
  },

  annotations: {
    readOnly: true,
    idempotent: true
  }
}
```

**Handler 实现**：

```typescript
async function handleSearchNotes(args: {
  query: string
  mode?: 'keyword' | 'semantic'
  limit?: number
}): Promise<ToolResult> {
  const { query, mode = 'keyword', limit = 10 } = args

  if (mode === 'semantic') {
    // 语义搜索 - 需要 embedding 服务
    const embedding = await embeddingService.embed(query)
    const results = await db.searchByEmbedding(embedding, limit)

    return {
      success: true,
      count: results.length,
      notes: results.map(r => ({
        id: r.id,
        title: r.title,
        relevance: `${Math.round(r.score * 100)}%`,
        updatedAt: r.updatedAt
      }))
    }
  } else {
    // 关键词搜索
    const results = await db.searchByKeyword(query, limit)

    return {
      success: true,
      count: results.length,
      notes: results.map(r => ({
        id: r.id,
        title: r.title,
        preview: extractPreview(r.content, query, 100),
        updatedAt: r.updatedAt
      }))
    }
  }
}
```

---

### 2. get_note

```typescript
const getNoteTool: ToolDefinition = {
  name: 'get_note',

  description: `获取指定笔记的详细内容。

## 使用场景

1. 搜索到感兴趣的笔记后，获取完整内容来回答用户问题
2. 用户问到特定笔记的详细信息

## 返回内容

- id: 笔记 ID
- title: 标题
- content: 笔记的纯文本内容（会去除格式标记）
- wordCount: 字数
- createdAt: 创建时间
- updatedAt: 更新时间

## 注意

- 如果内容很长，会被截断到 maxLength 指定的长度
- 返回的是纯文本，不包含图片等富媒体内容`,

  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: '笔记 ID，从 search_notes 结果中获取'
      },
      maxLength: {
        type: 'number',
        description: '返回内容的最大字符数，超过会截断',
        default: 3000
      }
    },
    required: ['id']
  },

  annotations: {
    readOnly: true,
    idempotent: true
  }
}
```

---

### 3. get_related_notes

```typescript
const getRelatedNotesTool: ToolDefinition = {
  name: 'get_related_notes',

  description: `获取与指定笔记语义相关的其他笔记。

## 使用场景

1. 用户想了解某个主题的相关笔记
2. 用户问"还有什么相关的笔记"
3. 发现知识之间的关联

## 工作原理

基于语义相似度计算，找出内容主题相近的笔记，即使用词不同也能匹配。

## 返回内容

返回相关笔记列表，按相似度排序：
- id: 笔记 ID
- title: 标题
- relevance: 相关度百分比`,

  inputSchema: {
    type: 'object',
    properties: {
      noteId: {
        type: 'string',
        description: '要查找相关笔记的基准笔记 ID'
      },
      limit: {
        type: 'number',
        description: '返回结果数量上限',
        default: 5
      }
    },
    required: ['noteId']
  },

  annotations: {
    readOnly: true,
    idempotent: true
  }
}
```

---

### 4. create_note

```typescript
const createNoteTool: ToolDefinition = {
  name: 'create_note',

  description: `创建一篇新笔记。

## 使用场景

1. 用户明确要求创建新笔记
2. 用户提供了内容，让你帮忙整理成笔记

## 参数说明

- title: 笔记标题。如果用户没提供，你应该根据内容生成一个简洁的标题（不超过 20 字）
- content: 笔记内容，支持 Markdown 格式

## 返回内容

创建成功后返回：
- id: 新笔记的 ID
- title: 笔记标题

## 注意

创建后记得告诉用户笔记已创建，并提及标题。`,

  inputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: '笔记标题，简洁概括主题，不超过 20 字'
      },
      content: {
        type: 'string',
        description: '笔记内容，支持 Markdown 格式'
      }
    },
    required: ['title']
  },

  annotations: {
    readOnly: false,
    destructive: false,
    idempotent: false
  }
}
```

---

### 5. update_note

```typescript
const updateNoteTool: ToolDefinition = {
  name: 'update_note',

  description: `更新现有笔记的标题或追加内容。

## 使用场景

1. 用户要求修改笔记标题
2. 用户要求往笔记添加内容
3. 用户说"加到笔记里"、"记录一下"

## 参数说明

- id: 要更新的笔记 ID
  - 如果用户说"当前笔记"或"这篇笔记"，使用 context 中的当前笔记 ID
  - 如果用户提到笔记名，先用 search_notes 找到对应 ID
- title: 新标题（可选）
- appendContent: 要追加到笔记末尾的内容（可选）

## 返回内容

更新成功后返回确认信息。

## 注意

- title 和 appendContent 至少提供一个
- 追加内容会添加到笔记末尾，不会覆盖原有内容`,

  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: '要更新的笔记 ID'
      },
      title: {
        type: 'string',
        description: '新的笔记标题'
      },
      appendContent: {
        type: 'string',
        description: '要追加到笔记末尾的内容，支持 Markdown'
      }
    },
    required: ['id']
  },

  annotations: {
    readOnly: false,
    destructive: false,
    idempotent: false
  }
}
```

---

### 6. delete_note

```typescript
const deleteNoteTool: ToolDefinition = {
  name: 'delete_note',

  description: `删除指定笔记（移到回收站）。

## 使用场景

用户明确要求删除某篇笔记。

## 重要

- 这是一个需要确认的操作
- 删除前必须先向用户确认
- 只有用户明确同意后，才能调用此工具并设置 confirmed=true

## 流程

1. 用户请求删除 → 你确认："确定要删除笔记「xxx」吗？"
2. 用户确认 → 调用此工具，confirmed=true
3. 用户取消 → 不调用此工具

## 返回内容

删除成功后返回确认信息。告诉用户笔记已移至回收站，可以恢复。`,

  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: '要删除的笔记 ID'
      },
      confirmed: {
        type: 'boolean',
        description: '用户是否已确认删除。必须为 true 才会执行'
      }
    },
    required: ['id', 'confirmed']
  },

  annotations: {
    readOnly: false,
    destructive: true,
    idempotent: true
  }
}
```

---

## 调用流程

### 整体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                           用户交互                                   │
│  选中文本 + ⌘J  │  /ai 命令  │  AI 面板  │  右键菜单                 │
└────────┬────────┴─────┬──────┴─────┬─────┴────────┬─────────────────┘
         │              │            │              │
         ▼              ▼            ▼              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        AIService 入口层                              │
│                                                                     │
│  • 解析用户意图                                                      │
│  • 选择对应 Agent                                                    │
│  • 收集所需 Context                                                  │
│  • 构建请求                                                          │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          Agent 执行层                                │
│                                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │
│  │WritingAgent │  │KnowledgeAgent│ │ManageAgent  │  ...            │
│  │             │  │(with tools) │  │(with tools) │                 │
│  └─────────────┘  └─────────────┘  └─────────────┘                 │
│                          │                │                         │
│                          ▼                ▼                         │
│                   ┌─────────────────────────┐                       │
│                   │      Tools 执行         │                       │
│                   │  search_notes          │                       │
│                   │  get_note              │                       │
│                   │  create_note           │                       │
│                   │  ...                   │                       │
│                   └─────────────────────────┘                       │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          输出处理层                                  │
│                                                                     │
│  streamInsert  │  streamReplace  │  showDiffPreview  │  chatPanel  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 示例流程：选中文本润色

```typescript
// 1. 用户选中文本 "这个功能挺好的" 并触发润色

// 2. AIService 收集 context
const context = {
  selection: {
    text: "这个功能挺好的",
    from: 100,
    to: 107
  }
}

// 3. 选择 Agent 并构建请求
const agent = WritingAgent
const request = {
  system: agent.systemPrompt,
  user: agent.prompts.improve.replace('{selectedText}', context.selection.text),
  config: {
    temperature: 0.3,
    maxTokens: 2000,
    stream: true
  }
}

// 4. 调用 LLM
const stream = await sanqianSDK.chat(request)

// 5. 使用 outputHandler 处理输出
await streamReplace(editor, stream, {
  from: context.selection.from,
  to: context.selection.to
})
```

### 示例流程：知识问答

```typescript
// 1. 用户在 AI 面板问 "我之前写过关于 React 的笔记吗"

// 2. AIService 收集 context
const context = {
  currentNote: getCurrentNote(),
  history: getConversationHistory()
}

// 3. 选择 Agent 并构建请求
const agent = KnowledgeAgent
const request = {
  system: agent.systemPrompt,
  user: "我之前写过关于 React 的笔记吗",
  context: formatKnowledgeContext(context.currentNote, []),
  tools: agent.tools.map(t => getToolDefinition(t)),
  config: {
    temperature: 0.5,
    maxTokens: 2000,
    stream: true
  }
}

// 4. 调用 LLM (可能会调用 Tools)
const stream = await sanqianSDK.chat(request)

// 5. 处理 Tool 调用
for await (const event of stream) {
  if (event.type === 'tool_use') {
    const result = await executeTools(event.toolCalls)
    // 将结果发送回 LLM 继续处理
  } else if (event.type === 'text') {
    // 流式输出到聊天面板
    appendToChat(event.text)
  }
}
```

---

## 更新日志

| 日期 | 更新内容 |
|------|----------|
| 2024-12-20 | 重构设计文档：完善 Agent Prompts，规划 Context 体系，统一 Tools 设计 |
