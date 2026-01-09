/**
 * Embed URL Conversion Tests
 */
import { describe, it, expect } from 'vitest'
import { convertToEmbedUrl, detectPlatform, getSupportedPlatforms } from '../embedUrl'

describe('convertToEmbedUrl', () => {
  describe('国际平台', () => {
    describe('YouTube', () => {
      it('转换标准 watch URL', () => {
        const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
        expect(convertToEmbedUrl(url)).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ')
      })

      it('转换短链接 youtu.be', () => {
        const url = 'https://youtu.be/dQw4w9WgXcQ'
        expect(convertToEmbedUrl(url)).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ')
      })

      it('处理带时间戳的链接', () => {
        const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=60s'
        expect(convertToEmbedUrl(url)).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ')
      })
    })

    describe('Vimeo', () => {
      it('转换标准链接', () => {
        const url = 'https://vimeo.com/123456789'
        expect(convertToEmbedUrl(url)).toBe('https://player.vimeo.com/video/123456789')
      })

      it('跳过已经是 embed 的链接', () => {
        const url = 'https://player.vimeo.com/video/123456789'
        expect(convertToEmbedUrl(url)).toBe(url)
      })
    })

    describe('Figma', () => {
      it('转换 file 链接', () => {
        const url = 'https://www.figma.com/file/abc123/MyDesign'
        const result = convertToEmbedUrl(url)
        expect(result).toContain('figma.com/embed')
        expect(result).toContain(encodeURIComponent(url))
      })

      it('转换 design 链接', () => {
        const url = 'https://figma.com/design/abc123/MyDesign'
        const result = convertToEmbedUrl(url)
        expect(result).toContain('figma.com/embed')
      })

      it('跳过已经是 embed 的链接', () => {
        const url = 'https://www.figma.com/embed?embed_host=share&url=xxx'
        expect(convertToEmbedUrl(url)).toBe(url)
      })
    })

    describe('Loom', () => {
      it('转换分享链接', () => {
        const url = 'https://www.loom.com/share/abc123def456'
        expect(convertToEmbedUrl(url)).toBe('https://www.loom.com/embed/abc123def456')
      })
    })

    describe('CodePen', () => {
      it('转换 pen 链接', () => {
        const url = 'https://codepen.io/username/pen/abcXYZ'
        expect(convertToEmbedUrl(url)).toBe('https://codepen.io/username/embed/abcXYZ')
      })

      it('跳过已经是 embed 的链接', () => {
        const url = 'https://codepen.io/username/embed/abcXYZ'
        expect(convertToEmbedUrl(url)).toBe(url)
      })
    })

    describe('CodeSandbox', () => {
      it('转换沙箱链接', () => {
        const url = 'https://codesandbox.io/s/my-sandbox-abc123'
        expect(convertToEmbedUrl(url)).toBe('https://codesandbox.io/embed/my-sandbox-abc123')
      })

      it('跳过已经是 embed 的链接', () => {
        const url = 'https://codesandbox.io/embed/my-sandbox-abc123'
        expect(convertToEmbedUrl(url)).toBe(url)
      })
    })

    describe('Spotify', () => {
      it('转换 track 链接', () => {
        const url = 'https://open.spotify.com/track/abc123'
        expect(convertToEmbedUrl(url)).toBe('https://open.spotify.com/embed/track/abc123')
      })

      it('转换 album 链接', () => {
        const url = 'https://open.spotify.com/album/xyz789'
        expect(convertToEmbedUrl(url)).toBe('https://open.spotify.com/embed/album/xyz789')
      })

      it('转换 playlist 链接', () => {
        const url = 'https://open.spotify.com/playlist/abc123'
        expect(convertToEmbedUrl(url)).toBe('https://open.spotify.com/embed/playlist/abc123')
      })

      it('跳过已经是 embed 的链接', () => {
        const url = 'https://open.spotify.com/embed/track/abc123'
        expect(convertToEmbedUrl(url)).toBe(url)
      })
    })

    describe('Google Docs', () => {
      it('转换文档链接', () => {
        const url = 'https://docs.google.com/document/d/abc123xyz/edit'
        expect(convertToEmbedUrl(url)).toBe('https://docs.google.com/document/d/abc123xyz/preview')
      })

      it('跳过已经是 preview 的链接', () => {
        const url = 'https://docs.google.com/document/d/abc123xyz/preview'
        expect(convertToEmbedUrl(url)).toBe(url)
      })
    })

    describe('Google Sheets', () => {
      it('转换表格链接', () => {
        const url = 'https://docs.google.com/spreadsheets/d/abc123xyz/edit'
        expect(convertToEmbedUrl(url)).toBe('https://docs.google.com/spreadsheets/d/abc123xyz/preview')
      })
    })

    describe('Google Slides', () => {
      it('转换演示文稿链接', () => {
        const url = 'https://docs.google.com/presentation/d/abc123xyz/edit'
        expect(convertToEmbedUrl(url)).toBe('https://docs.google.com/presentation/d/abc123xyz/embed')
      })
    })

    describe('Miro', () => {
      it('转换画板链接', () => {
        const url = 'https://miro.com/app/board/abc123='
        expect(convertToEmbedUrl(url)).toBe('https://miro.com/app/embed/abc123=')
      })

      it('跳过已经是 embed 的链接', () => {
        const url = 'https://miro.com/app/embed/abc123='
        expect(convertToEmbedUrl(url)).toBe(url)
      })
    })

    describe('Airtable', () => {
      it('转换 app 链接', () => {
        const url = 'https://airtable.com/appABC123/tblXYZ'
        expect(convertToEmbedUrl(url)).toBe('https://airtable.com/embed/appABC123')
      })

      it('转换 shr (shared view) 链接', () => {
        const url = 'https://airtable.com/shrABC123'
        expect(convertToEmbedUrl(url)).toBe('https://airtable.com/embed/shrABC123')
      })

      it('不转换非 app/shr/tbl/vew 链接', () => {
        const url = 'https://airtable.com/careers'
        expect(convertToEmbedUrl(url)).toBe(url)
      })

      it('跳过已经是 embed 的链接', () => {
        const url = 'https://airtable.com/embed/appABC123'
        expect(convertToEmbedUrl(url)).toBe(url)
      })
    })
  })

  describe('中国平台', () => {
    describe('哔哩哔哩', () => {
      it('转换 BV 号链接', () => {
        const url = 'https://www.bilibili.com/video/BV1xx411c7mD'
        expect(convertToEmbedUrl(url)).toBe('https://player.bilibili.com/player.html?bvid=BV1xx411c7mD')
      })

      it('转换 av 号链接', () => {
        const url = 'https://www.bilibili.com/video/av170001'
        expect(convertToEmbedUrl(url)).toBe('https://player.bilibili.com/player.html?aid=170001')
      })
    })

    describe('优酷', () => {
      it('转换视频链接', () => {
        const url = 'https://v.youku.com/v_show/id_ABC123XYZ=='
        expect(convertToEmbedUrl(url)).toBe('https://player.youku.com/embed/ABC123XYZ==')
      })

      it('跳过已经是 embed 的链接', () => {
        const url = 'https://player.youku.com/embed/ABC123XYZ=='
        expect(convertToEmbedUrl(url)).toBe(url)
      })
    })

    describe('腾讯视频', () => {
      it('转换 cover 页面链接', () => {
        const url = 'https://v.qq.com/x/cover/abc123/xyz789'
        expect(convertToEmbedUrl(url)).toBe('https://v.qq.com/txp/iframe/player.html?vid=xyz789')
      })

      it('转换直链页面', () => {
        const url = 'https://v.qq.com/x/page/abc123.html'
        expect(convertToEmbedUrl(url)).toBe('https://v.qq.com/txp/iframe/player.html?vid=abc123')
      })

      it('跳过已经是 iframe 的链接', () => {
        const url = 'https://v.qq.com/txp/iframe/player.html?vid=abc123'
        expect(convertToEmbedUrl(url)).toBe(url)
      })
    })

    describe('网易云音乐', () => {
      it('转换单曲链接 (hash 格式)', () => {
        const url = 'https://music.163.com/#/song?id=12345'
        expect(convertToEmbedUrl(url)).toBe('https://music.163.com/outchain/player?type=2&id=12345&auto=0&height=66')
      })

      it('转换歌单链接', () => {
        const url = 'https://music.163.com/#/playlist?id=67890'
        expect(convertToEmbedUrl(url)).toBe('https://music.163.com/outchain/player?type=0&id=67890&auto=0&height=430')
      })

      it('转换新版单曲链接', () => {
        const url = 'https://music.163.com/song?id=12345'
        expect(convertToEmbedUrl(url)).toBe('https://music.163.com/outchain/player?type=2&id=12345&auto=0&height=66')
      })

      it('跳过已经是 outchain 的链接', () => {
        const url = 'https://music.163.com/outchain/player?type=2&id=12345'
        expect(convertToEmbedUrl(url)).toBe(url)
      })
    })
  })

  describe('边缘情况', () => {
    it('不匹配的 URL 返回原值', () => {
      const url = 'https://example.com/some/path'
      expect(convertToEmbedUrl(url)).toBe(url)
    })

    it('处理带查询参数的 URL', () => {
      const url = 'https://www.youtube.com/watch?v=abc123&list=PLxxx'
      expect(convertToEmbedUrl(url)).toBe('https://www.youtube.com/embed/abc123')
    })

    it('处理带 www 和不带 www 的域名', () => {
      const url1 = 'https://www.youtube.com/watch?v=abc123'
      const url2 = 'https://youtube.com/watch?v=abc123'
      expect(convertToEmbedUrl(url1)).toBe('https://www.youtube.com/embed/abc123')
      expect(convertToEmbedUrl(url2)).toBe('https://www.youtube.com/embed/abc123')
    })
  })
})

