import React, { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, useOutlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard, Fuel, Warehouse, BookMarked, ClipboardList, Tags, Receipt,
  LifeBuoy, MessagesSquare, Bell, BarChart3, Settings, Search, Menu, X, Plus, Flame, LogOut, Droplets, CalendarDays, ShieldCheck,
  ChevronDown, Check,
  Star,
} from 'lucide-react'
import { notifStyle, relativeTime, avatar, stationCoverPhotos } from './fuelData'
import { FuelProvider, useFuel, ALL_STATIONS } from './fuelStore'
import { fuelApi, type FuelWorkerPermission, type ApiFuelAccess } from './fuelApi'
import { notificationsApi, fileUrl } from '../api'
import { ToastStack, toast, CoverPhoto } from '../ui'
import { ConfirmHost, RouteProgressBar } from '../async'
import { ThemeToggle } from '../theme'
import { LanguageToggle } from '../i18n/LanguageToggle'
import { formatPortalNumber, localizedField, portalLocale, translatePortalText } from '../i18n/runtime'
import FuelStatusBanner from './components/FuelStatusBanner'
import { formatMoney } from '../live'

type NavItem = {
  to: string
  label: string
  icon: any
  badge?: keyof ReturnType<typeof badgeKeys>
  /** Page permission required to see this item — omitted means always visible to any active worker. */
  perm?: FuelWorkerPermission
  /** Visible to the owner/admin only, regardless of granted permissions (team management). */
  ownerOnly?: boolean
}

const NAV: { group: string; items: NavItem[] }[] = [
  { group: 'Overview', items: [
    { to: '/fuel', label: translatePortalText("Dashboard"), icon: LayoutDashboard },
    { to: '/fuel/calendar', label: translatePortalText("Fuel Calendar"), icon: CalendarDays, perm: 'calendar' },
    // No Live Tracking: fuel is served at the station only, so there is no
    // barge or truck out on the water to follow.
  ]},
  { group: 'Operations', items: [
    { to: '/fuel/bookings', label: translatePortalText("Fuel Booking Request"), icon: BookMarked, badge: 'pendingOrders', perm: 'bookings' },
    { to: '/fuel/deliveries', label: translatePortalText("Fuel Booking Management"), icon: ClipboardList, badge: 'openOrders', perm: 'deliveries' },
    { to: '/fuel/inventory', label: translatePortalText("Inventory & Tanks"), icon: Warehouse, badge: 'lowStock', perm: 'inventory' },
  ]},
  { group: 'Business', items: [
    { to: '/fuel/pricing', label: translatePortalText("Pricing"), icon: Tags, perm: 'pricing' },
    { to: '/fuel/billing', label: translatePortalText("Billing & Payments"), icon: Receipt, perm: 'billing' },
    { to: '/fuel/reports', label: translatePortalText("Reports & Analytics"), icon: BarChart3, perm: 'reports' },
  ]},
  { group: 'Engage', items: [
    { to: '/fuel/inbox', label: translatePortalText("Inbox & Help"), icon: MessagesSquare, badge: 'unread' },
    { to: '/fuel/standing', label: translatePortalText("Account standing"), icon: ShieldCheck, ownerOnly: true },
    { to: '/fuel/notifications', label: translatePortalText("Notifications"), icon: Bell, perm: 'notifications' },
    // Ungated on purpose: what customers say about the station is not one team
    // member's page to be shut out of, and the reply is the only thing the
    // reputation score measures responsiveness on.
    { to: '/fuel/reviews', label: translatePortalText("Reviews"), icon: Star },
  ]},
  { group: 'Admin', items: [
    { to: '/fuel/station', label: translatePortalText("Station Profile"), icon: Fuel, perm: 'station' },
    { to: '/fuel/workers', label: translatePortalText("Team & Access"), icon: ShieldCheck, ownerOnly: true },
  ]},
]

/** Which of NAV's items a given session may see — owner/admin get everything. */
function visibleNav(access: ApiFuelAccess | null) {
  const isOwner = access?.isOwner ?? true // default open while fuelAccess is still loading
  const allowed = (item: NavItem) => {
    if (item.ownerOnly) return isOwner
    if (!item.perm) return true
    return isOwner || !!access?.permissions.includes(item.perm)
  }
  return NAV.map(g => ({ ...g, items: g.items.filter(allowed) })).filter(g => g.items.length > 0)
}

