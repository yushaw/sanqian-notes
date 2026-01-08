/**
 * PDF 解析服务注册表
 */

import type { PdfParseService, PdfServiceInfo } from './types'
import { textinService } from './textin'
import { t } from '../../i18n'

const services = new Map<string, PdfParseService>([
  ['textin', textinService],
  // 后续添加:
  // ['mathpix', mathpixService],
])

/** 获取所有可用服务 */
export function getPdfServices(): PdfParseService[] {
  return Array.from(services.values())
}

/** 获取所有服务信息（用于传递给渲染进程，应用 i18n） */
export function getPdfServiceInfos(): PdfServiceInfo[] {
  const translations = t()
  return getPdfServices().map((s) => ({
    id: s.id,
    name: s.name,
    description: s.id === 'textin' ? translations.pdf.textinDescription : s.description,
    configUrl: s.configUrl,
    configFields: s.configFields.map((field) => ({
      ...field,
      placeholder: getFieldPlaceholder(s.id, field.key, field.placeholder || '', translations),
    })),
  }))
}

/** 获取字段的翻译占位符 */
function getFieldPlaceholder(
  serviceId: string,
  fieldKey: string,
  fallback: string,
  translations: ReturnType<typeof t>
): string {
  if (serviceId === 'textin') {
    if (fieldKey === 'appId') return translations.pdf.textinAppIdPlaceholder
    if (fieldKey === 'secretCode') return translations.pdf.textinSecretCodePlaceholder
  }
  return fallback
}

/** 根据 ID 获取服务 */
export function getPdfService(id: string): PdfParseService | undefined {
  return services.get(id)
}

/** 获取默认服务 */
export function getDefaultPdfService(): PdfParseService {
  return textinService
}

export * from './types'
