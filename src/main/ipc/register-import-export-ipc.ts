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

const IMPORT_EXPORT_MAX_SOURCE_PATHS = 2048
const IMPORT_EXPORT_MAX_IMPORTERS = 512
const IMPORT_EXPORT_MAX_IMPORTER_FILTERS = 32
const IMPORT_EXPORT_MAX_IMPORTER_FILTER_EXTENSIONS = 32
const IMPORT_EXPORT_MAX_IMPORTER_FILTER_NAME_LENGTH = 256
const IMPORT_EXPORT_MAX_IMPORTER_FILTER_EXTENSION_LENGTH = 64
const IMPORT_EXPORT_MAX_PDF_IMPORT_FILES = 256
const IMPORT_EXPORT_MAX_ARXIV_INPUTS = 256
const IMPORT_EXPORT_MAX_PDF_SERVICES = 32
const IMPORT_EXPORT_MAX_SERVICE_CONFIG_ENTRIES = 128
const IMPORT_EXPORT_MAX_SERVICE_CONFIG_KEY_LENGTH = 256
const IMPORT_EXPORT_MAX_SERVICE_CONFIG_VALUE_LENGTH = 16 * 1024
const IMPORT_EXPORT_MAX_PATH_LENGTH = 4096
const IMPORT_EXPORT_MAX_ID_LENGTH = 1024
const IMPORT_EXPORT_MAX_IMPORTER_ID_LENGTH = 256
const IMPORT_EXPORT_MAX_EXPORT_NOTE_IDS = 10000
const IMPORT_EXPORT_MAX_EXPORT_NOTEBOOK_IDS = 5000
const IMPORT_EXPORT_MAX_ARXIV_INPUT_LENGTH = 512

function sendViewEvent(
  view: WebContentsView | null,
  channel: string,
  payload?: unknown
): boolean {
  if (!view) return false
  const webContents = view.webContents
  if (typeof webContents.isDestroyed === 'function' && webContents.isDestroyed()) return false
  try {
    if (payload === undefined) {
      webContents.send(channel)
    } else {
      webContents.send(channel, payload)
    }
    return true
  } catch (error) {
    console.warn(
      `[import-export-ipc] failed to send "${channel}":`,
      error instanceof Error ? error.message : String(error)
    )
    return false
  }
}

