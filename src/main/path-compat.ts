import { lstatSync } from 'fs'
import { basename, dirname, join, normalize, resolve } from 'path'

const CASE_INSENSITIVE_PLATFORMS = new Set<NodeJS.Platform>(['win32', 'darwin'])
const CASE_SENSITIVITY_CACHE_MAX_SIZE = 256
const CASE_SENSITIVITY_CACHE = new Map<string, boolean>()

export function isCaseInsensitivePlatform(platform: NodeJS.Platform = process.platform): boolean {
  return CASE_INSENSITIVE_PLATFORMS.has(platform)
}

export function toNFC(value: string): string {
  return value.normalize('NFC')
}

export function toSlashPath(pathValue: string): string {
  return pathValue.replace(/\\/g, '/')
}

export function normalizeRelativeSlashPath(pathValue: string): string {
  return toNFC(toSlashPath(pathValue))
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/')
    .replace(/\/+$/, '')
}

export function normalizeComparablePath(
  pathValue: string,
  platform: NodeJS.Platform = process.platform
): string {
  let normalizedPath = toNFC(normalize(pathValue))
  if (isCaseInsensitivePlatform(platform)) {
    normalizedPath = normalizedPath.toLowerCase()
  }
  return normalizedPath
}

function toggleAsciiCase(name: string): string | null {
  for (let index = 0; index < name.length; index += 1) {
    const char = name[index]
    const lower = char.toLowerCase()
    const upper = char.toUpperCase()
    if (lower === upper) continue
    const toggled = char === lower ? upper : lower
    return `${name.slice(0, index)}${toggled}${name.slice(index + 1)}`
  }
  return null
}

function resolveExistingPath(pathValue: string): string | null {
  let currentPath = resolve(pathValue)
  while (true) {
    try {
      lstatSync(currentPath)
      return currentPath
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        return null
      }
      const parent = dirname(currentPath)
      if (parent === currentPath) {
        return null
      }
      currentPath = parent
    }
  }
}

function probeDarwinCaseSensitivity(pathValue: string): boolean | null {
  const existingPath = resolveExistingPath(pathValue)
  if (!existingPath) return null
  const normalizedExistingPath = normalize(existingPath)
  const cached = CASE_SENSITIVITY_CACHE.get(normalizedExistingPath)
  if (cached !== undefined) {
    return cached
  }

  let probePath = existingPath
  while (true) {
    const probeBaseName = basename(probePath)
    const probeParent = dirname(probePath)
    const toggledName = toggleAsciiCase(probeBaseName)
    if (toggledName && toggledName !== probeBaseName) {
      const alternativePath = join(probeParent, toggledName)
      try {
        const originalStat = lstatSync(probePath)
        const alternativeStat = lstatSync(alternativePath)
        const caseSensitive = !(
          originalStat.dev === alternativeStat.dev
          && originalStat.ino === alternativeStat.ino
        )
        if (CASE_SENSITIVITY_CACHE.size >= CASE_SENSITIVITY_CACHE_MAX_SIZE) {
          CASE_SENSITIVITY_CACHE.clear()
        }
        CASE_SENSITIVITY_CACHE.set(normalizedExistingPath, caseSensitive)
        return caseSensitive
      } catch (error) {
        const code = (error as NodeJS.ErrnoException | undefined)?.code
        if (code === 'ENOENT' || code === 'ENOTDIR') {
          if (CASE_SENSITIVITY_CACHE.size >= CASE_SENSITIVITY_CACHE_MAX_SIZE) {
            CASE_SENSITIVITY_CACHE.clear()
          }
          CASE_SENSITIVITY_CACHE.set(normalizedExistingPath, true)
          return true
        }
        return null
      }
    }

    if (probeParent === probePath) {
      return null
    }
    probePath = probeParent
  }
}

export function normalizeComparablePathForFileSystem(
  pathValue: string,
  referencePath: string = pathValue,
  platform: NodeJS.Platform = process.platform
): string {
  const normalizedPath = toNFC(normalize(pathValue))

  if (platform === 'darwin') {
    const caseSensitive = probeDarwinCaseSensitivity(referencePath)
    if (caseSensitive === false) {
      return normalizedPath.toLowerCase()
    }
    return normalizedPath
  }

  if (isCaseInsensitivePlatform(platform)) {
    return normalizedPath.toLowerCase()
  }

  return normalizedPath
}
