import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { NodeSelection } from '@tiptap/pm/state'

export interface DragHandleOptions {
  dragHandleClass: string
}

const dragHandlePluginKey = new PluginKey('dragHandle')

export const DragHandle = Extension.create<DragHandleOptions>({
  name: 'dragHandle',

  addOptions() {
    return {
      dragHandleClass: 'drag-handle',
    }
  },

  addProseMirrorPlugins() {
    let dragHandle: HTMLElement | null = null
    let currentBlock: HTMLElement | null = null

    const showDragHandle = (view: any, block: HTMLElement) => {
      if (!dragHandle) {
        dragHandle = document.createElement('div')
        dragHandle.className = this.options.dragHandleClass
        dragHandle.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="9" cy="6" r="2"/>
            <circle cx="15" cy="6" r="2"/>
            <circle cx="9" cy="12" r="2"/>
            <circle cx="15" cy="12" r="2"/>
            <circle cx="9" cy="18" r="2"/>
            <circle cx="15" cy="18" r="2"/>
          </svg>
        `
        dragHandle.draggable = true
        document.body.appendChild(dragHandle)

        // 拖拽开始
        dragHandle.addEventListener('dragstart', (e) => {
          if (!currentBlock) return

          e.dataTransfer?.setDragImage(currentBlock, 0, 0)

          // 找到对应的节点位置
          const pos = view.posAtDOM(currentBlock, 0)
          if (pos !== null && pos !== undefined) {
            const $pos = view.state.doc.resolve(pos)
            const node = $pos.nodeAfter || $pos.parent

            if (node) {
              // 选中整个块
              const selection = NodeSelection.create(view.state.doc, $pos.before())
              view.dispatch(view.state.tr.setSelection(selection))
            }
          }

          currentBlock.classList.add('dragging')
        })

        // 拖拽结束
        dragHandle.addEventListener('dragend', () => {
          if (currentBlock) {
            currentBlock.classList.remove('dragging')
          }
        })
      }

      const rect = block.getBoundingClientRect()
      const editorRect = view.dom.getBoundingClientRect()

      dragHandle.style.display = 'flex'
      dragHandle.style.top = `${rect.top + window.scrollY + 4}px`
      dragHandle.style.left = `${editorRect.left - 28}px`

      currentBlock = block
    }

    const hideDragHandle = () => {
      if (dragHandle) {
        dragHandle.style.display = 'none'
      }
      currentBlock = null
    }

    return [
      new Plugin({
        key: dragHandlePluginKey,
        props: {
          handleDOMEvents: {
            mouseover: (view, event) => {
              const target = event.target as HTMLElement
              const editorDom = view.dom

              // 查找最近的块级元素
              let block = target.closest('p, h1, h2, h3, h4, h5, h6, ul, ol, blockquote, pre, .callout, .toggle-block, .mermaid-wrapper, .image-wrapper, .video-wrapper, .audio-wrapper, .file-attachment-wrapper')

              if (block && editorDom.contains(block)) {
                showDragHandle(view, block as HTMLElement)
              }

              return false
            },
            mouseleave: (_view, event) => {
              const relatedTarget = event.relatedTarget as HTMLElement
              if (!dragHandle?.contains(relatedTarget)) {
                hideDragHandle()
              }
              return false
            },
          },
        },
        view() {
          return {
            destroy() {
              if (dragHandle) {
                dragHandle.remove()
                dragHandle = null
              }
            },
          }
        },
      }),
    ]
  },
})
