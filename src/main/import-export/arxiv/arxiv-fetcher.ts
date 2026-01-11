/**
 * arXiv Fetcher
 *
 * Handles network requests to fetch arXiv paper metadata, HTML, and PDF.
 */

import type { ParsedArxivId, ArxivMetadata } from './types'

/** Request timeout in milliseconds */
const REQUEST_TIMEOUT = 30000

/**
 * Parse various arXiv input formats to standardized ID
 *
 * Supported formats:
 * - 2401.00001
 * - 2401.00001v2
 * - arxiv:2401.00001
 * - https://arxiv.org/abs/2401.00001
 * - https://arxiv.org/pdf/2401.00001.pdf
 * - https://arxiv.org/html/2401.00001
 * - https://ar5iv.labs.arxiv.org/html/2401.00001
 * - Old format: hep-th/9901001
 */
export function parseArxivInput(input: string): ParsedArxivId | null {
  const trimmed = input.trim()

  // New format: YYMM.NNNNN (after April 2007)
  const newIdPattern = /(\d{4}\.\d{4,5})(v(\d+))?/
  // Old format: category/YYMMNNN (before April 2007)
  const oldIdPattern = /([a-z-]+\/\d{7})(v(\d+))?/i

  const newMatch = trimmed.match(newIdPattern)
  if (newMatch) {
    return {
      id: newMatch[1],
      version: newMatch[3] ? parseInt(newMatch[3]) : undefined
    }
  }

  const oldMatch = trimmed.match(oldIdPattern)
  if (oldMatch) {
    return {
      id: oldMatch[1],
      version: oldMatch[3] ? parseInt(oldMatch[3]) : undefined
    }
  }

  return null
}

/**
 * Build arXiv URLs from ID
 */
export function buildArxivUrls(id: string, version?: number) {
  const versionSuffix = version ? `v${version}` : ''
  return {
    abs: `https://arxiv.org/abs/${id}${versionSuffix}`,
    pdf: `https://arxiv.org/pdf/${id}${versionSuffix}.pdf`,
    html: `https://arxiv.org/html/${id}${versionSuffix}`,
    ar5iv: `https://ar5iv.labs.arxiv.org/html/${id}${versionSuffix}`
  }
}

/**
 * Fetch with timeout and abort support
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeout = REQUEST_TIMEOUT,
  abortSignal?: AbortSignal
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  // Link external abort signal
  if (abortSignal) {
    abortSignal.addEventListener('abort', () => controller.abort())
  }

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    })
    return response
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Fetch paper metadata from arXiv abs page
 */
