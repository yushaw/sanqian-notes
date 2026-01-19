/**
 * arXiv HTML Parser
 *
 * Parses LaTeXML-generated HTML from arXiv/ar5iv into structured content.
 * Preserves document order for figures, tables, and sections.
 */

import * as cheerio from 'cheerio'
import type { ArxivHtmlContent, ArxivSection, ArxivFigure, ArxivReference } from './types'

type CheerioAPI = ReturnType<typeof cheerio.load>
type Cheerio = ReturnType<CheerioAPI>

/**
 * Parse arXiv HTML page into structured content
 * Returns content in document order with figures inline in sections
 * Also returns figures array for downloading
 */
export function parseArxivHtml(html: string): ArxivHtmlContent {
  const $ = cheerio.load(html)
  const figures: ArxivFigure[] = []

  return {
    sections: parseDocumentInOrder($, figures),
    figures, // Collected during parsing for downloading
    tables: [],  // Tables are now inline in sections
    references: parseReferences($)
  }
}

/**
 * Parse document in order, including figures and tables inline
 */
function parseDocumentInOrder($: CheerioAPI, figures: ArxivFigure[]): ArxivSection[] {
  const sections: ArxivSection[] = []
  const seenFigureUrls = new Set<string>()

  // Find the main document content - prioritize article.ltx_document
  let $document = $('article.ltx_document')
  if ($document.length === 0) {
    $document = $('.ltx_document, article').first()
  }
  if ($document.length === 0) return sections

  // Process top-level figures that appear before sections (e.g., between abstract and first section)
  const topLevelFigures: string[] = []
  $document.children('figure.ltx_figure, .ltx_figure').each((_, figEl) => {
    const figureMarkdown = processFigure($(figEl), $, seenFigureUrls, figures)
    if (figureMarkdown) {
      topLevelFigures.push(figureMarkdown)
    }
  })

  // If there are top-level figures, add them as a pseudo-section before the first real section
  if (topLevelFigures.length > 0) {
    sections.push({
      level: 1,
      title: '',
      content: topLevelFigures.join('\n\n'),
      id: 'top-level-figures'
    })
  }

  // Process all top-level sections (direct children of the document)
  $document.children('section.ltx_section, .ltx_section').each((_, sectionEl) => {
    processSection($(sectionEl), $, sections, 1, seenFigureUrls, figures)
  })

  return sections
}

/**
 * Recursively process a section and its children
 */
