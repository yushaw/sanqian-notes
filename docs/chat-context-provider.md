# Chat Context Provider 设计文档

## 概述

为 sanqian-chat SDK 设计一个通用的上下文注入机制，让应用层可以向 AI 对话中注入当前状态信息（如当前打开的文档、选中的文本等），同时保持 SDK 的通用性。

## 设计目标

1. **通用性**：SDK 不关心具体是什么上下文（笔记、文件、选中文本等）
2. **可控性**：用户可以选择是否附加上下文，以及附加哪个上下文
3. **易用性**：常见场景（如选中文本触发）自动带上下文
4. **可扩展**：支持 @mention 自动完成等高级功能

## 架构分层

```
┌─────────────────────────────────────────────────────────────┐
│  应用层 (Notes)                                              │
│  ├── 实现 ContextProvider 接口                               │
│  ├── 提供可用上下文列表（笔记列表）                            │
│  ├── 解析 @mention（@当前笔记 → noteId → content）            │
│  └── 决定何时自动附加上下文                                   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Chat SDK (sanqian-chat)                                     │
│  ├── 定义 ChatContext / ContextProvider 接口                 │
│  ├── 提供 UI 组件（附件按钮、上下文预览、@mention 输入）       │
│  ├── 管理 attachedContext 状态                               │
│  └── 发送时自动注入 system message                           │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Sanqian SDK                                                 │
│  └── chatStream(agentId, messages) - messages 包含注入的上下文│
└─────────────────────────────────────────────────────────────┘
```

## 核心接口定义

### 1. ChatContext（上下文数据）

```typescript
/**
 * 通用的上下文数据结构
 * SDK 不关心具体类型，只负责传递和显示
 */
interface ChatContext {
  /** 唯一标识符 */
  id: string

  /** 上下文类型，用于 UI 显示图标等 */
  type: 'note' | 'selection' | 'file' | 'webpage' | string

  /** 显示标题 */
  title: string

  /** 实际内容（将注入到 system message） */
  content: string

  /** 内容摘要（用于 UI 预览，可选） */
  summary?: string

  /** 应用自定义元数据 */
  metadata?: Record<string, unknown>
}
```

### 2. ContextProvider（上下文提供者）

```typescript
/**
 * 应用层实现此接口，提供上下文获取能力
 */
interface ContextProvider {
  /**
   * 获取当前上下文
   * 用于"附加当前笔记"等场景
   * 返回 null 表示当前没有可用上下文
   */
  getCurrent?: () => Promise<ChatContext | null>

  /**
   * 搜索可用上下文
   * 用于 @mention 自动完成
   * @param query 搜索关键词
   * @param limit 最大返回数量
   */
  search?: (query: string, limit?: number) => Promise<ChatContext[]>

  /**
   * 根据 ID 解析完整上下文
   * 用于从 @mention 解析到完整内容
   * @param id 上下文 ID
   */
  resolve?: (id: string) => Promise<ChatContext | null>

  /**
   * 获取快捷上下文列表
   * 用于下拉菜单快速选择（如最近的笔记）
   * @param limit 最大返回数量
   */
  getRecent?: (limit?: number) => Promise<ChatContext[]>
}
```

### 3. FloatingWindowOptions 扩展

```typescript
interface FloatingWindowOptions {
  // ... 现有配置

  /**
   * 上下文提供者
   * 应用层实现，SDK 通过此接口获取上下文
   */
  contextProvider?: ContextProvider

  /**
   * 上下文注入模板
   * 默认: "用户附加了以下上下文:\n\n{title}\n---\n{content}\n---"
   */
  contextTemplate?: string
}
```

### 4. CompactChat Props 扩展

```typescript
interface CompactChatProps {
  // ... 现有 props

  /**
   * 是否启用上下文功能
   * 需要 contextProvider 配合
   */
  enableContext?: boolean

  /**
   * 当前附加的上下文（受控模式）
   */
  attachedContext?: ChatContext | null

  /**
   * 上下文变化回调
   */
  onContextChange?: (context: ChatContext | null) => void

  /**
   * 初始上下文（非受控模式）
   * 用于 showWithContext 场景
   */
  initialContext?: ChatContext
}
```

## 数据流

### 场景 1：用户手动附加上下文

```
1. 用户点击 📎 按钮
2. SDK 调用 contextProvider.getCurrent() 或显示选择菜单
3. 应用层返回 ChatContext
4. SDK 更新 attachedContext 状态，UI 显示预览
5. 用户发送消息
6. SDK 将 context.content 注入为 system message
7. 调用 sdk.chatStream(agentId, [systemMsg, ...userMsgs])
```

### 场景 2：选中文本自动带上下文

```
1. 用户在编辑器中选中文本，点击"询问 AI"
2. Notes 调用 floatingWindow.showWithContext(context)
3. SDK 设置 initialContext，UI 显示预览
4. 用户可选择移除或保留上下文
5. 发送时自动注入
```

### 场景 3：@mention 引用

```
1. 用户输入 "@"
2. SDK 显示自动完成菜单
3. SDK 调用 contextProvider.search(query)
4. 用户选择一个选项
5. SDK 调用 contextProvider.resolve(id) 获取完整内容
6. 添加到 attachedContext
```

## UI 设计

### 输入框布局

