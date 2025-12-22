import { app } from 'electron'
import { existsSync, readFileSync, watch } from 'fs'
import { join } from 'path'

let sanqianPort: number | null = null
let portWatcher: ReturnType<typeof watch> | null = null

/**
 * Get Sanqian data directory (cross-platform)
 * Uses ~/.sanqian on all platforms (matching Sanqian's default DATA_DIR)
 */
function getSanqianDataDir(): string {
  const homeDir = app.getPath('home')
  return join(homeDir, '.sanqian')
}

/**
 * Get the path to Sanqian's port file
 */
function getPortFilePath(): string {
  return join(getSanqianDataDir(), 'runtime', 'api.port')
}

/**
 * Read Sanqian port from file
 */
function readPortFile(): number | null {
  const portFile = getPortFilePath()

  if (!existsSync(portFile)) {
    return null
  }

  try {
    const content = readFileSync(portFile, 'utf-8').trim()
    const port = parseInt(content, 10)
    if (isNaN(port) || port < 1 || port > 65535) {
      return null
    }
    return port
  } catch {
    return null
  }
}

/**
 * Get current Sanqian API port
 * Returns null if Sanqian is not running or port file not found
 */
export function getSanqianPort(): number | null {
  if (sanqianPort === null) {
    sanqianPort = readPortFile()
  }
  return sanqianPort
}

/**
 * Get Sanqian API base URL
 * Returns null if Sanqian is not available
 */
export function getSanqianApiUrl(): string | null {
  const port = getSanqianPort()
  if (port === null) return null
  return `http://localhost:${port}`
}

/**
 * Start watching the port file for changes
 * Call this when app starts
 */
export function startPortWatcher(onChange?: (port: number | null) => void): void {
  const dir = join(getSanqianDataDir(), 'runtime')

  // Initial read
  sanqianPort = readPortFile()

  // Watch for changes (watch the directory since file might not exist)
  if (existsSync(dir)) {
    try {
      portWatcher = watch(dir, (_eventType, filename) => {
        if (filename === 'api.port') {
          const newPort = readPortFile()
          if (newPort !== sanqianPort) {
            sanqianPort = newPort
            onChange?.(sanqianPort)
          }
        }
      })
    } catch {
      // Watching might fail on some systems, ignore
    }
  }
}

/**
 * Stop watching the port file
 * Call this when app quits
 */
export function stopPortWatcher(): void {
  if (portWatcher) {
    portWatcher.close()
    portWatcher = null
  }
}

/**
 * Check if Sanqian is running by testing the health endpoint
 */
export async function checkSanqianHealth(): Promise<boolean> {
  const url = getSanqianApiUrl()
  if (!url) return false

  try {
    const response = await fetch(`${url}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000)
    })
    return response.ok
  } catch {
    return false
  }
}
