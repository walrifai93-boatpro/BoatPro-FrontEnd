// ---------------------------------------------------------------------------
// Harbour art kit — the drawing primitives behind the live dock map.
//
// Everything here is plain SVG in a top-down (bird's-eye) view, so the dock map
// reads like a chart of the real marina rather than a grid of boxes: timber
// pontoons with plank seams and pilings, and vessels drawn as actual hulls
// whose planform follows the boat's real category and whose size follows her
// real registered length and beam.
//
// Convention for every vessel: drawn centred on the origin with the BOW along
// +x, so a caller moors her by translating to the slip and rotating 0° (bow to
// starboard) or 180° (bow to port).
//
// Light in this scene comes from the top-left, so raised structures cast to the
// bottom-right. Vessel shadows are deliberately NOT baked in — the caller wraps
// the rotated vessel in `filter="url(#hbHull)"` so the shadow stays in world
// space instead of spinning with the hull.
// ---------------------------------------------------------------------------
import React from 'react'
import { formatPortalNumber, translatePortalText } from './i18n/runtime'

/* ══════════════════════════ liveries ══════════════════════════ */

export interface HullStyle {
  /** Topsides. */ hull: string
  /** Shadowed edge of the topsides. */ shade: string
  /** Deck / non-skid. */ deck: string
  /** Superstructure. */ cabin: string
  /** Tinted glass. */ glass: string
  /** Cove stripe, rails, hardware. */ trim: string
}

/**
 * Hull liveries you actually see on a pontoon — gloss white through to navy,
 * teak and painted decks mixed, so a full marina reads as a varied fleet rather
 * than rows of identical white blobs.
 */
const HULLS: HullStyle[] = [
  { hull: '#fbfdfe', shade: '#93a7b6', deck: '#c2a173', cabin: '#ffffff', glass: '#12303f', trim: '#14506b' },
  { hull: '#173a58', shade: '#081d2e', deck: '#cfdbe5', cabin: '#f4f9fc', glass: '#08181f', trim: '#c9a765' },
  { hull: '#252e39', shade: '#0f151b', deck: '#b9946b', cabin: '#e9f0f6', glass: '#080e14', trim: '#8ea3b6' },
  { hull: '#c8d6e0', shade: '#8598a7', deck: '#a9b8c6', cabin: '#ffffff', glass: '#1b3e52', trim: '#18627f' },
  { hull: '#5f1e2c', shade: '#320b14', deck: '#ddd0bd', cabin: '#f8f3ec', glass: '#150a0e', trim: '#d6b06a' },
  { hull: '#0d4a43', shade: '#04241f', deck: '#bd9c72', cabin: '#eff8f5', glass: '#051a18', trim: '#9dc8bf' },
]

/** Stable per-vessel livery — the same boat always paints the same colour. */
export function hullFor(seed: string): HullStyle {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return HULLS[h % HULLS.length]
}

const r = (n: number) => Math.round(n * 100) / 100

/* ══════════════════════════ hull geometry ══════════════════════════ */

interface HullShape {
  /** Where maximum beam falls, as a fraction of half-length (−ve = aft of midships). */
  beamAt?: number
  /** Fullness of the forward entry — low is a fine, knife-like bow. */
  entry?: number
  /** Transom width as a fraction of maximum beam. */
  transom?: number
}

/**
 * A hull in plan view: squared transom aft, sweeping out to maximum beam and
 * then tapering to a point at the stem. Curvature is continuous, which is what
 * stops it looking like a rounded box.
 */
export function hullOutline(L: number, B: number, shape: HullShape = {}): string {
  const { beamAt = -0.1, entry = 0.44, transom = 0.84 } = shape
  const hl = L / 2
  const hb = B / 2
  const mx = hl * beamAt              // station of maximum beam
  const tb = hb * transom
  const q = (mx - hl) / 2             // control point between transom and max beam
  return [
    `M ${r(-hl)} ${r(-tb)}`,
    `C ${r(-hl * 0.74)} ${r(-hb * 0.97)} ${r(q)} ${r(-hb)} ${r(mx)} ${r(-hb)}`,
    `C ${r(hl * entry)} ${r(-hb * 0.95)} ${r(hl * 0.84)} ${r(-hb * 0.44)} ${r(hl)} 0`,
    `C ${r(hl * 0.84)} ${r(hb * 0.44)} ${r(hl * entry)} ${r(hb * 0.95)} ${r(mx)} ${r(hb)}`,
    `C ${r(q)} ${r(hb)} ${r(-hl * 0.74)} ${r(hb * 0.97)} ${r(-hl)} ${r(tb)}`,
    'Z',
  ].join(' ')
}

/** Topsides, boot-top, cove stripe and side decks — shared by every hull. */
function Shell({ L, B, shape, s }: { L: number; B: number; shape: HullShape; s: HullStyle }) {
  return (
    <>
      {/* topsides */}
      <path d={hullOutline(L, B, shape)} fill={s.hull} />
      {/* boot-top — the dark line right on the waterline */}
      <path d={hullOutline(L, B, shape)} fill="none" stroke={s.shade} strokeWidth={1.6} />
      {/* rubbing strake running the length of the sheer */}
      <path d={hullOutline(L - B * 0.08, B * 0.92, shape)} fill="none" stroke={s.trim} strokeWidth={1.5} opacity={0.9} />
      {/* deck, inset enough that the topsides still read as a colour */}
      <path d={hullOutline(L - B * 0.3, B * 0.7, shape)} fill={s.deck} />
      <path d={hullOutline(L - B * 0.3, B * 0.7, shape)} fill="none" stroke="rgba(0,0,0,.18)" strokeWidth={0.8} />
    </>
  )
}

/** A raised structure's cast shadow — light from the top-left. */
function Cast({ d, dx = 1.5, dy = 2.3 }: { d: string; dx?: number; dy?: number }) {
  return <path d={d} fill="rgba(4,22,34,.34)" transform={`translate(${dx} ${dy})`} />
}

/** Port/starboard sidelights at the stem — red to port, green to starboard. */
function Sidelights({ L, B }: { L: number; B: number }) {
  return (
    <>
      <circle cx={r(L * 0.37)} cy={r(-B * 0.2)} r={1.5} fill="#f43f5e" />
      <circle cx={r(L * 0.37)} cy={r(B * 0.2)} r={1.5} fill="#22c55e" />
    </>
  )
}

/* ══════════════════════════ vessels by category ══════════════════════════ */

interface PartProps { L: number; B: number; s: HullStyle }

const rrect = (x: number, y: number, w: number, h: number, rad: number) =>
  `M ${r(x + rad)} ${r(y)} H ${r(x + w - rad)} A ${rad} ${rad} 0 0 1 ${r(x + w)} ${r(y + rad)}
   V ${r(y + h - rad)} A ${rad} ${rad} 0 0 1 ${r(x + w - rad)} ${r(y + h)}
   H ${r(x + rad)} A ${rad} ${rad} 0 0 1 ${r(x)} ${r(y + h - rad)}
   V ${r(y + rad)} A ${rad} ${rad} 0 0 1 ${r(x + rad)} ${r(y)} Z`

