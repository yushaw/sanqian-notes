# 新 Block 类型设计方案

> 2026-01-08

## 概述

计划新增三种 Block 类型：

| Block 类型 | 用途 | 优先级 | 状态 |
|-----------|------|--------|------|
| **Transclusion Block** | 引用/展示另一个笔记的内容 | 高 | ✅ 已实现 |
| **Embed Block** | 嵌入 iframe/本地项目预览 | 高 | ✅ 已实现 |
| **Dataview Block** | 查询笔记数据（类似 Obsidian Dataview） | 中 | ✅ 已实现 |

### 实现记录

#### 2026-01-09 Transclusion Block 实现

实现了完整的 Transclusion Block 功能：
- `TransclusionBlock.ts` - Tiptap Node 扩展
- `TransclusionView.tsx` - React 组件，支持折叠/展开、内容高度限制、错误处理
- SlashCommand `/transclusion` - 触发笔记选择弹窗
- 支持三种嵌入粒度：整个笔记、标题章节、指定 block
- 样式和中英文翻译

#### 2026-01-09 Embed Block 实现

实现了 URL 模式的 Embed Block 功能：
- `EmbedBlock.ts` - Tiptap Node 扩展，支持 url/local 两种模式
- `EmbedView.tsx` - React 组件，包含：
  - iframe 嵌入外部网页
  - 工具栏：刷新、外部打开、设置
  - 加载/错误状态处理
  - 拖拽调整高度（200-800px）
  - 设置面板调整高度
- SlashCommand `/embed` - 触发 URL 输入弹窗
- 样式和中英文翻译

注意：Local 模式（本地 HTML 预览）暂未实现，需要注册自定义协议。

#### 2026-01-09 Dataview Block 实现

实现了 MVP 版本的 Dataview Block：
- `dataviewParser.ts` - 查询解析器，支持 DQL 语法
  - LIST/TABLE 输出类型
  - FROM #tag 或 "folder"
  - WHERE field = "value" (支持 =, !=, >, <, >=, <=, contains)
  - SORT field ASC/DESC
  - LIMIT number
- `dataviewExecutor.ts` - 查询执行器
  - 内置字段：title, created, updated, tags, folder, is_daily, is_favorite, is_pinned, summary
  - 支持多条件 AND/OR 组合
  - 自动排序和分页
- `DataviewBlock.ts` - Tiptap Node 扩展
- `DataviewView.tsx` - React 组件
  - 编辑模式：代码编辑器，语法错误提示
  - 结果模式：LIST 和 TABLE 视图
  - 加载/错误/空状态处理
  - 分页（每页 10 条）
  - 点击笔记链接跳转
- SlashCommand `/dataview` - 插入查询块
- 样式和中英文翻译

---

## 业界对比分析

### Transclusion/Embed 对比

| 特性 | Obsidian | Notion Synced Block | 我们的设计 |
|------|----------|---------------------|-----------|
| **编辑模式** | 只读（需插件支持原地编辑） | 双向可编辑 | 只读 + 跳转编辑 |
| **视觉反馈** | 无明显边框 | 红色虚线边框 + "Editing in X pages" | 浅色背景 + 来源标识 |
| **Hover 预览** | Ctrl+Hover 显示预览弹窗 | 无 | 支持 Hover 预览 |
| **粒度** | 整个笔记/章节/单个 block | 任意选中的 blocks | 整个笔记/章节/单个 block |
| **同步方式** | 单向（源变化自动更新） | 双向实时同步 | 单向实时更新 |

### Dataview 对比

| 特性 | Obsidian Dataview | 我们的设计 |
|------|-------------------|-----------|
| **输出格式** | LIST, TABLE, TASK, CALENDAR | LIST, TABLE（MVP），后续扩展 |
| **查询语言** | DQL（类 SQL）+ JS | 简化版 DQL |
| **数据源** | 标签/文件夹/链接/frontmatter | 标签/文件夹（MVP），后续扩展 |
| **交互式** | TASK 可勾选 | 暂不支持 |

---

## 一、Transclusion Block（内容嵌入块）

### 1.1 功能描述

在当前笔记中嵌入展示另一个笔记的内容片段，支持：
- 嵌入整个笔记
- 嵌入指定标题章节（`#heading`）
- 嵌入指定 block（`^blockid`）
- 可设置最大高度，超出显示滚动条
- 只读展示，点击可跳转到源笔记编辑

