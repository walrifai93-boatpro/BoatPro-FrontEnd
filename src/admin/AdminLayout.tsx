import React, { useEffect, useState } from 'react'
import { NavLink, useOutlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard, Users, BadgeCheck, Sailboat, CalendarCheck2, Landmark, Percent, Ticket,
  Star, Headset, BarChart3, Siren, Bot, Search, Menu, X, Plus, Radar, LogOut, Bell, Crown,
  Anchor, Fuel, Wrench, ShoppingBag, ShieldCheck, ChevronDown, LayoutGrid, ClipboardList, TrendingUp, CalendarDays, FileCheck2,
  ShieldAlert, Sparkles, Megaphone, FlaskConical } from 'lucide-react'
import { avatar } from './adminData'
import { fileUrl } from '../api'
import { ToastStack, toast } from '../ui'
import { ConfirmHost, RouteProgressBar } from '../async'
import { ThemeToggle } from '../theme'
import { LanguageToggle } from '../i18n/LanguageToggle'
import { localizedField, translatePortalText  , formatPortalDate, formatPortalNumber, formatPortalTime, isPortalArabic} from '../i18n/runtime'
import { adminPortalApi, ApiNotification } from '../api'
import { getSocket, onSocket } from '../socket'

type NavItem = { to: string; label: string; icon: any; badge?: number; roleCount?: string; workerCount?: string; stationApprovalCount?: boolean; marinaApprovalCount?: boolean; maintShopApprovalCount?: boolean }
type NavPanel = { panel: string; icon: any; accent: string; items: NavItem[] }

