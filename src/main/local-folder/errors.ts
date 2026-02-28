import type { LocalFolderReadFileErrorCode } from '../../shared/types'

export const WINDOWS_INVALID_ENTRY_CHARS_RE = /[<>:"|?*]/
export const WINDOWS_RESERVED_ENTRY_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
])

export function createPathGuardError(code: 'ENOENT' | 'ENOTDIR' | 'EACCES' | 'EPERM', message: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException
  error.code = code
  return error
}

export function mapFileSystemErrorToCode(code: string | undefined): LocalFolderReadFileErrorCode {
  if (code === 'ENOENT' || code === 'ENOTDIR') return 'LOCAL_FILE_NOT_FOUND'
  if (code === 'EACCES' || code === 'EPERM') return 'LOCAL_FILE_UNREADABLE'
  return 'LOCAL_FILE_UNREADABLE'
}

export function shouldIgnoreEntryScanError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'EACCES' || code === 'EPERM'
}
