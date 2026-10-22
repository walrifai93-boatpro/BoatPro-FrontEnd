import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { TableToolbar, useTableFilters, NoFilterMatches, TablePagination, type TableFiltersConfig } from '../../shared/TableFilters'
import { motion } from 'framer-motion'
import {
  Sailboat, Check, X, RefreshCw, FileText, Image as ImageIcon,
  MapPin, Users, Calendar, Ship, ShieldCheck, ExternalLink,
  Gauge, Fuel, Anchor, Wrench, Compass, LifeBuoy, User, Clock, Radio, Sparkles, Layers, Shield, Eye,
} from 'lucide-react'
import { PageWrap } from './_shared'
import { AdminHeader, ABadge, ViewToggle } from '../adminUi'
import { Modal, toast, Counter, CardGridSkeleton, TableSkeleton } from '../../ui'
import { confirm } from '../../async'
import { translatePortalText  , formatPortalDate, formatPortalNumber, formatPortalPercent} from '../../i18n/runtime'
import { adminApi, aiDocumentApi, fileUrl, type AdminBoatApproval, type AIDocument } from '../../api'
import { AiDocumentVerificationModal } from '../../components/AiDocumentVerificationModal'

const TABS = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: '', label: 'All' },
] as const

const CATEGORY_ICON: Record<string, string> = {
  sailing_boat: '⛵', motorboat: '🚤', yacht: '🛥️', jet_ski: '🏄',
  car_jet: '🚀', sports_jet_boat: '🛶', floating_restaurant: '🍽️',
  water_bus: '⛴️', cruise_ship: '🚢',
}

function approvalBadgeClass(status: string) {
  if (status === 'approved') return 'bg-emerald-100 text-emerald-700'
  if (status === 'rejected') return 'bg-rose-100 text-rose-700'
  return 'bg-amber-100 text-amber-700'
}

function boatId(b?: AdminBoatApproval | null): string {
  if (!b) return ''
  return b._id || b.id || ''
}

/**
 * True when a boat belongs to a scuba-diver operator — the one account type
 * that files no paperwork, at signup or per vessel. See PROVIDER_KINDS on the
 * API.
 *
 * Reads `provider`, not `providerId`: `GET /admin/boats` populates the owner
 * onto `providerId` and then renames the key to `provider` before responding.
 * This used to be written inline as `b.providerId?.providerKind`, which is a
 * field that never reaches the client — so every diver branch in this file was
 * dead and a diver's vessel was shown in the approvals queue as a boat missing
 * its documents.
 */
function isDiverBoat(b?: AdminBoatApproval | null): boolean {
  return b?.provider?.providerKind === 'scuba_diver'
}

