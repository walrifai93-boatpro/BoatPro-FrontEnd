import React, { useEffect, useMemo, useState } from 'react'
import { TableToolbar, useTableFilters, NoFilterMatches, TablePagination, type TableFiltersConfig } from '../../shared/TableFilters'
import { motion } from 'framer-motion'
import { RefreshCw, ShieldAlert, Ban, Play, Pause, FileText, Check } from 'lucide-react'
import { confirmAndRun } from '../../async'
import { Modal, toast, Spinner, Avatar } from '../../ui'
import {
  commissionApi,
  providerControlApi,
  type ObligationSummary,
  type ProviderBalanceRow,
} from '../../api'
import { translatePortalText, formatPortalNumber, formatPortalDate, localizedField } from '../../i18n/runtime'

/**
 * Cash collections and provider enforcement, on one screen.
 *
 * Together because they are one conversation. A provider carrying an unpaid
 * commission balance is the commonest reason to restrict somebody, and the
 * decision needs both halves visible at once: what they owe, and what
 * restricting them would do to the customers they have already sold to.
 *
 * The actions are deliberately several rather than one switch:
 *
 *   Pause      — new business off, existing bookings honoured. The default.
 *   Suspend    — as above, plus a review. Existing work still continues.
 *   Emergency  — stops work in progress. Strands live customers, so it demands
 *                an explicit acknowledgement.
 *
 * A single deactivate button would force the same answer to a billing problem
 * and a safety one, and it would be wrong for at least one of them.
 */

const STATE_META: Record<string, { label: string; cls: string }> = {
  active: { label: 'Active', cls: 'bg-emerald-50 text-emerald-600 ring-emerald-200' },
  paused: { label: 'Paused', cls: 'bg-amber-50 text-amber-600 ring-amber-200' },
  suspended: { label: 'Suspended', cls: 'bg-orange-50 text-orange-600 ring-orange-200' },
  emergency_suspended: { label: 'Emergency', cls: 'bg-rose-50 text-rose-600 ring-rose-200' },
  deactivation_pending: { label: 'Closing', cls: 'bg-slate-100 text-slate-500 ring-slate-200' },
  deactivated: { label: 'Closed', cls: 'bg-slate-100 text-slate-400 ring-slate-200' },
}

const nameOf = (p: ProviderBalanceRow) => p.business?.businessName || p.name

