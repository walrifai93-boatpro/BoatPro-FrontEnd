import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { ShoppingBag, BadgeCheck, Eye, Ban, Mail, Loader2, CheckCircle2 } from 'lucide-react'
import { avatar } from '../adminData'
import { money } from '../../format'
import { PageWrap, BOOKING_TYPE_META, PAYMENT_STATUS_META, paymentTitle } from './_shared'
import { Section, Modal, toast, Counter } from '../../ui'
import { AdminHeader, ABadge, ViewToggle } from '../adminUi'
import { adminPortalApi, fileUrl, type AdminPortalUser, type AdminUserStats, type ApiAdminPayment } from '../../api'
import { confirm, confirmAndRun } from '../../async'
import { errorMessage } from '../../async/errors'
import { BASE_CURRENCY } from '../../currency'
import {
  NoFilterMatches,
  TablePagination,
  TableToolbar,
  useTableFilters,
  type TableFiltersConfig,
} from '../../shared/TableFilters'
import { formatPortalDate, formatPortalNumber, translatePortalText } from '../../i18n/runtime'

/**
 * The demand side — customers and boat owners who book and buy.
 *
 * This page used to describe people it had never actually looked up. Every row
 * was built with `bookings: 0`, `spend: 0`, `devices: 1`, `tags: []` hardcoded
 * on the client, so the four tiles across the top read zero however much the
 * platform had sold, the "VIP" segment could never match anybody, and a
 * "Devices" column reported 1 device for everyone because that was the literal
 * in the mapper. The profile dialog was worse: it showed the same three
 * invented orders — "Island Queen day charter · $1,400" and two more, in
 * dollars — for every customer who was opened.
 *
 * Every figure here now comes from the server. `?withStats=true` returns real
 * booking counts and refund-netted lifetime spend, and opening someone loads
 * their actual charges. The things the platform genuinely does not record —
 * device counts, VIP tiers, last-login times — are gone rather than
 * fabricated, because a column that always says the same thing teaches an
 * operator to distrust the ones that don't.
 *
 * The actions were the other half of the problem: block, suspend, save and
 * "message" each fired a success toast and called nothing, so an operator could
 * block a customer, be told it worked, and watch them keep booking. Block and
 * suspend now go through `updateUser`, which is the endpoint that was already
 * there; the per-customer "message" button is gone because no such endpoint
 * exists, and the bulk announcement uses the real `announce` one.
 */

/*
  Standing is Active or Blocked — the two things that are enforced. Blocking
  (`isActive: false`) stops sign-in and booking at the auth middleware. The
  "Suspend" this page also offered set `onboarding.status`, which is a provider
  field nothing reads for a customer: a "suspended" customer went on booking.
  A "Type" column and filter sat beside it for a `boat_owner` role the platform
  does not have, so every row said "Customer".
*/
type CustomerStatus = 'Active' | 'Blocked'

interface CustomerRow {
  id: string
  name: string
  email: string
  avatar: string
  status: CustomerStatus
  verified: boolean
  joinedAt: string
  country: string
  bookings: number
  spend: number
  lastOrderAt: string | null
}

function toRow(u: AdminPortalUser, stats?: AdminUserStats): CustomerRow {
  const id = u.id || u._id
  return {
    id,
    name: u.name,
    email: u.email,
    // Stored as a server path (/uploads/…): relative to the API host, not the portal.
    avatar: fileUrl(u.avatar) || avatar(1),
    status: u.isActive ? 'Active' : 'Blocked',
    // A customer is verified by proving their phone number; `onboarding` is a
    // provider's approval and is never set for a customer, so the badge never showed.
    verified: !!u.phoneVerifiedAt,
    joinedAt: u.createdAt,
    country: u.business?.country || '—',
    bookings: stats?.bookings ?? 0,
    spend: stats?.spend ?? 0,
    lastOrderAt: stats?.lastOrderAt ?? null,
  }
}

const fmtDay = (iso?: string | null) =>
  iso ? formatPortalDate(iso) : '—'

