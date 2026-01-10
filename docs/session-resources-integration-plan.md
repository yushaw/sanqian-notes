# Session Resources 集成计划

## 需求概述

在 sanqian-notes 中集成 Session Resources 功能，实现：

1. **实时上下文同步**：划选文本时自动推送到 Chat（如果 Chat 打开）
2. **右键 "Ask AI"**：划选后右键菜单提供入口，打开 Chat 并带上选中内容

## 现有架构分析

### 1. AI Context 系统 (`src/renderer/src/utils/aiContext.ts`)

已有完善的上下文提取：

```typescript
interface AIContext {
  target: string           // 选中的纯文本
  targetMarkdown: string   // 带 Markdown 格式的文本
  targetFrom: number       // 选区起始位置
  targetTo: number         // 选区结束位置
  before: string           // 前 200 字符上下文
  after: string            // 后 200 字符上下文
  blocks?: BlockInfo[]     // 跨块选择时的块信息
  isCrossBlock: boolean    // 是否跨块
}
```

**可复用**：`getAIContext(editor, documentTitle)` 函数

### 2. 选择状态同步 (`src/renderer/src/App.tsx`)

已有选择变化监听和同步：

```typescript
useEffect(() => {
  window.electron.context.sync({
    currentNoteId,
    currentNoteTitle,
    selectedText,        // ← 已有选中文本
    cursorContext,
    // ...
  })
}, [selectedText, ...])
```

**关联点**：可在此处添加 Session Resources 推送逻辑

### 3. Chat 集成 (`src/main/index.ts`)

已有 ChatPanel 和上下文传递：

```typescript
const chatPanel = new ChatPanel({
  getClient: () => getClient(),  // SDK 实例
  // ...
})

// 已有 showWithContext
ipcMain.handle('chatWindow:showWithContext', (_, context) => {
  chatPanel.show()
  webContents.send('chatWindow:setContext', context)
})
```

**关联点**：
- `getClient()` 返回 SDK 实例，可用于 `pushResource`
- 需要添加 Chat 可见性查询和监听

### 4. 右键菜单 (`src/renderer/src/components/EditorContextMenu.tsx`)

已有 AI Actions 子菜单结构：

```typescript
<ContextMenuSub>
  <ContextMenuSubTrigger>
    <Sparkles /> AI Actions
  </ContextMenuSubTrigger>
  <ContextMenuSubContent>
    {/* 动态加载的 AI 操作 */}
  </ContextMenuSubContent>
</ContextMenuSub>
```

**侵入点**：添加顶级 "Ask AI" 菜单项

### 5. SDK 实例 (`src/main/index.ts`)

已有 SDK 初始化：

```typescript
import { SanqianSDK } from '@yushaw/sanqian-sdk'

let client: SanqianSDK | null = null

function getClient() {
  return client
}
```

**关联点**：可直接使用 `client.pushResource()` / `client.removeResource()`

## 实现方案

### 方案一：主进程管理 Session Resources（推荐）

```
┌─────────────────────────────────────────────────────────────┐
│  渲染进程 (App.tsx)                                          │
│    │                                                         │
│    ├─ 选择变化 → IPC: context:sync                           │
│    │                                                         │
│    └─ 右键 Ask AI → IPC: chatWindow:showWithContext          │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  主进程 (index.ts)                                           │
│    │                                                         │
│    ├─ 监听 context:sync                                      │
│    │     ├─ 更新 userContext                                 │
│    │     └─ 如果 Chat 可见 && selectedText 变化              │
│    │           → sdk.pushResource() 或 removeResource()      │
│    │                                                         │
│    ├─ 监听 ChatPanel 显示/隐藏事件                           │
│    │     ├─ 显示时：如果有 selectedText → pushResource()     │
│    │     └─ 隐藏时：removeResource()                         │
│    │                                                         │
│    └─ chatWindow:showWithContext                             │
│          → 设置输入框文本（用户主动触发，不自动发送）          │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  Sanqian Backend                                             │
│    │                                                         │
│    └─ Session Resources Store                                │
│          → Chat UI 显示 chip                                 │
│          → LLM 对话时注入上下文                               │
└─────────────────────────────────────────────────────────────┘
```

**优点**：
- 渲染进程改动最小
- 逻辑集中在主进程
- 与现有 context:sync 流程融合

### Session Resource 内容格式

复用 `aiContext.ts` 的格式思路：

```typescript
const resource = {
  id: 'editor-selection',  // 固定 ID，确保只有一个选区资源
  title: `选中内容 - ${noteTitle}`,
  content: `<selection>
<note title="${noteTitle}">
<context_before>${before}</context_before>
<selected>${targetMarkdown}</selected>
<context_after>${after}</context_after>
</note>
</selection>`,
  summary: `${target.slice(0, 50)}...`,
  icon: '📝',
  type: 'selection',
}
```

## 修改点清单

### 1. 主进程 (`src/main/index.ts`)

| 修改 | 说明 |
|------|------|
| 添加 Session Resource 状态 | `let currentSelectionResourceId: string \| null = null` |
| 添加 `pushSelectionResource()` | 格式化选区内容并推送 |
| 添加 `removeSelectionResource()` | 移除选区资源 |
| 修改 `context:sync` handler | 检测 selectedText 变化，触发推送/移除 |
| 监听 ChatPanel 显示/隐藏 | 显示时推送当前选区，隐藏时清理 |
| 添加 `chatWindow:isVisible` IPC | 供渲染进程查询 Chat 状态 |

