# 多标签页 + Split View 设计文档

## 需求

实现类似 Obsidian 的多标签页模式，每个标签页支持分屏显示多个笔记。

**参考**: sanqian 项目的 `WindowContext` + `WindowLayoutView` 实现

---

## 布局

```
┌─────────┬──────────────┬─────────────────────────────────┐
│ Sidebar │  NoteList    │  ┌─────────────────────────────┐│
│         │              │  │ [Tab1][Tab2][Tab3]     [+]  ││ ← TabBar (顶部)
│ 笔记本  │              │  ├─────────────┬───────────────┤│
│ 列表    │              │  │ [×][⫿][⫰][⠿]│              ││ ← Pane 控制 (hover)
│         │              │  │   Editor    │    Editor     ││
│         │              │  │  (Note A)   │   (Note B)    ││
└─────────┴──────────────┴─────────────────────────────────┘
```

### 核心概念

- **Tab**: 一个工作区，包含一个或多个分屏 pane
- **Pane**: 分屏中的一个编辑器视图，显示一个笔记
- **Layout**: 二叉树结构，描述 pane 的排列方式

---

## 数据结构

```typescript
// v2 架构: paneId + noteId 分离
interface Tab {
  id: string                                // tab_xxx
  layout: MosaicNode<string> | string       // paneId 的布局树 (不再是 noteId)
  panes: Record<string, PaneState>          // paneId -> { noteId }
  focusedPaneId: string | null              // 当前焦点 pane ID
  isPinned?: boolean
  createdAt: number
}

interface PaneState {
  noteId: string | null  // null 表示空 pane
}

// MosaicNode 结构 (react-mosaic-component)
type MosaicNode<T> = T | {
  direction: 'row' | 'column'  // row=左右, column=上下
  first: MosaicNode<T>
  second: MosaicNode<T>
  splitPercentage?: number     // 0-100
}
```

**示例**:
- 单个 pane: `"pane_abc123"` + `{ pane_abc123: { noteId: "note_xyz" } }`
- 左右分屏: `{ direction: 'row', first: 'pane_a', second: 'pane_b' }` + 对应 panes 映射

**为什么分离 paneId 和 noteId**:
- 同一笔记可以在多个 pane 打开
- pane 位置（layout）和内容（noteId）独立管理
- 便于实现"在新 pane 打开同一笔记"等功能

---

## 状态管理 (TabContext)

```typescript
interface TabContextValue {
  // 状态
  tabs: Tab[]
  activeTabId: string | null
  activeTab: Tab | null
  focusedPaneId: string | null    // 当前焦点 pane ID
  focusedNoteId: string | null    // 派生: 焦点 pane 对应的 noteId

  // Tab 操作
  createTab: (noteId?: string) => string
  closeTab: (tabId: string) => void
  closeTabs: (tabIds: string[]) => void  // 批量关闭，避免多次状态更新
  selectTab: (tabId: string) => void
  pinTab: (tabId: string) => void
  unpinTab: (tabId: string) => void
  reorderTabs: (oldIndex: number, newIndex: number) => void

  // Pane 操作 (在当前 Tab 内)
  openNoteInPane: (noteId: string) => void
  splitPane: (direction: 'row' | 'column', options?: { fromPaneId?: string; noteId?: string }) => void
  closePane: (paneId: string) => void
  swapPanes: (sourcePaneId: string, targetPaneId: string) => void
  focusPane: (paneId: string) => void
  updateLayout: (layout: MosaicNode<string>) => void

  // Pane 辅助
  getPaneNoteId: (paneId: string) => string | null

  // 辅助
  isNoteOpenInAnyTab: (noteId: string) => boolean
  getOpenNoteIds: () => string[]
  getTabDisplayTitle: (tab: Tab, getNoteTitle: (id: string) => string) => string
}
```

---

## 持久化 (localStorage)

| Key | 内容 |
|-----|------|
| `sanqian_notes_tabs_v2` | Tab[] 列表 (v2 格式，包含 panes 映射) |
| `sanqian_notes_active_tab` | 当前激活的 tabId |
| `sanqian_notes_layout_percentages` | { tabId: { nodeKey: percentage } } 分屏比例 |

**数据迁移**: 自动检测旧格式 (`sanqian_notes_tabs`) 并迁移到 v2 格式

---

## 文件结构

### 新增

```
src/renderer/src/
├── contexts/
│   └── TabContext.tsx          Tab 状态管理
├── components/
│   ├── TabBar.tsx              顶部标签栏
│   ├── TabItem.tsx             单个标签 (可拖拽排序)
│   ├── PaneLayout.tsx          分屏布局容器
│   └── PaneWrapper.tsx         单个 Pane 包装 (控制按钮)
└── utils/
    └── layoutUtils.ts          布局计算函数
```

### 改动

| 文件 | 改动 |
|------|------|
| `App.tsx` | 集成 TabProvider，移除 selectedNoteIds |
| `Editor.tsx` | 接收 noteId + isFocused |
| `NoteList.tsx` | 点击笔记调用 openNoteInPane |

---

## 依赖

```bash
npm install react-mosaic-component react-dnd react-dnd-html5-backend @dnd-kit/core @dnd-kit/sortable
```

- `react-mosaic-component`: 分屏大小调整
- `react-dnd`: Pane 拖拽交换
- `@dnd-kit`: TabBar 标签拖拽排序

---

## 交互

### Tab 操作
- 单击 Tab: 切换工作区
- 中键点击: 关闭
- 拖拽: 重新排序
- 右键: 关闭 / 关闭其他 / 固定

