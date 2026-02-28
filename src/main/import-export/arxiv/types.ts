/**
 * arXiv Import Types
 */

/** 解析后的 arXiv ID */
export interface ParsedArxivId {
  id: string // 标准化 ID: 2401.00001 或 category/YYMMNNN
  version?: number // v1, v2...
}

/** arXiv 论文元数据（从 abs 页面获取） */
export interface ArxivMetadata {
  id: string
  title: string
  authors: string[]
  abstract: string
  categories: string[] // cs.AI, math.CO 等
  publishedDate: string
  updatedDate?: string
  doi?: string
  pdfUrl: string
  htmlUrl?: string // 可能不存在
}

/** arXiv 章节 */
export interface ArxivSection {
  level: number // 1-6
  title: string
  content: string // Markdown 格式
  id?: string // anchor id
}

/** arXiv 图片 */
export interface ArxivFigure {
  id: string
  caption: string
  imageUrl: string // 原始 URL
  localPath?: string // 下载后的本地路径
}

/** arXiv 表格 */
export interface ArxivTable {
  id: string
  caption: string
  markdown: string // 转换后的 Markdown 表格
}

/** arXiv 公式 */
export interface ArxivEquation {
  id?: string
  latex: string
  display: boolean // block vs inline
}

/** arXiv 参考文献 */
export interface ArxivReference {
  id: string
  text: string // 完整引用文本
  url?: string
}

/** HTML 解析结果 */
export interface ArxivHtmlContent {
  sections: ArxivSection[]
  figures: ArxivFigure[]
  tables: ArxivTable[]
  references: ArxivReference[]
}

/** 单篇论文导入进度阶段 */
export type ArxivImportStage =
  | 'fetching_metadata'
  | 'fetching_html'
  | 'parsing'
  | 'downloading_images'
  | 'converting'
  | 'fallback_pdf'
  | 'done'
  | 'error'

/** 单篇论文导入进度 */
export interface ArxivPaperProgress {
  paperId: string
  stage: ArxivImportStage
  message: string
  percent: number
}

/** 批量导入进度 */
export interface ArxivBatchProgress {
  current: number
  total: number
  currentPaper: ArxivPaperProgress
}

/** 导入选项 */
export interface ArxivImportOptions {
  inputs: string[] // URLs 或 IDs
  notebookId?: string // 目标笔记本
  includeAbstract?: boolean // 是否包含摘要（默认 true）
  includeReferences?: boolean // 是否包含参考文献（默认 false）
  downloadFigures?: boolean // 是否下载图片（默认 true）
  preferHtml?: boolean // 优先 HTML（默认 true）
  buildEmbedding?: boolean // 是否建立向量索引（默认 false）
}

/** 单篇内联导入选项（插入到当前编辑器） */
export interface ArxivInlineImportOptions {
  includeAbstract?: boolean
  includeReferences?: boolean
  downloadFigures?: boolean
  preferHtml?: boolean
}

/** 单篇导入结果 */
export interface ArxivPaperResult {
  input: string
  noteId?: string
  title?: string
  error?: string
  source: 'html' | 'pdf'
}

/** 批量导入结果 */
export interface ArxivImportResult {
  success: boolean
  imported: number
  failed: number
  results: ArxivPaperResult[]
}
