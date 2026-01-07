/**
 * Notion 导入器
 * 支持从 Notion 导出的 ZIP 文件（Markdown & CSV 格式）导入笔记
 *
 * 特性：
 * - 自动检测 Notion 风格文件名（32位 hex ID）
 * - 清理文件名中的 ID
 * - 转换 Notion 链接为 wiki 链接
 * - 下载云端图片
 * - 处理数据库 CSV 为 Markdown 表格
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { basename, dirname, extname, join, relative, resolve } from 'path'
import { BaseImporter, MAX_FILE_SIZE } from '../base-importer'
import { detectNotionZip, extractZip, cleanupTempDir } from '../utils/zip-handler'
import { csvToMarkdownTable, extractTitleColumn } from '../utils/csv-parser'
import {
  downloadImage,
  getExtensionFromUrl,
  isNotionCloudImage,
} from '../utils/image-downloader'
import {
  parseFrontMatter,
  extractTagsFromFrontMatter,
  extractCreatedDate,
  extractUpdatedDate,
} from '../utils/front-matter'
import type { ImporterInfo, ImportOptions, ParsedNote, PendingAttachment } from '../types'

/** Notion 文件名格式：标题 + 空格 + 32位 hex ID */
const NOTION_FILENAME_PATTERN = /^(.+)\s([0-9a-f]{32})$/i

export class NotionImporter extends BaseImporter {
  readonly info: ImporterInfo = {
    id: 'notion',
    name: 'Notion',
    description: 'Import Notion exported ZIP file (Markdown & CSV)',
    extensions: ['.zip'],
    supportsFolder: false,
    fileFilters: [{ name: 'Notion Export', extensions: ['zip'] }],
  }

  async canHandle(sourcePath: string): Promise<boolean> {
    // 1. 检查文件是否存在且是 ZIP
    if (!existsSync(sourcePath)) return false
    if (!sourcePath.toLowerCase().endsWith('.zip')) return false

    // 2. 检测是否包含 Notion 风格文件名
    return detectNotionZip(sourcePath)
  }

  // 保存临时目录路径，供导入完成后清理
  private tempDir: string | null = null

  async parse(options: ImportOptions): Promise<ParsedNote[]> {
    const { sourcePath } = options

    if (!existsSync(sourcePath)) {
      throw new Error(`Source file not found: ${sourcePath}`)
    }

    // 清理之前的临时目录（如果有）
    if (this.tempDir) {
      cleanupTempDir(this.tempDir)
      this.tempDir = null
    }

    // 解压到临时目录
    this.tempDir = await extractZip(sourcePath)

    // 不在这里清理，等导入完成后再清理
    return await this.parseExtractedDir(this.tempDir, options)
  }

  /**
   * 清理临时目录（导入完成后调用）
   */
  cleanup(): void {
    if (this.tempDir) {
      cleanupTempDir(this.tempDir)
      this.tempDir = null
    }
  }

  /**
   * 解析解压后的目录
   */
  private async parseExtractedDir(
    tempDir: string,
    options: ImportOptions
  ): Promise<ParsedNote[]> {
    const notes: ParsedNote[] = []

    // 查找实际的根目录（Notion 导出可能有一层包装目录）
    const rootDir = this.findRootDir(tempDir)

    // 第一遍：收集所有文件，建立 ID → 标题 映射
    const mdFiles: string[] = []
    const csvFiles: string[] = []
    const idToTitle = new Map<string, string>() // notion ID → 清理后标题
    const pathToTitle = new Map<string, string>() // 文件路径 → 清理后标题

    this.collectFiles(rootDir, mdFiles, csvFiles)

    // 建立 ID 到标题的映射
    for (const filePath of mdFiles) {
      const filename = basename(filePath, '.md')
      const { title, notionId } = this.parseNotionFilename(filename)
      if (notionId) {
        idToTitle.set(notionId, title)
      }
      pathToTitle.set(filePath, title)
    }

    // 处理重名冲突
    const resolvedTitles = this.resolveNameConflicts(mdFiles, pathToTitle, rootDir)

    // 第二遍：解析每个 Markdown 文件
    for (const filePath of mdFiles) {
      try {
        const parsed = await this.parseFile(
          filePath,
          rootDir,
          options,
          idToTitle,
          resolvedTitles
        )
        if (parsed) {
          notes.push(parsed)
        }
      } catch (error) {
        console.error(`Failed to parse ${filePath}:`, error)
      }
    }

    // 处理 CSV 文件（生成数据库表格笔记）
    for (const csvPath of csvFiles) {
      try {
        const csvNote = this.parseCSVDatabase(csvPath, rootDir, options, resolvedTitles)
        if (csvNote) {
          notes.push(csvNote)
        }
      } catch (error) {
        console.error(`Failed to parse CSV ${csvPath}:`, error)
      }
    }

    return notes
  }

