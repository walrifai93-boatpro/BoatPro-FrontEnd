import React, { useEffect, useState } from 'react'
import { ShieldCheck, ShieldAlert, Gavel, RefreshCw } from 'lucide-react'
import { confirmAndRun } from '../async'
import { toast, Spinner } from '../ui'
import { standingApi, type AccountStanding as Standing, type RiskAppeal } from '../api'
import { translatePortalText, formatPortalNumber, formatPortalDate } from '../i18n/runtime'

/**
 * Account standing — what BoatPro's risk checks say about this provider, and
 * why. Mounted in every provider console.
 *
 * The risk engine's own design notes say a provider told "your score is 62"
 * cannot act on it, so this shows every event behind the number, when it stops
 * counting, and each decision made about the account — and lets the provider
 * appeal any of them once. An appeal reaches an admin on Risk & Fraud.
 */

const label = (s: string) => translatePortalText(s.replace(/_/g, ' '))
const when = (d?: string) => (d ? formatPortalDate(new Date(d), { dateStyle: 'medium' }) : '')

/** `RISK_FULL_WEIGHT_DAYS` on the API: after this an event's weight starts to fade, so "+30" is no longer what it adds. */
const FULL_WEIGHT_DAYS = 90
const isFading = (d?: string) => !!d && Date.now() - new Date(d).getTime() > FULL_WEIGHT_DAYS * 86_400_000

/** The server refuses a shorter appeal (`fileAppeal`); said in the dialog rather than after it closes. */
const APPEAL_MIN = 10

/** Plain-language names for the event types a provider may see. */
const EVENT_LABEL: Record<string, string> = {
  cash_disputed: 'A customer disputed a cash payment',
  commission_overdue: 'A commission statement went overdue',
  cancelled_after_cash_claim: 'A booking was cancelled after cash was recorded',
  abnormal_cash_ratio: 'Unusually high share of cash bookings',
  volume_spike: 'Sudden jump in booking volume',
  upheld_complaint: 'A complaint about you was upheld',
  shared_device: 'Account activity shared with other accounts',
  completed_without_checkin: 'A booking was completed without the customer checking in',
  chargeback: 'A card payment was charged back',
  document_tampering: 'A document failed verification',
  off_platform_contact: 'Deals moved outside BoatPro',
  linked_account: 'Details shared with another provider account',
  fake_reviews: 'Reviews judged not genuine',
  listing_fraud: 'A listing judged misleading',
}

function AppealState({ appeal }: { appeal?: RiskAppeal }) {
  if (!appeal) return null
  const tone = appeal.status === 'pending' ? 'bg-violet-50 text-violet-700' : appeal.status === 'upheld' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
  return (
    <div dir="auto" className={`mt-2 break-words rounded-lg px-2.5 py-1.5 text-[11.5px] ${tone}`}>
      <b>{translatePortalText(appeal.status === 'pending' ? 'Appeal under review' : appeal.status === 'upheld' ? 'Appeal accepted' : 'Appeal not accepted')}</b>
      {appeal.response ? ` — ${appeal.response}` : ''}
    </div>
  )
}

