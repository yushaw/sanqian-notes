import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LocalFolderNotebookMount } from '../../shared/types'

function createMount(rootPath: string, notebookId: string = 'nb-test'): LocalFolderNotebookMount {
  const now = new Date().toISOString()
  return {
    notebook: {
      id: notebookId,
      name: 'Test Mount',
      icon: 'logo:notes',
      source_type: 'local-folder',
      order_index: 0,
      created_at: now,
    },
    mount: {
      notebook_id: notebookId,
      root_path: rootPath,
      canonical_root_path: rootPath,
      status: 'active',
      created_at: now,
      updated_at: now,
    },
  }
}

const tempDirs: string[] = []

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sanqian-local-folder-startup-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (!dir) continue
    rmSync(dir, { recursive: true, force: true })
  }

  delete process.env.LOCAL_PERF_STARTUP_WINDOW_MS
  delete process.env.LOCAL_LIST_PREVIEW_MAX_READS_PER_SCAN
  delete process.env.LOCAL_LIST_PREVIEW_COLD_SCAN_ADAPTIVE_ENABLED
  delete process.env.LOCAL_LIST_PREVIEW_COLD_SCAN_MAX_READS_PER_SCAN
  delete process.env.LOCAL_LIST_PREVIEW_STARTUP_ADAPTIVE_ENABLED
  delete process.env.LOCAL_LIST_PREVIEW_STARTUP_MAX_READS_PER_SCAN
  vi.resetModules()
})

describe('local-folder startup adaptive preview budget', () => {
  it('caps uncached preview reads with startup budget when base budget is unlimited', async () => {
    process.env.LOCAL_PERF_STARTUP_WINDOW_MS = '60000'
    process.env.LOCAL_LIST_PREVIEW_MAX_READS_PER_SCAN = '0'
    process.env.LOCAL_LIST_PREVIEW_STARTUP_ADAPTIVE_ENABLED = '1'
    process.env.LOCAL_LIST_PREVIEW_STARTUP_MAX_READS_PER_SCAN = '3'

    vi.resetModules()
    const { scanLocalFolderMount } = await import('../local-folder/scan')

    const root = createTempDir()
    const mount = createMount(root)
    for (let index = 0; index < 8; index += 1) {
      const fileName = `note-${String(index).padStart(2, '0')}.md`
      writeFileSync(join(root, fileName), `# title ${index}\n\npreview ${index}\n`, 'utf-8')
    }

    const scanned = scanLocalFolderMount(mount)
    expect(scanned.files).toHaveLength(8)

    const nonEmptyPreviewCount = scanned.files.reduce((count, file) => (
      (file.preview?.trim().length || 0) > 0 ? count + 1 : count
    ), 0)

    expect(nonEmptyPreviewCount).toBe(3)
  })

  it('applies cold-scan budget on first scan and relaxes on subsequent scans', async () => {
    process.env.LOCAL_PERF_STARTUP_WINDOW_MS = '0'
    process.env.LOCAL_LIST_PREVIEW_MAX_READS_PER_SCAN = '0'
    process.env.LOCAL_LIST_PREVIEW_COLD_SCAN_ADAPTIVE_ENABLED = '1'
    process.env.LOCAL_LIST_PREVIEW_COLD_SCAN_MAX_READS_PER_SCAN = '2'
    process.env.LOCAL_LIST_PREVIEW_STARTUP_ADAPTIVE_ENABLED = '0'

    vi.resetModules()
    const { scanLocalFolderMount } = await import('../local-folder/scan')

    const root = createTempDir()
    const mount = createMount(root)
    for (let index = 0; index < 8; index += 1) {
      const fileName = `cold-note-${String(index).padStart(2, '0')}.md`
      writeFileSync(join(root, fileName), `# cold ${index}\n\npreview ${index}\n`, 'utf-8')
    }

    const firstScan = scanLocalFolderMount(mount)
    const firstNonEmptyPreviewCount = firstScan.files.reduce((count, file) => (
      (file.preview?.trim().length || 0) > 0 ? count + 1 : count
    ), 0)
    expect(firstNonEmptyPreviewCount).toBe(2)

    const secondScan = scanLocalFolderMount(mount)
    const secondNonEmptyPreviewCount = secondScan.files.reduce((count, file) => (
      (file.preview?.trim().length || 0) > 0 ? count + 1 : count
    ), 0)
    expect(secondNonEmptyPreviewCount).toBe(8)
  })

  it('does not collide cold-scan keys when notebook id and root path both contain ":"', async () => {
    process.env.LOCAL_PERF_STARTUP_WINDOW_MS = '0'
    process.env.LOCAL_LIST_PREVIEW_MAX_READS_PER_SCAN = '0'
    process.env.LOCAL_LIST_PREVIEW_COLD_SCAN_ADAPTIVE_ENABLED = '1'
    process.env.LOCAL_LIST_PREVIEW_COLD_SCAN_MAX_READS_PER_SCAN = '1'
    process.env.LOCAL_LIST_PREVIEW_STARTUP_ADAPTIVE_ENABLED = '0'

    vi.resetModules()
    const { scanLocalFolderMount } = await import('../local-folder/scan')

    const base = createTempDir()
    const rootPathB = join(base, 'mount-b')
    const rootPathA = `${base}:alias${rootPathB}`
    mkdirSync(rootPathA, { recursive: true })
    mkdirSync(rootPathB, { recursive: true })

    const mountA = createMount(rootPathA, 'nb')
    const mountB = createMount(rootPathB, `nb:${base}:alias`)

    for (let index = 0; index < 3; index += 1) {
      const fileName = `collision-a-${String(index).padStart(2, '0')}.md`
      writeFileSync(join(rootPathA, fileName), `# collision a ${index}\n\npreview ${index}\n`, 'utf-8')
    }
    for (let index = 0; index < 3; index += 1) {
      const fileName = `collision-b-${String(index).padStart(2, '0')}.md`
      writeFileSync(join(rootPathB, fileName), `# collision b ${index}\n\npreview ${index}\n`, 'utf-8')
    }

    const firstScan = scanLocalFolderMount(mountA)
    const firstNonEmptyPreviewCount = firstScan.files.reduce((count, file) => (
      (file.preview?.trim().length || 0) > 0 ? count + 1 : count
    ), 0)
    expect(firstNonEmptyPreviewCount).toBe(1)

    const secondScan = scanLocalFolderMount(mountB)
    const secondNonEmptyPreviewCount = secondScan.files.reduce((count, file) => (
      (file.preview?.trim().length || 0) > 0 ? count + 1 : count
    ), 0)
    expect(secondNonEmptyPreviewCount).toBe(1)
  })
})
