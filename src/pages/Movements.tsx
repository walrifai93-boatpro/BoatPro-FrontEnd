import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeftRight, Megaphone, FileText, ArrowUpRight, ArrowDownLeft, Plus } from 'lucide-react'
import { PageHeader, Badge, Section, Img, Modal, toast, Progress, SearchInput, ViewToggle, LoadingState, ErrorState } from '../ui'
import { boatPhoto } from '../images'
import { boatTypeLabel,
  useAsync, useMarina, useMarinaSettings, berthLabel, fmtDate, formatMoney, humanize, personOf,
} from '../live'
import { useOps } from '../opsStore'
import {
  chatApi, idOf, movementsApi, portalApi, post, reservationsApi, utilitiesApi, fileUrl,
  type ApiInvoice, type ApiMovement, type ApiReservation,
} from '../api'
import { confirm, confirmAndRun } from '../async'
import { onSocket } from '../socket'
import { TablePagination, useTableFilters, type TableFiltersConfig } from '../shared/TableFilters'
import { DateField } from '../components/SemanticFormControls'
import VendorLogoBadge from '../components/VendorLogoBadge'
import { formatPortalClock, formatPortalDate, formatPortalNumber, translatePortalText } from '../i18n/runtime'

/**
 * The marina's clock. Arrival and departure times are Riyadh time (B-07): the
 * board formatted them in the browser's zone, and the schedule form sent a bare
 * `2026-10-06T14:00:00`, which the server read in its own zone (UTC) — the same
 * three-hour slip B-07 fixed for paid arrivals, reintroduced for every movement
 * keyed in here, and for the departure the checkout creates.
 */
const MARINA_TZ = 'Asia/Riyadh'
const MARINA_OFFSET = '+03:00'
/** `YYYY-MM-DD` in the marina's day. */
const marinaDay = (value: string | Date = new Date()) => {
  const d = value instanceof Date ? value : new Date(value)
  return isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: MARINA_TZ }).format(d)
}
const fmtTime = (value?: string | null) =>
  value ? formatPortalDate(value, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: MARINA_TZ }) : '—'
/** "HH:MM" now, on the marina's clock. */
const marinaClock = () => new Intl.DateTimeFormat('en-GB', { timeZone: MARINA_TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())
/** A Riyadh wall-clock date + time as an instant the server cannot misread. */
const marinaInstant = (date: string, time: string) => `${date}T${time}:00${MARINA_OFFSET}`

type MovementQuery = Parameters<typeof movementsApi.list>[0]

/**
 * Every page of a movements query.
 *
 * The board asked for `date: 'all', limit: 100`. The server sorts movements
 * oldest-first and caps a page at 100, so from a marina's hundred-and-first
 * movement on, the board was built from the first hundred it ever logged:
 * new arrivals never appeared, and a boat checked in after that point never
 * reached the departures tab, because its check-in wasn't in the answer.
 */
async function listAllMovements(params: MovementQuery, maxPages = 10) {
  const items: ApiMovement[] = []
  let total = 0
  for (let page = 1; page <= maxPages; page++) {
    const query = { ...params, limit: 100, page }
    const res = await movementsApi.list(query)
    const batch = res.data.items ?? []
    items.push(...batch)
    total = res.data.pagination?.total ?? items.length
    if (!batch.length || items.length >= total) break
  }
  return { items, truncated: items.length < total }
}

/** Every active lease, not the newest hundred. */
async function listActiveReservations(maxPages = 10) {
  const items: ApiReservation[] = []
  for (let page = 1; page <= maxPages; page++) {
    const res = await reservationsApi.list({ status: 'active', limit: 100, page })
    const batch = res.data.items ?? []
    items.push(...batch)
    if (!batch.length || items.length >= (res.data.pagination?.total ?? items.length)) break
  }
  return { items }
}

/** The lease behind a movement, populated or not — `''` for single stays and visitors. */
const subIdOf = (m: ApiMovement): string =>
  typeof m.subscription === 'object' && m.subscription ? idOf(m.subscription) : String((m.subscription as string | undefined) ?? '')
/** The single-stay booking behind a movement, when there is one. */
const stayIdOf = (m: ApiMovement) =>
  typeof m.berthBooking === 'object' && m.berthBooking ? idOf(m.berthBooking) : (m.berthBooking ?? '')
/** A boat with no lease, as the board can recognise it again on its way out. */
const hullKey = (m: { boatName: string; plate?: string }) =>
  `${m.boatName.trim().toLowerCase()}|${(m.plate ?? '').replace(/[\s-]+/g, '').toLowerCase()}`
const atOf = (m: ApiMovement) => String(m.actualAt ?? m.scheduledAt)


function Step({ done, label, onClick, disabled }: { done: boolean; label: string; onClick?: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={done || disabled}
      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition ${done ? 'bg-emerald-50 text-emerald-700' : 'bg-sand text-slate-500 hover:bg-ocean-50 hover:text-ocean-700 disabled:opacity-50'}`}>
      <span className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full text-[8px] ${done ? 'bg-emerald-500 text-white' : 'border border-slate-300'}`}>{done ? '✓' : ''}</span>
      {translatePortalText(label)}
    </button>
  )
}

interface Charges { dock: number; utility: number; services: number; total: number }

