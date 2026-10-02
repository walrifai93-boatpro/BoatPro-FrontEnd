import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { LayoutGrid, List, Phone } from 'lucide-react'
import { Modal, toast as baseToast, type ToastTone } from '../ui'
import { useAuth } from '../auth'
import { formatPortalNumber, localizedField, translatePortalText } from '../i18n/runtime'

/** Translate fixed maintenance notifications while leaving unknown server text untouched. */
export function maintToast(message: string, tone?: ToastTone) {
  return baseToast(translatePortalText(message), tone)
}

// ── card / table view switcher ───────────────────────────────
export function MaintViewToggle({ view, onChange }: { view: 'card' | 'table'; onChange: (v: 'card' | 'table') => void }) {
  const opts = [{ k: 'card', icon: LayoutGrid, label: 'Cards' }, { k: 'table', icon: List, label: 'Table' }] as const
  return (
    <div className="flex gap-1 rounded-xl bg-white p-1 shadow-soft ring-1 ring-slate-100">
      {opts.map(o => (
        <button key={o.k} onClick={() => onChange(o.k)} title={`${translatePortalText(o.label)} ${translatePortalText("view")}`}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${view === o.k ? 'bg-gradient-to-r from-violet-600 to-indigo-500 text-white shadow-glow' : 'text-slate-500 hover:text-deep-900'}`}>
          <o.icon size={13} />{translatePortalText(o.label)}
        </button>
      ))}
    </div>
  )
}

// ── maintenance page header ──────────────────────────────────
export function MaintHeader({ title, sub, actions, icon }: { title: string; sub: string; actions?: React.ReactNode; icon?: React.ReactNode }) {
  /*
    The signed-in provider's own business, not a hardcoded one.

    This line read "HarborTech Marine · ... Console" as a literal, on every page of the
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
        <p className="mb-1 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.28em] text-violet-600">
          <span className="h-px w-6 bg-violet-500" />{businessName ? <><bdi dir="auto">{businessName}</bdi> · </> : null}{translatePortalText('Service Console')}
        </p>
        <h1 className="font-display text-2xl md:text-3xl font-extrabold tracking-tight text-deep-900 flex items-center gap-3">{icon}{translatePortalText(title)}</h1>
        <p className="mt-1 text-sm text-slate-500">{translatePortalText(sub)}</p>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </motion.div>
  )
}

// ── status / priority badge ──────────────────────────────────
const TONES: Record<string, string> = {
  // job statuses
  Pending: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200', Approved: 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200',
  Scheduled: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200', Assigned: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
  'En route': 'bg-sky-50 text-sky-700 ring-1 ring-sky-200', Inspection: 'bg-teal-50 text-teal-700 ring-1 ring-teal-200',
  Diagnosis: 'bg-teal-50 text-teal-700 ring-1 ring-teal-200', 'Awaiting approval': 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  'Waiting parts': 'bg-orange-50 text-orange-700 ring-1 ring-orange-200', 'In progress': 'bg-violet-50 text-violet-700 ring-1 ring-violet-200',
  'Quality check': 'bg-fuchsia-50 text-fuchsia-700 ring-1 ring-fuchsia-200', Completed: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  Delivered: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', Cancelled: 'bg-slate-100 text-slate-500 ring-1 ring-slate-200',
  // priority
  Low: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200', Medium: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  High: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200', Critical: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200',
  // inspection results
  Pass: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', Fail: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200',
  Attention: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  // diagnostics
  Detected: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200', Analyzing: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200',
  Resolved: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  // parts / tools
  Available: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', 'In use': 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
  Maintenance: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  // invoices
  Paid: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', Overdue: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200',
  Refunded: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
  // warranty
  Active: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', Expiring: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  Expired: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200', 'Claim open': 'bg-violet-50 text-violet-700 ring-1 ring-violet-200',
  // staff / accounts / approvals
  'On duty': 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', 'Off duty': 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
  'On leave': 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  'Pending Approval': 'bg-amber-50 text-amber-700 ring-1 ring-amber-300 font-semibold',
  'Awaiting Approval': 'bg-amber-50 text-amber-700 ring-1 ring-amber-300 font-semibold',
  Rejected: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200 font-semibold',
  Invited: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200 font-semibold',
  Disabled: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
  'Good standing': 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', Watch: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  'On hold': 'bg-rose-50 text-rose-600 ring-1 ring-rose-200',
  // licenses
  Valid: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', 'Expiring soon': 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  // schedule kind
  Workshop: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200', Mobile: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
  Dockside: 'bg-teal-50 text-teal-700 ring-1 ring-teal-200',
}
export function MBadge({ children, dot }: { children: string; dot?: boolean }) {
  return (
    <span className={`chip ${TONES[children] ?? 'bg-slate-100 text-slate-600'}`}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse-soft" />}{translatePortalText(children)}
    </span>
  )
}

// ── conic health / progress ring ─────────────────────────────
export function HealthRing({ score, size = 92, label, thickness = 9 }: { score: number; size?: number; label?: string; thickness?: number }) {
  const color = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#f43f5e'
  return (
    <div className="ring-sweep relative grid place-items-center" style={{ width: size, height: size }}>
      <div className="absolute inset-0 rounded-full" style={{ background: `conic-gradient(${color} ${score * 3.6}deg, rgba(148,163,184,0.18) 0deg)` }} />
      <div className="absolute rounded-full bg-white dark:bg-[#0b1628]" style={{ inset: thickness }} />
      <div className="relative text-center leading-none">
        <p className="font-display font-extrabold text-deep-900" style={{ fontSize: size * 0.26 }}>{formatPortalNumber(score)}</p>
        {label && <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{translatePortalText(label)}</p>}
      </div>
    </div>
  )
}

// ── linear progress with violet gradient ─────────────────────
export function JobProgress({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 1, ease: 'easeOut' }}
        className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-400" />
    </div>
  )
}

/**
 * Placing a call to somebody the portal knows the number of.
 *
 * What was here before was a simulator. `CallModal` showed "Ringing…" for
 * 1,600 ms, switched itself to "Connected", and ran a live seconds counter with
 * an "End call" button — while placing no call of any kind. Its own comment
 * described this as a "real ringing/connected/ended lifecycle". A dispatcher
 * watching a call timer tick against a technician's name had every reason to
 * believe they were talking to them, and nothing about the screen suggested
 * otherwise. On a maintenance desk coordinating work on the water, that is a
 * dangerous thing to be wrong about.
 *
 * The browser cannot place a call, so this hands off to whatever can: `tel:`
 * dials on a phone or tablet and opens the desktop's softphone otherwise. The
 * number is shown in full so it can be dialled by hand, and copied in one tap
 * for the cases where neither works. When the record has no number, the dialog
 * says so rather than pretending.
 */
export interface CallTarget {
  name: string
  avatar?: string
  role?: string
  /** Digits from the record. Absent when none is on file. */
  phone?: string
}

export function useCall() {
  const [target, setTarget] = useState<CallTarget | null>(null)
  return { call: (t: CallTarget) => setTarget(t), target, close: () => setTarget(null) }
}

export function CallModal({ target, onClose }: { target: CallTarget | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => { setCopied(false) }, [target])

  // Strip formatting for the tel: URI — spaces and dashes are fine for reading
  // but some dialers refuse them. A leading + is kept, being significant.
  const dialable = (target?.phone || '').replace(/[^\d+]/g, '')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(target?.phone || '')
      setCopied(true)
    } catch {
      // Clipboard can be refused outright; the number is on screen regardless.
      setCopied(false)
    }
  }

  return (
    <Modal open={!!target} onClose={onClose} title={translatePortalText("📞 Call")}>
      {target && (
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          {target.avatar
            ? <img src={target.avatar} alt="" className="h-20 w-20 rounded-full object-cover ring-4 ring-violet-100" />
            : <div className="grid h-20 w-20 place-items-center rounded-full bg-violet-100 text-2xl font-extrabold text-violet-600">{target.name[0]}</div>}
          <div>
            <p className="font-display text-lg font-extrabold text-deep-900"><bdi dir="auto">{target.name}</bdi></p>
            {target.role && <p className="text-xs text-slate-400">{translatePortalText(target.role)}</p>}
          </div>

          {dialable ? (
            <>
              <p className="font-display text-xl font-extrabold tracking-wide text-deep-900" dir="ltr">{target.phone}</p>
              <div className="flex items-center gap-2">
                <a
                  href={`tel:${dialable}`}
                  className="flex items-center gap-2 rounded-full bg-emerald-600 px-6 py-3 text-sm font-extrabold text-white shadow-glow transition hover:bg-emerald-700 active:scale-95"
                >
                  <Phone size={16} /> {translatePortalText("Call now")}
                </a>
                <button onClick={() => void copy()} className="btn-ghost !py-3">
                  {copied ? translatePortalText("Copied") : translatePortalText("Copy number")}
                </button>
              </div>
              <p className="text-[11px] text-slate-400">
                {translatePortalText("Opens your phone or desktop dialler — the call is not placed by this page.")}
              </p>
            </>
          ) : (
            <p className="max-w-xs text-sm text-slate-500">
              {translatePortalText("No phone number is on record for")} {target.name}{translatePortalText(". Add one to their profile to be able to call from here.")}
            </p>
          )}

          <button onClick={onClose} className="btn-ghost">{translatePortalText("Close")}</button>
        </div>
      )}
    </Modal>
  )
}

// ── mini metric row ──────────────────────────────────────────
export function Metric({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-sand px-3 py-2.5 text-xs">
      <span>{icon}</span>
      <span className="font-semibold text-slate-400">{translatePortalText(label)}</span>
      <b className="ms-auto text-deep-900">{value}</b>
    </div>
  )
}