// Type helper so NAV's `badge` keys stay in step with the store's counters.
function badgeKeys() {
  return { pendingOrders: 0, openOrders: 0, lowStock: 0, unread: 0, emergencies: 0 }
}

function Sidebar({ open, desktopOpen, onClose, onDesktopClose }: { open: boolean; desktopOpen: boolean; onClose: () => void; onDesktopClose: () => void }) {
  const { station, stations, currentStationId, isAllStations, setCurrentStationId, products, counts, currency } = useFuel()
  const { fuelAccess } = useAuth()
  const nav = useMemo(() => visibleNav(fuelAccess), [fuelAccess])
  const headline = products.find((p) => p.bulk) ?? products[0]

  return (
    <>
      <AnimatePresence>
        {open && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-40 bg-deep-950/50 backdrop-blur-sm lg:hidden" onClick={onClose} />}
      </AnimatePresence>
      <aside className={`portal-sidebar bg-fuel-gradient fixed inset-y-0 start-0 z-50 flex w-[264px] flex-col text-white transition-transform duration-300 ${desktopOpen ? 'lg:translate-x-0' : 'lg:-translate-x-full'} ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center gap-3 px-5 pt-6 pb-4">
          <div className="relative h-12 w-12 shrink-0">
            <img src="logo.png" alt={translatePortalText("BoatPro")} className="h-full w-full object-contain drop-shadow-[0_0_15px_rgba(251,146,60,0.35)]" onError={e => ((e.target as HTMLImageElement).style.display = 'none')} />
          </div>
          <div>
            <p className="font-display text-xl font-extrabold leading-tight tracking-wide text-white drop-shadow-sm">{translatePortalText("BoatPro")}</p>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-300">{translatePortalText("Fuel Portal")}</p>
          </div>
          <button className="ms-auto lg:hidden text-white/60 hover:text-white" onClick={onClose}><X size={20} /></button>
          <button className="ms-auto hidden lg:block text-white/60 hover:text-white" onClick={onDesktopClose}><X size={20} /></button>
        </div>

        <div className="mx-4 mb-3 overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur">
          <div className="relative h-[80px]">
            <CoverPhoto srcs={stationCoverPhotos(station)} className="absolute inset-0 h-full w-full opacity-60" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#120a04]/95 via-[#120a04]/40 to-transparent" />
            <div className="absolute bottom-2 start-3 end-3">
              <p className="font-display text-sm font-bold truncate">
                {isAllStations ? `${translatePortalText('All Stations')} (${stations.length})` : localizedField(station, 'name') || translatePortalText('Fuel Station')}
              </p>
              <p className="flex items-center gap-1.5 text-[11px] text-amber-200">
                {station?.approvalStatus === 'pending' ? (
                  <>
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
                    </span>
                    <span className="font-extrabold text-amber-300">{translatePortalText("⏳ Pending Approval")}</span>
                  </>
                ) : station?.approvalStatus === 'rejected' ? (
                  <>
                    <span className="relative flex h-2 w-2 rounded-full bg-rose-400" />
                    <span className="font-extrabold text-rose-300">{translatePortalText("❌ Rejected")}</span>
                  </>
                ) : (
                  <>
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                    </span>
                    {isAllStations ? translatePortalText("Multi-Location Rollup") : [translatePortalText(station?.isActive === false ? 'Closed' : 'Open'), localizedField(station, 'city'), station?.vhfChannel].filter(Boolean).join(' · ')}
                  </>
                )}
              </p>
            </div>
          </div>
          {stations.length > 1 && (
            <div className="border-t border-white/10 px-2.5 py-1.5 bg-black/25">
              <select
                value={currentStationId ?? ALL_STATIONS}
                onChange={(e) => setCurrentStationId(e.target.value)}
                className="w-full rounded-lg bg-white/10 px-2 py-1 text-[11px] font-bold text-amber-200 outline-none cursor-pointer focus:bg-white/20"
              >
                <option value={ALL_STATIONS} className="text-slate-900 font-bold">{translatePortalText("🏢 All Stations (")}{stations.length})
                </option>
                {stations.map((st) => (
                  <option key={st.id} value={st.id} className="text-slate-900 font-bold">
                    {st.approvalStatus === 'pending' ? translatePortalText("⏳ [Pending Approval] ") : st.approvalStatus === 'rejected' ? translatePortalText("❌ [Rejected] ") : translatePortalText("📍 ")}
                    <bdi dir="auto">{localizedField(st, 'name')}</bdi> {st.city ? `(${localizedField(st, 'city')})` : translatePortalText("")}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          {nav.map(g => (
            <div key={g.group} className="mb-1">
              <p className="px-3 pb-1 pt-3 text-[10px] font-extrabold uppercase tracking-[0.2em] text-white/65">{translatePortalText(g.group)}</p>
              {g.items.map(it => {
                const badge = it.badge ? counts[it.badge] : 0
                return (
                  <NavLink key={it.to} to={it.to} end={it.to === '/fuel'} onClick={onClose}
                    className={({ isActive }) => `group relative mb-0.5 flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-semibold transition-all duration-200 ${isActive ? 'bg-white/12 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,.12)]' : 'text-white/70 hover:bg-white/6 hover:text-white'}`}>
                    {({ isActive }) => (<>
                      {isActive && <motion.span layoutId="fuel-nav-pill" className="absolute inset-y-0 start-0 my-auto h-6 w-1 rounded-s-full bg-gradient-to-b from-amber-300 to-orange-500" />}
                      <it.icon size={17} className={isActive ? "text-amber-300" : "text-white/65 group-hover:text-amber-300 transition-colors"} />
                      {translatePortalText(it.label)}
                      {badge > 0 && <span className="ms-auto grid h-5 min-w-5 place-items-center rounded-full bg-amber-400 px-1.5 text-[10px] font-extrabold text-[#120a04]">{formatPortalNumber(badge)}</span>}
                    </>)}
                  </NavLink>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="mx-4 mb-4 rounded-2xl bg-white/8 p-3.5 backdrop-blur border border-white/10">
          <div className="flex items-center gap-3">
            <Flame size={22} className="animate-flicker text-orange-400" />
            <div>
              <p className="font-display text-sm font-extrabold leading-tight">
                {/* A displayed price, so it converts. The inline
                    `currency === 'USD' ? '$' : ...` pasted a label on the
                    stored number instead — see the rules in `currency.tsx`. */}
                {headline ? `${headline.name.split(' ').slice(-1)[0]} ${formatMoney(headline.price, currency)}` : translatePortalText("No products yet")}
                {headline && <span className="text-[10px] font-semibold text-white/70">/{headline.unit}</span>}
              </p>
              <p className="text-[11px] text-white/60">
                {counts.lowStock > 0
                  ? translatePortalText(`${formatPortalNumber(counts.lowStock)} tank${counts.lowStock === 1 ? '' : 's'} below reorder point`)
                  : translatePortalText("All tanks above reorder point")}
              </p>
            </div>
            <Droplets size={18} className="ms-auto text-amber-300 animate-pulse-soft" />
          </div>
        </div>
      </aside>
    </>
  )
}

function NotifDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const tones: any = { info: 'bg-amber-50 text-amber-600', success: 'bg-emerald-50 text-emerald-600', warn: 'bg-orange-50 text-orange-600', danger: 'bg-rose-50 text-rose-600' }
  const nav = useNavigate()
  const { notifications, refresh } = useFuel()
  const unreadCount = notifications.filter(n => !n.isRead).length

  const markAll = async () => {
    await notificationsApi.markAllRead().catch(() => null)
    await refresh()
    toast(translatePortalText("All notifications marked as read"))
  }

  const openOne = async (id: string) => {
    await notificationsApi.markRead(id).catch(() => null)
    void refresh()
    onClose()
    nav('/fuel/notifications')
  }

  return (
    <AnimatePresence>
      {open && (<>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[80] bg-deep-950/40 backdrop-blur-sm" onClick={onClose} />
        <motion.aside initial={{ x: 420 }} animate={{ x: 0 }} exit={{ x: 420 }} transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          className="fixed end-0 top-0 z-[85] flex h-full w-full max-w-md flex-col bg-white shadow-lift">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h3 className="font-display text-lg font-bold">{translatePortalText("⛽ Fuel Notifications ")}{unreadCount > 0 && <span className="ms-1 rounded-full bg-amber-500 px-2 py-0.5 text-xs text-white">{unreadCount}</span>}</h3>
            <div className="flex gap-2">
              <button className="btn-ghost !py-1.5 !px-3 text-xs disabled:opacity-40" disabled={unreadCount === 0} onClick={markAll}>{translatePortalText("Mark all read")}</button>
              <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={18} /></button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {notifications.length === 0 && <p className="px-3 py-10 text-center text-sm text-slate-400">{translatePortalText("Nothing new right now.")}</p>}
            {notifications.map((n, i) => {
              const style = notifStyle(n.type)
              const unread = !n.isRead
              return (
                <motion.button key={n._id} initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
                  onClick={() => void openOne(n._id)}
                  className={`flex w-full gap-3 rounded-2xl border p-3.5 text-left transition hover:shadow-soft ${unread ? 'border-amber-100 bg-amber-50/40' : 'border-slate-100 bg-white'}`}>
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg ${tones[style.tone]}`}>{style.icon}</span>
                  <div className="min-w-0">
                    <p className="text-xs font-extrabold uppercase tracking-wide text-slate-400">{translatePortalText(style.kind)} · {relativeTime(n.createdAt)}</p>
                    <p className="mt-0.5 text-sm font-medium text-deep-800">{localizedField<string>(n, 'body', n.body)}</p>
                  </div>
                  {unread && <span className="ms-auto mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-500" />}
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
    { icon: '⛽', label: translatePortalText("New Fuel Order"), to: '/fuel/bookings' }, { icon: '🗂️', label: translatePortalText("Manage Orders"), to: '/fuel/deliveries' },
    { icon: '🗓️', label: translatePortalText("Fuel Calendar"), to: '/fuel/calendar' }, { icon: '🧾', label: translatePortalText("Create Invoice"), to: '/fuel/billing' },
    { icon: '🛢️', label: translatePortalText("Refill Tank"), to: '/fuel/inventory' }, { icon: '💲', label: translatePortalText("Update Prices"), to: '/fuel/pricing' },
    { icon: '🚨', label: translatePortalText("Emergency Order"), to: '/fuel/bookings' }, { icon: '📊', label: translatePortalText("View Reports"), to: '/fuel/reports' },
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
                className="flex flex-col items-center gap-2 rounded-2xl border border-slate-100 bg-sand p-4 text-center transition hover:border-amber-300 hover:bg-amber-50 hover:shadow-soft active:scale-95">
                <span className="text-2xl">{a.icon}</span>
                <span className="text-xs font-bold text-deep-800">{a.label}</span>
              </motion.button>
            ))}
          </div>
        </motion.div>
      </>)}
    </AnimatePresence>
  )
}

