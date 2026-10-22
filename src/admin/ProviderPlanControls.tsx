import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle, ArrowRightLeft, BadgePercent, CalendarClock, ChevronDown, Gift, History,
  Loader2, RefreshCw, Search, Sparkles, Undo2, Wallet, X,
} from 'lucide-react'
import { Modal, toast } from '../ui'
import { confirmAndRun, errorMessage } from '../async'
import {
  providerBillingApi, SUBSCRIPTION_OFFER_KINDS, COMMISSION_OFFER_KINDS,
  type AdminOfferData, type ChangeProviderPlanInput, type CommissionFiguresData, type CommissionPackageData,
  type EffectiveCommissionData, type MonetizationProvider, type OfferKind, type OfferStatus, type OfferTarget,
  type OfferView, type ProviderBillingSnapshot, type ProviderTypeKey, type SubscriptionPackageData,
} from '../api'
import { translatePortalText, translatePortalTemplate, formatPortalDate, formatPortalNumber } from '../i18n/runtime'
import {
  IntroBadge, ScheduleTimeline, commissionFigure, commissionSchedule, fmtAmount, hasIntroSteps,
  pct, periodCount, periodPrice, sar, subscriptionSchedule,
} from './PricingPhasesEditor'

/**
 * Admin control over what one provider pays: the plan they are on and what it
 * costs them right now, moving them to another plan, and giving or revoking
 * discounts and offers.
 *
 * Shared by Packages & Pricing (Provider Models, Offers & Discounts) and the
 * provider directories' detail modal, so the two never describe a provider's
 * bill differently.
 */

const t = translatePortalText
const tt = translatePortalTemplate
const fmtDate = (d?: string | null) => (d ? formatPortalDate(new Date(d)) : '—')
const idOf = (pkg?: { _id?: string; id?: string } | null) => pkg?._id || pkg?.id || ''

export const PROVIDER_TYPE_LABEL: Record<ProviderTypeKey, string> = {
  boat_provider: 'Boat Provider',
  marina_provider: 'Marina Provider',
  fuel_provider: 'Fuel Provider',
  maintenance_provider: 'Maintenance Provider',
}
export const PROVIDER_TYPE_ICON: Record<ProviderTypeKey, string> = {
  boat_provider: '🛥️',
  marina_provider: '⚓',
  fuel_provider: '⛽',
  maintenance_provider: '🔧',
}

/**
 * Nested dialogs go to `document.body`. The plan modals open from inside other
 * modals (the provider detail), whose animated card would otherwise become the
 * containing block of their `position: fixed` backdrop.
 */
function Layer({ children }: { children: React.ReactNode }) {
  if (typeof document === 'undefined') return <>{children}</>
  return createPortal(children, document.body)
}

// ── offers: wording ─────────────────────────────────────────────────────────

export const OFFER_STATUS_LABEL: Record<OfferStatus, string> = {
  active: 'Active',
  scheduled: 'Scheduled',
  revoked: 'Revoked',
  expired: 'Expired',
  used_up: 'Used up',
  superseded: 'Replaced',
}
const OFFER_STATUS_TONE: Record<OfferStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  scheduled: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
  revoked: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200',
  expired: 'bg-slate-100 text-slate-500 ring-1 ring-slate-200',
  used_up: 'bg-slate-100 text-slate-500 ring-1 ring-slate-200',
  superseded: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
}

/** Still to do something: running now, or starting later. */
export const offerIsOpen = (o: { status: OfferStatus }) => o.status === 'active' || o.status === 'scheduled'

export function OfferStatusChip({ status }: { status: OfferStatus }) {
  return <span className={`chip !text-[10px] font-extrabold ${OFFER_STATUS_TONE[status] ?? 'bg-slate-100 text-slate-500'}`}>{t(OFFER_STATUS_LABEL[status] ?? status)}</span>
}

export const BILL_LABEL: Record<OfferTarget, string> = { subscription: 'Subscription', commission: 'Commission' }

export function offerKindLabel(kind: OfferKind, appliesTo: OfferTarget): string {
  if (appliesTo === 'subscription') {
    if (kind === 'percent_off') return t('Percentage off each period')
    if (kind === 'amount_off') return t('Amount off each period (SAR)')
    return t('Fixed price per period (SAR)')
  }
  if (kind === 'percent_off') return t('Percentage off the commission')
  if (kind === 'rate_override') return t('Commission rate per booking (%)')
  return t('Flat fee per booking (SAR)')
}

/** "20% off each period", "SAR 3 per booking" — from the figures, so it is in the admin's language. */
export function offerSummary(o: { kind: OfferKind; value: number; appliesTo: OfferTarget }): string {
  switch (o.kind) {
    case 'percent_off':
      return o.appliesTo === 'commission'
        ? tt('{{percent}} off the commission', { percent: pct(o.value) })
        : tt('{{percent}} off each period', { percent: pct(o.value) })
    case 'amount_off':
      return tt('SAR {{amount}} off each period', { amount: fmtAmount(o.value) })
    case 'fixed_price':
      return tt('SAR {{amount}} per period', { amount: fmtAmount(o.value) })
    case 'rate_override':
      return tt('{{percent}} commission per booking', { percent: pct(o.value) })
    case 'fee_override':
      return tt('SAR {{amount}} per booking', { amount: fmtAmount(o.value) })
    default:
      return String(o.value)
  }
}

/**
 * The default title of a new offer, which is saved as the title the provider
 * sees. Plain English with ASCII digits on purpose: built with the admin's
 * translated templates it carried Arabic wording, bidi isolate marks and
 * Arabic-Indic digits into a field the provider's app shows as typed.
 */
export function plainOfferTitle(o: { kind: OfferKind; value: number; appliesTo: OfferTarget }): string {
  const n = o.value.toLocaleString('en-US', { maximumFractionDigits: 2, useGrouping: true })
  switch (o.kind) {
    case 'percent_off':
      return o.appliesTo === 'commission' ? `${n}% off the commission` : `${n}% off each period`
    case 'amount_off':
      return `SAR ${n} off each period`
    case 'fixed_price':
      return `SAR ${n} per period`
    case 'rate_override':
      return `${n}% commission per booking`
    case 'fee_override':
      return `SAR ${n} per booking`
    default:
      return n
  }
}

/** When an offer runs: "Since 1 Nov 2026 · Until 31 Dec 2026". */
export function offerWindow(o: { startsAt?: string; endsAt?: string; status?: OfferStatus }): string {
  const parts: string[] = []
  if (o.startsAt) {
    parts.push(new Date(o.startsAt).getTime() > Date.now()
      ? tt('Starts {{date}}', { date: fmtDate(o.startsAt) })
      : tt('Since {{date}}', { date: fmtDate(o.startsAt) }))
  }
  parts.push(o.endsAt ? tt('Until {{date}}', { date: fmtDate(o.endsAt) }) : t('No end date'))
  return parts.join(' · ')
}

/** "2 of 3 periods used", for a capped subscription offer. */
export function offerCycles(o: { maxCycles?: number; usedCycles?: number }): string | null {
  if (!o.maxCycles) return null
  return tt('{{used}} of {{max}} periods used', { used: formatPortalNumber(o.usedCycles ?? 0), max: formatPortalNumber(o.maxCycles) })
}

/** Small chips for a provider's live and upcoming offers — Provider Models rows. */
export function OfferChips({ offers, max = 2 }: { offers?: OfferView[] | null; max?: number }) {
  const open = (offers || []).filter(offerIsOpen)
  if (!open.length) return null
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {open.slice(0, max).map(o => (
        <span key={o.id} title={`${o.title} · ${offerWindow(o)}`}
          className={`chip !py-0 !text-[10px] font-bold ${o.status === 'scheduled' ? 'bg-sky-50 text-sky-700' : 'bg-violet-50 text-violet-700'}`}>
          <BadgePercent size={10} /> {offerSummary(o)}{o.status === 'scheduled' ? ` · ${t('scheduled')}` : ''}
        </span>
      ))}
      {open.length > max && <span className="chip !py-0 !text-[10px] bg-slate-100 text-slate-500">+{formatPortalNumber(open.length - max)}</span>}
    </div>
  )
}

/**
 * The commission in force today when it is not the tier's own rate: an
 * introductory step or an offer is moving it. `null` when they agree.
 */
export function effectiveCommissionNote(e?: EffectiveCommissionData | null): { now: string; regular: string; reason: string } | null {
  if (!e?.regular) return null
  const differs = e.commissionType !== e.regular.commissionType || e.rate !== e.regular.rate || e.fixedAmount !== e.regular.fixedAmount
  if (!differs) return null
  const reasons: string[] = []
  if (e.phase) reasons.push(tt('intro step {{n}}', { n: formatPortalNumber(e.phase.index) }))
  if (e.offer) reasons.push(e.offer.title ? tt('offer: {{title}}', { title: e.offer.title }) : t('offer'))
  return {
    now: commissionFigure(e.commissionType, e.rate, e.fixedAmount),
    regular: commissionFigure(e.regular.commissionType, e.regular.rate, e.regular.fixedAmount),
    reason: reasons.join(' + '),
  }
}

/**
 * Revoke, after saying what that does to the provider's bill.
 * Resolves true when the offer was revoked.
 */
