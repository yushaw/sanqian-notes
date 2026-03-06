import { memo, useMemo, useState, useEffect, useRef, useCallback, type CSSProperties, type ReactNode } from 'react'
import { useTranslations, type Translations } from '../i18n'
import type { LocalFolderFileEntry, LocalFolderTreeNode, LocalNoteMetadata, TagWithSource } from '../types/note'
import { formatRelativeDate } from '../utils/dateFormat'
import { isMacOS } from '../utils/platform'
import { formatShortcut } from '../utils/shortcut'
import { createLocalResourceId } from '../utils/localResourceId'
import { mergeLocalMetadataTags } from '../utils/localFolderNavigation'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { NotePreviewPopover } from './NotePreviewPopover'
import { Tooltip } from './Tooltip'

// Root directory is level 1, so the deepest creatable relative folder path is 2 segments.
const MAX_FOLDER_RELATIVE_DEPTH = 2
const isMac = isMacOS()
const LOCAL_FILE_ITEM_SELECTED_STYLE: CSSProperties = {
  backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, var(--color-card-solid))',
  WebkitTapHighlightColor: 'transparent',
}
const LOCAL_FILE_ITEM_DEFAULT_STYLE: CSSProperties = {
  WebkitTapHighlightColor: 'transparent',
}

type EntryTarget = {
  kind: 'file' | 'folder'
  relativePath: string
}

type ContextTarget =
  | { kind: 'root' }
  | { kind: 'folder'; relativePath: string }
  | { kind: 'file'; relativePath: string }

interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  target: ContextTarget | null
}

interface LocalFolderNoteListProps {
  title: string
  treeNodes: LocalFolderTreeNode[]
  files: LocalFolderFileEntry[]
  isSidebarCollapsed?: boolean
  showFolderTree?: boolean
  selectedFolderPath: string | null
  onSelectFolder: (folderPath: string | null) => void
  selectedFilePath?: string | null
  onSelectFile?: (file: LocalFolderFileEntry) => void
  searchQuery: string
  onSearchQueryChange: (query: string) => void
  onSearchCompositionStart?: () => void
  onSearchCompositionEnd?: (query: string) => void
  searchLoading?: boolean
  searchMatchedPaths?: Set<string> | null
  searchDisabled?: boolean
  onCreateFile?: () => void
  onCreateFolder?: (parentFolderPath: string | null) => void
  onRenameEntry?: (target: EntryTarget) => void
  onDeleteEntry?: (target: EntryTarget) => void
  canCreateFile?: boolean
  canCreateFolder?: boolean
  canManageEntries?: boolean
  notebookId?: string | null
  localNoteMetadataById?: Record<string, LocalNoteMetadata>
}

function getRelativePathDepth(relativePath: string | null): number {
  if (!relativePath) return 0
  return relativePath.split('/').filter(Boolean).length
}

function collectFolderPaths(nodes: LocalFolderTreeNode[]): string[] {
  const paths: string[] = []
  const walk = (items: LocalFolderTreeNode[]) => {
    for (const item of items) {
      if (item.kind !== 'folder') continue
      paths.push(item.relative_path)
      if (item.children && item.children.length > 0) {
        walk(item.children)
      }
    }
  }
  walk(nodes)
  return paths
}

// --------------------------------------------------------------------------
// Extracted file item (memo'd to avoid re-render on unrelated parent changes)
// --------------------------------------------------------------------------

interface LocalFolderFileItemProps {
  file: LocalFolderFileEntry
  isSelected: boolean
  hideDivider: boolean
  dateT: Translations['date']
  onClickFile: (relativePath: string) => void
  onContextMenuFile: (relativePath: string, event: React.MouseEvent) => void
  onMouseEnterFile: (relativePath: string, element: HTMLElement) => void
  onMouseLeaveFile: () => void
}