const NAV: NavPanel[] = [
  {
    panel: 'Platform Overview', icon: Crown, accent: 'from-emerald-400 to-teal-500', items: [
      { to: '/admin', label: 'Executive Dashboard', icon: LayoutDashboard },
      { to: '/admin/addon-requests', label: 'Add-On Requests', icon: Sparkles },
      { to: '/admin/featured-listings', label: 'Featured Listings', icon: Megaphone },
      { to: '/admin/calendar', label: 'Platform Calendar', icon: CalendarDays },
      { to: '/admin/reports', label: 'Reports & Analytics', icon: BarChart3 },
      // Two money entries where there were four. Payments & Payouts is money
      // moving — customer payments, weekly payouts to providers, and cash
      // commission owed to the platform — each a tab. Packages & Pricing is what
      // providers are charged, including the queue of requests to switch model.
      { to: '/admin/payments', label: 'Payments & Payouts', icon: Landmark },
      { to: '/admin/subscriptions', label: 'Packages & Pricing', icon: Percent },
      // Risk sits with the money because that is what it protects: the score is
      // built from cash disputes, overdue commission and chargebacks.
      { to: '/admin/risk', label: 'Risk & Fraud', icon: ShieldAlert },
      // No badge: this was a literal `badge: 2`, shown on every install whatever
      // the moderation queue held (0 reviews on a fresh database still read "2").
      { to: '/admin/reviews', label: 'Reviews & Moderation', icon: Star },
      // The platform desk. Every role can open a thread to it, so somebody has to
      // be able to open the queue — which, until this entry existed, nobody could.
      { to: '/admin/support', label: 'Inbox & Support', icon: Headset },
      { to: '/admin/support-agents', label: 'Support Team & Access', icon: Users },
      { to: '/admin/notifications', label: 'Notification Center', icon: Bell },
      { to: '/admin/emergency', label: 'Emergency Monitor', icon: Siren },
      { to: '/admin/ai', label: 'AI Management', icon: Bot },
      { to: '/admin/users', label: 'User Management', icon: Users },
      { to: '/admin/security', label: 'Security & Auth', icon: ShieldCheck },
      // What every provider type must upload to sign up. Site-wide, so it sits
      // here rather than being repeated under each provider panel.
      { to: '/admin/required-documents', label: 'Required Documents', icon: FileCheck2 },
      // Helpers for manual testing, such as the Fake fill button on signup forms.
      { to: '/admin/testing-tools', label: 'Testing Tools', icon: FlaskConical },
    ],
  },
  {
    panel: 'Boat Providers', icon: Sailboat, accent: 'from-sky-400 to-cyan-500', items: [
      { to: '/admin/boat/providers', label: 'Provider Directory', icon: LayoutGrid, roleCount: 'boat_provider' },
      { to: '/admin/boat/addon-requests', label: 'Add-On Requests', icon: Sparkles },
      { to: '/admin/boat/featured-listings', label: 'Featured Listings', icon: Megaphone },
      { to: '/admin/boat/listings', label: 'Boat Listings', icon: Sailboat },
      { to: '/admin/boat/bookings', label: 'Bookings', icon: CalendarCheck2 },
      { to: '/admin/boat/workers', label: 'Crew Requests', icon: Users, workerCount: 'boat' },
      { to: '/admin/boat/commission-revenue', label: 'Revenue by Commission', icon: Landmark },
      { to: '/admin/boat/package-revenue', label: 'Revenue by Packages', icon: Ticket },
      { to: '/admin/boat/reviews', label: 'Reviews', icon: Star },
      { to: '/admin/boat/kyc', label: 'KYC & Verification', icon: ShieldCheck },
      { to: '/admin/boat/approvals', label: 'Boat Approvals', icon: Sailboat },
      { to: '/admin/boat/analytics', label: 'Performance', icon: TrendingUp },
    ],
  },
  {
    panel: 'Marina Providers', icon: Anchor, accent: 'from-teal-400 to-emerald-500', items: [
      { to: '/admin/marina/providers', label: 'Provider Directory', icon: LayoutGrid, roleCount: 'marina_provider' },
      { to: '/admin/marina/addon-requests', label: 'Add-On Requests', icon: Sparkles },
      { to: '/admin/marina/listings', label: 'Marinas & Berths', icon: Anchor },
      { to: '/admin/marina/bookings', label: 'Berth Bookings', icon: CalendarCheck2 },
      { to: '/admin/marina/workers', label: 'Worker Requests', icon: Users, workerCount: 'marina' },
      { to: '/admin/marina/approvals', label: 'Marina Approvals', icon: ShieldCheck, marinaApprovalCount: true },
      { to: '/admin/marina/commission-revenue', label: 'Revenue by Commission', icon: Landmark },
      { to: '/admin/marina/package-revenue', label: 'Revenue by Packages', icon: Ticket },
      { to: '/admin/marina/reviews', label: 'Reviews', icon: Star },
      { to: '/admin/marina/kyc', label: 'KYC & Verification', icon: ShieldCheck },
      { to: '/admin/marina/analytics', label: 'Performance', icon: TrendingUp },
    ],
  },
  {
    panel: 'Fuel Providers', icon: Fuel, accent: 'from-amber-400 to-orange-500', items: [
      { to: '/admin/fuel/providers', label: 'Provider Directory', icon: LayoutGrid, roleCount: 'fuel_provider' },
      { to: '/admin/fuel/addon-requests', label: 'Add-On Requests', icon: Sparkles },
      { to: '/admin/fuel/listings', label: 'Fuel Stations', icon: Fuel },
      { to: '/admin/fuel/bookings', label: 'Fuel Orders', icon: ClipboardList },
      { to: '/admin/fuel/workers', label: 'Worker Requests', icon: Users, workerCount: 'fuel' },
      { to: '/admin/fuel/approvals', label: 'Station Approvals', icon: ShieldCheck, stationApprovalCount: true },
      { to: '/admin/fuel/commission-revenue', label: 'Revenue by Commission', icon: Landmark },
      { to: '/admin/fuel/package-revenue', label: 'Revenue by Packages', icon: Ticket },
      { to: '/admin/fuel/reviews', label: 'Reviews', icon: Star },
      { to: '/admin/fuel/kyc', label: 'KYC & Verification', icon: ShieldCheck },
      { to: '/admin/fuel/analytics', label: 'Performance', icon: TrendingUp },
    ],
  },
  {
    panel: 'Maintenance', icon: Wrench, accent: 'from-violet-400 to-indigo-500', items: [
      { to: '/admin/maintenance/providers', label: 'Provider Directory', icon: LayoutGrid, roleCount: 'maintenance_provider' },
      { to: '/admin/maintenance/addon-requests', label: 'Add-On Requests', icon: Sparkles },
      { to: '/admin/maintenance/listings', label: 'Service Catalog', icon: Wrench },
      { to: '/admin/maintenance/bookings', label: 'Work Orders', icon: ClipboardList },
      { to: '/admin/maintenance/workers', label: 'Worker Requests', icon: Users, workerCount: 'maintenance' },
      { to: '/admin/maintenance/approvals', label: 'Vendor Approvals', icon: ShieldCheck, maintShopApprovalCount: true },
      { to: '/admin/maintenance/commission-revenue', label: 'Revenue by Commission', icon: Landmark },
      { to: '/admin/maintenance/package-revenue', label: 'Revenue by Packages', icon: Ticket },
      { to: '/admin/maintenance/reviews', label: 'Reviews', icon: Star },
      { to: '/admin/maintenance/kyc', label: 'KYC & Verification', icon: ShieldCheck },
      { to: '/admin/maintenance/analytics', label: 'Performance', icon: TrendingUp },
    ],
  },

  {
    panel: 'Users (Customer)', icon: Users, accent: 'from-rose-400 to-pink-500', items: [
      { to: '/admin/customers', label: 'Customers', icon: ShoppingBag },
      { to: '/admin/customer/bookings', label: 'Customer Bookings', icon: CalendarCheck2 },
      { to: '/admin/customer/reviews', label: 'Customer Reviews', icon: Star },
    ],
  },
]

