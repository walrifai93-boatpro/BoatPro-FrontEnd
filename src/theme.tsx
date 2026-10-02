import React, { useEffect, useState } from 'react'
import { Sun, Moon } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { translatePortalText } from './i18n/runtime'

const KEY = 'bp-theme'
export const getTheme = (): 'dark' | 'light' => (localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light')
export const applyTheme = (t: 'dark' | 'light') => document.documentElement.classList.toggle('dark', t === 'dark')

export function ThemeToggle({ onDark = false }: { onDark?: boolean }) {
  const [theme, setTheme] = useState<'dark' | 'light'>(getTheme)
  useEffect(() => { applyTheme(theme); localStorage.setItem(KEY, theme) }, [theme])
  const dark = theme === 'dark'
  return (
    <button title={translatePortalText(dark ? 'Switch to light mode' : 'Switch to dark mode')} onClick={() => setTheme(dark ? 'light' : 'dark')}
      className={`relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full transition-colors duration-300 ${
        onDark ? 'text-white/70 hover:bg-white/10 hover:text-amber-300'
          : dark ? 'text-amber-300 hover:bg-amber-50' : 'text-slate-500 hover:bg-ocean-50 hover:text-ocean-600'}`}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={theme} initial={{ y: 16, opacity: 0, rotate: -90 }} animate={{ y: 0, opacity: 1, rotate: 0 }}
          exit={{ y: -16, opacity: 0, rotate: 90 }} transition={{ duration: 0.25, ease: 'easeOut' }} className="grid place-items-center">
          {dark ? <Moon size={19} /> : <Sun size={19} />}
        </motion.span>
      </AnimatePresence>
    </button>
  )
}
