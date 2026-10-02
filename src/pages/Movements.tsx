import React, { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeftRight, Megaphone, FileText, ArrowUpRight, ArrowDownLeft, Plus } from 'lucide-react'
import { PageHeader, Badge, Section, Img, Modal, toast, Progress, SearchInput, ViewToggle, LoadingState, ErrorState } from '../ui'
import { boatPhoto } from '../images'
import {
  useAsync, useMarina, useMarinaSettings, berthLabel, fmtDate, fmtTime, formatMoney, humanize, personOf, todayIso,
} from '../live'
import { useOps } from '../opsStore'
import {
  chatApi, idOf, movementsApi, portalApi, reservationsApi, utilitiesApi, fileUrl,
  type ApiInvoice, type ApiMovement, type ApiReservation,
} from '../api'
import { DateField } from '../components/SemanticFormControls'
import VendorLogoBadge from '../components/VendorLogoBadge'
import { formatPortalClock, formatPortalNumber, translatePortalText } from '../i18n/runtime'


function Step({ done, label, onClick, disabled }: { done: boolean; label: string; onClick?: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={done || disabled}
      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition ${done ? 'bg-emerald-50 text-emerald-700' : 'bg-sand text-slate-500 hover:bg-ocean-50 hover:text-ocean-700 disabled:opacity-50'}`}>
      <span className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full text-[8px] ${done ? 'bg-emerald-500 text-white' : 'border border-slate-300'}`}>{done ? '✓' : ''}</span>
      {translatePortalText(label)}
    </button>
  )
}

interface Charges { dock: number; utility: number; services: number; total: number }