type SearchHit = { kind: string; icon: string; title: string; sub: string; to: string }

const HIT_ICON: Record<string, string> = {
  Order: '📋', Tank: '🛢️', Invoice: '🧾', Vehicle: '🚚', Delivery: '🛳️',
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

  // Debounced server search — the portal's index spans orders, tanks,
  // invoices, fleet and dispatch, which is far more than the page has loaded.
  useEffect(() => {
    const term = q.trim()
    if (!term) { setHits([]); return }
    let cancelled = false
    const t = setTimeout(() => {
      fuelApi.search(term)
        .then(res => {
          if (cancelled) return
          setHits(res.data.results.map(r => ({
            kind: r.kind, icon: HIT_ICON[r.kind] ?? '🔎', title: r.title, sub: r.subtitle ?? '', to: r.href,
          })))
          setActive(0)
        })
        .catch(() => { if (!cancelled) setHits([]) })
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [q])

  const go = (h: SearchHit) => { setOpen(false); setQ(''); toast(translatePortalText(`Opening ${h.kind.toLowerCase()} “${h.title}”`), 'info'); nav(h.to) }

  return (
    <div ref={wrapRef} className="relative hidden flex-1 max-w-[280px] md:max-w-xs lg:max-w-sm sm:block">
      <Search size={15} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
      <input ref={inputRef} value={q}
        onChange={e => { setQ(e.target.value); setOpen(true); setActive(0) }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, hits.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
          else if (e.key === 'Enter' && hits[active]) { e.preventDefault(); go(hits[active]) }
        }}
        placeholder={translatePortalText("Search orders, tanks, invoices…")}
        className="h-10 w-full rounded-full border border-slate-200/90 bg-slate-50/80 ps-9 pe-12 text-xs font-medium text-deep-900 placeholder:text-slate-400 transition-all hover:bg-white hover:border-slate-300 focus:bg-white focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 focus:outline-none" />
      <kbd className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-extrabold text-slate-400 shadow-2xs">{translatePortalText("⌘K")}</kbd>
      <AnimatePresence>
        {open && q.trim() && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
            className="absolute start-0 end-0 top-full z-50 mt-2 max-h-80 overflow-y-auto rounded-2xl border border-slate-100 bg-white p-2 shadow-lift">
            {hits.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-slate-400">{translatePortalText("No matches for “")}{q}”.</p>
            ) : hits.map((h, i) => (
              <button key={h.kind + h.title + i} onMouseEnter={() => setActive(i)} onClick={() => go(h)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition ${i === active ? 'bg-amber-50' : 'hover:bg-sand'}`}>
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sand text-base">{h.icon}</span>
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

function LocationDropdown() {
  const { station, stations, currentStationId, isAllStations, setCurrentStationId } = useFuel()
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const nav = useNavigate()

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  if (stations.length <= 1) return null

  const isPending = !isAllStations && station?.approvalStatus === 'pending'
  const isRejected = !isAllStations && station?.approvalStatus === 'rejected'

  const displayName = isAllStations
    ? `${translatePortalText('All Stations')} (${stations.length})`
    : (localizedField(station, 'name', translatePortalText('Select Station')) as string)

  return (
    <div ref={dropdownRef} className="relative hidden sm:block">
      <button
        onClick={() => setOpen(!open)}
        className={`group flex h-10 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition-all shadow-2xs ${
          isPending
            ? 'border-amber-400/80 bg-amber-50/90 text-amber-950 dark:border-amber-400/50 dark:bg-amber-950/40 dark:text-amber-100 hover:bg-amber-100 dark:hover:bg-amber-950/70 hover:border-amber-500 shadow-[0_0_14px_rgba(245,158,11,0.18)]'
            : isRejected
            ? 'border-rose-400/80 bg-rose-50/90 text-rose-950 dark:border-rose-400/50 dark:bg-rose-950/40 dark:text-rose-100 hover:bg-rose-100 dark:hover:bg-rose-950/70 hover:border-rose-500'
            : 'border-slate-200/90 bg-white/95 text-deep-900 hover:border-amber-400/80 hover:bg-white hover:shadow-xs'
        }`}
      >
        <span className="grid h-6 w-6 place-items-center rounded-full bg-amber-500/15 text-amber-600 text-xs">
          ⛽
        </span>
        <span className="max-w-[150px] lg:max-w-[200px] truncate text-[12.5px] font-extrabold text-deep-900">
          {displayName}
        </span>

        {isPending && (
          <span className="flex items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-white shadow-xs">
            <span className="h-1.5 w-1.5 rounded-full bg-white animate-ping" />{translatePortalText("Pending")}</span>
        )}

        {isRejected && (
          <span className="flex items-center gap-1 rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-white shadow-xs">{translatePortalText("Rejected")}</span>
        )}

        <ChevronDown
          size={14}
          className={`text-slate-400 transition-transform duration-200 group-hover:text-deep-900 ${
            open ? 'rotate-180 text-deep-900' : ''
          }`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="absolute start-0 top-full z-50 mt-2 w-80 origin-top-left rounded-2xl border border-slate-100 bg-white/95 p-2 shadow-lift backdrop-blur-md ring-1 ring-black/5"
          >
            <div className="px-3 py-2 border-b border-slate-100 mb-1 flex items-center justify-between">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">{translatePortalText("Switch Station Location")}</span>
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-extrabold text-amber-800">
                {stations.length}{translatePortalText(" Locations")}</span>
            </div>

            <div className="max-h-64 overflow-y-auto space-y-1">
              <button
                onClick={() => {
                  setCurrentStationId(ALL_STATIONS)
                  setOpen(false)
                }}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-xs font-bold transition ${
                  isAllStations
                    ? 'bg-amber-500 text-white shadow-sm'
                    : 'text-deep-900 hover:bg-sand/70'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-base">🏢</span>
                  <div>
                    <p className="font-extrabold">{translatePortalText("All Stations")}</p>
                    <p className={`text-[10.5px] ${isAllStations ? 'text-white/80' : 'text-slate-400'}`}>{translatePortalText("Multi-location aggregated view")}</p>
                  </div>
                </div>
                {isAllStations && <Check size={14} className="stroke-[3]" />}
              </button>

              {stations.map((st) => {
                const isSelected = !isAllStations && (currentStationId === st.id || station?.id === st.id)
                const stPending = st.approvalStatus === 'pending'
                const stRejected = st.approvalStatus === 'rejected'

                return (
                  <button
                    key={st.id}
                    onClick={() => {
                      setCurrentStationId(st.id)
                      setOpen(false)
                    }}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-xs transition ${
                      isSelected
                        ? 'bg-amber-500 text-white shadow-sm font-extrabold'
                        : 'text-deep-900 hover:bg-sand/70 font-semibold'
                    }`}
                  >
                    <div className="min-w-0 flex-1 pe-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm shrink-0">📍</span>
                        <span className="truncate font-extrabold"><bdi dir="auto">{localizedField(st, 'name')}</bdi></span>
                      </div>
                      <p className={`text-[10.5px] truncate ps-5 ${isSelected ? 'text-white/80' : 'text-slate-400'}`}>
                        {st.city || st.address || translatePortalText('Coastal station')}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {stPending && (
                        <span className={`rounded-full px-2 py-0.5 text-[9.5px] font-black uppercase tracking-tight ${
                          isSelected ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-900 border border-amber-300/80 dark:bg-amber-950/70 dark:text-amber-200 dark:border-amber-400/40'
                        }`}>{translatePortalText("⏳ Pending")}</span>
                      )}
                      {stRejected && (
                        <span className={`rounded-full px-2 py-0.5 text-[9.5px] font-black uppercase tracking-tight ${
                          isSelected ? 'bg-white/20 text-white' : 'bg-rose-100 text-rose-900 border border-rose-300/80 dark:bg-rose-950/70 dark:text-rose-200 dark:border-rose-400/40'
                        }`}>{translatePortalText("❌ Rejected")}</span>
                      )}
                      {isSelected && <Check size={14} className="stroke-[3]" />}
                    </div>
                  </button>
                )
              })}
            </div>

            <div className="mt-1 border-t border-slate-100 pt-1">
              <button
                onClick={() => {
                  setOpen(false)
                  nav('/fuel/station')
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold text-amber-700 hover:bg-amber-50 transition"
              >
                <Plus size={13} />{translatePortalText(" Add or Manage Locations")}</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Splash() {
  return (
    <motion.div exit={{ opacity: 0, scale: 1.06 }} transition={{ duration: 0.5 }}
      className="bg-fuel-gradient fixed inset-0 z-[200] grid place-items-center">
      <div className="text-center text-white">
        <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', damping: 14 }}
          className="mx-auto mb-6 grid h-24 w-24 place-items-center rounded-3xl bg-gradient-to-br from-amber-500 to-orange-500 shadow-[0_0_50px_rgba(251,146,60,0.5)]">
          <Fuel size={44} />
        </motion.div>
        <p className="font-display text-4xl font-extrabold tracking-tight text-white drop-shadow-md">
          {translatePortalText('Fuel Portal').split('').map((ch, i) => (
            <span key={i} className="splash-letter inline-block" style={{ animationDelay: `${0.1 + i * 0.05}s` }}>{ch === ' ' ? translatePortalText(" ") : ch}</span>
          ))}
        </p>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }}
          className="mt-1 text-xs font-bold uppercase tracking-[0.35em] text-amber-300">{translatePortalText("Powered by BoatPro")}</motion.p>
        <motion.div initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 0.3, duration: 0.9, ease: 'easeInOut' }}
          className="mx-auto mt-6 h-0.5 w-44 origin-left rounded-full bg-gradient-to-r from-amber-400 to-orange-300" />
      </div>
    </motion.div>
  )
}

function Clock() {
  const { station } = useFuel()
  const [now, setNow] = useState(new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])
  return (
    <div className="hidden xl:flex flex-col items-end pe-1 leading-tight">
      <span className="font-display text-sm font-extrabold tabular-nums text-deep-900">{now.toLocaleTimeString(portalLocale(), { hour12: false })}</span>
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
        {now.toLocaleDateString(portalLocale(), { weekday: 'short', month: 'short', day: 'numeric' })}{station?.city ? ` · ${localizedField(station, 'city')}` : translatePortalText("")}
      </span>
    </div>
  )
}

