/**
 * 导入器基类
 */

import { basename, dirname, extname, relative, resolve, sep } from 'path'
import { existsSync, realpathSync } from 'fs'

/** 单个文件最大大小限制 (50MB) */
export const MAX_FILE_SIZE = 50 * 1024 * 1024

/** 单个附件最大大小限制 (100MB) */
export const MAX_ATTACHMENT_SIZE = 100 * 1024 * 1024
import { markdownToTiptapString } from '../markdown'
import type {
  ImporterInfo,
  ImportOptions,
  ParsedNote,
  PendingAttachment,
  PendingLink,
  FolderStrategy,
} from './types'

export abstract class BaseImporter {
  /** 导入器元信息 */
  abstract readonly info: ImporterInfo

  /** 检测是否可处理此路径 */
  abstract canHandle(sourcePath: string): Promise<boolean>

  /**
   * 解析文件/文件夹，生成中间格式
   * 由子类实现核心解析逻辑
   */
  abstract parse(options: ImportOptions): Promise<ParsedNote[]>

  /**
   * 清理临时资源（如解压的临时目录）
   * 子类可覆写实现具体清理逻辑
   */
  cleanup(): void {
    // 默认空实现，子类可覆写
  }

  // ========== 工具方法（子类复用）==========

  /**
   * Markdown → TipTap JSON
   */
  protected markdownToContent(markdown: string): string {
    return markdownToTiptapString(markdown)
  }

  /**
   * Plain text → TipTap JSON (no Markdown parsing)
   * Split by newlines into paragraphs
   */
  protected plainTextToContent(text: string): string {
    const lines = text.split(/\r?\n/)
    const content: { type: string; content?: { type: string; text: string }[] }[] = []

    for (const line of lines) {
      if (line === '') {
        // Empty line becomes empty paragraph
        content.push({ type: 'paragraph' })
      } else {
        content.push({
          type: 'paragraph',
          content: [{ type: 'text', text: line }]
        })
      }
    }

    return JSON.stringify({ type: 'doc', content })
  }

  /**
   * Check if file is a text file (.txt)
   */
  protected isTextFile(filePath: string): boolean {
    const ext = extname(filePath).toLowerCase()
    return ext === '.txt'
  }

  /**
   * 从文件路径、内容、front matter 提取标题
   * 优先级：front matter > 第一个 # 标题 > 文件名
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

    // 3. 回退到文件名（去扩展名）
    const fileName = basename(filePath)
    const ext = extname(fileName)
    return fileName.slice(0, -ext.length) || fileName
  }

  /**
   * 根据策略解析笔记本名称
   * @param isDirectoryImport 是否是目录导入（用于决定根级文件是否使用目录名作为 notebook）
   */
  protected resolveNotebookName(
    filePath: string,
    rootPath: string,
    strategy: FolderStrategy,
    isDirectoryImport: boolean = false
  ): string | undefined {
    // 计算相对路径
    const relativePath = relative(rootPath, filePath)
    const dir = dirname(relativePath)

    // 根级文件
    if (dir === '.' || dir === '') {
      // 如果是目录导入，根级文件使用目录名作为 notebook
      if (isDirectoryImport && strategy !== 'single-notebook') {
        return basename(rootPath)
      }
      return undefined
    }

    // 分割路径
    const parts = dir.split(sep).filter(Boolean)
    if (parts.length === 0) {
      if (isDirectoryImport && strategy !== 'single-notebook') {
        return basename(rootPath)
      }
      return undefined
    }

    switch (strategy) {
      case 'first-level':
        // 只取第一级文件夹
        return parts[0]

      case 'flatten-path':
        // 完整路径作为笔记本名（用 / 分隔）
        return parts.join('/')

      case 'single-notebook':
        // 由外部指定，这里不处理
        return undefined

      default:
        return parts[0]
    }
  }

  /**
   * 安全路径检查：验证路径是否在允许的基础目录内
   * 使用 realpathSync 解析符号链接，防止符号链接绕过检查
   */
  protected isPathSafe(targetPath: string, basePath: string): boolean {
    try {
      // 如果文件不存在，无法解析真实路径，使用原始路径检查
      if (!existsSync(targetPath)) {
        return resolve(targetPath).startsWith(resolve(basePath))
      }
      // 解析符号链接后的真实路径
      const realTarget = realpathSync(targetPath)
      const realBase = realpathSync(basePath)
      return realTarget.startsWith(realBase)
    } catch {
      // 路径解析失败，拒绝访问
      return false
    }
  }

