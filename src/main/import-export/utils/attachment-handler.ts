/**
 * 附件处理工具
 * 复制附件到 userData 目录，更新内容中的路径引用
 */

import { existsSync, readFileSync, statSync } from 'fs'
import { extname, basename } from 'path'
import { saveAttachmentBuffer } from '../../attachment'
import { MAX_ATTACHMENT_SIZE } from '../base-importer'
import type { PendingAttachment } from '../types'

export interface AttachmentCopyResult {
  /** 成功复制的附件数量 */
  copiedCount: number
  /** 失败的附件 */
  failed: Array<{ path: string; error: string }>
  /** 更新后的内容 */
  updatedContent: string
}

/**
 * 从 Markdown 引用中提取图片路径
 * ![alt](path) -> path
 * ![[path]] -> path
 */
function extractPathFromRef(ref: string): string | null {
  // 标准 Markdown 格式 ![alt](path)
  const mdMatch = ref.match(/!\[[^\]]*\]\(([^)]+)\)/)
  if (mdMatch) {
    return mdMatch[1].trim()
  }

  // Obsidian 格式 ![[path]]
  const wikiMatch = ref.match(/!\[\[([^|\]]+)/)
  if (wikiMatch) {
    return wikiMatch[1].trim()
  }

  return null
}

/**
 * 递归更新 TipTap JSON 中的图片 src
 */
function updateImageSrcInNode(
  node: Record<string, unknown>,
  pathToNewPath: Map<string, string>
): void {
  // 如果是图片节点，更新 src
  if (node.type === 'image' && node.attrs) {
    const attrs = node.attrs as Record<string, unknown>
    if (typeof attrs.src === 'string') {
      // URL 解码 src
      const decodedSrc = decodeURIComponent(attrs.src)

      // 检查是否需要替换
      const newPath = pathToNewPath.get(decodedSrc) || pathToNewPath.get(attrs.src)
      if (newPath) {
        attrs.src = newPath
      }
    }
  }

  // 递归处理子节点
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      if (typeof child === 'object' && child !== null) {
        updateImageSrcInNode(child as Record<string, unknown>, pathToNewPath)
      }
    }
  }
}

/**
 * 复制附件并更新内容中的引用
 * 支持 TipTap JSON 格式的内容
 */
export async function copyAttachmentsAndUpdateContent(
  content: string,
  attachments: PendingAttachment[]
): Promise<AttachmentCopyResult> {
  let copiedCount = 0
  const failed: Array<{ path: string; error: string }> = []

  // 第一步：复制所有附件，构建路径映射
  const pathToNewPath = new Map<string, string>()

  for (const attachment of attachments) {
    try {

      // 检查文件是否存在
      if (!existsSync(attachment.sourcePath)) {
        failed.push({
          path: attachment.sourcePath,
          error: 'File not found',
        })
        continue
      }

      // 检查文件大小
      const stat = statSync(attachment.sourcePath)
      if (stat.size > MAX_ATTACHMENT_SIZE) {
        const sizeMB = Math.round(stat.size / 1024 / 1024)
        const limitMB = Math.round(MAX_ATTACHMENT_SIZE / 1024 / 1024)
        failed.push({
          path: attachment.sourcePath,
          error: `File too large: ${sizeMB}MB (limit: ${limitMB}MB)`,
        })
        continue
      }


      // 读取文件内容
      const buffer = readFileSync(attachment.sourcePath)
      const ext = extname(attachment.sourcePath).toLowerCase() || '.bin'
      const name = basename(attachment.sourcePath, ext)

      // 保存到 userData
      const result = await saveAttachmentBuffer(buffer, ext.slice(1), name)
      const newPath = `attachment://${result.relativePath}`

      // 从 originalRef 提取原始路径
      const originalPath = extractPathFromRef(attachment.originalRef)
      if (originalPath) {
        // 同时存储编码和解码版本
        pathToNewPath.set(originalPath, newPath)
        pathToNewPath.set(decodeURIComponent(originalPath), newPath)
      }

      attachment.newRelativePath = result.relativePath
      copiedCount++
    } catch (error) {
      console.error('[AttachmentHandler] Error copying:', attachment.sourcePath, error)
      failed.push({
        path: attachment.sourcePath,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // 第二步：更新 TipTap JSON 中的图片引用
  let updatedContent = content
  if (pathToNewPath.size > 0) {
    try {
      const doc = JSON.parse(content) as Record<string, unknown>
      updateImageSrcInNode(doc, pathToNewPath)
      updatedContent = JSON.stringify(doc)
    } catch (error) {
      console.error('[AttachmentHandler] Failed to parse/update TipTap JSON:', error)
      // 如果 JSON 解析失败，回退到字符串替换（兼容 Markdown 内容）
      for (const [originalPath, newPath] of pathToNewPath) {
        const encodedPath = encodeURIComponent(originalPath).replace(/%2F/g, '/')
        updatedContent = updatedContent.split(encodedPath).join(newPath)
        updatedContent = updatedContent.split(originalPath).join(newPath)
      }
    }
  }

  return {
    copiedCount,
    failed,
    updatedContent,
  }
}

/**
 * 检查文件是否为支持的附件类型
 */
export function isSupportedAttachment(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase()
  const supportedExtensions = [
    // 图片
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.tiff',
    // 音频
    '.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac',
    // 视频
    '.mp4', '.webm', '.mov', '.avi', '.mkv',
    // 文档
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    // 其他
    '.zip', '.rar', '.7z', '.tar', '.gz',
  ]
  return supportedExtensions.includes(ext)
}

/**
 * 获取附件的 MIME 类型
 */
export function getAttachmentMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  const mimeTypes: Record<string, string> = {
    // 图片
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
    '.tiff': 'image/tiff',
    // 音频
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.flac': 'audio/flac',
    '.aac': 'audio/aac',
    // 视频
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska',
    // 文档
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // 压缩包
    '.zip': 'application/zip',
    '.rar': 'application/vnd.rar',
    '.7z': 'application/x-7z-compressed',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
  }
  return mimeTypes[ext] || 'application/octet-stream'
}
