import React, { useEffect, useRef } from 'react'
import { Modal } from '../ui'
import { translatePortalText } from '../i18n/runtime'

/**
 * Embeds HyperPay's COPYandPAY widget for a prepared checkout. Submitting the
 * card form navigates the whole page to `shopperResultUrl` (COPYandPAY is not
 * an in-page AJAX flow) — see PaymentResult.tsx for what happens on return.
 *
 * mada is listed first in `data-brands` per Saudi Payments' e-commerce rule
 * that mada be the first, most prominent payment option.
 */
export interface HyperpayCheckoutInfo {
  checkoutId: string
  hyperpayBaseUrl: string
}

export function HyperpayCheckoutModal({
  open,
  onClose,
  checkout,
  amountLabel,
  resultPath = '/#/payment-result',
  onPayWithTamara,
  tamaraUnavailable,
  tamaraBusy,
}: {
  open: boolean
  onClose: () => void
  checkout: HyperpayCheckoutInfo | null
  /** e.g. "150.00 SAR" — shown above the widget so the customer knows what they're paying. */
  amountLabel?: string
  resultPath?: string
  /**
   * Re-opens this same purchase as a Tamara order and sends the browser there.
   *
   * Offered here rather than beside every "Pay" button because this modal is
   * the one thing all of them already funnel through — the subscription
   * renewal, the instant add-on and the approved add-on request — so one
   * instalment option reaches all three without each of them growing its own.
   *
   * Omitted entirely by a caller that has no Tamara path, which is what keeps
   * this backwards compatible for anything that has not been taught one.
   */
  onPayWithTamara?: () => void
  /**
   * Why instalments are not on offer for this particular charge, as the server
   * worded it — out of band, not configured, no mobile number on the account.
   * Present means the button is hidden and the reason shown quietly instead of
   * a button that would only fail.
   */
  tamaraUnavailable?: string | null
  tamaraBusy?: boolean
}) {
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (!open || !checkout) return

    ;(window as any).wpwlOptions = { paymentTarget: '_top' }

    const script = document.createElement('script')
    script.src = `${checkout.hyperpayBaseUrl}/v1/paymentWidgets.js?checkoutId=${checkout.checkoutId}`
    script.async = true
    document.body.appendChild(script)

    return () => {
      // `remove()` rather than `document.body.removeChild(script)`: the widget
      // rearranges the DOM around itself, and removing from an assumed parent
      // throws `NotFoundError` the moment that assumption stops holding.
      try {
        script.remove()
      } catch {
        /* Already gone is the outcome we wanted. */
      }
      // Cleared so a second checkout in the same session re-initialises rather
      // than rendering an empty box against the first one's globals.
      delete (window as any).wpwlOptions
      delete (window as any).wpwl
      delete (window as any).wpwlCallbacks
    }
  }, [open, checkout])

  return (
    <Modal open={open} onClose={onClose} title={translatePortalText('Secure payment')}>
      {amountLabel && <p className="mb-4 text-sm text-slate-500">{translatePortalText('Amount due:')} <span className="font-bold text-deep-900">{amountLabel}</span></p>}

      {/* Above the card form, not below it: COPYandPAY injects a form of
          unpredictable height, and an option pushed off the bottom of the
          modal is one nobody finds. */}
      {onPayWithTamara && !tamaraUnavailable && (
        <>
          <button
            type="button"
            disabled={tamaraBusy}
            onClick={onPayWithTamara}
            className="mb-2 w-full rounded-xl bg-deep-900 px-4 py-3 text-sm font-bold text-white hover:bg-deep-800 disabled:opacity-60"
          >
            {translatePortalText(tamaraBusy ? 'Opening Tamara…' : 'Pay in instalments with Tamara')}
          </button>
          <p className="mb-4 text-xs text-slate-400">
            {translatePortalText('You will be taken to Tamara to approve your plan, then brought back here.')}
          </p>
          <div className="mb-4 flex items-center gap-2 text-xs text-slate-400">
            <span className="h-px flex-1 bg-slate-200" />
            <span>{translatePortalText('or pay by card')}</span>
            <span className="h-px flex-1 bg-slate-200" />
          </div>
        </>
      )}
      {onPayWithTamara && tamaraUnavailable && (
        <p className="mb-4 text-xs text-slate-400">{translatePortalText(tamaraUnavailable)}</p>
      )}

      {checkout ? (
        <form
          ref={formRef}
          action={`${window.location.origin}${resultPath}`}
          className="paymentWidgets"
          data-brands="MADA VISA MASTER"
        />
      ) : (
        <p className="py-6 text-center text-sm text-slate-400">{translatePortalText('Preparing checkout…')}</p>
      )}
    </Modal>
  )
}

// ── Pending-checkout context, so PaymentResult.tsx knows what to confirm ────
// HyperPay's redirect only carries `resourcePath` (which embeds the checkout
// id) — not any of our own request fields — so the intent is stashed here
// right before the widget is shown and read back once the browser returns.

export type PendingCheckoutKind = 'addon' | 'addon_req' | 'subscription' | 'invite' | 'onboarding_subscription'

export interface PendingCheckout {
  kind: PendingCheckoutKind
  /** addOnId, packageId, or invite code depending on `kind`. */
  refId: string
  label: string
}

const STORAGE_KEY = 'bp-pending-checkout'

export function stashPendingCheckout(checkoutId: string, pending: PendingCheckout) {
  const all = readAllPending()
  all[checkoutId] = pending
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(all))
}

export function getPendingCheckout(checkoutId: string): PendingCheckout | null {
  const all = readAllPending()
  return all[checkoutId] || null
}

export function takePendingCheckout(checkoutId: string): PendingCheckout | null {
  const all = readAllPending()
  const found = all[checkoutId] || null
  if (found) {
    delete all[checkoutId]
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  }
  return found
}

function readAllPending(): Record<string, PendingCheckout> {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}

/** HyperPay's resourcePath looks like `/v1/checkouts/{id}/payment` — pull the id back out. */
export function checkoutIdFromResourcePath(resourcePath: string): string | null {
  const match = resourcePath.match(/\/v1\/checkouts\/([^/]+)\/payment/)
  return match ? match[1] : null
}
