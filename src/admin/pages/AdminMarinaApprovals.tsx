import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { TableToolbar, useTableFilters, type TableFiltersConfig } from '../../shared/TableFilters';
import { formatIban } from '../../utils/iban'
import { motion, AnimatePresence } from 'framer-motion';
import {
  Anchor,
  Check,
  X,
  RefreshCw,
  MapPin,
  Phone,
  Mail,
  Radio,
  Clock,
  ShieldCheck,
  ExternalLink,
  AlertTriangle,
  ChevronRight,
  Building2,
  Globe,
  Camera,
  Search,
  CheckCircle2,
  XCircle,
  Eye,
  Sliders,
  DollarSign,
  FileText,
} from 'lucide-react';
import { PageWrap } from './_shared';
import { AdminHeader } from '../adminUi';
import { Modal, toast, Counter, CardGridSkeleton } from '../../ui';
import { confirm } from '../../async';
import { money } from '../../format';
import { translatePortalText  , formatPortalDate, formatPortalNumber, formatPortalPercent, isPortalArabic} from '../../i18n/runtime'
import { adminApi, fileUrl, type AdminMarinaApproval } from '../../api';

// "Approved", not "Approved & Live": an approved marina may since have been
// unpublished by its owner or taken down from Marinas & Berths.
const TABS = [
  { key: 'pending', label: 'Pending Review' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'draft', label: 'Drafts' },
  { key: '', label: 'All Marinas' },
] as const;

function localizeChannelNumber(value: string): string {
  return isPortalArabic() ? value.replace(/\d/g, digit => '٠١٢٣٤٥٦٧٨٩'[Number(digit)]) : value;
}

function approvalBadgeClass(status: string) {
  if (status === 'approved') return 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300';
  if (status === 'rejected') return 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300';
  if (status === 'pending') return 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300';
  return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300';
}

/**
 * The card's badge. "Verified & Live" was printed for every approved marina,
 * including ones the owner has unpublished or an admin took down — neither is
 * live. Draft and rejected printed their raw status word, untranslated.
 */
function approvalBadgeLabel(m: AdminMarinaApproval): string {
  const status = m.approvalStatus || 'draft'
  if (status === 'approved') {
    if (!m.isActive) return translatePortalText('Approved · taken down')
    return translatePortalText(m.isPublished ? 'Verified & Live' : 'Approved · unpublished')
  }
  if (status === 'pending') return translatePortalText('Pending Review')
  if (status === 'rejected') return translatePortalText('Rejected')
  return translatePortalText('Draft')
}

/**
 * Read off `expiresAt`: the approvals endpoint sends the raw MarinaDocument rows,
 * which carry no computed `status` — the type's `status` is never set here.
 */
function isExpired(doc: { expiresAt?: string }): boolean {
  if (!doc.expiresAt) return false;
  const t = new Date(doc.expiresAt).getTime();
  return !Number.isNaN(t) && t < Date.now();
}

function marinaId(m?: AdminMarinaApproval | null): string {
  if (!m) return '';
  return m._id || m.id || '';
}

