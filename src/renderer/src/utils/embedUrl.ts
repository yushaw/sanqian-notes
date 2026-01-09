/**
 * Embed URL 转换配置
 *
 * 用于将普通分享链接自动转换为 iframe embed 格式
 * 配置列表可根据需要扩展
 */

export interface EmbedUrlConfig {
  /** 平台名称 */
  name: string
  /** 区域：国内/国际 */
  region: 'cn' | 'global'
  /** URL 匹配正则 */
  pattern: RegExp
  /** 转换函数，返回 embed URL */
  transform: (match: RegExpMatchArray, originalUrl: string) => string
  /** 跳过转换的条件（如果 URL 已经是 embed 格式） */
  skipIf?: (url: string) => boolean
}

/**
 * Embed URL 转换配置列表
 *
 * 添加新平台时，只需在此列表中添加配置项
 */
export const embedUrlConfigs: EmbedUrlConfig[] = [
  // ==================== 国际平台 ====================

  // Figma: /file/ 或 /design/ 或 /board/ 等转为 embed
  {
    name: 'Figma',
    region: 'global',
    pattern: /^https:\/\/(www\.)?figma\.com\/(file|design|board|proto)\//,
    transform: (_match, url) => `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(url)}`,
    skipIf: (url) => url.includes('/embed'),
  },

  // YouTube: 普通链接转 embed
  {
    name: 'YouTube',
    region: 'global',
    pattern: /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/,
    transform: (match) => `https://www.youtube.com/embed/${match[1]}`,
  },

  // Vimeo: 普通链接转 embed
  {
    name: 'Vimeo',
    region: 'global',
    pattern: /vimeo\.com\/(\d+)/,
    transform: (match) => `https://player.vimeo.com/video/${match[1]}`,
    skipIf: (url) => url.includes('player.vimeo.com'),
  },

  // Loom: 普通链接转 embed
  {
    name: 'Loom',
    region: 'global',
    pattern: /loom\.com\/share\/([a-zA-Z0-9]+)/,
    transform: (match) => `https://www.loom.com/embed/${match[1]}`,
  },

  // CodePen: 普通链接转 embed
  {
    name: 'CodePen',
    region: 'global',
    pattern: /codepen\.io\/([^/]+)\/pen\/([a-zA-Z0-9]+)/,
    transform: (match) => `https://codepen.io/${match[1]}/embed/${match[2]}`,
    skipIf: (url) => url.includes('/embed/'),
  },

  // CodeSandbox: 普通链接转 embed
  {
    name: 'CodeSandbox',
    region: 'global',
    pattern: /codesandbox\.io\/s\/([a-zA-Z0-9-]+)/,
    transform: (match) => `https://codesandbox.io/embed/${match[1]}`,
    skipIf: (url) => url.includes('/embed/'),
  },

  // Spotify: track/album/playlist/episode 转 embed
  {
    name: 'Spotify',
    region: 'global',
    pattern: /open\.spotify\.com\/(track|album|playlist|episode)\/([a-zA-Z0-9]+)/,
    transform: (match) => `https://open.spotify.com/embed/${match[1]}/${match[2]}`,
    skipIf: (url) => url.includes('/embed/'),
  },

  // Google Docs: 添加 preview
  {
    name: 'Google Docs',
    region: 'global',
    pattern: /docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/,
    transform: (match) => `https://docs.google.com/document/d/${match[1]}/preview`,
    skipIf: (url) => url.includes('/preview') || url.includes('/embed') || url.includes('embedded=true'),
  },

  // Google Sheets: 添加 preview
  {
    name: 'Google Sheets',
    region: 'global',
    pattern: /docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/,
    transform: (match) => `https://docs.google.com/spreadsheets/d/${match[1]}/preview`,
    skipIf: (url) => url.includes('/preview') || url.includes('/embed') || url.includes('embedded=true'),
  },

  // Google Slides: 添加 embed
  {
    name: 'Google Slides',
    region: 'global',
    pattern: /docs\.google\.com\/presentation\/d\/([a-zA-Z0-9_-]+)/,
    transform: (match) => `https://docs.google.com/presentation/d/${match[1]}/embed`,
    skipIf: (url) => url.includes('/preview') || url.includes('/embed') || url.includes('embedded=true'),
  },

  // Miro: 普通链接转 embed
  {
    name: 'Miro',
    region: 'global',
    pattern: /miro\.com\/app\/board\/([a-zA-Z0-9_=-]+)/,
    transform: (match) => `https://miro.com/app/embed/${match[1]}`,
    skipIf: (url) => url.includes('/embed/'),
  },

  // Airtable: 普通链接转 embed (只匹配 app/shr/tbl/vew 开头的 ID)
  {
    name: 'Airtable',
    region: 'global',
    pattern: /airtable\.com\/(?:app|shr|tbl|vew)([a-zA-Z0-9]+)/,
    transform: (_match, url) => {
      // Extract the full ID including prefix
      const idMatch = url.match(/airtable\.com\/((?:app|shr|tbl|vew)[a-zA-Z0-9]+)/)
      return idMatch ? `https://airtable.com/embed/${idMatch[1]}` : url
    },
    skipIf: (url) => url.includes('/embed/'),
  },

  // ==================== 中国境内平台 ====================

  // 哔哩哔哩 (Bilibili): BV号视频转 embed
  {
    name: '哔哩哔哩',
    region: 'cn',
    pattern: /bilibili\.com\/video\/(BV[a-zA-Z0-9]+)/,
    transform: (match) => `https://player.bilibili.com/player.html?bvid=${match[1]}`,
  },

  // 哔哩哔哩: av号视频转 embed (旧格式)
  {
    name: '哔哩哔哩 (AV)',
    region: 'cn',
    pattern: /bilibili\.com\/video\/av(\d+)/i,
    transform: (match) => `https://player.bilibili.com/player.html?aid=${match[1]}`,
  },

  // 优酷 (Youku): 普通链接转 embed
  {
    name: '优酷',
    region: 'cn',
    pattern: /v\.youku\.com\/v_show\/id_([a-zA-Z0-9=]+)/,
    transform: (match) => `https://player.youku.com/embed/${match[1]}`,
    skipIf: (url) => url.includes('player.youku.com'),
  },

  // 腾讯视频 (Tencent Video): 普通链接转 embed
  {
    name: '腾讯视频',
    region: 'cn',
    pattern: /v\.qq\.com\/x\/(?:cover|page)\/[a-zA-Z0-9]+\/([a-zA-Z0-9]+)/,
    transform: (match) => `https://v.qq.com/txp/iframe/player.html?vid=${match[1]}`,
    skipIf: (url) => url.includes('iframe/player'),
  },

  // 腾讯视频: 直接视频页面
  {
    name: '腾讯视频 (直链)',
    region: 'cn',
    pattern: /v\.qq\.com\/x\/page\/([a-zA-Z0-9]+)\.html/,
    transform: (match) => `https://v.qq.com/txp/iframe/player.html?vid=${match[1]}`,
    skipIf: (url) => url.includes('iframe/player'),
  },

  // 网易云音乐: 单曲外链
  {
    name: '网易云音乐 (单曲)',
    region: 'cn',
    pattern: /music\.163\.com\/#\/song\?id=(\d+)/,
    transform: (match) => `https://music.163.com/outchain/player?type=2&id=${match[1]}&auto=0&height=66`,
    skipIf: (url) => url.includes('outchain/player'),
  },

  // 网易云音乐: 歌单外链
  {
    name: '网易云音乐 (歌单)',
    region: 'cn',
    pattern: /music\.163\.com\/#\/playlist\?id=(\d+)/,
    transform: (match) => `https://music.163.com/outchain/player?type=0&id=${match[1]}&auto=0&height=430`,
    skipIf: (url) => url.includes('outchain/player'),
  },

  // 网易云音乐: 新版链接格式
  {
    name: '网易云音乐 (新版)',
    region: 'cn',
    pattern: /music\.163\.com\/song\?id=(\d+)/,
    transform: (match) => `https://music.163.com/outchain/player?type=2&id=${match[1]}&auto=0&height=66`,
    skipIf: (url) => url.includes('outchain/player'),
  },
]

/**
 * 将普通 URL 转换为 embed 格式
 *
 * @param url - 原始 URL
 * @returns 转换后的 embed URL，如果不匹配任何规则则返回原 URL
 */
export function convertToEmbedUrl(url: string): string {
  for (const config of embedUrlConfigs) {
    const match = url.match(config.pattern)
    if (match) {
      // 检查是否应该跳过转换
      if (config.skipIf && config.skipIf(url)) {
        return url
      }
      return config.transform(match, url)
    }
  }
  return url
}

/**
 * 检测 URL 匹配的平台名称
 *
 * @param url - 要检测的 URL
 * @returns 平台名称，如果不匹配则返回 null
 */
export function detectPlatform(url: string): string | null {
  for (const config of embedUrlConfigs) {
    if (config.pattern.test(url)) {
      return config.name
    }
  }
  return null
}

/**
 * 获取所有支持的平台列表
 *
 * @param region - 可选，筛选特定区域的平台
 * @returns 平台名称数组
 */
export function getSupportedPlatforms(region?: 'cn' | 'global'): string[] {
  const configs = region
    ? embedUrlConfigs.filter(c => c.region === region)
    : embedUrlConfigs

  // 去重
  return [...new Set(configs.map(c => c.name))]
}