### 2. 渲染进程 - 右键菜单 (`src/renderer/src/components/EditorContextMenu.tsx`)

| 修改 | 说明 |
|------|------|
| 添加 "Ask AI" 菜单项 | 在 AI Actions 子菜单之前或之后 |
| 点击处理 | 调用 `openChatWithContext(selectedText)` |

### 3. IPC 定义 (`src/renderer/src/env.d.ts`)

| 修改 | 说明 |
|------|------|
| 添加 `chatWindow.isVisible` | `() => Promise<boolean>` |

### 4. 可选优化

| 修改 | 说明 |
|------|------|
| 添加快捷键 | `⌘⇧A` 打开 Chat 带选区 |
| 添加防抖 | 选区变化时防抖推送（避免频繁更新） |
| 添加 Chat 内显示优化 | Session Resource chip 显示更友好的标题 |

## 数据流详解

### 场景 1：Chat 已打开，用户划选文本

```
1. 用户在编辑器划选文本
2. App.tsx 监听到选择变化
3. 调用 window.electron.context.sync({ selectedText, ... })
4. 主进程 context:sync handler 收到
5. 检测到 selectedText 变化 && chatPanel.isVisible()
6. 调用 pushSelectionResource(selectedText, noteTitle, before, after)
7. SDK pushResource() → Backend Store
8. Chat UI 显示 chip
9. 用户在 Chat 中提问，LLM 可见选区上下文
```

### 场景 2：用户取消选择

```
1. 用户点击其他位置，取消选择
2. App.tsx 监听到 selectedText = null
3. 调用 window.electron.context.sync({ selectedText: null })
4. 主进程检测到 selectedText 变为空
5. 调用 removeSelectionResource()
6. SDK removeResource() → Backend Store
7. Chat UI chip 消失
```

### 场景 3：右键 "Ask AI"

```
1. 用户划选文本
2. 右键点击 → 菜单显示 "Ask AI"
3. 点击 "Ask AI"
4. 调用 openChatWithContext(selectedText)
5. 主进程 chatWindow:showWithContext
6. ChatPanel.show() → 触发 onShow 回调
7. pushSelectionResource() 推送选区
8. 发送 setContext 事件给 Chat 窗口
9. Chat 输入框聚焦，等待用户输入问题
```

### 场景 4：关闭 Chat

```
1. 用户关闭 Chat 或切换到其他应用
2. ChatPanel onHide 回调触发
3. 调用 removeSelectionResource()
4. 清理选区资源
```

## 边界情况处理

| 情况 | 处理 |
|------|------|
| 选区太大（>100KB） | 截断内容，添加 `[内容已截断]` 提示 |
| 快速切换选区 | 防抖处理，300ms 内只推送最后一次 |
| Chat 未连接 | 跳过推送，等待连接后再处理 |
| 切换笔记 | 自动清理旧选区资源 |
| 跨块选择 | 使用 `blocks` 信息，保留结构 |

## TODO 清单

### Phase 1: 核心功能 ✅

- [x] **主进程: Session Resource 管理**
  - [x] 添加 `currentSelectionResourceId` 状态
  - [x] 实现 `pushSelectionResource(context)` 函数
  - [x] 实现 `removeSelectionResource()` 函数
  - [x] 实现 `formatSelectionContent(context)` 格式化函数

- [x] **主进程: context:sync 集成**
  - [x] 修改 handler，检测 selectedText 变化
  - [x] 添加 Chat 可见性检查
  - [x] 触发 push/remove 逻辑
  - [x] 添加防抖处理 (300ms)

- [x] **主进程: ChatPanel 生命周期**
  - [x] 监听 ChatPanel show/hide 事件 (via `onLayoutChange`)
  - [x] 显示时推送当前选区
  - [x] 隐藏时清理选区资源

- [x] **右键菜单: Ask AI**
  - [x] 在 EditorContextMenu 添加 "Ask AI" 菜单项
  - [x] 实现点击处理，调用 `openChatWithContext`

### Phase 2: 优化体验 ✅

- [x] **快捷键支持**
  - [x] 添加 `⌘⇧A` / `Ctrl+Shift+A` 快捷键
  - [x] 绑定到 Ask AI 功能

- [x] **IPC 接口完善**
  - [x] 使用 `chatPanel.isVisible()` 检查可见性
  - [x] 使用 `onLayoutChange` 回调监听可见性变化

- [x] **错误处理**
  - [x] SDK 方法不存在时的运行时检查
  - [x] 推送失败时静默处理（console.warn）

### Phase 3: 测试验证

- [ ] 测试选区推送/更新/移除
- [ ] 测试 Chat 显示/隐藏时的资源管理
- [ ] 测试右键 Ask AI 流程
- [ ] 测试边界情况（大选区、快速切换等）

## 预估工作量

| 阶段 | 预估 |
|------|------|
| Phase 1 | 2-3 小时 |
| Phase 2 | 1-2 小时 |
| Phase 3 | 1 小时 |
| **总计** | **4-6 小时** |

## 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| 频繁推送影响性能 | 防抖 300ms，固定 resourceId 避免累积 |
| Chat 未打开时浪费推送 | 先检查 isVisible，未打开则跳过 |
| 大选区导致内存问题 | 限制 100KB，超出截断 |
| SDK 连接断开 | 捕获异常，静默失败，不影响主功能 |
