/**
 * 导入导出模块主入口
 */

import { MarkdownImporter } from './importers/markdown-importer'
import { ObsidianImporter } from './importers/obsidian-importer'
import { NotionImporter } from './importers/notion-importer'
import { MarkdownExporter } from './exporters/markdown-exporter'
import { BaseImporter } from './base-importer'
import { copyAttachmentsAndUpdateContent } from './utils/attachment-handler'
import { resolveWikiLinksInContent } from './utils/link-resolver'
import {
  addNote,
  addNotebook,
  getNotebooks,
  getNotes,
  updateNote,
} from '../database'
import type { NoteInput } from '../../shared/types'
import type {
  ImportOptions,
  ImportResult,
  ImportPreview,
  ExportOptions,
  ExportResult,
  ExportFormat,
  ImporterInfo,
  ParsedNote,
  ImportedNoteInfo,
  SkippedFileInfo,
  ImportErrorInfo,
  CreatedNotebookInfo,
} from './types'

// ============ 导入器注册 ============
// 注意：更具体的导入器放在前面（如 Notion ZIP、Obsidian 优先于通用 Markdown）

const importers: BaseImporter[] = [
  new NotionImporter(),
  new ObsidianImporter(),
  new MarkdownImporter(),
]

const exporters: Partial<Record<ExportFormat, MarkdownExporter>> = {
  markdown: new MarkdownExporter(),
}

// ============ 预览缓存 ============
// 缓存预览解析结果，避免 executeImport 重复解析

interface PreviewCache {
  sourcePath: string
  importer: BaseImporter
  parsedNotes: ParsedNote[]
  timestamp: number
}

let previewCache: PreviewCache | null = null
const CACHE_TTL = 5 * 60 * 1000 // 5 分钟过期

function getCachedPreview(sourcePath: string): PreviewCache | null {
  if (!previewCache) return null
  if (previewCache.sourcePath !== sourcePath) return null
  if (Date.now() - previewCache.timestamp > CACHE_TTL) {
    previewCache = null
    return null
  }
  return previewCache
}

function setCachedPreview(sourcePath: string, importer: BaseImporter, parsedNotes: ParsedNote[]): void {
  previewCache = {
    sourcePath,
    importer,
    parsedNotes,
    timestamp: Date.now(),
  }
}

function clearPreviewCache(): void {
  previewCache = null
}

// ============ 导出 API ============

/**
 * 获取所有可用的导入器信息
 */
export function getImporters(): ImporterInfo[] {
  return importers.map((i) => i.info)
}

/**
 * 检测文件/文件夹适合哪个导入器
 */
export async function detectImporter(sourcePath: string): Promise<ImporterInfo | null> {
  for (const importer of importers) {
    if (await importer.canHandle(sourcePath)) {
      return importer.info
    }
  }
  return null
}

/**
 * 预览导入（扫描但不执行）
 * 解析结果会被缓存，供后续 executeImport 使用
 */
export async function previewImport(options: ImportOptions): Promise<ImportPreview> {

  // 找到合适的导入器
  let importer: BaseImporter | undefined
  for (const imp of importers) {
    if (await imp.canHandle(options.sourcePath)) {
      importer = imp
      break
    }
  }
  if (!importer) {
    throw new Error('No suitable importer found for this source')
  }

  // 解析文件
  const parsedNotes = await importer.parse(options)

  // 缓存解析结果
  setCachedPreview(options.sourcePath, importer, parsedNotes)

  // 收集笔记本名称
  const notebookNames = new Set<string>()
  for (const note of parsedNotes) {
    if (note.notebookName) {
      notebookNames.add(note.notebookName)
    }
  }

  // 统计附件数量
  let attachmentCount = 0
  for (const note of parsedNotes) {
    attachmentCount += note.attachments.length
  }

  // 文件预览（前 100 个）
  const files = parsedNotes.slice(0, 100).map((n) => ({
    path: n.sourcePath,
    title: n.title,
    notebookName: n.notebookName,
  }))

  return {
    importerId: importer.info.id,
    importerName: importer.info.name,
    noteCount: parsedNotes.length,
    notebookNames: Array.from(notebookNames),
    attachmentCount,
    files,
  }
}

/**
 * 执行导入
 */
