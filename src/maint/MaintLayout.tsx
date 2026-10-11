import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink, useOutlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import type { ApiMaintAccess, MaintenanceWorkerPermission, ApiNotification, ApiMaintenanceShop } from '../api'
import { notificationsApi, maintenanceShopApi, maintenancePortalApi, chatApi } from '../api'
import { onSocket } from '../socket'
import { useMaintLive } from './maintLive'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard, Wrench, ClipboardList, ClipboardCheck, Users,
  Package, MapPin, Receipt, BarChart3, MessagesSquare, Bell, Settings,
  Search, Menu, X, Plus, Cog, LogOut, LifeBuoy, Sparkles, CalendarDays, Star, ShieldCheck,
} from 'lucide-react'
import { avatar, shopCoverPhotos } from './maintData'
import { ToastStack, ListRowSkeleton, CoverPhoto } from '../ui'
import { ConfirmHost, RouteProgressBar } from '../async'
import { ThemeToggle } from '../theme'
import MaintStatusBanner from './components/MaintStatusBanner'
import { LanguageToggle } from '../i18n/LanguageToggle'
import { localizedField, translatePortalTemplate, translatePortalText, formatPortalDate, formatPortalTime, formatPortalNumber } from '../i18n/runtime'
import { maintToast } from './maintUi'
import { localizeMaintenanceNotification } from './maintNotificationI18n'

/** Notification `type` → icon/tone — mirrors the mapping used on the full Notifications page. */
const NOTIF_ICON: Record<string, string> = {
  booking_request: '🔧', general: '🔔', work_order_assigned: '📋', payment_success: '💵',
  emergency_sos: '🚨', review_received: '⭐', documents_expiring: '📄', staff_assigned: '👷',
}
const NOTIF_TONE = (type: string): 'info' | 'success' | 'warn' | 'danger' =>
  /sos|emergency/.test(type) ? 'danger' : /payment/.test(type) ? 'success' : /expiring|warn/.test(type) ? 'warn' : 'info'

/**
 * Live counts behind the sidebar badges and the active-jobs summary.
 *
 * Every one of these was a literal in `NAV` — 3, 5, 4, 2, 4, and a footer that
 * always read "12 active jobs · 2 emergencies · 5 pending" no matter what the
 * shop was actually carrying. They now come from `/maintenance-portal/dashboard`
 * and the chat and notification feeds the layout already reads.
 */
export interface MaintCounts {
  onDuty: number
  pendingRequests: number
  activeWorkOrders: number
  lowStock: number
  unreadMessages: number
  unreadNotifications: number
  emergencies: number
}

const ZERO_COUNTS: MaintCounts = {
  onDuty: 0, pendingRequests: 0, activeWorkOrders: 0, lowStock: 0,
  unreadMessages: 0, unreadNotifications: 0, emergencies: 0,
}

type BadgeKey = keyof MaintCounts

type NavItem = {
  to: string
  label: string
  icon: any
  /** Which live count this item's badge shows. A zero renders no badge at all. */
  badgeKey?: BadgeKey
  /** Page permission required to see this item — omitted means always visible to any active worker. */
  perm?: MaintenanceWorkerPermission
  /** The workshop owner's own account, not something a permission can grant a worker. */
  ownerOnly?: boolean
}

