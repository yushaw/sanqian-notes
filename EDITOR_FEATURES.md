# 编辑器功能扩展方案

> 基于 Tiptap 的编辑器功能完整实现方案

---

## 一、内容格式功能

---

### 1.1 高亮 Highlight

**优先级**: P0 | **复杂度**: ⭐ | **官方支持**: ✅

#### 功能描述
- 选中文字后应用黄色（或自定义颜色）背景高亮
- 支持 Markdown 语法 `==高亮文字==`
- 快捷键 `Cmd+Shift+H`

#### 安装
```bash
npm install @tiptap/extension-highlight
```

#### 完整配置
```typescript
// src/renderer/src/components/extensions/Highlight.ts
import Highlight from '@tiptap/extension-highlight'
import { markInputRule, markPasteRule } from '@tiptap/core'

// Markdown 语法 ==text== 的正则
const highlightInputRegex = /(?:^|\s)(==(?!\s)([^=]+)(?<!\s)==)$/
const highlightPasteRegex = /(?:^|\s)(==(?!\s)([^=]+)(?<!\s)==)/g

export const CustomHighlight = Highlight.extend({
  addInputRules() {
    return [
      markInputRule({
        find: highlightInputRegex,
        type: this.type,
      }),
    ]
  },

  addPasteRules() {
    return [
      markPasteRule({
        find: highlightPasteRegex,
        type: this.type,
      }),
    ]
  },
}).configure({
  multicolor: true,
  HTMLAttributes: {
    class: 'highlight',
  },
})
```

#### 在编辑器中使用
```typescript
// Editor.tsx 中添加扩展
import { CustomHighlight } from './extensions/Highlight'

const editor = useEditor({
  extensions: [
    // ... 其他扩展
    CustomHighlight,
  ],
})

// 工具栏按钮
<ToolbarButton
  active={editor.isActive('highlight')}
  onClick={() => editor.chain().focus().toggleHighlight().run()}
  title="高亮 (⌘+Shift+H)"
  icon={<HighlightIcon />}
/>
```

#### 快捷键配置
```typescript
// 默认快捷键已内置: Cmd+Shift+H
// 如需自定义:
CustomHighlight.configure({
  multicolor: true,
}).extend({
  addKeyboardShortcuts() {
    return {
      'Mod-Shift-h': () => this.editor.commands.toggleHighlight(),
    }
  },
})
```

#### CSS 样式
```css
/* Editor.css */
.highlight {
  background-color: #fff3b0;
  border-radius: 2px;
  padding: 0 2px;
}

/* 暗色模式 */
.dark .highlight {
  background-color: #5c4b00;
  color: #fff;
}

/* 多颜色高亮 */
.highlight[data-color="#ff6b6b"] { background-color: #ffccd5; }
.highlight[data-color="#51cf66"] { background-color: #d3f9d8; }
.highlight[data-color="#339af0"] { background-color: #d0ebff; }
.highlight[data-color="#ff922b"] { background-color: #ffe8cc; }
```

---

### 1.2 下划线 Underline

**优先级**: P0 | **复杂度**: ⭐ | **官方支持**: ✅

#### 功能描述
- 选中文字应用下划线样式
- 快捷键 `Cmd+U`

#### 安装
```bash
npm install @tiptap/extension-underline
```

#### 完整配置
```typescript
// src/renderer/src/components/extensions/Underline.ts
import Underline from '@tiptap/extension-underline'

export const CustomUnderline = Underline.configure({
  HTMLAttributes: {
    class: 'underline',
  },
})
```

#### CSS 样式
```css
/* Editor.css */
.ProseMirror u,
.ProseMirror .underline {
  text-decoration: underline;
  text-decoration-color: currentColor;
  text-underline-offset: 2px;
}
```

---

### 1.3 文字颜色 & 背景色

**优先级**: P0 | **复杂度**: ⭐⭐ | **官方支持**: ✅

#### 功能描述
- 选中文字设置前景色
- 选中文字设置背景色
- 预设颜色盘 UI
- 支持清除颜色

#### 安装
```bash
npm install @tiptap/extension-color @tiptap/extension-text-style
```

#### 完整配置
```typescript
// src/renderer/src/components/extensions/TextColor.ts
import TextStyle from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'

export { TextStyle, Color }
```

