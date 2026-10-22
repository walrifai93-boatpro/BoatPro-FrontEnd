import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Megaphone,
  CheckCircle2,
  XCircle,
  Clock,
  CreditCard,
  CalendarClock,
  StopCircle,
  Loader2,
  Sailboat,
  AlertCircle,
  TimerReset,
  LayoutGrid,
} from 'lucide-react'
import { Modal, toast } from '../../ui'
import { money } from '../../format'
import {
  featuredListingApi,
  fileUrl,
  type FeaturedListingData,
  type FeaturedListingStatus,
  type FeaturedSlotState,
} from '../../api'
import {
  NoFilterMatches,
  TableToolbar,
  useTableFilters,
  type TableFiltersConfig,
} from '../../shared/TableFilters'
import { formatPortalDate, formatPortalNumber, localizedField, translatePortalText } from '../../i18n/runtime'

/**
 * Featured listing applications — and the banner inventory they are competing
 * for.
 *
 * Two things make this page more than a review queue, and both are about
 * scarcity:
 *
 *   - **Approving is allocating.** The banner holds a fixed number of trips,
 *     set here. An approval claims one of those places immediately, before any
 *     money moves, so the page leads with how many are left rather than making
 *     the admin discover it from a refusal.
 *
 *   - **The order is the product.** Places go to whoever applied first, and the
 *     server enforces it — approving out of turn is refused. So the queue is
 *     listed oldest first and the one the admin may act on is marked, instead of
 *     leaving them to work it out from timestamps.
 *
 * Approving is still not activating: it agrees a price and holds a place, and
 * the placement only runs once the provider has paid. An approved-but-unpaid
 * application therefore stays visibly distinct from a live one — and, because it
 * is holding a place somebody else wants, carries the date that hold expires.
 */