export default function Movements() {
  const { currency } = useMarina()
  const settings = useMarinaSettings()
  const { reloadOverview } = useOps()

  const [activeTab, setActiveTab] = useState<'arrivals' | 'departures'>('arrivals')
  const [view, setView] = useState<'table' | 'card'>('table')
  const [q, setQ] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [invoice, setInvoice] = useState<{ reservation: ApiReservation | null; charges: Charges; invoice: ApiInvoice | null } | null>(null)
  const [scheduling, setScheduling] = useState(false)

  // Everything this board needs: movements, live berths, unbilled utilities and
  // completed services — so the checkout columns are real before check-out runs.
  const moveState = useAsync(() => movementsApi.list({ date: 'all', limit: 100 }).then(r => r.data), [])
  const resState = useAsync(() => reservationsApi.list({ status: 'active', limit: 100 }).then(r => r.data), [])
  const utilState = useAsync(() => utilitiesApi.list({ billed: false, limit: 100 }).then(r => r.data), [])
  const svcState = useAsync(() => portalApi.serviceRequests({ status: 'completed', limit: 100 }).then(r => r.data), [])
  const staffState = useAsync(() => portalApi.staff().then(r => r.data), [])

  const movements = moveState.data?.items ?? []
  const reservations = resState.data?.items ?? []

  const refresh = async () => {
    await Promise.all([moveState.reload(), resState.reload(), utilState.reload(), svcState.reload()])
    await reloadOverview()
  }

  const match = (text: string) => text.toLowerCase().includes(q.trim().toLowerCase())

  /** Arrivals still to happen. */
  const arrivals = useMemo(
    () => movements.filter(m => m.direction === 'arrival' && (m.status === 'expected' || m.status === 'en_route'))
      .filter(m => match(`${m.boatName} ${m.plate ?? ''} ${berthLabel(m.pontoon, m.slot)} ${personOf(m.boater)?.name ?? ''}`))
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)),
    [movements, q],
  )

  /** Unbilled utilities, per reservation. */
  const utilityBySub = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of utilState.data?.items ?? []) {
      const sub = typeof r.subscription === 'object' && r.subscription ? r.subscription.id : r.subscription
      if (typeof sub !== 'string' || !sub) continue
      map.set(sub, (map.get(sub) ?? 0) + r.amount)
    }
    return map
  }, [utilState.data])

  /** Completed services, per customer. */
  const serviceByCustomer = useMemo(() => {
    const map = new Map<string, number>()
    for (const b of svcState.data?.items ?? []) {
      const who = typeof b.customer === 'object' && b.customer ? b.customer.id : b.customer
      if (typeof who !== 'string' || !who) continue
      map.set(who, (map.get(who) ?? 0) + b.amount)
    }
    return map
  }, [svcState.data])

  const chargesFor = (r: ApiReservation): Charges => {
    const who = personOf(r.subscriber)
    const dock = r.totalSar
    const utility = utilityBySub.get(r.id) ?? 0
    const services = who?.id ? serviceByCustomer.get(who.id) ?? 0 : 0
    return { dock, utility, services, total: dock + utility + services }
  }

  /** Boats alongside: an active berth whose arrival has been checked in. */
  const departures = useMemo(() => {
    const checkedInSubs = new Set<string>()
    const bySub = new Map<string, ApiMovement[]>()
    
    for (const m of movements) {
      const subId = typeof m.subscription === 'object' ? m.subscription?.id : m.subscription
      if (subId) {
        if (!bySub.has(subId)) bySub.set(subId, [])
        bySub.get(subId)!.push(m)
      }
    }

    for (const [subId, subMovements] of bySub.entries()) {
      const sorted = [...subMovements].sort((a, b) => String(b.actualAt ?? b.scheduledAt).localeCompare(String(a.actualAt ?? a.scheduledAt)))
      const latestArrival = sorted.find(m => m.direction === 'arrival' && m.status === 'checked_in')
      const latestDeparture = sorted.find(m => m.direction === 'departure' && m.status === 'checked_out')
      
      if (latestArrival) {
        const arrivalTime = String(latestArrival.actualAt ?? latestArrival.scheduledAt)
        const departureTime = latestDeparture ? String(latestDeparture.actualAt ?? latestDeparture.scheduledAt) : ''
        if (arrivalTime > departureTime) {
          checkedInSubs.add(subId)
        }
      }
    }
    return reservations
      .filter(r => checkedInSubs.has(r.id))
      .filter(r => match(`${r.boatName} ${r.plate} ${berthLabel(r.pontoon, r.slot)} ${personOf(r.subscriber)?.name ?? ''}`))
      .map(r => {
        const departure = movements.find(
          m => m.direction === 'departure' &&
               (typeof m.subscription === 'object' ? m.subscription?.id : m.subscription) === r.id &&
               m.status !== 'checked_out' && m.status !== 'cancelled',
        )
        return { reservation: r, departure, charges: chargesFor(r) }
      })
  }, [reservations, movements, q, utilityBySub, serviceByCustomer])

  /** Everything that has already cleared out. */
  const history = useMemo(
    () => movements.filter(m => m.direction === 'departure' && m.status === 'checked_out')
      .sort((a, b) => String(b.actualAt ?? b.scheduledAt).localeCompare(String(a.actualAt ?? a.scheduledAt))),
    [movements],
  )

  const run = async (id: string, fn: () => Promise<unknown>, ok: string, tone: 'success' | 'warn' = 'success') => {
    setBusyId(id)
    try {
      await fn()
      toast(translatePortalText(ok), tone)
      await refresh()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'That action failed'), 'warn')
    } finally { setBusyId(null) }
  }

  // ── arrival flow ──
  const verify = (m: ApiMovement) =>
    run(m.id, () => movementsApi.update(m.id, { documentsVerified: true }), `${m.boatName}'s documents verified`)
  const security = (m: ApiMovement) =>
    run(m.id, () => movementsApi.update(m.id, { securityCleared: true }), 'Gate list updated — security cleared')
  const checkIn = async (m: ApiMovement) => {
    if (!m.documentsVerified || !m.securityCleared) return toast(translatePortalText('Verify documents & clear security first'), 'warn')
    await run(m.id, () => movementsApi.checkIn(m.id), `${m.boatName} checked in at ${berthLabel(m.pontoon, m.slot)} ⚓ — moved to departures board`)
  }
  const notifyCrew = async (m: ApiMovement) => {
    const crew = (staffState.data?.items ?? []).filter(s => s.isActive)
    if (!crew.length) { toast(translatePortalText('Add staff on the People page first — there is nobody to page'), 'warn'); return }
    setBusyId(m.id)
    try {
      let sent = 0
      for (const member of crew) {
        const user = personOf(member.user)
        const userId = idOf(user)
        if (!userId) continue
        const chat = await chatApi.create(userId)
        const chatId = idOf(chat.data.chat)
        if (!chatId) throw new Error('Could not open a crew conversation')
        await chatApi.send(chatId, translatePortalText(`${m.boatName} arriving ${fmtTime(m.scheduledAt)} → berth ${berthLabel(m.pontoon, m.slot)}. Please attend.`))
        sent++
      }
      toast(translatePortalText(`Dock staff paged for ${m.boatName} → ${berthLabel(m.pontoon, m.slot)}`), 'info')
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not page the crew'), 'warn')
    } finally { setBusyId(null) }
  }

  // ── departure flow ──
  /** Makes sure a departure movement exists for the stay, and returns it. */
  const ensureDeparture = async (row: { reservation: ApiReservation; departure?: ApiMovement }): Promise<ApiMovement> => {
    if (row.departure) return row.departure
    const at = `${todayIso()}T${settings.checkOutTime}:00`
    const res = await movementsApi.create({ subscriptionId: row.reservation.id, direction: 'departure', scheduledAt: at })
    return res.data.movement
  }

  const inspect = (row: { reservation: ApiReservation; departure?: ApiMovement }) =>
    run(row.reservation.id, async () => {
      const departure = await ensureDeparture(row)
      await movementsApi.update(departure.id, { securityCleared: true, documentsVerified: true })
    }, `Final inspection passed — ${row.reservation.boatName}`)

  const makeInvoice = (row: { reservation: ApiReservation; departure?: ApiMovement; charges: Charges }) =>
    run(row.reservation.id, async () => {
      let raised: ApiInvoice | null = null
      if (row.charges.utility > 0) {
        const res = await utilitiesApi.bill({ subscriptionId: row.reservation.id })
        raised = res.data.invoice
      }
      setInvoice({ reservation: row.reservation, charges: row.charges, invoice: raised })
    }, row.charges.utility > 0 ? 'Utilities invoiced' : 'Nothing left to invoice — statement shown')

  const release = (row: { reservation: ApiReservation; departure?: ApiMovement }) =>
    run(row.reservation.id, async () => {
      const departure = await ensureDeparture(row)
      await movementsApi.checkOut(departure.id)
    }, `Berth ${berthLabel(row.reservation.pontoon, row.reservation.slot)} released — safe travels ${row.reservation.boatName}! 🌊`)

  const loading = (moveState.loading && !moveState.data) || (resState.loading && !resState.data)
  if (loading) return <LoadingState label="Loading the movements board…" rows={5} />
  if (moveState.error && !moveState.data) return <ErrorState error={moveState.error} onRetry={moveState.reload} />

  return (
    <div className="space-y-5">
      <PageHeader
        title={translatePortalText("Arrivals & Departures")}
        icon={<ArrowLeftRight className="text-ocean-500" />}
        sub={translatePortalText(`Check-in flow, security clearance, checkout & berth release — check-in from ${formatPortalClock(settings.checkInTime)}, check-out by ${formatPortalClock(settings.checkOutTime)}`)}
        actions={
          <div className="flex items-center gap-2">
            <ViewToggle view={view} onChange={setView} />
            <button className="btn-primary" onClick={() => setScheduling(true)}><Plus size={15} /> {translatePortalText("Schedule")}</button>
            <SearchInput value={q} onChange={setQ} placeholder={translatePortalText("Search vessel, guest or berth...")} />
          </div>
        }
      />

      {/* ── Main Two Tabs ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setActiveTab('arrivals')}
            className={`flex items-center gap-2 rounded-2xl px-5 py-2.5 text-sm font-extrabold transition ${activeTab === 'arrivals' ? 'bg-deep-900 text-white shadow-soft ring-2 ring-deep-900/10' : 'bg-white text-slate-500 ring-1 ring-slate-200 hover:ring-ocean-300'}`}>
            <ArrowDownLeft size={17} className={activeTab === 'arrivals' ? 'text-ocean-400' : 'text-slate-400'} />
            {translatePortalText("⚓ Upcoming Arrivals\r\n            ")}<span className={`rounded-full px-2 py-0.5 text-xs font-black ${activeTab === 'arrivals' ? 'bg-ocean-400 text-deep-950' : 'bg-slate-100 text-slate-600'}`}>{formatPortalNumber(arrivals.length)}</span>
          </button>
          <button onClick={() => setActiveTab('departures')}
            className={`flex items-center gap-2 rounded-2xl px-5 py-2.5 text-sm font-extrabold transition ${activeTab === 'departures' ? 'bg-deep-900 text-white shadow-soft ring-2 ring-deep-900/10' : 'bg-white text-slate-500 ring-1 ring-slate-200 hover:ring-violet-300'}`}>
            <ArrowUpRight size={17} className={activeTab === 'departures' ? 'text-violet-400' : 'text-slate-400'} />
            {translatePortalText("🛫 Departures & Checkout\r\n            ")}<span className={`rounded-full px-2 py-0.5 text-xs font-black ${activeTab === 'departures' ? 'bg-violet-400 text-deep-950' : 'bg-slate-100 text-slate-600'}`}>{formatPortalNumber(departures.length)}</span>
          </button>
        </div>
      </div>

      {/* ── TAB 1: ARRIVALS ── */}
      {activeTab === 'arrivals' && (
        <div className="space-y-4">
          {arrivals.length === 0 && (
            <div className="card py-12 text-center text-sm text-slate-400">
              <p className="text-2xl mb-1">⚓</p>
              <p className="font-bold text-slate-600">{translatePortalText("No arrivals on the board")}</p>
              <p>{translatePortalText("Paying for a berth schedules its arrival automatically — or add one with “Schedule”.")}</p>
            </div>
          )}
          {arrivals.length > 0 && view === 'table' ? (
            <div className="card overflow-hidden !p-0 shadow-lift border border-slate-200">
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full min-w-[950px] text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-sand/60 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                      <th className="py-3.5 px-4">{translatePortalText("Vessel & Guest")}</th><th className="py-3.5 px-4">{translatePortalText("ETA")}</th><th className="py-3.5 px-4">{translatePortalText("Berth Slip")}</th>
                      <th className="py-3.5 px-4">{translatePortalText("Vessel Specs")}</th><th className="py-3.5 px-4">{translatePortalText("Progress")}</th><th className="py-3.5 px-4">{translatePortalText("Check-in Flow")}</th><th className="py-3.5 px-4 text-right">{translatePortalText("Notify")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {arrivals.map((m, i) => {
                      const who = personOf(m.boater)
                      const sub = typeof m.subscription === 'object' ? m.subscription : null
                      const steps = [m.documentsVerified, m.securityCleared].filter(Boolean).length
                      return (
                        <motion.tr key={m.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i * 0.03, 0.4) }} className="transition hover:bg-ocean-50/40">
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-3">
                              <VendorLogoBadge logoUrl={(m as any).boatLogo || (m as any).providerLogo || who?.avatar} name={m.boatName} role="boat_provider" size="md" />
                              <div><p className="font-bold text-deep-900">{m.boatName}</p><p className="text-[11px] text-slate-400">{who?.name ?? m.plate ?? '—'}{sub?.reservationNo ? ` · ${sub.reservationNo}` : ''}</p></div>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <p className="font-display font-extrabold text-sm text-ocean-600">{fmtTime(m.scheduledAt)}</p>
                            <p className="text-[10px] text-slate-400 font-bold uppercase">
              {m.status === 'en_route' ? (m.distanceNm != null ? translatePortalText(`${m.distanceNm} nm out`) : translatePortalText('En route')) : fmtDate(m.scheduledAt)}
                            </p>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap"><span className="inline-block rounded-xl bg-ocean-50 px-3 py-1 text-xs font-extrabold text-ocean-700 border border-ocean-200">{translatePortalText("Berth ")}{berthLabel(m.pontoon, m.slot)}</span></td>
                          <td className="py-3 px-4 font-medium text-slate-600">{sub?.boatType ? translatePortalText(humanize(sub.boatType)) : (m.plate ?? '—')}</td>
                          <td className="py-3 px-4 w-36">
                            <Progress pct={(steps / 2) * 100} tone={steps === 2 ? 'bg-emerald-500' : 'bg-ocean-500'} />
                            <p className="text-[10px] font-bold text-slate-400 mt-1">{steps} {translatePortalText("of 2 checks done")}</p>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Step done={m.documentsVerified} label="Verify" disabled={busyId === m.id} onClick={() => verify(m)} />
                              <Step done={m.securityCleared} label="Security" disabled={busyId === m.id} onClick={() => security(m)} />
                              <button onClick={() => checkIn(m)} disabled={busyId === m.id}
                                className="flex items-center gap-1.5 rounded-lg bg-deep-900 px-2.5 py-1.5 text-[11px] font-bold text-white transition hover:bg-deep-800 disabled:opacity-50">{translatePortalText("⚓ Check in")}</button>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-slate-500 bg-sand hover:bg-ocean-50 hover:text-ocean-700 ms-auto"
                              disabled={busyId === m.id} onClick={() => notifyCrew(m)}><Megaphone size={13} /> {translatePortalText("Crew")}</button>
                          </td>
                        </motion.tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : arrivals.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2">
              {arrivals.map((m, i) => {
                const who = personOf(m.boater)
                const sub = typeof m.subscription === 'object' ? m.subscription : null
                const steps = [m.documentsVerified, m.securityCleared].filter(Boolean).length
                return (
                  <motion.div key={m.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} className="card p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <Img src={boatPhoto(m.boatName)} className="h-12 w-12 shrink-0 rounded-2xl" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-base font-extrabold text-deep-900">{m.boatName} <span className="font-medium text-slate-400">· {who?.name ?? m.plate ?? ''}</span></p>
                        <p className="truncate text-xs text-slate-400">{sub?.boatType ? translatePortalText(humanize(sub.boatType)) : ''} {translatePortalText("· berth ")}<b className="text-deep-800">{berthLabel(m.pontoon, m.slot)}</b></p>
                      </div>
                      <div className="shrink-0 text-right"><p className="font-display text-lg font-extrabold text-ocean-600">{fmtTime(m.scheduledAt)}</p><p className="text-[10px] font-bold uppercase text-slate-400">{translatePortalText("ETA")}</p></div>
                    </div>
                    <Progress pct={(steps / 2) * 100} tone={steps === 2 ? 'bg-emerald-500' : 'bg-ocean-500'} />
                    <div className="flex flex-wrap items-center gap-2">
                      <Step done={m.documentsVerified} label="Verify" disabled={busyId === m.id} onClick={() => verify(m)} />
                      <Step done={m.securityCleared} label="Security" disabled={busyId === m.id} onClick={() => security(m)} />
                      <button onClick={() => checkIn(m)} disabled={busyId === m.id} className="rounded-lg bg-deep-900 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-deep-800 disabled:opacity-50">{translatePortalText("⚓ Check in")}</button>
                      <button className="ms-auto btn-ghost !py-1 text-xs" disabled={busyId === m.id} onClick={() => notifyCrew(m)}><Megaphone size={13} /> {translatePortalText("Notify crew")}</button>
                    </div>
                  </motion.div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── TAB 2: DEPARTURES ── */}
      {activeTab === 'departures' && (
        <div className="space-y-4">
          {departures.length === 0 && (
            <div className="card py-12 text-center text-sm text-slate-400">
              <p className="text-2xl mb-1">🛫</p>
              <p className="font-bold text-slate-600">{translatePortalText("No vessels currently berthed")}</p>
              <p>{translatePortalText("Check in an arrival to enable its checkout here.")}</p>
            </div>
          )}
          {departures.length > 0 && view === 'table' ? (
            <div className="card overflow-hidden !p-0 shadow-lift border border-slate-200">
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full min-w-[1000px] text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-sand/60 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                      <th className="py-3.5 px-4">{translatePortalText("Vessel & Guest")}</th><th className="py-3.5 px-4">{translatePortalText("ETD")}</th><th className="py-3.5 px-4">{translatePortalText("Berth")}</th>
                      <th className="py-3.5 px-4 text-right">{translatePortalText("Berthing")}</th><th className="py-3.5 px-4 text-right">{translatePortalText("Utilities")}</th><th className="py-3.5 px-4 text-right">{translatePortalText("Services")}</th>
                      <th className="py-3.5 px-4 text-right">{translatePortalText("Total")}</th><th className="py-3.5 px-4">{translatePortalText("Status")}</th><th className="py-3.5 px-4 text-right">{translatePortalText("Checkout Flow")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {departures.map((row, i) => {
                      const r = row.reservation
                      const who = personOf(r.subscriber)
                      const d = row.departure
                      const inspected = !!d?.securityCleared
                      const invoiced = row.charges.utility === 0
                      const released = d?.status === 'checked_out'
                      return (
                        <motion.tr key={r.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i * 0.03, 0.4) }} className="transition hover:bg-violet-50/30">
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-3">
                              <Img src={boatPhoto(r.boatName)} className="h-10 w-10 shrink-0 rounded-xl object-cover ring-1 ring-slate-200" />
                              <div><p className="font-bold text-deep-900">{r.boatName}</p><p className="text-[11px] text-slate-400">{who?.name ?? r.plate} · {r.reservationNo}</p></div>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <p className="font-display font-extrabold text-sm text-violet-600">{d ? fmtTime(d.scheduledAt) : formatPortalClock(settings.checkOutTime)}</p>
                            <p className="text-[10px] text-slate-400 font-bold uppercase">{d ? translatePortalText('Scheduled') : translatePortalText(`contract to ${fmtDate(r.endDate)}`)}</p>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap"><span className="inline-block rounded-xl bg-violet-50 px-3 py-1 text-xs font-extrabold text-violet-700 border border-violet-200">{translatePortalText("Berth ")}{berthLabel(r.pontoon, r.slot)}</span></td>
                          <td className="py-3 px-4 text-right font-semibold text-slate-600">{formatMoney(row.charges.dock, currency)}</td>
                          <td className="py-3 px-4 text-right font-semibold text-slate-600">{formatMoney(row.charges.utility, currency)}</td>
                          <td className="py-3 px-4 text-right font-semibold text-slate-600">{formatMoney(row.charges.services, currency)}</td>
                          <td className="py-3 px-4 text-right font-display font-extrabold text-sm text-deep-900">{formatMoney(row.charges.total, currency)}</td>
                          <td className="py-3 px-4"><Badge>{translatePortalText(released ? 'Completed' : invoiced && inspected ? 'Invoiced' : inspected ? 'Inspected' : 'Berthed')}</Badge></td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <Step done={inspected} label="Inspection" disabled={busyId === r.id} onClick={() => inspect(row)} />
                              <Step done={invoiced} label="Invoice" disabled={busyId === r.id} onClick={() => makeInvoice(row)} />
                              <Step done={released} label="Release berth" disabled={busyId === r.id || !inspected} onClick={() => release(row)} />
                            </div>
                          </td>
                        </motion.tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : departures.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2">
              {departures.map((row, i) => {
                const r = row.reservation
                const who = personOf(r.subscriber)
                const d = row.departure
                const inspected = !!d?.securityCleared
                const invoiced = row.charges.utility === 0
                const released = d?.status === 'checked_out'
                return (
                  <motion.div key={r.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} className="card p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <Img src={boatPhoto(r.boatName)} className="h-12 w-12 shrink-0 rounded-2xl" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-base font-extrabold text-deep-900">{r.boatName} <span className="font-medium text-slate-400">· {who?.name ?? r.plate}</span></p>
                        <p className="truncate text-xs text-slate-400">{translatePortalText("berth ")}{berthLabel(r.pontoon, r.slot)} {translatePortalText("· departs ")}<b className="text-violet-600">{d ? fmtTime(d.scheduledAt) : formatPortalClock(settings.checkOutTime)}</b></p>
                      </div>
                      <Badge>{translatePortalText(released ? 'Completed' : invoiced && inspected ? 'Invoiced' : inspected ? 'Inspected' : 'Berthed')}</Badge>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5 text-center text-[11px]">
                      {[['Berthing', row.charges.dock], ['Utilities', row.charges.utility], ['Services', row.charges.services], ['Total', row.charges.total]].map(([l, v], j) => (
                        <div key={l as string} className={`rounded-lg py-1.5 ${j === 3 ? 'bg-deep-900 text-white' : 'bg-sand'}`}>
                          <p className={`font-display font-extrabold ${j === 3 ? '' : 'text-deep-900'}`}>{formatMoney(v as number, currency, { compact: true })}</p>
                          <p className={j === 3 ? 'text-white/60' : 'text-slate-400'}>{l}</p>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      <Step done={inspected} label="Inspection" disabled={busyId === r.id} onClick={() => inspect(row)} />
                      <Step done={invoiced} label="Invoice" disabled={busyId === r.id} onClick={() => makeInvoice(row)} />
                      <Step done={released} label="Release berth" disabled={busyId === r.id || !inspected} onClick={() => release(row)} />
                    </div>
                  </motion.div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Departure History — live checked-out movements */}
      <Section title={translatePortalText("Departure History")} sub={translatePortalText("Checked-out vessels & released berths")}>
        <div className="card overflow-hidden !p-0">
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full min-w-[700px]">
              <thead>
                <tr className="border-b border-slate-100 bg-sand/50 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                  <th className="py-3 px-4">{translatePortalText("Departed")}</th><th className="py-3 px-4">{translatePortalText("Vessel")}</th><th className="py-3 px-4">{translatePortalText("Berth")}</th><th className="py-3 px-4 text-right">{translatePortalText("Settled")}</th><th className="py-3 px-4">{translatePortalText("Status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 text-xs">
                {history.length === 0 ? (
                  <tr><td colSpan={5} className="py-8 text-center text-slate-400">{translatePortalText("No completed departures yet.")}</td></tr>
                ) : history.map(m => (
                  <tr key={m.id} className="transition hover:bg-sand/70">
                    <td className="py-2.5 px-4 text-slate-400 font-semibold">{fmtDate(m.actualAt ?? m.scheduledAt)}</td>
                    <td className="py-2.5 px-4 font-bold text-deep-900">{m.boatName}</td>
                    <td className="py-2.5 px-4 text-slate-500">{berthLabel(m.pontoon, m.slot)}</td>
                    <td className="py-2.5 px-4 text-right font-display font-extrabold text-deep-900">
                      {m.charges ? formatMoney(m.charges.dock + m.charges.utility + m.charges.services, currency) : '—'}
                    </td>
                    <td className="py-2.5 px-4"><Badge>{translatePortalText("Completed")}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Section>

      <ScheduleModal open={scheduling} onClose={() => setScheduling(false)} onDone={refresh} settings={settings} reservations={reservations} />

      {/* Invoice / statement modal */}
      <Modal open={!!invoice} onClose={() => setInvoice(null)} title={invoice?.invoice ? translatePortalText("🧾 Invoice Generated") : translatePortalText("🧾 Departure Statement")}>
        {invoice && invoice.reservation && (() => {
          const r = invoice.reservation!
          const who = personOf(r.subscriber)
          const ch = invoice.charges
          const inv = invoice.invoice
          return (
            <div className="text-sm">
              <div className="rounded-2xl border border-dashed border-slate-200 p-5 bg-white">
                <div className="flex justify-between">
                  <div>
                    <p className="font-display text-lg font-extrabold text-deep-900">{inv?.invoiceNumber ?? r.reservationNo}</p>
                    <p className="text-xs text-slate-400">{r.marinaName} · {fmtDate(inv?.createdAt ?? new Date())}</p>
                  </div>
                  <FileText className="text-ocean-400" />
                </div>
                <div className="my-4 border-t border-slate-100" />
                <p className="font-bold text-deep-900">{who?.name ?? translatePortalText('Berth holder')}</p>
                <p className="text-xs text-slate-400">{r.boatName} {translatePortalText("· berth ")}{berthLabel(r.pontoon, r.slot)}</p>
                <div className="mt-4 space-y-1.5 text-xs">
                  <p className="flex justify-between"><span>{translatePortalText("Berthing contract")}</span><b>{formatMoney(ch.dock, currency)}</b></p>
                  <p className="flex justify-between"><span>{translatePortalText("Utility charges")}</span><b>{formatMoney(ch.utility, currency)}</b></p>
                  <p className="flex justify-between"><span>{translatePortalText("Extra services")}</span><b>{formatMoney(ch.services, currency)}</b></p>
                  {inv ? (
                    <>
                      <p className="flex justify-between"><span>{translatePortalText('VAT')} ({formatPortalNumber(inv.vatRate)}%) {translatePortalText('on this invoice')}</span><b>{formatMoney(inv.vatAmount, inv.currency)}</b></p>
                      <p className="mt-2 flex justify-between border-t border-slate-100 pt-2 text-base font-display font-extrabold text-deep-900">
                        <span>{translatePortalText("Invoiced now")}</span><span>{formatMoney(inv.total, inv.currency)}</span>
                      </p>
                    </>
                  ) : (
                    <p className="mt-2 flex justify-between border-t border-slate-100 pt-2 text-base font-display font-extrabold text-deep-900">
                      <span>{translatePortalText("Stay total")}</span><span>{formatMoney(ch.total, currency)}</span>
                    </p>
                  )}
                </div>
                {!inv && <p className="mt-3 text-[11px] text-slate-400">{translatePortalText("Nothing was outstanding, so no new invoice was raised.")}</p>}
              </div>
              <div className="mt-4 flex justify-end gap-2">
                {inv && (
                  <button className="btn-ghost" onClick={async () => {
                    try {
                      const { invoicesApi } = await import('../api')
                      await invoicesApi.email(inv.id)
                      toast(translatePortalText(`Invoice emailed to ${who?.email ?? translatePortalText('the guest')}`), 'info')
                    } catch (e) {
                      toast(translatePortalText(e instanceof Error ? e.message : 'Could not send the invoice'), 'warn')
                    }
                    setInvoice(null)
                  }}>{translatePortalText("Email to guest")}</button>
                )}
                <button className="btn-primary" onClick={() => setInvoice(null)}>{translatePortalText("Done")}</button>
              </div>
            </div>
          )
        })()}
      </Modal>
    </div>
  )
}

/** Schedules an arrival or departure against a live berth. */
function ScheduleModal({ open, onClose, onDone, settings, reservations }: {
  open: boolean
  onClose: () => void
  onDone: () => Promise<void>
  settings: { checkInTime: string; checkOutTime: string }
  reservations: ApiReservation[]
}) {
  const [busy, setBusy] = useState(false)
  const [direction, setDirection] = useState<'arrival' | 'departure'>('arrival')
  const [subscriptionId, setSubscriptionId] = useState('')
  const [boatName, setBoatName] = useState('')
  const [plate, setPlate] = useState('')
  const [date, setDate] = useState(todayIso())
  const [time, setTime] = useState(settings.checkInTime)
  const [notes, setNotes] = useState('')
  const [boatNameErr, setBoatNameErr] = useState('')

  const submit = async () => {
    if (!subscriptionId && !boatName.trim()) {
      setBoatNameErr('Pick a berthed boat or type a boat name')
      return
    }
    setBoatNameErr('')
    setBusy(true)
    try {
      await movementsApi.create({
        direction,
        subscriptionId: subscriptionId || undefined,
        boatName: subscriptionId ? undefined : boatName.trim(),
        plate: plate.trim() || undefined,
        scheduledAt: `${date}T${time}:00`,
        notes: notes.trim() || undefined,
      })
      toast(translatePortalText(`${direction === 'arrival' ? 'Arrival' : 'Departure'} scheduled`))
      onClose()
      setSubscriptionId(''); setBoatName(''); setPlate(''); setNotes('')
      await onDone()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not schedule that movement'), 'warn')
    } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title={translatePortalText("➕ Schedule movement")}>
      <div className="space-y-4">
        <div>
          <label className="label">{translatePortalText("Direction")}</label>
          <div className="flex gap-2">
            {(['arrival', 'departure'] as const).map(d => (
              <button key={d} onClick={() => { setDirection(d); setTime(d === 'arrival' ? settings.checkInTime : settings.checkOutTime) }}
                className={`chip flex-1 justify-center py-2 transition ${direction === d ? 'bg-deep-900 text-white' : 'bg-white ring-1 ring-slate-200 text-slate-500 hover:ring-ocean-300'}`}>
                {d === 'arrival' ? <ArrowDownLeft size={13} /> : <ArrowUpRight size={13} />} {translatePortalText(d === 'arrival' ? 'Arrival' : 'Departure')}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label">{translatePortalText("Berthed boat (optional)")}</label>
          <select className="input" value={subscriptionId} onChange={e => setSubscriptionId(e.target.value)}>
            <option value="">{translatePortalText("— visitor / not on a contract —")}</option>
            {reservations.map(r => (
              <option key={r.id} value={r.id}>{r.boatName} · {berthLabel(r.pontoon, r.slot)} · {r.plate}</option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-slate-400">{translatePortalText("Linking a reservation lets check-out total the stay's utilities and services.")}</p>
        </div>

        {!subscriptionId && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">{translatePortalText("Boat name *")}</label>
              <input className={`input ${boatNameErr ? '!border-rose-400 !ring-2 !ring-rose-100' : ''}`} value={boatName}
                onChange={e => { setBoatName(e.target.value); if (boatNameErr) setBoatNameErr('') }} />
              {boatNameErr && <p className="mt-1 text-xs font-semibold text-rose-500">{translatePortalText(boatNameErr)}</p>}
            </div>
            <div><label className="label">{translatePortalText("Registration")}</label><input className="input uppercase" value={plate} onChange={e => setPlate(e.target.value)} /></div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <DateField label={translatePortalText('Date')} value={date} onChange={setDate} />
          <div><label className="label">{translatePortalText("Time")}</label><input type="time" className="input" value={time} onChange={e => setTime(e.target.value)} /></div>
        </div>

        <div><label className="label">{translatePortalText("Notes for the crew")}</label><textarea className="input min-h-[70px]" value={notes} onChange={e => setNotes(e.target.value)} /></div>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>{translatePortalText("Cancel")}</button>
        <button className="btn-primary" disabled={busy} onClick={submit}>{translatePortalText(busy ? 'Scheduling…' : 'Schedule')}</button>
      </div>
    </Modal>
  )
}