const NAV: { group: string; items: NavItem[] }[] = [
  { group: 'Overview', items: [
    { to: '/maint', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/maint/calendar', label: 'Maintenance Calendar', icon: CalendarDays, perm: 'calendar' },
    { to: '/maint/mobile', label: 'Technician Tracker', icon: MapPin, badgeKey: 'onDuty', perm: 'mobile' },
  ]},
  { group: 'Operations', items: [
    { to: '/maint/requests', label: 'Requests', icon: ClipboardList, badgeKey: 'pendingRequests', perm: 'requests' },
    // 'workorders' is deliberately not gated — a technician-worker always sees
    // their own assigned jobs here; being granted 'workorders' just upgrades
    // what the page shows (see visibleNav's relabeling below).
    { to: '/maint/workorders', label: 'Work Orders', icon: Wrench, badgeKey: 'activeWorkOrders' },
  ]},
  { group: 'Resources', items: [
    { to: '/maint/technicians', label: 'Technicians & Labor', icon: Users, perm: 'technicians' },
    { to: '/maint/parts', label: 'Parts & Inventory', icon: Package, badgeKey: 'lowStock', perm: 'parts' },
  ]},
  { group: 'Business', items: [
    { to: '/maint/billing', label: 'Billing & Payments', icon: Receipt, perm: 'billing' },
    { to: '/maint/reports', label: 'Reports ', icon: BarChart3, perm: 'reports' },
  ]},
  { group: 'Engage', items: [
    { to: '/maint/inbox', label: 'Inbox & Help', icon: MessagesSquare, badgeKey: 'unreadMessages' },
    { to: '/maint/standing', label: 'Account standing', icon: ShieldCheck, ownerOnly: true },
    { to: '/maint/notifications', label: 'Notifications', icon: Bell, badgeKey: 'unreadNotifications', perm: 'notifications' },
    // Ungated on purpose: what customers say about the workshop is not one
    // team member's page to be shut out of, and the reply is the only thing
    // the reputation score measures responsiveness on.
    { to: '/maint/reviews', label: 'Reviews', icon: Star },
  ]},
  { group: 'Admin', items: [
    { to: '/maint/workshop', label: 'Workshop Profile', icon: ClipboardCheck, perm: 'workshop' },
    { to: '/maint/settings', label: 'Settings', icon: Settings, perm: 'settings' },
  ]},
]

/** Which of NAV's items a given session may see — owner/admin get everything;
 * any technician-worker sees "My Jobs" instead (always their own jobs only,
 * no full-board upgrade). */
function visibleNav(access: ApiMaintAccess | null) {
  const isOwner = access?.isOwner ?? true // default open while maintAccess is still loading
  const allowed = (item: NavItem) =>
    item.ownerOnly ? isOwner : isOwner || !item.perm || !!access?.permissions.includes(item.perm)
  return NAV.map(g => ({
    ...g,
    items: g.items.filter(allowed).map(it =>
      it.to === '/maint/workorders' && !isOwner ? { ...it, label: 'My Jobs' } : it
    ),
  })).filter(g => g.items.length > 0)
}

function Sidebar({ open, desktopOpen, onClose, onDesktopClose, counts }: { open: boolean; desktopOpen: boolean; onClose: () => void; onDesktopClose: () => void; counts: MaintCounts }) {
  const nav = useNavigate()
  const { maintAccess, user } = useAuth()
  const items = useMemo(() => visibleNav(maintAccess), [maintAccess])
  const [shop, setShop] = useState<ApiMaintenanceShop | null>(null)
  useEffect(() => { maintenanceShopApi.mine().then(res => setShop(res.data.shop)).catch(() => {}) }, [])

  // Falls back to a neutral label, not to an invented business name.
  const shopName = localizedField(shop, 'nameEn', '') || localizedField(user?.business, 'businessName') || localizedField(user, 'name') || translatePortalText('Maintenance Provider')
  const shopLoc = localizedField(shop, 'city') || localizedField(user?.business, 'city') || localizedField(user?.business, 'address') || translatePortalText('Jeddah Marine District')

  return (
    <>
      <AnimatePresence>
        {open && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-40 bg-deep-950/50 backdrop-blur-sm lg:hidden" onClick={onClose} />}
      </AnimatePresence>
      <aside className={`portal-sidebar bg-maint-gradient fixed inset-y-0 start-0 z-50 flex w-[264px] flex-col text-white transition-transform duration-300 ${desktopOpen ? 'lg:translate-x-0' : 'lg:-translate-x-full'} ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center gap-3 px-5 pt-6 pb-4">
          <div className="relative h-12 w-12 shrink-0">
            <img src="logo.png" alt={translatePortalText("BoatPro")} className="h-full w-full object-contain drop-shadow-[0_0_15px_rgba(139,92,246,0.4)]" onError={e => ((e.target as HTMLImageElement).style.display = 'none')} />
            <Cog size={16} className="animate-gear absolute -bottom-1 -end-1 text-violet-300" />
          </div>
          <div>
            <p className="font-display text-xl font-extrabold leading-tight tracking-wide text-white drop-shadow-sm">{translatePortalText("BoatPro")}</p>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-violet-300">{translatePortalText("Maintenance")}</p>
          </div>
          <button className="ms-auto lg:hidden text-white/60 hover:text-white" onClick={onClose}><X size={20} /></button>
          <button className="ms-auto hidden lg:block text-white/60 hover:text-white" onClick={onDesktopClose}><X size={20} /></button>
        </div>

        <div className="mx-4 mb-3 overflow-hidden rounded-2xl border border-white/10">
          <div className="relative h-[86px]">
            <CoverPhoto srcs={shopCoverPhotos(shop)} className="absolute inset-0 h-full w-full" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0c0a1e]/90 via-[#0c0a1e]/30 to-transparent" />
            <div className="absolute bottom-2 start-3 end-3">
              <p className="font-display text-sm font-bold truncate"><bdi dir="auto">{shopName}</bdi></p>
              <p className="flex items-center gap-1.5 text-[11px] text-violet-200 truncate">
                <span className="relative flex h-2 w-2 shrink-0"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" /></span>
                <span className="truncate"><bdi dir="auto">{shopLoc}</bdi></span>
              </p>
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          {items.map(g => (
            <div key={g.group} className="mb-1">
              <p className="px-3 pb-1 pt-3 text-[10px] font-extrabold uppercase tracking-[0.2em] text-white/65">{translatePortalText(g.group)}</p>
              {g.items.map(it => {
                // A count of zero is not a badge. The old literals meant every
                // item was permanently decorated; a real count has to be able to
                // say "nothing needs you here".
                const badge = it.badgeKey ? counts[it.badgeKey] : 0
                return (
                <NavLink key={it.to} to={it.to} end={it.to === '/maint'} onClick={onClose}
                  className={({ isActive }) => `group relative mb-0.5 flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-semibold transition-all duration-200 ${isActive ? 'bg-white/12 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,.12)]' : 'text-white/70 hover:bg-white/6 hover:text-white'}`}>
                  {({ isActive }) => (<>
                    {isActive && <motion.span layoutId="maint-nav-pill" className="absolute inset-y-0 start-0 my-auto h-6 w-1 rounded-s-full bg-gradient-to-b from-violet-300 to-indigo-500" />}
                    <it.icon size={17} className={isActive ? 'text-violet-300' : 'text-white/65 group-hover:text-violet-300 transition-colors'} />
                    {translatePortalText(it.label)}
                    {badge > 0 && <span className="ms-auto grid h-5 min-w-5 place-items-center rounded-full bg-violet-400 px-1.5 text-[10px] font-extrabold text-[#0c0a1e]">{badge > 99 ? `${formatPortalNumber(99)}+` : formatPortalNumber(badge)}</span>}
                  </>)}
                </NavLink>
                )
              })}
            </div>
          ))}
        </nav>

        <button onClick={() => { nav('/maint/workorders'); onClose() }}
          className="mx-4 mb-4 rounded-2xl bg-white/8 p-3.5 text-left backdrop-blur border border-white/10 transition hover:bg-white/12 active:scale-[0.98]">
          <div className="flex items-center gap-3">
            <Cog size={22} className="animate-gear text-violet-300" />
            <div>
              <p className="font-display text-sm font-extrabold leading-tight">
                {translatePortalTemplate(
                  counts.activeWorkOrders === 1 ? '{{count}} active job' : '{{count}} active jobs',
                  { count: counts.activeWorkOrders },
                )}
              </p>
              {/* Only the parts that are actually true get said. A shop with no
                  emergencies should not read "0 emergencies"; if nothing is
                  outstanding at all, the line says so plainly. */}
              <p className="text-[11px] text-white/60">
                {[
                  counts.emergencies > 0 && translatePortalTemplate(
                    counts.emergencies === 1 ? '{{count}} emergency' : '{{count}} emergencies',
                    { count: counts.emergencies },
                  ),
                  counts.pendingRequests > 0 && translatePortalTemplate('{{count}} pending', { count: counts.pendingRequests }),
                ].filter(Boolean).join(' · ') || translatePortalText("Nothing outstanding")}
              </p>
            </div>
            <Sparkles size={18} className="ms-auto text-indigo-300 animate-pulse-soft" />
          </div>
        </button>
      </aside>
    </>
  )
}

// ── DRAWERS ──
function NotifDrawer({ open, onClose, notifs, loading, onMarkAllRead }: { open: boolean; onClose: () => void; notifs: ApiNotification[]; loading: boolean; onMarkAllRead: () => void }) {
  const tones: Record<string, string> = { info: 'bg-indigo-50 text-indigo-600', success: 'bg-emerald-50 text-emerald-600', warn: 'bg-amber-50 text-amber-600', danger: 'bg-rose-50 text-rose-600' }
  return (
    <AnimatePresence>
      {open && (<>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[80] bg-deep-950/40 backdrop-blur-sm" onClick={onClose} />
        <motion.aside initial={{ x: 420 }} animate={{ x: 0 }} exit={{ x: 420 }} transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          className="fixed end-0 top-0 z-[85] flex h-full w-full max-w-md flex-col bg-white shadow-lift">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h3 className="font-display text-lg font-bold">{translatePortalText("🔧 Service Notifications")}</h3>
            <div className="flex gap-2">
              <button className="btn-ghost !py-1.5 !px-3 text-xs" onClick={onMarkAllRead}>{translatePortalText("Mark all read")}</button>
              <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={18} /></button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {loading && <ListRowSkeleton count={4} />}
            {!loading && notifs.length === 0 && <div className="py-10 text-center text-sm text-slate-400">{translatePortalText("No notifications.")}</div>}
            {!loading && notifs.map((n, i) => {
              const copy = localizeMaintenanceNotification(n)
              return (
                <motion.div key={n._id} initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
                  className={`flex gap-3 rounded-2xl border p-3.5 transition hover:shadow-soft ${!n.isRead ? 'border-violet-100 bg-violet-50/40' : 'border-slate-100 bg-white'}`}>
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg ${tones[NOTIF_TONE(n.type)]}`}>{NOTIF_ICON[n.type] || '🔔'}</span>
                  <div className="min-w-0">
                    <p className="text-xs font-extrabold uppercase tracking-wide text-slate-400">{copy.type} · {formatPortalDate(new Date(n.createdAt), { dateStyle: 'short', timeStyle: 'short' })}</p>
                    <p className="mt-0.5 text-sm font-medium text-deep-800">{copy.title}{copy.body ? ` — ${copy.body}` : ''}</p>
                  </div>
                  {!n.isRead && <span className="ms-auto mt-1 h-2 w-2 shrink-0 rounded-full bg-violet-500" />}
                </motion.div>
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
    { icon: '🔧', label: 'New Request', to: '/maint/requests' }, { icon: '📋', label: 'Create Work Order', to: '/maint/workorders' },
    { icon: '👷', label: 'Assign Technician', to: '/maint/technicians' }, { icon: '🩺', label: 'Start Inspection', to: '/maint/inspections' },
    { icon: '📦', label: 'Reserve Parts', to: '/maint/parts' }, { icon: '🧾', label: 'Create Invoice', to: '/maint/billing' },
    { icon: '🚨', label: 'Emergency SOS', to: '/maint/mobile' }, { icon: '📊', label: 'View Reports', to: '/maint/reports' },
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
                className="flex flex-col items-center gap-2 rounded-2xl border border-slate-100 bg-sand p-4 text-center transition hover:border-violet-300 hover:bg-violet-50 hover:shadow-soft active:scale-95">
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

function Splash() {
  return (
    <motion.div exit={{ opacity: 0, scale: 1.06 }} transition={{ duration: 0.5 }}
      className="bg-maint-gradient fixed inset-0 z-[200] grid place-items-center">
      <div className="text-center text-white">
        <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', damping: 14 }}
          className="mx-auto mb-6 grid h-24 w-24 place-items-center rounded-3xl bg-gradient-to-br from-violet-500 to-indigo-500 shadow-[0_0_50px_rgba(139,92,246,0.55)]">
          <Cog size={44} className="animate-gear" />
        </motion.div>
        <p className="font-display text-4xl font-extrabold tracking-tight text-white drop-shadow-md">
          <span className="splash-letter inline-block">{translatePortalText('Maintenance')}</span>
        </p>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }}
          className="mt-1 text-xs font-bold uppercase tracking-[0.35em] text-violet-300">{translatePortalText("Powered by BoatPro")}</motion.p>
        <motion.div initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 0.3, duration: 0.9, ease: 'easeInOut' }}
          className="mx-auto mt-6 h-0.5 w-44 origin-left rounded-full bg-gradient-to-r from-violet-400 to-indigo-300" />
      </div>
    </motion.div>
  )
}

