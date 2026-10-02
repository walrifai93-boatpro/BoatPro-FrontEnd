import React, { useState, useEffect, useMemo } from 'react'
import { TableToolbar, useTableFilters, NoFilterMatches, type TableFiltersConfig } from '../../shared/TableFilters'
import { motion } from 'framer-motion'
import { Star, Headset, Bell, Siren, Trash2, MessageCircle, Flag, Check, Send, Megaphone, Phone, EyeOff, RotateCcw } from 'lucide-react'
import { PageWrap, seededAvatar, reviewTargetLabel } from './_shared'
import { Section, Modal, toast, Stars, Counter, downloadCsv } from '../../ui'
import { confirmAndRun } from '../../async'
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

interface UiEmergency { id: string; boat: string; kind: string; icon: string; location: string; status: 'Active' | 'Responding' | 'Resolved'; time: string; responder: string }
const mapEmergency = (e: ApiAdminEmergency): UiEmergency => {
  const meta = emergencyKindMeta[e.type] || { label: e.type, icon: '🚨' }
  const reporter = typeof e.user === 'object' && e.user ? e.user.name : undefined
  const resolver = typeof e.resolvedBy === 'object' && e.resolvedBy ? e.resolvedBy.name : undefined
  return {
    id: e.id || e._id,
    boat: reporter || translatePortalText('Unknown reporter'),
    kind: translatePortalText(meta.label),
    icon: meta.icon,
    location: `${formatPortalNumber(e.latitude, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}, ${formatPortalNumber(e.longitude, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`,
    status: emergencyStatusLabels[e.status] || 'Active',
    time: e.createdAt ? formatPortalDate(new Date(e.createdAt), { dateStyle: 'medium', timeStyle: 'short' }) : translatePortalText('Unknown'),
    responder: resolver ? `${translatePortalText('Resolved by')} ${resolver}` : e.status === 'responding' ? translatePortalText('Response team engaged') : translatePortalText('Awaiting dispatch'),
  }
}

// ══════════ REVIEWS & MODERATION (§14) — shared building blocks ══════════
// Reused by the global Super Admin queue AND each provider vertical's own Reviews page.
export function ReviewStatCards({ reviews }: { reviews: ApiReview[] }) {
  const rated = reviews.filter(r => r.rating > 0)
  const avg = rated.length ? Number((rated.reduce((s, r) => s + r.rating, 0) / rated.length).toFixed(1)) : 0
  const stats: [string, number, string, number?][] = [
    ['Avg rating', avg, '⭐', 1],
    ['Total reviews', reviews.length, '📝'],
    ['Flagged', reviews.filter(r => r.reported).length, '🧿'],
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
  useEffect(() => { setReason('') }, [target])
  const presets = ['Abusive or hateful language', 'Not about this booking', 'Personal data in the comment', 'Spam or advertising', 'Suspected fake review']
  const submit = () => {
    if (!target || !reason.trim()) return
    adminPortalApi.takedownReview(target.id, reason.trim())
      .then(() => { toast(translatePortalText('Review taken down'), 'warn'); onDone(target.id, reason.trim()); onClose() })
      .catch(() => toast(translatePortalText('Could not take the review down'), 'warn'))
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
          <textarea className="input min-h-[80px]" value={reason} onChange={e => setReason(e.target.value)} placeholder={translatePortalText("Reason (shown to the author)…")} />
          <button onClick={submit} disabled={!reason.trim()} className="btn-admin w-full !justify-center disabled:opacity-50">
            {translatePortalText("\r\n            Take down\r\n          ")}</button>
        </div>
      )}
    </Modal>
  )
}

