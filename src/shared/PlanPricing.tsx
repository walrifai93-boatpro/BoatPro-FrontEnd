// ---------------------------------------------------------------------------
// What a provider pays, as the API works it out — introductory price steps, an
// admin's offer, and the amount actually charged — for every provider-side
// screen that sells or bills a plan: the registration pickers, the pay-now
// screen, and the plan card on all four portals' billing pages.
//
// Defensive throughout: `schedule`, `quote`, `pricing` and `offers` are new on
// the wire and an older server sends none of them, so every piece here renders
// nothing rather than guessing. The server's `text` on a schedule step is
// English; lines are rebuilt from the numbers so they read in Arabic too, and
// `text` is only the fallback.
// ---------------------------------------------------------------------------
import React, { useEffect, useMemo, useState } from 'react'
import { Gift, Sparkles } from 'lucide-react'
import {
  monetizationApi,
  type CommissionFiguresData,
  type EffectiveCommissionData,
  type OfferView,
  type PricingStepView,
  type RenewalNote,
  type SubscriptionQuoteData,
} from '../api'
import { ApiError } from '../async/errors'
import {
  formatPortalDate,
  formatPortalNumber,
  isPortalArabic,
  translatePortalTemplate,
  translatePortalText,
} from '../i18n/runtime'

/** `pricing` on `/monetization/provider-dashboard`. */
export interface ProviderPricingData {
  subscription: {
    /** Quoted for the package that will actually renew; `null` when nothing renews (see `renewalNote`). */
    nextRenewal: SubscriptionQuoteData | null
    schedule: PricingStepView[]
    /** Why the next renewal is not a plain renewal of the current package. Absent on an older server. */
    renewalNote?: RenewalNote | null
  } | null
  commission: { effective: EffectiveCommissionData; schedule: PricingStepView[] } | null
  /** The provider's live and upcoming offers. */
  offers: OfferView[]
}

/** What a pay screen shows: the amount, and how it was reached when known. */
export interface ChargePreview {
  amount: number
  quote: (Partial<SubscriptionQuoteData> & { amount: number }) | null
}

export type PricingKind = 'subscription' | 'commission'

// ── Pure helpers ────────────────────────────────────────────────────────────

/** True when a schedule has at least one introductory step before the regular price. */
export function hasIntroSteps(schedule?: PricingStepView[] | null): schedule is PricingStepView[] {
  return Array.isArray(schedule) && schedule.some((s) => s && s.index !== null && s.index !== undefined)
}

type StepKey = number | 'regular'
const keyOf = (s: PricingStepView): StepKey => (s.index === null || s.index === undefined ? 'regular' : s.index)

/** The schedule step a plan month (1-based) falls in. */
export function stepForMonth(schedule: PricingStepView[] | null | undefined, month: number | null | undefined): PricingStepView | null {
  if (!Array.isArray(schedule) || !month || month < 1) return null
  return schedule.find((s) => typeof s.fromMonth === 'number' && s.fromMonth <= month && (s.toMonth === null || s.toMonth === undefined || month <= s.toMonth)) ?? null
}

/** Whether two amounts differ by more than rounding. */
export const amountsDiffer = (a: number | null | undefined, b: number | null | undefined) =>
  typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) > 0.004

/**
 * What a brand-new provider's first period of a package costs before any offer:
 * the first intro step when it starts at month 1, else the regular price.
 */
export function firstPeriodQuote(pkg: { price?: number; durationMonths?: number; schedule?: PricingStepView[] } | null | undefined): ChargePreview | null {
  if (!pkg || typeof pkg.price !== 'number') return null
  const first = hasIntroSteps(pkg.schedule) ? pkg.schedule.find((s) => s.index === 1 && s.fromMonth === 1) : undefined
  if (!first || typeof first.price !== 'number') return { amount: pkg.price, quote: null }
  const dm = pkg.durationMonths && pkg.durationMonths > 0 ? pkg.durationMonths : 1
  const lastPeriod = typeof first.toMonth === 'number' ? Math.max(1, Math.round(first.toMonth / dm)) : 1
  return {
    amount: first.price,
    quote: {
      regularPrice: pkg.price,
      durationMonths: dm,
      cycleNumber: 1,
      listPrice: first.price,
      phase: { index: 1, label: first.label, firstPeriod: 1, lastPeriod, price: first.price },
      offer: null,
      discount: 0,
      amount: first.price,
    },
  }
}

