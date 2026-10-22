import React, { useState, useEffect, useMemo, useRef } from 'react'
import { TableToolbar, useTableFilters, NoFilterMatches, type TableFiltersConfig } from '../../shared/TableFilters'
import { motion } from 'framer-motion'
import { Star, Headset, Bell, Siren, Trash2, MessageCircle, Flag, Check, Send, Megaphone, Phone, EyeOff, RotateCcw, Loader2, RefreshCw } from 'lucide-react'
import { PageWrap, seededAvatar, reviewTargetLabel } from './_shared'
import { Section, Modal, toast, Stars, Counter, downloadCsv } from '../../ui'
import { confirmAndRun, errorMessage } from '../../async'
import { AdminHeader, ABadge } from '../adminUi'
import { SupportConsole } from '../../shared/SupportConsole'
import { AdminOutreach } from './AdminOutreach'
import { adminPortalApi, reviewsApi, type ApiAdminEmergency, type ApiReview, type ApiNotification } from '../../api'
import { isPortalArabic, translatePortalText  , formatPortalDate, formatPortalNumber, formatPortalPercent} from '../../i18n/runtime'

// ── Emergency monitor — mapped from the real platform-wide Emergency record ──
// The real model has no map coordinates or resolver dispatch info, so the UI
// below is a status-driven list rather than the old radar/pixel-position mock.
const emergencyKindMeta: Record<string, { label: string; icon: string }> = {
  sos: { label: 'SOS distress call', icon: '🆘' },
  medical: { label: 'Medical emergency', icon: '🚑' },
  coast_guard: { label: 'Coast guard assist', icon: '🛟' },
}
const emergencyStatusLabels: Record<string, 'Active' | 'Responding' | 'Resolved'> = { active: 'Active', responding: 'Responding', resolved: 'Resolved' }

// `message`, `phone` and the raw coordinates were returned by the API and never
// shown — on an SOS, what the person said and a number to call them back on are
// the first two things a responder asks for.
interface UiEmergency { id: string; boat: string; kind: string; icon: string; location: string; lat: number; lng: number; status: 'Active' | 'Responding' | 'Resolved'; time: string; createdAt: string; responder: string; message?: string; phone?: string; email?: string }
const mapEmergency = (e: ApiAdminEmergency): UiEmergency => {
  const meta = emergencyKindMeta[e.type] || { label: e.type, icon: '🚨' }
  const reporter = typeof e.user === 'object' && e.user ? e.user : undefined
  const resolver = typeof e.resolvedBy === 'object' && e.resolvedBy ? e.resolvedBy.name : undefined
  return {
    id: e.id || e._id,
    boat: reporter?.name || translatePortalText('Unknown reporter'),
    kind: translatePortalText(meta.label),
    icon: meta.icon,
    location: `${formatPortalNumber(e.latitude, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}, ${formatPortalNumber(e.longitude, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`,
    lat: e.latitude,
    lng: e.longitude,
    status: emergencyStatusLabels[e.status] || 'Active',
    time: e.createdAt ? formatPortalDate(new Date(e.createdAt), { dateStyle: 'medium', timeStyle: 'short' }) : translatePortalText('Unknown'),
    createdAt: e.createdAt || '',
    responder: resolver ? `${translatePortalText('Resolved by')} ${resolver}` : e.status === 'responding' ? translatePortalText('Response team engaged') : translatePortalText('Awaiting dispatch'),
    message: e.message?.trim() || undefined,
    phone: reporter?.phone || undefined,
    email: reporter?.email || undefined,
  }
}

/**
 * Every review matching `params`, not the first page of them.
 *
 * The API caps a page at 100. The master queue asked for 200 and got 100, the
 * customers' page asked for 100 — and both computed "Total reviews", the
 * average and the tab counts from that one page, so past 100 reviews every
 * figure on the board was quietly wrong and the rest of the reviews could not
 * be reached at all. Pages are fetched until `total` is reached, with a ceiling
 * so a runaway collection cannot hang the browser; `total` is returned so the
 * caller can say when it stopped short.
 */
const REVIEW_PAGE = 100
const REVIEW_MAX_PAGES = 30
export async function loadAllReviews(params: Record<string, string | number | boolean | undefined> = {}): Promise<{ items: ApiReview[]; total: number }> {
  const first = await adminPortalApi.reviews({ ...params, page: 1, limit: REVIEW_PAGE })
  const items = [...first.data.items]
  const total = first.data.pagination?.total ?? items.length
  const pages = Math.min(first.data.pagination?.totalPages ?? 1, REVIEW_MAX_PAGES)
  for (let page = 2; page <= pages; page++) {
    const res = await adminPortalApi.reviews({ ...params, page, limit: REVIEW_PAGE })
    items.push(...res.data.items)
  }
  // A review moderated between two page reads can appear on both.
  const seen = new Set<string>()
  return { items: items.filter(r => (seen.has(r.id) ? false : (seen.add(r.id), true))), total }
}

/** "Showing 3,000 of 3,412" — only when the ceiling above was hit. */
export function ReviewsTruncatedNote({ shown, total }: { shown: number; total: number }) {
  if (total <= shown) return null
  return (
    <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
      {translatePortalText('Showing')} {formatPortalNumber(shown)} {translatePortalText('of')} {formatPortalNumber(total)} {translatePortalText('reviews — the figures above cover only the ones shown.')}
    </p>
  )
}

// ══════════ REVIEWS & MODERATION (§14) — shared building blocks ══════════
// Reused by the global Super Admin queue AND each provider vertical's own Reviews page.
export function ReviewStatCards({ reviews }: { reviews: ApiReview[] }) {
  const rated = reviews.filter(r => r.rating > 0)
  const avg = rated.length ? Number((rated.reduce((s, r) => s + r.rating, 0) / rated.length).toFixed(1)) : 0
  const stats: [string, number, string, number?][] = [
    ['Avg rating', avg, '⭐', 1],
    ['Total reviews', reviews.length, '📝'],
    // The moderation state, as the board's "Flagged" tab counts it. The legacy
    // `reported` boolean stays true after a take-down, so this tile counted
    // taken-down reviews as flagged and never matched the tab beneath it.
    ['Flagged', reviews.filter(r => (r.moderation?.status ?? (r.reported ? 'under_review' : 'visible')) === 'under_review').length, '🧿'],
    ['Replied', reviews.filter(r => !!r.reply).length, '💬'],
  ]
  return (
    <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
      {stats.map(([l, v, icon, dec], i) => (
        <motion.div key={l} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="card p-4 flex items-center gap-3">
          <span className="text-2xl">{icon}</span>
          <div><p className="font-display text-2xl font-extrabold text-deep-900"><Counter value={v} decimals={dec || 0} /></p><p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText(l)}</p></div>
        </motion.div>
      ))}
    </div>
  )
}

