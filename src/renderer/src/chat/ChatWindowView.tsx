import { CompactChat, type ChatAdapter, type CompactChatProps } from '@yushaw/sanqian-chat/renderer'

interface ChatWindowViewProps {
  adapter: ChatAdapter | null
  activeAdapter: ChatAdapter
  compactChatProps: Omit<CompactChatProps, 'adapter' | 'className' | 'emptyState'>
}

export function ChatWindowView({
  adapter,
  activeAdapter,
  compactChatProps,
}: ChatWindowViewProps) {
  if (!adapter) {
    return (
      <div className="h-full">
        <div className="chat-window-container h-full flex items-center justify-center">
          <p className="text-[var(--chat-error)]">Failed to initialize chat</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full">
      <CompactChat
        adapter={activeAdapter}
        className="h-full"
        floating
        {...compactChatProps}
      />
    </div>
  )
}
