/**
 * EditorSearch Extension
 *
 * 提供编辑器内搜索功能
 * - 使用 ProseMirror Decoration 高亮搜索结果
 * - 支持大小写敏感、正则表达式
 * - 支持上/下一个结果导航
 * - 快捷键：⌘F 打开，Esc 关闭，Enter 下一个，⇧Enter 上一个
 */

import { Extension, type Editor } from '@tiptap/core'
import { Node } from '@tiptap/pm/model'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

// 搜索结果
export interface SearchMatch {
  from: number
  to: number
  text: string
}

// 搜索选项
export interface SearchOptions {
  caseSensitive: boolean
  useRegex: boolean
}

// 插件状态
export interface EditorSearchState {
  isOpen: boolean
  searchTerm: string
  caseSensitive: boolean
  useRegex: boolean
  matches: SearchMatch[]
  currentIndex: number
  regexError: boolean
}

// 扩展配置
export interface EditorSearchExtensionOptions {
  searchResultClass: string
  currentResultClass: string
  // 需要跳过的节点类型
  skipNodeTypes: string[]
}

export const editorSearchPluginKey = new PluginKey<EditorSearchState>('editorSearch')

// 需要跳过搜索的节点类型
const DEFAULT_SKIP_NODE_TYPES = ['mathematics', 'mermaid', 'codeBlock', 'embed']

/**
 * 收集文档中的文本及其位置
 */
function collectTextWithPositions(
  doc: Node,
  skipNodeTypes: string[]
): { text: string; positions: { docPos: number; textPos: number }[] } {
  let text = ''
  const positions: { docPos: number; textPos: number }[] = []

  doc.descendants((node, pos) => {
    // 跳过特殊节点
    if (skipNodeTypes.includes(node.type.name)) {
      return false
    }

    if (node.isText && node.text) {
      positions.push({ docPos: pos, textPos: text.length })
      text += node.text
    } else if (node.isBlock && text.length > 0 && !text.endsWith('\n')) {
      // 块级元素之间添加换行，便于搜索时区分
      text += '\n'
    }

    return true
  })

  return { text, positions }
}

/**
 * 将文本位置转换为文档位置
 */
function textPosToDocPos(
  textPos: number,
  positions: { docPos: number; textPos: number }[]
): number {
  for (let i = positions.length - 1; i >= 0; i--) {
    if (positions[i].textPos <= textPos) {
      return positions[i].docPos + (textPos - positions[i].textPos)
    }
  }
  return 0
}

/**
 * 执行搜索
 */
function performSearch(
  doc: Node,
  searchTerm: string,
  options: SearchOptions,
  skipNodeTypes: string[]
): { matches: SearchMatch[]; regexError: boolean } {
  if (!searchTerm) {
    return { matches: [], regexError: false }
  }

  const { text, positions } = collectTextWithPositions(doc, skipNodeTypes)

  if (!text || positions.length === 0) {
    return { matches: [], regexError: false }
  }

  try {
    let pattern: RegExp

    if (options.useRegex) {
      pattern = new RegExp(searchTerm, options.caseSensitive ? 'g' : 'gi')
    } else {
      // 转义正则特殊字符
      const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      pattern = new RegExp(escaped, options.caseSensitive ? 'g' : 'gi')
    }

    const matches: SearchMatch[] = []
    const seenPositions = new Set<string>()

    for (const match of text.matchAll(pattern)) {
      if (match.index !== undefined && match[0].length > 0) {
        const from = textPosToDocPos(match.index, positions)
        const to = textPosToDocPos(match.index + match[0].length, positions)

        // 确保匹配在有效范围内
        if (from < to && from >= 0 && to <= doc.content.size) {
          // 验证匹配位置的文本是否正确
          try {
            const actualText = doc.textBetween(from, to, '')
            if (actualText !== match[0]) {
              // 位置映射错误，跳过此匹配
              continue
            }
          } catch {
            // 位置无效，跳过
            continue
          }

          // 去重：避免相同位置的重复匹配
          const posKey = `${from}-${to}`
          if (!seenPositions.has(posKey)) {
            seenPositions.add(posKey)
            matches.push({
              from,
              to,
              text: match[0]
            })
          }
        }
      }
    }

    return { matches, regexError: false }
  } catch {
    // 正则语法错误
    return { matches: [], regexError: true }
  }
}

/**
 * 创建搜索结果的 Decorations
 */
function createSearchDecorations(
  doc: Node,
  matches: SearchMatch[],
  currentIndex: number,
  searchResultClass: string,
  currentResultClass: string
): DecorationSet {
  if (matches.length === 0) {
    return DecorationSet.empty
  }

  const decorations = matches.map((match, index) => {
    const className = index === currentIndex ? currentResultClass : searchResultClass
    return Decoration.inline(match.from, match.to, {
      class: className
    })
  })

  return DecorationSet.create(doc, decorations)
}

/**
 * 获取初始状态
 */
function getInitialState(): EditorSearchState {
  return {
    isOpen: false,
    searchTerm: '',
    caseSensitive: false,
    useRegex: false,
    matches: [],
    currentIndex: 0,
    regexError: false
  }
}

