# 导入导出模块设计文档

## 一、概述

实现笔记的导入导出功能，支持从 Obsidian、Notion、Bear 等主流笔记软件迁移数据，以及导出备份。

### 设计原则

1. **策略模式** - 每种格式独立实现，便于扩展
2. **两遍扫描** - 先解析所有文件，再处理内部链接
3. **用户可控** - 文件夹映射、冲突处理等策略由用户选择
4. **复用现有** - 基于现有 `markdown ↔ tiptap` 转换模块

### 核心挑战

| 问题 | 说明 | 解决方案 |
|------|------|----------|
| 文件夹层级 | 外部多级嵌套 vs 本项目单级笔记本 | 提供多种映射策略 |
| 内部链接 | `[[note]]` 需要匹配已导入笔记 | 两遍扫描 + 标题映射 |
| 附件路径 | 相对/绝对路径不一致 | 统一复制到 userData |
| 标签格式 | 嵌套标签 `#a/b/c` vs 扁平标签 | 可选拆分或保留 |

---

## 二、数据模型对比

### 本项目数据结构

```typescript
// 笔记（扁平结构，通过 notebook_id 关联）
Note {
  id: string
  title: string
  content: string          // TipTap JSON
  notebook_id: string | null
  tags: TagWithSource[]
  is_daily, is_favorite, is_pinned
  created_at, updated_at
}

// 笔记本（单层，无嵌套）
Notebook {
  id: string
  name: string
  icon: string
  order_index: number
}
```

### 外部格式对比

| 来源 | 结构特点 | 内容格式 | 链接语法 |
|------|----------|----------|----------|
| **Obsidian** | 文件夹嵌套 | Markdown | `[[note]]` `[[note#heading]]` |
| **Notion** | 页面嵌套 + 数据库 | MD + CSV (ZIP) | Notion 内部链接 |
| **Bear** | 标签分类 `#tag/subtag` | Markdown | `[[note]]` |
| **Markdown 文件夹** | 任意结构 | Markdown | 标准 MD 链接 |

---

## 三、映射策略

### 3.1 文件夹 → 笔记本

导入源示例：
```
├── Work/
│   ├── Projects/
│   │   ├── project-a.md
│   │   └── project-b.md
│   └── meeting-notes.md
├── Personal/
│   └── diary.md
└── inbox.md              # 根级文件
```

**策略选项：**

| 策略 | 说明 | 上例结果 |
|------|------|----------|
| `first-level` | 只取第一级文件夹 | Work, Personal 两个笔记本 |
| `flatten-path` | 完整路径作为笔记本名 | "Work", "Work/Projects", "Personal" |
| `single-notebook` | 全部放入指定笔记本 | 用户选择的笔记本 |

**根级文件处理：** 放入"未分类"或用户指定的默认笔记本

### 3.2 标签处理

输入：`#work/project/urgent`

| 策略 | 结果 |
|------|------|
| `keep-nested` | 单个标签 "work/project/urgent" |
| `flatten-all` | 三个标签 ["work", "project", "urgent"] |
| `first-level` | 单个标签 "work" |

### 3.3 冲突处理

同名笔记/笔记本处理：

| 策略 | 说明 |
|------|------|
| `skip` | 跳过，保留原有 |
| `rename` | 自动重命名（添加序号） |
| `overwrite` | 覆盖原有 |

### 3.4 链接转换

```
Wiki 链接：
[[Other Note]]           → 匹配导入的笔记标题，转为内部格式
[[Note#Heading]]         → 保留锚点
[[Note#^block-id]]       → 保留块引用

附件嵌入：
![[image.png]]           → 复制附件到 userData，更新路径
![](./images/pic.png)    → 同上
```

---

## 四、文件结构

```
src/main/import-export/
├── index.ts                      # 统一入口 + IPC handlers
├── types.ts                      # 类型定义
├── base-importer.ts              # 导入器基类
├── base-exporter.ts              # 导出器基类
├── utils/
│   ├── folder-mapper.ts          # 文件夹→笔记本映射
│   ├── link-resolver.ts          # 内部链接解析
│   ├── attachment-copier.ts      # 附件复制
│   ├── front-matter.ts           # YAML front matter 解析
│   └── conflict-handler.ts       # 冲突处理
├── importers/
│   ├── markdown-importer.ts      # Markdown 文件/文件夹
│   ├── obsidian-importer.ts      # Obsidian vault
│   ├── notion-importer.ts        # Notion ZIP
│   └── bear-importer.ts          # Bear textbundle
└── exporters/
    ├── markdown-exporter.ts      # 导出为 Markdown
    └── json-exporter.ts          # 导出为 JSON（完整备份）
```

---

## 五、类型定义

