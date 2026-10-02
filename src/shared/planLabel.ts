import type { PlanKind, PlanSummary } from '../api'

/**
 * How a provider's plan is named on screen.
 *
 * There are three deals, not two. A provider can pay a monthly subscription, a
 * percentage of each booking, or — through an admin's invite link only — a flat
 * amount per transaction with no percentage and no subscription at all.
 *
 * The third one is stored on the commission rails (`commissionType: 'fixed'`),
 * because that is where the flat-fee arithmetic already lives. That is a
 * storage detail, and letting it leak into the UI produced the labels this
 * module exists to replace: a fixed-fee provider was shown "Commission · 0%",
 * or worse "Commission (15%)" where a display default filled the blank — a
 * figure they had never agreed to, on the screen their account manager reads.
 */

export interface OnboardingBilling {
  billingModel?: string | null
  commissionType?: 'percentage' | 'fixed' | null
  commissionFixedAmount?: number | null
  commissionRate?: number | null
}

export function planKindOf(ob: OnboardingBilling | null | undefined): PlanKind | null {
  if (!ob?.billingModel) return null
  if (ob.billingModel === 'subscription') return 'subscription'
  return ob.commissionType === 'fixed' ? 'fixed_fee' : 'commission'
}

/** A short chip label: "Fixed fee", "Commission", "Subscription". */
export function planModelLabel(ob: OnboardingBilling | null | undefined): string {
  const kind = planKindOf(ob)
  if (kind === 'fixed_fee') return 'Fixed fee'
  if (kind === 'commission') return 'Commission'
  if (kind === 'subscription') return 'Subscription'
  return '—'
}

/**
 * The full terms in one line.
 *
 * `currency` defaults to SAR because that is what the platform settles in —
 * see the display-currency note in `live.tsx`; these are the amounts as
 * charged, not as converted for display.
 */
export function planTermsLabel(
  ob: OnboardingBilling | null | undefined,
  currency = 'SAR'
): string {
  const kind = planKindOf(ob)
  switch (kind) {
    case 'fixed_fee':
      return `Fixed fee · ${currency} ${ob?.commissionFixedAmount ?? 0} per transaction`
    case 'commission':
      return `Commission · ${ob?.commissionRate ?? 0}%`
    case 'subscription':
      return 'Subscription'
    default:
      return '—'
  }
}

/** A subscription package, as the provider list populates it. */
interface PopulatedPlan {
  name?: string
  price?: number
  priceAed?: number
  durationMonths?: number
  interval?: string
}

export interface OnboardingPlan extends OnboardingBilling {
  subscriptionPackageId?: unknown
  subscriptionPlan?: unknown
}

/**
 * A provider's actual plan in one line: "Basic · SAR 99/mo",
 * "Commission · 10%", "Fixed fee · SAR 5 per transaction".
 *
 * `planTermsLabel` stops at "Subscription", which is all the directory showed —
 * the same word for every subscriber whatever they pay, including the ones still
 * awaiting their first payment. The package is on the record (`subscriptionPackageId`,
 * or the legacy `subscriptionPlan`); this names it. Prices stay in SAR: they are
 * what is charged, not a display conversion.
 */
export function providerPlanLabel(ob: OnboardingPlan | null | undefined, currency = 'SAR'): string {
  if (planKindOf(ob) !== 'subscription') return planTermsLabel(ob, currency)
  const obj = (v: unknown) => (v && typeof v === 'object' ? (v as PopulatedPlan) : null)
  const pkg = obj(ob?.subscriptionPackageId)
  if (pkg?.name) {
    const months = pkg.durationMonths || 1
    const per = months === 1 ? 'mo' : months === 12 ? 'yr' : `${months}mo`
    return `${pkg.name} · ${currency} ${pkg.price ?? 0}/${per}`
  }
  const legacy = obj(ob?.subscriptionPlan)
  if (legacy?.name) {
    return `${legacy.name} · ${currency} ${legacy.price ?? legacy.priceAed ?? 0}/${legacy.interval === 'yearly' ? 'yr' : 'mo'}`
  }
  return 'Subscription · no package'
}

/** The same line for a resolved `PlanSummary` from an invite link. */
export function planSummaryTerms(plan: PlanSummary | null | undefined): string {
  if (!plan) return '—'
  return plan.label
}

/** Tailwind chip classes, so the three kinds stay visually distinct everywhere. */
export function planChipClass(ob: OnboardingBilling | null | undefined): string {
  switch (planKindOf(ob)) {
    case 'fixed_fee':
      return 'bg-amber-50 text-amber-700'
    case 'subscription':
      return 'bg-ocean-50 text-ocean-700'
    case 'commission':
      return 'bg-teal-50 text-teal-700'
    default:
      return 'bg-slate-100 text-slate-500'
  }
}