/**
 * 滚动到匹配位置（导出供 SearchBar 使用）
 */
export function scrollToMatch(editor: Editor, match: SearchMatch): void {
  setTimeout(() => {
    if (!editor.view || editor.isDestroyed) return
    const coords = editor.view.coordsAtPos(match.from)
    const scrollContainer = editor.view.dom.closest('.zen-scroll-wrapper') || window

    if (scrollContainer === window) {
      window.scrollTo({
        top: coords.top - window.innerHeight * 0.3,
        behavior: 'smooth'
      })
    } else {
      const containerRect = (scrollContainer as HTMLElement).getBoundingClientRect()
      const relativeTop = coords.top - containerRect.top
      const scrollTop = (scrollContainer as HTMLElement).scrollTop
      ;(scrollContainer as HTMLElement).scrollTo({
        top: scrollTop + relativeTop - containerRect.height * 0.3,
        behavior: 'smooth'
      })
    }
  }, 0)
}

export const EditorSearch = Extension.create<EditorSearchExtensionOptions>({
  name: 'editorSearch',

  addOptions() {
    return {
      searchResultClass: 'search-result',
      currentResultClass: 'search-result-current',
      skipNodeTypes: DEFAULT_SKIP_NODE_TYPES
    }
  },

  addProseMirrorPlugins() {
    const { searchResultClass, currentResultClass, skipNodeTypes } = this.options

    return [
      new Plugin({
        key: editorSearchPluginKey,

        state: {
          init(): EditorSearchState {
            return getInitialState()
          },

          apply(tr, state, _oldEditorState, newEditorState): EditorSearchState {
            const meta = tr.getMeta(editorSearchPluginKey)

            // 处理搜索命令
            if (meta) {
              switch (meta.type) {
                case 'open':
                  return {
                    ...state,
                    isOpen: true
                  }

                case 'close':
                  return getInitialState()

                case 'setSearchTerm': {
                  const { matches, regexError } = performSearch(
                    newEditorState.doc,
                    meta.searchTerm,
                    { caseSensitive: state.caseSensitive, useRegex: state.useRegex },
                    skipNodeTypes
                  )
                  return {
                    ...state,
                    searchTerm: meta.searchTerm,
                    matches,
                    currentIndex: matches.length > 0 ? 0 : -1,
                    regexError
                  }
                }

                case 'setOptions': {
                  const newOptions = {
                    caseSensitive: meta.caseSensitive ?? state.caseSensitive,
                    useRegex: meta.useRegex ?? state.useRegex
                  }
                  const { matches, regexError } = performSearch(
                    newEditorState.doc,
                    state.searchTerm,
                    newOptions,
                    skipNodeTypes
                  )
                  return {
                    ...state,
                    ...newOptions,
                    matches,
                    currentIndex: matches.length > 0 ? 0 : -1,
                    regexError
                  }
                }

                case 'findNext': {
                  if (state.matches.length === 0) return state
                  const nextIndex = (state.currentIndex + 1) % state.matches.length
                  return {
                    ...state,
                    currentIndex: nextIndex
                  }
                }

                case 'findPrevious': {
                  if (state.matches.length === 0) return state
                  const prevIndex =
                    (state.currentIndex - 1 + state.matches.length) % state.matches.length
                  return {
                    ...state,
                    currentIndex: prevIndex
                  }
                }

                case 'setCurrentIndex': {
                  return {
                    ...state,
                    currentIndex: meta.index
                  }
                }
              }
            }

            // 文档变化时重新搜索
            if (tr.docChanged && state.isOpen && state.searchTerm) {
              const { matches, regexError } = performSearch(
                newEditorState.doc,
                state.searchTerm,
                { caseSensitive: state.caseSensitive, useRegex: state.useRegex },
                skipNodeTypes
              )

              // 尝试保持当前索引在有效范围内
              let newIndex = state.currentIndex
              if (matches.length === 0) {
                newIndex = -1
              } else if (newIndex >= matches.length) {
                newIndex = matches.length - 1
              }

              return {
                ...state,
                matches,
                currentIndex: newIndex,
                regexError
              }
            }

            return state
          }
        },

        props: {
          decorations(editorState) {
            const pluginState = editorSearchPluginKey.getState(editorState)
            if (!pluginState?.isOpen || pluginState.matches.length === 0) {
              return DecorationSet.empty
            }
            return createSearchDecorations(
              editorState.doc,
              pluginState.matches,
              pluginState.currentIndex,
              searchResultClass,
              currentResultClass
            )
          }
        }
      })
    ]
  },

  addCommands() {
    return {
      openSearch:
        () =>
        ({ tr, dispatch }: { tr: Transaction; dispatch?: (tr: Transaction) => void }) => {
          if (dispatch) {
            tr.setMeta(editorSearchPluginKey, { type: 'open' })
            dispatch(tr)
          }
          return true
        },

      focusSearch:
        () =>
        ({ tr, dispatch }: { tr: Transaction; dispatch?: (tr: Transaction) => void }) => {
          if (dispatch) {
            tr.setMeta(editorSearchPluginKey, { type: 'focus' })
            dispatch(tr)
          }
          return true
        },

      closeSearch:
        () =>
        ({ tr, dispatch }: { tr: Transaction; dispatch?: (tr: Transaction) => void }) => {
          if (dispatch) {
            tr.setMeta(editorSearchPluginKey, { type: 'close' })
            dispatch(tr)
          }
          return true
        },

      setSearchTerm:
        (searchTerm: string) =>
        ({ tr, dispatch }: { tr: Transaction; dispatch?: (tr: Transaction) => void }) => {
          if (dispatch) {
            tr.setMeta(editorSearchPluginKey, { type: 'setSearchTerm', searchTerm })
            dispatch(tr)
          }
          return true
        },

      setSearchOptions:
        (options: { caseSensitive?: boolean; useRegex?: boolean }) =>
        ({ tr, dispatch }: { tr: Transaction; dispatch?: (tr: Transaction) => void }) => {
          if (dispatch) {
            tr.setMeta(editorSearchPluginKey, { type: 'setOptions', ...options })
            dispatch(tr)
          }
          return true
        },

      findNext:
        () =>
        ({ tr, dispatch, editor }: { tr: Transaction; dispatch?: (tr: Transaction) => void; editor: Editor }) => {
          const state = editorSearchPluginKey.getState(editor.state)
          if (!state || state.matches.length === 0) return false

          if (dispatch) {
            tr.setMeta(editorSearchPluginKey, { type: 'findNext' })
            dispatch(tr)
          }

          // 滚动到下一个结果
          const nextIndex = (state.currentIndex + 1) % state.matches.length
          const match = state.matches[nextIndex]
          if (match) {
            scrollToMatch(editor, match)
          }

          return true
        },

      findPrevious:
        () =>
        ({ tr, dispatch, editor }: { tr: Transaction; dispatch?: (tr: Transaction) => void; editor: Editor }) => {
          const state = editorSearchPluginKey.getState(editor.state)
          if (!state || state.matches.length === 0) return false

          if (dispatch) {
            tr.setMeta(editorSearchPluginKey, { type: 'findPrevious' })
            dispatch(tr)
          }

          // 滚动到上一个结果
          const prevIndex =
            (state.currentIndex - 1 + state.matches.length) % state.matches.length
          const match = state.matches[prevIndex]
          if (match) {
            scrollToMatch(editor, match)
          }

          return true
        },

      replaceCurrent:
        (replaceWith: string) =>
        ({ editor, tr, dispatch }: { editor: Editor; tr: Transaction; dispatch?: (tr: Transaction) => void }) => {
          const state = editorSearchPluginKey.getState(editor.state)
          if (!state || state.matches.length === 0 || state.currentIndex < 0) return false

          const match = state.matches[state.currentIndex]
          if (!match) return false

          if (dispatch) {
            // 使用传入的 tr 进行替换
            if (replaceWith) {
              tr.replaceWith(match.from, match.to, editor.schema.text(replaceWith))
            } else {
              // 空替换 = 删除匹配内容
              tr.delete(match.from, match.to)
            }
            dispatch(tr)
          }

          return true
        },

      replaceAll:
        (replaceWith: string) =>
        ({ editor, tr, dispatch }: { editor: Editor; tr: Transaction; dispatch?: (tr: Transaction) => void }) => {
          const state = editorSearchPluginKey.getState(editor.state)
          if (!state || state.matches.length === 0) return false

          // 从后往前替换，避免位置偏移问题
          const sortedMatches = [...state.matches].sort((a, b) => b.from - a.from)

          if (dispatch) {
            for (const match of sortedMatches) {
              if (replaceWith) {
                tr.replaceWith(match.from, match.to, editor.schema.text(replaceWith))
              } else {
                // 空替换 = 删除匹配内容
                tr.delete(match.from, match.to)
              }
            }
            dispatch(tr)
          }

          return true
        }
    // Tiptap 的 RawCommands 类型定义与实际使用方式不匹配，需要类型断言
    // 参考: https://tiptap.dev/docs/editor/extensions/custom-extensions
    } as unknown as Partial<import('@tiptap/core').RawCommands>
  },

  addKeyboardShortcuts() {
    return {
      'Mod-f': () => {
        const state = editorSearchPluginKey.getState(this.editor.state)
        if (state?.isOpen) {
          // 已经打开，触发全选输入框
          this.editor.commands.focusSearch()
          return true
        }
        this.editor.commands.openSearch()
        return true
      }
    }
  }
})

// 导出命令类型
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    editorSearch: {
      openSearch: () => ReturnType
      focusSearch: () => ReturnType
      closeSearch: () => ReturnType
      setSearchTerm: (searchTerm: string) => ReturnType
      setSearchOptions: (options: { caseSensitive?: boolean; useRegex?: boolean }) => ReturnType
      findNext: () => ReturnType
      findPrevious: () => ReturnType
      replaceCurrent: (replaceWith: string) => ReturnType
      replaceAll: (replaceWith: string) => ReturnType
    }
  }
}
