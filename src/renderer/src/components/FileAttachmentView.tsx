import { NodeViewWrapper, NodeViewProps } from '@tiptap/react'
import { ReactNode, useState, useRef, useEffect } from 'react'
import { useTranslations } from '../i18n'

interface FileAttrs {
  src: string
  name: string
  size?: number
  type?: string
}

// SVG 图标组件 (基于 Lucide Icons - MIT License)
const FileIcons = {
  // 通用文件图标 (lucide: file)
  file: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </svg>
  ),
  // 图片 (lucide: image)
  image: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  ),
  // 视频 (lucide: file-video)
  video: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="m10 11 5 3-5 3v-6Z" />
    </svg>
  ),
  // 音频 (lucide: file-audio)
  audio: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <circle cx="10" cy="16" r="2" />
      <path d="m12 12v4" />
      <path d="M12 12a2 2 0 0 1 2 2" />
    </svg>
  ),
  // PDF (lucide: file-text)
  pdf: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </svg>
  ),
  // 文档 Word (lucide: file-text)
  document: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </svg>
  ),
  // 表格 Excel (lucide: file-spreadsheet)
  spreadsheet: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M8 13h2" />
      <path d="M14 13h2" />
      <path d="M8 17h2" />
      <path d="M14 17h2" />
    </svg>
  ),
  // 演示文稿 PPT (lucide: presentation)
  presentation: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h20" />
      <path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3" />
      <path d="m7 21 5-5 5 5" />
    </svg>
  ),
  // 压缩包 (lucide: file-archive)
  archive: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10 12v4h4v-4z" />
      <path d="M10 12V9h4" />
    </svg>
  ),
  // 代码 (lucide: file-code)
  code: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="m10 13-2 2 2 2" />
      <path d="m14 17 2-2-2-2" />
    </svg>
  ),
  // 文本 (lucide: file-text)
  text: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </svg>
  ),
}

// 根据文件类型返回对应图标
function getFileIcon(type?: string, name?: string): ReactNode {
  const extension = name?.split('.').pop()?.toLowerCase()

  // 根据 MIME type 或扩展名判断
  if (type?.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(extension || '')) {
    return FileIcons.image
  }
  if (type?.startsWith('video/') || ['mp4', 'webm', 'mov', 'avi'].includes(extension || '')) {
    return FileIcons.video
  }
  if (type?.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'flac'].includes(extension || '')) {
    return FileIcons.audio
  }
  if (type === 'application/pdf' || extension === 'pdf') {
    return FileIcons.pdf
  }
  if (['doc', 'docx'].includes(extension || '')) {
    return FileIcons.document
  }
  if (['xls', 'xlsx'].includes(extension || '')) {
    return FileIcons.spreadsheet
  }
  if (['ppt', 'pptx'].includes(extension || '')) {
    return FileIcons.presentation
  }
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(extension || '')) {
    return FileIcons.archive
  }
  if (['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c', 'go', 'rs'].includes(extension || '')) {
    return FileIcons.code
  }
  if (['md', 'txt'].includes(extension || '')) {
    return FileIcons.text
  }
  return FileIcons.file
}

// 格式化文件大小
function formatFileSize(bytes?: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export function FileAttachmentView({ node, selected }: NodeViewProps) {
  const attrs = node.attrs as FileAttrs
  const icon = getFileIcon(attrs.type, attrs.name)
  const sizeText = formatFileSize(attrs.size)
  const t = useTranslations()

  // 右键菜单状态
  const [showContextMenu, setShowContextMenu] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 })
  const menuRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowContextMenu(false)
      }
    }
    if (showContextMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showContextMenu])

  const handleOpen = async () => {
    if (!attrs.src) return

    try {
      // 使用 Electron API 用系统程序打开文件
      await window.electron.attachment.open(attrs.src)
    } catch (error) {
      console.error('Failed to open file:', error)
      alert(`无法打开文件：${attrs.name}\n文件可能已被移动或删除`)
    }
  }

  const handleOpenFromMenu = () => {
    setShowContextMenu(false)
    handleOpen()
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setMenuPosition({ x: e.clientX, y: e.clientY })
    setShowContextMenu(true)
  }

  const handleShowInFolder = async () => {
    setShowContextMenu(false)
    if (!attrs.src) return

    try {
      await window.electron.attachment.showInFolder(attrs.src)
    } catch (error) {
      console.error('Failed to show in folder:', error)
    }
  }

  // Tooltip 内容
  const tooltipText = sizeText ? `${attrs.name}\n${sizeText}` : attrs.name

  return (
    <NodeViewWrapper as="span" className={`file-attachment-inline ${selected ? 'selected' : ''}`}>
      <span
        className="file-attachment-chip"
        onClick={handleOpen}
        onContextMenu={handleContextMenu}
        title={tooltipText}
      >
        <span className="file-chip-icon">{icon}</span>
        <span className="file-chip-name">{attrs.name}</span>
      </span>

      {/* 右键菜单 */}
      {showContextMenu && (
        <div
          ref={menuRef}
          className="file-context-menu"
          style={{
            position: 'fixed',
            left: menuPosition.x,
            top: menuPosition.y,
            zIndex: 9999
          }}
        >
          <button onClick={handleOpenFromMenu}>
            {t.media.openFile}
          </button>
          <button onClick={handleShowInFolder}>
            {t.media.showInFolder}
          </button>
        </div>
      )}
    </NodeViewWrapper>
  )
}
