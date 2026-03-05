/**
 * arXiv Importer
 *
 * Imports papers from arXiv, prioritizing HTML format with PDF fallback.
 */

import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join, extname } from 'path'
import { app } from 'electron'
import { addNote, getNotebooks } from '../../database'
import { markdownToTiptapString } from '../../markdown'
import { copyAttachmentsAndUpdateContent } from '../utils/attachment-handler'
import { pdfImporter } from '../importers/pdf-importer'
import { getServiceConfig } from '../pdf-config'
import { indexingService } from '../../embedding/indexing-service'
import { getEmbeddingConfig } from '../../embedding/database'
import {
  parseArxivInput,
  fetchMetadata,
  fetchHtml,
  fetchPdf,
  downloadImage
} from './arxiv-fetcher'
import { parseArxivHtml } from './arxiv-parser'
import { prependMarkdownToTiptapContent } from './tiptap-utils'
import type {
  ArxivImportOptions,
  ArxivInlineImportOptions,
  ArxivImportResult,
  ArxivPaperResult,
  ArxivPaperProgress,
  ArxivBatchProgress,
  ArxivMetadata,
  ArxivHtmlContent,
  ArxivFigure
} from './types'

/**
 * ArXiv Importer Class
 */
export class ArxivImporter {
  private abortController: AbortController | null = null
  private tempDir: string | null = null

