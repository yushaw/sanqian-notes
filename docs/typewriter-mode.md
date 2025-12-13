# 打字机模式（Typewriter Mode）实现文档

## 概述

打字机模式是一种沉浸式写作体验，模拟传统打字机的交互方式：**光标固定在屏幕某个位置，内容滚动而非光标移动**。

本项目的打字机模式完全独立于主编辑器，拥有自己的 TipTap 编辑器实例和样式系统。

---

## 禅意设计理念

「心流」品牌的打字机模式追求东方美学的禅意体验：

### 设计原则

| 原则 | 实现 |
|------|------|
| **水墨意境** | 深色如夜间书房（墨色 `#1a1a1a`），浅色如日间案头（宣纸色 `#f8f6f2`） |
| **呼吸留白** | 宽松的行距（2.2）、字间距（0.05em）、段间距，让文字有呼吸空间 |
| **专注渐隐** | 焦点文字清晰，周围逐渐淡出，引导注意力 |
| **极简克制** | 隐藏一切不必要的 UI 元素，仅 hover 时显示 |
| **朱砂点睛** | 使用朱砂红（`#c45c3e`）作为点缀色，与 logo 呼应 |

### 字体选择

优先使用 **霞鹜文楷（LXGW WenKai）** - 一款开源的文艺楷体，具有书法美感：

```typescript
const FONT_WENKAI = "'LXGW WenKai', 'LXGW WenKai Screen', 'Kaiti SC', 'STKaiti', 'Source Han Serif SC', ..."
```

### 配色方案

```typescript
const ZEN_COLORS = {
  // 深色模式 - 墨韵
  ink: '#1a1a1a',              // 浓墨背景
  textDark: '#e6e1db',         // 温暖的白（主文字）
  textDarkFocus: '#f5f2ed',    // 焦点文字
  textDarkDim: '#6b6560',      // 暗淡文字

  // 浅色模式 - 纸韵
  paper: '#f8f6f2',            // 宣纸背景
  textLight: '#2c2825',        // 温暖的黑（主文字）
  textLightFocus: '#1a1715',   // 焦点文字
  textLightDim: '#a09890',     // 暗淡文字

  // 点缀色
  vermilion: '#c45c3e',        // 朱砂红
}
```

---

## 核心交互逻辑

### 与普通模式的区别

| 操作 | 普通模式 | 打字机模式 |
|------|---------|-----------|
| **光标** | 在文档中移动 | 锁定在屏幕固定位置（垂直 65%，偏下方便阅读） |
| **打字** | 光标往下走 | 内容往上推，光标不动 |
| **滚动** | 只是视觉浏览 | 光标跟随到屏幕中心对应位置 |
| **点击** | 直接定位光标 | 触发滚动动画，内容滑动到点击位置 |
| **焦点效果** | 无 | 当前段落清晰，相邻段落渐变淡化 |

### 详细行为

1. **光标固定**：始终保持在屏幕垂直 65% 位置（偏下方便阅读已写内容）
2. **打字时**：内容向上推动，光标位置不变
3. **滚动时**：光标实时跟随，跳转到屏幕中心对应的文档位置
4. **点击时**：触发平滑滚动动画，让点击位置来到屏幕固定位置
5. **过度滚动**：允许首行/末行也能滚动到屏幕中心位置
6. **焦点渐变**：当前段落 opacity: 1，相邻段落依次 0.55 → 0.35 → 0.20 → 0.12

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

// 2. 计算目标位置（屏幕高度的 65%）
const targetY = containerRect.height * 0.65

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

// 1. 计算屏幕固定位置对应的坐标
const targetY = containerRect.top + containerRect.height * 0.65
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

**当前实现：20 层 CSS 选择器 + 动态透明度**

使用 TipTap Focus 扩展给焦点 block 添加 `.has-focus` 类，配合 CSS `:has()` 和 `+` 兄弟选择器控制 ±1~20 层的透明度。透明度值由 JS 根据可视区域动态计算。

**实现原理**：

