import React, { useState } from 'react'
import { applyPortalLanguage, getPortalLanguage, type PortalLanguage } from './runtime'

function ArabicTranslationIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 44 36"
      className="h-[18px] w-[22px] shrink-0"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="1.5" y="2.5" width="25" height="29" rx="4" fill="#172033" stroke="#334155" />
      <text x="14" y="24" textAnchor="middle" fill="white" fontSize="20" fontWeight="700" fontFamily="Arial, sans-serif">A</text>
      <rect x="18" y="7.5" width="24.5" height="27" rx="4" fill="#111827" stroke="#475569" />
      <text x="30" y="27" textAnchor="middle" fill="white" fontSize="20" fontWeight="700" fontFamily="Arial, sans-serif">ع</text>
    </svg>
  )
}

export function LanguageToggle({ compact = false }: { compact?: boolean }) {
  const [language, setLanguage] = useState<PortalLanguage>(getPortalLanguage)

  const switchLanguage = () => {
    const next: PortalLanguage = language === 'ar' ? 'en' : 'ar'
    setLanguage(next)
    applyPortalLanguage(next)
    // Recreate the route tree once so every page and static catalog observes
    // the new language together, without stale labels in open menus or charts.
    window.location.reload()
  }

  return (
    <button
      type="button"
      onClick={switchLanguage}
      title={language === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'}
      aria-label={language === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'}
      className={`inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-white/90 px-3 text-xs font-bold text-deep-800 shadow-sm transition hover:border-ocean-300 hover:bg-ocean-50 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200 ${
        compact ? 'w-10 !px-0' : ''
      }`}
    >
      <ArabicTranslationIcon />
      {!compact && <span>{language === 'ar' ? 'English' : 'العربية'}</span>}
      {compact && <span className="sr-only">{language === 'ar' ? 'English' : 'العربية'}</span>}
    </button>
  )
}