#### 颜色选择器组件
```tsx
// src/renderer/src/components/ColorPicker.tsx
import { useState } from 'react'

const PRESET_COLORS = {
  text: [
    { name: '默认', value: null },
    { name: '灰色', value: '#6b7280' },
    { name: '红色', value: '#ef4444' },
    { name: '橙色', value: '#f97316' },
    { name: '黄色', value: '#eab308' },
    { name: '绿色', value: '#22c55e' },
    { name: '蓝色', value: '#3b82f6' },
    { name: '紫色', value: '#a855f7' },
    { name: '粉色', value: '#ec4899' },
  ],
  background: [
    { name: '默认', value: null },
    { name: '灰色', value: '#f3f4f6' },
    { name: '红色', value: '#fecaca' },
    { name: '橙色', value: '#fed7aa' },
    { name: '黄色', value: '#fef08a' },
    { name: '绿色', value: '#bbf7d0' },
    { name: '蓝色', value: '#bfdbfe' },
    { name: '紫色', value: '#e9d5ff' },
    { name: '粉色', value: '#fbcfe8' },
  ],
}

interface ColorPickerProps {
  editor: Editor
  onClose: () => void
}

export function ColorPicker({ editor, onClose }: ColorPickerProps) {
  const [activeTab, setActiveTab] = useState<'text' | 'background'>('text')

  const handleColorSelect = (color: string | null) => {
    if (activeTab === 'text') {
      if (color) {
        editor.chain().focus().setColor(color).run()
      } else {
        editor.chain().focus().unsetColor().run()
      }
    } else {
      if (color) {
        editor.chain().focus().setHighlight({ color }).run()
      } else {
        editor.chain().focus().unsetHighlight().run()
      }
    }
    onClose()
  }

  const colors = activeTab === 'text' ? PRESET_COLORS.text : PRESET_COLORS.background

  return (
    <div className="color-picker">
      <div className="color-picker-tabs">
        <button
          className={activeTab === 'text' ? 'active' : ''}
          onClick={() => setActiveTab('text')}
        >
          文字颜色
        </button>
        <button
          className={activeTab === 'background' ? 'active' : ''}
          onClick={() => setActiveTab('background')}
        >
          背景颜色
        </button>
      </div>
      <div className="color-picker-grid">
        {colors.map((color) => (
          <button
            key={color.name}
            className="color-picker-item"
            style={{
              backgroundColor: color.value || 'transparent',
              border: color.value ? 'none' : '1px dashed #ccc',
            }}
            onClick={() => handleColorSelect(color.value)}
            title={color.name}
          >
            {!color.value && '✕'}
          </button>
        ))}
      </div>
    </div>
  )
}
```

#### CSS 样式
```css
/* ColorPicker.css */
.color-picker {
  background: var(--color-card);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  min-width: 200px;
}

.color-picker-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
}

.color-picker-tabs button {
  flex: 1;
  padding: 6px 12px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.color-picker-tabs button.active {
  background: var(--color-bg-hover);
  color: var(--color-text);
}

.color-picker-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 4px;
}

.color-picker-item {
  width: 28px;
  height: 28px;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: #999;
  transition: transform 0.1s;
}

.color-picker-item:hover {
  transform: scale(1.1);
}
```

---

### 1.4 斜杠命令菜单

**优先级**: P0 | **复杂度**: ⭐⭐ | **官方支持**: 需自定义

#### 功能描述
- 输入 `/` 触发命令菜单
- 支持模糊搜索
- 键盘上下选择，回车确认
- 支持所有块级元素快速插入

#### 完整实现
```typescript
// src/renderer/src/components/extensions/SlashCommand.ts
import { Extension } from '@tiptap/core'
import Suggestion, { SuggestionOptions } from '@tiptap/suggestion'
import { ReactRenderer } from '@tiptap/react'
import tippy, { Instance } from 'tippy.js'
import { SlashCommandList } from '../SlashCommandList'

export interface SlashCommandItem {
  title: string
  description: string
  icon: React.ReactNode
  command: (editor: Editor) => void
  keywords?: string[]
}

export const slashCommands: SlashCommandItem[] = [
  {
    title: '正文',
    description: '普通段落文本',
    icon: '¶',
    keywords: ['paragraph', 'text', 'body', 'zhengwen'],
    command: (editor) => editor.chain().focus().setParagraph().run(),
  },
  {
    title: '标题 1',
    description: '大标题',
    icon: 'H1',
    keywords: ['h1', 'heading1', 'biaoti'],
    command: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    title: '标题 2',
    description: '中标题',
    icon: 'H2',
    keywords: ['h2', 'heading2'],
    command: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    title: '标题 3',
    description: '小标题',
    icon: 'H3',
    keywords: ['h3', 'heading3'],
    command: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    title: '无序列表',
    description: '项目符号列表',
    icon: '•',
    keywords: ['bullet', 'list', 'ul', 'liebiao'],
    command: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    title: '有序列表',
    description: '编号列表',
    icon: '1.',
    keywords: ['numbered', 'ordered', 'ol'],
    command: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    title: '待办事项',
    description: '可勾选的任务列表',
    icon: '☑',
    keywords: ['todo', 'task', 'checkbox', 'daiban'],
    command: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    title: '引用',
    description: '引用块',
    icon: '"',
    keywords: ['quote', 'blockquote', 'yinyong'],
    command: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    title: '代码块',
    description: '代码片段',
    icon: '</>',
    keywords: ['code', 'codeblock', 'daima'],
    command: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    title: '分割线',
    description: '水平分割线',
    icon: '—',
    keywords: ['hr', 'divider', 'line', 'fenge'],
    command: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  {
    title: '表格',
    description: '插入表格',
    icon: '▦',
    keywords: ['table', 'biaoge'],
    command: (editor) => editor.chain().focus().insertTable({ rows: 3, cols: 3 }).run(),
  },
  {
    title: '图片',
    description: '插入图片',
    icon: '🖼',
    keywords: ['image', 'img', 'picture', 'tupian'],
    command: (editor) => {
      const url = window.prompt('输入图片 URL')
      if (url) {
        editor.chain().focus().setImage({ src: url }).run()
      }
    },
  },
  // 以下是新增功能，实现后启用
  // {
  //   title: '提示块',
  //   description: '彩色提示框',
  //   icon: '💡',
  //   keywords: ['callout', 'admonition', 'tip', 'tishi'],
  //   command: (editor) => editor.chain().focus().setCallout({ type: 'tip' }).run(),
  // },
  // {
  //   title: '折叠块',
  //   description: '可展开/折叠的内容',
  //   icon: '▸',
  //   keywords: ['toggle', 'details', 'collapse', 'zhedie'],
  //   command: (editor) => editor.chain().focus().setDetails().run(),
  // },
]

export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addOptions() {
    return {
      suggestion: {
        char: '/',
        command: ({ editor, range, props }) => {
          props.command(editor)
          editor.chain().focus().deleteRange(range).run()
        },
      } as Partial<SuggestionOptions>,
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
        items: ({ query }) => {
          const search = query.toLowerCase()
          return slashCommands.filter((item) => {
            const matchTitle = item.title.toLowerCase().includes(search)
            const matchKeywords = item.keywords?.some((k) => k.includes(search))
            return matchTitle || matchKeywords
          })
        },
        render: () => {
          let component: ReactRenderer
          let popup: Instance[]

          return {
            onStart: (props) => {
              component = new ReactRenderer(SlashCommandList, {
                props,
                editor: props.editor,
              })

              popup = tippy('body', {
                getReferenceClientRect: props.clientRect as () => DOMRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: 'manual',
                placement: 'bottom-start',
              })
            },

            onUpdate: (props) => {
              component.updateProps(props)
              popup[0].setProps({
                getReferenceClientRect: props.clientRect as () => DOMRect,
              })
            },

            onKeyDown: (props) => {
              if (props.event.key === 'Escape') {
                popup[0].hide()
                return true
              }
              return (component.ref as any)?.onKeyDown?.(props)
            },

            onExit: () => {
              popup[0].destroy()
              component.destroy()
            },
          }
        },
      }),
    ]
  },
})
```