function ReviewCard({ r, i, onDelete, onFlag, onApprove, onReply, onTakedown, onRestore }: {
  r: ApiReview; i: number
  onDelete?: (id: string) => void; onFlag?: (id: string) => void; onApprove?: (id: string) => void; onReply?: (r: ApiReview) => void
  onTakedown?: (r: ApiReview) => void; onRestore?: (id: string) => void
}) {
  const author = typeof r.author === 'object' ? r.author : null
  const target = reviewTargetLabel(r)
  const status = r.moderation?.status ?? (r.reported ? 'under_review' : 'visible')
  const hidden = status === 'hidden'
  const flagged = status === 'under_review'
  const reports = r.moderation?.reportCount ?? 0
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
      className={`card flex flex-wrap items-start gap-4 p-4 ${hidden ? 'ring-1 ring-rose-200 bg-rose-50/40' : flagged ? 'ring-1 ring-orange-200' : ''}`}>
      {/* Dimmed while taken down, so the queue reads at a glance without having
          to check each badge. */}
      <img src={author?.avatar || seededAvatar(r.id)} className={`h-11 w-11 shrink-0 rounded-full object-cover ${hidden ? 'opacity-40 grayscale' : ''}`} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[14px] font-extrabold text-deep-900">{author?.name || translatePortalText('Unknown')}</p>
          <span className="text-[11px] text-slate-400">→ {target.icon} {target.text} · {formatPortalDate(new Date(r.createdAt))}</span>
          <Stars n={r.rating} size={12} />
          {reports > 0 && <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-bold text-orange-600">{formatPortalNumber(reports)} {translatePortalText(reports > 1 ? 'reports' : 'report')}</span>}
        </div>
        <p className={`mt-1 text-sm ${hidden ? 'text-slate-400 line-through' : 'text-slate-600'}`}>{r.comment || `(${translatePortalText('no comment')})`}</p>
        {r.reply && <p className="mt-2 rounded-lg bg-sand p-2 text-[11px] text-slate-500"><b className="text-deep-800">{translatePortalText("Provider reply:")} </b>{r.reply.text}</p>}
        {/* Why it went, and when — the record a dispute is answered from. */}
        {hidden && r.moderation?.reason && (
          <p className="mt-2 rounded-lg bg-rose-50 p-2 text-[11px] text-rose-700">
            <b>{translatePortalText("Taken down:")} </b>{r.moderation.reason}
            {r.moderation.hiddenAt && <span className="text-rose-700 dark:text-rose-400"> · {formatPortalDate(new Date(r.moderation.hiddenAt))}</span>}
          </p>
        )}
        {r.reportReason && !hidden && (
          <p className="mt-2 rounded-lg bg-orange-50 p-2 text-[11px] text-orange-700"><b>{translatePortalText("Reported:")} </b>{r.reportReason}</p>
        )}
      </div>
      <ABadge dot={status === 'visible'}>{translatePortalText(hidden ? 'Taken down' : flagged ? 'Flagged' : 'Live')}</ABadge>
      <div className="flex gap-1.5">
        <button onClick={() => onReply?.(r)} className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200" title={translatePortalText("Reply")}><MessageCircle size={13} /></button>
        {hidden ? (
          <button onClick={() => onRestore?.(r.id)} className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100" title={translatePortalText("Restore — make public again")}><RotateCcw size={13} /></button>
        ) : (
          <>
            {flagged
              ? <button onClick={() => onApprove?.(r.id)} className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100" title={translatePortalText("Clear the report — leave it public")}><Check size={13} /></button>
              : <button onClick={() => onFlag?.(r.id)} className="grid h-8 w-8 place-items-center rounded-lg bg-orange-50 text-orange-500 hover:bg-orange-100" title={translatePortalText("Flag for review")}><Flag size={13} /></button>}
            {/* The take-down sits before delete because it is the action to
                reach for: it is reversible and keeps the record. */}
            <button onClick={() => onTakedown?.(r)} className="grid h-8 w-8 place-items-center rounded-lg bg-rose-50 text-rose-500 hover:bg-rose-100" title={translatePortalText("Take down — hide from the public")}><EyeOff size={13} /></button>
          </>
        )}
        <button onClick={() => onDelete?.(r.id)} className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-slate-400 hover:bg-rose-100 hover:text-rose-500" title={translatePortalText("Delete permanently — cannot be undone")}><Trash2 size={13} /></button>
      </div>
    </motion.div>
  )
}

/**
 * Filters read the moderation state, not the old `reported` boolean.
 *
 * `moderation.status` is what the public listings and every star average
 * actually filter on, so it is the only thing that tells a moderator whether a
 * review is live. The board had no way to see a taken-down review at all, which
 * meant no way to put one back.
 */
const modStatus = (r: ApiReview): 'visible' | 'under_review' | 'hidden' =>
  r.moderation?.status ?? (r.reported ? 'under_review' : 'visible')

export function ReviewsBoard({ reviews, emptyLabel, onDelete, onFlag, onApprove, onReply, onTakedown, onRestore }: {
  reviews: ApiReview[]; emptyLabel: string
  onDelete?: (id: string) => void; onFlag?: (id: string) => void; onApprove?: (id: string) => void; onReply?: (r: ApiReview) => void
  onTakedown?: (r: ApiReview) => void; onRestore?: (id: string) => void
}) {
  const [filter, setFilter] = useState('All')
  const counts = {
    All: reviews.length,
    Live: reviews.filter(r => modStatus(r) === 'visible').length,
    Flagged: reviews.filter(r => modStatus(r) === 'under_review').length,
    'Taken down': reviews.filter(r => modStatus(r) === 'hidden').length,
  }
  const list = reviews.filter(r => {
    const st = modStatus(r)
    if (filter === 'All') return true
    if (filter === 'Live') return st === 'visible'
    if (filter === 'Flagged') return st === 'under_review'
    return st === 'hidden'
  })
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {(['All', 'Live', 'Flagged', 'Taken down'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${filter === f ? 'bg-gradient-to-r from-emerald-600 to-teal-500 text-white shadow-glow' : 'bg-white text-slate-500 hover:text-deep-900'}`}>
            {translatePortalText(f)} <span className="opacity-60">{formatPortalNumber(counts[f])}</span>
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {list.map((r, i) => <ReviewCard key={r.id} r={r} i={i} onDelete={onDelete} onFlag={onFlag} onApprove={onApprove} onReply={onReply} onTakedown={onTakedown} onRestore={onRestore} />)}
        {list.length === 0 && <div className="rounded-2xl border border-dashed border-slate-200 py-14 text-center text-sm text-slate-400">{emptyLabel}</div>}
      </div>
    </>
  )
}

/**
 * Asks for the reason before hiding anything.
 *
 * Not a confirm dialog with an optional note: the server refuses a take-down
 * without a reason, because the author is told what it was and an audit entry
 * has to be able to answer "why was this removed" months later.
 */
export function ReviewTakedownModal({ target, onClose, onDone }: {
  target: ApiReview | null; onClose: () => void; onDone: (id: string, reason: string) => void
}) {
  const [reason, setReason] = useState('')
  // A second click while the first request was in flight sent a second
  // take-down, which the server refuses ("already taken down") — so the
  // moderator read "taken down" and "could not take it down" back to back.
  const [busy, setBusy] = useState(false)
  useEffect(() => { setReason(''); setBusy(false) }, [target])
  const presets = ['Abusive or hateful language', 'Not about this booking', 'Personal data in the comment', 'Spam or advertising', 'Suspected fake review']
  const submit = () => {
    if (!target || !reason.trim() || busy) return
    setBusy(true)
    adminPortalApi.takedownReview(target.id, reason.trim())
      .then(() => { toast(translatePortalText('Review taken down'), 'warn'); onDone(target.id, reason.trim()); onClose() })
      // The server's reason — "already taken down" when someone else got there
      // first — rather than a generic failure.
      .catch(e => toast(`${translatePortalText('Could not take the review down')}: ${errorMessage(e)}`, 'warn'))
      .finally(() => setBusy(false))
  }
  return (
    <Modal open={!!target} onClose={onClose} title={`🚫 ${translatePortalText("Take this review down")}`}>
      {target && (
        <div className="space-y-3">
          <p className="rounded-xl bg-sand p-3 text-sm italic text-slate-600">"{target.comment || '(no comment)'}"</p>
          <p className="text-xs text-slate-500">
            {translatePortalText("It stops appearing publicly and stops counting towards ratings straight away. The record is kept, and you can restore it.")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {presets.map(p => (
              // preset loop
              <button key={p} onClick={() => setReason(p)} className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition ${reason === p ? 'bg-rose-600 text-white' : 'bg-white text-slate-500 hover:text-deep-900'}`}>{translatePortalText(p)}</button>
            ))}
          </div>
          {/* The server keeps the first 500 characters; say so here, not afterwards. */}
          <textarea className="input min-h-[80px]" value={reason} maxLength={500} onChange={e => setReason(e.target.value)} placeholder={translatePortalText("Reason (shown to the author)…")} />
          <button onClick={submit} disabled={!reason.trim() || busy} className="btn-admin w-full !justify-center disabled:opacity-50">
            {busy && <Loader2 size={14} className="animate-spin" />}
            {translatePortalText("\r\n            Take down\r\n          ")}</button>
        </div>
      )}
    </Modal>
  )
}

