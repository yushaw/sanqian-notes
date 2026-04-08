import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs'
import { promises as fsPromises } from 'fs'
import { createHash } from 'crypto'
import { basename, dirname, extname, join } from 'path'
import type {
  LocalFolderCreateFileResponse,
  LocalFolderCreateFolderResponse,
  LocalFolderDeleteEntryInput,
  LocalFolderFileContent,
  LocalFolderFileErrorCode,
  LocalFolderNotebookMount,
  LocalFolderReadFileErrorCode,
  LocalFolderReadFileResponse,
  LocalFolderRenameEntryInput,
  LocalFolderRenameEntryResponse,
  LocalFolderSaveFileResponse,
} from '../../shared/types'
import { createLocalResourceId } from '../../shared/local-resource-id'
import { toSlashPath } from '../path-compat'
import { jsonToMarkdown, markdownToTiptapString } from '../markdown'
import { mapFileSystemErrorToCode } from './errors'
import {
  ALLOWED_EXTENSIONS,
  MAX_CREATE_FOLDER_LEVEL,
  MAX_EDITABLE_FILE_SIZE_BYTES,
  composeChildRelativePath,
  getParentRelativePath,
  getRelativeFolderDepth,
  hasFileChangedSinceRead,
  isValidEntryName,
  isSameRenameTargetPath,
  normalizeCreateFileName,
  normalizeRelativePath,
  normalizeRenameFileName,
  resolveExistingDirectory,
  resolveExistingDirectoryAsync,
  resolvePathUnderRoot,
} from './path'

function createLocalDocId(notebookId: string, relativePath: string): string {
  return createLocalResourceId(notebookId, toSlashPath(relativePath))
}