#### 斜杠命令列表组件
```tsx
// src/renderer/src/components/SlashCommandList.tsx
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import type { SlashCommandItem } from './extensions/SlashCommand'

interface SlashCommandListProps {
  items: SlashCommandItem[]
  command: (item: SlashCommandItem) => void
}

export const SlashCommandList = forwardRef<any, SlashCommandListProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0)

    useEffect(() => {
      setSelectedIndex(0)
    }, [items])

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        if (event.key === 'ArrowUp') {
          setSelectedIndex((prev) => (prev - 1 + items.length) % items.length)
          return true
        }
        if (event.key === 'ArrowDown') {
          setSelectedIndex((prev) => (prev + 1) % items.length)
          return true
        }
        if (event.key === 'Enter') {
          const item = items[selectedIndex]
          if (item) {
            command(item)
          }
          return true
        }
        return false
      },
    }))

    if (items.length === 0) {
      return (
        <div className="slash-command-list">
          <div className="slash-command-empty">没有匹配的命令</div>
        </div>
      )
    }

    return (
      <div className="slash-command-list">
        {items.map((item, index) => (
          <button
            key={item.title}
            className={`slash-command-item ${index === selectedIndex ? 'selected' : ''}`}
            onClick={() => command(item)}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            <span className="slash-command-icon">{item.icon}</span>
            <div className="slash-command-content">
              <span className="slash-command-title">{item.title}</span>
              <span className="slash-command-description">{item.description}</span>
            </div>
          </button>
        ))}
      </div>
    )
  }
)
```

#### CSS 样式
```css
/* SlashCommand.css */
.slash-command-list {
  background: var(--color-card);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  padding: 4px;
  min-width: 240px;
  max-height: 320px;
  overflow-y: auto;
}

.slash-command-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  transition: background 0.1s;
}

.slash-command-item:hover,
.slash-command-item.selected {
  background: var(--color-bg-hover);
}

.slash-command-icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg);
  border-radius: 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.slash-command-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.slash-command-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text);
}

.slash-command-description {
  font-size: 12px;
  color: var(--color-text-secondary);
}

.slash-command-empty {
  padding: 12px;
  text-align: center;
  color: var(--color-text-secondary);
  font-size: 13px;
}
```

#### 安装 tippy.js
```bash
npm install tippy.js
```

---

### 1.5 Callout 提示块

**优先级**: P1 | **复杂度**: ⭐⭐⭐ | **官方支持**: ❌

#### 功能描述
- 支持多种类型：note, tip, warning, danger, info, quote
- 支持自定义标题
- 支持折叠/展开
- 兼容 Obsidian 语法 `> [!note]`

