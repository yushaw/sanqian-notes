/**
 * useBlockAIGenerate Hook
 *
 * Provides AI generation for block-level content (mermaid, dataview, math, etc.)
 * Simpler than useAIWriting - just streams text output without editor manipulation.
 */

import { useState, useCallback, useRef } from 'react'

export type BlockType = 'mermaid' | 'dataview' | 'math' | 'codeBlock'

interface StreamEvent {
  type: 'text' | 'thinking' | 'tool_call' | 'tool_result' | 'done' | 'error' | 'interrupt'
  content?: string
  error?: string
}

/**
 * System prompts for different block types
 */
const BLOCK_SYSTEM_PROMPTS: Record<BlockType, string> = {
  mermaid: `You are a Mermaid diagram expert. Generate Mermaid code based on user's description.

Rules:
- Output ONLY valid Mermaid code
- Do NOT include \`\`\`mermaid markers or any other markdown
- Do NOT include any explanation or comments
- Support all Mermaid diagram types: flowchart, sequence, class, state, er, gantt, pie, etc.
- Use clear and readable node labels
- If the user provides existing code, modify/improve it based on their request`,

  dataview: `You are a Dataview query expert for Obsidian. Generate Dataview queries based on user's description.

Rules:
- Output ONLY valid Dataview query code
- Do NOT include \`\`\`dataview markers or any other markdown
- Do NOT include any explanation
- Support TABLE, LIST, TASK query types
- Use proper Dataview syntax: FROM, WHERE, SORT, GROUP BY, etc.`,

  math: `You are a LaTeX math expert. Generate LaTeX math formulas based on user's description.

Rules:
- Output ONLY the LaTeX math code
- Do NOT include $$ markers or any other delimiters
- Do NOT include any explanation
- Use standard LaTeX math syntax
- Support all common math notation: fractions, integrals, matrices, etc.`,

  codeBlock: `You are a code generation expert. Generate code based on user's description.

Rules:
- Output ONLY the code
- Do NOT include \`\`\` markers or language identifiers
- Do NOT include any explanation or comments unless specifically requested
- Follow best practices for the target language
- Write clean, readable code`,
}

interface UseBlockAIGenerateOptions {
  onComplete?: (result: string) => void
  onError?: (error: string) => void
}

interface UseBlockAIGenerateReturn {
  generate: (blockType: BlockType, userPrompt: string, currentContent?: string) => Promise<void>
  isGenerating: boolean
  streamedContent: string
  cancel: () => void
}

export function useBlockAIGenerate(options: UseBlockAIGenerateOptions = {}): UseBlockAIGenerateReturn {
  const { onComplete, onError } = options
  const [isGenerating, setIsGenerating] = useState(false)
  const [streamedContent, setStreamedContent] = useState('')
  const cleanupRef = useRef<(() => void) | null>(null)
  const abortedRef = useRef(false)

  const cancel = useCallback(() => {
    abortedRef.current = true
    if (cleanupRef.current) {
      cleanupRef.current()
      cleanupRef.current = null
    }
    setIsGenerating(false)
  }, [])

  const generate = useCallback(async (
    blockType: BlockType,
    userPrompt: string,
    currentContent?: string
  ) => {
    if (!userPrompt.trim()) return

    // Cancel any existing operation
    if (cleanupRef.current) {
      cleanupRef.current()
      cleanupRef.current = null
    }

    abortedRef.current = false
    setIsGenerating(true)
    setStreamedContent('')

    const streamId = crypto.randomUUID()
    let accumulated = ''

    // Build the prompt
    const systemPrompt = BLOCK_SYSTEM_PROMPTS[blockType]
    let fullPrompt = `${systemPrompt}\n\nUser request: ${userPrompt}`
    if (currentContent?.trim()) {
      fullPrompt += `\n\nCurrent content:\n${currentContent}`
    }

    try {
      await window.electron.chat.acquireReconnect()

      const cleanup = window.electron.chat.onStreamEvent((sid: string, rawEvent: unknown) => {
        const event = rawEvent as StreamEvent
        if (sid !== streamId || abortedRef.current) return

        if (event.type === 'text' && event.content) {
          accumulated += event.content
          setStreamedContent(accumulated)
        }

        if (event.type === 'done') {
          const finalContent = accumulated.trim()
          if (typeof cleanup === 'function') cleanup()
          cleanupRef.current = null
          setIsGenerating(false)
          onComplete?.(finalContent)
          window.electron.chat.releaseReconnect()
        }

        if (event.type === 'error') {
          if (typeof cleanup === 'function') cleanup()
          cleanupRef.current = null
          setIsGenerating(false)
          onError?.(event.error || 'Unknown error')
          window.electron.chat.releaseReconnect()
        }
      }) as (() => void) | void

      if (typeof cleanup === 'function') {
        cleanupRef.current = cleanup
      }

      await window.electron.chat.stream({
        streamId,
        agentId: 'writing',
        messages: [{ role: 'user', content: fullPrompt }]
      })
    } catch (error) {
      setIsGenerating(false)
      onError?.(error instanceof Error ? error.message : 'Connection failed')
      window.electron.chat.releaseReconnect()
    }
  }, [onComplete, onError])

  return {
    generate,
    isGenerating,
    streamedContent,
    cancel
  }
}
