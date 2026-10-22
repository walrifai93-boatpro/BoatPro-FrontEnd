import { useNavigate } from 'react-router-dom'
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { motion } from 'framer-motion'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell,
} from 'recharts'
import {
  Sailboat, Anchor, Fuel, Wrench, Plus, Check, X, FileCheck2, Star, ShieldCheck, Ban,
  Eye, RotateCcw, TrendingUp, BadgeCheck, Gauge, Landmark, Percent, Ticket, CreditCard,
  Sparkles, FileText, ExternalLink, AlertTriangle, Bell, AlertOctagon, Clock, BellRing,
} from 'lucide-react'
import {
  money, AIMG,
  type Provider, type ABooking,
} from '../adminData'
import { listingPhoto } from '../../images'
import { PageWrap, ChartTip, BOOKING_TYPE_META, PAYMENT_STATUS_META, seededAvatar, personName, MONTH_NAMES, toKycItem, aiDocToKycItem, REVIEW_TARGET_TYPES_FOR_KIND, REVIEW_STAFF_MODEL_FOR_KIND, vatCertificateLabel, earnedCommission, platformCut, paymentProviderLabel, relevantRegistrationDocs } from './_shared'
import { Section, toast, Img, Counter, Modal, CardGridSkeleton, TableSkeleton, downloadCsv } from '../../ui'
import { TableToolbar, useTableFilters, NoFilterMatches, TablePagination, type TableFiltersConfig } from '../../shared/TableFilters'
import { AdminHeader, ABadge, AProgress, ViewToggle } from '../adminUi'
import { ReviewStatCards, ReviewsBoard, useReviewModeration } from './AdminEngage'
import { KycStatCards, KycBoard } from './AdminPeople'
import { adminApi, adminPortalApi, documentsApi, aiDocumentApi, fileUrl, type AdminProvider, type ApiAdminPayment, type ApiCommissionRevenueRow, type ApiKycDocument, type ApiPackageRevenue, type ApiRevenueTotals, type ApiReview, type AIDocument } from '../../api'
import { confirmAndRun } from '../../async'
import { DocumentFindingList, DocumentFindingsSummary, type DocumentReview } from '../DocumentFindings'
import { RequiredDocsChecklist } from './RequiredDocsChecklist'
import type { ApiApplicantDocChecklist } from '../../api'
import { AiDocumentVerificationModal } from '../../components/AiDocumentVerificationModal'
import { RequestReuploadModal } from '../../components/RequestReuploadModal'
import { planKindOf, planModelLabel, planTermsLabel, providerPlanLabel } from '../../shared/planLabel'
import { PlanPricingPanel } from '../ProviderPlanControls'
import { BASE_CURRENCY } from '../../currency'
import { formatMoney } from '../../live'
import { isPortalArabic, translatePortalText, translatePortalTemplate, formatPortalDate, formatPortalNumber, formatPortalPercent } from '../../i18n/runtime'
import type { DomainCfg } from './ProviderDomainConfig'
export { CFGS } from './ProviderDomainConfig'
export type { DomainCfg } from './ProviderDomainConfig'

function formatAdminDayCount(value: number | null | undefined): string {
  const days = Math.abs(Math.trunc(value ?? 0))
  const amount = formatPortalNumber(days)
  if (!isPortalArabic()) return `${amount}d`
  const remainder = days % 100
  const unit = days === 2 ? 'يومان' : remainder >= 3 && remainder <= 10 ? 'أيام' : remainder >= 11 && remainder <= 99 ? 'يوماً' : 'يوم'
  return `${amount} ${unit}`
}

/**
 * Text that is only numbers — "25.20494, 55.27042" — is a map pin, not a place.
 *
 * The provider apps' location picker writes the raw coordinates into `address`
 * when reverse-geocoding fails, and the listing and directory columns fell back
 * to that field, so a station's Location read "25.20494".
 */
const COORDINATE_TEXT = /^[-+\d\s.,°]+$/
function isCoordinateText(v: unknown): boolean {
  return typeof v === 'string' && /\d/.test(v) && COORDINATE_TEXT.test(v.trim())
}

/** The first real place name, "Location pinned" if all we hold is a pin, else null. */
function placeLabel(...vals: (string | null | undefined)[]): string | null {
  let pinned = false
  for (const v of vals) {
    const t = typeof v === 'string' ? v.trim() : ''
    if (!t) continue
    if (isCoordinateText(t)) { pinned = true; continue }
    return t
  }
  return pinned ? translatePortalText('Location pinned') : null
}

/**
 * When a package's display label and its billed term disagree.
 *
 * A package carries two terms: `duration`, free text shown on Packages &
 * Pricing ("1 Month"), and `durationMonths`, which billing and expiry use. They
 * are set separately and never reconciled, so a package can read "1 Month" there
 * while charging — and here, correctly, showing — "/yr" and a 321-day expiry.
 * Returns a note when they differ, so the directory explains itself.
 */
function packageTermMismatch(onboarding: any): string | null {
  const pkg = onboarding?.subscriptionPackageId
  if (!pkg || typeof pkg !== 'object' || typeof pkg.duration !== 'string') return null
  const m = pkg.duration.match(/(\d+)\s*(month|year|yr|mo)/i)
  if (!m) return null
  const labelled = Number(m[1]) * (/^y/i.test(m[2]) ? 12 : 1)
  const billed = pkg.durationMonths || 1
  if (labelled === billed) return null
  return `${translatePortalText('Package is labelled')} “${pkg.duration}” ${translatePortalText('but bills')} ${formatPortalNumber(billed)} ${translatePortalText(billed === 1 ? 'month' : 'months')}`
}

/** A failed load, said as one — never an empty table that reads as "none". */
function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="card mb-4 flex flex-wrap items-center justify-between gap-3 !border-rose-200 !bg-rose-50 p-4 text-sm text-rose-700">
      <span className="flex items-center gap-2"><AlertTriangle size={15} className="shrink-0" /> {message}</span>
      <button onClick={onRetry} className="btn-ghost !py-1.5 !px-3 !text-xs !text-rose-700 border border-rose-200 bg-white"><RotateCcw size={12} /> {translatePortalText('Retry')}</button>
    </div>
  )
}

/** "Showing 100 of 240" with a button for the next page, when there is one. */
function LoadMore({ shown, total, busy, onMore, noun }: { shown: number; total: number; busy: boolean; onMore: () => void; noun: string }) {
  if (total <= shown) return null
  return (
    <div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-xs text-slate-500">
      <span>{translatePortalText('Showing')} {formatPortalNumber(shown)} {translatePortalText('of')} {formatPortalNumber(total)} {translatePortalText(noun)}</span>
      <button onClick={onMore} disabled={busy} className="btn-ghost !py-1.5 !px-3 !text-xs disabled:opacity-60">{translatePortalText(busy ? 'Loading…' : 'Load more')}</button>
    </div>
  )
}

// Provider["kind"] ('Boat'/'Marina'/'Fuel'/'Maintenance') → the Payment
// bookingType(s) and User role that vertical actually corresponds to.
const BOOKING_TYPE_FOR_KIND: Record<Provider['kind'], string> = {
  // Marina: `berth` too — the stays boat operators book. Without it the Berth
  // Bookings page and the Performance trend left out every berth booking,
  // while Commission (scoped by role) counted them.
  Boat: 'trip', Marina: 'dock,berth,service', Fuel: 'fuel', Maintenance: 'maintenance',
}
const ROLE_FOR_KIND: Record<Provider['kind'], string> = {
  Boat: 'boat_provider', Marina: 'marina_provider', Fuel: 'fuel_provider', Maintenance: 'maintenance_provider',
}

