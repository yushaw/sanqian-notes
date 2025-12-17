# Sanqian Notes

Obsidian 小白友好版 - AI 加持的笔记应用

## 技术栈

- **前端**: Electron + React + TypeScript + Tailwind CSS
- **编辑器**: BlockNote (基于 ProseMirror/Tiptap)
- **数据库**: SQLite (Better-sqlite3)
- **AI**: Sanqian SDK (待集成)

## 功能规划

### MVP 功能
- [x] 三栏布局 (侧边栏 / 笔记列表 / 编辑器)
- [x] BlockNote WYSIWYG 编辑器
- [x] SQLite 数据模型设计
- [x] 笔记 CRUD 与数据库集成
- [x] Smart Views (All Notes, Daily Notes, Recent, Favorites)
- [x] 多语言支持 (中文/英文)
- [x] 深色/浅色模式切换
- [x] 字号调整功能
- [x] 笔记本管理 (增删改)
- [x] 工具栏按钮功能绑定
- [ ] 标签系统
- [ ] 双向链接 `[[]]` 语法
- [ ] Daily Notes 自动创建
- [ ] 全文搜索

### 后续功能
- [ ] Sanqian AI Tools 集成
- [ ] Markdown 导入/导出
- [ ] 快捷键支持

## 开发

```bash
# 安装依赖
npm install

# 为 Electron 重新构建 native 模块
npx electron-rebuild -f -w better-sqlite3

# 启动开发服务器
npm run dev

# 构建
npm run build
```

## 数据模型

### Notes 表
- id, title, content (BlockNote JSON)
- notebook_id, is_daily, daily_date
- is_favorite, created_at, updated_at

### Notebooks 表
- id, name, color, order_index

### Tags 表
- id, name

### Note Links 表 (双向链接)
- source_note_id, target_note_id

## 开发日志

