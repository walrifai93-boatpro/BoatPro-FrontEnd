import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell } from 'recharts'
import { Wrench, Hourglass, CalendarClock, Loader, PackageX, CheckCircle2, AlertTriangle, Clock4, ArrowRight, Star, DollarSign } from 'lucide-react'
import { MAINT_CATEGORIES, catByKey, compactMoney, shopCoverPhotos } from '../maintData'
import { StatCard, Section, CoverPhoto, Counter } from '../../ui'
import { maintToast, MBadge, HealthRing, JobProgress } from '../maintUi'
import { maintenancePortalApi, maintenanceShopApi, monetizationApi, type ApiMaintenanceShop, type MaintenanceOverview } from '../../api'
import { useAuth } from '../../auth'
import { PackagePlanCard, type ProviderDashboardData } from '../../shared/packageLimit'
import VendorLogoBadge from '../../components/VendorLogoBadge'
import { formatPortalDate, formatPortalNumber, formatPortalPercent, formatPortalTime, localizedField, translatePortalTemplate, translatePortalText } from '../../i18n/runtime'

const ChartTip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-slate-100 bg-white/95 px-3 py-2 text-xs shadow-lift backdrop-blur">
      <p className="font-bold text-deep-900 mb-1">{translatePortalText(label)}</p>
      {payload.map((p: any) => (
        <p key={p.name} className="flex items-center gap-2 text-slate-500">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.fill }} />
          {translatePortalText(p.name)}: <b className="text-deep-900">{typeof p.value === 'number' ? formatPortalNumber(p.value) : p.value}</b>
        </p>
      ))}
    </div>
  )
}

