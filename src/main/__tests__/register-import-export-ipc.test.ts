import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImportExportIpcDeps } from '../ipc/register-import-export-ipc'
import { registerImportExportIpc } from '../ipc/register-import-export-ipc'

const { showOpenDialogMock } = vi.hoisted(() => ({
  showOpenDialogMock: vi.fn(),
}))

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: showOpenDialogMock,
  },
}))

type Handler = (...args: unknown[]) => unknown

function createIpcMainLike() {
  const channels = new Map<string, Handler>()
  return {
    channels,
    ipcMainLike: {
      handle: vi.fn((channel: string, listener: Handler) => {
        channels.set(channel, listener)
      }),
    },
  }
}

function createDeps(overrides: Partial<ImportExportIpcDeps> = {}): ImportExportIpcDeps {
  const mainView = {
    webContents: {
      send: vi.fn(),
    },
  }

  return {
    getImporters: vi.fn(() => []),
    detectImporter: vi.fn(async () => null),
    previewImport: vi.fn(async () => ({ noteCount: 0 })),
    executeImport: vi.fn(async () => ({
      success: true,
      importedNotes: [],
      errors: [],
      stats: { importedAttachments: 0 },
    })),
    executeExport: vi.fn(async () => ({ success: true })),
    exportNoteAsMarkdown: vi.fn(async () => ({ success: true })),
    exportNoteAsPDF: vi.fn(async () => ({ success: true })),
    getPdfServiceInfos: vi.fn(() => []),
    getPdfConfig: vi.fn(() => ({ activeService: 'textin' })),
    setPdfConfig: vi.fn(),
    getServiceConfig: vi.fn(() => ({})),
    setServiceConfig: vi.fn(),
    pdfImporter: {
      setRuntimeConfig: vi.fn(),
      parseFileToTiptap: vi.fn(async () => ({ content: {} })),
      cleanup: vi.fn(),
    },
    parseArxivInput: vi.fn(() => ({ ids: [] })),
    arxivImporter: {
      import: vi.fn(async () => ({ imported: 0 })),
      cancel: vi.fn(),
      fetchAsTiptap: vi.fn(async () => ({ content: {}, title: 'Title' })),
    },
    t: vi.fn(() => ({
      pdf: { processingFile: (current: number, total: number) => `${current}/${total}` },
    })),
    getMainView: vi.fn(() => mainView as unknown as ReturnType<ImportExportIpcDeps['getMainView']>),
    ...overrides,
  }
}

const VALID_IMPORT_OPTIONS = {
  sourcePath: '/tmp/note.md',
  folderStrategy: 'single-notebook',
  targetNotebookId: 'nb-1',
  tagStrategy: 'keep-nested',
  conflictStrategy: 'rename',
  importAttachments: true,
  parseFrontMatter: false,
} as const

const VALID_EXPORT_OPTIONS = {
  noteIds: ['note-1'],
  notebookIds: ['nb-1'],
  format: 'markdown',
  outputPath: '/tmp/export',
  groupByNotebook: true,
  includeAttachments: true,
  includeFrontMatter: true,
  asZip: false,
} as const

const VALID_PDF_IMPORT_OPTIONS = {
  pdfPaths: ['/tmp/a.pdf'],
  serviceId: 'textin',
  serviceConfig: { token: 'x' },
  importImages: true,
} as const

type ExecuteImportResult = Awaited<ReturnType<ImportExportIpcDeps['executeImport']>>

