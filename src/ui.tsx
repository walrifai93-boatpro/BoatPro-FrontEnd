import React, { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, LayoutGrid, List, AlertTriangle, RefreshCw } from 'lucide-react'
import { fileUrl } from './api'
import { formatMoney, useMarinaOptional } from './live'
import { useCurrency } from './currency'
import { formatPortalNumber, isPortalArabic, localizedField, translatePortalText } from './i18n/runtime'

// ── toast bus ──────────────────────────────────────────────────
// Moved to src/async/toast.tsx, which adds the loading→settled lifecycle,
// dedupe, per-tone durations, measured progress bars and recovery actions that
// the original announce-only bus could not express.
//
// Re-exported here because ~450 call sites already do `import { toast } from
// '../ui'`, and `toast(msg, tone)` still has exactly its old signature — see the
// compatibility note in that file.
export { toast, ToastStack, TOAST_DURATION, type ToastTone, type ToastItem, type ToastAction } from './async/toast'

// ── browser action helpers ───────────────────────────────────
// Trigger a real file download from in-memory content (CSV, text, JSON…).
export function download(filename: string, content: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
// Serialize an array of row objects to CSV (keys of the first row become headers).
export function toCSV(rows: Record<string, any>[], headers?: string[]) {
  if (!rows.length) return ''
  const cols = headers ?? Object.keys(rows[0])
  const esc = (v: any) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n')
}
/**
 * Download a row matrix as a CSV, header row included.
 *
 * The counterpart to `toCSV` for data that is already rows-of-cells rather than
 * objects — which is what a table on screen naturally produces.
 *
 * The BOM is the point. Excel decides a CSV's encoding by sniffing, and without
 * a byte-order mark it reads UTF-8 as the local codepage: every Arabic provider
 * name in an export opens as mojibake, which on a bilingual platform means half
 * the exports are unusable to whoever asked for them. Every cell is quoted so a
 * comma inside a business name cannot shift the remaining columns.
 */
export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const body = rows
    .map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\r\n')
  download(filename, `﻿${body}`, 'text/csv;charset=utf-8;')
}

// Copy text to the clipboard with a graceful fallback for non-secure contexts.
export async function copyText(text: string) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove()
    return true
  } catch { return false }
}
// Open the native file picker and resolve with the chosen files (empty if cancelled).
export function pickFiles(accept = '*/*', multiple = false): Promise<File[]> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = accept; input.multiple = multiple
    input.onchange = () => resolve(input.files ? Array.from(input.files) : [])
    input.click()
  })
}
// Print a formatted document via a hidden iframe (real print dialog, no popup window/blocker).
// `brand` puts the operator's own name on the letterhead; it defaults to the
// maintenance portal's, which is the only other caller.
export function printDoc(title: string, bodyHtml: string, brand = 'HarborTech Marine Service', brandIcon = '🔧') {
  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'; iframe.style.right = '0'; iframe.style.bottom = '0'
  iframe.style.width = '0'; iframe.style.height = '0'; iframe.style.border = '0'
  document.body.appendChild(iframe)
  const doc = iframe.contentWindow?.document
  if (!doc) { iframe.remove(); return }
  const language = isPortalArabic() ? 'ar' : 'en'
  const direction = isPortalArabic() ? 'rtl' : 'ltr'
  doc.open()
  doc.write(`<!doctype html><html lang="${language}" dir="${direction}"><head><title>${translatePortalText(title)}</title><meta charset="utf-8"><style>
    *{box-sizing:border-box;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a}
    body{margin:0;padding:40px;direction:${direction};text-align:start}
    h1{font-size:22px;margin:0 0 4px} .sub{color:#64748b;font-size:13px;margin:0 0 24px}
    .brand{display:flex;align-items:center;gap:10px;border-bottom:2px solid #8b5cf6;padding-bottom:14px;margin-bottom:20px}
    .brand b{font-size:18px}
    table{width:100%;border-collapse:collapse;margin:12px 0;font-size:13px}
    th,td{text-align:start;padding:8px 10px;border-bottom:1px solid #e2e8f0}
    th{background:#f1f5f9;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#64748b}
    .row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px}
    .row span:first-child{color:#64748b} .tot{font-weight:800;color:#7c3aed;font-size:16px}
    .foot{margin-top:32px;color:#94a3b8;font-size:11px;text-align:center}
  </style></head><body>
    <div class="brand"><span style="font-size:22px">${brandIcon}</span><b>${brand}</b></div>
    ${bodyHtml}
    <p class="foot">© ${new Date().getFullYear()} ${brand} · ${translatePortalText('Powered by BoatPro')}</p>
  </body></html>`)
  doc.close()
  const done = () => setTimeout(() => iframe.remove(), 500)
  iframe.contentWindow!.onafterprint = done
  setTimeout(() => { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); done() }, 250)
}