export async function fetchMetadata(
  id: string,
  version?: number,
  abortSignal?: AbortSignal
): Promise<ArxivMetadata> {
  const urls = buildArxivUrls(id, version)

  const response = await fetchWithTimeout(urls.abs, {}, REQUEST_TIMEOUT, abortSignal)

  if (!response.ok) {
    throw new Error(`Failed to fetch arXiv metadata: ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  return parseAbsPage(html, id, urls)
}

/**
 * Parse arXiv abs page HTML to extract metadata
 */
function parseAbsPage(html: string, id: string, urls: ReturnType<typeof buildArxivUrls>): ArxivMetadata {
  // Extract title
  const titleMatch = html.match(/<meta name="citation_title" content="([^"]+)"/)
  const title = titleMatch ? decodeHtmlEntities(titleMatch[1]) : 'Untitled'

  // Extract authors
  const authorMatches = html.matchAll(/<meta name="citation_author" content="([^"]+)"/g)
  const authors = Array.from(authorMatches).map((m) => decodeHtmlEntities(m[1]))

  // Extract abstract
  const abstractMatch = html.match(
    /<blockquote class="abstract[^"]*">\s*<span class="descriptor">[^<]*<\/span>\s*([\s\S]*?)<\/blockquote>/
  )
  const abstract = abstractMatch
    ? decodeHtmlEntities(abstractMatch[1].replace(/<[^>]+>/g, '').trim())
    : ''

  // Extract categories
  const categoryMatch = html.match(/<td class="tablecell subjects">\s*<span class="primary-subject">([^<]+)<\/span>/)
  const categories = categoryMatch ? [categoryMatch[1].trim()] : []

  // Extract additional categories
  const subjectMatches = html.matchAll(/<span class="primary-subject">([^<]+)<\/span>/g)
  for (const match of subjectMatches) {
    const cat = match[1].trim()
    if (!categories.includes(cat)) {
      categories.push(cat)
    }
  }

  // Extract dates
  const dateMatch = html.match(/<meta name="citation_date" content="([^"]+)"/)
  const publishedDate = dateMatch ? dateMatch[1] : ''

  // Extract DOI if available
  const doiMatch = html.match(/<a href="https:\/\/doi\.org\/([^"]+)"/)
  const doi = doiMatch ? doiMatch[1] : undefined

  // Check if HTML version exists (look for HTML link)
  const hasHtml = html.includes('/html/' + id) || html.includes('View HTML')

  return {
    id,
    title,
    authors,
    abstract,
    categories,
    publishedDate,
    doi,
    pdfUrl: urls.pdf,
    htmlUrl: hasHtml ? urls.html : undefined
  }
}

/**
 * Fetch HTML content from arXiv
 * Try arxiv.org/html first, then fall back to ar5iv
 */
export async function fetchHtml(
  id: string,
  version?: number,
  abortSignal?: AbortSignal
): Promise<{ html: string; baseUrl: string } | null> {
  const urls = buildArxivUrls(id, version)

  // Try arxiv.org/html first
  try {
    const response = await fetchWithTimeout(urls.html, {}, REQUEST_TIMEOUT, abortSignal)
    if (response.ok) {
      const html = await response.text()
      // Check if it's actually an HTML paper (not a redirect or error page)
      if (html.includes('ltx_document') || html.includes('ltx_page_main')) {
        // Add trailing slash for proper relative URL resolution
        return { html, baseUrl: urls.html.endsWith('/') ? urls.html : urls.html + '/' }
      }
    }
  } catch {
    // Continue to ar5iv fallback
  }

  // Try ar5iv as fallback
  try {
    const response = await fetchWithTimeout(urls.ar5iv, {}, REQUEST_TIMEOUT, abortSignal)
    if (response.ok) {
      const html = await response.text()
      if (html.includes('ltx_document') || html.includes('ltx_page_main')) {
        // Add trailing slash for proper relative URL resolution
        return { html, baseUrl: urls.ar5iv.endsWith('/') ? urls.ar5iv : urls.ar5iv + '/' }
      }
    }
  } catch {
    // Both failed
  }

  return null
}

/**
 * Fetch PDF from arXiv
 */
export async function fetchPdf(id: string, version?: number, abortSignal?: AbortSignal): Promise<Buffer> {
  const urls = buildArxivUrls(id, version)

  const response = await fetchWithTimeout(urls.pdf, {}, 60000, abortSignal) // Longer timeout for PDF

  if (!response.ok) {
    throw new Error(`Failed to fetch arXiv PDF: ${response.status} ${response.statusText}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

/**
 * Download an image from URL
 */
export async function downloadImage(
  imageUrl: string,
  baseUrl: string,
  abortSignal?: AbortSignal
): Promise<{ buffer: Buffer; contentType: string }> {
  // Build list of URLs to try
  const urlsToTry: string[] = []

  // If already absolute URL
  if (imageUrl.startsWith('http')) {
    urlsToTry.push(imageUrl)
  } else if (imageUrl.startsWith('/')) {
    // Absolute path from domain root - combine with origin
    try {
      const origin = new URL(baseUrl).origin
      urlsToTry.push(origin + imageUrl)
    } catch {
      // Invalid URL
    }
  } else {
    // Relative path - resolve against base URL
    try {
      urlsToTry.push(new URL(imageUrl, baseUrl).href)
    } catch {
      // Invalid URL
    }
  }

  // For ar5iv, add alternative paths
  if (baseUrl.includes('ar5iv')) {
    const match = baseUrl.match(/\/html\/([^/]+)/)
    if (match) {
      const paperId = match[1]
      // Try assets directory
      if (!imageUrl.includes('/assets/')) {
        urlsToTry.push(`https://ar5iv.labs.arxiv.org/html/${paperId}/assets/${imageUrl}`)
      }
    }
  }

  // Try each URL
  for (const url of urlsToTry) {
    try {
      const response = await fetchWithTimeout(url, {}, REQUEST_TIMEOUT, abortSignal)
      if (response.ok) {
        const contentType = response.headers.get('content-type') || 'image/png'
        const arrayBuffer = await response.arrayBuffer()
        return {
          buffer: Buffer.from(arrayBuffer),
          contentType
        }
      }
    } catch {
      // Try next URL
    }
  }

  throw new Error(`Failed to download image: 404 (tried ${urlsToTry.length} URLs)`)
}

/**
 * Decode HTML entities
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
}