export function ProviderDirectory({ cfg }: { cfg: DomainCfg }) {
  const nav = useNavigate()
  const [filter, setFilter] = useState('All')
  const [view, setView] = useState<'card' | 'table'>('table')
  // Incomplete and Blocked are statuses a row can carry, so each has a chip —
  // without them those providers were reachable only under "All".
  const filters = ['All', 'Live', 'Expiring / Expired', 'Pending', 'Awaiting Payment', 'Rejected', 'Suspended', 'Incomplete', 'Blocked']
  const [all, setAll] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // The latest request only — switching vertical mid-load must not let the
  // slower, older response write another vertical's providers in here.
  const loadSeq = useRef(0)
  const [detail, setDetail] = useState<any | null>(null)
  const [registration, setRegistration] = useState<any | null>(null)
  const [regDocs, setRegDocs] = useState<any[]>([])
  const [docReview, setDocReview] = useState<DocumentReview | null>(null)
  const [docChecklist, setDocChecklist] = useState<ApiApplicantDocChecklist | null>(null)
  const [regLoading, setRegLoading] = useState(false)
  const [regError, setRegError] = useState<string | null>(null)
  const [expandedDocTypes, setExpandedDocTypes] = useState<Record<string, boolean>>({})
  const [aiDoc, setAiDoc] = useState<AIDocument | null>(null)
  // The document a reviewer is asking the provider to replace, if any.
  const [reuploadFor, setReuploadFor] = useState<{ id: string; label: string; provider?: string } | null>(null)

  const toggleDocHistory = (type: string) => {
    setExpandedDocTypes(prev => ({ ...prev, [type]: !prev[type] }))
  }

  // Approve needs no reason; reject requires one and shows it to the provider,
  // so both go through one dialog that only asks when it has to.
  const verifyDoc = (docId: string, status: 'approved' | 'rejected') =>
    confirmAndRun({
      title: status === 'approved' ? 'Approve this document?' : 'Reject this document?',
      body:
        status === 'approved'
          ? 'It counts towards the provider being verified.'
          : 'The provider is told why and can upload a replacement.',
      input:
        status === 'approved'
          ? undefined
          : { label: 'Reason for rejection', placeholder: 'Shown to the provider', required: true, multiline: true, maxLength: 400 },
      confirmLabel: status === 'approved' ? 'Approve' : 'Reject',
      busyLabel: status === 'approved' ? 'Approving...' : 'Rejecting...',
      danger: status === 'rejected',
      run: async (reason) => {
        await adminApi.verifyDocument(docId, status, reason || undefined)
        if (detail) openDetail(detail)
      },
      success: status === 'approved' ? 'Document approved' : 'Document rejected',
      error: `Could not ${status === 'approved' ? 'approve' : 'reject'} the document. Please try again.`,
    })

  // The latest provider opened only — a slower answer for the one opened
  // before it must not fill this modal with that provider's documents.
  const detailSeq = useRef(0)
  const openDetail = async (p: any) => {
    const seq = ++detailSeq.current
    setDetail(p); setRegistration(null); setRegDocs([]); setDocReview(null); setDocChecklist(null); setRegLoading(true); setRegError(null); setExpandedDocTypes({});
    try {
      const r = await adminApi.getRegistration(p._id || p.id)
      if (seq !== detailSeq.current) return
      setRegistration(r.data.registration)
      setRegDocs(relevantRegistrationDocs(r.data.documents, p.role ?? `${cfg.slug}_provider`, r.data.documentChecklist))
      setDocReview(r.data.documentReview ?? null)
      setDocChecklist(r.data.documentChecklist ?? null)
    } catch (e) {
      if (seq !== detailSeq.current) return
      // Said in the modal: the empty document list below otherwise reads as
      // "this provider uploaded nothing".
      setRegError(translatePortalText(e instanceof Error ? e.message : 'Could not load their registration and documents'))
    } finally {
      if (seq === detailSeq.current) setRegLoading(false)
    }
  }

  const load = useCallback(() => {
    const seq = ++loadSeq.current
    setLoadError(null)
    return adminApi.listProviders({ role: `${cfg.slug}_provider` })
      .then(res => {
        if (seq !== loadSeq.current) return
        setAll(res.data.providers.map(p => {
          // `providerKind`, never `role`. A diving operator is a `boat_provider`
          // whose kind is `scuba_diver` — "scuba_diver" is not, and never was, a
          // role, so the `p.role === 'scuba_diver'` half of this test could only
          // ever be false. TypeScript said so outright: the role union has no
          // such member.
          const isDiver = cfg.slug === 'boat' && p.providerKind === 'scuba_diver'
          return {
            id: p.id || p._id,
            name: p.business?.businessName || p.name,
            kind: cfg.kind,
            providerKind: p.providerKind || 'standard',
            isDiver,
            icon: isDiver ? '🤿' : cfg.icon,
            owner: p.name,
            avatar: fileUrl(p.avatar) || seededAvatar(p.id || p._id),
            status: !(p as any).isActive
              ? 'Blocked'
              : p.onboarding?.status === 'suspended'
              ? 'Suspended'
              : p.onboarding?.status === 'pending'
              ? 'Pending'
              : p.onboarding?.status === 'pending_subscription_payment'
              ? 'Awaiting Payment'
              : p.onboarding?.status === 'approved'
              ? 'Live'
              // Rejected and unfinished applications used to fall through to
              // 'Pending' — a rejected provider showed up as a fresh application
              // with an Approve button, indistinguishable from one awaiting review.
              : p.onboarding?.status === 'rejected'
              ? 'Rejected'
              // No onboarding record at all is an account that never applied —
              // it showed as "Pending", with an Approve button.
              : !p.onboarding?.status || p.onboarding.status === 'incomplete' || (p.onboarding.status as string) === 'draft'
              ? 'Incomplete'
              : 'Pending',
            verified: p.onboarding?.status === 'approved',
            // Sent back with approve/reject: the server refuses (409) if it changed meanwhile.
            onboardingStatus: p.onboarding?.status ?? 'pending',
            // Real figures from the list (`stats`) — these were hardcoded to 0,
            // so Revenue and Rating read "—" on every row and "Has bookings"
            // could never match anyone.
            rating: p.stats?.rating ?? 0,
            reviewCount: p.stats?.reviewCount ?? 0,
            revenue: p.stats?.gross ?? 0,
            bookings: p.stats?.bookings ?? 0,
            // The package they are on, by name and price — "Subscription" alone
            // said the same thing for every subscriber. Never the `|| 15` this
            // once fell back to: a fixed-fee provider has no percentage.
            plan: providerPlanLabel(p.onboarding),
            // No `|| 'subscription'`: an account that never chose a plan is not a
            // subscriber, and the fallback gave it a Remind button and an
            // "awaiting payment" approval toast it had nothing to do with.
            paymentModel: p.onboarding?.billingModel || null,
            // "Fixed fee" told apart from "Commission" — both ride on `commission`.
            planKind: planKindOf(p.onboarding),
            subscriptionExpiry: (p.onboarding as any)?.subscriptionExpiry || p.onboarding?.subscriptionExpiresAt,
            subStatus: p.subscriptionInfo?.status || 'none',
            daysUntilExpiry: p.subscriptionInfo?.daysUntilExpiry ?? null,
            isExpiringSoon: p.subscriptionInfo?.status === 'expiring_soon',
            // From the status, not `isExpired`: the server sets that flag on an
            // account awaiting its first payment too, so every Awaiting Payment
            // provider was counted, filtered and badged as "Expired".
            isExpired: p.subscriptionInfo?.status === 'expired',
            joined: p.createdAt ? formatPortalDate(new Date(p.createdAt)) : 'Unknown',
            email: p.email,
            // The business's city, never the raw pin some accounts hold instead.
            place: placeLabel(p.business?.city, p.business?.region),
            image: cfg.hero,
            raw: p,
          }
        }))
      })
      .catch((e) => {
        if (seq !== loadSeq.current) return
        // Said on the page, with a retry — it used to leave "No providers in
        // All" on screen, which reads as a vertical with nobody in it.
        setAll([])
        setLoadError(translatePortalText(e instanceof Error ? e.message : `Failed to load ${cfg.name} providers`))
      })
      .finally(() => { if (seq === loadSeq.current) setLoading(false) })
  }, [cfg.slug, cfg.kind, cfg.icon, cfg.hero, cfg.name])

  // A new vertical starts from a skeleton, not the last one's rows.
  useEffect(() => { setLoading(true); setAll([]); load() }, [load])

  // A plan change in the detail modal reloads the directory; the open modal
  // follows the reloaded row so its Billing Model and Package lines are not
  // left describing the plan they were just moved off.
  useEffect(() => {
    if (!detail) return
    const id = detail._id || detail.id
    const row = all.find(r => r.id === id)
    if (row && row.raw !== detail) setDetail(row.raw)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all])

  /**
   * What the server says happened, not what the button hoped would.
   *
   * Approve can land a subscriber on "awaiting payment" rather than live, and an
   * approval can succeed while the provider's marina/station/shop fails to be
   * created (`provisioningWarning`) — the toast used to say "now live" either way.
   */
  const approvalOutcome = (p: any, res: any, verb: 'approved' | 'reactivated') => {
    const status = res?.data?.user?.onboarding?.status
    const warning: string | undefined = res?.provisioningWarning
    const base = status === 'pending_subscription_payment'
      ? `${p.name} ${verb} — now awaiting provider subscription payment`
      : status === 'approved'
      ? `${p.name} ${verb} — now live`
      : `${p.name} ${verb}`
    return warning ? `${base}. But their listing could not be set up: ${warning}` : base
  }

  const sendReminder = (p: any) =>
    confirmAndRun({
      title: `Send Subscription Reminder to ${p.name}?`,
      body: `This will dispatch an urgent renewal push notification and email to ${p.owner} (${p.raw?.email || 'provider'}).`,
      input: {
        label: 'Custom message (optional)',
        placeholder: 'Leave blank to send standard automated renewal instructions...',
        required: false,
        multiline: true,
        maxLength: 300,
      },
      confirmLabel: 'Send Reminder',
      busyLabel: 'Sending...',
      run: async (customMsg) => {
        await adminApi.sendSubscriptionReminder(p.id, customMsg || undefined)
      },
      success: `Subscription reminder sent to ${p.name}`,
      error: 'Failed to send subscription reminder',
    })

  const [checkingId, setCheckingId] = useState<string | null>(null)

  /**
   * Approve, after looking at what is being approved.
   *
   * This was a one-click call. Approving also marks every document still
   * pending as approved (server-side), so a provider whose licence the AI had
   * flagged critical went live without the admin ever being told. The
   * registration is read first, and the dialog says what is wrong with the file
   * — or that it could not be checked — before anything is written. A provider
   * another admin has already decided on is refreshed instead of re-approved.
   */
  const approve = async (p: any) => {
    if (checkingId) return
    setCheckingId(p.id)
    const warnings: string[] = []
    let stale = false
    try {
      const r = await adminApi.getRegistration(p.id)
      const regStatus = r.data.registration?.status
      if (regStatus === 'approved' || regStatus === 'rejected') stale = true
      const counts = r.data.documentReview?.counts
      if (counts?.critical) warnings.push(`${counts.critical} critical AI finding${counts.critical === 1 ? '' : 's'} on their documents`)
      if (counts?.warning) warnings.push(`${counts.warning} AI warning${counts.warning === 1 ? '' : 's'} on their documents`)
      const outstanding = r.data.documentChecklist?.outstanding?.length ?? 0
      if (!p.isDiver && outstanding) warnings.push(`${outstanding} required document${outstanding === 1 ? '' : 's'} missing or rejected`)
      const pendingDocs = r.data.documents.filter(d => d.status === 'pending').length
      if (pendingDocs) warnings.push(`${pendingDocs} document${pendingDocs === 1 ? '' : 's'} not yet reviewed will be marked approved`)
    } catch {
      warnings.push('Their documents could not be checked just now')
    } finally {
      setCheckingId(null)
    }
    if (stale) {
      toast(translatePortalText(`${p.name} has already been decided on — refreshing the list`), 'warn')
      load()
      return
    }
    const res = await confirmAndRun({
      title: `Approve ${p.name}?`,
      body: warnings.length
        ? `Before you approve: ${warnings.join('; ')}. Open Documents to review them first.`
        : p.paymentModel === 'subscription'
        ? 'Their documents raised no AI findings. As a subscriber they go live once they pay.'
        : 'Their documents raised no AI findings. They go live straight away.',
      confirmLabel: warnings.length ? 'Approve anyway' : 'Approve',
      busyLabel: 'Approving...',
      danger: warnings.length > 0,
      run: () => adminApi.approve(p.id, { expectedStatus: p.onboardingStatus }),
      error: 'Could not approve this provider. Please try again.',
    })
    if (res) {
      const msg = approvalOutcome(p, res, 'approved')
      toast(translatePortalText(msg), (res as any).provisioningWarning ? 'warn' : 'success')
    }
    load()
  }
  // The old flow validated the reason *after* the prompt closed, so a too-short
  // answer lost the typed text and fired a toast. The dialog now blocks confirm
  // until a reason is entered, and keeps it on screen while the call runs.
  const reject = (p: any) =>
    confirmAndRun({
      title: `Reject ${p.name}?`,
      body: 'They stay unapproved and are told why, so they can correct and resubmit.',
      input: { label: 'Reason for rejection', placeholder: 'Shown to the provider', required: true, multiline: true, maxLength: 400 },
      confirmLabel: 'Reject',
      busyLabel: 'Rejecting...',
      danger: true,
      run: (reason) => adminApi.reject(p.id, reason, p.onboardingStatus),
      success: `${p.name} rejected`,
      error: 'Could not reject this provider. Please try again.',
    }).finally(() => load()) // the row kept its Approve button until a manual reload
  // One click used to suspend outright. It stops every listing taking bookings
  // and notifies the provider, so it asks first. (The API takes no reason.)
  const suspend = (p: any) =>
    confirmAndRun({
      title: `Suspend ${p.name}?`,
      body: 'Their listings stop taking bookings at once and they are notified. Existing bookings are not cancelled.',
      confirmLabel: 'Suspend',
      busyLabel: 'Suspending...',
      danger: true,
      run: () => adminApi.suspend(p.id),
      success: `${p.name} suspended`,
      error: 'Could not suspend this provider. Please try again.',
    }).finally(() => load())
  /*
    Reactivating is the approve endpoint — there is no separate reinstate. On a
    subscriber that restarts the paid period from today (or, unpaid, sends them
    to "awaiting payment"), and re-sends the welcome notice. Said in the dialog
    rather than discovered afterwards; the toast reports where they landed.
  */
  const reactivate = async (p: any) => {
    const res = await confirmAndRun({
      title: `Reactivate ${p.name}?`,
      body: p.paymentModel === 'subscription'
        ? 'This re-approves the account. A subscriber keeps the period they already paid for (a new one starts only if it has run out), or is asked to pay if they never did. Any document still pending is marked approved.'
        : 'This re-approves the account and their listings can take bookings again. Any document still pending is marked approved.',
      confirmLabel: 'Reactivate',
      busyLabel: 'Reactivating...',
      run: () => adminApi.approve(p.id, { expectedStatus: p.onboardingStatus }),
      error: 'Could not reactivate this provider. Please try again.',
    })
    if (res) toast(translatePortalText(approvalOutcome(p, res, 'reactivated')), (res as any).provisioningWarning ? 'warn' : 'success')
    load()
  }


  const byStatus = all.filter(p => {
    if (filter === 'All') return true
    if (filter === 'Expiring / Expired') return p.isExpiringSoon || p.isExpired || p.subStatus === 'expiring_soon' || p.subStatus === 'expired'
    return p.status === filter
  })

  /**
   * Search and filters sit *inside* the status chip, not beside it.
   *
   * The chips answer "which stage of the lifecycle"; these answer "which one".
   * Nesting them means picking Pending and then typing a name searches the pending
   * providers rather than silently jumping back to all of them.
   */
  const filterCfg: TableFiltersConfig<any> = useMemo(() => ({
    searchFields: (p) => [p.name, p.raw?.business?.businessNameAr, p.owner, p.raw?.email, p.raw?.phone, p.place, p.id, p.plan, cfg.slug === 'boat' ? (p.isDiver ? 'scuba diver' : 'boat charter') : undefined],
    filters: [
      ...(cfg.slug === 'boat' ? [{
        key: 'operatorType',
        label: 'Operator Type',
        options: [
          { value: 'all', label: 'All Operators' },
          { value: 'standard', label: '⛵ Boat Charter Provider' },
          { value: 'scuba_diver', label: '🤿 Scuba Diver' },
        ],
        get: (p: any) => (p.isDiver ? 'scuba_diver' : 'standard'),
      }] : []),
      // The model by name — a fixed-fee provider filed under "commission" here.
      { key: 'plan', label: 'Billing model', get: (p) => planModelLabel(p.raw?.onboarding) },
      { key: 'verified', label: 'Verification', get: (p) => (p.verified ? 'Verified' : 'Unverified') },
      {
        key: 'expiry',
        label: 'Subscription',
        options: [
          { value: 'expired', label: 'Expired' },
          { value: 'expiring', label: 'Expiring soon' },
          { value: 'healthy', label: 'In good standing' },
        ],
        get: (p) => (p.isExpired ? 'expired' : p.isExpiringSoon ? 'expiring' : 'healthy'),
      },
      {
        key: 'bookings',
        label: 'Activity',
        options: [
          { value: 'active', label: 'Has bookings' },
          { value: 'none', label: 'No bookings yet' },
        ],
        get: (p) => (p.bookings > 0 ? 'active' : 'none'),
      },
    ],
  }), [cfg.slug])
  const tf = useTableFilters(byStatus, filterCfg)
  const list = tf.pagedRows
  const revenue = all.reduce((s, p) => s + p.revenue, 0)
  const bookings = all.reduce((s, p) => s + p.bookings, 0)
  const kpis: [string, number, string, string][] = [
    [`${cfg.name} providers`, all.length, '🏢', ''],
    ...(cfg.slug === 'boat'
      ? [
          ['Boat Charters', all.filter(p => !p.isDiver).length, '⛵', ''],
          ['Scuba Divers', all.filter(p => p.isDiver).length, '🤿', ''],
        ] as [string, number, string, string][]
      : [
          ['Live & active', all.filter(p => p.status === 'Live' && !p.isExpired).length, '✅', ''],
          ['Expiring / Expired', all.filter(p => p.isExpiringSoon || p.isExpired).length, '⚠️', ''],
        ] as [string, number, string, string][]),
    ['Awaiting payment', all.filter(p => p.status === 'Awaiting Payment').length, '💳', ''],
  ]
  return (
    <PageWrap>
      <AdminHeader title={`${translatePortalText(cfg.provPlural)} — ${translatePortalText("Directory")}`} sub={`${translatePortalText("Approve, verify, suspend & monitor every")} ${translatePortalText(cfg.name)} ${translatePortalText("business securely")}`} icon={cfg.icon}
        actions={<>
          <ViewToggle view={view} onChange={setView} />
          {/* Generated no link. Invites are per-plan and are created on
              Packages & Pricing → Invite Links, where the code, expiry and
              usage limit are set. */}
          <button className="btn-admin" onClick={() => nav('/admin/subscriptions?tab=invites')}><Plus size={15} /> {translatePortalText("Invite provider")}</button>
        </>} />

      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
        {kpis.map(([l, v, icon, p], i) => (
          <motion.div key={l} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="card p-4 flex items-center gap-3">
            <span className="text-2xl">{icon}</span>
            <div><p className="font-display text-2xl font-extrabold text-deep-900">{loading || loadError ? '—' : <Counter value={v} prefix={p} />}</p><p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText(String(l))}</p></div>
          </motion.div>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {filters.map(f => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${filter === f ? 'bg-gradient-to-r from-emerald-600 to-teal-500 text-white shadow-glow' : 'bg-white text-slate-500 hover:text-deep-900'}`}>{translatePortalText(f)}</button>
        ))}
      </div>

      <TableToolbar
        state={tf}
        config={filterCfg}
        rows={byStatus}
        noun="providers"
        searchPlaceholder={translatePortalText(`Search ${cfg.name.toLowerCase()} providers by name, owner, email...`)}
      />

      {loadError && <LoadError message={loadError} onRetry={() => { setLoading(true); load() }} />}
      {/* The API returns at most 200 providers, newest submissions first. */}
      {!loading && all.length >= 200 && (
        <p className="mb-3 text-[11px] font-semibold text-amber-700">{translatePortalText('Showing the 200 most recent providers — older accounts are not loaded here.')}</p>
      )}

      {loading ? (
        view === 'card' ? <CardGridSkeleton count={6} /> : <TableSkeleton rows={6} cols={5} />
      ) : loadError ? null : view === 'card' ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((p, i) => (
            <motion.div key={p.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
              className={`card card-hover overflow-hidden ${p.status === 'Pending' ? 'ring-2 ring-amber-300' : p.status === 'Awaiting Payment' ? 'ring-2 ring-cyan-400' : p.status === 'Suspended' ? 'ring-1 ring-rose-200' : ''}`}>
              <div className="relative h-28">
                <Img src={p.image} className="h-full w-full" />
                <div className="absolute inset-0 bg-gradient-to-t from-deep-950/80 via-deep-950/20 to-transparent" />
                <div className="absolute bottom-2 start-3 flex items-center gap-2 text-white">
                  <span className="text-lg">{p.icon}</span>
                  <div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="font-display text-[15px] font-extrabold leading-tight">{p.name}</p>
                      {p.isDiver ? (
                        <span className="rounded-full bg-sky-500/90 px-2 py-0.5 text-[9px] font-black text-white shadow-sm backdrop-blur">
                          {translatePortalText("\n                          🤿 Scuba Diver\n                        ")}</span>
                      ) : cfg.slug === 'boat' ? (
                        <span className="rounded-full bg-emerald-600/90 px-2 py-0.5 text-[9px] font-bold text-white shadow-sm backdrop-blur">
                          {translatePortalText("\n                          ⛵ Charter\n                        ")}</span>
                      ) : null}
                    </div>
                    <p className="text-[10px] text-white/70">{p.isDiver ? translatePortalText('Scuba Diver · No docs required') : `${translatePortalText(p.kind)} ${translatePortalText('provider')}`} {translatePortalText(" · since ")}{p.joined}</p>
                  </div>
                </div>
                <span className="absolute end-2 top-2">
                  {p.status === 'Live' ? (
                    p.isExpired ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-600/90 px-2.5 py-0.5 text-[10px] font-extrabold text-white shadow-sm backdrop-blur">
                        <AlertOctagon size={10} /> {translatePortalText(" Expired (")}{formatAdminDayCount(p.daysUntilExpiry)})
                      </span>
                    ) : p.isExpiringSoon ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/90 px-2.5 py-0.5 text-[10px] font-extrabold text-white shadow-sm backdrop-blur animate-pulse">
                        <AlertTriangle size={10} /> {translatePortalText(" Expiring (")}{formatAdminDayCount(p.daysUntilExpiry)})
                      </span>
                    ) : (
                      <ABadge dot>{translatePortalText(p.status)}</ABadge>
                    )
                  ) : (
                    <ABadge dot={p.status === 'Awaiting Payment'}>{translatePortalText(p.status)}</ABadge>
                  )}
                </span>
              </div>
              <div className="p-4">
                <div className="flex items-center gap-2.5">
                  <img src={p.avatar} className="h-8 w-8 rounded-full object-cover" />
                  <div className="min-w-0 flex-1"><p className="flex items-center gap-1 truncate text-xs font-extrabold text-deep-900">{p.owner}{p.verified && <BadgeCheck size={12} className="text-emerald-500" />}</p><p className="truncate text-[10px] text-slate-400">{p.email}</p></div>
                  <ABadge truncate className="max-w-[55%] shrink-0">{p.plan}</ABadge>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-sand py-2"><p className="font-display text-sm font-extrabold text-deep-900">{p.revenue ? money(p.revenue) : '—'}</p><p className="text-[9px] font-bold uppercase text-slate-400">{translatePortalText("Revenue")}</p></div>
                  <div className="rounded-xl bg-sand py-2"><p className="font-display text-sm font-extrabold text-deep-900">{formatPortalNumber(p.bookings)}</p><p className="text-[9px] font-bold uppercase text-slate-400">{translatePortalText("Bookings")}</p></div>
                  <div className="rounded-xl bg-sand py-2"><p className="font-display text-sm font-extrabold text-deep-900">{p.rating ? `${formatPortalNumber(p.rating, { maximumFractionDigits: 1 })}★` : '—'}</p><p className="text-[9px] font-bold uppercase text-slate-400">{p.reviewCount ? `${formatPortalNumber(p.reviewCount)} ${translatePortalText(p.reviewCount === 1 ? 'review' : 'reviews')}` : translatePortalText("Rating")}</p></div>
                </div>
                <div className="mt-3 flex gap-1.5 border-t border-slate-100 pt-3">
                  {p.status === 'Pending' ? (<>
                    <button onClick={() => approve(p)} disabled={!!checkingId} className="btn-admin flex-1 !justify-center !py-1.5 !text-[11px] disabled:opacity-60"><Check size={12} /> {translatePortalText(checkingId === p.id ? 'Checking…' : 'Approve')}</button>
                    <button onClick={() => reject(p)} className="btn-ghost flex-1 !justify-center !py-1.5 !text-[11px] !text-rose-500"><X size={12} /> {translatePortalText("Reject")}</button>
                  </>) : p.status === 'Awaiting Payment' ? (<>
                    <button onClick={() => sendReminder(p)} className="btn-admin flex-1 !justify-center !py-1.5 !text-[11px] !bg-amber-600 !hover:bg-amber-700" title={translatePortalText("Remind provider to complete payment")}><Bell size={12} /> {translatePortalText("Remind")}</button>
                    <button onClick={() => reject(p)} className="btn-ghost !justify-center !py-1.5 !px-2.5 !text-[11px] !text-rose-500"><X size={12} /></button>
                  </>) : p.status === 'Rejected' || p.status === 'Incomplete' ? (
                    // Waiting on the provider (to correct and resubmit, or to finish),
                    // so there is nothing to approve, verify or suspend yet.
                    <p className="flex-1 text-center text-[11px] font-semibold text-slate-400">{translatePortalText(p.status === 'Rejected' ? 'Waiting for the provider to resubmit' : 'Application not submitted yet')}</p>
                  ) : p.status === 'Blocked' ? (
                    // A deactivated login. Approve and Suspend change the
                    // application, not the login, so neither would unblock it —
                    // they used to be offered here as if they would.
                    <p className="flex-1 text-center text-[11px] font-semibold text-slate-400">{translatePortalText('Account deactivated — restore it from Users')}</p>
                  ) : p.status === 'Suspended' ? (<>
                    <button onClick={() => reactivate(p)} className="btn-admin flex-1 !justify-center !py-1.5 !text-[11px]"><ShieldCheck size={12} /> {translatePortalText("Reactivate")}</button>
                    <button onClick={() => sendReminder(p)} className="btn-ghost !justify-center !py-1.5 !px-2 text-amber-600" title={translatePortalText("Send renewal reminder")}><Bell size={12} /></button>
                  </>) : (<>
                    {(p.isExpiringSoon || p.isExpired || p.paymentModel === 'subscription') && (
                      <button onClick={() => sendReminder(p)} className="btn-ghost !justify-center !py-1.5 !px-2 text-amber-600 hover:bg-amber-50" title={translatePortalText("Send subscription reminder")}><Bell size={12} /></button>
                    )}
                    {/* Called approve on a live provider, which restarts a
                        subscriber's paid period from today, marks every pending
                        document approved and re-sends the welcome notice.
                        Verifying is done document by document, so it opens them. */}
                    <button onClick={() => openDetail(p.raw)} className="btn-ghost flex-1 !justify-center !py-1.5 !text-[11px]" title={translatePortalText("Review and verify their documents")}><ShieldCheck size={12} /> {translatePortalText("Verify")}</button>
                    <button onClick={() => suspend(p)} className="btn-ghost flex-1 !justify-center !py-1.5 !text-[11px] !text-amber-600"><Ban size={12} /> {translatePortalText("Suspend")}</button>
                  </>)}
                  <button onClick={() => openDetail(p.raw)} className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200" title={translatePortalText("Documents")}><FileCheck2 size={13} /></button>
                </div>
              </div>
            </motion.div>
          ))}
          {list.length === 0 && (
            <div className="col-span-full rounded-2xl border border-dashed border-slate-200">
              {tf.activeCount > 0
                ? <NoFilterMatches noun="providers" onClear={tf.clear} />
                : <div className="py-14 text-center text-sm text-slate-400">{translatePortalText("No ")}{cfg.name.toLowerCase()} {translatePortalText(" providers in “")}{filter}”.</div>}
            </div>
          )}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto custom-scrollbar">
            <div className="min-w-[1050px]">
              <div className="grid grid-cols-[20fr_15fr_12fr_12fr_10fr_12fr_180px] items-center gap-4 border-b border-slate-100 bg-sand px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <span>{translatePortalText("Provider")}</span><span>{translatePortalText("Owner")}</span><span className="text-center">{translatePortalText("Plan")}</span><span className="text-right">{translatePortalText("Revenue")}</span><span className="text-center">{translatePortalText("Rating")}</span><span className="text-center">{translatePortalText("Status")}</span><span className="sticky end-0 z-[1] -my-3.5 bg-sand py-3.5 text-right">{translatePortalText("Actions")}</span>
              </div>
              {list.map((p, i) => (
                <motion.div key={p.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                  className="grid grid-cols-[20fr_15fr_12fr_12fr_10fr_12fr_180px] items-center gap-4 border-b border-slate-50 px-5 py-4 transition hover:bg-sand/70 last:border-b-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sand text-lg">{p.icon}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="truncate text-[13px] font-extrabold text-deep-900">{p.name}</p>
                        {p.isDiver ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-black text-sky-700 ring-1 ring-sky-300">
                            {translatePortalText("\n                            🤿 Scuba Diver\n                          ")}</span>
                        ) : cfg.slug === 'boat' ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200">
                            {translatePortalText("\n                            ⛵ Boat Charter\n                          ")}</span>
                        ) : null}
                      </div>
                      {/* Was the raw database id — nothing an admin can read or search by. */}
                      <p className="truncate text-[11px] text-slate-400">{formatPortalNumber(p.bookings)} {translatePortalText(p.bookings === 1 ? 'booking' : 'bookings')}{p.place ? ` · ${p.place}` : ''}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-600 min-w-0">
                    <img src={p.avatar} className="h-6 w-6 shrink-0 rounded-full object-cover ring-1 ring-slate-200" />
                    <span className="truncate">{p.owner}</span>{p.verified && <BadgeCheck size={12} className="shrink-0 text-emerald-500" />}
                  </div>
                  {/* Capped and truncating: each row is its own grid, so a long plan
                      name ("Expand Your Bunkering Reach: …") took its full width and
                      squeezed Provider and Owner to nothing. */}
                  <div className="flex items-center justify-center gap-1 whitespace-nowrap" title={packageTermMismatch(p.raw?.onboarding) ?? undefined}><ABadge truncate className="max-w-[14rem]">{p.plan}</ABadge>{packageTermMismatch(p.raw?.onboarding) && <AlertTriangle size={12} className="shrink-0 text-amber-500" />}</div>
                  <div className="text-right text-[13px] font-extrabold text-deep-900 whitespace-nowrap">{p.revenue ? money(p.revenue) : '—'}</div>
                  <div className="text-center text-xs font-bold text-emerald-600 whitespace-nowrap" title={p.reviewCount ? `${p.reviewCount} reviews` : undefined}>{p.rating ? `${formatPortalNumber(p.rating, { maximumFractionDigits: 1 })}★` : '—'}{p.reviewCount ? <span className="ms-1 text-[10px] font-semibold text-slate-400">({formatPortalNumber(p.reviewCount)})</span> : null}</div>
                  <div className="flex justify-center whitespace-nowrap">
                    {p.status === 'Live' ? (
                      p.paymentModel === 'commission' ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2.5 py-0.5 text-[11px] font-bold text-purple-700 ring-1 ring-purple-200">
                          {translatePortalText(p.planKind === 'fixed_fee' ? 'Live · Fixed fee' : 'Live · Comm.')}</span>
                      ) : p.isExpired ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 text-[11px] font-extrabold text-rose-800 ring-1 ring-rose-300">
                          <AlertOctagon size={11} /> {translatePortalText(" Expired (")}{formatAdminDayCount(p.daysUntilExpiry)})
                        </span>
                      ) : p.isExpiringSoon ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-extrabold text-amber-800 ring-1 ring-amber-300 animate-pulse">
                          <AlertTriangle size={11} /> {translatePortalText(" Expiring (")}{formatAdminDayCount(p.daysUntilExpiry)})
                        </span>
                      ) : (
                        // The date behind the day count, so "Active (321d)" can be
                        // checked against the package's term at a glance.
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-200" title={p.subscriptionExpiry ? `${translatePortalText('Paid until')} ${formatPortalDate(new Date(p.subscriptionExpiry))}` : undefined}>
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {translatePortalText(" Active ")}{p.daysUntilExpiry !== null ? `(${formatAdminDayCount(p.daysUntilExpiry)})` : ''}
                        </span>
                      )
                    ) : p.status === 'Awaiting Payment' ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-cyan-50 px-2.5 py-0.5 text-[11px] font-bold text-cyan-700 ring-1 ring-cyan-300">
                        {translatePortalText("\n                        Awaiting Payment\n                      ")}</span>
                    ) : (
                      <ABadge dot={p.status === 'Live'}>{translatePortalText(p.status)}</ABadge>
                    )}
                  </div>
                  <div className="sticky end-0 z-[1] flex justify-end gap-1.5 whitespace-nowrap bg-white ps-2 shadow-[-12px_0_12px_-12px_rgba(15,23,42,0.18)]">
                    {p.status === 'Pending' ? (<>
                      <button onClick={() => approve(p)} disabled={!!checkingId} className="btn-admin !py-1.5 !px-2.5 !text-[11px] disabled:opacity-60"><Check size={12} /> {translatePortalText(checkingId === p.id ? 'Checking…' : 'Approve')}</button>
                      <button onClick={() => reject(p)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-rose-50 text-rose-500 hover:bg-rose-100" title={translatePortalText("Reject")}><X size={13} /></button>
                    </>) : p.status === 'Awaiting Payment' ? (<>
                      <button onClick={() => sendReminder(p)} className="btn-admin !py-1.5 !px-2.5 !text-[11px] !bg-amber-600 !hover:bg-amber-700" title={translatePortalText("Send payment reminder")}><Bell size={12} /> {translatePortalText("Remind")}</button>
                      <button onClick={() => reject(p)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-rose-50 text-rose-500 hover:bg-rose-100" title={translatePortalText("Reject")}><X size={13} /></button>
                    </>) : p.status === 'Rejected' || p.status === 'Incomplete' ? (
                      <span className="text-[11px] font-semibold text-slate-400">{translatePortalText(p.status === 'Rejected' ? 'Waiting for resubmission' : 'Not submitted')}</span>
                    ) : p.status === 'Blocked' ? (
                      // See the card view: neither action would restore the login.
                      <span className="text-[11px] font-semibold text-slate-400" title={translatePortalText('Account deactivated — restore it from Users')}>{translatePortalText('Account deactivated')}</span>
                    ) : p.status === 'Suspended' ? (<>
                      <button onClick={() => reactivate(p)} className="btn-admin !py-1.5 !px-2.5 !text-[11px]"><ShieldCheck size={12} /> {translatePortalText(" Reactivate")}</button>
                      <button onClick={() => sendReminder(p)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-600 hover:bg-amber-100" title={translatePortalText("Send reminder")}><Bell size={13} /></button>
                    </>) : (<>
                      {(p.isExpiringSoon || p.isExpired || p.paymentModel === 'subscription') && (
                        <button onClick={() => sendReminder(p)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100" title={translatePortalText("Send subscription reminder")}><Bell size={13} /></button>
                      )}
                      {/* Opens the documents — see the card view for why it no longer re-approves. */}
                      <button onClick={() => openDetail(p.raw)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100" title={translatePortalText("Review and verify their documents")}><ShieldCheck size={13} /></button>
                      <button onClick={() => suspend(p)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-600 hover:bg-amber-100" title={translatePortalText("Suspend")}><Ban size={13} /></button>
                    </>)}
                    <button onClick={() => openDetail(p.raw)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200" title={translatePortalText("Documents")}><FileCheck2 size={13} /></button>
                  </div>
                </motion.div>
              ))}
              {list.length === 0 && (tf.activeCount > 0
                ? <NoFilterMatches noun="providers" onClear={tf.clear} />
                : <div className="py-14 text-center text-sm text-slate-400">{translatePortalText("No ")}{cfg.name.toLowerCase()} {translatePortalText(" providers in “")}{filter}”.</div>)}
            </div>
          </div>
          <TablePagination state={tf} noun="providers" />
        </div>
      )}

      {/* detail modal */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? `${detail.business?.businessName || detail.name}` : ''} wide>
        {detail && (
          <div className="space-y-4 text-sm">
            {/* Everything about this provider — listings, bookings, money,
                documents — on one page, with Excel/CSV/PDF download. */}
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700">
                  <FileText size={18} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-extrabold text-emerald-950">{translatePortalText("Provider report")}</p>
                  <p className="text-[11px] text-emerald-800">{translatePortalText("Listings, bookings, money, documents and reviews — ready to download.")}</p>
                </div>
              </div>
              <button
                onClick={() => nav(`/admin/reports/provider-profile?provider=${encodeURIComponent(detail._id || detail.id)}`)}
                className="btn-admin !py-1.5 !px-3 !text-xs shrink-0"
              >
                <ExternalLink size={13} className="me-1" /> {translatePortalText("Open report")}
              </button>
            </div>

            {/* Plan & pricing: what they are on, what they pay right now and
                why, any scheduled change and their offers — with Change plan
                and Give discount / offer. Replaces the "Subscription &
                Lifecycle Health" card, keeping its reminder and its line of
                model / status / expiry. A change reloads the directory row. */}
            {detail && (
              <PlanPricingPanel
                providerId={detail._id || detail.id}
                onChanged={() => { void load() }}
                facts={<>
                  {/* No `|| 'subscription'` / `|| 'approved'`: an account with
                      no onboarding record was shown as an approved subscriber. */}
                  {translatePortalText("Model:")} <span className="font-bold">{translatePortalText(planModelLabel(detail.onboarding))}</span> · {translatePortalText("Status:")} <span className="font-bold">{translatePortalText((detail.onboarding?.status || 'incomplete').replace(/_/g, ' '))}</span>
                  {detail.onboarding?.subscriptionExpiry ? ` · ${translatePortalText('Expires:')} ${formatPortalDate(new Date(detail.onboarding.subscriptionExpiry))}` : ''}
                </>}
                actions={
                  <button
                    onClick={() => sendReminder({ id: detail._id || detail.id, name: detail.business?.businessName || detail.name, owner: detail.name, raw: detail })}
                    className="btn-admin !py-1.5 !px-3 !text-xs !bg-amber-600 hover:!bg-amber-700 shrink-0"
                  >
                    <Bell size={13} className="me-1" /> {translatePortalText("Send Reminder")}
                  </button>
                }
              />
            )}

            {cfg.slug === 'boat' && (
              detail.providerKind === 'scuba_diver' ? (
                <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3.5 flex items-center gap-3">
                  <span className="text-2xl">🤿</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-extrabold text-sky-950">{translatePortalText("Scuba Diver Operator Account")}</p>
                    <p className="text-[11px] text-sky-700">
                      {translatePortalText("Document-free account · Permitted to create diving trips and excursions only. No commercial boat registry or commercial trade licence documents are required.")}
                    </p>
                  </div>
                  <span className="rounded-full bg-sky-600 px-2.5 py-0.5 text-[10px] font-black text-white shrink-0 shadow-sm">
                    {translatePortalText("Scuba Diver")}
                  </span>
                </div>
              ) : (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5 flex items-center gap-3">
                  <span className="text-2xl">⛵</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-extrabold text-emerald-950">{translatePortalText("Standard Boat Charter Provider")}</p>
                    <p className="text-[11px] text-emerald-700">
                      {translatePortalText("Commercial charter provider with full document verification (Trade Licence, Registration, Commercial Marine Insurance).")}
                    </p>
                  </div>
                  <span className="rounded-full bg-emerald-600 px-2.5 py-0.5 text-[10px] font-bold text-white shrink-0 shadow-sm">
                    {translatePortalText("Boat Charter")}
                  </span>
                </div>
              )
            )}

            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                ['Owner', detail.name], ['Email', detail.email],
                ['Business Name', detail.business?.businessName || '—'],
                ['Operator Type', detail.providerKind === 'scuba_diver' ? '🤿 Scuba Diver (No docs)' : (cfg.slug === 'boat' ? '⛵ Boat Charter Provider' : (detail.role || '').replace(/_/g, ' '))],
                ['Phone', detail.business?.contactNumber || '—'],
                ['Country', detail.business?.country || '—'], ['City', placeLabel(detail.business?.city) || '—'],
                ['Billing Model', planModelLabel(detail.onboarding)],
                ['Package', [providerPlanLabel(detail.onboarding), packageTermMismatch(detail.onboarding)].filter(Boolean).join(' — ')],
                ['Provider Role', (detail.onboarding?.providerType || detail.role || '').replace(/_/g, ' ')],
                ['Status', detail.onboarding?.status || 'incomplete'],
                ['Submitted', detail.onboarding?.submittedAt ? formatPortalDate(new Date(detail.onboarding.submittedAt)) : '—'],
                // A diver holds no paperwork at all, so the question never applies.
                ...(detail.providerKind === 'scuba_diver' ? [] : [['VAT certificate', vatCertificateLabel(detail.business?.hasVatCertificate ?? registration?.business?.hasVatCertificate)]]),
              ].map(([l, v]) => (
                <div key={l as string} className="rounded-xl bg-sand px-3 py-2.5"><p className="text-[10px] font-bold uppercase text-slate-400">{translatePortalText(l)}</p><p className="font-bold text-deep-900 break-all">{translatePortalText(String(v))}</p></div>
              ))}
            </div>
            {/* A pin saved as the address is said to be one, with its numbers
                beside it for whoever needs to look it up. */}
            {detail.business?.address && <div><p className="label">{translatePortalText("Address")}</p><p className="rounded-xl border border-slate-100 p-3 text-slate-600">{isCoordinateText(detail.business.address) ? <>{translatePortalText('Location pinned on the map — no street address')} <span className="ms-1 font-mono text-[11px] text-slate-400" dir="ltr">{detail.business.address}</span></> : detail.business.address}</p></div>}
            {detail.business?.description && <div><p className="label">{translatePortalText("About")}</p><p className="rounded-xl border border-slate-100 p-3 text-slate-600">{detail.business.description}</p></div>}

            {regLoading && <p className="text-xs text-slate-400">{translatePortalText("Loading full registration…")}</p>}
            {regError && <LoadError message={regError} onRetry={() => openDetail(detail)} />}

            {registration && (
              <div className="space-y-3 border-t border-slate-100 pt-4">
                <p className="label">{translatePortalText("Full registration")} ({translatePortalText(registration.status)})</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    ['Business type', registration.business?.category], ['CR number', registration.business?.crNumber],
                    ['VAT number', registration.business?.vatNumber], ['Region', registration.entity?.region],
                    ['Capacity — pontoons', registration.capacity?.numPontoons], ['Capacity — berths', registration.capacity?.totalBerths],
                    ['Payment model', registration.payment?.billingModel],
                    // Present only when the provider came in on an admin's
                    // link, and the one field that explains why they were
                    // never asked to pick a plan.
                    ['Invite plan code', registration.payment?.inviteCode],
                    ['Bank', registration.bank?.bankName],
                    ['Emergency contact', registration.emergency?.contactNumber], ['Responsible person', registration.emergency?.responsiblePersonName],
                  ].filter(([, v]) => v !== undefined && v !== null && v !== '').map(([l, v]) => (
                    <div key={l as string} className="rounded-xl bg-sand px-3 py-2.5"><p className="text-[10px] font-bold uppercase text-slate-400">{l}</p><p className="font-bold text-deep-900">{String(v)}</p></div>
                  ))}
                </div>
              </div>
            )}

            {!regLoading && !regError && (() => {
              const groupedDocs: Record<string, any[]> = {};
              regDocs.forEach(d => {
                const type = d.docType || 'other';
                if (!groupedDocs[type]) groupedDocs[type] = [];
                groupedDocs[type].push(d);
              });
              const docTypes = Object.keys(groupedDocs);
              
              return (
                <div className="space-y-3 border-t border-slate-100 pt-4">
                  {/* `detail` is the API record, which has no `isDiver` — that is
                      on the directory row — so divers were shown a checklist of
                      documents they never owe. */}
                  {detail.providerKind !== 'scuba_diver' && <RequiredDocsChecklist checklist={docChecklist} />}
                  <DocumentFindingsSummary review={docReview} />
                  <div className="flex items-center justify-between">
                    <p className="label">{translatePortalText("Verification Documents")} ({formatPortalNumber(regDocs.length)})</p>
                    <span className="text-[11px] font-bold text-slate-400">{formatPortalNumber(docTypes.length)} {translatePortalText("types submitted")}</span>
                  </div>
                  <div className="space-y-3">
                    {docTypes.map(type => {
                      const docs = groupedDocs[type];
                      const latest = docs[0];
                      const history = docs.slice(1);
                      const isExpanded = expandedDocTypes[type];
                      const isPdf = latest.fileUrl?.toLowerCase().endsWith('.pdf') || latest.fileName?.toLowerCase().endsWith('.pdf');
                      
                      return (
                        <div key={type} className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
                          <div className="p-3.5 bg-sand/60 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white border border-slate-200 text-teal-600 shadow-2xs">
                                <FileText size={16} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <a href={fileUrl(latest.fileUrl)} target="_blank" rel="noreferrer" className="truncate font-extrabold text-[13px] text-deep-900 hover:text-teal-600 flex items-center gap-1">
                                    {latest.label || latest.docType.replace(/_/g, ' ')}
                                    <ExternalLink size={12} className="text-slate-400" />
                                  </a>
                                  <ABadge dot={latest.status === 'approved'}>{translatePortalText(latest.status.replace(/_/g, ' '))}</ABadge>
                                </div>
                                <p className="text-[11px] text-slate-400 truncate">
                                  {latest.fileName || 'Document upload'} {latest.uploadedAt ? `· ${formatPortalDate(new Date(latest.uploadedAt))}` : ''}
                                </p>
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-1.5 shrink-0">
                              {latest.confidence != null && (
                                <span className="inline-flex items-center gap-1 rounded-lg bg-teal-50 px-2 py-1 text-[11px] font-extrabold text-teal-700">
                                  <Sparkles size={11} /> {formatPortalPercent(latest.confidence)} {translatePortalText("AI\n                                ")}</span>
                              )}
                              {latest.aiDocumentId && (
                                <button
                                  onClick={async () => {
                                    try {
                                      const res = await aiDocumentApi.get(latest.aiDocumentId);
                                      setAiDoc(res.data.document);
                                    } catch {
                                      toast(translatePortalText('Could not load AI details for this document'), 'warn');
                                    }
                                  }}
                                  className="btn-ghost !py-1 !px-2.5 !text-[11px] !text-teal-700 bg-white border border-teal-200 hover:bg-teal-50"
                                >
                                  <Sparkles size={12} /> {translatePortalText("Inspect AI")}
                                </button>
                              )}
                              {latest.status === 'pending' && (
                                <>
                                  <button onClick={() => verifyDoc(latest._id, 'approved')} className="btn-admin !py-1 !px-2.5 !text-[11px]"><Check size={12} /> {translatePortalText(" Approve")}</button>
                                  {/* Neither approve nor reject: reopens the step with a reason. */}
                                  <button
                                    onClick={() => setReuploadFor({ id: latest._id, label: latest.label || latest.docType.replace(/_/g, ' '), provider: detail?.business?.businessName || detail?.name })}
                                    className="btn-ghost !py-1 !px-2.5 !text-[11px] !text-amber-600 border border-amber-200 bg-white hover:!bg-amber-50"
                                    title={translatePortalText("Ask the provider to upload this one again")}
                                  >
                                    <BellRing size={12} /> {translatePortalText("Ask again")}
                                  </button>
                                  <button onClick={() => verifyDoc(latest._id, 'rejected')} className="btn-ghost !py-1 !px-2 !text-[11px] !text-rose-500 hover:!bg-rose-50"><X size={12} /></button>
                                </>
                              )}
                              {history.length > 0 && (
                                <button onClick={() => toggleDocHistory(type)} className="btn-ghost !py-1 !px-2 !text-[11px]">
                                  {formatPortalNumber(history.length)} {translatePortalText("Past")} <Eye size={11} />
                                </button>
                              )}
                            </div>
                          </div>

                          {/* AI Flags / Feedback Alert */}
                          {/* Every finding on this document, with the reasoning
                              behind each. Was a single line of headline, which
                              told a reviewer that something was wrong and
                              nothing about what. */}
                          <DocumentFindingList
                            findings={latest.aiFlags}
                            severity={latest.aiSeverity}
                            acknowledgedAt={latest.acknowledgedAt}
                            acknowledgedNote={latest.acknowledgedNote}
                            defaultOpen={latest.aiSeverity === 'critical'}
                          />
                          {!latest.aiFlags?.length && latest.aiFeedback && (
                            <div className="mx-3.5 mt-3 flex items-start gap-2 rounded-xl bg-amber-50/80 border border-amber-200 p-2.5 text-[11.5px] text-amber-800">
                              <AlertTriangle size={14} className="shrink-0 text-amber-600 mt-0.5" />
                              <div className="flex-1">
                                <strong className="font-bold">{translatePortalText("AI Flag:")}</strong> {latest.aiFeedback}
                              </div>
                            </div>
                          )}

                          {/* Extracted Fields Summary */}
                          {latest.extractedFields && Object.keys(latest.extractedFields).length > 0 && (
                            <div className="p-3.5 grid grid-cols-2 sm:grid-cols-3 gap-2 bg-slate-50/50">
                              {Object.entries(latest.extractedFields).map(([k, f]: [string, any]) => {
                                const val = typeof f === 'object' && f !== null ? f.value : f;
                                if (!val) return null;
                                return (
                                  <div key={k} className="rounded-xl bg-white border border-slate-100 p-2 text-xs">
                                    <p className="text-[10px] font-bold uppercase text-slate-400 truncate">{f?.label || k.replace(/_/g, ' ')}</p>
                                    <p className="font-extrabold text-deep-900 truncate mt-0.5">{String(val)}</p>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* Preview Link / Direct Image Preview */}
                          <div className="px-3.5 py-2.5 bg-white border-t border-slate-100 flex items-center justify-between text-xs">
                            <span className="text-slate-400 font-medium">{translatePortalText(isPdf ? 'PDF Document' : 'Image Scan')}</span>
                            <a
                              href={fileUrl(latest.fileUrl)}
                              target="_blank"
                              rel="noreferrer"
                              className="font-bold text-teal-600 hover:text-teal-700 flex items-center gap-1"
                            >
                              {translatePortalText("View Full Document")} <ExternalLink size={12} />
                            </a>
                          </div>

                          {/* History / Previous Revisions */}
                          {isExpanded && history.length > 0 && (
                            <div className="p-3 bg-slate-100/70 border-t border-slate-200 space-y-2">
                              <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">{translatePortalText("Previous Versions")}</p>
                              {history.map((hd, i) => (
                                <div key={hd._id} className="flex items-center justify-between rounded-xl bg-white p-2.5 text-[11px] border border-slate-200">
                                  <a href={fileUrl(hd.fileUrl)} target="_blank" rel="noreferrer" className="font-bold text-deep-900 hover:text-teal-600 flex items-center gap-2">
                                    <span>{translatePortalText("Version")} {formatPortalNumber(history.length - i)}</span>
                                    <ABadge>{translatePortalText(hd.status.replace(/_/g, ' '))}</ABadge>
                                  </a>
                                  <span className="text-slate-500 text-[10.5px] truncate max-w-[250px]">{hd.aiFeedback || hd.rejectionReason || 'Superseded'}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {docTypes.length === 0 && (
                      detail?.providerKind === 'scuba_diver' ? (
                        <div className="rounded-2xl border border-dashed border-sky-200 bg-sky-50/50 py-8 px-4 text-center">
                          <span className="text-2xl">🤿</span>
                          <p className="mt-1 text-xs font-bold text-sky-900">{translatePortalText("Document-Free Scuba Diver Operator")}</p>
                          <p className="mt-0.5 text-[11px] text-sky-600 max-w-sm mx-auto">
                            {translatePortalText("As per platform policy for diving providers, trade licence and vessel registry documents are not required.")}
                          </p>
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-dashed border-slate-200 py-8 text-center text-xs text-slate-400">
                          {translatePortalText("No verification documents uploaded for this provider yet.")}
                        </div>
                      )
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </Modal>

      {/* Ask the provider for one document again — see RequestReuploadModal. */}
      {reuploadFor && (
        <RequestReuploadModal
          documentId={reuploadFor.id}
          documentLabel={reuploadFor.label}
          providerName={reuploadFor.provider}
          isOpen={!!reuploadFor}
          onClose={() => setReuploadFor(null)}
          onSent={() => { if (detail) openDetail(detail); load() }}
        />
      )}

      {/* AI Document Deep Inspection Modal */}
      {aiDoc && (
        <AiDocumentVerificationModal
          document={aiDoc}
          isOpen={!!aiDoc}
          onClose={() => setAiDoc(null)}
          onStatusUpdated={(updated) => {
            setAiDoc(updated);
            if (detail) openDetail(detail);
          }}
        />
      )}

    </PageWrap>
  )
}

// ══════════ PROVIDER LISTINGS (kind-specific) ══════════
function providerName(p: any): string {
  if (!p) return 'Unknown provider'
  // A bare id means the owner was not populated — never print it as a name.
  if (typeof p === 'string') return 'Unknown provider'
  return p.business?.businessName || p.name || 'Unknown provider'
}

/**
 * Where a boat stands, from both of its states.
 *
 * `approvalStatus` is whether BoatPro has approved it; `status` is whether the
 * owner is running it. The list read only the second, so a boat still waiting
 * for approval showed as "Approved".
 */
type BoatListingState = 'Listed' | 'Taken down' | 'Pending approval' | 'Draft' | 'Rejected'
function boatListingState(b: any): BoatListingState {
  if (b.approvalStatus === 'pending') return 'Pending approval'
  if (b.approvalStatus === 'draft') return 'Draft'
  if (b.approvalStatus === 'rejected') return 'Rejected'
  return b.status === 'out_of_service' ? 'Taken down' : 'Listed'
}

/**
 * Where a marina stands, from all three of its switches.
 *
 * Customers see a marina only when it is approved, published and active
 * (`listMarinas`). The list read `isActive` alone — true by default — so a
 * marina still waiting for review showed as "Approved"; and its Verify button
 * set `isActive`, which approves nothing. "Unpublished" is the owner's own
 * choice, taken on their side.
 */
type MarinaListingState = BoatListingState | 'Unpublished'
function marinaListingState(m: any): MarinaListingState {
  if (m.approvalStatus === 'pending') return 'Pending approval'
  if (m.approvalStatus === 'rejected') return 'Rejected'
  if (m.approvalStatus !== 'approved') return 'Draft'
  if (!m.isActive) return 'Taken down'
  return m.isPublished ? 'Listed' : 'Unpublished'
}

/**
 * What an admin can do to a listing from here: take a listed one down, or
 * relist one they took down. Approval is decided on the vertical's Approvals
 * page, where the documents are — so an unapproved listing links there.
 */
function ListingActions({ state, onListed, reviewPath, hideHint, busy }: {
  state: MarinaListingState; onListed: (listed: boolean) => void; reviewPath: string; hideHint: string; busy?: boolean
}) {
  const nav = useNavigate()
  if (state === 'Listed') {
    return (
      <button onClick={() => onListed(false)} disabled={busy} className="btn-ghost !py-1.5 !px-2.5 !text-[11px] !text-rose-500 disabled:opacity-60" title={translatePortalText(hideHint)}>
        <Ban size={12} /> {translatePortalText('Take down')}
      </button>
    )
  }
  if (state === 'Taken down') {
    return <button onClick={() => onListed(true)} disabled={busy} className="btn-admin !py-1.5 !px-2.5 !text-[11px] disabled:opacity-60"><RotateCcw size={12} /> {translatePortalText('Relist')}</button>
  }
  if (state === 'Unpublished') return null
  return (
    <button onClick={() => nav(reviewPath)} className="btn-ghost !py-1.5 !px-2.5 !text-[11px]">
      <Eye size={12} /> {translatePortalText('Review')}
    </button>
  )
}

/**
 * Where a fuel station stands. "Online" read `isActive` alone, so a station
 * waiting for review, or a draft the ordering endpoints refuse, showed as
 * online beside the approved ones.
 */
function fuelStationState(s: any): MarinaListingState {
  if (s.approvalStatus === 'pending') return 'Pending approval'
  if (s.approvalStatus === 'rejected') return 'Rejected'
  if (s.approvalStatus !== 'approved') return 'Draft'
  return s.isActive ? 'Listed' : 'Taken down'
}

/** "from SAR 3.85 / L" — each catalogue product is priced in its own unit. */
function fuelPriceLabel(s: any): string {
  const fuels: { price: number; unit: string }[] = s.fuels ?? []
  if (!fuels.length) return '—'
  const cheapest = fuels.reduce((a, b) => (b.price < a.price ? b : a))
  return `${fuels.length > 1 ? `${translatePortalText('from')} ` : ''}${money(cheapest.price)} / ${cheapest.unit}`
}

function fuelNamesLabel(s: any): string {
  const fuels: { name: string }[] = s.fuels ?? []
  return fuels.length ? fuels.map(f => translatePortalText(f.name)).join(', ') : translatePortalText('No fuels listed')
}

/** The station's owner, or that the account behind it is gone. */
function stationProviderLabel(s: any): { text: string; missing: boolean } {
  if (s.providerMissing) return { text: translatePortalText('Provider account deleted'), missing: true }
  return { text: providerName(s.provider), missing: false }
}

/** A service's starting price; 0 is "the workshop never set one", not free. */
function servicePriceLabel(s: any): string {
  return s.priceFrom ? `${translatePortalText('from')} ${money(s.priceFrom)}` : translatePortalText('Not priced')
}

/** "12 of 40 occupied", "No berths yet" — both berth inventories, see `listListings`. */
function marinaBerthsLabel(m: any): string {
  const total = m.berthCount ?? 0
  if (!total) return translatePortalText('No berths yet')
  return `${formatPortalNumber(m.occupiedBerths ?? 0)} ${translatePortalText('of')} ${formatPortalNumber(total)} ${translatePortalText('occupied')}`
}

function ratingLabel(x: any): string {
  if (!x.rating) return '—'
  return `${formatPortalNumber(x.rating, { maximumFractionDigits: 1 })}★${x.reviewCount ? ` (${formatPortalNumber(x.reviewCount)})` : ''}`
}

/** "3 live · 5 trips", "No trips" — a boat has no price of its own; its trips do. */
function boatTripsLabel(b: any): string {
  const total = b.totalTrips ?? 0
  if (!total) return translatePortalText('No trips')
  return `${formatPortalNumber(b.activeTrips ?? 0)} ${translatePortalText('live')} · ${formatPortalNumber(total)} ${translatePortalText(total === 1 ? 'trip' : 'trips')}`
}

export function ProviderListings({ cfg }: { cfg: DomainCfg }) {
  const [view, setView] = useState<'card' | 'table'>('table')
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // The API pages at 100. Only the first page was ever read, with nothing to
  // say there were more — a vertical's 101st listing simply did not exist here.
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [moreLoading, setMoreLoading] = useState(false)
  const loadSeq = useRef(0)

  const typeParam = cfg.kind === 'Boat' ? 'boat' : cfg.kind === 'Marina' ? 'marina' : cfg.kind === 'Fuel' ? 'fuel' : 'maintenance-catalogue'

  /** Pages 1..`upTo`, so a refresh after an action keeps what was scrolled to. */
  const load = useCallback(async (upTo = 1) => {
    const seq = ++loadSeq.current
    setLoadError(null)
    try {
      const pages = await Promise.all(Array.from({ length: upTo }, (_, i) => adminPortalApi.listings({ type: typeParam, limit: 100, page: i + 1 })))
      if (seq !== loadSeq.current) return
      setItems(pages.flatMap(r => r.data.items))
      setTotal(pages[0]?.data.pagination?.total ?? 0)
      setPage(upTo)
    } catch (e) {
      if (seq !== loadSeq.current) return
      // An error, said as one — it used to fall through to "No … yet.".
      setLoadError(translatePortalText(e instanceof Error ? e.message : `Could not load ${cfg.listLabel}`))
    } finally {
      if (seq === loadSeq.current) { setLoading(false); setMoreLoading(false) }
    }
  }, [typeParam, cfg.listLabel])
  useEffect(() => { setLoading(true); setItems([]); setTotal(0); load(1) }, [load])

  /*
    Take down / relist, asked first and run once.

    These hide a listing from every customer, and fired on a single click with
    nothing to stop a second one — two quick clicks sent two requests and two
    toasts. Relisting is the undo, so it does not ask; taking down does.
  */
  const [busyId, setBusyId] = useState<string | null>(null)
  const runListingChange = async (id: string, call: () => Promise<unknown>, done: string, failed: string, warn: boolean) => {
    if (busyId) return
    setBusyId(id)
    try {
      await call()
      toast(done, warn ? 'warn' : undefined)
      load(page)
    } catch (e) {
      toast(translatePortalText(e instanceof Error && e.message ? e.message : failed), 'warn')
      load(page) // the row may have changed under us
    } finally {
      setBusyId(null)
    }
  }
  const confirmTakeDown = (name: string, run: () => Promise<unknown>) =>
    confirmAndRun({
      title: `Take down ${name}?`,
      body: 'Customers stop seeing it and cannot book it until it is relisted. Existing bookings are kept.',
      confirmLabel: 'Take down',
      busyLabel: 'Taking down...',
      danger: true,
      run,
      error: 'Could not take this listing down. Please try again.',
    })

  // Taking a boat down is operational (`status`), not an approval decision —
  // those are made on Boat Approvals. It used to read "rejected" / "approved".
  // The "Feature" toggle that sat beside it is gone: `Boat.featured` is read by
  // no customer screen; paid promotion is Featured Listings.
  const setBoatStatus = (b: any, status: 'active' | 'out_of_service') => {
    const call = () => adminPortalApi.updateBoatListing(b.id || b._id, { status })
    if (status === 'active') return runListingChange(b.id || b._id, call, translatePortalTemplate('{{name}} is listed again', { name: b.name }), 'Could not update listing', false)
    confirmTakeDown(b.name, call).then(r => { if (r) { toast(translatePortalTemplate('{{name}} taken down', { name: b.name }), 'warn') } load(page) })
  }
  // Taking a marina down or relisting it is `isActive`. Verifying one is not —
  // that is Marina Approvals, which checks it is complete and publishes it.
  const setMarinaListed = (m: any, listed: boolean) => {
    const call = () => adminPortalApi.updateMarinaListing(m.id || m._id, { isActive: listed })
    if (listed) return runListingChange(m.id || m._id, call, translatePortalTemplate('{{name}} is listed again', { name: m.name }), 'Could not update listing', false)
    confirmTakeDown(m.name, call).then(r => { if (r) { toast(translatePortalTemplate('{{name}} taken down', { name: m.name }), 'warn') } load(page) })
  }
  // Take down / relist is `isActive`; approving a station is Station Approvals.
  const setStationListed = (s: any, listed: boolean) => {
    const call = () => adminPortalApi.updateFuelStationListing(s._id || s.id, { isActive: listed })
    if (listed) return runListingChange(s._id || s.id, call, translatePortalTemplate('{{name}} is listed again', { name: s.name }), 'Could not update station', false)
    confirmTakeDown(s.name, call).then(r => { if (r) { toast(translatePortalTemplate('{{name}} taken down', { name: s.name }), 'warn') } load(page) })
  }
  const toggleServiceStatus = (s: any) => {
    const next = s.status === 'active' ? 'paused' : 'active'
    runListingChange(s._id || s.id, () => adminPortalApi.updateMaintenanceServiceListing(s._id || s.id, { status: next }), translatePortalText(`${s.name} ${next === 'paused' ? 'paused' : 'activated'}`), 'Could not update service', next === 'paused')
  }

  if (loading) return <PageWrap><AdminHeader title={translatePortalText(cfg.listLabel)} sub={translatePortalText(cfg.listSub)} icon={cfg.icon} /><CardGridSkeleton count={6} /></PageWrap>

  return (
    <PageWrap>
      <AdminHeader title={cfg.listLabel} sub={cfg.listSub} icon={cfg.icon}
        actions={<ViewToggle view={view} onChange={setView} />} />

      {loadError && <LoadError message={loadError} onRetry={() => { setLoading(true); load(1) }} />}
      {!loadError && items.length === 0 && <div className="rounded-2xl border border-dashed border-slate-200 py-14 text-center text-sm text-slate-400">{translatePortalText("No ")}{cfg.listLabel.toLowerCase()} {translatePortalText(" yet.")}</div>}

      {/* ── BOAT ── */}
      {cfg.kind === 'Boat' && items.length > 0 && view === 'card' && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((b, i) => {
            const state = boatListingState(b)
            return (
            <motion.div key={b.id || b._id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="card card-hover overflow-hidden">
              <div className="relative h-36">
                <Img src={b.images?.[0] || listingPhoto(b.name, 'boat')} className="h-full w-full" />
                <div className="absolute inset-0 bg-gradient-to-t from-deep-950/80 via-deep-950/15 to-transparent" />
                <span className="absolute end-2 top-2"><ABadge dot={state !== 'Listed'}>{translatePortalText(state)}</ABadge></span>
                <div className="absolute bottom-2 start-3 text-white">
                  <p className="font-display text-[16px] font-extrabold">{b.name} <span className="text-[11px] font-semibold text-white/70">{b.lengthFt ? `${formatPortalNumber(b.lengthFt)} ft` : ''}</span></p>
                  <p className="text-[11px] text-white/70">{b.category ? `${translatePortalText(b.category)} · ` : ''}{providerName(b.providerId)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3.5">
                <div className="text-xs font-bold text-deep-900">{boatTripsLabel(b)}</div>
                <div className="text-[11px] text-slate-400">{b.rating ? `${formatPortalNumber(b.rating, { maximumFractionDigits: 1 })}★${b.reviewCount ? ` (${formatPortalNumber(b.reviewCount)})` : ''}` : translatePortalText('No ratings yet')}</div>
                <div className="ms-auto flex gap-1.5">
                  <ListingActions state={state} onListed={(on) => setBoatStatus(b, on ? 'active' : 'out_of_service')} reviewPath="/admin/boat/approvals" busy={!!busyId} hideHint="Hide this boat from customers" />
                </div>
              </div>
            </motion.div>
          )})}
        </div>
      )}

      {cfg.kind === 'Boat' && items.length > 0 && view === 'table' && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto custom-scrollbar">
            <div className="min-w-[1000px]">
              <div className="grid grid-cols-[20fr_15fr_10fr_12fr_10fr_12fr_150px] items-center gap-4 border-b border-slate-100 bg-sand px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <span>{translatePortalText("Boat")}</span><span>{translatePortalText("Provider")}</span><span className="text-center">{translatePortalText("Length")}</span><span className="text-right">{translatePortalText("Trips")}</span><span className="text-center">{translatePortalText("Rating")}</span><span className="text-center">{translatePortalText("Status")}</span><span className="text-right">{translatePortalText("Actions")}</span>
              </div>
              {items.map((b, i) => {
                const state = boatListingState(b)
                return (
                <motion.div key={b.id || b._id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                  className="grid grid-cols-[20fr_15fr_10fr_12fr_10fr_12fr_150px] items-center gap-4 border-b border-slate-50 px-5 py-4 transition hover:bg-sand/70 last:border-b-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <Img src={b.images?.[0] || listingPhoto(b.name, 'boat')} className="h-10 w-10 shrink-0 rounded-xl object-cover ring-1 ring-slate-200" />
                    <div className="min-w-0"><p className="truncate text-[13px] font-extrabold text-deep-900">{b.name}</p>{b.category && <p className="truncate text-[11px] text-slate-400">{translatePortalText(b.category)}</p>}</div>
                  </div>
                  <div className="truncate text-xs font-semibold text-slate-600">{providerName(b.providerId)}</div>
                  <div className="text-center text-xs text-slate-500 whitespace-nowrap">{b.lengthFt ? `${formatPortalNumber(b.lengthFt)} ft` : '—'}</div>
                  <div className="text-right text-xs font-bold text-deep-900 whitespace-nowrap">{boatTripsLabel(b)}</div>
                  <div className="text-center text-xs font-bold text-emerald-600 whitespace-nowrap">{b.rating ? `${formatPortalNumber(b.rating, { maximumFractionDigits: 1 })}★` : '—'}{b.reviewCount ? <span className="ms-1 text-[10px] font-semibold text-slate-400">({formatPortalNumber(b.reviewCount)})</span> : null}</div>
                  <div className="flex justify-center whitespace-nowrap"><ABadge dot={state !== 'Listed'}>{translatePortalText(state)}</ABadge></div>
                  <div className="flex justify-end gap-1.5 whitespace-nowrap">
                    <ListingActions state={state} onListed={(on) => setBoatStatus(b, on ? 'active' : 'out_of_service')} reviewPath="/admin/boat/approvals" busy={!!busyId} hideHint="Hide this boat from customers" />
                  </div>
                </motion.div>
              )})}
            </div>
          </div>
        </div>
      )}

      {/* ── MARINA ── */}
      {cfg.kind === 'Marina' && items.length > 0 && view === 'card' && (
        <div className="grid gap-4 md:grid-cols-2">
          {items.map((m, i) => {
            const state = marinaListingState(m)
            return (
            <motion.div key={m.id || m._id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="card card-hover overflow-hidden">
              <div className="flex">
                <div className="relative h-32 w-40 shrink-0"><Img src={m.images?.[0] || listingPhoto(m.name, 'marina')} className="h-full w-full" /></div>
                <div className="min-w-0 flex-1 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-display text-[15px] font-extrabold text-deep-900">⚓ {m.name}</p>
                    <ABadge dot={state !== 'Listed'}>{translatePortalText(state)}</ABadge>
                  </div>
                  <p className="truncate text-[11px] text-slate-400">{[placeLabel(m.city, m.region, m.address), providerName(m.owner)].filter(Boolean).join(' · ')}</p>
                  <p className="mt-1 text-[11px] font-semibold text-slate-600">{marinaBerthsLabel(m)} · {m.rating ? ratingLabel(m) : translatePortalText('No ratings yet')}</p>
                  <div className="mt-3 flex gap-1.5">
                    <ListingActions state={state} onListed={(on) => setMarinaListed(m, on)} reviewPath="/admin/marina/approvals" busy={!!busyId} hideHint="Hide this marina from customers" />
                  </div>
                </div>
              </div>
            </motion.div>
          )})}
        </div>
      )}

      {cfg.kind === 'Marina' && items.length > 0 && view === 'table' && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto custom-scrollbar">
            <div className="min-w-[1000px]">
              <div className="grid grid-cols-[20fr_16fr_10fr_14fr_9fr_13fr_140px] items-center gap-4 border-b border-slate-100 bg-sand px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <span>{translatePortalText("Marina")}</span><span>{translatePortalText("Provider")}</span><span>{translatePortalText("City")}</span><span className="text-right">{translatePortalText("Berths")}</span><span className="text-center">{translatePortalText("Rating")}</span><span className="text-center">{translatePortalText("Status")}</span><span className="text-right">{translatePortalText("Actions")}</span>
              </div>
              {items.map((m, i) => {
                const state = marinaListingState(m)
                return (
                <motion.div key={m.id || m._id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                  className="grid grid-cols-[20fr_16fr_10fr_14fr_9fr_13fr_140px] items-center gap-4 border-b border-slate-50 px-5 py-4 transition hover:bg-sand/70 last:border-b-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <Img src={m.images?.[0] || listingPhoto(m.name, 'marina')} className="h-10 w-10 shrink-0 rounded-xl object-cover ring-1 ring-slate-200" />
                    <div className="min-w-0"><p className="truncate text-[13px] font-extrabold text-deep-900">{m.name}</p>{m.nameAr && <p className="truncate text-[11px] text-slate-400" dir="rtl">{m.nameAr}</p>}</div>
                  </div>
                  <div className="truncate text-xs font-semibold text-slate-600">{providerName(m.owner)}</div>
                  <div className="truncate text-xs text-slate-500">{placeLabel(m.city, m.region) || '—'}</div>
                  <div className="text-right text-xs font-bold text-deep-900 whitespace-nowrap">
                    {marinaBerthsLabel(m)}
                    {m.occupancyPct != null && <p className="text-[10px] font-semibold text-slate-400">{formatPortalPercent(m.occupancyPct)} {translatePortalText('full')}</p>}
                  </div>
                  <div className="text-center text-xs font-bold text-emerald-600 whitespace-nowrap">{ratingLabel(m)}</div>
                  <div className="flex justify-center whitespace-nowrap"><ABadge dot={state !== 'Listed'}>{translatePortalText(state)}</ABadge></div>
                  <div className="flex justify-end gap-1.5 whitespace-nowrap">
                    <ListingActions state={state} onListed={(on) => setMarinaListed(m, on)} reviewPath="/admin/marina/approvals" busy={!!busyId} hideHint="Hide this marina from customers" />
                  </div>
                </motion.div>
              )})}
            </div>
          </div>
        </div>
      )}

      {/* ── FUEL ── */}
      {cfg.kind === 'Fuel' && items.length > 0 && view === 'card' && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((s, i) => {
            const state = fuelStationState(s)
            const owner = stationProviderLabel(s)
            return (
            <motion.div key={s._id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
              className={`card card-hover overflow-hidden ${owner.missing || state === 'Taken down' ? 'ring-1 ring-rose-200' : ''}`}>
              <div className="relative h-32">
                <Img src={s.images?.[0] || listingPhoto(s.name, 'fuel')} className="h-full w-full" />
                <div className="absolute inset-0 bg-gradient-to-t from-deep-950/80 to-transparent" />
                <span className="absolute end-2 top-2"><ABadge dot={state !== 'Listed'}>{translatePortalText(state)}</ABadge></span>
                <div className="absolute bottom-2 start-3 text-white"><p className="font-display text-[15px] font-extrabold">⛽ {s.name}</p><p className="text-[10px] text-white/70">{[placeLabel(s.city, s.area, s.address), owner.text].filter(Boolean).join(' · ')}</p></div>
              </div>
              <div className="p-4">
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-xl bg-sand py-2"><p className="font-display text-sm font-extrabold text-deep-900">{fuelPriceLabel(s)}</p><p className="truncate px-1 text-[9px] font-bold uppercase text-slate-400">{fuelNamesLabel(s)}</p></div>
                  <div className="rounded-xl bg-sand py-2">
                    <p className={`font-display text-sm font-extrabold ${s.stockPct != null && s.stockPct < 25 ? 'text-rose-600' : 'text-emerald-600'}`}>{s.stockPct != null ? formatPortalPercent(s.stockPct) : '—'}</p>
                    <p className="text-[9px] font-bold uppercase text-slate-400">{translatePortalText(s.stockPct != null ? 'Tank level' : 'No tanks')}</p>
                  </div>
                </div>
                {s.stockPct != null && <div className="mt-3"><AProgress pct={s.stockPct} /></div>}
                <div className="mt-3 flex gap-1.5 border-t border-slate-100 pt-3">
                  <ListingActions state={state} onListed={(on) => setStationListed(s, on)} reviewPath="/admin/fuel/approvals" busy={!!busyId} hideHint="Hide this station from customers" />
                </div>
              </div>
            </motion.div>
          )})}
        </div>
      )}

      {cfg.kind === 'Fuel' && items.length > 0 && view === 'table' && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto custom-scrollbar">
            <div className="min-w-[1000px]">
              <div className="grid grid-cols-[20fr_15fr_15fr_12fr_10fr_12fr_150px] items-center gap-4 border-b border-slate-100 bg-sand px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <span>{translatePortalText("Station")}</span><span>{translatePortalText("Provider")}</span><span>{translatePortalText("Location")}</span><span className="text-right">{translatePortalText("Price")}</span><span className="text-center">{translatePortalText("Tank level")}</span><span className="text-center">{translatePortalText("Status")}</span><span className="text-right">{translatePortalText("Actions")}</span>
              </div>
              {items.map((s, i) => {
                const state = fuelStationState(s)
                const owner = stationProviderLabel(s)
                return (
                <motion.div key={s._id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                  className="grid grid-cols-[20fr_15fr_15fr_12fr_10fr_12fr_150px] items-center gap-4 border-b border-slate-50 px-5 py-4 transition hover:bg-sand/70 last:border-b-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <Img src={s.images?.[0] || listingPhoto(s.name, 'fuel')} className="h-10 w-10 shrink-0 rounded-xl object-cover ring-1 ring-slate-200" />
                    <div className="min-w-0"><p className="truncate text-[13px] font-extrabold text-deep-900">{s.name}</p><p className="truncate text-[11px] text-slate-400">{fuelNamesLabel(s)}</p></div>
                  </div>
                  <div className={`truncate text-xs font-semibold ${owner.missing ? 'text-rose-600' : 'text-slate-600'}`}>{owner.text}</div>
                  <div className="truncate text-xs text-slate-500" title={placeLabel(s.address) ?? undefined}>{placeLabel(s.city, s.area, s.address) || '—'}</div>
                  <div className="text-right text-[13px] font-extrabold text-deep-900 whitespace-nowrap">{fuelPriceLabel(s)}</div>
                  <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
                    {s.stockPct != null
                      ? <><AProgress pct={s.stockPct} /><b className={`w-9 shrink-0 text-right text-[11px] ${s.stockPct < 25 ? 'text-rose-600' : 'text-slate-500'}`}>{formatPortalPercent(s.stockPct)}</b></>
                      : <span className="text-[11px] text-slate-400">{translatePortalText('No tanks')}</span>}
                  </div>
                  <div className="flex justify-center whitespace-nowrap"><ABadge dot={state !== 'Listed'}>{translatePortalText(state)}</ABadge></div>
                  <div className="flex justify-end gap-1.5 whitespace-nowrap">
                    <ListingActions state={state} onListed={(on) => setStationListed(s, on)} reviewPath="/admin/fuel/approvals" busy={!!busyId} hideHint="Hide this station from customers" />
                  </div>
                </motion.div>
              )})}
            </div>
          </div>
        </div>
      )}

      {/* ── MAINTENANCE ── */}
      {cfg.kind === 'Maintenance' && items.length > 0 && view === 'card' && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((s, i) => (
            <motion.div key={s.id || s._id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
              className={`card card-hover p-4 ${s.status === 'paused' ? 'ring-1 ring-slate-200 opacity-90' : ''}`}>
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-violet-50 text-xl">🔧</span>
                <div className="min-w-0 flex-1"><p className="truncate text-[14px] font-extrabold text-deep-900">{s.name}</p><p className="truncate text-[11px] text-slate-400">{providerName(s.provider)}</p></div>
                <ABadge dot={s.status === 'active'}>{translatePortalText(s.status === 'active' ? 'Active' : 'Paused')}</ABadge>
              </div>
              {/* The trade, by name. The "jobs" and "★" chips beside it read
                  counters nothing maintains, so every service said "0 jobs · 0★". */}
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className="chip bg-slate-100 text-slate-600 !text-[10px]">{translatePortalText(s.categoryLabel || s.category)}</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                <div className="rounded-xl bg-sand py-2"><p className="font-display text-sm font-extrabold text-deep-900">{servicePriceLabel(s)}</p><p className="text-[9px] font-bold uppercase text-slate-400">{translatePortalText("Starting price")}</p></div>
                <div className="rounded-xl bg-sand py-2"><p className="font-display text-sm font-extrabold text-deep-900">{s.turnaroundLabel || '—'}</p><p className="text-[9px] font-bold uppercase text-slate-400">{translatePortalText("Turnaround")}</p></div>
              </div>
              <div className="mt-3 flex gap-1.5 border-t border-slate-100 pt-3">
                <button onClick={() => toggleServiceStatus(s)} disabled={!!busyId} className="btn-ghost disabled:opacity-60 flex-1 !justify-center !py-1.5 !text-[11px]">{translatePortalText(s.status === 'active' ? 'Pause' : 'Activate')}</button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {cfg.kind === 'Maintenance' && items.length > 0 && view === 'table' && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto custom-scrollbar">
            <div className="min-w-[960px]">
              <div className="grid grid-cols-[2fr_1fr_0.9fr_0.9fr_0.7fr_170px] items-center gap-4 border-b border-slate-100 bg-sand px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <span>{translatePortalText("Service")}</span><span>{translatePortalText("Category")}</span><span>{translatePortalText("Price")}</span><span>{translatePortalText("Turnaround")}</span><span>{translatePortalText("Status")}</span><span className="text-right">{translatePortalText("Actions")}</span>
              </div>
              {items.map((s, i) => (
                <motion.div key={s.id || s._id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                  className="grid grid-cols-[2fr_1fr_0.9fr_0.9fr_0.7fr_170px] items-center gap-4 border-b border-slate-50 px-5 py-4 transition hover:bg-sand/70 last:border-b-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-50 text-lg">🔧</span>
                    <div className="min-w-0"><p className="truncate text-[13px] font-extrabold text-deep-900">{s.name}</p><p className="truncate text-[11px] text-slate-400">{providerName(s.provider)}</p></div>
                  </div>
                  <div className="text-xs font-semibold text-slate-600 truncate">{translatePortalText(s.categoryLabel || s.category)}</div>
                  <div className={`text-[13px] font-extrabold whitespace-nowrap ${s.priceFrom ? 'text-deep-900' : 'text-slate-400'}`}>{servicePriceLabel(s)}</div>
                  <div className="text-xs text-slate-500 whitespace-nowrap">{s.turnaroundLabel || '—'}</div>
                  <div className="whitespace-nowrap"><ABadge dot={s.status === 'active'}>{translatePortalText(s.status === 'active' ? 'Active' : 'Paused')}</ABadge></div>
                  <div className="flex justify-end gap-1.5 whitespace-nowrap">
                    <button onClick={() => toggleServiceStatus(s)} disabled={!!busyId} className="btn-ghost disabled:opacity-60 !py-1.5 !px-2.5 !text-[11px]">{translatePortalText(s.status === 'active' ? 'Pause' : 'Activate')}</button>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      )}
      {!loadError && <LoadMore shown={items.length} total={total} busy={moreLoading} noun="listings" onMore={() => { setMoreLoading(true); load(page + 1) }} />}
    </PageWrap>
  )
}

// ══════════ PROVIDER BOOKINGS (kind-specific) ══════════

export function ProviderBookings({ cfg }: { cfg: DomainCfg }) {
  const [items, setItems] = useState<ApiAdminPayment[]>([])
  const [totals, setTotals] = useState({ gross: 0, commission: 0, count: 0 })
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<'All' | ApiAdminPayment['status']>('All')
  const [sel, setSel] = useState<ApiAdminPayment | null>(null)
  const statuses: ('All' | ApiAdminPayment['status'])[] = ['All', 'paid', 'pending', 'failed', 'refunded', 'partially_refunded']

  const [loadError, setLoadError] = useState<string | null>(null)
  // Pages of 100 (the API's cap). Only the first was read, so the table, and
  // the CSV built from it, silently stopped at the 100 newest payments.
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [moreLoading, setMoreLoading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const loadSeq = useRef(0)
  const query = (p: number) => ({ type: BOOKING_TYPE_FOR_KIND[cfg.kind], role: ROLE_FOR_KIND[cfg.kind], limit: 100, page: p, ...(status === 'All' ? {} : { status }) })

  useEffect(() => {
    // Latest request only: flicking between status chips could otherwise land
    // an older chip's rows under the newer chip.
    const seq = ++loadSeq.current
    setLoading(true); setLoadError(null); setPage(1)
    // `role` as well as `type`: the same scope as this vertical's revenue pages.
    adminPortalApi.payments(query(1))
      // The header is what was collected (`earned`) — `totals` follows the
      // status chip, which under "All" added pending and failed charges into a
      // "gross value" that never arrived.
      .then(res => { if (seq !== loadSeq.current) return; setItems(res.data.items); setTotal(res.data.pagination?.total ?? res.data.items.length); setTotals(res.data.earned ?? res.data.totals) })
      // Cleared, not left showing the previous chip's rows and totals.
      .catch((e) => { if (seq !== loadSeq.current) return; setItems([]); setTotal(0); setLoadError(translatePortalText(e instanceof Error ? e.message : `Failed to load ${cfg.name} bookings`)) })
      .finally(() => { if (seq === loadSeq.current) setLoading(false) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.kind, status, reloadKey])

  const loadMore = () => {
    const seq = loadSeq.current
    setMoreLoading(true)
    adminPortalApi.payments(query(page + 1))
      .then(res => { if (seq !== loadSeq.current) return; setItems(prev => [...prev, ...res.data.items]); setPage(page + 1) })
      .catch(() => toast(translatePortalText('Could not load more bookings'), 'warn'))
      .finally(() => setMoreLoading(false))
  }

  return (
    <PageWrap>
      <AdminHeader title={translatePortalText(cfg.bookingsLabel)} sub={`Every ${cfg.name.toLowerCase()} payment — sourced live from the Payment ledger`} icon={cfg.icon}
        actions={
          /* Was a bare `toast('Booking report exported')` — no file was ever
             written. Exports the payments actually loaded, honouring the
             status filter above it. */
          <button
            className="btn-ghost"
            onClick={() => {
              if (items.length === 0) { toast(translatePortalText('Nothing to export'), 'warn'); return }
              downloadCsv(`${cfg.kind}-bookings-${new Date().toISOString().slice(0, 10)}.csv`, [
                ['Booking', cfg.kind === 'Boat' ? 'Trip' : 'Booked', 'Customer', 'Provider', 'Date', `Amount (${BASE_CURRENCY})`, `Refunded (${BASE_CURRENCY})`, `Commission (${BASE_CURRENCY})`, `Card fee (${BASE_CURRENCY})`, 'Status', 'Gateway reference'],
                ...items.map(p => [
                  p.booking?.code ?? '',
                  p.booking?.title ?? '',
                  personName(p.customer),
                  paymentProviderLabel(p),
                  (p.paidAt || p.createdAt || '').slice(0, 10),
                  p.amount,
                  p.refundAmount ?? 0,
                  platformCut(p).commission,
                  platformCut(p).cardFee,
                  p.status,
                  p.transactionId,
                ]),
              ])
              // Says when it is a part: the export holds the rows loaded so far.
              toast(translatePortalText(total > items.length
                ? `Exported the ${items.length} bookings loaded of ${total} — use Load more for the rest`
                : `Exported ${items.length} booking${items.length === 1 ? '' : 's'}`))
            }}
          >
            {translatePortalText("Export report")}
          </button>
        } />

      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-3">
        {/* Currency, not a symbol — these are riyals. See AdminCustomers. */}
        {([['Paid bookings', totals.count, undefined], ['Collected (after refunds)', totals.gross, BASE_CURRENCY], ['Platform earnings', totals.commission, BASE_CURRENCY]] as [string, number, string | undefined][]).map(([l, v, cur], i) => (
          <motion.div key={l} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="card p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText(l)}</p>
            <p className="mt-1 font-display text-2xl font-extrabold text-deep-900">{loadError ? '—' : <Counter value={v} currency={cur} />}</p>
          </motion.div>
        ))}
      </div>
      {loadError && <LoadError message={loadError} onRetry={() => setReloadKey(k => k + 1)} />}

      <div className="mb-4 flex flex-wrap gap-1.5">
        {statuses.map(s => (
          <button key={s} onClick={() => setStatus(s)} className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${status === s ? 'bg-gradient-to-r from-emerald-600 to-teal-500 text-white shadow-glow' : 'bg-white text-slate-500 hover:text-deep-900'}`}>
            {s === 'All' ? translatePortalText('All') : translatePortalText(PAYMENT_STATUS_META[s].label)}
          </button>
        ))}
      </div>

      {loading ? (
        <TableSkeleton rows={6} cols={4} />
      ) : loadError ? null : (<>
        <div className="card overflow-hidden">
          <div className="overflow-x-auto custom-scrollbar">
            <div className="min-w-[1000px]">
              <div className="grid grid-cols-[25fr_15fr_12fr_12fr_12fr_150px] items-center gap-4 border-b border-slate-100 bg-sand px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <span>{translatePortalText("Transaction & customer")}</span><span>{translatePortalText("Type · provider")}</span><span>{translatePortalText("Date")}</span><span className="text-right">{translatePortalText("Amount")}</span><span className="text-center">{translatePortalText("Status")}</span><span className="text-right">{translatePortalText("Actions")}</span>
              </div>
              {items.map((b, i) => {
                const meta = BOOKING_TYPE_META[b.bookingType || ''] || { icon: '💳', label: b.bookingType || 'Payment' }
                const custAvatar = typeof b.customer === 'object' && b.customer?.avatar ? b.customer.avatar : seededAvatar(b._id)
                return (
                  <motion.div key={b._id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 20) * 0.03 }}
                    className="grid grid-cols-[25fr_15fr_12fr_12fr_12fr_150px] items-center gap-4 border-b border-slate-50 px-5 py-4 transition hover:bg-sand/70 last:border-b-0">
                    <div className="flex items-center gap-3 min-w-0">
                      <img src={custAvatar} className="h-9 w-9 shrink-0 rounded-full object-cover ring-2 ring-white shadow-soft" />
                      {/* What was booked, not the gateway's checkout id — that
                          is in the detail view for anyone reconciling. */}
                      <div className="min-w-0"><p className="truncate text-[13px] font-extrabold text-deep-900">{b.booking?.title || b.booking?.boat || translatePortalText(meta.label)}</p><p className="truncate text-[11px] text-slate-400">{[b.booking?.code, personName(b.customer)].filter(Boolean).join(' · ')}</p></div>
                    </div>
                    <div className="min-w-0 text-xs"><p className="flex items-center gap-1.5 truncate font-semibold text-deep-800"><span>{meta.icon}</span>{translatePortalText(meta.label)}</p><p className="truncate text-[11px] text-slate-400">{paymentProviderLabel(b)}</p></div>
                    <div className="text-xs text-slate-500 whitespace-nowrap">{formatPortalDate(new Date(b.paidAt || b.createdAt))}</div>
                    <div className="text-right text-[13px] font-extrabold text-deep-900 whitespace-nowrap">
                      {money(b.amount)}
                      {!!b.refundAmount && <p className="text-[10px] font-semibold text-rose-500">−{money(b.refundAmount)} {translatePortalText('refunded')}</p>}
                      {platformCut(b).commission > 0 && <p className="text-[10px] font-semibold text-emerald-600">+{money(platformCut(b).commission)} {translatePortalText(" comm.")}</p>}
                      {platformCut(b).cardFee > 0 && <p className="text-[10px] font-semibold text-slate-400">+{money(platformCut(b).cardFee)} {translatePortalText("card fee")}</p>}
                    </div>
                    <div className="flex justify-center whitespace-nowrap"><ABadge dot={PAYMENT_STATUS_META[b.status]?.dot}>{translatePortalText(PAYMENT_STATUS_META[b.status]?.label || b.status)}</ABadge></div>
                    <div className="flex justify-end gap-1.5 whitespace-nowrap">
                      <button onClick={() => setSel(b)} className="btn-ghost !py-1.5 !px-2.5 !text-[11px]"><Eye size={12} /> {translatePortalText("View")}</button>
                    </div>
                  </motion.div>
                )
              })}
              {items.length === 0 && <div className="py-14 text-center text-sm text-slate-400">{translatePortalText('No')} {translatePortalText(cfg.name.toLowerCase())} {translatePortalText('bookings')}{status !== 'All' ? ` ${translatePortalText('in')} "${translatePortalText(PAYMENT_STATUS_META[status as ApiAdminPayment['status']].label)}"` : ''}.</div>}
            </div>
          </div>
        </div>
        <LoadMore shown={items.length} total={total} busy={moreLoading} noun="bookings" onMore={loadMore} />
      </>)}

      <Modal open={!!sel} onClose={() => setSel(null)} title={sel ? `📋 ${sel.booking?.title || sel.booking?.code || translatePortalText('Payment')}` : ''}>
        {sel && (
          <div className="space-y-4">
            <div className="flex items-center gap-3.5 rounded-2xl bg-sand p-4">
              <img src={typeof sel.customer === 'object' && sel.customer?.avatar ? sel.customer.avatar : seededAvatar(sel._id)} className="h-12 w-12 rounded-full object-cover" />
              <div>
                <p className="font-display text-base font-extrabold text-deep-900">{personName(sel.customer)}</p>
                <p className="text-xs text-slate-400">{formatPortalDate(new Date(sel.paidAt || sel.createdAt))}</p>
              </div>
              <span className="ms-auto"><ABadge dot={PAYMENT_STATUS_META[sel.status]?.dot}>{translatePortalText(PAYMENT_STATUS_META[sel.status]?.label || sel.status)}</ABadge></span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl border border-slate-100 p-3">
                <p className="text-[10px] font-bold uppercase text-slate-400">{translatePortalText("Provider")}</p>
                <p className="mt-1 font-extrabold text-deep-900">{paymentProviderLabel(sel)}</p>
              </div>
              <div className="rounded-xl border border-slate-100 p-3">
                <p className="text-[10px] font-bold uppercase text-slate-400">{translatePortalText("Financial Breakdown")}</p>
                <p className="mt-1 font-extrabold text-emerald-600">{translatePortalText("Total:")} {money(sel.amount)}</p>
                <p className="mt-0.5 text-slate-500">{translatePortalText("Commission:")} {money(platformCut(sel).commission)} · {translatePortalText("Card fee:")} {money(platformCut(sel).cardFee)}</p>
                <p className="mt-0.5 text-slate-500">{translatePortalText("Method:")} {translatePortalText(sel.method)}</p>
                {!!sel.refundAmount && <p className="mt-0.5 text-rose-500">{translatePortalText("Refunded:")} {money(sel.refundAmount)}</p>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              {sel.booking?.code && (
                <div className="rounded-xl border border-slate-100 p-3">
                  <p className="text-[10px] font-bold uppercase text-slate-400">{translatePortalText("Booking")}</p>
                  <p className="mt-1 font-extrabold text-deep-900">{sel.booking.code}{sel.booking.boat ? ` · ${sel.booking.boat}` : ''}</p>
                </div>
              )}
              <div className="rounded-xl border border-slate-100 p-3">
                <p className="text-[10px] font-bold uppercase text-slate-400">{translatePortalText("Gateway reference")}</p>
                <p className="mt-1 break-all font-mono text-[11px] text-slate-600">{sel.transactionId}</p>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
              <button className="btn-admin" onClick={() => setSel(null)}>{translatePortalText("Close")}</button>
            </div>
          </div>
        )}
      </Modal>
    </PageWrap>
  )
}

