import { v4 as uuidv4 } from 'uuid'
import { getDb } from './connection'
import { buildCanonicalComparePath } from './helpers'
import type {
  NotebookStatus,
  LocalFolderMount,
  LocalFolderNotebookMount,
  LocalFolderMountCreatePersistResult,
  LocalFolderMountRootPersistResult,
  LocalFolderMountStatusPersistResult,
} from '../../shared/types'

function getNextNotebookOrderIndex(): number {
  const db = getDb()
  const maxStmt = db.prepare('SELECT MAX(order_index) as max FROM notebooks')
  const maxResult = maxStmt.get() as { max: number | null }
  return (maxResult.max ?? -1) + 1
}

function isSqliteConstraintError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY'
}

function createCanonicalPathConflictError(canonicalRootPath: string): NodeJS.ErrnoException {
  const error = new Error(`Duplicate canonical local-folder mount: ${canonicalRootPath}`) as NodeJS.ErrnoException
  error.code = 'SQLITE_CONSTRAINT_UNIQUE'
  return error
}

export function getLocalFolderMounts(): LocalFolderNotebookMount[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT
      n.id as notebook_id,
      n.name as notebook_name,
      n.icon as notebook_icon,
      n.order_index as notebook_order_index,
      n.created_at as notebook_created_at,
      m.root_path as mount_root_path,
      m.canonical_root_path as mount_canonical_root_path,
      m.status as mount_status,
      m.created_at as mount_created_at,
      m.updated_at as mount_updated_at
    FROM local_folder_mounts m
    JOIN notebooks n ON n.id = m.notebook_id
    WHERE n.source_type = 'local-folder'
    ORDER BY n.order_index
  `).all() as Array<{
    notebook_id: string
    notebook_name: string
    notebook_icon: string
    notebook_order_index: number
    notebook_created_at: string
    mount_root_path: string
    mount_canonical_root_path: string
    mount_status: NotebookStatus
    mount_created_at: string
    mount_updated_at: string
  }>

  return rows.map((row) => ({
    notebook: {
      id: row.notebook_id,
      name: row.notebook_name,
      icon: row.notebook_icon,
      source_type: 'local-folder',
      order_index: row.notebook_order_index,
      created_at: row.notebook_created_at,
    },
    mount: {
      notebook_id: row.notebook_id,
      root_path: row.mount_root_path,
      canonical_root_path: row.mount_canonical_root_path,
      status: row.mount_status,
      created_at: row.mount_created_at,
      updated_at: row.mount_updated_at,
    },
  }))
}

export function getLocalFolderMountByCanonicalPath(
  canonicalRootPath: string,
  options?: { excludeNotebookId?: string; activeOnly?: boolean }
): LocalFolderMount | null {
  const db = getDb()
  const targetComparePath = buildCanonicalComparePath(canonicalRootPath, canonicalRootPath)
  const indexedRows = db.prepare(`
    SELECT
      m.notebook_id,
      m.root_path,
      m.canonical_root_path,
      m.canonical_compare_path,
      m.status,
      m.created_at,
      m.updated_at
    FROM local_folder_mounts m
    JOIN notebooks n ON n.id = m.notebook_id
    WHERE n.source_type = 'local-folder'
      AND m.canonical_compare_path = ?
  `).all(targetComparePath) as Array<LocalFolderMount & { canonical_compare_path?: string | null }>
  const rows = indexedRows.length > 0
    ? indexedRows
    : (db.prepare(`
      SELECT
        m.notebook_id,
        m.root_path,
        m.canonical_root_path,
        m.canonical_compare_path,
        m.status,
        m.created_at,
        m.updated_at
      FROM local_folder_mounts m
      JOIN notebooks n ON n.id = m.notebook_id
      WHERE n.source_type = 'local-folder'
    `).all() as Array<LocalFolderMount & { canonical_compare_path?: string | null }>)

  let matched: LocalFolderMount | null = null
  for (const row of rows) {
    if (options?.excludeNotebookId && row.notebook_id === options.excludeNotebookId) {
      continue
    }
    if (options?.activeOnly && row.status !== 'active') {
      continue
    }

    const persistedComparablePath = typeof row.canonical_compare_path === 'string'
      ? row.canonical_compare_path.trim()
      : ''
    const comparablePath = persistedComparablePath
      || buildCanonicalComparePath(row.canonical_root_path, row.root_path)
    if (comparablePath !== targetComparePath) {
      continue
    }

    if (!matched) {
      matched = row
      continue
    }

    if (row.status !== matched.status) {
      if (row.status === 'active') {
        matched = row
      }
      continue
    }

    const matchedUpdatedAt = Date.parse(matched.updated_at || '')
    const rowUpdatedAt = Date.parse(row.updated_at || '')
    if (Number.isFinite(rowUpdatedAt) && (!Number.isFinite(matchedUpdatedAt) || rowUpdatedAt > matchedUpdatedAt)) {
      matched = row
      continue
    }

    if (matched.notebook_id.localeCompare(row.notebook_id, undefined, { sensitivity: 'base', numeric: true }) > 0) {
      matched = row
    }
  }

  return matched
}

function ensureCanonicalPathMountUnique(
  canonicalRootPath: string,
  options?: { excludeNotebookId?: string; activeOnly?: boolean }
): void {
  const duplicated = getLocalFolderMountByCanonicalPath(canonicalRootPath, {
    excludeNotebookId: options?.excludeNotebookId,
    activeOnly: options?.activeOnly,
  })
  if (!duplicated) return

  throw createCanonicalPathConflictError(canonicalRootPath)
}

export function getLocalFolderMountByNotebookId(notebookId: string): LocalFolderMount | null {
  const db = getDb()
  const row = db.prepare(`
    SELECT m.*
    FROM local_folder_mounts m
    JOIN notebooks n ON n.id = m.notebook_id
    WHERE m.notebook_id = ?
      AND n.source_type = 'local-folder'
  `).get(notebookId) as LocalFolderMount | undefined
  return row || null
}

export function createLocalFolderNotebookMount(input: {
  name: string
  icon?: string
  root_path: string
  canonical_root_path: string
  status?: NotebookStatus
}): LocalFolderNotebookMount {
  const result = createLocalFolderNotebookMountSafe(input)
  if (result.status === 'conflict') {
    throw createCanonicalPathConflictError(input.canonical_root_path)
  }
  return result.mount
}

export function createLocalFolderNotebookMountSafe(input: {
  name: string
  icon?: string
  root_path: string
  canonical_root_path: string
  status?: NotebookStatus
}): LocalFolderMountCreatePersistResult {
  const db = getDb()
  try {
    ensureCanonicalPathMountUnique(input.canonical_root_path)
  } catch (error) {
    if (isSqliteConstraintError(error)) {
      return { status: 'conflict' }
    }
    throw error
  }

  const notebookId = uuidv4()
  const now = new Date().toISOString()
  const orderIndex = getNextNotebookOrderIndex()
  const icon = input.icon ?? 'logo:notes'
  const status = input.status ?? 'active'
  const canonicalComparePath = buildCanonicalComparePath(input.canonical_root_path, input.root_path)

  const create = db.transaction(() => {
    db.prepare(`
      INSERT INTO notebooks (id, name, icon, source_type, order_index, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(notebookId, input.name, icon, 'local-folder', orderIndex, now)

    db.prepare(`
      INSERT INTO local_folder_mounts (
        notebook_id, root_path, canonical_root_path, canonical_compare_path, status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(notebookId, input.root_path, input.canonical_root_path, canonicalComparePath, status, now, now)
  })

  try {
    create()
  } catch (error) {
    if (isSqliteConstraintError(error)) {
      return { status: 'conflict' }
    }
    throw error
  }

  return {
    status: 'created',
    mount: {
      notebook: {
        id: notebookId,
        name: input.name,
        icon,
        source_type: 'local-folder',
        order_index: orderIndex,
        created_at: now,
      },
      mount: {
        notebook_id: notebookId,
        root_path: input.root_path,
        canonical_root_path: input.canonical_root_path,
        status,
        created_at: now,
        updated_at: now,
      },
    },
  }
}

export function updateLocalFolderMountStatus(
  notebookId: string,
  status: NotebookStatus
): LocalFolderMountStatusPersistResult {
  const db = getDb()
  const current = db.prepare(`
    SELECT status
    FROM local_folder_mounts
    WHERE notebook_id = ?
  `).get(notebookId) as { status: NotebookStatus } | undefined

  if (!current) return 'not_found'
  if (current.status === status) {
    return 'no_change'
  }

  try {
    const result = db.prepare(`
      UPDATE local_folder_mounts
      SET status = ?, updated_at = ?
      WHERE notebook_id = ?
    `).run(status, new Date().toISOString(), notebookId)

    return result.changes > 0 ? 'updated' : 'not_found'
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
      console.warn(
        `[Database] Skip local-folder status update due canonical-path conflict: notebook=${notebookId}, status=${status}`
      )
      return 'conflict'
    }
    throw error
  }
}

export function updateLocalFolderMountRoot(input: {
  notebook_id: string
  root_path: string
  canonical_root_path: string
  status?: NotebookStatus
}): LocalFolderMountRootPersistResult {
  const db = getDb()
  const nextStatus = input.status ?? 'active'
  try {
    ensureCanonicalPathMountUnique(input.canonical_root_path, {
      excludeNotebookId: input.notebook_id,
    })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
      return { status: 'conflict' }
    }
    throw error
  }
  const now = new Date().toISOString()
  const canonicalComparePath = buildCanonicalComparePath(input.canonical_root_path, input.root_path)
  try {
    const result = db.prepare(`
      UPDATE local_folder_mounts
      SET root_path = ?, canonical_root_path = ?, canonical_compare_path = ?, status = ?, updated_at = ?
      WHERE notebook_id = ?
    `).run(input.root_path, input.canonical_root_path, canonicalComparePath, nextStatus, now, input.notebook_id)

    if (result.changes === 0) return { status: 'not_found' }

    const row = db.prepare('SELECT * FROM local_folder_mounts WHERE notebook_id = ?').get(input.notebook_id) as LocalFolderMount | undefined
    if (!row) return { status: 'not_found' }
    return { status: 'updated', mount: row }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
      return { status: 'conflict' }
    }
    throw error
  }
}