function FuelShell() {
  const [side, setSide] = useState(false)
  const [desktopSide, setDesktopSide] = useState(true)
  const [notif, setNotif] = useState(false)
  const [quick, setQuick] = useState(false)
  const nav = useNavigate()
  const { logout, user } = useAuth()
  const loc = useLocation()
  const { station, currentStation, stations, currentStationId, setCurrentStationId, ticker, counts, error, overview, refresh } = useFuel()


  // Nothing to scroll until the first payload lands; keep the strip stable.
  const tickerItems = useMemo(
    () => (ticker.length ? ticker.flatMap((item) => {
      const localized = translatePortalText(item)
      return [localized, localized]
    }) : []),
    [ticker],
  )
  const pumpsOk = overview ? overview.pumps.every(p => p.status !== 'offline' && !p.calibrationOverdue) : true

  return (
    <div className="min-h-screen overflow-x-hidden">
      <Sidebar open={side} desktopOpen={desktopSide} onClose={() => setSide(false)} onDesktopClose={() => setDesktopSide(false)} />
      <div data-sidebar-open={desktopSide ? "true" : "false"} className={`portal-main-offset transition-all duration-300 ${desktopSide ? 'lg:ps-[264px]' : 'lg:ps-0'}`}>
        <header className="sticky top-0 z-30 glass border-b border-slate-100/60">
          <div className="flex items-center gap-3 px-4 py-3 md:px-7">
            <button className="lg:hidden btn-ghost !p-2" onClick={() => setSide(true)}><Menu size={18} /></button>
            <button className={`hidden lg:block btn-ghost !p-2 transition-opacity ${desktopSide ? 'opacity-0 pointer-events-none w-0 !p-0' : 'opacity-100'}`} onClick={() => setDesktopSide(true)}><Menu size={18} /></button>

            <GlobalSearch />

            <LocationDropdown />

            <div className="ms-auto flex items-center gap-2">
              <button
                title={translatePortalText("Quick actions")}
                onClick={() => setQuick(true)}
                className="hidden md:inline-flex h-10 items-center gap-1.5 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-4 text-xs font-extrabold text-white shadow-[0_2px_10px_rgba(245,158,11,0.35)] transition-all hover:shadow-[0_4px_16px_rgba(245,158,11,0.5)] hover:scale-[1.02] active:scale-[0.98]"
              >
                <Plus size={15} className="stroke-[2.5]" />
                <span>{translatePortalText("Quick action")}</span>
              </button>

              <div className="flex items-center gap-1 rounded-full border border-slate-200/80 bg-slate-50/60 p-1">
                <ThemeToggle />
              <LanguageToggle />

                <button
                  title={translatePortalText("Emergency orders")}
                  onClick={() => nav('/fuel/bookings')}
                  className="relative grid h-8 w-8 place-items-center rounded-full text-rose-500 transition hover:bg-rose-50 hover:scale-105 active:scale-95"
                >
                  <Flame size={17} className="animate-flicker" />
                  {counts.emergencies > 0 && (
                    <span className="absolute -top-0.5 -end-0.5 grid h-4 w-4 place-items-center rounded-full bg-rose-500 text-[9px] font-extrabold text-white shadow-xs">
                      {counts.emergencies}
                    </span>
                  )}
                </button>

                <button
                  title={translatePortalText("Notifications")}
                  onClick={() => setNotif(true)}
                  className="relative grid h-8 w-8 place-items-center rounded-full text-slate-500 transition hover:bg-amber-50 hover:text-amber-600 hover:scale-105 active:scale-95"
                >
                  <Bell size={17} />
                  {counts.unread > 0 && (
                    <span className="absolute -top-0.5 -end-0.5 grid h-4 w-4 place-items-center rounded-full bg-amber-500 text-[9px] font-extrabold text-white shadow-xs animate-pulse-soft">
                      {counts.unread}
                    </span>
                  )}
                </button>
              </div>

              <button
                onClick={() => nav('/fuel/station')}
                className="ms-0.5 flex h-10 items-center gap-2.5 rounded-full border border-slate-200/80 bg-white/90 ps-1 pe-3.5 py-1 shadow-2xs transition-all hover:bg-white hover:shadow-sm hover:border-slate-300"
              >
                <img
                  src={fileUrl(user?.avatar) || avatar(64)}
                  alt={user?.name ?? ''}
                  className="h-8 w-8 rounded-full object-cover ring-1 ring-slate-200"
                />
                <span className="hidden text-left md:block">
                  <span className="block text-xs font-extrabold text-deep-900 leading-tight">
                    <bdi dir="auto">{localizedField(user, 'name') || translatePortalText('Fuel Provider')}</bdi>
                  </span>
                  <span className="block text-[10px] font-bold text-slate-400">{translatePortalText("Fuel Ops Manager")}</span>
                </span>
              </button>

              <button
                title={translatePortalText("Sign out")}
                onClick={() => { logout(); nav('/login') }}
                className="grid h-10 w-10 place-items-center rounded-full border border-slate-200/80 bg-white/90 text-slate-400 shadow-2xs transition-all hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
              >
                <LogOut size={16} />
              </button>

              <Clock />
            </div>
          </div>
          <div className="relative overflow-hidden border-t border-slate-100/70 bg-deep-950/[0.03]">
            <div className="animate-ticker flex w-max items-center gap-10 whitespace-nowrap px-6 py-1.5 text-[11px] font-bold text-slate-500">
              {tickerItems.map((t, i) => (
                <span key={i} className="flex items-center gap-2">{t}<span className="h-1 w-1 rounded-full bg-amber-400" /></span>
              ))}
            </div>
            <div className="pointer-events-none absolute inset-y-0 start-0 w-16 bg-gradient-to-r from-sand to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 end-0 w-16 bg-gradient-to-l from-sand to-transparent" />
          </div>
        </header>
        <FuelStatusBanner station={currentStation || station} completeness={(currentStation || station)?.completeness} onRefresh={refresh} />
        <main className="px-4 py-6 md:px-7 md:py-7 max-w-[1600px]">
          {error && (
            <div className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-3.5 text-sm font-semibold text-rose-700">
              {translatePortalText(error)}
            </div>
          )}
          {/* Enter-only CSS fade keyed by route. The old framer-motion
              AnimatePresence mode="wait" could finish the outgoing page's exit
              and never mount the next one, leaving a blank white page. */}
          <div key={loc.pathname} className="route-enter">
            {useOutlet()}
          </div>
          <footer className="mt-10 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-5 pb-2 text-xs text-slate-400">
            <p>© {new Date().getFullYear()} <bdi dir="auto">{localizedField(station, 'legalName') || localizedField(station, 'name') || 'BoatPro'}</bdi> · {translatePortalText('Powered by BoatPro')}</p>
            <p className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full animate-pulse-soft ${pumpsOk ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              {pumpsOk ? translatePortalText("All pumps operational") : translatePortalText("Some pumps need attention")}
            </p>
          </footer>
        </main>
      </div>
      <NotifDrawer open={notif} onClose={() => setNotif(false)} />
      <QuickDrawer open={quick} onClose={() => setQuick(false)} />
      <ToastStack />
      {/* Global async-UX hosts. `RouteProgressBar` is the top sliver for
          in-flight requests; `ConfirmHost` renders whatever `confirm()` /
          `confirmAndRun()` asked for, from anywhere in the tree. */}
      <RouteProgressBar />
      <ConfirmHost />
    </div>
  )
}

export default function FuelLayout() {
  return (
    <FuelProvider>
      <FuelShell />
    </FuelProvider>
  )
}