  private static readonly CODE_MARKER_LINE_RE = /^(?:\{Code(?:Chunk|Input|Output)?\}\s*)+$/
  private static readonly PROMPT_LINE_RE = /^\s*(?:>>>|\.\.\.|…)\s?/
  private static readonly SHELL_PROMPT_LINE_RE = /^\s*>\s?/
  private static readonly IMAGE_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'
  ])

  /**
   * Import multiple arXiv papers
   */
  async import(
    options: ArxivImportOptions,
    onProgress?: (progress: ArxivBatchProgress) => void
  ): Promise<ArxivImportResult> {
    this.abortController = new AbortController()
    const results: ArxivPaperResult[] = []

    for (let i = 0; i < options.inputs.length; i++) {
      const input = options.inputs[i]

      // Check for abort
      if (this.abortController.signal.aborted) {
        results.push({
          input,
          error: 'Cancelled',
          source: 'html'
        })
        continue
      }

      try {
        const result = await this.importSingle(input, options, (progress) => {
          onProgress?.({
            current: i + 1,
            total: options.inputs.length,
            currentPaper: progress
          })
        })
        results.push(result)
      } catch (error) {
        results.push({
          input,
          error: error instanceof Error ? error.message : String(error),
          source: 'html'
        })
      }
    }

    // Cleanup
    this.cleanup()

    return {
      success: results.some((r) => r.noteId),
      imported: results.filter((r) => r.noteId).length,
      failed: results.filter((r) => r.error).length,
      results
    }
  }

  /**
   * Import a single paper
   */
  private async importSingle(
    input: string,
    options: ArxivImportOptions,
    onProgress?: (progress: ArxivPaperProgress) => void
  ): Promise<ArxivPaperResult> {
    const signal = this.abortController?.signal

    // 1. Parse input
    const parsed = parseArxivInput(input)
    if (!parsed) {
      throw new Error(`Invalid arXiv ID or URL: ${input}`)
    }
    const { id, version } = parsed

    // 2. Fetch metadata
    onProgress?.({
      paperId: id,
      stage: 'fetching_metadata',
      message: 'Fetching metadata...',
      percent: 10
    })
    const metadata = await fetchMetadata(id, version, signal)

    // 3. Try HTML import
    if (options.preferHtml !== false) {
      onProgress?.({
        paperId: id,
        stage: 'fetching_html',
        message: 'Fetching HTML...',
        percent: 20
      })

      const htmlResult = await fetchHtml(id, version, signal)

      if (htmlResult) {
        try {
          // 4. Parse HTML
          onProgress?.({
            paperId: id,
            stage: 'parsing',
            message: 'Parsing HTML...',
            percent: 40
          })
          const content = parseArxivHtml(htmlResult.html)

          // 5. Download figures
          let figures = content.figures
          if (options.downloadFigures !== false && figures.length > 0) {
            onProgress?.({
              paperId: id,
              stage: 'downloading_images',
              message: `Downloading ${figures.length} images...`,
              percent: 60
            })
            figures = await this.downloadFigures(figures, htmlResult.baseUrl, signal)
          }

          // 6. Convert to note
          onProgress?.({
            paperId: id,
            stage: 'converting',
            message: 'Converting to note...',
            percent: 80
          })
          const markdown = this.contentToMarkdown(metadata, { ...content, figures }, options)
          const tiptapContent = markdownToTiptapString(markdown)

          // 7. Create note
          const noteId = await this.createNote(
            metadata.title,
            tiptapContent,
            figures,
            options.notebookId,
            options.buildEmbedding
          )

          onProgress?.({
            paperId: id,
            stage: 'done',
            message: 'Done',
            percent: 100
          })

          return {
            input,
            noteId,
            title: metadata.title,
            source: 'html'
          }
        } catch (htmlError) {
          console.warn(`[ArXiv] HTML parsing failed for ${id}, falling back to PDF:`, htmlError)
          // Fall through to PDF
        }
      }
    }

    // 8. Fallback to PDF
    onProgress?.({
      paperId: id,
      stage: 'fallback_pdf',
      message: 'Falling back to PDF...',
      percent: 50
    })

    return await this.importViaPdf(id, version, metadata, options, onProgress)
  }

  /**
   * Import via PDF (fallback path)
   */
  private async importViaPdf(
    id: string,
    version: number | undefined,
    metadata: ArxivMetadata,
    options: ArxivImportOptions,
    onProgress?: (progress: ArxivPaperProgress) => void
  ): Promise<ArxivPaperResult> {
    const signal = this.abortController?.signal

    // Check if PDF service is configured
    const serviceConfig = getServiceConfig('textin')
    if (!serviceConfig) {
      throw new Error('PDF service not configured. Please configure TextIn API first.')
    }

    // Download PDF
    onProgress?.({
      paperId: id,
      stage: 'fallback_pdf',
      message: 'Downloading PDF...',
      percent: 55
    })
    const pdfBuffer = await fetchPdf(id, version, signal)

    // Save to temp file
    const tempPdfDir = join(app.getPath('temp'), 'sanqian-arxiv-pdf', Date.now().toString())
    mkdirSync(tempPdfDir, { recursive: true })
    const tempPdfPath = join(tempPdfDir, `${id.replace('/', '_')}.pdf`)
    writeFileSync(tempPdfPath, pdfBuffer)

    try {
      // Configure PDF importer
      pdfImporter.setRuntimeConfig({
        serviceId: 'textin',
        serviceConfig,
        onProgress: (pdfProgress) => {
          // Map PDF progress to our progress
          const percentMap: Record<string, number> = {
            uploading: 60,
            parsing: 70,
            extracting: 80,
            converting: 90
          }
          onProgress?.({
            paperId: id,
            stage: 'fallback_pdf',
            message: pdfProgress.message,
            percent: percentMap[pdfProgress.stage] || 75
          })
        },
        abortSignal: signal
      })

      // Parse PDF
      const parsedNotes = await pdfImporter.parse({
        sourcePath: tempPdfPath,
        importAttachments: true,
        folderStrategy: 'first-level',
        tagStrategy: 'keep-nested',
        conflictStrategy: 'rename',
        parseFrontMatter: false
      })

      if (parsedNotes.length === 0) {
        throw new Error('PDF parsing returned no content')
      }

      const parsedNote = parsedNotes[0]

      // Add metadata header to parsed TipTap content
      const metadataMarkdown = this.generateMetadataHeader(metadata)
      const tiptapContent = prependMarkdownToTiptapContent(metadataMarkdown, parsedNote.content)

      // Create note with attachments
      const noteId = await this.createNoteWithAttachments(
        metadata.title,
        tiptapContent,
        parsedNote.attachments,
        options.notebookId,
        options.buildEmbedding
      )

      onProgress?.({
        paperId: id,
        stage: 'done',
        message: 'Done',
        percent: 100
      })

      return {
        input: id,
        noteId,
        title: metadata.title,
        source: 'pdf'
      }
    } finally {
      // Cleanup temp PDF
      pdfImporter.cleanup()
      if (existsSync(tempPdfDir)) {
        rmSync(tempPdfDir, { recursive: true, force: true })
      }
    }
  }

  /**
   * Download figures and save to temp directory
   */
  private async downloadFigures(
    figures: ArxivFigure[],
    baseUrl: string,
    signal?: AbortSignal
  ): Promise<ArxivFigure[]> {
    this.tempDir = join(app.getPath('temp'), 'sanqian-arxiv-images', Date.now().toString())
    mkdirSync(this.tempDir, { recursive: true })

    const updatedFigures: ArxivFigure[] = []

    for (const figure of figures) {
      if (signal?.aborted) break

      try {
        const { buffer, contentType } = await downloadImage(figure.imageUrl, baseUrl, signal)

        const ext = this.resolveFigureImageExtension(contentType, figure.imageUrl, buffer)

        const filename = `${figure.id}${ext}`
        const localPath = join(this.tempDir, filename)
        writeFileSync(localPath, buffer)

        updatedFigures.push({
          ...figure,
          localPath
        })
      } catch (error) {
        console.warn(`[ArXiv] Failed to download image ${figure.id}:`, error)
        // Keep figure without local path
        updatedFigures.push(figure)
      }
    }

    return updatedFigures
  }

  private resolveFigureImageExtension(contentType: string, imageUrl: string, buffer: Buffer): string {
    const normalizedType = contentType.split(';', 1)[0].trim().toLowerCase()
    const extByType: Record<string, string> = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'image/svg+xml': '.svg',
      'image/bmp': '.bmp',
    }
    if (extByType[normalizedType]) {
      return extByType[normalizedType]
    }

    const urlPath = imageUrl.split(/[?#]/, 1)[0]
    const extByUrl = extname(urlPath).toLowerCase()
    if (ArxivImporter.IMAGE_EXTENSIONS.has(extByUrl)) {
      return extByUrl
    }

    const extByMagic = this.detectImageExtensionFromBuffer(buffer)
    return extByMagic || '.png'
  }

  private detectImageExtensionFromBuffer(buffer: Buffer): string | null {
    if (buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a) {
      return '.png'
    }
    if (buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff) {
      return '.jpg'
    }
    if (buffer.length >= 6) {
      const header6 = buffer.subarray(0, 6).toString('ascii')
      if (header6 === 'GIF87a' || header6 === 'GIF89a') {
        return '.gif'
      }
    }
    if (buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
      return '.webp'
    }
    if (buffer.length >= 2 &&
      buffer[0] === 0x42 &&
      buffer[1] === 0x4d) {
      return '.bmp'
    }

    const textHead = buffer.subarray(0, Math.min(buffer.length, 1024)).toString('utf-8').toLowerCase()
    if (textHead.includes('<svg')) {
      return '.svg'
    }

    return null
  }

  /**
   * Convert parsed content to Markdown
   * Figures and tables are already inline in section content
   */
  private contentToMarkdown(
    metadata: ArxivMetadata,
    content: ArxivHtmlContent,
    options: ArxivImportOptions
  ): string {
    const parts: string[] = []

    // Metadata header
    parts.push(this.generateMetadataHeader(metadata))

    // Abstract
    if (options.includeAbstract !== false && metadata.abstract) {
      parts.push('## Abstract')
      parts.push('')
      parts.push(metadata.abstract)
      parts.push('')
    }

    // Sections (figures and tables are already inline)
    for (const section of content.sections) {
      // Only add heading if title is not empty
      if (section.title) {
        const heading = '#'.repeat(section.level + 1) // ## for level 1
        parts.push(`${heading} ${section.title}`)
        parts.push('')
      }
      if (section.content) {
        // Replace remote image URLs with local paths
        let sectionContent = section.content
        for (const figure of content.figures) {
          if (figure.localPath) {
            // Replace remote URL with local path
            sectionContent = sectionContent.replace(
              `](${figure.imageUrl})`,
              `](${figure.localPath})`
            )
          }
        }
        sectionContent = this.normalizeSectionContent(sectionContent)
        parts.push(sectionContent)
        parts.push('')
      }
    }

    // References
    if (options.includeReferences && content.references.length > 0) {
      parts.push('## References')
      parts.push('')
      for (const ref of content.references) {
        parts.push(`- ${ref.text}`)
      }
      parts.push('')
    }

    return parts.join('\n')
  }

  /**
   * Normalize arXiv HTML parser artifacts in section markdown:
   * - Convert code markers ({Code}, {CodeChunk}, {CodeInput}, {CodeOutput}) into fenced code blocks
   * - Convert prompt-style lines (>>> / ... / … / >) to plain code lines
   * - Remove ltx_ERROR macro artifacts (\proglang, \pkg, \code, etc.)
   */
  private normalizeSectionContent(sectionContent: string): string {
    const lines = sectionContent.replace(/\r\n?/g, '\n').split('\n')
    const output: string[] = []

    const stripPromptPrefix = (line: string): string =>
      line
        .replace(ArxivImporter.PROMPT_LINE_RE, '')
        .replace(ArxivImporter.SHELL_PROMPT_LINE_RE, '')

    const normalizeInlineArtifacts = (line: string): string => {
      return line
        .replace(/\{Code(?:Chunk|Input|Output)?\}/g, '')
        .replace(/\\(?:Plaintitle|Shorttitle|Abstract|Keywords|Plainkeywords|Address)\b/g, '')
        .replace(/\\proglang([A-Za-z][\w-]*)/g, '$1')
        .replace(/\\pkg([A-Za-z_][\w.-]*)/g, '$1')
        .replace(/\\code\(([^)\n]+)\)/g, '`($1)`')
        .replace(/\\code[‘']([^’'\n]+)[’']/g, '`$1`')
        .replace(/\\code([A-Za-z_][\w.:-]*\(\))/g, '`$1`')
        .replace(/\\code([A-Za-z_][\w.:-]*)/g, '`$1`')
        .replace(/\\(?:proglang|pkg|code)\b/g, '')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\s+([,.;:!?])/g, '$1')
        .trimEnd()
    }

    const collectPromptBlock = (
      startIndex: number
    ): { codeLines: string[]; nextIndex: number } => {
      const codeLines: string[] = []
      let index = startIndex

      while (index < lines.length) {
        const line = lines[index]
        if (ArxivImporter.PROMPT_LINE_RE.test(line)) {
          codeLines.push(stripPromptPrefix(line))
          index += 1
          continue
        }
        if (line.trim() === '' && codeLines.length > 0) {
          codeLines.push('')
          index += 1
          continue
        }
        break
      }

      while (codeLines.length > 0 && codeLines[codeLines.length - 1] === '') {
        codeLines.pop()
      }

      return { codeLines, nextIndex: index }
    }

    const collectCodeChunkBlock = (
      startIndex: number
    ): { codeLines: string[]; nextIndex: number } => {
      const codeLines: string[] = []
      let index = startIndex

      const looksLikeCodeLine = (rawLine: string): boolean => {
        const trimmed = rawLine.trim()
        if (!trimmed) return false
        if (ArxivImporter.PROMPT_LINE_RE.test(rawLine) || ArxivImporter.SHELL_PROMPT_LINE_RE.test(rawLine)) {
          return true
        }
        if (/^(?:from|import|def|class|for|while|if|elif|else|return|print|pip|python|conda|npm|pnpm|yarn|uv|git|cargo)\b/.test(trimmed)) {
          return true
        }
        if (/^[\[(]?[A-Za-z_][\w.-]*\s*=/.test(trimmed)) {
          return true
        }
        if (/^[A-Za-z_][\w.:-]*\(.*\)$/.test(trimmed)) {
          return true
        }
        if (/^[#$]/.test(trimmed)) {
          return true
        }
        if (/^(?:\[[^\]]+\]|\.\.\.|…)/.test(trimmed)) {
          return true
        }
        return false
      }

      while (index < lines.length) {
        const line = lines[index]
        const trimmed = line.trim()
        if (!trimmed) {
          if (codeLines.length === 0) {
            index += 1
            continue
          }
          break
        }
        if (ArxivImporter.CODE_MARKER_LINE_RE.test(trimmed)) {
          index += 1
          continue
        }
        if (codeLines.length === 0 && !looksLikeCodeLine(line)) {
          // This marker is not followed by a code-looking line; treat it as noise only.
          return { codeLines: [], nextIndex: index }
        }
        codeLines.push(stripPromptPrefix(line))
        index += 1
      }

      while (codeLines.length > 0 && codeLines[codeLines.length - 1] === '') {
        codeLines.pop()
      }

      return { codeLines, nextIndex: index }
    }

    const inferCodeLanguage = (codeLines: string[]): string => {
      const first = codeLines.find((line) => line.trim())?.trim() || ''
      if (/^(?:pip|python|conda|mamba|brew|apt|npm|pnpm|yarn|uv|git|cargo)\b/.test(first)) {
        return 'bash'
      }
      return 'python'
    }

    const pushCodeBlock = (codeLines: string[], language = 'python') => {
      if (codeLines.length === 0) return
      if (output.length > 0 && output[output.length - 1] !== '') {
        output.push('')
      }
      output.push(`\`\`\`${language}`)
      output.push(...codeLines)
      output.push('```')
      output.push('')
    }

    for (let i = 0; i < lines.length;) {
      const line = lines[i]
      const trimmed = line.trim()

      if (ArxivImporter.CODE_MARKER_LINE_RE.test(trimmed)) {
        const { codeLines, nextIndex } = collectCodeChunkBlock(i + 1)
        pushCodeBlock(codeLines, inferCodeLanguage(codeLines))
        i = nextIndex
        continue
      }

      if (ArxivImporter.PROMPT_LINE_RE.test(line)) {
        const { codeLines, nextIndex } = collectPromptBlock(i)
        pushCodeBlock(codeLines)
        i = nextIndex
        continue
      }

      output.push(normalizeInlineArtifacts(line))
      i += 1
    }

    return output
      .join('\n')
      // ltx_ERROR can break ordered/bullet list items into two lines:
      // "1. \\code" + "datasets: ..."
      .replace(/^(\s*\d+\.)\s*\n([A-Za-z_][\w.-]*)(:.*)$/gm, '$1 `$2`$3')
      .replace(/^(\s*[-*+])\s*\n([A-Za-z_][\w.-]*)(:.*)$/gm, '$1 `$2`$3')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  /**
   * Generate metadata header markdown
   */
  private generateMetadataHeader(metadata: ArxivMetadata): string {
    const parts: string[] = []

    parts.push(`# ${metadata.title}`)
    parts.push('')
    parts.push(`**Authors:** ${metadata.authors.join(', ')}`)
    parts.push('')
    parts.push(`**arXiv:** [${metadata.id}](https://arxiv.org/abs/${metadata.id})`)

    if (metadata.categories.length > 0) {
      parts.push(`**Categories:** ${metadata.categories.join(', ')}`)
    }

    if (metadata.publishedDate) {
      parts.push(`**Published:** ${metadata.publishedDate}`)
    }

    if (metadata.doi) {
      parts.push(`**DOI:** [${metadata.doi}](https://doi.org/${metadata.doi})`)
    }

    parts.push('')

    return parts.join('\n')
  }

  /**
   * Create note in database
   */
  private async createNote(
    title: string,
    content: string,
    figures: ArxivFigure[],
    notebookId?: string,
    buildEmbedding?: boolean
  ): Promise<string> {
    // Resolve notebook
    let resolvedNotebookId = notebookId
    if (notebookId) {
      const notebooks = getNotebooks()
      const exists = notebooks.some((nb) => nb.id === notebookId)
      if (!exists) {
        resolvedNotebookId = undefined
      }
    }

    // Prepare attachments
    const attachments = figures
      .filter((f) => f.localPath)
      .map((f) => ({
        originalRef: `![${f.caption || f.id}](${f.localPath})`,
        sourcePath: f.localPath!
      }))

    // Process attachments
    let finalContent = content
    if (attachments.length > 0) {
      const result = await copyAttachmentsAndUpdateContent(finalContent, attachments)
      finalContent = result.updatedContent
    }

    // Create note
    const note = addNote({
      title,
      content: finalContent,
      notebook_id: resolvedNotebookId || null,
      is_pinned: false,
      is_favorite: false
    })

    // Build search index
    await this.buildIndex(note.id, resolvedNotebookId || '', finalContent, buildEmbedding)

    return note.id
  }

  /**
   * Create note with attachments from PDF import
   */
  private async createNoteWithAttachments(
    title: string,
    content: string,
    attachments: Array<{ originalRef: string; sourcePath: string }>,
    notebookId?: string,
    buildEmbedding?: boolean
  ): Promise<string> {
    // Resolve notebook
    let resolvedNotebookId = notebookId
    if (notebookId) {
      const notebooks = getNotebooks()
      const exists = notebooks.some((nb) => nb.id === notebookId)
      if (!exists) {
        resolvedNotebookId = undefined
      }
    }

    // Process attachments
    let finalContent = content
    if (attachments.length > 0) {
      const result = await copyAttachmentsAndUpdateContent(finalContent, attachments)
      finalContent = result.updatedContent
    }

    // Create note
    const note = addNote({
      title,
      content: finalContent,
      notebook_id: resolvedNotebookId || null,
      is_pinned: false,
      is_favorite: false
    })

    // Build search index
    await this.buildIndex(note.id, resolvedNotebookId || '', finalContent, buildEmbedding)

    return note.id
  }

  /**
   * Build search index for a note
   */
  private async buildIndex(
    noteId: string,
    notebookId: string,
    content: string,
    buildEmbedding?: boolean
  ): Promise<void> {
    try {
      const embeddingConfig = getEmbeddingConfig()
      const shouldBuildEmbedding = buildEmbedding && embeddingConfig.enabled

      if (shouldBuildEmbedding) {
        // FTS + Embedding
        await indexingService.indexNoteFull(noteId, notebookId, content)
      } else {
        // FTS only
        await indexingService.indexNoteFtsOnly(noteId, notebookId, content)
      }
    } catch (error) {
      // Indexing failure doesn't affect note creation
      console.error(`[ArXiv] Failed to build index for note ${noteId}:`, error)
    }
  }

  /**
   * Fetch arXiv paper as TipTap JSON (without creating a note)
   * Used for inline import at cursor position
   */
  async fetchAsTiptap(
    input: string,
    onPdfProgress?: (progress: { stage: string; message: string }) => void,
    options?: ArxivInlineImportOptions
  ): Promise<{ content: string; title: string }> {
    this.abortController = new AbortController()
    const signal = this.abortController.signal
    const resolvedOptions: Required<ArxivInlineImportOptions> = {
      includeAbstract: options?.includeAbstract !== false,
      includeReferences: options?.includeReferences ?? false,
      downloadFigures: options?.downloadFigures !== false,
      preferHtml: options?.preferHtml !== false,
    }

    try {
      // 1. Parse input
      const parsed = parseArxivInput(input)
      if (!parsed) {
        throw new Error(`Invalid arXiv ID or URL: ${input}`)
      }
      const { id, version } = parsed

      // 2. Fetch metadata
      const metadata = await fetchMetadata(id, version, signal)

      // 3. Try HTML import
      const htmlResult = resolvedOptions.preferHtml ? await fetchHtml(id, version, signal) : null

      if (htmlResult) {
        try {
          // 4. Parse HTML
          const content = parseArxivHtml(htmlResult.html)

          // 5. Download figures
          let figures = content.figures
          if (resolvedOptions.downloadFigures && figures.length > 0) {
            figures = await this.downloadFigures(figures, htmlResult.baseUrl, signal)
          }

          // 6. Convert to markdown (with local image paths)
          const markdown = this.contentToMarkdown(
            metadata,
            { ...content, figures },
            {
              inputs: [],
              includeAbstract: resolvedOptions.includeAbstract,
              includeReferences: resolvedOptions.includeReferences,
              downloadFigures: resolvedOptions.downloadFigures,
              preferHtml: resolvedOptions.preferHtml,
            }
          )
          let tiptapContent = markdownToTiptapString(markdown)

          // 7. Copy images to attachments directory and update paths in TipTap JSON
          const attachments = figures
            .filter((f) => f.localPath)
            .map((f) => ({
              originalRef: `![${f.caption || f.id}](${f.localPath})`,
              sourcePath: f.localPath!,
            }))

          if (attachments.length > 0) {
            const copyResult = await copyAttachmentsAndUpdateContent(tiptapContent, attachments)
            tiptapContent = copyResult.updatedContent
          }

          return { content: tiptapContent, title: metadata.title }
        } catch (htmlError) {
          console.warn(`[ArXiv] HTML parsing failed for ${id}, falling back to PDF:`, htmlError)
          // Fall through to PDF
        }
      }

      // 8. Fallback to PDF
      return await this.fetchAsTiptapViaPdf(id, version, metadata, onPdfProgress)
    } catch (error) {
      console.error('[ArXiv] fetchAsTiptap failed:', error)
      // Re-throw with more context for better error messages
      throw error
    } finally {
      this.cleanup()
    }
  }

  /**
   * Fetch as TipTap JSON via PDF (fallback path)
   */
  private async fetchAsTiptapViaPdf(
    id: string,
    version: number | undefined,
    metadata: ArxivMetadata,
    onPdfProgress?: (progress: { stage: string; message: string }) => void
  ): Promise<{ content: string; title: string }> {
    const signal = this.abortController?.signal

    // Check if PDF service is configured
    const serviceConfig = getServiceConfig('textin')
    if (!serviceConfig) {
      throw new Error('PDF service not configured. Please configure TextIn API first.')
    }

    // Download PDF
    onPdfProgress?.({ stage: 'downloading', message: 'Downloading PDF...' })
    const pdfBuffer = await fetchPdf(id, version, signal)

    // Save to temp file
    const tempPdfDir = join(app.getPath('temp'), 'sanqian-arxiv-pdf', Date.now().toString())
    mkdirSync(tempPdfDir, { recursive: true })
    const tempPdfPath = join(tempPdfDir, `${id.replace('/', '_')}.pdf`)
    writeFileSync(tempPdfPath, pdfBuffer)

    try {
      // Configure PDF importer
      pdfImporter.setRuntimeConfig({
        serviceId: 'textin',
        serviceConfig,
        onProgress: onPdfProgress,
        abortSignal: signal
      })

      // Parse PDF to TipTap content with image attachments resolved
      const parseResult = await pdfImporter.parseFileToTiptap(tempPdfPath)

      // Add metadata header to parsed TipTap content
      const metadataMarkdown = this.generateMetadataHeader(metadata)
      const content = prependMarkdownToTiptapContent(metadataMarkdown, parseResult.content)

      return { content, title: metadata.title }
    } finally {
      pdfImporter.cleanup()
      if (existsSync(tempPdfDir)) {
        rmSync(tempPdfDir, { recursive: true, force: true })
      }
    }
  }

  /**
   * Cancel ongoing import
   */
  cancel(): void {
    this.abortController?.abort()
  }

  /**
   * Cleanup temporary resources
   */
  cleanup(): void {
    this.abortController = null
    if (this.tempDir && existsSync(this.tempDir)) {
      rmSync(this.tempDir, { recursive: true, force: true })
      this.tempDir = null
    }
  }
}

// Export singleton
export const arxivImporter = new ArxivImporter()
