# 模板系统设计方案

## 一、功能概述

为三三笔记添加模板系统，允许用户创建、管理和插入预定义的内容模板。

### 核心功能
- 模板 CRUD（创建、读取、更新、删除）
- 模板内容支持变量替换
- 模板内容支持特殊 Block（Dataview、Agent、TOC）
- 日记默认模板
- 从顶栏菜单插入模板

---

## 二、数据结构

### 2.1 数据库表

```sql
-- Templates table
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  content TEXT NOT NULL,           -- Tiptap JSON 格式
  icon TEXT DEFAULT '',
  is_daily_default INTEGER DEFAULT 0,
  order_index INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_templates_order ON templates(order_index);
CREATE INDEX IF NOT EXISTS idx_templates_daily ON templates(is_daily_default);
```

### 2.2 TypeScript 类型定义

```typescript
// src/shared/types.ts

/** 模板完整类型 */
export interface Template {
  id: string
  name: string
  description: string
  content: string              // Tiptap JSON string
  icon: string
  isDailyDefault: boolean
  orderIndex: number
  createdAt: string
  updatedAt: string
}

/** 模板创建/更新输入 */
export interface TemplateInput {
  name: string
  description?: string
  content: string
  icon?: string
  isDailyDefault?: boolean
}

/** 模板 API 接口 */
export interface TemplateAPI {
  getAll: () => Promise<Template[]>
  get: (id: string) => Promise<Template | null>
  getDailyDefault: () => Promise<Template | null>
  create: (input: TemplateInput) => Promise<Template>
  update: (id: string, updates: Partial<TemplateInput>) => Promise<Template | null>
  delete: (id: string) => Promise<boolean>
  reorder: (orderedIds: string[]) => Promise<void>
  setDailyDefault: (id: string | null) => Promise<void>
}
```

---

## 三、变量系统

### 3.1 支持的变量

| 变量 | 说明 | 示例输出 |
|------|------|----------|
| `{{title}}` | 当前笔记标题 | 我的笔记 |
| `{{date}}` | 今天日期 (YYYY-MM-DD) | 2026-01-14 |
| `{{date:FORMAT}}` | 自定义日期格式 | 2026年01月14日 |
| `{{time}}` | 当前时间 (HH:mm) | 14:30 |
| `{{time:FORMAT}}` | 自定义时间格式 | 14:30:00 |
| `{{datetime}}` | 日期+时间 | 2026-01-14 14:30 |
| `{{notebook}}` | 笔记本名称 | 工作笔记 |
| `{{cursor}}` | 光标定位点 | (插入后光标位置) |

### 3.2 日期格式 (dayjs 格式)

| 格式符 | 说明 | 示例 |
|--------|------|------|
| YYYY | 四位年份 | 2026 |
| MM | 两位月份 | 01 |
| DD | 两位日期 | 14 |
| HH | 24小时制小时 | 14 |
| mm | 分钟 | 30 |
| ss | 秒 | 00 |
| dddd | 星期全称 | Tuesday |
| ddd | 星期缩写 | Tue |

### 3.3 变量解析实现

```typescript
// src/renderer/src/utils/templateVariables.ts

import dayjs from 'dayjs'

export interface TemplateContext {
  title: string
  notebookName: string
}

/**
 * 解析模板变量
 * @param text 包含变量的文本
 * @param context 上下文信息
 * @returns 解析后的文本和光标位置
 */
export function parseTemplateVariables(
  text: string,
  context: TemplateContext
): { text: string; cursorOffset: number | null } {
  const now = dayjs()
  let cursorOffset: number | null = null
  let processedLength = 0

  const result = text.replace(/\{\{(\w+)(?::([^}]+))?\}\}/g, (match, variable, format, offset) => {
    let replacement = ''

    switch (variable) {
      case 'title':
        replacement = context.title
        break
      case 'date':
        replacement = now.format(format || 'YYYY-MM-DD')
        break
      case 'time':
        replacement = now.format(format || 'HH:mm')
        break
      case 'datetime':
        replacement = now.format(format || 'YYYY-MM-DD HH:mm')
        break
      case 'notebook':
        replacement = context.notebookName
        break
      case 'cursor':
        cursorOffset = processedLength + offset
        replacement = ''
        break
      default:
        replacement = match // 保留未知变量
    }

    processedLength += replacement.length
    return replacement
  })

  return { text: result, cursorOffset }
}

/**
 * 解析 Tiptap JSON 内容中的变量
 */
export function parseTemplateContent(
  content: string,
  context: TemplateContext
): { content: string; cursorPosition: { nodeIndex: number; offset: number } | null } {
  // 遍历 JSON 中的文本节点，解析变量
  // 实现详见代码
}
```

