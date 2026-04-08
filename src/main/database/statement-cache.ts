import { getDb } from './connection'

export type DbHandle = ReturnType<typeof getDb>

interface StatementCacheOptions {
  refresh?: boolean
}

export function isSqliteSchemaChangedError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  if (code === 'SQLITE_SCHEMA') return true
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('database schema has changed')
}

export function getOrCreateStatementCache<TStatements>(
  cache: WeakMap<DbHandle, TStatements>,
  db: DbHandle,
  create: (db: DbHandle) => TStatements,
  options?: StatementCacheOptions
): TStatements {
  if (!options?.refresh) {
    const cached = cache.get(db)
    if (cached) return cached
  }

  const created = create(db)
  cache.set(db, created)
  return created
}

export function runWithStatementCacheRefresh<TStatements, TResult>(
  cache: WeakMap<DbHandle, TStatements>,
  db: DbHandle,
  create: (db: DbHandle) => TStatements,
  run: (statements: TStatements) => TResult
): TResult {
  try {
    const statements = getOrCreateStatementCache(cache, db, create)
    return run(statements)
  } catch (error) {
    if (!isSqliteSchemaChangedError(error)) {
      throw error
    }
    cache.delete(db)
    const refreshed = getOrCreateStatementCache(cache, db, create, { refresh: true })
    return run(refreshed)
  }
}
