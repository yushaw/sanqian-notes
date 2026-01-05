/**
 * Markdown 导入器测试
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MarkdownImporter } from '../importers/markdown-importer'
import * as fs from 'fs'
import * as path from 'path'
import { tmpdir } from 'os'

describe('MarkdownImporter', () => {
  let importer: MarkdownImporter
  let tempDir: string

  beforeEach(() => {
    importer = new MarkdownImporter()
    // 创建临时测试目录
    tempDir = path.join(tmpdir(), `import-test-${Date.now()}`)
    fs.mkdirSync(tempDir, { recursive: true })
  })

  afterEach(() => {
    // 清理临时目录
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  describe('info', () => {
    it('应该有正确的导入器信息', () => {
      expect(importer.info.id).toBe('markdown')
      expect(importer.info.name).toBe('Markdown')
      expect(importer.info.extensions).toContain('md')
      expect(importer.info.extensions).toContain('markdown')
      expect(importer.info.supportsFolder).toBe(true)
    })
  })

  describe('canHandle', () => {
    it('能处理 .md 文件', async () => {
      const filePath = path.join(tempDir, 'test.md')
      fs.writeFileSync(filePath, '# Test')

      const result = await importer.canHandle(filePath)
      expect(result).toBe(true)
    })

    it('能处理 .markdown 文件', async () => {
      const filePath = path.join(tempDir, 'test.markdown')
      fs.writeFileSync(filePath, '# Test')

      const result = await importer.canHandle(filePath)
      expect(result).toBe(true)
    })

    it('能处理包含 Markdown 文件的目录', async () => {
      const subDir = path.join(tempDir, 'notes')
      fs.mkdirSync(subDir)
      fs.writeFileSync(path.join(subDir, 'note.md'), '# Note')

      const result = await importer.canHandle(tempDir)
      expect(result).toBe(true)
    })

    it('不能处理其他类型文件', async () => {
      const filePath = path.join(tempDir, 'test.txt')
      fs.writeFileSync(filePath, 'plain text')

      const result = await importer.canHandle(filePath)
      expect(result).toBe(false)
    })

    it('不能处理空目录', async () => {
      const emptyDir = path.join(tempDir, 'empty')
      fs.mkdirSync(emptyDir)

      const result = await importer.canHandle(emptyDir)
      expect(result).toBe(false)
    })

    it('不能处理不存在的路径', async () => {
      const result = await importer.canHandle('/nonexistent/path')
      expect(result).toBe(false)
    })
  })

  describe('parse - 单文件', () => {
    it('解析简单 Markdown 文件', async () => {
      const filePath = path.join(tempDir, 'simple.md')
      fs.writeFileSync(filePath, '# 我的笔记\n\n这是内容。')

      const notes = await importer.parse({
        sourcePath: filePath,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: false,
      })

      expect(notes).toHaveLength(1)
      expect(notes[0].title).toBe('我的笔记')
      expect(notes[0].sourcePath).toBe(filePath)
    })

    it('解析带 front matter 的文件', async () => {
      const filePath = path.join(tempDir, 'with-frontmatter.md')
      fs.writeFileSync(
        filePath,
        `---
title: Front Matter 标题
tags: [工作, 学习]
created: 2024-01-15
---

# 文档标题

正文内容`
      )

      const notes = await importer.parse({
        sourcePath: filePath,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: true,
      })

      expect(notes).toHaveLength(1)
      expect(notes[0].title).toBe('Front Matter 标题')
      expect(notes[0].tags).toContain('工作')
      expect(notes[0].tags).toContain('学习')
      expect(notes[0].createdAt).toBeInstanceOf(Date)
    })

    it('没有标题时使用文件名', async () => {
      const filePath = path.join(tempDir, '我的文件.md')
      fs.writeFileSync(filePath, '这是没有标题的内容')

      const notes = await importer.parse({
        sourcePath: filePath,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: false,
      })

      expect(notes[0].title).toBe('我的文件')
    })
  })

  describe('parse - 目录', () => {
    beforeEach(() => {
      // 创建测试目录结构
      // tempDir/
      //   ├── 笔记本A/
      //   │   ├── note1.md
      //   │   └── 子目录/
      //   │       └── note2.md
      //   ├── 笔记本B/
      //   │   └── note3.md
      //   └── root-note.md

      fs.mkdirSync(path.join(tempDir, '笔记本A', '子目录'), { recursive: true })
      fs.mkdirSync(path.join(tempDir, '笔记本B'))

      fs.writeFileSync(path.join(tempDir, '笔记本A', 'note1.md'), '# 笔记1')
      fs.writeFileSync(path.join(tempDir, '笔记本A', '子目录', 'note2.md'), '# 笔记2')
      fs.writeFileSync(path.join(tempDir, '笔记本B', 'note3.md'), '# 笔记3')
      fs.writeFileSync(path.join(tempDir, 'root-note.md'), '# 根目录笔记')
    })

    it('first-level 策略：一级目录作为笔记本', async () => {
      const notes = await importer.parse({
        sourcePath: tempDir,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: false,
      })

      expect(notes).toHaveLength(4)

      const note1 = notes.find((n) => n.title === '笔记1')
      const note2 = notes.find((n) => n.title === '笔记2')
      const note3 = notes.find((n) => n.title === '笔记3')
      const rootNote = notes.find((n) => n.title === '根目录笔记')

      expect(note1?.notebookName).toBe('笔记本A')
      expect(note2?.notebookName).toBe('笔记本A') // 子目录仍属于 笔记本A
      expect(note3?.notebookName).toBe('笔记本B')
      expect(rootNote?.notebookName).toBeUndefined() // 根目录笔记无笔记本
    })

    it('flatten-path 策略：完整路径作为笔记本名', async () => {
      const notes = await importer.parse({
        sourcePath: tempDir,
        folderStrategy: 'flatten-path',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: false,
      })

      const note2 = notes.find((n) => n.title === '笔记2')
      expect(note2?.notebookName).toBe('笔记本A/子目录')
    })

    it('single-notebook 策略：所有笔记无笔记本名（由外部指定）', async () => {
      const notes = await importer.parse({
        sourcePath: tempDir,
        folderStrategy: 'single-notebook',
        targetNotebookId: 'target-nb-id',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: false,
      })

      notes.forEach((note) => {
        expect(note.notebookName).toBeUndefined()
      })
    })

    it('跳过隐藏文件和目录', async () => {
      fs.mkdirSync(path.join(tempDir, '.hidden'))
      fs.writeFileSync(path.join(tempDir, '.hidden', 'hidden.md'), '# Hidden')
      fs.writeFileSync(path.join(tempDir, '.hiddenfile.md'), '# Hidden File')

      const notes = await importer.parse({
        sourcePath: tempDir,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: false,
      })

      const hiddenNotes = notes.filter((n) => n.title.includes('Hidden'))
      expect(hiddenNotes).toHaveLength(0)
    })
  })

  describe('parse - 附件收集', () => {
    it('收集图片附件引用', async () => {
      const filePath = path.join(tempDir, 'with-images.md')
      const imageDir = path.join(tempDir, 'images')
      fs.mkdirSync(imageDir)
      fs.writeFileSync(path.join(imageDir, 'photo.png'), 'fake image')

      fs.writeFileSync(
        filePath,
        `# 带图片的笔记

![图片说明](./images/photo.png)

更多内容`
      )

      const notes = await importer.parse({
        sourcePath: filePath,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: true,
        parseFrontMatter: false,
      })

      expect(notes[0].attachments).toHaveLength(1)
      expect(notes[0].attachments[0].sourcePath).toContain('photo.png')
    })

    it('不导入附件时 attachments 为空', async () => {
      const filePath = path.join(tempDir, 'with-images.md')
      fs.writeFileSync(filePath, '![image](./photo.png)')

      const notes = await importer.parse({
        sourcePath: filePath,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: false,
      })

      expect(notes[0].attachments).toHaveLength(0)
    })
  })

  describe('parse - Wiki 链接收集', () => {
    it('收集 wiki 风格链接', async () => {
      const filePath = path.join(tempDir, 'with-links.md')
      fs.writeFileSync(
        filePath,
        `# 链接测试

这里有一个 [[其他笔记]] 链接。
还有一个带标题的 [[笔记#标题]] 链接。
以及块引用 [[文档#^block-id]]。`
      )

      const notes = await importer.parse({
        sourcePath: filePath,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: false,
      })

      expect(notes[0].links.length).toBeGreaterThanOrEqual(3)
      expect(notes[0].links.some((l) => l.targetTitle === '其他笔记')).toBe(true)
    })
  })
})
