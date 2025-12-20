/**
 * 文件类型分类工具
 */

export type FileCategory = 'image' | 'video' | 'audio' | 'document' | 'other'

const FILE_CATEGORIES: Record<string, FileCategory> = {
  // 图片
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  bmp: 'image',
  ico: 'image',

  // 视频
  mp4: 'video',
  webm: 'video',
  mov: 'video',
  avi: 'video',
  mkv: 'video',

  // 音频
  mp3: 'audio',
  wav: 'audio',
  ogg: 'audio',
  flac: 'audio',
  m4a: 'audio',
  aac: 'audio',

  // 文档
  pdf: 'document',
  doc: 'document',
  docx: 'document',
  xls: 'document',
  xlsx: 'document',
  ppt: 'document',
  pptx: 'document',
  txt: 'document',
  md: 'document',
}

/**
 * 获取文件扩展名
 */
export function getFileExtension(fileName: string): string {
  const parts = fileName.split('.')
  return parts.length > 1 ? parts.pop()!.toLowerCase() : ''
}

/**
 * 根据文件名获取文件类型
 */
export function getFileCategory(fileName: string): FileCategory {
  const ext = getFileExtension(fileName)
  return FILE_CATEGORIES[ext] || 'other'
}

/**
 * 根据 MIME 类型获取文件类型
 */
export function getFileCategoryByMime(mimeType: string): FileCategory {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  if (mimeType === 'application/pdf') return 'document'
  if (mimeType.includes('word') || mimeType.includes('document')) return 'document'
  if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) return 'document'
  if (mimeType.includes('powerpoint') || mimeType.includes('presentation')) return 'document'
  return 'other'
}

/**
 * 根据 MIME 类型获取文件扩展名
 */
export function getExtensionFromMime(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    // 图片
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
    'image/x-icon': 'ico',
    // 视频
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'video/x-msvideo': 'avi',
    'video/x-matroska': 'mkv',
    // 音频
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/flac': 'flac',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    // 文档
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'text/plain': 'txt',
    'text/markdown': 'md',
  }

  // 精确匹配
  if (mimeToExt[mimeType]) {
    return mimeToExt[mimeType]
  }

  // 前缀匹配作为后备
  if (mimeType.startsWith('image/')) return 'png'
  if (mimeType.startsWith('video/')) return 'mp4'
  if (mimeType.startsWith('audio/')) return 'mp3'
  if (mimeType.startsWith('text/')) return 'txt'

  return 'bin' // 未知类型使用 bin 作为默认扩展名
}
