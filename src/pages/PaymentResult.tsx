import React, { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { addOnApi, addOnRequestApi, monetizationApi, planInviteApi, onboardingApi } from '../api'
import { checkoutIdFromResourcePath, getPendingCheckout, takePendingCheckout } from '../payments/HyperpayCheckout'
import { toApiError } from '../async/errors'
import { translatePortalText } from '../i18n/runtime'


/**
 * Landing page HyperPay's widget navigates the whole browser to after a card
 * is submitted (see HyperpayCheckoutModal — COPYandPAY is redirect-based, not
 * in-page AJAX). Reads `resourcePath`, recovers what was being paid for from
 * the pending-checkout stash, calls the matching confirm endpoint, then sends
 * the provider back to where they started.
 */
export default function PaymentResult() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [state, setState] = useState<'working' | 'success' | 'error'>('working')
  const [message, setMessage] = useState('Confirming your payment…')

  useEffect(() => {
    // Robust extraction: query params can be on the window search or the hash search
    const searchParams = new URLSearchParams(window.location.search)
    const hashQuery = window.location.hash.includes('?') ? window.location.hash.split('?')[1] : ''
    const hashParams = new URLSearchParams(hashQuery)

    const resourcePath =
      params.get('resourcePath') ||
      hashParams.get('resourcePath') ||
      searchParams.get('resourcePath') ||
      ''

    const idFromQuery =
      params.get('id') ||
      hashParams.get('id') ||
      searchParams.get('id') ||
      ''

    /*
      A Tamara return. The server's /pay/tamara/return authorises and captures
      the order, then redirects here with its id - so from this point the flow
      is identical to the card one: look up what was being bought and call the
      matching confirm endpoint, which now accepts either gateway's reference.

      Read first, because a Tamara redirect carries no `resourcePath` and no
      `id`, and the pending purchase was stashed against this order id.
    */
    const orderId =
      params.get('orderId') ||
      hashParams.get('orderId') ||
      searchParams.get('orderId') ||
      ''

    const checkoutId = orderId || idFromQuery || (resourcePath ? checkoutIdFromResourcePath(resourcePath) : null)

    if (!checkoutId && !resourcePath) {
      setState('error')
      setMessage('This payment link is missing information — please try again.')
      return
    }

    const targetCheckoutId = checkoutId || ''
    const pending = targetCheckoutId ? getPendingCheckout(targetCheckoutId) : null

    ;(async () => {
      const doConfirm = async () => {
        if (pending?.kind === 'addon') {
          return await addOnApi.purchaseConfirm(pending.refId, targetCheckoutId)
        } else if (pending?.kind === 'addon_req') {
          return await addOnRequestApi.purchaseConfirm(pending.refId, targetCheckoutId)
        } else if (pending?.kind === 'subscription') {
          return await monetizationApi.confirmSubscriptionPayment(targetCheckoutId, pending.refId || undefined)
        } else if (pending?.kind === 'invite') {
          return await planInviteApi.redeem(pending.refId, targetCheckoutId)
        } else {
          return await onboardingApi.paySubscription(targetCheckoutId)
        }
      }

      /**
       * The single retry exists for one case: the gateway has taken the card
       * but our own record of it has not caught up yet, which is what a 3-D
       * Secure round trip can leave behind for a second or two. It used to fire
       * on *every* failure, which is the wrong shape twice over.
       *
       * A declined card is a settled answer, not a race — retrying it only
       * delays telling the customer. And `doConfirm` for an add-on, an add-on
       * request or a plan invite calls a purchase/redeem endpoint, so a blind
       * second attempt after an ambiguous failure (a connection dropped *after*
       * the server committed) is the classic way to apply something twice.
       *
       * Retried only where a retry could plausibly change the answer: the
       * request did not arrive or the server broke (`retryable`), or the record
       * genuinely is not there yet (404) — which is exactly the synchronising
       * case this was written for.
       */
      const worthRetrying = (err: unknown) => {
        const api = toApiError(err)
        return api.retryable || api.status === 404
      }

      try {
        let firstError: unknown = null
        try {
          await doConfirm()
        } catch (err) {
          if (!worthRetrying(err)) throw err
          firstError = err
          await new Promise((r) => setTimeout(r, 1500))
          try {
            await doConfirm()
          } catch {
            // The first answer is the one that described what actually went
            // wrong; the retry's is a second-order symptom of the same thing.
            // Reporting the retry's error meant a customer whose card was
            // declined could be told the checkout could not be found.
            throw firstError
          }
        }
        if (targetCheckoutId) takePendingCheckout(targetCheckoutId)
        setState('success')
        setMessage(`${pending?.label || 'Subscription'} — payment received.`)
      } catch (e) {
        setState('error')
        setMessage(toApiError(e).message)
      }
    })()

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])


  return (
    <div className="grid min-h-screen place-items-center bg-sand p-4">
      <div className="card w-full max-w-sm p-8 text-center">
        {state === 'working' && <Loader2 size={40} className="mx-auto mb-4 animate-spin text-ocean-500" />}
        {state === 'success' && <CheckCircle2 size={40} className="mx-auto mb-4 text-emerald-500" />}
        {state === 'error' && <XCircle size={40} className="mx-auto mb-4 text-rose-500" />}
        <h1 className="font-display text-lg font-bold text-deep-900">
          {translatePortalText(state === 'working' ? 'Confirming payment…' : state === 'success' ? 'Payment successful' : 'Payment issue')}
        </h1>
        <p className="mt-2 text-sm text-slate-500">{translatePortalText(message)}</p>
        {state === 'success' && (
          <button className="btn-primary mt-6 w-full !justify-center font-bold" onClick={() => navigate('/')}>
            {translatePortalText("Go to Provider Dashboard\r\n          ")}</button>
        )}
        {/* Said "Return to Payment Screen" and went to the dashboard, which is
            not a payment screen and not where the customer was. */}
        {state === 'error' && (
          <button className="btn-primary mt-6 w-full !justify-center font-bold" onClick={() => navigate('/')}>
            {translatePortalText("Back to Dashboard\r\n          ")}</button>
        )}

      </div>
    </div>
  )
}