### 1.2 语法设计

```markdown
![[笔记名称]]                    # 嵌入整个笔记
![[笔记名称#章节标题]]           # 嵌入指定章节
![[笔记名称^blockid]]           # 嵌入指定 block
```

### 1.3 数据结构

```typescript
interface TransclusionBlockAttrs {
  noteId: string           // 源笔记 ID
  noteName: string         // 源笔记名称（用于显示）
  target?: {
    type: 'heading' | 'block'
    value: string          // heading 文本或 block ID
  }
  maxHeight?: number       // 最大高度（px），默认 400
  collapsed?: boolean      // 是否折叠，默认 false
}
```

### 1.4 交互设计（详细）

#### 状态一：默认展示
```
┌─────────────────────────────────────────────────────────┐
│ ┌─ 来源标识 ─────────────────────────────── 操作区 ──┐ │
│ │ 📄 《项目计划》#第一阶段                    ▼  ↗   │ │
│ └─────────────────────────────────────────────────────┘ │
│ ┌─ 内容区（浅灰背景 bg-gray-50）─────────────────────┐ │
│ │                                                     │ │
│ │   这是嵌入的内容，保持原有格式渲染                   │ │
│ │   - 列表项 1                                        │ │
│ │   - 列表项 2                                        │ │
│ │                                                     │ │
│ │   > 引用块也正常显示                                │ │
│ │                                                     │ │
│ └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘

图标说明：
▼ = 折叠/展开
↗ = 跳转到源笔记
```

#### 状态二：折叠状态
```
┌─────────────────────────────────────────────────────────┐
│ 📄 《项目计划》#第一阶段  (3 段落)            ▶  ↗     │
└─────────────────────────────────────────────────────────┘

▶ = 点击展开
(3 段落) = 内容摘要提示
```

#### 状态三：Hover 预览（参考 Obsidian）
```
用户 Hover 在折叠的 transclusion 上 300ms 后：

┌─────────────────────────────────────────────────────────┐
│ 📄 《项目计划》#第一阶段  (3 段落)            ▶  ↗     │
└──────────────────────────┬──────────────────────────────┘
                           │
                    ┌──────▼──────────────────────────┐
                    │  预览弹窗（半透明背景）          │
                    │                                 │
                    │  这是嵌入的内容预览...          │
                    │  - 列表项 1                     │
                    │  - 列表项 2                     │
                    │                                 │
                    │  ─────────────────────────────  │
                    │  点击展开 · Cmd+Click 跳转      │
                    └─────────────────────────────────┘
```

#### 状态四：内容超高时
```
┌─────────────────────────────────────────────────────────┐
│ 📄 《项目计划》                               ▼  ↗     │
├─────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────┐ ▲  │
│ │                                                 │ █  │
│ │   大量内容...                                   │ █  │
│ │                                                 │ █  │
│ │                                                 │ ░  │
│ │                                                 │ ░  │
│ └─────────────────────────────────────────────────┘ ▼  │
│ ─────────────── 显示更多 (还有 1200 字) ───────────────  │
└─────────────────────────────────────────────────────────┘

maxHeight 默认 300px，超出显示滚动条
底部渐变遮罩 + "显示更多" 提示
```

#### 状态五：源笔记不存在/已删除
```
┌─────────────────────────────────────────────────────────┐
│ ⚠️ 《已删除的笔记》                           🔄  ✕    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   ┌───────────────────────────────────────────────┐    │
│   │  ⚠️ 源笔记不存在或已被删除                     │    │
│   │                                               │    │
│   │  [搜索相似笔记]  [移除此嵌入]                  │    │
│   └───────────────────────────────────────────────┘    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 1.5 交互行为

| 操作 | 行为 |
|------|------|
| **单击内容区** | 选中整个 block（不进入编辑） |
| **双击内容区** | 跳转到源笔记对应位置 |
| **Cmd/Ctrl + Click** | 在新 Tab 打开源笔记 |
| **Hover 300ms** | 显示预览弹窗（折叠状态下） |
| **点击折叠按钮** | 切换折叠/展开 |
| **拖拽** | 整体移动 block 位置 |
| **右键菜单** | 复制链接、取消嵌入、跳转到源 |

### 1.6 实现要点

- **复用现有能力**：已有 Block ID 系统和 NoteLink 组件
- **内容提取**：需要新增 markdown 章节提取工具函数
- **实时更新**：监听 `note:updated` 事件刷新内容
- **循环引用检测**：防止 A 嵌入 B，B 又嵌入 A
- **性能优化**：折叠状态下不渲染完整内容，懒加载

---

## 二、Embed Block（嵌入块）

### 2.1 功能描述

统一的嵌入块，支持多种模式：

| 模式 | 用途 | 来源 |
|------|------|------|
| `url` | 嵌入外部网页 | 任意 URL |
| `local` | 预览本地 HTML/项目 | 文件路径或目录 |
| `widget` | 第三方数据小部件 | API 配置（未来扩展） |

### 2.2 数据结构

```typescript
type EmbedMode = 'url' | 'local' | 'widget'