#### 完整实现
```typescript
// src/renderer/src/components/extensions/Callout.ts
import { Node, mergeAttributes, wrappingInputRule } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { CalloutView } from '../CalloutView'

export type CalloutType = 'note' | 'tip' | 'warning' | 'danger' | 'info' | 'quote'

export const CALLOUT_TYPES: Record<CalloutType, { icon: string; color: string; label: string }> = {
  note: { icon: '📝', color: '#3b82f6', label: '笔记' },
  tip: { icon: '💡', color: '#22c55e', label: '提示' },
  warning: { icon: '⚠️', color: '#f59e0b', label: '警告' },
  danger: { icon: '🚨', color: '#ef4444', label: '危险' },
  info: { icon: 'ℹ️', color: '#6366f1', label: '信息' },
  quote: { icon: '💬', color: '#6b7280', label: '引用' },
}

// Obsidian 语法: > [!note] 或 > [!tip] 等
const calloutInputRegex = /^>\s\[!(\w+)\]\s?(.*)$/

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      type: {
        default: 'note',
        parseHTML: (element) => element.getAttribute('data-callout-type') || 'note',
        renderHTML: (attributes) => ({ 'data-callout-type': attributes.type }),
      },
      title: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-callout-title'),
        renderHTML: (attributes) => {
          if (!attributes.title) return {}
          return { 'data-callout-title': attributes.title }
        },
      },
      collapsed: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-collapsed') === 'true',
        renderHTML: (attributes) => {
          if (!attributes.collapsed) return {}
          return { 'data-collapsed': 'true' }
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-callout]',
        getAttrs: (element) => {
          const el = element as HTMLElement
          return {
            type: el.getAttribute('data-callout-type') || 'note',
            title: el.getAttribute('data-callout-title'),
            collapsed: el.getAttribute('data-collapsed') === 'true',
          }
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-callout': '',
        class: `callout callout-${HTMLAttributes['data-callout-type'] || 'note'}`,
      }),
      0,
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView)
  },

  addCommands() {
    return {
      setCallout:
        (attributes) =>
        ({ commands }) => {
          return commands.wrapIn(this.name, attributes)
        },
      toggleCallout:
        (attributes) =>
        ({ commands }) => {
          return commands.toggleWrap(this.name, attributes)
        },
      updateCallout:
        (attributes) =>
        ({ commands }) => {
          return commands.updateAttributes(this.name, attributes)
        },
    }
  },

  addInputRules() {
    return [
      wrappingInputRule({
        find: calloutInputRegex,
        type: this.type,
        getAttributes: (match) => ({
          type: match[1]?.toLowerCase() || 'note',
          title: match[2] || null,
        }),
      }),
    ]
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-c': () => this.editor.commands.toggleCallout({ type: 'note' }),
    }
  },
})
```

#### Callout 视图组件
```tsx
// src/renderer/src/components/CalloutView.tsx
import { NodeViewWrapper, NodeViewContent } from '@tiptap/react'
import { CALLOUT_TYPES, CalloutType } from './extensions/Callout'

interface CalloutViewProps {
  node: {
    attrs: {
      type: CalloutType
      title: string | null
      collapsed: boolean
    }
  }
  updateAttributes: (attrs: Partial<{ type: CalloutType; title: string; collapsed: boolean }>) => void
}

export function CalloutView({ node, updateAttributes }: CalloutViewProps) {
  const { type, title, collapsed } = node.attrs
  const config = CALLOUT_TYPES[type] || CALLOUT_TYPES.note

  const toggleCollapse = () => {
    updateAttributes({ collapsed: !collapsed })
  }

  return (
    <NodeViewWrapper
      className={`callout callout-${type}`}
      style={{
        '--callout-color': config.color,
      } as React.CSSProperties}
    >
      <div className="callout-header" onClick={toggleCollapse}>
        <span className="callout-icon">{config.icon}</span>
        <span className="callout-title">
          {title || config.label}
        </span>
        <span className={`callout-collapse-icon ${collapsed ? 'collapsed' : ''}`}>
          ▼
        </span>
      </div>
      <div className={`callout-content ${collapsed ? 'hidden' : ''}`}>
        <NodeViewContent />
      </div>
    </NodeViewWrapper>
  )
}
```

#### CSS 样式
```css
/* Callout.css */
.callout {
  --callout-color: #3b82f6;
  margin: 16px 0;
  border-radius: 8px;
  border-left: 4px solid var(--callout-color);
  background: color-mix(in srgb, var(--callout-color) 8%, transparent);
}

.callout-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  cursor: pointer;
  user-select: none;
}

.callout-icon {
  font-size: 16px;
}

.callout-title {
  flex: 1;
  font-weight: 600;
  font-size: 14px;
  color: var(--callout-color);
}

.callout-collapse-icon {
  font-size: 10px;
  color: var(--color-text-secondary);
  transition: transform 0.2s;
}

.callout-collapse-icon.collapsed {
  transform: rotate(-90deg);
}

.callout-content {
  padding: 0 16px 12px 16px;
}

.callout-content.hidden {
  display: none;
}

.callout-content p:first-child {
  margin-top: 0;
}

.callout-content p:last-child {
  margin-bottom: 0;
}

/* 各类型颜色 */
.callout-note { --callout-color: #3b82f6; }
.callout-tip { --callout-color: #22c55e; }
.callout-warning { --callout-color: #f59e0b; }
.callout-danger { --callout-color: #ef4444; }
.callout-info { --callout-color: #6366f1; }
.callout-quote { --callout-color: #6b7280; }
```

---

### 1.6 Toggle 折叠块

**优先级**: P1 | **复杂度**: ⭐⭐ | **官方支持**: ✅

#### 功能描述
- 可展开/折叠的内容块
- 支持嵌套
- 使用 HTML `<details>` 元素

#### 安装
```bash
npm install @tiptap/extension-details @tiptap/extension-details-summary @tiptap/extension-details-content
```

#### 完整配置
```typescript
// src/renderer/src/components/extensions/Toggle.ts
import Details from '@tiptap/extension-details'
import DetailsSummary from '@tiptap/extension-details-summary'
import DetailsContent from '@tiptap/extension-details-content'

export const Toggle = Details.configure({
  persist: true,
  HTMLAttributes: {
    class: 'toggle-block',
  },
})

export const ToggleSummary = DetailsSummary.configure({
  HTMLAttributes: {
    class: 'toggle-summary',
  },
})

export const ToggleContent = DetailsContent.configure({
  HTMLAttributes: {
    class: 'toggle-content',
  },
})

// 导出所有需要的扩展
export const ToggleExtensions = [Toggle, ToggleSummary, ToggleContent]
```

