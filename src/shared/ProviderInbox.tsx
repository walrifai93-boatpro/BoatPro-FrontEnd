import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Bot, Headset, Inbox, LifeBuoy, Loader2, MessageSquare, Plus, RefreshCw, Send } from 'lucide-react'
import { aiSupportApi, chatApi, get, idOf, type ApiChat, type ApiMessage, type ApiSupport, type Ok, type Paginated, type SupportDesk } from '../api'
import { useAuth } from '../auth'
import { fmtRelative } from '../live'
import { formatPortalNumber, translatePortalText } from '../i18n/runtime'
import { getSocket, onSocket } from '../socket'
import { Spinner, toast } from '../ui'
import { ChatAttachments } from './ChatAttachments'
import { MessageContent, isAssistantMessage, isMine, localizeMessagePreview } from './MessageContent'
import { NewThreadModal } from './ProviderSupport'
import { SupportConsole } from './SupportConsole'

const MarinaMessages = React.lazy(() => import('../pages/Engage').then(m => ({ default: m.Messaging })))
const FuelMessages = React.lazy(() => import('../fuel/pages/FuelEngage').then(m => ({ default: m.FuelMessages })))
const MaintMessages = React.lazy(() => import('../maint/pages/MaintEngage').then(m => ({ default: m.MaintMessages })))

type View = 'messages' | 'help' | 'cases'

/** The server's cap per text message (`sendMessageSchema`). */
const MESSAGE_MAX = 4000
/** Messages per page of history — the most the messages route returns at once. */
const PAGE_SIZE = 100

const DESK_LABEL: Record<SupportDesk, string> = {
  admin: 'BoatPro', marina: 'Marina', fuel: 'Fuel provider', maintenance: 'Maintenance provider', boat: 'Boat provider',
}

/**
 * Who a request went to: the business by name when the desk is a provider's
 * (the API populates it), otherwise the desk. It used to be built as
 * `${desk} provider`, which no translation could match.
 */
function deskName(support?: ApiSupport): string {
  if (!support) return ''
  const owner = typeof support.deskOwner === 'object' && support.deskOwner ? support.deskOwner : undefined
  const business = owner?.business?.businessName || owner?.name
  if (support.desk !== 'admin' && business) return business
  return translatePortalText(DESK_LABEL[support.desk] ?? support.desk)
}

/**
 * Where a request stands, in the requester's terms. "Open" alone said nothing
 * about who has it — whether the assistant, the queue or a named agent.
 */
function requestStatus(chat: ApiChat): string {
  const support = chat.support
  if (support?.status === 'resolved' || support?.handlingState === 'resolved' || support?.handlingState === 'closed') return 'Resolved'
  if (support?.status === 'pending' || support?.handlingState === 'waiting_customer') return 'Your reply needed'
  if (support?.handlingState === 'ai_active') return 'AI assistant available'
  if (support?.assignedTo || support?.handlingState === 'assigned' || support?.handlingState === 'in_progress') return 'With a support agent'
  if (support?.handlingState === 'queued') return 'Waiting for a support agent'
  return 'Open'
}

