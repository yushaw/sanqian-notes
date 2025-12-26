/**
 * 共享类型定义
 *
 * 这些类型在 main、preload、renderer 进程之间共享
 * 确保类型定义的一致性
 */

/**
 * 附件保存结果
 */
export interface AttachmentResult {
  /** 相对于 userData 的路径，使用正斜杠 */
  relativePath: string
  /** 完整的文件系统路径 */
  fullPath: string
  /** 原始文件名 */
  name: string
  /** 文件大小（字节） */
  size: number
  /** MIME 类型 */
  type: string
}

/**
 * 附件选择对话框选项
 */
export interface AttachmentSelectOptions {
  filters?: { name: string; extensions: string[] }[]
  multiple?: boolean
}

/**
 * 附件 API 接口
 */
export interface AttachmentAPI {
  save: (filePath: string) => Promise<AttachmentResult>
  saveBuffer: (buffer: Uint8Array, ext: string, name?: string) => Promise<AttachmentResult>
  delete: (relativePath: string) => Promise<boolean>
  open: (relativePath: string) => Promise<void>
  /** 在 Finder/资源管理器中显示文件 */
  showInFolder: (relativePath: string) => Promise<void>
  selectFiles: (options?: AttachmentSelectOptions) => Promise<string[] | null>
  selectImages: () => Promise<string[] | null>
  getFullPath: (relativePath: string) => Promise<string>
  exists: (relativePath: string) => Promise<boolean>
  /** 获取所有附件文件路径 */
  getAll: () => Promise<string[]>
  /** 清理孤儿附件文件，返回删除的文件数量 */
  cleanup: () => Promise<number>
}

/**
 * Chat API 相关类型定义
 */

/** Chat API 消息格式 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

/** Chat API 流式事件 */
export type ChatStreamEvent =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | {
      type: 'tool_call'
      tool_call: {
        id: string
        type: 'function'
        function: {
          name: string
          arguments: string
        }
      }
    }
  | { type: 'tool_result'; tool_call_id: string; result: unknown }
  | { type: 'done'; conversationId: string; title?: string }
  | { type: 'error'; error: string; code?: string; errorCode?: string; errorName?: string }
  | {
      type: 'interrupt'
      interrupt_type: string
      interrupt_payload: unknown
      run_id?: string
    }

/** 对话信息（列表） */
export interface ConversationInfo {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount?: number
}

/** 对话详情（包含消息） */
export interface ConversationDetail {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messages: Array<{
    id: string
    role: 'user' | 'assistant' | 'system'
    content: string
    timestamp: string
  }>
}

/**
 * AI Action 相关类型定义
 */

/** AI Action 模式 */
export type AIActionMode = 'replace' | 'insert' | 'popup'

/** AI Action 完整类型 */
export interface AIAction {
  id: string
  name: string
  description: string
  icon: string
  prompt: string
  mode: AIActionMode
  showInContextMenu: boolean
  showInSlashCommand: boolean
  showInShortcut: boolean
  shortcutKey: string
  orderIndex: number
  isBuiltin: boolean
  enabled: boolean
  createdAt: string
  updatedAt: string
}

/** AI Action 创建/更新输入类型 */
export interface AIActionInput {
  name: string
  description?: string
  icon: string
  prompt: string
  mode: AIActionMode
  showInContextMenu?: boolean
  showInSlashCommand?: boolean
  showInShortcut?: boolean
  shortcutKey?: string
}

/** AI Action API 接口 */
export interface AIActionAPI {
  getAll: () => Promise<AIAction[]>
  getAllIncludingDisabled: () => Promise<AIAction[]>
  create: (input: AIActionInput) => Promise<AIAction>
  update: (id: string, updates: Partial<AIActionInput> & { enabled?: boolean }) => Promise<AIAction | null>
  delete: (id: string) => Promise<boolean>
  reorder: (orderedIds: string[]) => Promise<void>
  reset: () => Promise<void>
}

/** Chat API 接口 */
export interface ChatAPI {
  /** 连接到 Chat 服务 */
  connect: () => Promise<{ success: boolean; error?: string }>
  /** 断开连接 */
  disconnect: () => Promise<{ success: boolean; error?: string }>
  /** 获取/增加重连引用计数 */
  acquireReconnect: () => Promise<void>
  /** 释放/减少重连引用计数 */
  releaseReconnect: () => Promise<void>
  /** 发送消息并流式接收响应 */
  stream: (params: {
    streamId: string
    messages: ChatMessage[]
    conversationId?: string
    agentId?: string
  }) => Promise<{ success: boolean; error?: string; errorCode?: string; errorName?: string }>
  /** 取消流式响应 */
  cancelStream: (params: { streamId: string }) => Promise<{ success: boolean; error?: string }>
  /** 获取对话列表 */
  listConversations: (params: {
    limit?: number
    offset?: number
    agentId?: string
  }) => Promise<{
    success: boolean
    data?: { conversations: ConversationInfo[]; total: number }
    error?: string
  }>
  /** 获取对话详情 */
  getConversation: (params: {
    conversationId: string
    messageLimit?: number
  }) => Promise<{ success: boolean; data?: ConversationDetail; error?: string }>
  /** 删除对话 */
  deleteConversation: (params: { conversationId: string }) => Promise<{ success: boolean; error?: string }>
  /** 发送 HITL 响应 */
  sendHitlResponse: (params: { response: unknown; runId?: string }) => void
  /** 监听连接状态变化 */
  onStatusChange: (callback: (status: string, error?: string, errorCode?: string) => void) => void
  /** 监听流式事件 */
  onStreamEvent: (callback: (streamId: string, event: ChatStreamEvent) => void) => void
}
