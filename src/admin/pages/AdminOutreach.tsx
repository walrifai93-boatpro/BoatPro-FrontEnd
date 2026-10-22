import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ChatAttachments } from '../../shared/ChatAttachments'
import { MessageContent, MessageTags, messageKindLabel, isMine, localizeMessagePreview } from '../../shared/MessageContent'
import { motion } from 'framer-motion'
import { Send, Search, MessageSquarePlus, Inbox, RefreshCw, CornerDownRight, X } from 'lucide-react'
import {
  adminPortalApi,
  chatApi,
  fileUrl,
  type AdminPortalUser,
  type ApiChat,
  type ApiMessage,
  type ApiSubscriber,
} from '../../api'
import { translatePortalText, formatPortalNumber } from '../../i18n/runtime'
import { toast, Spinner, Avatar } from '../../ui'
import { useAuth } from '../../auth'
import { fmtRelative } from '../../live'

/**
 * Admin-initiated conversations.
 *
 * The Support Center answers threads other people raise. It has no way to *start*
 * one — so an admin who needed to reach a provider about an expiring licence, an
 * overdue statement or a rejected document had no route to them at all, despite
 * the backend having allowed admin-to-anyone messaging the whole time.
 *
 * Deliberately separate from `SupportConsole` rather than bolted onto it. A
 * support thread is a ticket: it has a desk, a reference, a status somebody is
 * accountable for closing, and it exists because a customer asked for something.
 * Outreach is the opposite direction and carries none of that, so it is a plain
 * direct thread and gets its own, simpler surface.
 */

const PROVIDER_ROLES = [
  { value: '', label: 'All providers' },
  { value: 'boat_provider', label: 'Boat' },
  { value: 'marina_provider', label: 'Marina' },
  { value: 'fuel_provider', label: 'Fuel' },
  { value: 'maintenance_provider', label: 'Maintenance' },
  { value: 'customer', label: 'Customers' },
]

/** Every provider role this console may open a conversation with, when none is chosen. Customers have their own chip. */
const ALL_PROVIDER_ROLES = PROVIDER_ROLES.filter(r => r.value && r.value !== 'customer').map(r => r.value)

const displayName = (p: ApiSubscriber | undefined): string =>
  (p && (p.business?.businessName || p.name)) || 'Unknown'

/**
 * An id from anything the API hands back.
 *
 * Mongo documents cross the wire with `_id`; the virtual `id` is only present on
 * payloads that were serialised with it, and the session user is one of the ones
 * where it is not. Reading `id` alone therefore produced an empty string for the
 * signed-in admin — which made "the participant who is not me" match the *first*
 * participant, so every conversation was labelled with the admin's own name and
 * every message the admin sent rendered as if it had been received.
 */
const idOf = (x: { _id?: string; id?: string } | null | undefined): string =>
  String(x?._id ?? x?.id ?? '')

