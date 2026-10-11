import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { ClipboardList, Wrench, Stethoscope, CalendarDays, Plus, Check, X, Pencil, Copy, Printer, Pause, Play, ArrowRight, UserCog, Search, Filter, Clock, Calendar, Lock, Bell, CreditCard, CheckCircle2, Trash2, CalendarClock, Receipt } from 'lucide-react'
import {
  INSPECTION_TYPES, MAINT_CATEGORIES, catByKey, money, avatar,
  type MaintRequest, type WorkOrder, type Inspection, type CheckResult, type SchedItem,
} from '../maintData'
import { PageWrap, ChartTip } from './_shared'
import { Section, Modal, Counter, printDoc } from '../../ui'
import { ProposeRescheduleModal, AwaitingRescheduleReply } from '../components/ProposeRescheduleModal'
import { maintToast, MaintHeader, MBadge, HealthRing, JobProgress, MaintViewToggle } from '../maintUi'
import { useMaintLive } from '../maintLive'
import { maintenancePortalApi, type MaintenanceCustomer, type MaintenanceInspection, type MaintenanceProviderRequest, type MaintenanceTechnician, type MaintenanceWorkOrder } from '../../api'
import { useAuth } from '../../auth'
import { useLimitAwareAction } from '../../shared/packageLimit'
import { formatPortalCurrency, formatPortalDate, formatPortalNumber, formatPortalPercent, formatPortalTime, isPortalArabic, localizedField, translatePortalTemplate, translatePortalText } from '../../i18n/runtime'

// Built from the backend enum, not the SERVICE_CATS display grouping: these
// options are submitted verbatim as a request's/work order's `category`, and
// SERVICE_CATS both keys navigation as 'nav' (rejected by the API) and has no
// entry for fuel, safety, paint, cleaning, inspection or other.
const CAT_NAMES = MAINT_CATEGORIES.map(c => ({ key: c.key, name: translatePortalText(c.name) }))
// Sentence case, matching the JobStatus union and every TABS/badge comparison
// ('in_progress' -> 'In progress'). Title-casing each word gave 'In Progress',
// which no filter or badge check matched — the In progress tab was always empty.
const displayStatus = (status: string) => {
  const words = status.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}
const toRequestView = (request: MaintenanceProviderRequest): MaintRequest => {
  const requestedAt = new Date(request.requestedAt)
  /*
    The appointment the customer booked, when they booked one. The list showed
    only when the request was sent, so a job booked for Sunday 08:00 read
    "Thursday 17:14" and the shop had to open the app to find the time.
  */
  const booked = request.preferredDate ? new Date(request.preferredDate) : null
  const when = booked && !Number.isNaN(booked.getTime()) ? booked : null
  return {
    id: request.id,
    ref: `REQ-${request.id.slice(-4).toUpperCase()}`,
    requested: `${formatPortalDate(requestedAt)} · ${formatPortalTime(requestedAt)}`,
    booked: !!when,
    quoteResponse: request.customerQuoteResponse,
    customer: request.customer?.name || translatePortalText('Customer'),
    avatar: request.customer?.avatar || '',
    boat: request.boatName,
    boatType: '',
    boatLen: request.boatLengthFt ? `${formatPortalNumber(request.boatLengthFt)} ${translatePortalText('ft')}` : '',
    cat: request.category,
    title: String(localizedField(request, 'title') ?? request.title),
    desc: String(localizedField(request, 'description') ?? request.description),
    sourceTitle: request.title,
    sourceDesc: request.description,
    date: formatPortalDate(when ?? requestedAt, when ? { weekday: 'short', month: 'short', day: 'numeric' } : undefined),
    time: when && request.preferredSlot ? request.preferredSlot : formatPortalTime(when ?? requestedAt),
    priority: displayStatus(request.priority) as MaintRequest['priority'],
    status: (request.status === 'declined' ? 'Cancelled' : displayStatus(request.status)) as MaintRequest['status'],
    emergency: request.priority === 'critical',
    // The owner's attached photos were reported as zero on every request.
    photos: request.photos?.length ?? 0,
    source: 'BoatPro',
    location: request.location || '',
    est: request.quotedAmount,
  }
}
const toWorkOrderView = (order: MaintenanceWorkOrder): WorkOrder => {
  const rawSched = order.scheduledFor || (order as any).request?.scheduledFor || (order as any).request?.preferredDate
  const schedDate = rawSched ? new Date(rawSched) : undefined
  const hasValidSched = schedDate && !isNaN(schedDate.getTime())
  const rawSlot = (order as any).request?.preferredSlot
  const timeStr = hasValidSched
    ? formatPortalTime(schedDate)
    : rawSlot || undefined
  const dateStr = hasValidSched
    ? formatPortalDate(schedDate, { month: 'short', day: 'numeric', year: 'numeric' })
    : undefined

  const totalCost = (order.laborCost || 0) + (order.partsCost || 0)
  const isPaid = (order as any).paymentStatus === 'paid' || (order as any).invoice?.status === 'paid' || totalCost === 0

  return {
    id: order.id,
    reqId: '',
    boat: order.boatName,
    customer: order.customerName || 'Customer',
    avatar: '',
    cat: order.category,
    title: String(localizedField(order, 'title') ?? order.title),
    tech: order.technician?.name || 'Unassigned',
    techAvatar: order.technician?.avatar || '',
    priority: displayStatus(order.priority) as WorkOrder['priority'],
    status: displayStatus(order.status) as WorkOrder['status'],
    statusKey: order.status,
    code: order.code,
    created: formatPortalDate(order.createdAt),
    due: order.dueDate ? formatPortalDate(order.dueDate) : 'Not scheduled',
    scheduledFor: order.scheduledFor,
    date: dateStr,
    time: timeStr,
    progress: order.progress,
    hours: order.workedHours,
    estHours: order.estimatedHours,
    labor: order.laborCost,
    parts: order.partsCost,
    vat: (order as any).vat,
    paused: order.paused,
    bookedRole: order.bookedRoleAr && isPortalArabic() ? order.bookedRoleAr : order.bookedRole,
    hourlyRate: order.hourlyRate,
    assignments: order.assignments ?? [],
    paymentStatus: isPaid ? 'paid' : 'unpaid',
    invoice: (order as any).invoice,
    agreedQuote: (order as any).request?.customerQuoteResponse === 'accepted' && (order as any).request?.quotedAmount > 0
      ? Number((order as any).request.quotedAmount)
      : undefined,
    invoiceTotal: typeof (order as any).invoice?.total === 'number' ? (order as any).invoice.total : undefined,
  }
}

/**
 * The subtotal and VAT lines of a printed work order.
 *
 * This document used to print `Total = labor + parts`, which on a SAR 750 job
 * understated what the customer owed by SAR 112.50 and gave them no tax line to
 * reclaim against. Rendered only when the server sent a VAT breakdown: an older
 * response without one still prints a correct, if plainer, document.
 */
function vatRows(w: WorkOrder): string {
  if (!w.vat || w.vat.vatAmount <= 0) return ''
  return `<div class="row"><span>${translatePortalText('Subtotal')}</span><span>${money(w.vat.subtotal)}</span></div>
    <div class="row"><span>${translatePortalText('VAT')} (${formatPortalPercent(w.vat.vatRate)})</span><span>${money(w.vat.vatAmount)}</span></div>`
}

/** Roles a technician can be booked at, with the legacy flat rate as a fallback. */
function technicianRoleOptions(t?: MaintenanceTechnician): { role: string; hourlyRate: number }[] {
  if (!t) return []
  if (t.roles?.length) return t.roles
  return t.role ? t.role.split(' · ').map(r => ({ role: r.trim(), hourlyRate: t.hourlyRate ?? 0 })) : []
}

/** Automatically matches the technician role that corresponds to the customer's chosen service/category */
export function matchTechnicianRole(
  roles: { role: string; hourlyRate: number }[],
  category?: string,
  jobTitle?: string
): { role: string; hourlyRate: number } | undefined {
  if (!roles || roles.length === 0) return undefined
  const cat = (category || '').toLowerCase().trim()
  const title = (jobTitle || '').toLowerCase().trim()

  // 1. Direct equality
  const exact = roles.find(r => r.role.toLowerCase() === cat || r.role.toLowerCase() === title)
  if (exact) return exact

  // 2. Keyword mapping
  const KEYWORD_MAP: Record<string, string[]> = {
    engine: ['mechanic', 'engine', 'propulsion', 'motor', 'diesel', 'generator', 'drive', 'inboard', 'outboard'],
    electrical: ['electrical', 'electronic', 'electrician', 'wiring', 'battery', 'solar', 'power', 'nav', 'radar'],
    hvac: ['hvac', 'ac', 'air', 'cooling', 'climate', 'refrigeration', 'heating', 'ventilation'],
    safety: ['safety', 'inspector', 'inspection', 'fire', 'liferaft', 'flare', 'survey'],
    hull: ['hull', 'fiberglass', 'gelcoat', 'composite', 'deck', 'paint', 'bottom', 'antifoul', 'carpentry'],
    plumbing: ['plumbing', 'plumber', 'pipe', 'water', 'bilge', 'sanitation', 'head', 'pump', 'tank'],
    rigging: ['rigging', 'rigger', 'sail', 'mast', 'spar'],
    navigation: ['electronics', 'navigation', 'radar', 'gps', 'electrical', 'autopilot'],
    nav: ['electronics', 'navigation', 'radar', 'gps', 'electrical', 'autopilot'],
  }

  for (const [key, keywords] of Object.entries(KEYWORD_MAP)) {
    if (cat === key || cat.includes(key) || title.includes(key)) {
      const match = roles.find(r => keywords.some(kw => r.role.toLowerCase().includes(kw)))
      if (match) return match
    }
  }

  for (const [, keywords] of Object.entries(KEYWORD_MAP)) {
    if (keywords.some(kw => title.includes(kw))) {
      const match = roles.find(r => keywords.some(kw => r.role.toLowerCase().includes(kw)))
      if (match) return match
    }
  }

  const fallback = roles.find(r => {
    const rLower = r.role.toLowerCase()
    return cat.length > 2 && (rLower.includes(cat) || cat.includes(rLower))
  })
  if (fallback) return fallback

  return roles[0]
}

// Simplified canonical 6-step flow shown in the UI:
// Approved → Assigned → Inspection → In progress → Quality check → Delivered
// Intermediate backend-only states (en_route, diagnosis, etc.) are
// collapsed — the backend still accepts them, but the portal skips them.
/**
 * Mirrors WORK_ORDER_TRANSITIONS in maintenancePortal.controller.ts exactly —
 * keep the two in step.
 *
 * This used to be a narrower, hand-curated subset, which quietly made six
 * states the API allows unreachable from the portal: a job could not be marked
 * `scheduled`, a mobile technician could never be shown `en_route`, and
 * `diagnosis`, `awaiting_approval` and `waiting_parts` could not be entered at
 * all — even though the customer app has status hints written for every one of
 * them ("Your technician is travelling to the vessel"). Sending a job back from
 * quality check remains a final verification step before completion.
 *
 * The first entry on each row is the usual next step, so the natural progression
 * still reads left to right; the rest are the alternatives the shop is entitled
 * to take.
 */
const NEXT_STATUSES: Record<string, string[]> = {
  approved:          ['scheduled', 'assigned', 'cancelled'],
  scheduled:         ['assigned', 'cancelled'],
  assigned:          ['en_route', 'inspection', 'in_progress', 'cancelled'],
  en_route:          ['inspection', 'in_progress', 'cancelled'],
  inspection:        ['diagnosis', 'in_progress', 'cancelled'],
  diagnosis:         ['awaiting_approval', 'waiting_parts', 'in_progress', 'cancelled'],
  awaiting_approval: ['in_progress', 'cancelled'],
  waiting_parts:     ['in_progress', 'cancelled'],
  in_progress:       ['quality_check', 'completed', 'waiting_parts', 'awaiting_approval', 'cancelled'],
  quality_check:     ['completed', 'cancelled'],
  completed:         ['delivered'],
  delivered:         [],
  cancelled:         [],
}