#### CSS 样式
```css
/* Toggle.css */
.toggle-block {
  margin: 8px 0;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  overflow: hidden;
}

.toggle-block[open] {
  background: var(--color-bg);
}

.toggle-summary {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  cursor: pointer;
  user-select: none;
  list-style: none;
}

.toggle-summary::-webkit-details-marker {
  display: none;
}

.toggle-summary::before {
  content: '▶';
  font-size: 10px;
  margin-right: 8px;
  transition: transform 0.2s;
  color: var(--color-text-secondary);
}

.toggle-block[open] > .toggle-summary::before {
  transform: rotate(90deg);
}

.toggle-content {
  padding: 0 16px 12px 32px;
  border-top: 1px solid var(--color-border);
}
```

---

### 1.7 目录 TOC

**优先级**: P1 | **复杂度**: ⭐⭐ | **官方支持**: ✅

#### 功能描述
- 自动从 heading 生成目录
- 侧边栏显示
- 点击跳转
- 高亮当前位置

#### 安装
```bash
npm install @tiptap/extension-table-of-contents
```

#### 完整配置
```typescript
// src/renderer/src/components/extensions/TableOfContents.ts
import TableOfContents, {
  getHierarchicalIndexes,
  type TableOfContentsStorage,
} from '@tiptap/extension-table-of-contents'

export interface TocItem {
  id: string
  level: number
  textContent: string
  isActive: boolean
  isScrolledOver: boolean
  pos: number
  itemIndex: string
}

export const TOC = TableOfContents.configure({
  getIndex: getHierarchicalIndexes,
  onUpdate: (content: TocItem[]) => {
    // 这里可以通过事件或 callback 传递给外部组件
    window.dispatchEvent(new CustomEvent('toc-update', { detail: content }))
  },
})
```

#### TOC 侧边栏组件
```tsx
// src/renderer/src/components/TableOfContentsSidebar.tsx
import { useEffect, useState } from 'react'
import type { TocItem } from './extensions/TableOfContents'

interface TableOfContentsSidebarProps {
  editor: Editor | null
}

export function TableOfContentsSidebar({ editor }: TableOfContentsSidebarProps) {
  const [items, setItems] = useState<TocItem[]>([])
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const handleTocUpdate = (event: CustomEvent<TocItem[]>) => {
      setItems(event.detail)
      setIsVisible(event.detail.length > 0)
    }

    window.addEventListener('toc-update', handleTocUpdate as EventListener)
    return () => {
      window.removeEventListener('toc-update', handleTocUpdate as EventListener)
    }
  }, [])

  const handleClick = (item: TocItem) => {
    if (!editor) return

    // 滚动到对应位置
    const element = document.querySelector(`[data-toc-id="${item.id}"]`)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }

    // 或者使用 editor 的位置
    editor.chain().focus().setTextSelection(item.pos).run()
  }

  if (!isVisible || items.length === 0) return null

  return (
    <div className="toc-sidebar">
      <div className="toc-header">目录</div>
      <div className="toc-list">
        {items.map((item) => (
          <button
            key={item.id}
            className={`toc-item toc-level-${item.level} ${item.isActive ? 'active' : ''}`}
            onClick={() => handleClick(item)}
            style={{ paddingLeft: `${(item.level - 1) * 12 + 12}px` }}
          >
            {item.textContent}
          </button>
        ))}
      </div>
    </div>
  )
}
```

#### CSS 样式
```css
/* TableOfContents.css */
.toc-sidebar {
  position: sticky;
  top: 20px;
  width: 200px;
  max-height: calc(100vh - 100px);
  overflow-y: auto;
  padding: 16px;
  background: var(--color-card);
  border-radius: 8px;
  border: 1px solid var(--color-border);
}

.toc-header {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--color-text-secondary);
  margin-bottom: 12px;
}

.toc-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.toc-item {
  display: block;
  width: 100%;
  padding: 6px 12px;
  border: none;
  background: transparent;
  text-align: left;
  font-size: 13px;
  color: var(--color-text-secondary);
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: all 0.15s;
}

.toc-item:hover {
  background: var(--color-bg-hover);
  color: var(--color-text);
}

.toc-item.active {
  background: var(--color-primary-bg);
  color: var(--color-primary);
  font-weight: 500;
}

.toc-level-1 { font-weight: 600; }
.toc-level-2 { font-size: 13px; }
.toc-level-3 { font-size: 12px; }
.toc-level-4 { font-size: 12px; opacity: 0.8; }
```

---

### 1.8 数学公式 LaTeX

**优先级**: P2 | **复杂度**: ⭐⭐ | **官方支持**: ✅

#### 功能描述
- 行内公式: `$E=mc^2$`
- 块级公式: `$$\sum_{i=1}^n x_i$$`
- 实时渲染预览
- 点击编辑

#### 安装
```bash
npm install @tiptap/extension-mathematics katex
```

#### 完整配置
```typescript
// src/renderer/src/components/extensions/Mathematics.ts
import Mathematics from '@tiptap/extension-mathematics'

export const Math = Mathematics.configure({
  katexOptions: {
    throwOnError: false,
    strict: false,
    trust: true,
    macros: {
      '\\R': '\\mathbb{R}',
      '\\N': '\\mathbb{N}',
      '\\Z': '\\mathbb{Z}',
    },
  },
  HTMLAttributes: {
    class: 'math-node',
  },
})
```

