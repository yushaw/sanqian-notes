/**
 * Obsidian Vault 导入器
 * 支持 Obsidian vault 的完整导入，包括：
 * - .obsidian 文件夹检测
 * - Callout 语法 > [!note]
 * - Wiki 链接 [[note]] [[note#heading]]
 * - 嵌入语法 ![[note]] ![[image.png]]
 */

import { readdir, readFile, stat } from 'fs/promises'
import { join, dirname, basename, extname } from 'path'
import { BaseImporter, MAX_FILE_SIZE } from '../base-importer'
import { pathExists } from '../utils/fs-helpers'
import { resolvePositiveIntegerEnv, yieldEvery } from '../utils/cooperative'
import {
  parseFrontMatter,
  extractTagsFromFrontMatter,
  extractCreatedDate,
  extractUpdatedDate,
} from '../utils/front-matter'
import type { ImporterInfo, ImportOptions, ParsedNote, PendingAttachment } from '../types'

const OBSIDIAN_IMPORT_YIELD_INTERVAL = resolvePositiveIntegerEnv('IMPORT_EXPORT_YIELD_INTERVAL', 32, { min: 8, max: 4096 })

export class ObsidianImporter extends BaseImporter {
  readonly info: ImporterInfo = {
    id: 'obsidian',
    name: 'Obsidian',
    description: 'Import Obsidian vault with full support for callouts, wiki links, and embeds',
    extensions: [],
    supportsFolder: true,
    fileFilters: [{ name: 'Obsidian Vault', extensions: ['*'] }],
  }

  async canHandle(sourcePath: string): Promise<boolean> {
    if (!(await pathExists(sourcePath))) return false

    const sourceStat = await stat(sourcePath)
    if (!sourceStat.isDirectory()) return false

    // 检查是否包含 .obsidian 文件夹
    const obsidianDir = join(sourcePath, '.obsidian')
    if (!(await pathExists(obsidianDir))) {
      return false
    }
    return (await stat(obsidianDir)).isDirectory()
  }

  async parse(options: ImportOptions): Promise<ParsedNote[]> {
    // sourcePath is always a single string when called from index.ts
    const sourcePath = Array.isArray(options.sourcePath) ? options.sourcePath[0] : options.sourcePath

    if (!(await pathExists(sourcePath))) {
      throw new Error(`Source path does not exist: ${sourcePath}`)
    }

    const sourceStat = await stat(sourcePath)
    if (!sourceStat.isDirectory()) {
      throw new Error('Obsidian importer requires a directory (vault)')
    }

    // 收集所有 Markdown 文件
    const files = await this.collectMarkdownFiles(sourcePath)
    const notes: ParsedNote[] = []

    // 第一遍：解析所有文件，收集标题映射（用于嵌入解析）
    const titleToPath = new Map<string, string>()
    let titleMapCount = 0
    for (const filePath of files) {
      const fileName = basename(filePath, extname(filePath))
      titleToPath.set(fileName.toLowerCase(), filePath)
      titleMapCount += 1
      await yieldEvery(titleMapCount, OBSIDIAN_IMPORT_YIELD_INTERVAL)
    }

    // 第二遍：解析每个文件（Obsidian 始终是目录导入）
    let parsedCount = 0
    for (const filePath of files) {
      try {
        const parsed = await this.parseFile(filePath, sourcePath, options, titleToPath, true)
        notes.push(...parsed)
      } catch (error) {
        console.error(`Failed to parse ${filePath}:`, error)
      }
      parsedCount += 1
      await yieldEvery(parsedCount, OBSIDIAN_IMPORT_YIELD_INTERVAL)
    }

    return notes
  }