export async function executeImport(options: ImportOptions): Promise<ImportResult> {
  const startTime = Date.now()
  const importedNotes: ImportedNoteInfo[] = []
  const skippedFiles: SkippedFileInfo[] = []
  const errors: ImportErrorInfo[] = []
  const createdNotebooks: CreatedNotebookInfo[] = []

  let totalFiles = 0
  let importedAttachments = 0

  // 进度回调辅助函数
  const emitProgress = options.onProgress || (() => {})

  // 声明在 try 外部，以便 finally 中可以调用 cleanup
  let importer: BaseImporter | undefined
  let parsedNotes: ParsedNote[]

  try {

    // 尝试使用缓存的预览结果
    const cached = getCachedPreview(options.sourcePath)
    if (cached) {
      importer = cached.importer
      parsedNotes = cached.parsedNotes
      clearPreviewCache() // 使用后清除缓存
      emitProgress({ type: 'parsing', message: `Using cached preview from ${importer.info.name}...` })
    } else {
      // 没有缓存，重新解析
      emitProgress({ type: 'scanning', message: 'Detecting importer...' })

      let foundImporter: BaseImporter | undefined
      for (const imp of importers) {
        if (await imp.canHandle(options.sourcePath)) {
          foundImporter = imp
          break
        }
      }

      if (!foundImporter) {
        throw new Error('No suitable importer found for this source')
      }
      importer = foundImporter

      // 解析文件
      emitProgress({ type: 'parsing', message: `Parsing files with ${importer.info.name}...` })
      parsedNotes = await importer.parse(options)
    }

    totalFiles = parsedNotes.length
    emitProgress({ type: 'parsing', current: totalFiles, total: totalFiles, message: `Found ${totalFiles} notes` })

    // 获取现有笔记本
    const existingNotebooks = getNotebooks()
    const notebookNameToId = new Map<string, string>()
    for (const nb of existingNotebooks) {
      notebookNameToId.set(nb.name.toLowerCase(), nb.id)
    }

    // 获取现有笔记标题（用于冲突检测）
    const existingNotes = getNotes()
    const existingTitles = new Map<string, string>() // title -> id
    for (const note of existingNotes) {
      if (!note.deleted_at) {
        existingTitles.set(note.title.toLowerCase(), note.id)
      }
    }

    // 创建需要的笔记本
    const notebooksToCreate = new Set<string>()

    for (const note of parsedNotes) {
      const notebookName = note.notebookName

      // 处理 single-notebook 策略
      if (options.folderStrategy === 'single-notebook' && options.targetNotebookId) {
        // 使用指定的笔记本，不需要创建
        continue
      }

      // 根级文件使用默认笔记本
      if (!notebookName && options.defaultNotebookId) {
        // 使用指定的默认笔记本，不需要创建
        continue
      }

      if (notebookName && !notebookNameToId.has(notebookName.toLowerCase())) {
        notebooksToCreate.add(notebookName)
      }
    }

    // 批量创建笔记本
    for (const name of notebooksToCreate) {
      try {
        const notebook = addNotebook({ name, icon: 'logo:notes' })
        notebookNameToId.set(name.toLowerCase(), notebook.id)
        createdNotebooks.push({ id: notebook.id, name })
      } catch (error) {
        errors.push({
          path: `Notebook: ${name}`,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // 建立标题到笔记的映射（用于内部链接解析）
    const titleToNote = new Map<string, ParsedNote>()
    for (const note of parsedNotes) {
      titleToNote.set(note.title.toLowerCase(), note)
    }

    // 导入每个笔记
    let processedCount = 0
    for (const parsed of parsedNotes) {
      processedCount++
      emitProgress({
        type: 'creating',
        current: processedCount,
        total: totalFiles,
        message: `Importing: ${parsed.title}`,
      })

      try {
        // 冲突检测
        const existingId = existingTitles.get(parsed.title.toLowerCase())
        if (existingId) {
          switch (options.conflictStrategy) {
            case 'skip':
              skippedFiles.push({
                path: parsed.sourcePath,
                reason: 'Note with same title already exists',
              })
              continue

            case 'rename':
              // 添加序号
              let newTitle = parsed.title
              let counter = 1
              while (existingTitles.has(newTitle.toLowerCase())) {
                newTitle = `${parsed.title} (${counter})`
                counter++
              }
              parsed.title = newTitle
              break

            case 'overwrite':
              // 更新现有笔记
              let content = parsed.content

              // 处理附件
              if (options.importAttachments && parsed.attachments.length > 0) {
                emitProgress({
                  type: 'copying',
                  message: `Copying ${parsed.attachments.length} attachments for: ${parsed.title}`,
                })
                const result = await copyAttachmentsAndUpdateContent(
                  content,
                  parsed.attachments
                )
                content = result.updatedContent
                importedAttachments += result.copiedCount
              }

              updateNote(existingId, { content })
              importedNotes.push({
                id: existingId,
                title: parsed.title,
                sourcePath: parsed.sourcePath,
              })
              continue
          }
        }

        // 确定笔记本 ID
        let notebookId: string | null = null

        if (options.folderStrategy === 'single-notebook' && options.targetNotebookId) {
          notebookId = options.targetNotebookId
        } else if (parsed.notebookName) {
          notebookId = notebookNameToId.get(parsed.notebookName.toLowerCase()) || null
        } else if (options.defaultNotebookId) {
          notebookId = options.defaultNotebookId
        }

        // 处理附件
        let content = parsed.content

        if (options.importAttachments && parsed.attachments.length > 0) {
          emitProgress({
            type: 'copying',
            message: `Copying ${parsed.attachments.length} attachments for: ${parsed.title}`,
          })
          const result = await copyAttachmentsAndUpdateContent(content, parsed.attachments)
          content = result.updatedContent
          importedAttachments += result.copiedCount
        }

        // 创建笔记
        const noteInput: NoteInput = {
          title: parsed.title,
          content,
          notebook_id: notebookId,
        }

        const note = addNote(noteInput)

        // 更新已存在的标题映射
        existingTitles.set(parsed.title.toLowerCase(), note.id)

        importedNotes.push({
          id: note.id,
          title: note.title,
          sourcePath: parsed.sourcePath,
        })
      } catch (error) {
        errors.push({
          path: parsed.sourcePath,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // ========== 第二遍：解析内部链接 ==========
    // 建立标题到笔记 ID 的映射（包括新导入的和已存在的）
    const titleToNoteId = new Map<string, string>()

    // 添加已存在的笔记
    for (const [title, id] of existingTitles) {
      titleToNoteId.set(title, id)
    }

    // 添加新导入的笔记
    for (const note of importedNotes) {
      titleToNoteId.set(note.title.toLowerCase(), note.id)
    }

    // 一次性获取所有笔记，避免循环内重复查询数据库
    const allCurrentNotes = getNotes()
    const notesById = new Map(allCurrentNotes.map((n) => [n.id, n]))

    // 解析每个导入笔记中的 wiki 链接
    for (const importedNote of importedNotes) {
      try {
        // O(1) 查找当前笔记
        const currentNote = notesById.get(importedNote.id)
        if (!currentNote) continue

        // 解析 wiki 链接
        const resolvedContent = resolveWikiLinksInContent(currentNote.content, titleToNoteId)

        // 只有内容变化时才更新
        if (resolvedContent !== currentNote.content) {
          updateNote(importedNote.id, { content: resolvedContent })
        }
      } catch (error) {
        // 链接解析失败不影响导入结果，只记录日志
        console.error(`Failed to resolve links in note ${importedNote.id}:`, error)
      }
    }

    emitProgress({
      type: 'done',
      message: `Imported ${importedNotes.length} notes`,
    })

    return {
      success: errors.length === 0,
      importedNotes,
      skippedFiles,
      errors,
      createdNotebooks,
      stats: {
        totalFiles,
        importedNotes: importedNotes.length,
        importedAttachments,
        skippedFiles: skippedFiles.length,
        errorCount: errors.length,
        duration: Date.now() - startTime,
      },
    }
  } catch (error) {
    emitProgress({
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    })

    return {
      success: false,
      importedNotes,
      skippedFiles,
      errors: [
        {
          path: options.sourcePath,
          error: error instanceof Error ? error.message : String(error),
        },
      ],
      createdNotebooks,
      stats: {
        totalFiles,
        importedNotes: importedNotes.length,
        importedAttachments,
        skippedFiles: skippedFiles.length,
        errorCount: 1,
        duration: Date.now() - startTime,
      },
    }
  } finally {
    // 清理导入器的临时资源（如 Notion 解压的临时目录）
    if (importer) {
      importer.cleanup()
    }
  }
}

/**
 * 执行导出
 */
export async function executeExport(options: ExportOptions): Promise<ExportResult> {
  const exporter = exporters[options.format]
  if (!exporter) {
    throw new Error(`Unsupported export format: ${options.format}`)
  }

  return exporter.export(options)
}

// ============ 类型导出 ============

export type {
  ImportOptions,
  ImportResult,
  ImportPreview,
  ExportOptions,
  ExportResult,
  ImporterInfo,
}