interface EmbedBlockAttrs {
  mode: EmbedMode

  // URL 模式
  url?: string

  // Local 模式
  localPath?: string       // 文件或目录路径
  devServer?: {            // 如果是需要构建的项目
    command: string        // 如 "npm run dev"
    port: number           // 如 3000
    ready?: boolean        // dev server 是否就绪
  }

  // 通用属性
  width?: string           // 如 "100%", "600px"
  height?: number          // 高度（px），默认 400
  sandbox?: string[]       // iframe sandbox 权限
  title?: string           // 显示标题
}
```

### 2.3 交互设计（详细）

#### 状态一：URL 模式 - 正常加载
```
┌─────────────────────────────────────────────────────────────┐
│ ┌─ 工具栏 ────────────────────────────────────────────────┐ │
│ │ 🌐 https://example.com/page      🔄  ↗  ⚙️  ···        │ │
│ └─────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │                                                         │ │
│ │                                                         │ │
│ │              iframe 内容区域                            │ │
│ │                                                         │ │
│ │                                                         │ │
│ └─────────────────────────────────────────────────────────┘ │
│ ═══════════════════════════════════════════════════════════ │ ← 拖拽手柄
└─────────────────────────────────────────────────────────────┘

图标说明：
🔄 = 刷新
↗  = 在新窗口打开
⚙️ = 设置（调整高度、sandbox 权限等）
··· = 更多操作（复制链接、删除等）
```

#### 状态二：Local 模式 - 静态文件
```
┌─────────────────────────────────────────────────────────────┐
│ ┌─ 工具栏 ────────────────────────────────────────────────┐ │
│ │ 📁 /projects/demo/index.html      🔄  📂  ↗  ···       │ │
│ └─────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │                                                         │ │
│ │              本地 HTML 预览                              │ │
│ │                                                         │ │
│ └─────────────────────────────────────────────────────────┘ │
│ ═══════════════════════════════════════════════════════════ │
└─────────────────────────────────────────────────────────────┘

📂 = 在 Finder/Explorer 中打开
```

#### 状态三：Local 模式 - Dev Server 运行中
```
┌─────────────────────────────────────────────────────────────┐
│ ┌─ 工具栏 ────────────────────────────────────────────────┐ │
│ │ 🚀 localhost:3000  ●运行中      🔄  ⏹  📂  ↗  ···     │ │
│ └─────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │                                                         │ │
│ │              Dev Server 预览                            │ │
│ │              (支持 HMR 热更新)                          │ │
│ │                                                         │ │
│ └─────────────────────────────────────────────────────────┘ │
│ ═══════════════════════════════════════════════════════════ │
└─────────────────────────────────────────────────────────────┘

●运行中 = 绿色状态点
⏹ = 停止 server
```

#### 状态四：加载中
```
┌─────────────────────────────────────────────────────────────┐
│ 🌐 https://example.com/page                    🔄  ↗  ···  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                     ◐ 加载中...                             │
│                                                             │
│         [取消加载]                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### 状态五：加载失败
```
┌─────────────────────────────────────────────────────────────┐
│ 🌐 https://example.com/blocked                 🔄  ↗  ···  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│      ┌─────────────────────────────────────────────┐       │
│      │  ❌ 无法加载此页面                           │       │
│      │                                             │       │
│      │  该网站可能禁止了 iframe 嵌入               │       │
│      │                                             │       │
│      │  [重试]  [在浏览器中打开]  [删除]            │       │
│      └─────────────────────────────────────────────┘       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### 拖拽调整高度交互（参考 Notion）
```
Hover 在底部边缘时：

