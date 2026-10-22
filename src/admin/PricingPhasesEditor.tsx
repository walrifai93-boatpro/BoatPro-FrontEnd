import React from 'react'
import { Plus, Trash2, Sparkles } from 'lucide-react'
import type {
  CommissionPackageData, CommissionPricingPhaseData, CommissionType, PricingStepView,
  SubscriptionPackageData, SubscriptionPricingPhaseData,
} from '../api'
import {
  isPortalArabic, translatePortalText, translatePortalTemplate, formatPortalNumber, formatPortalPercent,
} from '../i18n/runtime'

/**
 * Introductory ("stepped") pricing for a package: "1st month SAR 0, the next 3
 * at SAR 250, then the regular price" on a subscription, or "month 1 at 0%,
 * months 2–4 at 5%, then the tier's 10%" on a commission tier.
 *
 * The editor works on string drafts so a half-typed number is not coerced to 0
 * under the admin's cursor; the payload helpers turn them into the API shape.
 * The limits are the server's own (planPricing.service): at most six steps,
 * each a whole number of periods from 1 to 60, sixty in total.
 */

export const MAX_PRICING_STEPS = 6
export const MAX_INTRO_PERIODS = 60

const t = translatePortalText
const tt = translatePortalTemplate

// ── formatting shared by the plan screens ───────────────────────────────────

export const fmtAmount = (n: number | null | undefined) => formatPortalNumber(n ?? 0, { maximumFractionDigits: 2 })
/** "SAR 250" — in Arabic "٢٥٠ ر.س". */
export const sar = (n: number | null | undefined) => tt('SAR {{amount}}', { amount: fmtAmount(n) })
/** A percentage with only the decimals it actually has: 10%, 2.5%, 7.25%. */
export function pct(n: number | null | undefined): string {
  const v = n ?? 0
  const digits = Number.isInteger(v) ? 0 : Math.abs(v * 10 - Math.round(v * 10)) < 1e-9 ? 1 : 2
  return formatPortalPercent(v, digits)
}

/** "1 month", "3 months" — with the Arabic dual and plural forms. */
export function monthCount(n: number): string {
  const c = Math.abs(Math.trunc(n))
  if (isPortalArabic()) {
    if (c === 1) return 'شهر واحد'
    if (c === 2) return 'شهران'
    if (c >= 3 && c <= 10) return `${formatPortalNumber(c)} أشهر`
    return `${formatPortalNumber(c)} شهرًا`
  }
  return `${formatPortalNumber(c)} ${c === 1 ? 'month' : 'months'}`
}

/** "1 billing period", "3 billing periods". */
export function periodCount(n: number): string {
  const c = Math.abs(Math.trunc(n))
  if (isPortalArabic()) {
    if (c === 1) return 'فترة فوترة واحدة'
    if (c === 2) return 'فترتا فوترة'
    if (c >= 3 && c <= 10) return `${formatPortalNumber(c)} فترات فوترة`
    return `${formatPortalNumber(c)} فترة فوترة`
  }
  return `${formatPortalNumber(c)} ${c === 1 ? 'billing period' : 'billing periods'}`
}

/** What one billing period of a package is: "month", "year", "3 months". */
export function periodNoun(durationMonths?: number | null): string {
  const m = durationMonths || 1
  if (m === 1) return t('month')
  if (m === 12) return t('year')
  if (m % 12 === 0) return isPortalArabic() ? `${formatPortalNumber(m / 12)} ${t('years')}` : `${formatPortalNumber(m / 12)} years`
  return monthCount(m)
}

/** One commission figure: "10%" or "SAR 3 per booking". */
export function commissionFigure(commissionType: CommissionType | undefined | null, rate?: number | null, fixedAmount?: number | null): string {
  return commissionType === 'fixed' ? tt('SAR {{amount}} per booking', { amount: fmtAmount(fixedAmount) }) : pct(rate)
}

/** A subscription price for one period: "SAR 250 / month". */
export function periodPrice(price: number | null | undefined, durationMonths?: number | null): string {
  return tt('SAR {{amount}} / {{period}}', { amount: fmtAmount(price), period: periodNoun(durationMonths) })
}