export default function AccountStanding() {
  const [data, setData] = useState<Standing | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      setData((await standingApi.mine()).data)
      setError('')
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not load your account standing'
      setError(message)
      // A refresh that fails over data already on screen says so, and keeps it.
      if (data) toast(translatePortalText(message), 'warn')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [])

  const appeal = async (target: 'event' | 'decision', id: string, what: string) => {
    await confirmAndRun({
      title: translatePortalText('Appeal this'),
      body: `${what}\n\n${translatePortalText('An admin will review your appeal and reply here. You can appeal each item once.')}`,
      confirmLabel: translatePortalText('Send appeal'),
      busyLabel: translatePortalText('Sending…'),
      input: {
        label: translatePortalText('Why is this wrong?'),
        placeholder: translatePortalText('e.g. The customer paid in cash at the marina — the receipt is attached to the booking.'),
        required: true,
        multiline: true,
        maxLength: 2000,
        validate: text => (text.trim().length < APPEAL_MIN ? translatePortalText('Explain what is wrong, in at least a sentence.') : undefined),
      },
      success: translatePortalText('Appeal sent'),
      run: async text => {
        await standingApi.appeal(target, id, text.trim())
        await load()
      },
    })
  }

  if (loading && !data) return <div className="flex justify-center py-20"><Spinner /></div>
  // A failed load used to render nothing at all — a blank page under the menu.
  if (!data) {
    return (
      <div className="mx-auto max-w-4xl p-4 md:p-6">
        <div role="alert" className="card p-6 text-center">
          <ShieldAlert size={26} className="mx-auto text-amber-500" />
          <p className="mt-2 font-bold text-deep-900">{translatePortalText('Could not load your account standing')}</p>
          {error && <p className="mt-1 text-sm text-slate-500">{translatePortalText(error)}</p>}
          <button onClick={() => void load()} className="btn-ghost mt-4 !py-1.5 !px-3 !text-[12px]"><RefreshCw size={13} /> {translatePortalText('Try again')}</button>
        </div>
      </div>
    )
  }

  const { thresholds: t } = data
  /*
    What the numbers say about money, beside what the risk events say. An
    overdue commission statement or a reached cash limit pauses cash bookings
    too, and this page called such an account "in good standing — nothing is
    counting against you" because it only looked at the score.
  */
  const owes = data.financialState === 'overdue' || data.financialState === 'limit_reached'
  const good = data.score < t.WARNING && !data.cashBlocked && !data.underReview && !owes
  const tone = data.score >= t.CASH_WITHDRAWN ? 'text-rose-600' : data.score >= t.WARNING ? 'text-amber-600' : 'text-emerald-600'
  const headline = good ? 'Your account is in good standing'
    : data.cashBlocked ? 'Cash bookings are paused on your account'
      : data.underReview ? 'Your account is being reviewed'
        : data.financialState === 'overdue' ? 'A commission statement is overdue'
          : data.financialState === 'limit_reached' ? 'You have reached your cash commission limit'
            : 'Your account has warnings'
  const explanation = data.underReview ? 'An admin is looking at recent activity on your account. Online bookings continue as normal.'
    : good ? 'Nothing is counting against you right now.'
      : data.financialState === 'overdue' ? 'Pay the overdue statement from Billing & Payments to keep cash bookings open. Online bookings are not affected.'
        : data.financialState === 'limit_reached' ? 'Cash bookings pause until the commission you owe is paid down. Online bookings are not affected. Settle it from Billing & Payments.'
          : 'The items below count against your account. They fade out over time, and you can appeal any you think are wrong.'

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-deep-900">{translatePortalText('Account standing')}</h1>
          <p className="text-sm text-slate-500">{translatePortalText('What BoatPro\'s trust checks say about your account, and why.')}</p>
        </div>
        <button onClick={() => void load()} disabled={loading} className="btn-ghost !py-1.5 !px-3 !text-[12px] disabled:opacity-60"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> {translatePortalText('Refresh')}</button>
      </div>

      <div className="card flex flex-wrap items-center gap-5 p-5">
        <span className={`grid h-14 w-14 place-items-center rounded-2xl ${good ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
          {good ? <ShieldCheck size={26} /> : <ShieldAlert size={26} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-extrabold text-deep-900">
            {translatePortalText(headline)}
          </p>
          <p dir="auto" className="mt-0.5 break-words text-[12.5px] text-slate-500">
            {data.cashBlockedReason ? translatePortalText(data.cashBlockedReason) : translatePortalText(explanation)}
          </p>
        </div>
        <div className="text-end">
          <p className={`font-display text-3xl font-extrabold ${tone}`}>{formatPortalNumber(data.score)}</p>
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText('risk score')}</p>
        </div>
      </div>

      <div className="card p-5">
        <p className="mb-2 text-[12px] font-bold text-deep-900">{translatePortalText('What the score means')}</p>
        <div className="grid gap-2 text-[12px] sm:grid-cols-3">
          <div className="rounded-xl bg-sand px-3 py-2"><b>{formatPortalNumber(t.WARNING)}+</b> · {translatePortalText('a warning')}</div>
          <div className="rounded-xl bg-sand px-3 py-2"><b>{formatPortalNumber(t.CASH_WITHDRAWN)}+</b> · {translatePortalText('cash bookings paused')}</div>
          <div className="rounded-xl bg-sand px-3 py-2"><b>{formatPortalNumber(t.REVIEW)}+</b> · {translatePortalText('an admin reviews the account')}</div>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">{translatePortalText('Each item counts in full for 90 days, then fades to nothing by one year.')}</p>
      </div>

      <section className="card p-5">
        <p className="mb-3 text-[13px] font-extrabold text-deep-900">{translatePortalText('Counting against you')} ({formatPortalNumber(data.events.length)})</p>
        {data.events.length === 0 && <p className="text-sm text-slate-400">{translatePortalText('Nothing.')}</p>}
        <div className="space-y-2">
          {data.events.map(e => (
            <div key={e._id} className="rounded-xl border border-slate-100 p-3">
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-bold text-deep-900">{translatePortalText(EVENT_LABEL[e.type] ?? label(e.type))} <span className="font-normal text-slate-400">· +{formatPortalNumber(e.weight)}{isFading(e.createdAt) ? ` (${translatePortalText('fading')})` : ''} · {when(e.createdAt)}</span></p>
                  <p dir="auto" className="mt-0.5 break-words text-[12px] text-slate-600">{e.detail}</p>
                </div>
                {!e.appeal && (
                  <button onClick={() => void appeal('event', e._id, e.detail)} className="btn-ghost !py-1 !px-2.5 !text-[11px]"><Gavel size={12} /> {translatePortalText('Appeal')}</button>
                )}
              </div>
              <AppealState appeal={e.appeal} />
            </div>
          ))}
        </div>
      </section>

      <section className="card p-5">
        <p className="mb-3 text-[13px] font-extrabold text-deep-900">{translatePortalText('Decisions about your account')}</p>
        {data.decisions.length === 0 && <p className="text-sm text-slate-400">{translatePortalText('None.')}</p>}
        <div className="space-y-2">
          {data.decisions.map(d => (
            <div key={d._id} className="rounded-xl border border-slate-100 p-3">
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-bold text-deep-900">{translatePortalText(d.summary)} <span className="font-normal text-slate-400">· {when(d.decidedAt)}</span></p>
                  {d.note && <p dir="auto" className="mt-0.5 break-words text-[12px] text-slate-600">{d.note}</p>}
                </div>
                {!d.appeal && (
                  <button onClick={() => void appeal('decision', d._id, d.summary)} className="btn-ghost !py-1 !px-2.5 !text-[11px]"><Gavel size={12} /> {translatePortalText('Appeal')}</button>
                )}
              </div>
              <AppealState appeal={d.appeal} />
            </div>
          ))}
        </div>
      </section>

      {data.dismissedEvents.length > 0 && (
        <section className="card p-5">
          <p className="mb-3 text-[13px] font-extrabold text-deep-900">{translatePortalText('Cleared — kept on record, not counted')}</p>
          <div className="space-y-1.5">
            {data.dismissedEvents.map(e => (
              <div key={e._id} className="rounded-lg bg-sand px-3 py-2 text-[12px] text-slate-600">
                <b>{translatePortalText(EVENT_LABEL[e.type] ?? label(e.type))}</b> · {when(e.createdAt)}{e.dismissReason ? ` — ${e.dismissReason}` : ''}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
