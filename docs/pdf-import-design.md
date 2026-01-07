# PDF 导入功能设计文档

## 概述

通过第三方 API 服务将 PDF 文件（如 arXiv 论文）转换为 Markdown 并导入为笔记，支持图片提取和公式识别。

设计上支持多种解析服务，目前实现 TextIn，后续可扩展 Mathpix、Marker API 等。

---

## 现有代码分析

### 1. 现有导入系统结构

```
src/main/import-export/
├── base-importer.ts          # 导入器基类
├── types.ts                  # 类型定义 (ImportOptions, ParsedNote, etc.)
├── index.ts                  # 导入注册表 + executeImport/previewImport
├── importers/
│   ├── markdown-importer.ts
│   ├── notion-importer.ts
│   ├── obsidian-importer.ts
│   └── pdf-importer.ts       # ✅ 已存在，但未注册！
└── utils/
    ├── attachment-handler.ts
    └── link-resolver.ts
```

### 2. 现有 pdf-importer.ts 状态

**已实现**:
- 继承 `BaseImporter`
- `canHandle()`, `parse()` 方法
- `callTextInApi()` TextIn API 调用
- `extractImages()` 图片提取

**缺失**:
- 未在 `index.ts` 中注册
- 配置持久化（目前只有内存中的 `setConfig()`）
- 进度回调
- 可扩展的服务抽象

### 3. 现有 UI 结构

```
src/renderer/src/components/
├── DataSettings.tsx          # 导入入口（显示 Markdown/Notion/Obsidian 卡片）
├── ImportDialog.tsx          # 通用导入对话框（不适合 PDF）
└── ExportDialog.tsx
```

**ImportDialog 特点**:
- 固定类型 `'markdown' | 'notion' | 'obsidian'`
- 流程：选择文件 → 预览 → 配置选项 → 导入
- 无 API 密钥配置能力

### 4. IPC/Preload 结构

```typescript
// src/preload/index.ts
importExport: {
  getImporters: () => ...,
  detect: (sourcePath) => ...,
  preview: (options) => ...,
  execute: (options) => ...,
  selectSource: (importerId) => ...,
}
```

---

## 侵入点分析

PDF 导入需要修改的文件：

| 文件 | 修改类型 | 说明 |
|------|----------|------|
| `src/main/import-export/index.ts` | 修改 | 注册 PdfImporter |
| `src/main/import-export/importers/pdf-importer.ts` | 修改 | 增强：服务抽象、进度、配置持久化 |
| `src/main/import-export/pdf-config.ts` | **新增** | 配置存储（SQLite 加密） |
| `src/main/import-export/pdf-services/` | **新增** | 可扩展的服务层 |
| `src/main/index.ts` | 修改 | 添加 PDF 配置 IPC |
| `src/preload/index.ts` | 修改 | 暴露 PDF 配置 API |
| `src/renderer/src/components/DataSettings.tsx` | 修改 | 添加 PDF 导入卡片 |
| `src/renderer/src/components/PdfImportDialog.tsx` | **新增** | 独立 PDF 导入对话框 |
| `src/renderer/src/i18n/zh.ts` | 修改 | 添加 PDF 相关文案 |
| `src/renderer/src/i18n/en.ts` | 修改 | 添加 PDF 相关文案 |

---

## 用户流程

```
DataSettings 页面
    │
    ├─ 点击「PDF」卡片
    │       ↓
    │   ┌─────────────────────────────────────────────────────┐
    │   │  PdfImportDialog                                    │
    │   │                                                     │
    │   │  ┌─────────────────────────────────────────────┐   │
    │   │  │ 解析服务配置（始终可见）                      │   │
    │   │  │ - 服务选择（目前只有 TextIn）                 │   │
    │   │  │ - App ID / Secret Code 输入框               │   │
    │   │  │ - [获取密钥] 链接                            │   │
    │   │  │ - [x] 记住配置                               │   │
    │   │  └─────────────────────────────────────────────┘   │
    │   │                                                     │
    │   │  ┌─────────────────────────────────────────────┐   │
    │   │  │ 导入设置                                     │   │
    │   │  │ - [选择文件] PDF 文件路径                    │   │
    │   │  │ - 目标笔记本 (可选下拉框)                    │   │
    │   │  │ - [x] 导入图片作为附件                       │   │
    │   │  └─────────────────────────────────────────────┘   │
    │   │                                                     │
    │   │  [取消]                            [开始导入]       │
    │   └─────────────────────────────────────────────────────┘
    │
    └─ 导入中显示进度 → 完成显示结果
```

