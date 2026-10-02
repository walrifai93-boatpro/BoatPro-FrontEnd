import React, { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Building2, Zap, Wrench, ConciergeBell, Plus, UserPlus, Gauge, Trash2 } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { PageHeader, Badge, Section, Toggle, toast, Modal, SearchInput, EmptyState, toCSV, download, AsyncBlock, LoadingState } from '../ui'
import { ChartTip, C } from './Dashboard'
import {
  useAsync, useMarina, useMarinaSettings, berthLabel, fmtDate, fmtRelative, formatMoney, humanize, personOf, todayIso,
} from '../live'
import { useOps } from '../opsStore'
import {
  portalApi, utilitiesApi, workOrdersApi, servicesApi, fileUrl,
  type ApiServiceBooking, type ApiWorkOrder, type FacilityKey, type MarinaFacility, type ApiBerthMapEntry,
} from '../api'
import { DateField } from '../components/SemanticFormControls'
import { confirmAndRun } from '../async'
import { canonicalField, formatPortalDate, formatPortalNumber, localizedField, translatePortalText } from '../i18n/runtime'


// ═══ Facilities ═══
// Every facility the platform knows about, with the operator's own detail line.
const FACILITY_META: { key: FacilityKey; name: string; icon: string; hint: string }[] = [
  { key: 'fuel', name: 'Fuel Dock', icon: '⛽', hint: 'Grades & opening hours' },
  { key: 'electricity', name: 'Electricity', icon: '⚡', hint: 'Pedestal amperages' },
  { key: 'water', name: 'Fresh Water', icon: '💧', hint: 'Potable supply points' },
  { key: 'waste', name: 'Waste Disposal', icon: '🗑️', hint: 'Recycling & oil disposal' },
  { key: 'pumpout', name: 'Pump-Out Station', icon: '🚰', hint: 'Fixed or mobile cart' },
  { key: 'showers', name: 'Showers', icon: '🚿', hint: 'Blocks & access' },
  { key: 'restrooms', name: 'Restrooms', icon: '🚻', hint: 'Accessibility & hours' },
  { key: 'laundry', name: 'Laundry', icon: '🧺', hint: 'Machines & payment' },
  { key: 'wifi', name: 'Wi-Fi', icon: '📶', hint: 'Coverage across the docks' },
  { key: 'restaurant', name: 'Restaurant', icon: '🍽️', hint: 'Name & serving hours' },
  { key: 'cafe', name: 'Café', icon: '☕', hint: 'Dockside hours' },
  { key: 'parking', name: 'Parking', icon: '🅿️', hint: 'Spaces & EV chargers' },
  { key: 'security', name: 'Security', icon: '🛡️', hint: 'Patrols & gated docks' },
  { key: 'cctv', name: 'CCTV', icon: '📹', hint: 'Cameras & retention' },
  { key: 'pool', name: 'Swimming Pool', icon: '🏊', hint: 'Access & hours' },
  { key: 'gym', name: 'Gym', icon: '🏋️', hint: 'Access & hours' },
  { key: 'supermarket', name: 'Provisioning Shop', icon: '🛒', hint: 'On-site groceries' },
  { key: 'boatlift', name: 'Boat Lift', icon: '⛴️', hint: 'Capacity' },
  { key: 'crane', name: 'Crane', icon: '🏗️', hint: 'Capacity & booking' },
  { key: 'customs', name: 'Customs Office', icon: '🛃', hint: 'Port of entry hours' },
  { key: 'prayer_room', name: 'Prayer Room', icon: '🕌', hint: 'Location' },
  { key: 'lounge', name: 'Guest Lounge', icon: '🛋️', hint: 'Access & hours' },
]

