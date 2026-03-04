import { ChatWindowView } from './ChatWindowView'
import { useNoteScopedChatController } from './useNoteScopedChatController'

export default function ChatApp() {
  const { adapter, activeAdapter, compactChatProps } = useNoteScopedChatController()

  return (
    <ChatWindowView
      adapter={adapter}
      activeAdapter={activeAdapter}
      compactChatProps={compactChatProps}
    />
  )
}
