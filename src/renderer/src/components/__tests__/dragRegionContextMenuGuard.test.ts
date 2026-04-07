import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

import { describe, it, expect } from 'vitest'

const RENDERER_SOURCE_ROOT = path.resolve(process.cwd(), 'src/renderer/src')
const GUARDED_COMPONENTS = ['DragRegionContainer', 'WindowDragStrip'] as const
const FORBIDDEN_CONTEXT_MENU_PROPS = new Set(['onContextMenu', 'onContextMenuCapture'])

function collectRendererTsxFiles(rootDir: string): string[] {
  const stack = [rootDir]
  const files: string[] = []

  while (stack.length > 0) {
    const currentDir = stack.pop()
    if (!currentDir) continue

    const entries = fs.readdirSync(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === '__tests__') continue
        stack.push(absolutePath)
        continue
      }
      if (entry.isFile() && absolutePath.endsWith('.tsx')) {
        files.push(absolutePath)
      }
    }
  }

  return files
}

function resolveGuardedComponentFromModule(moduleName: string): (typeof GUARDED_COMPONENTS)[number] | null {
  if (/(^|\/)DragRegionContainer$/.test(moduleName)) return 'DragRegionContainer'
  if (/(^|\/)WindowDragStrip$/.test(moduleName)) return 'WindowDragStrip'
  return null
}

function collectGuardedComponentTagNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>(GUARDED_COMPONENTS)
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue

    const canonicalComponent = resolveGuardedComponentFromModule(statement.moduleSpecifier.text)
    if (!canonicalComponent) continue

    const importClause = statement.importClause
    if (!importClause) continue

    if (importClause.name) {
      names.add(importClause.name.text)
    }

    const namedBindings = importClause.namedBindings
    if (!namedBindings) continue

    if (ts.isNamedImports(namedBindings)) {
      for (const element of namedBindings.elements) {
        const importedName = element.propertyName?.text ?? element.name.text
        if (importedName === canonicalComponent) {
          names.add(element.name.text)
        }
      }
      continue
    }

    if (ts.isNamespaceImport(namedBindings)) {
      names.add(`${namedBindings.name.text}.${canonicalComponent}`)
    }
  }
  return names
}

function getJsxTagName(tagName: ts.JsxTagNameExpression): string | null {
  if (ts.isIdentifier(tagName)) return tagName.text
  if (ts.isThisTypeNode(tagName)) return null
  if (ts.isPropertyAccessExpression(tagName)) {
    return getPropertyAccessText(tagName)
  }
  return null
}

function getPropertyAccessText(expression: ts.PropertyAccessExpression): string {
  if (ts.isIdentifier(expression.expression)) {
    return `${expression.expression.text}.${expression.name.text}`
  }
  if (ts.isPropertyAccessExpression(expression.expression)) {
    return `${getPropertyAccessText(expression.expression)}.${expression.name.text}`
  }
  return expression.name.text
}

function hasForbiddenContextMenuAttribute(attributes: ts.JsxAttributes): boolean {
  for (const prop of attributes.properties) {
    if (!ts.isJsxAttribute(prop)) continue
    const propName = prop.name.getText()
    if (FORBIDDEN_CONTEXT_MENU_PROPS.has(propName)) return true
  }
  return false
}

function findGuardViolations(content: string): boolean {
  const sourceFile = ts.createSourceFile(
    'guard-check.tsx',
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  const guardedTagNames = collectGuardedComponentTagNames(sourceFile)
  let hasViolation = false

  const visit = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tagName = getJsxTagName(node.tagName)
      if (tagName && guardedTagNames.has(tagName) && hasForbiddenContextMenuAttribute(node.attributes)) {
        hasViolation = true
        return
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return hasViolation
}

describe('drag region context-menu static guard', () => {
  it('forbids context-menu handlers on drag region wrapper components, including aliased imports', () => {
    const files = collectRendererTsxFiles(RENDERER_SOURCE_ROOT)
    const offenders: string[] = []

    for (const filePath of files) {
      const content = fs.readFileSync(filePath, 'utf8')
      const hasViolation = findGuardViolations(content)
      if (hasViolation) {
        offenders.push(path.relative(RENDERER_SOURCE_ROOT, filePath))
      }
    }

    expect(offenders).toEqual([])
  })

  it('detects alias import violations in TSX snippets', () => {
    const content = `
      import { DragRegionContainer as HeaderDrag } from './DragRegionContainer'
      export function Sample() {
        return <HeaderDrag onContextMenu={() => {}} />
      }
    `
    expect(findGuardViolations(content)).toBe(true)
  })

  it('does not flag context menu handlers on non-drag wrapper elements', () => {
    const content = `
      import { DragRegionContainer } from './DragRegionContainer'
      export function Sample() {
        return (
          <DragRegionContainer>
            <div className="no-drag" onContextMenu={() => {}} />
          </DragRegionContainer>
        )
      }
    `
    expect(findGuardViolations(content)).toBe(false)
  })
})