```typescript
// ============ types.ts ============

// ---------- 导入配置 ----------

export interface ImportOptions {
  /** 来源路径（文件/文件夹/ZIP） */
  sourcePath: string

  /** 文件夹→笔记本映射策略 */
  folderStrategy: 'first-level' | 'flatten-path' | 'single-notebook'

  /** single-notebook 策略时的目标笔记本 */
  targetNotebookId?: string

  /** 根级文件的默认笔记本（null = 不分配） */
  defaultNotebookId?: string | null

  /** 标签处理策略 */
  tagStrategy: 'keep-nested' | 'flatten-all' | 'first-level'

  /** 同名冲突处理 */
  conflictStrategy: 'skip' | 'rename' | 'overwrite'

  /** 是否导入附件 */
  importAttachments: boolean

  /** 是否解析 YAML front matter */
  parseFrontMatter: boolean
}

// ---------- 导入中间格式 ----------

/** 单个待导入笔记（解析后、入库前） */
export interface ParsedNote {
  /** 原始文件路径 */
  sourcePath: string
  /** 笔记标题 */
  title: string
  /** TipTap JSON 内容 */
  content: string
  /** 笔记本名称（待解析为 ID） */
  notebookName?: string
  /** 标签列表 */
  tags: string[]
  /** 创建时间（从文件或 front matter） */
  createdAt?: Date
  /** 更新时间 */
  updatedAt?: Date
  /** 待处理的附件 */
  attachments: PendingAttachment[]
  /** 待解析的内部链接 */
  links: PendingLink[]
  /** Front matter 原始数据 */
  frontMatter?: Record<string, unknown>
}

/** 待复制的附件 */
export interface PendingAttachment {
  /** Markdown 中的原始引用文本 */
  originalRef: string
  /** 源文件绝对路径 */
  sourcePath: string
  /** 新的相对路径（处理后填充） */
  newRelativePath?: string
}

/** 待解析的内部链接 */
export interface PendingLink {
  /** 原始文本 [[xxx]] 或 [[xxx#yyy]] */
  original: string
  /** 目标笔记标题 */
  targetTitle: string
  /** 锚点（#heading） */
  anchor?: string
  /** 块 ID（#^blockId） */
  blockId?: string
}

// ---------- 导入结果 ----------

export interface ImportResult {
  success: boolean
  /** 成功导入的笔记 */
  importedNotes: Array<{ id: string; title: string; sourcePath: string }>
  /** 跳过的文件 */
  skippedFiles: Array<{ path: string; reason: string }>
  /** 错误列表 */
  errors: Array<{ path: string; error: string }>
  /** 新创建的笔记本 */
  createdNotebooks: Array<{ id: string; name: string }>
  /** 统计信息 */
  stats: {
    totalFiles: number
    importedNotes: number
    importedAttachments: number
    skippedFiles: number
    errorCount: number
    duration: number  // ms
  }
}

// ---------- 导出配置 ----------

export interface ExportOptions {
  /** 要导出的笔记 ID（空数组 = 全部） */
  noteIds: string[]
  /** 要导出的笔记本 ID（空数组 = 不按笔记本筛选） */
  notebookIds: string[]
  /** 导出格式 */
  format: 'markdown' | 'json'
  /** 输出目录路径 */
  outputPath: string
  /** 是否按笔记本创建子文件夹 */
  groupByNotebook: boolean
  /** 是否包含附件 */
  includeAttachments: boolean
  /** 是否生成 YAML front matter */
  includeFrontMatter: boolean
  /** 是否打包为 ZIP */
  asZip: boolean
}

export interface ExportResult {
  success: boolean
  /** 输出路径（ZIP 时为 .zip 文件路径） */
  outputPath: string
  stats: {
    exportedNotes: number
    exportedAttachments: number
    totalSize: number  // bytes
  }
  errors: Array<{ noteId: string; error: string }>
}

// ---------- 导入器注册 ----------

export interface ImporterInfo {
  /** 唯一标识 */
  id: string
  /** 显示名称 */
  name: string
  /** 描述 */
  description: string
  /** 支持的文件扩展名 */
  extensions: string[]
  /** 是否支持文件夹 */
  supportsFolder: boolean
  /** 文件选择对话框过滤器 */
  fileFilters: Array<{ name: string; extensions: string[] }>
}
```

---

## 六、基类设计

### 6.1 BaseImporter

```typescript
// base-importer.ts

import { markdownToTiptapString } from '../markdown'
import type { ImportOptions, ImportResult, ParsedNote, ImporterInfo } from './types'

export abstract class BaseImporter {
  /** 导入器元信息 */
  abstract readonly info: ImporterInfo

  /** 检测是否可处理此路径 */
  abstract canHandle(sourcePath: string): Promise<boolean>

  /** 执行导入（由子类实现核心解析逻辑） */
  abstract parse(options: ImportOptions): Promise<ParsedNote[]>

  /**
   * 完整导入流程（模板方法）
   * 1. 解析文件 → ParsedNote[]
   * 2. 创建笔记本
   * 3. 解析内部链接
   * 4. 复制附件
   * 5. 批量创建笔记
   */
  async import(options: ImportOptions): Promise<ImportResult> {
    // 由 index.ts 统一实现，调用 parse() 后处理
  }

  // ========== 工具方法（子类复用）==========

  /** Markdown → TipTap JSON */
  protected markdownToContent(markdown: string): string {
    return markdownToTiptapString(markdown)
  }

  /** 从文件名或内容提取标题 */
  protected extractTitle(filePath: string, content: string, frontMatter?: Record<string, unknown>): string {
    // 1. front matter 的 title
    // 2. 第一个 # 标题
    // 3. 文件名（去扩展名）
  }

  /** 根据策略解析笔记本名称 */
  protected resolveNotebookName(
    filePath: string,
    rootPath: string,
    strategy: ImportOptions['folderStrategy']
  ): string | undefined {
    // 实现见下文
  }

  /** 收集 Markdown 中的附件引用 */
  protected collectAttachments(content: string, basePath: string): PendingAttachment[]

  /** 收集 Wiki 风格内部链接 */
  protected collectWikiLinks(content: string): PendingLink[]
}
```

### 6.2 BaseExporter

```typescript
// base-exporter.ts

import { jsonToMarkdown } from '../markdown'
import type { ExportOptions, ExportResult } from './types'

export abstract class BaseExporter {
  abstract readonly id: string
  abstract readonly name: string
  abstract readonly extension: string

  abstract export(options: ExportOptions): Promise<ExportResult>

  // ========== 工具方法 ==========

  /** TipTap JSON → Markdown */
  protected contentToMarkdown(content: string): string {
    return jsonToMarkdown(content)
  }

  /** 生成 YAML front matter */
  protected generateFrontMatter(note: Note, notebook?: Notebook): string

  /** 安全文件名（移除非法字符） */
  protected sanitizeFileName(name: string): string
}
```

---

## 七、侵入点分析

### 7.1 需要新增的文件

| 文件 | 说明 |
|------|------|
| `src/main/import-export/` | 整个新模块目录 |
| `src/shared/types.ts` | 添加导入导出相关类型（可选，也可放模块内） |

### 7.2 需要修改的文件