#### 在主文件中引入样式
```typescript
// main.tsx 或 Editor.tsx
import 'katex/dist/katex.min.css'
```

#### CSS 样式
```css
/* Mathematics.css */
.math-node {
  display: inline-block;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  transition: background 0.15s;
}

.math-node:hover {
  background: var(--color-bg-hover);
}

.math-node.ProseMirror-selectednode {
  background: var(--color-primary-bg);
  outline: 2px solid var(--color-primary);
}

/* 块级公式 */
.math-node[data-type="block"] {
  display: block;
  text-align: center;
  padding: 16px;
  margin: 16px 0;
  background: var(--color-bg);
  border-radius: 8px;
}

/* KaTeX 样式覆盖 */
.katex {
  font-size: 1.1em;
}

.katex-display {
  margin: 0;
}
```

---

### 1.9 Mermaid 图表

**优先级**: P2 | **复杂度**: ⭐⭐⭐ | **官方支持**: ❌

#### 功能描述
- 代码块语言设为 `mermaid` 时渲染图表
- 支持流程图、时序图、甘特图、类图、饼图
- 编辑时显示代码，失焦后显示图表

#### 安装
```bash
npm install mermaid
```

#### 完整实现
```typescript
// src/renderer/src/components/extensions/Mermaid.ts
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { MermaidView } from '../MermaidView'

export const Mermaid = Node.create({
  name: 'mermaid',
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,

  addAttributes() {
    return {
      language: {
        default: 'mermaid',
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'pre[data-type="mermaid"]',
        preserveWhitespace: 'full',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'pre',
      mergeAttributes(HTMLAttributes, { 'data-type': 'mermaid', class: 'mermaid-block' }),
      ['code', 0],
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidView)
  },

  addCommands() {
    return {
      setMermaid:
        () =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            content: [
              {
                type: 'text',
                text: 'graph TD\n    A[开始] --> B[结束]',
              },
            ],
          })
        },
    }
  },
})
```

#### Mermaid 视图组件
```tsx
// src/renderer/src/components/MermaidView.tsx
import { NodeViewWrapper, NodeViewContent } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'

// 初始化 mermaid
mermaid.initialize({
  startOnLoad: false,
  theme: 'neutral',
  securityLevel: 'loose',
})

interface MermaidViewProps {
  node: {
    textContent: string
  }
  selected: boolean
}

export function MermaidView({ node, selected }: MermaidViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [svg, setSvg] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)

  useEffect(() => {
    const renderDiagram = async () => {
      if (!node.textContent.trim()) {
        setSvg('')
        return
      }

      try {
        const id = `mermaid-${Date.now()}`
        const { svg } = await mermaid.render(id, node.textContent)
        setSvg(svg)
        setError(null)
      } catch (err) {
        setError((err as Error).message)
        setSvg('')
      }
    }

    if (!isEditing) {
      renderDiagram()
    }
  }, [node.textContent, isEditing])

  // 选中时进入编辑模式
  useEffect(() => {
    setIsEditing(selected)
  }, [selected])

  return (
    <NodeViewWrapper className={`mermaid-wrapper ${selected ? 'selected' : ''}`}>
      {isEditing ? (
        <div className="mermaid-editor">
          <div className="mermaid-editor-label">Mermaid</div>
          <NodeViewContent as="code" className="mermaid-code" />
        </div>
      ) : (
        <div
          ref={containerRef}
          className="mermaid-preview"
          onClick={() => setIsEditing(true)}
        >
          {error ? (
            <div className="mermaid-error">
              <span>图表语法错误</span>
              <code>{error}</code>
            </div>
          ) : svg ? (
            <div dangerouslySetInnerHTML={{ __html: svg }} />
          ) : (
            <div className="mermaid-placeholder">点击编辑图表</div>
          )}
        </div>
      )}
    </NodeViewWrapper>
  )
}
```

#### CSS 样式
```css
/* Mermaid.css */
.mermaid-wrapper {
  margin: 16px 0;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--color-border);
}

.mermaid-wrapper.selected {
  border-color: var(--color-primary);
}

.mermaid-editor {
  background: var(--color-code-bg);
}

.mermaid-editor-label {
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-secondary);
  border-bottom: 1px solid var(--color-border);
}

.mermaid-code {
  display: block;
  padding: 12px 16px;
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  outline: none;
}

.mermaid-preview {
  padding: 24px;
  background: var(--color-bg);
  cursor: pointer;
  min-height: 100px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mermaid-preview:hover {
  background: var(--color-bg-hover);
}

.mermaid-preview svg {
  max-width: 100%;
  height: auto;
}

.mermaid-error {
  text-align: center;
  color: var(--color-danger);
}

.mermaid-error code {
  display: block;
  margin-top: 8px;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.mermaid-placeholder {
  color: var(--color-text-secondary);
  font-size: 14px;
}
```

---

## 二、附件和媒体功能

---

### 2.1 图片调整大小

**优先级**: P1 | **复杂度**: ⭐⭐ | **官方支持**: ✅ (部分)

#### 功能描述
- 拖拽图片边角调整大小
- 保持宽高比
- 显示尺寸信息

