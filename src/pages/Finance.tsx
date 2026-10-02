import React, { useMemo, useState } from 'react'
import { TableToolbar, useTableFilters, NoFilterMatches, TablePagination, type TableFiltersConfig } from '../shared/TableFilters'
import { ReportsCenter } from '../shared/reports/ReportsCenter'
import { MarinaReportsSnapshot } from './MarinaReportsSnapshot'
import { motion } from 'framer-motion'
import {
  Receipt, BarChart3, CalendarDays, Download, RefreshCw, Wallet, TrendingUp, Percent,
  ChevronLeft, ChevronRight, FileText, Mail,
} from 'lucide-react'
import {
  PageHeader, Badge, Section, Modal, toast, StatCard, AsyncBlock, Avatar, EmptyState, download, toCSV,
} from '../ui'
import {
  asIssued, useAsync, useMarina, berthLabel, fmtDate, fmtDateTime, formatMoney, humanize, personOf, todayIso } from '../live'
import { useOps } from '../opsStore'
import { invoicesApi, portalApi, reservationsApi, fileUrl, type ApiInvoice } from '../api'
import { VendorWeeklyPayouts } from '../components/VendorWeeklyPayouts'
import { formatPortalDate, formatPortalNumber, formatPortalPercent, portalLocale, translatePortalText } from '../i18n/runtime'


const monthName = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return ym
  return new Date(y, m - 1, 1).toLocaleDateString(portalLocale(), { month: 'short', year: '2-digit' })
}

// ===========================================================================
// Billing & payments
// ===========================================================================
const BOOKING_TYPES = [
  { value: 'all', label: 'All streams' },
  { value: 'dock', label: 'Berthing' },
  { value: 'service', label: 'Services' },
  { value: 'fuel', label: 'Fuel' },
  { value: 'trip', label: 'Trips' },
]

