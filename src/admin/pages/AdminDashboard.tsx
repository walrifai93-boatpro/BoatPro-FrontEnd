import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { Users, Sailboat, Anchor, Fuel, Wrench, Store, ListChecks, CalendarCheck2, DollarSign, Percent, Headset, ArrowRight, Activity, Check, X } from 'lucide-react'
import { USER_ROLES, money, avatar, AIMG, type UserRole } from '../adminData'
import { StatCard, Section, Img, Counter, toast } from '../../ui'
import { AProgress } from '../adminUi'
import { ChartTip } from './_shared'
import { adminPortalApi, adminApi, documentsApi, supportApi, type AdminProvider, type ApiKycDocument } from '../../api'
import { confirmAndRun } from '../../async'
import { errorMessage } from '../../async/errors'
import { BASE_CURRENCY } from '../../currency'
import { formatMoney } from '../../live'
import { isPortalArabic, localizedField, translatePortalText  , formatPortalDate, formatPortalNumber} from '../../i18n/runtime'

const PANEL_PATH: Record<string, string> = { boat_provider: 'boat', marina_provider: 'marina', fuel_provider: 'fuel', maintenance_provider: 'maintenance' }
const ROLE_ICON: Record<string, string> = { boat_provider: '⛵', marina_provider: '⚓', fuel_provider: '⛽', maintenance_provider: '🔧' }
const ROLE_LABEL: Record<string, string> = { boat_provider: 'boat', marina_provider: 'marina', fuel_provider: 'fuel', maintenance_provider: 'maintenance' }
const SERVICE_LINE_META: Record<string, { name: string; icon: string; color: string }> = {
  boat: { name: 'Boat rentals', icon: '⛵', color: '#0e7c86' },
  marina: { name: 'Marina berths', icon: '⚓', color: '#2f6fed' },
  // Was "Fuel delivery": fuel is sold at the station only — boats come to the
  // fuel dock, nothing is delivered to a berth.
  fuel: { name: 'Fuel', icon: '⛽', color: '#e08a2c' },
  maintenance: { name: 'Maintenance', icon: '🔧', color: '#8b5cf6' },
}