#### 方案：扩展官方 Image
```typescript
// src/renderer/src/components/extensions/ResizableImage.ts
import Image from '@tiptap/extension-image'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { ResizableImageView } from '../ResizableImageView'

export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) => element.getAttribute('width'),
        renderHTML: (attributes) => {
          if (!attributes.width) return {}
          return { width: attributes.width }
        },
      },
      height: {
        default: null,
        parseHTML: (element) => element.getAttribute('height'),
        renderHTML: (attributes) => {
          if (!attributes.height) return {}
          return { height: attributes.height }
        },
      },
      align: {
        default: 'center',
        parseHTML: (element) => element.getAttribute('data-align') || 'center',
        renderHTML: (attributes) => ({ 'data-align': attributes.align }),
      },
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView)
  },
})
```

#### 可调整大小的图片组件
```tsx
// src/renderer/src/components/ResizableImageView.tsx
import { NodeViewWrapper } from '@tiptap/react'
import { useRef, useState, useCallback } from 'react'

interface ResizableImageViewProps {
  node: {
    attrs: {
      src: string
      alt?: string
      title?: string
      width?: number
      height?: number
      align?: 'left' | 'center' | 'right'
    }
  }
  updateAttributes: (attrs: Partial<typeof node.attrs>) => void
  selected: boolean
}

export function ResizableImageView({ node, updateAttributes, selected }: ResizableImageViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isResizing, setIsResizing] = useState(false)

  const handleMouseDown = useCallback((e: React.MouseEvent, corner: string) => {
    e.preventDefault()
    e.stopPropagation()

    const startX = e.clientX
    const startY = e.clientY
    const startWidth = containerRef.current?.offsetWidth || 0
    const startHeight = containerRef.current?.offsetHeight || 0
    const aspectRatio = startWidth / startHeight

    setIsResizing(true)

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startX
      let newWidth = startWidth + deltaX
      let newHeight = newWidth / aspectRatio

      // 限制最小尺寸
      newWidth = Math.max(100, newWidth)
      newHeight = Math.max(50, newHeight)

      updateAttributes({
        width: Math.round(newWidth),
        height: Math.round(newHeight),
      })
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [updateAttributes])

  return (
    <NodeViewWrapper
      className={`image-wrapper align-${node.attrs.align || 'center'}`}
    >
      <div
        ref={containerRef}
        className={`image-container ${selected ? 'selected' : ''} ${isResizing ? 'resizing' : ''}`}
        style={{
          width: node.attrs.width ? `${node.attrs.width}px` : 'auto',
        }}
      >
        <img
          src={node.attrs.src}
          alt={node.attrs.alt || ''}
          title={node.attrs.title}
          draggable={false}
        />

        {selected && (
          <>
            <div
              className="resize-handle resize-handle-se"
              onMouseDown={(e) => handleMouseDown(e, 'se')}
            />
            <div className="image-size-info">
              {node.attrs.width && node.attrs.height
                ? `${node.attrs.width} × ${node.attrs.height}`
                : '原始尺寸'}
            </div>
          </>
        )}
      </div>
    </NodeViewWrapper>
  )
}
```

#### CSS 样式
```css
/* ResizableImage.css */
.image-wrapper {
  margin: 16px 0;
}

.image-wrapper.align-left { text-align: left; }
.image-wrapper.align-center { text-align: center; }
.image-wrapper.align-right { text-align: right; }

.image-container {
  display: inline-block;
  position: relative;
  max-width: 100%;
}

.image-container img {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 4px;
}

.image-container.selected {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.image-container.resizing {
  cursor: se-resize;
}

.resize-handle {
  position: absolute;
  width: 12px;
  height: 12px;
  background: var(--color-primary);
  border: 2px solid white;
  border-radius: 2px;
}

.resize-handle-se {
  right: -6px;
  bottom: -6px;
  cursor: se-resize;
}

.image-size-info {
  position: absolute;
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
  padding: 4px 8px;
  background: rgba(0, 0, 0, 0.6);
  color: white;
  font-size: 11px;
  border-radius: 4px;
  pointer-events: none;
}
```

---

### 2.2 视频嵌入

**优先级**: P2 | **复杂度**: ⭐⭐ | **官方支持**: ❌

#### 完整实现
```typescript
// src/renderer/src/components/extensions/Video.ts
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { VideoView } from '../VideoView'

export const Video = Node.create({
  name: 'video',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
      width: { default: '100%' },
      height: { default: 'auto' },
    }
  },

  parseHTML() {
    return [{ tag: 'video' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['video', mergeAttributes(HTMLAttributes, { controls: true })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(VideoView)
  },

  addCommands() {
    return {
      setVideo:
        (options: { src: string }) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: options,
          })
        },
    }
  },
})
```

#### 视频视图组件
```tsx
// src/renderer/src/components/VideoView.tsx
import { NodeViewWrapper } from '@tiptap/react'

interface VideoViewProps {
  node: {
    attrs: {
      src: string
      width?: string
      height?: string
    }
  }
  selected: boolean
}

export function VideoView({ node, selected }: VideoViewProps) {
  return (
    <NodeViewWrapper className={`video-wrapper ${selected ? 'selected' : ''}`}>
      <video
        src={node.attrs.src}
        controls
        style={{
          width: node.attrs.width || '100%',
          height: node.attrs.height || 'auto',
        }}
      />
    </NodeViewWrapper>
  )
}
```

---

### 2.3 音频嵌入

**优先级**: P2 | **复杂度**: ⭐⭐ | **官方支持**: ❌

