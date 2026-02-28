import { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react'
import { createPortal } from 'react-dom'
import type { Notebook, SmartViewId, LocalFolderTreeNode, NotebookFolderTreeNode } from '../types/note'
import { useTranslations } from '../i18n'
import { Tooltip } from './Tooltip'
import { isMacOS } from '../utils/platform'
import { useTodayDateNumber } from '../hooks/useTodayDate'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import notesLogo from '../assets/notes-logo.png'
import todolistLogo from '../assets/todolist-logo.png'
import sanqianLogo from '../assets/sanqian-logo.svg'
import yinianLogo from '../assets/yinian-logo.svg'

// 检测是否为 macOS
const isMac = isMacOS()

// 修饰键符号
const MOD = isMac ? '⌘' : 'Ctrl'
const SHIFT = isMac ? '⇧' : 'Shift'

// 快捷键帮助弹窗组件
function ShortcutsPopover({ isOpen, t }: { isOpen: boolean; t: ReturnType<typeof useTranslations> }) {
  const shortcuts = useMemo(() => [
    { category: t.shortcuts.editing, items: [
      { label: t.shortcuts.newNote, key: `${MOD} N` },
      { label: t.shortcuts.newTab, key: `${MOD} T` },
      { label: t.shortcuts.undo, key: `${MOD} Z` },
      { label: t.shortcuts.redo, key: `${MOD} ${SHIFT} Z` },
    ]},
    { category: t.shortcuts.blocks, items: [
      { label: t.shortcuts.slashCommand, key: '/ 、' },
      { label: t.shortcuts.codeBlock, key: '```' },
      { label: t.shortcuts.mathFormula, key: '$...$' },
      { label: t.shortcuts.noteLink, key: '[[' },
    ]},
    { category: t.shortcuts.textFormat, items: [
      { label: t.shortcuts.bold, key: `${MOD} B` },
      { label: t.shortcuts.italic, key: `${MOD} I` },
      { label: t.shortcuts.underline, key: `${MOD} U` },
      { label: t.shortcuts.strikethrough, key: `${MOD} ${SHIFT} S` },
      { label: t.shortcuts.highlight, key: `${MOD} ${SHIFT} H` },
      { label: t.shortcuts.inlineCode, key: `${MOD} ${SHIFT} E` },
    ]},
  ], [t])

  if (!isOpen) return null

  return (
    <div className="absolute top-0 left-full ml-2 w-52 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg shadow-lg py-2 z-50">
      <div className="px-3 pb-1.5 text-[0.733rem] font-medium text-[var(--color-muted)] uppercase tracking-wider">
        {t.shortcuts.title}
      </div>
      {shortcuts.map((section, idx) => (
        <div key={section.category}>
          {idx > 0 && <div className="my-1.5 border-t border-[var(--color-border)]" />}
          <div className="px-3 py-1 text-[0.7rem] text-[var(--color-muted)]">{section.category}</div>
          {section.items.map((item) => (
            <div key={item.label} className="px-3 py-1 flex items-center justify-between text-[0.8rem]">
              <span className="text-[var(--color-text-secondary)]">{item.label}</span>
              <span className="text-[var(--color-muted)] font-mono text-[0.7rem]">{item.key}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// Logo icons mapping
const LOGO_MAP: Record<string, string> = {
  'logo:notes': notesLogo,
  'logo:todolist': todolistLogo,
  'logo:sanqian': sanqianLogo,
  'logo:yinian': yinianLogo,
}

// Notebook icon component
function NotebookIcon({ icon, className = '' }: { icon?: string; className?: string }) {
  const iconValue = icon || 'logo:notes'

  if (iconValue.startsWith('logo:')) {
    const logoSrc = LOGO_MAP[iconValue] || LOGO_MAP['logo:notes']
    return (
      <img
        src={logoSrc}
        alt=""
        className={`w-4 h-4 object-contain dark:invert select-none ${className}`}
        draggable={false}
      />
    )
  }

  // It's an emoji
  return <span className={`inline-flex items-center justify-center w-4 h-4 text-sm leading-none select-none ${className}`}>{iconValue}</span>
}

interface SidebarProps {
  notebooks: Notebook[]
  selectedNotebookId: string | null
  selectedSmartView: SmartViewId | null
  onSelectNotebook: (id: string | null) => void
  onSelectSmartView: (view: SmartViewId) => void
  onAddNotebook: () => void
  onAddLocalFolder: () => void
  onOpenLocalFolderInFileManager?: (notebookId: string) => void
  onEditNotebook: (notebook: Notebook) => void
  onDeleteNotebook: (notebook: Notebook) => void
  onOpenSettings: () => void
  onMoveNoteToNotebook: (noteIds: string[], notebookId: string | null) => void
  onReorderNotebooks: (orderedIds: string[]) => void
  noteCounts: {
    all: number
    daily: number
    recent: number
    favorites: number
    trash: number
    notebooks: Record<string, number>
  }
  notebookHasChildFolders?: Record<string, boolean>
  localFolderTreeNodes?: LocalFolderTreeNode[]
  localFolderTreeLoading?: boolean
  selectedLocalFolderPath?: string | null
  onSelectLocalFolder?: (folderPath: string | null) => void
  onCreateLocalFolder?: (parentFolderPath: string | null) => void
  onRenameLocalFolder?: (relativePath: string) => void
  onDeleteLocalFolder?: (relativePath: string) => void
  canCreateLocalFolder?: boolean
  canManageLocalFolders?: boolean
  internalFolderTreeNodes?: NotebookFolderTreeNode[]
  internalFolderTreeLoading?: boolean
  selectedInternalFolderPath?: string | null
  onSelectInternalFolder?: (folderPath: string | null) => void
  onCreateInternalFolder?: (parentFolderPath: string | null) => void
  onRenameInternalFolder?: (folderPath: string) => void
  onDeleteInternalFolder?: (folderPath: string) => void
  canCreateInternalFolder?: boolean
  canManageInternalFolders?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
}

interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  notebook: Notebook | null
}

interface LocalFolderContextMenuState {
  visible: boolean
  x: number
  y: number
  target: { kind: 'root' } | { kind: 'folder'; relativePath: string } | null
}

interface InternalFolderContextMenuState {
  visible: boolean
  x: number
  y: number
  target: { kind: 'root' } | { kind: 'folder'; folderPath: string } | null
}

// localStorage key for sidebar collapsed state
const SIDEBAR_COLLAPSED_KEY = 'sanqian-notes-sidebar-collapsed'
const ADD_MENU_FALLBACK_WIDTH = 132
const ADD_MENU_ESTIMATED_HEIGHT = 88
const ADD_MENU_OFFSET = 6
const ADD_MENU_VIEWPORT_PADDING = 8
// Root directory is level 1 in backend rules, so relative folder depth is capped at 2.
const MAX_LOCAL_FOLDER_RELATIVE_DEPTH = 2
const MAX_INTERNAL_FOLDER_DEPTH = 3
const TREE_ROW_BASE_PADDING_LEFT = 0
const TREE_LEVEL_INDENT = 8
const TREE_TOGGLE_BG_SIDE_EXTEND = 3
const SIDEBAR_ROW_BASE_PADDING_X = 10
const EMPTY_LOCAL_TREE_NODES: LocalFolderTreeNode[] = []
const EMPTY_INTERNAL_TREE_NODES: NotebookFolderTreeNode[] = []

/** Shared folder tree item component used by both local and internal folder trees. */
const FolderTreeItem = memo(function FolderTreeItem({
  name,
  path,
  depth,
  hasChildren,
  isExpanded,
  isSelected,
  onToggleExpand,
  onSelect,
  onContextMenu,
  children,
}: {
  name: string
  path: string
  depth: number
  hasChildren: boolean
  isExpanded: boolean
  isSelected: boolean
  onToggleExpand: (path: string) => void
  onSelect: (path: string) => void
  onContextMenu: (event: React.MouseEvent, path: string) => void
  children?: React.ReactNode
}) {
  const handleToggle = useCallback(() => onToggleExpand(path), [onToggleExpand, path])
  const handleSelect = useCallback(() => onSelect(path), [onSelect, path])
  const handleCtxMenu = useCallback(
    (e: React.MouseEvent) => onContextMenu(e, path),
    [onContextMenu, path],
  )
  const handleExpandClick = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      onToggleExpand(path)
    },
    [onToggleExpand, path],
  )

  return (
    <div role="treeitem" aria-expanded={hasChildren ? isExpanded : undefined} aria-selected={isSelected}>
      <div
        className={`flex items-center rounded-md text-[0.76rem] transition-colors ${
          isSelected
            ? 'text-[var(--color-text)] bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)]'
            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-card)]'
        }`}
        style={{
          paddingLeft: `${TREE_ROW_BASE_PADDING_LEFT + depth * TREE_LEVEL_INDENT + TREE_TOGGLE_BG_SIDE_EXTEND}px`,
          paddingRight: `${TREE_TOGGLE_BG_SIDE_EXTEND}px`,
          marginLeft: `-${TREE_TOGGLE_BG_SIDE_EXTEND}px`,
          width: `calc(100% + ${TREE_TOGGLE_BG_SIDE_EXTEND * 2}px)`,
        }}
        onContextMenu={handleCtxMenu}
        onDoubleClick={hasChildren ? handleToggle : undefined}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={handleExpandClick}
            className="p-0.5 rounded-sm hover:bg-black/5 dark:hover:bg-white/10"
            aria-label={isExpanded ? 'Collapse folder' : 'Expand folder'}
          >
            <svg
              className={`w-3 h-3 text-[var(--color-muted)] transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ) : (
          <span className="w-4 h-4 inline-block" />
        )}
        <button
          type="button"
          onClick={handleSelect}
          className="flex-1 min-w-0 text-left px-1 py-1"
        >
          <span className="inline-flex items-center min-w-0">
            <span className="truncate">{name}</span>
          </span>
        </button>
      </div>
      {hasChildren && isExpanded && children && (
        <div className="mt-0.5" role="group">
          {children}
        </div>
      )}
    </div>
  )
})

function getLocalFolderDepth(relativePath: string): number {
  return relativePath.split('/').filter(Boolean).length
}

// ============================================================================
// Notebook Row (memo'd)
// ============================================================================

interface NotebookRowProps {
  notebook: Notebook
  index: number
  isSelected: boolean
  hasNotebookTree: boolean
  isNotebookTreeExpanded: boolean
  shouldHighlightRow: boolean
  isDropBefore: boolean
  isDraggingSelf: boolean
  isDragOver: boolean
  noteCount: number
  onSelect: (id: string) => void
  onTreeToggleOrSelect: (notebookId: string, isCurrentlySelected: boolean) => void
  onContextMenu: (e: React.MouseEvent, notebook: Notebook) => void
  onDragStart: (notebookId: string, e: React.DragEvent) => void
  onDragEnd: () => void
  onDragOver: (notebookId: string, index: number, e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (notebookId: string, e: React.DragEvent) => void
}

const NotebookRow = memo(function NotebookRow({
  notebook,
  index,
  isSelected,
  hasNotebookTree,
  isNotebookTreeExpanded,
  shouldHighlightRow,
  isDropBefore,
  isDraggingSelf,
  isDragOver,
  noteCount,
  onSelect,
  onTreeToggleOrSelect,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: NotebookRowProps) {
  const handleSelect = useCallback(() => onSelect(notebook.id), [onSelect, notebook.id])
  const handleDoubleClick = useCallback(() => {
    if (!hasNotebookTree) return
    onTreeToggleOrSelect(notebook.id, isSelected)
  }, [hasNotebookTree, onTreeToggleOrSelect, notebook.id, isSelected])
  const handleTreeToggle = useCallback((event: React.MouseEvent) => {
    event.stopPropagation()
    onTreeToggleOrSelect(notebook.id, isSelected)
  }, [onTreeToggleOrSelect, notebook.id, isSelected])
  const handleCtxMenu = useCallback(
    (e: React.MouseEvent) => onContextMenu(e, notebook),
    [onContextMenu, notebook],
  )
  const handleDragStart = useCallback(
    (e: React.DragEvent) => onDragStart(notebook.id, e),
    [onDragStart, notebook.id],
  )
  const handleDragOver = useCallback(
    (e: React.DragEvent) => onDragOver(notebook.id, index, e),
    [onDragOver, notebook.id, index],
  )
  const handleDrop = useCallback(
    (e: React.DragEvent) => onDrop(notebook.id, e),
    [onDrop, notebook.id],
  )

  const rowSideExtend = TREE_TOGGLE_BG_SIDE_EXTEND

  return (
    <div className="relative">
      {isDropBefore && (
        <div className="absolute top-0 left-2.5 right-2.5 h-0.5 bg-[var(--color-accent)] rounded-full -translate-y-0.5" />
      )}
      {hasNotebookTree && (
        <button
          type="button"
          onClick={handleTreeToggle}
          className="absolute -left-1 top-1/2 -translate-y-1/2 p-0.5 rounded-sm text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-black/5 dark:hover:bg-white/10 z-[1]"
          aria-label={isNotebookTreeExpanded ? 'Collapse notebook' : 'Expand notebook'}
        >
          <svg
            className={`w-3 h-3 transition-transform ${isNotebookTreeExpanded ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}
      <button
        draggable
        onDragStart={handleDragStart}
        onDragEnd={onDragEnd}
        onClick={handleSelect}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleCtxMenu}
        onDragOver={handleDragOver}
        onDragLeave={onDragLeave}
        onDrop={handleDrop}
        className={`w-full min-w-0 flex items-center justify-between px-2.5 py-1.5 rounded-md text-[0.867rem] transition-all duration-150 ${
          isSelected
            ? `text-[var(--color-text)] ${shouldHighlightRow ? '' : 'hover:bg-[var(--color-card)]'}`
            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-card)]'
        } ${isDragOver ? 'ring-2 ring-[var(--color-accent)] ring-opacity-50' : ''} ${
          isDraggingSelf ? 'opacity-50' : ''
        }`}
        style={{
          ...(shouldHighlightRow
            ? { backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' }
            : {}),
          marginLeft: `-${rowSideExtend}px`,
          width: `calc(100% + ${rowSideExtend * 2}px)`,
          paddingLeft: `${SIDEBAR_ROW_BASE_PADDING_X + rowSideExtend}px`,
          paddingRight: `${SIDEBAR_ROW_BASE_PADDING_X + rowSideExtend}px`,
        }}
      >
        <span className="flex items-center gap-2 min-w-0">
          <NotebookIcon icon={notebook.icon} className="flex-shrink-0" />
          <span className="truncate">{notebook.name}</span>
        </span>
        <span className="text-[0.733rem] text-[var(--color-muted)] tabular-nums">
          {noteCount}
        </span>
      </button>
    </div>
  )
})

function collectLocalFolderPaths(nodes: LocalFolderTreeNode[]): string[] {
  const paths: string[] = []
  const walk = (items: LocalFolderTreeNode[]) => {
    for (const item of items) {
      if (item.kind !== 'folder') continue
      paths.push(item.relative_path)
      if (item.children?.length) {
        walk(item.children)
      }
    }
  }
  walk(nodes)
  return paths
}

function getInternalFolderDepth(folderPath: string): number {
  return folderPath.split('/').filter(Boolean).length
}

function collectInternalFolderPaths(nodes: NotebookFolderTreeNode[]): string[] {
  const paths: string[] = []
  const walk = (items: NotebookFolderTreeNode[]) => {
    for (const item of items) {
      paths.push(item.folder_path)
      if (item.children?.length) {
        walk(item.children)
      }
    }
  }
  walk(nodes)
  return paths
}

function getParentFolderPaths(folderPath: string): string[] {
  const segments = folderPath.split('/').filter(Boolean)
  const parents: string[] = []
  for (let index = 1; index < segments.length; index += 1) {
    parents.push(segments.slice(0, index).join('/'))
  }
  return parents
}

export function Sidebar({
  notebooks,
  selectedNotebookId,
  selectedSmartView,
  onSelectNotebook,
  onSelectSmartView,
  onAddNotebook,
  onAddLocalFolder,
  onOpenLocalFolderInFileManager,
  onEditNotebook,
  onDeleteNotebook,
  onOpenSettings,
  onMoveNoteToNotebook,
  onReorderNotebooks,
  noteCounts,
  notebookHasChildFolders = {},
  localFolderTreeNodes = EMPTY_LOCAL_TREE_NODES,
  localFolderTreeLoading = false,
  selectedLocalFolderPath = null,
  onSelectLocalFolder,
  onCreateLocalFolder,
  onRenameLocalFolder,
  onDeleteLocalFolder,
  canCreateLocalFolder = false,
  canManageLocalFolders = false,
  internalFolderTreeNodes = EMPTY_INTERNAL_TREE_NODES,
  internalFolderTreeLoading = false,
  selectedInternalFolderPath = null,
  onSelectInternalFolder,
  onCreateInternalFolder,
  onRenameInternalFolder,
  onDeleteInternalFolder,
  canCreateInternalFolder = false,
  canManageInternalFolders = false,
  onCollapsedChange,
}: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_COLLAPSED_KEY)
      return saved === 'true'
    } catch {
      return false
    }
  })

  // 通知父组件折叠状态变化，并持久化到 localStorage
  const handleCollapsedChange = (collapsed: boolean) => {
    setIsCollapsed(collapsed)
    onCollapsedChange?.(collapsed)
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed))
    } catch {
      // ignore storage errors
    }
  }

  // 初始化时通知父组件当前的折叠状态
  useEffect(() => {
    onCollapsedChange?.(isCollapsed)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [showShortcuts, setShowShortcuts] = useState(false)
  const shortcutsTimerRef = useRef<NodeJS.Timeout | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    notebook: null,
  })
  const t = useTranslations()
  const [dragOverNotebookId, setDragOverNotebookId] = useState<string | null>(null)
  const [showAddMenu, setShowAddMenu] = useState(false)
  const addMenuRef = useRef<HTMLDivElement>(null)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const [addMenuPosition, setAddMenuPosition] = useState({ top: 0, left: 0 })
  const [localFolderContextMenu, setLocalFolderContextMenu] = useState<LocalFolderContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    target: null,
  })
  const [internalFolderContextMenu, setInternalFolderContextMenu] = useState<InternalFolderContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    target: null,
  })
  const allLocalFolderPaths = useMemo(() => collectLocalFolderPaths(localFolderTreeNodes), [localFolderTreeNodes])
  const [expandedLocalFolders, setExpandedLocalFolders] = useState<Set<string>>(() => new Set())
  const allInternalFolderPaths = useMemo(
    () => collectInternalFolderPaths(internalFolderTreeNodes),
    [internalFolderTreeNodes]
  )
  const [expandedInternalFolders, setExpandedInternalFolders] = useState<Set<string>>(() => new Set())
  const [expandedNotebookTrees, setExpandedNotebookTrees] = useState<Set<string>>(() => new Set())
  const notebookTreeAvailability = useMemo(() => {
    const availability: Record<string, boolean> = {}
    for (const notebook of notebooks) {
      const isSelected = notebook.id === selectedNotebookId
      const hasSelectedLocalTree = Boolean(
        isSelected
        && notebook.source_type === 'local-folder'
        && localFolderTreeNodes.some((node) => node.kind === 'folder')
      )
      const hasSelectedInternalTree = Boolean(
        isSelected
        && notebook.source_type !== 'local-folder'
        && internalFolderTreeNodes.length > 0
      )
      availability[notebook.id] = notebook.source_type === 'local-folder'
        ? (notebookHasChildFolders[notebook.id] ?? false) || hasSelectedLocalTree
        : Boolean(notebookHasChildFolders[notebook.id] || hasSelectedInternalTree)
    }
    return availability
  }, [
    internalFolderTreeNodes,
    localFolderTreeNodes,
    notebookHasChildFolders,
    notebooks,
    selectedNotebookId,
  ])

  // Notebook drag-and-drop reorder state
  const [draggingNotebookId, setDraggingNotebookId] = useState<string | null>(null)
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null)

  // Refs for stable drag callbacks (avoid re-creating callbacks when drag state changes)
  const draggingNotebookIdRef = useRef(draggingNotebookId)
  draggingNotebookIdRef.current = draggingNotebookId
  const notebooksRef = useRef(notebooks)
  notebooksRef.current = notebooks
  const dropTargetIndexRef = useRef(dropTargetIndex)
  dropTargetIndexRef.current = dropTargetIndex

  const selectedNotebook = useMemo(
    () => (selectedNotebookId ? notebooks.find((notebook) => notebook.id === selectedNotebookId) || null : null),
    [notebooks, selectedNotebookId]
  )
  const isLocalNotebookSelected = selectedNotebook?.source_type === 'local-folder'
  const isInternalNotebookSelected = Boolean(selectedNotebook && selectedNotebook.source_type !== 'local-folder')

  const updateAddMenuPosition = useCallback((menuSize?: { width: number; height: number }) => {
    const trigger = addButtonRef.current
    if (!trigger) return

    const rect = trigger.getBoundingClientRect()
    const measuredWidth = menuSize?.width ?? 0
    const width = measuredWidth > ADD_MENU_VIEWPORT_PADDING ? measuredWidth : ADD_MENU_FALLBACK_WIDTH
    const height = Math.max(menuSize?.height ?? ADD_MENU_ESTIMATED_HEIGHT, ADD_MENU_ESTIMATED_HEIGHT)
    const spaceBelow = window.innerHeight - rect.bottom - ADD_MENU_VIEWPORT_PADDING
    const spaceAbove = rect.top - ADD_MENU_VIEWPORT_PADDING
    const openUpward = spaceBelow < height + ADD_MENU_OFFSET && spaceAbove > spaceBelow

    const rawTop = openUpward
      ? rect.top - height - ADD_MENU_OFFSET
      : rect.bottom + ADD_MENU_OFFSET
    const maxTop = Math.max(ADD_MENU_VIEWPORT_PADDING, window.innerHeight - height - ADD_MENU_VIEWPORT_PADDING)
    const top = Math.min(Math.max(rawTop, ADD_MENU_VIEWPORT_PADDING), maxTop)

    const rawLeft = rect.right - width
    const maxLeft = Math.max(ADD_MENU_VIEWPORT_PADDING, window.innerWidth - width - ADD_MENU_VIEWPORT_PADDING)
    const left = Math.min(Math.max(rawLeft, ADD_MENU_VIEWPORT_PADDING), maxLeft)

    setAddMenuPosition({ top, left })
  }, [])

  // Handle right click on notebook (stable for NotebookRow memo)
  const handleNotebookContextMenu = useCallback((e: React.MouseEvent, notebook: Notebook) => {
    e.preventDefault()
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      notebook,
    })
  }, [])

  // Stable notebook drag callbacks using refs
  const handleNotebookDragStart = useCallback((notebookId: string, e: React.DragEvent) => {
    setDraggingNotebookId(notebookId)
    e.dataTransfer.setData('application/x-notebook-id', notebookId)
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const handleNotebookDragEnd = useCallback(() => {
    setDraggingNotebookId(null)
    setDropTargetIndex(null)
  }, [])

  const handleNotebookDragOver = useCallback((notebookId: string, index: number, e: React.DragEvent) => {
    e.preventDefault()
    const isNotebookDrag = e.dataTransfer.types.includes('application/x-notebook-id')
    if (isNotebookDrag && draggingNotebookIdRef.current) {
      e.dataTransfer.dropEffect = 'move'
      const rect = e.currentTarget.getBoundingClientRect()
      const midY = rect.top + rect.height / 2
      const targetIndex = e.clientY < midY ? index : index + 1
      setDropTargetIndex(prev => prev === targetIndex ? prev : targetIndex)
    } else if (!isNotebookDrag) {
      e.dataTransfer.dropEffect = 'move'
      setDragOverNotebookId(notebookId)
    }
  }, [])

  const handleNotebookDragLeave = useCallback((e: React.DragEvent) => {
    const relatedTarget = e.relatedTarget as HTMLElement | null
    if (!relatedTarget?.closest?.('[data-notebook-list]')) {
      setDropTargetIndex(null)
    }
    setDragOverNotebookId(null)
  }, [])

  const handleNotebookDrop = useCallback((notebookId: string, e: React.DragEvent) => {
    e.preventDefault()
    const notebookIdData = e.dataTransfer.getData('application/x-notebook-id')
    const currentDropTarget = dropTargetIndexRef.current
    const currentNotebooks = notebooksRef.current
    if (notebookIdData && currentDropTarget !== null && currentNotebooks.length > 1) {
      const draggedIndex = currentNotebooks.findIndex(n => n.id === notebookIdData)
      if (draggedIndex !== -1 && draggedIndex !== currentDropTarget && draggedIndex !== currentDropTarget - 1) {
        const newOrder = [...currentNotebooks]
        const [removed] = newOrder.splice(draggedIndex, 1)
        const insertIndex = currentDropTarget > draggedIndex ? currentDropTarget - 1 : currentDropTarget
        newOrder.splice(insertIndex, 0, removed)
        onReorderNotebooks(newOrder.map(n => n.id))
      }
    } else {
      const jsonData = e.dataTransfer.getData('application/json')
      const plainData = e.dataTransfer.getData('text/plain')
      let noteIds: string[] = []
      if (jsonData) {
        try { noteIds = JSON.parse(jsonData) } catch { noteIds = plainData ? [plainData] : [] }
      } else if (plainData) {
        noteIds = [plainData]
      }
      if (noteIds.length > 0) {
        onMoveNoteToNotebook(noteIds, notebookId)
      }
    }
    setDragOverNotebookId(null)
    setDropTargetIndex(null)
  }, [onReorderNotebooks, onMoveNoteToNotebook])

  const closeContextMenu = () => {
    setContextMenu(prev => ({ ...prev, visible: false, notebook: null }))
  }

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      const clickedInsideMenu = addMenuRef.current?.contains(target)
      const clickedTrigger = addButtonRef.current?.contains(target)
      if (!clickedInsideMenu && !clickedTrigger) {
        setShowAddMenu(false)
      }
    }
    if (showAddMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showAddMenu])

  useEffect(() => {
    if (!showAddMenu) return

    const handlePositionUpdate = () => {
      const menu = addMenuRef.current
      updateAddMenuPosition(menu ? { width: menu.offsetWidth, height: menu.offsetHeight } : undefined)
    }

    handlePositionUpdate()
    window.addEventListener('scroll', handlePositionUpdate, true)
    window.addEventListener('resize', handlePositionUpdate)
    return () => {
      window.removeEventListener('scroll', handlePositionUpdate, true)
      window.removeEventListener('resize', handlePositionUpdate)
    }
  }, [showAddMenu, updateAddMenuPosition])

  useEffect(() => {
    if (!isLocalNotebookSelected) {
      setExpandedLocalFolders((prev) => (prev.size === 0 ? prev : new Set()))
      return
    }
    setExpandedLocalFolders((prev) => {
      const next = new Set<string>()
      for (const path of allLocalFolderPaths) {
        if (prev.has(path)) {
          next.add(path)
        }
      }
      return next
    })
  }, [allLocalFolderPaths, isLocalNotebookSelected])

  useEffect(() => {
    if (!isInternalNotebookSelected) {
      setExpandedInternalFolders((prev) => (prev.size === 0 ? prev : new Set()))
      return
    }
    setExpandedInternalFolders((prev) => {
      const next = new Set<string>()
      for (const path of allInternalFolderPaths) {
        if (prev.has(path)) {
          next.add(path)
        }
      }
      return next
    })
  }, [allInternalFolderPaths, isInternalNotebookSelected])

  useEffect(() => {
    if (!isLocalNotebookSelected || !selectedLocalFolderPath) return
    const parentPaths = getParentFolderPaths(selectedLocalFolderPath)
    if (parentPaths.length === 0) return
    setExpandedLocalFolders((prev) => {
      const next = new Set(prev)
      parentPaths.forEach((path) => next.add(path))
      return next
    })
  }, [isLocalNotebookSelected, selectedLocalFolderPath])

  useEffect(() => {
    if (!isInternalNotebookSelected || !selectedInternalFolderPath) return
    const parentPaths = getParentFolderPaths(selectedInternalFolderPath)
    if (parentPaths.length === 0) return
    setExpandedInternalFolders((prev) => {
      const next = new Set(prev)
      parentPaths.forEach((path) => next.add(path))
      return next
    })
  }, [isInternalNotebookSelected, selectedInternalFolderPath])

  const toggleLocalFolderExpand = useCallback((relativePath: string) => {
    setExpandedLocalFolders((prev) => {
      const next = new Set(prev)
      if (next.has(relativePath)) {
        next.delete(relativePath)
      } else {
        next.add(relativePath)
      }
      return next
    })
  }, [])

  const toggleInternalFolderExpand = useCallback((folderPath: string) => {
    setExpandedInternalFolders((prev) => {
      const next = new Set(prev)
      if (next.has(folderPath)) {
        next.delete(folderPath)
      } else {
        next.add(folderPath)
      }
      return next
    })
  }, [])

  const toggleNotebookTreeExpand = useCallback((notebookId: string) => {
    setExpandedNotebookTrees((prev) => {
      const next = new Set(prev)
      if (next.has(notebookId)) {
        next.delete(notebookId)
      } else {
        next.add(notebookId)
      }
      return next
    })
  }, [])

  // Combined tree toggle + select callback (after toggleNotebookTreeExpand)
  const handleTreeToggleOrSelect = useCallback((notebookId: string, isCurrentlySelected: boolean) => {
    if (!isCurrentlySelected) {
      onSelectNotebook(notebookId)
      setExpandedNotebookTrees((prev) => {
        if (prev.has(notebookId)) return prev
        const next = new Set(prev)
        next.add(notebookId)
        return next
      })
    } else {
      toggleNotebookTreeExpand(notebookId)
    }
  }, [onSelectNotebook, toggleNotebookTreeExpand])

  const openLocalFolderContextMenu = useCallback(
    (event: React.MouseEvent, target: { kind: 'root' } | { kind: 'folder'; relativePath: string }) => {
      event.preventDefault()
      event.stopPropagation()
      setLocalFolderContextMenu({
        visible: true,
        x: event.clientX,
        y: event.clientY,
        target,
      })
    },
    []
  )

  const closeLocalFolderContextMenu = useCallback(() => {
    setLocalFolderContextMenu((prev) => ({ ...prev, visible: false, target: null }))
  }, [])

  const openInternalFolderContextMenu = useCallback(
    (event: React.MouseEvent, target: { kind: 'root' } | { kind: 'folder'; folderPath: string }) => {
      event.preventDefault()
      event.stopPropagation()
      setInternalFolderContextMenu({
        visible: true,
        x: event.clientX,
        y: event.clientY,
        target,
      })
    },
    []
  )

  const closeInternalFolderContextMenu = useCallback(() => {
    setInternalFolderContextMenu((prev) => ({ ...prev, visible: false, target: null }))
  }, [])

  const localFolderContextMenuItems = useMemo<ContextMenuItem[]>(() => {
    const target = localFolderContextMenu.target
    if (!target) return []

    if (target.kind === 'root') {
      return [
        {
          label: t.notebook.createFolder,
          onClick: () => onCreateLocalFolder?.(null),
          disabled: !canCreateLocalFolder || !onCreateLocalFolder,
        },
      ]
    }

    const items: ContextMenuItem[] = []
    const canCreateSubfolder = canCreateLocalFolder
      && getLocalFolderDepth(target.relativePath) < MAX_LOCAL_FOLDER_RELATIVE_DEPTH
    if (canCreateSubfolder && onCreateLocalFolder) {
      items.push({
        label: t.notebook.createSubfolder,
        onClick: () => onCreateLocalFolder(target.relativePath),
      })
      items.push({ label: '', onClick: () => {}, divider: true })
    }
    items.push({
      label: t.actions.rename,
      onClick: () => onRenameLocalFolder?.(target.relativePath),
      disabled: !canManageLocalFolders || !onRenameLocalFolder,
    })
    items.push({
      label: t.actions.delete,
      onClick: () => onDeleteLocalFolder?.(target.relativePath),
      disabled: !canManageLocalFolders || !onDeleteLocalFolder,
      danger: true,
    })
    return items
  }, [
    canCreateLocalFolder,
    canManageLocalFolders,
    localFolderContextMenu.target,
    onCreateLocalFolder,
    onDeleteLocalFolder,
    onRenameLocalFolder,
    t.actions.delete,
    t.actions.rename,
    t.notebook.createFolder,
    t.notebook.createSubfolder,
  ])

  const internalFolderContextMenuItems = useMemo<ContextMenuItem[]>(() => {
    const target = internalFolderContextMenu.target
    if (!target) return []

    if (target.kind === 'root') {
      return [
        {
          label: t.notebook.createFolder,
          onClick: () => onCreateInternalFolder?.(null),
          disabled: !canCreateInternalFolder || !onCreateInternalFolder,
        },
      ]
    }

    const items: ContextMenuItem[] = []
    const canCreateSubfolder =
      canCreateInternalFolder && getInternalFolderDepth(target.folderPath) < MAX_INTERNAL_FOLDER_DEPTH
    if (canCreateSubfolder && onCreateInternalFolder) {
      items.push({
        label: t.notebook.createSubfolder,
        onClick: () => onCreateInternalFolder(target.folderPath),
      })
      items.push({ label: '', onClick: () => {}, divider: true })
    }
    items.push({
      label: t.actions.rename,
      onClick: () => onRenameInternalFolder?.(target.folderPath),
      disabled: !canManageInternalFolders || !onRenameInternalFolder,
    })
    items.push({
      label: t.actions.delete,
      onClick: () => onDeleteInternalFolder?.(target.folderPath),
      disabled: !canManageInternalFolders || !onDeleteInternalFolder,
      danger: true,
    })
    return items
  }, [
    canCreateInternalFolder,
    canManageInternalFolders,
    internalFolderContextMenu.target,
    onCreateInternalFolder,
    onDeleteInternalFolder,
    onRenameInternalFolder,
    t.actions.delete,
    t.actions.rename,
    t.notebook.createFolder,
    t.notebook.createSubfolder,
  ])

  const notebookContextMenuItems = useMemo<ContextMenuItem[]>(() => {
    const notebook = contextMenu.notebook
    if (!notebook) return []

    const items: ContextMenuItem[] = []
    const canCreateFolder = notebook.source_type === 'local-folder'
      ? canCreateLocalFolder && Boolean(onCreateLocalFolder)
      : canCreateInternalFolder && Boolean(onCreateInternalFolder)

    if (canCreateFolder) {
      items.push({
        label: t.notebook.createFolder,
        onClick: () => {
          if (notebook.source_type === 'local-folder') {
            onCreateLocalFolder?.(null)
          } else {
            onCreateInternalFolder?.(null)
          }
        },
      })
      items.push({ label: '', onClick: () => {}, divider: true })
    }

    if (notebook.source_type === 'local-folder' && onOpenLocalFolderInFileManager) {
      items.push({
        label: t.notebook.openInFileManager,
        onClick: () => onOpenLocalFolderInFileManager(notebook.id),
      })
      items.push({ label: '', onClick: () => {}, divider: true })
    }

    items.push(
      {
        label: t.actions.edit,
        onClick: () => onEditNotebook(notebook),
      },
      {
        label: t.actions.delete,
        onClick: () => onDeleteNotebook(notebook),
        danger: true,
      }
    )

    return items
  }, [
    canCreateInternalFolder,
    canCreateLocalFolder,
    contextMenu.notebook,
    onCreateInternalFolder,
    onCreateLocalFolder,
    onDeleteNotebook,
    onEditNotebook,
    onOpenLocalFolderInFileManager,
    t.actions.delete,
    t.actions.edit,
    t.notebook.createFolder,
    t.notebook.openInFileManager,
  ])

  const handleLocalFolderCtxMenu = useCallback(
    (event: React.MouseEvent, path: string) =>
      openLocalFolderContextMenu(event, { kind: 'folder', relativePath: path }),
    [openLocalFolderContextMenu],
  )
  const handleSelectLocalFolder = useCallback(
    (path: string) => onSelectLocalFolder?.(path),
    [onSelectLocalFolder],
  )
  const handleInternalFolderCtxMenu = useCallback(
    (event: React.MouseEvent, path: string) =>
      openInternalFolderContextMenu(event, { kind: 'folder', folderPath: path }),
    [openInternalFolderContextMenu],
  )
  const handleSelectInternalFolder = useCallback(
    (path: string) => onSelectInternalFolder?.(path),
    [onSelectInternalFolder],
  )

  const renderLocalFolderTree = useCallback((nodes: LocalFolderTreeNode[], depth = 0): React.ReactNode => {
    return nodes
      .filter((node) => node.kind === 'folder')
      .map((node) => {
        const childFolders = (node.children || []).filter((child) => child.kind === 'folder')
        const hasChildren = childFolders.length > 0
        const isExpanded = expandedLocalFolders.has(node.relative_path)
        return (
          <FolderTreeItem
            key={`local-folder-${node.id}`}
            name={node.name}
            path={node.relative_path}
            depth={depth}
            hasChildren={hasChildren}
            isExpanded={isExpanded}
            isSelected={selectedLocalFolderPath === node.relative_path}
            onToggleExpand={toggleLocalFolderExpand}
            onSelect={handleSelectLocalFolder}
            onContextMenu={handleLocalFolderCtxMenu}
          >
            {hasChildren && isExpanded ? renderLocalFolderTree(childFolders, depth + 1) : null}
          </FolderTreeItem>
        )
      })
  }, [
    expandedLocalFolders,
    handleSelectLocalFolder,
    handleLocalFolderCtxMenu,
    selectedLocalFolderPath,
    toggleLocalFolderExpand,
  ])

  const renderInternalFolderTree = useCallback((nodes: NotebookFolderTreeNode[], depth = 0): React.ReactNode => {
    return nodes.map((node) => {
      const childFolders = node.children || []
      const hasChildren = childFolders.length > 0
      const isExpanded = expandedInternalFolders.has(node.folder_path)
      return (
        <FolderTreeItem
          key={`internal-folder-${node.id}`}
          name={node.name}
          path={node.folder_path}
          depth={depth}
          hasChildren={hasChildren}
          isExpanded={isExpanded}
          isSelected={selectedInternalFolderPath === node.folder_path}
          onToggleExpand={toggleInternalFolderExpand}
          onSelect={handleSelectInternalFolder}
          onContextMenu={handleInternalFolderCtxMenu}
        >
          {hasChildren && isExpanded ? renderInternalFolderTree(childFolders, depth + 1) : null}
        </FolderTreeItem>
      )
    })
  }, [
    expandedInternalFolders,
    handleSelectInternalFolder,
    handleInternalFolderCtxMenu,
    selectedInternalFolderPath,
    toggleInternalFolderExpand,
  ])

  // Cleanup shortcuts timer on unmount
  useEffect(() => {
    return () => {
      if (shortcutsTimerRef.current) {
        clearTimeout(shortcutsTimerRef.current)
      }
    }
  }, [])

  // Get today's date number for daily icon (auto-updates on visibility change)
  const todayDate = useTodayDateNumber()

  const smartViews: { id: SmartViewId; label: string; icon: React.ReactNode }[] = [
    { id: 'all', label: t.sidebar.all, icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
    ) },
    { id: 'daily', label: t.sidebar.daily, icon: (
      <div className="w-4 h-4 relative">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-[7px] font-medium pt-1">
          {todayDate}
        </span>
      </div>
    ) },
    { id: 'favorites', label: t.sidebar.favorites, icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
      </svg>
    ) },
  ]

  if (isCollapsed) {
    return (
      <div className="w-12 flex-shrink-0 h-full bg-[var(--color-card-solid)] flex flex-col select-none overflow-hidden">
        {/* Drag region - top area for window dragging */}
        <div className="h-[42px] flex-shrink-0 drag-region" />

        {/* Smart Views 图标 */}
        <div className="flex flex-col items-center gap-1 px-2 pb-2 no-drag">
          {smartViews.map((view) => (
            <Tooltip key={view.id} content={view.label}>
              <button
                onClick={() => onSelectSmartView(view.id)}
                className={`p-2 rounded-md transition-all duration-150 ${
                  selectedSmartView === view.id
                    ? 'text-[var(--color-text)] bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)]'
                    : 'text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)]'
                }`}
              >
                {view.icon}
              </button>
            </Tooltip>
          ))}
        </div>

        {/* Notebooks 图标 */}
        <div className="flex flex-col items-center gap-1 px-2 py-2 flex-1 overflow-y-auto no-drag">
          {notebooks.map((notebook) => (
            <Tooltip key={notebook.id} content={notebook.name}>
              <button
                onClick={() => onSelectNotebook(notebook.id)}
                className={`p-2 rounded-md transition-all duration-150 ${
                  selectedNotebookId === notebook.id
                    ? 'text-[var(--color-text)] bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)]'
                    : 'text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)]'
                }`}
              >
                <NotebookIcon icon={notebook.icon} className="w-4 h-4" />
              </button>
            </Tooltip>
          ))}
        </div>

        {/* 底部按钮 */}
        <div className="flex flex-col items-center gap-1 px-2 py-2 no-drag">
          {/* 回收站按钮 */}
          <Tooltip content={t.sidebar.trash}>
            <button
              onClick={() => onSelectSmartView('trash')}
              className={`p-2 rounded-md transition-all duration-150 ${
                selectedSmartView === 'trash'
                  ? 'text-[var(--color-text)] bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)]'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)]'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
              </svg>
            </button>
          </Tooltip>

          {/* 展开按钮 */}
          <Tooltip content={t.sidebar.expand}>
            <button
              onClick={() => handleCollapsedChange(false)}
              className="p-2 rounded-md text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-all duration-150"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
              </svg>
            </button>
          </Tooltip>

          {/* 设置按钮 */}
          <Tooltip content={t.sidebar.settings}>
            <button
              onClick={onOpenSettings}
              className="p-2 rounded-md text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-all duration-150"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </Tooltip>
        </div>
      </div>
    )
  }

  return (
    <div className="w-44 flex-shrink-0 h-full bg-[var(--color-card-solid)] border-r border-[var(--color-divider)] flex flex-col relative select-none" data-sidebar>
      {/* Drag region - top area for window dragging, aligned with NoteList header */}
      <div className="h-[42px] flex-shrink-0 drag-region" />

      {/* Shortcuts help button - absolute top right in title bar area */}
      <div
        className="absolute top-[9px] right-2 z-10 no-drag"
        onMouseEnter={() => {
          // Clear any existing timer
          if (shortcutsTimerRef.current) {
            clearTimeout(shortcutsTimerRef.current)
          }
          // Show shortcuts after 300ms delay
          shortcutsTimerRef.current = setTimeout(() => {
            setShowShortcuts(true)
          }, 300)
        }}
        onMouseLeave={() => {
          // Clear timer and hide immediately
          if (shortcutsTimerRef.current) {
            clearTimeout(shortcutsTimerRef.current)
            shortcutsTimerRef.current = null
          }
          setShowShortcuts(false)
        }}
      >
        <button
          className="p-1 rounded text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-card)] transition-all duration-150"
          title={t.shortcuts.title}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
          </svg>
        </button>
        <ShortcutsPopover isOpen={showShortcuts} t={t} />
      </div>

      {/* Sidebar content */}
      <div className="flex-1 overflow-y-auto px-2 pb-3 no-drag">
        {/* Smart Views */}
        <div className="mb-4">
          {smartViews.map((view) => (
            <button
              key={view.id}
              onClick={() => onSelectSmartView(view.id)}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-[0.867rem] transition-all duration-150 ${
                selectedSmartView === view.id
                  ? 'text-[var(--color-text)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-card)]'
              }`}
              style={{
                marginLeft: `-${TREE_TOGGLE_BG_SIDE_EXTEND}px`,
                width: `calc(100% + ${TREE_TOGGLE_BG_SIDE_EXTEND * 2}px)`,
                paddingLeft: `${SIDEBAR_ROW_BASE_PADDING_X + TREE_TOGGLE_BG_SIDE_EXTEND}px`,
                paddingRight: `${SIDEBAR_ROW_BASE_PADDING_X + TREE_TOGGLE_BG_SIDE_EXTEND}px`,
                ...(selectedSmartView === view.id
                  ? { backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' }
                  : {}),
              }}
            >
              <span className="flex items-center gap-2">
                <span className="text-[var(--color-muted)]">{view.icon}</span>
                <span>{view.label}</span>
              </span>
              <span className="text-[0.733rem] text-[var(--color-muted)] tabular-nums">
                {noteCounts[view.id]}
              </span>
            </button>
          ))}
        </div>

        {/* Notebooks Section */}
        <div data-notebook-list>
          <div className="flex items-center justify-between px-2.5 mb-1.5">
            <span className="text-[0.733rem] font-medium text-[var(--color-muted)] uppercase tracking-wider">
              {t.sidebar.notebooks}
            </span>
            <div className="relative">
              <button
                ref={addButtonRef}
                type="button"
                onClick={() => {
                  setShowAddMenu(prev => {
                    const next = !prev
                    if (next) {
                      updateAddMenuPosition()
                    }
                    return next
                  })
                }}
                className="p-1 -mr-1.5 rounded text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-card)] transition-all duration-150"
                title={t.sidebar.addNotebook}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                </svg>
              </button>
              {showAddMenu && typeof document !== 'undefined' && createPortal(
                <div
                  ref={addMenuRef}
                  role="menu"
                  data-testid="sidebar-add-menu"
                  className="fixed w-max max-w-[calc(100vw-16px)] rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] shadow-lg py-1 z-[1100]"
                  style={{
                    top: `${addMenuPosition.top}px`,
                    left: `${addMenuPosition.left}px`,
                  }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setShowAddMenu(false)
                      onAddNotebook()
                    }}
                    className="block w-full whitespace-nowrap text-left px-3 py-1.5 text-[0.8rem] text-[var(--color-text)] hover:bg-[var(--color-surface)]"
                  >
                    {t.sidebar.addNotebook}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setShowAddMenu(false)
                      onAddLocalFolder()
                    }}
                    className="block w-full whitespace-nowrap text-left px-3 py-1.5 text-[0.8rem] text-[var(--color-text)] hover:bg-[var(--color-surface)]"
                  >
                    {t.sidebar.addLocalFolder}
                  </button>
                </div>,
                document.body
              )}
            </div>
          </div>

          {notebooks.length > 0 && (
            notebooks.map((notebook, index) => {
              const isSelected = notebook.id === selectedNotebookId
              const hasTree = notebookTreeAvailability[notebook.id] || false
              const isTreeExpanded = isSelected && expandedNotebookTrees.has(notebook.id)
              const selectedTreePath = notebook.source_type === 'local-folder'
                ? selectedLocalFolderPath
                : selectedInternalFolderPath
              const shouldHighlight = isSelected && (!isTreeExpanded || !selectedTreePath)

              return (
                <div key={notebook.id} className="relative">
                  <NotebookRow
                    notebook={notebook}
                    index={index}
                    isSelected={isSelected}
                    hasNotebookTree={hasTree}
                    isNotebookTreeExpanded={isTreeExpanded}
                    shouldHighlightRow={shouldHighlight}
                    isDropBefore={dropTargetIndex === index && !!draggingNotebookId}
                    isDraggingSelf={draggingNotebookId === notebook.id}
                    isDragOver={dragOverNotebookId === notebook.id}
                    noteCount={noteCounts.notebooks[notebook.id] || 0}
                    onSelect={onSelectNotebook}
                    onTreeToggleOrSelect={handleTreeToggleOrSelect}
                    onContextMenu={handleNotebookContextMenu}
                    onDragStart={handleNotebookDragStart}
                    onDragEnd={handleNotebookDragEnd}
                    onDragOver={handleNotebookDragOver}
                    onDragLeave={handleNotebookDragLeave}
                    onDrop={handleNotebookDrop}
                  />
                  {isSelected && hasTree && notebook.source_type === 'local-folder' && onSelectLocalFolder && isTreeExpanded && (
                    <div
                      className="ml-1 mt-1 mb-1 pr-1"
                      onContextMenu={(event) => openLocalFolderContextMenu(event, { kind: 'root' })}
                    >
                      <div className="max-h-[180px] overflow-auto hide-scrollbar" role="tree" aria-label={notebook.name}>
                        {localFolderTreeLoading ? (
                          <p className="px-2 py-1 text-[0.72rem] text-[var(--color-muted)]">
                            {t.common?.loading || 'Loading...'}
                          </p>
                        ) : localFolderTreeNodes.length > 0 ? (
                          renderLocalFolderTree(localFolderTreeNodes)
                        ) : null}
                      </div>
                    </div>
                  )}
                  {isSelected && hasTree && notebook.source_type !== 'local-folder' && onSelectInternalFolder && isTreeExpanded && (
                    <div
                      className="ml-1 mt-1 mb-1 pr-1"
                      onContextMenu={(event) => openInternalFolderContextMenu(event, { kind: 'root' })}
                    >
                      <div className="max-h-[180px] overflow-auto hide-scrollbar" role="tree" aria-label={notebook.name}>
                        {internalFolderTreeLoading ? (
                          <p className="px-2 py-1 text-[0.72rem] text-[var(--color-muted)]">
                            {t.common?.loading || 'Loading...'}
                          </p>
                        ) : internalFolderTreeNodes.length > 0 ? (
                          renderInternalFolderTree(internalFolderTreeNodes)
                        ) : null}
                      </div>
                    </div>
                  )}
                  {dropTargetIndex === notebooks.length && index === notebooks.length - 1 && draggingNotebookId && (
                    <div className="absolute bottom-0 left-2.5 right-2.5 h-0.5 bg-[var(--color-accent)] rounded-full translate-y-0.5" />
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Bottom buttons - 回收站、收起、设置 */}
      <div className="px-2 py-2 flex flex-col gap-0.5 no-drag">
        {/* Trash button */}
        <button
          onClick={() => onSelectSmartView('trash')}
          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md transition-colors duration-150 ${
            selectedSmartView === 'trash'
              ? 'text-[var(--color-text)] bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)]'
              : 'text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-card)]'
          }`}
          style={{
            marginLeft: `-${TREE_TOGGLE_BG_SIDE_EXTEND}px`,
            width: `calc(100% + ${TREE_TOGGLE_BG_SIDE_EXTEND * 2}px)`,
            paddingLeft: `${SIDEBAR_ROW_BASE_PADDING_X + TREE_TOGGLE_BG_SIDE_EXTEND}px`,
            paddingRight: `${SIDEBAR_ROW_BASE_PADDING_X + TREE_TOGGLE_BG_SIDE_EXTEND}px`,
          }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
          </svg>
          <span className="text-[0.867rem]">{t.sidebar.trash}</span>
        </button>

        {/* Collapse button */}
        <button
          onClick={() => handleCollapsedChange(true)}
          className="flex items-center gap-2 px-2.5 py-1.5 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors duration-150 rounded-md hover:bg-[var(--color-card)]"
          style={{
            marginLeft: `-${TREE_TOGGLE_BG_SIDE_EXTEND}px`,
            width: `calc(100% + ${TREE_TOGGLE_BG_SIDE_EXTEND * 2}px)`,
            paddingLeft: `${SIDEBAR_ROW_BASE_PADDING_X + TREE_TOGGLE_BG_SIDE_EXTEND}px`,
            paddingRight: `${SIDEBAR_ROW_BASE_PADDING_X + TREE_TOGGLE_BG_SIDE_EXTEND}px`,
          }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
          <span className="text-[0.867rem]">{t.sidebar.collapse}</span>
        </button>

        {/* Settings button */}
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-2 px-2.5 py-1.5 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors duration-150 rounded-md hover:bg-[var(--color-card)]"
          style={{
            marginLeft: `-${TREE_TOGGLE_BG_SIDE_EXTEND}px`,
            width: `calc(100% + ${TREE_TOGGLE_BG_SIDE_EXTEND * 2}px)`,
            paddingLeft: `${SIDEBAR_ROW_BASE_PADDING_X + TREE_TOGGLE_BG_SIDE_EXTEND}px`,
            paddingRight: `${SIDEBAR_ROW_BASE_PADDING_X + TREE_TOGGLE_BG_SIDE_EXTEND}px`,
          }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="text-[0.867rem]">{t.sidebar.settings}</span>
        </button>
      </div>

      <ContextMenu
        visible={contextMenu.visible}
        x={contextMenu.x}
        y={contextMenu.y}
        items={notebookContextMenuItems}
        onClose={closeContextMenu}
      />
      <ContextMenu
        visible={localFolderContextMenu.visible}
        x={localFolderContextMenu.x}
        y={localFolderContextMenu.y}
        items={localFolderContextMenuItems}
        onClose={closeLocalFolderContextMenu}
      />
      <ContextMenu
        visible={internalFolderContextMenu.visible}
        x={internalFolderContextMenu.x}
        y={internalFolderContextMenu.y}
        items={internalFolderContextMenuItems}
        onClose={closeInternalFolderContextMenu}
      />
    </div>
  )
}
