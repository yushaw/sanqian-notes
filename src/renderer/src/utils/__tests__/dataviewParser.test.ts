/**
 * Dataview Query Parser Tests
 */
import { describe, it, expect } from 'vitest'
import { parseDataviewQuery, formatQuery } from '../dataviewParser'

describe('parseDataviewQuery', () => {
  describe('基本查询类型', () => {
    it('解析简单 LIST 查询', () => {
      const result = parseDataviewQuery('LIST')
      expect(result.success).toBe(true)
      expect(result.query?.type).toBe('LIST')
      expect(result.query?.from.type).toBe('all')
    })

    it('解析简单 TABLE 查询', () => {
      const result = parseDataviewQuery('TABLE title, created')
      expect(result.success).toBe(true)
      expect(result.query?.type).toBe('TABLE')
      expect(result.query?.fields).toEqual(['title', 'created'])
    })

    it('空查询返回错误', () => {
      const result = parseDataviewQuery('')
      expect(result.success).toBe(false)
      expect(result.error?.message).toBe('Empty query')
    })

    it('无效查询类型返回错误', () => {
      const result = parseDataviewQuery('SELECT * FROM notes')
      expect(result.success).toBe(false)
    })
  })

  describe('FROM 子句', () => {
    it('解析 FROM #tag', () => {
      const result = parseDataviewQuery('LIST FROM #project')
      expect(result.success).toBe(true)
      expect(result.query?.from.type).toBe('tag')
      expect(result.query?.from.value).toBe('project')
    })

    it('解析中文标签', () => {
      const result = parseDataviewQuery('LIST FROM #项目')
      expect(result.success).toBe(true)
      expect(result.query?.from.type).toBe('tag')
      expect(result.query?.from.value).toBe('项目')
    })

    it('解析 FROM "folder"', () => {
      const result = parseDataviewQuery('LIST FROM "我的笔记本"')
      expect(result.success).toBe(true)
      expect(result.query?.from.type).toBe('folder')
      expect(result.query?.from.value).toBe('我的笔记本')
    })

    it('解析 FROM identifier', () => {
      const result = parseDataviewQuery('LIST FROM MyNotebook')
      expect(result.success).toBe(true)
      expect(result.query?.from.type).toBe('folder')
      expect(result.query?.from.value).toBe('MyNotebook')
    })
  })

  describe('WHERE 子句', () => {
    it('解析等于条件', () => {
      const result = parseDataviewQuery('LIST FROM #task WHERE status = "done"')
      expect(result.success).toBe(true)
      expect(result.query?.where).toHaveLength(1)
      expect(result.query?.where[0]).toEqual({
        field: 'status',
        operator: '=',
        value: 'done',
      })
    })

    it('解析不等于条件', () => {
      const result = parseDataviewQuery('LIST FROM #task WHERE status != "done"')
      expect(result.success).toBe(true)
      expect(result.query?.where[0].operator).toBe('!=')
    })

    it('解析大于条件', () => {
      const result = parseDataviewQuery('LIST FROM #task WHERE priority > 1')
      expect(result.success).toBe(true)
      expect(result.query?.where[0]).toEqual({
        field: 'priority',
        operator: '>',
        value: 1,
      })
    })

    it('解析小于条件', () => {
      const result = parseDataviewQuery('LIST WHERE count < 100')
      expect(result.success).toBe(true)
      expect(result.query?.where[0].operator).toBe('<')
      expect(result.query?.where[0].value).toBe(100)
    })

    it('解析大于等于条件', () => {
      const result = parseDataviewQuery('LIST WHERE rating >= 4')
      expect(result.success).toBe(true)
      expect(result.query?.where[0].operator).toBe('>=')
    })

    it('解析小于等于条件', () => {
      const result = parseDataviewQuery('LIST WHERE rating <= 5')
      expect(result.success).toBe(true)
      expect(result.query?.where[0].operator).toBe('<=')
    })

    it('解析 CONTAINS 条件', () => {
      const result = parseDataviewQuery('LIST WHERE title CONTAINS "会议"')
      expect(result.success).toBe(true)
      expect(result.query?.where[0]).toEqual({
        field: 'title',
        operator: 'contains',
        value: '会议',
      })
    })

    it('解析布尔值条件', () => {
      const result = parseDataviewQuery('LIST WHERE is_favorite = true')
      expect(result.success).toBe(true)
      expect(result.query?.where[0].value).toBe(true)
    })

    it('解析 AND 组合条件', () => {
      const result = parseDataviewQuery('LIST WHERE status = "todo" AND priority > 1')
      expect(result.success).toBe(true)
      expect(result.query?.where).toHaveLength(2)
      expect(result.query?.where[0].logic).toBe('AND')
    })

    it('解析 OR 组合条件', () => {
      const result = parseDataviewQuery('LIST WHERE status = "todo" OR status = "doing"')
      expect(result.success).toBe(true)
      expect(result.query?.where).toHaveLength(2)
      expect(result.query?.where[0].logic).toBe('OR')
    })

    it('解析多个组合条件', () => {
      const result = parseDataviewQuery('LIST WHERE a = 1 AND b = 2 OR c = 3')
      expect(result.success).toBe(true)
      expect(result.query?.where).toHaveLength(3)
      expect(result.query?.where[0].logic).toBe('AND')
      expect(result.query?.where[1].logic).toBe('OR')
    })
  })

  describe('SORT 子句', () => {
    it('解析 SORT field', () => {
      const result = parseDataviewQuery('LIST SORT updated')
      expect(result.success).toBe(true)
      expect(result.query?.sort).toHaveLength(1)
      expect(result.query?.sort[0]).toEqual({
        field: 'updated',
        direction: 'ASC',
      })
    })

    it('解析 SORT field ASC', () => {
      const result = parseDataviewQuery('LIST SORT title ASC')
      expect(result.success).toBe(true)
      expect(result.query?.sort[0].direction).toBe('ASC')
    })

    it('解析 SORT field DESC', () => {
      const result = parseDataviewQuery('LIST SORT updated DESC')
      expect(result.success).toBe(true)
      expect(result.query?.sort[0].direction).toBe('DESC')
    })

    it('解析多字段排序', () => {
      const result = parseDataviewQuery('LIST SORT priority DESC, updated ASC')
      expect(result.success).toBe(true)
      expect(result.query?.sort).toHaveLength(2)
      expect(result.query?.sort[0]).toEqual({ field: 'priority', direction: 'DESC' })
      expect(result.query?.sort[1]).toEqual({ field: 'updated', direction: 'ASC' })
    })

    it('解析 ORDER BY 语法', () => {
      const result = parseDataviewQuery('LIST ORDER BY updated DESC')
      expect(result.success).toBe(true)
      expect(result.query?.sort[0]).toEqual({ field: 'updated', direction: 'DESC' })
    })
  })

  describe('LIMIT 子句', () => {
    it('解析 LIMIT', () => {
      const result = parseDataviewQuery('LIST LIMIT 10')
      expect(result.success).toBe(true)
      expect(result.query?.limit).toBe(10)
    })

    it('LIMIT 与其他子句组合', () => {
      const result = parseDataviewQuery('LIST FROM #task SORT updated DESC LIMIT 5')
      expect(result.success).toBe(true)
      expect(result.query?.limit).toBe(5)
      expect(result.query?.sort[0].direction).toBe('DESC')
    })
  })

  describe('复杂查询', () => {
    it('完整查询语句', () => {
      const query = `
        TABLE title, status, priority
        FROM #task
        WHERE status != "done" AND priority >= 2
        SORT priority DESC, updated ASC
        LIMIT 20
      `
      const result = parseDataviewQuery(query)
      expect(result.success).toBe(true)
      expect(result.query?.type).toBe('TABLE')
      expect(result.query?.fields).toEqual(['title', 'status', 'priority'])
      expect(result.query?.from).toEqual({ type: 'tag', value: 'task' })
      expect(result.query?.where).toHaveLength(2)
      expect(result.query?.sort).toHaveLength(2)
      expect(result.query?.limit).toBe(20)
    })

    it('带注释的查询', () => {
      const query = `
        -- 查询所有未完成的任务
        LIST FROM #task
        WHERE status != "done"
      `
      const result = parseDataviewQuery(query)
      expect(result.success).toBe(true)
      expect(result.query?.from.value).toBe('task')
    })

    it('单引号字符串', () => {
      const result = parseDataviewQuery("LIST WHERE title = 'test'")
      expect(result.success).toBe(true)
      expect(result.query?.where[0].value).toBe('test')
    })

    it('小数值', () => {
      const result = parseDataviewQuery('LIST WHERE rating >= 4.5')
      expect(result.success).toBe(true)
      expect(result.query?.where[0].value).toBe(4.5)
    })
  })

  describe('边界情况', () => {
    it('大小写不敏感的关键字', () => {
      const result = parseDataviewQuery('list from #tag where a = 1 sort b desc limit 5')
      expect(result.success).toBe(true)
      expect(result.query?.type).toBe('LIST')
    })

    it('多余空白字符', () => {
      const result = parseDataviewQuery('   LIST    FROM   #tag   ')
      expect(result.success).toBe(true)
      expect(result.query?.from.value).toBe('tag')
    })

    it('特殊字符标签', () => {
      const result = parseDataviewQuery('LIST FROM #my-project')
      expect(result.success).toBe(true)
      expect(result.query?.from.value).toBe('my-project')
    })

    it('空 TABLE 字段列表', () => {
      // TABLE without fields should work but have empty fields
      const result = parseDataviewQuery('TABLE FROM #tag')
      expect(result.success).toBe(true)
      expect(result.query?.fields).toEqual([])
    })
  })
})

