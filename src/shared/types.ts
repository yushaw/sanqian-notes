/**
 * 共享类型定义
 *
 * 这些类型在 main、preload、renderer 进程之间共享
 * 确保类型定义的一致性
 */

// ============ Generic Result Type ============

/**
 * Discriminated result type for fallible operations.
 *
 * - For void operations:  Result<void, 'not_found'>
 *     OK:   { ok: true }
 *     Err:  { ok: false; error: 'not_found' }
 *
 * - For operations with data:  Result<User, 'already_exists'>
 *     OK:   { ok: true; value: User }
 *     Err:  { ok: false; error: 'already_exists' }
 *
 * Database and internal layers use this type.
 * IPC responses use the existing { success, errorCode } pattern instead.
 */
export type Result<T = void, E extends string = string> =
  | (T extends void ? { ok: true } : { ok: true; value: T })
  | { ok: false; error: E }

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
  folder_path: string | null // internal notebook folder path (max depth: 3)
  is_daily: boolean
  daily_date: string | null // YYYY-MM-DD format
  is_favorite: boolean
  is_pinned: boolean
  revision: number // Optimistic concurrency revision
  created_at: string
  updated_at: string
  deleted_at: string | null // Soft delete timestamp (trash)
  ai_summary: string | null // AI-generated summary
  tags: TagWithSource[] // Tags with source (user/ai)
}

export type NoteUpdateSafeFailureReason =
  | 'note_not_found'
  | 'notebook_not_found'
  | 'target_not_allowed'

export type NoteUpdateSafeResult =
  | { status: 'updated'; note: Note }
  | { status: 'conflict'; current: Note }
  | { status: 'failed'; error: NoteUpdateSafeFailureReason }

export interface NoteInput {
  title: string
  content: string
  notebook_id?: string | null
  folder_path?: string | null
  is_daily?: boolean
  daily_date?: string | null
  is_favorite?: boolean
  is_pinned?: boolean
}

export type NotebookSourceType = 'internal' | 'local-folder'
export type NotebookStatus = 'active' | 'permission_required' | 'missing'

export interface Notebook {
  id: string
  name: string
  icon?: string // logo:notes, logo:todolist, logo:sanqian, logo:yinian, or emoji
  source_type?: NotebookSourceType
  order_index: number
  created_at: string
}

export interface NotebookInput {
  name: string
  icon?: string
  source_type?: NotebookSourceType
}

export interface NotebookFolder {
  id: string
  notebook_id: string
  folder_path: string
  depth: number
  created_at: string
  updated_at: string
}

export interface NotebookFolderTreeNode {
  id: string
  name: string
  folder_path: string
  depth: number
  children?: NotebookFolderTreeNode[]
}

export interface NotebookFolderCreateInput {
  notebook_id: string
  parent_folder_path: string | null
  folder_name: string
}

export interface NotebookFolderRenameInput {
  notebook_id: string
  folder_path: string
  new_name: string
}

export interface NotebookFolderDeleteInput {
  notebook_id: string
  folder_path: string
}

export type NotebookFolderErrorCode =
  | 'NOTEBOOK_NOT_FOUND'
  | 'NOTEBOOK_NOT_INTERNAL'
  | 'NOTEBOOK_FOLDER_NOT_FOUND'
  | 'NOTEBOOK_FOLDER_ALREADY_EXISTS'
  | 'NOTEBOOK_FOLDER_INVALID_NAME'
  | 'NOTEBOOK_FOLDER_DEPTH_LIMIT'

export type NotebookFolderCreateResponse =
  | { success: true; result: { folder_path: string } }
  | { success: false; errorCode: NotebookFolderErrorCode }

export type NotebookFolderRenameResponse =
  | { success: true; result: { folder_path: string } }
  | { success: false; errorCode: NotebookFolderErrorCode }

export type NotebookFolderDeleteResponse =
  | { success: true; result: { deleted_note_ids: string[] } }
  | { success: false; errorCode: NotebookFolderErrorCode }

export interface LocalFolderMount {
  notebook_id: string
  root_path: string
  canonical_root_path: string
  status: NotebookStatus
  created_at: string
  updated_at: string
}

export interface LocalFolderMountInput {
  root_path: string
  name?: string
  icon?: string
}

export interface LocalFolderRelinkInput {
  notebook_id: string
  root_path: string
}

export interface LocalFolderNotebookMount {
  notebook: Notebook
  mount: LocalFolderMount
}

