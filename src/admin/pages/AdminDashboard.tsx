import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { Users, Sailboat, Anchor, Fuel, Wrench, Store, ListChecks, CalendarCheck2, DollarSign, Percent, Headset, ArrowRight, Activity, Check, X } from 'lucide-react'
import { USER_ROLES, money, avatar, AIMG, type UserRole } from '../adminData'
import { StatCard, Section, Img, Counter, toast } from '../../ui'
import { AProgress } from '../adminUi'
import { ChartTip } from './_shared'
import { adminPortalApi, adminApi, documentsApi, type AdminProvider, type ApiKycDocument } from '../../api'
import { confirmAndRun } from '../../async'
import { BASE_CURRENCY } from '../../currency'
import { formatMoney } from '../../live'
import { isPortalArabic, localizedField, translatePortalText  , formatPortalDate, formatPortalNumber} from '../../i18n/runtime'

const PANEL_PATH: Record<string, string> = { boat_provider: 'boat', marina_provider: 'marina', fuel_provider: 'fuel', maintenance_provider: 'maintenance' }
const ROLE_ICON: Record<string, string> = { boat_provider: '⛵', marina_provider: '⚓', fuel_provider: '⛽', maintenance_provider: '🔧' }
const ROLE_LABEL: Record<string, string> = { boat_provider: 'boat', marina_provider: 'marina', fuel_provider: 'fuel', maintenance_provider: 'maintenance' }
const SERVICE_LINE_META: Record<string, { name: string; icon: string; color: string }> = {
  boat: { name: 'Boat rentals', icon: '⛵', color: '#0e7c86' },
  marina: { name: 'Marina berths', icon: '⚓', color: '#2f6fed' },
  fuel: { name: 'Fuel delivery', icon: '⛽', color: '#e08a2c' },
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

  useEffect(() => {
    adminPortalApi.dashboard().then(res => setData(res.data || {})).catch(() => toast(translatePortalText('Could not load dashboard stats'), 'warn'))
    adminApi.listProviders({ status: 'pending' }).then(res => setPendingProviders(res.data.providers.slice(0, 3))).catch(() => {})
    documentsApi.pending({ limit: 2 }).then(res => setPendingDocs(res.data.items)).catch(() => {})
    adminApi.platformEarnings().then(res => setTopProviders(res.data.byProvider.slice(0, 5))).catch(() => {})
    adminPortalApi.platformPulse().then(res => setLiveProviders(res.data.activeProviders)).catch(() => {})
  }, [])

  // Merge static UI data with real backend data
  const t = data.totals || {}
  const P = {
    users: t.users ?? 0,
    boatProviders: t.roleCounts?.['boat_provider'] ?? 0,
    marinaProviders: t.roleCounts?.['marina_provider'] ?? 0,
    fuelProviders: t.roleCounts?.['fuel_provider'] ?? 0,
    maintProviders: t.roleCounts?.['maintenance_provider'] ?? 0,
    vendors: t.roleCounts?.['vendor'] ?? 0,
    boats: t.boats ?? 0,
    marinas: t.marinas ?? 0,
    bookings: t.bookings ?? 0,
    revenue: t.payments?.gross ?? 0,
    commission: t.payments?.commission ?? 0,
    activeUsers: t.activeUsers ?? 0,
    pendingApprovals: t.pendingProviders ?? 0,
    openTickets: t.openTickets ?? 0,
  }

  const roleLabels: Record<string, UserRole> = { customer: 'Customer', boat_owner: 'Boat Owner', boat_provider: 'Boat Provider', marina_provider: 'Marina Provider', fuel_provider: 'Fuel Provider', maintenance_provider: 'Maintenance Provider', admin: 'Admin' }
  const realRoles = t.roleCounts ? Object.entries(t.roleCounts).map(([k, v]) => ({
    role: roleLabels[k] || k as UserRole,
    count: v as number,
    icon: USER_ROLES.find(ur => ur.role === roleLabels[k])?.icon || '🧑‍💻',
  })).sort((a, b) => b.count - a.count) : []

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map(translatePortalText)

  /** Reads the actual hour, in the operator's own timezone. */
  const greeting = () => {
    const h = new Date().getHours()
    if (h < 12) return translatePortalText('Good morning')
    if (h < 18) return translatePortalText('Good afternoon')
    return translatePortalText('Good evening')
  }
  const realRevenue = data.revenueMonths?.map((m: any) => ({
    m: monthNames[m._id.m - 1],
    gross: m.gross,
    commission: m.commission,
  })) || []

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

  const approveProvider = (p: AdminProvider) => {
    adminApi.approve(p._id)
      .then(() => { toast(translatePortalText(`${p.name} approved — now live`)); setPendingProviders(prev => prev.filter(x => x._id !== p._id)) })
      .catch(() => toast(translatePortalText('Could not approve this provider'), 'warn'))
  }
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
        await adminApi.reject(p._id, reason)
        setPendingProviders(prev => prev.filter(x => x._id !== p._id))
      },
      success: `${p.name} rejected`,
      error: 'Could not reject this provider. Please try again.',
    })
  const approveDoc = (d: ApiKycDocument) => {
    documentsApi.verify(d._id, { status: 'approved' })
      .then(() => { toast(translatePortalText(`${formatDocType(d.docType)} approved`)); setPendingDocs(prev => prev.filter(x => x._id !== d._id)) })
      .catch(() => toast(translatePortalText('Could not approve this document'), 'warn'))
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
      },
      success: `${formatDocType(d.docType)} rejected`,
      error: 'Could not reject this document. Please try again.',
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
    })),
    ...pendingDocs.map(d => ({
      key: d._id,
      icon: '📄',
      title: typeof d.owner === 'object' ? d.owner.name : 'Unknown',
      meta: `${formatDocType(d.docType)} verification`,
      to: '/admin/kyc',
      onApprove: () => approveDoc(d),
      onReject: () => rejectDoc(d),
    })),
  ]

  return (
    <div className="space-y-6">
      {/* ── Hero ── */}
      <motion.div initial={{ opacity: 0, scale: 0.985 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5 }}
        className="relative overflow-hidden rounded-3xl bg-admin-gradient text-white shadow-lift">
        <video src="/videos/promo.mp4" autoPlay loop muted playsInline className="absolute inset-0 h-full w-full object-cover opacity-30" />
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
              {P.pendingApprovals} {translatePortalText('approvals waiting')}
              {' '}{translatePortalText('and')}{' '}
              {liveProviders === null ? '…' : formatPortalNumber(liveProviders)} {translatePortalText('providers live on the platform.')}
            </p>
            <div className="mt-5 flex flex-wrap gap-2.5">
              <Link to="/admin/kyc" className="btn-admin">{translatePortalText('Review')} {P.pendingApprovals} {translatePortalText('approvals')} <ArrowRight size={15} /></Link>
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

      {/* ── KPI grid — one card per provider vertical + platform totals ── */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard i={0} label={translatePortalText('Total users')} value={P.users} icon={<Users size={18} />} tone="green" to="/admin/users" />
        <StatCard i={1} label={translatePortalText('Boat providers')} value={P.boatProviders} icon={<Sailboat size={18} />} tone="ocean" to="/admin/boat/providers" />
        <StatCard i={2} label={translatePortalText('Marina providers')} value={P.marinaProviders} icon={<Anchor size={18} />} tone="navy" to="/admin/marina/providers" />
        <StatCard i={3} label={translatePortalText('Fuel providers')} value={P.fuelProviders} icon={<Fuel size={18} />} tone="amber" to="/admin/fuel/providers" />
        <StatCard i={4} label={translatePortalText('Maintenance providers')} value={P.maintProviders} icon={<Wrench size={18} />} tone="violet" to="/admin/maintenance/providers" />
        <StatCard i={5} label={translatePortalText('Vendors')} value={P.vendors} icon={<Store size={18} />} tone="rose" to="/admin/boat/providers" />
        <StatCard i={6} label={translatePortalText('Boats listed')} value={P.boats} icon={<ListChecks size={18} />} tone="ocean" to="/admin/boat/listings" />
        <StatCard i={7} label={translatePortalText('Bookings')} value={P.bookings} icon={<CalendarCheck2 size={18} />} tone="violet" to="/admin/reports" />
        <StatCard i={8} label={translatePortalText('Gross revenue')} value={P.revenue} prefix="SAR " icon={<DollarSign size={18} />} tone="green" to="/admin/payments" />
        <StatCard i={9} label={translatePortalText('Commission')} value={P.commission} prefix="SAR " icon={<Percent size={18} />} tone="amber" to="/admin/payments" />
        <StatCard i={10} label={translatePortalText('Active users')} value={P.activeUsers} icon={<Activity size={18} />} tone="green" to="/admin/users" />
        <StatCard i={11} label={translatePortalText('Open tickets')} value={P.openTickets} icon={<Headset size={18} />} tone="rose" to="/admin/reviews" />
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

        <Section title={translatePortalText('Pending approvals')} sub={`${formatPortalNumber(P.pendingApprovals)} ${translatePortalText('providers & documents awaiting review')}`}
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
                <button onClick={item.onApprove} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100" title={translatePortalText('Approve')}><Check size={13} /></button>
                <button onClick={item.onReject} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-rose-50 text-rose-500 hover:bg-rose-100" title={translatePortalText('Reject')}><X size={13} /></button>
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
            {serviceLines.length === 0 && (
              <div className="col-span-full py-8 text-center text-xs text-slate-400">{translatePortalText('Loading service lines…')}</div>
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
                <AProgress pct={Math.min(100, Math.round(r.count / 420))} />
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
              const max = Math.max(1, ...topProviders.map(p => p.gross))
              return topProviders.map((p, i) => {
                const name = localizedField<string>(p.provider?.business, 'businessName') || localizedField<string>(p.provider, 'name') || translatePortalText('Unknown provider')
                return (
                  <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                    className="group flex items-center gap-2.5 rounded-xl p-1.5 text-xs">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-sand font-display text-[10px] font-extrabold text-slate-400">{formatPortalNumber(i + 1)}</span>
                    <img src={seededAvatar(name)} className="h-7 w-7 shrink-0 rounded-full object-cover" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold text-deep-900">{name}</p>
                      <AProgress pct={Math.round(p.gross / max * 100)} />
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