export async function revokeOfferFlow(offer: { id: string; title: string; appliesTo: OfferTarget; kind: OfferKind; value: number }, providerName?: string): Promise<boolean> {
  const what = offerSummary(offer)
  const res = await confirmAndRun({
    title: tt('Revoke “{{title}}”?', { title: offer.title }),
    body: [
      providerName ? tt('{{name}} loses {{offer}}.', { name: providerName, offer: what }) : tt('The provider loses {{offer}}.', { offer: what }),
      t(offer.appliesTo === 'subscription'
        ? 'Renewals from now on are charged without it; periods already paid keep the price they were charged.'
        : 'Bookings from now on are charged without it; bookings already charged are not changed.'),
    ].join(' '),
    input: { label: 'Reason (optional, internal)', placeholder: 'e.g. Promotion ended early', maxLength: 200 },
    confirmLabel: 'Revoke offer',
    busyLabel: 'Revoking…',
    danger: true,
    run: async (reason) => {
      await providerBillingApi.revokeOffer(offer.id, (reason || '').trim() || undefined)
      return true
    },
    success: tt('“{{title}}” revoked', { title: offer.title }),
  })
  return !!res
}

// ── offers: maths (mirrors planPricing.service, for the previews) ───────────

const round2 = (n: number) => Math.round(n * 100) / 100

function applySubscriptionOffer(listPrice: number, kind: OfferKind, value: number): number {
  let discount = 0
  if (kind === 'percent_off') discount = (listPrice * Math.min(100, value)) / 100
  else if (kind === 'amount_off') discount = Math.min(listPrice, value)
  else if (kind === 'fixed_price') discount = Math.max(0, listPrice - value)
  discount = round2(Math.min(listPrice, Math.max(0, discount)))
  return round2(listPrice - discount)
}

/**
 * An offer never switches the fee type: a rate override only counts on a
 * percentage tier and a fee override only on a fixed-fee tier, each as the
 * lower of the override and the current figure (`applyCommissionAdjustments`).
 */
function applyCommissionOffer(f: CommissionFiguresData, kind: OfferKind, value: number): CommissionFiguresData {
  if (kind === 'percent_off') {
    const keep = 1 - Math.min(100, value) / 100
    return { ...f, rate: round2(f.rate * keep), fixedAmount: round2(f.fixedAmount * keep) }
  }
  if (kind === 'rate_override') return f.commissionType === 'percentage' ? { ...f, rate: Math.min(f.rate, value) } : f
  if (kind === 'fee_override') return f.commissionType === 'fixed' ? { ...f, fixedAmount: Math.min(f.fixedAmount, value) } : f
  return f
}

/** The server's ceiling on any offer figure (`MAX_OFFER_AMOUNT`) — a typo guard. */
const MAX_OFFER_VALUE = 1_000_000
/** The server's limits on one offer request (`createOffersSchema`). */
export const MAX_OFFER_PROVIDERS = 200
const MAX_OFFER_CYCLES = 60

/** Whether `value` is acceptable for `kind`; the translated reason when not. Same rules as `assertOfferKind`. */
function offerValueError(kind: OfferKind, raw: string): string | null {
  const v = Number(raw)
  if (raw.trim() === '' || !Number.isFinite(v)) return t('Enter the offer value')
  if (kind === 'percent_off' && (v <= 0 || v > 100)) return t('A percentage off must be more than 0 and at most 100')
  if (kind === 'rate_override' && (v < 0 || v > 100)) return t('The commission rate must be between 0 and 100%')
  if (kind === 'amount_off' && v <= 0) return t('The amount off must be more than 0')
  if (v < 0) return t('The amount must be 0 or more')
  if (v > MAX_OFFER_VALUE) return t('The offer value cannot be more than 1,000,000')
  return null
}

/**
 * Why a batch offer was refused, by provider. The server refuses the whole
 * batch when the offer could never reach some of the accounts and lists them
 * as `errors.providerIds`; the generic error copy turned that list into
 * "Provider ids: 65ab…", so the ids are mapped back to the businesses picked.
 */
function offerRefusalMessage(err: unknown, chosen: OfferCandidate[]): string {
  const details = (err as { details?: unknown } | null)?.details as { providerIds?: unknown } | undefined
  const ids = details && Array.isArray(details.providerIds) ? details.providerIds.map(String) : []
  if (!ids.length) return errorMessage(err)
  const names = ids.map(id => chosen.find(c => c.id === id)?.businessName || id)
  const shown = names.slice(0, 5).join(', ') + (names.length > 5 ? ` +${formatPortalNumber(names.length - 5)}` : '')
  return tt('No offer was given — it can never apply to: {{names}}. Their account may be deleted or have no plan set up yet, or their fee type does not fit this offer. Unselect them and try again.', { names: shown })
}

/** The commission type a provider is on now, or null when they are not on commission. */
function currentCommissionType(c: OfferCandidate): 'percentage' | 'fixed' | null {
  if (c.billingModel !== 'commission') return null
  return c.commissionType === 'fixed' ? 'fixed' : 'percentage'
}

/** Whether an override offer fits the provider's current tier — the server refuses one that does not. */
function overrideMismatch(c: OfferCandidate, kind: OfferKind): boolean {
  const type = currentCommissionType(c)
  if (!type) return false
  return (kind === 'rate_override' && type === 'fixed') || (kind === 'fee_override' && type === 'percentage')
}

// ── who an offer can be given to ────────────────────────────────────────────

export interface OfferCandidate {
  id: string
  businessName: string
  email?: string
  providerType?: ProviderTypeKey
  billingModel: 'subscription' | 'commission' | null
  commissionType?: 'percentage' | 'fixed'
  packageName?: string
  /** Live and upcoming offers — to warn when a new one replaces them. */
  offers?: OfferView[]
}

export function candidateFromMonetization(p: MonetizationProvider): OfferCandidate {
  return {
    id: p.id,
    businessName: p.businessName || p.name,
    email: p.email,
    providerType: p.providerType,
    billingModel: p.paymentModel ?? null,
    commissionType: p.commissionType,
    packageName: (p.paymentModel === 'subscription' ? p.subscriptionPackage?.name : p.commissionPackage?.name) || undefined,
    offers: p.offers,
  }
}

export function candidateFromBilling(b: ProviderBillingSnapshot): OfferCandidate {
  return {
    id: b.provider.id,
    businessName: b.provider.businessName || b.provider.name,
    email: b.provider.email,
    providerType: b.provider.providerType,
    billingModel: b.billingModel,
    commissionType: b.commission?.effective?.regular?.commissionType ?? b.commission?.package?.commissionType,
    packageName: (b.billingModel === 'subscription' ? b.subscription?.package?.name : b.commission?.package?.name) || undefined,
    offers: b.offers,
  }
}

/** What one provider pays before any offer — so a new offer can be previewed in figures. */
export interface OfferPreviewBase {
  subscriptionListPrice?: number | null
  commission?: CommissionFiguresData | null
}

export function previewBaseFromBilling(b: ProviderBillingSnapshot): OfferPreviewBase {
  const q = b.subscription?.nextRenewal
  const e = b.commission?.effective
  let commission: CommissionFiguresData | null = null
  if (e) {
    // With an offer already in force the stepped figure before it is only known
    // when there is no step (it is then the tier's own).
    commission = e.offer ? (e.phase ? null : e.regular) : { commissionType: e.commissionType, rate: e.rate, fixedAmount: e.fixedAmount }
  }
  return { subscriptionListPrice: q ? q.listPrice : null, commission }
}

const MODEL_CHIP: Record<string, string> = {
  subscription: 'bg-ocean-50 text-ocean-700',
  commission: 'bg-teal-50 text-teal-700',
  fixed_fee: 'bg-amber-50 text-amber-700',
}

function ModelChip({ model, fixed }: { model: 'subscription' | 'commission' | null; fixed?: boolean }) {
  if (!model) return <span className="chip !text-[10px] bg-slate-100 text-slate-500">{t('No plan')}</span>
  const key = model === 'commission' && fixed ? 'fixed_fee' : model
  return <span className={`chip !text-[10px] font-extrabold ${MODEL_CHIP[key]}`}>{t(key === 'fixed_fee' ? 'Fixed fee' : BILL_LABEL[model])}</span>
}

// ── Give discount / offer ───────────────────────────────────────────────────

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * Give one or many providers a discount or offer on one bill.
 *
 * `candidates` are who can be picked; with `lockSelection` the modal is for the
 * providers in `initialSelected` only (the per-provider panel). A provider's
 * previous live offer on the same bill is superseded by the server — or, when
 * the new one starts later, kept until it starts — said in the preview, before
 * anything is saved.
 */
