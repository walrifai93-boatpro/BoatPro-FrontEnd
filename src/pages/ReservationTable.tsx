import React, { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { TableProperties, Download, Printer, Filter, Eye, ArrowUpDown, Phone, Mail } from 'lucide-react'
import { PageHeader, Badge, Modal, toast, SearchInput, printDoc, download, toCSV, LoadingState, ErrorState } from '../ui'
import { boatTypeLabel,
  useAsync, useMarina, berthLabel, fmtDateTime, formatMoney, humanize, personOf, todayIso,
  RESERVATION_LABELS,
} from '../live'
import { reservationsApi, fileUrl, type ApiReservation, type ReservationStatus } from '../api'
import VendorLogoBadge from '../components/VendorLogoBadge'
import { formatPortalDate, formatPortalNumber, isPortalArabic, localizedField, translatePortalText, translatePortalTemplate } from '../i18n/runtime'


/** Legacy `pending` rows are requests awaiting review, as the server treats them. */
const statusOf = (r: ApiReservation): ReservationStatus =>
  (r.status as string) === 'pending' ? 'pending_approval' : r.status

/**
 * `expired` is two different things: a paid lease that ran out, and a request
 * that lapsed before anyone paid. Only the first is a finished stay.
 */
const lapsedUnpaid = (r: ApiReservation) => statusOf(r) === 'expired' && !r.paidAt

const statusLabel = (r: ApiReservation) =>
  lapsedUnpaid(r) ? 'Lapsed — never paid' : RESERVATION_LABELS[statusOf(r)] ?? r.status

// The filter chips, in the operator's language.
const STATUS_FILTERS: { key: string; label: string; match: (r: ApiReservation) => boolean }[] = [
  { key: 'All', label: 'All', match: () => true },
  { key: 'Accepted', label: 'Accepted', match: r => statusOf(r) === 'active' || statusOf(r) === 'pending_payment' },
  { key: 'active', label: 'Active', match: r => statusOf(r) === 'active' },
  { key: 'pending_payment', label: 'Awaiting payment', match: r => statusOf(r) === 'pending_payment' },
  { key: 'pending_approval', label: 'Requests', match: r => statusOf(r) === 'pending_approval' },
  { key: 'completed', label: 'Completed', match: r => statusOf(r) === 'completed' || (statusOf(r) === 'expired' && !!r.paidAt) },
  { key: 'lapsed', label: 'Lapsed unpaid', match: lapsedUnpaid },
  { key: 'cancelled', label: 'Cancelled', match: r => statusOf(r) === 'cancelled' },
  { key: 'declined', label: 'Declined', match: r => statusOf(r) === 'declined' },
]

/**
 * Whether the lease's money was kept. This used to be "status is active,
 * completed or expired", which counted requests that lapsed unpaid as revenue
 * (the expiry sweep expires those too) and showed them as "Paid".
 */
const KEPT: ReservationStatus[] = ['active', 'completed', 'expired']
const keptPaid = (r: ApiReservation) => !!r.paidAt && KEPT.includes(statusOf(r))

/** Where the money stands on one reservation, for the detail card and the CSV. */
function paymentState(r: ApiReservation): { label: string; dot: string } {
  const s = statusOf(r)
  if (r.paidAt && (s === 'cancelled' || s === 'declined')) return { label: 'Paid, then called off — refund and credit note in Billing', dot: '🟠' }
  if (r.paidAt) return { label: 'Paid', dot: '🟢' }
  if (s === 'pending_approval' && r.cardHold?.status === 'held') return { label: 'Card on hold', dot: '🟡' }
  if (s === 'pending_approval' || s === 'pending_payment') return { label: 'Not paid yet', dot: '🟡' }
  return { label: 'Never paid', dot: '⚪' }
}

/**
 * A lease date (`YYYY-MM-DD`, the marina's own calendar day) for display.
 * `new Date('2026-10-15')` is UTC midnight, which a browser west of UTC shows
 * as the 14th; pinning noon UTC keeps the day the marina booked.
 */
const fmtDay = (d?: string | null) =>
  d ? formatPortalDate(new Date(`${d.slice(0, 10)}T12:00:00Z`), { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—'

/** Names and notes go into printed HTML — a "<" in a boat name must not become markup. */
const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => HTML_ESCAPES[c] ?? c)

const avatarFor = (name?: string, avatar?: string) =>
  fileUrl(avatar) ?? `https://ui-avatars.com/api/?name=${encodeURIComponent(name ?? '?')}&background=e2e8f0&color=475569`

export default function ReservationTable() {
  const { marina, currency } = useMarina()
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [sortBy, setSortBy] = useState<'date' | 'amount' | 'guest'>('date')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [detail, setDetail] = useState<ApiReservation | null>(null)

  const state = useAsync(() => reservationsApi.list({ status: 'all', search: q.trim() || undefined, limit: 100 }).then(r => r.data), [q])
  const list = state.data?.items ?? []

  const filteredRows = useMemo(() => {
    const filter = STATUS_FILTERS.find(f => f.key === statusFilter) ?? STATUS_FILTERS[0]
    // Old records can lack a total or a start date; they sort as 0 / first.
    return list.filter(filter.match).sort((a, b) => {
      if (sortBy === 'amount') return sortOrder === 'desc' ? (b.totalSar ?? 0) - (a.totalSar ?? 0) : (a.totalSar ?? 0) - (b.totalSar ?? 0)
      if (sortBy === 'guest') {
        const nameA = personOf(a.subscriber)?.name ?? '', nameB = personOf(b.subscriber)?.name ?? ''
        return sortOrder === 'desc' ? nameB.localeCompare(nameA) : nameA.localeCompare(nameB)
      }
      const da = a.startDate ?? '', db = b.startDate ?? ''
      return sortOrder === 'desc' ? db.localeCompare(da) : da.localeCompare(db)
    })
  }, [list, statusFilter, sortBy, sortOrder])

  /*
    Summary metrics. The list is the newest 100 (the API's cap), so the counts
    come from the server's `statusCounts` and the total from its pagination;
    the receipts figure can only cover the rows in hand and says so.
  */
  const counts = state.data?.statusCounts
  const serverTotal = state.data?.pagination?.total ?? list.length
  const truncated = serverTotal > list.length
  const totalRevenue = useMemo(() => list.filter(keptPaid).reduce((sum, r) => sum + (r.totalSar ?? 0), 0), [list])
  const activeCount = counts && !q.trim() ? counts.active ?? 0 : list.filter(r => statusOf(r) === 'active').length
  const pendingCount = counts && !q.trim()
    ? (counts.pending_approval ?? 0) + (counts.pending_payment ?? 0)
    : list.filter(r => statusOf(r) === 'pending_approval' || statusOf(r) === 'pending_payment').length

  const toggleSort = (field: 'date' | 'amount' | 'guest') => {
    if (sortBy === field) setSortOrder(o => (o === 'asc' ? 'desc' : 'asc'))
    else { setSortBy(field); setSortOrder('desc') }
  }

  const exportCSV = () => {
    if (!filteredRows.length) { toast(translatePortalText('Nothing to export'), 'warn'); return }
    const csv = toCSV(filteredRows.map(r => {
      const c = personOf(r.subscriber)
      return {
        [translatePortalText('Booking ID')]: r.reservationNo,
        [translatePortalText('Subscription ID')]: r.subscriptionId,
        [translatePortalText('Guest Name')]: c?.name ?? '',
        [translatePortalText('Email')]: c?.email ?? '',
        [translatePortalText('Phone')]: c?.phone ?? '',
        [translatePortalText('Vessel')]: r.boatName,
        [translatePortalText('Registration')]: r.plate,
        [translatePortalText('Vessel Type')]: translatePortalText(boatTypeLabel(r.boatType)),
        [translatePortalText('LOA (ft)')]: r.lengthFt,
        [translatePortalText('Beam (ft)')]: r.widthFt,
        [translatePortalText('Draft (ft)')]: r.draftFt,
        [translatePortalText('Berth')]: berthLabel(r.pontoon, r.slot),
        [translatePortalText('Check-In')]: r.startDate,
        [translatePortalText('Check-Out')]: r.endDate,
        [translatePortalText('Months')]: r.months,
        // `currency` is the marina's own (the one these amounts are stored in), not the display switch.
        [`${translatePortalText('Fee')} (${currency})`]: r.priceSar,
        [`${translatePortalText('VAT')} (${currency})`]: r.vatSar,
        [`${translatePortalText('Total')} (${currency})`]: r.totalSar,
        [translatePortalText('Status')]: translatePortalText(statusLabel(r)),
        [translatePortalText('Payment')]: translatePortalText(paymentState(r).label),
        [translatePortalText('Paid')]: r.paidAt ?? '',
      }
    }))
    const filename = isPortalArabic() ? `جدول_الحجوزات_${todayIso()}.csv` : `Reservation_Master_Table_${todayIso()}.csv`
    // The BOM is what makes Excel read the Arabic headers and names as UTF-8.
    download(filename, `﻿${csv}`, 'text/csv;charset=utf-8')
    toast(translatePortalText('Reservation data exported to CSV file!'), 'info')
  }

  const printSummary = (r: ApiReservation) => {
    const c = personOf(r.subscriber)
    const marinaName = localizedField(marina, 'name') || translatePortalText('Marina')
    printDoc(`${translatePortalText('Reservation')} ${r.reservationNo}`, `
      <h1>${translatePortalText('Reservation')} ${esc(r.reservationNo)}</h1><p class="sub">${esc(marinaName)} · ${translatePortalText('booking summary')}</p>
      <div class="row"><span>${translatePortalText('Guest')}</span><span>${esc(c?.name ?? '—')}</span></div>
      <div class="row"><span>${translatePortalText('Contact')}</span><span>${esc(c?.email ?? '—')}${c?.phone ? ` · ${esc(c.phone)}` : ''}</span></div>
      <div class="row"><span>${translatePortalText('Vessel')}</span><span>${esc(r.boatName)} · ${esc(r.plate)} · ${formatPortalNumber(r.lengthFt)} ${translatePortalText('ft')} ${translatePortalText(boatTypeLabel(r.boatType))}</span></div>
      <div class="row"><span>${translatePortalText('Berth')}</span><span>${berthLabel(r.pontoon, r.slot)}</span></div>
      <div class="row"><span>${translatePortalText('Dates')}</span><span>${fmtDay(r.startDate)} → ${fmtDay(r.endDate)} (${formatPortalNumber(r.months)} ${translatePortalText(r.months === 1 ? 'month' : 'months')})</span></div>
      <div class="row"><span>${translatePortalText('Status')}</span><span>${translatePortalText(statusLabel(r))}</span></div>
      <div class="row"><span>${translatePortalText('Payment')}</span><span>${translatePortalText(paymentState(r).label)}</span></div>
      <div class="row"><span>${translatePortalText('Berth fee')}</span><span>${formatMoney(r.priceSar, currency)}</span></div>
      <div class="row"><span>${translatePortalText('VAT')}</span><span>${formatMoney(r.vatSar, currency)}</span></div>
      <div class="row tot"><span>${translatePortalText('Total')}</span><span>${formatMoney(r.totalSar, currency)}</span></div>`,
      marinaName, '⚓')
  }

  if (state.loading && !state.data) return <LoadingState label="Loading the master table…" rows={6} />
  if (state.error && !state.data) return <ErrorState error={state.error} onRetry={state.reload} />

  return (
    <div className="space-y-5">
      <PageHeader
        title={translatePortalText("Reservation Master Table")}
        icon={<TableProperties className="text-ocean-500" />}
        sub="Complete tabular view of all marina reservations, guest profiles, berth assignments & payment records"
        actions={
          <div className="flex items-center gap-2">
            <button className="btn-ghost" onClick={() => !filteredRows.length ? toast(translatePortalText('Nothing to print'), 'warn') : printDoc(translatePortalText('Reservation Master Table'), `
              <h1>${translatePortalText('Reservation Master Table')}</h1><p class="sub">${esc(localizedField(marina, 'name') || translatePortalText('Marina'))} · ${formatPortalNumber(filteredRows.length)} ${translatePortalText('records')}</p>
              <table><thead><tr><th>${translatePortalText('Booking')}</th><th>${translatePortalText('Guest')}</th><th>${translatePortalText('Vessel')}</th><th>${translatePortalText('Berth')}</th><th>${translatePortalText('Dates')}</th><th>${translatePortalText('Total')}</th><th>${translatePortalText('Status')}</th></tr></thead><tbody>
              ${filteredRows.map(r => {
                const c = personOf(r.subscriber)
                return `<tr><td>${esc(r.reservationNo)}</td><td>${esc(c?.name ?? '—')}</td><td>${esc(r.boatName)}</td><td>${berthLabel(r.pontoon, r.slot)}</td><td>${fmtDay(r.startDate)} → ${fmtDay(r.endDate)}</td><td>${formatMoney(r.totalSar, currency)}</td><td>${translatePortalText(statusLabel(r))}</td></tr>`
              }).join('')}
              </tbody></table>`, localizedField(marina, 'name') || translatePortalText('Marina'), '⚓')}>
              <Printer size={15} /> {translatePortalText("Print table\r\n            ")}</button>
            <button className="btn-primary" onClick={exportCSV}>
              <Download size={15} /> {translatePortalText("Export CSV\r\n            ")}</button>
          </div>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Reservations', val: formatPortalNumber(serverTotal), sub: 'All recorded bookings', color: 'text-deep-900', bg: 'bg-white' },
          // `active` is paid and live — the boat may not have arrived yet.
          { label: 'Active Berths', val: formatPortalNumber(activeCount), sub: 'Paid & live', color: 'text-ocean-600', bg: 'bg-ocean-50/60' },
          { label: 'Pending Requests', val: formatPortalNumber(pendingCount), sub: 'Awaiting review or payment', color: 'text-amber-600', bg: 'bg-amber-50/60' },
          // Lease value incl. VAT, before commission and card fees — Billing has the net.
          { label: 'Total Revenue', val: formatMoney(totalRevenue, currency), sub: truncated ? 'Paid leases incl. VAT · newest 100 only' : 'Paid leases incl. VAT · net is in Billing', color: 'text-emerald-600', bg: 'bg-emerald-50/60' },
        ].map((k, i) => (
          <motion.div key={k.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            className={`card p-4 border border-slate-100 ${k.bg}`}>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">{translatePortalText(k.label)}</p>
            <p className={`font-display text-2xl font-extrabold mt-1 ${k.color}`}>{k.val}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">{translatePortalText(k.sub)}</p>
          </motion.div>
        ))}
      </div>

      {/* Filter and Search Bar */}
      <div className="card p-4 space-y-3 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* The server searches boat name, registration and booking/subscription
              numbers only — a guest's name or email finds nothing, so the
              placeholder no longer offers it. */}
          <div className="max-w-md flex-1"><SearchInput value={q} onChange={setQ} placeholder={translatePortalText("Search vessel, registration or booking ID...")} /></div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-bold text-slate-400 flex items-center gap-1"><Filter size={13} /> {translatePortalText("Filter:")}</span>
            {STATUS_FILTERS.map(s => (
              <button key={s.key} onClick={() => setStatusFilter(s.key)}
                className={`chip transition ${statusFilter === s.key ? 'bg-deep-900 text-white' : 'bg-sand text-slate-600 hover:bg-slate-200'}`}>
                {translatePortalText(s.label)}
              </button>
            ))}
          </div>
        </div>
        {truncated && (
          <p className="text-xs font-semibold text-amber-700">
            {translatePortalTemplate('Showing the newest {{shown}} of {{total}} — search by boat, registration or booking number to find older ones.', { shown: formatPortalNumber(list.length), total: formatPortalNumber(serverTotal) })}
          </p>
        )}
        {state.error && state.data && (
          <p className="text-xs font-semibold text-rose-600">
            {translatePortalText('Could not refresh reservations — showing the last list loaded.')}{' '}
            <button className="underline" onClick={() => state.reload()}>{translatePortalText('Retry')}</button>
          </p>
        )}
      </div>

      {/* Master Data Table */}
      <div className="card overflow-hidden !p-0 shadow-lift border border-slate-200">
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full min-w-[1050px] text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-sand/60 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                <th className="py-3.5 px-4">{translatePortalText("Booking ID")}</th>
                <th className="py-3.5 px-4 cursor-pointer select-none hover:text-deep-900" onClick={() => toggleSort('guest')}>
                  <div className="flex items-center gap-1">{translatePortalText("Guest & Contact ")}<ArrowUpDown size={12} /></div>
                </th>
                <th className="py-3.5 px-4">{translatePortalText("Vessel & Specs")}</th>
                <th className="py-3.5 px-4">{translatePortalText("Berth")}</th>
                <th className="py-3.5 px-4 cursor-pointer select-none hover:text-deep-900" onClick={() => toggleSort('date')}>
                  <div className="flex items-center gap-1">{translatePortalText("Check-In / Out ")}<ArrowUpDown size={12} /></div>
                </th>
                <th className="py-3.5 px-4 text-right cursor-pointer select-none hover:text-deep-900" onClick={() => toggleSort('amount')}>
                  <div className="flex items-center justify-end gap-1">{translatePortalText("Total ")}<ArrowUpDown size={12} /></div>
                </th>
                <th className="py-3.5 px-4">{translatePortalText("Status")}</th>
                <th className="py-3.5 px-4 text-right">{translatePortalText("Actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <p className="text-2xl mb-1">📋</p>
                    <p className="font-bold text-slate-600">{translatePortalText("No reservation records found")}</p>
                    <p className="text-xs text-slate-400">{translatePortalText("Try adjusting your search keywords or status filters.")}</p>
                  </td>
                </tr>
              ) : (
                filteredRows.map((r, i) => {
                  const c = personOf(r.subscriber)
                  return (
                    <motion.tr key={r.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i * 0.02, 0.4) }}
                      className="transition hover:bg-ocean-50/40">
                      <td className="py-3 px-4 font-mono font-extrabold text-slate-600">{r.reservationNo}</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <img src={avatarFor(c?.name, c?.avatar)} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover shadow-sm ring-1 ring-slate-200" />
                          <div className="min-w-0">
                            <p className="font-bold text-deep-900 flex items-center gap-1.5">
                              {c?.name ?? translatePortalText('Berth holder')}
                              {c?.role && <span className="rounded-md bg-sand px-1.5 py-0.5 text-[9.5px] font-extrabold text-slate-500 uppercase">{translatePortalText(humanize(c.role))}</span>}
                            </p>
                            <p className="text-[11px] text-slate-400 truncate">{c?.email ?? '—'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <VendorLogoBadge logoUrl={(r as any).boatLogo || (r as any).providerLogo || c?.avatar} name={r.boatName} role="boat_provider" size="sm" />
                          <div className="min-w-0">
                            <p className="font-bold text-deep-900">{r.boatName}</p>
                            <p className="text-[11px] text-slate-400">{formatPortalNumber(r.lengthFt)} {translatePortalText("ft LOA · ")}{formatPortalNumber(r.widthFt)} {translatePortalText("ft beam · ")}{translatePortalText(boatTypeLabel(r.boatType))}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="inline-block whitespace-nowrap rounded-xl bg-ocean-50 px-3 py-1 text-xs font-extrabold text-ocean-700 border border-ocean-200">
                          {translatePortalText("Slip ")}{berthLabel(r.pontoon, r.slot)}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-600 whitespace-nowrap">
                        <p className="text-xs text-deep-900 font-bold">{fmtDay(r.startDate)}</p>
                        <p className="text-[11px] text-slate-400">{translatePortalText("to ")}{fmtDay(r.endDate)}</p>
                      </td>
                      <td className="py-3 px-4 text-right font-display font-extrabold text-sm text-deep-900">
                        {formatMoney(r.totalSar, currency)}
                      </td>
                      <td className="py-3 px-4">
                        <Badge dot={statusOf(r) === 'active'}>{translatePortalText(statusLabel(r))}</Badge>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button className="btn-ghost !py-1 !px-2 text-[11px]" onClick={() => setDetail(r)}>
                            <Eye size={13} /> {translatePortalText("View\r\n                          ")}</button>
                        </div>
                      </td>
                    </motion.tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Guest & Reservation Detail Modal */}
      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title={detail ? translatePortalText(`📋 Reservation ${detail.reservationNo}`) : ''} wide>
        {detail && (() => {
          const c = personOf(detail.subscriber)
          return (
            <div className="space-y-4 text-sm">
              <div className="flex items-center gap-4 rounded-2xl bg-sand p-4 border border-slate-200">
                <img src={avatarFor(c?.name, c?.avatar)} className="h-14 w-14 rounded-2xl object-cover shadow-md" alt="" />
                <div>
                  <h3 className="font-display text-lg font-extrabold text-deep-900 flex items-center gap-2">
                    {c?.name ?? translatePortalText('Berth holder')}
                    {c?.role && <Badge>{translatePortalText(humanize(c.role))}</Badge>}
                  </h3>
                  <p className="text-xs text-slate-500 flex flex-wrap items-center gap-3 mt-1">
                    <span><Mail size={12} className="inline me-1 text-slate-400" />{c?.email ?? '—'}</span>
                    {c?.phone && <span><Phone size={12} className="inline me-1 text-slate-400" />{c.phone}</span>}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                {[
                  ['Vessel', `${detail.boatName} · ${detail.plate}`],
                  ['Vessel Type', `${formatPortalNumber(detail.lengthFt)} ${translatePortalText('ft')} ${translatePortalText(boatTypeLabel(detail.boatType))}`],
                  ['Berth Slip', berthLabel(detail.pontoon, detail.slot)],
                  ['Dates', `${fmtDay(detail.startDate)} → ${fmtDay(detail.endDate)}`],
                  // A plan lease is booked in days (`months: 0`) — price it per 30 days, not as one "month".
                  ['Monthly Rate', formatMoney(
                    detail.months > 0
                      ? Math.round((detail.priceSar ?? 0) / detail.months)
                      : Math.round(((detail.priceSar ?? 0) / Math.max(1, (detail as ApiReservation & { days?: number }).days ?? 30)) * 30),
                    currency)],
                  // The lease price incl. VAT — not what was kept after a refund.
                  ['Lease Total', formatMoney(detail.totalSar, currency)],
                  // BK-12 for reservations: a paid-then-cancelled lease read "Pending" here.
                  ['Payment Status', `${translatePortalText(paymentState(detail).label)} ${paymentState(detail).dot}`],
                  ['Booking Status', translatePortalText(statusLabel(detail))],
                ].map(([l, v]) => (
                  <div key={l as string} className="rounded-xl border border-slate-100 bg-white p-3 text-center shadow-sm">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">{translatePortalText(l)}</p>
                    <p className="font-bold text-deep-900 text-xs">{v}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border border-slate-100 p-4 bg-white space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">{translatePortalText("Workflow")}</h4>
                <ol className="space-y-1 text-xs text-slate-600">
                  {[
                    ['Requested', detail.requestedAt ?? detail.createdAt],
                    ['Approved', detail.approvedAt],
                    ['Paid', detail.paidAt],
                    ['Declined', detail.declinedAt],
                    ['Cancelled', detail.cancelledAt],
                    ['Completed', detail.completedAt],
                  ].filter(([, at]) => at).map(([l, at]) => (
                    <li key={l as string} className="flex justify-between">
                      <span className="font-semibold text-deep-900">{translatePortalText(l)}</span>
                      <span className="text-slate-400">{fmtDateTime(at as string)}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="rounded-2xl border border-slate-100 p-4 bg-white space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">{translatePortalText("Special Notes & Requirements")}</h4>
                <p className="text-xs text-slate-600">{detail.notes || translatePortalText('No special requests provided for this booking.')}</p>
                {detail.declineReason && <p className="text-xs text-rose-600">{translatePortalText("Declined: ")}{detail.declineReason}</p>}
                {detail.cancelReason && <p className="text-xs text-rose-600">{translatePortalText("Cancelled: ")}{detail.cancelReason}</p>}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button className="btn-ghost text-xs" onClick={() => setDetail(null)}>{translatePortalText("Close")}</button>
                <button className="btn-primary text-xs" onClick={() => { printSummary(detail); setDetail(null) }}>
                  <Printer size={14} /> {translatePortalText("Print Summary\r\n                ")}</button>
              </div>
            </div>
          )
        })()}
      </Modal>
    </div>
  )
}
