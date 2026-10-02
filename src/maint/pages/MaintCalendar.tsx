import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { CalendarDays, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { maintToast, MaintHeader } from '../maintUi'
import { Modal } from '../../ui'
import {
  maintenancePortalApi,
  type MaintenanceInspection,
  type MaintenanceInvoice,
  type MaintenanceWorkOrder,
} from '../../api'
import { formatPortalDate, formatPortalNumber, isPortalArabic, localizedField, translatePortalTemplate, translatePortalText } from '../../i18n/runtime'

/**
 * The workshop's schedule.
 *
 * The previous version drew a convincing calendar over broken date maths:
 *
 *   - `day: date.getDate()` kept only the day-of-month and discarded the month
 *     and year, so a work order due in March landed in the same cell as one due
 *     in July. Every month of the workshop's history was piled onto one grid,
 *     and a technician reading their week saw jobs that were nowhere near it.
 *   - `const first = 3 // July 1 2026 = Wednesday` and a fixed 31 cells froze
 *     the grid to one month, with "July 2026" in the subtitle, the event dialog
 *     and the add-event form.
 *   - `const today = d === 17` pinned the TODAY marker to the 17th.
 *   - The heatmap's own comment read "Just for visual effect if no real hours
 *     exist": `displayHrs = hrs > 0 ? hrs : (events.some(...) ? 2 : 0)`, and
 *     the tooltip then reported "2 technician hours scheduled" for a day with
 *     none. Capacity planning off invented hours is how a workshop
 *     double-books itself.
 *   - Four of the five filter kinds — preventive, inspection, shift, parts —
 *     had no source at all, so they could only ever match nothing.
 *   - "Adding" an event pushed it into local state and toasted success; it
 *     vanished on the next reload.
 *
 * Now every cell is keyed on a full date, the month can be moved, and the three
 * dated things the workshop actually records — work orders, inspections and
 * invoice due dates — are what appears. The hours strip sums real
 * `estimatedHours` for the visible month and shows nothing when there are none.
 */

type EventKind = 'workorder' | 'inspection' | 'invoice'

interface MaintCalEvent {
  /** Local `YYYY-MM-DD`. */
  dateKey: string
  kind: EventKind
  label: string
  detail: string
  /** Scheduled technician hours, for the capacity strip. Work orders only. */
  hours?: number
}

const KIND_STYLE: Record<EventKind, string> = {
  workorder: 'bg-violet-50 text-violet-700 ring-violet-200',
  inspection: 'bg-amber-50 text-amber-700 ring-amber-200',
  invoice: 'bg-rose-50 text-rose-600 ring-rose-200',
}
const KIND_ICON: Record<EventKind, string> = { workorder: '🔧', inspection: '📋', invoice: '🧾' }
const KIND_LABEL: Record<EventKind, string> = {
  workorder: 'Work order',
  inspection: 'Inspection',
  invoice: 'Invoice due',
}
const statusText = (value: string) => translatePortalText(value.replace(/[_-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()))


/** Local `YYYY-MM-DD`. Not `toISOString`, which shifts the day by the UTC offset. */
function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate()
/** Monday-based column (0 = Monday) for the 1st. */
const firstColumn = (y: number, m: number) => (new Date(y, m, 1).getDay() + 6) % 7

export default function MaintCalendar() {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [filters, setFilters] = useState<Record<EventKind, boolean>>({
    workorder: true,
    inspection: true,
    invoice: true,
  })
  const [selected, setSelected] = useState<MaintCalEvent | null>(null)
  const [workOrders, setWorkOrders] = useState<MaintenanceWorkOrder[]>([])
  const [inspections, setInspections] = useState<MaintenanceInspection[]>([])
  const [invoices, setInvoices] = useState<MaintenanceInvoice[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Fetched once for every month rather than per view, so paging the
      // calendar back and forth costs nothing.
      const [wo, insp, inv] = await Promise.all([
        maintenancePortalApi.workOrders({ limit: 200 }),
        maintenancePortalApi.inspections({ limit: 200 }),
        maintenancePortalApi.invoices({ limit: 200 }),
      ])
      setWorkOrders(wo.data.items || [])
      setInspections(insp.data.items || [])
      setInvoices(inv.data.items || [])
    } catch (err) {
      maintToast(err instanceof Error ? err.message : 'Could not load the schedule', 'warn')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /** Everything dated, keyed by full day, for the month on screen. */
  const events = useMemo(() => {
    const all: MaintCalEvent[] = []
    const inThisMonth = (raw?: string) => {
      if (!raw) return null
      const d = new Date(raw)
      if (Number.isNaN(d.valueOf())) return null
      // The month and year are checked, not just the day — this is exactly what
      // the previous `date.getDate()` keying threw away.
      if (d.getFullYear() !== year || d.getMonth() !== month) return null
      return d
    }

    for (const wo of workOrders) {
      const d = inThisMonth(wo.scheduledFor || wo.dueDate)
      if (!d) continue
      all.push({
        dateKey: dateKey(d),
        kind: 'workorder',
        label: `${translatePortalText('Work order')} #${wo.code || wo.id.slice(-4)} — ${wo.boatName}`,
        detail: isPortalArabic()
          ? `${localizedField(wo, 'title') ?? wo.title} · ${wo.technician?.name ? `الفني المكلّف: ${wo.technician.name}` : 'غير مُسنَد'} · الأولوية: ${translatePortalText(wo.priority)} · الحالة: ${statusText(wo.status)}. الساعات المقدّرة: ${formatPortalNumber(wo.estimatedHours || 0)}، وساعات العمل: ${formatPortalNumber(wo.workedHours || 0)}.`
          : `${localizedField(wo, 'title') ?? wo.title}${wo.technician?.name ? ` · assigned to ${wo.technician.name}` : ' · unassigned'} · ${wo.priority} priority · ${statusText(wo.status)}. ${formatPortalNumber(wo.estimatedHours || 0)}h estimated, ${formatPortalNumber(wo.workedHours || 0)}h worked.`,
        hours: wo.estimatedHours || 0,
      })
    }

    for (const ins of inspections) {
      const d = inThisMonth(ins.performedAt || ins.createdAt)
      if (!d) continue
      all.push({
        dateKey: dateKey(d),
        kind: 'inspection',
        label: `${localizedField(ins, 'type') ?? translatePortalText(ins.type)} — ${ins.boatName}`,
        detail: isPortalArabic()
          ? `فحص ${localizedField(ins, 'type') ?? translatePortalText(ins.type)} للقارب ${ins.boatName}، ${statusText(ins.status)}${ins.technician?.name ? ` · الفني: ${ins.technician.name}` : ''}${ins.score != null ? ` · النتيجة: ${formatPortalNumber(ins.score)}` : ''}.`
          : `${localizedField(ins, 'type') ?? translatePortalText(ins.type)} inspection of ${ins.boatName}, ${statusText(ins.status)}${ins.technician?.name ? ` · ${ins.technician.name}` : ''}${ins.score != null ? ` · scored ${formatPortalNumber(ins.score)}` : ''}.`,
      })
    }

    for (const inv of invoices) {
      const d = inThisMonth(inv.dueDate)
      if (!d) continue
      all.push({
        dateKey: dateKey(d),
        kind: 'invoice',
        label: `${translatePortalText('Invoice')} ${inv.code} — ${inv.customerName}`,
        detail: isPortalArabic()
          ? `فاتورة ${inv.code} للقارب ${inv.boatName} مستحقة السداد. الإجمالي: ${formatPortalNumber(inv.total)}، والحالة: ${statusText(inv.status)}.`
          : `Invoice ${inv.code} for ${inv.boatName} falls due. ${formatPortalNumber(inv.total)} total, currently ${statusText(inv.status)}.`,
      })
    }

    const byDay = new Map<string, MaintCalEvent[]>()
    for (const e of all) {
      if (!filters[e.kind]) continue
      const list = byDay.get(e.dateKey) ?? []
      list.push(e)
      byDay.set(e.dateKey, list)
    }
    return byDay
  }, [workOrders, inspections, invoices, year, month, filters])

  const total = daysInMonth(year, month)
  const monthLabel = formatPortalDate(new Date(year, month, 1), { month: 'long' })
  const lead = firstColumn(year, month)
  const days = Array.from({ length: total }, (_, i) => i + 1)
  const todayKey = dateKey(today)

  const counts = useMemo(() => {
    const out: Record<EventKind, number> = { workorder: 0, inspection: 0, invoice: 0 }
    for (const list of events.values()) for (const e of list) out[e.kind]++
    return out
  }, [events])

  /** Real estimated hours per day, and the busiest day, for the capacity strip. */
  const hoursByDay = useMemo(() => {
    const out = new Map<string, number>()
    for (const [key, list] of events) {
      const h = list.reduce((sum, e) => sum + (e.hours ?? 0), 0)
      if (h > 0) out.set(key, h)
    }
    return out
  }, [events])
  const peakHours = Math.max(0, ...hoursByDay.values())

  const step = (delta: number) => {
    const d = new Date(year, month + delta, 1)
    setYear(d.getFullYear())
    setMonth(d.getMonth())
  }

  const eventTotal = Object.values(counts).reduce((a, b) => a + b, 0)

  return (
    <div className="space-y-5">
      <MaintHeader
        title={translatePortalText("Maintenance Calendar & Schedule")}
        sub="Work orders, inspections and invoice due dates — every date from live records"
        actions={
          <div className="flex items-center gap-1">
            <button className="btn-ghost !px-2" onClick={() => step(-1)} aria-label={translatePortalText("Previous month")}>
              <ChevronLeft size={16} className="rtl:rotate-180" />
            </button>
            <span className="min-w-[140px] text-center font-display text-sm font-extrabold text-deep-900">
              {monthLabel} {formatPortalNumber(year)}
            </span>
            <button className="btn-ghost !px-2" onClick={() => step(1)} aria-label={translatePortalText("Next month")}>
              <ChevronRight size={16} className="rtl:rotate-180" />
            </button>
            {(year !== today.getFullYear() || month !== today.getMonth()) && (
              <button
                className="btn-ghost !py-1.5 !px-3 !text-[11px]"
                onClick={() => {
                  setYear(today.getFullYear())
                  setMonth(today.getMonth())
                }}
              >
                {translatePortalText("Today")}
              </button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(filters) as EventKind[]).map(k => (
          <button
            key={k}
            onClick={() => setFilters(f => ({ ...f, [k]: !f[k] }))}
            aria-pressed={filters[k]}
            className={`chip ring-1 transition ${filters[k] ? KIND_STYLE[k] : 'bg-white text-slate-300 ring-slate-100'}`}
          >
            {KIND_ICON[k]} {translatePortalText(KIND_LABEL[k])} ({formatPortalNumber(counts[k])})
          </button>
        ))}
        {loading && (
          <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Loader2 size={12} className="animate-spin" /> {translatePortalText("Loading schedule…")}
          </span>
        )}
      </div>

      <div className="card overflow-x-auto p-4 shadow-soft">
        <div className="grid min-w-[820px] grid-cols-7 gap-2">
          {Array.from({ length: 7 }, (_, i) => formatPortalDate(new Date(2024, 0, i + 1), { weekday: 'short' })).map((d, i) => (
            <p key={i} className="pb-1 text-center text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
              {d}
            </p>
          ))}
          {Array.from({ length: lead }).map((_, i) => (
            <div key={`lead-${i}`} />
          ))}
          {days.map(d => {
            const key = dateKey(new Date(year, month, d))
            const evs = events.get(key) ?? []
            const isToday = key === todayKey
            return (
              <motion.div
                key={d}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: Math.min(d, 20) * 0.008 }}
                className={`min-h-[96px] rounded-2xl border p-2 transition hover:shadow-soft ${
                  isToday ? 'border-violet-400 bg-violet-50/60 ring-2 ring-violet-200' : 'border-slate-100 bg-white'
                }`}
              >
                <p className={`text-xs font-extrabold ${isToday ? 'text-violet-600' : 'text-slate-400'}`}>
                  {formatPortalNumber(d)}
                  {isToday && (
                    <span className="ms-1 rounded-full bg-violet-500 px-1.5 py-0.5 text-[9px] font-bold text-white">
                      {translatePortalText("TODAY")}
                    </span>
                  )}
                </p>
                <div className="mt-1 space-y-1">
                  {evs.slice(0, 3).map((e, i) => (
                    <button
                      key={i}
                      onClick={() => setSelected(e)}
                      className={`block w-full truncate rounded-md px-1.5 py-0.5 text-left text-[10px] font-bold ring-1 ${KIND_STYLE[e.kind]}`}
                    >
                      {KIND_ICON[e.kind]} {e.label}
                    </button>
                  ))}
                  {evs.length > 3 && <p className="text-[10px] font-bold text-slate-400">+{formatPortalNumber(evs.length - 3)} {translatePortalText("more")}</p>}
                </div>
              </motion.div>
            )
          })}
        </div>
      </div>

      {/*
        Scheduled technician hours, from `estimatedHours` on the work orders in
        this month and nothing else. The previous strip substituted a flat 2
        hours for any day that had an event but no hours — explicitly "just for
        visual effect" — and then labelled it as scheduled capacity.
      */}
      <div className="card space-y-3 p-5">
        <div>
          <h4 className="font-display text-base font-extrabold text-deep-900">{translatePortalText("Scheduled technician hours")}</h4>
          <p className="text-xs text-slate-400">
            {hoursByDay.size > 0
              ? translatePortalTemplate('Estimated hours per day across {{range}} — darker is busier.', { range: monthLabel })
              : translatePortalTemplate('No work orders in {{range}} carry an hours estimate.', { range: monthLabel })}
          </p>
        </div>
        {hoursByDay.size > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {days.map(d => {
              const key = dateKey(new Date(year, month, d))
              const hrs = hoursByDay.get(key) ?? 0
              // Scaled against the busiest day in view, so the shading means
              // something relative to this month rather than a fixed guess.
              const intensity = hrs > 0 && peakHours > 0 ? 0.15 + (hrs / peakHours) * 0.85 : 0
              return (
                <div
                  key={d}
                  title={
                    hrs > 0
                      ? `${formatPortalDate(new Date(year, month, d), { month: 'long', day: 'numeric' })} · ${formatPortalNumber(hrs)} ${hrs === 1 ? translatePortalText('technician hour scheduled') : translatePortalText('technician hours scheduled')}`
                      : `${formatPortalDate(new Date(year, month, d), { month: 'long', day: 'numeric' })} · ${translatePortalText('nothing scheduled')}`
                  }
                  className="grid h-10 w-10 place-items-center rounded-lg text-[10px] font-extrabold transition hover:scale-110"
                  style={{
                    background: hrs > 0 ? `rgba(139,92,246,${intensity})` : 'rgba(241,245,249,0.8)',
                    color: hrs > 0 ? 'white' : '#cbd5e1',
                  }}
                >
                  {formatPortalNumber(d)}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {!loading && eventTotal === 0 && (
        <p className="text-center text-xs text-slate-400">
          {translatePortalText("Nothing is scheduled in")} {monthLabel} {formatPortalNumber(year)}.
        </p>
      )}

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `${KIND_ICON[selected.kind]} ${translatePortalText(KIND_LABEL[selected.kind])}` : ''}
      >
        {selected && (
          <div className="space-y-4 text-sm">
            <div>
              <p className="font-display text-lg font-extrabold text-deep-900">{selected.label}</p>
              <p className="text-xs text-slate-400">
                {formatPortalDate(new Date(`${selected.dateKey}T00:00:00`), {
                  weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
                })}
              </p>
            </div>
            <span className={`chip ring-1 ${KIND_STYLE[selected.kind]}`}>
              {KIND_ICON[selected.kind]} {translatePortalText(KIND_LABEL[selected.kind])}
            </span>
            <p className="rounded-xl bg-sand p-3.5 text-xs leading-relaxed text-slate-600">{selected.detail}</p>
            <div className="flex justify-end pt-2">
              <button className="btn-maint text-xs" onClick={() => setSelected(null)}>
                {translatePortalText("Close")}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
