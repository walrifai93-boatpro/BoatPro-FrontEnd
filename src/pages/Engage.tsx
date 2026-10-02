import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ChatAttachments } from '../shared/ChatAttachments'
import { MessageContent, MessageTags, isMine, localizeMessagePreview } from '../shared/MessageContent'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MessagesSquare,
  Star,
  Bell,
  Send,
  Reply,
  RefreshCw,
  CheckCheck,
  Bot,
  Sparkles,
  UserCheck,
  Cpu,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  HelpCircle,
} from 'lucide-react'
import { PageHeader, Badge, Section, Stars, toast, EmptyState, AsyncBlock, Avatar, Spinner, StatCard, LoadingState } from '../ui'
import { useAsync, useMarina, fmtDateTime, fmtRelative, fmtTime, humanize, personOf } from '../live'
import { useOps } from '../opsStore'
import {
  chatApi,
  aiSupportApi,
  notificationsApi,
  portalApi,
  reviewsApi,
  idOf,
  type ApiChat,
  type ApiMessage,
} from '../api'
import { useAuth } from '../auth'
import { formatPortalNumber, translatePortalText } from '../i18n/runtime'

const DEFAULT_AI_PROMPTS = [
  { label: '📅 Berth Booking', q: 'What is the status of my marina berth booking?' },
  { label: '⛽ Fuel Order', q: 'Can you check my fuel delivery request?' },
  { label: '❌ Cancellation Policy', q: 'What is the BoatPro cancellation policy?' },
  { label: '💳 Payment Issue', q: 'How do I check my payment and refund status?' },
  { label: '🙋 Speak to Human', q: 'I want to talk to a human support specialist' },
]

const PROVIDER_AI_PROMPTS: Record<string, { label: string; q: string }[]> = {
  boat_provider: [
    { label: '📅 Today’s trip bookings', q: 'List my trip bookings departing today, including booking requests and their statuses.' },
    { label: '⚓ Today’s berth arrivals', q: 'List my berth bookings checking in today and their statuses.' },
    { label: '💰 Earnings', q: 'Summarize my earnings this month after refunds and commission.' },
    { label: '🏦 Payouts', q: 'What is the status of my latest provider payouts?' },
    { label: '🙋 Speak to Human', q: 'I want to talk to a human support specialist.' },
  ],
  marina_provider: [
    { label: '⚓ Today’s arrivals', q: 'List my marina berth bookings checking in today, including berth names and statuses.' },
    { label: '🕒 Pending requests', q: 'List berth requests at my marina that are waiting for approval.' },
    { label: '💰 Earnings', q: 'Summarize my earnings this month after refunds and commission.' },
    { label: '🏦 Payouts', q: 'What is the status of my latest provider payouts?' },
    { label: '🙋 Speak to Human', q: 'I want to talk to a human support specialist.' },
  ],
  fuel_provider: [
    { label: '⛽ Today’s deliveries', q: 'List my fuel orders scheduled for delivery today and their statuses.' },
    { label: '🕒 Pending orders', q: 'List my fuel orders that are waiting to be accepted or scheduled.' },
    { label: '💰 Earnings', q: 'Summarize my earnings this month after refunds and commission.' },
    { label: '🏦 Payouts', q: 'What is the status of my latest provider payouts?' },
    { label: '🙋 Speak to Human', q: 'I want to talk to a human support specialist.' },
  ],
  maintenance_provider: [
    { label: '🛠 Open requests', q: 'List my open maintenance service requests and their priorities.' },
    { label: '📅 Jobs today', q: 'List my maintenance jobs scheduled for today with their status and progress.' },
    { label: '💰 Earnings', q: 'Summarize my earnings this month after refunds and commission.' },
    { label: '🏦 Payouts', q: 'What is the status of my latest provider payouts?' },
    { label: '🙋 Speak to Human', q: 'I want to talk to a human support specialist.' },
  ],
}

