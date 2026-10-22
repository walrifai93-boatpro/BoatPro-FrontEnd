import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { TableToolbar, useTableFilters, type TableFiltersConfig } from '../../shared/TableFilters'
import { motion } from 'framer-motion'
import {
  Fuel, Check, X, RefreshCw, MapPin, Phone, Mail, Radio,
  Clock, ShieldCheck, ExternalLink, AlertTriangle, ChevronRight,
  Building2, Globe
} from 'lucide-react'
import { PageWrap } from './_shared'
import { AdminHeader } from '../adminUi'
import { Modal, toast, Counter, CardGridSkeleton } from '../../ui'
import { confirm } from '../../async'
import { translatePortalText  , formatPortalDate, formatPortalNumber} from '../../i18n/runtime'
import { adminPortalApi, fileUrl } from '../../api'

// Drafts too: they had a count and no tab, so a draft could only be found by
// scrolling "All Stations". A station saved before approvals existed is a
// draft — that is how the model and the ordering endpoints read it.
const TABS = [
  { key: 'pending', label: 'Pending Review' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'draft', label: 'Drafts' },
  { key: '', label: 'All Stations' },
] as const

function approvalBadgeClass(status: string) {
  if (status === 'approved') return 'bg-emerald-100 text-emerald-700 border-emerald-200'
  if (status === 'rejected') return 'bg-rose-100 text-rose-700 border-rose-200'
  if (status === 'draft') return 'bg-slate-100 text-slate-600 border-slate-200'
  return 'bg-amber-100 text-amber-700 border-amber-200'
}

/**
 * The badge. It printed the raw status — defaulting a missing one to
 * "approved", which is not how anything else reads it — and called an approved
 * station that was taken offline "approved" as though it were selling.
 */
function approvalBadgeLabel(s: any): string {
  const status = s.approvalStatus || 'draft'
  if (status === 'approved') return translatePortalText(s.isActive === false ? 'Approved · offline' : 'Approved')
  if (status === 'pending') return translatePortalText('Pending Review')
  if (status === 'rejected') return translatePortalText('Rejected')
  return translatePortalText('Draft')
}

const FUEL_NAME_FALLBACK: Record<string, string> = { diesel: 'Diesel', gasoline: 'Gasoline', premium_gasoline: 'Premium gasoline', jet_fuel: 'Jet fuel' }