function processSection(
  $section: Cheerio,
  $: CheerioAPI,
  sections: ArxivSection[],
  level: number,
  seenFigureUrls: Set<string>,
  figures: ArxivFigure[]
): void {
  // Get section title
  const $title = $section.find('> .ltx_title, > h1, > h2, > h3, > h4, > h5, > h6').first()
  const title = cleanTitle($title.text().trim())

  if (!title) return

  // Build section content by processing children in order
  const contentParts: string[] = []
  let sectionHeaderAdded = false // Track if we've added this section's header

  $section.children().each((_, child) => {
    const $child = $(child)
    const className = $child.attr('class') || ''
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tagName = ((child as any).tagName || (child as any).name || '').toLowerCase()

    // Skip the title element itself
    if ($child.is('.ltx_title') || ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) {
      return
    }

    // Handle ltx_paragraph as bold inline text (TipTap only supports H1-H4)
    if (className.includes('ltx_paragraph')) {
      const $paraTitle = $child.find('> .ltx_title, > h5, > h6').first()
      const paraTitle = $paraTitle.text().trim()

      // Process paragraph content (excluding the title)
      const paraParts: string[] = []
      if (paraTitle) {
        paraParts.push(`**${paraTitle}**`)
      }

      // Process child elements (ltx_para divs contain the actual content)
      // Need to handle equation tables specially, same as main ltx_para processing
      $child.children('.ltx_para, p').each((_, paraEl) => {
        const $paraEl = $(paraEl)
        $paraEl.children().each((_, paraChild) => {
          const $paraChild = $(paraChild)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const paraChildTag = ((paraChild as any).tagName || (paraChild as any).name || '').toLowerCase()
          const paraChildClass = $paraChild.attr('class') || ''

          // Check if this is an equation table
          if (
            paraChildTag === 'table' &&
            (paraChildClass.includes('ltx_equationgroup') ||
              paraChildClass.includes('ltx_eqn_table') ||
              paraChildClass.includes('ltx_equation'))
          ) {
            const eqnParts: string[] = []
            $paraChild.find('math').each((_, mathEl) => {
              const latex = extractLatex($(mathEl), $)
              if (latex) {
                eqnParts.push(latex)
              }
            })
            if (eqnParts.length > 0) {
              paraParts.push(`$$${eqnParts.join(' \\\\ ')}$$`)
            }
          } else if (paraChildTag === 'ul' || paraChildTag === 'ol') {
            // Handle lists - use dedicated list processor
            const listContent = processListElement($paraChild, $, paraChildTag)
            if (listContent.trim()) {
              paraParts.push(listContent)
            }
          } else if (paraChildTag === 'p' || paraChildClass.includes('ltx_p')) {
            const content = processInlineContent($paraChild, $)
            if (content.trim()) {
              paraParts.push(content)
            }
          } else {
            const content = processInlineContent($paraChild, $)
            if (content.trim()) {
              paraParts.push(content)
            }
          }
        })

        // If ltx_para has no children but has direct text content
        if ($paraEl.children().length === 0) {
          const content = processInlineContent($paraEl, $)
          if (content.trim()) {
            paraParts.push(content)
          }
        }
      })

      if (paraParts.length > 0) {
        contentParts.push(paraParts.join('\n\n'))
      }
      return
    }

    // Handle subsections - process recursively
    if (className.includes('ltx_subsection') || className.includes('ltx_subsubsection')) {
      // Add current section header once (with any content before first subsection)
      if (!sectionHeaderAdded) {
        sections.push({
          level,
          title,
          content: contentParts.join('\n\n'),
          id: $section.attr('id')
        })
        contentParts.length = 0
        sectionHeaderAdded = true
      }

      // Determine sublevel based on class (absolute levels)
      // ltx_section = 1, ltx_subsection = 2, ltx_subsubsection = 3
      const subLevel = className.includes('ltx_subsubsection') ? 3 : 2
      processSection($child, $, sections, subLevel, seenFigureUrls, figures)
      return
    }

    // Handle paragraphs - process children in order to maintain correct position
    if (className.includes('ltx_para') || tagName === 'p') {
      // Iterate through direct children to preserve order
      $child.children().each((_, paraChild) => {
        const $paraChild = $(paraChild)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const paraChildTag = ((paraChild as any).tagName || (paraChild as any).name || '').toLowerCase()
        const paraChildClass = $paraChild.attr('class') || ''

        // Check if this is an equation table
        if (
          paraChildTag === 'table' &&
          (paraChildClass.includes('ltx_equationgroup') ||
            paraChildClass.includes('ltx_eqn_table') ||
            paraChildClass.includes('ltx_equation'))
        ) {
          const eqnParts: string[] = []
          // First try tbody
          const $tbody = $paraChild.find('> tbody')
          if ($tbody.length > 0) {
            $tbody.each((_, tbody) => {
              const $tb = $(tbody)
              const rowLatex: string[] = []
              $tb.find('math').each((_, mathEl) => {
                const latex = extractLatex($(mathEl), $)
                if (latex) {
                  rowLatex.push(latex)
                }
              })
              if (rowLatex.length > 0) {
                eqnParts.push(rowLatex.join(' '))
              }
            })
          } else {
            // Fallback: find tr.ltx_eqn_row directly
            $paraChild.find('tr.ltx_eqn_row').each((_, row) => {
              const $row = $(row)
              const rowLatex: string[] = []
              $row.find('math').each((_, mathEl) => {
                const latex = extractLatex($(mathEl), $)
                if (latex) {
                  rowLatex.push(latex)
                }
              })
              if (rowLatex.length > 0) {
                eqnParts.push(rowLatex.join(' '))
              }
            })
          }
          if (eqnParts.length > 0) {
            contentParts.push(`$$${eqnParts.join(' \\\\ ')}$$`)
          }
        } else if (paraChildTag === 'p' || paraChildClass.includes('ltx_p')) {
          // Process paragraph content
          const content = processInlineContent($paraChild, $)
          if (content.trim()) {
            contentParts.push(content)
          }
        } else if (paraChildTag === 'ul' || paraChildTag === 'ol') {
          // Process lists - need to use the list handler directly
          const listContent = processListElement($paraChild, $, paraChildTag)
          if (listContent.trim()) {
            contentParts.push(listContent)
          }
        } else {
          // Process other inline content
          const content = processInlineContent($paraChild, $)
          if (content.trim()) {
            contentParts.push(content)
          }
        }
      })

      // If ltx_para has no children but has direct text content
      if ($child.children().length === 0) {
        const content = processInlineContent($child, $)
        if (content.trim()) {
          contentParts.push(content)
        }
      }
      return
    }

    // Handle tables (check BEFORE figures since tables use <figure class="ltx_table">)
    if (className.includes('ltx_table')) {
      const tableMarkdown = processTable($child, $)
      if (tableMarkdown) {
        contentParts.push(tableMarkdown)
      }
      return
    }

    // Handle figures
    if (className.includes('ltx_figure') || tagName === 'figure') {
      const figureMarkdown = processFigure($child, $, seenFigureUrls, figures)
      if (figureMarkdown) {
        contentParts.push(figureMarkdown)
      }
      return
    }

    // Handle theorems, proofs, etc.
    if (className.includes('ltx_theorem') || className.includes('ltx_proof')) {
      const content = processInlineContent($child, $)
      if (content.trim()) {
        contentParts.push(content)
      }
      return
    }

    // Handle equation tables (table.ltx_equation or ltx_equationgroup)
    // Must check BEFORE simple equations since table.ltx_equation has both classes
    if (tagName === 'table' && (className.includes('ltx_equation') || className.includes('ltx_equationgroup') || className.includes('ltx_eqn'))) {
      const eqnParts: string[] = []
      // First try tbody (with or without id)
      const $tbody = $child.find('> tbody')
      if ($tbody.length > 0) {
        $tbody.each((_, tbody) => {
          const $tb = $(tbody)
          const rowLatex: string[] = []
          $tb.find('math').each((_, mathEl) => {
            const latex = extractLatex($(mathEl), $)
            if (latex) {
              rowLatex.push(latex)
            }
          })
          if (rowLatex.length > 0) {
            eqnParts.push(rowLatex.join(' '))
          }
        })
      } else {
        // Fallback: find tr.ltx_eqn_row directly
        $child.find('tr.ltx_eqn_row').each((_, row) => {
          const $row = $(row)
          const rowLatex: string[] = []
          $row.find('math').each((_, mathEl) => {
            const latex = extractLatex($(mathEl), $)
            if (latex) {
              rowLatex.push(latex)
            }
          })
          if (rowLatex.length > 0) {
            eqnParts.push(rowLatex.join(' '))
          }
        })
      }
      if (eqnParts.length > 0) {
        contentParts.push(`$$${eqnParts.join(' \\\\ ')}$$`)
      }
      return
    }

    // Handle simple equations (non-table elements like div.ltx_equation)
    if (tagName !== 'table' && (className.includes('ltx_equation') || className.includes('ltx_eqn'))) {
      const latex = extractLatex($child, $)
      if (latex) {
        contentParts.push(`$$${latex}$$`)
      }
      return
    }

  })

  // Add final section content if not empty or if section header wasn't added yet
  if (contentParts.length > 0) {
    if (sectionHeaderAdded) {
      // Section header already added, append remaining content to it
      const lastSectionWithTitle = sections.filter(s => s.title === title && s.level === level).pop()
      if (lastSectionWithTitle) {
        lastSectionWithTitle.content = lastSectionWithTitle.content
          ? lastSectionWithTitle.content + '\n\n' + contentParts.join('\n\n')
          : contentParts.join('\n\n')
      }
    } else {
      // Section header not added yet, add it with content
      sections.push({
        level,
        title,
        content: contentParts.join('\n\n'),
        id: $section.attr('id')
      })
    }
  } else if (!sectionHeaderAdded) {
    // Add section even if empty (for structure), but only if not already added
    sections.push({
      level,
      title,
      content: '',
      id: $section.attr('id')
    })
  }
}

