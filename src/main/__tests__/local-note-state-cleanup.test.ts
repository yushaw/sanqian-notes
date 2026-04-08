import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'module'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { app } from 'electron'
import {
  addNotebook,
  closeDatabase,
  createLocalFolderNotebookMount,
  ensureLocalNoteIdentity,
  getLocalNoteIdentityByPath,
  getLocalNoteIdentityByUid,
  getLocalNoteMetadata,
  initDatabase,
  updateLocalNoteMetadata,
} from '../database'
import { cleanupMissingLocalNoteState } from '../local-note-state-cleanup'
import { normalizeRelativeSlashPath } from '../path-compat'

const require = createRequire(import.meta.url)
let sqliteAvailable = false

try {
  const BetterSqlite = require('better-sqlite3')
  const probe = new BetterSqlite(':memory:')
  probe.close()
  sqliteAvailable = true
} catch (error) {
  sqliteAvailable = false
  console.warn('[Local Note State Cleanup Tests] better-sqlite3 unavailable, skipping tests:', error)
}

if (process.env.CI && !sqliteAvailable) {
  throw new Error(
    '[Local Note State Cleanup Tests] better-sqlite3 unavailable in CI. Run `electron-rebuild` or `npm rebuild better-sqlite3` before tests.'
  )
}

const describeSqlite = sqliteAvailable ? describe : describe.skip

function removeDbFiles(dir: string): void {
  rmSync(join(dir, 'notes.db'), { force: true })
  rmSync(join(dir, 'notes.db-wal'), { force: true })
  rmSync(join(dir, 'notes.db-shm'), { force: true })
}

function normalizeLocalIndexSyncPath(relativePath: string | null | undefined): string | null {
  if (!relativePath) return null
  const normalized = normalizeRelativeSlashPath(relativePath)
  return normalized || null
}

let localMountSeed = 0
function createLocalNotebook(name: string): ReturnType<typeof addNotebook> {
  localMountSeed += 1
  const mountPath = `/tmp/sanqian-local-note-state-cleanup-${localMountSeed}`
  return createLocalFolderNotebookMount({
    name,
    root_path: mountPath,
    canonical_root_path: mountPath,
  }).notebook
}

function withMockedPlatform<T>(platform: NodeJS.Platform, run: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  if (!descriptor || !descriptor.configurable) {
    return run()
  }

  Object.defineProperty(process, 'platform', { value: platform })
  try {
    return run()
  } finally {
    Object.defineProperty(process, 'platform', descriptor)
  }
}

describeSqlite('local-note-state-cleanup', () => {
  const testDbDir = mkdtempSync(join(tmpdir(), 'sanqian-notes-db-local-note-state-cleanup-'))

  beforeAll(() => {
    vi.spyOn(app, 'getPath').mockReturnValue(testDbDir)
  })

  beforeEach(() => {
    closeDatabase()
    removeDbFiles(testDbDir)
    initDatabase()
    localMountSeed = 0
  })

  afterAll(() => {
    closeDatabase()
    rmSync(testDbDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('remaps metadata and identity for case-only path changes on case-insensitive platforms', () => {
    const localNotebook = createLocalNotebook('Local')
    const oldPath = 'docs/plan.md'
    const nextPath = 'Docs/Plan.md'

    const beforeMetadata = updateLocalNoteMetadata({
      notebook_id: localNotebook.id,
      relative_path: oldPath,
      is_favorite: true,
      is_pinned: true,
      ai_summary: 'plan summary',
      tags: ['project', 'plan'],
    })
    expect(beforeMetadata).not.toBeNull()

    const identity = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: oldPath,
    })
    expect(identity).not.toBeNull()

    withMockedPlatform('win32', () => {
      cleanupMissingLocalNoteState(
        localNotebook.id,
        new Set([nextPath]),
        normalizeLocalIndexSyncPath
      )
    })

    expect(getLocalNoteMetadata({
      notebook_id: localNotebook.id,
      relative_path: oldPath,
    })).toBeNull()

    const nextMetadata = getLocalNoteMetadata({
      notebook_id: localNotebook.id,
      relative_path: nextPath,
    })
    expect(nextMetadata?.is_favorite).toBe(true)
    expect(nextMetadata?.is_pinned).toBe(true)
    expect(nextMetadata?.ai_summary).toBe('plan summary')
    expect(nextMetadata?.tags).toEqual(['project', 'plan'])

    expect(getLocalNoteIdentityByPath({
      notebook_id: localNotebook.id,
      relative_path: oldPath,
    })).toBeNull()

    const byNewPath = getLocalNoteIdentityByPath({
      notebook_id: localNotebook.id,
      relative_path: nextPath,
    })
    expect(byNewPath?.note_uid).toBe(identity?.note_uid)

    const byUid = getLocalNoteIdentityByUid({ note_uid: identity?.note_uid || '' })
    expect(byUid?.relative_path).toBe(nextPath)
  })

  it('deletes stale metadata and identity when file no longer exists', () => {
    const localNotebook = createLocalNotebook('Local')
    const stalePath = 'docs/stale.md'

    updateLocalNoteMetadata({
      notebook_id: localNotebook.id,
      relative_path: stalePath,
      is_favorite: true,
      tags: ['stale'],
    })
    const identity = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: stalePath,
    })
    expect(identity).not.toBeNull()

    cleanupMissingLocalNoteState(
      localNotebook.id,
      new Set(),
      normalizeLocalIndexSyncPath
    )

    expect(getLocalNoteMetadata({
      notebook_id: localNotebook.id,
      relative_path: stalePath,
    })).toBeNull()
    expect(getLocalNoteIdentityByUid({ note_uid: identity?.note_uid || '' })).toBeNull()
  })
})
