import os from 'os'
import path from 'path'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  appGetPathMock,
  buildNoteFromResolvedResourceMock,
  getUserDataPathMock,
  jsonToMarkdownMock,
  resolveNoteResourceAsyncMock,
  showOpenDialogMock,
  showSaveDialogMock,
} = vi.hoisted(() => ({
  appGetPathMock: vi.fn(),
  buildNoteFromResolvedResourceMock: vi.fn(),
  getUserDataPathMock: vi.fn(),
  jsonToMarkdownMock: vi.fn(),
  resolveNoteResourceAsyncMock: vi.fn(),
  showOpenDialogMock: vi.fn(),
  showSaveDialogMock: vi.fn(),
}))

vi.mock('electron', () => ({
  BrowserWindow: class {
    webContents = {
      executeJavaScript: vi.fn(async () => undefined),
      printToPDF: vi.fn(async () => Buffer.from('pdf')),
    }

    async loadFile(): Promise<void> {}

    close(): void {}
  },
  dialog: {
    showOpenDialog: showOpenDialogMock,
    showSaveDialog: showSaveDialogMock,
  },
  app: {
    getPath: appGetPathMock,
  },
}))

vi.mock('../../database', () => ({
  getLiveNotesForDataviewProjection: vi.fn(() => []),
  getNotebooks: vi.fn(() => []),
  getLocalFolderMounts: vi.fn(() => []),
  listLocalNoteMetadata: vi.fn(() => []),
}))

vi.mock('../../markdown/tiptap-to-markdown', () => ({
  jsonToMarkdown: jsonToMarkdownMock,
}))

vi.mock('../../attachment', () => ({
  getUserDataPath: getUserDataPathMock,
}))

vi.mock('../../note-gateway', () => ({
  buildCanonicalLocalResourceId: vi.fn(() => 'local:mock-id'),
  buildNoteFromResolvedResource: buildNoteFromResolvedResourceMock,
  resolveNoteResourceAsync: resolveNoteResourceAsyncMock,
}))

vi.mock('../../local-folder', () => ({
  scanLocalFolderMountForSearchAsync: vi.fn(async () => ({
    notebook_id: 'nb',
    root_path: '/tmp',
    scanned_at: new Date().toISOString(),
    tree: [],
    files: [],
  })),
}))

import { clearExportNoteCache, exportNoteAsMarkdown } from '../note-exporter'

describe('note-exporter markdown export', () => {
  let testRoot = ''
  let downloadsDir = ''
  let userDataDir = ''

  beforeEach(async () => {
    vi.clearAllMocks()

    testRoot = await mkdtemp(path.join(os.tmpdir(), 'note-exporter-test-'))
    downloadsDir = path.join(testRoot, 'downloads')
    userDataDir = path.join(testRoot, 'userData')
    await mkdir(downloadsDir, { recursive: true })
    await mkdir(userDataDir, { recursive: true })

    appGetPathMock.mockImplementation((target: string) => {
      if (target === 'downloads') return downloadsDir
      return testRoot
    })
    getUserDataPathMock.mockReturnValue(userDataDir)

    resolveNoteResourceAsyncMock.mockResolvedValue({
      ok: true,
      resource: {
        sourceType: 'internal',
      },
    })

    buildNoteFromResolvedResourceMock.mockReturnValue({
      id: 'note-1',
      title: 'Export Note',
      content: '{"type":"doc","content":[]}',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      is_daily: false,
      daily_date: null,
    })
  })

  afterEach(async () => {
    clearExportNoteCache()
    if (testRoot) {
      await rm(testRoot, { recursive: true, force: true })
    }
  })

  it('copies attachments and rewrites markdown links during export', async () => {
    const sourceAttachmentPath = path.join(userDataDir, 'attachments', 'images', 'diagram')
    await mkdir(path.dirname(sourceAttachmentPath), { recursive: true })
    await writeFile(sourceAttachmentPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))

    jsonToMarkdownMock.mockReturnValue('![diagram](attachment://images/diagram)')
    showOpenDialogMock.mockResolvedValue({
      canceled: false,
      filePaths: [downloadsDir],
    })

    const result = await exportNoteAsMarkdown('note-1', {
      includeAttachments: true,
    })

    expect(result).toEqual({
      success: true,
      path: path.join(downloadsDir, 'Export Note'),
    })

    const markdownPath = path.join(downloadsDir, 'Export Note', 'Export Note.md')
    const markdownContent = await readFile(markdownPath, 'utf-8')
    expect(markdownContent).toContain('![diagram](./assets/images_diagram.png)')

    const copiedAttachmentPath = path.join(downloadsDir, 'Export Note', 'assets', 'images_diagram.png')
    await expect(stat(copiedAttachmentPath)).resolves.toMatchObject({ isFile: expect.any(Function) })
  })

  it('falls back to single-file save dialog when markdown has no attachments', async () => {
    const savePath = path.join(downloadsDir, 'single-note.md')
    jsonToMarkdownMock.mockReturnValue('# only text')
    showSaveDialogMock.mockResolvedValue({
      canceled: false,
      filePath: savePath,
    })

    const result = await exportNoteAsMarkdown('note-1', {
      includeAttachments: true,
    })

    expect(result).toEqual({
      success: true,
      path: savePath,
    })
    await expect(readFile(savePath, 'utf-8')).resolves.toBe('# only text')
    expect(showOpenDialogMock).not.toHaveBeenCalled()
  })

  it('resolves note through async gateway before markdown export', async () => {
    jsonToMarkdownMock.mockReturnValue('# async')
    showSaveDialogMock.mockResolvedValue({
      canceled: false,
      filePath: path.join(downloadsDir, 'async-note.md'),
    })

    const result = await exportNoteAsMarkdown('note-1')

    expect(result.success).toBe(true)
    expect(resolveNoteResourceAsyncMock).toHaveBeenCalledWith('note-1')
  })
})
