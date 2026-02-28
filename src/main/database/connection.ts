import Database from 'better-sqlite3'

let db: Database.Database
let isDatabaseOpen = false

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database is not open. Call initDatabase() first.')
  }
  return db
}

export function setDb(newDb: Database.Database): void {
  db = newDb
}

export function getIsDatabaseOpen(): boolean {
  return isDatabaseOpen
}

export function setIsDatabaseOpen(value: boolean): void {
  isDatabaseOpen = value
}
