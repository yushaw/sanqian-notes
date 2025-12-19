# 附件管理系统设计文档

## 一、概述

实现本地文件附件管理，支持图片、音视频、文档等文件的插入、存储和展示。

### 设计原则

1. **本地优先** - 所有附件复制到应用数据目录，不依赖原始位置
2. **相对路径** - 数据库存储相对路径，便于迁移和备份
3. **分类展示** - 不同文件类型有不同的渲染方式
4. **跨平台** - 使用 Electron 标准 API，兼容 macOS/Windows/Linux

---

## 二、存储方案

### 目录结构

```
{app.getPath('userData')}/
├── notes.db                    # 笔记数据库
└── attachments/                # 附件目录
    └── {YYYY}/
        └── {MM}/
            ├── {timestamp}-{hash}.png
            ├── {timestamp}-{hash}.mp4
            └── ...
```

### 路径规则

| 项目 | 说明 |
|-----|-----|
| 基础路径 | `app.getPath('userData')/attachments/` |
| 子目录 | 按年月分组 `2024/12/` |
| 文件名 | `{timestamp}-{hash}.{ext}` 避免冲突 |
| 数据库存储 | 相对路径 `attachments/2024/12/xxx.png` |
| 渲染时拼接 | `file://{userData}/{relativePath}` |

### 平台路径

| 平台 | userData 路径 |
|-----|--------------|
| macOS | `~/Library/Application Support/sanqian-notes/` |
| Windows | `C:\Users\{user}\AppData\Roaming\sanqian-notes\` |
| Linux | `~/.config/sanqian-notes/` |

---

## 三、文件类型处理

### 类型分类

```typescript
type FileCategory = 'image' | 'video' | 'audio' | 'document' | 'other'

const FILE_CATEGORIES: Record<string, FileCategory> = {
  // 图片
  'png': 'image', 'jpg': 'image', 'jpeg': 'image',
  'gif': 'image', 'webp': 'image', 'svg': 'image', 'bmp': 'image',

  // 视频
  'mp4': 'video', 'webm': 'video', 'mov': 'video',
  'avi': 'video', 'mkv': 'video',

  // 音频
  'mp3': 'audio', 'wav': 'audio', 'ogg': 'audio',
  'flac': 'audio', 'm4a': 'audio', 'aac': 'audio',

  // 文档
  'pdf': 'document', 'doc': 'document', 'docx': 'document',
  'xls': 'document', 'xlsx': 'document',
  'ppt': 'document', 'pptx': 'document',
  'txt': 'document', 'md': 'document',

  // 其他 - 默认
}
```

### 展示方式

| 类型 | Tiptap Node | 展示方式 | 交互 |
|-----|-------------|---------|-----|
| image | `resizableImage` | 直接显示，可调整大小 | 点击选中，拖拽调整 |
| video | `video` | HTML5 `<video>` 播放器 | 播放/暂停/全屏 |
| audio | `audio` | 音频播放条 | 播放/暂停/进度条 |
| document | `fileAttachment` | 文件卡片（图标+名称+大小） | 点击用系统程序打开 |
| other | `fileAttachment` | 文件卡片（图标+名称+大小） | 点击用系统程序打开 |

### 文件图标映射

```typescript
const FILE_ICONS: Record<string, string> = {
  // 图片
  image: '🖼️',
  // 视频
  video: '🎬',
  // 音频
  audio: '🎵',
  // 文档
  pdf: '📄',
  doc: '📝', docx: '📝',
  xls: '📊', xlsx: '📊',
  ppt: '📽️', pptx: '📽️',
  txt: '📃', md: '📃',
  // 压缩包
  zip: '📦', rar: '📦', '7z': '📦',
  // 代码
  js: '💻', ts: '💻', py: '💻',
  // 默认
  default: '📎',
}
```

---

## 四、主进程 API

### IPC 接口

```typescript
// src/main/index.ts - 新增 attachment 模块

