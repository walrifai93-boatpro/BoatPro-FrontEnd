import React, { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Building2, Zap, Wrench, ConciergeBell, Plus, UserPlus, Gauge, Trash2 } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { PageHeader, Badge, Section, Toggle, toast, Modal, SearchInput, EmptyState, ErrorState, toCSV, download, AsyncBlock, LoadingState } from '../ui'
import { C } from './Dashboard'
import {
  useAsync, useMarina, useMarinaSettings, berthLabel, fmtDate, fmtRelative, formatMoney, humanize, personOf, todayIso,
} from '../live'
import { useOps } from '../opsStore'
import {
  portalApi, utilitiesApi, workOrdersApi, servicesApi, fileUrl, idOf,
  type ApiServiceBooking, type ApiMarinaService, type ApiWorkOrder, type FacilityKey, type MarinaFacility, type ApiBerthMapEntry,
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

/** `facilitiesSchema` caps each detail line at this. */
const FACILITY_DETAIL_MAX = 200

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

  // Every publish sends the whole list built from `saved`, so a second toggle
  // fired before the first returns would publish a stale list over it.
  const toggle = (key: FacilityKey, on: boolean) => {
    if (busyKey) return
    void publish({ ...saved, [key]: { available: on, detail: saved[key]?.detail ?? '' } }, key, on)
  }

  const saveDetail = async () => {
    if (!editing || busyKey) return
    const detail = detailDraft.trim()
    if (detail.length > FACILITY_DETAIL_MAX) { toast(translatePortalText(`Keep it under ${FACILITY_DETAIL_MAX} characters`), 'warn'); return }
    // Keeps whatever the card shows. Was `?? true`, so adding a note to a
    // facility that had never been switched on published it as available.
    const next = { ...saved, [editing]: { available: saved[editing]?.available ?? false, detail } }
    setEditing(null)
    await publish(next, editing, next[editing].available)
  }

  const on = Object.values(saved).filter(v => v.available).length

  return (
    <div>
      <PageHeader title={translatePortalText("Marina Facilities")} icon={<Building2 className="text-ocean-500" />}
        sub={translatePortalText(`${on} of ${FACILITY_META.length} facilities currently available to guests — toggles publish instantly to the BoatPro app`)} />

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
        <input className="input" value={detailDraft} maxLength={FACILITY_DETAIL_MAX} onChange={e => setDetailDraft(e.target.value)}
          placeholder={translatePortalText(FACILITY_META.find(f => f.key === editing)?.hint ?? '')} />
        <p className="mt-1 text-end text-[11px] text-slate-400">{formatPortalNumber(detailDraft.length)}/{formatPortalNumber(FACILITY_DETAIL_MAX)}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setEditing(null)}>{translatePortalText("Cancel")}</button>
          <button className="btn-primary" disabled={!!busyKey} onClick={saveDetail}>{translatePortalText("Save")}</button>
        </div>
      </Modal>
    </div>
  )
}

// ═══ Utilities ═══
/** Chart tooltip for meter units — plain numbers with the series' own unit, never currency. */
const UsageTip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-slate-100 bg-white/95 px-3 py-2 text-xs shadow-lift backdrop-blur">
      <p className="mb-1 font-bold text-deep-900">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} className="flex items-center gap-2 text-slate-500">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.fill }} />
          {p.name}: <b className="text-deep-900">{formatPortalNumber(Number(p.value) || 0)}</b>
        </p>
      ))}
    </div>
  )
}

