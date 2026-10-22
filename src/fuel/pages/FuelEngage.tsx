import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { DEFAULT_COORDS, DEFAULT_MAP_CENTRE } from '../../shared/geoDefaults'
import { useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, Mic, Image as ImageIcon, Paperclip, Link2, Phone, Radio, Users, Globe2, CreditCard, BellRing, ShieldCheck, Building2, Landmark, AlertTriangle, Clock, LifeBuoy } from 'lucide-react'
import { notifStyle, relativeTime, shortTime, toVehicle, STAFF_ROLE_LABEL, STAFF_ROLE_VALUE, type Vehicle } from '../fuelData'
import { fuelApi, type ApiFuelStaff, type StaffRole } from '../fuelApi'
import { useFuel, useFuelResource } from '../fuelStore'
import { chatApi, notificationsApi, profileApi, fileUrl, type ApiChat, type ApiMessage, type ApiSubscriber } from '../../api'
import { PLACEHOLDER_AVATAR } from '../../format'
import { useAuth } from '../../auth'
import { Section, Modal, Img, Toggle, EmptyState, LoadingState, ErrorState, toast, copyText, pickFiles } from '../../ui'
import { FuelHeader, FBadge, Metric, FleetMap, Fleet3DMap, MapModeToggle, type MapPoint } from '../fuelUi'
import { StationApprovalNotice } from '../components/StationApprovalNotice'
import MarinaLocationPicker, { type PickedPoint } from '../../components/MarinaLocationPicker'
import { BankDetailsFields } from '../../components/BankDetailsFields'
import { bankPayload, validateBankDetails, type BankDetailsErrors } from '../../utils/iban'
import { localizedField, portalLocale, translatePortalText } from '../../i18n/runtime'

