// ---------------------------------------------------------------------------
// LoadingOverlay — the blurred full-screen "still working" state.
//
// Driven by foreground write requests in the shared API client. Reads render
// inline skeletons and background refreshes keep existing content visible.
// Four timings keep the overlay from being a nuisance:
//
//   APPEAR_DELAY — only instant (cached) answers skip it. It was 500ms, but the
//                  live API answers in 140–520ms, so almost nothing reached it.
//   MIN_VISIBLE  — once up, it stays long enough to read as a state, not a flash.
//   HIDE_GRACE   — back-to-back requests (save, then reload) share one overlay.
//   MAX_VISIBLE  — a request that hangs cannot lock the console. `fetch` has no
//                  timeout here, so without this a stalled call would.
//
// Same five indicators as the mobile apps' LoadingOverlay; the console uses the
// arc for providers and the segmented spinner for the admin console.
// ---------------------------------------------------------------------------
import React, { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useIsOverlayBusy } from './activity'
import { translatePortalText } from '../i18n/runtime'


export type LoaderVariant = 'arc' | 'dots' | 'thinking' | 'segments' | 'bars'

const APPEAR_DELAY = 100
const MIN_VISIBLE = 500
const HIDE_GRACE = 150
const MAX_VISIBLE = 20_000
const FADE_MS = 180

function useOverlayVisible(busy: boolean): boolean {
  const [visible, setVisible] = useState(false)
  const shownAt = useRef(0)
  /** Set when MAX_VISIBLE gave up; cleared once the requests actually finish. */
  const timedOut = useRef(false)

  useEffect(() => {
    if (busy) {
      if (visible || timedOut.current) return
      const t = window.setTimeout(() => { shownAt.current = Date.now(); setVisible(true) }, APPEAR_DELAY)
      return () => window.clearTimeout(t)
    }
    timedOut.current = false
    if (!visible) return
    const wait = Math.max(HIDE_GRACE, MIN_VISIBLE - (Date.now() - shownAt.current))
    const t = window.setTimeout(() => setVisible(false), wait)
    return () => window.clearTimeout(t)
  }, [busy, visible])

  useEffect(() => {
    if (!visible) return
    const t = window.setTimeout(() => { timedOut.current = true; setVisible(false) }, MAX_VISIBLE)
    return () => window.clearTimeout(t)
  }, [visible])

  return visible
}

// ── the five indicators — animation lives in index.css under `.bp-loader` ────

const INDICATORS: Record<LoaderVariant, () => React.ReactElement> = {
  arc: () => <span className="bp-arc" />,
  dots: () => (
    <span className="bp-dots">
      <i /><i /><i />
    </span>
  ),
  thinking: () => (
    <span className="bp-thinking">
      {translatePortalText("Thinking")}<span className="bp-dots bp-dots--small"><i /><i /><i /></span>
    </span>
  ),
  segments: () => (
    <span className="bp-segments">
      {Array.from({ length: 12 }, (_, i) => (
        <i key={i} style={{ transform: `rotate(${i * 30}deg)`, animationDelay: `${(i - 12) / 12}s` }} />
      ))}
    </span>
  ),
  bars: () => (
    <span className="bp-bars">
      <i /><i /><i />
    </span>
  ),
}

/** Just the indicator on its dark chip, for a page that wants one inline. */
export function LoaderGlyph({ variant = 'arc' }: { variant?: LoaderVariant }) {
  const Indicator = INDICATORS[variant]
  return (
    <div className="bp-loader grid h-[76px] min-w-[76px] place-items-center rounded-[22px] bg-[#141517]/[0.92] px-5 text-white shadow-2xl">
      <Indicator />
    </div>
  )
}

/** Mount once, inside the router, above every page. */
export function LoadingOverlay() {
  const busy = useIsOverlayBusy()
  const visible = useOverlayVisible(busy)
  const { pathname } = useLocation()
  const variant: LoaderVariant = pathname.startsWith('/admin') ? 'segments' : 'arc'

  // Stays mounted through the fade-out, then unmounts so it blocks nothing.
  const [mounted, setMounted] = useState(false)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (visible) {
      setMounted(true)
      const raf = requestAnimationFrame(() => setShown(true))
      return () => cancelAnimationFrame(raf)
    }
    setShown(false)
    const t = window.setTimeout(() => setMounted(false), FADE_MS)
    return () => window.clearTimeout(t)
  }, [visible])

  if (!mounted) return null

  return (
    <div
      role="progressbar"
      aria-label={translatePortalText("Loading")}
      aria-live="polite"
      aria-busy="true"
      // Swallows clicks while up; lets them through the moment it starts fading.
      className={`fixed inset-0 z-[900] grid place-items-center bg-white/20 backdrop-blur-[6px] transition-opacity dark:bg-slate-950/35 ${
        shown ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
      style={{ transitionDuration: `${FADE_MS}ms` }}
    >
      <LoaderGlyph variant={variant} />
    </div>
  )
}