function NavGroup({ panel, isOpen, onToggle, onClose, pendingRoleCounts, pendingWorkerCounts, pendingStationApprovals, pendingMarinaApprovals, pendingMaintShopApprovals }: { panel: NavPanel; isOpen: boolean; onToggle: () => void; onClose: () => void; pendingRoleCounts: Record<string, number>; pendingWorkerCounts: Record<string, number>; pendingStationApprovals: number; pendingMarinaApprovals: number; pendingMaintShopApprovals: number }) {
  const loc = useLocation()
  const active = panel.items.some(it => it.to === '/admin' ? loc.pathname === '/admin' : loc.pathname.startsWith(it.to))
  const totalBadge = panel.items.reduce((s, it) => s + (it.badge || (it.roleCount ? pendingRoleCounts[it.roleCount] || 0 : 0) || (it.workerCount ? pendingWorkerCounts[it.workerCount] || 0 : 0) || (it.stationApprovalCount ? pendingStationApprovals || 0 : 0) || (it.marinaApprovalCount ? pendingMarinaApprovals || 0 : 0) || (it.maintShopApprovalCount ? pendingMaintShopApprovals || 0 : 0)), 0)
  return (
    <div className="mb-1">
      <button onClick={onToggle}
        className={`group flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[12px] font-extrabold uppercase tracking-wide transition ${active ? 'text-white' : 'text-white/65 hover:text-white/90'}`}>
        <span className={`grid h-6 w-6 place-items-center rounded-lg bg-gradient-to-br ${panel.accent} text-[#041410] shadow-sm`}><panel.icon size={13} /></span>
        <span className="flex-1 text-left">{translatePortalText(panel.panel)}</span>
        {!isOpen && totalBadge > 0 && <span className="grid h-4 min-w-4 place-items-center rounded-full bg-emerald-400 px-1 text-[9px] font-extrabold text-[#041410]">{formatPortalNumber(totalBadge)}</span>}
        <ChevronDown size={14} className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }} className="overflow-hidden">
            <div className="ms-3 border-s border-white/10 ps-2 pt-0.5">
              {panel.items.map(it => {
                const badge = it.badge || (it.roleCount ? pendingRoleCounts[it.roleCount] || 0 : 0) || (it.workerCount ? pendingWorkerCounts[it.workerCount] || 0 : 0) || (it.stationApprovalCount ? pendingStationApprovals || 0 : 0) || (it.marinaApprovalCount ? pendingMarinaApprovals || 0 : 0) || (it.maintShopApprovalCount ? pendingMaintShopApprovals || 0 : 0);
                return (
                <NavLink key={it.to} to={it.to} end={it.to === '/admin'} onClick={onClose}
                  className={({ isActive }) => `group relative mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-all duration-200 ${isActive ? 'bg-white/12 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,.1)]' : 'text-white/70 hover:bg-white/6 hover:text-white'}`}>
                  {({ isActive }) => (<>
                    {isActive && <motion.span layoutId="admin-nav-pill" className="absolute inset-y-0 start-0 my-auto h-5 w-1 rounded-e-full bg-gradient-to-b from-emerald-300 to-teal-500" />}
                    <it.icon size={15} className={isActive ? 'text-emerald-300' : 'text-white/65 group-hover:text-emerald-300 transition-colors'} />
                    {translatePortalText(it.label)}
                    {badge > 0 && <span className="ms-auto grid h-4 min-w-4 place-items-center rounded-full bg-emerald-400 px-1 text-[9px] font-extrabold text-[#041410]">{formatPortalNumber(badge)}</span>}
                  </>)}
                </NavLink>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * The live platform figures shown in the console chrome.
 *
 * Replaces four invented strings: "1,841 online now", "99.98% uptime · 42
 * errors/24h", "All systems live · 6 regions" in the sidebar and "99.98%
 * uptime · 6 regions live" in the footer. Nothing measured any of them, and
 * ambient numbers that are made up are how an operator learns to discount the
 * real ones next to them.
 *
 * Polled on the same 60s cadence as the notification bell. Returns `null` until
 * the first response and after a failure, so callers render nothing rather than
 * a zero that would read as "nobody is online".
 */
function usePlatformPulse() {
  const [pulse, setPulse] = useState<{ onlineNow: number; activeProviders: number; pendingApprovals: number; processUptimeSeconds: number } | null>(null)
  useEffect(() => {
    let alive = true
    const tick = () =>
      adminPortalApi
        .platformPulse()
        .then(res => { if (alive) setPulse(res.data) })
        // Silent: this is chrome, and an error banner over the navigation
        // would be louder than the information is worth.
        .catch(() => { if (alive) setPulse(null) })
    tick()
    const t = setInterval(tick, 60_000)
    return () => { alive = false; clearInterval(t) }
  }, [])
  return pulse
}

/** "3d 4h" / "6h 12m" / "8m" — how long this API process has been up. */
function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (isPortalArabic()) {
    if (d > 0) return `${formatPortalNumber(d)} ${d === 1 ? 'يوم' : 'أيام'} ${formatPortalNumber(h)} ${h === 1 ? 'ساعة' : 'ساعات'}`
    if (h > 0) return `${formatPortalNumber(h)} ${h === 1 ? 'ساعة' : 'ساعات'} ${formatPortalNumber(m)} دقيقة`
    return `${formatPortalNumber(m)} دقيقة`
  }
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function Sidebar({ open, desktopOpen, onClose, onDesktopClose, pendingRoleCounts, pendingWorkerCounts, pendingStationApprovals, pendingMarinaApprovals, pendingMaintShopApprovals }: { open: boolean; desktopOpen: boolean; onClose: () => void; onDesktopClose: () => void; pendingRoleCounts: Record<string, number>; pendingWorkerCounts: Record<string, number>; pendingStationApprovals: number; pendingMarinaApprovals: number; pendingMaintShopApprovals: number }) {
  const loc = useLocation()
  const activePanel = () => {
    const p = NAV.find(g => g.items.some(it => it.to === '/admin' ? loc.pathname === '/admin' : loc.pathname.startsWith(it.to)))
    return p?.panel ?? 'Platform Overview'
  }
  const [openPanel, setOpenPanel] = useState<string>(activePanel())
  useEffect(() => { setOpenPanel(activePanel()) }, [loc.pathname])
  const pulse = usePlatformPulse()
  return (
    <>
      <AnimatePresence>
        {open && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-40 bg-deep-950/50 backdrop-blur-sm lg:hidden" onClick={onClose} />}
      </AnimatePresence>
      <aside className={`portal-sidebar bg-admin-gradient fixed inset-y-0 start-0 z-50 flex w-[264px] flex-col text-white transition-transform duration-300 ${desktopOpen ? 'lg:translate-x-0' : 'lg:-translate-x-full'} ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center gap-3 px-5 pt-6 pb-4">
          <div className="relative h-12 w-12 shrink-0">
            <img src="/logo.png" alt={translatePortalText("BoatPro")} className="h-full w-full object-contain drop-shadow-[0_0_15px_rgba(16,185,129,0.4)]" onError={e => ((e.target as HTMLImageElement).style.display = 'none')} />
            <Crown size={15} className="absolute -bottom-1 -end-1 text-emerald-300" />
          </div>
          <div>
            <p className="font-display text-xl font-extrabold leading-tight tracking-wide text-white drop-shadow-sm">{translatePortalText("BoatPro")}</p>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-300">{translatePortalText("Super Admin")}</p>
          </div>
          <button className="ms-auto lg:hidden text-white/60 hover:text-white" onClick={onClose}><X size={20} /></button>
          <button className="ms-auto hidden lg:block text-white/60 hover:text-white" onClick={onDesktopClose}><X size={20} /></button>
        </div>

        <div className="mx-4 mb-3 overflow-hidden rounded-2xl border border-white/10">
          <div className="relative h-[86px]">
            <video src="/videos/promo.mp4" autoPlay loop muted playsInline className="h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#041410]/90 via-[#041410]/30 to-transparent" />
            <div className="absolute bottom-2 start-3">
              <p className="font-display text-sm font-bold">{translatePortalText('BoatPro HQ')}</p>
              {/* Was "All systems live · 6 regions" — there is no region model
                  to enumerate and no health check behind "all systems". The
                  count of providers actually trading is both true and more use. */}
              <p className="flex items-center gap-1.5 text-[11px] text-emerald-200">
                <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" /></span>
                {pulse ? `${formatPortalNumber(pulse.activeProviders)} ${translatePortalText(pulse.activeProviders === 1 ? 'active provider' : 'active providers')}` : translatePortalText('Super Admin Console')}
              </p>
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          {NAV.map(g => (
            <NavGroup key={g.panel} panel={g} isOpen={openPanel === g.panel} pendingRoleCounts={pendingRoleCounts} pendingWorkerCounts={pendingWorkerCounts} pendingStationApprovals={pendingStationApprovals} pendingMarinaApprovals={pendingMarinaApprovals} pendingMaintShopApprovals={pendingMaintShopApprovals}
              onToggle={() => setOpenPanel(p => p === g.panel ? '' : g.panel)} onClose={onClose} />
          ))}
        </nav>

        <div className="mx-4 mb-4 rounded-2xl bg-white/8 p-3.5 backdrop-blur border border-white/10">
          <div className="flex items-center gap-3">
            <Radar size={22} className="animate-heartbeat text-emerald-300" />
            <div>
              {/* `onlineNow` counts distinct users holding a socket, fleet-wide.
                  The uptime shown is this API process's own, labelled as such —
                  the old "99.98%" implied a measured service level that nothing
                  computes, and "42 errors/24h" had no error store behind it. */}
              <p className="font-display text-sm font-extrabold leading-tight">
                {pulse ? `${formatPortalNumber(pulse.onlineNow)} ${translatePortalText('online now')}` : '—'}
              </p>
              <p className="text-[11px] text-white/60">
                {pulse
                  ? `${translatePortalText('API up')} ${formatUptime(pulse.processUptimeSeconds)}${pulse.pendingApprovals > 0 ? ` · ${formatPortalNumber(pulse.pendingApprovals)} ${translatePortalText('awaiting approval')}` : ''}`
                  : translatePortalText('Connecting…')}
              </p>
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}

// ── NOTIFICATIONS (real, backed by the admin's own Notification feed) ──
const NOTIF_ICON: Record<string, { icon: string; tone: string }> = {
  provider_signup: { icon: '🗂️', tone: 'warn' },
  document_submitted: { icon: '🪪', tone: 'warn' },
  emergency_sos: { icon: '🚨', tone: 'danger' },
  fraud_alert: { icon: '🛡️', tone: 'danger' },
  support_ticket: { icon: '🎧', tone: 'warn' },
  payment_success: { icon: '💵', tone: 'success' },
  payment_refund: { icon: '💵', tone: 'info' },
  review_received: { icon: '⭐', tone: 'success' },
}
function notifMeta(type: string) { return NOTIF_ICON[type] || { icon: '🔔', tone: 'info' } }
function timeAgo(iso: string) {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (isPortalArabic()) {
    const relative = new Intl.RelativeTimeFormat('ar-SA', { numeric: 'auto' })
    if (s < 60) return relative.format(-s, 'second')
    if (s < 3600) return relative.format(-Math.floor(s / 60), 'minute')
    if (s < 86400) return relative.format(-Math.floor(s / 3600), 'hour')
    return relative.format(-Math.floor(s / 86400), 'day')
  }
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} d ago`
}

function useAdminNotifications() {
  const [items, setItems] = useState<ApiNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const refresh = () => adminPortalApi.notifications({ limit: 30 }, { silent: true }).then(res => {
    setItems(res.data.items); setUnreadCount(res.data.unreadCount)
  }).catch(() => {})
  // Polling is the floor, not the mechanism — the socket below is what makes
  // the console live. If it drops, admins fall back to a minute behind rather
  // than going silent.
  useEffect(() => {
    void refresh()
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    const t = setInterval(onVisible, 60_000)
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible) }
  }, [])

  // A notification arrives complete, so it goes straight into the drawer and
  // the badge without a round trip. This is the path that actually delivers a
  // fraud alert to an admin at a desk: they hold no push token, so before this
  // the alert waited on the poll above.
  useEffect(() => {
    const off = onSocket('notification:new', (payload: ApiNotification) => {
      if (!payload?.id) return
      setItems(prev => (prev.some(n => n.id === payload.id) ? prev : [payload, ...prev].slice(0, 30)))
      setUnreadCount(n => n + 1)
    })
    // A reconnect means an unknown span offline, so re-read rather than trust
    // the events that may have been missed while the socket was down.
    const socket = getSocket()
    socket?.on('connect', refresh)
    return () => { off(); socket?.off('connect', refresh) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const markAllRead = () => adminPortalApi.markAllNotificationsRead().then(refresh).catch(() => {})
  const markRead = (id: string) => adminPortalApi.markNotificationRead(id).then(refresh).catch(() => {})
  return { items, unreadCount, markAllRead, markRead }
}

// ── DRAWERS ──
function NotifDrawer({ open, onClose, items, onMarkAllRead, onMarkRead }: { open: boolean; onClose: () => void; items: ApiNotification[]; onMarkAllRead: () => void; onMarkRead: (id: string) => void }) {
  const tones: any = { info: 'bg-teal-50 text-teal-600', success: 'bg-emerald-50 text-emerald-600', warn: 'bg-amber-50 text-amber-600', danger: 'bg-rose-50 text-rose-600' }
  return (
    <AnimatePresence>
      {open && (<>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[80] bg-deep-950/40 backdrop-blur-sm" onClick={onClose} />
        <motion.aside initial={{ x: 420 }} animate={{ x: 0 }} exit={{ x: 420 }} transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          className="fixed end-0 top-0 z-[85] flex h-full w-full max-w-md flex-col bg-white shadow-lift">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h3 className="font-display text-lg font-bold">🛡️ {translatePortalText('Platform Notifications')}</h3>
            <div className="flex gap-2">
              <button className="btn-ghost !py-1.5 !px-3 text-xs" onClick={() => { onMarkAllRead(); toast(translatePortalText('All notifications marked as read')) }}>{translatePortalText('Mark all read')}</button>
              <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={18} /></button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {items.length === 0 && <p className="py-10 text-center text-sm text-slate-400">{translatePortalText('No notifications yet.')}</p>}
            {items.map((n, i) => {
              const meta = notifMeta(n.type)
              return (
                <motion.div key={n._id} initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
                  onClick={() => !n.isRead && onMarkRead(n._id)}
                  className={`flex gap-3 rounded-2xl border p-3.5 transition hover:shadow-soft cursor-pointer ${!n.isRead ? 'border-emerald-100 bg-emerald-50/40' : 'border-slate-100 bg-white'}`}>
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg ${tones[meta.tone]}`}>{meta.icon}</span>
                  <div className="min-w-0">
                    <p className="text-xs font-extrabold uppercase tracking-wide text-slate-400">{localizedField<string>(n, 'title', n.title)} · {timeAgo(n.createdAt)}</p>
                    <p className="mt-0.5 text-sm font-medium text-deep-800">{localizedField<string>(n, 'body', n.body)}</p>
                  </div>
                  {!n.isRead && <span className="ms-auto mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />}
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
    { icon: '🗓️', label: 'Customer Bookings', to: '/admin/customer/bookings' }, { icon: '👤', label: 'Create User', to: '/admin/users' },
    { icon: '💵', label: 'Run Settlement', to: '/admin/payments?tab=payouts' },
    { icon: '⛵', label: 'Boat Providers', to: '/admin/boat/providers' }, { icon: '⚓', label: 'Marina Providers', to: '/admin/marina/providers' },
    { icon: '🛍️', label: 'Customers', to: '/admin/customers' }, { icon: '📊', label: 'View Reports', to: '/admin/reports' },
  ]
  return (
    <AnimatePresence>
      {open && (<>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[80] bg-deep-950/40 backdrop-blur-sm" onClick={onClose} />
        <motion.div initial={{ opacity: 0, y: -16, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -12 }}
          className="fixed left-1/2 top-24 z-[85] w-[92%] max-w-xl -translate-x-1/2 card p-6">
          <h3 className="font-display text-lg font-bold mb-4">⚡ {translatePortalText('Quick Actions')}</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {acts.map((a, i) => (
              <motion.button key={a.label} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.04 }}
                onClick={() => { onClose(); nav(a.to) }}
                className="flex flex-col items-center gap-2 rounded-2xl border border-slate-100 bg-sand p-4 text-center transition hover:border-emerald-300 hover:bg-emerald-50 hover:shadow-soft active:scale-95">
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
      className="bg-admin-gradient fixed inset-0 z-[200] grid place-items-center">
      <div className="text-center text-white">
        <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', damping: 14 }}
          className="mx-auto mb-6 grid h-24 w-24 place-items-center rounded-3xl bg-gradient-to-br from-emerald-500 to-teal-500 shadow-[0_0_50px_rgba(16,185,129,0.55)]">
          <Crown size={44} />
        </motion.div>
        <p className="font-display text-4xl font-extrabold tracking-tight text-white drop-shadow-md">
          {'Super Admin'.split('').map((ch, i) => (
            <span key={i} className="splash-letter inline-block" style={{ animationDelay: `${0.1 + i * 0.05}s` }}>{ch === ' ' ? ' ' : ch}</span>
          ))}
        </p>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }}
          className="mt-1 text-xs font-bold uppercase tracking-[0.35em] text-emerald-300">{translatePortalText("BoatPro Control Center")}</motion.p>
        <motion.div initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 0.3, duration: 0.9, ease: 'easeInOut' }}
          className="mx-auto mt-6 h-0.5 w-44 origin-left rounded-full bg-gradient-to-r from-emerald-400 to-teal-300" />
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
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
        {formatPortalDate(now, { weekday: 'short', month: 'short', day: 'numeric' })} · {translatePortalText('BoatPro HQ')}
      </span>
    </div>
  )
}

export default function AdminLayout() {
  const [side, setSide] = useState(false)
  const [desktopSide, setDesktopSide] = useState(true)
  const [notif, setNotif] = useState(false)
  const [quick, setQuick] = useState(false)
  const [q, setQ] = useState('')
  const [pendingRoleCounts, setPendingRoleCounts] = useState<Record<string, number>>({})
  const [pendingWorkerCounts, setPendingWorkerCounts] = useState<Record<string, number>>({})
  const [pendingStationApprovals, setPendingStationApprovals] = useState(0)
  const [pendingMarinaApprovals, setPendingMarinaApprovals] = useState(0)
  const [pendingMaintShopApprovals, setPendingMaintShopApprovals] = useState(0)
  const pulse = usePlatformPulse()
  const nav = useNavigate()
  const { user, logout } = useAuth()
  const loc = useLocation()
  const { items: notifItems, unreadCount, markAllRead, markRead } = useAdminNotifications()
  const ticker = notifItems.length ? notifItems.slice(0, 8).map(n => `${notifMeta(n.type).icon} ${translatePortalText(n.body)}`) : [translatePortalText('🟢 All clear — no new platform alerts')]
  useEffect(() => {
    adminPortalApi.dashboard().then(res => {
      setPendingRoleCounts(res.data?.totals?.pendingRoleCounts || {})
      setPendingWorkerCounts(res.data?.totals?.pendingWorkerCounts || {})
      setPendingStationApprovals(res.data?.totals?.pendingStationApprovals || 0)
      setPendingMarinaApprovals(res.data?.totals?.pendingMarinaApprovals || 0)
      setPendingMaintShopApprovals(res.data?.totals?.pendingMaintShopApprovals || 0)
    }).catch(() => {})
  }, [loc.pathname])
  return (
    <div className="min-h-screen overflow-x-hidden">
      <Sidebar open={side} desktopOpen={desktopSide} onClose={() => setSide(false)} onDesktopClose={() => setDesktopSide(false)} pendingRoleCounts={pendingRoleCounts} pendingWorkerCounts={pendingWorkerCounts} pendingStationApprovals={pendingStationApprovals} pendingMarinaApprovals={pendingMarinaApprovals} pendingMaintShopApprovals={pendingMaintShopApprovals} />
      <div data-sidebar-open={desktopSide ? 'true' : 'false'} className={`portal-main-offset transition-all duration-300 ${desktopSide ? 'lg:ps-[264px]' : 'lg:ps-0'}`}>
        <header className="sticky top-0 z-30 glass border-b border-slate-100/60">
          <div className="flex items-center gap-3 px-4 py-3 md:px-7">
            <button className="lg:hidden btn-ghost !p-2" onClick={() => setSide(true)}><Menu size={18} /></button>
            <button className={`hidden lg:block btn-ghost !p-2 transition-opacity ${desktopSide ? 'opacity-0 pointer-events-none w-0 !p-0' : 'opacity-100'}`} onClick={() => setDesktopSide(true)}><Menu size={18} /></button>
            <div className="relative hidden flex-1 max-w-md sm:block">
              <Search size={16} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={e => setQ(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && q.trim()) { nav('/admin/users'); toast(translatePortalText(`Searching “${q}”…`), 'info') } }}
                placeholder={translatePortalText('Search users, providers, bookings, transactions…')} className="input !rounded-full ps-10 pe-14" />
              <kbd className="absolute end-3.5 top-1/2 -translate-y-1/2 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-400">⌘K</kbd>
            </div>
            <div className="ms-auto flex items-center gap-1.5">
              <button title={translatePortalText('Quick action')} onClick={() => setQuick(true)} className="btn-admin !rounded-full !px-3.5 !py-2 hidden md:inline-flex"><Plus size={16} /> {translatePortalText('Quick action')}</button>
              <ThemeToggle />
              <LanguageToggle />
              <button title={translatePortalText('Notifications')} onClick={() => setNotif(true)} className="relative grid h-10 w-10 place-items-center rounded-full text-slate-500 transition hover:bg-emerald-50 hover:text-emerald-600">
                <Bell size={19} />
                {unreadCount > 0 && <span className="absolute end-1.5 top-1.5 grid h-4 w-4 place-items-center rounded-full bg-emerald-500 text-[9px] font-extrabold text-white animate-pulse-soft">{unreadCount > 9 ? `${formatPortalNumber(9)}+` : formatPortalNumber(unreadCount)}</span>}
              </button>
              <button onClick={() => toast(translatePortalText('Account menu — profile & security'), 'info')} className="ms-1 flex items-center gap-2.5 rounded-full border border-slate-200 bg-white py-1 ps-1 pe-3 transition hover:shadow-soft">
                {/* Every signed-in operator was shown as "Tom Whitaker, Super
                    Admin" — a name belonging to nobody, on the one control in
                    the chrome that says whose session this is. */}
                <img src={fileUrl(user?.avatar) || avatar(52)} alt={user?.name ?? ''} className="h-8 w-8 rounded-full object-cover" />
                <span className="hidden text-left md:block">
                  <span className="block text-xs font-extrabold text-deep-900 leading-tight"><bdi dir="auto">{translatePortalText(localizedField<string>(user, 'name', user?.name) || user?.name || 'Administrator')}</bdi></span>
                  <span className="block text-[10px] font-semibold text-slate-400">{user?.email ?? ''}</span>
                </span>
              </button>
              <button title={translatePortalText('Sign out')} onClick={() => { logout(); nav('/login') }}
                className="grid h-10 w-10 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-deep-900"><LogOut size={17} /></button>
              <Clock />
            </div>
          </div>
          <div className="relative overflow-hidden border-t border-slate-100/70 bg-deep-950/[0.03]">
            <div className="animate-ticker flex w-max items-center gap-10 whitespace-nowrap px-6 py-1.5 text-[11px] font-bold text-slate-500">
              {[...ticker, ...ticker].map((t, i) => (
                <span key={i} className="flex items-center gap-2">{t}<span className="h-1 w-1 rounded-full bg-emerald-400" /></span>
              ))}
            </div>
            <div className="pointer-events-none absolute inset-y-0 start-0 w-16 bg-gradient-to-r from-sand to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 end-0 w-16 bg-gradient-to-l from-sand to-transparent" />
          </div>
        </header>
        <main className="px-4 py-6 md:px-7 md:py-7 max-w-[1600px]">
          <AnimatePresence mode="wait">
            <motion.div key={loc.pathname} initial={{ opacity: 0, y: 18, scale: 0.995 }} animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.995 }} transition={{ duration: 0.28, ease: 'easeOut' }}>
              {useOutlet()}
            </motion.div>
          </AnimatePresence>
          <footer className="mt-10 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-5 pb-2 text-xs text-slate-400">
            <p>© {formatPortalNumber(new Date().getFullYear())} HarborLink · {translatePortalText('BoatPro Platform HQ')} · {translatePortalText('Super Admin Console')}</p>
            {/* Was "99.98% uptime · 6 regions live", neither of which was
                measured anywhere. The dot means the API answered this poll. */}
            <p className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${pulse ? 'bg-emerald-400 animate-pulse-soft' : 'bg-slate-300'}`} />
              {pulse ? `${translatePortalText('API up')} ${formatUptime(pulse.processUptimeSeconds)}` : translatePortalText('Waiting for the API')}
            </p>
          </footer>
        </main>
      </div>
      <NotifDrawer open={notif} onClose={() => setNotif(false)} items={notifItems} onMarkAllRead={markAllRead} onMarkRead={markRead} />
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
