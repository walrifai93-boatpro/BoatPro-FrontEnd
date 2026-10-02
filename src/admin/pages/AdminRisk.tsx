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
  const [providers, setProviders] = useState<{ rows: ProviderBalanceRow[]; thresholds: Record<string, number> } | null>(null)
  const [sweeping, setSweeping] = useState(false)

  // Tile numbers for whichever tab opens first; the tabs keep them fresh after.
  const refreshTiles = () => {
    riskApi.flags({ limit: 1 }).then(r => setCounts(r.data.counts)).catch(() => {})
    riskApi.queue({ limit: 100 }).then(r => setProviders({ rows: r.data.items, thresholds: r.data.thresholds ?? {} })).catch(() => {})
  }
  useEffect(refreshTiles, [])

  const sweepAll = async () => {
    setSweeping(true)
    try {
      const res = await riskApi.sweepAll()
      const d = res.data as any
      const n = (x: any) => (typeof x?.raised === 'number' ? x.raised : typeof x?.created === 'number' ? x.created : 0)
      const total = n(d.customers) + n(d.providers) + n(d.linkedAccounts) + n(d.reviewRings) + n(d.listings)
      toast(translatePortalText(`Detectors finished — ${formatPortalNumber(total)} new finding(s)`))
      refreshTiles()
      // Remount the open tab so it reloads.
      setTab(tab)
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'The detectors did not finish'), 'warn')
    } finally {
      setSweeping(false)
    }
  }

  const review = providers?.thresholds.REVIEW ?? 75
  const tiles: [string, number, Tab][] = [
    [translatePortalText('Flags to decide'), counts?.openFlags ?? 0, 'flags'],
    [translatePortalText('Customer alerts'), counts?.openCustomers ?? 0, 'customers'],
    [translatePortalText('Appeals waiting'), counts?.pendingAppeals ?? 0, 'appeals'],
    [translatePortalText('Providers above review'), providers?.rows.filter(r => (r.enforcement?.riskScore ?? 0) >= review).length ?? 0, 'providers'],
    [translatePortalText('Cash withdrawn'), providers?.rows.filter(r => r.enforcement?.cashBlocked).length ?? 0, 'providers'],
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

      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-5">
        {tiles.map(([l, v, target], i) => (
          <motion.button key={l} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
            onClick={() => setTab(target)} className="card p-4 text-start transition hover:ring-1 hover:ring-slate-200">
            <p className={`font-display text-2xl font-extrabold ${v > 0 && target !== 'providers' ? 'text-rose-600' : 'text-deep-900'}`}>{formatPortalNumber(v)}</p>
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

      {tab === 'flags' && <FlagQueue key="flags" group="flags" onCounts={setCounts} />}
      {tab === 'customers' && <FlagQueue key="customers" group="customers" onCounts={setCounts} />}
      {tab === 'providers' && <ProviderScores onRows={(rows, thresholds) => setProviders({ rows, thresholds })} />}
      {tab === 'appeals' && <Appeals onCount={n => setCounts(c => (c ? { ...c, pendingAppeals: n } : c))} />}
      {tab === 'settings' && <RiskSettings />}
    </PageWrap>
  )
}

export default AdminRisk
