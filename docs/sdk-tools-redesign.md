# SDK Tools 重新设计

> 以 Markdown 为核心的 AI Agent Tools 设计

---

## 改动总览

### Phase 1: 格式转换层（基础）

| 任务 | 文件 | 工作量 | 说明 |
|------|------|--------|------|
| 1.1 实现 `tiptapToMarkdown()` | `src/main/markdown/tiptap-to-markdown.ts` | 中 | TipTap JSON → Markdown |
| 1.2 抽取 `markdownToTiptap()` | `src/main/markdown/markdown-to-tiptap.ts` | 小 | 从 MarkdownPaste.ts 抽取 |
| 1.3 导出统一接口 | `src/main/markdown/index.ts` | 小 | 统一导出 |

### Phase 2: Tool 优化

| 任务 | 文件 | 工作量 | 说明 |
|------|------|--------|------|
| 2.1 `get_note` 输出 Markdown | `src/main/sanqian-sdk.ts` | 小 | 调用 tiptapToMarkdown |
| 2.2 `get_note` 增加 heading 参数 | `src/main/sanqian-sdk.ts` | 中 | 章节定位 |
| 2.3 `get_note` 增加返回字段 | `src/main/sanqian-sdk.ts` | 小 | tags/summary/word_count 等 |
| 2.4 `create_note` 接受 Markdown | `src/main/sanqian-sdk.ts` | 小 | 调用 markdownToTiptap |
| 2.5 `update_note` 接受 Markdown | `src/main/sanqian-sdk.ts` | 小 | 调用 markdownToTiptap |
| 2.6 `update_note` 增加 append/prepend | `src/main/sanqian-sdk.ts` | 中 | 追加/插入模式 |
| 2.7 `update_note` 增加 edit 模式 | `src/main/sanqian-sdk.ts` | 中 | 精确替换 |
| 2.8 `search_notes` 增加返回字段 | `src/main/sanqian-sdk.ts` | 小 | tags/has_summary 等 |
| 2.9 `get_notebooks` 增加返回字段 | `src/main/sanqian-sdk.ts` | 小 | note_count 等 |

### Phase 3: 新增 Tool

| 任务 | 文件 | 工作量 | 说明 |
|------|------|--------|------|
| 3.1 新增 `move_note` | `src/main/sanqian-sdk.ts` | 小 | 移动笔记到其他 notebook |

### Phase 4: Context 优化

| 任务 | 文件 | 工作量 | 说明 |
|------|------|--------|------|
| 4.1 收集光标上下文 | `src/renderer/src/components/Editor.tsx` | 中 | nearestHeading + currentParagraph |
| 4.2 传递新字段 | `src/renderer/src/App.tsx` | 小 | cursorContext 替代 currentBlockId |
| 4.3 格式化 context 输出 | `src/main/sanqian-sdk.ts` | 小 | 更友好的光标位置描述 |

### Phase 5: 清理

| 任务 | 文件 | 工作量 | 说明 |
|------|------|--------|------|
| 5.1 移除 block_id 参数 | `src/main/sanqian-sdk.ts` | 小 | get_note 不再接受 block_id |
| 5.2 更新 i18n | `src/main/i18n.ts` | 小 | Tool 描述更新 |

---

## 现状分析

### 现有 Tools（6个）

| Tool | 参数 | 问题 |
|------|------|------|
| `search_notes` | query, notebook_id?, limit? | 返回信息不够（缺 tags、summary 等） |
| `get_note` | id, block_id? | 返回 TipTap JSON，AI 难理解 |
| `create_note` | title, content?, notebook_id? | 需要传 TipTap JSON，AI 难生成 |
| `update_note` | id, title?, content? | 只能全量替换，无法追加 |
| `delete_note` | id | OK |
| `get_notebooks` | - | 返回信息太少 |

### 核心问题

**内容格式不友好**：TipTap JSON 对 AI 来说太复杂

```json
// AI 需要生成这样的内容
{"type":"doc","content":[{"type":"paragraph","attrs":{"blockId":"abc"},"content":[{"type":"text","text":"Hello"}]}]}
```

**应该这样**：

```markdown
# 标题
Hello World
```

---

## 设计目标

1. **Markdown 为核心**：所有内容输入输出都使用 Markdown
2. **双向转换**：TipTap JSON ↔ Markdown 无损转换
3. **操作友好**：支持追加、插入等常用操作
4. **信息丰富**：返回足够的元信息供 AI 决策

---

