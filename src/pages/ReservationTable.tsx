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
import { formatPortalDate, formatPortalNumber, isPortalArabic, localizedField, translatePortalText } from '../i18n/runtime'


// The filter chips, in the operator's language.
const STATUS_FILTERS: { key: string; label: string; match: (r: ApiReservation) => boolean }[] = [
  { key: 'All', label: 'All', match: () => true },
  { key: 'Accepted', label: 'Accepted', match: r => r.status === 'active' || r.status === 'pending_payment' },
  { key: 'active', label: 'Active', match: r => r.status === 'active' },
  { key: 'pending_payment', label: 'Awaiting payment', match: r => r.status === 'pending_payment' },
  { key: 'pending_approval', label: 'Requests', match: r => r.status === 'pending_approval' },
  { key: 'completed', label: 'Completed', match: r => r.status === 'completed' || r.status === 'expired' },
  { key: 'cancelled', label: 'Cancelled', match: r => r.status === 'cancelled' },
  { key: 'declined', label: 'Declined', match: r => r.status === 'declined' },
]

const PAID: ReservationStatus[] = ['active', 'completed', 'expired']

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
    return list.filter(filter.match).sort((a, b) => {
      if (sortBy === 'amount') return sortOrder === 'desc' ? b.totalSar - a.totalSar : a.totalSar - b.totalSar
      if (sortBy === 'guest') {
        const nameA = personOf(a.subscriber)?.name ?? '', nameB = personOf(b.subscriber)?.name ?? ''
        return sortOrder === 'desc' ? nameB.localeCompare(nameA) : nameA.localeCompare(nameB)
      }
      return sortOrder === 'desc' ? b.startDate.localeCompare(a.startDate) : a.startDate.localeCompare(b.startDate)
    })
  }, [list, statusFilter, sortBy, sortOrder])

  // Summary metrics — from settled reservations only, so the revenue is real.
  const totalRevenue = useMemo(() => list.filter(r => PAID.includes(r.status)).reduce((sum, r) => sum + r.totalSar, 0), [list])
  const activeCount = useMemo(() => list.filter(r => r.status === 'active').length, [list])
  const pendingCount = useMemo(() => list.filter(r => r.status === 'pending_approval' || r.status === 'pending_payment').length, [list])

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
        [`${translatePortalText('Fee')} (${currency})`]: r.priceSar,
        [`${translatePortalText('VAT')} (${currency})`]: r.vatSar,
        [`${translatePortalText('Total')} (${currency})`]: r.totalSar,
        [translatePortalText('Status')]: translatePortalText(RESERVATION_LABELS[r.status] ?? r.status),
        [translatePortalText('Paid')]: r.paidAt ?? '',
      }
    }))
    const filename = isPortalArabic() ? `جدول_الحجوزات_${todayIso()}.csv` : `Reservation_Master_Table_${todayIso()}.csv`
    download(filename, csv, 'text/csv;charset=utf-8')
    toast(translatePortalText('Reservation data exported to CSV file!'), 'info')
  }

  const printSummary = (r: ApiReservation) => {
    const c = personOf(r.subscriber)
    const marinaName = localizedField(marina, 'name') || translatePortalText('Marina')
    printDoc(`${translatePortalText('Reservation')} ${r.reservationNo}`, `
      <h1>${translatePortalText('Reservation')} ${r.reservationNo}</h1><p class="sub">${marinaName} · ${translatePortalText('booking summary')}</p>
      <div class="row"><span>${translatePortalText('Guest')}</span><span>${c?.name ?? '—'}</span></div>
      <div class="row"><span>${translatePortalText('Contact')}</span><span>${c?.email ?? '—'}${c?.phone ? ` · ${c.phone}` : ''}</span></div>
      <div class="row"><span>${translatePortalText('Vessel')}</span><span>${r.boatName} · ${r.plate} · ${formatPortalNumber(r.lengthFt)} ${translatePortalText('ft')} ${translatePortalText(boatTypeLabel(r.boatType))}</span></div>
      <div class="row"><span>${translatePortalText('Berth')}</span><span>${berthLabel(r.pontoon, r.slot)}</span></div>
      <div class="row"><span>${translatePortalText('Dates')}</span><span>${formatPortalDate(r.startDate)} → ${formatPortalDate(r.endDate)} (${formatPortalNumber(r.months)} ${translatePortalText(r.months === 1 ? 'month' : 'months')})</span></div>
      <div class="row"><span>${translatePortalText('Status')}</span><span>${translatePortalText(RESERVATION_LABELS[r.status] ?? r.status)}</span></div>
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
            <button className="btn-ghost" onClick={() => printDoc(translatePortalText('Reservation Master Table'), `
              <h1>${translatePortalText('Reservation Master Table')}</h1><p class="sub">${localizedField(marina, 'name') || translatePortalText('Marina')} · ${formatPortalNumber(filteredRows.length)} ${translatePortalText('records')}</p>
              <table><thead><tr><th>${translatePortalText('Booking')}</th><th>${translatePortalText('Guest')}</th><th>${translatePortalText('Vessel')}</th><th>${translatePortalText('Berth')}</th><th>${translatePortalText('Dates')}</th><th>${translatePortalText('Total')}</th><th>${translatePortalText('Status')}</th></tr></thead><tbody>
              ${filteredRows.map(r => {
                const c = personOf(r.subscriber)
                return `<tr><td>${r.reservationNo}</td><td>${c?.name ?? '—'}</td><td>${r.boatName}</td><td>${berthLabel(r.pontoon, r.slot)}</td><td>${formatPortalDate(r.startDate)} → ${formatPortalDate(r.endDate)}</td><td>${formatMoney(r.totalSar, currency)}</td><td>${translatePortalText(RESERVATION_LABELS[r.status] ?? r.status)}</td></tr>`
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
          { label: 'Total Reservations', val: formatPortalNumber(list.length), sub: 'All recorded bookings', color: 'text-deep-900', bg: 'bg-white' },
          { label: 'Active Berths', val: formatPortalNumber(activeCount), sub: 'Paid & alongside', color: 'text-ocean-600', bg: 'bg-ocean-50/60' },
          { label: 'Pending Requests', val: formatPortalNumber(pendingCount), sub: 'Awaiting review or payment', color: 'text-amber-600', bg: 'bg-amber-50/60' },
          { label: 'Total Revenue', val: formatMoney(totalRevenue, currency), sub: 'Settled booking receipts', color: 'text-emerald-600', bg: 'bg-emerald-50/60' },
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
          <div className="max-w-md flex-1"><SearchInput value={q} onChange={setQ} placeholder={translatePortalText("Search guest name, vessel, registration or booking ID...")} /></div>

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
                        <p className="text-xs text-deep-900 font-bold">{formatPortalDate(r.startDate)}</p>
                        <p className="text-[11px] text-slate-400">{translatePortalText("to ")}{formatPortalDate(r.endDate)}</p>
                      </td>
                      <td className="py-3 px-4 text-right font-display font-extrabold text-sm text-deep-900">
                        {formatMoney(r.totalSar, currency)}
                      </td>
                      <td className="py-3 px-4">
                        <Badge dot={r.status === 'active'}>{translatePortalText(RESERVATION_LABELS[r.status] ?? r.status)}</Badge>
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
                  ['Dates', `${formatPortalDate(detail.startDate)} → ${formatPortalDate(detail.endDate)}`],
                  ['Monthly Rate', formatMoney(Math.round(detail.priceSar / Math.max(1, detail.months)), currency)],
                  ['Total Receipts', formatMoney(detail.totalSar, currency)],
                  ['Payment Status', `${translatePortalText(PAID.includes(detail.status) ? 'Paid' : 'Pending')} ${PAID.includes(detail.status) ? '🟢' : '🟡'}`],
                  ['Booking Status', translatePortalText(RESERVATION_LABELS[detail.status] ?? detail.status)],
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