---

## 四、API 设计

### 4.1 主进程数据库操作

```typescript
// src/main/database.ts 新增

// ============ Template Functions ============

interface TemplateRow {
  id: string
  name: string
  description: string | null
  content: string
  icon: string | null
  is_daily_default: number
  order_index: number
  created_at: string
  updated_at: string
}

function rowToTemplate(row: TemplateRow): Template {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    content: row.content,
    icon: row.icon || '',
    isDailyDefault: row.is_daily_default === 1,
    orderIndex: row.order_index,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function getAllTemplates(): Template[] {
  const rows = db.prepare('SELECT * FROM templates ORDER BY order_index').all() as TemplateRow[]
  return rows.map(rowToTemplate)
}

export function getTemplate(id: string): Template | null {
  const row = db.prepare('SELECT * FROM templates WHERE id = ?').get(id) as TemplateRow | undefined
  return row ? rowToTemplate(row) : null
}

export function getDailyDefaultTemplate(): Template | null {
  const row = db.prepare('SELECT * FROM templates WHERE is_daily_default = 1').get() as TemplateRow | undefined
  return row ? rowToTemplate(row) : null
}

export function createTemplate(input: TemplateInput): Template {
  const id = uuidv4()
  const now = new Date().toISOString()
  const maxOrder = db.prepare('SELECT MAX(order_index) as max FROM templates').get() as { max: number | null }
  const orderIndex = (maxOrder?.max ?? -1) + 1

  // 如果设为日记默认，先清除其他的
  if (input.isDailyDefault) {
    db.prepare('UPDATE templates SET is_daily_default = 0').run()
  }

  db.prepare(`
    INSERT INTO templates (id, name, description, content, icon, is_daily_default, order_index, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.name,
    input.description || '',
    input.content,
    input.icon || '',
    input.isDailyDefault ? 1 : 0,
    orderIndex,
    now,
    now
  )

  return getTemplate(id)!
}

export function updateTemplate(id: string, updates: Partial<TemplateInput>): Template | null {
  const existing = getTemplate(id)
  if (!existing) return null

  const now = new Date().toISOString()

  // 如果设为日记默认，先清除其他的
  if (updates.isDailyDefault) {
    db.prepare('UPDATE templates SET is_daily_default = 0 WHERE id != ?').run(id)
  }

  const fields: string[] = []
  const values: unknown[] = []

  if (updates.name !== undefined) {
    fields.push('name = ?')
    values.push(updates.name)
  }
  if (updates.description !== undefined) {
    fields.push('description = ?')
    values.push(updates.description)
  }
  if (updates.content !== undefined) {
    fields.push('content = ?')
    values.push(updates.content)
  }
  if (updates.icon !== undefined) {
    fields.push('icon = ?')
    values.push(updates.icon)
  }
  if (updates.isDailyDefault !== undefined) {
    fields.push('is_daily_default = ?')
    values.push(updates.isDailyDefault ? 1 : 0)
  }

  fields.push('updated_at = ?')
  values.push(now)
  values.push(id)

  db.prepare(`UPDATE templates SET ${fields.join(', ')} WHERE id = ?`).run(...values)

  return getTemplate(id)
}

export function deleteTemplate(id: string): boolean {
  const result = db.prepare('DELETE FROM templates WHERE id = ?').run(id)
  return result.changes > 0
}

export function reorderTemplates(orderedIds: string[]): void {
  const stmt = db.prepare('UPDATE templates SET order_index = ? WHERE id = ?')
  const updateMany = db.transaction((ids: string[]) => {
    ids.forEach((id, index) => {
      stmt.run(index, id)
    })
  })
  updateMany(orderedIds)
}