const STATUS_META: Record<FeaturedListingStatus, { label: string; cls: string; icon: any }> = {
  pending: { label: 'In the queue', cls: 'bg-amber-50 text-amber-700 border-amber-200', icon: Clock },
  approved: { label: 'Slot held · awaiting payment', cls: 'bg-sky-50 text-sky-700 border-sky-200', icon: CreditCard },
  active: { label: 'Running', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
  expired: { label: 'Finished', cls: 'bg-slate-100 text-slate-500 border-slate-200', icon: CalendarClock },
  rejected: { label: 'Declined', cls: 'bg-rose-50 text-rose-700 border-rose-200', icon: XCircle },
  cancelled: { label: 'Withdrawn', cls: 'bg-slate-100 text-slate-500 border-slate-200', icon: XCircle },
  // Distinct from 'cancelled' on purpose: the provider wanted this one and lost
  // it to the clock, which is the platform's story to tell, not theirs.
  lapsed: { label: 'Slot released · never paid', cls: 'bg-orange-50 text-orange-700 border-orange-200', icon: TimerReset },
}

const TABS: { key: 'pending' | 'approved' | 'active' | 'all'; label: string }[] = [
  { key: 'pending', label: 'Queue' },
  { key: 'approved', label: 'Awaiting payment' },
  { key: 'active', label: 'Running' },
  { key: 'all', label: 'Everything' },
]

const fmtDay = (iso?: string) =>
  iso ? formatPortalDate(iso, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

/** Days left on a running placement — what the admin actually wants to know. */
function daysLeft(endsAt?: string) {
  if (!endsAt) return null
  const ms = new Date(endsAt).getTime() - Date.now()
  if (ms <= 0) return 0
  return Math.ceil(ms / 86400000)
}

export default function AdminFeaturedListings() {
  const [tab, setTab] = useState<'pending' | 'approved' | 'active' | 'all'>('pending')
  const [listings, setListings] = useState<FeaturedListingData[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading] = useState(true)
  // Shown in place of the list: a failed load used to fall through to "Nothing
  // here", and a 0 / 0 banner read as a real, empty pool.
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [priceFor, setPriceFor] = useState<FeaturedListingData | null>(null)
  const [priceDraft, setPriceDraft] = useState('')
  const [daysDraft, setDaysDraft] = useState('')
  const [notesDraft, setNotesDraft] = useState('')

  const [declineFor, setDeclineFor] = useState<FeaturedListingData | null>(null)
  const [stopFor, setStopFor] = useState<FeaturedListingData | null>(null)
  const [reasonDraft, setReasonDraft] = useState('')

  /** The pool every application on this page is competing for. */
  /**
   * Narrowing within whatever the selected tab returned.
   *
   * The tabs above are server-side and coarse — "Everything" can be the whole
   * history of the banner, and there was no way to find one provider's
   * application in it, no way to separate the two banners (even though the API
   * has always accepted a `placement` filter), and no ordering at all.
   *
   * Sorted oldest-first by default because places go to whoever applied first
   * and the server enforces it, so queue order *is* the subject of this page.
   */
  const filterCfg: TableFiltersConfig<FeaturedListingData> = useMemo(
    () => ({
      searchFields: (l) => [
        l.provider?.name,
        l.provider?.business?.businessName,
        l.provider?.email,
        l.trip?.title,
        l.trip?.titleAr,
        l.note,
        l.adminNotes,
      ],
      filters: [
        {
          key: 'placement',
          label: 'Banner',
          anyLabel: 'Both banners',
          options: [
            { value: 'home_banner', label: 'Home banner' },
            { value: 'trips_banner', label: 'Trips banner' },
          ],
          get: (l) => l.placement,
        },
        { key: 'status', label: 'Status', get: (l) => STATUS_META[l.status]?.label ?? l.status },
        { key: 'applied', label: 'Applied', kind: 'dateRange', get: (l) => l.createdAt },
        { key: 'running', label: 'Window', kind: 'dateRange', get: (l) => l.endsAt },
      ],
      sortOptions: [
        { key: 'applied', label: 'Applied', get: (l) => l.createdAt, defaultDir: 'asc' },
        { key: 'price', label: 'Price', get: (l) => l.price, defaultDir: 'desc' },
        { key: 'days', label: 'Days requested', get: (l) => l.requestedDays, defaultDir: 'desc' },
        { key: 'ends', label: 'Ends', get: (l) => l.endsAt, defaultDir: 'asc' },
        { key: 'provider', label: 'Provider', get: (l) => l.provider?.name, defaultDir: 'asc' },
      ],
      defaultSort: 'applied',
      // The queue is read as a whole — paginating it would hide the position
      // that decides who may be approved next.
      defaultPageSize: 0,
    }),
    []
  )
  const tf = useTableFilters(listings, filterCfg)

  const [slots, setSlots] = useState<FeaturedSlotState[]>([])
  const [poolOpen, setPoolOpen] = useState(false)
  const [capacityDraft, setCapacityDraft] = useState('')
  const [holdDraft, setHoldDraft] = useState('')
  const [savingPool, setSavingPool] = useState(false)

  // The home banner is the placement being sold today; the trips banner exists
  // in the model so a second one needs no migration. Sizing the one on screen.
  const home = useMemo(() => slots.find((s) => s.placement === 'home_banner') ?? null, [slots])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await featuredListingApi.adminList(tab === 'all' ? undefined : { status: tab })
      setListings(res.data.listings)
      setPendingCount(res.data.pending)
      setSlots(res.data.slots ?? [])
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load featured listing applications')
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not load featured listing applications'), 'warn')
    } finally {
      setLoading(false)
    }
  }, [tab])

  useEffect(() => {
    void load()
  }, [load])

  const openPrice = (l: FeaturedListingData) => {
    setPriceFor(l)
    setPriceDraft('')
    setDaysDraft(String(l.requestedDays))
    setNotesDraft('')
  }

  const submitPrice = async () => {
    if (!priceFor || busyId) return
    const price = Number(priceDraft)
    // An empty field is Number('') = 0, which passed the old `< 0` check and
    // approved the application at 0 — and the provider's checkout refuses an
    // application without a positive price, so the slot sat held and unpayable.
    if (priceDraft.trim() === '' || !Number.isFinite(price) || price <= 0) {
      toast(translatePortalText('Enter the price the provider will pay (above 0)'), 'warn')
      return
    }
    const days = Number(daysDraft)
    setBusyId(priceFor.id)
    try {
      await featuredListingApi.adminApprove(priceFor.id, {
        price,
        // Only sent when the admin is selling a different span than was asked
        // for, so an untouched field cannot silently rewrite the request.
        days: Number.isFinite(days) && days > 0 && days !== priceFor.requestedDays ? days : undefined,
        adminNotes: notesDraft.trim() || undefined,
      })
      toast(translatePortalText('Approved — the provider has been told what to pay'))
      setPriceFor(null)
      await load()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not approve this application'), 'warn')
    } finally {
      setBusyId(null)
    }
  }

  const submitDecline = async () => {
    if (!declineFor) return
    setBusyId(declineFor.id)
    try {
      await featuredListingApi.adminReject(declineFor.id, { reason: reasonDraft.trim() || undefined })
      toast(translatePortalText('Application declined'))
      setDeclineFor(null)
      setReasonDraft('')
      await load()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not decline this application'), 'warn')
    } finally {
      setBusyId(null)
    }
  }

  const submitStop = async () => {
    if (!stopFor) return
    setBusyId(stopFor.id)
    try {
      await featuredListingApi.adminStop(stopFor.id, { reason: reasonDraft.trim() || undefined })
      toast(translatePortalText('Placement stopped'))
      setStopFor(null)
      setReasonDraft('')
      await load()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not stop this placement'), 'warn')
    } finally {
      setBusyId(null)
    }
  }

  const openPool = () => {
    // Empty, not 100 / 3, when the server sent no slot state: a prefilled guess
    // saved as-is would overwrite the real setting.
    setCapacityDraft(home ? String(home.capacity) : '')
    setHoldDraft(home ? String(home.reservationDays) : '')
    setPoolOpen(true)
  }

  const submitPool = async () => {
    const capacity = Number(capacityDraft)
    const reservationDays = Number(holdDraft)
    if (capacityDraft.trim() === '' || !Number.isFinite(capacity) || capacity < 0) {
      toast(translatePortalText('Enter how many trips the banner should carry'), 'warn')
      return
    }
    setSavingPool(true)
    try {
      await featuredListingApi.adminSetSlots({
        capacities: { home_banner: Math.trunc(capacity) },
        reservationDays:
          Number.isFinite(reservationDays) && reservationDays > 0 ? Math.trunc(reservationDays) : undefined,
      })
      toast(translatePortalText('Banner size saved'))
      setPoolOpen(false)
      await load()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not save the banner size'), 'warn')
    } finally {
      setSavingPool(false)
    }
  }

  /**
   * The one pending application the admin may approve right now.
   *
   * The server refuses anything else — places go in the order they were asked
   * for — so the page marks it rather than letting an admin find out by being
   * told no. Read off the rendered list, which the server already returns oldest
   * first when the queue tab is showing.
   */
  const nextInQueue = useMemo(
    () =>
      listings
        .filter((l) => l.status === 'pending')
        .reduce<FeaturedListingData | null>(
          (oldest, l) => (!oldest || new Date(l.createdAt) < new Date(oldest.createdAt) ? l : oldest),
          null
        ),
    [listings]
  )

  const revenue = useMemo(
    () =>
      listings
        .filter((l) => l.status === 'active' || l.status === 'expired')
        .reduce((sum, l) => sum + (l.price ?? 0), 0),
    [listings]
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-extrabold text-deep-900">
            <Megaphone size={22} className="text-emerald-500" /> {translatePortalText('Featured Listings')}
          </h1>
          <p className="text-sm text-slate-500">
            {translatePortalText("Boat providers paying to appear in the customer app's promotion banner. Places are limited and go to whoever applied first.")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/*
            Places left, first and largest.

            Approving spends one of these, so it is the number that decides
            whether the queue below can be actioned at all. Before it was here,
            the only way to learn the banner was full was to try to approve
            something and be refused.
          */}
          <button
            onClick={openPool}
            title={translatePortalText('Set how many trips the banner carries')}
            className="rounded-2xl border border-slate-100 bg-white px-4 py-2 text-center shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/40"
          >
            <p className="flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <LayoutGrid size={11} /> {translatePortalText('Places free')}
            </p>
            <p
              className={`font-display text-xl font-extrabold ${
                home && home.free === 0 ? 'text-rose-600' : 'text-deep-900'
              }`}
            >
              {home ? `${formatPortalNumber(home.free)} / ${formatPortalNumber(home.capacity)}` : '—'}
            </p>
          </button>
          <div className="rounded-2xl border border-slate-100 bg-white px-4 py-2 text-center shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText('In the queue')}</p>
            <p className="font-display text-xl font-extrabold text-amber-600">{formatPortalNumber(pendingCount)}</p>
          </div>
          <div className="rounded-2xl border border-slate-100 bg-white px-4 py-2 text-center shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText('Paid, this view')}</p>
            <p className="font-display text-xl font-extrabold text-emerald-600">{money(revenue)}</p>
          </div>
        </div>
      </div>

      {/*
        Said in words when the banner is full, not just as a red number: the
        approve buttons below stay visible and will be refused, so the reason has
        to be legible before the click rather than in the toast after it.
      */}
      {home && home.free === 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertCircle size={15} className="shrink-0" />
          <span>
            {translatePortalText('All')} {formatPortalNumber(home.capacity)} {translatePortalText('places are taken, so nothing new can be approved yet.')}
            {home.nextFreeAt ? ` ${translatePortalText('The next one frees on')} ${fmtDay(home.nextFreeAt)}.` : ''}
            {home.waiting > 0 ? ` ${formatPortalNumber(home.waiting)} ${home.waiting === 1 ? translatePortalText('application waiting') : translatePortalText('applications waiting')}.` : ''}
          </span>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-xl px-3.5 py-1.5 text-xs font-bold transition ${
              tab === t.key
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {translatePortalText(t.label)}
            {t.key === 'pending' && pendingCount > 0 && (
              <span className="ms-1.5 rounded-full bg-white/25 px-1.5 text-[10px]">{formatPortalNumber(pendingCount)}</span>
            )}
          </button>
        ))}
      </div>

      <TableToolbar
        state={tf}
        config={filterCfg}
        rows={listings}
        noun="applications"
        searchPlaceholder={translatePortalText('Search provider, business or trip…')}
      />

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-100 bg-white p-10 text-sm text-slate-400">
          <Loader2 size={16} className="animate-spin" /> {translatePortalText('Loading applications…')}
        </div>
      ) : loadError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-10 text-center">
          <AlertCircle size={28} className="mx-auto text-rose-500" />
          <p className="mt-2 text-sm font-bold text-deep-900">{translatePortalText('Couldn’t load applications')}</p>
          <p className="text-xs text-rose-600">{loadError}</p>
          <button onClick={() => void load()} className="btn-ghost mt-3 text-xs font-bold">{translatePortalText('Retry')}</button>
        </div>
      ) : listings.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
          <Megaphone size={30} className="mx-auto text-slate-300" />
          <p className="mt-2 text-sm font-bold text-deep-900">{translatePortalText('Nothing here')}</p>
          <p className="text-xs text-slate-400">
            {tab === 'pending'
              ? translatePortalText('No applications are waiting for a price.')
              : translatePortalText('No applications match this view.')}
          </p>
        </div>
      ) : tf.filtered.length === 0 ? (
        // Distinct from the empty state above: there *is* data in this tab, the
        // filters just exclude all of it, and saying so is what stops an
        // operator reading a narrow filter as missing data.
        <NoFilterMatches noun="applications" onClear={tf.clear} />
      ) : (
        <div className="space-y-3">
          {tf.filtered.map((l) => {
            const meta = STATUS_META[l.status]
            const Icon = meta.icon
            const left = daysLeft(l.endsAt)
            const cover = l.trip?.images?.[0]
            // A trip that has been paused or unlisted mid-run keeps its record
            // but stops being served, so the admin should see the mismatch.
            const tripUnbookable =
              l.status === 'active' && l.trip && (l.trip.status !== 'active' || l.trip.visibility !== 'public')
            // Places are allocated in application order and the server enforces
            // it, so only the oldest pending row is actually approvable.
            const isNext = l.status === 'pending' && nextInQueue?.id === l.id

            return (
              <div key={l.id} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start gap-4">
                  {cover ? (
                    <img src={fileUrl(cover)} alt="" className="h-20 w-28 shrink-0 rounded-xl object-cover" />
                  ) : (
                    <div className="flex h-20 w-28 shrink-0 items-center justify-center rounded-xl bg-sand">
                      <Sailboat size={22} className="text-slate-300" />
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-display text-base font-extrabold text-deep-900">
                        {String(localizedField(l.trip, 'title') || l.trip?.title || translatePortalText('Trip no longer available'))}
                      </p>
                      <span className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-bold ${meta.cls}`}>
                        <Icon size={11} /> {translatePortalText(meta.label)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {String(localizedField(l.provider?.business, 'businessName') || localizedField(l.provider, 'name') || l.provider?.business?.businessName || l.provider?.name || translatePortalText('Provider'))}
                      {l.provider?.phone ? ` · ${l.provider.phone}` : ''}
                    </p>
                    <p className="mt-1.5 text-[11px] font-semibold text-slate-400">
                      {translatePortalText('Asked for')} {formatPortalNumber(l.requestedDays)} {l.requestedDays === 1 ? translatePortalText('day') : translatePortalText('days')} · {translatePortalText('applied')} {fmtDay(l.createdAt)}
                      {l.status === 'active' && left != null && ` · ${formatPortalNumber(left)} ${left === 1 ? translatePortalText('day left') : translatePortalText('days left')}`}
                      {l.status === 'expired' && l.endsAt && ` · ${translatePortalText('ended')} ${fmtDay(l.endsAt)}`}
                      {/* The hold is what stops an unpaid approval sitting on a
                          place forever, so the date it ends belongs on the card
                          rather than only in the provider's notification. */}
                      {l.status === 'approved' && l.reservedUntil && ` · ${translatePortalText('place held until')} ${fmtDay(l.reservedUntil)}`}
                    </p>
                    {isNext && (
                      <p className="mt-1.5 inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                        <Clock size={11} /> {translatePortalText('First in line — this is the one you can approve next')}
                      </p>
                    )}
                    {!!l.note && <p className="mt-1.5 text-xs italic text-slate-500">“{l.note}”</p>}
                    {!!l.rejectedReason && (
                      <p className="mt-1.5 text-xs text-rose-600">{translatePortalText('Declined:')} {l.rejectedReason}</p>
                    )}
                    {!!l.adminNotes && <p className="mt-1 text-[11px] text-slate-400">{l.adminNotes}</p>}
                    {tripUnbookable && (
                      <p className="mt-1.5 inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                        <AlertCircle size={11} /> {translatePortalText('Paid for, but the trip is no longer bookable — it is not being shown.')}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {l.price != null && (
                      <div className="text-end">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText('Price')}</p>
                        <p className="font-display text-lg font-extrabold text-deep-900">{money(l.price)}</p>
                      </div>
                    )}
                    <div className="flex flex-wrap justify-end gap-2">
                      {l.status === 'pending' && (
                        <>
                          <button
                            disabled={busyId === l.id || !isNext || (!!home && home.free === 0)}
                            onClick={() => openPrice(l)}
                            title={
                              !isNext
                                ? translatePortalText('Somebody applied earlier — approve or decline them first')
                                : home && home.free === 0
                                  ? translatePortalText('The banner is full')
                                  : undefined
                            }
                            className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {translatePortalText('Approve & price')}
                          </button>
                          <button
                            disabled={busyId === l.id}
                            onClick={() => {
                              setDeclineFor(l)
                              setReasonDraft('')
                            }}
                            className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                          >
                            {translatePortalText('Decline')}
                          </button>
                        </>
                      )}
                      {l.status === 'approved' && (
                        <span className="rounded-xl bg-sky-50 px-3 py-1.5 text-[11px] font-bold text-sky-700">
                          {translatePortalText('Waiting for the provider to pay')}
                        </span>
                      )}
                      {l.status === 'active' && (
                        <button
                          disabled={busyId === l.id}
                          onClick={() => {
                            setStopFor(l)
                            setReasonDraft('')
                          }}
                          className="inline-flex items-center gap-1 rounded-xl border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                        >
                          <StopCircle size={13} /> {translatePortalText('Stop')}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* How big the banner is */}
      <Modal open={poolOpen} onClose={() => setPoolOpen(false)} title={translatePortalText('Banner size')}>
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            {translatePortalText("How many trips the customer app's promotion banner carries at once. Every approval takes one of these places and gives it back when the run ends.")}
          </p>
          <div>
            <label className="label">{translatePortalText('Places on the banner')}</label>
            <input
              type="number"
              min={0}
              className="input w-full"
              placeholder="100"
              value={capacityDraft}
              onChange={(e) => setCapacityDraft(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-slate-400">
              {home
                ? translatePortalText(`${home.used} taken right now${
                    home.waiting > 0 ? `, ${home.waiting} waiting in the queue` : ''
                  }. Lowering this below ${home.used} does not stop anything already paid for — it just means nothing new is approved until enough runs end.`)
                : translatePortalText('Lowering this never cuts short a placement somebody has already paid for.')}
            </p>
          </div>
          <div>
            <label className="label">{translatePortalText('Days an approval holds its place')}</label>
            <input
              type="number"
              min={1}
              max={30}
              className="input w-full"
              value={holdDraft}
              onChange={(e) => setHoldDraft(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-slate-400">
              {translatePortalText('An approved provider has this long to pay. After it, the place goes back to the queue — without it, an approval nobody pays for would hold a place for good.')}
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setPoolOpen(false)}>
              {translatePortalText('Cancel')}
            </button>
            <button
              disabled={savingPool}
              onClick={submitPool}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
            >
              {translatePortalText('Save')}
            </button>
          </div>
        </div>
      </Modal>

      {/* Approve with a price */}
      <Modal open={!!priceFor} onClose={() => setPriceFor(null)} title={`${translatePortalText('Price')} · ${String(localizedField(priceFor?.trip, 'title') || priceFor?.trip?.title || '')}`}>
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            {translatePortalText("\r\n            The provider pays this before the placement runs. Approving does not put the trip in the banner —\r\n            payment does. It does take one of the banner's places straight away\r\n            ")}{home ? ` (${formatPortalNumber(home.free)} ${translatePortalText('free of')} ${formatPortalNumber(home.capacity)})` : ''}{translatePortalText(", held for ")}{home ? formatPortalNumber(home.reservationDays) : '—'} {translatePortalText(" days\r\n            while they pay.\r\n          ")}</p>
          <div>
            <label className="label">{translatePortalText('Price (SAR)')}</label>
            <input
              type="number"
              min={0}
              step={50}
              className="input w-full"
              placeholder="1500"
              value={priceDraft}
              onChange={(e) => setPriceDraft(e.target.value)}
            />
          </div>
          <div>
            <label className="label">{translatePortalText('Days sold')}</label>
            <input
              type="number"
              min={1}
              className="input w-full"
              value={daysDraft}
              onChange={(e) => setDaysDraft(e.target.value)}
            />
          <p className="mt-1 text-[11px] text-slate-400">
              {translatePortalText('They asked for')} {formatPortalNumber(priceFor?.requestedDays)}. {translatePortalText('Change this to sell a shorter or longer run.')}
            </p>
          </div>
          <div>
            <label className="label">{translatePortalText('Note to the provider (optional)')}</label>
            <textarea
              className="input w-full"
              rows={2}
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              placeholder={translatePortalText("Banner slot starts once payment clears.")}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setPriceFor(null)}>
              {translatePortalText('Cancel')}
            </button>
            <button
              disabled={busyId === priceFor?.id || !(Number(priceDraft) > 0)}
              onClick={submitPrice}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
            >
              {translatePortalText('Approve')}
            </button>
          </div>
        </div>
      </Modal>

      {/* Decline */}
      <Modal open={!!declineFor} onClose={() => setDeclineFor(null)} title={translatePortalText('Decline application')}>
        <div className="space-y-4">
          <label className="label">{translatePortalText('Reason (shown to the provider)')}</label>
          <textarea
            className="input w-full"
            rows={3}
            value={reasonDraft}
            onChange={(e) => setReasonDraft(e.target.value)}
            placeholder={translatePortalText("The banner is fully booked this month.")}
          />
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setDeclineFor(null)}>
              {translatePortalText('Cancel')}
            </button>
            <button
              disabled={busyId === declineFor?.id}
              onClick={submitDecline}
              className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-rose-700 disabled:opacity-50"
            >
              {translatePortalText('Decline')}
            </button>
          </div>
        </div>
      </Modal>

      {/* Stop a running placement */}
      <Modal open={!!stopFor} onClose={() => setStopFor(null)} title={translatePortalText('Stop this placement')}>
        <div className="space-y-4">
          <p className="text-xs text-amber-700">
            {translatePortalText('This provider has paid. Stopping ends the run now and keeps the record of what ran — it is not a refund, which you will need to handle separately.')}
          </p>
          <label className="label">{translatePortalText('Reason (shown to the provider)')}</label>
          <textarea
            className="input w-full"
            rows={3}
            value={reasonDraft}
            onChange={(e) => setReasonDraft(e.target.value)}
            placeholder={translatePortalText("The trip description breached the content policy.")}
          />
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setStopFor(null)}>
              {translatePortalText('Cancel')}
            </button>
            <button
              disabled={busyId === stopFor?.id}
              onClick={submitStop}
              className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-rose-700 disabled:opacity-50"
            >
              {translatePortalText('Stop placement')}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
