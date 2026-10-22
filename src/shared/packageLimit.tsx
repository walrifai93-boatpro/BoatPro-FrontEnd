// ---------------------------------------------------------------------------
// The package-limit engine's shared frontend pieces: usage widget, the
// "limit reached" add-on modal, and `useLimitAwareAction` — the hook every
// "Add worker/boat/station/berth" button wraps its create call in so the
// modal appears automatically on a PACKAGE_LIMIT_REACHED error and the
// original action retries once resolved. Reused across the marina, fuel,
// maintenance and boat provider portals.
//
// There is deliberately no self-serve "Upgrade Package"/"Switch Tier" flow —
// raising a limit is always an admin-priced add-on purchase, paid for via the
// HyperPay COPYandPAY widget (see ../payments/HyperpayCheckout.tsx).
// ---------------------------------------------------------------------------
import React, { useCallback, useEffect, useState } from 'react'
import { Modal, Progress, toast } from '../ui'
import { confirmAndRun } from '../async'
import {
  packageLimitApi,
  addOnApi,
  addOnRequestApi,
  monetizationApi,
  isPackageLimitError,
  type UsageRow,
  type AvailableAddOn,
  type AddOnRequestData,
  type PackageLimitReachedDetails,
  type PlanKind,
  type ProviderTypeKey,
} from '../api'
import { HyperpayCheckoutModal, stashPendingCheckout, type HyperpayCheckoutInfo } from '../payments/HyperpayCheckout'
import {
  PlanScheduleList,
  ProviderPricingPanel,
  amountsDiffer,
  chargeFromCheckout,
  planMoney,
  planPaymentError,
  renewBlockedReason,
  type ProviderPricingData,
} from './PlanPricing'
import type { PricingStepView } from '../api'


// ── usage widget ─────────────────────────────────────────────────────────