## 格式转换架构

### 现有能力

```
Markdown → HTML → TipTap (MarkdownPaste.ts)
```

### 需要补充

```
TipTap → Markdown (新增)
```

### 转换模块设计

```typescript
// src/main/markdown/index.ts

/**
 * Markdown ↔ TipTap 转换模块
 */

// Markdown → TipTap JSON
export function markdownToTiptap(markdown: string): TiptapDoc

// TipTap JSON → Markdown
export function tiptapToMarkdown(doc: TiptapDoc): string

// 检测内容格式
export function detectFormat(content: string): 'markdown' | 'tiptap' | 'plain'
```

### 支持的 Markdown 语法

| 语法 | 示例 | TipTap 节点 |
|------|------|-------------|
| 标题 | `# H1` `## H2` | heading |
| 粗体 | `**bold**` | bold mark |
| 斜体 | `*italic*` | italic mark |
| 删除线 | `~~strike~~` | strike mark |
| 高亮 | `==highlight==` | highlight mark |
| 下划线 | `++underline++` | underline mark |
| 代码 | `` `code` `` | code mark |
| 链接 | `[text](url)` | link mark |
| 图片 | `![alt](src)` | image node |
| 无序列表 | `- item` | bulletList |
| 有序列表 | `1. item` | orderedList |
| 任务列表 | `- [ ] todo` | taskList |
| 引用 | `> quote` | blockquote |
| 代码块 | ``` code ``` | codeBlock |
| 表格 | `| a | b |` | table |
| 分割线 | `---` | horizontalRule |
| 数学公式 | `$x^2$` `$$E=mc^2$$` | mathematics |
| Mermaid | ```mermaid | mermaid |
| Callout | `> [!note]` | callout |
| 折叠块 | `<details>` | toggle |
| 脚注 | `[^1]` | footnote |

---

## 新 Tools 设计

### 1. search_notes（优化）

```typescript
{
  name: 'search_notes',
  description: '搜索笔记，支持语义搜索和关键词搜索',
  parameters: {
    query: string,           // 搜索词
    notebook_id?: string,    // 限定 notebook
    limit?: number,          // 默认 10
    include_content?: boolean // 是否返回内容预览，默认 true
  },
  returns: [{
    id: string,
    title: string,
    preview: string,         // 匹配内容预览（Markdown）
    score: number,
    updated_at: string,
    notebook_id: string,
    notebook_name: string,   // 新增
    tags: string[],          // 新增
    has_summary: boolean,    // 新增：有无 AI 摘要
    is_pinned: boolean,      // 新增
    is_favorite: boolean     // 新增
  }]
}
```

### 2. get_note（优化）

```typescript
{
  name: 'get_note',
  description: '获取笔记内容（Markdown 格式）',
  parameters: {
    id: string,
    heading?: string,        // 新增：获取特定章节（如 "## 第三章"）
    format?: 'markdown' | 'plain'  // 默认 markdown
  },
  returns: {
    id: string,
    title: string,
    content: string,         // Markdown 格式！
    summary?: string,        // AI 摘要
    tags: string[],          // 标签
    notebook_id: string,
    notebook_name: string,
    created_at: string,
    updated_at: string,
    is_pinned: boolean,
    is_favorite: boolean,
    word_count: number       // 字数统计
  }
}
```

**设计决策：不暴露 block_id 给 Tool API**

参考 Notion MCP 的做法：
- **存储层**：TipTap JSON（有 block_id，支持富格式）
- **API 层**：纯 Markdown（AI 友好，token 效率高）

block_id 只在 **editor-state context** 中使用（告诉 AI 光标在哪个块），不作为 Tool 参数。

原因：
1. Markdown 没有 block_id 概念，暴露会造成困惑
2. AI 操作应该基于内容匹配（old_string/new_string），而非 ID
3. Notion 也是这么做的：MCP 只用 Markdown，不暴露 block ID

```typescript
// ✅ 正确：基于内容定位
get_note({ id: "xxx", heading: "## 项目背景" })
update_note({ id: "xxx", edit: { old_string: "旧内容", new_string: "新内容" } })

