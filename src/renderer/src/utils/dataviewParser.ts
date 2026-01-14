/**
 * Dataview Query Parser
 *
 * Parses DQL-like syntax for querying notes
 *
 * Supported syntax (MVP):
 * - LIST [field1, field2] FROM #tag|"folder"
 * - TABLE field1, field2 FROM #tag|"folder"
 * - WHERE field = "value" | field != "value"
 * - SORT field ASC|DESC
 * - LIMIT number
 */

export type QueryType = 'LIST' | 'TABLE'

export interface FromClause {
  type: 'tag' | 'folder' | 'all'
  value: string
}

/**
 * Field function that extracts a component from a date field
 * e.g., week(created), year(created)
 */
export interface FieldFunction {
  type: 'field_function'
  function: 'week' | 'year'
  field: string
}

export interface WhereClause {
  field: string | FieldFunction
  operator: '=' | '!=' | '>' | '<' | '>=' | '<=' | 'contains'
  value: string | number | boolean | DateExpression
  logic?: 'AND' | 'OR'
}

/**
 * Date expression value for WHERE clause
 * e.g., date(today), date(sow), today, this_week
 */
export interface DateExpression {
  type: 'date'
  keyword: string // today, yesterday, sow, eow, this_week, etc.
  isRange: boolean // true for range keywords like today, this_week (used with = operator)
}

export interface SortClause {
  field: string
  direction: 'ASC' | 'DESC'
}

export interface ParsedQuery {
  type: QueryType
  fields: string[]
  from: FromClause
  where: WhereClause[]
  sort: SortClause[]
  limit?: number
}

export interface ParseError {
  message: string
  line?: number
  column?: number
}

export interface ParseResult {
  success: boolean
  query?: ParsedQuery
  error?: ParseError
}

// Token types for lexer
type TokenType =
  | 'KEYWORD'
  | 'IDENTIFIER'
  | 'STRING'
  | 'NUMBER'
  | 'TAG'
  | 'OPERATOR'
  | 'COMMA'
  | 'LPAREN'
  | 'RPAREN'
  | 'EOF'

interface Token {
  type: TokenType
  value: string
  line: number
  column: number
}

// Keywords
const KEYWORDS = new Set([
  'LIST',
  'TABLE',
  'FROM',
  'WHERE',
  'SORT',
  'ORDER',
  'BY',
  'LIMIT',
  'ASC',
  'DESC',
  'AND',
  'OR',
  'CONTAINS',
  'DATE', // date() function
  'WEEK', // week() function - extract week number
  'YEAR', // year() function - extract year
])

// Date keywords (for date() function and direct use)
const DATE_KEYWORDS = new Set([
  'now',
  'today',
  'yesterday',
  'tomorrow',
  'sow', // start of week
  'eow', // end of week
  'som', // start of month
  'eom', // end of month
  'soy', // start of year
  'eoy', // end of year
])

// Range keywords (expand to date range when used with = operator)
const RANGE_KEYWORDS = new Set([
  'today',
  'yesterday',
  'tomorrow',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'this_year',
])

// Operators
// Order matters: longer operators (!=, >=, <=) must come before shorter ones (=, >, <)
// to ensure correct matching in the tokenizer
const OPERATORS = ['!=', '>=', '<=', '=', '>', '<']

/**
 * Lexer: Tokenize the query string
 */
