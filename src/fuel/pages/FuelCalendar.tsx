import React, { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { CalendarDays, Plus } from 'lucide-react'
import { FuelHeader } from '../fuelUi'
import { fuelApi, type ApiFuelCalendarEvent, type ApiScheduledEvent, type FuelEventKind } from '../fuelApi'
import { useFuelResource } from '../fuelStore'
import { Modal, LoadingState, ErrorState, toast } from '../../ui'
import { formatPortalNumber, isPortalArabic, portalLocale, portalWeekdayLabels, translatePortalText } from '../../i18n/runtime'

/**
 * Derived event kinds (order, delivery, refill, calibration, licence) share the
 * five visual buckets the filter chips expose, so both sources render alike.
 */
const KIND_BUCKET: Record<string, FuelEventKind> = {
  barge: 'barge',
  truck: 'truck',
  refill: 'refill',
  pricing: 'pricing',
  maintenance: 'maintenance',
  order: 'barge',
  delivery: 'truck',
  calibration: 'maintenance',
  licence: 'maintenance',
}

const KIND_STYLE: Record<FuelEventKind, string> = {
  barge: 'bg-ocean-50 text-ocean-700 ring-ocean-200',
  truck: 'bg-amber-50 text-amber-700 ring-amber-200',
  refill: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  pricing: 'bg-violet-50 text-violet-700 ring-violet-200',
  maintenance: 'bg-rose-50 text-rose-600 ring-rose-200',
}

const KIND_ICON: Record<FuelEventKind, string> = {
  barge: '⛽', truck: '🚚', refill: '🛢️', pricing: '🏷️', maintenance: '🔧',
}

/**
 * What each bucket holds. The stored kind names are historical: `barge` is
 * where fuel orders land, and `truck` only holds dispatch runs from when fuel
 * was still delivered to boats — fuel is served at the station only now, so
 * nothing new is filed there.
 */
const KIND_LABEL: Record<FuelEventKind, string> = {
  barge: 'Fuel orders', truck: 'Past dispatches', refill: 'Tank refills', pricing: 'Price changes', maintenance: 'Maintenance',
}

interface CalCell {
  day: number
  bucket: FuelEventKind
  label: string
  source: ApiFuelCalendarEvent
}

export default function FuelCalendar() {
  const now = new Date()
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  const [filters, setFilters] = useState<Record<FuelEventKind, boolean>>({
    barge: true, truck: true, refill: true, pricing: true, maintenance: true,
  })
  const [selectedEvent, setSelectedEvent] = useState<CalCell | null>(null)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<{ day: string; label: string; kind: FuelEventKind }>({ day: '', label: translatePortalText(""), kind: 'barge' })

  const res = useFuelResource(() => fuelApi.calendar(month).then(r => r.data), [month])

  const [year, monthIndex] = month.split('-').map(Number)
  const monthStart = new Date(year, monthIndex - 1, 1)
  const daysInMonth = new Date(year, monthIndex, 0).getDate()
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const weekdays = portalWeekdayLabels()
  // The grid runs Mon-first, so Sunday (0) belongs in the last column.
  const leading = (monthStart.getDay() + 6) % 7
  const isCurrentMonth = now.getFullYear() === year && now.getMonth() === monthIndex - 1
  const monthTitle = monthStart.toLocaleDateString(portalLocale(), { month: 'long', year: 'numeric' })

  const cells = useMemo<CalCell[]>(
    () => (res.data?.events ?? []).map(e => ({
      day: new Date(e.date).getDate(),
      bucket: KIND_BUCKET[e.kind] ?? 'maintenance',
      label: e.label,
      source: e,
    })),
    [res.data],
  )

  const demand = res.data?.demand ?? {}
  const peakDemand = Math.max(1, ...Object.values(demand))
  const scheduled = res.data?.scheduled ?? []

  const createEvent = async () => {
    const day = parseInt(form.day, 10)
    if (!form.label.trim()) { toast(translatePortalText("Enter an event label"), 'warn'); return }
    if (!day || day < 1 || day > daysInMonth) { toast(translatePortalText(`Day must be between 1 and ${daysInMonth}`), 'warn'); return }
    setBusy(true)
    try {
      await fuelApi.createCalendarEvent({
        title: form.label.trim(),
        kind: form.kind,
        startsAt: new Date(year, monthIndex - 1, day, 9, 0).toISOString(),
      })
      setAdding(false)
      const label = form.label.trim()
      setForm({ day: '', label: translatePortalText(""), kind: 'barge' })
      await res.reload()
      toast(translatePortalText(`Added "${label}" on ${monthStart.toLocaleDateString(portalLocale(), { month: 'long' })} ${day}`))
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not schedule the event'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  /** Only hand-booked events can be removed; derived ones follow their record. */
  const removeSelected = async () => {
    const id = selectedEvent?.source.refId
    const owned = id && scheduled.some((s: ApiScheduledEvent) => s._id === id)
    if (!owned) { setSelectedEvent(null); return }
    setBusy(true)
    try {
      await fuelApi.deleteCalendarEvent(id!)
      setSelectedEvent(null)
      await res.reload()
      toast(translatePortalText("Event removed"), 'info')
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not remove the event'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  const shiftMonth = (delta: number) => {
    const d = new Date(year, monthIndex - 1 + delta, 1)
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  return (
    <div className="space-y-5">
      <FuelHeader
        title={translatePortalText("Fuel Station Calendar")}
        sub={translatePortalText(`${monthTitle} — fuel dock orders, tank refills, price changes & station maintenance`)}
        icon={<CalendarDays className="text-amber-500" />}
        actions={
          <>
            <button className="btn-ghost !px-3" aria-label={translatePortalText('Previous month')} title={translatePortalText('Previous month')} onClick={() => shiftMonth(-1)}>{isPortalArabic() ? '→' : '←'}</button>
            <button className="btn-ghost !px-3" aria-label={translatePortalText('Next month')} title={translatePortalText('Next month')} onClick={() => shiftMonth(1)}>{isPortalArabic() ? '←' : '→'}</button>
            <button className="btn-fuel" onClick={() => setAdding(true)}>
              <Plus size={16} />{translatePortalText(" Schedule event")}</button>
          </>
        }
      />

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        {(Object.keys(filters) as FuelEventKind[]).map(k => (
          <button
            key={k}
            onClick={() => setFilters(f => ({ ...f, [k]: !f[k] }))}
            className={`chip ring-1 capitalize transition ${filters[k] ? KIND_STYLE[k] : 'bg-white text-slate-300 ring-slate-100'}`}
          >
            {KIND_ICON[k]} {translatePortalText(KIND_LABEL[k])}
          </button>
        ))}
      </div>

      {res.error ? <ErrorState error={translatePortalText(res.error)} onRetry={() => void res.reload()} />
        : res.loading && !res.data ? <LoadingState label={translatePortalText("Loading the calendar…")} rows={5} /> : (<>
        {/* Monthly Grid */}
        <div className="card overflow-x-auto p-4 shadow-soft">
          <div className="grid min-w-[820px] grid-cols-7 gap-2">
            {weekdays.map((day, index) => (
              <p key={index} className="pb-1 text-center text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
                {day}
              </p>
            ))}
            {Array.from({ length: leading }).map((_, i) => (
              <div key={'e' + i} />
            ))}
            {days.map(d => {
              const evs = cells.filter(e => e.day === d && filters[e.bucket])
              const today = isCurrentMonth && d === now.getDate()
              return (
                <motion.div
                  key={d}
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: d * 0.008 }}
                  className={`min-h-[96px] rounded-2xl border p-2 transition hover:shadow-soft ${
                    today ? 'border-amber-400 bg-amber-50/60 ring-2 ring-amber-200' : 'border-slate-100 bg-white'
                  }`}
                >
                  <p className={`text-xs font-extrabold ${today ? 'text-amber-600' : 'text-slate-400'}`}>
                    {d}
                    {today && (
                      <span className="ms-1 rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-bold text-white">{translatePortalText("TODAY")}</span>
                    )}
                  </p>
                  <div className="mt-1 space-y-1">
                    {evs.slice(0, 3).map((e, i) => (
                      <p
                        key={i}
                        onClick={() => setSelectedEvent(e)}
                        className={`cursor-pointer truncate rounded-md px-1.5 py-0.5 text-[10px] font-bold ring-1 ${KIND_STYLE[e.bucket]}`}
                      >
                        {KIND_ICON[e.bucket]} {e.label}
                      </p>
                    ))}
                    {evs.length > 3 && (
                      <p className="text-[10px] font-bold text-slate-400">+{evs.length - 3}{translatePortalText(" more")}</p>
                    )}
                  </div>
                </motion.div>
              )
            })}
          </div>
        </div>

        {/* Demand Heatmap */}
        <div className="card p-5 space-y-3">
          <div>
            <h4 className="font-display text-base font-extrabold text-deep-900">{translatePortalText("Fuel Demand Volume")}</h4>
            <p className="text-xs text-slate-400">{translatePortalText("Actual daily volume dispensed for ")}{monthTitle}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {days.map(d => {
              const key = `${year}-${String(monthIndex).padStart(2, '0')}-${String(d).padStart(2, '0')}`
              const qty = demand[key] ?? 0
              return (
                <div
                  key={d}
                  title={translatePortalText(`${monthStart.toLocaleDateString(portalLocale(), { month: 'short' })} ${d} · ${qty.toLocaleString(portalLocale())} dispensed`)}
                  className={`grid h-10 w-10 place-items-center rounded-lg text-[10px] font-extrabold transition hover:scale-110 cursor-pointer ${qty ? 'text-white' : 'text-slate-400'}`}
                  style={{ background: qty ? `rgba(245,158,11,${0.3 + (qty / peakDemand) * 0.7})` : '#f1f5f9' }}
                >
                  {formatPortalNumber(d)}
                </div>
              )
            })}
          </div>
          <p className="text-xs text-slate-400">{translatePortalText("Darker amber = higher bunkering volume. Hover for daily totals.")}</p>
        </div>
      </>)}

      {/* Detail Modal */}
      <Modal open={!!selectedEvent} onClose={() => setSelectedEvent(null)} title={translatePortalText(`${selectedEvent ? KIND_ICON[selectedEvent.bucket] : ''} Event Details`)}>
        {selectedEvent && (
          <div className="space-y-4 text-sm">
            <div>
              <p className="font-display text-lg font-extrabold text-deep-900">{selectedEvent.label}</p>
              <p className="text-xs text-slate-400">{translatePortalText("Scheduled for ")}{new Date(selectedEvent.source.date).toLocaleDateString(portalLocale(), { month: 'long', day: 'numeric', year: 'numeric' })}
              </p>
            </div>
            <div>
              <span className={`chip ring-1 capitalize ${KIND_STYLE[selectedEvent.bucket]}`}>
                {KIND_ICON[selectedEvent.bucket]} {selectedEvent.source.kind}{translatePortalText(" event")}</span>
            </div>
            <div className="rounded-xl bg-sand p-3.5 text-xs text-slate-600 space-y-1">
              <p><b>{translatePortalText("Source:")}</b> {scheduled.some(s => s._id === selectedEvent.source.refId) ? translatePortalText("Manually scheduled") : translatePortalText("Derived from an operational record")}</p>
              <p><b>{translatePortalText("Status:")}</b> {selectedEvent.source.tone === 'success' ? translatePortalText("Completed") : selectedEvent.source.tone === 'danger' ? translatePortalText("Needs attention") : translatePortalText("Scheduled")}</p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              {scheduled.some(s => s._id === selectedEvent.source.refId) && (
                <button className="btn-ghost text-xs !text-rose-500" disabled={busy} onClick={removeSelected}>{translatePortalText("Remove")}</button>
              )}
              <button className="btn-fuel text-xs" onClick={() => setSelectedEvent(null)}>{translatePortalText("Close")}</button>
            </div>
          </div>
        )}
      </Modal>

      {/* Add Modal */}
      <Modal open={adding} onClose={() => setAdding(false)} title={translatePortalText("➕ Schedule Fuel Event")}>
        <div className="space-y-4 text-sm">
          <div>
            <label className="label">{translatePortalText("Event Title")}</label>
            <input
              type="text"
              className="input"
              value={form.label}
              onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
              placeholder={translatePortalText("e.g. Fleet fill-up at Dock B")}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{translatePortalText("Day (1-")}{formatPortalNumber(daysInMonth)})</label>
              <input
                type="number"
                min={1}
                max={daysInMonth}
                className="input"
                value={form.day}
                onChange={e => setForm(f => ({ ...f, day: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">{translatePortalText("Event Category")}</label>
              <select
                className="input"
                value={form.kind}
                onChange={e => setForm(f => ({ ...f, kind: e.target.value as FuelEventKind }))}
              >
                <option value="barge">{translatePortalText("⛽ Fuel dock booking")}</option>
                <option value="refill">{translatePortalText("🛢️ Tank Refill")}</option>
                <option value="pricing">{translatePortalText("🏷️ Price Change")}</option>
                <option value="maintenance">{translatePortalText("🔧 Station Maintenance")}</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-ghost text-xs" onClick={() => setAdding(false)}>{translatePortalText("Cancel")}</button>
            <button className="btn-fuel text-xs" disabled={busy} onClick={createEvent}>{translatePortalText("Create Event")}</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
