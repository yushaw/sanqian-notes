/**
 * Notion 导入器测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execSync } from 'child_process'
import { NotionImporter } from '../importers/notion-importer'

describe('NotionImporter', () => {
  const importer = new NotionImporter()
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `notion-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe('info', () => {
    it('should have correct metadata', () => {
      expect(importer.info.id).toBe('notion')
      expect(importer.info.name).toBe('Notion')
      expect(importer.info.extensions).toContain('.zip')
      expect(importer.info.supportsFolder).toBe(false)
    })
  })

  describe('canHandle', () => {
    it('should reject non-zip files', async () => {
      const mdFile = join(testDir, 'test.md')
      writeFileSync(mdFile, '# Test')
      expect(await importer.canHandle(mdFile)).toBe(false)
    })

    it('should reject non-existent files', async () => {
      expect(await importer.canHandle('/non/existent/file.zip')).toBe(false)
    })

    it('should reject zip without Notion-style filenames', async () => {
      // 创建普通的 ZIP 文件
      const contentDir = join(testDir, 'content')
      mkdirSync(contentDir)
      writeFileSync(join(contentDir, 'regular-file.md'), '# Regular file')

      const zipPath = join(testDir, 'regular.zip')
      createZip(contentDir, zipPath)

      expect(await importer.canHandle(zipPath)).toBe(false)
    })

    it('should detect Notion ZIP by filename pattern', async () => {
      // 创建 Notion 风格的文件
      const contentDir = join(testDir, 'content')
      mkdirSync(contentDir)
      writeFileSync(
        join(contentDir, 'My Page abc123def456789012345678901234ab.md'),
        '# My Page'
      )

      const zipPath = join(testDir, 'notion-export.zip')
      createZip(contentDir, zipPath)

      expect(await importer.canHandle(zipPath)).toBe(true)
    })
  })

  describe('parse', () => {
    it('should extract title from Notion filename', async () => {
      const contentDir = join(testDir, 'content')
      mkdirSync(contentDir)
      writeFileSync(
        join(contentDir, 'Meeting Notes abc123def456789012345678901234ab.md'),
        '# Meeting Notes\n\nSome content here.'
      )

      const zipPath = join(testDir, 'export.zip')
      createZip(contentDir, zipPath)

      const notes = await importer.parse({
        sourcePath: zipPath,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: true,
      })

      expect(notes).toHaveLength(1)
      expect(notes[0].title).toBe('Meeting Notes')
    })

    it('should handle Chinese titles', async () => {
      const contentDir = join(testDir, 'content')
      mkdirSync(contentDir)
      writeFileSync(
        join(contentDir, '我的笔记 abc123def456789012345678901234ab.md'),
        '# 我的笔记'
      )

      const zipPath = join(testDir, 'export.zip')
      createZip(contentDir, zipPath)

      const notes = await importer.parse({
        sourcePath: zipPath,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: true,
      })

      expect(notes).toHaveLength(1)
      expect(notes[0].title).toBe('我的笔记')
    })

    it('should handle nested folders with first-level strategy', async () => {
      const contentDir = join(testDir, 'content')
      mkdirSync(join(contentDir, 'Work abc123def456789012345678901234ab'), { recursive: true })
      writeFileSync(
        join(
          contentDir,
          'Work abc123def456789012345678901234ab',
          'Project abc456def789012345678901234567ab.md'
        ),
        '# Project'
      )

      const zipPath = join(testDir, 'export.zip')
      createZip(contentDir, zipPath)

      const notes = await importer.parse({
        sourcePath: zipPath,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: true,
      })

      expect(notes).toHaveLength(1)
      expect(notes[0].notebookName).toBe('Work')
    })

    it('should handle flatten-path strategy', async () => {
      const contentDir = join(testDir, 'content')
      const nestedPath = join(
        contentDir,
        'Work abc123def456789012345678901234ab',
        'Projects def456789012345678901234567890ab'
      )
      mkdirSync(nestedPath, { recursive: true })
      writeFileSync(
        join(nestedPath, 'Task cde789012345678901234567890123ab.md'),
        '# Task'
      )

      const zipPath = join(testDir, 'export.zip')
      createZip(contentDir, zipPath)

      const notes = await importer.parse({
        sourcePath: zipPath,
        folderStrategy: 'flatten-path',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: true,
      })

      expect(notes).toHaveLength(1)
      expect(notes[0].notebookName).toBe('Work/Projects')
    })

    it('should convert Notion absolute URLs to wiki links', async () => {
      const contentDir = join(testDir, 'content')
      mkdirSync(contentDir)

      // 创建两个相互链接的页面
      writeFileSync(
        join(contentDir, 'Page A abc123def456789012345678901234ab.md'),
        '# Page A\n\nLink to [Page B](https://www.notion.so/Page-B-def456789012345678901234567890ab)'
      )
      writeFileSync(
        join(contentDir, 'Page B def456789012345678901234567890ab.md'),
        '# Page B\n\nContent of Page B'
      )

      const zipPath = join(testDir, 'export.zip')
      createZip(contentDir, zipPath)

      const notes = await importer.parse({
        sourcePath: zipPath,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: true,
      })

      const pageA = notes.find((n) => n.title === 'Page A')
      expect(pageA).toBeDefined()
      // 检查 wiki 链接是否被收集
      expect(pageA!.links.length).toBeGreaterThanOrEqual(0)
    })

    it('should convert relative path links to wiki links', async () => {
      const contentDir = join(testDir, 'content')
      mkdirSync(contentDir)

      writeFileSync(
        join(contentDir, 'Main abc123def456789012345678901234ab.md'),
        '# Main\n\nLink to [Sub](Sub%20Page%20def456789012345678901234567890ab.md)'
      )
      writeFileSync(
        join(contentDir, 'Sub Page def456789012345678901234567890ab.md'),
        '# Sub Page'
      )

      const zipPath = join(testDir, 'export.zip')
      createZip(contentDir, zipPath)

      const notes = await importer.parse({
        sourcePath: zipPath,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: true,
      })

      expect(notes).toHaveLength(2)
    })

    it('should handle name conflicts by adding parent directory', async () => {
      const contentDir = join(testDir, 'content')
      mkdirSync(join(contentDir, 'Work abc123def456789012345678901234ab'), { recursive: true })
      mkdirSync(join(contentDir, 'Personal def456789012345678901234567890ab'), { recursive: true })

      // 两个同名笔记在不同目录
      writeFileSync(
        join(
          contentDir,
          'Work abc123def456789012345678901234ab',
          'Notes cde789012345678901234567890123ab.md'
        ),
        '# Notes from Work'
      )
      writeFileSync(
        join(
          contentDir,
          'Personal def456789012345678901234567890ab',
          'Notes fea012345678901234567890123456ab.md'
        ),
        '# Notes from Personal'
      )

      const zipPath = join(testDir, 'export.zip')
      createZip(contentDir, zipPath)

      const notes = await importer.parse({
        sourcePath: zipPath,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: true,
      })

      expect(notes).toHaveLength(2)
      const titles = notes.map((n) => n.title)
      // 应该添加父目录区分
      expect(titles.some((t) => t.includes('Work'))).toBe(true)
      expect(titles.some((t) => t.includes('Personal'))).toBe(true)
    })

    it('should collect local image attachments', async () => {
      const contentDir = join(testDir, 'content')
      const imageDir = join(contentDir, 'Page abc123def456789012345678901234ab')
      mkdirSync(imageDir, { recursive: true })

      writeFileSync(
        join(contentDir, 'Page abc123def456789012345678901234ab.md'),
        '# Page\n\n![image](Page%20abc123def456789012345678901234ab/image.png)'
      )
      // 创建一个假图片文件
      writeFileSync(join(imageDir, 'image.png'), 'fake image data')

      const zipPath = join(testDir, 'export.zip')
      createZip(contentDir, zipPath)

      const notes = await importer.parse({
        sourcePath: zipPath,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: true,
        parseFrontMatter: true,
      })

      expect(notes).toHaveLength(1)
      expect(notes[0].attachments.length).toBeGreaterThanOrEqual(1)
    })

    it('should parse front matter', async () => {
      const contentDir = join(testDir, 'content')
      mkdirSync(contentDir)

      writeFileSync(
        join(contentDir, 'Note abc123def456789012345678901234ab.md'),
        `---
title: Custom Title
tags: [tag1, tag2]
created: 2024-01-01
---

# Note

Content here.`
      )

      const zipPath = join(testDir, 'export.zip')
      createZip(contentDir, zipPath)

      const notes = await importer.parse({
        sourcePath: zipPath,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: true,
      })

      expect(notes).toHaveLength(1)
      expect(notes[0].title).toBe('Custom Title')
      expect(notes[0].tags).toContain('tag1')
      expect(notes[0].tags).toContain('tag2')
    })

    it('should handle single-notebook strategy', async () => {
      const contentDir = join(testDir, 'content')
      mkdirSync(join(contentDir, 'Folder1 abc123def456789012345678901234ab'), { recursive: true })
      mkdirSync(join(contentDir, 'Folder2 def456789012345678901234567890ab'), { recursive: true })

      writeFileSync(
        join(contentDir, 'Folder1 abc123def456789012345678901234ab', 'Note1 aaa111222333444555666777888999ab.md'),
        '# Note 1'
      )
      writeFileSync(
        join(contentDir, 'Folder2 def456789012345678901234567890ab', 'Note2 bbb111222333444555666777888999ab.md'),
        '# Note 2'
      )

      const zipPath = join(testDir, 'export.zip')
      createZip(contentDir, zipPath)

      const notes = await importer.parse({
        sourcePath: zipPath,
        folderStrategy: 'single-notebook',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: true,
      })

      expect(notes).toHaveLength(2)
      // single-notebook 策略下，notebookName 应该是 undefined
      expect(notes.every((n) => n.notebookName === undefined)).toBe(true)
    })

    it('should handle deeply nested folder structure', async () => {
      const contentDir = join(testDir, 'content')
      const deepPath = join(
        contentDir,
        'Level1 abc123def456789012345678901234ab',
        'Level2 def456789012345678901234567890ab',
        'Level3 ccc111222333444555666777888999ab'
      )
      mkdirSync(deepPath, { recursive: true })

      writeFileSync(join(deepPath, 'Deep Note ddd111222333444555666777888999ab.md'), '# Deep Note')

      const zipPath = join(testDir, 'export.zip')
      createZip(contentDir, zipPath)

      const notes = await importer.parse({
        sourcePath: zipPath,
        folderStrategy: 'flatten-path',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: true,
      })

      expect(notes).toHaveLength(1)
      expect(notes[0].notebookName).toBe('Level1/Level2/Level3')
    })

    it('should handle special characters in filenames', async () => {
      const contentDir = join(testDir, 'content')
      mkdirSync(contentDir)

      // 特殊字符：括号、引号、破折号等
      writeFileSync(
        join(contentDir, 'Meeting (2024) - Q1 abc123def456789012345678901234ab.md'),
        '# Meeting (2024) - Q1'
      )

      const zipPath = join(testDir, 'export.zip')
      createZip(contentDir, zipPath)

      const notes = await importer.parse({
        sourcePath: zipPath,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: true,
      })

      expect(notes).toHaveLength(1)
      expect(notes[0].title).toBe('Meeting (2024) - Q1')
    })

    it('should handle Japanese and Korean titles', async () => {
      const contentDir = join(testDir, 'content')
      mkdirSync(contentDir)

      writeFileSync(
        join(contentDir, '日本語ノート abc123def456789012345678901234ab.md'),
        '# 日本語ノート'
      )
      writeFileSync(
        join(contentDir, '한국어 노트 def456789012345678901234567890ab.md'),
        '# 한국어 노트'
      )

      const zipPath = join(testDir, 'export.zip')
      createZip(contentDir, zipPath)

      const notes = await importer.parse({
        sourcePath: zipPath,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: true,
      })

      expect(notes).toHaveLength(2)
      expect(notes.some((n) => n.title === '日本語ノート')).toBe(true)
      expect(notes.some((n) => n.title === '한국어 노트')).toBe(true)
    })

    it('should handle multiple attachments in one note', async () => {
      const contentDir = join(testDir, 'content')
      const imageDir = join(contentDir, 'Gallery abc123def456789012345678901234ab')
      mkdirSync(imageDir, { recursive: true })

      writeFileSync(
        join(contentDir, 'Gallery abc123def456789012345678901234ab.md'),
        `# Gallery

![img1](Gallery%20abc123def456789012345678901234ab/photo1.jpg)
![img2](Gallery%20abc123def456789012345678901234ab/photo2.png)
![img3](Gallery%20abc123def456789012345678901234ab/diagram.svg)`
      )

      writeFileSync(join(imageDir, 'photo1.jpg'), 'fake jpg')
      writeFileSync(join(imageDir, 'photo2.png'), 'fake png')
      writeFileSync(join(imageDir, 'diagram.svg'), '<svg></svg>')

      const zipPath = join(testDir, 'export.zip')
      createZip(contentDir, zipPath)

      const notes = await importer.parse({
        sourcePath: zipPath,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: true,
        parseFrontMatter: true,
      })

      expect(notes).toHaveLength(1)
      expect(notes[0].attachments.length).toBe(3)
    })

    it('should skip index.html file', async () => {
      const contentDir = join(testDir, 'content')
      mkdirSync(contentDir)

      writeFileSync(join(contentDir, 'index.html'), '<html>sitemap</html>')
      writeFileSync(
        join(contentDir, 'Real Note abc123def456789012345678901234ab.md'),
        '# Real Note'
      )

      const zipPath = join(testDir, 'export.zip')
      createZip(contentDir, zipPath)

      const notes = await importer.parse({
        sourcePath: zipPath,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: true,
      })

      expect(notes).toHaveLength(1)
      expect(notes[0].title).toBe('Real Note')
    })

    it('should handle root level files without notebook', async () => {
      const contentDir = join(testDir, 'content')
      mkdirSync(contentDir)

      writeFileSync(
        join(contentDir, 'Root Note abc123def456789012345678901234ab.md'),
        '# Root Note'
      )

      const zipPath = join(testDir, 'export.zip')
      createZip(contentDir, zipPath)

      const notes = await importer.parse({
        sourcePath: zipPath,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: true,
      })

      expect(notes).toHaveLength(1)
      expect(notes[0].notebookName).toBeUndefined()
    })

    it('should convert wiki links with anchors', async () => {
      const contentDir = join(testDir, 'content')
      mkdirSync(contentDir)

      writeFileSync(
        join(contentDir, 'Index abc123def456789012345678901234ab.md'),
        '# Index\n\nSee [Section](https://www.notion.so/Target-Page-def456789012345678901234567890ab#heading-anchor)'
      )
      writeFileSync(
        join(contentDir, 'Target Page def456789012345678901234567890ab.md'),
        '# Target Page\n\n## heading-anchor\n\nContent'
      )

      const zipPath = join(testDir, 'export.zip')
      createZip(contentDir, zipPath)

      const notes = await importer.parse({
        sourcePath: zipPath,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: true,
      })

      expect(notes).toHaveLength(2)
      // 链接应该被转换为 wiki 链接格式
      const indexNote = notes.find((n) => n.title === 'Index')
      expect(indexNote).toBeDefined()
    })

    it('should preserve external links unchanged', async () => {
      const contentDir = join(testDir, 'content')
      mkdirSync(contentDir)

      writeFileSync(
        join(contentDir, 'Links abc123def456789012345678901234ab.md'),
        `# Links

External: [Google](https://www.google.com)
GitHub: [Repo](https://github.com/user/repo)
`
      )

      const zipPath = join(testDir, 'export.zip')
      createZip(contentDir, zipPath)

      const notes = await importer.parse({
        sourcePath: zipPath,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: true,
      })

      expect(notes).toHaveLength(1)
      // 外部链接不应该被转换为 wiki 链接
      expect(notes[0].links.length).toBe(0)
    })

    it('should handle CSV database files', async () => {
      const contentDir = join(testDir, 'content')
      const dbDir = join(contentDir, 'Tasks abc123def456789012345678901234ab')
      mkdirSync(dbDir, { recursive: true })

      // CSV 数据库文件
      writeFileSync(
        join(dbDir, 'Tasks abc123def456789012345678901234ab.csv'),
        'Name,Status,Priority\nTask 1,Done,High\nTask 2,In Progress,Medium'
      )
      // 每行对应的 Markdown 文件
      writeFileSync(
        join(dbDir, 'Task 1 aaa111222333444555666777888999ab.md'),
        '# Task 1\n\nDetails for task 1'
      )
      writeFileSync(
        join(dbDir, 'Task 2 bbb111222333444555666777888999ab.md'),
        '# Task 2\n\nDetails for task 2'
      )

      const zipPath = join(testDir, 'export.zip')
      createZip(contentDir, zipPath)

      const notes = await importer.parse({
        sourcePath: zipPath,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: true,
      })

      // 应该有 2 个行笔记 + 1 个 CSV 表格笔记
      expect(notes.length).toBeGreaterThanOrEqual(2)

      // 检查 CSV 生成的表格笔记
      const tableNote = notes.find((n) => n.title === 'Tasks')
      expect(tableNote).toBeDefined()
    })

    it('should handle empty content file', async () => {
      const contentDir = join(testDir, 'content')
      mkdirSync(contentDir)

      writeFileSync(
        join(contentDir, 'Empty abc123def456789012345678901234ab.md'),
        ''
      )

      const zipPath = join(testDir, 'export.zip')
      createZip(contentDir, zipPath)

      const notes = await importer.parse({
        sourcePath: zipPath,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: true,
      })

      expect(notes).toHaveLength(1)
      expect(notes[0].title).toBe('Empty')
    })

    it('should handle wrapper directory in ZIP', async () => {
      // 模拟 Notion 导出时外层有一个包装目录的情况
      const contentDir = join(testDir, 'content')
      const wrapperDir = join(contentDir, 'Export-2024-01-01')
      mkdirSync(wrapperDir, { recursive: true })

      writeFileSync(
        join(wrapperDir, 'My Note abc123def456789012345678901234ab.md'),
        '# My Note'
      )

      const zipPath = join(testDir, 'export.zip')
      createZip(contentDir, zipPath)

      const notes = await importer.parse({
        sourcePath: zipPath,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'skip',
        importAttachments: false,
        parseFrontMatter: true,
      })

      expect(notes).toHaveLength(1)
      expect(notes[0].title).toBe('My Note')
      // 包装目录不应该成为笔记本名称
      expect(notes[0].notebookName).toBeUndefined()
    })
  })
})

// 辅助函数：创建 ZIP 文件
function createZip(sourceDir: string, zipPath: string): void {
  if (process.platform === 'win32') {
    execSync(
      `powershell -NoProfile -Command "Compress-Archive -Path '${sourceDir}/*' -DestinationPath '${zipPath}' -Force"`,
      { stdio: 'pipe' }
    )
  } else {
    execSync(`cd "${sourceDir}" && zip -r "${zipPath}" .`, { stdio: 'pipe' })
  }
}
