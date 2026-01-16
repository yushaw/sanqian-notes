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
    description: 'Import Markdown and text files or folders',
    extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'],
    supportsFolder: true,
    fileFilters: [
      { name: 'Markdown & Text files', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] },
      { name: 'Markdown files', extensions: ['md', 'markdown', 'mdown', 'mkd'] },
      { name: 'Text files', extensions: ['txt'] },
      { name: 'All files', extensions: ['*'] },
    ],
  }

  async canHandle(sourcePath: string): Promise<boolean> {
    if (!existsSync(sourcePath)) return false

    const stat = statSync(sourcePath)

    if (stat.isDirectory()) {
      // 检查是否包含 Markdown 或 txt 文件
      return this.hasImportableFiles(sourcePath)
    }

    // 单文件检查扩展名
    return this.isImportableFile(sourcePath)
  }

  /**
   * 检查文件是否可导入（.md 或 .txt）
   */
  private isImportableFile(filePath: string): boolean {
    return this.isMarkdownFile(filePath) || this.isTextFile(filePath)
  }

  async parse(options: ImportOptions): Promise<ParsedNote[]> {
    // sourcePath is always a single string when called from index.ts
    const sourcePath = Array.isArray(options.sourcePath) ? options.sourcePath[0] : options.sourcePath

    if (!existsSync(sourcePath)) {
      throw new Error(`Source path does not exist: ${sourcePath}`)
    }

    const stat = statSync(sourcePath)

    if (stat.isDirectory()) {
      return this.parseDirectory(sourcePath, options)
    } else {
      return this.parseFile(sourcePath, sourcePath, options, false)
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
    const files = this.collectImportableFiles(rootPath)

    for (const filePath of files) {
      try {
        const parsed = await this.parseFile(filePath, rootPath, options, true)
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
   * @param isDirectoryImport 是否是目录导入（用于决定根级文件是否使用目录名作为 notebook）
   */
  private async parseFile(
    filePath: string,
    rootPath: string,
    options: ImportOptions,
    isDirectoryImport: boolean = false
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
      notebookName = this.resolveNotebookName(filePath, rootPath, options.folderStrategy, isDirectoryImport)
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

    // 收集内部链接（仅对 Markdown 文件有意义）
    const links = this.isTextFile(filePath) ? [] : this.collectWikiLinks(content)

    // 转换内容到 TipTap JSON
    // txt 文件使用纯文本转换（不解析 Markdown 语法），md 文件使用 Markdown 转换
    const tiptapContent = this.isTextFile(filePath)
      ? this.plainTextToContent(content)
      : this.markdownToContent(content)

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
   * 递归收集目录中的所有可导入文件（.md 和 .txt）
   */
  private collectImportableFiles(dirPath: string): string[] {
    const files: string[] = []

    const entries = readdirSync(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name)

      // 跳过隐藏文件和目录
      if (entry.name.startsWith('.')) continue

      // 跳过 node_modules 等目录
      if (entry.name === 'node_modules') continue

      if (entry.isDirectory()) {
        files.push(...this.collectImportableFiles(fullPath))
      } else if (entry.isFile() && this.isImportableFile(fullPath)) {
        files.push(fullPath)
      }
    }

    return files
  }

  /**
   * 检查目录是否包含可导入文件（.md 或 .txt）
   */
  private hasImportableFiles(dirPath: string): boolean {
    try {
      const entries = readdirSync(dirPath, { withFileTypes: true })

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue

        const fullPath = join(dirPath, entry.name)

        if (entry.isFile() && this.isImportableFile(fullPath)) {
          return true
        }

        if (entry.isDirectory() && entry.name !== 'node_modules') {
          if (this.hasImportableFiles(fullPath)) {
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
