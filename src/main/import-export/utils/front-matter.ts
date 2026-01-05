/**
 * YAML Front Matter 解析工具
 * 轻量级实现，不依赖外部库
 */

export interface FrontMatterResult {
  /** 解析出的 front matter 数据 */
  data: Record<string, unknown>
  /** 去除 front matter 后的内容 */
  content: string
  /** 是否有 front matter */
  hasFrontMatter: boolean
}

/**
 * 解析 YAML Front Matter
 */
export function parseFrontMatter(input: string): FrontMatterResult {
  const trimmed = input.trimStart()

  // 检查是否以 --- 开头
  if (!trimmed.startsWith('---')) {
    return {
      data: {},
      content: input,
      hasFrontMatter: false,
    }
  }

  // 查找结束的 ---
  const endMatch = trimmed.substring(3).match(/\n---(\r?\n|$)/)
  if (!endMatch || endMatch.index === undefined) {
    return {
      data: {},
      content: input,
      hasFrontMatter: false,
    }
  }

  const yamlContent = trimmed.substring(3, 3 + endMatch.index).trim()
  const contentStart = 3 + endMatch.index + endMatch[0].length
  const content = trimmed.substring(contentStart)

  // 解析 YAML
  const data = parseSimpleYaml(yamlContent)

  return {
    data,
    content,
    hasFrontMatter: true,
  }
}

/**
 * 简单 YAML 解析器
 * 支持：字符串、数字、布尔、数组、嵌套对象
 */
function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const lines = yaml.split('\n')

  let currentKey: string | null = null
  let currentArray: unknown[] | null = null
  let currentIndent = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmedLine = line.trim()

    // 跳过空行和注释
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue
    }

    // 计算缩进
    const indent = line.length - line.trimStart().length

    // 检查是否是数组项
    if (trimmedLine.startsWith('- ')) {
      if (currentKey && currentArray !== null) {
        const value = parseYamlValue(trimmedLine.substring(2).trim())
        currentArray.push(value)
      }
      continue
    }

    // 检查是否是 key: value 格式
    const colonIndex = trimmedLine.indexOf(':')
    if (colonIndex === -1) continue

    const key = trimmedLine.substring(0, colonIndex).trim()
    const valueStr = trimmedLine.substring(colonIndex + 1).trim()

    // 结束之前的数组
    if (currentArray !== null && indent <= currentIndent) {
      if (currentKey) {
        result[currentKey] = currentArray
      }
      currentArray = null
      currentKey = null
    }

    if (valueStr === '') {
      // 可能是数组或嵌套对象的开始
      currentKey = key
      currentArray = []
      currentIndent = indent
    } else {
      // 普通键值对
      result[key] = parseYamlValue(valueStr)
    }
  }

  // 处理最后的数组
  if (currentKey && currentArray !== null) {
    result[currentKey] = currentArray
  }

  return result
}

/** 最大递归深度限制 */
const MAX_YAML_DEPTH = 10

/**
 * 解析 YAML 值
 * @param value 要解析的值
 * @param depth 当前递归深度（内部使用）
 */
function parseYamlValue(value: string, depth: number = 0): unknown {
  // 防止过深递归导致栈溢出
  if (depth > MAX_YAML_DEPTH) {
    return value // 达到深度限制，返回原始字符串
  }

  // 移除引号
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }

  // 内联数组 [item1, item2, item3]
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim()
    if (!inner) return []
    return inner.split(',').map((item) => {
      const trimmed = item.trim()
      // 递归解析每个数组项，深度 +1
      return parseYamlValue(trimmed, depth + 1)
    })
  }

  // 布尔值
  if (value === 'true') return true
  if (value === 'false') return false

  // null
  if (value === 'null' || value === '~') return null

  // 数字
  if (/^-?\d+$/.test(value)) {
    return parseInt(value, 10)
  }
  if (/^-?\d+\.\d+$/.test(value)) {
    return parseFloat(value)
  }

  // 日期 (ISO 格式)
  if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/.test(value)) {
    return value // 保持为字符串，让调用者决定如何处理
  }

  // 默认返回字符串
  return value
}

/**
 * 从 front matter 提取标签
 */
export function extractTagsFromFrontMatter(data: Record<string, unknown>): string[] {
  const tags = data.tags || data.tag || data.keywords || data.categories
  if (!tags) return []

  if (Array.isArray(tags)) {
    return tags
      .filter((t) => typeof t === 'string')
      .map((t) => String(t).trim())
      .filter((t) => t.length > 0) // 过滤空字符串
  }

  if (typeof tags === 'string') {
    // 可能是逗号分隔
    return tags.split(',').map((t) => t.trim()).filter(Boolean)
  }

  return []
}

/**
 * 从 front matter 提取创建时间
 */
export function extractCreatedDate(data: Record<string, unknown>): Date | undefined {
  const created = data.created || data.date || data.created_at || data.createdAt
  if (!created) return undefined

  const date = new Date(String(created))
  return isNaN(date.getTime()) ? undefined : date
}

/**
 * 从 front matter 提取更新时间
 */
export function extractUpdatedDate(data: Record<string, unknown>): Date | undefined {
  const updated = data.updated || data.modified || data.updated_at || data.updatedAt
  if (!updated) return undefined

  const date = new Date(String(updated))
  return isNaN(date.getTime()) ? undefined : date
}