/** Shared reply-composer modal — real PATCH /reviews/:id/reply, not a fake toast. */
export function ReviewReplyModal({ target, onClose, onSent }: { target: ApiReview | null; onClose: () => void; onSent: (id: string, text: string) => void }) {
  const [text, setText] = useState('')
  useEffect(() => { setText(target?.reply?.text || '') }, [target])
  const send = () => {
    if (!target || !text.trim()) return
    reviewsApi.reply(target.id, text.trim())
      .then(() => { toast(translatePortalText('Reply sent')); onSent(target.id, text.trim()); onClose() })
      .catch(() => toast(translatePortalText('Could not send reply'), 'warn'))
  }
  return (
    <Modal open={!!target} onClose={onClose} title={target ? `💬 ${translatePortalText('Reply to')} ${typeof target.author === 'object' ? target.author.name : translatePortalText('review')}` : ''}>
      {target && (
        <div className="space-y-3">
          <p className="rounded-xl bg-sand p-3 text-sm italic text-slate-600">"{target.comment || '(no comment)'}"</p>
          <textarea className="input min-h-[100px]" value={text} onChange={e => setText(e.target.value)} placeholder={translatePortalText("Write a reply…")} />
          <button onClick={send} className="btn-admin w-full !justify-center"><Send size={14} /> {translatePortalText("Send reply")}</button>
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

  const onDelete = (id: string) => {
    adminPortalApi.removeReview(id).then(() => {
      toast(translatePortalText('Review deleted'), 'warn')
      setReviews(r => r.filter(x => x.id !== id))
    }).catch(() => toast(translatePortalText('Could not delete review'), 'warn'))
  }
  // A report moves a live review to `under_review` server-side — shown here
  // too, rather than only setting the legacy `reported` flag the card ignores.
  const onFlag = (id: string) => {
    adminPortalApi.flagReview(id)
      .then(() => patch(id, x => ({
        ...x,
        reported: true,
        moderation: { ...(x.moderation ?? {}), status: x.moderation?.status === 'hidden' ? 'hidden' : 'under_review', reportCount: (x.moderation?.reportCount ?? 0) + 1 },
      })))
      .catch(() => toast(translatePortalText('Could not flag review'), 'warn'))
  }
  const onApprove = (id: string) => {
    adminPortalApi.approveReview(id)
      .then(() => patch(id, x => ({ ...x, reported: false, moderation: { ...(x.moderation ?? {}), status: 'visible' as const, reportCount: 0 } })))
      .catch(() => toast(translatePortalText('Could not approve review'), 'warn'))
  }
  const onRestore = (id: string) => {
    adminPortalApi.restoreReview(id)
      .then(() => {
        toast(translatePortalText('Review restored'))
        patch(id, x => ({ ...x, reported: false, moderation: { ...(x.moderation ?? {}), status: 'visible' as const, reportCount: 0, reason: undefined, hiddenAt: undefined } }))
      })
      .catch(() => toast(translatePortalText('Could not restore review'), 'warn'))
  }
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
  const [loading, setLoading] = useState(true)
  const load = () => {
    setLoading(true)
    adminPortalApi.reviews({ limit: 200 })
      .then(res => setReviews(res.data.items))
      .catch(() => toast(translatePortalText('Could not load reviews'), 'warn'))
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
      ) : (<>
        <ReviewStatCards reviews={reviews} />
        <ReviewsBoard reviews={reviews} emptyLabel={translatePortalText("No reviews match this filter.")} {...moderation.boardProps} />
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
export function AdminNotifCenter() { return <NotifCenterPage /> }
function NotifCenterPage() {
  const [broadcast, setBroadcast] = useState(false)
  const tones: any = { info: 'bg-teal-50 text-teal-600', success: 'bg-emerald-50 text-emerald-600', warn: 'bg-amber-50 text-amber-600', danger: 'bg-rose-50 text-rose-600' }
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [titleAr, setTitleAr] = useState('')
  const [bodyAr, setBodyAr] = useState('')
  const [notifs, setNotifs] = useState<ApiNotification[]>([])

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
  const [stats, setStats] = useState({ pushSent24h: 0, emailsSent24h: 0, smsSent24h: 0, openRatePct: 0 })

  useEffect(() => {
    adminPortalApi.notifications({ limit: 20 }).then(res => setNotifs(res.data.items)).catch(() => {})
    adminPortalApi.notificationSendStats().then(res => setStats(res.data)).catch(() => {})
  }, [])

  const handleBroadcast = () => {
    if (!title.trim() || !body.trim() || !titleAr.trim() || !bodyAr.trim()) { toast(translatePortalText('Title and message are required'), 'warn'); return }
    adminPortalApi.announce({ title: title.trim(), body: body.trim(), titleAr: titleAr.trim(), bodyAr: bodyAr.trim() })
      .then(res => {
        toast(translatePortalText(`Broadcast queued for ${res.data.recipients} recipients`), 'success')
        setBroadcast(false)
        setTitle('')
        setBody('')
        setTitleAr('')
        setBodyAr('')
      })
      .catch(err => toast(translatePortalText('Failed to send broadcast'), 'warn'))
  }

  return (
    <PageWrap>
      <AdminHeader title={translatePortalText("Notification Center")} sub={translatePortalText("Push, email, SMS & in-app — broadcasts and scheduled sends")} icon={<Bell className="text-emerald-500" />}
        actions={<button className="btn-admin" onClick={() => setBroadcast(true)}><Megaphone size={15} /> {translatePortalText("Broadcast message")}</button>} />

      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
        {[['Push sent · 24h', stats.pushSent24h, '📲'], ['Emails sent · 24h', stats.emailsSent24h, '📧'], ['SMS sent · 24h', stats.smsSent24h, '📱'], ['Open rate', stats.openRatePct, '📬', '%']].map(([l, v, icon, s], i) => (
          <motion.div key={String(l)} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="card p-4 flex items-center gap-3">
            <span className="text-2xl">{icon}</span>
            <div><p className="font-display text-2xl font-extrabold text-deep-900">{s === '%' ? formatPortalPercent(Number(v)) : <Counter value={Number(v)} />}</p><p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText(String(l))}</p></div>
          </motion.div>
        ))}
      </div>

      <TableToolbar
        state={notifTf}
        config={notifCfg}
        rows={notifs}
        noun="notifications"
        searchPlaceholder={translatePortalText("Search notifications by title, body or type...")}
      />

      <div className="grid gap-3 md:grid-cols-2">
        {notifs.length === 0 && <p className="col-span-2 py-10 text-center text-sm text-slate-400">{translatePortalText("No notifications yet.")}</p>}
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

      <Modal open={broadcast} onClose={() => setBroadcast(false)} title={`📣 ${translatePortalText("Broadcast message")}`} wide>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label className="label">{translatePortalText("Audience")}</label>
              <select className="input">{['All users (48,212)', 'Customers only', 'All providers', 'Boat providers', 'Fuel providers', 'Maintenance providers', 'Vendors'].map(a => <option key={a}>{translatePortalText(a)}</option>)}</select></div>
            <div><label className="label">{translatePortalText("Channels")}</label>
              <div className="flex gap-2">{['📲 Push', '📧 Email', '📱 SMS', '🔔 In-app'].map(c => (
                <label key={c} className="flex items-center gap-1.5 rounded-lg bg-sand px-2.5 py-2 text-xs font-bold text-deep-800"><input type="checkbox" defaultChecked={!c.includes('SMS')} className="h-3.5 w-3.5 accent-emerald-500" />{translatePortalText(c)}</label>
              ))}</div></div>
          </div>
          <div><label className="label">{translatePortalText("Title")}</label><input className="input" value={title} onChange={e => setTitle(e.target.value)} maxLength={150} placeholder={translatePortalText("e.g. Regatta week is here 🎉")} /></div>
          <div><label className="label">{translatePortalText('Headline (Arabic)')}</label><input className="input" dir="rtl" maxLength={300} value={titleAr} onChange={e => setTitleAr(e.target.value)} placeholder={translatePortalText('Headline (Arabic)')} /></div>
          <div><label className="label">{translatePortalText("Message")}</label><textarea className="input" value={body} onChange={e => setBody(e.target.value)} rows={3} maxLength={500} placeholder={translatePortalText("Write your announcement…")} /></div>
          <div><label className="label">{translatePortalText('Message (Arabic)')}</label><textarea className="input" dir="rtl" value={bodyAr} onChange={e => setBodyAr(e.target.value)} rows={3} maxLength={1200} placeholder={translatePortalText('Write the Arabic announcement…')} /></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label className="label">{translatePortalText("Schedule")}</label><select className="input"><option>{translatePortalText("Send now")}</option><option>{translatePortalText("Schedule for later")}</option></select></div>
            <div><label className="label">{translatePortalText("Template")}</label><select className="input"><option>{translatePortalText("Default")}</option><option>{translatePortalText("Promotion")}</option><option>{translatePortalText("Safety alert")}</option><option>{translatePortalText("System notice")}</option></select></div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setBroadcast(false)} className="btn-ghost">{translatePortalText("Cancel")}</button>
            <button onClick={handleBroadcast} disabled={!title.trim() || !body.trim() || !titleAr.trim() || !bodyAr.trim()} className="btn-admin disabled:opacity-50"><Send size={14} /> {translatePortalText("Send broadcast")}</button>
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
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({})
  const [sel, setSel] = useState<string | null>(null)

  const load = () => {
    adminPortalApi.emergencies({ limit: 100 })
      .then(res => {
        const mapped = res.data.items.map(mapEmergency)
        setItems(mapped)
        setStatusCounts(res.data.statusCounts || {})
        setSel(prev => (prev && mapped.some(m => m.id === prev)) ? prev : (mapped.find(m => m.status === 'Active')?.id || mapped[0]?.id || null))
      })
      .catch(() => toast(translatePortalText('Failed to load emergencies'), 'warn'))
  }
  useEffect(load, [])

  const active = items.find(s => s.id === sel)
  /**
   * Sends a real safety broadcast to every provider on the platform.
   *
   * Confirmed before it fires, and the count of who received it is reported
   * back — on a safety message, "sent" without a number is the same problem
   * this replaces.
   */
  const broadcastAlert = () =>
    confirmAndRun({
      title: 'Broadcast a safety alert?',
      body: 'Goes immediately to every provider account as a high-priority notification. Say where, and what you need them to do.',
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
        return res.data.recipients
      },
      success: (n) => `Alert broadcast to ${formatPortalNumber(n)} account${n === 1 ? '' : 's'}`,
      error: 'The alert was NOT sent. Try again, or call responders directly.',
      retryable: true,
    })

  const resolve = (id: string) => {
    adminPortalApi.resolveEmergency(id)
      .then(() => { toast(translatePortalText('Marked resolved')); load() })
      .catch(() => toast(translatePortalText('Could not resolve — try again'), 'warn'))
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
          <button
            className="btn-primary !bg-gradient-to-r !from-rose-600 !to-rose-400"
            onClick={() => void broadcastAlert()}
          >
            {translatePortalText("\r\n            🚨 Broadcast alert\r\n          ")}</button>
        } />

      <div className="mb-5 grid grid-cols-3 gap-4">
        {[['Active', statusCounts.active || 0, 'text-rose-600'], ['Responding', statusCounts.responding || 0, 'text-sky-600'], ['Resolved', statusCounts.resolved || 0, 'text-slate-500']].map(([l, v, t]) => (
          <div key={String(l)} className="card p-4 text-center"><p className={`font-display text-2xl font-extrabold ${t}`}><Counter value={Number(v)} /></p><p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText(String(l))}</p></div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* SOS queue — platform-wide, newest first */}
        <div className="lg:col-span-2">
          <Section title={translatePortalText("SOS queue")} sub={translatePortalText("Every active & recent emergency across the platform")}>
            <div className="space-y-2">
              {items.map(s => (
                <button key={s.id} onClick={() => setSel(s.id)} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${sel === s.id ? 'border-emerald-300 bg-emerald-50/50' : 'border-slate-100 hover:bg-sand'}`}>
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-base ${s.status === 'Active' ? 'bg-rose-500 text-white' : s.status === 'Responding' ? 'bg-sky-500 text-white' : 'bg-slate-200 text-slate-500'}`}>{s.icon}</span>
                  <div className="min-w-0 flex-1"><p className="truncate text-xs font-extrabold text-deep-900">{s.boat} · {s.kind}</p><p className="truncate text-[10px] text-slate-400">{s.location} · {s.time}</p></div>
                  <ABadge dot={s.status === 'Active'}>{translatePortalText(s.status)}</ABadge>
                </button>
              ))}
              {items.length === 0 && <div className="rounded-2xl border border-dashed border-slate-200 py-14 text-center text-sm text-slate-400">{translatePortalText("No emergencies reported — all clear.")}</div>}
            </div>
          </Section>
        </div>

        {/* detail + alerts */}
        <div className="space-y-4">
          {active && (
            <Section title={`${active.icon} ${active.boat}`} sub={active.kind}>
              <div className="space-y-2">
                {[['Location', active.location], ['Reported', active.time], ['Responder', active.responder]].map(([l, v]) => (
                  // emergency detail loop
                  <div key={l} className="flex justify-between rounded-lg bg-sand px-3 py-2 text-xs"><span className="font-bold text-slate-400">{translatePortalText(l)}</span><span className="font-semibold text-deep-800 text-right">{v}</span></div>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <ABadge dot={active.status !== 'Resolved'}>{translatePortalText(active.status)}</ABadge>
                {active.status !== 'Resolved' && <button onClick={() => resolve(active.id)} className="btn-ghost ms-auto !py-1.5 !px-3 !text-xs">{translatePortalText("Mark resolved")}</button>}
              </div>
            </Section>
          )}
          <Section title={translatePortalText("Alerts")} sub={translatePortalText("Weather & safety")}>
            <div className="space-y-2 text-xs">
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 font-semibold text-amber-700">{translatePortalText("🌬️ Small-craft advisory from 22:00 — gusts to 25 kn, Biscayne Bay.")}</div>
              <div className="rounded-xl border border-slate-100 bg-sand px-3 py-2.5 font-semibold text-slate-500">{translatePortalText("🦺 Reminder: liferaft recert campaign runs through July.")}</div>
            </div>
          </Section>
        </div>
      </div>
    </PageWrap>
  )
}