### 2025-12-10
- 初始化项目结构
- 搭建三栏布局 (Sidebar / NoteList / Editor)
- 集成 BlockNote 编辑器
- 设计 SQLite 数据模型 (notes, notebooks, tags, note_links)
- 实现全文搜索 (FTS5)
- 接入真实数据库 (替换 mock 数据)
- 实现多语言支持 (中文/英文)，参考 todolist 的 i18n 架构
- 实现深色/浅色模式切换，支持跟随系统
- 实现字号调整功能 (小/标准/大/特大)
- 添加设置页面 (语言、主题、字号)
- 实现笔记本增删改功能，创建 NotebookModal 组件
- 实现编辑器工具栏功能绑定 (加粗、斜体、删除线、标题、列表、代码、链接等)
- 用 Tiptap 替换 BlockNote 编辑器，实现 Zen 极简风格
- 实现 Markdown 快捷输入自动转换 (# 标题, - 列表, > 引用等)
- 实现打字机模式 (Typewriter Mode) - 光标始终保持在视口中央
- 实现专注模式 (Focus Mode) - 非当前编辑段落变淡
- 优化 Zen 视觉风格 (浮动工具栏、大留白、优雅字体渲染)
- 全面重构 UI 设计系统，参考 zen.unit.ms 的极简风格
  - 更柔和的配色方案 (暖灰色调)
  - 统一的 CSS 变量系统
  - 更精致的字号层级 (11px-15px)
  - 平滑的过渡动画
  - 优化 Sidebar、NoteList、Settings、NotebookModal 组件样式
- 实现 Obsidian 风格的 Block 级别链接系统
  - Block ID 基础设施 (自动生成 6 位 ID，存储在节点属性中)
  - 扩展链接弹窗，支持三种搜索模式：笔记、标题 (#)、Block (^)
  - 链接语法：`[[笔记名]]`、`[[笔记名#标题]]`、`[[笔记名#^blockId]]`
  - 点击链接跳转到目标笔记的对应位置，带高亮动画
- 修复所有 TypeScript 类型错误 (database.ts, theme/index.tsx, i18n/context.tsx)

### 2025-12-11
- 实现全新的打字机模式 (Typewriter Mode)，完全独立的沉浸式写作体验
  - 光标固定在屏幕垂直 70% 位置，内容滚动而非光标移动
  - 滚动时光标实时跟随到屏幕中心对应位置
  - 点击触发滚动动画，让点击位置来到固定位置
  - 支持过度滚动，首行/末行也能居中
  - 使用 requestAnimationFrame + easeOutCubic 实现流畅滚动动画
  - 快捷键 Cmd/Ctrl+Shift+T 切换，ESC 退出
  - 进入打字机模式自动全屏，退出时恢复原窗口状态
  - 自动跟随系统深色/浅色主题
  - 光标使用主题色 (蓝色)
  - 禅意排版设计：
    - 中英文混排字体栈 (思源黑体 / Noto Sans SC / 苹方)
    - 等宽字体用于代码 (SF Mono / JetBrains Mono)
    - 行高 2.0，字间距 0.02em，最大宽度 680px
    - 温暖的背景色 (深色 #1c1c1e / 浅色 #faf9f7)
  - 架构上完全与 Editor 隔离，独立的 Tiptap 编辑器实例
- 修复打字机模式焦点渐变效果
  - 问题：ProseMirror 会在渲染时重置 DOM 元素的 style 属性，导致 JS 设置的样式被覆盖
  - 解决方案：使用 TipTap 官方 Focus 扩展 (@tiptap/extension-focus)
  - 通过 CSS :has() 和相邻兄弟选择器实现渐变透明度效果
  - 焦点段落完全清晰，相邻段落依次变淡 (1 → 0.7 → 0.5 → 0.35 → 0.2)

### 2025-12-17
- 统一打字机模式和普通模式的底栏样式
  - 打字机模式底栏：将 emoji 图标改为 SVG 线性图标 + 文字标签
  - 普通模式编辑器工具栏：从顶部移到底部，改为 SVG 线性图标 + 文字标签
  - 统一样式规范：32px 高度按钮、12px 文字、半透明背景 + 模糊效果
  - 添加 i18n 翻译支持（打字机模式、专注模式）
- 实现打字机模式光标位置同步
  - 进入打字机模式时保持原光标位置并滚动到视口中央
  - 退出打字机模式时恢复光标位置
  - 使用 block ID + 偏移量定位，支持绝对位置备用方案
  - 添加 `isInitializing` 标记防止初始化阶段滚动监听器干扰光标
- 重构：提取共享的光标工具函数到 `utils/cursor.ts`
  - `CursorInfo` 接口统一定义
  - `getCursorInfo(editor)` 获取光标信息
  - `setCursorByBlockId(editor, cursorInfo)` 设置光标位置
  - 消除 Editor.tsx、TypewriterMode.tsx、App.tsx 中的重复代码
- 实现中英文混合字数统计
  - 新增 `utils/wordCount.ts` 工具函数
  - 中文按字符计数，英文按单词计数，数字按连续数字计数
  - 支持选中文本字数显示（格式：选中/总字数 字）
  - 编辑器和打字机模式统一支持

### 2025-12-18
- 窗口拖动区域优化
  - Sidebar 使用 `pt-[50px]` 为 macOS 红绿灯留出空间
  - NoteList、TrashList 的列表区域添加 `no-drag` 支持正常滚动
  - Editor 保持原有的 100px 顶部 padding
  - 优化 Windows 环境下的 titleBarOverlay 样式
    - 添加 IPC handler 支持动态更新 titleBarOverlay 颜色
    - ThemeProvider 主题切换时自动同步 titleBarOverlay 背景色和文字色
- 双向链接样式重设计（禅风格）
  - 普通笔记链接：细实线下划线，40% 透明度主题色
  - 标题链接：虚线下划线 (dashed)，暗示锚点定位
  - Block 链接：点状下划线 (dotted)，暗示段落引用
  - hover 时统一变为主题色，保持阅读流畅性
- 中栏笔记列表分隔线优化
  - 分隔线与内容区域平齐（不再延伸到边缘）
  - 选中笔记时隐藏上下分隔线
- 实现回收站功能（软删除）
  - 数据库添加 `deleted_at` 字段，支持软删除
  - 删除笔记移入回收站，30 天后自动清理
  - 侧边栏底部添加回收站入口（设置按钮上方）
  - 回收站列表支持右键菜单：恢复、永久删除
  - 清空回收站功能（二次确认）
  - 多语言支持：中文/英文
- 中栏顶部显示当前 tab 名称
  - NoteList 组件添加 `title` prop
  - 根据当前选中的 Smart View 或笔记本显示对应名称
  - 过长名称自动截断，hover 显示完整名称
- UI 字号统一改为 rem 单位，支持字号设置响应
- 隐藏 Recent 和 Daily Notes 智能视图（暂不使用）
- 空白笔记自动清理
  - 切换笔记/视图/笔记本时，自动删除无标题无内容的笔记
- 代码质量优化
  - 为异步操作添加 try-catch 错误处理
  - 修复 handleRestoreNote 闭包陈旧问题
  - 删除笔记本时同步更新回收站状态
  - 修复 createDemoNotes() 缺少 is_pinned 字段
  - 提取重复代码到共享 utils
    - `utils/dateFormat.ts`: formatRelativeDate 统一日期格式化
    - `utils/notePreview.ts`: getPreview 统一内容预览提取
  - 修复 NotebookModal ESC 键与 emoji picker 冲突（先关闭 picker 再关闭 modal）
