/**
 * MarkdownRenderer Component
 *
 * Renders markdown content with streaming support using Streamdown.
 * Optimized for AI chat scenarios with partial/incomplete markdown handling.
 *
 * Features:
 * - Streaming markdown rendering
 * - GitHub Flavored Markdown (tables, task lists, etc.)
 * - Syntax highlighting via Shiki
 * - Security hardening via rehype-harden
 * - Custom component overrides
 */

import { memo, useMemo, type ReactNode } from 'react';
import { Streamdown, defaultRehypePlugins } from 'streamdown';
import { harden } from 'rehype-harden';
import remarkGfm from 'remark-gfm';

export interface MarkdownRendererProps {
  /** Markdown content to render */
  content: string;
  /** Whether content is still streaming */
  isStreaming?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Custom component overrides */
  components?: {
    /** Custom link renderer */
    a?: React.ComponentType<{ href?: string; children?: ReactNode }>;
    /** Custom code block renderer */
    code?: React.ComponentType<{ className?: string; children?: ReactNode }>;
    /** Custom paragraph renderer */
    p?: React.ComponentType<{ children?: ReactNode }>;
  };
  /** Callback when a link is clicked */
  onLinkClick?: (href: string, event: React.MouseEvent) => void;
}

/**
 * Default prose classes for markdown styling.
 *
 * Styling Architecture (3 layers):
 * 1. CSS Variables (variables.css):
 *    - Theme colors (--chat-text, --chat-accent, etc.)
 *    - Override .prose CSS variables with currentColor for proper text color inheritance
 *    - Override Streamdown's .space-y-4 wrapper to control paragraph spacing (6px)
 *
 * 2. Utility Classes (below):
 *    - PRIMARY SOURCE for all element spacing (margins, padding, line-height)
 *    - Typography sizes (text-sm, text-xs) and weights (font-bold, font-medium)
 *    - Applied via Tailwind's prose-* modifiers (prose-p:my-0, prose-h1:mt-1, etc.)
 *
 * 3. Tailwind Config (tailwind.config.ts):
 *    - Only sets maxWidth: 'none'
 *    - All other settings delegated to layers 1 & 2 above
 *
 * Key spacing values:
 * - Paragraph spacing: 6px (controlled by CSS override of .space-y-4)
 * - Paragraph line-height: 1.375 (leading-snug)
 * - List margins: 2px (my-0.5 = 0.125rem)
 * - List padding: 16px (pl-4 = 1rem)
 * - Headings: H1/H2 mt-1 mb-0.5, H3+ mt-0.5 mb-0
 */
const PROSE_CLASSES = `
  prose prose-sm max-w-none
  prose-p:my-0 prose-p:leading-snug
  prose-ul:my-0.5 prose-ul:pl-5 prose-ul:list-disc
  prose-ol:my-0.5 prose-ol:pl-5 prose-ol:list-decimal
  prose-li:my-0.5 prose-li:leading-relaxed
  prose-code:px-1 prose-code:py-0.5 prose-code:bg-chat-code prose-code:rounded prose-code:text-xs prose-code:font-mono prose-code:before:content-none prose-code:after:content-none
  prose-pre:my-0.5 prose-pre:bg-chat-code prose-pre:border prose-pre:border-chat-border prose-pre:rounded-lg prose-pre:p-2
  prose-blockquote:my-0.5 prose-blockquote:border-l-4 prose-blockquote:border-chat-accent/60 prose-blockquote:pl-3 prose-blockquote:italic
  prose-a:text-chat-accent prose-a:underline prose-a:hover:text-chat-accent/80
  prose-hr:my-0.5 prose-hr:border-chat-divider
  prose-table:my-0.5 prose-table:border-collapse
  prose-th:border prose-th:border-chat-divider prose-th:bg-chat-card prose-th:px-2 prose-th:py-0.5 prose-th:font-semibold
  prose-td:border prose-td:border-chat-divider prose-td:px-2 prose-td:py-0.5
  prose-img:rounded-lg prose-img:shadow-chat-soft
  prose-h1:text-sm prose-h1:font-bold prose-h1:border-b prose-h1:border-chat-divider prose-h1:pb-0.5 prose-h1:leading-tight prose-h1:mt-1 prose-h1:mb-0.5
  prose-h2:text-sm prose-h2:font-semibold prose-h2:mt-1 prose-h2:mb-0.5 prose-h2:leading-tight
  prose-h3:text-sm prose-h3:font-medium prose-h3:mt-0.5 prose-h3:mb-0 prose-h3:leading-tight
  prose-h4:text-xs prose-h4:font-medium prose-h4:mt-0.5 prose-h4:mb-0
  prose-h5:text-xs prose-h5:font-medium prose-h5:mt-0.5 prose-h5:mb-0
  prose-h6:text-xs prose-h6:font-medium prose-h6:mt-0.5 prose-h6:mb-0
  prose-strong:font-semibold
`
  .trim()
  .replace(/\s+/g, ' ');

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  isStreaming = false,
  className = '',
  components,
  onLinkClick,
}: MarkdownRendererProps) {
  // Build rehype plugins with security hardening
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rehypePlugins = useMemo<any[]>(
    () => [...Object.values(defaultRehypePlugins), [harden, { tagNames: ['iframe', 'script', 'style'] }]],
    [],
  );

  // Build custom components
  const customComponents = useMemo(() => {
    const comps: Record<string, React.ComponentType<Record<string, unknown>>> = {};

    // Custom paragraph with streaming cursor
    comps.p = ({ children }: { children?: ReactNode }) => {
      // Handle streaming cursor
      if (isStreaming && children && typeof children === 'string' && children.endsWith('\u258c')) {
        const textWithoutCursor = children.slice(0, -1);
        return (
          <p>
            {textWithoutCursor}
            <span style={{ color: 'var(--chat-accent)' }} className="chat-cursor-breathing">
              {'\u258c'}
            </span>
          </p>
        );
      }
      return <p>{children}</p>;
    };

    // Custom link handler
    if (onLinkClick || components?.a) {
      comps.a = ({ href, children }: { href?: string; children?: ReactNode }) => {
        if (components?.a) {
          const CustomLink = components.a;
          return <CustomLink href={href}>{children}</CustomLink>;
        }

        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => {
              if (onLinkClick && href) {
                e.preventDefault();
                onLinkClick(href, e);
              }
            }}>
            {children}
          </a>
        );
      };
    }

    // Merge custom components
    if (components?.code) {
      comps.code = components.code as React.ComponentType<Record<string, unknown>>;
    }
    if (components?.p && !isStreaming) {
      comps.p = components.p as React.ComponentType<Record<string, unknown>>;
    }

    return comps;
  }, [components, isStreaming, onLinkClick]);

  // Prepare content for streaming (add cursor)
  const displayContent = isStreaming ? content.replace(/\n+$/, '') + '\u258c' : content;

  return (
    <div className={`${PROSE_CLASSES} ${className}`}>
      <Streamdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} components={customComponents}>
        {displayContent}
      </Streamdown>
    </div>
  );
});

export default MarkdownRenderer;
