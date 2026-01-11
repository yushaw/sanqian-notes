# 编辑器内搜索功能设计文档

> 创建时间: 2026-01-11

## 一、概述

为 Tiptap 编辑器添加文档内搜索功能，支持快捷键触发、实时高亮、结果导航。

### 技术方案

**自己实现**，不引入外部搜索库。

#### 方案决策（2026-01-11）

| 方案 | 评估结果 |
|-----|---------|
| `prosemirror-search` | ❌ 不采用 - 需要额外包装，增加依赖 |
| `@sereneinserenade/tiptap-search-and-replace` | ❌ 不采用 - 维护滞后，有已知 bug |
| **自己实现** | ✅ 采用 - 代码量可控（~200行），参考 AIPreview.ts 模式 |

**理由**：
1. 项目已有成熟的 Decoration 实现模式（AIPreview.ts）
2. 搜索逻辑相对简单，不值得引入额外依赖
3. 自己实现可控性更强，便于定制特殊节点跳过

### 核心功能

- 快捷键 `⌘F` 打开搜索
- 实时搜索高亮
- 上/下一个结果导航
- 大小写敏感选项
- 正则表达式支持

---

## 二、UI 设计

### 1. 搜索栏布局

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 🔍  [搜索词______________________________]  [Aa] [.*]  │ 2/15 │ ◀ ▶ │ ✕ │
└─────────────────────────────────────────────────────────────────────────┘
 ↑     ↑                                      ↑    ↑      ↑      ↑    ↑
 │     │                                      │    │      │      │    │
图标  输入框                               选项按钮  计数   导航   关闭
```

**位置**: 编辑器顶部，作为浮层显示

### 2. 元素尺寸

| 元素 | 尺寸 | 说明 |
|-----|------|------|
| 搜索栏高度 | 44px | 内边距 12px 16px |
| 搜索图标 | 16×16px | 灰色，左侧 |
| 输入框 | flex-1, 高度 32px | 占据剩余空间 |
| 选项按钮 | 28×28px | 正方形，圆角 4px |
| 计数文字 | min-width 60px | 居中对齐 |
| 导航按钮 | 28×28px | 上下箭头 |
| 关闭按钮 | 28×28px | × 图标 |

### 3. 颜色状态

| 状态 | 输入框边框 | 背景 |
|-----|-----------|------|
| 默认 | `var(--color-border)` | `var(--color-bg)` |
| 聚焦 | `var(--color-accent)` | `var(--color-bg)` |
| 有结果 | `var(--color-accent)` | `var(--color-bg)` |
| 无结果 | `#ef4444` (红色) | `#fef2f2` (浅红) |

### 4. 结果高亮样式

```css
/* 所有匹配结果 */
.search-result {
  background-color: var(--color-accent-soft);
  border-radius: 2px;
  padding: 0 1px;
}

/* 当前选中的结果 */
.search-result-current {
  background-color: var(--color-accent);
  color: white;
  border-radius: 2px;
  padding: 0 1px;
}
```

---

## 三、交互设计

### 1. 快捷键

| 快捷键 | 状态 | 行为 |
|-------|------|------|
| `⌘F` / `Ctrl+F` | 搜索关闭 | 打开搜索栏，聚焦输入框 |
| `⌘F` / `Ctrl+F` | 搜索已打开 | 全选输入框内容 |
| `Esc` | 搜索打开 | 关闭搜索栏，清除高亮，恢复编辑器焦点 |
| `Enter` | 在搜索栏内 | 跳转到下一个结果 |
| `⇧Enter` | 在搜索栏内 | 跳转到上一个结果 |
| `⌘G` | 任意 | 跳转到下一个结果（备用） |
| `⌘⇧G` | 任意 | 跳转到上一个结果（备用） |

### 2. 焦点流转

```
输入框 ──Tab──▶ [Aa] ──Tab──▶ [.*] ──Tab──▶ ◀ ──Tab──▶ ▶ ──Tab──▶ ✕
   ▲                                                              │
   └──────────────────────── ⇧Tab ────────────────────────────────┘
```

### 3. 状态机

```
                    ┌─────────┐
                    │  关闭   │
                    └────┬────┘
                         │ ⌘F
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                      打开状态                                │
│  ┌─────────┐    输入    ┌─────────┐   找到    ┌─────────┐  │
│  │  空输入  │ ─────────▶│  搜索中  │ ───────▶ │  有结果  │  │
│  └─────────┘            └─────────┘           └─────────┘  │
│       ▲                      │                     │        │
│       │                      │ 无匹配              │        │
│       │                      ▼                     │        │
│       │               ┌─────────┐                  │        │
│       │               │  无结果  │                  │        │
│       │               └─────────┘                  │        │
│       │                                            │        │
│       └────────────── 清空输入 ◀───────────────────┘        │
└─────────────────────────────────────────────────────────────┘
                         │ Esc / 点击 ✕
                         ▼
                    ┌─────────┐
                    │  关闭   │
                    └─────────┘
```

### 4. 动画规范