export interface LocalFolderWatchEvent {
  notebook_id: string
  status: NotebookStatus
  reason?: 'status_changed' | 'content_changed' | 'rescan_required'
  sequence?: number
  changed_at_ms?: number
  changed_relative_path?: string | null
}

export interface LocalFolderTreeNode {
  id: string
  name: string
  kind: 'folder' | 'file'
  relative_path: string
  depth: number
  extension?: 'md' | 'txt'
  size?: number
  mtime_ms?: number
  children?: LocalFolderTreeNode[]
}

export interface LocalFolderFileEntry {
  id: string
  name: string
  file_name: string
  relative_path: string
  folder_relative_path: string
  folder_depth: number
  extension: 'md' | 'txt'
  size: number
  mtime_ms: number
  root_path: string
  preview?: string
}

export interface LocalFolderTreeResult {
  notebook_id: string
  root_path: string
  scanned_at: string
  tree: LocalFolderTreeNode[]
  files: LocalFolderFileEntry[]
}

export interface LocalFolderReadFileInput {
  notebook_id: string
  relative_path: string
}

export interface LocalFolderSaveFileInput {
  notebook_id: string
  relative_path: string
  tiptap_content: string
  /** Preferred optimistic concurrency token from readFile/get_note etag */
  if_match?: string | number
  /** Legacy optimistic concurrency fields, kept for backward compatibility */
  expected_mtime_ms?: number
  expected_size?: number
  expected_content_hash?: string
  force?: boolean
}

export interface LocalFolderCreateFileInput {
  notebook_id: string
  parent_relative_path: string | null
  file_name: string
}

export interface LocalFolderCreateFolderInput {
  notebook_id: string
  parent_relative_path: string | null
  folder_name: string
}

export interface LocalFolderDeleteEntryInput {
  notebook_id: string
  relative_path: string
  kind: 'file' | 'folder'
}

export interface LocalFolderRenameEntryInput {
  notebook_id: string
  relative_path: string
  kind: 'file' | 'folder'
  new_name: string
}

export interface LocalFolderSearchInput {
  query: string
  notebook_id?: string
  folder_relative_path?: string | null
}

export interface LocalFolderSearchHit {
  notebook_id: string
  relative_path: string
  canonical_path: string
  score: number
  mtime_ms: number
  snippet: string
}

export interface LocalNoteMetadata {
  notebook_id: string
  relative_path: string
  is_favorite: boolean
  is_pinned: boolean
  ai_summary: string | null
  summary_content_hash?: string | null
  tags?: string[]
  ai_tags?: string[]
  updated_at: string
}

export interface LocalFolderUpdateNoteMetadataInput {
  notebook_id: string
  relative_path: string
  is_favorite?: boolean
  is_pinned?: boolean
  ai_summary?: string | null
  summary_content_hash?: string | null
  tags?: string[] | null
  ai_tags?: string[] | null
}

export interface LocalFolderAffectedMount {
  notebook_id: string
  notebook_name: string
  root_path: string
}

export interface LocalFolderFileContent {
  id: string
  notebook_id: string
  name: string
  file_name: string
  relative_path: string
  extension: 'md' | 'txt'
  size: number
  mtime_ms: number
  content_hash?: string
  etag?: string
  tiptap_content: string
}

export type LocalFolderMountErrorCode =
  | 'LOCAL_MOUNT_PATH_PERMISSION_DENIED'
  | 'LOCAL_MOUNT_PATH_UNREACHABLE'
  | 'LOCAL_MOUNT_PATH_NOT_FOUND'
  | 'LOCAL_MOUNT_ALREADY_EXISTS'
  | 'LOCAL_MOUNT_INVALID_PATH'

export type LocalFolderMountResponse =
  | { success: true; result: LocalFolderNotebookMount }
  | { success: false; errorCode: LocalFolderMountErrorCode }

export type LocalFolderRelinkErrorCode = LocalFolderMountErrorCode | 'LOCAL_NOTEBOOK_NOT_FOUND'

export type LocalFolderRelinkResponse =
  | { success: true; result: LocalFolderMount }
  | { success: false; errorCode: LocalFolderRelinkErrorCode }

