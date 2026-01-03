/**
 * Chat Window Entry Point
 *
 * Uses sanqian-chat's CompactChat with IPC adapter for floating chat window.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import ChatApp from './ChatApp'
// No styles imported - sanqian-chat handles all its own styling

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ChatApp />
  </StrictMode>
)
