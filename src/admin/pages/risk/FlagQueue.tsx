import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { RefreshCw, Check, UserCheck, UserX, StickyNote, History, Gavel, Sparkles } from 'lucide-react'
import { confirmAndRun } from '../../../async'
import { Modal, toast, Spinner, Avatar } from '../../../ui'
import { fileUrl, riskApi, type ContentFlag, type ContentFlagCounts, type ContentFlagKind } from '../../../api'
import { translatePortalText, formatPortalNumber } from '../../../i18n/runtime'
import { KIND_META, FLAG_KINDS, CUSTOMER_KINDS, SEVERITY_STYLE, FlagEvidence, AiOpinionStrip, label, nameOf, roleLabel, when } from './riskShared'

/**
 * A Risk & Fraud queue: the "Flagged" tab (content and detector findings) or
 * the "Customers" tab (customer abuse). Same case model, same handling —
 * take it, note it, decide it once — with the kind deciding what confirm and
 * clear actually do (see `KIND_META`).
 */
export function FlagQueue({ group, onCounts }: { group: 'flags' | 'customers'; onCounts: (c: ContentFlagCounts) => void }) {
  const kinds = group === 'customers' ? CUSTOMER_KINDS : FLAG_KINDS
  const [kind, setKind] = useState<ContentFlagKind | ''>('')
  const [state, setState] = useState<'open' | 'resolved'>('open')
  const [mine, setMine] = useState(false)
  const [ai, setAi] = useState<'' | 'likely_fraud' | 'likely_innocent' | 'unclear' | 'none'>('')
  const [items, setItems] = useState<ContentFlag[]>([])
  const [counts, setCounts] = useState<ContentFlagCounts | null>(null)
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const load = async () => {
    setLoading(true)
    try {
      const res = await riskApi.flags({ group, kind: kind || undefined, state, mine: mine || undefined, ai: ai || undefined, limit: 100 })
      setItems(res.data.items)
      setCounts(res.data.counts)
      onCounts(res.data.counts)
      // Keep only selections that are still on screen and still undecided.
      setSelected(prev => new Set([...prev].filter(id => res.data.items.some(f => f._id === id && isOpen(f)))))
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not load the queue'), 'warn')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { setSelected(new Set()); void load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [group, kind, state, mine, ai])

  const unreviewed = counts?.openByAi?.none ?? 0
  const askBacklog = async () => {
    try {
      const res = await riskApi.aiReviewBacklog()
      toast(translatePortalText(`The AI is reviewing ${res.data.queued} case(s) — opinions appear as they finish`))
      // Opinions arrive over the next minute or two; refresh once partway through.
      setTimeout(() => { void load() }, 20_000)
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'The AI is not available'), 'warn')
    }
  }

  const openItems = items.filter(isOpen)
  const allSelected = openItems.length > 0 && openItems.every(f => selected.has(f._id))
  const toggle = (id: string) => setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })

  /**
   * Deciding a batch — clearing a run of seeded or test listings is the usual
   * reason. The dialog says how many cases and of what, because a bulk confirm
   * can pause dozens of listings at once.
   */
  const decideSelected = async (decision: 'confirm' | 'clear') => {
    const chosen = items.filter(f => selected.has(f._id))
    if (!chosen.length) return
    const kindsChosen = [...new Set(chosen.map(f => f.kind))]
    const oneKind = kindsChosen.length === 1 ? KIND_META[kindsChosen[0]] : undefined
    const needsNote = decision === 'confirm' && chosen.some(f => KIND_META[f.kind]?.confirmNoteRequired)
    await confirmAndRun({
      title: translatePortalText(`${translatePortalText(decision === 'confirm' ? (oneKind?.confirm ?? 'Confirm') : (oneKind?.clear ?? 'Clear'))} — ${chosen.length} case${chosen.length === 1 ? '' : 's'}?`),
      body: translatePortalText(oneKind
        ? (decision === 'confirm' ? oneKind.confirmBody : oneKind.clearBody)
        : `Each case is decided as if you opened it: ${decision === 'confirm' ? 'confirming' : 'clearing'} does what that kind of case does.`),
      danger: decision === 'confirm',
      confirmLabel: translatePortalText(decision === 'confirm' ? 'Confirm all' : 'Clear all'),
      busyLabel: translatePortalText('Saving…'),
      input: {
        label: translatePortalText(needsNote ? 'Reason shown to the owners' : 'Note for the record (optional)'),
        placeholder: translatePortalText('e.g. Seeded test listings — prices are deliberate.'),
        required: needsNote,
        multiline: true,
        maxLength: 500,
      },
      success: translatePortalText(decision === 'confirm' ? 'Cases confirmed' : 'Cases cleared'),
      run: async note => {
        const res = await riskApi.decideFlags(chosen.map(f => f._id), decision, note.trim() || undefined)
        if (res.data.failed.length) toast(translatePortalText(`${res.data.failed.length} could not be decided: ${translatePortalText(res.data.failed[0].error)}`), 'warn')
        setSelected(new Set())
        await load()
      },
    })
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <Chip on={kind === ''} onClick={() => setKind('')}>{translatePortalText('All')}</Chip>
        {kinds.map(k => {
          const n = counts?.openByKind?.[k] ?? 0
          return (
            <Chip key={k} on={kind === k} onClick={() => setKind(k)}>
              {translatePortalText(KIND_META[k]?.label ?? k)}{n ? <span className="ms-1 rounded-full bg-rose-500 px-1.5 text-[9px] text-white">{formatPortalNumber(n)}</span> : null}
            </Chip>
          )
        })}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <Chip dark on={state === 'open'} onClick={() => setState('open')}>{translatePortalText('To decide')}</Chip>
        <Chip dark on={state === 'resolved'} onClick={() => setState('resolved')}>{translatePortalText('Decided')}</Chip>
        <span className="mx-1 h-4 w-px bg-slate-200" />
        <Chip dark on={mine} onClick={() => setMine(!mine)}>{translatePortalText('Assigned to me')}</Chip>
        {state === 'open' && (
          <>
            <span className="mx-1 h-4 w-px bg-slate-200" />
            {([['', 'Any AI view'], ['likely_fraud', 'AI: likely fraud'], ['likely_innocent', 'AI: likely innocent'], ['unclear', 'AI: unclear'], ['none', 'Not reviewed by AI']] as const).map(([k, l]) => {
              const n = k ? counts?.openByAi?.[k] ?? 0 : 0
              return (
                <Chip key={k || 'any'} on={ai === k} onClick={() => setAi(k)}>
                  {translatePortalText(l)}{k && n ? <span className="ms-1 opacity-70">{formatPortalNumber(n)}</span> : null}
                </Chip>
              )
            })}
            {unreviewed > 0 && (
              <button onClick={() => void askBacklog()} className="btn-ghost !py-1.5 !px-3 !text-[11px]">
                <Sparkles size={12} /> {translatePortalText(`Get AI opinions (${unreviewed})`)}
              </button>
            )}
          </>
        )}
        {openItems.length > 0 && (
          <label className="ms-2 inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-bold text-slate-500">
            <input type="checkbox" className="h-3.5 w-3.5 accent-ocean-600" checked={allSelected}
              onChange={() => setSelected(allSelected ? new Set() : new Set(openItems.map(f => f._id)))} />
            {translatePortalText(`Select all ${openItems.length}`)}
          </label>
        )}
        <button onClick={() => void load()} className="btn-ghost ms-auto !py-1.5 !px-3 !text-[11px]">
          <RefreshCw size={12} /> {translatePortalText('Refresh')}
        </button>
      </div>

      {selected.size > 0 && (
        <div className="sticky top-2 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-deep-900 px-4 py-2.5 text-white shadow-lift">
          <span className="text-[12px] font-bold">{translatePortalText(`${selected.size} selected`)}</span>
          <button onClick={() => setSelected(new Set())} className="text-[11px] text-white/60 underline">{translatePortalText('Unselect')}</button>
          <div className="ms-auto flex gap-2">
            <button onClick={() => void decideSelected('clear')} className="rounded-lg bg-white/10 px-3 py-1.5 text-[11px] font-bold hover:bg-white/20">
              <Check size={12} className="inline" /> {translatePortalText('Clear selected')}
            </button>
            <button onClick={() => void decideSelected('confirm')} className="rounded-lg bg-rose-600 px-3 py-1.5 text-[11px] font-bold hover:bg-rose-700">
              {translatePortalText('Confirm selected')}
            </button>
          </div>
        </div>
      )}

      {loading && items.length === 0 && <div className="flex justify-center py-16"><Spinner /></div>}
      {!loading && items.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-200 py-14 text-center text-sm text-slate-400">
          {translatePortalText(state === 'open' ? 'Nothing to decide right now.' : 'No decided cases yet.')}
        </div>
      )}

      <div className="space-y-3">
        {items.map((f, i) => (
          <FlagCard key={f._id} flag={f} index={i} selected={selected.has(f._id)} onSelect={() => toggle(f._id)}
            onOpen={() => setOpenId(f._id)} onChanged={load} />
        ))}
      </div>

      <CaseDrawer id={openId} onClose={() => setOpenId(null)} onChanged={load} />
    </div>
  )
}

