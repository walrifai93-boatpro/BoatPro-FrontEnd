import React from 'react'
import {
  FileWarning, MessageSquareWarning, Phone, MessageCircleWarning, Link2, Users, Images, BadgeDollarSign,
  ShieldAlert, CreditCard, RefreshCcw, Undo2, ExternalLink, Sparkles, type LucideIcon,
} from 'lucide-react'
import { fileUrl, type ContentFlag } from '../../../api'
import { translatePortalText, formatPortalNumber, formatPortalDate } from '../../../i18n/runtime'

/**
 * What each Risk & Fraud case kind is, and what its two decisions do.
 *
 * The confirm/clear bodies are what the admin reads before acting, so they say
 * exactly what the server will do — including who is told and whether a risk
 * score moves. Keep them in step with `HANDLERS` in contentFlags.service.ts.
 */
export interface KindMeta {
  label: string
  icon: React.ReactNode
  tone: string
  confirm: string
  clear: string
  confirmBody: string
  clearBody: string
  /** The confirm note is shown to the account owner, so it is required. */
  confirmNoteRequired?: boolean
  confirmNoteLabel?: string
}

const I = (C: LucideIcon) => <C size={18} />

export const KIND_META: Record<string, KindMeta> = {
  abusive_review: {
    label: 'Abusive review', icon: I(MessageSquareWarning), tone: 'bg-rose-50 text-rose-600',
    confirm: 'Keep hidden', clear: 'Restore review',
    confirmBody: 'The review stays hidden for good and the author is told it breaks the guidelines.',
    clearBody: 'The review is published again and counts toward ratings. The same text will not be flagged again.',
  },
  suspicious_document: {
    label: 'Suspicious document', icon: I(FileWarning), tone: 'bg-amber-50 text-amber-600',
    confirm: 'Reject as false', clear: 'Clear',
    confirmBody: 'The document is rejected and the owner is told why. If a provider filed it, a document tampering event is added to their risk score.',
    clearBody: 'Nothing is held against the owner. The document goes back to the normal review queue.',
    confirmNoteRequired: true, confirmNoteLabel: 'Reason shown to the owner',
  },
  off_platform_contact: {
    label: 'Off-platform deal', icon: I(Phone), tone: 'bg-orange-50 text-orange-600',
    confirm: 'Confirm & warn', clear: 'Clear',
    confirmBody: 'The sender gets a formal warning. A provider also gets an off-platform contact event on their risk score.',
    clearBody: 'Nothing is recorded. Only messages sent after today count toward a new case.',
  },
  abusive_chat: {
    label: 'Abusive chat', icon: I(MessageCircleWarning), tone: 'bg-rose-50 text-rose-600',
    confirm: 'Confirm & warn', clear: 'Clear',
    confirmBody: 'The sender gets a formal warning. A provider also gets an upheld-complaint event on their risk score.',
    clearBody: 'Nothing is recorded. Only messages sent after today count toward a new case.',
  },
  linked_accounts: {
    label: 'Linked accounts', icon: I(Link2), tone: 'bg-violet-50 text-violet-600',
    confirm: 'Confirm link', clear: 'Not linked',
    confirmBody: 'Each provider account in the set gets a linked-account event on its risk score. Nobody is told which detail linked them.',
    clearBody: 'These accounts are treated as legitimately separate. The same set is not raised again.',
  },
  review_ring: {
    label: 'Fake review ring', icon: I(Users), tone: 'bg-fuchsia-50 text-fuchsia-600',
    confirm: 'Remove reviews', clear: 'Reviews are genuine',
    confirmBody: 'Every listed review is hidden, the provider\'s rating is recalculated, and they get a fake-reviews event on their risk score.',
    clearBody: 'The reviews stay. These reviews will not be raised again.',
  },
  listing_photo_reuse: {
    label: 'Copied photos', icon: I(Images), tone: 'bg-sky-50 text-sky-600',
    confirm: 'Pause listing', clear: 'Photos are fine',
    confirmBody: 'Every listing in this case is taken off BoatPro, the provider is told why, and they get a listing-fraud event on their risk score.',
    clearBody: 'The listings stay live. These photos will not be raised again.',
    confirmNoteLabel: 'Reason shown to the provider (optional)',
  },
  listing_price_anomaly: {
    label: 'Bait price', icon: I(BadgeDollarSign), tone: 'bg-emerald-50 text-emerald-600',
    confirm: 'Pause listing', clear: 'Price is genuine',
    confirmBody: 'Every trip in this case is paused, the provider is told why, and they get a listing-fraud event on their risk score.',
    clearBody: 'The trips stay live at these prices. Only a later, lower price is flagged again.',
    confirmNoteLabel: 'Reason shown to the provider (optional)',
  },
  provider_risk: {
    label: 'Provider risk case', icon: I(ShieldAlert), tone: 'bg-rose-50 text-rose-700',
    confirm: 'Close as confirmed', clear: 'Close as fine',
    confirmBody: 'Records that you reviewed this provider and the concern stands. Nothing else changes automatically — suspend from the enforcement console if needed.',
    clearBody: 'Records that you reviewed this provider and found nothing wrong. To clear the score itself, dismiss the events behind it.',
  },
  chargeback_pattern: {
    label: 'Chargeback pattern', icon: I(CreditCard), tone: 'bg-rose-50 text-rose-600',
    confirm: 'Block account', clear: 'Dismiss',
    confirmBody: 'The customer account is deactivated and can no longer sign in.',
    clearBody: 'Nothing changes for the customer.',
  },
  cancellation_bot: {
    label: 'Rapid booking & cancel', icon: I(RefreshCcw), tone: 'bg-orange-50 text-orange-600',
    confirm: 'Block account', clear: 'Dismiss',
    confirmBody: 'The customer account is deactivated and can no longer sign in.',
    clearBody: 'Nothing changes for the customer.',
  },
  refund_abuse: {
    label: 'High refund volume', icon: I(Undo2), tone: 'bg-amber-50 text-amber-600',
    confirm: 'Block account', clear: 'Dismiss',
    confirmBody: 'The customer account is deactivated and can no longer sign in.',
    clearBody: 'Nothing changes for the customer.',
  },
}