export default function ProviderInbox() {
  const { user, fuelAccess, maintAccess, marinaAccess } = useAuth()
  const [params, setParams] = useSearchParams()
  const isFuel = user?.role === 'fuel_provider' || user?.role === 'fuel_worker'
  const isMaint = user?.role === 'maintenance_provider' || user?.role === 'maintenance_worker'
  const canMessage = isFuel
    ? !fuelAccess || fuelAccess.isOwner || fuelAccess.permissions.includes('messages')
    : isMaint
      ? !maintAccess || maintAccess.isOwner || maintAccess.permissions.includes('messages')
      // Marina staff talk to boaters only from the bookings / dock desks.
      : user?.role === 'marina_worker'
        ? !!marinaAccess && marinaAccess.permissions.some((p) => p === 'manage_bookings' || p === 'check_in')
        : true
  const canHandleCases = !!user && ['boat_provider', 'marina_provider', 'fuel_provider', 'maintenance_provider'].includes(user.role)
  const requested = params.get('view')
  const view: View = requested === 'cases' && canHandleCases ? 'cases'
    : requested === 'messages' && canMessage ? 'messages'
      : requested === 'help' ? 'help' : canMessage ? 'messages' : 'help'
  const selectView = (next: View) => setParams({ view: next })
  const billingUrl = isFuel ? '/fuel/billing' : isMaint ? '/maint/billing'
    : user?.role === 'boat_provider' ? '/boat/billing' : '/billing'
  const accentClass = isFuel ? 'btn-fuel' : isMaint ? 'btn-maint' : 'btn-primary'

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 font-display text-2xl font-extrabold text-deep-900">
          <Inbox size={24} className="text-ocean-500" /> {translatePortalText('Inbox & Help')}
        </h1>
        <p className="mt-1 text-sm text-slate-500">{translatePortalText('Read messages, ask BoatPro for help, or answer cases sent to your business.')}</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" role="tablist" aria-label={translatePortalText('Inbox sections')}>
        {([
          canMessage && { key: 'messages' as View, icon: MessageSquare, label: 'Messages', description: 'Talk with customers and other providers.' },
          { key: 'help' as View, icon: LifeBuoy, label: 'Get help', description: 'Your requests to BoatPro and other support desks.' },
          canHandleCases && { key: 'cases' as View, icon: Headset, label: 'Customer cases', description: 'Answer requests sent to your business.' },
        ].filter(Boolean) as { key: View; icon: typeof Inbox; label: string; description: string }[]).map(item => (
          <button key={item.key} type="button" role="tab" aria-selected={view === item.key}
            onClick={() => selectView(item.key)}
            className={`rounded-2xl border p-4 text-start transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500 ${view === item.key ? 'border-ocean-400 bg-ocean-50 shadow-sm' : 'border-slate-200 bg-white hover:border-ocean-200'}`}>
            <span className="flex items-center gap-2 font-bold text-deep-900"><item.icon size={17} className="text-ocean-600" />{translatePortalText(item.label)}</span>
            <span className="mt-1 block text-xs text-slate-500">{translatePortalText(item.description)}</span>
          </button>
        ))}
      </div>

      {view === 'messages' && <Suspense fallback={<div className="card p-8 text-center"><Spinner /></div>}>
        {isFuel ? <FuelMessages /> : isMaint ? <MaintMessages /> : <MarinaMessages directOnly />}
      </Suspense>}
      {view === 'help' && <>
        {/* `?view=help&chat=<id>` opens that request — a link from a
            notification or an email lands on the thread, not the first one. */}
        <MySupportRequests accentClass={accentClass} initialChatId={params.get('chat')} />
        <p className="text-xs text-slate-500">
          {translatePortalText('Looking for earnings, invoices or payouts? Open')}{' '}
          <Link className="font-bold text-ocean-700 underline" to={billingUrl}>{translatePortalText('Billing & Payments')}</Link>.
        </p>
      </>}
      {view === 'cases' && <SupportConsole title="Customer cases" sub="Requests sent to your business. Choose a case to read it and reply." />}
    </div>
  )
}

type ThreadMessage = ApiMessage & { pending?: boolean }

/** Who wrote a message the viewer did not: the assistant, a system notice, or a person. */
function authorOf(m: ApiMessage): 'assistant' | 'notice' | 'person' {
  if (isAssistantMessage(m)) return 'assistant'
  return (m as ApiMessage & { kind?: string }).kind === 'system' ? 'notice' : 'person'
}

/** Whether the assistant, rather than a person, answers the next message in this thread. */
function assistantAnswers(chat: ApiChat | undefined): boolean {
  const state = chat?.support?.handlingState
  // Queued: handed to people, and the assistant keeps answering until one picks it up.
  return !chat?.support?.assignedTo && (state === 'ai_active' || state === 'queued')
}