export function hashUtf8Text(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

export interface LocalTextFormat {
  lineEnding: '\n' | '\r\n'
  hasBom: boolean
}

export function detectLocalTextFormat(content: string): LocalTextFormat {
  return {
    lineEnding: content.includes('\r\n') ? '\r\n' : '\n',
    hasBom: content.startsWith('\uFEFF'),
  }
}

export function applyLocalTextFormat(content: string, format: LocalTextFormat): string {
  let formatted = content.replace(/\r\n?/g, '\n')
  if (format.lineEnding === '\r\n') {
    formatted = formatted.replace(/\n/g, '\r\n')
  }
  if (format.hasBom && !formatted.startsWith('\uFEFF')) {
    formatted = `\uFEFF${formatted}`
  }
  return formatted
}

export function atomicWriteUtf8File(targetPath: string, content: string): void {
  const targetDir = dirname(targetPath)
  const targetBaseName = basename(targetPath)
  const tempPath = join(
    targetDir,
    `.${targetBaseName}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  )

  let fileDescriptor: number | null = null
  let dirDescriptor: number | null = null
  try {
    fileDescriptor = openSync(tempPath, 'wx')
    writeFileSync(fileDescriptor, content, 'utf-8')
    fsyncSync(fileDescriptor)
    closeSync(fileDescriptor)
    fileDescriptor = null
    renameSync(tempPath, targetPath)
    try {
      dirDescriptor = openSync(targetDir, 'r')
      fsyncSync(dirDescriptor)
    } catch {
      // ignore directory fsync errors (platform/filesystem dependent)
    }
  } finally {
    if (fileDescriptor !== null) {
      try {
        closeSync(fileDescriptor)
      } catch {
        // ignore close errors
      }
    }
    if (dirDescriptor !== null) {
      try {
        closeSync(dirDescriptor)
      } catch {
        // ignore close errors
      }
    }
    try {
      unlinkSync(tempPath)
    } catch {
      // ignore cleanup errors
    }
  }
}

function toLocalFolderFileContent(
  mount: LocalFolderNotebookMount,
  relativePath: string,
  stat: { size: number; mtimeMs: number },
  rawContent: string
): LocalFolderFileContent {
  const extension = extname(relativePath).toLowerCase()
  const normalizedExtension: 'md' | 'txt' = extension === '.txt' ? 'txt' : 'md'
  const fileName = basename(relativePath)
  const displayName = basename(relativePath, extension)
  return {
    id: createLocalDocId(mount.notebook.id, relativePath),
    notebook_id: mount.notebook.id,
    name: displayName,
    file_name: fileName,
    relative_path: relativePath,
    extension: normalizedExtension,
    size: stat.size,
    mtime_ms: stat.mtimeMs,
    content_hash: hashUtf8Text(rawContent),
    tiptap_content: markdownToTiptapString(rawContent),
  }
}

export function readLocalFolderFile(
  mount: LocalFolderNotebookMount,
  relativePathInput: string
): LocalFolderReadFileResponse {
  const relativePath = normalizeRelativePath(relativePathInput)
  const absolutePath = resolvePathUnderRoot(
    mount.mount.root_path,
    relativePath,
    mount.mount.canonical_root_path
  )
  if (!absolutePath) {
    return { success: false, errorCode: 'LOCAL_FILE_OUT_OF_ROOT' }
  }

  const extension = extname(relativePath).toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return { success: false, errorCode: 'LOCAL_FILE_UNSUPPORTED_TYPE' }
  }

  try {
    const stat = lstatSync(absolutePath)
    if (stat.isSymbolicLink()) {
      return { success: false, errorCode: 'LOCAL_FILE_UNSUPPORTED_TYPE' }
    }
    if (!stat.isFile()) {
      return { success: false, errorCode: 'LOCAL_FILE_NOT_A_FILE' }
    }
    if (stat.size > MAX_EDITABLE_FILE_SIZE_BYTES) {
      return { success: false, errorCode: 'LOCAL_FILE_TOO_LARGE' }
    }

    const rawContent = readFileSync(absolutePath, 'utf-8')
    return {
      success: true,
      result: toLocalFolderFileContent(mount, relativePath, stat, rawContent),
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    return { success: false, errorCode: mapFileSystemErrorToCode(code) }
  }
}

export function resolveLocalFolderFilePath(
  mount: LocalFolderNotebookMount,
  relativePathInput: string
): { success: true; relative_path: string } | { success: false; errorCode: LocalFolderReadFileErrorCode } {
  const relativePath = normalizeRelativePath(relativePathInput)
  const absolutePath = resolvePathUnderRoot(
    mount.mount.root_path,
    relativePath,
    mount.mount.canonical_root_path
  )
  if (!absolutePath) {
    return { success: false, errorCode: 'LOCAL_FILE_OUT_OF_ROOT' }
  }

  const extension = extname(relativePath).toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return { success: false, errorCode: 'LOCAL_FILE_UNSUPPORTED_TYPE' }
  }

  try {
    const stat = lstatSync(absolutePath)
    if (stat.isSymbolicLink()) {
      return { success: false, errorCode: 'LOCAL_FILE_UNSUPPORTED_TYPE' }
    }
    if (!stat.isFile()) {
      return { success: false, errorCode: 'LOCAL_FILE_NOT_A_FILE' }
    }
    return { success: true, relative_path: relativePath }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    return { success: false, errorCode: mapFileSystemErrorToCode(code) }
  }
}

export function saveLocalFolderFile(
  mount: LocalFolderNotebookMount,
  relativePathInput: string,
  tiptapContent: string,
  options?: {
    expectedMtimeMs?: number
    expectedSize?: number
    expectedContentHash?: string
    force?: boolean
  }
): LocalFolderSaveFileResponse {
  const relativePath = normalizeRelativePath(relativePathInput)
  const absolutePath = resolvePathUnderRoot(
    mount.mount.root_path,
    relativePath,
    mount.mount.canonical_root_path
  )
  if (!absolutePath) {
    return { success: false, errorCode: 'LOCAL_FILE_OUT_OF_ROOT' }
  }

  const extension = extname(relativePath).toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return { success: false, errorCode: 'LOCAL_FILE_UNSUPPORTED_TYPE' }
  }

  let currentStat: ReturnType<typeof lstatSync>
  try {
    currentStat = lstatSync(absolutePath)
    if (currentStat.isSymbolicLink()) {
      return { success: false, errorCode: 'LOCAL_FILE_UNSUPPORTED_TYPE' }
    }
    if (!currentStat.isFile()) {
      return { success: false, errorCode: 'LOCAL_FILE_NOT_A_FILE' }
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    return { success: false, errorCode: mapFileSystemErrorToCode(code) }
  }

  if (currentStat.size > MAX_EDITABLE_FILE_SIZE_BYTES) {
    return { success: false, errorCode: 'LOCAL_FILE_TOO_LARGE' }
  }

  let currentContentHash: string | undefined
  let currentRawContent: string | null = null
  const readCurrentRawContent = (
    forceRefresh: boolean = false
  ): { ok: true; content: string } | { ok: false; errorCode: LocalFolderReadFileErrorCode } => {
    if (!forceRefresh && currentRawContent !== null) {
      return { ok: true, content: currentRawContent }
    }

    let latestStat: ReturnType<typeof lstatSync>
    try {
      latestStat = lstatSync(absolutePath)
      if (latestStat.isSymbolicLink()) {
        return { ok: false, errorCode: 'LOCAL_FILE_UNSUPPORTED_TYPE' }
      }
      if (!latestStat.isFile()) {
        return { ok: false, errorCode: 'LOCAL_FILE_NOT_A_FILE' }
      }
      if (latestStat.size > MAX_EDITABLE_FILE_SIZE_BYTES) {
        return { ok: false, errorCode: 'LOCAL_FILE_TOO_LARGE' }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code
      return { ok: false, errorCode: mapFileSystemErrorToCode(code) }
    }

    try {
      currentRawContent = readFileSync(absolutePath, 'utf-8')
      currentStat = latestStat
      return { ok: true, content: currentRawContent }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code
      return { ok: false, errorCode: mapFileSystemErrorToCode(code) }
    }
  }
  const expectedContentHash = typeof options?.expectedContentHash === 'string'
    ? options.expectedContentHash.toLowerCase()
    : undefined
  if (!options?.force) {
    const statChanged = hasFileChangedSinceRead(
      currentStat,
      options?.expectedMtimeMs,
      options?.expectedSize
    )

    let contentChanged = false
    if (expectedContentHash) {
      const currentContentResult = readCurrentRawContent()
      if (!currentContentResult.ok) {
        return { success: false, errorCode: currentContentResult.errorCode }
      }
      currentContentHash = hashUtf8Text(currentContentResult.content)
      contentChanged = currentContentHash !== expectedContentHash
    }

    if (statChanged || contentChanged) {
      return {
        success: false,
        errorCode: 'LOCAL_FILE_CONFLICT',
        conflict: {
          size: currentStat.size,
          mtime_ms: currentStat.mtimeMs,
          content_hash: currentContentHash,
        },
      }
    }
  }

  try {
    const markdownContent = jsonToMarkdown(tiptapContent)
    const currentContentResult = readCurrentRawContent()
    if (!currentContentResult.ok) {
      return { success: false, errorCode: currentContentResult.errorCode }
    }
    const initialRawContent = currentContentResult.content

    let stableStat = currentStat
    if (!options?.force) {
      try {
        const latestStat = lstatSync(absolutePath)
        if (latestStat.isSymbolicLink()) {
          return { success: false, errorCode: 'LOCAL_FILE_UNSUPPORTED_TYPE' }
        }
        if (!latestStat.isFile()) {
          return { success: false, errorCode: 'LOCAL_FILE_NOT_A_FILE' }
        }
        if (latestStat.size > MAX_EDITABLE_FILE_SIZE_BYTES) {
          return { success: false, errorCode: 'LOCAL_FILE_TOO_LARGE' }
        }
        stableStat = latestStat
      } catch (error) {
        const code = (error as NodeJS.ErrnoException | undefined)?.code
        return { success: false, errorCode: mapFileSystemErrorToCode(code) }
      }

      if (hasFileChangedSinceRead(stableStat, currentStat.mtimeMs, currentStat.size)) {
        let conflictStat = stableStat
        let latestContentHash: string | undefined
        const latestContentResult = readCurrentRawContent(true)
        if (latestContentResult.ok) {
          latestContentHash = hashUtf8Text(latestContentResult.content)
          conflictStat = currentStat
        }
        return {
          success: false,
          errorCode: 'LOCAL_FILE_CONFLICT',
          conflict: {
            size: conflictStat.size,
            mtime_ms: conflictStat.mtimeMs,
            content_hash: latestContentHash,
          },
        }
      }

      const latestContentResult = readCurrentRawContent(true)
      if (!latestContentResult.ok) {
        return { success: false, errorCode: latestContentResult.errorCode }
      }
      stableStat = currentStat

      const latestContent = latestContentResult.content
      if (latestContent !== initialRawContent) {
        return {
          success: false,
          errorCode: 'LOCAL_FILE_CONFLICT',
          conflict: {
            size: stableStat.size,
            mtime_ms: stableStat.mtimeMs,
            content_hash: hashUtf8Text(latestContent),
          },
        }
      }

      if (expectedContentHash) {
        const latestContentHash = hashUtf8Text(latestContent)
        if (latestContentHash !== expectedContentHash) {
          return {
            success: false,
            errorCode: 'LOCAL_FILE_CONFLICT',
            conflict: {
              size: stableStat.size,
              mtime_ms: stableStat.mtimeMs,
              content_hash: latestContentHash,
            },
          }
        }
        currentContentHash = latestContentHash
      }
    }

    const markdownWithLocalFormat = applyLocalTextFormat(
      markdownContent,
      detectLocalTextFormat(currentContentResult.content)
    )
    if (markdownWithLocalFormat === currentContentResult.content) {
      return {
        success: true,
        result: {
          size: stableStat.size,
          mtime_ms: stableStat.mtimeMs,
          content_hash: currentContentHash || hashUtf8Text(currentContentResult.content),
        },
      }
    }

    atomicWriteUtf8File(absolutePath, markdownWithLocalFormat)
    const updatedStat = statSync(absolutePath)
    return {
      success: true,
      result: {
        size: updatedStat.size,
        mtime_ms: updatedStat.mtimeMs,
        content_hash: hashUtf8Text(markdownWithLocalFormat),
      },
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return { success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' }
    }
    return { success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' }
  }
}

export function renameLocalFolderEntry(
  mount: LocalFolderNotebookMount,
  input: LocalFolderRenameEntryInput
): LocalFolderRenameEntryResponse {
  const currentRelativePath = normalizeRelativePath(input.relative_path)
  if (!currentRelativePath) {
    return {
      success: false,
      errorCode: input.kind === 'folder' ? 'LOCAL_FOLDER_NOT_FOUND' : 'LOCAL_FILE_NOT_FOUND',
    }
  }

  const absoluteCurrentPath = resolvePathUnderRoot(
    mount.mount.root_path,
    currentRelativePath,
    mount.mount.canonical_root_path
  )
  if (!absoluteCurrentPath) {
    return { success: false, errorCode: 'LOCAL_FILE_OUT_OF_ROOT' }
  }

  let currentStat: ReturnType<typeof lstatSync>
  try {
    currentStat = lstatSync(absoluteCurrentPath)
    if (currentStat.isSymbolicLink()) {
      return {
        success: false,
        errorCode: input.kind === 'folder' ? 'LOCAL_FOLDER_NOT_A_DIRECTORY' : 'LOCAL_FILE_NOT_A_FILE',
      }
    }
    if (input.kind === 'file' && !currentStat.isFile()) {
      return { success: false, errorCode: 'LOCAL_FILE_NOT_A_FILE' }
    }
    if (input.kind === 'folder' && !currentStat.isDirectory()) {
      return { success: false, errorCode: 'LOCAL_FOLDER_NOT_A_DIRECTORY' }
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return {
        success: false,
        errorCode: input.kind === 'folder' ? 'LOCAL_FOLDER_NOT_FOUND' : 'LOCAL_FILE_NOT_FOUND',
      }
    }
    if (code === 'EACCES' || code === 'EPERM') {
      return { success: false, errorCode: 'LOCAL_FILE_UNREADABLE' }
    }
    return { success: false, errorCode: 'LOCAL_FILE_UNREADABLE' }
  }

  const nextNameResult = input.kind === 'file'
    ? normalizeRenameFileName(currentRelativePath, input.new_name)
    : (() => {
      const folderName = input.new_name.trim()
      if (!isValidEntryName(folderName)) {
        return { success: false as const, errorCode: 'LOCAL_FILE_INVALID_NAME' as const }
      }
      return { success: true as const, fileName: folderName }
    })()

  if (!nextNameResult.success) {
    return { success: false, errorCode: nextNameResult.errorCode }
  }

  const currentName = basename(currentRelativePath)
  const nextName = nextNameResult.fileName
  if (currentName === nextName) {
    return {
      success: true,
      result: { relative_path: currentRelativePath },
    }
  }

  const parentRelativePath = getParentRelativePath(currentRelativePath)
  const nextRelativePath = composeChildRelativePath(parentRelativePath, nextName)
  const absoluteNextPath = resolvePathUnderRoot(
    mount.mount.root_path,
    nextRelativePath,
    mount.mount.canonical_root_path
  )
  if (!absoluteNextPath) {
    return { success: false, errorCode: 'LOCAL_FILE_OUT_OF_ROOT' }
  }

  try {
    const existing = lstatSync(absoluteNextPath)
    const isSameTarget = isSameRenameTargetPath(
      absoluteCurrentPath,
      absoluteNextPath,
      currentStat,
      existing
    )
    if (!isSameTarget) {
      if (existing.isDirectory()) {
        return { success: false, errorCode: 'LOCAL_FOLDER_ALREADY_EXISTS' }
      }
      return { success: false, errorCode: 'LOCAL_FILE_ALREADY_EXISTS' }
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      if (code === 'EACCES' || code === 'EPERM') {
        return { success: false, errorCode: 'LOCAL_FILE_UNREADABLE' }
      }
      return { success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' }
    }
  }

  try {
    renameSync(absoluteCurrentPath, absoluteNextPath)
    if (input.kind === 'file') {
      try {
        const newStat = lstatSync(absoluteNextPath)
        return { success: true, result: { relative_path: nextRelativePath, mtime_ms: newStat.mtimeMs, size: newStat.size } }
      } catch { /* non-fatal */ }
    }
    return {
      success: true,
      result: { relative_path: nextRelativePath },
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return {
        success: false,
        errorCode: input.kind === 'folder' ? 'LOCAL_FOLDER_NOT_FOUND' : 'LOCAL_FILE_NOT_FOUND',
      }
    }
    if (code === 'EEXIST') {
      return { success: false, errorCode: input.kind === 'folder' ? 'LOCAL_FOLDER_ALREADY_EXISTS' : 'LOCAL_FILE_ALREADY_EXISTS' }
    }
    if (code === 'EACCES' || code === 'EPERM') {
      return { success: false, errorCode: 'LOCAL_FILE_UNREADABLE' }
    }
    return { success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' }
  }
}

export function createLocalFolderFile(
  mount: LocalFolderNotebookMount,
  parentRelativePath: string | null,
  fileNameInput: string
): LocalFolderCreateFileResponse {
  const parentDirectory = resolveExistingDirectory(
    mount.mount.root_path,
    parentRelativePath,
    mount.mount.canonical_root_path
  )
  if (!parentDirectory.success) {
    return { success: false, errorCode: parentDirectory.errorCode }
  }

  const normalizedFileName = normalizeCreateFileName(fileNameInput)
  if (!normalizedFileName.success) {
    return { success: false, errorCode: normalizedFileName.errorCode }
  }

  const relativePath = composeChildRelativePath(parentDirectory.relativePath || null, normalizedFileName.fileName)
  const absolutePath = resolvePathUnderRoot(
    mount.mount.root_path,
    relativePath,
    mount.mount.canonical_root_path
  )
  if (!absolutePath) {
    return { success: false, errorCode: 'LOCAL_FILE_OUT_OF_ROOT' }
  }

  try {
    const existing = lstatSync(absolutePath)
    if (existing.isDirectory()) {
      return { success: false, errorCode: 'LOCAL_FOLDER_ALREADY_EXISTS' }
    }
    return { success: false, errorCode: 'LOCAL_FILE_ALREADY_EXISTS' }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      if (code === 'EACCES' || code === 'EPERM') {
        return { success: false, errorCode: 'LOCAL_FILE_UNREADABLE' }
      }
      return { success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' }
    }
  }

  try {
    writeFileSync(absolutePath, '', { encoding: 'utf-8', flag: 'wx' })
    return {
      success: true,
      result: { relative_path: relativePath },
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code === 'EEXIST') {
      return { success: false, errorCode: 'LOCAL_FILE_ALREADY_EXISTS' }
    }
    if (code === 'EACCES' || code === 'EPERM') {
      return { success: false, errorCode: 'LOCAL_FILE_UNREADABLE' }
    }
    return { success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' }
  }
}

export function createLocalFolder(
  mount: LocalFolderNotebookMount,
  parentRelativePath: string | null,
  folderNameInput: string
): LocalFolderCreateFolderResponse {
  const parentDirectory = resolveExistingDirectory(
    mount.mount.root_path,
    parentRelativePath,
    mount.mount.canonical_root_path
  )
  if (!parentDirectory.success) {
    return { success: false, errorCode: parentDirectory.errorCode }
  }

  const nextDepth = getRelativeFolderDepth(parentDirectory.relativePath || null) + 1
  if (nextDepth > MAX_CREATE_FOLDER_LEVEL) {
    return { success: false, errorCode: 'LOCAL_FOLDER_DEPTH_LIMIT' }
  }

  const folderName = folderNameInput.trim()
  if (!isValidEntryName(folderName)) {
    return { success: false, errorCode: 'LOCAL_FILE_INVALID_NAME' }
  }

  const relativePath = composeChildRelativePath(parentDirectory.relativePath || null, folderName)
  const absolutePath = resolvePathUnderRoot(
    mount.mount.root_path,
    relativePath,
    mount.mount.canonical_root_path
  )
  if (!absolutePath) {
    return { success: false, errorCode: 'LOCAL_FILE_OUT_OF_ROOT' }
  }

  try {
    mkdirSync(absolutePath, { recursive: false })
    return {
      success: true,
      result: { relative_path: relativePath },
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code === 'EEXIST') {
      return { success: false, errorCode: 'LOCAL_FOLDER_ALREADY_EXISTS' }
    }
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return { success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' }
    }
    if (code === 'EACCES' || code === 'EPERM') {
      return { success: false, errorCode: 'LOCAL_FILE_UNREADABLE' }
    }
    return { success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' }
  }
}

export interface LocalFolderDeleteTarget {
  absolute_path: string
  relative_path: string
  kind: 'file' | 'folder'
}

export function resolveLocalFolderDeleteTarget(
  mount: LocalFolderNotebookMount,
  input: LocalFolderDeleteEntryInput
): { success: true; result: LocalFolderDeleteTarget } | { success: false; errorCode: LocalFolderFileErrorCode } {
  const relativePath = normalizeRelativePath(input.relative_path)
  const absolutePath = resolvePathUnderRoot(
    mount.mount.root_path,
    relativePath,
    mount.mount.canonical_root_path
  )
  if (!absolutePath) {
    return { success: false, errorCode: 'LOCAL_FILE_OUT_OF_ROOT' }
  }

  try {
    const stat = lstatSync(absolutePath)
    if (stat.isSymbolicLink()) {
      return {
        success: false,
        errorCode: input.kind === 'folder' ? 'LOCAL_FOLDER_NOT_A_DIRECTORY' : 'LOCAL_FILE_NOT_A_FILE',
      }
    }

    if (input.kind === 'file' && !stat.isFile()) {
      return { success: false, errorCode: 'LOCAL_FILE_NOT_A_FILE' }
    }
    if (input.kind === 'folder' && !stat.isDirectory()) {
      return { success: false, errorCode: 'LOCAL_FOLDER_NOT_A_DIRECTORY' }
    }

    return {
      success: true,
      result: {
        absolute_path: absolutePath,
        relative_path: relativePath,
        kind: input.kind,
      },
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return {
        success: false,
        errorCode: input.kind === 'folder' ? 'LOCAL_FOLDER_NOT_FOUND' : 'LOCAL_FILE_NOT_FOUND',
      }
    }
    if (code === 'EACCES' || code === 'EPERM') {
      return { success: false, errorCode: 'LOCAL_FILE_UNREADABLE' }
    }
    return { success: false, errorCode: 'LOCAL_FILE_UNREADABLE' }
  }
}

// ---------------------------------------------------------------------------
// Async versions -- use fs/promises to avoid blocking the main process thread.
// Sync versions above are kept for callers that cannot be async yet.
// ---------------------------------------------------------------------------

function mapErrnoToReadErrorCode(error: unknown): LocalFolderReadFileErrorCode {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return mapFileSystemErrorToCode(code) as LocalFolderReadFileErrorCode || 'LOCAL_FILE_NOT_FOUND'
}

function mapErrnoToKindErrorCode(
  error: unknown,
  kind: 'file' | 'folder',
  category: 'not_found' | 'unreadable'
): LocalFolderFileErrorCode {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return kind === 'folder' ? 'LOCAL_FOLDER_NOT_FOUND' : 'LOCAL_FILE_NOT_FOUND'
  }
  if (category === 'unreadable' || code === 'EACCES' || code === 'EPERM') {
    return 'LOCAL_FILE_UNREADABLE'
  }
  return mapFileSystemErrorToCode(code) || 'LOCAL_FILE_UNREADABLE'
}

export async function atomicWriteUtf8FileAsync(targetPath: string, content: string): Promise<void> {
  const targetDir = dirname(targetPath)
  const targetBaseName = basename(targetPath)
  const tempPath = join(
    targetDir,
    `.${targetBaseName}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  )

  let fileHandle: import('fs/promises').FileHandle | null = null
  try {
    fileHandle = await fsPromises.open(tempPath, 'wx')
    await fileHandle.writeFile(content, 'utf-8')
    await fileHandle.sync()
    await fileHandle.close()
    fileHandle = null
    await fsPromises.rename(tempPath, targetPath)
    // Best-effort directory fsync for durability
    let dirHandle: import('fs/promises').FileHandle | null = null
    try {
      dirHandle = await fsPromises.open(targetDir, 'r')
      await dirHandle.sync()
    } catch {
      // ignore directory fsync errors (platform/filesystem dependent)
    } finally {
      await dirHandle?.close().catch(() => {})
    }
  } finally {
    if (fileHandle !== null) {
      await fileHandle.close().catch(() => {})
    }
    await fsPromises.unlink(tempPath).catch(() => {})
  }
}

export async function readLocalFolderFileAsync(
  mount: LocalFolderNotebookMount,
  relativePathInput: string
): Promise<LocalFolderReadFileResponse> {
  const relativePath = normalizeRelativePath(relativePathInput)
  const absolutePath = resolvePathUnderRoot(
    mount.mount.root_path,
    relativePath,
    mount.mount.canonical_root_path
  )
  if (!absolutePath) {
    return { success: false, errorCode: 'LOCAL_FILE_OUT_OF_ROOT' }
  }

  const extension = extname(relativePath).toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return { success: false, errorCode: 'LOCAL_FILE_UNSUPPORTED_TYPE' }
  }

  try {
    const stat = await fsPromises.lstat(absolutePath)
    if (stat.isSymbolicLink()) {
      return { success: false, errorCode: 'LOCAL_FILE_UNSUPPORTED_TYPE' }
    }
    if (!stat.isFile()) {
      return { success: false, errorCode: 'LOCAL_FILE_NOT_A_FILE' }
    }
    if (stat.size > MAX_EDITABLE_FILE_SIZE_BYTES) {
      return { success: false, errorCode: 'LOCAL_FILE_TOO_LARGE' }
    }

    const rawContent = await fsPromises.readFile(absolutePath, 'utf-8')
    return {
      success: true,
      result: toLocalFolderFileContent(mount, relativePath, stat, rawContent),
    }
  } catch (error) {
    return { success: false, errorCode: mapErrnoToReadErrorCode(error) }
  }
}