export default function AdminBoatApprovals() {
  const [tab, setTab] = useState<string>('pending')
  const [view, setView] = useState<'card' | 'table'>('table')
  const [boats, setBoats] = useState<AdminBoatApproval[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AdminBoatApproval | null>(null)
  const [rejecting, setRejecting] = useState<AdminBoatApproval | null>(null)
  const [reason, setReason] = useState('')
  const [imgIdx, setImgIdx] = useState(0)
  const [aiDocument, setAiDocument] = useState<AIDocument | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      // Every page, 100 at a time (the API's cap). Without `limit` the API
      // served its default of 20, so the 21st pending boat was counted in the
      // tab and never on screen — the table pages client-side over what came back.
      const all: AdminBoatApproval[] = []
      let statusCounts: Record<string, number> = {}
      for (let page = 1; page <= 50; page++) {
        const res = await adminApi.listBoatApprovals({ limit: 100, page, ...(tab ? { approvalStatus: tab } : {}) })
        all.push(...(res.data.boats || []))
        statusCounts = res.data.statusCounts || {}
        if (!res.data.boats?.length || all.length >= (res.data.total ?? 0)) break
      }
      setBoats(all)
      setCounts(statusCounts)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load boats')
    } finally {
      setLoading(false)
    }
  }, [tab])

  useEffect(() => { load() }, [load])

  const act = async (boat: AdminBoatApproval, fn: () => Promise<unknown>, msg: string, tone: any = 'success') => {
    setBusyId(boatId(boat))
    try {
      await fn()
      toast(translatePortalText(msg), tone)
      setRejecting(null); setReason(''); setDetail(null)
      await load()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Action failed'), 'warn')
    } finally {
      setBusyId(null)
    }
  }

  const doReject = () => {
    if (!rejecting || busyId) return
    const id = boatId(rejecting)
    if (!id) { toast(translatePortalText('Invalid boat ID'), 'warn'); return }
    if (reason.trim().length < 3) { toast(translatePortalText('Please give a rejection reason (min 3 chars)'), 'warn'); return }
    const revoking = rejecting.approvalStatus === 'approved'
    act(rejecting, () => adminApi.rejectBoat(id, reason.trim()), `"${rejecting.name}" ${revoking ? 'approval revoked' : 'rejected'}`, 'warn')
  }

  /**
   * Approve, after naming what the admin is approving past.
   *
   * The server approves a boat with no checks of its own — no documents, AI
   * readings that failed or were rejected, no photos — and every Approve button
   * here fired in one click, so a vessel with nothing on file went live
   * unremarked. A diver's vessel owes no paperwork and is not warned about it.
   */
  const approveWithChecks = async (b: AdminBoatApproval) => {
    const id = boatId(b)
    if (!id || busyId) return
    const docs = b.documents ?? []
    const warnings: string[] = []
    if (!isDiverBoat(b)) {
      if (docs.length === 0) warnings.push(translatePortalText('No documents are on file for this boat.'))
      const bad = docs.filter((d) => d.reviewStatus === 'rejected' || d.reviewStatus === 'failed')
      if (bad.length) warnings.push(translatePortalText(`AI rejected or could not read: ${bad.map((d) => d.label).join(', ')}.`))
      const unread = docs.filter((d) => !d.aiDocumentId)
      if (unread.length) warnings.push(translatePortalText(`${unread.length} document${unread.length === 1 ? ' has' : 's have'} no AI reading.`))
    }
    if (!b.images?.length) warnings.push(translatePortalText('The listing has no photos.'))
    const ok = await confirm({
      title: `Approve "${b.name}"?`,
      body: [...warnings, translatePortalText('Approved boats appear publicly and can be used in trips.')].join(' '),
      confirmLabel: warnings.length ? 'Approve anyway' : 'Approve',
      danger: warnings.length > 0,
    })
    if (ok) act(b, () => adminApi.approveBoat(id), `"${b.name}" approved — now live`)
  }

  const openDetail = (b: AdminBoatApproval) => { setDetail(b); setImgIdx(0) }

  const filterCfg: TableFiltersConfig<any> = useMemo(() => ({
    // `provider`, not `providerId`: the API renames the populated owner before
    // responding, so searching by owner never matched anything.
    searchFields: (b) => [b.name, b.nameAr, b.code, b.city, b.marina, b.category, b.provider?.name, b.provider?.email, b.provider?.business?.businessName],
    filters: [
      { key: 'category', label: translatePortalText('Category'), get: (b) => b.category },
      { key: 'city', label: translatePortalText('City'), get: (b) => b.city },
      { key: 'status', label: translatePortalText('Approval'), get: (b) => translatePortalText(b.approvalStatus) },
      { key: 'submitted', label: translatePortalText('Submitted'), kind: 'dateRange', get: (b) => b.createdAt },
      {
        key: 'photos',
        label: translatePortalText('Photos'),
        options: [
          { value: 'has', label: translatePortalText('Has photos') },
          { value: 'none', label: translatePortalText('No photos') },
        ],        // A listing with no photograph is the one an approver most needs to find.
        get: (b) => (b.images?.length ? 'has' : 'none'),
      },
    ],
    sortOptions: [
      // Oldest first: an unreviewed boat is a provider unable to earn.
      { key: 'submitted', label: 'Submitted', get: (b) => b.createdAt, defaultDir: 'asc' },
      { key: 'name', label: 'Boat', get: (b) => b.name, defaultDir: 'asc' },
      { key: 'city', label: 'City', get: (b) => b.city, defaultDir: 'asc' },
    ],
    defaultSort: 'submitted',
  }), [])
  const tf = useTableFilters(boats, filterCfg)
  const visible = tf.pagedRows

  return (
    <PageWrap>
      <AdminHeader
        title={translatePortalText("Boat Approvals")}
        sub="Review boat submissions from providers. Only approved boats appear publicly and can be used in trips."
        icon={<Sailboat className="text-sky-500" />}
        actions={<button className="btn-ghost" onClick={load}><RefreshCw size={15} /> {translatePortalText("Refresh")}</button>}
      />

      {/* Status summary cards */}
      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
        {(['pending', 'approved', 'rejected'] as const).map((s, i) => (
          <motion.div key={s} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="card flex items-center gap-3 p-4 cursor-pointer hover:shadow-md transition"
            onClick={() => setTab(s)}>
            <span className="text-2xl">{s === 'pending' ? '⏳' : s === 'approved' ? '✅' : '❌'}</span>
            <div>
              <p className="font-display text-2xl font-extrabold text-deep-900"><Counter value={counts[s] || 0} /></p>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 capitalize">{translatePortalText(s)}</p>
            </div>
          </motion.div>
        ))}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="card flex items-center gap-3 p-4 cursor-pointer hover:shadow-md transition"
          onClick={() => setTab('')}>
          <span className="text-2xl">🛥️</span>
          <div>
            <p className="font-display text-2xl font-extrabold text-deep-900">
              <Counter value={Object.values(counts).reduce((a, b) => a + b, 0)} />
            </p>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText("Total")}</p>
          </div>
        </motion.div>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`rounded-full px-3.5 py-1.5 text-[12px] font-bold transition ${tab === t.key
              ? 'bg-gradient-to-r from-sky-500 to-cyan-500 text-white shadow-glow'
              : 'bg-white text-slate-500 hover:text-deep-900'}`}>
            {translatePortalText(t.label)}{t.key && counts[t.key] ? ` · ${formatPortalNumber(counts[t.key])}` : ''}
          </button>
        ))}
      </div>

      {error && <div className="card mb-4 !border-rose-200 !bg-rose-50 text-sm text-rose-600">{translatePortalText("Couldn't load: ")}{error}</div>}
      {loading && (view === 'table' ? <TableSkeleton rows={6} cols={6} /> : <CardGridSkeleton count={6} />)}

      <TableToolbar
        state={tf}
        config={filterCfg}
        rows={boats}
        noun="boats"
        searchPlaceholder={translatePortalText("Search boats by name, code, owner or city...")}
      >
        <ViewToggle view={view} onChange={setView} />
      </TableToolbar>

      {!loading && !error && boats.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-200 py-16 text-center text-sm text-slate-400">
          {translatePortalText("\r\n          No boats in \"")}{tab || 'all'}".
        </div>
      )}
      {!loading && boats.length > 0 && visible.length === 0 && (
        <NoFilterMatches noun="boats" onClear={tf.clear} />
      )}

      {!loading && visible.length > 0 && (
        view === 'table' ? (
          <div className="card overflow-hidden border border-slate-200/80 shadow-soft">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full min-w-[980px] text-left text-xs">
                <thead className="border-b border-slate-100 bg-slate-50/80 font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="py-3.5 px-4">{translatePortalText("Boat & Code")}</th>
                    <th className="py-3.5 px-4">{translatePortalText("Provider / Location")}</th>
                    <th className="py-3.5 px-4">{translatePortalText("Specifications")}</th>
                    <th className="py-3.5 px-4">{translatePortalText("Documents")}</th>
                    <th className="py-3.5 px-4">{translatePortalText("Submitted")}</th>
                    <th className="py-3.5 px-4">{translatePortalText("Status")}</th>
                    <th className="sticky end-0 z-[1] bg-slate-50 py-3.5 px-4 text-right">{translatePortalText("Actions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {visible.map((b, i) => {
                    const id = boatId(b)
                    const prov = b.provider as any
                    const provName = prov?.business?.businessName || prov?.name || b.providerId?.business?.businessName || b.providerId?.name || b.ownerName || translatePortalText('Independent')
                    const provEmail = prov?.email || b.providerId?.email || ''
                    const docCount = b.documents?.length ?? 0
                    const hasAiReviewed = b.documents?.some(d => d.reviewStatus === 'approved')
                    const hasAiNeedsReview = b.documents?.some(d => d.reviewStatus === 'needs_review' || d.aiDocumentId)
                    const isPending = b.approvalStatus === 'pending'
                    const isApproved = b.approvalStatus === 'approved'
                    const isRejected = b.approvalStatus === 'rejected'

                    return (
                      <motion.tr
                        key={id || i}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(i * 0.02, 0.3) }}
                        className="transition hover:bg-slate-50/70"
                      >
                        {/* Boat & Code */}
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-3">
                            <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-slate-100 border border-slate-200/60 shadow-sm">
                              {b.images?.[0] ? (
                                <img src={fileUrl(b.images[0])} alt={b.name} className="h-full w-full object-cover" />
                              ) : (
                                <div className="flex h-full items-center justify-center text-xl">
                                  {CATEGORY_ICON[b.category] || '🛥️'}
                                </div>
                              )}
                            </div>
                            <div className="min-w-0">
                              <button
                                onClick={() => openDetail(b)}
                                className="font-extrabold text-deep-900 hover:text-sky-600 transition truncate text-left block text-[13px]"
                              >
                                {b.name}
                              </button>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="font-mono text-[10.5px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                  {b.code}
                                </span>
                                <span className="text-[11px] text-slate-400 capitalize">
                                  {CATEGORY_ICON[b.category]} {b.category?.replace(/_/g, ' ')}
                                </span>
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Provider / Location */}
                        <td className="py-3.5 px-4">
                          <div className="min-w-0 max-w-[200px]">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="font-bold text-deep-900 truncate flex items-center gap-1">
                                <Ship size={12} className="text-slate-400 shrink-0" />
                                {provName}
                              </p>
                              {isDiverBoat(b) && (
                                <span className="inline-flex items-center gap-0.5 rounded bg-sky-50 px-1.5 py-0.2 text-[9px] font-extrabold text-sky-700 ring-1 ring-sky-200">
                                  {translatePortalText("\r\n                                  🤿 Scuba Diver\r\n                                ")}</span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-500 truncate flex items-center gap-1 mt-0.5">
                              <MapPin size={11} className="text-slate-400 shrink-0" />
                              {b.city ? `${b.city}${b.marina ? ` · ${b.marina}` : ''}` : translatePortalText('Location unassigned')}
                            </p>
                            {provEmail && <p className="text-[10px] text-slate-400 truncate mt-0.5">{provEmail}</p>}
                          </div>
                        </td>

                        {/* Specs & Capacity */}
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="space-y-0.5">
                            <p className="font-semibold text-deep-900 flex items-center gap-1.5">
                              <Users size={12} className="text-slate-400" />
                              <span>{formatPortalNumber(b.capacity)} {translatePortalText('pax')}</span>
                              <span className="text-slate-300">·</span>
                              <span>{formatPortalNumber(b.lengthFt)} {translatePortalText('ft')}</span>
                            </p>
                            <p className="text-[10.5px] text-slate-400 truncate max-w-[140px]">
                              {[b.manufacturer, b.model, b.yearBuilt].filter(Boolean).join(' ') || translatePortalText('Standard build')}
                            </p>
                          </div>
                        </td>

                        {/* Documents & AI */}
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          {isDiverBoat(b) ? (
                            <span className="inline-flex items-center gap-1 rounded-lg bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700">
                              🤿 {translatePortalText("Not required")}
                            </span>
                          ) : docCount > 0 ? (
                            <button
                              onClick={() => openDetail(b)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50/80 px-2.5 py-1 text-[11px] font-semibold text-sky-700 hover:bg-sky-100 transition"
                            >
                              <FileText size={12} />
                              <span>{formatPortalNumber(docCount)} {translatePortalText(docCount !== 1 ? "docs" : "doc")}</span>
                              {hasAiReviewed ? (
                                <span title={translatePortalText("AI Approved")}><ShieldCheck size={12} className="text-emerald-600" /></span>
                              ) : hasAiNeedsReview ? (
                                <span title={translatePortalText("AI Reviewed")}><Sparkles size={11} className="text-amber-500" /></span>
                              ) : null}
                            </button>
                          ) : (
                            <span className="text-slate-400 italic text-[11px]">{translatePortalText("No docs")}</span>
                          )}
                        </td>

                        {/* Submission Date */}
                        <td className="py-3.5 px-4 whitespace-nowrap text-slate-500 text-[11px]">
                          <div className="flex items-center gap-1">
                            <Calendar size={11} className="text-slate-400" />
                            <span>{formatPortalDate(new Date(b.createdAt))}</span>
                          </div>
                        </td>

                        {/* Status */}
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="flex flex-col gap-1">
                            <span className={`inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${approvalBadgeClass(b.approvalStatus)}`}>
                              {isPending && <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />}
                              {isApproved && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
                              {isRejected && <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />}
                              <span className="capitalize">{translatePortalText(b.approvalStatus)}</span>
                            </span>
                            {isRejected && b.approvalReason && (
                              <span className="text-[10px] text-rose-600 font-medium max-w-[140px] truncate" title={b.approvalReason}>
                                {b.approvalReason}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Actions */}
                        <td className="sticky end-0 z-[1] bg-white py-3.5 px-4 text-right whitespace-nowrap shadow-[-12px_0_12px_-12px_rgba(15,23,42,0.18)]">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => openDetail(b)}
                              className="btn-ghost !py-1 !px-2 text-[11px] font-bold"
                              title={translatePortalText("View full specs, documents & details")}
                            >
                              <Eye size={12} className="me-1 inline" /> {translatePortalText("Details")}
                            </button>

                            {isPending && (
                              <>
                                <button
                                  disabled={busyId === id}
                                  onClick={() => void approveWithChecks(b)}
                                  className="btn-admin !py-1 !px-2.5 text-[11px] font-bold disabled:opacity-60"
                                >
                                  <Check size={12} className="me-1 inline" /> {translatePortalText("Approve")}
                                </button>
                                <button
                                  disabled={busyId === id}
                                  onClick={() => { setRejecting(b); setReason('') }}
                                  className="btn-ghost !py-1 !px-2 text-[11px] !text-rose-500 hover:!bg-rose-50 font-bold"
                                  title={translatePortalText("Reject boat submission")}
                                >
                                  <X size={12} />
                                </button>
                              </>
                            )}

                            {isRejected && (
                              <button
                                disabled={busyId === id}
                                onClick={() => void approveWithChecks(b)}
                                className="btn-admin !py-1 !px-2.5 text-[11px] font-bold disabled:opacity-60"
                              >
                                <Check size={12} className="me-1 inline" /> {translatePortalText(" Approve\r\n                              ")}</button>
                            )}

                            {isApproved && (
                              <button
                                disabled={busyId === id}
                                onClick={() => { setRejecting(b); setReason('') }}
                                className="btn-ghost !py-1 !px-2 text-[11px] !text-rose-500 hover:!bg-rose-50 font-bold"
                              >
                                <X size={12} className="me-1 inline" /> {translatePortalText("Revoke")}
                              </button>
                            )}
                          </div>
                        </td>
                      </motion.tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((b, i) => {
              const id = boatId(b)
              return (
                <motion.div key={id || i} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.04, 0.4) }}
                  className={`card overflow-hidden ${b.approvalStatus === 'pending' ? 'ring-2 ring-amber-300' : ''}`}>

                  {/* Boat thumbnail */}
                  <div className="relative h-36 bg-slate-100 overflow-hidden">
                    {b.images?.[0]
                      ? <img src={fileUrl(b.images[0])} alt={b.name} className="h-full w-full object-cover" />
                      : <div className="flex h-full items-center justify-center text-4xl">{CATEGORY_ICON[b.category] || '🛥️'}</div>}
                    <span className={`absolute end-2 top-2 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${approvalBadgeClass(b.approvalStatus)}`}>
                      {translatePortalText(b.approvalStatus)}
                    </span>
                  </div>

                  <div className="p-4">
                    <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                      <p className="truncate text-[14px] font-extrabold text-deep-900">{b.name}</p>
                      {isDiverBoat(b) && (
                        <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[9px] font-extrabold text-sky-700 ring-1 ring-sky-200">
                          {translatePortalText("\r\n                          🤿 Scuba Diver\r\n                        ")}</span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 mb-2">{b.code} · {b.category?.replace(/_/g, ' ')}</p>

                    <div className="space-y-1 text-[11.5px] text-slate-500">
                      {b.provider && (
                        <p className="flex items-center gap-1.5">
                          <Ship size={11} className="text-slate-400" />
                          {(b.provider as any).business?.businessName || (b.provider as any).name}
                        </p>
                      )}
                      <p className="flex items-center gap-1.5"><MapPin size={11} className="text-slate-400" />{[b.city, b.marina].filter(Boolean).join(' · ') || translatePortalText('Location unassigned')}</p>
                      <p className="flex items-center gap-1.5"><Users size={11} className="text-slate-400" />{formatPortalNumber(b.capacity)} {translatePortalText('pax')} · {formatPortalNumber(b.lengthFt)} {translatePortalText('ft')}</p>
                      <p className="flex items-center gap-1.5"><Calendar size={11} className="text-slate-400" />
                        {formatPortalDate(new Date(b.createdAt))}
                      </p>
                      {isDiverBoat(b) ? (
                        <p className="text-[10.5px] font-semibold text-sky-600">
                          🤿 {translatePortalText("Document-free (Diver vessel)")}
                        </p>
                      ) : (b.documents?.length ?? 0) > 0 ? (
                        <p className="flex items-center gap-1.5"><FileText size={11} className="text-sky-500" />
                          {formatPortalNumber(b.documents.length)} {translatePortalText(b.documents.length !== 1 ? 'documents' : 'document')}
                        </p>
                      ) : null}
                    </div>

                    {b.approvalStatus === 'rejected' && b.approvalReason && (
                      <p className="mt-2 rounded-lg bg-rose-50 px-2.5 py-1.5 text-[11px] font-semibold text-rose-600 line-clamp-2">
                        {translatePortalText("Reason:")} {b.approvalReason}
                      </p>
                    )}

                    <div className="mt-3 flex gap-1.5 border-t border-slate-100 pt-3">
                      <button onClick={() => openDetail(b)} className="btn-ghost flex-1 !justify-center !py-1.5 !text-[11px]">
                        {translatePortalText("\r\n                        View Details\r\n                      ")}</button>
                      {b.approvalStatus === 'pending' && (<>
                        <button disabled={busyId === id}
                          onClick={() => void approveWithChecks(b)}
                          className="btn-admin flex-1 !justify-center !py-1.5 !text-[11px] disabled:opacity-60">
                          <Check size={12} /> {translatePortalText(" Approve\r\n                        ")}</button>
                        <button disabled={busyId === id}
                          onClick={() => { setRejecting(b); setReason('') }}
                          className="btn-ghost !justify-center !py-1.5 !px-2.5 !text-[11px] !text-rose-500">
                          <X size={12} />
                        </button>
                      </>)}
                      {b.approvalStatus === 'rejected' && (
                        <button disabled={busyId === id}
                          onClick={() => void approveWithChecks(b)}
                          className="btn-admin flex-1 !justify-center !py-1.5 !text-[11px] disabled:opacity-60">
                          <Check size={12} /> {translatePortalText(" Approve\r\n                        ")}</button>
                      )}
                      {b.approvalStatus === 'approved' && (
                        <button disabled={busyId === id}
                          onClick={() => { setRejecting(b); setReason('') }}
                          className="btn-ghost flex-1 !justify-center !py-1.5 !text-[11px] !text-rose-500">
                          <X size={12} /> {translatePortalText(" Revoke\r\n                        ")}</button>
                      )}
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </div>
        )
      )}
      <TablePagination state={tf} noun="boats" />

      {/* Reject / Revoke modal */}
      <Modal open={!!rejecting} onClose={() => setRejecting(null)}
        title={`${rejecting?.approvalStatus === 'approved' ? translatePortalText('Revoke') : translatePortalText('Reject')} "${rejecting?.name || ''}"`}>
        <p className="mb-2 text-sm text-slate-500">
          {translatePortalText("Provide a clear reason so the provider understands what to update before resubmitting for verification:")}
        </p>

        {/* Quick Reason Suggestions */}
        <div className="mb-3 flex flex-wrap gap-1.5">
          {[
            'Missing or blurry boat registration document',
            'Expired vessel registration certificate',
            'Vessel capacity exceeds certified limit',
            'Engine / machinery specs do not match registration',
            'Missing captain identification or license',
            'Insurance certificate is expired or invalid',
          ].map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setReason(preset)}
              className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-600 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 transition"
            >
              + {preset}
            </button>
          ))}
        </div>

        <textarea className="input min-h-[90px]" dir="auto" value={reason} onChange={e => setReason(e.target.value)}
          placeholder={translatePortalText("e.g. Boat licence document is missing — please upload a valid copy.")} />
        {/* Revoking only flips the boat's approval (rejectBoat on the API) —
            trips already published on it are not paused, and their bookings stand. */}
        {rejecting?.approvalStatus === 'approved' && (
          <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-800">
            {translatePortalText("Trips already published with this boat stay live — revoking does not pause them or cancel their bookings. Pause them from the trip listings if needed.")}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setRejecting(null)}>{translatePortalText("Cancel")}</button>
          <button className="btn-admin !bg-gradient-to-r !from-rose-500 !to-rose-600 disabled:opacity-60" disabled={!!busyId || reason.trim().length < 3} onClick={doReject}>
            {rejecting?.approvalStatus === 'approved' ? translatePortalText('Revoke approval') : translatePortalText('Reject boat')}
          </button>
        </div>
      </Modal>

      {/* Detail modal */}
      <Modal open={!!detail} onClose={() => setDetail(null)}
        title={detail ? `${CATEGORY_ICON[detail.category] || '🛥️'} ${detail.name} (${detail.code})` : ''} wide>
        {detail && (
          <div className="space-y-5 text-sm">

            {/* Image gallery */}
            {(detail.images?.length ?? 0) > 0 && (
              <div>
                <div className="relative mb-2 h-52 overflow-hidden rounded-xl bg-slate-100">
                  <img src={fileUrl(detail.images[imgIdx])} alt=""
                    className="h-full w-full object-cover" />
                  {detail.images.length > 1 && (
                    <div className="absolute bottom-2 end-2 flex gap-1">
                      {detail.images.map((_, idx) => (
                        <button key={idx} onClick={() => setImgIdx(idx)}
                          className={`h-2 w-2 rounded-full transition ${idx === imgIdx ? 'bg-white' : 'bg-white/40'}`} />
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {detail.images.map((img, idx) => (
                    <button key={idx} onClick={() => setImgIdx(idx)}
                      className={`shrink-0 h-14 w-14 overflow-hidden rounded-lg ring-2 transition ${idx === imgIdx ? 'ring-sky-400' : 'ring-transparent'}`}>
                      <img src={fileUrl(img)} alt="" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Quick Overview Badges */}
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-sky-50 px-3 py-1.5 font-bold text-sky-700">
                <span>{CATEGORY_ICON[detail.category] || '🛥️'}</span>
                <span className="capitalize">{detail.category?.replace(/_/g, ' ')}</span>
              </span>
              <span className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-bold ${approvalBadgeClass(detail.approvalStatus)}`}>
                <span className="capitalize">{translatePortalText("Status: ")}{detail.approvalStatus}</span>
              </span>
              {detail.code && (
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 font-mono font-bold text-slate-700">
                  {detail.code}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-1.5 font-bold text-amber-700">
                <MapPin size={13} /> {detail.city} · {detail.marina}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 font-bold text-emerald-700">
                <Users size={13} /> {formatPortalNumber(detail.capacity)} {translatePortalText(" Passengers\r\n              ")}</span>
            </div>

            {/* Vessel Specifications & Dimensions */}
            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2 text-slate-800 font-bold text-xs">
                <Anchor size={15} className="text-sky-500" />
                <span>{translatePortalText("Vessel Dimensions & Build")}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                {[
                  ['Make & Model', [detail.manufacturer, detail.model].filter(Boolean).join(' ') || '—'],
                  ['Year Built', detail.yearBuilt ? formatPortalNumber(detail.yearBuilt) : '—'],
                  ['Length', `${formatPortalNumber(detail.lengthFt)} ${translatePortalText('ft')}`],
                  ['Beam (Width)', detail.beamFt ? `${formatPortalNumber(detail.beamFt)} ${translatePortalText('ft')}` : '—'],
                  ['Draft (Depth)', detail.draftFt ? `${formatPortalNumber(detail.draftFt)} ${translatePortalText('ft')}` : '—'],
                  ['Gross Tonnage', detail.grossTonnage ? `${formatPortalNumber(detail.grossTonnage)} ${translatePortalText('GT')}` : '—'],
                  ['Displacement', detail.displacementKg ? `${formatPortalNumber(detail.displacementKg)} ${translatePortalText('kg')}` : '—'],
                  ['Hull Material', detail.hullMaterial?.replace(/_/g, ' ') || '—'],
                  ['Pax Capacity', `${formatPortalNumber(detail.capacity)} ${translatePortalText('pax')}`],
                  ['Crew Capacity', detail.crewCapacity ? `${formatPortalNumber(detail.crewCapacity)} ${translatePortalText('crew')}` : '—'],
                  ['Cabins / Berths', `${detail.cabins == null ? '—' : formatPortalNumber(detail.cabins)} / ${detail.berths == null ? '—' : formatPortalNumber(detail.berths)}`],
                  ['Heads (Bathrooms)', detail.heads == null ? '—' : formatPortalNumber(detail.heads)],
                ].map(([l, v]) => (
                  <div key={l as string} className="rounded-xl bg-sand/60 px-3 py-2">
                    <p className="text-[10px] font-bold uppercase text-slate-400">{translatePortalText(String(l))}</p>
                    <p className="font-bold text-deep-900 truncate capitalize">{String(v)}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Machinery & Propulsion */}
            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2 text-slate-800 font-bold text-xs">
                <Wrench size={15} className="text-amber-500" />
                <span>{translatePortalText("Engine, Propulsion & Machinery")}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                {[
                  ['Engine Setup', detail.engine?.count ? `${formatPortalNumber(detail.engine.count)}× ${translatePortalText(detail.engine.type?.replace(/_/g, ' ') || 'Engine')}` : (translatePortalText(detail.engine?.type?.replace(/_/g, ' ') || '—'))],
                  ['Horsepower', detail.engine?.horsepowerHp ? `${formatPortalNumber(detail.engine.horsepowerHp)} HP` : '—'],
                  ['Engine Make/Model', [detail.engine?.manufacturer, detail.engine?.model].filter(Boolean).join(' ') || '—'],
                  ['Fuel Type', detail.engine?.fuelType ? detail.engine.fuelType.toUpperCase() : '—'],
                  ['Engine Hours', detail.engine?.engineHours ? `${formatPortalNumber(detail.engine.engineHours)} hrs` : '—'],
                  ['Fuel Tank Volume', detail.fuelCapacityL ? `${formatPortalNumber(detail.fuelCapacityL)} L` : '—'],
                  ['Fresh Water Tank', detail.freshWaterCapacityL ? `${formatPortalNumber(detail.freshWaterCapacityL)} L` : '—'],
                  ['Black Water Tank', detail.blackWaterCapacityL ? `${formatPortalNumber(detail.blackWaterCapacityL)} L` : '—'],
                  ['Cruise / Max Speed', (detail.cruiseSpeedKn || detail.maxSpeedKn) ? `${detail.cruiseSpeedKn ? formatPortalNumber(detail.cruiseSpeedKn) : '—'} / ${detail.maxSpeedKn ? formatPortalNumber(detail.maxSpeedKn) : '—'} kn` : '—'],
                  ['Cruising Range', detail.rangeNm ? `${formatPortalNumber(detail.rangeNm)} NM` : '—'],
                  ['Engine Year', detail.engine?.year ? formatPortalNumber(detail.engine.year) : '—'],
                  ['Engine Serials', detail.engine?.serialNumbers?.filter(Boolean).join(', ') || '—'],
                ].map(([l, v]) => (
                  <div key={l as string} className="rounded-xl bg-sand/60 px-3 py-2">
                    <p className="text-[10px] font-bold uppercase text-slate-400">{translatePortalText(String(l))}</p>
                    <p className="font-bold text-deep-900 truncate capitalize">{String(v)}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Registration, Legal & Compliance */}
            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2 text-slate-800 font-bold text-xs">
                <Shield size={15} className="text-emerald-500" />
                <span>{translatePortalText("Registration, Legal & Identification")}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                {[
                  ['Owner Name', detail.ownerName || '—'],
                  ['Owner National ID', detail.ownerId || '—'],
                  ['Registration No.', detail.registrationNumber || '—'],
                  ['Registration Expiry', detail.registrationExpiry ? formatPortalDate(new Date(detail.registrationExpiry)) : '—'],
                  ['Vessel Licence', detail.vesselLicense || '—'],
                  ['Hull ID (HIN)', detail.hullId || '—'],
                  ['Flag State', detail.flag || '—'],
                  ['Port of Registry', detail.portOfRegistry || '—'],
                  ['Insurance Provider', detail.insuranceProvider || '—'],
                  ['Policy Number', detail.insurancePolicyNumber || '—'],
                  ['Insurance Expiry', detail.insuranceExpiry ? formatPortalDate(new Date(detail.insuranceExpiry)) : '—'],
                  ['VHF Channel', detail.vhfChannel ? `CH ${detail.vhfChannel}` : '—'],
                  ['MMSI Number', detail.mmsi || '—'],
                  ['IMO Number', detail.imo || '—'],
                  ['Call Sign', detail.callSign || '—'],
                  ['Country of Origin', detail.countryOfOrigin || '—'],
                ].map(([l, v]) => (
                  <div key={l as string} className="rounded-xl bg-sand/60 px-3 py-2">
                    <p className="text-[10px] font-bold uppercase text-slate-400">{translatePortalText(String(l))}</p>
                    <p className="font-bold text-deep-900 truncate">{String(v)}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Captain & Operations */}
            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2 text-slate-800 font-bold text-xs">
                <User size={15} className="text-indigo-500" />
                <span>{translatePortalText("Captain & Operational Logistics")}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                {[
                  ['Captain Name', detail.captain?.name || '—'],
                  ['Captain License', detail.captain?.licenseNumber || '—'],
                  ['Captain Phone', detail.captain?.phone || '—'],
                  ['Experience', detail.captain?.yearsExperience ? `${formatPortalNumber(detail.captain.yearsExperience)} yrs` : '—'],
                  ['Home Berth', detail.homeBerth || '—'],
                  ['Turnaround Time', detail.turnaroundMinutes ? `${formatPortalNumber(detail.turnaroundMinutes)} min` : '—'],
                  ['Operating Hours', (detail.operatingWindow?.from && detail.operatingWindow?.to) ? `${detail.operatingWindow.from} – ${detail.operatingWindow.to}` : 'No restriction'],
                  ['Pickup Address', detail.pickupAddress || '—'],
                ].map(([l, v]) => (
                  <div key={l as string} className="rounded-xl bg-sand/60 px-3 py-2">
                    <p className="text-[10px] font-bold uppercase text-slate-400">{translatePortalText(String(l))}</p>
                    <p className="font-bold text-deep-900 truncate">{String(v)}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Safety & Navigation Equipment */}
            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm space-y-3">
              <div className="flex items-center gap-2 text-slate-800 font-bold text-xs">
                <LifeBuoy size={15} className="text-rose-500" />
                <span>{translatePortalText("Safety & Navigation Equipment")}</span>
              </div>
              
              <div>
                <p className="text-[10px] font-bold uppercase text-slate-400 mb-1.5">
                  {translatePortalText("\r\n                  Safety Equipment ")}{detail.lifeJacketCount ? `(${translatePortalText('Life Jackets: ')}${formatPortalNumber(detail.lifeJacketCount)})` : ''}
                </p>
                {(!detail.safetyEquipment || detail.safetyEquipment.length === 0) ? (
                  <p className="text-xs text-slate-400 italic">{translatePortalText("None specified")}</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {detail.safetyEquipment.map((eq) => (
                      <span key={eq} className="rounded-lg bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700 capitalize">
                        🛡️ {eq.replace(/_/g, ' ')}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="text-[10px] font-bold uppercase text-slate-400 mb-1.5">{translatePortalText("Navigation Equipment")}</p>
                {(!detail.navigationEquipment || detail.navigationEquipment.length === 0) ? (
                  <p className="text-xs text-slate-400 italic">{translatePortalText("None specified")}</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {detail.navigationEquipment.map((eq) => (
                      <span key={eq} className="rounded-lg bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 capitalize">
                        🧭 {eq.replace(/_/g, ' ')}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {detail.amenities && detail.amenities.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase text-slate-400 mb-1.5">{translatePortalText("Onboard Amenities")}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {detail.amenities.map((am, i) => (
                      <span key={i} className="rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                        ✨ {translatePortalText(am.label)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Provider */}
            {detail.provider && (
              <div>
                <p className="label">{translatePortalText("Provider")}</p>
                <div className="rounded-xl border border-slate-100 p-3 text-slate-600 space-y-0.5">
                  <p className="font-bold text-deep-900">{(detail.provider as any).business?.businessName || (detail.provider as any).name}</p>
                  <p className="text-xs text-slate-400">{(detail.provider as any).email}</p>
                </div>
              </div>
            )}

            {/* Description */}
            {detail.description && (
              <div>
                <p className="label">{translatePortalText("Description")}</p>
                <p className="rounded-xl border border-slate-100 p-3 text-slate-600 text-sm leading-relaxed">{detail.description}</p>
              </div>
            )}

            {/* Documents */}
            <div>
              <p className="label">{translatePortalText("Documents (")}{formatPortalNumber(detail.documents?.length || 0)})</p>
              {(!detail.documents || detail.documents.length === 0)
                ? <p className="text-xs text-slate-400 italic">{translatePortalText("No documents uploaded by the provider.")}</p>
                : (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {detail.documents.map((doc, idx) => {
                      const url = fileUrl(doc.fileUrl)
                      const isPdf = doc.fileUrl?.toLowerCase().endsWith('.pdf')
                      const extracted = Object.entries(doc.extractedData || {})
                      const confidence = doc.confidence == null ? null : Math.round(Number(doc.confidence))
                      const status = doc.reviewStatus || (doc.aiDocumentId ? 'needs_review' : 'not_analyzed')
                      return (
                        <div key={idx} className="rounded-xl border border-slate-100 bg-white p-2">
                          <div className="flex items-center gap-1.5">
                            <a href={url} target="_blank" rel="noreferrer"
                              className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg bg-sand px-3 py-2.5 text-slate-600 hover:text-sky-600 hover:bg-sky-50 transition">
                              {isPdf
                                ? <FileText size={16} className="shrink-0 text-rose-700 dark:text-rose-400" />
                                : <ImageIcon size={16} className="shrink-0 text-sky-700 dark:text-sky-400" />}
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[12px] font-semibold">{translatePortalText(doc.label)}</p>
                                <p className="text-[10px] text-slate-400">{formatPortalDate(new Date(doc.uploadedAt))}</p>
                              </div>
                              <ExternalLink size={13} className="shrink-0 opacity-40" />
                            </a>
                            {doc.aiDocumentId ? (
                              <button
                                className="btn-ghost shrink-0 !px-2 !py-2 text-[10px]"
                                onClick={async () => {
                                  try { setAiDocument((await aiDocumentApi.detail(doc.aiDocumentId!)).data.document) }
                                  catch { toast(translatePortalText('Could not load AI review'), 'warn') }
                                }}
                              >
                                <ShieldCheck size={13} /> {translatePortalText("AI response")}
                              </button>
                            ) : (
                              <span className="shrink-0 rounded-lg bg-slate-100 px-2 py-2 text-[10px] font-semibold text-slate-400">
                                {translatePortalText("No AI record")}
                              </span>
                            )}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2 text-[10px]">
                            <span className={`rounded-full px-2 py-0.5 font-bold ${status === 'approved' ? 'bg-emerald-100 text-emerald-700' : status === 'rejected' || status === 'failed' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                              {translatePortalText("\r\n                              AI: ")}{translatePortalText(status.replace(/_/g, ' '))}
                            </span>
                            {confidence != null && <span className="text-slate-500">{translatePortalText("Confidence: ")}<b className="text-slate-700">{formatPortalPercent(confidence)}</b></span>}
                            {extracted.length > 0 && <span className="text-slate-500">{formatPortalNumber(extracted.length)} {translatePortalText(" extracted field")}{extracted.length === 1 ? '' : 's'}</span>}
                          </div>
                          {extracted.length > 0 && (
                            <div className="mt-2 grid gap-1 sm:grid-cols-2">
                              {extracted.slice(0, 4).map(([key, field]) => (
                                <div key={key} className="min-w-0 rounded-lg bg-slate-50 px-2 py-1.5">
                                  <p className="truncate text-[9px] font-bold uppercase text-slate-400">{translatePortalText(key.replace(/([A-Z])/g, ' $1'))}</p>
                                  <p className="truncate text-[11px] font-semibold text-slate-700">{typeof field?.value === 'number' ? formatPortalNumber(field.value) : String(field?.value ?? '—')}</p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
            </div>

            {/* Rejection reason */}
            {detail.approvalStatus === 'rejected' && detail.approvalReason && (
              <div className="rounded-xl bg-rose-50 p-3">
                <p className="text-[11px] font-bold uppercase text-rose-700 dark:text-rose-400 mb-1">{translatePortalText("Rejection Reason")}</p>
                <p className="text-sm text-rose-700">{detail.approvalReason}</p>
              </div>
            )}

            {/* Footer actions */}
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
              {detail.approvalStatus === 'pending' && (<>
                <button className="btn-ghost !text-rose-500"
                  onClick={() => { setDetail(null); setRejecting(detail); setReason('') }}>
                  {translatePortalText("\r\n                  Reject\r\n                ")}</button>
                <button className="btn-admin disabled:opacity-60" disabled={!!busyId}
                  onClick={() => void approveWithChecks(detail)}>
                  <ShieldCheck size={14} /> {translatePortalText("Approve Boat")}
                </button>
              </>)}
              {detail.approvalStatus === 'rejected' && (
                <button className="btn-admin disabled:opacity-60" disabled={!!busyId}
                  onClick={() => void approveWithChecks(detail)}>
                  <Check size={14} /> {translatePortalText("Approve Boat")}
                </button>
              )}
              {detail.approvalStatus === 'approved' && (
                <button className="btn-ghost !text-rose-500"
                  onClick={() => { setDetail(null); setRejecting(detail); setReason('') }}>
                  {translatePortalText("Revoke Approval")}
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>
      <AiDocumentVerificationModal
        document={aiDocument}
        isOpen={!!aiDocument}
        onClose={() => setAiDocument(null)}
        onStatusUpdated={(updated) => {
          setAiDocument(updated)
          void load()
        }}
      />
    </PageWrap>
  )
}
