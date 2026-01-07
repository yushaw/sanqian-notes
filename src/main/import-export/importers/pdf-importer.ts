/**
 * PDF 导入器
 * 通过 TextIn API 将 PDF 转换为 Markdown 后导入
 */

import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'fs'
import { join, basename, extname } from 'path'
import { app } from 'electron'
import { BaseImporter, MAX_FILE_SIZE } from '../base-importer'
import type { ImporterInfo, ImportOptions, ParsedNote } from '../types'

/** TextIn API 配置 */
export interface TextInConfig {
  appId: string
  secretCode: string
}

/** TextIn API 返回的页面结构 */
interface TextInPage {
  structured?: Array<{
    type?: string
    base64str?: string
    id?: string
  }>
}

/** TextIn API 返回结果 */
interface TextInResponse {
  code: number
  message?: string
  msg?: string
  result?: {
    markdown?: string
    pages?: TextInPage[]
  }
}

export class PdfImporter extends BaseImporter {
  readonly info: ImporterInfo = {
    id: 'pdf',
    name: 'PDF',
    description: 'Import PDF files via TextIn API',
    extensions: ['pdf'],
    supportsFolder: false,
    fileFilters: [{ name: 'PDF files', extensions: ['pdf'] }],
  }

  /** TextIn 配置（需要在导入前设置） */
  private textInConfig: TextInConfig | null = null

  /** 设置 TextIn 配置 */
  setConfig(config: TextInConfig): void {
    this.textInConfig = config
  }

  /** 获取当前配置 */
  getConfig(): TextInConfig | null {
    return this.textInConfig
  }

  async canHandle(sourcePath: string): Promise<boolean> {
    if (!existsSync(sourcePath)) return false

    const stat = statSync(sourcePath)
    if (!stat.isFile()) return false

    const ext = extname(sourcePath).toLowerCase()
    return ext === '.pdf'
  }

  async parse(options: ImportOptions): Promise<ParsedNote[]> {
    const { sourcePath } = options

    if (!this.textInConfig) {
      throw new Error('TextIn API not configured. Please set App ID and Secret Code first.')
    }

    if (!existsSync(sourcePath)) {
      throw new Error(`Source path does not exist: ${sourcePath}`)
    }

    const stat = statSync(sourcePath)

    if (stat.size > MAX_FILE_SIZE) {
      throw new Error(
        `File too large: ${sourcePath} (${Math.round(stat.size / 1024 / 1024)}MB > ${MAX_FILE_SIZE / 1024 / 1024}MB limit)`
      )
    }

    // 读取 PDF 文件
    const pdfBuffer = readFileSync(sourcePath)

    // 调用 TextIn API
    const result = await this.callTextInApi(pdfBuffer)

    if (!result.result?.markdown) {
      throw new Error('TextIn API returned no markdown content')
    }

    // 提取标题（从文件名）
    const fileName = basename(sourcePath)
    const title = fileName.slice(0, -extname(fileName).length) || fileName

    // 提取图片附件（TextIn 返回的图片以 base64 形式保存到临时目录）
    const attachments = await this.extractImages(result, sourcePath, options)

    // 获取 markdown 内容（TextIn 的图片引用是 HTML 注释形式，无需替换）
    const markdown = result.result.markdown

    // 转换 TipTap JSON
    const tiptapContent = this.markdownToContent(markdown)

    // 解析笔记本名称
    let notebookName: string | undefined
    if (options.folderStrategy !== 'single-notebook') {
      // PDF 单文件导入，没有文件夹结构，不设置笔记本
      notebookName = undefined
    }

    return [
      {
        sourcePath,
        title,
        content: tiptapContent,
        notebookName,
        tags: [],
        createdAt: stat.birthtime,
        updatedAt: stat.mtime,
        attachments,
        links: [],
      },
    ]
  }

  /**
   * 调用 TextIn API
   */
  private async callTextInApi(pdfBuffer: Buffer): Promise<TextInResponse> {
    if (!this.textInConfig) {
      throw new Error('TextIn API not configured')
    }

    // 2 分钟超时（PDF 解析可能较慢）
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 120000)

    let response: Response
    try {
      response = await fetch(
        'https://api.textin.com/ai/service/v1/pdf_to_markdown?get_image=objects&image_output_type=base64str',
        {
          method: 'POST',
          headers: {
            'x-ti-app-id': this.textInConfig.appId,
            'x-ti-secret-code': this.textInConfig.secretCode,
            'Content-Type': 'application/pdf',
          },
          // Convert Buffer to Uint8Array for fetch body compatibility
          body: new Uint8Array(pdfBuffer),
          signal: controller.signal,
        }
      )
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('TextIn API request timeout (120s)')
      }
      throw error
    } finally {
      clearTimeout(timeoutId)
    }

    if (!response.ok) {
      throw new Error(`TextIn API HTTP error: ${response.status} ${response.statusText}`)
    }

    const result = (await response.json()) as TextInResponse

    if (result.code !== 200) {
      throw new Error(`TextIn API error: ${result.message || result.msg || 'Unknown error'}`)
    }

    return result
  }

  /**
   * 从 TextIn 结果中提取图片并保存
   */
  private async extractImages(
    result: TextInResponse,
    _sourcePath: string,
    options: ImportOptions
  ): Promise<ParsedNote['attachments']> {
    if (!options.importAttachments) {
      return []
    }

    const pages = result.result?.pages
    if (!pages || pages.length === 0) {
      return []
    }

    const attachments: ParsedNote['attachments'] = []

    // 创建临时目录存储提取的图片
    const tempDir = join(app.getPath('temp'), 'sanqian-pdf-import', Date.now().toString())
    mkdirSync(tempDir, { recursive: true })

    let imageIndex = 0

    for (const page of pages) {
      if (!page.structured) continue

      for (const item of page.structured) {
        if (item.type === 'image' && item.base64str) {
          const imageName = `image-${imageIndex}.png`
          const imagePath = join(tempDir, imageName)

          // 保存图片到临时目录
          writeFileSync(imagePath, Buffer.from(item.base64str, 'base64'))

          // 添加到附件列表
          // 注意：这里的 originalRef 需要匹配 markdown 中的图片引用格式
          // TextIn 返回的 markdown 中图片通常是 HTML 注释形式，我们不需要替换
          attachments.push({
            originalRef: `![image-${imageIndex}](${imageName})`,
            sourcePath: imagePath,
          })

          imageIndex++
        }
      }
    }

    return attachments
  }

  /**
   * 清理临时文件
   */
  cleanup(): void {
    // 临时目录会在系统重启时自动清理
    // 这里可以实现更积极的清理策略
  }
}

// 导出单例
export const pdfImporter = new PdfImporter()
