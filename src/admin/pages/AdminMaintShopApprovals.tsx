import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { TableToolbar, useTableFilters, type TableFiltersConfig } from '../../shared/TableFilters'
import { motion } from 'framer-motion'
import {
  Wrench,
  Check,
  X,
  RefreshCw,
  MapPin,
  Phone,
  Mail,
  Globe,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Sliders,
  Eye,
  Users,
  ListChecks,
  Camera,
  Ship,
} from 'lucide-react'
import { PageWrap } from './_shared'
import { AdminHeader } from '../adminUi'
import { Modal, toast, Counter, CardGridSkeleton } from '../../ui'
import { confirm } from '../../async'
import { money } from '../../format'
import { formatPortalNumber, formatPortalPercent, translatePortalText } from '../../i18n/runtime'
import { adminApi, fileUrl, type AdminMaintShopApproval } from '../../api'

const TABS = [
  { key: 'pending', label: 'Pending Review' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'draft', label: 'Drafts' },
  { key: '', label: 'All Vendors' },
] as const

/**
 * The two kinds of maintenance vendor.
 *
 * A shop registered before boat ramps existed carries no `serviceType` at all,
 * and every one of those is an ordinary workshop — the server resolves it that
 * way in both the public catalogue and this endpoint's own filter, so the queue
 * has to read it the same way rather than showing a third, unclassified state.
 */
const SERVICE_TYPES = [
  { key: '', label: 'All types', icon: Sliders },
  { key: 'maintenance', label: 'Normal maintenance', icon: Wrench },
  { key: 'boat_ramp', label: "Boat's ramp", icon: Ship },
] as const

type ServiceTypeKey = (typeof SERVICE_TYPES)[number]['key']

const serviceTypeOf = (s: AdminMaintShopApproval): 'maintenance' | 'boat_ramp' =>
  s.serviceType === 'boat_ramp' ? 'boat_ramp' : 'maintenance'

const SERVICE_TYPE_META = {
  maintenance: {
    label: 'Normal maintenance',
    chip: 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950/60 dark:text-sky-300',
    Icon: Wrench,
  },
  boat_ramp: {
    label: "Boat's ramp",
    chip: 'bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-950/60 dark:text-teal-300',
    Icon: Ship,
  },
} as const

function approvalBadgeClass(status: string) {
  if (status === 'approved') return 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300'
  if (status === 'rejected') return 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300'
  if (status === 'pending') return 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300'
  return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300'
}

/**
 * The badge. "Verified & Live" was printed for every approved vendor, including
 * one that was unpublished or taken offline — neither is live — and draft and
 * rejected printed their raw status word, untranslated.
 */
function vendorBadgeLabel(s: AdminMaintShopApproval): string {
  const status = s.approvalStatus || 'draft'
  if (status === 'approved') {
    if (s.isActive === false) return translatePortalText('Approved · taken down')
    return translatePortalText(s.isPublished === false ? 'Approved · unpublished' : 'Verified & Live')
  }
  if (status === 'pending') return translatePortalText('Pending Review')
  if (status === 'rejected') return translatePortalText('Rejected')
  return translatePortalText('Draft')
}

const shopId =(s?: AdminMaintShopApproval | null): string => (s ? s._id || s.id || '' : '')

