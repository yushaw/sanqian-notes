/**
 * PDF 解析服务抽象层类型定义
 * 支持多种 PDF 解析服务（TextIn、Mathpix 等）
 */

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
    onProgress?: (progress: PdfParseProgress) => void,
    abortSignal?: AbortSignal
  ): Promise<PdfParseResult>
}

/** 服务配置字段定义 */
export interface PdfServiceConfigField {
  key: string
  label: string
  type: 'text' | 'password'
  placeholder?: string
  required: boolean
}

/** 解析进度 */
export interface PdfParseProgress {
  stage: 'uploading' | 'parsing' | 'extracting' | 'converting'
  message: string
  /** 0-100 百分比，可选 */
  percent?: number
}

/** 解析结果 */
export interface PdfParseResult {
  success: boolean
  markdown: string
  images: PdfImage[]
  error?: string
}

/** 提取的图片 */
export interface PdfImage {
  id: string
  base64: string
  ext: string
}

/** 服务信息（传递给渲染进程的序列化版本） */
export interface PdfServiceInfo {
  id: string
  name: string
  description: string
  configUrl: string
  configFields: PdfServiceConfigField[]
}