interface AttachmentAPI {
  // 保存附件（从文件路径复制）
  save: (filePath: string) => Promise<{
    relativePath: string  // 相对路径，存入数据库
    fullPath: string      // 完整路径，用于渲染
    name: string          // 原始文件名
    size: number          // 文件大小
    type: string          // MIME type
  }>

  // 保存附件（从 Buffer，用于粘贴图片）
  saveBuffer: (buffer: Buffer, ext: string) => Promise<{
    relativePath: string
    fullPath: string
    name: string
    size: number
    type: string
  }>

  // 获取完整路径
  getFullPath: (relativePath: string) => string

  // 用系统程序打开文件
  openFile: (relativePath: string) => Promise<void>

  // 删除附件
  delete: (relativePath: string) => Promise<boolean>

  // 选择文件对话框
  selectFile: (options?: {
    filters?: { name: string; extensions: string[] }[]
    multiple?: boolean
  }) => Promise<string[] | null>

  // 选择图片对话框
  selectImage: () => Promise<string[] | null>
}

// 暴露给渲染进程
window.electron.attachment = AttachmentAPI
```

### 实现要点

```typescript
// 生成文件名
function generateFileName(originalName: string): string {
  const ext = path.extname(originalName)
  const hash = crypto.randomBytes(4).toString('hex')
  const timestamp = Date.now()
  return `${timestamp}-${hash}${ext}`
}

// 获取存储目录
function getAttachmentDir(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const dir = path.join(
    app.getPath('userData'),
    'attachments',
    String(year),
    month
  )
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

// 保存文件
async function saveAttachment(filePath: string) {
  const originalName = path.basename(filePath)
  const newName = generateFileName(originalName)
  const dir = getAttachmentDir()
  const fullPath = path.join(dir, newName)

  await fs.promises.copyFile(filePath, fullPath)

  const stats = await fs.promises.stat(fullPath)
  const relativePath = path.relative(app.getPath('userData'), fullPath)

  return {
    relativePath,
    fullPath,
    name: originalName,
    size: stats.size,
    type: mime.getType(originalName) || 'application/octet-stream',
  }
}
```

---

## 五、编辑器集成

### 1. 粘贴图片

```typescript
// Editor.tsx - 处理粘贴事件

editor.on('paste', async (event) => {
  const { clipboardData } = event

  // 检查是否有图片
  const items = clipboardData?.items
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      event.preventDefault()

      // 获取图片数据
      const blob = item.getAsFile()
      const buffer = await blob.arrayBuffer()

      // 保存到附件目录
      const result = await window.electron.attachment.saveBuffer(
        Buffer.from(buffer),
        item.type.split('/')[1] // png, jpg, etc
      )

      // 插入图片节点
      editor.chain().focus().setResizableImage({
        src: `file://${result.fullPath}`,
        alt: result.name,
      }).run()

      return
    }
  }
})
```

### 2. 拖拽文件

```typescript
// Editor.tsx - 处理拖拽事件

editor.on('drop', async (event) => {
  const { dataTransfer } = event
  const files = dataTransfer?.files

  if (!files?.length) return

  event.preventDefault()

  for (const file of files) {
    // 保存文件
    const result = await window.electron.attachment.save(file.path)
    const category = getFileCategory(file.name)

    // 根据类型插入不同节点
    switch (category) {
      case 'image':
        editor.chain().focus().setResizableImage({
          src: `file://${result.fullPath}`,
          alt: result.name,
        }).run()
        break

      case 'video':
        editor.chain().focus().setVideo({
          src: `file://${result.fullPath}`,
        }).run()
        break

      case 'audio':
        editor.chain().focus().setAudio({
          src: `file://${result.fullPath}`,
          title: result.name,
        }).run()
        break

      default:
        editor.chain().focus().setFileAttachment({
          src: result.relativePath, // 文件附件存相对路径
          name: result.name,
          size: result.size,
          type: result.type,
        }).run()
    }
  }
})
```

### 3. 斜杠命令

```typescript
// SlashCommand.ts - 新增命令

