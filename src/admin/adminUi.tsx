import React from 'react'
import { motion } from 'framer-motion'
import { LayoutGrid, List } from 'lucide-react'
import { translatePortalText, formatPortalNumber, formatPortalPercent } from '../i18n/runtime'

// ── card / table view switcher ───────────────────────────────
export function ViewToggle({ view, onChange }: { view: 'card' | 'table'; onChange: (v: 'card' | 'table') => void }) {
  const opts = [{ k: 'card', icon: LayoutGrid, label: 'Cards' }, { k: 'table', icon: List, label: 'Table' }] as const
  return (
    <div className="flex gap-1 rounded-xl bg-white p-1 shadow-soft ring-1 ring-slate-100 dark:ring-white/10">
      {opts.map(o => (
        <button key={o.k} onClick={() => onChange(o.k)} title={translatePortalText(`${o.label} view`)}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${view === o.k ? 'bg-gradient-to-r from-emerald-600 to-teal-500 text-white shadow-glow' : 'text-slate-500 hover:text-deep-900'}`}>
          <o.icon size={13} />{translatePortalText(o.label)}
        </button>
      ))}
    </div>
  )
}

// ── admin page header ────────────────────────────────────────
export function AdminHeader({ title, sub, actions, icon }: { title: string; sub: string; actions?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-slate-200/70 pb-5">
      <div>
        <p className="mb-1 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.28em] text-emerald-600">
          <span className="h-px w-6 bg-emerald-500" />{translatePortalText('BoatPro HQ · Super Admin Console')}
        </p>
        <h1 className="font-display text-2xl md:text-3xl font-extrabold tracking-tight text-deep-900 flex items-center gap-3">{icon}{translatePortalText(title)}</h1>
        <p className="mt-1 text-sm text-slate-500">{translatePortalText(sub)}</p>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </motion.div>
  )
}

// ── status badge ─────────────────────────────────────────────
const TONES: Record<string, string> = {
  // users / providers
  Active: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', Suspended: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  Blocked: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200', Pending: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  Live: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', Rejected: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200',
  Approved: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', Verified: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  // bookings / txns
  Confirmed: 'bg-teal-50 text-teal-700 ring-1 ring-teal-200', Completed: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  Cancelled: 'bg-slate-100 text-slate-500 ring-1 ring-slate-200', Refunded: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200',
  Disputed: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200', Settled: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  Failed: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200', Flagged: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200',
  // support
  Open: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200', 'In progress': 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
  Escalated: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200', Resolved: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  // priority / severity
  Low: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200', Medium: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  High: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200', Urgent: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200',
  Critical: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200', Investigating: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200',
  // reviews
  Visible: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', Hidden: 'bg-slate-100 text-slate-500 ring-1 ring-slate-200',
  Spam: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200',
  // kyc
  Expiring: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  // system
  Operational: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', Degraded: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  Down: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200', Connected: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  // sos / ads / cms / regions
  Responding: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200', Running: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  Paused: 'bg-slate-100 text-slate-500 ring-1 ring-slate-200', Published: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  Draft: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200', Beta: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
  Planned: 'bg-slate-100 text-slate-500 ring-1 ring-slate-200',
  // plans / docs
  Free: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200', Basic: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
  Premium: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', Enterprise: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200',
  Complete: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', Missing: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200',
  // stations / services
  Online: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', Offline: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200',
  'Low stock': 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
}
// `truncate` for free text such as a plan name: the chip shrinks and ends in an
// ellipsis (full text on hover) instead of forcing its own width on the layout.
export function ABadge({ children, dot, label, truncate, className = '' }: { children: string; dot?: boolean; label?: string; truncate?: boolean; className?: string }) {
  const text = label ?? translatePortalText(children)
  return (
    <span className={`chip ${TONES[children] ?? 'bg-slate-100 text-slate-600'}${truncate ? ' min-w-0' : ''}${className ? ` ${className}` : ''}`} title={truncate ? text : undefined}>
      {dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current animate-pulse-soft" />}{truncate ? <span className="truncate">{text}</span> : text}
    </span>
  )
}

// ── conic ring stat (uptime, usage) ──────────────────────────
export function RingStat({ pct, size = 84, label, suffix = '%', good = 'high' }: { pct: number; size?: number; label?: string; suffix?: string; good?: 'high' | 'low' }) {
  const score = good === 'high' ? pct : 100 - pct
  const color = score >= 75 ? '#10b981' : score >= 45 ? '#f59e0b' : '#f43f5e'
  return (
    <div className="ring-sweep relative grid place-items-center" style={{ width: size, height: size }}>
      <div className="absolute inset-0 rounded-full" style={{ background: `conic-gradient(${color} ${pct * 3.6}deg, rgba(148,163,184,0.18) 0deg)` }} />
      <div className="absolute rounded-full bg-white dark:bg-[#0b1628]" style={{ inset: size * 0.11 }} />
      <div className="relative text-center leading-none">
        <p className="font-display font-extrabold text-deep-900" style={{ fontSize: size * 0.22 }}>{suffix === '%' ? formatPortalPercent(pct) : `${formatPortalNumber(pct)}${translatePortalText(suffix)}`}</p>
        {label && <p className="mt-0.5 text-[8px] font-bold uppercase tracking-wide text-slate-400">{label}</p>}
      </div>
    </div>
  )
}

// ── emerald progress bar ─────────────────────────────────────
export function AProgress({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 1, ease: 'easeOut' }}
        className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400" />
    </div>
  )
}

// ── mini metric row ──────────────────────────────────────────
export function Metric({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-sand px-3 py-2.5 text-xs">
      <span>{icon}</span>
      <span className="font-semibold text-slate-400">{label}</span>
      <b className="ms-auto text-deep-900">{value}</b>
    </div>
  )
}
