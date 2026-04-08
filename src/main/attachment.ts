/**
 * 附件管理模块
 *
 * 负责附件的存储、读取、删除等操作
 */

import { app, dialog, shell } from 'electron'
import { join, extname, basename, relative } from 'path'
import { promises as fs, realpathSync } from 'fs'
import { randomBytes } from 'crypto'
import type { AttachmentResult } from '../shared/types'
import { normalizeComparablePathForFileSystem, toSlashPath } from './path-compat'

// 重新导出类型，方便其他模块使用
export type { AttachmentResult } from '../shared/types'

// MIME 类型映射
const MIME_TYPES: Record<string, string> = {
  // 图片
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  // 视频
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  // 音频
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  // 文档
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  // 压缩包
  '.zip': 'application/zip',
  '.rar': 'application/vnd.rar',
  '.7z': 'application/x-7z-compressed',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
}

// 最大文件大小限制 (100MB)
const MAX_FILE_SIZE = 100 * 1024 * 1024

/**
 * 获取 MIME 类型
 */
function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  return MIME_TYPES[ext] || 'application/octet-stream'
}

/**
 * 生成唯一文件名
 */
function generateFileName(originalName: string): string {
  const ext = extname(originalName).toLowerCase()
  const hash = randomBytes(4).toString('hex')
  const timestamp = Date.now()
  return `${timestamp}-${hash}${ext}`
}

/**
 * 获取附件存储目录（按年月分组）
 */
async function getAttachmentDir(): Promise<string> {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const dir = join(app.getPath('userData'), 'attachments', String(year), month)

  await fs.mkdir(dir, { recursive: true })
  return dir
}

/**
 * 获取 userData 路径
 */
export function getUserDataPath(): string {
  return app.getPath('userData')
}

/**
 * 获取附件完整路径（带安全检查）
 * 使用 realpathSync 解析符号链接，防止 symlink 指向 userData 外的敏感目录。
 */
export function getFullPath(relativePath: string): string {
  // 安全检查：防止目录穿越攻击
  const normalized = toSlashPath(relativePath)
  if (normalized.includes('..') || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error('Invalid path: directory traversal detected')
  }
  const fullPath = join(app.getPath('userData'), normalized)
  // 解析符号链接后再验证是否仍在 userData 下
  let realPath: string
  try {
    realPath = realpathSync(fullPath)
  } catch {
    // 文件不存在时 realpathSync 会抛异常，此时 join 后的字符串校验已足够
    return fullPath
  }
  const realUserData = realpathSync(app.getPath('userData'))
  const comparableRealPath = normalizeComparablePathForFileSystem(realPath, realPath)
  const comparableRealUserData = normalizeComparablePathForFileSystem(realUserData, realUserData)
  const pathSeparator = comparableRealUserData.includes('\\') ? '\\' : '/'
  if (
    comparableRealPath !== comparableRealUserData
    && !comparableRealPath.startsWith(`${comparableRealUserData}${pathSeparator}`)
  ) {
    throw new Error('Invalid path: resolved path escapes user data directory')
  }
  return fullPath
}

/**
 * 保存附件（从文件路径复制）
 */
export async function saveAttachment(filePath: string): Promise<AttachmentResult> {
  // 检查源文件大小
  const sourceStats = await fs.stat(filePath)
  if (sourceStats.size > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${(sourceStats.size / 1024 / 1024).toFixed(1)}MB exceeds limit of 100MB`)
  }

  const originalName = basename(filePath)
  const newName = generateFileName(originalName)
  const dir = await getAttachmentDir()
  const fullPath = join(dir, newName)

  await fs.copyFile(filePath, fullPath)

  const stats = await fs.stat(fullPath)
  const userData = app.getPath('userData')
  const relativePath = toSlashPath(relative(userData, fullPath))

  return {
    relativePath,
    fullPath,
    name: originalName,
    size: stats.size,
    type: getMimeType(originalName),
  }
}

/**
 * 保存附件（从 Buffer，用于粘贴图片）
 */
export async function saveAttachmentBuffer(
  buffer: Buffer,
  ext: string,
  originalName?: string
): Promise<AttachmentResult> {
  // 检查 buffer 大小
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${(buffer.length / 1024 / 1024).toFixed(1)}MB exceeds limit of 100MB`)
  }

  const name = originalName || `image.${ext}`
  const newName = generateFileName(name)
  const dir = await getAttachmentDir()
  const fullPath = join(dir, newName)

  await fs.writeFile(fullPath, buffer)

  const stats = await fs.stat(fullPath)
  const userData = app.getPath('userData')
  const relativePath = toSlashPath(relative(userData, fullPath))

  return {
    relativePath,
    fullPath,
    name,
    size: stats.size,
    type: getMimeType(name),
  }
}

/**
 * 删除附件
 */
export async function deleteAttachment(relativePath: string): Promise<boolean> {
  try {
    const fullPath = getFullPath(relativePath)
    await fs.unlink(fullPath)
    return true
  } catch {
    return false
  }
}

/**
 * 用系统程序打开文件
 */
export async function openAttachment(relativePath: string): Promise<void> {
  const fullPath = getFullPath(relativePath)
  await shell.openPath(fullPath)
}

/**
 * 在 Finder/资源管理器中显示文件
 */
export function showInFolder(relativePath: string): void {
  const fullPath = getFullPath(relativePath)
  shell.showItemInFolder(fullPath)
}

/**
 * 选择文件对话框
 */
export async function selectFiles(options?: {
  filters?: { name: string; extensions: string[] }[]
  multiple?: boolean
}): Promise<string[] | null> {
  const result = await dialog.showOpenDialog({
    properties: [
      'openFile',
      ...(options?.multiple ? ['multiSelections' as const] : []),
    ],
    filters: options?.filters,
  })

  if (result.canceled) {
    return null
  }

  return result.filePaths
}

/**
 * 选择图片对话框
 */
export async function selectImages(): Promise<string[] | null> {
  return selectFiles({
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] },
    ],
    multiple: true,
  })
}

/**
 * 检查附件是否存在
 */
export async function attachmentExists(relativePath: string): Promise<boolean> {
  try {
    const fullPath = getFullPath(relativePath)
    await fs.access(fullPath)
    return true
  } catch {
    return false
  }
}

/**
 * 获取所有附件文件路径（递归扫描 attachments 目录）
 */
export async function getAllAttachments(): Promise<string[]> {
  const attachmentsDir = join(app.getPath('userData'), 'attachments')
  const files: string[] = []

  async function scanDir(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          await scanDir(fullPath)
        } else if (entry.isFile()) {
          const relativePath = toSlashPath(relative(app.getPath('userData'), fullPath))
          files.push(relativePath)
        }
      }
    } catch {
      // 目录不存在时忽略
    }
  }

  await scanDir(attachmentsDir)
  return files
}

/**
 * 清理孤儿附件文件
 * @param usedPaths 正在使用的附件路径列表
 * @returns 删除的文件数量
 */
export async function cleanupOrphanAttachments(usedPaths: string[]): Promise<number> {
  const allAttachments = await getAllAttachments()
  const usedSet = new Set(usedPaths.map(toSlashPath))
  let deletedCount = 0

  for (const attachmentPath of allAttachments) {
    if (!usedSet.has(attachmentPath)) {
      try {
        const fullPath = getFullPath(attachmentPath)
        await fs.unlink(fullPath)
        deletedCount++
        console.log(`Deleted orphan attachment: ${attachmentPath}`)
      } catch (error) {
        console.error(`Failed to delete orphan attachment ${attachmentPath}:`, error)
      }
    }
  }

  return deletedCount
}