/** Flybridge motor yacht — saloon, wrap screen, radar arch, anchor pulpit. */
function YachtTop({ L, B, s }: PartProps) {
  const saloon = `M ${r(-L * 0.26)} ${r(-B * 0.25)} L ${r(L * 0.03)} ${r(-B * 0.25)}
    Q ${r(L * 0.14)} ${r(-B * 0.22)} ${r(L * 0.16)} 0
    Q ${r(L * 0.14)} ${r(B * 0.22)} ${r(L * 0.03)} ${r(B * 0.25)}
    L ${r(-L * 0.26)} ${r(B * 0.25)} Q ${r(-L * 0.3)} 0 ${r(-L * 0.26)} ${r(-B * 0.25)} Z`
  const fly = rrect(-L * 0.15, -B * 0.15, L * 0.18, B * 0.3, 3.5)
  return (
    <>
      {/* bathing platform + planked cockpit sole */}
      <path d={rrect(-L * 0.52, -B * 0.2, L * 0.06, B * 0.4, 2)} fill={s.deck} opacity={0.8} />
      <path d={rrect(-L * 0.44, -B * 0.22, L * 0.16, B * 0.44, 3)} fill="rgba(0,0,0,.14)" />
      {[0.03, 0.06, 0.09, 0.12].map(f => (
        <line key={f} x1={r(-L * 0.44 + L * f)} y1={r(-B * 0.2)} x2={r(-L * 0.44 + L * f)} y2={r(B * 0.2)}
          stroke="rgba(0,0,0,.16)" strokeWidth={0.6} />
      ))}
      {/* saloon */}
      <Cast d={saloon} />
      <path d={saloon} fill={s.cabin} stroke="rgba(0,0,0,.22)" strokeWidth={0.9} />
      {/* wrap-around screen */}
      <path fill={s.glass}
        d={`M ${r(L * 0.03)} ${r(-B * 0.22)} Q ${r(L * 0.125)} ${r(-B * 0.19)} ${r(L * 0.142)} 0
            Q ${r(L * 0.125)} ${r(B * 0.19)} ${r(L * 0.03)} ${r(B * 0.22)} Z`} />
      <path fill="rgba(255,255,255,.3)"
        d={`M ${r(L * 0.05)} ${r(-B * 0.19)} Q ${r(L * 0.12)} ${r(-B * 0.14)} ${r(L * 0.128)} ${r(-B * 0.03)} L ${r(L * 0.06)} ${r(-B * 0.06)} Z`} />
      {/* saloon side glass */}
      {[-1, 1].map(sd => (
        <rect key={sd} x={r(-L * 0.2)} y={r(sd * B * 0.24 - 1.3)} width={r(L * 0.19)} height={2.6} rx={1.3}
          fill={s.glass} opacity={0.85} />
      ))}
      {/* flybridge */}
      <Cast d={fly} dy={2.6} />
      <path d={fly} fill={s.cabin} stroke="rgba(0,0,0,.28)" strokeWidth={0.9} />
      <path d={fly} fill="rgba(4,22,34,.1)" />
      <rect x={r(-L * 0.03)} y={r(-B * 0.09)} width={r(L * 0.05)} height={r(B * 0.18)} rx={1.6} fill={s.glass} opacity={0.6} />
      {/* radar arch + dome */}
      <path d={`M ${r(-L * 0.165)} ${r(-B * 0.17)} Q ${r(-L * 0.215)} 0 ${r(-L * 0.165)} ${r(B * 0.17)}`}
        fill="none" stroke={s.trim} strokeWidth={1.7} />
      <circle cx={r(-L * 0.2)} cy={0} r={2.4} fill="#eef3f8" stroke="#7d94a6" strokeWidth={0.7} />
      {/* foredeck hatch, windlass, pulpit */}
      <rect x={r(L * 0.2)} y={r(-B * 0.07)} width={r(L * 0.07)} height={r(B * 0.14)} rx={1.8} fill={s.glass} opacity={0.55} />
      <line x1={r(L * 0.32)} y1={0} x2={r(L * 0.46)} y2={0} stroke={s.trim} strokeWidth={1.4} />
      <circle cx={r(L * 0.33)} cy={0} r={1.8} fill="#8b9db0" />
      <Sidelights L={L} B={B} />
    </>
  )
}

/** Open sportsboat — bucket seats, low screen, transom outboard. */
function SpeedboatTop({ L, B, s }: PartProps) {
  const cockpit = `M ${r(-L * 0.26)} ${r(-B * 0.2)} L ${r(L * 0.0)} ${r(-B * 0.22)}
    Q ${r(L * 0.1)} ${r(-B * 0.18)} ${r(L * 0.11)} 0
    Q ${r(L * 0.1)} ${r(B * 0.18)} ${r(L * 0.0)} ${r(B * 0.22)}
    L ${r(-L * 0.26)} ${r(B * 0.2)} Z`
  return (
    <>
      {/* hull-side flash */}
      <path d={hullOutline(L - B * 0.16, B * 0.84, { entry: 0.5, transom: 0.86 })}
        fill="none" stroke={s.trim} strokeWidth={2.2} opacity={0.5} />
      {/* aft sunpad */}
      <path d={rrect(-L * 0.44, -B * 0.2, L * 0.16, B * 0.4, 3)} fill={s.cabin} opacity={0.9} />
      <line x1={r(-L * 0.36)} y1={r(-B * 0.2)} x2={r(-L * 0.36)} y2={r(B * 0.2)} stroke="rgba(0,0,0,.12)" strokeWidth={0.7} />
      {/* cockpit well */}
      <path d={cockpit} fill={s.glass} opacity={0.9} />
      {/* helm + bucket seats */}
      <path d={rrect(-L * 0.22, -B * 0.16, L * 0.07, B * 0.13, 2)} fill={s.cabin} opacity={0.95} />
      <path d={rrect(-L * 0.22, B * 0.03, L * 0.07, B * 0.13, 2)} fill={s.cabin} opacity={0.95} />
      <path d={rrect(-L * 0.11, -B * 0.15, L * 0.06, B * 0.12, 2)} fill={s.cabin} opacity={0.8} />
      <circle cx={r(-L * 0.08)} cy={r(B * 0.09)} r={r(B * 0.06)} fill="none" stroke="#cbd5e1" strokeWidth={1.1} />
      {/* wind screen */}
      <path d={`M ${r(L * 0.0)} ${r(-B * 0.21)} Q ${r(L * 0.14)} 0 ${r(L * 0.0)} ${r(B * 0.21)}`}
        fill="rgba(198,230,246,.45)" stroke="#dceaf3" strokeWidth={1.7} />
      {/* foredeck hatch */}
      <rect x={r(L * 0.19)} y={r(-B * 0.06)} width={r(L * 0.06)} height={r(B * 0.12)} rx={1.5} fill={s.glass} opacity={0.5} />
      {/* outboard, hung off the transom */}
      <path d={rrect(-L * 0.6, -B * 0.1, L * 0.1, B * 0.2, 2.5)} fill="#242c36" />
      <path d={rrect(-L * 0.585, -B * 0.06, L * 0.05, B * 0.12, 2)} fill="#4a5563" />
      <Sidelights L={L} B={B} />
    </>
  )
}