export function setDailyDefaultTemplate(id: string | null): void {
  db.prepare('UPDATE templates SET is_daily_default = 0').run()
  if (id) {
    db.prepare('UPDATE templates SET is_daily_default = 1 WHERE id = ?').run(id)
  }
}
```

### 4.2 IPC Handler

```typescript
// src/main/index.ts 新增

// Template handlers
ipcMain.handle('templates:getAll', () => getAllTemplates())
ipcMain.handle('templates:get', (_, id: string) => getTemplate(id))
ipcMain.handle('templates:getDailyDefault', () => getDailyDefaultTemplate())
ipcMain.handle('templates:create', (_, input: TemplateInput) => createTemplate(input))
ipcMain.handle('templates:update', (_, id: string, updates: Partial<TemplateInput>) => updateTemplate(id, updates))
ipcMain.handle('templates:delete', (_, id: string) => deleteTemplate(id))
ipcMain.handle('templates:reorder', (_, orderedIds: string[]) => reorderTemplates(orderedIds))
ipcMain.handle('templates:setDailyDefault', (_, id: string | null) => setDailyDefaultTemplate(id))
```

### 4.3 Preload 暴露

```typescript
// src/preload/index.ts 新增

templates: {
  getAll: () => ipcRenderer.invoke('templates:getAll'),
  get: (id: string) => ipcRenderer.invoke('templates:get', id),
  getDailyDefault: () => ipcRenderer.invoke('templates:getDailyDefault'),
  create: (input: TemplateInput) => ipcRenderer.invoke('templates:create', input),
  update: (id: string, updates: Partial<TemplateInput>) => ipcRenderer.invoke('templates:update', id, updates),
  delete: (id: string) => ipcRenderer.invoke('templates:delete', id),
  reorder: (orderedIds: string[]) => ipcRenderer.invoke('templates:reorder', orderedIds),
  setDailyDefault: (id: string | null) => ipcRenderer.invoke('templates:setDailyDefault', id),
} as TemplateAPI,
```

---

## 五、前端组件

### 5.1 组件结构

```
src/renderer/src/components/
  templates/
    TemplateSettings.tsx       # 设置页模板管理
    TemplateEditor.tsx         # 模板编辑器（复用 BlockNote）
    TemplateSelector.tsx       # 模板选择弹窗
    TemplateListItem.tsx       # 模板列表项（支持拖拽）
```

### 5.2 TemplateSettings 组件

设置页中的模板管理界面：

- 模板列表（支持拖拽排序）
- 新建模板按钮
- 每个模板项：
  - 名称、图标、描述预览
  - 日记默认标记
  - 编辑、复制、删除按钮
- 点击编辑打开 TemplateEditor

### 5.3 TemplateEditor 组件

模板编辑弹窗：

- 模板名称输入
- 模板描述输入（可选）
- 图标选择（可选）
- 内容编辑器（复用现有 BlockNote 编辑器）
- 变量提示/插入帮助
- 日记默认开关
- 保存/取消按钮

### 5.4 TemplateSelector 组件

插入模板时的选择弹窗：

- 模板列表（按 order_index 排序）
- 每项显示：图标、名称、描述
- 点击直接插入
- 支持键盘导航

---

## 六、交互流程

### 6.1 插入模板

```
用户操作                           系统处理
────────                           ────────
顶栏更多菜单
    ↓
点击「插入模板」
    ↓
                                   打开 TemplateSelector 弹窗
                                   调用 templates:getAll 获取列表
    ↓
选择一个模板
    ↓
                                   获取模板内容
                                   解析变量（title, date, time 等）
                                   将内容插入到编辑器光标位置
                                   如有 {{cursor}}，定位光标
    ↓
完成插入
```

### 6.2 日记自动应用模板

```
用户操作                           系统处理
────────                           ────────
点击「今日」或创建日记
    ↓
                                   检查是否已存在今日日记
                                   如不存在：
                                     调用 templates:getDailyDefault
                                     如有默认模板：
                                       解析变量
                                       用模板内容创建日记
                                     否则：
                                       创建空白日记
    ↓
