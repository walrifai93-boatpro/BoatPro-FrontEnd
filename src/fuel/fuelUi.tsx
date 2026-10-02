import React, { useEffect, useRef, useState } from 'react'
import { DEFAULT_MAP_CENTRE } from '../shared/geoDefaults'
import { useAuth } from '../auth'
import { motion } from 'framer-motion'
import { LayoutGrid, List } from 'lucide-react'
import { localizedField, translatePortalText } from '../i18n/runtime'

// ── card / table view switcher ───────────────────────────────
export function FuelViewToggle({ view, onChange }: { view: 'card' | 'table'; onChange: (v: 'card' | 'table') => void }) {
  const opts = [{ k: 'card', icon: LayoutGrid, label: 'Cards' }, { k: 'table', icon: List, label: 'Table' }] as const
  return (
    <div className="flex gap-1 rounded-xl bg-white p-1 shadow-soft ring-1 ring-slate-100">
      {opts.map(o => (
        <button key={o.k} onClick={() => onChange(o.k)} title={translatePortalText(`${o.label} view`)}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${view === o.k ? 'bg-gradient-to-r from-amber-600 to-orange-400 text-white shadow-glow' : 'text-slate-500 hover:text-deep-900'}`}>
          <o.icon size={13} />{translatePortalText(o.label)}
        </button>
      ))}
    </div>
  )
}

// ── fuel page header ─────────────────────────────────────────
export function FuelHeader({ title, sub, actions, icon }: { title: string; sub: string; actions?: React.ReactNode; icon?: React.ReactNode }) {
  /*
    The signed-in provider's own business, not a hardcoded one.

    This line read "Harbor Point Fuel · ... Console" as a literal, on every page of the
    portal. A real provider logging in to run their own business was shown
    another company's name above every screen — one that does not exist — and
    it was the most prominent piece of text on the page after the title.

    Falls back to a plain console label rather than to a placeholder business,
    so an account still loading says nothing instead of saying something false.
  */
  const { user } = useAuth()
  const businessName = localizedField(user?.business, 'businessName') || localizedField(user, 'name') || ''

  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-slate-200/70 pb-5">
      <div>
        <p className="mb-1 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.28em] text-amber-600">
          <span className="h-px w-6 bg-amber-500" /><bdi dir="auto">{businessName ? `${businessName} · ` : translatePortalText("")}</bdi>{translatePortalText('Provider Console')}
        </p>
        <h1 className="font-display text-2xl md:text-3xl font-extrabold tracking-tight text-deep-900 flex items-center gap-3">{icon}{translatePortalText(title)}</h1>
        <p className="mt-1 text-sm text-slate-500">{translatePortalText(sub)}</p>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </motion.div>
  )
}

// ── fuel status badge ────────────────────────────────────────
const TONES: Record<string, string> = {
  // tanks
  Healthy: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', Low: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  Critical: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200', Maintenance: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
  // bookings
  New: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200', Accepted: 'bg-ocean-50 text-ocean-700 ring-1 ring-ocean-200',
  Scheduled: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200', 'In progress': 'bg-orange-50 text-orange-700 ring-1 ring-orange-200',
  Completed: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', Cancelled: 'bg-slate-100 text-slate-500 ring-1 ring-slate-200',
  // deliveries
  Assigned: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200', 'En route': 'bg-ocean-50 text-ocean-700 ring-1 ring-ocean-200',
  Fueling: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200', Delayed: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200',
  // vehicles
  'On delivery': 'bg-ocean-50 text-ocean-700 ring-1 ring-ocean-200', Available: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  Refilling: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  // pumps
  Online: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', Dispensing: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200',
  Offline: 'bg-slate-100 text-slate-500 ring-1 ring-slate-200', 'Calibration due': 'bg-rose-50 text-rose-600 ring-1 ring-rose-200',
  // invoices
  Paid: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', Pending: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  Overdue: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200', Refunded: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
  // credit
  'Good standing': 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', Watch: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  'On hold': 'bg-rose-50 text-rose-600 ring-1 ring-rose-200',
  // priority
  Medium: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200', High: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200',
  // licenses / staff
  Valid: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', 'Expiring soon': 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  Expired: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200',
  'On duty': 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', 'Off duty': 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
  'On leave': 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
}
export function FBadge({ children, dot }: { children: string; dot?: boolean }) {
  return (
    <span className={`chip ${TONES[children] ?? 'bg-slate-100 text-slate-600'}`}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse-soft" />}{translatePortalText(children)}
    </span>
  )
}

// ── animated tank gauge (liquid fill) ────────────────────────
export function TankGauge({ pct, color, label, height = 120 }: { pct: number; color: string; label?: string; height?: number }) {
  const level = Math.max(4, Math.min(100, pct))
  return (
    <div className="relative w-full overflow-hidden rounded-2xl border-2 border-slate-200 bg-slate-50" style={{ height }}>
      <motion.div initial={{ height: 0 }} animate={{ height: `${level}%` }} transition={{ duration: 1.4, ease: 'easeOut' }}
        className="absolute bottom-0 start-0 end-0" style={{ background: `${color}33` }}>
        {/* liquid surface waves */}
        <div className="absolute -top-2 start-0 h-3 w-[200%] liquid-wave">
          <svg viewBox="0 0 1200 24" preserveAspectRatio="none" className="h-full w-full">
            <path d="M0 12 Q75 2 150 12 T300 12 T450 12 T600 12 T750 12 T900 12 T1050 12 T1200 12 V24 H0 Z" fill={color} fillOpacity="0.55" />
          </svg>
        </div>
        <div className="absolute inset-0 top-1" style={{ background: `linear-gradient(180deg, ${color}88, ${color}55)` }} />
      </motion.div>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <p className="font-display text-lg font-extrabold text-deep-900 drop-shadow-sm">{pct}%</p>
          {label && <p className="text-[10px] font-bold uppercase tracking-wider text-deep-800/60">{label}</p>}
        </div>
      </div>
      {/* level marks */}
      {[25, 50, 75].map(m => (
        <div key={m} className="absolute start-0 h-px w-2.5 bg-slate-300" style={{ bottom: `${m}%` }} />
      ))}
    </div>
  )
}

// ── mini metric pill ─────────────────────────────────────────
export function Metric({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-sand px-3 py-2.5 text-xs">
      <span>{icon}</span>
      <span className="font-semibold text-slate-400">{label}</span>
      <b className="ms-auto text-deep-900">{value}</b>
    </div>
  )
}

// ── real Google Map with clickable fleet markers ──────────────
const GOOGLE_MAPS_API_KEY = 'AIzaSyAtsJUF0hPZq468P-Lgel-sb2Spw6ewKa8'

// Loaded on the "beta" channel with the maps3d library so the SAME script tag
// covers both the classic 2D Map/Marker (used by FleetMap) and the WebGL
// Photorealistic 3D Maps API (used by Fleet3DMap) — loading two separate
// Maps JS bootstraps on one page throws, so this must stay a single loader.
// Not "alpha": that channel pins a "for development purposes only" banner
// across the top of every page that loads a map.
let mapsLoadPromise: Promise<void> | null = null
function loadGoogleMaps(): Promise<void> {
  if ((window as any).google?.maps) return Promise.resolve()
  if (mapsLoadPromise) return mapsLoadPromise
  mapsLoadPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById('gmaps-script')
    if (existing) { existing.addEventListener('load', () => resolve()); return }
    const script = document.createElement('script')
    script.id = 'gmaps-script'
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&v=beta&libraries=maps3d`
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Google Maps'))
    document.head.appendChild(script)
  })
  return mapsLoadPromise
}

/** One palette for both renderers, so a pin means the same thing either way. */
const PIN_TONE = {
  depot: { fill: '#10b981', ring: '#ffffff', ink: '#ffffff' },
  active: { fill: '#f59e0b', ring: '#ffffff', ink: '#1f2937' },
  idle: { fill: '#ffffff', ring: '#cbd5e1', ink: '#334155' },
  stale: { fill: '#e2e8f0', ring: '#94a3b8', ink: '#64748b' },
} as const

/**
 * A map pin, with its name attached.
 *
 * The label is drawn into the marker rather than hidden behind a click: a
 * dispatcher looking at six technicians needs to know which is which without
 * probing each one, and a bare emoji disc answers nothing.
 *
 * `stale` is a real state, not a styling flourish. A position an hour old drawn
 * identically to a live one tells the desk someone is standing somewhere they
 * left long ago, which is worse than showing nothing — so a stale pin is greyed
 * and dashed, and says so.
 */
function pinSvg(emoji: string, tone: PinTone, label?: string) {
  const { fill, ring, ink } = PIN_TONE[tone]
  const dash = tone === 'stale' ? ' stroke-dasharray="4 3"' : ''
  const text = (label || '').slice(0, 18)
  // Width follows the label so long names are not clipped by a fixed viewBox.
  const w = Math.max(56, text.length * 6.4 + 26)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="64" viewBox="0 0 ${w} 64">
    <g>
      <circle cx="${w / 2}" cy="21" r="17" fill="${fill}" stroke="${ring}" stroke-width="3"${dash}/>
      <text x="${w / 2}" y="27" font-size="16" text-anchor="middle">${emoji}</text>
      ${text ? `<rect x="1" y="42" width="${w - 2}" height="18" rx="9" fill="${fill}" stroke="${ring}" stroke-width="1.5"${dash}/>
      <text x="${w / 2}" y="55" font-size="10.5" font-weight="700" text-anchor="middle" fill="${ink}" font-family="system-ui,sans-serif">${escapeXml(text)}</text>` : ''}
    </g>
  </svg>`
}

/** Labels are user-supplied names; unescaped `&` or `<` breaks the whole SVG. */
function escapeXml(s: string) {
  return s.replace(/[<>&'"]/g, (ch) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[ch] as string)
  )
}

export type PinTone = 'depot' | 'active' | 'idle' | 'stale'

export interface MapPoint {
  id: string
  lat: number
  lng: number
  label: string
  icon: string
  tone: PinTone
  /** Shown under the label in the popup — "last seen 4 min ago", an ETA, a berth. */
  detail?: string
}

const MUTED_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#f3f6f9' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#64748b' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#bfe3f0' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
]

import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

/**
 * The Leaflet fallback's pin.
 *
 * Takes `tone` for the same reason the Google one does: this used to hardcode
 * amber, so whenever Google Maps failed to load — exactly when you can least
 * afford ambiguity — depot, active, idle and stale all rendered identically and
 * the map became decorative.
 */
const fleetPinIcon = (icon: string, tone: PinTone, label: string) =>
  L.divIcon({
    className: 'bp-fleet-pin',
    html: `<div style="display:flex;flex-direction:column;align-items:center;gap:3px">
      <div style="width:36px;height:36px;border-radius:50%;background:${PIN_TONE[tone].fill};border:3px ${tone === 'stale' ? 'dashed' : 'solid'} ${PIN_TONE[tone].ring};box-shadow:0 6px 16px rgba(0,0,0,.3);display:grid;place-items:center;font-size:16px">${icon}</div>
      <span style="background:${PIN_TONE[tone].fill};color:${PIN_TONE[tone].ink};border:1px solid ${PIN_TONE[tone].ring};border-radius:9px;padding:1px 7px;font-size:10.5px;font-weight:700;white-space:nowrap;font-family:system-ui,sans-serif">${escapeXml(label.slice(0, 18))}</span>
    </div>`,
    iconSize: [120, 58],
    iconAnchor: [60, 40],
  })

/**
 * Frames every pin, instead of trusting a fixed centre and zoom.
 *
 * `FleetMap` took `center`/`zoom` and never looked at the points, so anything
 * outside that window was simply invisible — a technician who drove across town
 * vanished from a tracker whose whole job is showing where people are. One pin
 * keeps the caller's zoom (there is no extent to fit); several are framed with
 * padding.
 */
function fitToPoints(google: any, map: any, points: MapPoint[], fallbackZoom: number) {
  if (!points.length) return
  if (points.length === 1) {
    map.setCenter({ lat: points[0].lat, lng: points[0].lng })
    map.setZoom(fallbackZoom)
    return
  }
  const bounds = new google.maps.LatLngBounds()
  points.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }))
  map.fitBounds(bounds, { top: 56, right: 56, bottom: 56, left: 56 })
}

export function FleetMap({ points, center, zoom = 9, width = '100%', height = 420, onPointClick }: {
  points: MapPoint[]; center: { lat: number; lng: number }; zoom?: number
  width?: number | string; height?: number | string; onPointClick: (id: string) => void
}) {
  const mapDivRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const markersRef = useRef<any[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    loadGoogleMaps()
      .then(() => {
        if (cancelled || !mapDivRef.current) return
        const google = (window as any).google
        mapRef.current = new google.maps.Map(mapDivRef.current, {
          center, zoom, styles: MUTED_MAP_STYLE, disableDefaultUI: false,
          zoomControl: true, streetViewControl: false, mapTypeControl: false, fullscreenControl: false,
        })
        setStatus('ready')
      })
      .catch(() => setStatus('error'))
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (status !== 'ready' || !mapRef.current) return
    const google = (window as any).google
    markersRef.current.forEach(m => m.setMap(null))
    markersRef.current = points.map(p => {
      const svg = pinSvg(p.icon, p.tone, p.label)
      // The pin's width tracks its label, so the size and anchor have to be read
      // back off the SVG rather than assumed — a fixed 42px box squashed every
      // long name into an unreadable smear.
      const w = Number(/width="(\d+)"/.exec(svg)?.[1] ?? 56)
      const marker = new google.maps.Marker({
        position: { lat: p.lat, lng: p.lng },
        map: mapRef.current,
        title: p.detail ? `${p.label} — ${p.detail}` : p.label,
        icon: {
          url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
          scaledSize: new google.maps.Size(w, 64),
          anchor: new google.maps.Point(w / 2, 21),
        },
        // Only the selected pin animates. Dropping every marker on each refresh
        // made the whole board jump every time one position updated.
        animation: p.tone === 'active' ? google.maps.Animation.DROP : undefined,
        zIndex: p.tone === 'active' ? 3 : p.tone === 'depot' ? 2 : 1,
      })
      marker.addListener('click', () => onPointClick(p.id))
      return marker
    })

    fitToPoints(google, mapRef.current, points, zoom)
  }, [status, points, zoom])

  return (
    <div style={{ width, height }} className="relative overflow-hidden rounded-2xl bg-sand ring-1 ring-slate-200">
      {/* The Google map needs its div mounted before it can load into it. This
          used to render only once `ready`, which the loader could never reach
          without the div, so every map sat on the Leaflet fallback for good.
          `isolate` keeps the map's own z-indexes (Leaflet panes run to 1000)
          inside this box, so controls a page floats over the map stay on top. */}
      <div ref={mapDivRef} className={`absolute inset-0 isolate ${status === 'error' ? 'hidden' : ''}`} />
      {status === 'loading' && (
        <div className="absolute inset-0 grid place-items-center bg-sand text-xs font-semibold text-slate-400">
          <span className="flex items-center gap-2"><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ocean-400/40 border-t-ocean-500" />{translatePortalText('Loading map…')}</span>
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 isolate">
        {/* Fell back to Dubai Marina when a caller passed no centre. */}
        <MapContainer center={[center.lat || DEFAULT_MAP_CENTRE.lat, center.lng || DEFAULT_MAP_CENTRE.lng]} zoom={zoom} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            attribution='&copy; Google Maps'
            url="https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}"
            subdomains={['0', '1', '2', '3']}
            maxZoom={20}
          />
          {points.map(p => (
            <Marker
              key={p.id}
              position={[p.lat, p.lng]}
              icon={fleetPinIcon(p.icon, p.tone, p.label)}
              eventHandlers={{ click: () => onPointClick(p.id) }}
            >
              <Popup>
                <div className="text-xs font-bold text-deep-900">{p.label}</div>
                {!!p.detail && <div className="text-[11px] text-slate-500">{p.detail}</div>}
              </Popup>
            </Marker>
          ))}
        </MapContainer>
        </div>
      )}

      {/* A key, because four pin colours carrying four meanings is not
          self-evident. Sits over the map rather than above it so it does not
          steal vertical space from the thing it describes. */}
      {points.length > 0 && (
        <div className="pointer-events-none absolute bottom-3 start-3 z-10 flex flex-wrap gap-2 rounded-xl bg-white/90 px-2.5 py-1.5 shadow-soft backdrop-blur dark:bg-deep-900/80">
          {([
            ['depot', 'Base'],
            ['active', 'Selected'],
            ['idle', 'On duty'],
            ['stale', 'Last seen'],
          ] as const)
            .filter(([tone]) => points.some(p => p.tone === tone))
            .map(([tone, label]) => (
              <span key={tone} className="flex items-center gap-1 text-[10px] font-bold text-slate-600 dark:text-slate-300">
                <span
                  className="h-2.5 w-2.5 rounded-full border"
                  style={{ background: PIN_TONE[tone].fill, borderColor: PIN_TONE[tone].ring }}
                />
                {translatePortalText(label)}
              </span>
            ))}
        </div>
      )}
    </div>
  )
}

// ── 2D / 3D map switcher ───────────────────────────────────────
export function MapModeToggle({ mode, onChange }: { mode: '2d' | '3d'; onChange: (m: '2d' | '3d') => void }) {
  const opts = [{ k: '2d', label: '2D' }, { k: '3d', label: '3D Earth' }] as const
  return (
    <div className="flex gap-1 rounded-xl bg-white p-1 shadow-soft ring-1 ring-slate-100">
      {opts.map(o => (
        <button key={o.k} onClick={() => onChange(o.k)} title={translatePortalText(`${o.label} view`)}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${mode === o.k ? 'bg-gradient-to-r from-amber-600 to-orange-400 text-white shadow-glow' : 'text-slate-500 hover:text-deep-900'}`}>
          {translatePortalText(o.label)}
        </button>
      ))}
    </div>
  )
}