// ── image with graceful fallback ─────────────────────────────
export function Img({ src, alt = '', className = '' }: { src: string; alt?: string; className?: string }) {
  const [err, setErr] = useState(false)
  if (err) return <div className={`bg-gradient-to-br from-ocean-700 via-ocean-500 to-ocean-300 flex items-center justify-center text-white/60 text-3xl ${className}`}>⚓</div>
  return <img src={src} alt={alt} loading="lazy" onError={() => setErr(true)} className={`object-cover ${className}`} />
}

// ── auto-rotating cover photo (crossfades through the marina's "cover"
// category images; renders a single static image when there's only one) ──
export function CoverPhoto({ srcs, className = '', intervalMs = 4500 }: { srcs: string[]; className?: string; intervalMs?: number }) {
  const [active, setActive] = useState(0)
  useEffect(() => {
    if (active >= srcs.length) setActive(0)
  }, [srcs.length, active])
  useEffect(() => {
    if (srcs.length < 2) return
    const t = setInterval(() => setActive(i => (i + 1) % srcs.length), intervalMs)
    return () => clearInterval(t)
  }, [srcs.length, intervalMs])
  if (!srcs.length) return null
  return (
    <div className={className}>
      {srcs.map((s, i) => (
        <img key={s + i} src={s} alt="" loading="lazy"
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 ${i === Math.min(active, srcs.length - 1) ? 'opacity-100' : 'opacity-0'}`} />
      ))}
    </div>
  )
}

// ── page header ──────────────────────────────────────────────
export function PageHeader({ title, sub, actions, icon }: { title: string; sub: string; actions?: React.ReactNode; icon?: React.ReactNode }) {
  const marina = useMarinaOptional()?.marina ?? null
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-slate-200/70 pb-5">
      <div>
        <p className="mb-1 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.28em] text-ocean-500">
          <span className="h-px w-6 bg-ocean-400" /><bdi dir="auto">{localizedField(marina, 'name', 'Marina')}</bdi> · {translatePortalText('Operations Console')}
        </p>
        <h1 className="font-display text-2xl md:text-3xl font-extrabold tracking-tight text-deep-900 flex items-center gap-3">{icon}{translatePortalText(title)}</h1>
        <p className="mt-1 text-sm text-slate-500">{translatePortalText(sub)}</p>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </motion.div>
  )
}

// ── animated counter ─────────────────────────────────────────
export function Counter({
  value,
  to,
  prefix = '',
  suffix = '',
  decimals = 0,
  currency,
  compact,
}: {
  value?: number;
  to?: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  /**
   * The currency the amount is *already* denominated in.
   *
   * Set it for money and the figure is converted into whatever the operator
   * has chosen to read in, then signed — the same path every other amount in
   * the portal takes. Leave it unset for counts.
   *
   * It exists because the alternative in use was `prefix="$"`, which put a
   * dollar sign on a riyal figure: not a conversion, just a wrong label, on the
   * screens where an operator reconciles takings against a bank statement. See
   * the rules at the top of `currency.tsx` — amounts are converted, never
   * relabelled.
   */
  currency?: string;
  /** Abbreviate large amounts (1.2M). Money mode only. */
  compact?: boolean;
}) {
  // Subscribed to, not just called: `formatMoney` reads the active currency
  // itself, but without this hook a switch would leave the rendered figure
  // frozen at the previous currency until something else re-rendered it.
  useCurrency();
  const target = Number.isFinite(value) ? Number(value) : Number.isFinite(to) ? Number(to) : 0;
  const [n, setN] = useState(0);
  const ref = useRef<number>();
  useEffect(() => {
    const start = performance.now();
    const dur = 1100;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      setN(target * e);
      if (p < 1) ref.current = requestAnimationFrame(tick);
    };
    ref.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(ref.current!);
  }, [target]);
  /**
   * `decimals` is ignored in money mode on purpose: `formatMoney` already draws
   * the right line (a whole riyal figure stays whole, a converted dollar one
   * keeps its cents), and honouring both would fight it.
   *
   * The intermediate is rounded to whole units when the target is whole, so the
   * cents column does not blink in and out for the second the animation runs —
   * every frame of `target * ease` is fractional even when the destination is
   * not. A target that genuinely has cents keeps them the whole way.
   */
  const body = currency
    ? formatMoney(target % 1 ? n : Math.round(n), currency, { compact })
    : formatPortalNumber(n, { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
  return <>{translatePortalText(prefix)}{body}{translatePortalText(suffix)}</>;
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (!data || data.length === 0) return null;
  if (data.length === 1) data = [data[0], data[0]]; // duplicate for flat line
  const min = Math.min(...data), max = Math.max(...data)
  const pts = data.map((v, i) => [(i / (data.length - 1)) * 100, 28 - ((v - min) / (max - min || 1)) * 24])
  
  let d = `M ${pts[0][0]},${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i], p1 = pts[i + 1]
    d += ` C ${p0[0] + (p1[0] - p0[0]) / 2},${p0[1]} ${p1[0] - (p1[0] - p0[0]) / 2},${p1[1]} ${p1[0]},${p1[1]}`
  }
  const areaD = `${d} L 100,30 L 0,30 Z`

  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="pointer-events-none absolute bottom-0 start-0 h-9 w-full opacity-80">
      <defs>
        <linearGradient id={`sp-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" /><stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#sp-${color.replace('#', '')})`} />
      <motion.path d={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.4, ease: 'easeOut' }} />
    </svg>
  )
}

export function StatCard({ label, value, prefix, suffix, delta, icon, tone = 'ocean', i = 0, decimals = 0, currency, compact, spark, to, onClick }:
  { label: string; value: number; prefix?: string; suffix?: string; delta?: string; icon: React.ReactNode; tone?: string; i?: number; decimals?: number;
    /** Pass for money — see `Counter`. A tile showing an amount should always set it. */
    currency?: string; compact?: boolean; spark?: number[]; to?: string; onClick?: () => void }) {
  const tones: any = {
    ocean: 'from-ocean-500 to-ocean-300 text-white', navy: 'from-deep-900 to-ocean-800 text-white',
    green: 'from-emerald-500 to-teal-400 text-white', amber: 'from-amber-500 to-orange-400 text-white',
    rose: 'from-rose-500 to-pink-400 text-white', violet: 'from-violet-500 to-purple-400 text-white',
  }
  const sparkColor: any = { ocean: '#1b9bbf', navy: '#1f536c', green: '#10b981', amber: '#f59e0b', rose: '#f43f5e', violet: '#8b5cf6' }
  const up = delta?.startsWith('+')

  const cardContent = (
    <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
      whileHover={{ y: -3, scale: 1.01 }} className={`card card-hover relative overflow-hidden p-4 pb-6 ${to || onClick ? 'cursor-pointer group' : ''}`} onClick={onClick}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-bold uppercase tracking-wider text-slate-400 group-hover:text-ocean-600 transition-colors">{translatePortalText(label)}</p>
          <p className="mt-1.5 font-display text-xl md:text-[22px] font-extrabold leading-tight text-deep-900">
            <Counter value={value} prefix={prefix} suffix={suffix} decimals={decimals} currency={currency} compact={compact} />
          </p>
          {delta && <p className={`mt-1 text-[11px] font-bold ${up ? 'text-emerald-600' : 'text-rose-500'}`}>{delta} <span className="font-medium text-slate-400">{translatePortalText('vs last wk')}</span></p>}
        </div>
        <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br ${tones[tone]} shadow-glow group-hover:scale-110 transition-transform`}>{icon}</div>
      </div>
      {spark && <Sparkline data={spark} color={sparkColor[tone]} />}
      <div className={`pointer-events-none absolute -bottom-8 -end-8 h-24 w-24 rounded-full bg-gradient-to-br ${tones[tone]} opacity-10`} />
    </motion.div>
  )

  if (to) {
    return <Link to={to} className="block no-underline">{cardContent}</Link>
  }
  return cardContent
}

// ── badge ────────────────────────────────────────────────────
const BADGE_TONES: Record<string, string> = {
  // berth / generic statuses
  Available: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', Occupied: 'bg-ocean-50 text-ocean-700 ring-1 ring-ocean-200',
  Reserved: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200', Maintenance: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  Blocked: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
  Pending: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200', Confirmed: 'bg-ocean-50 text-ocean-700 ring-1 ring-ocean-200',
  'Checked-in': 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', Completed: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
  Cancelled: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200', Waitlist: 'bg-fuchsia-50 text-fuchsia-700 ring-1 ring-fuchsia-200',
  New: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200', Accepted: 'bg-ocean-50 text-ocean-700 ring-1 ring-ocean-200',
  'In progress': 'bg-violet-50 text-violet-700 ring-1 ring-violet-200', Invoiced: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
  Paid: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', Overdue: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200',
  Refunded: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
  Open: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200', Scheduled: 'bg-ocean-50 text-ocean-700 ring-1 ring-ocean-200',
  Done: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  Low: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200', Medium: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  High: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200', Critical: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200',
  Valid: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', 'Expiring soon': 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  Expired: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200',
  'On duty': 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', 'Off duty': 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
  'On leave': 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  Platinum: 'bg-gradient-to-r from-slate-700 to-slate-500 text-white', Gold: 'bg-gradient-to-r from-amber-400 to-yellow-300 text-amber-900',
  Silver: 'bg-slate-200 text-slate-600', Standard: 'bg-slate-100 text-slate-500 ring-1 ring-slate-200',
  Investigating: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200', Resolved: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  // berth-reservation workflow
  'Awaiting review': 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  'Awaiting payment': 'bg-orange-50 text-orange-700 ring-1 ring-orange-200',
  Active: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  Declined: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200',
  // movements
  Expected: 'bg-ocean-50 text-ocean-700 ring-1 ring-ocean-200',
  'En route': 'bg-violet-50 text-violet-700 ring-1 ring-violet-200',
  'Checked-out': 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
  'No-show': 'bg-rose-50 text-rose-600 ring-1 ring-rose-200',
  // work orders / services
  Unpaid: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  // documents
  'No expiry': 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
}
export function Badge({ children, dot }: { children: string; dot?: boolean }) {
  return (
    <span className={`chip ${BADGE_TONES[children] ?? 'bg-slate-100 text-slate-600'}`}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse-soft" />}{translatePortalText(children)}
    </span>
  )
}

// ── avatar: uploaded picture, or the person's initials ────────
const AVATAR_TINTS = [
  'from-ocean-500 to-ocean-300', 'from-violet-500 to-purple-400', 'from-emerald-500 to-teal-400',
  'from-amber-500 to-orange-400', 'from-rose-500 to-pink-400', 'from-deep-900 to-ocean-800',
]
function initialsOf(name?: string) {
  if (!name) return '?'
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || '?'
}
export function Avatar({ name, src, size = 36, className = '' }: { name?: string; src?: string | null; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false)
  const url = fileUrl(src)
  const tint = AVATAR_TINTS[(name ? name.charCodeAt(0) + name.length : 0) % AVATAR_TINTS.length]
  if (url && !failed) {
    return (
      <img src={url} alt={name ?? ''} onError={() => setFailed(true)} style={{ width: size, height: size }}
        className={`shrink-0 rounded-full object-cover ring-2 ring-white ${className}`} />
    )
  }
  return (
    <span style={{ width: size, height: size, fontSize: Math.max(10, size * 0.36) }}
      className={`grid shrink-0 place-items-center rounded-full bg-gradient-to-br ${tint} font-extrabold text-white ring-2 ring-white ${className}`}>
      {initialsOf(name)}
    </span>
  )
}

// ── async states & animated loaders ─────────────────────────
export function Spinner({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <span style={{ width: size, height: size }} className={`btn-spinner shrink-0 ${className}`} />
  )
}

export function LoadingButton({
  children,
  loading = false,
  disabled = false,
  className = '',
  icon,
  onClick,
  type = 'button',
  ...props
}: {
  children: React.ReactNode
  loading?: boolean
  disabled?: boolean
  className?: string
  icon?: React.ReactNode
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  type?: 'button' | 'submit' | 'reset'
  [key: string]: any
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      className={`relative inline-flex items-center justify-center gap-2 transition-all duration-300 ${loading ? 'opacity-80 cursor-wait' : ''} ${className}`}
      {...props}
    >
      {loading ? (
        <>
          <Spinner size={14} />
          <span>{children}</span>
        </>
      ) : (
        <>
          {icon}
          {children}
        </>
      )}
    </button>
  )
}

export function LoadingState({ label = 'Loading data…', rows = 4 }: { label?: string; rows?: number }) {
  return (
    <div className="space-y-3 py-4">
      <div className="flex items-center gap-2.5 text-xs font-bold uppercase tracking-wider text-ocean-600">
        <Spinner size={15} className="text-ocean-500" />
        <span>{translatePortalText(label)}</span>
      </div>
      <div className="grid gap-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="skeleton-shimmer h-16 w-full rounded-2xl bg-gradient-to-r from-slate-100 via-sand/60 to-slate-100 border border-slate-100/80 shadow-soft" />
        ))}
      </div>
    </div>
  )
}

// ── Skeletons — one shape per content type, so a loading page reserves the
// same layout its real content will take (no reflow once data arrives). ──
const shimmer = 'skeleton-shimmer bg-gradient-to-r from-slate-100 via-sand/60 to-slate-100'

/** A row of KPI/stat tiles — mirrors StatCard's card shape. */
export function StatTileSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card flex items-center gap-3 p-4">
          <div className={`h-9 w-9 shrink-0 rounded-xl ${shimmer}`} />
          <div className="flex-1 space-y-2">
            <div className={`h-5 w-16 rounded-md ${shimmer}`} />
            <div className={`h-2.5 w-20 rounded ${shimmer}`} />
          </div>
        </div>
      ))}
    </div>
  )
}

/** A data table — header bar + N rows of cell-shaped bars. */
export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="card overflow-hidden">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 border-b border-slate-50 px-4 py-3.5 last:border-b-0">
          <div className={`h-9 w-9 shrink-0 rounded-full ${shimmer}`} />
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className={`h-3 flex-1 rounded ${shimmer}`} style={{ opacity: 1 - c * 0.12, maxWidth: c === 0 ? 160 : undefined }} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** A grid of image+text cards — mirrors listing/card-view pages. */
export function CardGridSkeleton({ count = 6, cols = 'md:grid-cols-2 xl:grid-cols-3' }: { count?: number; cols?: string }) {
  return (
    <div className={`grid gap-4 ${cols}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card overflow-hidden">
          <div className={`h-36 w-full ${shimmer}`} />
          <div className="space-y-2 p-3.5">
            <div className={`h-3.5 w-2/3 rounded ${shimmer}`} />
            <div className={`h-3 w-1/3 rounded ${shimmer}`} />
          </div>
        </div>
      ))}
    </div>
  )
}

