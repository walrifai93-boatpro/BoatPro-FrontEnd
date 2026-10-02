import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { RefreshCw, Gavel } from 'lucide-react'
import { confirmAndRun } from '../../../async'
import { toast, Spinner, Avatar } from '../../../ui'
import { riskApi, type RiskAppealRow } from '../../../api'
import { translatePortalText, formatPortalNumber } from '../../../i18n/runtime'
import { KIND_META, label, nameOf, when } from './riskShared'

/**
 * Provider appeals against a risk event or a Risk & Fraud decision.
 *
 * Upholding reverses the decision (the review goes back up, the risk event is
 * dismissed, the score recomputed) and tells the provider; rejecting keeps it
 * and must say why, because the provider reads the answer.
 */
export function Appeals({ onCount }: { onCount?: (n: number) => void }) {
  const [state, setState] = useState<'pending' | 'all'>('pending')
  const [items, setItems] = useState<RiskAppealRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const res = await riskApi.appeals(state)
      setItems(res.data.items)
      if (state === 'pending') onCount?.(res.data.items.length)
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not load appeals'), 'warn')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [state])

  const decide = async (row: RiskAppealRow, decision: 'uphold' | 'reject') => {
    await confirmAndRun({
      title: translatePortalText(decision === 'uphold' ? 'Uphold this appeal?' : 'Reject this appeal?'),
      body: translatePortalText(decision === 'uphold'
        ? 'The decision is reversed and anything it added to the provider\'s risk score is taken back. The provider is told.'
        : 'The decision stands. The provider reads your answer, so say what you checked.'),
      danger: decision === 'reject',
      confirmLabel: translatePortalText(decision === 'uphold' ? 'Uphold' : 'Reject'),
      busyLabel: translatePortalText('Saving…'),
      input: {
        label: translatePortalText('Answer to the provider'),
        placeholder: translatePortalText(decision === 'uphold'
          ? 'e.g. The account you share a bank with is your own second branch — confirmed.'
          : 'e.g. The registration number on the document does not match your vessel.'),
        required: decision === 'reject',
        multiline: true,
        maxLength: 1000,
      },
      success: translatePortalText(decision === 'uphold' ? 'Appeal upheld' : 'Appeal rejected'),
      run: async response => {
        await riskApi.decideAppeal(row.target, row.id, decision, response.trim() || undefined)
        await load()
      },
    })
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {([['pending', 'Waiting for an answer'], ['all', 'All appeals']] as const).map(([s, l]) => (
          <button key={s} onClick={() => setState(s)}
            className={`rounded-full px-3 py-1.5 text-[11px] font-bold ring-1 transition ${state === s ? 'bg-deep-900 text-white ring-deep-900' : 'bg-white text-slate-500 ring-slate-200'}`}>
            {translatePortalText(l)}
          </button>
        ))}
        <button onClick={() => void load()} className="btn-ghost ms-auto !py-1.5 !px-3 !text-[11px]"><RefreshCw size={12} /> {translatePortalText('Refresh')}</button>
      </div>

      {loading && items.length === 0 && <div className="flex justify-center py-16"><Spinner /></div>}
      {!loading && items.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-200 py-14 text-center text-sm text-slate-400">
          {translatePortalText(state === 'pending' ? 'No appeals are waiting.' : 'No appeals yet.')}
        </div>
      )}

      <div className="space-y-3">
        {items.map((a, i) => {
          const who = nameOf(a.provider) ?? translatePortalText('Provider')
          const pending = a.appeal.status === 'pending'
          return (
            <motion.div key={`${a.target}:${a.id}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.03, 0.3) }}
              className="card p-4">
              <div className="flex flex-wrap items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-600"><Gavel size={18} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[14px] font-extrabold text-deep-900">
                      {a.target === 'event' ? `${translatePortalText('Risk event')}: ${label(a.kind)}` : translatePortalText(KIND_META[a.kind]?.label ?? a.title)}
                    </p>
                    {a.weight != null && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">+{formatPortalNumber(a.weight)}</span>}
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${
                      pending ? 'bg-violet-50 text-violet-700 ring-violet-200' : a.appeal.status === 'upheld' ? 'bg-emerald-50 text-emerald-600 ring-emerald-200' : 'bg-slate-100 text-slate-600 ring-slate-200'
                    }`}>{translatePortalText(a.appeal.status)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-400">
                    <Avatar name={who} size={18} /><span className="font-semibold text-slate-600">{who}</span>
                    {a.provider?.email && <span>· {a.provider.email}</span>}
                    <span>· {translatePortalText('appealed')} {when(a.appeal.at)}</span>
                  </div>
                  <p className="mt-2 text-[12px] text-slate-500"><b className="text-slate-600">{translatePortalText('What was decided')}:</b> {a.detail}{a.decisionNote ? ` — ${a.decisionNote}` : ''}</p>
                  <blockquote className="mt-2 rounded-lg border-s-2 border-violet-200 bg-sand px-3 py-2 text-[12px] text-slate-700">{a.appeal.text}</blockquote>
                  {a.appeal.response && <p className="mt-2 text-[11.5px] text-slate-500"><b>{translatePortalText('Answer')}:</b> {a.appeal.response}</p>}
                </div>
                {pending && (
                  <div className="flex shrink-0 gap-2">
                    <button onClick={() => void decide(a, 'reject')} className="btn-ghost !py-1.5 !px-3 !text-[11px]">{translatePortalText('Reject')}</button>
                    <button onClick={() => void decide(a, 'uphold')} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-emerald-700">
                      {translatePortalText('Uphold')}
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