export const FLAG_KINDS = [
  'suspicious_document', 'abusive_review', 'off_platform_contact', 'abusive_chat',
  'linked_accounts', 'review_ring', 'listing_photo_reuse', 'listing_price_anomaly', 'provider_risk',
] as const
export const CUSTOMER_KINDS = ['chargeback_pattern', 'cancellation_bot', 'refund_abuse'] as const

export const SEVERITY_STYLE: Record<string, string> = {
  Critical: 'bg-rose-100 text-rose-700 ring-rose-300',
  High: 'bg-orange-50 text-orange-600 ring-orange-200',
  Medium: 'bg-amber-50 text-amber-600 ring-amber-200',
}

export const label = (s?: string) => translatePortalText(String(s ?? '').replace(/_/g, ' '))
export const nameOf = (x: unknown): string | undefined =>
  x && typeof x === 'object' ? ((x as any).business?.businessName || (x as any).name) : undefined
export const roleLabel = (role?: string) =>
  !role ? '' : role === 'customer' ? 'Customer' : role.endsWith('_provider') ? 'Provider' : role.replace(/_/g, ' ')
export const when = (d?: string) => (d ? formatPortalDate(new Date(d), { dateStyle: 'medium', timeStyle: 'short' }) : '')

const AI_STYLE: Record<string, { tone: string; label: string }> = {
  likely_fraud: { tone: 'border-rose-200 bg-rose-50/60 text-rose-800', label: 'AI: likely fraud' },
  likely_innocent: { tone: 'border-emerald-200 bg-emerald-50/60 text-emerald-800', label: 'AI: likely innocent' },
  unclear: { tone: 'border-slate-200 bg-slate-50 text-slate-700', label: 'AI: unclear' },
}
const ACTION_LABEL: Record<string, string> = { confirm: 'suggests confirming', clear: 'suggests clearing', investigate: 'suggests a closer look' }

