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
interface Tab {
  id: string                           // tab_xxx
  layout: MosaicNode<string> | string  // noteId 的布局树
  focusedNoteId: string | null         // 当前焦点 pane
  isPinned?: boolean
  createdAt: number
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
- 单个笔记: `"note_abc123"`
- 左右分屏: `{ direction: 'row', first: 'note_a', second: 'note_b', splitPercentage: 50 }`

---

## 状态管理 (TabContext)

```typescript
interface TabContextValue {
  // 状态
  tabs: Tab[]
  activeTabId: string | null
  activeTab: Tab | null
  focusedNoteId: string | null

  // Tab 操作
  createTab: (noteId?: string) => string
  closeTab: (tabId: string) => void
  selectTab: (tabId: string) => void
  pinTab: (tabId: string) => void
  unpinTab: (tabId: string) => void

  // Pane 操作 (在当前 Tab 内)
  openNoteInPane: (noteId: string) => void
  splitPane: (direction: 'row' | 'column') => void
  closePane: (noteId: string) => void
  swapPanes: (sourceId: string, targetId: string) => void
  focusPane: (noteId: string) => void
  updateLayout: (layout: MosaicNode<string>) => void
}
```

---

## 持久化 (localStorage)

| Key | 内容 |
|-----|------|
| `sanqian_notes_tabs` | Tab[] 列表 |
| `sanqian_notes_active_tab` | 当前激活的 tabId |
| `sanqian_notes_tab_focus` | { tabId: noteId } 焦点缓存 |
| `sanqian_notes_layout_percentages` | { tabId: { nodeKey: percentage } } 分屏比例 |

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