/**
 * Process a figure element and return markdown
 * Also collects figure metadata for downloading
 * Handles figures with multiple images (e.g., side-by-side panels)
 */
function processFigure(
  $figure: Cheerio,
  $: CheerioAPI,
  seenUrls: Set<string>,
  figures: ArxivFigure[]
): string | null {
  const $caption = $figure.find('.ltx_caption, figcaption')
  const caption = $caption.text().trim()
  const figureId = $figure.attr('id') || `figure-${figures.length + 1}`

  // Find ALL images in the figure (handles multi-panel figures)
  const $images = $figure.find('img')
  if ($images.length === 0) {
    return null
  }

  const markdownParts: string[] = []
  let imageIndex = 0

  $images.each((_, imgEl) => {
    const $img = $(imgEl)
    const imageUrl = $img.attr('src') || $img.attr('data-src') || ''

    // Skip invalid URLs
    if (!imageUrl || imageUrl.startsWith('data:') || imageUrl.includes('placeholder')) {
      return
    }

    // Skip duplicates
    if (seenUrls.has(imageUrl)) {
      return
    }
    seenUrls.add(imageUrl)

    // Generate unique ID for each image in multi-panel figures
    const id = $images.length > 1 ? `${figureId}-${imageIndex + 1}` : figureId
    imageIndex++

    // Collect figure metadata for downloading
    figures.push({
      id,
      imageUrl,
      caption: caption || ''
    })

    // Add markdown for this image
    markdownParts.push(`![${caption || id}](${imageUrl})`)
  })

  if (markdownParts.length === 0) {
    return null
  }

  // Add caption once at the end (for all images)
  if (caption) {
    markdownParts.push(`*${caption}*`)
  }

  // 用双换行分隔，确保每个图片成为独立的段落
  return markdownParts.join('\n\n')
}