// ══════════ REQUESTS (§2) ══════════
export function MaintRequests() { return <RequestsPage /> }
function RequestsPage() {
  const TABS = ['All', 'Pending', 'Approved', 'Scheduled', 'In progress', 'Completed'] as const
  const [tab, setTab] = useState<typeof TABS[number]>('All')
  const [q, setQ] = useState('')
  const [requests, setRequests] = useState<MaintRequest[]>([])
  const [requestRecords, setRequestRecords] = useState<MaintenanceProviderRequest[]>([])
  const [customers, setCustomers] = useState<MaintenanceCustomer[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<MaintRequest | null>(null)
  /** Request id whose "propose a new time" modal is open. */
  const [proposeFor, setProposeFor] = useState<string | null>(null)
  const [quoteFor, setQuoteFor] = useState<string | null>(null)
  const [view, setView] = useState<'card' | 'table'>('table')

  const loadRequests = async () => {
    try {
      const result = await maintenancePortalApi.requests({ limit: 100 })
      setRequestRecords(result.data.items)
      setRequests(result.data.items.map(toRequestView))
    } catch (error) {
      maintToast(error instanceof Error ? error.message : 'Could not load maintenance requests', 'warn')
    }
  }

  useEffect(() => {
    void loadRequests()
    maintenancePortalApi.customers().then(result => setCustomers(result.data.customers)).catch(() => undefined)
  }, [])

  // This board is where a new request lands and where an accepted quote turns a
  // speculative job into a scheduled one. It had no refresh of its own at all —
  // the list was whatever was fetched when the page mounted.
  useMaintLive(() => void loadRequests(), ['maint:request:new', 'maint:request:updated', 'maint:workorder:updated'])

  const list = requests.filter(r => (tab === 'All' || r.status === tab) &&
    (q === '' || `${r.boat} ${r.customer} ${r.title} ${r.id}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (b.emergency ? 1 : 0) - (a.emergency ? 1 : 0))

  const setStatus = async (id: string, status: 'approved' | 'declined', msg: string, tone: 'success' | 'info' | 'warn' = 'success') => {
    try {
      await maintenancePortalApi.updateRequest(id, { status })
      await loadRequests()
      maintToast(msg, tone)
    } catch (error) {
      maintToast(error instanceof Error ? error.message : 'Could not update request', 'warn')
    }
  }
  const duplicate = async (r: MaintRequest) => {
    const source = requestRecords.find(request => request.id === r.id)
    const customerId = source?.customer?.id || source?.customer?._id
    if (!source || !customerId) { maintToast('This request no longer has an available customer account', 'warn'); return }
    try {
      await maintenancePortalApi.createManualRequest({ customerId, boatName: source.boatName, boatLengthFt: source.boatLengthFt, category: source.category, title: source.title, description: source.description, priority: source.priority, location: source.location })
      await loadRequests()
      maintToast('A real duplicate request was created', 'info')
    } catch (error) {
      maintToast(error instanceof Error ? error.message : 'Could not duplicate request', 'warn')
    }
  }
  const saveRequest = async (data: MaintRequest, customerId?: string) => {
    try {
      const payload = { boatName: data.boat, boatLengthFt: data.boatLen ? Number.parseFloat(data.boatLen) : undefined, category: data.cat, priority: data.priority.toLowerCase(), title: data.title, description: data.desc, location: data.location }
      if (editing) await maintenancePortalApi.updateRequest(editing.id, payload)
      else {
        if (!customerId) { maintToast('Select a BoatPro customer before creating the request', 'warn'); return }
        await maintenancePortalApi.createManualRequest({ ...payload, customerId })
      }
      await loadRequests()
      setFormOpen(false); setEditing(null)
      maintToast(editing ? 'Maintenance request updated' : 'Maintenance request created')
    } catch (error) {
      maintToast(error instanceof Error ? error.message : 'Could not save request', 'warn')
    }
  }
  const openCreate = () => { setEditing(null); setFormOpen(true) }
  const openEdit = (r: MaintRequest) => { setEditing(r); setFormOpen(true) }

  // Active jobs are a plan limit (`maxActiveJobs`), so a full pipeline offers
  // the add-on rather than a warning toast the operator cannot act on.
  const createWO = useLimitAwareAction(maintenancePortalApi.createWorkOrder)

  const createWorkOrder = async (r: MaintRequest) => {
    try {
      const created = await createWO.run({ requestId: r.id })
      if (!created) return
      await loadRequests()
      maintToast('Work order created')
    } catch (error) {
      maintToast(error instanceof Error ? error.message : 'Could not create work order', 'warn')
    }
  }

  const actions = (r: MaintRequest) => (
    <>
      {r.status === 'Pending' ? (<>
        <button onClick={() => void setStatus(r.id, 'approved', `${r.id} accepted & approved`)} className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-50 text-emerald-600 transition hover:bg-emerald-100" title={translatePortalText("Accept")}><Check size={15} /></button>
        <button onClick={() => void setStatus(r.id, 'declined', `${r.id} rejected`, 'warn')} className="grid h-8 w-8 place-items-center rounded-lg bg-rose-50 text-rose-600 transition hover:bg-rose-100" title={translatePortalText("Reject")}><X size={15} /></button>
      </>) : (<>
        <button onClick={() => openEdit(r)} className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-slate-500 transition hover:bg-slate-200" title={translatePortalText("Edit")}><Pencil size={14} /></button>
        {/* Ask the owner to move it, rather than rewriting `preferredDate`
            through Edit above — which moves a time they agreed to without
            asking. Only offered past Pending: a request still being accepted
            has no agreed time to move. */}
        {!['Cancelled', 'Completed'].includes(r.status) && <button
          onClick={() => setProposeFor(r.id)}
          className="grid h-8 w-8 place-items-center rounded-lg bg-amber-50 text-amber-600 transition hover:bg-amber-100"
          title={translatePortalText("Propose a new time")}
        ><CalendarClock size={14} /></button>}
      </>)}
      {/* The price the customer says yes to. Open while they can still answer
          it — before the job is scheduled — and closed once they decline. */}
      {['Pending', 'Approved'].includes(r.status) && r.quoteResponse !== 'declined' && (
        <button onClick={() => setQuoteFor(r.id)} className="grid h-8 w-8 place-items-center rounded-lg bg-violet-50 text-violet-600 transition hover:bg-violet-100" title={translatePortalText(r.est != null ? 'Revise quote' : 'Send quote')}><Receipt size={14} /></button>
      )}
      <button onClick={() => void duplicate(r)} className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-slate-500 transition hover:bg-slate-200" title={translatePortalText("Duplicate")}><Copy size={14} /></button>
      {/* A closed request cannot be given a work order — the server refuses it. */}
      {!['Cancelled', 'Completed'].includes(r.status) && !requestRecords.find(request => request.id === r.id)?.workOrder && <button onClick={() => void createWorkOrder(r)} className="btn-maint !py-1.5 !px-2.5 !text-[11px]">{translatePortalText("Work order")} <ArrowRight size={12} className="rtl:rotate-180" /></button>}
    </>
  )

  /**
   * The modal, mounted once rather than per row.
   *
   * One instance keyed off `proposeFor` — a modal inside `actions()` would be
   * constructed for every request in the list, and each would fetch the shop's
   * settings on open.
   */
  const proposeRecord = proposeFor ? requestRecords.find(x => x.id === proposeFor) : null
  const proposeModal = proposeRecord ? (
    <ProposeRescheduleModal
      open
      onClose={() => setProposeFor(null)}
      requestId={proposeRecord.id}
      jobLabel={`${proposeRecord.boatName} — ${localizedField(proposeRecord, 'title') ?? proposeRecord.title}`}
      currentWhen={
        proposeRecord.preferredDate
          ? `${formatPortalDate(proposeRecord.preferredDate)}${proposeRecord.preferredSlot ? ` · ${proposeRecord.preferredSlot}` : ''}`
          : undefined
      }
      onDone={() => void loadRequests()}
    />
  ) : null

  return (
    <PageWrap>
      <MaintHeader title={translatePortalText("Maintenance Requests")} sub="Receive, review, approve & assign incoming service requests" icon={<ClipboardList className="text-violet-500" />}
        actions={<>
          <MaintViewToggle view={view} onChange={setView} />
          <button className="btn-maint" onClick={openCreate}><Plus size={15} /> {translatePortalText("Create request")}</button>
        </>} />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1.5 rounded-2xl bg-white p-1.5 shadow-soft">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`relative rounded-xl px-3.5 py-2 text-[13px] font-bold transition ${tab === t ? 'text-white' : 'text-slate-500 hover:text-deep-900'}`}>
              {tab === t && <motion.span layoutId="req-tab" className="absolute inset-0 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-500" />}
              <span className="relative z-10">{translatePortalText(t)}</span>
            </button>
          ))}
        </div>
        <div className="relative ms-auto">
          <span className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={translatePortalText("Search boat, customer, order…")} className="input ps-9 md:w-72" />
        </div>
      </div>

      {view === 'card' ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((r, i) => {
            const c = catByKey(r.cat)
            return (
              <motion.div key={r.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                className={`card card-hover overflow-hidden ${r.emergency ? 'ring-2 ring-rose-300' : ''}`}>
                {r.emergency && <div className="flex items-center gap-2 bg-gradient-to-r from-rose-600 to-rose-400 px-4 py-1.5 text-[11px] font-extrabold uppercase tracking-wide text-white"><span className="animate-wrench">🚨</span> {translatePortalText("Emergency request")}</div>}
                <div className="p-4">
                  <div className="flex items-center gap-3">
                    <img src={r.avatar} className="h-11 w-11 rounded-full object-cover ring-2 ring-white shadow-soft" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-display text-[15px] font-extrabold text-deep-900">{r.boat} <span className="text-xs font-semibold text-slate-400">{r.boatLen}</span></p>
                      <p className="truncate text-xs text-slate-400">{r.customer} · {r.ref ?? r.id}</p>
                    </div>
                    <MBadge>{r.priority}</MBadge>
                  </div>
                  <div className="mt-3 rounded-xl bg-sand p-3">
                    <p className="flex items-center gap-2 text-[13px] font-extrabold text-deep-900"><span style={{ color: c.color }}>{c.icon}</span> {r.title}</p>
                    <p className="mt-1 text-xs text-slate-500 line-clamp-2">{r.desc}</p>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
                    <span title={r.booked ? `${translatePortalText('Requested')} ${r.requested}` : undefined}>📅 {r.booked ? `${translatePortalText('Booked for')} ` : ''}{r.date} · {r.time}</span><span>📍 {r.location}</span>
                    <span>📷 {r.photos}</span><span>{translatePortalText("via")} {r.source}</span>
                  </div>
                  <QuoteLine r={r} />
                  {/* The shop's own outstanding ask. Without this, proposing is
                      write-only: there is no way to tell you already asked, and
                      no way to take it back. */}
                  <AwaitingRescheduleReply
                    proposal={requestRecords.find(x => x.id === r.id)?.rescheduleProposal}
                    requestId={r.id}
                    onDone={() => void loadRequests()}
                  />
                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
                    <MBadge dot={['Pending', 'In progress'].includes(r.status)}>{r.status}</MBadge>
                    <div className="flex gap-1.5">{actions(r)}</div>
                  </div>
                </div>
              </motion.div>
            )
          })}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto custom-scrollbar">
            <div className="min-w-[1000px]">
              <div className="grid grid-cols-[240px_200px_110px_130px_160px_160px] items-center gap-4 border-b border-slate-100 bg-sand px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <span>{translatePortalText("Boat / customer")}</span><span>{translatePortalText("Title / category")}</span><span>{translatePortalText("Priority")}</span><span>{translatePortalText("Status")}</span><span>{translatePortalText("Date / location")}</span><span className="text-right">{translatePortalText("Actions")}</span>
              </div>
              {list.map((r, i) => {
                const c = catByKey(r.cat)
                return (
                  <motion.div key={r.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                    className={`grid grid-cols-[240px_200px_110px_130px_160px_160px] items-center gap-4 border-b border-slate-50 px-5 py-3.5 transition hover:bg-sand/70 ${r.emergency ? 'border-l-4 border-l-rose-500' : ''}`}>
                    <div className="flex items-center gap-3 min-w-0">
                      <img src={r.avatar} className="h-9 w-9 shrink-0 rounded-full object-cover ring-2 ring-white shadow-soft" />
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-extrabold text-deep-900">{r.emergency && <span title={translatePortalText("Emergency")}>🚨 </span>}{r.boat} <span className="text-[11px] font-semibold text-slate-400">{r.boatLen}</span></p>
                        <p className="truncate text-[11px] text-slate-400">{r.customer} · {r.ref ?? r.id}</p>
                      </div>
                    </div>
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 truncate text-[13px] font-bold text-deep-900"><span style={{ color: c.color }}>{c.icon}</span> {r.title}</p>
                      <p className="truncate text-[11px] text-slate-400">{translatePortalText(c.name)}</p>
                    </div>
                    <div className="whitespace-nowrap"><MBadge>{r.priority}</MBadge></div>
                    <div className="whitespace-nowrap"><MBadge dot={['Pending', 'In progress'].includes(r.status)}>{r.status}</MBadge><QuoteLine r={r} compact /></div>
                    <div className="truncate text-[11px] text-slate-500" title={r.booked ? `${translatePortalText('Requested')} ${r.requested}` : undefined}>📅 {r.booked ? `${translatePortalText('Booked for')} ` : ''}{r.date} · {r.time}<br />📍 {r.location}</div>
                    <div className="flex justify-end gap-1.5 whitespace-nowrap">{actions(r)}</div>
                  </motion.div>
                )
              })}
              {list.length === 0 && <p className="p-8 text-center text-sm text-slate-400">{translatePortalText("No requests match your filter.")}</p>}
            </div>
          </div>
        </div>
      )}

      <RequestFormModal open={formOpen} onClose={() => { setFormOpen(false); setEditing(null) }} onSave={saveRequest} editing={editing} customers={customers} />
      {proposeModal}
      <QuoteModal
        record={quoteFor ? requestRecords.find(x => x.id === quoteFor) ?? null : null}
        onClose={() => setQuoteFor(null)}
        onSent={() => void loadRequests()}
      />
      {createWO.modal}
    </PageWrap>
  )
}

/** Where the quote stands, in a line: the figure and whether the customer has answered it. */
function QuoteLine({ r, compact }: { r: MaintRequest; compact?: boolean }) {
  if (r.est == null) return null
  const [label, tone] =
    r.quoteResponse === 'accepted' ? ['Quote accepted', 'text-emerald-600']
      : r.quoteResponse === 'declined' ? ['Quote declined', 'text-rose-600']
        : ['Awaiting customer', 'text-amber-600']
  return (
    <p className={`${compact ? 'mt-1 text-[10px]' : 'mt-2 text-[11px]'} flex items-center gap-1.5 font-bold`}>
      <Receipt size={compact ? 11 : 12} className="text-violet-500" />
      <span className="text-deep-900">{money(r.est)}</span>
      <span className={tone}>· {translatePortalText(label)}</span>
    </p>
  )
}

/**
 * The workshop's price for a request, sent to the customer to accept or decline
 * in the app. Sending one on a pending request accepts the request with it.
 * Revising an accepted quote asks the customer to approve the new figure.
 */
function QuoteModal({ record, onClose, onSent }: { record: MaintenanceProviderRequest | null; onClose: () => void; onSent: () => void }) {
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!record) return
    setAmount(record.quotedAmount != null ? String(record.quotedAmount) : '')
    setNotes(record.quoteNotes ?? '')
  }, [record?.id])
  if (!record) return null
  const revising = record.quotedAmount != null
  const wasAccepted = record.customerQuoteResponse === 'accepted'

  const send = async () => {
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) { maintToast('Enter the quote amount', 'warn'); return }
    setBusy(true)
    try {
      await maintenancePortalApi.updateRequest(record.id, {
        quotedAmount: Math.round(value * 100) / 100,
        quoteNotes: notes.trim() || undefined,
        // The customer can only answer a quote on an accepted request.
        ...(record.status === 'pending' ? { status: 'approved' } : {}),
      })
      maintToast(revising ? 'Revised quote sent — the customer is asked to approve it again' : 'Quote sent — the customer accepts or declines it in the app')
      onSent()
      onClose()
    } catch (error) {
      maintToast(error instanceof Error ? error.message : 'Could not send the quote', 'warn')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={translatePortalText(revising ? 'Revise quote' : 'Send quote')}>
      <p className="mb-4 text-sm text-slate-500">{record.boatName} — {String(localizedField(record, 'title') ?? record.title)}</p>
      <label className="label">{translatePortalText('Quote amount (SAR, before VAT)')}</label>
      <input className="input" type="number" min={0} step="0.01" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" autoFocus />
      <label className="label mt-4">{translatePortalText("What's included")}</label>
      <textarea className="input" rows={3} maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)} placeholder={translatePortalText('e.g. Labour 6 h, impeller and thermostat, sea trial')} />
      {wasAccepted && (
        <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-700">
          {translatePortalText('The customer already accepted the current quote. Changing it asks them to approve the new figure before work continues.')}
        </p>
      )}
      <p className="mt-3 text-xs text-slate-400">{translatePortalText('VAT is added on the final invoice. The customer accepts or declines the quote in the BoatPro app.')}</p>
      <div className="mt-6 flex justify-end gap-2">
        <button onClick={onClose} className="btn-ghost">{translatePortalText('Cancel')}</button>
        <button onClick={() => void send()} disabled={busy} className="btn-maint">{translatePortalText(revising ? 'Send revised quote' : 'Send quote')}</button>
      </div>
    </Modal>
  )
}

function RequestFormModal({ open, onClose, onSave, editing, customers: known }: { open: boolean; onClose: () => void; onSave: (r: MaintRequest, customerId?: string) => void; editing: MaintRequest | null; customers: MaintenanceCustomer[] }) {
  const blank = { customerId: '', customer: '', boat: '', boatLen: '', cat: 'engine', priority: 'Medium' as MaintRequest['priority'], title: '', desc: '', emergency: false }
  const [f, setF] = useState(blank)
  /*
    The list holds this shop's own customers only — the platform no longer hands
    every account's contact details to every workshop. Someone new is found by
    the exact email or phone they give the desk.
  */
  const [lookup, setLookup] = useState('')
  const [found, setFound] = useState<MaintenanceCustomer[]>([])
  const customers = [...known, ...found.filter(c => !known.some(k => k.id === c.id))]
  const findCustomer = async () => {
    const q = lookup.trim()
    if (!q) return
    try {
      const res = await maintenancePortalApi.customers({ search: q })
      const hits = res.data.customers
      if (!hits.length) { maintToast('No BoatPro account with that exact email or phone', 'warn'); return }
      setFound(prev => [...prev, ...hits.filter(h => !prev.some(p => p.id === h.id))])
      setF(s => ({ ...s, customerId: hits[0].id }))
    } catch (error) {
      maintToast(error instanceof Error ? error.message : 'Could not look that up', 'warn')
    }
  }
  React.useEffect(() => {
    if (open) setF(editing ? { customerId: '', customer: editing.customer, boat: editing.boat, boatLen: editing.boatLen, cat: editing.cat, priority: editing.priority, title: editing.sourceTitle ?? editing.title, desc: editing.sourceDesc ?? editing.desc, emergency: !!editing.emergency } : blank)
  }, [open, editing])
  const set = (k: keyof typeof f) => (v: any) => setF(s => ({ ...s, [k]: v }))
  const submit = () => {
    if ((!editing && !f.customerId) || !f.boat.trim() || !f.title.trim()) { maintToast('Select a customer, boat and issue title', 'warn'); return }
    const customer = customers.find(item => item.id === f.customerId)
    const base: MaintRequest = editing ?? {
      id: '', customer: customer?.name || '', avatar: customer?.avatar || '', boat: '', boatType: '', boatLen: '',
      cat: 'engine', title: '', desc: '', date: '', time: '', priority: 'Medium', status: 'Pending', photos: 0, source: 'BoatPro', location: '',
    }
    onSave({ ...base, customer: customer?.name || base.customer, boat: f.boat, boatLen: f.boatLen || base.boatLen, cat: f.cat, priority: f.emergency ? 'Critical' : f.priority, title: f.title, desc: f.desc, emergency: f.emergency }, f.customerId || undefined)
  }
  return (
    <Modal open={open} onClose={onClose} title={editing ? `✏️ Edit ${editing.id}` : translatePortalText("🔧 Create maintenance request")} wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="label">{translatePortalText("Customer")}</label><select className="input" value={f.customerId} onChange={e => set('customerId')(e.target.value)} disabled={!!editing}><option value="">{translatePortalText("Select a BoatPro customer")}</option>{editing && <option value="">{editing.customer}</option>}{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name} · {customer.email}</option>)}</select>
          {!editing && (
            <div className="mt-2 flex gap-2">
              <input className="input" value={lookup} onChange={e => setLookup(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void findCustomer() } }} placeholder={translatePortalText('New customer? Exact email or phone')} />
              <button type="button" onClick={() => void findCustomer()} className="btn-ghost whitespace-nowrap">{translatePortalText('Find')}</button>
            </div>
          )}
        </div>
        <div><label className="label">{translatePortalText("Boat")}</label><input className="input" value={f.boat} onChange={e => set('boat')(e.target.value)} placeholder={translatePortalText("Boat name")} /></div>
        <div><label className="label">{translatePortalText("Boat length")}</label><input className="input" value={f.boatLen} onChange={e => set('boatLen')(e.target.value)} placeholder={translatePortalText("e.g. 42 ft")} /></div>
        <div><label className="label">{translatePortalText("Service category")}</label>
          <select className="input" value={f.cat} onChange={e => set('cat')(e.target.value)}>{CAT_NAMES.map(c => <option key={c.key} value={c.key}>{c.name}</option>)}</select></div>
        <div><label className="label">{translatePortalText("Priority")}</label><select className="input" value={f.priority} onChange={e => set('priority')(e.target.value)}>{['Low', 'Medium', 'High', 'Critical'].map(p => <option key={p} value={p}>{translatePortalText(p)}</option>)}</select></div>
        <div className="sm:col-span-2"><label className="label">{translatePortalText("Issue title")}</label><input className="input" value={f.title} onChange={e => set('title')(e.target.value)} placeholder={translatePortalText("e.g. Port engine overheating")} /></div>
        <div className="sm:col-span-2"><label className="label">{translatePortalText("Description / customer notes")}</label><textarea className="input" rows={3} value={f.desc} onChange={e => set('desc')(e.target.value)} placeholder={translatePortalText("Describe the fault, symptoms, and any deadlines…")} /></div>
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-500"><input type="checkbox" className="h-4 w-4 rounded accent-violet-500" checked={f.emergency} onChange={e => set('emergency')(e.target.checked)} /> {translatePortalText("Mark as emergency")}</label>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button onClick={onClose} className="btn-ghost">{translatePortalText("Cancel")}</button>
        <button onClick={submit} className="btn-maint">{editing ? translatePortalText("Save changes") : translatePortalText("Create request")}</button>
      </div>
    </Modal>
  )
}

// ══════════ WORK ORDERS (§3, §4) ══════════
// Raw backend status order (matches MAINTENANCE_WORK_ORDER_STATUSES) — used
// instead of comparing displayStatus() strings, since displayStatus()
// title-cases every word ("In Progress") while the old hardcoded display-string
// flow array only capitalized the first ("In progress"), silently breaking the
// "done" comparison for every multi-word status (en_route, awaiting_approval,
// waiting_parts, in_progress, quality_check).
const WO_FLOW_KEYS = ['approved', 'scheduled', 'assigned', 'en_route', 'inspection', 'diagnosis', 'awaiting_approval', 'waiting_parts', 'in_progress', 'quality_check', 'completed', 'delivered']
export function MaintWorkOrders() { return <WorkOrdersPage /> }
function WorkOrdersPage() {
  const { maintAccess } = useAuth()
  // Only the owner/admin see the full board and can create/reassign jobs —
  // there's no dispatcher upgrade tier. A technician-worker always sees only
  // their own assigned jobs (the backend already scopes the list) and can
  // just move them through the status flow.
  const hasFullBoard = maintAccess ? maintAccess.isOwner : true
  const [orders, setOrders] = useState<WorkOrder[]>([])
  const [technicians, setTechnicians] = useState<MaintenanceTechnician[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [view, setView] = useState<'card' | 'table'>('table')
  const [newOpen, setNewOpen] = useState(false)
  const [reassignFor, setReassignFor] = useState<string | null>(null)
  // Separate from reassignFor: opened by the "Assigned" advance button on an
  // unassigned job, where picking a technician both sets it and moves the
  // status forward in one request (assigning someone IS what "Assigned" means).
  const [assignFor, setAssignFor] = useState<string | null>(null)
  const order = orders.find(w => w.id === sel)
  const reassignOrder = orders.find(w => w.id === reassignFor)
  const assignOrder = orders.find(w => w.id === assignFor)

  const loadOrders = async () => {
    // Fetched independently: a self-service technician without the
    // 'technicians' page can still load their own work orders even though
    // the technician-picker list isn't available to them.
    const [ordersResult, techniciansResult] = await Promise.allSettled([
      maintenancePortalApi.workOrders({ limit: 100 }),
      maintenancePortalApi.technicians(),
    ])
    if (ordersResult.status === 'fulfilled') setOrders(ordersResult.value.data.items.map(toWorkOrderView))
    else maintToast(ordersResult.reason instanceof Error ? ordersResult.reason.message : 'Could not load work orders', 'warn')
    if (techniciansResult.status === 'fulfilled') setTechnicians(techniciansResult.value.data.technicians)
  }

  useEffect(() => { void loadOrders() }, [])

  const togglePause = async (w: WorkOrder) => {
    try {
      await maintenancePortalApi.updateWorkOrder(w.id, { paused: !w.paused })
      await loadOrders()
      maintToast(w.paused ? `${w.code ?? w.id} resumed` : `${w.code ?? w.id} paused`, 'info')
    } catch (error) {
      maintToast(error instanceof Error ? error.message : 'Could not update work order', 'warn')
    }
  }
  const printWO = (w: WorkOrder) => printDoc(`${translatePortalText('Work Order')} ${w.code ?? w.id}`, `
    <h1>${translatePortalText('Work Order')} ${w.code ?? w.id}</h1><p class="sub">${w.boat} · ${w.customer}</p>
    <div class="row"><span>${translatePortalText('Job')}</span><span>${w.title}</span></div>
    <div class="row"><span>${translatePortalText('Technician')}</span><span>${w.tech}${w.team ? ` · ${w.team}` : ''}</span></div>
    <div class="row"><span>${translatePortalText('Status')}</span><span>${translatePortalText(w.status)}</span></div>
    <div class="row"><span>${translatePortalText('Priority')}</span><span>${translatePortalText(w.priority)}</span></div>
    <div class="row"><span>${translatePortalText('Created / due')}</span><span>${w.created} → ${w.due === 'Not scheduled' ? translatePortalText(w.due) : w.due}</span></div>
    <div class="row"><span>${translatePortalText('Hours')}</span><span>${formatPortalNumber(w.hours)}${translatePortalText('h')}${w.estHours > 0 ? ` / ${formatPortalNumber(w.estHours)}${translatePortalText('h')} ${translatePortalText('est')}` : ''}</span></div>
    ${(w.assignments ?? []).length > 0 ? (w.assignments ?? []).map(a => `<div class="row"><span>${localizedField(a, 'role') ?? translatePortalText(a.role)}</span><span>${formatPortalNumber(a.hours)}${translatePortalText('h')} × ${formatPortalNumber(a.hourlyRate)} = ${formatPortalNumber(Math.round(a.hours * a.hourlyRate * 100) / 100)}</span></div>`).join('') : ''}
    <div class="row"><span>${translatePortalText('Labor')}</span><span>${money(w.labor)}${w.hourlyRate ? ` (${formatPortalNumber(w.hours)}${translatePortalText('h')} × ${formatPortalNumber(w.hourlyRate)}${w.bookedRole ? ` · ${w.bookedRole}` : ''})` : ''}</span></div>
    <div class="row"><span>${translatePortalText('Parts')}</span><span>${money(w.parts)}</span></div>
    ${vatRows(w)}
    <div class="row tot"><span>${translatePortalText('Total')}</span><span>${money(w.vat?.total ?? w.labor + w.parts)}</span></div>`)
  const reassign = async (techId: string, bookedRole?: string) => {
    const technician = technicians.find(item => item.id === techId); if (!technician || !reassignFor) return
    const target = orders.find(o => o.id === reassignFor)
    try {
      await maintenancePortalApi.updateWorkOrder(reassignFor, { technicianId: techId, ...(bookedRole ? { bookedRole } : {}) })
      await loadOrders()
      maintToast(`${target?.code ?? reassignFor} reassigned to ${technician.name}`, 'info'); setReassignFor(null)
    } catch (error) {
      maintToast(error instanceof Error ? error.message : 'Could not reassign work order', 'warn')
    }
  }
  const assignAndAdvance = async (techId: string, bookedRole?: string) => {
    const technician = technicians.find(item => item.id === techId); if (!technician || !assignFor) return
    const target = orders.find(o => o.id === assignFor)
    try {
      await maintenancePortalApi.updateWorkOrder(assignFor, { technicianId: techId, status: 'assigned', ...(bookedRole ? { bookedRole } : {}) })
      await loadOrders()
      maintToast(`${target?.code ?? assignFor} assigned to ${technician.name}`, 'info'); setAssignFor(null)
    } catch (error) {
      maintToast(error instanceof Error ? error.message : 'Could not assign technician', 'warn')
    }
  }
  const advanceStatus = async (w: WorkOrder, next: string, extraData?: { workedHours?: number; progress?: number }) => {
    try {
      await maintenancePortalApi.updateWorkOrder(w.id, { status: next, ...extraData })
      await loadOrders()
      maintToast(`${w.code ?? w.id} moved to ${displayStatus(next)}`)
    } catch (error) {
      maintToast(error instanceof Error ? error.message : 'Could not update status', 'warn')
    }
  }
  const updateProgress = async (
    w: WorkOrder,
    data: {
      progress?: number
      workedHours?: number
      assignments?: { technicianId: string; role: string; hours: number }[]
    }
  ) => {
    try {
      await maintenancePortalApi.updateWorkOrder(w.id, data)
      await loadOrders()
      maintToast('Progress updated')
    } catch (error) {
      maintToast(error instanceof Error ? error.message : 'Could not update progress', 'warn')
    }
  }
  const updateParts = async (w: WorkOrder, partsCost: number) => {
    try {
      await maintenancePortalApi.updateWorkOrder(w.id, { partsCost })
      await loadOrders()
      maintToast('Parts cost updated')
    } catch (error) {
      maintToast(error instanceof Error ? error.message : 'Could not update parts cost', 'warn')
    }
  }
  const createWO = useLimitAwareAction(maintenancePortalApi.createWorkOrder)

  const addOrder = async (body: Record<string, unknown>) => {
    try {
      const created = await createWO.run(body)
      // Refused: the add-on modal has taken over, and closing the form here
      // would throw away everything the operator just typed.
      if (!created) return
      await loadOrders(); setNewOpen(false); maintToast('Work order created')
    } catch (error) {
      maintToast(error instanceof Error ? error.message : 'Could not create work order', 'warn')
    }
  }

  const rowActions = (w: WorkOrder) => (
    <>
      <button onClick={() => setSel(w.id)} className="btn-ghost !py-1.5 !px-2.5 !text-[11px]">{translatePortalText("Open")}</button>
      <button onClick={() => void togglePause(w)} className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-slate-500 transition hover:bg-slate-200" title={w.paused ? translatePortalText("Resume") : translatePortalText("Pause")}>{w.paused ? <Play size={13} /> : <Pause size={13} />}</button>
      <button onClick={() => printWO(w)} className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-slate-500 transition hover:bg-slate-200" title={translatePortalText("Print")}><Printer size={13} /></button>
    </>
  )

  return (
    <PageWrap>
      <MaintHeader
        title={hasFullBoard ? 'Work Orders' : 'My Jobs'}
        sub={hasFullBoard ? 'Generate, assign, track and complete jobs through the full status flow' : 'Update the status of jobs assigned to you'}
        icon={<Wrench className="text-violet-500" />}
        actions={<>
          <MaintViewToggle view={view} onChange={setView} />
          {hasFullBoard && <button className="btn-maint" onClick={() => setNewOpen(true)}><Plus size={15} /> {translatePortalText("New work order")}</button>}
        </>} />

      {view === 'table' ? (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto custom-scrollbar">
            <div className="min-w-[1070px]">
              <div className="grid grid-cols-[240px_170px_180px_120px_110px_120px_130px] items-center gap-4 border-b border-slate-100 bg-sand px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <span>{translatePortalText("Work order")}</span>
                <span>{translatePortalText("Technician")}</span>
                <span>{translatePortalText("Schedule / Time")}</span>
                <span>{translatePortalText("Status")}</span>
                <span>{translatePortalText("Priority")}</span>
                <span>{translatePortalText("Progress")}</span>
                <span className="text-right">{translatePortalText("Actions")}</span>
              </div>
              {orders.map((w, i) => {
                const c = catByKey(w.cat)
                return (
                  <motion.div key={w.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                    className="grid grid-cols-[240px_170px_180px_120px_110px_120px_130px] items-center gap-4 border-b border-slate-50 px-5 py-3.5 transition hover:bg-sand/70">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-base" style={{ background: `${c.color}1a` }}>{c.icon}</span>
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-extrabold text-deep-900">{w.code ?? w.id} · {w.boat}</p>
                        <p className="truncate text-[11px] text-slate-400">{w.title}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 min-w-0">
                      <img src={w.techAvatar} className="h-7 w-7 shrink-0 rounded-full object-cover ring-1 ring-slate-200" />
                      <span className="truncate text-xs font-semibold text-slate-600">{w.tech}</span>
                    </div>
                    {/* Schedule / Time Column */}
                    <div className="min-w-0 whitespace-nowrap">
                      {w.date || w.time ? (
                        <div className="flex flex-col">
                          <span className="flex items-center gap-1.5 text-xs font-extrabold text-deep-900">
                            <CalendarDays size={13} className="text-violet-600 shrink-0" />
                            {w.date || translatePortalText("Today")}
                          </span>
                          {w.time && (
                            <span className="flex items-center gap-1 text-[11px] font-bold text-violet-700 mt-0.5">
                              <Clock size={11} className="text-violet-500 shrink-0" />
                              {w.time}
                            </span>
                          )}
                        </div>
                      ) : w.due !== 'Not scheduled' ? (
                        <span className="text-xs font-semibold text-slate-600">{translatePortalText("Due")} {w.due}</span>
                      ) : (
                        <span className="inline-block rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-400">
                          {translatePortalText("Unscheduled")}
                        </span>
                      )}
                    </div>
                    <div className="whitespace-nowrap"><MBadge dot={['In progress', 'En route', 'Diagnosis'].includes(w.status)}>{w.paused && !['Cancelled', 'Completed', 'Delivered'].includes(w.status) ? translatePortalText("Paused") : w.status}</MBadge></div>
                    <div className="whitespace-nowrap"><MBadge>{w.priority}</MBadge></div>
                    <div className="flex items-center gap-2 min-w-0"><JobProgress pct={w.progress} /><span className="text-[10px] font-bold text-slate-400 shrink-0">{formatPortalPercent(w.progress)}</span></div>
                    <div className="flex justify-end gap-1.5 whitespace-nowrap">{rowActions(w)}</div>
                  </motion.div>
                )
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {orders.map((w, i) => {
            const c = catByKey(w.cat)
            return (
              <motion.div key={w.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                className="card card-hover p-4">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-lg" style={{ background: `${c.color}1a` }}>{c.icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-[14px] font-extrabold text-deep-900">{w.code ?? w.id} · {w.boat}</p>
                    <p className="truncate text-xs text-slate-400">{w.title}</p>
                  </div>
                  <MBadge>{w.priority}</MBadge>
                </div>
                {/* Schedule & Time Banner in Cards view */}
                <div className="mt-2.5 flex items-center justify-between rounded-xl bg-violet-50/50 px-2.5 py-1.5 border border-violet-100/60 text-xs">
                  <div className="flex items-center gap-1.5 font-bold text-deep-900">
                    <CalendarDays size={13} className="text-violet-600 shrink-0" />
                    <span>{w.date ? w.date : w.due !== 'Not scheduled' ? <>{translatePortalText("Due")} {w.due}</> : translatePortalText("Unscheduled")}</span>
                  </div>
                  {w.time && (
                    <span className="flex items-center gap-1 font-bold text-violet-700 bg-white px-2 py-0.5 rounded-lg shadow-2xs border border-violet-200/60 text-[11px]">
                      <Clock size={11} className="text-violet-500" />
                      {w.time}
                    </span>
                  )}
                </div>
                <div className="mt-2.5 flex items-center gap-2 rounded-xl bg-sand p-2.5">
                  <img src={w.techAvatar} className="h-7 w-7 rounded-full object-cover" />
                  <span className="truncate text-xs font-semibold text-slate-600">{w.tech}</span>
                  <span className="ms-auto"><MBadge dot={['In progress', 'En route', 'Diagnosis'].includes(w.status)}>{w.paused && !['Cancelled', 'Completed', 'Delivered'].includes(w.status) ? translatePortalText("Paused") : w.status}</MBadge></span>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <JobProgress pct={w.progress} /><span className="text-[10px] font-bold text-slate-400">{formatPortalPercent(w.progress)}</span>
                </div>
                <div className="mt-3 flex items-center justify-end gap-1.5 border-t border-slate-100 pt-3">{rowActions(w)}</div>
              </motion.div>
            )
          })}
        </div>
      )}

      <Modal open={!!order} onClose={() => setSel(null)} title={order ? `${order.code ?? order.id} · ${order.boat}` : ''} wide>
        {order && (
          <WorkOrderDetail
            key={order.id}
            order={order}
            onReassign={hasFullBoard ? () => setReassignFor(order.id) : undefined}
            onAssign={hasFullBoard ? () => setAssignFor(order.id) : undefined}
            onPrint={() => printWO(order)}
            onAdvance={(next, extraData) => void advanceStatus(order, next, extraData)}
            onUpdateProgress={(data) => void updateProgress(order, data)}
            technicians={technicians}
            onUpdateParts={hasFullBoard ? (parts) => void updateParts(order, parts) : undefined}
          />
        )}
      </Modal>

      {/* Reassign: change who's on an already-assigned job, status unchanged. */}
      <TechPickerModal open={!!reassignFor} onClose={() => setReassignFor(null)} onPick={reassign} currentTech={reassignOrder?.tech} title={`${translatePortalText("Reassign")} ${reassignOrder?.code ?? reassignFor ?? ''}`} technicians={technicians} />

      {/* Assign: picking a technician here also moves the job into "Assigned". */}
      <TechPickerModal open={!!assignFor} onClose={() => setAssignFor(null)} onPick={assignAndAdvance} title={`${translatePortalText("Assign a technician")} — ${assignOrder?.code ?? assignFor ?? ''}`} technicians={technicians} />

      <WorkOrderFormModal open={newOpen} onClose={() => setNewOpen(false)} onSave={addOrder} technicians={technicians} />
      {createWO.modal}
    </PageWrap>
  )
}

const CANONICAL_STEPS = [
  { key: 'approved', label: 'Approved' },
  { key: 'assigned', label: 'Assigned' },
  { key: 'inspection', label: 'Inspection' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'quality_check', label: 'Quality check' },
  { key: 'delivered', label: 'Delivered' },
] as const

function getStepStage(statusKey?: string, status?: string): number {
  const sk = (statusKey || '').toLowerCase()
  const s = (status || '').toLowerCase()
  if (sk === 'delivered' || s === 'delivered') return 5
  if (sk === 'completed' || s === 'completed' || sk === 'quality_check' || s === 'quality check') return 4
  if (sk === 'in_progress' || s === 'in progress' || sk === 'awaiting_approval' || sk === 'waiting_parts') return 3
  if (sk === 'inspection' || s === 'inspection' || sk === 'diagnosis') return 2
  if (sk === 'assigned' || s === 'assigned' || sk === 'en_route') return 1
  if (sk === 'approved' || s === 'approved' || sk === 'scheduled') return 0
  return -1
}

function WorkOrderDetail({
  order, onReassign, onAssign, onPrint, onAdvance, onUpdateProgress, onUpdateParts, technicians,
}: {
  order: WorkOrder
  onReassign?: () => void
  /** Opens a technician picker that assigns + advances to "Assigned" together. */
  onAssign?: () => void
  onPrint: () => void
  onAdvance: (status: string, extraData?: { workedHours?: number; progress?: number }) => void
  onUpdateProgress: (data: {
    progress?: number
    workedHours?: number
    assignments?: { technicianId: string; role: string; hours: number }[]
  }) => void
  /** The whole roster: a job can be staffed by more than one person, so the
   * editor picks both who and which of their trades. */
  technicians: MaintenanceTechnician[]
  /** Owner-only — technicians log hours, they don't price parts. */
  onUpdateParts?: (partsCost: number) => void
}) {
  const c = catByKey(order.cat)
  const currentStepIdx = getStepStage(order.statusKey, order.status)
  const isDelivered = order.status === 'Delivered' || order.statusKey === 'delivered'
  const isDone = ['Completed', 'Delivered', 'Cancelled'].includes(order.status) || ['completed', 'delivered', 'cancelled'].includes(order.statusKey ?? '')
  const nextOptions = (NEXT_STATUSES[order.statusKey ?? ''] ?? []).filter(s => s !== 'cancelled')
  const canCancel = !isDone && (NEXT_STATUSES[order.statusKey ?? ''] ?? []).includes('cancelled')
  const hasNextSteps = nextOptions.length > 0 || canCancel

  const [progressDraft, setProgressDraft] = useState(order.progress)
  const [hoursDraft, setHoursDraft] = useState(order.hours)

  /**
   * Who worked which trade, for how long.
   *
   * A single "Hours" box could only bill one rate for one person, so a job
   * needing a 180/hr electrician *and* a 240/hr hydraulics specialist — possibly
   * two different people — was billed entirely at whichever role it happened to
   * be booked at. The rates are deliberately not editable here: each comes from
   * that technician's own rate card, so the price of an hour is decided in one
   * place.
   */
  const [lineDraft, setLineDraft] = useState<{ technicianId: string; role: string; hours: number }[]>(
    () => (order.assignments ?? []).map(a => ({ technicianId: a.technician, role: a.role, hours: a.hours }))
  )
  const byRole = lineDraft.length > 0
  const techById = (id: string) => technicians.find(t => (t.id || (t as any)._id) === id)
  const rolesOf = (id: string) => technicianRoleOptions(techById(id))
  const rateOf = (id: string, role: string) => rolesOf(id).find(r => r.role === role)?.hourlyRate ?? 0
  const lineTotal = (line: { technicianId: string; role: string; hours: number }) =>
    Math.round(line.hours * rateOf(line.technicianId, line.role) * 100) / 100
  const draftLineHours = Math.round(lineDraft.reduce((sum, l) => sum + (l.hours || 0), 0) * 100) / 100
  const savedLines = (order.assignments ?? []).map(a => ({ technicianId: a.technician, role: a.role, hours: a.hours }))
  const linesDirty = JSON.stringify(lineDraft) !== JSON.stringify(savedLines)
  /** Approved technicians who hold at least one priced trade. */
  const staffable = technicians.filter(t => t.approvalStatus !== 'pending' && t.approvalStatus !== 'rejected' && technicianRoleOptions(t).length > 0)

  const progressDirty = progressDraft !== order.progress || hoursDraft !== order.hours || linesDirty
  // Before the job can be completed or delivered, total working hours must be > 0
  const effectiveHours = byRole ? draftLineHours : hoursDraft > 0 ? hoursDraft : order.hours
  const hoursSubmitted = effectiveHours > 0
  const [partsDraft, setPartsDraft] = useState(order.parts)
  const partsDirty = partsDraft !== order.parts
  const isPaid = Boolean((order as any).paid || (order as any).isPaid || (order as any).paymentStatus === 'paid')
  // Labour previews against the unsaved figures so the operator sees what saving
  // will cost — summed per role when the job bills by role.
  const previewLabour = byRole
    ? Math.round(lineDraft.reduce((sum, l) => sum + l.hours * rateOf(l.technicianId, l.role), 0) * 100) / 100
    : order.hourlyRate !== undefined
    ? Math.round(hoursDraft * order.hourlyRate * 100) / 100
    : order.labor
  // What the customer is charged before VAT: the work logged, capped at the quote they accepted.
  const logged = previewLabour + partsDraft
  const billable = order.agreedQuote != null ? Math.min(logged, order.agreedQuote) : logged
  const overQuote = order.agreedQuote != null ? Math.round(Math.max(0, logged - order.agreedQuote) * 100) / 100 : 0
  // Once the invoice exists its total (with VAT) is what the customer is asked for.
  const amountDue = order.invoiceTotal ?? billable

  /** What a save sends: the roles when billing by role, else the flat hours. */
  const hoursPayload = () => (byRole ? { assignments: lineDraft } : { workedHours: hoursDraft })

  const handleAdvanceStep = (next: string) => {
    // Carry the logged hours along, so advancing straight to Completed cannot
    // land on a job whose hours were typed but never saved.
    const pinned = Math.max(progressDraft, next === 'delivered' || next === 'completed' ? 100 : progressDraft)
    const extraData = effectiveHours > 0 ? { ...hoursPayload(), progress: pinned } : undefined
    onAdvance(next, extraData)
  }

  return (
    <div className="space-y-5">
      {/* Header Info Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div className="flex items-center gap-3.5">
          <div
            className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-2xl shadow-sm"
            style={{ background: `${c.color}18`, border: `1px solid ${c.color}33` }}
          >
            {c.icon}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-display text-lg font-extrabold text-deep-900">{order.title}</h2>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400 font-medium mt-1">
              <span className="font-semibold text-slate-600">{order.customer}</span>
              <span>·</span>
              <span>{translatePortalText("Boat:")} <span className="font-semibold text-slate-600">{order.boat}</span></span>
              <span>·</span>
              <span className="inline-flex items-center gap-1 font-bold text-violet-700 bg-violet-50 px-2 py-0.5 rounded-md border border-violet-100">
                <CalendarDays size={12} className="text-violet-600" />
                {order.date ? <>{order.date}{order.time ? ` · ${order.time}` : ''}</> : order.due !== 'Not scheduled' ? <>{translatePortalText("Due")} {order.due}</> : translatePortalText("Unscheduled")}
              </span>
              <span>·</span>
              <span>{translatePortalText("Created:")} {order.created}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${
            isDelivered ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' :
            order.status === 'In progress' ? 'bg-violet-50 text-violet-700 ring-1 ring-violet-200' :
            'bg-slate-100 text-slate-700'
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${isDelivered ? 'bg-emerald-500' : 'bg-violet-500 animate-pulse'}`} />
            {order.paused && !['Cancelled', 'Completed', 'Delivered'].includes(order.status) ? translatePortalText("Paused") : translatePortalText(order.status)}
          </span>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
            order.priority === 'Critical' ? 'bg-rose-50 text-rose-600 ring-1 ring-rose-200' :
            order.priority === 'High' ? 'bg-orange-50 text-orange-600 ring-1 ring-orange-200' :
            'bg-slate-100 text-slate-600'
          }`}>
            {translatePortalText(order.priority)}
          </span>
        </div>
      </div>

      {/* 6-Stage Lifecycle Pipeline */}
      <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
        <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-3">{translatePortalText("Service Lifecycle")}</p>
        <div className="grid grid-cols-6 gap-2">
          {CANONICAL_STEPS.map((step, i) => {
            const isCompleted = currentStepIdx > i
            const isCurrent = currentStepIdx === i
            return (
              <div key={step.key} className="flex flex-col items-center text-center relative">
                {/* Node connector line */}
                {i < CANONICAL_STEPS.length - 1 && (
                  <div
                    className={`absolute top-4 left-1/2 w-full h-[2px] -z-0 transition-colors ${
                      currentStepIdx > i ? 'bg-emerald-400' : currentStepIdx === i ? 'bg-violet-400' : 'bg-slate-200'
                    }`}
                  />
                )}
                {/* Node Circle */}
                <div
                  className={`z-10 flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all shadow-sm ${
                    isCurrent
                      ? 'bg-gradient-to-tr from-violet-600 to-indigo-500 text-white ring-4 ring-violet-100 shadow-violet-500/30 scale-105'
                      : isCompleted
                      ? 'bg-emerald-500 text-white shadow-emerald-500/20'
                      : 'bg-white text-slate-400 border border-slate-200'
                  }`}
                >
                  {isCompleted ? <Check size={14} strokeWidth={3} /> : i + 1}
                </div>
                {/* Step Label */}
                <span
                  className={`mt-2 text-[11px] font-bold leading-tight ${
                    isCurrent ? 'text-violet-700 font-extrabold' : isCompleted ? 'text-slate-700' : 'text-slate-400'
                  }`}
                >
                  {translatePortalText(step.label)}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Technician & Assignment Metric Cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-100 bg-sand/60 p-3.5 transition hover:bg-sand">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText("Assigned Technician")}</p>
          <div className="mt-1 flex items-center gap-2">
            {order.techAvatar ? (
              <img src={order.techAvatar} className="h-6 w-6 rounded-full object-cover" />
            ) : (
              <span className="grid h-6 w-6 place-items-center rounded-full bg-violet-100 text-xs">🧑‍🔧</span>
            )}
            <p className="truncate text-sm font-extrabold text-deep-900">{order.tech}</p>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-sand/60 p-3.5 transition hover:bg-sand">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText("Booked Specialty")}</p>
          <p className="mt-1 truncate text-sm font-extrabold text-deep-900">
            {order.bookedRole || order.team || translatePortalText("Marine Specialist")}
            {order.hourlyRate ? <span className="ms-1.5 text-xs font-semibold text-violet-600">({order.hourlyRate}{translatePortalText("/hr)")}</span> : ''}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-sand/60 p-3.5 transition hover:bg-sand">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText("Hours Logged vs Est")}</p>
          <p className="mt-1 text-sm font-extrabold text-deep-900">
            <span className="text-violet-600 font-black">{byRole ? draftLineHours : hoursDraft}{translatePortalText("h")}</span>{' '}
            {/* "0h est" read as an estimate of zero. No estimate was ever
                entered on a job created from a request, so say that instead. */}
            <span className="text-slate-400 text-xs font-medium">
              {order.estHours > 0 ? <>/ {formatPortalNumber(order.estHours)} {translatePortalText("estimated hours")}</> : translatePortalText("· no estimate")}
            </span>
          </p>
        </div>
      </div>

      {/* Progress & Working Hours Card */}
      <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-wider text-slate-600">{translatePortalText("Job Completion & Working Hours")}</p>
            <p className="text-[11px] text-slate-400">{translatePortalText("Update progress slider and record total working hours for billing")}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-violet-50 px-2.5 py-1 text-xs font-extrabold text-violet-700">
              {progressDraft}{translatePortalText("% complete")}
            </span>
            {!isDone && progressDirty && (
              <button
                onClick={() => onUpdateProgress({ progress: progressDraft, ...hoursPayload() })}
                className="btn-maint !py-1 !px-3 !text-xs shadow-sm"
              >
                {translatePortalText("Save changes")}
              </button>
            )}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_180px] items-center">
          <div>
            <input
              type="range"
              min={0}
              max={100}
              value={progressDraft}
              disabled={isDone}
              onChange={e => setProgressDraft(Number(e.target.value))}
              className="w-full accent-violet-600 disabled:opacity-50 cursor-pointer"
            />
            <div className="mt-1.5">
              <JobProgress pct={progressDraft} />
            </div>
          </div>

          {byRole ? (
            <div className="rounded-xl border border-slate-200 bg-sand/50 p-2 text-center">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText("Total hours")}</p>
              <p className="font-display text-xl font-extrabold text-deep-900">{draftLineHours}</p>
              <p className="text-[10px] font-semibold text-slate-400">
                {translatePortalText("across")} {formatPortalNumber(lineDraft.length)} {translatePortalText("role")}{lineDraft.length === 1 ? '' : translatePortalText("s")}
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-sand/50 p-1.5">
              <span className="ps-2 text-xs font-bold text-slate-500">{translatePortalText("Hours:")}</span>
              <input
                type="number"
                min={0}
                step={0.5}
                value={hoursDraft}
                disabled={isDone}
                placeholder={translatePortalText("0.0")}
                onChange={e => setHoursDraft(Number(e.target.value))}
                className="w-full rounded-lg border-0 bg-white px-2 py-1 text-center font-display text-sm font-extrabold text-deep-900 shadow-sm focus:ring-2 focus:ring-violet-500 disabled:opacity-50"
              />
              <span className="pe-2 text-xs font-semibold text-slate-400">{translatePortalText("hrs")}</span>
            </div>
          )}
        </div>

        {/* Hours by role — only offered once a technician is assigned, because the
            rates come from that technician's rate card. */}
        {staffable.length > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">{translatePortalText("Who worked on this")}</p>
                <p className="text-[10px] text-slate-400">
                  {byRole
                    ? translatePortalText("Each line bills at that person’s own rate for that trade.")
                    : translatePortalText("Add a line per person and trade when a job took more than one.")}
                </p>
              </div>
              {!isDone && staffable.length > 0 && (
                <button
                  type="button"
                  className="btn-ghost !py-1 !px-2.5 !text-xs"
                  onClick={() => {
                    const first = staffable[0]
                    const id = (first.id || (first as any)._id) as string
                    setLineDraft(prev => [...prev, { technicianId: id, role: rolesOf(id)[0]?.role ?? '', hours: 0 }])
                  }}
                >
                  <Plus size={13} /> {translatePortalText("Add line")}
                </button>
              )}
            </div>

            {byRole ? (
              <div className="space-y-1.5">
                {lineDraft.map((line, i) => (
                  <div key={`${line.technicianId}-${line.role}-${i}`} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <select
                      value={line.technicianId}
                      disabled={isDone}
                      onChange={e => {
                        const technicianId = e.target.value
                        // The trade has to be one this person actually holds, so
                        // switching who did the work re-picks their first trade.
                        const role = rolesOf(technicianId)[0]?.role ?? ''
                        setLineDraft(prev => prev.map((l, idx) => (idx === i ? { ...l, technicianId, role } : l)))
                      }}
                      className="input !w-auto !min-w-[9rem] !py-1 !text-xs"
                    >
                      {staffable.map(t => {
                        const id = (t.id || (t as any)._id) as string
                        return <option key={id} value={id}>{t.name}</option>
                      })}
                    </select>
                    <select
                      value={line.role}
                      disabled={isDone}
                      onChange={e => {
                        const role = e.target.value
                        setLineDraft(prev => prev.map((l, idx) => (idx === i ? { ...l, role } : l)))
                      }}
                      className="input !w-auto !min-w-[10rem] !py-1 !text-xs"
                    >
                      {rolesOf(line.technicianId).map(r => (
                        <option key={r.role} value={r.role}>{localizedField(r, 'role') ?? translatePortalText(r.role)} · {r.hourlyRate}{translatePortalText("/hr")}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={line.hours}
                      disabled={isDone}
                      onChange={e => {
                        const hours = Number(e.target.value)
                        setLineDraft(prev => prev.map((l, idx) => (idx === i ? { ...l, hours } : l)))
                      }}
                      className="input !w-20 !py-1 text-center"
                    />
                    <span className="text-[11px] font-semibold text-slate-400">{translatePortalText("hrs")}</span>
                    <span className="ms-auto w-24 text-end font-display text-sm font-extrabold text-deep-900">{money(lineTotal(line))}</span>
                    {!isDone && (
                      <button
                        onClick={() => setLineDraft(prev => prev.filter((_, idx) => idx !== i))}
                        className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        title={translatePortalText("Remove this line")}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-slate-200 p-3 text-center text-[11px] text-slate-400">
                {translatePortalText("Billing at")} {order.bookedRole ?? translatePortalText("the booked role")}
                {order.hourlyRate !== undefined ? <> · <bdi dir="ltr">{formatPortalCurrency(order.hourlyRate, 'SAR')}</bdi> {translatePortalText("per hour")}</> : ''}{translatePortalText(". Add a line above to record more than one person or trade.")}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Invoice Breakdown Grid */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm text-center">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText("Labor Charges")}</p>
          <p className="mt-1 font-display text-2xl font-extrabold text-deep-900">{money(previewLabour)}</p>
          <p className="mt-0.5 text-[10px] font-semibold text-slate-400">
            {byRole
              ? lineDraft.map(l => `${formatPortalNumber(l.hours)}${translatePortalText('h')} × ${money(rateOf(l.technicianId, l.role))}`).join('  +  ')
              : order.hourlyRate !== undefined
              ? <><bdi dir="ltr">{formatPortalNumber(hoursDraft)} × {money(order.hourlyRate)}</bdi> / {translatePortalText("hour")}</>
              : translatePortalText("No rate snapshot")}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm text-center">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText("Parts & Materials")}</p>
          {onUpdateParts && !isDone ? (
            <div className="mt-1.5 flex items-center justify-center gap-1.5">
              {/* Entry stays in riyals — this is the stored, settled figure, and a
                  converted round-trip would drift what the operator typed. */}
              <span className="text-sm font-bold text-slate-400">{translatePortalText("SAR")}</span>
              <input
                type="number"
                min={0}
                step={5}
                value={partsDraft}
                onChange={e => setPartsDraft(Number(e.target.value))}
                className="w-24 rounded-lg border border-slate-200 bg-sand/30 py-0.5 text-center font-display text-lg font-extrabold text-deep-900"
              />
              {partsDirty && (
                <button
                  onClick={() => onUpdateParts(partsDraft)}
                  className="rounded-lg bg-violet-600 px-2.5 py-1 text-[10px] font-bold text-white shadow-sm hover:bg-violet-700"
                >
                  {translatePortalText("Save")}
                </button>
              )}
            </div>
          ) : (
            <p className="mt-1 font-display text-2xl font-extrabold text-deep-900">{money(order.parts)}</p>
          )}
          <p className="mt-0.5 text-[10px] text-slate-400 font-medium">{translatePortalText("Billed components")}</p>
        </div>

        <div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-indigo-50/70 p-4 shadow-sm text-center">
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-violet-600">{translatePortalText("Total Invoice Amount")}</p>
          <p className="mt-1 font-display text-2xl font-extrabold text-violet-700">{money(billable)}</p>
          <p className="mt-0.5 text-[10px] font-bold text-violet-500">
            {order.agreedQuote != null
              ? `${translatePortalText('Accepted quote')} ${money(order.agreedQuote)} · ${translatePortalText('before VAT')}`
              : `${translatePortalText('Labor + Parts')} · ${translatePortalText('before VAT')}`}
          </p>
        </div>
      </div>

      {/* The customer agreed to a price. Logged work over it is not billed —
          the server caps the invoice — so say so before the job is closed. */}
      {overQuote > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
          <span>⚠️</span>
          <span>
            {translatePortalTemplate('Logged work comes to {{logged}}, {{over}} over the quote the customer accepted. The invoice is capped at {{quote}} — send a revised quote before the job is scheduled to charge more.', {
              logged: money(previewLabour + partsDraft),
              over: money(overQuote),
              quote: money(order.agreedQuote!),
            })}
          </span>
        </div>
      )}

      {/* Next Step Progression Action Bar */}
      {hasNextSteps && (
        <div className="rounded-2xl border border-slate-100 bg-sand/40 p-4">
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 mb-2.5">{translatePortalText("Advance Service Status")}</p>

          {!hoursSubmitted && (
            <div className="mb-3 flex items-center gap-2 rounded-xl bg-amber-50 p-2.5 border border-amber-200 text-xs font-semibold text-amber-800">
              <span>⚠️</span>
              <span>{translatePortalText("Please log and save total working hours above before marking this job complete or delivered.")}</span>
            </div>
          )}

          {/* Pre-Delivery Payment Gate Banner */}
          {nextOptions.includes('delivered') && !isPaid && (
            <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50/90 p-3 text-xs text-amber-900 shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-bold">
                  <CreditCard size={16} className="text-amber-700 shrink-0" />
                  <span>{translatePortalText("Awaiting Boat Owner Payment (")}{money(amountDue)})</span>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await maintenancePortalApi.sendPaymentReminder(order.id)
                      maintToast('Payment reminder notification sent to boat owner!', 'success')
                    } catch (err: any) {
                      maintToast(err?.message || 'Could not send payment reminder', 'warn')
                    }
                  }}
                  className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] font-extrabold text-white shadow-xs hover:bg-amber-700"
                >
                  <Bell size={12} /> {translatePortalText("Send Payment Reminder")}
                </button>
              </div>
              <p className="mt-1 text-[11px] text-amber-700 font-medium">
                {translatePortalText("Vessel delivery is locked until the client completes payment of")} {money(amountDue)} {translatePortalText("via HyperPay on the BoatPro mobile app.")}
              </p>
            </div>
          )}

          {nextOptions.includes('delivered') && isPaid && (previewLabour + partsDraft) > 0 && (
            <div className="mb-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-2.5 text-xs font-bold text-emerald-800">
              <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
              <span>{translatePortalText("Payment settled via HyperPay (")}{money(amountDue)}{translatePortalText(") · Vessel is authorized for delivery")}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {nextOptions.map(next => {
              const needsAssignment = next === 'assigned' && order.tech === 'Unassigned' && onAssign
              const isCompletionStep = ['completed', 'delivered'].includes(next)
              const blockedByHours = isCompletionStep && !hoursSubmitted
              const blockedByPayment = next === 'delivered' && !isPaid
              const disabled = blockedByHours || blockedByPayment

              return (
                <button
                  key={next}
                  disabled={disabled}
                  title={
                    blockedByHours
                      ? translatePortalText("Log working hours first")
                      : blockedByPayment
                      ? translatePortalText("Customer must pay invoice via HyperPay before delivery")
                      : undefined
                  }
                  onClick={() => (needsAssignment ? onAssign!() : handleAdvanceStep(next))}
                  className={`btn-maint !py-2 !px-4 !text-xs font-extrabold shadow-sm disabled:opacity-40 disabled:cursor-not-allowed ${
                    next === 'delivered' && isPaid ? '!bg-emerald-600 hover:!bg-emerald-700' : ''
                  }`}
                >
                  {blockedByPayment ? (
                    <span className="flex items-center gap-1.5">
                      <Lock size={12} /> {translatePortalText("Move to Delivered (Payment Required)")}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      {translatePortalText("Move to")} {translatePortalText(displayStatus(next))} <ArrowRight size={13} className="rtl:rotate-180" />
                    </span>
                  )}
                </button>
              )
            })}
            {canCancel && (
              <button onClick={() => onAdvance('cancelled')} className="btn-ghost !py-2 !px-3 !text-xs text-rose-500 hover:bg-rose-50">
                {translatePortalText("Cancel job")}
              </button>
            )}
          </div>
        </div>
      )}

      {isDelivered && (
        <div className="flex items-center gap-2 rounded-2xl bg-emerald-50 p-3.5 border border-emerald-200 text-xs font-bold text-emerald-800">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-500 text-white"><Check size={14} strokeWidth={3} /></span>
          <span>{translatePortalText("This work order has been delivered and finalized.")}</span>
        </div>
      )}

      {/* Modal Bottom Actions */}
      <div className="flex flex-wrap items-center justify-between border-t border-slate-100 pt-4">
        <div>
          {onReassign && (
            <button
              onClick={onReassign}
              disabled={isDelivered || isDone}
              title={isDone ? translatePortalText("Job is complete/delivered — reassign disabled") : undefined}
              className="btn-ghost !text-xs disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <UserCog size={14} /> {translatePortalText("Reassign Technician")}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onPrint} className="btn-ghost !text-xs"><Printer size={14} /> {translatePortalText("Print Work Order")}</button>
        </div>
      </div>
    </div>
  )
}

/**
 * Picks the technician for a job with real-time search by name, role, skills,
 * and categories, plus trade quick-filter chips and role tariff selection.
 */
function TechPickerModal({
  open,
  onClose,
  onPick,
  currentTech,
  title,
  technicians,
}: {
  open: boolean
  onClose: () => void
  onPick: (id: string, bookedRole?: string) => void
  currentTech?: string
  title: string
  technicians: MaintenanceTechnician[]
}) {
  const list = technicians
  const [expanded, setExpanded] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selectedRole, setSelectedRole] = useState<string>('All')

  React.useEffect(() => {
    if (open) {
      setExpanded(null)
      setSearch('')
      setSelectedRole('All')
    }
  }, [open])

  // Extract distinct roles and skills across technicians for fast filter pills
  const availableRoles = React.useMemo(() => {
    const set = new Set<string>()
    for (const t of list) {
      if (t.role) set.add(t.role)
      if (t.roles) {
        for (const r of t.roles) {
          if (r.role) set.add(r.role)
        }
      }
      if (t.skills) {
        for (const s of t.skills) {
          const meta = catByKey(s)
          set.add(meta?.name || s)
        }
      }
    }
    return ['All', ...Array.from(set).slice(0, 8)]
  }, [list])

  // Multi-field search across Name, Role, Roles array, Skills, Categories, Email, Phone
  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    return list.filter((t) => {
      // 1. Check quick-filter chip
      if (selectedRole !== 'All') {
        const matchesChip =
          t.role?.toLowerCase().includes(selectedRole.toLowerCase()) ||
          t.roles?.some((r) => r.role.toLowerCase().includes(selectedRole.toLowerCase())) ||
          t.skills?.some((s) => s.toLowerCase().includes(selectedRole.toLowerCase()) || (catByKey(s)?.name || '').toLowerCase().includes(selectedRole.toLowerCase()))
        if (!matchesChip) return false
      }

      // 2. Check search query text
      if (!q) return true

      const nameMatch = t.name.toLowerCase().includes(q)
      const roleMatch = (t.role || '').toLowerCase().includes(q)
      const rolesMatch = t.roles?.some((r) => r.role.toLowerCase().includes(q))
      const skillMatch = t.skills?.some(
        (s) => s.toLowerCase().includes(q) || (catByKey(s)?.name || '').toLowerCase().includes(q)
      )
      const emailMatch = (t.email || '').toLowerCase().includes(q)
      const phoneMatch = (t.phone || '').toLowerCase().includes(q)

      return nameMatch || roleMatch || rolesMatch || skillMatch || emailMatch || phoneMatch
    })
  }, [list, search, selectedRole])

  const choose = (t: MaintenanceTechnician) => {
    const roles = technicianRoleOptions(t)
    // Only stop to ask when the choice actually changes the rate.
    if (roles.length > 1) {
      setExpanded((prev) => (prev === t.id ? null : t.id))
      return
    }
    onPick(t.id, roles[0]?.role)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={`👷 ${title}`} wide>
      <div className="space-y-3">
        {/* Search bar */}
        <div className="relative">
          <Search size={16} className="absolute start-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={translatePortalText("Search mechanics by name, role, skill category, email...")}
            className="w-full rounded-xl border border-slate-200 bg-slate-50/70 py-2.5 ps-10 pe-9 text-xs font-semibold text-deep-900 placeholder:text-slate-400 focus:border-violet-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-200"
            autoFocus
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute end-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Trade / Specialty Filter Pills */}
        {availableRoles.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5 pb-1">
            <span className="text-[11px] font-bold text-slate-400 me-1">{translatePortalText("Filter by trade:")}</span>
            {availableRoles.map((role) => {
              const active = selectedRole === role
              return (
                <button
                  key={role}
                  onClick={() => setSelectedRole(role)}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${
                    active
                      ? 'bg-violet-600 text-white shadow-sm ring-1 ring-violet-600'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80 hover:text-slate-800'
                  }`}
                >
                  {role}
                </button>
              )
            })}
          </div>
        )}

        {/* Technician Count / Results Header */}
        <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 px-0.5">
          <span>
            {translatePortalText("Showing")} {formatPortalNumber(filtered.length)} {translatePortalText("of")} {formatPortalNumber(list.length)} {translatePortalText("technician")}{list.length !== 1 ? translatePortalText("s") : ''}
          </span>
          {(search || selectedRole !== 'All') && (
            <button
              onClick={() => {
                setSearch('')
                setSelectedRole('All')
              }}
              className="text-violet-600 hover:underline"
            >
              {translatePortalText("Reset filters")}
            </button>
          )}
        </div>

        {/* Technician Cards List */}
        <div className="max-h-[380px] space-y-2 overflow-y-auto pe-1">
          {list.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-400">
              {translatePortalText("No technicians yet — add one on the Technicians & Labor page first.")}
            </p>
          )}

          {list.length > 0 && filtered.length === 0 && (
            <div className="py-8 text-center">
              <p className="text-sm font-bold text-slate-700">{translatePortalText("No technicians found")}</p>
              <p className="mt-1 text-xs text-slate-400">
                {translatePortalText("No mechanics match \"")}{search || selectedRole}{translatePortalText("\". Try another role, category, or name.")}
              </p>
              <button
                onClick={() => {
                  setSearch('')
                  setSelectedRole('All')
                }}
                className="mt-3 inline-block rounded-lg bg-violet-50 px-3 py-1.5 text-xs font-bold text-violet-700 hover:bg-violet-100"
              >
                {translatePortalText("Clear search & filters")}
              </button>
            </div>
          )}

          {filtered.map((t) => {
            const roles = technicianRoleOptions(t)
            const isCurrent = t.name === currentTech
            const isPending = t.approvalStatus === 'pending'
            const isRejected = t.approvalStatus === 'rejected'
            const cannotAssign = isCurrent || isPending || isRejected

            return (
              <div
                key={t.id}
                className={`rounded-xl border transition ${
                  cannotAssign
                    ? 'border-slate-100 bg-slate-50/60'
                    : 'border-slate-100 hover:border-violet-300 hover:bg-violet-50/20'
                }`}
              >
                <button
                  onClick={() => choose(t)}
                  disabled={cannotAssign}
                  className="flex w-full items-center gap-3 p-3 text-left disabled:cursor-not-allowed"
                >
                  <img
                    src={t.avatar || avatar(Math.abs(t.name.charCodeAt(0) % 70))}
                    className={`h-11 w-11 rounded-full object-cover ring-2 ${
                      t.status === 'on_duty'
                        ? 'ring-emerald-400'
                        : cannotAssign
                        ? 'ring-slate-200 opacity-50 grayscale'
                        : 'ring-slate-200'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[13px] font-extrabold text-deep-900"><bdi dir="auto">{t.name}</bdi></p>
                      {t.status === 'on_duty' && !cannotAssign && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-bold text-emerald-700 ring-1 ring-emerald-200">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          {translatePortalText("On duty")}
                        </span>
                      )}
                      {isPending && (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-bold text-amber-700 ring-1 ring-amber-200">
                          {translatePortalText("⏳ Awaiting Admin Approval")}
                        </span>
                      )}
                      {isRejected && (
                        <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[9px] font-bold text-rose-700 ring-1 ring-rose-200">
                          {translatePortalText("✕ Rejected by Admin")}
                        </span>
                      )}
                    </div>

                    {/* Roles with hourly rates */}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {roles.length > 0 ? (
                        roles.map((r) => (
                          <span
                            key={r.role}
                            className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-700"
                          >
                            {localizedField(r, 'role') ?? translatePortalText(r.role)} <span className="text-violet-600 font-extrabold">{r.hourlyRate}{translatePortalText("/hr")}</span>
                          </span>
                        ))
                      ) : (
                        <span className="text-[11px] text-slate-400">{t.role ? translatePortalText(t.role) : translatePortalText("Marine Technician")}</span>
                      )}
                    </div>

                    {/* Skills list */}
                    {t.skills && t.skills.length > 0 && (
                      <p className="mt-1 truncate text-[10px] text-slate-400">
                        <span className="font-semibold text-slate-500">{translatePortalText("Specialties:")}</span>{' '}
                        {t.skills.map((s) => translatePortalText(catByKey(s)?.name || s)).join(' · ')}
                      </p>
                    )}
                    {t.email && <p className="truncate text-[10px] text-slate-400">{t.email}</p>}
                  </div>

                  {isCurrent ? (
                    <span className="rounded-lg bg-violet-100 px-2.5 py-1 text-[11px] font-bold text-violet-700">
                      {translatePortalText("Current")}
                    </span>
                  ) : isPending || isRejected ? (
                    <span className="text-[10px] font-bold text-slate-400">{translatePortalText("Cannot assign")}</span>
                  ) : roles.length > 1 ? (
                    <div className="text-right">
                      <span className="inline-block rounded-lg bg-violet-50 px-2.5 py-1 text-[11px] font-bold text-violet-700 hover:bg-violet-100">
                        {expanded === t.id ? translatePortalText("Close") : translatePortalText("Select Role")}
                      </span>
                    </div>
                  ) : (
                    <ArrowRight size={16} className="text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-violet-600 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
                  )}
                </button>

                {expanded === t.id && (
                  <div className="border-t border-slate-100 bg-slate-50/50 p-3 rounded-b-xl">
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                      {translatePortalText("Choose role & billing tariff for this work order:")}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {roles.map((r) => (
                        <button
                          key={r.role}
                          onClick={() => {
                            onPick(t.id, r.role)
                            onClose()
                          }}
                          className="flex items-center gap-2 rounded-xl border border-violet-200 bg-white px-3 py-2 text-xs font-bold text-deep-900 shadow-sm transition hover:border-violet-500 hover:bg-violet-50 hover:text-violet-900"
                        >
                          <span>{localizedField(r, 'role') ?? translatePortalText(r.role)}</span>
                          <span className="rounded-md bg-violet-100 px-1.5 py-0.5 text-[10px] font-extrabold text-violet-700">
                            {r.hourlyRate}{translatePortalText("/hr")}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </Modal>
  )
}

function WorkOrderFormModal({ open, onClose, onSave, technicians }: { open: boolean; onClose: () => void; onSave: (body: Record<string, unknown>) => void; technicians: MaintenanceTechnician[] }) {
  const list = technicians
  const blank = { boat: '', customer: '', title: '', cat: 'engine', techId: '', bookedRole: '', priority: 'Medium' as WorkOrder['priority'], estHours: 4 }
  const [f, setF] = useState(blank)
  React.useEffect(() => { if (open) setF(blank) }, [open])
  const set = (k: keyof typeof f) => (v: any) => setF(s => ({ ...s, [k]: v }))
  // Roles offered follow the chosen technician — the pick sets the labour rate.
  const roleOptions = technicianRoleOptions(list.find(t => t.id === f.techId))
  const pickTech = (techId: string) => {
    const roles = technicianRoleOptions(list.find(t => t.id === techId))
    setF(s => ({ ...s, techId, bookedRole: roles[0]?.role ?? '' }))
  }
  const submit = () => {
    if (!f.boat.trim() || !f.title.trim()) { maintToast('Fill boat and job title', 'warn'); return }
    onSave({ boatName: f.boat, customerName: f.customer || undefined, title: f.title, category: f.cat, technicianId: f.techId || undefined, bookedRole: f.techId && f.bookedRole ? f.bookedRole : undefined, priority: f.priority.toLowerCase(), estimatedHours: f.estHours })
  }
  return (
    <Modal open={open} onClose={onClose} title={translatePortalText("🔧 New work order")} wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="label">{translatePortalText("Boat")}</label><input className="input" value={f.boat} onChange={e => set('boat')(e.target.value)} placeholder={translatePortalText("Boat name")} /></div>
        <div><label className="label">{translatePortalText("Customer")}</label><input className="input" value={f.customer} onChange={e => set('customer')(e.target.value)} placeholder={translatePortalText("Customer name")} /></div>
        <div className="sm:col-span-2"><label className="label">{translatePortalText("Job title")}</label><input className="input" value={f.title} onChange={e => set('title')(e.target.value)} placeholder={translatePortalText("e.g. Port engine cooling repair")} /></div>
        <div><label className="label">{translatePortalText("Category")}</label><select className="input" value={f.cat} onChange={e => set('cat')(e.target.value)}>{CAT_NAMES.map(c => <option key={c.key} value={c.key}>{c.name}</option>)}</select></div>
        <div><label className="label">{translatePortalText("Assign technician")}</label><select className="input" value={f.techId} onChange={e => pickTech(e.target.value)}><option value="">{translatePortalText("Assign later")}</option>{list.map(t => { const unapproved = t.approvalStatus === 'pending' || t.approvalStatus === 'rejected'; return <option key={t.id} value={t.id} disabled={unapproved}>{t.name}{t.approvalStatus === 'pending' ? translatePortalText(" (⏳ Awaiting Admin Approval)") : t.approvalStatus === 'rejected' ? translatePortalText(" (✕ Rejected)") : ''}</option> })}</select></div>
        {roleOptions.length > 0 && (
          <div>
            <label className="label">{translatePortalText("Book at role (sets labour rate)")}</label>
            <select className="input" value={f.bookedRole} onChange={e => set('bookedRole')(e.target.value)}>
              {roleOptions.map(r => <option key={r.role} value={r.role}>{localizedField(r, 'role') ?? translatePortalText(r.role)} — {r.hourlyRate}{translatePortalText("/hr")}</option>)}
            </select>
          </div>
        )}
        <div><label className="label">{translatePortalText("Priority")}</label><select className="input" value={f.priority} onChange={e => set('priority')(e.target.value)}>{['Low', 'Medium', 'High', 'Critical'].map(p => <option key={p} value={p}>{translatePortalText(p)}</option>)}</select></div>
        <div><label className="label">{translatePortalText("Est. hours")}</label><input type="number" min={1} className="input" value={f.estHours} onChange={e => set('estHours')(Math.max(1, Number(e.target.value)))} /></div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button onClick={onClose} className="btn-ghost">{translatePortalText("Cancel")}</button>
        <button onClick={submit} className="btn-maint">{translatePortalText("Create work order")}</button>
      </div>
    </Modal>
  )
}

// ══════════ INSPECTION & DIAGNOSIS (§5, §6) ══════════
/** Maps a stored inspection onto the shape this page renders. */
const toInspectionView = (i: MaintenanceInspection): Inspection => {
  const performed = i.performedAt ? new Date(i.performedAt) : new Date(i.createdAt)
  const items = (i.items || []).map(it => ({ label: String(localizedField(it, 'label') ?? it.label), result: it.result as CheckResult, note: localizedField(it, 'note') as string | undefined }))
  return {
    id: i.id,
    woId: i.workOrder?.code || '—',
    boat: i.boatName,
    type: String(localizedField(i, 'type') ?? i.type),
    icon: INSPECTION_TYPES.find(t => i.type.toLowerCase().startsWith(t.name.toLowerCase()))?.icon || '🔍',
    tech: i.technician?.name || 'Unassigned',
    techAvatar: i.technician?.avatar || '',
    date: formatPortalDate(performed, { month: 'short', day: 'numeric' }),
    status: displayStatus(i.status) as Inspection['status'],
    score: i.score ?? 0,
    photos: 0,
    items,
  }
}
export function MaintInspections() { return <InspectionsPage /> }
const iconFor: any = { Pass: '✅', Fail: '❌', Attention: '⚠️', Pending: '⏳' }
function InspectionsPage() {
  const [inspections, setInspections] = useState<Inspection[]>([])
  const [loading, setLoading] = useState(true)
  const [techs, setTechs] = useState<MaintenanceTechnician[]>([])
  const [startType, setStartType] = useState<{ key: string; name: string; icon: string } | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  const loadInspections = () => {
    maintenancePortalApi.inspections({ limit: 100 })
      .then(res => setInspections((res.data.items || []).map(toInspectionView)))
      .catch(() => setInspections([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadInspections()
    // The checklist records who performed it, so the roster has to be real.
    maintenancePortalApi.technicians()
      .then(res => setTechs(res.data.technicians || []))
      .catch(() => setTechs([]))
  }, [])

  /** Persists the checklist, then refreshes from the server. */
  const saveInspection = async (payload: Record<string, unknown>) => {
    await maintenancePortalApi.createInspection(payload)
    setStartType(null)
    loadInspections()
  }
  // Real "diagnostics" derived from actual inspection checklist results —
  // there's no IoT/sensor integration anywhere in this app, so this reuses
  // failed/attention-flagged inspection items instead of fabricating fault codes.
  const diagnostics = inspections.flatMap(ins => ins.items
    .filter(it => it.result === 'Fail' || it.result === 'Attention')
    .map(it => ({ boat: ins.boat, system: it.label, note: it.note, severity: it.result === 'Fail' ? 'High' : 'Medium', date: ins.date, icon: ins.icon })))

  const diagReport = () => printDoc(translatePortalText('Diagnostic Report'), `
    <h1>${translatePortalText('Diagnostic Report')}</h1><p class="sub">${translatePortalText('Fault flags from completed inspection checklists')}</p>
    <table><thead><tr><th>${translatePortalText('Boat')}</th><th>${translatePortalText('System')}</th><th>${translatePortalText('Severity')}</th><th>${translatePortalText('Note')}</th><th>${translatePortalText('Date')}</th></tr></thead><tbody>
    ${diagnostics.map(d => `<tr><td>${d.boat}</td><td>${d.system}</td><td>${translatePortalText(d.severity)}</td><td>${d.note || '—'}</td><td>${d.date}</td></tr>`).join('') || `<tr><td colspan="5">${translatePortalText('No faults flagged')}</td></tr>`}
    </tbody></table>`)

  return (
    <PageWrap>
      <MaintHeader title={translatePortalText("Inspection & Diagnosis")} sub="Digital checklists, pass/fail results, fault detection & diagnostic reports" icon={<Stethoscope className="text-violet-500" />}
        actions={<button className="btn-maint" onClick={() => setPickerOpen(true)}><Plus size={15} /> {translatePortalText("New inspection")}</button>} />

      <Section title={translatePortalText("Inspection types")} sub={translatePortalText("Tap to launch a checklist")} className="mb-5">
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
          {INSPECTION_TYPES.map((t, i) => (
            <motion.button key={t.key} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.03 }}
              onClick={() => setStartType(t)}
              className="flex flex-col items-center gap-1.5 rounded-2xl border border-slate-100 bg-sand p-3 text-center transition hover:border-violet-300 hover:bg-violet-50 active:scale-95">
              <span className="text-xl">{t.icon}</span><span className="text-[11px] font-bold text-deep-800">{translatePortalText(t.name)}</span>
            </motion.button>
          ))}
        </div>
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <h3 className="font-display font-bold text-deep-900">{translatePortalText("Recent inspections")}</h3>
          {inspections.map((ins, i) => (
            <motion.div key={ins.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="card p-4">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-50 text-lg">{ins.icon}</span>
                <div className="min-w-0 flex-1"><p className="truncate text-[14px] font-extrabold text-deep-900">{translatePortalText(ins.type)} · {ins.boat}</p><p className="text-[11px] text-slate-400">{ins.tech} · {ins.date} · 📷 {ins.photos}</p></div>
                {ins.status !== 'Scheduled' && <HealthRing score={ins.score} size={54} />}
                <MBadge dot={ins.status === 'In progress'}>{ins.status}</MBadge>
              </div>
              <div className="mt-3 space-y-1.5">
                {ins.items.map(it => (
                  <div key={it.label} className="flex items-center gap-2 rounded-lg bg-sand px-3 py-1.5 text-xs">
                    <span>{iconFor[it.result]}</span>
                    <span className="font-semibold text-deep-800">{translatePortalText(it.label)}</span>
                    {it.note && <span className="truncate text-[11px] text-slate-400">— {it.note}</span>}
                    <span className="ms-auto"><MBadge>{it.result}</MBadge></span>
                  </div>
                ))}
              </div>
            </motion.div>
          ))}
        </div>

        <div className="space-y-4">
          <h3 className="font-display font-bold text-deep-900">{translatePortalText("Diagnostics")}</h3>
          <p className="text-xs text-slate-400">{translatePortalText("Faults flagged during completed inspections — no live sensor telemetry is connected yet.")}</p>
          {diagnostics.length === 0 && <div className="rounded-2xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">{translatePortalText("No faults flagged yet.")}</div>}
          {diagnostics.map((d, i) => (
            <motion.div key={`${d.boat}-${d.system}-${i}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="card p-4">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-lg">{d.icon}</span>
                <div className="min-w-0 flex-1"><p className="text-[13px] font-extrabold text-deep-900">{d.boat} · {d.system}</p><p className="text-[11px] text-slate-400">{d.date}</p></div>
                <MBadge>{d.severity}</MBadge>
              </div>
              {d.note && <p className="mt-2 text-xs text-slate-500">{d.note}</p>}
            </motion.div>
          ))}
          <button onClick={diagReport} className="btn-maint w-full !justify-center"><Printer size={15} /> {translatePortalText("Generate diagnostic report")}</button>
        </div>
      </div>

      <InspectionTypePicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={t => { setPickerOpen(false); setStartType(t) }} />
      <ChecklistModal type={startType} onClose={() => setStartType(null)} onSave={saveInspection} techs={techs} />
    </PageWrap>
  )
}

function InspectionTypePicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (t: { key: string; name: string; icon: string }) => void }) {
  return (
    <Modal open={open} onClose={onClose} title={translatePortalText("🩺 Start inspection — pick a type")}>
      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
        {INSPECTION_TYPES.map(t => (
          <button key={t.key} onClick={() => onPick(t)} className="flex flex-col items-center gap-1.5 rounded-2xl border border-slate-100 bg-sand p-3 text-center transition hover:border-violet-300 hover:bg-violet-50 active:scale-95">
            <span className="text-xl">{t.icon}</span><span className="text-[11px] font-bold text-deep-800">{translatePortalText(t.name)}</span>
          </button>
        ))}
      </div>
    </Modal>
  )
}

const CHECKLIST_TEMPLATE = ['Visual condition', 'Fluid levels', 'Wear & corrosion', 'Function test', 'Safety & compliance', 'Final sign-off']
function ChecklistModal({ type, onClose, onSave, techs }: { type: { key: string; name: string; icon: string } | null; onClose: () => void; onSave: (payload: Record<string, unknown>) => Promise<void>; techs: MaintenanceTechnician[] }) {
  const [boat, setBoat] = useState('')
  const [technicianId, setTechnicianId] = useState('')
  const [saving, setSaving] = useState(false)
  const [results, setResults] = useState<CheckResult[]>(CHECKLIST_TEMPLATE.map(() => 'Pending'))
  const onDuty = techs.filter(t => t.status === 'on_duty')
  React.useEffect(() => {
    if (type) {
      setBoat('')
      setTechnicianId(onDuty[0]?.id || '')
      setResults(CHECKLIST_TEMPLATE.map(() => 'Pending'))
    }
  }, [type])
  const cycle = (i: number) => setResults(rs => rs.map((r, j) => j === i ? (r === 'Pending' ? 'Pass' : r === 'Pass' ? 'Attention' : r === 'Attention' ? 'Fail' : 'Pending') : r))
  const done = results.filter(r => r !== 'Pending').length
  const score = Math.round((results.filter(r => r === 'Pass').length + results.filter(r => r === 'Attention').length * 0.5) / results.length * 100)
  const save = async () => {
    if (!boat.trim()) { maintToast('Enter the boat name', 'warn'); return }
    if (!technicianId) { maintToast('No technician on duty to record this against', 'warn'); return }
    if (done < results.length) { maintToast('Complete all checklist items', 'warn'); return }
    setSaving(true)
    try {
      await onSave({
        boatName: boat.trim(),
        type: `${type!.name} Inspection`,
        status: 'completed',
        score,
        technicianId,
        performedAt: new Date().toISOString(),
        items: CHECKLIST_TEMPLATE.map((label, i) => ({ label, result: results[i].toLowerCase() })),
      })
      maintToast(translatePortalTemplate('{{type}} inspection saved — score {{score}}', {
        type: translatePortalText(type!.name),
        score,
      }))
    } catch (e: any) {
      maintToast(e?.message || 'Could not save the inspection', 'warn')
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal open={!!type} onClose={onClose} title={type ? `${type.icon} ${translatePortalTemplate('{{type}} inspection', { type: translatePortalText(type.name) })}` : ''} wide>
      {type && (
        <div className="space-y-4">
          <div><label className="label">{translatePortalText("Boat")}</label><input className="input" value={boat} onChange={e => setBoat(e.target.value)} placeholder={translatePortalText("Boat name")} autoFocus /></div>
          <div>
            <div className="mb-1.5 flex items-center justify-between"><p className="label !mb-0">{translatePortalText("Checklist")}</p><span className="text-xs font-bold text-slate-400">{formatPortalNumber(done)}/{formatPortalNumber(results.length)} {translatePortalText("· tap to set result")}</span></div>
            <div className="space-y-1.5">
              {CHECKLIST_TEMPLATE.map((label, i) => (
                <button key={label} onClick={() => cycle(i)} className="flex w-full items-center gap-2 rounded-lg bg-sand px-3 py-2 text-left text-sm transition hover:bg-violet-50">
                  <span className="text-base">{iconFor[results[i]]}</span>
                  <span className="font-semibold text-deep-800">{translatePortalText(label)}</span>
                  <span className="ms-auto"><MBadge>{results[i]}</MBadge></span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
            <span className="text-sm font-bold text-deep-900">{translatePortalText("Live score")}</span>
            <span className="font-display text-2xl font-extrabold text-violet-700">{score}</span>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="btn-ghost">{translatePortalText("Cancel")}</button>
            <button onClick={save} className="btn-maint">{translatePortalText("Save inspection")}</button>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ══════════ SCHEDULE & PLANNING (§7, §8) ══════════
// Descriptive-only categories — there's no maintenance-strategy field (preventive
// vs corrective vs predictive) anywhere in the backend, so this is a navigational
// picker rather than a source of counts.
const MAINT_PLAN_META = [
  { key: 'preventive', name: 'Preventive', icon: '🛡️', desc: 'Scheduled service before failure' },
  { key: 'corrective', name: 'Corrective', icon: '🔧', desc: 'Repair after fault reported' },
  { key: 'predictive', name: 'Predictive', icon: '🤖', desc: 'From inspection/sensor trends' },
  { key: 'emergency', name: 'Emergency', icon: '🚨', desc: 'Immediate SOS dispatch' },
  { key: 'seasonal', name: 'Seasonal', icon: '🍂', desc: 'Haul-out, winterize, commission' },
  { key: 'annual', name: 'Annual', icon: '📅', desc: 'Yearly certification & survey' },
]
const todayKey = (d: Date) => d.toDateString()
export function MaintSchedule() { return <SchedulePage /> }
function SchedulePage() {
  const [technicians, setTechnicians] = useState<MaintenanceTechnician[]>([])
  const [workOrders, setWorkOrders] = useState<MaintenanceWorkOrder[]>([])
  const [newOpen, setNewOpen] = useState(false)
  const [plan, setPlan] = useState<typeof MAINT_PLAN_META[number] | null>(null)

  const load = () => {
    Promise.all([
      maintenancePortalApi.technicians(),
      maintenancePortalApi.workOrders({ limit: 200 }),
    ]).then(([techRes, woRes]) => {
      setTechnicians(techRes.data.technicians || [])
      setWorkOrders(woRes.data.items || [])
    }).catch(() => maintToast('Could not load schedule', 'warn'))
  }
  useEffect(load, [])

  const today = todayKey(new Date())
  const todaySchedule = workOrders
    .filter(w => w.scheduledFor && todayKey(new Date(w.scheduledFor)) === today)
    .sort((a, b) => new Date(a.scheduledFor!).getTime() - new Date(b.scheduledFor!).getTime())

  // Real job counts per weekday (Mon–Sun, current week) from each work order's scheduledFor.
  const weekLoad = (() => {
    const now = new Date()
    const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7)); monday.setHours(0, 0, 0, 0)
    const days = Array.from({ length: 7 }, (_, i) => {
      const day = new Date(monday)
      day.setDate(monday.getDate() + i)
      return formatPortalDate(day, { weekday: 'short' })
    })
    const counts = days.map(d => ({ d, jobs: 0 }))
    for (const w of workOrders) {
      if (!w.scheduledFor) continue
      const diff = Math.floor((new Date(w.scheduledFor).getTime() - monday.getTime()) / 86400000)
      if (diff >= 0 && diff < 7) counts[diff].jobs++
    }
    return counts
  })()

  const onDuty = technicians.filter(t => (t.approvalStatus === 'approved' || !t.approvalStatus) && t.status === 'on_duty').slice(0, 5)
  const jobsTodayFor = (techId?: string) => techId ? todaySchedule.filter(w => (typeof w.technician === 'object' ? (w.technician?._id || w.technician?.id) : w.technician) === techId).length : 0

  const createWO = useLimitAwareAction(maintenancePortalApi.createWorkOrder)

  const addJob = async (payload: Record<string, unknown>) => {
    const created = await createWO.run(payload)
    if (!created) return
    setNewOpen(false); maintToast('New job scheduled'); load()
  }

  return (
    <PageWrap>
      <MaintHeader title={translatePortalText("Schedule & Planning")} sub="Daily, weekly & technician calendars, plus preventive maintenance plans" icon={<CalendarDays className="text-violet-500" />}
        actions={<button className="btn-maint" onClick={() => setNewOpen(true)}><Plus size={15} /> {translatePortalText("Schedule job")}</button>} />

      <div className="grid gap-5 lg:grid-cols-3">
        <Section title={translatePortalText("Today · timeline")} sub={formatPortalDate(new Date(), { weekday: 'long', month: 'long', day: 'numeric' })} className="lg:col-span-2">
          {todaySchedule.length === 0 && <p className="py-10 text-center text-sm text-slate-400">{translatePortalText("Nothing scheduled for today.")}</p>}
          <div className="relative space-y-3 ps-6">
            {todaySchedule.length > 0 && <div className="absolute start-2 top-1 bottom-1 w-0.5 bg-gradient-to-b from-violet-400 to-indigo-300" />}
            {todaySchedule.map((w, i) => {
              const c = catByKey(w.category)
              return (
                <motion.div key={w.id} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className="relative">
                  <span className="absolute -start-[18px] top-3 h-3 w-3 rounded-full border-2 border-white bg-violet-500 shadow" />
                  <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-sand/60 p-3">
                    <div className="w-14 shrink-0 text-center"><p className="font-display text-sm font-extrabold text-deep-900">{formatPortalTime(w.scheduledFor!)}</p><p className="text-[10px] text-slate-400">{formatPortalNumber(w.estimatedHours)} {translatePortalText("h")}</p></div>
                    <span className="grid h-9 w-9 place-items-center rounded-xl text-base" style={{ background: `${c.color}1a` }}>{c.icon}</span>
                    <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-extrabold text-deep-900">{w.boatName} · {w.title}</p><p className="text-[11px] text-slate-400">{w.technician?.name || translatePortalText("Unassigned")}</p></div>
                    <MBadge>{displayStatus(w.status)}</MBadge>
                  </div>
                </motion.div>
              )
            })}
          </div>
        </Section>

        <div className="space-y-5">
          <Section title={translatePortalText("This week")} sub={translatePortalText("Job load by day")}>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={weekLoad} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="d" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(139,92,246,0.06)' }} />
                <Bar dataKey="jobs" name={translatePortalText("Jobs")} fill="#8b5cf6" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Section>
          <Section title={translatePortalText("Technician schedules")} sub={translatePortalText("On-duty today")}>
            <div className="space-y-2">
              {onDuty.length === 0 && <p className="py-4 text-center text-xs text-slate-400">{translatePortalText("No technicians on duty.")}</p>}
              {onDuty.map(t => (
                <div key={t.id} className="flex items-center gap-2.5">
                  <img src={t.avatar || avatar(1)} className="h-7 w-7 rounded-full object-cover" />
                  <span className="truncate text-xs font-semibold text-deep-800">{t.name.split(' ')[0]}</span>
                  <span className="ms-auto text-[11px] font-bold text-slate-400">{formatPortalNumber(jobsTodayFor(t.id))} {translatePortalText("job")}{jobsTodayFor(t.id) === 1 ? '' : translatePortalText("s")} {translatePortalText("today")}</span>
                </div>
              ))}
            </div>
          </Section>
        </div>
      </div>

      <Section title={translatePortalText("Maintenance plans")} sub={translatePortalText("Preventive, corrective, predictive, seasonal & annual programs")} className="mt-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {MAINT_PLAN_META.map((p, i) => (
            <motion.button key={p.key} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
              onClick={() => setPlan(p)}
              className="rounded-2xl border border-slate-100 bg-sand p-4 text-center transition hover:border-violet-300 hover:bg-violet-50 hover:shadow-soft active:scale-95">
              <span className="text-2xl">{p.icon}</span>
              <p className="mt-1.5 text-[13px] font-extrabold text-deep-900">{translatePortalText(p.name)}</p>
              <p className="mt-0.5 text-[10px] text-slate-400 line-clamp-2">{translatePortalText(p.desc)}</p>
            </motion.button>
          ))}
        </div>
      </Section>

      <ScheduleJobModal open={newOpen} onClose={() => setNewOpen(false)} onSave={addJob} technicians={technicians} />

      <Modal open={!!plan} onClose={() => setPlan(null)} title={plan ? `${plan.icon} ${translatePortalText(`${plan.name} maintenance`)}` : ''}>
        {plan && <p className="text-sm text-slate-500">{translatePortalText(plan.desc)}</p>}
      </Modal>
      {createWO.modal}
    </PageWrap>
  )
}

function ScheduleJobModal({ open, onClose, onSave, technicians }: { open: boolean; onClose: () => void; onSave: (payload: Record<string, unknown>) => Promise<void>; technicians: MaintenanceTechnician[] }) {
  /**
   * A scheduling dialog that could only schedule today.
   *
   * There was no date field at all: `submit` built `new Date()` and called
   * `setHours()` on it, so every job landed on the current day whatever the
   * workshop intended. The time input was labelled "Time (today)", which was at
   * least honest, but it made the feature useless for the ordinary case — a job
   * booked in for next Tuesday — and `scheduledFor` on the API has always
   * accepted any instant.
   *
   * Defaults to today so the common case still takes one click.
   */
  const localToday = () => {
    const n = new Date()
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
  }
  const blank = { boat: '', job: '', techId: '', cat: 'engine', date: localToday(), time: '09:00', estHours: 2 }
  const [f, setF] = useState(blank)
  const [saving, setSaving] = useState(false)
  React.useEffect(() => { if (open) setF({ ...blank, techId: technicians[0]?.id || '' }) }, [open, technicians])
  const set = (k: keyof typeof f) => (v: any) => setF(s => ({ ...s, [k]: v }))
  const submit = async () => {
    if (!f.boat.trim() || !f.job.trim()) { maintToast('Fill boat and job', 'warn'); return }
    const [h, m] = f.time.split(':').map(Number)
    const [y, mo, d] = f.date.split('-').map(Number)
    if (!y || !mo || !d) { maintToast('Pick a date for the job', 'warn'); return }
    // Constructed from local parts so the instant is the workshop's own clock,
    // not a UTC reading of it.
    const scheduledFor = new Date(y, mo - 1, d, h, m, 0, 0)
    setSaving(true)
    try {
      await onSave({ boatName: f.boat.trim(), title: f.job.trim(), category: f.cat, technicianId: f.techId || undefined, scheduledFor: scheduledFor.toISOString(), estimatedHours: f.estHours })
    } catch (e) {
      maintToast(e instanceof Error ? e.message : 'Could not schedule job', 'warn')
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal open={open} onClose={onClose} title={translatePortalText("📅 Schedule a job")} wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="label">{translatePortalText("Boat")}</label><input className="input" value={f.boat} onChange={e => set('boat')(e.target.value)} placeholder={translatePortalText("Boat name")} /></div>
        <div><label className="label">{translatePortalText("Job")}</label><input className="input" value={f.job} onChange={e => set('job')(e.target.value)} placeholder={translatePortalText("e.g. Engine cooling repair")} /></div>
        <div><label className="label">{translatePortalText("Technician")}</label><select className="input" value={f.techId} onChange={e => set('techId')(e.target.value)}><option value="">{translatePortalText("Unassigned")}</option>{technicians.map(t => { const unapproved = t.approvalStatus === 'pending' || t.approvalStatus === 'rejected'; return <option key={t.id} value={t.id} disabled={unapproved}>{t.name}{t.approvalStatus === 'pending' ? translatePortalText(" (⏳ Awaiting Admin Approval)") : t.approvalStatus === 'rejected' ? translatePortalText(" (✕ Rejected)") : ''}</option> })}</select></div>
        <div><label className="label">{translatePortalText("Category")}</label><select className="input" value={f.cat} onChange={e => set('cat')(e.target.value)}>{CAT_NAMES.map(c => <option key={c.key} value={c.key}>{c.name}</option>)}</select></div>
        <div><label className="label">{translatePortalText("Date")}</label><input type="date" className="input" min={localToday()} value={f.date} onChange={e => set('date')(e.target.value)} /></div>
        <div><label className="label">{translatePortalText("Time")}</label><input type="time" className="input" value={f.time} onChange={e => set('time')(e.target.value)} /></div>
        <div><label className="label">{translatePortalText("Est. hours")}</label><input type="number" min={1} className="input" value={f.estHours} onChange={e => set('estHours')(Math.max(1, Number(e.target.value)))} /></div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button onClick={onClose} className="btn-ghost">{translatePortalText("Cancel")}</button>
        <button onClick={submit} disabled={saving} className="btn-maint disabled:opacity-60">{saving ? translatePortalText("Scheduling…") : translatePortalText("Schedule job")}</button>
      </div>
    </Modal>
  )
}
