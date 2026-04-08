/**
 * 导入导出模块主入口
 */

import { MarkdownImporter } from './importers/markdown-importer'
import { ObsidianImporter } from './importers/obsidian-importer'
import { NotionImporter } from './importers/notion-importer'
import { PdfImporter } from './importers/pdf-importer'
import { MarkdownExporter } from './exporters/markdown-exporter'
import { BaseImporter } from './base-importer'
import { copyAttachmentsAndUpdateContent } from './utils/attachment-handler'
import { resolveWikiLinksInContent } from './utils/link-resolver'
import {
  forEachWithConcurrency,
  resolvePositiveIntegerEnv,
  yieldEvery,
} from './utils/cooperative'
import {
  addNotesBatch,
  addNotebook,
  getLiveNoteTitleEntries,
  getNotebooks,
  getNotesByIds,
  updateNote,
} from '../database'
import { indexingService } from '../embedding/indexing-service'
import { getEmbeddingConfig } from '../embedding/database'
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
  new PdfImporter(),
  new MarkdownImporter(), // Markdown 放最后作为通用导入器
]

const exporters: Partial<Record<ExportFormat, MarkdownExporter>> = {
  markdown: new MarkdownExporter(),
}

const IMPORT_YIELD_INTERVAL = resolvePositiveIntegerEnv('IMPORT_EXPORT_YIELD_INTERVAL', 32, { min: 8, max: 4096 })
const IMPORT_DB_BATCH_SIZE = resolvePositiveIntegerEnv('IMPORT_DB_BATCH_SIZE', 64, { min: 1, max: 1000 })
const IMPORT_INDEX_CONCURRENCY = resolvePositiveIntegerEnv('IMPORT_INDEX_CONCURRENCY', 2, { min: 1, max: 8 })
const IMPORT_FTS_ONLY_INDEX_CONCURRENCY = resolvePositiveIntegerEnv(
  'IMPORT_FTS_ONLY_INDEX_CONCURRENCY',
  1,
  { min: 1, max: 4 }
)
const IMPORT_INDEX_YIELD_INTERVAL = resolvePositiveIntegerEnv(
  'IMPORT_INDEX_YIELD_INTERVAL',
  8,
  { min: 1, max: 1024 }
)
const IMPORT_EXEC_PROFILE = process.env.IMPORT_EXEC_PROFILE === '1'
const IMPORT_EXEC_SLOW_LOG_MS = Number.isFinite(Number(process.env.IMPORT_EXEC_SLOW_LOG_MS))
  ? Math.max(500, Math.floor(Number(process.env.IMPORT_EXEC_SLOW_LOG_MS)))
  : 3000

interface ImportExecutionProfileSummary {
  sourceCount: number
  totalFiles: number
  importedCount: number
  skippedCount: number
  errorCount: number
  importedAttachments: number
  parseMs: number
  setupMs: number
  createMs: number
  linkResolveMs: number
  indexMs: number
  totalMs: number
  usedCachedPreview: boolean
  shouldBuildEmbedding: boolean
  dbBatchSize: number
  indexConcurrency: number
  yieldInterval: number
}

function maybeLogImportExecutionSummary(
  summary: ImportExecutionProfileSummary,
  success: boolean,
  fatalError?: string
): void {
  if (!IMPORT_EXEC_PROFILE && summary.totalMs < IMPORT_EXEC_SLOW_LOG_MS) return
  console.info('[Import] Execute summary', {
    success,
    ...summary,
    fatalError: fatalError || undefined,
  })
}

// ============ 预览缓存 ============
// 缓存预览解析结果，避免 executeImport 重复解析

interface PreviewCache {
  sourcePaths: string[]
  importerMap: Map<string, BaseImporter>  // path -> importer
  parsedNotes: ParsedNote[]
  timestamp: number
}

let previewCache: PreviewCache | null = null
const CACHE_TTL = 5 * 60 * 1000 // 5 分钟过期