// ❌ 移除：block_id 不暴露给 Tool
get_note({ id: "xxx", block_id: "abc123" })  // 不再支持
```

### 3. create_note（优化）

```typescript
{
  name: 'create_note',
  description: '创建笔记，内容使用 Markdown 格式',
  parameters: {
    title: string,
    content?: string,        // Markdown 格式
    notebook_id?: string,
    tags?: string[],         // 新增：初始标签
    is_pinned?: boolean,     // 新增：是否置顶
    is_favorite?: boolean    // 新增：是否收藏
  },
  returns: {
    id: string,
    title: string,
    message: string
  }
}
```

### 4. update_note（优化）

```typescript
{
  name: 'update_note',
  description: '更新笔记，支持多种编辑模式',
  parameters: {
    id: string,
    title?: string,

    // === 内容更新模式（三选一）===

    // 模式 1: 全量替换
    content?: string,        // Markdown 格式

    // 模式 2: 追加/插入
    append?: string,         // 追加到末尾（Markdown）
    prepend?: string,        // 插入到开头（Markdown）

    // 模式 3: 精确替换（借鉴 sanqian edit_file）
    edit?: {
      old_string: string,    // 精确匹配的原文
      new_string: string,    // 替换为
      replace_all?: boolean  // 是否全局替换，默认 false
    },

    // === 元信息更新 ===
    tags?: string[],
    is_pinned?: boolean,
    is_favorite?: boolean
  },
  returns: {
    id: string,
    title: string,
    message: string,
    // 精确替换模式返回替换数量
    replacements?: number
  }
}
```

**精确替换示例**（借鉴 sanqian edit_file）：
```typescript
// 替换特定内容
update_note({
  id: "xxx",
  edit: {
    old_string: "旧的段落内容",
    new_string: "新的段落内容"
  }
})

// 全局重命名
update_note({
  id: "xxx",
  edit: {
    old_string: "oldVariable",
    new_string: "newVariable",
    replace_all: true
  }
})
// 返回: { replacements: 5, message: "替换了 5 处" }
```

**错误处理**（借鉴 sanqian）：
- 如果 `old_string` 不存在：返回 `❌ 未找到匹配内容`
- 如果 `old_string` 出现多次且 `replace_all=false`：返回 `❌ 找到 N 处匹配，请使用 replace_all=true 或提供更精确的内容`

### 5. move_note（新增）

```typescript
{
  name: 'move_note',
  description: '移动笔记到其他 notebook',
  parameters: {
    id: string,
    notebook_id: string      // 目标 notebook（null = 移出）
  },
  returns: {
    id: string,
    message: string
  }
}
```

### 6. get_notebooks（优化）

```typescript
{
  name: 'get_notebooks',
  description: '获取所有 notebook 列表',
  parameters: {},
  returns: [{
    id: string,
    name: string,
    note_count: number,      // 新增
    updated_at: string       // 新增
  }]
}
```

### 7. delete_note（保持）

```typescript
{
  name: 'delete_note',
  description: '删除笔记（移至回收站）',
  parameters: {
    id: string
  },
  returns: {
    message: string
  }
}
```

---

## 实现计划

### Phase 1: 格式转换层

1. **实现 `tiptapToMarkdown()`**
   - 遍历 TipTap JSON 节点树
   - 递归转换为 Markdown 字符串
   - 处理所有自定义节点（callout、math、mermaid 等）

2. **优化 `markdownToTiptap()`**
   - 基于现有 MarkdownPaste.ts
   - 抽取为独立模块供 SDK 使用

### Phase 2: Tool 优化

1. **search_notes** - 增加元信息返回
2. **get_note** - 输出转为 Markdown
3. **create_note** - 输入接受 Markdown，内部转换
4. **update_note** - 支持 append/prepend

### Phase 3: 新增 Tool

1. **move_note** - 移动笔记

---

## 技术细节

### TipTap → Markdown 转换规则

```typescript
const nodeConverters: Record<string, (node: TiptapNode) => string> = {
  // 块级元素
  paragraph: (node) => `${convertChildren(node)}\n\n`,
  heading: (node) => `${'#'.repeat(node.attrs.level)} ${convertChildren(node)}\n\n`,
  bulletList: (node) => convertListItems(node, '-'),
  orderedList: (node) => convertListItems(node, '1.'),
  taskList: (node) => convertTaskItems(node),
  blockquote: (node) => convertChildren(node).split('\n').map(l => `> ${l}`).join('\n'),
  codeBlock: (node) => `\`\`\`${node.attrs.language || ''}\n${node.content}\n\`\`\`\n\n`,
  horizontalRule: () => `---\n\n`,

  // 自定义块
  callout: (node) => `> [!${node.attrs.type}] ${node.attrs.title || ''}\n> ${convertChildren(node)}\n\n`,
  mathematics: (node) => node.attrs.display === 'yes' ? `$$\n${node.attrs.latex}\n$$\n\n` : `$${node.attrs.latex}$`,
  mermaid: (node) => `\`\`\`mermaid\n${node.content}\n\`\`\`\n\n`,

  // 行内元素
  text: (node) => applyMarks(node.text, node.marks),
  image: (node) => `![${node.attrs.alt || ''}](${node.attrs.src})`,
  // ...
}