---

## 技术设计

### 1. PDF 服务抽象层（新增）

```typescript
// src/main/import-export/pdf-services/types.ts

/** PDF 解析服务接口 */
export interface PdfParseService {
  /** 服务唯一标识 */
  id: string
  /** 显示名称 */
  name: string
  /** 服务描述 */
  description: string
  /** 获取 API 密钥的链接 */
  configUrl: string
  /** 配置字段定义（动态渲染表单） */
  configFields: PdfServiceConfigField[]
  /** 解析 PDF */
  parse(
    pdfBuffer: Buffer,
    config: Record<string, string>,
    onProgress?: (progress: PdfParseProgress) => void
  ): Promise<PdfParseResult>
}

export interface PdfServiceConfigField {
  key: string
  label: string
  type: 'text' | 'password'
  placeholder?: string
  required: boolean
}

export interface PdfParseProgress {
  stage: 'uploading' | 'parsing' | 'extracting' | 'converting'
  message: string
  /** 0-100 百分比，可选 */
  percent?: number
}

export interface PdfParseResult {
  success: boolean
  markdown: string
  images: PdfImage[]
  error?: string
}

export interface PdfImage {
  id: string
  base64: string
  ext: string
}
```

### 2. TextIn 服务实现

```typescript
// src/main/import-export/pdf-services/textin.ts

import type { PdfParseService, PdfParseResult, PdfParseProgress, PdfImage } from './types'

export const textinService: PdfParseService = {
  id: 'textin',
  name: 'TextIn',
  description: '合合信息文档解析服务，支持表格、公式、图片提取',
  configUrl: 'https://www.textin.com/market/detail/pdf_to_markdown',

  configFields: [
    {
      key: 'appId',
      label: 'App ID',
      type: 'text',
      placeholder: '输入 TextIn App ID',
      required: true,
    },
    {
      key: 'secretCode',
      label: 'Secret Code',
      type: 'password',
      placeholder: '输入 TextIn Secret Code',
      required: true,
    },
  ],

  async parse(pdfBuffer, config, onProgress): Promise<PdfParseResult> {
    const { appId, secretCode } = config

    onProgress?.({ stage: 'uploading', message: '正在上传 PDF...' })

    const response = await fetch(
      'https://api.textin.com/ai/service/v1/pdf_to_markdown?get_image=objects&image_output_type=base64str',
      {
        method: 'POST',
        headers: {
          'x-ti-app-id': appId,
          'x-ti-secret-code': secretCode,
          'Content-Type': 'application/pdf',
        },
        body: pdfBuffer,
      }
    )

    onProgress?.({ stage: 'parsing', message: '正在解析文档...' })

    const result = await response.json()

    if (result.code !== 200) {
      return {
        success: false,
        markdown: '',
        images: [],
        error: result.message || result.msg || '解析失败',
      }
    }

    onProgress?.({ stage: 'extracting', message: '正在提取图片...' })

    const images = this.extractImages(result)

    onProgress?.({ stage: 'converting', message: '正在转换格式...' })

    return {
      success: true,
      markdown: result.result?.markdown || '',
      images,
    }
  },

  extractImages(result: unknown): PdfImage[] {
    const images: PdfImage[] = []
    const pages = (result as { result?: { pages?: Array<{ structured?: Array<{ type?: string; base64str?: string }> }> } }).result?.pages || []

    let index = 0
    for (const page of pages) {
      for (const item of page.structured || []) {
        if (item.type === 'image' && item.base64str) {
          images.push({
            id: `img-${index++}`,
            base64: item.base64str,
            ext: 'png',
          })
        }
      }
    }

    return images
  },
}
```