  /**
   * 解析单个文件
   * @param isDirectoryImport 是否是目录导入
   */
  private async parseFile(
    filePath: string,
    rootPath: string,
    options: ImportOptions,
    titleToPath: Map<string, string>,
    isDirectoryImport: boolean = true
  ): Promise<ParsedNote[]> {
    const fileStat = await stat(filePath)

    // 检查文件大小限制
    if (fileStat.size > MAX_FILE_SIZE) {
      throw new Error(
        `File too large: ${filePath} (${Math.round(fileStat.size / 1024 / 1024)}MB > ${MAX_FILE_SIZE / 1024 / 1024}MB limit)`
      )
    }

    const rawContent = await readFile(filePath, 'utf-8')

    // 解析 front matter (支持 Obsidian 的 YAML 和 property 格式)
    let content = rawContent
    let frontMatter: Record<string, unknown> = {}

    if (options.parseFrontMatter) {
      const fmResult = parseFrontMatter(rawContent)
      content = fmResult.content
      frontMatter = fmResult.data
    }

    // 提取标题（在预处理前，从原始内容提取）
    const title = this.extractTitle(filePath, content, frontMatter)

    // 解析笔记本名称
    let notebookName: string | undefined

    if (options.folderStrategy === 'single-notebook') {
      notebookName = undefined
    } else {
      notebookName = this.resolveNotebookName(filePath, rootPath, options.folderStrategy, isDirectoryImport)
    }

    // 提取标签（支持 Obsidian 的 #tag 内联标签，在预处理前）
    const fmTags = extractTagsFromFrontMatter(frontMatter)
    const inlineTags = this.extractInlineTags(content)
    const allTags = [...fmTags, ...inlineTags]
    const tags = this.parseTags(allTags, options.tagStrategy)

    // 提取时间
    const createdAt = extractCreatedDate(frontMatter) || fileStat.birthtime
    const updatedAt = extractUpdatedDate(frontMatter) || fileStat.mtime

    // 收集附件引用（在预处理前，因为预处理会修改 ![[]] 语法）
    const attachments = options.importAttachments
      ? await this.collectObsidianAttachments(content, dirname(filePath), rootPath)
      : []

    // 预处理 Obsidian 特有语法（嵌入笔记 → 引用文本）
    content = this.preprocessObsidianSyntax(content, dirname(filePath), titleToPath)

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
   * 预处理 Obsidian 特有语法
   * @param content Markdown 内容
   * @param _basePath 基础路径（预留用于解析嵌入路径）
   * @param _titleToPath 标题到路径映射（预留用于解析嵌入内容）
   */
  private preprocessObsidianSyntax(
    content: string,
    _basePath: string,
    _titleToPath: Map<string, string>
  ): string {
    let result = content

    // 处理嵌入笔记 ![[note]] -> 转换为引用链接
    // 注意：完整嵌入内容需要在导入后处理，这里先转换为普通链接
    // TODO: 使用 _basePath 和 _titleToPath 解析实际嵌入内容
    result = result.replace(/!\[\[([^\]|#]+)(?:#[^\]|]*)?\|?([^\]]*)\]\]/g, (_match, noteName, alias) => {
      const displayName = alias || noteName
      // 转换为 Markdown 链接格式，保留引用关系
      return `*[Embedded: ${displayName}]*`
    })

    // 处理 Obsidian 的图片嵌入 ![[image.png]] -> ![](path)
    // 已在 collectObsidianAttachments 中处理

    return result
  }

  /**
   * 提取内联标签 #tag
   * 支持: #tag, #nested/tag, #kebab-case-tag
   */
  private extractInlineTags(content: string): string[] {
    const tags: string[] = []
    // 匹配 #tag 但排除标题 ## 和代码块中的内容
    // 支持字母、数字、下划线、中文、连字符、斜杠（嵌套标签）
    const tagRegex = /(?<![#\w])#([a-zA-Z\u4e00-\u9fa5][\w\u4e00-\u9fa5/\-]*)/g
    let match

    // 移除代码块后再匹配
    const contentWithoutCode = content
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`[^`]+`/g, '')

    while ((match = tagRegex.exec(contentWithoutCode)) !== null) {
      tags.push(match[1])
    }

    return [...new Set(tags)]
  }

  /**
   * 收集 Obsidian 格式的附件引用
   */
  private async collectObsidianAttachments(
    content: string,
    basePath: string,
    rootPath: string
  ): Promise<PendingAttachment[]> {
    const attachments: PendingAttachment[] = []
    const seen = new Set<string>()

    // 匹配 ![[image.png]] 格式（Obsidian 风格）
    const wikiImageRegex = /!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g
    let match: RegExpExecArray | null

    while ((match = wikiImageRegex.exec(content)) !== null) {
      const ref = match[0]
      const fileName = match[1].trim()

      // 跳过非图片文件（可能是嵌入笔记）
      if (!this.isImageFile(fileName)) continue

      // 尝试在 vault 中查找文件
      const absolutePath = await this.findAttachmentInVault(fileName, basePath, rootPath)
      if (absolutePath && !seen.has(absolutePath)) {
        seen.add(absolutePath)
        attachments.push({
          originalRef: ref,
          sourcePath: absolutePath,
        })
      }
      await yieldEvery(seen.size, OBSIDIAN_IMPORT_YIELD_INTERVAL)
    }

    // 也收集标准 Markdown 图片引用 ![alt](path)
    // 注意：不调用 base collectAttachments，因为它也会处理 ![[]] 导致重复
    const mdImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g

    while ((match = mdImageRegex.exec(content)) !== null) {
      const ref = match[0]
      const imagePath = match[2].trim()

      // 跳过 URL
      if (
        imagePath.startsWith('http://') ||
        imagePath.startsWith('https://') ||
        imagePath.startsWith('data:') ||
        imagePath.startsWith('attachment://')
      ) {
        continue
      }

      // 尝试在 vault 中查找文件
      const absolutePath = await this.findAttachmentInVault(imagePath, basePath, rootPath)
      if (absolutePath && !seen.has(absolutePath)) {
        seen.add(absolutePath)
        attachments.push({
          originalRef: ref,
          sourcePath: absolutePath,
        })
      }
      await yieldEvery(seen.size, OBSIDIAN_IMPORT_YIELD_INTERVAL)
    }

    return attachments
  }

  /**
   * 在 vault 中查找附件
   * Obsidian 允许在任意位置引用附件，不一定是相对路径
   */
  private async findAttachmentInVault(
    fileName: string,
    basePath: string,
    rootPath: string
  ): Promise<string | null> {
    // 安全检查：文件名不能包含路径遍历
    if (fileName.includes('..') || fileName.startsWith('/')) {
      return null
    }

    // 1. 先尝试相对于当前文件
    const relativePath = join(basePath, fileName)
    if ((await pathExists(relativePath)) && (await this.isPathSafe(relativePath, rootPath))) {
      return relativePath
    }

    // 2. 尝试 vault 根目录
    const rootRelative = join(rootPath, fileName)
    if ((await pathExists(rootRelative)) && (await this.isPathSafe(rootRelative, rootPath))) {
      return rootRelative
    }

    // 3. 搜索常见的附件目录
    const commonDirs = ['attachments', 'assets', 'images', 'files', '_attachments']
    for (const dir of commonDirs) {
      const inCommonDir = join(rootPath, dir, fileName)
      if ((await pathExists(inCommonDir)) && (await this.isPathSafe(inCommonDir, rootPath))) {
        return inCommonDir
      }
    }

    // 4. 递归搜索整个 vault（性能考虑，限制深度）
    return this.searchFileInDir(rootPath, fileName, 3)
  }

  /**
   * 在目录中搜索文件（限制深度）
   */
  private async searchFileInDir(dir: string, fileName: string, maxDepth: number): Promise<string | null> {
    if (maxDepth <= 0) return null

    try {
      const entries = await readdir(dir, { withFileTypes: true })
      let scannedCount = 0

      for (const entry of entries) {
        // 跳过隐藏目录
        if (entry.name.startsWith('.')) continue

        const fullPath = join(dir, entry.name)

        if (entry.isFile() && entry.name === fileName) {
          return fullPath
        }

        if (entry.isDirectory()) {
          const found = await this.searchFileInDir(fullPath, fileName, maxDepth - 1)
          if (found) return found
        }
        scannedCount += 1
        await yieldEvery(scannedCount, OBSIDIAN_IMPORT_YIELD_INTERVAL)
      }
    } catch {
      // 忽略权限错误
    }

    return null
  }

  /**
   * 递归收集目录中的所有 Markdown 文件
   */
  private async collectMarkdownFiles(dirPath: string): Promise<string[]> {
    const files: string[] = []

    const entries = await readdir(dirPath, { withFileTypes: true })
    let scannedCount = 0

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name)

      // 跳过隐藏文件和目录（包括 .obsidian）
      if (entry.name.startsWith('.')) continue

      // 跳过 node_modules 等目录
      if (entry.name === 'node_modules') continue

      if (entry.isDirectory()) {
        files.push(...(await this.collectMarkdownFiles(fullPath)))
      } else if (entry.isFile() && this.isMarkdownFile(fullPath)) {
        files.push(fullPath)
      }
      scannedCount += 1
      await yieldEvery(scannedCount, OBSIDIAN_IMPORT_YIELD_INTERVAL)
    }

    return files
  }

  /**
   * 覆写基类方法：Obsidian 使用文件名作为标题
   * 优先级：front matter > 文件名（不使用 H1，因为 Obsidian 的 H1 通常是章节标题）
   */
  protected extractTitle(
    filePath: string,
    _content: string,
    frontMatter?: Record<string, unknown>
  ): string {
    // 1. front matter title 优先
    if (frontMatter?.title && typeof frontMatter.title === 'string') {
      return frontMatter.title.trim()
    }

    // 2. Obsidian 的核心设计：文件名即标题
    const fileName = basename(filePath)
    const ext = extname(fileName)
    return fileName.slice(0, -ext.length) || fileName
  }
}