/** The loose shape of any subscription checkout response, old or new server. */
type CheckoutLike = {
  amount?: number
  regularPrice?: number
  quote?: SubscriptionQuoteData | null
  package?: { price?: number; regularPrice?: number; quote?: SubscriptionQuoteData | null } | null
}

/**
 * The amount a subscription checkout actually charges. `package.price` is the
 * charged amount on a current server and `quote` explains it; an older server
 * sends the list price there and no quote, which is also what it charges.
 */
export function chargeFromCheckout(data: CheckoutLike | null | undefined): ChargePreview | null {
  if (!data) return null
  const quote = data.quote ?? data.package?.quote ?? null
  const amount = typeof data.package?.price === 'number' ? data.package.price : typeof quote?.amount === 'number' ? quote.amount : data.amount
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return null
  const regular = data.regularPrice ?? data.package?.regularPrice ?? quote?.regularPrice
  if (quote) return { amount, quote: { ...quote, amount } }
  if (typeof regular === 'number' && amountsDiffer(regular, amount)) return { amount, quote: { regularPrice: regular, amount } }
  return { amount, quote: null }
}

// ── Wording ─────────────────────────────────────────────────────────────────

/** "250 SAR" — the order the pay screen already uses. */
export function planMoney(n: number, currency = 'SAR'): string {
  const code = (currency || 'SAR').toUpperCase()
  return `${formatPortalNumber(n, { maximumFractionDigits: 2 })} ${code === 'SAR' ? translatePortalText('SAR') : code}`
}

const pct = (n: number) => `${formatPortalNumber(n, { maximumFractionDigits: 2 })}${isPortalArabic() ? '٪' : '%'}`

/** "month", "3 months", "year", "2 years" — the billed period, from `durationMonths`. */
export function planPeriodText(months?: number | null): string {
  const m = months && months > 0 ? Math.round(months) : 1
  if (m % 12 === 0) {
    const years = m / 12
    return years === 1 ? translatePortalText('year') : `${formatPortalNumber(years)} ${translatePortalText('years')}`
  }
  return m === 1 ? translatePortalText('month') : `${formatPortalNumber(m)} ${translatePortalText('months')}`
}

function monthsLabel(from: number, to: number | null | undefined): string {
  if (to === null || to === undefined) {
    return from <= 1
      ? translatePortalText('Every month')
      : translatePortalTemplate('From month {{month}}', { month: formatPortalNumber(from) })
  }
  if (from === to) return translatePortalTemplate('Month {{month}}', { month: formatPortalNumber(from) })
  return translatePortalTemplate('Months {{from}}–{{to}}', { from: formatPortalNumber(from), to: formatPortalNumber(to) })
}

const perBooking = (amount: number, currency?: string) =>
  translatePortalTemplate('{{amount}} per booking', { amount: planMoney(amount, currency) })

/** One schedule line in the reader's language — "Months 2–4: 250 SAR / month". */
export function stepLine(
  step: PricingStepView,
  kind: PricingKind,
  opts: { durationMonths?: number; currency?: string; commissionType?: 'percentage' | 'fixed' } = {},
): string {
  let value: string | null = null
  if (kind === 'subscription') {
    if (typeof step.price === 'number') {
      value = step.price <= 0 ? translatePortalText('Free') : `${planMoney(step.price, opts.currency)} / ${planPeriodText(opts.durationMonths)}`
    }
  } else {
    const fixed = opts.commissionType === 'fixed' || (typeof step.fixedAmount === 'number' && typeof step.rate !== 'number')
    if (fixed && typeof step.fixedAmount === 'number') value = perBooking(step.fixedAmount, opts.currency)
    else if (!fixed && typeof step.rate === 'number') value = pct(step.rate)
  }
  if (!value || typeof step.fromMonth !== 'number') return step.text || ''
  // A step the admin wrote as a discount says so: "250 SAR / month (50% off)".
  let tag = ''
  if (step.discountType === 'percent' && typeof step.discountValue === 'number') {
    tag = step.discountValue >= 100
      ? (kind === 'subscription' ? '' : translatePortalText('free'))
      : translatePortalTemplate('{{pct}} off', { pct: pct(step.discountValue) })
  } else if (step.discountType === 'amount' && typeof step.discountValue === 'number') {
    tag = translatePortalTemplate('{{amount}} off', { amount: planMoney(step.discountValue, opts.currency) })
  }
  return `${monthsLabel(step.fromMonth, step.toMonth)}: ${value}${tag ? ` (${tag})` : ''}`
}

