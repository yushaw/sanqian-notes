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
  getNotebooks: vi.fn(),
}))

// Mock attachment functions
vi.mock('../../attachment', () => ({
  getFullPath: vi.fn(),
}))

import { getNotes, getNotesByIds, getNotebooks } from '../../database'
import type { Note, Notebook } from '../../database'
// getFullPath is mocked but not directly used in tests (used internally by exporter)

describe('MarkdownExporter', () => {
  let exporter: MarkdownExporter
  let tempDir: string

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
      const files = fs.readdirSync(tempDir)
      expect(files).toContain('测试笔记.md')

      // 检查内容
      const content = fs.readFileSync(path.join(tempDir, '测试笔记.md'), 'utf-8')
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
        path.join(tempDir, '带元数据的笔记.md'),
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
      expect(fs.existsSync(path.join(tempDir, '笔记本1'))).toBe(true)
      expect(fs.existsSync(path.join(tempDir, '笔记本2'))).toBe(true)
      expect(fs.existsSync(path.join(tempDir, '笔记本1', '笔记A.md'))).toBe(true)
      expect(fs.existsSync(path.join(tempDir, '笔记本2', '笔记B.md'))).toBe(true)
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
      const files = fs.readdirSync(tempDir)
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

      const files = fs.readdirSync(tempDir)
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

      const files = fs.readdirSync(tempDir)
      // 非法字符应该被替换
      expect(files[0]).not.toContain('/')
      expect(files[0]).not.toContain(':')
      expect(files[0]).not.toContain('*')
      expect(files[0]).not.toContain('?')
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
