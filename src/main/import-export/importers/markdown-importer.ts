/**
 * Markdown 导入器
 * 支持单文件和文件夹导入
 */

import { readdir, readFile, stat } from 'fs/promises'
import { join, dirname } from 'path'
import { BaseImporter, MAX_FILE_SIZE } from '../base-importer'
import { pathExists } from '../utils/fs-helpers'
import { resolvePositiveIntegerEnv, yieldEvery } from '../utils/cooperative'
import {
  parseFrontMatter,
  extractTagsFromFrontMatter,
  extractCreatedDate,
  extractUpdatedDate,
} from '../utils/front-matter'
import type { ImporterInfo, ImportOptions, ParsedNote } from '../types'

const MARKDOWN_IMPORT_YIELD_INTERVAL = resolvePositiveIntegerEnv('IMPORT_EXPORT_YIELD_INTERVAL', 32, { min: 8, max: 4096 })

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
    if (!(await pathExists(sourcePath))) return false

    const fileStat = await stat(sourcePath)

    if (fileStat.isDirectory()) {
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

    if (!(await pathExists(sourcePath))) {
      throw new Error(`Source path does not exist: ${sourcePath}`)
    }

    const fileStat = await stat(sourcePath)

    if (fileStat.isDirectory()) {
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
    const files = await this.collectImportableFiles(rootPath)
    let parsedCount = 0

    for (const filePath of files) {
      try {
        const parsed = await this.parseFile(filePath, rootPath, options, true)
        notes.push(...parsed)
      } catch (error) {
        console.error(`Failed to parse ${filePath}:`, error)
        // 继续处理其他文件
      }
      parsedCount += 1
      await yieldEvery(parsedCount, MARKDOWN_IMPORT_YIELD_INTERVAL)
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
    const fileStat = await stat(filePath)

    // 检查文件大小限制
    if (fileStat.size > MAX_FILE_SIZE) {
      throw new Error(
        `File too large: ${filePath} (${Math.round(fileStat.size / 1024 / 1024)}MB > ${MAX_FILE_SIZE / 1024 / 1024}MB limit)`
      )
    }

    const rawContent = await readFile(filePath, 'utf-8')

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
    const createdAt = extractCreatedDate(frontMatter) || fileStat.birthtime
    const updatedAt = extractUpdatedDate(frontMatter) || fileStat.mtime

    // 收集附件引用
    const attachments = options.importAttachments
      ? await this.collectAttachments(content, dirname(filePath))
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
  private async collectImportableFiles(dirPath: string): Promise<string[]> {
    const files: string[] = []

    const entries = await readdir(dirPath, { withFileTypes: true })
    let scannedCount = 0

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name)

      // 跳过隐藏文件和目录
      if (entry.name.startsWith('.')) continue

      // 跳过 node_modules 等目录
      if (entry.name === 'node_modules') continue

      if (entry.isDirectory()) {
        files.push(...(await this.collectImportableFiles(fullPath)))
      } else if (entry.isFile() && this.isImportableFile(fullPath)) {
        files.push(fullPath)
      }
      scannedCount += 1
      await yieldEvery(scannedCount, MARKDOWN_IMPORT_YIELD_INTERVAL)
    }

    return files
  }

  /**
   * 检查目录是否包含可导入文件（.md 或 .txt）
   */
  private async hasImportableFiles(dirPath: string): Promise<boolean> {
    try {
      const entries = await readdir(dirPath, { withFileTypes: true })
      let scannedCount = 0

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue

        const fullPath = join(dirPath, entry.name)

        if (entry.isFile() && this.isImportableFile(fullPath)) {
          return true
        }

        if (entry.isDirectory() && entry.name !== 'node_modules') {
          if (await this.hasImportableFiles(fullPath)) {
            return true
          }
        }

        scannedCount += 1
        await yieldEvery(scannedCount, MARKDOWN_IMPORT_YIELD_INTERVAL)
      }

      return false
    } catch {
      return false
    }
  }
}