export function Facilities() {
  const { reload: reloadMarina } = useMarina()
  const state = useAsync(() => portalApi.settings().then(r => r.data), [])
  const [saved, setSaved] = useState<Record<string, { available: boolean; detail: string }>>({})
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [editing, setEditing] = useState<FacilityKey | null>(null)
  const [detailDraft, setDetailDraft] = useState('')

  React.useEffect(() => {
    if (!state.data) return
    const next: Record<string, { available: boolean; detail: string }> = {}
    for (const f of state.data.facilities) next[f.key] = { available: f.available, detail: canonicalField<string>(f, 'detail') ?? '' }
    setSaved(next)
  }, [state.data])

  /** Publishes the whole facility list — the toggle is the save. */
  const publish = async (next: Record<string, { available: boolean; detail: string }>, key: FacilityKey, on: boolean) => {
    setBusyKey(key)
    const facilities: MarinaFacility[] = Object.entries(next)
      .filter(([, v]) => v.available || v.detail)
      .map(([k, v]) => ({ key: k as FacilityKey, available: v.available, detail: v.detail || undefined }))
    try {
      await portalApi.setFacilities(facilities)
      setSaved(next)
      await state.reload()
      await reloadMarina()
      const name = FACILITY_META.find(f => f.key === key)?.name ?? key
      toast(`${translatePortalText(name)} ${translatePortalText(on ? 'now available ✅' : 'marked unavailable')}`, on ? 'success' : 'warn')
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not publish that change'), 'warn')
    } finally { setBusyKey(null) }
  }

  const toggle = (key: FacilityKey, on: boolean) =>
    publish({ ...saved, [key]: { available: on, detail: saved[key]?.detail ?? '' } }, key, on)

  const saveDetail = async () => {
    if (!editing) return
    const next = { ...saved, [editing]: { available: saved[editing]?.available ?? true, detail: detailDraft } }
    setEditing(null)
    await publish(next, editing, next[editing].available)
  }

  const on = Object.values(saved).filter(v => v.available).length

  return (
    <div>
      <PageHeader title={translatePortalText("Marina Facilities")} icon={<Building2 className="text-ocean-500" />}
        sub={`${on} of ${FACILITY_META.length} facilities currently available to guests — toggles publish instantly to the BoatPro app`} />

      <AsyncBlock state={state} loadingLabel="Loading facilities…">
        {() => (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {FACILITY_META.map((f, i) => {
              const v = saved[f.key] ?? { available: false, detail: '' }
              return (
                <motion.div key={f.key} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.03, 0.5) }}
                  className={`card card-hover p-5 ${!v.available && 'opacity-70'} ${busyKey === f.key ? 'animate-pulse' : ''}`}>
                  <div className="flex items-start justify-between">
                    <span className={`grid h-12 w-12 place-items-center rounded-2xl text-2xl ${v.available ? 'bg-ocean-50' : 'bg-slate-100 grayscale'}`}>{f.icon}</span>
                    <Toggle on={v.available} onChange={val => toggle(f.key, val)} />
                  </div>
                  <p className="mt-3 font-display font-bold text-deep-900">{translatePortalText(f.name)}</p>
                  <button className="mt-0.5 text-left text-xs text-slate-400 hover:text-ocean-600"
                    onClick={() => { setEditing(f.key); setDetailDraft(v.detail) }}>
                    {localizedField<string>(state.data?.facilities.find((facility) => facility.key === f.key), 'detail', v.detail) || translatePortalText(`Add detail — ${f.hint}`)}
                  </button>
                  <p className={`mt-2 text-[11px] font-extrabold uppercase tracking-wide ${v.available ? 'text-emerald-600' : 'text-rose-500'}`}>{translatePortalText(v.available ? '● Available' : '● Unavailable')}</p>
                </motion.div>
              )
            })}
          </div>
        )}
      </AsyncBlock>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={`✏️ ${translatePortalText(FACILITY_META.find(f => f.key === editing)?.name ?? 'Facility')}`}>
        <label className="label">{translatePortalText("What should boaters know?")}</label>
        <input className="input" value={detailDraft} onChange={e => setDetailDraft(e.target.value)}
          placeholder={translatePortalText(FACILITY_META.find(f => f.key === editing)?.hint ?? '')} />
        <div className="mt-6 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setEditing(null)}>{translatePortalText("Cancel")}</button>
          <button className="btn-primary" onClick={saveDetail}>{translatePortalText("Save")}</button>
        </div>
      </Modal>
    </div>
  )
}

