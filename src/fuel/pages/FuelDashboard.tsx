import React, { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, Legend } from 'recharts'
import { DollarSign, Droplets, Hourglass, ClipboardList, CheckCircle2, AlertTriangle, ArrowRight, Wind, Eye, Sun, Waves } from 'lucide-react'
import { stationCoverPhotos, notifStyle, relativeTime, toBooking, toPump, toTank } from '../fuelData'
import { useFuel, useFuelResource } from '../fuelStore'
import { fuelApi } from '../fuelApi'
import { StatCard, Section, CoverPhoto, Counter, LoadingState } from '../../ui'
import { FBadge, TankGauge } from '../fuelUi'
import { StationApprovalNotice } from '../components/StationApprovalNotice'
import { monetizationApi } from '../../api'
import { PackagePlanCard, type ProviderDashboardData } from '../../shared/packageLimit'
import VendorLogoBadge from '../../components/VendorLogoBadge'
import { formatPortalNumber, isPortalArabic, localizedField, portalLocale, translatePortalText } from '../../i18n/runtime'

const ChartTip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-slate-100 bg-white/95 px-3 py-2 text-xs shadow-lift backdrop-blur">
      <p className="font-bold text-deep-900 mb-1">{translatePortalText(label)}</p>
      {payload.map((p: any) => (
        <p key={p.name} className="flex items-center gap-2 text-slate-500">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.fill }} />
          {translatePortalText(p.name)}: <b className="text-deep-900">{p.value.toLocaleString(portalLocale())}</b>
        </p>
      ))}
    </div>
  )
}