export function Billing() {
  const { currency } = useMarina()
  const [bookingType, setBookingType] = useState('all')
  const [sel, setSel] = useState<ApiInvoice | null>(null)
  const [busy, setBusy] = useState(false)

  const state = useAsync(() => portalApi.billing({ bookingType, limit: 100 }).then(r => r.data), [bookingType])
  const invoices = state.data?.items ?? []
  const totals = state.data?.totals
  const outstanding = state.data?.outstanding

  /**
   * `bookingType` stays a separate select because it refetches — the server pages
   * by stream. Everything below narrows the page already in hand, which is why it
   * can afford to filter on payment status and VAT without another round trip.
   */
  const filterCfg: TableFiltersConfig<ApiInvoice> = useMemo(() => ({
    searchFields: (inv) => {
      const who = personOf(inv.customer)
      return [inv.invoiceNumber, who?.name, who?.email]
    },
    filters: [
      {
        key: 'status',
        label: 'Payment',
        options: [
          { value: 'paid', label: 'Paid' },
          { value: 'pending', label: 'Pending' },
          { value: 'refunded', label: 'Refunded' },
        ],
        get: (inv) => {
          const pay = typeof inv.payment === 'object' && inv.payment ? inv.payment : null
          return pay?.status === 'paid' ? 'paid' : pay?.status === 'refunded' ? 'refunded' : 'pending'
        },
      },
      { key: 'stream', label: 'Stream', get: (inv) => inv.bookingType },
      {
        key: 'size',
        label: 'Invoice total',
        options: [
          { value: 'high', label: '5,000 and over' },
          { value: 'mid', label: '1,000-4,999' },
          { value: 'low', label: 'Under 1,000' },
        ],
        get: (inv) => String(inv.total ?? 0),
        match: (inv, v) => {
          const t = Number(inv.total ?? 0)
          if (v === 'high') return t >= 5000
          if (v === 'mid') return t >= 1000 && t < 5000
          return t < 1000
        },
      },
    ],
  }), [])
  const tf = useTableFilters(invoices, filterCfg)
  const rows = tf.pagedRows

  const emailInvoice = async (inv: ApiInvoice) => {
    setBusy(true)
    try {
      await invoicesApi.email(inv.id)
      toast(translatePortalText(`${inv.invoiceNumber} emailed to the customer`))
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not send that invoice'), 'warn')
    } finally { setBusy(false) }
  }

  const exportCsv = () => {
    if (!rows.length) { toast(translatePortalText('Nothing to export'), 'warn'); return }
    download(`invoices-${todayIso()}.csv`, toCSV(rows.map(inv => {
      const who = personOf(inv.customer)
      const pay = typeof inv.payment === 'object' && inv.payment ? inv.payment : null
      return {
        [translatePortalText('Invoice')]: inv.invoiceNumber,
        [translatePortalText('Stream')]: translatePortalText(humanize(inv.bookingType)),
        [translatePortalText('Customer')]: who?.name ?? '',
        [translatePortalText('Email')]: who?.email ?? '',
        [translatePortalText('Subtotal')]: inv.subtotal,
        [translatePortalText('VAT %')]: inv.vatRate,
        [translatePortalText('VAT')]: inv.vatAmount,
        [translatePortalText('Total')]: inv.total,
        [translatePortalText('Currency')]: inv.currency,
        [translatePortalText('Status')]: translatePortalText(humanize(pay?.status ?? 'unpaid')),
        [translatePortalText('Method')]: translatePortalText(humanize(pay?.method)),
        [translatePortalText('Paid')]: pay?.paidAt ?? '',
        [translatePortalText('Raised')]: inv.createdAt,
      }
    })), 'text/csv;charset=utf-8')
    toast(translatePortalText(`Exported ${rows.length} invoice${rows.length === 1 ? '' : 's'}`))
  }

  return (
    <div>
      <PageHeader title={translatePortalText("Billing & Payments")} icon={<Receipt className="text-ocean-500" />}
        sub="Every invoice your marina has raised, what it earned after platform commission, and what is still owed."
        actions={<>
          <button className="btn-ghost" onClick={() => state.reload()}><RefreshCw size={14} /> {translatePortalText("Refresh")}</button>
          <button className="btn-primary" onClick={exportCsv}><Download size={15} /> {translatePortalText("Export CSV")}</button>
        </>} />

      <div className="mb-5 grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard i={0} label="Gross collected" value={totals?.gross ?? 0} prefix={`${currency} `} icon={<Wallet size={17} />} tone="green" />
        <StatCard i={1} label="Your net earnings" value={totals?.net ?? 0} prefix={`${currency} `} icon={<TrendingUp size={17} />} tone="ocean" />
        <StatCard i={2} label="Platform commission" value={totals?.commission ?? 0} prefix={`${currency} `} icon={<Percent size={17} />} tone="violet" />
        <StatCard i={3} label="Awaiting payment" value={outstanding?.amount ?? 0} prefix={`${currency} `} icon={<Receipt size={17} />} tone="amber" />
      </div>

      {outstanding && outstanding.items.length > 0 && (
        <Section title={translatePortalText("Approved but unpaid")} sub="These berths are held until the boater pays" className="mb-5">
          <div className="space-y-2">
            {outstanding.items.map(r => {
              const who = personOf(r.subscriber)
              return (
                <div key={r.id} className="flex items-center gap-3 rounded-xl border border-amber-100 bg-amber-50/50 p-3">
                  <Avatar name={who?.name ?? r.boatName} src={who?.avatar} size={34} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-deep-900">{r.boatName} · {berthLabel(r.pontoon, r.slot)}</p>
                    <p className="truncate text-[11px] text-slate-500">{who?.name ?? ''} · {r.reservationNo}</p>
                  </div>
                  <span className="font-extrabold text-amber-800">{formatMoney(r.totalSar, currency)}</span>
                </div>
              )
            })}
          </div>
        </Section>
      )}

      <TableToolbar
        state={tf}
        config={filterCfg}
        rows={invoices}
        noun="invoices"
        searchPlaceholder="Search by invoice number, customer or email..."
      >
        <select value={bookingType} onChange={e => setBookingType(e.target.value)} className="input !w-auto !py-2 text-xs font-semibold">
          {BOOKING_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <span className="text-xs font-semibold text-slate-400">{translatePortalText(`${rows.length} invoice${rows.length === 1 ? '' : 's'}`)}</span>
      </TableToolbar>

      <AsyncBlock state={state} loadingLabel="Loading invoices…"
        empty={d => d.items.length === 0 ? { icon: '🧾', text: 'No invoices yet — they are raised automatically when a berth is paid.' } : null}>
        {() => invoices.length > 0 && rows.length === 0 ? (
          <NoFilterMatches noun="invoices" onClear={tf.clear} />
        ) : (
          <div className="card overflow-hidden !p-0">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full min-w-[980px]">
                <thead><tr className="border-b border-slate-100 bg-sand/50">
                  <th className="th">{translatePortalText("Invoice")}</th><th className="th">{translatePortalText("Customer")}</th><th className="th">{translatePortalText("Stream")}</th>
                  <th className="th text-right">{translatePortalText("Subtotal")}</th><th className="th text-right">{translatePortalText("VAT")}</th><th className="th text-right">{translatePortalText("Total")}</th>
                  <th className="th">{translatePortalText("Status")}</th><th className="th text-right">{translatePortalText("Actions")}</th>
                </tr></thead>
                <tbody>
                  {rows.map((inv, i) => {
                    const who = personOf(inv.customer)
                    const pay = typeof inv.payment === 'object' && inv.payment ? inv.payment : null
                    return (
                      <motion.tr key={inv.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i * 0.02, 0.35) }}
                        className="border-b border-slate-50 transition hover:bg-sand/60">
                        <td className="td">
                          <button onClick={() => setSel(inv)} className="text-left">
                            <p className="font-mono text-xs font-bold text-deep-900">{inv.invoiceNumber}</p>
                            <p className="text-[11px] text-slate-400">{fmtDate(inv.createdAt)}</p>
                          </button>
                        </td>
                        <td className="td">
                          {who ? (
                            <div className="flex items-center gap-2">
                              <Avatar name={who.name} src={who.avatar} size={26} />
                              <div className="min-w-0"><p className="truncate text-xs font-semibold text-deep-900">{who.name}</p><p className="truncate text-[10px] text-slate-400">{who.email}</p></div>
                            </div>
                          ) : <span className="text-xs text-slate-400">—</span>}
                        </td>
                        <td className="td text-xs text-slate-500">{translatePortalText(humanize(inv.bookingType))}</td>
                        <td className="td text-right text-slate-600">{asIssued(inv.subtotal, inv.currency)}</td>
                        <td className="td text-right text-slate-500">{asIssued(inv.vatAmount, inv.currency)}</td>
                        <td className="td text-right font-extrabold text-deep-900">{asIssued(inv.total, inv.currency)}</td>
                        <td className="td"><Badge>{translatePortalText(pay?.status === 'paid' ? 'Paid' : pay?.status === 'refunded' ? 'Refunded' : 'Pending')}</Badge></td>
                        <td className="td">
                          <div className="flex justify-end gap-1.5">
                            {inv.pdfUrl && (
                              <a className="btn-ghost !p-2" title={translatePortalText("Open PDF")} href={fileUrl(inv.pdfUrl)} target="_blank" rel="noreferrer"><FileText size={14} /></a>
                            )}
                            <button className="btn-ghost !p-2" title={translatePortalText("Email to customer")} disabled={busy} onClick={() => emailInvoice(inv)}><Mail size={14} /></button>
                          </div>
                        </td>
                      </motion.tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <TablePagination state={tf} noun="invoices" />
          </div>
        )}
      </AsyncBlock>

      <Modal open={!!sel} onClose={() => setSel(null)} title={sel ? translatePortalText(`🧾 ${sel.invoiceNumber}`) : ''}>
        {sel && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-deep-900">{personOf(sel.customer)?.name ?? translatePortalText('Customer')}</p>
                <p className="text-xs text-slate-400">{personOf(sel.customer)?.email}</p>
              </div>
              <Badge>{translatePortalText(typeof sel.payment === 'object' && sel.payment?.status === 'paid' ? 'Paid' : 'Pending')}</Badge>
            </div>
            <div className="rounded-2xl border border-slate-100">
              {sel.items.map((it, i) => (
                <div key={i} className="flex items-start justify-between gap-3 border-b border-slate-50 px-4 py-2.5 last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm text-deep-900">{translatePortalText(it.description)}</p>
                    <p className="text-[11px] text-slate-400">{formatPortalNumber(it.quantity)} × {asIssued(it.unitPrice, sel.currency)}</p>
                  </div>
                  <span className="font-semibold text-deep-900">{asIssued(it.total, sel.currency)}</span>
                </div>
              ))}
            </div>
            <div className="space-y-1 text-sm">
              <p className="flex justify-between"><span className="text-slate-500">{translatePortalText("Subtotal")}</span><span className="font-semibold text-deep-900">{asIssued(sel.subtotal, sel.currency)}</span></p>
              <p className="flex justify-between"><span className="text-slate-500">{translatePortalText('VAT')} ({formatPortalNumber(sel.vatRate)}%)</span><span className="font-semibold text-deep-900">{asIssued(sel.vatAmount, sel.currency)}</span></p>
              <p className="flex justify-between border-t border-slate-100 pt-1.5"><span className="font-bold text-deep-900">{translatePortalText("Total")}</span><span className="font-display text-lg font-extrabold text-deep-900">{asIssued(sel.total, sel.currency)}</span></p>
            </div>
            <p className="text-xs text-slate-400">{translatePortalText("Raised ")}{fmtDateTime(sel.createdAt)}</p>
            <div className="flex justify-end gap-2">
              {sel.pdfUrl && <a className="btn-ghost" href={fileUrl(sel.pdfUrl)} target="_blank" rel="noreferrer"><FileText size={14} /> {translatePortalText("Open PDF")}</a>}
              <button className="btn-primary" disabled={busy} onClick={() => emailInvoice(sel)}><Mail size={15} /> {translatePortalText("Email invoice")}</button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Marina Weekly Payouts & Receipts ── */}
      <VendorWeeklyPayouts title={translatePortalText("Marina Weekly Payouts & Transfer Receipts")} accent="ocean" />
    </div>
  )
}

// ===========================================================================
// Reports & analytics
// ===========================================================================

/**
 * The marina's Reports & Analytics: an overview, and every report the marina can run.
 *
 * This page used to be ten widgets — revenue, occupancy, reservation outcomes, top
 * customers, berth classes, service mix, tiers, staff, utilities — stacked above a
 * report library with its own toolbar. The report library now *is* the page, with a
 * short "at a glance" panel above it. Staff and utilities are managed on their own
 * pages (People, Utilities), which is where that information belongs. See
 * `ReportsCenter`.
 */
export function Reports() {
  return (
    <ReportsCenter
      portal="marina"
      basePath="/reports"
      tone="ocean"
      header={
        <PageHeader
          title="Reports & Analytics"
          sub="How your marina is doing at a glance, and every report you can open or download."
          icon={<BarChart3 className="text-ocean-500" />}
        />
      }
      snapshot={<MarinaReportsSnapshot />}
    />
  )
}

// ===========================================================================
// Marina calendar
// ===========================================================================
const EVENT_TONE: Record<string, string> = {
  info: 'bg-ocean-50 text-ocean-700 ring-ocean-200',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warn: 'bg-amber-50 text-amber-700 ring-amber-200',
  danger: 'bg-rose-50 text-rose-600 ring-rose-200',
}
const KIND_ICON: Record<string, string> = {
  reservation_start: '⚓', reservation_end: '🛫', arrival: '⬇️', departure: '⬆️', maintenance: '🔧', service: '🛎️',
}

export function Calendar() {
  const [cursor, setCursor] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })

  const state = useAsync(() => portalApi.calendar(cursor).then(r => r.data), [cursor])

  const shift = (delta: number) => {
    const [y, m] = cursor.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setCursor(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const [year, month] = cursor.split('-').map(Number)
  const first = new Date(year, month - 1, 1)
  const daysInMonth = new Date(year, month, 0).getDate()
  const leading = (first.getDay() + 6) % 7 // Monday-first grid

  const byDay = useMemo(() => {
    const map: Record<number, { kind: string; label: string; tone: string }[]> = {}
    for (const e of state.data?.events ?? []) {
      const day = Number(e.date.slice(8, 10))
      ;(map[day] ??= []).push(e)
    }
    return map
  }, [state.data])

  return (
    <div>
      <PageHeader title={translatePortalText("Marina Calendar")} icon={<CalendarDays className="text-ocean-500" />}
        sub="Berth starts and ends, arrivals, departures, maintenance and booked services in one month view."
        actions={<>
          <button className="btn-ghost !p-2" onClick={() => shift(-1)}><ChevronLeft size={16} /></button>
          <span className="px-2 font-display text-sm font-extrabold text-deep-900">
            {formatPortalDate(first, { month: 'long', year: 'numeric' })}
          </span>
          <button className="btn-ghost !p-2" onClick={() => shift(1)}><ChevronRight size={16} /></button>
        </>} />

      <AsyncBlock state={state} loadingLabel="Loading the calendar…">
        {(d) => (
          <>
            <div className="card !p-3 md:!p-5">
              <div className="mb-2 grid grid-cols-7 gap-1.5 text-center text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(w => <span key={w}>{translatePortalText(w)}</span>)}
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {Array.from({ length: leading }).map((_, i) => <div key={`pad-${i}`} className="min-h-[92px] rounded-xl bg-slate-50/50" />)}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                  const day = i + 1
                  const events = byDay[day] ?? []
                  const isToday = todayIso() === `${cursor}-${String(day).padStart(2, '0')}`
                  return (
                    <motion.div key={day} initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: Math.min(i * 0.008, 0.25) }}
                      className={`min-h-[92px] rounded-xl border p-1.5 ${isToday ? 'border-ocean-300 bg-ocean-50/40' : 'border-slate-100'}`}>
                      <p className={`mb-1 text-[11px] font-extrabold ${isToday ? 'text-ocean-700' : 'text-slate-400'}`}>{day}</p>
                      <div className="space-y-1">
                        {events.slice(0, 3).map((e, k) => (
                          <p key={k} title={e.label}
                            className={`truncate rounded-lg px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${EVENT_TONE[e.tone] ?? EVENT_TONE.info}`}>
                            {KIND_ICON[e.kind] ?? '•'} {translatePortalText(e.label)}
                          </p>
                        ))}
                        {events.length > 3 && <p className="px-1 text-[10px] font-bold text-slate-400">+{formatPortalNumber(events.length - 3)} {translatePortalText("more")}</p>}
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            </div>

            <OccupancyHeat month={cursor} />

            <Section title={translatePortalText("Everything this month")} sub={translatePortalText(`${d.events.length} ${d.events.length === 1 ? 'event' : 'events'}`)} className="mt-5">
              {d.events.length ? (
                <div className="space-y-1.5">
                  {d.events.map((e, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-xl border border-slate-100 px-3 py-2">
                      <span className="text-base">{KIND_ICON[e.kind] ?? '•'}</span>
                      <span className="w-24 shrink-0 text-xs font-bold text-slate-400">{fmtDate(e.date)}</span>
                      <span className="min-w-0 flex-1 truncate text-sm text-deep-800">{e.label}</span>
                      <span className={`chip ring-1 ${EVENT_TONE[e.tone] ?? EVENT_TONE.info}`}>{translatePortalText(humanize(e.kind))}</span>
                    </div>
                  ))}
                </div>
              ) : <EmptyState icon="📅" text="Nothing scheduled this month" />}
            </Section>
          </>
        )}
      </AsyncBlock>
    </div>
  )
}

/**
 * Berth occupancy per day, darker = fuller. Uses the live fortnight series from
 * the overview, so only days the marina actually has data for are shaded.
 */
function OccupancyHeat({ month }: { month: string }) {
  const { overview } = useOps()
  const trends = overview?.trends
  const berths = overview?.berths?.total ?? 0
  if (!trends) return null

  const days = trends.days
    .map((day, i) => ({ day, pct: trends.occupancyRate[i] ?? 0 }))
    .filter(d => d.day.startsWith(month))
  if (!days.length) return null

  return (
    <Section title={translatePortalText("Berth occupancy heat")} sub={`Share of ${berths} berths occupied per day — last two weeks`} className="mt-5">
      <div className="flex flex-wrap gap-1.5">
        {days.map(d => (
          <div key={d.day} title={translatePortalText(`${fmtDate(d.day)} · ${d.pct}% occupied`)}
            className="grid h-10 w-10 place-items-center rounded-lg text-[10px] font-extrabold text-white transition hover:scale-110"
            style={{ background: `rgba(27,155,191,${0.25 + (d.pct / 100) * 0.75})` }}>
            {formatPortalNumber(Number(d.day.slice(8)))}
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-400">{translatePortalText("Darker = fuller. Hover any day for the exact rate.")}</p>
    </Section>
  )
}