/** A chart placeholder — for Section blocks wrapping a Recharts container. */
export function ChartSkeleton({ height = 220 }: { height?: number }) {
  return <div className={`w-full rounded-2xl ${shimmer}`} style={{ height }} />
}

/** A stack of labeled input-shaped bars — multi-field forms & wizards. */
export function FormSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <div className={`h-2.5 w-24 rounded ${shimmer}`} />
          <div className={`h-10 w-full rounded-xl ${shimmer}`} />
        </div>
      ))}
    </div>
  )
}

/** A narrow list of avatar+text rows — notification drawers, chat lists, activity feeds. */
export function ListRowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-3.5">
          <div className={`h-10 w-10 shrink-0 rounded-xl ${shimmer}`} />
          <div className="flex-1 space-y-1.5">
            <div className={`h-3 w-2/3 rounded ${shimmer}`} />
            <div className={`h-2.5 w-1/3 rounded ${shimmer}`} />
          </div>
        </div>
      ))}
    </div>
  )
}
/** Inline field validation message — e.g. "Passwords don't match", shown right under an input as the user types. */
export function FieldWarning({ children }: { children: React.ReactNode }) {
  const message = typeof children === 'string' ? translatePortalText(children) : children
  return (
    <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
      className="mt-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-rose-500">
      <AlertTriangle size={12} className="shrink-0" />{message}
    </motion.p>
  )
}
export function ErrorState({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl bg-rose-50/70 py-10 text-center ring-1 ring-rose-100">
      <AlertTriangle className="text-rose-500" size={26} />
      <p className="max-w-md px-6 text-sm font-semibold text-rose-700">{translatePortalText(error)}</p>
      {onRetry && (
        <button onClick={onRetry} className="btn-ghost gap-1.5 text-rose-600"><RefreshCw size={14} />{translatePortalText('Try again')}</button>
      )}
    </div>
  )
}
/**
 * Renders whichever of loading / error / empty / content applies — every page
 * shows real backend state instead of pretending it has data.
 */
