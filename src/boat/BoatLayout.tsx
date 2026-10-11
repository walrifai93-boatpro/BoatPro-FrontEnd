import React, { useCallback, useEffect, useState } from 'react'
import { NavLink, useOutlet, useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Ship, CreditCard, Bell, Menu, X, LogOut, Anchor, Users, LifeBuoy, ShieldCheck } from 'lucide-react'
import { useAuth } from '../auth'
import { notificationsApi, boatApi, fileUrl, type ApiNotification, type ApiBoat } from '../api'
import { ToastStack, ListRowSkeleton } from '../ui'
import { ConfirmHost, RouteProgressBar } from '../async'
import { ThemeToggle } from '../theme'
import { LanguageToggle } from '../i18n/LanguageToggle'
import { localizedField, localizedEnum, formatPortalDate, formatPortalNumber, translatePortalText } from '../i18n/runtime'
import { avatar } from '../format'
import BoatStatusBanner from './components/BoatStatusBanner'

const NAV = [
  { to: '/boat', label: 'My Boats', icon: Ship },
  { to: '/boat/crew', label: 'Crew & Staff', icon: Users },
  { to: '/boat/billing', label: 'Package & Billing', icon: CreditCard },
  // Present in the marina, fuel and maintenance sidebars; this console was the
  // one without it, so a boat operator on the web could not reach BoatPro.
  { to: '/boat/inbox', label: 'Inbox & Help', icon: LifeBuoy },
  { to: '/boat/standing', label: 'Account standing', icon: ShieldCheck },
]

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth()
  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-deep-950/50 backdrop-blur-sm lg:hidden" onClick={onClose} />
        )}
      </AnimatePresence>
      <aside className={`portal-sidebar fixed inset-y-0 start-0 z-50 flex w-[264px] flex-col bg-gradient-to-b from-deep-950 to-deep-900 text-white transition-transform duration-300 lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center gap-3 px-5 pt-6 pb-4">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-ocean-500 to-ocean-300">
            <Anchor size={20} />
          </div>
          <div>
            <p className="font-display text-xl font-extrabold leading-tight">{translatePortalText("BoatPro")}</p>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-ocean-300">{translatePortalText("Boat Provider")}</p>
          </div>
          <button className="ms-auto lg:hidden text-white/60 hover:text-white" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="mx-4 mb-3 rounded-2xl border border-white/10 bg-white/5 p-3.5">
          <p className="truncate text-sm font-bold"><bdi dir="auto">{localizedField(user?.business, 'businessName') || localizedField(user, 'name') || translatePortalText('Boat Provider')}</bdi></p>
          <p className="truncate text-[11px] text-white/70"><bdi dir="auto">{localizedField(user?.business, 'city') || user?.email}</bdi></p>
        </div>

        <nav className="flex-1 px-3 pb-4">
          {NAV.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.to === '/boat'} onClick={onClose}
              className={({ isActive }) => `mb-0.5 flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-semibold transition-all duration-200 ${isActive ? 'bg-white/12 text-white' : 'text-white/70 hover:bg-white/6 hover:text-white'}`}>
              <it.icon size={17} />
              {translatePortalText(it.label)}
            </NavLink>
          ))}
        </nav>
      </aside>
    </>
  )
}

function NotifDrawer({ open, onClose, notifs, loading, onMarkAllRead }: { open: boolean; onClose: () => void; notifs: ApiNotification[]; loading: boolean; onMarkAllRead: () => void }) {
  return (
    <AnimatePresence>
      {open && (<>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[80] bg-deep-950/40 backdrop-blur-sm" onClick={onClose} />
        <motion.aside initial={{ x: 420 }} animate={{ x: 0 }} exit={{ x: 420 }} transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          className="fixed end-0 top-0 z-[85] flex h-full w-full max-w-md flex-col bg-white shadow-lift">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h3 className="font-display text-lg font-bold">{translatePortalText("Notifications")}</h3>
            <div className="flex gap-2">
              <button className="btn-ghost !py-1.5 !px-3 text-xs" onClick={onMarkAllRead}>{translatePortalText("Mark all read")}</button>
              <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={18} /></button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {loading && <ListRowSkeleton count={4} />}
            {!loading && notifs.length === 0 && <div className="py-10 text-center text-sm text-slate-400">{translatePortalText("No notifications.")}</div>}
            {!loading && notifs.map((n) => (
              <div key={n._id} className={`rounded-2xl border p-3.5 ${!n.isRead ? 'border-ocean-100 bg-ocean-50/40' : 'border-slate-100 bg-white'}`}>
                <p className="text-xs font-extrabold uppercase tracking-wide text-slate-400">{localizedEnum(n.type)} · {formatPortalDate(n.createdAt, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
                <p className="mt-0.5 text-sm font-medium text-deep-800"><bdi dir="auto">{localizedField<string>(n, 'title', n.title)}{n.body ? ` — ${localizedField<string>(n, 'body', n.body)}` : ''}</bdi></p>
              </div>
            ))}
          </div>
        </motion.aside>
      </>)}
    </AnimatePresence>
  )
}

export default function BoatLayout() {
  const [side, setSide] = useState(false)
  const [notif, setNotif] = useState(false)
  const [notifs, setNotifs] = useState<ApiNotification[]>([])
  const [notifsLoading, setNotifsLoading] = useState(true)
  const [boats, setBoats] = useState<ApiBoat[]>([])
  const unreadCount = notifs.filter((n) => !n.isRead).length
  const nav = useNavigate()
  const { logout, user } = useAuth()
  const loc = useLocation()

  const loadBoats = useCallback(async () => {
    try {
      const res = await boatApi.mine()
      setBoats(res.data.items || [])
    } catch {}
  }, [])

  useEffect(() => {
    void loadBoats()
  }, [loadBoats])

  const loadNotifs = useCallback(async (background = false) => {
    if (!background) setNotifsLoading(true)
    try {
      const res = await notificationsApi.list({ limit: 30 }, { silent: background })
      setNotifs(res.data.items || [])
    } catch {
      /* non-critical */
    } finally {
      if (!background) setNotifsLoading(false)
    }
  }, [])
  useEffect(() => {
    void loadNotifs()
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void loadNotifs(true)
    }, 60_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void loadNotifs(true)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible) }
  }, [loadNotifs])

  const markAllRead = async () => {
    await notificationsApi.markAllRead()
    await loadNotifs()
  }

  return (
    <div className="min-h-screen overflow-x-hidden">
      <Sidebar open={side} onClose={() => setSide(false)} />
      <div data-sidebar-open="true" className="portal-main-offset transition-all duration-300 lg:ps-[264px]">
        <header className="sticky top-0 z-30 glass border-b border-slate-100/60">
          <div className="flex items-center gap-3 px-4 py-3 md:px-7">
            <button className="lg:hidden btn-ghost !p-2" onClick={() => setSide(true)}><Menu size={18} /></button>
            <div className="ms-auto flex items-center gap-1.5">
              <ThemeToggle />
              <LanguageToggle />
              <button title={translatePortalText("Notifications")} onClick={() => setNotif(true)} className="relative grid h-10 w-10 place-items-center rounded-full text-slate-500 transition hover:bg-ocean-50 hover:text-ocean-600">
                <Bell size={19} />
                {unreadCount > 0 && <span className="absolute end-1.5 top-1.5 grid h-4 w-4 place-items-center rounded-full bg-ocean-500 text-[9px] font-extrabold text-white">{formatPortalNumber(unreadCount)}</span>}
              </button>
              <div className="ms-1 flex items-center gap-2.5 rounded-full border border-slate-200 bg-white py-1 ps-1 pe-3">
                <img src={fileUrl(user?.avatar) || avatar(38)} alt={user?.name ?? ''} className="h-8 w-8 rounded-full object-cover" />
                <span className="hidden text-left md:block">
                  <span className="block text-xs font-extrabold text-deep-900 leading-tight"><bdi dir="auto">{localizedField(user, 'name') || translatePortalText('Boat Provider')}</bdi></span>
                  <span className="block text-[10px] font-semibold text-slate-400"><bdi dir="auto">{localizedField(user?.business, 'businessName')}</bdi></span>
                </span>
              </div>
              <button title={translatePortalText("Sign out")} onClick={() => { logout(); nav('/login') }}
                className="grid h-10 w-10 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-deep-900"><LogOut size={17} /></button>
            </div>
          </div>
        </header>
        <BoatStatusBanner boat={boats[0] || null} completeness={boats[0]?.completeness} onRefresh={loadBoats} />
        <main className="px-4 py-6 md:px-7 md:py-7 max-w-[1600px]">
          {/* Enter-only CSS fade keyed by route. The old framer-motion
              AnimatePresence mode="wait" could finish the outgoing page's exit
              and never mount the next one, leaving a blank white page. */}
          <div key={loc.pathname} className="route-enter">
            {useOutlet()}
          </div>
        </main>
      </div>
      <NotifDrawer open={notif} onClose={() => setNotif(false)} notifs={notifs} loading={notifsLoading} onMarkAllRead={markAllRead} />
      <ToastStack />
      {/* Global async-UX hosts. `RouteProgressBar` is the top sliver for
          in-flight requests; `ConfirmHost` renders whatever `confirm()` /
          `confirmAndRun()` asked for, from anywhere in the tree. */}
      <RouteProgressBar />
      <ConfirmHost />
    </div>
  )
}
