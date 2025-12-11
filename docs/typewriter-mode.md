# 打字机模式（Typewriter Mode）实现文档

## 概述

打字机模式是一种沉浸式写作体验，模拟传统打字机的交互方式：**光标固定在屏幕某个位置，内容滚动而非光标移动**。

本项目的打字机模式完全独立于主编辑器，拥有自己的 TipTap 编辑器实例和样式系统。

---

## 核心交互逻辑

### 与普通模式的区别

| 操作 | 普通模式 | 打字机模式 |
|------|---------|-----------|
| **光标** | 在文档中移动 | 锁定在屏幕固定位置（垂直 70%） |
| **打字** | 光标往下走 | 内容往上推，光标不动 |
| **滚动** | 只是视觉浏览 | 光标跟随到屏幕中心对应位置 |
| **点击** | 直接定位光标 | 触发滚动动画，内容滑动到点击位置 |
| **焦点效果** | 无 | 当前段落清晰，相邻段落渐变淡化 |

### 详细行为

1. **光标固定**：始终保持在屏幕垂直 70% 位置
2. **打字时**：内容向上推动，光标位置不变
3. **滚动时**：光标实时跟随，跳转到屏幕中心对应的文档位置
4. **点击时**：触发平滑滚动动画，让点击位置来到屏幕固定位置
5. **过度滚动**：允许首行/末行也能滚动到屏幕中心位置
6. **焦点渐变**：当前段落 opacity: 1，相邻段落依次 0.7 → 0.5 → 0.35 → 0.2

---

## 文件结构

```
src/renderer/src/components/
├── TypewriterMode.tsx    # 打字机模式主组件
├── Typewriter.css        # 打字机模式样式
└── Editor.tsx            # 主编辑器（完全独立）
```

---

## 核心实现原理

### 1. 光标固定滚动

**原理**：监听光标位置变化，自动滚动内容使光标回到固定位置。

```typescript
// TypewriterMode.tsx: scrollToCursor()

// 1. 获取光标在屏幕上的坐标
const coords = editor.view.coordsAtPos(from)

// 2. 计算目标位置（屏幕高度的 70%）
const targetY = containerRect.height * 0.7

// 3. 计算需要滚动的偏移量
const scrollOffset = currentCursorY - targetY

// 4. 使用 requestAnimationFrame 实现平滑滚动动画
animationFrameId.current = requestAnimationFrame(animateScroll)
```

**关键点**：
- 使用 `editor.view.coordsAtPos(pos)` 获取光标坐标
- 使用 `requestAnimationFrame` + `easeOutCubic` 缓动函数实现流畅动画
- 设置阈值（15px）避免微小滚动

### 2. 滚动时光标跟随

**原理**：用户手动滚动时，光标跟随到屏幕中心对应的文档位置。

```typescript
// TypewriterMode.tsx: handleScroll()

// 1. 计算屏幕中心对应的坐标
const targetY = containerRect.top + containerRect.height * 0.7
const targetX = lastCursorX.current  // 保持水平位置

// 2. 通过坐标获取文档位置
const pos = editor.view.posAtCoords({ left: targetX, top: targetY })

// 3. 设置光标位置
editor.commands.setTextSelection(pos.pos)
```

**关键点**：
- 使用 `editor.view.posAtCoords()` 坐标转位置
- 保存上次光标的 X 坐标，滚动时保持水平位置
- 验证位置有效性（`pos.inside >= 0`）

### 3. 防止循环触发

**问题**：光标变化触发滚动，滚动又触发光标变化，形成死循环。

**解决方案**：使用标志位区分"程序触发"和"用户触发"。

```typescript
// 标志位
const isProgrammaticScroll = useRef(false)
const isProgrammaticSelection = useRef(false)

// 滚动时
if (isProgrammaticScroll.current) return  // 忽略程序触发的滚动

// 设置光标时
isProgrammaticSelection.current = true
editor.commands.setTextSelection(pos.pos)
setTimeout(() => {
  isProgrammaticSelection.current = false
}, 50)
```

### 4. 焦点渐变效果

**问题**：ProseMirror 会在每次渲染时重置 DOM 元素的 style 属性，直接操作 DOM style 无效。

**解决方案**：使用 TipTap Focus 扩展 + CSS 兄弟选择器。

```typescript
// TypewriterMode.tsx: 配置 Focus 扩展
Focus.configure({
  className: 'has-focus',
  mode: 'shallowest',  // 只给最外层块级元素添加类
})
```

```css
/* Typewriter.css: 使用 CSS 实现渐变 */

/* 默认所有元素最暗 */
.ProseMirror > * {
  opacity: 0.2;
}

/* 焦点元素完全可见 */
.ProseMirror > .has-focus {
  opacity: 1;
}

/* 相邻兄弟使用 :has() 和 + 选择器 */
.ProseMirror > *:has(+ .has-focus) { opacity: 0.7; }  /* 前一个 */
.ProseMirror > .has-focus + * { opacity: 0.7; }       /* 后一个 */
.ProseMirror > *:has(+ * + .has-focus) { opacity: 0.5; }  /* 前两个 */
.ProseMirror > .has-focus + * + * { opacity: 0.5; }       /* 后两个 */
/* ... 更多层级 */
```

