/**
 * ZIP 处理工具测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execSync } from 'child_process'
import {
  listZipEntries,
  detectNotionZip,
  extractZip,
  cleanupTempDir,
} from '../utils/zip-handler'

describe('ZIP Handler', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `zip-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe('listZipEntries', () => {
    it('should list files in a ZIP', async () => {
      const contentDir = join(testDir, 'content')
      mkdirSync(contentDir)
      writeFileSync(join(contentDir, 'file1.txt'), 'content 1')
      writeFileSync(join(contentDir, 'file2.md'), '# Title')

      const zipPath = join(testDir, 'test.zip')
      createZip(contentDir, zipPath)

      const entries = await listZipEntries(zipPath)

      expect(entries.length).toBeGreaterThanOrEqual(2)
      const names = entries.map((e) => e.name)
      expect(names.some((n) => n.includes('file1.txt'))).toBe(true)
      expect(names.some((n) => n.includes('file2.md'))).toBe(true)
    })

    it('should throw for non-existent file', async () => {
      await expect(listZipEntries('/non/existent.zip')).rejects.toThrow()
    })
  })

  describe('detectNotionZip', () => {
    it('should detect Notion-style filenames', async () => {
      const contentDir = join(testDir, 'content')
      mkdirSync(contentDir)
      writeFileSync(
        join(contentDir, 'My Page abc123def456789012345678901234ab.md'),
        '# My Page'
      )

      const zipPath = join(testDir, 'notion.zip')
      createZip(contentDir, zipPath)

      const result = await detectNotionZip(zipPath)
      expect(result).toBe(true)
    })

    it('should return false for regular ZIP', async () => {
      const contentDir = join(testDir, 'content')
      mkdirSync(contentDir)
      writeFileSync(join(contentDir, 'regular-file.md'), '# Regular')

      const zipPath = join(testDir, 'regular.zip')
      createZip(contentDir, zipPath)

      const result = await detectNotionZip(zipPath)
      expect(result).toBe(false)
    })

    it('should detect CSV files with Notion IDs', async () => {
      const contentDir = join(testDir, 'content')
      mkdirSync(contentDir)
      writeFileSync(
        join(contentDir, 'Database abc123def456789012345678901234ab.csv'),
        'Name,Status\nItem1,Done'
      )

      const zipPath = join(testDir, 'notion.zip')
      createZip(contentDir, zipPath)

      const result = await detectNotionZip(zipPath)
      expect(result).toBe(true)
    })

    it('should return false for non-existent file', async () => {
      const result = await detectNotionZip('/non/existent.zip')
      expect(result).toBe(false)
    })
  })

  describe('extractZip', () => {
    it('should extract ZIP to temp directory', async () => {
      const contentDir = join(testDir, 'content')
      mkdirSync(contentDir)
      writeFileSync(join(contentDir, 'test.txt'), 'test content')

      const zipPath = join(testDir, 'extract.zip')
      createZip(contentDir, zipPath)

      const extractedDir = await extractZip(zipPath)

      try {
        expect(existsSync(extractedDir)).toBe(true)
        // 检查文件是否被解压
        const files = require('fs').readdirSync(extractedDir, { recursive: true })
        expect(files.some((f: string) => f.includes('test.txt'))).toBe(true)
      } finally {
        cleanupTempDir(extractedDir)
      }
    })

    it('should throw for non-existent ZIP', async () => {
      await expect(extractZip('/non/existent.zip')).rejects.toThrow()
    })
  })

  describe('cleanupTempDir', () => {
    it('should remove directory', () => {
      const tempDir = join(testDir, 'to-cleanup')
      mkdirSync(tempDir)
      writeFileSync(join(tempDir, 'file.txt'), 'content')

      cleanupTempDir(tempDir)

      expect(existsSync(tempDir)).toBe(false)
    })

    it('should handle non-existent directory', () => {
      // Should not throw
      expect(() => cleanupTempDir('/non/existent/dir')).not.toThrow()
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