function Clock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])
  return (
    <div className="hidden xl:flex flex-col items-end pe-1 leading-tight">
      <span className="font-display text-sm font-extrabold tabular-nums text-deep-900">{formatPortalTime(now)}</span>
      {/* Derived from the same clock as the time above. This read "Mon, Jul 20 ·
          Miami" — a frozen date beside a ticking second hand, for a business
          that is not in Miami. The city is gone rather than guessed: this
          renders in the header, which has no shop context to read one from. */}
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
        {formatPortalDate(now, { weekday: 'short', month: 'short', day: 'numeric' })}
      </span>
    </div>
  )
}

export default function MaintLayout() {
  const [side, setSide] = useState(false)
  const [desktopSide, setDesktopSide] = useState(true)
  const [notif, setNotif] = useState(false)
  const [quick, setQuick] = useState(false)
  const [q, setQ] = useState('')
  const [notifs, setNotifs] = useState<ApiNotification[]>([])
  const [notifsLoading, setNotifsLoading] = useState(true)
  const unreadCount = notifs.filter(n => !n.isRead).length
  const ticker = notifs.length ? notifs.slice(0, 8).map(n => {
    const copy = localizeMaintenanceNotification(n)
    return `${NOTIF_ICON[n.type] || '🔔'} ${copy.title}${copy.body ? ` — ${copy.body}` : ''}`
  }) : [translatePortalText('🟢 No new notifications')]
  const nav = useNavigate()
  const { logout, user } = useAuth()
  const loc = useLocation()
  /** The signed-in business, for the footer. Neutral when it is not loaded. */
  const footerName = localizedField(user?.business, 'businessName') || localizedField(user, 'name') || translatePortalText('Maintenance Provider')

  /**
   * The live counts behind every sidebar badge.
   *
   * Two sources, because no single endpoint owns all of it: the dashboard
   * carries the operational figures (on-duty technicians, pending requests,
   * active jobs, low stock, open emergencies) and the chat feed carries its own
   * unread total. Notification unreads come from `notifs`, which this component
   * already loads for the drawer and the ticker, so they are folded in below
   * rather than fetched twice.
   *
   * Failures are swallowed on purpose: a badge is decoration on top of a
   * working portal, and a counts request that 403s for a worker without a given
   * page must not take the whole layout down with it.
   */
  const [counts, setCounts] = useState<MaintCounts>(ZERO_COUNTS)
  const loadCounts = useCallback(async (background = false) => {
    const [overview, chats] = await Promise.allSettled([
      maintenancePortalApi.dashboard({ silent: background }),
      chatApi.myChats({ silent: background }),
    ])
    setCounts(prev => ({
      ...prev,
      ...(overview.status === 'fulfilled' ? {
        onDuty: overview.value.data.metrics.onDuty ?? 0,
        pendingRequests: overview.value.data.metrics.pendingRequests ?? 0,
        activeWorkOrders: overview.value.data.metrics.activeWorkOrders ?? 0,
        lowStock: overview.value.data.metrics.lowStock ?? 0,
        emergencies: overview.value.data.metrics.emergencies ?? 0,
      } : {}),
      ...(chats.status === 'fulfilled' ? {
        unreadMessages: chats.value.data.unreadTotal ?? 0,
      } : {}),
    }))
  }, [])

  useEffect(() => {
    void loadCounts()
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void loadCounts(true)
    }, 60_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void loadCounts(true)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible) }
  }, [loadCounts])

  const loadNotifs = useCallback(async (background = false) => {
    if (!background) setNotifsLoading(true)
    try {
      const res = await notificationsApi.list({ limit: 30 }, { silent: background })
      setNotifs(res.data.items || [])
    } catch {
      /* the drawer/badge are non-critical — leave what we have */
    } finally {
      if (!background) setNotifsLoading(false)
    }
  }, [])
  useEffect(() => {
    void loadNotifs()
    // The floor, not the mechanism — see the socket subscriptions below.
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void loadNotifs(true)
    }, 60_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void loadNotifs(true)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible) }
  }, [loadNotifs])

  // A notification arrives complete, so it goes straight into the drawer, the
  // badge and the ticker without a round trip.
  useEffect(() => {
    const off = onSocket('notification:new', (payload: ApiNotification) => {
      if (!payload?.id) return
      setNotifs(prev => (prev.some(n => n.id === payload.id) ? prev : [payload, ...prev].slice(0, 30)))
    })
    return off
  }, [])

  // Job events do not carry a notification of their own, so the feed is
  // re-read: it is what the ticker across the top of every screen renders. The
  // same events are exactly the ones that move the badge counts — a new request,
  // a work order changing state — so they are refreshed on the same signal
  // instead of waiting out the minute-long poll.
  useMaintLive(() => { void loadNotifs(true); void loadCounts(true) })

  /**
   * Notification unreads come from the feed this component already holds, so
   * they are merged in here rather than fetched a second time for the badge.
   */
  const sidebarCounts = useMemo<MaintCounts>(
    () => ({ ...counts, unreadNotifications: unreadCount }),
    [counts, unreadCount]
  )
  const markAllRead = async () => {
    try {
      await notificationsApi.markAllRead()
      await loadNotifs()
    } catch (e) {
      maintToast(e instanceof Error ? e.message : 'Could not mark them read', 'warn')
    }
  }
  const [shop, setShop] = useState<ApiMaintenanceShop | null>(null)
  const loadShop = useCallback(async () => {
    try {
      const res = await maintenanceShopApi.mine()
      setShop(res.data.shop)
    } catch {}
  }, [])

  useEffect(() => {
    void loadShop()
    const handleUpdate = () => { void loadShop() }
    window.addEventListener('boatpro-shop-updated', handleUpdate)
    return () => window.removeEventListener('boatpro-shop-updated', handleUpdate)
  }, [loadShop])

  return (
    <div className="min-h-screen overflow-x-hidden">
      <Sidebar open={side} desktopOpen={desktopSide} onClose={() => setSide(false)} onDesktopClose={() => setDesktopSide(false)} counts={sidebarCounts} />
      <div className={`portal-main-offset transition-all duration-300 ${desktopSide ? 'lg:ps-[264px]' : 'lg:ps-0'}`} data-sidebar-open={desktopSide}>
        <header className="sticky top-0 z-30 glass border-b border-slate-100/60">
          <div className="flex items-center gap-3 px-4 py-3 md:px-7">
            <button className="lg:hidden btn-ghost !p-2" onClick={() => setSide(true)}><Menu size={18} /></button>
            <button className={`hidden lg:block btn-ghost !p-2 transition-opacity ${desktopSide ? 'opacity-0 pointer-events-none w-0 !p-0' : 'opacity-100'}`} onClick={() => setDesktopSide(true)}><Menu size={18} /></button>
            <div className="relative hidden flex-1 max-w-md sm:block">
              <Search size={16} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={e => setQ(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && q.trim()) { nav('/maint/workorders'); maintToast(`Searching “${q}”…`, 'info') } }}
                placeholder={translatePortalText("Search jobs, boats, parts, technicians…")} className="input !rounded-full ps-10 pe-14" />
              <kbd className="absolute end-3.5 top-1/2 -translate-y-1/2 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-400">{translatePortalText("⌘K")}</kbd>
            </div>
            <div className="ms-auto flex items-center gap-1.5">
              <button title={translatePortalText("Quick actions")} onClick={() => setQuick(true)} className="btn-maint !rounded-full !px-3.5 !py-2 hidden md:inline-flex"><Plus size={16} /> {translatePortalText("Quick action")}</button>
              <ThemeToggle />
              <LanguageToggle />
              {/* The badge was a hardcoded "1", so the desk showed a standing
                  emergency at all times and the one moment it mattered looked
                  exactly like every other. It now counts open critical jobs, and
                  disappears when there are none. */}
              <button title={sidebarCounts.emergencies > 0
                ? translatePortalTemplate(
                  sidebarCounts.emergencies === 1 ? '{{count}} open emergency job' : '{{count}} open emergency jobs',
                  { count: sidebarCounts.emergencies },
                )
                : translatePortalText('Emergency SOS')}
                onClick={() => nav('/maint/mobile')} className="relative grid h-10 w-10 place-items-center rounded-full text-rose-500 transition hover:bg-rose-50">
                <LifeBuoy size={19} className={sidebarCounts.emergencies > 0 ? 'animate-wrench' : ''} />
                {sidebarCounts.emergencies > 0 && (
                  <span className="absolute end-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-rose-500 text-[9px] font-extrabold text-white">
                    {sidebarCounts.emergencies > 9 ? `${formatPortalNumber(9)}+` : formatPortalNumber(sidebarCounts.emergencies)}
                  </span>
                )}
              </button>
              <button title={translatePortalText("Notifications")} onClick={() => setNotif(true)} className="relative grid h-10 w-10 place-items-center rounded-full text-slate-500 transition hover:bg-violet-50 hover:text-violet-600">
                <Bell size={19} />
                {unreadCount > 0 && <span className="absolute end-1.5 top-1.5 grid h-4 w-4 place-items-center rounded-full bg-violet-500 text-[9px] font-extrabold text-white animate-pulse-soft">{formatPortalNumber(unreadCount)}</span>}
              </button>
              <button onClick={() => nav('/maint/settings')} className="ms-1 flex items-center gap-2.5 rounded-full border border-slate-200 bg-white py-1 ps-1 pe-3 transition hover:shadow-soft">
                <img src={avatar(38)} alt={user?.name ?? ''} className="h-8 w-8 rounded-full object-cover" />
                <span className="hidden text-left md:block">
                  <span className="block text-xs font-extrabold text-deep-900 leading-tight"><bdi dir="auto">{user?.name ?? translatePortalText('Maintenance operator')}</bdi></span>
                  <span className="block text-[10px] font-semibold text-slate-400">{user?.role === 'maintenance_worker' ? translatePortalText("Technician") : translatePortalText("Service Manager")}</span>
                </span>
              </button>
              <button title={translatePortalText("Sign out")} onClick={() => { logout(); nav('/login') }}
                className="grid h-10 w-10 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-deep-900"><LogOut size={17} /></button>
              <Clock />
            </div>
          </div>
          <div className="relative overflow-hidden border-t border-slate-100/70 bg-deep-950/[0.03]">
            <div className="animate-ticker flex w-max items-center gap-10 whitespace-nowrap px-6 py-1.5 text-[11px] font-bold text-slate-500">
              {[...ticker, ...ticker].map((t, i) => (
                <span key={i} className="flex items-center gap-2">{t}<span className="h-1 w-1 rounded-full bg-violet-400" /></span>
              ))}
            </div>
            <div className="pointer-events-none absolute inset-y-0 start-0 w-16 bg-gradient-to-r from-sand to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 end-0 w-16 bg-gradient-to-l from-sand to-transparent" />
          </div>
        </header>
        <MaintStatusBanner shop={shop} completeness={shop?.completeness} onRefresh={loadShop} />
        <main className="px-4 py-6 md:px-7 md:py-7 max-w-[1600px]">
          {/* Enter-only CSS fade keyed by route. The old framer-motion
              AnimatePresence mode="wait" could finish the outgoing page's exit
              and never mount the next one, leaving a blank white page. */}
          <div key={loc.pathname} className="route-enter">
            {useOutlet()}
          </div>
          <footer className="mt-10 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-5 pb-2 text-xs text-slate-400">
            {/* Named a fixed business — "HarborTech Marine Service" — regardless
                of who was signed in. `shopName` above already resolves the real
                one, with a generic fallback. */}
            <p>© {new Date().getFullYear()} {translatePortalText("HarborLink ·")} <bdi dir="auto">{footerName}</bdi> {translatePortalText("· Powered by BoatPro")}</p>
            {/* Was "All bays operational" beside a pulsing green dot — an
                operational status claim with no bay-status data behind it
                anywhere in the model, so it could never say anything else. The
                open work count is real and is what a service manager reads a
                footer for. */}
            <p className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse-soft" />
              {unreadCount > 0
                ? translatePortalTemplate(
                  unreadCount === 1 ? '{{count}} unread notification' : '{{count}} unread notifications',
                  { count: unreadCount },
                )
                : translatePortalText('No unread notifications')}
            </p>
          </footer>
        </main>
      </div>
      <NotifDrawer open={notif} onClose={() => setNotif(false)} notifs={notifs} loading={notifsLoading} onMarkAllRead={markAllRead} />
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