export default function MaintDashboard() {
  const nav = useNavigate()
  const { user } = useAuth()
  const [overview, setOverview] = useState<MaintenanceOverview | null>(null)
  const [shop, setShop] = useState<ApiMaintenanceShop | null>(null)
  const [billing, setBilling] = useState<ProviderDashboardData | null>(null)

  const loadBilling = () => monetizationApi.providerDashboard().then(result => setBilling(result.data as unknown as ProviderDashboardData)).catch(() => {})

  useEffect(() => {
    let mounted = true
    maintenancePortalApi.dashboard()
      .then(result => { if (mounted) setOverview(result.data) })
      .catch(error => { if (mounted) maintToast(error instanceof Error ? error.message : 'Could not load maintenance data', 'warn') })
    maintenanceShopApi.mine().then(result => { if (mounted) setShop(result.data.shop) }).catch(() => {})
    void loadBilling()
    return () => { mounted = false }
  }, [])

  const statusLabel = (status: string) => translatePortalText(status.replace(/[_-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()))
  const data = overview
  const pending = data?.requests.filter(request => request.status === 'pending') ?? []
  const orders = data?.workOrders ?? []
  const scheduled = orders.filter(order => order.status === 'scheduled')
  const inProgress = orders.filter(order => order.status === 'in_progress')
  const waitingParts = orders.filter(order => order.status === 'waiting_parts')
  const completed = data?.metrics.workOrderCounts.completed ?? 0
  const emergency = pending.find(request => request.priority === 'critical')
  const lowParts = data?.parts.filter(part => part.stock <= part.minimumStock) ?? []
  const technicians = data?.technicians ?? []
  const onDuty = technicians.filter(technician => technician.status === 'on_duty')
  const active = orders.filter(order => !['completed', 'delivered', 'cancelled'].includes(order.status))
  const todaySchedule = useMemo(() => orders.filter(order => order.scheduledFor).slice(0, 5), [orders])
  const jobsByCategory = useMemo(() => MAINT_CATEGORIES.map(category => ({ ...category, name: translatePortalText(category.name), value: active.filter(order => order.category === category.key).length })).filter(category => category.value > 0), [active])
  const notifications = useMemo(() => (data?.requests ?? []).slice(0, 5).map(request => ({
    id: request.id,
    text: `${request.boatName}: ${localizedField(request, 'title') ?? request.title}`,
    time: formatPortalDate(request.requestedAt, { dateStyle: 'short', timeStyle: 'short' }),
    icon: request.priority === 'critical' ? '🚨' : '🔧',
  })), [data?.requests])
  const currentRevenue = data?.metrics.revenue ?? 0
  const revenueTrend = [{ m: translatePortalText('Current'), labor: currentRevenue, parts: 0 }]

  return (
    <div className="space-y-6">
      {/* ── Hero ── */}
      <motion.div initial={{ opacity: 0, scale: 0.985 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5 }}
        className="relative overflow-hidden rounded-3xl bg-maint-gradient text-white shadow-lift">
        <CoverPhoto srcs={shopCoverPhotos(shop)} className="absolute inset-0 h-full w-full opacity-25" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0c0a1e]/85 via-[#0c0a1e]/55 to-transparent" />
        <div className="relative z-10 flex flex-wrap items-end justify-between gap-6 p-7 md:p-10">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.25em] text-violet-300">{formatPortalDate(new Date(), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} {translatePortalText("· Maintenance service dashboard")}</p>
            <h1 className="mt-2 font-display text-3xl md:text-4xl font-extrabold">{translatePortalText("Good morning,")} {user?.name || translatePortalText("there")} 🔧</h1>
            <p className="mt-2 max-w-xl text-sm text-white/70">
              {translatePortalTemplate('New requests: {{requests}} · Jobs in progress: {{inProgress}} · Open work orders: {{openOrders}}', {
                requests: pending.length,
                inProgress: inProgress.length,
                openOrders: active.length,
              })}
            </p>
            <div className="mt-5 flex flex-wrap gap-2.5">
              <Link to="/maint/requests" className="btn-maint">{translatePortalTemplate('Review requests ({{count}})', { count: pending.length })} <ArrowRight size={15} className="rtl:rotate-180" /></Link>
              <Link to="/maint/mobile" className="btn-ghost !bg-white/10 !border-white/20 !text-white hover:!bg-white/20">{translatePortalText("Open service map")}</Link>
            </div>
          </div>
          <div className="flex gap-4">
            {[{ n: active.length, l: 'Active jobs' }, { n: onDuty.length, l: 'Techs on duty' }, { n: currentRevenue, l: 'Revenue received', p: 'SAR' }].map((s, i) => (
              <motion.div key={s.l} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 + i * 0.1 }}
                className="rounded-2xl bg-white/10 px-5 py-4 text-center backdrop-blur border border-white/15">
                <p className="font-display text-3xl font-extrabold"><Counter value={s.n} currency={s.p} /></p>
                <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-white/60">{translatePortalText(s.l)}</p>
              </motion.div>
            ))}
          </div>
        </div>
        <svg className="absolute bottom-0 start-0 h-10 w-[200%] animate-wave text-white/10" viewBox="0 0 1200 40" preserveAspectRatio="none">
          <path d="M0 25 Q150 5 300 25 T600 25 T900 25 T1200 25 V40 H0 Z" fill="currentColor" />
        </svg>
      </motion.div>

      {/* ── Emergency banner ── */}
      {emergency && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="flex flex-wrap items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-3.5">
          <span className="animate-wrench text-2xl">🚨</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-extrabold text-rose-700">{translatePortalText("Emergency repair —")} {emergency.boatName} ({emergency.customer?.name || translatePortalText("Customer")})</p>
            <p className="text-xs text-rose-500">{localizedField(emergency, 'title') ?? emergency.title} · {emergency.location || translatePortalText("Location to be confirmed")} {translatePortalText("· requested")} {formatPortalDate(emergency.requestedAt, { dateStyle: 'short', timeStyle: 'short' })}</p>
          </div>
          <Link to="/maint/mobile" className="btn-primary !bg-gradient-to-r !from-rose-600 !to-rose-400 !shadow-none">{translatePortalText("Dispatch now")}</Link>
        </motion.div>
      )}

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <StatCard i={0} label="Revenue received" value={currentRevenue} currency="SAR" icon={<DollarSign size={18} />} tone="green" spark={[currentRevenue]} to="/maint/billing" />
      {/*
        No `spark` on the five cards below.

        They carried literal arrays — `[8, 9, 7, 10, 11, 9, 12, 11, 10, 12]`
        for active jobs, `[2, 3, 2, 4, 3, 5, 4, 5]` for pending requests and
        so on — drawn as a trend line beneath a real count. A workshop
        manager reads that as their own workload rising or falling; it was
        the same fixed shape on every account, every day.

        The fuel and marina dashboards feed `spark` from real series
        (`model.monthly`, `salesMonthly`, `t.revenue`). There is no
        equivalent here: the overview returns current work orders and
        per-status counts, not a history, so a truthful line cannot be
        derived. `spark` is optional and the card simply omits the graph.
      */}
        <StatCard i={1} label="Active jobs" value={active.length} icon={<Wrench size={18} />} tone="violet" to="/maint/workorders" />
        <StatCard i={2} label="Pending requests" value={pending.length} icon={<Hourglass size={18} />} tone="amber" to="/maint/requests" />
        <StatCard i={3} label="Scheduled" value={scheduled.length} icon={<CalendarClock size={18} />} tone="ocean" to="/maint/schedule" />
        <StatCard i={4} label="In progress" value={inProgress.length} icon={<Loader size={18} />} tone="navy" to="/maint/workorders" />
        <StatCard i={5} label="Waiting parts" value={waitingParts.length} icon={<PackageX size={18} />} tone="rose" to="/maint/parts" />
        <StatCard i={6} label="Completed" value={completed} icon={<CheckCircle2 size={18} />} tone="green" spark={[completed]} to="/maint/history" />
        <StatCard i={7} label="Emergency jobs" value={pending.filter(request => request.priority === 'critical').length} icon={<AlertTriangle size={18} />} tone="rose" spark={[pending.filter(request => request.priority === 'critical').length]} to="/maint/workorders" />
        <StatCard i={8} label="Overdue" value={orders.filter(order => !!order.dueDate && new Date(order.dueDate) < new Date() && !['completed', 'delivered', 'cancelled'].includes(order.status)).length} icon={<Clock4 size={18} />} tone="amber" spark={[orders.filter(order => !!order.dueDate && new Date(order.dueDate) < new Date() && !['completed', 'delivered', 'cancelled'].includes(order.status)).length]} to="/maint/workorders" />
      </div>

      {/* ── Package usage & billing ── */}
      {billing && (
        <Section title={translatePortalText("Package Usage")} sub={translatePortalText("Current usage against your active plan's limits — upgrade, downgrade or cancel here")}>
          <PackagePlanCard dashboard={billing} providerType="maintenance_provider" onChanged={loadBilling} />
        </Section>
      )}

      {/* ── Revenue chart + jobs by category ── */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Section title={translatePortalText("Revenue overview")} sub={translatePortalText("Labor & parts — trailing 12 months")} className="lg:col-span-2"
          actions={<Link to="/maint/reports" className="btn-ghost !py-1.5 !px-3 text-xs">{translatePortalText("Full report")}</Link>}>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={revenueTrend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="mlabor" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.35} /><stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.02} /></linearGradient>
                <linearGradient id="mparts" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} /><stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} /></linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
              <XAxis dataKey="m" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={v => compactMoney(v)} />
              <Tooltip content={<ChartTip />} />
              <Area type="monotone" dataKey="labor" name={translatePortalText("Labor")} stroke="#8b5cf6" strokeWidth={2.5} fill="url(#mlabor)" />
              <Area type="monotone" dataKey="parts" name={translatePortalText("Parts")} stroke="#6366f1" strokeWidth={2.5} fill="url(#mparts)" />
            </AreaChart>
          </ResponsiveContainer>
        </Section>

        <Section title={translatePortalText("Jobs by category")} sub={translatePortalText("Open work by service line")}>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={jobsByCategory} dataKey="value" nameKey="name" innerRadius={52} outerRadius={80} paddingAngle={3} strokeWidth={0}>
                {jobsByCategory.map(c => <Cell key={c.name} fill={c.color} />)}
              </Pie>
              <Tooltip content={<ChartTip />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-1.5 text-xs">
            {jobsByCategory.map(c => (
              <div key={c.name} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
                <span className="font-semibold text-slate-500">{c.name}</span>
                <b className="ms-auto text-deep-900">{formatPortalNumber(c.value)} {translatePortalText("jobs")}</b>
              </div>
            ))}
          </div>
        </Section>
      </div>

      {/* ── Today's schedule + technicians ── */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Section title={translatePortalText("Today's schedule")} sub={translatePortalText("Workshop, dockside & mobile jobs")} className="lg:col-span-2"
          actions={<Link to="/maint/schedule" className="btn-ghost !py-1.5 !px-3 text-xs">{translatePortalText("Full calendar")}</Link>}>
          <div className="space-y-2.5">
            {todaySchedule.map((order, i) => {
              const c = catByKey(order.category)
              return (
                <motion.div key={order.id} initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }}
                  className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-sand/60 p-3">
                  <div className="w-12 shrink-0 text-center">
                    <p className="font-display text-sm font-extrabold text-deep-900">{order.scheduledFor ? formatPortalTime(order.scheduledFor) : '—'}</p>
                    <p className="text-[10px] font-bold uppercase text-slate-400">{order.estimatedHours || 0} {translatePortalText("h")}</p>
                  </div>
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg" style={{ background: `${c.color}1a` }}>{c.icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-extrabold text-deep-900"><bdi dir="auto">{order.boatName} · {localizedField(order, 'title') ?? order.title}</bdi></p>
                    <p className="truncate text-[11px] text-slate-400">{order.technician?.name || translatePortalText("Unassigned")}</p>
                  </div>
                  <MBadge>{statusLabel(order.status)}</MBadge>
                </motion.div>
              )
            })}
          </div>
        </Section>

        <Section title={translatePortalText("Technician availability")}
          sub={translatePortalTemplate('{{count}} of {{total}} on duty', { count: onDuty.length, total: technicians.length })}
          actions={<Link to="/maint/technicians" className="btn-ghost !py-1.5 !px-3 text-xs">{translatePortalText("Manage")}</Link>}>
          <div className="space-y-2.5">
            {technicians.slice(0, 6).map((t, i) => (
              <motion.div key={t.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                className="flex items-center gap-3 rounded-2xl border border-slate-100 p-2.5">
                <div className="relative">
                  <img src={t.avatar} className="h-9 w-9 rounded-full object-cover" />
                  {t.status === 'on_duty' && <span className="absolute -bottom-0.5 -end-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-400" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-extrabold text-deep-900"><bdi dir="auto">{t.name}</bdi></p>
                  <p className="text-[11px] text-slate-400">{localizedField(t, 'role') ?? translatePortalText(t.role)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] font-extrabold text-violet-600">{formatPortalNumber(orders.filter(order => order.technician?.id === t.id && !['completed', 'delivered', 'cancelled'].includes(order.status)).length)} {translatePortalText("active")}</p>
                  <p className="text-[10px] text-slate-400">{statusLabel(t.status)}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </Section>
      </div>

      {/* ── inventory + CSAT ── */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title={translatePortalText("Inventory alerts")} sub={translatePortalText("At or below reorder level")}
          actions={<Link to="/maint/parts" className="btn-ghost !py-1.5 !px-3 text-xs">{translatePortalText("Inventory")}</Link>}>
          <div className="space-y-2">
            {lowParts.map((p, i) => (
              <motion.div key={p.id} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }}
                className="flex items-center gap-2.5 rounded-xl border border-slate-100 p-2.5">
                <span className={`grid h-8 w-8 place-items-center rounded-lg text-sm ${p.stock === 0 ? 'bg-rose-50' : 'bg-amber-50'}`}>{p.stock === 0 ? '⛔' : '⚠️'}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-extrabold text-deep-900">{p.name}</p>
                  <p className="text-[10px] text-slate-400">{formatPortalNumber(p.stock)} {translatePortalText("/ min")} {formatPortalNumber(p.minimumStock)}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </Section>

        <Section title={translatePortalText("Customer satisfaction")} sub={translatePortalText("Last 30 days")}>
          <div className="flex flex-col items-center gap-2 py-1">
            <HealthRing score={0} size={104} label="CSAT" />
            <p className="flex items-center gap-1 font-display text-lg font-extrabold text-deep-900">
              0 <Star size={16} className="fill-amber-700 text-amber-700 dark:fill-amber-400 dark:text-amber-400" />
            </p>
            <p className="text-[11px] text-slate-400">{translatePortalText("No customer feedback has been received yet.")}</p>
          </div>
        </Section>
      </div>

      {/* ── In-progress jobs + notifications ── */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Section title={translatePortalText("Jobs in progress")} sub={translatePortalText("Live work-order status")} className="lg:col-span-2"
          actions={<Link to="/maint/workorders" className="btn-ghost !py-1.5 !px-3 text-xs">{translatePortalText("All work orders")}</Link>}>
          <div className="space-y-2.5">
            {active.slice(0, 5).map((w, i) => {
              const c = catByKey(w.category)
              return (
                <motion.div key={w.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                  className="rounded-2xl border border-slate-100 bg-sand/60 p-3">
                  <div className="flex items-center gap-2.5">
                    <VendorLogoBadge logoUrl={(w as any).boatLogo || (w as any).providerLogo} name={w.boatName} role="boat_provider" size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-extrabold text-deep-900">{w.code} · {w.boatName}</p>
                      <p className="truncate text-[11px] text-slate-400">{localizedField(w, 'title') ?? w.title} · {w.technician?.name || translatePortalText("Unassigned")}</p>
                    </div>
                    <MBadge dot>{statusLabel(w.status)}</MBadge>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <JobProgress pct={w.progress} />
                    <span className="text-[10px] font-bold text-slate-400">{formatPortalPercent(w.progress)}</span>
                  </div>
                </motion.div>
              )
            })}
          </div>
        </Section>

        <Section title={translatePortalText("Latest notifications")} sub={translatePortalText("Requests, parts, approvals & safety")}
          actions={<Link to="/maint/notifications" className="btn-ghost !py-1.5 !px-3 text-xs">{translatePortalText("View all")}</Link>}>
          <div className="space-y-2">
            {notifications.map((n, i) => (
              <motion.div key={n.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                className="flex gap-2.5 rounded-xl border border-slate-100 p-2.5 text-xs hover:bg-sand transition cursor-pointer"
                onClick={() => nav('/maint/notifications')}>
                <span className="text-base">{n.icon}</span>
                <div className="min-w-0">
                  <p className="font-bold text-deep-900 line-clamp-2">{n.text}</p>
                  <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{n.time}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  )
}