### 3. 服务注册表

```typescript
// src/main/import-export/pdf-services/index.ts

import type { PdfParseService } from './types'
import { textinService } from './textin'

const services = new Map<string, PdfParseService>([
  ['textin', textinService],
  // 后续添加:
  // ['mathpix', mathpixService],
])

export function getPdfServices(): PdfParseService[] {
  return Array.from(services.values())
}

export function getPdfService(id: string): PdfParseService | undefined {
  return services.get(id)
}

export function getDefaultPdfService(): PdfParseService {
  return textinService
}

export * from './types'
```

### 4. 配置存储（加密）

```typescript
// src/main/import-export/pdf-config.ts

import { getDb } from '../database'
import { encrypt, decrypt } from '../embedding/encryption'

export interface PdfServiceConfigs {
  activeService: string
  services: Record<string, Record<string, string>>
  rememberConfig: boolean
}

const CONFIG_KEY = 'pdf_service_config'

const DEFAULT_CONFIG: PdfServiceConfigs = {
  activeService: 'textin',
  services: {},
  rememberConfig: true,
}

export function getPdfConfig(): PdfServiceConfigs {
  const db = getDb()
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(CONFIG_KEY) as
    | { value: string }
    | undefined

  if (!row) return DEFAULT_CONFIG

  try {
    return JSON.parse(decrypt(row.value))
  } catch {
    return DEFAULT_CONFIG
  }
}

export function setPdfConfig(config: PdfServiceConfigs): void {
  const db = getDb()
  const encrypted = encrypt(JSON.stringify(config))

  db.prepare(
    `INSERT OR REPLACE INTO app_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))`
  ).run(CONFIG_KEY, encrypted)
}

export function getServiceConfig(serviceId: string): Record<string, string> | null {
  const config = getPdfConfig()
  return config.services[serviceId] || null
}

export function setServiceConfig(serviceId: string, serviceConfig: Record<string, string>): void {
  const config = getPdfConfig()
  config.services[serviceId] = serviceConfig
  setPdfConfig(config)
}
```

### 5. 修改 pdf-importer.ts

保持继承 `BaseImporter`，但内部使用服务层：

