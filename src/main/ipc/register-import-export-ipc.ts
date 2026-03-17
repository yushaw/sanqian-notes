import type { IpcMain, WebContentsView } from 'electron'
import type {
  ImportOptions,
  ExportOptions,
} from '../import-export'
import type { MarkdownExportOptions, PDFExportOptions } from '../export'
import type { PdfServiceConfigs } from '../import-export/pdf-config'
import type { PdfParseProgress } from '../import-export/pdf-services/types'
import type { ArxivImportOptions, ArxivBatchProgress, ArxivInlineImportOptions } from '../import-export/arxiv'
import { createSafeHandler } from './safe-handler'

type IpcMainHandleLike = Pick<IpcMain, 'handle'>

export interface ImportExportIpcDeps {
  // Import
  getImporters: () => unknown
  detectImporter: (sourcePath: string) => unknown
  previewImport: (options: ImportOptions) => Promise<unknown>
  executeImport: (options: ImportOptions) => Promise<{
    success: boolean
    importedNotes: Array<{ id?: string; title?: string }>
    errors: Array<{ error?: string }>
    stats: { importedAttachments: number }
  }>
  // Export
  executeExport: (options: ExportOptions) => Promise<unknown>
  exportNoteAsMarkdown: (noteId: string, options?: MarkdownExportOptions) => Promise<unknown>
  exportNoteAsPDF: (noteId: string, options?: PDFExportOptions) => Promise<unknown>
  // PDF Import
  getPdfServiceInfos: () => unknown
  getPdfConfig: () => { activeService: string }
  setPdfConfig: (config: PdfServiceConfigs) => void
  getServiceConfig: (serviceId: string) => Record<string, string> | null
  setServiceConfig: (serviceId: string, config: Record<string, string>) => void
  pdfImporter: {
    setRuntimeConfig: (config: {
      serviceId: string
      serviceConfig: Record<string, string>
      onProgress?: (progress: PdfParseProgress) => void
      abortSignal?: AbortSignal
    }) => void
    parseFileToTiptap: (path: string) => Promise<{ content: unknown }>
    cleanup: () => void
  }
  // arXiv Import
  parseArxivInput: (input: string) => unknown
  arxivImporter: {
    import: (
      options: ArxivImportOptions,
      onProgress: (progress: ArxivBatchProgress) => void
    ) => Promise<{ imported: number }>
    cancel: () => void
    fetchAsTiptap: (
      arxivId: string,
      onPdfProgress: (progress: { stage: string; message: string }) => void,
      options?: ArxivInlineImportOptions
    ) => Promise<{ content: unknown; title: string }>
  }
  // i18n
  t: () => { pdf: { processingFile: (current: number, total: number) => string } }
  // Main view access for progress events
  getMainView: () => WebContentsView | null
}