| 文件 | 修改内容 | 侵入程度 |
|------|----------|----------|
| `src/main/index.ts` | 添加 IPC handlers（约 50 行） | 低 |
| `src/preload/index.ts` | 暴露 API 到渲染进程（约 30 行） | 低 |
| `src/preload/index.d.ts` | 添加类型声明 | 低 |

### 7.3 可复用的现有模块

| 模块 | 复用方式 |
|------|----------|
| `src/main/markdown/` | 直接 import，Markdown ↔ TipTap 转换 |
| `src/main/attachment.ts` | 复用 `saveAttachment`、`saveAttachmentBuffer` |
| `src/main/database.ts` | 复用 `addNote`、`addNotebook`、`getNotes` 等 |

### 7.4 IPC Handler 新增

```typescript
// src/main/index.ts 新增

// ============ Import/Export ============
import {
  getImporters,
  detectImporter,
  previewImport,
  executeImport,
  executeExport,
} from './import-export'

// 获取所有可用的导入器
ipcMain.handle('import:getImporters', () => getImporters())

// 检测文件/文件夹适合哪个导入器
ipcMain.handle('import:detect', (_, sourcePath: string) => detectImporter(sourcePath))

// 预览导入（扫描但不执行）
ipcMain.handle('import:preview', (_, options: ImportOptions) => previewImport(options))

// 执行导入
ipcMain.handle('import:execute', (_, options: ImportOptions) => executeImport(options))

// 执行导出
ipcMain.handle('export:execute', (_, options: ExportOptions) => executeExport(options))

// 选择导入源（文件夹选择对话框）
ipcMain.handle('import:selectSource', async (_, importerId?: string) => {
  // 根据 importer 类型弹出文件/文件夹选择框
})

// 选择导出目标目录
ipcMain.handle('export:selectTarget', async () => {
  // 弹出文件夹选择对话框
})
```

### 7.5 Preload API 新增

```typescript
// src/preload/index.ts 新增

importExport: {
  // 导入
  getImporters: () => ipcRenderer.invoke('import:getImporters'),
  detect: (sourcePath: string) => ipcRenderer.invoke('import:detect', sourcePath),
  preview: (options: ImportOptions) => ipcRenderer.invoke('import:preview', options),
  execute: (options: ImportOptions) => ipcRenderer.invoke('import:execute', options),
  selectSource: (importerId?: string) => ipcRenderer.invoke('import:selectSource', importerId),

  // 导出
  export: (options: ExportOptions) => ipcRenderer.invoke('export:execute', options),
  selectTarget: () => ipcRenderer.invoke('export:selectTarget'),
}
```

---

## 八、导入流程详解

```
┌─────────────────────────────────────────────────────────────────────┐
│                          导入流程                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  用户操作                          系统处理                          │
│  ────────                          ────────                          │
│                                                                     │
│  1. 选择文件/文件夹  ──────────>  2. 自动检测格式                     │
│                                      │                              │
│                                      v                              │
│  3. 配置选项        <──────────  显示预览 + 配置面板                  │
│     - 文件夹策略                     │                              │
│     - 标签策略                       │                              │
│     - 冲突策略                       │                              │
│                                      v                              │
│  4. 确认导入        ──────────>  5. 执行导入                         │
│                                      │                              │
│                                      ├─> 5.1 解析所有文件            │
│                                      │       → ParsedNote[]         │
│                                      │                              │
│                                      ├─> 5.2 创建笔记本              │
│                                      │       notebookName → id      │
│                                      │                              │
│                                      ├─> 5.3 解析内部链接            │
│                                      │       [[title]] → note id    │
│                                      │                              │
│                                      ├─> 5.4 复制附件                │
│                                      │       更新内容中的路径        │
│                                      │                              │
│                                      └─> 5.5 批量创建笔记            │
│                                                                     │
│  6. 显示结果        <──────────  返回 ImportResult                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 关键步骤说明

**5.1 解析所有文件**
- 遍历源路径，收集所有支持的文件
- 调用 `importer.parse()` 生成 `ParsedNote[]`
- 此时内容已转换为 TipTap JSON，但链接未解析

**5.2 创建笔记本**
- 收集所有 `notebookName`，去重
- 检查是否已存在同名笔记本
- 按策略处理冲突，创建新笔记本
- 建立 `notebookName → notebookId` 映射

**5.3 解析内部链接（两遍扫描核心）**
```typescript
// 第一遍：建立标题索引
const titleToNote = new Map<string, ParsedNote>()
for (const note of parsedNotes) {
  titleToNote.set(note.title.toLowerCase(), note)
}

