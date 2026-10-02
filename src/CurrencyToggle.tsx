/**
 * The header currency control, and the glyphs it draws.
 *
 * Shaped after `ThemeToggle` in `theme.tsx` — same 40px circle, same
 * cross-fade — because it sits next to it and is the same kind of control: a
 * two-state preference about how the portal looks, not a setting that changes
 * anything underneath.
 *
 * The dollar comes from lucide. The riyal cannot: SAMA adopted the symbol in
 * 2025 and no icon set in the dependency tree ships it, so it is drawn here to
 * lucide's own conventions (24×24 box, 2px stroke, round caps) — which is also
 * what keeps the two glyphs optically matched at any size.
 */
import { AnimatePresence, motion } from 'framer-motion'
import { DollarSign } from 'lucide-react'
import { CURRENCY_LABELS, useCurrency, type CurrencyCode } from './currency'
import { translatePortalText } from './i18n/runtime'

/**
 * The riyal mark: the two descending strokes of the Arabic ر, crossed by the
 * pair of parallel bars that currency symbols conventionally carry (as in ₹,
 * ¥, €).
 */
export function RiyalSign({ size = 19 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M16.8 4.2v6.4c0 2.6-1.7 4.3-4.4 4.9" />
      <path d="M11.2 4.2v5.1c0 1.9-1.2 3.2-3.3 3.8" />
      <path d="M5 17.4 18.8 14.8" />
      <path d="M5 20.6 18.8 18" />
    </svg>
  )
}

/** The glyph for a currency, at an icon size. */
export function CurrencyIcon({ currency, size = 19 }: { currency: CurrencyCode; size?: number }) {
  return currency === 'USD' ? <DollarSign size={size} /> : <RiyalSign size={size} />
}

export function CurrencyToggle({ onDark = false }: { onDark?: boolean }) {
  const { currency, setCurrency } = useCurrency()
  // Two options, so this swaps rather than opening a menu. The title names the
  // currency you would move *to*, so it reads as an action; the glyph shows the
  // one you are in, so the header reads as state.
  const next: CurrencyCode = currency === 'SAR' ? 'USD' : 'SAR'

  return (
    <button
      title={`${translatePortalText('Show amounts in')} ${translatePortalText(CURRENCY_LABELS[next])}`}
      aria-label={`${translatePortalText('Show amounts in')} ${translatePortalText(CURRENCY_LABELS[next])}`}
      onClick={() => setCurrency(next)}
      className={`relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full transition-colors duration-300 ${
        onDark
          ? 'text-white/70 hover:bg-white/10 hover:text-white'
          : 'text-slate-500 hover:bg-ocean-50 hover:text-ocean-600'
      }`}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={currency}
          initial={{ y: 16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -16, opacity: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="grid place-items-center"
        >
          <CurrencyIcon currency={currency} />
        </motion.span>
      </AnimatePresence>
    </button>
  )
}
