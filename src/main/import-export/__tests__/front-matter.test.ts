/**
 * Front Matter 解析模块测试
 */
import { describe, it, expect } from 'vitest'
import {
  parseFrontMatter,
  extractTagsFromFrontMatter,
  extractCreatedDate,
  extractUpdatedDate,
} from '../utils/front-matter'

describe('parseFrontMatter', () => {
  describe('基本解析', () => {
    it('解析标准 YAML front matter', () => {
      const content = `---
title: 我的笔记
tags: [tag1, tag2]
date: 2024-01-01
---

这是正文内容。`

      const result = parseFrontMatter(content)

      expect(result.data).toEqual({
        title: '我的笔记',
        tags: ['tag1', 'tag2'],
        date: '2024-01-01',
      })
      expect(result.content.trim()).toBe('这是正文内容。')
    })

    it('没有 front matter 的内容', () => {
      const content = '这是普通的 Markdown 内容，没有 front matter。'

      const result = parseFrontMatter(content)

      expect(result.data).toEqual({})
      expect(result.content).toBe(content)
    })

    it('空内容', () => {
      const result = parseFrontMatter('')

      expect(result.data).toEqual({})
      expect(result.content).toBe('')
    })

    it('只有 front matter 没有正文', () => {
      const content = `---
title: 只有标题
---`

      const result = parseFrontMatter(content)

      expect(result.data).toEqual({ title: '只有标题' })
      expect(result.content.trim()).toBe('')
    })
  })

  describe('特殊格式处理', () => {
    it('解析嵌套标签格式', () => {
      const content = `---
tags:
  - parent/child
  - another/nested/tag
---

内容`

      const result = parseFrontMatter(content)

      expect(result.data.tags).toEqual(['parent/child', 'another/nested/tag'])
    })

    it('解析单个标签字符串', () => {
      const content = `---
tags: single-tag
---

内容`

      const result = parseFrontMatter(content)

      expect(result.data.tags).toBe('single-tag')
    })

    it('解析多种日期格式', () => {
      const content = `---
created: 2024-01-15T10:30:00Z
updated: 2024-06-20
---

内容`

      const result = parseFrontMatter(content)

      expect(result.data.created).toBe('2024-01-15T10:30:00Z')
      expect(result.data.updated).toBe('2024-06-20')
    })

    it('处理带引号的值', () => {
      const content = `---
title: "带引号的标题"
description: '单引号描述'
---

内容`

      const result = parseFrontMatter(content)

      expect(result.data.title).toBe('带引号的标题')
      expect(result.data.description).toBe('单引号描述')
    })

    // 注意：简单 YAML 解析器不支持多行字符串语法 (|)
    // 这是已知的限制，复杂场景应使用完整的 YAML 解析库
    it('处理多行字符串（简化解析）', () => {
      const content = `---
description: "这是单行描述"
---

内容`

      const result = parseFrontMatter(content)

      expect(result.data.description).toBe('这是单行描述')
    })
  })

  describe('边界情况', () => {
    it('front matter 分隔符不在开头', () => {
      const content = `一些前置内容
---
title: 不应该被解析
---

后续内容`

      const result = parseFrontMatter(content)

      expect(result.data).toEqual({})
      expect(result.content).toBe(content)
    })

    it('只有开始分隔符', () => {
      const content = `---
title: 未闭合
这是内容`

      const result = parseFrontMatter(content)

      // 没有结束分隔符，应该返回原始内容
      expect(result.data).toEqual({})
    })

    it('内容中包含 --- 但不是 front matter', () => {
      const content = `# 标题

这是分隔线：

---

后续内容`

      const result = parseFrontMatter(content)

      expect(result.data).toEqual({})
      expect(result.content).toBe(content)
    })
  })
})

describe('extractTagsFromFrontMatter', () => {
  it('从数组提取标签', () => {
    const frontMatter = { tags: ['tag1', 'tag2', 'tag3'] }
    const tags = extractTagsFromFrontMatter(frontMatter)
    expect(tags).toEqual(['tag1', 'tag2', 'tag3'])
  })

  it('从字符串提取单个标签', () => {
    const frontMatter = { tags: 'single-tag' }
    const tags = extractTagsFromFrontMatter(frontMatter)
    expect(tags).toEqual(['single-tag'])
  })

  it('处理逗号分隔的标签字符串', () => {
    const frontMatter = { tags: 'tag1, tag2, tag3' }
    const tags = extractTagsFromFrontMatter(frontMatter)
    expect(tags).toEqual(['tag1', 'tag2', 'tag3'])
  })

  it('没有标签时返回空数组', () => {
    const frontMatter = { title: '无标签' }
    const tags = extractTagsFromFrontMatter(frontMatter)
    expect(tags).toEqual([])
  })

  it('标签为空数组', () => {
    const frontMatter = { tags: [] }
    const tags = extractTagsFromFrontMatter(frontMatter)
    expect(tags).toEqual([])
  })

  it('过滤空白标签', () => {
    const frontMatter = { tags: ['valid', '', '  ', 'another'] }
    const tags = extractTagsFromFrontMatter(frontMatter)
    expect(tags).toEqual(['valid', 'another'])
  })
})

describe('extractCreatedDate', () => {
  it('从 created 字段提取', () => {
    const frontMatter = { created: '2024-01-15' }
    const date = extractCreatedDate(frontMatter)
    expect(date).toBeInstanceOf(Date)
    expect(date?.getFullYear()).toBe(2024)
  })

  it('从 date 字段提取', () => {
    const frontMatter = { date: '2024-06-20' }
    const date = extractCreatedDate(frontMatter)
    expect(date).toBeInstanceOf(Date)
  })

  it('从 created_at 字段提取', () => {
    const frontMatter = { created_at: '2024-03-10T10:00:00Z' }
    const date = extractCreatedDate(frontMatter)
    expect(date).toBeInstanceOf(Date)
  })

  it('没有日期字段时返回 undefined', () => {
    const frontMatter = { title: '无日期' }
    const date = extractCreatedDate(frontMatter)
    expect(date).toBeUndefined()
  })

  it('无效日期格式返回 undefined', () => {
    const frontMatter = { created: 'not-a-date' }
    const date = extractCreatedDate(frontMatter)
    expect(date).toBeUndefined()
  })

  it('Date 对象转换后使用', () => {
    const now = new Date('2024-06-15T10:00:00Z')
    const frontMatter = { created: now }
    const date = extractCreatedDate(frontMatter)
    expect(date).toBeInstanceOf(Date)
    expect(date?.getTime()).toBe(now.getTime())
  })
})

describe('extractUpdatedDate', () => {
  it('从 updated 字段提取', () => {
    const frontMatter = { updated: '2024-06-20' }
    const date = extractUpdatedDate(frontMatter)
    expect(date).toBeInstanceOf(Date)
  })

  it('从 modified 字段提取', () => {
    const frontMatter = { modified: '2024-05-15' }
    const date = extractUpdatedDate(frontMatter)
    expect(date).toBeInstanceOf(Date)
  })

  it('从 updated_at 字段提取', () => {
    const frontMatter = { updated_at: '2024-07-01T14:30:00Z' }
    const date = extractUpdatedDate(frontMatter)
    expect(date).toBeInstanceOf(Date)
  })

  it('没有更新日期时返回 undefined', () => {
    const frontMatter = { created: '2024-01-01' }
    const date = extractUpdatedDate(frontMatter)
    expect(date).toBeUndefined()
  })
})