export default function AdminMarinaApprovals() {
  const [tab, setTab] = useState<string>('pending');
  const [marinas, setMarinas] = useState<AdminMarinaApproval[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminMarinaApproval | null>(null);
  const [rejecting, setRejecting] = useState<AdminMarinaApproval | null>(null);
  const [reason, setReason] = useState('');
  const [imgIdx, setImgIdx] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 100 a page, the API's cap. Without a limit it served its default of 20,
      // so the 21st pending marina was never on screen though the tab counted
      // it — and a single page of 100 had the same problem at the 101st.
      const all: AdminMarinaApproval[] = [];
      let statusCounts: Record<string, number> = {};
      for (let page = 1; page <= 50; page++) {
        const res = await adminApi.listMarinaApprovals({ limit: 100, page, ...(tab ? { approvalStatus: tab } : {}) });
        all.push(...(res.data?.marinas || []));
        statusCounts = res.data?.statusCounts || {};
        if (!res.data?.marinas?.length || all.length >= (res.data?.total ?? 0)) break;
      }
      setMarinas(all);
      setCounts(statusCounts);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load marinas');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (marina: AdminMarinaApproval, fn: () => Promise<unknown>, msg: string, tone: any = 'success') => {
    const id = marinaId(marina);
    setBusyId(id);
    try {
      await fn();
      toast(translatePortalText(msg), tone);
      setRejecting(null);
      setReason('');
      setDetail(null);
      await load();
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Action failed'), 'warn');
    } finally {
      setBusyId(null);
    }
  };

  /**
   * Approve and publish, after naming what the admin is approving past.
   *
   * The server only refuses a marina with critical readiness gaps. It publishes
   * one with no compliance paperwork at all, with an expired licence, or one
   * still in draft that its owner never submitted — and the button did that in
   * one click.
   */
  const doApprove = async (marina: AdminMarinaApproval) => {
    const id = marinaId(marina);
    if (!id || busyId) return;
    if (marina.completeness && !marina.completeness.isComplete) {
      toast(translatePortalText(`Cannot approve: ${formatPortalNumber(marina.completeness.criticalCount)} critical requirements are missing.`), 'warn');
      return;
    }
    const docs = marina.complianceDocs ?? [];
    const expired = docs.filter(isExpired);
    const warningItems = marina.completeness?.missingItems?.filter((it) => it.severity !== 'critical') ?? [];
    const warnings: string[] = [];
    if ((marina.approvalStatus || 'draft') === 'draft') warnings.push(translatePortalText('This marina is still a draft — the owner has not submitted it for review.'));
    if (docs.length === 0) warnings.push(translatePortalText('No compliance documents are on file.'));
    if (expired.length) warnings.push(translatePortalText(`Expired: ${expired.map((d) => d.name).join(', ')}.`));
    if (warningItems.length) warnings.push(translatePortalText(`${warningItems.length} readiness warning${warningItems.length === 1 ? '' : 's'} open.`));
    const ok = await confirm({
      title: `Approve and publish "${marina.name}"?`,
      body: [...warnings, translatePortalText('It becomes visible to boaters straight away.')].join(' '),
      confirmLabel: warnings.length ? 'Publish anyway' : 'Approve & publish',
      danger: warnings.length > 0,
    });
    if (!ok) return;
    setDetail(null);
    act(marina, () => adminApi.approveMarina(id), `"${marina.name}" approved and published live! ✅`);
  };

  const doReject = () => {
    if (!rejecting || busyId) return;
    const id = marinaId(rejecting);
    if (!id) {
      toast(translatePortalText('Invalid marina ID'), 'warn');
      return;
    }
    if (reason.trim().length < 3) {
      toast(translatePortalText('Please provide a rejection / change request reason (min 3 characters)'), 'warn');
      return;
    }
    act(rejecting, () => adminApi.rejectMarina(id, reason.trim()), `"${rejecting.name}" marked as rejected`, 'warn');
  };

  const openDetail = (m: AdminMarinaApproval) => {
    setDetail(m);
    setImgIdx(0);
  };

  /**
   * The queue's filters.
   *
   * Search was a `toLowerCase()` substring, and it searched `nameAr` — so it
   * was reaching for Arabic names with a fold that does nothing to them. A
   * marina entered as "شَرِكة" could not be found by typing "شركة", and أ/ا
   * were two different letters as far as the search was concerned. City,
   * submission date and ordering were absent entirely.
   */
  const filterCfg: TableFiltersConfig<any> = useMemo(() => ({
    searchFields: (m: any) => [
      m.name,
      m.nameAr,
      m.address,
      m.city,
      m.owner?.business?.businessName,
      m.owner?.name,
    ],
    filters: [
      { key: 'city', label: translatePortalText('City'), get: (m: any) => m.city },
      { key: 'submitted', label: translatePortalText('Submitted'), kind: 'dateRange', get: (m: any) => m.createdAt },
    ],
    sortOptions: [
      { key: 'submitted', label: 'Submitted', get: (m: any) => m.createdAt, defaultDir: 'asc' },
      { key: 'name', label: 'Marina', get: (m: any) => m.name, defaultDir: 'asc' },
      { key: 'city', label: 'City', get: (m: any) => m.city, defaultDir: 'asc' },
    ],
    defaultSort: 'submitted',
    defaultPageSize: 0,
  }), []);
  const tf = useTableFilters(marinas, filterCfg);
  const filtered = tf.filtered;
  const totalCount = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <PageWrap>
      <AdminHeader
        title={translatePortalText("Marina Approvals & Publishing Review")}
        sub={translatePortalText("Carefully inspect marina submissions before publishing. Ensure physical address, pinpoint coordinates, pontoons, berths with valid pricing, and emergency procedures are verified.")}
        icon={<Anchor className="text-teal-500" />}
        actions={
          <button className="btn-ghost !rounded-xl !px-3.5 !py-2 text-xs font-semibold" onClick={load}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> {translatePortalText("Refresh")}
          </button>
        }
      />

      {/* KPI Cards */}
      <div className="mb-6 grid grid-cols-2 gap-3.5 md:grid-cols-4">
        {[
          { key: 'pending', label: 'Pending Review', count: counts.pending || 0, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/50', icon: Clock },
          { key: 'approved', label: 'Approved', count: counts.approved || 0, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900/50', icon: CheckCircle2 },
          { key: 'rejected', label: 'Rejected / Action Needed', count: counts.rejected || 0, color: 'text-rose-600', bg: 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900/50', icon: XCircle },
          { key: 'draft', label: 'Drafts in Progress', count: counts.draft || 0, color: 'text-slate-600 dark:text-slate-400', bg: 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800', icon: Sliders },
        ].map((item, i) => {
          const Icon = item.icon;
          return (
            <motion.div
              key={item.key}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              onClick={() => setTab(item.key === tab ? '' : item.key)}
              className={`card cursor-pointer p-4 border transition hover:shadow-soft ${item.bg} ${tab === item.key ? 'ring-2 ring-teal-500' : ''}`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">{translatePortalText(item.label)}</span>
                <Icon size={16} className={item.color} />
              </div>
              <div className={`font-display text-2xl font-black ${item.color}`}>
                <Counter value={item.count} />
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Tabs & Search */}
      <div className="mb-6 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900 shadow-2xs">
          {TABS.map((t) => {
            const count = t.key ? (counts[t.key] ?? 0) : totalCount;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-bold transition ${
                  active
                    ? 'bg-teal-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-deep-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                <span>{translatePortalText(t.label)}</span>
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] font-black ${
                    active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                  }`}
                >
                  {formatPortalNumber(count)}
                </span>
              </button>
            );
          })}
        </div>

      </div>

      <TableToolbar
        state={tf}
        config={filterCfg}
        rows={marinas}
        noun="marinas"
        searchPlaceholder="Search by name, city, address or owner…"
      />

      {/* Loading & Empty State */}
      {loading ? (
        <CardGridSkeleton count={6} />
      ) : error ? (
        <div className="card p-8 text-center text-rose-500">
          <AlertTriangle size={32} className="mx-auto mb-2" />
          <p className="font-bold">{error}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center text-slate-400">
          <Anchor size={40} className="mx-auto mb-3 text-slate-300 stroke-[1.5]" />
          <h3 className="font-display text-base font-bold text-deep-900 dark:text-white">{translatePortalText("No Marinas Found")}</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            {tf.activeCount > 0
              ? translatePortalText('No marinas match these filters.')
              : translatePortalText(tab ? 'No marinas in this tab right now.' : 'No marinas have been added yet.')}
          </p>
        </div>
      ) : (
        /* Marina Cards Grid */
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((m, i) => {
            const id = marinaId(m);
            const status = m.approvalStatus || 'draft';
            const completeness = m.completeness;
            const score = completeness?.score ?? 0;
            const criticalMissing = completeness?.missingItems.filter((it) => it.severity === 'critical') || [];
            const isBusy = busyId === id;
            const coverPhoto = m.images?.[0] || m.imagesCategorized?.[0]?.url;

            return (
              <motion.div
                key={id}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.04, 0.3) }}
                className={`card overflow-hidden border flex flex-col justify-between transition hover:shadow-soft ${
                  status === 'pending' ? 'ring-2 ring-amber-300/80 border-amber-300' : ''
                }`}
              >
                <div>
                  {/* Card Cover & Status Badge */}
                  <div className="relative h-44 w-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    {coverPhoto ? (
                      <img src={fileUrl(coverPhoto)} alt={m.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="grid h-full w-full place-items-center bg-gradient-to-br from-ocean-950 to-deep-950 text-white">
                        <Anchor size={36} className="opacity-40" />
                        <span className="text-[11px] font-bold text-ocean-300 mt-1">{translatePortalText("No Cover Photo")}</span>
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-deep-950/80 via-transparent to-transparent" />

                    <span
                      className={`absolute end-3 top-3 rounded-full border px-2.5 py-0.5 text-[10.5px] font-extrabold uppercase tracking-wide shadow-sm ${approvalBadgeClass(
                        status
                      )}`}
                    >
                      {approvalBadgeLabel(m)}
                    </span>

                    <div className="absolute bottom-2.5 start-3 end-3 text-white">
                      <h3 className="font-display text-base font-extrabold leading-tight drop-shadow-sm truncate">
                        {m.name}
                      </h3>
                      {m.nameAr && <p className="text-xs text-ocean-200 font-medium truncate" dir="rtl">{m.nameAr}</p>}
                    </div>
                  </div>

                  {/* Card Details */}
                  <div className="p-4 space-y-3.5">
                    {/* Location */}
                    <div className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300">
                      <MapPin size={15} className="text-teal-600 shrink-0 mt-0.5" />
                      <div className="leading-snug truncate">
                        <span className="font-bold text-deep-900 dark:text-white">
                          {m.city || translatePortalText('City not set')}:
                        </span>{' '}
                        <span className={m.address?.toLowerCase().includes('not set') ? 'text-rose-600 font-bold' : ''}>
                          {m.address || translatePortalText('Address not set')}
                        </span>
                      </div>
                    </div>

                    {/* Owner info */}
                    {m.owner && (
                      <div className="flex items-center gap-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 p-2.5 text-xs">
                        {/* Initials drawn here, not by ui-avatars.com: that sent each
                            owner's name to a third-party server on every render. */}
                        {fileUrl(m.owner.avatar) ? (
                          <img src={fileUrl(m.owner.avatar)} alt="" className="h-7 w-7 rounded-full object-cover" />
                        ) : (
                          <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-teal-600 text-[10px] font-bold text-white">
                            {(m.owner.name || 'O').trim().split(/\s+/).slice(0, 2).map((w: string) => w[0]?.toUpperCase() ?? '').join('')}
                          </span>
                        )}
                        <div className="truncate">
                          <p className="font-bold text-deep-900 dark:text-white leading-tight truncate">
                            {m.owner.business?.businessName || m.owner.name}
                          </p>
                          <p className="text-[10.5px] text-slate-500 truncate">{m.owner.email}</p>
                        </div>
                      </div>
                    )}

                    {/* Key Technical Specs Badges */}
                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-2 dark:border-slate-800 dark:bg-slate-900/50">
                        <p className="text-[10px] font-bold text-slate-500 uppercase">{translatePortalText("Berths")}</p>
                        <p className="font-display font-extrabold text-deep-900 dark:text-white">
                          {formatPortalNumber(m.berthCount ?? m.slotsCount ?? 0)}
                        </p>
                      </div>
                      <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-2 dark:border-slate-800 dark:bg-slate-900/50">
                        <p className="text-[10px] font-bold text-slate-500 uppercase">{translatePortalText("Min Rate")}</p>
                        <p className="font-display font-extrabold text-teal-600 dark:text-teal-400">
                          {/* The lowest monthly slot rate — the only rate the readiness check reads. */}
                          {m.minPrice ? `${money(m.minPrice)} / ${translatePortalText('month')}` : translatePortalText('None')}
                        </p>
                      </div>
                      <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-2 dark:border-slate-800 dark:bg-slate-900/50">
                        <p className="text-[10px] font-bold text-slate-500 uppercase">{translatePortalText("Harbour")}</p>
                        <p className="font-display font-extrabold text-deep-900 dark:text-white">
                          {m.depthM ? `${formatPortalNumber(m.depthM)} ${translatePortalText('meters')}` : translatePortalText('N/A')}
                        </p>
                      </div>
                    </div>

                    {/* Completeness Progress Bar */}
                    <div>
                      <div className="flex items-center justify-between text-[11px] font-bold mb-1">
                        <span className="text-slate-500">{translatePortalText("Readiness Score")}</span>
                        <span className={score >= 90 ? 'text-emerald-600' : score >= 50 ? 'text-amber-600' : 'text-rose-600'}>
                          {formatPortalPercent(score)}
                        </span>
                      </div>
                      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                        <div
                          className={`h-full rounded-full ${
                            score >= 90 ? 'bg-emerald-500' : score >= 50 ? 'bg-amber-500' : 'bg-rose-500'
                          }`}
                          style={{ width: `${score}%` }}
                        />
                      </div>
                    </div>

                    {/* Critical Blockers Warnings */}
                    {criticalMissing.length > 0 && (
                      <div className="rounded-xl border border-rose-200/80 bg-rose-50/60 p-2 text-[11px] text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/20">
                        <p className="font-bold flex items-center gap-1">
                          <AlertTriangle size={12} className="text-rose-500" />
                          {translatePortalText("\n                          Missing ")}{formatPortalNumber(criticalMissing.length)} {translatePortalText(" critical items:\n                        ")}</p>
                        <p className="text-[10.5px] text-rose-700 dark:text-rose-300 truncate mt-0.5">
                          {criticalMissing.map((c) => c.title).join(', ')}
                        </p>
                      </div>
                    )}

                    {/* Rejection reason notice */}
                    {status === 'rejected' && m.approvalReason && (
                      <div className="rounded-xl border border-rose-200 bg-rose-50/90 p-2 text-[11px] text-rose-900">
                        <span className="font-bold">{translatePortalText("Rejection reason:")}</span> {m.approvalReason}
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions Footer */}
                <div className="border-t border-slate-100 bg-slate-50/50 dark:border-slate-800/80 dark:bg-slate-900/30 p-3.5 flex items-center justify-between gap-2">
                  <button
                    onClick={() => openDetail(m)}
                    className="btn-ghost !py-1.5 !px-3 !text-xs font-bold text-slate-700 dark:text-slate-300 inline-flex items-center gap-1"
                  >
                    <Eye size={13} /> {translatePortalText(" Inspect\n                  ")}</button>

                  <div className="flex items-center gap-1.5">
                    {status !== 'rejected' && (
                      <button
                        disabled={isBusy}
                        onClick={() => { setRejecting(m); setReason(''); }}
                        className="btn-ghost !text-rose-600 hover:!bg-rose-50 !py-1.5 !px-2.5 !text-xs font-bold inline-flex items-center gap-1 border border-rose-200"
                      >
                        <X size={13} /> {translatePortalText("Reject")}
                      </button>
                    )}

                    {status !== 'approved' && (
                      <button
                        disabled={isBusy || (completeness && !completeness.isComplete)}
                        onClick={() => void doApprove(m)}
                        title={translatePortalText(completeness && !completeness.isComplete ? 'Cannot approve: critical items missing' : 'Approve and publish marina')}
                        className={`btn-primary !py-1.5 !px-3 !text-xs font-extrabold inline-flex items-center gap-1 shadow-sm ${
                          completeness && !completeness.isComplete
                            ? '!bg-slate-300 dark:!bg-slate-800 !text-slate-400 cursor-not-allowed'
                            : '!bg-emerald-600 hover:!bg-emerald-700 !text-white'
                        }`}
                      >
                        <Check size={14} /> {translatePortalText(" Approve & Publish\n                      ")}</button>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Reject Modal */}
      <Modal open={!!rejecting} onClose={() => setRejecting(null)} title={translatePortalText(`Reject Marina: "${rejecting?.name || ''}"`)}>
        <div className="space-y-4">
          <p className="text-xs text-slate-600 leading-relaxed">
            {translatePortalText("\n            Please provide specific feedback explaining what the marina operator must fix before their marina can be approved and published.\n          ")}</p>

          <div>
            <label className="label">{translatePortalText("Rejection / Change Request Reason *")}</label>
            <textarea
              value={reason}
              dir="auto"
              onChange={(e) => setReason(e.target.value)}
              placeholder={translatePortalText("e.g. Please update the physical street address, configure at least 2 berth slots with monthly pricing, and provide an emergency VHF channel.")}
              className="input min-h-[100px] text-xs"
            />
          </div>

          {rejecting?.approvalStatus === 'approved' && (
            <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-800">
              {translatePortalText("This marina is approved. Rejecting it unpublishes it — boaters stop seeing it straight away.")}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-ghost" onClick={() => setRejecting(null)}>
              {translatePortalText("\n              Cancel\n            ")}</button>
            <button className="btn-primary !bg-rose-600 hover:!bg-rose-700 !text-white font-bold disabled:opacity-60" disabled={!!busyId || reason.trim().length < 3} onClick={doReject}>
              {translatePortalText("\n              Confirm Rejection\n            ")}</button>
          </div>
        </div>
      </Modal>

      {/* Detailed Inspection Modal */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? `${detail.name} — ${translatePortalText('Full Technical Inspection')}` : ''}>
        {detail && (
          <div className="space-y-6 max-h-[75vh] overflow-y-auto pe-1 text-xs">
            {/* Gallery view */}
            {detail.images && detail.images.length > 0 && (
              <div>
                <div className="relative h-56 w-full rounded-2xl bg-slate-900 overflow-hidden mb-2">
                  <img
                    src={fileUrl(detail.images[imgIdx] || detail.images[0])}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute bottom-2 end-2 rounded-lg bg-deep-950/70 px-2 py-1 text-[11px] font-bold text-white backdrop-blur-sm">
                    {formatPortalNumber(imgIdx + 1)} / {formatPortalNumber(detail.images.length)}
                  </div>
                </div>
                {detail.images.length > 1 && (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {detail.images.map((img, idx) => (
                      <button
                        key={idx}
                        onClick={() => setImgIdx(idx)}
                        className={`h-14 w-20 shrink-0 rounded-xl overflow-hidden border-2 transition ${
                          imgIdx === idx ? 'border-teal-500 shadow-sm' : 'border-transparent opacity-70'
                        }`}
                      >
                        <img src={fileUrl(img)} alt="" className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* General Specs */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3 dark:border-slate-800 dark:bg-slate-900/60">
              <h4 className="font-display text-xs font-black uppercase tracking-wider text-deep-900 dark:text-white">
                {translatePortalText("\n                Marina Identity & Operations\n              ")}</h4>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="font-bold text-slate-500 block">{translatePortalText("Name (EN):")}</span>
                  <span className="font-semibold text-deep-900 dark:text-white">{detail.name}</span>
                </div>
                <div>
                  <span className="font-bold text-slate-500 block">{translatePortalText("Name (AR):")}</span>
                  <span className="font-semibold text-deep-900 dark:text-white" dir="rtl">{detail.nameAr || '—'}</span>
                </div>
                <div>
                  <span className="font-bold text-slate-500 block">{translatePortalText("City:")}</span>
                  <span className="font-semibold text-deep-900 dark:text-white">{detail.city || '—'}</span>
                </div>
                <div>
                  <span className="font-bold text-slate-500 block">{translatePortalText("Address:")}</span>
                  <span className="font-semibold text-deep-900 dark:text-white">{detail.address}</span>
                </div>
                <div>
                  <span className="font-bold text-slate-500 block">{translatePortalText("GPS Coordinates:")}</span>
                  <span className="font-mono font-semibold text-teal-600 dark:text-teal-400">
                    {formatPortalNumber(detail.latitude, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}, {formatPortalNumber(detail.longitude, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                  </span>
                </div>
                <div>
                  <span className="font-bold text-slate-500 block">{translatePortalText("VHF Hailing Channel:")}</span>
                  <span className="font-semibold text-deep-900 dark:text-white">
                    {detail.settings?.vhfChannel ? `${translatePortalText('Channel')} ${localizeChannelNumber(detail.settings.vhfChannel)}` : translatePortalText('Not set')}
                  </span>
                </div>
                <div>
                  <span className="font-bold text-slate-500 block">{translatePortalText("Harbour Depth:")}</span>
                  <span className="font-semibold text-deep-900 dark:text-white">
                    {detail.depthM ? `${formatPortalNumber(detail.depthM)} ${translatePortalText('meters')}` : translatePortalText('Not set')}
                  </span>
                </div>
                <div>
                  <span className="font-bold text-slate-500 block">{translatePortalText("Max LOA (Length):")}</span>
                  <span className="font-semibold text-deep-900 dark:text-white">
                    {detail.maxLoaFt ? `${formatPortalNumber(detail.maxLoaFt)} ft` : translatePortalText('Not set')}
                  </span>
                </div>
              </div>
            </div>

            {/* Emergency & Bank Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                <h4 className="font-display text-xs font-black uppercase tracking-wider text-deep-900 dark:text-white mb-2">
                  {translatePortalText("\n                  Emergency Contacts\n                ")}</h4>
                {detail.emergencyContacts && detail.emergencyContacts.length > 0 ? (
                  <div className="space-y-1.5">
                    {detail.emergencyContacts.map((ec, idx) => (
                      <p key={idx} className="font-medium text-deep-900 dark:text-white">
                        <strong>{ec.name}:</strong> {ec.phone} ({ec.kind || translatePortalText('Contact')})
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="text-rose-600 font-semibold">{translatePortalText("No emergency contacts provided")}</p>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                <h4 className="font-display text-xs font-black uppercase tracking-wider text-deep-900 dark:text-white mb-2">
                  {translatePortalText("\n                  Payout & Banking\n                ")}</h4>
                {detail.bank ? (
                  <div className="space-y-1">
                    <p><strong>{translatePortalText("Bank:")}</strong> {detail.bank.bankName || '—'}</p>
                    <p><strong>{translatePortalText("Account Holder:")}</strong> {detail.bank.accountHolderName || '—'}</p>
                    <p className="font-mono text-[11px]"><strong>{translatePortalText("IBAN:")}</strong> {detail.bank.iban ? formatIban(detail.bank.iban) : '—'}</p>
                  </div>
                ) : (
                  <p className="text-rose-600 font-semibold">{translatePortalText("No bank account details configured")}</p>
                )}
              </div>
            </div>

            {/* Compliance & Legal Documents */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/60">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-display text-xs font-black uppercase tracking-wider text-deep-900 dark:text-white flex items-center gap-1.5">
                  <FileText size={14} className="text-teal-500" /> {translatePortalText(" Compliance & Verification Documents\n                ")}</h4>
                <span className="text-[11px] font-bold text-slate-400">
                  {formatPortalNumber(detail.complianceDocs?.length || 0)} {translatePortalText((detail.complianceDocs?.length || 0) === 1 ? 'document' : 'documents')}
                </span>
              </div>
              {detail.complianceDocs && detail.complianceDocs.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {detail.complianceDocs.map((doc, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 shadow-2xs"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-bold text-deep-900 dark:text-white text-xs">{doc.name}</p>
                        <p className="text-[10px] text-slate-400 capitalize">
                          {translatePortalText(String(doc.type || 'other').replace(/_/g, ' '))} {doc.reference ? `· ${translatePortalText('Ref: ')}${doc.reference}` : ''}
                        </p>
                        {doc.expiresAt && (
                          <p className={`text-[10px] ${isExpired(doc) ? 'font-bold text-rose-600' : 'text-slate-500'}`}>
                            {translatePortalText(isExpired(doc) ? 'Expired: ' : 'Expires: ')}{formatPortalDate(new Date(doc.expiresAt))}
                          </p>
                        )}
                        {!doc.fileUrl && (
                          <p className="text-[10px] font-bold text-amber-600">{translatePortalText('No file attached')}</p>
                        )}
                      </div>
                      {doc.fileUrl && (
                        <a
                          href={fileUrl(doc.fileUrl)}
                          target="_blank"
                          rel="noreferrer"
                          className="btn-ghost !p-2 shrink-0 text-teal-600 hover:!bg-teal-50"
                          title={translatePortalText("View / Download Document")}
                        >
                          <ExternalLink size={14} />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center dark:border-slate-800">
                  <p className="text-slate-500 font-medium text-xs">{translatePortalText("No compliance documents uploaded yet")}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">{translatePortalText("Commercial registration, operating license, and coast guard permits appear here.")}</p>
                </div>
              )}
            </div>

            {/* Readiness Checklist Breakdown */}
            {detail.completeness && (
              <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                <h4 className="font-display text-xs font-black uppercase tracking-wider text-deep-900 dark:text-white mb-3">
                  {translatePortalText("\n                  Readiness Checks (")}{formatPortalPercent(detail.completeness.score)})
                </h4>
                <div className="space-y-2">
                  {detail.completeness.missingItems.map((item) => (
                    <div
                      key={item.id}
                      className={`flex items-center justify-between rounded-xl p-2.5 ${
                        item.severity === 'critical' ? 'bg-rose-50 text-rose-900 border border-rose-200' : 'bg-amber-50 text-amber-900 border border-amber-200'
                      }`}
                    >
                      <span className="font-bold">{translatePortalText(item.title)}</span>
                      <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-white/80">
                        {translatePortalText(item.severity === 'critical' ? 'Critical' : 'Warning')}
                      </span>
                    </div>
                  ))}
                  {detail.completeness.missingItems.length === 0 && (
                    <p className="text-emerald-700 font-bold flex items-center gap-1.5">
                      <CheckCircle2 size={16} /> {translatePortalText(" All technical specifications and inventory checks passed.\n                    ")}</p>
                  )}
                </div>
              </div>
            )}

            {/* Modal Actions */}
            <div className="flex justify-end gap-2 pt-4 border-t border-slate-100 dark:border-slate-800">
              <button className="btn-ghost" onClick={() => setDetail(null)}>
                {translatePortalText("\n                Close\n              ")}</button>
              {detail.approvalStatus !== 'rejected' && (
                <button
                  className="btn-ghost !text-rose-600 border border-rose-200"
                  onClick={() => {
                    setRejecting(detail);
                    setReason('');
                    setDetail(null);
                  }}
                >
                  {translatePortalText("\n                  Reject with Feedback\n                ")}</button>
              )}
              {detail.approvalStatus !== 'approved' && (
                <button
                  disabled={!!busyId || (detail.completeness && !detail.completeness.isComplete)}
                  className="btn-primary !bg-emerald-600 hover:!bg-emerald-700 !text-white font-bold disabled:opacity-60"
                  onClick={() => void doApprove(detail)}
                >
                  {translatePortalText("\n                  Approve & Publish\n                ")}</button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </PageWrap>
  );
}