export function registerImportExportIpc(
  ipcMainLike: IpcMainHandleLike,
  deps: ImportExportIpcDeps
): void {
  // ============ Import/Export ============
  ipcMainLike.handle('import:getImporters', createSafeHandler('import:getImporters', () => deps.getImporters()))

  ipcMainLike.handle('import:detect', createSafeHandler('import:detect', async (_, sourcePath: string) => {
    return deps.detectImporter(sourcePath)
  }))

  ipcMainLike.handle('import:preview', createSafeHandler('import:preview', async (_, options: ImportOptions) => {
    return deps.previewImport(options)
  }))

  ipcMainLike.handle('import:execute', createSafeHandler('import:execute', async (_, options: ImportOptions) => {
    const result = await deps.executeImport(options)
    if (result.importedNotes.length > 0) {
      deps.getMainView()?.webContents.send('data:changed')
    }
    return result
  }))

  ipcMainLike.handle('export:execute', createSafeHandler('export:execute', async (_, options: ExportOptions) => {
    return deps.executeExport(options)
  }))

  ipcMainLike.handle('import:selectSource', createSafeHandler('import:selectSource', async (_, importerId?: string) => {
    const { dialog } = await import('electron')
    const importers = deps.getImporters() as Array<{
      id: string
      supportsFolder?: boolean
      fileFilters?: Array<{ name: string; extensions: string[] }>
    }>
    const importer = importers.find((i) => i.id === importerId) || importers[0]

    const result = await dialog.showOpenDialog({
      properties: importer?.supportsFolder
        ? ['openFile', 'openDirectory', 'multiSelections']
        : ['openFile', 'multiSelections'],
      filters: importer?.fileFilters || [
        { name: 'Markdown files', extensions: ['md', 'markdown'] },
        { name: 'All files', extensions: ['*'] },
      ],
    })

    if (result.canceled) return null

    const fs = await import('fs')
    const hasDirectories = result.filePaths.some((p) => {
      try {
        return fs.statSync(p).isDirectory()
      } catch {
        return false
      }
    })

    return { paths: result.filePaths, hasDirectories }
  }))

  ipcMainLike.handle('export:selectTarget', createSafeHandler('export:selectTarget', async () => {
    const { dialog } = await import('electron')
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    })

    return result.canceled ? null : result.filePaths[0]
  }))

  // ============ Single Note Export ============
  ipcMainLike.handle('export:noteAsMarkdown', createSafeHandler('export:noteAsMarkdown', async (_, noteId: string, options?: MarkdownExportOptions) => {
    return deps.exportNoteAsMarkdown(noteId, options)
  }))

  ipcMainLike.handle('export:noteAsPDF', createSafeHandler('export:noteAsPDF', async (_, noteId: string, options?: PDFExportOptions) => {
    return deps.exportNoteAsPDF(noteId, options)
  }))

  // ============ PDF Import ============
  ipcMainLike.handle('pdf:getServices', createSafeHandler('pdf:getServices', () => deps.getPdfServiceInfos()))

  ipcMainLike.handle('pdf:getConfig', createSafeHandler('pdf:getConfig', () => deps.getPdfConfig()))

  ipcMainLike.handle('pdf:setConfig', createSafeHandler('pdf:setConfig', (_, config: PdfServiceConfigs) => deps.setPdfConfig(config)))

  ipcMainLike.handle('pdf:getServiceConfig', createSafeHandler('pdf:getServiceConfig', (_, serviceId: string) => deps.getServiceConfig(serviceId)))

  ipcMainLike.handle('pdf:setServiceConfig', createSafeHandler('pdf:setServiceConfig', (_, serviceId: string, config: Record<string, string>) => {
    deps.setServiceConfig(serviceId, config)
  }))

  ipcMainLike.handle('pdf:selectFiles', createSafeHandler('pdf:selectFiles', async () => {
    const { dialog } = await import('electron')
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF files', extensions: ['pdf'] }],
    })
    return result.canceled ? [] : result.filePaths
  }))

  // PDF import abort controller (module-level so it can be cancelled from another handler)
  let pdfImportAbortController: AbortController | null = null

  ipcMainLike.handle('pdf:cancel', createSafeHandler('pdf:cancel', () => {
    if (pdfImportAbortController) {
      pdfImportAbortController.abort()
      pdfImportAbortController = null
      return true
    }
    return false
  }))

  ipcMainLike.handle(
    'pdf:import',
    async (
      _event,
      options: {
        pdfPaths: string[]
        serviceId: string
        serviceConfig: Record<string, string>
        targetNotebookId?: string
        importImages: boolean
        buildEmbedding?: boolean
      }
    ) => {
      const win = deps.getMainView()

      // Create abort controller for this import session
      pdfImportAbortController = new AbortController()
      const abortSignal = pdfImportAbortController.signal

      const results: Array<{
        path: string
        success: boolean
        noteId?: string
        noteTitle?: string
        imageCount?: number
        error?: string
      }> = []

      try {
        for (let i = 0; i < options.pdfPaths.length; i++) {
          // Check if cancelled before processing next file
          if (abortSignal.aborted) {
            for (let j = i; j < options.pdfPaths.length; j++) {
              results.push({
                path: options.pdfPaths[j],
                success: false,
                error: 'Import cancelled',
              })
            }
            break
          }

          const pdfPath = options.pdfPaths[i]

          win?.webContents.send('pdf:importProgress', {
            stage: 'file',
            message: deps.t().pdf.processingFile(i + 1, options.pdfPaths.length),
            currentFile: i + 1,
            totalFiles: options.pdfPaths.length,
            fileName: pdfPath.split(/[/\\]/).pop() || pdfPath,
          })

          const onProgress = (progress: PdfParseProgress) => {
            win?.webContents.send('pdf:importProgress', {
              ...progress,
              currentFile: i + 1,
              totalFiles: options.pdfPaths.length,
            })
          }

          deps.pdfImporter.setRuntimeConfig({
            serviceId: options.serviceId,
            serviceConfig: options.serviceConfig,
            onProgress,
            abortSignal,
          })

          try {
            const result = await deps.executeImport({
              sourcePath: pdfPath,
              folderStrategy: 'single-notebook',
              targetNotebookId: options.targetNotebookId,
              tagStrategy: 'keep-nested',
              conflictStrategy: 'rename',
              importAttachments: options.importImages,
              parseFrontMatter: false,
              buildEmbedding: options.buildEmbedding,
            })

            results.push({
              path: pdfPath,
              success: result.success,
              noteId: result.importedNotes[0]?.id,
              noteTitle: result.importedNotes[0]?.title,
              imageCount: result.stats.importedAttachments,
              error: result.errors[0]?.error,
            })
          } catch (error) {
            results.push({
              path: pdfPath,
              success: false,
              error: error instanceof Error ? error.message : String(error),
            })
          } finally {
            deps.pdfImporter.cleanup()
          }
        }
      } finally {
        pdfImportAbortController = null
      }

      const successCount = results.filter((r) => r.success).length
      if (successCount > 0) {
        deps.getMainView()?.webContents.send('data:changed')
      }

      return {
        results,
        successCount,
        failCount: results.length - successCount,
      }
    }
  )

  // ============ arXiv Import ============
  ipcMainLike.handle('arxiv:parseInput', createSafeHandler('arxiv:parseInput', (_, input: string) => {
    return deps.parseArxivInput(input)
  }))

  ipcMainLike.handle('arxiv:import', createSafeHandler('arxiv:import', async (_, options: ArxivImportOptions) => {
    const win = deps.getMainView()

    const result = await deps.arxivImporter.import(options, (progress: ArxivBatchProgress) => {
      win?.webContents.send('arxiv:importProgress', progress)
    })

    if (result.imported > 0) {
      deps.getMainView()?.webContents.send('data:changed')
    }

    return result
  }))

  ipcMainLike.handle('arxiv:cancel', createSafeHandler('arxiv:cancel', () => {
    deps.arxivImporter.cancel()
    return true
  }))

  // ============ Inline Import (insert at cursor) ============
  ipcMainLike.handle('importInline:selectMarkdown', createSafeHandler('importInline:selectMarkdown', async () => {
    const { dialog } = await import('electron')
    const { readFile } = await import('fs/promises')

    const result = await dialog.showOpenDialog({
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
      properties: ['openFile'],
    })

    if (result.canceled || !result.filePaths[0]) return null

    const content = await readFile(result.filePaths[0], 'utf-8')
    return { content, path: result.filePaths[0] }
  }))

  ipcMainLike.handle('importInline:selectAndParsePdf', async () => {
    const { dialog } = await import('electron')
    const win = deps.getMainView()

    const result = await dialog.showOpenDialog({
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['openFile'],
    })

    if (result.canceled || !result.filePaths[0]) return null

    const pdfPath = result.filePaths[0]

    const config = deps.getPdfConfig()
    const serviceConfig = deps.getServiceConfig(config.activeService)

    if (!serviceConfig) {
      throw new Error('PDF service not configured')
    }

    const onProgress = (progress: PdfParseProgress) => {
      win?.webContents.send('pdf:importProgress', progress)
    }

    deps.pdfImporter.setRuntimeConfig({
      serviceId: config.activeService,
      serviceConfig,
      onProgress,
    })

    try {
      const parseResult = await deps.pdfImporter.parseFileToTiptap(pdfPath)
      return { content: parseResult.content, path: pdfPath }
    } finally {
      deps.pdfImporter.cleanup()
    }
  })

  ipcMainLike.handle(
    'importInline:arxiv',
    createSafeHandler('importInline:arxiv', async (_, arxivId: string, options?: ArxivInlineImportOptions) => {
      const win = deps.getMainView()

      const onPdfProgress = (progress: { stage: string; message: string }) => {
        win?.webContents.send('pdf:importProgress', progress)
      }

      const result = await deps.arxivImporter.fetchAsTiptap(arxivId, onPdfProgress, options)
      return { content: result.content, title: result.title }
    })
  )
}