// 第二遍：解析链接
for (const note of parsedNotes) {
  for (const link of note.links) {
    const target = titleToNote.get(link.targetTitle.toLowerCase())
    if (target) {
      // 替换 [[title]] 为内部链接格式
    }
  }
}
```

**5.4 复制附件**
- 遍历每个笔记的 `attachments`
- 调用 `saveAttachment()` 复制到 userData
- 更新笔记内容中的路径引用

**5.5 批量创建笔记**
- 使用事务批量插入
- 返回创建结果

---

## 九、实施计划

### Phase 1: 核心框架 + Markdown

**目标：** 支持 Markdown 文件/文件夹的导入导出

**任务：**
1. 创建 `src/main/import-export/` 目录结构
2. 实现类型定义 `types.ts`
3. 实现基类 `base-importer.ts`、`base-exporter.ts`
4. 实现工具函数 `utils/`
5. 实现 `MarkdownImporter`
6. 实现 `MarkdownExporter`
7. 添加 IPC handlers
8. 添加 Preload API

### Phase 2: Obsidian 支持

**目标：** 完整支持 Obsidian vault 导入

**任务：**
1. 扩展 Wiki 链接解析 `[[note]]` `[[note#heading]]` `[[note#^blockId]]`
2. 处理 Obsidian callout 语法 `> [!note]`
3. 处理嵌入语法 `![[note]]` `![[image.png]]`
4. 检测 `.obsidian` 文件夹识别 vault

### Phase 3: Notion 支持

**目标：** 支持 Notion 导出的 ZIP 文件

**任务：**
1. 解压 ZIP 文件
2. 解析 Notion 导出的 Markdown 结构
3. 处理 CSV 数据库导出（可选）
4. 转换 Notion 内部链接

### Phase 4: 其他格式（按需）

- Bear `.textbundle`
- HTML 文件
- Apple Notes（复杂度高，优先级低）

---

## 十、UI 入口规划

### 10.1 入口层级

```
┌─────────────────────────────────────────────────────────────────┐
│                         UI 入口规划                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Phase 1（首先实现）                                             │
│  ─────────────────                                              │
│  设置页 → 数据管理 Tab                                           │
│    ├── 批量导入（文件夹/ZIP）                                    │
│    └── 批量导出（全部/按笔记本）                                  │
│                                                                 │
│  Phase 2（后续扩展）                                             │
│  ─────────────────                                              │
│  笔记本右键菜单                                                  │
│    ├── 导入到此笔记本...                                         │
│    └── 导出此笔记本...                                           │
│                                                                 │
│  笔记列表右键菜单                                                │
│    └── 导出选中笔记...                                           │
│                                                                 │
│  单篇笔记右键菜单 / 更多菜单                                      │
│    ├── 导出为 Markdown                                          │
│    └── 导出为 PDF（未来）                                        │
│                                                                 │
│  拖拽导入                                                        │
│    └── 拖拽 .md 文件到笔记列表区域直接导入                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 10.2 设置页 - 数据管理 Tab（Phase 1）

新增 Settings Tab：`'data'`

```typescript
type SettingsTab = 'general' | 'appearance' | 'ai-actions' | 'knowledge-base' | 'data' | 'about'
```

**Tab 内容布局：**

```
┌─────────────────────────────────────────────────────────────────┐
│  数据管理                                                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  导入笔记                                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  从其他笔记应用迁移数据到三千笔记                          │   │
│  │  支持 Markdown 文件夹、Obsidian、Notion 导出文件等         │   │
│  │                                                          │   │
│  │                                      [导入笔记...]        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  导出笔记                                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  将笔记导出为 Markdown 文件或 JSON 备份                    │   │
│  │  可按笔记本分类，包含附件                                  │   │
│  │                                                          │   │
│  │                                      [导出笔记...]        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  数据位置                                                        │
│  ~/Library/Application Support/sanqian-notes/                   │
│                                              [打开文件夹]        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 10.3 笔记本右键菜单扩展（Phase 2）

```typescript
// Sidebar.tsx 笔记本右键菜单扩展
const notebookContextMenu = [
  { label: t.notebook.edit, action: 'edit' },
  { label: t.notebook.delete, action: 'delete' },
  { type: 'separator' },
  { label: t.importExport.importToNotebook, action: 'import' },  // 新增
  { label: t.importExport.exportNotebook, action: 'export' },    // 新增
]
```

### 10.4 笔记右键菜单扩展（Phase 2）

```typescript
// NoteList.tsx 或 EditorContextMenu.tsx
const noteContextMenu = [
  // ... 现有菜单项
  { type: 'separator' },
  { label: t.importExport.exportAsMarkdown, action: 'exportMd' },  // 新增
]

// 多选时
const multiSelectContextMenu = [
  { label: t.importExport.exportSelected, action: 'exportSelected' },  // 新增
]
```

### 10.5 拖拽导入（Phase 2）

```typescript
// NoteList.tsx 或 App.tsx
// 支持拖拽 .md 文件到笔记列表区域

onDragOver={(e) => {
  if (e.dataTransfer.types.includes('Files')) {
    e.preventDefault()
    setDragOver(true)
  }
}}

onDrop={(e) => {
  const files = Array.from(e.dataTransfer.files)
  const mdFiles = files.filter(f => f.name.endsWith('.md'))
  if (mdFiles.length > 0) {
    // 触发快速导入流程
    quickImport(mdFiles, currentNotebookId)
  }
}}
```

### 10.6 新增组件文件

| 组件 | 路径 | 说明 |
|------|------|------|
| `DataSettings.tsx` | `src/renderer/src/components/` | 数据管理 Tab 内容 |
| `ImportDialog.tsx` | `src/renderer/src/components/` | 导入向导对话框 |
| `ExportDialog.tsx` | `src/renderer/src/components/` | 导出对话框 |

### 10.7 i18n 新增

```typescript
// translations.ts 新增
importExport: {
  // Tab
  dataManagement: '数据管理',

  // 导入
  import: '导入笔记',
  importDescription: '从其他笔记应用迁移数据到三千笔记',
  importButton: '导入笔记...',
  importToNotebook: '导入到此笔记本...',

  // 导出
  export: '导出笔记',
  exportDescription: '将笔记导出为 Markdown 文件或 JSON 备份',
  exportButton: '导出笔记...',
  exportNotebook: '导出此笔记本...',
  exportSelected: '导出选中笔记...',
  exportAsMarkdown: '导出为 Markdown',

  // 数据位置
  dataLocation: '数据位置',
  openFolder: '打开文件夹',

  // 导入对话框
  selectSource: '选择来源',
  browse: '浏览...',
  detected: '检测到',
  folderStrategy: '文件夹处理',
  folderStrategyFirstLevel: '第一级文件夹作为笔记本',
  folderStrategyFlattenPath: '完整路径作为笔记本名',
  folderStrategySingleNotebook: '全部放入指定笔记本',
  tagStrategy: '标签处理',
  conflictStrategy: '同名笔记',
  conflictSkip: '跳过',
  conflictRename: '重命名',
  conflictOverwrite: '覆盖',
  importAttachments: '导入附件',
  parseFrontMatter: '解析 Front Matter',
  preview: '预览',
  startImport: '开始导入',

  // 导出对话框
  exportRange: '导出范围',
  exportAll: '全部笔记',
  exportCurrentNotebook: '当前笔记本',
  exportSelected: '选中的笔记',
  exportFormat: '导出格式',
  formatMarkdown: 'Markdown (.md)',
  formatJson: 'JSON 完整备份',
  groupByNotebook: '按笔记本创建文件夹',
  includeAttachments: '包含附件',
  includeFrontMatter: '添加 Front Matter',
  asZip: '打包为 ZIP',
  outputLocation: '输出位置',

  // 进度和结果
  importing: '正在导入...',
  exporting: '正在导出...',
  importComplete: '导入完成',
  exportComplete: '导出完成',
  importedNotes: '已导入 {count} 篇笔记',
  exportedNotes: '已导出 {count} 篇笔记',
  skippedFiles: '跳过 {count} 个文件',
  errors: '{count} 个错误',
}
```

---

## 十一、对话框 UI 设计

### 导入向导

```
┌────────────────────────────────────────────┐
│  导入笔记                              [X] │
├────────────────────────────────────────────┤
│                                            │
│  选择来源                                   │
│  ┌────────────────────────────────────┐    │
│  │ 📁 /Users/xxx/Obsidian/MyVault     │    │
│  │    [浏览...]                       │    │
│  └────────────────────────────────────┘    │
│                                            │
│  检测到: Obsidian Vault (125 个笔记)        │
│                                            │
│  ─────────────────────────────────────     │
│                                            │
│  文件夹处理                                 │
│  ○ 第一级文件夹作为笔记本 (推荐)            │
│  ○ 完整路径作为笔记本名                     │
│  ○ 全部放入: [选择笔记本 ▼]                │
│                                            │
│  标签处理                                   │
│  ○ 保留嵌套格式 work/project               │
│  ○ 拆分为多个标签                          │
│                                            │
│  同名笔记                                   │
│  ○ 跳过  ○ 重命名  ○ 覆盖                  │
│                                            │
│  ☑ 导入附件                                │
│  ☑ 解析 Front Matter                       │
│                                            │
│           [取消]  [预览]  [开始导入]        │
└────────────────────────────────────────────┘
```

### 导出对话框

```
┌────────────────────────────────────────────┐
│  导出笔记                              [X] │
├────────────────────────────────────────────┤
│                                            │
│  导出范围                                   │
│  ○ 全部笔记 (256 个)                       │
│  ○ 当前笔记本: Work (45 个)                │
│  ○ 选中的笔记 (3 个)                       │
│                                            │
│  导出格式                                   │
│  ○ Markdown (.md)                          │
│  ○ JSON 完整备份                           │
│                                            │
│  选项                                       │
│  ☑ 按笔记本创建文件夹                      │
│  ☑ 包含附件                                │
│  ☑ 添加 Front Matter                       │
│  ☑ 打包为 ZIP                              │
│                                            │
│  输出位置                                   │
│  ┌────────────────────────────────────┐    │
│  │ ~/Downloads/sanqian-export         │    │
│  │    [浏览...]                       │    │
│  └────────────────────────────────────┘    │
│                                            │
│                    [取消]  [导出]           │
└────────────────────────────────────────────┘
```

---

## 十二、注意事项

### 性能考虑

1. **大量文件导入**：使用流式处理，避免一次性加载
2. **批量数据库操作**：使用事务
3. **进度反馈**：通过 IPC 发送进度事件

### 错误处理

1. **部分失败**：继续处理其他文件，最后汇总错误
2. **回滚机制**：导入失败时可选择删除已导入内容
3. **日志记录**：详细记录每个文件的处理结果

### 安全考虑

1. **路径验证**：防止路径遍历攻击
2. **文件大小限制**：单文件和总大小限制
3. **文件类型检查**：只处理支持的文件类型

---

## 十三、实现进度

### Phase 1: 核心框架 + Markdown 导入导出 ✅

**完成日期**: 2026-01-05

**已实现功能**:

1. **类型定义** (`src/main/import-export/types.ts`)
   - ImportOptions, ExportOptions 等完整类型定义
   - FolderStrategy, TagStrategy, ConflictStrategy 枚举

2. **基类** (`src/main/import-export/base-importer.ts`, `base-exporter.ts`)
   - BaseImporter: markdown→TipTap 转换、标题提取、笔记本名解析
   - BaseExporter: TipTap→markdown 转换、front matter 生成

3. **工具函数** (`src/main/import-export/utils/`)
   - `front-matter.ts`: 轻量级 YAML front matter 解析器
   - `attachment-handler.ts`: 附件复制和路径更新

4. **Markdown 导入器** (`src/main/import-export/importers/markdown-importer.ts`)
   - 支持单文件和文件夹导入
   - 支持 .md, .markdown, .mdown, .mkd 扩展名
   - Front matter 解析（标签、日期等）
   - 文件夹→笔记本映射（三种策略）

5. **Markdown 导出器** (`src/main/import-export/exporters/markdown-exporter.ts`)
   - 导出为 .md 文件
   - 可选 front matter 输出
   - 附件复制
   - ZIP 打包（使用系统命令）

6. **IPC 通信** (`src/main/index.ts`)
   - `import:getImporters`, `import:detect`, `import:preview`, `import:execute`
   - `export:execute`, `import:selectSource`, `export:selectTarget`
   - `app:getDataPath`, `app:openDataPath`

7. **UI 组件** (`src/renderer/src/components/`)
   - `DataSettings.tsx`: 数据管理设置页面
   - `ImportDialog.tsx`: 导入向导（多步骤）
   - `ExportDialog.tsx`: 导出配置对话框

8. **i18n 支持** (`src/renderer/src/i18n/translations.ts`)
   - 中英文完整翻译

9. **Settings 集成** (`src/renderer/src/components/Settings.tsx`)
   - 新增"数据"标签页

### 测试覆盖

- `__tests__/front-matter.test.ts` - 28 个测试用例
- `__tests__/markdown-importer.test.ts` - 17 个测试用例
- `__tests__/markdown-exporter.test.ts` - 9 个测试用例
- `__tests__/integration.test.ts` - 9 个集成测试

### 安全修复

1. **路径遍历防护**: 附件收集时验证路径不超出源目录 (`base-importer.ts`)
2. **命令注入防护**: ZIP 创建使用 `spawn` 替代 `exec` (`markdown-exporter.ts`)
3. **previewImport 异步修复**: 修复未 await 的 `canHandle` 调用 (`index.ts`)

### Phase 2: Obsidian 支持 ✅

**完成日期**: 2026-01-05

**已实现功能**:

1. **Obsidian 导入器** (`src/main/import-export/importers/obsidian-importer.ts`)
   - `.obsidian` 文件夹检测识别 vault
   - Wiki 链接解析 `[[note]]` `[[note#heading]]` `[[note#^blockId]]`
   - 嵌入语法处理 `![[note]]` `![[image.png]]`
   - 内联标签提取 `#tag` `#nested/tag` `#kebab-case-tag`
   - Vault 内附件搜索（常见目录 + 递归搜索）

2. **内部链接解析** (`src/main/import-export/utils/link-resolver.ts`)
   - 两遍扫描：先建立标题索引，再解析链接
   - Wiki 链接转换为内部 `note://` 格式

3. **安全加固**
   - PowerShell 命令注入防护（ScriptBlock 参数化）
   - 文件大小限制（50MB 文件，100MB 附件）
   - 符号链接路径遍历防护（`realpathSync`）
   - YAML 递归深度限制（10 层）
   - 附件复制进度事件

### 测试覆盖 (Phase 1 + Phase 2)

- `__tests__/front-matter.test.ts` - 31 个测试用例
- `__tests__/markdown-importer.test.ts` - 17 个测试用例
- `__tests__/markdown-exporter.test.ts` - 9 个测试用例
- `__tests__/integration.test.ts` - 9 个集成测试
- `__tests__/link-resolver.test.ts` - 12 个测试用例
- `__tests__/obsidian-importer.test.ts` - 15 个测试用例

**总计: 93 个测试用例**

### Phase 3: Notion 支持 ✅

**完成日期**: 2026-01-05

**已实现功能**:

1. **ZIP 处理工具** (`src/main/import-export/utils/zip-handler.ts`)
   - `listZipEntries`: 读取 ZIP 文件列表（不解压），用于快速检测
   - `detectNotionZip`: 检测 ZIP 是否包含 Notion 风格文件名（32位 hex ID）
   - `extractZip`: 解压到临时目录，支持 Windows (PowerShell) 和 macOS/Linux (unzip)
   - `cleanupTempDir`: 清理临时目录
   - 安全措施：500MB 解压大小限制、路径遍历防护

2. **CSV 解析器** (`src/main/import-export/utils/csv-parser.ts`)
   - `parseCSV`: 健壮的 CSV 解析（处理引号内逗号、换行、转义引号）
   - `csvToMarkdownTable`: CSV 转 Markdown 表格，支持 wiki 链接
   - `extractTitleColumn`: 提取标题列用于链接映射

3. **云端图片下载** (`src/main/import-export/utils/image-downloader.ts`)
   - `isNotionCloudImage`: 检测 S3/Notion 云端图片 URL
   - `downloadImage`: 下载图片到本地（20MB 限制，30s 超时）
   - `getExtensionFromUrl`: 从 URL 提取文件扩展名

4. **Notion 导入器** (`src/main/import-export/importers/notion-importer.ts`)
   - Notion 风格文件名检测（32位 hex ID）
   - 文件名中 ID 清理 → 提取干净标题
   - Notion 内部链接转换（绝对 URL + 相对路径 → wiki 链接）
   - 重名冲突处理（添加父目录区分：Work/Meeting Notes）
   - 数据库 CSV 转 Markdown 表格笔记
   - 本地附件收集 + 云端图片下载
   - Front matter 解析支持
   - try-finally 确保临时目录清理

5. **注册集成** (`src/main/import-export/index.ts`)
   - NotionImporter 注册到 importers 数组
   - 优先级：Notion > Obsidian > Markdown（更具体的格式优先匹配）

### 测试覆盖 (Phase 1 + Phase 2 + Phase 3)

- `__tests__/front-matter.test.ts` - 28 个测试用例
- `__tests__/markdown-importer.test.ts` - 17 个测试用例
- `__tests__/markdown-exporter.test.ts` - 9 个测试用例
- `__tests__/integration.test.ts` - 9 个集成测试
- `__tests__/link-resolver.test.ts` - 12 个测试用例
- `__tests__/obsidian-importer.test.ts` - 18 个测试用例
- `__tests__/zip-handler.test.ts` - 10 个测试用例
- `__tests__/csv-parser.test.ts` - 32 个测试用例（含边界情况）
- `__tests__/notion-importer.test.ts` - 26 个测试用例（含边界情况）

**总计: 161 个测试用例**

---

## 十四、Phase 3: Notion 导入器设计

### 14.1 概述

支持从 Notion 导出的 ZIP 文件（Markdown & CSV 格式）导入笔记。

**参考实现**: [Notion-to-Obsidian-Converter](https://github.com/connertennery/Notion-to-Obsidian-Converter)

### 14.2 Notion 导出格式分析

#### 文件名格式

```
Page Name abc123def456789012345678901234.md
         └─────────── 32位十六进制 ID ───────────┘
```

- 标题与 ID 之间用**空格**分隔
- 正则匹配：`/^(.+)\s([0-9a-f]{32})\.md$/i`

#### ZIP 文件结构

```
Export-xxx.zip
├── Page Name abc123.md              # 顶级页面
├── Page Name abc123/                # 同名文件夹存放子内容
│   ├── image.png                    # 附件
│   ├── Subpage xyz789.md            # 子页面
│   └── Subpage xyz789/              # 子页面的附件/嵌套
│       └── nested-image.png
├── Database Title def456/           # 数据库
│   ├── Row 1 aaa111.md              # 每行一个 md
│   ├── Row 2 bbb222.md
│   └── Database Title def456.csv    # CSV 汇总
└── index.html                       # sitemap 导航（可选）
```

#### 内部链接格式

| 类型 | 格式 | 示例 |
|------|------|------|
| 绝对 URL | `[Title](https://www.notion.so/...)` | `[My Page](https://www.notion.so/My-Page-abc123)` |
| 相对路径 | `[Title](URL编码路径)` | `[Sub](Subpage%20xyz789.md)` |

#### 图片引用

```markdown
![image](Page%20Name%20abc123/image.png)           # 本地附件
![](https://prod-files-secure.s3.amazonaws.com/...)  # 云端图片（需下载）
```

#### 数据库处理

**采用方案 A（业界做法）**：
- CSV → 创建 `[Database Name].md` 笔记，内容为 Markdown 表格
- 同时保留每行对应的 Markdown 文件
- 表格中的行标题链接到对应的笔记（wiki link）

### 14.3 实现方案

#### 类结构

```typescript
// src/main/import-export/importers/notion-importer.ts

export class NotionImporter extends BaseImporter {
  readonly info: ImporterInfo = {
    id: 'notion',
    name: 'Notion',
    description: 'Import Notion exported ZIP file (Markdown & CSV)',
    extensions: ['.zip'],
    supportsFolder: false,
    fileFilters: [{ name: 'Notion Export', extensions: ['zip'] }],
  }

  // 检测：读取 ZIP 文件列表（不解压），检测 Notion 风格文件名
  async canHandle(sourcePath: string): Promise<boolean>

  // 解析流程
  async parse(options: ImportOptions): Promise<ParsedNote[]>
}
```

#### 核心处理流程

```
1. 检测 ZIP 文件（快速检测，不解压）
   ├─> 检查扩展名 .zip
   └─> 读取 ZIP 文件列表，检测 Notion 风格文件名（32位 hex ID）

2. 解压到临时目录
   ├─> 临时目录：os.tmpdir() + '/notion-import-xxx'
   ├─> 安全检查：验证路径不超出临时目录（防止 ZIP 路径遍历）
   └─> 大小限制：解压后总大小 ≤ 500MB

3. 遍历文件
   ├─> 递归收集所有 .md 和 .csv 文件
   ├─> 跳过 index.html
   └─> 建立 ID → 标题 映射（用于链接转换和重名检测）

4. 处理重名冲突
   └─> 同标题页面添加父目录名区分：Work/Meeting Notes

5. 处理每个 Markdown 文件
   ├─> 清理文件名中的 32 位 ID → 提取标题
   ├─> 解析内容
   │   ├─> 转换绝对 URL 链接 → [[wiki link]]
   │   ├─> 转换相对路径链接 → [[wiki link]]（支持锚点 #heading）
   │   └─> 保留外部链接不变
   ├─> 处理图片
   │   ├─> 本地图片：收集附件
   │   └─> 云端图片（S3 URL）：尝试下载（限制 20MB，超时 30s）
   └─> 下载失败时保留原 URL

6. 处理数据库 CSV
   ├─> 健壮的 CSV 解析（处理引号内换行）
   ├─> 转为 Markdown 表格笔记
   └─> 表格中的标题列链接到对应行笔记

7. 清理临时目录（try-finally 确保执行）

8. 返回 ParsedNote[]
```

#### 安全措施

| 风险 | 防护措施 |
|------|----------|
| ZIP 炸弹 | 解压后总大小限制 500MB |
| 路径遍历 | 验证解压路径不超出临时目录 |
| 单文件大小 | 复用现有 50MB 限制 |
| 云端图片下载 | 单图限制 20MB，超时 30s |

#### 关键转换逻辑

```typescript
// 文件名清理（支持 .md 和目录名）
function cleanNotionFilename(filename: string): string {
  // "Meeting Notes abc123def456789012345678901234.md" → "Meeting Notes"
  // "Meeting Notes abc123def456789012345678901234" → "Meeting Notes" (目录)
  const match = filename.match(/^(.+)\s[0-9a-f]{32}(\.md)?$/i)
  return match ? match[1] : filename.replace(/\.md$/, '')
}

// 链接转换
function convertNotionLinks(
  content: string,
  idToTitle: Map<string, string>  // notion ID → 清理后标题
): string {
  let result = content

  // 1. 绝对 URL: [Text](https://www.notion.so/Page-Name-abc123def456...)
  //    → [[Page Name]] 或 [[Page Name#anchor]]
  result = result.replace(
    /\[([^\]]+)\]\(https:\/\/www\.notion\.so\/[^)]*?([0-9a-f]{32})(?:#([^)]*))?\)/gi,
    (match, text, id, anchor) => {
      const title = idToTitle.get(id) || text
      return anchor ? `[[${title}#${anchor}]]` : `[[${title}]]`
    }
  )

  // 2. 相对路径: [Text](Subpage%20Name%20xyz789.md) 或 [Text](../Parent/Page%20abc123.md)
  //    → [[Subpage Name]]
  result = result.replace(
    /\[([^\]]+)\]\(([^)]+\s[0-9a-f]{32}\.md)\)/gi,
    (match, text, path) => {
      const decoded = decodeURIComponent(path)
      const filename = decoded.split('/').pop() || decoded
      const title = cleanNotionFilename(filename)
      return `[[${title}]]`
    }
  )

  // 3. 外部链接保持不变（包含 :// 但非 notion.so）
  // 已在上面的正则中排除

  return result
}

