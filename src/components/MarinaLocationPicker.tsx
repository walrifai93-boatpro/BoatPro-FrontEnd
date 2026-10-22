import React, { useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Search, MapPin, Loader2, Crosshair } from 'lucide-react'
import { mapsApi, type GeoResult } from '../api'
import { formatPortalNumber, translatePortalText } from '../i18n/runtime'


// ── Live marina location picker ───────────────────────────────────────────
// Search a place, drag the pin, or click the map. Reverse-geocodes to a live
// address. Backed by the same /maps endpoints the mobile apps use.

export interface PickedPoint { latitude: number; longitude: number; address: string; city?: string }

// Anchor-style boat pin (avoids Leaflet's broken default marker image in bundlers).
const pinIcon = L.divIcon({
  className: 'bp-pin',
  html: `<div style="width:34px;height:34px;border-radius:50%;background:#1b9bbf;border:3px solid #fff;
    box-shadow:0 6px 16px rgba(11,59,107,.35);display:grid;place-items:center;font-size:15px">⚓</div>`,
  iconSize: [34, 34],
  iconAnchor: [17, 34],
})

function FlyTo({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap()
  const last = React.useRef('')
  React.useEffect(() => {
    const key = `${lat},${lng}`
    if (key !== last.current) { last.current = key; map.setView([lat, lng], map.getZoom() < 9 ? 10 : map.getZoom()) }
  }, [lat, lng, map])
  return null
}

function ClickCapture({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({ click(e) { onClick(e.latlng.lat, e.latlng.lng) } })
  return null
}

export default function MarinaLocationPicker({
  value,
  onChange,
  height = 300,
}: {
  value: PickedPoint
  onChange: (p: PickedPoint) => void
  height?: number
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GeoResult[]>([])
  const [searching, setSearching] = useState(false)
  // The query that last came back empty — without it a miss looked exactly like
  // a search that never ran (the map just sat there).
  const [missed, setMissed] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)

  const reverse = (lat: number, lng: number) => {
    setResolving(true)
    // A failed lookup (or one the server could not resolve) saves "Location
    // pinned", never the coordinates as text — they were stored as the
    // address and shown as a place ("21.48580, 39.19250").
    const pinned = translatePortalText('Location pinned')
    const isCoordText = (a?: string) => !a || /^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$/.test(a)
    mapsApi.reverse(lat, lng)
      .then((r) => onChange({ latitude: lat, longitude: lng, address: isCoordText(r.data.address) ? pinned : r.data.address }))
      .catch(() => onChange({ latitude: lat, longitude: lng, address: pinned }))
      .finally(() => setResolving(false))
  }

  const runSearch = () => {
    const q = query.trim()
    if (q.length < 2) return
    setSearching(true)
    setMissed(null)
    mapsApi.geocode(q)
      .then((r) => { setResults(r.data.results); if (!r.data.results.length) setMissed(q) })
      .catch(() => { setResults([]); setMissed(q) })
      .finally(() => setSearching(false))
  }

  const pick = (r: GeoResult) => {
    setResults([]); setQuery('')
    onChange({ latitude: r.latitude, longitude: r.longitude, address: r.label })
  }

  return (
    <div className="relative">
      {/* search */}
      <div className="mb-3 flex gap-2">
        <div className="relative flex-1">
          <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setMissed(null) }}
            onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            placeholder={translatePortalText("Search a place, harbor or address…")}
            className="input ps-9"
          />
          {missed && results.length === 0 && (
            <p className="mt-1.5 text-[11px] font-semibold text-amber-700">
              {translatePortalText('No places found for')} “{missed}”. {translatePortalText('Try one word (e.g. Obhur), or click the map to drop the pin.')}
            </p>
          )}
          {results.length > 0 && (
            <div className="card absolute start-0 end-0 top-full z-[1000] mt-1 max-h-60 overflow-y-auto !rounded-xl !p-1.5 shadow-lift">
              {results.map((r, i) => (
                <button key={i} type="button" onClick={() => pick(r)}
                  className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition hover:bg-ocean-50">
                  <MapPin size={14} className="mt-0.5 shrink-0 text-ocean-500" />
                  <span className="text-slate-600">{r.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" onClick={runSearch} className="btn-primary !px-4" disabled={searching}>
          {searching ? <Loader2 size={15} className="animate-spin" /> : translatePortalText('Search')}
        </button>
      </div>

      {/* map */}
      <div className="overflow-hidden rounded-2xl ring-1 ring-slate-200" style={{ height }}>
        <MapContainer center={[value.latitude, value.longitude]} zoom={10} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
          <TileLayer
            attribution='&copy; Google Maps'
            url="https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}"
            subdomains={['0', '1', '2', '3']}
            maxZoom={20}
          />
          <FlyTo lat={value.latitude} lng={value.longitude} />
          <ClickCapture onClick={reverse} />
          <Marker
            position={[value.latitude, value.longitude]}
            icon={pinIcon}
            draggable
            eventHandlers={{ dragend: (e) => { const m = e.target as L.Marker; const ll = m.getLatLng(); reverse(ll.lat, ll.lng) } }}
          />
        </MapContainer>
      </div>

      {/* current address */}
      <div className="mt-3 flex items-start gap-2 rounded-xl bg-sand px-3.5 py-3">
        <Crosshair size={15} className="mt-0.5 shrink-0 text-ocean-500" />
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{translatePortalText("Marina location")}</p>
          <p className="text-[13px] font-semibold text-deep-900">{resolving ? translatePortalText('Locating…') : (value.address || translatePortalText('Drag the pin or search to set the location'))}</p>
          <p className="mt-0.5 text-[11px] text-slate-400">{formatPortalNumber(value.latitude, { minimumFractionDigits: 5, maximumFractionDigits: 5 })}, {formatPortalNumber(value.longitude, { minimumFractionDigits: 5, maximumFractionDigits: 5 })}</p>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-slate-400">{translatePortalText("Search, click the map, or drag the ⚓ pin to set exactly where boaters arrive.")}</p>
    </div>
  )
}