export function usePackageUsage() {
  const [usage, setUsage] = useState<UsageRow[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    try {
      const r = await packageLimitApi.usage()
      setUsage(r.data.usage)
    } catch {
      /* dashboards still render without the usage widget */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { usage, loading, reload }
}

function toneFor(pct: number): string {
  if (pct >= 100) return 'bg-gradient-to-r from-rose-600 to-rose-400'
  if (pct >= 80) return 'bg-gradient-to-r from-amber-500 to-amber-300'
  return 'bg-gradient-to-r from-ocean-500 to-ocean-300'
}

/** "Workers: 67 / 100" with a progress bar that escalates green -> amber -> red. */
export function UsageMeter({ item, onUpgrade }: { item: UsageRow; onUpgrade?: () => void }) {
  const unlimited = item.limit === null || item.limit === undefined
  const pct = unlimited ? 0 : Math.min(100, Math.round((item.usage / Math.max(1, item.limit!)) * 100))
  const nearLimit = !unlimited && pct >= 80

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-deep-900">{translatePortalText(item.label)}</span>
        <span className={`font-semibold tabular-nums ${nearLimit ? 'text-amber-600' : 'text-slate-500'}`}>
          {formatPortalNumber(item.usage)} / {unlimited ? '∞' : formatPortalNumber(item.limit!)}
        </span>
      </div>
      {!unlimited && <Progress pct={pct} tone={toneFor(pct)} />}
      {onUpgrade && (
        <button onClick={onUpgrade} className="self-start text-xs font-semibold text-ocean-600 hover:text-ocean-700 mt-0.5">
          {translatePortalText("Buy / Request Add-On →\n        ")}</button>
      )}
    </div>
  )
}

// ── limit-reached modal ──────────────────────────────────────────────────

import { AlertTriangle, Sparkles, Send, ArrowUpRight, Check, Plus, Loader2, CreditCard, Clock } from 'lucide-react'
import { formatPortalDate, formatPortalNumber, isPortalArabic, translatePortalTemplate, translatePortalText } from '../i18n/runtime'


interface PackageLimitModalProps {
  details: PackageLimitReachedDetails
  onClose: () => void
  /** Called once an add-on purchase succeeds — the caller retries the original action. */
  onResolved: () => void
}

function PackageLimitModal({ details, onClose, onResolved }: PackageLimitModalProps) {
  const [myRequests, setMyRequests] = useState<AddOnRequestData[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [checkout, setCheckout] = useState<HyperpayCheckoutInfo | null>(null)
  const [checkoutLabel, setCheckoutLabel] = useState<string>('')
  /*
    Instalments for this purchase.

    `tamaraUnavailable` comes back on the card response and is the server's own
    wording for why Tamara is not on offer - out of band, switched off for this
    surface, no mobile number. `payWithTamara` re-opens the *same* purchase
    through the same endpoint with `gateway: 'tamara'` and sends the browser to
    Tamara, so every eligibility rule stays on the server and there is no second
    copy of it here.
  */
  const [tamaraUnavailable, setTamaraUnavailable] = useState<string | null>(null)
  const [tamaraBusy, setTamaraBusy] = useState(false)
  const [payAgainWithTamara, setPayAgainWithTamara] = useState<(() => void) | null>(null)

  // Request capacity state
  const [requestQty, setRequestQty] = useState(2)
  const [requestNote, setRequestNote] = useState('')
  const [sendingRequest, setSendingRequest] = useState(false)
  const [requestSent, setRequestSent] = useState(false)

  const loadRequests = useCallback(async () => {
    try {
      const res = await addOnRequestApi.myRequests()
      setMyRequests(res.data.requests || [])
    } catch {
      // non-blocking
    }
  }, [])

  useEffect(() => {
    void loadRequests()
  }, [loadRequests])

  const payApprovedRequest = async (req: AddOnRequestData, gateway?: 'tamara') => {
    const reqId = req._id || req.id!
    const label = `+${formatPortalNumber(req.quantity)} ${translatePortalText(details.resourceLabel || details.resource)}`
    if (gateway) setTamaraBusy(true)
    else setBusyId(reqId)
    try {
      const res = await addOnRequestApi.purchaseCheckout(reqId, gateway ? { gateway } : undefined)
      // Stashed against whichever reference the confirm call will carry: the
      // checkout id for a card payment, Tamara's order id for instalments.
      const reference = res.data.orderId || res.data.checkoutId
      stashPendingCheckout(reference, { kind: 'addon_req', refId: reqId, label })
      if (res.data.mode === 'tamara' && res.data.checkoutUrl) {
        window.location.href = res.data.checkoutUrl
        return
      }
      setTamaraUnavailable(res.data.tamaraUnavailable ?? null)
      setPayAgainWithTamara(() => () => void payApprovedRequest(req, 'tamara'))
      setCheckoutLabel(`${formatPortalNumber(res.data.amount)} ${res.data.currency}`)
      setCheckout({ checkoutId: res.data.checkoutId, hyperpayBaseUrl: res.data.hyperpayBaseUrl! })
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not initiate payment'), 'error')
      setBusyId(null)
      setTamaraBusy(false)
    }
  }

  const handleSendRequest = async () => {
    setSendingRequest(true)
    try {
      await addOnRequestApi.create({
        resourceKey: details.resource,
        quantity: Number(requestQty) || 1,
        note: requestNote.trim() || undefined,
      })
      setRequestSent(true)
      toast(translatePortalText('Capacity add-on request sent to administrators!'), 'success')
      await loadRequests()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Failed to submit request'), 'warn')
    } finally {
      setSendingRequest(false)
    }
  }

  const resourceTitle = translatePortalText(details.resourceLabel || details.resource)
  const approvedReq = myRequests.find((r) => r.resourceKey === details.resource && r.status === 'approved')
  const pendingReq = myRequests.find((r) => r.resourceKey === details.resource && r.status === 'pending')

  return (
    <>
      <Modal open onClose={onClose} title={translatePortalText(`${resourceTitle} Quota Limit Reached`)}>
        <div className="flex flex-col gap-4">
          {/* Warning Banner */}
          <div className="flex items-start gap-3 rounded-2xl bg-amber-50/80 p-4 border border-amber-200/70 text-amber-900">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-500 text-white shadow-sm shadow-amber-200">
              <AlertTriangle size={20} />
            </div>
            <div className="flex-1 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold uppercase tracking-wider text-[11px] text-amber-800">{translatePortalText("Capacity Exceeded")}</span>
                <span className="rounded-full bg-amber-200/80 px-2 py-0.5 font-bold text-amber-900 text-[10px]">
                  {formatPortalNumber(details.currentUsage)} / {formatPortalNumber(details.limit)} {translatePortalText("in Use\n                ")}</span>
              </div>
              <p className="mt-1 leading-relaxed text-amber-800">
                {translatePortalText("Your active plan ")}<strong className="text-amber-950 font-semibold">{details.currentPackage?.name || translatePortalText('Subscription')}</strong> {translatePortalText("includes up to ")}<strong className="font-semibold">{formatPortalNumber(details.limit)} {resourceTitle.toLowerCase()}</strong>{translatePortalText(". Submit a capacity request below for administrator pricing & approval.\n              ")}</p>
            </div>
          </div>

          {/* Approved Request Ready For Payment */}
          {approvedReq && (
            <div className="rounded-2xl border-2 border-emerald-500 bg-gradient-to-br from-emerald-50 to-teal-50/70 p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-extrabold uppercase tracking-wider text-xs text-emerald-800">
                  <Sparkles size={15} className="text-emerald-600" /> {translatePortalText("Admin Approved Request Ready\n                ")}</span>
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-black text-emerald-800 border border-emerald-300">
                  +{formatPortalNumber(approvedReq.quantity)} {resourceTitle}
                </span>
              </div>
              <p className="mt-1 text-xs text-emerald-950 font-medium">
                {translatePortalText("Your request was approved by admin at ")}<strong className="font-black text-emerald-900">{formatPortalNumber(approvedReq.price)} {translatePortalText("SAR/month")}</strong>.
              </p>
              {approvedReq.adminNotes && (
                <p className="mt-1 text-[11px] text-emerald-800 italic bg-white/60 rounded-lg p-2 border border-emerald-100">
                  {translatePortalText("Note from Admin: \"")}{approvedReq.adminNotes}{isPortalArabic() ? '»' : '"'}
                </p>
              )}
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => payApprovedRequest(approvedReq)}
                  disabled={busyId !== null}
                  className="btn-admin !py-2 !px-4 text-xs font-black shadow-md flex items-center gap-1.5"
                >
                  {busyId === (approvedReq._id || approvedReq.id) ? (
                    <span className="flex items-center gap-1"><Loader2 size={13} className="animate-spin" /> {translatePortalText("Preparing Checkout")}</span>
                  ) : (
                    <>
                      <CreditCard size={14} /> {translatePortalText("Pay & Activate (+")}{formatPortalNumber(approvedReq.quantity)} {resourceTitle})
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Pending Request Banner */}
          {!approvedReq && pendingReq && (
            <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-900">
              <Clock size={16} className="text-amber-600 shrink-0" />
              <div>
                <p className="font-bold">{translatePortalText("Add-on Request Pending Admin Approval")}</p>
                <p className="text-[11px] text-amber-800">
                  {translatePortalText("Your request for +")}{formatPortalNumber(pendingReq.quantity)} {resourceTitle} {translatePortalText("was submitted and is currently being reviewed and quoted by platform administrators.\n                ")}</p>
              </div>
            </div>
          )}

          {/* Request Capacity Form Section */}
          <div className="rounded-2xl border border-slate-200/90 bg-slate-50/80 p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200/60 pb-2">
              <div>
                <span className="text-xs font-extrabold text-deep-900 flex items-center gap-1.5 uppercase tracking-wider">
                  <Send size={14} className="text-ocean-600" /> {translatePortalText("Request Capacity Upgrade: ")}{resourceTitle}
                </span>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {translatePortalText("Request extra capacity for ")}<strong>{resourceTitle}</strong> {translatePortalText("directly from platform administrators.\n                ")}</p>
              </div>
              <span className="rounded-full bg-ocean-100 px-3 py-1 text-xs font-black text-ocean-800 border border-ocean-200 shrink-0">
                {translatePortalText("Item: ")}{resourceTitle}
              </span>
            </div>

            {requestSent ? (
              <div className="flex items-center gap-2 text-emerald-700 text-xs font-semibold py-2 bg-emerald-50 rounded-xl px-3 border border-emerald-200">
                <Check size={16} className="text-emerald-500 shrink-0" />
                <span>{translatePortalText("Request sent successfully! Platform administrators will review your request and quote your monthly pricing.")}</span>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-1">
                    <label className="text-[11px] font-bold text-slate-700 block mb-1">{translatePortalText("Additional ")}{resourceTitle}</label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={requestQty}
                      onChange={(e) => setRequestQty(Number(e.target.value) || 1)}
                      className="input !py-1.5 !text-xs w-full font-bold"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="text-[11px] font-bold text-slate-700 block mb-1">{translatePortalText("Notes / Requirement (Optional)")}</label>
                    <input
                      type="text"
                      placeholder={translatePortalText("e.g. Need extra berths for peak summer season")}
                      value={requestNote}
                      onChange={(e) => setRequestNote(e.target.value)}
                      className="input !py-1.5 !text-xs w-full"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-[10px] text-slate-400 font-medium">
                    {translatePortalText("Step 1: Request → Step 2: Admin Approval & Quote → Step 3: Pay & Activate\n                  ")}</span>
                  <button
                    type="button"
                    onClick={handleSendRequest}
                    disabled={sendingRequest}
                    className="btn-primary !py-2 !px-4 !text-xs font-black shrink-0 flex items-center gap-1.5 shadow-sm"
                  >
                    {sendingRequest ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                    {translatePortalText("Submit Request to Admin\n                  ")}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </Modal>
      <HyperpayCheckoutModal
        open={!!checkout}
        onClose={() => { setCheckout(null); setBusyId(null); setTamaraBusy(false) }}
        checkout={checkout}
        amountLabel={checkoutLabel}
        onPayWithTamara={payAgainWithTamara ?? undefined}
        tamaraUnavailable={tamaraUnavailable}
        tamaraBusy={tamaraBusy}
      />
    </>
  )
}



// ── the hook every "Add ..." action wraps itself in ──────────────────────

export function useLimitAwareAction<Args extends unknown[], R>(
  action: (...args: Args) => Promise<R>
): { run: (...args: Args) => Promise<R | undefined>; modal: React.ReactNode } {
  const [details, setDetails] = useState<PackageLimitReachedDetails | null>(null)
  const [pendingArgs, setPendingArgs] = useState<Args | null>(null)

  const run = useCallback(
    async (...args: Args) => {
      try {
        return await action(...args)
      } catch (err) {
        if (isPackageLimitError(err)) {
          setDetails(err.details)
          setPendingArgs(args)
          return undefined
        }
        throw err
      }
    },
    [action]
  )

  const onResolved = useCallback(() => {
    setDetails(null)
    const args = pendingArgs
    setPendingArgs(null)
    if (args) void run(...args)
  }, [pendingArgs, run])

  const modal = details ? (
    <PackageLimitModal details={details} onClose={() => setDetails(null)} onResolved={onResolved} />
  ) : null

  return { run, modal }
}

// ── plan card: current package + usage + upgrade/downgrade/cancel actions ──

interface PackageLifecycle {
  packageStatus: string
  cancelAtPeriodEnd: boolean
  scheduledBillingModel?: string
  scheduledPackage: { id: string; name: string } | null
  switchEffectiveAt?: string | null
}

export interface ProviderDashboardData {
  paymentModel: 'subscription' | 'commission'
  subscriptionPlan?: { id?: string; name: string; price: number; duration?: string }
  subscriptionExpiry?: string | null
  isExpired?: boolean
  /**
   * Which of the three deals this account is on.
   *
   * `paymentModel` cannot say: a percentage cut and a flat per-transaction fee
   * are both `commission`, because they share the same storage. Read this to
   * describe the plan, never `commissionPercentage`, which is 0 on a fixed-fee
   * plan and reads as "the platform takes nothing".
   */
  planKind?: PlanKind
  /** The terms in one line, already worded for the plan's own kind. */
  planLabel?: string
  /** The flat cut per transaction on a fixed-fee plan; 0 otherwise. */
  feePerTransaction?: number
  commissionPercentage?: number
  commissionPackageName?: string
  packageLifecycle?: PackageLifecycle
  currency: string
  /**
   * What this provider actually pays: the next renewal's price (intro step and
   * offer applied), the plan's schedule, the commission in force, and their
   * offers. Absent on an older server.
   */
  pricing?: ProviderPricingData | null
}

/**
 * Last resort when the server sent no package name.
 *
 * `${commissionPercentage}% Commission` was the only fallback, which named a
 * fixed-fee provider's plan "0% Commission" — a figure that is technically
 * their percentage and tells them nothing true about what they pay.
 */
function fallbackPlanName(d: ProviderDashboardData): string {
  if (d.planKind === 'fixed_fee') {
    return `${d.currency || 'SAR'} ${formatPortalNumber(d.feePerTransaction ?? 0)} ${translatePortalText('per transaction')}`
  }
  return `${formatPortalNumber(d.commissionPercentage ?? 0)}% ${translatePortalText('Commission')}`
}

interface DowngradeCandidate {
  id: string
  name: string
  price: number
  durationMonths?: number
  /** The package's intro steps, when the listing sent them. */
  schedule?: PricingStepView[]
}

/**
 * The "Provider Dashboard" package section: current plan, usage meters, and
 * the downgrade/cancel/reactivate actions. Raising a limit is an add-on
 * purchase (see `UsageMeter`/`useLimitAwareAction`) — there is no self-serve
 * "Upgrade Package"/"Switch Tier" here anymore. Reused across all four
 * portals' billing pages.
 */
export function PackagePlanCard({
  dashboard,
  providerType,
  onChanged,
}: {
  dashboard: ProviderDashboardData | null
  providerType: ProviderTypeKey
  onChanged: () => void
}) {
  const usage = usePackageUsage()
  const [downgradeOpen, setDowngradeOpen] = useState(false)
  const [packages, setPackages] = useState<DowngradeCandidate[]>([])
  const [busy, setBusy] = useState(false)
  const [checkout, setCheckout] = useState<HyperpayCheckoutInfo | null>(null)
  const [checkoutLabel, setCheckoutLabel] = useState('')
  /*
    Instalments for this purchase.

    `tamaraUnavailable` comes back on the card response and is the server's own
    wording for why Tamara is not on offer - out of band, switched off for this
    surface, no mobile number. `payWithTamara` re-opens the *same* purchase
    through the same endpoint with `gateway: 'tamara'` and sends the browser to
    Tamara, so every eligibility rule stays on the server and there is no second
    copy of it here.
  */
  const [tamaraUnavailable, setTamaraUnavailable] = useState<string | null>(null)
  const [tamaraBusy, setTamaraBusy] = useState(false)
  const [payAgainWithTamara, setPayAgainWithTamara] = useState<(() => void) | null>(null)

  // Add-on requests & modal state
  const [myRequests, setMyRequests] = useState<AddOnRequestData[]>([])
  const [activeLimitModalDetails, setActiveLimitModalDetails] = useState<PackageLimitReachedDetails | null>(null)
  const [payingReqId, setPayingReqId] = useState<string | null>(null)

  const reloadRequests = useCallback(async () => {
    try {
      const res = await addOnRequestApi.myRequests()
      setMyRequests(res.data.requests || [])
    } catch {
      // non-blocking
    }
  }, [])

  useEffect(() => {
    void reloadRequests()
  }, [reloadRequests])

  if (!dashboard) return null
  const lifecycle = dashboard.packageLifecycle

  const payApprovedRequest = async (req: AddOnRequestData, gateway?: 'tamara') => {
    const reqId = req._id || req.id!
    const label = `+${formatPortalNumber(req.quantity)} ${translatePortalText(req.resourceLabel || req.resourceKey)}`
    if (gateway) setTamaraBusy(true)
    else setPayingReqId(reqId)
    try {
      const res = await addOnRequestApi.purchaseCheckout(reqId, gateway ? { gateway } : undefined)
      const reference = res.data.orderId || res.data.checkoutId
      stashPendingCheckout(reference, { kind: 'addon_req', refId: reqId, label })
      if (res.data.mode === 'tamara' && res.data.checkoutUrl) {
        window.location.href = res.data.checkoutUrl
        return
      }
      setTamaraUnavailable(res.data.tamaraUnavailable ?? null)
      setPayAgainWithTamara(() => () => void payApprovedRequest(req, 'tamara'))
      setCheckoutLabel(`${formatPortalNumber(res.data.amount)} ${res.data.currency}`)
      setCheckout({ checkoutId: res.data.checkoutId, hyperpayBaseUrl: res.data.hyperpayBaseUrl! })
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not start payment'), 'error')
    } finally {
      setPayingReqId(null)
      if (gateway) setTamaraBusy(false)
    }
  }

  const openAddOnModalForResource = (u: UsageRow) => {
    setActiveLimitModalDetails({
      code: 'PACKAGE_LIMIT_REACHED',
      resource: u.key,
      resourceLabel: u.label,
      currentUsage: u.usage,
      limit: u.limit ?? 0,
      currentPackage: dashboard.subscriptionPlan
        ? { id: dashboard.subscriptionPlan.id || '', name: dashboard.subscriptionPlan.name }
        : null,
      addOnAvailable: true,
      availableAddOns: [],
    })
  }

  // Prepares a HyperPay checkout for the current subscription package's price
  // — same redirect-based widget flow as an add-on purchase.
  const renewSubscription = async (gateway?: 'tamara') => {
    if (gateway) setTamaraBusy(true)
    else setBusy(true)
    try {
      const res = await monetizationApi.subscriptionCheckout(
        dashboard.subscriptionPlan?.id,
        gateway ? { gateway } : undefined
      )
      // A free plan is renewed by that call itself — no card form to open.
      if (res.data.mode === 'free') {
        toast(translatePortalText('Your free plan has been renewed.'), 'success')
        onChanged()
        return
      }
      const reference = res.data.orderId || res.data.checkoutId
      stashPendingCheckout(reference, {
        kind: 'subscription',
        refId: dashboard.subscriptionPlan?.id || '',
        label: `${res.data.package.name} subscription renewed`,
      })
      if (res.data.mode === 'tamara' && res.data.checkoutUrl) {
        window.location.href = res.data.checkoutUrl
        return
      }
      setTamaraUnavailable(res.data.tamaraUnavailable ?? null)
      setPayAgainWithTamara(() => () => void renewSubscription('tamara'))
      // What the checkout will actually charge — `package.price` is the amount
      // with the intro step and any offer applied, not the plan's list price.
      const charge = chargeFromCheckout(res.data)
      const charged = charge?.amount ?? res.data.package.price
      const listPrice = charge?.quote?.regularPrice
      setCheckoutLabel(
        amountsDiffer(listPrice, charged)
          ? `${planMoney(charged, dashboard.currency)} (${translatePortalText('Regular price')}: ${planMoney(listPrice!, dashboard.currency)})`
          : planMoney(charged, dashboard.currency)
      )
      setCheckout({ checkoutId: res.data.checkoutId, hyperpayBaseUrl: res.data.hyperpayBaseUrl! })
    } catch (e) {
      // The server's reason as it came — a plan change is scheduled, the first
      // payment belongs on the onboarding screen — or, for a 403, what it means.
      toast(planPaymentError(e, 'Could not start the renewal payment'), 'error')
    } finally {
      setBusy(false)
      if (gateway) setTamaraBusy(false)
    }
  }

  const openDowngradeBrowser = async () => {
    setDowngradeOpen(true)
    setBusy(true)
    try {
      const currentPrice = dashboard.subscriptionPlan?.price ?? Infinity
      const r = await monetizationApi.listSubscriptionPackages(providerType)
      const lower = r.data.packages
        .filter((p) => p.price < currentPrice)
        .sort((a, b) => b.price - a.price)
        .map((p) => ({ id: p._id || p.id || '', name: p.name, price: p.price, durationMonths: p.durationMonths, schedule: p.schedule }))
      setPackages(lower)
    } catch {
      setPackages([])
    } finally {
      setBusy(false)
    }
  }

  const pickDowngrade = async (pkg: DowngradeCandidate) => {
    setBusy(true)
    try {
      const r = await packageLimitApi.scheduleDowngrade(pkg.id)
      toast(translatePortalText(r.data.warning || `Scheduled: you'll move to ${pkg.name} at the end of your current period.`), r.data.warning ? 'warn' : 'success')
      setDowngradeOpen(false)
      onChanged()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not schedule the downgrade'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const cancelSub = () =>
    confirmAndRun({
      title: 'Cancel your subscription?',
      body: 'It stays active until the end of your current billing period, then stops renewing.',
      confirmLabel: 'Cancel subscription',
      cancelLabel: 'Keep it',
      busyLabel: 'Cancelling...',
      danger: true,
      run: async () => {
        await packageLimitApi.cancelSubscription()
        onChanged()
      },
      success: 'Cancellation scheduled for the end of your billing period',
      error: 'Could not cancel your subscription. Please try again.',
    })

  const reactivate = async () => {
    try {
      await packageLimitApi.reactivateSubscription()
      toast(translatePortalText('Subscription reactivated'), 'success')
      onChanged()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not reactivate'), 'error')
    }
  }

  const cancelDowngrade = async () => {
    try {
      await packageLimitApi.cancelScheduledDowngrade()
      toast(translatePortalText('Scheduled change cancelled'), 'success')
      onChanged()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not cancel the scheduled change'), 'error')
    }
  }

  const approvedRequests = myRequests.filter((r) => r.status === 'approved')
  const pendingRequests = myRequests.filter((r) => r.status === 'pending')

  /*
    What the next renewal actually costs (intro step and offer applied), from
    the server. The Renew button names it when it differs from the plan's list
    price, so the figure on the button is the figure on the card form.
  */
  const isSubscription = dashboard.paymentModel === 'subscription'
  /*
    `nextRenewal` is quoted for the package that will actually renew. With a
    change scheduled that is another package (and renewing early is refused
    until it takes effect); moving to commission or cancelling, nothing renews.
    So the button only names a figure when the quote is for this plan, and is
    switched off — with the reason beside it — while a change is scheduled.
  */
  const renewalNote = isSubscription ? dashboard.pricing?.subscription?.renewalNote ?? null : null
  const renewBlocked = renewBlockedReason(renewalNote, lifecycle?.switchEffectiveAt || dashboard.subscriptionExpiry)
  const rawNextRenewal = isSubscription ? dashboard.pricing?.subscription?.nextRenewal ?? null : null
  const planId = dashboard.subscriptionPlan?.id
  const nextRenewal =
    rawNextRenewal && !renewalNote && (!planId || !rawNextRenewal.packageId || String(rawNextRenewal.packageId) === String(planId))
      ? rawNextRenewal
      : null
  const renewalLabel =
    nextRenewal && typeof nextRenewal.amount === 'number' && amountsDiffer(nextRenewal.amount, dashboard.subscriptionPlan?.price)
      ? translatePortalTemplate('Renew · {{amount}}', {
          amount: nextRenewal.amount <= 0 ? translatePortalText('Free') : planMoney(nextRenewal.amount, nextRenewal.currency || dashboard.currency),
        })
      : translatePortalText('Renew')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white p-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">{translatePortalText("Current Package")}</p>
          <p className="mt-0.5 font-display text-lg font-bold text-deep-900">
            {dashboard.paymentModel === 'subscription'
              ? dashboard.subscriptionPlan?.name || translatePortalText('Subscription')
              : dashboard.commissionPackageName || fallbackPlanName(dashboard)}
          </p>
          {/* The terms under the name, in the plan's own vocabulary — a flat
              per-transaction fee is not a percentage and must not read as one. */}
          {dashboard.paymentModel !== 'subscription' && !!dashboard.planLabel && (
            <p className="text-xs text-slate-400">{translatePortalText(dashboard.planLabel)}</p>
          )}
          {dashboard.paymentModel === 'subscription' && dashboard.subscriptionExpiry && (
            <p className="text-xs text-slate-400">{translatePortalText("Renews / expires ")}{formatPortalDate(dashboard.subscriptionExpiry)}</p>
          )}
        </div>
        <div className="flex gap-2">
          {dashboard.paymentModel === 'subscription' && (
            <>
              <button
                className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
                disabled={busy || !!renewBlocked}
                title={renewBlocked ?? undefined}
                aria-describedby={renewBlocked ? 'renew-blocked-reason' : undefined}
                onClick={() => void renewSubscription()}
              >
                {renewalLabel}
              </button>
              <button className="btn-ghost" onClick={openDowngradeBrowser}>{translatePortalText("Downgrade")}</button>
              {lifecycle?.cancelAtPeriodEnd ? (
                <button className="btn-ghost" onClick={reactivate}>{translatePortalText("Undo Cancellation")}</button>
              ) : (
                <button className="btn-ghost !text-rose-600" onClick={cancelSub}>{translatePortalText("Cancel")}</button>
              )}
            </>
          )}
        </div>
        {!!renewBlocked && (
          <p id="renew-blocked-reason" className="w-full text-xs font-medium text-amber-700">{renewBlocked}</p>
        )}
      </div>

      <HyperpayCheckoutModal
        open={!!checkout}
        onClose={() => { setCheckout(null); setTamaraBusy(false) }}
        checkout={checkout}
        amountLabel={checkoutLabel}
        onPayWithTamara={payAgainWithTamara ?? undefined}
        tamaraUnavailable={tamaraUnavailable}
        tamaraBusy={tamaraBusy}
      />

      {/* Next renewal and how it was priced, the plan's intro schedule with
          the current step marked, the commission in force against the regular
          rate, and this provider's offers. Nothing on an older server. */}
      <ProviderPricingPanel
        pricing={dashboard.pricing}
        currency={dashboard.currency}
        isSubscription={isSubscription}
        periodEnd={lifecycle?.switchEffectiveAt || dashboard.subscriptionExpiry}
      />

      {/* Admin Approved Add-On Requests Banner */}
      {approvedRequests.map((req) => (
        <div
          key={req._id || req.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-emerald-500 bg-gradient-to-r from-emerald-50 to-teal-50 p-4 shadow-sm"
        >
          <div>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 text-xs font-extrabold uppercase tracking-wider text-emerald-800">
                <Sparkles size={16} className="text-emerald-600" /> {translatePortalText("Admin Approved Add-On Ready\n              ")}</span>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-black text-emerald-800 border border-emerald-300">
                +{formatPortalNumber(req.quantity)} {translatePortalText(req.resourceLabel || req.resourceKey)}
              </span>
            </div>
            <p className="mt-1 text-xs text-emerald-950 font-semibold">
                {translatePortalText("Quoted Rate: ")}<strong className="font-black text-emerald-900">{formatPortalNumber(req.price)} {translatePortalText("SAR / Month")}</strong>
            </p>
            {req.adminNotes && (
              <p className="mt-1 text-[11px] text-emerald-800 italic bg-white/70 rounded-lg p-2 border border-emerald-100">
                  {translatePortalText("Note from Admin: \"")}{req.adminNotes}{isPortalArabic() ? '»' : '"'}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => payApprovedRequest(req)}
            disabled={payingReqId !== null}
            className="btn-admin !py-2 !px-4 text-xs font-black shadow-md flex items-center gap-1.5 shrink-0"
          >
            {payingReqId === (req._id || req.id) ? (
              <span className="flex items-center gap-1"><Loader2 size={13} className="animate-spin" /> {translatePortalText("Preparing")}</span>
            ) : (
              <>
                <CreditCard size={14} /> {translatePortalText("Pay & Activate (+")}{formatPortalNumber(req.quantity)} {translatePortalText(req.resourceLabel || req.resourceKey)})
              </>
            )}
          </button>
        </div>
      ))}

      {/* Pending Add-On Requests Banner */}
      {pendingRequests.map((req) => (
        <div
          key={req._id || req.id}
          className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-3.5 text-xs text-amber-900"
        >
          <Clock size={16} className="text-amber-600 shrink-0" />
          <div className="flex-1">
            <span className="font-bold">{translatePortalText("Add-On Request Pending (+")}{formatPortalNumber(req.quantity)} {translatePortalText(req.resourceLabel || req.resourceKey)})</span>
            <p className="text-[11px] text-amber-800 mt-0.5">
              {translatePortalText("Submitted for review. Platform administrators will quote monthly pricing shortly.\n            ")}</p>
          </div>
        </div>
      ))}

      {lifecycle?.scheduledPackage && (
        <div className="flex items-center justify-between rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span>
            {translatePortalText("Scheduled: moving to ")}<b>{lifecycle.scheduledPackage.name}</b>
            {lifecycle.switchEffectiveAt ? ` on ${formatPortalDate(lifecycle.switchEffectiveAt)}` : ''}.
          </span>
          <button className="text-xs font-semibold underline" onClick={cancelDowngrade}>{translatePortalText("Cancel this change")}</button>
        </div>
      )}
      {lifecycle?.cancelAtPeriodEnd && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {translatePortalText("Your subscription is set to cancel at the end of the current period.\n        ")}</div>
      )}

      {usage.usage.length > 0 && (
        <div className="grid gap-4 rounded-2xl border border-slate-100 bg-white p-4 sm:grid-cols-2">
          {usage.usage.map((u) => (
            <UsageMeter
              key={u.key}
              item={u}
              onUpgrade={() => openAddOnModalForResource(u)}
            />
          ))}
        </div>
      )}

      {activeLimitModalDetails && (
        <PackageLimitModal
          details={activeLimitModalDetails}
          onClose={() => setActiveLimitModalDetails(null)}
          onResolved={() => {
            setActiveLimitModalDetails(null)
            usage.reload()
            void reloadRequests()
            onChanged()
          }}
        />
      )}

      <Modal open={downgradeOpen} onClose={() => setDowngradeOpen(false)} title={translatePortalText("Downgrade Package")}>
        {busy ? (
          <p className="py-6 text-center text-sm text-slate-400">{translatePortalText("Loading…")}</p>
        ) : packages.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">{translatePortalText("No lower-tier package available right now.")}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {packages.map((pkg) => (
              <button
                key={pkg.id}
                onClick={() => pickDowngrade(pkg)}
                className="flex flex-col gap-1.5 rounded-xl border border-slate-200 px-4 py-3 text-left transition hover:border-ocean-400 hover:bg-ocean-50/40"
              >
                <span className="flex w-full items-center justify-between gap-3">
                  <span className="font-semibold text-deep-900">{pkg.name}</span>
                  <span className="font-semibold text-deep-900">{formatPortalNumber(pkg.price)}</span>
                </span>
                {/* Its intro steps, when it has any — the price above is the
                    regular one they give way to. */}
                <PlanScheduleList schedule={pkg.schedule} kind="subscription" durationMonths={pkg.durationMonths} currency={dashboard.currency} className="w-full" />
              </button>
            ))}
          </div>
        )}
      </Modal>
    </div>
  )
}
