import React, { useEffect, useRef, useState } from 'react'
import { NavLink, useOutlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from './auth'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard, Map, Radar, CalendarDays, BookMarked, ArrowLeftRight, TableProperties,
  Anchor, UserRound, Users, Ship, Receipt, BarChart3,
  MessagesSquare, Star, Bell, FileCheck2, Settings, Search, Menu, X, Waves, LifeBuoy, Plus, LogOut, MapPin,
  Wind, Droplets, Eye, Sun, Moon, Sparkles, ShieldCheck,
} from 'lucide-react'
import { ToastStack, toast, CoverPhoto } from './ui'
import { ConfirmHost, RouteProgressBar } from './async'
import { ThemeToggle } from './theme'
import { LanguageToggle } from './i18n/LanguageToggle'
import { formatPortalDate, formatPortalNumber, formatPortalTime, isPortalArabic, localizedField, translatePortalText } from './i18n/runtime'
import { notificationsApi, portalApi, fileUrl, type ApiNotification } from './api'
import { fmtRelative, marinaCoverPhotos, useMarina, windDir, formatMoney, weatherText } from './live'
import { useOps } from './opsStore'
import MarinaStatusBanner from './components/MarinaStatusBanner'
import { CurrencyToggle } from './CurrencyToggle'

const NAV: { group: string; items: { to: string; label: string; icon: any; badge?: number }[] }[] = [
  { group: 'Overview', items: [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/live', label: 'Live Dock Map', icon: Map },
    { to: '/fleet-map', label: 'Live Fleet Map', icon: Radar },
    { to: '/calendar', label: 'Marina Calendar', icon: CalendarDays },
  ]},
  { group: 'Operations', items: [
    { to: '/reservations', label: 'Reservations', icon: BookMarked },
    { to: '/reservation-table', label: 'Reservation Master Table', icon: TableProperties },
    { to: '/movements', label: 'Arrivals & Departures', icon: ArrowLeftRight },
  ]},
  { group: 'Marina', items: [
    { to: '/berths', label: 'Berth Management', icon: Anchor },
    { to: '/profile', label: 'Marina Profile', icon: UserRound },
  ]},
  { group: 'People', items: [
    { to: '/customers', label: 'Boat Provider', icon: Users },
    { to: '/boats', label: 'Boats', icon: Ship },
  ]},
  { group: 'Finance', items: [
    { to: '/billing', label: 'Billing & Payments', icon: Receipt },
    { to: '/reports', label: 'Reports & Analytics', icon: BarChart3 },
  ]},
  { group: 'Engage', items: [
    { to: '/inbox', label: 'Inbox & Help', icon: MessagesSquare },
    { to: '/standing', label: 'Account standing', icon: ShieldCheck },
    { to: '/reviews', label: 'Reviews & Ratings', icon: Star },
    { to: '/notifications', label: 'Notifications', icon: Bell },
  ]},
  { group: 'Admin', items: [
    { to: '/vault', label: 'AI Document Vault', icon: Sparkles },
    { to: '/documents', label: 'Documents & Compliance', icon: FileCheck2 },
    { to: '/settings', label: 'Settings', icon: Settings },
  ]},
]

