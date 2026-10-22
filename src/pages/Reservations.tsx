import React, { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { BookMarked, Check, X, Wand2, Plus, Sparkles, ShieldCheck, Eye, FileCheck, AlertTriangle } from 'lucide-react'
import { PageHeader, Badge, Modal, toast, SearchInput, EmptyState, ViewToggle, LoadingState, ErrorState } from '../ui'
import { TablePagination, useTableFilters, type TableFiltersConfig } from '../shared/TableFilters'
import {
  useAsync, useMarina, berthLabel, fmtDate, fmtDateTime, formatMoney, humanize, personOf, todayIso,
  RESERVATION_LABELS,
} from '../live'
import { useOps } from '../opsStore'
import {
  reservationsApi, portalApi, fileUrl,
  type ApiBerthMapEntry, type ApiReservation, type ReservationStatus, type AIDocument,
} from '../api'
import { DateField } from '../components/SemanticFormControls'
import { confirmAndRun } from '../async'
import { AiDocumentVerificationModal } from '../components/AiDocumentVerificationModal'
import { formatPortalDate, formatPortalNumber, localizedField, translatePortalText, translatePortalTemplate, meterUnit } from '../i18n/runtime'

// The four boards the operator works: what needs a decision, what needs paying,
// what is live, and everything that's finished.
const TABS: { key: string; label: string; statuses: ReservationStatus[] }[] = [
  { key: 'requests', label: 'Requests', statuses: ['pending_approval'] },
  { key: 'payment', label: 'Awaiting Payment', statuses: ['pending_payment'] },
  { key: 'active', label: 'Active', statuses: ['active'] },
  { key: 'history', label: 'History', statuses: ['completed', 'expired', 'cancelled', 'declined'] },
]

const PAY_METHODS = [
  { value: 'cash', label: 'Cash at the desk' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'mada', label: 'Mada card' },
  { value: 'visa', label: 'Visa' },
  { value: 'mastercard', label: 'Mastercard' },
]

const FT = 3.28084

/**
 * Share of what the boater paid that comes back when the MARINA calls a paid
 * berth off (cancel or decline). Mirrors the backend's
 * `PROVIDER_CANCELLATION_REFUND_PCT` (config/cancellationPolicy.ts) — the rest
 * is the card fee the acquirer keeps. The API does not expose the rate yet, so
 * the dialogs quote it from here; the toast afterwards reports the amount the
 * server actually refunded.
 */
const MARINA_CANCEL_REFUND_PCT = 96

/** Legacy `pending` rows are requests awaiting review, as the server treats them. */
const statusOf = (r: ApiReservation): ReservationStatus =>
  (r.status as string) === 'pending' ? 'pending_approval' : r.status

/**
 * The badge a row shows. `expired` covers both a paid lease that ran out and a
 * request that lapsed before anyone paid — the second must not read like a stay.
 */
const statusLabel = (r: ApiReservation) =>
  statusOf(r) === 'expired' && !r.paidAt ? 'Lapsed — never paid' : RESERVATION_LABELS[statusOf(r)] ?? r.status

/** What the boater actually paid, from the payment records (not the quote). */
const paidSar = (r: ApiReservation) =>
  r.paidAt ? Math.round((r.payments ?? []).reduce((s, p) => s + (p.amountSar || 0), 0) * 100) / 100 : 0

/** What a marina-side cancel/decline refunds — per payment, rounded as the server does. */
const marinaRefundSar = (r: ApiReservation) =>
  r.paidAt
    ? Math.round((r.payments ?? []).reduce((s, p) => s + Math.round((p.amountSar || 0) * MARINA_CANCEL_REFUND_PCT) / 100, 0) * 100) / 100
    : 0

const avatarFor = (name?: string, avatar?: string) =>
  fileUrl(avatar) ?? `https://ui-avatars.com/api/?name=${encodeURIComponent(name ?? '?')}&background=e2e8f0&color=475569`

export default function Reservations() {
  const { currency } = useMarina()
  const { reloadOverview } = useOps()
  const [tab, setTab] = useState('requests')
  const [q, setQ] = useState('')
  const [assigning, setAssigning] = useState<ApiReservation | null>(null)
  const [detail, setDetail] = useState<ApiReservation | null>(null)
  const [creating, setCreating] = useState(false)
  const [settling, setSettling] = useState<ApiReservation | null>(null)
  const [payMethod, setPayMethod] = useState('cash')
  const [declining, setDeclining] = useState<ApiReservation | null>(null)
  /*
   * The server's refund for a marina-side cancel/decline, fetched when a dialog
   * opens (the list rows do not carry it). Until it arrives the dialogs fall
   * back to the local estimate, so they never show nothing.
   */
  const [preview, setPreview] = useState<{ id: string; marinaPct: number; marinaSar: number } | null>(null)
  const previewFor = detail ?? declining
  useEffect(() => {
    if (!previewFor?.paidAt) { setPreview(null); return }
    let alive = true
    reservationsApi.one(previewFor.id)
      .then(res => {
        const p = res.data?.refundPreview
        if (alive && p) setPreview({ id: previewFor.id, marinaPct: p.marinaCancel.pct, marinaSar: p.marinaCancel.amountSar })
      })
      .catch(() => { /* keep the estimate */ })
    return () => { alive = false }
  }, [previewFor?.id, previewFor?.paidAt])
  const refundPct = (r: ApiReservation) => (preview?.id === r.id ? preview.marinaPct : MARINA_CANCEL_REFUND_PCT)
  const refundSar = (r: ApiReservation) => (preview?.id === r.id ? preview.marinaSar : marinaRefundSar(r))
  /** A stay whose boat is still alongside — completing it checks the boat out first. */
  const [alongside, setAlongside] = useState<ApiReservation | null>(null)
  const [reason, setReason] = useState('')
  const [view, setView] = useState<'card' | 'table'>('table')
  const [busy, setBusy] = useState(false)
  const [inspectingDoc, setInspectingDoc] = useState<AIDocument | null>(null)

  /*
    Each board is fetched on its own, newest first. One `status: 'all'` page
    (the API caps it at 100) used to feed every tab, so at a busy marina an old
    live lease was pushed off the Active board by a hundred newer requests, and
    the tab counts stopped at 100. The counts now come from the server's
    `statusCounts`, which cover the whole marina.
  */
  const statuses = TABS.find(t => t.key === tab)!.statuses
  const state = useAsync(
    () => reservationsApi.list({ status: statuses.join(','), search: q.trim() || undefined, limit: 100 }).then(r => r.data),
    [q, tab],
  )
  const berths = useAsync(() => portalApi.berthMap().then(r => r.data), [])

  const list = state.data?.items ?? []
  const rows = useMemo(() => list.filter(r => statuses.includes(statusOf(r))), [list, statuses])
  const resCfg: TableFiltersConfig<ApiReservation> = useMemo(() => ({
    searchFields: (r) => [r.boatName, r.reservationNo, r.plate, personOf(r.subscriber)?.name, personOf(r.subscriber)?.email],
  }), [])
  const resTf = useTableFilters(rows, resCfg)
  const statusCounts = state.data?.statusCounts
  const count = (keys: ReservationStatus[]) =>
    statusCounts ? keys.reduce((n, k) => n + (statusCounts[k] ?? 0), 0) : list.filter(r => keys.includes(statusOf(r))).length
  /** More on the server than this page holds — say so instead of implying that is all. */
  const serverTotal = state.data?.pagination?.total ?? list.length
  const truncated = serverTotal > list.length

  const refresh = async () => { await state.reload(); await berths.reload(); await reloadOverview() }

  /** `msg` may be a function, read once `fn` is done, when the outcome decides it. */
  const run = async (fn: () => Promise<unknown>, msg: string | (() => string), tone: 'success' | 'warn' = 'success') => {
    setBusy(true)
    try {
      await fn()
      toast(translatePortalText(typeof msg === 'function' ? msg() : msg), tone)
      await refresh()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'That action failed'), 'warn')
    } finally { setBusy(false) }
  }

  /**
   * Another boat's paid lease on this berth for overlapping dates — the case
   * the server refuses ("Another boat is already confirmed on this berth").
   * The requested berth used to count as free whatever happened to it after
   * the request, so "Approve as requested" stayed enabled on a taken berth.
   */
  const takenByOther = (b: ApiBerthMapEntry, r: ApiReservation) => {
    const h = b.reservation
    return !!h && h.id !== (r.id || r._id) && h.status === 'active' && h.startDate < r.endDate && r.startDate < h.endDate
  }

  /** Free berths that physically fit the boat. */
  const fits = (r: ApiReservation): ApiBerthMapEntry[] =>
    (berths.data?.berths ?? []).filter(b => {
      const free = b.status === 'available' || b.id === r.slotRef
      if (!free) return false
      if (b.status === 'maintenance' || b.status === 'blocked' || takenByOther(b, r)) return false
      if (b.maxLength && r.lengthFt > b.maxLength * FT + 0.01) return false
      if (b.maxWidth && r.widthFt > b.maxWidth * FT + 0.01) return false
      if (b.maxDepth && r.draftFt > b.maxDepth * FT + 0.01) return false
      return true
    })

  /** Approves the request, moving the boat to `berth` if one was picked. */
  const assign = (r: ApiReservation, berth?: ApiBerthMapEntry) => {
    const move = berth && berth.id !== r.slotRef ? { pontoon: berth.pontoon, slot: berth.number } : undefined
    const where = berth ? berthLabel(berth.pontoon, berth.number) : berthLabel(r.pontoon, r.slot)
    setAssigning(null)
    if (statusOf(r) === 'active' || statusOf(r) === 'pending_payment') {
      return run(() => reservationsApi.transfer(r.id, move?.pontoon ?? r.pontoon, move?.slot ?? r.slot), `${r.boatName} moved to ${where}`)
    }
    // What happened to a held card decides the message — charged and live, or
    // refused and the boater asked to pay.
    let held: 'captured' | 'failed' | null | undefined
    return run(
      async () => { held = (await reservationsApi.approve(r.id, move)).data.cardHold },
      () => held === 'captured'
        ? `${where} approved for ${r.boatName} — their card was charged and the berth is confirmed`
        : held === 'failed'
          ? `${where} approved for ${r.boatName} — their card could not be charged, so they have been asked to pay`
          : `${where} approved for ${r.boatName} — awaiting payment`,
    )
  }

  const autoAllocate = (r: ApiReservation) => {
    const best = fits(r).sort((a, b) => ((a.maxLength ?? 999) * FT - r.lengthFt) - ((b.maxLength ?? 999) * FT - r.lengthFt))[0]
    if (!best) return toast(translatePortalText('No berth fits this vessel — decline or free a berth first'), 'warn')
    return assign(r, best)
  }

  /** The boater is told why (W-22): an empty reason is no longer sent. */
  const submitDecline = async () => {
    if (!declining || busy) return
    const why = reason.trim()
    if (!why) return toast(translatePortalText('Tell the boater why the request is declined'), 'warn')
    const r = declining
    setDeclining(null)
    await run(() => reservationsApi.decline(r.id, why), `${r.reservationNo} declined`, 'warn')
    setReason('')
  }

  /*
    Completing over a boat that is still checked in used to drop it off the
    departures board for good and free its berth with the hull in it. The
    server now refuses that (`BOAT_ALONGSIDE`); this asks, then checks the boat
    out and completes in one step.
  */
  const complete = async (r: ApiReservation) => {
    setBusy(true)
    try {
      await reservationsApi.complete(r.id)
      toast(translatePortalText(`${r.boatName}'s stay completed`), 'success')
      await refresh()
    } catch (e) {
      const code = (e as Error & { details?: { code?: string } })?.details?.code
      if (code === 'BOAT_ALONGSIDE') setAlongside(r)
      else toast(translatePortalText(e instanceof Error ? e.message : 'That action failed'), 'warn')
    } finally { setBusy(false) }
  }

  const submitCheckOutAndComplete = async () => {
    if (!alongside) return
    const r = alongside
    setAlongside(null)
    await run(() => reservationsApi.complete(r.id, { checkOut: true }), `${r.boatName} checked out and the stay completed`)
  }

  const submitSettle = async () => {
    if (!settling) return
    const r = settling
    setSettling(null)
    await run(() => reservationsApi.markPaid(r.id, payMethod), `Payment recorded — ${r.boatName} is berthed`)
  }

  const rowActions = (r: ApiReservation) => (
    <>
      {statusOf(r) === 'pending_approval' && (<>
        <button className="btn-primary !py-1.5 !px-2.5 text-[11px]" disabled={busy} onClick={() => setAssigning(r)}><Check size={12} /> {translatePortalText("Accept")}</button>
        <button className="btn-ghost !py-1.5 !px-2.5 text-[11px] hover:!bg-rose-50 hover:!border-rose-200 hover:text-rose-500" disabled={busy}
          title={translatePortalText("Decline request")} aria-label={translatePortalText("Decline request")}
          onClick={() => { setDeclining(r); setReason('') }}><X size={12} /></button>
      </>)}
      {statusOf(r) === 'pending_payment' && (<>
        {/* Marina has approved this request. The berth is held while we wait
            for the boater to pay. No action needed from marina. */}
        <span className="text-[11px] text-slate-400 italic">{translatePortalText("Awaiting boater payment")}</span>
      </>)}
      {statusOf(r) === 'active' && (<>
        <button className="btn-ghost !py-1.5 !px-2.5 text-[11px]" disabled={busy} onClick={() => setAssigning(r)}>{translatePortalText("↔ Move berth")}</button>
        <button className="btn-ghost !py-1.5 !px-2.5 text-[11px]" disabled={busy} onClick={() => complete(r)}>{translatePortalText("🛫 Complete")}</button>
      </>)}
      <button className="btn-ghost !py-1.5 !px-2.5 text-[11px]" onClick={() => setDetail(r)}>{translatePortalText("Details")}</button>
    </>
  )

  if (state.loading && !state.data) return <LoadingState label="Loading reservations…" rows={5} />
  if (state.error && !state.data) return <ErrorState error={state.error} onRetry={state.reload} />

  return (
    <div>
      <PageHeader title={translatePortalText("Dock Reservations")} icon={<BookMarked className="text-ocean-500" />}
        sub="Requests, berth assignment, payment & booking history — synced with the master table & arrivals board"
        actions={<>
          <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={15} /> {translatePortalText("New booking")}</button>
          <ViewToggle view={view} onChange={setView} />
          <SearchInput value={q} onChange={setQ} placeholder={translatePortalText("Search boat, registration or booking…")} />
        </>} />

      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`relative rounded-xl px-4 py-2 text-sm font-bold transition ${tab === t.key ? 'bg-deep-900 text-white shadow-soft' : 'bg-white text-slate-500 ring-1 ring-slate-200 hover:ring-ocean-300'}`}>
            {translatePortalText(t.label)}
            <span className={`ms-2 rounded-full px-1.5 py-0.5 text-[10px] font-extrabold ${tab === t.key ? 'bg-ocean-400 text-deep-950' : 'bg-slate-100 text-slate-500'}`}>{formatPortalNumber(count(t.statuses))}</span>
          </button>
        ))}
      </div>

      {/* A failed refresh keeps the last list on screen — say it is stale. */}
      {state.error && state.data && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-rose-50 px-4 py-2.5 text-xs font-semibold text-rose-700 ring-1 ring-rose-200">
          <span>{translatePortalText('Could not refresh reservations — showing the last list loaded.')}</span>
          <button className="btn-ghost !py-1 !px-2.5 text-[11px]" onClick={() => state.reload()}>{translatePortalText('Retry')}</button>
        </div>
      )}
      {truncated && rows.length > 0 && (
        <p className="mb-3 text-xs font-semibold text-amber-700">
          {translatePortalTemplate('Showing the newest {{shown}} of {{total}} — search by boat, registration or booking number to find older ones.', { shown: formatPortalNumber(list.length), total: formatPortalNumber(serverTotal) })}
        </p>
      )}

      {rows.length === 0 && (state.loading || state.refreshing) && <LoadingState label="Loading reservations…" rows={3} />}
      {rows.length === 0 && !state.loading && !state.refreshing && <div className="card"><EmptyState icon="🗓️" text={q ? translatePortalText(`Nothing matches “${q}”.`) : translatePortalText('Nothing here — smooth sailing.')} /></div>}

      {rows.length > 0 && view === 'card' && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            <AnimatePresence>
              {resTf.pagedRows.map((r, i) => {
              const who = personOf(r.subscriber)
              return (
                <motion.div layout key={r.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ delay: i * 0.04 }} className="card card-hover p-4">
                  <div className="flex items-center gap-3">
                    <img src={avatarFor(who?.name, who?.avatar)} alt="" className="h-11 w-11 shrink-0 rounded-xl object-cover ring-1 ring-ocean-50" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-extrabold text-deep-900">{r.boatName} <span className="font-medium text-slate-400">· {formatPortalNumber(r.lengthFt)} {translatePortalText("ft")}</span></p>
                      <p className="truncate text-[11px] text-slate-400">{who?.name ?? r.plate} · {r.reservationNo}</p>
                    </div>
                    <Badge>{translatePortalText(statusLabel(r))}</Badge>
                  </div>
                  <div className="mt-3 flex items-center justify-between rounded-xl bg-sand px-3 py-2.5 text-xs">
                    <span className="font-semibold text-slate-500">{formatPortalDate(new Date(`${r.startDate}T12:00:00Z`), { month: 'short', day: 'numeric', timeZone: 'UTC' })} → {formatPortalDate(new Date(`${r.endDate}T12:00:00Z`), { month: 'short', day: 'numeric', timeZone: 'UTC' })}</span>
                    <span className="rounded-lg bg-ocean-50 px-2 py-1 text-xs font-extrabold text-ocean-700">{berthLabel(r.pontoon, r.slot)}</span>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <b className="font-display text-[15px] text-deep-900">{formatMoney(r.totalSar, currency)}</b>
                    <div className="flex flex-wrap justify-end gap-1.5">{rowActions(r)}</div>
                  </div>
                </motion.div>
              )
            })}
            </AnimatePresence>
          </div>
          <TablePagination state={resTf} noun="reservations" />
        </div>
      )}

      {rows.length > 0 && view === 'table' && (
        <div className="card overflow-hidden !p-0">
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full min-w-[920px]">
              <thead><tr className="border-b border-slate-100 bg-sand/50">
                <th className="th">{translatePortalText("Guest & vessel")}</th><th className="th">{translatePortalText("Dates")}</th><th className="th">{translatePortalText("Berth")}</th><th className="th text-right">{translatePortalText("Total")}</th><th className="th">{translatePortalText("Status")}</th>
                {/* Pinned to the trailing edge (W-21): at laptop width the
                    table scrolls and Accept used to sit off-screen. */}
                <th className="th sticky end-0 z-[1] bg-sand text-right">{translatePortalText("Actions")}</th>
              </tr></thead>
              <tbody>
                <AnimatePresence>
                  {resTf.pagedRows.map((r, i) => {
                    const who = personOf(r.subscriber)
                    return (
                      <motion.tr key={r.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ delay: i * 0.03 }}
                        className="border-b border-slate-50 transition hover:bg-sand/60">
                        <td className="td">
                          <div className="flex items-center gap-2.5">
                            <img src={avatarFor(who?.name, who?.avatar)} alt="" className="h-9 w-9 shrink-0 rounded-xl object-cover ring-1 ring-ocean-50" />
                            <div className="min-w-0">
                              <p className="truncate text-[13px] font-extrabold text-deep-900">{r.boatName} <span className="font-medium text-slate-400">· {formatPortalNumber(r.lengthFt)} {translatePortalText("ft")}</span></p>
                              <p className="truncate text-[11px] text-slate-400">{who?.name ?? r.plate} · {r.reservationNo}</p>
                            </div>
                          </div>
                        </td>
                        <td className="td whitespace-nowrap text-xs font-semibold text-slate-500">{formatPortalDate(new Date(`${r.startDate}T12:00:00Z`), { month: 'short', day: 'numeric', timeZone: 'UTC' })} → {formatPortalDate(new Date(`${r.endDate}T12:00:00Z`), { month: 'short', day: 'numeric', timeZone: 'UTC' })}</td>
                        <td className="td"><span className="rounded-lg bg-ocean-50 px-2 py-1 text-xs font-extrabold text-ocean-700">{berthLabel(r.pontoon, r.slot)}</span></td>
                        <td className="td text-right font-display font-extrabold">{formatMoney(r.totalSar, currency)}</td>
                        <td className="td"><Badge>{translatePortalText(statusLabel(r))}</Badge></td>
                        <td className="td sticky end-0 z-[1] bg-white shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.35)]">
                          <div className="flex justify-end gap-1.5 whitespace-nowrap">{rowActions(r)}</div>
                        </td>
                      </motion.tr>
                    )
                  })}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
          <TablePagination state={resTf} noun="reservations" />
        </div>
      )}

      {/* assign berth modal */}
      <Modal
        open={!!assigning}
        onClose={() => setAssigning(null)}
        title={assigning && statusOf(assigning) === 'pending_approval' ? translatePortalText(`Review request — ${assigning?.boatName ?? ''}`) : translatePortalText(`Move berth — ${assigning?.boatName ?? ''}`)}
        wide
      >
        {assigning && (() => {
          // The boater already picked a berth when they booked, so approving
          // should be one click that honours that choice. Re-picking from the
          // grid is the exception (their berth became unsuitable, or the
          // marina wants to re-shuffle), not the required step it used to be.
          const requested = fits(assigning).find(b => b.id === assigning.slotRef)
          const others = fits(assigning).filter(b => b.id !== assigning.slotRef)
          const isApproval = statusOf(assigning) === 'pending_approval'
          return (<>
            {/* Without the berth map every berth reads as "no longer available". */}
            {berths.error && (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-rose-50 px-4 py-2.5 text-xs font-semibold text-rose-700 ring-1 ring-rose-200">
                <span>{translatePortalText('Could not load the berth map, so berth availability is unknown.')}</span>
                <button className="btn-ghost !py-1 !px-2.5 text-[11px]" onClick={() => berths.reload()}>{translatePortalText('Retry')}</button>
              </div>
            )}
            {isApproval && (
              <div className="mb-4 rounded-2xl bg-ocean-50 p-4 ring-1 ring-ocean-200">
                <p className="text-xs font-bold uppercase tracking-wider text-ocean-700">{translatePortalText("Berth the boater requested")}</p>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-display text-lg font-extrabold text-deep-900">
                      {berthLabel(assigning.pontoon, assigning.slot)}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {requested
                        ? [
                            translatePortalText(humanize(requested.category)),
                            requested.maxLength != null ? `${formatPortalNumber(requested.maxLength)} ${meterUnit()}` : null,
                            requested.monthlyPrice != null ? `${formatMoney(requested.monthlyPrice, currency)}/mo` : null,
                          ].filter(Boolean).join(' · ')
                        : translatePortalText('This berth is no longer available — pick another below.')}
                    </p>
                  </div>
                  <button
                    className="btn-primary shrink-0"
                    disabled={busy || !requested}
                    onClick={() => assign(assigning, requested)}
                  >
                    <Check size={15} /> {translatePortalText("Approve as requested\n                  ")}</button>
                </div>
              </div>
            )}

            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-sand p-4 text-sm">
              <p>
                {translatePortalText(isApproval ? 'Or reassign — vessel needs' : 'Vessel needs')} ≥ <b>{formatPortalNumber(assigning.lengthFt)} {translatePortalText("ft LOA")}</b>,{' '}
                <b>{formatPortalNumber(assigning.widthFt)} {translatePortalText("ft beam")}</b>, <b>{formatPortalNumber(assigning.draftFt)} {translatePortalText("ft draft")}</b>
              </p>
              <button className="btn-secondary !py-2 text-xs" disabled={busy} onClick={() => autoAllocate(assigning)}>
                <Wand2 size={14} /> {translatePortalText("Auto-allocate best fit\n              ")}</button>
            </div>

            <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 md:grid-cols-4">
              {/* On a move (not an approval) the current berth still belongs in
                  the grid, flagged, so the operator can see where they are. */}
              {(isApproval ? others : fits(assigning)).map(b => (
                <button key={b.id} disabled={busy} onClick={() => assign(assigning, b)}
                  className={`rounded-2xl border p-3 text-left transition hover:border-ocean-400 hover:bg-ocean-50 hover:shadow-soft active:scale-95 ${
                    b.id === assigning.slotRef ? 'border-ocean-400 bg-ocean-50/60' : 'border-slate-200'
                  }`}>
                  <p className="font-display font-extrabold text-deep-900">{berthLabel(b.pontoon, b.number)}</p>
                  <p className="text-[11px] text-slate-400">
                    {translatePortalText(humanize(b.category))}{b.maxLength != null ? ` · ${formatPortalNumber(b.maxLength)} ${meterUnit()}` : ''}
                    {b.monthlyPrice != null ? ` · ${formatMoney(b.monthlyPrice, currency)}/mo` : ''}
                    {b.id === assigning.slotRef ? ` · ${translatePortalText('current')}` : ''}
                  </p>
                </button>
              ))}
              {(isApproval ? others : fits(assigning)).length === 0 && (
                <p className="col-span-full py-6 text-center text-sm text-slate-400">
                  {translatePortalText(isApproval ? 'No other berth fits this vessel.' : 'No available berth fits this vessel.')}
                </p>
              )}
            </div>

            {isApproval && (
              <p className="mt-4 text-xs text-slate-400">
                {assigning.paidAt
                  ? translatePortalText('This boater has already paid — approving makes the berth live and schedules their arrival.')
                  : assigning.cardHold?.status === 'held'
                    ? `${translatePortalText("The boater's card is on hold for")} ${formatMoney(assigning.cardHold.amountSar, currency)}. ${translatePortalText('Approving charges it and confirms the berth at once.')}`
                    : translatePortalText('Not paid yet. Approving holds the berth and sends them to payment; it only goes live once they pay.')}
              </p>
            )}
          </>)
        })()}
      </Modal>

      {/* details modal */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={translatePortalText(`Booking ${detail?.reservationNo ?? ''}`)}>
        {detail && (() => {
          const who = personOf(detail.subscriber)
          return (
            <div className="space-y-4 text-sm">
              <div className="flex items-center gap-3">
                <img src={avatarFor(who?.name, who?.avatar)} className="h-12 w-12 rounded-2xl object-cover" alt="" />
                <div>
                  <p className="font-bold text-deep-900">{who?.name ?? translatePortalText('Berth holder')} <Badge>{translatePortalText(statusLabel(detail))}</Badge></p>
                  <p className="text-xs text-slate-400">{who?.email}{who?.phone ? ` · ${who.phone}` : ''}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {[
                  ['Vessel', `${detail.boatName} · ${detail.plate}`],
                  ['Dates', `${detail.startDate} → ${detail.endDate}`],
                  ['Berth', berthLabel(detail.pontoon, detail.slot)],
                  // Plan leases are booked in days (a 7-day plan has `months: 0`).
                  ['Term', detail.months > 0
                    ? translatePortalText(`${detail.months} month${detail.months === 1 ? '' : 's'}`)
                    : translatePortalTemplate('{{days}} days', { days: formatPortalNumber((detail as ApiReservation & { days?: number }).days ?? 0) })],
                  ['Berth fee', formatMoney(detail.priceSar, currency)],
                  ['VAT', formatMoney(detail.vatSar, currency)],
                  ['Total', formatMoney(detail.totalSar, currency)],
                  ['Requested', fmtDateTime(detail.requestedAt ?? detail.createdAt)],
                ].map(([l, v]) => (
                  <div key={l} className="rounded-xl bg-sand px-3 py-2.5"><p className="text-[10px] font-bold uppercase text-slate-400">{translatePortalText(l)}</p><p className="font-bold text-deep-900">{v}</p></div>
                ))}
              </div>

              {detail.payments.length > 0 && (
                <div>
                  <p className="label">{translatePortalText("Payments")}</p>
                  <div className="space-y-1 rounded-xl border border-slate-100 p-3 text-xs">
                    {detail.payments.map(p => (
                      <p key={p.paymentId} className="flex justify-between text-slate-500">
                        <span>{translatePortalText(humanize(p.kind))} · {translatePortalText(humanize(p.method))} · {formatPortalDate(p.date)}</span>
                        <span className="font-semibold text-deep-900">{formatMoney(p.amountSar, currency)}</span>
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {/* Compliance & AI Document Verification Section */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="label mb-0 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-cyan-600" /> {translatePortalText("Compliance Documents\n                  ")}</p>
                  <span className="text-[11px] font-semibold text-slate-500">
                    {formatPortalNumber(detail.documents?.length || 0)} {translatePortalText("attached\n                  ")}</span>
                </div>
                {detail.documents && detail.documents.length > 0 ? (
                  <div className="space-y-2">
                    {detail.documents.map((doc: any, i: number) => (
                      <div
                        key={i}
                        className="flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-sand/40 hover:bg-sand transition-colors"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="p-1.5 rounded-lg bg-white border border-slate-200 text-cyan-600 shrink-0">
                            <FileCheck className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-deep-900 text-xs truncate">{doc.name || doc.key || translatePortalText('Compliance Document')}</p>
                            <p className="text-[11px] text-slate-500">
                              {translatePortalText("Uploaded ")}{doc.uploadedAt ? fmtDate(doc.uploadedAt) : translatePortalText('Recently')}
                            </p>
                          </div>
                        </div>
                        {/*
                          This used to open the AI verification modal with a
                          reading invented on the spot — the reservation's own
                          boat name, plate and holder echoed back as "extracted"
                          at 94–98% confidence, status "analyzed" — and its
                          Approve/Reject did nothing (no document id). Files
                          attached to a reservation are never analysed, so the
                          button now opens the real file.
                        */}
                        <a
                          href={fileUrl(doc.url) || doc.url || undefined}
                          target="_blank"
                          rel="noreferrer"
                          aria-disabled={!doc.url}
                          onClick={e => { if (!doc.url) e.preventDefault() }}
                          className={`btn-secondary !py-1 !px-2.5 text-xs flex items-center gap-1 shrink-0 ${doc.url ? '' : 'pointer-events-none opacity-50'}`}
                        >
                          <Eye className="w-3.5 h-3.5" /> {translatePortalText("Open document")}</a>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-3 rounded-xl border border-slate-200 bg-sand/30 text-xs text-slate-500 flex items-center justify-between">
                    <span>{translatePortalText("No document files attached directly to this reservation.")}</span>
                    <a href="#/vault" className="text-cyan-600 font-bold hover:underline">{translatePortalText("Open Vault →")}</a>
                  </div>
                )}
              </div>

              <div>
                <p className="label">{translatePortalText("Booking notes")}</p>
                <p className="rounded-xl border border-slate-100 p-3 text-slate-600">{detail.notes || translatePortalText('No notes.')}</p>
              </div>

              {(detail.declineReason || detail.cancelReason) && (
                <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {detail.declineReason ? `${translatePortalText('Declined:')} ${detail.declineReason}` : `${translatePortalText('Cancelled:')} ${detail.cancelReason}`}
                </p>
              )}

              {/* The reservation carries no refund figure of its own; the refund
                  and its credit note live on the billing side. */}
              {detail.paidAt && ['cancelled', 'declined'].includes(statusOf(detail)) && (
                <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {translatePortalTemplate('Paid {{paid}} before it was called off. Any refund and its credit note (CN-…) are listed in Billing & Payments.', { paid: formatMoney(paidSar(detail), currency) })}{' '}
                  <a href="#/billing" className="font-bold underline">{translatePortalText('Open Billing →')}</a>
                </p>
              )}

              <div className="flex justify-end gap-2">
                {!['cancelled', 'completed', 'declined', 'expired'].includes(statusOf(detail)) && (
                  <button className="btn-ghost hover:!bg-rose-50 hover:text-rose-500" disabled={busy}
                    onClick={() => {
                      /*
                        BK-16: the dialog now says what this cancellation costs.
                        A marina calling off a paid berth refunds the boater at
                        the provider-cancellation rate out of the marina's own
                        earnings; a card only held for the request is released.
                      */
                      const paid = paidSar(detail)
                      const refund = refundSar(detail)
                      const money = detail.paidAt
                        ? paid > 0
                          ? translatePortalTemplate('The boater paid {{paid}}. Because the marina is cancelling, {{refund}} ({{pct}}%) is refunded to them and taken back from your earnings — the card-processing fee is not returned — and a credit note is issued.', { paid: formatMoney(paid, currency), refund: formatMoney(refund, currency), pct: formatPortalNumber(refundPct(detail)) })
                          : translatePortalText('This reservation is marked paid but no card payment is on record, so nothing is refunded automatically — settle any refund at the desk.')
                        : detail.cardHold?.status === 'held'
                          ? translatePortalTemplate('Nothing was charged — the {{amount}} hold on their card is released.', { amount: formatMoney(detail.cardHold.amountSar, currency) })
                          : translatePortalText('Nothing was paid, so there is nothing to refund.')
                      return confirmAndRun({
                        title: `Cancel ${detail.reservationNo}?`,
                        body: `${money} ${translatePortalText('The berth is released and the boater is notified. Tell them why:')}`,
                        input: { label: 'Cancellation reason', placeholder: 'Shown to the boater', required: true, multiline: true, maxLength: 300 },
                        confirmLabel: 'Cancel reservation',
                        cancelLabel: 'Keep it',
                        busyLabel: 'Cancelling...',
                        danger: true,
                        run: async (reason) => {
                          const res = await reservationsApi.cancel(detail.id, reason)
                          setDetail(null)
                          await refresh()
                          // The server's own figure, not the quote above.
                          return (res.data as { refund?: { amountSar?: number } }).refund?.amountSar ?? 0
                        },
                        success: (refunded) => refunded > 0
                          ? translatePortalTemplate('{{no}} cancelled — {{amount}} is being refunded to the boater', { no: detail.reservationNo, amount: formatMoney(refunded, currency) })
                          : translatePortalText(`${detail.reservationNo} cancelled`),
                        // The server says why (a gateway refusal, a lease already ended…).
                        error: (e) => (e instanceof Error && e.message) || 'Could not cancel the reservation. Please try again.',
                      })
                    }}>{translatePortalText("Cancel reservation")}</button>
                )}
                <button className="btn-primary" onClick={() => setDetail(null)}>{translatePortalText("Done")}</button>
              </div>
            </div>
          )
        })()}
      </Modal>

      {/* AI Document Verification Modal */}
      {inspectingDoc && (
        <AiDocumentVerificationModal
          document={inspectingDoc}
          isOpen={Boolean(inspectingDoc)}
          onClose={() => setInspectingDoc(null)}
          onStatusUpdated={() => refresh()}
        />
      )}

      {/* decline modal */}
      <Modal open={!!declining} onClose={() => { setDeclining(null); setReason('') }} title={translatePortalText("🚫 Decline berth request")}>
        <p className="text-sm text-slate-500">
          <bdi dir="auto">{localizedField<string>(declining, 'boatName') ?? declining?.boatName}</bdi> {translatePortalText('requested this berth:')} {declining ? berthLabel(declining.pontoon, declining.slot) : ''}. {translatePortalText('The boater will be notified immediately, and the berth will be released.')}
        </p>
        {/* What declining does with their money — the server refunds a paid request at the provider rate. */}
        {declining && (declining.paidAt || declining.cardHold?.status === 'held') && (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {declining.paidAt
              ? paidSar(declining) > 0
                ? translatePortalTemplate('They already paid {{paid}} — {{refund}} ({{pct}}%) is refunded to them and taken back from your earnings; the card-processing fee is not returned.', { paid: formatMoney(paidSar(declining), currency), refund: formatMoney(refundSar(declining), currency), pct: formatPortalNumber(refundPct(declining)) })
                : translatePortalText('This request is marked paid but no card payment is on record, so nothing is refunded automatically — settle any refund at the desk.')
              : translatePortalTemplate('Nothing was charged — the {{amount}} hold on their card is released.', { amount: formatMoney(declining.cardHold!.amountSar, currency) })}
          </p>
        )}
        <label className="label mt-4">{translatePortalText("Reason (sent to the boater)")} *</label>
        <textarea className="input min-h-[90px]" value={reason} maxLength={500} onChange={e => setReason(e.target.value)}
          placeholder={translatePortalText("e.g. Boat exceeds the berth's beam · Pontoon closed for works")} />
        {!reason.trim() && <p className="mt-1 text-[11px] text-slate-400">{translatePortalText('Tell the boater why the request is declined')}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => { setDeclining(null); setReason('') }}>{translatePortalText("Keep request")}</button>
          <button className="btn-primary !bg-rose-500 hover:!bg-rose-600" disabled={busy || !reason.trim()} onClick={submitDecline}>{translatePortalText("Decline request")}</button>
        </div>
      </Modal>

      {/* boat still alongside — check out, then complete */}
      <Modal open={!!alongside} onClose={() => setAlongside(null)} title={translatePortalText("⚓ Boat still alongside")}>
        <p className="text-sm text-slate-500">
          <bdi dir="auto">{localizedField<string>(alongside, 'boatName') ?? alongside?.boatName}</bdi> {translatePortalText('is still checked in at')} {alongside ? berthLabel(alongside.pontoon, alongside.slot) : ''}. {translatePortalText('Completing the stay checks the boat out now — unbilled utilities and services are totalled — and releases the berth.')}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setAlongside(null)}>{translatePortalText("Keep it berthed")}</button>
          <button className="btn-primary" disabled={busy} onClick={submitCheckOutAndComplete}>{translatePortalText("Check out & complete")}</button>
        </div>
      </Modal>

      {/* take payment modal */}
      <Modal open={!!settling} onClose={() => setSettling(null)} title={translatePortalText("💳 Record payment")}>
        <p className="text-sm text-slate-500">
          {translatePortalText('Record payment for')} <bdi dir="auto">{localizedField<string>(settling, 'boatName') ?? settling?.boatName}</bdi> · {settling ? berthLabel(settling.pontoon, settling.slot) : ''}. {translatePortalText('A VAT invoice will be issued.')}{' '}{translatePortalText('Use this when the boater pays in person instead of in the app.')}
        </p>
        <p className="mt-3 rounded-xl bg-sand px-3 py-2 font-display text-lg font-extrabold text-deep-900">
          {settling ? formatMoney(settling.totalSar, currency) : ''}
        </p>
        <label className="label mt-4">{translatePortalText("Payment method")}</label>
        <select className="input" value={payMethod} onChange={e => setPayMethod(e.target.value)}>
          {PAY_METHODS.map(m => <option key={m.value} value={m.value}>{translatePortalText(m.label)}</option>)}
        </select>
        <div className="mt-6 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setSettling(null)}>{translatePortalText("Cancel")}</button>
          <button className="btn-primary" disabled={busy} onClick={submitSettle}>{translatePortalText("Record payment")}</button>
        </div>
      </Modal>

      <NewBookingModal open={creating} onClose={() => setCreating(false)} berths={berths.data?.berths ?? []} currency={currency}
        onCreated={async (r) => { setCreating(false); setTab('payment'); toast(translatePortalText(`Booking ${r.reservationNo} created — awaiting payment`)); await refresh() }} />
    </div>
  )
}

/**
 * A booking the marina keys in at the desk. It belongs to the boater's own
 * BoatPro account (found by email), so they see it in their app and the invoice
 * is issued to them.
 */
function NewBookingModal({ open, onClose, onCreated, berths, currency }: {
  open: boolean
  onClose: () => void
  onCreated: (r: ApiReservation) => void | Promise<void>
  berths: ApiBerthMapEntry[]
  currency: string
}) {
  const blank = {
    email: '', boatName: '', plate: '', boatType: 'power',
    lengthFt: '', widthFt: '', draftFt: '',
    berthId: '', months: 1, startDate: todayIso(), notes: '',
  }
  const [f, setF] = useState(blank)
  const [busy, setBusy] = useState(false)
  const [ferrs, setFerrs] = useState<{ email?: string; boatName?: string; plate?: string; berthId?: string }>({})
  const clrFerr = (k: keyof typeof ferrs) => setFerrs(p => ({ ...p, [k]: undefined }))
  React.useEffect(() => { if (open) { setF(blank); setFerrs({}) } }, [open])

  const free = berths.filter(b => b.status === 'available')
  const berth = free.find(b => b.id === f.berthId) ?? null
  const total = berth?.monthlyPrice != null ? berth.monthlyPrice * f.months : null

  const submit = async () => {
    const errs: typeof ferrs = {}
    if (!f.email.trim()) errs.email = "Enter the boater's BoatPro email"
    else if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) errs.email = 'Enter a valid email address'
    if (!f.boatName.trim()) errs.boatName = 'Boat name is required'
    if (!f.plate.trim()) errs.plate = 'Registration number is required'
    if (!berth) errs.berthId = 'Pick a free berth'
    if (Object.keys(errs).length) { setFerrs(errs); return }
    setFerrs({})
    setBusy(true)
    try {
      const res = await reservationsApi.walkIn({
        subscriberEmail: f.email.trim(),
        pontoon: berth!.pontoon,
        slot: berth!.number,
        boatName: f.boatName.trim(),
        plate: f.plate.trim(),
        boatType: f.boatType,
        lengthFt: f.lengthFt === '' ? undefined : Number(f.lengthFt),
        widthFt: f.widthFt === '' ? undefined : Number(f.widthFt),
        draftFt: f.draftFt === '' ? undefined : Number(f.draftFt),
        months: f.months,
        startDate: f.startDate,
        notes: f.notes.trim() || undefined,
      })
      await onCreated(res.data.subscription)
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not create the booking'), 'warn')
    } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title={translatePortalText("🗓️ New dock reservation")} wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">{translatePortalText("Guest's BoatPro email *")}</label>
          <input className={`input ${ferrs.email ? '!border-rose-400 !ring-2 !ring-rose-100' : ''}`} type="email" value={f.email}
            onChange={e => { setF(s => ({ ...s, email: e.target.value })); clrFerr('email') }} placeholder={translatePortalText("skipper@example.com")} />
                  {ferrs.email ? <p className="mt-1 text-xs font-semibold text-rose-500">{translatePortalText(ferrs.email)}</p>
            : <p className="mt-1 text-[11px] text-slate-400">{translatePortalText("The berth is booked to their account, so they can pay and track it in the app.")}</p>}
        </div>
        <div>
          <label className="label">{translatePortalText("Boat name *")}</label>
          <input className={`input ${ferrs.boatName ? '!border-rose-400 !ring-2 !ring-rose-100' : ''}`} value={f.boatName}
            onChange={e => { setF(s => ({ ...s, boatName: e.target.value })); clrFerr('boatName') }} />
          {ferrs.boatName && <p className="mt-1 text-xs font-semibold text-rose-500">{translatePortalText(ferrs.boatName)}</p>}
        </div>
        <div>
          <label className="label">{translatePortalText("Registration *")}</label>
          <input className={`input uppercase ${ferrs.plate ? '!border-rose-400 !ring-2 !ring-rose-100' : ''}`} value={f.plate}
            onChange={e => { setF(s => ({ ...s, plate: e.target.value })); clrFerr('plate') }} />
          {ferrs.plate && <p className="mt-1 text-xs font-semibold text-rose-500">{translatePortalText(ferrs.plate)}</p>}
        </div>
        <div><label className="label">{translatePortalText("LOA (ft)")}</label><input type="number" className="input" value={f.lengthFt} onChange={e => setF(s => ({ ...s, lengthFt: e.target.value }))} /></div>
        <div><label className="label">{translatePortalText("Beam (ft)")}</label><input type="number" className="input" value={f.widthFt} onChange={e => setF(s => ({ ...s, widthFt: e.target.value }))} /></div>
        <div><label className="label">{translatePortalText("Draft (ft)")}</label><input type="number" className="input" value={f.draftFt} onChange={e => setF(s => ({ ...s, draftFt: e.target.value }))} /></div>
        <div>
          <label className="label">{translatePortalText("Berth *")}</label>
          <select className={`input ${ferrs.berthId ? '!border-rose-400 !ring-2 !ring-rose-100' : ''}`} value={f.berthId}
            onChange={e => { setF(s => ({ ...s, berthId: e.target.value })); clrFerr('berthId') }}>
            <option value="">{translatePortalText("Pick a free berth…")}</option>
            {free.map(b => (
              <option key={b.id} value={b.id}>
                {berthLabel(b.pontoon, b.number)} · {translatePortalText(humanize(b.category))}{b.monthlyPrice != null ? ` · ${formatMoney(b.monthlyPrice, currency)} ${translatePortalText('/mo')}` : ` · ${translatePortalText('no tariff')}`}
              </option>
            ))}
          </select>
          {ferrs.berthId && <p className="mt-1 text-xs font-semibold text-rose-500">{translatePortalText(ferrs.berthId)}</p>}
        </div>
        <div><label className="label">{translatePortalText("Months")}</label><input type="number" min={1} max={60} className="input" value={f.months} onChange={e => setF(s => ({ ...s, months: Math.min(60, Math.max(1, Math.floor(Number(e.target.value) || 1))) }))} /></div>
        <DateField label={translatePortalText('Starts')} value={f.startDate} onChange={d => setF(s => ({ ...s, startDate: d }))} />
        <div className="sm:col-span-2"><label className="label">{translatePortalText("Notes")}</label><textarea className="input" rows={2} value={f.notes} onChange={e => setF(s => ({ ...s, notes: e.target.value }))} placeholder={translatePortalText("Requests, shore power, arrival ETA…")} /></div>
      </div>
      <div className="mt-4 flex items-center justify-between rounded-2xl bg-sand p-4">
        <p className="text-sm text-slate-500">
          {berth
            ? berth.monthlyPrice != null
              ? translatePortalText(`${f.months} month${f.months === 1 ? '' : 's'} × ${formatMoney(berth.monthlyPrice, currency)}/month + VAT`)
              : translatePortalText('That berth has no monthly tariff — set one on the Berth Management page first')
            : translatePortalText('Pick a berth to price the booking')}
        </p>
        {/* The berth fee before VAT — the server adds the marina's VAT rate when it prices the booking. */}
        <p className="text-end font-display text-xl font-extrabold text-deep-900">
          {total != null ? formatMoney(total, currency) : '—'}
          {total != null && <span className="block text-[10px] font-semibold text-slate-400">{translatePortalText('excl. VAT')}</span>}
        </p>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="btn-ghost">{translatePortalText("Cancel")}</button>
        <button onClick={submit} className="btn-primary" disabled={busy}>{translatePortalText(busy ? 'Creating…' : 'Create booking')}</button>
      </div>
    </Modal>
  )
}
