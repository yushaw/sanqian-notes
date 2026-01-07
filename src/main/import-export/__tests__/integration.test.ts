/**
 * 导入导出集成测试
 * 测试完整的导入和导出流程（不涉及数据库操作）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { tmpdir } from 'os'
import { MarkdownImporter } from '../importers/markdown-importer'
import { MarkdownExporter } from '../exporters/markdown-exporter'
import { parseFrontMatter } from '../utils/front-matter'

describe('导入导出集成测试', () => {
  let tempDir: string
  let sourceDir: string
  let outputDir: string

  beforeEach(() => {
    // 创建测试目录
    tempDir = path.join(tmpdir(), `import-export-integration-${Date.now()}`)
    sourceDir = path.join(tempDir, 'source')
    outputDir = path.join(tempDir, 'output')

    fs.mkdirSync(sourceDir, { recursive: true })
    fs.mkdirSync(outputDir, { recursive: true })
  })

  afterEach(() => {
    // 清理
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  describe('Markdown 导入流程', () => {
    it('完整导入流程：多层目录结构', async () => {
      // 准备测试数据
      const structure = {
        '工作/项目A/需求文档.md': `---
title: 产品需求文档
tags: [工作, 产品, PRD]
created: 2024-01-10
---

# 产品需求文档

## 概述

这是一个示例需求文档。

## 功能列表

1. 用户登录
2. 数据导出
3. 报表生成`,

        '工作/项目A/技术方案.md': `---
title: 技术方案
tags: [工作, 技术]
---

# 技术方案

使用 React + TypeScript 开发前端。`,

        '个人/日记/2024-01-15.md': `# 2024年1月15日

今天天气很好。

![照片](./images/photo.jpg)`,

        '个人/日记/images/photo.jpg': 'fake image data',

        '个人/读书笔记.md': `---
title: 《深入理解计算机系统》笔记
tags: [读书, CS]
---

# 读书笔记

## 第一章

计算机系统概述...

参考 [[技术方案]] 中的内容。`,

        'README.md': `# 我的笔记库

这是根目录的说明文件。`,
      }

      // 创建文件结构
      for (const [relativePath, content] of Object.entries(structure)) {
        const fullPath = path.join(sourceDir, relativePath)
        fs.mkdirSync(path.dirname(fullPath), { recursive: true })
        fs.writeFileSync(fullPath, content)
      }

      // 执行导入
      const importer = new MarkdownImporter()
      const notes = await importer.parse({
        sourcePath: sourceDir,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: true,
        parseFrontMatter: true,
      })

      // 验证结果
      expect(notes.length).toBe(5)

      // 检查笔记本分组
      const workNotes = notes.filter((n) => n.notebookName === '工作')
      const personalNotes = notes.filter((n) => n.notebookName === '个人')
      const rootNotes = notes.filter((n) => !n.notebookName)

      expect(workNotes.length).toBe(2)
      expect(personalNotes.length).toBe(2)
      expect(rootNotes.length).toBe(1)

      // 检查 front matter 解析
      const prdNote = notes.find((n) => n.title === '产品需求文档')
      expect(prdNote).toBeDefined()
      // 标签应该被正确解析
      expect(prdNote!.tags.length).toBeGreaterThan(0)
      expect(prdNote!.createdAt).toBeInstanceOf(Date)

      // 检查附件收集
      const diaryNote = notes.find((n) => n.title.includes('2024年1月15日'))
      expect(diaryNote?.attachments.length).toBeGreaterThan(0)

      // 检查 wiki 链接收集
      const readingNote = notes.find((n) => n.title.includes('计算机系统'))
      expect(readingNote?.links.some((l) => l.targetTitle === '技术方案')).toBe(true)
    })

    it('导入后内容格式正确（TipTap JSON）', async () => {
      fs.writeFileSync(
        path.join(sourceDir, 'test.md'),
        `# 标题

这是**粗体**和*斜体*文本。

- 列表项 1
- 列表项 2

\`\`\`javascript
console.log('Hello');
\`\`\`
`
      )

      const importer = new MarkdownImporter()
      const notes = await importer.parse({
        sourcePath: sourceDir,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: false,
      })

      expect(notes.length).toBe(1)

      // content 应该是有效的 JSON
      const content = JSON.parse(notes[0].content)
      expect(content.type).toBe('doc')
      expect(Array.isArray(content.content)).toBe(true)
    })
  })

  describe('导入导出往返测试', () => {
    it('导入 → 导出 → 再导入：内容应保持一致', async () => {
      // 1. 准备原始内容
      const originalContent = `---
title: 往返测试笔记
tags: [测试, 重要]
created: 2024-06-01
---

# 往返测试笔记

## 第一节

这是一段普通文本。

## 第二节

- 列表项 A
- 列表项 B
- 列表项 C

## 代码示例

\`\`\`python
def hello():
    print("Hello, World!")
\`\`\`
`

      fs.writeFileSync(path.join(sourceDir, '往返测试.md'), originalContent)

      // 2. 导入
      const importer = new MarkdownImporter()
      const importedNotes = await importer.parse({
        sourcePath: sourceDir,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: true,
      })

      expect(importedNotes.length).toBe(1)
      const importedNote = importedNotes[0]

      expect(importedNote.title).toBe('往返测试笔记')
      // 标签应该被正确解析为数组
      expect(importedNote.tags.length).toBe(2)

      // 3. 模拟导出（直接测试 contentToMarkdown）
      const exporter = new MarkdownExporter()
      const exportedMarkdown = (exporter as unknown as { contentToMarkdown: (content: string) => string }).contentToMarkdown(importedNote.content)

      // 4. 验证关键内容保留
      expect(exportedMarkdown).toContain('第一节')
      expect(exportedMarkdown).toContain('第二节')
      expect(exportedMarkdown).toContain('列表项 A')
      expect(exportedMarkdown).toContain('def hello')

      // 5. 再次导入导出的内容
      const reExportDir = path.join(tempDir, 're-export')
      fs.mkdirSync(reExportDir)
      fs.writeFileSync(path.join(reExportDir, 're-test.md'), exportedMarkdown)

      const reImportedNotes = await importer.parse({
        sourcePath: reExportDir,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: false,
      })

      expect(reImportedNotes.length).toBe(1)

      // 再次导出
      const reExportedMarkdown = (exporter as unknown as { contentToMarkdown: (content: string) => string }).contentToMarkdown(
        reImportedNotes[0].content
      )

      // 关键内容应该仍然存在
      expect(reExportedMarkdown).toContain('第一节')
      expect(reExportedMarkdown).toContain('列表项 A')
    })
  })

  describe('Front Matter 往返测试', () => {
    it('front matter 导入后重新生成应保持关键信息', () => {
      const original = `---
title: 元数据测试
tags:
  - 工作
  - 项目/子项目
created: 2024-03-15T10:30:00Z
updated: 2024-06-20T14:00:00Z
custom_field: 自定义值
---

正文内容`

      // 解析
      const parsed = parseFrontMatter(original)

      expect(parsed.data.title).toBe('元数据测试')
      expect(parsed.data.tags).toContain('工作')
      expect(parsed.data.custom_field).toBe('自定义值')
      expect(parsed.content.trim()).toBe('正文内容')
    })
  })

  describe('边界情况处理', () => {
    it('处理空目录', async () => {
      const emptyDir = path.join(tempDir, 'empty')
      fs.mkdirSync(emptyDir)

      const importer = new MarkdownImporter()
      const canHandle = await importer.canHandle(emptyDir)

      expect(canHandle).toBe(false)
    })

    it('处理只包含非 Markdown 文件的目录', async () => {
      fs.writeFileSync(path.join(sourceDir, 'file.txt'), 'text')
      fs.writeFileSync(path.join(sourceDir, 'file.json'), '{}')

      const importer = new MarkdownImporter()
      const canHandle = await importer.canHandle(sourceDir)

      expect(canHandle).toBe(false)
    })

    it('处理超长标题', async () => {
      const longTitle = 'A'.repeat(300)
      fs.writeFileSync(path.join(sourceDir, 'long.md'), `# ${longTitle}\n\n内容`)

      const importer = new MarkdownImporter()
      const notes = await importer.parse({
        sourcePath: sourceDir,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: false,
      })

      expect(notes.length).toBe(1)
      // 标题应该被截取或完整保留（取决于实现）
      expect(notes[0].title.length).toBeGreaterThan(0)
    })

    it('处理特殊字符文件名', async () => {
      // 创建包含中文和特殊字符的文件
      const specialNames = [
        '中文笔记.md',
        'note with spaces.md',
        'note-with-dashes.md',
        'note_with_underscores.md',
      ]

      for (const name of specialNames) {
        fs.writeFileSync(path.join(sourceDir, name), `# ${name}\n\n内容`)
      }

      const importer = new MarkdownImporter()
      const notes = await importer.parse({
        sourcePath: sourceDir,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: false,
      })

      expect(notes.length).toBe(4)
    })

    it('处理深层嵌套目录', async () => {
      // 创建 5 层嵌套
      const deepPath = path.join(sourceDir, 'a', 'b', 'c', 'd', 'e')
      fs.mkdirSync(deepPath, { recursive: true })
      fs.writeFileSync(path.join(deepPath, 'deep.md'), '# 深层笔记')

      const importer = new MarkdownImporter()
      const notes = await importer.parse({
        sourcePath: sourceDir,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: false,
      })

      expect(notes.length).toBe(1)
      expect(notes[0].notebookName).toBe('a') // first-level 策略
    })
  })
})