export async function resolveLocalFolderFilePathAsync(
  mount: LocalFolderNotebookMount,
  relativePathInput: string
): Promise<{ success: true; relative_path: string } | { success: false; errorCode: LocalFolderReadFileErrorCode }> {
  const relativePath = normalizeRelativePath(relativePathInput)
  const absolutePath = resolvePathUnderRoot(
    mount.mount.root_path,
    relativePath,
    mount.mount.canonical_root_path
  )
  if (!absolutePath) {
    return { success: false, errorCode: 'LOCAL_FILE_OUT_OF_ROOT' }
  }

  const extension = extname(relativePath).toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return { success: false, errorCode: 'LOCAL_FILE_UNSUPPORTED_TYPE' }
  }

  try {
    const stat = await fsPromises.lstat(absolutePath)
    if (stat.isSymbolicLink()) {
      return { success: false, errorCode: 'LOCAL_FILE_UNSUPPORTED_TYPE' }
    }
    if (!stat.isFile()) {
      return { success: false, errorCode: 'LOCAL_FILE_NOT_A_FILE' }
    }
    return { success: true, relative_path: relativePath }
  } catch (error) {
    return { success: false, errorCode: mapErrnoToReadErrorCode(error) }
  }
}

export interface LocalFolderFileStatInfo {
  relative_path: string
  size: number
  mtime_ms: number
}

