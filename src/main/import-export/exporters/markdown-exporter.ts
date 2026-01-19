/**
 * Markdown 导出器
 */

import { existsSync, mkdirSync, writeFileSync, copyFileSync, statSync } from 'fs'
import { join, dirname, basename } from 'path'
import { BaseExporter } from '../base-exporter'
import { getNotes, getNotesByIds, getNotebooks } from '../../database'
import { getFullPath } from '../../attachment'
import type { Note, Notebook } from '../../../shared/types'
import type { ExportOptions, ExportResult, ExportStats, ExportErrorInfo } from '../types'

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

    // 确定实际输出目录
    // 如果需要打包为 ZIP，先创建一个子目录
    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const exportDirName = `sanqian-export-${timestamp}`
    const actualOutputDir = options.asZip
      ? join(options.outputPath, exportDirName)
      : options.outputPath

    // 确保输出目录存在
    if (!existsSync(actualOutputDir)) {
      mkdirSync(actualOutputDir, { recursive: true })
    }

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

        if (options.groupByNotebook && notebook) {
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

    // 匹配 attachment:// 路径
    const attachmentRegex = /!\[([^\]]*)\]\(attachment:\/\/([^)]+)\)/g
    const matches = [...content.matchAll(attachmentRegex)]

    if (matches.length === 0) {
      return { content, copiedCount: 0, attachmentSize: 0 }
    }

    // 创建附件目录
    const attachmentDir = join(outputDir, 'attachments')
    if (!existsSync(attachmentDir)) {
      mkdirSync(attachmentDir, { recursive: true })
    }

    const usedNames = new Set<string>()

    for (const match of matches) {
      const [fullMatch, altText, relativePath] = match

      try {
        // 获取源文件路径
        const sourcePath = await getFullPath(relativePath)

        if (!existsSync(sourcePath)) {
          continue
        }

        // 生成目标文件名
        const originalName = basename(relativePath)
        let targetName = originalName
        let counter = 1

        while (usedNames.has(targetName)) {
          const ext = targetName.lastIndexOf('.')
          if (ext > 0) {
            targetName = `${targetName.slice(0, ext)} (${counter})${targetName.slice(ext)}`
          } else {
            targetName = `${originalName} (${counter})`
          }
          counter++
        }

        usedNames.add(targetName)

        // 复制文件
        const targetPath = join(attachmentDir, targetName)
        copyFileSync(sourcePath, targetPath)

        // 更新路径引用
        const newPath = `./attachments/${targetName}`
        updatedContent = updatedContent.replace(fullMatch, `![${altText}](${newPath})`)

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