describe('register-import-export-ipc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    showOpenDialogMock.mockResolvedValue({
      canceled: true,
      filePaths: [],
    })
  })

  it('registers key channels', () => {
    const { channels, ipcMainLike } = createIpcMainLike()
    registerImportExportIpc(ipcMainLike, createDeps())

    expect(channels.has('import:detect')).toBe(true)
    expect(channels.has('import:execute')).toBe(true)
    expect(channels.has('export:execute')).toBe(true)
    expect(channels.has('pdf:setServiceConfig')).toBe(true)
    expect(channels.has('arxiv:import')).toBe(true)
    expect(channels.has('importInline:arxiv')).toBe(true)
  })

  it('fails closed for invalid import:detect payload', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerImportExportIpc(ipcMainLike, deps)

    const handler = channels.get('import:detect')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, 123)).resolves.toBeNull()
    await expect(handler({}, 'a'.repeat(4097))).resolves.toBeNull()
    expect(deps.detectImporter).not.toHaveBeenCalled()
  })

  it('fails closed for invalid import:selectSource importer id payload', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerImportExportIpc(ipcMainLike, deps)

    const handler = channels.get('import:selectSource')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, 123)).resolves.toBeNull()
    expect(deps.getImporters).not.toHaveBeenCalled()
    expect(showOpenDialogMock).not.toHaveBeenCalled()
  })

  it('fails closed when requested importer id does not exist', async () => {
    const deps = createDeps({
      getImporters: vi.fn(() => [{
        id: 'markdown',
        supportsFolder: true,
        fileFilters: [{ name: 'Markdown files', extensions: ['md'] }],
      }]),
    })
    const { channels, ipcMainLike } = createIpcMainLike()
    registerImportExportIpc(ipcMainLike, deps)

    const handler = channels.get('import:selectSource')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, 'not-exists')).resolves.toBeNull()
    expect(showOpenDialogMock).not.toHaveBeenCalled()
  })

  it('fails closed when importer list exceeds upper bound', async () => {
    const deps = createDeps({
      getImporters: vi.fn(() => Array.from({ length: 513 }, (_, index) => ({
        id: `importer-${index}`,
        supportsFolder: true,
        fileFilters: [{ name: 'Markdown files', extensions: ['md'] }],
      }))),
    })
    const { channels, ipcMainLike } = createIpcMainLike()
    registerImportExportIpc(ipcMainLike, deps)

    const handler = channels.get('import:selectSource')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, 'importer-1')).resolves.toBeNull()
    expect(showOpenDialogMock).not.toHaveBeenCalled()
  })

  it('uses safe default dialog options when importer metadata is malformed', async () => {
    const deps = createDeps({
      getImporters: vi.fn(() => ({ id: 'broken' })),
    })
    const { channels, ipcMainLike } = createIpcMainLike()
    registerImportExportIpc(ipcMainLike, deps)

    const handler = channels.get('import:selectSource')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, undefined)).resolves.toBeNull()
    expect(showOpenDialogMock).toHaveBeenCalledWith({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Markdown files', extensions: ['md', 'markdown'] },
        { name: 'All files', extensions: ['*'] },
      ],
    })
  })

  it('rejects invalid import options for preview and execute', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerImportExportIpc(ipcMainLike, deps)

    const previewHandler = channels.get('import:preview')
    const executeHandler = channels.get('import:execute')
    expect(previewHandler).toBeDefined()
    expect(executeHandler).toBeDefined()
    if (!previewHandler || !executeHandler) return

    await expect(previewHandler({}, { sourcePath: '/tmp/a.md' })).rejects.toThrow('import:preview payload is invalid')
    await expect(executeHandler({}, { ...VALID_IMPORT_OPTIONS, sourcePath: [] })).rejects.toThrow('import:execute payload is invalid')
    await expect(executeHandler({}, { ...VALID_IMPORT_OPTIONS, sourcePath: 'a'.repeat(4097) })).rejects.toThrow('import:execute payload is invalid')
    await expect(executeHandler({}, { ...VALID_IMPORT_OPTIONS, targetNotebookId: '' })).rejects.toThrow('import:execute payload is invalid')
    await expect(executeHandler({}, { ...VALID_IMPORT_OPTIONS, targetNotebookId: 'n'.repeat(1025) })).rejects.toThrow('import:execute payload is invalid')
    await expect(executeHandler({}, { ...VALID_IMPORT_OPTIONS, defaultNotebookId: '' })).rejects.toThrow('import:execute payload is invalid')
    expect(deps.previewImport).not.toHaveBeenCalled()
    expect(deps.executeImport).not.toHaveBeenCalled()
  })

  it('sends data:changed on successful import execute', async () => {
    const mainViewSend = vi.fn()
    const deps = createDeps({
      executeImport: vi.fn(async () => ({
        success: true,
        importedNotes: [{ id: 'n1' }],
        errors: [],
        stats: { importedAttachments: 0 },
      })),
      getMainView: vi.fn(() => ({
        webContents: { send: mainViewSend },
      }) as unknown as ReturnType<ImportExportIpcDeps['getMainView']>),
    })
    const { channels, ipcMainLike } = createIpcMainLike()
    registerImportExportIpc(ipcMainLike, deps)

    const handler = channels.get('import:execute')
    expect(handler).toBeDefined()
    if (!handler) return

    await handler({}, VALID_IMPORT_OPTIONS)
    expect(mainViewSend).toHaveBeenCalledWith('data:changed')
  })

  it('keeps import:execute successful when data:changed event send fails', async () => {
    const mainViewSend = vi.fn(() => {
      throw new Error('send failed')
    })
    const deps = createDeps({
      executeImport: vi.fn(async () => ({
        success: true,
        importedNotes: [{ id: 'n1' }],
        errors: [],
        stats: { importedAttachments: 0 },
      })),
      getMainView: vi.fn(() => ({
        webContents: { send: mainViewSend },
      }) as unknown as ReturnType<ImportExportIpcDeps['getMainView']>),
    })
    const { channels, ipcMainLike } = createIpcMainLike()
    registerImportExportIpc(ipcMainLike, deps)

    const handler = channels.get('import:execute')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, VALID_IMPORT_OPTIONS)).resolves.toEqual({
      success: true,
      importedNotes: [{ id: 'n1' }],
      errors: [],
      stats: { importedAttachments: 0 },
    })
    expect(mainViewSend).toHaveBeenCalledWith('data:changed')
  })

  it('rejects invalid export payloads', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerImportExportIpc(ipcMainLike, deps)

    const executeHandler = channels.get('export:execute')
    const markdownHandler = channels.get('export:noteAsMarkdown')
    const pdfHandler = channels.get('export:noteAsPDF')
    expect(executeHandler).toBeDefined()
    expect(markdownHandler).toBeDefined()
    expect(pdfHandler).toBeDefined()
    if (!executeHandler || !markdownHandler || !pdfHandler) return

    await expect(executeHandler({}, { ...VALID_EXPORT_OPTIONS, noteIds: [null] })).rejects.toThrow('export:execute payload is invalid')
    await expect(executeHandler({}, {
      ...VALID_EXPORT_OPTIONS,
      noteIds: Array.from({ length: 10001 }, (_, index) => `note-${index}`),
    })).rejects.toThrow('export:execute payload is invalid')
    await expect(executeHandler({}, { ...VALID_EXPORT_OPTIONS, outputPath: '/tmp/\0export' })).rejects.toThrow('export:execute payload is invalid')
    await expect(executeHandler({}, { ...VALID_EXPORT_OPTIONS, outputPath: 'a'.repeat(4097) })).rejects.toThrow('export:execute payload is invalid')
    await expect(markdownHandler({}, '', { includeAttachments: true })).rejects.toThrow('export:noteAsMarkdown payload is invalid')
    await expect(markdownHandler({}, 'n'.repeat(1025), { includeAttachments: true })).rejects.toThrow('export:noteAsMarkdown payload is invalid')
    await expect(pdfHandler({}, 'note-1', { pageSize: 'B5' })).rejects.toThrow('export:noteAsPDF payload is invalid')
    await expect(pdfHandler({}, 'n'.repeat(1025), { includeBackground: true })).rejects.toThrow('export:noteAsPDF payload is invalid')
    expect(deps.executeExport).not.toHaveBeenCalled()
    expect(deps.exportNoteAsMarkdown).not.toHaveBeenCalled()
    expect(deps.exportNoteAsPDF).not.toHaveBeenCalled()
  })

  it('fails closed for invalid pdf service payloads', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerImportExportIpc(ipcMainLike, deps)

    const setPdfConfigHandler = channels.get('pdf:setConfig')
    const getConfigHandler = channels.get('pdf:getServiceConfig')
    const setConfigHandler = channels.get('pdf:setServiceConfig')
    expect(setPdfConfigHandler).toBeDefined()
    expect(getConfigHandler).toBeDefined()
    expect(setConfigHandler).toBeDefined()
    if (!setPdfConfigHandler || !getConfigHandler || !setConfigHandler) return

    await expect(getConfigHandler({}, 123)).resolves.toBeNull()
    await expect(getConfigHandler({}, 's'.repeat(257))).resolves.toBeNull()
    await expect(setConfigHandler({}, 'textin', { key: 123 })).rejects.toThrow('pdf:setServiceConfig payload is invalid')
    await expect(setConfigHandler({}, 'textin', { token: 'a\0b' })).rejects.toThrow('pdf:setServiceConfig payload is invalid')
    await expect(setConfigHandler({}, 'textin', JSON.parse('{"__proto__":"x"}'))).rejects.toThrow('pdf:setServiceConfig payload is invalid')
    await expect(setConfigHandler({}, 'textin', { [ 'k'.repeat(257) ]: 'x' })).rejects.toThrow('pdf:setServiceConfig payload is invalid')
    await expect(setPdfConfigHandler({}, JSON.parse('{"activeService":"textin","rememberConfig":true,"services":{"textin":{"__proto__":"x"}}}'))).rejects.toThrow('pdf:setConfig payload is invalid')
    await expect(setPdfConfigHandler({}, JSON.parse('{"activeService":"textin","rememberConfig":true,"services":{"__proto__":{"token":"x"}}}'))).rejects.toThrow('pdf:setConfig payload is invalid')
    await expect(setPdfConfigHandler({}, {
      activeService: 's'.repeat(257),
      rememberConfig: true,
      services: { textin: { token: 'x' } },
    })).rejects.toThrow('pdf:setConfig payload is invalid')
    await expect(setPdfConfigHandler({}, {
      activeService: 'textin',
      rememberConfig: true,
      services: { [ 's'.repeat(257) ]: { token: 'x' } },
    })).rejects.toThrow('pdf:setConfig payload is invalid')
    expect(deps.getServiceConfig).not.toHaveBeenCalled()
    expect(deps.setPdfConfig).not.toHaveBeenCalled()
    expect(deps.setServiceConfig).not.toHaveBeenCalled()
  })

  it('rejects invalid pdf import payloads', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerImportExportIpc(ipcMainLike, deps)

    const handler = channels.get('pdf:import')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, {
      pdfPaths: ['/tmp/a.pdf'],
      serviceId: 'textin',
      serviceConfig: {},
      importImages: 'yes',
    })).rejects.toThrow('pdf:import payload is invalid')
    await expect(handler({}, {
      pdfPaths: [],
      serviceId: 'textin',
      serviceConfig: {},
      importImages: true,
    })).rejects.toThrow('pdf:import payload is invalid')
    await expect(handler({}, {
      pdfPaths: ['/tmp/a.pdf'],
      serviceId: 'textin',
      serviceConfig: {},
      targetNotebookId: '',
      importImages: true,
    })).rejects.toThrow('pdf:import payload is invalid')
    await expect(handler({}, {
      ...VALID_PDF_IMPORT_OPTIONS,
      pdfPaths: Array.from({ length: 257 }, (_, index) => `/tmp/${index}.pdf`),
    })).rejects.toThrow('pdf:import payload is invalid')
    await expect(handler({}, {
      ...VALID_PDF_IMPORT_OPTIONS,
      pdfPaths: ['a'.repeat(4097)],
    })).rejects.toThrow('pdf:import payload is invalid')
    expect(deps.executeImport).not.toHaveBeenCalled()
    expect(deps.pdfImporter.setRuntimeConfig).not.toHaveBeenCalled()
  })

  it('rejects concurrent pdf import sessions to avoid cancellation races', async () => {
    let resolveImport!: (value: ExecuteImportResult) => void
    const executeImportImpl: ImportExportIpcDeps['executeImport'] = async () => new Promise<ExecuteImportResult>((resolve) => {
      resolveImport = resolve
    })
    const executeImport = vi.fn(executeImportImpl)

    const deps = createDeps({ executeImport })
    const { channels, ipcMainLike } = createIpcMainLike()
    registerImportExportIpc(ipcMainLike, deps)

    const handler = channels.get('pdf:import')
    expect(handler).toBeDefined()
    if (!handler) return

    const firstImportPromise = handler({}, VALID_PDF_IMPORT_OPTIONS)
    await vi.waitFor(() => {
      expect(deps.executeImport).toHaveBeenCalledTimes(1)
    })

    await expect(handler({}, VALID_PDF_IMPORT_OPTIONS)).rejects.toThrow('pdf:import is already running')
    expect(deps.executeImport).toHaveBeenCalledTimes(1)

    resolveImport({
      success: true,
      importedNotes: [{ id: 'note-1', title: 'Note 1' }],
      errors: [],
      stats: { importedAttachments: 0 },
    })

    await expect(firstImportPromise).resolves.toMatchObject({
      successCount: 1,
      failCount: 0,
    })
  })

  it('returns per-file error and cleans up when pdf import task fails', async () => {
    const deps = createDeps({
      executeImport: vi.fn(async () => {
        throw new Error('import failed')
      }),
    })
    const { channels, ipcMainLike } = createIpcMainLike()
    registerImportExportIpc(ipcMainLike, deps)

    const handler = channels.get('pdf:import')
    expect(handler).toBeDefined()
    if (!handler) return

    const result = await handler({}, {
      pdfPaths: ['/tmp/a.pdf'],
      serviceId: 'textin',
      serviceConfig: { token: 'x' },
      importImages: true,
    }) as {
      results: Array<{ success: boolean; error?: string }>
      successCount: number
      failCount: number
    }

    expect(result.successCount).toBe(0)
    expect(result.failCount).toBe(1)
    expect(result.results[0]).toMatchObject({
      success: false,
      error: 'import failed',
    })
    expect(deps.pdfImporter.cleanup).toHaveBeenCalledTimes(1)
  })

  it('keeps pdf:import successful when progress event send fails', async () => {
    const mainViewSend = vi.fn(() => {
      throw new Error('send failed')
    })
    const deps = createDeps({
      executeImport: vi.fn(async () => ({
        success: true,
        importedNotes: [{ id: 'note-1', title: 'Note 1' }],
        errors: [],
        stats: { importedAttachments: 0 },
      })),
      getMainView: vi.fn(() => ({
        webContents: { send: mainViewSend },
      }) as unknown as ReturnType<ImportExportIpcDeps['getMainView']>),
    })
    const { channels, ipcMainLike } = createIpcMainLike()
    registerImportExportIpc(ipcMainLike, deps)

    const handler = channels.get('pdf:import')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, VALID_PDF_IMPORT_OPTIONS)).resolves.toMatchObject({
      successCount: 1,
      failCount: 0,
    })
    expect(mainViewSend).toHaveBeenCalled()
  })

  it('fails closed for inline pdf import when service config is missing', async () => {
    showOpenDialogMock.mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/a.pdf'],
    })
    const deps = createDeps({
      getServiceConfig: vi.fn(() => null),
    })
    const { channels, ipcMainLike } = createIpcMainLike()
    registerImportExportIpc(ipcMainLike, deps)

    const handler = channels.get('importInline:selectAndParsePdf')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({})).rejects.toThrow('PDF service not configured')
    expect(deps.pdfImporter.setRuntimeConfig).not.toHaveBeenCalled()
    expect(deps.pdfImporter.parseFileToTiptap).not.toHaveBeenCalled()
    expect(deps.pdfImporter.cleanup).not.toHaveBeenCalled()
  })

  it('cleans up inline pdf importer when parsing fails', async () => {
    showOpenDialogMock.mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/a.pdf'],
    })
    const deps = createDeps({
      getServiceConfig: vi.fn(() => ({ token: 'x' })),
      pdfImporter: {
        setRuntimeConfig: vi.fn(),
        parseFileToTiptap: vi.fn(async () => {
          throw new Error('parse failed')
        }),
        cleanup: vi.fn(),
      },
    })
    const { channels, ipcMainLike } = createIpcMainLike()
    registerImportExportIpc(ipcMainLike, deps)

    const handler = channels.get('importInline:selectAndParsePdf')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({})).rejects.toThrow('parse failed')
    expect(deps.pdfImporter.setRuntimeConfig).toHaveBeenCalledWith(expect.objectContaining({
      serviceId: 'textin',
      serviceConfig: { token: 'x' },
    }))
    expect(deps.pdfImporter.cleanup).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid arxiv payloads', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerImportExportIpc(ipcMainLike, deps)

    const parseHandler = channels.get('arxiv:parseInput')
    const importHandler = channels.get('arxiv:import')
    const inlineHandler = channels.get('importInline:arxiv')
    expect(parseHandler).toBeDefined()
    expect(importHandler).toBeDefined()
    expect(inlineHandler).toBeDefined()
    if (!parseHandler || !importHandler || !inlineHandler) return

    await expect(parseHandler({}, null)).resolves.toBeNull()
    await expect(parseHandler({}, 'a'.repeat(513))).resolves.toBeNull()
    await expect(importHandler({}, { inputs: [1] })).rejects.toThrow('arxiv:import payload is invalid')
    await expect(importHandler({}, { inputs: [] })).rejects.toThrow('arxiv:import payload is invalid')
    await expect(importHandler({}, { inputs: ['2501.00001'], notebookId: '' })).rejects.toThrow('arxiv:import payload is invalid')
    await expect(inlineHandler({}, '', { includeAbstract: 'yes' })).rejects.toThrow('importInline:arxiv payload is invalid')
    await expect(inlineHandler({}, 'a'.repeat(513), { includeAbstract: true })).rejects.toThrow('importInline:arxiv payload is invalid')
    expect(deps.parseArxivInput).not.toHaveBeenCalled()
    expect(deps.arxivImporter.import).not.toHaveBeenCalled()
    expect(deps.arxivImporter.fetchAsTiptap).not.toHaveBeenCalled()
  })
})
