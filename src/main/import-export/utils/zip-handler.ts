/**
 * ZIP 文件处理工具
 * - 列出 ZIP 条目（不解压）
 * - 解压到临时目录
 * - 清理临时目录
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdtemp, readdir, rm, stat, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { pathExists } from './fs-helpers'

const execFileAsync = promisify(execFile)

/** ZIP 解压后的最大总大小限制 (500MB) */
const MAX_EXTRACTED_SIZE = 500 * 1024 * 1024

/** ZIP 条目信息 */
export interface ZipEntry {
  name: string
  size: number
  isDirectory: boolean
}

/**
 * 列出 ZIP 文件中的条目（不解压）
 * 用于快速检测 ZIP 内容格式
 */
export async function listZipEntries(zipPath: string): Promise<ZipEntry[]> {
  if (!(await pathExists(zipPath))) {
    throw new Error(`ZIP file not found: ${zipPath}`)
  }

  const entries: ZipEntry[] = []

  if (process.platform === 'win32') {
    // Windows: 使用 PowerShell
    const { stdout } = await execFileAsync('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `
        $archive = [System.IO.Compression.ZipFile]::OpenRead($args[0])
        try {
          $archive.Entries | ForEach-Object {
            "$($_.Length)|$($_.FullName)"
          }
        } finally {
          $archive.Dispose()
        }
      `,
      zipPath,
    ], { maxBuffer: 10 * 1024 * 1024 })

    for (const line of stdout.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const [sizeStr, ...nameParts] = trimmed.split('|')
      const name = nameParts.join('|')
      const size = parseInt(sizeStr, 10) || 0
      entries.push({
        name,
        size,
        isDirectory: name.endsWith('/') || name.endsWith('\\'),
      })
    }
  } else {
    // macOS/Linux: 使用 unzip -l
    const { stdout } = await execFileAsync('unzip', ['-l', zipPath], {
      maxBuffer: 10 * 1024 * 1024,
    })

    // 解析 unzip -l 输出格式:
    //   Length      Date    Time    Name
    // ---------  ---------- -----   ----
    //      1234  01-05-2026 12:00   path/to/file.md
    // 日期格式可能是 YYYY-MM-DD 或 MM-DD-YYYY
    const lines = stdout.split('\n')
    for (const line of lines) {
      // 跳过头部和尾部，匹配两种日期格式
      const match = line.match(/^\s*(\d+)\s+\d{2,4}[-/]\d{2}[-/]\d{2,4}\s+\d{2}:\d{2}\s+(.+)$/)
      if (match) {
        const size = parseInt(match[1], 10)
        const name = match[2]
        entries.push({
          name,
          size,
          isDirectory: name.endsWith('/'),
        })
      }
    }
  }

  return entries
}

/**
 * 检测 ZIP 文件是否包含 Notion 风格的文件名（32位 hex ID）
 * 也处理嵌套 ZIP（Notion 对大文件的分卷导出）
 */
export async function detectNotionZip(zipPath: string): Promise<boolean> {
  try {
    const entries = await listZipEntries(zipPath)

    // 检测是否有 Notion 风格文件名：标题 + 空格 + 32位 hex ID
    const notionPattern = /\s[0-9a-f]{32}\.(md|csv)$/i
    if (entries.some((entry) => notionPattern.test(entry.name))) {
      return true
    }

    // 检测嵌套 ZIP（Notion 分卷导出格式）
    // 例如: ExportBlock-xxx-Part-1.zip
    const nestedZipPattern = /^[^/]+Part-\d+\.zip$/i
    const nestedZip = entries.find((entry) => nestedZipPattern.test(entry.name))
    if (nestedZip) {
      // 需要解压检查内层 ZIP
      return true
    }

    return false
  } catch {
    return false
  }
}

/**
 * 解压 ZIP 文件到临时目录
 * 支持 Notion 的嵌套 ZIP 格式（分卷导出）
 * @returns 临时目录路径
 */
export async function extractZip(zipPath: string): Promise<string> {

  if (!(await pathExists(zipPath))) {
    throw new Error(`ZIP file not found: ${zipPath}`)
  }

  // 检查 ZIP 文件大小（简单估计，实际解压后可能更大）
  const zipStat = await stat(zipPath)
  if (zipStat.size > MAX_EXTRACTED_SIZE) {
    throw new Error(
      `ZIP file too large: ${Math.round(zipStat.size / 1024 / 1024)}MB (limit: ${MAX_EXTRACTED_SIZE / 1024 / 1024}MB)`
    )
  }

  // 先检查解压后总大小
  const entries = await listZipEntries(zipPath)
  const totalSize = entries.reduce((sum, e) => sum + e.size, 0)
  if (totalSize > MAX_EXTRACTED_SIZE) {
    throw new Error(
      `Extracted size too large: ${Math.round(totalSize / 1024 / 1024)}MB (limit: ${MAX_EXTRACTED_SIZE / 1024 / 1024}MB)`
    )
  }

  // 创建临时目录
  const tempDir = await mkdtemp(join(tmpdir(), 'notion-import-'))

  try {
    await extractZipToDir(zipPath, tempDir)

    // 安全检查：验证所有解压的文件都在临时目录内
    await validateExtractedPaths(tempDir)

    // 检查是否是嵌套 ZIP（Notion 分卷导出）
    const extractedFiles = await readdir(tempDir)
    const nestedZipPattern = /Part-\d+\.zip$/i
    const nestedZips = extractedFiles.filter((f) => nestedZipPattern.test(f))

    if (nestedZips.length > 0) {
      // 解压所有嵌套的 ZIP 文件
      for (const nestedZip of nestedZips) {
        const nestedZipPath = join(tempDir, nestedZip)
        await extractZipToDir(nestedZipPath, tempDir)
        // 删除已解压的嵌套 ZIP
        await unlink(nestedZipPath)
      }
      // 再次验证路径安全
      await validateExtractedPaths(tempDir)
    }

    return tempDir
  } catch (error) {
    // 解压失败，清理临时目录
    await cleanupTempDir(tempDir)
    throw error
  }
}

/**
 * 解压 ZIP 到指定目录（内部函数）
 */
async function extractZipToDir(zipPath: string, destDir: string): Promise<void> {
  if (process.platform === 'win32') {
    // Windows: PowerShell Expand-Archive
    await execFileAsync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '& { Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force }',
        zipPath,
        destDir,
      ],
      { maxBuffer: 10 * 1024 * 1024, timeout: 300000 } // 5 分钟超时
    )
  } else {
    // macOS/Linux: 使用 ditto 替代 unzip（更好的编码支持）
    // ditto 是 macOS 自带工具，能正确处理中文文件名
    if (process.platform === 'darwin') {
      await execFileAsync('ditto', ['-xk', zipPath, destDir], {
        maxBuffer: 10 * 1024 * 1024,
        timeout: 300000,
      })
    } else {
      // Linux: unzip
      await execFileAsync('unzip', ['-q', '-o', zipPath, '-d', destDir], {
        maxBuffer: 10 * 1024 * 1024,
        timeout: 300000,
      })
    }
  }
}

/**
 * 验证解压的文件路径安全（防止 ZIP 路径遍历攻击）
 */
async function validateExtractedPaths(tempDir: string): Promise<void> {
  const realTempDir = resolve(tempDir)

  async function checkDir(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      const realPath = resolve(fullPath)

      // 检查路径是否在临时目录内
      if (!realPath.startsWith(realTempDir)) {
        throw new Error(`Security error: Path traversal detected: ${entry.name}`)
      }

      if (entry.isDirectory()) {
        await checkDir(fullPath)
      }
    }
  }

  await checkDir(tempDir)
}

/**
 * 清理临时目录
 */
export async function cleanupTempDir(tempDir: string): Promise<void> {
  try {
    if (await pathExists(tempDir)) {
      await rm(tempDir, { recursive: true, force: true })
    }
  } catch (error) {
    console.error('Failed to cleanup temp dir:', tempDir, error)
  }
}
