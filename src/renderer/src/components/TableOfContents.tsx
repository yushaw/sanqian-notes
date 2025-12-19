import { useEffect, useState, useCallback } from 'react'
import type { Editor } from '@tiptap/react'
import { useI18n } from '../i18n/context'

export interface TocItem {
  id: string
  level: number
  text: string
  pos: number
}

interface TableOfContentsProps {
  editor: Editor | null
  className?: string
}

export function TableOfContents({ editor, className = '' }: TableOfContentsProps) {
  const { t } = useI18n()
  const [items, setItems] = useState<TocItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  // Extract headings from editor content
  const extractHeadings = useCallback(() => {
    if (!editor) return []

    const headings: TocItem[] = []
    const { doc } = editor.state

    doc.descendants((node, pos) => {
      if (node.type.name === 'heading') {
        const id = node.attrs.blockId || `heading-${pos}`
        headings.push({
          id,
          level: node.attrs.level,
          text: node.textContent,
          pos,
        })
      }
    })

    return headings
  }, [editor])

  // Listen to editor content changes
  useEffect(() => {
    if (!editor) return

    const updateToc = () => {
      setItems(extractHeadings())
    }

    // Initialize
    updateToc()

    // Listen to content updates
    editor.on('update', updateToc)

    return () => {
      editor.off('update', updateToc)
    }
  }, [editor, extractHeadings])

  // Click to jump to heading
  const handleClick = (item: TocItem) => {
    if (!editor) return

    // Set selection to heading position
    editor.chain().focus().setTextSelection(item.pos + 1).run()

    // Scroll into view
    const editorElement = document.querySelector('.zen-editor-content .ProseMirror')
    if (editorElement) {
      const headings = editorElement.querySelectorAll('h1, h2, h3, h4, h5, h6')
      for (const heading of headings) {
        if (heading.textContent === item.text) {
          heading.scrollIntoView({ behavior: 'smooth', block: 'center' })
          break
        }
      }
    }

    setActiveId(item.id)
  }

  if (items.length === 0) {
    return null
  }

  return (
    <div className={`toc-container ${className}`}>
      <div className="toc-header">{t.toc.title}</div>
      <div className="toc-list">
        {items.map((item) => (
          <button
            key={item.id}
            className={`toc-item toc-level-${item.level} ${activeId === item.id ? 'active' : ''}`}
            onClick={() => handleClick(item)}
            style={{ paddingLeft: `${(item.level - 1) * 12 + 8}px` }}
          >
            {item.text || t.media.emptyHeading}
          </button>
        ))}
      </div>
    </div>
  )
}
