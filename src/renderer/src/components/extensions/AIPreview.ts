/**
 * AIPreview Extension
 *
 * 提供 AI 生成内容的预览确认机制
 * - 使用 ProseMirror Decoration 显示原文（删除线）和新文本（高亮）
 * - 提供接受/拒绝/重新生成操作
 * - 支持快捷键：Enter 接受，Escape 拒绝
 */

import { Extension } from '@tiptap/core'
import { Node } from '@tiptap/pm/model'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

// 单个块的预览数据
export interface AIPreviewBlock {
  blockId: string
  from: number
  to: number
  oldText: string
  newText: string
}

// 预览数据接口
export interface AIPreviewData {
  id: string
  // 单块模式
  from: number
  to: number
  oldText: string
  newText: string
  // 跨块模式
  blocks?: AIPreviewBlock[]
  // 回调
  onAccept: () => void
  onReject: () => void
  onRegenerate: () => void
}

// 扩展配置选项
export interface AIPreviewOptions {
  labels: {
    accept: string
    reject: string
    regenerate: string
  }
}

// 插件状态
interface AIPreviewState {
  active: boolean
  data: AIPreviewData | null
}

export const aiPreviewPluginKey = new PluginKey<AIPreviewState>('aiPreview')

// 创建操作栏 DOM
function createToolbar(data: AIPreviewData, labels: AIPreviewOptions['labels']): HTMLElement {
  const toolbar = document.createElement('div')
  toolbar.className = 'ai-preview-toolbar'
  toolbar.contentEditable = 'false'

  toolbar.innerHTML = `
    <button class="ai-preview-btn ai-preview-accept" title="${labels.accept} (Enter)">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
      <span>${labels.accept}</span>
    </button>
    <button class="ai-preview-btn ai-preview-reject" title="${labels.reject} (Esc)">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
      <span>${labels.reject}</span>
    </button>
    <button class="ai-preview-btn ai-preview-regenerate" title="${labels.regenerate}">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
        <path d="M3 3v5h5"></path>
        <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"></path>
        <path d="M16 21h5v-5"></path>
      </svg>
      <span>${labels.regenerate}</span>
    </button>
  `

  // 绑定事件 - 使用 mousedown 防止失焦
  toolbar.querySelector('.ai-preview-accept')?.addEventListener('mousedown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    data.onAccept()
  })

  toolbar.querySelector('.ai-preview-reject')?.addEventListener('mousedown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    data.onReject()
  })

  toolbar.querySelector('.ai-preview-regenerate')?.addEventListener('mousedown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    data.onRegenerate()
  })

  return toolbar
}

// 创建新文本预览 DOM
function createNewTextSpan(newText: string): HTMLElement {
  const span = document.createElement('span')
  span.className = 'ai-preview-new'
  span.textContent = newText
  span.contentEditable = 'false'
  return span
}

// 创建 Decorations
function createDecorations(
  data: AIPreviewData,
  doc: Node,
  labels: AIPreviewOptions['labels']
): DecorationSet {
  const decorations: Decoration[] = []

  if (data.blocks && data.blocks.length > 0) {
    // 跨块模式：为每个块添加装饰
    data.blocks.forEach((block) => {
      // 原文删除线
      if (block.from < block.to) {
        decorations.push(
          Decoration.inline(block.from, block.to, {
            class: 'ai-preview-old',
            'data-ai-preview': 'old'
          })
        )
      }

      // 新文本（在原文后显示）
      decorations.push(
        Decoration.widget(block.to, () => createNewTextSpan(block.newText), {
          side: 1,
          key: `ai-preview-new-${block.blockId}`
        })
      )
    })

    // 操作栏放在最后一个块后面
    const lastBlock = data.blocks[data.blocks.length - 1]
    decorations.push(
      Decoration.widget(lastBlock.to, () => createToolbar(data, labels), {
        side: 1,
        key: 'ai-preview-toolbar'
      })
    )
  } else {
    // 单块模式
    // 原文删除线
    if (data.from < data.to) {
      decorations.push(
        Decoration.inline(data.from, data.to, {
          class: 'ai-preview-old',
          'data-ai-preview': 'old'
        })
      )
    }

    // 新文本
    decorations.push(
      Decoration.widget(data.to, () => createNewTextSpan(data.newText), {
        side: 1,
        key: 'ai-preview-new'
      })
    )

    // 操作栏
    decorations.push(
      Decoration.widget(data.to, () => createToolbar(data, labels), {
        side: 1,
        key: 'ai-preview-toolbar'
      })
    )
  }

  return DecorationSet.create(doc, decorations)
}