export function GiveOfferModal({ open, onClose, candidates, initialSelected, lockSelection, defaultAppliesTo, preview, onDone }: {
  open: boolean
  onClose: () => void
  candidates: OfferCandidate[]
  initialSelected?: string[]
  lockSelection?: boolean
  defaultAppliesTo?: OfferTarget
  /** Figures to preview against, when the modal is for one provider. */
  preview?: OfferPreviewBase | null
  onDone: (offers: AdminOfferData[]) => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<'' | ProviderTypeKey>('')
  const [modelFilter, setModelFilter] = useState<'' | 'subscription' | 'commission'>('')
  const [appliesTo, setAppliesTo] = useState<OfferTarget>('subscription')
  const [kind, setKind] = useState<OfferKind>('percent_off')
  const [value, setValue] = useState('')
  const [title, setTitle] = useState('')
  const [titleTouched, setTitleTouched] = useState(false)
  const [note, setNote] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [maxCycles, setMaxCycles] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setSelected(new Set(initialSelected || []))
    setQuery(''); setTypeFilter(''); setModelFilter('')
    const bill = defaultAppliesTo ?? 'subscription'
    setAppliesTo(bill)
    setKind('percent_off')
    setValue(''); setTitle(''); setTitleTouched(false); setNote(''); setStartsAt(''); setEndsAt(''); setMaxCycles('')
    setBusy(false)
    // Only when the dialog opens: the caller's arrays are rebuilt on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return candidates.filter(c =>
      (!typeFilter || c.providerType === typeFilter)
      && (!modelFilter || c.billingModel === modelFilter)
      && (!q || [c.businessName, c.email, c.packageName].some(v => (v || '').toLowerCase().includes(q))))
  }, [candidates, query, typeFilter, modelFilter])

  const chosen = useMemo(() => candidates.filter(c => selected.has(c.id)), [candidates, selected])
  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  /**
   * A commission offer never switches the fee type, so for one provider on a
   * commission tier only the override that fits it is offered. For several,
   * both are, and any provider whose tier does not fit is named below.
   */
  const singleType = chosen.length === 1 ? currentCommissionType(chosen[0]) : null
  const kindsFor = (bill: OfferTarget): OfferKind[] => bill === 'subscription'
    ? SUBSCRIPTION_OFFER_KINDS
    : singleType
      ? COMMISSION_OFFER_KINDS.filter(k => k === 'percent_off' || k === (singleType === 'fixed' ? 'fee_override' : 'rate_override'))
      : COMMISSION_OFFER_KINDS
  const kinds = kindsFor(appliesTo)
  const kindsKey = kinds.join(',')
  useEffect(() => {
    if (!kinds.includes(kind)) setKind(kinds[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kindsKey, kind])
  const changeBill = (bill: OfferTarget) => {
    setAppliesTo(bill)
    const allowed = kindsFor(bill)
    if (!allowed.includes(kind)) setKind(allowed[0])
    if (bill !== 'subscription') setMaxCycles('')
  }

  const valueError = offerValueError(kind, value)
  const numeric = valueError ? null : Number(value)
  const autoTitle = numeric === null ? '' : plainOfferTitle({ kind, value: numeric, appliesTo })
  // What the admin typed is saved as typed; only the default is generated.
  const effectiveTitle = (titleTouched ? title : autoTitle).trim()
  const unit = kind === 'percent_off' || kind === 'rate_override' ? '%' : t('SAR')
  const cyclesError = appliesTo === 'subscription' && maxCycles.trim()
    && !(Number.isInteger(Number(maxCycles)) && Number(maxCycles) >= 1 && Number(maxCycles) <= MAX_OFFER_CYCLES)
    ? t('Max periods must be a whole number from 1 to 60 — or blank for no limit')
    : null
  const today = ymd(new Date())
  const startsLater = !!startsAt && startsAt > today
  const startDate = startsLater ? fmtDate(`${startsAt}T00:00:00`) : ''

  // ── the plain-language effect ──
  const effectLines: string[] = []
  if (numeric !== null) {
    if (appliesTo === 'subscription') {
      effectLines.push(
        kind === 'percent_off' ? tt('Each subscription period costs {{percent}} less.', { percent: pct(numeric) })
          : kind === 'amount_off' ? tt('Each subscription period costs SAR {{amount}} less, never below SAR 0.', { amount: fmtAmount(numeric) })
          : tt('Each subscription period costs SAR {{amount}} — or the normal price, if that is lower.', { amount: fmtAmount(numeric) }))
      const cycles = Number(maxCycles)
      effectLines.push(maxCycles.trim() && !cyclesError
        ? tt('Applies to the next {{periods}} they pay for.', { periods: periodCount(cycles) })
        : t('Applies to every period they pay for while it runs.'))
    } else {
      effectLines.push(
        kind === 'percent_off' ? tt('Their commission is cut by {{percent}} — a 10% rate becomes {{example}}.', { percent: pct(numeric), example: pct(round2(10 * (1 - Math.min(100, numeric) / 100))) })
          : kind === 'rate_override' ? tt('They pay {{percent}} commission per booking, or their current rate if that is lower. It only counts while they are on a percentage tier — it never turns a flat fee into a percentage.', { percent: pct(numeric) })
          : tt('They pay SAR {{amount}} per booking, or their current fee if that is lower. It only counts while they are on a fixed-fee tier — it never turns a percentage into a flat fee.', { amount: fmtAmount(numeric) }))
      effectLines.push(t(kind === 'percent_off'
        ? 'The cut applies to what they pay at the time, introductory step included.'
        : 'During an introductory step, the lower of the step and the offer applies.'))
    }
    effectLines.push(startsLater ? tt('Starts on {{date}}.', { date: startDate }) : t('Starts now.'))
    effectLines.push(endsAt ? tt('Ends after {{date}}.', { date: fmtDate(`${endsAt}T00:00:00`) }) : t('No end date — it runs until revoked.'))
  }

  let example: string | null = null
  if (numeric !== null && preview && chosen.length === 1) {
    if (appliesTo === 'subscription' && preview.subscriptionListPrice != null) {
      example = tt('Their next renewal: {{before}} → {{after}}', { before: sar(preview.subscriptionListPrice), after: sar(applySubscriptionOffer(preview.subscriptionListPrice, kind, numeric)) })
    } else if (appliesTo === 'commission' && preview.commission) {
      const before = commissionFigure(preview.commission.commissionType, preview.commission.rate, preview.commission.fixedAmount)
      const next = applyCommissionOffer(preview.commission, kind, numeric)
      const after = commissionFigure(next.commissionType, next.rate, next.fixedAmount)
      example = after === before
        ? tt('Their commission stays {{figure}} — they already pay no more than this offer.', { figure: before })
        : tt('Their commission: {{before}} → {{after}}', { before, after })
    }
  }

  const notOnBill = chosen.filter(c => c.billingModel !== appliesTo).length
  const replacing = chosen.filter(c => (c.offers || []).some(o => o.appliesTo === appliesTo && offerIsOpen(o))).length
  // Providers on commission whose tier the override does not fit — the server refuses the offer for them.
  const mismatched = appliesTo === 'commission' ? chosen.filter(c => overrideMismatch(c, kind)) : []
  const mismatchError = mismatched.length
    ? tt(kind === 'rate_override'
        ? 'On a fixed-fee tier, so a commission-rate offer cannot be given to them — unselect them or use a percentage off the commission: {{names}}'
        : 'On a percentage tier, so a flat-fee offer cannot be given to them — unselect them or use a percentage off the commission: {{names}}', {
        names: mismatched.slice(0, 5).map(c => c.businessName).join(', ') + (mismatched.length > 5 ? ` +${formatPortalNumber(mismatched.length - 5)}` : ''),
      })
    : null
  const tooMany = chosen.length > MAX_OFFER_PROVIDERS
    ? tt('At most 200 providers per offer — {{count}} are selected.', { count: formatPortalNumber(chosen.length) })
    : null
  const warnings: string[] = []
  if (notOnBill) {
    warnings.push(chosen.length === 1
      ? t(appliesTo === 'subscription' ? 'They are not on a subscription right now — the offer only counts while they are.' : 'They are not on commission right now — the offer only counts while they are.')
      : tt(appliesTo === 'subscription' ? 'Not on a subscription right now (the offer only counts while they are): {{count}}' : 'Not on commission right now (the offer only counts while they are): {{count}}', { count: formatPortalNumber(notOnBill) }))
  }
  if (replacing) {
    // A future-dated offer does not end the current one now: the current one is shortened to end when this one starts.
    warnings.push(chosen.length === 1
      ? (startsLater
          ? tt(appliesTo === 'subscription' ? 'Their current subscription offer stays until this one starts on {{date}}.' : 'Their current commission offer stays until this one starts on {{date}}.', { date: startDate })
          : t(appliesTo === 'subscription' ? 'This replaces their current subscription offer.' : 'This replaces their current commission offer.'))
      : (startsLater
          ? tt(appliesTo === 'subscription' ? 'Already have a subscription offer, which stays until this one starts on {{date}}: {{count}}' : 'Already have a commission offer, which stays until this one starts on {{date}}: {{count}}', { date: startDate, count: formatPortalNumber(replacing) })
          : tt(appliesTo === 'subscription' ? 'Already have a subscription offer, which this replaces: {{count}}' : 'Already have a commission offer, which this replaces: {{count}}', { count: formatPortalNumber(replacing) })))
  }
  if (chosen.length > 1 && appliesTo === 'commission' && (kind === 'rate_override' || kind === 'fee_override') && !mismatched.length) {
    warnings.push(t(kind === 'rate_override'
      ? 'A commission-rate offer only applies to providers on a percentage tier.'
      : 'A flat-fee offer only applies to providers on a fixed-fee tier.'))
  }

  const submit = async () => {
    if (busy) return
    const problem =
      !chosen.length ? t('Pick at least one provider')
      : tooMany ? tooMany
      : valueError ? valueError
      : mismatchError ? mismatchError
      : !effectiveTitle ? t('Give the offer a title')
      : cyclesError ? cyclesError
      : endsAt && endsAt < today ? t('The end date is in the past')
      : endsAt && startsAt && endsAt < startsAt ? t('The end date is before the start date')
      : null
    if (problem) { toast(problem, 'warn'); return }

    const payload = {
      providerIds: chosen.map(c => c.id),
      appliesTo,
      kind,
      value: numeric as number,
      title: effectiveTitle,
      note: note.trim() || undefined,
      startsAt: startsAt && startsAt > today ? new Date(`${startsAt}T00:00:00`).toISOString() : undefined,
      // Inclusive: an offer "until 31 Dec" still applies on the 31st.
      endsAt: endsAt ? new Date(`${endsAt}T23:59:59.999`).toISOString() : undefined,
      maxCycles: appliesTo === 'subscription' && maxCycles.trim() ? Number(maxCycles) : undefined,
    }
    const single = chosen.length === 1 ? chosen[0].businessName : null
    setBusy(true)
    try {
      const res = await confirmAndRun({
        title: single ? tt('Give {{name}} this offer?', { name: single }) : tt('Give this offer to {{count}} providers?', { count: formatPortalNumber(chosen.length) }),
        body: [`“${effectiveTitle}” — ${offerSummary({ kind, value: payload.value, appliesTo })}.`, ...effectLines, ...(example ? [example] : []), ...warnings].join(' '),
        confirmLabel: 'Give offer',
        busyLabel: 'Saving…',
        run: () => providerBillingApi.createOffers(payload),
        success: single ? tt('Offer given to {{name}}', { name: single }) : tt('Offer given to {{count}} providers', { count: formatPortalNumber(chosen.length) }),
        error: (err) => offerRefusalMessage(err, chosen),
      })
      if (res) {
        onDone(res.data?.offers || [])
        onClose()
      }
    } finally {
      setBusy(false)
    }
  }

  const allShownSelected = shown.length > 0 && shown.every(c => selected.has(c.id))

  return (
    <Layer>
      <Modal open={open} onClose={() => { if (!busy) onClose() }} title={t('Give discount / offer')} wide>
        <div className="space-y-4">
          {/* Who */}
          {lockSelection ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-sand px-3 py-2.5 text-xs">
              <span className="font-bold text-slate-500">{t('For')}</span>
              {chosen.map(c => (
                <span key={c.id} className="chip !text-[11px] bg-white font-extrabold text-deep-900 ring-1 ring-slate-200">
                  {c.providerType ? PROVIDER_TYPE_ICON[c.providerType] : ''} {c.businessName}
                </span>
              ))}
            </div>
          ) : (
            <div>
              <label className="label">{t('Providers')}</label>
              <div className="overflow-hidden rounded-xl border border-slate-100">
                <div className="flex flex-wrap gap-2 border-b border-slate-100 bg-sand/60 p-2">
                  <div className="relative min-w-[10rem] flex-1">
                    <Search size={13} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input className="input !py-1.5 !ps-8" value={query} onChange={e => setQuery(e.target.value)} placeholder={t('Search business, email or package…')} />
                  </div>
                  <select className="input !w-auto !py-1.5 text-xs font-bold" value={typeFilter} onChange={e => setTypeFilter(e.target.value as '' | ProviderTypeKey)}>
                    <option value="">{t('All provider types')}</option>
                    {(Object.keys(PROVIDER_TYPE_LABEL) as ProviderTypeKey[]).map(k => <option key={k} value={k}>{PROVIDER_TYPE_ICON[k]} {t(PROVIDER_TYPE_LABEL[k])}</option>)}
                  </select>
                  <select className="input !w-auto !py-1.5 text-xs font-bold" value={modelFilter} onChange={e => setModelFilter(e.target.value as '' | 'subscription' | 'commission')}>
                    <option value="">{t('All billing models')}</option>
                    <option value="subscription">{t('Subscription')}</option>
                    <option value="commission">{t('Commission')}</option>
                  </select>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-[11px]">
                  <span className={`font-bold ${tooMany ? 'text-rose-600' : 'text-slate-500'}`}>
                    {tt('{{count}} selected', { count: formatPortalNumber(selected.size) })}
                    {tooMany && <span className="ms-1.5 font-semibold">· {tooMany}</span>}
                  </span>
                  <span className="flex gap-1">
                    <button type="button" disabled={!shown.length} onClick={() => setSelected(prev => {
                      const next = new Set(prev)
                      if (allShownSelected) shown.forEach(c => next.delete(c.id)); else shown.forEach(c => next.add(c.id))
                      return next
                    })} className="btn-ghost !py-1 !px-2 !text-[11px] disabled:opacity-40">
                      {t(allShownSelected ? 'Unselect shown' : 'Select all shown')}
                    </button>
                    <button type="button" disabled={!selected.size} onClick={() => setSelected(new Set())} className="btn-ghost !py-1 !px-2 !text-[11px] disabled:opacity-40">{t('Clear selection')}</button>
                  </span>
                </div>
                <div className="max-h-56 overflow-y-auto border-t border-slate-100">
                  {!candidates.length && <p className="py-6 text-center text-xs text-slate-400">{t('No providers loaded.')}</p>}
                  {!!candidates.length && !shown.length && <p className="py-6 text-center text-xs text-slate-400">{t('No providers match.')}</p>}
                  {shown.map(c => {
                    const on = selected.has(c.id)
                    const live = (c.offers || []).filter(offerIsOpen)
                    return (
                      <label key={c.id} className={`flex cursor-pointer items-center gap-2.5 border-b border-slate-50 px-3 py-2 last:border-b-0 ${on ? 'bg-emerald-50/60' : 'hover:bg-sand/60'}`}>
                        <input type="checkbox" checked={on} onChange={() => toggle(c.id)} />
                        <span className="text-base">{c.providerType ? PROVIDER_TYPE_ICON[c.providerType] : '•'}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-extrabold text-deep-900">{c.businessName}</span>
                          <span className="block truncate text-[10px] text-slate-400">{[c.email, c.packageName].filter(Boolean).join(' · ')}</span>
                        </span>
                        {live.length > 0 && <span className="chip !py-0 !text-[10px] bg-violet-50 text-violet-700" title={live.map(o => o.title).join(', ')}><BadgePercent size={10} /> {formatPortalNumber(live.length)}</span>}
                        <ModelChip model={c.billingModel} fixed={c.commissionType === 'fixed'} />
                      </label>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* What */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">{t('Discount on')}</label>
              <div className="flex gap-1 rounded-xl bg-sand p-1">
                {(['subscription', 'commission'] as OfferTarget[]).map(b => (
                  <button key={b} type="button" onClick={() => changeBill(b)}
                    className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-extrabold transition ${appliesTo === b ? 'bg-white text-deep-900 shadow-soft' : 'text-slate-500 hover:text-deep-900'}`}>
                    {t(BILL_LABEL[b])}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label">{t('Type of offer')}</label>
              <select className="input font-bold" value={kind} onChange={e => setKind(e.target.value as OfferKind)}>
                {kinds.map(k => <option key={k} value={k}>{offerKindLabel(k, appliesTo)}</option>)}
              </select>
            </div>
            <div>
              <label className="label">{t('Value')} ({unit})</label>
              <input type="number" min={0} max={unit === '%' ? 100 : undefined} step="0.01" className="input" value={value} onChange={e => setValue(e.target.value)} />
              {value.trim() !== '' && valueError && <p className="mt-1 text-[11px] font-semibold text-rose-500">{valueError}</p>}
            </div>
            {appliesTo === 'subscription' ? (
              <div>
                <label className="label">{t('Max periods (blank = no limit)')}</label>
                <input type="number" min={1} max={MAX_OFFER_CYCLES} step={1} className="input" value={maxCycles} onChange={e => setMaxCycles(e.target.value)} />
                {cyclesError && <p className="mt-1 text-[11px] font-semibold text-rose-500">{cyclesError}</p>}
              </div>
            ) : <div className="hidden sm:block" />}
            <div className="sm:col-span-2">
              <label className="label">{t('Title (shown to the provider)')}</label>
              <input className="input" maxLength={80} value={titleTouched ? title : autoTitle} placeholder={t('e.g. Launch discount')}
                onChange={e => { setTitleTouched(true); setTitle(e.target.value) }} />
            </div>
            <div>
              <label className="label">{t('Starts (blank = now)')}</label>
              <input type="date" className="input" value={startsAt} onChange={e => setStartsAt(e.target.value)} />
            </div>
            <div>
              <label className="label">{t('Ends after (blank = no end date)')}</label>
              <input type="date" className="input" value={endsAt} onChange={e => setEndsAt(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">{t('Internal note (never shown to the provider)')}</label>
              <textarea rows={2} maxLength={400} className="input resize-y" value={note} onChange={e => setNote(e.target.value)} placeholder={t('e.g. Agreed with the account manager for the launch')} />
            </div>
          </div>

          {/* Effect */}
          <div className="rounded-xl border border-violet-100 bg-violet-50/50 p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-violet-700"><Sparkles size={12} /> {t('What this does')}</p>
            {numeric === null
              ? <p className="text-xs text-slate-500">{t('Enter a value to see the effect.')}</p>
              : (
                <div className="space-y-1 text-xs text-slate-600">
                  {effectLines.map((l, i) => <p key={i}>{l}</p>)}
                  {example && <p className="font-extrabold text-deep-900">{example}</p>}
                  <p className="text-[11px] text-slate-400">
                    {startsLater
                      ? tt("A provider's current offer on the same bill stays until this one starts on {{date}}; then this one replaces it.", { date: startDate })
                      : t("A provider's previous live offer on the same bill is replaced by this one.")}
                  </p>
                </div>
              )}
            {(warnings.length > 0 || mismatchError) && (
              <div className="mt-2 space-y-1 border-t border-violet-100 pt-2">
                {mismatchError && <p className="flex items-start gap-1.5 text-[11px] font-semibold text-rose-600"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> {mismatchError}</p>}
                {warnings.map((w, i) => <p key={i} className="flex items-start gap-1.5 text-[11px] font-semibold text-amber-700"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> {w}</p>)}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} disabled={busy} className="btn-ghost disabled:opacity-50">{t('Cancel')}</button>
            <button type="button" onClick={() => void submit()} disabled={busy || !chosen.length} className="btn-admin disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Gift size={14} />}
              {chosen.length > 1 ? tt('Give offer to {{count}} providers', { count: formatPortalNumber(chosen.length) }) : t('Give offer')}
            </button>
          </div>
        </div>
      </Modal>
    </Layer>
  )
}

// ── Change plan ─────────────────────────────────────────────────────────────

function subscriptionTerms(pkg: SubscriptionPackageData): string {
  return periodPrice(pkg.price, pkg.durationMonths)
}
function commissionTerms(pkg: CommissionPackageData): string {
  return commissionFigure(pkg.commissionType, pkg.commissionPercentage, pkg.fixedAmountSar)
}

/**
 * Move a provider to another package, or switch them between subscription and
 * commission — now, or when their paid period ends.
 */
export function ChangePlanModal({ open, onClose, billing, onDone }: {
  open: boolean
  onClose: () => void
  billing: ProviderBillingSnapshot
  onDone: (next?: ProviderBillingSnapshot) => void
}) {
  const name = billing.provider.businessName || billing.provider.name
  const expiry = billing.subscription?.expiry ?? null
  const fromModel = billing.billingModel
  const hasUnexpiredSub = fromModel === 'subscription' && !!expiry && new Date(expiry).getTime() > Date.now()
  const currentSubId = idOf(billing.subscription?.package)
  const currentCommId = idOf(billing.commission?.package)
  const accountStatus = billing.provider.status || 'none'
  /**
   * Approved, but their first period is still unpaid: the server only lets the
   * subscription package they will pay for be swapped, now, with payment still
   * required — waiving it is "Activate live" on the approval screen.
   */
  const awaitingFirstPayment = accountStatus === 'pending_subscription_payment'
  /** An application not yet approved has no plan to change; the server refuses. `none` = a legacy account, treated as approved. */
  const blocked = !awaitingFirstPayment && !['approved', 'suspended', 'none'].includes(accountStatus)
  const cancelPending = !!billing.subscription?.cancelAtPeriodEnd
  const scheduled = billing.scheduledChange

  const [model, setModel] = useState<'subscription' | 'commission'>('subscription')
  const [packageId, setPackageId] = useState('')
  const [when, setWhen] = useState<'now' | 'period_end'>('now')
  const [firstPeriod, setFirstPeriod] = useState<'complimentary' | 'require_payment'>('require_payment')
  const [restartIntro, setRestartIntro] = useState(true)
  const [note, setNote] = useState('')
  const [notify, setNotify] = useState(true)
  const [busy, setBusy] = useState(false)

  const subPkgs = billing.availablePackages?.subscription || []
  const commPkgs = billing.availablePackages?.commission || []
  const pkgs: (SubscriptionPackageData | CommissionPackageData)[] = model === 'subscription' ? subPkgs : commPkgs
  const currentId = model === fromModel ? (model === 'subscription' ? currentSubId : currentCommId) : ''

  const pickDefault = (m: 'subscription' | 'commission') => {
    const list = m === 'subscription' ? subPkgs : commPkgs
    const cur = m === fromModel ? (m === 'subscription' ? currentSubId : currentCommId) : ''
    return idOf(list.find(p => idOf(p) !== cur) ?? list[0])
  }

  useEffect(() => {
    if (!open) return
    const m = !awaitingFirstPayment && fromModel === 'commission' ? 'commission' : 'subscription'
    setModel(m)
    setPackageId(pickDefault(m))
    setWhen('now'); setFirstPeriod('require_payment'); setRestartIntro(true); setNote(''); setNotify(true); setBusy(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const changeModel = (m: 'subscription' | 'commission') => {
    if (blocked || (awaitingFirstPayment && m === 'commission')) return
    setModel(m)
    setPackageId(pickDefault(m))
  }

  const pkg = pkgs.find(p => idOf(p) === packageId) || null
  const isCurrentPkg = !!pkg && idOf(pkg) === currentId
  const effectiveWhen: 'now' | 'period_end' = hasUnexpiredSub && !awaitingFirstPayment ? when : 'now'
  /**
   * The server refuses the same subscription package only while there is a
   * paid period to keep or wait for: a lapsed subscriber can be put back on
   * theirs, and a commission tier can be applied again (its current terms, and
   * optionally a fresh intro clock). Swapping an unpaid first period to the
   * package it already is changes nothing.
   */
  const isSame = isCurrentPkg && model === 'subscription' && (hasUnexpiredSub || effectiveWhen === 'period_end' || awaitingFirstPayment)
  const schedule = !pkg ? [] : model === 'subscription'
    ? subscriptionSchedule(pkg as SubscriptionPackageData)
    : commissionSchedule(pkg as CommissionPackageData)
  const withIntro = hasIntroSteps(schedule)
  const needsFirstPeriod = model === 'subscription' && effectiveWhen === 'now' && !hasUnexpiredSub
  const firstPeriodChoice: 'complimentary' | 'require_payment' = awaitingFirstPayment ? 'require_payment' : firstPeriod
  /** There is an intro clock to keep only when they are on commission already. */
  const canKeepIntroClock = model === 'commission' && fromModel === 'commission' && effectiveWhen === 'now'
  const terms = !pkg ? '' : model === 'subscription' ? subscriptionTerms(pkg as SubscriptionPackageData) : commissionTerms(pkg as CommissionPackageData)
  const scheduledTarget = scheduled ? (scheduled.packageName || t(BILL_LABEL[scheduled.billingModel || 'subscription'])) : ''

  // ── the plain-language effect ──
  const effect: string[] = []
  if (pkg && !blocked) {
    if (awaitingFirstPayment) {
      effect.push(tt('They have not paid for their first period yet: the package they pay for becomes “{{package}}” ({{terms}}).', { package: pkg.name, terms }))
      effect.push(t('The plan goes live once they pay for the first period.'))
      if (withIntro) effect.push(t('The package’s introductory prices count from their first paid period on it.'))
    } else {
      effect.push(effectiveWhen === 'period_end'
        ? tt('Nothing changes until their paid period ends on {{date}}; then they move to “{{package}}” ({{terms}}).', { date: fmtDate(expiry), package: pkg.name, terms })
        : tt('They move to “{{package}}” ({{terms}}) now.', { package: pkg.name, terms }))
      if (isCurrentPkg) {
        effect.push(t(model === 'subscription'
          ? 'They are already on this package: it is assigned again and a new period starts on it.'
          : 'They are already on this tier: it is applied again with its current terms.'))
      }
      if (fromModel && fromModel !== model) {
        effect.push(t(model === 'subscription' ? 'This switches them from commission to a subscription.' : 'This switches them from a subscription to commission.'))
      }
      if (model === 'subscription') {
        if (effectiveWhen === 'now' && hasUnexpiredSub) {
          effect.push(tt('They keep the period already paid for, until {{date}}; the next renewal is charged at the new package’s price.', { date: fmtDate(expiry) }))
        } else if (needsFirstPeriod) {
          if (firstPeriodChoice === 'complimentary') {
            effect.push(t('Their first period is free — recorded at SAR 0 — and the plan is live straight away.'))
          } else {
            effect.push(t('The plan goes live once they pay for the first period.'))
            effect.push(t('Until they pay, they cannot take new bookings; bookings they already have carry on.'))
          }
        }
        if (withIntro) effect.push(t('The package’s introductory prices count from their first paid period on it.'))
      } else {
        if (effectiveWhen === 'now' && hasUnexpiredSub) {
          effect.push(tt('Their paid subscription period ends today instead of on {{date}}: the rest of it is forfeited, not refunded. To let them use it up, choose “At the end of the paid period”.', { date: fmtDate(expiry) }))
        }
        effect.push(tt('From then on each booking is charged {{rate}}.', { rate: terms }))
        if (withIntro) {
          effect.push(t(!canKeepIntroClock
            ? 'The tier’s introductory steps start from the day the change takes effect.'
            : restartIntro
              ? 'The tier’s introductory steps start again from the day the change takes effect.'
              : 'Their introductory-step clock is kept, not restarted.'))
        }
      }
    }
    // What this overrides.
    if (scheduled) {
      effect.push(tt('It replaces the change already scheduled for {{date}} (to “{{package}}”).', { date: fmtDate(scheduled.effectiveAt), package: scheduledTarget }))
    }
    if (cancelPending && !awaitingFirstPayment) {
      effect.push(effectiveWhen === 'period_end'
        ? tt('It overrides their own cancellation: instead of ending on {{date}}, the plan carries on with “{{package}}”.', { date: fmtDate(expiry), package: pkg.name })
        : model === 'subscription' && hasUnexpiredSub
          ? tt('Their own cancellation stays: the plan still ends on {{date}} unless they reactivate.', { date: fmtDate(expiry) })
          : t(model === 'commission'
              ? 'It overrides their own cancellation: they carry on, on commission.'
              : 'It overrides their own cancellation.'))
    }
    // The server closes open checkouts priced for the plan being replaced.
    effect.push(t(effectiveWhen === 'period_end' && model === 'subscription'
      ? 'Any payment checkout they have open for another package is cancelled.'
      : 'Any payment checkout they have open is cancelled, so the old plan cannot be paid for.'))
    if (!awaitingFirstPayment) effect.push(t('Any plan-change request they have pending is closed.'))
    if (!notify) effect.push(t('The provider is not notified.'))
  }

  const submit = async () => {
    if (busy || !pkg || isSame || blocked) return
    const input: ChangeProviderPlanInput = {
      billingModel: model,
      packageId: idOf(pkg),
      when: effectiveWhen,
      // Neither applies to a change queued for the period end; the server refuses them there.
      ...(needsFirstPeriod ? { firstPeriod: firstPeriodChoice } : {}),
      ...(canKeepIntroClock ? { restartIntro } : {}),
      note: note.trim() || undefined,
      notifyProvider: notify,
    }
    setBusy(true)
    try {
      const res = await confirmAndRun({
        title: effectiveWhen === 'period_end'
          ? tt('Schedule {{name}}’s move to “{{package}}”?', { name, package: pkg.name })
          : tt('Move {{name}} to “{{package}}” now?', { name, package: pkg.name }),
        body: effect.join(' '),
        confirmLabel: effectiveWhen === 'period_end' ? 'Schedule change' : 'Change plan',
        busyLabel: 'Saving…',
        run: () => providerBillingApi.changePlan(billing.provider.id, input),
        success: (r) => r?.data?.applied === false
          ? tt('Move to “{{package}}” scheduled for {{date}}', { package: pkg.name, date: fmtDate(r.data.effectiveAt) })
          : tt('{{name}} moved to “{{package}}”', { name, package: pkg.name }),
      })
      if (res) {
        onDone(res.data?.billing)
        onClose()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Layer>
      <Modal open={open} onClose={() => { if (!busy) onClose() }} title={tt('Change plan — {{name}}', { name })} wide>
        <div className="space-y-4">
          <div className="rounded-xl bg-sand px-3 py-2.5 text-xs text-slate-600">
            <span className="font-bold text-slate-500">{t('Currently on')}</span>{' '}
            <ModelChip model={billing.billingModel} fixed={billing.planKind === 'fixed_fee'} />{' '}
            <b className="text-deep-900">{(billing.billingModel === 'subscription' ? billing.subscription?.package?.name : billing.commission?.package?.name) || '—'}</b>
            {hasUnexpiredSub && <span className="text-slate-400"> · {tt('paid until {{date}}', { date: fmtDate(expiry) })}</span>}
          </div>

          {blocked && (
            <p className="flex items-start gap-1.5 rounded-xl bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {tt('Their application is {{status}} — their plan can be changed once the account is approved.', { status: t(accountStatus.replace(/_/g, ' ')) })}
            </p>
          )}
          {awaitingFirstPayment && (
            <p className="flex items-start gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {t('They have not paid for their first period yet, so only the subscription package they will pay for can be changed — payment stays required. To waive it, use “Activate live” on the approval screen.')}
            </p>
          )}

          {scheduled && (
            <p className="flex items-start gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700">
              <CalendarClock size={13} className="mt-0.5 shrink-0" />
              {tt('Already scheduled: a move to “{{package}}” on {{date}}.', { package: scheduledTarget, date: fmtDate(scheduled.effectiveAt) })}
            </p>
          )}

          <div>
            <label className="label">{t('Billing model')}</label>
            <div className="flex gap-1 rounded-xl bg-sand p-1">
              {(['subscription', 'commission'] as const).map(m => {
                const off = blocked || (awaitingFirstPayment && m === 'commission')
                return (
                  <button key={m} type="button" onClick={() => changeModel(m)} disabled={off}
                    title={awaitingFirstPayment && m === 'commission' ? t('Not until they have paid for their first period.') : undefined}
                    className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-extrabold transition disabled:cursor-not-allowed disabled:opacity-40 ${model === m ? 'bg-white text-deep-900 shadow-soft' : 'text-slate-500 hover:text-deep-900'}`}>
                    {t(BILL_LABEL[m])}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="label">{t('Package')}</label>
            {pkgs.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 py-6 text-center text-xs text-slate-400">
                {t(model === 'subscription' ? 'No active subscription packages for this provider type.' : 'No active commission tiers for this provider type.')}
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {pkgs.map(p => {
                  const pid = idOf(p)
                  const on = pid === packageId
                  const steps = model === 'subscription' ? subscriptionSchedule(p as SubscriptionPackageData) : commissionSchedule(p as CommissionPackageData)
                  return (
                    <button key={pid} type="button" onClick={() => setPackageId(pid)}
                      className={`rounded-xl border p-3 text-start transition ${on ? 'border-emerald-400 bg-emerald-50/60 ring-2 ring-emerald-200' : 'border-slate-100 hover:border-slate-200 hover:bg-sand/60'}`}>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[13px] font-extrabold text-deep-900">{p.name}</span>
                        {pid === currentId && <span className="chip !py-0 !text-[10px] bg-deep-900 text-white">{t('Current')}</span>}
                        {p.isPublic === false && <span className="chip !py-0 !text-[10px] bg-violet-100 text-violet-600">{t('hidden')}</span>}
                        {hasIntroSteps(steps) && <IntroBadge className="!py-0" />}
                      </span>
                      <span className="mt-0.5 block text-xs font-bold text-emerald-700">
                        {model === 'subscription' ? subscriptionTerms(p as SubscriptionPackageData) : commissionTerms(p as CommissionPackageData)}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
            {isSame && (
              <p className="mt-1.5 text-[11px] font-semibold text-amber-700">
                {t(awaitingFirstPayment ? 'This is already the package they will pay for — pick another one.' : 'They are already on this package — pick another one.')}
              </p>
            )}
          </div>

          {pkg && withIntro && (
            <div className="rounded-xl border border-slate-100 p-3">
              <p className="mb-2 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">{t('Introductory schedule')}</p>
              <ScheduleTimeline steps={schedule} compact
                bill={model === 'subscription' ? { bill: 'subscription', durationMonths: (pkg as SubscriptionPackageData).durationMonths } : { bill: 'commission', commissionType: (pkg as CommissionPackageData).commissionType }} />
            </div>
          )}

          {!awaitingFirstPayment && (
          <div>
            <label className="label">{t('When')}</label>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className={`flex cursor-pointer items-start gap-2 rounded-xl border p-3 text-xs ${effectiveWhen === 'now' ? 'border-emerald-400 bg-emerald-50/60' : 'border-slate-100'}`}>
                <input type="radio" className="mt-0.5" checked={effectiveWhen === 'now'} onChange={() => setWhen('now')} />
                <span><b className="block text-deep-900">{t('Now')}</b><span className="text-slate-500">{t('The new plan applies from today.')}</span></span>
              </label>
              <label className={`flex items-start gap-2 rounded-xl border p-3 text-xs ${hasUnexpiredSub ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'} ${effectiveWhen === 'period_end' ? 'border-emerald-400 bg-emerald-50/60' : 'border-slate-100'}`}>
                <input type="radio" className="mt-0.5" disabled={!hasUnexpiredSub} checked={effectiveWhen === 'period_end'} onChange={() => setWhen('period_end')} />
                <span>
                  <b className="block text-deep-900">{t('At the end of the paid period')}</b>
                  <span className="text-slate-500">{hasUnexpiredSub ? tt('On {{date}}, when their current period ends.', { date: fmtDate(expiry) }) : t('Only while they have an unexpired subscription.')}</span>
                </span>
              </label>
            </div>
          </div>
          )}

          {needsFirstPeriod && !awaitingFirstPayment && (
            <div>
              <label className="label">{t('First period')}</label>
              <div className="grid gap-2 sm:grid-cols-2">
                {([
                  ['require_payment', 'Provider pays first', 'The plan goes live once they pay for the first period; until then they cannot take new bookings.'],
                  ['complimentary', 'First period free', 'Recorded at SAR 0 — the plan is live straight away.'],
                ] as const).map(([v, label, hint]) => (
                  <label key={v} className={`flex cursor-pointer items-start gap-2 rounded-xl border p-3 text-xs ${firstPeriod === v ? 'border-emerald-400 bg-emerald-50/60' : 'border-slate-100'}`}>
                    <input type="radio" className="mt-0.5" checked={firstPeriod === v} onChange={() => setFirstPeriod(v)} />
                    <span><b className="block text-deep-900">{t(label)}</b><span className="text-slate-500">{t(hint)}</span></span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Only from commission: a provider coming from a subscription has no intro clock to keep. */}
          {canKeepIntroClock && withIntro && (
            <label className="flex items-start gap-2 text-xs font-bold text-slate-600">
              <input type="checkbox" className="mt-0.5" checked={restartIntro} onChange={e => setRestartIntro(e.target.checked)} />
              <span>{t('Start the tier’s introductory steps afresh')}<span className="block font-normal text-slate-400">{t('Untick to keep the intro clock they already have on commission.')}</span></span>
            </label>
          )}

          <div>
            <label className="label">{t('Note (kept on the plan history and audit log)')}</label>
            <textarea rows={2} maxLength={400} className="input resize-y" value={note} onChange={e => setNote(e.target.value)} placeholder={t('e.g. Agreed on the phone with the owner')} />
          </div>
          <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
            <input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} /> {t('Notify the provider')}
          </label>

          {pkg && !isSame && !blocked && (
            <div className="rounded-xl border border-ocean-100 bg-ocean-50/50 p-3">
              <p className="mb-1.5 text-[10px] font-extrabold uppercase tracking-wider text-ocean-700">{t('What this does')}</p>
              <div className="space-y-1 text-xs text-slate-600">{effect.map((l, i) => <p key={i}>{l}</p>)}</div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} disabled={busy} className="btn-ghost disabled:opacity-50">{t('Cancel')}</button>
            <button type="button" onClick={() => void submit()} disabled={busy || !pkg || isSame || blocked} className="btn-admin disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowRightLeft size={14} />}
              {t(effectiveWhen === 'period_end' ? 'Schedule change' : 'Change plan')}
            </button>
          </div>
        </div>
      </Modal>
    </Layer>
  )
}

// ── one offer, in a provider's list ─────────────────────────────────────────

export function OfferRow({ offer, providerName, onRevoked }: { offer: AdminOfferData; providerName?: string; onRevoked?: () => void }) {
  const cycles = offerCycles(offer)
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-slate-100 bg-white px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] font-extrabold text-deep-900">{offer.title}</span>
          <OfferStatusChip status={offer.status} />
          <span className="chip !py-0 !text-[10px] bg-sand text-slate-500">{t(BILL_LABEL[offer.appliesTo])}</span>
        </p>
        <p className="mt-0.5 text-[11px] font-bold text-violet-700">{offerSummary(offer)}</p>
        <p className="text-[10px] text-slate-400">{[offerWindow(offer), cycles].filter(Boolean).join(' · ')}</p>
        {offer.note && <p className="mt-0.5 text-[10px] italic text-slate-500">{t('Internal note:')} {offer.note}</p>}
        {offer.status === 'revoked' && offer.revokeReason && <p className="text-[10px] text-rose-500">{t('Revoked:')} {offer.revokeReason}</p>}
      </div>
      {offerIsOpen(offer) && onRevoked && (
        <button type="button" onClick={async () => { if (await revokeOfferFlow(offer, providerName)) onRevoked() }}
          className="btn-ghost !py-1 !px-2.5 !text-[11px] !text-rose-600">
          <Undo2 size={12} /> {t('Revoke offer')}
        </button>
      )}
    </div>
  )
}

// ── the panel ───────────────────────────────────────────────────────────────

function Row({ label, value, strong, hint }: { label: React.ReactNode; value: React.ReactNode; strong?: boolean; hint?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="text-[11px] font-semibold text-slate-500">{label}{hint && <span className="block text-[10px] font-normal text-slate-400">{hint}</span>}</span>
      <span className={`text-end ${strong ? 'font-display text-base font-extrabold text-deep-900' : 'text-xs font-bold text-slate-700'}`}>{value}</span>
    </div>
  )
}

/**
 * What one provider is on and pays, with the controls to change it.
 *
 * Loads `providerBillingApi.get` itself. `actions` and `facts` let the provider
 * directory keep its reminder button and lifecycle line in the same card.
 * `onChanged` runs after any plan or offer change, so the caller can reload
 * whatever row shows this provider.
 */
export function PlanPricingPanel({ providerId, onChanged, actions, facts }: {
  providerId: string
  onChanged?: () => void
  actions?: React.ReactNode
  facts?: React.ReactNode
}) {
  const [billing, setBilling] = useState<ProviderBillingSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [changeOpen, setChangeOpen] = useState(false)
  const [offerOpen, setOfferOpen] = useState(false)
  const [showEnded, setShowEnded] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [cancelBusy, setCancelBusy] = useState(false)
  // The latest request only: a slower answer for a provider opened before must not land here.
  const seq = useRef(0)

  const load = useCallback(() => {
    const mine = ++seq.current
    setLoading(true)
    setError('')
    providerBillingApi.get(providerId)
      .then(r => { if (mine === seq.current) setBilling(r.data) })
      .catch((e: any) => { if (mine === seq.current) setError(e?.message || 'Could not load this provider’s plan') })
      .finally(() => { if (mine === seq.current) setLoading(false) })
  }, [providerId])

  useEffect(() => { setBilling(null); setShowEnded(false); setShowHistory(false); load() }, [load])

  const changed = (next?: ProviderBillingSnapshot) => {
    if (next) setBilling(next)
    load()
    onChanged?.()
  }

  const cancelScheduled = async () => {
    if (!billing?.scheduledChange || cancelBusy) return
    const sc = billing.scheduledChange
    setCancelBusy(true)
    try {
      const res = await confirmAndRun({
        title: t('Cancel the scheduled plan change?'),
        body: tt('The move to “{{package}}” on {{date}} is dropped and they stay on their current plan.', {
          package: sc.packageName || t(BILL_LABEL[sc.billingModel || 'subscription']), date: fmtDate(sc.effectiveAt),
        }),
        confirmLabel: 'Cancel change',
        cancelLabel: 'Keep it',
        busyLabel: 'Cancelling…',
        danger: true,
        run: () => providerBillingApi.cancelScheduledChange(providerId),
        success: 'Scheduled change cancelled',
      })
      if (res) changed(res.data?.billing)
    } finally {
      setCancelBusy(false)
    }
  }

  const name = billing ? billing.provider.businessName || billing.provider.name : ''
  const model = billing?.billingModel ?? null
  const sub = billing?.subscription ?? null
  const comm = billing?.commission ?? null
  const quote = sub?.nextRenewal ?? null
  /**
   * Why the next renewal is not a plain renewal of this package: another one
   * takes over first (the quote is for it), or there is none — a move to
   * commission or the provider's own cancellation.
   */
  const renewalNote = sub?.renewalNote ?? null
  const renewsOther = !!quote && renewalNote?.reason === 'scheduled_change'
  const noteDate = fmtDate(renewalNote?.effectiveAt ?? billing?.scheduledChange?.effectiveAt ?? sub?.expiry)
  const eff = comm?.effective ?? null
  const isFixed = billing?.planKind === 'fixed_fee' || eff?.regular?.commissionType === 'fixed'
  const subSchedule = sub ? (sub.schedule?.length ? sub.schedule : subscriptionSchedule(sub.package)) : []
  const commSchedule = comm ? (comm.schedule?.length ? comm.schedule : commissionSchedule(comm.package)) : []
  const schedule = model === 'subscription' ? subSchedule : model === 'commission' ? commSchedule : []
  const expiryPast = !!sub?.expiry && new Date(sub.expiry).getTime() <= Date.now()
  const openOffers = (billing?.offers || []).filter(offerIsOpen)
  const endedOffers = (billing?.offers || []).filter(o => !offerIsOpen(o))
  const history = (billing?.history || []).slice(0, 6)

  return (
    <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50/40 p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700"><Wallet size={18} /></div>
          <div className="min-w-0">
            <p className="text-xs font-extrabold text-amber-950">{t('Plan & pricing')}</p>
            {facts && <p className="text-[11px] text-amber-800">{facts}</p>}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {actions}
          <button type="button" onClick={load} disabled={loading} title={t('Refresh')} className="grid h-8 w-8 place-items-center rounded-lg bg-white text-slate-500 ring-1 ring-slate-200 hover:text-deep-900 disabled:opacity-50">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && !billing && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700">
          <span className="flex items-center gap-1.5"><AlertTriangle size={13} /> {t("Couldn't load: ")}{t(error)}</span>
          <button type="button" onClick={load} className="btn-ghost !py-1 !px-2.5 !text-[11px] !text-rose-700 border border-rose-200 bg-white"><RefreshCw size={11} /> {t('Retry')}</button>
        </div>
      )}
      {loading && !billing && !error && (
        <div className="grid gap-3 sm:grid-cols-2" aria-busy>
          {[0, 1].map(i => <div key={i} className="h-28 animate-pulse rounded-xl bg-white/70 ring-1 ring-slate-100" />)}
        </div>
      )}

      {billing && (
        <>
          {error && <p className="text-[11px] font-semibold text-rose-600">{t('Could not refresh — showing the last figures loaded.')}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            {/* Current plan */}
            <div className="rounded-xl bg-white p-3 ring-1 ring-slate-100">
              <p className="mb-1.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">{t('Current plan')}</p>
              <p className="flex flex-wrap items-center gap-1.5">
                <ModelChip model={model} fixed={isFixed} />
                <span className="text-[13px] font-extrabold text-deep-900">
                  {(model === 'subscription' ? sub?.package?.name : model === 'commission' ? comm?.package?.name : null) || (model ? t('No package on file') : t('No plan chosen yet'))}
                </span>
                {hasIntroSteps(schedule) && <IntroBadge />}
                {(model === 'subscription' ? sub?.package?.isPublic : comm?.package?.isPublic) === false && <span className="chip !py-0 !text-[10px] bg-violet-100 text-violet-600">{t('hidden')}</span>}
              </p>
              {model === 'subscription' && sub && (
                <div className="mt-1.5 space-y-0.5 text-[11px] text-slate-500">
                  {sub.package && <p className="font-bold text-emerald-700">{periodPrice(sub.package.price, sub.package.durationMonths)} <span className="font-normal text-slate-400">{t('(regular price)')}</span></p>}
                  {sub.startedAt && <p>{tt('Started {{date}}', { date: fmtDate(sub.startedAt) })}</p>}
                  {sub.expiry && <p className={expiryPast ? 'font-bold text-rose-600' : ''}>{tt(expiryPast ? 'Expired {{date}}' : 'Paid until {{date}}', { date: fmtDate(sub.expiry) })}</p>}
                  {sub.lifecycleStatus && <p><span className="chip !py-0 !text-[10px] bg-sand text-slate-600">{t(String(sub.lifecycleStatus).replace(/_/g, ' '))}</span></p>}
                  {sub.cancelAtPeriodEnd && <p className="font-semibold text-amber-700">{t('Set to cancel at the end of this period.')}</p>}
                </div>
              )}
              {model === 'commission' && comm && (
                <div className="mt-1.5 space-y-0.5 text-[11px] text-slate-500">
                  {eff?.regular && <p className="font-bold text-teal-700">{commissionFigure(eff.regular.commissionType, eff.regular.rate, eff.regular.fixedAmount)} <span className="font-normal text-slate-400">{t('(regular rate)')}</span></p>}
                  {comm.planStartedAt && <p>{tt('On this tier since {{date}}', { date: fmtDate(comm.planStartedAt) })}</p>}
                  {eff?.monthNumber ? <p>{tt('Month {{n}} of the plan', { n: formatPortalNumber(eff.monthNumber) })}</p> : null}
                </div>
              )}
              {!model && <p className="mt-1.5 text-[11px] text-slate-400">{t('They have not chosen a subscription or commission plan yet.')}</p>}
            </div>

            {/* What they pay now */}
            <div className="rounded-xl bg-white p-3 ring-1 ring-slate-100">
              <p className="mb-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">{t('What they pay now')}</p>
              {model === 'subscription' && (quote ? (
                <div className="divide-y divide-slate-50">
                  {renewsOther && (
                    <p className="pb-1 text-[10px] font-semibold text-sky-700">
                      {tt('Quoted for “{{package}}”, which takes over on {{date}}.', { package: renewalNote?.packageName || quote.packageName, date: noteDate })}
                    </p>
                  )}
                  <Row label={t('Regular price')} value={periodPrice(quote.regularPrice, quote.durationMonths)} />
                  {quote.phase && (
                    <Row label={tt('Intro step {{n}}', { n: formatPortalNumber(quote.phase.index) })}
                      hint={[quote.phase.label, tt('billing period {{n}} of this package', { n: formatPortalNumber(quote.cycleNumber) })].filter(Boolean).join(' · ')}
                      value={sar(quote.phase.price)} />
                  )}
                  {quote.offer && (
                    <Row label={tt('Offer: {{title}}', { title: quote.offer.title })} hint={offerSummary(quote.offer)}
                      value={<span className="text-violet-700">−{sar(quote.discount)}</span>} />
                  )}
                  <Row strong label={t('Next renewal')}
                    hint={renewsOther
                      ? tt('“{{package}}”, after the change on {{date}}', { package: renewalNote?.packageName || quote.packageName, date: noteDate })
                      : sub?.expiry ? tt('due {{date}}', { date: fmtDate(sub.expiry) }) : undefined}
                    value={sar(quote.amount)} />
                </div>
              ) : renewalNote?.reason === 'switching_to_commission' ? (
                <Row strong label={t('Next renewal')} value={<span className="text-xs text-teal-700">{tt('No renewal — moving to commission on {{date}}', { date: noteDate })}</span>} />
              ) : renewalNote?.reason === 'cancelling' ? (
                <Row strong label={t('Next renewal')} hint={t('No renewal unless they reactivate.')}
                  value={<span className="text-xs text-amber-700">{tt('Cancelling on {{date}}', { date: noteDate })}</span>} />
              ) : <p className="text-[11px] text-slate-400">{t('No renewal price to show — there is no subscription package on file.')}</p>)}
              {model === 'commission' && (eff ? (
                <div className="divide-y divide-slate-50">
                  <Row strong label={t('Commission now')} value={commissionFigure(eff.commissionType, eff.rate, eff.fixedAmount)} />
                  {eff.phase && (
                    <Row label={tt('Intro step {{n}}', { n: formatPortalNumber(eff.phase.index) })}
                      hint={eff.phase.label}
                      value={<span className="text-[11px]">{tt('Months {{from}}–{{to}}', { from: formatPortalNumber(eff.phase.fromMonth), to: formatPortalNumber(eff.phase.toMonth) })}</span>} />
                  )}
                  {eff.offer && (
                    <Row label={tt('Offer: {{title}}', { title: eff.offer.title || offerSummary({ kind: eff.offer.kind, value: eff.offer.value, appliesTo: 'commission' }) })}
                      hint={eff.offer.endsAt ? tt('Until {{date}}', { date: fmtDate(eff.offer.endsAt) }) : t('No end date')}
                      value={<span className="text-violet-700">{offerSummary({ kind: eff.offer.kind, value: eff.offer.value, appliesTo: 'commission' })}</span>} />
                  )}
                  <Row label={t('Regular rate')} value={commissionFigure(eff.regular.commissionType, eff.regular.rate, eff.regular.fixedAmount)} />
                  {!eff.phase && !eff.offer && <p className="pt-1 text-[10px] text-slate-400">{t('The tier’s regular rate applies — no intro step or offer.')}</p>}
                </div>
              ) : <p className="text-[11px] text-slate-400">{t('No commission figures on file.')}</p>)}
              {!model && <p className="text-[11px] text-slate-400">{t('Nothing is billed until they are on a plan.')}</p>}
            </div>
          </div>

          {hasIntroSteps(schedule) && (
            <div className="rounded-xl bg-white p-3 ring-1 ring-slate-100">
              <p className="mb-2 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">{t('Introductory schedule')}</p>
              <ScheduleTimeline
                steps={schedule}
                bill={model === 'subscription' ? { bill: 'subscription', durationMonths: sub?.package?.durationMonths ?? quote?.durationMonths } : { bill: 'commission', commissionType: eff?.regular?.commissionType ?? comm?.package?.commissionType }}
                currentIndex={model === 'subscription' ? (quote && !renewsOther ? quote.phase?.index ?? null : undefined) : (eff?.monthNumber ? eff.phase?.index ?? null : undefined)}
                currentLabel={model === 'subscription' ? 'Next renewal' : 'Now'}
                compact
              />
            </div>
          )}

          {billing.scheduledChange && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-sky-800">
                <CalendarClock size={14} className="shrink-0" />
                {tt('Scheduled: moves to “{{package}}” on {{date}}', {
                  package: billing.scheduledChange.packageName || t(BILL_LABEL[billing.scheduledChange.billingModel || 'subscription']),
                  date: fmtDate(billing.scheduledChange.effectiveAt),
                })}
                {billing.scheduledChange.billingModel && <ModelChip model={billing.scheduledChange.billingModel} />}
              </p>
              <button type="button" onClick={() => void cancelScheduled()} disabled={cancelBusy} className="btn-ghost !py-1 !px-2.5 !text-[11px] !text-rose-600 disabled:opacity-50">
                {cancelBusy ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />} {t('Cancel change')}
              </button>
            </div>
          )}

          {/* Offers */}
          <div className="space-y-1.5">
            <p className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-400"><BadgePercent size={12} /> {t('Discounts & offers')}</p>
            {openOffers.length === 0 && <p className="text-[11px] text-slate-400">{t('No live or upcoming offers.')}</p>}
            {openOffers.map(o => <OfferRow key={o.id} offer={o} providerName={name} onRevoked={() => changed()} />)}
            {endedOffers.length > 0 && (
              <>
                <button type="button" onClick={() => setShowEnded(v => !v)} className="flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-deep-900">
                  <ChevronDown size={12} className={`transition ${showEnded ? 'rotate-180' : ''}`} />
                  {tt('Ended offers ({{count}})', { count: formatPortalNumber(endedOffers.length) })}
                </button>
                {showEnded && endedOffers.map(o => <OfferRow key={o.id} offer={o} providerName={name} />)}
              </>
            )}
          </div>

          {history.length > 0 && (
            <div>
              <button type="button" onClick={() => setShowHistory(v => !v)} className="flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-deep-900">
                <History size={12} /> {tt('Recent plan changes ({{count}})', { count: formatPortalNumber(history.length) })}
                <ChevronDown size={12} className={`transition ${showHistory ? 'rotate-180' : ''}`} />
              </button>
              {showHistory && (
                <div className="mt-1.5 space-y-1">
                  {history.map(h => (
                    <div key={h._id} className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-1.5 text-[11px] ring-1 ring-slate-100">
                      <span className="min-w-0">
                        <b className="text-deep-900">{t(h.changeType.replace(/_/g, ' '))}</b>
                        <span className="text-slate-400"> · {h.fromPackageName || (h.fromBillingModel ? t(h.fromBillingModel) : '—')} → {h.toPackageName || (h.toBillingModel ? t(h.toBillingModel) : '—')}</span>
                        {h.notes && <span className="block truncate text-[10px] text-slate-400">{h.notes}</span>}
                      </span>
                      <span className="shrink-0 text-end text-slate-400">
                        <span className={`chip !py-0 !text-[10px] ${h.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : h.status === 'scheduled' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>{t(h.status)}</span>
                        <span className="ms-1">{fmtDate(h.effectiveAt)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2 border-t border-amber-100 pt-3">
            <button type="button" onClick={() => setChangeOpen(true)} className="btn-admin !py-1.5 !px-3 !text-xs"><ArrowRightLeft size={13} /> {t('Change plan')}</button>
            <button type="button" onClick={() => setOfferOpen(true)} className="btn-ghost !py-1.5 !px-3 !text-xs"><Gift size={13} /> {t('Give discount / offer')}</button>
          </div>

          <ChangePlanModal open={changeOpen} onClose={() => setChangeOpen(false)} billing={billing} onDone={(next) => changed(next)} />
          <GiveOfferModal
            open={offerOpen}
            onClose={() => setOfferOpen(false)}
            candidates={[candidateFromBilling(billing)]}
            initialSelected={[billing.provider.id]}
            lockSelection
            defaultAppliesTo={model === 'commission' ? 'commission' : 'subscription'}
            preview={previewBaseFromBilling(billing)}
            onDone={() => changed()}
          />
        </>
      )}
    </div>
  )
}

/** The panel on its own, in a modal — the "Manage plan" action on Provider Models. */
export function ProviderPlanModal({ provider, onClose, onChanged }: {
  provider: { id: string; name: string } | null
  onClose: () => void
  onChanged?: () => void
}) {
  return (
    <Modal open={!!provider} onClose={onClose} title={provider ? tt('Plan & pricing — {{name}}', { name: provider.name }) : ''} wide>
      {provider && <PlanPricingPanel providerId={provider.id} onChanged={onChanged} />}
    </Modal>
  )
}

