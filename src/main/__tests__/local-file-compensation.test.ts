import { describe, expect, it } from 'vitest'
import type { LocalFolderNotebookMount } from '../../shared/types'
import {
  rollbackLocalFile,
  trashLocalFile,
  type TrashLocalFileDeps,
} from '../local-file-compensation'

function createMount(rootPath: string): LocalFolderNotebookMount {
  const now = new Date().toISOString()
  return {
    notebook: {
      id: 'nb-test',
      name: 'Test Mount',
      icon: 'logo:notes',
      source_type: 'local-folder',
      order_index: 0,
      created_at: now,
    },
    mount: {
      notebook_id: 'nb-test',
      root_path: rootPath,
      canonical_root_path: rootPath,
      status: 'active',
      created_at: now,
      updated_at: now,
    },
  }
}

function buildDeps(overrides?: Partial<TrashLocalFileDeps>): TrashLocalFileDeps {
  return {
    resolveDeleteTarget: () => ({
      success: true,
      result: {
        absolute_path: '/tmp/a.md',
        relative_path: 'a.md',
        kind: 'file',
      },
    }),
    trashItem: async () => undefined,
    existsSync: () => true,
    ...overrides,
  }
}

describe('local-file-compensation', () => {
  it('returns trashed when delete target resolves and trash succeeds', async () => {
    const mount = createMount('/tmp/mount')
    const result = await trashLocalFile(
      mount,
      { notebookId: mount.notebook.id, relativePath: 'a.md' },
      undefined,
      buildDeps()
    )
    expect(result).toEqual({ ok: true, state: 'trashed' })
  })

  it('returns resolve_failed when target is missing and notFoundIsSuccess=false', async () => {
    const mount = createMount('/tmp/mount')
    const result = await trashLocalFile(
      mount,
      { notebookId: mount.notebook.id, relativePath: 'a.md' },
      undefined,
      buildDeps({
        resolveDeleteTarget: () => ({
          success: false,
          errorCode: 'LOCAL_FILE_NOT_FOUND',
        }),
      })
    )
    expect(result).toEqual({
      ok: false,
      reason: 'resolve_failed',
      errorCode: 'LOCAL_FILE_NOT_FOUND',
    })
  })

  it('treats not-found as success when notFoundIsSuccess=true', async () => {
    const mount = createMount('/tmp/mount')
    const result = await trashLocalFile(
      mount,
      { notebookId: mount.notebook.id, relativePath: 'a.md' },
      { notFoundIsSuccess: true },
      buildDeps({
        resolveDeleteTarget: () => ({
          success: false,
          errorCode: 'LOCAL_FILE_NOT_FOUND',
        }),
      })
    )
    expect(result).toEqual({ ok: true, state: 'already-missing' })
  })

  it('treats missing path after trash failure as already-trashed', async () => {
    const mount = createMount('/tmp/mount')
    const result = await trashLocalFile(
      mount,
      { notebookId: mount.notebook.id, relativePath: 'a.md' },
      undefined,
      buildDeps({
        trashItem: async () => {
          throw new Error('simulated trash failure')
        },
        existsSync: () => false,
      })
    )
    expect(result).toEqual({ ok: true, state: 'already-trashed' })
  })

  it('returns trash_failed when trash fails and path still exists', async () => {
    const mount = createMount('/tmp/mount')
    const result = await trashLocalFile(
      mount,
      { notebookId: mount.notebook.id, relativePath: 'a.md' },
      undefined,
      buildDeps({
        trashItem: async () => {
          throw new Error('simulated trash failure')
        },
        existsSync: () => true,
      })
    )
    expect(result).toEqual({
      ok: false,
      reason: 'trash_failed',
      absolutePath: '/tmp/a.md',
    })
  })

  it('rollbackLocalFile returns true when source is already missing', async () => {
    const mount = createMount('/tmp/mount')
    const ok = await rollbackLocalFile(
      mount,
      { notebookId: mount.notebook.id, relativePath: 'a.md' },
      buildDeps({
        resolveDeleteTarget: () => ({
          success: false,
          errorCode: 'LOCAL_FILE_NOT_FOUND',
        }),
      })
    )
    expect(ok).toBe(true)
  })

  it('rollbackLocalFile returns false on access-denied resolve failures', async () => {
    const mount = createMount('/tmp/mount')
    const ok = await rollbackLocalFile(
      mount,
      { notebookId: mount.notebook.id, relativePath: 'a.md' },
      buildDeps({
        resolveDeleteTarget: () => ({
          success: false,
          errorCode: 'LOCAL_FILE_UNREADABLE',
        }),
      })
    )
    expect(ok).toBe(false)
  })
})
