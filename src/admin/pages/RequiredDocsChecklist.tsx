import React from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Clock, FileX2, XCircle } from 'lucide-react'
import type { ApiApplicantDocChecklist, ApiApplicantDocSlot } from '../../api'
import { translatePortalText, formatPortalNumber } from '../../i18n/runtime'

/**
 * An applicant's documents against the checklist as the admin has it set
 * today — so the reviewer sees what is still owed rather than only what was
 * uploaded, including anything made required after the provider submitted.
 */

const STATUS: Record<ApiApplicantDocSlot['status'], { label: string; cls: string; icon: React.ReactNode }> = {
  approved: { label: 'Approved', cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', icon: <CheckCircle2 size={12} /> },
  pending: { label: 'Awaiting review', cls: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200', icon: <Clock size={12} /> },
  rejected: { label: 'Rejected', cls: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200', icon: <XCircle size={12} /> },
  missing: { label: 'Not uploaded', cls: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200', icon: <FileX2 size={12} /> },
}

function Slot({ slot, required }: { slot: ApiApplicantDocSlot; required: boolean }) {
  const s = STATUS[slot.status]
  // An optional document nobody uploaded is not a problem, so it is not painted as one.
  const quiet = !required && slot.status === 'missing'
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2">
      <span className="text-[13px] font-semibold text-deep-900">{translatePortalText(slot.label)}</span>
      <span className={`chip ${quiet ? 'bg-slate-100 text-slate-500' : s.cls}`}>{s.icon}{translatePortalText(s.label)}</span>
    </div>
  )
}

export function RequiredDocsChecklist({ checklist }: { checklist?: ApiApplicantDocChecklist | null }) {
  if (!checklist) return null
  const { required, optional, outstanding } = checklist

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="label !mb-0">{translatePortalText('Document checklist')}</p>
        <span className={`text-[11px] font-bold ${outstanding.length ? 'text-rose-600' : 'text-emerald-600'}`}>
          {required.length === 0
            ? translatePortalText('No documents required')
            : outstanding.length
              ? `${formatPortalNumber(outstanding.length)} / ${formatPortalNumber(required.length)} ${translatePortalText('pending')}`
              : `${formatPortalNumber(required.length)} / ${formatPortalNumber(required.length)} ${translatePortalText('Approved')}`}
        </span>
      </div>
      {required.length > 0 && (
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-100">
          {required.map((slot) => <Slot key={slot.docType} slot={slot} required />)}
        </div>
      )}
      {optional.length > 0 && (
        <>
          <p className="mb-1 mt-3 text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-400">{translatePortalText('Optional')}</p>
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-100">
            {optional.map((slot) => <Slot key={slot.docType} slot={slot} required={false} />)}
          </div>
        </>
      )}
      <p className="mt-2 text-[11px] text-slate-400">
        <Link to="/admin/required-documents" className="font-semibold text-ocean-600 hover:underline">{translatePortalText('Required Documents')}</Link>.
      </p>
    </div>
  )
}