// ══════════ PROVIDER ANALYTICS ══════════
export function ProviderAnalytics({ cfg }: { cfg: DomainCfg }) {
  const [providers, setProviders] = useState<AdminProvider[]>([])
  const [trend, setTrend] = useState<{ m: string; gross: number; commission: number }[]>([])
  const [byProvider, setByProvider] = useState<ApiCommissionRevenueRow[]>([])
  const [totals, setTotals] = useState<ApiRevenueTotals>({ gross: 0, commission: 0, providerNet: 0, count: 0 })
  const [loading, setLoading] = useState(true)
  // A failed load read "SAR 0 total revenue" under a toast that soon faded —
  // a vertical that had sold nothing, as far as the page could tell anyone.
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    /*
      Switching vertical refetches, so it races.

      Boat → Marina → Fuel fires three sets of requests. If the Boat set is
      slowest it resolves last and writes boat providers, boat revenue and boat
      commission into a page titled Fuel — every figure correct, every one
      attributed to the wrong line of business. Three requests per switch makes
      an out-of-order finish more likely, not less.
    */
    let alive = true
    setLoading(true)
    setLoadError(null)
    // The vertical's revenue from the endpoint Commission Revenue uses, scoped by
    // role on the server. This read the platform-wide top 20 and filtered it
    // here, so a provider outside the platform's top 20 vanished from their own
    // vertical's leaderboard and totals.
    Promise.all([
      adminApi.listProviders({ role: ROLE_FOR_KIND[cfg.kind] }),
      adminPortalApi.revenueTrend(BOOKING_TYPE_FOR_KIND[cfg.kind], ROLE_FOR_KIND[cfg.kind]),
      adminPortalApi.commissionRevenue({ role: ROLE_FOR_KIND[cfg.kind] }),
    ])
      .then(([provRes, trendRes, revRes]) => {
        if (!alive) return
        setProviders(provRes.data.providers)
        // All twelve months, a quiet one at 0. The API only returns months that
        // had payments, so a vertical with one month of sales drew a lone dot
        // where the chart promises a trailing year, and a gap between two busy
        // months was bridged as if the months between had sold.
        const byMonth = new Map(trendRes.data.months.map(m => [`${m._id.y}-${m._id.m}`, m]))
        const now = new Date()
        setTrend(Array.from({ length: 12 }, (_, i) => {
          const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1)
          const row = byMonth.get(`${d.getFullYear()}-${d.getMonth() + 1}`)
          return { m: translatePortalText(MONTH_NAMES[d.getMonth()]), gross: row?.gross ?? 0, commission: row?.commission ?? 0 }
        }))
        setByProvider(revRes.data.providers)
        setTotals(revRes.data.totals)
      })
      .catch((e) => {
        if (!alive) return
        setProviders([]); setTrend([]); setByProvider([]); setTotals({ gross: 0, commission: 0, providerNet: 0, count: 0 })
        setLoadError(translatePortalText(e instanceof Error ? e.message : `Failed to load ${cfg.name} analytics`))
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [cfg.kind, reloadKey])

  const revenue = totals.gross
  const bookings = totals.count
  // The same buckets as the directory, which lists "Awaiting payment" apart
  // from "Pending" — this folded the two together. Rejected and unfinished
  // applications fell into "Pending" too, swelling the review backlog the donut
  // reported with accounts nobody needed to review.
  const statusOf = (p: AdminProvider) =>
    !(p as any).isActive ? 'Blocked'
      : p.onboarding?.status === 'suspended' ? 'Suspended'
      : p.onboarding?.status === 'approved' ? 'Live'
      : p.onboarding?.status === 'pending_subscription_payment' ? 'Awaiting payment'
      : p.onboarding?.status === 'rejected' ? 'Rejected'
      : !p.onboarding?.status || p.onboarding.status === 'incomplete' || (p.onboarding.status as string) === 'draft' ? 'Incomplete'
      : 'Pending'
  const statusPie = ['Live', 'Awaiting payment', 'Pending', 'Incomplete', 'Rejected', 'Suspended', 'Blocked'].map(st => ({ name: st, value: providers.filter(p => statusOf(p) === st).length })).filter(d => d.value > 0)
  const pieColors: Record<string, string> = { Live: '#10b981', 'Awaiting payment': '#06b6d4', Pending: '#f59e0b', Incomplete: '#cbd5e1', Rejected: '#fb7185', Suspended: '#f43f5e', Blocked: '#94a3b8' }
  const leaders = [...byProvider].filter(p => p.gross > 0).sort((a, b) => b.gross - a.gross)
  const maxRev = Math.max(1, ...leaders.map(l => l.gross))
  const liveCount = providers.filter(p => statusOf(p) === 'Live').length

  return (
    <PageWrap>
      <AdminHeader title={`${translatePortalText(cfg.provPlural)} — ${translatePortalText("Performance")}`} sub={`Revenue, bookings & health across all ${cfg.name.toLowerCase()} providers — sourced live from Payments`} icon={cfg.icon}
        actions={
          /* Claimed an XLSX export and wrote no file. A real CSV of the
             providers this page is ranking. */
          <button
            className="btn-ghost"
            onClick={() => {
              if (providers.length === 0) { toast(translatePortalText('Nothing to export'), 'warn'); return }
              // Read fields that exist. This wrote `pr.revenue`, `pr.status`,
              // `pr.rating` — none of them on a provider — so every row was
              // "—, 0, 0".
              downloadCsv(`${cfg.slug}-provider-performance-${new Date().toISOString().slice(0, 10)}.csv`, [
                ['Provider', 'Owner', 'Status', `Collected (${BASE_CURRENCY})`, `Commission (${BASE_CURRENCY})`, 'Bookings', 'Rating', 'Reviews'],
                ...providers.map((pr) => [
                  pr.business?.businessName || pr.name || '—',
                  pr.name,
                  statusOf(pr),
                  pr.stats?.gross ?? 0,
                  pr.stats?.commission ?? 0,
                  pr.stats?.bookings ?? 0,
                  pr.stats?.rating || '',
                  pr.stats?.reviewCount ?? 0,
                ]),
              ])
              toast(translatePortalText(`Exported ${providers.length} provider${providers.length === 1 ? '' : 's'}`))
            }}
          >
            {translatePortalText("Export")}
          </button>
        } />

      {loadError && <LoadError message={loadError} onRetry={() => setReloadKey(k => k + 1)} />}

      <motion.div initial={{ opacity: 0, scale: 0.99 }} animate={{ opacity: 1, scale: 1 }} className="relative mb-5 overflow-hidden rounded-3xl text-white shadow-lift">
        <Img src={cfg.hero} className="absolute inset-0 h-full w-full opacity-30" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#041410]/90 via-[#062b22]/55 to-transparent" />
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-6 p-6 md:p-8">
          <div>
            <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.22em] text-emerald-300"><Gauge size={14} /> {cfg.provPlural}</p>
            <h2 className="mt-2 font-display text-2xl font-extrabold md:text-3xl">{loading || loadError ? '—' : money(revenue)} {translatePortalText("total revenue")}</h2>
            <p className="mt-1 text-sm text-white/70">{formatPortalNumber(providers.length)} {translatePortalText(" providers · ")}{formatPortalNumber(bookings)} {translatePortalText('bookings')}</p>
          </div>
          <div className="flex gap-3">
            {[[formatPortalNumber(providers.length), translatePortalText('Providers')], [formatPortalNumber(liveCount), translatePortalText('Live now')]].map(([n, l], i) => (
              <motion.div key={l} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 + i * 0.1 }} className="rounded-2xl bg-white/10 px-4 py-3 text-center backdrop-blur border border-white/15">
                <p className="font-display text-2xl font-extrabold">{n}</p><p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/60">{l}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Section title={translatePortalText("Revenue trend")} sub={`${cfg.name} vertical — gross vs commission, trailing 12 months`} className="lg:col-span-2">
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`dg-${cfg.slug}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity={0.32} /><stop offset="100%" stopColor="#10b981" stopOpacity={0.02} /></linearGradient>
                <linearGradient id={`dc-${cfg.slug}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#14b8a6" stopOpacity={0.3} /><stop offset="100%" stopColor="#14b8a6" stopOpacity={0.02} /></linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
              <XAxis dataKey="m" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={v => formatMoney(v, BASE_CURRENCY, { compact: true })} />
              <Tooltip content={<ChartTip />} /><Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="gross" name={translatePortalText('Gross')} stroke="#10b981" strokeWidth={2.5} fill={`url(#dg-${cfg.slug})`} />
              <Area type="monotone" dataKey="commission" name={translatePortalText('Commission')} stroke="#14b8a6" strokeWidth={2.5} fill={`url(#dc-${cfg.slug})`} />
            </AreaChart>
          </ResponsiveContainer>
        </Section>

        <Section title={translatePortalText("Provider status")} sub={translatePortalText("Approval health")}>
          {/* Mounted once the data is in, and without the sweep-in: mounted
              empty during loading, the donut only appeared through Recharts'
              post-load animation, and a screen read part-way through showed a
              legend with no chart above it. */}
          {!loading && statusPie.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={statusPie} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={44} outerRadius={72} paddingAngle={2} isAnimationActive={false}>
                  {statusPie.map(d => <Cell key={d.name} fill={pieColors[d.name]} />)}
                </Pie>
                <Tooltip content={<ChartTip />} />
              </PieChart>
            </ResponsiveContainer>
          ) : <div className="h-[180px]" />}
          <div className="mt-2 space-y-1.5">
            {statusPie.map(d => (
              <div key={d.name} className="flex items-center gap-2 text-xs"><span className="h-2.5 w-2.5 rounded-full" style={{ background: pieColors[d.name] }} /><span className="flex-1 font-semibold text-deep-800">{translatePortalText(d.name)}</span><b className="text-slate-500">{formatPortalNumber(d.value)}</b></div>
            ))}
            {statusPie.length === 0 && !loading && !loadError && <div className="py-4 text-center text-xs text-slate-400">{translatePortalText("No providers yet.")}</div>}
          </div>
        </Section>
      </div>

      <Section title={translatePortalText("Top providers by revenue")} sub={translatePortalText("Leaderboard — all-time gross")} className="mt-5">
        <div className="space-y-3">
          {/* No opacity entrance: it rendered the leaderboard near-invisible for
              as long as the fade ran, which read as an empty section. */}
          {leaders.map((p, i) => {
            const name = p.businessName || p.name || 'Unknown provider'
            return (
              <div key={p._id} className="flex items-center gap-3">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-sand font-display text-xs font-extrabold text-slate-400">{formatPortalNumber(i + 1)}</span>
                <img src={seededAvatar(name)} className="h-8 w-8 rounded-full object-cover" />
                <span className="w-48 shrink-0 truncate text-[13px] font-extrabold text-deep-900" title={name}>{name}</span>
                <AProgress pct={Math.round(p.gross / maxRev * 100)} />
                <div className="w-28 shrink-0 text-right">
                  <b className="block text-xs text-deep-900">{money(p.gross)}</b>
                  <span className="text-[10px] text-slate-400">{formatPortalNumber(p.count)} {translatePortalText(p.count === 1 ? 'booking' : 'bookings')}</span>
                </div>
              </div>
            )
          })}
          {leaders.length === 0 && !loading && !loadError && <div className="py-4 text-center text-xs text-slate-400">{translatePortalText("No revenue recorded yet for this vertical.")}</div>}
        </div>
      </Section>
    </PageWrap>
  )
}