describe('formatQuery', () => {
  it('格式化简单 LIST 查询', () => {
    const result = parseDataviewQuery('LIST FROM #project')
    if (result.success && result.query) {
      const formatted = formatQuery(result.query)
      expect(formatted).toContain('LIST')
      expect(formatted).toContain('FROM #project')
    }
  })

  it('格式化 TABLE 查询', () => {
    const result = parseDataviewQuery('TABLE title, status FROM #task')
    if (result.success && result.query) {
      const formatted = formatQuery(result.query)
      expect(formatted).toContain('TABLE title, status')
      expect(formatted).toContain('FROM #task')
    }
  })

  it('格式化带 WHERE 的查询', () => {
    const result = parseDataviewQuery('LIST WHERE status = "done"')
    if (result.success && result.query) {
      const formatted = formatQuery(result.query)
      expect(formatted).toContain('WHERE')
      expect(formatted).toContain('status')
      expect(formatted).toContain('"done"')
    }
  })

  it('格式化完整查询', () => {
    const result = parseDataviewQuery('TABLE a, b FROM #tag WHERE x = 1 SORT y DESC LIMIT 10')
    if (result.success && result.query) {
      const formatted = formatQuery(result.query)
      expect(formatted).toContain('TABLE a, b')
      expect(formatted).toContain('FROM #tag')
      expect(formatted).toContain('WHERE')
      expect(formatted).toContain('SORT')
      expect(formatted).toContain('LIMIT 10')
    }
  })
})