  /**
   * 查找实际的根目录
   * Notion 导出的 ZIP 可能有一层包装目录（如 "Export-xxxx"）
   */
  private findRootDir(tempDir: string): string {
    const entries = readdirSync(tempDir, { withFileTypes: true })

    // 如果只有一个目录，可能是包装目录
    const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    if (dirs.length === 1) {
      const dirName = dirs[0].name
      // 如果目录名是 Notion 风格（有 32位 ID），说明是真实内容目录，不应该展开
      if (NOTION_FILENAME_PATTERN.test(dirName)) {
        return tempDir
      }

      const innerDir = join(tempDir, dirName)
      // 检查内部是否有 Notion 文件
      const innerEntries = readdirSync(innerDir)
      const hasNotionFiles = innerEntries.some((name) =>
        NOTION_FILENAME_PATTERN.test(name.replace(/\.(md|csv)$/i, ''))
      )
      if (hasNotionFiles) {
        return innerDir
      }
    }

    return tempDir
  }

  /**
   * 递归收集 Markdown 和 CSV 文件
   */
  private collectFiles(dir: string, mdFiles: string[], csvFiles: string[]): void {
    const entries = readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      // 跳过隐藏文件和 index.html
      if (entry.name.startsWith('.') || entry.name === 'index.html') {
        continue
      }

      const fullPath = join(dir, entry.name)

      if (entry.isDirectory()) {
        this.collectFiles(fullPath, mdFiles, csvFiles)
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase()
        if (ext === '.md') {
          mdFiles.push(fullPath)
        } else if (ext === '.csv') {
          csvFiles.push(fullPath)
        }
      }
    }
  }

  /**
   * 解析 Notion 风格文件名
   */
  private parseNotionFilename(filename: string): { title: string; notionId?: string } {
    const match = filename.match(NOTION_FILENAME_PATTERN)
    if (match) {
      return { title: match[1].trim(), notionId: match[2].toLowerCase() }
    }
    return { title: filename }
  }

  /**
   * 处理重名冲突：添加父目录区分
   */
  private resolveNameConflicts(
    files: string[],
    pathToTitle: Map<string, string>,
    rootDir: string
  ): Map<string, string> {
    // 统计每个标题出现的次数
    const titleCount = new Map<string, number>()
    for (const title of pathToTitle.values()) {
      titleCount.set(title, (titleCount.get(title) || 0) + 1)
    }

    // 处理重名
    const resolved = new Map<string, string>()
    for (const filePath of files) {
      const title = pathToTitle.get(filePath) || basename(filePath, '.md')

      if (titleCount.get(title)! > 1) {
        // 有重名，添加父目录
        const relPath = relative(rootDir, filePath)
        const parentDir = dirname(relPath)

        if (parentDir && parentDir !== '.') {
          // 清理父目录名中的 Notion ID
          const parentName = basename(parentDir)
          const { title: cleanParent } = this.parseNotionFilename(parentName)
          resolved.set(filePath, `${cleanParent}/${title}`)
        } else {
          resolved.set(filePath, title)
        }
      } else {
        resolved.set(filePath, title)
      }
    }

    return resolved
  }

  /**
   * 解析单个 Markdown 文件
   */
  private async parseFile(
    filePath: string,
    rootDir: string,
    options: ImportOptions,
    idToTitle: Map<string, string>,
    resolvedTitles: Map<string, string>
  ): Promise<ParsedNote | null> {
    const stat = statSync(filePath)

    // 检查文件大小
    if (stat.size > MAX_FILE_SIZE) {
      console.warn(
        `File too large, skipping: ${filePath} (${Math.round(stat.size / 1024 / 1024)}MB)`
      )
      return null
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

    // 获取标题（front matter 优先，然后是 resolvedTitles 处理重名）
    let title: string
    if (frontMatter?.title && typeof frontMatter.title === 'string') {
      // Front matter title 最优先
      title = frontMatter.title.trim()
    } else {
      // 使用 resolvedTitles（处理了重名冲突）
      title = resolvedTitles.get(filePath) || this.extractTitle(filePath, content, frontMatter)
    }

    // 解析笔记本名称
    const notebookName = this.resolveNotebookName(filePath, rootDir, options.folderStrategy)

    // 提取标签
    const fmTags = extractTagsFromFrontMatter(frontMatter)
    const tags = this.parseTags(fmTags, options.tagStrategy)

    // 提取时间
    const createdAt = extractCreatedDate(frontMatter) || stat.birthtime
    const updatedAt = extractUpdatedDate(frontMatter) || stat.mtime

    // 收集附件（本地图片）
    const attachments: PendingAttachment[] = []
    if (options.importAttachments) {
      const localAttachments = this.collectLocalAttachments(content, dirname(filePath), rootDir)
      attachments.push(...localAttachments)
    }

    // 下载云端图片
    if (options.importAttachments) {
      const downloadedAttachments = await this.downloadCloudImages(
        content,
        dirname(filePath)
      )
      attachments.push(...downloadedAttachments.attachments)
      content = downloadedAttachments.updatedContent
    }

    // 转换 Notion 链接
    content = this.convertNotionLinks(content, idToTitle)

    // 收集 wiki 链接
    const links = this.collectWikiLinks(content)

    // 转换为 TipTap
    const tiptapContent = this.markdownToContent(content)

    return {
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
    }
  }

  /**
   * 收集本地图片附件
   */
  private collectLocalAttachments(
    content: string,
    basePath: string,
    rootPath: string
  ): PendingAttachment[] {
    const attachments: PendingAttachment[] = []
    const seen = new Set<string>()

    // 匹配 ![alt](path) 格式
    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g
    let match: RegExpExecArray | null

    while ((match = imageRegex.exec(content)) !== null) {
      const ref = match[0]
      let imagePath = match[2].trim()

      // 跳过 URL 和已处理的
      if (
        imagePath.startsWith('http://') ||
        imagePath.startsWith('https://') ||
        imagePath.startsWith('data:') ||
        imagePath.startsWith('attachment://')
      ) {
        continue
      }

      // URL 解码
      imagePath = decodeURIComponent(imagePath)

      // 解析绝对路径
      const absolutePath = resolve(basePath, imagePath)


      // 安全检查
      if (!this.isPathSafe(absolutePath, rootPath)) {
        continue
      }

      // 检查文件存在
      if (!existsSync(absolutePath)) {
        continue
      }


      if (!seen.has(absolutePath)) {
        seen.add(absolutePath)
        attachments.push({
          originalRef: ref,
          sourcePath: absolutePath,
        })
      }
    }

    return attachments
  }

  /**
   * 下载云端图片并更新内容
   */
  private async downloadCloudImages(
    content: string,
    basePath: string
  ): Promise<{ updatedContent: string; attachments: PendingAttachment[] }> {
    const attachments: PendingAttachment[] = []
    let updatedContent = content

    // 查找云端图片
    const imageRegex = /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g
    const matches: Array<{ full: string; alt: string; url: string }> = []
    let match: RegExpExecArray | null

    while ((match = imageRegex.exec(content)) !== null) {
      const url = match[2]
      if (isNotionCloudImage(url)) {
        matches.push({
          full: match[0],
          alt: match[1],
          url,
        })
      }
    }

    // 下载每个图片
    for (let i = 0; i < matches.length; i++) {
      const { full, alt, url } = matches[i]

      // 生成本地文件名
      const ext = getExtensionFromUrl(url)
      const localFilename = `notion-image-${i + 1}${ext}`
      const localPath = join(basePath, localFilename)

      const result = await downloadImage(url, localPath)

      if (result.success && result.localPath) {
        // 下载成功，添加到附件列表
        attachments.push({
          originalRef: full,
          sourcePath: result.localPath,
        })
        // 替换 content 中的云端 URL 为本地路径占位符（后续会被替换为 attachment://）
        const localRef = `![${alt}](${localFilename})`
        updatedContent = updatedContent.replace(full, localRef)
      } else {
        // 下载失败，保留原 URL（添加注释说明）
        console.warn(`Failed to download image: ${url} - ${result.error}`)
        // 保留原始引用，不修改
      }
    }

    return { updatedContent, attachments }
  }

  /**
   * 转换 Notion 链接为 wiki 链接
   */
  private convertNotionLinks(content: string, idToTitle: Map<string, string>): string {
    let result = content

    // 1. 转换绝对 URL: [Text](https://www.notion.so/Page-Name-abc123...)
    result = result.replace(
      /\[([^\]]+)\]\(https:\/\/(?:www\.)?notion\.so\/[^)]*?([0-9a-f]{32})(?:#([^)]*))?\)/gi,
      (_match, text, id, anchor) => {
        const title = idToTitle.get(id.toLowerCase()) || text
        return anchor ? `[[${title}#${anchor}]]` : `[[${title}]]`
      }
    )

    // 2. 转换相对路径: [Text](path/to/Page%20Name%20abc123.md)
    result = result.replace(
      /\[([^\]]+)\]\(([^)]+\s[0-9a-f]{32}\.md)\)/gi,
      (fullMatch, _text, path) => {
        try {
          const decoded = decodeURIComponent(path)
          const filename = basename(decoded, '.md')
          const { title } = this.parseNotionFilename(filename)
          return `[[${title}]]`
        } catch {
          return fullMatch
        }
      }
    )

    // 3. 转换不带 ID 的相对路径: [Text](Page.md) 或 [Text](../Parent/Page.md)
    result = result.replace(/\[([^\]]+)\]\(([^)]+\.md)\)/gi, (fullMatch, _text, path) => {
      // 跳过外部链接
      if (path.startsWith('http://') || path.startsWith('https://')) {
        return fullMatch
      }
      try {
        const decoded = decodeURIComponent(path)
        const filename = basename(decoded, '.md')
        // 检查是否有 Notion ID
        const { title } = this.parseNotionFilename(filename)
        return `[[${title}]]`
      } catch {
        return fullMatch
      }
    })

    return result
  }

  /**
   * 解析 CSV 数据库为 Markdown 表格笔记
   */
  private parseCSVDatabase(
    csvPath: string,
    rootDir: string,
    options: ImportOptions,
    resolvedTitles: Map<string, string>
  ): ParsedNote | null {
    const stat = statSync(csvPath)
    if (stat.size > MAX_FILE_SIZE) {
      return null
    }

    const csvContent = readFileSync(csvPath, 'utf-8')

    // 从文件名提取数据库名称
    const filename = basename(csvPath, '.csv')
    const { title: databaseName } = this.parseNotionFilename(filename)

    // 提取标题列值，建立 → 笔记标题 映射
    const titleValues = extractTitleColumn(csvContent)
    const rowToNoteTitle = new Map<string, string>()

    // 从 resolvedTitles 中找到对应的笔记标题
    for (const value of titleValues) {
      // 查找匹配的笔记
      for (const [, title] of resolvedTitles) {
        if (title === value || title.endsWith(`/${value}`)) {
          rowToNoteTitle.set(value, title)
          break
        }
      }
    }

    // 转换为 Markdown 表格
    const tableContent = csvToMarkdownTable(csvContent, ['Name', 'Title', '名称', '标题'], rowToNoteTitle)

    if (!tableContent) {
      return null
    }

    // 添加数据库标题
    const markdownContent = `# ${databaseName}\n\n${tableContent}`

    // 转换为 TipTap
    const tiptapContent = this.markdownToContent(markdownContent)

    // 解析笔记本名称
    const notebookName = this.resolveNotebookName(csvPath, rootDir, options.folderStrategy)

    return {
      sourcePath: csvPath,
      title: databaseName,
      content: tiptapContent,
      notebookName,
      tags: [],
      createdAt: stat.birthtime,
      updatedAt: stat.mtime,
      attachments: [],
      links: this.collectWikiLinks(markdownContent),
      frontMatter: {},
    }
  }

  /**
   * 重写基类方法：清理 Notion 文件名中的 ID
   */
  protected extractTitle(
    filePath: string,
    content: string,
    frontMatter?: Record<string, unknown>
  ): string {
    // 1. 尝试从 front matter 获取
    if (frontMatter?.title && typeof frontMatter.title === 'string') {
      return frontMatter.title.trim()
    }

    // 2. 尝试从第一个 # 标题获取
    const headingMatch = content.match(/^#\s+(.+)$/m)
    if (headingMatch) {
      return headingMatch[1].trim()
    }

    // 3. 从文件名提取（清理 Notion ID）
    const filename = basename(filePath, extname(filePath))
    const { title } = this.parseNotionFilename(filename)
    return title
  }

  /**
   * 重写基类方法：清理 Notion 目录名中的 ID
   */
  protected resolveNotebookName(
    filePath: string,
    rootPath: string,
    strategy: ImportOptions['folderStrategy']
  ): string | undefined {
    const relativePath = relative(rootPath, filePath)
    const dir = dirname(relativePath)

    if (dir === '.' || dir === '') {
      return undefined
    }

    const parts = dir.split(/[/\\]/).filter(Boolean)
    if (parts.length === 0) {
      return undefined
    }

    // 清理每个目录名中的 Notion ID
    const cleanParts = parts.map((part) => {
      const { title } = this.parseNotionFilename(part)
      return title
    })

    switch (strategy) {
      case 'first-level':
        return cleanParts[0]

      case 'flatten-path':
        return cleanParts.join('/')

      case 'single-notebook':
        return undefined

      default:
        return cleanParts[0]
    }
  }
}