{
  id: 'image',
  icon: '🖼️',
  keywords: ['image', 'picture', 'photo', 'tupian'],
  command: async (editor) => {
    const files = await window.electron.attachment.selectImage()
    if (!files?.length) return

    for (const filePath of files) {
      const result = await window.electron.attachment.save(filePath)
      editor.chain().focus().setResizableImage({
        src: `file://${result.fullPath}`,
        alt: result.name,
      }).run()
    }
  },
},
{
  id: 'file',
  icon: '📎',
  keywords: ['file', 'attachment', 'fujian', 'wenjian'],
  command: async (editor) => {
    const files = await window.electron.attachment.selectFile()
    if (!files?.length) return

    for (const filePath of files) {
      const result = await window.electron.attachment.save(filePath)
      const category = getFileCategory(filePath)

      // 根据类型插入对应节点...
    }
  },
},
```

---

## 六、扩展修改

### ResizableImage

```typescript
// 当前：src 可以是 URL 或 base64
// 修改：支持 file:// 协议

// ResizableImageView.tsx
const imgSrc = useMemo(() => {
  const src = attrs.src
  // 如果是相对路径，转换为 file:// URL
  if (src.startsWith('attachments/')) {
    return `file://${window.electron.attachment.getFullPath(src)}`
  }
  return src
}, [attrs.src])
```

### FileAttachment

```typescript
// FileAttachmentView.tsx

const handleClick = async () => {
  if (attrs.src) {
    // 使用 Electron API 打开文件
    await window.electron.attachment.openFile(attrs.src)
  }
}
```

---

## 七、Electron 配置

### webPreferences

```typescript
// main/index.ts

const mainWindow = new BrowserWindow({
  webPreferences: {
    // 允许加载本地文件
    webSecurity: false, // 或使用自定义协议更安全
    // ...
  },
})
```

### 自定义协议（更安全的方案）

```typescript
// main/index.ts

import { protocol } from 'electron'

// 注册 attachment:// 协议
protocol.registerFileProtocol('attachment', (request, callback) => {
  const relativePath = request.url.replace('attachment://', '')
  const fullPath = path.join(app.getPath('userData'), relativePath)
  callback({ path: fullPath })
})

// 使用时
// <img src="attachment://attachments/2024/12/xxx.png" />
```

---

## 八、实现步骤

### Phase 1: 基础设施
- [ ] 主进程 attachment API 实现
- [ ] preload.ts 暴露 API
- [ ] 类型定义

### Phase 2: 图片支持
- [ ] 粘贴图片自动保存
- [ ] 拖拽图片插入
- [ ] 斜杠命令 /image
- [ ] 修改 ResizableImage 支持本地路径

### Phase 3: 其他文件
- [ ] 拖拽任意文件插入
- [ ] 斜杠命令 /file
- [ ] 修改 FileAttachment 用系统程序打开
- [ ] 修改 Video/Audio 支持本地路径

### Phase 4: 优化
- [ ] 附件管理器（查看所有附件）
- [ ] 清理未使用附件
- [ ] 导出时打包附件

---

## 九、技术调研结论

### Tiptap 文件处理

**官方扩展**：[@tiptap/extension-file-handler](https://tiptap.dev/docs/editor/extensions/functionality/filehandler)

```typescript
import { FileHandler } from '@tiptap/extension-file-handler'

