import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import type { LocalFolderNotebookMount, NotebookStatus } from '../../shared/types'
import { scanLocalFolderMount } from '../local-folder'
import { resolveMountStatusFromFsError } from '../local-folder-watch'

const tempDirs: string[] = []

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sanqian-local-recovery-'))
  tempDirs.push(dir)
  return dir
}

function createMount(
  rootPath: string,
  options?: { notebookId?: string; notebookName?: string; status?: NotebookStatus }
): LocalFolderNotebookMount {
  const now = new Date().toISOString()
  const notebookId = options?.notebookId || 'nb-recovery'
  return {
    notebook: {
      id: notebookId,
      name: options?.notebookName || 'Recovery Vault',
      icon: 'logo:notes',
      source_type: 'local-folder',
      order_index: 0,
      created_at: now,
    },
    mount: {
      notebook_id: notebookId,
      root_path: rootPath,
      canonical_root_path: resolve(rootPath),
      status: options?.status || 'active',
      created_at: now,
      updated_at: now,
    },
  }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (!dir) continue
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('local-folder recovery e2e-ish', () => {
  it('handles missing root and relink recovery end-to-end', () => {
    const runtimeRoot = createTempDir()
    const rootA = join(runtimeRoot, 'vault-a')
    mkdirSync(rootA, { recursive: true })
    writeFileSync(join(rootA, 'a.md'), '# A\n', 'utf-8')

    const mount = createMount(rootA, { notebookId: 'nb-relink' })
    expect(scanLocalFolderMount(mount).files.map((file) => file.relative_path)).toEqual(['a.md'])

    rmSync(rootA, { recursive: true, force: true })

    let failure: unknown = null
    try {
      scanLocalFolderMount(mount)
    } catch (error) {
      failure = error
    }

    expect(failure).not.toBeNull()
    const missingStatus = resolveMountStatusFromFsError(failure)
    expect(missingStatus).toBe('missing')

    const rootB = join(runtimeRoot, 'vault-b')
    mkdirSync(rootB, { recursive: true })
    writeFileSync(join(rootB, 'b.md'), '# B\n', 'utf-8')

    const relinkedMount = createMount(rootB, {
      notebookId: mount.notebook.id,
      notebookName: mount.notebook.name,
      status: 'active',
    })
    expect(scanLocalFolderMount(relinkedMount).files.map((file) => file.relative_path)).toEqual(['b.md'])
  })

  it('handles permission fluctuation and recovery with real filesystem state', () => {
    if (process.platform === 'win32') {
      return
    }

    const runtimeRoot = createTempDir()
    const root = join(runtimeRoot, 'vault-permission')
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'locked.md'), '# locked\n', 'utf-8')

    const mount = createMount(root, { notebookId: 'nb-perm' })

    const originalMode = statSync(root).mode & 0o777
    let failure: unknown = null
    try {
      chmodSync(root, 0o000)
      try {
        scanLocalFolderMount(mount)
      } catch (error) {
        failure = error
      }
    } finally {
      chmodSync(root, originalMode)
    }

    expect(failure).not.toBeNull()
    const permissionStatus = resolveMountStatusFromFsError(failure)
    expect(permissionStatus).toBe('permission_required')

    const recovered = scanLocalFolderMount(createMount(root, {
      notebookId: mount.notebook.id,
      notebookName: mount.notebook.name,
      status: 'active',
    }))
    expect(recovered.files.map((file) => file.relative_path)).toEqual(['locked.md'])
  })
})
