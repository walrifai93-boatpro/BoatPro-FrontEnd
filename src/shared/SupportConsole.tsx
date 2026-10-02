import React, { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Send, RefreshCw, Check, UserPlus, Inbox } from 'lucide-react'
import {
  chatApi,
  supportApi,
  type ApiChat,
  type ApiMessage,
  type ApiSubscriber,
  type SupportPriority,
  type SupportQueueStats,
  type SupportStatus,
  type SupportDesk,
  idOf,
} from '../api'
import { toast, Spinner, Avatar } from '../ui'
import { useAuth } from '../auth'
import { fmtRelative } from '../live'
import { onSocket } from '../socket'
import { formatPortalNumber, translatePortalText } from '../i18n/runtime'


/**
 * The support desk console.
 *
 * One component serves both desks the platform has, because the work is
 * identical and only the queue differs: signed in as an admin it shows the
 * platform queue, signed in as a marina/fuel/maintenance provider it shows that
 * business's own. The server decides which from the token, so nothing here
 * takes a desk parameter.
 *
 * Laid out as a queue beside a conversation rather than a list of tickets with
 * a reply modal. A desk agent's job is reading context and answering, and a
 * modal that covers the list every time you reply makes it impossible to see
 * what else is waiting.
 */

/** Who opened the request: a customer, any kind of provider, or anyone else (crew, workers, staff). */
function requesterKind(opener: unknown): { letter: string; label: string; cls: string } {
  const role = typeof opener === 'object' && opener ? (opener as { role?: string }).role : undefined
  if (role === 'customer') return { letter: 'C', label: 'Customer', cls: 'bg-sky-100 text-sky-700 ring-sky-300' }
  if (role && role.endsWith('_provider')) return { letter: 'P', label: 'Provider', cls: 'bg-emerald-100 text-emerald-700 ring-emerald-300' }
  return { letter: 'O', label: 'Other', cls: 'bg-slate-100 text-slate-600 ring-slate-300' }
}

const STATUS_STYLE: Record<SupportStatus, { label: string; cls: string }> = {
  // "Open" means the ball is with us. That is the only state an agent has to act on.
  open: { label: 'Needs reply', cls: 'bg-orange-50 text-orange-600 ring-orange-200' },
  pending: { label: 'Answered', cls: 'bg-sky-50 text-sky-600 ring-sky-200' },
  resolved: { label: 'Resolved', cls: 'bg-emerald-50 text-emerald-600 ring-emerald-200' },
}

const PRIORITY_STYLE: Record<SupportPriority, string> = {
  low: 'text-slate-400',
  normal: 'text-slate-500',
  high: 'text-orange-500',
  urgent: 'text-rose-600',
}

const FILTERS: { key: string; label: string; params: Parameters<typeof supportApi.queue>[0] }[] = [
  { key: 'open', label: 'Needs reply', params: { status: 'open' } },
  { key: 'unassigned', label: 'Unassigned', params: { unassigned: true } },
  { key: 'pending', label: 'Awaiting them', params: { status: 'pending' } },
  { key: 'resolved', label: 'Resolved', params: { status: 'resolved' } },
  { key: 'all', label: 'All', params: {} },
]
const READ_ACTION_KEYS = ['customer.read','provider.read','boat.read','trip.read','booking.read','payment.read',
  'payment.refund_status','subscription.read','payout.read','berth.read','fuel.read','maintenance.read','policy.read','conversation.read']
const ACTION_KEYS = [...READ_ACTION_KEYS,'customer.correct_profile','customer.verify','provider.correct_profile',
  'provider.verify','trip.update','trip.reschedule','trip.cancel','booking.correct_details','booking.cancel','payment.refund',
  'booking.reschedule',
  'payment.retry_link','payment.mark_issue','support.reset_ai']

const nameOf = (p: ApiSubscriber | string | undefined): string =>
  typeof p === 'object' && p ? p.business?.businessName || p.name : ''