const markConverters: Record<string, (text: string) => string> = {
  bold: (t) => `**${t}**`,
  italic: (t) => `*${t}*`,
  strike: (t) => `~~${t}~~`,
  code: (t) => `\`${t}\``,
  highlight: (t) => `==${t}==`,
  underline: (t) => `++${t}++`,
  link: (t, attrs) => `[${t}](${attrs.href})`,
}
```

### 边界情况处理

1. **嵌套列表**：递归处理，增加缩进
2. **表格**：对齐处理，支持列宽
3. **图片/附件**：保持原有路径格式
4. **笔记链接**：保持 `[[note:id]]` 格式
5. **空内容**：返回空字符串而非 null

---

## 兼容性

### 向后兼容

- 旧版 Tools 继续工作（内部自动转换）
- 数据库存储格式不变（TipTap JSON）
- 仅 API 层面使用 Markdown

### 迁移策略

- 无需数据迁移
- Agent 可以立即使用新 Tools
- 渲染层无需改动

---

## 与 Notion MCP 对比

### Notion MCP Tools（15个）

| Tool | 功能 | 我们对标 |
|------|------|----------|
| `notion-search` | 跨工作区搜索（含 Slack/Drive/Jira） | `search_notes` ✅ |
| `notion-fetch` | 通过 URL 获取内容 | `get_note` ✅ |
| `notion-create-pages` | 批量创建页面 | `create_note`（单个） |
| `notion-update-page` | 更新页面 | `update_note` ✅ |
| `notion-move-pages` | 移动页面 | `move_note` 🆕 |
| `notion-duplicate-page` | 复制页面 | ❌ 暂不需要 |
| `notion-create-database` | 创建数据库 | ❌ 不适用 |
| `notion-update-database` | 更新数据库 | ❌ 不适用 |
| `notion-query-data-sources` | 跨数据源查询 | ❌ 不适用 |
| `notion-create-comment` | 添加评论 | ❌ 暂无评论功能 |
| `notion-get-comments` | 获取评论 | ❌ 暂无评论功能 |
| `notion-get-teams` | 获取团队 | ❌ 单用户应用 |
| `notion-get-users` | 获取用户列表 | ❌ 单用户应用 |
| `notion-get-user` | 获取用户信息 | ❌ 单用户应用 |
| `notion-get-self` | 获取当前用户 | ❌ 单用户应用 |

### 我们比 Notion 强的地方

| 能力 | Notion | 我们 |
|------|--------|------|
| **章节级别获取** | ❌ 只能获取整页 | ✅ `get_note(heading: "## 章节")` |
| **编辑器上下文** | ❌ 无 | ✅ `editor-state` context（当前笔记/选中文本/光标位置） |
| **精确编辑** | ❌ 只能追加 blocks | ✅ `update_note(edit: {old_string, new_string})` |
| **语义搜索** | ❌ 关键词搜索 | ✅ `hybridSearch` 混合检索 |
| **本地优先** | ❌ 云端 | ✅ 数据在本地 |

### Notion 值得学习的地方

| 能力 | Notion 做法 | 我们需要改进 |
|------|-------------|--------------|
| **内容格式** | Notion-flavored Markdown | ✅ 本次重点：支持 Markdown |
| **批量操作** | `create-pages` 支持多个 | 🟡 可选：`batch_create_notes` |
| **追加内容** | 支持 append blocks | ✅ 本次重点：`update_note(append)` |
| **丰富返回** | 返回完整属性 | ✅ 本次改进：增加 tags/summary 等 |

### 我们不需要的

| Notion Tool | 原因 |
|-------------|------|
| 数据库相关（create/update/query） | 我们是笔记应用，非数据库 |
| 评论相关 | 暂无评论功能 |
| 用户/团队相关 | 单用户本地应用 |
| 复制页面 | 低频需求，可后续添加 |

### 结论

我们的 Tools 数量更少（7个 vs 15个），但更聚焦：

```
Notion: 通用工作区平台，需要数据库/协作/评论等
我们:   专注笔记场景，强调写作体验和语义理解
```

**核心差异化**：
1. 章节级别操作 + 精确编辑（Notion 只能整页或追加）
2. 编辑器上下文感知（Notion 没有）
3. 语义搜索（Notion 是关键词）
4. 本地优先（Notion 是云端）

---

## 借鉴 Sanqian file_ops 的设计

Sanqian 的 `backend/tools/builtin/file_ops.py` 有很多值得借鉴的设计：

### 1. 范围读取 → 章节读取

sanqian 的 `offset/limit` 适合纯文本文件，但笔记用 TipTap JSON 存储，行号不稳定。

**调整方案**：用 `heading` 参数替代行号

```typescript
// sanqian: 行号定位（适合代码/日志）
read_file(path, offset=100, limit=50)

