import React, { useState } from 'react'
import { AlertOctagon, AlertTriangle, ChevronDown, ChevronRight, CheckCircle2, ShieldCheck } from 'lucide-react'
import { translatePortalText, formatPortalDate, formatPortalNumber, formatPortalPercent } from '../i18n/runtime'

/**
 * What the automated reading noticed about a provider's documents, for the
 * person deciding whether to approve them.
 *
 * These findings used to block the provider from submitting at all, so a
 * reviewer never saw most of them — the application simply never arrived. Now
 * every application comes through and the findings come with it, which moves
 * the judgement to where it belonged and makes this panel the place that
 * judgement gets made. So it has to carry the reasoning, not just the verdict:
 * a reviewer told "checksum failed" has to go and work out why, which is the
 * work the reading was supposed to have already done.
 */

export interface DocumentFinding {
  code: string
  severity: 'info' | 'warning' | 'critical'
  message: string
  field?: string
  /** Why the reading concluded this — what it read, and what it compared. */
  detail?: string
}

export interface DocumentFindingGroup {
  docType: string
  label: string
  severity: 'warning' | 'critical'
  message?: string
  findings: DocumentFinding[]
  acknowledgedAt?: string
  acknowledgedNote?: string
  confidence?: number
}

export interface DocumentReview {
  current: DocumentFindingGroup[]
  submitted?: DocumentFindingGroup[]
  submittedAt?: string
  counts: { critical: number; warning: number; acknowledged: number; documents: number }
}

const TONE = {
  critical: {
    chip: 'bg-rose-50 text-rose-700 border-rose-200',
    rail: 'border-l-rose-400',
    icon: 'text-rose-500',
    Icon: AlertOctagon,
  },
  warning: {
    chip: 'bg-amber-50 text-amber-800 border-amber-200',
    rail: 'border-l-amber-400',
    icon: 'text-amber-600',
    Icon: AlertTriangle,
  },
  info: {
    chip: 'bg-sky-50 text-sky-700 border-sky-200',
    rail: 'border-l-sky-400',
    icon: 'text-sky-600',
    Icon: AlertTriangle,
  },
} as const

/** One finding: the claim, then the evidence for it in quieter type. */
function Finding({ finding }: { finding: DocumentFinding }) {
  const tone = TONE[finding.severity] ?? TONE.info
  const Icon = tone.Icon
  return (
    <div className={`flex items-start gap-2.5 border-s-2 ${tone.rail} ps-2.5 py-1`}>
      <Icon size={13} className={`shrink-0 mt-[3px] ${tone.icon}`} />
      <div className="min-w-0 flex-1">
        {/* Translated here as the summary below already does — the same finding
            read in English on the card and Arabic in the summary. */}
        <p className="text-[12px] font-bold leading-snug text-deep-900">{translatePortalText(finding.message)}</p>
        {finding.detail && (
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{translatePortalText(finding.detail)}</p>
        )}
      </div>
      <code className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-slate-400">
        {finding.code}
      </code>
    </div>
  )
}

/**
 * The findings for a single document, rendered inline on its card.
 *
 * Collapsed to a count by default. A reviewer scanning ten documents wants to
 * see which ones have something to say before reading any of them.
 */