打开日记
```

### 6.3 模板管理

```
用户操作                           系统处理
────────                           ────────
设置 → 模板管理                     显示 TemplateSettings
    ↓
点击「新建模板」                    打开 TemplateEditor（空白）
    ↓
编辑内容、填写名称
    ↓
点击保存                            调用 templates:create
                                   刷新列表
    ↓
拖拽排序                            调用 templates:reorder
    ↓
设为日记默认                        调用 templates:setDailyDefault
```

---

## 七、特殊 Block 支持

模板内容（Tiptap JSON）可包含以下特殊 Block：

### 7.1 DataviewBlock

```json
{
  "type": "dataviewBlock",
  "attrs": {
    "query": "LIST FROM #todo WHERE !completed",
    "isEditing": false
  }
}
```

### 7.2 AgentBlock

```json
{
  "type": "agentBlock",
  "attrs": {
    "blockId": null,  // 插入时自动生成
    "agentId": "agent-xxx",
    "agentName": "写作助手",
    "additionalPrompt": "",
    "outputFormat": "auto",
    "processMode": "append",
    "status": "idle"
  }
}
```

### 7.3 TocBlock

```json
{
  "type": "tocBlock",
  "attrs": {
    "collapsed": false
  }
}
```

插入时需要特殊处理：
- `agentBlock` 的 `blockId` 需要生成新的 UUID
- 确保 Block 类型在编辑器中已注册

---

## 八、预置模板

内置一个「日记」模板，默认设为日记默认模板：

```json
{
  "name": "日记",
  "description": "每日日记模板",
  "icon": "",
  "isDailyDefault": true,
  "content": {
    "type": "doc",
    "content": [
      {
        "type": "heading",
        "attrs": { "level": 2 },
        "content": [{ "type": "text", "text": "{{date:YYYY年MM月DD日}} {{date:dddd}}" }]
      },
      {
        "type": "heading",
        "attrs": { "level": 3 },
        "content": [{ "type": "text", "text": "今日待办" }]
      },
      {
        "type": "taskList",
        "content": [
          {
            "type": "taskItem",
            "attrs": { "checked": false },
            "content": [{ "type": "paragraph" }]
          }
        ]
      },
      {
        "type": "heading",
        "attrs": { "level": 3 },
        "content": [{ "type": "text", "text": "日记" }]
      },
      {
        "type": "paragraph",
        "content": [{ "type": "text", "text": "{{cursor}}" }]
      }
    ]
  }
}
```

---

## 九、前端 UX 设计

### 9.1 入口：更多菜单

在 ExportMenu 组件中新增「插入模板」菜单项：

```
更多菜单下拉
├── Open Chat          ⌘K
├── ─────────────────────
├── Find               ⌘F
├── ─────────────────────
├── Split Right
├── Split Down
├── ─────────────────────
├── Import
├── Export
├── Insert Template    ← 新增
```

**交互**：
- 点击「Insert Template」→ 打开 TemplateSelector 弹窗
- 如果没有模板，显示提示"暂无模板，前往设置创建"

### 9.2 模板选择器弹窗 (TemplateSelector)

**布局**：
```
┌─────────────────────────────────────┐
│                              [×]    │  ← 关闭按钮（右上角外侧，参考 ExportMenu）
├─────────────────────────────────────┤
│  ┌─────────────────────────────┐    │
│  │ 🔍 搜索模板...              │    │  ← 搜索框（可选，模板多时有用）
│  └─────────────────────────────┘    │
├─────────────────────────────────────┤
│  ┌─────────────────────────────┐    │
│  │ 📝  日记                    │    │  ← 模板列表项
│  │     每日日记模板            │    │     图标 + 名称 + 描述
│  └─────────────────────────────┘    │
│  ┌─────────────────────────────┐    │
│  │ 📋  会议记录                │    │
│  │     会议纪要模板            │    │
│  └─────────────────────────────┘    │
│  ...                                │
├─────────────────────────────────────┤
│  ⚙️ 管理模板                        │  ← 底部链接，跳转设置页
└─────────────────────────────────────┘
```

**尺寸**：
- 宽度：280px（与 ExportMenu 弹窗一致）
- 最大高度：400px（超出滚动）
- 列表项高度：约 48px

**交互**：
- 点击模板项 → 插入到编辑器 → 关闭弹窗
- hover 模板项 → 背景高亮
- 键盘导航：↑↓ 选择，Enter 确认，Esc 关闭
- 点击「管理模板」→ 关闭弹窗 → 打开设置页模板 tab

**空状态**：
```
┌─────────────────────────────────────┐
│                              [×]    │
├─────────────────────────────────────┤
│                                     │
│        📄                           │
│     暂无模板                        │
│                                     │
│   [前往设置创建]                    │  ← 按钮
│                                     │
└─────────────────────────────────────┘
```

### 9.3 设置页模板管理 (TemplateSettings)

**位置**：Settings → 新增 tab「Templates / 模板」

**Tab 顺序**：
```
General | Appearance | AI Actions | Templates | Knowledge Base | Data | About
                                     ↑ 新增