#### 完整实现
```typescript
// src/renderer/src/components/extensions/Audio.ts
import { Node, mergeAttributes } from '@tiptap/core'

export const Audio = Node.create({
  name: 'audio',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
      title: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'audio' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      { class: 'audio-wrapper' },
      ['audio', mergeAttributes(HTMLAttributes, { controls: true })],
      HTMLAttributes.title ? ['span', { class: 'audio-title' }, HTMLAttributes.title] : '',
    ]
  },

  addCommands() {
    return {
      setAudio:
        (options: { src: string; title?: string }) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: options,
          })
        },
    }
  },
})
```

#### CSS 样式
```css
/* Audio.css */
.audio-wrapper {
  margin: 16px 0;
  padding: 12px;
  background: var(--color-bg);
  border-radius: 8px;
  border: 1px solid var(--color-border);
}

.audio-wrapper audio {
  width: 100%;
}

.audio-title {
  display: block;
  margin-top: 8px;
  font-size: 13px;
  color: var(--color-text-secondary);
}
```

---

### 2.4 文件附件

**优先级**: P2 | **复杂度**: ⭐⭐ | **官方支持**: ❌

#### 完整实现
```typescript
// src/renderer/src/components/extensions/FileAttachment.ts
import { Node, mergeAttributes } from '@tiptap/core'

const FILE_ICONS: Record<string, string> = {
  pdf: '📄',
  doc: '📝',
  docx: '📝',
  xls: '📊',
  xlsx: '📊',
  ppt: '📽️',
  pptx: '📽️',
  zip: '📦',
  rar: '📦',
  default: '📎',
}

function getFileIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  return FILE_ICONS[ext] || FILE_ICONS.default
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export const FileAttachment = Node.create({
  name: 'fileAttachment',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
      filename: { default: 'file' },
      filesize: { default: 0 },
      mimetype: { default: '' },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-file-attachment]' }]
  },

  renderHTML({ node }) {
    const { filename, filesize } = node.attrs
    const icon = getFileIcon(filename)
    const size = formatFileSize(filesize)

    return [
      'div',
      mergeAttributes({ 'data-file-attachment': '', class: 'file-attachment' }),
      ['span', { class: 'file-icon' }, icon],
      [
        'div',
        { class: 'file-info' },
        ['span', { class: 'file-name' }, filename],
        ['span', { class: 'file-size' }, size],
      ],
      ['a', { href: node.attrs.src, download: filename, class: 'file-download' }, '下载'],
    ]
  },

  addCommands() {
    return {
      setFileAttachment:
        (options: { src: string; filename: string; filesize: number; mimetype?: string }) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: options,
          })
        },
    }
  },
})
```

#### CSS 样式
```css
/* FileAttachment.css */
.file-attachment {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 12px 0;
  padding: 12px 16px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  transition: border-color 0.15s;
}

.file-attachment:hover {
  border-color: var(--color-primary);
}

.file-icon {
  font-size: 24px;
}

.file-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.file-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-size {
  font-size: 12px;
  color: var(--color-text-secondary);
}

.file-download {
  padding: 6px 12px;
  background: var(--color-primary);
  color: white;
  font-size: 13px;
  border-radius: 6px;
  text-decoration: none;
  transition: opacity 0.15s;
}

.file-download:hover {
  opacity: 0.9;
}
```

---

## 三、实现计划

### 阶段一 (v0.2) - 基础格式
```bash
# 安装依赖
npm install @tiptap/extension-highlight @tiptap/extension-underline @tiptap/extension-color @tiptap/extension-text-style tippy.js
```

实现内容：
1. ✅ 高亮 (含 ==语法==)
2. ✅ 下划线
3. ✅ 文字颜色/背景色
4. ✅ 斜杠命令菜单

### 阶段二 (v0.3) - 结构化内容
```bash
npm install @tiptap/extension-details @tiptap/extension-details-summary @tiptap/extension-details-content @tiptap/extension-table-of-contents
```

实现内容：
1. ✅ Callout 提示块
2. ✅ Toggle 折叠块
3. ✅ 目录 TOC
4. ✅ 图片调整大小
5. ✅ 拖拽排序块

### 阶段三 (v0.4) - 高级内容
```bash
npm install @tiptap/extension-mathematics katex mermaid
```

实现内容：
1. ✅ 数学公式 LaTeX
2. ✅ Mermaid 图表
3. ✅ 视频/音频嵌入
4. ✅ 文件附件

### 阶段四 (v0.5+) - 完善功能
```bash
npm install tiptap-footnotes
```

实现内容：
1. 脚注
2. 嵌入 Transclusion
3. 链接预览卡片

---

## 四、依赖汇总

### 官方 Tiptap 扩展
```json
{
  "@tiptap/extension-highlight": "^3.x",
  "@tiptap/extension-underline": "^3.x",
  "@tiptap/extension-color": "^3.x",
  "@tiptap/extension-text-style": "^3.x",
  "@tiptap/extension-details": "^3.x",
  "@tiptap/extension-details-summary": "^3.x",
  "@tiptap/extension-details-content": "^3.x",
  "@tiptap/extension-table-of-contents": "^3.x",
  "@tiptap/extension-mathematics": "^3.x",
  "@tiptap/extension-youtube": "^3.x",
  "@tiptap/extension-file-handler": "^3.x",
  "@tiptap/extension-drag-handle": "^3.x"
}
```

### 第三方库
```json
{
  "katex": "^0.16.x",
  "mermaid": "^10.x",
  "tippy.js": "^6.x",
  "tiptap-footnotes": "^2.x"
}
```

---

*最后更新: 2024-12-18*