/**
 * Process a table element and return markdown
 */
function processTable($tableContainer: Cheerio, $: CheerioAPI): string | null {
  const $caption = $tableContainer.find('.ltx_caption')
  const $tabular = $tableContainer.hasClass('ltx_tabular')
    ? $tableContainer
    : $tableContainer.find('.ltx_tabular')

  const markdown = tableToMarkdown($tabular, $)
  if (!markdown) return null

  const caption = $caption.text().trim()
  const parts: string[] = []

  if (caption) {
    parts.push(`**${caption}**`)
    parts.push('')
  }
  parts.push(markdown)

  return parts.join('\n')
}

/**
 * Convert HTML table to Markdown
 * Handles colspan and rowspan by expanding merged cells
 */
function tableToMarkdown($table: Cheerio, $: CheerioAPI): string {
  // First pass: determine table dimensions and collect cell data
  // Only get direct rows, not nested ones inside cells
  // Try to find rows via tbody first, then thead, then direct children
  let $rows: Cheerio
  const $tbody = $table.find('> tbody, > .ltx_tbody')
  const $thead = $table.find('> thead, > .ltx_thead')

  if ($tbody.length > 0 || $thead.length > 0) {
    // Combine rows from thead and tbody
    const rows: cheerio.Element[] = []
    $thead.find('> tr, > .ltx_tr').each((_, tr) => rows.push(tr))
    $tbody.find('> tr, > .ltx_tr').each((_, tr) => rows.push(tr))
    $rows = $(rows)
  } else {
    // Direct child rows
    $rows = $table.find('> tr, > .ltx_tr')
  }

  if ($rows.length === 0) return ''

  // Calculate maximum columns considering colspan
  // Use direct child cells only to avoid nested table cells
  let maxCols = 0
  $rows.each((_, tr) => {
    let rowCols = 0
    $(tr)
      .find('> td, > th, > .ltx_td')
      .each((_, cell) => {
        const colspan = parseInt($(cell).attr('colspan') || '1', 10)
        rowCols += colspan
      })
    if (rowCols > maxCols) maxCols = rowCols
  })

  // Create a 2D grid to hold cell contents
  // Initialize with null to track which cells are occupied by rowspan
  const grid: (string | null)[][] = []
  const rowCount = $rows.length

  for (let i = 0; i < rowCount; i++) {
    grid.push(new Array(maxCols).fill(null))
  }

  // Second pass: fill in the grid with cell contents
  $rows.each((rowIdx, tr) => {
    let colIdx = 0
    $(tr)
      .find('> td, > th, > .ltx_td')
      .each((_, cell) => {
        const $cell = $(cell)
        const colspan = parseInt($cell.attr('colspan') || '1', 10)
        const rowspan = parseInt($cell.attr('rowspan') || '1', 10)
        const cellContent = processCellContent($cell, $).replace(/\|/g, '\\|').replace(/\n/g, ' ')

        // Find the next available column (skip cells occupied by rowspan from above)
        while (colIdx < maxCols && grid[rowIdx][colIdx] !== null) {
          colIdx++
        }

        // Fill in cells for colspan and rowspan
        for (let r = 0; r < rowspan && rowIdx + r < rowCount; r++) {
          for (let c = 0; c < colspan && colIdx + c < maxCols; c++) {
            if (r === 0 && c === 0) {
              // Primary cell gets the content
              grid[rowIdx + r][colIdx + c] = cellContent
            } else {
              // Spanned cells are empty (Markdown doesn't support merging)
              grid[rowIdx + r][colIdx + c] = ''
            }
          }
        }

        colIdx += colspan
      })

    // Fill any remaining null cells with empty strings
    for (let c = 0; c < maxCols; c++) {
      if (grid[rowIdx][c] === null) {
        grid[rowIdx][c] = ''
      }
    }
  })

  if (grid.length === 0) return ''

  // Build markdown table
  const lines: string[] = []

  // Header row
  lines.push('| ' + grid[0].join(' | ') + ' |')
  // Separator
  lines.push('| ' + Array(maxCols).fill('---').join(' | ') + ' |')
  // Data rows
  for (let i = 1; i < grid.length; i++) {
    lines.push('| ' + grid[i].join(' | ') + ' |')
  }

  return lines.join('\n')
}