/**
 * The AI's second opinion on a case. Advisory by design — it sits beside the
 * evidence, never replaces it, and the admin's decision is the one that counts.
 */
export function AiOpinionStrip({ flag, onAsk, asking }: { flag: ContentFlag; onAsk?: () => void; asking?: boolean }) {
  const ai = flag.evidence?.ai
  if (!ai) {
    return onAsk ? (
      <button onClick={onAsk} disabled={asking} className="inline-flex items-center gap-1 text-[11px] font-bold text-ocean-700 hover:underline disabled:opacity-50">
        <Sparkles size={11} /> {translatePortalText(asking ? 'Asking the AI…' : 'Ask the AI for a second opinion')}
      </button>
    ) : null
  }
  const s = AI_STYLE[ai.verdict] ?? AI_STYLE.unclear
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-[11.5px] ${s.tone}`}>
      <Sparkles size={12} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <b>{translatePortalText(s.label)}</b>
        <span className="opacity-70"> · {formatPortalNumber(Math.round(ai.confidence * 100))}% · {translatePortalText(ACTION_LABEL[ai.suggestedAction] ?? '')}</span>
        <p className="mt-0.5">{ai.summary}</p>
      </div>
      {onAsk && (
        <button onClick={onAsk} disabled={asking} className="shrink-0 text-[10.5px] font-bold underline opacity-70 hover:opacity-100 disabled:opacity-40">
          {translatePortalText(asking ? 'Asking…' : 'Ask again')}
        </button>
      )}
    </div>
  )
}

/** What each chat signal is called on a sample. */
const KIND_LABELS: Record<string, string> = {
  price_offer: 'price offer', off_app_deal: 'outside the app', ai_side_deal: 'deal (AI)', ai_contact: 'contact (AI)',
  payment_app: 'payment app', iban: 'IBAN', whatsapp: 'WhatsApp', telegram: 'Telegram',
}

const Row = ({ children }: { children: React.ReactNode }) => (
  <div className="flex items-start gap-2 rounded-lg bg-sand px-2.5 py-1.5 text-[11.5px] text-slate-600">{children}</div>
)
const Dot = ({ severity }: { severity?: string }) => (
  <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${severity === 'Critical' ? 'bg-rose-500' : severity === 'High' ? 'bg-orange-500' : 'bg-amber-400'}`} />
)

/**
 * The evidence for one case, drawn to suit its kind. `compact` is the queue
 * card: the first few items only, with the rest one click away in Details.
 */