function Chip({ on, dark, onClick, children }: { on: boolean; dark?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-[11px] font-bold ring-1 transition ${
        on ? (dark ? 'bg-deep-900 text-white ring-deep-900' : 'bg-ocean-500 text-white ring-ocean-500') : 'bg-white text-slate-500 ring-slate-200 hover:ring-slate-300'
      }`}>
      {children}
    </button>
  )
}

const isOpen = (f: ContentFlag) => f.status === 'Open' || f.status === 'Investigating'

/** Asks for the note (required when the owner will read it) and runs the decision. */
export async function decide(flag: ContentFlag, decision: 'confirm' | 'clear', after: () => Promise<void> | void) {
  const meta = KIND_META[flag.kind]
  const confirm = decision === 'confirm'
  await confirmAndRun({
    title: `${translatePortalText(confirm ? meta?.confirm ?? 'Confirm' : meta?.clear ?? 'Clear')}?`,
    body: translatePortalText(confirm ? meta?.confirmBody ?? '' : meta?.clearBody ?? ''),
    danger: confirm,
    confirmLabel: translatePortalText(confirm ? meta?.confirm ?? 'Confirm' : meta?.clear ?? 'Clear'),
    busyLabel: translatePortalText('Saving…'),
    input: {
      label: translatePortalText(confirm && meta?.confirmNoteLabel ? meta.confirmNoteLabel : 'Note for the record (optional)'),
      placeholder: translatePortalText('What you checked, and why you decided this way.'),
      required: confirm && !!meta?.confirmNoteRequired,
      multiline: true,
      maxLength: 500,
    },
    success: translatePortalText(confirm ? 'Confirmed' : 'Cleared'),
    run: async note => {
      await riskApi.decideFlag(flag._id, decision, note.trim() || undefined)
      await after()
    },
  })
}

function FlagCard({ flag: f, index, selected, onSelect, onOpen, onChanged }: {
  flag: ContentFlag; index: number; selected: boolean; onSelect: () => void; onOpen: () => void; onChanged: () => Promise<void>
}) {
  const meta = KIND_META[f.kind]
  const who = nameOf(f.user) || translatePortalText('Unknown account')
  const open = isOpen(f)
  const assignee = nameOf(f.assignedTo)
  const serious = f.severity === 'Critical' || f.severity === 'High'

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * 0.03, 0.3) }}
      className={`card p-4 ${selected ? 'ring-2 ring-ocean-400' : open && f.severity === 'Critical' ? 'ring-1 ring-rose-200' : ''}`}>
      <div className="flex flex-wrap items-start gap-3">
        {open ? (
          <input type="checkbox" aria-label={translatePortalText('Select')} checked={selected} onChange={onSelect}
            className="mt-3 h-4 w-4 shrink-0 cursor-pointer accent-ocean-600" />
        ) : <span className="w-4" />}
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${meta?.tone ?? 'bg-slate-100 text-slate-500'}`}>{meta?.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[14px] font-extrabold text-deep-900">{f.title}</p>
            {/* Only the levels worth reading are shown; "Medium" on every card is noise. */}
            {serious && <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${SEVERITY_STYLE[f.severity]}`}>{translatePortalText(f.severity === 'Critical' ? 'Urgent' : 'Important')}</span>}
            {f.status === 'Investigating' && <span className="rounded-full bg-ocean-50 px-2 py-0.5 text-[10px] font-bold text-ocean-700 ring-1 ring-ocean-200">{assignee ? `${assignee} ${translatePortalText('is on it')}` : translatePortalText('Being looked at')}</span>}
            {!open && (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${f.status === 'Blocked' ? 'bg-slate-100 text-slate-600 ring-slate-200' : 'bg-emerald-50 text-emerald-600 ring-emerald-200'}`}>
                {translatePortalText(f.status === 'Blocked' ? 'Confirmed' : 'Cleared')}
              </span>
            )}
            {f.appeal && (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${f.appeal.status === 'pending' ? 'bg-violet-50 text-violet-700 ring-violet-200' : 'bg-slate-50 text-slate-500 ring-slate-200'}`}>
                {translatePortalText(f.appeal.status === 'pending' ? 'Appealed' : `Appeal ${f.appeal.status}`)}
              </span>
            )}
          </div>
          <p className="mt-1 text-[12.5px] text-slate-600">{f.desc}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
            <span className="font-semibold text-slate-500">{translatePortalText(meta?.label ?? f.kind)}</span>
            <span>·</span>
            <Avatar name={who} src={f.user?.avatar ? fileUrl(f.user.avatar) : undefined} size={16} />
            <span className="font-semibold text-slate-600">{who}</span>
            {f.user?.role && <span>({translatePortalText(roleLabel(f.user.role))})</span>}
            {f.user?.isActive === false && <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-600">{translatePortalText('Account blocked')}</span>}
            <span>· {when(f.createdAt)}</span>
          </div>
          <div className="mt-2.5"><FlagEvidence flag={f} compact /></div>
          {f.evidence?.ai && <div className="mt-2"><AiOpinionStrip flag={f} /></div>}
          {f.evidence?.decisionNote && <p className="mt-2 text-[11px] italic text-slate-500">{translatePortalText('Note')}: {f.evidence.decisionNote}</p>}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 self-center">
          <button onClick={onOpen} className="btn-ghost !py-1.5 !px-3 !text-[11px]"><StickyNote size={12} /> {translatePortalText('Details')}</button>
          {open && (
            <>
              <button onClick={() => void decide(f, 'clear', onChanged)} className="btn-ghost !py-1.5 !px-3 !text-[11px]">
                <Check size={12} /> {translatePortalText(meta?.clear ?? 'Clear')}
              </button>
              <button onClick={() => void decide(f, 'confirm', onChanged)}
                className="rounded-lg bg-rose-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-rose-700">
                {translatePortalText(meta?.confirm ?? 'Confirm')}
              </button>
            </>
          )}
        </div>
      </div>
    </motion.div>
  )
}

/**
 * One case in full: the evidence, who is working it, the notes admins left,
 * and the timeline of everything done to it.
 */
function CaseDrawer({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => Promise<void> }) {
  const [flag, setFlag] = useState<ContentFlag | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async (caseId: string) => {
    try {
      setFlag((await riskApi.flag(caseId)).data.alert)
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not load the case'), 'warn')
    }
  }
  useEffect(() => { setFlag(null); setNote(''); if (id) void load(id) }, [id])

  const act = async (fn: () => Promise<unknown>, done: string) => {
    if (!id) return
    setBusy(true)
    try {
      await fn()
      toast(translatePortalText(done))
      await load(id)
      await onChanged()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'That did not work'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  const open = flag ? isOpen(flag) : false
  return (
    <Modal open={!!id} onClose={onClose} wide title={<span className="flex items-center gap-2"><Gavel size={16} /> {translatePortalText('Details')}</span>}>
      {!flag ? <div className="flex justify-center py-10"><Spinner /></div> : (
        <div className="space-y-4">
          <div>
            <p className="text-[15px] font-extrabold text-deep-900">{flag.title}</p>
            <p className="mt-0.5 text-[12px] text-slate-500">{flag.desc}</p>
            <p className="mt-1 text-[11px] text-slate-400">
              {translatePortalText(KIND_META[flag.kind]?.label ?? flag.kind)} · {translatePortalText(flag.severity)} · {nameOf(flag.user) ?? ''}{flag.user?.email ? ` (${flag.user.email})` : ''}
            </p>
          </div>

          <FlagEvidence flag={flag} />

          <AiOpinionStrip flag={flag} asking={busy}
            onAsk={() => void act(() => riskApi.aiReview(flag._id), 'The AI gave its opinion')} />

          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-sand px-3 py-2 text-[12px]">
            <span className="text-slate-500">{translatePortalText('Assigned to')}:</span>
            <b className="text-deep-900">{nameOf(flag.assignedTo) ?? translatePortalText('Nobody yet')}</b>
            {open && (
              <div className="ms-auto flex gap-1.5">
                <button disabled={busy} onClick={() => void act(() => riskApi.assignFlag(flag._id, 'me'), 'Assigned to you')} className="btn-ghost !py-1 !px-2.5 !text-[11px]"><UserCheck size={12} /> {translatePortalText('Assign to me')}</button>
                {flag.assignedTo && <button disabled={busy} onClick={() => void act(() => riskApi.assignFlag(flag._id, 'none'), 'Unassigned')} className="btn-ghost !py-1 !px-2.5 !text-[11px]"><UserX size={12} /> {translatePortalText('Unassign')}</button>}
              </div>
            )}
          </div>

          {flag.appeal && (
            <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-3 text-[12px]">
              <p className="font-bold text-violet-800">{translatePortalText(`Appeal — ${flag.appeal.status}`)} · {when(flag.appeal.at)}</p>
              <p className="mt-1 text-slate-700">{flag.appeal.text}</p>
              {flag.appeal.response && <p className="mt-1 text-slate-500">{translatePortalText('Answer')}: {flag.appeal.response}</p>}
            </div>
          )}

          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400"><StickyNote size={12} /> {translatePortalText('Notes')}</p>
            <div className="max-h-40 space-y-1.5 overflow-y-auto">
              {(flag.notes ?? []).length === 0 && <p className="text-xs text-slate-400">{translatePortalText('No notes yet.')}</p>}
              {(flag.notes ?? []).map((n, j) => (
                <div key={j} className="rounded-lg border border-slate-100 px-2.5 py-1.5 text-[12px]">
                  <p className="text-slate-700">{n.text}</p>
                  <p className="text-[10px] text-slate-400">{nameOf(n.by) ?? ''} · {when(n.at)}</p>
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <textarea className="input min-h-[56px] flex-1 !text-[12px]" maxLength={2000} value={note} onChange={e => setNote(e.target.value)}
                placeholder={translatePortalText('Add a note for the other admins…')} />
              <button disabled={busy || !note.trim()} onClick={() => void act(async () => { await riskApi.addFlagNote(flag._id, note.trim()); setNote('') }, 'Note added')}
                className="btn-admin !px-3 !text-[11px] disabled:opacity-40">{translatePortalText('Add')}</button>
            </div>
          </div>

          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400"><History size={12} /> {translatePortalText('Timeline')}</p>
            <div className="space-y-1">
              {(flag.history ?? []).map((h, j) => (
                <div key={j} className="flex gap-2 text-[11.5px] text-slate-600">
                  <span className="w-32 shrink-0 text-[10.5px] text-slate-400">{when(h.at)}</span>
                  <span><b className="text-deep-900">{label(h.action)}</b>{nameOf(h.by) ? ` · ${nameOf(h.by)}` : ''}{h.note ? ` — ${h.note}` : ''}</span>
                </div>
              ))}
            </div>
          </div>

          {open && (
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
              <button disabled={busy} onClick={() => void decide(flag, 'clear', async () => { await load(flag._id); await onChanged() })} className="btn-ghost !text-[12px]">
                <Check size={13} /> {translatePortalText(KIND_META[flag.kind]?.clear ?? 'Clear')}
              </button>
              <button disabled={busy} onClick={() => void decide(flag, 'confirm', async () => { await load(flag._id); await onChanged() })}
                className="rounded-lg bg-rose-600 px-3.5 py-2 text-[12px] font-bold text-white hover:bg-rose-700">
                {translatePortalText(KIND_META[flag.kind]?.confirm ?? 'Confirm')}
              </button>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
