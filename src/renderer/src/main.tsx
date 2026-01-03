import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/index.css'
// Import SDK styles for chat components
import '@yushaw/sanqian-chat/renderer/styles/variables.css'

// Import preload types to ensure they are available globally
import '../../preload/index.d'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