  /**
   * 收集 Markdown 中的附件引用
   * 支持格式：
   * - ![alt](path)
   * - ![[path]]
   */
  protected collectAttachments(content: string, basePath: string): PendingAttachment[] {
    const attachments: PendingAttachment[] = []
    const seen = new Set<string>()

    // 匹配 ![alt](path) 格式
    const mdImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g
    let match: RegExpExecArray | null

    while ((match = mdImageRegex.exec(content)) !== null) {
      const ref = match[0]
      const path = match[2].trim()

      // 跳过 URL
      if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) {
        continue
      }

      // 跳过已存在的 attachment:// 路径
      if (path.startsWith('attachment://')) {
        continue
      }

      const absolutePath = resolve(basePath, path)
      // 安全检查：防止路径遍历攻击（包括符号链接）
      if (!this.isPathSafe(absolutePath, basePath)) {
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

    // 匹配 ![[path]] 格式（Obsidian 风格）
    const wikiImageRegex = /!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g

    while ((match = wikiImageRegex.exec(content)) !== null) {
      const ref = match[0]
      const path = match[1].trim()

      // 跳过 URL
      if (path.startsWith('http://') || path.startsWith('https://')) {
        continue
      }

      const absolutePath = resolve(basePath, path)
      // 安全检查：防止路径遍历攻击（包括符号链接）
      if (!this.isPathSafe(absolutePath, basePath)) {
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
   * 收集 Wiki 风格内部链接
   * 支持格式：
   * - [[note]]
   * - [[note|alias]]
   * - [[note#heading]]
   * - [[note#^blockId]]
   */
  protected collectWikiLinks(content: string): PendingLink[] {
    const links: PendingLink[] = []
    // 匹配 [[...]] 但不匹配 ![[...]]（那是嵌入）
    const wikiLinkRegex = /(?<!!)\[\[([^\]]+)\]\]/g
    let match: RegExpExecArray | null

    while ((match = wikiLinkRegex.exec(content)) !== null) {
      const original = match[0]
      let linkText = match[1]

      // 处理别名 [[note|alias]]
      const aliasIndex = linkText.indexOf('|')
      if (aliasIndex !== -1) {
        linkText = linkText.substring(0, aliasIndex)
      }

      // 解析锚点和块 ID
      let targetTitle = linkText
      let anchor: string | undefined
      let blockId: string | undefined

      // 检查块 ID [[note#^blockId]]
      const blockMatch = linkText.match(/^(.+)#\^(.+)$/)
      if (blockMatch) {
        targetTitle = blockMatch[1]
        blockId = blockMatch[2]
      } else {
        // 检查锚点 [[note#heading]]
        const anchorMatch = linkText.match(/^(.+)#(.+)$/)
        if (anchorMatch) {
          targetTitle = anchorMatch[1]
          anchor = anchorMatch[2]
        }
      }

      links.push({
        original,
        targetTitle: targetTitle.trim(),
        anchor,
        blockId,
      })
    }

    return links
  }

  /**
   * 从嵌套标签字符串解析标签列表
   */
  protected parseTags(
    tagString: string | string[] | undefined,
    strategy: ImportOptions['tagStrategy']
  ): string[] {
    if (!tagString) return []

    // 处理数组或字符串
    const rawTags = Array.isArray(tagString) ? tagString : [tagString]
    const result: string[] = []

    for (const tag of rawTags) {
      const cleanTag = tag.replace(/^#/, '').trim()
      if (!cleanTag) continue

      switch (strategy) {
        case 'keep-nested':
          // 保持原样
          result.push(cleanTag)
          break

        case 'flatten-all':
          // 拆分为多个标签
          result.push(...cleanTag.split('/').filter(Boolean))
          break

        case 'first-level':
          // 只取第一级
          const firstLevel = cleanTag.split('/')[0]
          if (firstLevel && !result.includes(firstLevel)) {
            result.push(firstLevel)
          }
          break
      }
    }

    // 去重
    return [...new Set(result)]
  }

  /**
   * 检测文件是否为图片
   */
  protected isImageFile(filePath: string): boolean {
    const ext = extname(filePath).toLowerCase()
    return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'].includes(ext)
  }

  /**
   * 检测文件是否为 Markdown
   */
  protected isMarkdownFile(filePath: string): boolean {
    const ext = extname(filePath).toLowerCase()
    return ['.md', '.markdown', '.mdown', '.mkd'].includes(ext)
  }
}