```

**列表视图**：
```
┌─────────────────────────────────────────────────────────────┐
│  模板                                         [+ 新建]      │
│  自定义内容模板，快速插入常用结构                            │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐    │
│  │ ⋮⋮  📝  日记                    [日记默认] [✏️] [🗑]│    │
│  │          每日日记模板                               │    │
│  └─────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ ⋮⋮  📋  会议记录                         [✏️] [🗑] │    │
│  │          会议纪要模板                               │    │
│  └─────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ ⋮⋮  📊  周报                             [✏️] [🗑] │    │
│  │          每周工作总结                               │    │
│  └─────────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────┤
│  空状态提示                                                 │
│  "还没有模板，点击上方按钮创建第一个"                       │
└─────────────────────────────────────────────────────────────┘

图例：
⋮⋮ = 拖拽手柄
[日记默认] = 日记默认标签（仅一个模板显示）
[✏️] = 编辑按钮
[🗑] = 删除按钮
```

**列表项组件**：
- 左侧：拖拽手柄（6 点图标）
- 图标：模板图标（emoji 或默认图标）
- 名称 + 描述（两行）
- 右侧按钮组：
  - 日记默认标签（如果是日记默认）
  - 编辑按钮
  - 删除按钮

**交互**：
- 拖拽排序：参考 AIActionsSettings
- 点击编辑 → 切换到编辑视图
- 点击删除 → 直接删除（考虑是否需要确认？）
- 点击新建 → 切换到编辑视图（空白）

### 9.4 模板编辑视图 (TemplateEditor)

**布局**（在 TemplateSettings 内切换，不是弹窗）：
```
┌─────────────────────────────────────────────────────────────┐
│  [←]  编辑模板 / 新建模板                                   │
├─────────────────────────────────────────────────────────────┤
│  图标                                                       │
│  ┌────┐                                                     │
│  │ 📝 │  ← 点击弹出 emoji 选择器                           │
│  └────┘                                                     │
├─────────────────────────────────────────────────────────────┤
│  名称                                                       │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 日记                                                │    │
│  └─────────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────┤
│  描述（可选）                                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 每日日记模板                                        │    │
│  └─────────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────┤
│  内容                                              [变量帮助]│
│  ┌─────────────────────────────────────────────────────┐    │
│  │                                                     │    │
│  │  ## {{date:YYYY年MM月DD日}}                         │    │
│  │                                                     │    │
│  │  ### 今日待办                                       │    │
│  │  - [ ]                                              │    │
│  │                                                     │    │
│  │  ### 日记                                           │    │
│  │  {{cursor}}                                         │    │
│  │                                                     │    │
│  │                                                     │    │
│  └─────────────────────────────────────────────────────┘    │
│  ↑ 复用 BlockNote 编辑器，高度自适应（min 200px）          │
├─────────────────────────────────────────────────────────────┤
│  ☐ 设为日记默认模板                                        │
│    新建日记时自动应用此模板                                 │
├─────────────────────────────────────────────────────────────┤
│                                          [取消]  [保存]     │
│                                          ↑ 新建时显示       │
│                                                [完成]       │
│                                          ↑ 编辑时显示       │
└─────────────────────────────────────────────────────────────┘
```

**变量帮助气泡/弹窗**：
点击「变量帮助」显示：
```
┌─────────────────────────────────────┐
│  可用变量                           │
├─────────────────────────────────────┤
│  {{title}}      当前笔记标题        │
│  {{date}}       今天日期            │
│  {{date:FORMAT}} 自定义日期格式     │
│  {{time}}       当前时间            │
│  {{time:FORMAT}} 自定义时间格式     │
│  {{datetime}}   日期+时间           │
│  {{notebook}}   笔记本名称          │
│  {{cursor}}     光标位置            │
├─────────────────────────────────────┤
│  日期格式示例                       │
│  YYYY-MM-DD    → 2026-01-14        │
│  YYYY年MM月DD日 → 2026年01月14日    │
│  MM/DD/YYYY    → 01/14/2026        │
└─────────────────────────────────────┘
```

**内容编辑器**：
- 复用现有的 Tiptap 编辑器
- 支持所有现有 block 类型（包括 Dataview、Agent、TOC）
- 但隐藏部分功能：如 AI 菜单、导出等
- 显示变量文本时保持原样（不解析），如 `{{date}}` 直接显示

**交互**：
- 编辑现有模板：自动保存（参考 AIActionsSettings 的 blur 保存）
- 新建模板：点击保存才创建
- 点击返回箭头 / 完成 → 返回列表视图
- 日记默认开关：切换时自动保存，同时清除其他模板的日记默认状态

### 9.5 日记自动应用模板

**流程**：
```
用户点击「今日」或创建日记
        ↓
