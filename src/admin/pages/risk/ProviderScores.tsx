import React, { useEffect, useMemo, useState } from 'react'
import { TableToolbar, useTableFilters, NoFilterMatches, type TableFiltersConfig } from '../../../shared/TableFilters'
import { motion } from 'framer-motion'
import { RefreshCw, Radar, Plus, XCircle } from 'lucide-react'
import { confirmAndRun } from '../../../async'
import { Modal, toast, Spinner, Avatar } from '../../../ui'
import { riskApi, type ProviderBalanceRow, type RiskAssessmentView, type RiskEventRow } from '../../../api'
import { translatePortalText, formatPortalNumber, formatPortalDate } from '../../../i18n/runtime'

/**
 * The fraud and risk console.
 *
 * Built around one constraint: the score is never the answer on its own. A number
 * like "62" cannot be appealed by the provider it restricts or justified by the
 * admin who acts on it, so every view here leads with the *events* and treats the
 * score as their sum. Dismissing an event is a first-class action for the same
 * reason — the engine will be wrong sometimes, and the only safe design is one
 * where being wrong is cheap to correct.
 *
 * What this screen deliberately cannot do is suspend anybody. The engine withdraws
 * cash automatically and opens a case above a high bar; stopping work customers
 * have paid for stays a human decision, taken on the enforcement console next
 * door.
 */

const STATE_STYLE: Record<string, string> = {
  good: 'bg-emerald-50 text-emerald-600 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-600 ring-amber-200',
  limit_reached: 'bg-orange-50 text-orange-600 ring-orange-200',
  overdue: 'bg-rose-50 text-rose-600 ring-rose-200',
  restricted: 'bg-rose-100 text-rose-700 ring-rose-300',
}

/** Every type the backend accepts, so an admin can log what a detector cannot see. */
const EVENT_TYPES = [
  'cash_disputed',
  'commission_overdue',
  'cancelled_after_cash_claim',
  'abnormal_cash_ratio',
  'volume_spike',
  'upheld_complaint',
  'shared_device',
  'completed_without_checkin',
  'chargeback',
  'document_tampering',
  'off_platform_contact',
  'linked_account',
  'fake_reviews',
  'listing_fraud',
]

const label = (s: string) => translatePortalText(s.replace(/_/g, ' '))
const nameOf = (p: ProviderBalanceRow) => p.business?.businessName || p.name

/** Red above the cash-withdrawal line, amber above the warning line. */
function scoreTone(score: number, thresholds: Record<string, number>): string {
  if (score >= (thresholds.CASH_WITHDRAWN ?? 50)) return 'text-rose-600'
  if (score >= (thresholds.WARNING ?? 25)) return 'text-amber-600'
  return 'text-slate-500'
}

/**
 * Provider risk scores: every provider above the chosen score, the events behind
 * each score, and the tools to dismiss an event or log one a detector cannot see.
 */