// ── schedules ───────────────────────────────────────────────────────────────

/** A schedule step — the server's `PricingStepView` without its English `text`. */
export type ScheduleStep = Omit<PricingStepView, 'text'> & { text?: string }

export type ScheduleBill =
  | { bill: 'subscription'; durationMonths?: number | null }
  | { bill: 'commission'; commissionType?: CommissionType | null }

/**
 * A subscription package's schedule: the listing's own `schedule` when it sent
 * one, else worked out the way the server does (steps back to back from the
 * first paid period, each `periods × durationMonths` months long).
 */
export function subscriptionSchedule(pkg: { price?: number; durationMonths?: number; pricingPhases?: SubscriptionPricingPhaseData[]; schedule?: PricingStepView[] } | null | undefined): ScheduleStep[] {
  if (!pkg) return []
  if (pkg.schedule?.length) return pkg.schedule
  const dm = pkg.durationMonths || 1
  const steps: ScheduleStep[] = []
  let month = 1
  ;(pkg.pricingPhases || []).forEach((p, i) => {
    const to = month + p.periods * dm - 1
    const discounted = p.discountType === 'percent' || p.discountType === 'amount'
    steps.push({
      index: i + 1, fromMonth: month, toMonth: to, price: p.price, label: p.label,
      ...(discounted ? { discountType: p.discountType as 'percent' | 'amount', discountValue: p.discountValue } : {}),
    })
    month = to + 1
  })
  steps.push({ index: null, fromMonth: month, toMonth: null, price: pkg.price ?? 0 })
  return steps
}

/** The same for a commission tier, in calendar months from the day a provider joins it. */
export function commissionSchedule(pkg: { commissionType?: CommissionType; commissionPercentage?: number; fixedAmountSar?: number; pricingPhases?: CommissionPricingPhaseData[]; schedule?: PricingStepView[] } | null | undefined): ScheduleStep[] {
  if (!pkg) return []
  if (pkg.schedule?.length) return pkg.schedule
  const isFixed = pkg.commissionType === 'fixed'
  const steps: ScheduleStep[] = []
  let month = 1
  ;(pkg.pricingPhases || []).forEach((p, i) => {
    const to = month + p.months - 1
    steps.push({
      index: i + 1, fromMonth: month, toMonth: to, label: p.label,
      rate: isFixed ? undefined : p.commissionPercentage,
      fixedAmount: isFixed ? p.fixedAmountSar : undefined,
      ...(p.discountType === 'percent' ? { discountType: 'percent' as const, discountValue: p.discountValue } : {}),
    })
    month = to + 1
  })
  steps.push({
    index: null, fromMonth: month, toMonth: null,
    rate: isFixed ? undefined : pkg.commissionPercentage,
    fixedAmount: isFixed ? pkg.fixedAmountSar : undefined,
  })
  return steps
}

export const hasIntroSteps = (steps: ScheduleStep[]) => steps.some(s => s.index !== null)

/** "50% off" / "SAR 1,000 off" / "free" for a step written as a discount; "" otherwise. */
export function discountTag(step: ScheduleStep, bill: ScheduleBill): string {
  if (step.discountType === 'percent') {
    if ((step.discountValue ?? 0) >= 100) return bill.bill === 'subscription' ? '' : t('free')
    return tt('{{pct}} off', { pct: pct(step.discountValue) })
  }
  if (step.discountType === 'amount') return tt('SAR {{amount}} off', { amount: fmtAmount(step.discountValue) })
  return ''
}

/** The figure a step charges, in the package's own vocabulary, with its discount when it has one. */
export function stepValue(step: ScheduleStep, bill: ScheduleBill): string {
  const base = bill.bill === 'subscription'
    ? (step.index !== null && (step.price ?? 0) <= 0 ? t('Free') : periodPrice(step.price, bill.durationMonths))
    : commissionFigure(bill.commissionType, step.rate, step.fixedAmount)
  const tag = discountTag(step, bill)
  return tag ? `${base} (${tag})` : base
}

