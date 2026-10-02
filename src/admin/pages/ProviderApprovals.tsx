import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { TableToolbar, useTableFilters, NoFilterMatches, type TableFiltersConfig } from '../../shared/TableFilters'
import { motion } from 'framer-motion'
import { ShieldCheck, Check, X, Ban, MapPin, Building2, Mail, Phone, RefreshCw, Sparkles, FileText, ExternalLink, AlertTriangle, Eye, BellRing } from 'lucide-react'
import { PageWrap, vatCertificateLabel } from './_shared'
import { AdminHeader, ABadge } from '../adminUi'
import { DocumentFindingList, DocumentFindingsSummary, type DocumentReview } from '../DocumentFindings'
import { RequiredDocsChecklist } from './RequiredDocsChecklist'
import type { ApiApplicantDocChecklist } from '../../api'
import { Modal, toast, Counter, CardGridSkeleton } from '../../ui'
import { translatePortalText  , formatPortalDate, formatPortalNumber, formatPortalPercent} from '../../i18n/runtime'
import { adminApi, aiDocumentApi, fileUrl, type AdminProvider, type ApiProviderRegistration, type AIDocument } from '../../api'
import { onSocket } from '../../socket'
import { AiDocumentVerificationModal } from '../../components/AiDocumentVerificationModal'
import { RequestReuploadModal } from '../../components/RequestReuploadModal'
import { planTermsLabel } from '../../shared/planLabel'
import { money } from '../../format'

// ══════════ Provider onboarding approvals (real backend) ══════════
// Registration → KYC/business details → ADMIN APPROVAL → provider goes live.
// Wired to GET/PATCH /admin/providers.

const ROLE_LABEL: Record<AdminProvider['role'], string> = {
  boat_provider: 'Boat Provider',
  marina_provider: 'Marina Provider',
  fuel_provider: 'Fuel Provider',
  maintenance_provider: 'Maintenance Provider',
}
const ROLE_ICON: Record<AdminProvider['role'], string> = {
  boat_provider: '🛥️', marina_provider: '⚓', fuel_provider: '⛽', maintenance_provider: '🔧',
}

/**
 * A scuba diver is a `boat_provider` that registers no commercial paperwork and
 * may only list diving trips — see PROVIDER_KINDS on the API.
 *
 * Worth calling out on this screen in particular: a reviewer working the KYC
 * queue sees an application with an empty document list and has no way, from
 * the role alone, to tell "nothing was required" from "nothing was uploaded".
 */
const isDiver = (p: Pick<AdminProvider, 'role' | 'providerKind'>) =>
  p.role === 'boat_provider' && p.providerKind === 'scuba_diver'

const providerTypeLabel = (p: Pick<AdminProvider, 'role' | 'providerKind'>) =>
  isDiver(p) ? 'Scuba Diver' : ROLE_LABEL[p.role]

const DiverTag = () => (
  <span className="rounded-md bg-sky-50 px-1.5 py-0.5 text-[10px] font-bold text-sky-700">
    {translatePortalText("\n    🤿 Scuba diver · no documents required\n  ")}</span>
)

const TABS = [
  { key: 'pending', label: 'Pending' },
  { key: 'pending_subscription_payment', label: 'Awaiting Payment' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'suspended', label: 'Suspended' },
  { key: '', label: 'All' },
] as const

const planLabel = (p: AdminProvider) => {
  const o = p.onboarding
  if (!o?.billingModel) return '—'
  // A fixed-fee provider is on a flat cut per transaction, not a percentage —
  // this read "Commission · 0%" for every one of them.
  if (o.billingModel === 'commission') return translatePortalText(planTermsLabel(o))
  if (typeof o.subscriptionPackageId === 'object' && o.subscriptionPackageId) {
    return `${o.subscriptionPackageId.name} · SAR ${o.subscriptionPackageId.price}/${o.subscriptionPackageId.durationMonths === 1 ? 'mo' : `${o.subscriptionPackageId.durationMonths}mo`}`
  }
  const plan = typeof o.subscriptionPlan === 'object' ? o.subscriptionPlan : null
  // Legacy `PlatformPlan` prices are stored in the settlement currency, not
  // in dirhams — the field name is a leftover (see the model). `money` converts
  // into whatever the operator has the SAR/USD switch set to, the same as every
  // other amount on this screen; the literal "AED" label did neither.
  return plan ? `${plan.name} · ${money(plan.price ?? plan.priceAed)} / ${translatePortalText(plan.interval === 'yearly' ? 'year' : 'month')}` : translatePortalText('Subscription')
}