// ===========================================================================
// Messaging — real 1:1 conversations with berth holders & AI Support
// ===========================================================================
export function Messaging({ directOnly = false }: { directOnly?: boolean } = {}) {
  const { user } = useAuth()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [showAiAudit, setShowAiAudit] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)

  const chats = useAsync(() => (directOnly ? chatApi.myMessageChats() : chatApi.myChats()).then(r => r.data), [directOnly])
  const list = (chats.data?.items ?? []).filter(c => !directOnly || c.type !== 'support')
  const quickPrompts = PROVIDER_AI_PROMPTS[user?.role ?? ''] ?? DEFAULT_AI_PROMPTS

  // Open the most recent conversation on first load.
  useEffect(() => {
    const firstChatId = list.length ? idOf(list[0]) : ''
    if (!activeId && firstChatId) setActiveId(firstChatId)
  }, [list, activeId])

  const messages = useAsync(
    () => (activeId ? chatApi.messages(activeId).then(r => r.data) : Promise.resolve(null)),
    [activeId],
  )

  const aiSession = useAsync(
    () => (activeId ? aiSupportApi.getSession(activeId).then(r => r.data).catch(() => null) : Promise.resolve(null)),
    [activeId],
  )

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight
  }, [messages.data])

  const active = list.find(c => idOf(c) === activeId) ?? null
  const other = (c: ApiChat | null) =>
    c?.participants?.find(p => idOf(p) !== idOf(user)) ?? c?.participants?.[0] ?? null

  const send = async () => {
    if (!activeId || !draft.trim()) return
    setSending(true)
    try {
      const text = draft.trim()
      const isSupportThread = (active as any)?.type === 'support' || (active as any)?.isSupport
      let supportState = aiSession.data
      // The session request can still be in flight when a provider taps Send.
      // Resolve it before choosing the endpoint so an AI prompt is not silently
      // posted as an ordinary chat message.
      if (isSupportThread && !supportState) {
        supportState = await aiSupportApi.getSession(activeId).then(r => r.data).catch(() => null)
      }
      if (supportState?.session?.mode === 'ai' && supportState.aiEnabled) {
        await aiSupportApi.sendMessage(activeId, text)
      } else {
        await chatApi.send(activeId, text)
      }
      setDraft('')
      await messages.reload()
      await chats.reload()
      void aiSession.reload()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Message not sent'), 'warn')
    } finally { setSending(false) }
  }

  const startAiSupportChat = async () => {
    try {
      const res = await aiSupportApi.startConversation(translatePortalText('Support & Operations Enquiry'), 'portal_support')
      // With the AI Chat Assistant switched off the server opens the same thread
      // for a human agent instead.
      toast(translatePortalText(res.data?.aiSession?.aiEnabled === false
        ? 'Support conversation opened — an agent will reply here.'
        : 'AI Support conversation started!'), 'success')
      await chats.reload()
      const chatId = idOf(res.data?.chat)
      if (chatId) setActiveId(chatId)
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not start AI support'), 'warn')
    }
  }

  // The server's own flag, with the id comparison as the fallback for
  // socket-delivered messages. See `isMine`.
  const mine = (m: ApiMessage) => isMine(m, idOf(user))
  const isAIMessage = (m: ApiMessage) =>
    (m as any).kind === 'ai' ||
    (m as any).kind === 'system' ||
    (m as any).isAI ||
    m.tags?.includes('ai') ||
    (m as any).category === 'ai_response'

  const currentSession = aiSession.data?.session

  return (
    <div>
      <PageHeader
        title={translatePortalText(directOnly ? 'Messages' : 'Support & Messaging Center')}
        icon={<MessagesSquare className="text-ocean-500" />}
        sub={translatePortalText(directOnly ? 'Conversations with customers and other providers.' : 'Conversations with berth holders, providers, and BoatPro AI Support.')}
        actions={
          <div className="flex items-center gap-2">
            {!directOnly && <button
              onClick={startAiSupportChat}
              className="btn-primary flex items-center gap-1.5 !py-1.5 !px-3 text-xs"
            >
              <Bot size={15} /> {translatePortalText("New AI Support Chat\n            ")}</button>}
            <button
              className="btn-ghost !py-1.5 !px-2.5 text-xs"
              onClick={() => {
                chats.reload()
                messages.reload()
                void aiSession.reload()
              }}
            >
              <RefreshCw size={13} /> {translatePortalText("Refresh\n            ")}</button>
          </div>
        }
      />

      <AsyncBlock state={chats} loadingLabel="Loading conversations…"
        empty={() => list.length === 0
          ? { icon: '💬', text: directOnly ? 'No messages yet. Conversations with customers will appear here.' : 'No conversations yet — start one from a berth holder’s profile or start an AI chat.' }
          : null}>
        {() => (
          <div className="grid gap-5 lg:grid-cols-[330px_1fr]">
            {/* thread list */}
            <div className="card !p-2">
              <div className="max-h-[640px] space-y-1 overflow-y-auto">
                {list.map(c => {
                  const chatId = idOf(c)
                  if (!chatId) return null
                  const who = other(c)
                  const isSupportThread = (c as any).type === 'support' || (c as any).isSupport
                  return (
                    <button key={chatId} onClick={() => setActiveId(chatId)}
                      className={`flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition ${activeId === chatId ? 'bg-ocean-50' : 'hover:bg-sand'}`}>
                      {isSupportThread ? (
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-ocean-600 to-sky-400 text-white shadow-sm">
                          <Bot size={20} />
                        </div>
                      ) : (
                        <Avatar name={who?.name} src={who?.avatar} size={38} />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="truncate text-sm font-bold text-deep-900">
                            {isSupportThread ? translatePortalText('BoatPro AI Support') : who?.name ?? translatePortalText('Boater')}
                          </p>
                          {isSupportThread && (
                            <span className="rounded bg-emerald-100 px-1 py-0.5 text-[9px] font-bold text-emerald-800">
                              {translatePortalText("AI\n                            ")}</span>
                          )}
                        </div>
                        <p className="truncate text-[11px] text-slate-400">
                          {c.lastMessage?.text ? localizeMessagePreview(c.lastMessage.text) : translatePortalText('No messages yet')}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-[10px] text-slate-400">{c.lastMessage?.at ? fmtRelative(c.lastMessage.at) : ''}</p>
                        {!!c.unreadCount && (
                          <span className="mt-0.5 inline-grid h-4 min-w-4 place-items-center rounded-full bg-ocean-500 px-1 text-[9px] font-extrabold text-white">{formatPortalNumber(c.unreadCount)}</span>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* conversation */}
            <div className="card flex min-h-[640px] flex-col !p-0">
              {active ? (
                <>
                  {/* Conversation Header */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      {(active as any).type === 'support' ? (
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-ocean-600 to-sky-400 text-white shadow-sm">
                          <Bot size={22} />
                        </div>
                      ) : (
                        <Avatar name={other(active)?.name} src={other(active)?.avatar} size={38} />
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-display text-sm font-extrabold text-deep-900">
                            {(active as any).type === 'support' ? translatePortalText('BoatPro Support Desk') : other(active)?.name ?? translatePortalText('Boater')}
                          </p>
                          {currentSession && (
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                currentSession.mode === 'ai'
                                  ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-300'
                                  : 'bg-amber-50 text-amber-700 ring-1 ring-amber-300'
                              }`}
                            >
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${
                                  currentSession.mode === 'ai' ? 'bg-emerald-500' : 'bg-amber-500'
                                }`}
                              />
                              {translatePortalText(currentSession.mode === 'ai' ? 'AI Active' : 'Human Mode')}
                            </span>
                          )}
                        </div>
                        <p className="truncate text-[11px] text-slate-400">
                          {other(active)?.email ?? translatePortalText(humanize(other(active)?.role))}
                        </p>
                      </div>
                    </div>

                    {/* AI Support Controls */}
                    {currentSession && (
                      <div className="flex items-center gap-2">
                        {currentSession.mode === 'ai' ? (
                          <button
                            onClick={async () => {
                              await aiSupportApi.escalate(idOf(active), translatePortalText('Agent took over conversation'))
                              toast(translatePortalText('Switched to human support mode'), 'info')
                              void aiSession.reload()
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 transition hover:bg-amber-100"
                          >
                            <UserCheck size={13} /> {translatePortalText("Take Over\n                          ")}</button>
                        ) : (
                          <button
                            onClick={async () => {
                              await aiSupportApi.resumeAI(idOf(active))
                              toast(translatePortalText('AI support mode resumed'), 'success')
                              void aiSession.reload()
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-ocean-200 bg-ocean-50 px-2.5 py-1 text-xs font-semibold text-ocean-800 transition hover:bg-ocean-100"
                          >
                            <Bot size={13} /> {translatePortalText("Hand to AI\n                          ")}</button>
                        )}

                        <button
                          onClick={() => setShowAiAudit(!showAiAudit)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                        >
                          <Cpu size={13} className="text-ocean-500" />
                          {translatePortalText("Context ")}{showAiAudit ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Expandable AI Context & Audit Inspector */}
                  <AnimatePresence>
                    {showAiAudit && currentSession && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden border-b border-ocean-100 bg-gradient-to-r from-ocean-50/60 to-sky-50/40 px-5 py-3 text-xs"
                      >
                        <div className="grid gap-3 md:grid-cols-2">
                          <div>
                            <p className="font-bold text-ocean-900 mb-1.5 flex items-center gap-1">
                              <ShieldCheck size={13} className="text-ocean-600" /> {translatePortalText("Active Session Context\n                            ")}</p>
                            <div className="space-y-1 text-[11px] text-slate-600">
                              {Object.entries(currentSession.activeContext || {}).length ? (
                                Object.entries(currentSession.activeContext).map(([k, v]) => (
                                  <div key={k} className="flex justify-between border-b border-ocean-100/60 py-0.5">
                                    <span className="font-medium text-slate-500">{k}:</span>
                                    <span className="font-mono text-deep-900">{String(v)}</span>
                                  </div>
                                ))
                              ) : (
                                <p className="italic text-slate-400">{translatePortalText("No specific booking context bound yet")}</p>
                              )}
                            </div>
                          </div>

                          <div>
                            <p className="font-bold text-ocean-900 mb-1.5 flex items-center gap-1">
                              <Cpu size={13} className="text-ocean-600" /> {translatePortalText("Tool Calls Log\n                            ")}</p>
                            <div className="space-y-1 text-[11px] text-slate-600">
                              <div className="flex justify-between py-0.5">
                                <span>{translatePortalText("Total Tokens:")}</span>
                                <span className="font-mono font-bold">
                                  {formatPortalNumber((currentSession.tokenUsage?.totalInput || 0) + (currentSession.tokenUsage?.totalOutput || 0))}
                                </span>
                              </div>
                              <div className="flex justify-between py-0.5">
                                <span>{translatePortalText("AI Requests:")}</span>
                                <span className="font-mono">{formatPortalNumber(currentSession.tokenUsage?.requestCount || 0)}</span>
                              </div>
                              {currentSession.escalation && (
                                <div className="rounded bg-rose-50 p-1.5 text-rose-700 text-[10px]">
                                  <strong>{translatePortalText("Escalated:")}</strong> {currentSession.escalation.reason}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Messages Scroll Area */}
                  <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto p-5">
                    {messages.loading && !messages.data ? (
                      <LoadingState label="Loading messages…" rows={3} />
                    ) : (messages.data?.items ?? []).length === 0 ? (
                      <EmptyState icon="👋" text="Say hello — no messages yet" />
                    ) : (
                      (messages.data?.items ?? []).map(m => {
                        const isAI = isAIMessage(m)
                        const isFromMe = mine(m)

                        return (
                          <motion.div
                            key={idOf(m)}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            className={`flex ${isFromMe ? 'justify-end' : 'justify-start'}`}
                          >
                            <div
                              className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm shadow-sm ${
                                isFromMe
                                  ? 'bg-ocean-600 text-white'
                                  : isAI
                                  ? 'border border-sky-200 bg-sky-50/80 text-deep-900'
                                  : 'bg-sand text-deep-900'
                              }`}
                            >
                              {/* AI message identifier header */}
                              {isAI && (
                                <div className="mb-1.5 flex items-center gap-1.5 border-b border-sky-200/60 pb-1">
                                  <div className="flex h-4 w-4 items-center justify-center rounded-full bg-ocean-600 text-[10px] text-white">
                                    🤖
                                  </div>
                                  <span className="text-[11px] font-extrabold text-ocean-700">
                                    {translatePortalText("BoatPro AI Assistant\n                                  ")}</span>
                                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                </div>
                              )}

                              <MessageContent m={m} mine={isFromMe} />
                              <MessageTags tags={m.tags} mine={isFromMe} />
                              <p
                                className={`mt-1.5 text-[10px] ${
                                  isFromMe ? 'text-white/60' : 'text-slate-400'
                                }`}
                              >
                                {fmtTime(m.createdAt)}
                              </p>
                            </div>
                          </motion.div>
                        )
                      })
                    )}
                  </div>

                  {/* Quick AI Suggestions Chips Bar */}
                  {!directOnly && <div className="flex items-center gap-1.5 overflow-x-auto border-t border-slate-100 bg-slate-50/80 px-4 py-2">
                    <span className="flex shrink-0 items-center gap-1 text-[11px] font-bold text-ocean-700">
                      <Sparkles size={12} className="text-ocean-500" /> {translatePortalText("Quick Prompts:\n                    ")}</span>
                    {quickPrompts.map(s => (
                      <button
                        key={s.label}
                        onClick={() => setDraft(translatePortalText(s.q))}
                        className="shrink-0 rounded-full border border-ocean-200 bg-white px-2.5 py-1 text-[11px] font-medium text-ocean-800 shadow-2xs transition hover:bg-ocean-50"
                      >
                        {translatePortalText(s.label)}
                      </button>
                    ))}
                  </div>}

                  {/* Composer */}
                  <div className="flex items-end gap-2 border-t border-slate-100 p-3.5">
                    <textarea
                      value={draft}
                      onChange={e => setDraft(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          send()
                        }
                      }}
                      placeholder={translatePortalText(directOnly ? 'Write a message…' : 'Write a message to boater or ask AI...')}
                      className="input min-h-[44px] max-h-32 flex-1 resize-none"
                    />
                    {!!activeId && (
                      <ChatAttachments
                        chatId={activeId}
                        accentClass="btn-primary"
                        disabled={sending}
                        onSent={() => {
                          void messages.reload()
                          void chats.reload()
                        }}
                      />
                    )}
                    <button
                      className="btn-primary !px-4"
                      disabled={sending || !activeId || !draft.trim()}
                      onClick={send}
                    >
                      {sending ? <Spinner size={16} /> : <Send size={16} />}
                    </button>
                  </div>
                </>
              ) : (
                <div className="grid flex-1 place-items-center">
                  <EmptyState icon="💬" text="Pick a conversation or start an AI support chat" />
                </div>
              )}
            </div>
          </div>
        )}
      </AsyncBlock>
    </div>
  )
}


// ===========================================================================
// Reviews of the marina, with replies
// ===========================================================================
export function Reviews() {
  const [unanswered, setUnanswered] = useState(false)
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const state = useAsync(() => portalApi.reviews({ unanswered: unanswered || undefined, limit: 100 }).then(r => r.data), [unanswered])
  const rows = state.data?.items ?? []

  const submit = async (id: string) => {
    if (!text.trim()) return
    setBusy(true)
    try {
      await reviewsApi.reply(id, text.trim())
      toast(translatePortalText('Reply published'))
      setReplyTo(null); setText('')
      await state.reload()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not post that reply'), 'warn')
    } finally { setBusy(false) }
  }

  const distribution = state.data?.distribution ?? {}
  const total = state.data?.ratingCount ?? 0

  return (
    <div>
      <PageHeader title={translatePortalText("Reviews & Ratings")} icon={<Star className="text-ocean-500" />}
        sub="What boaters say about your marina. Replies appear publicly on your listing."
        actions={<button className="btn-ghost" onClick={() => state.reload()}><RefreshCw size={14} /> {translatePortalText("Refresh")}</button>} />

      <div className="mb-5 grid gap-5 lg:grid-cols-3">
        <Section title={translatePortalText("Overall rating")} sub={`${formatPortalNumber(total)} ${translatePortalText(total === 1 ? 'review' : 'reviews')}`}>
          <div className="flex items-center gap-4">
            <p className="font-display text-5xl font-extrabold text-deep-900">{state.data?.average ? formatPortalNumber(state.data.average, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—'}</p>
            <div>
              <Stars n={Math.round(state.data?.average ?? 0)} size={18} />
              <p className="mt-1 text-xs text-slate-400">{translatePortalText("out of 5")}</p>
            </div>
          </div>
        </Section>

        <Section title={translatePortalText("Rating spread")} sub="How the scores land" className="lg:col-span-2">
          <div className="space-y-1.5">
            {[5, 4, 3, 2, 1].map(star => {
              const n = distribution[String(star)] ?? 0
              const pct = total ? Math.round((n / total) * 100) : 0
              return (
                <div key={star} className="flex items-center gap-3 text-xs">
                  <span className="w-10 font-bold text-slate-500">{formatPortalNumber(star)} ★</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-300" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-8 text-right font-semibold text-slate-500">{formatPortalNumber(n)}</span>
                </div>
              )
            })}
          </div>
        </Section>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {([[false, 'All reviews'], [true, 'Awaiting a reply']] as const).map(([k, label]) => (
          <button key={String(k)} onClick={() => setUnanswered(k)}
            className={`chip transition ${unanswered === k ? 'bg-deep-900 text-white' : 'bg-white ring-1 ring-slate-200 text-slate-500 hover:ring-ocean-300'}`}>
            {translatePortalText(label)}
          </button>
        ))}
        <span className="ms-auto text-xs font-semibold text-slate-400">{formatPortalNumber(rows.length)} {translatePortalText("shown")}</span>
      </div>

      <AsyncBlock state={state} loadingLabel="Loading reviews…"
        empty={d => d.items.length === 0
          ? { icon: '⭐', text: unanswered ? 'Every review has a reply — nice work.' : 'No reviews yet.' }
          : null}>
        {() => (
          <div className="space-y-3">
            {rows.map((r, i) => {
              const who = personOf(r.author)
              return (
                <motion.div key={r.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.04, 0.4) }}
                  className="card p-5">
                  <div className="flex items-start gap-3">
                    <Avatar name={who?.name} src={who?.avatar} size={40} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-bold text-deep-900">{who?.name ?? translatePortalText('Boater')}</p>
                        <Stars n={r.rating} />
                        <span className="text-[11px] text-slate-400">{fmtRelative(r.createdAt)}</span>
                      </div>
                      {r.comment && <p className="mt-1.5 text-sm text-slate-600">{r.comment}</p>}

                      {r.reply?.text ? (
                        <div className="mt-3 rounded-xl border-s-2 border-ocean-300 bg-ocean-50/50 px-3 py-2">
                          <p className="text-[10px] font-extrabold uppercase tracking-wider text-ocean-600">{translatePortalText("Your reply · ")}{fmtDateTime(r.reply.date)}</p>
                          <p className="mt-0.5 text-sm text-slate-600">{r.reply.text}</p>
                        </div>
                      ) : replyTo === r.id ? (
                        <div className="mt-3">
                          <textarea className="input min-h-[80px]" value={text} onChange={e => setText(e.target.value)} placeholder={translatePortalText("Thank them, or put the record straight…")} />
                          <div className="mt-2 flex justify-end gap-2">
                            <button className="btn-ghost !py-1.5 !px-3 text-xs" onClick={() => { setReplyTo(null); setText('') }}>{translatePortalText("Cancel")}</button>
                            <button className="btn-primary !py-1.5 !px-3 text-xs" disabled={busy} onClick={() => submit(r.id)}>{translatePortalText("Publish reply")}</button>
                          </div>
                        </div>
                      ) : (
                        <button className="btn-ghost mt-3 !py-1.5 !px-3 text-xs" onClick={() => { setReplyTo(r.id); setText('') }}>
                          <Reply size={13} /> {translatePortalText("Reply\n                        ")}</button>
                      )}
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}
      </AsyncBlock>
    </div>
  )
}

// ===========================================================================
// Notification centre
// ===========================================================================
const NOTIF_ICONS: Record<string, string> = {
  booking_request: '🆕', booking_confirmed: '✅', booking_cancelled: '🚫', booking_completed: '🏁',
  berth_arrival: '⚓', berth_departure: '🛫', payment_success: '💳', payment_refund: '↩️',
  work_order_assigned: '🔧', utility_billed: '⚡', incident_reported: '🚨', emergency_sos: '🛟',
  review_received: '⭐', documents_expiring: '📄', staff_assigned: '👷', general: '🔔',
}

export function NotificationsPage() {
  const { reloadAlerts } = useOps()
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [busy, setBusy] = useState(false)

  const state = useAsync(() => notificationsApi.list({ unread: unreadOnly || undefined, limit: 100 }).then(r => r.data), [unreadOnly])
  const rows = state.data?.items ?? []
  const unread = state.data?.unreadCount ?? 0

  const markAll = async () => {
    setBusy(true)
    try {
      await notificationsApi.markAllRead()
      toast(translatePortalText('All notifications marked as read'))
      await state.reload()
      await reloadAlerts()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not mark them read'), 'warn')
    } finally { setBusy(false) }
  }

  const markOne = async (id: string) => {
    try {
      await notificationsApi.markRead(id)
      await state.reload()
      await reloadAlerts()
    } catch { /* non-critical */ }
  }

  const byType = useMemo(() => {
    const map: Record<string, number> = {}
    rows.forEach(n => { map[n.type] = (map[n.type] ?? 0) + 1 })
    return map
  }, [rows])

  return (
    <div>
      <PageHeader title={translatePortalText("Notifications")} icon={<Bell className="text-ocean-500" />}
        sub="Everything the platform has told you — berth requests, payments, arrivals, incidents and expiring documents."
        actions={<>
          <button className="btn-ghost" onClick={() => state.reload()}><RefreshCw size={14} /> {translatePortalText("Refresh")}</button>
          <button className="btn-primary" disabled={unread === 0 || busy} onClick={markAll}><CheckCheck size={15} /> {translatePortalText("Mark all read")}</button>
        </>} />

      <div className="mb-5 grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard i={0} label="Unread" value={unread} icon={<Bell size={17} />} tone="rose" />
        <StatCard i={1} label="Berth requests" value={byType.booking_request ?? 0} icon={<Bell size={17} />} tone="amber" />
        <StatCard i={2} label="Payments" value={byType.payment_success ?? 0} icon={<Bell size={17} />} tone="green" />
        <StatCard i={3} label="Total shown" value={rows.length} icon={<Bell size={17} />} tone="navy" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {([[false, 'Everything'], [true, `Unread only${unread ? ` · ${formatPortalNumber(unread)}` : ''}`]] as const).map(([k, label]) => (
          <button key={String(k)} onClick={() => setUnreadOnly(k)}
            className={`chip transition ${unreadOnly === k ? 'bg-deep-900 text-white' : 'bg-white ring-1 ring-slate-200 text-slate-500 hover:ring-ocean-300'}`}>
            {translatePortalText(label)}
          </button>
        ))}
      </div>

      <AsyncBlock state={state} loadingLabel="Loading notifications…"
        empty={d => d.items.length === 0 ? { icon: '🔔', text: unreadOnly ? "You're all caught up" : 'No notifications yet' } : null}>
        {() => (
          <div className="space-y-2">
            {rows.map((n, i) => (
              <motion.button key={n.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.02, 0.35) }}
                onClick={() => !n.isRead && markOne(n.id)}
                className={`flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition hover:shadow-soft ${!n.isRead ? 'border-ocean-100 bg-ocean-50/40' : 'border-slate-100 bg-white'}`}>
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sand text-lg">{NOTIF_ICONS[n.type] ?? '🔔'}</span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <b className="text-sm text-deep-900">{translatePortalText(n.title)}</b>
                    <Badge>{translatePortalText(humanize(n.type))}</Badge>
                    <span className="text-[11px] text-slate-400">{fmtRelative(n.createdAt)}</span>
                  </p>
                  <p className="mt-0.5 text-sm text-slate-600">{translatePortalText(n.body)}</p>
                </div>
                {!n.isRead && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-ocean-500" />}
              </motion.button>
            ))}
          </div>
        )}
      </AsyncBlock>
    </div>
  )
}
