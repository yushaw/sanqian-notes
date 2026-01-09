import { useEffect, useRef, useCallback, useState } from 'react'
import { Editor } from '@tiptap/react'
import { useTranslations } from '../i18n'
import { shortcuts } from '../utils/shortcuts'
import { useAIWriting } from '../hooks/useAIWriting'
import { useAIActions } from '../hooks/useAIActions'
import { SLASH_AI_ACTION_EVENT, type SlashAIActionDetail } from './extensions/SlashCommand'
import { getAIContext, type AIContext, formatAIPrompt } from '../utils/aiContext'
import { createPopup, updatePopupContent, updatePopupStreaming, deletePopup } from '../utils/popupStorage'
import { toast } from '../utils/toast'
import { v4 as uuidv4 } from 'uuid'
import { generateBlockId } from './extensions/BlockId'

// 时间常量
const CLEANUP_DELAY_MS = 300

interface ContextMenuPosition {
  x: number
  y: number
}

interface EditorContextMenuProps {
  editor: Editor | null
  position: ContextMenuPosition | null
  onClose: () => void
  hasSelection: boolean
  onOpenAgentTask?: (blockIds: string[], taskId: string | null, blockContent: string) => void
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
  sparkles: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
      <path d="M5 3v4" />
      <path d="M19 17v4" />
      <path d="M3 5h4" />
      <path d="M17 19h4" />
    </svg>
  ),
  agent: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="10" rx="2" />
      <circle cx="12" cy="5" r="2" />
      <path d="M12 7v4" />
      <line x1="8" y1="16" x2="8" y2="16" strokeWidth="3" strokeLinecap="round" />
      <line x1="16" y1="16" x2="16" y2="16" strokeWidth="3" strokeLinecap="round" />
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
  { id: 'footnote', label: t.contextMenu.footnote, icon: '¹', insert: (editor: Editor) => editor.chain().focus().setFootnote().run() },
]

// AI 操作项配置现在从数据库动态加载