// 笔记: 章节定位（更符合笔记场景）
get_note({ id: "xxx", heading: "## 第三章" })
```

**已采纳**：`get_note` 增加 `heading` 参数（而非 offset/limit）

### 2. 精确替换（edit_file）

```python
edit_file(path, old_string, new_string, replace_all=False)
```

- 如果 `old_string` 多次出现且 `replace_all=False`，报错
- 返回替换数量

**已采纳**：`update_note` 增加 `edit` 模式

### 3. 友好的错误提示 + 建议

```
❌ File too large: 5,000 lines (exceeds 2,000 line limit)

💡 Please use range parameters:
   read_file("file.md", offset=1, limit=100)
   Or use search_file() to find specific content
```

**启发**：所有 Tool 的错误返回都应包含具体建议

### 4. 长内容策略

```
LONG content (>1000 words): Write outline with [TBD] markers → edit_file to expand
```

**启发**：`create_note` 的 description 可以加上类似建议

### 5. 输出带元信息

```
=== filename.md (Lines 1-50 / 200 total) ===
```

**已采纳**：`get_note` 返回 `line_range` 信息

---

## 依赖关系 & 实施顺序

```
Phase 1: 格式转换层（基础，必须先做）
    │
    ├── 1.1 tiptapToMarkdown()  ←── 核心，所有 get 操作依赖
    │
    └── 1.2 markdownToTiptap()  ←── 所有 create/update 操作依赖
            │
            ▼
Phase 2: Tool 优化（依赖 Phase 1）
    │
    ├── 2.1-2.3 get_note 优化
    ├── 2.4-2.7 create/update_note 优化
    └── 2.8-2.9 search/notebooks 优化
            │
            ▼
Phase 3: 新增 Tool（可并行）
    │
    └── 3.1 move_note
            │
            ▼
Phase 4: Context 优化（可独立进行）
    │
    ├── 4.1 Editor 收集光标上下文
    ├── 4.2 App 传递新字段
    └── 4.3 SDK 格式化输出
            │
            ▼
Phase 5: 清理（最后做）
    │
    ├── 5.1 移除 block_id 参数
    └── 5.2 更新 i18n
```

### 建议实施顺序

**第一批（核心）**：
1. Phase 1 全部 → 格式转换是基础
2. Phase 2.1 (get_note 输出 Markdown) → 验证转换正确性

**第二批（增强）**：
3. Phase 2.4-2.5 (create/update 接受 Markdown)
4. Phase 2.6-2.7 (append/prepend/edit 模式)
5. Phase 2.2 (heading 参数)

**第三批（完善）**：
6. Phase 2.3, 2.8, 2.9 (增加返回字段)
7. Phase 3.1 (move_note)
8. Phase 4 (Context 优化)

**最后（清理）**：
9. Phase 5 (移除 block_id, 更新 i18n)

---

## 工作量估算

| Phase | 任务数 | 预计工作量 |
|-------|--------|-----------|
| Phase 1 | 3 | ⭐⭐⭐ |
| Phase 2 | 9 | ⭐⭐⭐⭐ |
| Phase 3 | 1 | ⭐ |
| Phase 4 | 3 | ⭐⭐ |
| Phase 5 | 2 | ⭐ |
| **总计** | **18** | - |

---

## 参考

- [Notion MCP Tools](https://developers.notion.com/docs/mcp-supported-tools)
- [Notion MCP 设计博客](https://www.notion.com/blog/notions-hosted-mcp-server-an-inside-look)
- [Sanqian file_ops.py](../../../sanqian/backend/tools/builtin/file_ops.py)
- [TipTap 官方文档](https://tiptap.dev/)
- [marked.js](https://marked.js.org/)
