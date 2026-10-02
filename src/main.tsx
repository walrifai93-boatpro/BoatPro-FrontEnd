import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { applyTheme, getTheme } from './theme'
import { bootstrapPortalLanguage, getPortalLanguage } from './i18n/runtime'

applyTheme(getTheme())

const root = ReactDOM.createRoot(document.getElementById('root')!)
const languageReady = bootstrapPortalLanguage()

if (getPortalLanguage() === 'ar') {
  root.render(
    <main lang="ar" dir="rtl" className="grid min-h-screen place-items-center bg-deep-950 text-white">
      <p className="rounded-2xl border border-white/10 bg-white/5 px-6 py-4 text-sm">جارٍ تجهيز الواجهة العربية…</p>
    </main>,
  )
}

void languageReady.then(() => root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
))