export function DocumentFindingList({
  findings,
  severity,
  acknowledgedAt,
  acknowledgedNote,
  defaultOpen = false,
}: {
  findings?: DocumentFinding[]
  severity?: 'clear' | 'warning' | 'critical'
  acknowledgedAt?: string
  acknowledgedNote?: string
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  if (!findings?.length) return null

  const tone = TONE[severity === 'critical' ? 'critical' : 'warning']
  const criticals = findings.filter((f) => f.severity === 'critical').length

  return (
    <div className="mx-3.5 mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-slate-50"
      >
        {open ? (
          <ChevronDown size={13} className="shrink-0 text-slate-400" />
        ) : (
          <ChevronRight size={13} className="shrink-0 text-slate-400" />
        )}
        <span
          className={`rounded-md border px-1.5 py-0.5 text-[9.5px] font-black uppercase tracking-wide ${tone.chip}`}
        >
          {criticals > 0 ? `${formatPortalNumber(criticals)} ${translatePortalText('critical')}` : `${formatPortalNumber(findings.length)} ${translatePortalText('to review')}`}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-bold text-slate-600">
          {findings[0].message}
        </span>
        {acknowledgedAt && (
          <span className="shrink-0 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-slate-500">
            {translatePortalText('waived')}
          </span>
        )}
      </button>

      {open && (
        <div className="space-y-2 border-t border-slate-100 bg-slate-50/40 px-2.5 py-2.5">
          {findings.map((f, i) => (
            <Finding key={`${f.code}-${i}`} finding={f} />
          ))}
          {acknowledgedAt && (
            <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2">
              <CheckCircle2 size={13} className="mt-[2px] shrink-0 text-slate-400" />
              <p className="text-[11px] leading-relaxed text-slate-500">
                {translatePortalText('The provider read these findings and submitted anyway on')}{' '}
                <span className="font-bold text-slate-600">
                  {formatPortalDate(acknowledgedAt)}
                </span>
                {acknowledgedNote ? <> — “{acknowledgedNote}”</> : '.'}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * The rollup above the document list: what needs a human, at a glance.
 *
 * Deliberately not hidden behind a click. The whole point of letting the
 * application through is that this is now the first thing a reviewer reads.
 */
export function DocumentFindingsSummary({ review }: { review?: DocumentReview | null }) {
  const [showSubmitted, setShowSubmitted] = useState(false)
  if (!review) return null

  const { counts, current, submitted, submittedAt } = review

  /*
    "Cleared every document" was printed whenever there were no findings —
    including for an applicant with no documents at all, and for documents the
    reading never ran on (the API reports an unread document as `clear`). Both
    read to a reviewer as a pass that never happened.
  */
  if ((counts?.documents ?? 0) === 0) {
    return (
      <div className="flex items-center gap-2.5 rounded-2xl border border-amber-200 bg-amber-50/70 px-3.5 py-2.5">
        <AlertTriangle size={15} className="shrink-0 text-amber-600" />
        <p className="text-[12px] font-bold text-amber-800">
          {translatePortalText('No documents on file — there was nothing for the automated reading to check.')}
        </p>
      </div>
    )
  }

  if (current.length === 0) {
    return (
      <div className="flex items-start gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-3.5 py-2.5">
        <ShieldCheck size={15} className="mt-[1px] shrink-0 text-emerald-600" />
        <div>
          <p className="text-[12px] font-bold text-emerald-800">
            {translatePortalText('No AI findings on the documents on file.')}
          </p>
          <p className="text-[11px] text-emerald-700/80">
            {translatePortalText('A document the AI has not read also has no findings — open each one before approving.')}
          </p>
        </div>
      </div>
    )
  }

  // What was true at submission versus now. Worth surfacing only when they
  // disagree — a provider who replaced a document after submitting has
  // answered a finding, and a reviewer chasing the old one wastes the trip.
  const changed =
    !!submitted && submitted.length !== current.length

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-3.5 py-2.5">
        <p className="me-auto text-[11px] font-black uppercase tracking-wide text-slate-500">
          {translatePortalText('Document findings')}
        </p>
        {counts.critical > 0 && (
          <span className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10.5px] font-black text-rose-700">
            {formatPortalNumber(counts.critical)} {translatePortalText('critical')}
          </span>
        )}
        {counts.warning > 0 && (
          <span className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10.5px] font-black text-amber-800">
            {formatPortalNumber(counts.warning)} {translatePortalText('to review')}
          </span>
        )}
        {counts.acknowledged > 0 && (
          <span className="rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-[10.5px] font-black text-slate-500">
            {formatPortalNumber(counts.acknowledged)} {translatePortalText('waived by provider')}
          </span>
        )}
      </div>

      <div className="divide-y divide-slate-100">
        {current.map((group, gi) => {
          const tone = TONE[group.severity] ?? TONE.warning
          const Icon = tone.Icon
          return (
            // Index in the key: the API sends one group per document row, and a
            // type with an older version on file appears more than once.
            <div key={`${group.docType}-${gi}`} className="flex items-start gap-2.5 px-3.5 py-2.5">
              <Icon size={14} className={`mt-[2px] shrink-0 ${tone.icon}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-[12px] font-extrabold text-deep-900">{translatePortalText(group.label)}</p>
                  {group.acknowledgedAt && (
                    <span className="shrink-0 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500">
                      {translatePortalText('waived')}
                    </span>
                  )}
                  {typeof group.confidence === 'number' && (
                    <span className="shrink-0 text-[10px] font-bold text-slate-400">
                      {formatPortalPercent(Math.round(group.confidence * 100))} {translatePortalText('confident')}
                    </span>
                  )}
                </div>
                <ul className="mt-1 space-y-1">
                  {(group.findings ?? []).map((f, i) => (
                    <li key={`${f.code}-${i}`} className="text-[11.5px] leading-snug text-slate-600">
                      <span className="font-bold text-slate-700">{translatePortalText(f.message)}</span>
                      {f.detail && <span className="text-slate-500"> {translatePortalText(f.detail)}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )
        })}
      </div>

      {changed && (
        <div className="border-t border-slate-100 bg-slate-50/60 px-3.5 py-2">
          <button
            onClick={() => setShowSubmitted((v) => !v)}
            className="flex w-full items-center gap-1.5 text-left text-[11px] font-bold text-slate-500 hover:text-slate-700"
          >
            {showSubmitted ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {formatPortalNumber(submitted!.length)} {translatePortalText(submitted!.length === 1 ? 'finding at submission' : 'findings at submission')}
            {submittedAt ? ` (${formatPortalDate(submittedAt)})` : ''} — {translatePortalText('documents have changed since')}
          </button>
          {showSubmitted && (
            <ul className="mt-2 space-y-1 ps-5">
              {submitted!.map((g, i) => (
                <li key={`${g.docType}-${i}`} className="text-[11px] text-slate-500">
                  <span className="font-bold text-slate-600">{translatePortalText(g.label)}:</span> {translatePortalText(g.message || '')}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