```ts
// 搜索栏进入
const enterAnimation = {
  initial: { opacity: 0, y: -20, height: 0 },
  animate: {
    opacity: 1,
    y: 0,
    height: 44,
    transition: { duration: 0.15, ease: [0.25, 0.1, 0.25, 1] }
  }
}

// 搜索栏退出
const exitAnimation = {
  exit: {
    opacity: 0,
    y: -10,
    height: 0,
    transition: { duration: 0.1 }
  }
}

// 当前结果高亮脉冲
@keyframes search-pulse {
  0% { box-shadow: 0 0 0 0 var(--color-accent); }
  50% { box-shadow: 0 0 0 3px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}
```

### 5. 滚动行为

| 场景 | 滚动行为 |
|-----|---------|
| 首次搜索 | 滚动到第一个结果 |
| 按 Enter | 滚动到下一个结果 |
| 按 ⇧Enter | 滚动到上一个结果 |
| 修改搜索词 | 滚动到新的第一个结果 |
| 结果已在视口内 | 不滚动 |

滚动策略：结果定位在视口中间偏上（距顶部 30%）

### 6. 边界情况

| 场景 | 处理方式 |
|-----|---------|
| 无结果 | 输入框边框变红，显示"无结果" |
| 输入为空 | 计数为空，导航按钮禁用 |
| 正则表达式错误 | 边框变红，显示"正则错误" |
| 结果循环 | 从末尾跳到开头时，计数区域短暂闪烁 |

### 7. 选中文本自动填充

- 打开搜索时，如果编辑器有选中文本，自动填入搜索框

### 8. 搜索时继续编辑

- 允许用户在搜索打开时继续编辑
- 编辑内容变化时，实时更新搜索结果
- 删除匹配内容，结果数减少，自动调整当前索引

---

## 四、技术架构

### 1. 文件结构

```
src/renderer/src/components/
├── extensions/
│   └── EditorSearch.ts           # Tiptap 扩展
│
├── SearchBar.tsx                 # 搜索栏 UI 组件
│
└── Editor.tsx                    # 集成点
```

### 2. 需要修改的文件

| 文件 | 改动内容 |
|-----|---------|
| `Editor.tsx` | 导入扩展、添加状态、渲染 SearchBar |
| `Editor.css` | 添加搜索高亮样式 |
| `shortcuts.ts` | 添加搜索快捷键定义 |

### 3. EditorSearch 扩展 API

```ts
// Commands
editor.commands.openSearch()
editor.commands.closeSearch()
editor.commands.setSearchTerm(term: string)
editor.commands.findNext()
editor.commands.findPrevious()
editor.commands.clearSearch()
editor.commands.toggleCaseSensitive()
editor.commands.toggleRegex()

// Storage
editor.storage.editorSearch.searchTerm
editor.storage.editorSearch.caseSensitive
editor.storage.editorSearch.useRegex
editor.storage.editorSearch.results
editor.storage.editorSearch.currentIndex
```

### 4. 特殊节点处理

搜索时跳过以下节点类型：
- `mathematics` - 数学公式
- `mermaid` - 流程图
- `codeBlock` - 代码块（可选）
- `embed` - 嵌入内容

---

## 五、实现计划

> **状态**: ✅ 已完成 (2026-01-11)

### 阶段 1: 基础框架
- [x] ~~安装依赖~~ - 决定自己实现，无需外部依赖
- [x] 创建 EditorSearch.ts 扩展骨架
- [x] 创建 SearchBar.tsx UI 组件
- [x] 在 Editor.tsx 中集成

### 阶段 2: 核心功能
- [x] 实现文本搜索逻辑
- [x] 实现 Decoration 高亮
- [x] 实现结果导航（上/下一个）
- [x] 实现滚动到结果位置

### 阶段 3: 增强功能
- [x] 大小写敏感选项
- [x] 正则表达式支持
- [x] 特殊节点跳过（Math、Mermaid、CodeBlock、Embed）
- [x] 选中文本自动填充

### 阶段 4: 优化和测试
- [x] 样式和动画优化
- [ ] 大文档性能测试（待用户反馈）
- [x] 边界情况处理
- [ ] 快捷键冲突检查（待用户反馈）
- [x] 单元测试（26 个测试用例）

---

## 六、风险点

| 风险 | 说明 | 应对方案 |
|-----|------|---------|
| 快捷键冲突 | `⌘F` 可能被浏览器或 Electron 占用 | 在 Electron 主进程中禁用默认行为 |
| 性能问题 | 大文档频繁搜索可能卡顿 | debounce 150ms + 优化 Decoration 更新 |
| 跨节点匹配 | 搜索词跨越格式标记时 | prosemirror-search 原生支持 |
| 焦点管理 | 搜索框焦点 vs 编辑器焦点 | 关闭搜索后恢复编辑器焦点 |

---

## 七、未来扩展

1. ~~**替换功能** - 添加替换输入框和替换/全部替换按钮~~ ✅ 已完成 (2026-01-11)
2. **搜索历史** - 记住最近搜索词
3. **正则捕获组替换** - 支持 `$1`、`$&` 等
4. **全局搜索** - `⌘⇧F` 跨笔记搜索