export function AsyncBlock<T>({ state, empty, children, loadingLabel }: {
  // `reload` is only ever called for its side effect here, so accept any
  // resolved value — `useAsync`'s reload resolves to the refetched data, and
  // `Promise<T>` is not assignable to `Promise<void>`.
  state: { data: T | null; loading: boolean; error: string | null; reload: () => Promise<unknown> }
  empty?: { icon: string; text: string } | ((data: T) => { icon: string; text: string } | null)
  loadingLabel?: string
  children: (data: T) => React.ReactNode
}) {
  if (state.loading && !state.data) return <LoadingState label={loadingLabel} />
  if (state.error && !state.data) return <ErrorState error={state.error} onRetry={state.reload} />
  if (!state.data) return <EmptyState icon="📭" text="Nothing to show yet" />
  const e = typeof empty === 'function' ? empty(state.data) : empty
  if (e) return <EmptyState icon={e.icon} text={e.text} />
  return <>{children(state.data)}</>
}

// ── modal ────────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[999] grid place-items-center bg-deep-950/50 p-4 backdrop-blur-sm" onClick={onClose}>
          <motion.div initial={{ opacity: 0, y: 30, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20, scale: 0.97 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            className={`card max-h-[88vh] w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} overflow-y-auto`} onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white/90 px-6 py-4 backdrop-blur rounded-t-2xl">
              <h3 className="font-display text-lg font-bold text-deep-900">{typeof title === 'string' ? translatePortalText(title) : title}</h3>
              <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-deep-900"><X size={18} /></button>
            </div>
            <div className="p-6">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ── misc ─────────────────────────────────────────────────────
export function Stars({ n, size = 14 }: { n: number; size?: number }) {
  return <span className="inline-flex gap-0.5">{[1, 2, 3, 4, 5].map(i => <span key={i} style={{ fontSize: size }} className={i <= n ? 'text-amber-700 dark:text-amber-400' : 'text-slate-400'}>★</span>)}</span>
}
export function Progress({ pct, tone = 'bg-gradient-to-r from-ocean-500 to-ocean-300' }: { pct: number; tone?: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 1, ease: 'easeOut' }} className={`h-full rounded-full ${tone}`} />
    </div>
  )
}
export function Section({ title, sub, children, actions, className = '' }: { title: string; sub?: string; children: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className={`card p-4 md:p-5 ${className}`}>
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-[15px] font-bold text-deep-900">{translatePortalText(title)}</h2>
          {sub && <p className="text-xs text-slate-400 mt-0.5">{translatePortalText(sub)}</p>}
        </div>
        {actions}
      </div>
      {children}
    </motion.section>
  )
}
export function EmptyState({ icon, text }: { icon: string; text: string }) {
  return <div className="flex flex-col items-center gap-2 py-10 text-slate-400"><span className="text-4xl">{icon}</span><p className="text-sm font-medium">{translatePortalText(text)}</p></div>
}
export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} aria-pressed={on}
      className={`relative h-6 w-11 rounded-full transition-colors duration-300 ${on ? 'bg-gradient-to-r from-ocean-600 to-ocean-400' : 'bg-slate-200'}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all duration-300 ${on ? 'start-[22px]' : 'start-0.5'}`} />
    </button>
  )
}
// ── card / table view switcher ───────────────────────────────
export function ViewToggle({ view, onChange }: { view: 'card' | 'table'; onChange: (v: 'card' | 'table') => void }) {
  const opts = [{ k: 'card', icon: LayoutGrid, label: 'Cards' }, { k: 'table', icon: List, label: 'Table' }] as const
  return (
    <div className="flex gap-1 rounded-xl bg-white p-1 shadow-soft ring-1 ring-slate-100">
      {opts.map(o => (
        <button key={o.k} onClick={() => onChange(o.k)} title={translatePortalText(`${o.label} view`)}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${view === o.k ? 'bg-gradient-to-r from-ocean-600 to-ocean-400 text-white shadow-glow' : 'text-slate-500 hover:text-deep-900'}`}>
          <o.icon size={13} />{translatePortalText(o.label)}
        </button>
      ))}
    </div>
  )
}
export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={translatePortalText(placeholder)} className="input ps-9 md:w-72" />
    </div>
  )
}
export const fadeStagger = (i: number) => ({ initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, transition: { delay: i * 0.05 } })
