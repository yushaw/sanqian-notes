import { describe, expect, it, vi } from 'vitest'
import { migrateNotebooksSourceType } from '../database'

describe('migrateNotebooksSourceType', () => {
  it('adds source_type column first for legacy notebooks table, then creates index', () => {
    const execSql = vi.fn()
    const log = vi.fn()

    migrateNotebooksSourceType(
      [
        { name: 'id' },
        { name: 'name' },
        { name: 'icon' },
      ],
      execSql,
      log
    )

    expect(execSql).toHaveBeenCalledTimes(2)
    expect(execSql).toHaveBeenNthCalledWith(
      1,
      "ALTER TABLE notebooks ADD COLUMN source_type TEXT NOT NULL DEFAULT 'internal'"
    )
    expect(execSql).toHaveBeenNthCalledWith(
      2,
      'CREATE INDEX IF NOT EXISTS idx_notebooks_source_type ON notebooks(source_type)'
    )
    expect(log).toHaveBeenCalledWith('Adding source_type column to notebooks table...')
    expect(log).toHaveBeenCalledWith('Migration completed: source_type column added.')
  })

  it('only creates index when source_type column already exists', () => {
    const execSql = vi.fn()
    const log = vi.fn()

    migrateNotebooksSourceType(
      [
        { name: 'id' },
        { name: 'name' },
        { name: 'icon' },
        { name: 'source_type' },
      ],
      execSql,
      log
    )

    expect(execSql).toHaveBeenCalledTimes(1)
    expect(execSql).toHaveBeenCalledWith(
      'CREATE INDEX IF NOT EXISTS idx_notebooks_source_type ON notebooks(source_type)'
    )
    expect(log).not.toHaveBeenCalled()
  })
})
