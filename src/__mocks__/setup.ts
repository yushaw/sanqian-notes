/**
 * Vitest setup file
 * Mocks electron and related modules for testing
 */
import { vi } from 'vitest'

// Mock electron module
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => []
  },
  app: {
    getPath: () => '/tmp',
    getName: () => 'test-app',
    getVersion: () => '1.0.0',
    on: () => {},
    quit: () => {}
  },
  ipcMain: {
    on: () => {},
    handle: () => {}
  },
  ipcRenderer: {
    on: () => {},
    invoke: () => Promise.resolve()
  },
  screen: {
    getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } })
  },
  globalShortcut: {
    register: () => {},
    unregister: () => {}
  }
}))

// Mock sanqian-sdk to avoid loading the full SDK in tests
vi.mock('../main/sanqian-sdk', () => ({
  getClient: () => null
}))

// Mock summary-service to avoid electron dependency
vi.mock('../main/summary-service', () => ({
  generateSummary: () => Promise.resolve(false),
  extractPlainText: (content: string) => content,
  extractOutline: () => '',
  computeHash: (content: string) => content.slice(0, 16),
  shouldGenerateSummary: () => ({ shouldGenerate: false, reason: 'mocked', plainText: '', contentHash: '' })
}))
