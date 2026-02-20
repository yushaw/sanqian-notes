/**
 * Dataview Query Executor Tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { executeDataviewQuery, formatFieldValue, isBuiltinField, getBuiltinFields } from '../dataviewExecutor'
import { parseDataviewQuery } from '../dataviewParser'
import type { Note, Notebook } from '../../../../shared/types'

// Mock data
const mockNotebooks: Notebook[] = [
  { id: 'nb1', name: '工作笔记本', order_index: 0, created_at: '2024-01-01' },
  { id: 'nb2', name: 'Personal', order_index: 1, created_at: '2024-01-01' },
]

const mockNotes: Note[] = [
  {
    id: 'note1',
    title: '项目计划',
    content: '{}',
    notebook_id: 'nb1',
    is_daily: false,
    daily_date: null,
    is_favorite: true,
    is_pinned: false,
    revision: 0,
    created_at: '2024-01-10T10:00:00Z',
    updated_at: '2024-01-15T14:00:00Z',
    deleted_at: null,
    ai_summary: '这是项目计划的摘要',
    tags: [{ id: 't1', name: 'project', source: 'user' }, { id: 't2', name: 'work', source: 'ai' }],
  },
  {
    id: 'note2',
    title: '会议记录',
    content: '{}',
    notebook_id: 'nb1',
    is_daily: false,
    daily_date: null,
    is_favorite: false,
    is_pinned: true,
    revision: 0,
    created_at: '2024-01-11T09:00:00Z',
    updated_at: '2024-01-12T16:00:00Z',
    deleted_at: null,
    ai_summary: null,
    tags: [{ id: 't1', name: 'project', source: 'user' }, { id: 't3', name: 'meeting', source: 'user' }],
  },
  {
    id: 'note3',
    title: 'Personal Notes',
    content: '{}',
    notebook_id: 'nb2',
    is_daily: false,
    daily_date: null,
    is_favorite: true,
    is_pinned: false,
    revision: 0,
    created_at: '2024-01-05T08:00:00Z',
    updated_at: '2024-01-20T12:00:00Z',
    deleted_at: null,
    ai_summary: 'Personal stuff',
    tags: [{ id: 't4', name: 'personal', source: 'user' }],
  },
  {
    id: 'note4',
    title: '已删除笔记',
    content: '{}',
    notebook_id: 'nb1',
    is_daily: false,
    daily_date: null,
    is_favorite: false,
    is_pinned: false,
    revision: 0,
    created_at: '2024-01-01T08:00:00Z',
    updated_at: '2024-01-02T08:00:00Z',
    deleted_at: '2024-01-03T08:00:00Z', // Deleted!
    ai_summary: null,
    tags: [],
  },
  {
    id: 'note5',
    title: '日记',
    content: '{}',
    notebook_id: null,
    is_daily: true,
    daily_date: '2024-01-15',
    is_favorite: false,
    is_pinned: false,
    revision: 0,
    created_at: '2024-01-15T00:00:00Z',
    updated_at: '2024-01-15T23:00:00Z',
    deleted_at: null,
    ai_summary: null,
    tags: [{ id: 't5', name: 'daily', source: 'user' }],
  },
]

// Setup mock
beforeEach(() => {
  // Mock window.electron with only the APIs we need for testing
  const mockElectron = {
    note: {
      getAll: vi.fn().mockResolvedValue(mockNotes),
    },
    notebook: {
      getAll: vi.fn().mockResolvedValue(mockNotebooks),
    },
  }

  global.window = {
    electron: mockElectron,
  } as unknown as Window & typeof globalThis
})

describe('executeDataviewQuery', () => {
  describe('基本查询', () => {
    it('LIST 查询返回所有未删除笔记', async () => {
      const parsed = parseDataviewQuery('LIST')
      expect(parsed.success).toBe(true)

      const result = await executeDataviewQuery(parsed.query!)
      expect(result.error).toBeUndefined()
      // Should not include deleted note
      expect(result.total).toBe(4)
      expect(result.rows.every(r => r.noteId !== 'note4')).toBe(true)
    })

    it('TABLE 查询返回指定字段', async () => {
      const parsed = parseDataviewQuery('TABLE tags, updated')
      expect(parsed.success).toBe(true)

      const result = await executeDataviewQuery(parsed.query!)
      expect(result.columns).toEqual(['tags', 'updated'])
      expect(result.rows[0]).toHaveProperty('tags')
      expect(result.rows[0]).toHaveProperty('updated')
    })
  })

  describe('FROM 过滤', () => {
    it('FROM #tag 过滤标签', async () => {
      const parsed = parseDataviewQuery('LIST FROM #project')
      const result = await executeDataviewQuery(parsed.query!)

      expect(result.total).toBe(2) // note1 and note2 have 'project' tag
      expect(result.rows.map(r => r.noteId)).toContain('note1')
      expect(result.rows.map(r => r.noteId)).toContain('note2')
    })

    it('FROM #tag 大小写不敏感', async () => {
      const parsed = parseDataviewQuery('LIST FROM #PROJECT')
      const result = await executeDataviewQuery(parsed.query!)

      expect(result.total).toBe(2)
    })

    it('FROM "folder" 过滤笔记本', async () => {
      const parsed = parseDataviewQuery('LIST FROM "工作笔记本"')
      const result = await executeDataviewQuery(parsed.query!)

      // note1 and note2 are in 工作笔记本 (note4 is deleted)
      expect(result.total).toBe(2)
    })

    it('FROM folder 通过笔记本名过滤', async () => {
      const parsed = parseDataviewQuery('LIST FROM Personal')
      const result = await executeDataviewQuery(parsed.query!)

      expect(result.total).toBe(1)
      expect(result.rows[0].noteId).toBe('note3')
    })

    it('不存在的标签返回空结果', async () => {
      const parsed = parseDataviewQuery('LIST FROM #nonexistent')
      const result = await executeDataviewQuery(parsed.query!)

      expect(result.total).toBe(0)
      expect(result.rows).toHaveLength(0)
    })
  })

  describe('WHERE 过滤', () => {
    it('WHERE 等于条件', async () => {
      const parsed = parseDataviewQuery('LIST WHERE is_favorite = true')
      const result = await executeDataviewQuery(parsed.query!)

      expect(result.total).toBe(2) // note1 and note3 are favorites
    })

    it('WHERE 不等于条件', async () => {
      const parsed = parseDataviewQuery('LIST WHERE is_favorite != true')
      const result = await executeDataviewQuery(parsed.query!)

      expect(result.total).toBe(2) // note2 and note5
    })

    it('WHERE 标签包含', async () => {
      const parsed = parseDataviewQuery('LIST WHERE tags = "meeting"')
      const result = await executeDataviewQuery(parsed.query!)

      expect(result.total).toBe(1)
      expect(result.rows[0].noteId).toBe('note2')
    })

    it('WHERE CONTAINS', async () => {
      const parsed = parseDataviewQuery('LIST WHERE title CONTAINS "项目"')
      const result = await executeDataviewQuery(parsed.query!)

      expect(result.total).toBe(1)
      expect(result.rows[0].noteId).toBe('note1')
    })

    it('WHERE is_daily 过滤', async () => {
      const parsed = parseDataviewQuery('LIST WHERE is_daily = true')
      const result = await executeDataviewQuery(parsed.query!)

      expect(result.total).toBe(1)
      expect(result.rows[0].noteId).toBe('note5')
    })

    it('WHERE AND 组合', async () => {
      const parsed = parseDataviewQuery('LIST FROM #project WHERE is_favorite = true')
      const result = await executeDataviewQuery(parsed.query!)

      expect(result.total).toBe(1)
      expect(result.rows[0].noteId).toBe('note1')
    })

    it('WHERE folder 过滤', async () => {
      const parsed = parseDataviewQuery('LIST WHERE folder = "工作笔记本"')
      const result = await executeDataviewQuery(parsed.query!)

      expect(result.total).toBe(2)
    })
  })

  describe('SORT 排序', () => {
    it('SORT updated DESC 按更新时间降序', async () => {
      const parsed = parseDataviewQuery('LIST SORT updated DESC')
      const result = await executeDataviewQuery(parsed.query!)

      // note3 has latest updated_at
      expect(result.rows[0].noteId).toBe('note3')
    })

    it('SORT updated ASC 按更新时间升序', async () => {
      const parsed = parseDataviewQuery('LIST SORT updated ASC')
      const result = await executeDataviewQuery(parsed.query!)

      // note2 has earliest updated_at (among non-deleted)
      expect(result.rows[0].noteId).toBe('note2')
    })

    it('SORT created DESC', async () => {
      const parsed = parseDataviewQuery('LIST SORT created DESC')
      const result = await executeDataviewQuery(parsed.query!)

      // note5 has latest created_at
      expect(result.rows[0].noteId).toBe('note5')
    })

    it('SORT title ASC 按标题字母排序', async () => {
      const parsed = parseDataviewQuery('LIST SORT title ASC')
      const result = await executeDataviewQuery(parsed.query!)

      // Personal Notes should come before 会议记录 in ASCII order
      expect(result.rows[0].noteTitle).toBe('Personal Notes')
    })

    it('默认按 updated DESC 排序', async () => {
      const parsed = parseDataviewQuery('LIST')
      const result = await executeDataviewQuery(parsed.query!)

      // Without explicit sort, should sort by updated DESC
      expect(result.rows[0].noteId).toBe('note3')
    })
  })

  describe('LIMIT 限制', () => {
    it('LIMIT 限制结果数量', async () => {
      const parsed = parseDataviewQuery('LIST LIMIT 2')
      const result = await executeDataviewQuery(parsed.query!)

      expect(result.rows).toHaveLength(2)
      expect(result.total).toBe(4) // Total before limit
    })

    it('LIMIT 0 或无效值不限制结果', async () => {
      const parsed = parseDataviewQuery('LIST LIMIT 0')
      const result = await executeDataviewQuery(parsed.query!)

      // LIMIT 0 means no limit applied (returns all results)
      expect(result.rows).toHaveLength(4) // All non-deleted notes
    })

    it('LIMIT 大于总数', async () => {
      const parsed = parseDataviewQuery('LIST LIMIT 100')
      const result = await executeDataviewQuery(parsed.query!)

      expect(result.rows).toHaveLength(4) // All non-deleted notes
    })
  })

  describe('复杂查询', () => {
    it('完整查询', async () => {
      const query = `
        TABLE title, tags, updated
        FROM #project
        WHERE is_favorite = true
        SORT updated DESC
        LIMIT 10
      `
      const parsed = parseDataviewQuery(query)
      const result = await executeDataviewQuery(parsed.query!)

      expect(result.error).toBeUndefined()
      expect(result.total).toBe(1)
      expect(result.rows[0].noteId).toBe('note1')
      expect(result.columns).toContain('title')
      expect(result.columns).toContain('tags')
      expect(result.columns).toContain('updated')
    })
  })
})

describe('formatFieldValue', () => {
  it('格式化 null 值', () => {
    expect(formatFieldValue(null, 'any')).toBe('-')
    expect(formatFieldValue(undefined, 'any')).toBe('-')
  })

  it('格式化布尔值', () => {
    expect(formatFieldValue(true, 'is_favorite')).toBe('✓')
    expect(formatFieldValue(false, 'is_pinned')).toBe('✗')
  })

  it('格式化数组', () => {
    expect(formatFieldValue(['a', 'b', 'c'], 'tags')).toBe('a, b, c')
    expect(formatFieldValue([], 'tags')).toBe('')
  })

  it('格式化字符串', () => {
    expect(formatFieldValue('test', 'title')).toBe('test')
  })

  it('格式化数字', () => {
    expect(formatFieldValue(42, 'count')).toBe('42')
  })

  describe('日期格式化', () => {
    it('格式化今天的日期', () => {
      const now = new Date()
      const result = formatFieldValue(now.toISOString(), 'updated')
      // Should show time for today
      expect(result).toMatch(/\d{1,2}:\d{2}/)
    })

    it('格式化昨天的日期', () => {
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const result = formatFieldValue(yesterday.toISOString(), 'updated')
      // Intl.RelativeTimeFormat returns lowercase in most locales
      expect(result.toLowerCase()).toBe('yesterday')
    })

    it('格式化几天前的日期', () => {
      const threeDaysAgo = new Date()
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)
      const result = formatFieldValue(threeDaysAgo.toISOString(), 'created')
      expect(result).toBe('3 days ago')
    })

    it('格式化一周前的日期', () => {
      const weekAgo = new Date()
      weekAgo.setDate(weekAgo.getDate() - 10)
      const result = formatFieldValue(weekAgo.toISOString(), 'updated')
      // Should show month/day format
      expect(result).toMatch(/\w+ \d+/)
    })
  })
})

describe('isBuiltinField', () => {
  it('识别内置字段', () => {
    expect(isBuiltinField('title')).toBe(true)
    expect(isBuiltinField('created')).toBe(true)
    expect(isBuiltinField('updated')).toBe(true)
    expect(isBuiltinField('tags')).toBe(true)
    expect(isBuiltinField('folder')).toBe(true)
    expect(isBuiltinField('notebook')).toBe(true)
    expect(isBuiltinField('is_daily')).toBe(true)
    expect(isBuiltinField('is_favorite')).toBe(true)
    expect(isBuiltinField('is_pinned')).toBe(true)
    expect(isBuiltinField('summary')).toBe(true)
  })

  it('大小写不敏感', () => {
    expect(isBuiltinField('Title')).toBe(true)
    expect(isBuiltinField('CREATED')).toBe(true)
    expect(isBuiltinField('Updated')).toBe(true)
  })

  it('非内置字段返回 false', () => {
    expect(isBuiltinField('custom_field')).toBe(false)
    expect(isBuiltinField('status')).toBe(false)
    expect(isBuiltinField('priority')).toBe(false)
  })
})

describe('getBuiltinFields', () => {
  it('返回所有内置字段', () => {
    const fields = getBuiltinFields()
    expect(fields).toContain('title')
    expect(fields).toContain('created')
    expect(fields).toContain('updated')
    expect(fields).toContain('tags')
    expect(fields).toContain('folder')
    expect(fields.length).toBeGreaterThan(5)
  })
})
