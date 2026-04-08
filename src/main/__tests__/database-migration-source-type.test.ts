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

    expect(execSql).toHaveBeenCalledTimes(5)
    expect(execSql).toHaveBeenNthCalledWith(
      1,
      "ALTER TABLE notebooks ADD COLUMN source_type TEXT NOT NULL DEFAULT 'internal'"
    )
    expect(execSql).toHaveBeenNthCalledWith(
      2,
      'CREATE INDEX IF NOT EXISTS idx_notebooks_source_type ON notebooks(source_type)'
    )
    expect(execSql).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("UPDATE notebooks")
    )
    expect(execSql).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('CREATE TRIGGER IF NOT EXISTS trg_notebooks_source_type_validate_insert')
    )
    expect(execSql).toHaveBeenNthCalledWith(
      5,
      expect.stringContaining('CREATE TRIGGER IF NOT EXISTS trg_notebooks_source_type_validate_update')
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

    expect(execSql).toHaveBeenCalledTimes(4)
    expect(execSql).toHaveBeenNthCalledWith(
      1,
      'CREATE INDEX IF NOT EXISTS idx_notebooks_source_type ON notebooks(source_type)'
    )
    expect(execSql).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("UPDATE notebooks")
    )
    expect(execSql).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('CREATE TRIGGER IF NOT EXISTS trg_notebooks_source_type_validate_insert')
    )
    expect(execSql).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('CREATE TRIGGER IF NOT EXISTS trg_notebooks_source_type_validate_update')
    )
    expect(log).not.toHaveBeenCalled()
  })
})
