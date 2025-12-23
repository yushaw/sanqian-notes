import { useEffect, useRef, useCallback, useState } from 'react'
import { Editor } from '@tiptap/react'
import { useTranslations } from '../i18n'
import { shortcuts } from '../utils/shortcuts'

interface ContextMenuPosition {
  x: number
  y: number
}

interface EditorContextMenuProps {
  editor: Editor | null
  position: ContextMenuPosition | null
  onClose: () => void
  hasSelection: boolean
}

// SVG 图标
const Icons = {
  table: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="3" y1="15" x2="21" y2="15" />
      <line x1="9" y1="3" x2="9" y2="21" />
      <line x1="15" y1="3" x2="15" y2="21" />
    </svg>
  ),
  rowAdd: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M3 12h18M3 18h18" />
      <circle cx="19" cy="19" r="4" fill="var(--color-card)" />
      <line x1="19" y1="17" x2="19" y2="21" />
      <line x1="17" y1="19" x2="21" y2="19" />
    </svg>
  ),
  rowDelete: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M3 12h18M3 18h18" />
      <circle cx="19" cy="19" r="4" fill="var(--color-card)" />
      <line x1="17" y1="19" x2="21" y2="19" />
    </svg>
  ),
  colAdd: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3v18M12 3v18M18 3v18" />
      <circle cx="19" cy="19" r="4" fill="var(--color-card)" />
      <line x1="19" y1="17" x2="19" y2="21" />
      <line x1="17" y1="19" x2="21" y2="19" />
    </svg>
  ),
  colDelete: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3v18M12 3v18M18 3v18" />
      <circle cx="19" cy="19" r="4" fill="var(--color-card)" />
      <line x1="17" y1="19" x2="21" y2="19" />
    </svg>
  ),
  trash: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  ),
  cut: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" />
      <line x1="14.47" y1="14.48" x2="20" y2="20" />
      <line x1="8.12" y1="8.12" x2="12" y2="12" />
    </svg>
  ),
  copy: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  ),
  paste: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
    </svg>
  ),
  bold: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
      <path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
    </svg>
  ),
  italic: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="4" x2="10" y2="4" />
      <line x1="14" y1="20" x2="5" y2="20" />
      <line x1="15" y1="4" x2="9" y2="20" />
    </svg>
  ),
  underline: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3v7a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3" />
      <line x1="4" y1="21" x2="20" y2="21" />
    </svg>
  ),
  strikethrough: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 4H9a3 3 0 0 0-2.83 4" />
      <path d="M14 12a4 4 0 0 1 0 8H6" />
      <line x1="4" y1="12" x2="20" y2="12" />
    </svg>
  ),
  highlight: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 11-6 6v3h9l3-3" />
      <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
    </svg>
  ),
  chevronRight: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  ),
  heading: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12h8" />
      <path d="M4 18V6" />
      <path d="M12 18V6" />
      <path d="M17 10v8" />
      <path d="M21 10v8" />
      <path d="M17 14h4" />
    </svg>
  ),
  paragraph: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 4v16" />
      <path d="M17 4v16" />
      <path d="M19 4H9.5a4.5 4.5 0 0 0 0 9H13" />
    </svg>
  ),
  plus: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
}