const LocalFolderFileItem = memo(function LocalFolderFileItem({
  file,
  isSelected,
  hideDivider,
  dateT,
  onClickFile,
  onContextMenuFile,
  onMouseEnterFile,
  onMouseLeaveFile,
}: LocalFolderFileItemProps) {
  const relativePath = file.relative_path

  const handleClick = useCallback(
    () => onClickFile(relativePath),
    [onClickFile, relativePath]
  )
  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => onContextMenuFile(relativePath, event),
    [onContextMenuFile, relativePath]
  )
  const handleMouseEnter = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => onMouseEnterFile(relativePath, event.currentTarget),
    [onMouseEnterFile, relativePath]
  )

  const previewText = file.preview?.trim() || file.relative_path
  const updatedAtLabel = formatRelativeDate(new Date(file.mtime_ms).toISOString(), dateT)

  return (
    <button
      data-local-file-path={file.relative_path}
      type="button"
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={onMouseLeaveFile}
      className={`relative w-full text-left px-4 py-2.5 transition-colors duration-75 select-none appearance-none border-0 bg-transparent outline-none ring-0 shadow-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0 focus:shadow-none focus-visible:shadow-none active:outline-none active:ring-0 active:shadow-none hover:bg-[var(--color-surface)]`}
      style={isSelected ? LOCAL_FILE_ITEM_SELECTED_STYLE : LOCAL_FILE_ITEM_DEFAULT_STYLE}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <h3 className="text-[0.933rem] font-medium truncate leading-tight text-[var(--color-text)]">
            {file.name}
          </h3>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-[0.733rem] text-[var(--color-muted)] opacity-60">
            {updatedAtLabel}
          </span>
        </div>
      </div>
      <div
        className="text-[0.8rem] text-[var(--color-muted)] mt-1 line-clamp-2 leading-[1.4] select-none"
        title={file.relative_path}
        style={{ minHeight: '2.8em' }}
      >
        {previewText}
      </div>
      {!hideDivider && (
        <div data-note-divider className="absolute bottom-0 left-4 right-4 h-px bg-[var(--color-divider)]" />
      )}
    </button>
  )
})

// --------------------------------------------------------------------------
// Main component
// --------------------------------------------------------------------------