/** "9a" / "12p" — the compact hour label the sales chart is drawn with. */
const hourLabel = (h: number) => {
  if (isPortalArabic()) {
    return new Intl.DateTimeFormat(portalLocale(), { hour: 'numeric', hour12: true, timeZone: 'UTC' })
      .format(new Date(Date.UTC(2020, 0, 1, h)))
  }
  return h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`
}

/** Trims a series to its last `n` points for a sparkline. */
const spark = (values: number[], n = 12) => (values.length ? values.slice(-n) : [0])

export default function FuelDashboard() {
  const navigate = useNavigate()
  const { overview, loading, fuelByKey, station, currency } = useFuel()
  const weather = useFuelResource(() => fuelApi.weather().then((r) => r.data.weather), [])
  const billing = useFuelResource(() => monetizationApi.providerDashboard().then((r) => r.data as unknown as ProviderDashboardData), [])

  const model = useMemo(() => {
    if (!overview) return null
    const tanks = overview.tanks.map(toTank)
    // Fuel is served at the station only: the work in hand is boats due at, or
    // alongside, the fuel dock — and the pumps that will serve them. (This was
    // dispatched delivery runs and the barge/truck fleet.)
    const open = (overview.openOrders ?? []).map(toBooking)
    const pumps = (overview.pumps ?? []).map(toPump)
    const lowTanks = tanks.filter((t) => t.status === 'Low' || t.status === 'Critical')

    // The dashboard chart only shows trading hours — a 24-bar day is mostly
    // empty for a fuel dock and squashes the peak.
    const hourly = overview.charts.hourly
      .map((row, h) => ({ h: hourLabel(h), gal: row.gal, hour: h }))
      .filter((row) => row.hour >= 5 && row.hour <= 21)

    const monthly = overview.charts.monthly.map((m) => ({
      m: new Date(`${m.m}-01T00:00:00`).toLocaleDateString(portalLocale(), { month: 'short' }),
      diesel: m.diesel,
      petrol: m.petrol,
      other: m.other,
    }))

    const fuelMix = Object.entries(overview.charts.soldToday)
      .filter(([, v]) => v > 0)
      .map(([key, value]) => {
        const p = fuelByKey(key)
        return { name: p.name, value, color: p.color }
      })
      .sort((a, b) => b.value - a.value)

    return { tanks, open, pumps, lowTanks, hourly, monthly, fuelMix }
  }, [overview, fuelByKey])

  if (loading && !overview) return <LoadingState label={translatePortalText("Loading your fuel operation…")} rows={6} />
  if (!overview || !model) return null

  const { kpis, emergencyBooking, staff, alerts } = overview
  const emergency = emergencyBooking
  const onDuty = staff.filter((s) => s.status === 'on_duty')
  const w = weather.data
  const stationName = localizedField<string>(station, 'name', station?.name)
  const stationCity = localizedField<string>(station, 'city', station?.city)
  const firstName = stationName?.split(' ')[0]
  const openCount = kpis.openOrders ?? kpis.activeDeliveries

  return (
    <div className="space-y-6">
      <StationApprovalNotice />
      {/* ── Hero ── */}
      <motion.div initial={{ opacity: 0, scale: 0.985 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5 }}
        className="relative overflow-hidden rounded-3xl bg-fuel-gradient text-white shadow-lift">
        <CoverPhoto srcs={stationCoverPhotos(station)} className="absolute inset-0 h-full w-full opacity-25" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#120a04]/85 via-[#120a04]/55 to-transparent" />
        <div className="relative z-10 flex flex-wrap items-end justify-between gap-6 p-7 md:p-10">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.25em] text-amber-300">
              {new Date().toLocaleDateString(portalLocale(), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              {stationName ? ` · ${stationName}` : translatePortalText("")}
            </p>
            <h1 className="mt-2 font-display text-3xl md:text-4xl font-extrabold">{firstName ? <>{translatePortalText("Good day, ")}{firstName}</> : translatePortalText("Good day")} ⛽</h1>
            <p className="mt-2 max-w-xl text-sm text-white/70">
              {kpis.pendingOrders} {translatePortalText(kpis.pendingOrders === 1 ? 'new order waiting' : 'new orders waiting')} · {openCount} {translatePortalText(openCount === 1 ? 'order in progress' : 'orders in progress')}.
              {model.lowTanks.length > 0
                ? translatePortalText(`${model.lowTanks.map((t) => t.code).join(', ')} are below the reorder point — raise a purchase order.`)
                : translatePortalText("All tanks are above their reorder points.")}
            </p>
            <div className="mt-5 flex flex-wrap gap-2.5">
              <Link to="/fuel/bookings" className="btn-fuel">{translatePortalText("Review ")}{kpis.pendingOrders}{translatePortalText(" orders ")}<ArrowRight size={15} className="rtl:rotate-180" /></Link>
              <Link to="/fuel/deliveries" className="btn-ghost !bg-white/10 !border-white/20 !text-white hover:!bg-white/20">{translatePortalText("Manage orders")}</Link>
            </div>
          </div>
          <div className="flex gap-4">
            {[{ n: Math.round(kpis.volumeToday), l: 'Volume sold today' }, { n: openCount, l: 'Orders in progress' }, { n: onDuty.length, l: 'Staff on duty' }].map((s, i) => (
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

      {/* ── Emergency banner ── */}
      {emergency && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="flex flex-wrap items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-3.5">
          <span className="animate-flicker text-2xl">🚨</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-extrabold text-rose-700">{translatePortalText("Emergency fuel request — ")}{emergency.boatName ?? 'vessel'} ({typeof emergency.customer === 'object' && emergency.customer ? emergency.customer.name : emergency.customerName ?? 'walk-in'})
            </p>
            <p className="text-xs text-rose-500">
              {emergency.quantity.toLocaleString(portalLocale())} {fuelByKey(emergency.fuelType).unit} {fuelByKey(emergency.fuelType).name} · {emergency.location ?? '—'}{translatePortalText(" · requested ASAP")}</p>
          </div>
          <Link to="/fuel/bookings" className="btn-primary !bg-gradient-to-r !from-rose-600 !to-rose-400 !shadow-none">{translatePortalText("Review now")}</Link>
        </motion.div>
      )}

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 ">
        {/* `currency` names what these amounts already are; the tile converts
            and signs them. The prefix here was `currency === 'USD' ? '$' : ''`,
            which left a SAR station's revenue as a bare number with no
            currency on it at all. */}
        <StatCard i={0} label={translatePortalText(`Total revenue · ${new Date().toLocaleDateString(portalLocale(), { month: 'long' })}`)} value={kpis.revenueMonth} currency={currency} icon={<DollarSign size={20} />} tone="navy" spark={spark(model.monthly.map(m => m.diesel + m.petrol + m.other))} to="/fuel/billing" />
        <StatCard i={1} label={translatePortalText("Today's fuel sales")} value={kpis.salesToday} currency={currency} icon={<Droplets size={20} />} tone="amber" spark={spark(model.hourly.map(h => h.gal))} to="/fuel/reports" />
        <StatCard i={2} label={translatePortalText("Pending orders")} value={kpis.pendingOrders} icon={<Hourglass size={20} />} tone="violet" to="/fuel/bookings" />
        <StatCard i={3} label={translatePortalText("Orders in progress")} value={openCount} icon={<ClipboardList size={20} />} tone="ocean" to="/fuel/deliveries" />
        <StatCard i={4} label={translatePortalText("Completed today")} value={kpis.completedToday} icon={<CheckCircle2 size={20} />} tone="green" to="/fuel/bookings" />
        <StatCard i={5} label={translatePortalText("Low stock alerts")} value={kpis.lowStockAlerts} icon={<AlertTriangle size={20} />} tone="rose" to="/fuel/inventory" />
      </div>

      {/* ── Package usage & billing ── */}
      {billing.data && (
        <Section title={translatePortalText("Package Usage")} sub={translatePortalText("Current usage against your active plan's limits — upgrade, downgrade or cancel here")}>
          <PackagePlanCard dashboard={billing.data} providerType="fuel_provider" onChanged={billing.reload} />
        </Section>
      )}

      {/* ── Sales chart + inventory status ── */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Section title={translatePortalText("Fuel sales — today by hour")} sub={translatePortalText("All pumps combined")} className="lg:col-span-2"
          actions={<Link to="/fuel/reports" className="btn-ghost !py-1.5 !px-3 text-xs">{translatePortalText("Full report")}</Link>}>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={model.hourly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="fgal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.35} /><stop offset="100%" stopColor="#f59e0b" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
              <XAxis dataKey="h" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={v => formatPortalNumber(v)} />
              <Tooltip content={<ChartTip />} />
              <Area type="monotone" dataKey="gal" name={translatePortalText("Volume")} stroke="#f59e0b" strokeWidth={2.5} fill="url(#fgal)" />
            </AreaChart>
          </ResponsiveContainer>
        </Section>

        <Section title={translatePortalText("Weather & marine")} sub={translatePortalText(stationCity ? `${stationCity} · fuel dock conditions` : 'Fuel dock conditions')}>
          {weather.error || !w ? (
            <p className="rounded-2xl bg-sand px-4 py-8 text-center text-xs font-semibold text-slate-400">
              {weather.loading ? translatePortalText("Loading conditions…") : translatePortalText("Live conditions are unavailable right now.")}
            </p>
          ) : (<>
            <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-400 p-4 text-white">
              <Sun size={40} className="animate-float" />
              <div>
                <p className="font-display text-3xl font-extrabold">{w.temperature != null ? formatPortalNumber(Math.round(w.temperature)) : translatePortalText("—")}{translatePortalText("°C")}</p>
                <p className="text-xs text-white/80">{w.isDay ? translatePortalText("Daylight") : translatePortalText("Night")}{translatePortalText(" · humidity ")}{w.humidity != null ? formatPortalNumber(w.humidity) : '—'}%</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              {[
                { icon: <Wind size={14} />, l: 'Wind', v: w.windSpeed != null ? `${formatPortalNumber(Math.round(w.windSpeed))} kn` : '—' },
                { icon: <Waves size={14} />, l: 'Seas', v: w.waveHeight != null ? `${formatPortalNumber(w.waveHeight)} m` : '—' },
                { icon: <Eye size={14} />, l: 'Visibility', v: w.visibilityKm != null ? `${formatPortalNumber(Math.round(w.visibilityKm))} km` : '—' },
                { icon: <Wind size={14} />, l: 'Gusts', v: w.windGust != null ? `${formatPortalNumber(Math.round(w.windGust))} kn` : '—' },
              ].map(row => (
                <div key={row.l} className="flex items-center gap-2 rounded-xl bg-sand px-3 py-2.5">
                  <span className="text-amber-500">{row.icon}</span>
                  <span className="text-slate-400 font-semibold">{translatePortalText(row.l)}</span>
                  <b className="ms-auto text-deep-900">{row.v}</b>
                </div>
              ))}
            </div>
            {w.warning && (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-semibold text-amber-700">
                ⚠️ {translatePortalText(w.warning)}{translatePortalText(" — take care at the fuel dock.")}</div>
            )}
          </>)}
        </Section>
      </div>

      {/* ── Tanks + fuel mix ── */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Section title={translatePortalText("Fuel inventory status")} sub={translatePortalText("Live tank levels — reorder markers shown")} className="lg:col-span-2"
          actions={<Link to="/fuel/inventory" className="btn-ghost !py-1.5 !px-3 text-xs">{translatePortalText("Manage tanks")}</Link>}>
          {model.tanks.length === 0 ? (
            <p className="rounded-2xl bg-sand px-4 py-10 text-center text-xs font-semibold text-slate-400">{translatePortalText("No tanks registered yet — add your first one from Inventory & Tanks.")}</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              {model.tanks.map((t, i) => {
                const f = fuelByKey(t.fuel)
                const pct = t.capacity ? Math.round((t.stock / t.capacity) * 100) : 0
                return (
                  <motion.div key={t.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} className="text-center">
                    <TankGauge pct={pct} color={f.color} height={110} />
                    <p className="mt-1.5 text-[11px] font-extrabold text-deep-900">{t.code}</p>
                    <p className="text-[10px] font-semibold text-slate-400">{f.icon} {f.name.split(' ')[0]}</p>
                    <div className="mt-1"><FBadge dot={t.status !== 'Healthy'}>{t.status}</FBadge></div>
                  </motion.div>
                )
              })}
            </div>
          )}
        </Section>

        <Section title={translatePortalText("Today's fuel mix")} sub={translatePortalText("Volume sold by product")}>
          {model.fuelMix.length === 0 ? (
            <p className="rounded-2xl bg-sand px-4 py-10 text-center text-xs font-semibold text-slate-400">{translatePortalText("Nothing dispensed yet today.")}</p>
          ) : (<>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={model.fuelMix} dataKey="value" nameKey="name" innerRadius={52} outerRadius={80} paddingAngle={3} strokeWidth={0}>
                  {model.fuelMix.map(f => <Cell key={f.name} fill={f.color} />)}
                </Pie>
                <Tooltip content={<ChartTip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-1.5 text-xs">
              {model.fuelMix.map(f => (
                <div key={f.name} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: f.color }} />
                  <span className="font-semibold text-slate-500">{f.name}</span>
                  <b className="ms-auto text-deep-900">{f.value.toLocaleString(portalLocale())}</b>
                </div>
              ))}
            </div>
          </>)}
        </Section>
      </div>

      {/* ── Orders in progress + pumps + notifications ── */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Section title={translatePortalText("Orders in progress")} sub={translatePortalText("Boats due at, or alongside, your fuel dock")}
          actions={<Link to="/fuel/deliveries" className="btn-ghost !py-1.5 !px-3 text-xs">{translatePortalText("All orders")}</Link>}>
          <div className="space-y-2.5">
            {model.open.length === 0 && <p className="rounded-xl bg-sand px-3 py-6 text-center text-xs font-semibold text-slate-400">{translatePortalText("No boats due at the fuel dock right now.")}</p>}
            {model.open.map((b, i) => (
              <motion.div key={b.id} initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.07 }}
                className="rounded-2xl border border-slate-100 bg-sand/60 p-3">
                <div className="flex items-center gap-2.5">
                  <VendorLogoBadge logoUrl={b.avatar} name={b.boat} role="boat_provider" size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-extrabold text-deep-900">{b.boat} · {b.qty.toLocaleString(portalLocale())} {fuelByKey(b.fuel).unit}</p>
                    <p className="truncate text-[11px] text-slate-400">{b.ref} · {b.date} {b.time}</p>
                  </div>
                  <span className="flex shrink-0 items-center gap-1">
                    <FBadge dot={b.status === 'In progress'}>{b.status}</FBadge>
                    {b.paid && <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[9px] font-extrabold text-emerald-700">{translatePortalText("✓ Paid")}</span>}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        </Section>

        <Section title={translatePortalText("Fuel dock pumps")} sub={translatePortalText("Pump readiness right now")}
          actions={<Link to="/fuel/inventory" className="btn-ghost !py-1.5 !px-3 text-xs">{translatePortalText("Manage pumps")}</Link>}>
          <div className="space-y-2.5">
            {model.pumps.length === 0 && <p className="rounded-xl bg-sand px-3 py-6 text-center text-xs font-semibold text-slate-400">{translatePortalText("No pumps registered yet.")}</p>}
            {model.pumps.map((p, i) => {
              const f = fuelByKey(p.fuel)
              return (
                <motion.div key={p.id} initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.07 }}
                  className="flex items-center gap-3 rounded-2xl border border-slate-100 p-2.5">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-xl">{f.icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-extrabold text-deep-900">{p.name}</p>
                    <p className="text-[11px] text-slate-400">{p.code} · {f.name}</p>
                  </div>
                  <FBadge dot={p.status === 'Dispensing'}>{p.status}</FBadge>
                </motion.div>
              )
            })}
          </div>
        </Section>

        <Section title={translatePortalText("Latest notifications")} sub={translatePortalText("Orders, stock, payments & safety")}
          actions={<Link to="/fuel/notifications" className="btn-ghost !py-1.5 !px-3 text-xs">{translatePortalText("View all")}</Link>}>
          <div className="space-y-2.5">
            {alerts.length === 0 && <p className="rounded-xl bg-sand px-3 py-6 text-center text-xs font-semibold text-slate-400">{translatePortalText("Nothing new right now.")}</p>}
            {alerts.slice(0, 5).map((n, i) => (
              <motion.div key={n._id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                className="flex gap-2.5 rounded-xl border border-slate-100 p-2.5 text-xs hover:bg-sand transition cursor-pointer"
                onClick={() => navigate('/fuel/notifications')}>
                <span className="text-base">{notifStyle(n.type).icon}</span>
                <div className="min-w-0">
                  <p className="font-bold text-deep-900 line-clamp-2"><bdi dir="auto">{translatePortalText(String(localizedField<string>(n, 'body', n.body) ?? n.body))}</bdi></p>
                  <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{relativeTime(n.createdAt)}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </Section>
      </div>

      {/* ── Monthly volume (full width) ── */}
      <Section title={translatePortalText("Monthly fuel volume")} sub={translatePortalText("Volume dispensed — trailing 12 months")}>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={model.monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
            <XAxis dataKey="m" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={v => (v >= 1000 ? `${v / 1000}k` : String(v))} />
            <Tooltip content={<ChartTip />} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="diesel" name={translatePortalText("Diesel")} stackId="a" fill="#f59e0b" radius={[0, 0, 0, 0]} />
            <Bar dataKey="petrol" name={translatePortalText("Petrol")} stackId="a" fill="#1b9bbf" />
            <Bar dataKey="other" name={translatePortalText("Other")} stackId="a" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Section>
    </div>
  )
}
