# TipTap API 参考文档

本文档整理了项目中使用的 TipTap 官方扩展和 API，以及在开发过程中发现的重要注意事项。

## 目录

- [已安装的扩展](#已安装的扩展)
- [核心概念](#核心概念)
- [常用 API](#常用-api)
- [样式定制](#样式定制)
- [重要注意事项](#重要注意事项)

---

## 已安装的扩展

### 核心扩展

| 扩展 | 包名 | 说明 |
|------|------|------|
| StarterKit | `@tiptap/starter-kit` | 包含常用扩展的套件（段落、标题、列表、代码块等） |
| React 集成 | `@tiptap/react` | React 组件和 hooks |

### 功能扩展

| 扩展 | 包名 | 说明 |
|------|------|------|
| Placeholder | `@tiptap/extension-placeholder` | 空编辑器时显示占位文本 |
| Typography | `@tiptap/extension-typography` | 自动排版优化（引号、破折号等） |
| Link | `@tiptap/extension-link` | 链接支持 |
| TaskList | `@tiptap/extension-task-list` | 任务列表 |
| TaskItem | `@tiptap/extension-task-item` | 任务列表项 |
| CharacterCount | `@tiptap/extension-character-count` | 字符/词数统计 |
| Image | `@tiptap/extension-image` | 图片支持 |
| Table | `@tiptap/extension-table` | 表格支持 |
| TableRow | `@tiptap/extension-table-row` | 表格行 |
| TableHeader | `@tiptap/extension-table-header` | 表格头 |
| TableCell | `@tiptap/extension-table-cell` | 表格单元格 |
| **Focus** | `@tiptap/extension-focus` | **焦点高亮（添加 CSS 类到焦点节点）** |

### 自定义扩展

| 扩展 | 文件 | 说明 |
|------|------|------|
| BlockId | `./extensions/BlockId.ts` | 自动生成 Block ID，用于块级链接 |
| NoteLink | `./extensions/NoteLink.ts` | 笔记内链接 `[[笔记名]]` 语法支持 |

---

## 核心概念

### Editor 实例

```typescript
import { useEditor } from '@tiptap/react'

const editor = useEditor({
  extensions: [...],
  content: initialContent,
  editorProps: {
    attributes: {
      class: 'my-editor-class',
    },
  },
  onUpdate: ({ editor }) => {
    const json = editor.getJSON()
    // 保存内容
  },
})
```

### EditorContent 组件

```tsx
import { EditorContent } from '@tiptap/react'

<EditorContent editor={editor} className="editor-wrapper" />
```

**DOM 结构：**
```html
<div class="editor-wrapper">
  <div class="tiptap ProseMirror" contenteditable="true">
    <p>...</p>
    <h1>...</h1>
  </div>
</div>
```

### 事件监听

```typescript
// 监听选区变化
editor.on('selectionUpdate', ({ editor }) => {
  const { from, to } = editor.state.selection
})

// 监听内容变化
editor.on('update', ({ editor }) => {
  const content = editor.getJSON()
})

// 监听焦点
editor.on('focus', ({ editor }) => {})
editor.on('blur', ({ editor }) => {})

// 移除监听
editor.off('selectionUpdate', handler)
```

---

## 常用 API

### 编辑器命令

```typescript
// 焦点控制
editor.commands.focus()           // 聚焦
editor.commands.focus('start')    // 聚焦到开头
editor.commands.focus('end')      // 聚焦到结尾

// 选区操作
editor.commands.setTextSelection(pos)  // 设置选区位置

// 内容操作
editor.commands.setContent(content)    // 设置内容
editor.commands.clearContent()         // 清空内容

// 格式命令
editor.commands.toggleBold()
editor.commands.toggleItalic()
editor.commands.toggleHeading({ level: 1 })
editor.commands.toggleBulletList()
editor.commands.toggleOrderedList()
```

### 状态查询

```typescript
// 获取内容
editor.getJSON()                  // JSON 格式
editor.getHTML()                  // HTML 格式
editor.getText()                  // 纯文本

// 获取选区
const { from, to } = editor.state.selection

// 获取光标坐标
const coords = editor.view.coordsAtPos(from)
// coords = { left, top, right, bottom }

// 通过坐标获取位置
const pos = editor.view.posAtCoords({ left, top })
// pos = { pos, inside }

// 获取存储数据（如字符统计）
editor.storage.characterCount?.words()
editor.storage.characterCount?.characters()
```

### DOM 访问

```typescript
// 获取编辑器 DOM 元素
const dom = editor.view.dom  // .ProseMirror 元素

// 获取文档节点
const doc = editor.state.doc

// 解析位置
const $pos = editor.state.doc.resolve(pos)
```

---

## 样式定制

### CSS 选择器

```css
/* 编辑器容器 */
.tiptap {}
.ProseMirror {}

/* 编辑器子元素 */
.ProseMirror > p {}
.ProseMirror > h1 {}
.ProseMirror > ul {}

/* 空编辑器 placeholder */
.ProseMirror.is-editor-empty::before {
  content: attr(data-placeholder);
}

/* 光标颜色 */
.ProseMirror {
  caret-color: blue;
}

/* 选中文本 */
.ProseMirror ::selection {
  background: rgba(0, 100, 255, 0.2);
}
```

### Focus 扩展样式

Focus 扩展会给当前焦点所在的块添加 CSS 类（默认 `.has-focus`）：

```typescript
Focus.configure({
  className: 'has-focus',
  mode: 'shallowest',  // 'all' | 'shallowest' | 'deepest'
})
```

```css
/* 焦点元素 */
.ProseMirror > .has-focus {
  opacity: 1;
}

/* 非焦点元素 */
.ProseMirror > *:not(.has-focus) {
  opacity: 0.3;
}

/* 渐变效果 - 使用 CSS 兄弟选择器 */

/* 焦点元素的前一个兄弟 */
.ProseMirror > *:has(+ .has-focus) {
  opacity: 0.7;
}

/* 焦点元素的后一个兄弟 */
.ProseMirror > .has-focus + * {
  opacity: 0.7;
}

/* 更远的兄弟... */
.ProseMirror > *:has(+ * + .has-focus) {
  opacity: 0.5;
}
.ProseMirror > .has-focus + * + * {
  opacity: 0.5;
}
```

---

## 重要注意事项

### 1. 不要直接操作 DOM style

**问题：** ProseMirror 是受控编辑器，会在每次渲染时重置 DOM 元素的 style 属性。

```typescript
// ❌ 错误 - 这样设置的样式会被 ProseMirror 覆盖
element.style.opacity = '0.5'
element.style.setProperty('opacity', '0.5', 'important')
```

**解决方案：** 使用 CSS 类或 TipTap 扩展来控制样式。

```typescript
// ✅ 正确 - 使用 Focus 扩展添加 CSS 类
Focus.configure({ className: 'has-focus' })
```

```css
/* ✅ 正确 - 用 CSS 控制样式 */
.has-focus { opacity: 1; }
```

### 2. editor.view.dom 的使用

`editor.view.dom` 返回的是 `.ProseMirror` 元素，但在某些情况下可能与实际渲染的 DOM 不同步。

```typescript
// 如果需要操作 DOM，建议通过 ref 获取
const containerRef = useRef<HTMLDivElement>(null)
const proseMirror = containerRef.current?.querySelector('.ProseMirror')
```

### 3. 扩展配置必须在 useEditor 初始化时传入

```typescript
// ✅ 正确
const editor = useEditor({
  extensions: [
    Focus.configure({ className: 'has-focus', mode: 'shallowest' }),
  ],
})

// ❌ 错误 - 不能动态添加扩展
editor.extensionManager.extensions.push(Focus)
```

### 4. coordsAtPos 和 posAtCoords

这两个方法用于在光标位置和屏幕坐标之间转换：

```typescript
// 位置 → 坐标
const coords = editor.view.coordsAtPos(from)

// 坐标 → 位置
const pos = editor.view.posAtCoords({ left: x, top: y })
if (pos && pos.inside >= 0) {
  // pos.pos 是文档中的位置
  // pos.inside 是所在节点的位置，-1 表示不在任何节点内
}
```

### 5. 事件监听的清理

```typescript
useEffect(() => {
  const handler = () => { /* ... */ }
  editor.on('selectionUpdate', handler)

  return () => {
    editor.off('selectionUpdate', handler)  // 必须清理
  }
}, [editor])
```

---

## 参考资料

- [TipTap 官方文档](https://tiptap.dev/docs)
- [Focus 扩展](https://tiptap.dev/docs/editor/extensions/functionality/focus)
- [ProseMirror 指南](https://tiptap.dev/docs/editor/core-concepts/prosemirror)
- [样式定制](https://tiptap.dev/docs/editor/getting-started/style-editor)
- [Editor API](https://tiptap.dev/docs/editor/api/editor)
