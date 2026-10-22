import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Radar, Ship, Navigation, Gauge, MapPin, Maximize2, Minimize2 } from 'lucide-react'
import { PageHeader, Badge, Img, toast, Modal, LoadingState, ErrorState, EmptyState } from '../ui'
import { FleetMap, Fleet3DMap, MapModeToggle, type MapPoint } from '../fuel/fuelUi'
import { boatPhoto } from '../images'
import { useAsync, useMarina, berthLabel, fmtDate, formatMoney, humanize, personOf } from '../live'
import { chatApi, idOf, movementsApi, portalApi, fileUrl, type ApiBerthMapEntry, type ApiMovement } from '../api'
import { onSocket } from '../socket'
import { formatPortalDate, formatPortalNumber, translatePortalText } from '../i18n/runtime'


/**
 * Live Fleet Map — every vessel the marina knows about, positioned from what the
 * harbour actually knows: berth check-ins put a boat at the marina, and a
 * skipper's reported ETA/distance puts an approaching boat offshore. There is no
 * AIS feed, so nothing is plotted that the marina hasn't been told — and what is
 * plotted is approximate: a checked-in boat is drawn somewhere in the marina, an
 * inbound one at its reported distance on an arbitrary bearing. The detail panel
 * says so rather than printing those points as four-decimal coordinates.
 */

type LiveStatus = 'Docked' | 'Anchored' | 'Approaching' | 'Underway'

/**
 * Arrival times are Riyadh time. `fmtTime` formats in the browser's zone, so an
 * operator travelling (or a laptop left on UTC) read every ETA hours off.
 */
const MARINA_TZ = 'Asia/Riyadh'
/** `YYYY-MM-DD` in the marina's day. */
const marinaDay = (value: string | Date = new Date()) => {
  const d = value instanceof Date ? value : new Date(value)
  return isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: MARINA_TZ }).format(d)
}
const marinaTime = (value?: string | null) =>
  value ? formatPortalDate(value, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: MARINA_TZ }) : '—'

type MovementQuery = Parameters<typeof movementsApi.list>[0]

/**
 * Every page of a movements query.
 *
 * This page used to ask for `date: 'all', limit: 100` — but the server sorts
 * movements oldest-first and caps a page at 100, so once a marina had logged a
 * hundred movements the map was drawn from the *first* hundred it ever had:
 * today's inbound boats and today's departures simply were not in the answer.
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

/** What the chips call each state — "Anchored" read as a boat lying at anchor. */
const STATUS_LABEL: Record<LiveStatus, string> = {
  Docked: 'Docked', Anchored: 'Berth held', Approaching: 'Approaching', Underway: 'Underway',
}

const STATUS_TONE: Record<LiveStatus, MapPoint['tone']> = {
  Docked: 'idle', Anchored: 'idle', Underway: 'active', Approaching: 'active',
}
const STATUS_COLOR: Record<LiveStatus, string> = {
  Docked: '#1b9bbf', Anchored: '#8b5cf6', Underway: '#f59e0b', Approaching: '#10b981',
}
const STATUS_HINT: Record<LiveStatus, string> = {
  Docked: 'Checked in alongside',
  Anchored: 'Berth held, not yet checked in',
  Approaching: 'Inbound — ETA reported',
  Underway: 'Cleared out today',
}

// A stable pseudo-random per boat, so a vessel's pier scatter never jumps around.
function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Canonical vessel-category keys (constants/vesselTaxonomy.ts) get an exact
// match; anything else is a marina-entered free-text boat type (e.g. a walk-in
// dock subscription not tied to a real Boat record) so it falls back to a
// best-effort substring guess.
const CATEGORY_ICON: Record<string, string> = {
  sailing_boat: '⛵',
  motorboat: '🛥️',
  yacht: '🛥️',
  jet_ski: '🚤',
  car_jet: '🚤',
  sports_jet_boat: '🚤',
  floating_restaurant: '🍽️',
  water_bus: '🚌',
  cruise_ship: '🛳️',
}

