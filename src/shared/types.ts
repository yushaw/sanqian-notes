/**
 * 共享类型定义
 *
 * 这些类型在 main、preload、renderer 进程之间共享
 * 确保类型定义的一致性
 */

// ============ Note Types ============

export interface Tag {
  id: string
  name: string
}

export interface TagWithSource extends Tag {
  source: 'user' | 'ai'
}

export interface Note {
  id: string
  title: string
  content: string // JSON string from BlockNote
  notebook_id: string | null
  is_daily: boolean
  daily_date: string | null // YYYY-MM-DD format
  is_favorite: boolean
  is_pinned: boolean
  created_at: string
  updated_at: string
  deleted_at: string | null // Soft delete timestamp (trash)
  ai_summary: string | null // AI-generated summary
  tags: TagWithSource[] // Tags with source (user/ai)
}

export interface NoteInput {
  title: string
  content: string
  notebook_id?: string | null
  is_daily?: boolean
  daily_date?: string | null
  is_favorite?: boolean
  is_pinned?: boolean
}

export interface Notebook {
  id: string
  name: string
  icon?: string // logo:notes, logo:todolist, logo:sanqian, logo:yinian, or emoji
  order_index: number
  created_at: string
}

export interface NotebookInput {
  name: string
  icon?: string
}

export interface NoteTag {
  note_id: string
  tag_id: string
}

export interface NoteLink {
  source_note_id: string
  target_note_id: string
}

export type SmartViewId = 'all' | 'daily' | 'recent' | 'favorites' | 'trash'

/** "最近" 视图的天数阈值 */
export const RECENT_DAYS = 7

/**
 * 笔记搜索过滤选项
 * 用于在搜索时根据当前视图过滤结果
 */
export interface NoteSearchFilter {
  /** 笔记本 ID（仅搜索该笔记本内的笔记） */
  notebookId?: string
  /** 智能视图类型 */
  viewType?: SmartViewId
}

// ============ Attachment Types ============

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

/**
 * AI Popup 相关类型定义
 */

/** AI Popup 数据 */
export interface PopupData {
  id: string
  content: string
  prompt: string
  actionName: string
  targetText: string
  documentTitle: string
  createdAt: string
  updatedAt: string
}

/** AI Popup 创建输入 */
export interface PopupInput {
  id: string
  prompt: string
  actionName?: string
  targetText: string
  documentTitle?: string
}