```typescript
// src/main/import-export/importers/pdf-importer.ts (修改)

import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'fs'
import { join, basename, extname } from 'path'
import { app } from 'electron'
import { BaseImporter, MAX_FILE_SIZE } from '../base-importer'
import { getPdfService, getDefaultPdfService } from '../pdf-services'
import { getServiceConfig } from '../pdf-config'
import type { ImporterInfo, ImportOptions, ParsedNote } from '../types'
import type { PdfParseProgress } from '../pdf-services/types'

export class PdfImporter extends BaseImporter {
  readonly info: ImporterInfo = {
    id: 'pdf',
    name: 'PDF',
    description: 'Import PDF files via TextIn API',
    extensions: ['pdf'],
    supportsFolder: false,
    fileFilters: [{ name: 'PDF files', extensions: ['pdf'] }],
  }

  /** 运行时配置（由 IPC 调用前设置） */
  private runtimeConfig: {
    serviceId: string
    serviceConfig: Record<string, string>
    onProgress?: (progress: PdfParseProgress) => void
  } | null = null

  /** 设置运行时配置（导入前调用） */
  setRuntimeConfig(config: typeof this.runtimeConfig): void {
    this.runtimeConfig = config
  }

  async canHandle(sourcePath: string): Promise<boolean> {
    if (!existsSync(sourcePath)) return false
    const stat = statSync(sourcePath)
    if (!stat.isFile()) return false
    return extname(sourcePath).toLowerCase() === '.pdf'
  }

  async parse(options: ImportOptions): Promise<ParsedNote[]> {
    const { sourcePath } = options

    // 获取配置
    let serviceId: string
    let serviceConfig: Record<string, string>
    let onProgress: ((p: PdfParseProgress) => void) | undefined

    if (this.runtimeConfig) {
      serviceId = this.runtimeConfig.serviceId
      serviceConfig = this.runtimeConfig.serviceConfig
      onProgress = this.runtimeConfig.onProgress
    } else {
      // 回退到存储的配置
      serviceId = 'textin'
      const stored = getServiceConfig(serviceId)
      if (!stored) {
        throw new Error('TextIn API not configured. Please set App ID and Secret Code first.')
      }
      serviceConfig = stored
    }

    // 获取服务
    const service = getPdfService(serviceId) || getDefaultPdfService()

    // 验证文件
    if (!existsSync(sourcePath)) {
      throw new Error(`Source path does not exist: ${sourcePath}`)
    }

    const stat = statSync(sourcePath)
    if (stat.size > MAX_FILE_SIZE) {
      throw new Error(
        `File too large: ${sourcePath} (${Math.round(stat.size / 1024 / 1024)}MB > ${MAX_FILE_SIZE / 1024 / 1024}MB limit)`
      )
    }

    // 读取并解析 PDF
    const pdfBuffer = readFileSync(sourcePath)
    const result = await service.parse(pdfBuffer, serviceConfig, onProgress)

    if (!result.success) {
      throw new Error(result.error || 'PDF parsing failed')
    }

    // 提取标题
    const fileName = basename(sourcePath)
    const title = this.extractTitle(sourcePath, result.markdown)

    // 处理图片
    const attachments = await this.processImages(result.images, options)

    // 将图片追加到 markdown 末尾
    let markdown = result.markdown
    if (attachments.length > 0) {
      const imageRefs = attachments.map((a, i) => `![image-${i}](${a.originalRef.match(/\(([^)]+)\)/)?.[1] || ''})`).join('\n\n')
      markdown += '\n\n---\n\n## 图片\n\n' + imageRefs
    }

    // 转换为 TipTap JSON
    const tiptapContent = this.markdownToContent(markdown)

    return [
      {
        sourcePath,
        title,
        content: tiptapContent,
        notebookName: undefined, // PDF 单文件，不设置笔记本
        tags: [],
        createdAt: stat.birthtime,
        updatedAt: stat.mtime,
        attachments,
        links: [],
      },
    ]
  }

  private async processImages(
    images: Array<{ id: string; base64: string; ext: string }>,
    options: ImportOptions
  ): Promise<ParsedNote['attachments']> {
    if (!options.importAttachments || images.length === 0) {
      return []
    }

    const attachments: ParsedNote['attachments'] = []
    const tempDir = join(app.getPath('temp'), 'sanqian-pdf-import', Date.now().toString())
    mkdirSync(tempDir, { recursive: true })

    for (const img of images) {
      const imageName = `${img.id}.${img.ext}`
      const imagePath = join(tempDir, imageName)

      writeFileSync(imagePath, Buffer.from(img.base64, 'base64'))

      attachments.push({
        originalRef: `![${img.id}](${imageName})`,
        sourcePath: imagePath,
      })
    }

    return attachments
  }

  cleanup(): void {
    this.runtimeConfig = null
  }
}

export const pdfImporter = new PdfImporter()
```

### 6. 注册 PDF 导入器

```typescript
// src/main/import-export/index.ts (修改)

import { PdfImporter } from './importers/pdf-importer'
// ... 其他 imports

// 添加到导入器列表
const importers: BaseImporter[] = [
  new NotionImporter(),
  new ObsidianImporter(),
  new PdfImporter(),      // 新增
  new MarkdownImporter(), // Markdown 放最后作为通用导入器
]
```

### 7. IPC Handlers