function MySupportRequests({ accentClass, initialChatId }: { accentClass: string; initialChatId?: string | null }) {
  const { user } = useAuth()
  const me = idOf(user)
  const [threads, setThreads] = useState<ApiChat[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ThreadMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  /*
    History beyond the newest page. The route returns the latest 100, and a
    longer request used to lose everything before that with no way back to it.
  */
  const [historyPage, setHistoryPage] = useState(1)
  const [hasOlder, setHasOlder] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  /** Set while older messages are prepended, so the view stays where the reader was instead of jumping to the bottom. */
  const keepScroll = useRef<number | null>(null)
  const initialChatRef = useRef(initialChatId)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [composing, setComposing] = useState(false)
  /** The server says someone in the thread is typing (the assistant has no user id). */
  const [typing, setTyping] = useState<'assistant' | 'person' | null>(null)
  /** Sent, and the assistant has not answered yet — shown as typing until it does. */
  const [awaitingReply, setAwaitingReply] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const activeRef = useRef<string | null>(null)
  activeRef.current = activeId

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const res = await chatApi.mySupportChats()
      const mine = res.data.items.filter(c => c.type === 'support' && idOf(c.support?.openedBy) === me)
      setThreads(mine)
      const linked = initialChatRef.current
      initialChatRef.current = null
      setActiveId(current => current && mine.some(c => idOf(c) === current) ? current
        : linked && mine.some(c => idOf(c) === linked) ? linked
          : idOf(mine[0]) || null)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your help requests')
    } finally { setLoading(false) }
  }, [me])

  // Many socket events arrive together (a reply updates the thread, the inbox
  // and the preview at once), so the list refreshes once for a burst of them.
  const reloadTimer = useRef<number | undefined>(undefined)
  const scheduleReload = useCallback(() => {
    window.clearTimeout(reloadTimer.current)
    reloadTimer.current = window.setTimeout(() => { void reload() }, 400)
  }, [reload])
  useEffect(() => () => window.clearTimeout(reloadTimer.current), [])

  /** A message that arrived, added once; it also settles the "sending" copy of our own. */
  const addMessage = useCallback((incoming: ApiMessage) => {
    const own = isMine(incoming, me)
    if (!own) {
      setAwaitingReply(false)
      setTyping(null)
      // It arrived in the thread on screen, so it has been read. Without this
      // the list reload a moment later put an unread badge on the open request.
      if (activeRef.current) void chatApi.markRead(activeRef.current).catch(() => null)
    }
    setMessages(list => {
      if (list.some(m => idOf(m) === idOf(incoming))) return list
      const rest = own ? list.filter(m => !(m.pending && m.text === incoming.text)) : list
      return [...rest, incoming]
    })
  }, [me])

  /** The server's copy of the thread, keeping any of our messages still on their way. */
  const mergeServer = useCallback((items: ApiMessage[]) => {
    setMessages(list => {
      // Older history the reader loaded stays: the server's copy is only the newest page.
      const ids = new Set(items.map(i => idOf(i)))
      const firstAt = items[0]?.createdAt
      const older = firstAt ? list.filter(m => !m.pending && !ids.has(idOf(m)) && m.createdAt < firstAt) : []
      return [...older, ...items, ...list.filter(m => m.pending && !items.some(i => isMine(i, me) && i.text === m.text))]
    })
    const last = items[items.length - 1]
    if (last && !isMine(last, me)) setAwaitingReply(false)
  }, [me])

  useEffect(() => { void reload() }, [reload])
  useEffect(() => {
    setTyping(null)
    setAwaitingReply(false)
    setHistoryPage(1)
    setHasOlder(false)
    if (!activeId) { setMessages([]); return }
    let current = true
    setLoadingMessages(true)
    chatApi.messages(activeId).then(res => {
      if (!current) return
      setMessages(res.data.items)
      setHasOlder((res.data.pagination?.totalPages ?? 1) > 1)
      void chatApi.markRead(activeId).catch(() => null)
    }).catch(e => { if (current) toast(translatePortalText(e instanceof Error ? e.message : 'Could not load messages'), 'warn') })
      .finally(() => { if (current) setLoadingMessages(false) })
    return () => { current = false }
  }, [activeId])

  // Live: replies, typing and status changes for the open request, without a reload.
  useEffect(() => {
    if (!activeId) return
    const socket = getSocket()
    const join = () => { socket.emit('chat:join', activeId) }
    join()
    socket.on('connect', join)
    const offs = [
      onSocket('message:new', (payload: ApiMessage & { chatId?: string }) => {
        if (String(payload.chatId ?? payload.chat) === activeId) addMessage(payload)
      }),
      onSocket('chat:updated', (payload: { chatId?: string; message?: ApiMessage }) => {
        if (payload.chatId === activeId && payload.message) addMessage(payload.message)
        scheduleReload()
      }),
      onSocket('inbox:updated', () => scheduleReload()),
      onSocket('chat:typing', (payload: { chatId?: string; userId?: string; isTyping?: boolean }) => {
        if (payload.chatId !== activeId || (payload.userId && payload.userId === me)) return
        setTyping(payload.isTyping ? (payload.userId ? 'person' : 'assistant') : null)
      }),
    ]
    return () => {
      socket.emit('chat:leave', activeId)
      socket.off('connect', join)
      offs.forEach(off => off())
    }
  }, [activeId, me, addMessage, scheduleReload])

  // A dropped socket must not leave the reply invisible: while one is due, check
  // every few seconds, for up to two minutes.
  useEffect(() => {
    if (!awaitingReply || !activeId) return
    const chatId = activeId
    const started = Date.now()
    const timer = window.setInterval(() => {
      if (Date.now() - started > 120_000) { setAwaitingReply(false); return }
      chatApi.messages(chatId).then(res => { if (activeRef.current === chatId) mergeServer(res.data.items) }).catch(() => null)
    }, 4000)
    return () => window.clearInterval(timer)
  }, [awaitingReply, activeId, mergeServer])

  const showTyping = typing !== null || awaitingReply
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    if (keepScroll.current !== null) {
      // Older messages went in above: hold the reader's place.
      el.scrollTop = el.scrollHeight - keepScroll.current
      keepScroll.current = null
      return
    }
    el.scrollTop = el.scrollHeight
  }, [messages, showTyping])

  /** The next page back. Page 2+ does not mark the thread read, by the route's design. */
  const loadOlder = async () => {
    if (!activeId || loadingOlder) return
    const chatId = activeId
    const next = historyPage + 1
    setLoadingOlder(true)
    try {
      const res = await get<Ok<Paginated<ApiMessage>>>(`/chats/${chatId}/messages`, { limit: PAGE_SIZE, page: next })
      if (activeRef.current !== chatId) return
      const el = scroller.current
      keepScroll.current = el ? el.scrollHeight - el.scrollTop : null
      // Pages are counted from the newest message, so one that arrived since
      // shifts them by one; duplicates are dropped rather than shown twice.
      setMessages(list => {
        const seen = new Set(list.map(m => idOf(m)))
        return [...res.data.items.filter(m => !seen.has(idOf(m))), ...list]
      })
      setHistoryPage(next)
      setHasOlder(next < (res.data.pagination?.totalPages ?? next))
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not load earlier messages'), 'warn')
    } finally { setLoadingOlder(false) }
  }

  const active = threads.find(c => idOf(c) === activeId)
  const send = async () => {
    const text = draft.trim()
    if (!activeId || !text || sending) return
    const chatId = activeId
    const pendingId = `pending:${Date.now()}`
    // Shown at once, so nobody sends the same question twice while it is on its way.
    setDraft('')
    setMessages(list => [...list, {
      _id: pendingId, chat: chatId, sender: me ?? '', type: 'text', text, mine: true,
      createdAt: new Date().toISOString(), pending: true,
    }])
    setSending(true)
    if (assistantAnswers(active)) setAwaitingReply(true)
    try {
      const session = await aiSupportApi.getSession(chatId).then(r => r.data).catch(() => null)
      if (session?.aiEnabled && session.session?.mode === 'ai') await aiSupportApi.sendMessage(chatId, text)
      else await chatApi.send(chatId, text)
      const fresh = (await chatApi.messages(chatId)).data.items
      if (activeRef.current === chatId) mergeServer(fresh)
      void reload()
    } catch (e) {
      setMessages(list => list.filter(m => idOf(m) !== pendingId))
      setDraft(current => current || text)
      setAwaitingReply(false)
      toast(translatePortalText(e instanceof Error ? e.message : 'Message not sent'), 'warn')
    } finally { setSending(false) }
  }

  return <div>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="font-display text-lg font-extrabold text-deep-900">{translatePortalText('Your help requests')}</h2>
        <p className="text-xs text-slate-500">{translatePortalText('Messages you sent to BoatPro or another support desk appear here.')}</p>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => void reload()} disabled={loading} className="btn-ghost !px-3 !py-2 text-xs disabled:opacity-60"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />{translatePortalText('Refresh')}</button>
        <button type="button" onClick={() => setComposing(true)} className={`${accentClass} !px-3 !py-2 text-xs`}><Plus size={14} />{translatePortalText('Contact BoatPro')}</button>
      </div>
    </div>
    {error && <div role="alert" className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{translatePortalText(error)} <button className="underline" onClick={() => void reload()}>{translatePortalText('Try again')}</button></div>}
    <div className="grid gap-3 lg:grid-cols-[minmax(250px,320px)_minmax(0,1fr)]">
      {/* Both panels the same fixed height on a wide screen, so the page does not jump as messages arrive. */}
      <div className="card max-h-[320px] overflow-y-auto !p-2 lg:h-[min(72vh,680px)] lg:max-h-none">
        {loading && !threads.length && <div className="grid place-items-center py-16"><Spinner /></div>}
        {!loading && !threads.length && <div className="px-4 py-14 text-center text-sm text-slate-500">
          <LifeBuoy size={23} className="mx-auto mb-2 text-ocean-500" />
          <p className="font-semibold text-deep-900">{translatePortalText('No help requests yet')}</p>
          <p className="mt-1 text-xs">{translatePortalText('Select Contact BoatPro to ask a question or report a problem.')}</p>
        </div>}
        {threads.map(c => {
          const selected = activeId === idOf(c)
          return <button key={idOf(c)} type="button" onClick={() => setActiveId(idOf(c))} aria-current={selected || undefined}
            className={`mb-1 w-full rounded-xl border p-3 text-start transition ${selected ? 'border-ocean-200 bg-ocean-50' : 'border-transparent hover:bg-slate-50'}`}>
            <span className="flex items-start justify-between gap-2">
              <span className="min-w-0 truncate text-sm font-bold text-deep-900">{c.subject || translatePortalText('Help request')}</span>
              {!!c.unreadCount && <span className="shrink-0 rounded-full bg-ocean-600 px-2 text-xs font-bold text-white">{formatPortalNumber(c.unreadCount)}</span>}
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
              <StatusPill chat={c} />
              <span>{fmtRelative(c.updatedAt)}</span>
            </span>
            {!!c.lastMessage?.text && <span dir="auto" className="mt-1.5 line-clamp-2 block text-xs text-slate-500">{localizeMessagePreview(c.lastMessage.text)}</span>}
          </button>
        })}
      </div>
      <div className="card flex h-[min(72vh,680px)] min-h-[420px] flex-col overflow-hidden !p-0">
        {active ? <>
          <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <div className="min-w-0">
              <h3 className="truncate font-bold text-deep-900">{active.subject || translatePortalText('Help request')}</h3>
              <p className="truncate text-xs text-slate-500">{[active.support?.reference, deskName(active.support)].filter(Boolean).join(' · ')}</p>
            </div>
            <StatusPill chat={active} />
          </div>
          <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50/60 p-4" aria-live="polite">
            {loadingMessages && <div className="grid place-items-center py-8"><Spinner /></div>}
            {!loadingMessages && hasOlder && <div className="flex justify-center">
              <button type="button" onClick={() => void loadOlder()} disabled={loadingOlder}
                className="btn-ghost !px-3 !py-1.5 text-xs disabled:opacity-60">
                {loadingOlder ? <Loader2 size={13} className="animate-spin" /> : null}{translatePortalText('Load earlier messages')}
              </button>
            </div>}
            {!loadingMessages && !messages.length && <p className="py-8 text-center text-sm text-slate-500">{translatePortalText('No messages yet. Write below to explain what you need.')}</p>}
            {messages.map(m => {
              const own = isMine(m, me)
              const author = own ? null : authorOf(m)
              if (author === 'notice') return <div key={idOf(m)} className="flex justify-center">
                <p dir="auto" className="max-w-[90%] rounded-full bg-slate-100 px-3 py-1 text-center text-xs text-slate-600">{localizeMessagePreview(m.text)}</p>
              </div>
              const senderName = typeof m.sender === 'object' && m.sender ? (m.sender as { name?: string }).name : undefined
              return <div key={idOf(m)} className={`flex ${own ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm ${own
                  ? `bg-ocean-600 text-white ${m.pending ? 'opacity-70' : ''}`
                  : author === 'assistant' ? 'border border-sky-200 bg-sky-50 text-deep-900' : 'border border-slate-200 bg-white text-deep-900'}`}>
                  {author === 'assistant' && <p className="mb-1 flex items-center gap-1.5 text-[11px] font-extrabold text-ocean-700"><Bot size={13} />{translatePortalText('BoatPro assistant')}</p>}
                  {author === 'person' && <p className="mb-1 flex items-center gap-1.5 text-[11px] font-extrabold text-deep-700"><Headset size={13} />{senderName || translatePortalText('Support agent')}</p>}
                  <MessageContent m={m} mine={own} />
                  <p className={`mt-1 text-[10px] ${own ? 'text-white/70' : 'text-slate-400'}`}>{m.pending ? translatePortalText('Sending…') : fmtRelative(m.createdAt)}</p>
                </div>
              </div>
            })}
            {showTyping && <div className="flex justify-start" role="status">
              <div className="flex items-center gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-3.5 py-2.5 text-xs font-semibold text-ocean-700">
                {typing === 'person' ? <Headset size={13} /> : <Bot size={13} />}
                {translatePortalText(typing === 'person' ? 'Support is typing' : 'BoatPro assistant is typing')}
                <span className="flex items-center gap-0.5" aria-hidden>
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ocean-500 [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ocean-500 [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ocean-500" />
                </span>
              </div>
            </div>}
          </div>
          <div className="border-t border-slate-100 p-3">
            <div className="flex items-end gap-2">
              {/* Capped at the server's limit, so a long message is not typed out only to be refused on send. */}
              <textarea className="input min-h-[44px] flex-1 resize-none" rows={2} dir="auto" maxLength={MESSAGE_MAX} value={draft} onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }} placeholder={translatePortalText('Write to support…')} />
              <ChatAttachments chatId={idOf(active)} accentClass={accentClass} disabled={sending} onSent={m => { addMessage(m); void reload() }} />
              <button type="button" className={`${accentClass} !px-3`} disabled={sending || !draft.trim()} onClick={() => void send()} aria-label={translatePortalText('Send message')}><Send size={16} /></button>
            </div>
            <p className="mt-1.5 flex justify-between gap-2 text-[10.5px] text-slate-400">
              <span>{translatePortalText('Enter to send · Shift + Enter for a new line')}</span>
              {draft.length > MESSAGE_MAX * 0.9 && <span className="font-semibold text-amber-600">{formatPortalNumber(draft.length)} / {formatPortalNumber(MESSAGE_MAX)}</span>}
            </p>
          </div>
        </> : <div className="grid flex-1 place-items-center px-6 text-center text-sm text-slate-500">{translatePortalText('Choose a request to read it, or contact BoatPro.')}</div>}
      </div>
    </div>
    <NewThreadModal open={composing} onClose={() => setComposing(false)} accentClass={accentClass}
      onOpened={chat => { setActiveId(idOf(chat)); void reload() }} />
  </div>
}

/** Where a request stands, coloured so it reads at a glance. */
function StatusPill({ chat }: { chat: ApiChat }) {
  const label = requestStatus(chat)
  const tone = label === 'Resolved' ? 'bg-slate-100 text-slate-600'
    : label === 'Your reply needed' ? 'bg-amber-100 text-amber-800'
      : label === 'Waiting for a support agent' ? 'bg-amber-50 text-amber-700'
        : label === 'AI assistant available' ? 'bg-sky-100 text-ocean-700'
          : 'bg-emerald-50 text-emerald-700'
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${tone}`}>{translatePortalText(label)}</span>
}
