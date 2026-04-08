/**
 * Markdown 导出器测试
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MarkdownExporter } from '../exporters/markdown-exporter'
import * as fs from 'fs'
import * as path from 'path'
import { tmpdir } from 'os'

// Mock database functions
vi.mock('../../database', () => ({
  getNotes: vi.fn(),
  getNotesByIds: vi.fn(),
  getNotesByNotebookIds: vi.fn(),
  getNotebooks: vi.fn(),
}))

// Mock attachment functions
vi.mock('../../attachment', () => ({
  getFullPath: vi.fn(),
}))

import { getNotes, getNotesByIds, getNotesByNotebookIds, getNotebooks } from '../../database'
import { getFullPath } from '../../attachment'
import type { Note, Notebook } from '../../database'
// getFullPath is mocked but not directly used in tests (used internally by exporter)

describe('MarkdownExporter', () => {
  let exporter: MarkdownExporter
  let tempDir: string
  const getExportRoot = (): string => path.join(tempDir, 'sanqian-notes')

  beforeEach(() => {
    exporter = new MarkdownExporter()
    // 创建临时输出目录
    tempDir = path.join(tmpdir(), `export-test-${Date.now()}`)
    fs.mkdirSync(tempDir, { recursive: true })

    // Reset mocks
    vi.clearAllMocks()
  })

  afterEach(() => {
    // 清理临时目录
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  describe('基本属性', () => {
    it('应该有正确的导出器信息', () => {
      expect(exporter.id).toBe('markdown')
      expect(exporter.name).toBe('Markdown')
      expect(exporter.extension).toBe('.md')
    })
  })

  describe('export - 基本导出', () => {
    it('导出单个笔记', async () => {
      const mockNotes = [
        {
          id: 'note1',
          title: '测试笔记',
          content: JSON.stringify({
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: '这是内容' }],
              },
            ],
          }),
          notebook_id: null,
          deleted_at: null,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-02T00:00:00Z',
        },
      ]

      vi.mocked(getNotes).mockReturnValue(mockNotes as Note[])
      vi.mocked(getNotebooks).mockReturnValue([])

      const result = await exporter.export({
        noteIds: [],
        notebookIds: [],
        format: 'markdown',
        outputPath: tempDir,
        groupByNotebook: false,
        includeAttachments: false,
        includeFrontMatter: false,
        asZip: false,
      })

      expect(result.success).toBe(true)
      expect(result.stats.exportedNotes).toBe(1)

      // 检查文件是否创建
      const files = fs.readdirSync(getExportRoot())
      expect(files).toContain('测试笔记.md')

      // 检查内容
      const content = fs.readFileSync(path.join(getExportRoot(), '测试笔记.md'), 'utf-8')
      expect(content).toContain('这是内容')
    })

    it('导出带 front matter', async () => {
      const mockNotes = [
        {
          id: 'note1',
          title: '带元数据的笔记',
          content: JSON.stringify({
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: '内容' }],
              },
            ],
          }),
          notebook_id: 'nb1',
          deleted_at: null,
          created_at: '2024-01-15T10:00:00Z',
          updated_at: '2024-06-20T14:30:00Z',
        },
      ]

      const mockNotebooks = [
        { id: 'nb1', name: '工作笔记本', icon: 'work' },
      ]

      vi.mocked(getNotes).mockReturnValue(mockNotes as Note[])
      vi.mocked(getNotebooks).mockReturnValue(mockNotebooks as Notebook[])

      await exporter.export({
        noteIds: [],
        notebookIds: [],
        format: 'markdown',
        outputPath: tempDir,
        groupByNotebook: false,
        includeAttachments: false,
        includeFrontMatter: true,
        asZip: false,
      })

      const content = fs.readFileSync(
        path.join(getExportRoot(), '带元数据的笔记.md'),
        'utf-8'
      )

      expect(content).toMatch(/^---/)
      expect(content).toContain('带元数据的笔记') // 标题可能带引号
      expect(content).toContain('工作笔记本') // notebook 可能带引号
      expect(content).toContain('created:')
      expect(content).toContain('updated:')
    })

    it('按笔记本分组导出', async () => {
      const mockNotes = [
        {
          id: 'note1',
          title: '笔记A',
          content: '{"type":"doc","content":[]}',
          notebook_id: 'nb1',
          deleted_at: null,
        },
        {
          id: 'note2',
          title: '笔记B',
          content: '{"type":"doc","content":[]}',
          notebook_id: 'nb2',
          deleted_at: null,
        },
      ]

      const mockNotebooks = [
        { id: 'nb1', name: '笔记本1', icon: '' },
        { id: 'nb2', name: '笔记本2', icon: '' },
      ]

      vi.mocked(getNotes).mockReturnValue(mockNotes as Note[])
      vi.mocked(getNotebooks).mockReturnValue(mockNotebooks as Notebook[])

      await exporter.export({
        noteIds: [],
        notebookIds: [],
        format: 'markdown',
        outputPath: tempDir,
        groupByNotebook: true,
        includeAttachments: false,
        includeFrontMatter: false,
        asZip: false,
      })

      // 检查目录结构
      expect(fs.existsSync(path.join(getExportRoot(), '笔记本1'))).toBe(true)
      expect(fs.existsSync(path.join(getExportRoot(), '笔记本2'))).toBe(true)
      expect(fs.existsSync(path.join(getExportRoot(), '笔记本1', '笔记A.md'))).toBe(true)
      expect(fs.existsSync(path.join(getExportRoot(), '笔记本2', '笔记B.md'))).toBe(true)
    })

    it('按笔记本分组时，日记统一导出到日记目录', async () => {
      const mockNotes = [
        {
          id: 'note1',
          title: '2024-01-01',
          content: '{"type":"doc","content":[]}',
          notebook_id: 'nb1',
          is_daily: true,
          daily_date: '2024-01-01',
          deleted_at: null,
        },
        {
          id: 'note2',
          title: '2024-01-02',
          content: '{"type":"doc","content":[]}',
          notebook_id: 'nb2',
          is_daily: true,
          daily_date: '2024-01-02',
          deleted_at: null,
        },
        {
          id: 'note3',
          title: '普通笔记',
          content: '{"type":"doc","content":[]}',
          notebook_id: 'nb1',
          is_daily: false,
          daily_date: null,
          deleted_at: null,
        },
      ]

      const mockNotebooks = [
        { id: 'nb1', name: '笔记本1', icon: '' },
        { id: 'nb2', name: '笔记本2', icon: '' },
      ]

      vi.mocked(getNotes).mockReturnValue(mockNotes as Note[])
      vi.mocked(getNotebooks).mockReturnValue(mockNotebooks as Notebook[])

      await exporter.export({
        noteIds: [],
        notebookIds: [],
        format: 'markdown',
        outputPath: tempDir,
        groupByNotebook: true,
        includeAttachments: false,
        includeFrontMatter: false,
        asZip: false,
      })

      expect(fs.existsSync(path.join(getExportRoot(), '日记'))).toBe(true)
      expect(fs.existsSync(path.join(getExportRoot(), '日记', '2024-01-01.md'))).toBe(true)
      expect(fs.existsSync(path.join(getExportRoot(), '日记', '2024-01-02.md'))).toBe(true)
      expect(fs.existsSync(path.join(getExportRoot(), '笔记本1', '普通笔记.md'))).toBe(true)
      expect(fs.existsSync(path.join(getExportRoot(), '笔记本1', '2024-01-01.md'))).toBe(false)
      expect(fs.existsSync(path.join(getExportRoot(), '笔记本2', '2024-01-02.md'))).toBe(false)
    })

    it('跳过已删除的笔记', async () => {
      const mockNotes = [
        {
          id: 'note1',
          title: '正常笔记',
          content: '{"type":"doc","content":[]}',
          deleted_at: null,
        },
        {
          id: 'note2',
          title: '已删除笔记',
          content: '{"type":"doc","content":[]}',
          deleted_at: '2024-01-01T00:00:00Z',
        },
      ]

      vi.mocked(getNotes).mockReturnValue(mockNotes as Note[])
      vi.mocked(getNotebooks).mockReturnValue([])

      const result = await exporter.export({
        noteIds: [],
        notebookIds: [],
        format: 'markdown',
        outputPath: tempDir,
        groupByNotebook: false,
        includeAttachments: false,
        includeFrontMatter: false,
        asZip: false,
      })

      expect(result.stats.exportedNotes).toBe(1)
      const files = fs.readdirSync(getExportRoot())
      expect(files).not.toContain('已删除笔记.md')
    })
  })

  describe('export - 指定笔记导出', () => {
    it('只导出指定 ID 的笔记', async () => {
      const mockNotes = [
        {
          id: 'note1',
          title: '指定笔记',
          content: '{"type":"doc","content":[]}',
          deleted_at: null,
        },
      ]

      vi.mocked(getNotesByIds).mockReturnValue(mockNotes as Note[])
      vi.mocked(getNotebooks).mockReturnValue([])

      const result = await exporter.export({
        noteIds: ['note1'],
        notebookIds: [],
        format: 'markdown',
        outputPath: tempDir,
        groupByNotebook: false,
        includeAttachments: false,
        includeFrontMatter: false,
        asZip: false,
      })

      expect(result.stats.exportedNotes).toBe(1)
      expect(vi.mocked(getNotesByIds)).toHaveBeenCalledWith(['note1'])
    })

    it('按笔记本 ID 过滤导出', async () => {
      const mockNotes = [
        {
          id: 'note1',
          title: '笔记本筛选笔记',
          content: '{"type":"doc","content":[]}',
          deleted_at: null,
        },
      ]

      vi.mocked(getNotesByNotebookIds).mockReturnValue(mockNotes as Note[])
      vi.mocked(getNotebooks).mockReturnValue([])

      const result = await exporter.export({
        noteIds: [],
        notebookIds: ['nb-1'],
        format: 'markdown',
        outputPath: tempDir,
        groupByNotebook: false,
        includeAttachments: false,
        includeFrontMatter: false,
        asZip: false,
      })

      expect(result.stats.exportedNotes).toBe(1)
      expect(vi.mocked(getNotesByNotebookIds)).toHaveBeenCalledWith(['nb-1'])
      expect(vi.mocked(getNotes)).not.toHaveBeenCalled()
    })

    it('显式无效 noteIds/notebookIds 输入不会退化为全量导出', async () => {
      vi.mocked(getNotes).mockReturnValue([
        {
          id: 'note-all',
          title: '不应被导出',
          content: '{"type":"doc","content":[]}',
          deleted_at: null,
        },
      ] as Note[])
      vi.mocked(getNotebooks).mockReturnValue([])

      const byInvalidNoteIds = await exporter.export({
        noteIds: 'note-1' as any,
        notebookIds: [],
        format: 'markdown',
        outputPath: tempDir,
        groupByNotebook: false,
        includeAttachments: false,
        includeFrontMatter: false,
        asZip: false,
      } as any)
      expect(byInvalidNoteIds.stats.exportedNotes).toBe(0)
      expect(vi.mocked(getNotes)).not.toHaveBeenCalled()
      expect(vi.mocked(getNotesByIds)).not.toHaveBeenCalled()

      const byInvalidNotebookIds = await exporter.export({
        noteIds: [],
        notebookIds: { id: 'nb-1' } as any,
        format: 'markdown',
        outputPath: tempDir,
        groupByNotebook: false,
        includeAttachments: false,
        includeFrontMatter: false,
        asZip: false,
      } as any)
      expect(byInvalidNotebookIds.stats.exportedNotes).toBe(0)
      expect(vi.mocked(getNotes)).not.toHaveBeenCalled()
      expect(vi.mocked(getNotesByNotebookIds)).not.toHaveBeenCalled()
    })

    it('noteIds/notebookIds 显式为 undefined 时按未传处理', async () => {
      vi.mocked(getNotes).mockReturnValue([
        {
          id: 'note-global',
          title: '全量导出',
          content: '{"type":"doc","content":[]}',
          deleted_at: null,
        },
      ] as Note[])
      vi.mocked(getNotebooks).mockReturnValue([])

      const result = await exporter.export({
        noteIds: undefined as any,
        notebookIds: undefined as any,
        format: 'markdown',
        outputPath: tempDir,
        groupByNotebook: false,
        includeAttachments: false,
        includeFrontMatter: false,
        asZip: false,
      } as any)

      expect(result.stats.exportedNotes).toBe(1)
      expect(vi.mocked(getNotes)).toHaveBeenCalledTimes(1)
      expect(vi.mocked(getNotesByIds)).not.toHaveBeenCalled()
      expect(vi.mocked(getNotesByNotebookIds)).not.toHaveBeenCalled()
    })

    it('当 noteIds 已有效命中时，不受无效 notebookIds 干扰', async () => {
      const mockNotes = [
        {
          id: 'note1',
          title: '优先按 noteIds 导出',
          content: '{"type":"doc","content":[]}',
          deleted_at: null,
        },
      ]
      vi.mocked(getNotesByIds).mockReturnValue(mockNotes as Note[])
      vi.mocked(getNotebooks).mockReturnValue([])

      const result = await exporter.export({
        noteIds: ['note1'],
        notebookIds: { id: 'invalid' } as any,
        format: 'markdown',
        outputPath: tempDir,
        groupByNotebook: false,
        includeAttachments: false,
        includeFrontMatter: false,
        asZip: false,
      } as any)

      expect(result.stats.exportedNotes).toBe(1)
      expect(vi.mocked(getNotesByIds)).toHaveBeenCalledWith(['note1'])
      expect(vi.mocked(getNotesByNotebookIds)).not.toHaveBeenCalled()
      expect(vi.mocked(getNotes)).not.toHaveBeenCalled()
    })
  })

  describe('export - 文件名处理', () => {
    it('处理重复文件名', async () => {
      const mockNotes = [
        {
          id: 'note1',
          title: '相同标题',
          content: '{"type":"doc","content":[]}',
          deleted_at: null,
        },
        {
          id: 'note2',
          title: '相同标题',
          content: '{"type":"doc","content":[]}',
          deleted_at: null,
        },
      ]

      vi.mocked(getNotes).mockReturnValue(mockNotes as Note[])
      vi.mocked(getNotebooks).mockReturnValue([])

      await exporter.export({
        noteIds: [],
        notebookIds: [],
        format: 'markdown',
        outputPath: tempDir,
        groupByNotebook: false,
        includeAttachments: false,
        includeFrontMatter: false,
        asZip: false,
      })

      const files = fs.readdirSync(getExportRoot())
      expect(files).toContain('相同标题.md')
      expect(files.some((f) => f.includes('相同标题') && f !== '相同标题.md')).toBe(
        true
      )
    })

    it('清理文件名中的非法字符', async () => {
      const mockNotes = [
        {
          id: 'note1',
          title: '文件/名:有*问?号',
          content: '{"type":"doc","content":[]}',
          deleted_at: null,
        },
      ]

      vi.mocked(getNotes).mockReturnValue(mockNotes as Note[])
      vi.mocked(getNotebooks).mockReturnValue([])

      await exporter.export({
        noteIds: [],
        notebookIds: [],
        format: 'markdown',
        outputPath: tempDir,
        groupByNotebook: false,
        includeAttachments: false,
        includeFrontMatter: false,
        asZip: false,
      })

      const files = fs.readdirSync(getExportRoot())
      // 非法字符应该被替换
      expect(files[0]).not.toContain('/')
      expect(files[0]).not.toContain(':')
      expect(files[0]).not.toContain('*')
      expect(files[0]).not.toContain('?')
    })

    it('图片附件后缀异常时按真实图片格式导出到 assets', async () => {
      const sourceImagePath = path.join(tempDir, 'source-image.f1')
      const pngBytes = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mP8/5+hHgAHggJ/Pw9u4wAAAABJRU5ErkJggg==',
        'base64'
      )
      fs.writeFileSync(sourceImagePath, pngBytes)
      vi.mocked(getFullPath).mockResolvedValue(sourceImagePath)

      const mockNotes = [
        {
          id: 'note1',
          title: '图片后缀测试',
          content: JSON.stringify({
            type: 'doc',
            content: [
              {
                type: 'image',
                attrs: {
                  src: 'attachment://attachments/2026/01/1768792490097-2836e36e.f1',
                  alt: 'Figure 1',
                },
              },
            ],
          }),
          deleted_at: null,
        },
      ]

      vi.mocked(getNotes).mockReturnValue(mockNotes as Note[])
      vi.mocked(getNotebooks).mockReturnValue([])

      await exporter.export({
        noteIds: [],
        notebookIds: [],
        format: 'markdown',
        outputPath: tempDir,
        groupByNotebook: false,
        includeAttachments: true,
        includeFrontMatter: false,
        asZip: false,
      })

      const mdContent = fs.readFileSync(path.join(getExportRoot(), '图片后缀测试.md'), 'utf-8')
      expect(mdContent).toMatch(/!\[Figure 1\]\(\.\/assets\/.*\.png\)/)
      expect(mdContent).not.toContain('.f1)')

      const assetsDir = path.join(getExportRoot(), 'assets')
      const assetFiles = fs.readdirSync(assetsDir)
      expect(assetFiles.some((name) => name.endsWith('.png'))).toBe(true)
    })
  })

  describe('export - 空笔记处理', () => {
    it('没有笔记时返回成功但统计为 0', async () => {
      vi.mocked(getNotes).mockReturnValue([])
      vi.mocked(getNotebooks).mockReturnValue([])

      const result = await exporter.export({
        noteIds: [],
        notebookIds: [],
        format: 'markdown',
        outputPath: tempDir,
        groupByNotebook: false,
        includeAttachments: false,
        includeFrontMatter: false,
        asZip: false,
      })

      expect(result.success).toBe(true)
      expect(result.stats.exportedNotes).toBe(0)
      expect(result.errors).toHaveLength(0)
    })
  })
})