/** "Months 2–4: SAR 250 / month", localised from the step's figures rather than the server's English `text`. */
export function stepText(step: ScheduleStep, bill: ScheduleBill): string {
  const value = stepValue(step, bill)
  const n = (v: number) => formatPortalNumber(v)
  if (step.toMonth === null || step.toMonth === undefined) {
    // The regular price on its own — no steps before it — is just the price:
    // "Every month: SAR 5,000 / year" contradicted itself on a yearly package.
    return step.fromMonth <= 1
      ? value
      : tt('From month {{month}}: {{value}}', { month: n(step.fromMonth), value })
  }
  return step.fromMonth === step.toMonth
    ? tt('Month {{month}}: {{value}}', { month: n(step.fromMonth), value })
    : tt('Months {{from}}–{{to}}: {{value}}', { from: n(step.fromMonth), to: n(step.toMonth), value })
}

/** The whole schedule on one line, ending "(regular price)". */
export function scheduleSummary(steps: ScheduleStep[], bill: ScheduleBill): string {
  if (!steps.length) return ''
  const regular = t(bill.bill === 'subscription' ? '(regular price)' : '(regular rate)')
  return steps.map((s, i) => (i === steps.length - 1 ? `${stepText(s, bill)} ${regular}` : stepText(s, bill))).join(' · ')
}

/** The small "Intro offer" chip on package cards and plan panels. */
export function IntroBadge({ className = '' }: { className?: string }) {
  return (
    <span className={`chip !text-[10px] bg-violet-50 text-violet-700 ring-1 ring-violet-200 ${className}`}>
      <Sparkles size={10} /> {t('Intro offer')}
    </span>
  )
}

const SEGMENT_TONES = ['bg-emerald-400', 'bg-teal-400', 'bg-cyan-400', 'bg-sky-400', 'bg-indigo-400', 'bg-violet-400']

/**
 * The schedule drawn as a strip (intro steps sized by their length, then the
 * open-ended regular price) with the plain-language lines under it.
 * `currentIndex` highlights the step a provider is in now (`null` = regular).
 */