// 重名处理：添加父目录区分
function resolveNameConflicts(
  notes: Array<{ path: string; title: string }>
): Map<string, string> {
  const titleCount = new Map<string, number>()
  const pathToTitle = new Map<string, string>()

  // 统计同名数量
  for (const note of notes) {
    titleCount.set(note.title, (titleCount.get(note.title) || 0) + 1)
  }

  // 有冲突的添加父目录
  for (const note of notes) {
    if (titleCount.get(note.title)! > 1) {
      const parent = note.path.split('/').slice(-2, -1)[0] || ''
      const cleanParent = cleanNotionFilename(parent)
      pathToTitle.set(note.path, cleanParent ? `${cleanParent}/${note.title}` : note.title)
    } else {
      pathToTitle.set(note.path, note.title)
    }
  }

  return pathToTitle
}
```

### 14.4 ZIP 解压方案

```typescript
import { execFileAsync } from '../utils/exec-helper'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

async function extractZip(zipPath: string): Promise<string> {
  // 创建临时目录
  const tempDir = mkdtempSync(join(tmpdir(), 'notion-import-'))

  // 解压
  if (process.platform === 'win32') {
    // Windows: PowerShell Expand-Archive
    await execFileAsync('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      '& { Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force }',
      zipPath, tempDir
    ])
  } else {
    // macOS/Linux: unzip
    await execFileAsync('unzip', ['-q', '-o', zipPath, '-d', tempDir])
  }

  return tempDir
}