function iconFor(type: string) {
  const t = (type || '').toLowerCase()
  if (CATEGORY_ICON[t]) return CATEGORY_ICON[t]
  if (t.includes('fish')) return '🎣'
  if (t.includes('cat') || t.includes('sail')) return '⛵'
  if (t.includes('jet')) return '🚤'
  return '🛥️'
}

const NM_IN_DEG = 1 / 60 // one nautical mile ≈ 1/60° of latitude

export interface LiveBoat {
  id: string
  name: string
  plate: string
  type: string
  lengthFt: number
  live: LiveStatus
  /** Null when the marina has no position for the boat. */
  lat: number | null
  lng: number | null
  /** Nautical miles out, when the skipper reported it. */
  distanceNm: number | null
  berth: string | null
  endDate: string | null
  totalSar: number | null
  owner: { _id?: string; name?: string; avatar?: string; email?: string; phone?: string } | null
  eta: string | null
  note: string
}

export default function FleetTracker() {
  const { marina, currency } = useMarina()
  const berthState = useAsync(() => portalApi.berthMap().then(r => r.data), [])
  // Two targeted reads rather than "everything": boats still to arrive (any
  // date — the filter below keeps today's and those under way), and the last
  // month's check-outs, of which today's are listed as having cleared out.
  const moveState = useAsync(async () => {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
    const [inbound, cleared] = await Promise.all([
      listAllMovements({ date: 'all', direction: 'arrival', status: 'expected,en_route' }),
      listAllMovements({ direction: 'departure', status: 'checked_out', from: since }),
    ])
    return { items: [...inbound.items, ...cleared.items], truncated: inbound.truncated || cleared.truncated }
  }, [])

  const [filter, setFilter] = useState<'All' | LiveStatus>('All')
  const [selId, setSelId] = useState<string | null>(null)
  const [hailing, setHailing] = useState(false)
  const [vhf, setVhf] = useState('16')
  const [hailMsg, setHailMsg] = useState('')
  const [sending, setSending] = useState(false)
  const [showRoster, setShowRoster] = useState(false)
  const [isFull, setIsFull] = useState(false)
  const [mapMode, setMapMode] = useState<'2d' | '3d'>('2d')

  /**
   * The LIVE chip reports the real age of the data.
   *
   * It used to count 1→59 on its own timer and reset to "1s ago" whenever the
   * minute came round — whether or not the refetch had succeeded — so a map
   * that had lost the server kept insisting it was fresh. It now moves only
   * when both reads actually come back, and says so when they don't.
   */
  const [lastSync, setLastSync] = useState(() => Date.now())
  const [ago, setAgo] = useState(0)
  const [syncFailed, setSyncFailed] = useState(false)
  useEffect(() => {
    const refreshAll = async () => {
      // `silent`: a background poll never blanks the map the operator is reading.
      const [b, m] = await Promise.all([berthState.reload({ silent: true }), moveState.reload({ silent: true })])
      if (b && m) { setLastSync(Date.now()); setSyncFailed(false) } else setSyncFailed(true)
    }
    const t = setInterval(() => void refreshAll(), 60_000)
    // Check-ins, check-outs and "en route" reports land as they happen
    // (owner account), instead of on the next minute.
    const off = onSocket('movement:updated', () => void refreshAll())
    return () => { clearInterval(t); off() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    const t = setInterval(() => setAgo(Math.round((Date.now() - lastSync) / 1000)), 1000)
    return () => clearInterval(t)
  }, [lastSync])

  /**
   * The harbour every position on this map is measured from.
   *
   * `?? 0` is a real coordinate, not an absent one: latitude 0, longitude 0 is
   * a point in the Gulf of Guinea, some 4,000 km from any Saudi marina. A
   * marina saved without coordinates therefore used to plot its entire fleet
   * off the coast of West Africa, complete with berth labels and ETAs — a map
   * that looks authoritative and is wrong by an ocean.
   *
   * So the absence is tracked rather than defaulted, and the page says the
   * coordinates are missing instead of drawing a fleet nobody can find.
   */
  const hasCoords =
    typeof marina?.latitude === 'number' &&
    typeof marina?.longitude === 'number' &&
    !(marina.latitude === 0 && marina.longitude === 0)
  const MARINA = {
    lat: marina?.latitude ?? 0,
    lng: marina?.longitude ?? 0,
    name: marina?.name ?? 'Marina',
  }

  /** Every boat the harbour currently knows about, with a real reason to be here. */
  const fleet = useMemo<LiveBoat[]>(() => {
    const berths: ApiBerthMapEntry[] = berthState.data?.berths ?? []
    const movements: ApiMovement[] = moveState.data?.items ?? []
    // The marina's day, not UTC's and not the browser's: at +3 the UTC date is
    // yesterday until 03:00, which made the early shift's departures vanish.
    const today = marinaDay()

    const byBoat = new Map<string, LiveBoat>()

    // 1. Boats holding a berth.
    for (const berth of berths) {
      const r = berth.reservation
      if (!r) continue
      // The berth map also carries requests the marina has not accepted and
      // leases still waiting on payment. Neither is a boat the harbour expects
      // yet, and both used to be drawn inside the marina as "Anchored".
      if (r.status !== 'active') continue
      // Alongside *now*, as the server works it out from every movement of the
      // stay — not "has a checked-in arrival somewhere in the list", which kept
      // a boat that had since checked out showing as docked.
      const checkedIn = (r as { isAlongside?: boolean }).isAlongside === true
      const rand = mulberry32(hash(r.id))
      const owner = personOf(r.subscriber)
      byBoat.set(r.boatName + r.plate, {
        id: r.id,
        name: r.boatName,
        plate: r.plate,
        type: r.boatType,
        lengthFt: r.lengthFt,
        live: checkedIn ? 'Docked' : 'Anchored',
        // A checked-in boat is drawn a few metres off the marina's pin — it is
        // here, but which spot on the chart is decoration. A boat that has not
        // arrived has no position at all.
        lat: checkedIn ? MARINA.lat + (rand() - 0.5) * 0.004 : null,
        lng: checkedIn ? MARINA.lng + (rand() - 0.5) * 0.004 : null,
        distanceNm: null,
        berth: berthLabel(berth.pontoon, berth.number),
        endDate: r.endDate,
        totalSar: r.totalSar,
        owner: owner ?? null,
        eta: null,
        note: checkedIn ? 'Checked in' : 'Berth held — awaiting check-in',
      })
    }

    // 2. Inbound boats — placed at the distance the skipper reported.
    for (const m of movements) {
      if (m.direction !== 'arrival') continue
      // Under way, or expected today. An arrival booked for next month is not
      // "approaching", and one from last week that never came is a no-show.
      const inbound = m.status === 'en_route' || (m.status === 'expected' && marinaDay(m.scheduledAt) === today)
      if (!inbound) continue
      const key = m.boatName + (m.plate ?? '')
      const rand = mulberry32(hash(m.id))
      const bearing = rand() * Math.PI * 2
      const nm = m.distanceNm ?? 0
      const owner = personOf(m.boater)
      byBoat.set(key, {
        id: m.id,
        name: m.boatName,
        plate: m.plate ?? '',
        type: typeof m.subscription === 'object' ? m.subscription?.boatType ?? '' : '',
        lengthFt: 0,
        live: 'Approaching',
        // No reported distance, no position: this used to park the boat at a
        // fixed point ~1 km out, which read as a fix nobody had.
        lat: nm > 0 ? MARINA.lat + Math.cos(bearing) * nm * NM_IN_DEG : null,
        lng: nm > 0 ? MARINA.lng + Math.sin(bearing) * nm * NM_IN_DEG : null,
        distanceNm: m.distanceNm ?? null,
        berth: m.pontoon ? berthLabel(m.pontoon, m.slot) : null,
        endDate: null,
        totalSar: null,
        owner: owner ?? null,
        eta: m.scheduledAt,
        note: m.distanceNm != null ? `${m.distanceNm} nm out` : 'ETA reported',
      })
    }

    // 3. Boats that cleared out today — listed, but no position is known.
    for (const m of movements) {
      if (m.direction !== 'departure' || m.status !== 'checked_out') continue
      if (!m.actualAt || marinaDay(m.actualAt) !== today) continue
      const key = m.boatName + (m.plate ?? '')
      if (byBoat.has(key)) continue
      const owner = personOf(m.boater)
      byBoat.set(key, {
        id: m.id,
        name: m.boatName,
        plate: m.plate ?? '',
        type: '',
        lengthFt: 0,
        live: 'Underway',
        lat: null,
        lng: null,
        distanceNm: null,
        berth: m.pontoon ? berthLabel(m.pontoon, m.slot) : null,
        endDate: null,
        totalSar: null,
        owner: owner ?? null,
        eta: null,
        note: marinaTime(m.actualAt),
      })
    }

    return [...byBoat.values()]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [berthState.data, moveState.data, MARINA.lat, MARINA.lng])

  const counts = useMemo(() => {
    const c: Record<LiveStatus, number> = { Docked: 0, Anchored: 0, Approaching: 0, Underway: 0 }
    fleet.forEach(b => { c[b.live]++ })
    return c
  }, [fleet])

  const shown = filter === 'All' ? fleet : fleet.filter(b => b.live === filter)
  const sel = fleet.find(b => b.id === selId) ?? null

  const points: MapPoint[] = useMemo(() => [
    { id: '__marina', lat: MARINA.lat, lng: MARINA.lng, label: MARINA.name, icon: '⚓', tone: 'depot' },
    ...shown
      .filter(b => b.lat != null && b.lng != null)
      .map(b => ({ id: b.id, lat: b.lat!, lng: b.lng!, label: b.name, icon: iconFor(b.type), tone: STATUS_TONE[b.live] })),
  ], [shown, MARINA.lat, MARINA.lng, MARINA.name])

  const onPointClick = (id: string) => {
    if (id === '__marina') { toast(translatePortalText(`${MARINA.name} — home harbor`), 'info'); return }
    setSelId(id)
  }

  /** Sends the hail as a real chat message to the boat's owner. */
  const transmit = async () => {
    const ownerId = sel?.owner ? idOf(sel.owner) : ''
    if (!ownerId) { toast(translatePortalText('No BoatPro account on file for this vessel'), 'warn'); return }
    if (!hailMsg.trim()) { toast(translatePortalText('Write the hailing message'), 'warn'); return }
    setSending(true)
    try {
      const chat = await chatApi.create(ownerId)
      const chatId = idOf(chat.data.chat)
      if (!chatId) throw new Error('Could not open a conversation with this vessel')
      await chatApi.send(chatId, `[VHF ${vhf}] ${hailMsg.trim()}`)
      toast(translatePortalText(`📻 Hailed ${sel.name} on VHF ${vhf}`))
      setHailing(false)
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not reach the vessel'), 'warn')
    } finally { setSending(false) }
  }

  if ((berthState.loading && !berthState.data) || (moveState.loading && !moveState.data)) {
    return <LoadingState label="Locating the fleet…" rows={5} />
  }
  if (berthState.error && !berthState.data) return <ErrorState error={berthState.error} onRetry={berthState.reload} />
  if (!hasCoords) {
    return (
      <div className="space-y-4">
        <PageHeader title={translatePortalText("Live Fleet Map")} sub="Every vessel the harbour knows about" />
        <div className="card">
          <EmptyState
            icon="📍"
            text="This marina has no coordinates saved, so vessel positions cannot be plotted. Add the marina's latitude and longitude in Profile → Location, and the fleet will appear here."
          />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {!isFull && (
        <PageHeader title={translatePortalText("Live Fleet Map")} icon={<Radar className="text-ocean-500" />}
          sub="Every vessel the harbour knows about — docked, holding a berth, inbound or cleared out. Positions are approximate: they come from berth check-ins and skippers' reported distances, not GPS or AIS. Click any point to inspect the vessel."
              actions={syncFailed ? (
                <span className="chip bg-amber-50 text-amber-700 ring-1 ring-amber-200">{translatePortalText("Refresh failed — data from")} {translatePortalText(`${ago}s ago`)}</span>
              ) : (
                <span className="chip bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"><span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse-soft" /> {translatePortalText("LIVE · refreshed ")}{translatePortalText(ago < 5 ? 'just now' : `${ago}s ago`)}</span>
              )} />
      )}

      {/* The berth map alone still draws; say what is missing rather than
          showing a fleet with no inbound or departed boats as if complete. */}
      {!isFull && moveState.error && (
        <div className="rounded-2xl bg-amber-50 px-4 py-3 text-[13px] text-amber-800 ring-1 ring-amber-200">
          {translatePortalText("Arrivals and departures could not be loaded — only boats holding a berth are shown.")}{' '}
          <button className="font-bold underline underline-offset-2" onClick={() => void moveState.reload()}>{translatePortalText("Retry")}</button>
        </div>
      )}

      {/* ── Full Screen Map Container ── */}
      <motion.div initial={{ opacity: 0, scale: 0.99 }} animate={{ opacity: 1, scale: 1 }}
        className={isFull ? "fixed inset-0 z-[100] w-screen h-screen rounded-none bg-slate-900 !m-0 !p-0" : "card relative overflow-hidden !p-0 shadow-lift border border-slate-200"}>
        {/* Floating Top Controls Bar */}
        <div className="absolute top-4 start-4 end-4 z-20 flex flex-wrap items-center justify-between gap-3 pointer-events-none">
          <div className="flex flex-wrap gap-2 pointer-events-auto bg-white/90 p-2 rounded-2xl backdrop-blur-md shadow-md border border-white/60">
            <button onClick={() => setFilter('All')} className={`chip transition ${filter === 'All' ? 'bg-deep-900 text-white' : 'bg-white ring-1 ring-slate-200 text-slate-600 hover:ring-ocean-300'}`}>{translatePortalText("All · ")}{formatPortalNumber(fleet.length)}</button>
            {(Object.keys(counts) as LiveStatus[]).map(s => (
              <button key={s} onClick={() => setFilter(s)} title={translatePortalText(STATUS_HINT[s])} className={`chip transition ${filter === s ? 'bg-deep-900 text-white' : 'bg-white ring-1 ring-slate-200 text-slate-600 hover:ring-ocean-300'}`}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_COLOR[s] }} /> {translatePortalText(STATUS_LABEL[s])} · {formatPortalNumber(counts[s])}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 pointer-events-auto">
            <MapModeToggle mode={mapMode} onChange={setMapMode} />

            <button onClick={() => setIsFull(f => !f)}
              className="flex items-center gap-1.5 rounded-2xl bg-white/90 px-3.5 py-2.5 text-xs font-bold text-deep-900 shadow-lg backdrop-blur-md hover:bg-white transition border border-white/70">
              {isFull ? <Minimize2 size={16} className="text-ocean-600" /> : <Maximize2 size={16} className="text-ocean-600" />}
              {translatePortalText(isFull ? 'Exit full screen' : 'Full screen')}
            </button>

            <button onClick={() => setShowRoster(s => !s)}
              className="flex items-center gap-2 rounded-2xl bg-deep-900/90 px-4 py-2.5 text-xs font-bold text-white shadow-lg backdrop-blur-md hover:bg-deep-900 transition">
              <Ship size={16} className="text-ocean-400" />
              {showRoster ? translatePortalText('Hide roster') : translatePortalText(`Fleet roster (${shown.length})`)}
            </button>
          </div>
        </div>

        {/* Floating Roster Drawer Overlay */}
        {showRoster && (
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
            className="absolute top-20 end-4 z-20 w-80 max-h-[calc(100vh-140px)] overflow-y-auto rounded-2xl bg-white/95 p-4 shadow-2xl backdrop-blur-md border border-slate-200 space-y-2">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-2">
              <h4 className="font-display text-sm font-extrabold text-deep-900">{translatePortalText("Fleet Roster")}</h4>
              <span className="text-xs text-slate-400">{formatPortalNumber(shown.length)} {translatePortalText("vessels")}</span>
            </div>
            {shown.length === 0 && <p className="py-6 text-center text-xs text-slate-400">{translatePortalText("No vessels in this state.")}</p>}
            {shown.map(b => (
              <button key={b.id} onClick={() => setSelId(b.id)}
                className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition ${selId === b.id ? 'bg-ocean-50 ring-1 ring-ocean-200' : 'bg-sand hover:bg-ocean-50/60'}`}>
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-base" style={{ background: STATUS_COLOR[b.live] + '22' }}>{iconFor(b.type)}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-bold text-deep-900">{b.name}</p>
                  <p className="truncate text-[11px] text-slate-400">{b.berth ? `${translatePortalText('Berth ')}${b.berth}` : translatePortalText(b.note)}</p>
                </div>
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: STATUS_COLOR[b.live] }} />
              </button>
            ))}
          </motion.div>
        )}

        {/* ── Full Width Map (2D Google Maps or Photorealistic 3D Earth) ── */}
        {mapMode === '2d' ? (
          <FleetMap points={points} center={{ lat: MARINA.lat, lng: MARINA.lng }} zoom={9} width="100%" height={isFull ? "100vh" : "calc(100vh - 240px)"} onPointClick={onPointClick} />
        ) : (
          <Fleet3DMap points={points} center={{ lat: MARINA.lat, lng: MARINA.lng }} width="100%" height={isFull ? "100vh" : "calc(100vh - 240px)"} onPointClick={onPointClick}
            onUnsupported={() => { setMapMode('2d'); toast(translatePortalText("3D Earth isn't enabled for this API key yet — showing 2D map"), 'warn') }} />
        )}
      </motion.div>

      {!isFull && fleet.length === 0 && (
        <div className="card"><EmptyState icon="⛵" text="No vessels at the marina yet — boats appear here as berths are paid for and boats check in." /></div>
      )}

      {/* ── Vessel Details Modal (Opens on point click) ── */}
      <Modal open={Boolean(sel)} onClose={() => setSelId(null)} title={sel ? translatePortalText(`⛵ ${sel.name}`) : translatePortalText("Vessel Details")}>
        {sel && (
          <div className="space-y-4">
            <div className="relative overflow-hidden rounded-2xl">
              <Img src={boatPhoto(sel.name)} className="h-48 w-full object-cover" />
              <div className="absolute top-3 end-3">
                <Badge dot={sel.live === 'Underway' || sel.live === 'Approaching'}>{translatePortalText(STATUS_LABEL[sel.live])}</Badge>
              </div>
            </div>

            <div>
              <h3 className="font-display text-xl font-extrabold text-deep-900">{sel.name}</h3>
              <p className="text-xs text-slate-400">
                {[sel.type ? translatePortalText(humanize(sel.type)) : null, sel.lengthFt ? `${formatPortalNumber(sel.lengthFt)} ${translatePortalText('ft')}` : null, sel.plate ? `${translatePortalText('Reg')} ${sel.plate}` : null].filter(Boolean).join(' · ')}
              </p>
              <p className="mt-1 text-xs font-semibold text-ocean-600">
                {translatePortalText(STATUS_HINT[sel.live])}
                {sel.live === 'Approaching' && sel.distanceNm != null ? ` · ${translatePortalText(`${sel.distanceNm} nm out`)}` : ''}
                {sel.live === 'Underway' && sel.note ? ` · ${sel.note}` : ''}
              </p>
            </div>

            {sel.owner && (
              <div className="flex items-center gap-3 rounded-2xl bg-sand p-3.5 border border-slate-100">
                <img src={fileUrl(sel.owner.avatar) ?? `https://ui-avatars.com/api/?name=${encodeURIComponent(sel.owner.name ?? sel.name)}&background=e2e8f0&color=475569`}
                  className="h-12 w-12 rounded-full object-cover shadow-sm" alt="" />
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400">{translatePortalText("Vessel Owner")}</p>
                  <p className="text-sm font-bold text-deep-900">{sel.owner.name}</p>
                  <p className="text-xs text-slate-500">
                    {sel.berth ? `${translatePortalText('Berth ')}${sel.berth}` : translatePortalText('No berth assigned')}
                    {sel.endDate ? ` · ${translatePortalText(`until ${fmtDate(sel.endDate)}`)}` : ''}
                  </p>
                </div>
                {sel.totalSar != null && (
                  <span className="ms-auto font-display font-extrabold text-deep-900">{formatMoney(sel.totalSar, currency)}</span>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              {[
                // "Alongside" only for a boat that is — a held berth whose boat
                // has not arrived used to read "Alongside" too.
                ['Distance', sel.distanceNm != null ? `${formatPortalNumber(sel.distanceNm)} ${translatePortalText('nm')}` : sel.live === 'Docked' ? translatePortalText('Alongside') : '—', <Gauge size={14} key="g" />],
                // Riyadh time, with the date when it is not today.
                ['ETA', sel.eta ? (marinaDay(sel.eta) === marinaDay() ? marinaTime(sel.eta) : `${fmtDate(sel.eta)} ${marinaTime(sel.eta)}`) : '—', <Navigation size={14} key="n" />],
                // "≈": these are where the chart drew the boat, not a fix.
                ['Latitude', sel.lat != null ? `≈ ${formatPortalNumber(sel.lat, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}` : '—', <MapPin size={14} key="la" />],
                ['Longitude', sel.lng != null ? `≈ ${formatPortalNumber(sel.lng, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}` : '—', <MapPin size={14} key="lo" />],
              ].map(([l, v, ic]) => (
                <div key={l as string} className="rounded-xl border border-slate-100 bg-white p-3 text-center shadow-sm">
                  <p className="flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">{ic}{translatePortalText(String(l))}</p>
                  <p className="font-extrabold text-sm text-deep-900">{v}</p>
                </div>
              ))}
            </div>

            {sel.lat == null ? (
              <p className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                {translatePortalText(
                  sel.live === 'Underway'
                    ? 'The marina has no position for this vessel — it is listed from its departure record.'
                    : sel.live === 'Anchored'
                      ? 'This boat holds a berth but has not checked in, so it is not drawn on the map.'
                      : 'No distance has been reported for this boat, so it is not drawn on the map.',
                )}</p>
            ) : (
              <p className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                {translatePortalText("Approximate position — BoatPro has no GPS or AIS feed. Checked-in boats are drawn at the marina; inbound boats at the distance the skipper reported, on an arbitrary bearing.")}</p>
            )}

            <div className="flex gap-2 pt-2">
              <button className="btn-primary flex-1 justify-center" onClick={() => { setVhf(marina?.settings?.vhfChannel || '16'); setHailMsg(''); setHailing(true) }}>{translatePortalText("📻 Hail vessel (VHF)")}</button>
              <button className="btn-ghost flex-1 justify-center" onClick={() => setSelId(null)}>{translatePortalText("Close")}</button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── VHF Hail Radio Modal ── */}
      <Modal open={hailing} onClose={() => setHailing(false)} title={translatePortalText(`📻 Hail vessel${sel ? ` — ${sel.name}` : ''}`)}>
        <div className="space-y-4">
          {sel && (
            <div className="rounded-2xl bg-sand p-3 text-sm">
              <p className="font-bold text-deep-900">{sel.name}</p>
              <p className="text-xs text-slate-400">{translatePortalText("Owner · ")}{sel.owner?.name ?? translatePortalText('unknown')}</p>
            </div>
          )}
          <div>
            <label className="label">{translatePortalText("VHF channel")}</label>
            <select className="input" value={vhf} onChange={e => setVhf(e.target.value)}>
              {[...new Set([marina?.settings?.vhfChannel, '16', '68', '12', '09'].filter(Boolean) as string[])].map(c => (
                <option key={c} value={c}>{translatePortalText("Channel ")}{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">{translatePortalText("Message")}</label>
            <textarea className="input min-h-[88px]" value={hailMsg} onChange={e => setHailMsg(e.target.value)} placeholder={translatePortalText("Hailing message…")} />
          </div>
          <p className="text-[11px] text-slate-400">{translatePortalText("Delivered to the owner's BoatPro chat, prefixed with the channel.")}</p>
          <div className="flex justify-end">
            <button className="btn-primary" disabled={sending} onClick={transmit}>{translatePortalText(sending ? 'Transmitting…' : 'Transmit')}</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
