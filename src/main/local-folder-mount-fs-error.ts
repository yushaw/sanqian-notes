import type { NotebookStatus } from '../shared/types'

const MOUNT_AVAILABILITY_ERRNO_CODES = new Set([
  'ENOENT',
  'ENOTDIR',
  'EACCES',
  'EPERM',
  'EIO',
  'ENXIO',
  'ESTALE',
])

export function isMountAvailabilityFsError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  if (typeof code !== 'string' || code.length === 0) {
    return false
  }
  return MOUNT_AVAILABILITY_ERRNO_CODES.has(code)
}

export function resolveUnavailableMountStatusFromFsError(
  error: unknown,
  resolveMountStatusFromFsError: (error: unknown) => NotebookStatus
): Extract<NotebookStatus, 'missing' | 'permission_required'> | null {
  if (!isMountAvailabilityFsError(error)) return null
  const status = resolveMountStatusFromFsError(error)
  return status === 'permission_required' ? 'permission_required' : 'missing'
}
