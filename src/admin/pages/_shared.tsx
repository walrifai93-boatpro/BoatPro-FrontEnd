import React from 'react'
import { avatar } from '../../format'
import { translatePortalText, formatPortalNumber  , formatPortalDate} from '../../i18n/runtime'
import { fileUrl, type AIDocument, type ApiAdminPayment, type ApiApplicantDocChecklist, type ApiKycDocument, type ApiReview } from '../../api'
import type { KycItem, Provider } from '../adminData'

export function PageWrap({ children }: { children: React.ReactNode }) {
  return <div className="space-y-2">{children}</div>
}

// A payment's booking type isn't always cheap to resolve down to "which boat /
// which berth" without an extra query per row, so payment tables are honest
// about what they actually show: the vertical + real financial figures from
// Payment, not a fabricated item name.
export const BOOKING_TYPE_META: Record<string, { icon: string; label: string }> = {
  trip: { icon: '⛵', label: 'Boat trip' },
  // A marina has two berth products: a stay booked by the night/hour/day
  // (`berth`, BerthBooking) and a longer berth rental (`dock`,
  // DockSubscription). `berth` had no entry, so those rows showed the raw word.
  berth: { icon: '⚓', label: 'Berth booking' },
  dock: { icon: '🛟', label: 'Berth rental' },
  fuel: { icon: '⛽', label: 'Fuel' },
  service: { icon: '🧰', label: 'Marina service' },
  maintenance: { icon: '🔧', label: 'Maintenance' },
}

export const PAYMENT_STATUS_META: Record<ApiAdminPayment['status'], { label: string; dot: boolean }> = {
  paid: { label: 'Paid', dot: true },
  pending: { label: 'Pending', dot: false },
  failed: { label: 'Failed', dot: false },
  refunded: { label: 'Refunded', dot: false },
  partially_refunded: { label: 'Partially refunded', dot: false },
}

/**
 * What the platform keeps on one payment — the server's `paymentRevenue`
 * arithmetic, so rows add up to the "Commission earned" totals. The stored
 * `commissionAmount` is what was charged at checkout: a refunded row still
 * carries it, and a partial refund doesn't shrink it.
 */
export function earnedCommission(p: ApiAdminPayment): number {
  if (p.status !== 'paid' && p.status !== 'partially_refunded') return 0
  const amount = p.amount || 0
  const kept = amount > 0 ? 1 - (p.refundAmount ?? 0) / amount : 0
  return Math.round((amount - (p.providerNet ?? amount)) * kept * 100) / 100
}

/**
 * What the platform kept, split the way a statement should show it.
 *
 * `earnedCommission` is everything between the charge and the provider's net,
 * which also holds the card-processing fee when the provider bears it — a
 * subscription marina on "0% commission" showed "+SAR 14.09 comm." for what was
 * entirely the acquirer's 3.5%. `commissionAmount` is the commission alone;
 * the rest of the cut is the card fee.
 */
export function platformCut(p: ApiAdminPayment): { commission: number; cardFee: number } {
  const total = earnedCommission(p)
  const amount = p.amount || 0
  const kept = amount > 0 ? 1 - (p.refundAmount ?? 0) / amount : 0
  const commission = Math.min(total, Math.round((p.commissionAmount ?? total) * kept * 100) / 100)
  return { commission, cardFee: Math.round((total - commission) * 100) / 100 }
}

/** The business a booking was made with; the account holder's name only when no business name was set. */
export function paymentProviderLabel(p: ApiAdminPayment): string {
  const pr = p.provider
  if (pr && typeof pr === 'object') return pr.business?.businessName || pr.name || '—'
  return '—'
}

/** What was booked — the booking's title (or boat), else the vertical's name. */
export function paymentTitle(p: ApiAdminPayment): string {
  return p.booking?.title || p.booking?.boat || translatePortalText(BOOKING_TYPE_META[p.bookingType || '']?.label || 'Payment')
}

export function seededAvatar(seed: string) {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return avatar((h % 70) + 1)
}

export function personName(v: { name: string } | string | null | undefined, fallback = 'Unknown'): string {
  if (!v) return fallback
  return typeof v === 'string' ? fallback : v.name || fallback
}