// 清理临时目录
function cleanupTempDir(tempDir: string): void {
  try {
    rmSync(tempDir, { recursive: true, force: true })
  } catch (e) {
    console.error('Failed to cleanup temp dir:', e)
  }
}
```

### 14.5 云端图片下载

```typescript
import { createWriteStream } from 'fs'
import { pipeline } from 'stream/promises'
import { fetch } from 'undici' // 或使用 Node.js 内置 fetch

async function downloadImage(url: string, destPath: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(30000) // 30s 超时
    })

    if (!response.ok || !response.body) {
      return false
    }

    await pipeline(response.body, createWriteStream(destPath))
    return true
  } catch (e) {
    console.error('Failed to download image:', url, e)
    return false
  }
}
```

### 14.6 数据库 CSV 处理

```typescript
// 健壮的 CSV 解析（处理引号内的逗号和换行）
function parseCSV(content: string): string[][] {
  const rows: string[][] = []
  let current: string[] = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < content.length; i++) {
    const char = content[i]
    const next = content[i + 1]

    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"'  // 转义的引号
        i++
      } else if (char === '"') {
        inQuotes = false
      } else {
        cell += char
      }
    } else {
      if (char === '"') {
        inQuotes = true
      } else if (char === ',') {
        current.push(cell.trim())
        cell = ''
      } else if (char === '\n' || (char === '\r' && next === '\n')) {
        current.push(cell.trim())
        if (current.some(c => c)) rows.push(current)
        current = []
        cell = ''
        if (char === '\r') i++
      } else {
        cell += char
      }
    }
  }
  // 最后一行
  if (cell || current.length) {
    current.push(cell.trim())
    if (current.some(c => c)) rows.push(current)
  }

  return rows
}