function formatDocType(docType: string): string {
  return docType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function seededAvatar(seed: string) {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return avatar((h % 70) + 1)
}

export default function AdminDashboard() {
  const [data, setData] = useState<{ totals?: any; recent?: any; registrations?: any; revenueMonths?: any; serviceLines?: any[]; bookingsByHour?: { h: number; count: number }[] }>({})
  const [pendingProviders, setPendingProviders] = useState<AdminProvider[]>([])
  const [pendingDocs, setPendingDocs] = useState<ApiKycDocument[]>([])
  /** Approved, active providers — the sidebar's figure. `roleCounts` counts every account, pending or rejected too. */
  const [liveProviders, setLiveProviders] = useState<number | null>(null)
  const [topProviders, setTopProviders] = useState<{ commission: number; gross: number; count: number; provider?: { name?: string; business?: { businessName?: string } } }[]>([])
  /** Every pending document, not just the two shown — the queue's real size. */
  const [pendingDocsTotal, setPendingDocsTotal] = useState(0)
  /** Open threads on the platform support desk (`/chats/support/queue` stats). */
  const [openTickets, setOpenTickets] = useState<number | null>(null)
  /** Vendor directory size. Vendors are their own collection, not a user role. */
  const [vendorsTotal, setVendorsTotal] = useState<number | null>(null)
  /** The message when `/admin-portal/dashboard` failed; `null` otherwise. */
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  /** Rows with an approve/reject in flight, so a double click cannot send twice. */
  const [busy, setBusy] = useState<Record<string, boolean>>({})

  const load = () => {
    setLoadError(null)
    // Every tile below reads 0 until this answers, so a failure has to be said
    // out loud — a toast that fades left a dashboard of zeros that looked real.
    adminPortalApi.dashboard()
      .then(res => { setData(res.data || {}); setLoaded(true) })
      .catch(err => setLoadError(errorMessage(err)))
    adminApi.listProviders({ status: 'pending' }).then(res => setPendingProviders(res.data.providers.slice(0, 3))).catch(() => {})
    documentsApi.pending({ limit: 2 }).then(res => { setPendingDocs(res.data.items); setPendingDocsTotal(res.data.pagination?.total ?? res.data.items.length) }).catch(() => {})
    adminApi.platformEarnings().then(res => setTopProviders(res.data.byProvider.slice(0, 5))).catch(() => {})
    adminPortalApi.platformPulse().then(res => setLiveProviders(res.data.activeProviders)).catch(() => {})
    supportApi.queue({ limit: 1 }).then(res => setOpenTickets(res.data.stats?.open ?? 0)).catch(() => setOpenTickets(null))
    adminPortalApi.vendors({ limit: 1 }).then(res => setVendorsTotal(res.data.pagination?.total ?? 0)).catch(() => setVendorsTotal(null))
  }
  useEffect(load, [])

  const t = data.totals || {}
  const P = {
    users: t.users ?? 0,
    boatProviders: t.roleCounts?.['boat_provider'] ?? 0,
    marinaProviders: t.roleCounts?.['marina_provider'] ?? 0,
    fuelProviders: t.roleCounts?.['fuel_provider'] ?? 0,
    maintProviders: t.roleCounts?.['maintenance_provider'] ?? 0,
    // Was `roleCounts.vendor` — there is no `vendor` role (USER_ROLES), so the
    // tile read 0 on every install. Vendors live in their own collection.
    vendors: vendorsTotal ?? 0,
    boats: t.boats ?? 0,
    marinas: t.marinas ?? 0,
    bookings: t.bookings ?? 0,
    revenue: t.payments?.gross ?? 0,
    commission: t.payments?.commission ?? 0,
    activeUsers: t.activeUsers ?? 0,
    // Providers awaiting review plus documents awaiting review: the hero and the
    // queue's subtitle both say "approvals", and the queue lists both kinds.
    pendingProviders: t.pendingProviders ?? 0,
    pendingApprovals: (t.pendingProviders ?? 0) + pendingDocsTotal,
    // Was `totals.openTickets`, a field the dashboard endpoint never returned —
    // the tile read 0 however many threads were waiting.
    openTickets: openTickets ?? 0,
  }

  const roleLabels: Record<string, string> = {
    customer: 'Customer', boat_owner: 'Boat Owner', boat_provider: 'Boat Provider', marina_provider: 'Marina Provider',
    fuel_provider: 'Fuel Provider', maintenance_provider: 'Maintenance Provider', admin: 'Admin',
    // Roles the API has (USER_ROLES) that printed as raw keys — "fuel_worker".
    fuel_worker: 'Fuel Worker', maintenance_worker: 'Maintenance Worker', marina_worker: 'Marina Staff', boat_crew: 'Boat Crew', support_agent: 'Support Agent',
  }
  const realRoles = t.roleCounts ? Object.entries(t.roleCounts).map(([k, v]) => ({
    role: roleLabels[k] || k,
    count: v as number,
    icon: USER_ROLES.find(ur => ur.role === (roleLabels[k] as UserRole))?.icon || '🧑‍💻',
  })).sort((a, b) => b.count - a.count) : []
  /** Bars are a share of the largest role. Was `count / 420`, a fixed scale that filled the bar at 42,000 accounts. */
  const roleMax = Math.max(1, ...realRoles.map(r => r.count))

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map(translatePortalText)

  /** Reads the actual hour, in the operator's own timezone. */
  const greeting = () => {
    const h = new Date().getHours()
    if (h < 12) return translatePortalText('Good morning')
    if (h < 18) return translatePortalText('Good afternoon')
    return translatePortalText('Good evening')
  }
  // All twelve trailing months, a month with no earned payments drawn at 0. The
  // API only returns months that had some, so a quiet month used to vanish and
  // the line joined its neighbours straight across it.
  const realRevenue = (() => {
    if (!data.revenueMonths) return []
    const byKey = new Map<string, { gross: number; commission: number }>(
      data.revenueMonths.map((m: any) => [`${m._id.y}-${m._id.m}`, { gross: m.gross || 0, commission: m.commission || 0 }])
    )
    const now = new Date()
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1)
      const row = byKey.get(`${d.getFullYear()}-${d.getMonth() + 1}`)
      return { m: monthNames[d.getMonth()], gross: row?.gross ?? 0, commission: row?.commission ?? 0 }
    })
  })()

  // "Platform growth" mini chart: total new users per month, summed across roles,
  // from the same registrations aggregate the backend already computes.
  const growth = (() => {
    if (!data.registrations?.length) return []
    const byMonth: Record<string, number> = {}
    for (const r of data.registrations) {
      const key = `${r._id.y}-${r._id.m}`
      byMonth[key] = (byMonth[key] || 0) + r.count
    }
    return Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, users]) => ({ m: monthNames[Number(key.split('-')[1]) - 1], users }))
  })()

  const bookingsByHour = (data.bookingsByHour || []).map(b => ({ h: `${formatPortalNumber(b.h, { minimumIntegerDigits: 2 })}:${formatPortalNumber(0, { minimumIntegerDigits: 2 })}`, n: b.count }))

  const serviceLines = (data.serviceLines || []).map(s => ({ ...s, ...SERVICE_LINE_META[s.key] }))

  // Approving also approves every document they still have pending, and a
  // subscription provider who has not paid is only moved to "awaiting payment",
  // not made live — so it asks first, and the toast reports what the server
  // actually did instead of announcing "now live" either way.
  const approveProvider = (p: AdminProvider) =>
    confirmAndRun({
      title: `Approve ${p.name}?`,
      body: 'Their pending documents are approved with them. A subscription provider who has not paid yet goes to awaiting payment rather than live.',
      confirmLabel: 'Approve',
      busyLabel: 'Approving…',
      run: async () => {
        // The row's status, so a provider another admin acted on meanwhile is a 409, not a silent overwrite.
        const res = await adminApi.approve(p._id, { expectedStatus: (p as any).onboarding?.status ?? 'pending' })
        setPendingProviders(prev => prev.filter(x => x._id !== p._id))
        return (res.data?.user as any)?.onboarding?.status as string | undefined
      },
      success: (status) => status === 'pending_subscription_payment'
        ? `${p.name} approved — waiting for their subscription payment`
        : `${p.name} approved — now live`,
    })
  // The reason is required and is shown to the provider, so it is collected in a
  // validated dialog rather than a `window.prompt` that could not enforce it
  // (and that froze the page while open).
  const rejectProvider = (p: AdminProvider) =>
    confirmAndRun({
      title: `Reject ${p.name}?`,
      body: 'They stay unapproved and are told why, so they can correct and resubmit.',
      input: { label: 'Reason for rejection', placeholder: 'Shown to the provider', required: true, multiline: true, maxLength: 400 },
      confirmLabel: 'Reject',
      busyLabel: 'Rejecting...',
      danger: true,
      run: async (reason) => {
        await adminApi.reject(p._id, reason, (p as any).onboarding?.status ?? 'pending')
        setPendingProviders(prev => prev.filter(x => x._id !== p._id))
      },
      success: `${p.name} rejected`,
      // The server's own message — a fixed "please try again" hid why it failed.
    })
  const approveDoc = (d: ApiKycDocument) => {
    if (busy[d._id]) return
    setBusy(b => ({ ...b, [d._id]: true }))
    documentsApi.verify(d._id, { status: 'approved' })
      .then(() => {
        toast(translatePortalText(`${formatDocType(d.docType)} approved`))
        setPendingDocs(prev => prev.filter(x => x._id !== d._id))
        setPendingDocsTotal(n => Math.max(0, n - 1))
      })
      .catch(err => {
        // "Document has already been reviewed" — someone else got there first,
        // so the row is stale: say so and drop it rather than leave it clickable.
        const msg = errorMessage(err)
        toast(translatePortalText(msg), 'warn')
        if (/already been reviewed/i.test(msg)) setPendingDocs(prev => prev.filter(x => x._id !== d._id))
      })
      .finally(() => setBusy(b => ({ ...b, [d._id]: false })))
  }
  const rejectDoc = (d: ApiKycDocument) =>
    confirmAndRun({
      title: `Reject ${formatDocType(d.docType)}?`,
      body: 'The holder is told why and can upload a replacement.',
      input: { label: 'Reason for rejection', placeholder: 'Shown to the document holder', required: true, multiline: true, maxLength: 400 },
      confirmLabel: 'Reject',
      busyLabel: 'Rejecting...',
      danger: true,
      run: async (reason) => {
        await documentsApi.verify(d._id, { status: 'rejected', rejectionReason: reason })
        setPendingDocs(prev => prev.filter(x => x._id !== d._id))
        setPendingDocsTotal(n => Math.max(0, n - 1))
      },
      success: `${formatDocType(d.docType)} rejected`,
    })

  const pendingItems = [
    ...pendingProviders.map(p => ({
      key: p._id,
      icon: ROLE_ICON[p.role] || '🧑‍💼',
      title: localizedField<string>(p.business, 'businessName') || localizedField<string>(p, 'name') || translatePortalText('Unknown provider'),
      meta: isPortalArabic()
        ? `${translatePortalText(`New ${ROLE_LABEL[p.role] || p.role} provider`)} · ${translatePortalText('Since')} ${formatPortalDate(new Date(p.createdAt))}`
        : `New ${ROLE_LABEL[p.role] || p.role} provider · since ${formatPortalDate(new Date(p.createdAt))}`,
      to: `/admin/${PANEL_PATH[p.role] || 'boat'}/providers`,
      onApprove: () => approveProvider(p),
      onReject: () => rejectProvider(p),
      // Both go through a dialog that holds its buttons while the call runs.
      busy: false,
    })),
    ...pendingDocs.map(d => ({
      key: d._id,
      icon: '📄',
      // `owner` populates to null when the account was deleted, and
      // `typeof null === 'object'` — `d.owner.name` threw and blanked the page.
      title: (d.owner && typeof d.owner === 'object' ? d.owner.name : '') || translatePortalText('Unknown'),
      meta: `${formatDocType(d.docType)} verification`,
      to: '/admin/kyc',
      onApprove: () => approveDoc(d),
      onReject: () => rejectDoc(d),
      busy: !!busy[d._id],
    })),
  ]

  return (
    <div className="space-y-6">
      {/* ── Hero ── */}
      <motion.div initial={{ opacity: 0, scale: 0.985 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5 }}
        className="relative overflow-hidden rounded-3xl bg-admin-gradient text-white shadow-lift">
        <video src="videos/promo.mp4" autoPlay loop muted playsInline className="absolute inset-0 h-full w-full object-cover opacity-30" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#041410]/85 via-[#041410]/55 to-transparent" />
        <div className="relative z-10 flex flex-wrap items-end justify-between gap-6 p-7 md:p-10">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.25em] text-emerald-300">
              {formatPortalDate(new Date(), { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} · {translatePortalText('BoatPro Platform HQ')}
            </p>
            {/* Was "Good morning" at every hour, so it was wrong for most of
                the working day — and an operator on the evening shift was being
                greeted by a page that had not looked at the clock. */}
            <h1 className="mt-2 font-display text-3xl md:text-4xl font-extrabold">{greeting()} 👋</h1>
            <p className="mt-2 max-w-xl text-sm text-white/70">
              {loaded ? formatPortalNumber(P.pendingApprovals) : '…'} {translatePortalText('approvals waiting')}
              {' '}{translatePortalText('and')}{' '}
              {liveProviders === null ? '…' : formatPortalNumber(liveProviders)} {translatePortalText('providers live on the platform.')}
            </p>
            <div className="mt-5 flex flex-wrap gap-2.5">
              <Link to="/admin/kyc" className="btn-admin">{translatePortalText('Review')} {loaded ? formatPortalNumber(P.pendingApprovals) : ''} {translatePortalText('approvals')} <ArrowRight size={15} /></Link>
              <Link to="/admin/reports" className="btn-ghost !bg-white/10 !border-white/20 !text-white hover:!bg-white/20">{translatePortalText('View analytics')}</Link>
            </div>
          </div>
          <div className="flex gap-4">
            {/* `c` is the currency the figure is denominated in — revenue is
                riyals and gets converted; counts have no currency. */}
            {[{ n: P.activeUsers, l: 'Active users' }, { n: P.bookings, l: 'Total bookings' }, { n: P.revenue, l: 'Gross revenue', c: BASE_CURRENCY }].map((s, i) => (
              <motion.div key={s.l} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 + i * 0.1 }}
                className="rounded-2xl bg-white/10 px-5 py-4 text-center backdrop-blur border border-white/15">
                <p className="font-display text-3xl font-extrabold"><Counter value={s.n} currency={s.c} /></p>
                <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-white/60">{translatePortalText(s.l)}</p>
              </motion.div>
            ))}
          </div>
        </div>
        <svg className="absolute bottom-0 start-0 h-10 w-[200%] animate-wave text-white/10" viewBox="0 0 1200 40" preserveAspectRatio="none">
          <path d="M0 25 Q150 5 300 25 T600 25 T900 25 T1200 25 V40 H0 Z" fill="currentColor" />
        </svg>
      </motion.div>

      {/* Without this the tiles below sat at 0 after a failed load, which reads
          as an empty platform rather than an unanswered request. */}
      {loadError && (
        <div className="card flex flex-wrap items-center justify-between gap-3 !border-rose-200 !bg-rose-50 p-4 text-sm text-rose-600">
          <p>{translatePortalText('Could not load dashboard stats')}: {loadError}</p>
          <button className="btn-ghost !py-1.5 !px-3 text-xs" onClick={load}>{translatePortalText('Retry')}</button>
        </div>
      )}

      {/* ── KPI grid — one card per provider vertical + platform totals ── */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard i={0} label={translatePortalText('Total users')} value={P.users} icon={<Users size={18} />} tone="green" to="/admin/users" />
        <StatCard i={1} label={translatePortalText('Boat providers')} value={P.boatProviders} icon={<Sailboat size={18} />} tone="ocean" to="/admin/boat/providers" />
        <StatCard i={2} label={translatePortalText('Marina providers')} value={P.marinaProviders} icon={<Anchor size={18} />} tone="navy" to="/admin/marina/providers" />
        <StatCard i={3} label={translatePortalText('Fuel providers')} value={P.fuelProviders} icon={<Fuel size={18} />} tone="amber" to="/admin/fuel/providers" />
        <StatCard i={4} label={translatePortalText('Maintenance providers')} value={P.maintProviders} icon={<Wrench size={18} />} tone="violet" to="/admin/maintenance/providers" />
        {/* No link: the vendor directory (AdminProviders → Vendors tab) has no
            route, and this pointed at the boat provider directory, which has no
            vendors in it. */}
        <StatCard i={5} label={translatePortalText('Vendors')} value={P.vendors} icon={<Store size={18} />} tone="rose" />
        <StatCard i={6} label={translatePortalText('Boats listed')} value={P.boats} icon={<ListChecks size={18} />} tone="ocean" to="/admin/boat/listings" />
        <StatCard i={7} label={translatePortalText('Bookings')} value={P.bookings} icon={<CalendarCheck2 size={18} />} tone="violet" to="/admin/reports" />
        {/* `currency`, not `prefix="SAR "`: the hero converts the same gross
            figure into the operator's display currency, and these two stayed
            in riyals beside it with no conversion. */}
        <StatCard i={8} label={translatePortalText('Gross revenue')} value={P.revenue} currency={BASE_CURRENCY} icon={<DollarSign size={18} />} tone="green" to="/admin/payments" />
        <StatCard i={9} label={translatePortalText('Commission')} value={P.commission} currency={BASE_CURRENCY} icon={<Percent size={18} />} tone="amber" to="/admin/payments" />
        <StatCard i={10} label={translatePortalText('Active users')} value={P.activeUsers} icon={<Activity size={18} />} tone="green" to="/admin/users" />
        {/* Linked to Reviews, which holds no tickets; the support desk does. */}
        <StatCard i={11} label={translatePortalText('Open tickets')} value={P.openTickets} icon={<Headset size={18} />} tone="rose" to="/admin/support" />
      </div>

      {/* ── Revenue + live activity ── */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Section title={translatePortalText('Platform revenue')} sub={translatePortalText('Gross volume vs platform commission — trailing 12 months')} className="lg:col-span-2"
          actions={<Link to="/admin/reports" className="btn-ghost !py-1.5 !px-3 text-xs">{translatePortalText('Full report')}</Link>}>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={realRevenue} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="agross" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity={0.32} /><stop offset="100%" stopColor="#10b981" stopOpacity={0.02} /></linearGradient>
                <linearGradient id="acomm" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#14b8a6" stopOpacity={0.3} /><stop offset="100%" stopColor="#14b8a6" stopOpacity={0.02} /></linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
              <XAxis dataKey="m" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={v => formatMoney(v, BASE_CURRENCY, { compact: true })} />
              <Tooltip content={<ChartTip />} />
              <Area type="monotone" dataKey="gross" name={translatePortalText('Gross volume')} stroke="#10b981" strokeWidth={2.5} fill="url(#agross)" />
              <Area type="monotone" dataKey="commission" name={translatePortalText('Commission')} stroke="#14b8a6" strokeWidth={2.5} fill="url(#acomm)" />
            </AreaChart>
          </ResponsiveContainer>
        </Section>

        <Section title={translatePortalText('Pending approvals')} sub={`${formatPortalNumber(P.pendingApprovals)} ${translatePortalText('providers & documents awaiting review')} (${formatPortalNumber(P.pendingProviders)} + ${formatPortalNumber(pendingDocsTotal)})`}
          actions={<Link to="/admin/kyc" className="btn-ghost !py-1.5 !px-3 text-xs">{translatePortalText('View all')}</Link>}>
          <div className="space-y-2">
            {pendingItems.map((item, i) => (
              <motion.div key={item.key} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.07 }}
                className="flex items-center gap-2.5 rounded-xl border border-slate-100 p-2.5 text-xs hover:bg-sand transition">
                <span className="text-base">{item.icon}</span>
                <Link to={item.to} className="min-w-0 flex-1 hover:underline">
                  <p className="truncate font-bold text-deep-900">{item.title}</p>
                  <p className="truncate text-[10px] text-slate-400">{item.meta}</p>
                </Link>
                <button onClick={item.onApprove} disabled={item.busy} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 disabled:opacity-50" title={translatePortalText('Approve')}><Check size={13} /></button>
                <button onClick={item.onReject} disabled={item.busy} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-rose-50 text-rose-500 hover:bg-rose-100 disabled:opacity-50" title={translatePortalText('Reject')}><X size={13} /></button>
              </motion.div>
            ))}
            {pendingItems.length === 0 && (
              <div className="py-8 text-center text-xs text-slate-400">{translatePortalText('Nothing waiting on review.')}</div>
            )}
          </div>
        </Section>
      </div>

      {/* ── Service lines + user roles ── */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Section title={translatePortalText('Service lines')} sub={translatePortalText('Listings, bookings & revenue by vertical')} className="lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {serviceLines.map((s, i) => (
              <motion.div key={s.key} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                className="card card-hover p-4">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-10 w-10 place-items-center rounded-xl text-lg" style={{ background: `${s.color}1a` }}>{s.icon}</span>
                  <div><p className="text-[13px] font-extrabold text-deep-900">{translatePortalText(s.name)}</p><p className="text-[10px] text-slate-400">{formatPortalNumber(s.listings)} {translatePortalText('listings')}</p></div>
                </div>
                <div className="mt-3 flex items-end justify-between">
                  <div><p className="text-[10px] font-bold uppercase text-slate-400">{translatePortalText('Bookings')}</p><p className="font-display text-lg font-extrabold text-deep-900">{formatPortalNumber(s.bookings)}</p></div>
                  <div className="text-right"><p className="text-[10px] font-bold uppercase text-slate-400">{translatePortalText('Revenue')}</p><p className="font-display text-lg font-extrabold" style={{ color: s.color }}>{money(s.revenue)}</p></div>
                </div>
              </motion.div>
            ))}
            {/* Said "Loading…" forever when the request had failed. */}
            {serviceLines.length === 0 && (
              <div className="col-span-full py-8 text-center text-xs text-slate-400">
                {loadError ? translatePortalText('Could not load dashboard stats') : translatePortalText('Loading service lines…')}
              </div>
            )}
          </div>
        </Section>

        <Section title={translatePortalText('Users by role')} sub={translatePortalText('Platform population')}
          actions={<Link to="/admin/users" className="btn-ghost !py-1.5 !px-3 text-xs">{translatePortalText('Manage')}</Link>}>
          <div className="space-y-2">
            {realRoles.slice(0, 7).map((r, i) => (
              <motion.div key={r.role} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                className="flex items-center gap-2.5 text-xs">
                <span>{r.icon}</span>
                <span className="w-36 truncate font-semibold text-deep-800">{translatePortalText(r.role)}</span>
                <AProgress pct={Math.round(r.count / roleMax * 100)} />
                <b className="w-14 shrink-0 text-right text-slate-500">{formatPortalNumber(r.count)}</b>
              </motion.div>
            ))}
          </div>
        </Section>
      </div>

      {/* ── Growth & demand + notifications ── */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Section title={translatePortalText('Growth & demand')} sub={translatePortalText('Platform growth and peak booking hours')} className="lg:col-span-2"
          actions={<Link to="/admin/reports" className="btn-ghost !py-1.5 !px-3 text-xs"><Activity size={13} /> {translatePortalText('Full report')}</Link>}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">{translatePortalText('New user registrations')}</p>
              <ResponsiveContainer width="100%" height={190}>
                <AreaChart data={growth} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                  <defs><linearGradient id="dashGrowth" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity={0.3} /><stop offset="100%" stopColor="#10b981" stopOpacity={0.02} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                  <XAxis dataKey="m" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={value => formatPortalNumber(value)} />
                  <Tooltip content={<ChartTip />} />
                  <Area type="monotone" dataKey="users" name={translatePortalText('Users')} stroke="#10b981" strokeWidth={2.5} fill="url(#dashGrowth)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">{translatePortalText('Peak booking hours')}</p>
              <ResponsiveContainer width="100%" height={190}>
                <BarChart data={bookingsByHour} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                  <XAxis dataKey="h" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval={2} />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={value => formatPortalNumber(value)} />
                  <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(16,185,129,0.06)' }} />
                  <Bar dataKey="n" name={translatePortalText('Bookings')} radius={[5, 5, 0, 0]} fill="#10b981" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Section>

        <Section title={translatePortalText('Top providers')} sub={translatePortalText('Highest platform commission — every vertical')}
          actions={<Link to="/admin/reports" className="btn-ghost !py-1.5 !px-3 text-xs">{translatePortalText('Full report')}</Link>}>
          <div className="space-y-2.5">
            {(() => {
              // The list is ranked by commission (`/payments/platform-earnings`
              // sorts on it), so the bar measures commission too — scaled on
              // gross, the bars could shrink and grow down a sorted list.
              const max = Math.max(1, ...topProviders.map(p => p.commission))
              return topProviders.map((p, i) => {
                const name = localizedField<string>(p.provider?.business, 'businessName') || localizedField<string>(p.provider, 'name') || translatePortalText('Unknown provider')
                return (
                  <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                    className="group flex items-center gap-2.5 rounded-xl p-1.5 text-xs">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-sand font-display text-[10px] font-extrabold text-slate-400">{formatPortalNumber(i + 1)}</span>
                    <img src={seededAvatar(name)} className="h-7 w-7 shrink-0 rounded-full object-cover" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold text-deep-900">{name}</p>
                      <AProgress pct={Math.round(p.commission / max * 100)} />
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-display text-[13px] font-extrabold text-deep-900">{money(p.gross)}</p>
                      <p className="text-[10px] font-bold text-emerald-600">{money(p.commission)} {translatePortalText('comm.')}</p>
                    </div>
                  </motion.div>
                )
              })
            })()}
            {topProviders.length === 0 && (
              <div className="py-8 text-center text-xs text-slate-400">{translatePortalText('No provider revenue yet.')}</div>
            )}
          </div>
        </Section>
      </div>
    </div>
  )
}