/** Shared reply-composer modal — real PATCH /reviews/:id/reply, not a fake toast. */
export function ReviewReplyModal({ target, onClose, onSent }: { target: ApiReview | null; onClose: () => void; onSent: (id: string, text: string) => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setText(target?.reply?.text || ''); setBusy(false) }, [target])
  const send = () => {
    if (!target || !text.trim() || busy) return
    setBusy(true)
    reviewsApi.reply(target.id, text.trim())
      .then(() => { toast(translatePortalText('Reply sent')); onSent(target.id, text.trim()); onClose() })
      .catch(e => toast(`${translatePortalText('Could not send reply')}: ${errorMessage(e)}`, 'warn'))
      .finally(() => setBusy(false))
  }
  return (
    <Modal open={!!target} onClose={onClose} title={target ? `💬 ${translatePortalText('Reply to')} ${typeof target.author === 'object' && target.author ? target.author.name : translatePortalText('review')}` : ''}>
      {target && (
        <div className="space-y-3">
          <p className="rounded-xl bg-sand p-3 text-sm italic text-slate-600">"{target.comment || '(no comment)'}"</p>
          {/* The reply route has no validator, so the limit lives here. */}
          <textarea className="input min-h-[100px]" value={text} maxLength={1000} onChange={e => setText(e.target.value)} placeholder={translatePortalText("Write a reply…")} />
          <button onClick={send} disabled={!text.trim() || busy} className="btn-admin w-full !justify-center disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} {translatePortalText("Send reply")}
          </button>
        </div>
      )}
    </Modal>
  )
}

/**
 * The moderation actions a reviews page offers, over one list of reviews.
 *
 * One implementation for the master queue, each vertical's reviews page and
 * the customers' one. The vertical pages had wired four of the six — their
 * "Take down" and "Restore" buttons called handlers nobody passed, so they did
 * nothing. `boardProps` goes on `ReviewsBoard`; `modals` renders the reply and
 * take-down dialogs those actions open.
 */
export function useReviewModeration(setReviews: React.Dispatch<React.SetStateAction<ApiReview[]>>) {
  const [replyTarget, setReplyTarget] = useState<ApiReview | null>(null)
  const [takedownTarget, setTakedownTarget] = useState<ApiReview | null>(null)
  const patch = (id: string, fn: (r: ApiReview) => ApiReview) => setReviews(list => list.map(x => (x.id === id ? fn(x) : x)))
  /*
    One request per review at a time. A double-click on the flag button sent
    two reports — the server counts every one, so the review read "2 reports"
    off a single moderator — and a double-click elsewhere raced itself.
  */
  const inFlight = useRef(new Set<string>())
  const once = (id: string, work: () => Promise<unknown>) => {
    if (inFlight.current.has(id)) return
    inFlight.current.add(id)
    void work().finally(() => inFlight.current.delete(id))
  }

  /*
    Erasing was one click on a bin icon whose own tooltip says it cannot be
    undone — no question asked. It now asks, and points at the take-down,
    which is reversible and is what the board recommends.
  */
  const onDelete = (id: string) => {
    if (inFlight.current.has(id)) return
    void confirmAndRun({
      title: 'Delete this review permanently?',
      body: 'The review is erased and cannot be restored, and the ratings it fed are recalculated. To hide it but keep the record, use Take down instead.',
      confirmLabel: 'Delete permanently',
      busyLabel: 'Deleting…',
      danger: true,
      success: 'Review deleted',
      run: async () => {
        inFlight.current.add(id)
        try {
          await adminPortalApi.removeReview(id)
          setReviews(r => r.filter(x => x.id !== id))
        } finally {
          inFlight.current.delete(id)
        }
      },
    })
  }
  // A report moves a live review to `under_review` server-side — shown here
  // too, rather than only setting the legacy `reported` flag the card ignores.
  const onFlag = (id: string) => once(id, () =>
    adminPortalApi.flagReview(id)
      .then(() => {
        toast(translatePortalText('Flagged for review'))
        patch(id, x => ({
          ...x,
          reported: true,
          moderation: { ...(x.moderation ?? {}), status: x.moderation?.status === 'hidden' ? 'hidden' : 'under_review', reportCount: (x.moderation?.reportCount ?? 0) + 1 },
        }))
      })
      .catch(e => toast(`${translatePortalText('Could not flag review')}: ${errorMessage(e)}`, 'warn')))
  const onApprove = (id: string) => once(id, () =>
    adminPortalApi.approveReview(id)
      .then(() => {
        toast(translatePortalText('Report cleared — review stays public'))
        patch(id, x => ({ ...x, reported: false, moderation: { ...(x.moderation ?? {}), status: 'visible' as const, reportCount: 0 } }))
      })
      .catch(e => toast(`${translatePortalText('Could not approve review')}: ${errorMessage(e)}`, 'warn')))
  const onRestore = (id: string) => once(id, () =>
    adminPortalApi.restoreReview(id)
      .then(() => {
        toast(translatePortalText('Review restored'))
        patch(id, x => ({ ...x, reported: false, moderation: { ...(x.moderation ?? {}), status: 'visible' as const, reportCount: 0, reason: undefined, hiddenAt: undefined } }))
      })
      .catch(e => toast(`${translatePortalText('Could not restore review')}: ${errorMessage(e)}`, 'warn')))
  const onTakenDown = (id: string, reason: string) =>
    patch(id, x => ({ ...x, moderation: { ...(x.moderation ?? {}), status: 'hidden' as const, reason, hiddenAt: new Date().toISOString() } }))
  const onReplySent = (id: string, text: string) => patch(id, x => ({ ...x, reply: { text, date: new Date().toISOString() } }))

  return {
    boardProps: { onDelete, onFlag, onApprove, onRestore, onReply: setReplyTarget, onTakedown: setTakedownTarget },
    modals: (
      <>
        <ReviewReplyModal target={replyTarget} onClose={() => setReplyTarget(null)} onSent={onReplySent} />
        <ReviewTakedownModal target={takedownTarget} onClose={() => setTakedownTarget(null)} onDone={onTakenDown} />
      </>
    ),
  }
}