┌─────────────────────────────────────────────────────────────┐
│ ...                                                         │
│ ═══════════════════════════════════════════════════════════ │ ← 显示蓝色高亮
└─────────────────────────────────────────────────────────────┘
                            ↕
                       cursor: ns-resize

拖拽过程中显示高度数值：
┌─────────────────────────────────────────────────────────────┐
│ ...                                                         │
│ ════════════════════ 450px ════════════════════════════════ │
└─────────────────────────────────────────────────────────────┘
```

### 2.4 交互行为

| 操作 | 行为 |
|------|------|
| **拖拽底边** | 调整高度（最小 200px，最大 800px） |
| **双击底边** | 重置为默认高度 400px |
| **Hover 工具栏** | 显示完整 URL/路径 tooltip |
| **点击刷新** | 重新加载 iframe |
| **点击新窗口** | 用系统浏览器打开 |
| **右键菜单** | 复制链接、编辑设置、删除 |

### 2.5 安全策略（参考 sanqian 实现）

**iframe sandbox 配置：**
```typescript
const DEFAULT_SANDBOX = [
  'allow-scripts',         // 执行 JS
  'allow-same-origin',     // 访问同源资源
]

// 禁止的权限（安全考虑）：
// - allow-top-navigation   # 防止跳转
// - allow-forms            # 防止表单提交
// - allow-popups           # 防止弹窗
```

**本地文件协议（参考 sanqian）：**
```typescript
// 注册自定义协议处理本地文件
protocol.registerSchemesAsPrivileged([{
  scheme: 'sanqian-notes-local',
  privileges: {
    secure: true,
    supportFetchAPI: true,
    bypassCSP: true,
    corsEnabled: true,
  }
}])
```

### 2.6 Local 模式实现

**静态 HTML 文件：**
```
1. 用户选择 HTML 文件路径
2. 使用自定义协议加载：sanqian-notes-local://{path}
3. 协议处理器读取文件并返回
4. 支持相对路径资源加载（CSS/JS/图片）
```

**需要构建的项目：**
```
1. 用户选择项目目录
2. 检测项目类型（package.json）
3. 自动运行 dev server（如 npm run dev）
4. 等待 server 就绪后嵌入 localhost:{port}
5. Block 删除或笔记关闭时停止 server
```

### 2.7 与 Agent Block 联动

```typescript
// Agent 完成代码生成后，自动插入预览 block
editor.chain()
  .insertContent({
    type: 'embedBlock',
    attrs: {
      mode: 'local',
      localPath: '/path/to/generated/index.html',
      title: 'Agent 生成的项目预览',
    }
  })
  .run()
```

---

## 三、Dataview Block（数据查询块）

### 3.1 功能描述

使用类 SQL 语法查询笔记数据，支持：
- 根据标签、文件夹、链接关系筛选笔记
- 根据 frontmatter 字段过滤和排序
- 输出为列表或表格

### 3.2 语法设计（参考 Obsidian Dataview，简化版）

````markdown
```dataview
LIST                                   # 输出类型：LIST 或 TABLE
FROM #tag                              # 数据源：标签、文件夹、链接
WHERE status = "done"                  # 过滤条件
SORT created DESC                      # 排序
LIMIT 10                               # 限制数量
```
````

**完整语法示例：**

```sql
-- 列出所有带 #project 标签的笔记
LIST FROM #project

-- 表格显示，包含自定义字段
TABLE status, priority, due
FROM #task
WHERE status != "done"
SORT priority DESC, due ASC

-- 按文件夹筛选
LIST FROM "日记/2024"

-- 按链接关系筛选（链接到某笔记的所有笔记）
LIST FROM [[某笔记]]

-- 组合条件
TABLE rating, summary
FROM #book
WHERE rating >= 4 AND year = 2024
SORT rating DESC
LIMIT 20
```

### 3.3 数据结构

```typescript
interface DataviewBlockAttrs {
  query: string              // 原始查询语句

  // 解析后的结构化查询（缓存，避免重复解析）
  parsedQuery?: {
    type: 'LIST' | 'TABLE'
    fields?: string[]        // TABLE 模式的字段列表
    from?: {
      type: 'tag' | 'folder' | 'link'
      value: string
    }
    where?: WhereClause[]
    sort?: SortClause[]
    limit?: number
  }

