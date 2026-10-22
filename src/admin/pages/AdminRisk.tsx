import React, { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ShieldAlert, Radar } from 'lucide-react'
import { PageWrap } from './_shared'
import { AdminHeader } from '../adminUi'
import { toast } from '../../ui'
import { riskApi, type ContentFlagCounts, type ProviderBalanceRow } from '../../api'
import { translatePortalText, formatPortalNumber } from '../../i18n/runtime'
import { FlagQueue } from './risk/FlagQueue'
import { ProviderScores } from './risk/ProviderScores'
import { Appeals } from './risk/Appeals'
import { RiskSettings } from './risk/RiskSettings'

/**
 * Risk & Fraud — the one place an admin answers "who or what on the platform
 * can't be trusted right now, and what do we do about it".
 *
 *  - Flagged: what AI Management held back (documents, reviews, chats) and what
 *    the detectors found (linked accounts, review rings, copied photos, bait
 *    prices, provider risk cases).
 *  - Customers: abuse patterns from payment and booking history.
 *  - Provider scores: the decaying, event-sourced risk score and its evidence.
 *  - Appeals: providers challenging a decision or an event.
 *  - Settings: thresholds, detector limits, word lists, and how often each
 *    detector turns out to be right.
 *
 * The score is never the answer on its own: every view leads with the evidence,
 * every decision is one an admin takes, and being wrong is cheap to undo.
 */

const TABS = ['flags', 'customers', 'providers', 'appeals', 'settings'] as const
type Tab = (typeof TABS)[number]

