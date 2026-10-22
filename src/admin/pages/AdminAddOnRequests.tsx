import React, { useEffect, useState, useMemo } from 'react'
import { TableToolbar, useTableFilters, type TableFiltersConfig } from '../../shared/TableFilters'
import {
  Sparkles,
  Search,
  Filter,
  CheckCircle2,
  XCircle,
  Clock,
  Check,
  X,
  CreditCard,
  Building2,
  Anchor,
  Fuel,
  Wrench,
  Sailboat,
  DollarSign,
  Send,
  AlertCircle,
  RefreshCw,
  Eye,
  Loader2,
  ChevronRight,
} from 'lucide-react'
import { Modal, toast } from '../../ui'
import {
  addOnRequestApi,
  addOnApi,
  type AddOnRequestData,
  type ProviderTypeKey,
} from '../../api'
import { translatePortalText, localizedField, formatPortalDate, formatPortalNumber } from '../../i18n/runtime'

const PROVIDER_VERTICALS: { key: ProviderTypeKey | 'all'; label: string; icon: any; color: string }[] = [
  { key: 'all', label: 'All Providers', icon: Sparkles, color: 'text-emerald-500' },
  { key: 'marina_provider', label: 'Marina Providers', icon: Anchor, color: 'text-teal-500' },
  { key: 'fuel_provider', label: 'Fuel Providers', icon: Fuel, color: 'text-amber-500' },
  { key: 'maintenance_provider', label: 'Maintenance Providers', icon: Wrench, color: 'text-violet-500' },
  { key: 'boat_provider', label: 'Boat Providers', icon: Sailboat, color: 'text-sky-500' },
]

