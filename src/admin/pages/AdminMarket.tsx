import { useNavigate } from 'react-router-dom'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { TableToolbar, useTableFilters, NoFilterMatches, TablePagination, type TableFiltersConfig } from '../../shared/TableFilters'
import { motion } from 'framer-motion'
import { Sailboat, CalendarCheck2, Ticket, Plus, Check, X, Star, RotateCcw, CalendarClock } from 'lucide-react'
import { money } from '../adminData'
import { listingPhoto } from '../../images'
import { PLACEHOLDER_AVATAR } from '../../format'
import { PageWrap } from './_shared'
import { Section, Modal, toast, Img, Counter, Progress, EmptyState, CardGridSkeleton } from '../../ui'
import { AdminHeader, ABadge, AProgress } from '../adminUi'
import { confirmAndRun } from '../../async'
import { translatePortalText  , formatPortalDate, formatPortalNumber, formatPortalPercent} from '../../i18n/runtime'
import { adminPortalApi, couponsApi, type ApiCoupon, type ApiAd, type ApiAdminPayment } from '../../api'

const SERVICE_LINE_META: Record<string, { name: string; icon: string; color: string }> = {
  boat: { name: 'Boat rentals', icon: '⛵', color: '#0e7c86' },
  marina: { name: 'Marina berths', icon: '⚓', color: '#2f6fed' },
  fuel: { name: 'Fuel delivery', icon: '⛽', color: '#e08a2c' },
  maintenance: { name: 'Maintenance', icon: '🔧', color: '#8b5cf6' },
}