### NoteList 操作
- 单击笔记: 在焦点 pane 打开
- Cmd+点击: 新建 Tab 打开

### Pane 控制按钮 (hover 左上角)
- `[×]` 关闭 pane
- `[⫿]` 水平分屏 (Split Right)
- `[⫰]` 垂直分屏 (Split Down)
- `[⠿]` 拖拽交换位置

### 快捷键
- `Cmd+T`: 新建 Tab
- `Cmd+W`: 关闭当前 Tab
- `Cmd+\`: 水平分屏
- `Cmd+Shift+\`: 垂直分屏
- `Cmd+1/2/3...`: 切换到第 N 个 Tab

---

## 实现阶段

### Phase 1: TabContext + TabBar
- 创建 TabContext 管理状态
- 实现 TabBar 组件 (无分屏，每个 Tab 显示一个笔记)
- 集成到 App.tsx
- localStorage 持久化

### Phase 2: Split View
- 集成 react-mosaic-component
- 实现 PaneLayout + PaneWrapper
- Pane 控制按钮 (split/close)
- 拖拽调整分屏大小

### Phase 3: 拖拽交换
- 集成 react-dnd
- Pane 拖拽交换
- TabBar 标签拖拽排序

### Phase 4: 快捷键 + 完善
- 键盘快捷键
- Tab 右键菜单
- 边界情况处理

---

## 影响分析

### App.tsx (核心改动)

| 现状 | 改造 |
|------|------|
| `selectedNoteIds: string[]` | 移除，改用 TabContext |
| `selectedNoteId` (派生) | 改用 `activeTab.focusedNoteId` |
| `handleSelectNote()` | 改为 `openNoteInPane()` |
| `scrollTarget` 状态 | 移到 TabContext 或 PaneWrapper |
| `deleteEmptyNoteIfNeeded()` | 需适配多 pane 场景 |

**Context 同步** (`handleSelectionChange`):
- 现在同步当前笔记的选区
- 改为只同步焦点 pane 的信息

### Editor.tsx

| 现状 | 改造 |
|------|------|
| 接收 `note: Note \| null` | 接收 `noteId: string` + `isFocused: boolean` |
| 内部加载笔记数据 | 从 notes 列表获取，或者保持传入 note |
| 顶部标题栏 | 保留，Pane 控制按钮独立在 PaneWrapper |

**多实例问题**:
- 同一笔记可能在多个 pane 打开
- `onUpdate` 需要广播到所有打开该笔记的 pane

### NoteList.tsx

| 现状 | 改造 |
|------|------|
| `selectedNoteIds` 高亮 | 保留，用于批量操作的多选状态 |
| 单击 | 在焦点 pane 打开 + 设为单选 |
| Cmd+Click | 保持不变，追加/取消选中 |
| Shift+Click | 保持不变，范围选中 |
| 右键批量操作 | 保持不变 |

**高亮逻辑变化**：
- 焦点 pane 的笔记 → 主高亮（深色背景）
- 其他选中笔记 → 淡色高亮（浅色背景）

### TypewriterMode.tsx

- 全屏覆盖编辑区
- 只作用于焦点 pane 的笔记
- 退出时恢复到对应 pane

### 其他受影响文件

| 文件 | 影响 |
|------|------|
| `DailyView.tsx` | `onSelectNote` 改为 `openNoteInPane` |
| `Sidebar.tsx` | 拖拽笔记到侧边栏可能需要调整 |
| `NoteLink.ts` | `onNoteClick` 保持不变，由 TabContext 处理 |
| `TransclusionBlock.ts` | 同上 |
| `NoteLinkPopup.tsx` | 同上 |

### 需要特别注意

1. **笔记内容同步**: 同一笔记在多个 pane 打开时，编辑需要实时同步
2. **空笔记清理**: 只有当笔记不在任何 Tab 中时才清理
3. **localStorage 迁移**: 旧的 `selectedNoteIds` 需要兼容迁移到新的 tabs 结构
4. **AI Context**: 确保 `window.electron.context.sync()` 只同步焦点 pane
5. **性能**: 多个 Editor 实例可能增加内存占用，考虑懒加载非焦点 pane

---

## 实现进度

### 2026-01-09: Phase 1 + Phase 2 基础完成

**已完成**:
- [x] 依赖安装 (react-mosaic-component, react-dnd, @dnd-kit)
- [x] `TabContext.tsx` - Tab 状态管理 + localStorage 持久化
- [x] `TabBar.tsx` - 顶部标签栏 (切换/关闭/固定/右键菜单)
- [x] `PaneLayout.tsx` - 分屏布局 (react-mosaic 集成)
- [x] `App.tsx` 集成 - TabProvider + TabBar + PaneLayout
- [x] 翻译支持 (tabBar, paneControls)
- [x] react-mosaic CSS 样式适配

### 2026-01-09: v2 架构重构 (paneId + noteId 分离)

- [x] 数据结构升级: layout 存储 paneId，panes 映射 noteId
- [x] 数据迁移: 自动检测并迁移旧格式
- [x] 支持同一笔记在多个 pane 打开

### 2026-01-09: Phase 3 完成

- [x] TabBar 拖拽排序 (@dnd-kit/sortable)
- [x] 快捷键 (Cmd+T/W/\/Shift+\)

### 2026-01-10: 性能优化

- [x] `closeTabs()` 批量关闭方法，避免多次状态更新
- [x] `Select` 组件视口边界检测，自动向上展开

**待完成**:
- [ ] Pane 拖拽交换 (react-dnd)
- [ ] Cmd+Click 在新 Tab 打开
- [ ] NoteList 高亮逻辑优化 (焦点 pane vs 选中)
