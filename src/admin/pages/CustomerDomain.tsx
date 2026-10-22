import React, { useEffect, useMemo, useRef, useState } from 'react'
import { TableToolbar, TablePagination, useTableFilters, type TableFiltersConfig } from '../../shared/TableFilters'
import { motion } from 'framer-motion'
import {
  CalendarCheck2, Star, Search, Eye, Check, X
} from 'lucide-react'
import { money } from '../adminData'
import { adminPortalApi, type ApiAdminPayment, type ApiReview } from '../../api'
import { PageWrap, BOOKING_TYPE_META, PAYMENT_STATUS_META as STATUS_META, seededAvatar, personName, earnedCommission, platformCut, paymentProviderLabel, paymentTitle } from './_shared'
import { ReviewStatCards, ReviewsBoard, useReviewModeration, loadAllReviews, ReviewsTruncatedNote } from './AdminEngage'
import { Modal, toast, Counter, downloadCsv } from '../../ui'
import { errorMessage } from '../../async'
import { AdminHeader, ABadge, ViewToggle } from '../adminUi'
import { BASE_CURRENCY } from '../../currency'
import { translatePortalText  , formatPortalDate, formatPortalNumber} from '../../i18n/runtime'

// ══════════ CUSTOMER BOOKINGS ══════════
export function CustomerBookings() {
  const [items, setItems] = useState<ApiAdminPayment[]>([])
  const [totals, setTotals] = useState({ gross: 0, commission: 0, count: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<'All' | ApiAdminPayment['status']>('All')
  const [view, setView] = useState<'card' | 'table'>('table')
  const [sel, setSel] = useState<ApiAdminPayment | null>(null)
  /*
    Server pages. Only the newest 100 payments were ever fetched — search,
    the filters, the pagination below and the CSV export all ran over those
    100, so an older booking could not be found and nothing said the list
    stopped there. `total` is the ledger's count for this status; "Load more"
    fetches the next server page onto the end.
  */
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loadingMore, setLoadingMore] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const statuses: ('All' | ApiAdminPayment['status'])[] = ['All', 'paid', 'pending', 'failed', 'refunded', 'partially_refunded']
  const query = (s: typeof status) => ({ limit: 100, customerRole: 'customer', ...(s === 'All' ? {} : { status: s }) })

  const statusRef = useRef(status)
  statusRef.current = status
  const loadMore = () => {
    if (loadingMore) return
    const want = status
    setLoadingMore(true)
    adminPortalApi.payments({ ...query(want), page: page + 1 })
      .then(res => {
        // The tab may have changed while this was in flight.
        if (want !== statusRef.current) return
        setItems(list => [...list, ...res.data.items.filter(p => !list.some(x => x._id === p._id))])
        setTotal(res.data.pagination?.total ?? total)
        setPage(page + 1)
      })
      .catch(e => toast(`${translatePortalText('Could not load more bookings')}: ${errorMessage(e)}`, 'warn'))
      .finally(() => setLoadingMore(false))
  }

  useEffect(() => {
    /*
      The status tabs refetch, so they race.

      Clicking All → paid → refunded fires three requests, and if `All` is the
      slowest it resolves last: the table then shows every payment while the
      "Refunded" tab is lit, and `totals` — the gross, commission and count
      tiles above it — describe that wrong set too. Someone reading refund
      exposure off this screen would read the whole ledger instead.
    */
    let alive = true
    setLoading(true)
    setError(null)
    // Customers' purchases (`customerRole`) — a boat operator buying berths,
    // fuel or a repair is on that vertical's pages. The tiles are what was
    // collected (`earned`): `totals` follows the status tab, so under "All" it
    // added pending and failed charges into a "gross booking volume".
    adminPortalApi.payments({ ...query(status), page: 1 })
      .then(res => {
        if (!alive) return
        setItems(res.data.items)
        setTotals(res.data.earned ?? res.data.totals)
        setTotal(res.data.pagination?.total ?? res.data.items.length)
        setPage(1)
      })
      .catch(e => { if (alive) setError(`${translatePortalText('Could not load bookings.')} ${errorMessage(e)}`) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [status, reloadKey])

  /**
   * What an operator asks of a payment ledger.
   *
   * The only filters here were a status tab strip and a substring search, so
   * the questions this page most obviously exists to answer — what did we take
   * last week, which vertical, which charges were large — could not be asked at
   * all. On the screen that reads the Payment ledger, that is the gap that
   * matters most.
   *
   * `status` stays outside this config because it is a server-side query
   * parameter and refetches; everything below narrows what came back.
   */
  const filterCfg: TableFiltersConfig<ApiAdminPayment> = useMemo(() => ({
    searchFields: (p) => [
      p.transactionId,
      p.booking?.code,
      p.booking?.title,
      personName(p.customer),
      paymentProviderLabel(p),
      BOOKING_TYPE_META[p.bookingType || '']?.label,
    ],
    filters: [
      {
        key: 'type',
        label: translatePortalText('Vertical'),
        options: Object.entries(BOOKING_TYPE_META).map(([value, meta]) => ({ value, label: meta.label })),
        get: (p) => p.bookingType || '',
      },
      // Dated on `paidAt` where it exists — when the money actually moved,
      // which is the date a finance question is about. `createdAt` covers rows
      // that never completed.
      { key: 'paid', label: translatePortalText('Paid'), kind: 'dateRange', get: (p) => p.paidAt || p.createdAt },
      {
        key: 'size',
        label: translatePortalText('Amount'),
        options: [
          { value: 'over5000', label: translatePortalText('Over 5,000') },
          { value: 'over1000', label: translatePortalText('Over 1,000') },
          { value: 'under500', label: translatePortalText('Under 500') },
        ],
        get: (p) => String(p.amount ?? 0),
        match: (p, v) => {
          const a = p.amount ?? 0
          if (v === 'over5000') return a > 5000
          if (v === 'over1000') return a > 1000
          return a < 500
        },
      },
      {
        key: 'refunded',
        label: translatePortalText('Refunds'),
        options: [
          { value: 'any', label: translatePortalText('Has a refund') },
          { value: 'none', label: translatePortalText('No refund') },
        ],
        get: (p) => ((p.refundAmount ?? 0) > 0 ? 'any' : 'none'),
      },
    ],
    sortOptions: [
      { key: 'paid', label: 'Date', get: (p) => p.paidAt || p.createdAt, defaultDir: 'desc' },
      { key: 'amount', label: 'Amount', get: (p) => p.amount ?? 0, defaultDir: 'desc' },
      { key: 'commission', label: 'Commission', get: (p) => earnedCommission(p), defaultDir: 'desc' },
      { key: 'customer', label: 'Customer', get: (p) => personName(p.customer), defaultDir: 'asc' },
    ],
    defaultSort: 'paid',
    defaultPageSize: 25,
  }), [])
  const tf = useTableFilters(items, filterCfg)
  /** Every row the filters admit — what "export" means. */
  const list = tf.filtered
  /** The page on screen. */
  const paged = tf.paged

  return (
    <PageWrap>
      <AdminHeader
        title={translatePortalText("Customer Bookings")}
        sub={translatePortalText("What customers booked and paid for, across every vertical — sourced live from the Payment ledger")}
        icon={<CalendarCheck2 className="text-emerald-500" />}
        actions={
          <button
            className="btn-admin"
            onClick={() => {
              if (list.length === 0) { toast(translatePortalText('Nothing to export'), 'warn'); return }
              downloadCsv(
                `bookings-${new Date().toISOString().slice(0, 10)}.csv`,
                [
                  ['Booking', 'Booked', 'Customer', 'Type', 'Provider', 'Date', `Amount (${BASE_CURRENCY})`, `Refunded (${BASE_CURRENCY})`, `Commission (${BASE_CURRENCY})`, `Card fee (${BASE_CURRENCY})`, 'Status', 'Gateway reference'],
                  ...list.map(p => [
                    p.booking?.code ?? '',
                    paymentTitle(p),
                    personName(p.customer),
                    BOOKING_TYPE_META[p.bookingType || '']?.label || p.bookingType || '—',
                    paymentProviderLabel(p),
                    (p.paidAt || p.createdAt || '').slice(0, 10),
                    p.amount,
                    p.refundAmount ?? 0,
                    platformCut(p).commission,
                    platformCut(p).cardFee,
                    STATUS_META[p.status]?.label || p.status,
                    p.transactionId,
                  ]),
                ]
              )
              toast(translatePortalText('Bookings exported (CSV)'), 'info')
            }}
          >
            {translatePortalText("Export Bookings")}
          </button>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
        {([
          ['Paid bookings', totals.count, '🗓️', undefined],
          ['Collected (after refunds)', totals.gross, '💰', BASE_CURRENCY],
          ['Platform earnings', totals.commission, '📈', BASE_CURRENCY],
        ] as [string, number, string, string | undefined][]).map(([label, val, icon, cur], i) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="card flex items-center gap-3.5 p-4"
          >
            <span className="text-2xl">{icon}</span>
            <div>
              <p className="font-display text-2xl font-extrabold text-deep-900">
                <Counter value={val} currency={cur} />
              </p>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText(label)}</p>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1.5">
          {statuses.map(s => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
                status === s
                  ? 'bg-gradient-to-r from-emerald-600 to-teal-500 text-white shadow-glow'
                  : 'bg-white text-slate-500 hover:text-deep-900'
              }`}
            >
              {s === 'All' ? translatePortalText('All') : translatePortalText(STATUS_META[s].label)}
            </button>
          ))}
        </div>
        {/* The dropdowns and ordering for everything except status, which is a
            server-side query above. */}
        {/* One search box: the toolbar's. A second input bound to the same
            query sat beside the view toggle. */}
        <div className="flex w-full flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <TableToolbar state={tf} config={filterCfg} rows={items} noun="payments" searchPlaceholder="Search by booking, customer, provider…" />
          </div>
          <ViewToggle view={view} onChange={setView} />
        </div>
      </div>

      {loading ? (
        <div className="card py-14 text-center text-sm text-slate-400">{translatePortalText("Loading bookings…")}</div>
      ) : error ? (
        <div className="card py-14 text-center text-sm text-rose-500">
          {error}{' '}
          <button className="font-bold underline" onClick={() => setReloadKey(k => k + 1)}>{translatePortalText('Retry')}</button>
        </div>
      ) : view === 'table' ? (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto custom-scrollbar">
            <div className="min-w-[980px]">
              <div className="grid grid-cols-[1.5fr_1.6fr_1fr_0.9fr_0.8fr_auto] items-center gap-4 border-b border-slate-100 bg-sand px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <span>{translatePortalText("Transaction & Customer")}</span>
                <span>{translatePortalText("Type & Provider")}</span>
                <span>{translatePortalText("Date")}</span>
                <span>{translatePortalText("Amount")}</span>
                <span>{translatePortalText("Status")}</span>
                <span className="text-right">{translatePortalText("Actions")}</span>
              </div>

              {paged.map((p, i) => {
                const meta = BOOKING_TYPE_META[p.bookingType || ''] || { icon: '💳', label: p.bookingType || 'Payment' }
                const customerName = personName(p.customer)
                const customerAvatar = typeof p.customer === 'object' && p.customer?.avatar ? p.customer.avatar : seededAvatar(p._id)
                return (
                  <motion.div
                    key={p._id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i, 20) * 0.03 }}
                    className="grid grid-cols-[1.5fr_1.6fr_1fr_0.9fr_0.8fr_auto] items-center gap-4 border-b border-slate-50 px-5 py-4 transition hover:bg-sand/70 last:border-b-0"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <img src={customerAvatar} className="h-9 w-9 shrink-0 rounded-full object-cover ring-2 ring-white shadow-soft" />
                      <div className="min-w-0">
                        {/* What was booked, not the gateway's checkout id — that is in the detail view. */}
                        <p className="truncate text-[13px] font-extrabold text-deep-900">{paymentTitle(p)}</p>
                        <p className="truncate text-[11px] text-slate-400">{[p.booking?.code, customerName].filter(Boolean).join(' · ')}</p>
                      </div>
                    </div>

                    <div className="min-w-0 text-xs">
                      <p className="flex items-center gap-1.5 truncate font-semibold text-deep-800">
                        <span>{meta.icon}</span>{translatePortalText(meta.label)}
                      </p>
                      <p className="truncate text-[11px] text-slate-400">{paymentProviderLabel(p)}</p>
                    </div>

                    <div className="text-xs text-slate-500 whitespace-nowrap">
                      {formatPortalDate(new Date(p.paidAt || p.createdAt))}
                    </div>

                    <div className="text-[13px] font-extrabold text-deep-900 whitespace-nowrap">
                      {money(p.amount)}
                      {!!p.refundAmount && <p className="text-[10px] font-semibold text-rose-500">−{money(p.refundAmount)} {translatePortalText('refunded')}</p>}
                      {platformCut(p).cardFee > 0 && (
                        <p className="text-[10px] font-semibold text-slate-400">+{money(platformCut(p).cardFee)} {translatePortalText("card fee")}</p>
                      )}
                      {platformCut(p).commission > 0 && (
                        <p className="text-[10px] font-semibold text-emerald-600">+{money(platformCut(p).commission)} {translatePortalText(" comm.")}</p>
                      )}
                    </div>

                    <div className="whitespace-nowrap">
                      <ABadge dot={STATUS_META[p.status]?.dot}>{translatePortalText(STATUS_META[p.status]?.label || p.status)}</ABadge>
                    </div>

                    <div className="flex justify-end gap-1.5 whitespace-nowrap">
                      <button
                        onClick={() => setSel(p)}
                        className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200"
                        title={translatePortalText("View details")}
                      >
                        <Eye size={13} />
                      </button>
                    </div>
                  </motion.div>
                )
              })}

              {list.length === 0 && (
                <div className="py-14 text-center text-sm text-slate-400">{translatePortalText("No customer bookings match this filter.")}</div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {paged.map((p, i) => {
            const meta = BOOKING_TYPE_META[p.bookingType || ''] || { icon: '💳', label: p.bookingType || 'Payment' }
            const customerName = personName(p.customer)
            const customerAvatar = typeof p.customer === 'object' && p.customer?.avatar ? p.customer.avatar : seededAvatar(p._id)
            return (
              <motion.div
                key={p._id}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, 20) * 0.04 }}
                className="card card-hover p-4"
              >
                <div className="flex items-center gap-3">
                  <img src={customerAvatar} className="h-10 w-10 rounded-full object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-bold text-slate-400">{[p.booking?.code, customerName].filter(Boolean).join(' · ')}</p>
                    <p className="truncate text-[14px] font-extrabold text-deep-900">{paymentTitle(p)}</p>
                  </div>
                  <ABadge dot={STATUS_META[p.status]?.dot}>{translatePortalText(STATUS_META[p.status]?.label || p.status)}</ABadge>
                </div>

                <div className="mt-3 rounded-xl bg-sand p-3">
                  <p className="flex items-center gap-1.5 text-xs font-extrabold text-deep-900">
                    <span>{meta.icon}</span>{translatePortalText(meta.label)}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    {paymentProviderLabel(p)} · {formatPortalDate(new Date(p.paidAt || p.createdAt))}
                  </p>
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase text-slate-400">{translatePortalText("Total Price")}</p>
                    <p className="font-display text-base font-extrabold text-emerald-600">{money(p.amount)}</p>
                  </div>
                  <div className="flex gap-1.5">
                    <button onClick={() => setSel(p)} className="btn-ghost !py-1.5 !px-3 !text-[11px]">
                      <Eye size={12} /> {translatePortalText(" Details\n                    ")}</button>
                  </div>
                </div>
              </motion.div>
            )
          })}
          {list.length === 0 && (
            <div className="col-span-full rounded-2xl border border-dashed border-slate-200 py-14 text-center text-sm text-slate-400">
              {translatePortalText("\n              No customer bookings match this filter.\n            ")}</div>
          )}
        </div>
      )}

      {/* 100 payments in one scroll was the previous behaviour. */}
      {!loading && list.length > 0 && <TablePagination state={tf} noun="payments" />}
      {!loading && !error && items.length < total && (
        <div className="mt-4 flex flex-col items-center gap-2">
          <p className="text-xs font-semibold text-amber-700">
            {translatePortalText('Loaded the newest')} {formatPortalNumber(items.length)} {translatePortalText('of')} {formatPortalNumber(total)} {translatePortalText('payments — search, filters and export cover only these.')}
          </p>
          <button className="btn-ghost" disabled={loadingMore} onClick={loadMore}>
            {loadingMore ? translatePortalText('Loading…') : translatePortalText('Load older payments')}
          </button>
        </div>
      )}

      <Modal open={!!sel} onClose={() => setSel(null)} title={sel ? `📋 ${paymentTitle(sel)}` : ''}>
        {sel && (
          <div className="space-y-4">
            <div className="flex items-center gap-3.5 rounded-2xl bg-sand p-4">
              <img
                src={typeof sel.customer === 'object' && sel.customer?.avatar ? sel.customer.avatar : seededAvatar(sel._id)}
                className="h-12 w-12 rounded-full object-cover"
              />
              <div>
                <p className="font-display text-base font-extrabold text-deep-900">{personName(sel.customer)}</p>
                <p className="text-xs text-slate-400">
                  {translatePortalText("Customer Booking")} · {formatPortalDate(new Date(sel.paidAt || sel.createdAt))}
                </p>
              </div>
              <span className="ms-auto">
                <ABadge dot={STATUS_META[sel.status]?.dot}>{translatePortalText(STATUS_META[sel.status]?.label || sel.status)}</ABadge>
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl border border-slate-100 p-3">
                <p className="text-[10px] font-bold uppercase text-slate-400">{translatePortalText("Reserved Service")}</p>
                <p className="mt-1 font-extrabold text-deep-900">
                  {BOOKING_TYPE_META[sel.bookingType || '']?.icon || '💳'} {BOOKING_TYPE_META[sel.bookingType || '']?.label || sel.bookingType}
                </p>
                <p className="mt-0.5 text-slate-500">{translatePortalText("Provider: ")}{paymentProviderLabel(sel)}</p>
                {sel.booking?.code && <p className="mt-0.5 text-slate-500">{translatePortalText("Booking")}: {sel.booking.code}{sel.booking.boat ? ` · ${sel.booking.boat}` : ''}</p>}
              </div>
              <div className="rounded-xl border border-slate-100 p-3">
                <p className="text-[10px] font-bold uppercase text-slate-400">{translatePortalText("Financial Breakdown")}</p>
                <p className="mt-1 font-extrabold text-emerald-600">{translatePortalText("Total: ")}{money(sel.amount)}</p>
                <p className="mt-0.5 text-slate-500">{translatePortalText("Commission: ")}{money(platformCut(sel).commission)} · {translatePortalText("Card fee:")} {money(platformCut(sel).cardFee)}</p>
                {!!sel.refundAmount && <p className="mt-0.5 text-rose-500">{translatePortalText("Refunded:")} {money(sel.refundAmount)}</p>}
                <p className="mt-0.5 text-slate-500">{translatePortalText("Method: ")}{translatePortalText(sel.method)}</p>
                <p className="mt-0.5 break-all font-mono text-[10px] text-slate-400">{translatePortalText("Gateway reference")}: {sel.transactionId}</p>
              </div>
            </div>

            {sel.notes && (
              <div className="rounded-xl bg-amber-50/80 border border-amber-200 p-3 text-xs">
                <p className="text-[10px] font-bold uppercase tracking-wider text-amber-800 flex items-center gap-1.5">
                  <span>💬</span> {translatePortalText(" Anything we should know? (Customer Note)\n                ")}</p>
                <p className="mt-1 font-semibold text-amber-950 whitespace-pre-wrap">"{sel.notes}"</p>
              </div>
            )}

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
              <button className="btn-admin" onClick={() => setSel(null)}>{translatePortalText("Close")}</button>
            </div>
          </div>
        )}
      </Modal>
    </PageWrap>
  )
}

// ══════════ CUSTOMER REVIEWS ══════════
/**
 * Reviews customers wrote, on the board every other reviews page uses.
 *
 * This page had its own cards, and they read the legacy `reported` flag alone:
 * a review the moderation pipeline had taken down automatically (the ticker
 * says so) still showed "Visible", and there was no way to take one down or put
 * it back. Its own target label knew five types — a trip read "a trip" rather
 * than its title, and a workshop, a staff member or a fuel station review read
 * "a listing". It also listed every review on the platform; a boat operator
 * reviewing a marina or a workshop is on that vertical's reviews page.
 */
export function CustomerReviews() {
  const [reviews, setReviews] = useState<ApiReview[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const moderation = useReviewModeration(setReviews)

  // Every page, not the first 100: the tiles and tab counts were computed off
  // one page, sorted most-reported first, so past 100 they described a sample.
  const load = () => {
    setLoading(true)
    setError(null)
    loadAllReviews({ authorRole: 'customer' })
      .then(res => { setReviews(res.items); setTotal(res.total) })
      .catch(e => setError(`${translatePortalText('Could not load reviews.')} ${errorMessage(e)}`))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  return (
    <PageWrap>
      <AdminHeader
        title={translatePortalText("Customer Reviews")}
        sub={translatePortalText("Reviews written by customers — moderate, reply, take down or restore")}
        icon={<Star className="text-amber-500 fill-amber-500" />}
      />
      {loading ? (
        <div className="card py-14 text-center text-sm text-slate-400">{translatePortalText("Loading reviews…")}</div>
      ) : error ? (
        <div className="card py-14 text-center text-sm text-rose-500">
          {error}{' '}
          <button className="font-bold underline" onClick={load}>{translatePortalText('Retry')}</button>
        </div>
      ) : (<>
        <ReviewStatCards reviews={reviews} />
        <ReviewsTruncatedNote shown={reviews.length} total={total} />
        <ReviewsBoard reviews={reviews} emptyLabel={translatePortalText(reviews.length ? "No customer reviews match this filter." : "Customers have not written any reviews yet.")} {...moderation.boardProps} />
      </>)}
      {moderation.modals}
    </PageWrap>
  )
}
