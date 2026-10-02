import React, { useCallback, useEffect, useState } from 'react'
import { DEFAULT_MAP_CENTRE } from '../../shared/geoDefaults'
import { useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MapPin, MessagesSquare, Bell, ClipboardCheck, ScrollText, Settings as SettingsIcon,
  Phone, Radio, Send, Paperclip, Mic, Search, Navigation, Plus, Star, Award, Clock, Save, Maximize2, Minimize2, Battery, Wrench, ShieldCheck, User, Compass,
  Upload, Trash2, Landmark, CreditCard, Building2, AlertCircle, CheckCircle2, DollarSign, Calendar, Edit3, Siren, ShieldAlert, Sparkles, Check, ChevronRight,
} from 'lucide-react'
import {
  SERVICE_CATS,
  catByKey, avatar, MIMG, shopCoverPhotos,
  ALL_MARINE_SPECIALTIES,
} from '../maintData'
export { ALL_MARINE_SPECIALTIES }
import type { Technician } from '../maintData'
import { PageWrap } from './_shared'
import { Section, Img, CoverPhoto, Modal, Toggle, Stars, Counter, download, toCSV, ListRowSkeleton, TableSkeleton, Spinner, pickFiles } from '../../ui'
import { maintToast, MaintHeader, MBadge, useCall, CallModal } from '../maintUi'
import { FleetMap, Fleet3DMap, MapModeToggle, type MapPoint } from '../../fuel/fuelUi'
import { STALE_LOCATION_MS, maintenancePortalApi, maintenanceShopApi, type ApiMaintenanceShop, type MaintenanceTechnician, type MaintenanceOverview, type MaintenanceAuditLogEntry, chatApi, notificationsApi, type ApiChat, type ApiMessage, type ApiNotification } from '../../api'
import { localizeMaintenanceNotification } from '../maintNotificationI18n'
import { profileApi, fileUrl } from '../../api'
import MarinaLocationPicker, { type PickedPoint } from '../../components/MarinaLocationPicker'
import { useAuth } from '../../auth'
import BrandLogoManager from '../../components/BrandLogoManager'
import VendorLogoBadge from '../../components/VendorLogoBadge'
import { BankDetailsFields } from '../../components/BankDetailsFields'
import {
  EMPTY_BANK_DETAILS,
  bankPayload,
  formatIban,
  validateBankDetails,
  type BankDetailsErrors,
  type BankDetailsValue,
} from '../../utils/iban'
import { formatPortalClock, formatPortalCurrency, formatPortalDate, formatPortalNumber, formatPortalPercent, formatPortalTime, localizedField, portalLocale, translatePortalTemplate, translatePortalText } from '../../i18n/runtime'

export const DAYS_OF_WEEK = [
  { id: 0, label: 'Sun' },
  { id: 1, label: 'Mon' },
  { id: 2, label: 'Tue' },
  { id: 3, label: 'Wed' },
  { id: 4, label: 'Thu' },
  { id: 5, label: 'Fri' },
  { id: 6, label: 'Sat' },
]
const localizedDayLabel = (day: number) => formatPortalDate(new Date(2024, 0, 7 + day), { weekday: 'short' })

/** Map backend technician to the UI Technician shape (with mobile GPS coords). */
const toMobileTech = (t: MaintenanceTechnician, idx: number): Technician => ({
  id: t.id || (t as any)._id,
  name: t.name,
  avatar: t.avatar || avatar(Math.abs(t.name.charCodeAt(0) % 70)),
  role: String(localizedField(t, 'role') ?? t.role),
  skills: t.skills || [],
  status: t.status === 'on_duty' ? 'On duty' : t.status === 'off_duty' ? 'Off duty' : 'On leave',
  rating: (t as any).rating || 0,
  jobsToday: (t as any).jobsToday ?? 0,
  utilization: (t as any).utilization ?? 0,
  certs: (t.certifications || []).filter(Boolean).join(' · ') || '—',
  shift: '—',
  phone: t.phone || '',
  hoursWeek: (t as any).hoursWeek ?? 0,
  overtime: (t as any).overtime ?? 0,
  pos: { x: 50, y: 50 },
  lastLocation: t.lastLocation,
  mobile: t.mobile,
})

/**
 * Where the map opens when nothing has reported a position yet.
 *
 * A map has to be centred somewhere. This used to be a Miami harbour hardcoded
 * for a Jeddah business, *and* every technician pin was scattered around it
 * from their index in the roster — so the tracker moved people when you
 * re-sorted the list and never when they drove anywhere. Real coordinates now
 * come from `technician.lastLocation`; a technician without one is listed as
 * unlocated rather than given an invented pin.
 *
 * What remained was subtler: this point was also *drawn*, as a factory pin
 * labelled "Workshop base". The maintenance shop record carries no latitude or
 * longitude at all, so that pin asserted a location nobody had entered — and
 * every technician's distance from base read against it. It is now only the
 * centre the map opens at, never a marker: an anchor, not a claim.
 */
const MAP_CENTRE = DEFAULT_MAP_CENTRE

/** How long before a reported position stops counting as live. */
const isStale = (at?: string) => !at || Date.now() - new Date(at).valueOf() > STALE_LOCATION_MS

function lastSeenLabel(at?: string): string {
  if (!at) return translatePortalText('No location reported')
  const mins = Math.round((Date.now() - new Date(at).valueOf()) / 60000)
  if (mins < 1) return translatePortalText('Live now')
  const unit: Intl.RelativeTimeFormatUnit = mins < 60 ? 'minute' : 'hour'
  const amount = unit === 'minute' ? mins : Math.round(mins / 60)
  const relative = new Intl.RelativeTimeFormat(portalLocale(), { numeric: 'always' }).format(-amount, unit)
  return `${translatePortalText('Last seen')} ${relative}`
}

// ══════════ TECHNICIAN TRACKER (§10, §21, §25) ══════════
export function MaintMobile() { return <MobilePage /> }
// ══════════ COMMUNICATION (§24) ══════════
export function MaintMessages() { return <MessagesPage /> }
// ══════════ NOTIFICATIONS (§22) ══════════
export function MaintNotificationsPage() { return <NotifsPage /> }
// ══════════ WORKSHOP PROFILE ══════════
export function MaintWorkshop() { return <WorkshopPage /> }
// ══════════ AUDIT & LOGS (§30) ══════════
export function MaintAudit() { return <AuditPage /> }
// ══════════ SETTINGS (§31) ══════════
export function MaintSettings() { return <SettingsPage /> }

