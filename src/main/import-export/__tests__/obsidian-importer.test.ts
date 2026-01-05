/**
 * Obsidian 导入器测试
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { tmpdir } from 'os'
import { ObsidianImporter } from '../importers/obsidian-importer'

describe('ObsidianImporter', () => {
  let tempDir: string
  let importer: ObsidianImporter

  beforeEach(() => {
    tempDir = path.join(tmpdir(), `obsidian-importer-test-${Date.now()}`)
    fs.mkdirSync(tempDir, { recursive: true })
    importer = new ObsidianImporter()
  })

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  describe('canHandle', () => {
    it('应该检测到 Obsidian vault（有 .obsidian 文件夹）', async () => {
      // 创建 .obsidian 文件夹
      fs.mkdirSync(path.join(tempDir, '.obsidian'))
      fs.writeFileSync(path.join(tempDir, 'note.md'), '# Test')

      const result = await importer.canHandle(tempDir)
      expect(result).toBe(true)
    })

    it('应该拒绝普通 Markdown 文件夹（无 .obsidian）', async () => {
      fs.writeFileSync(path.join(tempDir, 'note.md'), '# Test')

      const result = await importer.canHandle(tempDir)
      expect(result).toBe(false)
    })

    it('应该拒绝单个文件', async () => {
      const filePath = path.join(tempDir, 'note.md')
      fs.writeFileSync(filePath, '# Test')

      const result = await importer.canHandle(filePath)
      expect(result).toBe(false)
    })

    it('应该拒绝不存在的路径', async () => {
      const result = await importer.canHandle('/nonexistent/path')
      expect(result).toBe(false)
    })
  })

  describe('parse', () => {
    beforeEach(() => {
      // 创建模拟的 Obsidian vault
      fs.mkdirSync(path.join(tempDir, '.obsidian'))
    })

    it('应该解析 Obsidian vault 中的笔记', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'note1.md'),
        `---
title: 测试笔记
tags: [工作, 重要]
---

# 测试笔记

这是内容。`
      )

      const notes = await importer.parse({
        sourcePath: tempDir,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: true,
      })

      expect(notes.length).toBe(1)
      expect(notes[0].title).toBe('测试笔记')
      expect(notes[0].tags.length).toBeGreaterThan(0)
    })

    it('应该收集 wiki 链接', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'note-with-links.md'),
        `# 笔记

参考 [[其他笔记]] 和 [[另一个笔记#标题]]。`
      )

      const notes = await importer.parse({
        sourcePath: tempDir,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: false,
      })

      expect(notes.length).toBe(1)
      expect(notes[0].links.length).toBe(2)
      expect(notes[0].links[0].targetTitle).toBe('其他笔记')
      expect(notes[0].links[1].targetTitle).toBe('另一个笔记')
      expect(notes[0].links[1].anchor).toBe('标题')
    })

    it('应该提取内联标签', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'note-with-tags.md'),
        `# 笔记

这是一个 #工作 相关的笔记，也涉及 #学习/编程。

不应该匹配 ##标题 或代码中的 \`#tag\`。`
      )

      const notes = await importer.parse({
        sourcePath: tempDir,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: false,
      })

      expect(notes.length).toBe(1)
      expect(notes[0].tags).toContain('工作')
      expect(notes[0].tags).toContain('学习/编程')
      expect(notes[0].tags).not.toContain('#标题')
    })

    it('应该处理嵌入笔记语法 ![[note]]', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'note-with-embed.md'),
        `# 笔记

嵌入内容：
![[其他笔记]]

带别名的嵌入：
![[其他笔记|显示名称]]`
      )

      const notes = await importer.parse({
        sourcePath: tempDir,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: false,
      })

      expect(notes.length).toBe(1)
      // 嵌入语法应被转换为引用文本
      expect(notes[0].content).toContain('Embedded')
    })

    it('应该收集 Obsidian 格式的图片附件', async () => {
      // 创建图片文件
      fs.mkdirSync(path.join(tempDir, 'attachments'))
      fs.writeFileSync(path.join(tempDir, 'attachments', 'image.png'), 'fake image')

      fs.writeFileSync(
        path.join(tempDir, 'note-with-image.md'),
        `# 笔记

![[image.png]]`
      )

      const notes = await importer.parse({
        sourcePath: tempDir,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: true,
        parseFrontMatter: false,
      })

      expect(notes.length).toBe(1)
      expect(notes[0].attachments.length).toBe(1)
      expect(notes[0].attachments[0].sourcePath).toContain('image.png')
    })

    it('应该跳过 .obsidian 目录中的文件', async () => {
      fs.writeFileSync(path.join(tempDir, '.obsidian', 'config.json'), '{}')
      fs.writeFileSync(path.join(tempDir, 'real-note.md'), '# Real Note')

      const notes = await importer.parse({
        sourcePath: tempDir,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: false,
      })

      expect(notes.length).toBe(1)
      // Obsidian 使用文件名作为标题，而非 H1
      expect(notes[0].title).toBe('real-note')
    })

    it('应该处理多层目录结构', async () => {
      fs.mkdirSync(path.join(tempDir, 'Work', 'Projects'), { recursive: true })
      fs.mkdirSync(path.join(tempDir, 'Personal'))

      fs.writeFileSync(path.join(tempDir, 'Work', 'todo.md'), '# Work Todo')
      fs.writeFileSync(path.join(tempDir, 'Work', 'Projects', 'project-a.md'), '# Project A')
      fs.writeFileSync(path.join(tempDir, 'Personal', 'diary.md'), '# Diary')
      fs.writeFileSync(path.join(tempDir, 'root-note.md'), '# Root Note')

      const notes = await importer.parse({
        sourcePath: tempDir,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: false,
      })

      expect(notes.length).toBe(4)

      const workNotes = notes.filter((n) => n.notebookName === 'Work')
      const personalNotes = notes.filter((n) => n.notebookName === 'Personal')
      const rootNotes = notes.filter((n) => !n.notebookName)

      expect(workNotes.length).toBe(2)
      expect(personalNotes.length).toBe(1)
      expect(rootNotes.length).toBe(1)
    })
  })

  describe('info', () => {
    it('应该有正确的导入器信息', () => {
      expect(importer.info.id).toBe('obsidian')
      expect(importer.info.name).toBe('Obsidian')
      expect(importer.info.supportsFolder).toBe(true)
    })
  })

  describe('parse - 边界情况', () => {
    beforeEach(() => {
      fs.mkdirSync(path.join(tempDir, '.obsidian'))
    })

    it('应该处理空 vault', async () => {
      // .obsidian 存在但没有笔记
      const notes = await importer.parse({
        sourcePath: tempDir,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: false,
      })

      expect(notes.length).toBe(0)
    })

    it('应该处理带别名的 wiki 链接', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'note-with-alias.md'),
        `# 笔记

参考 [[长标题笔记|简称]] 了解更多。`
      )

      const notes = await importer.parse({
        sourcePath: tempDir,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: false,
      })

      expect(notes.length).toBe(1)
      expect(notes[0].links.length).toBe(1)
      expect(notes[0].links[0].targetTitle).toBe('长标题笔记')
    })

    it('应该处理混合标准 Markdown 和 Obsidian 图片语法', async () => {
      fs.mkdirSync(path.join(tempDir, 'images'))
      fs.writeFileSync(path.join(tempDir, 'images', 'a.png'), 'fake')
      fs.writeFileSync(path.join(tempDir, 'images', 'b.png'), 'fake')

      fs.writeFileSync(
        path.join(tempDir, 'mixed-images.md'),
        `# 混合图片

Obsidian 风格: ![[a.png]]

Markdown 风格: ![](./images/b.png)`
      )

      const notes = await importer.parse({
        sourcePath: tempDir,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: true,
        parseFrontMatter: false,
      })

      expect(notes.length).toBe(1)
      expect(notes[0].attachments.length).toBe(2)
    })

    it('应该正确处理代码块中的标签', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'code-tags.md'),
        `# 代码中的标签

这是真正的 #标签

\`\`\`javascript
// #这不是标签
const tag = '#也不是标签'
\`\`\`

这也是真正的 #另一个标签`
      )

      const notes = await importer.parse({
        sourcePath: tempDir,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: false,
      })

      expect(notes.length).toBe(1)
      expect(notes[0].tags).toContain('标签')
      expect(notes[0].tags).toContain('另一个标签')
      expect(notes[0].tags).not.toContain('这不是标签')
      expect(notes[0].tags).not.toContain('也不是标签')
    })

    it('应该处理 front matter 和内联标签的合并', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'merged-tags.md'),
        `---
tags: [fm-tag1, fm-tag2]
---

# 笔记

这里有 #inlineTag 和 #嵌套/标签 。`
      )

      const notes = await importer.parse({
        sourcePath: tempDir,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: true,
      })

      expect(notes.length).toBe(1)
      expect(notes[0].tags).toContain('fm-tag1')
      expect(notes[0].tags).toContain('fm-tag2')
      expect(notes[0].tags).toContain('inlineTag')
      expect(notes[0].tags).toContain('嵌套/标签')
    })

    it('应该支持 kebab-case 连字符标签', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'hyphen-tags.md'),
        `# 连字符标签测试

这里有 #my-tag 和 #another-long-tag 以及 #mixed_case-tag 。`
      )

      const notes = await importer.parse({
        sourcePath: tempDir,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: false,
      })

      expect(notes.length).toBe(1)
      expect(notes[0].tags).toContain('my-tag')
      expect(notes[0].tags).toContain('another-long-tag')
      expect(notes[0].tags).toContain('mixed_case-tag')
    })
  })
})