/** Sloop — fine ends, spar on the centreline, sail covers, standing rigging. */
function SailboatTop({ L, B, s }: PartProps) {
  const roof = rrect(-L * 0.08, -B * 0.24, L * 0.3, B * 0.48, 5)
  return (
    <>
      {/* toe rail */}
      <path d={hullOutline(L - B * 0.2, B * 0.8, { beamAt: -0.02, entry: 0.3, transom: 0.62 })}
        fill="none" stroke={s.trim} strokeWidth={1.1} opacity={0.6} />
      {/* cockpit well + wheel */}
      <path d={rrect(-L * 0.36, -B * 0.24, L * 0.27, B * 0.48, 5)} fill={s.glass} opacity={0.72} />
      <circle cx={r(-L * 0.3)} cy={0} r={r(B * 0.16)} fill="none" stroke="#d3dde6" strokeWidth={1.3} />
      {/* winches */}
      {[-1, 1].map(sd => (
        <circle key={sd} cx={r(-L * 0.14)} cy={r(sd * B * 0.3)} r={1.9} fill="#aebdc9" stroke="#7c8d9c" strokeWidth={0.6} />
      ))}
      {/* coachroof + companionway */}
      <Cast d={roof} dy={2} />
      <path d={roof} fill={s.cabin} stroke="rgba(0,0,0,.2)" strokeWidth={0.9} />
      <rect x={r(-L * 0.07)} y={r(-B * 0.11)} width={r(L * 0.05)} height={r(B * 0.22)} rx={1.8} fill={s.glass} opacity={0.85} />
      {[-1, 1].map(sd => (
        <rect key={sd} x={r(L * 0.02)} y={r(sd * B * 0.19 - 1.1)} width={r(L * 0.15)} height={2.2} rx={1.1}
          fill={s.glass} opacity={0.85} />
      ))}
      {/* forestay + furled headsail on the roller */}
      <line x1={r(L * 0.07)} y1={0} x2={r(L * 0.46)} y2={0} stroke="#b9c6d2" strokeWidth={0.9} />
      <path d={rrect(L * 0.19, -1.9, L * 0.25, 3.8, 1.9)} fill="#eaf0f5" stroke="#b9c6d2" strokeWidth={0.6} />
      {/* boom with the mainsail flaked under its cover */}
      <Cast d={rrect(-L * 0.32, -2.6, L * 0.39, 5.2, 2.6)} dx={1} dy={1.8} />
      <path d={rrect(-L * 0.32, -2.6, L * 0.39, 5.2, 2.6)} fill="#f2f6f9" stroke="#b9c6d2" strokeWidth={0.7} />
      {/* shrouds to the chainplates */}
      {[-1, 1].map(sd => (
        <line key={sd} x1={r(L * 0.07)} y1={0} x2={r(-L * 0.01)} y2={r(sd * B * 0.38)} stroke="#c3ced9" strokeWidth={0.7} />
      ))}
      {/* mast heel */}
      <circle cx={r(L * 0.07)} cy={0} r={3} fill="#e4ebf1" stroke="#7d94a6" strokeWidth={0.9} />
      <circle cx={r(L * 0.07)} cy={0} r={1.2} fill="#8fa2b2" />
      {/* bow roller */}
      <circle cx={r(L * 0.44)} cy={0} r={1.6} fill="#8b9db0" />
    </>
  )
}

/** Cruising cat — twin hulls, bridgedeck saloon, forward trampoline. */
function CatamaranTop({ L, B, s }: PartProps) {
  const hb = B * 0.26            // beam of each demi-hull
  const off = B * 0.37           // hull centreline offset
  const shape: HullShape = { beamAt: -0.04, entry: 0.3, transom: 0.7 }
  const saloon = rrect(-L * 0.19, -off * 0.86, L * 0.29, off * 1.72, 5)
  return (
    <>
      {/* demi-hulls */}
      {[-1, 1].map(sd => (
        <g key={sd} transform={`translate(0 ${r(sd * off)})`}>
          <path d={hullOutline(L, hb, shape)} fill={s.hull} />
          <path d={hullOutline(L, hb, shape)} fill="none" stroke={s.shade} strokeWidth={1.3} />
          <path d={hullOutline(L - hb * 0.5, hb * 0.6, shape)} fill={s.deck} />
        </g>
      ))}
      {/* forward trampoline between the bows */}
      <path fill="url(#hbTramp)" stroke="rgba(255,255,255,.4)" strokeWidth={0.8}
        d={`M ${r(L * 0.08)} ${r(-off)} L ${r(L * 0.43)} 0 L ${r(L * 0.08)} ${r(off)} Z`} />
      {/* forebeam */}
      <line x1={r(L * 0.08)} y1={r(-off)} x2={r(L * 0.08)} y2={r(off)} stroke={s.trim} strokeWidth={1.8} opacity={0.8} />
      {/* bridgedeck / cockpit sole, a shade down from the saloon above it */}
      <path d={rrect(-L * 0.38, -off * 0.9, L * 0.5, off * 1.8, 4)} fill={s.deck} />
      <path d={rrect(-L * 0.38, -off * 0.9, L * 0.5, off * 1.8, 4)} fill="rgba(4,22,34,.16)" />
      <path d={rrect(-L * 0.38, -off * 0.9, L * 0.5, off * 1.8, 4)} fill="none" stroke="rgba(0,0,0,.22)" strokeWidth={0.9} />
      {/* saloon */}
      <Cast d={saloon} dy={2} />
      <path d={saloon} fill={s.cabin} stroke="rgba(0,0,0,.2)" strokeWidth={0.9} />
      <path fill={s.glass} opacity={0.9}
        d={`M ${r(L * 0.075)} ${r(-off * 0.76)} Q ${r(L * 0.115)} 0 ${r(L * 0.075)} ${r(off * 0.76)} Z`} />
      {[-1, 1].map(sd => (
        <rect key={sd} x={r(-L * 0.14)} y={r(sd * off * 0.83 - 1.2)} width={r(L * 0.19)} height={2.4} rx={1.2}
          fill={s.glass} opacity={0.85} />
      ))}
      {/* boom + mast + forestay */}
      <path d={rrect(-L * 0.26, -2.4, L * 0.33, 4.8, 2.4)} fill="#f2f6f9" stroke="#b9c6d2" strokeWidth={0.7} />
      <line x1={r(L * 0.07)} y1={0} x2={r(L * 0.42)} y2={0} stroke="#b9c6d2" strokeWidth={0.9} />
      <circle cx={r(L * 0.07)} cy={0} r={3} fill="#e4ebf1" stroke="#7d94a6" strokeWidth={0.9} />
    </>
  )
}

/** Working / sportfisher — wheelhouse forward, clear aft deck, outriggers. */
function FishingTop({ L, B, s }: PartProps) {
  const house = rrect(L * 0.0, -B * 0.27, L * 0.24, B * 0.54, 3.5)
  return (
    <>
      {/* outriggers, swung aft */}
      {[-1, 1].map(sd => (
        <line key={sd} x1={r(L * 0.08)} y1={0} x2={r(-L * 0.36)} y2={r(sd * B * 0.82)}
          stroke="#dbe4eb" strokeWidth={1.3} opacity={0.9} />
      ))}
      {/* open working deck, planked */}
      <path d={rrect(-L * 0.44, -B * 0.27, L * 0.45, B * 0.54, 2.5)} fill="#8d7d63" />
      {Array.from({ length: 5 }).map((_, i) => (
        <line key={i} x1={r(-L * 0.44 + L * 0.09 * (i + 1))} y1={r(-B * 0.27)} x2={r(-L * 0.44 + L * 0.09 * (i + 1))} y2={r(B * 0.27)}
          stroke="rgba(48,36,20,.3)" strokeWidth={0.7} />
      ))}
      {/* fish boxes + transom door */}
      <path d={rrect(-L * 0.41, -B * 0.22, L * 0.1, B * 0.18, 1.8)} fill={s.deck} opacity={0.9} />
      <path d={rrect(-L * 0.41, B * 0.04, L * 0.1, B * 0.18, 1.8)} fill={s.deck} opacity={0.9} />
      {/* wheelhouse */}
      <Cast d={house} dy={2.4} />
      <path d={house} fill={s.cabin} stroke="rgba(0,0,0,.24)" strokeWidth={1} />
      <rect x={r(L * 0.19)} y={r(-B * 0.22)} width={r(L * 0.042)} height={r(B * 0.44)} rx={1.6} fill={s.glass} opacity={0.9} />
      {[-1, 1].map(sd => (
        <rect key={sd} x={r(L * 0.05)} y={r(sd * B * 0.26 - 1.1)} width={r(L * 0.12)} height={2.2} rx={1.1}
          fill={s.glass} opacity={0.8} />
      ))}
      {/* mast, radar and working light over the house */}
      <line x1={r(L * 0.04)} y1={0} x2={r(-L * 0.08)} y2={0} stroke={s.trim} strokeWidth={1.8} />
      <rect x={r(-L * 0.055)} y={-3.4} width={r(L * 0.03)} height={6.8} rx={1.4} fill="#cbd5e1" />
      <circle cx={r(L * 0.03)} cy={0} r={2} fill="#fcd34d" />
      {/* bulwark cap */}
      <path d={hullOutline(L - B * 0.16, B * 0.84, { entry: 0.42, transom: 0.9 })}
        fill="none" stroke={s.trim} strokeWidth={1.5} opacity={0.55} />
      <Sidelights L={L} B={B} />
    </>
  )
}

