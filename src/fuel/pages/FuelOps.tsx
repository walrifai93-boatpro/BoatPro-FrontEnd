import React, { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CalendarDays, Check, X, Eye, Lock, Bell, CreditCard, CheckCircle2 } from 'lucide-react'
import {
  money, toBooking, BOOKING_ACTION,
  type BookingStatus, type FuelBooking,
} from '../fuelData'
import { fuelApi } from '../fuelApi'
import { useFuel, useFuelResource } from '../fuelStore'
import { Modal, SearchInput, EmptyState, LoadingState, ErrorState, LoadingButton, toast } from '../../ui'
import { FuelHeader, FBadge, Metric, FuelViewToggle } from '../fuelUi'
import { StationApprovalNotice, isStationUnapproved } from '../components/StationApprovalNotice'
import { formatPortalNumber, portalLocale, portalWeekdayLabels, translatePortalText } from '../../i18n/runtime'

/** Portal tab label → the backend status it filters on. */
const TAB_STATUS: Record<string, string | undefined> = {
  All: undefined,
  New: 'pending',
  Accepted: 'accepted',
  Scheduled: 'scheduled',
  'In progress': 'in_progress',
  Completed: 'completed',
  Cancelled: 'cancelled',
}

/** Turns the two free-text reschedule fields back into an ISO instant. */
function toIso(date: string, time: string, fallback?: string): string | undefined {
  const base = date.trim()
  if (!base) return fallback
  const parsed = new Date(`${base} ${time.trim() || '00:00'}`)
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  // "Jul 22" with no year — assume the current one.
  const withYear = new Date(`${base} ${new Date().getFullYear()} ${time.trim() || '00:00'}`)
  return Number.isNaN(withYear.getTime()) ? fallback : withYear.toISOString()
}