/** A commission figure as the provider reads it: "5%" or "3 SAR per booking". */
export function commissionFigure(f: CommissionFiguresData | null | undefined, currency?: string): string {
  if (!f) return '—'
  return f.commissionType === 'fixed' ? perBooking(f.fixedAmount ?? 0, currency) : pct(f.rate ?? 0)
}

/** An offer's terms in the reader's language; the server's English `summary` is the fallback. */
export function offerTerms(offer: Pick<OfferView, 'kind' | 'value' | 'summary' | 'appliesTo'>, currency?: string): string {
  const v = offer.value
  if (typeof v !== 'number') return translatePortalText(offer.summary || '')
  switch (offer.kind) {
    case 'percent_off':
      return offer.appliesTo === 'commission'
        ? translatePortalTemplate('{{discount}} off your commission', { discount: pct(v) })
        : translatePortalTemplate('{{discount}} off each period', { discount: pct(v) })
    case 'amount_off':
      return translatePortalTemplate('{{discount}} off each period', { discount: planMoney(v, currency) })
    case 'fixed_price':
      return translatePortalTemplate('{{amount}} per period', { amount: planMoney(v, currency) })
    case 'rate_override':
      return translatePortalTemplate('{{rate}} commission per booking', { rate: pct(v) })
    case 'fee_override':
      return perBooking(v, currency)
    default:
      return translatePortalText(offer.summary || '')
  }
}

const isLiveOrUpcoming = (o: OfferView) => !!o && (o.status === 'active' || o.status === 'scheduled')

/**
 * Whether an offer touches what this provider is billed today.
 * - `applies`: on the bill they are on (or nothing says otherwise).
 * - `other_bill`: a subscription offer for a commission provider, or the
 *   reverse — it only matters if they switch.
 * - `fee_type`: a commission override that does not fit their tier — a
 *   `rate_override` on a fixed-fee tier or a `fee_override` on a percentage
 *   one. The server never switches the fee type, so it is not applied.
 */
export type OfferFit = 'applies' | 'other_bill' | 'fee_type'

export function offerFit(
  o: Pick<OfferView, 'id' | 'appliesTo' | 'kind'>,
  billingModel?: PricingKind | null,
  commission?: EffectiveCommissionData | null,
): OfferFit {
  if (billingModel && o.appliesTo !== billingModel) return 'other_bill'
  if (o.appliesTo === 'commission' && commission) {
    const type = commission.regular?.commissionType ?? commission.commissionType
    const mismatch = (o.kind === 'rate_override' && type === 'fixed') || (o.kind === 'fee_override' && type === 'percentage')
    if (mismatch && commission.offer?.offerId !== o.id) return 'fee_type'
  }
  return 'applies'
}

/** The date a renewal note refers to: its own, else the caller's period end. */
const noteDate = (note: RenewalNote, fallback?: string | null) => note.effectiveAt || fallback || null

/**
 * Why the Renew action cannot be used right now, or `null` when it can.
 * Renewing early is refused while a plan change or a move to commission is
 * scheduled, so the button says so instead of failing.
 */