```
┌─────────────────────────────────────────────────────────────┐
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 📄 当前笔记：项目计划.md                           [×] │ │  ← 上下文预览（可移除）
│ └─────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ [📎] 输入消息...                              [发送 ➤] │ │  ← 输入框 + 附件按钮
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 📎 按钮菜单

```
┌────────────────────────┐
│ 📄 当前笔记            │  ← getCurrent()
│ ─────────────────────  │
│ 📄 最近：会议纪要.md   │  ← getRecent()
│ 📄 最近：读书笔记.md   │
│ ─────────────────────  │
│ 🔍 搜索笔记...         │  ← 打开搜索面板
└────────────────────────┘
```

### 上下文预览组件

```typescript
interface ContextPreviewProps {
  context: ChatContext
  onRemove: () => void
  maxLength?: number  // 内容预览最大长度
}

// 显示：图标 + 标题 + 摘要预览 + 删除按钮
```

## 消息注入实现

```typescript
// FloatingWindow.ts 内部

function buildMessagesWithContext(
  messages: ChatMessage[],
  context: ChatContext | null,
  template: string
): ChatMessage[] {
  if (!context) return messages

  const systemContent = template
    .replace('{title}', context.title)
    .replace('{content}', context.content)
    .replace('{type}', context.type)

  const systemMessage: ChatMessage = {
    role: 'system',
    content: systemContent
  }

  return [systemMessage, ...messages]
}

// 默认模板
const DEFAULT_CONTEXT_TEMPLATE = `用户附加了以下参考内容：

**{title}**
---
{content}
---

请在回答时参考以上内容。`
```

## IPC 通信

### 新增 IPC 事件

```typescript
// Main → Renderer
'sanqian-chat:setContext'      // 设置初始上下文

// Renderer → Main
'sanqian-chat:getContext'      // 获取当前上下文 (调用 provider.getCurrent)
'sanqian-chat:searchContext'   // 搜索上下文 (调用 provider.search)
'sanqian-chat:resolveContext'  // 解析上下文 (调用 provider.resolve)
'sanqian-chat:getRecentContext' // 获取最近上下文 (调用 provider.getRecent)
```

### FloatingWindow IPC Handler

```typescript
// FloatingWindow.ts

ipcMain.handle('sanqian-chat:getContext', async () => {
  return activeInstance?.options.contextProvider?.getCurrent?.() ?? null
})

ipcMain.handle('sanqian-chat:searchContext', async (_, query: string, limit?: number) => {
  return activeInstance?.options.contextProvider?.search?.(query, limit) ?? []
})

// ... 其他 handler
```

## Notes 应用层实现示例

### 1. 定义 ContextProvider

```typescript
// src/main/context-provider.ts

import { ContextProvider, ChatContext } from '@yushaw/sanqian-chat'
import { searchNotes, getNote, getRecentNotes } from './database'
import { mainWindow } from './index'

export function createNotesContextProvider(): ContextProvider {
  return {
    async getCurrent(): Promise<ChatContext | null> {
      // 从 renderer 获取当前打开的笔记
      const currentNote = await mainWindow?.webContents.invoke('getCurrentNote')
      if (!currentNote) return null

      return {
        id: currentNote.id,
        type: 'note',
        title: currentNote.title,
        content: currentNote.content,
        summary: currentNote.content.slice(0, 200) + '...'
      }
    },

    async search(query: string, limit = 10): Promise<ChatContext[]> {
      const notes = await searchNotes(query, limit)
      return notes.map(note => ({
        id: note.id,
        type: 'note',
        title: note.title,
        content: note.content,
        summary: note.content.slice(0, 100) + '...'
      }))
    },

    async resolve(id: string): Promise<ChatContext | null> {
      const note = await getNote(id)
      if (!note) return null

      return {
        id: note.id,
        type: 'note',
        title: note.title,
        content: note.content
      }
    },

    async getRecent(limit = 5): Promise<ChatContext[]> {
      const notes = await getRecentNotes(limit)
      return notes.map(note => ({
        id: note.id,
        type: 'note',
        title: note.title,
        content: note.content,
        summary: note.content.slice(0, 100) + '...'
      }))
    }
  }
}
```

### 2. 注册到 FloatingWindow

```typescript
// src/main/index.ts

import { createNotesContextProvider } from './context-provider'

floatingChatWindow = new FloatingWindow({
  // ... 其他配置
  contextProvider: createNotesContextProvider(),
  contextTemplate: `当前笔记内容：

**{title}**
---
{content}
---

请基于以上笔记内容回答用户问题。`
})
```

### 3. 从编辑器触发带上下文

```typescript
// src/renderer/components/Editor.tsx

const handleAskAI = () => {
  const selection = editor.state.selection
  const selectedText = editor.state.doc.textBetween(selection.from, selection.to)

  // 构造上下文
  const context: ChatContext = {
    id: `selection-${Date.now()}`,
    type: 'selection',
    title: `选中内容 - ${currentNote.title}`,
    content: selectedText
  }

  // 打开 chat 并附加上下文
  window.electron.chatWindow.showWithContext(context)
}
```

## 实现阶段

### Phase 1：基础功能
- [ ] 定义 ChatContext, ContextProvider 接口
- [ ] FloatingWindow 支持 contextProvider 配置
- [ ] 实现消息注入逻辑
- [ ] showWithContext 支持传递 ChatContext

### Phase 2：UI 组件
- [ ] ContextPreview 组件（显示已附加的上下文）
- [ ] 📎 按钮和菜单
- [ ] 上下文移除功能

### Phase 3：高级功能
- [ ] @mention 自动完成
- [ ] 搜索面板
- [ ] 多上下文支持（附加多个笔记）

## 注意事项

1. **内容大小限制**：context.content 可能很长，需要考虑 token 限制，可能需要截断或摘要
2. **隐私安全**：确保上下文内容不会泄露到不该去的地方
3. **性能**：search 和 resolve 应该是异步的，避免阻塞 UI
4. **用户体验**：上下文预览要清晰，让用户知道发送了什么内容给 AI
