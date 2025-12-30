/**
 * 工具函数测试
 */
import { describe, it, expect } from 'vitest'
import { normalizeCjkAscii } from '../utils'

describe('normalizeCjkAscii', () => {
  describe('基本功能', () => {
    it('空字符串返回空字符串', () => {
      expect(normalizeCjkAscii('')).toBe('')
    })

    it('null/undefined 返回原值', () => {
      expect(normalizeCjkAscii(null as unknown as string)).toBe(null)
      expect(normalizeCjkAscii(undefined as unknown as string)).toBe(undefined)
    })

    it('纯英文不变', () => {
      expect(normalizeCjkAscii('hello world')).toBe('hello world')
    })

    it('纯中文不变', () => {
      expect(normalizeCjkAscii('你好世界')).toBe('你好世界')
    })
  })

  describe('中英文混合', () => {
    it('中文后跟英文添加空格', () => {
      expect(normalizeCjkAscii('你好world')).toBe('你好 world')
    })

    it('英文后跟中文添加空格', () => {
      expect(normalizeCjkAscii('hello世界')).toBe('hello 世界')
    })

    it('中英文交替', () => {
      expect(normalizeCjkAscii('中文English中文')).toBe('中文 English 中文')
    })

    it('已有空格不重复添加', () => {
      expect(normalizeCjkAscii('你好 world')).toBe('你好 world')
    })
  })

  describe('数字混合', () => {
    it('中文后跟数字添加空格', () => {
      expect(normalizeCjkAscii('第1章')).toBe('第 1 章')
    })

    it('数字后跟中文添加空格', () => {
      expect(normalizeCjkAscii('2024年')).toBe('2024 年')
    })

    it('复杂数字中文混合', () => {
      expect(normalizeCjkAscii('共100个用户')).toBe('共 100 个用户')
    })
  })

  describe('真实场景', () => {
    it('技术文档常见写法', () => {
      expect(normalizeCjkAscii('使用React构建UI')).toBe('使用 React 构建 UI')
    })

    it('搜索查询', () => {
      expect(normalizeCjkAscii('math公式怎么写')).toBe('math 公式怎么写')
    })

    it('版本号', () => {
      expect(normalizeCjkAscii('版本v1.0.0发布')).toBe('版本 v1.0.0 发布')
    })

    it('复杂混合句子', () => {
      const input = 'Python是一门编程语言，可以用pip install安装包'
      const expected = 'Python 是一门编程语言，可以用 pip install 安装包'
      expect(normalizeCjkAscii(input)).toBe(expected)
    })
  })

  describe('边界情况', () => {
    it('单个中文字符', () => {
      expect(normalizeCjkAscii('中')).toBe('中')
    })

    it('单个英文字符', () => {
      expect(normalizeCjkAscii('a')).toBe('a')
    })

    it('标点符号不影响', () => {
      expect(normalizeCjkAscii('你好，world！')).toBe('你好，world！')
    })

    it('CJK 扩展区字符', () => {
      // 扩展 A 区：U+3400-U+4DBF
      expect(normalizeCjkAscii('㐀test')).toBe('㐀 test')
    })
  })
})
