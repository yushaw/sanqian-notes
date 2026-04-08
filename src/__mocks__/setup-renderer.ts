/**
 * Vitest setup file for renderer tests
 * Configures jsdom environment and testing-library matchers
 */
import { beforeEach } from 'vitest'
import '@testing-library/jest-dom/vitest'

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'clear'>

function isStorageLike(value: unknown): value is StorageLike {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.getItem === 'function'
    && typeof candidate.setItem === 'function'
    && typeof candidate.removeItem === 'function'
    && typeof candidate.clear === 'function'
  )
}

function createMemoryStorage(): StorageLike {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string): string | null => {
      return Object.prototype.hasOwnProperty.call(store, key)
        ? store[key]
        : null
    },
    setItem: (key: string, value: string): void => {
      store[key] = String(value)
    },
    removeItem: (key: string): void => {
      delete store[key]
    },
    clear: (): void => {
      store = {}
    },
  }
}

const fallbackStorage = createMemoryStorage()

function installLocalStorageFallback(storage: StorageLike): void {
  try {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: storage,
    })
  } catch {
    // ignore
  }
  if (typeof window !== 'undefined') {
    try {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        writable: true,
        value: storage,
      })
    } catch {
      // ignore
    }
  }
}

beforeEach(() => {
  const currentStorage = (globalThis as { localStorage?: unknown }).localStorage
  if (isStorageLike(currentStorage)) return
  fallbackStorage.clear()
  installLocalStorageFallback(fallbackStorage)
})
