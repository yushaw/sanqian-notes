/**
 * PDF 导入器
 * 通过可扩展的服务层将 PDF 转换为 Markdown 后导入
 */

import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join, basename, extname } from 'path'
import { app } from 'electron'
import { BaseImporter, MAX_FILE_SIZE } from '../base-importer'
import { getPdfService, getDefaultPdfService } from '../pdf-services'
import { getServiceConfig } from '../pdf-config'
import type { ImporterInfo, ImportOptions, ParsedNote } from '../types'
import type { PdfParseProgress, PdfImage } from '../pdf-services/types'

export class PdfImporter extends BaseImporter {
  readonly info: ImporterInfo = {
    id: 'pdf',
    name: 'PDF',
    description: 'Import PDF files via cloud API',
    extensions: ['pdf'],
    supportsFolder: false,
    fileFilters: [{ name: 'PDF files', extensions: ['pdf'] }],
  }

  /** 运行时配置（由 IPC 调用前设置） */
  private runtimeConfig: {
    serviceId: string
    serviceConfig: Record<string, string>
    onProgress?: (progress: PdfParseProgress) => void
    abortSignal?: AbortSignal
  } | null = null

  /** 临时目录路径（用于清理） */
  private tempDir: string | null = null

  /** 设置运行时配置（导入前调用） */
  setRuntimeConfig(config: typeof this.runtimeConfig): void {
    this.runtimeConfig = config
  }

  async canHandle(sourcePath: string): Promise<boolean> {
    if (!existsSync(sourcePath)) return false
    const stat = statSync(sourcePath)
    if (!stat.isFile()) return false
    return extname(sourcePath).toLowerCase() === '.pdf'
  }

  async parse(options: ImportOptions): Promise<ParsedNote[]> {
    // sourcePath is always a single string when called from index.ts
    const sourcePath = Array.isArray(options.sourcePath) ? options.sourcePath[0] : options.sourcePath

    // 获取配置
    let serviceId: string
    let serviceConfig: Record<string, string>
    let onProgress: ((p: PdfParseProgress) => void) | undefined
    let abortSignal: AbortSignal | undefined

    if (this.runtimeConfig) {
      serviceId = this.runtimeConfig.serviceId
      serviceConfig = this.runtimeConfig.serviceConfig
      onProgress = this.runtimeConfig.onProgress
      abortSignal = this.runtimeConfig.abortSignal
    } else {
      // 回退到存储的配置
      serviceId = 'textin'
      const stored = getServiceConfig(serviceId)
      if (!stored) {
        throw new Error('PDF service not configured. Please set App ID and Secret Code first.')
      }
      serviceConfig = stored
    }

    // 获取服务
    const service = getPdfService(serviceId) || getDefaultPdfService()

    // 验证文件
    if (!existsSync(sourcePath)) {
      throw new Error(`File not found: ${sourcePath}`)
    }

    const stat = statSync(sourcePath)
    if (stat.size > MAX_FILE_SIZE) {
      throw new Error(
        `File too large: ${sourcePath} (${Math.round(stat.size / 1024 / 1024)}MB > ${MAX_FILE_SIZE / 1024 / 1024}MB limit)`
      )
    }

    // 读取并解析 PDF
    const pdfBuffer = readFileSync(sourcePath)
    const result = await service.parse(pdfBuffer, serviceConfig, onProgress, abortSignal)

    if (!result.success) {
      throw new Error(result.error || 'PDF parsing failed')
    }

    // 提取标题（从文件名）
    const fileName = basename(sourcePath)
    const title = fileName.slice(0, -extname(fileName).length) || fileName

    // 处理图片
    const attachments = await this.processImages(result.images, options)

    // 获取 markdown 内容
    const markdown = result.markdown

    // 转换为 TipTap JSON
    const tiptapContent = this.markdownToContent(markdown)

    return [
      {
        sourcePath,
        title,
        content: tiptapContent,
        notebookName: undefined, // PDF 单文件，不设置笔记本
        tags: [],
        createdAt: stat.birthtime,
        updatedAt: stat.mtime,
        attachments,
        links: [],
      },
    ]
  }

  /**
   * 处理图片：保存到临时目录
   */
  private async processImages(
    images: PdfImage[],
    options: ImportOptions
  ): Promise<ParsedNote['attachments']> {
    if (!options.importAttachments || images.length === 0) {
      return []
    }

    const attachments: ParsedNote['attachments'] = []
    this.tempDir = join(app.getPath('temp'), 'sanqian-pdf-import', Date.now().toString())
    mkdirSync(this.tempDir, { recursive: true })

    for (const img of images) {
      const imageName = `${img.id}.${img.ext}`
      const imagePath = join(this.tempDir, imageName)

      writeFileSync(imagePath, Buffer.from(img.base64, 'base64'))

      attachments.push({
        originalRef: `![${img.id}](${imageName})`,
        sourcePath: imagePath,
      })
    }

    return attachments
  }

  /**
   * Parse a PDF file and return raw markdown content
   * Used for inline import (insert at cursor)
   */
  async parseFile(sourcePath: string): Promise<{ content: string }> {
    // 获取配置
    let serviceId: string
    let serviceConfig: Record<string, string>
    let onProgress: ((p: PdfParseProgress) => void) | undefined
    let abortSignal: AbortSignal | undefined

    if (this.runtimeConfig) {
      serviceId = this.runtimeConfig.serviceId
      serviceConfig = this.runtimeConfig.serviceConfig
      onProgress = this.runtimeConfig.onProgress
      abortSignal = this.runtimeConfig.abortSignal
    } else {
      // 回退到存储的配置
      serviceId = 'textin'
      const stored = getServiceConfig(serviceId)
      if (!stored) {
        throw new Error('PDF service not configured. Please set App ID and Secret Code first.')
      }
      serviceConfig = stored
    }

    // 获取服务
    const service = getPdfService(serviceId) || getDefaultPdfService()

    // 验证文件
    if (!existsSync(sourcePath)) {
      throw new Error(`File not found: ${sourcePath}`)
    }

    const stat = statSync(sourcePath)
    if (stat.size > MAX_FILE_SIZE) {
      throw new Error(
        `File too large: ${sourcePath} (${Math.round(stat.size / 1024 / 1024)}MB > ${MAX_FILE_SIZE / 1024 / 1024}MB limit)`
      )
    }

    // 读取并解析 PDF
    const pdfBuffer = readFileSync(sourcePath)
    try {
      const result = await service.parse(pdfBuffer, serviceConfig, onProgress, abortSignal)

      if (!result.success) {
        throw new Error(result.error || 'PDF parsing failed')
      }

      return { content: result.markdown }
    } finally {
      // 清理 runtimeConfig（parseFile 不使用 tempDir，所以只清理配置）
      this.runtimeConfig = null
    }
  }

  /**
   * 清理运行时配置和临时文件
   */
  cleanup(): void {
    this.runtimeConfig = null
    if (this.tempDir && existsSync(this.tempDir)) {
      rmSync(this.tempDir, { recursive: true, force: true })
      this.tempDir = null
    }
  }
}

// 导出单例
export const pdfImporter = new PdfImporter()
