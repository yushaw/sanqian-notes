import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArxivImporter } from '../arxiv-importer'

vi.mock('../../pdf-config', () => ({
  getServiceConfig: vi.fn(() => ({
    appId: 'test-app-id',
    secretCode: 'test-secret-code',
  })),
}))

function toUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function collectImageSrcs(node: unknown): string[] {
  if (!node || typeof node !== 'object') return []
  const current = node as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] }
  const currentSrc =
    current.type === 'image' && typeof current.attrs?.src === 'string' ? [current.attrs.src] : []
  const children = Array.isArray(current.content)
    ? current.content.flatMap((child) => collectImageSrcs(child))
    : []
  return [...currentSrc, ...children]
}

function collectText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const current = node as { text?: string; content?: unknown[] }
  const text = current.text || ''
  const children = Array.isArray(current.content) ? current.content.map(collectText).join('') : ''
  return text + children
}

function buildAbsPageHtml(id: string): string {
  return `
  <html>
    <head>
      <meta name="citation_title" content="Paper ${id}" />
      <meta name="citation_author" content="Alice" />
      <meta name="citation_author" content="Bob" />
      <meta name="citation_date" content="2026-02-20" />
    </head>
    <body>
      <blockquote class="abstract"><span class="descriptor">Abstract:</span> Test abstract</blockquote>
      <a href="/html/${id}">View HTML</a>
      <td class="tablecell subjects"><span class="primary-subject">cs.AI</span></td>
    </body>
  </html>
  `
}

function buildArxivHtmlWithFigure(): string {
  return `
  <article class="ltx_document">
    <section class="ltx_section" id="S1">
      <h2 class="ltx_title">Introduction</h2>
      <div class="ltx_para">
        <p class="ltx_p">Hello from HTML path.</p>
      </div>
      <figure class="ltx_figure" id="F1">
        <img src="assets/fig1.png" />
        <figcaption class="ltx_caption">Figure One</figcaption>
      </figure>
    </section>
  </article>
  `
}

const pngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mP8/5+hHgAHggJ/Pw9u4wAAAABJRU5ErkJggg=='

describe('ArxivImporter fetchAsTiptap e2e-ish consistency', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('HTML path rewrites figure images to attachment:// URLs', async () => {
    const paperId = '2401.00001'
    const absHtml = buildAbsPageHtml(paperId)
    const paperHtml = buildArxivHtmlWithFigure()
    const imageBytes = Buffer.from(pngBase64, 'base64')

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = toUrl(input)

      if (url.startsWith(`https://arxiv.org/abs/${paperId}`)) {
        return new Response(absHtml, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      }
      if (url.startsWith(`https://arxiv.org/html/${paperId}`)) {
        return new Response(paperHtml, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      }
      if (url.includes('/assets/fig1.png')) {
        return new Response(imageBytes, {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })
      }

      throw new Error(`Unhandled fetch URL in HTML test: ${url}`)
    })

    vi.stubGlobal('fetch', fetchMock)

    const importer = new ArxivImporter()
    const result = await importer.fetchAsTiptap(paperId)
    const parsed = JSON.parse(result.content) as { type: string; content: unknown[] }

    const imageSrcs = collectImageSrcs(parsed)

    expect(result.title).toBe(`Paper ${paperId}`)
    expect(imageSrcs.length).toBeGreaterThan(0)
    expect(imageSrcs.every((src) => src.startsWith('attachment://'))).toBe(true)
    expect(collectText(parsed)).toContain('Hello from HTML path.')
  })

  it('PDF fallback path (mock TextIn) also rewrites images to attachment:// URLs', async () => {
    const paperId = '2402.00002'
    const absHtml = buildAbsPageHtml(paperId)
    const pdfBytes = Buffer.from('%PDF-1.4 mock pdf bytes%', 'utf-8')

    const textinResponse = {
      code: 200,
      result: {
        markdown: '# Parsed PDF\n\nBody from PDF fallback.\n\n![img-0](img-0.png)\n',
        pages: [
          {
            structured: [
              {
                type: 'image',
                base64str: pngBase64,
                id: 'img-0',
              },
            ],
          },
        ],
      },
    }

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = toUrl(input)

      if (url.startsWith(`https://arxiv.org/abs/${paperId}`)) {
        return new Response(absHtml, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      }

      // Force HTML path to fail so importer falls back to PDF+TextIn
      if (
        url.startsWith(`https://arxiv.org/html/${paperId}`) ||
        url.startsWith(`https://ar5iv.labs.arxiv.org/html/${paperId}`)
      ) {
        return new Response('not found', { status: 404 })
      }

      if (url.startsWith(`https://arxiv.org/pdf/${paperId}.pdf`)) {
        return new Response(pdfBytes, {
          status: 200,
          headers: { 'content-type': 'application/pdf' },
        })
      }

      if (url.startsWith('https://api.textin.com/ai/service/v1/pdf_to_markdown')) {
        return new Response(JSON.stringify(textinResponse), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }

      throw new Error(`Unhandled fetch URL in PDF fallback test: ${url}`)
    })

    vi.stubGlobal('fetch', fetchMock)

    const importer = new ArxivImporter()
    const result = await importer.fetchAsTiptap(paperId)
    const parsed = JSON.parse(result.content) as { type: string; content: unknown[] }

    const imageSrcs = collectImageSrcs(parsed)
    const calledTextin = fetchMock.mock.calls.some(([arg]) =>
      toUrl(arg as RequestInfo | URL).startsWith('https://api.textin.com/ai/service/v1/pdf_to_markdown')
    )

    expect(calledTextin).toBe(true)
    expect(result.title).toBe(`Paper ${paperId}`)
    expect(imageSrcs.length).toBeGreaterThan(0)
    expect(imageSrcs.every((src) => src.startsWith('attachment://'))).toBe(true)
    expect(collectText(parsed)).toContain('Body from PDF fallback.')
  })
})
