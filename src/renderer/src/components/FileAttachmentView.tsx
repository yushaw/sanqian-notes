import { NodeViewWrapper, NodeViewProps } from '@tiptap/react'

interface FileAttrs {
  src: string
  name: string
  size?: number
  type?: string
}

// 根据文件类型返回对应图标
function getFileIcon(type?: string, name?: string): string {
  const extension = name?.split('.').pop()?.toLowerCase()

  // 根据 MIME type 或扩展名判断
  if (type?.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(extension || '')) {
    return '🖼️'
  }
  if (type?.startsWith('video/') || ['mp4', 'webm', 'mov', 'avi'].includes(extension || '')) {
    return '🎬'
  }
  if (type?.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'flac'].includes(extension || '')) {
    return '🎵'
  }
  if (type === 'application/pdf' || extension === 'pdf') {
    return '📄'
  }
  if (['doc', 'docx'].includes(extension || '')) {
    return '📝'
  }
  if (['xls', 'xlsx'].includes(extension || '')) {
    return '📊'
  }
  if (['ppt', 'pptx'].includes(extension || '')) {
    return '📽️'
  }
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(extension || '')) {
    return '📦'
  }
  if (['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c', 'go', 'rs'].includes(extension || '')) {
    return '💻'
  }
  if (['md', 'txt'].includes(extension || '')) {
    return '📃'
  }
  return '📎'
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

  const handleClick = () => {
    // 在 Electron 中打开文件
    if (attrs.src) {
      window.open(attrs.src, '_blank')
    }
  }

  return (
    <NodeViewWrapper className={`file-attachment-wrapper ${selected ? 'selected' : ''}`}>
      <div className="file-attachment" onClick={handleClick}>
        <div className="file-icon">{icon}</div>
        <div className="file-info">
          <div className="file-name">{attrs.name}</div>
          {sizeText && <div className="file-size">{sizeText}</div>}
        </div>
        <div className="file-download">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </div>
      </div>
    </NodeViewWrapper>
  )
}