export function ScheduleTimeline({ steps, bill, currentIndex, currentLabel = 'Now', compact }: {
  steps: ScheduleStep[]
  bill: ScheduleBill
  /** Step the provider is in right now; `undefined` = do not highlight anything. */
  currentIndex?: number | null
  /** The tag on the highlighted step — "Now", or "Next renewal" for a subscription quote. */
  currentLabel?: string
  compact?: boolean
}) {
  if (!steps.length) return null
  const intro = steps.filter(s => s.index !== null)
  const introMonths = intro.reduce((sum, s) => sum + Math.max(1, (s.toMonth ?? s.fromMonth) - s.fromMonth + 1), 0)
  const regularShare = intro.length ? 28 : 100
  const isCurrent = (s: ScheduleStep) => currentIndex !== undefined && (s.index ?? null) === currentIndex
  return (
    <div className="space-y-2">
      <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
        {steps.map((s, i) => {
          const months = s.index === null ? 0 : Math.max(1, (s.toMonth ?? s.fromMonth) - s.fromMonth + 1)
          const width = s.index === null ? regularShare : ((100 - regularShare) * months) / Math.max(1, introMonths)
          const tone = s.index === null ? 'bg-slate-300' : SEGMENT_TONES[i % SEGMENT_TONES.length]
          return <span key={i} className={`h-full ${tone} ${isCurrent(s) ? 'ring-2 ring-deep-900/60 ring-inset' : ''}`} style={{ width: `${Math.max(width, 4)}%` }} />
        })}
      </div>
      <ul className={`space-y-1 ${compact ? 'text-[11px]' : 'text-xs'}`}>
        {steps.map((s, i) => (
          <li key={i} className={`flex flex-wrap items-center gap-1.5 ${isCurrent(s) ? 'font-extrabold text-deep-900' : 'text-slate-600'}`}>
            <span className={`h-2 w-2 shrink-0 rounded-full ${s.index === null ? 'bg-slate-300' : SEGMENT_TONES[i % SEGMENT_TONES.length]}`} />
            <span>{stepText(s, bill)}</span>
            {s.index === null && <span className="text-[10px] font-semibold text-slate-400">{t(bill.bill === 'subscription' ? '(regular price)' : '(regular rate)')}</span>}
            {s.label && <span className="chip !py-0 !text-[10px] bg-sand text-slate-500">{s.label}</span>}
            {isCurrent(s) && <span className="chip !py-0 !text-[10px] bg-deep-900 text-white">{t(currentLabel)}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── the editor ──────────────────────────────────────────────────────────────

/**
 * How a step is written. A subscription step is a discount on the regular
 * price (`percent` off, `amount` SAR off), a set `price`, or `free`. A
 * commission step is `percent` off the tier's regular rate or fee, a set
 * `rate` (a percentage, or SAR per booking on a fixed tier), or `free`.
 *
 * Discount steps are saved as discounts, so if the regular price is edited
 * later, "50% off" stays 50% off — the server re-works the step's price.
 */
export type StepKind = 'free' | 'percent' | 'amount' | 'price' | 'rate'

/** One step as typed: `length` is months (commission) or billing periods (subscription). */
export interface PhaseDraft {
  key: number
  length: string
  kind: StepKind
  /** The number for `kind` — % off, SAR off, the price, or the rate. Unused for `free`. */
  amount: string
  label: string
}

let draftSeq = 0
const nextKey = () => ++draftSeq
const draft = (length: number | string, kind: StepKind, amount = '', label = ''): PhaseDraft =>
  ({ key: nextKey(), length: String(length), kind, amount, label })

const round2 = (n: number) => Math.round(n * 100) / 100
const pctOff = (regular: number, percent: number) => round2(Math.max(0, regular * (1 - Math.min(100, percent) / 100)))

/** What a provider in this step pays — price per period, rate, or fee — given the regular figure. */
export function draftFigure(d: PhaseDraft, regular: number): number {
  const v = Number(d.amount)
  switch (d.kind) {
    case 'free': return 0
    case 'percent': return pctOff(regular, v)
    case 'amount': return round2(Math.max(0, regular - v))
    default: return round2(v)
  }
}

export function subscriptionPhaseDrafts(phases?: SubscriptionPricingPhaseData[] | null): PhaseDraft[] {
  return (phases || []).map(p => {
    if (p.discountType === 'percent' && (p.discountValue ?? 0) >= 100) return draft(p.periods, 'free', '', p.label)
    if (p.discountType === 'percent' || p.discountType === 'amount') return draft(p.periods, p.discountType, String(p.discountValue ?? ''), p.label)
    return p.price <= 0 ? draft(p.periods, 'free', '', p.label) : draft(p.periods, 'price', String(p.price), p.label)
  })
}

export function commissionPhaseDrafts(phases: CommissionPricingPhaseData[] | null | undefined, commissionType: CommissionType | undefined): PhaseDraft[] {
  return (phases || []).map(p => {
    if (p.discountType === 'percent') {
      return (p.discountValue ?? 0) >= 100 ? draft(p.months, 'free', '', p.label) : draft(p.months, 'percent', String(p.discountValue ?? ''), p.label)
    }
    const figure = (commissionType === 'fixed' ? p.fixedAmountSar : p.commissionPercentage) ?? 0
    return figure <= 0 ? draft(p.months, 'free', '', p.label) : draft(p.months, 'rate', String(figure), p.label)
  })
}

/**
 * The drafts to edit a saved package with. From `pricingPhases` when the
 * listing sent them; otherwise rebuilt from its read-only `schedule`, so a
 * listing that only sent the schedule cannot make Save quietly clear the steps.
 */
export function subscriptionDraftsForPackage(pkg: SubscriptionPackageData): PhaseDraft[] {
  if (pkg.pricingPhases) return subscriptionPhaseDrafts(pkg.pricingPhases)
  const dm = pkg.durationMonths || 1
  return subscriptionPhaseDrafts((pkg.schedule || [])
    .filter(s => s.index !== null && s.toMonth !== null && s.toMonth !== undefined)
    .map(s => ({
      periods: Math.max(1, Math.round(((s.toMonth as number) - s.fromMonth + 1) / dm)),
      price: s.price ?? 0,
      discountType: s.discountType,
      discountValue: s.discountValue,
      label: s.label,
    })))
}

export function commissionDraftsForPackage(pkg: CommissionPackageData): PhaseDraft[] {
  if (pkg.pricingPhases) return commissionPhaseDrafts(pkg.pricingPhases, pkg.commissionType)
  return commissionPhaseDrafts((pkg.schedule || [])
    .filter(s => s.index !== null && s.toMonth !== null && s.toMonth !== undefined)
    .map(s => ({
      months: Math.max(1, (s.toMonth as number) - s.fromMonth + 1),
      commissionPercentage: s.rate,
      fixedAmountSar: s.fixedAmount,
      discountType: s.discountType === 'percent' ? 'percent' as const : undefined,
      discountValue: s.discountValue,
      label: s.label,
    })), pkg.commissionType)
}

const labelOf = (d: PhaseDraft) => (d.label.trim() ? { label: d.label.trim() } : {})

/** The API shape. `regular` is the package's regular price, so each step also carries what it resolves to. */
export function subscriptionPhasesPayload(drafts: PhaseDraft[], regular: number): SubscriptionPricingPhaseData[] {
  return drafts.map(d => {
    const base = { periods: Number(d.length), price: draftFigure(d, regular), ...labelOf(d) }
    if (d.kind === 'free') return { ...base, discountType: 'percent' as const, discountValue: 100 }
    if (d.kind === 'percent' || d.kind === 'amount') return { ...base, discountType: d.kind, discountValue: Number(d.amount) }
    return base
  })
}

/** The API shape. `regular` is the tier's regular rate (or flat fee on a fixed tier). */
export function commissionPhasesPayload(drafts: PhaseDraft[], commissionType: CommissionType, regular: number): CommissionPricingPhaseData[] {
  return drafts.map(d => {
    const figure = draftFigure(d, regular)
    const base = { months: Number(d.length), ...(commissionType === 'fixed' ? { fixedAmountSar: figure } : { commissionPercentage: figure }), ...labelOf(d) }
    if (d.kind === 'free') return { ...base, discountType: 'percent' as const, discountValue: 100 }
    if (d.kind === 'percent') return { ...base, discountType: 'percent' as const, discountValue: Number(d.amount) }
    return base
  })
}

/**
 * A comparable fingerprint of a package's steps — to tell whether an edit
 * changed them. A free step reads the same whether it was saved as "100% off"
 * or as a 0 figure.
 */
export function phasesSignature(phases: Array<{ periods?: number; months?: number; price?: number; commissionPercentage?: number; fixedAmountSar?: number; discountType?: string; discountValue?: number; label?: string }> | null | undefined): string {
  return JSON.stringify((phases || []).map(p => {
    const figure = p.price ?? p.commissionPercentage ?? p.fixedAmountSar ?? 0
    const discount = p.discountType === 'percent' || p.discountType === 'amount' ? p.discountType : null
    const free = (discount === 'percent' && (p.discountValue ?? 0) >= 100) || (!discount && figure <= 0)
    return [p.periods ?? p.months ?? 0, free ? 'free' : discount ?? 'set', free ? 0 : discount ? p.discountValue ?? 0 : figure, (p.label || '').trim()]
  }))
}

interface EditorMode {
  bill: 'subscription' | 'commission'
  commissionType?: CommissionType
  /** Subscription only: months in one billing period. */
  durationMonths?: number
}

/**
 * Each row's problem (translated), or null. Mirrors `validateSubscriptionPhases` / `validateCommissionPhases`.
 *
 * `regular` is the package's regular price, rate or fee: a step written as a
 * set figure above it is refused by the server ("an introductory price cannot
 * be more than the regular price"), so it is an error here too, not a warning.
 */
export function phaseDraftErrors(drafts: PhaseDraft[], mode: EditorMode, regular?: number): { rows: (string | null)[]; total: string | null } {
  const aboveRegular = (figure: number) => regular !== undefined && Number.isFinite(regular) && figure > regular
  const rows = drafts.map((d, i) => {
    const n = { n: formatPortalNumber(i + 1) }
    const length = Number(d.length)
    if (d.length.trim() === '' || !Number.isInteger(length) || length < 1 || length > MAX_INTRO_PERIODS) {
      return mode.bill === 'subscription'
        ? tt('Step {{n}}: billing periods must be a whole number from 1 to 60', n)
        : tt('Step {{n}}: months must be a whole number from 1 to 60', n)
    }
    if (d.kind === 'free') return null
    const amount = Number(d.amount)
    if (d.amount.trim() === '' || !Number.isFinite(amount)) return tt('Step {{n}}: enter an amount', n)
    if (d.kind === 'percent') {
      if (amount <= 0 || amount > 100) return tt('Step {{n}}: the discount must be more than 0% and at most 100%', n)
    } else if (d.kind === 'amount') {
      if (amount <= 0) return tt('Step {{n}}: the amount off must be more than 0', n)
    } else if (mode.bill === 'commission' && mode.commissionType !== 'fixed') {
      if (amount < 0 || amount > 100) return tt('Step {{n}}: the commission must be between 0 and 100%', n)
      if (aboveRegular(amount)) return tt('Step {{n}}: an introductory rate cannot be more than the regular rate', n)
    } else if (amount < 0) {
      return tt('Step {{n}}: the amount must be 0 or more', n)
    } else if (aboveRegular(amount)) {
      return mode.bill === 'subscription'
        ? tt('Step {{n}}: an introductory price cannot be more than the regular price', n)
        : tt('Step {{n}}: an introductory fee cannot be more than the regular fee', n)
    }
    return null
  })
  const total = drafts.reduce((s, d) => s + (Number.isFinite(Number(d.length)) ? Number(d.length) : 0), 0)
  let totalError: string | null = null
  if (drafts.length > MAX_PRICING_STEPS) totalError = t('At most 6 introductory price steps')
  else if (total > MAX_INTRO_PERIODS) {
    totalError = t(mode.bill === 'subscription'
      ? 'The introductory steps can cover at most 60 billing periods in total'
      : 'The introductory steps can cover at most 60 months in total')
  }
  return { rows, total: totalError }
}

/** The first problem with the steps, translated — for the save handler's toast. `regular` as in `phaseDraftErrors`. */
export function firstPhaseDraftError(drafts: PhaseDraft[], mode: EditorMode, regular?: number): string | null {
  const { rows, total } = phaseDraftErrors(drafts, mode, regular)
  return rows.find(Boolean) ?? total
}

/** The step types offered for a bill, in the order shown. */
function kindOptions(mode: EditorMode): { kind: StepKind; label: string }[] {
  if (mode.bill === 'subscription') {
    return [
      { kind: 'percent', label: t('% off') },
      { kind: 'amount', label: t('SAR off') },
      { kind: 'free', label: t('Free') },
      { kind: 'price', label: t('Set price') },
    ]
  }
  const isFixed = mode.commissionType === 'fixed'
  return [
    { kind: 'percent', label: t(isFixed ? '% off the fee' : '% off the rate') },
    { kind: 'free', label: t(isFixed ? 'Free (SAR 0)' : 'Free (0%)') },
    { kind: 'rate', label: t(isFixed ? 'Set fee (SAR)' : 'Set rate (%)') },
  ]
}

/** One-click starting points. Each replaces the current steps; every value stays editable. */
function presets(mode: EditorMode, dm: number): { title: string; steps: () => PhaseDraft[] }[] {
  if (mode.bill === 'commission') {
    return [
      { title: t('First month commission-free'), steps: () => [draft(1, 'free')] },
      { title: t('First month 50% off'), steps: () => [draft(1, 'percent', '50')] },
      { title: t('First 3 months at half commission'), steps: () => [draft(3, 'percent', '50')] },
      { title: t('1 month free, then 3 months 50% off'), steps: () => [draft(1, 'free'), draft(3, 'percent', '50')] },
    ]
  }
  const monthly = dm === 1
  return [
    { title: t(monthly ? 'First month free' : 'First period free'), steps: () => [draft(1, 'free')] },
    { title: t(monthly ? 'First month 50% off' : 'First period 50% off'), steps: () => [draft(1, 'percent', '50')] },
    { title: t(monthly ? 'First 3 months 25% off' : 'First 3 periods 25% off'), steps: () => [draft(3, 'percent', '25')] },
    { title: t(monthly ? '1 month free, then 3 months 50% off' : '1 period free, then 3 periods 50% off'), steps: () => [draft(1, 'free'), draft(3, 'percent', '50')] },
  ]
}

/**
 * Step editor with a live preview of what a new provider would pay.
 *
 * Used in both package modals on Packages & Pricing. `regular` is the price,
 * percentage or flat fee in the form above it, so the preview follows the form.
 */
export function PricingPhasesEditor({ mode, regular, value, onChange }: {
  mode: EditorMode
  regular: number
  value: PhaseDraft[]
  onChange: (next: PhaseDraft[]) => void
}) {
  const isSub = mode.bill === 'subscription'
  const dm = Math.max(1, Math.trunc(mode.durationMonths || 1))
  const isFixed = mode.bill === 'commission' && mode.commissionType === 'fixed'
  const errors = phaseDraftErrors(value, mode, regular)
  const options = kindOptions(mode)

  const update = (key: number, patch: Partial<PhaseDraft>) => onChange(value.map(d => (d.key === key ? { ...d, ...patch } : d)))
  const add = () => {
    if (value.length >= MAX_PRICING_STEPS) return
    // A first step is most often a free launch period; later ones a partial discount.
    onChange([...value, value.length ? draft(3, 'percent', '50') : draft(1, 'free')])
  }
  const remove = (key: number) => onChange(value.filter(d => d.key !== key))
  /** Switching type keeps the row's number only where it still means the same thing. */
  const changeKind = (d: PhaseDraft, kind: StepKind) => {
    if (kind === d.kind) return
    const amount = kind === 'free' ? '' : kind === 'percent' ? '50' : kind === 'amount' ? '' : String(draftFigure(d, regular))
    update(d.key, { kind, amount })
  }

  const lengthLabel = isSub
    ? (dm === 1 ? t('Months') : tt('Billing periods (each {{period}})', { period: monthCount(dm) }))
    : t('Months')
  const unitFor = (kind: StepKind) =>
    kind === 'percent' ? '%' : kind === 'rate' ? (isFixed ? t('SAR') : '%') : t('SAR')
  const figureText = (figure: number) => (isSub
    ? (figure <= 0 ? t('Free') : periodPrice(figure, dm))
    : commissionFigure(mode.commissionType, figure, figure))

  // The preview: only rows that would be accepted, so it never shows "NaN".
  const valid = value.filter((_, i) => !errors.rows[i])
  const bill: ScheduleBill = isSub ? { bill: 'subscription', durationMonths: dm } : { bill: 'commission', commissionType: mode.commissionType }
  const preview = isSub
    ? subscriptionSchedule({ price: regular, durationMonths: dm, pricingPhases: subscriptionPhasesPayload(valid, regular) })
    : commissionSchedule({
        commissionType: mode.commissionType,
        commissionPercentage: isFixed ? undefined : regular,
        fixedAmountSar: isFixed ? regular : undefined,
        pricingPhases: commissionPhasesPayload(valid, mode.commissionType || 'percentage', regular),
      })
  const totalLength = value.reduce((s, d) => s + (Number.isInteger(Number(d.length)) ? Number(d.length) : 0), 0)

  return (
    <div className="border-t border-slate-100 pt-3">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <label className="label !mb-0 flex items-center gap-1.5"><Sparkles size={13} className="text-violet-500" /> {t('Introductory pricing')}</label>
        <button type="button" onClick={add} disabled={value.length >= MAX_PRICING_STEPS} className="btn-ghost !py-1 !px-2.5 !text-[11px] disabled:opacity-40">
          <Plus size={12} /> {t('Add step')}
        </button>
      </div>
      <p className="mb-2 text-[11px] text-slate-400">
        {t(isSub
          ? "Optional. Give new providers a discount for their first periods — free, a percentage off, or an amount off. Steps run back to back from each provider's first paid period; after the last step the regular price applies."
          : 'Optional. Give new providers a lower commission for their first months — free, or a percentage off the regular rate. Steps run back to back from the day a provider joins this tier; after the last step the regular rate applies.')}
      </p>

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t('Quick start:')}</span>
        {presets(mode, dm).map(p => (
          <button key={p.title} type="button" onClick={() => onChange(p.steps())}
            className="chip !text-[10px] bg-violet-50 text-violet-700 ring-1 ring-violet-200 hover:bg-violet-100">
            {p.title}
          </button>
        ))}
      </div>

      {value.length > 0 && (
        <div className="space-y-2">
          <div className="hidden grid-cols-[0.7fr_1fr_0.9fr_1.1fr_auto] gap-2 px-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 sm:grid">
            <span>{lengthLabel}</span><span>{t('Discount')}</span><span>{t('Value')}</span><span>{t('Label (optional)')}</span><span className="w-7" />
          </div>
          {value.map((d, i) => {
            const figure = draftFigure(d, regular)
            return (
              <div key={d.key} className="rounded-xl bg-sand/70 p-2">
                <div className="grid grid-cols-2 items-center gap-2 sm:grid-cols-[0.7fr_1fr_0.9fr_1.1fr_auto]">
                  <input type="number" min={1} max={MAX_INTRO_PERIODS} step={1} className="input !py-1.5" aria-label={lengthLabel}
                    value={d.length} onChange={e => update(d.key, { length: e.target.value })} />
                  <select className="input !py-1.5" aria-label={t('Discount')} value={d.kind} onChange={e => changeKind(d, e.target.value as StepKind)}>
                    {options.map(o => <option key={o.kind} value={o.kind}>{o.label}</option>)}
                  </select>
                  <div className="relative">
                    <input type="number" min={0} max={d.kind === 'percent' || (d.kind === 'rate' && !isFixed) ? 100 : undefined} step="0.01"
                      className="input !py-1.5 !pe-11 disabled:opacity-50" aria-label={t('Value')}
                      disabled={d.kind === 'free'} placeholder={d.kind === 'free' ? '—' : ''}
                      value={d.kind === 'free' ? '' : d.amount} onChange={e => update(d.key, { amount: e.target.value })} />
                    {d.kind !== 'free' && (
                      <span className="pointer-events-none absolute inset-y-0 end-2.5 grid place-items-center text-[10px] font-bold text-slate-400">{unitFor(d.kind)}</span>
                    )}
                  </div>
                  <input className="input !py-1.5" maxLength={60} placeholder={t('e.g. Launch month')} aria-label={t('Label (optional)')}
                    value={d.label} onChange={e => update(d.key, { label: e.target.value })} />
                  <button type="button" onClick={() => remove(d.key)} title={t('Remove step')} className="grid h-8 w-7 place-items-center justify-self-end rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                    <Trash2 size={13} />
                  </button>
                </div>
                {!errors.rows[i] && (
                  <p className="mt-1 px-1 text-[11px] text-slate-500">
                    → <b className="text-deep-900">{figureText(figure)}</b>
                    {d.kind !== 'price' && d.kind !== 'rate' && regular > 0 && (
                      <span className="text-slate-400"> · {tt('regular {{value}}', { value: figureText(regular) })}</span>
                    )}
                    {isSub && dm > 1 && <span className="text-slate-400"> · = {monthCount(Number(d.length) * dm)}</span>}
                  </p>
                )}
                {errors.rows[i] && <p className="mt-1 px-1 text-[11px] font-semibold text-rose-500">{errors.rows[i]}</p>}
              </div>
            )
          })}
          <p className="px-1 text-[11px] text-slate-400">
            {t('Introductory steps cover')} <b className="text-slate-600">{isSub ? periodCount(totalLength) : monthCount(totalLength)}</b>
            {isSub && dm > 1 ? ` (${monthCount(totalLength * dm)})` : ''}
          </p>
          {errors.total && <p className="px-1 text-[11px] font-semibold text-rose-500">{errors.total}</p>}
        </div>
      )}

      <div className="mt-3 rounded-xl border border-slate-100 bg-white/60 p-3">
        <p className="mb-2 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">{t('What a new provider pays')}</p>
        {value.length === 0
          ? <p className="text-xs text-slate-500">{t(isSub ? 'No introductory pricing — the regular price applies from the first period.' : 'No introductory pricing — the regular rate applies from the first month.')}</p>
          : <ScheduleTimeline steps={preview} bill={bill} compact />}
      </div>
    </div>
  )
}