  // 渲染配置
  showHeader?: boolean       // 是否显示表头
  refreshInterval?: number   // 自动刷新间隔（ms），0 为不刷新
}

interface WhereClause {
  field: string
  operator: '=' | '!=' | '>' | '<' | '>=' | '<=' | 'contains'
  value: string | number | boolean
  logic?: 'AND' | 'OR'       // 与下一个条件的关系
}

interface SortClause {
  field: string
  direction: 'ASC' | 'DESC'
}
```

### 3.4 交互设计（详细）

#### 状态一：编辑模式（代码块）
```
┌─────────────────────────────────────────────────────────────┐
│ ┌─ 工具栏 ────────────────────────────────────────────────┐ │
│ │ 📊 Dataview                           ▶运行  ···        │ │
│ └─────────────────────────────────────────────────────────┘ │
│ ┌─ 代码编辑区（等宽字体，语法高亮）───────────────────────┐ │
│ │ TABLE status, priority                                  │ │
│ │ FROM #task                                              │ │
│ │ WHERE status != "done"                                  │ │
│ │ SORT priority DESC                                      │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘

语法高亮：
- 关键字（TABLE/LIST/FROM/WHERE/SORT）: 蓝色
- 标签（#task）: 紫色
- 字符串（"done"）: 绿色
- 操作符（!=）: 橙色
```

#### 状态二：结果模式 - LIST
```
┌─────────────────────────────────────────────────────────────┐
│ ┌─ 工具栏 ────────────────────────────────────────────────┐ │
│ │ 📊 LIST FROM #project (5)             🔄  ✏️  ···       │ │
│ └─────────────────────────────────────────────────────────┘ │
│ ┌─ 结果区 ────────────────────────────────────────────────┐ │
│ │  • [[项目计划 2024]]                                    │ │
│ │  • [[网站重构]]                                         │ │
│ │  • [[移动端 App]]                                       │ │
│ │  • [[数据分析平台]]                                     │ │
│ │  • [[自动化测试框架]]                                   │ │
│ │                                                         │ │
│ │  ─────────────────────────────────────────────────────  │ │
│ │  共 5 条结果 · 最后更新 10:30                           │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘

图标说明：
🔄 = 刷新查询
✏️ = 编辑查询
(5) = 结果数量
```

#### 状态三：结果模式 - TABLE
```
┌─────────────────────────────────────────────────────────────┐
│ ┌─ 工具栏 ────────────────────────────────────────────────┐ │
│ │ 📊 TABLE FROM #task (12)              🔄  ✏️  ···       │ │
│ └─────────────────────────────────────────────────────────┘ │
│ ┌─ 表格区 ────────────────────────────────────────────────┐ │
│ │ ┌──────────────┬──────────┬──────────┬─────────┐        │ │
│ │ │ 标题 ▼       │ status   │ priority │ due     │        │ │
│ │ ├──────────────┼──────────┼──────────┼─────────┤        │ │
│ │ │ [[任务 A]]   │ 🔴 todo  │ ⬆️ 高    │ 01-15   │        │ │
│ │ │ [[任务 B]]   │ 🟡 doing │ ➡️ 中    │ 01-20   │        │ │
│ │ │ [[任务 C]]   │ 🟢 done  │ ⬇️ 低    │ 01-10   │        │ │
│ │ │ [[任务 D]]   │ 🔴 todo  │ ⬆️ 高    │ 01-25   │        │ │
│ │ └──────────────┴──────────┴──────────┴─────────┘        │ │
│ │                                                         │ │
│ │  显示 1-4 / 共 12 条    [<] 1 2 3 [>]                   │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘

表格交互：
- 点击表头可排序（▼ 表示当前排序列）
- Hover 行高亮
- 点击笔记链接跳转
- 支持分页（大量数据时）
```

#### 状态四：查询错误
```
┌─────────────────────────────────────────────────────────────┐
│ 📊 Dataview                                  ✏️  ···       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────────────────────────────────────────────┐      │
│   │  ❌ 查询语法错误                                 │      │
│   │                                                 │      │
│   │  第 3 行: 未知操作符 "==="                      │      │
│   │  WHERE status === "done"                       │      │
│   │              ^^^                               │      │
│   │                                                 │      │
│   │  [编辑查询]                                     │      │
│   └─────────────────────────────────────────────────┘      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### 状态五：无结果
```
┌─────────────────────────────────────────────────────────────┐
│ 📊 LIST FROM #nonexistent                   🔄  ✏️  ···    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                    📭 没有匹配的笔记                         │
│                                                             │
│            检查标签或条件是否正确                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### 状态六：加载中
```
┌─────────────────────────────────────────────────────────────┐
│ 📊 TABLE FROM #task                         🔄  ✏️  ···    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                    ◐ 查询中...                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.5 交互行为

| 操作 | 行为 |
|------|------|
| **点击笔记链接** | 跳转到该笔记 |
| **Cmd/Ctrl + Click** | 在新 Tab 打开笔记 |
| **点击表头** | 按该列排序（切换升/降序） |
| **Hover 表格行** | 高亮整行 |
| **点击刷新** | 重新执行查询 |
| **点击编辑** | 切换到代码编辑模式 |
| **双击结果区** | 进入编辑模式 |
| **Blur 编辑区** | 自动执行查询并显示结果 |

### 3.6 值的可视化渲染

为提升可读性，特定字段值可以渲染为可视化元素：

| 字段类型 | 原始值 | 渲染效果 |
|---------|--------|---------|
| 状态 | `"todo"` | 🔴 todo |
| 状态 | `"doing"` | 🟡 doing |
| 状态 | `"done"` | 🟢 done |
| 优先级 | `1` 或 `"high"` | ⬆️ 高 |
| 优先级 | `2` 或 `"medium"` | ➡️ 中 |
| 优先级 | `3` 或 `"low"` | ⬇️ 低 |
| 日期 | `"2024-01-15"` | 01-15（相对格式） |
| 评分 | `4.5` | ⭐⭐⭐⭐☆ |
| 布尔 | `true` | ✓ |
| 布尔 | `false` | ✗ |

### 3.7 支持的数据字段

**内置字段：**
| 字段 | 说明 |
|------|------|
| `title` | 笔记标题 |
| `created` | 创建时间 |
| `updated` | 更新时间 |
| `tags` | 标签列表 |
| `folder` | 所在文件夹 |
| `wordCount` | 字数 |
| `linkCount` | 链接数量 |

**Frontmatter 字段：**
笔记 frontmatter 中的任意字段，如：
```yaml
---
status: "in-progress"
priority: 1
due: 2024-12-31
rating: 4.5
---
```

### 3.8 查询解析器

```typescript
// src/renderer/src/utils/dataviewParser.ts

interface ParseResult {
  success: boolean
  query?: ParsedQuery
  error?: {
    message: string
    line?: number
    column?: number
  }
}

function parseDataviewQuery(queryString: string): ParseResult {
  // 1. 词法分析：拆分为 tokens
  // 2. 语法分析：构建 AST
  // 3. 语义验证：检查字段是否存在等
  // 4. 返回结构化查询对象
}

// 示例：
parseDataviewQuery(`
  TABLE status, priority
  FROM #task
  WHERE status != "done"
  SORT priority DESC
`)
// 返回：
{
  success: true,
  query: {
    type: 'TABLE',
    fields: ['status', 'priority'],
    from: { type: 'tag', value: 'task' },
    where: [{ field: 'status', operator: '!=', value: 'done' }],
    sort: [{ field: 'priority', direction: 'DESC' }]
  }
}
```

### 3.9 查询执行器

```typescript
// src/renderer/src/utils/dataviewExecutor.ts

interface QueryResult {
  columns: string[]          // 列名
  rows: Record<string, any>[] // 数据行
  total: number              // 总数（limit 前）
  error?: string
}

async function executeDataviewQuery(
  query: ParsedQuery,
  noteService: NoteService
): Promise<QueryResult> {
  // 1. 根据 FROM 获取候选笔记列表
  // 2. 应用 WHERE 过滤
  // 3. 应用 SORT 排序
  // 4. 应用 LIMIT 限制
  // 5. 提取需要的字段
  // 6. 返回结果
}
```

### 3.10 实现阶段

**Phase 1（MVP）：**
- 支持 LIST 和 TABLE
- FROM: 标签、文件夹
- 内置字段：title, created, updated, tags
- 基本 WHERE: =, !=
- SORT 和 LIMIT

