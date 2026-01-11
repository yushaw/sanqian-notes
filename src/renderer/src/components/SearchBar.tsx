/**
 * SearchBar Component
 *
 * 编辑器内搜索替换栏 UI 组件
 * - 支持大小写敏感、正则表达式选项
 * - 支持上/下一个结果导航
 * - 支持替换当前/全部替换
 * - 快捷键：Enter 下一个，⇧Enter 上一个，Esc 关闭
 */

import { Editor } from '@tiptap/react'
import { motion, AnimatePresence } from 'framer-motion'
import { useCallback, useEffect, useRef, useState } from 'react'
import { editorSearchPluginKey, scrollToMatch, type EditorSearchState } from './extensions/EditorSearch'
import { useTranslations } from '../i18n/context'
import { Tooltip } from './Tooltip'
import { isWindows } from '../utils/platform'

interface SearchBarProps {
  editor: Editor
  onClose: () => void
}

export function SearchBar({ editor, onClose }: SearchBarProps) {
  const t = useTranslations()
  const inputRef = useRef<HTMLInputElement>(null)
  const replaceInputRef = useRef<HTMLInputElement>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [replaceTerm, setReplaceTerm] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [useRegex, setUseRegex] = useState(false)
  const [showReplace, setShowReplace] = useState(false)

  // 获取搜索状态
  const [searchState, setSearchState] = useState<EditorSearchState | null>(null)

  // 监听编辑器状态变化
  useEffect(() => {
    const updateState = () => {
      const state = editorSearchPluginKey.getState(editor.state)
      setSearchState(state ?? null)
    }

    updateState()

    // 订阅编辑器更新，同时监听 focus 命令
    const handleTransaction = ({ transaction }: { transaction: import('@tiptap/pm/state').Transaction }) => {
      updateState()
      // 检查是否是 focus 命令，如果是则全选输入框
      const meta = transaction.getMeta(editorSearchPluginKey) as { type?: string } | undefined
      if (meta?.type === 'focus' && inputRef.current) {
        inputRef.current.focus()
        inputRef.current.select()
      }
    }
    editor.on('transaction', handleTransaction)

    return () => {
      editor.off('transaction', handleTransaction)
    }
  }, [editor])

  // 自动聚焦并填充选中文本
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()

      // 如果有选中文本，填入搜索框
      const { from, to } = editor.state.selection
      if (from !== to) {
        const selectedText = editor.state.doc.textBetween(from, to, ' ')
        if (selectedText && selectedText.length < 100) {
          setSearchTerm(selectedText)
          inputRef.current.select()
        }
      }
    }
  }, [editor])

  // 搜索防抖
  useEffect(() => {
    const timer = setTimeout(() => {
      editor.commands.setSearchTerm(searchTerm)
    }, 150)
    return () => clearTimeout(timer)
  }, [searchTerm, editor])

  // 选项变化时更新
  useEffect(() => {
    editor.commands.setSearchOptions({ caseSensitive, useRegex })
  }, [caseSensitive, useRegex, editor])

  // 展开替换栏时自动聚焦替换输入框
  useEffect(() => {
    if (showReplace && replaceInputRef.current) {
      replaceInputRef.current.focus()
    }
  }, [showReplace])

  // 首次搜索到结果时自动滚动到第一个匹配
  const prevMatchCount = useRef(0)
  useEffect(() => {
    const currentCount = searchState?.matches.length ?? 0
    const firstMatch = searchState?.matches[0]
    // 从 0 变为 >0 时，直接滚动到第一个结果（不调用 findNext 避免跳到第2个）
    if (prevMatchCount.current === 0 && currentCount > 0 && firstMatch) {
      scrollToMatch(editor, firstMatch)
    }
    prevMatchCount.current = currentCount
  }, [searchState?.matches.length, searchState?.matches, editor])

  // 全局 Esc 键监听
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        editor.commands.closeSearch()
        onClose()
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleGlobalKeyDown, { capture: true })
  }, [editor, onClose])

  // 键盘事件（Esc 由全局监听处理，这里只处理 Enter）
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        if (e.shiftKey) {
          editor.commands.findPrevious()
        } else {
          editor.commands.findNext()
        }
      }
    },
    [editor]
  )

  // 关闭搜索
  const handleClose = useCallback(() => {
    editor.commands.closeSearch()
    onClose()
  }, [editor, onClose])

  const matchCount = searchState?.matches.length ?? 0
  const currentIndex = searchState?.currentIndex ?? -1
  const regexError = searchState?.regexError ?? false

  // 状态显示
  const getStatusText = () => {
    if (!searchTerm) return ''
    if (regexError) return t.search?.regexError ?? '正则错误'
    if (matchCount === 0) return t.search?.noResults ?? '无结果'
    return `${currentIndex + 1}/${matchCount}`
  }

  const hasError = searchTerm.length > 0 && (regexError || matchCount === 0)

  // 替换当前
  const handleReplace = useCallback(() => {
    editor.commands.replaceCurrent(replaceTerm)
  }, [editor, replaceTerm])

  // 全部替换
  const handleReplaceAll = useCallback(() => {
    editor.commands.replaceAll(replaceTerm)
  }, [editor, replaceTerm])

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
      className="absolute top-0 left-0 right-0 z-[100] bg-[var(--color-card-solid)] border-b border-[var(--color-border)] isolate"
      style={{ pointerEvents: 'auto' }}
    >
      {/* 搜索行 */}
      <div className="flex items-center gap-2 px-3 h-[42px]">
        {/* Windows: 关闭按钮在左边 */}
        {isWindows() && (
          <Tooltip content={`${t.search?.close ?? '关闭'} (Esc)`} placement="bottom">
            <button
              onClick={handleClose}
              className="w-7 h-7 flex items-center justify-center rounded text-[var(--color-muted)]
                         hover:bg-[var(--color-surface-hover)] transition-colors flex-shrink-0"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </Tooltip>
        )}

        {/* 展开替换按钮 - 替换图标：上下交换箭头 */}
        <Tooltip content={t.search?.toggleReplace ?? '替换'} placement="bottom">
          <button
            onClick={() => setShowReplace(!showReplace)}
            className={`w-6 h-6 flex items-center justify-center rounded transition-all flex-shrink-0 border
                       ${showReplace
                         ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]'
                         : 'text-[var(--color-muted)] border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]'}`}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7h12l-3-3" />
              <path d="M3 7l3 3" />
              <path d="M21 17H9l3 3" />
              <path d="M21 17l-3-3" />
            </svg>
          </button>
        </Tooltip>

        {/* 搜索输入框 */}
        <div className="flex-1 min-w-0">
          <input
            ref={inputRef}
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t.search?.placeholder ?? '搜索...'}
            className={`w-full px-2 py-1 text-sm bg-[var(--color-bg)] border rounded
                       focus:outline-none transition-colors
                       ${
                         hasError
                           ? 'border-red-500 bg-red-50 dark:bg-red-950/20'
                           : 'border-[var(--color-border)] focus:border-[var(--color-accent)]'
                       }`}
          />
        </div>

        {/* 选项按钮 */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* 大小写敏感 */}
          <Tooltip content={t.search?.caseSensitive ?? '大小写敏感'} placement="bottom">
            <button
              onClick={() => setCaseSensitive(!caseSensitive)}
              className={`min-w-[28px] h-7 px-1.5 flex items-center justify-center rounded text-xs font-medium transition-colors border
                         ${
                           caseSensitive
                             ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]'
                             : 'text-[var(--color-muted)] border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]'
                         }`}
            >
              Aa
            </button>
          </Tooltip>

          {/* 正则表达式 */}
          <Tooltip content={t.search?.regex ?? '正则表达式'} placement="bottom">
            <button
              onClick={() => setUseRegex(!useRegex)}
              className={`min-w-[28px] h-7 px-1.5 flex items-center justify-center rounded text-xs font-medium transition-colors border
                         ${
                           useRegex
                             ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]'
                             : 'text-[var(--color-muted)] border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]'
                         }`}
            >
              .*
            </button>
          </Tooltip>
        </div>

        {/* 导航按钮 */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {/* 上一个 */}
          <Tooltip content={`${t.search?.previous ?? '上一个'} (⇧Enter)`} placement="bottom">
            <button
              onClick={() => editor.commands.findPrevious()}
              disabled={matchCount === 0}
              className="w-7 h-7 flex items-center justify-center rounded text-[var(--color-muted)]
                         hover:bg-[var(--color-surface-hover)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="18 15 12 9 6 15" />
              </svg>
            </button>
          </Tooltip>

          {/* 下一个 */}
          <Tooltip content={`${t.search?.next ?? '下一个'} (Enter)`} placement="bottom">
            <button
              onClick={() => editor.commands.findNext()}
              disabled={matchCount === 0}
              className="w-7 h-7 flex items-center justify-center rounded text-[var(--color-muted)]
                         hover:bg-[var(--color-surface-hover)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          </Tooltip>
        </div>

        {/* 结果计数 */}
        <span
          className={`text-xs min-w-[50px] text-center flex-shrink-0
                     ${hasError ? 'text-red-500' : 'text-[var(--color-muted)]'}`}
        >
          {getStatusText()}
        </span>

        {/* macOS: 关闭按钮在右边 */}
        {!isWindows() && (
          <Tooltip content={`${t.search?.close ?? '关闭'} (Esc)`} placement="bottom">
            <button
              onClick={handleClose}
              className="w-7 h-7 flex items-center justify-center rounded text-[var(--color-muted)]
                         hover:bg-[var(--color-surface-hover)] transition-colors flex-shrink-0"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </Tooltip>
        )}
      </div>

      {/* 替换行 */}
      <AnimatePresence>
        {showReplace && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-2 px-3 py-2 border-t border-[var(--color-border)]">
              {/* 占位，和上面的展开按钮对齐 */}
              <div className="w-6 flex-shrink-0" />

              {/* 替换输入框 */}
              <input
                ref={replaceInputRef}
                type="text"
                value={replaceTerm}
                onChange={(e) => setReplaceTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleReplace()
                  }
                  // Esc 由全局监听处理
                }}
                placeholder={t.search?.replacePlaceholder ?? '替换...'}
                className="flex-1 px-2 py-1 text-sm bg-[var(--color-bg)] border border-[var(--color-border)] rounded min-w-0
                           focus:outline-none focus:border-[var(--color-accent)] transition-colors"
              />

              {/* 替换按钮 */}
              <div className="flex items-center gap-1 flex-shrink-0">
                <Tooltip content={t.search?.replace ?? '替换'} placement="bottom">
                  <button
                    onClick={handleReplace}
                    disabled={matchCount === 0}
                    className="h-7 px-2 flex items-center justify-center rounded text-xs font-medium transition-colors border
                               text-[var(--color-muted)] border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]
                               disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {t.search?.replace ?? '替换'}
                  </button>
                </Tooltip>

                <Tooltip content={t.search?.replaceAll ?? '全部替换'} placement="bottom">
                  <button
                    onClick={handleReplaceAll}
                    disabled={matchCount === 0}
                    className="h-7 px-2 flex items-center justify-center rounded text-xs font-medium transition-colors border
                               text-[var(--color-muted)] border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]
                               disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {t.search?.replaceAll ?? '全部'}
                  </button>
                </Tooltip>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