function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let pos = 0
  let line = 1
  let column = 1

  const peek = (offset = 0): string => input[pos + offset] || ''
  const advance = (): string => {
    const char = input[pos++]
    if (char === '\n') {
      line++
      column = 1
    } else {
      column++
    }
    return char
  }

  while (pos < input.length) {
    const char = peek()

    // Skip whitespace
    if (/\s/.test(char)) {
      advance()
      continue
    }

    // Skip comments (-- style)
    if (char === '-' && peek(1) === '-') {
      while (pos < input.length && peek() !== '\n') {
        advance()
      }
      continue
    }

    const startColumn = column
    const startLine = line

    // Tag: #tagname
    if (char === '#') {
      advance()
      let value = ''
      while (pos < input.length && /[\w\u4e00-\u9fa5-]/.test(peek())) {
        value += advance()
      }
      tokens.push({ type: 'TAG', value, line: startLine, column: startColumn })
      continue
    }

    // String: "..." or '...'
    if (char === '"' || char === "'") {
      const quote = advance()
      let value = ''
      while (pos < input.length && peek() !== quote) {
        if (peek() === '\\' && peek(1) === quote) {
          advance()
          value += advance()
        } else {
          value += advance()
        }
      }
      if (peek() === quote) {
        advance()
      }
      tokens.push({ type: 'STRING', value, line: startLine, column: startColumn })
      continue
    }

    // Number (including negative numbers)
    if (/\d/.test(char) || (char === '-' && /\d/.test(peek(1)))) {
      let value = ''
      // Handle negative sign
      if (char === '-') {
        value += advance()
      }
      while (pos < input.length && /[\d.]/.test(peek())) {
        value += advance()
      }
      tokens.push({ type: 'NUMBER', value, line: startLine, column: startColumn })
      continue
    }

    // Operator (check multi-char operators first)
    let matchedOp = ''
    for (const op of OPERATORS) {
      if (input.slice(pos, pos + op.length) === op) {
        if (op.length > matchedOp.length) {
          matchedOp = op
        }
      }
    }
    if (matchedOp) {
      for (let i = 0; i < matchedOp.length; i++) {
        advance()
      }
      tokens.push({ type: 'OPERATOR', value: matchedOp, line: startLine, column: startColumn })
      continue
    }

    // Comma
    if (char === ',') {
      advance()
      tokens.push({ type: 'COMMA', value: ',', line: startLine, column: startColumn })
      continue
    }

    // Parentheses
    if (char === '(') {
      advance()
      tokens.push({ type: 'LPAREN', value: '(', line: startLine, column: startColumn })
      continue
    }
    if (char === ')') {
      advance()
      tokens.push({ type: 'RPAREN', value: ')', line: startLine, column: startColumn })
      continue
    }

    // Identifier or keyword
    if (/[\w\u4e00-\u9fa5]/.test(char)) {
      let value = ''
      while (pos < input.length && /[\w\u4e00-\u9fa5]/.test(peek())) {
        value += advance()
      }
      const upper = value.toUpperCase()
      if (KEYWORDS.has(upper)) {
        tokens.push({ type: 'KEYWORD', value: upper, line: startLine, column: startColumn })
      } else {
        tokens.push({ type: 'IDENTIFIER', value, line: startLine, column: startColumn })
      }
      continue
    }

    // Unknown character, skip
    advance()
  }

  tokens.push({ type: 'EOF', value: '', line, column })
  return tokens
}

/**
 * Parser: Parse tokens into ParsedQuery
 */
class Parser {
  private tokens: Token[]
  private pos = 0

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  private peek(offset = 0): Token {
    return this.tokens[this.pos + offset] || this.tokens[this.tokens.length - 1]
  }

  private advance(): Token {
    return this.tokens[this.pos++]
  }

  private expect(type: TokenType, value?: string): Token {
    const token = this.peek()
    if (token.type !== type || (value !== undefined && token.value !== value)) {
      throw new Error(
        `Expected ${value || type} but got "${token.value}" at line ${token.line}, column ${token.column}`
      )
    }
    return this.advance()
  }

  private match(type: TokenType, value?: string): boolean {
    const token = this.peek()
    return token.type === type && (value === undefined || token.value === value)
  }