1. **CSS 选择器**：预定义 20 层选择器，匹配距离焦点 ±1 到 ±20 的 block
2. **动态透明度**：JS 根据屏幕能显示的 block 数量计算透明度曲线
3. **自适应效果**：小屏幕渐变快，大屏幕渐变慢，保证从焦点到屏幕边缘都有完整渐变

```typescript
// TypewriterMode.tsx: 配置 Focus 扩展
Focus.configure({
  className: 'has-focus',
  mode: 'shallowest',  // 只给最外层块级元素添加类
})

// 动态计算透明度
const updateOpacityVariables = () => {
  // 估算可视区域能显示多少 block
  const visibleBlockCount = Math.floor(viewportHeight / avgBlockHeight)
  const halfVisible = visibleBlockCount / 2

  // 计算每层透明度
  for (let dist = 1; dist <= 20; dist++) {
    const ratio = Math.min(dist / halfVisible, 1)
    const opacity = 1 - (1 - 0.03) * Math.pow(ratio, 1.5)
    container.style.setProperty(`--tw-opacity-${dist}`, opacity)
  }
}
```

```css
/* Typewriter.css: 20 层 CSS 选择器 */

/* 默认所有元素最暗 */
.ProseMirror > * {
  opacity: var(--tw-opacity-far, 0.03);
  transition: opacity 0.2s ease;
}

/* 焦点元素完全可见 */
.ProseMirror > .has-focus { opacity: 1; }

/* ±1 */
.ProseMirror > *:has(+ .has-focus),
.ProseMirror > .has-focus + * { opacity: var(--tw-opacity-1); }
/* ±2 */
.ProseMirror > *:has(+ * + .has-focus),
.ProseMirror > .has-focus + * + * { opacity: var(--tw-opacity-2); }
/* ... 一直到 ±20 */
```

**视觉效果**（假设屏幕显示 10 个 block，halfVisible = 5）：
```
段落 A    ░░░░░░░░░░  (0.03)  - 距离 > 5
段落 B    ░░░░░░░░░░  (0.08)  - 距离 5
段落 C    ▒▒▒▒▒▒▒▒▒▒  (0.20)  - 距离 4
段落 D    ▒▒▒▒▒▒▒▒▒▒  (0.37)  - 距离 3
段落 E    ▓▓▓▓▓▓▓▓▓▓  (0.57)  - 距离 2
段落 F    ████████▓▓  (0.78)  - 距离 1
段落 G    ██████████  (1.00)  ← 焦点
段落 H    ████████▓▓  (0.78)  - 距离 1
段落 I    ▓▓▓▓▓▓▓▓▓▓  (0.57)  - 距离 2
...
```

**注意**：
- ProseMirror 会重置 DOM 元素的 style 属性，所以透明度必须通过 CSS 类/变量控制
- `:has()` 选择器需要现代浏览器支持（Chrome 105+, Safari 15.4+, Firefox 121+）

### 5. 过度滚动

**原理**：通过大的 padding 让首行/末行也能滚动到固定光标位置。