/**
 * Process table cell content, preserving math formulas and text formatting
 */
function processCellContent($cell: Cheerio, $: CheerioAPI): string {
  const parts: string[] = []

  function processNode(node: cheerio.Element | cheerio.TextElement): string {
    if (node.type === 'text') {
      return (node as cheerio.TextElement).data || ''
    }

    if (node.type !== 'tag') return ''

    const $node = $(node)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tagName = ((node as any).tagName || (node as any).name || '').toLowerCase()

    // Handle math
    if (tagName === 'math' || $node.hasClass('ltx_Math')) {
      const latex = extractLatex($node, $)
      return latex ? `$${latex}$` : ''
    }

    // Handle bold
    if (tagName === 'strong' || tagName === 'b' || $node.hasClass('ltx_font_bold')) {
      const innerText = $node
        .contents()
        .map((_, child) => processNode(child as cheerio.Element))
        .get()
        .join('')
        .trim()
      return innerText ? `**${innerText}**` : ''
    }

    // Handle italic
    if (tagName === 'em' || tagName === 'i' || $node.hasClass('ltx_font_italic')) {
      const innerText = $node
        .contents()
        .map((_, child) => processNode(child as cheerio.Element))
        .get()
        .join('')
        .trim()
      return innerText ? `*${innerText}*` : ''
    }

    // Handle inner ltx_tabular (nested tables for multi-line text in cells)
    // Extract text content without the table structure
    if ($node.hasClass('ltx_tabular')) {
      const rowTexts: string[] = []
      $node.find('> .ltx_tr, > tbody > .ltx_tr, > tr, > tbody > tr').each((_, innerRow) => {
        const cellTexts: string[] = []
        $(innerRow)
          .find('> .ltx_td, > td')
          .each((_, innerCell) => {
            const cellText = $(innerCell)
              .contents()
              .map((_, c) => processNode(c as cheerio.Element))
              .get()
              .join('')
              .trim()
            if (cellText) cellTexts.push(cellText)
          })
        if (cellTexts.length > 0) rowTexts.push(cellTexts.join(' '))
      })
      return rowTexts.join(' ')
    }

    // Handle span/div - check for math inside or nested table, otherwise process recursively
    if (tagName === 'span' || tagName === 'div') {
      // Check for nested tabular first
      const $innerTabular = $node.find('.ltx_tabular')
      if ($innerTabular.length > 0) {
        return processNode($innerTabular.get(0) as cheerio.Element)
      }
      const $math = $node.find('math, .ltx_Math')
      if ($math.length > 0) {
        const mathParts: string[] = []
        $math.each((_, mathEl) => {
          const latex = extractLatex($(mathEl), $)
          if (latex) {
            mathParts.push(`$${latex}$`)
          }
        })
        return mathParts.join(' ')
      }
      // Process children recursively
      return $node
        .contents()
        .map((_, child) => processNode(child as cheerio.Element))
        .get()
        .join('')
    }

    // Default: process children recursively
    return $node
      .contents()
      .map((_, child) => processNode(child as cheerio.Element))
      .get()
      .join('')
  }

  $cell.contents().each((_, node) => {
    const result = processNode(node as cheerio.Element)
    if (result.trim()) {
      parts.push(result.trim())
    }
  })

  return parts.join(' ').trim()
}