function getCachedPreview(sourcePaths: string[]): PreviewCache | null {
  if (!previewCache) return null
  // 检查路径是否完全匹配
  if (sourcePaths.length !== previewCache.sourcePaths.length) return null
  const sortedNew = [...sourcePaths].sort()
  const sortedCached = [...previewCache.sourcePaths].sort()
  if (!sortedNew.every((p, i) => p === sortedCached[i])) return null
  if (Date.now() - previewCache.timestamp > CACHE_TTL) {
    previewCache = null
    return null
  }
  return previewCache
}

function setCachedPreview(
  sourcePaths: string[],
  importerMap: Map<string, BaseImporter>,
  parsedNotes: ParsedNote[]
): void {
  previewCache = {
    sourcePaths,
    importerMap,
    parsedNotes,
    timestamp: Date.now(),
  }
}

function clearPreviewCache(): void {
  previewCache = null
}

/** 标准化路径为数组 */
function normalizePaths(sourcePath: string | string[]): string[] {
  return Array.isArray(sourcePath) ? sourcePath : [sourcePath]
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
  const sourcePaths = normalizePaths(options.sourcePath)
  const allParsedNotes: ParsedNote[] = []
  const importerMap = new Map<string, BaseImporter>()
  const importerNames = new Set<string>()

  // 处理每个路径
  for (const path of sourcePaths) {
    // 找到合适的导入器
    let importer: BaseImporter | undefined
    for (const imp of importers) {
      if (await imp.canHandle(path)) {
        importer = imp
        break
      }
    }
    if (!importer) {
      throw new Error(`No suitable importer found for: ${path}`)
    }

    importerMap.set(path, importer)
    importerNames.add(importer.info.name)

    // 解析文件
    const parsedNotes = await importer.parse({ ...options, sourcePath: path })
    allParsedNotes.push(...parsedNotes)
  }

  // 缓存解析结果
  setCachedPreview(sourcePaths, importerMap, allParsedNotes)

  // 收集笔记本名称
  const notebookNames = new Set<string>()
  for (const note of allParsedNotes) {
    if (note.notebookName) {
      notebookNames.add(note.notebookName)
    }
  }

  // 统计附件数量
  let attachmentCount = 0
  for (const note of allParsedNotes) {
    attachmentCount += note.attachments.length
  }

  // 文件预览（前 100 个）
  const files = allParsedNotes.slice(0, 100).map((n) => ({
    path: n.sourcePath,
    title: n.title,
    notebookName: n.notebookName,
  }))

  // 使用第一个导入器的信息，或者合并名称
  const firstImporter = importerMap.values().next().value
  const importerName = importerNames.size === 1
    ? firstImporter?.info.name || 'Unknown'
    : Array.from(importerNames).join(' + ')

  return {
    importerId: firstImporter?.info.id || 'markdown',
    importerName,
    noteCount: allParsedNotes.length,
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

  // 声明在 try 外部，以便 finally 中可以调用 cleanup（使用 Set 去重）
  const usedImporters = new Set<BaseImporter>()
  let parsedNotes: ParsedNote[]

  const sourcePaths = normalizePaths(options.sourcePath)
  let usedCachedPreview = false
  let shouldBuildEmbedding = false
  let parseMs = 0
  let setupMs = 0
  let createMs = 0
  let linkResolveMs = 0
  let indexMs = 0
  let importSuccess = false
  let fatalError: string | undefined

  try {
    const parseStartedAt = Date.now()

    // 尝试使用缓存的预览结果
    const cached = getCachedPreview(sourcePaths)
    if (cached) {
      usedCachedPreview = true
      for (const imp of cached.importerMap.values()) {
        usedImporters.add(imp)
      }
      parsedNotes = cached.parsedNotes
      clearPreviewCache() // 使用后清除缓存
      emitProgress({ type: 'parsing', message: `Using cached preview...` })
    } else {
      // 没有缓存，重新解析
      emitProgress({ type: 'scanning', message: 'Detecting importer...' })

        parsedNotes = []
      for (const path of sourcePaths) {
        let foundImporter: BaseImporter | undefined
        for (const imp of importers) {
          if (await imp.canHandle(path)) {
            foundImporter = imp
            break
          }
        }

        if (!foundImporter) {
          throw new Error(`No suitable importer found for: ${path}`)
        }
        usedImporters.add(foundImporter)

        // 解析文件
        emitProgress({ type: 'parsing', message: `Parsing files with ${foundImporter.info.name}...` })
        const notes = await foundImporter.parse({ ...options, sourcePath: path })
        parsedNotes.push(...notes)
      }
    }
    parseMs = Date.now() - parseStartedAt

    totalFiles = parsedNotes.length
    emitProgress({ type: 'parsing', current: totalFiles, total: totalFiles, message: `Found ${totalFiles} notes` })
    const setupStartedAt = Date.now()

    // 获取现有笔记本
    const existingNotebooks = getNotebooks()
    const notebookNameToId = new Map<string, string>()
    let notebookScanCount = 0
    for (const nb of existingNotebooks) {
      notebookNameToId.set(nb.name.toLowerCase(), nb.id)
      notebookScanCount += 1
      await yieldEvery(notebookScanCount, IMPORT_YIELD_INTERVAL)
    }

    // 获取现有笔记标题（用于冲突检测）
    const existingTitles = new Map<string, string>() // title -> id
    let existingTitleCount = 0
    const existingTitleEntries = getLiveNoteTitleEntries()
    for (const note of existingTitleEntries) {
      existingTitles.set(note.title.toLowerCase(), note.id)
      existingTitleCount += 1
      await yieldEvery(existingTitleCount, IMPORT_YIELD_INTERVAL)
    }

    // 创建需要的笔记本
    const notebooksToCreate = new Set<string>()
    let notebookCollectCount = 0
    for (const note of parsedNotes) {
      const notebookName = note.notebookName

      // 处理 single-notebook 策略
      if (options.folderStrategy === 'single-notebook' && options.targetNotebookId) {
        notebookCollectCount += 1
        await yieldEvery(notebookCollectCount, IMPORT_YIELD_INTERVAL)
        continue
      }

      // 根级文件使用默认笔记本
      if (!notebookName && options.defaultNotebookId) {
        notebookCollectCount += 1
        await yieldEvery(notebookCollectCount, IMPORT_YIELD_INTERVAL)
        continue
      }

      if (notebookName && !notebookNameToId.has(notebookName.toLowerCase())) {
        notebooksToCreate.add(notebookName)
      }
      notebookCollectCount += 1
      await yieldEvery(notebookCollectCount, IMPORT_YIELD_INTERVAL)
    }

    // 批量创建笔记本
    let createdNotebookCount = 0
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
      createdNotebookCount += 1
      await yieldEvery(createdNotebookCount, IMPORT_YIELD_INTERVAL)
    }
    setupMs = Date.now() - setupStartedAt
    const createStartedAt = Date.now()

    interface PendingInsert {
      noteInput: NoteInput
      sourcePath: string
      normalizedTitle: string
    }

    const pendingInserts: PendingInsert[] = []
    const isPendingTitleReservation = (id: string | undefined): boolean => (id || '').startsWith('__pending__:')

    const flushPendingInserts = async (): Promise<void> => {
      if (pendingInserts.length === 0) return

      const currentBatch = pendingInserts.splice(0, pendingInserts.length)

      try {
        const createdBatch = addNotesBatch(currentBatch.map((item) => item.noteInput))
        if (createdBatch.length !== currentBatch.length) {
          throw new Error(`Batch insert mismatch: expected ${currentBatch.length}, got ${createdBatch.length}`)
        }

        for (let i = 0; i < createdBatch.length; i += 1) {
          const createdNote = createdBatch[i]
          const pending = currentBatch[i]
          existingTitles.set(pending.normalizedTitle, createdNote.id)
          importedNotes.push({
            id: createdNote.id,
            title: createdNote.title,
            sourcePath: pending.sourcePath,
          })
          await yieldEvery(i + 1, IMPORT_YIELD_INTERVAL)
        }
      } catch (batchError) {
        for (let i = 0; i < currentBatch.length; i += 1) {
          const pending = currentBatch[i]
          try {
            const [createdNote] = addNotesBatch([pending.noteInput])
            if (!createdNote) {
              throw new Error('No note returned from single-note fallback insert')
            }
            existingTitles.set(pending.normalizedTitle, createdNote.id)
            importedNotes.push({
              id: createdNote.id,
              title: createdNote.title,
              sourcePath: pending.sourcePath,
            })
          } catch (singleError) {
            existingTitles.delete(pending.normalizedTitle)
            errors.push({
              path: pending.sourcePath,
              error: singleError instanceof Error ? singleError.message : String(singleError),
            })
          }
          await yieldEvery(i + 1, IMPORT_YIELD_INTERVAL)
        }
        console.warn('[Import] Batch insert failed, fell back to single-note inserts:', batchError)
      }
    }

    // 导入每个笔记
    let processedCount = 0
    for (const parsed of parsedNotes) {
      processedCount += 1
      emitProgress({
        type: 'creating',
        current: processedCount,
        total: totalFiles,
        message: `Importing: ${parsed.title}`,
      })

      try {
        const normalizedTitle = parsed.title.toLowerCase()

        // 冲突检测
        let existingId = existingTitles.get(normalizedTitle)
        if (isPendingTitleReservation(existingId) && options.conflictStrategy === 'overwrite') {
          await flushPendingInserts()
          existingId = existingTitles.get(normalizedTitle)
        }

        if (existingId) {
          switch (options.conflictStrategy) {
            case 'skip':
              skippedFiles.push({
                path: parsed.sourcePath,
                reason: 'Note with same title already exists',
              })
              await yieldEvery(processedCount, IMPORT_YIELD_INTERVAL)
              continue

            case 'rename':
              // 添加序号
              let newTitle = parsed.title
              let counter = 1
              while (existingTitles.has(newTitle.toLowerCase())) {
                newTitle = `${parsed.title} (${counter})`
                counter += 1
              }
              parsed.title = newTitle
              break

            case 'overwrite':
              // 更新现有笔记
              if (isPendingTitleReservation(existingId)) {
                let newTitle = parsed.title
                let counter = 1
                while (existingTitles.has(newTitle.toLowerCase())) {
                  newTitle = `${parsed.title} (${counter})`
                  counter += 1
                }
                parsed.title = newTitle
                break
              }

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
              await yieldEvery(processedCount, IMPORT_YIELD_INTERVAL)
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

        // 批量创建笔记（事务）
        const finalNormalizedTitle = parsed.title.toLowerCase()
        pendingInserts.push({
          noteInput: {
            title: parsed.title,
            content,
            notebook_id: notebookId,
          },
          sourcePath: parsed.sourcePath,
          normalizedTitle: finalNormalizedTitle,
        })
        existingTitles.set(finalNormalizedTitle, `__pending__:${pendingInserts.length}`)

        if (pendingInserts.length >= IMPORT_DB_BATCH_SIZE) {
          await flushPendingInserts()
        }
      } catch (error) {
        errors.push({
          path: parsed.sourcePath,
          error: error instanceof Error ? error.message : String(error),
        })
      }

      await yieldEvery(processedCount, IMPORT_YIELD_INTERVAL)
    }
    await flushPendingInserts()
    createMs = Date.now() - createStartedAt

    // ========== 第二遍：解析内部链接 ==========
    const linkResolveStartedAt = Date.now()
    // 建立标题到笔记 ID 的映射（包括新导入的和已存在的）
    const titleToNoteId = new Map<string, string>()

    // 添加已存在的笔记
    let titleToIdCount = 0
    for (const [title, id] of existingTitles) {
      if (isPendingTitleReservation(id)) continue
      titleToNoteId.set(title, id)
      titleToIdCount += 1
      await yieldEvery(titleToIdCount, IMPORT_YIELD_INTERVAL)
    }

    // 添加新导入的笔记
    for (const note of importedNotes) {
      titleToNoteId.set(note.title.toLowerCase(), note.id)
      titleToIdCount += 1
      await yieldEvery(titleToIdCount, IMPORT_YIELD_INTERVAL)
    }

    const importedIds = importedNotes.map((n) => n.id)
    const notesById = new Map(getNotesByIds(importedIds).map((n) => [n.id, n]))

    // 解析每个导入笔记中的 wiki 链接
    let resolvedLinkCount = 0
    for (const importedNote of importedNotes) {
      try {
        // O(1) 查找当前笔记
        const currentNote = notesById.get(importedNote.id)
        if (!currentNote) {
          resolvedLinkCount += 1
          await yieldEvery(resolvedLinkCount, IMPORT_YIELD_INTERVAL)
          continue
        }

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
      resolvedLinkCount += 1
      await yieldEvery(resolvedLinkCount, IMPORT_YIELD_INTERVAL)
    }
    linkResolveMs = Date.now() - linkResolveStartedAt

    // ========== 第三遍：建立搜索索引 ==========
    // FTS 索引默认建立，Embedding 索引根据 options.buildEmbedding 决定
    const embeddingConfig = getEmbeddingConfig()
    shouldBuildEmbedding = Boolean(options.buildEmbedding) && embeddingConfig.enabled
    const indexStartedAt = Date.now()

    emitProgress({
      type: 'creating',
      message: shouldBuildEmbedding
        ? 'Building FTS and embedding index...'
        : 'Building FTS index...',
    })

    // 重新获取本次导入笔记，避免加载整个库
    const finalNotesById = new Map(getNotesByIds(importedIds).map((n) => [n.id, n]))
    const importIndexConcurrency = shouldBuildEmbedding
      ? IMPORT_INDEX_CONCURRENCY
      : IMPORT_FTS_ONLY_INDEX_CONCURRENCY

    await forEachWithConcurrency(importedNotes, importIndexConcurrency, async (importedNote, index) => {
      try {
        const note = finalNotesById.get(importedNote.id)
        if (!note) return

        if (shouldBuildEmbedding) {
          // FTS + Embedding
          await indexingService.indexNoteFull(note.id, note.notebook_id || '', note.content)
        } else {
          // FTS only
          await indexingService.indexNoteFtsOnly(note.id, note.notebook_id || '', note.content)
        }
      } catch (error) {
        // 索引失败不影响导入结果，只记录日志
        console.error(`Failed to index note ${importedNote.id}:`, error)
      }
      await yieldEvery(index + 1, IMPORT_INDEX_YIELD_INTERVAL)
    })
    indexMs = Date.now() - indexStartedAt

    emitProgress({
      type: 'done',
      message: `Imported ${importedNotes.length} notes`,
    })
    importSuccess = true

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
    fatalError = error instanceof Error ? error.message : String(error)
    emitProgress({
      type: 'error',
      error: fatalError,
    })

    return {
      success: false,
      importedNotes,
      skippedFiles,
      errors: [
        {
          path: sourcePaths.join(', '),
          error: fatalError,
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
    const totalMs = Date.now() - startTime
    maybeLogImportExecutionSummary(
      {
        sourceCount: sourcePaths.length,
        totalFiles,
        importedCount: importedNotes.length,
        skippedCount: skippedFiles.length,
        errorCount: errors.length + (importSuccess ? 0 : 1),
        importedAttachments,
        parseMs,
        setupMs,
        createMs,
        linkResolveMs,
        indexMs,
        totalMs,
        usedCachedPreview,
        shouldBuildEmbedding,
        dbBatchSize: IMPORT_DB_BATCH_SIZE,
        indexConcurrency: shouldBuildEmbedding
          ? IMPORT_INDEX_CONCURRENCY
          : IMPORT_FTS_ONLY_INDEX_CONCURRENCY,
        yieldInterval: IMPORT_YIELD_INTERVAL,
      },
      importSuccess,
      fatalError
    )

    // 清理导入器的临时资源（如 Notion 解压的临时目录）
    for (const imp of usedImporters) {
      imp.cleanup()
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