// ══════════ REVIEWS & MODERATION — Super Admin master queue (§14) ══════════
export function AdminReviews() { return <ReviewsPage /> }
function ReviewsPage() {
  const [reviews, setReviews] = useState<ApiReview[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  // A failed load used to toast once and then show the board empty — four
  // tiles reading 0 and "No reviews match this filter", as if there were none.
  const [error, setError] = useState<string | null>(null)
  const load = () => {
    setLoading(true)
    setError(null)
    loadAllReviews()
      .then(res => { setReviews(res.items); setTotal(res.total) })
      .catch(e => setError(errorMessage(e)))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const moderation = useReviewModeration(setReviews)

  return (
    <PageWrap>
      <AdminHeader title={translatePortalText("Reviews & Moderation")} sub={translatePortalText("Cross-platform master queue — every vertical — reply, take down, restore or erase")} icon={<Star className="textemerald-500" />}
        actions={
          /* Was `toast('Rating analytics exported')` and exported nothing.
             Writes the reviews on screen, with the rating distribution the
             button's name promised. */
          <button
            className="btn-ghost"
            onClick={() => {
              if (reviews.length === 0) { toast(translatePortalText('No reviews to export'), 'warn'); return }
              const dist = [5, 4, 3, 2, 1].map(n => [`${n} star`, reviews.filter(r => Math.round(r.rating) === n).length])
              downloadCsv(`review-analytics-${new Date().toISOString().slice(0, 10)}.csv`, [
                ['Rating distribution'],
                ['Rating', 'Reviews'],
                ...dist,
                ['Average', (reviews.reduce((a, r) => a + (r.rating || 0), 0) / reviews.length).toFixed(2)],
                [],
                ['Date', 'Rating', 'Target', 'Author', 'Status', 'Comment'],
                ...reviews.map(r => [
                  (r.createdAt || '').slice(0, 10),
                  r.rating,
                  reviewTargetLabel(r).text,
                  typeof r.author === 'object' && r.author ? r.author.name : '—',
                  r.moderation?.status || 'visible',
                  (r.comment || '').replace(/\s+/g, ' ').slice(0, 300),
                ]),
              ])
              toast(translatePortalText(`Exported ${reviews.length} review${reviews.length === 1 ? '' : 's'}`))
            }}
          >
            {translatePortalText("\r\n            Rating analytics\r\n          ")}</button>
        } />
      {loading ? (
        <div className="card py-14 text-center text-sm text-slate-400">{translatePortalText("Loading reviews…")}</div>
      ) : error ? (
        <div className="card py-14 text-center text-sm text-rose-500">
          {translatePortalText('Could not load reviews')}: {error}{' '}
          <button className="font-bold underline" onClick={load}>{translatePortalText('Retry')}</button>
        </div>
      ) : (<>
        <ReviewStatCards reviews={reviews} />
        <ReviewsTruncatedNote shown={reviews.length} total={total} />
        <ReviewsBoard reviews={reviews} emptyLabel={translatePortalText(reviews.length ? "No reviews match this filter." : "No reviews have been written yet.")} {...moderation.boardProps} />
      </>)}
      {moderation.modals}
    </PageWrap>
  )
}

// ══════════ SUPPORT CENTER (§15) ══════════
export function AdminSupport() { return <SupportPage /> }

/**
 * The platform support desk.
 *
 * This used to read the `SupportTicket` collection, which nothing in the apps
 * ever wrote to: a customer or provider tapping "Contact support" created a
 * *chat* thread, so every ticket raised on the platform landed somewhere this
 * screen could not see, and every reply typed here went into a record the
 * requester's inbox never showed. The two halves are now the same object — a
 * support thread — and `SupportConsole` renders the desk side of it.
 *
 * The legacy ticket endpoints have since been removed — reading a collection
 * nothing writes to, and offering to reply into it, was worse than not offering.
 * The rows themselves are kept; they are the only record of pre-migration tickets.
 */
function SupportPage() {
  const [view, setView] = useState<'queue' | 'messages'>('queue')
  return (
    <PageWrap>
      <AdminHeader
        title={translatePortalText("Support Center")}
        sub={translatePortalText("Answer help requests or contact a person directly.")}
        icon={<Headset className="text-emerald-500" />}
      />
      <div className="mb-5 grid gap-2 sm:grid-cols-2" role="tablist" aria-label={translatePortalText('Support Center sections')}>
        <button type="button" role="tab" aria-selected={view === 'queue'} onClick={() => setView('queue')}
          className={`rounded-2xl border p-4 text-start focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500 ${view === 'queue' ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 bg-white hover:border-emerald-200'}`}>
          <span className="block font-bold text-deep-900">{translatePortalText('Help requests')}</span>
          <span className="mt-1 block text-xs text-slate-500">{translatePortalText('Customers and providers are waiting for a reply from BoatPro.')}</span>
        </button>
        <button type="button" role="tab" aria-selected={view === 'messages'} onClick={() => setView('messages')}
          className={`rounded-2xl border p-4 text-start focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500 ${view === 'messages' ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 bg-white hover:border-emerald-200'}`}>
          <span className="block font-bold text-deep-900">{translatePortalText('Direct messages')}</span>
          <span className="mt-1 block text-xs text-slate-500">{translatePortalText('Start or continue a conversation with a provider, customer or crew member.')}</span>
        </button>
      </div>
      {view === 'queue'
        ? <SupportConsole title={translatePortalText('Help requests')} sub={translatePortalText('Choose a request to read it, reply, or mark it resolved.')} />
        : <AdminOutreach />}
    </PageWrap>
  )
}

// ══════════ NOTIFICATION CENTER (§21) ══════════
const NOTIF_TONE: Record<string, string> = {
  provider_signup: 'warn', document_submitted: 'warn', emergency_sos: 'danger', fraud_alert: 'danger',
  support_ticket: 'warn', payment_success: 'success', payment_refund: 'info', review_received: 'success',
}
const NOTIF_ICON2: Record<string, string> = {
  provider_signup: '🗂️', document_submitted: '🪪', emergency_sos: '🚨', fraud_alert: '🛡️',
  support_ticket: '🎧', payment_success: '💵', payment_refund: '💵', review_received: '⭐',
}
/*
  Who a broadcast can go to — what `POST /admin-portal/announcements` can
  actually target. The audience used to be an uncontrolled <select> whose value
  nothing read, under a first option of "All users (48,212)": a made-up number,
  and whatever was picked, every active account received it. The server takes
  one role or a list of roles, so "All providers" is the four provider roles.
  "Vendors" are directory records, not user accounts, so they cannot be sent to;
  the option stays listed, disabled, so the gap is visible.
*/
const PROVIDER_ROLES_ALL = ['boat_provider', 'marina_provider', 'fuel_provider', 'maintenance_provider']
const BROADCAST_AUDIENCES: { key: string; label: string; role?: string | string[]; unavailable?: boolean }[] = [
  { key: 'all', label: 'All active accounts (every role, staff included)' },
  { key: 'customer', label: 'Customers only', role: 'customer' },
  { key: 'providers', label: 'All providers', role: PROVIDER_ROLES_ALL },
  { key: 'boat_provider', label: 'Boat providers', role: 'boat_provider' },
  { key: 'marina_provider', label: 'Marina providers', role: 'marina_provider' },
  { key: 'fuel_provider', label: 'Fuel providers', role: 'fuel_provider' },
  { key: 'maintenance_provider', label: 'Maintenance providers', role: 'maintenance_provider' },
  { key: 'vendors', label: 'Vendors — not available yet', unavailable: true },
]
const NOTIF_PAGE = 20

export function AdminNotifCenter() { return <NotifCenterPage /> }
function NotifCenterPage() {
  const [broadcast, setBroadcast] = useState(false)
  const tones: any = { info: 'bg-teal-50 text-teal-600', success: 'bg-emerald-50 text-emerald-600', warn: 'bg-amber-50 text-amber-600', danger: 'bg-rose-50 text-rose-600' }
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [titleAr, setTitleAr] = useState('')
  const [bodyAr, setBodyAr] = useState('')
  const [audience, setAudience] = useState('all')
  const [audienceCount, setAudienceCount] = useState<number | null>(null)
  const [sendEmail, setSendEmail] = useState(false)
  const [sending, setSending] = useState(false)
  const [notifs, setNotifs] = useState<ApiNotification[]>([])
  const [notifTotal, setNotifTotal] = useState(0)
  const [notifPage, setNotifPage] = useState(1)
  const [notifLoading, setNotifLoading] = useState(true)
  const [notifError, setNotifError] = useState<string | null>(null)

  const notifCfg: TableFiltersConfig<ApiNotification> = useMemo(() => ({
    searchFields: (n) => [n.title, n.body, n.type],
    filters: [
      { key: 'type', label: translatePortalText('Type'), get: (n) => translatePortalText(n.type?.replace(/_/g, ' ') || '') },
      {
        key: 'read',
        label: translatePortalText('Read state'),
        options: [
          { value: 'unread', label: translatePortalText('Unread') },
          { value: 'read', label: translatePortalText('Read') },
        ],
        get: (n) => (n.isRead ? 'read' : 'unread'),
      },
    ],
  }), [])
  const notifTf = useTableFilters(notifs, notifCfg)
  // `null` until it loads, and again if it fails — the tiles used to start at
  // and stay on 0 when the request failed, which reads as "nothing was sent".
  const [stats, setStats] = useState<{ pushSent24h: number; emailsSent24h: number; smsSent24h: number; openRatePct: number } | null>(null)

  /** The admin's own alert feed, a page at a time (it was the newest 20, full stop). */
  const loadNotifs = (page: number) => {
    setNotifLoading(true)
    setNotifError(null)
    adminPortalApi.notifications({ page, limit: NOTIF_PAGE })
      .then(res => {
        setNotifs(list => (page === 1 ? res.data.items : [...list, ...res.data.items.filter(n => !list.some(x => x._id === n._id))]))
        setNotifTotal(res.data.pagination?.total ?? res.data.items.length)
        setNotifPage(page)
      })
      .catch(e => setNotifError(errorMessage(e)))
      .finally(() => setNotifLoading(false))
  }
  useEffect(() => {
    loadNotifs(1)
    adminPortalApi.notificationSendStats().then(res => setStats(res.data)).catch(() => setStats(null))
  }, [])

  const audienceOpt = BROADCAST_AUDIENCES.find(a => a.key === audience) || BROADCAST_AUDIENCES[0]
  /*
    The real size of the chosen audience, counted the way `announce` selects
    it (active accounts, that role) — the old option text carried a constant.
  */
  useEffect(() => {
    if (!broadcast) return
    let alive = true
    setAudienceCount(null)
    // Several roles are counted one by one and summed (`users` filters by one role).
    const roles = Array.isArray(audienceOpt.role) ? audienceOpt.role : [audienceOpt.role]
    Promise.all(roles.map(role => adminPortalApi.users({ active: true, limit: 1, ...(role ? { role } : {}) })))
      .then(all => { if (alive) setAudienceCount(all.reduce((n, res) => n + (res.data.pagination?.total ?? 0), 0)) })
      .catch(() => { if (alive) setAudienceCount(null) })
    return () => { alive = false }
  }, [broadcast, audience])

  const resetBroadcast = () => { setTitle(''); setBody(''); setTitleAr(''); setBodyAr(''); setAudience('all'); setSendEmail(false) }

  const handleBroadcast = async () => {
    if (sending) return
    if (!title.trim() || !body.trim() || !titleAr.trim() || !bodyAr.trim()) { toast(translatePortalText('Title and message are required in English and Arabic'), 'warn'); return }
    if (audienceOpt.unavailable) { toast(translatePortalText('That audience cannot be sent to yet — choose another'), 'warn'); return }
    const who = translatePortalText(audienceOpt.label)
    const count = audienceCount != null ? formatPortalNumber(audienceCount) : translatePortalText('every')
    setSending(true)
    try {
      // A broadcast cannot be recalled, and "All" includes staff accounts —
      // so it is confirmed with the audience and the count, and the toast
      // reports how many accounts the server actually sent to.
      const sent = await confirmAndRun({
        title: `Send this broadcast to ${count} accounts?`,
        body: `${who}. It goes out immediately as an in-app notification and a push${sendEmail ? ', plus an email' : ''}, and cannot be recalled.`,
        confirmLabel: 'Send broadcast',
        busyLabel: 'Sending…',
        danger: !audienceOpt.role,
        run: async () => {
          const res = await adminPortalApi.announce({
            title: title.trim(), body: body.trim(), titleAr: titleAr.trim(), bodyAr: bodyAr.trim(),
            ...(audienceOpt.role ? { role: audienceOpt.role } : {}),
            channels: sendEmail ? ['push', 'email'] : ['push'],
          })
          return res.data.recipients
        },
        success: (n) => `Broadcast sent to ${formatPortalNumber(n)} account${n === 1 ? '' : 's'}`,
        error: (e) => `The broadcast was not sent: ${errorMessage(e)}`,
      })
      if (sent !== undefined) {
        setBroadcast(false)
        resetBroadcast()
        adminPortalApi.notificationSendStats().then(res => setStats(res.data)).catch(() => {})
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <PageWrap>
      <AdminHeader title={translatePortalText("Notification Center")} sub={translatePortalText("Broadcast announcements as push & in-app, and read your own admin alerts")} icon={<Bell className="text-emerald-500" />}
        actions={<button className="btn-admin" onClick={() => setBroadcast(true)}><Megaphone size={15} /> {translatePortalText("Broadcast message")}</button>} />

      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
        {[['Push sent · 24h', stats?.pushSent24h, '📲'], ['Emails sent · 24h', stats?.emailsSent24h, '📧'], ['SMS sent · 24h', stats?.smsSent24h, '📱'], ['Open rate', stats?.openRatePct, '📬', '%']].map(([l, v, icon, s], i) => (
          <motion.div key={String(l)} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="card p-4 flex items-center gap-3">
            <span className="text-2xl">{icon}</span>
            <div><p className="font-display text-2xl font-extrabold text-deep-900">{v == null ? '—' : s === '%' ? formatPortalPercent(Number(v)) : <Counter value={Number(v)} />}</p><p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText(String(l))}</p></div>
          </motion.div>
        ))}
      </div>

      {/* What the list below is: this admin's own inbox, not a log of broadcasts. */}
      <p className="mb-2 text-xs font-semibold text-slate-400">
        {translatePortalText('Your admin alerts')}{notifTotal > 0 ? ` · ${formatPortalNumber(notifs.length)} ${translatePortalText('of')} ${formatPortalNumber(notifTotal)}` : ''}
      </p>

      <TableToolbar
        state={notifTf}
        config={notifCfg}
        rows={notifs}
        noun="notifications"
        searchPlaceholder={translatePortalText("Search notifications by title, body or type...")}
      />

      <div className="grid gap-3 md:grid-cols-2">
        {/* A failed load said "No notifications yet." — the same words as an empty inbox. */}
        {notifError && (
          <p className="col-span-2 py-10 text-center text-sm text-rose-500">
            {translatePortalText('Could not load notifications')}: {notifError}{' '}
            <button className="font-bold underline" onClick={() => loadNotifs(notifs.length ? notifPage + 1 : 1)}>{translatePortalText('Retry')}</button>
          </p>
        )}
        {!notifError && notifLoading && notifs.length === 0 && <p className="col-span-2 py-10 text-center text-sm text-slate-400">{translatePortalText('Loading notifications…')}</p>}
        {!notifError && !notifLoading && notifs.length === 0 && <p className="col-span-2 py-10 text-center text-sm text-slate-400">{translatePortalText("No notifications yet.")}</p>}
        {notifs.length > 0 && notifTf.filtered.length === 0 && (
          <div className="col-span-2"><NoFilterMatches noun="notifications" onClear={notifTf.clear} /></div>
        )}
        {notifTf.filtered.map((n, i) => (
          <motion.div key={n._id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
            className={`card flex items-center gap-3 p-4 ${!n.isRead ? 'ring-1 ring-emerald-100' : ''}`}>
            <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl text-lg ${tones[NOTIF_TONE[n.type] || 'info']}`}>{NOTIF_ICON2[n.type] || '🔔'}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-400">{n.title} · {formatPortalDate(new Date(n.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}</p>
              <p className="mt-0.5 text-sm font-medium text-deep-800">{n.body}</p>
            </div>
            {!n.isRead && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500 animate-pulse-soft" />}
          </motion.div>
        ))}
      </div>
      {notifs.length > 0 && notifs.length < notifTotal && !notifError && (
        <div className="mt-4 flex justify-center">
          <button className="btn-ghost" disabled={notifLoading} onClick={() => loadNotifs(notifPage + 1)}>
            {notifLoading && <Loader2 size={14} className="animate-spin" />} {translatePortalText('Load older notifications')}
          </button>
        </div>
      )}

      <Modal open={broadcast} onClose={() => { if (!sending) setBroadcast(false) }} title={`📣 ${translatePortalText("Broadcast message")}`} wide>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label className="label">{translatePortalText("Audience")}</label>
              <select className="input" value={audience} onChange={e => setAudience(e.target.value)}>
                {BROADCAST_AUDIENCES.map(a => <option key={a.key} value={a.key} disabled={a.unavailable}>{translatePortalText(a.label)}</option>)}
              </select>
              <p className="mt-1 text-[11px] text-slate-500">
                {audienceCount == null
                  ? translatePortalText('Counting recipients…')
                  : `${translatePortalText('Reaches')} ${formatPortalNumber(audienceCount)} ${translatePortalText(audienceCount === 1 ? 'active account' : 'active accounts')}`}
              </p>
            </div>
            {/* Broadcasts go out as an in-app notification plus a push — that
                is all `announce` sends. These were free checkboxes nobody read,
                so unticking Push or ticking SMS changed nothing. They now show
                what will actually happen. */}
            <div><label className="label">{translatePortalText("Channels")}</label>
              <div className="flex flex-wrap gap-2">
                {([['📲 Push', true], ['🔔 In-app', true]] as const).map(([c]) => (
                  <label key={c} title={translatePortalText('Always sent with a broadcast')} className="flex items-center gap-1.5 rounded-lg bg-sand px-2.5 py-2 text-xs font-bold text-deep-800"><input type="checkbox" checked disabled readOnly className="h-3.5 w-3.5 accent-emerald-500" />{translatePortalText(c)}</label>
                ))}
                <label className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-sand px-2.5 py-2 text-xs font-bold text-deep-800"><input type="checkbox" checked={sendEmail} onChange={e => setSendEmail(e.target.checked)} className="h-3.5 w-3.5 accent-emerald-500" />{translatePortalText('📧 Email')}</label>
                <label title={translatePortalText('No SMS provider is connected')} className="flex items-center gap-1.5 rounded-lg bg-sand px-2.5 py-2 text-xs font-bold text-slate-400"><input type="checkbox" checked={false} disabled readOnly className="h-3.5 w-3.5" />{translatePortalText('📱 SMS')}</label>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">{translatePortalText('SMS is not available: no SMS provider is connected.')}</p></div>
          </div>
          <div><label className="label">{translatePortalText("Title")}</label><input className="input" value={title} onChange={e => setTitle(e.target.value)} maxLength={150} placeholder={translatePortalText("e.g. Regatta week is here 🎉")} /></div>
          <div><label className="label">{translatePortalText('Headline (Arabic)')}</label><input className="input" dir="rtl" maxLength={300} value={titleAr} onChange={e => setTitleAr(e.target.value)} placeholder={translatePortalText('Headline (Arabic)')} /></div>
          <div><label className="label">{translatePortalText("Message")}</label><textarea className="input" value={body} onChange={e => setBody(e.target.value)} rows={3} maxLength={500} placeholder={translatePortalText("Write your announcement…")} /></div>
          <div><label className="label">{translatePortalText('Message (Arabic)')}</label><textarea className="input" dir="rtl" value={bodyAr} onChange={e => setBodyAr(e.target.value)} rows={3} maxLength={1200} placeholder={translatePortalText('Write the Arabic announcement…')} /></div>
          {/* Neither of these reached the server: picking "Schedule for later"
              still sent immediately, and a template changed nothing. Kept, but
              locked to what actually happens until the API supports them. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label className="label">{translatePortalText("Schedule")}</label><select className="input" value="now" disabled title={translatePortalText('Scheduled sends are not available yet')}><option value="now">{translatePortalText("Send now")}</option><option value="later" disabled>{translatePortalText("Schedule for later — not available yet")}</option></select></div>
            <div><label className="label">{translatePortalText("Template")}</label><select className="input" value="default" disabled title={translatePortalText('Templates are not available yet')}><option value="default">{translatePortalText("Default")}</option><option disabled>{translatePortalText("Promotion")}</option><option disabled>{translatePortalText("Safety alert")}</option><option disabled>{translatePortalText("System notice")}</option></select></div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setBroadcast(false)} disabled={sending} className="btn-ghost">{translatePortalText("Cancel")}</button>
            <button onClick={() => void handleBroadcast()} disabled={sending || audienceOpt.unavailable || !title.trim() || !body.trim() || !titleAr.trim() || !bodyAr.trim()} className="btn-admin disabled:opacity-50">{sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} {translatePortalText("Send broadcast")}</button>
          </div>
        </div>
      </Modal>
    </PageWrap>
  )
}

// ══════════ EMERGENCY MONITOR (§20) ══════════
export function AdminEmergency() { return <EmergencyPage /> }
function EmergencyPage() {
  const [items, setItems] = useState<UiEmergency[]>([])
  const [statusCounts, setStatusCounts] = useState<Record<string, number> | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // On a failed load this page used to say "No emergencies reported — all
  // clear." The one screen where a false all-clear is dangerous.
  const [error, setError] = useState<string | null>(null)
  const [resolvingId, setResolvingId] = useState<string | null>(null)
  /** Alerts broadcast from this page in this session — see the Alerts panel. */
  const [sentAlerts, setSentAlerts] = useState<{ text: string; at: string; recipients: number }[]>([])

  /*
    Open cases are fetched on their own, then merged with the newest 100.
    One "newest 100" request meant an SOS still active but older than the 100
    most recent reports was simply not on the queue — while the Active counter
    above, which is collection-wide, still counted it.
  */
  const load = (quiet = false) => {
    if (!quiet) setLoading(true)
    Promise.all([
      adminPortalApi.emergencies({ status: 'active', limit: 100 }),
      adminPortalApi.emergencies({ status: 'responding', limit: 100 }),
      adminPortalApi.emergencies({ limit: 100 }),
    ])
      .then(([act, resp, recent]) => {
        const byId = new Map<string, UiEmergency>()
        for (const e of [...act.data.items, ...resp.data.items, ...recent.data.items]) {
          const m = mapEmergency(e)
          byId.set(m.id, m)
        }
        const mapped = [...byId.values()].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
        setItems(mapped)
        setStatusCounts(recent.data.statusCounts || {})
        setError(null)
        setSel(prev => (prev && mapped.some(m => m.id === prev)) ? prev : (mapped.find(m => m.status === 'Active')?.id || mapped[0]?.id || null))
      })
      .catch(e => setError(errorMessage(e)))
      .finally(() => setLoading(false))
  }
  /*
    A monitor that only read once showed a new SOS to nobody until someone
    reloaded the page. It re-reads every 30 seconds while open.
  */
  useEffect(() => {
    load()
    const t = window.setInterval(() => load(true), 30_000)
    return () => window.clearInterval(t)
  }, [])

  const active = items.find(s => s.id === sel)
  /**
   * Sends a real safety broadcast.
   *
   * Confirmed before it fires, and the count of who received it is reported
   * back — on a safety message, "sent" without a number is the same problem
   * this replaces.
   *
   * The dialog said it went "to every provider account". It goes to every
   * active account — customers, providers and staff — because `announce` is
   * called without a role and can only take one role at a time. The copy now
   * says who actually gets it.
   */
  const broadcastAlert = () =>
    confirmAndRun({
      title: 'Broadcast a safety alert?',
      body: 'Goes immediately to every active BoatPro account — customers, providers and staff — as an in-app notification and a push. Say where, and what you need them to do.',
      confirmLabel: 'Broadcast now',
      busyLabel: 'Broadcasting…',
      danger: true,
      input: {
        label: 'Alert message',
        placeholder: 'e.g. Small craft advisory — Jeddah corniche. Suspend departures until 18:00.',
        required: true,
        multiline: true,
        maxLength: 500,
      },
      additionalInput: {
        label: 'Alert message (Arabic)',
        placeholder: 'Write the Arabic alert…',
        required: true,
        multiline: true,
        maxLength: 1200,
        dir: 'rtl',
      },
      run: async (message, _file, messageAr) => {
        const res = await adminPortalApi.announce({
          title: '🚨 Safety alert',
          body: message.trim(),
          titleAr: '🚨 تنبيه سلامة',
          bodyAr: String(messageAr ?? '').trim(),
        })
        setSentAlerts(list => [{ text: message.trim(), at: new Date().toISOString(), recipients: res.data.recipients }, ...list])
        return res.data.recipients
      },
      success: (n) => `Alert broadcast to ${formatPortalNumber(n)} account${n === 1 ? '' : 's'}`,
      error: 'The alert was NOT sent. Try again, or call responders directly.',
      retryable: true,
    })

  /*
    Closing an SOS was one click with no question, on the button next to the
    case details. It now confirms, holds the button while it runs, and
    re-reads the queue whatever happened — if another admin resolved it in
    the meantime, the list shows that rather than this screen's stale copy.
  */
  const resolve = (s: UiEmergency) => {
    if (resolvingId) return
    setResolvingId(s.id)
    void confirmAndRun({
      title: `Mark ${s.boat}'s ${s.kind.toLowerCase()} resolved?`,
      body: 'Only once the person is safe or the incident is handed over. It leaves the active queue and the counters above.',
      confirmLabel: 'Mark resolved',
      busyLabel: 'Resolving…',
      success: 'Marked resolved',
      error: (e) => `Could not resolve: ${errorMessage(e)}`,
      run: async () => { await adminPortalApi.resolveEmergency(s.id) },
    }).finally(() => { setResolvingId(null); load(true) })
  }

  return (
    <PageWrap>
      <AdminHeader title={translatePortalText("Emergency Monitoring")} sub={translatePortalText("SOS requests, rescue tracking, incidents & safety alerts across the platform")} icon={<Siren className="text-emerald-500" />}
        actions={
          /*
            The most dangerous stub in the console.

            This button reported "🚨 All-hands alert broadcast to responders"
            and sent nothing at all. On an emergency screen, during an active
            SOS, an operator would press it, read that responders had been
            alerted, and stop — believing help was on its way when no message
            had left the building. Nothing else in this codebase could cost as
            much by being fake.

            `announce` is real and reaches every provider account, which is who
            "responders" are on this platform. It asks for the wording rather
            than sending a canned alert, because whoever needs to respond needs
            to know where and to what.
          */
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={() => load()} disabled={loading} title={translatePortalText('Refresh')}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              className="btn-primary !bg-gradient-to-r !from-rose-600 !to-rose-400"
              onClick={() => void broadcastAlert()}
            >
              {translatePortalText("\r\n            🚨 Broadcast alert\r\n          ")}</button>
          </div>
        } />

      {/* Unknown, not zero, until the counts have actually been read. */}
      <div className="mb-5 grid grid-cols-3 gap-4">
        {[['Active', statusCounts?.active, 'text-rose-600'], ['Responding', statusCounts?.responding, 'text-sky-600'], ['Resolved', statusCounts?.resolved, 'text-slate-500']].map(([l, v, t]) => (
          <div key={String(l)} className="card p-4 text-center"><p className={`font-display text-2xl font-extrabold ${t}`}>{statusCounts ? <Counter value={Number(v || 0)} /> : '—'}</p><p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText(String(l))}</p></div>
        ))}
      </div>

      {error && (
        <div className="card mb-4 !border-rose-200 !bg-rose-50 p-4 text-sm font-semibold text-rose-700">
          {translatePortalText('Emergencies could not be loaded — this list may be out of date. Do not treat it as all clear.')} ({error}){' '}
          <button className="font-bold underline" onClick={() => load()}>{translatePortalText('Retry')}</button>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        {/* SOS queue — platform-wide, newest first */}
        <div className="lg:col-span-2">
          <Section title={translatePortalText("SOS queue")} sub={translatePortalText("Every active & responding emergency, plus the 100 most recent — refreshed every 30 seconds")}>
            <div className="space-y-2">
              {loading && items.length === 0 && <div className="py-14 text-center text-sm text-slate-400"><Loader2 size={16} className="me-2 inline animate-spin" />{translatePortalText('Loading emergencies…')}</div>}
              {items.map(s => (
                <button key={s.id} onClick={() => setSel(s.id)} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${sel === s.id ? 'border-emerald-300 bg-emerald-50/50' : 'border-slate-100 hover:bg-sand'}`}>
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-base ${s.status === 'Active' ? 'bg-rose-500 text-white' : s.status === 'Responding' ? 'bg-sky-500 text-white' : 'bg-slate-200 text-slate-500'}`}>{s.icon}</span>
                  <div className="min-w-0 flex-1"><p className="truncate text-xs font-extrabold text-deep-900">{s.boat} · {s.kind}</p><p className="truncate text-[10px] text-slate-400">{s.location} · {s.time}</p></div>
                  <ABadge dot={s.status === 'Active'}>{translatePortalText(s.status)}</ABadge>
                </button>
              ))}
              {/* "All clear" only when the queue was actually read. */}
              {!loading && !error && items.length === 0 && <div className="rounded-2xl border border-dashed border-slate-200 py-14 text-center text-sm text-slate-400">{translatePortalText("No emergencies reported — all clear.")}</div>}
              {!loading && error && items.length === 0 && <div className="rounded-2xl border border-dashed border-rose-200 py-14 text-center text-sm text-rose-500">{translatePortalText('The SOS queue could not be read.')}</div>}
            </div>
          </Section>
        </div>

        {/* detail + alerts */}
        <div className="space-y-4">
          {active && (
            <Section title={`${active.icon} ${active.boat}`} sub={active.kind}>
              {active.message && <p className="mb-2 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800 whitespace-pre-wrap break-words">"{active.message}"</p>}
              <div className="space-y-2">
                {[['Location', active.location], ['Reported', active.time], ['Responder', active.responder]].map(([l, v]) => (
                  // emergency detail loop
                  <div key={l} className="flex justify-between gap-3 rounded-lg bg-sand px-3 py-2 text-xs"><span className="font-bold text-slate-400">{translatePortalText(l)}</span><span className="min-w-0 break-words font-semibold text-deep-800 text-end">{v}</span></div>
                ))}
                {/* A number to call back on — populated by the API, never shown. */}
                <div className="flex justify-between gap-3 rounded-lg bg-sand px-3 py-2 text-xs">
                  <span className="font-bold text-slate-400">{translatePortalText('Contact')}</span>
                  <span className="min-w-0 break-all font-semibold text-deep-800 text-end">
                    {active.phone
                      ? <a href={`tel:${active.phone}`} dir="ltr" className="inline-flex items-center gap-1 text-emerald-700 underline"><Phone size={11} />{active.phone}</a>
                      : active.email || translatePortalText('No phone on the account')}
                  </span>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <ABadge dot={active.status !== 'Resolved'}>{translatePortalText(active.status)}</ABadge>
                {Number.isFinite(active.lat) && Number.isFinite(active.lng) && (
                  <a href={`https://www.google.com/maps?q=${active.lat},${active.lng}`} target="_blank" rel="noreferrer" className="text-xs font-bold text-emerald-700 underline">{translatePortalText('Open in maps')}</a>
                )}
                {active.status !== 'Resolved' && (
                  <button onClick={() => resolve(active)} disabled={!!resolvingId} className="btn-ghost ms-auto !py-1.5 !px-3 !text-xs disabled:opacity-50">
                    {resolvingId === active.id && <Loader2 size={12} className="animate-spin" />} {translatePortalText("Mark resolved")}
                  </button>
                )}
              </div>
            </Section>
          )}
          {/* This panel showed two invented advisories — a small-craft warning
              for Biscayne Bay (Florida) and a "liferaft recert campaign" —
              styled as live alerts. No weather or safety feed is connected to
              the platform, so it now shows the alerts actually broadcast from
              this page, and says plainly that nothing else is monitored. */}
          <Section title={translatePortalText("Alerts")} sub={translatePortalText("Weather & safety")}>
            <div className="space-y-2 text-xs">
              {sentAlerts.map(a => (
                <div key={a.at} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 font-semibold text-amber-700">
                  <p className="whitespace-pre-wrap break-words">🚨 {a.text}</p>
                  <p className="mt-1 text-[10px] font-bold text-amber-600">{formatPortalDate(new Date(a.at), { timeStyle: 'short' })} · {translatePortalText('sent to')} {formatPortalNumber(a.recipients)} {translatePortalText('accounts')}</p>
                </div>
              ))}
              <div className="rounded-xl border border-slate-100 bg-sand px-3 py-2.5 font-semibold text-slate-500">
                {translatePortalText('No weather or marine-safety feed is connected. Alerts you broadcast from this page appear here for this session.')}
              </div>
            </div>
          </Section>
        </div>
      </div>
    </PageWrap>
  )
}
