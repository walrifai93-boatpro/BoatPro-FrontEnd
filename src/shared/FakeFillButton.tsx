import { useEffect, useState } from 'react'
import { FlaskConical } from 'lucide-react'
import { testingToolsApi } from '../api'
import { translatePortalText } from '../i18n/runtime'


/**
 * Whether an admin has the "Fake fill" testing button switched on.
 *
 * Read once per mount rather than cached, so switching it off in Admin →
 * Testing Tools takes effect on the next form a tester opens. Starts `false`
 * and stays there on any failure: the button is a convenience, and a flaky read
 * must never make it appear on a live signup form.
 */
export function useFakeFillEnabled(): boolean {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    let alive = true
    testingToolsApi
      .get()
      .then((res) => { if (alive) setEnabled(res.data?.fakeFillEnabled === true) })
      .catch(() => {})
    return () => { alive = false }
  }, [])
  return enabled
}

/**
 * The testing button itself. Dashed and amber so it reads as a tool laid over
 * the form, not as part of the product a provider is signing up to.
 */
export function FakeFillButton({ onClick, className = '' }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={translatePortalText("Testing tool — fills every field except email and password with new sample data")}
      className={`inline-flex items-center gap-1.5 rounded-xl border-[1.5px] border-dashed border-amber-400 bg-amber-50 px-3 py-1.5 text-[12px] font-bold text-amber-800 transition hover:bg-amber-100 dark:border-amber-500/60 dark:bg-amber-950/30 dark:text-amber-300 dark:hover:bg-amber-950/50 ${className}`}
    >
      <FlaskConical size={14} /> {translatePortalText("Fake fill\n      ")}<span className="font-medium text-amber-700/80 dark:text-amber-300/70">{translatePortalText("· except email & password")}</span>
    </button>
  )
}