检查今日日记是否已存在
        ↓ 不存在
调用 templates:getDailyDefault
        ↓
┌───────────────────┐
│ 有默认模板？      │
└─────┬───────┬─────┘
      │是     │否
      ↓       ↓
解析变量    创建空白日记
      ↓
用模板内容创建日记
      ↓
打开日记
```

**注意**：
- 只在创建新日记时应用模板
- 已存在的日记不会被覆盖
- 模板内容在创建时解析变量，不是实时更新

### 9.6 样式规范

**配色**（使用现有 CSS 变量）：
- 背景：`var(--color-card)`
- 边框：`var(--color-border)`
- 文字：`var(--color-text)`, `var(--color-text-secondary)`, `var(--color-muted)`
- 主题色：`var(--color-accent)`
- hover：`var(--color-hover)`

**圆角**：
- 弹窗：10px
- 按钮/输入框：5-6px
- 列表项：6px

**间距**：
- 弹窗内边距：12px
- 列表项内边距：10-12px
- 元素间距：8-12px

**字号**：
- 标题：14px medium
- 正文：12-13px
- 辅助文字：11-12px
- 快捷键：10px

---

## 十、实现步骤

### Phase 1: 基础设施
1. [ ] 数据库：添加 templates 表和迁移
2. [ ] 类型：添加 Template 相关类型定义
3. [ ] API：实现数据库操作函数
4. [ ] IPC：添加 ipcMain handlers
5. [ ] Preload：暴露 templates API

### Phase 2: 核心功能
6. [ ] 变量解析：实现 templateVariables.ts
7. [ ] 模板插入：实现插入到编辑器的逻辑
8. [ ] 日记模板：修改日记创建逻辑，支持默认模板

### Phase 3: UI 组件
9. [ ] TemplateSettings：设置页模板管理
10. [ ] TemplateEditor：模板编辑器
11. [ ] TemplateSelector：模板选择弹窗
12. [ ] 顶栏菜单：添加「插入模板」入口

### Phase 4: 完善
13. [ ] 预置模板：添加默认日记模板
14. [ ] 国际化：添加相关翻译
15. [ ] 测试

---

## 十、注意事项

1. **模板内容格式**：使用 Tiptap JSON 格式，与笔记内容格式一致
2. **变量解析时机**：在插入到编辑器之前解析，不是保存时
3. **特殊 Block ID**：AgentBlock 插入时需要生成新的 blockId
4. **日记默认唯一性**：只能有一个日记默认模板
5. **编辑器复用**：模板编辑器复用现有的 BlockNote 编辑器组件
6. **拖拽排序**：使用现有的拖拽排序逻辑（参考 AIActionsSettings）
