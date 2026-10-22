import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { RadioTower, Maximize2, Minimize2, MoveHorizontal, Plus, Pencil, Camera, Eye, X, Anchor } from 'lucide-react'
import { PageHeader, Badge, Img, toast, Modal, AsyncBlock, EmptyState } from '../ui'
import { boatPhoto } from '../images'
import { boatTypeLabel, useAsync, useMarina, BERTH_LABELS, RESERVATION_LABELS, fmtDate, formatMoney, humanize, personOf } from '../live'
import { chatApi, idOf, portalApi, movementsApi, fileUrl, type ApiBerthMapEntry } from '../api'
import { onSocket } from '../socket'
import { BERTH_TINT as STATUS_FILL, HarbourChart, harbourScrolls } from '../harbour'
import BerthModal from '../components/BerthModal'
import DockModal from '../components/DockModal'
import { formatPortalNumber, translatePortalText, meterUnit } from '../i18n/runtime'


const CREW_ACTIONS = ['Prepare lines', 'Fenders out', 'Pump-out cart', 'Fuel top-up']

/** "A-04" — how the crew writes a berth. */
const berthCode = (b: ApiBerthMapEntry) => `${b.pontoon}-${String(b.number).padStart(2, '0')}`

export default function LiveMap() {
  const { marina, currency } = useMarina()
  const state = useAsync(() => portalApi.berthMap().then(r => r.data), [])
  const staff = useAsync(() => portalApi.staff().then(r => r.data), [])

  // Vessels under way. Asked for by status, on any date: this read the first
  // 40 movements *scheduled today* (in the server's UTC day) and kept the
  // en-route ones, so a boat under way for tomorrow's slot — or any boat past
  // the 40th movement of a busy day — never crossed the chart.
  const transits = useAsync(
    () => movementsApi.list({ date: 'all', status: 'en_route', limit: 40 }).then(r => r.data.items ?? []),
    [],
  )

  /**
   * The refresh the badge has always promised.
   *
   * The header carried a pulsing green "LIVE · refreshes every minute" chip and
   * nothing refreshed: `useAsync` fetched once on mount with empty deps, and
   * `reload()` ran only when the operator did something themselves. So a dock
   * screen left open — which is how a monitoring screen is used — showed the
   * berth occupancy from whenever the tab was opened, under a badge insisting
   * it was live. A harbour master reading a free berth off a stale map sends a
   * boat to an occupied one.
   *
   * Sixty seconds, matching what the chip said, and the chip now reports the
   * real age of the data instead of a promise.
   */
  const [lastSync, setLastSync] = useState(() => Date.now())
  const [ago, setAgo] = useState(0)
  // A failed poll used to stamp the badge "just now" all the same (the
  // `.then` ran on the `null` a failed reload resolves to).
  const [syncFailed, setSyncFailed] = useState(false)

  useEffect(() => {
    const refreshAll = () => {
      // `silent` so a background poll never flashes a loading state over a map
      // the operator is reading — the badge's age is the only thing that moves.
      void state.reload({ silent: true }).then(res => {
        if (res) { setLastSync(Date.now()); setSyncFailed(false) } else setSyncFailed(true)
      })
      void transits.reload({ silent: true })
      void staff.reload({ silent: true })
    }
    const refresh = setInterval(refreshAll, 60_000)
    // A check-in or check-out changes what is alongside; redraw on the event
    // instead of up to a minute later.
    const off = onSocket('movement:updated', refreshAll)
    return () => { clearInterval(refresh); off() }
    // `state`/`staff` are stable hook handles; re-subscribing on each render
    // would tear the interval down before it ever fired.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A separate, cheap tick so the badge counts up between fetches.
  useEffect(() => {
    const t = setInterval(() => setAgo(Math.round((Date.now() - lastSync) / 1000)), 1000)
    return () => clearInterval(t)
  }, [lastSync])

  const [sel, setSel] = useState<ApiBerthMapEntry | null>(null)
  const [filter, setFilter] = useState<string>('All')
  const [notifying, setNotifying] = useState(false)
  const [crewMsg, setCrewMsg] = useState('')
  const [sending, setSending] = useState(false)
  const [isFull, setIsFull] = useState(false)

  // Dock create modal state
  const [dockModalOpen, setDockModalOpen] = useState(false)

  // Berth create/edit modal states
  const [berthModalOpen, setBerthModalOpen] = useState(false)
  const [editingBerth, setEditingBerth] = useState<ApiBerthMapEntry | null>(null)
  const [initialDockForBerth, setInitialDockForBerth] = useState<string | undefined>(undefined)
  const [activePhoto, setActivePhoto] = useState<string | null>(null)

  const berths = state.data?.berths ?? []
  const pontoons = state.data?.pontoons ?? []
  const docks = useMemo(() => {
    const list = new Set<string>()
    pontoons.forEach(p => { if (p.code) list.add(p.code) })
    berths.forEach(b => { if (b.pontoon) list.add(b.pontoon) })
    return Array.from(list).filter(Boolean).sort()
  }, [berths, pontoons])

  const counts = useMemo(() => {
    const c: Record<string, number> = { available: 0, booked: 0, reserved: 0, maintenance: 0, blocked: 0 }
    berths.forEach(b => { c[b.status] = (c[b.status] ?? 0) + 1 })
    return c
  }, [berths])

  const hasFuelDock = !!marina?.facilities?.some(f => f.key === 'fuel' && f.available)

  // How many pontoons the marina really has
  const pontoonCount = docks.length
  const scrolls = harbourScrolls(pontoonCount)

  const openAddBerth = (targetDock?: string) => {
    setEditingBerth(null)
    setInitialDockForBerth(targetDock)
    setBerthModalOpen(true)
  }

  const openEditBerth = (b: ApiBerthMapEntry) => {
    setEditingBerth(b)
    setInitialDockForBerth(undefined)
    setBerthModalOpen(true)
  }

  const handleBerthSaved = async () => {
    const res = await state.reload()
    if (sel && res?.berths) {
      const refreshedSel = res.berths.find((b: ApiBerthMapEntry) => b.id === sel.id)
      if (refreshedSel) setSel(refreshedSel)
    }
  }

  /** Broadcasts a message to the marina's own staff, in their BoatPro chat. */
  const sendToCrew = async () => {
    const crew = (staff.data?.items ?? []).filter(m => m.isActive)
    if (!crew.length) {
      toast(translatePortalText('Add staff on the People page first — there is nobody to notify yet'), 'warn')
      return
    }
    if (!crewMsg.trim()) { toast(translatePortalText('Write a message for the crew'), 'warn'); return }
    setSending(true)
    // One member at a time, each on its own: the first failure used to abort
    // the loop and toast "could not reach the crew" after some had already been
    // messaged — so a retry messaged them twice.
    let sent = 0
    let failed = 0
    let firstError = ''
    try {
      for (const member of crew) {
        const user = personOf(member.user)
        const userId = idOf(user)
        if (!userId) continue
        try {
          const chat = await chatApi.create(userId)
          const chatId = idOf(chat.data.chat)
          if (!chatId) throw new Error('Could not open a crew conversation')
          await chatApi.send(chatId, crewMsg.trim())
          sent++
        } catch (e) {
          failed++
          firstError ||= e instanceof Error ? e.message : ''
        }
      }
      if (failed && sent) toast(translatePortalText(`Dock crew notified (${sent}) · ${failed} could not be reached`), 'warn')
      else if (failed) toast(translatePortalText(firstError || 'Could not reach the crew'), 'warn')
      else toast(translatePortalText(sent ? `Dock crew notified (${sent})` : 'Nobody to notify'), sent ? 'success' : 'warn')
      if (sent) setNotifying(false)
    } finally { setSending(false) }
  }

  return (
    <div className="space-y-4">
      {!isFull && (
        <PageHeader title={translatePortalText("Live Dock Monitoring")} icon={<RadioTower className="text-ocean-500" />}
          sub="Real-time marina map — berth status, boat locations & dock traffic. Click any slip for details."
          actions={
            <div className="flex items-center gap-2">
              {syncFailed ? (
                <span className="chip bg-amber-50 text-amber-700 ring-1 ring-amber-200">
                  {translatePortalText("Refresh failed — data from")} {translatePortalText(`${ago}s ago`)}
                </span>
              ) : (
                <span className="chip bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse-soft" /> {translatePortalText("LIVE · updated")}{' '}
                  {translatePortalText(ago < 5 ? 'just now' : `${ago}s ago`)}
                </span>
              )}
              <button className="btn-secondary flex items-center gap-1.5" onClick={() => setDockModalOpen(true)}>
                <Anchor size={15} /> {translatePortalText("Add Dock\r\n              ")}</button>
              <button className="btn-primary flex items-center gap-1.5" onClick={() => openAddBerth()}>
                <Plus size={16} /> {translatePortalText("Add Berth\r\n              ")}</button>
            </div>
          } />
      )}

      {/* legend / filter */}
      {!isFull && (
        <div className="mb-2 flex flex-wrap gap-2 items-center">
          <button onClick={() => setFilter('All')} className={`chip transition ${filter === 'All' ? 'bg-deep-900 text-white' : 'bg-white ring-1 ring-slate-200 text-slate-500 hover:ring-ocean-300'}`}>{translatePortalText("All · ")}{formatPortalNumber(berths.length)}</button>
          {Object.keys(STATUS_FILL).map(s => (
            <button key={s} onClick={() => setFilter(s)} className={`chip transition ${filter === s ? 'bg-deep-900 text-white' : 'bg-white ring-1 ring-slate-200 text-slate-500 hover:ring-ocean-300'}`}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_FILL[s] }} /> {translatePortalText(BERTH_LABELS[s])} · {counts[s] ?? 0}
            </button>
          ))}
          {scrolls && (
            <span className="chip ms-auto bg-ocean-50 text-ocean-700 ring-1 ring-ocean-200">
              <MoveHorizontal size={13} /> {pontoonCount} {translatePortalText("pontoons · scroll the chart sideways\r\n            ")}</span>
          )}
        </div>
      )}

      <AsyncBlock state={state} loadingLabel="Loading the dock map…"
        // Empty only when there is nothing to draw at all: a dock with no berths
        // yet still renders, with its "+ Add Berth to Dock" placeholder.
        empty={d => d.berths.length === 0 && d.pontoons.length === 0 ? { icon: '🅿️', text: 'No docks or berths yet — use “Add Dock” to lay out your first pontoon.' } : null}>
        {(data) => (
          /* ── Full Screen Marina Map ── */
          <motion.div initial={{ opacity: 0, scale: 0.99 }} animate={{ opacity: 1, scale: 1 }}
            className={isFull ? "fixed inset-0 z-[100] w-screen h-screen rounded-none bg-gradient-to-br from-[#0b3654] via-[#0e4a6e] to-[#1b6583] !m-0 !p-0" : "card relative overflow-hidden bg-gradient-to-br from-[#0b3654] via-[#0e4a6e] to-[#1b6583] shadow-lift border border-slate-700 !p-0"}>

            {/* Floating Top Controls */}
            <div className="absolute top-4 end-4 z-20 pointer-events-auto flex items-center gap-2">
              <button onClick={() => setDockModalOpen(true)}
                className="flex items-center gap-1.5 rounded-2xl bg-white/95 px-3.5 py-2 text-xs font-bold text-deep-900 shadow-lg backdrop-blur-md hover:bg-white transition border border-white/80">
                <Anchor size={14} className="text-ocean-600" /> {translatePortalText("Add Dock\r\n              ")}</button>
              <button onClick={() => openAddBerth()}
                className="flex items-center gap-1.5 rounded-2xl bg-ocean-600 px-3.5 py-2 text-xs font-bold text-white shadow-lg backdrop-blur-md hover:bg-ocean-700 transition border border-ocean-400">
                <Plus size={15} /> {translatePortalText("Add Berth\r\n              ")}</button>
              <button onClick={() => setIsFull(f => !f)}
                className="flex items-center gap-1.5 rounded-2xl bg-white/90 px-3.5 py-2 text-xs font-bold text-deep-900 shadow-lg backdrop-blur-md hover:bg-white transition border border-white/60">
                {isFull ? <Minimize2 size={16} className="text-ocean-600" /> : <Maximize2 size={16} className="text-ocean-600" />}
                {translatePortalText(isFull ? 'Exit full screen' : 'Full screen')}
              </button>
            </div>

            <div className="absolute inset-0 opacity-30 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 20% 30%, rgba(55,184,217,.35), transparent 45%), radial-gradient(circle at 80% 70%, rgba(16,185,129,.15), transparent 40%)' }} />
            <HarbourChart
              berths={data.berths.map(b => ({
                ...b,
                reservation: b.reservation && (b.reservation as any).isAlongside ? b.reservation : null
              }))}
              pontoons={pontoons}
              marinaName={data.marina.name}
              hasFuelDock={hasFuelDock}
              transits={(transits.data ?? []).map(m => ({
                id: m.id,
                boatName: m.boatName,
                boatType: (typeof m.subscription === 'object' && m.subscription?.boatType) || undefined,
                direction: m.direction,
                distanceNm: m.distanceNm,
              }))}
              selectedId={sel?.id ?? null}
              onPick={b => setSel(berths.find(x => x.id === b.id) ?? null)}
              onAddSlipClick={(targetDock) => openAddBerth(targetDock)}
              isDimmed={b => filter !== 'All' && b.status !== filter}
              onFuelClick={() => toast(marina?.facilities?.find(f => f.key === 'fuel')?.detail || translatePortalText('Fuel berth available at this marina'), 'info')}
              className={`relative z-10 w-full ${isFull ? 'h-screen' : 'h-[calc(100vh-240px)]'}`}
            />
          </motion.div>
        )}
      </AsyncBlock>

      {/* ── Selected Berth Modal (Opens on point click) ── */}
      <Modal open={Boolean(sel)} onClose={() => setSel(null)} title={sel ? translatePortalText(`⚓ Berth ${berthCode(sel)} Details`) : translatePortalText("Berth Details")}>
        {sel && (
          <div className="space-y-4">
            {sel.reservation && (
              <div className="relative overflow-hidden rounded-2xl">
                <Img src={boatPhoto(sel.reservation.boatName)} className="h-44 w-full object-cover" />
              </div>
            )}

            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display text-xl font-extrabold text-deep-900">{translatePortalText("Berth ")}{berthCode(sel)}</h3>
                <p className="text-xs text-slate-400">{translatePortalText(humanize(sel.category))} {translatePortalText("· Pontoon ")}{sel.pontoon}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge dot>{translatePortalText(BERTH_LABELS[sel.status])}</Badge>
                <button
                  onClick={() => openEditBerth(sel)}
                  className="btn-ghost !py-1.5 !px-3 text-xs font-bold text-ocean-600 hover:bg-ocean-50 hover:border-ocean-200 flex items-center gap-1"
                >
                  <Pencil size={13} /> {translatePortalText("Edit Berth\r\n                ")}</button>
              </div>
            </div>

            {/* Berth Photos Carousel / Gallery */}
            {sel.images && sel.images.length > 0 ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText("Berth Photos (")}{formatPortalNumber(sel.images.length)})</p>
                  <button
                    onClick={() => openEditBerth(sel)}
                    className="text-[11px] font-semibold text-ocean-600 hover:underline flex items-center gap-1"
                  >
                    <Camera size={12} /> {translatePortalText("Manage photos\r\n                  ")}</button>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1.5 scrollbar-thin">
                  {sel.images.map((imgUrl, i) => (
                    <div
                      key={i}
                      onClick={() => setActivePhoto(fileUrl(imgUrl))}
                      className="group relative h-20 w-28 shrink-0 cursor-pointer overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-200"
                    >
                      <img src={fileUrl(imgUrl)} alt="" className="h-full w-full object-cover transition group-hover:scale-105" />
                      <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition grid place-items-center text-white">
                        <Eye size={16} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between rounded-xl bg-sand/60 px-3.5 py-2.5 text-xs text-slate-500 border border-slate-100">
                <span className="flex items-center gap-2">
                  <Camera size={15} className="text-slate-400" /> {translatePortalText("No photos uploaded for this berth\r\n                ")}</span>
                <button
                  onClick={() => openEditBerth(sel)}
                  className="font-bold text-ocean-600 hover:underline text-[11px]"
                >
                  {translatePortalText("+ Add Photos\r\n                ")}</button>
              </div>
            )}

            {sel.reservation && (() => {
              const r = sel.reservation!
              const owner = personOf(r.subscriber)
              // The berth map hands back whatever reservation holds the berth —
              // an unanswered request, an unpaid lease, a lease whose boat has
              // not arrived. All of them were headed "Current Occupant".
              const alongside = (r as { isAlongside?: boolean }).isAlongside === true
              const heading = alongside
                ? 'Current Occupant'
                : r.status === 'active'
                  ? 'Berth held — boat not checked in'
                  : `Reservation · ${RESERVATION_LABELS[r.status] ?? humanize(r.status)}`
              // LOA is metres on the berth, feet on the booking.
              const boatM = r.lengthFt ? r.lengthFt * 0.3048 : null
              const tooLong = boatM != null && sel.maxLength != null && sel.maxLength > 0 && boatM > sel.maxLength
              return (
                <div className="rounded-2xl bg-sand p-3.5 border border-slate-100">
                  <div className="flex items-center gap-3">
                    <img src={fileUrl(owner?.avatar) ?? `https://ui-avatars.com/api/?name=${encodeURIComponent(owner?.name ?? r.boatName)}&background=e2e8f0&color=475569`}
                      className="h-12 w-12 rounded-full object-cover shadow-sm" alt="" />
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-400">{translatePortalText(heading)}</p>
                      <p className="text-sm font-bold text-deep-900">{r.boatName}</p>
                      <p className="text-xs text-slate-500">{owner?.name ?? r.plate} · {formatPortalNumber(r.lengthFt)} {translatePortalText("ft ")}{translatePortalText(boatTypeLabel(r.boatType))}</p>
                      {/* `totalSar` is riyals whatever the marina's display currency. */}
                      <p className="mt-0.5 text-[11px] text-slate-400">{fmtDate(r.startDate)} → {fmtDate(r.endDate)} · {formatMoney(r.totalSar, 'SAR')}</p>
                    </div>
                  </div>
                  {tooLong && (
                    <p className="mt-2 rounded-xl bg-amber-50 px-3 py-1.5 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">
                      {translatePortalText(`Boat length ${formatPortalNumber(Math.round(boatM! * 10) / 10)} m exceeds this berth's ${formatPortalNumber(sel.maxLength!)} m limit`)}
                    </p>
                  )}
                </div>
              )
            })()}

            {sel.workOrder && (
              <div className="rounded-2xl border border-amber-100 bg-amber-50/60 p-3.5">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-amber-600">{translatePortalText("Open work order")}</p>
                <p className="text-sm font-bold text-deep-900">{sel.workOrder.title}</p>
                <p className="text-xs text-slate-500">{sel.workOrder.code} · {translatePortalText(humanize(sel.workOrder.priority))} {translatePortalText("priority")}{sel.workOrder.dueDate ? ` · ${translatePortalText('Due')} ${fmtDate(sel.workOrder.dueDate)}` : ''}</p>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              {[
                ['Max length', sel.maxLength != null ? `${formatPortalNumber(sel.maxLength)} ${meterUnit()}` : '—'],
                ['Max beam', sel.maxWidth != null ? `${formatPortalNumber(sel.maxWidth)} ${meterUnit()}` : '—'],
                ['Max draft', sel.maxDepth != null ? `${formatPortalNumber(sel.maxDepth)} ${meterUnit()}` : '—'],
                ['Power', sel.powerSupply ?? '—'],
                ['Water', translatePortalText(sel.hasWater ? 'Yes 💧' : 'No')],
                ['Wi-Fi', translatePortalText(sel.hasWifi ? 'Yes 📶' : 'No')],
                ['Monthly rate', sel.monthlyPrice != null ? formatMoney(sel.monthlyPrice, currency) : '—'],
              ].map(([l, v]) => (
                <div key={l as string} className="rounded-xl border border-slate-100 bg-white p-3 text-center shadow-sm">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">{translatePortalText(l)}</p>
                  <p className="font-bold text-deep-900 text-xs">{v}</p>
                </div>
              ))}
            </div>

            {sel.notes && <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">{sel.notes}</p>}

            <div className="flex gap-2 pt-2">
              <button
                className="btn-secondary flex-1 justify-center text-xs flex items-center gap-1.5"
                onClick={() => openEditBerth(sel)}
              >
                <Pencil size={14} /> {translatePortalText("Edit Berth Specs & Photos\r\n              ")}</button>
              <button
                className="btn-primary flex-1 justify-center text-xs"
                onClick={() => { setCrewMsg(translatePortalText(`Attention crew: please attend berth ${berthCode(sel)}.`)); setNotifying(true) }}
              >
                {translatePortalText("Notify dock crew\r\n              ")}</button>
            </div>
          </div>
        )}
      </Modal>

      {/* Crew Notification Modal */}
      <Modal open={notifying} onClose={() => setNotifying(false)} title={translatePortalText(`📣 Notify dock crew${sel ? ` — berth ${berthCode(sel)}` : ''}`)}>
        <div className="space-y-4">
          <div>
            <label className="label">{translatePortalText("Message")}</label>
            <textarea className="input min-h-[88px]" value={crewMsg} onChange={e => setCrewMsg(e.target.value)} placeholder={translatePortalText("Message to the dock crew…")} />
          </div>
          <div>
            <label className="label">{translatePortalText("Quick actions")}</label>
            <div className="flex flex-wrap gap-2">
              {CREW_ACTIONS.map(a => (
                <button key={a} onClick={() => { const action = translatePortalText(a); setCrewMsg(m => (m.trim() ? `${m.trim()} ${action}.` : `${action}.`)) }}
                  className="chip bg-sand text-slate-600 ring-1 ring-slate-200 transition hover:bg-ocean-50 hover:text-ocean-700">{translatePortalText(a)}</button>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-slate-400">
            {translatePortalText("Goes to every active staff member's BoatPro chat\r\n            ")}{staff.data ? ` · ${translatePortalText(`${(staff.data.items ?? []).filter(m => m.isActive).length} on the crew`)}` : ''}.
          </p>
          <div className="flex justify-end">
            <button className="btn-primary" disabled={sending} onClick={sendToCrew}>{translatePortalText(sending ? 'Sending…' : 'Send to crew')}</button>
          </div>
        </div>
      </Modal>

      {/* Shared Berth Create/Edit Modal */}
      <BerthModal
        open={berthModalOpen}
        onClose={() => { setBerthModalOpen(false); setEditingBerth(null); setInitialDockForBerth(undefined) }}
        berth={editingBerth}
        pontoons={pontoons}
        docks={docks}
        initialDock={initialDockForBerth}
        berths={berths}
        onSaved={handleBerthSaved}
      />

      {/* Dock Create Modal */}
      <DockModal
        open={dockModalOpen}
        onClose={() => setDockModalOpen(false)}
        pontoons={pontoons}
        docks={docks}
        onSaved={async () => {
          await state.reload()
        }}
      />

      {/* Photo Lightbox */}
      {activePhoto && (
        <div
          className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setActivePhoto(null)}
        >
          <div className="relative max-h-[85vh] max-w-[90vw] overflow-hidden rounded-2xl bg-black" onClick={(e) => e.stopPropagation()}>
            <img src={activePhoto} alt={translatePortalText("Berth")} className="max-h-[80vh] max-w-[85vw] object-contain rounded-xl" />
            <button
              onClick={() => setActivePhoto(null)}
              className="absolute end-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white hover:bg-black/90 transition"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      {!isFull && berths.length === 0 && pontoons.length > 0 && state.data && <EmptyState icon="🅿️" text="No berths to plot yet" />}
    </div>
  )
}