// ═══ Utilities ═══
export function Utilities() {
  const { currency } = useMarina()
  const settings = useMarinaSettings()
  const [logging, setLogging] = useState(false)
  const [busy, setBusy] = useState(false)

  const state = useAsync(() => utilitiesApi.list({ limit: 200 }).then(r => r.data), [])
  const readings = state.data?.items ?? []
  const monthly = (state.data?.monthly ?? []).map(m => ({
    ...m,
    m: formatPortalDate(new Date(`${m.month}-01T12:00:00Z`), { month: 'short', timeZone: 'UTC' }),
    kwh: m.electricity,
    water: m.water,
  }))

  // Latest reading per berth+meter — the live meter board.
  const meters = useMemo(() => {
    const byBerth = new Map<string, { berth: string; boat: string; subscription?: string; kwh: number; water: number; charge: number }>()
    for (const r of readings) {
      const sub = typeof r.subscription === 'object' && r.subscription ? r.subscription : null
      const berth = berthLabel(r.pontoon ?? sub?.pontoon, r.slot ?? sub?.slot)
      const key = berth
      const row = byBerth.get(key) ?? { berth, boat: sub?.boatName ?? translatePortalText('Unassigned'), subscription: sub?.id, kwh: 0, water: 0, charge: 0 }
      if (r.kind === 'electricity') row.kwh += r.consumption
      else row.water += r.consumption
      if (!r.billed) row.charge += r.amount
      byBerth.set(key, row)
    }
    return [...byBerth.values()].sort((a, b) => a.berth.localeCompare(b.berth))
  }, [readings])

  const thisMonth = todayIso().slice(0, 7)
  const current = (state.data?.monthly ?? []).find(m => m.month === thisMonth)
  const unbilled = state.data?.unbilled ?? {}

  const exportUsage = () => {
    if (!meters.length) { toast(translatePortalText('No readings to export yet'), 'warn'); return }
    const csv = toCSV(
      meters.map(m => ({
        [translatePortalText('Berth')]: m.berth,
        [translatePortalText('Vessel')]: m.boat,
        kWh: m.kwh,
        [translatePortalText('Water m³')]: m.water,
        [`${translatePortalText('Unbilled')} (${currency})`]: +m.charge.toFixed(2),
      })),
      [translatePortalText('Berth'), translatePortalText('Vessel'), 'kWh', translatePortalText('Water m³'), `${translatePortalText('Unbilled')} (${currency})`],
    )
    download(`utility-usage-${todayIso()}.csv`, csv, 'text/csv;charset=utf-8')
    toast(translatePortalText('Meter readings exported to CSV'))
  }

  const billAll = (subscriptionId: string, boat: string) =>
    confirmAndRun({
      title: `Invoice all unbilled utilities for ${boat}?`,
      body: 'Every unbilled electricity and water reading is rolled into one VAT invoice.',
      confirmLabel: 'Raise invoice',
      busyLabel: 'Invoicing...',
      run: async () => {
        setBusy(true)
        try {
          const res = await utilitiesApi.bill({ subscriptionId })
          await state.reload()
          return res.data
        } finally { setBusy(false) }
      },
      // The real counts and total, from the server response.
      success: (d) =>
        `Invoiced ${d.billed} ${d.billed === 1 ? 'reading' : 'readings'} - ${formatMoney(d.invoice.total, currency)}`,
      error: 'Could not raise the invoice. Please try again.',
    })

  const ratesMissing = settings.electricityRate == null && settings.waterRate == null

  return (
    <div>
      <PageHeader title={translatePortalText("Utility Usage")} icon={<Zap className="text-ocean-500" />}
        sub="Electricity & water consumption, meter readings and utility billing"
        actions={<>
          <button className="btn-ghost" onClick={() => setLogging(true)}><Gauge size={15} /> {translatePortalText("Log reading")}</button>
          <button className="btn-primary" onClick={exportUsage}>{translatePortalText("Export usage report")}</button>
        </>} />

      {ratesMissing && (
        <p className="mb-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 ring-1 ring-amber-100">
          {translatePortalText("⚠️ No utility tariffs set yet — add your electricity and water rates in Settings so readings price themselves.\n        ")}</p>
      )}

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        {[
          { l: `Electricity · ${formatPortalDate(new Date(), { month: 'long' })}`, v: `${formatPortalNumber(current?.electricity ?? 0)} kWh`, d: settings.electricityRate != null ? `${formatMoney(settings.electricityRate, currency)}/kWh` : translatePortalText('no tariff set'), i: '⚡' },
          { l: `Water · ${formatPortalDate(new Date(), { month: 'long' })}`, v: `${formatPortalNumber(current?.water ?? 0)} m³`, d: settings.waterRate != null ? `${formatMoney(settings.waterRate, currency)}/m³` : translatePortalText('no tariff set'), i: '💧' },
          { l: translatePortalText('Awaiting invoice'), v: formatMoney((unbilled.electricity?.amount ?? 0) + (unbilled.water?.amount ?? 0), currency), d: translatePortalText(`${(unbilled.electricity?.count ?? 0) + (unbilled.water?.count ?? 0)} reading(s)`), i: '🧾' },
        ].map((k, i) => (
          <motion.div key={k.l} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }} className="card p-5">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">{k.i} {translatePortalText(k.l)}</p>
            <p className="mt-1 font-display text-2xl font-extrabold text-deep-900">{k.v}</p>
            <p className="text-xs font-bold text-slate-400">{k.d}</p>
          </motion.div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title={translatePortalText("Consumption trend")} sub="Electricity (kWh) & water (m³) — from logged readings">
          {monthly.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="m" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip currency={currency} />} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="kwh" name={translatePortalText('Electricity (kWh)')} stroke={C.s1} strokeWidth={2.5} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="water" name={translatePortalText('Water (m³)')} stroke={C.s2} strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : <EmptyState icon="⚡" text="No readings logged yet" />}
        </Section>

        <Section title={translatePortalText("Live meter readings")} sub="This billing cycle, per berth"
          actions={<button className="btn-ghost !py-1.5 !px-3 text-xs" onClick={() => state.reload()}><Gauge size={13} /> {translatePortalText("Refresh meters")}</button>}>
          {state.loading && !state.data ? <LoadingState label="Reading meters…" rows={3} /> : meters.length === 0 ? (
            <EmptyState icon="⚡" text="No meter readings yet — log one to start billing utilities." />
          ) : (
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full min-w-[600px]">
                <thead><tr className="border-b border-slate-100"><th className="th">{translatePortalText("Berth")}</th><th className="th">{translatePortalText("Vessel")}</th><th className="th">{translatePortalText("kWh")}</th><th className="th">{translatePortalText("Water m³")}</th><th className="th text-right">{translatePortalText("Unbilled")}</th></tr></thead>
                <tbody>
                  {meters.map(m => (
                    <tr key={m.berth} className="border-b border-slate-50 transition hover:bg-sand">
                      <td className="td font-extrabold">{m.berth}</td>
                      <td className="td">⛵ {m.boat}</td>
                      <td className="td">{formatPortalNumber(m.kwh)}</td>
                      <td className="td">{m.water}</td>
                      <td className="td text-right">
                        <span className="font-display font-extrabold">{formatMoney(m.charge, currency)}</span>
                        {m.charge > 0 && m.subscription && (
                          <button className="ms-2 rounded-lg bg-ocean-50 px-2 py-1 text-[10px] font-bold text-ocean-700 hover:bg-ocean-100 disabled:opacity-50"
                            disabled={busy} onClick={() => billAll(m.subscription!, m.boat)}>{translatePortalText("Invoice")}</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>

      <ReadingModal open={logging} onClose={() => setLogging(false)} onDone={async () => { await state.reload() }} settings={settings} currency={currency} />
    </div>
  )
}

function ReadingModal({ open, onClose, onDone, settings, currency }: {
  open: boolean; onClose: () => void; onDone: () => Promise<void>
  settings: { electricityRate?: number; waterRate?: number }; currency: string
}) {
  const [busy, setBusy] = useState(false)
  const [kind, setKind] = useState<'electricity' | 'water'>('electricity')
  const [slotRef, setSlotRef] = useState('')
  const [current, setCurrent] = useState('')
  const [previous, setPrevious] = useState('')
  const [rate, setRate] = useState('')
  const [date, setDate] = useState(todayIso())
  const [notes, setNotes] = useState('')

  const berths = useAsync(() => (open ? portalApi.berthMap().then(r => r.data) : Promise.resolve(null)), [open])
  const occupied = (berths.data?.berths ?? []).filter((b: ApiBerthMapEntry) => b.reservation)

  const submit = async () => {
    if (current === '') { toast(translatePortalText('Enter the current meter reading'), 'warn'); return }
    setBusy(true)
    try {
      await utilitiesApi.create({
        kind,
        slotRef: slotRef || undefined,
        currentReading: Number(current),
        previousReading: previous === '' ? undefined : Number(previous),
        unitRate: rate === '' ? undefined : Number(rate),
        readingDate: date,
        notes: notes.trim() || undefined,
      })
      toast(translatePortalText('Reading logged'))
      onClose()
      setCurrent(''); setPrevious(''); setRate(''); setNotes('')
      await onDone()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not log the reading'), 'warn')
    } finally { setBusy(false) }
  }

  const defaultRate = kind === 'electricity' ? settings.electricityRate : settings.waterRate

  return (
    <Modal open={open} onClose={onClose} title={translatePortalText("⚡ Log a meter reading")}>
      <div className="space-y-4">
        <div>
          <label className="label">{translatePortalText("Meter")}</label>
          <div className="flex gap-2">
            {(['electricity', 'water'] as const).map(k => (
              <button key={k} onClick={() => setKind(k)}
                className={`chip flex-1 justify-center py-2 transition ${kind === k ? 'bg-deep-900 text-white' : 'bg-white ring-1 ring-slate-200 text-slate-500 hover:ring-ocean-300'}`}>
                {translatePortalText(k === 'electricity' ? '⚡ Electricity' : '💧 Water')}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="label">{translatePortalText("Berth")}</label>
          <select className="input" value={slotRef} onChange={e => setSlotRef(e.target.value)}>
            <option value="">{translatePortalText("— not tied to a berth —")}</option>
            {occupied.map(b => (
              <option key={b.id} value={b.id}>{berthLabel(b.pontoon, b.number)} · {b.reservation?.boatName}</option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-slate-400">{translatePortalText("Picking an occupied berth bills whoever currently holds it.")}</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="label">{translatePortalText("Previous reading")}</label><input type="number" className="input" value={previous} onChange={e => setPrevious(e.target.value)} placeholder={translatePortalText("auto from last reading")} /></div>
          <div><label className="label">{translatePortalText("Current reading")}</label><input type="number" className="input" value={current} onChange={e => setCurrent(e.target.value)} /></div>
          <div><label className="label">{translatePortalText('Rate')} ({currency}/{kind === 'electricity' ? 'kWh' : 'm³'})</label>
            <input type="number" step="0.01" className="input" value={rate} onChange={e => setRate(e.target.value)}
              placeholder={defaultRate != null ? String(defaultRate) : translatePortalText("set a tariff in Settings")} />
          </div>
          <DateField label={translatePortalText('Reading date')} value={date} onChange={setDate} />
        </div>
        <div><label className="label">{translatePortalText("Notes")}</label><input className="input" value={notes} onChange={e => setNotes(e.target.value)} /></div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>{translatePortalText("Cancel")}</button>
        <button className="btn-primary" disabled={busy} onClick={submit}>{translatePortalText(busy ? 'Saving…' : 'Log reading')}</button>
      </div>
    </Modal>
  )
}

// ═══ Maintenance ═══
const WO_COLUMNS: { status: ApiWorkOrder['status']; label: string }[] = [
  { status: 'open', label: 'Open' },
  { status: 'scheduled', label: 'Scheduled' },
  { status: 'in_progress', label: 'In progress' },
  { status: 'done', label: 'Done' },
]
const PRIORITY_LABEL: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' }

export function Maintenance() {
  const { currency } = useMarina()
  const { reloadOverview } = useOps()
  const [adding, setAdding] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const state = useAsync(() => workOrdersApi.list({ limit: 100 }).then(r => r.data), [])
  const staff = useAsync(() => portalApi.staff().then(r => r.data), [])
  const berths = useAsync(() => portalApi.berthMap().then(r => r.data), [])
  const orders = state.data?.items ?? []

  const refresh = async () => { await state.reload(); await berths.reload(); await reloadOverview() }

  const advance = async (w: ApiWorkOrder) => {
    const i = WO_COLUMNS.findIndex(c => c.status === w.status)
    const next = WO_COLUMNS[Math.min(i + 1, WO_COLUMNS.length - 1)]
    setBusyId(w.id)
    try {
      await workOrdersApi.update(w.id, { status: next.status })
      toast(`${w.code} → ${translatePortalText(next.label)}`)
      await refresh()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not move that work order'), 'warn')
    } finally { setBusyId(null) }
  }

  const remove = (w: ApiWorkOrder) =>
    confirmAndRun({
      title: `Delete work order ${w.code}?`,
      body: 'It leaves the board and its history is removed. This cannot be undone.',
      confirmLabel: 'Delete',
      busyLabel: 'Deleting...',
      danger: true,
      run: async () => {
        await workOrdersApi.remove(w.id)
        await refresh()
      },
      success: `Work order ${w.code} deleted successfully`,
      error: 'Could not delete the work order. Please try again.',
    })

  return (
    <div>
      <PageHeader title={translatePortalText("Maintenance Management")} icon={<Wrench className="text-ocean-500" />}
        sub="Dock, berth, facility & equipment work orders on a live board"
        actions={<button className="btn-primary" onClick={() => setAdding(true)}><Plus size={16} /> {translatePortalText("New work order")}</button>} />

      <AsyncBlock state={state} loadingLabel="Loading the board…">
        {() => (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {WO_COLUMNS.map((col, ci) => (
              <div key={col.status} className="rounded-2xl bg-slate-50/70 p-3">
                <p className="mb-3 flex items-center justify-between px-1 text-xs font-extrabold uppercase tracking-wider text-slate-500">
                  {translatePortalText(col.label)} <span className="rounded-full bg-white px-2 py-0.5 ring-1 ring-slate-200">{formatPortalNumber(orders.filter(o => o.status === col.status).length)}</span>
                </p>
                <div className="space-y-3">
                  <AnimatePresence>
                    {orders.filter(o => o.status === col.status).map(w => {
                      const assignee = typeof w.assignee === 'object' && w.assignee ? w.assignee.user : null
                      return (
                        <motion.div key={w.id} layout initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                          className="card card-hover p-4">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-bold text-deep-900 leading-snug">{w.title}</p>
                            <Badge>{translatePortalText(PRIORITY_LABEL[w.priority])}</Badge>
                          </div>
                          <p className="mt-1 text-xs text-slate-400">{w.asset} · {translatePortalText(humanize(w.kind))} · {w.code}</p>
                          {w.description && <p className="mt-2 text-xs text-slate-500">{w.description}</p>}
                          {w.blocksBerth && <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-700">{translatePortalText("Berth out of service")}</p>}
                          <div className="mt-3 flex items-center justify-between border-t border-slate-50 pt-2.5 text-xs">
                            <span className="text-slate-400">
                              {w.dueDate ? `📅 ${fmtDate(w.dueDate)}` : `📅 ${translatePortalText('no due date')}`}{w.cost > 0 && <> · <b className="text-deep-900">{formatMoney(w.cost, currency)}</b></>}
                            </span>
                            <span className="flex items-center gap-1.5">
                              {assignee?.name && (
                                <img title={assignee.name}
                                  src={fileUrl(assignee.avatar) ?? `https://ui-avatars.com/api/?name=${encodeURIComponent(assignee.name)}&background=e2e8f0&color=475569`}
                                  className="h-6 w-6 rounded-full object-cover" alt="" />
                              )}
                              <button className="text-slate-300 transition hover:text-rose-500" title={translatePortalText("Delete")} onClick={() => remove(w)}><Trash2 size={13} /></button>
                            </span>
                          </div>
                          {col.status !== 'done' && (
                            <button onClick={() => advance(w)} disabled={busyId === w.id}
                              className="mt-2.5 w-full rounded-lg bg-ocean-50 py-1.5 text-xs font-bold text-ocean-700 transition hover:bg-ocean-100 disabled:opacity-50">
                              {translatePortalText('Move to ')}{translatePortalText(WO_COLUMNS[Math.min(ci + 1, WO_COLUMNS.length - 1)].label)} →
                            </button>
                          )}
                        </motion.div>
                      )
                    })}
                  </AnimatePresence>
                </div>
              </div>
            ))}
          </div>
        )}
      </AsyncBlock>

      <WorkOrderModal open={adding} onClose={() => setAdding(false)} onDone={refresh} currency={currency}
        staff={staff.data?.items ?? []} berths={berths.data?.berths ?? []} />
    </div>
  )
}

function WorkOrderModal({ open, onClose, onDone, currency, staff, berths }: {
  open: boolean; onClose: () => void; onDone: () => Promise<void>; currency: string
  staff: { id: string; role: string; isActive: boolean; user: any }[]
  berths: ApiBerthMapEntry[]
}) {
  const [busy, setBusy] = useState(false)
  const [f, setF] = useState({
    title: '', asset: '', kind: 'dock', priority: 'medium', dueDate: '', cost: '', description: '',
    assignee: '', slotRef: '', blocksBerth: false,
  })
  React.useEffect(() => {
    if (open) setF({ title: '', asset: '', kind: 'dock', priority: 'medium', dueDate: '', cost: '', description: '', assignee: '', slotRef: '', blocksBerth: false })
  }, [open])

  const submit = async () => {
    if (!f.title.trim()) { toast(translatePortalText('Give the work order a title'), 'warn'); return }
    if (!f.asset.trim()) { toast(translatePortalText('Name the asset it applies to'), 'warn'); return }
    setBusy(true)
    try {
      const res = await workOrdersApi.create({
        title: f.title.trim(),
        asset: f.asset.trim(),
        kind: f.kind as ApiWorkOrder['kind'],
        priority: f.priority as ApiWorkOrder['priority'],
        dueDate: f.dueDate || undefined,
        cost: f.cost === '' ? 0 : Number(f.cost),
        description: f.description.trim() || undefined,
        assignee: f.assignee || undefined,
        slotRef: f.slotRef || undefined,
        blocksBerth: f.blocksBerth,
      })
      toast(translatePortalText(`${res.data.workOrder.code} created`))
      onClose()
      await onDone()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not create the work order'), 'warn')
    } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title={translatePortalText("🔧 New work order")}>
      <div className="space-y-4">
        <div><label className="label">{translatePortalText("Title")}</label><input className="input" placeholder={translatePortalText("e.g. Replace cleat on A-05")} value={f.title} onChange={e => setF(s => ({ ...s, title: e.target.value }))} /></div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="label">{translatePortalText("Asset")}</label><input className="input" placeholder={translatePortalText("Berth / dock / equipment")} value={f.asset} onChange={e => setF(s => ({ ...s, asset: e.target.value }))} /></div>
          <div><label className="label">{translatePortalText("Type")}</label>
            <select className="input" value={f.kind} onChange={e => setF(s => ({ ...s, kind: e.target.value }))}>
              {['dock', 'berth', 'facility', 'equipment', 'vessel'].map(k => <option key={k} value={k}>{translatePortalText(humanize(k))}</option>)}
            </select>
          </div>
          <div><label className="label">{translatePortalText("Priority")}</label>
            <select className="input" value={f.priority} onChange={e => setF(s => ({ ...s, priority: e.target.value }))}>
              {['low', 'medium', 'high', 'critical'].map(k => <option key={k} value={k}>{translatePortalText(PRIORITY_LABEL[k])}</option>)}
            </select>
          </div>
          <DateField label={translatePortalText('Due date')} value={f.dueDate} onChange={d => setF(s => ({ ...s, dueDate: d }))} />
          <div><label className="label">{translatePortalText('Cost')} ({currency})</label><input type="number" className="input" value={f.cost} onChange={e => setF(s => ({ ...s, cost: e.target.value }))} /></div>
          <div><label className="label">{translatePortalText("Assign to")}</label>
            <select className="input" value={f.assignee} onChange={e => setF(s => ({ ...s, assignee: e.target.value }))}>
              <option value="">{translatePortalText("Unassigned")}</option>
              {staff.map(m => {
                const u = personOf(m.user)
                return <option key={m.id} value={m.id}>{u?.name ?? translatePortalText('Staff')} · {translatePortalText(humanize(m.role))}</option>
              })}
            </select>
          </div>
          <div className="col-span-2"><label className="label">{translatePortalText("Affects berth")}</label>
            <select className="input" value={f.slotRef} onChange={e => setF(s => ({ ...s, slotRef: e.target.value }))}>
              <option value="">{translatePortalText("No specific berth")}</option>
              {berths.map(b => <option key={b.id} value={b.id}>{berthLabel(b.pontoon, b.number)}</option>)}
            </select>
          </div>
        </div>
        <div><label className="label">{translatePortalText("Description")}</label><textarea className="input min-h-[70px]" value={f.description} onChange={e => setF(s => ({ ...s, description: e.target.value }))} /></div>
        {f.slotRef && (
          <div className="flex items-center gap-3 rounded-xl bg-amber-50 px-3 py-2.5">
            <Toggle on={f.blocksBerth} onChange={v => setF(s => ({ ...s, blocksBerth: v }))} />
            <span className="text-sm font-semibold text-amber-800">{translatePortalText("Take this berth out of service while the job is open")}</span>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>{translatePortalText("Cancel")}</button>
          <button className="btn-primary" disabled={busy} onClick={submit}>{translatePortalText(busy ? 'Creating…' : 'Create')}</button>
        </div>
      </div>
    </Modal>
  )
}

// ═══ Service Requests ═══
const SVC_FLOW: ApiServiceBooking['status'][] = ['pending', 'confirmed', 'completed']
const SVC_LABEL: Record<string, string> = { pending: 'New', confirmed: 'Accepted', completed: 'Completed', cancelled: 'Cancelled' }
const SVC_ICON: Record<string, string> = {
  lounge: '🛋️', washroom: '🚻', prayer_room: '🕌', parking: '🅿️', maintenance: '🔧',
  boat_cleaning: '🧽', boat_washing: '🚿', electricity: '⚡', water_supply: '💧',
  waste_disposal: '🗑️', ice_supply: '🧊', internet: '📶', security: '🛡️',
}

export function Services() {
  const { marina, currency } = useMarina()
  const { reloadOverview } = useOps()
  const [q, setQ] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [addingService, setAddingService] = useState(false)

  const state = useAsync(() => portalApi.serviceRequests({ limit: 100 }).then(r => r.data), [])
  const reqs = state.data?.items ?? []
  const counts = state.data?.statusCounts ?? {}
  const catalogue = state.data?.services ?? []

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return reqs
    return reqs.filter(r => {
      const svc = typeof r.service === 'object' && r.service ? r.service : null
      const who = personOf(r.customer)
      return `${svc?.name ?? ''} ${svc?.category ?? ''} ${who?.name ?? ''}`.toLowerCase().includes(term)
    })
  }, [reqs, q])

  const refresh = async () => { await state.reload(); await reloadOverview() }

  const patch = async (b: ApiServiceBooking, next: ApiServiceBooking['status'], msg: string) => {
    setBusyId(b.id)
    try {
      await servicesApi.setBookingStatus(b.id, next)
      toast(translatePortalText(msg))
      await refresh()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not update the request'), 'warn')
    } finally { setBusyId(null) }
  }

  return (
    <div>
      <PageHeader title={translatePortalText("Marina Service Requests")} icon={<ConciergeBell className="text-ocean-500" />}
        sub="Guest requests from the BoatPro app — accept, track, complete & invoice"
        actions={<>
          <button className="btn-primary" onClick={() => setAddingService(true)}><Plus size={15} /> {translatePortalText("Add service")}</button>
          <SearchInput value={q} onChange={setQ} placeholder={translatePortalText("Search requests…")} />
        </>} />

      <div className="mb-5 flex flex-wrap gap-3">
        {[...SVC_FLOW, 'cancelled' as const].map(s => (
          <div key={s} className="card flex items-center gap-2 px-4 py-2.5">
            <Badge>{translatePortalText(SVC_LABEL[s])}</Badge><span className="font-display font-extrabold text-deep-900">{formatPortalNumber(counts[s] ?? 0)}</span>
          </div>
        ))}
        <div className="card flex items-center gap-2 px-4 py-2.5">
          <span className="chip bg-slate-100 text-slate-600">{translatePortalText("Revenue")}</span>
          <span className="font-display font-extrabold text-deep-900">{formatMoney(state.data?.revenue ?? 0, currency)}</span>
        </div>
      </div>

      <AsyncBlock state={state} loadingLabel="Loading service requests…">
        {() => (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {rows.map((r, i) => {
              const svc = typeof r.service === 'object' && r.service ? r.service : null
              const who = personOf(r.customer)
              const next = SVC_FLOW[SVC_FLOW.indexOf(r.status) + 1]
              return (
                <motion.div key={r.id} layout initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.05, 0.4) }} className="card card-hover p-5">
                  <div className="flex items-start gap-3">
                    <span className="grid h-12 w-12 place-items-center rounded-2xl bg-ocean-50 text-2xl">{SVC_ICON[svc?.category ?? ''] ?? '🛎️'}</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-display font-bold text-deep-900">{svc ? localizedField<string>(svc, 'name') ?? svc.name : translatePortalText('Service')}</p>
                      <p className="truncate text-xs text-slate-400">{svc ? translatePortalText(humanize(svc.category)) : ''} · {who?.name ?? translatePortalText('Guest')}</p>
                    </div>
                  <Badge dot={r.status === 'confirmed'}>{translatePortalText(SVC_LABEL[r.status])}</Badge>
                  </div>
                  {r.notes && <p className="mt-3 rounded-xl bg-sand px-3 py-2 text-xs text-slate-500">{r.notes}</p>}
                  <div className="mt-3 flex items-center justify-between text-xs">
                    <span className="text-slate-400">🕐 {r.startAt ? fmtDate(r.startAt) : fmtRelative(r.createdAt)}</span>
                    <span className="font-display text-base font-extrabold text-deep-900">{r.amount > 0 ? formatMoney(r.amount, currency) : translatePortalText('Free')}</span>
                  </div>
                  <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
                    {who?.phone
                      ? <a href={`tel:${who.phone}`} className="flex items-center gap-1.5 text-xs font-bold text-deep-800"><UserPlus size={13} className="text-slate-400" />{who.phone}</a>
                      : <span className="text-xs text-slate-400">{who?.email ?? ''}</span>}
                    {r.status === 'pending' && (
                      <>
                        <button className="btn-primary ms-auto !py-1.5 !px-3 text-xs" disabled={busyId === r.id}
                          onClick={() => patch(r, 'confirmed', `${svc ? localizedField<string>(svc, 'name') ?? svc.name : translatePortalText('Request')} ${translatePortalText('accepted')}`)}>{translatePortalText("✓ Accept")}</button>
                        <button className="btn-ghost !py-1.5 !px-2.5 text-xs hover:!bg-rose-50 hover:text-rose-600" disabled={busyId === r.id}
                          onClick={() => patch(r, 'cancelled', translatePortalText('Request declined'))}>✕</button>
                      </>
                    )}
                    {r.status === 'confirmed' && next && (
                      <button className="btn-primary ms-auto !py-1.5 !px-3 text-xs" disabled={busyId === r.id}
                        onClick={() => patch(r, next, `${svc ? localizedField<string>(svc, 'name') ?? svc.name : translatePortalText('Request')} → ${translatePortalText(SVC_LABEL[next])}`)}>{translatePortalText("✓ Complete")}</button>
                    )}
                    {r.status === 'completed' && (
                      <span className="ms-auto text-[11px] font-bold text-emerald-600">{translatePortalText("● Billed on departure")}</span>
                    )}
                  </div>
                </motion.div>
              )
            })}
            {rows.length === 0 && (
              <div className="card md:col-span-2 lg:col-span-3">
                <EmptyState icon="🛎️" text={q ? 'No matching requests.' : 'No service requests yet — add services so boaters can order them.'} />
              </div>
            )}
          </div>
        )}
      </AsyncBlock>

      {/* What the marina sells */}
      <Section title={translatePortalText("Your service list")} sub="What boaters can order from the BoatPro app" className="mt-6">
        {catalogue.length === 0 ? (
          <EmptyState icon="🛎️" text="Nothing on the list yet — add what your marina sells." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {catalogue.map(s => (
              <div key={s.id} className="flex items-center gap-3 rounded-2xl border border-slate-100 p-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sand text-lg">{SVC_ICON[s.category] ?? '🛎️'}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-deep-900">{localizedField<string>(s, 'name') ?? s.name}</p>
                  <p className="truncate text-[11px] text-slate-400">{translatePortalText(humanize(s.category))} · {translatePortalText(humanize(s.pricingUnit))}</p>
                </div>
                <span className="font-display font-extrabold text-deep-900">{formatMoney(s.price, currency)}</span>
                <Toggle on={s.isAvailable} onChange={async v => {
                  try {
                    await servicesApi.update(s.id, { isAvailable: v })
                    toast(`${localizedField<string>(s, 'name') ?? s.name} ${translatePortalText(v ? 'switched on' : 'switched off')}`, v ? 'success' : 'warn')
                    await refresh()
                  } catch (e) {
                    toast(translatePortalText(e instanceof Error ? e.message : 'Could not update the service'), 'warn')
                  }
                }} />
              </div>
            ))}
          </div>
        )}
      </Section>

      <AddServiceModal open={addingService} onClose={() => setAddingService(false)} onDone={refresh} marinaId={marina?.id} currency={currency} />
    </div>
  )
}

const SERVICE_CATEGORIES = [
  'lounge', 'washroom', 'prayer_room', 'parking', 'maintenance', 'boat_cleaning', 'boat_washing',
  'electricity', 'water_supply', 'waste_disposal', 'ice_supply', 'internet', 'security',
] as const

function AddServiceModal({ open, onClose, onDone, marinaId, currency }: {
  open: boolean; onClose: () => void; onDone: () => Promise<void>; marinaId?: string; currency: string
}) {
  const [busy, setBusy] = useState(false)
  const [f, setF] = useState({ name: '', category: 'boat_cleaning', price: '', pricingUnit: 'per_use', description: '' })

  const submit = async () => {
    if (!marinaId) { toast(translatePortalText('Your marina is still loading'), 'warn'); return }
    if (!f.name.trim() || f.price === '') { toast(translatePortalText('Name and price are required'), 'warn'); return }
    setBusy(true)
    try {
      await servicesApi.create({
        marinaId, name: f.name.trim(), category: f.category, price: Number(f.price),
        pricingUnit: f.pricingUnit, description: f.description.trim() || undefined,
      })
      toast(translatePortalText(`${f.name} added to your service list`))
      onClose(); setF({ name: '', category: 'boat_cleaning', price: '', pricingUnit: 'per_use', description: '' })
      await onDone()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not add the service'), 'warn')
    } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title={translatePortalText("➕ Add a service")}>
      <div className="space-y-4">
        <div><label className="label">{translatePortalText("Name")}</label><input className="input" value={f.name} onChange={e => setF(s => ({ ...s, name: e.target.value }))} placeholder={translatePortalText("Hull wash & deck detail")} /></div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="label">{translatePortalText("Category")}</label>
            <select className="input" value={f.category} onChange={e => setF(s => ({ ...s, category: e.target.value }))}>
              {SERVICE_CATEGORIES.map(c => <option key={c} value={c}>{translatePortalText(humanize(c))}</option>)}
            </select>
          </div>
          <div><label className="label">{translatePortalText("Pricing")}</label>
            <select className="input" value={f.pricingUnit} onChange={e => setF(s => ({ ...s, pricingUnit: e.target.value }))}>
              {['per_use', 'hourly', 'daily', 'flat'].map(u => <option key={u} value={u}>{translatePortalText(humanize(u))}</option>)}
            </select>
          </div>
        </div>
        <div><label className="label">{translatePortalText('Price')} ({currency})</label><input type="number" className="input" value={f.price} onChange={e => setF(s => ({ ...s, price: e.target.value }))} /></div>
        <div><label className="label">{translatePortalText("Description")}</label><textarea className="input min-h-[70px]" value={f.description} onChange={e => setF(s => ({ ...s, description: e.target.value }))} /></div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>{translatePortalText("Cancel")}</button>
          <button className="btn-primary" disabled={busy} onClick={submit}>{translatePortalText(busy ? 'Adding…' : 'Add service')}</button>
      </div>
    </Modal>
  )
}