**Phase 2：**
- FROM: 链接关系
- Frontmatter 字段支持
- 更多 WHERE 操作符: >, <, contains
- AND/OR 组合条件

**Phase 3（可选）：**
- 聚合函数: COUNT, SUM, AVG
- GROUP BY
- 可视化配置面板

---

## 四、实现计划

### 文件结构

```
src/renderer/src/components/extensions/
├── TransclusionBlock.ts        # Transclusion 扩展定义
├── EmbedBlock.ts               # Embed 扩展定义
├── DataviewBlock.ts            # Dataview 扩展定义

src/renderer/src/components/
├── TransclusionView.tsx        # Transclusion React 组件
├── EmbedView.tsx               # Embed React 组件
├── DataviewView.tsx            # Dataview React 组件

src/renderer/src/utils/
├── transclusion.ts             # 内容提取工具函数
├── dataviewParser.ts           # Dataview 查询解析器
├── dataviewExecutor.ts         # Dataview 查询执行器

src/main/
├── local-preview-protocol.ts   # 本地文件预览协议（参考 sanqian）
```

### 开发顺序

1. **Transclusion Block** - 复用现有 Block ID 和笔记系统
2. **Embed Block (URL 模式)** - 简单 iframe 包装
3. **Embed Block (Local 模式)** - 参考 sanqian 协议实现
4. **Dataview Block (Phase 1)** - 基础查询功能

### 技术依赖

- **Transclusion**: 现有 NoteLink、BlockId 扩展
- **Embed**: Electron protocol API，参考 sanqian `sanqian-workspace://` 实现
- **Dataview**: 需要新增查询解析器，可考虑使用 nearley 或手写 parser

---

## 五、sanqian 参考实现

### 自定义协议

sanqian 注册了两个自定义协议：

```typescript
// src/main/index.ts
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'sanqian-cdn',           // 本地 CDN 资源
    privileges: { secure: true, supportFetchAPI: true, bypassCSP: true, standard: true }
  },
  {
    scheme: 'sanqian-workspace',     // 工作区文件访问
    privileges: { secure: true, supportFetchAPI: true, bypassCSP: true, corsEnabled: true }
  }
])
```

### 协议处理器关键逻辑

```typescript
protocol.handle('sanqian-workspace', (request) => {
  // URL 格式: sanqian-workspace://{conversation_id}/{path}

  // 1. 解析 conversation_id 和文件路径
  // 2. 修复 Chromium issue #49073（相对路径解析 bug）
  // 3. 路径遍历防护（禁止 '..'）
  // 4. 验证解析后的路径在工作区内
  // 5. 读取文件并返回 Response
})
```

### HtmlRenderer 组件

```typescript
// 两种模式：
// 1. 协议模式：src="sanqian-workspace://{id}/{path}"
// 2. 内容模式：srcDoc={html}

<iframe
  src={protocolUrl}
  srcDoc={!useProtocol ? html : undefined}
  sandbox="allow-scripts allow-same-origin"
/>
```

### 安全策略

- **DOMPurify**: SVG 净化
- **rehype-sanitize**: Markdown HTML 净化
- **mermaid securityLevel: 'strict'**: 图表安全
- **iframe sandbox**: 限制脚本能力

---

## 六、创建入口设计

### 6.1 Slash Command

在 SlashCommand.ts 中添加新命令：

```typescript
// Transclusion
{
  id: 'transclusion',
  icon: '📄',
  title: '嵌入笔记',
  description: '嵌入另一个笔记的内容',
  keywords: ['transclusion', 'embed', 'note', '嵌入', '引用'],
  command: (editor) => {
    // 打开笔记选择弹窗
    openNotePicker((note, target) => {
      editor.chain().focus().insertTransclusion({ noteId: note.id, noteName: note.title, target }).run()
    })
  }
}

// Embed (URL)
{
  id: 'embed-url',
  icon: '🌐',
  title: '嵌入网页',
  description: '嵌入外部网页 (iframe)',
  keywords: ['embed', 'iframe', 'web', 'url', '网页'],
  command: (editor) => {
    // 弹出 URL 输入框
    promptUrl((url) => {
      editor.chain().focus().insertEmbed({ mode: 'url', url }).run()
    })
  }
}

// Embed (Local)
{
  id: 'embed-local',
  icon: '📁',
  title: '嵌入本地文件',
  description: '预览本地 HTML 或项目',
  keywords: ['embed', 'local', 'html', 'preview', '本地', '预览'],
  command: (editor) => {
    // 打开文件选择器
    selectLocalFile((path) => {
      editor.chain().focus().insertEmbed({ mode: 'local', localPath: path }).run()
    })
  }
}

// Dataview
{
  id: 'dataview',
  icon: '📊',
  title: 'Dataview 查询',
  description: '查询和展示笔记数据',
  keywords: ['dataview', 'query', 'table', 'list', '查询', '表格'],
  command: (editor) => {
    editor.chain().focus().insertDataview({ query: 'LIST FROM #' }).run()
  }
}
```

