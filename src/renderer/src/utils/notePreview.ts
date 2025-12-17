/**
 * Extract preview text from note content (Tiptap JSON or BlockNote format)
 */
export function getPreview(content: string): string {
  if (!content || content === '[]' || content === '') {
    return ''
  }

  try {
    const parsed = JSON.parse(content)

    // Handle Tiptap JSON format
    if (parsed.type === 'doc' && parsed.content) {
      const texts: string[] = []
      const extractText = (node: { type?: string; text?: string; content?: unknown[] }) => {
        if (node.text) {
          texts.push(node.text)
        }
        if (node.content && Array.isArray(node.content)) {
          node.content.forEach(child => extractText(child as { type?: string; text?: string; content?: unknown[] }))
        }
      }
      extractText(parsed)
      return texts.join(' ').slice(0, 120)
    }

    // Handle BlockNote format (legacy)
    if (Array.isArray(parsed)) {
      for (const block of parsed) {
        if (block.content && Array.isArray(block.content)) {
          for (const item of block.content) {
            if (item.type === 'text' && item.text) {
              return item.text.slice(0, 120)
            }
          }
        }
      }
    }
  } catch {
    // If not valid JSON, return as-is
    return content.slice(0, 120)
  }
  return ''
}