export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * The provider's answer to "do you have a VAT certificate?", for a reviewer.
 *
 * Shown because a "no" is the reason an application arrives without a VAT
 * certificate — without it, that reads as a missing document. Unanswered means
 * the account predates the question and was held to the certificate as before.
 */
export function vatCertificateLabel(hasVatCertificate: boolean | undefined): string {
  if (hasVatCertificate === true) return translatePortalText('Yes — required')
  if (hasVatCertificate === false) return translatePortalText('No — not VAT-registered')
  return translatePortalText('Not asked — required')
}

const VESSEL_AND_CREW_DOC_TYPES = ['captain_license', 'boat_registration', 'boat_license']

/**
 * A provider's registration documents, less vessel and crew papers when the
 * provider is not a boat operator and the checklist does not ask for them.
 *
 * The server leaves those out itself; this keeps a fuel station's review free
 * of boat registrations even when an older server still sends them.
 */
export function relevantRegistrationDocs<T extends { docType?: string }>(
  docs: T[],
  role: string | undefined,
  checklist: ApiApplicantDocChecklist | null | undefined,
): T[] {
  if (!role || role === 'boat_provider') return docs
  const onChecklist = new Set([...(checklist?.required ?? []), ...(checklist?.optional ?? [])].map((s) => s.docType))
  return docs.filter((d) => !VESSEL_AND_CREW_DOC_TYPES.includes(d.docType ?? '') || onChecklist.has(d.docType ?? ''))
}