function Sidebar({ open, desktopOpen, onClose, onDesktopClose, onOpenWeather }: { open: boolean; desktopOpen: boolean; onClose: () => void; onDesktopClose: () => void; onOpenWeather?: () => void }) {
  const { marina } = useMarina()
  const { badges, weather } = useOps()
  // Live counters on the nav, from the marina's real numbers.
  const liveBadge: Record<string, number> = {
    '/reservations': badges.pending ?? 0,
    '/movements': badges.movements ?? 0,
    '/inbox': badges.messages ?? 0,
    '/notifications': badges.alerts ?? 0,
    '/documents': badges.documents ?? 0,
  }
  const tide = weather?.tides?.length ? weather.tides[weather.tides.length - 1].height : null

  return (
    <>
      <AnimatePresence>
        {open && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-40 bg-deep-950/50 backdrop-blur-sm lg:hidden" onClick={onClose} />}
      </AnimatePresence>
      <aside className={`portal-sidebar bg-hero-gradient fixed inset-y-0 start-0 z-50 flex w-[264px] flex-col text-white transition-transform duration-300 ${desktopOpen ? 'lg:translate-x-0' : 'lg:-translate-x-full'} ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center gap-3 px-5 pt-6 pb-4">
          <div className="relative h-12 w-12 shrink-0">
            <img src="/logo.png" alt={translatePortalText("BoatPro")} className="h-full w-full object-contain drop-shadow-[0_0_15px_rgba(55,184,217,0.3)]" onError={e => ((e.target as HTMLImageElement).style.display = 'none')} />
          </div>
          <div>
            <p className="font-display text-xl font-extrabold leading-tight tracking-wide text-white drop-shadow-sm">BoatPro</p>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-ocean-300">{translatePortalText("Marina Portal")}</p>
          </div>
          <button className="ms-auto lg:hidden text-white/60 hover:text-white" onClick={onClose}><X size={20} /></button>
          <button className="ms-auto hidden lg:block text-white/60 hover:text-white" onClick={onDesktopClose}><X size={20} /></button>
        </div>

        {/* The operator's own marina — their photo, name, city and VHF channel. */}
        <div className="mx-4 mb-3 overflow-hidden rounded-2xl border border-white/10">
          <div className="relative h-[86px]">
            <CoverPhoto srcs={marinaCoverPhotos(marina)} className="absolute inset-0 h-full w-full" />
            <div className="absolute inset-0 bg-gradient-to-t from-deep-950/90 via-deep-950/30 to-transparent" />
            <div className="absolute bottom-2 start-3">
              <p className="font-display text-sm font-bold"><bdi dir="auto">{localizedField(marina, 'name') || translatePortalText('Your Marina')}</bdi></p>
              <p className="flex items-center gap-1.5 text-[11px] text-ocean-200">
                <span className="relative flex h-2 w-2">
                  <span className={`absolute inline-flex h-full w-full rounded-full opacity-60 ${marina?.isActive === false ? 'bg-slate-400' : 'animate-ping bg-emerald-400'}`} />
                  <span className={`relative inline-flex h-2 w-2 rounded-full ${marina?.isActive === false ? 'bg-slate-400' : 'bg-emerald-400'}`} />
                </span>
                {[
                  translatePortalText(marina?.isActive === false ? 'Closed' : 'Open'),
                  localizedField(marina, 'city'),
                  marina?.settings?.vhfChannel ? `VHF ${marina.settings.vhfChannel}` : null,
                ].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-5 px-3 py-2 overflow-y-auto">
          {NAV.map((grp) => (
            <div key={grp.group}>
              <p className="px-3 pb-1 text-[10px] font-extrabold uppercase tracking-wider text-white/65">{translatePortalText(grp.group)}</p>
              <div className="space-y-0.5">
                {grp.items.map((it) => {
                  const b = liveBadge[it.to] ?? 0
                  return (
                    <NavLink
                      key={it.to}
                      to={it.to}
                      end={it.to === '/'}
                      onClick={onClose}
                      className={({ isActive }) =>
                        `flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-semibold transition-all ${
                          isActive
                            ? 'bg-white/15 text-white shadow-soft font-bold backdrop-blur border border-white/10'
                            : 'text-white/70 hover:bg-white/10 hover:text-white'
                        }`
                      }
                    >
                      <it.icon size={16} />
                      <span>{translatePortalText(it.label)}</span>
                      {b > 0 && (
                        <span className="ms-auto grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[9px] font-extrabold text-white animate-pulse-soft">
                          {formatPortalNumber(b)}
                        </span>
                      )}
                    </NavLink>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Live marine conditions for the marina's own coordinates. */}
        <div 
          onClick={onOpenWeather}
          className="mx-4 mb-4 rounded-2xl bg-white/8 p-3.5 backdrop-blur border border-white/10 cursor-pointer transition-all hover:bg-white/14 hover:scale-[1.02] group"
          title={translatePortalText("Click to view detailed weather forecast")}
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl animate-float inline-block">{weather && !weather.isDay ? '🌙' : '☀️'}</span>
            <div>
              <p className="font-display text-lg font-extrabold leading-none group-hover:text-ocean-200 transition-colors">
                {weather?.temperature != null ? `${formatPortalNumber(Math.round(weather.temperature))}°C` : '—'}
              </p>
              <p className="text-[11px] text-white/60">
                {weather?.windSpeed != null ? `${formatPortalNumber(Math.round(weather.windSpeed))} kn ${windDir(weather.windDirection)}` : translatePortalText('Conditions loading')}
                {tide != null ? ` · ${translatePortalText('Tide')} ${formatPortalNumber(tide)} m` : ''}
              </p>
            </div>
            <Waves size={20} className="ms-auto text-ocean-300 animate-pulse-soft group-hover:scale-110 transition-transform" />
          </div>
        </div>
      </aside>
    </>
  )
}

// Notification type → the drawer's icon + tone, matching the original palette.
const NOTIF_META: Record<string, { icon: string; tone: 'info' | 'success' | 'warn' | 'danger' }> = {
  booking_request: { icon: '🆕', tone: 'info' },
  booking_confirmed: { icon: '✅', tone: 'success' },
  booking_cancelled: { icon: '🚫', tone: 'danger' },
  booking_completed: { icon: '🏁', tone: 'info' },
  booking_modified: { icon: '✏️', tone: 'info' },
  berth_arrival: { icon: '⚓', tone: 'info' },
  berth_departure: { icon: '🛫', tone: 'info' },
  payment_success: { icon: '💳', tone: 'success' },
  payment_refund: { icon: '↩️', tone: 'warn' },
  work_order_assigned: { icon: '🔧', tone: 'warn' },
  utility_billed: { icon: '⚡', tone: 'warn' },
  incident_reported: { icon: '🚨', tone: 'danger' },
  emergency_sos: { icon: '🛟', tone: 'danger' },
  review_received: { icon: '⭐', tone: 'success' },
  documents_expiring: { icon: '📄', tone: 'warn' },
  document_approved: { icon: '📄', tone: 'success' },
  document_rejected: { icon: '📄', tone: 'danger' },
  document_action_required: { icon: '📄', tone: 'warn' },
  staff_assigned: { icon: '👷', tone: 'info' },
  fuel_arriving: { icon: '⛽', tone: 'info' },
  fuel_request: { icon: '⛽', tone: 'info' },
  trip_starting: { icon: '🛥️', tone: 'info' },
  trip_finished: { icon: '🏁', tone: 'info' },
  general: { icon: '🔔', tone: 'info' },
}

function NotifDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const tones: any = { info: 'bg-ocean-50 text-ocean-600', success: 'bg-emerald-50 text-emerald-600', warn: 'bg-amber-50 text-amber-600', danger: 'bg-rose-50 text-rose-600' }
  const nav = useNavigate()
  const { alerts, unread, reloadAlerts } = useOps()
  const [busy, setBusy] = useState(false)

  const markAll = async () => {
    setBusy(true)
    try {
      await notificationsApi.markAllRead()
      await reloadAlerts()
      toast('All notifications marked as read')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not mark them read', 'warn')
    } finally { setBusy(false) }
  }

  const openOne = async (n: ApiNotification) => {
    if (!n.isRead) await notificationsApi.markRead(n.id).catch(() => {})
    await reloadAlerts()
    onClose()
    nav('/notifications')
  }

  return (
    <AnimatePresence>
      {open && (<>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[80] bg-deep-950/40 backdrop-blur-sm" onClick={onClose} />
        <motion.aside initial={{ x: 420 }} animate={{ x: 0 }} exit={{ x: 420 }} transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          className="fixed end-0 top-0 z-[85] flex h-full w-full max-w-md flex-col bg-white shadow-lift">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h3 className="font-display text-lg font-bold">{translatePortalText("🔔 Notifications ")}{unread > 0 && <span className="ms-1 rounded-full bg-ocean-500 px-2 py-0.5 text-xs text-white">{formatPortalNumber(unread)}</span>}</h3>
            <div className="flex gap-2">
              <button className="btn-ghost !py-1.5 !px-3 text-xs disabled:opacity-40" disabled={unread === 0 || busy} onClick={markAll}>{translatePortalText("Mark all read")}</button>
              <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={18} /></button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {alerts.length === 0 && <p className="py-10 text-center text-sm text-slate-400">{translatePortalText("Nothing new — you're all caught up.")}</p>}
            {alerts.map((n, i) => {
              const meta = NOTIF_META[n.type] ?? NOTIF_META.general
              return (
                <motion.button key={n.id} initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
                  onClick={() => openOne(n)}
                  className={`flex w-full gap-3 rounded-2xl border p-3.5 text-left transition hover:shadow-soft ${!n.isRead ? 'border-ocean-100 bg-ocean-50/40' : 'border-slate-100 bg-white'}`}>
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg ${tones[meta.tone]}`}>{meta.icon}</span>
                  <div className="min-w-0">
                    <p className="text-xs font-extrabold uppercase tracking-wide text-slate-400">{localizedField<string>(n, 'title') ?? translatePortalText(n.title)} · {fmtRelative(n.createdAt)}</p>
                    <p className="mt-0.5 text-sm font-medium text-deep-800">{localizedField<string>(n, 'body') ?? translatePortalText(n.body)}</p>
                  </div>
                  {!n.isRead && <span className="ms-auto mt-1 h-2 w-2 shrink-0 rounded-full bg-ocean-500" />}
                </motion.button>
              )
            })}
          </div>
        </motion.aside>
      </>)}
    </AnimatePresence>
  )
}

function QuickDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate()
  const acts = [
    { icon: '🛥️', label: 'New Reservation', to: '/reservations' }, { icon: '⚓', label: 'Check-In Boat', to: '/movements' },
    { icon: '🧾', label: 'Create Invoice', to: '/billing' }, { icon: '🔧', label: 'New Work Order', to: '/maintenance' },
    { icon: '🅿️', label: 'Add Berth', to: '/berths' }, { icon: '🚨', label: 'Report Incident', to: '/emergency' },
    { icon: '💬', label: 'Message Guest', to: '/messages' }, { icon: '📊', label: 'View Reports', to: '/reports' },
  ]
  return (
    <AnimatePresence>
      {open && (<>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[80] bg-deep-950/40 backdrop-blur-sm" onClick={onClose} />
        <motion.div initial={{ opacity: 0, y: -16, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -12 }}
          className="fixed left-1/2 top-24 z-[85] w-[92%] max-w-xl -translate-x-1/2 card p-6">
          <h3 className="font-display text-lg font-bold mb-4">{translatePortalText("⚡ Quick Actions")}</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {acts.map((a, i) => (
              <motion.button key={a.label} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.04 }}
                onClick={() => { onClose(); nav(a.to) }}
                className="flex flex-col items-center gap-2 rounded-2xl border border-slate-100 bg-sand p-4 text-center transition hover:border-ocean-300 hover:bg-ocean-50 hover:shadow-soft active:scale-95">
                <span className="text-2xl">{a.icon}</span>
                <span className="text-xs font-bold text-deep-800">{translatePortalText(a.label)}</span>
              </motion.button>
            ))}
          </div>
        </motion.div>
      </>)}
    </AnimatePresence>
  )
}

