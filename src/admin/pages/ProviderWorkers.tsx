import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { TableToolbar, useTableFilters, type TableFiltersConfig } from '../../shared/TableFilters'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Users, Check, X, Eye, ShieldCheck, Clock, CheckCircle2,
  XCircle, AlertCircle, Search, Filter, RefreshCw,
  Mail, Building2, MapPin, Calendar, FileText, UserCheck, ShieldAlert
} from 'lucide-react'
import { adminPortalApi, type AdminWorkerApproval, type WorkerApprovalStatus } from '../../api'
import { translatePortalText  , formatPortalDate, formatPortalNumber} from '../../i18n/runtime'
import { AdminHeader, ViewToggle } from '../adminUi'
import { PageWrap, seededAvatar } from './_shared'
import { Section, toast, Modal } from '../../ui'
import type { DomainCfg } from './ProviderDomain'

export function ProviderWorkers({ cfg }: { cfg: DomainCfg }) {
  const kind = cfg.slug as 'fuel' | 'marina' | 'maintenance' | 'boat'

  const [items, setItems] = useState<AdminWorkerApproval[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending')
  const [view, setView] = useState<'card' | 'table'>('table')
  const [busyId, setBusyId] = useState<string | null>(null)

  // Modals state
  const [viewingWorker, setViewingWorker] = useState<AdminWorkerApproval | null>(null)
  const [rejectingWorker, setRejectingWorker] = useState<AdminWorkerApproval | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [rejectBusy, setRejectBusy] = useState(false)

  // A failed load used to leave "No worker requests found" on screen — an empty
  // queue, as far as anyone reading it could tell.
  const [loadError, setLoadError] = useState<string | null>(null)
  // Latest request only: switching vertical mid-load must not let the older
  // vertical's queue land here.
  const loadSeq = useRef(0)

  const loadWorkers = useCallback(async (isSilent = false) => {
    const seq = ++loadSeq.current
    if (!isSilent) setLoading(true)
    else setRefreshing(true)
    try {
      const res = await adminPortalApi.workerApprovals('all', kind)
      if (seq !== loadSeq.current) return
      setItems(res.data.items || [])
      setLoadError(null)
    } catch (err) {
      if (seq !== loadSeq.current) return
      if (isSilent) toast(translatePortalText(err instanceof Error ? err.message : 'Could not load worker requests'), 'warn')
      else { setItems([]); setLoadError(translatePortalText(err instanceof Error ? err.message : 'Could not load worker requests')) }
    } finally {
      if (seq === loadSeq.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [kind])

  useEffect(() => {
    setItems([])
    loadWorkers()
  }, [loadWorkers])

  /**
   * A rejected worker of any type can be reconsidered and approved: the server
   * (`assertWorkerDecision`) accepts rejected → approved and reactivates the
   * account. Only a worker who is not rejected has nothing to re-approve.
   */
  const canReapprove = (w: AdminWorkerApproval) => w.status === 'rejected'
  const reapproveBlockedHint = 'Re-approval is not supported for this worker type yet — the provider can add them again'

  // Counts
  const pendingCount = items.filter(w => w.status === 'pending').length
  const approvedCount = items.filter(w => w.status === 'approved').length
  const rejectedCount = items.filter(w => w.status === 'rejected').length
  const totalCount = items.length

  // Filtered items
  /**
   * The queue's filters, on the shared implementation.
   *
   * The status tabs and search box were hand-rolled here and did work — but
   * they were the only two axes available, and case-folding by
   * `toLowerCase()` alone misses Arabic: a worker whose name was entered with
   * diacritics could not be found by typing it without them, on a platform
   * where most names are Arabic.
   *
   * Moving to `useTableFilters` fixes the matching and adds what was missing:
   * which vertical the worker belongs to, when they were added, and an
   * ordering. `status` stays a tab rather than a dropdown because it is the
   * primary axis of a review queue.
   */
  const filterCfg: TableFiltersConfig<AdminWorkerApproval> = useMemo(() => ({
    searchFields: (w) => [w.name, w.email, w.role, w.providerName],
    filters: [
      {
        key: 'kind',
        label: 'Vertical',
        options: [
          { value: 'marina', label: 'Marina' },
          { value: 'fuel', label: 'Fuel' },
          { value: 'maintenance', label: 'Maintenance' },
          { value: 'boat', label: 'Boat crew' },
        ],
        get: (w) => w.kind,
      },
      { key: 'role', label: 'Role', get: (w) => w.role },
      { key: 'added', label: 'Added', kind: 'dateRange', get: (w) => w.createdAt },
    ],
    sortOptions: [
      // Oldest first by default: this is a queue, and the person who has been
      // waiting longest is the one to deal with next.
      { key: 'added', label: 'Added', get: (w) => w.createdAt, defaultDir: 'asc' },
      { key: 'name', label: 'Name', get: (w) => w.name, defaultDir: 'asc' },
      { key: 'provider', label: 'Business', get: (w) => w.providerName, defaultDir: 'asc' },
    ],
    defaultSort: 'added',
    defaultPageSize: 0,
  }), [])

  // Status stays outside the shared config so it can drive the tab strip.
  const byStatus = useMemo(
    () => (statusFilter === 'all' ? items : items.filter(w => w.status === statusFilter)),
    [items, statusFilter]
  )
  const tf = useTableFilters(byStatus, filterCfg)
  const filtered = tf.filtered

  // Approve action
  const handleApprove = async (worker: AdminWorkerApproval) => {
    if (busyId) return
    setBusyId(worker.id)
    try {
      await adminPortalApi.reviewWorker(worker.kind, worker.id, 'approved')
      toast(translatePortalText(`${worker.name} approved successfully`), 'success')
      setItems(prev => prev.map(w => (w.id === worker.id ? { ...w, status: 'approved' } : w)))
      if (viewingWorker && viewingWorker.id === worker.id) {
        setViewingWorker(prev => (prev ? { ...prev, status: 'approved' } : null))
      }
    } catch (err) {
      toast(translatePortalText(err instanceof Error ? err.message : 'Approval failed'), 'warn')
      // Most often another admin decided first ("already been reviewed"); the
      // row would otherwise keep offering a decision that no longer exists.
      loadWorkers(true)
    } finally {
      setBusyId(null)
    }
  }

  // Reject action
  const openRejectModal = (worker: AdminWorkerApproval) => {
    setRejectingWorker(worker)
    setRejectReason('')
  }

  const submitReject = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!rejectingWorker || !rejectReason.trim()) return
    setRejectBusy(true)
    try {
      await adminPortalApi.reviewWorker(rejectingWorker.kind, rejectingWorker.id, 'rejected', rejectReason.trim())
      toast(translatePortalText(`${rejectingWorker.name} rejected`), 'warn')
      setItems(prev =>
        prev.map(w => (w.id === rejectingWorker.id ? { ...w, status: 'rejected', rejectionReason: rejectReason.trim() } : w))
      )
      if (viewingWorker && viewingWorker.id === rejectingWorker.id) {
        setViewingWorker(prev => (prev ? { ...prev, status: 'rejected', rejectionReason: rejectReason.trim() } : null))
      }
      setRejectingWorker(null)
    } catch (err) {
      toast(translatePortalText(err instanceof Error ? err.message : 'Rejection failed'), 'warn')
      loadWorkers(true) // see handleApprove
    } finally {
      setRejectBusy(false)
    }
  }

  const getStatusBadge = (status: WorkerApprovalStatus) => {
    switch (status) {
      case 'approved':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 border border-emerald-200">
            <CheckCircle2 size={12} /> {translatePortalText("Approved")}
          </span>
        )
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-700 border border-rose-200">
            <XCircle size={12} /> {translatePortalText("Rejected")}
          </span>
        )
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700 border border-amber-300">
            <Clock size={12} className="animate-spin-slow" /> {translatePortalText("Pending Review")}
          </span>
        )
    }
  }

  return (
    <PageWrap>
      <AdminHeader
        icon={cfg.icon}
        title={`${cfg.name} Worker Requests`}
        sub={`Review, verify, and approve staff access requests submitted by ${cfg.provPlural.toLowerCase()}.`}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => loadWorkers(true)}
              disabled={refreshing}
              className="btn-ghost !py-2 !px-3 text-xs font-bold flex items-center gap-1.5 text-slate-600 hover:text-deep-900"
              title={translatePortalText("Refresh queue")}
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
              <span>{translatePortalText("Refresh")}</span>
            </button>
            <ViewToggle view={view} onChange={setView} />
          </div>
        }
      />

      {/* KPI Stats Cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={() => setStatusFilter('pending')}
          className={`card cursor-pointer p-4 transition border ${
            statusFilter === 'pending'
              ? 'border-amber-400 bg-amber-50/70 shadow-sm ring-1 ring-amber-400'
              : 'border-slate-100 hover:border-amber-200 bg-white'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700">{translatePortalText("Pending Review")}</span>
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-amber-100 text-amber-700">
              <Clock size={14} />
            </span>
          </div>
          <p className="mt-2 font-display text-2xl font-black text-amber-800">{loading || loadError ? '—' : formatPortalNumber(pendingCount)}</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          onClick={() => setStatusFilter('approved')}
          className={`card cursor-pointer p-4 transition border ${
            statusFilter === 'approved'
              ? 'border-emerald-400 bg-emerald-50/70 shadow-sm ring-1 ring-emerald-400'
              : 'border-slate-100 hover:border-emerald-200 bg-white'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">{translatePortalText("Approved Staff")}</span>
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-100 text-emerald-700">
              <CheckCircle2 size={14} />
            </span>
          </div>
          <p className="mt-2 font-display text-2xl font-black text-emerald-800">{loading || loadError ? '—' : formatPortalNumber(approvedCount)}</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          onClick={() => setStatusFilter('rejected')}
          className={`card cursor-pointer p-4 transition border ${
            statusFilter === 'rejected'
              ? 'border-rose-400 bg-rose-50/70 shadow-sm ring-1 ring-rose-400'
              : 'border-slate-100 hover:border-rose-200 bg-white'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-rose-700">{translatePortalText("Rejected Requests")}</span>
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-rose-100 text-rose-700">
              <XCircle size={14} />
            </span>
          </div>
          <p className="mt-2 font-display text-2xl font-black text-rose-800">{loading || loadError ? '—' : formatPortalNumber(rejectedCount)}</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          onClick={() => setStatusFilter('all')}
          className={`card cursor-pointer p-4 transition border ${
            statusFilter === 'all'
              ? 'border-teal-400 bg-teal-50/70 shadow-sm ring-1 ring-teal-400'
              : 'border-slate-100 hover:border-slate-200 bg-white'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{translatePortalText("Total Registered")}</span>
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-slate-100 text-slate-600">
              <Users size={14} />
            </span>
          </div>
          <p className="mt-2 font-display text-2xl font-black text-deep-900">{loading || loadError ? '—' : formatPortalNumber(totalCount)}</p>
        </motion.div>
      </div>

      {/* Filter and Search Bar */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          {(['pending', 'approved', 'rejected', 'all'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setStatusFilter(tab)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-extrabold capitalize transition ${
                statusFilter === tab
                  ? 'bg-gradient-to-r from-emerald-600 to-teal-500 text-white shadow-glow'
                  : 'bg-white text-slate-500 hover:text-deep-900 border border-slate-200/70'
              }`}
            >
              {tab === 'pending'
                ? `${translatePortalText('Pending Review')} (${formatPortalNumber(pendingCount)})`
                : tab === 'approved'
                ? `${translatePortalText('Approved')} (${formatPortalNumber(approvedCount)})`
                : tab === 'rejected'
                ? `${translatePortalText('Rejected')} (${formatPortalNumber(rejectedCount)})`
                : `${translatePortalText('All')} (${formatPortalNumber(totalCount)})`}
            </button>
          ))}
        </div>

      </div>

      <TableToolbar
        state={tf}
        config={filterCfg}
        rows={byStatus}
        noun="workers"
        searchPlaceholder={translatePortalText(`Search ${cfg.name.toLowerCase()} workers, email or business…`)}
      />

      {/* Main List / Table */}
      {loading ? (
        <div className="card p-12 text-center text-sm text-slate-400">
          <Clock className="mx-auto mb-2 animate-spin text-emerald-500" size={24} />
          {translatePortalText("\r\n          Loading ")}{translatePortalText(cfg.name)} {translatePortalText(" worker requests…\r\n        ")}</div>
      ) : loadError ? (
        <div className="card flex flex-wrap items-center justify-between gap-3 !border-rose-200 !bg-rose-50 p-4 text-sm text-rose-700">
          <span className="flex items-center gap-2"><AlertCircle size={15} className="shrink-0" /> {loadError}</span>
          <button onClick={() => loadWorkers()} className="btn-ghost !py-1.5 !px-3 !text-xs !text-rose-700 border border-rose-200 bg-white"><RefreshCw size={12} /> {translatePortalText('Retry')}</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center text-slate-400">
          <ShieldCheck size={36} className="mx-auto mb-2 text-slate-300" />
          <p className="font-semibold text-deep-900">{translatePortalText("No worker requests found")}</p>
          <p className="mt-1 text-xs text-slate-500">
            {tf.activeCount > 0
              ? translatePortalText('No requests match your current filters.')
              : statusFilter === 'pending'
              ? translatePortalText(`There are no pending ${cfg.name.toLowerCase()} worker approvals.`)
              : translatePortalText(`No workers registered under ${statusFilter} status.`)}
          </p>
        </div>
      ) : view === 'table' ? (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto custom-scrollbar">
            <div className="min-w-[960px]">
              <div className="grid grid-cols-[2fr_1.5fr_1fr_1.2fr_auto] items-center gap-4 border-b border-slate-100 bg-sand px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <span>{translatePortalText("Worker & Contact")}</span>
                <span>{translatePortalText("Assigned Provider / Location")}</span>
                <span>{translatePortalText("Role / Title")}</span>
                <span>{translatePortalText("Status")}</span>
                <span className="text-right">{translatePortalText("Actions")}</span>
              </div>

              <div className="divide-y divide-slate-100">
                {filtered.map((worker, i) => (
                  <motion.div
                    key={worker.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.02 }}
                    className="grid grid-cols-[2fr_1.5fr_1fr_1.2fr_auto] items-center gap-4 px-5 py-3.5 transition hover:bg-sand/60"
                  >
                    {/* Worker info */}
                    <div className="flex items-center gap-3 min-w-0">
                      <img
                        src={seededAvatar(worker.name || worker.id)}
                        alt={worker.name}
                        className="h-10 w-10 shrink-0 rounded-full border border-slate-200 object-cover shadow-sm"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-extrabold text-deep-900">{worker.name}</p>
                        <p className="truncate text-xs text-slate-500">{worker.email || 'No email provided'}</p>
                        <p className="mt-0.5 text-[10px] font-semibold text-slate-400">
                          {translatePortalText("\r\n                          Requested ")}{formatPortalDate(new Date(worker.createdAt), { dateStyle: 'medium' })}
                        </p>
                      </div>
                    </div>

                    {/* Provider / Station */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-deep-900">
                        <Building2 size={13} className="text-amber-500 shrink-0" />
                        <span className="truncate">{worker.providerName}</span>
                      </div>
                      {/* Their real assignment — a crew member's boats, a
                          station, a marina. This was the fixed text
                          "<kind> station / facility" on every row. */}
                      {worker.location && <p className="truncate text-[11px] text-slate-400" title={worker.location}>{worker.location}</p>}
                    </div>

                    {/* Role */}
                    <div>
                      <span className="inline-block rounded-lg bg-sand px-2.5 py-1 text-xs font-bold text-slate-700 border border-slate-200/60 whitespace-nowrap">
                        {/* No invented "Staff Attendant" for a worker with no role on record. */}
                        {translatePortalText(worker.role || 'Role not set')}
                      </span>
                    </div>

                    {/* Status */}
                    <div className="whitespace-nowrap">
                      {getStatusBadge(worker.status)}
                      {/* Marina staff can be approved before they accept: say which step they are on. */}
                      {worker.stage === 'invited' && (
                        <p className="mt-1 text-[11px] text-sky-700">{translatePortalText('Invite not accepted yet')}</p>
                      )}
                      {worker.stage === 'pending_approval' && worker.status === 'pending' && (
                        <p className="mt-1 text-[11px] text-amber-700">{translatePortalText('Accepted — waiting on you')}</p>
                      )}
                      {worker.rejectionReason && worker.status === 'rejected' && (
                        <p className="mt-1 text-[11px] text-rose-600 line-clamp-1 italic">
                          "{worker.rejectionReason}"
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                      <button
                        onClick={() => setViewingWorker(worker)}
                        className="btn-ghost !py-1.5 !px-2.5 !text-xs text-slate-700 hover:bg-slate-100"
                        title={translatePortalText("View Profile")}
                      >
                        <Eye size={13} />
                        <span>{translatePortalText("Details")}</span>
                      </button>

                      {worker.status === 'pending' && (
                        <>
                          <button
                            disabled={busyId === worker.id}
                            onClick={() => handleApprove(worker)}
                            className="btn-admin !py-1.5 !px-2.5 !text-xs disabled:opacity-60"
                            title={translatePortalText("Approve worker access")}
                          >
                            <Check size={13} />
                            <span>{translatePortalText("Approve")}</span>
                          </button>
                          <button
                            disabled={busyId === worker.id}
                            onClick={() => openRejectModal(worker)}
                            className="btn-ghost !py-1.5 !px-2.5 !text-xs !text-rose-600 hover:bg-rose-50 disabled:opacity-60"
                            title={translatePortalText("Reject worker request")}
                          >
                            <X size={13} />
                            <span>{translatePortalText("Reject")}</span>
                          </button>
                        </>
                      )}

                      {worker.status === 'rejected' && (
                        <button
                          disabled={busyId === worker.id || !canReapprove(worker)}
                          onClick={() => handleApprove(worker)}
                          className="btn-ghost !py-1.5 !px-2.5 !text-xs text-emerald-600 hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-not-allowed"
                          title={translatePortalText(canReapprove(worker) ? "Re-approve worker" : reapproveBlockedHint)}
                        >
                          <Check size={13} />
                          <span>{translatePortalText("Re-approve")}</span>
                        </button>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Card Grid View */
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((worker, i) => (
            <motion.div
              key={worker.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className="card p-5 border border-slate-100 hover:border-slate-200 transition hover:shadow-md flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <img
                      src={seededAvatar(worker.name || worker.id)}
                      alt={worker.name}
                      className="h-12 w-12 rounded-full border border-slate-200 object-cover shadow-sm"
                    />
                    <div>
                      <h4 className="text-sm font-black text-deep-900">{worker.name}</h4>
                      <p className="text-xs text-slate-500">{worker.email || 'No email'}</p>
                    </div>
                  </div>
                  {getStatusBadge(worker.status)}
                </div>

                <div className="mt-4 space-y-2 rounded-xl bg-sand/60 p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 font-semibold">{translatePortalText("Assigned Provider:")}</span>
                    <span className="font-bold text-deep-900 truncate max-w-[160px]">{worker.providerName}</span>
                  </div>
                  {worker.location && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 font-semibold">{translatePortalText(worker.kind === 'boat' ? 'Boats:' : 'Location:')}</span>
                      <span className="font-bold text-slate-600 truncate max-w-[160px]" title={worker.location}>{worker.location}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 font-semibold">{translatePortalText("Assigned Role:")}</span>
                    <span className="font-bold text-emerald-700">{translatePortalText(worker.role)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 font-semibold">{translatePortalText("Date Requested:")}</span>
                    <span className="font-bold text-slate-600">
                      {formatPortalDate(new Date(worker.createdAt))}
                    </span>
                  </div>
                </div>

                {worker.rejectionReason && worker.status === 'rejected' && (
                  <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700">
                    <p className="font-bold">{translatePortalText("Rejection Reason:")}</p>
                    <p className="mt-0.5 text-[11px] italic">{worker.rejectionReason}</p>
                  </div>
                )}
              </div>

              <div className="mt-5 flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  onClick={() => setViewingWorker(worker)}
                  className="btn-ghost !py-1.5 !px-3 text-xs text-slate-700"
                >
                  <Eye size={13} /> {translatePortalText(" View\r\n                ")}</button>

                {worker.status === 'pending' && (
                  <>
                    <button
                      disabled={busyId === worker.id}
                      onClick={() => handleApprove(worker)}
                      className="btn-admin !py-1.5 !px-3 text-xs disabled:opacity-60"
                    >
                      <Check size={13} /> {translatePortalText(" Approve\r\n                    ")}</button>
                    <button
                      disabled={busyId === worker.id}
                      onClick={() => openRejectModal(worker)}
                      className="btn-ghost !py-1.5 !px-3 text-xs !text-rose-600 hover:bg-rose-50 disabled:opacity-60"
                    >
                      <X size={13} /> {translatePortalText(" Reject\r\n                    ")}</button>
                  </>
                )}

                {worker.status === 'rejected' && (
                  <button
                    disabled={busyId === worker.id || !canReapprove(worker)}
                    onClick={() => handleApprove(worker)}
                    className="btn-ghost !py-1.5 !px-3 text-xs text-emerald-600 hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    title={canReapprove(worker) ? undefined : translatePortalText(reapproveBlockedHint)}
                  >
                    <Check size={13} /> {translatePortalText(" Re-approve\r\n                  ")}</button>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* DETAIL MODAL */}
      <Modal open={!!viewingWorker} onClose={() => setViewingWorker(null)} title={translatePortalText("Worker Request Details")} wide>
        {viewingWorker && (
          <div className="space-y-5">
            <div className="flex flex-col sm:flex-row items-center gap-4 rounded-2xl bg-gradient-to-r from-deep-900 to-deep-800 p-5 text-white shadow-md">
              <img
                src={seededAvatar(viewingWorker.name || viewingWorker.id)}
                alt={viewingWorker.name}
                className="h-16 w-16 rounded-full border-2 border-emerald-400 object-cover shadow"
              />
              <div className="text-center sm:text-left min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                  <h3 className="text-xl font-black">{viewingWorker.name}</h3>
                  {getStatusBadge(viewingWorker.status)}
                </div>
                <p className="mt-1 text-sm font-semibold text-emerald-300">{translatePortalText(viewingWorker.role)}</p>
                <p className="text-xs text-slate-300">{viewingWorker.email || 'No email'}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-sand/50 p-4 space-y-2 text-xs">
                <p className="font-bold uppercase tracking-wider text-slate-400">{translatePortalText("Provider & Facility")}</p>
                <p className="text-sm font-black text-deep-900">{viewingWorker.providerName}</p>
                {viewingWorker.location && <p className="text-slate-500">{viewingWorker.location}</p>}
              </div>

              <div className="rounded-xl border border-slate-200 bg-sand/50 p-4 space-y-2 text-xs">
                <p className="font-bold uppercase tracking-wider text-slate-400">{translatePortalText("Request Timeline")}</p>
                <p className="text-sm font-bold text-deep-900">
                  {formatPortalDate(new Date(viewingWorker.createdAt), { dateStyle: 'full' })}
                </p>
                <p className="text-slate-500">{translatePortalText("Submitted for Super Admin Approval")}</p>
              </div>
            </div>

            {viewingWorker.rejectionReason && (
              <div className="rounded-xl border border-rose-200 bg-rose-50/80 p-4 text-xs">
                <div className="flex items-center gap-1.5 font-bold text-rose-800 uppercase tracking-wider">
                  <ShieldAlert size={14} /> {translatePortalText(" Admin Rejection Reason\r\n                ")}</div>
                <p className="mt-1 text-rose-700 leading-relaxed font-semibold">{viewingWorker.rejectionReason}</p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              {viewingWorker.status === 'pending' && (
                <>
                  <button
                    onClick={() => {
                      const w = viewingWorker
                      setViewingWorker(null)
                      openRejectModal(w)
                    }}
                    className="btn-ghost !text-rose-600 hover:bg-rose-50 text-xs font-bold"
                  >
                    <X size={14} /> {translatePortalText(" Reject Request\r\n                  ")}</button>
                  <button
                    disabled={busyId === viewingWorker.id}
                    onClick={() => handleApprove(viewingWorker)}
                    className="btn-admin text-xs font-bold"
                  >
                    <Check size={14} /> {busyId === viewingWorker.id ? translatePortalText('Approving...') : translatePortalText(" Approve Access\r\n                  ")}</button>
                </>
              )}
              <button className="btn-ghost" onClick={() => setViewingWorker(null)}>
                {translatePortalText("\r\n                Close\r\n              ")}</button>
            </div>
          </div>
        )}
      </Modal>

      {/* REJECT REASON MODAL */}
      <Modal open={!!rejectingWorker} onClose={() => setRejectingWorker(null)} title={translatePortalText("Reject Worker Request")}>
        {rejectingWorker && (
          <form onSubmit={submitReject} className="space-y-4">
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
              {translatePortalText("\r\n              You are rejecting ")}<strong>{rejectingWorker.name}</strong> {translatePortalText(" for provider ")}<strong>{rejectingWorker.providerName}</strong>{translatePortalText(". Please state the reason so the provider is informed.\r\n            ")}</div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">
                {translatePortalText("\r\n                Reason for Rejection ")}<span className="text-rose-500">*</span>
              </label>
              <textarea
                rows={3}
                required
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                placeholder={translatePortalText("e.g. Identity could not be verified, license expired, invalid station assignment...")}
                className="input text-xs w-full resize-none"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => setRejectingWorker(null)}
                disabled={rejectBusy}
              >
                {translatePortalText("\r\n                Cancel\r\n              ")}</button>
              <button
                type="submit"
                disabled={rejectBusy || !rejectReason.trim()}
                className="btn-ghost !bg-rose-600 !text-white hover:!bg-rose-700 text-xs font-bold disabled:opacity-50"
              >
                {translatePortalText(rejectBusy ? 'Rejecting...' : 'Confirm Rejection')}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </PageWrap>
  )
}