export function ProviderScores({ onRows }: { onRows?: (rows: ProviderBalanceRow[], thresholds: Record<string, number>) => void }) {
  const [rows, setRows] = useState<ProviderBalanceRow[]>([])
  const [thresholds, setThresholds] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [minScore, setMinScore] = useState(25)
  const [active, setActive] = useState<string | null>(null)
  const [composing, setComposing] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const res = await riskApi.queue({ minScore, limit: 100 })
      setRows(res.data.items)
      setThresholds(res.data.thresholds ?? {})
      onRows?.(res.data.items, res.data.thresholds ?? {})
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not load the risk queue'), 'warn')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [minScore])

  const sweep = async () => {
    try {
      const res = await riskApi.sweep()
      toast(translatePortalText(`Swept ${formatPortalNumber(res.data.providers)} provider(s), raised ${formatPortalNumber(res.data.raised)} signal(s)`))
      await load()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Sweep failed'), 'warn')
    }
  }

  /**
   * Risk filters name the signal, not the score. "Which providers were flagged for
   * chargebacks" is the question an analyst actually arrives with; the score band
   * above already covers "how bad".
   */
  const filterCfg: TableFiltersConfig<ProviderBalanceRow> = useMemo(() => ({
    searchFields: (p) => [p.name, p.business?.businessName, p.email],
    filters: [
      { key: 'type', label: translatePortalText('Provider type'), get: (p) => p.onboarding?.providerType ? translatePortalText(p.onboarding.providerType.replace(/_/g, ' ')) : undefined },
      { key: 'financial', label: translatePortalText('Financial state'), get: (p) => p.enforcement?.financialState ? translatePortalText(p.enforcement.financialState) : translatePortalText('good') },
      {
        key: 'cash',
        label: translatePortalText('Cash standing'),
        options: [
          { value: 'blocked', label: translatePortalText('Cash withdrawn') },
          { value: 'allowed', label: translatePortalText('Cash allowed') },
        ],
        get: (p) => (p.enforcement?.cashBlocked ? 'blocked' : 'allowed'),
      },
      {
        key: 'signal',
        label: translatePortalText('Risk signal'),
        // Derived from the signals actually present, so the list can never offer a
        // signal that no provider on screen was flagged for.
        options: [...new Set(rows.flatMap(r => r.enforcement?.riskSignals ?? []))]
          .sort()
          .map(sig => ({ value: sig, label: label(sig) })),
        get: (p) => (p.enforcement?.riskSignals ?? []).join(','),
        match: (p, v) => (p.enforcement?.riskSignals ?? []).includes(v),
      },
    ],
    sortOptions: [
      // Highest score first: the queue exists to be worked from the top.
      { key: 'score', label: translatePortalText('Risk score'), get: (p) => p.enforcement?.riskScore ?? 0, defaultDir: 'desc' },
      { key: 'name', label: translatePortalText('Provider'), get: (p) => p.business?.businessName || p.name, defaultDir: 'asc' },
    ],
    defaultSort: 'score',
  }), [rows])
  const tf = useTableFilters(rows, filterCfg)
  const visible = tf.filtered

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {[0, thresholds.WARNING ?? 25, thresholds.CASH_WITHDRAWN ?? 50, thresholds.REVIEW ?? 75].map(n => (
          <button key={n} onClick={() => setMinScore(n)}
            className={`rounded-full px-3 py-1.5 text-[11px] font-bold ring-1 transition ${
              minScore === n ? 'bg-deep-900 text-white ring-deep-900' : 'bg-white text-slate-500 ring-slate-200'
            }`}>
            {n === 0 ? translatePortalText('All') : `${n}+`}
          </button>
        ))}
        <div className="ms-auto flex gap-2">
          <button onClick={() => setComposing(true)} className="btn-ghost !py-1.5 !px-3 !text-[11px]">
            <Plus size={12} /> {translatePortalText('Log event')}
          </button>
          <button onClick={() => void sweep()} className="btn-ghost !py-1.5 !px-3 !text-[11px]">
            <Radar size={12} /> {translatePortalText('Run provider detectors')}
          </button>
          <button onClick={() => void load()} className="btn-ghost !py-1.5 !px-3 !text-[11px]">
            <RefreshCw size={12} /> {translatePortalText('Refresh')}
          </button>
        </div>
      </div>

      <TableToolbar
        state={tf}
        config={filterCfg}
        rows={rows}
        noun={translatePortalText('providers')}
        searchPlaceholder={translatePortalText('Search flagged providers by name or email...')}
      />

      {loading && rows.length === 0 && <div className="flex justify-center py-16"><Spinner /></div>}
      {!loading && rows.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-200 py-14 text-center text-sm text-slate-400">
          {translatePortalText('Nothing above this score. Lower the filter to see quieter signals.')}
        </div>
      )}
      {!loading && rows.length > 0 && visible.length === 0 && (
        <NoFilterMatches noun={translatePortalText('providers')} onClear={tf.clear} />
      )}

      <div className="space-y-3">
        {visible.map((p, i) => {
          const score = p.enforcement?.riskScore ?? 0
          const state = p.enforcement?.financialState ?? 'good'
          return (
            <motion.div key={p._id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.03, 0.3) }}
              className={`card flex flex-wrap items-center gap-4 p-4 ${
                score >= (thresholds.REVIEW ?? 75) ? 'ring-1 ring-rose-200' : ''
              }`}>
              <Avatar name={nameOf(p)} size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-extrabold text-deep-900">{nameOf(p)}</p>
                <p className="truncate text-xs text-slate-400">
                  {p.onboarding?.providerType ? translatePortalText(p.onboarding.providerType.replace('_', ' ')) : ''}
                  {(p.enforcement?.riskSignals ?? []).length
                    ? ` · ${(p.enforcement!.riskSignals ?? []).map(label).join(', ')}`
                    : ''}
                </p>
              </div>

              <div className="text-end">
                <p className={`font-display text-xl font-extrabold ${scoreTone(score, thresholds)}`}>{formatPortalNumber(score)}</p>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText('score')}</p>
              </div>

              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${STATE_STYLE[state] ?? STATE_STYLE.good}`}>
                {label(state)}
              </span>
              {p.enforcement?.cashBlocked && (
                <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-600 ring-1 ring-rose-200">
                  {translatePortalText('Cash withdrawn')}
                </span>
              )}

              <button onClick={() => setActive(p._id)} className="btn-admin !py-1.5 !px-2.5 !text-[11px]">
                {translatePortalText('Evidence')}
              </button>
            </motion.div>
          )
        })}
      </div>

      <EvidenceDrawer providerId={active} onClose={() => { setActive(null); void load() }} />
      <LogEventModal open={composing} onClose={() => { setComposing(false); void load() }} rows={rows} />
    </div>
  )
}

/**
 * One provider's evidence.
 *
 * Leads with the per-type breakdown, then the individual events — because "why is
 * this 62" is answered by the first and "is this fair" only by the second. Each
 * live event can be dismissed with a reason, which rescores the provider on the
 * spot and lifts any restriction the event was holding up.
 */
function EvidenceDrawer({ providerId, onClose }: { providerId: string | null; onClose: () => void }) {
  const [risk, setRisk] = useState<RiskAssessmentView | null>(null)
  const [dismissed, setDismissed] = useState<RiskEventRow[]>([])
  const [busy, setBusy] = useState(false)

  const load = async (id: string) => {
    try {
      // The server answers with the assessment flat on `data`; reading a
      // `data.risk` that was never sent left this drawer spinning forever.
      const res = await riskApi.provider(id)
      const { dismissedEvents, thresholds: _thresholds, ...assessment } = res.data
      setRisk(assessment)
      setDismissed(dismissedEvents ?? [])
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not load evidence'), 'warn')
    }
  }

  useEffect(() => {
    if (!providerId) { setRisk(null); setDismissed([]); return }
    void load(providerId)
  }, [providerId])

  /**
   * Clearing a risk event, with the justification on the record.
   *
   * This rescores the provider, so the reason is an audit trail entry rather
   * than a courtesy — `window.prompt` put the event's own detail into the
   * dialog body as raw text, could not require an answer, and gave no way to
   * show that the rescore was in progress.
   */
  const dismiss = async (event: RiskEventRow) => {
    setBusy(true)
    try {
      await confirmAndRun({
        title: translatePortalText('Dismiss this risk event?'),
        body: `${event.detail}\n\n${translatePortalText('Dismissing it rescores the provider. Your reason is kept on the event.')}`,
        confirmLabel: translatePortalText('Dismiss event'),
        busyLabel: translatePortalText('Dismissing…'),
        input: {
          label: translatePortalText("Why is this not the provider's fault?"),
          placeholder: translatePortalText('e.g. Customer cancelled for weather — provider was ready and on station.'),
          required: true,
          multiline: true,
          maxLength: 500,
        },
        success: translatePortalText('Event dismissed and provider rescored'),
        run: async reason => {
          await riskApi.dismissEvent(event._id, reason.trim())
          if (providerId) await load(providerId)
        },
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={!!providerId} onClose={onClose} title={`🛡️ ${translatePortalText('Risk evidence')}`}>
      {!risk ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl bg-sand p-3">
            <p className="font-display text-3xl font-extrabold text-deep-900">{formatPortalNumber(risk.score)}</p>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-bold text-deep-800">{label(risk.financialState)}</p>
              <p className="text-[11px] text-slate-500">
                {risk.needsReview
                  ? translatePortalText('Above the review line — a case has been opened.')
                  : risk.cashShouldBeWithdrawn
                    ? translatePortalText('Cash withdrawn. Online bookings continue.')
                    : translatePortalText('No automatic restriction in force.')}
              </p>
            </div>
          </div>

          {risk.breakdown.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                {translatePortalText('What makes up the score')}
              </p>
              <div className="space-y-1">
                {risk.breakdown
                  .slice()
                  .sort((a, b) => b.contribution - a.contribution)
                  .map(b => (
                    <div key={b.type} className="flex items-center justify-between gap-2 rounded-lg bg-sand px-2.5 py-1.5">
                      <span className="text-[11px] text-slate-600">{formatPortalNumber(b.count)}× {label(b.type)}</span>
                      <span className="text-[11px] font-bold text-deep-900">+{formatPortalNumber(b.contribution)}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              {translatePortalText('Events')} ({formatPortalNumber(risk.events.length)})
            </p>
            <div className="max-h-56 space-y-1.5 overflow-y-auto">
              {risk.events.length === 0 && <p className="text-xs text-slate-400">{translatePortalText('No live events.')}</p>}
              {risk.events.map(e => (
                <div key={e._id} className="rounded-lg border border-slate-100 p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-bold text-deep-800">
                        {label(e.type)} <span className="font-normal text-slate-400">· {translatePortalText('weight')} {formatPortalNumber(e.weight)}</span>
                      </p>
                      <p className="text-[11px] text-slate-600">{e.detail}</p>
                      <p className="text-[10px] text-slate-400">{formatPortalDate(new Date(e.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}</p>
                    </div>
                    <button disabled={busy} onClick={() => void dismiss(e)}
                      className="shrink-0 rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500 hover:bg-slate-200 disabled:opacity-40">
                      <XCircle size={11} className="inline" /> {translatePortalText('Dismiss')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {dismissed.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                {translatePortalText('Dismissed — kept on the record, not counted')}
              </p>
              <div className="max-h-32 space-y-1 overflow-y-auto">
                {dismissed.map(e => (
                  <div key={e._id} className="rounded-lg bg-sand px-2.5 py-1.5 text-[11px] text-slate-500">
                    {label(e.type)} — {e.dismissReason}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

/** Records something no detector can observe — a chargeback, an upheld complaint. */
function LogEventModal({
  open,
  onClose,
  rows,
}: {
  open: boolean
  onClose: () => void
  rows: ProviderBalanceRow[]
}) {
  const [providerId, setProviderId] = useState('')
  const [type, setType] = useState('upheld_complaint')
  const [detail, setDetail] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!providerId || !detail.trim()) return
    setBusy(true)
    try {
      const res = await riskApi.addEvent({ providerId, type, detail: detail.trim() })
      toast(translatePortalText(`Recorded — score is now ${formatPortalNumber(res.data.risk.score)}`))
      setDetail('')
      onClose()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not record the event'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`➕ ${translatePortalText('Log a risk event')}`}>
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText('Provider')}</span>
          <select className="input" value={providerId} onChange={e => setProviderId(e.target.value)}>
            <option value="">{translatePortalText('Choose…')}</option>
            {rows.map(p => (
              <option key={p._id} value={p._id}>{nameOf(p)}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText('What happened')}</span>
          <select className="input" value={type} onChange={e => setType(e.target.value)}>
            {EVENT_TYPES.map(t => <option key={t} value={t}>{label(t)}</option>)}
          </select>
        </label>

        <textarea className="input min-h-[90px]" value={detail} onChange={e => setDetail(e.target.value)}
          maxLength={500}
          placeholder={translatePortalText('What was observed, and how you know. The provider may be shown this if they appeal.')} />

        <button disabled={busy || !providerId || !detail.trim()}
          onClick={() => void submit()}
          className="btn-admin w-full !justify-center disabled:opacity-40">
          {busy ? <Spinner /> : <Plus size={14} />} {translatePortalText('Record event')}
        </button>
      </div>
    </Modal>
  )
}