/**
 * Process a list element (ul or ol) and return markdown
 */
function processListElement($list: Cheerio, $: CheerioAPI, tagName: string): string {
  const items: string[] = []

  $list.find('> li, > .ltx_item').each((i, li) => {
    const $li = $(li)
    const prefix = tagName === 'ol' ? `${i + 1}. ` : '- '
    // Skip ltx_tag (bullet/number marker) and get actual content
    const contentParts: string[] = []
    $li.children().each((_, child) => {
      const $child = $(child)
      // Skip the tag/marker span
      if ($child.hasClass('ltx_tag') || $child.hasClass('ltx_tag_item')) {
        return
      }
      // Process the content (usually a div.ltx_para)
      const childContent = processInlineContent($child, $)
      if (childContent.trim()) {
        contentParts.push(childContent.trim())
      }
    })
    if (contentParts.length > 0) {
      items.push(prefix + contentParts.join(' '))
    }
  })

  return items.join('\n')
}

/**
 * Parse references
 */
function parseReferences($: CheerioAPI): ArxivReference[] {
  const references: ArxivReference[] = []

  $('.ltx_bibitem, .ltx_bibblock').each((i, el) => {
    const $el = $(el)
    const id = $el.attr('id') || `ref-${i}`
    const text = $el.text().trim()

    const $link = $el.find('a[href^="http"]').first()
    const url = $link.attr('href')

    if (text) {
      references.push({ id, text, url })
    }
  })

  return references
}

/**
 * Process inline content and convert to Markdown
 */
