/**
 * CSV 解析工具
 * 健壮的 CSV 解析器，支持：
 * - 引号内的逗号
 * - 引号内的换行
 * - 转义的引号（""）
 */

/**
 * 常见的标题列名称（用于识别哪一列是标题/名称列）
 * 支持多语言和常见变体
 */
export const DEFAULT_TITLE_COLUMNS = [
  // 英文
  'Name',
  'Title',
  'Task',
  'Page',
  'Item',
  'Subject',
  'Heading',
  // 中文
  '名称',
  '标题',
  '任务',
  '页面',
  '项目',
  '主题',
  // 日文
  '名前',
  'タイトル',
  // 韩文
  '이름',
  '제목',
]

/**
 * 解析 CSV 内容为二维数组
 */
export function parseCSV(content: string): string[][] {
  const rows: string[][] = []
  let current: string[] = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < content.length; i++) {
    const char = content[i]
    const next = content[i + 1]

    if (inQuotes) {
      if (char === '"' && next === '"') {
        // 转义的引号
        cell += '"'
        i++
      } else if (char === '"') {
        // 结束引号
        inQuotes = false
      } else {
        // 引号内的普通字符（包括换行）
        cell += char
      }
    } else {
      if (char === '"') {
        // 开始引号
        inQuotes = true
      } else if (char === ',') {
        // 字段分隔
        current.push(cell.trim())
        cell = ''
      } else if (char === '\n' || (char === '\r' && next === '\n')) {
        // 行结束
        current.push(cell.trim())
        if (current.some((c) => c)) {
          rows.push(current)
        }
        current = []
        cell = ''
        if (char === '\r') i++ // 跳过 \r\n 中的 \n
      } else if (char === '\r') {
        // 单独的 \r（旧 Mac 格式）
        current.push(cell.trim())
        if (current.some((c) => c)) {
          rows.push(current)
        }
        current = []
        cell = ''
      } else {
        cell += char
      }
    }
  }

  // 处理最后一行（没有换行结尾的情况）
  if (cell || current.length > 0) {
    current.push(cell.trim())
    if (current.some((c) => c)) {
      rows.push(current)
    }
  }

  return rows
}

/**
 * 将 CSV 内容转换为 Markdown 表格
 * @param csvContent CSV 文件内容
 * @param titleColumnNames 可能的标题列名（用于生成 wiki 链接）
 * @param rowTitleToNoteTitle 行标题 → 笔记标题 的映射（用于生成链接）
 */
export function csvToMarkdownTable(
  csvContent: string,
  titleColumnNames: string[] = DEFAULT_TITLE_COLUMNS,
  rowTitleToNoteTitle?: Map<string, string>
): string {
  const rows = parseCSV(csvContent)
  if (rows.length < 1) return ''

  const headers = rows[0]
  const dataRows = rows.slice(1)

  if (headers.length === 0) return ''

  // 找到标题列（用于生成链接）
  const titleColIndex = headers.findIndex((h) =>
    titleColumnNames.some((name) => h.toLowerCase() === name.toLowerCase())
  )
  const linkColIndex = titleColIndex >= 0 ? titleColIndex : 0

  // 生成表头
  let md = '| ' + headers.map(escapeTableCell).join(' | ') + ' |\n'
  md += '| ' + headers.map(() => '---').join(' | ') + ' |\n'

  // 生成数据行
  for (const row of dataRows) {
    const cells = row.map((cell, i) => {
      const escaped = escapeTableCell(cell)

      // 标题列转为 wiki 链接
      if (i === linkColIndex && rowTitleToNoteTitle && cell) {
        const noteTitle = rowTitleToNoteTitle.get(cell)
        if (noteTitle) {
          return `[[${noteTitle}]]`
        }
      }

      return escaped
    })

    // 确保列数一致
    while (cells.length < headers.length) {
      cells.push('')
    }

    md += '| ' + cells.join(' | ') + ' |\n'
  }

  return md
}

/**
 * 转义 Markdown 表格单元格中的特殊字符
 */
function escapeTableCell(cell: string): string {
  return cell
    .replace(/\|/g, '\\|') // 转义管道符
    .replace(/\n/g, ' ') // 换行替换为空格
    .replace(/\r/g, '') // 移除回车
}

/**
 * 从 CSV 中提取标题列的值列表
 * 用于建立行标题 → 笔记的映射
 */
export function extractTitleColumn(
  csvContent: string,
  titleColumnNames: string[] = DEFAULT_TITLE_COLUMNS
): string[] {
  const rows = parseCSV(csvContent)
  if (rows.length < 2) return []

  const headers = rows[0]
  const dataRows = rows.slice(1)

  // 找到标题列
  const titleColIndex = headers.findIndex((h) =>
    titleColumnNames.some((name) => h.toLowerCase() === name.toLowerCase())
  )
  const colIndex = titleColIndex >= 0 ? titleColIndex : 0

  // 提取标题值
  return dataRows.map((row) => row[colIndex] || '').filter(Boolean)
}
