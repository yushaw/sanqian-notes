import { EventEmitter } from 'events'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const readdirSyncMock = vi.hoisted(() => vi.fn())
const lstatSyncMock = vi.hoisted(() => vi.fn())

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    readdirSync: readdirSyncMock,
    lstatSync: lstatSyncMock,
  }
})

import { createFileSystemWatcher } from '../local-folder-watch'

function createUnknownTypeDirent(name: string): import('fs').Dirent<Buffer> {
  return {
    name: Buffer.from(name, 'utf8'),
    isDirectory: () => false,
    isFile: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false,
  } as unknown as import('fs').Dirent<Buffer>
}

describe('local-folder-watch unknown dirent fallback', () => {
  beforeEach(() => {
    readdirSyncMock.mockReset()
    lstatSyncMock.mockReset()
  })

  it('falls back to lstat when dirent type is unknown so nested directories are watched', () => {
    const rootPath = '/tmp/sanqian-local-watch-dirent-root'
    const docsPath = join(rootPath, 'docs')

    readdirSyncMock.mockImplementation((directoryPath: string) => {
      if (directoryPath === rootPath) {
        return [createUnknownTypeDirent('docs')]
      }
      if (directoryPath === docsPath) {
        return []
      }
      return []
    })

    lstatSyncMock.mockImplementation((targetPath: string) => {
      if (targetPath === docsPath) {
        return {
          isDirectory: () => true,
          isSymbolicLink: () => false,
        }
      }
      const error = new Error('not found') as NodeJS.ErrnoException
      error.code = 'ENOENT'
      throw error
    })

    const watchedPaths: string[] = []
    const watchFactory = vi.fn((targetPath: string, optionsOrListener?: unknown) => {
      if (
        typeof optionsOrListener === 'object'
        && optionsOrListener !== null
        && 'recursive' in (optionsOrListener as object)
      ) {
        const error = new Error('recursive watch unsupported') as NodeJS.ErrnoException
        error.code = 'ENOSYS'
        throw error
      }

      watchedPaths.push(targetPath)
      const watcher = new EventEmitter() as EventEmitter & { close: () => void }
      watcher.close = vi.fn()
      return watcher as ReturnType<typeof createFileSystemWatcher>
    })

    const watcher = createFileSystemWatcher(rootPath, () => {}, watchFactory as never)
    expect(watchFactory).toHaveBeenCalledTimes(3)
    expect(watchedPaths).toContain(rootPath)
    expect(watchedPaths).toContain(docsPath)
    expect(lstatSyncMock).toHaveBeenCalledWith(docsPath)
    watcher.close()
  })
})
