/**
 * 云端图片下载工具
 * 用于下载 Notion 导出中的 S3 云端图片
 */

import { createWriteStream, existsSync, mkdirSync, statSync, unlinkSync } from 'fs'
import { dirname } from 'path'
import https from 'https'
import http from 'http'

/** 单个图片最大大小限制 (20MB) */
const MAX_IMAGE_SIZE = 20 * 1024 * 1024

/** 下载超时时间 (30s) */
const DOWNLOAD_TIMEOUT = 30000

/** 最大重定向次数 */
const MAX_REDIRECTS = 5

/** 下载结果 */
export interface DownloadResult {
  success: boolean
  localPath?: string
  originalUrl: string
  error?: string
}

/**
 * 检测 URL 是否是 Notion 云端图片
 * Notion 使用 AWS S3 存储图片
 */
export function isNotionCloudImage(url: string): boolean {
  if (!url) return false
  return (
    url.includes('prod-files-secure.s3') ||
    url.includes('s3.us-west-2.amazonaws.com') ||
    url.includes('s3.amazonaws.com') ||
    url.includes('notion-static.com') ||
    url.includes('secure.notion-static.com')
  )
}

/**
 * 从 URL 推断文件扩展名
 */
export function getExtensionFromUrl(url: string): string {
  try {
    const urlObj = new URL(url)
    const pathname = urlObj.pathname

    // 尝试从路径获取扩展名
    const lastDot = pathname.lastIndexOf('.')
    if (lastDot > 0) {
      const ext = pathname.substring(lastDot).toLowerCase()
      // 验证是否是有效的图片扩展名
      if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'].includes(ext)) {
        return ext
      }
    }

    // 默认使用 .png
    return '.png'
  } catch {
    return '.png'
  }
}

/**
 * 下载图片到指定路径
 * @param url 图片 URL
 * @param destPath 目标保存路径
 * @param redirectCount 当前重定向次数（内部使用）
 * @returns 下载结果
 */
export async function downloadImage(
  url: string,
  destPath: string,
  redirectCount: number = 0
): Promise<DownloadResult> {
  return new Promise((resolve) => {
    try {
      // 确保目标目录存在
      const dir = dirname(destPath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }

      const urlObj = new URL(url)
      const protocol = urlObj.protocol === 'https:' ? https : http

      // Guard: destroying request/stream triggers their error handlers,
      // which would call settle() again. The flag prevents double-resolution.
      let settled = false
      function settle(result: DownloadResult): void {
        if (settled) return
        settled = true
        resolve(result)
      }

      const request = protocol.get(
        url,
        {
          timeout: DOWNLOAD_TIMEOUT,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; SanqianNotes/1.0)',
          },
        },
        (response) => {
          // 处理重定向
          if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
            const redirectUrl = response.headers.location
            if (redirectUrl) {
              // 检查重定向次数限制
              if (redirectCount >= MAX_REDIRECTS) {
                settle({
                  success: false,
                  originalUrl: url,
                  error: `Too many redirects (max: ${MAX_REDIRECTS})`,
                })
                return
              }
              // 递归处理重定向
              downloadImage(redirectUrl, destPath, redirectCount + 1).then(resolve)
              return
            }
          }

          // 检查响应状态
          if (response.statusCode !== 200) {
            settle({
              success: false,
              originalUrl: url,
              error: `HTTP ${response.statusCode}`,
            })
            return
          }

          // 检查内容大小
          const contentLength = parseInt(response.headers['content-length'] || '0', 10)
          if (contentLength > MAX_IMAGE_SIZE) {
            settle({
              success: false,
              originalUrl: url,
              error: `Image too large: ${Math.round(contentLength / 1024 / 1024)}MB (limit: ${MAX_IMAGE_SIZE / 1024 / 1024}MB)`,
            })
            return
          }

          // 创建写入流
          const fileStream = createWriteStream(destPath)
          let downloadedSize = 0

          response.on('data', (chunk: Buffer) => {
            downloadedSize += chunk.length
            // 实时检查大小
            if (downloadedSize > MAX_IMAGE_SIZE) {
              request.destroy()
              fileStream.destroy()
              // 删除不完整的文件
              try {
                unlinkSync(destPath)
              } catch {
                // 忽略删除失败
              }
              settle({
                success: false,
                originalUrl: url,
                error: `Image too large during download (limit: ${MAX_IMAGE_SIZE / 1024 / 1024}MB)`,
              })
            }
          })

          response.pipe(fileStream)

          fileStream.on('finish', () => {
            fileStream.close()
            // 验证文件是否成功写入
            if (existsSync(destPath)) {
              const stat = statSync(destPath)
              if (stat.size > 0) {
                settle({
                  success: true,
                  localPath: destPath,
                  originalUrl: url,
                })
              } else {
                settle({
                  success: false,
                  originalUrl: url,
                  error: 'Downloaded file is empty',
                })
              }
            } else {
              settle({
                success: false,
                originalUrl: url,
                error: 'File not created',
              })
            }
          })

          fileStream.on('error', (err) => {
            fileStream.close()
            try {
              unlinkSync(destPath)
            } catch {
              // 忽略删除失败
            }
            settle({
              success: false,
              originalUrl: url,
              error: `Write error: ${err.message}`,
            })
          })
        }
      )

      request.on('error', (err) => {
        settle({
          success: false,
          originalUrl: url,
          error: `Request error: ${err.message}`,
        })
      })

      request.on('timeout', () => {
        request.destroy()
        settle({
          success: false,
          originalUrl: url,
          error: `Timeout after ${DOWNLOAD_TIMEOUT / 1000}s`,
        })
      })
    } catch (err) {
      resolve({
        success: false,
        originalUrl: url,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  })
}