function isUnsafeObjectKey(key: string): boolean {
  return key === '__proto__' || key === 'constructor' || key === 'prototype'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseRequiredStringInput(input: unknown): string | null {
  if (typeof input !== 'string') return null
  if (!input.trim()) return null
  if (input.includes('\0')) return null
  return input
}

function parseRequiredBoundedStringInput(
  input: unknown,
  options: { maxLength: number }
): string | null {
  const value = parseRequiredStringInput(input)
  if (!value) return null
  if (value.length > options.maxLength) return null
  return value
}

function parseOptionalOpaqueIdInput(
  input: unknown,
  options?: { maxLength?: number }
): string | undefined | null {
  if (input === undefined) return undefined
  const value = parseRequiredStringInput(input)
  if (!value) return null
  if (typeof options?.maxLength === 'number' && value.length > options.maxLength) return null
  return value
}

function parseStringArrayInput(
  input: unknown,
  options?: { maxItems?: number; maxItemLength?: number }
): string[] | null {
  if (!Array.isArray(input)) return null
  if (typeof options?.maxItems === 'number' && input.length > options.maxItems) return null
  const values: string[] = []
  for (const item of input) {
    const value = typeof options?.maxItemLength === 'number'
      ? parseRequiredBoundedStringInput(item, { maxLength: options.maxItemLength })
      : parseRequiredStringInput(item)
    if (!value) return null
    values.push(value)
  }
  return values
}

function parseStringRecordInput(
  input: unknown,
  options?: { maxEntries?: number; maxKeyLength?: number; maxValueLength?: number }
): Record<string, string> | null {
  if (!isRecord(input) || Array.isArray(input)) return null
  const entries = Object.entries(input)
  if (typeof options?.maxEntries === 'number' && entries.length > options.maxEntries) return null
  const record: Record<string, string> = {}
  for (const [key, value] of entries) {
    if (isUnsafeObjectKey(key)) return null
    if (key.includes('\0')) return null
    if (typeof options?.maxKeyLength === 'number' && key.length > options.maxKeyLength) return null
    if (typeof value !== 'string') return null
    if (value.includes('\0')) return null
    if (typeof options?.maxValueLength === 'number' && value.length > options.maxValueLength) return null
    record[key] = value
  }
  return record
}

interface ImporterDialogFilterInput {
  name: string
  extensions: string[]
}

interface ImporterSelectSourceInput {
  id: string
  supportsFolder: boolean
  fileFilters: ImporterDialogFilterInput[]
}

const DEFAULT_SELECT_SOURCE_FILTERS: ImporterDialogFilterInput[] = [
  { name: 'Markdown files', extensions: ['md', 'markdown'] },
  { name: 'All files', extensions: ['*'] },
]

function parseImporterDialogFilterInput(input: unknown): ImporterDialogFilterInput | null {
  if (!isRecord(input) || Array.isArray(input)) return null
  const name = parseRequiredBoundedStringInput(input.name, {
    maxLength: IMPORT_EXPORT_MAX_IMPORTER_FILTER_NAME_LENGTH,
  })
  const extensions = parseStringArrayInput(input.extensions, {
    maxItems: IMPORT_EXPORT_MAX_IMPORTER_FILTER_EXTENSIONS,
    maxItemLength: IMPORT_EXPORT_MAX_IMPORTER_FILTER_EXTENSION_LENGTH,
  })
  if (!name || !extensions || extensions.length === 0) return null
  return { name, extensions }
}

function parseImporterSelectSourceInput(input: unknown): ImporterSelectSourceInput | null {
  if (!isRecord(input) || Array.isArray(input)) return null
  const id = parseRequiredStringInput(input.id)
  if (!id) return null
  if (id.length > IMPORT_EXPORT_MAX_IMPORTER_ID_LENGTH) return null
  if (input.supportsFolder !== undefined && typeof input.supportsFolder !== 'boolean') return null

  const fileFiltersInput = input.fileFilters
  let fileFilters: ImporterDialogFilterInput[] = []
  if (fileFiltersInput !== undefined) {
    if (!Array.isArray(fileFiltersInput)) return null
    if (fileFiltersInput.length > IMPORT_EXPORT_MAX_IMPORTER_FILTERS) return null
    fileFilters = []
    for (const item of fileFiltersInput) {
      const parsedFilter = parseImporterDialogFilterInput(item)
      if (!parsedFilter) return null
      fileFilters.push(parsedFilter)
    }
  }

  return {
    id,
    supportsFolder: input.supportsFolder === true,
    fileFilters,
  }
}

function parseImporterSelectSourceListInput(input: unknown): ImporterSelectSourceInput[] {
  if (!Array.isArray(input)) return []
  if (input.length > IMPORT_EXPORT_MAX_IMPORTERS) return []
  const importers: ImporterSelectSourceInput[] = []
  for (const item of input) {
    const importer = parseImporterSelectSourceInput(item)
    if (importer) importers.push(importer)
  }
  return importers
}

function parseSelectSourceImporterIdInput(input: unknown): string | undefined | null {
  if (input === undefined) return undefined
  const importerId = parseRequiredStringInput(input)
  if (!importerId) return null
  if (importerId.length > IMPORT_EXPORT_MAX_IMPORTER_ID_LENGTH) return null
  return importerId
}

function parseImportOptionsInput(input: unknown): ImportOptions | null {
  if (!isRecord(input) || Array.isArray(input)) return null

  const sourcePathInput = input.sourcePath
  let sourcePath: string | string[]
  if (typeof sourcePathInput === 'string') {
    const parsedSourcePath = parseRequiredStringInput(sourcePathInput)
    if (!parsedSourcePath || parsedSourcePath.length > IMPORT_EXPORT_MAX_PATH_LENGTH) return null
    sourcePath = parsedSourcePath
  } else {
    const sourcePaths = parseStringArrayInput(sourcePathInput, {
      maxItems: IMPORT_EXPORT_MAX_SOURCE_PATHS,
      maxItemLength: IMPORT_EXPORT_MAX_PATH_LENGTH,
    })
    if (!sourcePaths || sourcePaths.length === 0) return null
    sourcePath = sourcePaths
  }

  const folderStrategy = input.folderStrategy
  if (folderStrategy !== 'first-level' && folderStrategy !== 'flatten-path' && folderStrategy !== 'single-notebook') {
    return null
  }
  const tagStrategy = input.tagStrategy
  if (tagStrategy !== 'keep-nested' && tagStrategy !== 'flatten-all' && tagStrategy !== 'first-level') {
    return null
  }
  const conflictStrategy = input.conflictStrategy
  if (conflictStrategy !== 'skip' && conflictStrategy !== 'rename' && conflictStrategy !== 'overwrite') {
    return null
  }
  if (typeof input.importAttachments !== 'boolean' || typeof input.parseFrontMatter !== 'boolean') {
    return null
  }
  const targetNotebookId = parseOptionalOpaqueIdInput(input.targetNotebookId, { maxLength: IMPORT_EXPORT_MAX_ID_LENGTH })
  if (input.targetNotebookId !== undefined && targetNotebookId === null) return null

  let defaultNotebookId: string | null | undefined
  if (input.defaultNotebookId === null) {
    defaultNotebookId = null
  } else {
    const parsedDefaultNotebookId = parseOptionalOpaqueIdInput(input.defaultNotebookId, { maxLength: IMPORT_EXPORT_MAX_ID_LENGTH })
    if (input.defaultNotebookId !== undefined && parsedDefaultNotebookId === null) return null
    defaultNotebookId = parsedDefaultNotebookId ?? undefined
  }

  if (input.buildEmbedding !== undefined && typeof input.buildEmbedding !== 'boolean') {
    return null
  }

  return {
    sourcePath,
    folderStrategy,
    targetNotebookId: targetNotebookId ?? undefined,
    defaultNotebookId,
    tagStrategy,
    conflictStrategy,
    importAttachments: input.importAttachments,
    parseFrontMatter: input.parseFrontMatter,
    buildEmbedding: typeof input.buildEmbedding === 'boolean' ? input.buildEmbedding : undefined,
  }
}

function parseExportOptionsInput(input: unknown): ExportOptions | null {
  if (!isRecord(input) || Array.isArray(input)) return null
  const noteIds = parseStringArrayInput(input.noteIds, {
    maxItems: IMPORT_EXPORT_MAX_EXPORT_NOTE_IDS,
    maxItemLength: IMPORT_EXPORT_MAX_ID_LENGTH,
  })
  const notebookIds = parseStringArrayInput(input.notebookIds, {
    maxItems: IMPORT_EXPORT_MAX_EXPORT_NOTEBOOK_IDS,
    maxItemLength: IMPORT_EXPORT_MAX_ID_LENGTH,
  })
  if (!noteIds || !notebookIds) return null

  const format = input.format
  if (format !== 'markdown' && format !== 'json') return null

  const outputPath = parseRequiredStringInput(input.outputPath)
  if (!outputPath || outputPath.length > IMPORT_EXPORT_MAX_PATH_LENGTH) return null

  if (
    typeof input.groupByNotebook !== 'boolean'
    || typeof input.includeAttachments !== 'boolean'
    || typeof input.includeFrontMatter !== 'boolean'
    || typeof input.asZip !== 'boolean'
  ) {
    return null
  }

  return {
    noteIds,
    notebookIds,
    format,
    outputPath,
    groupByNotebook: input.groupByNotebook,
    includeAttachments: input.includeAttachments,
    includeFrontMatter: input.includeFrontMatter,
    asZip: input.asZip,
  }
}

function parseMarkdownExportOptionsInput(input: unknown): MarkdownExportOptions | undefined | null {
  if (input === undefined) return undefined
  if (!isRecord(input) || Array.isArray(input)) return null
  if (input.includeAttachments !== undefined && typeof input.includeAttachments !== 'boolean') return null
  if (input.includeFrontMatter !== undefined && typeof input.includeFrontMatter !== 'boolean') return null
  return {
    includeAttachments: typeof input.includeAttachments === 'boolean' ? input.includeAttachments : undefined,
    includeFrontMatter: typeof input.includeFrontMatter === 'boolean' ? input.includeFrontMatter : undefined,
  }
}

function parsePdfExportOptionsInput(input: unknown): PDFExportOptions | undefined | null {
  if (input === undefined) return undefined
  if (!isRecord(input) || Array.isArray(input)) return null
  if (input.pageSize !== undefined && input.pageSize !== 'A4' && input.pageSize !== 'Letter') return null
  if (input.includeBackground !== undefined && typeof input.includeBackground !== 'boolean') return null
  return {
    pageSize: input.pageSize === 'A4' || input.pageSize === 'Letter' ? input.pageSize : undefined,
    includeBackground: typeof input.includeBackground === 'boolean' ? input.includeBackground : undefined,
  }
}

function parsePdfServiceConfigInput(input: unknown): PdfServiceConfigs | null {
  if (!isRecord(input) || Array.isArray(input)) return null
  const activeService = parseRequiredBoundedStringInput(input.activeService, {
    maxLength: IMPORT_EXPORT_MAX_IMPORTER_ID_LENGTH,
  })
  if (!activeService || isUnsafeObjectKey(activeService) || typeof input.rememberConfig !== 'boolean') return null
  const servicesInput = input.services
  if (!isRecord(servicesInput) || Array.isArray(servicesInput)) return null

  const services: Record<string, Record<string, string>> = {}
  const serviceEntries = Object.entries(servicesInput)
  if (serviceEntries.length > IMPORT_EXPORT_MAX_PDF_SERVICES) return null
  for (const [serviceIdRaw, rawConfig] of serviceEntries) {
    const serviceId = parseRequiredBoundedStringInput(serviceIdRaw, {
      maxLength: IMPORT_EXPORT_MAX_IMPORTER_ID_LENGTH,
    })
    if (!serviceId || isUnsafeObjectKey(serviceId)) return null
    const parsedConfig = parseStringRecordInput(rawConfig, {
      maxEntries: IMPORT_EXPORT_MAX_SERVICE_CONFIG_ENTRIES,
      maxKeyLength: IMPORT_EXPORT_MAX_SERVICE_CONFIG_KEY_LENGTH,
      maxValueLength: IMPORT_EXPORT_MAX_SERVICE_CONFIG_VALUE_LENGTH,
    })
    if (!parsedConfig) return null
    services[serviceId] = parsedConfig
  }

  return {
    activeService,
    rememberConfig: input.rememberConfig,
    services,
  }
}

function parsePdfImportOptionsInput(input: unknown): {
  pdfPaths: string[]
  serviceId: string
  serviceConfig: Record<string, string>
  targetNotebookId?: string
  importImages: boolean
  buildEmbedding?: boolean
} | null {
  if (!isRecord(input) || Array.isArray(input)) return null
  const pdfPaths = parseStringArrayInput(input.pdfPaths, {
    maxItems: IMPORT_EXPORT_MAX_PDF_IMPORT_FILES,
    maxItemLength: IMPORT_EXPORT_MAX_PATH_LENGTH,
  })
  const serviceId = parseRequiredStringInput(input.serviceId)
  if (!serviceId || serviceId.length > IMPORT_EXPORT_MAX_IMPORTER_ID_LENGTH || isUnsafeObjectKey(serviceId)) return null
  const serviceConfig = parseStringRecordInput(input.serviceConfig, {
    maxEntries: IMPORT_EXPORT_MAX_SERVICE_CONFIG_ENTRIES,
    maxKeyLength: IMPORT_EXPORT_MAX_SERVICE_CONFIG_KEY_LENGTH,
    maxValueLength: IMPORT_EXPORT_MAX_SERVICE_CONFIG_VALUE_LENGTH,
  })
  if (!pdfPaths || !serviceConfig || typeof input.importImages !== 'boolean') return null
  if (pdfPaths.length === 0) return null
  const targetNotebookId = parseOptionalOpaqueIdInput(input.targetNotebookId, { maxLength: IMPORT_EXPORT_MAX_ID_LENGTH })
  if (input.targetNotebookId !== undefined && targetNotebookId === null) return null
  if (input.buildEmbedding !== undefined && typeof input.buildEmbedding !== 'boolean') return null
  return {
    pdfPaths,
    serviceId,
    serviceConfig,
    targetNotebookId: targetNotebookId ?? undefined,
    importImages: input.importImages,
    buildEmbedding: typeof input.buildEmbedding === 'boolean' ? input.buildEmbedding : undefined,
  }
}

function parseArxivImportOptionsInput(input: unknown): ArxivImportOptions | null {
  if (!isRecord(input) || Array.isArray(input)) return null
  const inputs = parseStringArrayInput(input.inputs, {
    maxItems: IMPORT_EXPORT_MAX_ARXIV_INPUTS,
    maxItemLength: IMPORT_EXPORT_MAX_ARXIV_INPUT_LENGTH,
  })
  if (!inputs || inputs.length === 0) return null
  const notebookId = parseOptionalOpaqueIdInput(input.notebookId, { maxLength: IMPORT_EXPORT_MAX_ID_LENGTH })
  if (input.notebookId !== undefined && notebookId === null) return null
  if (input.includeAbstract !== undefined && typeof input.includeAbstract !== 'boolean') return null
  if (input.includeReferences !== undefined && typeof input.includeReferences !== 'boolean') return null
  if (input.downloadFigures !== undefined && typeof input.downloadFigures !== 'boolean') return null
  if (input.preferHtml !== undefined && typeof input.preferHtml !== 'boolean') return null
  if (input.buildEmbedding !== undefined && typeof input.buildEmbedding !== 'boolean') return null
  return {
    inputs,
    notebookId: notebookId ?? undefined,
    includeAbstract: typeof input.includeAbstract === 'boolean' ? input.includeAbstract : undefined,
    includeReferences: typeof input.includeReferences === 'boolean' ? input.includeReferences : undefined,
    downloadFigures: typeof input.downloadFigures === 'boolean' ? input.downloadFigures : undefined,
    preferHtml: typeof input.preferHtml === 'boolean' ? input.preferHtml : undefined,
    buildEmbedding: typeof input.buildEmbedding === 'boolean' ? input.buildEmbedding : undefined,
  }
}

function parseArxivInlineImportOptionsInput(input: unknown): ArxivInlineImportOptions | undefined | null {
  if (input === undefined) return undefined
  if (!isRecord(input) || Array.isArray(input)) return null
  if (input.includeAbstract !== undefined && typeof input.includeAbstract !== 'boolean') return null
  if (input.includeReferences !== undefined && typeof input.includeReferences !== 'boolean') return null
  if (input.downloadFigures !== undefined && typeof input.downloadFigures !== 'boolean') return null
  if (input.preferHtml !== undefined && typeof input.preferHtml !== 'boolean') return null
  return {
    includeAbstract: typeof input.includeAbstract === 'boolean' ? input.includeAbstract : undefined,
    includeReferences: typeof input.includeReferences === 'boolean' ? input.includeReferences : undefined,
    downloadFigures: typeof input.downloadFigures === 'boolean' ? input.downloadFigures : undefined,
    preferHtml: typeof input.preferHtml === 'boolean' ? input.preferHtml : undefined,
  }
}

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

  ipcMainLike.handle('import:detect', createSafeHandler('import:detect', async (_, sourcePathInput: unknown) => {
    const sourcePath = parseRequiredBoundedStringInput(sourcePathInput, {
      maxLength: IMPORT_EXPORT_MAX_PATH_LENGTH,
    })
    if (!sourcePath) return null
    return deps.detectImporter(sourcePath)
  }))

  ipcMainLike.handle('import:preview', createSafeHandler('import:preview', async (_, optionsInput: unknown) => {
    const options = parseImportOptionsInput(optionsInput)
    if (!options) {
      throw new Error('import:preview payload is invalid')
    }
    return deps.previewImport(options)
  }))

  ipcMainLike.handle('import:execute', createSafeHandler('import:execute', async (_, optionsInput: unknown) => {
    const options = parseImportOptionsInput(optionsInput)
    if (!options) {
      throw new Error('import:execute payload is invalid')
    }
    const result = await deps.executeImport(options)
    if (result.importedNotes.length > 0) {
      sendViewEvent(deps.getMainView(), 'data:changed')
    }
    return result
  }))

  ipcMainLike.handle('export:execute', createSafeHandler('export:execute', async (_, optionsInput: unknown) => {
    const options = parseExportOptionsInput(optionsInput)
    if (!options) {
      throw new Error('export:execute payload is invalid')
    }
    return deps.executeExport(options)
  }))

  ipcMainLike.handle('import:selectSource', createSafeHandler('import:selectSource', async (_, importerIdInput?: unknown) => {
    const importerId = parseSelectSourceImporterIdInput(importerIdInput)
    if (importerIdInput !== undefined && !importerId) return null

    const importers = parseImporterSelectSourceListInput(deps.getImporters())
    const importer = importerId
      ? importers.find((item) => item.id === importerId)
      : importers[0]

    if (importerId && !importer) return null

    const { dialog } = await import('electron')

    const result = await dialog.showOpenDialog({
      properties: importer?.supportsFolder
        ? ['openFile', 'openDirectory', 'multiSelections']
        : ['openFile', 'multiSelections'],
      filters: importer?.fileFilters.length ? importer.fileFilters : DEFAULT_SELECT_SOURCE_FILTERS,
    })

    if (result.canceled) return null

    const { stat } = await import('fs/promises')
    const hasDirectories = (await Promise.all(result.filePaths.map(async (p) => {
      try {
        return (await stat(p)).isDirectory()
      } catch {
        return false
      }
    }))).some(Boolean)

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
  ipcMainLike.handle('export:noteAsMarkdown', createSafeHandler('export:noteAsMarkdown', async (_, noteIdInput: unknown, optionsInput?: unknown) => {
    const noteId = parseRequiredBoundedStringInput(noteIdInput, {
      maxLength: IMPORT_EXPORT_MAX_ID_LENGTH,
    })
    const options = parseMarkdownExportOptionsInput(optionsInput)
    if (!noteId || options === null) {
      throw new Error('export:noteAsMarkdown payload is invalid')
    }
    return deps.exportNoteAsMarkdown(noteId, options)
  }))

  ipcMainLike.handle('export:noteAsPDF', createSafeHandler('export:noteAsPDF', async (_, noteIdInput: unknown, optionsInput?: unknown) => {
    const noteId = parseRequiredBoundedStringInput(noteIdInput, {
      maxLength: IMPORT_EXPORT_MAX_ID_LENGTH,
    })
    const options = parsePdfExportOptionsInput(optionsInput)
    if (!noteId || options === null) {
      throw new Error('export:noteAsPDF payload is invalid')
    }
    return deps.exportNoteAsPDF(noteId, options)
  }))

  // ============ PDF Import ============
  ipcMainLike.handle('pdf:getServices', createSafeHandler('pdf:getServices', () => deps.getPdfServiceInfos()))

  ipcMainLike.handle('pdf:getConfig', createSafeHandler('pdf:getConfig', () => deps.getPdfConfig()))

  ipcMainLike.handle('pdf:setConfig', createSafeHandler('pdf:setConfig', (_, configInput: unknown) => {
    const config = parsePdfServiceConfigInput(configInput)
    if (!config) {
      throw new Error('pdf:setConfig payload is invalid')
    }
    deps.setPdfConfig(config)
  }))

  ipcMainLike.handle('pdf:getServiceConfig', createSafeHandler('pdf:getServiceConfig', (_, serviceIdInput: unknown) => {
    const serviceId = parseRequiredBoundedStringInput(serviceIdInput, {
      maxLength: IMPORT_EXPORT_MAX_IMPORTER_ID_LENGTH,
    })
    if (!serviceId || isUnsafeObjectKey(serviceId)) return null
    return deps.getServiceConfig(serviceId)
  }))

  ipcMainLike.handle('pdf:setServiceConfig', createSafeHandler('pdf:setServiceConfig', (_, serviceIdInput: unknown, configInput: unknown) => {
    const serviceId = parseRequiredStringInput(serviceIdInput)
    const config = parseStringRecordInput(configInput, {
      maxEntries: IMPORT_EXPORT_MAX_SERVICE_CONFIG_ENTRIES,
      maxKeyLength: IMPORT_EXPORT_MAX_SERVICE_CONFIG_KEY_LENGTH,
      maxValueLength: IMPORT_EXPORT_MAX_SERVICE_CONFIG_VALUE_LENGTH,
    })
    if (!serviceId || isUnsafeObjectKey(serviceId) || !config) {
      throw new Error('pdf:setServiceConfig payload is invalid')
    }
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

  // Single-flight PDF import session (cancellable from another handler).
  // Keeping one active session avoids cross-call abort-controller races.
  let activePdfImportSession: { abortController: AbortController } | null = null

  ipcMainLike.handle('pdf:cancel', createSafeHandler('pdf:cancel', () => {
    if (activePdfImportSession) {
      activePdfImportSession.abortController.abort()
      activePdfImportSession = null
      return true
    }
    return false
  }))

  ipcMainLike.handle(
    'pdf:import',
    createSafeHandler('pdf:import', async (
      _event,
      optionsInput: unknown
    ) => {
      const options = parsePdfImportOptionsInput(optionsInput)
      if (!options) {
        throw new Error('pdf:import payload is invalid')
      }
      if (activePdfImportSession) {
        throw new Error('pdf:import is already running')
      }

      const win = deps.getMainView()

      const importSession = { abortController: new AbortController() }
      activePdfImportSession = importSession
      const abortSignal = importSession.abortController.signal

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

          sendViewEvent(win, 'pdf:importProgress', {
            stage: 'file',
            message: deps.t().pdf.processingFile(i + 1, options.pdfPaths.length),
            currentFile: i + 1,
            totalFiles: options.pdfPaths.length,
            fileName: pdfPath.split(/[/\\]/).pop() || pdfPath,
          })

          const onProgress = (progress: PdfParseProgress) => {
            sendViewEvent(win, 'pdf:importProgress', {
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
        if (activePdfImportSession === importSession) {
          activePdfImportSession = null
        }
      }

      const successCount = results.filter((r) => r.success).length
      if (successCount > 0) {
        sendViewEvent(deps.getMainView(), 'data:changed')
      }

      return {
        results,
        successCount,
        failCount: results.length - successCount,
      }
    })
  )

  // ============ arXiv Import ============
  ipcMainLike.handle('arxiv:parseInput', createSafeHandler('arxiv:parseInput', (_, inputData: unknown) => {
    const input = parseRequiredBoundedStringInput(inputData, {
      maxLength: IMPORT_EXPORT_MAX_ARXIV_INPUT_LENGTH,
    })
    if (!input) return null
    return deps.parseArxivInput(input)
  }))

  ipcMainLike.handle('arxiv:import', createSafeHandler('arxiv:import', async (_, optionsInput: unknown) => {
    const options = parseArxivImportOptionsInput(optionsInput)
    if (!options) {
      throw new Error('arxiv:import payload is invalid')
    }
    const win = deps.getMainView()

    const result = await deps.arxivImporter.import(options, (progress: ArxivBatchProgress) => {
      sendViewEvent(win, 'arxiv:importProgress', progress)
    })

    if (result.imported > 0) {
      sendViewEvent(deps.getMainView(), 'data:changed')
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

  ipcMainLike.handle('importInline:selectAndParsePdf', createSafeHandler('importInline:selectAndParsePdf', async () => {
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
      sendViewEvent(win, 'pdf:importProgress', progress)
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
  }))

  ipcMainLike.handle(
    'importInline:arxiv',
    createSafeHandler('importInline:arxiv', async (_, arxivIdInput: unknown, optionsInput?: unknown) => {
      const arxivId = parseRequiredBoundedStringInput(arxivIdInput, {
        maxLength: IMPORT_EXPORT_MAX_ARXIV_INPUT_LENGTH,
      })
      const options = parseArxivInlineImportOptionsInput(optionsInput)
      if (!arxivId || options === null) {
        throw new Error('importInline:arxiv payload is invalid')
      }
      const win = deps.getMainView()

      const onPdfProgress = (progress: { stage: string; message: string }) => {
        sendViewEvent(win, 'pdf:importProgress', progress)
      }

      const result = await deps.arxivImporter.fetchAsTiptap(arxivId, onPdfProgress, options)
      return { content: result.content, title: result.title }
    })
  )
}