/** Pontoon boat — blunt bow, side tubes, bimini shade, console amidships. */
function PontoonTop({ L, B, s }: PartProps) {
  const bimini = rrect(-L * 0.26, -B * 0.29, L * 0.32, B * 0.58, 4)
  return (
    <>
      {/* buoyancy tubes, running past the deck at both ends */}
      {[-1, 1].map(sd => (
        <g key={sd}>
          <path d={rrect(-L * 0.49, sd * B * 0.38 - B * 0.09, L * 0.98, B * 0.18, B * 0.09)} fill={s.hull} />
          <path d={rrect(-L * 0.49, sd * B * 0.38 - B * 0.09, L * 0.98, B * 0.18, B * 0.09)}
            fill="none" stroke={s.shade} strokeWidth={1.4} />
          {/* tube nose cone */}
          <path d={`M ${r(L * 0.42)} ${r(sd * B * 0.38 - B * 0.09)} Q ${r(L * 0.53)} ${r(sd * B * 0.38)} ${r(L * 0.42)} ${r(sd * B * 0.38 + B * 0.09)} Z`}
            fill={s.shade} />
        </g>
      ))}
      {/* deck */}
      <path d={rrect(-L * 0.45, -B * 0.33, L * 0.88, B * 0.66, 4)} fill={s.deck} />
      <path d={rrect(-L * 0.45, -B * 0.33, L * 0.88, B * 0.66, 4)} fill="none" stroke="rgba(0,0,0,.16)" strokeWidth={0.9} />
      {Array.from({ length: 6 }).map((_, i) => (
        <line key={i} x1={r(-L * 0.45 + L * 0.126 * (i + 1))} y1={r(-B * 0.33)} x2={r(-L * 0.45 + L * 0.126 * (i + 1))} y2={r(B * 0.33)}
          stroke="rgba(0,0,0,.07)" strokeWidth={0.7} />
      ))}
      {/* perimeter railing */}
      {[-1, 1].map(sd => [0.06, 0.24, 0.42, 0.6, 0.78, 0.94].map(f => (
        <circle key={`${sd}-${f}`} cx={r(-L * 0.45 + L * 0.88 * f)} cy={r(sd * B * 0.31)} r={1.2} fill={s.trim} opacity={0.85} />
      )))}
      {/* bench seats fore and aft */}
      <path d={rrect(-L * 0.42, -B * 0.26, L * 0.09, B * 0.52, 2.5)} fill={s.cabin} opacity={0.9} />
      <path d={rrect(L * 0.24, -B * 0.24, L * 0.16, B * 0.48, 3)} fill={s.cabin} opacity={0.9} />
      {/* helm console */}
      <path d={rrect(-L * 0.06, -B * 0.17, L * 0.09, B * 0.34, 2.5)} fill={s.glass} opacity={0.85} />
      {/* bimini shade, on its frame */}
      <Cast d={bimini} dy={3} />
      <path d={bimini} fill="rgba(240,248,252,.62)" stroke="rgba(255,255,255,.8)" strokeWidth={1.1} />
      {[[-0.26, -0.29], [-0.26, 0.29], [0.06, -0.29], [0.06, 0.29]].map(([fx, fy], i) => (
        <circle key={i} cx={r(L * fx)} cy={r(B * fy)} r={1.3} fill="#94a3b8" />
      ))}
      {/* outboard */}
      <path d={rrect(-L * 0.58, -B * 0.09, L * 0.09, B * 0.18, 2.5)} fill="#242c36" />
    </>
  )
}

/* ══════════════════════════ the vessel ══════════════════════════ */

export interface VesselProps {
  /** Boat category from the booking — anything unknown draws as a motor yacht. */
  kind?: string
  /** Overall length on deck, in SVG units. */
  L: number
  /** Maximum beam, in SVG units. */
  B: number
  s: HullStyle
  /** Seconds for one roll cycle at her lines; 0 disables the motion. */
  bob?: number
  /** Phase offset so a whole pontoon doesn't roll in lockstep. */
  phase?: number
}

// Canonical vessel-category keys (constants/vesselTaxonomy.ts) that this chart
// draws a distinct hull for. 'yacht' and 'cruise_ship' intentionally fall
// through to the generic YachtTop silhouette below (cruise ship is explicitly
// a "Standard Asset" in the product taxonomy — no bespoke shape needed).
const KNOWN = ['sailing_boat', 'motorboat', 'jet_ski', 'car_jet', 'sports_jet_boat', 'water_bus', 'floating_restaurant']

/**
 * A vessel in plan view, bow to +x, centred on the origin. The planform follows
 * her real category — slim sailing hulls with fine ends, blunt barge-like decks
 * for water buses/floating restaurants, beamy flybridge motor yachts.
 */
export function Vessel({ kind, L, B, s, bob = 0, phase = 0 }: VesselProps) {
  const k = (kind ?? '').toLowerCase()
  const sail = k === 'sailing_boat'
  const barge = k === 'water_bus' || k === 'floating_restaurant'
  const planing = k === 'motorboat' || k === 'jet_ski' || k === 'car_jet' || k === 'sports_jet_boat'
  // A sloop carries far less beam for her length than a motor yacht does.
  const beam = sail ? B * 0.78 : B
  const shape: HullShape =
    sail ? { beamAt: -0.02, entry: 0.28, transom: 0.6 }
      : barge ? { beamAt: 0.42, entry: 0.86, transom: 0.98 }
        : planing ? { beamAt: -0.2, entry: 0.5, transom: 0.9 }
          : { beamAt: -0.13, entry: 0.46, transom: 0.86 }

  const body = (
    <>
      {!barge && <Shell L={L} B={beam} shape={shape} s={s} />}
      {barge && <PontoonTop L={L} B={beam} s={s} />}
      {sail && <SailboatTop L={L} B={beam} s={s} />}
      {planing && <SpeedboatTop L={L} B={beam} s={s} />}
      {!KNOWN.includes(k) && <YachtTop L={L} B={beam} s={s} />}
    </>
  )

  if (!bob) return <g>{body}</g>
  // Alongside in a sheltered basin she only ever works gently against her lines.
  return (
    <g>
      <animateTransform attributeName="transform" type="rotate" additive="sum"
        values="-0.7;0.7;-0.7" dur={`${bob}s`} begin={`${-phase}s`} repeatCount="indefinite" />
      <animateTransform attributeName="transform" type="translate" additive="sum"
        values="0 -0.7;0 0.7;0 -0.7" dur={`${r(bob * 1.37)}s`} begin={`${-phase}s`} repeatCount="indefinite" />
      {body}
    </g>
  )
}

/* ══════════════════════════ dock hardware ══════════════════════════ */