// 插入项配置 - 来自斜杠命令中常用的
const getInsertItems = (t: ReturnType<typeof useTranslations>) => [
  { id: 'bulletList', label: t.contextMenu.bulletList, icon: '•', insert: (editor: Editor) => editor.chain().focus().toggleBulletList().run() },
  { id: 'numberedList', label: t.contextMenu.numberedList, icon: '1.', insert: (editor: Editor) => editor.chain().focus().toggleOrderedList().run() },
  { id: 'taskList', label: t.contextMenu.taskList, icon: '☑', insert: (editor: Editor) => editor.chain().focus().toggleTaskList().run() },
  { id: 'quote', label: t.contextMenu.quote, icon: '"', insert: (editor: Editor) => editor.chain().focus().toggleBlockquote().run() },
  { id: 'codeBlock', label: t.contextMenu.codeBlock, icon: '</>', insert: (editor: Editor) => editor.chain().focus().toggleCodeBlock().run() },
  { id: 'divider', label: t.contextMenu.divider, icon: '—', insert: (editor: Editor) => editor.chain().focus().setHorizontalRule().run() },
  { id: 'table', label: t.contextMenu.table, icon: '▦', insert: (editor: Editor) => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { id: 'callout', label: t.contextMenu.callout, icon: 'ℹ', insert: (editor: Editor) => editor.chain().focus().setCallout({ type: 'note' }).run() },
]

export function EditorContextMenu({ editor, position, onClose, hasSelection }: EditorContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const insertSubmenuRef = useRef<HTMLDivElement>(null)
  const tableSubmenuRef = useRef<HTMLDivElement>(null)
  const t = useTranslations()
  const insertItems = getInsertItems(t)
  const [showInsertSubmenu, setShowInsertSubmenu] = useState(false)
  const [insertSubmenuPosition, setInsertSubmenuPosition] = useState({ top: 0, left: 0 })
  const [showTableSubmenu, setShowTableSubmenu] = useState(false)
  const [tableSubmenuPosition, setTableSubmenuPosition] = useState({ top: 0, left: 0 })
  const closeTimeoutRef = useRef<number | null>(null)

  // Check if cursor is in a table
  const isInTable = editor?.isActive('table') ?? false

  // 重置子菜单状态当菜单关闭或位置变化时
  useEffect(() => {
    setShowInsertSubmenu(false)
    setShowTableSubmenu(false)
  }, [position])

  // 清除关闭延时
  const clearCloseTimeout = useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current)
      closeTimeoutRef.current = null
    }
  }, [])

  // 延迟关闭插入子菜单
  const scheduleCloseInsertSubmenu = useCallback(() => {
    clearCloseTimeout()
    closeTimeoutRef.current = window.setTimeout(() => {
      setShowInsertSubmenu(false)
    }, 150)
  }, [clearCloseTimeout])

  // 保持插入子菜单打开
  const keepInsertSubmenuOpen = useCallback(() => {
    clearCloseTimeout()
    setShowInsertSubmenu(true)
  }, [clearCloseTimeout])

  // 延迟关闭表格子菜单
  const scheduleCloseTableSubmenu = useCallback(() => {
    clearCloseTimeout()
    closeTimeoutRef.current = window.setTimeout(() => {
      setShowTableSubmenu(false)
    }, 150)
  }, [clearCloseTimeout])

  // 保持表格子菜单打开
  const keepTableSubmenuOpen = useCallback(() => {
    clearCloseTimeout()
    setShowTableSubmenu(true)
  }, [clearCloseTimeout])

  // 点击外部关闭菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      const isInsideMenu = menuRef.current?.contains(target)
      const isInsideInsertSubmenu = insertSubmenuRef.current?.contains(target)
      const isInsideTableSubmenu = tableSubmenuRef.current?.contains(target)

      if (!isInsideMenu && !isInsideInsertSubmenu && !isInsideTableSubmenu) {
        onClose()
      }
    }

    const handleScroll = () => {
      onClose()
    }

    if (position) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('scroll', handleScroll, true)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('scroll', handleScroll, true)
    }
  }, [position, onClose])

  // ESC 关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    if (position) {
      document.addEventListener('keydown', handleKeyDown)
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [position, onClose])

  // 剪切
  const handleCut = useCallback(() => {
    if (!editor) return
    document.execCommand('cut')
    onClose()
  }, [editor, onClose])

  // 复制
  const handleCopy = useCallback(() => {
    if (!editor) return
    document.execCommand('copy')
    onClose()
  }, [editor, onClose])

  // 粘贴
  const handlePaste = useCallback(async () => {
    if (!editor) return
    try {
      const text = await navigator.clipboard.readText()
      editor.chain().focus().insertContent(text).run()
    } catch {
      document.execCommand('paste')
    }
    onClose()
  }, [editor, onClose])

  // 加粗
  const handleBold = useCallback(() => {
    if (!editor) return
    editor.chain().focus().toggleBold().run()
    onClose()
  }, [editor, onClose])

  // 斜体
  const handleItalic = useCallback(() => {
    if (!editor) return
    editor.chain().focus().toggleItalic().run()
    onClose()
  }, [editor, onClose])

  // 下划线
  const handleUnderline = useCallback(() => {
    if (!editor) return
    editor.chain().focus().toggleUnderline().run()
    onClose()
  }, [editor, onClose])

  // 删除线
  const handleStrikethrough = useCallback(() => {
    if (!editor) return
    editor.chain().focus().toggleStrike().run()
    onClose()
  }, [editor, onClose])

  // 高亮
  const handleHighlight = useCallback(() => {
    if (!editor) return
    editor.chain().focus().toggleHighlight().run()
    onClose()
  }, [editor, onClose])

  // 设置标题级别
  const handleHeading = useCallback((level: 1 | 2 | 3 | 4) => {
    if (!editor) return
    editor.chain().focus().toggleHeading({ level }).run()
    onClose()
  }, [editor, onClose])

  // 设置为正文
  const handleParagraph = useCallback(() => {
    if (!editor) return
    editor.chain().focus().setParagraph().run()
    onClose()
  }, [editor, onClose])

  // 显示插入子菜单
  const handleShowInsertSubmenu = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const submenuWidth = 140
    const submenuHeight = insertItems.length * 32 + 8

    let left = rect.right + 4
    if (rect.right + submenuWidth + 10 > window.innerWidth) {
      left = rect.left - submenuWidth - 4
    }

    let top = rect.top
    if (rect.top + submenuHeight > window.innerHeight) {
      top = window.innerHeight - submenuHeight - 10
    }

    setInsertSubmenuPosition({ top, left })
    setShowInsertSubmenu(true)
  }, [])

  // 插入内容
  const handleInsert = useCallback((insertFn: (editor: Editor) => void) => {
    if (!editor) return
    insertFn(editor)
    onClose()
  }, [editor, onClose])

  // 显示表格子菜单
  const handleShowTableSubmenu = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const submenuWidth = 160
    const submenuHeight = 7 * 32 + 8

    let left = rect.right + 4
    if (rect.right + submenuWidth + 10 > window.innerWidth) {
      left = rect.left - submenuWidth - 4
    }

    let top = rect.top
    if (rect.top + submenuHeight > window.innerHeight) {
      top = window.innerHeight - submenuHeight - 10
    }

    setTableSubmenuPosition({ top, left })
    setShowTableSubmenu(true)
  }, [])

  // 表格操作
  const tableOperations = [
    { id: 'addRowBefore', label: t.contextMenu.addRowBefore, icon: Icons.rowAdd, action: () => editor?.chain().focus().addRowBefore().run() },
    { id: 'addRowAfter', label: t.contextMenu.addRowAfter, icon: Icons.rowAdd, action: () => editor?.chain().focus().addRowAfter().run() },
    { id: 'deleteRow', label: t.contextMenu.deleteRow, icon: Icons.rowDelete, action: () => editor?.chain().focus().deleteRow().run(), danger: true },
    { id: 'divider1', divider: true },
    { id: 'addColumnBefore', label: t.contextMenu.addColumnBefore, icon: Icons.colAdd, action: () => editor?.chain().focus().addColumnBefore().run() },
    { id: 'addColumnAfter', label: t.contextMenu.addColumnAfter, icon: Icons.colAdd, action: () => editor?.chain().focus().addColumnAfter().run() },
    { id: 'deleteColumn', label: t.contextMenu.deleteColumn, icon: Icons.colDelete, action: () => editor?.chain().focus().deleteColumn().run(), danger: true },
    { id: 'divider2', divider: true },
    { id: 'deleteTable', label: t.contextMenu.deleteTable, icon: Icons.trash, action: () => editor?.chain().focus().deleteTable().run(), danger: true },
  ]

  const handleTableOperation = useCallback((action: () => void) => {
    action()
    onClose()
  }, [onClose])

  if (!position || !editor) return null

  // 调整菜单位置，确保不超出视口
  const adjustedPosition = { ...position }
  const menuWidth = 220
  // 有选中: 编辑行(40) + 段落行(40) + 格式行(40) + 链接(32) + 插入(32) + 分隔线 ≈ 210
  // 无选中: 编辑行(40) + 段落行(40) + 插入(32) + 分隔线 ≈ 140
  const menuHeight = hasSelection ? 210 : 140

  if (adjustedPosition.x + menuWidth > window.innerWidth) {
    adjustedPosition.x = window.innerWidth - menuWidth - 10
  }
  if (adjustedPosition.y + menuHeight > window.innerHeight) {
    adjustedPosition.y = window.innerHeight - menuHeight - 10
  }

  return (
    <>
      <div
        ref={menuRef}
        className="editor-context-menu"
        style={{
          position: 'fixed',
          left: adjustedPosition.x,
          top: adjustedPosition.y,
          zIndex: 9999
        }}
      >
        {/* 编辑操作组 - 横向排列 */}
        <div className="context-menu-group context-menu-edit-row">
          {hasSelection && (
            <>
              <button className="context-menu-icon-btn" onClick={handleCut} title={t.contextMenu.cut}>
                {Icons.cut}
              </button>
              <button className="context-menu-icon-btn" onClick={handleCopy} title={t.contextMenu.copy}>
                {Icons.copy}
              </button>
            </>
          )}
          <button className="context-menu-icon-btn" onClick={handlePaste} title={t.contextMenu.paste}>
            {Icons.paste}
          </button>
        </div>

        {/* 段落格式组 - 横向排列 */}
        <div className="context-menu-group context-menu-heading-row">
          <button
            className={`context-menu-heading-btn ${editor.isActive('paragraph') && !editor.isActive('heading') ? 'active' : ''}`}
            onClick={handleParagraph}
            title={t.contextMenu.paragraph}
          >
            P
          </button>
          <button
            className={`context-menu-heading-btn ${editor.isActive('heading', { level: 1 }) ? 'active' : ''}`}
            onClick={() => handleHeading(1)}
            title={t.toolbar.heading1}
          >
            H1
          </button>
          <button
            className={`context-menu-heading-btn ${editor.isActive('heading', { level: 2 }) ? 'active' : ''}`}
            onClick={() => handleHeading(2)}
            title={t.toolbar.heading2}
          >
            H2
          </button>
          <button
            className={`context-menu-heading-btn ${editor.isActive('heading', { level: 3 }) ? 'active' : ''}`}
            onClick={() => handleHeading(3)}
            title={t.toolbar.heading3}
          >
            H3
          </button>
          <button
            className={`context-menu-heading-btn ${editor.isActive('heading', { level: 4 }) ? 'active' : ''}`}
            onClick={() => handleHeading(4)}
            title="H4"
          >
            H4
          </button>
        </div>

        {/* 文本格式组 - 仅选中文本时显示，横向排列 */}
        {hasSelection && (
          <div className="context-menu-group context-menu-format-row">
            <button
              className={`context-menu-icon-btn ${editor.isActive('bold') ? 'active' : ''}`}
              onClick={handleBold}
              title={`${t.toolbar.bold} (${shortcuts.bold})`}
            >
              {Icons.bold}
            </button>
            <button
              className={`context-menu-icon-btn ${editor.isActive('italic') ? 'active' : ''}`}
              onClick={handleItalic}
              title={`${t.toolbar.italic} (${shortcuts.italic})`}
            >
              {Icons.italic}
            </button>
            <button
              className={`context-menu-icon-btn ${editor.isActive('underline') ? 'active' : ''}`}
              onClick={handleUnderline}
              title={`${t.toolbar.underline} (${shortcuts.underline})`}
            >
              {Icons.underline}
            </button>
            <button
              className={`context-menu-icon-btn ${editor.isActive('strike') ? 'active' : ''}`}
              onClick={handleStrikethrough}
              title={`${t.toolbar.strikethrough} (${shortcuts.strike})`}
            >
              {Icons.strikethrough}
            </button>
            <button
              className={`context-menu-icon-btn ${editor.isActive('highlight') ? 'active' : ''}`}
              onClick={handleHighlight}
              title={`${t.toolbar.highlight} (${shortcuts.highlight})`}
            >
              {Icons.highlight}
            </button>
          </div>
        )}

        {/* 表格操作组 - 仅在表格内显示 */}
        {isInTable && (
          <div className="context-menu-group">
            <button
              className="context-menu-item"
              onMouseEnter={handleShowTableSubmenu}
              onMouseLeave={scheduleCloseTableSubmenu}
            >
              <span className="context-menu-icon">{Icons.table}</span>
              <span className="context-menu-label">{t.contextMenu.tableOperations}</span>
              <span className="context-menu-arrow">{Icons.chevronRight}</span>
            </button>
          </div>
        )}

        {/* 插入组 */}
        <div className="context-menu-group">
          <button
            className="context-menu-item"
            onMouseEnter={handleShowInsertSubmenu}
            onMouseLeave={scheduleCloseInsertSubmenu}
          >
            <span className="context-menu-icon">{Icons.plus}</span>
            <span className="context-menu-label">{t.contextMenu.insert}</span>
            <span className="context-menu-arrow">{Icons.chevronRight}</span>
          </button>
        </div>
      </div>

      {/* 表格操作子菜单 */}
      {showTableSubmenu && (
        <div
          ref={tableSubmenuRef}
          className="editor-context-menu editor-context-submenu"
          style={{
            position: 'fixed',
            left: tableSubmenuPosition.left,
            top: tableSubmenuPosition.top,
            zIndex: 10000
          }}
          onMouseEnter={keepTableSubmenuOpen}
          onMouseLeave={scheduleCloseTableSubmenu}
        >
          {tableOperations.map((item) => {
            if (item.divider) {
              return <div key={item.id} className="context-menu-divider" />
            }
            return (
              <button
                key={item.id}
                className={`context-menu-item ${item.danger ? 'context-menu-item-danger' : ''}`}
                onClick={() => handleTableOperation(item.action!)}
              >
                <span className="context-menu-icon">{item.icon}</span>
                <span className="context-menu-label">{item.label}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* 插入子菜单 */}
      {showInsertSubmenu && (
        <div
          ref={insertSubmenuRef}
          className="editor-context-menu editor-context-submenu"
          style={{
            position: 'fixed',
            left: insertSubmenuPosition.left,
            top: insertSubmenuPosition.top,
            zIndex: 10000
          }}
          onMouseEnter={keepInsertSubmenuOpen}
          onMouseLeave={scheduleCloseInsertSubmenu}
        >
          {insertItems.map((item) => (
            <button
              key={item.id}
              className="context-menu-item"
              onClick={() => handleInsert(item.insert)}
            >
              <span className="context-menu-icon context-menu-icon-text">{item.icon}</span>
              <span className="context-menu-label">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </>
  )
}