export type LocalFolderFileErrorCode =
  | 'LOCAL_FILE_NOT_FOUND'
  | 'LOCAL_FILE_NOT_A_FILE'
  | 'LOCAL_FOLDER_NOT_FOUND'
  | 'LOCAL_FOLDER_NOT_A_DIRECTORY'
  | 'LOCAL_FILE_UNREADABLE'
  | 'LOCAL_FILE_WRITE_FAILED'
  | 'LOCAL_FILE_DELETE_FAILED'
  | 'LOCAL_FILE_OUT_OF_ROOT'
  | 'LOCAL_FILE_UNSUPPORTED_TYPE'
  | 'LOCAL_FILE_TOO_LARGE'
  | 'LOCAL_FILE_ALREADY_EXISTS'
  | 'LOCAL_FOLDER_ALREADY_EXISTS'
  | 'LOCAL_FILE_INVALID_NAME'
  | 'LOCAL_FOLDER_DEPTH_LIMIT'
  | 'LOCAL_FILE_INVALID_IF_MATCH'
  | 'LOCAL_FILE_CONFLICT'

export type LocalFolderReadFileErrorCode = Exclude<
  LocalFolderFileErrorCode,
  'LOCAL_FILE_CONFLICT' | 'LOCAL_FILE_INVALID_IF_MATCH'
>

export type LocalFolderReadFileResponse =
  | { success: true; result: LocalFolderFileContent }
  | { success: false; errorCode: LocalFolderReadFileErrorCode }

export type LocalFolderSaveFileResponse =
  | { success: true; result: { size: number; mtime_ms: number; content_hash?: string; etag?: string } }
  | { success: false; errorCode: 'LOCAL_FILE_CONFLICT'; conflict: { size: number; mtime_ms: number; content_hash?: string; etag?: string } }
  | { success: false; errorCode: Exclude<LocalFolderFileErrorCode, 'LOCAL_FILE_CONFLICT'> }

export type LocalFolderCreateFileResponse =
  | { success: true; result: { relative_path: string } }
  | { success: false; errorCode: LocalFolderFileErrorCode }

export type LocalFolderCreateFolderResponse =
  | { success: true; result: { relative_path: string } }
  | { success: false; errorCode: LocalFolderFileErrorCode }

export type LocalFolderAnalyzeDeleteResponse =
  | { success: true; result: { affected_mounts: LocalFolderAffectedMount[] } }
  | { success: false; errorCode: LocalFolderFileErrorCode }

export type LocalFolderDeleteEntryResponse =
  | { success: true; result: { affected_mounts: LocalFolderAffectedMount[] } }
  | { success: false; errorCode: LocalFolderFileErrorCode }

export type LocalFolderRenameEntryResponse =
  | { success: true; result: { relative_path: string }; metadataWarning?: string }
  | { success: false; errorCode: LocalFolderFileErrorCode }

export type LocalFolderSearchResponse =
  | { success: true; result: { hits: LocalFolderSearchHit[] } }
  | { success: false; errorCode: LocalFolderFileErrorCode }

export type LocalFolderListNoteMetadataResponse =
  | { success: true; result: { items: LocalNoteMetadata[] } }
  | { success: false; errorCode: LocalFolderFileErrorCode }

export type LocalFolderUpdateNoteMetadataResponse =
  | { success: true; result: LocalNoteMetadata }
  | { success: false; errorCode: LocalFolderFileErrorCode }

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

/**
 * 获取笔记列表选项
 */
export interface NoteGetAllOptions {
  /**
   * 是否合并本地文件夹笔记（默认 false）
   */
  includeLocal?: boolean
  /**
   * 当 includeLocal=true 时，是否读取本地文件完整内容（默认 false）
   */
  includeLocalContent?: boolean
  /**
   * 可选智能视图过滤（all/recent/favorites/daily）
   */
  viewType?: SmartViewId
  /**
   * 当 viewType='recent' 时可覆盖最近天数阈值（默认 RECENT_DAYS）
   */
  recentDays?: number
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
  sourceType?: NotebookSourceType
  localResourceId?: string | null
  localRelativePath?: string | null
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

// ============ Agent Capability & Event Types ============

/** Agent capability descriptor (returned by agent.list) */
export interface AgentCapability {
  type: 'agent'
  id: string
  name: string
  description?: string
  source: 'builtin' | 'custom' | 'sdk'
  sourceId?: string
  icon?: string
  display?: { zh?: string; en?: string }
  shortDesc?: { zh?: string; en?: string }
}

/** Agent task streaming event (emitted by agent.onEvent) */
export interface AgentTaskEvent {
  type: 'start' | 'text' | 'thinking' | 'tool_call' | 'tool_result' | 'done' | 'error' | 'phase' | 'editor_content'
  content?: string
  toolName?: string
  toolArgs?: Record<string, unknown>
  result?: unknown
  error?: string
  phase?: 'content' | 'editor'
}