/** A timber dock section with plank seams, edge trim and a sunlit lip. */
export function Dock({
  x, y, w, h, seamAcross = true, plank = 13, rx = 3,
}: { x: number; y: number; w: number; h: number; seamAcross?: boolean; plank?: number; rx?: number }) {
  const seams: number[] = []
  const span = seamAcross ? h : w
  const from = seamAcross ? y : x
  for (let p = from + plank; p < from + span - 2; p += plank) seams.push(p)
  return (
    <g>
      <rect x={x + 1.6} y={y + 2.4} width={w} height={h} rx={rx} fill="rgba(3,20,32,.38)" />
      <rect x={x} y={y} width={w} height={h} rx={rx} fill="url(#hbWood)" />
      {seams.map(p => (seamAcross
        ? <line key={p} x1={x + 1} y1={p} x2={x + w - 1} y2={p} stroke="rgba(70,50,26,.32)" strokeWidth={0.85} />
        : <line key={p} x1={p} y1={y + 1} x2={p} y2={y + h - 1} stroke="rgba(70,50,26,.32)" strokeWidth={0.85} />))}
      <rect x={x} y={y} width={w} height={Math.min(2.4, h / 3)} fill="rgba(255,255,255,.26)" />
      <rect x={x} y={y} width={w} height={h} rx={rx} fill="none" stroke="rgba(58,40,20,.5)" strokeWidth={1} />
    </g>
  )
}

/** A driven timber piling, seen from above. */
export function Piling({ cx, cy, rad = 4.6 }: { cx: number; cy: number; rad?: number }) {
  return (
    <g>
      <circle cx={cx + 1.4} cy={cy + 2} r={rad} fill="rgba(3,20,32,.45)" />
      <circle cx={cx} cy={cy} r={rad} fill="#6b5033" />
      <circle cx={cx} cy={cy} r={rad * 0.64} fill="#8d6f47" />
      <circle cx={cx - rad * 0.24} cy={cy - rad * 0.24} r={rad * 0.28} fill="#ab8c5e" />
    </g>
  )
}

/** A galvanised mooring cleat bolted to the dock. */
export function Cleat({ cx, cy, a = 0 }: { cx: number; cy: number; a?: number }) {
  return (
    <g transform={`translate(${r(cx)} ${r(cy)}) rotate(${a})`}>
      <rect x={-3.6} y={-1.2} width={7.2} height={2.4} rx={1.2} fill="#4e5b66" />
      <circle cx={-3.6} cy={0} r={1.5} fill="#82909d" />
      <circle cx={3.6} cy={0} r={1.5} fill="#82909d" />
    </g>
  )
}

/** A lateral channel mark — green can to starboard, red cone to port. */
export function Buoy({ cx, cy, side }: { cx: number; cy: number; side: 'port' | 'stbd' }) {
  const col = side === 'stbd' ? '#22c55e' : '#ef4444'
  return (
    <g>
      <ellipse cx={cx} cy={cy + 5} rx={8} ry={2.8} fill="rgba(255,255,255,.14)" />
      <circle cx={cx + 1.2} cy={cy + 1.8} r={4.6} fill="rgba(3,20,32,.4)" />
      <circle cx={cx} cy={cy} r={4.6} fill={col} stroke="rgba(255,255,255,.6)" strokeWidth={1.1} />
      <circle cx={cx} cy={cy} r={1.7} fill="rgba(255,255,255,.9)">
        <animate attributeName="opacity" values="1;.15;1" dur={side === 'stbd' ? '3s' : '4s'} repeatCount="indefinite" />
      </circle>
    </g>
  )
}

/* ══════════════════════════ the basin ══════════════════════════ */

/** Basin geometry, in SVG units. */
export const CHART = {
  W: 1240,
  H: 742,
  SHORE_H: 104,          // land along the top
  WALK_H: 30,            // main walkway running off the shore
  PIER_H: 392,           // how far the finger pontoons reach out
  PIER_W: 26,
  BREAK_Y: 668,          // the breakwater
}
const PIER_TOP = CHART.SHORE_H + CHART.WALK_H
const FAIRWAY = PIER_TOP + CHART.PIER_H
const FT_PER_M = 3.28084

/** Widest and narrowest a pontoon column may be drawn. Below MIN_PITCH the slip
 *  code stops fitting, so the chart widens and scrolls rather than shrink further. */
const MAX_PITCH = 304
const MIN_PITCH = 210
/** Footprint of one car-park-and-palms group on the shore. */
const SHORE_BLOCK_W = 490
/** Deepest a single slip is drawn, so a two-berth pontoon isn't a full-depth wall. */
const MAX_ROW_H = 132

/**
 * Whether a marina with this many pontoons draws wider than the base chart — in
 * which case the map scrolls sideways and the page should say so.
 */
export const harbourScrolls = (pontoons: number) => 130 + pontoons * MIN_PITCH > CHART.W

export const BERTH_TINT: Record<string, string> = {
  available: '#10b981', booked: '#1b9bbf', reserved: '#8b5cf6', maintenance: '#f59e0b', blocked: '#64748b',
}

/** Only what the chart needs to draw a berth. */
export interface ChartBerth {
  id: string
  pontoon: string
  number: number
  status: string
  maxLength?: number
  reservation: { boatName: string; boatType?: string; lengthFt?: number; widthFt?: number } | null
}

/** A vessel under way in the approach. */
export interface ChartTransit {
  id: string
  boatName: string
  boatType?: string
  direction: 'arrival' | 'departure'
  distanceNm?: number
}

export interface HarbourChartProps {
  berths: ChartBerth[]
  marinaName?: string
  hasFuelDock?: boolean
  pontoons?: { code: string; name?: string }[]
  transits?: ChartTransit[]
  selectedId?: string | null
  onPick?: (b: ChartBerth) => void
  onAddSlipClick?: (dockCode: string) => void
  /** Berths the current filter has faded out. */
  isDimmed?: (b: ChartBerth) => boolean
  className?: string
  /** Fuel-berth click, so the page can explain what's on offer. */
  onFuelClick?: () => void
}

/** "A-04" — how the crew writes a berth. */
const code = (b: ChartBerth) => `${b.pontoon}-${String(b.number).padStart(2, '0')}`

/**
 * The marina in plan view: the real pontoons as timber finger docks, every berth
 * as a slip in the water, and every boat holding a berth drawn as her actual
 * hull, moored bow-in the way she really lies.
 */
