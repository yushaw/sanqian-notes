import { join } from 'path'
import { describe, expect, it, vi, beforeEach } from 'vitest'

const { appGetPathMock, realpathSyncMock } = vi.hoisted(() => ({
  appGetPathMock: vi.fn<(name: string) => string>(),
  realpathSyncMock: vi.fn<(path: string) => string>(),
}))

vi.mock('electron', () => ({
  app: {
    getPath: appGetPathMock,
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
  shell: {
    openPath: vi.fn(),
    showItemInFolder: vi.fn(),
  },
}))

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    realpathSync: realpathSyncMock,
  }
})

import { getFullPath } from '../attachment'

describe('attachment getFullPath path safety', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows existing file resolved under userData root', () => {
    const userDataPath = '/tmp/sanqian-user-data'
    const relativePath = 'attachments/2026/04/file.png'
    const fullPath = join(userDataPath, relativePath)

    appGetPathMock.mockReturnValue(userDataPath)
    realpathSyncMock.mockImplementation((pathInput: string) => {
      if (pathInput === fullPath) return fullPath
      if (pathInput === userDataPath) return userDataPath
      throw new Error(`unexpected path: ${pathInput}`)
    })

    expect(getFullPath(relativePath)).toBe(fullPath)
  })

  it('rejects existing file that resolves outside userData root', () => {
    const userDataPath = '/tmp/sanqian-user-data'
    const relativePath = 'attachments/2026/04/file.png'
    const fullPath = join(userDataPath, relativePath)

    appGetPathMock.mockReturnValue(userDataPath)
    realpathSyncMock.mockImplementation((pathInput: string) => {
      if (pathInput === fullPath) return '/etc/passwd'
      if (pathInput === userDataPath) return userDataPath
      throw new Error(`unexpected path: ${pathInput}`)
    })

    expect(() => getFullPath(relativePath)).toThrow(
      'Invalid path: resolved path escapes user data directory'
    )
  })

  it('accepts windows-style real paths under userData root', () => {
    const userDataPath = 'C:\\Users\\Alice\\AppData\\Roaming\\Sanqian'
    const relativePath = 'attachments/2026/04/file.png'
    const fullPath = join(userDataPath, relativePath)
    const windowsRealUserData = 'C:\\Users\\Alice\\AppData\\Roaming\\Sanqian'
    const windowsRealFilePath = 'C:\\Users\\Alice\\AppData\\Roaming\\Sanqian\\attachments\\2026\\04\\file.png'

    appGetPathMock.mockReturnValue(userDataPath)
    realpathSyncMock.mockImplementation((pathInput: string) => {
      if (pathInput === fullPath) return windowsRealFilePath
      if (pathInput === userDataPath) return windowsRealUserData
      throw new Error(`unexpected path: ${pathInput}`)
    })

    expect(getFullPath(relativePath)).toBe(fullPath)
  })
})