/** The Cash Collections tab of Payments & Payouts. */
export function CollectionsPanel() {
  const [rows, setRows] = useState<ProviderBalanceRow[]>([])
  const [stats, setStats] = useState<{ totalOutstanding: number; currency: string; providersOwing: number; overdueStatements: number } | null>(null)
  const [loading, setLoading] = useState(true)
  /**
   * Why the queue did not load. A failure used to leave the list empty under
   * "Nobody owes commission. Every cash booking is settled." — an outage that
   * read as a clean book.
   */
  const [loadError, setLoadError] = useState('')
  /** Providers owing in total — the API pages at 100, and this screen asks for one page. */
  const [total, setTotal] = useState(0)
  const [onlyBlocked, setOnlyBlocked] = useState(false)
  const [active, setActive] = useState<string | null>(null)
  /** The statement run and the overdue sweep, one at a time. */
  const [runBusy, setRunBusy] = useState<'statements' | 'sweep' | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await commissionApi.providers({ limit: 100, cashBlocked: onlyBlocked || undefined })
      setRows(res.data.items)
      setStats(res.data.stats)
      setTotal(res.data.pagination?.total ?? res.data.items.length)
      setLoadError('')
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load collections')
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not load collections'), 'warn')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [onlyBlocked])

  /*
    Both runs bill or flag every provider at once, so they are confirmed first
    and locked while running — a second click used to start a second run.
  */
  const runStatements = () =>
    confirmAndRun({
      title: 'Close last month?',
      body: 'This issues last month’s commission statement to every provider with unbilled cash commission from that month, and notifies each of them by push and email.',
      confirmLabel: 'Issue statements',
      busyLabel: 'Issuing…',
      run: async () => {
        setRunBusy('statements')
        try {
          const res = await commissionApi.runStatements({})
          return res.data
        } finally { setRunBusy(null); void load() }
      },
      success: (d) => `${d.period}: ${d.issued} statement(s) issued to ${d.providers} provider(s)`,
    })

  const sweep = () =>
    confirmAndRun({
      title: 'Flag overdue statements?',
      body: 'Every unpaid statement past its due date is marked overdue. Each of those providers has cash bookings blocked and is notified.',
      confirmLabel: 'Flag overdue',
      busyLabel: 'Flagging…',
      run: async () => {
        setRunBusy('sweep')
        try {
          const res = await commissionApi.sweepOverdue()
          return res.data
        } finally { setRunBusy(null); void load() }
      },
      success: (d) => `${d.flagged} statement(s) marked overdue`,
    })

  const currency = stats?.currency || 'SAR'

  /**
   * Collections is a chase list, so the filters are the ones a collector asks:
   * who is blocked, who is over their limit, how much is at stake.
   */
  const filterCfg: TableFiltersConfig<ProviderBalanceRow> = useMemo(() => ({
    searchFields: (p) => [p.name, p.business?.businessName, p.email],
    filters: [
      { key: 'type', label: 'Provider type', get: (p) => p.onboarding?.providerType?.replace(/_/g, ' ') },
      { key: 'state', label: 'Enforcement', get: (p) => p.enforcement?.state ?? 'active' },
      {
        key: 'cash',
        label: 'Cash standing',
        options: [
          { value: 'blocked', label: 'Cash blocked' },
          { value: 'allowed', label: 'Cash allowed' },
        ],
        get: (p) => (p.enforcement?.cashBlocked ? 'blocked' : 'allowed'),
      },
      {
        key: 'size',
        label: 'Amount owed',
        options: [
          { value: 'over1000', label: 'Over 1,000' },
          { value: 'over100', label: 'Over 100' },
          { value: 'any', label: 'Any amount owed' },
        ],
        get: (p) => String(p.onboarding?.commissionDue ?? 0),
        match: (p, v) => {
          const due = p.onboarding?.commissionDue ?? 0
          if (v === 'over1000') return due > 1000
          if (v === 'over100') return due > 100
          return due > 0
        },
      },
    ],
    sortOptions: [
      // Largest debt first — this is a chase list, and the order is the priority.
      { key: 'owed', label: 'Amount owed', get: (p) => p.onboarding?.commissionDue ?? 0, defaultDir: 'desc' },
      { key: 'name', label: 'Provider', get: (p) => p.business?.businessName || p.name, defaultDir: 'asc' },
    ],
    defaultSort: 'owed',
  }), [])
  const tf = useTableFilters(rows, filterCfg)
  const visible = tf.pagedRows

  return (
    <>
      <div className="mb-4">
        <h3 className="font-display text-lg font-extrabold text-deep-900">{translatePortalText('Cash Collections')}</h3>
        <p className="text-xs text-slate-400">{translatePortalText('Commission owed on cash bookings, and the restrictions that follow from it')}</p>
      </div>

      {stats && (
        <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
          {([
            [translatePortalText('Outstanding'), `${formatPortalNumber(stats.totalOutstanding)} ${stats.currency}`],
            [translatePortalText('Providers owing'), stats.providersOwing],
            [translatePortalText('Overdue statements'), stats.overdueStatements],
            // Counted over the providers this screen loaded — those who owe —
            // so it says so; a restricted provider with nothing owed is not here.
            [translatePortalText('Cash restricted (owing)'), rows.filter(r => r.enforcement?.cashBlocked).length],
          ] as const).map(([label, value], i) => (
            <motion.div key={label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }} className="card p-4">
              <p className="font-display text-2xl font-extrabold text-deep-900">{value}</p>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
            </motion.div>
          ))}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button onClick={() => setOnlyBlocked(v => !v)}
          className={`rounded-full px-3 py-1.5 text-[11px] font-bold ring-1 transition ${
            onlyBlocked ? 'bg-deep-900 text-white ring-deep-900' : 'bg-white text-slate-500 ring-slate-200'
          }`}>
          {translatePortalText('Cash restricted only')}
        </button>
        <div className="ms-auto flex gap-2">
          <button disabled={!!runBusy} onClick={() => void sweep()} className="btn-ghost !py-1.5 !px-3 !text-[11px] disabled:opacity-40">
            <ShieldAlert size={12} /> {translatePortalText('Flag overdue')}
          </button>
          <button disabled={!!runBusy} onClick={() => void runStatements()} className="btn-ghost !py-1.5 !px-3 !text-[11px] disabled:opacity-40">
            <FileText size={12} /> {translatePortalText('Close last month')}
          </button>
          <button onClick={() => void load()} className="btn-ghost !py-1.5 !px-3 !text-[11px]">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> {translatePortalText('Refresh')}
          </button>
        </div>
      </div>

      {loadError && (
        <div className="card mb-4 flex flex-wrap items-center justify-between gap-3 !border-rose-200 !bg-rose-50 text-sm text-rose-600">
          <span>{translatePortalText("Couldn't load collections: ")}{loadError}</span>
          <button className="btn-ghost !py-1.5 !px-3 !text-[11px]" onClick={() => void load()}><RefreshCw size={12} /> {translatePortalText('Retry')}</button>
        </div>
      )}
      {!loading && !loadError && rows.length < total && (
        <p className="mb-3 text-[11px] text-slate-400">
          {translatePortalText('Showing the')} {formatPortalNumber(rows.length)} {translatePortalText('largest balances of')} {formatPortalNumber(total)} {translatePortalText('providers owing — the totals above cover all of them.')}
        </p>
      )}

      <TableToolbar
        state={tf}
        config={filterCfg}
        rows={rows}
        noun={translatePortalText('providers')}
        searchPlaceholder={translatePortalText('Search by provider, business or email...')}
      />

      {loading && rows.length === 0 && <div className="flex justify-center py-16"><Spinner /></div>}
      {!loading && !loadError && rows.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-200 py-14 text-center text-sm text-slate-400">
          {onlyBlocked
            ? translatePortalText('No provider who owes commission is cash-restricted.')
            : translatePortalText('Nobody owes commission. Every cash booking is settled.')}
        </div>
      )}
      {!loading && rows.length > 0 && visible.length === 0 && (
        <NoFilterMatches noun="providers" onClear={tf.clear} />
      )}

      <div className="space-y-3">
        {visible.map((p, i) => {
          const due = p.onboarding?.commissionDue ?? 0
          const limit = p.onboarding?.cashCreditLimit
          const state = p.enforcement?.state ?? 'active'
          const meta = STATE_META[state] ?? STATE_META.active
          return (
            <motion.div key={p._id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.03, 0.3) }}
              className={`card flex flex-wrap items-center gap-4 p-4 ${p.enforcement?.cashBlocked ? 'ring-1 ring-rose-200' : ''}`}>
              <Avatar name={nameOf(p)} size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-extrabold text-deep-900">{nameOf(p)}</p>
                <p className="truncate text-xs text-slate-400">
                  {p.onboarding?.providerType?.replace('_', ' ')} {translatePortalText(" · cash sales")}{' '}
                  {formatPortalNumber((p.onboarding?.cashSalesTotal ?? 0))} {currency}
                  {' · '}{limit != null ? translatePortalText(`limit ${formatPortalNumber(limit)}`) : translatePortalText('default limit')}
                </p>
              </div>

              <div className="text-end">
                <p className="font-display text-lg font-extrabold text-deep-900">{formatPortalNumber(due, { maximumFractionDigits: 2 })}</p>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{currency} {translatePortalText('owed')}</p>
              </div>

              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${meta.cls}`}>
                {translatePortalText(meta.label)}
              </span>
              {p.enforcement?.cashBlocked && (
                <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-600 ring-1 ring-rose-200">
                  {translatePortalText('Cash blocked')}
                </span>
              )}
              {!!p.enforcement?.riskScore && p.enforcement.riskScore > 0 && (
                <span className="text-[10px] font-bold text-slate-400" title={(p.enforcement.riskSignals ?? []).join(', ')}>
                  {translatePortalText('risk')} {formatPortalNumber(p.enforcement.riskScore)}
                </span>
              )}

              <button onClick={() => setActive(p._id)} className="btn-admin !py-1.5 !px-2.5 !text-[11px]">
                {translatePortalText('Manage')}
              </button>
            </motion.div>
          )
        })}
      </div>
      <TablePagination state={tf} noun={translatePortalText('providers')} />

      <ProviderDrawer
        providerId={active}
        // The account's own limit, unresolved: `null` when it follows the
        // platform default. The drawer's balance only has the resolved figure.
        ownLimit={rows.find(r => r._id === active)?.onboarding?.cashCreditLimit ?? null}
        currency={currency}
        onClose={() => { setActive(null); void load() }}
      />
    </>
  )
}

/**
 * One provider: the ledger, the limit, and the enforcement ladder.
 *
 * The obligation count is shown next to the destructive actions on purpose — it
 * is the number that should change somebody's mind about an emergency
 * suspension.
 */
function ProviderDrawer({ providerId, ownLimit, currency, onClose }: {
  providerId: string | null
  /** The provider's own cash limit, or `null` when they are on the platform default. */
  ownLimit: number | null
  currency: string
  onClose: () => void
}) {
  const [data, setData] = useState<{
    provider: any; balance: any; statements: any[]; entries: any[]
  } | null>(null)
  const [control, setControl] = useState<{ enforcement: any; obligations: ObligationSummary } | null>(null)
  const [busy, setBusy] = useState(false)
  /** A failed load used to leave the drawer spinning forever. */
  const [loadError, setLoadError] = useState('')

  const [entryType, setEntryType] = useState<'adjustment' | 'write_off' | 'commission_payment'>('commission_payment')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [limit, setLimit] = useState('')
  const [reason, setReason] = useState('')

  const load = async (id: string) => {
    try {
      const [c, ctl] = await Promise.all([
        commissionApi.provider(id),
        providerControlApi.detail(id),
      ])
      setData(c.data)
      setControl({ enforcement: ctl.data.enforcement, obligations: ctl.data.obligations })
      setLoadError('')
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load provider')
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not load provider'), 'warn')
    }
  }

  useEffect(() => {
    // A fresh form per provider: the amount, note and reason typed for the last
    // one used to carry over into the next drawer opened.
    setAmount(''); setNote(''); setReason(''); setEntryType('commission_payment'); setLoadError('')
    /*
      The box shows the provider's *own* limit, blank when they follow the
      platform default. It was filled from `balance.creditLimit`, which is the
      resolved figure — default included — so a Save with nothing changed
      pinned the current default onto the account as a custom limit.
    */
    setLimit(ownLimit != null ? String(ownLimit) : '')
    if (!providerId) { setData(null); setControl(null); return }
    void load(providerId)
  }, [providerId])

  const owed = Number(data?.balance?.outstanding ?? 0)
  const amountNum = Number(amount)

  /** Posts a ledger entry after stating what it does to the balance. */
  const postEntry = () => {
    if (!providerId || busy || !(amountNum > 0) || !note.trim()) return
    const label = entryType === 'commission_payment' ? 'Record a payment of' : entryType === 'write_off' ? 'Write off' : 'Add a debt adjustment of'
    const after = entryType === 'adjustment' ? owed + amountNum : owed - amountNum
    const over = entryType !== 'adjustment' && amountNum > owed
    return confirmAndRun({
      title: `${label} ${formatPortalNumber(amountNum, { maximumFractionDigits: 2 })} ${currency}?`,
      body:
        `Owed now: ${formatPortalNumber(owed, { maximumFractionDigits: 2 })} ${currency}. After this: ${formatPortalNumber(after, { maximumFractionDigits: 2 })} ${currency}.` +
        (over ? ' This is more than the provider owes — the balance goes into credit.' : '') +
        ' Ledger entries cannot be edited; a mistake needs a correcting entry.',
      confirmLabel: 'Post entry',
      busyLabel: 'Posting…',
      danger: over,
      run: async () => {
        setBusy(true)
        try {
          await commissionApi.addEntry(providerId, { entryType, amount: amountNum, note: note.trim() })
          setAmount(''); setNote('')
        } finally {
          setBusy(false)
          await load(providerId)
        }
      },
      success: 'Ledger updated',
    })
  }

  const limitNum = limit.trim() === '' ? null : Number(limit)
  const limitInvalid = limitNum !== null && !(Number.isFinite(limitNum) && limitNum >= 0)

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true)
    try {
      await fn()
      toast(translatePortalText(done))
      if (providerId) await load(providerId)
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'That did not work'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  const setState = (state: string, acknowledge = false) => {
    if (!providerId) return
    if (!reason.trim()) {
      toast(translatePortalText('A reason is required — the provider is shown it.'), 'warn')
      return
    }
    return act(
      () => providerControlApi.setState(providerId, { state, reason: reason.trim(), acknowledgeCustomerImpact: acknowledge }),
      `Provider moved to ${state.replace('_', ' ')}`
    )
  }

  const obligations = control?.obligations
  const liveWork = obligations?.total ?? 0

  return (
    <Modal open={!!providerId} onClose={onClose} title={data ? `💰 ${data.provider?.name ?? 'Provider'}` : loadError ? translatePortalText('Provider') : 'Loading…'}>
      {!data ? (
        loadError ? (
          <div className="space-y-3 py-6 text-center text-sm text-rose-600">
            <p>{translatePortalText("Couldn't load: ")}{loadError}</p>
            <button className="btn-ghost !py-1.5 !px-3 !text-[11px]" onClick={() => { if (providerId) { setLoadError(''); void load(providerId) } }}>
              <RefreshCw size={12} /> {translatePortalText('Retry')}
            </button>
          </div>
        ) : (
          <div className="flex justify-center py-10"><Spinner /></div>
        )
      ) : (
        <div className="space-y-4">
          {/* ── Position ─────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-2">
            {([
              [translatePortalText('Owed'), data.balance.outstanding],
              [translatePortalText('Limit'), data.balance.creditLimit],
              [translatePortalText('Cash sales'), data.balance.cashSalesTotal],
            ] as const).map(([l, v]) => (
              <div key={l} className="rounded-xl bg-sand p-2.5">
                <p className="font-display text-base font-extrabold text-deep-900">{formatPortalNumber(Number(v), { maximumFractionDigits: 2 })}</p>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{l} · {currency}</p>
              </div>
            ))}
          </div>

          {liveWork > 0 && (
            <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-700 ring-1 ring-amber-200">
              <b>{liveWork} {translatePortalText(" live booking(s)")}</b> — {Object.entries(obligations!.byVertical).map(([k, n]) => `${n} ${k}`).join(', ')}.
              {' '}{translatePortalText("Pausing or suspending leaves these to be honoured. An emergency suspension stops them.\r\n            ")}</div>
          )}

          {/* ── Ledger entry ─────────────────────────────── */}
          <div className="space-y-2 rounded-xl border border-slate-100 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText('Ledger entry')}</p>
            <div className="flex gap-2">
              <select className="input !py-1.5 !text-[12px]" value={entryType} onChange={e => setEntryType(e.target.value as never)}>
                <option value="commission_payment">{translatePortalText('Record payment received')}</option>
                <option value="adjustment">{translatePortalText('Adjustment (increase debt)')}</option>
                <option value="write_off">{translatePortalText('Write off')}</option>
              </select>
              <input className="input !py-1.5 !text-[12px]" type="number" min="0" placeholder={translatePortalText('Amount')}
                value={amount} onChange={e => setAmount(e.target.value)} />
            </div>
            <input className="input !py-1.5 !text-[12px]" placeholder={translatePortalText("Reason (required — it goes on the ledger)")}
              value={note} onChange={e => setNote(e.target.value)} />
            {/* Confirmed with the amount and the balance it leaves. It posted on
                one click, and cleared the form even when the server refused. */}
            <button
              disabled={busy || !(amountNum > 0) || !note.trim()}
              onClick={() => void postEntry()}
              className="btn-admin w-full !justify-center !py-1.5 !text-[12px] disabled:opacity-40">
              <Check size={12} /> {translatePortalText('Post entry')}
            </button>
          </div>

          {/* ── Cash limit ───────────────────────────────── */}
          <div className="flex items-end gap-2 rounded-xl border border-slate-100 p-3">
            <label className="flex-1">
              <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText('Cash credit limit')}</span>
              <input className="input !py-1.5 !text-[12px]" type="number" min="0" value={limit}
                onChange={e => setLimit(e.target.value)}
                placeholder={`${translatePortalText('Platform default')}${ownLimit == null && data.balance?.creditLimit != null ? ` (${formatPortalNumber(data.balance.creditLimit)})` : ''}`} />
              {limitInvalid && <span className="mt-1 block text-[11px] font-semibold text-rose-600">{translatePortalText('The limit must be zero or more.')}</span>}
            </label>
            <button disabled={busy || limitInvalid}
              onClick={() => providerId && act(
                () => commissionApi.setCashLimit(providerId, limitNum),
                limitNum === null ? 'Cash limit reset to the platform default' : 'Cash limit updated'
              )}
              className="btn-ghost !py-1.5 !px-3 !text-[11px] disabled:opacity-40">{translatePortalText('Save')}</button>
          </div>

          {/* ── Enforcement ──────────────────────────────── */}
          <div className="space-y-2 rounded-xl border border-slate-100 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              {translatePortalText('Enforcement')} {translatePortalText(" — currently ")}{(control?.enforcement?.state ?? 'active').replace('_', ' ')}
            </p>
            <input className="input !py-1.5 !text-[12px]" placeholder={translatePortalText("Reason (shown to the provider)")}
              value={reason} onChange={e => setReason(e.target.value)} />
            <div className="flex flex-wrap gap-1.5">
              <button disabled={busy} onClick={() => void setState('active')}
                className="btn-ghost !py-1.5 !px-2.5 !text-[11px]"><Play size={12} /> {translatePortalText('Reinstate')}</button>
              <button disabled={busy} onClick={() => void setState('paused')}
                className="btn-ghost !py-1.5 !px-2.5 !text-[11px]"><Pause size={12} /> {translatePortalText('Pause new bookings')}</button>
              <button disabled={busy} onClick={() => void setState('suspended')}
                className="btn-ghost !py-1.5 !px-2.5 !text-[11px]"><ShieldAlert size={12} /> {translatePortalText('Suspend & review')}</button>
              <button
                disabled={busy}
                onClick={() => {
                  // Asked before the dialog, not after the admin has confirmed it.
                  if (!reason.trim()) {
                    toast(translatePortalText('A reason is required — the provider is shown it.'), 'warn')
                    return
                  }
                  if (liveWork > 0) {
                    void confirmAndRun({
                      title: 'Emergency suspend this provider?',
                      body: `This stops ${liveWork} live booking${liveWork === 1 ? '' : 's'} in progress and strands ${
                        liveWork === 1 ? 'that customer' : 'those customers'
                      }. It cannot be undone from here.`,
                      confirmLabel: 'Suspend now',
                      busyLabel: 'Suspending…',
                      danger: true,
                      run: async () => {
                        await setState('emergency_suspended', true)
                      },
                    })
                    return
                  }
                  // Still the most severe action on the ladder, so still
                  // confirmed — it went through on one click when nothing was live.
                  void confirmAndRun({
                    title: 'Emergency suspend this provider?',
                    body: 'No bookings are in progress right now, but the provider is stopped from all work immediately and shown your reason.',
                    confirmLabel: 'Suspend now',
                    busyLabel: 'Suspending…',
                    danger: true,
                    run: async () => {
                      await setState('emergency_suspended', true)
                    },
                  })
                }}
                className="rounded-lg bg-rose-600 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-rose-700 disabled:opacity-40">
                <Ban size={12} className="inline" /> {translatePortalText('Emergency suspend')}
              </button>
            </div>
            <button disabled={busy}
              onClick={() => providerId && act(
                () => providerControlApi.setCashBlocked(providerId, !control?.enforcement?.cashBlocked, reason.trim() || 'Reviewed by BoatPro'),
                control?.enforcement?.cashBlocked ? 'Cash restored' : 'Cash blocked'
              )}
              className="btn-ghost w-full !justify-center !py-1.5 !text-[11px]">
              {control?.enforcement?.cashBlocked ? translatePortalText('Allow cash bookings again') : translatePortalText('Block cash bookings only')}
            </button>
          </div>

          {/* ── History ──────────────────────────────────── */}
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText('Recent ledger')}</p>
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {data.entries.length === 0 && <p className="text-xs text-slate-400">{translatePortalText('No entries yet.')}</p>}
              {data.entries.map((e: any) => (
                <div key={e._id} className="flex items-center justify-between gap-2 rounded-lg bg-sand px-2.5 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-[11px] text-slate-600">
                    {e.entryType.replace(/_/g, ' ')}
                    {e.bookingCode ? ` · ${e.bookingCode}` : ''}
                    {e.note ? ` · ${e.note}` : ''}
                  </span>
                  <span className={`text-[11px] font-bold ${e.amount > 0 ? 'text-deep-900' : 'text-emerald-600'}`}>
                    {e.amount > 0 ? '+' : '−'}{formatPortalNumber(Math.abs(e.amount))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

export default CollectionsPanel