export function HarbourChart({
  berths, marinaName, hasFuelDock, pontoons = [], transits = [], selectedId, onPick, onAddSlipClick, isDimmed, className, onFuelClick,
}: HarbourChartProps) {
  const { H, SHORE_H, WALK_H, PIER_H, PIER_W, BREAK_Y } = CHART

  // The container this chart renders into is usually wider (relative to its
  // height) than the base chart's own 1240:742 ratio — a "Full screen" map on a
  // 16:9-ish monitor, for one. `preserveAspectRatio="xMinYMid meet"` (below)
  // then scales the whole scene to fit the height and anchors it to the left,
  // leaving the excess width as a bare gap on the right rather than stretching
  // or cropping the hand-drawn scene. Measuring the actual box and widening the
  // *viewBox* to match — more open water, not distorted water — makes "meet"
  // fill it exactly instead of letterboxing.
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [containerAspect, setContainerAspect] = React.useState<number | null>(null)
  React.useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) setContainerAspect(width / height)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Real pontoons become the finger docks, in code order.
  const docks = React.useMemo(() => {
    const list = new Set<string>()
    if (pontoons && pontoons.length > 0) {
      pontoons.forEach(p => { if (p.code) list.add(p.code) })
    }
    berths.forEach(b => { if (b.pontoon) list.add(b.pontoon) })
    return Array.from(list).filter(Boolean).sort((a, b) => a.localeCompare(b))
  }, [berths, pontoons])
  // Spread the pontoons across the basin — but never squeeze a column below
  // MIN_PITCH. Past that the basin itself grows wider than the base chart and
  // the drawing scrolls sideways, so a marina with thirty pontoons draws each
  // one at a readable size instead of collapsing them into an unreadable smear.
  const pitch = docks.length
    ? Math.max(MIN_PITCH, Math.min(MAX_PITCH, (CHART.W - 130) / docks.length))
    : MAX_PITCH
  const contentW = Math.max(CHART.W, Math.round(130 + pitch * docks.length))
  const W = containerAspect ? Math.max(contentW, Math.round(H * containerAspect)) : contentW
  const slotLen = Math.max(74, pitch / 2 - 18)   // the water a berth occupies
  const boatMax = slotLen - 12                    // the longest hull that fits it
  const edge = PIER_W / 2

  // Where each car-park-and-palms block starts. One on the base chart, tiled
  // across the extra shore a wide marina creates so the land never reads as a
  // bare strip, and never running under the right-hand furniture.
  const shoreBlocks = React.useMemo(() => {
    const limit = hasFuelDock ? W - 240 : W - 60
    const out: number[] = []
    for (let x = 268; x + SHORE_BLOCK_W <= limit; x += SHORE_BLOCK_W + 10) out.push(x)
    return out
  }, [W, hasFuelDock])

  return (
    <div ref={containerRef} className={`harbour-scroll overflow-x-auto overflow-y-hidden ${className ?? ''}`}>
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMinYMid meet"
      style={{ height: '100%', minWidth: '100%', aspectRatio: `${W} / ${H}` }}>
      <HarbourDefs />

      {/* ── the basin: deep water, shoaling towards the shore ── */}
      <rect x="0" y="0" width={W} height={H} fill="url(#hbWater)" />
      <rect x="0" y={SHORE_H} width={W} height="120" fill="url(#hbShallow)" />
      <rect x="0" y="0" width={W} height={H} fill="url(#hbGlint)" />

      {/* swell rolling through the basin */}
      {[170, 250, 330, 410, 490, 570, 650].map((y, i) => {
        const a = `M0 ${y} q 52 -9 104 0 t 104 0 t 104 0 t 104 0 t 104 0 t 104 0 t 104 0 t 104 0 t 104 0 t 104 0 t 104 0 t 104 0`
        const b = `M0 ${y} q 52 9 104 0 t 104 0 t 104 0 t 104 0 t 104 0 t 104 0 t 104 0 t 104 0 t 104 0 t 104 0 t 104 0 t 104 0`
        return (
          <path key={y} d={a} fill="none" stroke="rgba(255,255,255,.07)" strokeWidth={i % 2 ? 1.4 : 2.2}>
            <animate attributeName="d" dur={`${7 + (i % 3) * 1.6}s`} repeatCount="indefinite" values={`${a};${b};${a}`} />
          </path>
        )
      })}

      {/* ── the shore ── */}
      <rect x="0" y="0" width={W} height={SHORE_H} fill="url(#hbSand)" />
      <rect x="0" y={SHORE_H - 7} width={W} height="7" fill="rgba(160,138,96,.45)" />
      <rect x="0" y={SHORE_H} width={W} height="3.5" fill="rgba(255,255,255,.35)" />

      {/* harbour office */}
      <g>
        <rect x="34" y="20" width="188" height="62" rx="5" fill="rgba(3,20,32,.22)" />
        <rect x="30" y="16" width="188" height="62" rx="5" fill="#f4f7fa" stroke="#b9c6d2" strokeWidth="1.2" />
        <rect x="30" y="16" width="188" height="15" rx="5" fill="#1b6180" />
        {[0, 1, 2, 3, 4].map(i => (
          <rect key={i} x={42 + i * 35} y={40} width="22" height="16" rx="2" fill="#8fc4dd" stroke="#7ba9c2" strokeWidth="0.8" />
        ))}
        <rect x="112" y={62} width="24" height="16" rx="1.5" fill="#5b6a78" />
        <text x="124" y="27" textAnchor="middle" fill="#fff" fontSize="9.5" fontWeight="800" fontFamily="Sora">{translatePortalText('HARBOUR OFFICE')}</text>
      </g>

      {/* fuel berth — only if the marina really has one */}
      {hasFuelDock && (
        <g style={{ cursor: onFuelClick ? 'pointer' : undefined }} onClick={onFuelClick}>
          <rect x={W - 214} y="18" width="92" height="60" rx="5" fill="#f8fafc" stroke="#b9c6d2" strokeWidth="1.2" />
          <rect x={W - 214} y="18" width="92" height="14" rx="5" fill="#f59e0b" />
          <text x={W - 168} y="28.5" textAnchor="middle" fill="#fff" fontSize="8.5" fontWeight="800">{translatePortalText('FUEL BERTH')}</text>
          {[0, 1].map(i => (
            <g key={i} transform={`translate(${W - 200 + i * 34} 42)`}>
              <rect x="0" y="0" width="20" height="26" rx="3" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="0.9" />
              <rect x="3.5" y="4" width="13" height="8" rx="1.5" fill="#334155" />
              <path d="M20 12 q7 3 5 12" fill="none" stroke="#475569" strokeWidth="1.6" />
            </g>
          ))}
        </g>
      )}

      {/* car park + palms, so the land reads as land — repeated along however
          much shore the pontoon count gave us */}
      {shoreBlocks.map(bx => {
        const dx = bx - 268
        return (
          <g key={bx}>
            <g opacity="0.9">
              <rect x={268 + dx} y="30" width="196" height="46" rx="4" fill="rgba(120,104,74,.28)" />
              {Array.from({ length: 7 }).map((_, i) => (
                <line key={i} x1={268 + dx + 24.5 * (i + 1)} y1="34" x2={268 + dx + 24.5 * (i + 1)} y2="72"
                  stroke="rgba(255,255,255,.35)" strokeWidth="1" />
              ))}
              {[0, 2, 4, 6].map(i => (
                <rect key={i} x={274 + dx + i * 24.5} y="40" width="17" height="28" rx="3.5"
                  fill={['#64748b', '#1e293b', '#94a3b8', '#475569'][i % 4]} opacity="0.85" />
              ))}
            </g>
            {[500, 546, 592, 700, 746].map((px, i) => (
              <g key={px} transform={`translate(${px + dx} ${i % 2 ? 44 : 56})`}>
                <rect x="-1.6" y="0" width="3.2" height="20" rx="1.6" fill="#7a6242" />
                {[0, 60, 120, 180, 240, 300].map(a => (
                  <ellipse key={a} cx={Math.cos((a * Math.PI) / 180) * 9} cy={Math.sin((a * Math.PI) / 180) * 5 - 1}
                    rx="9" ry="3.4" fill={i % 2 ? '#3f8f5f' : '#2f7a4d'} opacity="0.9" transform={`rotate(${a} 0 0)`} />
                ))}
              </g>
            ))}
          </g>
        )
      })}

      <text x={hasFuelDock ? W - 236 : W - 34} y="94" textAnchor="end" fill="rgba(90,74,46,.85)"
        fontSize="12" fontWeight="800" fontFamily="Sora" letterSpacing="1.4">
        {(marinaName || 'MARINA').toUpperCase()}
      </text>

      {/* ── the main walkway running the length of the basin ── */}
      <Dock x={54} y={SHORE_H} w={W - 108} h={WALK_H} seamAcross={false} plank={15} />
      {Array.from({ length: Math.floor((W - 108) / 74) }).map((_, i) => (
        <Piling key={i} cx={78 + i * 74} cy={SHORE_H + WALK_H - 3} rad={3.6} />
      ))}

      {/* ── the finger pontoons, one per real pontoon ── */}
      {docks.map((dock, di) => {
        const slots = berths.filter(b => b.pontoon === dock).sort((a, b) => a.number - b.number)
        const cx = 65 + pitch * (di + 0.5)
        const perSide = Math.max(1, Math.ceil(slots.length / 2))
        // A slip is only ever so deep. A pontoon holding two berths used to
        // stretch its pair down the whole basin; now it reaches only as far as
        // the berths it actually has, so a short pontoon draws as a short finger.
        const rowH = Math.min(MAX_ROW_H, PIER_H / perSide)
        const pierLen = rowH * perSide
        const fingerLen = slotLen * 0.66

        return (
          <g key={dock}>
            {/* finger piers between each pair of slips, piling on every head */}
            {[-1, 1].map(side => Array.from({ length: perSide + 1 }).map((_, i) => {
              const fy = PIER_TOP + i * rowH - 4.5
              const fx = side < 0 ? cx - edge - fingerLen : cx + edge
              return (
                <g key={`${side}-${i}`}>
                  <Dock x={fx} y={fy} w={fingerLen} h={9} seamAcross={false} plank={11} rx={2} />
                  <Piling cx={side < 0 ? fx + 2 : fx + fingerLen - 2} cy={fy + 4.5} rad={4} />
                </g>
              )
            }))}

            {/* the pontoon itself */}
            <Dock x={cx - edge} y={PIER_TOP - 6} w={PIER_W} h={pierLen + 6} />
            {Array.from({ length: Math.floor(pierLen / 66) }).map((_, i) => (
              <React.Fragment key={i}>
                <Cleat cx={cx - edge + 5} cy={PIER_TOP + 30 + i * 66} a={90} />
                <Cleat cx={cx + edge - 5} cy={PIER_TOP + 62 + i * 66} a={90} />
              </React.Fragment>
            ))}
            <Piling cx={cx} cy={PIER_TOP + pierLen - 5} rad={6} />

            {/* the pontoon letter, painted on the head of the dock */}
            <g>
              <rect x={cx - 13} y={SHORE_H + WALK_H - 26} width="26" height="22" rx="4" fill="#0f3a52" opacity="0.9" />
              <text x={cx} y={SHORE_H + WALK_H - 10} textAnchor="middle" fill="#fff" fontSize="14"
                fontWeight="800" fontFamily="Sora">{dock}</text>
            </g>

            {/* ── the slips ── */}
            {slots.map((b, si) => {
              const left = si < perSide
              const idx = left ? si : si - perSide
              const rowY = PIER_TOP + idx * rowH
              const midY = rowY + rowH / 2
              const slotX = left ? cx - edge - slotLen : cx + edge
              const boat = b.reservation
              const faded = isDimmed?.(b) ?? false
              const picked = selectedId === b.id

              // Hull size from her real registered dimensions, capped by the
              // slip she is actually lying in.
              const berthFt = (b.maxLength ?? 12) * FT_PER_M
              const lenFrac = boat?.lengthFt ? Math.min(1, Math.max(0.5, boat.lengthFt / berthFt)) : 0.82
              const hullL = boatMax * lenFrac
              const ratio = boat?.widthFt && boat?.lengthFt
                ? Math.min(0.52, Math.max(0.24, boat.widthFt / boat.lengthFt)) : 0.4
              const hullB = Math.min(rowH * 0.46, hullL * ratio)
              // Bow-in, so she points at the pontoon she is made fast to.
              const bowX = left ? cx - edge - 6 : cx + edge + 6
              const hullCx = left ? bowX - hullL / 2 : bowX + hullL / 2

              return (
                <g key={b.id} style={{ cursor: onPick ? 'pointer' : undefined, opacity: faded ? 0.16 : 1, transition: 'opacity .3s' }}
                  onClick={() => onPick?.(b)}>
                  {/* The slip is water, so keep it water — a berth with a boat in
                      it needs no wash of colour, the boat says it. Everything else
                      gets just enough tint to read at a glance. */}
                  <rect x={slotX} y={rowY + 4} width={slotLen} height={rowH - 9} rx={4}
                    fill={BERTH_TINT[b.status] ?? '#64748b'} fillOpacity={boat ? 0.05 : 0.11} />
                  {(b.status === 'maintenance' || b.status === 'blocked') && (
                    <rect x={slotX} y={rowY + 4} width={slotLen} height={rowH - 9} rx={4} fill="url(#hbHatch)" opacity="0.5" />
                  )}
                  {picked && (
                    <rect x={slotX} y={rowY + 4} width={slotLen} height={rowH - 9} rx={4}
                      fill="none" stroke="#fff" strokeWidth="2.2" />
                  )}

                  {/* she's alongside — draw her, and her lines to the dock */}
                  {boat && (
                    <>
                      {[-1, 1].map(sd => (
                        <path key={sd} fill="none" stroke="rgba(255,255,255,.5)" strokeWidth="0.9"
                          d={`M ${left ? bowX - hullL * 0.1 : bowX + hullL * 0.1} ${midY + sd * hullB * 0.4}
                              Q ${left ? bowX - hullL * 0.06 : bowX + hullL * 0.06} ${midY + sd * (rowH / 2 - 3)}
                                ${left ? bowX - hullL * 0.3 : bowX + hullL * 0.3} ${midY + sd * (rowH / 2 - 4.5)}`} />
                      ))}
                      <g filter="url(#hbHull)">
                        <g transform={`translate(${r(hullCx)} ${r(midY)}) rotate(${left ? 0 : 180})`}>
                          <Vessel kind={boat.boatType} L={hullL} B={hullB} s={hullFor(boat.boatName)}
                            bob={5.4 + (si % 4) * 0.55} phase={si * 1.3 + di * 0.7} />
                        </g>
                      </g>
                    </>
                  )}

                  {/* an empty slip shows what will fit in it */}
                  {!boat && (
                    <>
                      <rect x={slotX + 5} y={rowY + 8} width={slotLen - 10} height={rowH - 17} rx={4}
                        fill="none" stroke={BERTH_TINT[b.status] ?? '#64748b'} strokeWidth="1.4" strokeDasharray="6 5" opacity="0.75" />
                      {b.status === 'maintenance' && <text x={slotX + slotLen / 2} y={midY - 2} textAnchor="middle" fontSize="15">🚧</text>}
                      {b.status === 'reserved' && <text x={slotX + slotLen / 2} y={midY - 2} textAnchor="middle" fontSize="14">🔒</text>}
                      {b.status === 'blocked' && <text x={slotX + slotLen / 2} y={midY - 2} textAnchor="middle" fontSize="14">⛔</text>}
                    </>
                  )}

                  {/* berth plate — the code, and who's lying in it */}
                  <text x={slotX + slotLen / 2} y={rowY + rowH - 11} textAnchor="middle"
                    fill="#fff" fontSize="10.5" fontWeight="800" fontFamily="Sora"
                    style={{ paintOrder: 'stroke', stroke: 'rgba(4,26,40,.8)', strokeWidth: 3.2 } as React.CSSProperties}>
                    {code(b)}
                    {boat ? ` · ${boat.boatName.length > 14 ? boat.boatName.slice(0, 13) + '…' : boat.boatName}` : ''}
                    {!boat && b.maxLength != null ? ` · ${b.maxLength} m` : ''}
                  </text>

                  {/* shore power live on the pedestal */}
                  {b.status === 'booked' && (
                    <circle cx={left ? cx - edge - 5 : cx + edge + 5} cy={midY} r={2.6} fill="#6ee7b7">
                      <animate attributeName="opacity" values="1;.25;1" dur="2.4s" repeatCount="indefinite" />
                    </circle>
                  )}
                </g>
              )
            })}

            {/* If dock has no berths yet, render a helpful placeholder slip to add berths */}
            {slots.length === 0 && (
              <g
                style={{ cursor: onAddSlipClick ? 'pointer' : undefined }}
                onClick={() => onAddSlipClick?.(dock)}
              >
                <rect
                  x={cx - edge - slotLen + 6}
                  y={PIER_TOP + 12}
                  width={slotLen * 2 + PIER_W - 12}
                  height={80}
                  rx={6}
                  fill="rgba(15,58,82,0.35)"
                  stroke="#38bdf8"
                  strokeWidth="1.5"
                  strokeDasharray="6 4"
                />
                <text
                  x={cx}
                  y={PIER_TOP + 46}
                  textAnchor="middle"
                  fill="#7dd3fc"
                  fontSize="12"
                  fontWeight="800"
                  fontFamily="Sora"
                >
                  {translatePortalText('+ Add Berth to Dock')} {dock}
                </text>
                <text
                  x={cx}
                  y={PIER_TOP + 64}
                  textAnchor="middle"
                  fill="rgba(255,255,255,0.6)"
                  fontSize="10"
                  fontFamily="Sora"
                >
                  {translatePortalText('Click to configure slips')}
                </text>
              </g>
            )}
          </g>
        )
      })}

      {/* ── the marked channel out through the basin ── */}
      {[-1, 1].map(sd => (
        <line key={sd} x1={W / 2 + sd * 34} y1={FAIRWAY + 22} x2={W / 2 + sd * 34} y2={BREAK_Y - 30}
          stroke="rgba(255,255,255,.2)" strokeWidth="2" strokeDasharray="9 11" />
      ))}
      <Buoy cx={W / 2 - 34} cy={FAIRWAY + 22} side="port" />
      <Buoy cx={W / 2 + 34} cy={FAIRWAY + 22} side="stbd" />
      <Buoy cx={W / 2 - 34} cy={BREAK_Y - 30} side="port" />
      <Buoy cx={W / 2 + 34} cy={BREAK_Y - 30} side="stbd" />

      {/* ── vessels actually under way in the approach ── */}
      {transits.slice(0, 4).map((m, i) => {
        const lane = FAIRWAY + 52 + (i % 2) * 46
        const inbound = m.direction === 'arrival'
        const L = 46, B = 17
        return (
          <g key={m.id}>
            <animateMotion dur={`${30 + i * 7}s`} repeatCount="indefinite" rotate="auto"
              path={inbound
                ? `M ${W + 70} ${lane + 16} C ${W * 0.7} ${lane} ${W * 0.35} ${lane + 8} -70 ${lane}`
                : `M -70 ${lane} C ${W * 0.32} ${lane + 10} ${W * 0.68} ${lane - 6} ${W + 70} ${lane + 12}`} />
            {/* wake */}
            <path d={`M ${-L * 0.5} 0 L ${-L * 1.9} ${-B * 0.85} M ${-L * 0.5} 0 L ${-L * 1.9} ${B * 0.85}`}
              stroke="rgba(255,255,255,.3)" strokeWidth="1.6" fill="none" />
            <g filter="url(#hbHull)">
              <Vessel kind={m.boatType} L={L} B={B} s={hullFor(m.boatName)} bob={3.4} phase={i} />
            </g>
            <text x={0} y={B + 12} textAnchor="middle" fill="rgba(255,255,255,.85)" fontSize="8.5" fontWeight="700"
              transform={inbound ? 'rotate(180)' : undefined}>
              {m.boatName}{m.distanceNm != null ? ` · ${formatPortalNumber(m.distanceNm)} ${translatePortalText('nm')}` : ''}
            </text>
          </g>
        )
      })}

      {/* ── the breakwater, with the light on its head ── */}
      <g>
        <rect x="26" y={BREAK_Y - 3} width={W - 52} height="22" rx="11" fill="rgba(3,20,32,.4)" />
        <rect x="24" y={BREAK_Y - 6} width={W - 52} height="22" rx="11" fill="#7e8b99" />
        {/* armour rock */}
        {Array.from({ length: Math.floor((W - 60) / 21) }).map((_, i) => (
          <circle key={i} cx={40 + i * 21} cy={BREAK_Y + 5 + ((i * 7) % 5) - 2} r={7.5 - ((i * 3) % 3)}
            fill={['#94a1af', '#6d7986', '#8794a2'][i % 3]} opacity="0.95" />
        ))}
        <g transform={`translate(${W - 44} ${BREAK_Y + 5})`}>
          <circle cx="0" cy="0" r="9" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="1.2" />
          <circle cx="0" cy="0" r="4.4" fill="#ef4444">
            <animate attributeName="opacity" values="1;.15;1" dur="3.4s" repeatCount="indefinite" />
          </circle>
        </g>
        <text x="150" y={BREAK_Y + 34} fill="rgba(255,255,255,.45)" fontSize="10.5" fontWeight="800" letterSpacing="2.4">
          {translatePortalText('⚓ BREAKWATER')}
        </text>
      </g>

      {/* ── chart furniture ── */}
      <g transform={`translate(60 ${BREAK_Y - 62})`} opacity="0.6">
        <circle cx="0" cy="0" r="19" fill="rgba(4,26,40,.4)" stroke="rgba(255,255,255,.4)" strokeWidth="1" />
        <path d="M0 -15 L4.4 0 L0 4 L-4.4 0 Z" fill="#fff" />
        <path d="M0 15 L4.4 0 L0 -4 L-4.4 0 Z" fill="rgba(255,255,255,.35)" />
        <text x="0" y="-22" textAnchor="middle" fill="rgba(255,255,255,.8)" fontSize="8.5" fontWeight="800">N</text>
      </g>
      {/* Scale sits beside the compass rather than on the far right edge — on a
          wide, scrolling basin the right edge may never be on screen. */}
      <g transform={`translate(100 ${BREAK_Y - 30})`} opacity="0.6">
        <line x1="0" y1="0" x2="86" y2="0" stroke="rgba(255,255,255,.75)" strokeWidth="1.8" />
        <line x1="0" y1="-4" x2="0" y2="4" stroke="rgba(255,255,255,.75)" strokeWidth="1.8" />
        <line x1="43" y1="-3" x2="43" y2="3" stroke="rgba(255,255,255,.55)" strokeWidth="1.4" />
        <line x1="86" y1="-4" x2="86" y2="4" stroke="rgba(255,255,255,.75)" strokeWidth="1.8" />
        <text x="43" y="-8" textAnchor="middle" fill="rgba(255,255,255,.8)" fontSize="8.5" fontWeight="700">{translatePortalText('Approx.')} {formatPortalNumber(30)} {translatePortalText('Meter abbreviation')}</text>
      </g>
    </svg>
    </div>
  )
}