function processInlineContent($el: Cheerio, $: CheerioAPI): string {
  const parts: string[] = []

  function processNode(node: cheerio.Element | cheerio.TextElement): string {
    if (node.type === 'text') {
      return (node as cheerio.TextElement).data || ''
    }

    if (node.type !== 'tag') return ''

    const $node = $(node)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tagName = ((node as any).tagName || (node as any).name || '')?.toLowerCase()

    switch (tagName) {
      case 'math': {
        const latex = extractLatex($node, $)
        const display = $node.attr('display') === 'block' || $node.hasClass('ltx_displaymath')
        return display ? `$$${latex}$$` : `$${latex}$`
      }

      case 'span':
      case 'div': {
        if ($node.hasClass('ltx_Math') || $node.hasClass('ltx_equation')) {
          const latex = extractLatex($node, $)
          return `$${latex}$`
        }
        if ($node.hasClass('ltx_displaymath') || $node.hasClass('ltx_eqn_cell')) {
          const latex = extractLatex($node, $)
          return `$$${latex}$$`
        }
        // Handle equation groups (span/div with ltx_equationgroup or ltx_eqn_table)
        if ($node.hasClass('ltx_equationgroup') || $node.hasClass('ltx_eqn_table')) {
          const eqnParts: string[] = []
          $node.find('.ltx_eqn_row').each((_, row) => {
            const $row = $(row)
            const rowLatex: string[] = []
            $row.find('math').each((_, mathEl) => {
              const latex = extractLatex($(mathEl), $)
              if (latex) {
                rowLatex.push(latex)
              }
            })
            if (rowLatex.length > 0) {
              eqnParts.push(rowLatex.join(' '))
            }
          })
          if (eqnParts.length > 0) {
            return '$$\n' + eqnParts.join(' \\\\\n') + '\n$$'
          }
        }
        // Handle bold class
        if ($node.hasClass('ltx_font_bold')) {
          const innerText = $node
            .contents()
            .map((_, child) => processNode(child as cheerio.Element))
            .get()
            .join('')
            .trim()
          return innerText ? `**${innerText}**` : ''
        }
        // Handle italic class
        if ($node.hasClass('ltx_font_italic')) {
          const innerText = $node
            .contents()
            .map((_, child) => processNode(child as cheerio.Element))
            .get()
            .join('')
            .trim()
          return innerText ? `*${innerText}*` : ''
        }
        return $node
          .contents()
          .map((_, child) => processNode(child as cheerio.Element))
          .get()
          .join('')
      }

      case 'a': {
        const href = $node.attr('href') || ''
        const text = $node.text().trim()
        if (href.startsWith('#')) return text
        return href ? `[${text}](${href})` : text
      }

      case 'em':
      case 'i':
      case 'cite': {
        const text = $node.text().trim()
        return text ? `*${text}*` : ''
      }

      case 'strong':
      case 'b': {
        const text = $node.text().trim()
        return text ? `**${text}**` : ''
      }

      case 'code':
      case 'tt': {
        const text = $node.text().trim()
        return text ? `\`${text}\`` : ''
      }

      case 'br':
        return '\n'

      case 'table': {
        // Handle equation tables (ltx_equationgroup, ltx_eqn_table, etc.)
        if (
          $node.hasClass('ltx_equationgroup') ||
          $node.hasClass('ltx_eqn_table') ||
          $node.hasClass('ltx_equation')
        ) {
          const eqnParts: string[] = []
          $node.find('tr.ltx_eqn_row, tr.ltx_equation').each((_, row) => {
            const $row = $(row)
            const rowLatex: string[] = []
            $row.find('math').each((_, mathEl) => {
              const latex = extractLatex($(mathEl), $)
              if (latex) {
                rowLatex.push(latex)
              }
            })
            if (rowLatex.length > 0) {
              eqnParts.push(rowLatex.join(' '))
            }
          })
          if (eqnParts.length > 0) {
            return '$$\n' + eqnParts.join(' \\\\\n') + '\n$$'
          }
        }
        // For other tables, recursively process
        return $node
          .contents()
          .map((_, child) => processNode(child as cheerio.Element))
          .get()
          .join('')
      }

      case 'sup':
        return `^${$node.text().trim()}^`

      case 'sub':
        return `~${$node.text().trim()}~`

      case 'ul':
      case 'ol': {
        // Use dedicated list processor to avoid extra newlines
        return processListElement($node, $, tagName)
      }

      case 'li':
      case 'p': {
        return (
          $node
            .contents()
            .map((_, child) => processNode(child as cheerio.Element))
            .get()
            .join('') + '\n'
        )
      }

      case 'blockquote': {
        const content = $node
          .contents()
          .map((_, child) => processNode(child as cheerio.Element))
          .get()
          .join('')
          .trim()
        return (
          '\n' +
          content
            .split('\n')
            .map((line) => '> ' + line)
            .join('\n') +
          '\n'
        )
      }

      case 'script':
      case 'style':
      case 'noscript':
        return ''

      default: {
        return $node
          .contents()
          .map((_, child) => processNode(child as cheerio.Element))
          .get()
          .join('')
      }
    }
  }

  $el.contents().each((_, node) => {
    const result = processNode(node as cheerio.Element)
    if (result) parts.push(result)
  })

  // Normalize whitespace: collapse multiple newlines into single newline
  return parts.join('').replace(/\n{2,}/g, '\n').trim()
}

/**
 * Extract LaTeX from MathML or annotation
 */
function extractLatex($el: Cheerio, _$: CheerioAPI): string {
  const annotation = $el.find('annotation[encoding*="tex"], annotation[encoding*="latex"]').text()
  if (annotation) return annotation.trim()

  const alttext = $el.attr('alttext')
  if (alttext) return alttext.trim()

  const dataLatex = $el.attr('data-latex')
  if (dataLatex) return dataLatex.trim()

  let text = $el.text().trim()
  text = text.replace(/\s+/g, ' ')
  return text
}

/**
 * Clean section title (keep numbering, just trim whitespace)
 */
function cleanTitle(title: string): string {
  return title.trim()
}

/**
 * Extract abstract from HTML if not in metadata
 */
export function extractAbstract($: CheerioAPI): string {
  const $abstract = $('.ltx_abstract')
  if ($abstract.length === 0) return ''

  const $content = $abstract.find('.ltx_p, p')
  if ($content.length > 0) {
    return $content
      .map((_, p) => $(p).text().trim())
      .get()
      .join('\n\n')
  }

  let text = $abstract.text()
  text = text.replace(/^Abstract\.?\s*/i, '').trim()
  return text
}