describe('detectPlatform', () => {
  it('检测 YouTube', () => {
    expect(detectPlatform('https://www.youtube.com/watch?v=abc123')).toBe('YouTube')
    expect(detectPlatform('https://youtu.be/abc123')).toBe('YouTube')
  })

  it('检测 Bilibili', () => {
    expect(detectPlatform('https://www.bilibili.com/video/BV1xx411c7mD')).toBe('哔哩哔哩')
  })

  it('检测 Figma', () => {
    expect(detectPlatform('https://www.figma.com/file/abc/design')).toBe('Figma')
  })

  it('未知平台返回 null', () => {
    expect(detectPlatform('https://example.com')).toBeNull()
  })
})

describe('getSupportedPlatforms', () => {
  it('返回所有平台', () => {
    const platforms = getSupportedPlatforms()
    expect(platforms).toContain('YouTube')
    expect(platforms).toContain('哔哩哔哩')
    expect(platforms).toContain('Figma')
  })

  it('按区域筛选 - 国际', () => {
    const platforms = getSupportedPlatforms('global')
    expect(platforms).toContain('YouTube')
    expect(platforms).toContain('Figma')
    expect(platforms).not.toContain('哔哩哔哩')
  })

  it('按区域筛选 - 中国', () => {
    const platforms = getSupportedPlatforms('cn')
    expect(platforms).toContain('哔哩哔哩')
    expect(platforms).toContain('优酷')
    expect(platforms).not.toContain('YouTube')
  })

  it('去除重复平台名', () => {
    const platforms = getSupportedPlatforms()
    const uniquePlatforms = [...new Set(platforms)]
    expect(platforms.length).toBe(uniquePlatforms.length)
  })
})
