/**
 * Markdown 导出器
 */

import { existsSync, mkdirSync, writeFileSync, copyFileSync, statSync, readFileSync, rmSync } from 'fs'
import { join, dirname, basename, extname } from 'path'
import { BaseExporter } from '../base-exporter'
import { getNotes, getNotesByIds, getNotebooks } from '../../database'
import { getFullPath } from '../../attachment'
import type { Note, Notebook } from '../../../shared/types'
import type { ExportOptions, ExportResult, ExportStats, ExportErrorInfo } from '../types'

const ATTACHMENT_LINK_EXTENSIONS = new Set([
  // 视频
  '.mp4', '.webm', '.mov', '.avi', '.mkv',
  // 音频
  '.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac',
  // 文档
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  // 压缩包
  '.zip', '.rar', '.7z', '.tar', '.gz',
])

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'
])

const DAILY_EXPORT_DIR_NAME = '日记'
const EXPORT_ROOT_DIR_NAME = 'sanqian-notes'

export class MarkdownExporter extends BaseExporter {
  readonly id = 'markdown'
  readonly name = 'Markdown'
  readonly extension = '.md'

  async export(options: ExportOptions): Promise<ExportResult> {
    const errors: ExportErrorInfo[] = []
    const stats: ExportStats = {
      exportedNotes: 0,
      exportedAttachments: 0,
      totalSize: 0,
    }

    // 进度回调辅助函数
    const emitProgress = options.onProgress || (() => {})

    emitProgress({ type: 'exporting', message: 'Preparing notes...' })

    // 获取要导出的笔记
    let notes: Note[]

    if (options.noteIds && options.noteIds.length > 0) {
      notes = getNotesByIds(options.noteIds)
    } else if (options.notebookIds && options.notebookIds.length > 0) {
      const allNotes = getNotes()
      notes = allNotes.filter((n) => n.notebook_id && options.notebookIds.includes(n.notebook_id))
    } else {
      notes = getNotes()
    }

    // 过滤掉已删除的笔记
    notes = notes.filter((n) => !n.deleted_at)

    if (notes.length === 0) {
      return {
        success: true,
        outputPath: options.outputPath,
        stats,
        errors: [],
      }
    }

    // 获取笔记本信息（用于分组和 front matter）
    const notebooks = getNotebooks()
    const notebookMap = new Map<string, Notebook>()
    for (const nb of notebooks) {
      notebookMap.set(nb.id, nb)
    }

    // 所有批量导出内容统一放在 sanqian-notes 目录下
    const actualOutputDir = join(options.outputPath, EXPORT_ROOT_DIR_NAME)

    // 固定目录名时先清理旧内容，避免残留历史导出文件
    if (existsSync(actualOutputDir)) {
      rmSync(actualOutputDir, { recursive: true, force: true })
    }
    mkdirSync(actualOutputDir, { recursive: true })

    // 用于跟踪文件名避免冲突
    const usedNames = new Map<string, Set<string>>() // dir -> names

    // 导出每个笔记
    let processedCount = 0
    const totalNotes = notes.length

    for (const note of notes) {
      processedCount++
      emitProgress({
        type: 'exporting',
        current: processedCount,
        total: totalNotes,
        message: `Exporting: ${note.title}`,
      })

      try {
        const notebook = note.notebook_id ? notebookMap.get(note.notebook_id) : undefined

        // 确定输出目录
        let outputDir = actualOutputDir

        if (options.groupByNotebook && note.is_daily) {
          outputDir = join(actualOutputDir, DAILY_EXPORT_DIR_NAME)
          if (!existsSync(outputDir)) {
            mkdirSync(outputDir, { recursive: true })
          }
        } else if (options.groupByNotebook && notebook) {
          outputDir = join(actualOutputDir, this.sanitizeFileName(notebook.name))
          if (!existsSync(outputDir)) {
            mkdirSync(outputDir, { recursive: true })
          }
        }

        // 生成文件名
        if (!usedNames.has(outputDir)) {
          usedNames.set(outputDir, new Set())
        }
        const dirNames = usedNames.get(outputDir)!
        const fileName = this.makeUniqueFileName(
          this.sanitizeFileName(note.title),
          dirNames,
          this.extension
        )
        const filePath = join(outputDir, fileName)

        // 生成内容
        let content = ''

        // 添加 front matter
        if (options.includeFrontMatter) {
          content += this.generateFrontMatter(note, notebook)
        }

        // 转换内容为 Markdown
        // 清理零宽空格（内部用于保持空行，导出时不需要）
        let markdown = this.contentToMarkdown(note.content).replace(/\u200B/g, '')

        // 处理附件
        if (options.includeAttachments) {
          const result = await this.processAttachments(
            markdown,
            outputDir,
            note.id
          )
          markdown = result.content
          stats.exportedAttachments += result.copiedCount
          stats.totalSize += result.attachmentSize
        }

        content += markdown

        // 写入文件
        writeFileSync(filePath, content, 'utf-8')
        stats.exportedNotes++
        stats.totalSize += this.getByteLength(content)
      } catch (error) {
        errors.push({
          noteId: note.id,
          title: note.title,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // 如果需要打包为 ZIP
    let finalOutputPath = actualOutputDir

    if (options.asZip) {
      emitProgress({ type: 'zipping', message: 'Creating ZIP archive...' })
      try {
        finalOutputPath = await this.createZipAndCleanup(actualOutputDir)
      } catch (error) {
        emitProgress({
          type: 'error',
          error: error instanceof Error ? error.message : String(error),
        })
        errors.push({
          noteId: '',
          title: 'ZIP Creation',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    emitProgress({
      type: 'done',
      message: `Exported ${stats.exportedNotes} notes`,
    })

    return {
      success: errors.length === 0,
      outputPath: finalOutputPath,
      stats,
      errors,
    }
  }

  /**
   * 处理笔记中的附件
   * 复制附件到输出目录，更新内容中的路径
   */
  private async processAttachments(
    content: string,
    outputDir: string,
    _noteId: string
  ): Promise<{ content: string; copiedCount: number; attachmentSize: number }> {
    let updatedContent = content
    let copiedCount = 0
    let attachmentSize = 0

    const attachmentRefs = this.extractAttachmentReferences(content)
    if (attachmentRefs.length === 0) {
      return { content, copiedCount: 0, attachmentSize: 0 }
    }

    // 创建 assets 目录
    const assetsDir = join(outputDir, 'assets')
    if (!existsSync(assetsDir)) {
      mkdirSync(assetsDir, { recursive: true })
    }

    const usedNames = new Set<string>()

    for (const { relativePath, isImage } of attachmentRefs) {
      try {
        // 获取源文件路径
        const sourcePath = await getFullPath(relativePath)

        if (!existsSync(sourcePath)) {
          continue
        }

        // 生成目标文件名
        const relativePathWithoutRoot = relativePath.startsWith('attachments/')
          ? relativePath.slice('attachments/'.length)
          : relativePath
        const dir = dirname(relativePathWithoutRoot)
        const originalName = basename(relativePathWithoutRoot)
        const originalBaseName = dir && dir !== '.'
          ? `${dir.replace(/[\\/]/g, '_')}_${originalName}`
          : originalName
        const baseNameWithExt = this.ensureExportImageExtension(originalBaseName, sourcePath, isImage)
        let targetName = baseNameWithExt
        let counter = 1

        while (usedNames.has(targetName)) {
          const ext = extname(baseNameWithExt)
          const base = ext ? baseNameWithExt.slice(0, -ext.length) : baseNameWithExt
          if (ext) {
            targetName = `${base} (${counter})${ext}`
          } else {
            targetName = `${base} (${counter})`
          }
          counter++
        }

        usedNames.add(targetName)

        // 复制文件
        const targetPath = join(assetsDir, targetName)
        copyFileSync(sourcePath, targetPath)

        // 更新路径引用（图片、链接和媒体 src）
        const newPath = `./assets/${targetName}`
        updatedContent = this.replaceAttachmentReferences(updatedContent, relativePath, newPath)

        copiedCount++

        // 统计大小
        const { size } = statSync(sourcePath)
        attachmentSize += size
      } catch (error) {
        console.error(`Failed to copy attachment ${relativePath}:`, error)
      }
    }

    return {
      content: updatedContent,
      copiedCount,
      attachmentSize,
    }
  }

  private decodeURIComponentSafe(value: string): string {
    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  }

  private normalizeAttachmentPath(rawPath: string): string {
    let normalized = this.decodeURIComponentSafe(rawPath.trim())

    if (normalized.startsWith('attachment://')) {
      normalized = normalized.slice('attachment://'.length)
    } else if (normalized.startsWith('sanqian://attachment/')) {
      normalized = normalized.slice('sanqian://attachment/'.length)
    }

    return normalized
      .replace(/\\/g, '/')
      .replace(/^\.\/+/, '')
      .replace(/^\/+/, '')
  }

  private isExternalPath(src: string): boolean {
    const lower = src.trim().toLowerCase()
    return (
      lower.startsWith('http://') ||
      lower.startsWith('https://') ||
      lower.startsWith('data:') ||
      lower.startsWith('mailto:') ||
      lower.startsWith('#')
    )
  }

  private getPathExtname(filePath: string): string {
    const withoutQuery = filePath.split(/[?#]/, 1)[0]
    return extname(withoutQuery).toLowerCase()
  }

  private encodePathSegments(relativePath: string): string {
    return relativePath
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')
  }

  private extractAttachmentReferences(content: string): Array<{ relativePath: string; isImage: boolean }> {
    const refs = new Map<string, { isImage: boolean }>()
    let match: RegExpExecArray | null

    const addRef = (rawPath: string, isImage: boolean): void => {
      const normalized = this.normalizeAttachmentPath(rawPath)
      if (!normalized) {
        return
      }
      const existing = refs.get(normalized)
      if (existing) {
        if (isImage) {
          existing.isImage = true
        }
        return
      }
      refs.set(normalized, { isImage })
    }

    // 图片: ![alt](path)
    const imageRegex = /!\[[^\]]*\]\(([^)]+)\)/g
    while ((match = imageRegex.exec(content)) !== null) {
      const src = match[1].trim()
      if (!this.isExternalPath(src)) {
        addRef(src, true)
      }
    }

    // 文件链接: [name](path)
    const attachmentRegex = /\[[^\]]*\]\(([^)]+)\)/g
    while ((match = attachmentRegex.exec(content)) !== null) {
      const src = match[1].trim()
      if (this.isExternalPath(src)) {
        continue
      }
      const normalized = this.normalizeAttachmentPath(src)
      if (ATTACHMENT_LINK_EXTENSIONS.has(this.getPathExtname(normalized))) {
        addRef(normalized, false)
      }
    }

    // 媒体标签: <video src="..."> / <audio src='...'>
    const mediaRegex = /<(?:video|audio)\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi
    while ((match = mediaRegex.exec(content)) !== null) {
      const src = match[1].trim()
      if (!this.isExternalPath(src)) {
        addRef(src, false)
      }
    }

    return [...refs.entries()].map(([relativePath, meta]) => ({
      relativePath,
      isImage: meta.isImage,
    }))
  }

  private ensureExportImageExtension(fileName: string, sourcePath: string, isImage: boolean): string {
    if (!isImage) {
      return fileName
    }

    const currentExt = extname(fileName).toLowerCase()
    if (IMAGE_EXTENSIONS.has(currentExt)) {
      return fileName
    }

    const detectedExt = this.detectImageExtensionFromSource(sourcePath)
    if (!detectedExt) {
      return fileName
    }

    const baseName = currentExt ? fileName.slice(0, -currentExt.length) : fileName
    return `${baseName}${detectedExt}`
  }

  private detectImageExtensionFromSource(sourcePath: string): string | null {
    try {
      const buffer = readFileSync(sourcePath)
      return this.detectImageExtensionFromBuffer(buffer)
    } catch {
      return null
    }
  }

  private detectImageExtensionFromBuffer(buffer: Buffer): string | null {
    if (buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a) {
      return '.png'
    }
    if (buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff) {
      return '.jpg'
    }
    if (buffer.length >= 6) {
      const header6 = buffer.subarray(0, 6).toString('ascii')
      if (header6 === 'GIF87a' || header6 === 'GIF89a') {
        return '.gif'
      }
    }
    if (buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
      return '.webp'
    }
    if (buffer.length >= 2 &&
      buffer[0] === 0x42 &&
      buffer[1] === 0x4d) {
      return '.bmp'
    }

    const textHead = buffer.subarray(0, Math.min(buffer.length, 1024)).toString('utf-8').toLowerCase()
    if (textHead.includes('<svg')) {
      return '.svg'
    }

    return null
  }

  private replaceAttachmentReferences(content: string, relativePath: string, assetPath: string): string {
    const pathVariants = new Set([relativePath, this.encodePathSegments(relativePath)])
    let updated = content

    for (const variant of pathVariants) {
      const escaped = this.escapeRegExp(variant)
      updated = updated
        .replace(new RegExp(`\\]\\(sanqian://attachment/${escaped}\\)`, 'g'), `](${assetPath})`)
        .replace(new RegExp(`\\]\\(attachment://${escaped}\\)`, 'g'), `](${assetPath})`)
        .replace(new RegExp(`\\]\\(${escaped}\\)`, 'g'), `](${assetPath})`)
        .replace(new RegExp(`src=(["'])sanqian://attachment/${escaped}\\1`, 'g'), `src=$1${assetPath}$1`)
        .replace(new RegExp(`src=(["'])attachment://${escaped}\\1`, 'g'), `src=$1${assetPath}$1`)
        .replace(new RegExp(`src=(["'])${escaped}\\1`, 'g'), `src=$1${assetPath}$1`)
    }

    return updated
  }

  private escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  /**
   * 创建 ZIP 文件并清理临时目录
   * 使用 execFile 安全地创建 ZIP（防止命令注入）
   */
  private async createZipAndCleanup(sourcePath: string): Promise<string> {
    const { execFile } = await import('child_process')
    const { promisify } = await import('util')
    const { unlinkSync, rmSync } = await import('fs')
    const execFileAsync = promisify(execFile)

    const zipPath = `${sourcePath}.zip`
    const dirName = basename(sourcePath)
    const parentDir = dirname(sourcePath)

    // 如果 zip 文件已存在，先删除
    if (existsSync(zipPath)) {
      unlinkSync(zipPath)
    }

    const isWindows = process.platform === 'win32'

    try {
      if (isWindows) {
        // Windows: 使用 PowerShell Compress-Archive
        // 通过 ScriptBlock 参数化传递路径，避免命令注入
        // $args[0] 和 $args[1] 分别是源路径和目标路径
        await execFileAsync('powershell', [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '& { Compress-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force }',
          sourcePath,
          zipPath,
        ], { cwd: parentDir, timeout: 60000, maxBuffer: 10 * 1024 * 1024 })
      } else {
        // macOS/Linux: 使用 zip 命令，-q 静默模式减少输出
        await execFileAsync('zip', ['-rq', zipPath, dirName], {
          cwd: parentDir,
          timeout: 60000,
          maxBuffer: 10 * 1024 * 1024  // 10MB buffer
        })
      }

      // 删除临时目录
      rmSync(sourcePath, { recursive: true, force: true })

      return zipPath
    } catch (error) {
      throw new Error(`ZIP creation failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
