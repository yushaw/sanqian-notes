/**
 * CSV 解析器测试
 */

import { describe, it, expect } from 'vitest'
import { parseCSV, csvToMarkdownTable, extractTitleColumn } from '../utils/csv-parser'

describe('CSV Parser', () => {
  describe('parseCSV', () => {
    it('should parse simple CSV', () => {
      const csv = 'Name,Age,City\nAlice,30,NYC\nBob,25,LA'
      const result = parseCSV(csv)

      expect(result).toHaveLength(3)
      expect(result[0]).toEqual(['Name', 'Age', 'City'])
      expect(result[1]).toEqual(['Alice', '30', 'NYC'])
      expect(result[2]).toEqual(['Bob', '25', 'LA'])
    })

    it('should handle quoted fields with commas', () => {
      const csv = 'Name,Description\nAlice,"Hello, World"\nBob,"A, B, C"'
      const result = parseCSV(csv)

      expect(result).toHaveLength(3)
      expect(result[1]).toEqual(['Alice', 'Hello, World'])
      expect(result[2]).toEqual(['Bob', 'A, B, C'])
    })

    it('should handle quoted fields with newlines', () => {
      const csv = 'Name,Bio\nAlice,"Line 1\nLine 2"\nBob,Simple'
      const result = parseCSV(csv)

      expect(result).toHaveLength(3)
      expect(result[1]).toEqual(['Alice', 'Line 1\nLine 2'])
      expect(result[2]).toEqual(['Bob', 'Simple'])
    })

    it('should handle escaped quotes', () => {
      const csv = 'Name,Quote\nAlice,"He said ""Hello"""\nBob,Normal'
      const result = parseCSV(csv)

      expect(result).toHaveLength(3)
      expect(result[1]).toEqual(['Alice', 'He said "Hello"'])
    })

    it('should handle empty fields', () => {
      const csv = 'A,B,C\n1,,3\n,2,'
      const result = parseCSV(csv)

      expect(result).toHaveLength(3)
      expect(result[1]).toEqual(['1', '', '3'])
      expect(result[2]).toEqual(['', '2', ''])
    })

    it('should handle CRLF line endings', () => {
      const csv = 'Name,Value\r\nAlice,1\r\nBob,2'
      const result = parseCSV(csv)

      expect(result).toHaveLength(3)
      expect(result[0]).toEqual(['Name', 'Value'])
    })

    it('should handle file without trailing newline', () => {
      const csv = 'A,B\n1,2'
      const result = parseCSV(csv)

      expect(result).toHaveLength(2)
      expect(result[1]).toEqual(['1', '2'])
    })

    it('should skip empty lines', () => {
      const csv = 'A,B\n\n1,2\n\n'
      const result = parseCSV(csv)

      expect(result).toHaveLength(2)
    })
  })

  describe('csvToMarkdownTable', () => {
    it('should convert CSV to Markdown table', () => {
      const csv = 'Name,Age\nAlice,30\nBob,25'
      const md = csvToMarkdownTable(csv)

      expect(md).toContain('| Name | Age |')
      expect(md).toContain('| --- | --- |')
      expect(md).toContain('| Alice | 30 |')
      expect(md).toContain('| Bob | 25 |')
    })

    it('should escape pipe characters in cells', () => {
      const csv = 'Name,Formula\nTest,a|b|c'
      const md = csvToMarkdownTable(csv)

      expect(md).toContain('a\\|b\\|c')
    })

    it('should replace newlines with spaces in cells', () => {
      const csv = 'Name,Bio\nAlice,"Line1\nLine2"'
      const md = csvToMarkdownTable(csv)

      expect(md).toContain('Line1 Line2')
      expect(md).not.toContain('\n\n')
    })

    it('should add wiki links for title column', () => {
      const csv = 'Name,Status\nTask 1,Done\nTask 2,Pending'
      const rowToNote = new Map([
        ['Task 1', 'Task 1'],
        ['Task 2', 'Task 2'],
      ])
      const md = csvToMarkdownTable(csv, ['Name'], rowToNote)

      expect(md).toContain('[[Task 1]]')
      expect(md).toContain('[[Task 2]]')
    })

    it('should handle empty CSV', () => {
      const md = csvToMarkdownTable('')
      expect(md).toBe('')
    })

    it('should handle CSV with only headers', () => {
      const csv = 'Name,Age'
      const md = csvToMarkdownTable(csv)

      expect(md).toContain('| Name | Age |')
      expect(md).toContain('| --- | --- |')
    })
  })

  describe('extractTitleColumn', () => {
    it('should extract Name column values', () => {
      const csv = 'Name,Status\nTask 1,Done\nTask 2,Pending'
      const titles = extractTitleColumn(csv)

      expect(titles).toEqual(['Task 1', 'Task 2'])
    })

    it('should extract Title column values', () => {
      const csv = 'ID,Title,Status\n1,First,Done\n2,Second,Pending'
      const titles = extractTitleColumn(csv, ['Title'])

      expect(titles).toEqual(['First', 'Second'])
    })

    it('should fallback to first column', () => {
      const csv = 'Item,Value\nA,1\nB,2'
      const titles = extractTitleColumn(csv, ['Name', 'Title'])

      expect(titles).toEqual(['A', 'B'])
    })

    it('should filter empty values', () => {
      const csv = 'Name,Value\nA,1\n,2\nC,3'
      const titles = extractTitleColumn(csv)

      expect(titles).toEqual(['A', 'C'])
    })
  })

  describe('edge cases', () => {
    it('should handle unicode characters in CSV', () => {
      const csv = 'Name,Description\n中文,描述\n日本語,説明\n한국어,설명'
      const result = parseCSV(csv)

      expect(result).toHaveLength(4)
      expect(result[1]).toEqual(['中文', '描述'])
      expect(result[2]).toEqual(['日本語', '説明'])
      expect(result[3]).toEqual(['한국어', '설명'])
    })

    it('should handle very long cell content', () => {
      const longContent = 'x'.repeat(10000)
      const csv = `Name,Content\nTest,"${longContent}"`
      const result = parseCSV(csv)

      expect(result).toHaveLength(2)
      expect(result[1][1]).toHaveLength(10000)
    })

    it('should handle mixed quoted and unquoted fields', () => {
      const csv = 'A,B,C\n"quoted",unquoted,"also quoted"\n1,2,3'
      const result = parseCSV(csv)

      expect(result[1]).toEqual(['quoted', 'unquoted', 'also quoted'])
    })

    it('should handle fields with only whitespace', () => {
      // 引号内的空格会保留，但 parseCSV 会跳过全空白行
      const csv = 'A,B,C\n"text",  ,"more"'
      const result = parseCSV(csv)

      expect(result).toHaveLength(2)
      expect(result[1][0]).toBe('text')
      expect(result[1][1]).toBe('')  // 非引号内的空格会被 trim
      expect(result[1][2]).toBe('more')
    })

    it('should handle single column CSV', () => {
      const csv = 'Name\nAlice\nBob\nCharlie'
      const result = parseCSV(csv)

      expect(result).toHaveLength(4)
      expect(result.map((r) => r[0])).toEqual(['Name', 'Alice', 'Bob', 'Charlie'])
    })

    it('should handle CSV with many columns', () => {
      const headers = Array.from({ length: 20 }, (_, i) => `Col${i + 1}`).join(',')
      const values = Array.from({ length: 20 }, (_, i) => `Val${i + 1}`).join(',')
      const csv = `${headers}\n${values}`
      const result = parseCSV(csv)

      expect(result[0]).toHaveLength(20)
      expect(result[1]).toHaveLength(20)
    })

    it('should handle consecutive quotes correctly', () => {
      const csv = 'Quote\n"He said """"Yes"""" loudly"'
      const result = parseCSV(csv)

      expect(result[1][0]).toBe('He said ""Yes"" loudly')
    })

    it('should handle tabs in cells', () => {
      const csv = 'Name,Notes\nTest,"Tab\there"'
      const result = parseCSV(csv)

      expect(result[1][1]).toBe('Tab\there')
    })
  })

  describe('csvToMarkdownTable edge cases', () => {
    it('should handle cells with markdown special chars', () => {
      const csv = 'Name,Code\nTest,`code` here\nAnother,*bold*'
      const md = csvToMarkdownTable(csv)

      expect(md).toContain('`code` here')
      expect(md).toContain('*bold*')
    })

    it('should handle very wide tables', () => {
      const headers = Array.from({ length: 10 }, (_, i) => `Header${i + 1}`).join(',')
      const csv = `${headers}\n${Array(10).fill('value').join(',')}`
      const md = csvToMarkdownTable(csv)

      expect(md.split('|').length).toBeGreaterThan(10)
    })

    it('should handle single row CSV (headers only)', () => {
      const csv = 'A,B,C'
      const md = csvToMarkdownTable(csv)

      expect(md).toContain('| A | B | C |')
      expect(md).toContain('| --- | --- | --- |')
    })
  })

  describe('extractTitleColumn edge cases', () => {
    it('should handle 名称 as title column for Chinese', () => {
      const csv = '名称,状态\n任务1,完成\n任务2,进行中'
      const titles = extractTitleColumn(csv, ['名称'])

      expect(titles).toEqual(['任务1', '任务2'])
    })

    it('should handle case-insensitive column matching', () => {
      const csv = 'NAME,Status\nTask 1,Done\nTask 2,Pending'
      const titles = extractTitleColumn(csv, ['name'])

      expect(titles).toEqual(['Task 1', 'Task 2'])
    })

    it('should handle CSV with duplicate title values', () => {
      const csv = 'Name,Status\nItem,Done\nItem,Pending\nOther,Done'
      const titles = extractTitleColumn(csv)

      expect(titles).toEqual(['Item', 'Item', 'Other'])
    })
  })
})
