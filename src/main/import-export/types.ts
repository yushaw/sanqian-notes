/**
 * 导入导出模块类型定义
 */

// ============ 导入配置 ============

/** 文件夹映射策略 */
export type FolderStrategy = 'first-level' | 'flatten-path' | 'single-notebook'

/** 标签处理策略 */
export type TagStrategy = 'keep-nested' | 'flatten-all' | 'first-level'

/** 冲突处理策略 */
export type ConflictStrategy = 'skip' | 'rename' | 'overwrite'

/** 导入进度回调 */
export type ImportProgressCallback = (event: ImportProgressEvent) => void

/** 导入配置 */
export interface ImportOptions {
  /** 来源路径（文件/文件夹/ZIP），支持多选 */
  sourcePath: string | string[]

  /** 文件夹→笔记本映射策略 */
  folderStrategy: FolderStrategy

  /** single-notebook 策略时的目标笔记本 ID */
  targetNotebookId?: string

  /** 根级文件的默认笔记本 ID（null = 不分配） */
  defaultNotebookId?: string | null

  /** 标签处理策略 */
  tagStrategy: TagStrategy

  /** 同名冲突处理 */
  conflictStrategy: ConflictStrategy

  /** 是否导入附件 */
  importAttachments: boolean

  /** 是否解析 YAML front matter */
  parseFrontMatter: boolean

  /** 是否建立向量索引（默认 false，仅当全局 embedding 启用时有效） */
  buildEmbedding?: boolean

  /** 进度回调（可选） */
  onProgress?: ImportProgressCallback
}

// ============ 导入中间格式 ============

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

// ============ 导入结果 ============

/** 导入的笔记信息 */
export interface ImportedNoteInfo {
  id: string
  title: string
  sourcePath: string
}

/** 跳过的文件信息 */
export interface SkippedFileInfo {
  path: string
  reason: string
}

/** 导入错误信息 */
export interface ImportErrorInfo {
  path: string
  error: string
}

/** 创建的笔记本信息 */
export interface CreatedNotebookInfo {
  id: string
  name: string
}

/** 导入统计 */
export interface ImportStats {
  totalFiles: number
  importedNotes: number
  importedAttachments: number
  skippedFiles: number
  errorCount: number
  duration: number // ms
}

/** 导入结果 */
export interface ImportResult {
  success: boolean
  /** 成功导入的笔记 */
  importedNotes: ImportedNoteInfo[]
  /** 跳过的文件 */
  skippedFiles: SkippedFileInfo[]
  /** 错误列表 */
  errors: ImportErrorInfo[]
  /** 新创建的笔记本 */
  createdNotebooks: CreatedNotebookInfo[]
  /** 统计信息 */
  stats: ImportStats
}

/** 导入预览结果（不执行实际导入） */
export interface ImportPreview {
  /** 检测到的导入器 */
  importerId: string
  importerName: string
  /** 将要导入的笔记数量 */
  noteCount: number
  /** 将要创建的笔记本 */
  notebookNames: string[]
  /** 附件数量 */
  attachmentCount: number
  /** 文件列表预览（前 100 个） */
  files: Array<{ path: string; title: string; notebookName?: string }>
}

// ============ 导出配置 ============

/** 导出格式 */
export type ExportFormat = 'markdown' | 'json'

/** 导出进度回调 */
export type ExportProgressCallback = (event: ExportProgressEvent) => void

/** 导出配置 */
export interface ExportOptions {
  /** 要导出的笔记 ID（空数组 = 全部） */
  noteIds: string[]
  /** 要导出的笔记本 ID（空数组 = 不按笔记本筛选） */
  notebookIds: string[]
  /** 导出格式 */
  format: ExportFormat
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
  /** 进度回调（可选） */
  onProgress?: ExportProgressCallback
}

/** 导出错误信息 */
export interface ExportErrorInfo {
  noteId: string
  title: string
  error: string
}

/** 导出统计 */
export interface ExportStats {
  exportedNotes: number
  exportedAttachments: number
  totalSize: number // bytes
}

/** 导出结果 */
export interface ExportResult {
  success: boolean
  /** 输出路径（ZIP 时为 .zip 文件路径） */
  outputPath: string
  /** 统计信息 */
  stats: ExportStats
  /** 错误列表 */
  errors: ExportErrorInfo[]
}

// ============ 导入器注册 ============

/** 导入器元信息 */
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

// ============ 进度事件 ============

/** 导入进度事件 */
export interface ImportProgressEvent {
  type: 'scanning' | 'parsing' | 'creating' | 'copying' | 'done' | 'error'
  current?: number
  total?: number
  message?: string
  error?: string
}

/** 导出进度事件 */
export interface ExportProgressEvent {
  type: 'exporting' | 'copying' | 'zipping' | 'done' | 'error'
  current?: number
  total?: number
  message?: string
  error?: string
}