export function AdminKyc() { return <ProviderApprovals /> }

export default function ProviderApprovals() {
  const [tab, setTab] = useState<string>('pending')
  const [providers, setProviders] = useState<AdminProvider[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<AdminProvider | null>(null)
  const [reason, setReason] = useState('')
  const [detail, setDetail] = useState<AdminProvider | null>(null)
  const [registration, setRegistration] = useState<ApiProviderRegistration | null>(null)
  const [regDocs, setRegDocs] = useState<any[]>([])
  const [docReview, setDocReview] = useState<DocumentReview | null>(null)
  const [docChecklist, setDocChecklist] = useState<ApiApplicantDocChecklist | null>(null)
  const [regLoading, setRegLoading] = useState(false)
  const [expandedDocTypes, setExpandedDocTypes] = useState<Record<string, boolean>>({})
  const [aiDoc, setAiDoc] = useState<AIDocument | null>(null)
  // The document a reviewer is asking the provider to replace, if any.
  const [reuploadFor, setReuploadFor] = useState<{ id: string; label: string; provider?: string } | null>(null)

  const toggleDocHistory = (type: string) => {
    setExpandedDocTypes(prev => ({ ...prev, [type]: !prev[type] }))
  }

  const openDetail = async (p: AdminProvider) => {
    setDetail(p); setRegistration(null); setRegDocs([]); setDocReview(null); setDocChecklist(null); setRegLoading(true); setExpandedDocTypes({})
    try {
      const r = await adminApi.getRegistration(p.id)
      setRegistration(r.data.registration)
      setRegDocs(r.data.documents || [])
      setDocReview(r.data.documentReview ?? null)
      setDocChecklist(r.data.documentChecklist ?? null)
    } catch {
      /* legacy providers may have no wizard registration on file */
    } finally {
      setRegLoading(false)
    }
  }

  const verifyDoc = async (docId: string, status: 'approved' | 'rejected') => {
    try {
      await adminApi.verifyDocument(docId, status)
      toast(translatePortalText(status === 'approved' ? 'Document approved' : 'Document rejected'))
      if (detail) openDetail(detail)
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Action failed'), 'warn')
    }
  }

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await adminApi.listProviders(tab ? { status: tab } : undefined)
      setProviders(res.data.providers)
      setCounts(res.data.statusCounts || {})
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load providers')
    } finally {
      setLoading(false)
    }
  }, [tab])

  useEffect(() => { load() }, [load])

  // This queue loaded on mount and never again, so an application submitted
  // while an admin sat on the page stayed invisible until they switched tabs.
  // Reusing the admin notification stream rather than adding a second server
  // emit: `provider_signup` already fans out to every admin.
  useEffect(() => {
    const off = onSocket('notification:new', (payload: { type?: string }) => {
      if (payload?.type === 'provider_signup') void load()
    })
    return off
  }, [load])

  const act = async (p: AdminProvider, fn: () => Promise<unknown>, msg: string, tone: any = 'success') => {
    setBusyId(p.id)
    try {
      await fn()
      toast(translatePortalText(msg), tone)
      setRejecting(null); setReason(''); setDetail(null); setRegistration(null); setRegDocs([])
      await load()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Action failed'), 'warn')
    } finally {
      setBusyId(null)
    }
  }

  const doReject = () => {
    if (!rejecting) return
    if (reason.trim().length < 3) { toast(translatePortalText('Please give a rejection reason'), 'warn'); return }
    act(rejecting, () => adminApi.reject(rejecting.id, reason.trim()), `${rejecting.name} rejected`, 'warn')
  }

  const filterCfg: TableFiltersConfig<any> = useMemo(() => ({
    searchFields: (p) => [p.business?.businessName, p.name, p.email, p.phone, p.id],
    filters: [
      { key: 'role', label: translatePortalText('Provider type'), get: (p) => translatePortalText(isDiver(p) ? 'Scuba Diver' : p.role?.replace(/_/g, ' ')) },
      { key: 'status', label: translatePortalText('Onboarding'), get: (p) => translatePortalText(p.onboarding?.status ?? 'incomplete') },
      { key: 'model', label: translatePortalText('Billing model'), get: (p) => translatePortalText(p.onboarding?.billingModel || '') },
      { key: 'registered', label: translatePortalText('Registered'), kind: 'dateRange', get: (p) => p.createdAt },
    ],
    sortOptions: [
      { key: 'registered', label: 'Registered', get: (p) => p.createdAt, defaultDir: 'asc' },
      { key: 'name', label: 'Business', get: (p) => p.business?.businessName || p.name, defaultDir: 'asc' },
    ],
    defaultSort: 'registered',
  }), [])
  const tf = useTableFilters(providers, filterCfg)
  const visible = tf.filtered

  return (
    <PageWrap>
      <AdminHeader
        title={translatePortalText("Provider Approvals")}
        sub={translatePortalText("Onboarding queue — review credentials, commercial registration & certificates before going live")}
        icon={<ShieldCheck className="text-emerald-500" />}
        actions={<button className="btn-ghost" onClick={load}><RefreshCw size={15} /> {translatePortalText("Refresh")}</button>}
      />

      {/* status cards */}
      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-5">
        {([
          ['pending', '🗂️', 'Pending'],
          ['pending_subscription_payment', '💳', 'Awaiting Pay'],
          ['approved', '✅', 'Approved'],
          ['rejected', '❌', 'Rejected'],
          ['suspended', '⛔', 'Suspended'],
        ] as const).map(([s, icon, label], i) => (
          <motion.div key={s} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="card flex items-center gap-3 p-4">
            <span className="text-2xl">{icon}</span>
            <div><p className="font-display text-2xl font-extrabold text-deep-900"><Counter value={counts[s] || 0} /></p>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText(label)}</p></div>
          </motion.div>
        ))}
      </div>

      {/* tabs */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`rounded-full px-3.5 py-1.5 text-[12px] font-bold transition ${tab === t.key ? 'bg-gradient-to-r from-emerald-600 to-teal-500 text-white shadow-glow' : 'bg-white text-slate-500 hover:text-deep-900'}`}>
            {translatePortalText(t.label)}{t.key && counts[t.key] ? ` · ${counts[t.key]}` : ''}
          </button>
        ))}
      </div>

      {error && <div className="card mb-4 !border-rose-200 !bg-rose-50 text-sm text-rose-600">{translatePortalText("Couldn’t load: ")}{error}</div>}
      {loading && <CardGridSkeleton count={6} />}

      <TableToolbar
        state={tf}
        config={filterCfg}
        rows={providers}
        noun="providers"
        searchPlaceholder={translatePortalText("Search applicants by business, name or email...")}
      />

      {!loading && providers.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-200 py-16 text-center text-sm text-slate-400">{translatePortalText("No providers in “")}{tab || 'all'}”.</div>
      )}
      {!loading && providers.length > 0 && visible.length === 0 && (
        <NoFilterMatches noun="providers" onClear={tf.clear} />
      )}

      {!loading && visible.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((p, i) => {
            const status = p.onboarding?.status ?? 'incomplete'
            return (
              <motion.div key={p.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.04, 0.4) }}
                className={`card overflow-hidden ${status === 'pending' ? 'ring-2 ring-amber-300' : status === 'pending_subscription_payment' ? 'ring-2 ring-cyan-400' : ''}`}>
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-50 text-xl">{ROLE_ICON[p.role]}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-extrabold text-deep-900">{p.business?.businessName || p.name}</p>
                      <p className="truncate text-[11px] text-slate-400">{providerTypeLabel(p)} · {p.name}</p>
                      {isDiver(p) && <div className="mt-1"><DiverTag /></div>}
                    </div>
                    <ABadge dot={status === 'approved'}>
                      {translatePortalText(status === 'pending_subscription_payment' ? 'Awaiting Payment' : status)}
                    </ABadge>
                  </div>

                  <div className="mt-3 space-y-1.5 text-[11.5px] text-slate-500">
                    <p className="flex items-center gap-1.5"><Mail size={12} className="text-slate-400" />{p.email}</p>
                    {p.business?.contactNumber && <p className="flex items-center gap-1.5"><Phone size={12} className="text-slate-400" />{p.business.contactNumber}</p>}
                    {(p.business?.city || p.business?.country) && (
                      <p className="flex items-center gap-1.5"><MapPin size={12} className="text-slate-400" />{[p.business.city, p.business.country].filter(Boolean).join(', ')}</p>
                    )}
                    <p className="flex items-center gap-1.5"><Building2 size={12} className="text-slate-400" />{planLabel(p)}</p>
                  </div>

                  {status === 'pending_subscription_payment' && (
                    <p className="mt-2 rounded-lg bg-cyan-50 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-700">
                      {translatePortalText("\n                      Approved by Admin · Waiting for provider's subscription fee payment.\n                    ")}</p>
                  )}

                  {status === 'rejected' && p.onboarding?.rejectionReason && (
                    <p className="mt-2 rounded-lg bg-rose-50 px-2.5 py-1.5 text-[11px] font-semibold text-rose-600">{translatePortalText("Reason: ")}{p.onboarding.rejectionReason}</p>
                  )}

                  <div className="mt-3 flex gap-1.5 border-t border-slate-100 pt-3">
                    <button onClick={() => openDetail(p)} className="btn-ghost flex-1 !justify-center !py-1.5 !text-[11px]">{translatePortalText("Details")}</button>
                    {status === 'pending' && (<>
                      <button disabled={busyId === p.id} onClick={() => act(p, () => adminApi.approve(p.id), `${p.business?.businessName || p.name} approved — awaiting subscription payment`)} className="btn-admin flex-1 !justify-center !py-1.5 !text-[11px] disabled:opacity-60"><Check size={12} /> {translatePortalText("Approve")}</button>
                      <button disabled={busyId === p.id} onClick={() => { setRejecting(p); setReason('') }} className="btn-ghost !justify-center !py-1.5 !px-2.5 !text-[11px] !text-rose-500"><X size={12} /></button>
                    </>)}
                    {status === 'pending_subscription_payment' && (
                      <button disabled={busyId === p.id} onClick={() => act(p, () => adminApi.approve(p.id, { directApprove: true }), `${p.business?.businessName || p.name} activated — now live`)} className="btn-admin flex-1 !justify-center !py-1.5 !text-[11px] disabled:opacity-60"><Check size={12} /> {translatePortalText("Activate Live")}</button>
                    )}
                    {status === 'approved' && (
                      <button disabled={busyId === p.id} onClick={() => act(p, () => adminApi.suspend(p.id), `${p.business?.businessName || p.name} suspended`, 'warn')} className="btn-ghost flex-1 !justify-center !py-1.5 !text-[11px] !text-amber-600"><Ban size={12} /> {translatePortalText("Suspend")}</button>
                    )}
                    {(status === 'rejected' || status === 'suspended') && (
                      <button disabled={busyId === p.id} onClick={() => act(p, () => adminApi.approve(p.id, { directApprove: true }), `${p.business?.businessName || p.name} approved — now live`)} className="btn-admin flex-1 !justify-center !py-1.5 !text-[11px] disabled:opacity-60"><Check size={12} /> {translatePortalText(" Approve")}</button>
                    )}
                  </div>
                </div>
              </motion.div>
            )
          })}
        </div>
      )}

      {/* reject reason modal */}
      <Modal open={!!rejecting} onClose={() => setRejecting(null)} title={translatePortalText(`Reject ${rejecting?.business?.businessName || rejecting?.name || ''}`)}>
        <p className="mb-2 text-sm text-slate-500">{translatePortalText("Tell the provider why their application was rejected.")}</p>
        <textarea className="input min-h-[90px]" value={reason} onChange={e => setReason(e.target.value)} placeholder={translatePortalText("e.g. Business licence document is unreadable — please re-upload.")} />
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setRejecting(null)}>{translatePortalText("Cancel")}</button>
          <button className="btn-admin !bg-gradient-to-r !from-rose-500 !to-rose-600" onClick={doReject}>{translatePortalText("Reject application")}</button>
        </div>
      </Modal>

      {/* detail modal */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? `${ROLE_ICON[detail.role]} ${detail.business?.businessName || detail.name}` : ''} wide>
        {detail && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                ['Owner', detail.name], ['Email', detail.email], ['Phone', detail.business?.contactNumber || '—'],
                ['Type', providerTypeLabel(detail)], ['Country', detail.business?.country || '—'], ['City', detail.business?.city || '—'],
                ['Billing', planLabel(detail)], ['Status', detail.onboarding?.status || 'incomplete'],
                // A diver holds no paperwork at all, so the question never applies.
                ...(isDiver(detail) ? [] : [['VAT certificate', vatCertificateLabel(detail.business?.hasVatCertificate ?? registration?.business?.hasVatCertificate)]]),
              ].map(([l, v]) => (
                <div key={l} className="rounded-xl bg-sand px-3 py-2.5"><p className="text-[10px] font-bold uppercase text-slate-400">{translatePortalText(String(l))}</p><p className="font-bold text-deep-900">{v}</p></div>
              ))}
            </div>
            {detail.business?.address && <div><p className="label">{translatePortalText("Address")}</p><p className="rounded-xl border border-slate-100 p-3 text-slate-600">{detail.business.address}</p></div>}
            {detail.business?.description && <div><p className="label">{translatePortalText("About")}</p><p className="rounded-xl border border-slate-100 p-3 text-slate-600">{detail.business.description}</p></div>}
            {typeof detail.business?.latitude === 'number' && (
              <p className="text-xs text-slate-400">📍 {formatPortalNumber(detail.business.latitude, { minimumFractionDigits: 5, maximumFractionDigits: 5 })}, {formatPortalNumber(detail.business.longitude, { minimumFractionDigits: 5, maximumFractionDigits: 5 })}</p>
            )}

            {regLoading && <p className="text-xs text-slate-400">{translatePortalText("Loading full registration…")}</p>}

            {/* Outside the registration block: boat providers have no wizard
                registration, but they have a checklist all the same. */}
            {!isDiver(detail) && <RequiredDocsChecklist checklist={docChecklist} />}

            {registration && (
              <div className="space-y-3 border-t border-slate-100 pt-4">
                <p className="label">{translatePortalText("Full registration (")}{registration.status})</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    ['Business type', registration.business?.category], ['CR number', registration.business?.crNumber],
                    ['VAT number', registration.business?.vatNumber], ['Region', registration.entity?.region],
                    // Maintenance only — absent on every other provider type.
                    ['Service type', registration.entity?.serviceType === 'boat_ramp' ? "Boat's ramp" : registration.entity?.serviceType ? 'Normal maintenance' : undefined],
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

                {registration.facilities?.some((f) => f.available) && (
                  <div className="flex flex-wrap gap-1.5">
                    {registration.facilities.filter((f) => f.available).map((f) => <span key={f.key} className="chip bg-slate-100 text-slate-600">{f.key.replace(/_/g, ' ')}</span>)}
                  </div>
                )}

                {registration.dockPackages?.length > 0 && (
                  <div>
                    <p className="label">{translatePortalText("Dock packages")}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {registration.dockPackages.map((p, i) => <span key={i} className="chip bg-ocean-50 text-ocean-700">{p.name} {translatePortalText(" · SAR ")}{formatPortalNumber(p.priceSar)}/{translatePortalText(p.cadence)}</span>)}
                    </div>
                  </div>
                )}

                {(() => {
                  const groupedDocs: Record<string, any[]> = {};
                  regDocs.forEach(d => {
                    const type = d.docType || 'other';
                    if (!groupedDocs[type]) groupedDocs[type] = [];
                    groupedDocs[type].push(d);
                  });
                  const docTypes = Object.keys(groupedDocs);

                  return (
                    <div className="space-y-3">
                      <DocumentFindingsSummary review={docReview} />
                      <div className="flex items-center justify-between">
                        <p className="label">{translatePortalText("Verification Documents (")}{formatPortalNumber(regDocs.length)})</p>
                        <span className="text-[11px] font-bold text-slate-400">{formatPortalNumber(docTypes.length)} {translatePortalText(" types submitted")}</span>
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
                                      {latest.fileName || 'Document scan'} {latest.uploadedAt ? `· ${formatPortalDate(new Date(latest.uploadedAt))}` : ''}
                                    </p>
                                  </div>
                                </div>

                                <div className="flex items-center gap-1.5 shrink-0">
                                  {latest.confidence != null && (
                                    <span className="inline-flex items-center gap-1 rounded-lg bg-teal-50 px-2 py-1 text-[11px] font-extrabold text-teal-700">
                                      <Sparkles size={11} /> {formatPortalPercent(latest.confidence)} {translatePortalText("AI\n                                    ")}</span>
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
                                      <Sparkles size={12} /> {translatePortalText(" Inspect AI\n                                    ")}</button>
                                  )}
                                  {latest.status === 'pending' && (
                                    <>
                                      <button onClick={() => verifyDoc(latest._id, 'approved')} className="btn-admin !py-1 !px-2.5 !text-[11px]"><Check size={12} /> {translatePortalText(" Approve")}</button>
                                      {/* The middle option. Rejecting ends the signup; this reopens
                                          the step with a reason attached. */}
                                      <button
                                        onClick={() => setReuploadFor({ id: latest._id, label: latest.label || latest.docType.replace(/_/g, ' '), provider: detail?.business?.businessName || detail?.name })}
                                        className="btn-ghost !py-1 !px-2.5 !text-[11px] !text-amber-600 border border-amber-200 bg-white hover:!bg-amber-50"
                                        title={translatePortalText("Ask the provider to upload this one again")}
                                      >
                                        <BellRing size={12} /> {translatePortalText(" Ask again\n                                      ")}</button>
                                      <button onClick={() => verifyDoc(latest._id, 'rejected')} className="btn-ghost !py-1 !px-2 !text-[11px] !text-rose-500 hover:!bg-rose-50"><X size={12} /></button>
                                    </>
                                  )}
                                  {history.length > 0 && (
                                    <button onClick={() => toggleDocHistory(type)} className="btn-ghost !py-1 !px-2 !text-[11px]">
                                      {formatPortalNumber(history.length)} {translatePortalText(" Past ")}<Eye size={11} />
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* AI Flags / Feedback Alert */}
                              {/* Every finding on this document, with the reasoning behind each.
                                  Was a single line of headline, which told a reviewer that
                                  something was wrong and nothing about what. */}
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

                              {/* Preview Link */}
                              <div className="px-3.5 py-2.5 bg-white border-t border-slate-100 flex items-center justify-between text-xs">
                                <span className="text-slate-400 font-medium">{isPdf ? 'PDF Document' : 'Image Scan'}</span>
                                <a
                                  href={fileUrl(latest.fileUrl)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="font-bold text-teal-600 hover:text-teal-700 flex items-center gap-1"
                                >
                                  {translatePortalText("\n                                  View Full Document ")}<ExternalLink size={12} />
                                </a>
                              </div>

                              {/* History / Previous Revisions */}
                              {isExpanded && history.length > 0 && (
                                <div className="p-3 bg-slate-100/70 border-t border-slate-200 space-y-2">
                                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">{translatePortalText("Previous Versions")}</p>
                                  {history.map((hd, i) => (
                                    <div key={hd._id} className="flex items-center justify-between rounded-xl bg-white p-2.5 text-[11px] border border-slate-200">
                                      <a href={fileUrl(hd.fileUrl)} target="_blank" rel="noreferrer" className="font-bold text-deep-900 hover:text-teal-600 flex items-center gap-2">
                                        <span>{translatePortalText("Version ")}{formatPortalNumber(history.length - i)}</span>
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
                          <div className="rounded-2xl border border-dashed border-slate-200 py-8 text-center text-xs text-slate-400">
                            {detail && isDiver(detail)
                              ? 'Scuba diver account — no documents are required. This application can be approved on its business details alone.'
                              : 'No verification documents uploaded for this provider yet.'}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {registration.images?.length > 0 && (
                  <div>
                    <p className="label">{translatePortalText("Photos (")}{formatPortalNumber(registration.images.length)})</p>
                    <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
                      {registration.images.map((img, i) => (
                        <img key={i} src={fileUrl(img.url)} alt="" className="aspect-square rounded-lg object-cover ring-1 ring-slate-200" />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
              {detail.onboarding?.status === 'pending' && (<>
                <button className="btn-ghost !text-rose-500" onClick={() => { setDetail(null); setRejecting(detail); setReason('') }}>{translatePortalText("Reject")}</button>
                <button className="btn-admin" onClick={() => act(detail, () => adminApi.approve(detail.id), `${detail.business?.businessName || detail.name} approved`)}>{translatePortalText("Approve provider")}</button>
              </>)}
            </div>
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
