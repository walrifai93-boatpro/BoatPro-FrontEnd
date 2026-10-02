import React from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend, PieChart, Pie, Cell } from 'recharts'
import { DollarSign, Anchor, Ship, LogOut, Hourglass, Wrench, ArrowRight, Wind, Droplets, Eye, Sun, Moon } from 'lucide-react'
import { StatCard, Badge, Section, Img, CoverPhoto, Counter, LoadingState, ErrorState, EmptyState } from '../ui'
import { boatPhoto } from '../images'
import {
  useAsync, useMarina, marinaCoverPhotos, formatMoney, berthLabel, fmtTime, fmtRelative, personOf,
  weatherText, windDir, RESERVATION_LABELS,
} from '../live'
import { useOps } from '../opsStore'
import { fileUrl, reservationsApi, monetizationApi } from '../api'
import { PackagePlanCard, type ProviderDashboardData } from '../shared/packageLimit'
import { formatPortalDate, formatPortalNumber, isPortalArabic, localizedEnum, localizedField, portalLocale, translatePortalText } from '../i18n/runtime'


const C = { s1: '#1b9bbf', s2: '#8b5cf6', s3: '#f59e0b', s4: '#10b981' }

const ChartTip = ({ active, payload, label, currency = 'SAR' }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-slate-100 bg-white/95 px-3 py-2 text-xs shadow-lift backdrop-blur">
      <p className="font-bold text-deep-900 mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} className="flex items-center gap-2 text-slate-500">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.fill }} />
          {translatePortalText(p.name)}: <b className="text-deep-900">{typeof p.value === 'number' && p.value > 500 ? formatMoney(p.value, currency) : formatPortalNumber(p.value)}</b>
        </p>
      ))}
    </div>
  )
}
export { ChartTip, C }