// ══════════ BOATS & MARINAS (§5, §6, §8) ══════════
export function AdminListings() { return <ListingsPage /> }
function ListingsPage() {
  const nav = useNavigate()
  const [tab, setTab] = useState<'Boats' | 'Marinas' | 'Services'>('Boats')
  const [boats, setBoats] = useState<any[]>([])
  const [marinas, setMarinas] = useState<any[]>([])
  const [loadingBoats, setLoadingBoats] = useState(true)
  const [loadingMarinas, setLoadingMarinas] = useState(true)
  const [boatsError, setBoatsError] = useState<string | null>(null)
  const [marinasError, setMarinasError] = useState<string | null>(null)
  const [serviceLines, setServiceLines] = useState<{ key: string; listings: number; bookings: number; revenue: number }[]>([])

  useEffect(() => {
    adminPortalApi.dashboard().then(res => setServiceLines(res.data.serviceLines || [])).catch(() => {})
  }, [])

  const loadBoats = useCallback(async () => {
    setLoadingBoats(true); setBoatsError(null)
    try {
      const res = await adminPortalApi.listings({ type: 'boat', limit: 100 })
      setBoats(res.data.items.map((b: any) => ({
        id: b.id || b._id,
        name: b.name,
        type: translatePortalText(b.type || 'Boat'),
        provider: b.providerId || translatePortalText('Unknown provider'),
        length: b.specs?.length ? `${formatPortalNumber(b.specs.length)} ${translatePortalText('ft')}` : translatePortalText('Unknown length'),
        // Boat has no separate moderation state — 'out_of_service' doubles as "rejected/hidden".
        status: b.status === 'out_of_service' ? 'Rejected' : 'Approved',
        featured: !!b.featured,
        verified: true,
        rating: b.rating || 0,
        image: b.images?.[0] || listingPhoto(b.name, 'boat'),
        price: b.pricing?.daily || 0
      })))
    } catch (e) {
      setBoatsError(e instanceof Error ? e.message : 'Failed to load boats')
    } finally {
      setLoadingBoats(false)
    }
  }, [])

  const loadMarinas = useCallback(async () => {
    setLoadingMarinas(true); setMarinasError(null)
    try {
      const res = await adminPortalApi.listings({ type: 'marina', limit: 100 })
      setMarinas(res.data.items.map((m: any) => ({
        id: m.id || m._id,
        name: m.name,
        city: m.location?.city || 'Unknown',
        // `berthCount` is what the berth records actually show, which can
        // differ from the marina's own `facilities.berths` figure — the count
        // the occupancy percentage is computed against is the truthful one to
        // display beside it.
        berths: m.berthCount ?? m.facilities?.berths ?? 0,
        rating: m.rating || 0,
        // Null when the marina has no berths on record. Previously hardcoded
        // to 0, so every harbour read as completely empty.
        occupancy: m.occupancyPct ?? null,
        occupiedBerths: m.occupiedBerths ?? 0,
        status: m.isActive ? 'Approved' : 'Pending',
        image: m.images?.[0] || listingPhoto(m.name, 'marina')
      })))
    } catch (e) {
      setMarinasError(e instanceof Error ? e.message : 'Failed to load marinas')
    } finally {
      setLoadingMarinas(false)
    }
  }, [])

  useEffect(() => { loadBoats(); loadMarinas() }, [loadBoats, loadMarinas])

  const setBoatStatus = (b: any, status: 'active' | 'out_of_service') => {
    adminPortalApi.updateBoatListing(b.id, { status }).then(() => { toast(translatePortalText(status === 'active' ? `${b.name} approved & listed` : `${b.name} rejected`), status === 'active' ? undefined : 'warn'); loadBoats() }).catch(() => toast(translatePortalText('Could not update listing'), 'warn'))
  }
  const toggleFeatured = (b: any) => {
    adminPortalApi.updateBoatListing(b.id, { featured: !b.featured }).then(() => { toast(translatePortalText(b.featured ? `${b.name} unfeatured` : `${b.name} featured on homepage`)); loadBoats() }).catch(() => toast(translatePortalText('Could not update listing'), 'warn'))
  }
  const verifyMarina = (m: any) => {
    adminPortalApi.updateMarinaListing(m.id, { isActive: true }).then(() => { toast(translatePortalText(`${m.name} verified`)); loadMarinas() }).catch(() => toast(translatePortalText('Could not verify marina'), 'warn'))
  }

  /**
   * A toolbar per tab, because a boat and a marina share no searchable field.
   * The Services tab is a fixed set of six service lines and needs neither.
   */
  const boatCfg: TableFiltersConfig<any> = useMemo(() => ({
    searchFields: (b) => [b.name, b.type, b.provider, b.length],
    filters: [
      { key: 'type', label: translatePortalText('Boat type'), get: (b) => b.type },
      { key: 'status', label: translatePortalText('Listing status'), get: (b) => translatePortalText(b.status) },
      { key: 'provider', label: translatePortalText('Provider'), get: (b) => b.provider },
      {
        key: 'featured',
        label: translatePortalText('Placement'),
        options: [
          { value: 'featured', label: translatePortalText('Featured') },
          { value: 'standard', label: translatePortalText('Not featured') },
        ],
        get: (b) => (b.featured ? 'featured' : 'standard'),
      },
    ],
  }), [])
  const boatTf = useTableFilters(boats, boatCfg)

  const marinaCfg: TableFiltersConfig<any> = useMemo(() => ({
    searchFields: (m) => [m.name, m.city],
    filters: [
      { key: 'city', label: translatePortalText('City'), get: (m) => m.city },
      { key: 'status', label: translatePortalText('Status'), get: (m) => translatePortalText(m.status) },
      {
        key: 'occupancy',
        label: translatePortalText('Occupancy'),
        options: [
          { value: 'full', label: translatePortalText('90% and over') },
          { value: 'busy', label: translatePortalText('50-89%') },
          { value: 'quiet', label: translatePortalText('Under 50%') },
          { value: 'unknown', label: translatePortalText('No berth records') },
        ],
        get: (m) => (m.occupancy === null ? 'unknown' : String(m.occupancy)),
        match: (m, v) => {
          // A marina with no berths recorded is not "quiet" — it is unmeasured,
          // and lumping it under 50% invents an answer the data cannot give.
          if (m.occupancy === null) return v === 'unknown'
          const o = Number(m.occupancy)
          if (v === 'full') return o >= 90
          if (v === 'busy') return o >= 50 && o < 90
          if (v === 'quiet') return o < 50
          return false
        },
      },
    ],
  }), [])
  const marinaTf = useTableFilters(marinas, marinaCfg)

  return (
    <PageWrap>
      <AdminHeader title={translatePortalText('Boats, Marinas & Services')} sub={translatePortalText('Approve listings, feature boats, verify marinas and manage service catalog')} icon={<Sailboat className="text-emerald-500" />}
        actions={
          /*
            An "Add listing" button sat here and reported "New listing form
            opened". No form existed, and none should: boats, marinas and
            services are created by the businesses that own them, in their own
            apps and portals, then approved here. An admin-authored listing
            would have no owner to pay, no documents to verify and nobody
            accountable for it.
          */
          undefined
        } />

      <div className="mb-4 flex gap-1.5 rounded-2xl bg-white p-1.5 shadow-soft w-fit">
        {(['Boats', 'Marinas', 'Services'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={`relative rounded-xl px-4 py-2 text-[13px] font-bold transition ${tab === t ? 'text-white' : 'text-slate-500 hover:text-deep-900'}`}>
            {tab === t && <motion.span layoutId="list-tab" className="absolute inset-0 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500" />}
            <span className="relative z-10">{translatePortalText(t)}</span>
          </button>
        ))}
      </div>

      {tab === 'Boats' && boatsError && (
        <div className="card mb-4 !border-rose-200 !bg-rose-50 text-sm text-rose-600">{translatePortalText("Couldn't load: ")}{boatsError}</div>
      )}
      {tab === 'Boats' && loadingBoats && (
        <CardGridSkeleton count={6} />
      )}
      {tab === 'Boats' && !loadingBoats && boats.length === 0 && (
        <EmptyState icon="🛥️" text={translatePortalText("No boat listings yet.")} />
      )}
      {tab === 'Boats' && !loadingBoats && boats.length > 0 && (
        <TableToolbar state={boatTf} config={boatCfg} rows={boats} noun="listings"
          searchPlaceholder={translatePortalText("Search boats by name, type or provider...")} />
      )}
      {tab === 'Boats' && !loadingBoats && boats.length > 0 && boatTf.filtered.length === 0 && (
        <NoFilterMatches noun="listings" onClear={boatTf.clear} />
      )}
      {tab === 'Boats' && !loadingBoats && boatTf.filtered.length > 0 && (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {boatTf.pagedRows.map((b, i) => (
            <motion.div key={b.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
              className="card card-hover overflow-hidden">
              <div className="relative h-36">
                <Img src={b.image} className="h-full w-full" />
                <div className="absolute inset-0 bg-gradient-to-t from-deep-950/80 via-deep-950/15 to-transparent" />
                {b.featured && <span className="absolute start-2 top-2 flex items-center gap-1 rounded-full bg-amber-400 px-2.5 py-1 text-[10px] font-extrabold text-amber-950"><Star size={11} className="fill-amber-950" /> {translatePortalText("FEATURED")}</span>}
                <span className="absolute end-2 top-2"><ABadge dot={b.status === 'Rejected'}>{translatePortalText(b.status)}</ABadge></span>
                <div className="absolute bottom-2 start-3 text-white">
                  <p className="font-display text-[16px] font-extrabold">{b.name} <span className="text-[11px] font-semibold text-white/70">{b.length}</span></p>
                  <p className="text-[11px] text-white/70">{translatePortalText(b.type)} · {b.provider}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3.5">
                <div className="text-xs"><b className="font-display text-base text-deep-900">{money(b.price)}</b><span className="text-slate-400">/{translatePortalText("day")}</span></div>
                <div className="text-[11px] text-slate-400">{b.rating ? `${formatPortalNumber(b.rating, { maximumFractionDigits: 1 })}★` : translatePortalText('No ratings yet')}</div>
                <div className="ms-auto flex gap-1.5">
                  {b.status === 'Rejected' ? (
                    <button onClick={() => setBoatStatus(b, 'active')} className="btn-admin !py-1.5 !px-2.5 !text-[11px]"><Check size={12} /> {translatePortalText("Approve")}</button>
                  ) : (<>
                    <button onClick={() => toggleFeatured(b)} className="btn-ghost !py-1.5 !px-2.5 !text-[11px]"><Star size={12} /> {b.featured ? translatePortalText('Unfeature') : translatePortalText('Feature')}</button>
                    <button onClick={() => setBoatStatus(b, 'out_of_service')} className="btn-ghost !py-1.5 !px-2.5 !text-[11px] !text-rose-500"><X size={12} /> {translatePortalText("Reject")}</button>
                  </>)}
                </div>
              </div>
            </motion.div>
          ))}
          </div>
          <TablePagination state={boatTf} noun="listings" />
        </div>
      )}

      {tab === 'Marinas' && marinasError && (
        <div className="card mb-4 !border-rose-200 !bg-rose-50 text-sm text-rose-600">{translatePortalText("Couldn't load: ")}{marinasError}</div>
      )}
      {tab === 'Marinas' && loadingMarinas && (
        <CardGridSkeleton count={4} cols="md:grid-cols-2" />
      )}
      {tab === 'Marinas' && !loadingMarinas && marinas.length === 0 && (
        <EmptyState icon="⚓" text={translatePortalText("No marina listings yet.")} />
      )}
      {tab === 'Marinas' && !loadingMarinas && marinas.length > 0 && (
        <TableToolbar state={marinaTf} config={marinaCfg} rows={marinas} noun="marinas"
          searchPlaceholder={translatePortalText("Search marinas by name or city...")} />
      )}
      {tab === 'Marinas' && !loadingMarinas && marinas.length > 0 && marinaTf.filtered.length === 0 && (
        <NoFilterMatches noun="marinas" onClear={marinaTf.clear} />
      )}
      {tab === 'Marinas' && !loadingMarinas && marinaTf.filtered.length > 0 && (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {marinaTf.pagedRows.map((m, i) => (
            <motion.div key={m.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="card card-hover overflow-hidden">
              <div className="flex">
                <div className="relative h-32 w-40 shrink-0"><Img src={m.image} className="h-full w-full" /></div>
                <div className="min-w-0 flex-1 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-display text-[15px] font-extrabold text-deep-900">⚓ {m.name}</p>
                    <ABadge dot={m.status === 'Pending'}>{translatePortalText(m.status)}</ABadge>
                  </div>
                  <p className="text-[11px] text-slate-400">{m.city} · {formatPortalNumber(m.berths)} {translatePortalText("berths")} · {formatPortalNumber(m.rating, { maximumFractionDigits: 1 })}★</p>
                  {/* `occupancy` is null when the marina has no berth records,
                      which is not the same as an empty harbour — so the bar is
                      replaced by a note rather than sitting at zero. */}
                  {m.occupancy === null ? (
                    <p className="mt-3 text-[10px] font-bold uppercase tracking-wide text-slate-300">{translatePortalText("No berths on record")}</p>
                  ) : (
                    <div className="mt-3">
                      <div className="mb-1 flex justify-between text-[10px] font-bold text-slate-400">
                        <span>{translatePortalText("OCCUPANCY")}</span>
                        <span>{formatPortalPercent(m.occupancy)} · {formatPortalNumber(m.occupiedBerths)}/{formatPortalNumber(m.berths)}</span>
                      </div>
                      <AProgress pct={m.occupancy} />
                    </div>
                  )}
                  <div className="mt-3 flex gap-1.5">
                    {/*
                      A "Berths" button opened no berth map — the berth grid is
                      the marina operator's own screen, scoped to their marina,
                      and there is no admin-side equivalent to send anyone to.

                      "Reports" generated nothing, but marina occupancy *is* a
                      real report in the library, so this now opens it.
                    */}
                    <button onClick={() => nav('/admin/reports/marina-occupancy')} className="btn-ghost !py-1 !px-2.5 !text-[11px]">{translatePortalText('Occupancy report')}</button>
                    {m.status === 'Pending' && <button onClick={() => verifyMarina(m)} className="btn-admin !py-1 !px-2.5 !text-[11px]">{translatePortalText('Verify')}</button>}
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
          </div>
          <TablePagination state={marinaTf} noun="marinas" />
        </div>
      )}

      {tab === 'Services' && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {serviceLines.map((raw, i) => {
            const s = { ...raw, ...SERVICE_LINE_META[raw.key] }
            return (
            <motion.div key={s.key} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="card card-hover p-4">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-xl text-xl" style={{ background: `${s.color}1a` }}>{s.icon}</span>
                <div className="min-w-0 flex-1"><p className="text-[14px] font-extrabold text-deep-900">{translatePortalText(s.name)}</p><p className="text-[11px] text-slate-400">{formatPortalNumber(s.listings)} {translatePortalText("listings")}</p></div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                <div className="rounded-xl bg-sand py-2"><p className="font-display text-sm font-extrabold text-deep-900">{formatPortalNumber(s.bookings)}</p><p className="text-[9px] font-bold uppercase text-slate-400">{translatePortalText("Bookings")}</p></div>
                <div className="rounded-xl bg-sand py-2"><p className="font-display text-sm font-extrabold" style={{ color: s.color }}>{money(s.revenue)}</p><p className="text-[9px] font-bold uppercase text-slate-400">{translatePortalText("Revenue")}</p></div>
              </div>
              {/*
                "Pricing" and "Categories" buttons sat here firing "X pricing
                rules opened" / "X categories opened". There is no platform-wide
                service pricing or category editor — each provider prices their
                own services — so both were labels for screens that do not
                exist. The revenue and booking figures above are real and are
                what this card is for.
              */}
            </motion.div>
          )})}
        </div>
      )}
    </PageWrap>
  )
}

// ══════════ BOOKINGS (§7) ══════════
const BOOKING_TYPE_META: Record<string, { icon: string; label: string }> = {
  trip: { icon: '⛵', label: 'Boat trip' },
  dock: { icon: '⚓', label: 'Dock berth' },
  fuel: { icon: '⛽', label: 'Fuel order' },
  service: { icon: '🧰', label: 'Marina service' },
  maintenance: { icon: '🔧', label: 'Maintenance' },
}
const PAYMENT_STATUS_LABEL: Record<string, string> = { paid: 'Paid', pending: 'Pending', failed: 'Failed', refunded: 'Refunded', partially_refunded: 'Partially refunded' }
export function AdminBookings() { return <BookingsPage /> }
function BookingsPage() {
  const [status, setStatus] = useState('All')
  const [payments, setPayments] = useState<ApiAdminPayment[]>([])
  const [totals, setTotals] = useState({ gross: 0, commission: 0, count: 0 })
  const [sel, setSel] = useState<ApiAdminPayment | null>(null)
  const statuses = ['All', 'paid', 'pending', 'failed', 'refunded', 'partially_refunded']

  const load = () => {
    adminPortalApi.payments({ limit: 200, status: status === 'All' ? undefined : status })
      .then(res => { setPayments(res.data.items); setTotals(res.data.totals) })
      .catch(() => toast(translatePortalText('Could not load bookings'), 'warn'))
  }
  useEffect(load, [status])

  const refund = (p: ApiAdminPayment) => {
    adminPortalApi.refundPayment(p._id).then(() => { toast(translatePortalText('Refund issued'), 'warn'); setSel(null); load() }).catch(e => toast(translatePortalText(e instanceof Error ? e.message : 'Refund failed'), 'warn'))
  }
  const cancelBooking = (p: ApiAdminPayment) => {
    adminPortalApi.cancelBookingPayment(p._id).then(() => { toast(translatePortalText('Booking cancelled'), 'warn'); setSel(null); load() }).catch(e => toast(translatePortalText(e instanceof Error ? e.message : 'Could not cancel booking'), 'warn'))
  }

  return (
    <PageWrap>
      <AdminHeader title={translatePortalText("Booking Management")} sub={`${formatPortalNumber(totals.count)} ${translatePortalText("bookings")} · ${money(totals.gross)} · ${money(totals.commission)}`} icon={<CalendarCheck2 className="text-emerald-500" />} />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {statuses.map(s => (
          <button key={s} onClick={() => setStatus(s)} className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${status === s ? 'bg-gradient-to-r from-emerald-600 to-teal-500 text-white shadow-glow' : 'bg-white text-slate-500 hover:text-deep-900'}`}>{s === 'All' ? translatePortalText('All') : translatePortalText(PAYMENT_STATUS_LABEL[s] || s)}</button>
        ))}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto custom-scrollbar">
          <div className="min-w-[980px]">
            <div className="grid grid-cols-[1.5fr_1.4fr_1fr_0.8fr_0.9fr_180px] items-center gap-3 border-b border-slate-100 bg-sand px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              <span>{translatePortalText("Booking")}</span><span>{translatePortalText("Item · provider")}</span><span>{translatePortalText("Date")}</span><span>{translatePortalText("Amount")}</span><span>{translatePortalText("Status")}</span><span className="text-right">{translatePortalText("Actions")}</span>
            </div>
            {payments.length === 0 && <div className="py-14 text-center text-sm text-slate-400">{translatePortalText("No bookings match this filter.")}</div>}
            {payments.map((b, i) => {
              const customer = typeof b.customer === 'object' ? b.customer : null
              const provider = typeof b.provider === 'object' && b.provider ? b.provider : null
              const meta = BOOKING_TYPE_META[b.bookingType || 'trip'] || { icon: '📦', label: b.bookingType || 'Booking' }
              return (
              <motion.div key={b._id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                className="grid grid-cols-[1.5fr_1.4fr_1fr_0.8fr_0.9fr_180px] items-center gap-3 border-b border-slate-50 px-5 py-3.5 transition hover:bg-sand/70">
                <div className="flex items-center gap-3 min-w-0">
                  {/* A photograph of a yacht stood here, cropped into a
                      person-shaped circle beside the customer's name. */}
                  <img src={customer?.avatar || PLACEHOLDER_AVATAR} className="h-9 w-9 shrink-0 rounded-full object-cover ring-2 ring-white shadow-soft" />
                  <div className="min-w-0"><p className="truncate text-[13px] font-extrabold text-deep-900">#{b._id.slice(-6)}</p><p className="truncate text-[11px] text-slate-400">{customer?.name || 'Unknown'}</p></div>
                </div>
                <div className="min-w-0 text-xs"><p className="flex items-center gap-1.5 truncate font-semibold text-deep-800"><span>{meta.icon}</span>{translatePortalText(meta.label)}</p><p className="truncate text-[11px] text-slate-400">{provider?.business?.businessName || provider?.name || '—'}</p></div>
                <div className="text-xs text-slate-500 whitespace-nowrap">{formatPortalDate(new Date(b.createdAt))}</div>
                <div className="text-[13px] font-extrabold text-deep-900 whitespace-nowrap">{money(b.amount)}{!!b.commissionAmount && <p className="text-[10px] font-semibold text-emerald-600">+{money(b.commissionAmount)} {translatePortalText(" comm.")}</p>}</div>
                <div className="whitespace-nowrap"><ABadge dot={b.status === 'paid'}>{translatePortalText(PAYMENT_STATUS_LABEL[b.status] || b.status)}</ABadge></div>
                <div className="flex justify-end gap-1.5 whitespace-nowrap">
                  <button onClick={() => setSel(b)} className="btn-ghost !py-1.5 !px-2.5 !text-[11px]">{translatePortalText('Timeline')}</button>
                  {(b.status === 'paid' || b.status === 'partially_refunded') && <button onClick={() => refund(b)} className="btn-ghost !py-1.5 !px-2.5 !text-[11px] !text-rose-500"><RotateCcw size={12} /> {translatePortalText("Refund")}</button>}
                </div>
              </motion.div>
            )})}
          </div>
        </div>
      </div>

      <Modal open={!!sel} onClose={() => setSel(null)} title={sel ? `📆 #${sel._id.slice(-6)} — ${translatePortalText('timeline')}` : ''}>
        {sel && (() => {
          const customer = typeof sel.customer === 'object' ? sel.customer : null
          const provider = typeof sel.provider === 'object' && sel.provider ? sel.provider : null
          const meta = BOOKING_TYPE_META[sel.bookingType || 'trip'] || { icon: '📦', label: sel.bookingType || 'Booking' }
          return (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-xl bg-sand p-3">
              <img src={customer?.avatar || PLACEHOLDER_AVATAR} className="h-11 w-11 rounded-full object-cover" />
              <div className="min-w-0 flex-1"><p className="text-sm font-extrabold text-deep-900">{customer?.name || 'Unknown'}</p><p className="text-xs text-slate-400">{meta.icon} {translatePortalText(meta.label)} · {provider?.business?.businessName || provider?.name || '—'}</p></div>
              <ABadge dot={sel.status === 'paid'}>{translatePortalText(PAYMENT_STATUS_LABEL[sel.status] || sel.status)}</ABadge>
            </div>
            <div className="relative space-y-3 ps-6">
              <div className="absolute start-2 top-1 bottom-1 w-0.5 bg-gradient-to-b from-emerald-400 to-teal-300" />
              {[
                [translatePortalText('Booking created'), formatPortalDate(new Date(sel.createdAt), { dateStyle: 'medium', timeStyle: 'short' }), true],
                [translatePortalText('Payment authorized'), sel.paidAt ? `${money(sel.amount)} · ${translatePortalText(sel.method)}` : translatePortalText('Not yet paid'), !!sel.paidAt],
                [translatePortalText('Commission settled'), sel.commissionAmount ? money(sel.commissionAmount) : '—', !!sel.paidAt && !!sel.commissionAmount],
                [translatePortalText('Refunded'), sel.refundAmount ? money(sel.refundAmount) : '—', sel.status === 'refunded' || sel.status === 'partially_refunded'],
              ].map(([t, d, done], i) => (
                <div key={i} className="relative">
                  <span className={`absolute -start-[18px] top-1.5 h-3 w-3 rounded-full border-2 border-white shadow ${done ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                  <p className="text-[13px] font-extrabold text-deep-900">{t}</p><p className="text-[11px] text-slate-400">{d}</p>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
              {sel.bookingType === 'trip' && sel.status === 'paid' && <button className="btn-ghost !text-rose-500" onClick={() => cancelBooking(sel)}>{translatePortalText("Cancel booking")}</button>}
              {(sel.status === 'paid' || sel.status === 'partially_refunded') && <button className="btn-ghost !text-rose-500" onClick={() => refund(sel)}><RotateCcw size={14} /> {translatePortalText("Refund")}</button>}
            </div>
          </div>
        )})()}
      </Modal>
    </PageWrap>
  )
}

// ══════════ COUPONS & ADS (§12, §13) ══════════
// Coupons are wired to the real Coupon CRUD backend via `couponsApi`.
// Ads are wired to the real Ad model via `adminPortalApi.ads/createAd/updateAd`;
// the campaigns listed here are the same records `/content/ads` serves to the
// customer app's homepage banner. Impressions, clicks and spend are figures the
// admin enters by hand — there is no ad-serving pixel — which is what the
// section's own subtitle tells the operator.
export function AdminPromotions() { return <PromotionsPage /> }
function PromotionsPage() {
  const [coupons, setCoupons] = useState<ApiCoupon[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const emptyForm = { code: '', description: '', discountPct: '10', scope: 'all' as ApiCoupon['scope'], applicableTripId: '', maxDiscount: '', expiresAt: '', usageLimit: '', perUserLimit: '1' }
  const [form, setForm] = useState(emptyForm)

  const [ads, setAds] = useState<ApiAd[]>([])
  const [adBusyId, setAdBusyId] = useState<string | null>(null)
  const [creatingAd, setCreatingAd] = useState(false)
  const emptyAdForm = { name: '', advertiser: '', slot: 'Homepage Banner' as ApiAd['slot'] }
  const [adForm, setAdForm] = useState(emptyAdForm)

  const loadAds = useCallback(async () => {
    try { const res = await adminPortalApi.ads(); setAds(res.data.ads) } catch { toast(translatePortalText('Could not load ad campaigns'), 'warn') }
  }, [])
  useEffect(() => { loadAds() }, [loadAds])

  const submitCreateAd = async () => {
    if (!adForm.name.trim() || !adForm.advertiser.trim()) { toast(translatePortalText('Campaign name and advertiser are required'), 'warn'); return }
    try {
      await adminPortalApi.createAd(adForm)
      toast(translatePortalText(`Campaign "${adForm.name}" created`))
      setCreatingAd(false); setAdForm(emptyAdForm)
      await loadAds()
    } catch (e) { toast(translatePortalText(e instanceof Error ? e.message : 'Failed to create campaign'), 'warn') }
  }
  const toggleAdStatus = async (a: ApiAd) => {
    setAdBusyId(a._id)
    try { await adminPortalApi.updateAd(a._id, { status: a.status === 'Running' ? 'Paused' : 'Running' }); await loadAds() }
    catch (e) { toast(translatePortalText(e instanceof Error ? e.message : 'Failed to update campaign'), 'warn') }
    finally { setAdBusyId(null) }
  }

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await couponsApi.list({ limit: 100 })
      setCoupons(res.data.items)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load coupons')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const submitCreate = async () => {
    const code = form.code.trim().toUpperCase()
    if (code.length < 2) { toast(translatePortalText('Coupon code must be at least 2 characters'), 'warn'); return }
    const discountPct = Number(form.discountPct)
    if (!discountPct || discountPct < 1 || discountPct > 100) { toast(translatePortalText('Discount must be between 1 and 100%'), 'warn'); return }
    try {
      await couponsApi.create({
        code,
        description: form.description.trim() || undefined,
        discountPct,
        scope: form.scope,
        applicableTripId: form.applicableTripId.trim() || undefined,
        maxDiscount: form.maxDiscount ? Number(form.maxDiscount) : undefined,
        expiresAt: form.expiresAt || undefined,
        usageLimit: form.usageLimit ? Number(form.usageLimit) : undefined,
        perUserLimit: form.perUserLimit ? Number(form.perUserLimit) : undefined,
      })
      toast(translatePortalText(`Coupon ${code} created`))
      setCreating(false); setForm(emptyForm)
      await load()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Failed to create coupon'), 'warn')
    }
  }

  const toggleActive = async (c: ApiCoupon) => {
    setBusyId(c._id)
    try {
      await couponsApi.update(c._id, { isActive: !c.isActive })
      toast(translatePortalText(`${c.code} ${c.isActive ? 'deactivated' : 'activated'}`))
      await load()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Failed to update coupon'), 'warn')
    } finally {
      setBusyId(null)
    }
  }

  const removeCoupon = (c: ApiCoupon) =>
    confirmAndRun({
      title: `Remove coupon ${c.code}?`,
      body: 'Customers will no longer be able to redeem it.',
      confirmLabel: 'Remove',
      busyLabel: 'Removing…',
      danger: true,
      run: async () => {
        setBusyId(c._id)
        try {
          await couponsApi.remove(c._id)
          await load()
        } finally {
          setBusyId(null)
        }
      },
      success: `Coupon ${c.code} removed successfully`,
      error: 'Failed to remove the coupon. Please try again.',
    })

  return (
    <PageWrap>
      <AdminHeader title={translatePortalText("Coupons & Advertisements")} sub={translatePortalText("Discount campaigns, referral programs, banners & sponsored placements")} icon={<Ticket className="text-emerald-500" />}
        actions={<button className="btn-admin" onClick={() => setCreating(true)}><Plus size={15} /> {translatePortalText("New coupon")}</button>} />

      <Section title={translatePortalText("Active coupons")} sub={translatePortalText("Percentage, flat & referral discounts")} className="mb-5">
        {error && <div className="card mb-4 !border-rose-200 !bg-rose-50 text-sm text-rose-600">{translatePortalText("Couldn't load: ")}{error}</div>}
        {loading && <CardGridSkeleton count={4} cols="sm:grid-cols-2 xl:grid-cols-4" />}
        {!loading && coupons.length === 0 && <EmptyState icon="🎟️" text={translatePortalText("No coupons yet — create one to get started.")} />}
        {!loading && coupons.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {coupons.map((c, i) => (
              <motion.div key={c._id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                className={`relative overflow-hidden rounded-2xl border-2 border-dashed p-4 ${c.isActive ? 'border-emerald-300 bg-emerald-50/40' : 'border-slate-200 bg-slate-50 opacity-70'}`}>
                <div className="absolute -start-3 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-white border-2 border-dashed border-emerald-300" />
                <div className="absolute -end-3 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-white border-2 border-dashed border-emerald-300" />
                <div className="flex items-center justify-between">
                  <p className="font-mono text-lg font-extrabold tracking-wider text-deep-900">{c.code}</p>
                  <span className={`chip !text-[10px] ${c.isActive ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-slate-100 text-slate-500'}`}>{translatePortalText(c.isActive ? 'Active' : 'Inactive')}</span>
                </div>
                <p className="mt-1 text-sm font-bold text-emerald-700">{formatPortalPercent(c.discountPct)} {translatePortalText("off")}{c.maxDiscount ? ` (${translatePortalText("max")} ${money(c.maxDiscount)})` : ''}</p>
                <p className="text-[11px] text-slate-500">
                  {c.scope === 'trip' ? `🗺️ ${translatePortalText('Trips')}` : translatePortalText(c.scope)}
                  {c.applicableTripId ? ` · 🎯 ${translatePortalText('Trip')}: ${c.applicableTripId.slice(-6)}` : ''}
                  · {c.expiresAt ? `${translatePortalText('exp')} ${formatPortalDate(new Date(c.expiresAt))}` : translatePortalText('no expiry')}
                </p>
                <div className="mt-3">
                  <div className="mb-1 flex justify-between text-[10px] font-bold text-slate-400"><span>{formatPortalNumber(c.usedCount)} {translatePortalText("used")}</span>{!!c.usageLimit && <span>{formatPortalNumber(c.usageLimit)} {translatePortalText("max")}</span>}</div>
                  <Progress pct={c.usageLimit ? Math.min(100, Math.round(c.usedCount / c.usageLimit * 100)) : Math.min(100, c.usedCount)} tone="bg-gradient-to-r from-emerald-500 to-teal-400" />
                </div>
                <div className="mt-3 flex gap-1.5 border-t border-slate-100 pt-3">
                  <button disabled={busyId === c._id} onClick={() => toggleActive(c)} className="btn-ghost flex-1 !justify-center !py-1.5 !text-[11px] disabled:opacity-60">{translatePortalText(c.isActive ? 'Deactivate' : 'Activate')}</button>
                  <button disabled={busyId === c._id} onClick={() => removeCoupon(c)} className="btn-ghost !py-1.5 !px-2.5 !text-[11px] !text-rose-500 disabled:opacity-60">{translatePortalText("Delete")}</button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </Section>

      <Section title={translatePortalText("Advertisement campaigns")} sub={translatePortalText("Homepage banners, featured slots & sponsored listings — no ad-serving pixel exists yet, so impressions/clicks/spend are entered manually")}
        actions={<button className="btn-admin !py-1.5 !px-3 !text-xs" onClick={() => setCreatingAd(true)}><Plus size={13} /> {translatePortalText("New campaign")}</button>}>
        <div className="card !shadow-none !border-0 overflow-hidden">
          <div className="overflow-x-auto custom-scrollbar">
            <div className="min-w-[920px]">
              <div className="grid grid-cols-[1.8fr_1fr_1fr_0.8fr_0.8fr_190px] items-center gap-3 border-b border-slate-100 bg-sand px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <span>{translatePortalText("Campaign")}</span><span>{translatePortalText("Slot")}</span><span>{translatePortalText("Impressions · clicks")}</span><span>{translatePortalText("CTR")}</span><span>{translatePortalText("Spend")}</span><span className="text-right">{translatePortalText("Actions")}</span>
              </div>
              {ads.length === 0 && <EmptyState icon="📣" text={translatePortalText("No ad campaigns yet.")} />}
              {ads.map((a, i) => {
                const ctr = a.impressions ? Math.round((a.clicks / a.impressions) * 1000) / 10 : 0
                return (
                <motion.div key={a._id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                  className="grid grid-cols-[1.8fr_1fr_1fr_0.8fr_0.8fr_190px] items-center gap-3 border-b border-slate-50 px-5 py-3.5 transition hover:bg-sand/70">
                  <div className="min-w-0"><p className="truncate text-[13px] font-extrabold text-deep-900">{a.name}</p><p className="truncate text-[11px] text-slate-400">{a.advertiser}</p></div>
                  <div className="text-xs font-semibold text-slate-600 truncate">{a.slot}</div>
                  <div className="text-xs text-slate-500 whitespace-nowrap">{formatPortalNumber(a.impressions)} · {formatPortalNumber(a.clicks)}</div>
                  <div className="text-[13px] font-extrabold text-emerald-600 whitespace-nowrap">{formatPortalPercent(ctr)}</div>
                  <div className="text-[13px] font-extrabold text-deep-900 whitespace-nowrap">{money(a.spend)}</div>
                  <div className="flex justify-end items-center gap-1.5 whitespace-nowrap">
                    <ABadge dot={a.status === 'Running'}>{translatePortalText(a.status)}</ABadge>
                    <button disabled={adBusyId === a._id} onClick={() => toggleAdStatus(a)} className="btn-ghost !py-1.5 !px-2.5 !text-[11px] disabled:opacity-60">{translatePortalText(a.status === 'Running' ? 'Pause' : 'Resume')}</button>
                  </div>
                </motion.div>
              )})}
            </div>
          </div>
        </div>
      </Section>

      <Modal open={creating} onClose={() => setCreating(false)} title={`🎟️ ${translatePortalText("New Coupon Code")}`}>
        <div className="space-y-3">
          <div>
            <label className="label">{translatePortalText("Coupon Code")}</label>
            <input className="input uppercase font-mono" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder={translatePortalText("e.g. SUNSET20")} />
          </div>
          <div>
            <label className="label">{translatePortalText("Description (Optional)")}</label>
            <input className="input" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder={translatePortalText("e.g. 20% off Red Sea sunset cruise")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{translatePortalText("Discount %")}</label>
              <input type="number" min="1" max="100" className="input" value={form.discountPct} onChange={e => setForm(f => ({ ...f, discountPct: e.target.value }))} />
            </div>
            <div>
              <label className="label">{translatePortalText("Max Discount (SAR / $)")}</label>
              <input type="number" className="input" value={form.maxDiscount} onChange={e => setForm(f => ({ ...f, maxDiscount: e.target.value }))} placeholder={translatePortalText("Optional cap")} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{translatePortalText("Scope")}</label>
              <select className="input" value={form.scope} onChange={e => setForm(f => ({ ...f, scope: e.target.value as ApiCoupon['scope'] }))}>
                <option value="all">{translatePortalText("All Services")}</option>
                <option value="trip">{translatePortalText("Trips Only")}</option>
                <option value="dock">{translatePortalText("Dock Berths Only")}</option>
                <option value="fuel">{translatePortalText("Fuel Only")}</option>
                <option value="service">{translatePortalText("Marina Services Only")}</option>
              </select>
            </div>
            <div>
              <label className="label">{translatePortalText("Target Specific Trip ID (Optional)")}</label>
              <input className="input font-mono" value={form.applicableTripId} onChange={e => setForm(f => ({ ...f, applicableTripId: e.target.value }))} placeholder={translatePortalText('e.g. 64f1a2b3c...')} />
              <p className="mt-0.5 text-[10px] text-slate-400">{translatePortalText("Leave blank for all trips")}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{translatePortalText("Expiration Date")}</label>
              <input type="date" className="input" value={form.expiresAt} onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))} />
            </div>
            <div>
              <label className="label">{translatePortalText("Usage Limit (Max Uses)")}</label>
              <input type="number" className="input" value={form.usageLimit} onChange={e => setForm(f => ({ ...f, usageLimit: e.target.value }))} placeholder={translatePortalText("Unlimited")} />
            </div>
          </div>
          <button onClick={submitCreate} className="btn-admin w-full !justify-center mt-2"><Plus size={14} /> {translatePortalText("Create Coupon")}</button>
        </div>
      </Modal>

      <Modal open={creatingAd} onClose={() => setCreatingAd(false)} title={`📣 ${translatePortalText("New ad campaign")}`}>
        <div className="space-y-3">
          <div><label className="label">{translatePortalText("Campaign name")}</label><input className="input" value={adForm.name} onChange={e => setAdForm(f => ({ ...f, name: e.target.value }))} placeholder={translatePortalText("e.g. Homepage hero — summer regatta")} /></div>
          <div><label className="label">{translatePortalText("Advertiser")}</label><input className="input" value={adForm.advertiser} onChange={e => setAdForm(f => ({ ...f, advertiser: e.target.value }))} placeholder={translatePortalText("e.g. Island Charters")} /></div>
          <div><label className="label">{translatePortalText("Slot")}</label>
            <select className="input" value={adForm.slot} onChange={e => setAdForm(f => ({ ...f, slot: e.target.value as ApiAd['slot'] }))}>
              {(['Homepage Banner', 'Featured Providers', 'Sponsored Listings'] as const).map(s => <option key={s} value={s}>{translatePortalText(s)}</option>)}
            </select>
          </div>
          <button onClick={submitCreateAd} className="btn-admin w-full !justify-center"><Plus size={14} /> {translatePortalText("Create campaign")}</button>
        </div>
      </Modal>
    </PageWrap>
  )
}