export async function statLocalFolderFileAsync(
  mount: LocalFolderNotebookMount,
  relativePathInput: string
): Promise<{ success: true; result: LocalFolderFileStatInfo } | { success: false; errorCode: LocalFolderReadFileErrorCode }> {
  const relativePath = normalizeRelativePath(relativePathInput)
  const absolutePath = resolvePathUnderRoot(
    mount.mount.root_path,
    relativePath,
    mount.mount.canonical_root_path
  )
  if (!absolutePath) {
    return { success: false, errorCode: 'LOCAL_FILE_OUT_OF_ROOT' }
  }

  const extension = extname(relativePath).toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return { success: false, errorCode: 'LOCAL_FILE_UNSUPPORTED_TYPE' }
  }

  try {
    const stat = await fsPromises.lstat(absolutePath)
    if (stat.isSymbolicLink()) {
      return { success: false, errorCode: 'LOCAL_FILE_UNSUPPORTED_TYPE' }
    }
    if (!stat.isFile()) {
      return { success: false, errorCode: 'LOCAL_FILE_NOT_A_FILE' }
    }
    if (stat.size > MAX_EDITABLE_FILE_SIZE_BYTES) {
      return { success: false, errorCode: 'LOCAL_FILE_TOO_LARGE' }
    }
    return {
      success: true,
      result: {
        relative_path: relativePath,
        size: stat.size,
        mtime_ms: stat.mtimeMs,
      },
    }
  } catch (error) {
    return { success: false, errorCode: mapErrnoToReadErrorCode(error) }
  }
}