// CSV → Markdown 表格笔记
function csvToMarkdownNote(
  csvContent: string,
  databaseName: string,
  rowNotes: Map<string, string>  // 行标题 → 笔记标题（用于链接）
): string {
  const rows = parseCSV(csvContent)
  if (rows.length < 2) return ''

  const headers = rows[0]
  const dataRows = rows.slice(1)

  // 找到标题列（通常是 Name 或第一列）
  const titleCol = headers.findIndex(h =>
    h.toLowerCase() === 'name' || h.toLowerCase() === 'title'
  )
  const titleIndex = titleCol >= 0 ? titleCol : 0

  // 生成 Markdown 表格
  let md = `# ${databaseName}\n\n`
  md += '| ' + headers.join(' | ') + ' |\n'
  md += '| ' + headers.map(() => '---').join(' | ') + ' |\n'

  for (const row of dataRows) {
    const cells = row.map((cell, i) => {
      // 标题列转为 wiki 链接
      if (i === titleIndex && rowNotes.has(cell)) {
        return `[[${rowNotes.get(cell)}]]`
      }
      // 转义表格中的 | 字符
      return cell.replace(/\|/g, '\\|')
    })
    md += '| ' + cells.join(' | ') + ' |\n'
  }

  return md
}
```

### 14.7 UI 入口

**现有入口已满足需求**：

1. **设置页 → 导入/导出 Tab → 导入笔记按钮**
   - 点击后打开 ImportDialog
   - 选择 ZIP 文件后自动检测为 Notion 格式
   - 显示配置选项（文件夹策略等）

2. **无需新增 UI**：
   - NotionImporter 注册到 importers 数组
   - `canHandle()` 自动检测 ZIP + Notion 文件名格式
   - ImportDialog 显示 "检测到: Notion"

### 14.8 测试计划

```typescript
// __tests__/notion-importer.test.ts