export function SupportConsole({ title = 'Support', sub, refreshKey = 0 }:
  { title?: string; sub?: string; refreshKey?: number }) {
  const { user } = useAuth()
  const isAgent = user?.role === 'support_agent'
  const [desk, setDesk] = useState<SupportDesk>('admin')
  const [filter, setFilter] = useState('open')
  const [search, setSearch] = useState('')
  const [threads, setThreads] = useState<ApiChat[]>([])
  const [stats, setStats] = useState<SupportQueueStats | null>(null)
  const [loadingQueue, setLoadingQueue] = useState(true)

  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ApiMessage[]>([])
  const [loadingThread, setLoadingThread] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [context, setContext] = useState<Awaited<ReturnType<typeof supportApi.context>>['data'] | null>(null)
  const [notes, setNotes] = useState<Awaited<ReturnType<typeof supportApi.notes>>['data']['items']>([])
  const [noteDraft, setNoteDraft] = useState('')
  const [actionKey, setActionKey] = useState('booking.read')
  const [entityId, setEntityId] = useState('')
  const [actionValue, setActionValue] = useState('')
  const [moveDepartureId, setMoveDepartureId] = useState('')
  const [moveDate, setMoveDate] = useState('')
  const [moveTime, setMoveTime] = useState('')
  const [reviewStatus, setReviewStatus] = useState<'approved' | 'rejected'>('approved')
  const [rejectionReason, setRejectionReason] = useState('')
  const [actionReason, setActionReason] = useState('')
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof supportApi.actionPreview>>['data'] | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [agentScopes, setAgentScopes] = useState<Awaited<ReturnType<typeof supportApi.myAvailability>>['data']['scopes']>([])
  const scroller = useRef<HTMLDivElement>(null)
  const actionAttempt = useRef<{ fingerprint: string; key: string } | null>(null)

  const params = FILTERS.find(f => f.key === filter)?.params ?? {}

  const loadQueue = async (keepActive = true) => {
    setLoadingQueue(true)
    try {
      const res = await supportApi.queue({ ...params, ...(!isAgent ? { desk } : {}), search: search.trim() || undefined, limit: 100 })
      setThreads(res.data.items)
      setStats(res.data.stats)
      // Keep whatever is open on screen open across a refresh — an agent
      // mid-reply must not have the conversation swapped out from under them.
      if (!keepActive || !res.data.items.some(t => t._id === activeId)) {
        setActiveId(res.data.items[0]?._id ?? null)
      }
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not load the support queue'), 'warn')
    } finally {
      setLoadingQueue(false)
    }
  }

  useEffect(() => { void loadQueue(false) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter, desk, refreshKey])

  useEffect(() => {
    const events = isAgent
      ? ['support:assigned', 'support:revoked', 'support:updated']
      : ['support:queued', 'support:updated']
    const offs = events.map(event => onSocket(event, () => { void loadQueue() }))
    return () => offs.forEach(off => off())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAgent, filter, desk, search, activeId])

  // Debounced so typing a reference does not fire a query per keystroke.
  useEffect(() => {
    const id = setTimeout(() => { void loadQueue(false) }, 300)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  useEffect(() => {
    if (!activeId) { setMessages([]); return }
    let cancelled = false
    setLoadingThread(true)
    chatApi.messages(activeId)
      .then(res => { if (!cancelled) setMessages(res.data.items) })
      .catch(e => { if (!cancelled) toast(translatePortalText(e instanceof Error ? e.message : 'Could not load the conversation'), 'warn') })
      .finally(() => { if (!cancelled) setLoadingThread(false) })
    return () => { cancelled = true }
  }, [activeId])
  useEffect(() => {
    if (isAgent) supportApi.myAvailability().then(r => setAgentScopes(r.data.scopes)).catch(() => setAgentScopes([]))
  }, [isAgent])

  useEffect(() => {
    setPreview(null)
    setContext(null)
    setNotes([])
    if (!activeId) return
    let cancelled = false
    Promise.all([supportApi.context(activeId), supportApi.notes(activeId)]).then(([c, n]) => {
      if (!cancelled) { setContext(c.data); setNotes(n.data.items) }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [activeId])

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight
  }, [messages])

  const active = useMemo(() => threads.find(t => t._id === activeId) ?? null, [threads, activeId])

  /** Replace one thread in place, so acting on it does not re-sort the queue mid-click. */
  const patchThread = (chat: ApiChat) =>
    setThreads(list => list.map(t => (t._id === chat._id ? { ...t, ...chat } : t)))

  const send = async () => {
    if (!activeId || !draft.trim()) return
    setSending(true)
    try {
      const res = await chatApi.send(activeId, draft.trim())
      // Appended rather than refetched: the reply is already on screen the
      // instant it lands, and the whole page does not flash.
      setMessages(m => [...m, res.data.message])
      setDraft('')
      // Replying takes the ticket and flips it to "answered" server-side, so the
      // row's badge is now stale.
      const fresh = await chatApi.chat(activeId)
      patchThread(fresh.data.chat)
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Message not sent'), 'warn')
    } finally {
      setSending(false)
    }
  }

  const act = async (fn: () => Promise<{ data: { chat: ApiChat } }>, done: string) => {
    try {
      const res = await fn()
      patchThread(res.data.chat)
      toast(translatePortalText(done))
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'That did not work'), 'warn')
    }
  }

  /**
   * Both sides read through `idOf`: the sender arrives as a populated object
   * whose `id` is optional, and the session user's is absent entirely — so this
   * compared `undefined` to `undefined` and answered "not mine" for every
   * message, including the agent's own replies.
   */
  const mine = (m: ApiMessage) => {
    const me = idOf(user)
    return !!me && idOf(m.sender) === me
  }
  const isHandler = !!active && (idOf(active.support?.assignedTo) === idOf(user) ||
    (!active.support?.assignedTo && !!active.support?.deskOwner && idOf(active.support.deskOwner) === idOf(user)))
  // The server assigns an unclaimed platform case when an admin replies.
  const canReply = isHandler || (!!active && user?.role === 'admin' && !active.support?.assignedTo)
  const canTakeBack = !!active && !isHandler && !!active.support?.assignedTo &&
    (user?.role === 'admin' || idOf(active.support.deskOwner) === idOf(user))
  const actionScope = agentScopes.find(s => s.desk === active?.support?.desk &&
    (s.desk === 'admin' || s.ownerId === idOf(active?.support?.deskOwner)))
  const permittedActions = ACTION_KEYS.filter(key => !isAgent ||
    (actionScope && (READ_ACTION_KEYS.includes(key) || actionScope.grants.includes(key))))
  const addNote = async () => {
    if (!activeId || !noteDraft.trim()) return
    try {
      await supportApi.addNote(activeId, noteDraft.trim())
      setNotes((await supportApi.notes(activeId)).data.items)
      setNoteDraft('')
    } catch (e) { toast(e instanceof Error ? e.message : 'Note could not be saved', 'warn') }
  }
  const actionField: Record<string, { field: string; label: string }> = {
    'customer.correct_profile': { field: 'name', label: 'Correct name' },
    'provider.correct_profile': { field: 'businessName', label: 'Correct business name' },
    'trip.update': { field: 'title', label: 'Correct trip title' },
    'trip.cancel': { field: 'departureId', label: 'Departure ID' },
    'booking.correct_details': { field: 'notes', label: 'Correct booking note' },
    'booking.reschedule': { field: 'departureId', label: 'New departure ID' },
    'payment.refund': { field: 'amount', label: 'Refund amount (SAR)' },
    'payment.mark_issue': { field: 'issue', label: 'Describe the payment issue' },
  }
  const inputObject = (): Record<string, unknown> => {
    if (actionKey === 'trip.reschedule') {
      return { departureId: moveDepartureId.trim(), dateISO: moveDate, startTime: moveTime }
    }
    if (actionKey === 'customer.verify' || actionKey === 'provider.verify') {
      return { status: reviewStatus, ...(reviewStatus === 'rejected' ? { rejectionReason } : {}) }
    }
    const field = actionField[actionKey]?.field
    if (!field) return {}
    return { [field]: field === 'amount' ? Number(actionValue) : actionValue.trim() }
  }
  const previewAction = async () => {
    if (!activeId) return
    setActionBusy(true)
    try { setPreview((await supportApi.actionPreview(activeId, actionKey, entityId.trim(), inputObject())).data) }
    catch (e) { setPreview(null); toast(e instanceof Error ? e.message : 'Action preview failed', 'warn') }
    finally { setActionBusy(false) }
  }
  const executeAction = async () => {
    if (!activeId || !preview?.executable || !actionReason.trim()) return
    setActionBusy(true)
    try {
      const input = inputObject()
      const fingerprint = JSON.stringify([activeId, actionKey, entityId.trim(), input, actionReason.trim()])
      if (actionAttempt.current?.fingerprint !== fingerprint) {
        actionAttempt.current = { fingerprint, key: crypto.randomUUID() }
      }
      const result = await supportApi.actionExecute(activeId, actionKey, entityId.trim(), input,
        actionReason.trim(), actionAttempt.current.key)
      toast(result.data.action.status === 'pending_approval' ? 'Sent for Admin approval'
        : result.data.action.status === 'executing' ? 'Action is still processing; check its outcome before retrying'
          : result.data.action.status === 'completed' ? 'Action completed' : 'Action did not complete',
        result.data.action.status === 'failed' ? 'warn' : undefined)
      if (result.data.action.status !== 'executing') actionAttempt.current = null
      setPreview(null)
    } catch (e) { toast(e instanceof Error ? e.message : 'Action failed', 'warn') }
    finally { setActionBusy(false) }
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-extrabold text-deep-900">{translatePortalText(title)}</h2>
          {!!sub && <p className="text-xs text-slate-400">{translatePortalText(sub)}</p>}
        </div>
        <button onClick={() => void loadQueue()} className="btn-ghost !py-1.5 !px-3 !text-[11px]">
          <RefreshCw size={12} /> {translatePortalText("Refresh\n        ")}</button>
      </div>

      {stats && (
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          {([
            ['Needs reply', stats.open],
            ['Unassigned', stats.unassigned],
            ['Resolved today', stats.resolvedToday],
            ['Avg first reply', stats.avgFirstResponseMins, ' min'],
          ] as const).map(([label, value, suffix], i) => (
            <motion.div key={label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }} className="card p-3">
            <p className="font-display text-2xl font-extrabold text-deep-900">{typeof value === 'number' ? formatPortalNumber(value) : value}{suffix ? translatePortalText(suffix) : ''}</p>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText(label)}</p>
            </motion.div>
          ))}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {user?.role === 'admin' && <select className="input !w-auto !py-1.5 !text-xs" value={desk}
          onChange={e => setDesk(e.target.value as SupportDesk)} aria-label="Support desk">
          {(['admin', 'boat', 'marina', 'fuel', 'maintenance'] as SupportDesk[]).map(d => <option key={d} value={d}>{translatePortalText(`${d} desk`)}</option>)}
        </select>}
        {FILTERS.filter(f => !isAgent || f.key !== 'unassigned').map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`rounded-full px-3 py-1.5 text-[11px] font-bold ring-1 transition ${
              filter === f.key ? 'bg-deep-900 text-white ring-deep-900' : 'bg-white text-slate-500 ring-slate-200 hover:ring-slate-300'
            }`}>
            {translatePortalText(f.label)}
          </button>
        ))}
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={translatePortalText("Search subject or SUP- reference")}
          className="input !w-auto !min-w-[220px] flex-1 !py-1.5 !text-[12px]"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        {/* ── Queue ─────────────────────────────────────────── */}
        <div className="card max-h-[620px] overflow-y-auto p-1.5">
          {loadingQueue && threads.length === 0 && (
            <div className="flex justify-center py-14"><Spinner /></div>
          )}
          {!loadingQueue && threads.length === 0 && (
            <div className="py-14 text-center text-sm text-slate-400">
              <Inbox size={22} className="mx-auto mb-2 text-slate-300" />
              <p>{translatePortalText(filter === 'open' ? 'No requests need a reply right now.' : 'No requests match this view.')}</p>
              {filter !== 'all' && <button type="button" className="mt-3 font-bold text-ocean-700 underline" onClick={() => setFilter('all')}>{translatePortalText('Show all requests')}</button>}
            </div>
          )}
          {threads.map(thread => {
            const s = thread.support
            if (!s) return null
            const selected = thread._id === activeId
            const who = nameOf(s.openedBy) || translatePortalText('Unknown')
            return (
              <button key={thread._id} onClick={() => setActiveId(thread._id)}
                className={`flex w-full items-start gap-3 rounded-xl p-3 text-start transition ${
                  selected ? 'bg-sand' : 'hover:bg-slate-50'
                }`}>
                <Avatar
                  src={typeof s.openedBy === 'object' ? s.openedBy?.avatar : undefined}
                  name={who}
                  size={36}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[13px] font-extrabold text-deep-900">{thread.subject}</p>
                    {!!thread.unreadCount && (
                      <span className="shrink-0 rounded-full bg-ocean-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        {formatPortalNumber(thread.unreadCount)}
                      </span>
                    )}
                  </div>
                  <p className="truncate text-[11px] text-slate-400">
                    {who} · {s.reference}
                    {s.assignedTo ? ` · ${nameOf(s.assignedTo)}` : ''}
                  </p>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    {(() => {
                      const kind = requesterKind(s.openedBy)
                      const label = translatePortalText(kind.label)
                      return (
                        <span title={label} aria-label={label}
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold ring-1 ${kind.cls}`}>
                          {kind.letter}
                        </span>
                      )
                    })()}
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ring-1 ${STATUS_STYLE[s.status].cls}`}>
                      {translatePortalText(STATUS_STYLE[s.status].label)}
                    </span>
                    {s.priority !== 'normal' && (
                      <span className={`text-[10px] font-bold uppercase ${PRIORITY_STYLE[s.priority]}`}>
                        {translatePortalText(s.priority)}
                      </span>
                    )}
                    <span className="ms-auto text-[10px] text-slate-300">{fmtRelative(thread.updatedAt)}</span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {/* ── Conversation ──────────────────────────────────── */}
        <div className="card flex max-h-[620px] flex-col">
          {!active ? (
            <div className="flex flex-1 items-center justify-center py-20 text-sm text-slate-400">
              {translatePortalText("Pick a conversation to read it.\n            ")}</div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-[15px] font-extrabold text-deep-900">{active.subject}</p>
                  <p className="text-[11px] text-slate-400">
                    {active.support!.reference} · {nameOf(active.support!.openedBy)} ·{' '}
                    {translatePortalText(active.support!.desk === 'admin' ? 'Platform desk' : `${active.support!.desk} desk`)}
                    {active.createdAt ? ` · ${translatePortalText('opened ')}${fmtRelative(active.createdAt)}` : ''}
                  </p>
                </div>

                {!active.support!.assignedTo && !isAgent && (
                  <button
                    onClick={() => act(() => supportApi.assign(active._id), 'Assigned to you')}
                    className="btn-ghost !py-1.5 !px-2.5 !text-[11px]"
                  >
                    <UserPlus size={12} /> {translatePortalText("Assign me\n                  ")}</button>
                )}
                {canTakeBack && <button
                  className="btn-ghost !py-1.5 !px-2.5 !text-[11px]" onClick={() => {
                    const me = idOf(user)
                    if (me) void act(() => supportApi.transfer(active._id, me), 'Case transferred to you')
                  }}>{translatePortalText(user?.role === 'admin' ? 'Take over' : 'Take back')}</button>}

                <select
                  disabled={!isHandler}
                  value={active.support!.priority}
                  onChange={e => act(() => supportApi.setPriority(active._id, e.target.value as SupportPriority), 'Priority updated')}
                  className="input !w-auto !py-1.5 !text-[11px]"
                  aria-label={translatePortalText("Priority")}
                >
                  {(['low', 'normal', 'high', 'urgent'] as SupportPriority[]).map(p => (
                    <option key={p} value={p}>{translatePortalText(p)}</option>
                  ))}
                </select>

                {active.support!.status === 'resolved' ? (
                  <button
                    disabled={!isHandler}
                    onClick={() => act(() => supportApi.setStatus(active._id, 'open'), 'Reopened')}
                    className="btn-ghost !py-1.5 !px-2.5 !text-[11px] disabled:opacity-40"
                  >
                    {translatePortalText("Reopen\n                  ")}</button>
                ) : (
                  <button
                    disabled={!isHandler}
                    onClick={() => act(() => supportApi.setStatus(active._id, 'resolved'), 'Marked resolved')}
                    title={!isHandler ? translatePortalText('Take the case before resolving it') : undefined}
                    className="btn-admin !py-1.5 !px-2.5 !text-[11px] disabled:opacity-40"
                  >
                    <Check size={12} /> {translatePortalText("Resolve\n                  ")}</button>
                )}
              </div>

              <div ref={scroller} className="flex-1 space-y-2 overflow-y-auto bg-sand/40 p-4">
                {loadingThread && <div className="flex justify-center py-10"><Spinner /></div>}
                {!loadingThread && messages.length === 0 && (
                  <p className="py-10 text-center text-xs text-slate-400">
                    {translatePortalText("No messages yet — they opened this with a subject only.\n                  ")}</p>
                )}
                {messages.map(m => {
                  const isMine = mine(m)
                  return (
                    <div key={m._id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-[13px] ${
                        isMine ? 'bg-ocean-500 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-100'
                      }`}>
                        {!isMine && typeof m.sender === 'object' && m.sender && (
                          <p className="mb-0.5 text-[10px] font-bold opacity-60">{m.sender.name}</p>
                        )}
                        <p className="whitespace-pre-wrap break-words">{m.text}</p>
                        <p className={`mt-0.5 text-[10px] ${isMine ? 'text-white/60' : 'text-slate-400'}`}>
                          {fmtRelative(m.createdAt)}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="flex items-end gap-2 border-t border-slate-100 p-3">
                {isHandler && <button className="btn-ghost !px-2 !text-xs" type="button" onClick={async () => {
                  try { setDraft((await supportApi.suggestReply(active._id)).data.text) }
                  catch (e) { toast(e instanceof Error ? e.message : 'Suggestion unavailable', 'warn') }
                }}>Suggest</button>}
                <textarea
                  disabled={!canReply}
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => {
                    // Enter sends, Shift+Enter breaks the line — what every
                    // messaging tool an agent has ever used does.
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() }
                  }}
                  placeholder={translatePortalText(!isHandler && canReply ? 'Write a reply to take this case…' : 'Write a reply…')}
                  rows={2}
                  className="input min-h-[46px] flex-1 resize-none !text-[13px]"
                />
                <button onClick={() => void send()} disabled={!canReply || sending || !draft.trim()}
                  className="btn-admin !px-3.5 disabled:opacity-40">
                  {sending ? <Spinner /> : <Send size={14} />}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      {active && <details className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
        <summary className="cursor-pointer text-sm font-bold text-deep-900">{translatePortalText('Case details and tools')}</summary>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="card space-y-3 p-4">
          <h3 className="font-bold text-deep-900">Case context and private notes</h3>
          <p className="text-xs text-slate-500">{context?.handlingState || active.support?.handlingState || translatePortalText('Loading')} · {context?.reference}</p>
          {context?.handoff && <div className="rounded-xl bg-sand p-3 text-sm">
            <p className="font-semibold">Handoff: {context.handoff.reason}</p>
            <p className="mt-1 whitespace-pre-wrap">{context.handoff.summary || translatePortalText('No summary was available.')}</p>
            {context.handoff.context && <p className="mt-1 text-xs text-slate-500">{Object.entries(context.handoff.context).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>}
            {!!context.handoff.completedTools?.length && <p className="mt-1 text-xs text-slate-500">Completed checks: {context.handoff.completedTools.map(t => t.tool).join(', ')}</p>}
          </div>}
          <div className="max-h-44 space-y-2 overflow-y-auto">{notes.map(note => <div key={note._id} className="rounded-lg bg-slate-50 p-2 text-sm">
            <p>{note.body}</p><p className="text-xs text-slate-400">{nameOf(note.actor)} · {fmtRelative(note.createdAt)}</p></div>)}</div>
          <div className="flex gap-2"><input className="input flex-1" value={noteDraft} onChange={e => setNoteDraft(e.target.value)} placeholder="Private note" />
            <button className="btn-ghost" disabled={!noteDraft.trim()} onClick={() => void addNote()}>Add note</button></div>
        </section>
        {(isAgent || user?.role === 'admin') && <section className="card space-y-3 p-4">
          <h3 className="font-bold text-deep-900">Case actions</h3>
          <p className="text-xs text-slate-500">Preview the record and consequence before sending a command.</p>
          <select className="input w-full" value={actionKey} onChange={e => { setActionKey(e.target.value); setActionValue(''); setPreview(null) }}>
            {permittedActions.map(key => <option key={key} value={key}>{key.replace(/[.]/g, ' · ').replace(/_/g, ' ')}</option>)}
          </select>
          <input className="input w-full" value={entityId} onChange={e => { setEntityId(e.target.value); setPreview(null) }} placeholder="Record ID" />
          {actionField[actionKey] && <label className="block text-sm">{translatePortalText(actionField[actionKey].label)}
            <input className="input mt-1 w-full" type={actionKey === 'payment.refund' ? 'number' : 'text'}
              value={actionValue} onChange={e => { setActionValue(e.target.value); setPreview(null) }} /></label>}
          {actionKey === 'trip.reschedule' && <div className="grid gap-2 sm:grid-cols-3">
            <label className="text-sm">Departure ID<input className="input mt-1 w-full" value={moveDepartureId}
              onChange={e => { setMoveDepartureId(e.target.value); setPreview(null) }} /></label>
            <label className="text-sm">New date<input className="input mt-1 w-full" type="date" value={moveDate}
              onChange={e => { setMoveDate(e.target.value); setPreview(null) }} /></label>
            <label className="text-sm">New time<input className="input mt-1 w-full" type="time" value={moveTime}
              onChange={e => { setMoveTime(e.target.value); setPreview(null) }} /></label>
          </div>}
          {(actionKey === 'customer.verify' || actionKey === 'provider.verify') && <div className="space-y-2">
            <select className="input w-full" value={reviewStatus} onChange={e => { setReviewStatus(e.target.value as 'approved' | 'rejected'); setPreview(null) }}>
              <option value="approved">Approve document</option><option value="rejected">Reject document</option></select>
            {reviewStatus === 'rejected' && <input className="input w-full" placeholder="Rejection reason" value={rejectionReason}
              onChange={e => { setRejectionReason(e.target.value); setPreview(null) }} />}</div>}
          <button className="btn-ghost" disabled={actionBusy || !entityId.trim() || !isHandler} onClick={() => void previewAction()}>Preview action</button>
          {preview && <div className="rounded-xl bg-sand p-3 text-xs"><p className="font-semibold">{translatePortalText(preview.requiresApproval ? 'Requires Admin approval' : preview.executable ? 'Ready to execute' : 'Read only')}</p>
            <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap">{JSON.stringify(preview.entity, null, 2)}</pre></div>}
          {preview?.executable && <div className="flex gap-2"><input className="input flex-1" value={actionReason} onChange={e => setActionReason(e.target.value)} placeholder="Reason for action" />
            <button className="btn-admin" disabled={actionBusy || !actionReason.trim()} onClick={() => void executeAction()}>Submit</button></div>}
        </section>}
        </div>
      </details>}
    </div>
  )
}
