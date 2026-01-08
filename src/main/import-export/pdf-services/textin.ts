/**
 * TextIn PDF 解析服务实现
 * 合合信息文档解析服务，支持表格、公式、图片提取
 */

import type { PdfParseService, PdfParseResult, PdfParseProgress, PdfImage } from './types'
import { t } from '../../i18n'

/** TextIn API 返回结果类型 */
interface TextInResponse {
  code: number
  message?: string
  msg?: string
  result?: {
    markdown?: string
    pages?: Array<{
      structured?: Array<{
        type?: string
        base64str?: string
        id?: string
      }>
    }>
  }
}

export const textinService: PdfParseService = {
  id: 'textin',
  name: 'TextIn',
  description: 'TextIn document parsing service, supports tables, formulas, and images',
  configUrl: 'https://www.textin.com/market/detail/pdf_to_markdown',

  configFields: [
    {
      key: 'appId',
      label: 'App ID',
      type: 'text',
      placeholder: 'Enter TextIn App ID',
      required: true,
    },
    {
      key: 'secretCode',
      label: 'Secret Code',
      type: 'password',
      placeholder: 'Enter TextIn Secret Code',
      required: true,
    },
  ],

  async parse(
    pdfBuffer: Buffer,
    config: Record<string, string>,
    onProgress?: (progress: PdfParseProgress) => void,
    abortSignal?: AbortSignal
  ): Promise<PdfParseResult> {
    const { appId, secretCode } = config

    if (!appId || !secretCode) {
      return {
        success: false,
        markdown: '',
        images: [],
        error: 'Missing App ID or Secret Code',
      }
    }

    // Check if already aborted
    if (abortSignal?.aborted) {
      return {
        success: false,
        markdown: '',
        images: [],
        error: 'Import cancelled',
      }
    }

    onProgress?.({ stage: 'uploading', message: t().pdf.uploading })

    // 2 分钟超时（PDF 解析可能较慢）
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 120000)

    // Listen to external abort signal
    const onAbort = () => controller.abort()
    abortSignal?.addEventListener('abort', onAbort)

    let response: Response
    try {
      response = await fetch(
        'https://api.textin.com/ai/service/v1/pdf_to_markdown?get_image=objects&image_output_type=base64str',
        {
          method: 'POST',
          headers: {
            'x-ti-app-id': appId,
            'x-ti-secret-code': secretCode,
            'Content-Type': 'application/pdf',
          },
          body: new Uint8Array(pdfBuffer),
          signal: controller.signal,
        }
      )
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // Distinguish between user cancellation and timeout
        const isCancelled = abortSignal?.aborted
        return {
          success: false,
          markdown: '',
          images: [],
          error: isCancelled ? 'Import cancelled' : 'TextIn API request timeout (120s)',
        }
      }
      return {
        success: false,
        markdown: '',
        images: [],
        error: error instanceof Error ? error.message : 'Network request failed',
      }
    } finally {
      clearTimeout(timeoutId)
      abortSignal?.removeEventListener('abort', onAbort)
    }

    if (!response.ok) {
      return {
        success: false,
        markdown: '',
        images: [],
        error: `TextIn API HTTP error: ${response.status} ${response.statusText}`,
      }
    }

    onProgress?.({ stage: 'parsing', message: t().pdf.parsing })

    const result = (await response.json()) as TextInResponse

    if (result.code !== 200) {
      return {
        success: false,
        markdown: '',
        images: [],
        error: result.message || result.msg || 'Parsing failed',
      }
    }

    onProgress?.({ stage: 'extracting', message: t().pdf.extracting })

    const images = extractImages(result)

    onProgress?.({ stage: 'converting', message: t().pdf.converting })

    return {
      success: true,
      markdown: result.result?.markdown || '',
      images,
    }
  },
}

/**
 * 从 base64 字符串检测图片格式
 */
function detectImageFormat(base64: string): string {
  if (base64.startsWith('/9j/')) return 'jpg'
  if (base64.startsWith('iVBOR')) return 'png'
  if (base64.startsWith('R0lGOD')) return 'gif'
  if (base64.startsWith('UklGR')) return 'webp'
  return 'png' // default fallback
}

/**
 * 从 TextIn 返回结果中提取图片
 */
function extractImages(result: TextInResponse): PdfImage[] {
  const images: PdfImage[] = []
  const pages = result.result?.pages || []

  let index = 0
  for (const page of pages) {
    for (const item of page.structured || []) {
      if (item.type === 'image' && item.base64str) {
        images.push({
          id: `img-${index++}`,
          base64: item.base64str,
          ext: detectImageFormat(item.base64str),
        })
      }
    }
  }

  return images
}