```css
/* Typewriter.css */
.typewriter-inner {
  /* 顶部留出 65vh 空间，让第一行可以滚到 65% 位置 */
  padding-top: calc(var(--tw-cursor-offset-vh, 65vh));

  /* 底部留出 35vh 空间 */
  padding-bottom: calc(100vh - var(--tw-cursor-offset-vh, 65vh));
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
// 深色主题 - 墨韵
dark: {
  backgroundColor: '#1a1a1a',     // 浓墨
  textColor: '#e6e1db',           // 温暖的白
  focusTextColor: '#f5f2ed',      // 焦点文字
  dimmedTextColor: '#6b6560',     // 暗淡文字
  accentColor: '#c45c3e',         // 朱砂红
  fontFamily: FONT_WENKAI,        // 文楷字体
  fontSize: '19px',
  lineHeight: 2.2,
  letterSpacing: '0.05em',
  maxWidth: '640px',
  cursorOffset: 0.65,             // 光标位置 65%
  // ...
}

// 浅色主题 - 纸韵
light: {
  backgroundColor: '#f8f6f2',     // 宣纸色
  textColor: '#2c2825',           // 温暖的黑
  focusTextColor: '#1a1715',      // 焦点文字
  dimmedTextColor: '#a09890',     // 暗淡文字
  accentColor: '#c45c3e',         // 朱砂红
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
| CSS 过渡 | `transition: opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1)` 柔和渐变 |
| 进入动画 | `0.6s` 缓慢淡入，增强禅意感 |

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

## 音频系统

打字机模式支持打字音效和背景环境音，增强沉浸式写作体验。

### 音频文件位置

```
src/renderer/public/audio/
├── typewriter-key.wav     # 打字机按键音
├── typewriter-return.wav  # 回车键音
├── rain.mp3               # 雨声
├── cafe.mp3               # 咖啡厅
├── waves.mp3              # 海浪
├── fire.mp3               # 壁炉
├── forest.mp3             # 森林
```

### 音频文件获取

推荐从以下免费音频资源网站获取高质量环境音：

| 网站 | 许可协议 | 说明 |
|------|---------|------|
| [Freesound.org](https://freesound.org) | CC0 / CC-BY | 最大的免费音效库，需注册下载 |
| [Pixabay](https://pixabay.com/sound-effects/) | Pixabay License | 免费商用，无需署名 |
| [Mixkit](https://mixkit.co/free-sound-effects/) | Mixkit License | 免费商用 |
| [Zapsplat](https://www.zapsplat.com) | Standard License | 需注册，免费账户有下载限制 |

#### 推荐音频规格

| 属性 | 推荐值 |
|------|-------|
| 格式 | MP3 |
| 比特率 | 128-192 kbps |
| 采样率 | 44.1 kHz |
| 声道 | 立体声 |
| 时长 | 30秒-2分钟（循环播放） |
| 文件大小 | < 2MB |

#### 环境音选择建议

- **雨声**：搜索 "rain ambient loop"、"rain on window"
- **咖啡厅**：搜索 "cafe ambience"、"coffee shop background"
- **海浪**：搜索 "ocean waves loop"、"beach ambience"
- **壁炉**：搜索 "fireplace crackling"、"fire ambient"
- **森林**：搜索 "forest ambience"、"nature sounds birds"

#### 打字音效选择建议

- **按键音**：搜索 "typewriter key click"、"mechanical keyboard"，选择清脆但不刺耳的音效
- **回车音**：搜索 "typewriter carriage return"、"typewriter bell"

### 音频实现

音频系统位于 `TypewriterAudio.ts`：

```typescript
// 打字机音效
export function playTypewriterClick(): void
export function playTypewriterReturn(): void

// 背景环境音
export function playAmbientSound(type: AmbientSoundType, volume?: number): void
export function stopAmbientSound(): void
export function setAmbientVolume(volume: number): void

// 清理
export function cleanupAudio(): void
```

#### 回退方案

当本地音频文件不存在时，系统会使用 Web Audio API 生成简单的合成音效作为回退：

- 打字音：方波合成的短促咔哒声
- 环境音：滤波白噪音/棕噪音

### 音量控制

| 音效类型 | 默认音量 | 说明 |
|---------|---------|------|
| 按键音 | 0.2-0.3 | 随机轻微变化，更自然 |
| 回车音 | 0.3 | 略大于按键音 |
| 环境音 | 0.3 | 用户可调节 |

环境音使用淡入淡出效果（约1秒），避免突兀的音量变化。

---

## 参考资料

- [iA Writer Focus Mode](https://ia.net/writer/support/editor/focus-mode)
- [Typora Focus and Typewriter Mode](https://support.typora.io/Focus-and-Typewriter-Mode/)
- [Obsidian Typewriter Mode Plugin](https://github.com/davisriedel/obsidian-typewriter-mode)
- [TipTap Focus Extension](https://tiptap.dev/docs/editor/extensions/functionality/focus)