/** "Aug" from "2026-08" — the revenue axis. */
const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return ym
  return new Date(y, m - 1, 1).toLocaleDateString(portalLocale(), { month: 'short' })
}
/** "Mon" from "2026-07-13" — the weekly occupancy axis. */
const dayLabel = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`)
  return isNaN(d.getTime()) ? iso.slice(5) : d.toLocaleDateString(portalLocale(), { weekday: 'short' })
}

const greeting = () => {
  const h = new Date().getHours()
  return translatePortalText(h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening')
}

/** A signed percentage change, or undefined when there's nothing to compare to. */
const pctDelta = (current: number, previous: number): string | undefined => {
  if (!previous) return current ? '+100%' : undefined
  const change = ((current - previous) / previous) * 100
  if (!isFinite(change) || Math.abs(change) < 0.05) return undefined
  return `${change > 0 ? '+' : ''}${formatPortalNumber(change, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`
}
/** A signed count change, e.g. "+1" / "-2". */
const countDelta = (current: number, previous: number): string | undefined => {
  const d = current - previous
  return d === 0 ? undefined : `${d > 0 ? '+' : ''}${formatPortalNumber(d)}`
}

export default function Dashboard() {
  const { overview, weather, loading, error, reloadOverview } = useOps()
  const { marina, currency } = useMarina()
  const billing = useAsync(() => monetizationApi.providerDashboard().then((r) => r.data as unknown as ProviderDashboardData), [])

  if (loading && !overview) return <LoadingState label="Loading your marina…" rows={5} />
  if (error && !overview) return <ErrorState error={error} onRetry={reloadOverview} />
  if (!overview) return <EmptyState icon="⚓" text="No marina data yet" />

  const b = overview.berths
  const totalBerths = b.total ?? 0
  const occupied = b.booked ?? 0
  const available = b.available ?? 0
  const pending = overview.reservationStatusCounts.pending_approval ?? 0
  const duePayment = overview.reservationStatusCounts.pending_payment ?? 0
  const openArrivals = overview.arrivals.filter(m => m.status === 'expected' || m.status === 'en_route')
  const openDepartures = overview.departures.filter(m => m.status === 'expected' || m.status === 'en_route')
  const alerts = overview.workOrders.filter(w => w.priority === 'critical' || w.priority === 'high')
  const dashboardSummary = isPortalArabic()
    ? `القوارب المتوقعة وصولها اليوم: ${formatPortalNumber(openArrivals.length)}، والقوارب المتوقع مغادرتها: ${formatPortalNumber(openDepartures.length)}${pending > 0 ? `، طلبات الحجوزات المعلقة: ${formatPortalNumber(pending)}` : ''}${duePayment > 0 ? `، بانتظار الدفع: ${formatPortalNumber(duePayment)}` : ''}${alerts.length > 0 ? `، ويتطلب الانتباه: ${localizedField(alerts[0], 'title')}` : ''} — المرسى يعج بالحركة.`
    : `${openArrivals.length} ${openArrivals.length === 1 ? 'arrival' : 'arrivals'} and ${openDepartures.length} ${openDepartures.length === 1 ? 'departure' : 'departures'} today${pending > 0 ? `, ${pending} booking request${pending === 1 ? '' : 's'} waiting` : ''}${duePayment > 0 ? `, ${duePayment} awaiting payment` : ''}${alerts.length > 0 ? `, and ${alerts[0].title.toLowerCase()} is due` : ''} — the harbor is buzzing.`

  const t = overview.trends
  const last = <T,>(a: T[]) => a[a.length - 1]
  const prev = <T,>(a: T[]) => a[a.length - 2]
  const revenueSeries = overview.revenue.series.map(r => ({ ...r, m: monthLabel(r.month) }))
  // The last 7 days of the fortnight series is what the weekly bar chart shows.
  const week = t.days.slice(-7).map((d, i) => ({ d: dayLabel(d), occ: t.occupancyRate.slice(-7)[i] }))

  return (
    <div className="space-y-6">
      {/* ── Hero ── */}
      <motion.div initial={{ opacity: 0, scale: 0.985 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5 }}
        className="relative overflow-hidden rounded-3xl bg-hero-gradient text-white shadow-lift">
        <CoverPhoto srcs={marinaCoverPhotos(marina)} className="absolute inset-0 h-full w-full opacity-25" />
        <div className="absolute inset-0 bg-gradient-to-r from-deep-950/85 via-deep-950/55 to-transparent" />
        <div className="relative z-10 flex flex-wrap items-end justify-between gap-6 p-7 md:p-10">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.25em] text-ocean-300">
              {formatPortalDate(new Date(), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} · {localizedField(overview.marina, 'name')}
            </p>
            <h1 className="mt-2 font-display text-3xl md:text-4xl font-extrabold">{greeting()} 🌊</h1>
            <p className="mt-2 max-w-xl text-sm text-white/70">{dashboardSummary}</p>
            <div className="mt-5 flex flex-wrap gap-2.5">
              <Link to="/reservations" className="btn-primary">
                {translatePortalText(pending + duePayment > 0 ? `Review ${pending + duePayment} request${pending + duePayment === 1 ? '' : 's'}` : 'Open reservations')} <ArrowRight size={15} />
              </Link>
              <Link to="/live" className="btn-ghost !bg-white/10 !border-white/20 !text-white hover:!bg-white/20">{translatePortalText("Open live dock map")}</Link>
            </div>
          </div>
          <div className="flex gap-4">
            {[{ n: occupied, l: 'Docked now' }, { n: available, l: 'Berths free' }, { n: overview.occupancyRate, l: '% occupancy' }].map((s, i) => (
              <motion.div key={s.l} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 + i * 0.1 }}
                className="rounded-2xl bg-white/10 px-5 py-4 text-center backdrop-blur border border-white/15">
                <p className="font-display text-3xl font-extrabold"><Counter value={s.n} /></p>
                <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-white/60">{translatePortalText(s.l)}</p>
              </motion.div>
            ))}
          </div>
        </div>
        <svg className="absolute bottom-0 start-0 h-10 w-[200%] animate-wave text-white/10" viewBox="0 0 1200 40" preserveAspectRatio="none">
          <path d="M0 25 Q150 5 300 25 T600 25 T900 25 T1200 25 V40 H0 Z" fill="currentColor" />
        </svg>
      </motion.div>

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 ">
        <StatCard i={0} label={`${translatePortalText('Revenue · ')}${new Date().toLocaleDateString(portalLocale(), { month: 'long' })}`} value={overview.revenue.month.gross}
          prefix={`${currency} `} delta={pctDelta(last(t.revenue) ?? 0, prev(t.revenue) ?? 0)}
          icon={<DollarSign size={20} />} tone="navy" spark={t.revenue} to="/billing" />
        <StatCard i={1} label="Today's arrivals" value={overview.arrivals.length}
          delta={countDelta(last(t.arrivals) ?? 0, prev(t.arrivals) ?? 0)}
          icon={<Anchor size={20} />} tone="ocean" spark={t.arrivals} to="/movements" />
        <StatCard i={2} label="Today's departures" value={overview.departures.length}
          delta={countDelta(last(t.departures) ?? 0, prev(t.departures) ?? 0)}
          icon={<LogOut size={20} />} tone="violet" spark={t.departures} to="/movements" />
        <StatCard i={3} label="Occupied berths" value={occupied} suffix={` / ${totalBerths}`}
          delta={pctDelta(last(t.occupancyRate) ?? 0, t.occupancyRate[t.occupancyRate.length - 8] ?? 0)}
          icon={<Ship size={20} />} tone="green" spark={t.occupiedBerths} to="/berths" />
        <StatCard i={4} label="Pending requests" value={pending} icon={<Hourglass size={20} />} tone="amber" spark={t.requests} to="/reservations" />
        <StatCard i={5} label="Maintenance alerts" value={alerts.length} icon={<Wrench size={20} />} tone="rose" spark={t.workOrders} to="/maintenance" />
      </div>

      {/* ── Package usage & billing ── */}
      {billing.data && (
        <Section title={translatePortalText("Package Usage")} sub="Current usage against your active plan's limits — upgrade, downgrade or cancel here">
          <PackagePlanCard dashboard={billing.data} providerType="marina_provider" onChanged={billing.reload} />
        </Section>
      )}

      {/* ── Revenue + Weather ── */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Section title={translatePortalText("Revenue overview")} sub="Berthing, services & fuel — trailing 12 months" className="lg:col-span-2"
          actions={<Link to="/reports" className="btn-ghost !py-1.5 !px-3 text-xs">{translatePortalText("Full report")}</Link>}>
          <ResponsiveContainer width="100%" height={290}>
            <AreaChart data={revenueSeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                {[['g1', C.s1], ['g2', C.s2], ['g3', C.s3]].map(([id, c]) => (
                  <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={c} stopOpacity={0.28} /><stop offset="100%" stopColor={c} stopOpacity={0.02} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
              <XAxis dataKey="m" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={v => `${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`} />
              <Tooltip content={<ChartTip currency={currency} />} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="docking" name={translatePortalText('Berthing')} stroke={C.s1} strokeWidth={2} fill="url(#g1)" />
              <Area type="monotone" dataKey="services" name={translatePortalText('Services')} stroke={C.s2} strokeWidth={2} fill="url(#g2)" />
              <Area type="monotone" dataKey="fuel" name={translatePortalText('Fuel')} stroke={C.s3} strokeWidth={2} fill="url(#g3)" />
            </AreaChart>
          </ResponsiveContainer>
        </Section>

        <Section title={translatePortalText("Weather & tide")}
          sub={marina ? `${marina.city ?? marina.address} · ${formatPortalNumber(marina.latitude, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}, ${formatPortalNumber(marina.longitude, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}` : 'Live marine forecast'}>
          {weather ? (<>
            <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-ocean-600 to-ocean-400 p-4 text-white">
              {weather.isDay ? <Sun size={40} className="animate-float" /> : <Moon size={40} className="animate-float" />}
              <div>
                <p className="font-display text-3xl font-extrabold">{weather.temperature != null ? `${formatPortalNumber(Math.round(weather.temperature))}°C` : '—'}</p>
                <p className="text-xs text-white/80">{translatePortalText(weatherText(weather.weatherCode))}</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              {[
                { icon: <Wind size={14} />, l: 'Wind', v: weather.windSpeed != null ? `${formatPortalNumber(Math.round(weather.windSpeed))} kn ${windDir(weather.windDirection)}` : '—' },
                { icon: <Wind size={14} />, l: 'Gusts', v: weather.windGust != null ? `${formatPortalNumber(Math.round(weather.windGust))} kn` : '—' },
                { icon: <Droplets size={14} />, l: 'Humidity', v: weather.humidity != null ? `${formatPortalNumber(weather.humidity)}%` : '—' },
                { icon: <Eye size={14} />, l: 'Visibility', v: weather.visibilityKm != null ? `${formatPortalNumber(weather.visibilityKm)} km` : '—' },
              ].map(w => (
                <div key={w.l} className="flex items-center gap-2 rounded-xl bg-sand px-3 py-2.5">
                  <span className="text-ocean-500">{w.icon}</span>
                  <span className="text-slate-400 font-semibold">{translatePortalText(w.l)}</span>
                  <b className="ms-auto text-deep-900">{w.v}</b>
                </div>
              ))}
            </div>
            {weather.tides.length > 0 && (<>
              <p className="mt-3 mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText("Tide today (m)")}</p>
              <ResponsiveContainer width="100%" height={90}>
                <AreaChart data={weather.tides.map(x => ({ t: x.time, h: x.height }))} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                  <defs><linearGradient id="tide" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.s1} stopOpacity={0.35} /><stop offset="100%" stopColor={C.s1} stopOpacity={0.03} /></linearGradient></defs>
                  <XAxis dataKey="t" tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval={1} />
                  <Tooltip content={<ChartTip currency={currency} />} />
                    <Area type="monotone" dataKey="h" name={translatePortalText('Tide')} stroke={C.s1} strokeWidth={2} fill="url(#tide)" />
                </AreaChart>
              </ResponsiveContainer>
            </>)}
            {weather.warning && (
              <div className="mt-2 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-xs font-semibold text-amber-700">
                ⚠️ {translatePortalText(weather.warning)}
              </div>
            )}
          </>) : <LoadingState label="Fetching marine conditions…" rows={2} />}
        </Section>
      </div>

      {/* ── Arrivals / Departures ── */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title={translatePortalText("Today's arrivals")} sub="Expected vessels & ETAs" actions={<Link to="/movements" className="text-xs font-bold text-ocean-600 hover:underline">{translatePortalText("All →")}</Link>}>
          <div className="space-y-2.5">
            {overview.arrivals.length === 0 && <EmptyState icon="⚓" text="No arrivals scheduled for today" />}
            {overview.arrivals.map((a, i) => {
              const boater = personOf(a.boater)
              return (
                <motion.div key={a.id} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.08 }}
                  className="flex items-center gap-3 rounded-2xl border border-slate-100 p-3 transition hover:border-ocean-200 hover:shadow-soft">
                  <Img src={boatPhoto(a.boatName)} className="h-12 w-12 rounded-xl" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-deep-900">{a.boatName}</p>
                    <p className="truncate text-xs text-slate-400">{boater?.name ?? a.plate ?? '—'} {translatePortalText("· berth ")}{berthLabel(a.pontoon, a.slot)}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-display text-sm font-extrabold text-ocean-600">{fmtTime(a.scheduledAt)}</p>
                    <p className="text-[10px] font-semibold text-slate-400">
                      {a.status === 'en_route' && a.distanceNm != null ? translatePortalText(`En route · ${a.distanceNm} nm out`) : localizedEnum(a.status)}
                    </p>
                  </div>
                </motion.div>
              )
            })}
          </div>
        </Section>

        <Section title={translatePortalText("Today's departures")} sub="Checkout & berth release" actions={<Link to="/movements" className="text-xs font-bold text-ocean-600 hover:underline">{translatePortalText("All →")}</Link>}>
          <div className="space-y-2.5">
            {overview.departures.length === 0 && <EmptyState icon="🛫" text="No departures scheduled for today" />}
            {overview.departures.map((d, i) => {
              const boater = personOf(d.boater)
              return (
                <motion.div key={d.id} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.08 }}
                  className="flex items-center gap-3 rounded-2xl border border-slate-100 p-3 transition hover:border-violet-200 hover:shadow-soft">
                  <Img src={boatPhoto(d.boatName)} className="h-12 w-12 rounded-xl" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-deep-900">{d.boatName}</p>
                    <p className="truncate text-xs text-slate-400">{boater?.name ?? d.plate ?? '—'} {translatePortalText("· berth ")}{berthLabel(d.pontoon, d.slot)}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-display text-sm font-extrabold text-violet-600">{fmtTime(d.scheduledAt)}</p>
                    <p className="text-[10px] font-semibold text-slate-400">{localizedEnum(d.status)}</p>
                  </div>
                </motion.div>
              )
            })}
            {overview.departures.some(d => !d.documentsVerified || !d.securityCleared) && (
              <div className="rounded-2xl bg-sand p-3.5 text-xs text-slate-500">
                💡 <b>{translatePortalText("Tip:")}</b> {formatPortalNumber(overview.departures.filter(d => !d.securityCleared).length)} {translatePortalText("departure(s) still need security clearance before the berth can be released.\r\n              ")}</div>
            )}
          </div>
        </Section>
      </div>

      {/* ── Occupancy + bookings + notifications ── */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Section title={translatePortalText("Occupancy this week")} sub={`% of ${totalBerths} berths occupied per day`}>
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={week} margin={{ top: 8, right: 4, left: -18, bottom: 0 }} barSize={22}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
              <XAxis dataKey="d" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} unit="%" />
              <Tooltip content={<ChartTip currency={currency} />} cursor={{ fill: 'rgba(27,155,191,0.06)' }} />
              <Bar dataKey="occ" name={translatePortalText('Occupancy')} fill={C.s1} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Section>

        <Section title={translatePortalText("Upcoming reservations")} sub="Confirmed & pending requests" actions={<Link to="/reservations" className="text-xs font-bold text-ocean-600 hover:underline">{translatePortalText("Manage →")}</Link>}>
          <div className="space-y-2">
            {overview.pendingRequests.length === 0 && <EmptyState icon="✅" text="Nothing waiting on you" />}
            {overview.pendingRequests.slice(0, 5).map((r, i) => (
              <motion.div key={r.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                className="flex items-center gap-3 rounded-xl bg-sand px-3.5 py-2.5">
                <span className="text-lg">⛵</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-deep-900">{r.boatName} <span className="font-medium text-slate-400">· {r.reservationNo}</span></p>
                  <p className="text-xs text-slate-400">{formatPortalDate(r.startDate)} → {formatPortalDate(r.endDate)} · {berthLabel(r.pontoon, r.slot)}</p>
                </div>
                <Badge>{translatePortalText(RESERVATION_LABELS[r.status] ?? r.status)}</Badge>
              </motion.div>
            ))}
          </div>
        </Section>

        <Section title={translatePortalText("Latest notifications")} sub="What needs your attention" actions={<Link to="/notifications" className="text-xs font-bold text-ocean-600 hover:underline">{translatePortalText("All →")}</Link>}>
          <div className="space-y-2">
            {overview.alerts.length === 0 && <EmptyState icon="🔔" text="You're all caught up" />}
            {overview.alerts.slice(0, 5).map((n, i) => (
              <motion.div key={n.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                className="flex gap-3 rounded-xl px-1 py-1.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sand text-base">{NOTIF_ICON[n.type] ?? '🔔'}</span>
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-deep-800">{translatePortalText(n.body)}</p>
                  <p className="text-[11px] text-slate-400">{translatePortalText(n.title)} · {fmtRelative(n.createdAt)}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </Section>
      </div>

      {/* ── Berth mix + bookings ledger ── */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Section title={translatePortalText("Berth fleet mix")} sub={`${totalBerths} slips by live status`}>
          {(() => {
            const mix = [
              { name: 'Occupied', v: b.booked ?? 0 },
              { name: 'Available', v: b.available ?? 0 },
              { name: 'Reserved', v: b.reserved ?? 0 },
              { name: 'Maintenance', v: b.maintenance ?? 0 },
              { name: 'Blocked', v: b.blocked ?? 0 },
            ]
            const MIXC: Record<string, string> = { Occupied: '#1b9bbf', Available: '#10b981', Reserved: '#8b5cf6', Maintenance: '#f59e0b', Blocked: '#64748b' }
            if (!totalBerths) return <EmptyState icon="🅿️" text="No berths configured yet — add your pontoons on the Berth Management page." />
            return (
              <div className="flex flex-wrap items-center gap-4 md:gap-6">
                <div className="relative h-[170px] w-[170px] shrink-0 mx-auto md:mx-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={mix.filter(m => m.v > 0)} dataKey="v" nameKey="name" cx="50%" cy="50%" innerRadius={56} outerRadius={80} paddingAngle={3} strokeWidth={2} stroke="#fff">
                        {mix.filter(m => m.v > 0).map(m => <Cell key={m.name} fill={MIXC[m.name]} />)}
                      </Pie>
                      <Tooltip content={<ChartTip currency={currency} />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                    <div>
          <p className="font-display text-2xl font-extrabold text-deep-900">{formatPortalNumber(overview.occupancyRate)}%</p>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText("occupied")}</p>
                    </div>
                  </div>
                </div>
                <div className="flex-1 space-y-2">
                  {mix.map(m => (
                    <p key={m.name} className="flex items-center gap-2 text-xs font-semibold">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: MIXC[m.name] }} />
                      <span className="text-slate-500">{translatePortalText(m.name)}</span><b className="ms-auto text-deep-900">{formatPortalNumber(m.v)}</b>
                    </p>
                  ))}
                </div>
              </div>
            )
          })()}
        </Section>

        <Section title={translatePortalText("Booking ledger")} sub="Most recent reservations across all statuses" className="lg:col-span-2"
          actions={<Link to="/reservations" className="btn-ghost !py-1.5 !px-3 text-xs">{translatePortalText("Open reservations")}</Link>}>
          <BookingLedger currency={currency} />
        </Section>
      </div>
    </div>
  )
}

const NOTIF_ICON: Record<string, string> = {
  booking_request: '🆕', booking_confirmed: '✅', booking_cancelled: '🚫', booking_completed: '🏁',
  berth_arrival: '⚓', berth_departure: '🛫', payment_success: '💳', payment_refund: '↩️',
  work_order_assigned: '🔧', utility_billed: '⚡', incident_reported: '🚨', emergency_sos: '🛟',
  review_received: '⭐', documents_expiring: '📄', staff_assigned: '👷', general: '🔔',
}

/** A guest's picture, or a generated initials avatar when they have none. */
const avatarFor = (name?: string, avatar?: string) =>
  fileUrl(avatar) ?? `https://ui-avatars.com/api/?name=${encodeURIComponent(name ?? '?')}&background=e2e8f0&color=475569`

/** The six most recent reservations, whatever state they're in. */
function BookingLedger({ currency }: { currency: string }) {
  const state = useAsync(() => reservationsApi.list({ status: 'all', limit: 6 }).then(r => r.data), [])
  if (state.loading && !state.data) return <LoadingState label="Loading the ledger…" rows={3} />
  const rows = state.data?.items ?? []
  if (!rows.length) return <EmptyState icon="📋" text="No reservations yet" />
  return (
    <div className="overflow-x-auto custom-scrollbar">
      <table className="w-full min-w-[720px]">
        <thead><tr className="border-b border-slate-100">
          <th className="th">{translatePortalText("Booking")}</th><th className="th">{translatePortalText("Vessel")}</th><th className="th">{translatePortalText("Guest")}</th><th className="th">{translatePortalText("Dates")}</th><th className="th">{translatePortalText("Berth")}</th><th className="th text-right">{translatePortalText("Total")}</th><th className="th">{translatePortalText("Status")}</th>
        </tr></thead>
        <tbody>
          {rows.slice(0, 6).map((r, i) => {
            const who = personOf(r.subscriber)
            return (
              <motion.tr key={r.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.05 }}
                className="border-b border-slate-50 transition hover:bg-sand/70">
                <td className="td font-extrabold">{r.reservationNo}</td>
                <td className="td">{r.boatName}</td>
                <td className="td">
                  <span className="flex items-center gap-2">
                    <img src={avatarFor(who?.name, who?.avatar)} className="h-6 w-6 rounded-full object-cover" alt="" />
                    {who?.name ?? '—'}
                  </span>
                </td>
                <td className="td text-slate-400">{formatPortalDate(new Date(`${r.startDate}T12:00:00Z`), { month: 'short', day: 'numeric', timeZone: 'UTC' })} → {formatPortalDate(new Date(`${r.endDate}T12:00:00Z`), { month: 'short', day: 'numeric', timeZone: 'UTC' })}</td>
                <td className="td font-bold text-ocean-700">{berthLabel(r.pontoon, r.slot)}</td>
                <td className="td text-right font-display font-extrabold">{formatMoney(r.totalSar, currency)}</td>
                <td className="td"><Badge>{translatePortalText(RESERVATION_LABELS[r.status] ?? r.status)}</Badge></td>
              </motion.tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