// ═════════════════════════════════════════════════════════════
// Live Tracking
// ═════════════════════════════════════════════════════════════
export function FuelTracking() {
  const { fuelByKey } = useFuel()
  const [modalVehicle, setModalVehicle] = useState<Vehicle | null>(null)
  const [mapMode, setMapMode] = useState<'2d' | '3d'>('2d')

  // Positions move while the dispatcher watches, so this refreshes on its own.
  const res = useFuelResource(() => fuelApi.tracking().then(r => r.data), [])
  useEffect(() => {
    const t = setInterval(() => void res.reload(), 30_000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const vehicles = useMemo(() => (res.data?.vehicles ?? []).map(toVehicle), [res.data])
  const depot = res.data?.depot
  const moving = vehicles.filter(v => v.status === 'On delivery')

  // Only plot vehicles that have actually reported a position.
  const located = vehicles.filter(v => v.lat !== 0 || v.lng !== 0)
  const mapPoints: MapPoint[] = [
    ...(depot ? [{ id: 'depot', lat: depot.latitude, lng: depot.longitude, label: depot.name, icon: '⛽', tone: 'depot' as const }] : []),
    ...located.map(v => ({ id: v.id, lat: v.lat, lng: v.lng, label: v.name, icon: v.icon, tone: (v.status === 'On delivery' ? 'active' : 'idle') as MapPoint['tone'] })),
  ]
  const center = depot
    ? { lat: depot.latitude, lng: depot.longitude }
    : located[0]
      ? { lat: located[0].lat, lng: located[0].lng }
      // Was `25.2048, 55.2708` — Dubai Marina — so a provider with no depot
      // coordinates and no vehicle reporting a position opened the dispatch
      // map over the UAE. See `shared/geoDefaults`.
      : DEFAULT_MAP_CENTRE

  const handlePointClick = (id: string) => {
    const v = vehicles.find(x => x.id === id)
    if (v) setModalVehicle(v)
  }

  const sendLinks = () => {
    if (!moving.length) { toast(translatePortalText("No active deliveries to share"), 'info'); return }
    toast(translatePortalText(`Tracking links sent to ${moving.length} active customer${moving.length === 1 ? '' : 's'}`))
  }

  if (res.loading && !res.data) return <LoadingState label={translatePortalText("Locating the fleet…")} rows={4} />
  if (res.error) return <ErrorState error={translatePortalText(res.error)} onRetry={() => void res.reload()} />

  return (
    <div className="space-y-5">
      <FuelHeader title={translatePortalText("Live Tracking")} sub={translatePortalText("Barges, trucks & drivers on a live map — share tracking links with customers")}
        icon={<span className="text-2xl">🛰️</span>}
        actions={<>
          <MapModeToggle mode={mapMode} onChange={setMapMode} />
          <button className="btn-fuel" onClick={sendLinks}><Link2 size={15} />{translatePortalText(" Send customer links")}</button>
        </>} />

      <StationApprovalNotice />

      {/* map — full screen */}
      <Section title={translatePortalText("Fleet map")} sub={translatePortalText(`${moving.length} vehicles in motion · updated live · click a marker for details`)}>
        {mapMode === '2d' ? (
          <FleetMap points={mapPoints} center={center} zoom={9} width="100%" height="calc(100vh - 280px)" onPointClick={handlePointClick} />
        ) : (
          <Fleet3DMap points={mapPoints} center={center} width="100%" height="calc(100vh - 280px)"
            onPointClick={handlePointClick} onUnsupported={() => { setMapMode('2d'); toast(translatePortalText("3D Earth isn't enabled for this API key yet — showing 2D map"), 'warn') }} />
        )}
        <div className="mt-2.5 flex gap-2 text-[10px] font-bold">
          {[['🟢', 'Depot'], ['🟠', 'En route / active'], ['⚪', 'Idle']].map(([d, l]) => (
            <span key={l} className="rounded-full bg-sand px-2.5 py-1 text-slate-500">{d} {translatePortalText(l)}</span>
          ))}
        </div>
      </Section>

      {/* marker click → vehicle details modal */}
      <Modal open={!!modalVehicle} onClose={() => setModalVehicle(null)} title={translatePortalText(modalVehicle ? `${modalVehicle.icon} ${modalVehicle.name}` : '')}>
        {modalVehicle && (
          <div className="space-y-4">
            <div className="relative h-36 overflow-hidden rounded-2xl">
              <Img src={modalVehicle.image} className="h-full w-full" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#120a04]/85 to-transparent" />
              <div className="absolute bottom-2.5 start-4 text-white">
                <p className="font-display text-lg font-extrabold">{translatePortalText(modalVehicle.type)} · {modalVehicle.plate}</p>
              </div>
              <span className="absolute end-3 top-3"><FBadge dot={modalVehicle.status === 'On delivery'}>{modalVehicle.status}</FBadge></span>
            </div>

            <div className="flex items-center gap-3 rounded-xl bg-sand p-3">
              <img src={modalVehicle.driverAvatar} className="h-10 w-10 rounded-full object-cover" />
              <div className="flex-1">
                <p className="text-[13px] font-extrabold text-deep-900">{modalVehicle.driver}</p>
                <p className="text-[11px] text-slate-400">{translatePortalText("Driver / operator · ")}{modalVehicle.speed}</p>
              </div>
              {/*
                A call button and a radio button were here, raising
                `toast('Calling <driver>…')` and `toast('Radio channel
                opened')`. Neither did anything, and neither could: `Vehicle`
                carries no phone number for its driver, and the platform has no
                radio integration of any kind.

                A dispatcher pressing "call" on a tanker driver and being told
                the call is going through — when there is not even a number on
                file — is the version of this that gets somebody stranded. Both
                are gone. Restoring a call button means first recording driver
                contact numbers on the vehicle.
              */}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Metric icon="⛽" label={translatePortalText("Load")} value={`${modalVehicle.load.toLocaleString(portalLocale())} ${fuelByKey(modalVehicle.fuel).unit}`} />
              <Metric icon="🧭" label={translatePortalText("Speed")} value={modalVehicle.speed} />
              <Metric icon="🛢️" label={translatePortalText("Fuel")} value={fuelByKey(modalVehicle.fuel).name.split(' ')[0]} />
              <Metric icon="📦" label={translatePortalText("Capacity")} value={`${modalVehicle.capacity.toLocaleString(portalLocale())} ${fuelByKey(modalVehicle.fuel).unit}`} />
            </div>
            <p className="text-center text-[11px] text-slate-400">📍 {modalVehicle.lat.toFixed(4)}, {modalVehicle.lng.toFixed(4)}</p>

            <button className="btn-fuel w-full !justify-center" onClick={async () => {
              const ok = await copyText(`${window.location.origin}/#/track/${modalVehicle.id}`)
              toast(translatePortalText(ok ? 'Customer tracking link copied to clipboard' : 'Could not copy link — please try again'), ok ? 'success' : 'warn')
            }}>
              <Link2 size={14} />{translatePortalText(" Copy customer tracking link")}</button>
          </div>
        )}
      </Modal>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════
// Communication
// ═════════════════════════════════════════════════════════════

type ChatKind = 'Customer' | 'Marina' | 'Boat Provider'

/** Bucket a conversation by who is on the other end. */
function kindOf(role?: string): ChatKind {
  if (role === 'marina_provider') return 'Marina'
  if (role === 'boat_provider') return 'Boat Provider'
  return 'Customer'
}

export function FuelMessages() {
  const { user } = useAuth()
  const myId = user?._id ?? user?.id
  const [activeId, setActiveId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [filter, setFilter] = useState<'All' | ChatKind>('All')
  const [pushEnabled, setPushEnabled] = useState(true)
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const chatsRes = useFuelResource(() => chatApi.myMessageChats().then(r => r.data.items), [])
  const chats = (chatsRes.data ?? []).filter(c => c.type !== 'support')

  // Default to the first conversation once the list arrives.
  useEffect(() => {
    if (!activeId && chats.length) setActiveId(chats[0]._id)
  }, [chats, activeId])

  const msgsRes = useFuelResource(
    () => (activeId ? chatApi.messages(activeId).then(r => r.data.items) : Promise.resolve([] as ApiMessage[])),
    [activeId],
  )

  // Mark the thread read as soon as it is opened.
  useEffect(() => {
    if (!activeId) return
    chatApi.markRead(activeId).then(() => void chatsRes.reload()).catch(() => null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [msgsRes.data])

  const view = useMemo(() => {
    return chats.map((c: ApiChat) => {
      // A one-to-one chat has exactly one participant who isn't us.
      const other = (c.participants ?? []).find(p => p && p._id !== myId) as ApiSubscriber | undefined
      return {
        id: c._id,
        name: other?.name ?? translatePortalText('Conversation'),
        kind: kindOf(other?.role),
        avatar: fileUrl(other?.avatar) || PLACEHOLDER_AVATAR,
        last: c.lastMessage?.text ?? translatePortalText('No messages yet'),
        time: c.lastMessage?.at ? shortTime(c.lastMessage.at) : '',
        unread: c.unreadCount ?? 0,
        online: false,
      }
    })
  }, [chats])

  const list = view.filter(c => filter === 'All' || c.kind === filter)
  const active = view.find(c => c.id === activeId) ?? list[0] ?? null
  const kindTone: any = { Customer: 'bg-amber-50 text-amber-700', Marina: 'bg-ocean-50 text-ocean-700', 'Boat Provider': 'bg-violet-50 text-violet-700' }

  const messages = msgsRes.data ?? []
  // Chats list newest-first; a thread reads oldest-first.
  const thread = useMemo(() => [...messages].reverse(), [messages])

  const sendMessage = async () => {
    const text = draft.trim()
    if (!text || !activeId) return
    setSending(true)
    setDraft('')
    try {
      await chatApi.send(activeId, text)
      await Promise.all([msgsRes.reload(), chatsRes.reload()])
    } catch (e) {
      setDraft(text)
      toast(translatePortalText(e instanceof Error ? e.message : 'Message not sent'), 'warn')
    } finally {
      setSending(false)
    }
  }

  // Attachments post through the same text endpoint with a marker line until
  // the media upload route is wired for the portal.
  const shareFile = async (accept: string, label: string) => {
    if (!activeId) return
    const files = await pickFiles(accept)
    if (files.length === 0) return
    setSending(true)
    try {
      await chatApi.send(activeId, `${label} ${files[0].name}`)
      await Promise.all([msgsRes.reload(), chatsRes.reload()])
      toast(translatePortalText(`${files[0].name} sent`))
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not send the file'), 'warn')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-5">
      <FuelHeader title={translatePortalText("Messages")} sub={translatePortalText("Chat with customers, marinas and boat providers — voice notes, images & documents")}
        icon={<span className="text-2xl">💬</span>}
        actions={<button className="btn-ghost" onClick={() => { setPushEnabled(v => !v); toast(translatePortalText(pushEnabled ? 'Push alerts disabled for chats' : 'Push alerts enabled for chats')) }}>
          <BellRing size={15} />{translatePortalText('Push alerts')} {pushEnabled ? translatePortalText('On') : translatePortalText('Off')}
        </button>} />

      <div className="card grid overflow-hidden lg:grid-cols-[340px_1fr]" style={{ minHeight: 560 }}>
        {/* chat list */}
        <div className="border-r border-slate-100">
          <div className="flex gap-1.5 border-b border-slate-100 p-3">
            {(['All', 'Customer', 'Marina', 'Boat Provider'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition ${filter === f ? 'bg-gradient-to-r from-amber-600 to-orange-400 text-white' : 'bg-sand text-slate-500 hover:text-deep-900'}`}>
                {translatePortalText(f)}
              </button>
            ))}
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 500 }}>
            {chatsRes.loading && !chatsRes.data && <div className="p-4"><LoadingState label={translatePortalText("Loading conversations…")} rows={3} /></div>}
            {list.map((c, i) => (
              <motion.button key={c.id} initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                onClick={() => setActiveId(c.id)}
                className={`flex w-full items-center gap-3 border-b border-slate-50 px-4 py-3.5 text-left transition hover:bg-amber-50/40 ${active?.id === c.id ? 'bg-amber-50/60' : ''}`}>
                <div className="relative shrink-0">
                  <img src={c.avatar} className="h-11 w-11 rounded-full object-cover" />
                  {c.online && <span className="absolute -bottom-0.5 -end-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-400" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[13px] font-extrabold text-deep-900">{c.name}</p>
                    <span className={`rounded-md px-1.5 py-0.5 text-[9px] font-extrabold ${kindTone[c.kind]}`}>{translatePortalText(c.kind)}</span>
                  </div>
                  <p className="truncate text-xs text-slate-400">{c.last}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold text-slate-400">{c.time}</p>
                  {c.unread > 0 && <span className="mt-1 inline-grid h-5 w-5 place-items-center rounded-full bg-amber-500 text-[10px] font-extrabold text-white">{c.unread}</span>}
                </div>
              </motion.button>
            ))}
            {!chatsRes.loading && list.length === 0 && <EmptyState icon="💬" text={translatePortalText("No conversations")} />}
          </div>
        </div>

        {/* thread */}
        <div className="flex flex-col">
          {!active ? (
            <div className="grid flex-1 place-items-center text-sm text-slate-400">{translatePortalText("Select a conversation to start.")}</div>
          ) : (<>
            <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3.5">
              <img src={active.avatar} className="h-10 w-10 rounded-full object-cover" />
              <div className="flex-1">
                <p className="text-[14px] font-extrabold text-deep-900">{active.name}</p>
                <p className="text-[11px] font-semibold text-slate-400">{active.online ? translatePortalText("🟢 Online now") : translatePortalText("Last seen recently")} · {translatePortalText(active.kind)}</p>
              </div>
              {/* Was `toast('Calling <name>…')` with no call and no number on
                  the contact. This panel is the in-app chat with that same
                  person, which does work — so the honest option was to drop the
                  button rather than duplicate the conversation with a fake
                  phone line beside it. */}
            </div>

            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-sand/50 p-5" style={{ maxHeight: 400 }}>
              {msgsRes.loading && !msgsRes.data && <LoadingState label={translatePortalText("Loading messages…")} rows={3} />}
              <AnimatePresence mode="popLayout">
                {thread.map((m, i) => {
                  const senderId = typeof m.sender === 'string' ? m.sender : (m.sender as ApiSubscriber)?._id
                  const isMine = !!myId && senderId === myId
                  return (
                    <motion.div key={m._id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 8) * 0.04 }}
                      className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-[13px] shadow-soft ${isMine ? 'rounded-br-md bg-gradient-to-r from-amber-600 to-orange-500 text-white' : 'rounded-bl-md bg-white text-deep-800'}`}>
                        {m.type === 'voice' ? (
                          <span className="flex items-center gap-2">
                            <span className={`grid h-7 w-7 place-items-center rounded-full ${isMine ? 'bg-white/20' : 'bg-amber-50 text-amber-600'}`}>▶</span>
                            <span className="flex items-end gap-0.5">{[3, 6, 9, 5, 8, 4, 7, 5, 3, 6, 8, 4].map((h, j) => (
                              <span key={j} className={`w-0.5 rounded-full ${isMine ? 'bg-white/70' : 'bg-amber-400'}`} style={{ height: h }} />
                            ))}</span>
                          </span>
                        ) : m.type === 'file' ? (
                          <span className="flex items-center gap-2 font-bold"><Paperclip size={13} /> {m.fileName ?? m.text}</span>
                        ) : m.type === 'image' ? (
                          <span className="flex items-center gap-2 font-bold"><ImageIcon size={13} /> {m.fileName ?? 'photo'}</span>
                        ) : m.text}
                        <p className={`mt-1 text-right text-[9px] font-bold ${isMine ? 'text-white/60' : 'text-slate-300'}`}>{shortTime(m.createdAt)}{isMine && translatePortalText(" ✓✓")}</p>
                      </div>
                    </motion.div>
                  )
                })}
              </AnimatePresence>
            </div>

            <div className="flex items-center gap-2 border-t border-slate-100 p-3.5">
              <button className="btn-ghost !p-2.5" title={translatePortalText("Voice note")} onClick={() => shareFile('audio/*', '🎤')}><Mic size={16} /></button>
              <button className="btn-ghost !p-2.5" title={translatePortalText("Share image")} onClick={() => shareFile('image/*', '📷')}><ImageIcon size={16} /></button>
              <button className="btn-ghost !p-2.5" title={translatePortalText("Share document")} onClick={() => shareFile('.pdf,.doc,.docx,.txt', '📎')}><Paperclip size={16} /></button>
              <input value={draft} onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void sendMessage() }}
                placeholder={translatePortalText(`Message ${active.name}…`)} className="input flex-1 !rounded-full" />
              <button className="btn-fuel !rounded-full !p-2.5" disabled={sending} onClick={() => void sendMessage()}><Send size={16} /></button>
            </div>
          </>)}
        </div>
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════
// Notifications page
// ═════════════════════════════════════════════════════════════

/** Tab label → the notification kinds it collects. */
const NOTIF_TABS: Record<string, string[] | null> = {
  All: null,
  'New order': ['New order'],
  Delivery: ['Delivery'],
  'Low stock': ['Compliance'],
  Payment: ['Payment', 'Refund'],
  Safety: ['Safety', 'Emergency'],
  Weather: ['Notice'],
}

export function FuelNotificationsPage() {
  const { refresh } = useFuel()
  const [tab, setTab] = useState('All')
  const tones: any = { info: 'bg-amber-50 text-amber-600', success: 'bg-emerald-50 text-emerald-600', warn: 'bg-orange-50 text-orange-600', danger: 'bg-rose-50 text-rose-600' }

  const res = useFuelResource(() => notificationsApi.list({ limit: 100 }).then(r => r.data), [])
  const all = res.data?.items ?? []

  const list = useMemo(() => {
    const kinds = NOTIF_TABS[tab]
    return kinds ? all.filter(n => kinds.includes(notifStyle(n.type).kind)) : all
  }, [all, tab])

  const markAllRead = async () => {
    await notificationsApi.markAllRead().catch(() => null)
    await res.reload()
    void refresh()
    toast(translatePortalText("All notifications marked as read"))
  }

  const open = async (id: string) => {
    await notificationsApi.markRead(id).catch(() => null)
    await res.reload()
    void refresh()
  }

  return (
    <div className="space-y-5">
      <FuelHeader title={translatePortalText("Notifications")} sub={translatePortalText("Orders, deliveries, stock, payments, safety & weather alerts")}
        icon={<span className="text-2xl">🔔</span>}
        actions={<button className="btn-ghost" onClick={markAllRead}>{translatePortalText("Mark all read")}</button>} />
      <div className="flex flex-wrap gap-1.5 rounded-2xl bg-white p-1.5 shadow-soft border border-slate-100 w-fit">
        {Object.keys(NOTIF_TABS).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`relative rounded-xl px-3.5 py-1.5 text-xs font-bold transition ${tab === t ? 'text-white' : 'text-slate-500 hover:text-deep-900'}`}>
            {tab === t && <motion.span layoutId="fn-tab" className="absolute inset-0 rounded-xl bg-gradient-to-r from-amber-600 to-orange-400" />}
            <span className="relative z-10">{translatePortalText(t)}</span>
          </button>
        ))}
      </div>
      {res.loading && !res.data ? <LoadingState label={translatePortalText("Loading notifications…")} rows={4} /> : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((n, i) => {
            const style = notifStyle(n.type)
            return (
              <motion.div key={n._id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 10) * 0.05 }}
                onClick={() => void open(n._id)} role="button"
                className={`card card-hover flex cursor-pointer gap-3.5 p-4 ${!n.isRead ? 'ring-1 ring-amber-200' : ''}`}>
                <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl text-xl ${tones[style.tone]}`}>{style.icon}</span>
                <div className="min-w-0 flex-1">
                <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-400">{translatePortalText(style.kind)} · {relativeTime(n.createdAt)}</p>
                  <p className="mt-0.5 text-sm font-semibold text-deep-800"><bdi dir="auto">{translatePortalText(String(localizedField<string>(n, 'body', n.body) ?? n.body))}</bdi></p>
                </div>
                {!n.isRead && <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500 animate-pulse-soft" />}
              </motion.div>
            )
          })}
        </div>
      )}
      {!res.loading && list.length === 0 && <EmptyState icon="🔔" text={translatePortalText("No notifications in this category")} />}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════
// Settings
// ═════════════════════════════════════════════════════════════

const NOTIF_ROWS = [
  'New fuel order', 'Order scheduled / completed', 'Low fuel stock & refill reminders',
  'Marketing & product updates', 'Payment received', 'Safety & weather alerts',
]
const PAY_ROWS = [
  '💳 Credit / debit cards', '👛 BoatPro wallet', '🏦 Bank transfer / wire',
  '💵 Cash at the fuel dock', '📒 Commercial credit accounts',
]

/** Which roles map to which coarse permission summary in the roster. */
const ROLE_PERMS: Record<string, string> = {
  manager: 'Full access',
  compliance_officer: 'Inventory · Compliance · Reports',
  dock_fueler: 'Dispensing · Bookings',
  barge_captain: 'Deliveries · Tracking',
  barge_mate: 'Deliveries · Tracking',
  truck_driver: 'Deliveries · Tracking',
  mobile_operator: 'Deliveries · Dispensing',
  dispatcher: 'Bookings · Deliveries · Comms',
}

export function FuelSettings() {
  const location = useLocation()
  const { station, refresh, currentStationId, isAllStations } = useFuel()
  const scopedStationId = isAllStations ? undefined : currentStationId ?? undefined
  const settings = useFuelResource(() => fuelApi.settings(scopedStationId).then(r => r.data), [currentStationId, isAllStations])
  const staffRes = useFuelResource(() => fuelApi.staff(scopedStationId).then(r => r.data.staff), [currentStationId, isAllStations])
  // The store only carries active products; the catalogue toggles need all of them.
  const catalogueRes = useFuelResource(() => fuelApi.products().then(r => r.data.products), [])

  const [notifs, setNotifs] = useState([true, true, true, false, true, true])
  const [pay, setPay] = useState([true, true, true, false, true])
  const [roleModal, setRoleModal] = useState(false)
  const [fuelModal, setFuelModal] = useState(false)
  const [busy, setBusy] = useState(false)

  const { user } = useAuth()
  const [point, setPoint] = useState<PickedPoint>({
    latitude: user?.business?.latitude ?? DEFAULT_COORDS.latitude,
    longitude: user?.business?.longitude ?? DEFAULT_COORDS.longitude,
    address: user?.business?.address ?? '',
    city: user?.business?.city ?? '',
  })

  const [form, setForm] = useState({
    name: '',
    nameAr: '',
    tagline: '',
    phone: '',
    email: '',
    website: '',
    vhf: '',
    city: '',
    region: '',
    open24h: false,
    emergencyEmail: '',
    emergencyProceduresText: '',
    bank: {
      bankName: '',
      accountHolderName: '',
      iban: '',
      accountNumber: '',
      swiftCode: '',
    },
    currency: 'SAR',
    timezone: '',
  })
  const [hours, setHours] = useState<{ label: string; hours: string }[]>([])
  /** Per-field bank messages, set on save — see `saveAll`. */
  const [bankErrors, setBankErrors] = useState<BankDetailsErrors>({})
  const [invite, setInvite] = useState({ name: '', email: '', role: 'dock_fueler' as StaffRole })

  const focusTarget = useCallback((id: string) => {
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.focus?.()
      el.classList.add('ring-4', 'ring-amber-500', 'ring-offset-2', 'transition-all', 'duration-500')
      setTimeout(() => el.classList.remove('ring-4', 'ring-amber-500', 'ring-offset-2'), 2500)
    }
  }, [])

  useEffect(() => {
    const hash = location.hash.replace(/^#/, '')
    if (hash) {
      const timer = setTimeout(() => focusTarget(hash), 250)
      return () => clearTimeout(timer)
    }
  }, [location.hash, focusTarget])

  useEffect(() => {
    const handler = (e: any) => {
      if (e.detail?.id) focusTarget(e.detail.id)
    }
    window.addEventListener('boatpro-focus-field', handler)
    return () => window.removeEventListener('boatpro-focus-field', handler)
  }, [focusTarget])

  // Hydrate the form from the station once, and again if it is reloaded.
  useEffect(() => {
    const s = settings.data?.station
    if (!s) return
    setForm({
      name: s.name ?? '',
      nameAr: s.nameAr ?? '',
      tagline: s.tagline ?? '',
      phone: s.contactNumber ?? '',
      email: s.email ?? '',
      website: s.website ?? '',
      vhf: s.vhfChannel ?? '',
      city: s.city ?? '',
      region: s.region ?? '',
      open24h: s.open24h ?? false,
      emergencyEmail: s.emergencyEmail ?? '',
      emergencyProceduresText: s.emergencyProceduresText ?? '',
      bank: {
        bankName: s.bank?.bankName ?? '',
        accountHolderName: s.bank?.accountHolderName ?? '',
        iban: s.bank?.iban ?? '',
        accountNumber: s.bank?.accountNumber ?? '',
        swiftCode: s.bank?.swiftCode ?? '',
      },
      currency: s.currency ?? 'SAR',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
    setPoint({
      latitude: s.latitude ?? user?.business?.latitude ?? DEFAULT_COORDS.latitude,
      longitude: s.longitude ?? user?.business?.longitude ?? DEFAULT_COORDS.longitude,
      address: s.address ?? user?.business?.address ?? '',
      city: s.city ?? user?.business?.city ?? '',
    })
    setHours(s.hours?.length ? s.hours : [{ label: translatePortalText("Mon – Fri"), hours: '06:00 – 22:00' }, { label: translatePortalText("Saturday"), hours: '08:00 – 20:00' }, { label: translatePortalText("Sunday"), hours: '08:00 – 18:00' }])
  }, [settings.data, user])

  const saveAll = async () => {
    if (isAllStations) { toast(translatePortalText("Pick a specific station location before editing settings"), 'warn'); return }

    /**
     * The bank block is checked before anything is sent, because this form saves
     * the station and the business profile in two calls: letting the API reject
     * a bad IBAN halfway through would leave the two half-applied, and the
     * message would arrive as a toast detached from the field it belongs to.
     */
    const bankIssues = validateBankDetails(form.bank)
    setBankErrors(bankIssues)
    if (Object.keys(bankIssues).length) {
      toast(translatePortalText("Check the bank payout details before saving"), 'warn')
      return
    }

    setBusy(true)
    try {
      await fuelApi.saveStation(
        {
          name: form.name.trim(),
          nameAr: form.nameAr.trim() || undefined,
          tagline: form.tagline.trim() || undefined,
          contactNumber: form.phone.trim() || undefined,
          email: form.email.trim() || undefined,
          website: form.website.trim() || undefined,
          vhfChannel: form.vhf.trim() || undefined,
          city: form.city.trim() || undefined,
          region: form.region.trim() || undefined,
          address: point.address.trim() || undefined,
          latitude: point.latitude,
          longitude: point.longitude,
          open24h: form.open24h,
          emergencyEmail: form.emergencyEmail.trim() || undefined,
          emergencyProceduresText: form.emergencyProceduresText.trim() || undefined,
          // `bankPayload` normalises and fills the bank name / SWIFT from the
          // Saudi bank code, returning undefined when there is no destination.
          bank: bankPayload(form.bank),
          currency: form.currency,
          hours: hours.filter(h => h.label && h.hours),
        },
        currentStationId ? { stationId: currentStationId } : undefined,
      )
      await profileApi.updateBusiness({
        businessName: form.name,
        contactNumber: form.phone,
        address: point.address,
        latitude: point.latitude,
        longitude: point.longitude,
        city: form.city,
      })
      await settings.reload()
      void refresh()
      window.dispatchEvent(new CustomEvent('boatpro-station-updated'))
      toast(translatePortalText("Settings saved successfully"), 'success')
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not save the settings'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  const toggleFuel = async (id: string, name: string, next: boolean) => {
    try {
      await fuelApi.updateProduct(id, { isActive: next })
      await catalogueRes.reload()
      void refresh()
      window.dispatchEvent(new CustomEvent('boatpro-station-updated'))
      toast(translatePortalText(`${name} ${next ? 'enabled' : 'disabled'}`), 'info')
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not update the product'), 'warn')
    }
  }

  const sendInvite = async () => {
    const name = invite.name.trim()
    if (!name) { toast(translatePortalText("Enter the team member’s name"), 'warn'); return }
    if (isAllStations) { toast(translatePortalText("Pick a specific station location before adding crew"), 'warn'); return }
    setBusy(true)
    try {
      await fuelApi.createStaff({ name, email: invite.email.trim() || undefined, role: invite.role, status: 'off_duty', stationId: currentStationId ?? undefined })
      setInvite({ name: '', email: '', role: 'dock_fueler' })
      setRoleModal(false)
      await staffRes.reload()
      window.dispatchEvent(new CustomEvent('boatpro-station-updated'))
      toast(translatePortalText("Team member added"), 'success')
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not add the team member'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  if (settings.loading && !settings.data) return <LoadingState label={translatePortalText("Loading settings…")} rows={5} />

  const catalogue = catalogueRes.data ?? []
  const staff = staffRes.data ?? []

  return (
    <div className="space-y-5">
      <FuelHeader title={translatePortalText("Settings")} sub={translatePortalText("Business profile, fuels, hours, payments, roles & localization")}
        icon={<span className="text-2xl">⚙️</span>}
        actions={<button className="btn-fuel" disabled={busy} onClick={saveAll}>{busy ? translatePortalText("Saving...") : translatePortalText("Save all")}</button>} />

      <div className="grid gap-5 lg:grid-cols-3">
        {/* location */}
        <div id="location" className="lg:col-span-3 transition-all duration-500 rounded-2xl">
          <Section title={translatePortalText("Location")} sub={translatePortalText("Where customers find you on the map")}>
            <MarinaLocationPicker value={point} onChange={p => {
              const parts = p.address.split(',').map(s => s.trim()).filter(Boolean)
              const cityGuess = parts.length >= 2 ? parts[parts.length - 2] : parts[0] ?? ''
              setPoint(p)
              setForm(f => ({ ...f, city: f.city || cityGuess }))
            }} />
          </Section>
        </div>

        {/* business profile */}
        <Section title={translatePortalText("Business profile")} sub={translatePortalText("Shown across BoatPro apps")}>
          <div className="space-y-3">
            <div>
              <label className="label">{translatePortalText("Business name (English) *")}</label>
              <input id="name" className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className="label">{translatePortalText("Arabic Name (الاسم بالعربي)")}</label>
              <input
                id="name_ar"
                dir="rtl"
                className="input font-arabic"
                placeholder="مثال: محطة وقود مارينا الشرقية"
                value={form.nameAr}
                onChange={e => setForm(f => ({ ...f, nameAr: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">{translatePortalText("Tagline & Station Overview")}</label>
              <input id="tagline" className="input" value={form.tagline} onChange={e => setForm(f => ({ ...f, tagline: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">{translatePortalText("City / Port Region *")}</label>
                <input id="city" className="input" placeholder={translatePortalText("e.g. Jeddah, Dubai")} value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
              </div>
              <div>
                <label className="label">{translatePortalText("Region / Province")}</label>
                <input id="region" className="input" placeholder={translatePortalText("e.g. Makkah")} value={form.region} onChange={e => setForm(f => ({ ...f, region: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">{translatePortalText("Phone")}</label>
                <input id="phone" className="input font-mono" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
              <div>
                <label className="label">{translatePortalText("VHF channel")}</label>
                <input id="vhf" className="input font-mono" placeholder={translatePortalText("Ch 16, Ch 68")} value={form.vhf} onChange={e => setForm(f => ({ ...f, vhf: e.target.value }))} />
              </div>
            </div>
          </div>
        </Section>

        {/* fuel types + hours */}
        <Section title={translatePortalText("Fuel types & operating hours")} sub={translatePortalText("What you sell and when")}>
          <div className="flex flex-wrap gap-1.5">
            {catalogue.slice(0, 8).map(f => (
              <button key={f.key} onClick={() => void toggleFuel(f._id, f.name, !f.isActive)}
                className={`chip ring-1 transition ${f.isActive ? 'bg-amber-50 text-amber-700 ring-amber-200 hover:bg-amber-100' : 'bg-slate-50 text-slate-400 ring-slate-200 grayscale hover:bg-slate-100'}`}>{f.icon} {f.name.split(' ')[0]}</button>
            ))}
            <button className="chip border border-dashed border-slate-300 text-slate-400 hover:border-amber-400 hover:text-amber-600 transition" onClick={() => setFuelModal(true)}>{translatePortalText("+ Add")}</button>
          </div>

          <div id="hours" className="mt-4 space-y-3 rounded-xl transition-all duration-500">
            <div className="flex items-center justify-between rounded-xl bg-sand p-3">
              <div>
                <p className="text-xs font-extrabold text-deep-900">{translatePortalText("24/7 Bunkering Availability")}</p>
                <p className="text-[11px] text-slate-400">{translatePortalText("Open 24 hours round the clock")}</p>
              </div>
              <Toggle on={form.open24h} onChange={v => setForm(f => ({ ...f, open24h: v }))} />
            </div>

            <div className="space-y-2">
              <label className="label">{translatePortalText("Daily Working Schedule")}</label>
              {hours.slice(0, 3).map((h, i) => (
                <div key={h.label + i} className="flex items-center gap-2 text-[13px]">
                  <span className="w-24 font-bold text-slate-500">{translatePortalText(h.label)}</span>
                  <input className="input !py-1.5 font-mono text-xs" value={h.hours}
                    onChange={e => setHours(rows => rows.map((r, j) => j === i ? { ...r, hours: e.target.value } : r))} />
                </div>
              ))}
            </div>
          </div>
        </Section>

        {/* language & currency */}
        <Section title={translatePortalText("Language & currency")} sub={translatePortalText("Localization for receipts & customer apps")}>
          <div className="space-y-3">
            <div><label className="label"><Globe2 size={12} className="me-1 inline" />{translatePortalText(" Language")}</label>
              <select className="input"><option>{translatePortalText("English (US)")}</option><option>العربية</option><option>{translatePortalText("Français")}</option></select></div>
            <div><label className="label">{translatePortalText("Currency")}</label>
              <select className="input" value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
                <option value="SAR">{translatePortalText("SAR — ﷼ Riyal")}</option>
                <option value="AED">{translatePortalText("AED — د.إ Dirham")}</option>
                <option value="USD">{translatePortalText("USD — $ US Dollar")}</option>
                <option value="EUR">{translatePortalText("EUR — € Euro")}</option>
                <option value="GBP">{translatePortalText("GBP — £ Pound")}</option>
              </select></div>
            <div><label className="label">{translatePortalText("Units")}</label>
              <div className="grid grid-cols-2 gap-2">
                {(['Gallons (US)', 'Liters'] as const).map(u => {
                  const unit = u === 'Liters' ? 'L' : 'gal'
                  const on = catalogue.some(p => p.unit === unit)
                  return (
                    <button key={u} onClick={() => toast(translatePortalText("Set the unit per product from Inventory & Tanks"), 'info')}
                  className={`rounded-xl border-2 px-3 py-2.5 text-xs font-extrabold transition ${on ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-slate-100 text-slate-500 hover:border-slate-200'}`}>{translatePortalText(u)}</button>
                  )
                })}
              </div>
            </div>
            <div><label className="label">{translatePortalText("Timezone")}</label>
              <input className="input" value={form.timezone} onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))} /></div>
          </div>
        </Section>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Safety & Environmental Emergency Protocols */}
        <div id="safety" className="transition-all duration-500 rounded-2xl">
          <Section title={translatePortalText("Environmental Safety & Spill Procedures")} sub={translatePortalText("Port authority & emergency response protocols")}>
            <div className="space-y-3">
              <div>
                <label className="label">{translatePortalText("Emergency Hotline Email")}</label>
                <input
                  className="input"
                  placeholder={translatePortalText("spill-response@fueldock.com")}
                  value={form.emergencyEmail}
                  onChange={e => setForm(f => ({ ...f, emergencyEmail: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">{translatePortalText("Spill Response Protocol & SOP")}</label>
                <textarea
                  className="input h-20 py-2 resize-none text-xs"
                  placeholder={translatePortalText("Immediate deployment of floating containment booms and absorbent pads...")}
                  value={form.emergencyProceduresText}
                  onChange={e => setForm(f => ({ ...f, emergencyProceduresText: e.target.value }))}
                />
              </div>
            </div>
          </Section>
        </div>

        {/* Bank Payout Account Details */}
        <div id="bank_details" className="transition-all duration-500 rounded-2xl">
          <Section title={translatePortalText("Bank Payout & Direct Settlement")} sub={translatePortalText("Corporate account for automatic earnings disbursement")}>
            <BankDetailsFields
              value={form.bank}
              onChange={bank => setForm(f => ({ ...f, bank }))}
              errors={bankErrors}
              showAccountNumber
            />
          </Section>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* payment methods */}
        <Section title={translatePortalText("Payment methods")} sub={translatePortalText("Ways customers can pay you")}>
          <div className="space-y-2.5">
            {PAY_ROWS.map((p, i) => (
              <div key={p} className="flex items-center justify-between rounded-xl bg-sand px-3.5 py-3">
                <span className="flex items-center gap-2 text-[13px] font-bold text-deep-900"><CreditCard size={14} className="text-amber-500" />{translatePortalText(p)}</span>
                <Toggle on={pay[i]} onChange={v => { setPay(s => s.map((x, j) => j === i ? v : x)); toast(translatePortalText(`${p.replace(/^\S+ /, '')} ${v ? 'enabled' : 'disabled'}`)) }} />
              </div>
            ))}
          </div>
        </Section>

        {/* notification prefs */}
        <Section title={translatePortalText("Notification preferences")} sub={translatePortalText("Push, email & SMS alerts")}>
          <div className="space-y-2.5">
            {NOTIF_ROWS.map((n, i) => (
              <div key={n} className="flex items-center justify-between rounded-xl bg-sand px-3.5 py-3">
                <span className="flex items-center gap-2 text-[13px] font-bold text-deep-900"><BellRing size={14} className="text-amber-500" />{translatePortalText(n)}</span>
                <Toggle on={notifs[i]} onChange={v => { setNotifs(s => s.map((x, j) => j === i ? v : x)); toast(translatePortalText(`${n} ${v ? 'on' : 'off'}`)) }} />
              </div>
            ))}
          </div>
        </Section>

        {/* roles */}
        <Section title={translatePortalText("User roles & permissions")} sub={translatePortalText("Who can access what")}
          actions={<button className="btn-fuel !py-1.5 !px-3 text-xs" onClick={() => setRoleModal(true)}><Users size={13} />{translatePortalText(" Invite user")}</button>}>
          <div className="space-y-2.5">
            {staff.length === 0 && <p className="rounded-xl bg-sand px-3 py-6 text-center text-xs font-semibold text-slate-400">{translatePortalText("No crew on the roster yet.")}</p>}
            {staff.slice(0, 6).map((r: ApiFuelStaff, i) => (
              <motion.div key={r._id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                className="flex items-center gap-3 rounded-xl border border-slate-100 p-3">
                <img src={fileUrl(r.avatar) || PLACEHOLDER_AVATAR} className="h-10 w-10 rounded-full object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-extrabold text-deep-900">{r.name}</p>
                  <p className="text-[11px] text-slate-400">{translatePortalText(STAFF_ROLE_LABEL[r.role] ?? r.role)}</p>
                </div>
                <span className="chip bg-amber-50 text-amber-700 ring-1 ring-amber-200 text-[10px]"><ShieldCheck size={11} /> {translatePortalText(ROLE_PERMS[r.role] ?? 'Standard access')}</span>
              </motion.div>
            ))}
          </div>
        </Section>
      </div>

      <Modal open={fuelModal} onClose={() => setFuelModal(false)} title={translatePortalText("⛽ Fuel catalog")}>
        <div className="space-y-3">
          <div className="max-h-[360px] space-y-1.5 overflow-y-auto">
            {catalogue.map(f => (
              <label key={f.key} className="flex cursor-pointer items-center justify-between rounded-xl bg-sand px-3.5 py-2.5">
                <span className="flex items-center gap-2 text-[13px] font-bold text-deep-900">{f.icon} {f.name}</span>
                <input type="checkbox" checked={f.isActive} onChange={() => void toggleFuel(f._id, f.name, !f.isActive)} className="h-4 w-4 accent-amber-500" />
              </label>
            ))}
            {catalogue.length === 0 && <p className="py-6 text-center text-xs font-semibold text-slate-400">{translatePortalText("Add products from Inventory & Tanks.")}</p>}
          </div>
          <button className="btn-fuel w-full !justify-center !py-2.5" onClick={() => setFuelModal(false)}>{translatePortalText("Done")}</button>
        </div>
      </Modal>

      <Modal open={roleModal} onClose={() => setRoleModal(false)} title={translatePortalText("👥 Invite team member")}>
        <div className="space-y-4">
          <div><label className="label">{translatePortalText("Name")}</label>
            <input className="input" placeholder={translatePortalText("Sam Ortiz")} value={invite.name} onChange={e => setInvite(v => ({ ...v, name: e.target.value }))} /></div>
          <div><label className="label">{translatePortalText("Email")}</label>
            <input className="input" placeholder={translatePortalText("teammate@example.com")} value={invite.email} onChange={e => setInvite(v => ({ ...v, email: e.target.value }))} /></div>
          <div><label className="label">{translatePortalText("Role")}</label>
            <select className="input" value={invite.role} onChange={e => setInvite(v => ({ ...v, role: e.target.value as StaffRole }))}>
              {Object.entries(STAFF_ROLE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{translatePortalText(label)}{ROLE_PERMS[value] ? ` — ${translatePortalText(ROLE_PERMS[value])}` : translatePortalText("")}</option>
              ))}
            </select></div>
          <button className="btn-fuel w-full !justify-center !py-2.5" disabled={busy} onClick={sendInvite}>{translatePortalText("Send invite")}</button>
        </div>
      </Modal>
    </div>
  )
}