export default function AdminMaintShopApprovals() {
  const [tab, setTab] = useState<string>('pending')
  const [serviceType, setServiceType] = useState<ServiceTypeKey>('')
  const [shops, setShops] = useState<AdminMaintShopApproval[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AdminMaintShopApproval | null>(null)
  const [rejecting, setRejecting] = useState<AdminMaintShopApproval | null>(null)
  const [reason, setReason] = useState('')

  /**
   * Both filters go to the server rather than being applied to a page of rows
   * here: `statusCounts` is computed over the whole collection, so a client-side
   * service-type filter would leave the tab counts disagreeing with the list.
   */
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // 100 a page, the API's cap — without a limit the queue served its
      // default of 20, and one page of 100 still dropped the 101st vendor.
      const all: AdminMaintShopApproval[] = []
      let statusCounts: Record<string, number> = {}
      for (let page = 1; page <= 50; page++) {
        const res = await adminApi.listMaintShopApprovals({
          limit: 100,
          page,
          ...(tab ? { approvalStatus: tab } : {}),
          ...(serviceType ? { serviceType: serviceType as 'maintenance' | 'boat_ramp' } : {}),
        })
        all.push(...(res.data?.shops || []))
        statusCounts = res.data?.statusCounts || {}
        if (!res.data?.shops?.length || all.length >= (res.data?.total ?? 0)) break
      }
      setShops(all)
      setCounts(statusCounts)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load maintenance vendors')
    } finally {
      setLoading(false)
    }
  }, [tab, serviceType])

  useEffect(() => { load() }, [load])

  const act = async (shop: AdminMaintShopApproval, fn: () => Promise<unknown>, msg: string, tone: any = 'success') => {
    setBusyId(shopId(shop))
    try {
      await fn()
      toast(translatePortalText(msg), tone)
      setRejecting(null)
      setReason('')
      setDetail(null)
      await load()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Action failed'), 'warn')
    } finally {
      setBusyId(null)
    }
  }

  const doApprove = async (shop: AdminMaintShopApproval) => {
    const id = shopId(shop)
    if (!id || busyId) return
    // The server refuses an incomplete shop too; checking here turns that 400
    // into a sentence naming what is missing, before the round trip.
    if (shop.completeness && !shop.completeness.isComplete) {
      toast(translatePortalText(`Cannot approve: ${formatPortalNumber(shop.completeness.criticalCount)} critical requirements are missing.`), 'warn')
      return
    }
    // It publishes a draft its owner never submitted, and one with open
    // warnings, without a word — so say so before the click lands.
    const warningItems = shop.completeness?.missingItems?.filter((it) => it.severity !== 'critical') ?? []
    const warnings: string[] = []
    if ((shop.approvalStatus || 'draft') === 'draft') warnings.push(translatePortalText('This vendor is still a draft — the owner has not submitted it for review.'))
    if (warningItems.length) warnings.push(translatePortalText(`Open: ${warningItems.map((it) => it.title).join(', ')}.`))
    const ok = await confirm({
      title: `Approve and publish "${shop.nameEn}"?`,
      body: [...warnings, translatePortalText('It goes live in the catalogue and takes bookings straight away.')].join(' '),
      confirmLabel: warnings.length ? 'Publish anyway' : 'Approve & publish',
      danger: warnings.length > 0,
    })
    if (ok) act(shop, () => adminApi.approveMaintShop(id), `"${shop.nameEn}" approved and published live! ✅`)
  }

  const doReject = () => {
    if (!rejecting || busyId) return
    const id = shopId(rejecting)
    if (!id) { toast(translatePortalText('Invalid vendor ID'), 'warn'); return }
    if (reason.trim().length < 3) {
      toast(translatePortalText('Please provide a rejection / change request reason (min 3 characters)'), 'warn')
      return
    }
    act(rejecting, () => adminApi.rejectMaintShop(id, reason.trim()), `"${rejecting.nameEn}" marked as rejected`, 'warn')
  }

  const filterCfg: TableFiltersConfig<AdminMaintShopApproval> = useMemo(() => ({
    searchFields: (s) => [s.nameEn, s.nameAr, s.address, s.city, s.provider?.business?.businessName, s.provider?.name],
    filters: [
      { key: 'city', label: 'City', get: (s) => s.city },
      { key: 'submitted', label: 'Submitted', kind: 'dateRange', get: (s) => s.createdAt },
    ],
    sortOptions: [
      { key: 'submitted', label: 'Submitted', get: (s) => s.createdAt, defaultDir: 'asc' },
      { key: 'name', label: 'Vendor', get: (s) => s.nameEn, defaultDir: 'asc' },
      { key: 'city', label: 'City', get: (s) => s.city, defaultDir: 'asc' },
    ],
    defaultSort: 'submitted',
    defaultPageSize: 0,
  }), [])
  const tf = useTableFilters(shops, filterCfg)
  const filtered = tf.filtered
  const totalCount = Object.values(counts).reduce((a, b) => a + b, 0)

  return (
    <PageWrap>
      <AdminHeader
        title={translatePortalText("Maintenance Vendor Approvals")}
        sub="Review workshops and boat ramps before they go live. Check the address and map pin, the trades or launch service offered, staffing, and pricing — a boater filters the catalogue on the service type, so confirm it matches what the vendor actually operates."
        icon={<Wrench className="text-violet-500" />}
        actions={
          <button className="btn-ghost !rounded-xl !px-3.5 !py-2 text-xs font-semibold" onClick={load}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> {translatePortalText("Refresh")}
          </button>
        }
      />

      {/* KPI cards — clicking one filters the queue to that status. */}
      <div className="mb-6 grid grid-cols-2 gap-3.5 md:grid-cols-4">
        {[
          { key: 'pending', label: 'Pending Review', count: counts.pending || 0, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/50', icon: Clock },
          { key: 'approved', label: 'Approved', count: counts.approved || 0, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900/50', icon: CheckCircle2 },
          { key: 'rejected', label: 'Rejected / Action Needed', count: counts.rejected || 0, color: 'text-rose-600', bg: 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900/50', icon: XCircle },
          { key: 'draft', label: 'Drafts in Progress', count: counts.draft || 0, color: 'text-slate-600 dark:text-slate-400', bg: 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800', icon: Sliders },
        ].map((item, i) => {
          const Icon = item.icon
          return (
            <motion.div
              key={item.key}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              onClick={() => setTab(item.key === tab ? '' : item.key)}
              className={`card cursor-pointer p-4 border transition hover:shadow-soft ${item.bg} ${tab === item.key ? 'ring-2 ring-violet-500' : ''}`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">{translatePortalText(item.label)}</span>
                <Icon size={16} className={item.color} />
              </div>
              <div className={`font-display text-2xl font-black ${item.color}`}>
                <Counter value={item.count} />
              </div>
            </motion.div>
          )
        })}
      </div>

      {/* Status tabs, then the vendor-kind split. Two rows rather than one:
          they are different questions, and combining them into a single strip
          of nine buttons hid which of the two was actually narrowing the list. */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5 rounded-2xl border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900 shadow-2xs">
        {TABS.map((t) => {
          const count = t.key ? (counts[t.key] ?? 0) : totalCount
          const active = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-bold transition ${
                active ? 'bg-violet-600 text-white shadow-xs' : 'text-slate-600 hover:text-deep-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              <span>{translatePortalText(t.label)}</span>
              <span className={`rounded-full px-1.5 py-0.2 text-[10px] font-black ${
                active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
              }`}>{formatPortalNumber(count)}</span>
            </button>
          )
        })}
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">{translatePortalText("Vendor type")}</span>
        {SERVICE_TYPES.map((s) => {
          const Icon = s.icon
          const active = serviceType === s.key
          return (
            <button
              key={s.key || 'all'}
              onClick={() => setServiceType(s.key)}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition ${
                active
                  ? 'border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400'
              }`}
            >
              <Icon size={13} /> {translatePortalText(s.label)}
            </button>
          )
        })}
      </div>

      <TableToolbar
        state={tf}
        config={filterCfg}
        rows={shops}
        noun="vendors"
        searchPlaceholder="Search by name, city, address or owner…"
      />

      {loading ? (
        <CardGridSkeleton count={6} />
      ) : error ? (
        <div className="card p-8 text-center text-rose-500">
          <AlertTriangle size={32} className="mx-auto mb-2" />
          <p className="font-bold">{error}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center text-slate-400">
          <Wrench size={40} className="mx-auto mb-3 text-slate-300 stroke-[1.5]" />
          <h3 className="font-display text-base font-bold text-deep-900 dark:text-white">{translatePortalText("No Vendors Found")}</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            {tf.activeCount > 0
              ? translatePortalText('No vendors match these filters.')
              : translatePortalText(tab ? 'No vendors in this tab right now.' : 'No vendors have been added yet.')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((s, i) => {
            const id = shopId(s)
            const status = s.approvalStatus || 'draft'
            const completeness = s.completeness
            const score = completeness?.score ?? 0
            const criticalMissing = completeness?.missingItems?.filter((it) => it.severity === 'critical') || []
            const isBusy = busyId === id
            const cover = s.images?.[0] || s.imagesCategorized?.[0]?.url
            const kind = SERVICE_TYPE_META[serviceTypeOf(s)]
            const KindIcon = kind.Icon

            return (
              <motion.div
                key={id}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.04, 0.3) }}
                className={`card overflow-hidden border flex flex-col justify-between transition hover:shadow-soft ${
                  status === 'pending' ? 'ring-2 ring-amber-300/80 border-amber-300' : ''
                }`}
              >
                <div>
                  <div className="relative h-44 w-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    {cover ? (
                      <img src={fileUrl(cover)} alt={s.nameEn} className="h-full w-full object-cover" />
                    ) : (
                      <div className="grid h-full w-full place-items-center bg-gradient-to-br from-violet-950 to-deep-950 text-white">
                        <Camera size={34} className="opacity-40" />
                        <span className="text-[11px] font-bold text-violet-300 mt-1">{translatePortalText("No Cover Photo")}</span>
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-deep-950/80 via-transparent to-transparent" />

                    {/* The vendor kind sits opposite the status, because it is
                        the thing this queue exists to let an admin tell apart. */}
                    <span className={`absolute start-3 top-3 inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10.5px] font-extrabold uppercase tracking-wide shadow-sm ${kind.chip}`}>
                      <KindIcon size={11} /> {translatePortalText(kind.label)}
                    </span>

                    <span className={`absolute end-3 top-3 rounded-full border px-2.5 py-0.5 text-[10.5px] font-extrabold uppercase tracking-wide shadow-sm ${approvalBadgeClass(status)}`}>
                      {vendorBadgeLabel(s)}
                    </span>

                    <div className="absolute bottom-2.5 start-3 end-3 text-white">
                      <h3 className="font-display text-base font-extrabold leading-tight drop-shadow-sm truncate">{s.nameEn}</h3>
                      {s.nameAr && <p className="text-xs text-violet-200 font-medium truncate" dir="rtl">{s.nameAr}</p>}
                    </div>
                  </div>

                  <div className="p-4 space-y-3.5">
                    <div className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300">
                      <MapPin size={15} className="text-violet-600 shrink-0 mt-0.5" />
                      <div className="leading-snug truncate">
                        <span className="font-bold text-deep-900 dark:text-white">{s.city || translatePortalText('City not set')}:</span>{' '}
                        <span className={!s.address ? 'text-rose-600 font-bold' : ''}>{s.address || translatePortalText('Address not set')}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center">
                      {[
                        { label: 'Services', value: completeness?.stats?.servicesCount ?? 0, Icon: ListChecks },
                        { label: 'Technicians', value: completeness?.stats?.techniciansCount ?? 0, Icon: Users },
                        { label: 'Photos', value: completeness?.stats?.imagesCount ?? s.images?.length ?? 0, Icon: Camera },
                      ].map((stat) => (
                        <div key={stat.label} className="rounded-xl border border-slate-100 bg-sand/60 p-2 dark:border-slate-800 dark:bg-slate-900/40">
                          <stat.Icon size={13} className="mx-auto text-slate-400" />
                          <p className="mt-0.5 font-display text-sm font-extrabold text-deep-900 dark:text-white">{formatPortalNumber(stat.value)}</p>
                          <p className="text-[9.5px] font-bold uppercase tracking-wide text-slate-400">{translatePortalText(stat.label)}</p>
                        </div>
                      ))}
                    </div>

                    <div>
                      <div className="mb-1 flex items-center justify-between text-[11px] font-bold">
                        <span className="text-slate-500">{translatePortalText("Profile completeness")}</span>
                        <span className={score >= 90 ? 'text-emerald-600' : score >= 50 ? 'text-amber-600' : 'text-rose-600'}>{formatPortalPercent(score)}</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <div
                          className={`h-full rounded-full ${score >= 90 ? 'bg-emerald-500' : score >= 50 ? 'bg-amber-500' : 'bg-rose-500'}`}
                          style={{ width: `${score}%` }}
                        />
                      </div>
                    </div>

                    {criticalMissing.length > 0 && (
                      <div className="rounded-xl border border-rose-200/80 bg-rose-50/60 p-2 text-[11px] text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/20">
                        <p className="font-bold flex items-center gap-1">
                          <AlertTriangle size={12} className="text-rose-500" />
                          {translatePortalText("\n                          Missing ")}{formatPortalNumber(criticalMissing.length)} {translatePortalText(" critical items:\n                        ")}</p>
                        <p className="text-[10.5px] text-rose-700 dark:text-rose-300 truncate mt-0.5">
                          {criticalMissing.map((c) => c.title).join(', ')}
                        </p>
                      </div>
                    )}

                    {status === 'rejected' && (s.approvalReason || s.rejectionReason) && (
                      <div className="rounded-xl border border-rose-200 bg-rose-50/90 p-2 text-[11px] text-rose-900">
                        <span className="font-bold">{translatePortalText("Rejection reason:")}</span> {s.approvalReason || s.rejectionReason}
                      </div>
                    )}
                  </div>
                </div>

                <div className="border-t border-slate-100 bg-slate-50/50 dark:border-slate-800/80 dark:bg-slate-900/30 p-3.5 flex items-center justify-between gap-2">
                  <button
                    onClick={() => setDetail(s)}
                    className="btn-ghost !py-1.5 !px-3 !text-xs font-bold text-slate-700 dark:text-slate-300 inline-flex items-center gap-1"
                  >
                    <Eye size={13} /> {translatePortalText(" Inspect\n                  ")}</button>

                  <div className="flex items-center gap-1.5">
                    {status !== 'rejected' && (
                      <button
                        disabled={isBusy}
                        onClick={() => { setRejecting(s); setReason('') }}
                        className="btn-ghost !text-rose-600 hover:!bg-rose-50 !py-1.5 !px-2.5 !text-xs font-bold inline-flex items-center gap-1 border border-rose-200"
                      >
                        <X size={13} /> {translatePortalText("Reject")}
                      </button>
                    )}

                    {status !== 'approved' && (
                      <button
                        disabled={isBusy || (!!completeness && !completeness.isComplete)}
                        onClick={() => void doApprove(s)}
                        title={translatePortalText(completeness && !completeness.isComplete ? 'Cannot approve: critical items missing' : 'Approve and publish vendor')}
                        className={`btn-primary !py-1.5 !px-3 !text-xs font-extrabold inline-flex items-center gap-1 shadow-sm ${
                          completeness && !completeness.isComplete
                            ? '!bg-slate-300 dark:!bg-slate-800 !text-slate-400 cursor-not-allowed'
                            : '!bg-emerald-600 hover:!bg-emerald-700 !text-white'
                        }`}
                      >
                        <Check size={14} /> {translatePortalText(" Approve & Publish\n                      ")}</button>
                    )}
                  </div>
                </div>
              </motion.div>
            )
          })}
        </div>
      )}

      {/* Inspect */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? `${detail.nameEn}` : ''}>
        {detail && (() => {
          const kind = SERVICE_TYPE_META[serviceTypeOf(detail)]
          const KindIcon = kind.Icon
          return (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10.5px] font-extrabold uppercase tracking-wide ${kind.chip}`}>
                  <KindIcon size={11} /> {translatePortalText(kind.label)}
                </span>
                <span className={`rounded-full border px-2.5 py-0.5 text-[10.5px] font-extrabold uppercase tracking-wide ${approvalBadgeClass(detail.approvalStatus || 'draft')}`}>
                  {vendorBadgeLabel(detail)}
                </span>
              </div>

              {!!detail.descriptionEn && <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">{detail.descriptionEn}</p>}

              <div className="grid grid-cols-2 gap-2 text-xs">
                {([
                  ['Owner', detail.provider?.business?.businessName || detail.provider?.name],
                  ['Owner email', detail.provider?.email],
                  ['City', detail.city],
                  ['Region', detail.region],
                  ['Address', detail.address],
                  ['Contact', detail.contactNumber],
                  ['Email', detail.email],
                  ['Website', detail.website],
                  ['Hourly rate', detail.hourlyRateSar != null ? money(detail.hourlyRateSar) : undefined],
                  ['Inspection fee', detail.inspectionFeeSar != null ? money(detail.inspectionFeeSar) : undefined],
                  ['Coordinates', detail.latitude && detail.longitude ? `${formatPortalNumber(detail.latitude, { minimumFractionDigits: 5, maximumFractionDigits: 5 })}, ${formatPortalNumber(detail.longitude, { minimumFractionDigits: 5, maximumFractionDigits: 5 })}` : undefined],
                ] as [string, string | undefined][])
                  .filter(([, v]) => !!v)
                  .map(([label, value]) => (
                    <div key={label} className="rounded-xl border border-slate-100 bg-sand/60 p-2.5 dark:border-slate-800 dark:bg-slate-900/40">
                      <p className="text-[9.5px] font-bold uppercase tracking-wide text-slate-400">{translatePortalText(label)}</p>
                      <p className="mt-0.5 font-bold text-deep-900 dark:text-white break-words">{value}</p>
                    </div>
                  ))}
              </div>

              {/* A boat ramp holds no trades — the field is a workshop's, and an
                  empty list there is expected rather than a gap to chase. */}
              {serviceTypeOf(detail) === 'maintenance' && (
                <div>
                  <p className="label mb-1.5">{translatePortalText("Trades offered")}</p>
                  {detail.serviceCategories?.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {detail.serviceCategories.map((c) => (
                        <span key={c} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {c.replace(/_/g, ' ')}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-rose-600 font-bold">{translatePortalText("No trades selected yet.")}</p>
                  )}
                </div>
              )}

              {!!detail.completeness?.missingItems?.length && (
                <div>
                  <p className="label mb-1.5">{translatePortalText("Outstanding items")}</p>
                  <div className="space-y-1.5">
                    {detail.completeness.missingItems.map((it) => (
                      <div
                        key={it.id}
                        className={`rounded-xl border p-2 text-[11px] ${
                          it.severity === 'critical'
                            ? 'border-rose-200 bg-rose-50/70 text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-200'
                            : 'border-amber-200 bg-amber-50/70 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200'
                        }`}
                      >
                        <p className="font-bold">{it.title}</p>
                        <p className="opacity-80">{it.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                {!!detail.contactNumber && (
                  <a href={`tel:${detail.contactNumber}`} className="btn-ghost !py-1.5 !px-3 !text-xs font-bold inline-flex items-center gap-1">
                    <Phone size={13} /> {translatePortalText(" Call\n                  ")}</a>
                )}
                {!!detail.email && (
                  <a href={`mailto:${detail.email}`} className="btn-ghost !py-1.5 !px-3 !text-xs font-bold inline-flex items-center gap-1">
                    <Mail size={13} /> {translatePortalText(" Email\n                  ")}</a>
                )}
                {!!detail.website && (
                  <a href={detail.website} target="_blank" rel="noreferrer" className="btn-ghost !py-1.5 !px-3 !text-xs font-bold inline-flex items-center gap-1">
                    <Globe size={13} /> {translatePortalText(" Website\n                  ")}</a>
                )}
              </div>
            </div>
          )
        })()}
      </Modal>

      {/* Reject */}
      <Modal open={!!rejecting} onClose={() => setRejecting(null)} title={translatePortalText(`Reject vendor: "${rejecting?.nameEn || ''}"`)}>
        <div className="space-y-4">
          <p className="text-xs text-slate-600 leading-relaxed">
            {translatePortalText("\n            Explain what the vendor must fix before they can be approved and published. This reason is shown to them in their portal.\n          ")}</p>
          <div>
            <label className="label">{translatePortalText("Rejection / Change Request Reason *")}</label>
            <textarea
              value={reason}
              dir="auto"
              onChange={(e) => setReason(e.target.value)}
              placeholder={translatePortalText("e.g. Set the workshop's map pin to its real location, add at least one technician on duty, and publish an hourly rate.")}
              className="input min-h-[100px] text-xs"
            />
          </div>
          {rejecting?.approvalStatus === 'approved' && (
            <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-800">
              {translatePortalText("This vendor is live. Rejecting it unpublishes it from the catalogue straight away.")}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-ghost" onClick={() => setRejecting(null)}>{translatePortalText("Cancel")}</button>
            <button className="btn-primary !bg-rose-600 hover:!bg-rose-700 disabled:opacity-60" onClick={doReject} disabled={!!busyId || reason.trim().length < 3}>
              <X size={14} /> {translatePortalText(" Confirm rejection\n            ")}</button>
          </div>
        </div>
      </Modal>
    </PageWrap>
  )
}
