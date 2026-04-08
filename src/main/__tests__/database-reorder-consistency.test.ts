import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'module'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { app } from 'electron'
import {
  closeDatabase,
  createTemplate,
  getAllAIActions,
  getAllTemplates,
  initDatabase,
  reorderAIActions,
  reorderTemplates,
} from '../database'

const removeDbFiles = (dir: string) => {
  rmSync(join(dir, 'notes.db'), { force: true })
  rmSync(join(dir, 'notes.db-wal'), { force: true })
  rmSync(join(dir, 'notes.db-shm'), { force: true })
}

const require = createRequire(import.meta.url)
let sqliteAvailable = false

try {
  const BetterSqlite = require('better-sqlite3')
  const probe = new BetterSqlite(':memory:')
  probe.close()
  sqliteAvailable = true
} catch (error) {
  sqliteAvailable = false
  console.warn('[Database Reorder Tests] better-sqlite3 unavailable, skipping tests:', error)
}

if (process.env.CI && !sqliteAvailable) {
  throw new Error(
    '[Database Reorder Tests] better-sqlite3 unavailable in CI. Run `electron-rebuild` or `npm rebuild better-sqlite3` before tests.'
  )
}

const describeSqlite = sqliteAvailable ? describe : describe.skip

describeSqlite('database reorder consistency', () => {
  const testDbDir = mkdtempSync(join(tmpdir(), 'sanqian-notes-db-reorder-'))

  beforeAll(() => {
    vi.spyOn(app, 'getPath').mockReturnValue(testDbDir)
  })

  beforeEach(() => {
    closeDatabase()
    removeDbFiles(testDbDir)
    initDatabase()
  })

  afterAll(() => {
    closeDatabase()
    rmSync(testDbDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('reorderAIActions rejects duplicate ids and keeps order unchanged', () => {
    const before = getAllAIActions()
    expect(before.length).toBeGreaterThan(1)
    const firstId = before[0]?.id
    if (!firstId) throw new Error('missing default ai action')

    expect(() => reorderAIActions([firstId, firstId])).toThrow('reorderAIActions: duplicate id')
    expect(getAllAIActions().map((action) => action.id)).toEqual(before.map((action) => action.id))
  })

  it('reorderAIActions supports subset reorder with stable remainder order', () => {
    const before = getAllAIActions()
    expect(before.length).toBeGreaterThan(1)
    const tail = before[before.length - 1]
    if (!tail) throw new Error('missing ai action to reorder')

    reorderAIActions([tail.id])

    const afterIds = getAllAIActions().map((action) => action.id)
    const expectedIds = [tail.id, ...before.filter((action) => action.id !== tail.id).map((action) => action.id)]
    expect(afterIds).toEqual(expectedIds)
  })

  it('reorderTemplates rejects duplicate ids and keeps order unchanged', () => {
    const before = getAllTemplates()
    expect(before.length).toBeGreaterThan(0)
    const firstId = before[0]?.id
    if (!firstId) throw new Error('missing template')

    expect(() => reorderTemplates([firstId, firstId])).toThrow('reorderTemplates: duplicate id')
    expect(getAllTemplates().map((template) => template.id)).toEqual(before.map((template) => template.id))
  })

  it('reorderTemplates supports subset reorder with stable remainder order', () => {
    createTemplate({
      name: 'Reorder Template A',
      description: 'A',
      content: 'Template A',
      icon: '',
      isDailyDefault: false,
    })
    createTemplate({
      name: 'Reorder Template B',
      description: 'B',
      content: 'Template B',
      icon: '',
      isDailyDefault: false,
    })

    const before = getAllTemplates()
    expect(before.length).toBeGreaterThan(2)
    const tail = before[before.length - 1]
    if (!tail) throw new Error('missing template to reorder')

    reorderTemplates([tail.id])

    const afterIds = getAllTemplates().map((template) => template.id)
    const expectedIds = [tail.id, ...before.filter((template) => template.id !== tail.id).map((template) => template.id)]
    expect(afterIds).toEqual(expectedIds)
  })
})
