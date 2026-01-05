/**
 * Markdown 导入器
 * 支持单文件和文件夹导入
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { BaseImporter, MAX_FILE_SIZE } from '../base-importer'
import {
  parseFrontMatter,
  extractTagsFromFrontMatter,
  extractCreatedDate,
  extractUpdatedDate,
} from '../utils/front-matter'
import type { ImporterInfo, ImportOptions, ParsedNote } from '../types'

export class MarkdownImporter extends BaseImporter {
  readonly info: ImporterInfo = {
    id: 'markdown',
    name: 'Markdown',
    description: 'Import Markdown files or folders',
    extensions: ['md', 'markdown', 'mdown', 'mkd'],
    supportsFolder: true,
    fileFilters: [
      { name: 'Markdown files', extensions: ['md', 'markdown', 'mdown', 'mkd'] },
      { name: 'All files', extensions: ['*'] },
    ],
  }

  async canHandle(sourcePath: string): Promise<boolean> {
    if (!existsSync(sourcePath)) return false

    const stat = statSync(sourcePath)

    if (stat.isDirectory()) {
      // 检查是否包含 Markdown 文件
      return this.hasMarkdownFiles(sourcePath)
    }

    // 单文件检查扩展名
    return this.isMarkdownFile(sourcePath)
  }

  async parse(options: ImportOptions): Promise<ParsedNote[]> {
    const { sourcePath } = options

    if (!existsSync(sourcePath)) {
      throw new Error(`Source path does not exist: ${sourcePath}`)
    }

    const stat = statSync(sourcePath)

    if (stat.isDirectory()) {
      return this.parseDirectory(sourcePath, options)
    } else {
      return this.parseFile(sourcePath, sourcePath, options)
    }
  }

  /**
   * 解析目录
   */
  private async parseDirectory(
    rootPath: string,
    options: ImportOptions
  ): Promise<ParsedNote[]> {
    const notes: ParsedNote[] = []
    const files = this.collectMarkdownFiles(rootPath)

    for (const filePath of files) {
      try {
        const parsed = await this.parseFile(filePath, rootPath, options)
        notes.push(...parsed)
      } catch (error) {
        console.error(`Failed to parse ${filePath}:`, error)
        // 继续处理其他文件
      }
    }

    return notes
  }

  /**
   * 解析单个文件
   */
  private async parseFile(
    filePath: string,
    rootPath: string,
    options: ImportOptions
  ): Promise<ParsedNote[]> {
    const stat = statSync(filePath)

    // 检查文件大小限制
    if (stat.size > MAX_FILE_SIZE) {
      throw new Error(
        `File too large: ${filePath} (${Math.round(stat.size / 1024 / 1024)}MB > ${MAX_FILE_SIZE / 1024 / 1024}MB limit)`
      )
    }

    const rawContent = readFileSync(filePath, 'utf-8')

    // 解析 front matter
    let content = rawContent
    let frontMatter: Record<string, unknown> = {}

    if (options.parseFrontMatter) {
      const fmResult = parseFrontMatter(rawContent)
      content = fmResult.content
      frontMatter = fmResult.data
    }

    // 提取标题
    const title = this.extractTitle(filePath, content, frontMatter)

    // 解析笔记本名称
    let notebookName: string | undefined

    if (options.folderStrategy === 'single-notebook') {
      // 由外部指定，这里不处理
      notebookName = undefined
    } else {
      notebookName = this.resolveNotebookName(filePath, rootPath, options.folderStrategy)
    }

    // 提取标签
    const fmTags = extractTagsFromFrontMatter(frontMatter)
    const tags = this.parseTags(fmTags, options.tagStrategy)

    // 提取时间
    const createdAt = extractCreatedDate(frontMatter) || stat.birthtime
    const updatedAt = extractUpdatedDate(frontMatter) || stat.mtime

    // 收集附件引用
    const attachments = options.importAttachments
      ? this.collectAttachments(content, dirname(filePath))
      : []

    // 收集内部链接
    const links = this.collectWikiLinks(content)

    // 转换 Markdown 到 TipTap JSON
    const tiptapContent = this.markdownToContent(content)

    return [
      {
        sourcePath: filePath,
        title,
        content: tiptapContent,
        notebookName,
        tags,
        createdAt,
        updatedAt,
        attachments,
        links,
        frontMatter,
      },
    ]
  }

  /**
   * 递归收集目录中的所有 Markdown 文件
   */
  private collectMarkdownFiles(dirPath: string): string[] {
    const files: string[] = []

    const entries = readdirSync(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name)

      // 跳过隐藏文件和目录
      if (entry.name.startsWith('.')) continue

      // 跳过 node_modules 等目录
      if (entry.name === 'node_modules') continue

      if (entry.isDirectory()) {
        files.push(...this.collectMarkdownFiles(fullPath))
      } else if (entry.isFile() && this.isMarkdownFile(fullPath)) {
        files.push(fullPath)
      }
    }

    return files
  }

  /**
   * 检查目录是否包含 Markdown 文件
   */
  private hasMarkdownFiles(dirPath: string): boolean {
    try {
      const entries = readdirSync(dirPath, { withFileTypes: true })

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue

        const fullPath = join(dirPath, entry.name)

        if (entry.isFile() && this.isMarkdownFile(fullPath)) {
          return true
        }

        if (entry.isDirectory() && entry.name !== 'node_modules') {
          if (this.hasMarkdownFiles(fullPath)) {
            return true
          }
        }
      }

      return false
    } catch {
      return false
    }
  }
}