/** Gradients, patterns and filters every harbour drawing shares. */
export function HarbourDefs() {
  return (
    <defs>
      <linearGradient id="hbWater" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#31899f" />
        <stop offset="26%" stopColor="#19708f" />
        <stop offset="62%" stopColor="#0d4d6f" />
        <stop offset="100%" stopColor="#06304a" />
      </linearGradient>
      <linearGradient id="hbSand" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#efe3c2" />
        <stop offset="62%" stopColor="#ddcb9e" />
        <stop offset="100%" stopColor="#c6b17f" />
      </linearGradient>
      <linearGradient id="hbWood" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#cdb083" />
        <stop offset="52%" stopColor="#b8996a" />
        <stop offset="100%" stopColor="#9f8158" />
      </linearGradient>
      <linearGradient id="hbShallow" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="rgba(133,219,226,.5)" />
        <stop offset="100%" stopColor="rgba(133,219,226,0)" />
      </linearGradient>
      <radialGradient id="hbGlint" cx="0.24" cy="0.14" r="0.6">
        <stop offset="0%" stopColor="rgba(255,255,255,.24)" />
        <stop offset="100%" stopColor="rgba(255,255,255,0)" />
      </radialGradient>
      <pattern id="hbTramp" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(255,255,255,.42)" strokeWidth="1" />
      </pattern>
      <pattern id="hbHatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(255,255,255,.3)" strokeWidth="3" />
      </pattern>
      {/* Applied by the caller AROUND the rotated vessel, so the sun stays put. */}
      <filter id="hbHull" x="-25%" y="-25%" width="160%" height="160%">
        <feDropShadow dx="2.2" dy="3.4" stdDeviation="2.6" floodColor="#04202f" floodOpacity="0.45" />
      </filter>
    </defs>
  )
}