  parse(): ParsedQuery {
    const query: ParsedQuery = {
      type: 'LIST',
      fields: [],
      from: { type: 'all', value: '' },
      where: [],
      sort: [],
    }

    // Parse query type: LIST or TABLE
    if (this.match('KEYWORD', 'LIST')) {
      this.advance()
      query.type = 'LIST'
    } else if (this.match('KEYWORD', 'TABLE')) {
      this.advance()
      query.type = 'TABLE'
      // TABLE must specify fields
      query.fields = this.parseFieldList()
    } else {
      throw new Error(`Expected LIST or TABLE at line ${this.peek().line}`)
    }

    // Parse FROM clause (optional)
    if (this.match('KEYWORD', 'FROM')) {
      this.advance()
      query.from = this.parseFromClause()
    }

    // Parse WHERE clause (optional)
    if (this.match('KEYWORD', 'WHERE')) {
      this.advance()
      query.where = this.parseWhereClause()
    }

    // Parse SORT/ORDER BY clause (optional)
    if (this.match('KEYWORD', 'SORT') || this.match('KEYWORD', 'ORDER')) {
      this.advance()
      if (this.match('KEYWORD', 'BY')) {
        this.advance()
      }
      query.sort = this.parseSortClause()
    }

    // Parse LIMIT clause (optional)
    if (this.match('KEYWORD', 'LIMIT')) {
      this.advance()
      const limitToken = this.expect('NUMBER')
      query.limit = parseInt(limitToken.value, 10)
    }

    return query
  }

  private parseFieldList(): string[] {
    const fields: string[] = []

    // First field
    if (this.match('IDENTIFIER')) {
      fields.push(this.advance().value)
    }

    // Additional fields separated by comma
    while (this.match('COMMA')) {
      this.advance()
      if (this.match('IDENTIFIER')) {
        fields.push(this.advance().value)
      }
    }

    return fields
  }

  private parseFromClause(): FromClause {
    // Tag: #tagname
    if (this.match('TAG')) {
      return { type: 'tag', value: this.advance().value }
    }

    // Folder: "folder name" or identifier
    if (this.match('STRING')) {
      return { type: 'folder', value: this.advance().value }
    }

    if (this.match('IDENTIFIER')) {
      return { type: 'folder', value: this.advance().value }
    }

    // Default: all notes
    return { type: 'all', value: '' }
  }

  private parseWhereClause(): WhereClause[] {
    const clauses: WhereClause[] = []

    // First condition
    clauses.push(this.parseCondition())

    // Additional conditions with AND/OR
    while (this.match('KEYWORD', 'AND') || this.match('KEYWORD', 'OR')) {
      const logic = this.advance().value as 'AND' | 'OR'
      clauses[clauses.length - 1].logic = logic
      clauses.push(this.parseCondition())
    }

    return clauses
  }

  private parseCondition(): WhereClause {
    let field: string | FieldFunction

    // Handle field functions: week(field), year(field)
    if (this.match('KEYWORD', 'WEEK') || this.match('KEYWORD', 'YEAR')) {
      const funcName = this.advance().value.toLowerCase() as 'week' | 'year'
      this.expect('LPAREN')
      const fieldName = this.expect('IDENTIFIER').value
      this.expect('RPAREN')
      field = {
        type: 'field_function',
        function: funcName,
        field: fieldName,
      }
    } else {
      field = this.expect('IDENTIFIER').value
    }

    // Handle CONTAINS keyword
    if (this.match('KEYWORD', 'CONTAINS')) {
      this.advance()
      const value = this.parseValue()
      return { field, operator: 'contains', value }
    }

    const operator = this.expect('OPERATOR').value as WhereClause['operator']
    const value = this.parseValue()

    return { field, operator, value }
  }

  private parseValue(): string | number | boolean | DateExpression {
    // Handle date() function: date(keyword)
    if (this.match('KEYWORD', 'DATE')) {
      this.advance() // consume 'date'
      this.expect('LPAREN')
      let keyword: string
      if (this.match('STRING')) {
        keyword = this.advance().value
      } else if (this.match('IDENTIFIER')) {
        keyword = this.advance().value
      } else {
        throw new Error(`Expected date keyword at line ${this.peek().line}`)
      }
      this.expect('RPAREN')
      const keywordLower = keyword.toLowerCase()
      return {
        type: 'date',
        keyword: keywordLower,
        isRange: RANGE_KEYWORDS.has(keywordLower),
      }
    }

    if (this.match('STRING')) {
      return this.advance().value
    }
    if (this.match('NUMBER')) {
      const val = this.advance().value
      return val.includes('.') ? parseFloat(val) : parseInt(val, 10)
    }
    if (this.match('IDENTIFIER')) {
      const val = this.advance().value.toLowerCase()
      if (val === 'true') return true
      if (val === 'false') return false
      // Check if it's a date/range keyword
      if (DATE_KEYWORDS.has(val) || RANGE_KEYWORDS.has(val)) {
        return {
          type: 'date',
          keyword: val,
          isRange: RANGE_KEYWORDS.has(val),
        }
      }
      return val
    }
    throw new Error(`Expected value at line ${this.peek().line}`)
  }