/** AI Popup API 接口 */
export interface PopupAPI {
  get: (id: string) => Promise<PopupData | null>
  create: (input: PopupInput) => Promise<PopupData>
  updateContent: (id: string, content: string) => Promise<boolean>
  delete: (id: string) => Promise<boolean>
  cleanup: (maxAgeDays?: number) => Promise<number>
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

// ============ Theme Types ============

/** 字体大小选项 */
export type FontSize = 'small' | 'normal' | 'large' | 'extra-large'

/** 主题设置（用于 main window 和 chat window 同步） */
export interface ThemeSettings {
  colorMode: 'light' | 'dark'
  accentColor: string
  locale: 'en' | 'zh'
  fontSize?: FontSize
}

/** Theme API 扩展（sanqian-notes 特有，用于 chat window） */
export interface ThemeAPI {
  getThemeSettings(): Promise<ThemeSettings>
  onThemeUpdated(callback: (settings: ThemeSettings) => void): () => void
}

// ============ Agent Task Types ============

/** Agent Task 状态 */
export type AgentTaskStatus = 'idle' | 'running' | 'completed' | 'failed'

/** Agent 模式 */
export type AgentMode = 'auto' | 'specified'

/** Agent Task 处理模式 */
export type AgentTaskProcessMode = 'append' | 'replace'

/** Agent Task 输出格式 */
export type AgentTaskOutputFormat = 'auto' | 'paragraph' | 'list' | 'table' | 'code' | 'quote'

/** Agent Task 运行时机 */
export type AgentTaskRunTiming = 'manual' | 'immediate' | 'scheduled'

/** Agent Task 完整类型（数据库存储） */
export interface AgentTaskRecord {
  id: string
  blockId: string
  pageId: string
  notebookId: string | null
  /** Block 内容 */
  content: string
  /** 用户补充说明 */
  additionalPrompt: string | null
  /** Agent 选择模式 */
  agentMode: AgentMode
  /** 指定的 Agent ID */
  agentId: string | null
  /** Agent 名称 */
  agentName: string | null
  /** 执行状态 */
  status: AgentTaskStatus
  /** 开始执行时间 */
  startedAt: string | null
  /** 完成时间 */
  completedAt: string | null
  /** 执行耗时（毫秒） */
  durationMs: number | null
  /** 执行步骤 JSON */
  steps: string | null
  /** 执行结果 */
  result: string | null
  /** 错误信息 */
  error: string | null
  /** 输出 Block ID（关联的输出 block） */
  outputBlockId: string | null
  /** 处理模式：append（在下方插入）或 replace（替换自身） */
  processMode: AgentTaskProcessMode
  /** 输出格式 */
  outputFormat: AgentTaskOutputFormat
  /** 运行时机 */
  runTiming: AgentTaskRunTiming
  /** 定时运行配置 JSON（当 runTiming 为 scheduled 时） */
  scheduleConfig: string | null
  createdAt: string
  updatedAt: string
}

/** Agent Task 创建输入 */
export interface AgentTaskInput {
  blockId: string
  pageId: string
  notebookId?: string | null
  content: string
  additionalPrompt?: string
  agentMode?: AgentMode
  agentId?: string
  agentName?: string
  processMode?: AgentTaskProcessMode
  outputFormat?: AgentTaskOutputFormat
  runTiming?: AgentTaskRunTiming
  scheduleConfig?: string
}

/** Agent Task API 接口 */
export interface AgentTaskAPI {
  get: (id: string) => Promise<AgentTaskRecord | null>
  getByBlockId: (blockId: string) => Promise<AgentTaskRecord | null>
  create: (input: AgentTaskInput) => Promise<AgentTaskRecord>
  update: (id: string, updates: Partial<AgentTaskRecord>) => Promise<AgentTaskRecord | null>
  delete: (id: string) => Promise<boolean>
  deleteByBlockId: (blockId: string) => Promise<boolean>
}

// ============ Formatter Output Types ============

/** Formatter output context for agent task output */
export interface EditorOutputContext {
  /** Target block ID (primary block for task association) */
  targetBlockId: string
  /** All selected block IDs (for multi-block operations) */
  blockIds?: string[]
  /** Page ID */
  pageId: string
  /** Notebook ID */
  notebookId: string | null
  /** Process mode: append (insert after last block) or replace (replace all blocks) */
  processMode: 'append' | 'replace'
  /** Output format preference */
  outputFormat?: AgentTaskOutputFormat
  /** Output block ID (if existing output block should be updated) */
  outputBlockId?: string | null
}

/** Execution context for agent tasks */
export interface AgentExecutionContext {
  sourceApp?: string
  noteId?: string | null
  noteTitle?: string | null
  notebookId?: string | null
  notebookName?: string | null
  heading?: string | null
}

/** Output operation type */
export type OutputOperationType = 'paragraph' | 'list' | 'table' | 'html' | 'heading' | 'codeBlock' | 'blockquote' | 'noteRef'

/** Output operation from formatter agent */
export interface OutputOperation {
  type: OutputOperationType
  content: unknown
}

/** Data for inserting output to editor */
export interface InsertOutputData {
  taskId: string
  context: EditorOutputContext
  operations: OutputOperation[]
}

// ============ Template Types ============

/** Template 完整类型 */
export interface Template {
  id: string
  name: string
  description: string
  content: string              // Markdown content
  icon: string
  isDailyDefault: boolean
  orderIndex: number
  createdAt: string
  updatedAt: string
}

/** Template 创建/更新输入 */
export interface TemplateInput {
  name: string
  description?: string
  content: string
  icon?: string
  isDailyDefault?: boolean
}

/** Template API 接口 */
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