export default function AdminFuelStationApprovals() {
  const [tab, setTab] = useState<string>('pending')
  const [stations, setStations] = useState<any[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [detail, setDetail] = useState<any | null>(null)
  const [rejecting, setRejecting] = useState<any | null>(null)
  const [reason, setReason] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Every page: one page of 100 hid the 101st station from the queue.
      const all: any[] = []
      let counts: Record<string, number> = {}
      for (let page = 1; page <= 50; page++) {
        const res = await adminPortalApi.fuelStationApprovals(tab || undefined, page)
        const batch = res.data?.stations || []
        counts = res.data?.statusCounts || counts
        all.push(...batch)
        if (batch.length < 100 || all.length >= (res.data?.total ?? 0)) break
      }
      setStations(all)
      setCounts(counts)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load fuel stations')
    } finally {
      setLoading(false)
    }
  }, [tab])

  useEffect(() => { load() }, [load])

  const act = async (station: any, fn: () => Promise<unknown>, msg: string, tone: any = 'success') => {
    const id = station._id || station.id
    setBusyId(id)
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

  /**
   * Approve, after naming what the admin is approving past.
   *
   * The server approves and activates a station with no checks at all — no
   * licences, expired ones, nothing for sale, or a draft its provider never
   * submitted — and the buttons did that in one click.
   */
  const doApprove = async (s: any) => {
    const id = s._id || s.id
    if (!id || busyId) return
    const licenses: any[] = s.licenses ?? []
    const expired = licenses.filter((l) => l.expiresAt && new Date(l.expiresAt).getTime() < Date.now())
    const sells = s.fuels?.length || s.fuelTypes?.length
    const warnings: string[] = []
    if ((s.approvalStatus || 'draft') === 'draft') warnings.push(translatePortalText('This station is still a draft — the provider has not submitted it for review.'))
    if (!s.provider) warnings.push(translatePortalText('The provider account that owns it no longer exists.'))
    if (!licenses.length) warnings.push(translatePortalText('No licences are on file.'))
    if (expired.length) warnings.push(translatePortalText(`Expired: ${expired.map((l) => l.name).join(', ')}.`))
    if (!sells) warnings.push(translatePortalText('No fuel grades are set up, so it has nothing to sell.'))
    const ok = await confirm({
      title: `Approve "${s.name}"?`,
      body: [...warnings, translatePortalText('It is activated and appears on customer maps straight away.')].join(' '),
      confirmLabel: warnings.length ? 'Approve anyway' : 'Approve',
      danger: warnings.length > 0,
    })
    if (ok) act(s, () => adminPortalApi.approveFuelStation(id), `"${s.name}" approved & activated`)
  }

  const doReject = () => {
    if (!rejecting || busyId) return
    const id = rejecting._id || rejecting.id
    if (!id) { toast(translatePortalText('Invalid station ID'), 'warn'); return }
    if (reason.trim().length < 3) { toast(translatePortalText('Please provide a rejection reason (min 3 chars)'), 'warn'); return }
    act(rejecting, () => adminPortalApi.rejectFuelStation(id, reason.trim()), `"${rejecting.name}" rejected`, 'warn')
  }

  /**
   * The queue's filters.
   *
   * Search was a `toLowerCase()` substring over four fields — which cannot
   * match an Arabic station or business name typed with different alef or
   * diacritic conventions from the one it was stored with. City, submission
   * date and ordering were not offered at all, so "which stations in Jeddah
   * are still waiting" had to be answered by reading.
   */
  const filterCfg: TableFiltersConfig<any> = useMemo(() => ({
    searchFields: (st: any) => [
      st.name,
      st.address,
      st.city,
      st.provider?.business?.businessName,
      st.provider?.name,
    ],
    filters: [
      { key: 'city', label: translatePortalText('City'), get: (st: any) => st.city },
      { key: 'submitted', label: translatePortalText('Submitted'), kind: 'dateRange', get: (st: any) => st.createdAt },
    ],
    sortOptions: [
      // Oldest first: a review queue is worked from the longest wait.
      { key: 'submitted', label: 'Submitted', get: (st: any) => st.createdAt, defaultDir: 'asc' },
      { key: 'name', label: 'Station', get: (st: any) => st.name, defaultDir: 'asc' },
      { key: 'city', label: 'City', get: (st: any) => st.city, defaultDir: 'asc' },
    ],
    defaultSort: 'submitted',
    defaultPageSize: 0,
  }), [])
  const tf = useTableFilters(stations, filterCfg)
  const filtered = tf.filtered

  const totalCount = Object.values(counts).reduce((a, b) => a + b, 0)

  return (
    <PageWrap>
      <AdminHeader
        title={translatePortalText("Fuel Station Approvals")}
        sub={translatePortalText("Review new child station locations submitted by fuel providers. Only approved stations appear on customer maps and accept fuel orders.")}
        icon={<Fuel className="text-amber-500" />}
        actions={
          <button className="btn-ghost !rounded-xl !px-3.5 !py-2 text-xs font-semibold" onClick={load}>
            <RefreshCw size={14} /> {translatePortalText("Refresh")}
          </button>
        }
      />

      {/* KPI Metric Summary Cards */}
      <div className="mb-6 grid grid-cols-2 gap-3.5 md:grid-cols-4">
        {(['pending', 'approved', 'rejected'] as const).map((s, i) => (
          <motion.div
            key={s}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className={`card flex cursor-pointer items-center gap-3.5 p-4 transition hover:shadow-md ${
              tab === s ? 'ring-2 ring-amber-400 bg-amber-50/20' : ''
            }`}
            onClick={() => setTab(s)}
          >
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-xl">
              {s === 'pending' ? '⏳' : s === 'approved' ? '✅' : '❌'}
            </span>
            <div>
              <p className="font-display text-2xl font-extrabold text-deep-900">
                <Counter value={counts[s] || 0} />
              </p>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 capitalize">
                {translatePortalText(s === 'pending' ? 'Pending Review' : s)}
              </p>
            </div>
          </motion.div>
        ))}

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className={`card flex cursor-pointer items-center gap-3.5 p-4 transition hover:shadow-md ${
            tab === '' ? 'ring-2 ring-amber-400 bg-amber-50/20' : ''
          }`}
          onClick={() => setTab('')}
        >
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-xl text-amber-600">
            ⛽
          </span>
          <div>
            <p className="font-display text-2xl font-extrabold text-deep-900">
              <Counter value={totalCount} />
            </p>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText("Total Stations")}</p>
          </div>
        </motion.div>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-full px-4 py-1.5 text-[12.5px] font-bold transition ${
                tab === t.key
                  ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md'
                  : 'bg-white text-slate-500 hover:text-deep-900 border border-slate-200/80 shadow-sm'
              }`}
            >
              {translatePortalText(t.label)}
              {t.key && counts[t.key] !== undefined ? ` (${counts[t.key]})` : ''}
            </button>
          ))}
        </div>

      </div>

      <TableToolbar
        state={tf}
        config={filterCfg}
        rows={stations}
        noun="stations"
        searchPlaceholder={translatePortalText("Search by station, city or provider…")}
      />

      {error && <div className="card mb-4 !border-rose-200 !bg-rose-50 text-sm text-rose-600">{translatePortalText("Couldn't load: ")}{error}</div>}
      {loading && <CardGridSkeleton count={6} />}

      {!loading && !error && filtered.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-200 py-16 text-center text-sm text-slate-400 bg-white">
          {translatePortalText("No fuel stations found in this filter.")}
        </div>
      )}

      {/* Fuel Stations Grid */}
      {!loading && filtered.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((s, i) => {
            const id = s._id || s.id
            // No provider: the account that owned this station no longer exists.
            const pName = s.provider ? s.provider.business?.businessName || s.provider.name : translatePortalText('Provider account deleted')
            return (
              <motion.div
                key={id || i}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.04, 0.4) }}
                className={`card overflow-hidden transition-all duration-200 hover:shadow-lg ${
                  s.approvalStatus === 'pending' ? 'ring-2 ring-amber-300' : ''
                }`}
              >
                {/* Station Cover / Header */}
                <div className="relative h-32 bg-slate-900 p-4 text-white overflow-hidden flex flex-col justify-between">
                  {s.images?.[0] ? (
                    <img src={fileUrl(s.images[0])} alt={s.name} className="absolute inset-0 h-full w-full object-cover opacity-40" />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-amber-600/30 to-slate-900" />
                  )}
                  <div className="relative z-10 flex items-start justify-between">
                    <span className="flex items-center gap-1.5 rounded-lg bg-black/60 backdrop-blur-md px-2.5 py-1 text-[11px] font-bold text-amber-300">
                      <Fuel size={12} /> {translatePortalText(s.stationType || "Station Branch")}
                    </span>
                    <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wide ${approvalBadgeClass(s.approvalStatus || 'draft')}`}>
                      {approvalBadgeLabel(s)}
                    </span>
                  </div>
                  <div className="relative z-10">
                    <p className="truncate text-base font-extrabold text-white">{s.name}</p>
                    <p className="text-[11px] text-white/70 truncate">{s.city ? `${s.city} · ` : ''}{s.address}</p>
                  </div>
                </div>

                <div className="p-4 space-y-3">
                  {/* Provider Details */}
                  <div className="rounded-xl bg-slate-50 p-2.5 text-[12px] flex items-center gap-2.5 border border-slate-100">
                    <Building2 size={16} className="text-slate-400 shrink-0" />
                    <div className="min-w-0">
                      <p className="font-bold text-deep-900 truncate">{pName}</p>
                      <p className="text-[11px] text-slate-500 truncate">{s.provider?.email || translatePortalText('No email')}</p>
                    </div>
                  </div>

                  {/* Station Quick Metadata */}
                  <div className="space-y-1 text-[11.5px] text-slate-600">
                    <p className="flex items-center gap-2">
                      <MapPin size={13} className="text-amber-500 shrink-0" />
                      {/* The marina it sits in, when the API populated one — the
                          bare coordinates told a reviewer nothing about where it is. */}
                      <span className="truncate">
                        {s.marina?.name
                          ? `${s.marina.name}${s.marina.city ? ` · ${s.marina.city}` : ''}`
                          : `${formatPortalNumber(s.latitude, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}, ${formatPortalNumber(s.longitude, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`}
                      </span>
                      <a
                        href={`https://www.google.com/maps?q=${s.latitude},${s.longitude}`}
                        target="_blank"
                        rel="noreferrer"
                        className="ms-auto text-sky-600 hover:underline inline-flex items-center gap-0.5 text-[10.5px]"
                      >
                        {translatePortalText("\n                        Map ")}<ExternalLink size={10} />
                      </a>
                    </p>
                    {s.contactNumber && (
                      <p className="flex items-center gap-2">
                        <Phone size={13} className="text-slate-400 shrink-0" />
                        <span>{s.contactNumber}</span>
                      </p>
                    )}
                    <p className="flex items-center gap-2">
                      <Clock size={13} className="text-slate-400 shrink-0" />
                      <span>{s.open24h ? translatePortalText('Open 24 Hours') : (s.operatingHours || translatePortalText('Standard Hours'))}</span>
                    </p>
                    {/* No "Offers Boat Fuel Delivery" line: fuel is station-only since
                        2026-10-12 (the boat comes to the pump). Old rows still carry
                        the legacy `delivery` flag, which no longer means anything. */}
                  </div>

                  {/* Rejection notice if rejected */}
                  {s.approvalStatus === 'rejected' && s.rejectionReason && (
                    <div className="rounded-xl bg-rose-50 p-2.5 text-[11px] text-rose-700 border border-rose-100">
                      <p className="font-bold mb-0.5">{translatePortalText("Rejection Reason")}:</p>
                      <p className="line-clamp-2">{s.rejectionReason}</p>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex gap-2 border-t border-slate-100 pt-3">
                    <button
                      onClick={() => setDetail(s)}
                      className="btn-ghost flex-1 !justify-center !py-1.5 !text-xs font-semibold"
                    >
                      {translatePortalText("View Details")}
                    </button>

                    {s.approvalStatus === 'pending' && (
                      <>
                        <button
                          disabled={busyId === id}
                          onClick={() => void doApprove(s)}
                          className="btn-admin flex-1 !justify-center !py-1.5 !text-xs font-bold !bg-emerald-600 hover:!bg-emerald-700 text-white disabled:opacity-60"
                        >
                          <Check size={13} /> {translatePortalText("Approve")}
                        </button>
                        <button
                          disabled={busyId === id}
                          onClick={() => { setRejecting(s); setReason('') }}
                          className="btn-ghost !justify-center !py-1.5 !px-2.5 !text-xs !text-rose-600 hover:!bg-rose-50"
                          title={translatePortalText("Reject")}
                        >
                          <X size={14} />
                        </button>
                      </>
                    )}

                    {s.approvalStatus === 'rejected' && (
                      <button
                        disabled={busyId === id}
                        onClick={() => void doApprove(s)}
                        className="btn-admin flex-1 !justify-center !py-1.5 !text-xs font-bold !bg-emerald-600 text-white disabled:opacity-60"
                      >
                        <Check size={13} /> {translatePortalText(" Approve\n                      ")}</button>
                    )}

                    {s.approvalStatus === 'approved' && (
                      <button
                        disabled={busyId === id}
                        onClick={() => { setRejecting(s); setReason('') }}
                        className="btn-ghost flex-1 !justify-center !py-1.5 !text-xs !text-rose-600 hover:!bg-rose-50"
                      >
                        <X size={13} /> {translatePortalText("Revoke")}
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            )
          })}
        </div>
      )}

      {/* Reject Station Modal */}
      {rejecting && (
        <Modal
          open={!!rejecting}
          onClose={() => setRejecting(null)}
          title={`${translatePortalText("Reject Station")}: ${rejecting.name}`}
        >
          <div className="p-4 space-y-4">
            <div className="flex items-center gap-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-800 border border-amber-200">
              <AlertTriangle size={18} className="shrink-0 text-amber-600" />
              <p>{translatePortalText("The provider will be notified with this reason and the station will remain offline.")}</p>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{translatePortalText("Reason for Rejection *")}</label>
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder={translatePortalText("E.g., Incomplete maritime licensing, invalid dock coordinates, or environmental zoning restrictions…")}
                rows={4}
                className="input !rounded-xl text-xs w-full"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button className="btn-ghost text-xs" onClick={() => setRejecting(null)}>
                {translatePortalText("Cancel")}
              </button>
              <button
                className="btn-admin !bg-rose-600 hover:!bg-rose-700 text-white text-xs font-bold"
                disabled={reason.trim().length < 3 || busyId === (rejecting._id || rejecting.id)}
                onClick={doReject}
              >
                {translatePortalText("Confirm Rejection")}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Station Details Deep Modal */}
      {detail && (
        <Modal
          open={!!detail}
          onClose={() => setDetail(null)}
          title={`${translatePortalText("Station Profile:")} ${detail.name}`}
        >
          <div className="p-5 space-y-5 max-h-[80vh] overflow-y-auto">
            {/* Header info */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-extrabold text-deep-900">{detail.name}</h3>
                <p className="text-xs text-slate-500">{detail.legalName || detail.nameAr || 'Fuel Station Location'}</p>
              </div>
              <span className={`rounded-full border px-3 py-1 text-xs font-extrabold uppercase ${approvalBadgeClass(detail.approvalStatus || 'draft')}`}>
                {approvalBadgeLabel(detail)}
              </span>
            </div>

            {/* Provider Section */}
            <div className="rounded-2xl bg-slate-50 p-4 border border-slate-200/80">
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 mb-2">{translatePortalText("Operating Provider")}</p>
              <p className="font-bold text-sm text-deep-900">{detail.provider ? detail.provider.business?.businessName || detail.provider.name : translatePortalText('Provider account deleted')}</p>
              {detail.provider && <p className="text-xs text-slate-600">{[detail.provider.email, detail.provider.phone || translatePortalText('No phone')].filter(Boolean).join(' · ')}</p>}
            </div>

            {/* Location & Navigation */}
            <div className="space-y-2">
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">{translatePortalText("Location & Coordinates")}</p>
              <div className="rounded-xl border border-slate-100 p-3 space-y-1.5 text-xs text-slate-700 bg-white">
                {detail.marina?.name && <p><span className="font-semibold text-slate-500">{translatePortalText("Marina:")}</span> {detail.marina.name}</p>}
                <p><span className="font-semibold text-slate-500">{translatePortalText("Address:")}</span> {detail.address || '—'}</p>
                <p><span className="font-semibold text-slate-500">{translatePortalText("City / Region:")}</span> {detail.city || '—'} {detail.region ? `(${detail.region})` : ''}</p>
                <p><span className="font-semibold text-slate-500">{translatePortalText("GPS Coordinates:")}</span> {formatPortalNumber(detail.latitude, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}, {formatPortalNumber(detail.longitude, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</p>
                <a
                  href={`https://www.google.com/maps?q=${detail.latitude},${detail.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sky-600 font-semibold hover:underline pt-1"
                >
                  {translatePortalText("\n                  Open in Google Maps ")}<ExternalLink size={12} />
                </a>
              </div>
            </div>

            {/* Contact & Radio */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-slate-100 p-3 text-xs space-y-1 bg-white">
                <p className="font-bold text-slate-500 text-[10.5px] uppercase">{translatePortalText("Contact Phone")}</p>
                <p className="font-semibold">{detail.contactNumber || '—'}</p>
              </div>
              <div className="rounded-xl border border-slate-100 p-3 text-xs space-y-1 bg-white">
                <p className="font-bold text-slate-500 text-[10.5px] uppercase">{translatePortalText("VHF Radio Channel")}</p>
                <p className="font-semibold">{detail.vhfChannel || '—'}</p>
              </div>
            </div>

            {/* Fuel Grades — the catalogue's products, each in its own unit
                (`fuels`, from the API); the embedded `fuelTypes` only for a
                station from before the catalogue. */}
            {(() => {
              const fuels: { name: string; price: number; unit: string }[] = detail.fuels?.length
                ? detail.fuels
                : (detail.fuelTypes ?? []).map((f: any) => ({ name: FUEL_NAME_FALLBACK[f.type] || f.type, price: f.pricePerLiter, unit: 'L' }))
              if (!fuels.length) return null
              return (
                <div>
                  <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 mb-2">{translatePortalText("Fuel Types Offered")}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {fuels.map((f, idx) => (
                      <div key={idx} className="rounded-xl bg-slate-50 p-2.5 text-xs border border-slate-100 flex items-center justify-between">
                        <span className="font-bold text-deep-900">{translatePortalText(f.name)}</span>
                        <span className="font-extrabold text-amber-600">{formatPortalNumber(f.price)} {translatePortalText(detail.currency || 'SAR')} / {f.unit}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}

            {/* Licenses */}
            {detail.licenses && detail.licenses.length > 0 && (
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 mb-2">{translatePortalText("Licenses & Certifications")}</p>
                <div className="space-y-2">
                  {detail.licenses.map((lic: any, idx: number) => (
                    <div key={idx} className="rounded-xl border border-slate-100 p-3 text-xs bg-white flex items-center justify-between">
                      <div>
                        <p className="font-bold text-deep-900">{lic.name}</p>
                        <p className="text-[11px] text-slate-500">{translatePortalText("Ref: ")}{lic.reference || '—'} {translatePortalText(" · Expires: ")}{lic.expiresAt ? formatPortalDate(new Date(lic.expiresAt)) : translatePortalText('N/A')}</p>
                        {lic.expiresAt && new Date(lic.expiresAt).getTime() < Date.now() && (
                          <p className="text-[10.5px] font-bold text-rose-600">{translatePortalText("Expired")}</p>
                        )}
                      </div>
                      {lic.fileUrl && (
                        <a href={fileUrl(lic.fileUrl)} target="_blank" rel="noreferrer" className="btn-ghost !p-1.5 text-sky-600">
                          <ExternalLink size={14} />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Modal Actions */}
            <div className="flex gap-2 pt-4 border-t border-slate-100 justify-end">
              <button className="btn-ghost text-xs" onClick={() => setDetail(null)}>
                {translatePortalText("Close")}
              </button>
              {detail.approvalStatus !== 'approved' && (
                <button
                  disabled={busyId === (detail._id || detail.id)}
                  onClick={() => void doApprove(detail)}
                  className="btn-admin !bg-emerald-600 hover:!bg-emerald-700 text-white text-xs font-bold"
                >
                  <Check size={13} /> {translatePortalText("Approve Station")}
                </button>
              )}
              {detail.approvalStatus !== 'rejected' && (
                <button
                  disabled={busyId === (detail._id || detail.id)}
                  onClick={() => { const d = detail; setDetail(null); setRejecting(d); setReason('') }}
                  className="btn-ghost !text-rose-600 hover:!bg-rose-50 text-xs font-bold"
                >
                  <X size={13} /> {translatePortalText("Reject Station")}
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </PageWrap>
  )
}