function MobilePage() {
  const [techList, setTechList] = useState<Technician[]>([])

  useEffect(() => {
    maintenancePortalApi.technicians()
      .then(res => setTechList((res.data.technicians || []).map(toMobileTech)))
      .catch(() => setTechList([]))
  }, [])

  /**
   * Which technicians the map is showing.
   *
   * The two chips above the map read "All Techs · N" and "On Duty · N" and
   * neither did anything — clicking them raised `toast('Showing all field
   * technicians')` and `toast('Filter: On Duty')` while the map stayed exactly
   * as it was. They were also both wrong: this list was *already* narrowed to
   * on-duty technicians, so "All Techs" was a label for a set that excluded
   * everybody off shift, and the two counts were necessarily identical — which
   * is the visible tell that neither chip filtered anything.
   *
   * Both sets are now derived separately, so the counts differ when the shifts
   * do, and the chip actually selects between them. On duty stays the default:
   * dispatch is about who can be sent now.
   */
  const [techFilter, setTechFilter] = useState<'all' | 'onduty'>('onduty')
  const mobileAll = techList.filter(t => t.mobile)
  const mobileOnDuty = mobileAll.filter(t => t.status === 'On duty')
  const mobileTechs = techFilter === 'all' ? mobileAll : mobileOnDuty
  const [sel, setSel] = useState<string | undefined>(undefined)
  const active = techList.find(t => t.id === (sel || mobileTechs[0]?.id))
  const { call, target, close } = useCall()
  const [radioOn, setRadioOn] = useState(false)
  const [isFull, setIsFull] = useState(false)
  const [techModal, setTechModal] = useState<any | null>(null)
  const [mapMode, setMapMode] = useState<'2d' | '3d'>('2d')

  /**
   * Only technicians who have actually reported a position get a pin.
   *
   * A tracker that invents coordinates is worse than one that admits it has
   * none: the desk dispatches on it. `unlocated` below says so plainly.
   */
  const located = mobileTechs.filter(t => t.lastLocation?.latitude != null && t.lastLocation?.longitude != null)
  const unlocated = mobileTechs.filter(t => !located.includes(t))

  const points: MapPoint[] = [
    ...located.map(t => ({
      id: t.id,
      lat: t.lastLocation!.latitude!,
      lng: t.lastLocation!.longitude!,
      label: t.name,
      icon: '🧑‍🔧',
      tone: (sel === t.id ? 'active' : isStale(t.lastLocation?.recordedAt) ? 'stale' : 'idle') as MapPoint['tone'],
      detail: lastSeenLabel(t.lastLocation?.recordedAt),
    })),
  ]

  const onPointClick = (id: string) => {
    // The `__base` pin no longer exists — it asserted a workshop location the
    // shop record does not hold — so nothing can be clicked at that id.
    setSel(id)
    setRadioOn(false)
    // Look the technician up in the loaded roster, not the sample array —
    // clicking a real technician's pin previously opened nothing.
    const tech = techList.find(t => t.id === id)
    if (tech) {
      setTechModal(tech)
    }
  }

  const dispatch = () => {
    const nearest = [...mobileTechs].sort((a, b) => a.utilization - b.utilization)[0]
    if (nearest) {
      setSel(nearest.id)
      setTechModal(nearest)
      maintToast(translatePortalTemplate('🚨 Emergency dispatch sent — {{name}} routing now', { name: nearest.name }), 'warn')
    }
  }

  // No `shareEta`. It minted `https://track.boatpro.app/eta/<id>-<Date.now() %
  // 100000>` and copied it to the clipboard under a modal telling the operator
  // to send it to the customer and that it "stays active until the job is
  // marked complete". There is no track.boatpro.app, no public ETA route, and
  // no token behind that suffix — the customer would have got a dead link.
  // Nothing ever called it, so the modal below could never open either; both
  // are gone rather than left as a promise the backend cannot keep. Technician
  // positions do exist server-side (locationTracking.service.ts), so a real
  // customer-facing ETA link is buildable — as a feature, not a string.

  return (
    <PageWrap>
      {!isFull && (
        <MaintHeader title={translatePortalText("Technician Tracker")} sub="Field technician GPS tracking, routes, customer ETA & emergency dispatch" icon={<MapPin className="text-violet-500" />}
          actions={
            <div className="flex items-center gap-2">
              <button className="btn-primary !bg-gradient-to-r !from-rose-600 !to-rose-400" onClick={dispatch}>{translatePortalText("🚨 Emergency SOS")}</button>
            </div>
          }
        />
      )}

      <div className={isFull ? "fixed inset-0 z-[100] w-screen h-screen bg-slate-900 p-4" : "w-full"}>
        {/* map */}
        <div className="w-full h-full">
          <div className={isFull ? "relative w-full h-[calc(100vh-32px)] overflow-hidden rounded-3xl border border-slate-700 shadow-2xl" : "relative h-[calc(100vh-220px)] min-h-[540px] overflow-hidden rounded-3xl border border-slate-200 shadow-lift"}>
            {mapMode === '2d' ? (
              <FleetMap points={points} center={{ lat: MAP_CENTRE.lat, lng: MAP_CENTRE.lng }} zoom={9} width="100%" height={isFull ? "calc(100vh - 32px)" : "calc(100vh - 220px)"} onPointClick={onPointClick} />
            ) : (
              <Fleet3DMap points={points} center={{ lat: MAP_CENTRE.lat, lng: MAP_CENTRE.lng }} width="100%" height={isFull ? "calc(100vh - 32px)" : "calc(100vh - 220px)"} onPointClick={onPointClick}
                onUnsupported={() => { setMapMode('2d'); maintToast("3D Earth isn't enabled for this API key yet — showing 2D map", 'warn') }} />
            )}

            {/*
              On-duty technicians the map cannot place.

              Said out loud rather than left as a silently shorter pin list: a
              dispatcher counting four people on the map and five on the roster
              needs to know which one is missing and why, not be left to assume
              the map is complete.
            */}
            {unlocated.length > 0 && (
              <div className="pointer-events-auto absolute bottom-3 end-3 z-20 max-w-[260px] rounded-2xl border border-amber-200 bg-amber-50/95 px-3 py-2 shadow-lg backdrop-blur">
                <p className="text-[11px] font-extrabold text-amber-800">
                  {formatPortalNumber(unlocated.length)} {translatePortalText("on duty, not sharing location")}
                </p>
                <p className="mt-0.5 text-[10px] leading-snug text-amber-700">
                  <bdi dir="auto">{unlocated.map(t => t.name).slice(0, 3).join(', ')}</bdi>
                  {unlocated.length > 3 ? ` ${translatePortalTemplate('+{{count}} more', { count: unlocated.length - 3 })}` : ''}
                  {translatePortalText(" — they appear once their app reports a position.")}
                </p>
              </div>
            )}

            {/* Top Floating Controls Bar */}
            <div className="pointer-events-none absolute top-4 start-4 end-4 z-20 flex flex-wrap items-center justify-between gap-2">
              {/* Status Chips */}
              <div className="pointer-events-auto flex items-center gap-1.5 rounded-2xl bg-white/95 p-1.5 shadow-lg backdrop-blur-md border border-slate-200 text-xs font-bold">
                <span className="px-2 py-1 font-extrabold text-deep-900 flex items-center gap-1.5 border-r border-slate-200">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-violet-600" />
                  </span>
                  {translatePortalText("GPS Live")}
                </span>
                <button
                  onClick={() => setTechFilter('all')}
                  aria-pressed={techFilter === 'all'}
                  className={`chip ${techFilter === 'all' ? 'bg-violet-600 text-white' : 'bg-sand text-slate-600 hover:bg-slate-200'}`}
                >
                  {translatePortalText("All Techs ·")} {formatPortalNumber(mobileAll.length)}
                </button>
                <button
                  onClick={() => setTechFilter('onduty')}
                  aria-pressed={techFilter === 'onduty'}
                  className={`chip ${techFilter === 'onduty' ? 'bg-violet-600 text-white' : 'bg-sand text-slate-600 hover:bg-slate-200'}`}
                >
                  {translatePortalText("On Duty ·")} {formatPortalNumber(mobileOnDuty.length)}
                </button>
              </div>

              {/* Fullscreen Toggle Button */}
              <div className="pointer-events-auto flex items-center gap-2">
                <MapModeToggle mode={mapMode} onChange={setMapMode} />
                <button
                  onClick={() => setIsFull(f => !f)}
                  className="flex items-center gap-1.5 rounded-2xl bg-white/95 px-3.5 py-2.5 text-xs font-extrabold text-deep-900 shadow-lg backdrop-blur-md hover:bg-white transition border border-slate-200 hover:scale-105 active:scale-95"
                >
                  {isFull ? <Minimize2 size={16} className="text-violet-600" /> : <Maximize2 size={16} className="text-violet-600" />}
                  {isFull ? translatePortalText("Exit full screen") : translatePortalText("Full screen")}
                </button>
              </div>
            </div>

            {/* Floating Live Techs Selector Bar */}
            <div className="pointer-events-auto absolute bottom-4 start-4 z-20 flex flex-wrap items-center gap-2 rounded-2xl bg-white/95 p-2 shadow-lift backdrop-blur border border-slate-200">
              <div className="px-2.5 py-1 text-xs font-extrabold text-deep-900 flex items-center gap-1.5 border-r border-slate-200">
                <span className="h-2 w-2 rounded-full bg-violet-600" />
                {formatPortalNumber(mobileTechs.length)} {translatePortalText("Active Techs")}
              </div>
              {mobileTechs.map(t => (
                <button
                  key={t.id}
                  onClick={() => onPointClick(t.id)}
                  className={`flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-xs font-bold transition ${
                    sel === t.id ? 'bg-violet-600 text-white shadow-sm' : 'bg-sand text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <img src={t.avatar} className="h-5 w-5 rounded-full object-cover" alt="" />
                  {t.name.split(' ')[0]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Technician Detailed Modal Dialog Overlay */}
      <Modal open={Boolean(techModal)} onClose={() => setTechModal(null)} title={techModal ? <>🧑‍🔧 {translatePortalText("Field Technician Profile")} — <bdi dir="auto">{techModal.name}</bdi></> : ''} wide>
        {techModal && (
          <div className="space-y-4 text-sm">
            <div className="flex items-center gap-4 rounded-2xl bg-sand p-4 border border-slate-200">
              <img src={techModal.avatar} className="h-16 w-16 rounded-2xl object-cover shadow-md ring-2 ring-violet-400" alt="" />
              <div className="flex-1 min-w-0">
                <h3 className="font-display text-lg font-extrabold text-deep-900 flex items-center gap-2">
                  <bdi dir="auto">{techModal.name}</bdi>
                  <MBadge>{translatePortalText("Mobile Field Tech")}</MBadge>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">{translatePortalText(techModal.role)}{techModal.rating > 0 ? <> · {translatePortalText("Rated")} <bdi dir="ltr">{formatPortalNumber(techModal.rating)} ★</bdi></> : ''}</p>
                <p className="text-[11px] text-emerald-600 font-bold flex items-center gap-1 mt-1">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  {translatePortalText("Live GPS Tracking Active ·")} {translatePortalText(techModal.status)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="rounded-xl border border-slate-100 bg-white p-3 text-center shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">{translatePortalText("Jobs Today")}</p>
                <p className="font-bold text-deep-900 text-sm">{techModal.jobsToday} {translatePortalText("assigned")}</p>
              </div>
              <div className="rounded-xl border border-slate-100 bg-white p-3 text-center shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">{translatePortalText("Utilization")}</p>
                <p className="font-bold text-violet-600 text-sm">{formatPortalPercent(techModal.utilization)}</p>
              </div>
              <div className="rounded-xl border border-slate-100 bg-white p-3 text-center shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">{translatePortalText("Battery Level")}</p>
                <p className="font-bold text-emerald-600 text-sm flex items-center justify-center gap-1"><Battery size={13} /> {formatPortalPercent(94)}</p>
              </div>
              <div className="rounded-xl border border-slate-100 bg-white p-3 text-center shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">{translatePortalText("GPS Coordinates")}</p>
                <p className="font-mono font-bold text-slate-600 text-[11px]" dir="ltr">{MAP_CENTRE.lat.toFixed(4)}, {MAP_CENTRE.lng.toFixed(4)}</p>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-100 p-4 bg-white space-y-2">
              <h4 className="font-bold text-deep-900 text-xs uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Wrench size={13} className="text-violet-500" /> {translatePortalText("Current Active Job Details")}
              </h4>
              <p className="text-xs text-slate-700 font-bold">{translatePortalText("Nordlys — 07:00 Dockside Engine Service")}</p>
              <p className="text-xs text-slate-400">{translatePortalText("Assigned vessel: Superyacht Nordlys at Berth D-02. Full hull wash & engine diagnostic check.")}</p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-ghost text-xs" onClick={() => setTechModal(null)}>{translatePortalText("Close")}</button>
              <button className="btn-maint text-xs" onClick={() => { call({ name: techModal.name, avatar: techModal.avatar, role: techModal.role, phone: techModal.phone }); setTechModal(null) }}>
                <Phone size={13} /> {translatePortalText("Call Tech")}
              </button>
              <button className="btn-primary text-xs" onClick={() => { maintToast(`ETA dispatch updated for ${techModal.name}`); setTechModal(null) }}>
                <Navigation size={13} /> {translatePortalText("Dispatch ETA")}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <CallModal target={target} onClose={close} />
    </PageWrap>
  )
}

/** Notification `type` → icon, shared with the marina portal's own Engage page. */
const NOTIF_ICON: Record<string, string> = {
  booking_request: '🔧', general: '🔔', work_order_assigned: '📋', payment_success: '💵',
  emergency_sos: '🚨', review_received: '⭐', documents_expiring: '📄', staff_assigned: '👷',
}
const NOTIF_TONE = (type: string): 'info' | 'success' | 'warn' | 'danger' =>
  /sos|emergency/.test(type) ? 'danger' : /payment/.test(type) ? 'success' : /expiring|warn/.test(type) ? 'warn' : 'info'

function MessagesPage() {
  const { user } = useAuth()
  const [chats, setChats] = useState<ApiChat[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ApiMessage[]>([])
  const [loadingChats, setLoadingChats] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const { call, target, close } = useCall()

  const loadChats = useCallback(async () => {
    setLoadingChats(true)
    try {
      const res = await chatApi.myMessageChats()
      const items = (res.data.items || []).filter(c => c.type !== 'support')
      setChats(items)
      setActiveId(prev => prev ?? (items[0] ? (items[0].id || items[0]._id) : null))
    } catch {
      maintToast('Failed to load conversations', 'warn')
    } finally {
      setLoadingChats(false)
    }
  }, [])

  useEffect(() => { loadChats() }, [loadChats])

  const loadMessages = useCallback(async (chatId: string) => {
    setLoadingMessages(true)
    try {
      const res = await chatApi.messages(chatId)
      setMessages(res.data.items || [])
      chatApi.markRead(chatId).catch(() => {})
    } catch {
      maintToast('Failed to load messages', 'warn')
    } finally {
      setLoadingMessages(false)
    }
  }, [])

  useEffect(() => { if (activeId) loadMessages(activeId) }, [activeId, loadMessages])

  const cidOf = (c: ApiChat) => c.id || c._id
  const active = chats.find(c => cidOf(c) === activeId) || null
  const other = (c: ApiChat | null) => c?.participants?.find(p => p._id !== user?._id) ?? c?.participants?.[0] ?? null
  const activeOther = other(active)

  const send = async () => {
    if (!activeId || !draft.trim()) return
    setSending(true)
    try {
      await chatApi.send(activeId, draft.trim())
      setDraft('')
      await loadMessages(activeId)
      await loadChats()
    } catch (e) {
      maintToast(e instanceof Error ? e.message : 'Message not sent', 'warn')
    } finally {
      setSending(false)
    }
  }

  const mine = (m: ApiMessage) => {
    const senderId = typeof m.sender === 'object' && m.sender ? m.sender._id : m.sender
    return senderId === user?._id
  }

  return (
    <PageWrap>
      <MaintHeader title={translatePortalText("Messages")} sub="Live chat with customers, technicians & suppliers" icon={<MessagesSquare className="text-violet-500" />} />
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* list */}
        <div className="card overflow-hidden">
          <div className="border-b border-slate-100 p-3"><div className="relative"><Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" /><input placeholder={translatePortalText("Search conversations…")} className="input ps-9" /></div></div>
          <div className="max-h-[520px] overflow-y-auto">
            {loadingChats && <ListRowSkeleton count={5} />}
            {!loadingChats && chats.length === 0 && <div className="py-10 text-center text-sm text-slate-400">{translatePortalText("No conversations yet.")}</div>}
            {chats.map(c => {
              const who = other(c)
              const cid = cidOf(c)
              return (
                <button key={cid} onClick={() => setActiveId(cid)} className={`flex w-full items-center gap-3 border-b border-slate-50 p-3 text-left transition ${activeId === cid ? 'bg-violet-50' : 'hover:bg-sand'}`}>
                  <img src={who?.avatar || avatar(1)} className="h-11 w-11 rounded-full object-cover" />
                  <div className="min-w-0 flex-1"><div className="flex items-center gap-1"><p className="truncate text-[13px] font-extrabold text-deep-900"><bdi dir="auto">{who?.name || translatePortalText('User')}</bdi></p><span className="ms-auto text-[10px] text-slate-400">{c.lastMessage?.at ? formatPortalTime(c.lastMessage.at) : ''}</span></div><p className="truncate text-[11px] text-slate-400">{c.lastMessage?.text || translatePortalText('No messages yet')}</p></div>
                  {!!c.unreadCount && <span className="grid h-5 w-5 place-items-center rounded-full bg-violet-500 text-[10px] font-extrabold text-white">{c.unreadCount}</span>}
                </button>
              )
            })}
          </div>
        </div>
        {/* thread */}
        <div className="card flex flex-col overflow-hidden">
          {active ? (<>
            <div className="flex items-center gap-3 border-b border-slate-100 p-4">
              <img src={activeOther?.avatar || avatar(1)} className="h-10 w-10 rounded-full object-cover" />
              <div className="min-w-0 flex-1"><p className="text-[14px] font-extrabold text-deep-900">{activeOther?.name || translatePortalText("User")}</p><p className="text-[11px] text-slate-400">{activeOther?.role ? translatePortalText(activeOther.role) : ''}</p></div>
              <button onClick={() => call({ name: activeOther?.name || 'User', avatar: activeOther?.avatar || avatar(1), role: activeOther?.role || '', phone: activeOther?.phone })} className="grid h-9 w-9 place-items-center rounded-full bg-violet-50 text-violet-600 hover:bg-violet-100"><Phone size={16} /></button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto bg-sand/40 p-4" style={{ minHeight: 340 }}>
              {loadingMessages && <ListRowSkeleton count={4} />}
              {!loadingMessages && messages.length === 0 && <div className="py-10 text-center text-sm text-slate-400">{translatePortalText("Say hello — no messages yet.")}</div>}
              {messages.map((m, i) => (
                <motion.div key={m.id || m._id || i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.04, 0.4) }} className={`flex ${mine(m) ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 text-sm shadow-soft ${mine(m) ? 'bg-gradient-to-r from-violet-600 to-indigo-500 text-white' : 'bg-white text-deep-800'}`}>
                    {m.text}
                    <p className={`mt-1 text-[9px] ${mine(m) ? 'text-white/60' : 'text-slate-400'}`}>{formatPortalTime(m.createdAt)}</p>
                  </div>
                </motion.div>
              ))}
            </div>
            <div className="flex items-center gap-2 border-t border-slate-100 p-3">
              <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} placeholder={translatePortalText("Type a message…")} className="input !rounded-full flex-1" />
              <button onClick={send} disabled={sending || !draft.trim()} className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-r from-violet-600 to-indigo-500 text-white shadow-glow transition hover:brightness-110 active:scale-95 disabled:opacity-60"><Send size={16} /></button>
            </div>
          </>) : (
            <div className="grid flex-1 place-items-center text-sm text-slate-400" style={{ minHeight: 400 }}>{loadingChats ? translatePortalText("Loading…") : translatePortalText("Pick a conversation")}</div>
          )}
        </div>
      </div>
      <CallModal target={target} onClose={close} />
    </PageWrap>
  )
}

function NotifsPage() {
  const [notifs, setNotifs] = useState<ApiNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('All')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await notificationsApi.list({ limit: 100 })
      setNotifs(res.data.items || [])
    } catch {
      maintToast('Failed to load notifications', 'warn')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const kinds = ['All', ...Array.from(new Set(notifs.map(n => n.type)))]
  const list = filter === 'All' ? notifs : notifs.filter(n => n.type === filter)
  const tones: Record<string, string> = { info: 'bg-indigo-50 text-indigo-600', success: 'bg-emerald-50 text-emerald-600', warn: 'bg-amber-50 text-amber-600', danger: 'bg-rose-50 text-rose-600' }

  const markAllRead = async () => {
    try {
      await notificationsApi.markAllRead()
      await load()
      maintToast('All notifications marked as read')
    } catch (e) {
      maintToast(e instanceof Error ? e.message : 'Could not mark them read', 'warn')
    }
  }
  const markOne = async (id: string) => {
    try {
      await notificationsApi.markRead(id)
      await load()
    } catch { /* non-critical */ }
  }

  return (
    <PageWrap>
      <MaintHeader title={translatePortalText("Notifications")} sub="Jobs, parts, approvals, payments, warranty & safety alerts" icon={<Bell className="text-violet-500" />}
        actions={<button className="btn-ghost" onClick={markAllRead}>{translatePortalText("Mark all read")}</button>} />
      <div className="mb-5 flex flex-wrap gap-1.5">
        {kinds.map(k => (
          <button key={k} onClick={() => setFilter(k)} className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${filter === k ? 'bg-gradient-to-r from-violet-600 to-indigo-500 text-white shadow-glow' : 'bg-white text-slate-500 hover:text-deep-900'}`}>{k === 'All' ? translatePortalText(k) : translatePortalText(k.replace(/_/g, ' '))}</button>
        ))}
      </div>
      {loading && <ListRowSkeleton count={6} />}
      {!loading && list.length === 0 && <div className="rounded-2xl border border-dashed border-slate-200 py-16 text-center text-sm text-slate-400">{translatePortalText("No notifications.")}</div>}
      {!loading && (
        <div className="space-y-2.5">
          {list.map((n, i) => {
            const copy = localizeMaintenanceNotification(n)
            return (
              <motion.button key={n._id} initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i * 0.04, 0.4) }}
                onClick={() => !n.isRead && markOne(n._id)}
                className={`flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition hover:shadow-soft ${!n.isRead ? 'border-violet-100 bg-violet-50/40' : 'border-slate-100 bg-white'}`}>
                <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl text-lg ${tones[NOTIF_TONE(n.type)]}`}>{NOTIF_ICON[n.type] || '🔔'}</span>
                <div className="min-w-0 flex-1"><p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-400">{copy.type} · {formatPortalDate(n.createdAt, { dateStyle: 'short', timeStyle: 'short' })}</p><p className="mt-0.5 text-sm font-medium text-deep-800">{copy.title}{copy.body ? ` — ${copy.body}` : ''}</p></div>
                {!n.isRead && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-violet-500 animate-pulse-soft" />}
              </motion.button>
            )
          })}
        </div>
      )}
    </PageWrap>
  )
}

// Same gallery sections offered in the registration wizard, so photos taken
// there and photos added later on this page live in one consistent layout.
const PHOTO_CATEGORIES = ['cover', 'logo', 'workshop', 'equipment', 'completed_work', 'team', 'vehicle']
const PHOTO_CATEGORY_LABELS: Record<string, string> = {
  cover: 'Cover', logo: 'Logo', workshop: 'Workshop', equipment: 'Equipment',
  completed_work: 'Completed work', team: 'Team', vehicle: 'Vehicle',
}
const PHOTO_CATEGORY_EMPTY_LABELS: Record<string, string> = {
  cover: 'No cover photos yet', workshop: 'No workshop photos yet', equipment: 'No equipment photos yet',
  completed_work: 'No completed work photos yet', team: 'No team photos yet', vehicle: 'No vehicle photos yet',
}
const localizedEmergencyName = (name?: string) =>
  !name || name === '24/7 Mobile Dispatch' ? translatePortalText('24/7 Mobile Dispatch') : name

function WorkshopPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, refreshMe } = useAuth()
  const [overview, setOverview] = useState<MaintenanceOverview | null>(null)
  const [shop, setShop] = useState<ApiMaintenanceShop | null>(null)
  const reloadShop = useCallback(async () => {
    try {
      const res = await maintenanceShopApi.mine()
      setShop(res.data.shop)
    } catch {}
  }, [])

  useEffect(() => { maintenancePortalApi.dashboard().then(res => setOverview(res.data)).catch(() => {}) }, [])
  useEffect(() => { void reloadShop() }, [reloadShop])
  const jobsDone = (overview?.metrics.workOrderCounts?.completed || 0) + (overview?.metrics.workOrderCounts?.delivered || 0)

  const profile = {
    name: shop?.nameEn || user?.business?.businessName || user?.name || 'Maintenance workshop',
    nameAr: shop?.nameAr || '',
    legal: user?.name || '—',
    tagline: shop?.descriptionEn || user?.business?.description || '',
    taglineAr: shop?.descriptionAr || '',
    city: shop?.city || '',
    region: shop?.region || '',
    address: shop?.address || user?.business?.address || '—',
    phone: shop?.contactNumber || user?.business?.contactNumber || user?.phone || '—',
    email: shop?.email || user?.email || '—',
    website: shop?.website || '',
  }

  const [editOpen, setEditOpen] = useState(false)
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [hoursOpen, setHoursOpen] = useState(false)
  const [emergencyOpen, setEmergencyOpen] = useState(false)

  const [form, setForm] = useState({
    name: profile.name,
    nameAr: profile.nameAr,
    tagline: profile.tagline,
    taglineAr: profile.taglineAr,
    city: profile.city,
    region: profile.region,
    phone: profile.phone,
    address: profile.address,
    email: profile.email,
    website: profile.website,
    /**
     * Normal maintenance or a boat ramp. New vendors choose this during
     * registration; it is editable here because every shop approved before the
     * field existed was defaulted to `maintenance`, and a ramp operator among
     * them has no other way to correct it.
     */
    serviceType: 'maintenance' as 'maintenance' | 'boat_ramp',
  })
  const [saving, setSaving] = useState(false)

  // Specialty Categories State
  const [selectedCats, setSelectedCats] = useState<string[]>([])
  const [customCatInput, setCustomCatInput] = useState('')

  // Operating Hours State
  const [hoursForm, setHoursForm] = useState({
    open24h: false,
    workingDays: [0, 1, 2, 3, 4], // Sun - Thu default
    openTime: '08:00',
    closeTime: '18:00',
    hourlyRateSar: 150,
  })

  // Emergency State
  const [emergencyForm, setEmergencyForm] = useState({
    name: '24/7 Mobile Dispatch',
    phone: '',
    email: '',
    fee: 250,
    procedures: '',
  })

  useEffect(() => {
    if (shop) {
      setForm({
        name: shop.nameEn || profile.name,
        nameAr: shop.nameAr || '',
        tagline: shop.descriptionEn || '',
        taglineAr: shop.descriptionAr || '',
        city: shop.city || '',
        region: shop.region || '',
        phone: shop.contactNumber || profile.phone,
        address: shop.address || profile.address,
        email: shop.email || profile.email,
        website: shop.website || '',
        // Absent means an older shop, and all of those are workshops — the
        // same resolution the API applies.
        serviceType: shop.serviceType === 'boat_ramp' ? 'boat_ramp' : 'maintenance',
      })
      if (Array.isArray(shop.serviceCategories)) {
        setSelectedCats(shop.serviceCategories)
      }
      if (shop.operatingHours) {
        setHoursForm({
          open24h: !!shop.operatingHours.open24h,
          workingDays: Array.isArray(shop.operatingHours.workingDays) ? shop.operatingHours.workingDays : [0, 1, 2, 3, 4],
          openTime: shop.operatingHours.openTime || '08:00',
          closeTime: shop.operatingHours.closeTime || '18:00',
          hourlyRateSar: shop.hourlyRateSar || 150,
        })
      } else if (shop.hourlyRateSar) {
        setHoursForm(h => ({ ...h, hourlyRateSar: shop.hourlyRateSar || 150 }))
      }
      if (shop.emergencyContacts && shop.emergencyContacts.length > 0) {
        const primary = shop.emergencyContacts[0]
        setEmergencyForm({
          name: primary.name || '24/7 Mobile Dispatch',
          phone: primary.phone || '',
          email: shop.emergencyEmail || '',
          fee: shop.emergencyVisitFeeSar ?? 250,
          procedures: shop.emergencyProceduresText || '',
        })
      } else {
        setEmergencyForm(e => ({
          ...e,
          phone: shop.contactNumber || '',
          email: shop.emergencyEmail || shop.email || '',
          fee: shop.emergencyVisitFeeSar ?? 250,
        }))
      }
    }
  }, [shop])

  const [uploadingCategory, setUploadingCategory] = useState<string | null>(null)
  const [viewPhoto, setViewPhoto] = useState<{ url: string; category?: string } | null>(null)
  const [photosOpen, setPhotosOpen] = useState(false)

  const W = profile
  const openEdit = () => {
    setForm({
      name: shop?.nameEn || profile.name,
      nameAr: shop?.nameAr || '',
      tagline: shop?.descriptionEn || profile.tagline,
      taglineAr: shop?.descriptionAr || '',
      city: shop?.city || profile.city,
      region: shop?.region || '',
      phone: shop?.contactNumber || profile.phone,
      address: shop?.address || profile.address,
      email: shop?.email || profile.email,
      website: shop?.website || '',
      serviceType: shop?.serviceType === 'boat_ramp' ? 'boat_ramp' : 'maintenance',
    })
    setEditOpen(true)
  }

  const focusTarget = useCallback((id: string) => {
    if (id === 'photos' || id === 'gallery_photos' || id === 'section-photos') {
      setPhotosOpen(true)
      const el = document.getElementById('section-photos') || document.getElementById('photos')
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.add('ring-4', 'ring-violet-500', 'ring-offset-2', 'rounded-2xl', 'transition-all', 'duration-500')
        setTimeout(() => el.classList.remove('ring-4', 'ring-violet-500', 'ring-offset-2'), 2500)
      }
      return
    }
    if (id === 'categories' || id === 'section-categories') {
      setCategoriesOpen(true)
      const el = document.getElementById('section-categories') || document.getElementById('categories')
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.add('ring-4', 'ring-violet-500', 'ring-offset-2', 'rounded-2xl', 'transition-all', 'duration-500')
        setTimeout(() => el.classList.remove('ring-4', 'ring-violet-500', 'ring-offset-2'), 2500)
      }
      return
    }
    if (id === 'hours' || id === 'operating_hours' || id === 'rates' || id === 'section-hours') {
      setHoursOpen(true)
      const el = document.getElementById('section-hours') || document.getElementById('hours')
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.add('ring-4', 'ring-violet-500', 'ring-offset-2', 'rounded-2xl', 'transition-all', 'duration-500')
        setTimeout(() => el.classList.remove('ring-4', 'ring-violet-500', 'ring-offset-2'), 2500)
      }
      return
    }
    if (id === 'emergency' || id === 'emergency_contacts' || id === 'section-emergency') {
      setEmergencyOpen(true)
      const el = document.getElementById('section-emergency') || document.getElementById('emergency')
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.add('ring-4', 'ring-violet-500', 'ring-offset-2', 'rounded-2xl', 'transition-all', 'duration-500')
        setTimeout(() => el.classList.remove('ring-4', 'ring-violet-500', 'ring-offset-2'), 2500)
      }
      return
    }
    if (id === 'name' || id === 'name_ar' || id === 'description' || id === 'description_ar' || id === 'address' || id === 'city' || id === 'phone') {
      openEdit()
      setTimeout(() => {
        const el = document.getElementById(id)
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
          el.focus?.()
          el.classList.add('ring-4', 'ring-violet-500', 'ring-offset-2', 'transition-all', 'duration-500')
          setTimeout(() => el.classList.remove('ring-4', 'ring-violet-500', 'ring-offset-2'), 2500)
        }
      }, 150)
      return
    }
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.focus?.()
      el.classList.add('ring-4', 'ring-violet-500', 'ring-offset-2', 'transition-all', 'duration-500')
      setTimeout(() => el.classList.remove('ring-4', 'ring-violet-500', 'ring-offset-2'), 2500)
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

  const saveEdit = async () => {
    if (!form.name.trim()) {
      maintToast('Workshop business name is required', 'warn')
      return
    }
    setSaving(true)
    try {
      await profileApi.updateBusiness({
        businessName: form.name,
        description: form.tagline,
        contactNumber: form.phone,
        address: form.address,
      })
      await maintenanceShopApi.update({
        nameEn: form.name.trim(),
        nameAr: form.nameAr.trim() || undefined,
        descriptionEn: form.tagline.trim() || undefined,
        descriptionAr: form.taglineAr.trim() || undefined,
        city: form.city.trim() || undefined,
        region: form.region.trim() || undefined,
        contactNumber: form.phone.trim() || undefined,
        address: form.address.trim() || undefined,
        email: form.email.trim() || undefined,
        website: form.website.trim() || undefined,
        serviceType: form.serviceType,
      })
      await refreshMe()
      await reloadShop()
      window.dispatchEvent(new CustomEvent('boatpro-shop-updated'))
      setEditOpen(false)
      maintToast('Workshop profile saved to database', 'success')
    } catch (e) {
      maintToast(e instanceof Error ? e.message : 'Could not save profile', 'warn')
    } finally {
      setSaving(false)
    }
  }

  const toggleCategory = (cat: string) => {
    setSelectedCats(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    )
  }

  const addCustomCategory = () => {
    const trimmed = customCatInput.trim()
    if (!trimmed) return
    if (!selectedCats.includes(trimmed)) {
      setSelectedCats(prev => [...prev, trimmed])
    }
    setCustomCatInput('')
  }

  const saveCategories = async () => {
    setSaving(true)
    try {
      await maintenanceShopApi.update({ serviceCategories: selectedCats })
      await reloadShop()
      window.dispatchEvent(new CustomEvent('boatpro-shop-updated'))
      setCategoriesOpen(false)
      maintToast('Specializations and service categories saved', 'success')
    } catch (e) {
      maintToast(e instanceof Error ? e.message : 'Could not save categories', 'warn')
    } finally {
      setSaving(false)
    }
  }

  const toggleWorkingDay = (dayId: number) => {
    setHoursForm(f => ({
      ...f,
      workingDays: f.workingDays.includes(dayId)
        ? f.workingDays.filter(d => d !== dayId)
        : [...f.workingDays, dayId].sort(),
    }))
  }

  const saveHours = async () => {
    setSaving(true)
    try {
      await maintenanceShopApi.update({
        operatingHours: {
          open24h: hoursForm.open24h,
          workingDays: hoursForm.workingDays,
          openTime: hoursForm.openTime,
          closeTime: hoursForm.closeTime,
        },
        hourlyRateSar: Number(hoursForm.hourlyRateSar) || undefined,
      })
      await reloadShop()
      window.dispatchEvent(new CustomEvent('boatpro-shop-updated'))
      setHoursOpen(false)
      maintToast('Working hours & labor tariffs updated', 'success')
    } catch (e) {
      maintToast(e instanceof Error ? e.message : 'Could not save schedule', 'warn')
    } finally {
      setSaving(false)
    }
  }

  const saveEmergency = async () => {
    setSaving(true)
    try {
      const contacts = emergencyForm.phone.trim()
        ? [{ name: emergencyForm.name.trim() || '24/7 Mobile Dispatch', phone: emergencyForm.phone.trim(), kind: 'mobile_emergency' }]
        : []
      await maintenanceShopApi.update({
        emergencyContacts: contacts,
        emergencyEmail: emergencyForm.email.trim() || undefined,
        emergencyVisitFeeSar: Number(emergencyForm.fee) || 0,
        emergencyProceduresText: emergencyForm.procedures.trim() || undefined,
      })
      await reloadShop()
      window.dispatchEvent(new CustomEvent('boatpro-shop-updated'))
      setEmergencyOpen(false)
      maintToast('Emergency mobile procedures & contacts saved', 'success')
    } catch (e) {
      maintToast(e instanceof Error ? e.message : 'Could not save emergency details', 'warn')
    } finally {
      setSaving(false)
    }
  }

  const addPhotos = async (category: string) => {
    const files = await pickFiles('image/*', true)
    if (!files.length) return
    setUploadingCategory(category)
    try {
      await maintenanceShopApi.uploadImages(files, category)
      await reloadShop()
      window.dispatchEvent(new CustomEvent('boatpro-shop-updated'))
      maintToast(`${files.length} photo${files.length === 1 ? '' : 's'} uploaded`, 'success')
    } catch (e) {
      maintToast(e instanceof Error ? e.message : 'Upload failed', 'warn')
    } finally {
      setUploadingCategory(null)
    }
  }

  const removePhoto = async (url: string) => {
    try {
      await maintenanceShopApi.deleteImage(url)
      await reloadShop()
      window.dispatchEvent(new CustomEvent('boatpro-shop-updated'))
      maintToast('Photo removed', 'warn')
    } catch (e) {
      maintToast(e instanceof Error ? e.message : 'Could not remove that photo', 'warn')
    }
  }

  const workingDaysLabel = () => {
    if (shop?.operatingHours?.open24h) return translatePortalText('24/7 Continuous Service')
    const days = shop?.operatingHours?.workingDays || []
    if (days.length === 0) return translatePortalText('Schedule Not Configured')
    if (days.length === 7) return translatePortalText('Open 7 Days a Week')
    const labels = DAYS_OF_WEEK.filter(d => days.includes(d.id)).map(d => localizedDayLabel(d.id))
    return `${labels.join(', ')} · ${formatPortalClock(shop?.operatingHours?.openTime || '08:00')} – ${formatPortalClock(shop?.operatingHours?.closeTime || '18:00')}`
  }

  return (
    <PageWrap>
      <MaintHeader
        title={translatePortalText("Workshop Profile")}
        sub="Public marine workshop identity, diagnostic specializations, working schedule & direct payouts"
        icon={<ClipboardCheck className="text-violet-500" />}
        actions={
          <button className="btn-maint flex items-center gap-1.5" onClick={openEdit}>
            <Edit3 size={14} /> {translatePortalText("Edit Profile")}
          </button>
        }
      />

      {/* Hero Banner */}
      <div className="relative mb-5 overflow-hidden rounded-3xl bg-maint-gradient text-white shadow-lift">
        <CoverPhoto srcs={shopCoverPhotos(shop)} className="absolute inset-0 h-full w-full opacity-30 object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0c0a1e]/90 via-[#0c0a1e]/70 to-transparent" />
        <div className="relative z-10 flex flex-wrap items-end justify-between gap-4 p-7">
          <div className="space-y-2 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-bold backdrop-blur-md">
                📍 {shop?.city ? <bdi dir="auto">{shop.city}</bdi> : translatePortalText("Port Region Not Set")}
              </span>
              {shop?.nameAr && (
                <span className="inline-flex items-center rounded-full bg-violet-500/30 px-2.5 py-0.5 text-xs font-bold text-violet-200 border border-violet-400/30">
                  {shop.nameAr}
                </span>
              )}
            </div>
            <h2 className="font-display text-3xl font-extrabold tracking-tight">{W.name}</h2>
            {W.tagline && <p className="text-sm text-white/80 leading-relaxed">{W.tagline}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-4 text-xs font-semibold text-white/90">
              <span className="flex items-center gap-1"><Wrench size={14} /> {formatPortalNumber(jobsDone)} {translatePortalText("jobs completed")}</span>
              <span className="flex items-center gap-1"><Clock size={14} /> {workingDaysLabel()}</span>
              {shop?.hourlyRateSar && (
                <span className="flex items-center gap-1"><DollarSign size={14} /> <bdi dir="ltr">{formatPortalCurrency(shop.hourlyRateSar, 'SAR')}</bdi> {translatePortalText("per hour standard labor")}</span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setPhotosOpen(true)} className="btn-ghost !bg-white/10 !border-white/20 !text-white hover:!bg-white/20 text-xs">
              📷 {formatPortalNumber(shop?.imagesCategorized?.length || 0)} {translatePortalText("Photos")}
            </button>
            <button onClick={openEdit} className="btn-primary !bg-violet-600 hover:!bg-violet-700 text-xs font-bold">
              {translatePortalText("✏️ Update Profile")}
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Business Details Section */}
        <Section title={translatePortalText("Business Identification & Contact")}>
          <div className="space-y-2 text-sm">
            {[
              ['Business Name (English)', W.name],
              ['Arabic Name (الاسم بالعربي)', W.nameAr || <span className="text-amber-500 font-normal">{translatePortalText("Not Set (Click Edit Profile)")}</span>],
              ['City / Port Region', W.city || <span className="text-rose-500 font-normal">{translatePortalText("Missing City")}</span>],
              ['Berth / Street Address', W.address],
              ['Direct Phone', W.phone],
              ['Official Email', W.email],
              ['Website URL', W.website || '—'],
            ].map(([k, v], i) => (
              <div key={i} className="flex items-center justify-between gap-3 border-b border-slate-50 dark:border-slate-800/60 py-2">
                <span className="text-slate-400 text-xs font-medium">{translatePortalText(String(k))}</span>
                <span className="text-right font-semibold text-deep-800 dark:text-slate-200 text-xs truncate max-w-[280px]">{v}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* Specializations & Categories Section */}
        <div id="section-categories" className="transition-all duration-500 rounded-2xl">
          <Section
            title={translatePortalText("Service Specializations & Categories")}
            sub={`${selectedCats.length} active service capabilities`}
            actions={
              <button id="categories" className="btn-maint !py-1.5 !px-3 text-xs" onClick={() => setCategoriesOpen(true)}>
                <Edit3 size={12} /> {translatePortalText("Manage")}
              </button>
            }
          >
            {selectedCats.length === 0 ? (
              <div className="rounded-xl border border-dashed border-amber-300/80 bg-amber-50/50 dark:bg-amber-950/20 p-4 text-center">
                <p className="text-xs font-bold text-amber-900 dark:text-amber-200">{translatePortalText("No specialties selected yet")}</p>
                <p className="text-[11px] text-amber-700/80 dark:text-amber-300/80 mt-0.5">
                  {translatePortalText("Select repair categories (e.g. Inboard/Outboard Engines, Marine Electronics, Hull & Gelcoat) to enhance boater search matching.")}
                </p>
                <button onClick={() => setCategoriesOpen(true)} className="btn-maint mt-2 !py-1 !px-3 text-xs">
                  {translatePortalText("+ Select Categories")}
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {selectedCats.map(cat => (
                    <span key={cat} className="inline-flex items-center gap-1.5 rounded-xl bg-violet-50 dark:bg-violet-950/50 border border-violet-200 dark:border-violet-800/60 px-2.5 py-1 text-xs font-bold text-violet-800 dark:text-violet-200">
                    <Wrench size={11} className="text-violet-600" /> {translatePortalText(cat)}
                  </span>
                ))}
              </div>
            )}
          </Section>
        </div>

        {/* Working Hours & Tariffs */}
        <div id="section-hours" className="transition-all duration-500 rounded-2xl">
          <Section
            title={translatePortalText("Working Schedule & Labor Rates")}
            sub={translatePortalText("Workshop hours, booking availability & standard hourly rates")}
            actions={
              <button id="hours" className="btn-maint !py-1.5 !px-3 text-xs" onClick={() => setHoursOpen(true)}>
                <Edit3 size={12} /> {translatePortalText("Edit Schedule")}
              </button>
            }
          >
            <div id="operating_hours" className="space-y-3">
              <div className="flex items-center justify-between rounded-xl bg-sand dark:bg-slate-900/60 p-3 text-xs">
                <div className="flex items-center gap-2">
                  <Clock className="text-violet-600 h-4 w-4" />
                  <div>
                    <p className="font-bold text-deep-900 dark:text-white">{translatePortalText("Operating Schedule")}</p>
                    <p className="text-slate-500 text-[11px]">{workingDaysLabel()}</p>
                  </div>
                </div>
                {shop?.operatingHours?.open24h && (
                  <span className="rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 text-[10px] font-black uppercase">
                    {translatePortalText("24/7 Live")}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
                  <p className="text-[10px] uppercase font-bold text-slate-400">{translatePortalText("Standard Labor Rate")}</p>
                  <p className="font-display text-base font-extrabold text-violet-600 mt-0.5">
                    {shop?.hourlyRateSar ? <bdi dir="ltr">{formatPortalCurrency(shop.hourlyRateSar, 'SAR')}</bdi> : translatePortalText("Not Set")}
                  </p>
                  <p className="text-[10px] text-slate-400">{translatePortalText("per billable hour")}</p>
                </div>
                <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
                  <p className="text-[10px] uppercase font-bold text-slate-400">{translatePortalText("Mobile Emergency Callout")}</p>
                  <p className="font-display text-base font-extrabold text-rose-600 mt-0.5">
                    {shop?.emergencyVisitFeeSar ? <bdi dir="ltr">{formatPortalCurrency(shop.emergencyVisitFeeSar, 'SAR')}</bdi> : translatePortalText("Not Set")}
                  </p>
                  <p className="text-[10px] text-slate-400">{translatePortalText("dispatch base fee")}</p>
                </div>
              </div>
            </div>
          </Section>
        </div>

        {/* Emergency Mobile Support */}
        <div id="section-emergency" className="transition-all duration-500 rounded-2xl">
          <Section
            title={translatePortalText("Emergency Mobile Support & Dispatch")}
            sub={translatePortalText("24/7 on-call contacts and marine SOS procedures")}
            actions={
              <button id="emergency" className="btn-maint !py-1.5 !px-3 text-xs" onClick={() => setEmergencyOpen(true)}>
                <Edit3 size={12} /> {translatePortalText("Configure")}
              </button>
            }
          >
            <div id="emergency_contacts" className="space-y-2.5 text-xs">
              <div className="flex items-center justify-between border-b border-slate-50 dark:border-slate-800/60 pb-2">
                <span className="text-slate-400">{translatePortalText("Emergency Dispatch Lead")}</span>
                <span className="font-bold text-deep-900 dark:text-white">
                  {localizedEmergencyName(emergencyForm.name)}
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-slate-50 dark:border-slate-800/60 pb-2">
                <span className="text-slate-400">{translatePortalText("Hotline Phone Number")}</span>
                <span className="font-mono font-bold text-deep-900 dark:text-white">
                  {emergencyForm.phone || <span className="text-amber-500 font-normal">{translatePortalText("Not Set")}</span>}
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-slate-50 dark:border-slate-800/60 pb-2">
                <span className="text-slate-400">{translatePortalText("Emergency Dispatch Email")}</span>
                <span className="font-semibold text-deep-900 dark:text-white truncate max-w-[200px]">
                  {emergencyForm.email || '—'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">{translatePortalText("Emergency Callout Rate")}</span>
                <span className="font-bold text-rose-600">
                  {shop?.emergencyVisitFeeSar ? <bdi dir="ltr">{formatPortalCurrency(shop.emergencyVisitFeeSar, 'SAR')}</bdi> : translatePortalText("Not Set")}
                </span>
              </div>
            </div>
          </Section>
        </div>
      </div>

      {/* Bank Payout Account Summary Card */}
      <div id="section-bank-workshop" className="mt-5 transition-all duration-500 rounded-2xl">
        <Section
          title={translatePortalText("Bank Payout Account Status")}
          sub={translatePortalText("Disbursement details for automatic bank transfer of work order earnings")}
          actions={
            <button
              onClick={() => navigate('/maint/billing#payout')}
              className="btn-maint !py-1.5 !px-3 text-xs flex items-center gap-1"
            >
              <Landmark size={13} /> {shop?.bank?.iban ? 'Manage Bank Details' : 'Set Bank Account'}
            </button>
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-4 p-2">
            <div className="flex items-center gap-3.5">
              <div className="h-10 w-10 shrink-0 rounded-xl bg-violet-50 dark:bg-violet-950 flex items-center justify-center text-violet-600">
                <Landmark size={20} />
              </div>
              <div>
                <p className="text-sm font-bold text-deep-900 dark:text-white">
                  {shop?.bank?.bankName ? <bdi dir="auto">{shop.bank.bankName} · {shop.bank.accountHolderName || ''}</bdi> : translatePortalText("No Bank Payout Account Set")}
                </p>
                <p className="text-xs font-mono text-slate-500 mt-0.5">
                  {shop?.bank?.iban ? <bdi dir="ltr">{translatePortalText("IBAN:")} {formatIban(shop.bank.iban)}</bdi> : translatePortalText("IBAN is required for automatic revenue disbursement.")}
                </p>
              </div>
            </div>

            <div>
              {shop?.bank?.iban ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950 px-3 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-200">
                  <ShieldCheck size={13} /> {translatePortalText("Payout Account Ready")}
                </span>
              ) : (
                <button
                  onClick={() => navigate('/maint/billing#payout')}
                  className="btn-primary !bg-rose-600 hover:!bg-rose-700 text-xs font-bold !py-1.5 !px-3.5"
                >
                  {translatePortalText("Set Bank Details")}
                </button>
              )}
            </div>
          </div>
        </Section>
      </div>

      {/* Photos & Brand Logo Section */}
      <div id="section-photos" className="mt-5 transition-all duration-500 rounded-2xl">
        <Section
          title={translatePortalText("Photos & Brand Logo")}
          sub={`${shop?.imagesCategorized?.length ?? 0} photos · Official Logo & Workshop Service Facilities`}
          actions={
            <button id="photos" className="btn-maint !py-1.5 !px-3 text-xs" onClick={() => setPhotosOpen(true)}>
              {translatePortalText("Manage Photos & Logo")}
            </button>
          }
        >
          <div className="flex items-center gap-4">
            {shop?.logo || shop?.imagesCategorized?.find(i => i.category === 'logo')?.url ? (
              <div className="relative h-14 w-14 shrink-0 rounded-xl border border-slate-200 dark:border-slate-800 p-1.5 bg-slate-50 dark:bg-slate-900 flex items-center justify-center shadow-2xs" title={translatePortalText("Official Brand Logo")}>
                <img src={fileUrl((shop?.logo || shop?.imagesCategorized?.find(i => i.category === 'logo')?.url)!)} alt={translatePortalText("Logo")} className="max-h-full max-w-full object-contain" />
                <span className="absolute -bottom-1 -end-1 rounded-md bg-violet-500 text-[8px] font-black text-white px-1">{translatePortalText("LOGO")}</span>
              </div>
            ) : (
              <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-sand border border-dashed border-slate-300 text-[10px] font-bold text-slate-400">
                {translatePortalText("No Logo")}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-deep-900 dark:text-white">
                {shop?.logo || shop?.imagesCategorized?.find(i => i.category === 'logo')?.url ? translatePortalText("Brand Logo Active ✨") : translatePortalText("No Brand Logo Uploaded Yet")}
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {translatePortalText("Upload workshop interior, tools, service vans, and dockside refit pictures (")}{formatPortalNumber(shop?.images?.length || 0)} {translatePortalText("/ 3+ uploaded).")}
              </p>
            </div>
          </div>
        </Section>
      </div>

      {/* Edit Profile Modal */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={translatePortalText("✏️ Edit Workshop Business Profile")} wide>
        <div className="space-y-4 text-sm max-h-[75vh] overflow-y-auto pe-1">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label font-bold text-xs">{translatePortalText("Workshop Name (English) *")}</label>
              <input id="name" className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder={translatePortalText("e.g. HarborTech Marine Service")} />
            </div>
            <div>
              <label className="label font-bold text-xs">{translatePortalText("Arabic Name (الاسم بالعربي)")}</label>
              <input id="name_ar" className="input" value={form.nameAr} onChange={e => setForm(f => ({ ...f, nameAr: e.target.value }))} placeholder="مثال: خدمات هاربور تك البحرية" dir="rtl" />
            </div>
          </div>

          <div>
            <label className="label font-bold text-xs">{translatePortalText("Service Type *")}</label>
            <select
              id="serviceType"
              className="input"
              value={form.serviceType}
              onChange={e => setForm(f => ({ ...f, serviceType: e.target.value as 'maintenance' | 'boat_ramp' }))}
            >
              <option value="maintenance">{translatePortalText("Normal maintenance")}</option>
              <option value="boat_ramp">{translatePortalText("Boat's ramp")}</option>
            </select>
            <p className="text-[11px] text-slate-500 mt-1">
              {translatePortalText("Boat owners filter the directory by this, so it decides who finds you. A boat ramp launches and\r\n              retrieves boats by trailer; normal maintenance covers repairs, servicing and inspections.")}
            </p>
          </div>

          <div>
            <label className="label font-bold text-xs">{translatePortalText("Services Bio & Overview (English)")}</label>
            <textarea id="description" className="input min-h-[70px]" value={form.tagline} onChange={e => setForm(f => ({ ...f, tagline: e.target.value }))} placeholder={translatePortalText("Detail diagnostic capabilities, brand specializations (Yamaha, Mercury, Volvo Penta), and dockside mobile service reach.")} />
          </div>

          <div>
            <label className="label font-bold text-xs">{translatePortalText("Arabic Bio & Description (الوصف بالعربي)")}</label>
            <textarea id="description_ar" className="input min-h-[70px]" value={form.taglineAr} onChange={e => setForm(f => ({ ...f, taglineAr: e.target.value }))} placeholder={translatePortalText("نبذة عن خدمات الصيانة والإصلاح والقطع البحرية...")} dir="rtl" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label font-bold text-xs">{translatePortalText("City / Port Region *")}</label>
              <input id="city" className="input" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder={translatePortalText("e.g. Jeddah, Dammam, Yanbu, Riyadh")} />
            </div>
            <div>
              <label className="label font-bold text-xs">{translatePortalText("Province / Region")}</label>
              <input className="input" value={form.region} onChange={e => setForm(f => ({ ...f, region: e.target.value }))} placeholder={translatePortalText("e.g. Makkah Province, Eastern Province")} />
            </div>
          </div>

          <div>
            <label className="label font-bold text-xs">{translatePortalText("Workshop / Berth Address *")}</label>
            <input id="address" className="input" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder={translatePortalText("Physical workshop address or shipyard slipway location")} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="label font-bold text-xs">{translatePortalText("Direct Phone *")}</label>
              <input id="phone" className="input" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder={translatePortalText("+966 50 123 4567")} />
            </div>
            <div>
              <label className="label font-bold text-xs">{translatePortalText("Official Email")}</label>
              <input className="input" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder={translatePortalText("service@harbortech.sa")} />
            </div>
            <div>
              <label className="label font-bold text-xs">{translatePortalText("Website URL")}</label>
              <input className="input" value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} placeholder={translatePortalText("https://harbortech.sa")} />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button className="btn-ghost text-xs" onClick={() => setEditOpen(false)}>{translatePortalText("Cancel")}</button>
            <button onClick={saveEdit} disabled={saving} className="btn-maint text-xs flex items-center gap-1.5 disabled:opacity-60">
              <Save size={14} /> {saving ? translatePortalText("Saving…") : translatePortalText("Save Workshop Profile")}
            </button>
          </div>
        </div>
      </Modal>

      {/* Specializations & Categories Modal */}
      <Modal open={categoriesOpen} onClose={() => setCategoriesOpen(false)} title={translatePortalText("🔧 Service Specializations & Categories")} wide>
        <div className="space-y-4 text-sm max-h-[75vh] overflow-y-auto pe-1">
          <p className="text-xs text-slate-500">
            {translatePortalText("Select the specialized service categories and brand capabilities your workshop handles. These appear on search filters for boaters.")}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {ALL_MARINE_SPECIALTIES.map(cat => {
              const active = selectedCats.includes(cat)
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => toggleCategory(cat)}
                  className={`flex items-center justify-between p-3 rounded-xl border text-left text-xs font-bold transition ${
                    active
                      ? 'border-violet-500 bg-violet-50/80 dark:bg-violet-950/40 text-violet-900 dark:text-violet-200'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:border-violet-300'
                  }`}
                >
                  <span>{translatePortalText(cat)}</span>
                  <span className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-black ${
                    active ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-400'
                  }`}>
                    {active ? '✓' : '+'}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="border-t border-slate-100 dark:border-slate-800 pt-3">
            <label className="label font-bold text-xs">{translatePortalText("Add Custom Specialization")}</label>
            <div className="flex gap-2">
              <input
                className="input text-xs"
                placeholder={translatePortalText("e.g. Seakeeper Gyro Stabilizers, Carbon Fiber Refit")}
                value={customCatInput}
                onChange={e => setCustomCatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addCustomCategory()}
              />
              <button type="button" onClick={addCustomCategory} className="btn-ghost shrink-0 text-xs font-bold">
                {translatePortalText("+ Add")}
              </button>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button className="btn-ghost text-xs" onClick={() => setCategoriesOpen(false)}>{translatePortalText("Cancel")}</button>
            <button onClick={saveCategories} disabled={saving} className="btn-maint text-xs flex items-center gap-1.5 disabled:opacity-60">
              <Save size={14} /> {saving ? translatePortalText("Saving…") : translatePortalTemplate('Save {{count}} Categories', { count: selectedCats.length })}
            </button>
          </div>
        </div>
      </Modal>

      {/* Operating Hours Modal */}
      <Modal open={hoursOpen} onClose={() => setHoursOpen(false)} title={translatePortalText("⏰ Working Hours & Labor Rates")}>
        <div className="space-y-4 text-sm">
          <div className="flex items-center justify-between rounded-xl bg-sand dark:bg-slate-900 p-3">
            <div>
              <p className="font-bold text-xs text-deep-900 dark:text-white">{translatePortalText("24/7 Continuous Service")}</p>
              <p className="text-[11px] text-slate-500">{translatePortalText("Enable if your technicians take calls around the clock")}</p>
            </div>
            <Toggle on={hoursForm.open24h} onChange={v => setHoursForm(f => ({ ...f, open24h: v }))} />
          </div>

          {!hoursForm.open24h && (
            <>
              <div>
                <label className="label font-bold text-xs">{translatePortalText("Active Working Days")}</label>
                <div className="flex gap-1.5">
                  {DAYS_OF_WEEK.map(d => {
                    const active = hoursForm.workingDays.includes(d.id)
                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => toggleWorkingDay(d.id)}
                        className={`h-9 flex-1 rounded-xl text-xs font-bold transition ${
                          active
                            ? 'bg-violet-600 text-white shadow-sm'
                            : 'bg-sand dark:bg-slate-800 text-slate-500 hover:bg-slate-200'
                        }`}
                      >
                        {localizedDayLabel(d.id)}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label font-bold text-xs">{translatePortalText("Opening Time")}</label>
                  <input
                    type="time"
                    className="input"
                    value={hoursForm.openTime}
                    onChange={e => setHoursForm(f => ({ ...f, openTime: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label font-bold text-xs">{translatePortalText("Closing Time")}</label>
                  <input
                    type="time"
                    className="input"
                    value={hoursForm.closeTime}
                    onChange={e => setHoursForm(f => ({ ...f, closeTime: e.target.value }))}
                  />
                </div>
              </div>
            </>
          )}

          <div>
            <label className="label font-bold text-xs">{translatePortalText("Standard Labor Rate (SAR / hour) *")}</label>
            <input
              type="number"
              min={0}
              className="input font-bold"
              value={hoursForm.hourlyRateSar}
              onChange={e => setHoursForm(f => ({ ...f, hourlyRateSar: Number(e.target.value) }))}
              placeholder={translatePortalText("150")}
            />
            <p className="text-[11px] text-slate-400 mt-1">{translatePortalText("Default billing rate for work orders and estimates.")}</p>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button className="btn-ghost text-xs" onClick={() => setHoursOpen(false)}>{translatePortalText("Cancel")}</button>
            <button onClick={saveHours} disabled={saving} className="btn-maint text-xs flex items-center gap-1.5 disabled:opacity-60">
              <Save size={14} /> {saving ? translatePortalText("Saving…") : translatePortalText("Save Working Hours")}
            </button>
          </div>
        </div>
      </Modal>

      {/* Emergency Mobile Support Modal */}
      <Modal open={emergencyOpen} onClose={() => setEmergencyOpen(false)} title={translatePortalText("🚨 Emergency Mobile Support & Hotline")}>
        <div className="space-y-4 text-sm">
          <div>
            <label className="label font-bold text-xs">{translatePortalText("Emergency On-Call Dispatcher Name")}</label>
            <input
              className="input"
              value={localizedEmergencyName(emergencyForm.name)}
              onChange={e => setEmergencyForm(f => ({ ...f, name: e.target.value }))}
              placeholder={translatePortalText("e.g. Lead Mobile Tech / Dispatch Duty")}
            />
          </div>

          <div>
            <label className="label font-bold text-xs">{translatePortalText("24/7 Mobile Emergency Phone Number *")}</label>
            <input
              className="input font-mono"
              value={emergencyForm.phone}
              onChange={e => setEmergencyForm(f => ({ ...f, phone: e.target.value }))}
              placeholder={translatePortalText("+966 50 999 8888")}
            />
            <p className="text-[11px] text-slate-400 mt-1">{translatePortalText("Direct contact for boaters experiencing at-sea breakdowns.")}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label font-bold text-xs">{translatePortalText("Emergency Email")}</label>
              <input
                className="input"
                value={emergencyForm.email}
                onChange={e => setEmergencyForm(f => ({ ...f, email: e.target.value }))}
                placeholder={translatePortalText("sos@harbortech.sa")}
              />
            </div>
            <div>
              <label className="label font-bold text-xs">{translatePortalText("Mobile Callout Fee (SAR)")}</label>
              <input
                type="number"
                min={0}
                className="input font-bold"
                value={emergencyForm.fee}
                onChange={e => setEmergencyForm(f => ({ ...f, fee: Number(e.target.value) }))}
                placeholder={translatePortalText("250")}
              />
            </div>
          </div>

          <div>
            <label className="label font-bold text-xs">{translatePortalText("Emergency Procedures / Notes")}</label>
            <textarea
              className="input min-h-[60px]"
              value={emergencyForm.procedures}
              onChange={e => setEmergencyForm(f => ({ ...f, procedures: e.target.value }))}
              placeholder={translatePortalText("e.g. Mobile repair boat dispatched within 45 minutes across Jeddah port radius.")}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button className="btn-ghost text-xs" onClick={() => setEmergencyOpen(false)}>{translatePortalText("Cancel")}</button>
            <button onClick={saveEmergency} disabled={saving} className="btn-maint text-xs flex items-center gap-1.5 disabled:opacity-60">
              <Save size={14} /> {saving ? translatePortalText("Saving…") : translatePortalText("Save Emergency Settings")}
            </button>
          </div>
        </div>
      </Modal>

      {/* Photos & Brand Logo Modal */}
      <Modal open={photosOpen} onClose={() => setPhotosOpen(false)} title={translatePortalText("📷 Manage Photos & Brand Logo")} wide>
        <div className="space-y-6 max-h-[75vh] overflow-y-auto pe-1">
          <BrandLogoManager
            logoUrl={shop?.logo || shop?.imagesCategorized?.find(i => i.category === 'logo')?.url}
            providerName={shop?.nameEn || 'Marine Workshop'}
            categoryLabel="Maintenance Workshop"
            onUpload={async (file) => {
              await maintenanceShopApi.uploadImages([file], 'logo')
              await reloadShop()
              window.dispatchEvent(new CustomEvent('boatpro-shop-updated'))
            }}
            onRemove={async (url) => {
              await maintenanceShopApi.deleteImage(url)
              await reloadShop()
              window.dispatchEvent(new CustomEvent('boatpro-shop-updated'))
            }}
          />

          <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-400 mb-4">
              {translatePortalText("Workshop Gallery Sections (")}{formatPortalNumber(shop?.images?.length || 0)} {translatePortalText("Total Photos)")}
            </h4>
            <div className="space-y-5">
              {PHOTO_CATEGORIES.filter(c => c !== 'logo').map((cat) => {
                const imgs = (shop?.imagesCategorized || []).filter((i) => (i.category || 'other') === cat)
                const labelKey = PHOTO_CATEGORY_LABELS[cat] || cat
                const label = translatePortalText(labelKey)
                return (
                  <div key={cat}>
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                        {label}{cat === 'cover' ? translatePortalText(" (rotating)") : ''} <span className="font-normal normal-case text-slate-300">· {formatPortalNumber(imgs.length)}</span>
                      </p>
                      <button className="btn-maint !py-1 !px-2 text-[11px]" disabled={uploadingCategory === cat} onClick={() => addPhotos(cat)}>
                        {uploadingCategory === cat ? <Spinner size={11} /> : <Upload size={11} />} {translatePortalText("Add")}
                      </button>
                    </div>
                    {imgs.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 py-6 text-center text-[11px] text-slate-400">
                        {translatePortalText(PHOTO_CATEGORY_EMPTY_LABELS[cat] || 'No photos yet')}
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-2">
                        {imgs.map((img) => (
                          <button key={img.url} type="button" onClick={() => setViewPhoto(img)}
                            className="group relative overflow-hidden rounded-xl text-left">
                            <img src={fileUrl(img.url)} alt="" className="h-24 w-full object-cover" />
                            <span onClick={(e) => { e.stopPropagation(); removePhoto(img.url) }}
                              className="absolute end-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-lg bg-white/90 text-rose-500 opacity-0 transition group-hover:opacity-100">
                              <Trash2 size={13} />
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </Modal>

      {/* Photo Viewer Modal */}
      <Modal open={!!viewPhoto} onClose={() => setViewPhoto(null)}
        title={viewPhoto ? translatePortalText(PHOTO_CATEGORY_LABELS[viewPhoto.category || 'other'] || 'Photo') : translatePortalText("Photo")} wide>
        {viewPhoto && (
          <div className="space-y-3">
            <img src={fileUrl(viewPhoto.url)} alt="" className="max-h-[65vh] w-full rounded-xl bg-slate-50 object-contain" />
            <div className="flex justify-end">
              <button className="btn-ghost text-xs text-rose-500" onClick={() => { removePhoto(viewPhoto.url); setViewPhoto(null) }}>
                <Trash2 size={13} /> {translatePortalText("Remove photo")}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </PageWrap>
  )
}

const AUDIT_ICON: Record<string, string> = { MaintenanceWorkOrder: '📋', MaintenancePart: '📦', MaintenanceRequest: '✍️', Payment: '💵', MaintenanceTechnician: '👷' }
const auditResourceLabel = (value: string) => translatePortalText(value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim())
const auditActionLabel = (value: string) => translatePortalText(value ? value[0].toUpperCase() + value.slice(1) : value)
function AuditPage() {
  const [filter, setFilter] = useState('All')
  const [logs, setLogs] = useState<MaintenanceAuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    maintenancePortalApi.auditLog({ limit: 100 })
      .then(res => setLogs(res.data.items || []))
      .catch(() => maintToast('Could not load audit log', 'warn'))
      .finally(() => setLoading(false))
  }, [])

  const kinds = ['All', ...Array.from(new Set(logs.map(l => l.resource)))]
  const list = logs.filter(l => filter === 'All' || l.resource === filter)
  return (
    <PageWrap>
      <MaintHeader title={translatePortalText("Audit & Logs")} sub="Activity trail across work orders, inventory, approvals, payments & system" icon={<ScrollText className="text-violet-500" />}
        actions={<button className="btn-ghost" onClick={() => download('audit-log.csv', toCSV(logs.map(l => ({ [translatePortalText('Time')]: l.createdAt, [translatePortalText('Actor')]: l.actor?.name || '—', [translatePortalText('Action')]: auditActionLabel(l.action), [translatePortalText('Resource')]: auditResourceLabel(l.resource) }))), 'text/csv;charset=utf-8')}>{translatePortalText("Export log")}</button>} />
      <div className="mb-5 flex flex-wrap gap-1.5">
        {kinds.map(k => (
          <button key={k} onClick={() => setFilter(k)} className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${filter === k ? 'bg-gradient-to-r from-violet-600 to-indigo-500 text-white shadow-glow' : 'bg-white text-slate-500 hover:text-deep-900'}`}>{k === 'All' ? translatePortalText(k) : auditResourceLabel(k)}</button>
        ))}
      </div>
      {loading && <TableSkeleton rows={6} cols={3} />}
      {!loading && list.length === 0 && <div className="rounded-2xl border border-dashed border-slate-200 py-16 text-center text-sm text-slate-400">{translatePortalText("No activity logged yet.")}</div>}
      {!loading && list.length > 0 && (
      <div className="card overflow-hidden">
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full min-w-[700px]">
            <thead><tr className="border-b border-slate-100">{['Action', 'Resource', 'Actor', 'Time'].map(h => <th key={h} className="th">{translatePortalText(h)}</th>)}</tr></thead>
            <tbody>
              {list.map(l => (
                <tr key={l.id || (l as any)._id} className="border-b border-slate-50 hover:bg-sand/60">
                  <td className="td font-extrabold flex items-center gap-2 whitespace-nowrap"><span className="text-base">{AUDIT_ICON[l.resource] || '📄'}</span> {auditActionLabel(l.action)}</td>
                  <td className="td text-xs text-slate-500 whitespace-nowrap">{auditResourceLabel(l.resource)} <span className="text-[10px] text-slate-300">#{l.resourceId?.slice(-6)}</span></td>
                  <td className="td whitespace-nowrap"><span className="chip text-[11px] font-bold">{l.actor?.name || translatePortalText("System")}</span></td>
                  <td className="td text-xs text-slate-400 whitespace-nowrap">{formatPortalDate(l.createdAt, { dateStyle: 'short', timeStyle: 'short' })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}
    </PageWrap>
  )
}

function SettingsPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, refreshMe } = useAuth()
  const [shop, setShop] = useState<ApiMaintenanceShop | null>(null)
  const [busy, setBusy] = useState(false)

  const [point, setPoint] = useState<PickedPoint>({
    latitude: user?.business?.latitude ?? 21.4858,
    longitude: user?.business?.longitude ?? 39.1925,
    address: user?.business?.address ?? '',
  })

  const [form, setForm] = useState({
    name: user?.business?.businessName ?? '',
    nameAr: '',
    city: '',
    region: '',
    phone: user?.business?.contactNumber ?? '',
    description: '',
    descriptionAr: '',
  })

  const [flags, setFlags] = useState({ email: true, sms: true, push: true, autoAssign: true, predictive: true, emergency: true })
  const setFlag = (k: keyof typeof flags) => (v: boolean) => setFlags(s => ({ ...s, [k]: v }))

  // Categories
  const [selectedCats, setSelectedCats] = useState<string[]>([])
  const [addCatOpen, setAddCatOpen] = useState(false)
  const [newCat, setNewCat] = useState('')

  // Working Hours & Rates
  const [hoursState, setHoursState] = useState({
    open24h: false,
    workingDays: [0, 1, 2, 3, 4],
    openTime: '08:00',
    closeTime: '18:00',
    hourlyRateSar: 150,
    emergencyVisitFeeSar: 250,
    inspectionFeeSar: 100,
    // No `tax` here: VAT is platform-wide, not a per-workshop rate. This state
    // carried a hardcoded '15.0%' that was never read or submitted, and reading
    // as shop-level config is exactly the confusion worth removing.
    currency: 'SAR (﷼)',
    language: 'English / Arabic',
  })

  // Emergency SOP
  const [emergencyState, setEmergencyState] = useState({
    name: '24/7 Mobile Dispatch',
    phone: '',
    email: '',
    procedures: '',
  })

  // Bank — typed against the shared value shape so `BankDetailsFields` owns the
  // inputs and the IBAN gets the same checksum test as everywhere else.
  const [bankState, setBankState] = useState<BankDetailsValue>(EMPTY_BANK_DETAILS)
  const [bankErrors, setBankErrors] = useState<BankDetailsErrors>({})

  const loadShop = useCallback(async () => {
    try {
      const res = await maintenanceShopApi.mine()
      const s = res.data.shop
      if (s) {
        setShop(s)
        setForm({
          name: s.nameEn || user?.business?.businessName || '',
          nameAr: s.nameAr || '',
          city: s.city || '',
          region: s.region || '',
          phone: s.contactNumber || user?.business?.contactNumber || '',
          description: s.descriptionEn || '',
          descriptionAr: s.descriptionAr || '',
        })
        if (s.latitude && s.longitude) {
          setPoint({
            latitude: s.latitude,
            longitude: s.longitude,
            address: s.address || '',
          })
        }
        if (Array.isArray(s.serviceCategories)) {
          setSelectedCats(s.serviceCategories)
        }
        if (s.operatingHours) {
          setHoursState(h => ({
            ...h,
            open24h: !!s.operatingHours.open24h,
            workingDays: Array.isArray(s.operatingHours.workingDays) ? s.operatingHours.workingDays : [0, 1, 2, 3, 4],
            openTime: s.operatingHours.openTime || '08:00',
            closeTime: s.operatingHours.closeTime || '18:00',
            hourlyRateSar: s.hourlyRateSar || 150,
            emergencyVisitFeeSar: s.emergencyVisitFeeSar ?? 250,
            inspectionFeeSar: s.inspectionFeeSar ?? 100,
          }))
        } else {
          setHoursState(h => ({
            ...h,
            hourlyRateSar: s.hourlyRateSar || 150,
            emergencyVisitFeeSar: s.emergencyVisitFeeSar ?? 250,
            inspectionFeeSar: s.inspectionFeeSar ?? 100,
          }))
        }
        if (s.emergencyContacts && s.emergencyContacts.length > 0) {
          const primary = s.emergencyContacts[0]
          setEmergencyState({
            name: primary.name || '24/7 Mobile Dispatch',
            phone: primary.phone || '',
            email: s.emergencyEmail || '',
            procedures: s.emergencyProceduresText || '',
          })
        } else {
          setEmergencyState(e => ({
            ...e,
            phone: s.contactNumber || '',
            email: s.emergencyEmail || '',
          }))
        }
        if (s.bank) {
          setBankState({
            bankName: s.bank.bankName || '',
            accountHolderName: s.bank.accountHolderName || '',
            iban: s.bank.iban || '',
            accountNumber: s.bank.accountNumber || '',
            swiftCode: s.bank.swiftCode || '',
          })
        }
      }
    } catch {}
  }, [user])

  useEffect(() => { void loadShop() }, [loadShop])

  const focusTarget = useCallback((id: string) => {
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.focus?.()
      el.classList.add('ring-4', 'ring-violet-500', 'ring-offset-2', 'transition-all', 'duration-500')
      setTimeout(() => el.classList.remove('ring-4', 'ring-violet-500', 'ring-offset-2'), 2500)
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

  const toggleCategory = (cat: string) => {
    setSelectedCats(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    )
  }

  const addCategory = () => {
    if (!newCat.trim()) return
    if (!selectedCats.includes(newCat.trim())) {
      setSelectedCats(cs => [...cs, newCat.trim()])
    }
    setNewCat('')
    setAddCatOpen(false)
  }

  const toggleWorkingDay = (dayId: number) => {
    setHoursState(f => ({
      ...f,
      workingDays: f.workingDays.includes(dayId)
        ? f.workingDays.filter(d => d !== dayId)
        : [...f.workingDays, dayId].sort(),
    }))
  }

  const saveSettings = async () => {
    /**
     * The bank block is checked before anything is sent: this saves the business
     * profile and the shop in two calls, so a rejection halfway through would
     * leave them half-applied, and the message would surface as a toast detached
     * from the field that caused it.
     */
    const bankIssues = validateBankDetails(bankState)
    setBankErrors(bankIssues)
    if (Object.keys(bankIssues).length) {
      maintToast('Check the bank payout details before saving', 'warn')
      return
    }

    setBusy(true)
    try {
      await profileApi.updateBusiness({
        businessName: form.name,
        contactNumber: form.phone,
        address: point.address,
        latitude: point.latitude,
        longitude: point.longitude,
      })

      const emergencyContacts = emergencyState.phone.trim()
        ? [{ name: emergencyState.name.trim() || '24/7 Mobile Dispatch', phone: emergencyState.phone.trim(), kind: 'mobile_emergency' }]
        : []

      // Normalised, with the bank name and SWIFT derived from the Saudi bank
      // code when they were left blank; undefined when there is no destination.
      const bank = bankPayload(bankState)

      await maintenanceShopApi.update({
        nameEn: form.name.trim(),
        nameAr: form.nameAr.trim() || undefined,
        descriptionEn: form.description.trim() || undefined,
        descriptionAr: form.descriptionAr.trim() || undefined,
        city: form.city.trim() || undefined,
        region: form.region.trim() || undefined,
        contactNumber: form.phone.trim() || undefined,
        address: point.address.trim() || undefined,
        latitude: point.latitude || undefined,
        longitude: point.longitude || undefined,
        serviceCategories: selectedCats,
        operatingHours: {
          open24h: hoursState.open24h,
          workingDays: hoursState.workingDays,
          openTime: hoursState.openTime,
          closeTime: hoursState.closeTime,
        },
        hourlyRateSar: Number(hoursState.hourlyRateSar) || undefined,
        emergencyVisitFeeSar: Number(hoursState.emergencyVisitFeeSar) || 0,
        inspectionFeeSar: Number(hoursState.inspectionFeeSar) || 0,
        emergencyContacts,
        emergencyEmail: emergencyState.email.trim() || undefined,
        emergencyProceduresText: emergencyState.procedures.trim() || undefined,
        bank,
      })

      await refreshMe()
      await loadShop()
      window.dispatchEvent(new CustomEvent('boatpro-shop-updated'))
      maintToast('Workshop settings and readiness profile saved', 'success')
    } catch (e) {
      maintToast(e instanceof Error ? e.message : 'Could not save the settings', 'warn')
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageWrap>
      <MaintHeader
        title={translatePortalText("Settings")}
        sub="Categories, working schedule, mobile emergency hotline, tariffs, bank payout & system preferences"
        icon={<SettingsIcon className="text-violet-500" />}
        actions={
          <button className="btn-maint flex items-center gap-1.5" disabled={busy} onClick={saveSettings}>
            <Save size={14} /> {busy ? translatePortalText("Saving…") : translatePortalText("Save changes")}
          </button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Location & Workshop Identity */}
        <div id="location" className="lg:col-span-2 transition-all duration-500 rounded-2xl">
          <Section title={translatePortalText("Location & Workshop Identity")} sub={translatePortalText("Name in English & Arabic, Port Region and GPS coordinates")}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-4">
              <div>
                <label className="label font-bold text-xs">{translatePortalText("Workshop Name (English) *")}</label>
                <input id="name" className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder={translatePortalText("e.g. HarborTech Marine Service")} />
              </div>
              <div>
                <label className="label font-bold text-xs">{translatePortalText("Arabic Name (الاسم بالعربي)")}</label>
                <input id="name_ar" className="input" value={form.nameAr} onChange={e => setForm(f => ({ ...f, nameAr: e.target.value }))} placeholder="مثال: خدمات هاربور تك البحرية" dir="rtl" />
              </div>
              <div>
                <label className="label font-bold text-xs">{translatePortalText("City / Port Region *")}</label>
                <input id="city" className="input" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder={translatePortalText("e.g. Jeddah, Dammam, Yanbu")} />
              </div>
              <div>
                <label className="label font-bold text-xs">{translatePortalText("Contact Phone *")}</label>
                <input id="phone" className="input" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder={translatePortalText("+966 50 123 4567")} />
              </div>
              <div className="sm:col-span-2">
                <label className="label font-bold text-xs">{translatePortalText("Berth / Street Address")}</label>
                <input id="address" className="input" value={point.address} onChange={e => setPoint(p => ({ ...p, address: e.target.value }))} placeholder={translatePortalText("Slipway / Marina dock address")} />
              </div>
            </div>
            <MarinaLocationPicker value={point} onChange={setPoint} />
          </Section>
        </div>

        {/* Service Categories & Specializations */}
        <div id="categories" className="transition-all duration-500 rounded-2xl">
          <Section
            title={translatePortalText("Service Specializations & Categories")}
            sub={translatePortalText("Active service lines & capabilities for boater discovery")}
            actions={
              <button onClick={() => setAddCatOpen(true)} className="btn-ghost !py-1 !px-2.5 text-xs font-bold">
                {translatePortalText("+ Add Custom")}
              </button>
            }
          >
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {ALL_MARINE_SPECIALTIES.map(cat => {
                  const active = selectedCats.includes(cat)
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => toggleCategory(cat)}
                      className={`flex items-center justify-between p-2.5 rounded-xl border text-left text-xs font-bold transition ${
                        active
                          ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/40 text-violet-900 dark:text-violet-200'
                          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:border-violet-300'
                      }`}
                    >
                      <span className="truncate">{translatePortalText(cat)}</span>
                      <span className={`h-4 w-4 rounded-full flex items-center justify-center text-[9px] font-black ${
                        active ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-400'
                      }`}>
                        {active ? '✓' : '+'}
                      </span>
                    </button>
                  )
                })}
              </div>

              {selectedCats.filter(c => !ALL_MARINE_SPECIALTIES.includes(c)).length > 0 && (
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">{translatePortalText("Custom Categories")}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedCats.filter(c => !ALL_MARINE_SPECIALTIES.includes(c)).map(cat => (
                      <span key={cat} className="inline-flex items-center gap-1 rounded-lg bg-violet-100 dark:bg-violet-950 text-violet-800 dark:text-violet-200 px-2 py-0.5 text-xs font-bold">
                        {cat}
                        <button type="button" onClick={() => toggleCategory(cat)} className="hover:text-rose-500 ms-1">×</button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Section>
        </div>

        {/* Working Hours & Availability */}
        <div id="hours" className="transition-all duration-500 rounded-2xl">
          <div id="rates">
            <Section title={translatePortalText("Working Schedule & Tariffs")} sub={translatePortalText("Availability schedule & hourly labor rates")}>
              <div id="operating_hours" className="space-y-3.5">
                <div className="flex items-center justify-between rounded-xl bg-sand dark:bg-slate-900 p-3">
                  <div>
                    <p className="font-bold text-xs text-deep-900 dark:text-white">{translatePortalText("24/7 Continuous Service")}</p>
                    <p className="text-[11px] text-slate-500">{translatePortalText("Workshop handles continuous emergency callouts")}</p>
                  </div>
                  <Toggle on={hoursState.open24h} onChange={v => setHoursState(f => ({ ...f, open24h: v }))} />
                </div>

                {!hoursState.open24h && (
                  <>
                    <div>
                      <label className="label font-bold text-xs mb-1.5">{translatePortalText("Working Days")}</label>
                      <div className="flex gap-1">
                        {DAYS_OF_WEEK.map(d => {
                          const active = hoursState.workingDays.includes(d.id)
                          return (
                            <button
                              key={d.id}
                              type="button"
                              onClick={() => toggleWorkingDay(d.id)}
                              className={`h-8 flex-1 rounded-lg text-xs font-bold transition ${
                                active
                                  ? 'bg-violet-600 text-white shadow-xs'
                                  : 'bg-sand dark:bg-slate-800 text-slate-500 hover:bg-slate-200'
                              }`}
                            >
                              {localizedDayLabel(d.id)}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="label font-bold text-xs">{translatePortalText("Opening Time")}</label>
                        <input
                          type="time"
                          className="input"
                          value={hoursState.openTime}
                          onChange={e => setHoursState(f => ({ ...f, openTime: e.target.value }))}
                        />
                      </div>
                      <div>
                        <label className="label font-bold text-xs">{translatePortalText("Closing Time")}</label>
                        <input
                          type="time"
                          className="input"
                          value={hoursState.closeTime}
                          onChange={e => setHoursState(f => ({ ...f, closeTime: e.target.value }))}
                        />
                      </div>
                    </div>
                  </>
                )}

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="label font-bold text-xs">{translatePortalText("Standard Labor (SAR/hr) *")}</label>
                    <input
                      type="number"
                      min={0}
                      className="input font-bold"
                      value={hoursState.hourlyRateSar}
                      onChange={e => setHoursState(f => ({ ...f, hourlyRateSar: Number(e.target.value) }))}
                    />
                  </div>
                  <div>
                    <label className="label font-bold text-xs">{translatePortalText("Emergency Callout (SAR)")}</label>
                    <input
                      type="number"
                      min={0}
                      className="input font-bold"
                      value={hoursState.emergencyVisitFeeSar}
                      onChange={e => setHoursState(f => ({ ...f, emergencyVisitFeeSar: Number(e.target.value) }))}
                    />
                  </div>
                </div>
              </div>
            </Section>
          </div>
        </div>

        {/* Emergency Hotline & Procedures */}
        <div id="emergency" className="transition-all duration-500 rounded-2xl">
          <Section title={translatePortalText("Emergency Mobile Support & Procedures")} sub={translatePortalText("On-call mobile mechanics and response protocol")}>
            <div id="emergency_contacts" className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label font-bold text-xs">{translatePortalText("Emergency Contact Name")}</label>
                  <input
                    className="input"
                    value={localizedEmergencyName(emergencyState.name)}
                    onChange={e => setEmergencyState(f => ({ ...f, name: e.target.value }))}
                    placeholder={translatePortalText("e.g. 24/7 Mobile Dispatch")}
                  />
                </div>
                <div>
                  <label className="label font-bold text-xs">{translatePortalText("Hotline Phone *")}</label>
                  <input
                    className="input font-mono"
                    value={emergencyState.phone}
                    onChange={e => setEmergencyState(f => ({ ...f, phone: e.target.value }))}
                    placeholder={translatePortalText("+966 50 999 8888")}
                  />
                </div>
              </div>
              <div>
                <label className="label font-bold text-xs">{translatePortalText("Emergency Dispatch Email")}</label>
                <input
                  className="input"
                  value={emergencyState.email}
                  onChange={e => setEmergencyState(f => ({ ...f, email: e.target.value }))}
                  placeholder={translatePortalText("sos@harbortech.sa")}
                />
              </div>
              <div>
                <label className="label font-bold text-xs">{translatePortalText("Standard Operating Procedure / SOP Notes")}</label>
                <textarea
                  className="input min-h-[55px]"
                  value={emergencyState.procedures}
                  onChange={e => setEmergencyState(f => ({ ...f, procedures: e.target.value }))}
                  placeholder={translatePortalText("e.g. Mobile repair boat dispatched within 45 minutes across Jeddah port radius.")}
                />
              </div>
            </div>
          </Section>
        </div>

        {/* Bank Payout Account Details */}
        <div id="bank" className="transition-all duration-500 rounded-2xl">
          <div id="bank_details">
            <Section title={translatePortalText("Bank Payout Account (Settlement)")} sub={translatePortalText("Direct bank disbursement for work orders and digital payments")}>
              <div className="text-xs">
                <BankDetailsFields
                  value={bankState}
                  onChange={setBankState}
                  errors={bankErrors}
                  showAccountNumber
                />
              </div>
            </Section>
          </div>
        </div>

        {/* Notification Preferences */}
        <Section title={translatePortalText("Notification & Dispatch Preferences")} sub={translatePortalText("Automated workflow alerts")}>
          <div className="space-y-1">
            {[
              ['Email notifications', 'email'],
              ['SMS notifications', 'sms'],
              ['Push notifications', 'push'],
              ['AI auto-assignment', 'autoAssign'],
              ['Predictive maintenance alerts', 'predictive'],
              ['Emergency callout dispatch', 'emergency'],
            ].map(([label, key]) => (
              <div key={key} className="flex items-center justify-between border-b border-slate-50 dark:border-slate-800/60 py-2">
                <span className="text-xs font-semibold text-deep-800 dark:text-slate-200">{translatePortalText(label)}</span>
                <Toggle on={flags[key as keyof typeof flags]} onChange={setFlag(key as keyof typeof flags)} />
              </div>
            ))}
          </div>
        </Section>
      </div>

      <Modal open={addCatOpen} onClose={() => setAddCatOpen(false)} title={translatePortalText("➕ Add Custom Service Category")}>
        <div className="space-y-3">
          <div>
            <label className="label font-bold text-xs">{translatePortalText("Category Name")}</label>
            <input
              className="input"
              value={newCat}
              onChange={e => setNewCat(e.target.value)}
              placeholder={translatePortalText("e.g. Watermaker Systems, Bow Thrusters")}
              autoFocus
            />
          </div>
          <button onClick={addCategory} className="btn-maint w-full !justify-center">
            {translatePortalText("Add Category")}
          </button>
        </div>
      </Modal>
    </PageWrap>
  )
}
