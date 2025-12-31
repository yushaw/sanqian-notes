/**
 * 共享的 Prose 样式类名
 * 用于 AI 内容渲染（预览弹窗和独立窗口）
 */

/**
 * AI Popup 预览样式（紧凑版，用于 hover 预览）
 */
export const AI_POPUP_PREVIEW_PROSE = `prose prose-sm max-w-none text-[var(--color-text)]
  [&_*]:mt-0 [&>*]:mb-2 [&>*:last-child]:mb-0
  prose-p:leading-relaxed prose-p:text-[13px]
  prose-ul:pl-4 prose-ul:text-[13px]
  prose-ol:pl-4 prose-ol:text-[13px]
  prose-li:my-0.5 prose-li:leading-snug
  prose-code:px-1 prose-code:py-0.5 prose-code:bg-black/5 dark:prose-code:bg-white/10 prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none
  prose-pre:p-2 prose-pre:bg-black/5 dark:prose-pre:bg-white/10 prose-pre:rounded-lg prose-pre:text-xs
  prose-headings:font-semibold
  prose-h1:text-sm prose-h2:text-sm prose-h3:text-[13px]
  prose-blockquote:pl-3 prose-blockquote:border-l-2 prose-blockquote:border-[var(--color-accent)] prose-blockquote:italic prose-blockquote:text-[13px]
  prose-strong:font-semibold
  prose-a:text-[var(--color-accent)] prose-a:no-underline hover:prose-a:underline`

/**
 * AI Popup 窗口样式（完整版，用于独立弹窗）
 */
export const AI_POPUP_WINDOW_PROSE = `prose prose-sm max-w-none text-[var(--color-text)]
  prose-p:my-1 prose-p:leading-relaxed prose-p:text-[13px]
  prose-ul:my-1 prose-ul:pl-4 prose-ul:text-[13px]
  prose-ol:my-1 prose-ol:pl-4 prose-ol:text-[13px]
  prose-li:my-0.5 prose-li:leading-snug
  prose-code:px-1 prose-code:py-0.5 prose-code:bg-black/5 dark:prose-code:bg-white/10 prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none
  prose-pre:my-1 prose-pre:p-2 prose-pre:bg-black/5 dark:prose-pre:bg-white/10 prose-pre:rounded-lg prose-pre:text-xs
  prose-headings:my-1 prose-headings:font-semibold
  prose-h1:text-sm prose-h2:text-sm prose-h3:text-[13px]
  prose-blockquote:my-1 prose-blockquote:pl-3 prose-blockquote:border-l-2 prose-blockquote:border-[var(--color-accent)] prose-blockquote:italic prose-blockquote:text-[13px]
  prose-strong:font-semibold
  prose-a:text-[var(--color-accent)] prose-a:no-underline hover:prose-a:underline`