export function FlagEvidence({ flag, compact = false }: { flag: ContentFlag; compact?: boolean }) {
  const ev = flag.evidence ?? {}
  switch (flag.kind) {
    case 'suspicious_document':
      return (
        <div className="space-y-1.5">
          {(ev.reasons ?? []).map((r, j) => <Row key={j}><Dot severity={r.severity} /><span>{r.detail}</span></Row>)}
          <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] text-slate-500">
            {ev.fraudScore != null && <span>{translatePortalText('Fraud score')} <b className="text-deep-900">{formatPortalNumber(ev.fraudScore)}</b>/100</span>}
            {flag.subjectStatus && <span>{translatePortalText('Document')}: <b className="text-deep-900">{label(flag.subjectStatus)}</b></span>}
            {ev.fileUrl && (
              <a href={fileUrl(ev.fileUrl)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-bold text-ocean-700 hover:underline">
                <ExternalLink size={11} /> {translatePortalText('Open document')}
              </a>
            )}
          </div>
        </div>
      )

    case 'abusive_review':
      return (
        <div>
          <blockquote className="rounded-lg border-s-2 border-rose-200 bg-sand px-3 py-2 text-[12px] text-slate-700">
            {ev.rating != null && <span className="me-2 text-amber-500">{'★'.repeat(ev.rating)}{'☆'.repeat(Math.max(0, 5 - ev.rating))}</span>}
            {ev.excerpt}
          </blockquote>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
            {(ev.categories ?? []).map(c => <span key={c} className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-600">{label(c)}</span>)}
            <span>· {translatePortalText(ev.source === 'wordlist' ? 'Matched the word list' : 'Flagged by the AI model')}</span>
            {ev.targetType && <span>· {translatePortalText('Review of')} {label(ev.targetType)}</span>}
            {flag.subjectStatus && <span>· {translatePortalText('Review is')} <b className="text-deep-900">{label(flag.subjectStatus)}</b></span>}
          </div>
        </div>
      )

    case 'off_platform_contact':
    case 'abusive_chat':
      return (
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-3 text-[11px] text-slate-500">
            <span><b className="text-deep-900">{formatPortalNumber(ev.count ?? 0)}</b> {translatePortalText('messages in 30 days')}</span>
            {ev.threadCount != null && <span><b className="text-deep-900">{formatPortalNumber(ev.threadCount)}</b> {translatePortalText('conversations')}</span>}
            {ev.paymentRoute && <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-600">{translatePortalText('Bank details or payment app shared')}</span>}
          </div>
          {(ev.samples ?? []).slice(0, compact ? 2 : 8).map(s => (
            <Row key={s.messageId}>
              <span className="shrink-0 text-[10px] text-slate-400">{when(s.at)}</span>
              <span className="min-w-0 flex-1 break-words">
                {s.text}
                {s.aiReason && !compact && <span className="mt-0.5 block text-[10.5px] italic text-slate-400">{translatePortalText('AI')}: {s.aiReason}</span>}
              </span>
              {(s.kinds ?? []).map(k => <span key={k} className="shrink-0 rounded bg-white px-1 text-[10px] font-bold text-orange-600">{translatePortalText(KIND_LABELS[k] ?? label(k))}</span>)}
            </Row>
          ))}
        </div>
      )

    case 'linked_accounts':
      return (
        <div className="space-y-1.5">
          {(ev.matches ?? []).map((m, j) => (
            <Row key={j}><Dot severity={m.type === 'phone' ? 'Medium' : 'High'} />
              <span><b className="text-deep-900">{label(m.type)}</b> {m.masked} <span className="text-slate-400">· {(m.sources ?? []).join(', ')}</span></span>
            </Row>
          ))}
          <div className="grid gap-1.5 sm:grid-cols-2">
            {(ev.accounts ?? []).map(a => (
              <div key={a.id} className={`rounded-lg border px-2.5 py-1.5 text-[11px] ${a.blocked ? 'border-rose-200 bg-rose-50/50' : 'border-slate-100'}`}>
                <p className="font-bold text-deep-900">{a.name} {a.blocked && <span className="text-[10px] text-rose-600">· {translatePortalText('blocked')}</span>}</p>
                <p className="text-slate-400">{a.email} · {label(a.role)}{a.createdAt ? ` · ${translatePortalText('joined')} ${formatPortalDate(new Date(a.createdAt), { dateStyle: 'medium' })}` : ''}</p>
              </div>
            ))}
          </div>
        </div>
      )

    case 'review_ring':
      return (
        <div className="space-y-1.5">
          {(ev.reviews ?? []).slice(0, compact ? 3 : undefined).map(r => (
            <Row key={r.id}>
              <span className={`shrink-0 rounded px-1 text-[10px] font-bold ${r.reason === 'new_account' ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>
                {translatePortalText(r.reason === 'new_account' ? `${r.accountAgeDays}-day-old account` : r.reason === 'shares_phone' ? 'Shares provider\'s phone' : 'Shares provider\'s bank')}
              </span>
              <span className="min-w-0 flex-1"><b className="text-deep-900">{r.authorName}</b> · <span className="text-amber-500">★★★★★</span> {r.excerpt}</span>
              <span className="shrink-0 text-[10px] text-slate-400">{when(r.at)}</span>
            </Row>
          ))}
        </div>
      )

    case 'listing_photo_reuse': {
      const matches = ev.matches ?? []
      return (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {matches.slice(0, compact ? 3 : 12).map((m, j) => (
              <div key={j} className="rounded-lg border border-slate-100 p-2">
                <div className="flex gap-1.5">
                  {m.url && <img src={fileUrl(m.url)} alt="" className="h-16 w-1/2 rounded object-cover" />}
                  {m.otherUrl && <img src={fileUrl(m.otherUrl)} alt="" className="h-16 w-1/2 rounded object-cover" />}
                </div>
                <p className="mt-1 truncate text-[10.5px] text-slate-500">
                  <b className="text-deep-900">{m.listing?.name ?? ev.listing?.name}</b> ↔ {m.other?.name}
                </p>
                <p className="text-[10px] text-slate-400">{translatePortalText(m.exact ? 'Same file' : 'Same photo, re-saved or resized')}</p>
              </div>
            ))}
          </div>
          {compact && matches.length > 3 && (
            <p className="text-[11px] text-slate-400">{translatePortalText(`+ ${matches.length - 3} more — open Details to see them all`)}</p>
          )}
          {flag.subjectStatus && <p className="text-[11px] text-slate-500">{translatePortalText('Listings')}: <b className="text-deep-900">{label(flag.subjectStatus)}</b></p>}
        </div>
      )
    }

    case 'listing_price_anomaly': {
      // Grouped cases list every trip; older cases carried one trip on `listing`.
      const rows = ev.listings?.length ? ev.listings : ev.listing ? [{ ...ev.listing, price: ev.rate, unit: ev.unit, median: ev.median, pctOfMedian: ev.pctOfMedian, city: ev.city, currency: 'SAR' }] : []
      const shown = compact ? rows.slice(0, 3) : rows
      return (
        <div className="space-y-1.5">
          <div className="overflow-hidden rounded-lg border border-slate-100">
            <table className="w-full text-[11.5px]">
              <thead className="bg-sand text-[10px] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-2.5 py-1.5 text-start">{translatePortalText('Trip')}</th>
                  <th className="px-2.5 py-1.5 text-end">{translatePortalText('Price')}</th>
                  <th className="px-2.5 py-1.5 text-end">{translatePortalText('Usual price')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(r => (
                  <tr key={r.id} className="border-t border-slate-50">
                    <td className="max-w-[260px] truncate px-2.5 py-1.5 font-semibold text-deep-900">{r.name}</td>
                    <td className="px-2.5 py-1.5 text-end font-bold text-rose-600">{formatPortalNumber(r.price ?? 0)} {r.currency ?? 'SAR'} <span className="font-normal text-slate-400">{translatePortalText(r.unit ?? '')}</span></td>
                    <td className="px-2.5 py-1.5 text-end text-slate-600">{formatPortalNumber(r.median ?? 0)} {r.currency ?? 'SAR'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {compact && rows.length > 3 && <p className="text-[11px] text-slate-400">{translatePortalText(`+ ${rows.length - 3} more trips — open Details to see them all`)}</p>}
          {flag.subjectStatus && <p className="text-[11px] text-slate-500">{translatePortalText('Trips')}: <b className="text-deep-900">{label(flag.subjectStatus)}</b></p>}
        </div>
      )
    }

    case 'provider_risk':
      return (
        <div className="space-y-1">
          {(ev.breakdown ?? []).map(b => (
            <Row key={b.type}><span className="flex-1">{formatPortalNumber(b.count)}× {label(b.type)}</span><b className="text-deep-900">+{formatPortalNumber(b.contribution)}</b></Row>
          ))}
        </div>
      )

    default: {
      // Customer abuse patterns: small numeric evidence, shown as-is.
      const entries = Object.entries(ev).filter(([k, v]) => typeof v === 'number' && k !== 'decisionNote')
      return entries.length ? (
        <div className="flex flex-wrap gap-3 text-[11.5px] text-slate-600">
          {entries.map(([k, v]) => <span key={k}>{label(k)} <b className="text-deep-900">{formatPortalNumber(Math.round(Number(v)))}</b></span>)}
        </div>
      ) : null
    }
  }
}