export function renewBlockedReason(note: RenewalNote | null | undefined, fallbackDate?: string | null): string | null {
  if (!note) return null
  const date = noteDate(note, fallbackDate)
  if (note.reason === 'scheduled_change') {
    return date
      ? translatePortalTemplate('Renewing early is not available while a plan change is scheduled. It opens again after your plan changes on {{date}}.', { date: formatPortalDate(date) })
      : translatePortalText('Renewing early is not available while a plan change is scheduled.')
  }
  if (note.reason === 'switching_to_commission') {
    return date
      ? translatePortalTemplate('No renewal — your account moves to commission on {{date}}.', { date: formatPortalDate(date) })
      : translatePortalText('No renewal — your account moves to commission at the end of this period.')
  }
  return null
}

/** The line under "Next renewal" that says why it is not a plain renewal. */
function renewalNoteLine(note: RenewalNote, fallbackDate?: string | null): string {
  const date = noteDate(note, fallbackDate)
  switch (note.reason) {
    case 'scheduled_change':
      return date
        ? translatePortalTemplate('After your plan changes on {{date}}', { date: formatPortalDate(date) })
        : translatePortalText('After your scheduled plan change')
    case 'switching_to_commission':
      return date
        ? translatePortalTemplate('No renewal — your account moves to commission on {{date}}.', { date: formatPortalDate(date) })
        : translatePortalText('No renewal — your account moves to commission at the end of this period.')
    case 'cancelling':
      return date
        ? translatePortalTemplate('Your plan ends on {{date}}', { date: formatPortalDate(date) })
        : translatePortalText('Your plan ends at the end of this period')
    default:
      return ''
  }
}

/**
 * A failed renew / checkout / pay call, in words the provider can act on.
 * The server's own sentence is shown as it came (a scheduled plan change, a
 * first payment that belongs on the onboarding screen, a checkout priced
 * before an offer ended). A 403 reaches this layer as a generic "no
 * permission" line, so it is reworded to say what it means for a plan.
 */
export function planPaymentError(e: unknown, fallback: string): string {
  if (e instanceof ApiError && e.status === 403) {
    return translatePortalText('BoatPro cannot take this payment right now. If your account was suspended by the BoatPro team, contact them to restore it.')
  }
  return translatePortalText(e instanceof Error && e.message ? e.message : fallback)
}

// ── Pieces ──────────────────────────────────────────────────────────────────

type Highlight = { key: StepKey; label: string }

/**
 * A package's introductory schedule, compact: an "Intro offer" badge over one
 * line per step, regular price last. Nothing when the package has no intro
 * steps or the server sent no schedule — the card's own price is then the
 * whole story.
 */