export const AIPreview = Extension.create<AIPreviewOptions>({
  name: 'aiPreview',

  addOptions() {
    return {
      labels: {
        accept: 'Accept',
        reject: 'Reject',
        regenerate: 'Retry'
      }
    }
  },

  addProseMirrorPlugins() {
    const labels = this.options.labels
    return [
      new Plugin({
        key: aiPreviewPluginKey,

        state: {
          init(): AIPreviewState {
            return {
              active: false,
              data: null
            }
          },

          apply(tr, state): AIPreviewState {
            const meta = tr.getMeta(aiPreviewPluginKey)

            if (meta?.type === 'show') {
              return {
                active: true,
                data: meta.data
              }
            }

            if (meta?.type === 'hide') {
              return {
                active: false,
                data: null
              }
            }

            // 文档变化时，需要重新映射位置
            if (state.active && state.data && tr.docChanged) {
              const mapping = tr.mapping

              if (state.data.blocks && state.data.blocks.length > 0) {
                // 跨块模式：映射每个块的位置
                const mappedBlocks = state.data.blocks.map((block) => ({
                  ...block,
                  from: mapping.map(block.from),
                  to: mapping.map(block.to)
                }))

                return {
                  ...state,
                  data: {
                    ...state.data,
                    blocks: mappedBlocks
                  }
                }
              } else {
                // 单块模式
                return {
                  ...state,
                  data: {
                    ...state.data,
                    from: mapping.map(state.data.from),
                    to: mapping.map(state.data.to)
                  }
                }
              }
            }

            return state
          }
        },

        props: {
          decorations(state) {
            const pluginState = aiPreviewPluginKey.getState(state)
            if (!pluginState?.active || !pluginState.data) {
              return DecorationSet.empty
            }
            return createDecorations(pluginState.data, state.doc, labels)
          },

          // 处理快捷键
          handleKeyDown(view, event) {
            const state = aiPreviewPluginKey.getState(view.state)
            if (!state?.active || !state.data) return false

            // Enter = 接受
            if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
              event.preventDefault()
              state.data.onAccept()
              return true
            }

            // Escape = 拒绝
            if (event.key === 'Escape') {
              event.preventDefault()
              state.data.onReject()
              return true
            }

            // 允许带修饰键的操作（如 Cmd+C 复制、Cmd+A 全选）
            if (event.metaKey || event.ctrlKey || event.altKey) {
              return false
            }

            // 预览激活时，阻止修改文档的按键
            if (
              event.key.length === 1 ||
              event.key === 'Backspace' ||
              event.key === 'Delete' ||
              event.key === 'Tab'
            ) {
              event.preventDefault()
              return true
            }

            return false
          },

          // 阻止点击修改文档
          handleClick(view) {
            const state = aiPreviewPluginKey.getState(view.state)
            if (state?.active) {
              return true // 阻止默认点击行为
            }
            return false
          },

          // 阻止粘贴
          handlePaste(view) {
            const state = aiPreviewPluginKey.getState(view.state)
            if (state?.active) {
              return true
            }
            return false
          },

          // 阻止拖放
          handleDrop(view) {
            const state = aiPreviewPluginKey.getState(view.state)
            if (state?.active) {
              return true
            }
            return false
          }
        }
      })
    ]
  },

  addCommands() {
    return {
      showAIPreview:
        (data: AIPreviewData) =>
        ({ tr, dispatch }: { tr: Transaction; dispatch?: (tr: Transaction) => void }) => {
          if (dispatch) {
            tr.setMeta(aiPreviewPluginKey, { type: 'show', data })
            dispatch(tr)
          }
          return true
        },

      hideAIPreview:
        () =>
        ({ tr, dispatch }: { tr: Transaction; dispatch?: (tr: Transaction) => void }) => {
          if (dispatch) {
            tr.setMeta(aiPreviewPluginKey, { type: 'hide' })
            dispatch(tr)
          }
          return true
        }
    } as unknown as Partial<import('@tiptap/core').RawCommands>
  }
})

// 导出命令类型
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    aiPreview: {
      showAIPreview: (data: AIPreviewData) => ReturnType
      hideAIPreview: () => ReturnType
    }
  }
}
