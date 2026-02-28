import type { BaseWindow, WebContentsView } from 'electron'
import { autoUpdater } from 'electron-updater'
import { is } from '@electron-toolkit/utils'

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'ready' | 'error'

let updateStatus: UpdateStatus = 'idle'
let updateVersion: string | null = null
let updateProgress = 0
let updateError: string | null = null
let updateReleaseNotes: string | null = null

let mainViewGetter: (() => WebContentsView | null) | null = null
let mainWindowGetter: (() => BaseWindow | null) | null = null

export function getUpdateState() {
  return {
    status: updateStatus,
    version: updateVersion,
    progress: updateProgress,
    error: updateError,
    releaseNotes: updateReleaseNotes,
  }
}

export function setUpdateStatus(status: UpdateStatus): void {
  updateStatus = status
}

export function setUpdateError(error: string | null): void {
  updateError = error
}

export function setUpdateProgress(progress: number): void {
  updateProgress = progress
}

export function sendUpdateStatus(): void {
  const view = mainViewGetter?.()
  if (view && !view.webContents.isDestroyed()) {
    try {
      view.webContents.send('updater:status', {
        status: updateStatus,
        version: updateVersion,
        progress: updateProgress,
        error: updateError,
        releaseNotes: updateReleaseNotes
      })
    } catch (err) {
      // Window may be closing, ignore send errors
      console.warn('[Updater] Failed to send status:', err)
    }
  }
}

export function setupAutoUpdater(): void {
  // Don't check for updates in development
  if (is.dev) {
    console.log('Skipping auto-updater in development mode')
    return
  }

  // Configure auto-updater
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  // Update available
  autoUpdater.on('update-available', (info) => {
    console.log('Update available:', info.version)
    updateStatus = 'available'
    updateVersion = info.version
    updateError = null
    // Extract release notes - can be string, array of ReleaseNoteInfo, or null
    if (typeof info.releaseNotes === 'string') {
      updateReleaseNotes = info.releaseNotes || null
    } else if (Array.isArray(info.releaseNotes)) {
      // ReleaseNoteInfo[] format - join all notes
      const notes = info.releaseNotes
        .map(n => n.note || '')
        .filter(Boolean)
        .join('\n\n')
      updateReleaseNotes = notes || null
    } else {
      updateReleaseNotes = null
    }
    sendUpdateStatus()
  })

  // No update available
  autoUpdater.on('update-not-available', () => {
    console.log('No update available')
    updateStatus = 'not-available'
    updateError = null
    updateReleaseNotes = null
    sendUpdateStatus()
  })

  // Download progress
  autoUpdater.on('download-progress', (progressInfo) => {
    updateStatus = 'downloading'
    updateProgress = Math.round(progressInfo.percent)
    mainWindowGetter?.()?.setProgressBar(progressInfo.percent / 100)
    sendUpdateStatus()
  })

  // Update downloaded
  autoUpdater.on('update-downloaded', () => {
    console.log('Update downloaded')
    updateStatus = 'ready'
    updateProgress = 100
    mainWindowGetter?.()?.setProgressBar(-1)
    sendUpdateStatus()
  })

  // Error handling
  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err.message)
    updateStatus = 'error'
    updateError = err.message
    updateReleaseNotes = null
    mainWindowGetter?.()?.setProgressBar(-1)
    sendUpdateStatus()
  })

  // Check for updates on startup
  updateStatus = 'checking'
  sendUpdateStatus()
  autoUpdater.checkForUpdates().catch((err) => {
    console.log('Auto-updater check failed:', err.message)
    updateStatus = 'error'
    updateError = err.message
    sendUpdateStatus()
  })
}

export function initAutoUpdater(deps: {
  getMainView: () => WebContentsView | null
  getMainWindow: () => BaseWindow | null
}): void {
  mainViewGetter = deps.getMainView
  mainWindowGetter = deps.getMainWindow
}
