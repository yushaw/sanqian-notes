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
