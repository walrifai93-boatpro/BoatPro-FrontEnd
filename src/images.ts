// ─────────────────────────────────────────────────────────────
// Decorative imagery for the portal chrome.
//
// These are the stock photographs the design uses for the hero banners and the
// sidebar marina card. They are only ever a *fallback*: wherever a marina has
// uploaded its own photos, those are shown instead (see `marinaPhoto`).
// ─────────────────────────────────────────────────────────────
import { translatePortalText } from './i18n/runtime'

export const IMG = {
  hero: 'https://images.unsplash.com/photo-1567899378494-47b22a2ae96a?w=1600&q=75&auto=format&fit=crop',
  marina1: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=1200&q=70&auto=format&fit=crop',
  marina2: 'https://images.unsplash.com/photo-1500930287596-c1ecaa373bb2?w=1200&q=70&auto=format&fit=crop',
  marina3: 'https://images.unsplash.com/photo-1468581264429-2548ef9eb732?w=1200&q=70&auto=format&fit=crop',
  yacht1: 'https://images.unsplash.com/photo-1559827260-dc66d52bef19?w=1200&q=70&auto=format&fit=crop',
  yacht2: 'https://images.unsplash.com/photo-1569263979104-865ab7cd8d13?w=1200&q=70&auto=format&fit=crop',
  yacht3: 'https://images.unsplash.com/photo-1605281317010-fe5ffe798166?w=1200&q=70&auto=format&fit=crop',
  sail1: 'https://images.unsplash.com/photo-1534854638093-bada1813ca19?w=1200&q=70&auto=format&fit=crop',
  sail2: 'https://images.unsplash.com/photo-1508515053963-70c7cc39dfb5?w=1200&q=70&auto=format&fit=crop',
  harbor1: 'https://images.unsplash.com/photo-1516796181074-bf453fbfa3e6?w=1200&q=70&auto=format&fit=crop',
  dock1: 'https://images.unsplash.com/photo-1519302959554-a75be0afc82a?w=1200&q=70&auto=format&fit=crop',
  ocean1: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&q=70&auto=format&fit=crop',
  fuel: 'https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=800&q=70&auto=format&fit=crop',
  pool: 'https://images.unsplash.com/photo-1540541338287-41700207dee6?w=800&q=70&auto=format&fit=crop',
  restaurant: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800&q=70&auto=format&fit=crop',
  night: 'https://images.unsplash.com/photo-1493558103817-58b2924bce98?w=1200&q=70&auto=format&fit=crop',
}


/** The listing kinds the admin and marina surfaces render tiles for. */
export type ListingKind = 'boat' | 'marina' | 'fuel' | 'workshop'

/** Shown in place of initials when the record has no usable name either. */
const KIND_FALLBACK_GLYPH: Record<ListingKind, string> = {
  boat: '⛵',
  marina: '⚓',
  fuel: '⛽',
  workshop: '🔧',
}

/**
 * The mark drawn above the initials, per kind. Plain geometry rather than an
 * icon font so the tile stays a self-contained data URI.
 */
