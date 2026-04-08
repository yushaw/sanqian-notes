/**
 * useBlockAIGenerate Hook
 *
 * Provides AI generation for block-level content (mermaid, dataview, math, etc.)
 * Simpler than useAIWriting - just streams text output without editor manipulation.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { useReconnectHold } from './useReconnectHold'

export type BlockType = 'mermaid' | 'dataview' | 'math' | 'codeBlock'

interface StreamEvent {
  type: 'text' | 'thinking' | 'tool_call' | 'tool_result' | 'done' | 'error' | 'interrupt'
  content?: string
  error?: string
}

/**
 * System prompts for different block types
 * Supports both generation (from scratch) and optimization (improve existing)
 */
const BLOCK_SYSTEM_PROMPTS: Record<BlockType, string> = {
  mermaid: `You are a Mermaid diagram expert.

Rules:
- Output ONLY valid Mermaid code
- Do NOT include \`\`\`mermaid markers or any markdown wrapper
- Do NOT include any explanation, comments or preamble
- Support all diagram types: flowchart, sequence, class, state, er, gantt, pie, etc.
- Use clear, readable node labels`,

  dataview: `You are a Dataview query expert for Obsidian.

Rules:
- Output ONLY valid Dataview query code
- Do NOT include \`\`\`dataview markers or any markdown wrapper
- Do NOT include any explanation
- Support TABLE, LIST, TASK query types
- Use proper syntax: FROM, WHERE, SORT, GROUP BY, etc.`,

  math: `You are a LaTeX math expert.

Rules:
- Output ONLY the LaTeX math code
- Do NOT include $$ markers or any delimiters
- Do NOT include any explanation
- Use standard LaTeX math syntax`,

  codeBlock: `You are a code generation expert.

Rules:
- Output ONLY the code
- Do NOT include \`\`\` markers or language identifiers
- Do NOT include any explanation unless specifically requested
- Follow best practices for the target language`,
}

/**
 * Build the full prompt with current content context
 */
function buildPrompt(blockType: BlockType, userRequest: string, currentContent?: string): string {
  const systemPrompt = BLOCK_SYSTEM_PROMPTS[blockType]

  let prompt = systemPrompt + '\n\n'

  if (currentContent?.trim()) {
    prompt += `<current_content>
${currentContent}
</current_content>

`
  }

  prompt += `<user_request>
${userRequest}
</user_request>

`

  if (currentContent?.trim()) {
    prompt += `Based on the current content and user's request, output the improved/modified result.`
  } else {
    prompt += `Based on user's request, generate the content.`
  }

  return prompt
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
  const streamIdRef = useRef<string | null>(null)
  const reconnect = useReconnectHold()

  // Use refs to avoid regenerating callbacks when handlers change
  const onCompleteRef = useRef(onComplete)
  const onErrorRef = useRef(onError)
  onCompleteRef.current = onComplete
  onErrorRef.current = onError

  const cancel = useCallback(() => {
    abortedRef.current = true
    const streamId = streamIdRef.current
    if (streamId) {
      void window.electron.chat.cancelStream({ streamId }).catch(() => {})
      streamIdRef.current = null
    }
    if (cleanupRef.current) {
      cleanupRef.current()
      cleanupRef.current = null
    }
    reconnect.release()
    setIsGenerating(false)
    setStreamedContent('')
  }, [reconnect])

  const generate = useCallback(async (
    blockType: BlockType,
    userPrompt: string,
    currentContent?: string
  ) => {
    if (!userPrompt.trim()) return

    // Cancel any existing operation
    if (cleanupRef.current || streamIdRef.current) {
      cancel()
    }

    abortedRef.current = false
    setIsGenerating(true)
    setStreamedContent('')

    const streamId = crypto.randomUUID()
    streamIdRef.current = streamId
    let accumulated = ''

    // Build the prompt
    const fullPrompt = buildPrompt(blockType, userPrompt, currentContent)

    try {
      await reconnect.acquire()

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
          streamIdRef.current = null
          setIsGenerating(false)
          onCompleteRef.current?.(finalContent)
          reconnect.release()
        }

        if (event.type === 'error') {
          if (typeof cleanup === 'function') cleanup()
          cleanupRef.current = null
          streamIdRef.current = null
          setIsGenerating(false)
          onErrorRef.current?.(event.error || 'Unknown error')
          reconnect.release()
        }
      }) as (() => void) | void

      if (typeof cleanup === 'function') {
        cleanupRef.current = cleanup
      }

      await window.electron.chat.stream({
        streamId,
        agentId: 'generator',
        messages: [{ role: 'user', content: fullPrompt }]
      })
    } catch (error) {
      streamIdRef.current = null
      setIsGenerating(false)
      onErrorRef.current?.(error instanceof Error ? error.message : 'Connection failed')
      reconnect.release()
    }
  }, [cancel, reconnect])

  useEffect(() => {
    return () => {
      const streamId = streamIdRef.current
      if (streamId) {
        void window.electron.chat.cancelStream({ streamId }).catch(() => {})
        streamIdRef.current = null
      }
      if (cleanupRef.current) {
        cleanupRef.current()
        cleanupRef.current = null
      }
      // reconnect release handled by useReconnectHold's own cleanup
    }
  }, [])

  return {
    generate,
    isGenerating,
    streamedContent,
    cancel
  }
}
