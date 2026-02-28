import { describe, expect, it, vi } from 'vitest'
import {
  migrateNotesDeletedAt,
  migrateNotesDetachedFolderPath,
  migrateNotesFolderPath,
  migrateNotesIsPinned
} from '../database'

describe('notes migration helpers', () => {
  it('adds is_pinned column before creating its index for legacy notes table', () => {
    const execSql = vi.fn()
    const log = vi.fn()

    migrateNotesIsPinned(
      [
        { name: 'id' },
        { name: 'title' },
        { name: 'content' },
      ],
      execSql,
      log
    )

    expect(execSql).toHaveBeenCalledTimes(2)
    expect(execSql).toHaveBeenNthCalledWith(
      1,
      'ALTER TABLE notes ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0'
    )
    expect(execSql).toHaveBeenNthCalledWith(
      2,
      'CREATE INDEX IF NOT EXISTS idx_notes_is_pinned ON notes(is_pinned)'
    )
    expect(log).toHaveBeenCalledWith('Adding is_pinned column to notes table...')
    expect(log).toHaveBeenCalledWith('Migration completed: is_pinned column added.')
  })

  it('only ensures is_pinned index when column already exists', () => {
    const execSql = vi.fn()
    const log = vi.fn()

    migrateNotesIsPinned(
      [
        { name: 'id' },
        { name: 'title' },
        { name: 'content' },
        { name: 'is_pinned' },
      ],
      execSql,
      log
    )

    expect(execSql).toHaveBeenCalledTimes(1)
    expect(execSql).toHaveBeenCalledWith(
      'CREATE INDEX IF NOT EXISTS idx_notes_is_pinned ON notes(is_pinned)'
    )
    expect(log).not.toHaveBeenCalled()
  })

  it('adds deleted_at column before creating its index for legacy notes table', () => {
    const execSql = vi.fn()
    const log = vi.fn()

    migrateNotesDeletedAt(
      [
        { name: 'id' },
        { name: 'title' },
        { name: 'content' },
      ],
      execSql,
      log
    )

    expect(execSql).toHaveBeenCalledTimes(2)
    expect(execSql).toHaveBeenNthCalledWith(
      1,
      'ALTER TABLE notes ADD COLUMN deleted_at TEXT DEFAULT NULL'
    )
    expect(execSql).toHaveBeenNthCalledWith(
      2,
      'CREATE INDEX IF NOT EXISTS idx_notes_deleted_at ON notes(deleted_at)'
    )
    expect(log).toHaveBeenCalledWith('Adding deleted_at column to notes table...')
    expect(log).toHaveBeenCalledWith('Migration completed: deleted_at column added.')
  })

  it('only ensures deleted_at index when column already exists', () => {
    const execSql = vi.fn()
    const log = vi.fn()

    migrateNotesDeletedAt(
      [
        { name: 'id' },
        { name: 'title' },
        { name: 'content' },
        { name: 'deleted_at' },
      ],
      execSql,
      log
    )

    expect(execSql).toHaveBeenCalledTimes(1)
    expect(execSql).toHaveBeenCalledWith(
      'CREATE INDEX IF NOT EXISTS idx_notes_deleted_at ON notes(deleted_at)'
    )
    expect(log).not.toHaveBeenCalled()
  })

  it('adds folder_path column before creating its indexes for legacy notes table', () => {
    const execSql = vi.fn()
    const log = vi.fn()

    migrateNotesFolderPath(
      [
        { name: 'id' },
        { name: 'title' },
        { name: 'content' },
      ],
      execSql,
      log
    )

    expect(execSql).toHaveBeenCalledTimes(3)
    expect(execSql).toHaveBeenNthCalledWith(
      1,
      'ALTER TABLE notes ADD COLUMN folder_path TEXT DEFAULT NULL'
    )
    expect(execSql).toHaveBeenNthCalledWith(
      2,
      'CREATE INDEX IF NOT EXISTS idx_notes_folder_path ON notes(folder_path)'
    )
    expect(execSql).toHaveBeenNthCalledWith(
      3,
      'CREATE INDEX IF NOT EXISTS idx_notes_notebook_folder_path ON notes(notebook_id, folder_path)'
    )
    expect(log).toHaveBeenCalledWith('Adding folder_path column to notes table...')
    expect(log).toHaveBeenCalledWith('Migration completed: folder_path column added.')
  })

  it('only ensures folder_path indexes when column already exists', () => {
    const execSql = vi.fn()
    const log = vi.fn()

    migrateNotesFolderPath(
      [
        { name: 'id' },
        { name: 'title' },
        { name: 'content' },
        { name: 'folder_path' },
      ],
      execSql,
      log
    )

    expect(execSql).toHaveBeenCalledTimes(2)
    expect(execSql).toHaveBeenNthCalledWith(
      1,
      'CREATE INDEX IF NOT EXISTS idx_notes_folder_path ON notes(folder_path)'
    )
    expect(execSql).toHaveBeenNthCalledWith(
      2,
      'CREATE INDEX IF NOT EXISTS idx_notes_notebook_folder_path ON notes(notebook_id, folder_path)'
    )
    expect(log).not.toHaveBeenCalled()
  })

  it('repairs detached notes with stale folder_path', () => {
    const execSql = vi.fn()
    const log = vi.fn()

    migrateNotesDetachedFolderPath(execSql, log)

    expect(execSql).toHaveBeenCalledTimes(1)
    expect(execSql).toHaveBeenCalledWith(
      'UPDATE notes SET folder_path = NULL WHERE notebook_id IS NULL AND folder_path IS NOT NULL'
    )
    expect(log).toHaveBeenCalledWith('Repairing detached notes with stale folder_path...')
  })
})
