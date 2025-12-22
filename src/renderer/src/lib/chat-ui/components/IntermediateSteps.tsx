/**
 * IntermediateSteps Component
 *
 * Collapsible timeline showing intermediate steps (thinking, text, tool calls)
 * for completed assistant messages with tool calls.
 *
 * Features:
 * - Groups blocks into rounds (thinking → text → tool_call → tool_result)
 * - Shows step count summary when collapsed
 * - Expandable timeline with icons
 * - Auto-scrolls during streaming
 * - Theme-aware using CSS variables
 */

import { memo, useState, useRef, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import type { MessageBlock, ToolCallStatus } from '../core/types';
import { ToolArgumentsDisplay } from '../renderers/ToolArgumentsDisplay';

// =============================================================================
// Types
// =============================================================================

export interface IntermediateStepsProps {
  /** Message blocks to display */
  blocks: MessageBlock[];
  /** Additional CSS classes */
  className?: string;
  /** Default expanded state (default: false for completed, true for streaming) */
  defaultExpanded?: boolean;
  /** Whether the message is still streaming */
  isStreaming?: boolean;
  /** Current thinking content (for streaming) */
  currentThinking?: string;
  /** Whether thinking is currently streaming */
  isThinkingStreaming?: boolean;
  /** Localized strings */
  strings?: {
    steps?: string;
    executing?: string;
  };
}

/** Group of blocks representing one round of interaction */
interface StepRound {
  thinking?: MessageBlock;
  text?: MessageBlock;
  toolCall?: MessageBlock;
  toolResult?: MessageBlock;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Clean up tool name for display by removing prefixes like:
 * - sdk_{appName}_ -> just the tool name
 * - mcp_{serverName}_ -> just the tool name
 */
function cleanToolName(name: string | undefined): string {
  if (!name) return '';

  // Match patterns: sdk_appname_toolname or mcp_servername_toolname
  // The prefix format is: {type}_{source}_{toolname}
  const match = name.match(/^(sdk|mcp)_[^_]+_(.+)$/);
  if (match) {
    return match[2]; // Return just the tool name part
  }

  return name;
}

// =============================================================================
// Icons
// =============================================================================

const TimelineIcons = {
  thinking: (
    <svg className="size-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="5" strokeDasharray="3 2" />
    </svg>
  ),
  text: (
    <svg className="size-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 4h10M3 8h7M3 12h9" />
    </svg>
  ),
  tool: (
    <svg className="size-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M6 3v3l-2 2 2 2v3M10 3v3l2 2-2 2v3" />
    </svg>
  ),
  check: (
    <svg className="size-2" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M3 8l4 4 6-7" />
    </svg>
  ),
  error: (
    <svg className="size-2" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  ),
};

// =============================================================================
// Helper Components
// =============================================================================

/**
 * Expandable text - click to show full content (truncate by lines)
 */
function ExpandableText({
  content,
  className,
  maxLines = 3,
}: {
  content: string;
  className?: string;
  maxLines?: number;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const trimmed = content.trim();
  const lines = trimmed.split('\n');
  const needsExpand = lines.length > maxLines;

  const displayContent = isExpanded ? trimmed : lines.slice(0, maxLines).join('\n') + (needsExpand ? '…' : '');

  return (
    <span
      className={`${className} ${needsExpand ? 'cursor-pointer' : ''} whitespace-pre-wrap`}
      onClick={e => {
        if (needsExpand) {
          e.stopPropagation();
          setIsExpanded(!isExpanded);
        }
      }}>
      {displayContent}
    </span>
  );
}

/**
 * Tool call item for completed messages
 */
function ToolCallItem({ toolCall, toolResult }: { toolCall: MessageBlock; toolResult?: MessageBlock }) {
  const [expanded, setExpanded] = useState(false);
  const hasArgs = toolCall.toolArgs && Object.keys(toolCall.toolArgs).length > 0;

  return (
    <div>
      <span
        onClick={() => setExpanded(!expanded)}
        className="text-chat-muted/70 hover:text-chat-accent inline-flex cursor-pointer items-center gap-1 transition-colors">
        <span className="font-mono text-xs">{cleanToolName(toolCall.toolName)}</span>
        {toolResult && <span className="text-green-600/60 dark:text-green-400/60">{TimelineIcons.check}</span>}
        {!toolResult && toolCall.toolStatus === 'error' && <span className="text-red-500">{TimelineIcons.error}</span>}
        {hasArgs && !expanded && (
          <span className="text-chat-muted/40 font-mono text-xs" style={{ fontSize: '0.85em' }}>
            (
            {Object.values(toolCall.toolArgs!)
              .slice(0, 1)
              .map(v => (typeof v === 'string' ? (v.length > 18 ? v.slice(0, 18) + '…' : v) : '…'))}
            )
          </span>
        )}
      </span>

      {expanded && (
        <div className="border-chat-border/30 ml-1 mt-1 space-y-1 border-l pl-2 text-xs">
          {hasArgs && (
            <div className="text-chat-muted/60 font-mono">
              <ToolArgumentsDisplay args={toolCall.toolArgs!} />
            </div>
          )}
          {toolResult && (
            <pre className="text-chat-text/50 m-0 max-h-16 overflow-y-auto whitespace-pre-wrap font-mono">
              {toolResult.content.slice(0, 200)}
              {toolResult.content.length > 200 ? '…' : ''}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Tool call item for streaming messages (with active state indicator)
 */
function StreamingToolCallItem({
  toolCall,
  toolResult,
  isActive,
  strings,
}: {
  toolCall: MessageBlock;
  toolResult?: MessageBlock;
  isActive: boolean;
  strings?: { executing?: string };
}) {
  const [expanded, setExpanded] = useState(false);
  const hasArgs = toolCall.toolArgs && Object.keys(toolCall.toolArgs).length > 0;

  return (
    <div>
      <span
        onClick={() => setExpanded(!expanded)}
        className="text-chat-muted/70 hover:text-chat-accent inline-flex cursor-pointer items-center gap-1 transition-colors">
        <span className="font-mono text-xs">{cleanToolName(toolCall.toolName)}</span>
        {toolResult && <span className="text-green-600/60 dark:text-green-400/60">{TimelineIcons.check}</span>}
        {isActive && <span className="ml-0.5 animate-pulse text-amber-500">◆</span>}
        {hasArgs && !expanded && (
          <span className="text-chat-muted/40 font-mono text-xs" style={{ fontSize: '0.85em' }}>
            (
            {Object.values(toolCall.toolArgs!)
              .slice(0, 1)
              .map(v => (typeof v === 'string' ? (v.length > 18 ? v.slice(0, 18) + '…' : v) : '…'))}
            )
          </span>
        )}
      </span>

      {expanded && (
        <div className="border-chat-border/30 ml-1 mt-1 space-y-1 border-l pl-2 text-xs">
          {hasArgs && (
            <div className="text-chat-muted/60 font-mono">
              <ToolArgumentsDisplay args={toolCall.toolArgs!} />
            </div>
          )}
          {toolResult && (
            <pre className="text-chat-text/50 m-0 max-h-16 overflow-y-auto whitespace-pre-wrap font-mono">
              {toolResult.content.slice(0, 200)}
              {toolResult.content.length > 200 ? '…' : ''}
            </pre>
          )}
          {isActive && !toolResult && (
            <div className="animate-pulse text-xs text-amber-500/70">{strings?.executing || 'Executing...'}</div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Block Grouping Logic
// =============================================================================

/**
 * Group blocks into rounds (for completed messages - only intermediate blocks)
 */
function groupBlocksIntoRounds(blocks: MessageBlock[]): StepRound[] {
  const intermediateBlocks = blocks.filter(b => b.isIntermediate);
  return groupBlocksImpl(intermediateBlocks);
}

/**
 * Group all blocks into rounds (for streaming messages - all blocks)
 */
function groupAllBlocksIntoRounds(blocks: MessageBlock[]): StepRound[] {
  return groupBlocksImpl(blocks);
}

/**
 * Implementation of block grouping
 */
function groupBlocksImpl(blocks: MessageBlock[]): StepRound[] {
  const rounds: StepRound[] = [];
  let currentRound: StepRound = {};

  for (const block of blocks) {
    if (block.type === 'thinking') {
      // New thinking starts a new round (if current round has content)
      if (currentRound.thinking || currentRound.text || currentRound.toolCall) {
        rounds.push(currentRound);
        currentRound = {};
      }
      currentRound.thinking = block;
    } else if (block.type === 'text') {
      currentRound.text = block;
    } else if (block.type === 'tool_call') {
      currentRound.toolCall = block;
    } else if (block.type === 'tool_result') {
      currentRound.toolResult = block;
      // Tool result ends a round
      rounds.push(currentRound);
      currentRound = {};
    }
  }

  // Push any remaining round
  if (currentRound.thinking || currentRound.text || currentRound.toolCall) {
    rounds.push(currentRound);
  }

  return rounds;
}

// =============================================================================
// Main Component: IntermediateSteps (for completed messages)
// =============================================================================

export const IntermediateSteps = memo(function IntermediateSteps({
  blocks,
  className = '',
  defaultExpanded = false,
  strings = {},
}: Omit<IntermediateStepsProps, 'isStreaming' | 'currentThinking' | 'isThinkingStreaming'>) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const rounds = useMemo(() => groupBlocksIntoRounds(blocks), [blocks]);

  if (rounds.length === 0) return null;

  // Flatten to steps for counting
  const steps: { type: 'thinking' | 'text' | 'tool'; round: StepRound }[] = [];
  for (const round of rounds) {
    if (round.thinking?.content.trim()) steps.push({ type: 'thinking', round });
    if (round.text?.content.trim()) steps.push({ type: 'text', round });
    if (round.toolCall) steps.push({ type: 'tool', round });
  }

  // Count steps = number of tool calls
  const stepCount = steps.filter(s => s.type === 'tool').length;

  // Only show timeline when there's at least 1 tool call
  if (stepCount === 0) return null;

  const summary = `${stepCount} ${strings.steps || 'steps'}`;

  return (
    <div className={`mb-3 ${className}`}>
      {/* Toggle */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="text-chat-muted/50 hover:text-chat-muted/80 inline-flex items-center gap-1.5 text-xs transition-colors">
        <span className={`text-[10px] transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
        <span>{summary}</span>
      </button>

      {/* Timeline - render by rounds, dot only at round start */}
      {isExpanded && (
        <div className="ml-2 mt-2 max-h-80 overflow-y-auto">
          {rounds.map((round, roundIdx) => {
            const isLastRound = roundIdx === rounds.length - 1;
            // Collect items in this round
            const items: { type: 'thinking' | 'text' | 'tool'; content: ReactNode }[] = [];
            if (round.thinking?.content.trim()) {
              items.push({
                type: 'thinking',
                content: <ExpandableText content={round.thinking.content.trim()} className="text-chat-muted/80 italic" />,
              });
            }
            if (round.text?.content.trim()) {
              items.push({
                type: 'text',
                content: <ExpandableText content={round.text.content.trim()} className="text-chat-text/80" />,
              });
            }
            if (round.toolCall) {
              items.push({
                type: 'tool',
                content: <ToolCallItem toolCall={round.toolCall} toolResult={round.toolResult} />,
              });
            }

            if (items.length === 0) return null;

            return (
              <div
                key={roundIdx}
                className="relative pl-5 opacity-90 transition-opacity hover:opacity-100"
                style={{
                  borderLeft: isLastRound ? 'none' : '1px dashed rgba(128,128,128,0.35)',
                  marginLeft: '3px',
                }}>
                {/* Dot - only at round start, same color as line */}
                <div
                  className="absolute size-[7px] rounded-full"
                  style={{ left: '-4px', top: '5px', backgroundColor: 'rgba(128,128,128,0.35)' }}
                />
                {/* Items in this round */}
                <div className={isLastRound ? '' : 'pb-2'}>
                  {items.map((item, itemIdx) => {
                    const iconColor = item.type === 'tool' ? 'text-chat-muted/70' : 'text-chat-muted/50';
                    const isLastItem = itemIdx === items.length - 1;
                    return (
                      <div key={itemIdx} className={`flex items-baseline gap-1.5 ${isLastItem ? '' : 'pb-0.5'}`}>
                        <span className={`inline-flex shrink-0 ${iconColor}`} style={{ transform: 'translateY(2px)' }}>
                          {item.type === 'thinking' && TimelineIcons.thinking}
                          {item.type === 'text' && TimelineIcons.text}
                          {item.type === 'tool' && TimelineIcons.tool}
                        </span>
                        <div className="min-w-0 flex-1 text-xs leading-relaxed">{item.content}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

// =============================================================================
// StreamingTimeline (for streaming messages)
// =============================================================================

export interface StreamingTimelineProps {
  /** Message blocks to display */
  blocks: MessageBlock[];
  /** Current thinking content */
  currentThinking?: string;
  /** Whether thinking is currently streaming */
  isThinkingStreaming?: boolean;
  /** Whether any tool is currently running */
  isToolCallsStreaming?: boolean;
  /** Whether the message is complete */
  isComplete?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Localized strings */
  strings?: {
    steps?: string;
    executing?: string;
  };
}

export const StreamingTimeline = memo(function StreamingTimeline({
  blocks,
  currentThinking = '',
  isThinkingStreaming = false,
  isToolCallsStreaming = false,
  isComplete = false,
  className = '',
  strings = {},
}: StreamingTimelineProps) {
  const [isExpanded, setIsExpanded] = useState(true); // Default expanded during streaming
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Build display rounds
  const rounds = useMemo(() => groupAllBlocksIntoRounds(blocks), [blocks]);
  const activeThinking = currentThinking;

  const displayRounds = useMemo(() => {
    const result: {
      type: 'thinking' | 'text' | 'tool';
      content: string;
      isActive: boolean;
      toolCall?: MessageBlock;
      toolResult?: MessageBlock;
    }[][] = [];

    // Add existing rounds from blocks
    for (let roundIdx = 0; roundIdx < rounds.length; roundIdx++) {
      const round = rounds[roundIdx];
      const isLastRound = roundIdx === rounds.length - 1;
      const items: (typeof result)[0] = [];

      if (round.thinking?.content.trim()) {
        const isActive = Boolean(isLastRound && isThinkingStreaming && !round.text && !round.toolCall);
        items.push({
          type: 'thinking',
          content: round.thinking.content.trim(),
          isActive,
        });
      }

      if (round.text?.content.trim()) {
        items.push({
          type: 'text',
          content: round.text.content.trim(),
          isActive: false,
        });
      }

      if (round.toolCall) {
        const isActive = Boolean(isLastRound && isToolCallsStreaming && round.toolCall.toolStatus === 'running');
        items.push({
          type: 'tool',
          content: cleanToolName(round.toolCall.toolName) || '',
          isActive,
          toolCall: round.toolCall,
          toolResult: round.toolResult,
        });
      }

      if (items.length > 0) {
        result.push(items);
      }
    }

    // If thinking is active but no blocks, add a thinking-only round
    if (rounds.length === 0 && activeThinking) {
      result.push([
        {
          type: 'thinking',
          content: activeThinking.trim(),
          isActive: isThinkingStreaming || false,
        },
      ]);
    }
    // If last round doesn't have thinking but we have active thinking (new round starting)
    else if (isThinkingStreaming && activeThinking && result.length > 0) {
      const lastRound = result[result.length - 1];
      const hasThinkingInLastRound = lastRound.some(item => item.type === 'thinking');
      if (!hasThinkingInLastRound) {
        result.push([
          {
            type: 'thinking',
            content: activeThinking.trim(),
            isActive: true,
          },
        ]);
      }
    }

    return result;
  }, [rounds, activeThinking, isThinkingStreaming, isToolCallsStreaming]);

  // Count steps = number of tool calls
  const stepCount = displayRounds.flat().filter(item => item.type === 'tool').length;
  const summary = `${stepCount} ${strings.steps || 'steps'}`;

  // Detect user scroll
  const handleScroll = useCallback(() => {
    if (!timelineRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = timelineRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 20;
    setIsUserScrolling(!isAtBottom);
  }, []);

  // Auto-scroll to bottom when new content arrives (unless user is scrolling up)
  useEffect(() => {
    if (isExpanded && timelineRef.current && !isUserScrolling) {
      timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
    }
  }, [displayRounds, isExpanded, isUserScrolling]);

  // Reset user scrolling state when streaming ends
  useEffect(() => {
    if (!isThinkingStreaming && !isToolCallsStreaming) {
      setIsUserScrolling(false);
    }
  }, [isThinkingStreaming, isToolCallsStreaming]);

  // Early returns after all hooks
  if (displayRounds.length === 0) return null;
  // Only show timeline when there's at least 1 tool call (don't show for thinking-only)
  if (stepCount === 0 && !isToolCallsStreaming) return null;

  return (
    <div className={`mb-3 ${className}`}>
      {/* Toggle */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="text-chat-muted/50 hover:text-chat-muted/80 inline-flex items-center gap-1.5 text-xs transition-colors">
        <span className={`text-[10px] transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
        <span>{summary}</span>
        {!isComplete && <span className="ml-1 animate-pulse text-amber-500">●</span>}
      </button>

      {/* Timeline */}
      {isExpanded && (
        <div ref={timelineRef} onScroll={handleScroll} className="ml-2 mt-2 max-h-80 overflow-y-auto">
          {displayRounds.map((items, roundIdx) => {
            const isLastRound = roundIdx === displayRounds.length - 1;

            return (
              <div
                key={roundIdx}
                className="relative pl-5 opacity-90 transition-opacity hover:opacity-100"
                style={{
                  borderLeft: isLastRound ? 'none' : '1px dashed rgba(128,128,128,0.35)',
                  marginLeft: '3px',
                }}>
                {/* Dot */}
                <div
                  className="absolute size-[7px] rounded-full"
                  style={{ left: '-4px', top: '5px', backgroundColor: 'rgba(128,128,128,0.35)' }}
                />
                {/* Items */}
                <div className={isLastRound ? '' : 'pb-2'}>
                  {items.map((item, itemIdx) => {
                    const iconColor = item.type === 'tool' ? 'text-chat-muted/70' : 'text-chat-muted/50';
                    const isLastItem = itemIdx === items.length - 1;

                    let displayContent: ReactNode;
                    if (item.type === 'thinking') {
                      if (item.isActive) {
                        // Active thinking - show with cursor, truncate by lines
                        const lines = item.content.trim().split('\n');
                        const truncated = lines.length > 3 ? lines.slice(0, 3).join('\n') + '…' : item.content;
                        displayContent = (
                          <span className="text-chat-muted/80 whitespace-pre-wrap italic">
                            {truncated}
                            <span className="ml-1 animate-pulse">▍</span>
                          </span>
                        );
                      } else {
                        displayContent = (
                          <ExpandableText content={item.content} className="text-chat-muted/80 italic" />
                        );
                      }
                    } else if (item.type === 'text') {
                      displayContent = <ExpandableText content={item.content} className="text-chat-text/80" />;
                    } else {
                      // tool - use StreamingToolCallItem
                      displayContent = (
                        <StreamingToolCallItem
                          toolCall={item.toolCall!}
                          toolResult={item.toolResult}
                          isActive={item.isActive}
                          strings={strings}
                        />
                      );
                    }

                    return (
                      <div key={itemIdx} className={`flex items-baseline gap-1.5 ${isLastItem ? '' : 'pb-0.5'}`}>
                        <span className={`inline-flex shrink-0 ${iconColor}`} style={{ transform: 'translateY(2px)' }}>
                          {item.type === 'thinking' && TimelineIcons.thinking}
                          {item.type === 'text' && TimelineIcons.text}
                          {item.type === 'tool' && TimelineIcons.tool}
                        </span>
                        <div className="min-w-0 flex-1 text-xs leading-relaxed">{displayContent}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

// =============================================================================
// ThinkingSection (for simple conversations without tool calls)
// =============================================================================

export interface ThinkingSectionProps {
  /** Thinking content */
  thinking: string;
  /** Current round thinking (reset after each tool call) */
  currentThinking?: string;
  /** Whether thinking is currently streaming */
  isStreaming?: boolean;
  /** Whether the message is complete */
  isComplete?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Localized strings */
  strings?: {
    thinking?: string;
  };
}

export const ThinkingSection = memo(function ThinkingSection({
  thinking,
  currentThinking,
  isStreaming = false,
  isComplete = false,
  className = '',
  strings = {},
}: ThinkingSectionProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Use currentThinking if available (during streaming), otherwise use full thinking
  // Always trim to remove leading/trailing whitespace
  const displayThinking = (currentThinking || thinking)?.trim() || '';

  if (!displayThinking) return null;

  // Truncate for collapsed view
  const lines = displayThinking.split('\n');
  const truncated = lines.length > 3 ? lines.slice(0, 3).join('\n') + '…' : displayThinking;

  return (
    <div className={`mb-2 ${className}`}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="text-chat-muted/50 hover:text-chat-muted/80 inline-flex items-center gap-1.5 text-xs transition-colors">
        <span className={`text-[10px] transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
        <span>{strings.thinking || 'Thinking'}</span>
        {isStreaming && <span className="ml-1 animate-pulse">▍</span>}
      </button>

      {isExpanded && (
        <div className="border-chat-border/30 ml-4 mt-1 border-l pl-2">
          <div className="text-chat-muted/80 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs italic">
            {displayThinking}
            {isStreaming && <span className="ml-1 animate-pulse">▍</span>}
          </div>
        </div>
      )}

      {!isExpanded && (
        <div className="text-chat-muted/60 ml-4 mt-1 line-clamp-2 whitespace-pre-wrap text-xs italic">
          {truncated}
          {isStreaming && <span className="ml-1 animate-pulse">▍</span>}
        </div>
      )}
    </div>
  );
});

export default IntermediateSteps;