export function Utilities() {
  const { currency } = useMarina()
  const settings = useMarinaSettings()
  const [logging, setLogging] = useState(false)
  const [busy, setBusy] = useState(false)

  // The board is "this billing cycle", i.e. what has not been invoiced yet. It
  // used to sum every reading in the newest page (the API caps a page at 100,
  // so `limit: 200` was silently 100), mixing invoiced usage into the cycle.
  // `monthly` and `unbilled` are whole-marina aggregates either way.
  const state = useAsync(() => utilitiesApi.list({ billed: false, limit: 100 }).then(r => r.data), [])
  const readings = state.data?.items ?? []
  const unbilledTotal = state.data?.pagination?.total ?? readings.length
  const hasAnyReadings = (state.data?.monthly ?? []).length > 0
  const monthly = (state.data?.monthly ?? []).map(m => ({
    ...m,
    m: formatPortalDate(new Date(`${m.month}-01T12:00:00Z`), { month: 'short', timeZone: 'UTC' }),
    kwh: m.electricity,
    water: m.water,
  }))

  // Unbilled usage per berth *and* holder — the live meter board. Keyed by the
  // berth alone, two holders of one berth merged into a row whose Invoice
  // button billed only one of them while showing both charges.
  const meters = useMemo(() => {
    const byBerth = new Map<string, { key: string; berth: string; boat: string; subscription?: string; kwh: number; water: number; charge: number }>()
    for (const r of readings) {
      const sub = typeof r.subscription === 'object' && r.subscription ? r.subscription : null
      const subId = sub ? (sub.id ?? sub._id) : typeof r.subscription === 'string' ? r.subscription : undefined
      const hasBerth = !!(r.pontoon ?? sub?.pontoon) || (r.slot ?? sub?.slot) != null
      const berth = hasBerth ? berthLabel(r.pontoon ?? sub?.pontoon, r.slot ?? sub?.slot) : translatePortalText('No berth')
      const key = `${berth}|${subId ?? ''}`
      const row = byBerth.get(key) ?? { key, berth, boat: sub?.boatName || translatePortalText('Unassigned'), subscription: subId, kwh: 0, water: 0, charge: 0 }
      if (r.kind === 'electricity') row.kwh += r.consumption
      else row.water += r.consumption
      if (!r.billed) row.charge += r.amount
      byBerth.set(key, row)
    }
    return [...byBerth.values()]
      .map(m => ({ ...m, kwh: Math.round(m.kwh * 100) / 100, water: Math.round(m.water * 100) / 100 }))
      .sort((a, b) => a.berth.localeCompare(b.berth))
  }, [readings])

  const thisMonth = todayIso().slice(0, 7)
  const current = (state.data?.monthly ?? []).find(m => m.month === thisMonth)
  const unbilled = state.data?.unbilled ?? {}

  const exportUsage = () => {
    if (!meters.length) { toast(translatePortalText(hasAnyReadings ? 'Every reading is invoiced — nothing unbilled to export' : 'No readings to export yet'), 'warn'); return }
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
    download(`utility-usage-unbilled-${todayIso()}.csv`, csv, 'text/csv;charset=utf-8')
    toast(translatePortalText('Unbilled meter usage exported to CSV'))
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

      {state.error && !state.data && (
        <div className="mb-5"><ErrorState error={state.error} onRetry={() => void state.reload()} /></div>
      )}

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        {[
          { l: `${translatePortalText('Electricity')} · ${formatPortalDate(new Date(), { month: 'long' })}`, v: `${formatPortalNumber(current?.electricity ?? 0)} ${translatePortalText('kWh')}`, d: settings.electricityRate != null ? `${formatMoney(settings.electricityRate, currency)}/${translatePortalText('kWh')}` : translatePortalText('no tariff set'), i: '⚡' },
          { l: `${translatePortalText('Water')} · ${formatPortalDate(new Date(), { month: 'long' })}`, v: `${formatPortalNumber(current?.water ?? 0)} m³`, d: settings.waterRate != null ? `${formatMoney(settings.waterRate, currency)}/m³` : translatePortalText('no tariff set'), i: '💧' },
          { l: translatePortalText('Awaiting invoice'), v: formatMoney((unbilled.electricity?.amount ?? 0) + (unbilled.water?.amount ?? 0), currency), d: translatePortalText(`${(unbilled.electricity?.count ?? 0) + (unbilled.water?.count ?? 0)} reading(s)`), i: '🧾' },
        ].map((k, i) => (
          <motion.div key={k.l} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }} className="card p-5">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">{k.i} {translatePortalText(k.l)}</p>
            {/* No figure until the server has answered — a failed load is not "0 kWh". */}
            <p className="mt-1 font-display text-2xl font-extrabold text-deep-900">{state.data ? k.v : '—'}</p>
            <p className="text-xs font-bold text-slate-400">{k.d}</p>
          </motion.div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title={translatePortalText("Consumption trend")} sub="Electricity (kWh) & water (m³) — from logged readings">
          {state.loading && !state.data ? <LoadingState label="Loading usage…" rows={3} /> : state.error && !state.data ? (
            <EmptyState icon="⚠️" text="Usage could not be loaded." />
          ) : monthly.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="m" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                {/* The shared ChartTip prints anything over 500 as money — kWh are not riyals. */}
                <Tooltip content={<UsageTip />} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="kwh" name={translatePortalText('Electricity (kWh)')} stroke={C.s1} strokeWidth={2.5} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="water" name={translatePortalText('Water (m³)')} stroke={C.s2} strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : <EmptyState icon="⚡" text="No readings logged yet" />}
        </Section>

        <Section title={translatePortalText("Live meter readings")} sub="This billing cycle (not yet invoiced), per berth"
          actions={<button className="btn-ghost !py-1.5 !px-3 text-xs" disabled={state.loading} onClick={() => state.reload()}><Gauge size={13} /> {translatePortalText("Refresh meters")}</button>}>
          {state.loading && !state.data ? <LoadingState label="Reading meters…" rows={3} /> : state.error && !state.data ? (
            <EmptyState icon="⚠️" text="Meter readings could not be loaded." />
          ) : meters.length === 0 ? (
            <EmptyState icon="⚡" text={hasAnyReadings ? 'Every reading has been invoiced — nothing open this cycle.' : 'No meter readings yet — log one to start billing utilities.'} />
          ) : (
            <div className="overflow-x-auto custom-scrollbar">
              {unbilledTotal > readings.length && (
                <p className="mb-2 text-[11px] font-semibold text-amber-700">
                  {translatePortalText(`Built from the newest ${readings.length} of ${unbilledTotal} unbilled readings — the Awaiting invoice total above covers all of them.`)}
                </p>
              )}
              <table className="w-full min-w-[600px]">
                <thead><tr className="border-b border-slate-100"><th className="th">{translatePortalText("Berth")}</th><th className="th">{translatePortalText("Vessel")}</th><th className="th">{translatePortalText("kWh")}</th><th className="th">{translatePortalText("Water m³")}</th><th className="th text-right">{translatePortalText("Unbilled")}</th></tr></thead>
                <tbody>
                  {meters.map(m => (
                    <tr key={m.key} className="border-b border-slate-50 transition hover:bg-sand">
                      <td className="td font-extrabold">{m.berth}</td>
                      <td className="td max-w-[200px] truncate">⛵ {m.boat}</td>
                      <td className="td">{formatPortalNumber(m.kwh)}</td>
                      <td className="td">{formatPortalNumber(m.water)}</td>
                      <td className="td text-right">
                        <span className="font-display font-extrabold">{formatMoney(m.charge, currency)}</span>
                        {m.charge > 0 && m.subscription && (
                          <button className="ms-2 rounded-lg bg-ocean-50 px-2 py-1 text-[10px] font-bold text-ocean-700 hover:bg-ocean-100 disabled:opacity-50"
                            disabled={busy} onClick={() => billAll(m.subscription!, m.boat)}>{translatePortalText("Invoice")}</button>
                        )}
                        {/* The server bills per reservation; readings on no lease have nobody to invoice. */}
                        {m.charge > 0 && !m.subscription && (
                          <span className="ms-2 text-[10px] font-bold text-slate-400" title={translatePortalText('These readings are not linked to a reservation, so there is nobody to bill')}>
                            {translatePortalText('No holder to bill')}
                          </span>
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
    if (busy) return
    if (current === '') { toast(translatePortalText('Enter the current meter reading'), 'warn'); return }
    // The server refuses these too; checking here keeps the typed values on screen.
    const cur = Number(current), prev = previous === '' ? null : Number(previous), unit = rate === '' ? null : Number(rate)
    if (!Number.isFinite(cur) || cur < 0) { toast(translatePortalText('Meter readings cannot be negative'), 'warn'); return }
    if (prev != null && (!Number.isFinite(prev) || prev < 0)) { toast(translatePortalText('Meter readings cannot be negative'), 'warn'); return }
    if (prev != null && cur < prev) { toast(translatePortalText('The current reading cannot be below the previous one'), 'warn'); return }
    if (unit != null && (!Number.isFinite(unit) || unit < 0)) { toast(translatePortalText('The rate cannot be negative'), 'warn'); return }
    if (unit == null && defaultRate == null) { toast(translatePortalText('Enter a rate, or set a tariff in Settings first'), 'warn'); return }
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

  // The API sorts by `status` alphabetically, so "done" comes first: one
  // 100-row page filled up with finished jobs and open ones fell off the board.
  // Live columns and the Done column are fetched separately.
  const state = useAsync(async () => {
    const [live, done] = await Promise.all([
      workOrdersApi.list({ status: 'open,scheduled,in_progress', limit: 100 }).then(r => r.data),
      workOrdersApi.list({ status: 'done', limit: 50 }).then(r => r.data),
    ])
    return { items: [...live.items, ...done.items], statusCounts: live.statusCounts }
  }, [])
  const staff = useAsync(() => portalApi.staff().then(r => r.data), [])
  const berths = useAsync(() => portalApi.berthMap().then(r => r.data), [])
  const orders = state.data?.items ?? []
  const statusCounts = state.data?.statusCounts ?? {}

  const refresh = async () => { await state.reload(); await berths.reload(); await reloadOverview() }

  const advance = async (w: ApiWorkOrder) => {
    if (busyId) return
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
                  {/* The server's whole-marina count, not just the rows on this board. */}
                  {translatePortalText(col.label)} <span className="rounded-full bg-white px-2 py-0.5 ring-1 ring-slate-200">{formatPortalNumber(statusCounts[col.status] ?? orders.filter(o => o.status === col.status).length)}</span>
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
                            {/* Badge translates itself and picks its tone from the English label. */}
                            <Badge>{PRIORITY_LABEL[w.priority] ?? humanize(w.priority)}</Badge>
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
    if (busy) return
    // Mirrors createWorkOrderSchema: title 2–200, asset 1–200, cost ≥ 0.
    if (f.title.trim().length < 2) { toast(translatePortalText('Give the work order a title'), 'warn'); return }
    if (!f.asset.trim()) { toast(translatePortalText('Name the asset it applies to'), 'warn'); return }
    if (f.cost !== '' && (!Number.isFinite(Number(f.cost)) || Number(f.cost) < 0)) { toast(translatePortalText('The cost cannot be negative'), 'warn'); return }
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
        <div><label className="label">{translatePortalText("Title")}</label><input className="input" maxLength={200} placeholder={translatePortalText("e.g. Replace cleat on A-05")} value={f.title} onChange={e => setF(s => ({ ...s, title: e.target.value }))} /></div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="label">{translatePortalText("Asset")}</label><input className="input" maxLength={200} placeholder={translatePortalText("Berth / dock / equipment")} value={f.asset} onChange={e => setF(s => ({ ...s, asset: e.target.value }))} /></div>
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
/**
 * The list endpoint returns the raw `payment` ref (not in `ApiServiceBooking`).
 * The server refuses "completed" until it is set — see `updateServiceBookingStatus`.
 */
const isPaid = (b: ApiServiceBooking) => !!(b as ApiServiceBooking & { payment?: unknown }).payment

const DESK_METHOD_LABEL = {
  cash: 'Cash',
  mada: 'mada card',
  visa: 'Visa',
  mastercard: 'Mastercard',
  bank_transfer: 'Bank transfer',
} as const

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
    const id = idOf(b)
    if (!id || busyId) return
    setBusyId(id)
    try {
      await servicesApi.setBookingStatus(id, next)
      toast(translatePortalText(msg))
      await refresh()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not update the request'), 'warn')
    } finally { setBusyId(null) }
  }

  // Declining cancels the boater's booking, so it asks first. A paid request is
  // not refunded by this call (`updateServiceBookingStatus` only flips status).
  /*
   * A payment taken at the desk. The board could not complete an unpaid request
   * (the server refuses "completed" before payment) and had no way to record
   * one, so desk-paid requests were stuck on "Awaiting payment" for ever.
   */
  type DeskMethod = 'cash' | 'bank_transfer' | 'mada' | 'visa' | 'mastercard'
  const [payMethod, setPayMethod] = useState<Record<string, DeskMethod>>({})
  const recordPayment = (b: ApiServiceBooking, name: string) => {
    const method: DeskMethod = payMethod[idOf(b)] ?? 'cash'
    return confirmAndRun({
      title: `Record payment for ${name}?`,
      body: `Marks the request as paid at the desk (${translatePortalText(DESK_METHOD_LABEL[method])}). Only do this once the money has been received — it then counts in your revenue and the request can be completed.`,
      confirmLabel: 'Record payment',
      busyLabel: 'Saving…',
      run: async () => {
        await servicesApi.recordPayment(idOf(b), method)
        await refresh()
      },
      success: 'Payment recorded',
    })
  }

  const decline = (b: ApiServiceBooking, name: string) =>
    confirmAndRun({
      title: `Decline ${name}?`,
      // The server now notifies the boater with this reason, and refunds a paid
      // request automatically (96%, the card fee is not returned).
      body: isPaid(b)
        ? 'The request is cancelled and cannot be reopened. It is already paid, so the boater is refunded automatically (96% — the card fee is not returned) and told your reason.'
        : 'The request is cancelled and cannot be reopened. The boater is notified with your reason.',
      input: { label: 'Reason for the boater', placeholder: 'e.g. Fully booked that day — please pick another time', required: true, multiline: true, maxLength: 500, validate: (v) => (v.trim().length < 3 ? 'At least 3 characters' : null) },
      confirmLabel: 'Decline request',
      busyLabel: 'Declining...',
      danger: true,
      run: async (reason) => {
        await servicesApi.setBookingStatus(idOf(b), 'cancelled', (reason || '').trim())
        await refresh()
      },
      success: 'Request declined',
      error: 'Could not decline the request. Please try again.',
    })

  // Switching a service off hides it from new orders; requests already placed
  // stay open, so say how many before doing it.
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const setAvailable = async (s: ApiMarinaService, v: boolean) => {
    const id = idOf(s)
    if (!id || togglingId) return
    const name = localizedField<string>(s, 'name') ?? s.name
    const openCount = reqs.filter(r => (r.status === 'pending' || r.status === 'confirmed') && idOf(r.service) === id).length
    const apply = async () => {
      setTogglingId(id)
      try {
        await servicesApi.update(id, { isAvailable: v })
        await refresh()
      } finally { setTogglingId(null) }
    }
    if (!v && openCount > 0) {
      await confirmAndRun({
        title: `Switch off ${name}?`,
        body: `Boaters can no longer order it. The ${openCount} open request(s) for it stay on your board — accept or decline them as usual.`,
        confirmLabel: 'Switch off',
        busyLabel: 'Saving...',
        run: apply,
        success: `${name} switched off`,
        error: 'Could not update the service. Please try again.',
      })
      return
    }
    try {
      await apply()
      toast(`${name} ${translatePortalText(v ? 'switched on' : 'switched off')}`, v ? 'success' : 'warn')
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not update the service'), 'warn')
    }
  }

  return (
    <div>
      <PageHeader title={translatePortalText("Marina Service Requests")} icon={<ConciergeBell className="text-ocean-500" />}
        sub="Guest requests from the BoatPro app — accept, track, complete & invoice"
        actions={<>
          <button className="btn-primary" onClick={() => setAddingService(true)}><Plus size={15} /> {translatePortalText("Add service")}</button>
          <SearchInput value={q} onChange={setQ} placeholder={translatePortalText("Search requests…")} />
        </>} />

      {/* Whole-marina figures from the server; a dash until it has answered. */}
      <div className="mb-5 flex flex-wrap gap-3">
        {[...SVC_FLOW, 'cancelled' as const].map(s => (
          <div key={s} className="card flex items-center gap-2 px-4 py-2.5">
            <Badge>{SVC_LABEL[s]}</Badge><span className="font-display font-extrabold text-deep-900">{state.data ? formatPortalNumber(counts[s] ?? 0) : '—'}</span>
          </div>
        ))}
        {/* Was labelled "Revenue", but the server sums every non-cancelled request,
            unpaid and unaccepted ones included — it is booked value, not money in. */}
        <div className="card flex items-center gap-2 px-4 py-2.5" title={translatePortalText('New, accepted and completed requests, paid or not')}>
          <span className="chip bg-slate-100 text-slate-600">{translatePortalText("Booked value")}</span>
          <span className="font-display font-extrabold text-deep-900">{state.data ? formatMoney(state.data.revenue ?? 0, currency) : '—'}</span>
        </div>
        {/* Money actually in: paid bookings after refunds (newer servers send it). */}
        {(state.data as { paidRevenue?: number } | null)?.paidRevenue != null && (
          <div className="card flex items-center gap-2 px-4 py-2.5" title={translatePortalText('Paid requests, after refunds')}>
            <span className="chip bg-emerald-50 text-emerald-700">{translatePortalText('Paid')}</span>
            <span className="font-display font-extrabold text-deep-900">{formatMoney((state.data as { paidRevenue?: number }).paidRevenue ?? 0, currency)}</span>
          </div>
        )}
      </div>
      {state.data && state.data.pagination.total > reqs.length && (
        <p className="mb-3 text-xs font-semibold text-amber-700">
          {translatePortalText(`Showing the newest ${reqs.length} of ${state.data.pagination.total} requests — search covers these only.`)}
        </p>
      )}

      <AsyncBlock state={state} loadingLabel="Loading service requests…">
        {() => (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {rows.map((r, i) => {
              const svc = typeof r.service === 'object' && r.service ? r.service : null
              const who = personOf(r.customer)
              const next = SVC_FLOW[SVC_FLOW.indexOf(r.status) + 1]
              const rid = idOf(r)
              const paid = isPaid(r)
              const svcName = svc ? localizedField<string>(svc, 'name') ?? svc.name : translatePortalText('Request')
              return (
                <motion.div key={rid || i} layout initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.05, 0.4) }} className="card card-hover p-5">
                  <div className="flex items-start gap-3">
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-ocean-50 text-2xl">{SVC_ICON[svc?.category ?? ''] ?? '🛎️'}</span>
                    <div className="min-w-0 flex-1">
                      <p className="break-words font-display font-bold text-deep-900">{svc ? localizedField<string>(svc, 'name') ?? svc.name : translatePortalText('Service')}</p>
                      {/* A deleted account comes back unpopulated — say so rather than "Guest". */}
                      <p className="truncate text-xs text-slate-400">{svc ? translatePortalText(humanize(svc.category)) : ''} · {who?.name ?? translatePortalText(r.customer ? 'Guest' : 'Deleted account')}</p>
                    </div>
                  <Badge dot={r.status === 'confirmed'}>{SVC_LABEL[r.status]}</Badge>
                  </div>
                  {r.notes && <p className="mt-3 break-words rounded-xl bg-sand px-3 py-2 text-xs text-slate-500">{r.notes}</p>}
                  <div className="mt-3 flex items-center justify-between text-xs">
                    <span className="text-slate-400">🕐 {r.startAt ? fmtDate(r.startAt) : fmtRelative(r.createdAt)}</span>
                    <span className="flex items-center gap-2">
                      {r.status !== 'cancelled' && <Badge>{paid ? 'Paid' : 'Unpaid'}</Badge>}
                      <span className="font-display text-base font-extrabold text-deep-900">{r.amount > 0 ? formatMoney(r.amount, currency) : translatePortalText('Free')}</span>
                    </span>
                  </div>
                  <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
                    {who?.phone
                      ? <a href={`tel:${who.phone}`} className="flex items-center gap-1.5 text-xs font-bold text-deep-800"><UserPlus size={13} className="text-slate-400" />{who.phone}</a>
                      : <span className="truncate text-xs text-slate-400">{who?.email ?? ''}</span>}
                    {r.status === 'pending' && (
                      <>
                        <button className="btn-primary ms-auto !py-1.5 !px-3 text-xs" disabled={!!busyId}
                          onClick={() => patch(r, 'confirmed', `${svcName} ${translatePortalText('accepted')}`)}>{translatePortalText(busyId === rid ? 'Saving…' : '✓ Accept')}</button>
                        <button className="btn-ghost !py-1.5 !px-2.5 text-xs hover:!bg-rose-50 hover:text-rose-600" disabled={!!busyId}
                          title={translatePortalText('Decline request')} onClick={() => decline(r, svcName)}>✕</button>
                      </>
                    )}
                    {/* The server refuses "completed" until the booking is paid, so the
                        button waits for the payment instead of failing on click. */}
                    {r.status === 'confirmed' && next && paid && (
                      <button className="btn-primary ms-auto !py-1.5 !px-3 text-xs" disabled={!!busyId}
                        onClick={() => patch(r, next, `${svcName} → ${translatePortalText(SVC_LABEL[next])}`)}>{translatePortalText(busyId === rid ? 'Saving…' : '✓ Complete')}</button>
                    )}
                    {r.status === 'confirmed' && next && !paid && (
                      <span className="ms-auto flex items-center gap-1.5" title={translatePortalText('This booking must be paid before it can be marked completed')}>
                        <select className="input !h-8 !w-auto !py-0 text-xs" aria-label={translatePortalText('Payment method')}
                          value={payMethod[rid] ?? 'cash'} disabled={!!busyId}
                          onChange={e => setPayMethod(m => ({ ...m, [rid]: e.target.value as DeskMethod }))}>
                          {(Object.keys(DESK_METHOD_LABEL) as DeskMethod[]).map(k => <option key={k} value={k}>{translatePortalText(DESK_METHOD_LABEL[k])}</option>)}
                        </select>
                        <button className="btn-ghost !py-1.5 !px-3 text-xs" disabled={!!busyId}
                          onClick={() => recordPayment(r, svcName)}>{translatePortalText('Record payment')}</button>
                      </span>
                    )}
                    {r.status === 'completed' && (
                      <span className="ms-auto text-[11px] font-bold text-emerald-600">{translatePortalText(paid ? '● Paid & completed' : '● Completed')}</span>
                    )}
                  </div>
                </motion.div>
              )
            })}
            {rows.length === 0 && (
              <div className="card md:col-span-2 lg:col-span-3">
                {/* Neither mobile app calls POST /marina-services/book yet, so no promise
                    here that adding services brings orders in. */}
                <EmptyState icon="🛎️" text={q ? 'No matching requests.' : 'No service requests yet.'} />
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
            {catalogue.map((s, i) => (
              <div key={idOf(s) || i} className={`flex items-center gap-3 rounded-2xl border border-slate-100 p-3 ${togglingId === idOf(s) ? 'animate-pulse' : ''}`}>
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sand text-lg">{SVC_ICON[s.category] ?? '🛎️'}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-deep-900" title={localizedField<string>(s, 'name') ?? s.name}>{localizedField<string>(s, 'name') ?? s.name}</p>
                  <p className="truncate text-[11px] text-slate-400">{translatePortalText(humanize(s.category))} · {translatePortalText(humanize(s.pricingUnit))}</p>
                </div>
                <span className="font-display font-extrabold text-deep-900">{s.price > 0 ? formatMoney(s.price, currency) : translatePortalText('Free')}</span>
                {/* `s.id` came from the translation layer; `idOf` reads `_id` too. */}
                <Toggle on={s.isAvailable} onChange={v => void setAvailable(s, v)} />
              </div>
            ))}
          </div>
        )}
      </Section>

      <AddServiceModal open={addingService} onClose={() => setAddingService(false)} onDone={refresh} marinaId={marina?.id} currency={currency}
        existingNames={catalogue.map(s => canonicalField<string>(s, 'name') ?? s.name)} />
    </div>
  )
}

const SERVICE_CATEGORIES = [
  'lounge', 'washroom', 'prayer_room', 'parking', 'maintenance', 'boat_cleaning', 'boat_washing',
  'electricity', 'water_supply', 'waste_disposal', 'ice_supply', 'internet', 'security',
] as const

function AddServiceModal({ open, onClose, onDone, marinaId, currency, existingNames }: {
  open: boolean; onClose: () => void; onDone: () => Promise<void>; marinaId?: string; currency: string; existingNames: string[]
}) {
  const [busy, setBusy] = useState(false)
  const [f, setF] = useState({ name: '', category: 'boat_cleaning', price: '', pricingUnit: 'per_use', description: '' })

  const submit = async () => {
    if (busy) return
    if (!marinaId) { toast(translatePortalText('Your marina is still loading'), 'warn'); return }
    if (!f.name.trim() || f.price === '') { toast(translatePortalText('Name and price are required'), 'warn'); return }
    // Mirrors createMarinaServiceSchema (name 2–150, price ≥ 0) so the form keeps
    // what was typed instead of bouncing off a 400.
    if (f.name.trim().length < 2) { toast(translatePortalText('The name needs at least 2 characters'), 'warn'); return }
    const price = Number(f.price)
    if (!Number.isFinite(price) || price < 0) { toast(translatePortalText('The price cannot be negative'), 'warn'); return }
    // Nothing server-side stops a second "Hull wash"; boaters would see both.
    const dup = existingNames.some(n => n.trim().toLowerCase() === f.name.trim().toLowerCase())
    if (dup) { toast(translatePortalText('A service with that name is already on your list'), 'warn'); return }
    setBusy(true)
    try {
      await servicesApi.create({
        marinaId, name: f.name.trim(), category: f.category, price,
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
        <div><label className="label">{translatePortalText("Name")}</label><input className="input" maxLength={150} value={f.name} onChange={e => setF(s => ({ ...s, name: e.target.value }))} placeholder={translatePortalText("Hull wash & deck detail")} /></div>
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
        <div><label className="label">{translatePortalText('Price')} ({currency})</label><input type="number" min={0} step="0.01" className="input" value={f.price} onChange={e => setF(s => ({ ...s, price: e.target.value }))} />
          <p className="mt-1 text-[11px] text-slate-400">{translatePortalText('0 lists it as free. VAT is added at booking.')}</p></div>
        <div><label className="label">{translatePortalText("Description")}</label><textarea className="input min-h-[70px]" maxLength={2000} value={f.description} onChange={e => setF(s => ({ ...s, description: e.target.value }))} /></div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>{translatePortalText("Cancel")}</button>
          <button className="btn-primary" disabled={busy} onClick={submit}>{translatePortalText(busy ? 'Adding…' : 'Add service')}</button>
      </div>
    </Modal>
  )
}
