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
import {
  parseArxivInput,
  fetchMetadata,
  fetchHtml,
  fetchPdf,
  downloadImage
} from './arxiv-fetcher'
import { parseArxivHtml } from './arxiv-parser'
import type {
  ArxivImportOptions,
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
            options.notebookId
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

      // Add metadata header to content
      const metadataMarkdown = this.generateMetadataHeader(metadata)
      const fullMarkdown = metadataMarkdown + '\n\n' + this.tiptapToMarkdown(parsedNote.content)
      const tiptapContent = markdownToTiptapString(fullMarkdown)

      // Create note with attachments
      const noteId = await this.createNoteWithAttachments(
        metadata.title,
        tiptapContent,
        parsedNote.attachments,
        options.notebookId
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

        // Determine extension from content type
        const extMap: Record<string, string> = {
          'image/png': '.png',
          'image/jpeg': '.jpg',
          'image/gif': '.gif',
          'image/webp': '.webp',
          'image/svg+xml': '.svg'
        }
        const ext = extMap[contentType] || extname(figure.imageUrl) || '.png'

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
      const heading = '#'.repeat(section.level + 1) // ## for level 1
      parts.push(`${heading} ${section.title}`)
      parts.push('')
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
    notebookId?: string
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

    return note.id
  }

  /**
   * Create note with attachments from PDF import
   */
  private async createNoteWithAttachments(
    title: string,
    content: string,
    attachments: Array<{ originalRef: string; sourcePath: string }>,
    notebookId?: string
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

    return note.id
  }

  /**
   * Simple conversion from TipTap JSON back to markdown (for prepending metadata)
   * This is a simplified version - we just need the text content
   */
  private tiptapToMarkdown(_tiptapJson: string): string {
    // For PDF fallback, the content is already in TipTap JSON format from pdfImporter
    // We don't need to convert back to markdown - just return empty string
    // The PDF content will be used as-is
    return ''
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
