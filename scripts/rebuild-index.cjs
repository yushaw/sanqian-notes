const { app } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { initDatabase, closeDatabase, getNotes } = require('../src/main/database.ts')
const {
  initVectorDatabase,
  closeVectorDatabase,
  clearAllIndexData,
  getEmbeddingConfig
} = require('../src/main/embedding/database.ts')
const { indexingService } = require('../src/main/embedding/index.ts')

function resolveUserDataPath() {
  const candidates = []
  if (process.env.SANQIAN_USERDATA) {
    candidates.push(process.env.SANQIAN_USERDATA)
  }

  let baseDir = ''
  if (process.platform === 'darwin') {
    baseDir = path.join(os.homedir(), 'Library', 'Application Support')
  } else if (process.platform === 'win32') {
    baseDir = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  } else {
    baseDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  }

  candidates.push(path.join(baseDir, 'sanqian-notes'))
  candidates.push(path.join(baseDir, 'Sanqian Notes'))
  candidates.push(path.join(baseDir, 'SanqianNotes'))

  for (const candidate of candidates) {
    if (!candidate) continue
    if (fs.existsSync(path.join(candidate, 'notes.db'))) {
      return candidate
    }
  }

  for (const candidate of candidates) {
    if (!candidate) continue
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

const userDataPath = resolveUserDataPath()
if (userDataPath) {
  app.setPath('userData', userDataPath)
  console.log(`[RebuildIndex] Using userData: ${userDataPath}`)
}

async function main() {
  await app.whenReady()

  initDatabase()
  initVectorDatabase()
  indexingService.start()

  const config = getEmbeddingConfig()
  if (!config.enabled) {
    console.log('[RebuildIndex] Knowledge base disabled, skipping rebuild')
    indexingService.stop()
    closeVectorDatabase()
    closeDatabase()
    app.quit()
    return
  }

  clearAllIndexData()

  const batchSize = Number(process.env.REBUILD_BATCH_SIZE) || 1000
  const sleepMs = Number(process.env.REBUILD_SLEEP_MS) || 0

  let offset = 0
  let processed = 0
  let indexed = 0

  while (true) {
    const batch = getNotes(batchSize, offset)
    if (batch.length === 0) break

    for (const note of batch) {
      processed += 1
      const ok = await indexingService.checkAndIndex(
        note.id,
        note.notebook_id || '',
        note.content
      )
      if (ok) indexed += 1
    }

    offset += batch.length
    console.log(`[RebuildIndex] Processed ${processed} notes (${indexed} indexed)`)

    if (sleepMs > 0) {
      await new Promise(resolve => setTimeout(resolve, sleepMs))
    }
  }

  console.log(`[RebuildIndex] Completed: ${processed} notes (${indexed} indexed)`)

  indexingService.stop()

  closeVectorDatabase()
  closeDatabase()

  app.quit()
}

main().catch(error => {
  console.error('[RebuildIndex] Failed:', error)
  try {
    closeVectorDatabase()
  } catch {}
  try {
    closeDatabase()
  } catch {}
  app.quit()
})