export function AdminRisk() {
  const [params, setParams] = useSearchParams()
  const tab: Tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'flags'
  const setTab = (t: Tab) => setParams(t === 'flags' ? {} : { tab: t }, { replace: true })

  const [counts, setCounts] = useState<ContentFlagCounts | null>(null)
  /**
   * The two provider tiles, counted on their own. They used to be filtered out
   * of whatever rows Provider scores last loaded — the first 100, and only
   * those above the score filter the admin had picked on that tab — so raising
   * the filter to 75 quietly changed "Cash withdrawn" too.
   */
  const [providerTiles, setProviderTiles] = useState<{ aboveReview: number; cashBlocked: number; cashBlockedPartial: boolean } | null>(null)
  const [tileError, setTileError] = useState(false)
  const [sweeping, setSweeping] = useState(false)
  /** Bumped to remount the open tab so it re-reads. */
  const [reloadKey, setReloadKey] = useState(0)

  // Tile numbers for whichever tab opens first; the tabs keep them fresh after.
  const refreshTiles = () => {
    setTileError(false)
    riskApi.flags({ limit: 1 }).then(r => setCounts(r.data.counts)).catch(() => setTileError(true))
    ;(async () => {
      // The queue lists providers at or above `minScore`, highest first. Its
      // `pagination.total` is the exact count above the review line; cash
      // withdrawal has no server filter, so it is counted from the top 100 of
      // everyone scored and marked as partial when there are more.
      const all = await riskApi.queue({ minScore: 0, limit: 100 })
      const review = all.data.thresholds?.REVIEW ?? 75
      const above = await riskApi.queue({ minScore: review, limit: 1 })
      setProviderTiles({
        aboveReview: above.data.pagination?.total ?? 0,
        cashBlocked: all.data.items.filter((r: ProviderBalanceRow) => r.enforcement?.cashBlocked).length,
        cashBlockedPartial: (all.data.pagination?.total ?? 0) > all.data.items.length,
      })
    })().catch(() => setTileError(true))
  }
  useEffect(refreshTiles, [])

  const sweepAll = async () => {
    setSweeping(true)
    try {
      const res = await riskApi.sweepAll()
      const d = res.data as any
      // Per detector: customers → `{ created }`, providers → `{ raised }`; the
      // pattern detectors report their own sum as `total`. The listings
      // detector returns `{ photos, prices }`, which the old per-key reading
      // counted as 0. A detector that threw comes back as `{ error }`.
      const n = (x: any) => (typeof x?.raised === 'number' ? x.raised : typeof x?.created === 'number' ? x.created : 0)
      const total = n(d.customers) + n(d.providers) + (typeof d.total === 'number' ? d.total : 0)
      const failed = (['customers', 'providers', 'linkedAccounts', 'reviewRings', 'listings'] as const).filter(k => d?.[k]?.error)
      if (failed.length) {
        toast(translatePortalText(`Detectors finished with errors (${failed.join(', ')}) — ${formatPortalNumber(total)} new finding(s)`), 'warn')
      } else {
        toast(translatePortalText(`Detectors finished — ${formatPortalNumber(total)} new finding(s)`))
      }
      refreshTiles()
      // `setTab(tab)` set the same value and remounted nothing; a new key does.
      setReloadKey(k => k + 1)
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'The detectors did not finish'), 'warn')
    } finally {
      setSweeping(false)
    }
  }

  // `null` until answered: an unanswered request shows a dash, not a 0 that
  // reads as "nothing to do".
  const tiles: [string, number | null, Tab, string?][] = [
    [translatePortalText('Flags to decide'), counts ? counts.openFlags ?? 0 : null, 'flags'],
    [translatePortalText('Customer alerts'), counts ? counts.openCustomers ?? 0 : null, 'customers'],
    [translatePortalText('Appeals waiting'), counts ? counts.pendingAppeals ?? 0 : null, 'appeals'],
    [translatePortalText('Providers above review'), providerTiles ? providerTiles.aboveReview : null, 'providers'],
    [translatePortalText('Cash withdrawn'), providerTiles ? providerTiles.cashBlocked : null, 'providers', providerTiles?.cashBlockedPartial ? '+' : ''],
  ]
  const tabLabel: Record<Tab, string> = {
    flags: `${translatePortalText('Flagged')}${counts?.openFlags ? ` (${formatPortalNumber(counts.openFlags)})` : ''}`,
    customers: `${translatePortalText('Customers')}${counts?.openCustomers ? ` (${formatPortalNumber(counts.openCustomers)})` : ''}`,
    providers: translatePortalText('Provider scores'),
    appeals: `${translatePortalText('Appeals')}${counts?.pendingAppeals ? ` (${formatPortalNumber(counts.pendingAppeals)})` : ''}`,
    settings: translatePortalText('Settings'),
  }

  return (
    <PageWrap>
      <AdminHeader
        title={translatePortalText('Risk & Fraud')}
        sub={translatePortalText('Flagged content, detector findings, customer abuse, provider risk scores and appeals')}
        icon={<ShieldAlert className="text-rose-500" />}
        actions={
          <button onClick={() => void sweepAll()} disabled={sweeping} className="btn-admin disabled:opacity-50">
            <Radar size={15} /> {translatePortalText(sweeping ? 'Running…' : 'Run all detectors')}
          </button>
        }
      />

      {tileError && (
        <div className="card mb-4 flex flex-wrap items-center justify-between gap-3 !border-rose-200 !bg-rose-50 p-4 text-sm text-rose-600">
          <p>{translatePortalText('Some Risk & Fraud figures could not be loaded.')}</p>
          <button className="btn-ghost !py-1.5 !px-3 text-xs" onClick={refreshTiles}>{translatePortalText('Retry')}</button>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-5">
        {tiles.map(([l, v, target, more], i) => (
          <motion.button key={l} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
            onClick={() => setTab(target)} className="card p-4 text-start transition hover:ring-1 hover:ring-slate-200">
            <p className={`font-display text-2xl font-extrabold ${v !== null && v > 0 && target !== 'providers' ? 'text-rose-600' : 'text-deep-900'}`}>
              {v === null ? '—' : `${formatPortalNumber(v)}${more ?? ''}`}
            </p>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{l}</p>
          </motion.button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-full px-3.5 py-1.5 text-[12px] font-bold ring-1 transition ${
              tab === t ? 'bg-deep-900 text-white ring-deep-900' : 'bg-white text-slate-500 ring-slate-200 hover:ring-slate-300'
            }`}>
            {tabLabel[t]}
          </button>
        ))}
      </div>

      {tab === 'flags' && <FlagQueue key={`flags-${reloadKey}`} group="flags" onCounts={setCounts} />}
      {tab === 'customers' && <FlagQueue key={`customers-${reloadKey}`} group="customers" onCounts={setCounts} />}
      {/* Its rows are filtered by its own score slider, so they refresh the
          tiles by re-counting rather than standing in for the counts. */}
      {tab === 'providers' && <ProviderScores key={`providers-${reloadKey}`} onRows={() => refreshTiles()} />}
      {tab === 'appeals' && <Appeals key={`appeals-${reloadKey}`} onCount={n => setCounts(c => (c ? { ...c, pendingAppeals: n } : c))} />}
      {tab === 'settings' && <RiskSettings key={`settings-${reloadKey}`} />}
    </PageWrap>
  )
}

export default AdminRisk