export function PlanScheduleList({
  schedule,
  kind,
  durationMonths,
  currency,
  commissionType,
  highlights,
  hideBadge,
  className = '',
}: {
  schedule?: PricingStepView[] | null
  kind: PricingKind
  durationMonths?: number
  currency?: string
  commissionType?: 'percentage' | 'fixed'
  /** Steps to mark — "Now", "Next". */
  highlights?: Highlight[]
  hideBadge?: boolean
  className?: string
}) {
  if (!hasIntroSteps(schedule)) return null
  return (
    <div className={`space-y-1 ${className}`}>
      {!hideBadge && (
        <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-bold text-teal-700 ring-1 ring-teal-100 dark:bg-teal-900/30 dark:text-teal-200 dark:ring-teal-800">
          <Sparkles size={11} /> {translatePortalText('Intro offer')}
        </span>
      )}
      <ul className="space-y-0.5">
        {schedule.filter(Boolean).map((s, i) => {
          const k = keyOf(s)
          const marks = (highlights ?? []).filter((h) => h.key === k)
          const on = marks.length > 0
          const regular = k === 'regular'
          return (
            <li
              key={`${k}-${i}`}
              className={`flex items-center gap-2 rounded-lg px-1.5 py-0.5 text-[11px] ${on ? 'bg-ocean-50 font-bold text-ocean-800 dark:bg-ocean-900/30 dark:text-ocean-100' : regular ? 'text-slate-500' : 'font-semibold text-deep-900 dark:text-slate-100'}`}
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${on ? 'bg-ocean-500' : regular ? 'bg-slate-300' : 'bg-teal-500'}`} />
              <span className="min-w-0 flex-1">
                {stepLine(s, kind, { durationMonths, currency, commissionType })}
                {!!s.label && <span className="ms-1 font-medium text-slate-400">· {s.label}</span>}
              </span>
              {marks.map((m) => (
                <span key={m.label} className="shrink-0 rounded-full bg-ocean-500 px-1.5 py-px text-[9px] font-bold text-white">
                  {m.label}
                </span>
              ))}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * How a subscription charge was reached: regular price → intro step → offer →
 * amount due. Nothing when the amount is simply the regular price.
 */
export function ChargeBreakdown({
  quote,
  currency,
  className = '',
}: {
  quote: (Partial<SubscriptionQuoteData> & { amount: number }) | null | undefined
  currency?: string
  className?: string
}) {
  if (!quote || typeof quote.amount !== 'number') return null
  const cur = currency ?? quote.currency
  const regular = typeof quote.regularPrice === 'number' ? quote.regularPrice : null
  const phase = quote.phase ?? null
  const offer = quote.offer ?? null
  const discount = typeof quote.discount === 'number' ? quote.discount : 0
  const differs = regular !== null && amountsDiffer(regular, quote.amount)
  if (!differs && !phase && !(offer && discount > 0)) return null

  const dm = quote.durationMonths && quote.durationMonths > 0 ? quote.durationMonths : 1
  const phaseMonths = phase
    ? monthsLabel((Math.max(1, phase.firstPeriod ?? 1) - 1) * dm + 1, Math.max(1, phase.lastPeriod ?? phase.firstPeriod ?? 1) * dm)
    : ''

  return (
    <dl className={`space-y-1.5 rounded-xl bg-slate-50 px-3 py-2.5 text-xs ring-1 ring-slate-100 dark:bg-white/5 dark:ring-white/10 ${className}`}>
      {regular !== null && (
        <div className="flex items-center justify-between gap-3">
          <dt className="text-slate-500">{translatePortalText('Regular price')}</dt>
          <dd className={`tabular-nums ${differs ? 'text-slate-400 line-through' : 'font-semibold text-deep-900 dark:text-slate-100'}`}>{planMoney(regular, cur)}</dd>
        </div>
      )}
      {!!phase && typeof phase.price === 'number' && (
        <div className="flex items-center justify-between gap-3">
          <dt className="min-w-0 text-slate-500">
            {translatePortalText('Intro price')}
            <span className="block text-[10px] text-slate-400">{[phaseMonths, phase.label].filter(Boolean).join(' · ')}</span>
          </dt>
          <dd className="font-semibold tabular-nums text-deep-900 dark:text-slate-100">{phase.price <= 0 ? translatePortalText('Free') : planMoney(phase.price, cur)}</dd>
        </div>
      )}
      {!!offer && discount > 0 && (
        <div className="flex items-center justify-between gap-3">
          <dt className="min-w-0 text-slate-500">
            {translatePortalText('Offer')}
            <span className="block text-[10px] text-slate-400">{[offer.title, offerTerms(offer, cur)].filter(Boolean).join(' · ')}</span>
          </dt>
          <dd className="font-semibold tabular-nums text-emerald-600">−{planMoney(discount, cur)}</dd>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-1.5 dark:border-white/10">
        <dt className="font-bold text-deep-900 dark:text-slate-100">{translatePortalText('Amount due')}</dt>
        <dd className="font-display text-sm font-extrabold tabular-nums text-ocean-600">{quote.amount <= 0 ? translatePortalText('Free') : planMoney(quote.amount, cur)}</dd>
      </div>
    </dl>
  )
}

/**
 * Live and upcoming offers: title, terms, end date, periods left. Pass the
 * provider's billing model (and, for commission, the rate in force) so an
 * offer that does not touch today's bill is not labelled "Active".
 */
export function OfferList({
  offers,
  currency,
  billingModel,
  commission,
}: {
  offers?: OfferView[] | null
  currency?: string
  billingModel?: PricingKind | null
  commission?: EffectiveCommissionData | null
}) {
  const shown = (offers ?? []).filter(isLiveOrUpcoming)
  if (shown.length === 0) return null
  return (
    <ul className="space-y-2.5">
      {shown.map((o) => {
        const upcoming = o.status === 'scheduled' || (!!o.startsAt && new Date(o.startsAt).getTime() > Date.now())
        const fit = offerFit(o, billingModel, commission)
        const muted = fit !== 'applies'
        const meta: string[] = []
        if (upcoming && o.startsAt) meta.push(translatePortalTemplate('Starts on {{date}}', { date: formatPortalDate(o.startsAt) }))
        meta.push(o.endsAt ? translatePortalTemplate('Valid until {{date}}', { date: formatPortalDate(o.endsAt) }) : translatePortalText('No end date'))
        if (o.appliesTo === 'subscription' && typeof o.remainingCycles === 'number') {
          meta.push(translatePortalTemplate('Discounted periods left: {{count}}', { count: formatPortalNumber(o.remainingCycles) }))
        }
        const where =
          fit === 'other_bill'
            ? translatePortalText(o.appliesTo === 'commission' ? 'Applies if you switch to commission' : 'Applies if you switch to subscription')
            : fit === 'fee_type'
              ? translatePortalText('Does not apply to your current fee type')
              : translatePortalText(o.appliesTo === 'commission' ? 'on your commission' : 'on your subscription')
        const pill = muted
          ? { text: 'Not applied', cls: 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-400' }
          : upcoming
            ? { text: 'Upcoming', cls: 'bg-amber-50 text-amber-700' }
            : { text: 'Active', cls: 'bg-emerald-50 text-emerald-700' }
        return (
          <li key={o.id} className={`flex items-start gap-2.5 ${muted ? 'opacity-80' : ''}`}>
            <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${muted ? 'bg-slate-100 text-slate-400 dark:bg-white/10' : 'bg-teal-50 text-teal-600 dark:bg-teal-900/30 dark:text-teal-200'}`}><Gift size={15} /></span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-sm font-bold text-deep-900 dark:text-slate-100">{o.title || offerTerms(o, currency)}</p>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${pill.cls}`}>
                  {translatePortalText(pill.text)}
                </span>
              </div>
              <p className={`text-xs font-semibold ${muted ? 'text-slate-400' : 'text-ocean-600'}`}>
                {offerTerms(o, currency)} · {where}
              </p>
              <p className="text-[11px] text-slate-400">{meta.join(' · ')}</p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Everything `pricing` on the provider dashboard says: the next renewal and how
 * it was priced, the plan's schedule with the current step marked, the
 * commission in force against the regular rate, and the provider's offers.
 */
export function ProviderPricingPanel({
  pricing,
  currency,
  isSubscription,
  periodEnd,
}: {
  pricing?: ProviderPricingData | null
  currency?: string
  isSubscription: boolean
  /** When the current period ends — the date a renewal note falls back to when it carries none. */
  periodEnd?: string | null
}) {
  if (!pricing) return null
  const blocks: React.ReactNode[] = []
  const card = 'rounded-2xl border border-slate-100 bg-white p-4 dark:border-white/10 dark:bg-white/5'
  const eyebrow = 'text-xs font-bold uppercase tracking-wider text-slate-400'

  // ── Subscription ──
  const sub = isSubscription ? pricing.subscription : null
  const rawNext = sub?.nextRenewal ?? null
  const next = rawNext && typeof rawNext.amount === 'number' ? rawNext : null
  /*
    The quote is for the package that will actually renew. With a change
    scheduled that is the next package, priced from its own first period —
    so the line says when it starts, and the current plan's schedule below is
    not marked against it. Moving to commission or cancelling, nothing renews:
    the card says so instead of quoting the current plan again.
  */
  const note = sub?.renewalNote ?? null
  const nextIsOtherPackage = note?.reason === 'scheduled_change'
  if (next || note) {
    const cur = next?.currency || currency
    blocks.push(
      <div key="renewal" className={card}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={eyebrow}>{translatePortalText('Next renewal')}</p>
            {!!note && (
              <p className={next ? 'mt-0.5 text-xs text-slate-500' : 'mt-1 text-sm font-semibold text-deep-900 dark:text-slate-100'}>{renewalNoteLine(note, periodEnd)}</p>
            )}
            {nextIsOtherPackage && !!(note?.packageName || next?.packageName) && (
              <p className="mt-0.5 text-xs text-slate-400">{translatePortalTemplate('New plan: {{name}}', { name: note?.packageName || next?.packageName || '' })}</p>
            )}
            {!note && !!next && typeof next.cycleNumber === 'number' && next.cycleNumber > 0 && (
              <p className="mt-0.5 text-xs text-slate-400">{translatePortalTemplate('Billing period {{n}} of this plan', { n: formatPortalNumber(next.cycleNumber) })}</p>
            )}
            {!next && note?.reason === 'cancelling' && (
              <p className="mt-0.5 text-xs text-slate-400">{translatePortalText('Undo the cancellation to keep your plan renewing.')}</p>
            )}
          </div>
          {!!next && (
            <div className="shrink-0 text-end">
              <p className="font-display text-xl font-extrabold text-ocean-600">{next.amount <= 0 ? translatePortalText('Free') : planMoney(next.amount, cur)}</p>
              <p className="text-[11px] font-semibold text-slate-400">/ {planPeriodText(next.durationMonths)}</p>
            </div>
          )}
        </div>
        {!!next && <ChargeBreakdown quote={next} currency={cur} className="mt-3" />}
      </div>,
    )
  }
  if (hasIntroSteps(sub?.schedule)) {
    const schedule = sub!.schedule
    // The quote's period and cycle belong to the next package when a change
    // is scheduled; they say nothing about where the current plan stands.
    const own = nextIsOtherPackage ? null : next
    const dm = own?.durationMonths && own.durationMonths > 0 ? own.durationMonths : 1
    const highlights: Highlight[] = []
    if (own && typeof own.cycleNumber === 'number' && own.cycleNumber > 0) {
      const nowStep = own.cycleNumber > 1 ? stepForMonth(schedule, (own.cycleNumber - 2) * dm + 1) : null
      const nextStep = stepForMonth(schedule, (own.cycleNumber - 1) * dm + 1)
      if (nowStep) highlights.push({ key: keyOf(nowStep), label: translatePortalText('Now') })
      if (nextStep) highlights.push({ key: keyOf(nextStep), label: translatePortalText('Next') })
    }
    blocks.push(
      <div key="sub-schedule" className={card}>
        <p className={eyebrow}>{translatePortalText('Your price schedule')}</p>
        <PlanScheduleList schedule={schedule} kind="subscription" durationMonths={own?.durationMonths} currency={next?.currency || currency} highlights={highlights} className="mt-2" />
      </div>,
    )
  }

  // ── Commission ──
  const comm = !isSubscription ? pricing.commission : null
  const eff = comm?.effective ?? null
  if (eff && eff.regular) {
    const nowText = commissionFigure(eff, currency)
    const regularText = commissionFigure(eff.regular, currency)
    const changed = nowText !== regularText
    blocks.push(
      <div key="commission" className={card}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={eyebrow}>{translatePortalText('Your commission now')}</p>
            {changed && (
              <p className="mt-0.5 text-xs text-slate-400">
                {translatePortalText('Regular rate')}: <span className="line-through">{regularText}</span>
              </p>
            )}
          </div>
          <p className="shrink-0 font-display text-xl font-extrabold text-ocean-600">{nowText}</p>
        </div>
        {(eff.phase || eff.offer) && (
          <div className="mt-3 space-y-1.5 text-xs text-slate-500">
            {!!eff.phase && (
              <p className="flex items-start gap-1.5">
                <Sparkles size={13} className="mt-0.5 shrink-0 text-teal-600" />
                <span>
                  {translatePortalTemplate('Intro rate until month {{month}} of your plan', { month: formatPortalNumber(eff.phase.toMonth) })}
                  {typeof eff.monthNumber === 'number' && ` · ${translatePortalTemplate('You are in month {{month}}', { month: formatPortalNumber(eff.monthNumber) })}`}
                  {eff.phase.label ? ` · ${eff.phase.label}` : ''}
                </span>
              </p>
            )}
            {!!eff.offer && (
              <p className="flex items-start gap-1.5">
                <Gift size={13} className="mt-0.5 shrink-0 text-teal-600" />
                <span>
                  {[
                    eff.offer.title || translatePortalText('Offer'),
                    offerTerms({ kind: eff.offer.kind, value: eff.offer.value, summary: '', appliesTo: 'commission' }, currency),
                    eff.offer.endsAt
                      ? translatePortalTemplate('Valid until {{date}}', { date: formatPortalDate(eff.offer.endsAt) })
                      : translatePortalText('No end date'),
                  ].filter(Boolean).join(' · ')}
                </span>
              </p>
            )}
          </div>
        )}
      </div>,
    )
  }
  if (hasIntroSteps(comm?.schedule)) {
    const nowStep = stepForMonth(comm!.schedule, eff?.monthNumber ?? null)
    blocks.push(
      <div key="comm-schedule" className={card}>
        <p className={eyebrow}>{translatePortalText('Your commission schedule')}</p>
        <PlanScheduleList
          schedule={comm!.schedule}
          kind="commission"
          currency={currency}
          commissionType={eff?.regular?.commissionType}
          highlights={nowStep ? [{ key: keyOf(nowStep), label: translatePortalText('Now') }] : []}
          className="mt-2"
        />
      </div>,
    )
  }

  // ── Offers ──
  const offers = (pricing.offers ?? []).filter(isLiveOrUpcoming)
  if (offers.length > 0) {
    blocks.push(
      <div key="offers" className={card}>
        <p className={`${eyebrow} mb-2.5`}>{translatePortalText('Your offers')}</p>
        <OfferList
          offers={offers}
          currency={currency}
          billingModel={isSubscription ? 'subscription' : 'commission'}
          commission={isSubscription ? null : pricing.commission?.effective ?? null}
        />
      </div>,
    )
  }

  if (blocks.length === 0) return null
  return <div className="grid gap-4 sm:grid-cols-2">{blocks}</div>
}

// ── Pay-screen preview ──────────────────────────────────────────────────────

/**
 * What the pay screen should say the next period costs before a checkout
 * exists. The server's quote from the provider dashboard first (intro step and
 * offer both applied — a provider awaiting payment can read it); then, for a
 * first payment only, the package's first intro step from the public schedule.
 * `null` leaves the screen on the list price it already had.
 */
export function useSubscriptionChargePreview({
  enabled,
  packageId,
  packages,
  firstPayment,
}: {
  enabled: boolean
  packageId?: string | null
  packages?: { _id?: string; id?: string; price?: number; durationMonths?: number; schedule?: PricingStepView[] }[]
  /** Whether this is the provider's first period of the package (cycle 1). */
  firstPayment: boolean
}) {
  /*
    Kept with the package it was fetched for. A quote for the previous package
    must not stay on the pay screen once the package changes — reading it
    through `forPackage` drops it on the very render the id changes, before the
    refetch below has answered.
  */
  const packageKey = packageId ? String(packageId) : ''
  const [server, setServer] = useState<{ forPackage: string; quote: SubscriptionQuoteData } | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setServer(null)
    if (!enabled) return
    let alive = true
    setLoading(true)
    monetizationApi.providerDashboard()
      .then((r) => {
        const q = (r.data as { pricing?: ProviderPricingData | null } | undefined)?.pricing?.subscription?.nextRenewal ?? null
        if (!alive || !q || typeof q.amount !== 'number') return
        if (packageKey && q.packageId && String(q.packageId) !== packageKey) return
        setServer({ forPackage: packageKey, quote: q })
      })
      .catch(() => { /* the schedule or the list price stands in */ })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [enabled, packageKey])

  const serverQuote = server && server.forPackage === packageKey ? server.quote : null

  const pkg = useMemo(() => {
    if (!packageId || !Array.isArray(packages)) return null
    return packages.find((p) => p && String(p._id || p.id) === String(packageId)) ?? null
  }, [packageId, packages])

  const preview: ChargePreview | null =
    (serverQuote ? { amount: serverQuote.amount, quote: serverQuote } : null)
    ?? (firstPayment && pkg && hasIntroSteps(pkg.schedule) ? firstPeriodQuote(pkg) : null)

  return { preview, pkg, loading }
}