### 6.2 Markdown 语法自动转换

**Transclusion - InputRule:**
```typescript
// 匹配 ![[笔记名]] 或 ![[笔记名#章节]] 或 ![[笔记名^blockid]]
const transclusionInputRule = /!\[\[([^\]]+)\]\]$/

// 解析语法
function parseTransclusionSyntax(match: string) {
  // ![[笔记名]] -> { noteName: '笔记名' }
  // ![[笔记名#章节]] -> { noteName: '笔记名', target: { type: 'heading', value: '章节' } }
  // ![[笔记名^abc123]] -> { noteName: '笔记名', target: { type: 'block', value: 'abc123' } }
}
```

**Dataview - 代码块识别:**
```typescript
// 识别 ```dataview 代码块并转换为 Dataview Block
// 在 CodeBlock 扩展中添加判断逻辑
if (language === 'dataview') {
  return DataviewBlock.create({ query: content })
}
```

### 6.3 右键菜单

**选中链接时：**
```
┌────────────────────────────┐
│ 打开笔记                    │
│ 在新标签页打开              │
│ ─────────────────────────  │
│ 转换为嵌入 (Transclusion)   │  ← 新增
│ ─────────────────────────  │
│ 复制链接                    │
└────────────────────────────┘
```

**选中 Transclusion Block 时：**
```
┌────────────────────────────┐
│ 跳转到源笔记                │
│ 在新标签页打开              │
│ ─────────────────────────  │
│ 折叠 / 展开                 │
│ 设置最大高度...             │
│ ─────────────────────────  │
│ 转换为链接                  │
│ 删除                        │
└────────────────────────────┘
```

**选中 Embed Block 时：**
```
┌────────────────────────────┐
│ 刷新                        │
│ 在浏览器中打开              │
│ ─────────────────────────  │
│ 编辑 URL / 路径             │
│ 调整大小...                 │
│ ─────────────────────────  │
│ 复制链接                    │
│ 删除                        │
└────────────────────────────┘
```

### 6.4 笔记选择弹窗（Transclusion 专用）

```
┌─────────────────────────────────────────────────────────────┐
│ 选择要嵌入的笔记                                      ✕     │
├─────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 🔍 搜索笔记...                                          │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ 最近笔记                                                    │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 📄 项目计划 2024                           2 小时前     │ │
│ │ 📄 会议记录 - 产品评审                     昨天         │ │
│ │ 📄 技术方案设计                            3 天前       │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ 选择嵌入范围                                                │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ ○ 整个笔记                                              │ │
│ │ ○ 指定章节:  [选择章节 ▼]                               │ │
│ │ ○ 指定块:    [选择块 ▼]                                 │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│                               [取消]  [确定]                │
└─────────────────────────────────────────────────────────────┘
```

---

## 七、Sources

- [Obsidian Transclusion Forum](https://forum.obsidian.md/t/transclusion-in-obsidian/69551)
- [Obsidian Dataview Documentation](https://blacksmithgu.github.io/obsidian-dataview/)
- [Notion Synced Blocks Help](https://www.notion.com/help/synced-blocks)
- [Notion Designing Synced Blocks](https://www.notion.com/blog/designing-synced-blocks)
- [Notion Embeds Help](https://www.notion.com/help/embed-and-connect-other-apps)
- [make.MD Flow Editor](https://medium.com/workings/true-transclusion-in-obsidian-6d2e05235bd)
- [Obsidian Hover Editor Plugin](https://github.com/nothingislost/obsidian-hover-editor)
