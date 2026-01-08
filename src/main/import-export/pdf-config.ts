/**
 * PDF 服务配置存储
 * 使用 SQLite 存储，API 密钥加密
 */

import { getAppSetting, setAppSetting } from '../database'
import { encrypt, decrypt } from '../embedding/encryption'

/** PDF 服务配置 */
export interface PdfServiceConfigs {
  /** 当前激活的服务 ID */
  activeService: string
  /** 各服务的配置 (serviceId -> config) */
  services: Record<string, Record<string, string>>
  /** 是否记住配置 */
  rememberConfig: boolean
}

const CONFIG_KEY = 'pdf_service_config'

const DEFAULT_CONFIG: PdfServiceConfigs = {
  activeService: 'textin',
  services: {},
  rememberConfig: true,
}

/**
 * 获取 PDF 服务配置
 */
export function getPdfConfig(): PdfServiceConfigs {
  const value = getAppSetting(CONFIG_KEY)
  if (!value) return DEFAULT_CONFIG

  try {
    const decrypted = decrypt(value)
    return JSON.parse(decrypted) as PdfServiceConfigs
  } catch {
    return DEFAULT_CONFIG
  }
}

/**
 * 保存 PDF 服务配置
 */
export function setPdfConfig(config: PdfServiceConfigs): void {
  const encrypted = encrypt(JSON.stringify(config))
  setAppSetting(CONFIG_KEY, encrypted)
}

/**
 * 获取指定服务的配置
 */
export function getServiceConfig(serviceId: string): Record<string, string> | null {
  const config = getPdfConfig()
  return config.services[serviceId] || null
}

/**
 * 设置指定服务的配置
 */
export function setServiceConfig(serviceId: string, serviceConfig: Record<string, string>): void {
  const config = getPdfConfig()
  config.services[serviceId] = serviceConfig
  setPdfConfig(config)
}

/**
 * 设置当前激活的服务
 */
export function setActiveService(serviceId: string): void {
  const config = getPdfConfig()
  config.activeService = serviceId
  setPdfConfig(config)
}

/**
 * 清除指定服务的配置
 */
export function clearServiceConfig(serviceId: string): void {
  const config = getPdfConfig()
  delete config.services[serviceId]
  setPdfConfig(config)
}