// Real DocumentVerification.docType values grouped into the same broad
// categories the KYC UI already presents (Identity/Business/License/Insurance/Tax).
const DOC_TYPE_KIND: Record<string, KycItem['kind']> = {
  national_id: 'Identity', iqama: 'Identity',
  commercial_registration: 'Business', national_address: 'Business',
  vat_certificate: 'Tax',
  captain_license: 'License', boat_registration: 'License', boat_license: 'License',
}
const PROVIDER_TYPE_TO_KIND: Record<string, Provider['kind']> = {
  marina_provider: 'Marina', fuel_provider: 'Fuel', maintenance_provider: 'Maintenance', boat_provider: 'Boat',
}
function docTypeLabel(docType: string): string {
  return docType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

/** Maps a real DocumentVerification record onto the KYC board's display shape. */
export function toKycItem(doc: ApiKycDocument): KycItem {
  const owner = typeof doc.owner === 'object' ? doc.owner : null
  const expiringSoon = doc.status === 'approved' && !!doc.expiresAt && new Date(doc.expiresAt).getTime() - Date.now() < 30 * 86_400_000
  return {
    id: doc._id,
    who: owner?.name || 'Unknown',
    avatar: fileUrl(owner?.avatar) || seededAvatar(doc._id),
    kind: DOC_TYPE_KIND[doc.docType] || 'Business',
    doc: docTypeLabel(doc.docType),
    submitted: formatPortalDate(new Date(doc.createdAt)),
    status: expiringSoon ? 'Expiring' : doc.status === 'approved' ? 'Approved' : doc.status === 'rejected' ? 'Rejected' : 'Pending',
    note: doc.status === 'rejected' ? doc.rejectionReason : expiringSoon ? `Expires ${formatPortalDate(new Date(doc.expiresAt!))}` : undefined,
    providerKind: doc.providerType ? PROVIDER_TYPE_TO_KIND[doc.providerType] : undefined,
  }
}

/**
 * Maps an AI-reviewed document onto the same KYC board shape.
 *
 * The vertical KYC pages handed the board `{ type, providerName, status:
 * 'needs_review' }` while it reads `{ who, doc, kind, status: 'Pending' }` —
 * so every row rendered as "· · submitted …" with no name or document, and
 * every counter stayed at 0.
 */
export function aiDocToKycItem(doc: AIDocument): KycItem {
  const owner = typeof doc.owner === 'object' && doc.owner ? doc.owner : null
  const id = doc._id || doc.id || ''
  const expiring = doc.status === 'approved' && (doc.expiry?.status === 'expiring_soon' || doc.expiry?.status === 'expired')
  return {
    id,
    who: owner?.name || 'Unknown',
    avatar: fileUrl(owner?.avatar) || seededAvatar(id),
    kind: DOC_TYPE_KIND[doc.docType] || 'Business',
    doc: doc.docType === 'unknown' ? 'Unrecognised document' : docTypeLabel(doc.docType),
    submitted: formatPortalDate(new Date(doc.createdAt)),
    status: expiring ? 'Expiring' : doc.status === 'approved' ? 'Approved' : doc.status === 'rejected' ? 'Rejected' : 'Pending',
    note: doc.status === 'rejected' ? doc.review?.reason
      : doc.status === 'failed' ? (doc.failureReason || translatePortalText('The AI could not read this document — check it by hand'))
      : expiring ? translatePortalText(doc.expiry?.status === 'expired' ? 'Expired' : 'Expiring soon')
      : undefined,
  }
}

/** What a review's targetType/populated ref actually points at — for display. */
export function reviewTargetLabel(r: ApiReview): { icon: string; text: string } {
  const named = (v: any) => (v && typeof v === 'object' ? v.name || v.title : null)
  if (r.targetType === 'boat') return { icon: '⛵', text: named(r.boat) || translatePortalText('a boat') }
  if (r.targetType === 'marina') return { icon: '⚓', text: named(r.marina) || translatePortalText('a marina') }
  if (r.targetType === 'fuel_station') return { icon: '⛽', text: named(r.fuelStation) || translatePortalText('a fuel station') }
  if (r.targetType === 'maintenance_shop') {
    const shop = r.maintenanceShop && typeof r.maintenanceShop === 'object' ? r.maintenanceShop.nameEn : null
    return { icon: '🔧', text: shop || translatePortalText('a workshop') }
  }
  if (r.targetType === 'captain') return { icon: '🧑‍✈️', text: named(r.captain) || translatePortalText('a captain') }
  if (r.targetType === 'staff') return { icon: '🧑‍🔧', text: named(r.staff) || translatePortalText('a staff member') }
  if (r.targetType === 'trip') {
    // `r.trip` is the booking; the trip's own title is one level further in.
    const booking = r.trip as any
    const title = booking && typeof booking === 'object' ? named(booking.trip) || booking.code : null
    return { icon: '🗺️', text: title || translatePortalText('a trip') }
  }
  return { icon: '📍', text: translatePortalText('a listing') }
}

// Provider['kind'] → the review targetType(s) that vertical can actually have.
// Maintenance was '' — "not a reviewable listing type yet" — though the Review
// schema has had `maintenance_shop` (and technicians as `staff`) for a while:
// a workshop's reviews counted towards its rating on the directory and could
// be moderated nowhere.
export const REVIEW_TARGET_TYPES_FOR_KIND: Record<Provider['kind'], string> = {
  Boat: 'boat,trip,captain', Marina: 'marina,staff', Fuel: 'fuel_station,staff', Maintenance: 'maintenance_shop,staff',
}

// Which workers' `staff` reviews belong to a vertical — a `staff` review is of
// a marina hand or a fuel attendant alike, told apart by `staffModel`. The
// marina's dock staff are reviewed by the boaters who berthed there, and those
// reviews count towards the marina operator's rating on the directory.
export const REVIEW_STAFF_MODEL_FOR_KIND: Partial<Record<Provider['kind'], string>> = {
  Marina: 'MarinaStaff',
  // Attendants, reviewed by the customers they fuelled.
  Fuel: 'FuelWorker',
  // Technicians, reviewed by the boaters whose jobs they worked.
  Maintenance: 'MaintenanceTechnician',
}

export const ChartTip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-slate-100 bg-white/95 px-3 py-2 text-xs shadow-lift backdrop-blur">
      {label && <p className="font-bold text-deep-900 mb-1">{translatePortalText(label)}</p>}
      {payload.map((p: any) => (
        <p key={p.name} className="flex items-center gap-2 text-slate-500">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.fill }} />
          {translatePortalText(p.name)}: <b className="text-deep-900">{typeof p.value === 'number' ? formatPortalNumber(p.value) : p.value}</b>
        </p>
      ))}
    </div>
  )
}
