/**
 * Tool Arguments Display Component
 *
 * Displays tool call arguments in a compact, Python kwargs-like format.
 * No JSON braces, uses indentation and bullet points for nested structures.
 *
 * Features:
 * - Python kwargs-style display (key=value)
 * - Recursive nested object/array rendering
 * - Smart inline vs multi-line formatting
 * - Theme-aware using CSS variables
 */

import { memo, type ReactNode } from 'react';

export interface ToolArgumentsDisplayProps {
  /** Arguments object to display */
  args: Record<string, unknown>;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Recursively formats a value for display.
 * Uses Python-like formatting without JSON braces.
 */
function formatValue(value: unknown, indent: number = 0): ReactNode {
  const indentStr = '  '.repeat(indent);

  // String: direct display with quotes
  if (typeof value === 'string') {
    return <span className="text-chat-text">"{value}"</span>;
  }

  // Number/Boolean: direct display
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <span className="text-chat-text">{String(value)}</span>;
  }

  // Null/undefined
  if (value === null || value === undefined) {
    return <span className="text-chat-muted italic">null</span>;
  }

  // Array handling
  if (Array.isArray(value)) {
    // Empty array
    if (value.length === 0) {
      return <span className="text-chat-muted italic">[]</span>;
    }

    // Simple array (all primitives) and short - show inline
    const allPrimitives = value.every(v => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean');
    const inline = JSON.stringify(value);
    if (allPrimitives && inline.length <= 50) {
      return <span className="text-chat-text">{inline}</span>;
    }

    // Multi-line array (Python-like list with bullets)
    return (
      <div className="text-chat-text">
        {value.map((item, idx) => (
          <div key={idx}>
            {indentStr}• {formatValue(item, indent + 1)}
          </div>
        ))}
      </div>
    );
  }

  // Object handling
  if (typeof value === 'object') {
    const objEntries = Object.entries(value as Record<string, unknown>);

    // Empty object
    if (objEntries.length === 0) {
      return <span className="text-chat-muted italic">{'{}'}</span>;
    }

    // Inline if simple and short
    const allSimple = objEntries.every(
      ([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean',
    );
    const inline = JSON.stringify(value);
    if (allSimple && inline.length <= 50) {
      // Show as comma-separated key=value pairs
      return (
        <span className="text-chat-text">
          {objEntries.map(([k, v], idx) => (
            <span key={idx}>
              {idx > 0 && <span className="text-chat-muted">, </span>}
              <span className="text-chat-muted">{k}</span>
              <span>=</span>
              {typeof v === 'string' ? `"${v}"` : String(v)}
            </span>
          ))}
        </span>
      );
    }

    // Multi-line object (indented key-value pairs)
    return (
      <div className="text-chat-text">
        {objEntries.map(([k, v], idx) => (
          <div key={idx} className="flex gap-1.5">
            <span className="text-chat-muted shrink-0">
              {indentStr}
              {k}
            </span>
            <span className="shrink-0">=</span>
            <div className="min-w-0 flex-1">{formatValue(v, indent + 1)}</div>
          </div>
        ))}
      </div>
    );
  }

  // Fallback
  return <span className="text-chat-text">{String(value)}</span>;
}

/**
 * Displays tool arguments in Python kwargs style.
 *
 * @example
 * <ToolArgumentsDisplay
 *   args={{ file_path: "/path/to/file", content: "Hello" }}
 * />
 * // Renders:
 * // file_path = "/path/to/file"
 * // content = "Hello"
 */
export const ToolArgumentsDisplay = memo(function ToolArgumentsDisplay({
  args,
  className = '',
}: ToolArgumentsDisplayProps) {
  const entries = Object.entries(args);

  if (entries.length === 0) {
    return <div className={`text-chat-muted italic ${className}`}>No arguments</div>;
  }

  return (
    <div className={`space-y-1 font-mono text-sm ${className}`}>
      {entries.map(([key, value], idx) => (
        <div key={idx} className="flex gap-1.5">
          <span className="text-chat-muted shrink-0">{key}</span>
          <span className="text-chat-text shrink-0">=</span>
          <div className="min-w-0 flex-1">{formatValue(value, 1)}</div>
        </div>
      ))}
    </div>
  );
});

export default ToolArgumentsDisplay;