export default function Movements() {
  const { currency } = useMarina()
  const settings = useMarinaSettings()
  const { reloadOverview } = useOps()

  const [activeTab, setActiveTab] = useState<'arrivals' | 'departures'>('arrivals')
  const [view, setView] = useState<'table' | 'card'>('table')
  const [q, setQ] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [invoice, setInvoice] = useState<{ reservation: ApiReservation | null; charges: Charges; invoice: ApiInvoice | null } | null>(null)
  const [scheduling, setScheduling] = useState(false)
  const [emailing, setEmailing] = useState(false)

  // Everything this board needs: movements, live berths, unbilled utilities and
  // completed services — so the checkout columns are real before check-out runs.
  //
  // Movements in two reads: everything still open (any date — an arrival from
  // last week that nobody closed is exactly what the desk must see), and the
  // check-ins and check-outs of the last 400 days, which is what decides who is
  // alongside now and fills the departure history.
  const moveState = useAsync(async () => {
    const since = new Date(Date.now() - 400 * 86_400_000).toISOString()
    const [open, closed] = await Promise.all([
      listAllMovements({ date: 'all', status: 'expected,en_route' }),
      listAllMovements({ status: 'checked_in,checked_out', from: since }),
    ])
    return { items: [...open.items, ...closed.items], truncated: open.truncated || closed.truncated }
  }, [])
  const resState = useAsync(() => listActiveReservations(), [])
  const utilState = useAsync(() => utilitiesApi.list({ billed: false, limit: 100 }).then(r => r.data), [])
  const svcState = useAsync(() => portalApi.serviceRequests({ status: 'completed', limit: 100 }).then(r => r.data), [])
  const staffState = useAsync(() => portalApi.staff().then(r => r.data), [])

  const movements = moveState.data?.items ?? []
  const reservations = resState.data?.items ?? []

  const refresh = async () => {
    await Promise.all([moveState.reload(), resState.reload(), utilState.reload(), svcState.reload()])
    await reloadOverview()
  }

  // Another member of staff checking a boat in or out used to leave this board
  // stale until somebody reloaded the page. Pick up the server's movement event
  // (it reaches the owner's session) and poll each minute for everyone else.
  useEffect(() => {
    const quiet = () => {
      void moveState.reload({ silent: true })
      void resState.reload({ silent: true })
      void utilState.reload({ silent: true })
    }
    const off = onSocket('movement:updated', quiet)
    const t = setInterval(quiet, 60_000)
    return () => { off(); clearInterval(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const match = (text: string) => text.toLowerCase().includes(q.trim().toLowerCase())

  /** Arrivals still to happen. */
  const arrivals = useMemo(
    () => movements.filter(m => m.direction === 'arrival' && (m.status === 'expected' || m.status === 'en_route'))
      .filter(m => match(`${m.boatName} ${m.plate ?? ''} ${berthLabel(m.pontoon, m.slot)} ${personOf(m.boater)?.name ?? ''}`))
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)),
    [movements, q],
  )

  /** Unbilled utilities, per reservation. */
  const utilityBySub = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of utilState.data?.items ?? []) {
      const sub = typeof r.subscription === 'object' && r.subscription ? idOf(r.subscription) : r.subscription
      if (typeof sub !== 'string' || !sub) continue
      map.set(sub, (map.get(sub) ?? 0) + r.amount)
    }
    return map
  }, [utilState.data])

  /** Completed services, per customer. */
  const serviceByCustomer = useMemo(() => {
    const map = new Map<string, number>()
    for (const b of svcState.data?.items ?? []) {
      // `idOf`, not `.id`: the populated customer is a User, whose JSON carries
      // `_id` only — so this map was always empty and Services always read 0.
      const who = typeof b.customer === 'object' && b.customer ? idOf(b.customer) : b.customer
      if (typeof who !== 'string' || !who) continue
      map.set(who, (map.get(who) ?? 0) + b.amount)
    }
    return map
  }, [svcState.data])

  const chargesFor = (r: ApiReservation): Charges => {
    const who = personOf(r.subscriber)
    const dock = r.totalSar
    const utility = utilityBySub.get(r.id) ?? 0
    const whoId = who ? idOf(who) : ''
    const services = whoId ? serviceByCustomer.get(whoId) ?? 0 : 0
    return { dock, utility, services, total: dock + utility + services }
  }

  /** Boats alongside: an active berth whose arrival has been checked in. */
  const departures = useMemo(() => {
    const checkedInSubs = new Set<string>()
    const bySub = new Map<string, ApiMovement[]>()
    
    for (const m of movements) {
      const subId = subIdOf(m)
      if (subId) {
        if (!bySub.has(subId)) bySub.set(subId, [])
        bySub.get(subId)!.push(m)
      }
    }

    for (const [subId, subMovements] of bySub.entries()) {
      const sorted = [...subMovements].sort((a, b) => String(b.actualAt ?? b.scheduledAt).localeCompare(String(a.actualAt ?? a.scheduledAt)))
      const latestArrival = sorted.find(m => m.direction === 'arrival' && m.status === 'checked_in')
      const latestDeparture = sorted.find(m => m.direction === 'departure' && m.status === 'checked_out')
      
      if (latestArrival) {
        const arrivalTime = String(latestArrival.actualAt ?? latestArrival.scheduledAt)
        const departureTime = latestDeparture ? String(latestDeparture.actualAt ?? latestDeparture.scheduledAt) : ''
        if (arrivalTime > departureTime) {
          checkedInSubs.add(subId)
        }
      }
    }
    return reservations
      .filter(r => checkedInSubs.has(r.id))
      .filter(r => match(`${r.boatName} ${r.plate} ${berthLabel(r.pontoon, r.slot)} ${personOf(r.subscriber)?.name ?? ''}`))
      .map(r => {
        const departure = movements.find(
          m => m.direction === 'departure' && subIdOf(m) === r.id &&
               m.status !== 'checked_out' && m.status !== 'cancelled' && m.status !== 'no_show',
        )
        return { reservation: r, departure, charges: chargesFor(r) }
      })
  }, [reservations, movements, q, utilityBySub, serviceByCustomer])

  /**
   * Boats alongside with no lease behind them: paid single stays and visitors
   * keyed in with "Schedule". The departures tab is built from leases, so these
   * were checked in on the arrivals tab and then appeared nowhere — no row, no
   * way to check them out, and a visitor departure scheduled by hand was
   * written to the server and never shown.
   */
  const otherAlongside = useMemo(() => {
    const lastIn = new Map<string, ApiMovement>()
    const lastOut = new Map<string, string>()
    for (const m of movements) {
      if (subIdOf(m)) continue
      const k = hullKey(m)
      if (m.direction === 'arrival' && m.status === 'checked_in') {
        const cur = lastIn.get(k)
        if (!cur || atOf(m) > atOf(cur)) lastIn.set(k, m)
      } else if (m.direction === 'departure' && m.status === 'checked_out') {
        if (atOf(m) > (lastOut.get(k) ?? '')) lastOut.set(k, atOf(m))
      }
    }
    return [...lastIn.values()]
      .filter(a => atOf(a) > (lastOut.get(hullKey(a)) ?? ''))
      .filter(a => match(`${a.boatName} ${a.plate ?? ''} ${berthLabel(a.pontoon, a.slot)} ${personOf(a.boater)?.name ?? ''}`))
      .map(arrival => ({
        arrival,
        departure: movements.find(m =>
          m.direction === 'departure' && !subIdOf(m) && (m.status === 'expected' || m.status === 'en_route') &&
          ((stayIdOf(arrival) && stayIdOf(m) === stayIdOf(arrival)) || hullKey(m) === hullKey(arrival))),
      }))
      .sort((a, b) => atOf(b.arrival).localeCompare(atOf(a.arrival)))
  }, [movements, q])

  /** Visitor departures keyed in by hand for a boat the board never saw arrive. */
  const orphanDepartures = useMemo(() => {
    const claimed = new Set(otherAlongside.map(r => r.departure?.id).filter(Boolean))
    return movements.filter(m =>
      m.direction === 'departure' && !subIdOf(m) && (m.status === 'expected' || m.status === 'en_route') &&
      !claimed.has(m.id) && !stayIdOf(m))
  }, [movements, otherAlongside])

  /** Everything that has already cleared out. */
  const history = useMemo(
    () => movements.filter(m => m.direction === 'departure' && m.status === 'checked_out')
      .sort((a, b) => String(b.actualAt ?? b.scheduledAt).localeCompare(String(a.actualAt ?? a.scheduledAt))),
    [movements],
  )
  // Paged: this table now holds a year of departures rather than the first hundred movements.
  const historyCfg: TableFiltersConfig<ApiMovement> = useMemo(() => ({
    searchFields: (m) => [m.boatName, m.plate, berthLabel(m.pontoon, m.slot)],
    defaultPageSize: 15,
    syncUrl: false,
  }), [])
  const historyTf = useTableFilters(history, historyCfg)

  const run = async (id: string, fn: () => Promise<unknown>, ok: string, tone: 'success' | 'warn' = 'success') => {
    setBusyId(id)
    try {
      await fn()
      toast(translatePortalText(ok), tone)
      await refresh()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'That action failed'), 'warn')
    } finally { setBusyId(null) }
  }

  // ── arrival flow ──
  const verify = (m: ApiMovement) =>
    run(m.id, () => movementsApi.update(m.id, { documentsVerified: true }), `${m.boatName}'s documents verified`)
  const security = (m: ApiMovement) =>
    run(m.id, () => movementsApi.update(m.id, { securityCleared: true }), 'Gate list updated — security cleared')
  const checkIn = async (m: ApiMovement) => {
    if (!m.documentsVerified || !m.securityCleared) return toast(translatePortalText('Verify documents & clear security first'), 'warn')
    // Checking in before the stay starts is allowed, but almost always means the
    // wrong row was clicked — the arrivals tab lists every future arrival too.
    const day = marinaDay(m.scheduledAt)
    if (day && day > marinaDay()) {
      const ok = await confirm({
        title: `Check in ${m.boatName} early?`,
        body: `This arrival is scheduled for ${fmtDate(m.scheduledAt)}. Checking in now marks the berth occupied from today.`,
        confirmLabel: 'Check in now',
      })
      if (!ok) return
    }
    const stayId = stayIdOf(m)
    let bookingNote = ''
    await run(m.id, async () => {
      // A paid single stay is checked in through its booking, which is what
      // marks the booking `checked_in`. Checking in the movement alone left the
      // booking `confirmed`, and its own check-out then refused with "Booking
      // must be checked in before checkout". The boat is at the dock either
      // way, so a refusal there doesn't stop the board — it is reported.
      if (stayId) {
        try { await post(`/berth-bookings/${stayId}/checkin`) } catch (e) { bookingNote = e instanceof Error ? e.message : 'unknown error' }
      }
      await movementsApi.checkIn(m.id)
    }, `${m.boatName} checked in at ${berthLabel(m.pontoon, m.slot)} ⚓ — moved to departures board`)
    if (bookingNote) toast(`${translatePortalText('Checked in on the board, but the booking itself was not updated:')} ${translatePortalText(bookingNote)}`, 'warn')
  }

  /** The boat never came. Takes it off the arrivals board; the lease itself is untouched. */
  const noShow = (m: ApiMovement) =>
    confirmAndRun({
      title: `Mark ${m.boatName} as a no-show?`,
      body: 'The arrival leaves the board. Any lease or booking behind it is not cancelled or refunded — do that from Reservations if the boat is not coming at all.',
      confirmLabel: 'Mark no-show',
      busyLabel: 'Saving…',
      danger: true,
      run: async () => { await movementsApi.noShow(m.id); await refresh() },
      success: `${m.boatName} marked as a no-show`,
    })
  const notifyCrew = async (m: ApiMovement) => {
    const crew = (staffState.data?.items ?? []).filter(s => s.isActive)
    if (!crew.length) { toast(translatePortalText('Add staff on the People page first — there is nobody to page'), 'warn'); return }
    setBusyId(m.id)
    try {
      let sent = 0
      for (const member of crew) {
        const user = personOf(member.user)
        const userId = idOf(user)
        if (!userId) continue
        const chat = await chatApi.create(userId)
        const chatId = idOf(chat.data.chat)
        if (!chatId) throw new Error('Could not open a crew conversation')
        await chatApi.send(chatId, translatePortalText(`${m.boatName} arriving ${fmtTime(m.scheduledAt)} → berth ${berthLabel(m.pontoon, m.slot)}. Please attend.`))
        sent++
      }
      toast(translatePortalText(`Dock staff paged for ${m.boatName} → ${berthLabel(m.pontoon, m.slot)}`), 'info')
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not page the crew'), 'warn')
    } finally { setBusyId(null) }
  }

  // ── departure flow ──
  /** Makes sure a departure movement exists for the stay, and returns it. */
  const ensureDeparture = async (row: { reservation: ApiReservation; departure?: ApiMovement }): Promise<ApiMovement> => {
    if (row.departure) return row.departure
    // Riyadh's today at the marina's check-out time, with the offset spelled out.
    const at = marinaInstant(marinaDay(), settings.checkOutTime)
    const res = await movementsApi.create({ subscriptionId: row.reservation.id, direction: 'departure', scheduledAt: at })
    return res.data.movement
  }

  const inspect = (row: { reservation: ApiReservation; departure?: ApiMovement }) =>
    run(row.reservation.id, async () => {
      const departure = await ensureDeparture(row)
      await movementsApi.update(departure.id, { securityCleared: true, documentsVerified: true })
    }, `Final inspection passed — ${row.reservation.boatName}`)

  const makeInvoice = (row: { reservation: ApiReservation; departure?: ApiMovement; charges: Charges }) =>
    run(row.reservation.id, async () => {
      let raised: ApiInvoice | null = null
      if (row.charges.utility > 0) {
        const res = await utilitiesApi.bill({ subscriptionId: row.reservation.id })
        raised = res.data.invoice
      }
      setInvoice({ reservation: row.reservation, charges: row.charges, invoice: raised })
    }, row.charges.utility > 0 ? 'Utilities invoiced' : 'Nothing left to invoice — statement shown')

  /**
   * Checks the boat out. Irreversible — it records the departure, freezes the
   * stay's charges and tells the boater they are cleared — so it now asks
   * first. The toast said "Berth released" too, but a lease that runs past
   * today keeps the berth reserved for its holder; only the boat has left.
   */
  const release = (row: { reservation: ApiReservation; departure?: ApiMovement; charges: Charges }) => {
    const r = row.reservation
    const berth = berthLabel(r.pontoon, r.slot)
    const leaseRunsOn = r.endDate > marinaDay()
    return confirmAndRun({
      title: `Check out ${r.boatName} from berth ${berth}?`,
      body: leaseRunsOn
        ? `The boat leaves the departures board and the boater is told they are cleared to depart. The lease runs to ${fmtDate(r.endDate)}, so the berth stays reserved for them. This cannot be undone.`
        : 'The boat leaves the departures board and the boater is told they are cleared to depart. This cannot be undone.',
      confirmLabel: 'Check out',
      busyLabel: 'Checking out…',
      run: async () => {
        setBusyId(r.id)
        try {
          const departure = await ensureDeparture(row)
          await movementsApi.checkOut(departure.id)
          await refresh()
        } finally { setBusyId(null) }
      },
      success: leaseRunsOn
        ? `${r.boatName} checked out — berth ${berth} stays reserved until ${fmtDate(r.endDate)}`
        : `Berth ${berth} released — safe travels ${r.boatName}! 🌊`,
    })
  }

  /** Checks out a single stay or visitor — the rows the lease-based list never had. */
  const releaseOther = (row: { arrival: ApiMovement; departure?: ApiMovement }) => {
    const a = row.arrival
    const stayId = stayIdOf(a)
    return confirmAndRun({
      title: `Check out ${a.boatName}?`,
      body: 'The departure is recorded and the boater is told they are cleared to depart. This cannot be undone.',
      confirmLabel: 'Check out',
      busyLabel: 'Checking out…',
      run: async () => {
        setBusyId(a.id)
        let bookingNote = ''
        try {
          // A paid single stay closes through its booking, which also closes
          // its own departure movement; anything else needs one to check out.
          if (stayId) {
            try { await post(`/berth-bookings/${stayId}/checkout`) } catch (e) { bookingNote = e instanceof Error ? e.message : 'unknown error' }
          }
          const departure = row.departure ?? (stayId && !bookingNote ? null : (await movementsApi.create({
            direction: 'departure',
            boatName: a.boatName,
            plate: a.plate || undefined,
            scheduledAt: marinaInstant(marinaDay(), marinaClock()),
          })).data.movement)
          // Idempotent server-side: a departure the booking already closed is returned as-is.
          if (departure) await movementsApi.checkOut(departure.id)
          await refresh()
        } finally { setBusyId(null) }
        if (bookingNote) toast(`${translatePortalText('Checked out on the board, but the booking itself was not updated:')} ${translatePortalText(bookingNote)}`, 'warn')
      },
      success: `${a.boatName} checked out`,
    })
  }

  /** A visitor departure keyed in by hand, for a boat whose arrival was never logged. */
  const releaseOrphan = (m: ApiMovement) =>
    confirmAndRun({
      title: `Check out ${m.boatName}?`,
      body: 'The departure is recorded. This cannot be undone.',
      confirmLabel: 'Check out',
      busyLabel: 'Checking out…',
      run: async () => { await movementsApi.checkOut(m.id); await refresh() },
      success: `${m.boatName} checked out`,
    })

  const loading = (moveState.loading && !moveState.data) || (resState.loading && !resState.data)
  if (loading) return <LoadingState label="Loading the movements board…" rows={5} />
  if (moveState.error && !moveState.data) return <ErrorState error={moveState.error} onRetry={moveState.reload} />
  if (resState.error && !resState.data) return <ErrorState error={resState.error} onRetry={resState.reload} />

  // A failed side read used to leave its column at 0 — "no utilities owed" —
  // with nothing to say the number was missing rather than zero.
  const chargesMissing = (!!utilState.error && !utilState.data) || (!!svcState.error && !svcState.data)

  return (
    <div className="space-y-5">
      <PageHeader
        title={translatePortalText("Arrivals & Departures")}
        icon={<ArrowLeftRight className="text-ocean-500" />}
        sub={translatePortalText(`Check-in flow, security clearance, checkout & berth release — check-in from ${formatPortalClock(settings.checkInTime)}, check-out by ${formatPortalClock(settings.checkOutTime)}`)}
        actions={
          <div className="flex items-center gap-2">
            <ViewToggle view={view} onChange={setView} />
            <button className="btn-primary" onClick={() => setScheduling(true)}><Plus size={15} /> {translatePortalText("Schedule")}</button>
            <SearchInput value={q} onChange={setQ} placeholder={translatePortalText("Search vessel, guest or berth...")} />
          </div>
        }
      />

      {chargesMissing && (
        <div className="rounded-2xl bg-amber-50 px-4 py-3 text-[13px] text-amber-800 ring-1 ring-amber-200">
          {translatePortalText("Utility or service charges could not be loaded — the checkout columns may read 0 when they are not.")}{' '}
          <button className="font-bold underline underline-offset-2" onClick={() => { void utilState.reload(); void svcState.reload() }}>{translatePortalText("Retry")}</button>
        </div>
      )}

      {/* ── Main Two Tabs ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setActiveTab('arrivals')}
            className={`flex items-center gap-2 rounded-2xl px-5 py-2.5 text-sm font-extrabold transition ${activeTab === 'arrivals' ? 'bg-deep-900 text-white shadow-soft ring-2 ring-deep-900/10' : 'bg-white text-slate-500 ring-1 ring-slate-200 hover:ring-ocean-300'}`}>
            <ArrowDownLeft size={17} className={activeTab === 'arrivals' ? 'text-ocean-400' : 'text-slate-400'} />
            {translatePortalText("⚓ Upcoming Arrivals\r\n            ")}<span className={`rounded-full px-2 py-0.5 text-xs font-black ${activeTab === 'arrivals' ? 'bg-ocean-400 text-deep-950' : 'bg-slate-100 text-slate-600'}`}>{formatPortalNumber(arrivals.length)}</span>
          </button>
          <button onClick={() => setActiveTab('departures')}
            className={`flex items-center gap-2 rounded-2xl px-5 py-2.5 text-sm font-extrabold transition ${activeTab === 'departures' ? 'bg-deep-900 text-white shadow-soft ring-2 ring-deep-900/10' : 'bg-white text-slate-500 ring-1 ring-slate-200 hover:ring-violet-300'}`}>
            <ArrowUpRight size={17} className={activeTab === 'departures' ? 'text-violet-400' : 'text-slate-400'} />
            {translatePortalText("🛫 Departures & Checkout\r\n            ")}<span className={`rounded-full px-2 py-0.5 text-xs font-black ${activeTab === 'departures' ? 'bg-violet-400 text-deep-950' : 'bg-slate-100 text-slate-600'}`}>{formatPortalNumber(departures.length + otherAlongside.length + orphanDepartures.length)}</span>
          </button>
        </div>
      </div>

      {/* ── TAB 1: ARRIVALS ── */}
      {activeTab === 'arrivals' && (
        <div className="space-y-4">
          {arrivals.length === 0 && (
            <div className="card py-12 text-center text-sm text-slate-400">
              <p className="text-2xl mb-1">⚓</p>
              <p className="font-bold text-slate-600">{translatePortalText("No arrivals on the board")}</p>
              <p>{translatePortalText("Paying for a berth schedules its arrival automatically — or add one with “Schedule”.")}</p>
            </div>
          )}
          {arrivals.length > 0 && view === 'table' ? (
            <div className="card overflow-hidden !p-0 shadow-lift border border-slate-200">
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full min-w-[950px] text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-sand/60 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                      <th className="py-3.5 px-4">{translatePortalText("Vessel & Guest")}</th><th className="py-3.5 px-4">{translatePortalText("ETA")}</th><th className="py-3.5 px-4">{translatePortalText("Berth Slip")}</th>
                      <th className="py-3.5 px-4">{translatePortalText("Vessel Specs")}</th><th className="py-3.5 px-4">{translatePortalText("Progress")}</th><th className="py-3.5 px-4">{translatePortalText("Check-in Flow")}</th><th className="py-3.5 px-4 text-right">{translatePortalText("Notify")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {arrivals.map((m, i) => {
                      const who = personOf(m.boater)
                      const sub = typeof m.subscription === 'object' ? m.subscription : null
                      const steps = [m.documentsVerified, m.securityCleared].filter(Boolean).length
                      return (
                        <motion.tr key={m.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i * 0.03, 0.4) }} className="transition hover:bg-ocean-50/40">
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-3">
                              <VendorLogoBadge logoUrl={(m as any).boatLogo || (m as any).providerLogo || who?.avatar} name={m.boatName} role="boat_provider" size="md" />
                              <div><p className="font-bold text-deep-900">{m.boatName}</p><p className="text-[11px] text-slate-400">{who?.name ?? m.plate ?? '—'}{sub?.reservationNo ? ` · ${sub.reservationNo}` : ''}</p></div>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <p className="font-display font-extrabold text-sm text-ocean-600">{fmtTime(m.scheduledAt)}</p>
                            <p className="text-[10px] text-slate-400 font-bold uppercase">
              {m.status === 'en_route' ? (m.distanceNm != null ? translatePortalText(`${m.distanceNm} nm out`) : translatePortalText('En route')) : fmtDate(m.scheduledAt)}
                            </p>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap"><span className="inline-block rounded-xl bg-ocean-50 px-3 py-1 text-xs font-extrabold text-ocean-700 border border-ocean-200">{translatePortalText("Berth ")}{berthLabel(m.pontoon, m.slot)}</span></td>
                          <td className="py-3 px-4 font-medium text-slate-600">{sub?.boatType ? translatePortalText(boatTypeLabel(sub.boatType)) : (m.plate ?? '—')}</td>
                          <td className="py-3 px-4 w-36">
                            <Progress pct={(steps / 2) * 100} tone={steps === 2 ? 'bg-emerald-500' : 'bg-ocean-500'} />
                            <p className="text-[10px] font-bold text-slate-400 mt-1">{steps} {translatePortalText("of 2 checks done")}</p>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Step done={m.documentsVerified} label="Verify" disabled={busyId === m.id} onClick={() => verify(m)} />
                              <Step done={m.securityCleared} label="Security" disabled={busyId === m.id} onClick={() => security(m)} />
                              <button onClick={() => checkIn(m)} disabled={busyId === m.id}
                                className="flex items-center gap-1.5 rounded-lg bg-deep-900 px-2.5 py-1.5 text-[11px] font-bold text-white transition hover:bg-deep-800 disabled:opacity-50">{translatePortalText("⚓ Check in")}</button>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-slate-500 bg-sand hover:bg-ocean-50 hover:text-ocean-700"
                                disabled={busyId === m.id} onClick={() => notifyCrew(m)}><Megaphone size={13} /> {translatePortalText("Crew")}</button>
                              <button className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-rose-500 bg-rose-50 hover:bg-rose-100 disabled:opacity-50"
                                disabled={busyId === m.id} onClick={() => noShow(m)}>{translatePortalText("No-show")}</button>
                            </div>
                          </td>
                        </motion.tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : arrivals.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2">
              {arrivals.map((m, i) => {
                const who = personOf(m.boater)
                const sub = typeof m.subscription === 'object' ? m.subscription : null
                const steps = [m.documentsVerified, m.securityCleared].filter(Boolean).length
                return (
                  <motion.div key={m.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} className="card p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <Img src={boatPhoto(m.boatName)} className="h-12 w-12 shrink-0 rounded-2xl" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-base font-extrabold text-deep-900">{m.boatName} <span className="font-medium text-slate-400">· {who?.name ?? m.plate ?? ''}</span></p>
                        <p className="truncate text-xs text-slate-400">{sub?.boatType ? translatePortalText(boatTypeLabel(sub.boatType)) : ''} {translatePortalText("· berth ")}<b className="text-deep-800">{berthLabel(m.pontoon, m.slot)}</b></p>
                      </div>
                      <div className="shrink-0 text-right"><p className="font-display text-lg font-extrabold text-ocean-600">{fmtTime(m.scheduledAt)}</p><p className="text-[10px] font-bold uppercase text-slate-400">{translatePortalText("ETA")}</p></div>
                    </div>
                    <Progress pct={(steps / 2) * 100} tone={steps === 2 ? 'bg-emerald-500' : 'bg-ocean-500'} />
                    <div className="flex flex-wrap items-center gap-2">
                      <Step done={m.documentsVerified} label="Verify" disabled={busyId === m.id} onClick={() => verify(m)} />
                      <Step done={m.securityCleared} label="Security" disabled={busyId === m.id} onClick={() => security(m)} />
                      <button onClick={() => checkIn(m)} disabled={busyId === m.id} className="rounded-lg bg-deep-900 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-deep-800 disabled:opacity-50">{translatePortalText("⚓ Check in")}</button>
                      <button className="ms-auto btn-ghost !py-1 text-xs" disabled={busyId === m.id} onClick={() => notifyCrew(m)}><Megaphone size={13} /> {translatePortalText("Notify crew")}</button>
                      <button className="btn-ghost !py-1 text-xs text-rose-500" disabled={busyId === m.id} onClick={() => noShow(m)}>{translatePortalText("No-show")}</button>
                    </div>
                  </motion.div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── TAB 2: DEPARTURES ── */}
      {activeTab === 'departures' && (
        <div className="space-y-4">
          {departures.length === 0 && otherAlongside.length === 0 && orphanDepartures.length === 0 && (
            <div className="card py-12 text-center text-sm text-slate-400">
              <p className="text-2xl mb-1">🛫</p>
              <p className="font-bold text-slate-600">{translatePortalText("No vessels currently berthed")}</p>
              <p>{translatePortalText("Check in an arrival to enable its checkout here.")}</p>
            </div>
          )}
          {departures.length > 0 && view === 'table' ? (
            <div className="card overflow-hidden !p-0 shadow-lift border border-slate-200">
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full min-w-[1000px] text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-sand/60 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                      <th className="py-3.5 px-4">{translatePortalText("Vessel & Guest")}</th><th className="py-3.5 px-4">{translatePortalText("ETD")}</th><th className="py-3.5 px-4">{translatePortalText("Berth")}</th>
                      <th className="py-3.5 px-4 text-right">{translatePortalText("Berthing")}</th><th className="py-3.5 px-4 text-right">{translatePortalText("Utilities")}</th><th className="py-3.5 px-4 text-right" title={translatePortalText("Every completed service this guest has had at the marina — the same figure check-out records")}>{translatePortalText("Services")}</th>
                      <th className="py-3.5 px-4 text-right" title={translatePortalText("Berthing contract (already paid) + unbilled utilities + services — not an amount due")}>{translatePortalText("Total")}</th><th className="py-3.5 px-4">{translatePortalText("Status")}</th><th className="py-3.5 px-4 text-right">{translatePortalText("Checkout Flow")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {departures.map((row, i) => {
                      const r = row.reservation
                      const who = personOf(r.subscriber)
                      const d = row.departure
                      const inspected = !!d?.securityCleared
                      const invoiced = row.charges.utility === 0
                      const released = d?.status === 'checked_out'
                      return (
                        <motion.tr key={r.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i * 0.03, 0.4) }} className="transition hover:bg-violet-50/30">
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-3">
                              <Img src={boatPhoto(r.boatName)} className="h-10 w-10 shrink-0 rounded-xl object-cover ring-1 ring-slate-200" />
                              <div><p className="font-bold text-deep-900">{r.boatName}</p><p className="text-[11px] text-slate-400">{who?.name ?? r.plate} · {r.reservationNo}</p></div>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <p className="font-display font-extrabold text-sm text-violet-600">{d ? fmtTime(d.scheduledAt) : formatPortalClock(settings.checkOutTime)}</p>
                            <p className="text-[10px] text-slate-400 font-bold uppercase">{d ? translatePortalText('Scheduled') : translatePortalText(`contract to ${fmtDate(r.endDate)}`)}</p>
                            {/* Still alongside after the lease ended — the sweep keeps these live
                                so the berth isn't resold under the boat; the desk should know. */}
                            {r.endDate < marinaDay() && (
                              <span className="mt-1 inline-block rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-600 ring-1 ring-rose-200">{translatePortalText(`Overstay since ${fmtDate(r.endDate)}`)}</span>
                            )}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap"><span className="inline-block rounded-xl bg-violet-50 px-3 py-1 text-xs font-extrabold text-violet-700 border border-violet-200">{translatePortalText("Berth ")}{berthLabel(r.pontoon, r.slot)}</span></td>
                          <td className="py-3 px-4 text-right font-semibold text-slate-600">{formatMoney(row.charges.dock, currency)}</td>
                          <td className="py-3 px-4 text-right font-semibold text-slate-600">{formatMoney(row.charges.utility, currency)}</td>
                          <td className="py-3 px-4 text-right font-semibold text-slate-600">{formatMoney(row.charges.services, currency)}</td>
                          <td className="py-3 px-4 text-right font-display font-extrabold text-sm text-deep-900">{formatMoney(row.charges.total, currency)}</td>
                          <td className="py-3 px-4"><Badge>{translatePortalText(released ? 'Completed' : invoiced && inspected ? 'Invoiced' : inspected ? 'Inspected' : 'Berthed')}</Badge></td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <Step done={inspected} label="Inspection" disabled={busyId === r.id} onClick={() => inspect(row)} />
                              <Step done={invoiced} label="Invoice" disabled={busyId === r.id} onClick={() => makeInvoice(row)} />
                              <Step done={released} label="Release berth" disabled={busyId === r.id || !inspected} onClick={() => void release(row)} />
                            </div>
                          </td>
                        </motion.tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : departures.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2">
              {departures.map((row, i) => {
                const r = row.reservation
                const who = personOf(r.subscriber)
                const d = row.departure
                const inspected = !!d?.securityCleared
                const invoiced = row.charges.utility === 0
                const released = d?.status === 'checked_out'
                return (
                  <motion.div key={r.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} className="card p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <Img src={boatPhoto(r.boatName)} className="h-12 w-12 shrink-0 rounded-2xl" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-base font-extrabold text-deep-900">{r.boatName} <span className="font-medium text-slate-400">· {who?.name ?? r.plate}</span></p>
                        <p className="truncate text-xs text-slate-400">{translatePortalText("berth ")}{berthLabel(r.pontoon, r.slot)} {translatePortalText("· departs ")}<b className="text-violet-600">{d ? fmtTime(d.scheduledAt) : formatPortalClock(settings.checkOutTime)}</b></p>
                        {r.endDate < marinaDay() && <p className="text-[10px] font-bold text-rose-600">{translatePortalText(`Overstay since ${fmtDate(r.endDate)}`)}</p>}
                      </div>
                      <Badge>{translatePortalText(released ? 'Completed' : invoiced && inspected ? 'Invoiced' : inspected ? 'Inspected' : 'Berthed')}</Badge>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5 text-center text-[11px]">
                      {[['Berthing', row.charges.dock], ['Utilities', row.charges.utility], ['Services', row.charges.services], ['Total', row.charges.total]].map(([l, v], j) => (
                        <div key={l as string} className={`rounded-lg py-1.5 ${j === 3 ? 'bg-deep-900 text-white' : 'bg-sand'}`}>
                          <p className={`font-display font-extrabold ${j === 3 ? '' : 'text-deep-900'}`}>{formatMoney(v as number, currency, { compact: true })}</p>
                          <p className={j === 3 ? 'text-white/60' : 'text-slate-400'}>{l}</p>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      <Step done={inspected} label="Inspection" disabled={busyId === r.id} onClick={() => inspect(row)} />
                      <Step done={invoiced} label="Invoice" disabled={busyId === r.id} onClick={() => makeInvoice(row)} />
                      <Step done={released} label="Release berth" disabled={busyId === r.id || !inspected} onClick={() => void release(row)} />
                    </div>
                  </motion.div>
                )
              })}
            </div>
          )}

          {/* Single stays and visitors alongside — no lease, so not in the list above. */}
          {(otherAlongside.length > 0 || orphanDepartures.length > 0) && (
            <div className="card overflow-hidden !p-0 border border-slate-200">
              <div className="border-b border-slate-100 bg-sand/60 px-4 py-3">
                <p className="text-sm font-extrabold text-deep-900">{translatePortalText("Single stays & visitors alongside")}</p>
                <p className="text-[11px] text-slate-400">{translatePortalText("Boats checked in without a berth lease. Their charges are settled on their own booking, not on this board.")}</p>
              </div>
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full min-w-[700px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                      <th className="py-3 px-4">{translatePortalText("Vessel & Guest")}</th><th className="py-3 px-4">{translatePortalText("Checked in")}</th>
                      <th className="py-3 px-4">{translatePortalText("Berth")}</th><th className="py-3 px-4">{translatePortalText("ETD")}</th><th className="py-3 px-4 text-right">{translatePortalText("Checkout Flow")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {otherAlongside.map(({ arrival: a, departure: d }) => {
                      const stay = typeof a.berthBooking === 'object' && a.berthBooking ? a.berthBooking : null
                      return (
                        <tr key={a.id} className="transition hover:bg-violet-50/30">
                          <td className="py-2.5 px-4">
                            <p className="font-bold text-deep-900">{a.boatName}</p>
                            <p className="text-[11px] text-slate-400">{personOf(a.boater)?.name ?? a.plate ?? '—'}{stay ? ` · ${stay.bookingRef}` : ` · ${translatePortalText('Visitor')}`}</p>
                          </td>
                          <td className="py-2.5 px-4 text-slate-500">{fmtDate(a.actualAt ?? a.scheduledAt)} · {fmtTime(a.actualAt ?? a.scheduledAt)}</td>
                          <td className="py-2.5 px-4 text-slate-500">{stay?.berthName ?? berthLabel(a.pontoon, a.slot)}</td>
                          <td className="py-2.5 px-4 text-slate-500">{d ? `${fmtDate(d.scheduledAt)} · ${fmtTime(d.scheduledAt)}` : '—'}</td>
                          <td className="py-2.5 px-4 text-right">
                            <button className="rounded-lg bg-deep-900 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-deep-800 disabled:opacity-50"
                              disabled={busyId === a.id} onClick={() => void releaseOther({ arrival: a, departure: d })}>{translatePortalText("Check out")}</button>
                          </td>
                        </tr>
                      )
                    })}
                    {orphanDepartures.map(m => (
                      <tr key={m.id} className="transition hover:bg-violet-50/30">
                        <td className="py-2.5 px-4">
                          <p className="font-bold text-deep-900">{m.boatName}</p>
                          <p className="text-[11px] text-slate-400">{m.plate ?? '—'} · {translatePortalText('Visitor')}</p>
                        </td>
                        <td className="py-2.5 px-4 text-slate-400">{translatePortalText("No arrival logged")}</td>
                        <td className="py-2.5 px-4 text-slate-500">{berthLabel(m.pontoon, m.slot)}</td>
                        <td className="py-2.5 px-4 text-slate-500">{fmtDate(m.scheduledAt)} · {fmtTime(m.scheduledAt)}</td>
                        <td className="py-2.5 px-4 text-right">
                          <button className="rounded-lg bg-deep-900 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-deep-800 disabled:opacity-50"
                            disabled={busyId === m.id} onClick={() => void releaseOrphan(m)}>{translatePortalText("Check out")}</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Departure History — live checked-out movements */}
      <Section title={translatePortalText("Departure History")} sub={translatePortalText("Checked-out vessels & released berths")}>
        <div className="card overflow-hidden !p-0">
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full min-w-[700px]">
              <thead>
                <tr className="border-b border-slate-100 bg-sand/50 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                  <th className="py-3 px-4">{translatePortalText("Departed")}</th><th className="py-3 px-4">{translatePortalText("Vessel")}</th><th className="py-3 px-4">{translatePortalText("Berth")}</th><th className="py-3 px-4 text-right" title={translatePortalText("Berthing + utilities + services recorded at check-out — not proof of payment")}>{translatePortalText("Stay total")}</th><th className="py-3 px-4">{translatePortalText("Status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 text-xs">
                {history.length === 0 ? (
                  <tr><td colSpan={5} className="py-8 text-center text-slate-400">{translatePortalText("No completed departures yet.")}</td></tr>
                ) : historyTf.pagedRows.map(m => (
                  <tr key={m.id} className="transition hover:bg-sand/70">
                    <td className="py-2.5 px-4 text-slate-400 font-semibold">{fmtDate(m.actualAt ?? m.scheduledAt)}</td>
                    <td className="py-2.5 px-4 font-bold text-deep-900">{m.boatName}</td>
                    <td className="py-2.5 px-4 text-slate-500">{berthLabel(m.pontoon, m.slot)}</td>
                    <td className="py-2.5 px-4 text-right font-display font-extrabold text-deep-900">
                      {m.charges ? formatMoney(m.charges.dock + m.charges.utility + m.charges.services, currency) : '—'}
                    </td>
                    <td className="py-2.5 px-4"><Badge>{translatePortalText("Completed")}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {history.length > 0 && <TablePagination state={historyTf} noun={translatePortalText('departures')} />}
        </div>
        {moveState.data?.truncated && (
          <p className="mt-2 text-[11px] text-amber-700">{translatePortalText("This marina has more movements than the board loads at once — the oldest are not shown.")}</p>
        )}
      </Section>

      <ScheduleModal open={scheduling} onClose={() => setScheduling(false)} onDone={refresh} settings={settings} reservations={reservations} />

      {/* Invoice / statement modal */}
      <Modal open={!!invoice} onClose={() => setInvoice(null)} title={invoice?.invoice ? translatePortalText("🧾 Invoice Generated") : translatePortalText("🧾 Departure Statement")}>
        {invoice && invoice.reservation && (() => {
          const r = invoice.reservation!
          const who = personOf(r.subscriber)
          const ch = invoice.charges
          const inv = invoice.invoice
          return (
            <div className="text-sm">
              <div className="rounded-2xl border border-dashed border-slate-200 p-5 bg-white">
                <div className="flex justify-between">
                  <div>
                    <p className="font-display text-lg font-extrabold text-deep-900">{inv?.invoiceNumber ?? r.reservationNo}</p>
                    <p className="text-xs text-slate-400">{r.marinaName} · {fmtDate(inv?.createdAt ?? new Date())}</p>
                  </div>
                  <FileText className="text-ocean-400" />
                </div>
                <div className="my-4 border-t border-slate-100" />
                <p className="font-bold text-deep-900">{who?.name ?? translatePortalText('Berth holder')}</p>
                <p className="text-xs text-slate-400">{r.boatName} {translatePortalText("· berth ")}{berthLabel(r.pontoon, r.slot)}</p>
                <div className="mt-4 space-y-1.5 text-xs">
                  <p className="flex justify-between"><span>{translatePortalText("Berthing contract")}</span><b>{formatMoney(ch.dock, currency)}</b></p>
                  <p className="flex justify-between"><span>{translatePortalText("Utility charges")}</span><b>{formatMoney(ch.utility, currency)}</b></p>
                  <p className="flex justify-between"><span>{translatePortalText("Extra services")}</span><b>{formatMoney(ch.services, currency)}</b></p>
                  {inv ? (
                    <>
                      <p className="flex justify-between"><span>{translatePortalText('VAT')} ({formatPortalNumber(inv.vatRate)}%) {translatePortalText('on this invoice')}</span><b>{formatMoney(inv.vatAmount, inv.currency)}</b></p>
                      <p className="mt-2 flex justify-between border-t border-slate-100 pt-2 text-base font-display font-extrabold text-deep-900">
                        <span>{translatePortalText("Invoiced now")}</span><span>{formatMoney(inv.total, inv.currency)}</span>
                      </p>
                    </>
                  ) : (
                    <p className="mt-2 flex justify-between border-t border-slate-100 pt-2 text-base font-display font-extrabold text-deep-900">
                      <span>{translatePortalText("Stay total")}</span><span>{formatMoney(ch.total, currency)}</span>
                    </p>
                  )}
                </div>
                {!inv && <p className="mt-3 text-[11px] text-slate-400">{translatePortalText("Nothing was outstanding, so no new invoice was raised.")}</p>}
              </div>
              <div className="mt-4 flex justify-end gap-2">
                {inv && (
                  // Busy while sending — a second click emailed the guest twice.
                  <button className="btn-ghost" disabled={emailing} onClick={async () => {
                    setEmailing(true)
                    try {
                      const { invoicesApi } = await import('../api')
                      await invoicesApi.email(inv.id)
                      toast(translatePortalText(`Invoice emailed to ${who?.email ?? translatePortalText('the guest')}`), 'info')
                      setInvoice(null)
                    } catch (e) {
                      // Kept open on failure so "Email to guest" can be tried again.
                      toast(translatePortalText(e instanceof Error ? e.message : 'Could not send the invoice'), 'warn')
                    } finally { setEmailing(false) }
                  }}>{translatePortalText(emailing ? 'Sending…' : 'Email to guest')}</button>
                )}
                <button className="btn-primary" onClick={() => setInvoice(null)}>{translatePortalText("Done")}</button>
              </div>
            </div>
          )
        })()}
      </Modal>
    </div>
  )
}

/** Schedules an arrival or departure against a live berth. */
function ScheduleModal({ open, onClose, onDone, settings, reservations }: {
  open: boolean
  onClose: () => void
  onDone: () => Promise<void>
  settings: { checkInTime: string; checkOutTime: string }
  reservations: ApiReservation[]
}) {
  const [busy, setBusy] = useState(false)
  const [direction, setDirection] = useState<'arrival' | 'departure'>('arrival')
  const [subscriptionId, setSubscriptionId] = useState('')
  const [boatName, setBoatName] = useState('')
  const [plate, setPlate] = useState('')
  const [date, setDate] = useState(marinaDay())
  const [time, setTime] = useState(settings.checkInTime)
  const [notes, setNotes] = useState('')
  const [boatNameErr, setBoatNameErr] = useState('')

  const submit = async () => {
    if (busy) return
    if (!subscriptionId && !boatName.trim()) {
      setBoatNameErr('Pick a berthed boat or type a boat name')
      return
    }
    // An empty time box sent "2026-10-06T:00", which the server rejects with
    // a message about scheduledAt the operator never typed.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
      toast(translatePortalText('Pick a date and a time'), 'warn')
      return
    }
    setBoatNameErr('')
    setBusy(true)
    try {
      await movementsApi.create({
        direction,
        subscriptionId: subscriptionId || undefined,
        boatName: subscriptionId ? undefined : boatName.trim(),
        // The registration box is hidden once a lease is picked; a value typed
        // before that used to be sent anyway and overwrite the lease's plate.
        plate: subscriptionId ? undefined : plate.trim() || undefined,
        // Riyadh wall-clock time, offset included — see `marinaInstant`.
        scheduledAt: marinaInstant(date, time),
        notes: notes.trim() || undefined,
      })
      toast(translatePortalText(`${direction === 'arrival' ? 'Arrival' : 'Departure'} scheduled`))
      onClose()
      setSubscriptionId(''); setBoatName(''); setPlate(''); setNotes('')
      await onDone()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not schedule that movement'), 'warn')
    } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title={translatePortalText("➕ Schedule movement")}>
      <div className="space-y-4">
        <div>
          <label className="label">{translatePortalText("Direction")}</label>
          <div className="flex gap-2">
            {(['arrival', 'departure'] as const).map(d => (
              <button key={d} onClick={() => { setDirection(d); setTime(d === 'arrival' ? settings.checkInTime : settings.checkOutTime) }}
                className={`chip flex-1 justify-center py-2 transition ${direction === d ? 'bg-deep-900 text-white' : 'bg-white ring-1 ring-slate-200 text-slate-500 hover:ring-ocean-300'}`}>
                {d === 'arrival' ? <ArrowDownLeft size={13} /> : <ArrowUpRight size={13} />} {translatePortalText(d === 'arrival' ? 'Arrival' : 'Departure')}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label">{translatePortalText("Berthed boat (optional)")}</label>
          <select className="input" value={subscriptionId} onChange={e => setSubscriptionId(e.target.value)}>
            <option value="">{translatePortalText("— visitor / not on a contract —")}</option>
            {reservations.map(r => (
              <option key={r.id} value={r.id}>{r.boatName} · {berthLabel(r.pontoon, r.slot)} · {r.plate}</option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-slate-400">{translatePortalText("Linking a reservation lets check-out total the stay's utilities and services.")}</p>
        </div>

        {!subscriptionId && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">{translatePortalText("Boat name *")}</label>
              <input className={`input ${boatNameErr ? '!border-rose-400 !ring-2 !ring-rose-100' : ''}`} value={boatName}
                onChange={e => { setBoatName(e.target.value); if (boatNameErr) setBoatNameErr('') }} />
              {boatNameErr && <p className="mt-1 text-xs font-semibold text-rose-500">{translatePortalText(boatNameErr)}</p>}
            </div>
            <div><label className="label">{translatePortalText("Registration")}</label><input className="input uppercase" value={plate} onChange={e => setPlate(e.target.value)} /></div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <DateField label={translatePortalText('Date')} value={date} onChange={setDate} />
          <div><label className="label">{translatePortalText("Time (Riyadh)")}</label><input type="time" className="input" value={time} onChange={e => setTime(e.target.value)} /></div>
        </div>

        <div><label className="label">{translatePortalText("Notes for the crew")}</label><textarea className="input min-h-[70px]" value={notes} onChange={e => setNotes(e.target.value)} /></div>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>{translatePortalText("Cancel")}</button>
        <button className="btn-primary" disabled={busy} onClick={submit}>{translatePortalText(busy ? 'Scheduling…' : 'Schedule')}</button>
      </div>
    </Modal>
  )
}