export function LocalFolderNoteList({
  title,
  treeNodes,
  files,
  isSidebarCollapsed = false,
  showFolderTree = true,
  selectedFolderPath,
  onSelectFolder,
  selectedFilePath,
  onSelectFile,
  searchQuery,
  onSearchQueryChange,
  onSearchCompositionStart,
  onSearchCompositionEnd,
  searchLoading = false,
  searchMatchedPaths = null,
  searchDisabled = false,
  onCreateFile,
  onCreateFolder,
  onRenameEntry,
  onDeleteEntry,
  canCreateFile = true,
  canCreateFolder = true,
  canManageEntries = true,
  notebookId,
  localNoteMetadataById,
}: LocalFolderNoteListProps) {
  const t = useTranslations()
  const shouldHideTitle = isMac && isSidebarCollapsed
  const [isSearching, setIsSearching] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const fileListContainerRef = useRef<HTMLDivElement>(null)

  // Hover preview state
  const [hoveredPreview, setHoveredPreview] = useState<{ id: string; ai_summary: string | null } | null>(null)
  const hoveredPreviewRef = useRef(hoveredPreview)
  hoveredPreviewRef.current = hoveredPreview
  const [hoveredPreviewTags, setHoveredPreviewTags] = useState<TagWithSource[]>([])
  const [previewAnchor, setPreviewAnchor] = useState<HTMLElement | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const notebookIdRef = useRef(notebookId)
  notebookIdRef.current = notebookId
  const metadataByIdRef = useRef(localNoteMetadataById)
  metadataByIdRef.current = localNoteMetadataById
  const allFolderPaths = useMemo(() => collectFolderPaths(treeNodes), [treeNodes])
  const knownFolderPathsRef = useRef<Set<string>>(new Set(allFolderPaths))
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set(allFolderPaths))
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    target: null,
  })

  useEffect(() => {
    const knownPaths = knownFolderPathsRef.current
    setExpandedFolders((prev) => {
      const next = new Set<string>()
      for (const path of allFolderPaths) {
        if (prev.has(path) || !knownPaths.has(path)) {
          next.add(path)
        }
      }
      return next
    })
    knownFolderPathsRef.current = new Set(allFolderPaths)
  }, [allFolderPaths])

  useEffect(() => {
    if (isSearching && !searchDisabled) {
      searchInputRef.current?.focus()
    }
  }, [isSearching, searchDisabled])

  useEffect(() => {
    if (searchDisabled && isSearching) {
      setIsSearching(false)
      onSearchQueryChange('')
    }
  }, [isSearching, onSearchQueryChange, searchDisabled])

  const handleCloseSearch = useCallback(() => {
    setIsSearching(false)
    onSearchQueryChange('')
  }, [onSearchQueryChange])

  const toggleFolderExpand = useCallback((folderPath: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(folderPath)) {
        next.delete(folderPath)
      } else {
        next.add(folderPath)
      }
      return next
    })
  }, [])

  const openContextMenu = useCallback((event: React.MouseEvent, target: ContextTarget) => {
    event.preventDefault()
    setContextMenu({
      visible: true,
      x: event.clientX,
      y: event.clientY,
      target,
    })
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => ({ ...prev, visible: false, target: null }))
  }, [])

  const folderFilteredFiles = useMemo(() => {
    if (!selectedFolderPath) {
      return [...files]
    }

    const prefix = `${selectedFolderPath}/`
    return files.filter((file) => (
      file.folder_relative_path === selectedFolderPath
      || file.folder_relative_path.startsWith(prefix)
    ))
  }, [files, selectedFolderPath])

  const sortedFiles = useMemo(() => {
    return [...folderFilteredFiles].sort((a, b) => (
      a.relative_path.localeCompare(b.relative_path, undefined, { sensitivity: 'base', numeric: true })
    ))
  }, [folderFilteredFiles])

  const hasSearchQuery = searchQuery.trim().length > 0
  const keepUnfilteredWhileSearching = hasSearchQuery && searchLoading && searchMatchedPaths === null
  const displayFiles = useMemo(() => {
    if (!hasSearchQuery || keepUnfilteredWhileSearching) return sortedFiles
    if (!searchMatchedPaths) return []
    return sortedFiles.filter((file) => searchMatchedPaths.has(file.relative_path))
  }, [hasSearchQuery, keepUnfilteredWhileSearching, searchMatchedPaths, sortedFiles])
  const displayFilesRef = useRef(displayFiles)
  displayFilesRef.current = displayFiles
  const selectedFilePathRef = useRef(selectedFilePath ?? null)
  selectedFilePathRef.current = selectedFilePath ?? null
  const isSearchingRef = useRef(isSearching)
  isSearchingRef.current = isSearching
  const onSelectFileRef = useRef(onSelectFile)
  onSelectFileRef.current = onSelectFile

  // Stable id-based callbacks for LocalFolderFileItem
  const handleClickFile = useCallback((relativePath: string) => {
    const file = displayFilesRef.current.find((f) => f.relative_path === relativePath)
    if (file) onSelectFileRef.current?.(file)
  }, [])

  const handleContextMenuFile = useCallback((relativePath: string, event: React.MouseEvent) => {
    openContextMenu(event, { kind: 'file', relativePath })
  }, [openContextMenu])

  // Hover preview callbacks
  const handleMouseEnterFile = useCallback((relativePath: string, element: HTMLElement) => {
    const nbId = notebookIdRef.current
    if (!nbId) return
    const localId = createLocalResourceId(nbId, relativePath)
    const metadata = metadataByIdRef.current?.[localId]

    // Clear timers
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }

    if (!metadata?.ai_summary) {
      if (hoveredPreviewRef.current !== null) {
        setHoveredPreview(null)
        setPreviewAnchor(null)
      }
      return
    }

    const previewData = { id: localId, ai_summary: metadata.ai_summary }
    const tags = mergeLocalMetadataTags(metadata.tags, metadata.ai_tags)
    const isPopoverVisible = hoveredPreviewRef.current !== null

    if (isPopoverVisible) {
      setHoveredPreview(previewData)
      setHoveredPreviewTags(tags)
      setPreviewAnchor(element)
    } else {
      hoverTimerRef.current = setTimeout(() => {
        setHoveredPreview(previewData)
        setHoveredPreviewTags(tags)
        setPreviewAnchor(element)
      }, 1500)
    }
  }, [])

  const handleFileMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    closeTimerRef.current = setTimeout(() => {
      setHoveredPreview(null)
      setPreviewAnchor(null)
    }, 100)
  }, [])

  const handlePopoverMouseEnter = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  const closePreview = useCallback(() => {
    setHoveredPreview(null)
    setPreviewAnchor(null)
  }, [])

  // Cleanup hover timers on unmount
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    }
  }, [])

  // Clear hover on searchQuery change
  useEffect(() => {
    setHoveredPreview(null)
    setPreviewAnchor(null)
  }, [searchQuery])

  // Clear hover on selectedFolderPath change
  useEffect(() => {
    setHoveredPreview(null)
    setPreviewAnchor(null)
  }, [selectedFolderPath])

  // Sync hoveredPreview when localNoteMetadataById changes.
  // Read hoveredPreview via ref to avoid deps cascade (effect sets hoveredPreview).
  useEffect(() => {
    const current = hoveredPreviewRef.current
    if (!current || !localNoteMetadataById) return
    const metadata = localNoteMetadataById[current.id]
    if (!metadata) {
      setHoveredPreview(null)
      setPreviewAnchor(null)
      return
    }
    if (metadata.ai_summary !== current.ai_summary) {
      setHoveredPreview({ id: current.id, ai_summary: metadata.ai_summary })
    }
    const newTags = mergeLocalMetadataTags(metadata.tags, metadata.ai_tags)
    setHoveredPreviewTags((prev) => {
      if (prev.length !== newTags.length) return newTags
      const same = prev.every((t, i) => t.id === newTags[i].id && t.name === newTags[i].name && t.source === newTags[i].source)
      return same ? prev : newTags
    })
  }, [localNoteMetadataById])

  const contextMenuItems = useMemo<ContextMenuItem[]>(() => {
    const target = contextMenu.target
    if (!target) return []

    if (target.kind === 'root') {
      return [
        {
          label: t.notebook.createSubfolder,
          onClick: () => onCreateFolder?.(null),
          disabled: !canCreateFolder || !onCreateFolder,
        },
      ]
    }

    if (target.kind === 'folder') {
      const canCreateChildFolder = canCreateFolder
        && getRelativePathDepth(target.relativePath) < MAX_FOLDER_RELATIVE_DEPTH
      const folderItems: ContextMenuItem[] = []
      if (canCreateChildFolder && onCreateFolder) {
        folderItems.push({
          label: t.notebook.createSubfolder,
          onClick: () => onCreateFolder(target.relativePath),
        })
      }
      if (folderItems.length > 0) {
        folderItems.push({ label: '', onClick: () => {}, divider: true })
      }
      return [
        ...folderItems,
        {
          label: t.actions.rename,
          onClick: () => onRenameEntry?.({ kind: 'folder', relativePath: target.relativePath }),
          disabled: !canManageEntries || !onRenameEntry,
        },
        {
          label: t.actions.delete,
          onClick: () => onDeleteEntry?.({ kind: 'folder', relativePath: target.relativePath }),
          disabled: !canManageEntries || !onDeleteEntry,
          danger: true,
        },
      ]
    }

    return [
      {
        label: t.actions.rename,
        onClick: () => onRenameEntry?.({ kind: 'file', relativePath: target.relativePath }),
        disabled: !canManageEntries || !onRenameEntry,
      },
      {
        label: t.actions.delete,
        onClick: () => onDeleteEntry?.({ kind: 'file', relativePath: target.relativePath }),
        disabled: !canManageEntries || !onDeleteEntry,
        danger: true,
      },
    ]
  }, [
    canCreateFolder,
    canManageEntries,
    contextMenu.target,
    onCreateFolder,
    onDeleteEntry,
    onRenameEntry,
    t.actions.delete,
    t.actions.rename,
    t.notebook.createSubfolder,
  ])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const activeEl = document.activeElement as HTMLElement | null
      const isInMiddleColumn = Boolean(activeEl?.closest('[data-note-list]'))
      const isInMiddleArea = Boolean(activeEl?.closest('[data-note-list], [data-sidebar]'))
      const isInEditable = Boolean(activeEl?.closest('input, textarea, [contenteditable="true"], .ProseMirror'))

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        if (isInMiddleArea && !searchDisabled) {
          event.preventDefault()
          setIsSearching(true)
          setTimeout(() => searchInputRef.current?.focus(), 0)
        }
      }

      const hasModifier = event.metaKey || event.ctrlKey || event.altKey
      if (
        (event.key === 'ArrowUp' || event.key === 'ArrowDown')
        && !hasModifier
        && isInMiddleColumn
        && !isInEditable
        && displayFilesRef.current.length > 0
      ) {
        const currentSelectedPath = selectedFilePathRef.current
        if (!currentSelectedPath) return
        const currentIndex = displayFilesRef.current.findIndex((file) => file.relative_path === currentSelectedPath)
        if (currentIndex < 0) return

        const nextIndex = event.key === 'ArrowUp'
          ? Math.max(0, currentIndex - 1)
          : Math.min(displayFilesRef.current.length - 1, currentIndex + 1)
        if (nextIndex === currentIndex) return

        event.preventDefault()
        const nextFile = displayFilesRef.current[nextIndex]
        onSelectFileRef.current?.(nextFile)
      }

      if (event.key === 'Escape' && isSearchingRef.current) {
        handleCloseSearch()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleCloseSearch, searchDisabled])

  useEffect(() => {
    if (!selectedFilePath) return
    const container = fileListContainerRef.current
    if (!container) return
    let selectedElement: HTMLElement | null = null
    const candidates = container.querySelectorAll<HTMLElement>('[data-local-file-path]')
    for (const candidate of candidates) {
      if (candidate.dataset.localFilePath === selectedFilePath) {
        selectedElement = candidate
        break
      }
    }
    selectedElement?.scrollIntoView?.({ block: 'nearest' })
  }, [displayFiles, selectedFilePath])

  const showSearchNoResultState = hasSearchQuery && !searchLoading && searchMatchedPaths !== null && displayFiles.length === 0
  const showEmptyState = !showSearchNoResultState && displayFiles.length === 0

  const renderFolderTree = useCallback((nodes: LocalFolderTreeNode[], depth = 0): ReactNode => {
    return nodes
      .filter((node) => node.kind === 'folder')
      .map((node) => {
        const hasChildren = Boolean(node.children && node.children.length > 0)
        const isExpanded = expandedFolders.has(node.relative_path)
        const isSelected = selectedFolderPath === node.relative_path

        return (
          <div key={node.id}>
            <div
              className={`flex items-center rounded-md text-[0.8rem] transition-colors ${
                isSelected
                  ? 'text-[var(--color-text)] bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)]'
              }`}
              style={{ paddingLeft: `${6 + depth * 14}px` }}
              onContextMenu={(event) => {
                openContextMenu(event, { kind: 'folder', relativePath: node.relative_path })
              }}
            >
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  if (hasChildren) {
                    toggleFolderExpand(node.relative_path)
                  }
                }}
                className={`p-0.5 rounded-sm ${hasChildren ? 'hover:bg-black/5 dark:hover:bg-white/10' : 'opacity-0 pointer-events-none'}`}
                aria-label={hasChildren ? (isExpanded ? 'Collapse folder' : 'Expand folder') : undefined}
              >
                <svg className={`w-3 h-3 text-[var(--color-muted)] transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 5l7 7-7 7" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => onSelectFolder(node.relative_path)}
                className="flex-1 min-w-0 text-left px-1.5 py-1"
              >
                <span className="inline-flex items-center gap-1.5 min-w-0">
                  <svg className="w-3.5 h-3.5 text-[var(--color-muted)] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  <span className="truncate">{node.name}</span>
                </span>
              </button>
            </div>

            {hasChildren && isExpanded && (
              <div className="mt-0.5">
                {renderFolderTree(node.children || [], depth + 1)}
              </div>
            )}
          </div>
        )
      })
  }, [expandedFolders, selectedFolderPath, openContextMenu, toggleFolderExpand, onSelectFolder])

  return (
    <div className="w-56 flex-shrink-0 h-full bg-[var(--color-card-solid)] border-r border-[var(--color-divider)] flex flex-col drag-region" data-note-list>
      <div className="px-4 h-[42px] flex items-center justify-between flex-shrink-0 border-b border-black/5 dark:border-white/5">
        {isSearching ? (
          <div className="flex-1 flex items-center gap-2 no-drag min-w-0">
            {shouldHideTitle && <div className="w-[28px] flex-shrink-0" />}
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              onCompositionStart={() => onSearchCompositionStart?.()}
              onCompositionEnd={(event) => onSearchCompositionEnd?.(event.currentTarget.value)}
              onBlur={() => {
                if (!searchQuery.trim()) {
                  handleCloseSearch()
                }
              }}
              placeholder={t.noteList.searchPlaceholder}
              disabled={searchDisabled}
              className="flex-1 min-w-0 bg-transparent text-[1rem] text-[var(--color-text)] placeholder-[var(--color-muted)] outline-none disabled:opacity-60"
            />
            <button
              type="button"
              onClick={handleCloseSearch}
              className="p-1.5 flex-shrink-0 rounded-md text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ) : (
          <>
            {!shouldHideTitle && (
              <h2 className="text-[1rem] font-semibold text-[var(--color-text)] select-none truncate min-w-0 flex-1" title={title}>
                {title}
              </h2>
            )}
            {shouldHideTitle && <div className="flex-1" />}
            <div className="flex items-center gap-1 no-drag flex-shrink-0">
              <button
                type="button"
                onClick={() => setIsSearching(true)}
                disabled={searchDisabled}
                className="p-1.5 rounded-md text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                title={t.noteList.search}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </button>
              <Tooltip content={`${t.notebook.createFile} (${formatShortcut('Command+N')})`} placement="bottom">
                <button
                  type="button"
                  onClick={onCreateFile}
                  disabled={!canCreateFile}
                  className="p-1.5 rounded-md text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                  title={t.notebook.createFile}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              </Tooltip>
            </div>
          </>
        )}
      </div>

      {showFolderTree ? (
        <div className="px-2 py-2 border-b border-black/5 dark:border-white/5 no-drag">
          {searchLoading && (
            <p className="mb-1 text-[0.7rem] text-[var(--color-muted)] px-1">
              {t.common?.loading || 'Loading...'}
            </p>
          )}

          <button
            type="button"
            onClick={() => onSelectFolder(null)}
            onContextMenu={(event) => {
              openContextMenu(event, { kind: 'root' })
            }}
            className={`w-full text-left px-2 py-1 rounded-md text-[0.8rem] transition-colors ${
              selectedFolderPath === null
                ? 'text-[var(--color-text)] bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)]'
                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)]'
            }`}
          >
            {t.noteList.allNotes}
          </button>

          <div className="mt-1 max-h-[180px] overflow-auto hide-scrollbar">
            {treeNodes.length > 0 ? (
              renderFolderTree(treeNodes)
            ) : (
              <p className="px-2 py-1 text-[0.75rem] text-[var(--color-muted)] select-none">
                {t.noteList.empty}
              </p>
            )}
          </div>
        </div>
      ) : searchLoading ? (
        <div className="px-3 py-1 border-b border-black/5 dark:border-white/5 no-drag">
          <p className="text-[0.7rem] text-[var(--color-muted)]">
            {t.common?.loading || 'Loading...'}
          </p>
        </div>
      ) : null}

      <div ref={fileListContainerRef} className="flex-1 overflow-y-auto no-drag hide-scrollbar">
        {showSearchNoResultState ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--color-muted)] px-6">
            <svg className="w-10 h-10 mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <p className="text-[0.867rem] text-center select-none">{t.noteList.noResults}</p>
          </div>
        ) : showEmptyState ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--color-muted)] px-6">
            <svg className="w-10 h-10 mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-[0.867rem] text-center mb-2 select-none">{t.noteList.empty}</p>
            {canCreateFile && onCreateFile && (
              <button
                type="button"
                onClick={onCreateFile}
                className="text-[0.867rem] text-[var(--color-accent)] hover:underline select-none"
              >
                {t.noteList.newNote}
              </button>
            )}
          </div>
        ) : (
          <div className="pb-1">
            {displayFiles.map((file, index) => {
              const isSelected = selectedFilePath === file.relative_path
              const nextFile = displayFiles[index + 1]
              const isNextSelected = nextFile ? selectedFilePath === nextFile.relative_path : false
              const hideDivider = isSelected || isNextSelected
              return (
                <LocalFolderFileItem
                  key={file.id}
                  file={file}
                  isSelected={isSelected}
                  hideDivider={hideDivider}
                  dateT={t.date}
                  onClickFile={handleClickFile}
                  onContextMenuFile={handleContextMenuFile}
                  onMouseEnterFile={handleMouseEnterFile}
                  onMouseLeaveFile={handleFileMouseLeave}
                />
              )
            })}
          </div>
        )}
      </div>

      {/* Note Preview Popover */}
      {hoveredPreview && previewAnchor && (
        <NotePreviewPopover
          note={hoveredPreview}
          anchorEl={previewAnchor}
          onClose={closePreview}
          onMouseEnter={handlePopoverMouseEnter}
          preloadedTags={hoveredPreviewTags}
        />
      )}

      <ContextMenu
        visible={contextMenu.visible}
        x={contextMenu.x}
        y={contextMenu.y}
        items={contextMenuItems}
        onClose={closeContextMenu}
      />
    </div>
  )
}

export default LocalFolderNoteList
