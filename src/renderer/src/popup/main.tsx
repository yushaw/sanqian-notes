import React from 'react'
import ReactDOM from 'react-dom/client'
import PopupWindow from './PopupWindow'
import { I18nProvider } from '../i18n'
import '../styles/index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <PopupWindow />
    </I18nProvider>
  </React.StrictMode>
)