### 5. 过度滚动

**原理**：通过大的 padding 让首行/末行也能滚动到固定光标位置。

```css
/* Typewriter.css */
.typewriter-inner {
  /* 顶部留出 70vh 空间，让第一行可以滚到 70% 位置 */
  padding-top: calc(var(--tw-cursor-offset-vh, 70vh));

  /* 底部留出 30vh 空间 */
  padding-bottom: calc(100vh - var(--tw-cursor-offset-vh, 70vh));
}
```

---

## 主题系统

### 主题接口

```typescript
interface TypewriterTheme {
  // 颜色
  backgroundColor: string    // 背景色
  textColor: string          // 普通文字色
  focusTextColor: string     // 焦点文字色
  dimmedTextColor: string    // 淡化文字色
  accentColor: string        // 主题强调色

  // 字体
  fontFamily: string         // 字体栈
  fontSize: string           // 基础字号
  lineHeight: number         // 行高
  letterSpacing: string      // 字间距

  // 布局
  maxWidth: string           // 内容最大宽度
  cursorOffset: number       // 光标固定位置 (0.7 = 70%)
  paddingHorizontal: string  // 水平内边距

  // 焦点效果
  focusMode: 'line' | 'sentence' | 'paragraph' | 'none'
  dimOpacity: number         // 淡化透明度

  // 增强效果
  showCursorLine: boolean    // 显示光标位置指示线
  cursorLineColor: string    // 指示线颜色
  showWordCount: boolean     // 显示字数统计
}
```

### 预设主题

```typescript
// 深色主题
dark: {
  backgroundColor: '#1c1c1e',  // 温暖的墨色
  textColor: '#c7c7cc',
  focusTextColor: '#f5f5f7',
  // ...
}

// 浅色主题
light: {
  backgroundColor: '#faf9f7',  // 温暖的米白色
  textColor: '#3c3c43',
  focusTextColor: '#1c1c1e',
  // ...
}
```

### CSS 变量传递

主题配置通过 CSS 变量传递给样式：

```typescript
// TypewriterMode.tsx
const cssVariables = {
  '--tw-bg': resolvedTheme.backgroundColor,
  '--tw-text': resolvedTheme.textColor,
  '--tw-cursor-offset-vh': `${resolvedTheme.cursorOffset * 100}vh`,
  // ...
}

return <div style={cssVariables}>...</div>
```

---

## 性能优化

| 优化点 | 实现方式 |
|--------|----------|
| 滚动事件节流 | `setTimeout` 16ms（约 60fps） |
| 光标变化防抖 | `setTimeout` 50ms 延迟触发滚动 |
| 滚动动画 | `requestAnimationFrame` 合并更新 |
| 防止循环触发 | `isProgrammaticScroll` / `isProgrammaticSelection` 标志位 |
| CSS 过渡 | `transition: opacity 0.15s ease-out` 平滑变化 |

---

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Cmd/Ctrl + Shift + T` | 进入/退出打字机模式 |
| `ESC` | 退出打字机模式 |
| `Enter`（在标题中） | 跳转到正文编辑 |

---

## 扩展说明

### TipTap 扩展列表

打字机模式使用独立的 TipTap 编辑器，配置了以下扩展：

- **StarterKit** - 基础功能（段落、标题、列表、代码块等）
- **Placeholder** - 空编辑器占位文本
- **Typography** - 排版优化
- **Link** - 链接支持
- **TaskList / TaskItem** - 任务列表
- **CharacterCount** - 字数统计
- **Image** - 图片支持
- **Focus** - 焦点高亮（关键扩展）
- **Table** - 表格支持
- **BlockId** - 块级 ID（自定义）
- **NoteLink** - 笔记内链接（自定义）

### 为什么不能直接操作 DOM style？

ProseMirror 是受控编辑器，它维护着文档状态和 DOM 的同步。当状态更新时，ProseMirror 会重新渲染 DOM，这会覆盖我们直接设置的 style 属性。

```typescript
// ❌ 这样不行 - 会被 ProseMirror 覆盖
element.style.opacity = '0.5'

// ✅ 正确方式 - 使用 CSS 类
Focus.configure({ className: 'has-focus' })
```

详见 [TipTap API 文档](./tiptap-api.md#重要注意事项)。

---

## 参考资料

- [iA Writer Focus Mode](https://ia.net/writer/support/editor/focus-mode)
- [Typora Focus and Typewriter Mode](https://support.typora.io/Focus-and-Typewriter-Mode/)
- [Obsidian Typewriter Mode Plugin](https://github.com/davisriedel/obsidian-typewriter-mode)
- [TipTap Focus Extension](https://tiptap.dev/docs/editor/extensions/functionality/focus)