  private parseSortClause(): SortClause[] {
    const clauses: SortClause[] = []

    // First sort field
    clauses.push(this.parseSortField())

    // Additional sort fields separated by comma
    while (this.match('COMMA')) {
      this.advance()
      clauses.push(this.parseSortField())
    }

    return clauses
  }

  private parseSortField(): SortClause {
    const field = this.expect('IDENTIFIER').value
    let direction: 'ASC' | 'DESC' = 'ASC'

    if (this.match('KEYWORD', 'ASC')) {
      this.advance()
      direction = 'ASC'
    } else if (this.match('KEYWORD', 'DESC')) {
      this.advance()
      direction = 'DESC'
    }

    return { field, direction }
  }
}

/**
 * Parse a Dataview query string
 */
export function parseDataviewQuery(queryString: string): ParseResult {
  try {
    const trimmed = queryString.trim()
    if (!trimmed) {
      return {
        success: false,
        error: { message: 'Empty query' },
      }
    }

    const tokens = tokenize(trimmed)
    const parser = new Parser(tokens)
    const query = parser.parse()

    return {
      success: true,
      query,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown parse error'
    // Try to extract line/column from error message
    const match = message.match(/line (\d+)(?:, column (\d+))?/)
    return {
      success: false,
      error: {
        message,
        line: match ? parseInt(match[1], 10) : undefined,
        column: match && match[2] ? parseInt(match[2], 10) : undefined,
      },
    }
  }
}

/**
 * Format a parsed query back to string (for display)
 */
export function formatQuery(query: ParsedQuery): string {
  const parts: string[] = []

  // Type and fields
  if (query.type === 'TABLE' && query.fields.length > 0) {
    parts.push(`TABLE ${query.fields.join(', ')}`)
  } else {
    parts.push(query.type)
  }

  // FROM
  if (query.from.type !== 'all') {
    if (query.from.type === 'tag') {
      parts.push(`FROM #${query.from.value}`)
    } else {
      parts.push(`FROM "${query.from.value}"`)
    }
  }

  // WHERE
  if (query.where.length > 0) {
    const conditions = query.where.map((c, i) => {
      let valueStr: string
      if (typeof c.value === 'object' && c.value !== null && 'type' in c.value && c.value.type === 'date') {
        valueStr = `date(${c.value.keyword})`
      } else if (typeof c.value === 'string') {
        valueStr = `"${c.value}"`
      } else {
        valueStr = String(c.value)
      }
      // Format field (may be string or FieldFunction)
      let fieldStr: string
      if (typeof c.field === 'object' && c.field.type === 'field_function') {
        fieldStr = `${c.field.function}(${c.field.field})`
      } else {
        fieldStr = c.field as string
      }
      const condition = `${fieldStr} ${c.operator} ${valueStr}`
      if (i > 0 && query.where[i - 1].logic) {
        return `${query.where[i - 1].logic} ${condition}`
      }
      return condition
    })
    parts.push(`WHERE ${conditions.join(' ')}`)
  }

  // SORT
  if (query.sort.length > 0) {
    const sorts = query.sort.map((s) => `${s.field} ${s.direction}`)
    parts.push(`SORT ${sorts.join(', ')}`)
  }

  // LIMIT
  if (query.limit !== undefined) {
    parts.push(`LIMIT ${query.limit}`)
  }

  return parts.join('\n')
}