FileHandler.configure({
  // 粘贴文件时触发
  onPaste: (editor, files, htmlContent) => {
    // files: File[]
    // htmlContent: string | undefined (从网页复制时包含 HTML)
  },

  // 拖拽文件时触发
  onDrop: (editor, files, pos) => {
    // files: File[]
    // pos: number (拖放位置)
  },

  // 限制文件类型（可选）
  allowedMimeTypes: ['image/*', 'video/*', 'audio/*'],
})
```

**关键点**：
- FileHandler 只负责捕获事件，不自动插入内容
- 需要自己实现保存逻辑和插入对应 Node
- 从网页复制图片时，`htmlContent` 包含 `<img>` 标签，需要用 `transformPastedHTML` 过滤避免重复

### 现有扩展支持情况

| 扩展 | 文件 | src 格式 | 需改动 |
|-----|-----|---------|-------|
| `ResizableImage` | 有 | URL/base64 | 支持 `attachment://` 协议 |
| `Video` | 有 | URL | 支持 `attachment://` 协议 |
| `Audio` | 有 | URL | 支持 `attachment://` 协议 |
| `FileAttachment` | 有 | URL | 改用 `shell.openPath` 打开 |

### Electron 本地文件加载

**方案对比**：

| 方案 | 安全性 | 实现复杂度 | 推荐 |
|-----|-------|----------|-----|
| `webSecurity: false` | ❌ 低 | 简单 | 不推荐 |
| `protocol.handle()` | ✅ 高 | 中等 | **推荐** |

**推荐实现**（使用 `protocol.handle`）：

```typescript
// main/index.ts
import { app, protocol, net } from 'electron'
import { pathToFileURL } from 'url'
import path from 'path'

// 在 app.whenReady() 之前注册
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'attachment',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true, // 支持视频/音频流式播放
    },
  },
])

app.whenReady().then(() => {
  // 注册协议处理器
  protocol.handle('attachment', (request) => {
    const relativePath = decodeURIComponent(
      request.url.replace('attachment://', '')
    )

    // 安全检查：防止目录遍历
    const fullPath = path.join(app.getPath('userData'), relativePath)
    const userData = app.getPath('userData')
    if (!fullPath.startsWith(userData)) {
      return new Response('Forbidden', { status: 403 })
    }

    // 返回文件
    return net.fetch(pathToFileURL(fullPath).toString())
  })
})
```

**使用方式**：
```html
<img src="attachment://attachments/2024/12/xxx.png" />
<video src="attachment://attachments/2024/12/xxx.mp4" />
<audio src="attachment://attachments/2024/12/xxx.mp3" />
```

### 从网页复制图片的处理

从网页复制图片会同时包含图片数据和 HTML，需要避免重复插入：

```typescript
// Editor.tsx
const editor = useEditor({
  // ...
  editorProps: {
    // 过滤粘贴的 HTML 中的图片标签（我们用 onPaste 处理图片）
    transformPastedHTML(html) {
      return html.replace(/<img[^>]*>/g, '')
    },
  },
})
```

---

## 十、注意事项

1. **路径拼接** - 统一使用 `path.join()`，不硬编码分隔符
2. **错误处理** - 文件操作需要 try-catch，处理权限问题
3. **大文件** - 考虑添加进度提示（可选，后续优化）
4. **安全性** - 使用 `protocol.handle()` 自定义协议，比 `webSecurity: false` 更安全
5. **清理机制** - 删除笔记时可选择是否删除附件（需要引用计数或孤立附件检测）
6. **流媒体** - 注册协议时需要 `stream: true` 才能支持视频/音频边下载边播放

---

## 十一、参考资料

- [Tiptap FileHandler Extension](https://tiptap.dev/docs/editor/extensions/functionality/filehandler)
- [Tiptap Image Extension](https://tiptap.dev/docs/editor/extensions/nodes/image)
- [Electron protocol.handle()](https://www.electronjs.org/docs/latest/api/protocol)
- [Adding drag and drop image uploads to Tiptap](https://www.codemzy.com/blog/tiptap-drag-drop-image)
- [How to upload or disable pasting images in Tiptap](https://www.codemzy.com/blog/tiptap-pasting-images)