type SearchHit = { kind: string; icon: string; title: string; sub: string; to: string; avatar?: string }

const HIT_META: Record<string, { kind: string; icon: string }> = {
  berth: { kind: 'Berth', icon: '⚓' },
  reservation: { kind: 'Booking', icon: '📋' },
  staff: { kind: 'Staff', icon: '👤' },
  work_order: { kind: 'Work order', icon: '🔧' },
}

function GlobalSearch() {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [hits, setHits] = useState<SearchHit[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); inputRef.current?.focus() }
      if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur() }
    }
    const onClick = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('keydown', onKey); window.addEventListener('mousedown', onClick)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onClick) }
  }, [])

  // Debounced query against the marina-wide search endpoint.
  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) { setHits([]); return }
    const t = setTimeout(() => {
      portalApi.search(term)
        .then(r => {
          setHits(r.data.results.map(h => ({
            kind: HIT_META[h.kind]?.kind ?? h.kind,
            icon: HIT_META[h.kind]?.icon ?? '🔎',
            title: h.title,
            sub: h.subtitle ?? '',
            to: h.href,
            avatar: h.avatar,
          })))
          setActive(0)
        })
        .catch(() => setHits([]))
    }, 220)
    return () => clearTimeout(t)
  }, [q])

  const go = (h: SearchHit) => { setOpen(false); setQ(''); toast(translatePortalText(`Opening ${h.kind.toLowerCase()} “${h.title}”`), 'info'); nav(h.to) }

  return (
    <div ref={wrapRef} className="relative hidden flex-1 max-w-md sm:block">
      <Search size={16} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
      <input ref={inputRef} value={q}
        onChange={e => { setQ(e.target.value); setOpen(true); setActive(0) }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, hits.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
          else if (e.key === 'Enter' && hits[active]) { e.preventDefault(); go(hits[active]) }
        }}
        placeholder={translatePortalText("Search berths, boats, customers, bookings…")} className="input !rounded-full ps-10 pe-14" />
      <kbd className="absolute end-3.5 top-1/2 -translate-y-1/2 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-400">⌘K</kbd>
      <AnimatePresence>
        {open && q.trim() && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
            className="absolute start-0 end-0 top-full z-50 mt-2 max-h-80 overflow-y-auto rounded-2xl border border-slate-100 bg-white p-2 shadow-lift">
            {hits.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-slate-400">{translatePortalText(`No matches for “${q}”.`)}</p>
            ) : hits.map((h, i) => (
              <button key={h.kind + h.title + i} onMouseEnter={() => setActive(i)} onClick={() => go(h)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition ${i === active ? 'bg-ocean-50' : 'hover:bg-sand'}`}>
                {h.avatar
                  ? <img src={fileUrl(h.avatar)} alt="" className="h-8 w-8 shrink-0 rounded-lg object-cover" />
                  : <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sand text-base">{h.icon}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-deep-900">{translatePortalText(h.title)}</span>
                  <span className="block truncate text-xs text-slate-400">{translatePortalText(h.sub)}</span>
                </span>
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">{translatePortalText(h.kind)}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Splash() {
  return (
    <motion.div exit={{ opacity: 0, scale: 1.06 }} transition={{ duration: 0.5 }}
      className="bg-hero-gradient fixed inset-0 z-[200] grid place-items-center">
      <div className="text-center text-white">
        <div className="relative mx-auto mb-6 h-28 w-28">
          <img src="/logo.png" alt={translatePortalText("BoatPro")} className="h-full w-full object-contain drop-shadow-[0_0_25px_rgba(55,184,217,0.5)]" onError={e => ((e.target as HTMLImageElement).style.display = 'none')} />
        </div>
        <p className="font-display text-4xl font-extrabold tracking-tight text-white drop-shadow-md">
          {'BoatPro'.split('').map((ch, i) => (
            <span key={i} className="splash-letter inline-block" style={{ animationDelay: `${0.1 + i * 0.05}s` }}>{ch === ' ' ? ' ' : ch}</span>
          ))}
        </p>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }}
          className="mt-1 text-xs font-bold uppercase tracking-[0.35em] text-ocean-300">{translatePortalText("Marina Portal")}</motion.p>
        <motion.div initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 0.3, duration: 0.9, ease: 'easeInOut' }}
          className="mx-auto mt-6 h-0.5 w-44 origin-left rounded-full bg-gradient-to-r from-ocean-400 to-ocean-300" />
      </div>
    </motion.div>
  )
}

/** The harbour status ticker, built from the marina's own live numbers. */
function useTicker(): string[] {
  const { overview, weather } = useOps()
  const { currency } = useMarina()
  const lines: string[] = []

  if (overview) {
    const b = overview.berths
    lines.push(isPortalArabic()
      ? `⚓ الإشغال ${formatPortalNumber(overview.occupancyRate)}٪ · ${formatPortalNumber(b.booked ?? 0)} من ${formatPortalNumber(b.total ?? 0)} رصيف قيد الاستخدام`
      : `⚓ Occupancy ${overview.occupancyRate}% · ${b.booked ?? 0} of ${b.total ?? 0} berths in use`)
    if (b.available) lines.push(isPortalArabic()
      ? `🅿️ الأرصفة المتاحة الآن: ${formatPortalNumber(b.available)}`
      : `🅿️ ${b.available} berth${b.available === 1 ? '' : 's'} available now`)
    const pending = overview.reservationStatusCounts.pending_approval ?? 0
    if (pending) lines.push(isPortalArabic()
      ? `📋 طلبات الحجوزات بانتظار المراجعة: ${formatPortalNumber(pending)}`
      : `📋 ${pending} booking request${pending === 1 ? '' : 's'} awaiting review`)
    const duePayment = overview.reservationStatusCounts.pending_payment ?? 0
    if (duePayment) lines.push(isPortalArabic()
      ? `💳 حجوزات بانتظار الدفع: ${formatPortalNumber(duePayment)}`
      : `💳 ${duePayment} reservation${duePayment === 1 ? '' : 's'} awaiting payment`)
    const next = overview.arrivals.find(a => a.status === 'expected' || a.status === 'en_route')
    if (next) {
      const eta = formatPortalTime(next.scheduledAt)
      const boatName = localizedField(next, 'boatName') ?? next.boatName
      lines.push(isPortalArabic()
        ? `🛥️ القارب التالي: ${boatName} — وقت الوصول المتوقع ${eta}${next.pontoon ? ` ← ${next.pontoon}-${String(next.slot ?? 0).padStart(2, '0')}` : ''}`
        : `🛥️ Next arrival: ${boatName} — ETA ${eta}${next.pontoon ? ` → ${next.pontoon}-${String(next.slot ?? 0).padStart(2, '0')}` : ''}`)
    }
    if (overview.revenue.month.gross) lines.push(isPortalArabic()
      ? `💰 إيرادات هذا الشهر: ${formatMoney(overview.revenue.month.gross, currency)}`
      : `💰 ${formatMoney(overview.revenue.month.gross, currency)} earned this month`)
    const urgentWork = overview.workOrders.filter(w => w.priority === 'critical' || w.priority === 'high')
    if (urgentWork.length) {
      const title = localizedField(urgentWork[0], 'title') ?? urgentWork[0].title
      lines.push(isPortalArabic()
        ? `🔧 ${title}${urgentWork[0].dueDate ? ` — موعد الاستحقاق ${formatPortalDate(urgentWork[0].dueDate)}` : ''}`
        : `🔧 ${title}${urgentWork[0].dueDate ? ` due ${urgentWork[0].dueDate}` : ''}`)
    }
    if (overview.marina.settings?.vhfChannel) lines.push(isPortalArabic()
      ? `📻 مكتب المرسى على أهبة الاستعداد عبر قناة VHF ${overview.marina.settings.vhfChannel}`
      : `📻 Harbor office standing by on VHF ${overview.marina.settings.vhfChannel}`)
    if (overview.rating.count) lines.push(isPortalArabic()
      ? `⭐ متوسط تقييم الضيوف ${formatPortalNumber(overview.rating.average, { maximumFractionDigits: 1 })} من ${formatPortalNumber(overview.rating.count)} مراجعة`
      : `⭐ ${overview.rating.average} average guest rating from ${overview.rating.count} review${overview.rating.count === 1 ? '' : 's'}`)
  }
  if (weather) {
    if (weather.tides.length) lines.push(isPortalArabic()
      ? `🌊 مستوى المد ${formatPortalNumber(weather.tides[weather.tides.length - 1].height)} م`
      : `🌊 Tide ${weather.tides[weather.tides.length - 1].height} m`)
    if (weather.windSpeed != null) lines.push(isPortalArabic()
      ? `💨 الرياح ${windDir(weather.windDirection)} ${formatPortalNumber(Math.round(weather.windSpeed))} عقد${weather.windGust != null ? `، هبّات ${formatPortalNumber(Math.round(weather.windGust))} عقد` : ''}`
      : `💨 Wind ${windDir(weather.windDirection)} ${Math.round(weather.windSpeed)} kn${weather.windGust != null ? `, gusts ${Math.round(weather.windGust)} kn` : ''}`)
    if (weather.warning) lines.push(`⚠️ ${translatePortalText(weather.warning)}`)
  }
  return lines
}

function Clock() {
  const { marina } = useMarina()
  const [now, setNow] = useState(new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])
  return (
    <div className="hidden xl:flex flex-col items-end pe-1 leading-tight">
      <span className="font-display text-sm font-extrabold tabular-nums text-deep-900">{now.toLocaleTimeString(isPortalArabic() ? 'ar-SA-u-ca-gregory' : 'en-US', { hour12: false })}</span>
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
        {formatPortalDate(now, { weekday: 'short', month: 'short', day: 'numeric' })}{marina?.city ? ` · ${localizedField(marina, 'city')}` : ''}
      </span>
    </div>
  )
}

function WeatherModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { weather } = useOps()
  const { marina } = useMarina()

  if (!open) return null

  const temp = weather?.temperature != null ? Math.round(weather.temperature) : 28
  const code = weather?.weatherCode ?? 0
  const isDay = weather?.isDay ?? true
  const windSpeed = weather?.windSpeed != null ? Math.round(weather.windSpeed) : 12
  const windGust = weather?.windGust != null ? Math.round(weather.windGust) : 16
  const direction = weather?.windDirection ?? 310
  const humidity = weather?.humidity ?? 65
  const visibility = weather?.visibilityKm ?? 10
  const tides = weather?.tides ?? []

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="portal-dark-workspace fixed inset-0 z-50 flex items-center justify-center p-4 bg-deep-950/60 backdrop-blur-md"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-lg overflow-hidden rounded-3xl bg-slate-900 text-white shadow-2xl border border-white/10"
        >
          {/* Header */}
          <div className="relative bg-gradient-to-br from-ocean-600 via-ocean-700 to-deep-900 p-6 text-white">
            <button
              onClick={onClose}
              className="absolute end-4 top-4 grid h-8 w-8 place-items-center rounded-full bg-white/10 text-white/80 hover:bg-white/20 transition"
            >
              <X size={18} />
            </button>
            <div className="flex items-center gap-2 text-xs font-bold text-ocean-200">
              <MapPin size={14} />
              <span>{marina?.city ? `${localizedField(marina, 'city')} ${translatePortalText('Harbor')}` : translatePortalText('Live Coastal Waters')}</span>
              <span className="ms-auto text-[10px] uppercase opacity-75">{translatePortalText("Live Meteorological Feed")}</span>
            </div>
            <div className="mt-4 flex items-end gap-4">
              <span className="text-5xl animate-float">{isDay ? '☀️' : '🌙'}</span>
              <div>
                <h2 className="font-display text-4xl font-extrabold tracking-tight">{formatPortalNumber(temp)}°C</h2>
                <p className="text-xs font-semibold text-ocean-100">{translatePortalText(weatherText(code))}</p>
              </div>
            </div>

            {/* Maritime Safety Badge */}
            <div className="mt-5 flex items-center gap-2.5 rounded-2xl bg-black/25 px-4 py-2.5 text-xs font-bold backdrop-blur">
              <span className={`h-2.5 w-2.5 rounded-full ${windSpeed < 18 ? 'bg-emerald-400' : 'bg-amber-400'} animate-pulse`} />
              <span>{translatePortalText(windSpeed < 18 ? '🟢 Favorable Conditions for Berthing & Departures' : '🟡 Wind Warning: High Gusts in Channel')}</span>
            </div>
          </div>

          {/* Details Grid */}
          <div className="p-6 space-y-4 bg-slate-900">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-2xl bg-white/5 p-4 border border-white/5">
                <div className="flex items-center gap-2 text-slate-400 font-semibold mb-1">
                  <Wind size={16} className="text-ocean-400" />
                  <span>{translatePortalText("Wind & Gusts")}</span>
                </div>
                <p className="font-display text-lg font-bold text-white">{formatPortalNumber(windSpeed)} {translatePortalText("kn ")}{windDir(direction)}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{translatePortalText("Gusts up to ")}{formatPortalNumber(windGust)} {translatePortalText("kn")}</p>
              </div>

              <div className="rounded-2xl bg-white/5 p-4 border border-white/5">
                <div className="flex items-center gap-2 text-slate-400 font-semibold mb-1">
                  <Waves size={16} className="text-emerald-400" />
                  <span>{translatePortalText("Sea State")}</span>
                </div>
                <p className="font-display text-lg font-bold text-white">{translatePortalText(windSpeed < 10 ? 'Calm Glass' : windSpeed < 18 ? 'Smooth Chop' : 'Moderate Swell')}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{translatePortalText("Waves ")}{windSpeed < 10 ? `${formatPortalNumber(0.1)}–${formatPortalNumber(0.3)}` : `${formatPortalNumber(0.4)}–${formatPortalNumber(1)}`} {translatePortalText('Meter abbreviation')}</p>
              </div>

              <div className="rounded-2xl bg-white/5 p-4 border border-white/5">
                <div className="flex items-center gap-2 text-slate-400 font-semibold mb-1">
                  <Eye size={16} className="text-amber-400" />
                  <span>{translatePortalText("Visibility")}</span>
                </div>
                <p className="font-display text-lg font-bold text-white">{formatPortalNumber(visibility)} {translatePortalText("km")}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{translatePortalText("Clear navigation view")}</p>
              </div>

              <div className="rounded-2xl bg-white/5 p-4 border border-white/5">
                <div className="flex items-center gap-2 text-slate-400 font-semibold mb-1">
                  <Droplets size={16} className="text-cyan-400" />
                  <span>{translatePortalText("Humidity")}</span>
                </div>
                <p className="font-display text-lg font-bold text-white">{formatPortalNumber(humidity)}٪</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{translatePortalText("Coastal moisture")}</p>
              </div>
            </div>

            {tides.length > 0 && (
              <div className="rounded-2xl bg-white/5 p-3.5 border border-white/5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">{translatePortalText("Tide Level Today (m)")}</p>
                <div className="flex items-center justify-between text-xs font-semibold text-ocean-200">
                  <span>{translatePortalText("Current Tide: ")}{formatPortalNumber(tides[tides.length - 1]?.height)} {translatePortalText('Meter abbreviation')}</span>
                  <span>{translatePortalText("Range: ")}{formatPortalNumber(Math.min(...tides.map(t => t.height)))}–{formatPortalNumber(Math.max(...tides.map(t => t.height)))} {translatePortalText('Meter abbreviation')}</span>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

export default function Layout() {
  const [side, setSide] = useState(false)
  const [desktopSide, setDesktopSide] = useState(true)
  const [notif, setNotif] = useState(false)
  const [quick, setQuick] = useState(false)
  const [weatherModal, setWeatherModal] = useState(false)
  const nav = useNavigate()
  const { logout, user } = useAuth()
  const { marina } = useMarina()
  const { unread, weather } = useOps()
  const loc = useLocation()
  const ticker = useTicker()

  return (
    <div className="min-h-screen overflow-x-hidden">
      <Sidebar open={side} desktopOpen={desktopSide} onClose={() => setSide(false)} onDesktopClose={() => setDesktopSide(false)} onOpenWeather={() => setWeatherModal(true)} />
      <div data-sidebar-open={desktopSide ? 'true' : 'false'} className={`portal-main-offset transition-all duration-300 ${desktopSide ? 'lg:ps-[264px]' : 'lg:ps-0'}`}>
        <header className="sticky top-0 z-30 glass border-b border-slate-100/60">
          <div className="flex items-center gap-3 px-4 py-3 md:px-7">
            <button className="lg:hidden btn-ghost !p-2" onClick={() => setSide(true)}><Menu size={18} /></button>
            <button className={`hidden lg:block btn-ghost !p-2 transition-opacity ${desktopSide ? 'opacity-0 pointer-events-none w-0 !p-0' : 'opacity-100'}`} onClick={() => setDesktopSide(true)}><Menu size={18} /></button>
            <GlobalSearch />
            <div className="ms-auto flex items-center gap-1.5">
              <button title={translatePortalText("Quick actions")} onClick={() => setQuick(true)} className="btn-primary !rounded-full !px-3.5 !py-2 hidden md:inline-flex"><Plus size={16} /> {translatePortalText("Quick action")}</button>
              <button
                title={translatePortalText("Live Marine Weather")}
                onClick={() => setWeatherModal(true)}
                className="hidden sm:flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-deep-900 transition hover:bg-slate-50 hover:shadow-soft"
              >
                <span className="text-sm">{weather && !weather.isDay ? '🌙' : '☀️'}</span>
                <span>{weather?.temperature != null ? `${formatPortalNumber(Math.round(weather.temperature))}°C` : translatePortalText('Weather')}</span>
              </button>
              <CurrencyToggle />
              <LanguageToggle />
              <ThemeToggle />
              <button title={translatePortalText("Emergency")} onClick={() => nav('/emergency')} className="relative grid h-10 w-10 place-items-center rounded-full text-rose-500 transition hover:bg-rose-50"><LifeBuoy size={19} /></button>
              <button title={translatePortalText("Notifications")} onClick={() => setNotif(true)} className="relative grid h-10 w-10 place-items-center rounded-full text-slate-500 transition hover:bg-ocean-50 hover:text-ocean-600">
                <Bell size={19} />
                {unread > 0 && (
                  <span className="absolute end-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[9px] font-extrabold text-white animate-pulse-soft">{unread > 9 ? `${formatPortalNumber(9)}+` : formatPortalNumber(unread)}</span>
                )}
              </button>
              <button onClick={() => nav('/settings')} className="ms-1 flex items-center gap-2.5 rounded-full border border-slate-200 bg-white py-1 ps-1 pe-3 transition hover:shadow-soft">
                <img src={fileUrl(user?.avatar) ?? `https://ui-avatars.com/api/?name=${encodeURIComponent(user?.name ?? 'Marina')}&background=1b9bbf&color=fff`}
                  alt={user?.name ?? ''} className="h-8 w-8 rounded-full object-cover" />
                <span className="hidden text-left md:block">
                  <span className="block text-xs font-extrabold text-deep-900 leading-tight">{user?.name ?? translatePortalText('Marina operator')}</span>
                  <span className="block text-[10px] font-semibold text-slate-400">{translatePortalText("Marina Manager")}</span>
                </span>
              </button>
              <button title={translatePortalText("Sign out")} onClick={() => { logout(); nav('/login') }}
                className="grid h-10 w-10 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-deep-900"><LogOut size={17} /></button>
              <Clock />
            </div>
          </div>
          {/* harbor status ticker */}
          {ticker.length > 0 && (
            <div className="relative overflow-hidden border-t border-slate-100/70 bg-deep-950/[0.03]">
              <div className="animate-ticker flex w-max items-center gap-10 whitespace-nowrap px-6 py-1.5 text-[11px] font-bold text-slate-500">
                {[...ticker, ...ticker].map((t, i) => (
                  <span key={i} className="flex items-center gap-2">{translatePortalText(t)}<span className="h-1 w-1 rounded-full bg-ocean-300" /></span>
                ))}
              </div>
              <div className="pointer-events-none absolute inset-y-0 start-0 w-16 bg-gradient-to-r from-sand to-transparent" />
              <div className="pointer-events-none absolute inset-y-0 end-0 w-16 bg-gradient-to-l from-sand to-transparent" />
            </div>
          )}
        </header>
        <MarinaStatusBanner />
        <main className="px-4 py-6 md:px-7 md:py-7 max-w-[1600px]">
          <AnimatePresence mode="wait">
            <motion.div key={loc.pathname} initial={{ opacity: 0, y: 18, scale: 0.995 }} animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.995 }} transition={{ duration: 0.28, ease: 'easeOut' }}>
              {useOutlet()}
            </motion.div>
          </AnimatePresence>
          <footer className="mt-10 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-5 pb-2 text-xs text-slate-400">
            <p>© {formatPortalNumber(new Date().getFullYear())} HarborLink · <bdi dir="auto">{localizedField(marina, 'name') || translatePortalText('Your Marina')}</bdi> · {translatePortalText('Powered by BoatPro')}</p>
            <p className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse-soft" /> {translatePortalText("All systems operational")}</p>
          </footer>
        </main>
      </div>
      <NotifDrawer open={notif} onClose={() => setNotif(false)} />
      <QuickDrawer open={quick} onClose={() => setQuick(false)} />
      <WeatherModal open={weatherModal} onClose={() => setWeatherModal(false)} />
      <ToastStack />
      {/* Global async-UX hosts. `RouteProgressBar` is the top sliver for
          in-flight requests; `ConfirmHost` renders whatever `confirm()` /
          `confirmAndRun()` asked for, from anywhere in the tree. */}
      <RouteProgressBar />
      <ConfirmHost />
    </div>
  )
}