// ── real photorealistic 3D map (Google Earth-style WebGL tiles) ─
// Falls back to `onUnsupported` if the API key/project isn't provisioned for
// the Photorealistic 3D Maps (maps3d) feature — it's a newer, separately
// gated capability, unlike the classic 2D Maps JS API used by FleetMap.
export function Fleet3DMap({ points, center, tilt = 45, range = 14000, width = '100%', height = 420, onPointClick, onUnsupported }: {
  points: MapPoint[]; center: { lat: number; lng: number }; tilt?: number; range?: number
  width?: number | string; height?: number | string; onPointClick: (id: string) => void; onUnsupported?: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const markersRef = useRef<any[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    loadGoogleMaps()
      .then(() => {
        if (cancelled || !containerRef.current) return
        const google = (window as any).google
        if (!google?.maps?.maps3d?.Map3DElement) throw new Error('Photorealistic 3D Maps not available on this key')
        const map3d = new google.maps.maps3d.Map3DElement({
          center: { lat: center.lat, lng: center.lng, altitude: 0 },
          tilt, range, heading: 15, mode: 'HYBRID',
        })
        containerRef.current.innerHTML = ''
        containerRef.current.appendChild(map3d)
        mapRef.current = map3d
        setStatus('ready')
      })
      .catch(() => { setStatus('error'); onUnsupported?.() })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (status !== 'ready' || !mapRef.current) return
    const google = (window as any).google
    markersRef.current.forEach(m => m.remove())
    // Derived from the one palette, so the 3D view cannot drift from the 2D one.
    const colors: Record<PinTone, string> = {
      depot: PIN_TONE.depot.fill,
      active: PIN_TONE.active.fill,
      idle: '#94a3b8',
      stale: PIN_TONE.stale.ring,
    }
    // Outside alpha only the interactive marker fires `gmp-click`.
    const Marker3D = google.maps.maps3d.Marker3DInteractiveElement ?? google.maps.maps3d.Marker3DElement
    markersRef.current = points.map(p => {
      const marker = new Marker3D({
        position: { lat: p.lat, lng: p.lng, altitude: 40 },
        label: p.label,
        altitudeMode: 'RELATIVE_TO_GROUND',
        extruded: true,
      })
      if ('color' in marker) marker.color = colors[p.tone]
      marker.addEventListener('gmp-click', () => onPointClick(p.id))
      mapRef.current.appendChild(marker)
      return marker
    })
  }, [status, points])

  return (
    <div style={{ width, height }} className="relative overflow-hidden rounded-2xl bg-sand">
      <div ref={containerRef} className="h-full w-full isolate" />
      {status === 'loading' && (
        <div className="absolute inset-0 grid place-items-center bg-sand text-xs font-semibold text-slate-400">
          <span className="flex items-center gap-2"><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-400/40 border-t-amber-500" />{translatePortalText(" Loading 3D Earth…")}</span>
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 grid place-items-center bg-sand px-6 text-center text-xs font-semibold text-rose-500">{translatePortalText("Photorealistic 3D Maps isn't enabled for this API key/project — switched back to the 2D map.")}</div>
      )}
    </div>
  )
}
