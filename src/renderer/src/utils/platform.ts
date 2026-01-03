/**
 * Platform Detection Utility
 *
 * Provides synchronous platform detection for renderer process.
 * Falls back to userAgent parsing if electron API is not available.
 */

// Cache platform info on first access
let cachedPlatform: NodeJS.Platform | null = null
let cachePromise: Promise<NodeJS.Platform> | null = null

/**
 * Get platform asynchronously (preferred method)
 */
export async function getPlatform(): Promise<NodeJS.Platform> {
  if (cachedPlatform) {
    return cachedPlatform
  }

  if (cachePromise) {
    return cachePromise
  }

  cachePromise = window.electron.platform.get().then(platform => {
    cachedPlatform = platform
    return platform
  }).catch(err => {
    // Clear cachePromise on error so subsequent calls can retry
    cachePromise = null
    throw err
  })

  return cachePromise
}

/**
 * Get platform synchronously (uses fallback if not cached)
 *
 * IMPORTANT: This uses userAgent parsing as fallback which is less reliable.
 * Prefer getPlatform() when possible and cache the result.
 */
export function getPlatformSync(): NodeJS.Platform {
  if (cachedPlatform) {
    return cachedPlatform
  }

  // Fallback: parse userAgent (less reliable but works)
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('mac')) return 'darwin'
  if (ua.includes('win')) return 'win32'
  if (ua.includes('linux')) return 'linux'

  // Default fallback
  return 'linux'
}

/**
 * Check if running on macOS (synchronous)
 */
export function isMacOS(): boolean {
  return getPlatformSync() === 'darwin'
}

/**
 * Check if running on Windows (synchronous)
 */
export function isWindows(): boolean {
  return getPlatformSync() === 'win32'
}

/**
 * Check if running on Linux (synchronous)
 */
export function isLinux(): boolean {
  return getPlatformSync() === 'linux'
}

/**
 * Initialize platform cache (call this early in app startup)
 */
export function initPlatform(): void {
  getPlatform().catch(err => {
    console.error('[Platform] Failed to get platform:', err)
  })
}