async function lstatFileCheckAsync(
  absolutePath: string,
  sizeLimit: number
): Promise<
  | { ok: true; stat: import('fs').Stats }
  | { ok: false; errorCode: LocalFolderReadFileErrorCode }
> {
  try {
    const stat = await fsPromises.lstat(absolutePath)
    if (stat.isSymbolicLink()) return { ok: false, errorCode: 'LOCAL_FILE_UNSUPPORTED_TYPE' }
    if (!stat.isFile()) return { ok: false, errorCode: 'LOCAL_FILE_NOT_A_FILE' }
    if (stat.size > sizeLimit) return { ok: false, errorCode: 'LOCAL_FILE_TOO_LARGE' }
    return { ok: true, stat }
  } catch (error) {
    return { ok: false, errorCode: mapErrnoToReadErrorCode(error) }
  }
}

export async function saveLocalFolderFileAsync(
  mount: LocalFolderNotebookMount,
  relativePathInput: string,
  tiptapContent: string,
  options?: {
    expectedMtimeMs?: number
    expectedSize?: number
    expectedContentHash?: string
    force?: boolean
  }
): Promise<LocalFolderSaveFileResponse> {
  const relativePath = normalizeRelativePath(relativePathInput)
  const absolutePath = resolvePathUnderRoot(
    mount.mount.root_path,
    relativePath,
    mount.mount.canonical_root_path
  )
  if (!absolutePath) {
    return { success: false, errorCode: 'LOCAL_FILE_OUT_OF_ROOT' }
  }

  const extension = extname(relativePath).toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return { success: false, errorCode: 'LOCAL_FILE_UNSUPPORTED_TYPE' }
  }

  const initialCheck = await lstatFileCheckAsync(absolutePath, MAX_EDITABLE_FILE_SIZE_BYTES)
  if (!initialCheck.ok) return { success: false, errorCode: initialCheck.errorCode }
  let currentStat = initialCheck.stat

  let currentContentHash: string | undefined
  let currentRawContent: string | null = null

  const readCurrentRawContent = async (
    forceRefresh: boolean = false
  ): Promise<{ ok: true; content: string } | { ok: false; errorCode: LocalFolderReadFileErrorCode }> => {
    if (!forceRefresh && currentRawContent !== null) {
      return { ok: true, content: currentRawContent }
    }
    const check = await lstatFileCheckAsync(absolutePath, MAX_EDITABLE_FILE_SIZE_BYTES)
    if (!check.ok) return { ok: false, errorCode: check.errorCode }
    try {
      currentRawContent = await fsPromises.readFile(absolutePath, 'utf-8')
      currentStat = check.stat
      return { ok: true, content: currentRawContent }
    } catch (error) {
      return { ok: false, errorCode: mapErrnoToReadErrorCode(error) }
    }
  }

  const expectedContentHash = typeof options?.expectedContentHash === 'string'
    ? options.expectedContentHash.toLowerCase()
    : undefined

  if (!options?.force) {
    const statChanged = hasFileChangedSinceRead(
      currentStat,
      options?.expectedMtimeMs,
      options?.expectedSize
    )

    let contentChanged = false
    if (expectedContentHash) {
      const currentContentResult = await readCurrentRawContent()
      if (!currentContentResult.ok) {
        return { success: false, errorCode: currentContentResult.errorCode }
      }
      currentContentHash = hashUtf8Text(currentContentResult.content)
      contentChanged = currentContentHash !== expectedContentHash
    }

    if (statChanged || contentChanged) {
      return {
        success: false,
        errorCode: 'LOCAL_FILE_CONFLICT',
        conflict: {
          size: currentStat.size,
          mtime_ms: currentStat.mtimeMs,
          content_hash: currentContentHash,
        },
      }
    }
  }

  try {
    const markdownContent = jsonToMarkdown(tiptapContent)
    const currentContentResult = await readCurrentRawContent()
    if (!currentContentResult.ok) {
      return { success: false, errorCode: currentContentResult.errorCode }
    }
    const initialRawContent = currentContentResult.content

    let stableStat = currentStat
    if (!options?.force) {
      const latestCheck = await lstatFileCheckAsync(absolutePath, MAX_EDITABLE_FILE_SIZE_BYTES)
      if (!latestCheck.ok) return { success: false, errorCode: latestCheck.errorCode }
      stableStat = latestCheck.stat

      if (hasFileChangedSinceRead(stableStat, currentStat.mtimeMs, currentStat.size)) {
        let conflictStat = stableStat
        let latestContentHash: string | undefined
        const latestContentResult = await readCurrentRawContent(true)
        if (latestContentResult.ok) {
          latestContentHash = hashUtf8Text(latestContentResult.content)
          conflictStat = currentStat
        }
        return {
          success: false,
          errorCode: 'LOCAL_FILE_CONFLICT',
          conflict: {
            size: conflictStat.size,
            mtime_ms: conflictStat.mtimeMs,
            content_hash: latestContentHash,
          },
        }
      }

      const latestContentResult = await readCurrentRawContent(true)
      if (!latestContentResult.ok) {
        return { success: false, errorCode: latestContentResult.errorCode }
      }
      stableStat = currentStat

      const latestContent = latestContentResult.content
      if (latestContent !== initialRawContent) {
        return {
          success: false,
          errorCode: 'LOCAL_FILE_CONFLICT',
          conflict: {
            size: stableStat.size,
            mtime_ms: stableStat.mtimeMs,
            content_hash: hashUtf8Text(latestContent),
          },
        }
      }

      if (expectedContentHash) {
        const latestContentHash = hashUtf8Text(latestContent)
        if (latestContentHash !== expectedContentHash) {
          return {
            success: false,
            errorCode: 'LOCAL_FILE_CONFLICT',
            conflict: {
              size: stableStat.size,
              mtime_ms: stableStat.mtimeMs,
              content_hash: latestContentHash,
            },
          }
        }
        currentContentHash = latestContentHash
      }
    }

    const markdownWithLocalFormat = applyLocalTextFormat(
      markdownContent,
      detectLocalTextFormat(currentContentResult.content)
    )
    if (markdownWithLocalFormat === currentContentResult.content) {
      return {
        success: true,
        result: {
          size: stableStat.size,
          mtime_ms: stableStat.mtimeMs,
          content_hash: currentContentHash || hashUtf8Text(currentContentResult.content),
        },
      }
    }

    await atomicWriteUtf8FileAsync(absolutePath, markdownWithLocalFormat)
    const updatedStat = await fsPromises.stat(absolutePath)
    return {
      success: true,
      result: {
        size: updatedStat.size,
        mtime_ms: updatedStat.mtimeMs,
        content_hash: hashUtf8Text(markdownWithLocalFormat),
      },
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return { success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' }
    }
    return { success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' }
  }
}

export async function renameLocalFolderEntryAsync(
  mount: LocalFolderNotebookMount,
  input: LocalFolderRenameEntryInput
): Promise<LocalFolderRenameEntryResponse> {
  const currentRelativePath = normalizeRelativePath(input.relative_path)
  if (!currentRelativePath) {
    return {
      success: false,
      errorCode: input.kind === 'folder' ? 'LOCAL_FOLDER_NOT_FOUND' : 'LOCAL_FILE_NOT_FOUND',
    }
  }

  const absoluteCurrentPath = resolvePathUnderRoot(
    mount.mount.root_path,
    currentRelativePath,
    mount.mount.canonical_root_path
  )
  if (!absoluteCurrentPath) {
    return { success: false, errorCode: 'LOCAL_FILE_OUT_OF_ROOT' }
  }

  let currentStat: import('fs').Stats
  try {
    currentStat = await fsPromises.lstat(absoluteCurrentPath)
    if (currentStat.isSymbolicLink()) {
      return {
        success: false,
        errorCode: input.kind === 'folder' ? 'LOCAL_FOLDER_NOT_A_DIRECTORY' : 'LOCAL_FILE_NOT_A_FILE',
      }
    }
    if (input.kind === 'file' && !currentStat.isFile()) {
      return { success: false, errorCode: 'LOCAL_FILE_NOT_A_FILE' }
    }
    if (input.kind === 'folder' && !currentStat.isDirectory()) {
      return { success: false, errorCode: 'LOCAL_FOLDER_NOT_A_DIRECTORY' }
    }
  } catch (error) {
    return { success: false, errorCode: mapErrnoToKindErrorCode(error, input.kind, 'unreadable') }
  }

  const nextNameResult = input.kind === 'file'
    ? normalizeRenameFileName(currentRelativePath, input.new_name)
    : (() => {
      const folderName = input.new_name.trim()
      if (!isValidEntryName(folderName)) {
        return { success: false as const, errorCode: 'LOCAL_FILE_INVALID_NAME' as const }
      }
      return { success: true as const, fileName: folderName }
    })()

  if (!nextNameResult.success) {
    return { success: false, errorCode: nextNameResult.errorCode }
  }

  const currentName = basename(currentRelativePath)
  const nextName = nextNameResult.fileName
  if (currentName === nextName) {
    return { success: true, result: { relative_path: currentRelativePath } }
  }

  const parentRelativePath = getParentRelativePath(currentRelativePath)
  const nextRelativePath = composeChildRelativePath(parentRelativePath, nextName)
  const absoluteNextPath = resolvePathUnderRoot(
    mount.mount.root_path,
    nextRelativePath,
    mount.mount.canonical_root_path
  )
  if (!absoluteNextPath) {
    return { success: false, errorCode: 'LOCAL_FILE_OUT_OF_ROOT' }
  }

  try {
    const existing = await fsPromises.lstat(absoluteNextPath)
    const isSameTarget = isSameRenameTargetPath(
      absoluteCurrentPath,
      absoluteNextPath,
      currentStat,
      existing
    )
    if (!isSameTarget) {
      if (existing.isDirectory()) {
        return { success: false, errorCode: 'LOCAL_FOLDER_ALREADY_EXISTS' }
      }
      return { success: false, errorCode: 'LOCAL_FILE_ALREADY_EXISTS' }
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      if (code === 'EACCES' || code === 'EPERM') {
        return { success: false, errorCode: 'LOCAL_FILE_UNREADABLE' }
      }
      return { success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' }
    }
  }

  try {
    await fsPromises.rename(absoluteCurrentPath, absoluteNextPath)
    // For files, stat the renamed file so the renderer can restore conflict detection meta.
    if (input.kind === 'file') {
      try {
        const newStat = await fsPromises.lstat(absoluteNextPath)
        return { success: true, result: { relative_path: nextRelativePath, mtime_ms: newStat.mtimeMs, size: newStat.size } }
      } catch {
        // Stat failure is non-fatal; return without stat info (conflict detection will be bypassed for one save).
        return { success: true, result: { relative_path: nextRelativePath } }
      }
    }
    return { success: true, result: { relative_path: nextRelativePath } }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return {
        success: false,
        errorCode: input.kind === 'folder' ? 'LOCAL_FOLDER_NOT_FOUND' : 'LOCAL_FILE_NOT_FOUND',
      }
    }
    if (code === 'EEXIST') {
      return { success: false, errorCode: input.kind === 'folder' ? 'LOCAL_FOLDER_ALREADY_EXISTS' : 'LOCAL_FILE_ALREADY_EXISTS' }
    }
    if (code === 'EACCES' || code === 'EPERM') {
      return { success: false, errorCode: 'LOCAL_FILE_UNREADABLE' }
    }
    return { success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' }
  }
}

export async function createLocalFolderFileAsync(
  mount: LocalFolderNotebookMount,
  parentRelativePath: string | null,
  fileNameInput: string
): Promise<LocalFolderCreateFileResponse> {
  const parentDirectory = await resolveExistingDirectoryAsync(
    mount.mount.root_path,
    parentRelativePath,
    mount.mount.canonical_root_path
  )
  if (!parentDirectory.success) {
    return { success: false, errorCode: parentDirectory.errorCode }
  }

  const normalizedFileName = normalizeCreateFileName(fileNameInput)
  if (!normalizedFileName.success) {
    return { success: false, errorCode: normalizedFileName.errorCode }
  }

  const relativePath = composeChildRelativePath(parentDirectory.relativePath || null, normalizedFileName.fileName)
  const absolutePath = resolvePathUnderRoot(
    mount.mount.root_path,
    relativePath,
    mount.mount.canonical_root_path
  )
  if (!absolutePath) {
    return { success: false, errorCode: 'LOCAL_FILE_OUT_OF_ROOT' }
  }

  try {
    const existing = await fsPromises.lstat(absolutePath)
    if (existing.isDirectory()) {
      return { success: false, errorCode: 'LOCAL_FOLDER_ALREADY_EXISTS' }
    }
    return { success: false, errorCode: 'LOCAL_FILE_ALREADY_EXISTS' }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      if (code === 'EACCES' || code === 'EPERM') {
        return { success: false, errorCode: 'LOCAL_FILE_UNREADABLE' }
      }
      return { success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' }
    }
  }

  try {
    await fsPromises.writeFile(absolutePath, '', { encoding: 'utf-8', flag: 'wx' })
    return { success: true, result: { relative_path: relativePath } }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code === 'EEXIST') {
      return { success: false, errorCode: 'LOCAL_FILE_ALREADY_EXISTS' }
    }
    if (code === 'EACCES' || code === 'EPERM') {
      return { success: false, errorCode: 'LOCAL_FILE_UNREADABLE' }
    }
    return { success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' }
  }
}

export async function createLocalFolderAsync(
  mount: LocalFolderNotebookMount,
  parentRelativePath: string | null,
  folderNameInput: string
): Promise<LocalFolderCreateFolderResponse> {
  const parentDirectory = await resolveExistingDirectoryAsync(
    mount.mount.root_path,
    parentRelativePath,
    mount.mount.canonical_root_path
  )
  if (!parentDirectory.success) {
    return { success: false, errorCode: parentDirectory.errorCode }
  }

  const nextDepth = getRelativeFolderDepth(parentDirectory.relativePath || null) + 1
  if (nextDepth > MAX_CREATE_FOLDER_LEVEL) {
    return { success: false, errorCode: 'LOCAL_FOLDER_DEPTH_LIMIT' }
  }

  const folderName = folderNameInput.trim()
  if (!isValidEntryName(folderName)) {
    return { success: false, errorCode: 'LOCAL_FILE_INVALID_NAME' }
  }

  const relativePath = composeChildRelativePath(parentDirectory.relativePath || null, folderName)
  const absolutePath = resolvePathUnderRoot(
    mount.mount.root_path,
    relativePath,
    mount.mount.canonical_root_path
  )
  if (!absolutePath) {
    return { success: false, errorCode: 'LOCAL_FILE_OUT_OF_ROOT' }
  }

  try {
    await fsPromises.mkdir(absolutePath, { recursive: false })
    return { success: true, result: { relative_path: relativePath } }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code === 'EEXIST') {
      return { success: false, errorCode: 'LOCAL_FOLDER_ALREADY_EXISTS' }
    }
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return { success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' }
    }
    if (code === 'EACCES' || code === 'EPERM') {
      return { success: false, errorCode: 'LOCAL_FILE_UNREADABLE' }
    }
    return { success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' }
  }
}

export async function resolveLocalFolderDeleteTargetAsync(
  mount: LocalFolderNotebookMount,
  input: LocalFolderDeleteEntryInput
): Promise<{ success: true; result: LocalFolderDeleteTarget } | { success: false; errorCode: LocalFolderFileErrorCode }> {
  const relativePath = normalizeRelativePath(input.relative_path)
  const absolutePath = resolvePathUnderRoot(
    mount.mount.root_path,
    relativePath,
    mount.mount.canonical_root_path
  )
  if (!absolutePath) {
    return { success: false, errorCode: 'LOCAL_FILE_OUT_OF_ROOT' }
  }

  try {
    const stat = await fsPromises.lstat(absolutePath)
    if (stat.isSymbolicLink()) {
      return {
        success: false,
        errorCode: input.kind === 'folder' ? 'LOCAL_FOLDER_NOT_A_DIRECTORY' : 'LOCAL_FILE_NOT_A_FILE',
      }
    }
    if (input.kind === 'file' && !stat.isFile()) {
      return { success: false, errorCode: 'LOCAL_FILE_NOT_A_FILE' }
    }
    if (input.kind === 'folder' && !stat.isDirectory()) {
      return { success: false, errorCode: 'LOCAL_FOLDER_NOT_A_DIRECTORY' }
    }
    return {
      success: true,
      result: { absolute_path: absolutePath, relative_path: relativePath, kind: input.kind },
    }
  } catch (error) {
    return { success: false, errorCode: mapErrnoToKindErrorCode(error, input.kind, 'unreadable') }
  }
}
