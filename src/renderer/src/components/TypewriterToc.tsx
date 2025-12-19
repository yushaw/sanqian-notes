/**
 * TypewriterToc - 打字机模式大纲组件
 *
 * 当屏幕宽度足够时，在右侧显示文档大纲
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import type { Editor } from '@tiptap/react'
import { useTranslations } from '../i18n'

export interface TocItem {
  id: string
  level: number
  text: string
  pos: number
}

interface TypewriterTocProps {
  editor: Editor | null
}

export function TypewriterToc({ editor }: TypewriterTocProps) {
  const t = useTranslations()
  const [items, setItems] = useState<TocItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [isVisible, setIsVisible] = useState(false)
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // 提取标题
  const extractHeadings = useCallback(() => {
    if (!editor) return []

    const headings: TocItem[] = []
    const { doc } = editor.state

    doc.descendants((node, pos) => {
      if (node.type.name === 'heading' && node.attrs.level <= 3) {
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

  // 监听编辑器内容变化
  useEffect(() => {
    if (!editor) return

    const updateToc = () => {
      setItems(extractHeadings())
    }

    updateToc()
    editor.on('update', updateToc)

    return () => {
      editor.off('update', updateToc)
    }
  }, [editor, extractHeadings])

  // 根据光标位置更新当前章节高亮
  useEffect(() => {
    if (!editor || items.length === 0) return

    const updateActiveHeading = () => {
      const { from } = editor.state.selection

      // 找到光标位置之前最近的标题
      let activeHeading: TocItem | null = null
      for (const item of items) {
        if (item.pos <= from) {
          activeHeading = item
        } else {
          break
        }
      }

      setActiveId(activeHeading?.id ?? null)
    }

    updateActiveHeading()
    editor.on('selectionUpdate', updateActiveHeading)

    return () => {
      editor.off('selectionUpdate', updateActiveHeading)
    }
  }, [editor, items])

  // 点击跳转到标题
  const handleClick = (item: TocItem) => {
    if (!editor) return

    // 只设置光标位置，滚动由 TypewriterMode 的 scrollToCursor 处理
    editor.chain().focus().setTextSelection(item.pos + 1).run()
  }

  // 阻止点击时编辑器失焦
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
  }

  // 重置隐藏计时器
  const resetHideTimer = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current)
    }
    hideTimeoutRef.current = setTimeout(() => {
      setIsVisible(false)
    }, 5000)
  }, [])

  // 鼠标进入触发区域
  const handleMouseEnter = useCallback(() => {
    setIsVisible(true)
    resetHideTimer()
  }, [resetHideTimer])

  // 鼠标在区域内移动
  const handleMouseMove = useCallback(() => {
    if (isVisible) {
      resetHideTimer()
    }
  }, [isVisible, resetHideTimer])

  // 鼠标离开触发区域
  const handleMouseLeave = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current)
    }
    setIsVisible(false)
  }, [])

  // 清理计时器
  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current)
      }
    }
  }, [])

  if (items.length === 0) {
    return null
  }

  return (
    <div
      ref={containerRef}
      className={`typewriter-toc ${isVisible ? 'visible' : ''}`}
      onMouseDown={handleMouseDown}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <div className="typewriter-toc-list">
        <div className="typewriter-toc-items">
          {items.map((item) => (
            <button
              key={item.id}
              className={`typewriter-toc-item typewriter-toc-level-${item.level} ${activeId === item.id ? 'active' : ''}`}
              onClick={() => handleClick(item)}
            >
              {item.text || t.media.emptyHeading}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