export function EditorContextMenu({ editor, position, onClose, hasSelection, onOpenAgentTask }: EditorContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const insertSubmenuRef = useRef<HTMLDivElement>(null)
  const tableSubmenuRef = useRef<HTMLDivElement>(null)
  const aiSubmenuRef = useRef<HTMLDivElement>(null)
  const t = useTranslations()
  const insertItems = getInsertItems(t)

  // Load AI actions from database
  const { getContextMenuActions } = useAIActions()
  const aiActions = getContextMenuActions()
  const [showInsertSubmenu, setShowInsertSubmenu] = useState(false)
  const [insertSubmenuPosition, setInsertSubmenuPosition] = useState({ top: 0, left: 0 })
  const [showTableSubmenu, setShowTableSubmenu] = useState(false)
  const [tableSubmenuPosition, setTableSubmenuPosition] = useState({ top: 0, left: 0 })
  const [showAISubmenu, setShowAISubmenu] = useState(false)
  const [aiSubmenuPosition, setAISubmenuPosition] = useState({ top: 0, left: 0 })
  const [aiContext, setAIContext] = useState<AIContext | null>(null)
  const closeTimeoutRef = useRef<number | null>(null)
  // Track current temp popup ID for cleanup (race condition prevented by useAIWriting's processingLockRef)
  const currentTempPopupIdRef = useRef<string | null>(null)

  // 清理当前临时图标的函数
  const cleanupTempIcon = useCallback(() => {
    const tempPopupId = currentTempPopupIdRef.current
    if (!tempPopupId || !editor) return

    // 查找并删除临时图标
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'aiPopupMark' && node.attrs.popupId === tempPopupId) {
        editor.chain().deleteRange({ from: pos, to: pos + 1 }).run()
        return false
      }
      return true
    })

    // 清理存储
    deletePopup(tempPopupId)
    currentTempPopupIdRef.current = null
  }, [editor])

  // AI Writing hook
  const { isProcessing, executeAction } = useAIWriting({
    editor,
    onComplete: () => {
      // 延迟清理临时图标
      setTimeout(cleanupTempIcon, CLEANUP_DELAY_MS)
      // Focus editor after AI completes
      editor?.commands.focus()
    },
    onError: (errorCode) => {
      // 出错时也清理临时图标
      cleanupTempIcon()
      console.error('[AI Writing] Error code:', errorCode)
      // Error codes: 'connectionFailed' | 'disconnected' | 'generic'
      // Could show toast notification using t.ai.errorConnectionFailed etc.
    }
  })

  // 处理中时显示等待光标
  useEffect(() => {
    if (isProcessing) {
      document.body.style.cursor = 'wait'
      return () => {
        document.body.style.cursor = ''
      }
    }
  }, [isProcessing])

  // Check if cursor is in a table
  const isInTable = editor?.isActive('table') ?? false

  // 重置子菜单状态当菜单关闭或位置变化时
  useEffect(() => {
    setShowInsertSubmenu(false)
    setShowTableSubmenu(false)
    setShowAISubmenu(false)
  }, [position])

  // 清除关闭延时
  const clearCloseTimeout = useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current)
      closeTimeoutRef.current = null
    }
  }, [])

  // 组件卸载时清理 timeout，避免内存泄漏
  useEffect(() => {
    return () => clearCloseTimeout()
  }, [clearCloseTimeout])

  // 延迟关闭插入子菜单
  const scheduleCloseInsertSubmenu = useCallback(() => {
    clearCloseTimeout()
    closeTimeoutRef.current = window.setTimeout(() => {
      setShowInsertSubmenu(false)
    }, 300)
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
    }, 300)
  }, [clearCloseTimeout])

  // 保持表格子菜单打开
  const keepTableSubmenuOpen = useCallback(() => {
    clearCloseTimeout()
    setShowTableSubmenu(true)
  }, [clearCloseTimeout])

  // 延迟关闭 AI 子菜单
  const scheduleCloseAISubmenu = useCallback(() => {
    clearCloseTimeout()
    closeTimeoutRef.current = window.setTimeout(() => {
      setShowAISubmenu(false)
    }, 300)
  }, [clearCloseTimeout])

  // 保持 AI 子菜单打开
  const keepAISubmenuOpen = useCallback(() => {
    clearCloseTimeout()
    setShowAISubmenu(true)
  }, [clearCloseTimeout])

  // 显示 AI 子菜单
  const handleShowAISubmenu = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    // 关闭其他子菜单
    setShowInsertSubmenu(false)
    setShowTableSubmenu(false)
    clearCloseTimeout()

    const rect = e.currentTarget.getBoundingClientRect()
    const submenuWidth = 160
    const submenuHeight = aiActions.length * 32 + 8

    let left = rect.right - 2
    if (rect.right + submenuWidth > window.innerWidth) {
      left = rect.left - submenuWidth + 2
    }

    let top = rect.top
    if (rect.top + submenuHeight > window.innerHeight) {
      top = window.innerHeight - submenuHeight - 10
    }

    // Get AI context (target + surrounding text)
    if (editor) {
      const context = getAIContext(editor)
      setAIContext(context)
    }

    setAISubmenuPosition({ top, left })
    setShowAISubmenu(true)
  }, [editor, aiActions.length, clearCloseTimeout])

  // 启动 popup 模式的 AI 流式请求
  const startPopupStream = useCallback(async (popupId: string, prompt: string, context: AIContext) => {
    const streamId = popupId // 使用 popupId 作为 streamId
    let accumulated = ''

    // 标记开始 streaming
    updatePopupStreaming(popupId, true)

    try {
      await window.electron.chat.acquireReconnect()

      const cleanup = window.electron.chat.onStreamEvent((sid: string, rawEvent: unknown) => {
        if (sid !== streamId) return
        const event = rawEvent as { type: string; content?: string }

        if (event.type === 'text' && event.content) {
          accumulated += event.content
          // 更新存储 (hover 预览会从 popupStorage 读取)
          updatePopupContent(popupId, accumulated)
        }

        if (event.type === 'done' || event.type === 'error') {
          // 标记结束 streaming
          updatePopupStreaming(popupId, false)
          cleanup()
          window.electron.chat.releaseReconnect()
        }
      })

      const { prompt: fullPrompt } = formatAIPrompt(context, prompt)
      await window.electron.chat.stream({
        streamId,
        agentId: 'writing',
        messages: [{ role: 'user', content: fullPrompt }]
      })
    } catch (err) {
      console.error('[Popup] Stream error:', err)
      // 连接失败：删除 sparkles icon 和 popup 数据，显示 toast
      updatePopupStreaming(popupId, false)
      deletePopup(popupId)
      // 删除编辑器中的 AIPopupMark 节点
      editor?.commands.deleteAIPopupMark(popupId)
      // 显示错误提示
      toast(t.ai.connectionFailed, { type: 'error' })
      window.electron.chat.releaseReconnect()
    }
  }, [editor, t.ai.connectionFailed])

  // 处理 popup 模式的 AI 操作
  const handlePopupAction = useCallback((prompt: string, actionName: string, context: AIContext) => {
    if (!editor) return

    // 1. 生成 popupId
    const popupId = uuidv4()

    // 2. 创建 popup 数据并标记为 streaming
    createPopup({
      popupId,
      prompt,
      actionName,
      context: {
        targetText: context.target,
        documentTitle: context.documentTitle
      }
    })
    updatePopupStreaming(popupId, true) // 立即标记为 streaming，让 sparkles 图标显示动画

    // 3. 在选区结束位置插入 AIPopupMark 节点（先将光标移到选区末尾，避免覆盖选中内容）
    editor.chain()
      .focus()
      .setTextSelection(context.targetTo)  // 移动光标到选区末尾
      .insertAIPopupMark({ popupId })
      .run()

    // 4. 开始流式请求 (不再打开独立 popup 窗口，只用 hover 预览)
    startPopupStream(popupId, prompt, context)
  }, [editor, startPopupStream])

  // 处理 AI 操作
  const handleAIAction = useCallback((action: AIAction) => {
    if (!aiContext || !editor) return

    if (action.mode === 'popup') {
      // Popup 模式：插入图标 + 打开独立窗口
      setShowAISubmenu(false)
      handlePopupAction(action.prompt, action.name, aiContext)
      onClose()
    } else {
      // Replace/Insert 模式：插入临时图标 + 执行操作 + 完成后删除图标
      setShowAISubmenu(false)

      // 1. 生成临时 popupId
      const tempPopupId = uuidv4()
      currentTempPopupIdRef.current = tempPopupId

      // 2. 创建临时 popup 数据（用于 streaming 状态）
      createPopup({
        popupId: tempPopupId,
        prompt: action.prompt,
        actionName: action.name,
        context: {
          targetText: aiContext.target,
          documentTitle: aiContext.documentTitle
        }
      })
      updatePopupStreaming(tempPopupId, true)

      // 3. 在选区结束位置插入临时图标
      editor.chain()
        .focus()
        .setTextSelection(aiContext.targetTo)
        .insertAIPopupMark({ popupId: tempPopupId })
        .run()

      // 4. 执行 AI 操作（完成后会通过 onComplete 回调清理图标）
      const insertMode = action.mode === 'insert' ? 'insertAfter' : 'replace'
      executeAction(action.prompt, aiContext, insertMode)

      onClose()
    }
  }, [executeAction, aiContext, editor, onClose, handlePopupAction])

  // 处理 Agent 任务
  const handleAgentTask = useCallback(() => {
    if (!editor) return

    const { from, to } = editor.state.selection
    const hasSelection = from !== to

    // 收集选中范围内的所有 block 节点
    interface BlockInfo {
      node: NonNullable<typeof editor.state.doc.firstChild>
      pos: number
    }
    const selectedBlocks: BlockInfo[] = []

    if (hasSelection) {
      // 有选区时，遍历选区内的所有 block
      editor.state.doc.nodesBetween(from, to, (node, pos) => {
        // 检查是否是块级节点（有 blockId 属性定义）
        if (node.type.spec.attrs && 'blockId' in node.type.spec.attrs) {
          selectedBlocks.push({ node, pos })
          return false // 不递归进入子节点
        }
        return true
      })
    }

    // 如果没有选中 block，回退到光标所在的 block
    if (selectedBlocks.length === 0) {
      const { $from } = editor.state.selection
      const resolvedPos = editor.state.doc.resolve($from.pos)

      // 向上查找最近的块级节点
      for (let d = resolvedPos.depth; d >= 0; d--) {
        const node = resolvedPos.node(d)
        if (node.type.spec.attrs && 'blockId' in node.type.spec.attrs) {
          selectedBlocks.push({ node, pos: resolvedPos.before(d) })
          break
        }
      }
    }

    if (selectedBlocks.length === 0) {
      console.warn('No block node found at cursor position')
      return
    }

    // 使用事务批量更新没有 blockId 的节点，并收集所有 blockId
    let tr = editor.state.tr
    const blockIds: string[] = []
    let taskId: string | null = null

    for (const { node, pos } of selectedBlocks) {
      let blockId = node.attrs.blockId
      if (!blockId) {
        blockId = generateBlockId()
        try {
          tr = tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            blockId,
          })
        } catch (e) {
          // 某些节点类型（如包含特殊内联节点的 paragraph）可能不支持 setNodeMarkup
          console.warn('Failed to set blockId for node:', node.type.name, e)
        }
      }
      blockIds.push(blockId)
      // 只取第一个 block 的 taskId（用于关联任务）
      if (taskId === null) {
        taskId = node.attrs.agentTaskId ?? null
      }
    }

    // 如果有更新，一次性 dispatch
    if (tr.docChanged) {
      editor.view.dispatch(tr)
    }

    // 合并所有选中 block 的内容
    const blockContent = selectedBlocks
      .map(({ node }) => node.textContent || '')
      .filter(text => text.trim())
      .join('\n\n')

    setShowAISubmenu(false)
    onClose()

    // 调用回调打开面板（传递所有 blockId）
    onOpenAgentTask?.(blockIds, taskId, blockContent)
  }, [editor, onClose, onOpenAgentTask])

  // 点击外部关闭菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      const isInsideMenu = menuRef.current?.contains(target)
      const isInsideInsertSubmenu = insertSubmenuRef.current?.contains(target)
      const isInsideTableSubmenu = tableSubmenuRef.current?.contains(target)
      const isInsideAISubmenu = aiSubmenuRef.current?.contains(target)

      if (!isInsideMenu && !isInsideInsertSubmenu && !isInsideTableSubmenu && !isInsideAISubmenu) {
        onClose()
      }
    }

    const handleScroll = (e: Event) => {
      // 如果滚动发生在子菜单内部，不关闭菜单
      const target = e.target as Node
      if (
        insertSubmenuRef.current?.contains(target) ||
        tableSubmenuRef.current?.contains(target) ||
        aiSubmenuRef.current?.contains(target)
      ) {
        return
      }
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

  // AI 快捷键监听（全局）
  useEffect(() => {
    const handleAIShortcut = (e: KeyboardEvent) => {
      // 忽略输入框中的按键
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

      if (!editor) return

      // 构建按键字符串
      const parts: string[] = []
      if (e.metaKey) parts.push('⌘')
      if (e.ctrlKey) parts.push('⌃')
      if (e.altKey) parts.push('⌥')
      if (e.shiftKey) parts.push('⇧')

      let key = e.key.toUpperCase()
      if (key === ' ') key = 'Space'
      parts.push(key)
      const pressedShortcut = parts.join('')

      // 查找匹配的 AI 操作
      const matchedAction = aiActions.find(
        action => action.shortcutKey && action.shortcutKey === pressedShortcut
      )

      if (matchedAction) {
        e.preventDefault()
        e.stopPropagation()

        // 获取 AI 上下文
        const context = getAIContext(editor)
        if (!context) return

        if (matchedAction.mode === 'popup') {
          // Popup 模式：插入图标 + 打开独立窗口
          handlePopupAction(matchedAction.prompt, matchedAction.name, context)
        } else {
          // 直接执行 AI 操作
          const insertMode = matchedAction.mode === 'insert' ? 'insertAfter' : 'replace'
          executeAction(matchedAction.prompt, context, insertMode)
        }
      }
    }

    // 使用 capture: true 使 AI 快捷键优先于编辑器内置快捷键（如 Cmd+B 加粗）
    document.addEventListener('keydown', handleAIShortcut, { capture: true })
    return () => document.removeEventListener('keydown', handleAIShortcut, { capture: true })
  }, [editor, aiActions, executeAction, handlePopupAction])

  // 监听 Slash Command 触发的 AI 操作
  useEffect(() => {
    const handleSlashAIAction = (e: Event) => {
      const detail = (e as CustomEvent<SlashAIActionDetail>).detail
      if (!detail || !editor) return

      const { prompt, mode, actionName } = detail

      // 获取 AI 上下文（选中文本或当前 block）
      const context = getAIContext(editor)
      if (!context) {
        console.warn('[SlashCommand] AI action requires content (selection or block)')
        return
      }

      if (mode === 'popup') {
        // Popup 模式：插入图标 + 打开独立窗口
        handlePopupAction(prompt, actionName, context)
      } else {
        // 执行 replace/insert 操作
        const insertMode = mode === 'insert' ? 'insertAfter' : 'replace'
        executeAction(prompt, context, insertMode)
      }
    }

    window.addEventListener(SLASH_AI_ACTION_EVENT, handleSlashAIAction)
    return () => window.removeEventListener(SLASH_AI_ACTION_EVENT, handleSlashAIAction)
  }, [editor, executeAction, handlePopupAction])

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
    // 关闭其他子菜单
    setShowTableSubmenu(false)
    setShowAISubmenu(false)
    clearCloseTimeout()

    const rect = e.currentTarget.getBoundingClientRect()
    const submenuWidth = 160
    const submenuHeight = insertItems.length * 32 + 8

    let left = rect.right - 2
    if (rect.right + submenuWidth > window.innerWidth) {
      left = rect.left - submenuWidth + 2
    }

    let top = rect.top
    if (rect.top + submenuHeight > window.innerHeight) {
      top = window.innerHeight - submenuHeight - 10
    }

    setInsertSubmenuPosition({ top, left })
    setShowInsertSubmenu(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- insertItems.length is derived from translations which changes rarely
  }, [clearCloseTimeout])

  // 插入内容
  const handleInsert = useCallback((insertFn: (editor: Editor) => void) => {
    if (!editor) return
    insertFn(editor)
    onClose()
  }, [editor, onClose])

  // 显示表格子菜单
  const handleShowTableSubmenu = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    // 关闭其他子菜单
    setShowInsertSubmenu(false)
    setShowAISubmenu(false)
    clearCloseTimeout()

    const rect = e.currentTarget.getBoundingClientRect()
    const submenuWidth = 160
    const submenuHeight = 7 * 32 + 8

    let left = rect.right - 2
    if (rect.right + submenuWidth > window.innerWidth) {
      left = rect.left - submenuWidth + 2
    }

    let top = rect.top
    if (rect.top + submenuHeight > window.innerHeight) {
      top = window.innerHeight - submenuHeight - 10
    }

    setTableSubmenuPosition({ top, left })
    setShowTableSubmenu(true)
  }, [clearCloseTimeout])

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

  // 如果没有编辑器，不渲染
  if (!editor) return null

  // 调整菜单位置，确保不超出视口
  const adjustedPosition = position ? { ...position } : null
  const menuWidth = 220
  // 有选中: 编辑行(40) + 段落行(40) + 格式行(40) + AI(32) + 插入(32) + 分隔线 ≈ 220
  // 无选中: 编辑行(40) + 段落行(40) + AI(32) + 插入(32) + 分隔线 ≈ 180
  const menuHeight = hasSelection ? 220 : 180

  if (adjustedPosition) {
    if (adjustedPosition.x + menuWidth > window.innerWidth) {
      adjustedPosition.x = window.innerWidth - menuWidth - 10
    }
    if (adjustedPosition.y + menuHeight > window.innerHeight) {
      adjustedPosition.y = window.innerHeight - menuHeight - 10
    }
  }

  return (
    <>
      {/* 右键菜单 - 仅当有位置时渲染 */}
      {adjustedPosition && (
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
            title={t.toolbar.heading4}
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

        {/* AI 操作组 - 始终显示，支持选中文本或当前段落 */}
        <div className="context-menu-group">
          <button
            className={`context-menu-item ${isProcessing ? 'context-menu-item-disabled' : ''}`}
            onMouseEnter={handleShowAISubmenu}
            onMouseLeave={scheduleCloseAISubmenu}
            disabled={isProcessing}
          >
            <span className="context-menu-icon">{Icons.sparkles}</span>
            <span className="context-menu-label">
              {isProcessing ? t.contextMenu.aiProcessing : t.contextMenu.ai}
            </span>
            <span className="context-menu-arrow">{Icons.chevronRight}</span>
          </button>
        </div>

        {/* Agent 任务 - 独立菜单项 */}
        {onOpenAgentTask && (
          <div className="context-menu-group">
            <button
              className="context-menu-item"
              onClick={handleAgentTask}
            >
              <span className="context-menu-icon">{Icons.agent}</span>
              <span className="context-menu-label">{t.contextMenu.agentTask || 'Agent Task'}</span>
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
      )}

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

      {/* AI 子菜单 */}
      {showAISubmenu && (
        <div
          ref={aiSubmenuRef}
          className="editor-context-menu editor-context-submenu"
          style={{
            position: 'fixed',
            left: aiSubmenuPosition.left,
            top: aiSubmenuPosition.top,
            zIndex: 10000
          }}
          onMouseEnter={keepAISubmenuOpen}
          onMouseLeave={scheduleCloseAISubmenu}
        >
          {aiActions.map((action) => (
            <button
              key={action.id}
              className="context-menu-item"
              onClick={() => handleAIAction(action)}
            >
              <span className="context-menu-icon context-menu-icon-text">{action.icon}</span>
              <span className="context-menu-label">{action.name}</span>
            </button>
          ))}
        </div>
      )}
    </>
  )
}