export function AdminOutreach() {
  const { user } = useAuth()
  const meId = idOf(user)

  const [threads, setThreads] = useState<ApiChat[]>([])
  const [loadingThreads, setLoadingThreads] = useState(true)
  // A failed load used to fall through to "No conversations yet", which reads as
  // a fact about the inbox rather than about the request.
  const [threadsError, setThreadsError] = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ApiMessage[]>([])
  const [loadingThread, setLoadingThread] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [tab, setTab] = useState<'threads' | 'directory'>('directory')
  const [startingWith, setStartingWith] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  /**
   * The admin's own direct threads.
   *
   * `myChats` returns every kind; support and booking threads have their own
   * screens, and the system thread is the platform talking to itself. Filtering
   * to `direct` here keeps this list to conversations somebody actually had.
   */
  const loadThreads = async (keepActive = true) => {
    setLoadingThreads(true)
    try {
      const res = await chatApi.myDirectChats()
      const direct = res.data.items.filter(c => c.type === 'direct')
      setThreads(direct)
      setThreadsError('')
      if (!keepActive || !direct.some(c => (c.id ?? c._id) === activeId)) {
        setActiveId(direct[0] ? (direct[0].id ?? direct[0]._id) : null)
      }
    } catch (e) {
      const message = translatePortalText(e instanceof Error ? e.message : 'Could not load conversations')
      // Only an empty list is replaced by the error; a failed refresh keeps the
      // threads already on screen and says so in a toast.
      if (!threads.length) setThreadsError(message)
      toast(message, 'warn')
    } finally {
      setLoadingThreads(false)
    }
  }

  useEffect(() => { void loadThreads(false) }, [])

  /**
   * Opens the thread with someone from the directory and switches to it.
   *
   * `chats.create` is idempotent — it returns the existing thread when there is
   * one — so clicking a provider you have already written to continues that
   * conversation instead of starting a second.
   */
  const startWith = async (userId: string) => {
    setStartingWith(userId)
    try {
      const res = await chatApi.create(userId)
      const id = res.data.chat.id ?? res.data.chat._id
      await loadThreads(false)
      setActiveId(id)
      setTab('threads')
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not open that conversation'), 'warn')
    } finally {
      setStartingWith(null)
    }
  }

  useEffect(() => {
    if (!activeId) { setMessages([]); return }
    /*
      `alive` is about correctness here, not cleanup.

      Clicking from one conversation to another fires a second `messages()`
      before the first has answered. If the first is slower it resolves last and
      writes its messages into the pane now headed by the second person — one
      provider's conversation displayed under another's name. Discarding a
      superseded response is the only thing that prevents it.
    */
    let alive = true
    setLoadingThread(true)
    chatApi
      .messages(activeId)
      .then(res => {
        if (!alive) return
        setMessages(res.data.items)
        // Opening a thread is reading it — otherwise the badge never clears.
        void chatApi.markRead(activeId).then(() => {
          setThreads(prev => prev.map(t => ((t.id ?? t._id) === activeId ? { ...t, unreadCount: 0 } : t)))
        })
      })
      .catch(e => { if (alive) toast(translatePortalText(e instanceof Error ? e.message : 'Could not open that conversation'), 'warn') })
      .finally(() => { if (alive) setLoadingThread(false) })
    return () => { alive = false }
  }, [activeId])

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [messages])

  const active = useMemo(
    () => threads.find(t => (t.id ?? t._id) === activeId) ?? null,
    [threads, activeId]
  )

  /**
   * The person on the other side — the one whose name belongs in the header.
   *
   * Falls back to the sole participant rather than to `participants[0]`: if the
   * comparison ever fails to identify us again, showing nothing is a visible bug,
   * whereas silently showing our own name looks like a working screen.
   */
  const counterpart = (chat: ApiChat): ApiSubscriber | undefined => {
    const others = chat.participants?.filter(p => idOf(p) !== meId) ?? []
    return others[0]
  }

  /**
   * The message being answered.
   *
   * A mode the composer is in, so it needs a visible indicator — a reply target
   * with nothing on screen is one people forget they armed, and the next unrelated
   * message then quotes something they had stopped thinking about.
   */
  const [replyTo, setReplyTo] = useState<ApiMessage | null>(null)

  const send = async () => {
    const text = draft.trim()
    // Enter bypasses the disabled send button, so a quick double Enter sent twice.
    if (!text || !activeId || sending) return
    setSending(true)
    try {
      const res = await chatApi.send(activeId, text, {
        replyTo: replyTo?._id ?? replyTo?.id,
      })
      setMessages(prev => [...prev, res.data.message])
      setDraft('')
      // Consumed by the send. Left armed is how the next message becomes an
      // accidental reply.
      setReplyTo(null)
      void loadThreads()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not send that message'), 'warn')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="card mb-5 p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-extrabold text-deep-900">{translatePortalText("Direct messages")}</h3>
          <p className="text-xs text-slate-400">
            {translatePortalText("Conversations the platform started — reach any provider, customer or crew member.")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void loadThreads()} className="btn-ghost !py-1.5 !px-3 !text-[11px]">
            <RefreshCw size={12} /> {translatePortalText("Refresh")}
          </button>
          <button onClick={() => setTab('directory')} className="btn-admin !py-1.5 !px-3 !text-[11px]">
            <MessageSquarePlus size={13} /> {translatePortalText("New message")}
          </button>
        </div>
      </div>

      {/*
        Two lists behind one pair of tabs, rather than a directory hidden inside a
        modal. The first version put "who can I message" behind a button, so the
        screen's whole answer to "reach any provider" was an empty box — the
        people were there, just invisible. Directory is the default while there
        are no conversations, because that is the only useful thing to show.
      */}
      <div className="mb-3 flex gap-1.5">
        {(['threads', 'directory'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-3 py-1.5 text-[11px] font-bold ring-1 transition ${
              tab === t
                ? 'bg-deep-900 text-white ring-deep-900'
                : 'bg-white text-slate-500 ring-slate-200 hover:ring-slate-300'
            }`}
          >
            {t === 'threads' ? `${translatePortalText('Conversations')}${threads.length ? ` (${formatPortalNumber(threads.length)})` : ''}` : translatePortalText('Everyone you can message')}
          </button>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
        {/* ── Threads ─────────────────────────────────── */}
        {tab === 'directory' ? (
          <Directory onPick={startWith} busyId={startingWith} />
        ) : (
        <div className="h-[70vh] min-h-[420px] max-h-[720px] overflow-y-auto rounded-xl border border-slate-100">
          {loadingThreads ? (
            <div className="flex justify-center py-12"><Spinner /></div>
          ) : threadsError && !threads.length ? (
            <div className="px-4 py-12 text-center text-xs text-rose-600">
              <p className="mb-3 font-semibold">{threadsError}</p>
              <button onClick={() => void loadThreads(false)} className="btn-ghost !py-1.5 !px-3 !text-[11px]">
                <RefreshCw size={12} /> {translatePortalText('Try again')}
              </button>
            </div>
          ) : !threads.length ? (
            <div className="px-4 py-12 text-center text-xs text-slate-400">
              <Inbox size={20} className="mx-auto mb-2 text-slate-300" />
              {translatePortalText("No conversations yet — open “Everyone you can message”.")}
            </div>
          ) : (
            threads.map(t => {
              const id = t.id ?? t._id
              const other = counterpart(t)
              return (
                <button
                  key={id}
                  onClick={() => setActiveId(id)}
                  className={`flex w-full items-start gap-2.5 border-b border-slate-50 px-3 py-2.5 text-start last:border-0 transition ${
                    id === activeId ? 'bg-ocean-50/70' : 'hover:bg-slate-50'
                  }`}
                >
                  <Avatar name={displayName(other)} src={fileUrl(other?.avatar)} size={30} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-[12px] font-bold text-deep-900">{displayName(other)}</p>
                      {!!t.unreadCount && (
                        <span className="shrink-0 rounded-full bg-ocean-500 px-1.5 text-[10px] font-bold text-white">
                          {formatPortalNumber(t.unreadCount)}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-[11px] text-slate-400">
                      {t.lastMessage?.text ? localizeMessagePreview(t.lastMessage.text) : translatePortalText('No messages yet')}
                    </p>
                    <p className="text-[10px] text-slate-300">{fmtRelative(t.updatedAt)}</p>
                  </div>
                </button>
              )
            })
          )}
        </div>
        )}

        {/* ── Conversation ────────────────────────────── */}
        {/*
          A fixed height, not a minimum.
          `min-h` let this column grow with the conversation, so the inner
          `overflow-y-auto` never had a bounded box to scroll inside — it stretched
          the page instead, pushing the composer below the fold and leaving the
          reader to scroll the whole document to reach the newest message. A fixed
          height is what makes the message list scroll and the composer stay put.
          `h-[70vh]` on a tall screen, floored so a laptop still shows a usable
          pane, and capped so it never outgrows the viewport.
        */}
        <div className="flex h-[70vh] min-h-[420px] max-h-[720px] flex-col rounded-xl border border-slate-100">
          {!active ? (
            <div className="flex flex-1 items-center justify-center text-xs text-slate-400">
              {translatePortalText("Pick a conversation to read it.")}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2.5 border-b border-slate-100 px-3.5 py-2.5">
                <Avatar name={displayName(counterpart(active))} src={counterpart(active)?.avatar} size={30} />
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-bold text-deep-900">{displayName(counterpart(active))}</p>
                  <p className="text-[10.5px] text-slate-400">{translatePortalText(counterpart(active)?.role ?? 'Direct conversation')}</p>
                </div>
              </div>

              <div ref={scroller} className="flex-1 space-y-2 overflow-y-auto px-3.5 py-3">
                {loadingThread ? (
                  <div className="flex justify-center py-10"><Spinner /></div>
                ) : !messages.length ? (
                  <p className="py-10 text-center text-xs text-slate-400">{translatePortalText("No messages yet — say something.")}</p>
                ) : (
                  messages.map(m => {
                    // The server's own flag, with the id comparison as the
                    // fallback for socket-delivered messages. See `isMine`.
                    const mine = isMine(m, meId)
                    return (
                      <motion.div
                        key={m.id ?? m._id}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`flex ${mine ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`group max-w-[78%] rounded-2xl px-3 py-2 text-[12px] ${
                            mine ? 'bg-deep-900 text-white' : 'bg-sand text-deep-900'
                          }`}
                        >
                          {/*
                            The desk sees whatever a provider actually sent.

                            This drew `m.text` alone, so an image, a document or a
                            shared report arrived as an empty bubble — the agent had
                            no idea an attachment existed, and the provider had no
                            way to tell it had not been seen.
                          */}
                          <MessageContent m={m} mine={mine} />
                          <MessageTags tags={m.tags} mine={mine} />
                          {/* Reply, on hover. A permanent control on every bubble
                              is clutter for an action taken on one message in
                              fifty; on a pointer device, hover is free. */}
                          <button
                            type="button"
                            onClick={() => setReplyTo(m)}
                            className={`mt-1 text-[9.5px] font-bold underline opacity-0 transition group-hover:opacity-100 ${
                              mine ? 'text-white/70' : 'text-ocean-600'
                            }`}
                          >
                            {translatePortalText('Reply')}
                          </button>
                          <p className={`mt-1 text-[9.5px] ${mine ? 'text-white/50' : 'text-slate-400'}`}>
                            {fmtRelative(m.createdAt)}
                          </p>
                        </div>
                      </motion.div>
                    )
                  })
                )}
              </div>

              {/*
                What is being replied to, above the input.

                The reply target is a mode, and a mode with no visible indicator is
                one people forget they are in — the next message then quotes
                something they had stopped thinking about.
              */}
              {!!replyTo && (
                <div className="mx-2.5 mt-2 flex items-start gap-2 rounded-lg border-s-2 border-ocean-500 bg-sand px-2.5 py-1.5">
                  <CornerDownRight size={12} className="mt-0.5 shrink-0 text-ocean-600" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[9.5px] font-bold text-ocean-700">{translatePortalText("Replying to this message")}</p>
                    <p className="line-clamp-2 text-[10.5px] text-slate-500">
                      {replyTo.text || messageKindLabel(replyTo.type)}
                    </p>
                  </div>
                  <button
                    onClick={() => setReplyTo(null)}
                    className="btn-ghost !px-1 !py-1"
                    aria-label={translatePortalText("Cancel reply")}
                  >
                    <X size={12} />
                  </button>
                </div>
              )}

              <div className="flex items-end gap-2 border-t border-slate-100 p-2.5">
                <textarea
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => {
                    // Enter sends, Shift+Enter breaks the line — what every chat does.
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() }
                  }}
                  rows={2}
                  placeholder={replyTo ? translatePortalText('Write your reply…') : translatePortalText('Write a message…')}
                  className="input !mt-0 flex-1 resize-none !py-1.5 !text-[12px]"
                />
                {/*
                  Attaching, next to the input rather than inside a menu.

                  The desk could read a certificate a provider had attached and had
                  no way to send one back — the composer was a text box and a send
                  button. Two glyphs is the whole cost of closing that.
                */}
                {!!activeId && (
                  <ChatAttachments
                    chatId={activeId}
                    replyTo={replyTo?._id ?? replyTo?.id}
                    accentClass="btn-admin"
                    disabled={sending}
                    onSent={m => {
                      setMessages(prev => [...prev, m])
                      setReplyTo(null)
                      void loadThreads()
                    }}
                  />
                )}
                <button
                  onClick={() => void send()}
                  disabled={sending || !draft.trim()}
                  className="btn-admin !py-2 !px-3 !text-[11px] disabled:opacity-40"
                >
                  {sending ? <Spinner size={12} /> : <Send size={13} />}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Everyone this console may open a conversation with.
 *
 * Shown as a list on the page rather than inside a modal. The point of this panel
 * is "reach any provider", and a directory you have to press a button to
 * discover answers that with an empty box — which is exactly how it read.
 *
 * The rows come from the admin user directory, which already searches name,
 * business and email, so people appear under the names the rest of the console
 * uses for them.
 */