// ══════════ PROVIDER REVIEWS (kind-specific slice of §14) ══════════
export function ProviderReviews({ cfg }: { cfg: DomainCfg }) {
  const [reviews, setReviews] = useState<ApiReview[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // The rating cards and the export are worked out from the reviews loaded, so
  // past the first 100 the page has to say it is reading a part, and offer more.
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [moreLoading, setMoreLoading] = useState(false)
  const loadSeq = useRef(0)
  const targetTypes = REVIEW_TARGET_TYPES_FOR_KIND[cfg.kind]
  const staffModel = REVIEW_STAFF_MODEL_FOR_KIND[cfg.kind]
  const query = (p: number) => ({ targetType: targetTypes, limit: 100, page: p, ...(staffModel ? { staffModel } : {}) })

  const load = () => {
    if (!targetTypes) { setReviews([]); setLoading(false); return }
    const seq = ++loadSeq.current
    setLoading(true); setLoadError(null); setPage(1)
    // 100 is the API's cap; `200` was quietly clamped to it.
    adminPortalApi.reviews(query(1))
      .then(res => { if (seq !== loadSeq.current) return; setReviews(res.data.items); setTotal(res.data.pagination?.total ?? res.data.items.length) })
      // An error, not "no reviews match this filter".
      .catch((e) => { if (seq !== loadSeq.current) return; setReviews([]); setTotal(0); setLoadError(translatePortalText(e instanceof Error ? e.message : `Could not load ${cfg.name.toLowerCase()} reviews`)) })
      .finally(() => { if (seq === loadSeq.current) setLoading(false) })
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [cfg.kind])
  const loadMore = () => {
    const seq = loadSeq.current
    setMoreLoading(true)
    adminPortalApi.reviews(query(page + 1))
      .then(res => { if (seq !== loadSeq.current) return; setReviews(prev => [...prev, ...res.data.items]); setPage(page + 1) })
      .catch(() => toast(translatePortalText('Could not load more reviews'), 'warn'))
      .finally(() => setMoreLoading(false))
  }

  // Every moderation action, take-down and restore included — see `useReviewModeration`.
  const moderation = useReviewModeration(setReviews)

  return (
    <PageWrap>
      <AdminHeader title={`${translatePortalText(cfg.name)} ${translatePortalText("Reviews")}`} sub={`Ratings & moderation for ${cfg.name.toLowerCase()} providers`} icon={cfg.icon}
        actions={
          /* Exported nothing. Writes the rating distribution its name promises. */
          <button
            className="btn-ghost"
            onClick={() => {
              if (reviews.length === 0) { toast(translatePortalText('No reviews to export'), 'warn'); return }
              downloadCsv(`${cfg.slug}-review-analytics-${new Date().toISOString().slice(0, 10)}.csv`, [
                ['Rating', 'Reviews'],
                ...[5, 4, 3, 2, 1].map(n => [`${n} star`, reviews.filter(r => Math.round(r.rating) === n).length]),
                ['Average', (reviews.reduce((a, r) => a + (r.rating || 0), 0) / reviews.length).toFixed(2)],
                [],
                ['Date', 'Rating', 'Author', 'Status', 'Comment'],
                ...reviews.map(r => [
                  (r.createdAt || '').slice(0, 10),
                  r.rating,
                  typeof r.author === 'object' && r.author ? r.author.name : '—',
                  r.moderation?.status || 'visible',
                  (r.comment || '').replace(/\s+/g, ' ').slice(0, 300),
                ]),
              ])
              toast(translatePortalText(`Exported ${reviews.length} review${reviews.length === 1 ? '' : 's'}`))
            }}
          >
            {translatePortalText("Rating analytics")}
          </button>
        } />
      {loadError && <LoadError message={loadError} onRetry={load} />}
      {loading ? (
        <CardGridSkeleton count={6} cols="sm:grid-cols-2" />
      ) : loadError ? null : (<>
        {total > reviews.length && (
          <p className="mb-3 text-[11px] font-semibold text-amber-700">{translatePortalText('Figures below cover the')} {formatPortalNumber(reviews.length)} {translatePortalText('most-reported reviews loaded, of')} {formatPortalNumber(total)}.</p>
        )}
        <ReviewStatCards reviews={reviews} />
        <ReviewsBoard reviews={reviews} emptyLabel={targetTypes ? translatePortalText(`No ${cfg.name.toLowerCase()} reviews match this filter.`) : `${translatePortalText(cfg.name)} ${translatePortalText('providers are not a reviewable listing type yet.')}`} {...moderation.boardProps} />
        <LoadMore shown={reviews.length} total={total} busy={moreLoading} noun="reviews" onMore={loadMore} />
      </>)}
      {moderation.modals}
    </PageWrap>
  )
}

function AiDocumentReviewModal({ docId, onClose, onReviewed }: { docId: string; onClose: () => void; onReviewed: () => void }) {
  const [doc, setDoc] = useState<AIDocument | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    /*
      The one race on this page with a decision attached to it.

      This modal is where a document is approved or rejected. Opening one
      document, closing it and opening another fires two `detail()` calls; if
      the first is slower it resolves last and the dialog shows the previous
      document's extracted fields and AI verdict while the approve and reject
      buttons act on the new `docId`. A reviewer would be signing off one
      provider's licence against another's analysis.
    */
    let alive = true
    aiDocumentApi
      .detail(docId)
      .then(res => { if (alive) setDoc(res.data.document) })
      .catch(() => { if (alive) toast(translatePortalText('Could not load AI document'), 'warn') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [docId])

  // Once: a second click while the first was in flight sent a second review,
  // which the server refuses as already decided — an error toast after success.
  const [approving, setApproving] = useState(false)
  const handleApprove = () => {
    if (approving) return
    setApproving(true)
    aiDocumentApi.review(docId, 'approved').then(() => { toast(translatePortalText('Document approved')); onReviewed(); onClose() }).catch(e => toast(translatePortalText((e as any).message), 'warn')).finally(() => setApproving(false))
  }
  const handleReject = () =>
    confirmAndRun({
      title: 'Reject this document?',
      body: 'The provider is told why and can upload a replacement.',
      input: { label: 'Reason for rejection', placeholder: 'Shown to the provider', required: true, multiline: true, maxLength: 400 },
      confirmLabel: 'Reject',
      busyLabel: 'Rejecting...',
      danger: true,
      run: async (reason) => {
        await aiDocumentApi.review(docId, 'rejected', reason)
        onReviewed()
        onClose()
      },
      success: 'Document rejected',
      error: 'Could not reject the document. Please try again.',
    })

  if (loading || !doc) return (
    <Modal open={true} onClose={onClose} title={translatePortalText("AI Document Verification")} wide>
      <div className="py-20 text-center text-sm text-slate-400">{translatePortalText("Loading AI analysis...")}</div>
    </Modal>
  )

  const isImage = doc.fileUrl.match(/\.(jpeg|jpg|gif|png|webp)$/i) !== null

  return (
    <Modal open={true} onClose={onClose} title={translatePortalText(`Verification: ${doc.docType.replace(/_/g, ' ')}`)} wide>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4">
           <div className="rounded-2xl bg-sand p-2 h-[450px] flex flex-col items-center justify-center border border-slate-100 overflow-hidden relative">
             {isImage ? (
               <Img src={fileUrl(doc.fileUrl) || ''} className="h-full w-full object-contain" />
             ) : (
               <a href={fileUrl(doc.fileUrl)} target="_blank" rel="noreferrer" className="btn-admin">{translatePortalText("Open Original PDF")}</a>
             )}
           </div>
        </div>
        <div className="space-y-5 h-[450px] overflow-y-auto pe-2">
           <div className="flex items-center justify-between">
             <p className="font-display text-lg font-bold">{translatePortalText("AI Analysis")}</p>
             <ABadge dot={doc.status === 'approved'}>{translatePortalText(doc.status.replace(/_/g, ' '))}</ABadge>
           </div>
           
           {doc.missingFields && doc.missingFields.length > 0 && (
             <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
               <p className="mb-2 text-xs font-bold uppercase text-rose-600">{translatePortalText("Missing Required Fields")}</p>
               <ul className="list-disc ps-4 text-sm text-rose-700">
                 {doc.missingFields.map(f => <li key={f.key}>{f.label}</li>)}
               </ul>
             </div>
           )}

           {doc.validation && doc.validation.length > 0 && (
             <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
               <p className="mb-2 text-xs font-bold uppercase text-amber-600">{translatePortalText("Validation Flags")}</p>
               <ul className="list-disc ps-4 text-sm text-amber-700">
                 {doc.validation.map((v, i) => <li key={i}>{v.message}</li>)}
               </ul>
             </div>
           )}

           <div>
             <p className="mb-3 text-xs font-bold uppercase text-slate-400">{translatePortalText("Extracted Data")}</p>
             <div className="space-y-2 text-sm">
               {doc.fields?.map(f => (
                 <div key={f.key} className="flex justify-between items-start border-b border-slate-50 pb-1.5">
                   <span className="text-slate-500 pe-2">{f.label}</span>
                   <span className="font-bold text-deep-900 flex items-center gap-2 text-right">
                     {f.value}
                     <span className={`text-[9px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${f.confidence > 0.8 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{formatPortalPercent(f.confidence * 100)}</span>
                   </span>
                 </div>
               ))}
               {(!doc.fields || doc.fields.length === 0) && <p className="text-slate-400 text-xs">{translatePortalText("No fields extracted.")}</p>}
             </div>
           </div>

           {doc.status !== 'approved' && doc.status !== 'rejected' && (
             <div className="flex gap-3 pt-4 border-t border-slate-100 sticky bottom-0 bg-white pb-2">
               <button className="btn-admin flex-1 disabled:opacity-60" disabled={approving} onClick={handleApprove}><Check size={14} className="me-1"/> {translatePortalText(approving ? 'Approving...' : 'Approve Document')}</button>
               <button className="btn-ghost flex-1 !text-rose-500" onClick={handleReject}><X size={14} className="me-1"/> {translatePortalText(" Reject")}</button>
             </div>
           )}
        </div>
      </div>
    </Modal>
  )
}

// ══════════ PROVIDER KYC & VERIFICATION (kind-specific slice of §16) ══════════
export function ProviderKyc({ cfg }: { cfg: DomainCfg }) {
  const [docs, setDocs] = useState<AIDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [reviewId, setReviewId] = useState<string | null>(null)
  /**
   * Server-side narrowing of the review queue.
   *
   * This page had no filters at all — a single flat list of up to 200
   * documents, with a "Send expiry alerts" button that sent nothing. Both
   * parameters used here (`status`, `expiring`) have always been accepted by
   * `/ai-documents`; nothing was passing them. So the queue can now be reduced
   * to what needs a decision, and the expiry question the old button gestured
   * at is answerable rather than announced.
   */
  const [status, setStatus] = useState('')
  const [expiringOnly, setExpiringOnly] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [total, setTotal] = useState(0)
  const loadSeq = useRef(0)

  const load = () => {
    // Latest request only — the filter chips refetch, and an older chip's
    // answer must not land under a newer chip.
    const seq = ++loadSeq.current
    setLoading(true); setLoadError(null)
    // This vertical's documents only (`providerType`) — the queue was one mixed
    // list across every vertical and customers. And 100, the API's cap: `200`
    // failed validation outright, so this page only ever showed its error toast
    // and an empty queue.
    aiDocumentApi.list({
      limit: 100,
      providerType: ROLE_FOR_KIND[cfg.kind],
      ...(status ? { status } : {}),
      ...(expiringOnly ? { expiring: 'true' as const } : {}),
    })
      .then(res => { if (seq !== loadSeq.current) return; setDocs(res.data.items); setTotal(res.data.pagination?.total ?? res.data.items.length) })
      // Said as an error — an empty board read as "nobody is waiting".
      .catch((e) => { if (seq !== loadSeq.current) return; setDocs([]); setTotal(0); setLoadError(translatePortalText(e instanceof Error ? e.message : 'Could not load AI KYC documents')) })
      .finally(() => { if (seq === loadSeq.current) setLoading(false) })
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [cfg.kind, status, expiringOnly])

  // The board's own shape — see `aiDocToKycItem`.
  const items = docs.map(aiDocToKycItem)

  /*
    Approve from the board, once — and not blind.

    It was a single click with no busy state, so a double click sent two
    reviews, and a document the AI had flagged critical was approved as quietly
    as a clean one. A flagged document now asks first and names the findings.
  */
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const approve = async (id: string) => {
    if (approvingId) return
    const doc = docs.find(d => (d._id || d.id) === id)
    const flags = (doc?.validation ?? []).filter(v => v.severity === 'critical' || v.severity === 'warning')
    const missing = (doc?.missingFields ?? []).filter(f => f.required)
    if (flags.length || missing.length) {
      const parts = [
        ...flags.slice(0, 3).map(f => f.message),
        ...(missing.length ? [`missing: ${missing.map(f => f.label).join(', ')}`] : []),
      ]
      await confirmAndRun({
        title: 'Approve a flagged document?',
        body: `The AI reading raised: ${parts.join('; ')}${flags.length > 3 ? ` (and ${flags.length - 3} more)` : ''}. Open it to check before approving.`,
        confirmLabel: 'Approve anyway',
        busyLabel: 'Approving...',
        danger: true,
        run: () => aiDocumentApi.review(id, 'approved'),
        success: 'Document approved',
        error: 'Could not approve document',
      })
      load()
      return
    }
    setApprovingId(id)
    try {
      await aiDocumentApi.review(id, 'approved')
      toast(translatePortalText('Document approved'))
    } catch (e) {
      toast(translatePortalText(e instanceof Error && e.message ? e.message : 'Could not approve document'), 'warn')
    } finally {
      setApprovingId(null)
      load()
    }
  }
  const reject = (id: string) =>
    confirmAndRun({
      title: 'Reject this document?',
      body: 'The provider is told why and can upload a replacement.',
      input: { label: 'Reason for rejection', placeholder: 'Shown to the provider', required: true, multiline: true, maxLength: 400 },
      confirmLabel: 'Reject',
      busyLabel: 'Rejecting...',
      danger: true,
      run: async (reason) => {
        await aiDocumentApi.review(id, 'rejected', reason)
        load()
      },
      success: 'Document rejected',
      error: 'Could not reject the document. Please try again.',
    })

  return (
    <PageWrap>
      <AdminHeader title={`${translatePortalText(cfg.name)} ${translatePortalText("AI KYC & Verification")}`} sub={`AI-powered document review for ${cfg.name.toLowerCase()} providers`} icon={cfg.icon}
        actions={
          /*
            Was `toast('Expiry alert digest sent')` — no digest endpoint exists
            and nothing was sent. `expiring` is a real query parameter, so the
            control that replaces it answers the same question honestly: show me
            the documents that are running out.
          */
          <button
            className={`btn-ghost ${expiringOnly ? '!bg-amber-50 !text-amber-700' : ''}`}
            aria-pressed={expiringOnly}
            onClick={() => setExpiringOnly(v => !v)}
          >
            {translatePortalText(expiringOnly ? 'Showing expiring only' : 'Expiring soon')}
          </button>
        } />

      {/* The review queue's own filter row. */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {[
          { key: '', label: 'All' },
          { key: 'needs_review', label: 'Needs review' },
          { key: 'analyzed', label: 'Analyzed' },
          { key: 'approved', label: 'Approved' },
          { key: 'rejected', label: 'Rejected' },
          { key: 'failed', label: 'Failed' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setStatus(t.key)}
            aria-pressed={status === t.key}
            className={`rounded-full px-3.5 py-1.5 text-[12px] font-bold transition ${
              status === t.key
                ? 'bg-gradient-to-r from-emerald-600 to-teal-500 text-white shadow-sm'
                : 'border border-slate-200 bg-white text-slate-500 hover:text-deep-900'
            }`}
          >
            {translatePortalText(t.label)}
          </button>
        ))}
      </div>
      {loadError && <LoadError message={loadError} onRetry={load} />}
      {loading ? (
        <CardGridSkeleton count={6} cols="sm:grid-cols-2" />
      ) : loadError ? null : (<>
        {total > items.length && (
          <p className="mb-3 text-[11px] font-semibold text-amber-700">{translatePortalText('Showing the newest')} {formatPortalNumber(items.length)} {translatePortalText('of')} {formatPortalNumber(total)} {translatePortalText('documents — narrow with the filters above to reach the rest.')}</p>
        )}
        <KycStatCards items={items} />
        <KycBoard items={items} emptyLabel={translatePortalText(`No ${cfg.name.toLowerCase()} providers in the verification queue.`)} onView={(id) => setReviewId(id)} onApprove={approve} onReject={reject} />
      </>)}
      {reviewId && <AiDocumentReviewModal docId={reviewId} onClose={() => setReviewId(null)} onReviewed={load} />}
    </PageWrap>
  )
}

// ══════════ REVENUE BY COMMISSION (kind-specific, real backend) ══════════
export function ProviderCommissionRevenue({ cfg }: { cfg: DomainCfg }) {
  const nav = useNavigate()
  const [filter, setFilter] = useState('All')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [totals, setTotals] = useState<ApiRevenueTotals>({ gross: 0, commission: 0, providerNet: 0, count: 0 })
  const [providers, setProviders] = useState<ApiCommissionRevenueRow[]>([])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      // Header and rows from one server-side scope, so they add up — the
      // header used to be the whole platform's.
      const res = await adminPortalApi.commissionRevenue({ role: `${cfg.slug}_provider` })
      setTotals(res.data.totals || { gross: 0, commission: 0, providerNet: 0, count: 0 })
      setProviders(res.data.providers || [])
    } catch (e) {
      setError(e instanceof Error ? translatePortalText(e.message) : translatePortalText(`Failed to load ${cfg.name.toLowerCase()} commission revenue`))
    } finally {
      setLoading(false)
    }
  }, [cfg.slug, cfg.name])

  useEffect(() => { load() }, [load])

  const items = providers.map((p) => ({
    id: p._id,
    name: p.businessName || p.name || 'Unknown provider',
    model: planModelLabel(p),
    // A provider who has since moved plans still has charges taken under the
    // old one — which is how "Subscription" sat beside real commission.
    chargedAs: (p.chargedUnder || []).filter(m => m && m !== p.billingModel),
    count: p.count,
    // A flat per-transaction fee is not a rate; it is an amount.
    rate: planKindOf(p) === 'fixed_fee'
      ? `${translatePortalText('SAR')} ${formatPortalNumber(p.commissionFixedAmount ?? 0)} ${translatePortalText('per transaction')}`
      : typeof p.commissionRate === 'number' ? formatPortalPercent(p.commissionRate) : '—',
    rateValue: planKindOf(p) === 'fixed_fee' ? p.commissionFixedAmount ?? 0 : p.commissionRate ?? -1,
    gross: p.gross || 0,
    comm: p.commission || 0,
  }))

  const rateTiers = Array.from(new Map(items.filter(it => it.rate !== '—').map(it => [it.rate, it.rateValue] as const)).entries())
    .sort((a, b) => b[1] - a[1]).map(([rate]) => rate)
  const filters = ['All', ...rateTiers]
  const filteredItems = filter === 'All' ? items : items.filter(it => it.rate === filter)
  const avgRate = totals.gross ? formatPortalPercent((totals.commission / totals.gross) * 100, 1) : formatPortalPercent(0, 1)

  return (
    <PageWrap>
      <AdminHeader
        title={`${translatePortalText(cfg.provPlural)} — ${translatePortalText("Commission Revenue")}`}
        sub={`Track total platform commission earned per transaction from ${cfg.name.toLowerCase()} providers`}
        icon={<Landmark className="text-emerald-500" />}
        actions={
          <button
            className="btn-admin"
            onClick={() => {
              // Generated no report before this. Exports the rows on screen,
              // honouring the rate-tier filter, with the page's own totals.
              if (filteredItems.length === 0) { toast(translatePortalText('Nothing to export'), 'warn'); return }
              downloadCsv(`${cfg.slug}-commission-${new Date().toISOString().slice(0, 10)}.csv`, [
                ['Provider', 'Billing model', 'Rate', `Gross (${BASE_CURRENCY})`, `Commission (${BASE_CURRENCY})`],
                ...filteredItems.map(it => [it.name, it.model, it.rate, it.gross, it.comm]),
                [],
                ['Totals', '', '', totals.gross, totals.commission],
                ['Effective rate', avgRate],
              ])
              toast(translatePortalText(`Exported ${filteredItems.length} provider${filteredItems.length === 1 ? '' : 's'}`))
            }}
          >
            {translatePortalText("Export Commission Report")}
          </button>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="card p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText("Total Commission Earned")}</p>
          <p className="mt-1 font-display text-2xl font-extrabold text-emerald-600">{error ? '—' : <Counter value={totals.commission} currency={BASE_CURRENCY} />}</p>
        </div>
        <div className="card p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText("Gross Transaction Volume")}</p>
          <p className="mt-1 font-display text-2xl font-extrabold text-deep-900">{error ? '—' : <Counter value={totals.gross} currency={BASE_CURRENCY} />}</p>
        </div>
        <div className="card p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText("Effective Avg. Rate")}</p>
          <p className="mt-1 font-display text-2xl font-extrabold text-teal-600">{error ? '—' : avgRate}</p>
        </div>
        <div className="card p-4">
          {/* Providers who actually paid commission — this counted every row,
              subscription providers with none included. */}
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText("Providers paying commission")}</p>
          <p className="mt-1 font-display text-2xl font-extrabold text-deep-900">{error ? '—' : formatPortalNumber(items.filter(it => it.comm > 0).length)}</p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {filters.map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
              filter === f
                ? 'bg-gradient-to-r from-emerald-600 to-teal-500 text-white shadow-glow'
                : 'bg-white text-slate-500 hover:text-deep-900'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* With a retry, and the table held back: it rendered beneath the error
          as "No … providers earned …", an empty result rather than a failed one. */}
      {error && <LoadError message={`${translatePortalText("Couldn't load: ")}${error}`} onRetry={load} />}
      {loading && <TableSkeleton rows={6} cols={4} />}

      {!loading && !error && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto custom-scrollbar">
            <div className="min-w-[960px]">
              <div className="grid grid-cols-[2fr_1.2fr_0.9fr_1.2fr_1.2fr_auto] items-center gap-4 border-b border-slate-100 bg-sand px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <span>{translatePortalText("Provider")}</span>
                <span>{translatePortalText("Monetization Model")}</span>
                <span>{translatePortalText("Commission Rate")}</span>
                <span>{translatePortalText("Gross Volume")}</span>
                <span>{translatePortalText("Commission Revenue")}</span>
                <span className="text-right">{translatePortalText("Actions")}</span>
              </div>

              {filteredItems.map((it, i) => (
                <motion.div
                  key={it.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="grid grid-cols-[2fr_1.2fr_0.9fr_1.2fr_1.2fr_auto] items-center gap-4 border-b border-slate-50 px-5 py-4 transition hover:bg-sand/70 last:border-b-0"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-600 text-lg">
                      <Landmark size={18} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-extrabold text-deep-900">{it.name}</p>
                      <p className="truncate text-[11px] text-slate-400">{translatePortalText(`${cfg.name} Provider`)}</p>
                    </div>
                  </div>

                  <div className="whitespace-nowrap">
                    <span className="chip bg-emerald-50 text-emerald-700 font-extrabold !text-[11px]">
                      {translatePortalText(it.model)}
                    </span>
                    {it.chargedAs.length > 0 && (
                      <p className="mt-1 text-[10px] font-semibold text-slate-400">
                        {translatePortalText('Earlier charges:')} {it.chargedAs.map(m => translatePortalText(m === 'commission' ? 'Commission' : 'Subscription')).join(', ')}
                      </p>
                    )}
                  </div>

                  <div className="text-xs font-bold text-teal-600 whitespace-nowrap">{it.rate}</div>
                  <div className="text-[13px] font-extrabold text-deep-900 whitespace-nowrap">{money(it.gross)}<p className="text-[10px] font-semibold text-slate-400">{formatPortalNumber(it.count)} {translatePortalText(it.count === 1 ? 'booking' : 'bookings')}</p></div>
                  <div className="text-[13px] font-extrabold text-emerald-600 whitespace-nowrap">{money(it.comm)}</div>

                  <div className="flex justify-end gap-1.5 whitespace-nowrap">
                    {/* Was `toast('Commission history for X opened')` and
                        opened nothing. The per-provider ledger is the statement
                        on Payments & Payouts → Cash Collections, which is where
                        a breakdown can actually be read and chased. */}
                    <button
                      onClick={() => nav('/admin/payments?tab=collections')}
                      className="btn-ghost !py-1.5 !px-2.5 !text-[11px]"
                    >
                      {translatePortalText("View Breakdown")}
                    </button>
                  </div>
                </motion.div>
              ))}
              {filteredItems.length === 0 && <div className="py-14 text-center text-sm text-slate-400">{translatePortalText("No ")}{cfg.name.toLowerCase()} {translatePortalText(" providers earned commission revenue in this filter.")}</div>}
            </div>
          </div>
        </div>
      )}
    </PageWrap>
  )
}

// ══════════ REVENUE BY PACKAGES (kind-specific, real backend) ══════════
export function ProviderPackageRevenue({ cfg }: { cfg: DomainCfg }) {
  const nav = useNavigate()
  const [filter, setFilter] = useState('All')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<ApiPackageRevenue | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await adminPortalApi.packageRevenue({ role: `${cfg.slug}_provider` })
      setData(res.data)
    } catch (e) {
      setError(e instanceof Error ? translatePortalText(e.message) : translatePortalText(`Failed to load ${cfg.name.toLowerCase()} package revenue`))
    } finally {
      setLoading(false)
    }
  }, [cfg.slug, cfg.name])

  useEffect(() => { load() }, [load])

  const mrr = data?.mrr ?? 0
  const arr = data?.arr ?? 0
  const subscribersCount = data?.subscribersCount ?? 0

  /** "every month", "every 3 months", "every year". */
  const cycle = (months: number) =>
    months === 1 ? translatePortalText('Monthly') : months === 12 ? translatePortalText('Yearly') : `${translatePortalText('Every')} ${formatPortalNumber(months)} ${translatePortalText('months')}`
  // Package prices are what is charged — SAR, not a display conversion.
  const priceLabel = (price: number, months: number) =>
    `${BASE_CURRENCY} ${formatPortalNumber(price)} / ${months === 1 ? translatePortalText('month') : months === 12 ? translatePortalText('year') : `${formatPortalNumber(months)} ${translatePortalText('months')}`}`

  const packages = (data?.catalogue ?? []).map(c => ({
    name: c.name,
    price: c.price ? priceLabel(c.price, c.months) : translatePortalText('Free'),
    providers: c.subscribers,
    features: c.features || [],
  }))

  const STATE_LABEL: Record<ApiPackageRevenue['providers'][number]['state'], { label: string; cls: string }> = {
    paid: { label: 'Paid', cls: 'bg-emerald-50 text-emerald-700' },
    awaiting_payment: { label: 'Awaiting payment', cls: 'bg-cyan-50 text-cyan-700' },
    expired: { label: 'Expired', cls: 'bg-rose-50 text-rose-700' },
    no_package: { label: 'No package chosen', cls: 'bg-slate-100 text-slate-500' },
  }

  const subs = (data?.providers ?? []).map(p => ({
    id: p._id,
    provider: p.business?.businessName || p.name || 'Unknown provider',
    // The package they actually chose — every row read "Free Tier" when the
    // server looked for plans in a collection that has none.
    plan: p.plan?.name || translatePortalText('No package chosen'),
    price: p.plan ? priceLabel(p.plan.price, p.plan.months) : '—',
    billing: p.plan ? cycle(p.plan.months) : '—',
    state: p.state,
    expires: p.expiresAt ? formatPortalDate(new Date(p.expiresAt)) : null,
    expiresPast: p.expiresAt ? new Date(p.expiresAt).getTime() < Date.now() : false,
    joined: p.createdAt ? formatPortalDate(new Date(p.createdAt), { month: 'short', year: 'numeric' }) : 'Unknown',
  }))

  const filters = ['All', ...Array.from(new Set(subs.map(s => s.plan)))]
  const filteredSubs = filter === 'All' ? subs : subs.filter(s => s.plan === filter)
  const avgPerSub = subscribersCount ? `${money(Math.round(mrr / subscribersCount))} / ${translatePortalText('month')}` : '—'

  return (
    <PageWrap>
      <AdminHeader
        title={`${translatePortalText(cfg.provPlural)} — ${translatePortalText("Package Revenue")}`}
        sub={`Track recurring subscription package revenue from ${cfg.name.toLowerCase()} providers`}
        icon={<Ticket className="text-amber-500" />}
        actions={
          <button
            className="btn-admin"
            onClick={() => {
              // Exported nothing before this. Writes the subscriber list plus
              // the MRR/ARR figures this page is built around.
              if (filteredSubs.length === 0) { toast(translatePortalText('Nothing to export'), 'warn'); return }
              downloadCsv(`${cfg.slug}-subscriptions-${new Date().toISOString().slice(0, 10)}.csv`, [
                [`MRR (${BASE_CURRENCY})`, mrr],
                [`ARR (${BASE_CURRENCY})`, arr],
                ['Paid subscribers', subscribersCount],
                [],
                ['Provider', 'Package', 'Price', 'Billing', 'Status', 'Expires', 'Joined'],
                ...filteredSubs.map(sb => [sb.provider, sb.plan, sb.price, sb.billing, STATE_LABEL[sb.state].label, sb.expires ?? '', sb.joined]),
              ])
              toast(translatePortalText(`Exported ${filteredSubs.length} subscription${filteredSubs.length === 1 ? '' : 's'}`))
            }}
          >
            {translatePortalText("Export Package Report")}
          </button>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="card p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText("Monthly Recurring (MRR)")}</p>
          <p className="mt-1 font-display text-2xl font-extrabold text-amber-500">{error ? '—' : <Counter value={Math.round(mrr)} prefix="SAR " />}</p>
        </div>
        <div className="card p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText("ARR (Projected)")}</p>
          <p className="mt-1 font-display text-2xl font-extrabold text-deep-900">{error ? '—' : <Counter value={Math.round(arr)} prefix="SAR " />}</p>
        </div>
        <div className="card p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText("Paid Subscribers")}</p>
          <p className="mt-1 font-display text-2xl font-extrabold text-emerald-600">{error ? '—' : formatPortalNumber(subscribersCount)}</p>
        </div>
        <div className="card p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText("Avg. Revenue Per Sub")}</p>
          <p className="mt-1 font-display text-2xl font-extrabold text-teal-600">{error ? '—' : avgPerSub}</p>
        </div>
      </div>

      {/* With a retry, and the table held back: it rendered beneath the error
          as "No … providers earned …", an empty result rather than a failed one. */}
      {error && <LoadError message={`${translatePortalText("Couldn't load: ")}${error}`} onRetry={load} />}
      {loading && <TableSkeleton rows={6} cols={4} />}

      {!loading && !error && (<>
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {packages.map((pkg, i) => (
            <motion.div
              key={pkg.name}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="card p-4 border border-slate-100 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-slate-400 uppercase">{pkg.name}</span>
                  <span className="chip bg-amber-50 text-amber-700 !text-[10px] font-bold">
                    {formatPortalNumber(pkg.providers)} {translatePortalText("paying")}
                  </span>
                </div>
                <p className="mt-2 font-display text-xl font-extrabold text-deep-900">{pkg.price}</p>
                <ul className="mt-3 space-y-1 text-xs text-slate-500">
                  {pkg.features.map(feat => (
                    <li key={feat} className="flex items-center gap-1.5">
                      <Check size={12} className="text-emerald-500" />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>
          ))}
          {packages.length === 0 && (
            <div className="col-span-full rounded-2xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">
              {translatePortalText('No active packages are set up for these providers yet.')}{' '}
              <button onClick={() => nav('/admin/subscriptions?tab=subscriptions')} className="font-bold text-emerald-600 hover:underline">{translatePortalText('Set up packages')}</button>
            </div>
          )}
        </div>

        <div className="mb-4 flex flex-wrap gap-1.5">
          {filters.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
                filter === f
                  ? 'bg-gradient-to-r from-emerald-600 to-teal-500 text-white shadow-glow'
                  : 'bg-white text-slate-500 hover:text-deep-900'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto custom-scrollbar">
            <div className="min-w-[960px]">
              <div className="grid grid-cols-[2fr_1.4fr_1fr_1fr_1fr_auto] items-center gap-4 border-b border-slate-100 bg-sand px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <span>{translatePortalText("Provider")}</span>
                <span>{translatePortalText("Subscription Package")}</span>
                <span>{translatePortalText("Price")}</span>
                <span>{translatePortalText("Status")}</span>
                <span>{translatePortalText("Joined")}</span>
                <span className="text-right">{translatePortalText("Actions")}</span>
              </div>

              {filteredSubs.map((s, i) => (
                <motion.div
                  key={s.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="grid grid-cols-[2fr_1.4fr_1fr_1fr_1fr_auto] items-center gap-4 border-b border-slate-50 px-5 py-4 transition hover:bg-sand/70 last:border-b-0"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-600 text-lg">
                      <Ticket size={18} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-extrabold text-deep-900">{s.provider}</p>
                      <p className="truncate text-[11px] text-slate-400">{translatePortalText(`${cfg.name} Provider`)}</p>
                    </div>
                  </div>

                  {/* Truncates, for the same reason as the directory's Plan column. */}
                  <div className="whitespace-nowrap">
                    <span className="chip min-w-0 max-w-[14rem] bg-amber-50 text-amber-800 font-extrabold !text-[11px]" title={s.plan}>
                      <span className="truncate">{s.plan}</span>
                    </span>
                  </div>

                  <div className="text-xs font-bold text-deep-900 whitespace-nowrap">{s.price}{s.billing !== '—' && <p className="text-[10px] font-semibold text-slate-400">{s.billing}</p>}</div>
                  <div className="whitespace-nowrap">
                    <span className={`chip font-extrabold !text-[11px] ${STATE_LABEL[s.state].cls}`}>{translatePortalText(STATE_LABEL[s.state].label)}</span>
                    {/* By the date, not the state: a suspended subscriber is
                        "expired" with a paid-up date still ahead, which read
                        "Expired 3 Aug 2027". */}
                    {s.expires && s.state !== 'awaiting_payment' && <p className="mt-0.5 text-[10px] text-slate-400">{translatePortalText(s.expiresPast ? 'Expired' : s.state === 'expired' ? 'Paid until' : 'Renews')} {s.expires}</p>}
                  </div>
                  <div className="text-xs text-slate-500 whitespace-nowrap">{s.joined}</div>

                  <div className="flex justify-end gap-1.5 whitespace-nowrap">
                    {/* Was `toast('Subscription details for X opened')`.
                        Subscriptions are actually managed on Packages &
                        Pricing → Provider Models, which can change a plan
                        and renew it. */}
                    <button
                      onClick={() => nav('/admin/subscriptions?tab=models')}
                      className="btn-ghost !py-1.5 !px-2.5 !text-[11px]"
                    >
                      {translatePortalText("Manage Subscription")}
                    </button>
                  </div>
                </motion.div>
              ))}
              {filteredSubs.length === 0 && <div className="py-14 text-center text-sm text-slate-400">{translatePortalText("No ")}{cfg.name.toLowerCase()} {translatePortalText(" providers on a subscription plan.")}</div>}
            </div>
          </div>
        </div>
      </>)}
    </PageWrap>
  )
}