```typescript
// src/main/index.ts (新增部分)

import { getPdfConfig, setPdfConfig, getServiceConfig, setServiceConfig } from './import-export/pdf-config'
import { getPdfServices } from './import-export/pdf-services'
import { pdfImporter } from './import-export/importers/pdf-importer'

// ========== PDF 配置 IPC ==========

ipcMain.handle('pdf:getServices', () => {
  return getPdfServices().map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    configUrl: s.configUrl,
    configFields: s.configFields,
  }))
})

ipcMain.handle('pdf:getConfig', () => getPdfConfig())

ipcMain.handle('pdf:setConfig', (_, config) => setPdfConfig(config))

ipcMain.handle('pdf:getServiceConfig', (_, serviceId: string) => getServiceConfig(serviceId))

ipcMain.handle('pdf:setServiceConfig', (_, serviceId: string, config: Record<string, string>) => {
  setServiceConfig(serviceId, config)
})

// ========== PDF 导入 IPC ==========

ipcMain.handle('pdf:import', async (event, options: {
  pdfPath: string
  serviceId: string
  serviceConfig: Record<string, string>
  targetNotebookId?: string
  importImages: boolean
}) => {
  const win = BrowserWindow.fromWebContents(event.sender)

  // 设置进度回调
  const onProgress = (progress: unknown) => {
    win?.webContents.send('pdf:importProgress', progress)
  }

  // 设置运行时配置
  pdfImporter.setRuntimeConfig({
    serviceId: options.serviceId,
    serviceConfig: options.serviceConfig,
    onProgress,
  })

  try {
    // 复用现有导入流程
    const result = await executeImport({
      sourcePath: options.pdfPath,
      folderStrategy: 'single-notebook',
      targetNotebookId: options.targetNotebookId,
      tagStrategy: 'keep-nested',
      conflictStrategy: 'rename',
      importAttachments: options.importImages,
      parseFrontMatter: false,
    })

    return {
      success: result.success,
      noteId: result.importedNotes[0]?.id,
      noteTitle: result.importedNotes[0]?.title,
      imageCount: result.stats.importedAttachments,
      error: result.errors[0]?.error,
    }
  } finally {
    pdfImporter.cleanup()
  }
})
```

### 8. Preload API

```typescript
// src/preload/index.ts (新增部分)

pdfImport: {
  // 服务配置
  getServices: () => ipcRenderer.invoke('pdf:getServices'),
  getConfig: () => ipcRenderer.invoke('pdf:getConfig'),
  setConfig: (config: unknown) => ipcRenderer.invoke('pdf:setConfig', config),
  getServiceConfig: (serviceId: string) => ipcRenderer.invoke('pdf:getServiceConfig', serviceId),
  setServiceConfig: (serviceId: string, config: Record<string, string>) =>
    ipcRenderer.invoke('pdf:setServiceConfig', serviceId, config),

  // 导入
  import: (options: unknown) => ipcRenderer.invoke('pdf:import', options),

  // 进度监听
  onProgress: (callback: (progress: unknown) => void) => {
    const handler = (_: Electron.IpcRendererEvent, progress: unknown) => callback(progress)
    ipcRenderer.on('pdf:importProgress', handler)
    return () => ipcRenderer.removeListener('pdf:importProgress', handler)
  },
},
```

### 9. DataSettings 修改

```typescript
// src/renderer/src/components/DataSettings.tsx (修改)

type ImporterType = 'markdown' | 'notion' | 'obsidian' | 'pdf'  // 添加 pdf

// ... 现有代码 ...

// 在导入卡片列表中添加 PDF
<ImportSourceCard
  icon={<PdfIcon />}
  title={t.importExport.pdfImport}
  description={t.importExport.pdfImportDesc}
  onClick={() => handleImportClick('pdf')}
/>

// 在 render 中处理 pdf 类型
{showImportDialog && selectedImporter && (
  selectedImporter === 'pdf' ? (
    <PdfImportDialog onClose={handleCloseImport} />
  ) : (
    <ImportDialog importerType={selectedImporter} onClose={handleCloseImport} />
  )
)}
```

### 10. PdfImportDialog 组件

见原设计文档中的 UI 组件设计，保持不变。

### 11. i18n 文案