// ═════════════════════════════════════════════════════════════
// Fuel Booking Request
// ═════════════════════════════════════════════════════════════
export function FuelBookings() {
  const { fuelByKey, products, refresh, currentStationId, currentStation, isAllStations } = useFuel()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<FuelBooking | null>(null)
  const [calendar, setCalendar] = useState(false)
  const [view, setView] = useState<'card' | 'table'>('table')
  const [newOrder, setNewOrder] = useState(false)
  const [busy, setBusy] = useState(false)
  const [editDate, setEditDate] = useState('')
  const [editTime, setEditTime] = useState('')
  const [editReason, setEditReason] = useState('')

  const isUnapproved = !isAllStations && isStationUnapproved(currentStation)

  const [orderForm, setOrderForm] = useState({
    customer: '', email: '', boat: '', fuel: '', qty: '',
    location: '', date: '', time: '', emergency: false,
  })

  const res = useFuelResource(
    () => fuelApi.bookings({ status: 'pending', search: q || undefined, stationId: isAllStations ? undefined : currentStationId ?? undefined, limit: 100 }).then(r => r.data),
    [q, currentStationId, isAllStations],
  )

  const list = useMemo(() => (res.data?.items ?? []).map(toBooking), [res.data])

  const act = async (b: FuelBooking, status: string, msg: string) => {
    const action = BOOKING_ACTION[status]
    if (!action) return
    setBusy(true)
    try {
      await fuelApi.bookingAction(b.id, action)
      setSel(null)
      await res.reload()
      void refresh()
      toast(translatePortalText(msg))
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'That action could not be applied'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  const openDetails = (b: FuelBooking) => {
    setSel(b)
    setEditDate(b.date === '—' ? '' : b.date)
    setEditTime(b.time === '—' ? '' : b.time)
  }

  /**
   * Move the fill, or ask to.
   *
   * This used to always call `updateBooking` with a new `scheduledAt` and toast
   * "customer notified" — which rewrote a delivery the owner had planned around
   * and told them afterwards. Notifying is not asking.
   *
   * Where there is a customer ACCOUNT the change is now a proposal: the booking
   * keeps its time until they accept. A walk-in raised at the pump has nobody to
   * ask, so that keeps the direct edit — which is also exactly what the server
   * enforces, so the two cannot disagree.
   */
  const saveChanges = async () => {
    if (!sel) return
    const iso = toIso(editDate, editTime, sel.scheduledAt)
    setBusy(true)
    try {
      if (sel.customerId) {
        await fuelApi.proposeBookingReschedule(sel.id, {
          proposedStartAt: iso,
          reason: editReason.trim() || undefined,
        })
        toast(translatePortalText("Request sent. The fill keeps its time until the owner accepts."))
      } else {
        await fuelApi.updateBooking(sel.id, { scheduledAt: iso })
        toast(translatePortalText("Booking time updated"))
      }
      setSel(null)
      setEditReason('')
      await res.reload()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not save the change'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  const withdrawProposal = async () => {
    if (!sel) return
    setBusy(true)
    try {
      await fuelApi.withdrawBookingReschedule(sel.id)
      toast(translatePortalText("Request withdrawn. The original time stands."))
      setSel(null)
      await res.reload()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not withdraw the request'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  const submitNewOrder = async () => {
    if (isUnapproved) {
      toast(translatePortalText(`Cannot create orders on station "${currentStation?.name}" while it is awaiting admin approval`), 'warn')
      return
    }
    const qty = parseInt(orderForm.qty, 10) || 0
    const productKey = orderForm.fuel || products[0]?.key
    if (!productKey) { toast(translatePortalText("Add a fuel product first"), 'warn'); return }
    if (!orderForm.customer.trim() || !orderForm.boat.trim() || qty <= 0) {
      toast(translatePortalText("Enter customer, boat and quantity"), 'warn'); return
    }
    if (isAllStations) { toast(translatePortalText("Pick a specific station location before creating an order"), 'warn'); return }
    setBusy(true)
    try {
      const { data } = await fuelApi.createBooking({
        stationId: currentStationId ?? undefined,
        productKey,
        quantity: qty,
        customerName: orderForm.customer.trim(),
        customerEmail: orderForm.email.trim() || undefined,
        boatName: orderForm.boat.trim(),
        // Every order is filled here at the fuel dock — there is no delivery to choose.
        emergency: orderForm.emergency,
        location: orderForm.location.trim() || undefined,
        scheduledAt: toIso(orderForm.date, orderForm.time),
      })
      setNewOrder(false)
      setOrderForm({ customer: '', email: '', boat: '', fuel: '', qty: '', location: '', date: '', time: '', emergency: false })
      await res.reload()
      void refresh()
      toast(translatePortalText(`Order ${data.booking.bookingNo ?? ''} created`.trim()))
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not create the order'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  const quoted = (() => {
    const p = products.find(x => x.key === (orderForm.fuel || products[0]?.key))
    return (parseInt(orderForm.qty, 10) || 0) * (p?.price ?? 0)
  })()

  return (
    <div className="space-y-5">
      <FuelHeader title={translatePortalText("Fuel Booking Request")} sub={translatePortalText("Review new fuel booking requests and accept or reject them")}
        icon={<span className="text-2xl">📋</span>}
        actions={<>
          <FuelViewToggle view={view} onChange={setView} />
          <button className="btn-ghost" onClick={() => setCalendar(true)}><CalendarDays size={15} />{translatePortalText(" Booking calendar")}</button>
          <button
            className={`btn-fuel ${isUnapproved ? 'opacity-60 cursor-not-allowed' : ''}`}
            disabled={isUnapproved}
            title={isUnapproved ? translatePortalText('Station location is awaiting admin approval') : undefined}
            onClick={() => {
              if (isUnapproved) { toast(translatePortalText('Station is awaiting admin approval'), 'warn'); return }
              setNewOrder(true)
            }}
          >{translatePortalText("+ New order")}</button>
        </>} />

      <StationApprovalNotice />

      <div className="flex flex-wrap items-center gap-3">
        <div className="ms-auto"><SearchInput value={q} onChange={setQ} placeholder={translatePortalText("Search order, boat, customer…")} /></div>
      </div>

      {res.error ? <ErrorState error={translatePortalText(res.error)} onRetry={() => void res.reload()} />
        : res.loading && !res.data ? <LoadingState label={translatePortalText("Loading orders…")} rows={4} />
        : view === 'card' ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence mode="popLayout">
            {list.map((b, i) => {
              const f = fuelByKey(b.fuel)
              return (
                <motion.div layout key={b.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ delay: i * 0.04 }}
                  className={`card card-hover relative overflow-hidden p-4 ${b.emergency && b.status === 'New' ? 'ring-2 ring-rose-300' : ''}`}>
                  {b.emergency && b.status === 'New' && (
                    <span className="animate-flicker absolute end-3 top-3 rounded-full bg-rose-500 px-2.5 py-1 text-[10px] font-extrabold text-white">{translatePortalText("🚨 EMERGENCY")}</span>
                  )}
                  <div className="flex items-center gap-3">
                    <img src={b.avatar} className="h-11 w-11 rounded-full object-cover ring-2 ring-amber-100" />
                    <div className="min-w-0">
                      <p className="font-display text-[15px] font-extrabold text-deep-900">{b.boat} <span className="text-[11px] font-semibold text-slate-400">{b.boatLen}</span></p>
                      <p className="text-xs text-slate-400">{b.customer} · {b.ref}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2 rounded-xl p-2.5" style={{ background: `${f.color}14` }}>
                    <span className="text-xl">{f.icon}</span>
                    <div className="flex-1">
                      <p className="text-[13px] font-extrabold text-deep-900">{b.qty.toLocaleString(portalLocale())} {f.unit} · {f.name}</p>
                      <p className="text-[11px] text-slate-500">{translatePortalText(b.method)} · {b.location}</p>
                    </div>
                    <b className="font-display text-[15px]" style={{ color: f.color }}>{money(b.amount)}</b>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-500">🗓️ {b.date} · {b.time}</span>
                    <span className="flex gap-1.5"><FBadge>{b.priority}</FBadge><FBadge dot={b.status === 'In progress'}>{b.status}</FBadge></span>
                  </div>
                  <div className="mt-3.5 flex gap-2">
                    <button className="btn-fuel flex-1 !justify-center !py-2 text-xs" disabled={busy} onClick={() => act(b, 'Accepted', `${b.ref} accepted — customer notified`)}>{translatePortalText("Accept")}</button>
                    <button className="btn-ghost flex-1 !justify-center !py-2 text-xs !text-rose-500 hover:!bg-rose-50 hover:!border-rose-200" disabled={busy} onClick={() => act(b, 'Cancelled', `${b.ref} rejected`)}>{translatePortalText("Reject")}</button>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto custom-scrollbar">
            <div className="min-w-[980px]">
              <div className="grid grid-cols-[240px_220px_130px_130px_180px] items-center gap-4 border-b border-slate-100 bg-sand px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <span>{translatePortalText("Boat / customer")}</span><span>{translatePortalText("Order")}</span><span>{translatePortalText("Date")}</span><span>{translatePortalText("Amount")}</span><span className="text-right">{translatePortalText("Actions")}</span>
              </div>
              <AnimatePresence mode="popLayout">
                {list.map((b, i) => {
                  const f = fuelByKey(b.fuel)
                  return (
                    <motion.div layout key={b.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: i * 0.03 }}
                      className={`grid grid-cols-[240px_220px_130px_130px_180px] items-center gap-4 border-b border-slate-50 px-5 py-4 transition hover:bg-sand/70 last:border-b-0 ${b.emergency && b.status === 'New' ? 'bg-rose-50/40' : ''}`}>
                      <div className="flex items-center gap-3 min-w-0">
                        <img src={b.avatar} className="h-10 w-10 shrink-0 rounded-full object-cover ring-2 ring-amber-100" />
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 truncate text-[13px] font-extrabold text-deep-900">{b.boat} <span className="text-[11px] font-semibold text-slate-400">{b.boatLen}</span>{b.emergency && b.status === 'New' && <span className="shrink-0 rounded-full bg-rose-500 px-1.5 py-0.5 text-[9px] font-extrabold text-white">{translatePortalText("🚨 SOS")}</span>}</p>
                          <p className="truncate text-[11px] text-slate-400">{b.customer} · {b.ref}</p>
                        </div>
                      </div>
                      <div className="min-w-0 text-xs"><p className="flex items-center gap-1.5 truncate font-semibold text-deep-800"><span>{f.icon}</span>{b.qty.toLocaleString(portalLocale())} {f.unit} · {f.name}</p><p className="truncate text-[11px] text-slate-400">{translatePortalText(b.method)} · {b.location}</p></div>
                      <div className="text-xs text-slate-500 whitespace-nowrap">{b.date}<p className="text-[11px] text-slate-400">{b.time}</p></div>
                      <div className="font-display text-[13px] font-extrabold whitespace-nowrap" style={{ color: f.color }}>{money(b.amount)}</div>
                      <div className="flex justify-end gap-1.5 whitespace-nowrap">
                        <button className="btn-fuel px-3 py-1.5 text-[11px]" disabled={busy} onClick={() => act(b, 'Accepted', `Order ${b.ref} accepted`)}>{translatePortalText("Accept")}</button>
                        <button className="btn-ghost px-3 py-1.5 text-[11px] !text-rose-500 hover:!bg-rose-50" disabled={busy} onClick={() => act(b, 'Cancelled', `${b.ref} rejected`)}>{translatePortalText("Reject")}</button>
                      </div>
                    </motion.div>
                  )
                })}
              </AnimatePresence>
            </div>
          </div>
        </div>
      )}
      {!res.loading && list.length === 0 && <EmptyState icon="⛽" text={translatePortalText("No bookings match this filter")} />}

      {/* details / modify modal */}
      <Modal open={!!sel} onClose={() => setSel(null)} title={translatePortalText(`📋 Order ${sel?.ref}`)} wide>
        {sel && (
          <div className="space-y-4">
            <div className="flex items-center gap-4 rounded-2xl bg-sand p-4">
              <img src={sel.avatar} className="h-14 w-14 rounded-full object-cover" />
              <div className="flex-1">
                <p className="font-display text-lg font-extrabold text-deep-900">{sel.customer}</p>
                <p className="text-xs text-slate-400">{sel.boat} · {sel.boatLen} · {sel.location}</p>
              </div>
              <FBadge dot>{sel.status}</FBadge>
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Metric icon={fuelByKey(sel.fuel).icon} label={translatePortalText("Fuel")} value={fuelByKey(sel.fuel).name.split(' ')[0]} />
              <Metric icon="🔢" label={translatePortalText("Quantity")} value={`${sel.qty.toLocaleString(portalLocale())} ${fuelByKey(sel.fuel).unit}`} />
              <Metric icon="⚓" label={translatePortalText("Where")} value={translatePortalText(sel.method)} />
              <Metric icon="💵" label={translatePortalText("Amount")} value={money(sel.amount)} />
            </div>
            {sel.notes && <div className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs font-semibold text-amber-700">📝 {sel.notes}</div>}
            {/* The station's own outstanding ask. Without it, proposing is
                write-only — no sign you already asked, no way to take it back. */}
            {sel.rescheduleProposal?.status === 'pending' && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
                <p className="text-xs font-bold text-amber-900">{translatePortalText("Waiting on the owner")}</p>
                <p className="mt-1 text-sm font-semibold text-deep-900">
                  {new Date(sel.rescheduleProposal.proposedStartAt).toLocaleString(portalLocale())}
                </p>
                {sel.rescheduleProposal.reason && (
                  <p className="mt-1 text-xs text-slate-600">{sel.rescheduleProposal.reason}</p>
                )}
                <p className="mt-1.5 text-[11px] text-slate-500">{translatePortalText("The fill is still booked for its original time until they accept.")}</p>
                <button
                  type="button"
                  className="mt-2 text-xs font-bold text-amber-900 underline disabled:opacity-50"
                  disabled={busy}
                  onClick={withdrawProposal}
                >{translatePortalText("Withdraw request")}</button>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">{sel.customerId ? translatePortalText("Propose date") : translatePortalText("Reschedule date")}</label><input className="input" value={editDate} onChange={e => setEditDate(e.target.value)} /></div>
              <div><label className="label">{translatePortalText("Time slot")}</label><input className="input" value={editTime} onChange={e => setEditTime(e.target.value)} /></div>
            </div>
            {/* Only where there is somebody to ask. A walk-in has no account,
                so the change is a direct correction and a reason would be
                addressed to nobody. */}
            {sel.customerId && (
              <div>
                <label className="label">{translatePortalText("Why? ")}<span className="font-medium normal-case text-slate-400">{translatePortalText("(optional)")}</span></label>
                <textarea
                  className="input !h-auto"
                  rows={2}
                  maxLength={500}
                  value={editReason}
                  onChange={e => setEditReason(e.target.value)}
                  placeholder={translatePortalText("e.g. the fuel dock is closed for maintenance that morning")}
                />
                <p className="mt-1 text-[11px] text-slate-400">{translatePortalText("The booking keeps its current time until the owner accepts.")}</p>
              </div>
            )}
            <div className="flex gap-2">
              {/* Copy states which of the two this actually is. "Save changes"
                  on a proposal would claim an authority the station no longer has. */}
              <button className="btn-fuel flex-1 !justify-center" disabled={busy} onClick={saveChanges}>
                {sel.customerId ? translatePortalText("Ask the owner to move it") : translatePortalText("Save changes")}
              </button>
              {sel.status !== 'Completed' && sel.status !== 'Cancelled' &&
                <button className="btn-ghost !text-rose-500 hover:!bg-rose-50 hover:!border-rose-200" disabled={busy} onClick={() => act(sel, 'Cancelled', `${sel.ref} cancelled — refund issued`)}>{translatePortalText("Cancel booking")}</button>}
            </div>
          </div>
        )}
      </Modal>

      {/* calendar modal */}
      <BookingCalendarModal open={calendar} onClose={() => setCalendar(false)} />

      {/* new order modal */}
      <Modal open={newOrder} onClose={() => setNewOrder(false)} title={translatePortalText("⛽ New fuel order")}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">{translatePortalText("Customer name")}</label>
              <input className="input" placeholder={translatePortalText("Jane Cooper")} value={orderForm.customer} onChange={e => setOrderForm(s => ({ ...s, customer: e.target.value }))} /></div>
            <div><label className="label">{translatePortalText("Customer email ")}<span className="font-normal text-slate-400">{translatePortalText("(links their account)")}</span></label>
              <input className="input" placeholder={translatePortalText("jane@example.com")} value={orderForm.email} onChange={e => setOrderForm(s => ({ ...s, email: e.target.value }))} /></div>
            <div><label className="label">{translatePortalText("Boat name")}</label>
              <input className="input" placeholder={translatePortalText("Sea Breeze")} value={orderForm.boat} onChange={e => setOrderForm(s => ({ ...s, boat: e.target.value }))} /></div>
            <div><label className="label">{translatePortalText("Fuel type")}</label>
              <select className="input" value={orderForm.fuel} onChange={e => setOrderForm(s => ({ ...s, fuel: e.target.value }))}>
                {products.map(f => <option key={f.key} value={f.key}>{f.name}</option>)}
              </select></div>
            <div><label className="label">{translatePortalText("Quantity")}</label>
              <input className="input" type="number" placeholder="200" value={orderForm.qty} onChange={e => setOrderForm(s => ({ ...s, qty: e.target.value }))} /></div>
            <div><label className="label">{translatePortalText("Fuel dock / pump")}</label>
              <input className="input" placeholder={translatePortalText("Fuel Dock 1")} value={orderForm.location} onChange={e => setOrderForm(s => ({ ...s, location: e.target.value }))} /></div>
            <div><label className="label">{translatePortalText("Date")}</label>
              <input className="input" placeholder={translatePortalText("Jul 22")} value={orderForm.date} onChange={e => setOrderForm(s => ({ ...s, date: e.target.value }))} /></div>
            <div><label className="label">{translatePortalText("Time")}</label>
              <input className="input" placeholder="14:00" value={orderForm.time} onChange={e => setOrderForm(s => ({ ...s, time: e.target.value }))} /></div>
            <label className="flex items-center gap-2 self-end pb-2 text-xs font-bold text-rose-600">
              <input type="checkbox" checked={orderForm.emergency} onChange={e => setOrderForm(s => ({ ...s, emergency: e.target.checked }))} />{translatePortalText("🚨 Emergency request")}</label>
          </div>
          <div className="rounded-xl bg-sand p-3 text-xs text-slate-500">{translatePortalText("Estimated amount: ")}<b className="text-deep-900">{money(quoted)}</b>
            <p className="mt-1">{translatePortalText("The boat comes alongside your fuel dock — fuel is not delivered to berths.")}</p>
          </div>
          <LoadingButton loading={busy} className="btn-fuel w-full !justify-center !py-2.5" onClick={submitNewOrder}>{translatePortalText("Create order")}</LoadingButton>
        </div>
      </Modal>
    </div>
  )
}

/** The month grid the order desk opens from its toolbar. */
function BookingCalendarModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const now = new Date()
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const res = useFuelResource(() => (open ? fuelApi.calendar(month).then(r => r.data) : Promise.resolve(null)), [open, month])

  const byDay = useMemo(() => {
    const map = new Map<number, number>()
    for (const e of res.data?.events ?? []) {
      if (e.kind !== 'order') continue
      const day = new Date(e.date).getDate()
      map.set(day, (map.get(day) ?? 0) + 1)
    }
    return map
  }, [res.data])

  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const weekdays = portalWeekdayLabels()
  const title = `🗓️ Booking calendar — ${now.toLocaleDateString(portalLocale(), { month: 'long', year: 'numeric' })}`

  return (
    <Modal open={open} onClose={onClose} title={translatePortalText(title)} wide>
      <div className="grid grid-cols-7 gap-1.5 text-center text-xs">
        {weekdays.map((day, index) => <p key={index} className="pb-1 font-extrabold text-slate-400">{day}</p>)}
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => {
          const n = byDay.get(d) ?? 0
          const today = d === now.getDate()
          return (
            <button key={d} onClick={() => n && toast(translatePortalText(`${n} booking${n === 1 ? '' : 's'} on ${now.toLocaleDateString(portalLocale(), { month: 'short' })} ${d}`), 'info')}
              className={`relative aspect-square rounded-xl border text-[13px] font-bold transition ${today ? 'border-amber-400 bg-amber-50 text-amber-700' : n ? 'border-slate-100 bg-white hover:border-amber-300' : 'border-transparent bg-sand/60 text-slate-400'}`}>
              {formatPortalNumber(d)}
              {n > 0 && <span className="absolute bottom-1 left-1/2 flex -translate-x-1/2 gap-0.5">{Array.from({ length: Math.min(n, 3) }).map((_, j) => <span key={j} className="h-1 w-1 rounded-full bg-amber-500" />)}</span>}
            </button>
          )
        })}
      </div>
    </Modal>
  )
}

// ═════════════════════════════════════════════════════════════
// Fuel Booking Management
// ═════════════════════════════════════════════════════════════
export function FuelDeliveries() {
  const { fuelByKey, refresh, currentStationId, isAllStations } = useFuel()
  const [tab, setTab] = useState<'All' | Exclude<BookingStatus, 'New'>>('All')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<FuelBooking | null>(null)
  const [rescheduleDate, setRescheduleDate] = useState('')
  const [rescheduleTime, setRescheduleTime] = useState('')
  const [busy, setBusy] = useState(false)

  const res = useFuelResource(
    () => fuelApi.bookings({ status: TAB_STATUS[tab], search: q || undefined, stationId: isAllStations ? undefined : currentStationId ?? undefined, limit: 100 }).then(r => r.data),
    [tab, q, currentStationId, isAllStations],
  )

  const list = useMemo(() => {
    let items = (res.data?.items ?? []).map(toBooking)
    if (tab === 'All') items = items.filter(b => b.status !== 'New')
    return items
  }, [res.data, tab])
  const tabs = ['All', 'Accepted', 'Scheduled', 'In progress', 'Completed', 'Cancelled'] as const

  const openDetails = (b: FuelBooking) => {
    setSel(b)
    setRescheduleDate(b.date === '—' ? '' : b.date)
    setRescheduleTime(b.time === '—' ? '' : b.time)
  }

  const act = async (b: FuelBooking, status: string, msg: string) => {
    const action = BOOKING_ACTION[status]
    if (!action) return
    setBusy(true)
    try {
      await fuelApi.bookingAction(b.id, action)
      setSel(null)
      await res.reload()
      void refresh()
      toast(translatePortalText(msg))
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'That action could not be applied'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  const cancelBooking = async (b: FuelBooking) => {
    setBusy(true)
    try {
      await fuelApi.bookingAction(b.id, 'cancel')
      setSel(null)
      await res.reload()
      void refresh()
      toast(translatePortalText(`${b.ref} cancelled — refund issued`), 'warn')
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not cancel the booking'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  const saveChanges = async (b: FuelBooking) => {
    setBusy(true)
    try {
      await fuelApi.updateBooking(b.id, { scheduledAt: toIso(rescheduleDate, rescheduleTime, b.scheduledAt) })
      setSel(null)
      await res.reload()
      toast(translatePortalText("Booking modified — customer notified"))
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not save the change'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <FuelHeader title={translatePortalText("Fuel Booking Management")} sub={translatePortalText("All bookings — view details, reschedule or cancel")}
        icon={<span className="text-2xl">🗂️</span>} />

      <StationApprovalNotice />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1.5 rounded-2xl bg-white p-1.5 shadow-soft border border-slate-100">
          {tabs.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`relative rounded-xl px-3.5 py-1.5 text-xs font-bold transition ${tab === t ? 'text-white' : 'text-slate-500 hover:text-deep-900'}`}>
              {tab === t && <motion.span layoutId="fbm-tab" className="absolute inset-0 rounded-xl bg-gradient-to-r from-amber-600 to-orange-400" />}
              <span className="relative z-10">{translatePortalText(t)}</span>
            </button>
          ))}
        </div>
        <div className="ms-auto"><SearchInput value={q} onChange={setQ} placeholder={translatePortalText("Search order, boat, customer…")} /></div>
      </div>

      {res.error ? <ErrorState error={translatePortalText(res.error)} onRetry={() => void res.reload()} />
        : res.loading && !res.data ? <LoadingState label={translatePortalText("Loading bookings…")} rows={4} /> : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto custom-scrollbar">
            <div className="min-w-[1050px]">
              <div className="grid grid-cols-[240px_200px_120px_120px_140px_180px] items-center gap-4 border-b border-slate-100 bg-sand px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <span>{translatePortalText("Boat / customer")}</span><span>{translatePortalText("Order")}</span><span>{translatePortalText("Date")}</span><span>{translatePortalText("Amount")}</span><span>{translatePortalText("Status")}</span><span className="text-right">{translatePortalText("Actions")}</span>
              </div>
              <AnimatePresence mode="popLayout">
                {list.map((b, i) => {
                  const f = fuelByKey(b.fuel)
                  return (
                    <motion.div layout key={b.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: i * 0.03 }}
                      className="grid grid-cols-[240px_200px_120px_120px_140px_180px] items-center gap-4 border-b border-slate-50 px-5 py-4 transition hover:bg-sand/70 last:border-b-0">
                      <div className="flex items-center gap-3 min-w-0">
                        <img src={b.avatar} className="h-10 w-10 shrink-0 rounded-full object-cover ring-2 ring-amber-100" />
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-extrabold text-deep-900">{b.boat} <span className="text-[11px] font-semibold text-slate-400">{b.boatLen}</span></p>
                          <p className="truncate text-[11px] text-slate-400">{b.customer} · {b.ref}</p>
                        </div>
                      </div>
                      <div className="min-w-0 text-xs"><p className="flex items-center gap-1.5 truncate font-semibold text-deep-800"><span>{f.icon}</span>{b.qty.toLocaleString(portalLocale())} {f.unit} · {f.name}</p><p className="truncate text-[11px] text-slate-400">{translatePortalText(b.method)} · {b.location}</p></div>
                      <div className="text-xs text-slate-500 whitespace-nowrap">{b.date}<p className="text-[11px] text-slate-400">{b.time}</p></div>
                      <div className="font-display text-[13px] font-extrabold whitespace-nowrap" style={{ color: f.color }}>{money(b.amount)}</div>
                      <div className="whitespace-nowrap">
                        <FBadge dot={b.status === 'In progress'}>{b.status}</FBadge>
                        {b.paid && <span className="ms-1.5 inline-flex items-center gap-0.5 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[9px] font-extrabold text-emerald-700">{translatePortalText("✓ Paid")}</span>}
                      </div>
                      <div className="flex justify-end gap-1.5 whitespace-nowrap">
                        {b.status === 'Accepted' && <button className="btn-fuel !py-1.5 !px-2.5 !text-[11px]" disabled={busy} onClick={() => act(b, 'Scheduled', `Order ${b.ref} scheduled`)}>{translatePortalText("Schedule")}</button>}
                        {b.status === 'Scheduled' && <button className="btn-fuel !py-1.5 !px-2.5 !text-[11px]" disabled={busy} onClick={() => act(b, 'In progress', `Order ${b.ref} started`)}>{translatePortalText("Start")}</button>}
                        {b.status === 'In progress' && (
                          <button
                            className={`btn-fuel !py-1.5 !px-2.5 !text-[11px] ${!b.paid ? '!bg-amber-600 hover:!bg-amber-700' : '!bg-emerald-600 hover:!bg-emerald-700'}`}
                            disabled={busy || (!b.paid && b.amount > 0)}
                            title={translatePortalText(!b.paid && b.amount > 0 ? 'Customer payment required via HyperPay before the fill is completed' : undefined)}
                            onClick={() => act(b, 'Completed', `Order ${b.ref} completed`)}
                          >
                            {!b.paid && b.amount > 0 ? <span className="flex items-center gap-1"><Lock size={11} />{translatePortalText(" Complete")}</span> : translatePortalText("Complete")}
                          </button>
                        )}
                        <button className="btn-ghost !py-1.5 !px-2.5 !text-[11px]" onClick={() => openDetails(b)}><Eye size={12} />{translatePortalText(" View")}</button>
                      </div>
                    </motion.div>
                  )
                })}
              </AnimatePresence>
            </div>
          </div>
        </div>
      )}
      {!res.loading && list.length === 0 && <EmptyState icon="🗂️" text={translatePortalText("No bookings match this filter")} />}

      {/* details / manage modal */}
      <Modal open={!!sel} onClose={() => setSel(null)} title={translatePortalText(`📋 Order ${sel?.ref}`)} wide>
        {sel && (
          <div className="space-y-4">
            <div className="flex items-center gap-4 rounded-2xl bg-sand p-4">
              <img src={sel.avatar} className="h-14 w-14 rounded-full object-cover" />
              <div className="flex-1">
                <p className="font-display text-lg font-extrabold text-deep-900">{sel.customer}</p>
                <p className="text-xs text-slate-400">{sel.boat} · {sel.boatLen} · {sel.location}</p>
              </div>
              <FBadge dot>{sel.status}</FBadge>
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Metric icon={fuelByKey(sel.fuel).icon} label={translatePortalText("Fuel")} value={fuelByKey(sel.fuel).name.split(' ')[0]} />
              <Metric icon="🔢" label={translatePortalText("Quantity")} value={`${sel.qty.toLocaleString(portalLocale())} ${fuelByKey(sel.fuel).unit}`} />
              <Metric icon="⚓" label={translatePortalText("Where")} value={translatePortalText(sel.method)} />
              <Metric icon="💵" label={translatePortalText("Amount")} value={money(sel.amount)} />
            </div>

            {/* Payment Gate Banner if In Progress / Ready for Delivery */}
            {sel.status === 'In progress' && !sel.paid && sel.amount > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/90 p-3 text-xs text-amber-900 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-bold">
                    <CreditCard size={16} className="text-amber-700 shrink-0" />
                    <span>{translatePortalText("Awaiting Customer Payment (")}{money(sel.amount)})</span>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await fuelApi.sendBookingPaymentReminder(sel.id)
                        toast(translatePortalText("Payment reminder sent to boat provider mobile app!"), 'success')
                      } catch (err: any) {
                        toast(translatePortalText(err?.message || 'Could not send reminder'), 'warn')
                      }
                    }}
                    className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] font-extrabold text-white shadow-xs hover:bg-amber-700"
                  >
                    <Bell size={12} />{translatePortalText(" Send Payment Reminder")}</button>
                </div>
                <p className="mt-1 text-[11px] text-amber-700 font-medium">{translatePortalText("Completing the fill is locked until the customer pays ")}{money(sel.amount)}{translatePortalText(" via HyperPay in the app.")}</p>
              </div>
            )}

            {sel.paid && sel.amount > 0 && (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-2.5 text-xs font-bold text-emerald-800">
                <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                <span>{translatePortalText("Payment settled via HyperPay (")}{money(sel.amount)}{translatePortalText(") · The fill can be completed")}</span>
              </div>
            )}

            {sel.notes && <div className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs font-semibold text-amber-700">📝 {sel.notes}</div>}
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">{translatePortalText("Reschedule date")}</label><input className="input" value={rescheduleDate} onChange={e => setRescheduleDate(e.target.value)} /></div>
              <div><label className="label">{translatePortalText("Time slot")}</label><input className="input" value={rescheduleTime} onChange={e => setRescheduleTime(e.target.value)} /></div>
            </div>
            <div className="flex gap-2">
              {sel.status === 'Accepted' && <button className="btn-fuel flex-1 !justify-center" disabled={busy} onClick={() => act(sel, 'Scheduled', `Order ${sel.ref} scheduled`)}>{translatePortalText("Schedule")}</button>}
              {sel.status === 'Scheduled' && <button className="btn-fuel flex-1 !justify-center" disabled={busy} onClick={() => act(sel, 'In progress', `Order ${sel.ref} started`)}>{translatePortalText("Start fueling")}</button>}
              {sel.status === 'In progress' && (
                <button
                  className={`btn-fuel flex-1 !justify-center ${!sel.paid && sel.amount > 0 ? '!bg-amber-600 hover:!bg-amber-700' : '!bg-emerald-600 hover:!bg-emerald-700'}`}
                  disabled={busy || (!sel.paid && sel.amount > 0)}
                  title={translatePortalText(!sel.paid && sel.amount > 0 ? 'Customer payment required via HyperPay before the fill is completed' : undefined)}
                  onClick={() => act(sel, 'Completed', `Order ${sel.ref} completed`)}
                >
                  {!sel.paid && sel.amount > 0 ? (
                    <span className="flex items-center gap-1.5"><Lock size={13} />{translatePortalText(" Complete fill (Payment Required)")}</span>
                  ) : (
                    translatePortalText('Complete fill')
                  )}
                </button>
              )}
              <button className="btn-ghost flex-1 !justify-center" disabled={busy} onClick={() => saveChanges(sel)}>{translatePortalText("Save changes")}</button>
              {sel.status !== 'Completed' && sel.status !== 'Cancelled' &&
                <button className="btn-ghost !text-rose-500 hover:!bg-rose-50 hover:!border-rose-200" disabled={busy} onClick={() => cancelBooking(sel)}>{translatePortalText("Cancel booking")}</button>}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