function Directory({
  onPick,
  busyId,
}: {
  onPick: (userId: string) => void
  busyId: string | null
}) {
  const [role, setRole] = useState('')
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [results, setResults] = useState<AdminPortalUser[]>([])
  // How many matched across the roles asked, against how many came back — the
  // directory takes 25 a role, and a list that stops silently reads as everyone.
  const [matched, setMatched] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 300)
    return () => clearTimeout(id)
  }, [query])

  useEffect(() => {
    setLoading(true)
    // The directory endpoint takes one role, so "all" is one request per
    // provider role rather than a list parameter it does not support.
    const roles = role ? [role] : ALL_PROVIDER_ROLES
    /*
      Debouncing narrows this race but does not close it: two searches 300 ms
      apart are still two in flight, and "abc" answering after "abcd" leaves the
      wider result set under the narrower query. With `all` selected this is one
      request per provider role, so there is more in flight than it looks.
    */
    let alive = true
    // Active accounts only: the server refuses a thread with a deactivated one
    // ("User not found"), so listing them offered a click that could only fail.
    Promise.all(roles.map(r => adminPortalApi.users({ role: r, q: debounced || undefined, limit: 25, active: true })))
      .then(pages => {
        if (!alive) return
        setResults(pages.flatMap(p => p.data.items))
        setMatched(pages.reduce((n, p) => n + (p.data.pagination?.total ?? p.data.items.length), 0))
      })
      .catch(e => {
        if (!alive) return
        setResults([])
        setMatched(0)
        toast(translatePortalText(e instanceof Error ? e.message : 'Could not load the directory'), 'warn')
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [role, debounced])

  return (
    // Same fixed height as the thread list it swaps with, so switching tabs does
    // not resize the whole row underneath the reader.
    <div className="flex h-[70vh] min-h-[420px] max-h-[720px] flex-col rounded-xl border border-slate-100">
      <div className="space-y-2 border-b border-slate-100 p-2.5">
        <div className="flex flex-wrap gap-1">
          {PROVIDER_ROLES.map(r => (
            <button
              key={r.value}
              onClick={() => setRole(r.value)}
              className={`rounded-full px-2 py-1 text-[10px] font-bold ring-1 transition ${
                role === r.value
                  ? 'bg-ocean-500 text-white ring-ocean-500'
                  : 'bg-white text-slate-500 ring-slate-200 hover:ring-slate-300'
              }`}
            >
              {translatePortalText(r.label)}
            </button>
          ))}
        </div>
        <label className="relative block">
          <Search size={13} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={translatePortalText("Search name, business or email…")}
            className="input !mt-0 !py-1.5 !ps-7 !text-[11.5px]"
          />
        </label>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : !results.length ? (
          <p className="px-4 py-12 text-center text-xs text-slate-400">{translatePortalText("Nobody matches that.")}</p>
        ) : (<>
          {matched > results.length && (
            <p className="border-b border-slate-50 bg-sand/60 px-3 py-1.5 text-[10.5px] text-slate-500">
              {translatePortalText('Showing')} {formatPortalNumber(results.length)} {translatePortalText('of')} {formatPortalNumber(matched)} — {translatePortalText('search to narrow the list')}
            </p>
          )}
          {results.map(u => {
            const id = u.id ?? (u as unknown as { _id: string })._id
            return (
              <button
                key={id}
                onClick={() => onPick(id)}
                disabled={busyId !== null}
                className="flex w-full items-center gap-2.5 border-b border-slate-50 px-3 py-2 text-start transition last:border-0 hover:bg-slate-50 disabled:opacity-50"
              >
                <Avatar name={u.business?.businessName || u.name} src={fileUrl(u.avatar)} size={28} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-bold text-deep-900">
                    {u.business?.businessName || u.name}
                  </p>
                  <p className="truncate text-[10.5px] text-slate-400">{u.email} · {translatePortalText(u.role)}</p>
                </div>
                {busyId === id ? <Spinner size={12} /> : <MessageSquarePlus size={13} className="shrink-0 text-slate-300" />}
              </button>
            )
          })}
        </>)}
      </div>
    </div>
  )
}