describe('NotionImporter', () => {
  // 检测测试
  describe('canHandle', () => {
    it('should detect Notion ZIP by filename pattern')
    it('should reject non-ZIP files')
    it('should reject ZIP without Notion-style filenames')
  })

  // 文件名清理
  describe('cleanNotionFilename', () => {
    it('should remove 32-char hex ID from filename')
    it('should handle Chinese characters')
    it('should handle special characters')
  })

  // 链接转换
  describe('link conversion', () => {
    it('should convert absolute Notion URLs to wiki links')
    it('should convert relative paths to wiki links')
    it('should decode URL-encoded characters')
    it('should handle nested page links')
  })

  // 附件处理
  describe('attachments', () => {
    it('should collect local image references')
    it('should download S3 cloud images')
    it('should handle download failures gracefully')
  })

  // 数据库处理
  describe('database CSV', () => {
    it('should convert CSV to Markdown table')
    it('should preserve individual row Markdown files')
  })

  // 集成测试
  describe('integration', () => {
    it('should import complete Notion export')
    it('should cleanup temp directory after import')
    it('should handle large exports')
  })
})
```

### 14.9 待实现 (Phase 4+)

- [ ] JSON 格式导出器
- [ ] Bear 导入器 (.textbundle)
- [ ] HTML 文件导入
- [ ] 单篇笔记导入导出入口（右键菜单）
- [ ] 笔记本导入导出入口（右键菜单）
- [ ] 拖拽导入支持