const KIND_MARK: Record<ListingKind, (hue: number) => string> = {
  // Sail and hull.
  boat: hue =>
    `<path d="M240 96l52 74H188z" fill="hsl(${hue} 30% 74%)"/>
     <rect x="180" y="170" width="120" height="16" rx="8" fill="hsl(${hue} 28% 66%)"/>`,
  // A jetty on piles.
  marina: hue =>
    `<rect x="150" y="150" width="180" height="14" rx="7" fill="hsl(${hue} 30% 74%)"/>
     <rect x="168" y="164" width="12" height="40" rx="6" fill="hsl(${hue} 28% 66%)"/>
     <rect x="234" y="164" width="12" height="40" rx="6" fill="hsl(${hue} 28% 66%)"/>
     <rect x="300" y="164" width="12" height="40" rx="6" fill="hsl(${hue} 28% 66%)"/>`,
  // A pump with its hose.
  fuel: hue =>
    `<rect x="192" y="104" width="72" height="100" rx="10" fill="hsl(${hue} 30% 74%)"/>
     <rect x="206" y="120" width="44" height="30" rx="5" fill="hsl(${hue} 32% 88%)"/>
     <path d="M264 132h22a10 10 0 0 1 10 10v46" stroke="hsl(${hue} 28% 66%)" stroke-width="11"
       fill="none" stroke-linecap="round"/>`,
  // A gear.
  workshop: hue =>
    `<circle cx="240" cy="152" r="46" fill="hsl(${hue} 30% 74%)"/>
     <circle cx="240" cy="152" r="18" fill="hsl(${hue} 32% 92%)"/>
     <g fill="hsl(${hue} 28% 66%)">
       <rect x="231" y="92" width="18" height="22" rx="4"/><rect x="231" y="190" width="18" height="22" rx="4"/>
       <rect x="180" y="143" width="22" height="18" rx="4"/><rect x="278" y="143" width="22" height="18" rx="4"/>
     </g>`,
}

/**
 * A stand-in tile for a listing there is no photograph of — a vessel, a
 * marina, a bunkering point, a workshop.
 *
 * See the note on `boatPhoto` below for why this is generated rather than
 * chosen from a pool of stock photographs: the same reasoning applies to every
 * kind. An admin scanning the provider directory is doing the same job the
 * marina staff are — working out which record is which — and a confident
 * photograph of somewhere else is worse than an obvious placeholder.
 */
export function listingPhoto(key?: string | null, kind: ListingKind = 'boat'): string {
  const name = (key || '').trim()

  // A stable hue per record, spread around the wheel so adjacent rows differ.
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0
  const hue = Math.abs(hash) % 360

  // Up to two initials, skipping words that are not letters or digits.
  const initials =
    name
      .split(/\s+/)
      .filter(w => /[\p{L}\p{N}]/u.test(w))
      .slice(0, 2)
      .map(w => w[0])
      .join('')
      .toUpperCase() || KIND_FALLBACK_GLYPH[kind]

  // `encodeURIComponent` rather than base64: it keeps the markup readable in
  // devtools, and the initials may be Arabic, which btoa cannot encode at all.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320">
    <rect width="480" height="320" fill="hsl(${hue} 32% 92%)"/>
    <path d="M0 236c60-14 120 10 180-4s120-26 180-10 90 22 120 14v76H0z" fill="hsl(${hue} 34% 86%)"/>
    ${KIND_MARK[kind](hue)}
    <text x="240" y="252" font-family="system-ui, sans-serif" font-size="34" font-weight="700"
      fill="hsl(${hue} 24% 46%)" text-anchor="middle">${escapeXml(initials)}</text>
    <text x="240" y="286" font-family="system-ui, sans-serif" font-size="15"
      fill="hsl(${hue} 20% 58%)" text-anchor="middle">${escapeXml(translatePortalText('no photo on record'))}</text>
  </svg>`

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/**
 * A stand-in tile for a vessel the marina has no photograph of.
 *
 * This function used to hash the boat's name and return one of ten stock
 * photographs from a list of real, specific, professionally shot yachts,
 * rendered at 176px tall in the berth detail panel with the customer's boat
 * name printed underneath it.
 *
 * It was deterministic, which made it worse rather than better: the same vessel
 * showed the same photograph every time, so it read as a record of that boat
 * rather than as decoration. Marina staff use these panels to identify what is
 * alongside — on the dock map, on arrivals and departures, on the movements
 * board — and a confident photograph of the wrong hull is worse than no
 * photograph at all.
 *
 * There is no honest photo to substitute. The marina portal builds its boat
 * list from `DockSubscription` records, where `boatName` is free text with no
 * reference to a `Boat` document, so no uploaded image is reachable for these
 * rows at all.
 */
export function boatPhoto(key?: string | null): string {
  return listingPhoto(key, 'boat')
}

/** The five characters that cannot appear raw in XML text. */
function escapeXml(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
