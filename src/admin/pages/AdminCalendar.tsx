import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { CalendarDays, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { AdminHeader } from '../adminUi'
import { Modal } from '../../ui'
import { documentsApi, monetizationApi, type ApiKycDocument, type MonetizationProvider } from '../../api'
import { errorMessage } from '../../async/errors'
import { formatPortalDate, formatPortalNumber, localizedField, translatePortalText, isPortalArabic } from '../../i18n/runtime'

/**
 * The platform's dated commitments.
 *
 * This page was a mockup end to end, and every part of it asserted something
 * false:
 *
 *   - Eight invented events were hardcoded — "Q3 Provider Billing Cycle
 *     Execution", "Summer Regatta Platform Ad Campaign", "Superyacht Charter
 *     Provider Onboarding" — none of which corresponded to anything the
 *     platform knew about.
 *   - The month was frozen: `const first = 3 // July 1 2026 = Wednesday`, a
 *     fixed 31 cells, and "July 2026" in the subtitle and in every dialog. Read
 *     in September, it showed the wrong month with the wrong weekday offset.
 *   - `const today = d === 17` put the TODAY marker on the 17th permanently.
 *   - A "Platform Transaction Volume" strip charted `450 + 350 *
 *     |sin(day * 1.6)|` — booking volumes from a sine wave, captioned "Daily
 *     gross booking traffic across all 4 verticals". An operator reading peak
 *     demand off that curve was reading trigonometry.
 *   - Adding an event pushed it into local state, so it vanished on reload
 *     while the toast said it had been created.
 *
 * What replaces it is the same idea sourced from real records: the dates the
 * platform is actually committed to. Three of them exist and are dated —
 * weekly payout runs, subscription renewals, and document expiries — so those
 * are what the grid shows, for whichever month is being viewed.
 *
 * There is no "add event": the platform has no calendar collection to store one
 * in, and a milestone that survives until the next refresh is worse than no
 * milestone at all. Everything here is derived, so it cannot drift from the
 * records it describes.
 */

type EventKind = 'payout' | 'renewal' | 'kyc'

interface CalEvent {
  /** Local date key, `YYYY-MM-DD`. */
  dateKey: string
  kind: EventKind
  label: string
  /** What the event is about, shown when it is opened. */
  detail: string
}

const KIND_STYLE: Record<EventKind, string> = {
  payout: 'bg-violet-50 text-violet-700 ring-violet-200',
  renewal: 'bg-amber-50 text-amber-700 ring-amber-200',
  kyc: 'bg-ocean-50 text-ocean-700 ring-ocean-200',
}

const KIND_ICON: Record<EventKind, string> = { payout: '💳', renewal: '🔄', kyc: '🪪' }
const KIND_LABEL: Record<EventKind, string> = {
  payout: 'Payout run',
  renewal: 'Subscription renewal',
  kyc: 'Document expiry',
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** Local `YYYY-MM-DD` — never `toISOString`, which shifts the day by the UTC offset. */
function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Monday-based column index (0 = Monday) for the 1st of a month. */
function firstColumn(year: number, month: number): number {
  return (new Date(year, month, 1).getDay() + 6) % 7
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

/**
 * Every payout Monday inside a month.
 *
 * Mirrors `payout.service`: periods are Monday-to-Sunday weeks, and a week is
 * settled once it has closed. So the dates worth showing are the Mondays —
 * that is when a run can be prepared for the week just gone.
 */
function payoutMondays(year: number, month: number): CalEvent[] {
  const out: CalEvent[] = []
  const total = daysInMonth(year, month)
  for (let day = 1; day <= total; day++) {
    const d = new Date(year, month, day)
    if (d.getDay() !== 1) continue
    const covering = new Date(d)
    covering.setDate(covering.getDate() - 7)
    out.push({
      dateKey: dateKey(d),
      kind: 'payout',
      label: translatePortalText('Weekly payout run'),
      detail: `Settles the week of ${formatPortalDate(covering, { month: 'short', day: 'numeric' })} – ${formatPortalDate(new Date(covering.getTime() + 6 * 86_400_000), { month: 'short', day: 'numeric' })}. Transfers are sent manually and marked paid with the bank's receipt.`,
    })
  }
  return out
}

export default function AdminCalendar() {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [filters, setFilters] = useState<Record<EventKind, boolean>>({ payout: true, renewal: true, kyc: true })
  const [selected, setSelected] = useState<CalEvent | null>(null)
  const [providers, setProviders] = useState<MonetizationProvider[]>([])
  const [docs, setDocs] = useState<ApiKycDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Both lists are small and cover every month, so they are fetched once
      // rather than per month — paging back and forth stays instant.
      const [ov, dc] = await Promise.all([
        monetizationApi.overview(),
        documentsApi.all({ status: 'approved', limit: 500 }),
      ])
      setProviders(ov.data.providers || [])
      setDocs(dc.data.items || [])
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /** Real dated commitments, keyed by day, for the month on screen. */
  const events = useMemo(() => {
    const all: CalEvent[] = [...payoutMondays(year, month)]

    for (const p of providers) {
      if (!p.subscriptionExpiry) continue
      const d = new Date(p.subscriptionExpiry)
      if (Number.isNaN(d.valueOf()) || d.getFullYear() !== year || d.getMonth() !== month) continue
      all.push({
        dateKey: dateKey(d),
        kind: 'renewal',
        label: p.businessName || p.name || translatePortalText('Provider'),
        detail: `${p.businessName || p.name}'s ${p.subscriptionPackage?.name || 'subscription'} lapses on this date. Once it does they stop receiving bookings until it is renewed.`,
      })
    }

    for (const doc of docs) {
      if (!doc.expiresAt) continue
      const d = new Date(doc.expiresAt)
      if (Number.isNaN(d.valueOf()) || d.getFullYear() !== year || d.getMonth() !== month) continue
      const ownerRecord = typeof doc.owner === 'object' && doc.owner ? doc.owner : null
      const owner = localizedField<string>(ownerRecord, 'name') || translatePortalText('Unknown holder')
      all.push({
        dateKey: dateKey(d),
        kind: 'kyc',
        label: `${owner} — ${translatePortalText(doc.docType.replace(/_/g, ' '))}`,
        detail: `${owner}'s ${doc.docType.replace(/_/g, ' ')} expires. An expired document blocks the compliance checks that let them keep trading, so a replacement should be requested before this date.`,
      })
    }

    const byDay = new Map<string, CalEvent[]>()
    for (const e of all) {
      if (!filters[e.kind]) continue
      const list = byDay.get(e.dateKey) ?? []
      list.push(e)
      byDay.set(e.dateKey, list)
    }
    return byDay
  }, [providers, docs, year, month, filters])

  const total = daysInMonth(year, month)
  const lead = firstColumn(year, month)
  const days = Array.from({ length: total }, (_, i) => i + 1)
  const todayKey = dateKey(today)
  const counts = useMemo(() => {
    const out: Record<EventKind, number> = { payout: 0, renewal: 0, kyc: 0 }
    for (const list of events.values()) for (const e of list) out[e.kind]++
    return out
  }, [events])

  const step = (delta: number) => {
    const d = new Date(year, month + delta, 1)
    setYear(d.getFullYear())
    setMonth(d.getMonth())
  }

  const eventTotal = Object.values(counts).reduce((a, b) => a + b, 0)

  return (
    <div className="space-y-5">
      <AdminHeader
        title={translatePortalText('Platform Calendar')}
        sub={translatePortalText('Payout runs, subscription renewals and document expiries — every date derived from live records')}
        icon={<CalendarDays className="text-emerald-500" />}
        actions={
          <div className="flex items-center gap-1">
            <button className="btn-ghost !px-2" onClick={() => step(-1)} aria-label={translatePortalText('Previous month')}>
              <ChevronLeft size={16} />
            </button>
            <span className="min-w-[140px] text-center font-display text-sm font-extrabold text-deep-900">
              {translatePortalText(MONTHS[month])} {formatPortalNumber(year)}
            </span>
            <button className="btn-ghost !px-2" onClick={() => step(1)} aria-label={translatePortalText('Next month')}>
              <ChevronRight size={16} />
            </button>
            {(year !== today.getFullYear() || month !== today.getMonth()) && (
              <button
                className="btn-ghost !py-1.5 !px-3 !text-[11px]"
                onClick={() => {
                  setYear(today.getFullYear())
                  setMonth(today.getMonth())
                }}
              >
                {translatePortalText('Today')}
              </button>
            )}
          </div>
        }
      />

      {error && (
        <div className="card !border-rose-200 !bg-rose-50 text-sm text-rose-600">
          {translatePortalText("\n          Couldn't load the calendar: ")}{error}{' '}
          <button className="font-bold underline" onClick={() => void load()}>
            {translatePortalText('Retry')}
          </button>
        </div>
      )}

      {/* Filter chips, with the real count behind each. */}
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
            <Loader2 size={12} className="animate-spin" /> {translatePortalText('Loading records…')}
          </span>
        )}
      </div>

      <div className="card overflow-x-auto p-4 shadow-soft">
        <div className="grid min-w-[820px] grid-cols-7 gap-2">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
            <p key={d} className="pb-1 text-center text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
              {translatePortalText(d)}
            </p>
          ))}
          {/* Leading blanks computed from the real weekday of the 1st. */}
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
                  isToday ? 'border-emerald-400 bg-emerald-50/60 ring-2 ring-emerald-200' : 'border-slate-100 bg-white'
                }`}
              >
                <p className={`text-xs font-extrabold ${isToday ? 'text-emerald-600' : 'text-slate-400'}`}>
                  {d}
                  {isToday && (
                    <span className="ms-1 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[9px] font-bold text-white">
                      {translatePortalText('TODAY')}
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
                  {evs.length > 3 && <p className="text-[10px] font-bold text-slate-400">+{formatPortalNumber(evs.length - 3)} {translatePortalText('more')}</p>}
                </div>
              </motion.div>
            )
          })}
        </div>
      </div>

      {!loading && eventTotal === 0 && (
        <p className="text-center text-xs text-slate-400">
          {translatePortalText("\n          Nothing is scheduled in ")}{translatePortalText(MONTHS[month])} {formatPortalNumber(year)}.
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
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </p>
            </div>
            <span className={`chip ring-1 ${KIND_STYLE[selected.kind]}`}>
              {KIND_ICON[selected.kind]} {translatePortalText(KIND_LABEL[selected.kind])}
            </span>
            {/*
              Was a fixed block reading "Scope: Platform-wide (6 Regions) /
              Manager: Executive Operations / Status: Approved & Active" for
              every event alike. This says what the specific record means and
              why the date matters.
            */}
            <p className="rounded-xl bg-sand p-3.5 text-xs leading-relaxed text-slate-600">{translatePortalText(selected.detail)}</p>
            <div className="flex justify-end pt-2">
              <button className="btn-admin text-xs" onClick={() => setSelected(null)}>
                {translatePortalText('Close')}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