// ══════════ CUSTOMERS (§2) ══════════
export function AdminCustomers() {
  const [view, setView] = useState<'card' | 'table'>('table')
  const [sel, setSel] = useState<CustomerRow | null>(null)
  const [rows, setRows] = useState<CustomerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [composeOpen, setComposeOpen] = useState(false)
  /** Every customer account on the platform — `rows` holds at most the newest 500. */
  const [total, setTotal] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Customers, asked for by role. This took the newest accounts of every
      // role and filtered here — so providers and staff used up the page and
      // customers beyond it were never listed. `withStats` is what makes the
      // spend and booking figures real.
      const res = await adminPortalApi.users({ role: 'customer', limit: 500, withStats: true })
      const stats = res.data.stats || {}
      setRows(res.data.items.map(u => toRow(u, stats[u.id || u._id])))
      setTotal(res.data.pagination?.total ?? res.data.items.length)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * The filters an operator actually arrives with.
   *
   * Previously this page offered a name/email substring and four segment pills,
   * one of which ("VIP") matched nothing by construction because the tag array
   * it tested was hardcoded empty. There was no way to separate customers from
   * boat owners, no way to bound by when someone joined or last ordered, and no
   * ordering at all — so the highest-spending customer was findable only by
   * scrolling and reading.
   */
  const filterCfg: TableFiltersConfig<CustomerRow> = useMemo(
    () => ({
      searchFields: (u) => [u.name, u.email, u.id, u.country],
      filters: [
        { key: 'status', label: translatePortalText('Standing'), get: (u) => translatePortalText(u.status) },
        { key: 'verified', label: translatePortalText('Phone'), get: (u) => translatePortalText(u.verified ? 'Verified' : 'Not verified') },
        {
          key: 'spend',
          label: translatePortalText('Has spent'),
          options: [
            { value: 'any', label: translatePortalText('Has ordered') },
            { value: 'none', label: translatePortalText('Never ordered') },
            { value: 'over1000', label: translatePortalText('Over 1,000') },
            { value: 'over5000', label: translatePortalText('Over 5,000') },
          ],
          get: (u) => String(u.spend),
          match: (u, v) => {
            if (v === 'none') return u.spend <= 0
            if (v === 'over1000') return u.spend > 1000
            if (v === 'over5000') return u.spend > 5000
            return u.spend > 0
          },
        },
        { key: 'joined', label: translatePortalText('Joined'), kind: 'dateRange', get: (u) => u.joinedAt },
        { key: 'lastOrder', label: translatePortalText('Last order'), kind: 'dateRange', get: (u) => u.lastOrderAt },
      ],
      sortOptions: [
        { key: 'joined', label: translatePortalText('Joined'), get: (u) => u.joinedAt, defaultDir: 'desc' },
        { key: 'spend', label: translatePortalText('Lifetime spend'), get: (u) => u.spend, defaultDir: 'desc' },
        { key: 'bookings', label: translatePortalText('Bookings'), get: (u) => u.bookings, defaultDir: 'desc' },
        { key: 'last', label: translatePortalText('Last order'), get: (u) => u.lastOrderAt, defaultDir: 'desc' },
        { key: 'name', label: translatePortalText('Name'), get: (u) => u.name, defaultDir: 'asc' },
      ],
      defaultSort: 'joined',
      defaultPageSize: 25,
    }),
    []
  )
  const tf = useTableFilters(rows, filterCfg)
  const list = tf.paged

  // Totals describe the whole customer base, not the current filter — a tile
  // that moved with the filters would answer a different question each time.
  const totalSpend = useMemo(() => rows.reduce((s, u) => s + u.spend, 0), [rows])
  const totalBookings = useMemo(() => rows.reduce((s, u) => s + u.bookings, 0), [rows])
  // Same basis as the other two tiles: earned payments (see `listUsers`).
  const payingCount = useMemo(() => rows.filter(u => u.bookings > 0).length, [rows])

  /** Block or unblock — the real `isActive` flag, confirmed before it fires. */
  const toggleBlocked = async (u: CustomerRow) => {
    const blocking = u.status !== 'Blocked'
    setBusyId(u.id)
    try {
      await confirmAndRun({
        title: blocking ? `Block ${u.name}?` : `Unblock ${u.name}?`,
        body: blocking
          ? 'They will not be able to sign in or book until you unblock them.'
          : 'They will be able to sign in and book again.',
        confirmLabel: blocking ? 'Block' : 'Unblock',
        busyLabel: blocking ? 'Blocking…' : 'Unblocking…',
        danger: blocking,
        success: blocking ? `${u.name} blocked` : `${u.name} unblocked`,
        run: async () => {
          await adminPortalApi.updateUser(u.id, { isActive: !blocking })
          await load()
        },
      })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <PageWrap>
      <AdminHeader
        title={translatePortalText('Customers')}
        sub={translatePortalText('Customers who book boats and buy services — spend, standing & support')}
        icon={<ShoppingBag className="text-emerald-500" />}
        actions={
          <>
            <ViewToggle view={view} onChange={setView} />
            <button className="btn-admin" onClick={() => setComposeOpen(true)}>
              <Mail size={15} /> {translatePortalText('Message customers')}
            </button>
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
        {(
          [
            // The server's count — `rows.length` stopped at 500.
            [translatePortalText('Total customers'), Math.max(total, rows.length), undefined],
            [translatePortalText('Lifetime spend'), totalSpend, BASE_CURRENCY],
            [translatePortalText('Total bookings'), totalBookings, undefined],
            [translatePortalText('Have ordered'), payingCount, undefined],
          ] as [string, number, string | undefined][]
        ).map(([l, v, cur], i) => (
          <motion.div
            key={l}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="card p-4"
          >
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{l}</p>
            <p className="mt-1 font-display text-2xl font-extrabold text-deep-900">
              <Counter value={v} currency={cur} />
            </p>
          </motion.div>
        ))}
      </div>

      {/* Spend, bookings and "have ordered" are summed over the rows loaded;
          past 500 customers that is not everyone, and the tiles said so nowhere. */}
      {total > rows.length && (
        <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
          {translatePortalText('Showing the newest')} {formatPortalNumber(rows.length)} {translatePortalText('of')} {formatPortalNumber(total)} {translatePortalText('customers — spend, bookings, search and filters cover only these.')}
        </p>
      )}

      <TableToolbar
        state={tf}
        config={filterCfg}
        rows={rows}
        noun={translatePortalText('customers')}
        searchPlaceholder={translatePortalText('Search name, email or id…')}
      />

      {error && (
        <div className="card mb-4 !border-rose-200 !bg-rose-50 text-sm text-rose-600">
          {translatePortalText("\r\n          Couldn't load customers: ")}{error}{' '}
          <button className="font-bold underline" onClick={() => void load()}>
            {translatePortalText("\r\n            Retry\r\n          ")}</button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-100 bg-white p-10 text-sm text-slate-400">
          <Loader2 size={16} className="animate-spin" /> {translatePortalText('Loading customers…')}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-center text-sm text-slate-400">
          {translatePortalText('No customers have signed up yet.')}
        </div>
      ) : tf.filtered.length === 0 ? (
        <NoFilterMatches noun={translatePortalText('customers')} onClear={tf.clear} />
      ) : view === 'table' ? (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto custom-scrollbar">
            <div className="min-w-[960px]">
              <div className="grid grid-cols-[2.2fr_0.8fr_1fr_1fr_0.9fr_auto] items-center gap-4 border-b border-slate-100 bg-sand px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <span>{translatePortalText('Customer')}</span>
                <span>{translatePortalText('Bookings')}</span>
                <span>{translatePortalText('Lifetime spend')}</span>
                <span>{translatePortalText('Last order')}</span>
                <span>{translatePortalText('Status')}</span>
                <span className="text-right">{translatePortalText('Actions')}</span>
              </div>
              {list.map((u, i) => (
                <motion.div
                  key={u.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i, 12) * 0.03 }}
                  className="grid grid-cols-[2.2fr_0.8fr_1fr_1fr_0.9fr_auto] items-center gap-4 border-b border-slate-50 px-5 py-4 transition last:border-b-0 hover:bg-sand/70"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <img
                      src={u.avatar}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded-full object-cover shadow-soft ring-2 ring-white"
                    />
                    <div className="min-w-0">
                      <p className="flex items-center gap-1 truncate text-[13px] font-extrabold text-deep-900">
                        {u.name}
                        {u.verified && <BadgeCheck size={12} className="shrink-0 text-emerald-500" />}
                      </p>
                      <p className="truncate text-[11px] text-slate-400">
                        {u.email}
                        {u.country !== '—' ? ` · ${u.country}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="whitespace-nowrap text-xs text-slate-500">{u.bookings ? formatPortalNumber(u.bookings) : '—'}</div>
                  <div className="whitespace-nowrap text-[13px] font-extrabold text-emerald-600">
                    {u.spend ? money(u.spend) : '—'}
                  </div>
                  <div className="whitespace-nowrap text-xs text-slate-500">{fmtDay(u.lastOrderAt)}</div>
                  <div className="whitespace-nowrap">
                    <ABadge dot={u.status === 'Active'}>{translatePortalText(u.status)}</ABadge>
                  </div>
                  <div className="flex justify-end gap-1.5 whitespace-nowrap">
                    <button
                      onClick={() => setSel(u)}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200"
                      title={translatePortalText('Profile')}
                    >
                      <Eye size={13} />
                    </button>
                    <button
                      onClick={() => void toggleBlocked(u)}
                      disabled={busyId === u.id}
                      className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg disabled:opacity-50 ${
                        u.status === 'Blocked'
                          ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                          : 'bg-rose-50 text-rose-500 hover:bg-rose-100'
                      }`}
                      title={u.status === 'Blocked' ? translatePortalText('Unblock') : translatePortalText('Block')}
                    >
                      {busyId === u.id ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : u.status === 'Blocked' ? (
                        <CheckCircle2 size={13} />
                      ) : (
                        <Ban size={13} />
                      )}
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((u, i) => (
            <motion.div
              key={u.id}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 12) * 0.04 }}
              className={`card card-hover p-4 ${u.status !== 'Active' ? 'ring-1 ring-rose-200' : ''}`}
            >
              <div className="flex items-center gap-3">
                <img src={u.avatar} alt="" className="h-12 w-12 rounded-2xl object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 truncate text-[14px] font-extrabold text-deep-900">
                    {u.name}
                    {u.verified && <BadgeCheck size={13} className="shrink-0 text-emerald-500" />}
                  </p>
                  <p className="truncate text-[11px] text-slate-400">
                    {u.email}
                    {u.country !== '—' ? ` · ${u.country}` : ''}
                  </p>
                </div>
                <ABadge dot={u.status === 'Active'}>{translatePortalText(u.status)}</ABadge>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-sand py-2">
                  <p className="font-display text-sm font-extrabold text-deep-900">{u.bookings ? formatPortalNumber(u.bookings) : '—'}</p>
                  <p className="text-[9px] font-bold uppercase text-slate-400">{translatePortalText('Bookings')}</p>
                </div>
                <div className="rounded-xl bg-sand py-2">
                  <p className="font-display text-sm font-extrabold text-emerald-600">
                    {u.spend ? money(u.spend) : '—'}
                  </p>
                  <p className="text-[9px] font-bold uppercase text-slate-400">{translatePortalText('Spend')}</p>
                </div>
                <div className="rounded-xl bg-sand py-2">
                  <p className="font-display text-[11px] font-extrabold text-deep-900">{fmtDay(u.lastOrderAt)}</p>
                  <p className="text-[9px] font-bold uppercase text-slate-400">{translatePortalText('Last order')}</p>
                </div>
              </div>
              <div className="mt-3 flex gap-1.5 border-t border-slate-100 pt-3">
                <button onClick={() => setSel(u)} className="btn-ghost flex-1 !justify-center !py-1.5 !text-[11px]">
                  <Eye size={12} /> {translatePortalText('Profile')}
                </button>
                <button
                  onClick={() => void toggleBlocked(u)}
                  disabled={busyId === u.id}
                  className={`grid h-8 w-8 place-items-center rounded-lg disabled:opacity-50 ${
                    u.status === 'Blocked'
                      ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                      : 'bg-rose-50 text-rose-500 hover:bg-rose-100'
                  }`}
                  title={u.status === 'Blocked' ? translatePortalText('Unblock') : translatePortalText('Block')}
                >
                  {busyId === u.id ? <Loader2 size={13} className="animate-spin" /> : u.status === 'Blocked' ? <CheckCircle2 size={13} /> : <Ban size={13} />}
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* 500 customers in one scroll was the previous behaviour. */}
      {!loading && tf.filtered.length > 0 && <TablePagination state={tf} noun={translatePortalText('customers')} />}

      <CustomerProfile
        row={sel}
        onClose={() => setSel(null)}
        onToggleBlocked={async (u) => { await toggleBlocked(u); setSel(null) }}
        busy={!!sel && busyId === sel.id}
      />

      <AnnounceModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
      />
    </PageWrap>
  )
}

/**
 * A real announcement to customers.
 */
function AnnounceModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [titleAr, setTitleAr] = useState('')
  const [bodyAr, setBodyAr] = useState('')
  const [sending, setSending] = useState(false)
  /*
    Who it actually reaches, counted the way `announce` picks them: customer
    accounts that are active. The count it showed was every loaded row —
    blocked customers included, and capped at the 500 the list holds.
  */
  const [audienceCount, setAudienceCount] = useState<number | null>(null)

  useEffect(() => {
    if (open) {
      setTitle('')
      setBody('')
      setTitleAr('')
      setBodyAr('')
      let alive = true
      setAudienceCount(null)
      adminPortalApi
        .users({ role: 'customer', active: true, limit: 1 })
        .then(res => { if (alive) setAudienceCount(res.data.pagination?.total ?? null) })
        .catch(() => { if (alive) setAudienceCount(null) })
      return () => { alive = false }
    }
  }, [open])

  const send = async () => {
    if (sending || !title.trim() || !body.trim() || !titleAr.trim() || !bodyAr.trim()) return
    // Every customer, at once, unrecallable — asked once more before it goes.
    const ok = await confirm({
      title: translatePortalText('Send to all customers?'),
      body: `${translatePortalText('This goes out now to')} ${audienceCount != null ? formatPortalNumber(audienceCount) : translatePortalText('every')} ${translatePortalText('active customer accounts and cannot be recalled.')}`,
      confirmLabel: translatePortalText('Send'),
    })
    if (!ok) return
    setSending(true)
    try {
      const res = await adminPortalApi.announce({
        title: title.trim(),
        body: body.trim(),
        titleAr: titleAr.trim(),
        bodyAr: bodyAr.trim(),
        role: 'customer',
      })
      const n = res.data.recipients
      toast(translatePortalText(`Sent to ${formatPortalNumber(n)} customer${n === 1 ? '' : 's'}`))
      onClose()
    } catch (e) {
      toast(translatePortalText(errorMessage(e)), 'warn')
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`✉️ ${translatePortalText('Message customers')}`}>
      <div className="space-y-3">
        <p className="text-xs text-slate-400">
          {translatePortalText("\r\n          Goes to all ")}{audienceCount != null ? formatPortalNumber(audienceCount) : '…'} {translatePortalText(" active customer account")}{audienceCount === 1 ? '' : 's'} {translatePortalText(" as an in-app\r\n          notification. Providers are not included.\r\n        ")}</p>
        <div>
          <label className="label">{translatePortalText('Headline')}</label>
          <input
            className="input"
            value={title}
            onChange={e => setTitle(e.target.value)}
            maxLength={150}
            placeholder={translatePortalText('Headline')}
          />
        </div>
        <div>
          <label className="label">{translatePortalText('Headline (Arabic)')}</label>
          <input
            className="input"
            dir="rtl"
            value={titleAr}
            onChange={e => setTitleAr(e.target.value)}
            maxLength={300}
            placeholder={translatePortalText('Headline (Arabic)')}
          />
        </div>
        <div>
          <label className="label">{translatePortalText('Message')}</label>
          <textarea
            className="input min-h-[100px]"
            value={body}
            onChange={e => setBody(e.target.value)}
            maxLength={500}
            placeholder={translatePortalText('Write your announcement…')}
          />
        </div>
        <div>
          <label className="label">{translatePortalText('Message (Arabic)')}</label>
          <textarea
            className="input min-h-[100px]"
            dir="rtl"
            value={bodyAr}
            onChange={e => setBodyAr(e.target.value)}
            maxLength={1200}
            placeholder={translatePortalText('Write the Arabic announcement…')}
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <button className="btn-ghost" onClick={onClose} disabled={sending}>
            {translatePortalText('Cancel')}
          </button>
          <button className="btn-admin" onClick={() => void send()} disabled={sending || !title.trim() || !body.trim() || !titleAr.trim() || !bodyAr.trim()}>
            {sending && <Loader2 size={14} className="animate-spin" />} {translatePortalText('Send')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * One customer's real record.
 */
function CustomerProfile({
  row,
  onClose,
  onToggleBlocked,
  busy,
}: {
  row: CustomerRow | null
  onClose: () => void
  onToggleBlocked: (u: CustomerRow) => Promise<void>
  busy: boolean
}) {
  const [orders, setOrders] = useState<ApiAdminPayment[] | null>(null)
  const [ordersError, setOrdersError] = useState<string | null>(null)

  useEffect(() => {
    if (!row) {
      setOrders(null)
      setOrdersError(null)
      return
    }
    let alive = true
    setOrders(null)
    setOrdersError(null)
    adminPortalApi
      .payments({ customer: row.id, limit: 8 })
      .then(res => {
        if (alive) setOrders(res.data.items || [])
      })
      .catch(e => {
        if (alive) setOrdersError(errorMessage(e))
      })
    return () => {
      alive = false
    }
  }, [row])

  return (
    <Modal open={!!row} onClose={onClose} title={row ? `🛍️ ${row.name}` : ''} wide>
      {row && (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <img src={row.avatar} alt="" className="h-16 w-16 rounded-2xl object-cover" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 font-display text-lg font-extrabold text-deep-900">
                {row.name}
                {row.verified && <BadgeCheck size={16} className="text-emerald-500" />}
              </p>
              <p className="truncate text-xs text-slate-400">
                {row.email} {translatePortalText(" · joined ")}{fmtDay(row.joinedAt)}
              </p>
            </div>
            <ABadge dot={row.status === 'Active'}>{translatePortalText(row.status)}</ABadge>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                [translatePortalText('Bookings'), row.bookings ? formatPortalNumber(row.bookings) : '—'],
                [translatePortalText('Lifetime spend'), row.spend ? money(row.spend) : '—'],
                [translatePortalText('Last order'), fmtDay(row.lastOrderAt)],
                [translatePortalText('Phone'), translatePortalText(row.verified ? 'Verified' : 'Not verified')],
              ] as [string, string][]
            ).map(([l, v]) => (
              <div key={l} className="rounded-xl bg-sand p-3 text-center">
                <p className="text-[10px] font-bold uppercase text-slate-400">{l}</p>
                <p className="font-display text-base font-extrabold text-deep-900">{v}</p>
              </div>
            ))}
          </div>

          <Section title={translatePortalText('Recent orders')} sub={translatePortalText('Their most recent charges')}>
            {ordersError ? (
              <p className="text-xs text-rose-500">{translatePortalText("Couldn't load orders: ")}{ordersError}</p>
            ) : orders === null ? (
              <p className="flex items-center gap-2 text-xs text-slate-400">
                <Loader2 size={13} className="animate-spin" /> {translatePortalText('Loading orders…')}
              </p>
            ) : orders.length === 0 ? (
              <p className="text-xs text-slate-400">{translatePortalText('This customer has never been charged.')}</p>
            ) : (
              <div className="space-y-1.5 text-xs">
                {orders.map(p => (
                  <div key={p._id} className="flex items-center justify-between gap-3 rounded-lg bg-sand px-3 py-2">
                    {/* What was booked and when — it printed the raw
                        `bookingType` key ("trip", "berth"). */}
                    <span className="min-w-0 truncate font-semibold text-deep-800">
                      {BOOKING_TYPE_META[p.bookingType || '']?.icon} {paymentTitle(p)} · {fmtDay(p.paidAt || p.createdAt)}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {p.status !== 'paid' && (
                        <span className="text-[10px] font-bold uppercase text-slate-400">{translatePortalText(PAYMENT_STATUS_META[p.status]?.label || p.status)}</span>
                      )}
                      <b className="font-bold text-emerald-600">{money(p.amount)}</b>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
            {row.status === 'Blocked' ? (
              <button className="btn-admin" disabled={busy} onClick={() => void onToggleBlocked(row)}>
                {busy && <Loader2 size={14} className="animate-spin" />} {translatePortalText('Unblock')}
              </button>
            ) : (
              <button className="btn-ghost !text-rose-600" disabled={busy} onClick={() => void onToggleBlocked(row)}>
                {busy && <Loader2 size={14} className="animate-spin" />} {translatePortalText('Block')}
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
