import React, { useEffect, useState } from 'react'
import { Plus, Trash2, Save } from 'lucide-react'
import { toast, Spinner, Toggle } from '../../../ui'
import { riskApi, type RiskFlagStats, type RiskSettingsView } from '../../../api'
import { translatePortalText, formatPortalNumber } from '../../../i18n/runtime'
import { KIND_META, label } from './riskShared'

/**
 * Risk & Fraud → Settings.
 *
 * The numbers the engine and detectors run on, and the evidence for changing
 * them: how often each detector is confirmed versus cleared. A detector an
 * admin keeps clearing is too strict; the fix is here, not in the queue.
 */
export function RiskSettings() {
  const [settings, setSettings] = useState<RiskSettingsView | null>(null)
  const [stats, setStats] = useState<RiskFlagStats | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [newTerm, setNewTerm] = useState('')
  const [newSeverity, setNewSeverity] = useState<'Medium' | 'High' | 'Critical'>('High')
  const [newAllow, setNewAllow] = useState('')

  useEffect(() => {
    riskApi.settings().then(r => setSettings(r.data.settings)).catch(() => toast(translatePortalText('Could not load settings'), 'warn'))
    riskApi.stats().then(r => setStats(r.data)).catch(() => {})
  }, [])

  const save = async (section: string, patch: Partial<RiskSettingsView>) => {
    setSaving(section)
    try {
      const res = await riskApi.saveSettings(patch)
      setSettings(res.data.settings)
      toast(translatePortalText('Saved — takes effect within a few seconds'))
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not save'), 'warn')
    } finally {
      setSaving(null)
    }
  }

  if (!settings) return <div className="flex justify-center py-16"><Spinner /></div>
  const t = settings.thresholds
  const d = settings.detectors
  const setT = (k: keyof typeof t, v: number) => setSettings({ ...settings, thresholds: { ...t, [k]: v } })
  const setD = (k: keyof typeof d, v: number) => setSettings({ ...settings, detectors: { ...d, [k]: v } })
  const m = settings.moderation

  return (
    <div className="space-y-5">
      <section className="card p-5">
        <Head title="How often each detector is right" sub={`Confirmed ÷ (confirmed + cleared), last ${stats?.windowDays ?? 90} days. Below ~50% means admins mostly disagree with it.`} />
        {!stats ? <Spinner /> : stats.byKind.length === 0 ? (
          <p className="text-xs text-slate-400">{translatePortalText('No decided cases yet.')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-start text-[10.5px] uppercase tracking-wider text-slate-400">
                  <th className="py-1.5 text-start">{translatePortalText('Detector')}</th>
                  <th className="text-end">{translatePortalText('Raised')}</th>
                  <th className="text-end">{translatePortalText('Confirmed')}</th>
                  <th className="text-end">{translatePortalText('Cleared')}</th>
                  <th className="text-end">{translatePortalText('Open')}</th>
                  <th className="text-end">{translatePortalText('Right')}</th>
                </tr>
              </thead>
              <tbody>
                {stats.byKind.map(r => (
                  <tr key={r.kind} className="border-t border-slate-50">
                    <td className="py-1.5 font-semibold text-deep-900">{translatePortalText(KIND_META[r.kind]?.label ?? label(r.kind))}</td>
                    <td className="text-end">{formatPortalNumber(r.raised)}</td>
                    <td className="text-end">{formatPortalNumber(r.confirmed)}</td>
                    <td className="text-end">{formatPortalNumber(r.cleared)}</td>
                    <td className="text-end">{formatPortalNumber(r.open)}</td>
                    <td className={`text-end font-bold ${r.confirmRate == null ? 'text-slate-300' : r.confirmRate < 50 ? 'text-rose-600' : 'text-emerald-600'}`}>
                      {r.confirmRate == null ? '—' : `${formatPortalNumber(r.confirmRate)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {stats.reviewModerationBySource.length > 0 && (
              <p className="mt-2 text-[11px] text-slate-500">
                {translatePortalText('Review moderation')}: {stats.reviewModerationBySource.map(s =>
                  `${translatePortalText(s.source === 'wordlist' ? 'word list' : s.source === 'ai' ? 'AI model' : s.source)} ${s.confirmRate == null ? '—' : `${s.confirmRate}%`}`).join(' · ')}
              </p>
            )}
          </div>
        )}
      </section>

      <section className="card p-5">
        <Head title="AI assistance" sub="The AI never decides a case. It screens chats the patterns miss and gives a second opinion on every new case; you still confirm or clear." />
        <div className="grid gap-3 sm:grid-cols-2">
          {([
            ['chatScreening', 'AI chat screening', 'Messages that mention money, prices, contact or "outside the app" are read by the AI with the messages before them, to catch side deals no word list can.'],
            ['secondOpinion', 'AI second opinion on every case', 'Each new case gets a short likely-fraud / likely-innocent view with the reason — for example spotting that "[TEST]" listings are deliberate.'],
          ] as const).map(([key, title, desc]) => (
            <div key={key} className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 p-3">
              <div>
                <p className="text-[13px] font-bold text-deep-900">{translatePortalText(title)}</p>
                <p className="mt-0.5 text-[11.5px] text-slate-500">{translatePortalText(desc)}</p>
              </div>
              <Toggle on={settings.ai[key]} onChange={v => void save('ai', { ai: { ...settings.ai, [key]: v } })} />
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11.5px] text-slate-500">
          {translatePortalText('Admins agreed with the AI')}{' '}
          <b className={stats?.aiAgreement?.rate == null ? 'text-slate-400' : stats.aiAgreement.rate < 60 ? 'text-rose-600' : 'text-emerald-600'}>
            {stats?.aiAgreement?.rate == null ? translatePortalText('— not enough decided cases yet') : `${formatPortalNumber(stats.aiAgreement.rate)}%`}
          </b>
          {stats?.aiAgreement && stats.aiAgreement.rate != null && ` (${formatPortalNumber(stats.aiAgreement.agreed)} / ${formatPortalNumber(stats.aiAgreement.agreed + stats.aiAgreement.disagreed)})`}
          {' · '}{translatePortalText('Both need Fraud detection on in AI Management and an OpenAI key on the server.')}
        </p>
      </section>

      <section className="card p-5">
        <Head title="Risk score thresholds" sub="Where the provider risk score starts to bite. Warning must stay below the other two." />
        <div className="grid gap-3 sm:grid-cols-3">
          <Num label="Warning" hint="Provider is warned and listed for admins" value={t.WARNING} onChange={v => setT('WARNING', v)} />
          <Num label="Cash withdrawn" hint="Cash bookings switched off automatically" value={t.CASH_WITHDRAWN} onChange={v => setT('CASH_WITHDRAWN', v)} />
          <Num label="Review case" hint="A case is opened for an admin" value={t.REVIEW} onChange={v => setT('REVIEW', v)} />
        </div>
        <SaveBtn busy={saving === 'thresholds'} onClick={() => void save('thresholds', { thresholds: t })} />
      </section>

      <section className="card p-5">
        <Head title="Detector limits" sub="When a pattern becomes a case." />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Num label="Chat contact messages" hint="In 30 days, before a case" value={d.chatContactThreshold} onChange={v => setD('chatContactThreshold', v)} />
          <Num label="Abusive chat messages" hint="In 30 days, before a case" value={d.chatAbuseThreshold} onChange={v => setD('chatAbuseThreshold', v)} />
          <Num label="Review ring size" hint="5★ reviews from new accounts" value={d.reviewRingCount} onChange={v => setD('reviewRingCount', v)} />
          <Num label="Review ring window (days)" value={d.reviewRingWindowDays} onChange={v => setD('reviewRingWindowDays', v)} />
          <Num label="New account (days)" hint="Younger than this counts as new" value={d.newAccountDays} onChange={v => setD('newAccountDays', v)} />
          <Num label="Price floor (% of median)" hint="Cheaper than this is flagged" value={Math.round(d.priceFloorRatio * 100)} onChange={v => setD('priceFloorRatio', v / 100)} />
          <Num label="Comparable trips needed" value={d.priceMinComparables} onChange={v => setD('priceMinComparables', v)} />
          <Num label="Photo match tolerance (bits)" hint="0 = identical only, 16 = loose" value={d.photoHashDistance} onChange={v => setD('photoHashDistance', v)} />
        </div>
        <SaveBtn busy={saving === 'detectors'} onClick={() => void save('detectors', { detectors: d })} />
      </section>

      <section className="card p-5">
        <Head title="Moderation words" sub="Added to the built-in English, Arabic and Arabizi list for reviews and chats. Arabic prefixes (و، ال، ب) are matched automatically." />
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText('Also flag')}</p>
            <div className="flex gap-2">
              <input className="input !mt-0 flex-1 !text-[12px]" value={newTerm} maxLength={60} onChange={e => setNewTerm(e.target.value)} placeholder={translatePortalText('Word or phrase')} />
              <select className="input !mt-0 !w-auto !text-[12px]" value={newSeverity} onChange={e => setNewSeverity(e.target.value as typeof newSeverity)}>
                {(['Medium', 'High', 'Critical'] as const).map(s => <option key={s} value={s}>{translatePortalText(s)}</option>)}
              </select>
              <button disabled={!newTerm.trim()} onClick={() => {
                const next = { ...m, extraTerms: [...m.extraTerms.filter(x => x.term !== newTerm.trim().toLowerCase()), { term: newTerm.trim().toLowerCase(), severity: newSeverity }] }
                setNewTerm('')
                void save('words', { moderation: next })
              }} className="btn-admin !px-3 disabled:opacity-40"><Plus size={13} /></button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {m.extraTerms.length === 0 && <p className="text-xs text-slate-400">{translatePortalText('None added.')}</p>}
              {m.extraTerms.map(x => (
                <span key={x.term} className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                  {x.term} <span className="text-[9px] opacity-70">{translatePortalText(x.severity)}</span>
                  <button onClick={() => void save('words', { moderation: { ...m, extraTerms: m.extraTerms.filter(y => y.term !== x.term) } })}><Trash2 size={10} /></button>
                </span>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText('Never flag')}</p>
            <div className="flex gap-2">
              <input className="input !mt-0 flex-1 !text-[12px]" value={newAllow} maxLength={60} onChange={e => setNewAllow(e.target.value)} placeholder={translatePortalText('e.g. a place or boat name that trips the list')} />
              <button disabled={!newAllow.trim()} onClick={() => {
                const next = { ...m, allowTerms: [...new Set([...m.allowTerms, newAllow.trim().toLowerCase()])] }
                setNewAllow('')
                void save('words', { moderation: next })
              }} className="btn-admin !px-3 disabled:opacity-40"><Plus size={13} /></button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {m.allowTerms.length === 0 && <p className="text-xs text-slate-400">{translatePortalText('None added.')}</p>}
              {m.allowTerms.map(x => (
                <span key={x} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                  {x}
                  <button onClick={() => void save('words', { moderation: { ...m, allowTerms: m.allowTerms.filter(y => y !== x) } })}><Trash2 size={10} /></button>
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

function Head({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-3">
      <h3 className="font-display text-[15px] font-extrabold text-deep-900">{translatePortalText(title)}</h3>
      <p className="text-[11.5px] text-slate-400">{translatePortalText(sub)}</p>
    </div>
  )
}

function Num({ label: l, hint, value, onChange }: { label: string; hint?: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText(l)}</span>
      <input type="number" className="input !mt-0" value={Number.isFinite(value) ? value : ''} onChange={e => onChange(Number(e.target.value))} />
      {hint && <span className="mt-0.5 block text-[10.5px] text-slate-400">{translatePortalText(hint)}</span>}
    </label>
  )
}

function SaveBtn({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <div className="mt-3 flex justify-end">
      <button disabled={busy} onClick={onClick} className="btn-admin !text-[12px] disabled:opacity-40">
        {busy ? <Spinner size={12} /> : <Save size={13} />} {translatePortalText('Save')}
      </button>
    </div>
  )
}