```typescript
// src/renderer/src/i18n/zh.ts 新增
pdfImport: {
  title: '导入 PDF',
  parseService: '解析服务',
  getApiKey: '获取密钥',
  rememberConfig: '记住配置',
  selectFile: 'PDF 文件',
  noFileSelected: '未选择文件',
  browse: '选择文件',
  targetNotebook: '目标笔记本',
  noNotebook: '不指定',
  importImages: '导入图片作为附件',
  startImport: '开始导入',
  parsing: '正在解析...',
  parsingHint: '解析时间取决于文件大小，通常需要 10-30 秒',
  importSuccess: '导入成功！',
  importFailed: '导入失败',
  noteTitle: '笔记',
  imageCount: '{n} 张图片',
  viewNote: '查看笔记',
  close: '完成',
  progress: {
    uploading: '正在上传 PDF...',
    parsing: '正在解析文档...',
    extracting: '正在提取图片...',
    converting: '正在转换格式...',
  },
  error: {
    noConfig: '请先配置 API 密钥',
    noFile: '请选择 PDF 文件',
  },
},

// importExport 新增
pdfImport: 'PDF 文档',
pdfImportDesc: '通过 TextIn API 解析 PDF 文档（需要 API 密钥）',
```

---

## 文件修改清单

### 新增文件

| 文件路径 | 说明 |
|----------|------|
| `src/main/import-export/pdf-services/types.ts` | 服务抽象类型 |
| `src/main/import-export/pdf-services/textin.ts` | TextIn 实现 |
| `src/main/import-export/pdf-services/index.ts` | 服务注册表 |
| `src/main/import-export/pdf-config.ts` | 配置存储 |
| `src/renderer/src/components/PdfImportDialog.tsx` | PDF 导入对话框 |

### 修改文件

| 文件路径 | 修改内容 |
|----------|----------|
| `src/main/import-export/importers/pdf-importer.ts` | 使用服务层重构 |
| `src/main/import-export/index.ts` | 注册 PdfImporter |
| `src/main/index.ts` | 添加 PDF IPC handlers (~30 行) |
| `src/preload/index.ts` | 添加 pdfImport API (~20 行) |
| `src/renderer/src/components/DataSettings.tsx` | 添加 PDF 卡片 (~15 行) |
| `src/renderer/src/i18n/zh.ts` | 添加 PDF 文案 |
| `src/renderer/src/i18n/en.ts` | 添加 PDF 文案 |

---

## 实现顺序

| 步骤 | 任务 | 估计代码量 |
|------|------|-----------|
| 1 | 创建 `pdf-services/` 目录和类型 | ~80 行 |
| 2 | 实现 TextIn 服务 | ~80 行 |
| 3 | 创建服务注册表 | ~30 行 |
| 4 | 创建配置存储 | ~60 行 |
| 5 | 修改 pdf-importer.ts | ~50 行改动 |
| 6 | 注册 PDF 导入器 | ~3 行 |
| 7 | 添加 IPC handlers | ~50 行 |
| 8 | 添加 Preload API | ~20 行 |
| 9 | 创建 PdfImportDialog | ~300 行 |
| 10 | 修改 DataSettings | ~20 行 |
| 11 | 添加 i18n 文案 | ~60 行 |

---

## 后续扩展

添加新的解析服务只需：

1. 在 `pdf-services/` 下创建新文件（如 `mathpix.ts`）
2. 实现 `PdfParseService` 接口
3. 在 `pdf-services/index.ts` 中注册

```typescript
// pdf-services/mathpix.ts
export const mathpixService: PdfParseService = {
  id: 'mathpix',
  name: 'Mathpix',
  description: '专业公式识别服务',
  configUrl: 'https://mathpix.com/',
  configFields: [
    { key: 'appId', label: 'App ID', type: 'text', required: true },
    { key: 'appKey', label: 'App Key', type: 'password', required: true },
  ],
  async parse(pdfBuffer, config, onProgress) {
    // Mathpix API 调用
  },
}
```

UI 会自动根据 `configFields` 渲染配置表单，无需额外修改。