export default function AdminAddOnRequests({ defaultProviderType }: { defaultProviderType?: ProviderTypeKey }) {
  const [selectedVertical, setSelectedVertical] = useState<ProviderTypeKey | 'all'>(defaultProviderType || 'all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'paid' | 'rejected'>('all')
  const [loading, setLoading] = useState(true)
  const [requests, setRequests] = useState<AddOnRequestData[]>([])
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({
    all: 0,
    pending: 0,
    approved: 0,
    paid: 0,
    rejected: 0,
  })

  // Action Modals
  const [approvingReq, setApprovingReq] = useState<AddOnRequestData | null>(null)
  // A string, empty until the catalogue answers: it used to start at 100 and
  // fall back to an invented 10 SAR per unit, which then read as a real rate.
  const [approvePrice, setApprovePrice] = useState<string>('')
  const [priceHint, setPriceHint] = useState<'loading' | 'catalogue' | 'none'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [approveAdminNote, setApproveAdminNote] = useState('')
  const [busyApprove, setBusyApprove] = useState(false)

  const [rejectingReq, setRejectingReq] = useState<AddOnRequestData | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [busyReject, setBusyReject] = useState(false)

  const [viewingReq, setViewingReq] = useState<AddOnRequestData | null>(null)

  useEffect(() => {
    if (defaultProviderType) {
      setSelectedVertical(defaultProviderType)
    }
  }, [defaultProviderType])

  const loadData = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const params: { providerType?: string; status?: string } = {}
      if (selectedVertical !== 'all') params.providerType = selectedVertical
      if (statusFilter !== 'all') params.status = statusFilter

      const res = await addOnRequestApi.adminList(params)
      setRequests(res.data.requests || [])
      if (res.data.statusCounts) {
        setStatusCounts(res.data.statusCounts)
      }
    } catch (e) {
      // Kept on screen as well: after a failed load the table read "no requests",
      // which is indistinguishable from an empty queue.
      setLoadError(e instanceof Error ? e.message : 'Could not load add-on requests')
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not load add-on requests'), 'warn')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVertical, statusFilter])

  /**
   * The queue's filters.
   *
   * Search was a `toLowerCase()` substring — no help for the Arabic business
   * names most of these requests carry — and it was the only control. Which
   * resource is being asked for, when it was requested, and how large the ask
   * is were all unanswerable without reading every row.
   */
  const filterCfg: TableFiltersConfig<AddOnRequestData> = useMemo(() => ({
    searchFields: (r) => {
      const p = typeof r.provider === 'object' ? r.provider : null
      return [
        p?.name,
        p?.business?.businessName,
        (p?.business as any)?.name,
        p?.email,
        r.resourceLabel || r.resourceKey,
        r.adminNotes,
      ]
    },
    filters: [
      { key: 'resource', label: 'Resource', get: (r) => r.resourceLabel || r.resourceKey },
      { key: 'requested', label: 'Requested', kind: 'dateRange', get: (r) => r.createdAt },
      {
        key: 'size',
        label: 'Quantity',
        options: [
          { value: 'over10', label: 'More than 10' },
          { value: 'over1', label: 'More than 1' },
          { value: 'single', label: 'Single unit' },
        ],
        get: (r) => String(r.quantity ?? 1),
        match: (r, v) => {
          const qty = r.quantity ?? 1
          if (v === 'over10') return qty > 10
          if (v === 'over1') return qty > 1
          return qty <= 1
        },
      },
    ],
    sortOptions: [
      // Oldest first — a provider waiting on capacity is waiting on revenue.
      { key: 'requested', label: 'Requested', get: (r) => r.createdAt, defaultDir: 'asc' },
      { key: 'quantity', label: 'Quantity', get: (r) => r.quantity ?? 1, defaultDir: 'desc' },
      {
        key: 'provider',
        label: 'Provider',
        get: (r) => {
          const p = typeof r.provider === 'object' ? r.provider : null
          return p?.business?.businessName || p?.name || ''
        },
        defaultDir: 'asc',
      },
    ],
    defaultSort: 'requested',
    defaultPageSize: 0,
  }), [])
  const tf = useTableFilters(requests, filterCfg)
  const filteredRequests = tf.filtered

  const openApproveModal = async (req: AddOnRequestData) => {
    setApprovingReq(req)
    setApproveAdminNote('')
    setApprovePrice('')
    setPriceHint('loading')
    // Suggested from the add-on catalogue's own rate for this resource. With no
    // catalogue price the field stays empty for the admin to fill — the old
    // "10 SAR per unit" fallback was a made-up number presented as a suggestion.
    try {
      const res = await addOnApi.list({ providerType: req.providerType, resourceKey: req.resourceKey })
      const catalogItem = (res.data.addOns || [])[0]
      if (catalogItem && catalogItem.pricePerMonth > 0) {
        const unitRate = catalogItem.pricePerMonth / Math.max(1, catalogItem.incrementAmount)
        setApprovePrice(String(Math.round(unitRate * (req.quantity || 1) * 100) / 100))
        setPriceHint('catalogue')
        return
      }
    } catch {
      // no suggestion — the admin enters the rate
    }
    setPriceHint('none')
  }

  const handleApprove = async () => {
    if (!approvingReq || busyApprove) return
    const num = Number(approvePrice)
    // Zero is refused too: the provider's checkout rejects a request without a
    // positive price, so a 0 approval left them with nothing they could pay.
    if (approvePrice.trim() === '' || !Number.isFinite(num) || num <= 0) {
      toast(translatePortalText('Enter a monthly price above 0 (SAR)'), 'warn')
      return
    }
    setBusyApprove(true)
    try {
      await addOnRequestApi.adminApprove(approvingReq._id || approvingReq.id!, {
        price: num,
        adminNotes: approveAdminNote.trim() || undefined,
      })
      toast(translatePortalText(`✨ Request approved for ${formatPortalNumber(num)} SAR/mo. Provider notified to pay!`), 'success')
      setApprovingReq(null)
      await loadData()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Approval failed'), 'warn')
    } finally {
      setBusyApprove(false)
    }
  }

  const handleReject = async () => {
    if (!rejectingReq || busyReject) return
    // The reason is what the provider reads; "declined by administrator" told
    // them nothing they could act on.
    if (rejectReason.trim().length < 3) {
      toast(translatePortalText('Give the provider a reason of at least 3 characters'), 'warn')
      return
    }
    setBusyReject(true)
    try {
      await addOnRequestApi.adminReject(rejectingReq._id || rejectingReq.id!, {
        reason: rejectReason.trim(),
      })
      toast(translatePortalText('Request rejected and provider notified'), 'info')
      setRejectingReq(null)
      await loadData()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Rejection failed'), 'warn')
    } finally {
      setBusyReject(false)
    }
  }

  const verticalBadge = (type: ProviderTypeKey) => {
    switch (type) {
      case 'marina_provider':
        return <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-bold text-teal-700 border border-teal-200/60"><Anchor size={12} /> {translatePortalText('Marina')}</span>
      case 'fuel_provider':
        return <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-700 border border-amber-200/60"><Fuel size={12} /> {translatePortalText('Fuel')}</span>
      case 'maintenance_provider':
        return <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-bold text-violet-700 border border-violet-200/60"><Wrench size={12} /> {translatePortalText('Maintenance')}</span>
      case 'boat_provider':
        return <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-bold text-sky-700 border border-sky-200/60"><Sailboat size={12} /> {translatePortalText('Boat')}</span>
      default:
        return null
    }
  }

  const statusBadge = (st: AddOnRequestData['status']) => {
    switch (st) {
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800 border border-amber-200">
            <Clock size={12} /> {translatePortalText('Pending Review')}
          </span>
        )
      case 'approved':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-bold text-sky-800 border border-sky-200">
            <CreditCard size={12} /> {translatePortalText('Approved (Awaiting Payment)')}
          </span>
        )
      case 'paid':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800 border border-emerald-200">
            <CheckCircle2 size={12} /> {translatePortalText('Paid & Active')}
          </span>
        )
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-bold text-rose-800 border border-rose-200">
            <XCircle size={12} /> {translatePortalText('Rejected')}
          </span>
        )
      default:
        return <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">{translatePortalText(st)}</span>
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-black text-deep-900 dark:text-white flex items-center gap-2.5">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 text-deep-900 shadow-md">
              <Sparkles size={20} />
            </span>
            {translatePortalText('Provider Add-On & Capacity Requests')}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {translatePortalText('Review custom quota requests from providers across all verticals, set approved monthly pricing, and monitor payments.')}
          </p>
        </div>

        <button
          onClick={loadData}
          disabled={loading}
          className="btn-ghost flex items-center gap-2 self-start sm:self-auto text-xs font-bold border border-slate-200 dark:border-white/20 shadow-sm"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          <span>{translatePortalText('Refresh')}</span>
        </button>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div
          onClick={() => setStatusFilter('all')}
          className={`card cursor-pointer p-4 transition-all duration-200 hover:shadow-md border ${
            statusFilter === 'all'
              ? 'border-emerald-500 bg-white ring-2 ring-emerald-500/20 dark:bg-slate-900/60'
              : 'border-slate-200/80 bg-white hover:border-slate-300 dark:border-white/10 dark:bg-white/5'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{translatePortalText('Total Requests')}</span>
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300">
              <Sparkles size={16} />
            </span>
          </div>
          <p className="mt-2 font-display text-2xl font-black text-deep-900 dark:text-white">{formatPortalNumber(statusCounts.all || 0)}</p>
        </div>

        <div
          onClick={() => setStatusFilter('pending')}
          className={`card cursor-pointer p-4 transition-all duration-200 hover:shadow-md border ${
            statusFilter === 'pending'
              ? 'border-amber-500 bg-amber-50/80 ring-2 ring-amber-500/20 dark:bg-amber-500/20'
              : 'border-amber-200/80 bg-amber-50/40 hover:border-amber-300 dark:border-amber-500/30 dark:bg-amber-500/10'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">{translatePortalText('Pending Review')}</span>
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
              <Clock size={16} />
            </span>
          </div>
          <p className="mt-2 font-display text-2xl font-black text-amber-800 dark:text-amber-200">{formatPortalNumber(statusCounts.pending || 0)}</p>
        </div>

        <div
          onClick={() => setStatusFilter('approved')}
          className={`card cursor-pointer p-4 transition-all duration-200 hover:shadow-md border ${
            statusFilter === 'approved'
              ? 'border-sky-500 bg-sky-50/80 ring-2 ring-sky-500/20 dark:bg-sky-500/20'
              : 'border-sky-200/80 bg-sky-50/40 hover:border-sky-300 dark:border-sky-500/30 dark:bg-sky-500/10'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-sky-700 dark:text-sky-300">{translatePortalText('Awaiting Payment')}</span>
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300">
              <CreditCard size={16} />
            </span>
          </div>
          <p className="mt-2 font-display text-2xl font-black text-sky-800 dark:text-sky-200">{formatPortalNumber(statusCounts.approved || 0)}</p>
        </div>

        <div
          onClick={() => setStatusFilter('paid')}
          className={`card cursor-pointer p-4 transition-all duration-200 hover:shadow-md border ${
            statusFilter === 'paid'
              ? 'border-emerald-500 bg-emerald-50/80 ring-2 ring-emerald-500/20 dark:bg-emerald-500/20'
              : 'border-emerald-200/80 bg-emerald-50/40 hover:border-emerald-300 dark:border-emerald-500/30 dark:bg-emerald-500/10'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">{translatePortalText('Paid & Active')}</span>
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
              <CheckCircle2 size={16} />
            </span>
          </div>
          <p className="mt-2 font-display text-2xl font-black text-emerald-800 dark:text-emerald-200">{formatPortalNumber(statusCounts.paid || 0)}</p>
        </div>
      </div>

      {/* Provider Vertical Filter Tabs (if not locked to a specific vertical) */}
      {!defaultProviderType && (
        <div className="flex flex-wrap gap-2 rounded-2xl bg-slate-100/90 dark:bg-white/5 p-1.5 border border-slate-200/80 dark:border-white/10">
          {PROVIDER_VERTICALS.map((v) => {
            const active = selectedVertical === v.key
            return (
              <button
                key={v.key}
                onClick={() => setSelectedVertical(v.key)}
                className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-extrabold transition ${
                  active
                    ? 'bg-white text-deep-900 shadow-sm ring-1 ring-black/5 dark:bg-white/15 dark:text-white dark:ring-white/10'
                    : 'text-slate-600 hover:bg-white/80 hover:text-deep-900 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white'
                }`}
              >
                <v.icon size={14} className={active ? v.color : 'text-slate-400 dark:text-white/65'} />
                <span>{translatePortalText(v.label)}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Status Filter & Search Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-white dark:bg-[#0b1628] p-4 rounded-2xl shadow-soft border border-slate-100 dark:border-slate-800">
        <div className="flex flex-wrap items-center gap-1.5">
          {(['all', 'pending', 'approved', 'paid', 'rejected'] as const).map((st) => {
            const active = statusFilter === st
            const count = statusCounts[st] ?? 0
            return (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`rounded-xl px-3 py-1.5 text-xs font-bold transition flex items-center gap-1.5 ${
                  active
                    ? 'bg-deep-900 text-white shadow-sm dark:bg-emerald-600 dark:text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                }`}
              >
                <span className="capitalize">{st === 'all' ? translatePortalText('All Requests') : translatePortalText(st.charAt(0).toUpperCase() + st.slice(1))}</span>
                <span className={`rounded-full px-1.5 py-0.2 text-[10px] ${active ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300'}`}>
                  {formatPortalNumber(count)}
                </span>
              </button>
            )
          })}
        </div>

      </div>

      <TableToolbar
        state={tf}
        config={filterCfg}
        rows={requests}
        noun="requests"
        searchPlaceholder="Search provider, business or resource…"
      />

      {/* Requests Table */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-[#0b1628] overflow-hidden shadow-soft">
        {loading ? (
          <div className="p-12 text-center">
            <Loader2 size={32} className="mx-auto animate-spin text-ocean-500" />
            <p className="mt-3 text-sm font-semibold text-slate-500">{translatePortalText('Loading add-on requests...')}</p>
          </div>
        ) : loadError ? (
          <div className="p-12 text-center">
            <AlertCircle size={28} className="mx-auto text-rose-500" />
            <h3 className="mt-3 font-display text-base font-bold text-deep-900 dark:text-white">{translatePortalText('Couldn’t load add-on requests')}</h3>
            <p className="mt-1 text-xs text-rose-600 max-w-sm mx-auto">{loadError}</p>
            <button onClick={loadData} className="btn-ghost mt-3 inline-flex items-center gap-1.5 text-xs font-bold"><RefreshCw size={13} /> {translatePortalText('Retry')}</button>
          </div>
        ) : filteredRequests.length === 0 ? (
          <div className="p-12 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-400">
              <Sparkles size={26} />
            </div>
            <h3 className="mt-3 font-display text-base font-bold text-deep-900 dark:text-white">{translatePortalText('No Add-On Requests Found')}</h3>
            <p className="mt-1 text-xs text-slate-400 max-w-sm mx-auto">
              {tf.activeCount > 0 ? translatePortalText('No requests match these filters.') : translatePortalText('There are currently no capacity add-on requests for this filter.')}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full min-w-[960px] text-left text-xs">
              <thead className="border-b border-slate-100 bg-slate-50/80 font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="py-3.5 px-4">{translatePortalText('Provider / Business')}</th>
                  <th className="py-3.5 px-4">{translatePortalText('Vertical')}</th>
                  <th className="py-3.5 px-4">{translatePortalText('Requested Capacity')}</th>
                  <th className="py-3.5 px-4">{translatePortalText('Provider Note')}</th>
                  <th className="py-3.5 px-4">{translatePortalText('Status & Price')}</th>
                  <th className="py-3.5 px-4">{translatePortalText('Date')}</th>
                  <th className="py-3.5 px-4 text-right">{translatePortalText('Actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRequests.map((req) => {
                  const p = typeof req.provider === 'object' ? req.provider : null
                  const bizName = String(localizedField(p?.business, 'businessName') || localizedField(p?.business, 'name') || p?.business?.businessName || p?.business?.name || translatePortalText('Independent Provider'))
                  const provName = String(localizedField(p, 'name') || p?.name || translatePortalText('Provider'))
                  const provEmail = p?.email || ''
                  const resTitle = String(localizedField(req, 'resourceLabel') || req.resourceLabel || translatePortalText(req.resourceKey))

                  return (
                    <tr key={req._id || req.id} className="transition hover:bg-slate-50/60">
                      {/* Provider info */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-deep-900 to-deep-800 font-black text-white text-xs shadow-sm">
                            {provName.slice(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-deep-900 truncate">{provName}</p>
                            <p className="text-[11px] text-slate-500 truncate">{bizName}</p>
                            <p className="text-[10px] text-slate-400 truncate">{provEmail}</p>
                          </div>
                        </div>
                      </td>

                      {/* Vertical */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {verticalBadge(req.providerType)}
                      </td>

                      {/* Requested capacity */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="rounded-lg bg-emerald-50 px-2 py-1 font-extrabold text-emerald-700 text-xs border border-emerald-200">
                            +{formatPortalNumber(req.quantity)}
                          </span>
                          <span className="font-semibold text-deep-900">{resTitle}</span>
                        </div>
                      </td>

                      {/* Note */}
                      <td className="py-3.5 px-4 max-w-xs">
                        <p className="text-slate-600 truncate" title={req.note}>
                          {req.note || <span className="text-slate-400 italic">{translatePortalText('No notes provided')}</span>}
                        </p>
                      </td>

                      {/* Status & Price */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex flex-col gap-1">
                          <div>{statusBadge(req.status)}</div>
                          {req.price !== undefined && req.price > 0 && (
                            <span className="text-[11px] font-extrabold text-deep-900">
                              {formatPortalNumber(req.price, { maximumFractionDigits: 2 })} {translatePortalText('SAR/mo')}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Date */}
                      <td className="py-3.5 px-4 whitespace-nowrap text-[11px] text-slate-400">
                        {formatPortalDate(req.createdAt)}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        {req.status === 'pending' ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => openApproveModal(req)}
                              className="inline-flex items-center gap-1 rounded-xl bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-600"
                            >
                              <Check size={13} /> {translatePortalText('Approve')}
                            </button>
                            <button
                              onClick={() => {
                                setRejectingReq(req)
                                setRejectReason('')
                              }}
                              className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-bold text-rose-700 transition hover:bg-rose-100"
                            >
                              <X size={13} /> {translatePortalText('Reject')}
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setViewingReq(req)}
                            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
                          >
                            <Eye size={13} /> {translatePortalText('Details')}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── APPROVE MODAL ───────────────────────────────────────────────────── */}
      {approvingReq && (
        <Modal
          open={!!approvingReq}
          onClose={() => !busyApprove && setApprovingReq(null)}
          title={translatePortalText('Approve Add-On & Set Monthly Price')}
        >
          <div className="space-y-4">
            {/* Request Summary Card */}
            <div className="rounded-2xl bg-emerald-50/80 p-4 border border-emerald-200/80 text-emerald-950">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">{translatePortalText('Requested Upgrade')}</span>
                {verticalBadge(approvingReq.providerType)}
              </div>
              <p className="mt-2 text-sm font-extrabold text-emerald-950">
                +{formatPortalNumber(approvingReq.quantity)} {localizedField(approvingReq, 'resourceLabel') || approvingReq.resourceLabel || approvingReq.resourceKey}
              </p>
              {approvingReq.note && (
                <p className="mt-1 text-xs text-emerald-800 italic">
                  "{approvingReq.note}"
                </p>
              )}
            </div>

            <div>
              <label className="label font-bold text-xs">{translatePortalText('Approved Monthly Tariff (SAR / Month) *')}</label>
              <div className="relative mt-1">
                <DollarSign size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="number"
                  min={0}
                  step={10}
                  value={approvePrice}
                  onChange={(e) => setApprovePrice(e.target.value)}
                  placeholder={translatePortalText('e.g. 100')}
                  className="input !ps-9 w-full font-bold text-base"
                />
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                {translatePortalText(priceHint === 'catalogue' ? 'Suggested from the add-on catalogue rate for this resource. ' : priceHint === 'none' ? 'No catalogue price for this resource — enter the rate yourself. ' : 'Looking up the catalogue rate… ')}
                {translatePortalText('The provider will be notified of this monthly rate. Once they pay via HyperPay, their limit expands by +')}{formatPortalNumber(approvingReq.quantity)} {translatePortalText('automatically.')}
              </p>
            </div>

            <div>
              <label className="label font-bold text-xs">{translatePortalText('Admin Notes / Terms (Optional)')}</label>
              <textarea
                value={approveAdminNote}
                onChange={(e) => setApproveAdminNote(e.target.value)}
                placeholder={translatePortalText("e.g. Approved for Pier 4 expansion; billed on the 1st of each month.")}
                rows={2}
                className="input w-full !text-xs mt-1"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setApprovingReq(null)}
                disabled={busyApprove}
              >
                {translatePortalText('Cancel')}
              </button>
              <button
                type="button"
                className="btn-admin flex items-center gap-2"
                onClick={handleApprove}
                disabled={busyApprove || priceHint === 'loading' || !(Number(approvePrice) > 0)}
              >
                {busyApprove ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>{translatePortalText('Approving...')}</span>
                  </>
                ) : (
                  <>
                    <Check size={14} />
                    <span>{translatePortalText('Confirm Approval & Send Quote')}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── REJECT MODAL ───────────────────────────────────────────────────── */}
      {rejectingReq && (
        <Modal
          open={!!rejectingReq}
          onClose={() => !busyReject && setRejectingReq(null)}
          title={translatePortalText('Decline Add-On Request')}
        >
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              {translatePortalText('Are you sure you want to decline this request for')}{' '}
              <strong className="text-deep-900 font-bold">
                +{formatPortalNumber(rejectingReq.quantity)} {localizedField(rejectingReq, 'resourceLabel') || rejectingReq.resourceLabel || rejectingReq.resourceKey}
              </strong>?
            </p>

            <div>
              <label className="label font-bold text-xs">{translatePortalText('Reason for Rejection (Visible to Provider) *')}</label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder={translatePortalText("e.g. Please upgrade to Tier 2 package or submit structural safety documentation.")}
                rows={3}
                className="input w-full !text-xs mt-1"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setRejectingReq(null)}
                disabled={busyReject}
              >
                {translatePortalText('Cancel')}
              </button>
              <button
                type="button"
                className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-rose-700 flex items-center gap-2"
                onClick={handleReject}
                disabled={busyReject || rejectReason.trim().length < 3}
              >
                {busyReject ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>{translatePortalText('Rejecting...')}</span>
                  </>
                ) : (
                  <>
                    <X size={14} />
                    <span>{translatePortalText('Confirm Rejection')}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── DETAILS MODAL ──────────────────────────────────────────────────── */}
      {viewingReq && (
        <Modal
          open={!!viewingReq}
          onClose={() => setViewingReq(null)}
          title={translatePortalText('Add-On Request Details')}
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              {verticalBadge(viewingReq.providerType)}
              {statusBadge(viewingReq.status)}
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">{translatePortalText('Provider:')}</span>
                <span className="font-bold text-deep-900">
                  {typeof viewingReq.provider === 'object' ? (localizedField(viewingReq.provider, 'name') || viewingReq.provider.name) : viewingReq.provider}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">{translatePortalText('Requested Capacity:')}</span>
                <span className="font-extrabold text-emerald-700">
                  +{formatPortalNumber(viewingReq.quantity)} {localizedField(viewingReq, 'resourceLabel') || viewingReq.resourceLabel || viewingReq.resourceKey}
                </span>
              </div>
              {viewingReq.price !== undefined && (
                <div className="flex justify-between">
                  <span className="text-slate-500 font-medium">{translatePortalText('Approved Rate:')}</span>
                  <span className="font-extrabold text-deep-900">{formatPortalNumber(viewingReq.price, { maximumFractionDigits: 2 })} {translatePortalText('SAR / Month')}</span>
                </div>
              )}
              {viewingReq.checkoutId && (
                <div className="flex justify-between">
                  <span className="text-slate-500 font-medium">{translatePortalText('Payment Reference:')}</span>
                  <span className="font-mono text-[11px] text-slate-700 truncate max-w-xs">{viewingReq.checkoutId}</span>
                </div>
              )}
              {viewingReq.rejectedReason && (
                <div className="flex justify-between text-rose-700">
                  <span className="font-medium">{translatePortalText('Rejection Reason:')}</span>
                  <span className="font-bold">{viewingReq.rejectedReason}</span>
                </div>
              )}
            </div>

            {viewingReq.note && (
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">{translatePortalText("Provider's Note")}</p>
                <p className="rounded-xl bg-slate-100 p-3 text-xs text-slate-800 leading-relaxed">
                  {viewingReq.note}
                </p>
              </div>
            )}

            {viewingReq.adminNotes && (
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">{translatePortalText('Admin Notes')}</p>
                <p className="rounded-xl bg-sky-50 border border-sky-100 p-3 text-xs text-sky-900 leading-relaxed">
                  {viewingReq.adminNotes}
                </p>
              </div>
            )}

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button className="btn-ghost" onClick={() => setViewingReq(null)}>
                {translatePortalText('Close')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
