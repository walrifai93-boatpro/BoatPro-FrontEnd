import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
  Sparkles,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  MapPin,
  Anchor,
  Camera,
  Radio,
  Building2,
  ShieldAlert,
  HelpCircle,
  Globe,
  Eye,
  Check,
  X,
  ExternalLink,
} from 'lucide-react';
import { useMarina } from '../live';
import { marinaApi, type MissingDetailItem, type MarinaCompletenessReport } from '../api';
import { toast, Modal } from '../ui';
import { confirm } from '../async';
import { localizedField, translatePortalText } from '../i18n/runtime'


const CATEGORY_ICONS: Record<string, any> = {
  location: MapPin,
  berths: Anchor,
  media: Camera,
  specs: Radio,
  identity: Building2,
  safety: ShieldAlert,
  finance: Building2,
  contact: Radio,
};

export default function MarinaStatusBanner() {
  const { marina, reload, applyMarina } = useMarina();
  const navigate = useNavigate();
  const location = useLocation();

  const [checklistOpen, setChecklistOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [fetchedCompleteness, setFetchedCompleteness] = useState<MarinaCompletenessReport | null>(null);
  // A failed readiness read used to be logged and then rendered as "0% Ready,
  // Checklist (0)" with Submit greyed out and no reason given.
  const [completenessError, setCompletenessError] = useState(false);
  const [completenessAttempt, setCompletenessAttempt] = useState(0);

  const marinaId = marina?.id || (marina as any)?._id;

  useEffect(() => {
    if (marinaId && !marina?.completeness) {
      let cancelled = false;
      setCompletenessError(false);
      marinaApi
        .getCompleteness(marinaId)
        .then((res) => {
          if (cancelled) return;
          if (res.data?.completeness) {
            setFetchedCompleteness(res.data.completeness);
          } else {
            setCompletenessError(true);
          }
        })
        .catch((err) => {
          if (cancelled) return;
          console.warn('Failed to fetch marina completeness:', err);
          setCompletenessError(true);
        });
      return () => { cancelled = true; };
    }
  }, [marinaId, marina?.completeness, completenessAttempt]);

  if (!marina) return null;

  const approvalStatus = marina.approvalStatus || 'draft';
  const isPublished = !!marina.isPublished;
  const completeness = marina.completeness || fetchedCompleteness;
  const missingItems = completeness?.missingItems || [];
  const criticalItems = missingItems.filter((i) => i.severity === 'critical');
  const warningItems = missingItems.filter((i) => i.severity === 'warning');
  const score = completeness?.score ?? 0;
  const isComplete = Boolean(completeness && (completeness.isComplete || (criticalItems.length === 0 && score >= 90)));

  const handleSubmitForApproval = async () => {
    if (!marinaId || submitting) return;
    if (!completeness) {
      // Nothing to judge readiness by — the checklist failed to load.
      toast(translatePortalText("Couldn't load your readiness checklist."), 'warn');
      setCompletenessAttempt((n) => n + 1);
      return;
    }
    if (!isComplete) {
      toast(translatePortalText(`Please complete the ${criticalItems.length} critical items before submitting for review.`), 'warn');
      setChecklistOpen(true);
      return;
    }
    setSubmitting(true);
    try {
      const res = await marinaApi.submitForApproval(marinaId);
      applyMarina(res.data.marina);
      toast(translatePortalText('Marina successfully submitted for Admin Verification! 🎉'), 'success');
      await reload();
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Submission failed'), 'warn');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePublish = async () => {
    if (!marinaId || publishing) return;
    setPublishing(true);
    try {
      const res = await marinaApi.publish(marinaId);
      applyMarina(res.data.marina);
      toast(translatePortalText('Your marina is now live and published for boaters! ⛵'), 'success');
      await reload();
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Publishing failed'), 'warn');
    } finally {
      setPublishing(false);
    }
  };

  const handleUnpublish = async () => {
    if (!marinaId || publishing) return;
    // Taking the marina out of boater discovery is one quiet link in a banner;
    // it now asks first.
    const ok = await confirm({
      title: 'Unpublish your marina?',
      body: 'Boaters will no longer find your marina in BoatPro discovery until you publish it again.',
      confirmLabel: 'Unpublish',
      danger: true,
    });
    if (!ok) return;
    setPublishing(true);
    try {
      const res = await marinaApi.unpublish(marinaId);
      applyMarina(res.data.marina);
      toast(translatePortalText('Marina unpublished from public discovery'), 'warn');
      await reload();
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Action failed'), 'warn');
    } finally {
      setPublishing(false);
    }
  };

  const handleQuickFix = (item: MissingDetailItem) => {
    if (!item.fixUrl) return;
    const [path, hash] = item.fixUrl.split('#');
    const targetHash = hash || item.id;
    setChecklistOpen(false);

    if (location.pathname === path) {
      window.dispatchEvent(new CustomEvent('boatpro-focus-field', { detail: { id: targetHash } }));
    } else {
      navigate(path);
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('boatpro-focus-field', { detail: { id: targetHash } }));
      }, 200);
    }
  };

  // Render Status 1: In Review (Pending Admin Verification)
  if (approvalStatus === 'pending') {
    return (
      <div className="relative border-b border-amber-300/60 bg-gradient-to-r from-amber-500/10 via-amber-400/15 to-amber-500/10 dark:from-amber-950/40 dark:via-amber-900/30 dark:to-amber-950/40 py-3 px-4 md:px-7 shadow-xs">
        <div className="mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-3 max-w-[1600px]">
          <div className="flex items-center gap-3">
            <div className="relative grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-500 text-white shadow-sm">
              <Clock size={19} className="animate-spin-slow" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-display text-xs md:text-sm font-extrabold text-amber-950 dark:text-amber-100">
                  {translatePortalText("Awaiting Platform Admin Verification\n                ")}</h4>
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-amber-900 dark:text-amber-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-ping" />
                  {translatePortalText("In Review\n                ")}</span>
              </div>
              <p className="text-[11.5px] font-medium text-amber-900/80 dark:text-amber-200/80 leading-relaxed mt-0.5">
                {translatePortalText("Your marina profile is complete and under review by BoatPro administrators. It will go live on boater explore maps once verified.\n              ")}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end md:self-auto shrink-0">
            <button
              onClick={() => setChecklistOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300/80 bg-white/90 dark:bg-amber-950/60 px-3 py-1.5 text-xs font-bold text-amber-950 dark:text-amber-200 hover:bg-white shadow-2xs transition"
            >
                <Eye size={14} /> {translatePortalText('Inspect Readiness (' + score + '%)')}
            </button>
          </div>
        </div>

        <ReadinessModal
          open={checklistOpen}
          onClose={() => setChecklistOpen(false)}
          score={score}
          isComplete={isComplete}
          criticalItems={criticalItems}
          warningItems={warningItems}
          onQuickFix={handleQuickFix}
        />
      </div>
    );
  }

  // Render Status 2: Rejected by Admin
  if (approvalStatus === 'rejected') {
    return (
      <div className="relative border-b border-rose-300 bg-gradient-to-r from-rose-500/10 via-rose-400/15 to-rose-500/10 dark:from-rose-950/50 dark:via-rose-900/30 dark:to-rose-950/50 py-3 px-4 md:px-7 shadow-xs">
        <div className="mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-3 max-w-[1600px]">
          <div className="flex items-start gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-rose-500 text-white shadow-sm mt-0.5">
              <XCircle size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-display text-xs md:text-sm font-extrabold text-rose-950 dark:text-rose-100">
                  {translatePortalText("Verification Changes Requested by Admin\n                ")}</h4>
                <span className="rounded-full bg-rose-500/20 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-rose-800 dark:text-rose-200">
                  {translatePortalText("Action Required\n                ")}</span>
              </div>
              <p className="text-[12px] font-semibold text-rose-900 dark:text-rose-200 mt-1 leading-snug">
                {marina.approvalReason ? (
                  <span className="rounded-md bg-white/70 dark:bg-rose-950/60 px-2 py-0.5 border border-rose-200 dark:border-rose-900 inline-block">
                    {translatePortalText("Reason: ")}{localizedField(marina, 'approvalReason') ?? translatePortalText(marina.approvalReason)}
                  </span>
                ) : (
                  translatePortalText('Please update the highlighted requirements to comply with platform standards.')
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end md:self-auto shrink-0">
            <button
              onClick={() => setChecklistOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-white/90 dark:bg-rose-950/60 px-3 py-1.5 text-xs font-bold text-rose-950 dark:text-rose-200 hover:bg-white shadow-2xs transition"
            >
              {translatePortalText("Review Issues\n            ")}</button>
            <button
              disabled={submitting}
              onClick={handleSubmitForApproval}
              className="btn-primary !bg-rose-600 hover:!bg-rose-700 !text-white !py-1.5 !px-3.5 !text-xs font-extrabold shadow-sm"
            >
              {submitting ? translatePortalText('Submitting…') : translatePortalText('Fix & Resubmit')}
            </button>
          </div>
        </div>

        <ReadinessModal
          open={checklistOpen}
          onClose={() => setChecklistOpen(false)}
          score={score}
          isComplete={isComplete}
          criticalItems={criticalItems}
          warningItems={warningItems}
          onQuickFix={handleQuickFix}
        />
      </div>
    );
  }

  // Render Status 3: Approved but not Published yet
  if (approvalStatus === 'approved' && !isPublished) {
    return (
      <div className="relative border-b border-emerald-300 bg-gradient-to-r from-emerald-500/10 via-teal-400/15 to-emerald-500/10 dark:from-emerald-950/40 dark:via-teal-950/30 dark:to-emerald-950/40 py-3 px-4 md:px-7 shadow-xs">
        <div className="mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-3 max-w-[1600px]">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-600 text-white shadow-sm">
              <CheckCircle2 size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-display text-xs md:text-sm font-extrabold text-emerald-950 dark:text-emerald-100">
                  {translatePortalText("🎉 Marina Verified by Admin! Ready to Go Live\n                ")}</h4>
                <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-emerald-800 dark:text-emerald-200">
                  {translatePortalText("Approved\n                ")}</span>
              </div>
              <p className="text-[11.5px] font-medium text-emerald-900/80 dark:text-emerald-200/80 leading-relaxed mt-0.5">
                {translatePortalText("Your marina has passed verification. Click ")}<strong>{translatePortalText("Publish Marina")}</strong> {translatePortalText("to make it discoverable on boater maps and accept reservations.\n              ")}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end md:self-auto shrink-0">
            <button
              disabled={publishing}
              onClick={handlePublish}
              className="btn-primary !bg-emerald-600 hover:!bg-emerald-700 !text-white !py-2 !px-4 !text-xs font-extrabold shadow-sm flex items-center gap-1.5"
            >
              <Globe size={14} />
              {publishing ? translatePortalText('Publishing…') : translatePortalText('Publish Marina Now')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Render Status 4: Approved & Published (Live on Platform)
  if (approvalStatus === 'approved' && isPublished) {
    if (collapsed) {
      return (
        <div className="border-b border-slate-100/80 bg-slate-50/50 dark:bg-slate-900/50 px-4 py-1.5 text-right max-w-[1600px] mx-auto">
          <button
            onClick={() => setCollapsed(false)}
            className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300 hover:underline"
          >
            <CheckCircle2 size={13} className="text-emerald-500" />
            <span>{translatePortalText("Marina Verified & Live on BoatPro")}</span>
            <ChevronDown size={12} />
          </button>
        </div>
      );
    }

    return (
      <div className="relative border-b border-emerald-200/70 bg-emerald-50/60 dark:bg-emerald-950/20 py-2.5 px-4 md:px-7">
        <div className="mx-auto flex flex-wrap items-center justify-between gap-3 max-w-[1600px]">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            <p className="text-xs font-bold text-emerald-900 dark:text-emerald-100">
              <span className="font-extrabold text-emerald-950 dark:text-emerald-200"><bdi dir="auto">{localizedField(marina, 'name') || marina.name}</bdi></span> {translatePortalText("is ")}<strong>{translatePortalText("Verified & Live")}</strong> {translatePortalText("on the BoatPro network.\n            ")}</p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/profile')}
              className="text-[11px] font-bold text-ocean-700 dark:text-ocean-300 hover:underline inline-flex items-center gap-1"
            >
              {/* Opens the operator's own profile editor — there is no public page
                  link here, so it no longer claims to be one. */}
              {translatePortalText("Marina Profile")} <ExternalLink size={11} />
            </button>
            <span className="text-slate-300">|</span>
            <button
              disabled={publishing}
              onClick={handleUnpublish}
              className="text-[11px] font-semibold text-slate-500 hover:text-rose-600 transition disabled:opacity-50 disabled:cursor-wait"
            >
              {publishing ? translatePortalText('Unpublishing…') : translatePortalText("Unpublish\n            ")}</button>
            <button
              onClick={() => setCollapsed(true)}
              className="grid h-6 w-6 place-items-center rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
              title={translatePortalText("Minimize banner")}
            >
              <ChevronUp size={14} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Render Status 5: Draft / Incomplete (Setup in Progress)
  return (
    <div className="relative border-b border-amber-300/80 bg-gradient-to-r from-amber-500/10 via-amber-400/15 to-orange-500/10 dark:from-amber-950/50 dark:via-amber-900/40 dark:to-orange-950/50 py-3.5 px-4 md:px-7 shadow-xs">
      <div className="mx-auto max-w-[1600px] space-y-3">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-sm mt-0.5">
              <AlertTriangle size={20} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="font-display text-sm font-extrabold text-amber-950 dark:text-amber-100 leading-snug">
                  {translatePortalText('Marina Profile Incomplete (' + score + '% Ready)')}</h4>
                {criticalItems.length > 0 ? (
                  <span className="rounded-full bg-rose-500/20 border border-rose-300/60 px-2.5 py-0.5 text-[10.5px] font-black text-rose-900 dark:text-rose-200 uppercase tracking-wide">
                    {translatePortalText(criticalItems.length + ' Critical Items Missing')}</span>
                ) : isComplete ? (
                  <span className="rounded-full bg-emerald-500/20 border border-emerald-300/60 px-2.5 py-0.5 text-[10.5px] font-black text-emerald-900 dark:text-emerald-200 uppercase tracking-wide">
                    {translatePortalText("Ready for Verification\n                  ")}</span>
                ) : (
                  <span className="rounded-full bg-amber-500/20 border border-amber-300/60 px-2.5 py-0.5 text-[10.5px] font-black text-amber-900 dark:text-amber-200 uppercase tracking-wide">
                    {translatePortalText("Setup In Progress\n                  ")}</span>
                )}
              </div>
              <p className="text-[12px] font-medium text-amber-900/85 dark:text-amber-200/85 mt-0.5 leading-relaxed">
                {translatePortalText("Before publishing your marina, all core details must be provided and verified by platform administrators. Click any item below to resolve it.\n              ")}</p>
              {!completeness && completenessError && (
                <p className="mt-1 flex flex-wrap items-center gap-2 text-[12px] font-semibold text-rose-700 dark:text-rose-300">
                  {translatePortalText("Couldn't load your readiness checklist.")}
                  <button onClick={() => setCompletenessAttempt((n) => n + 1)} className="underline hover:no-underline">
                    {translatePortalText('Try again')}
                  </button>
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 self-stretch lg:self-auto justify-end shrink-0 pt-1 lg:pt-0">
            <button
              onClick={() => setChecklistOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300/80 bg-white/90 dark:bg-amber-950/80 px-3.5 py-2 text-xs font-extrabold text-amber-950 dark:text-amber-200 hover:bg-white shadow-2xs transition"
            >
              {translatePortalText('Checklist (' + (criticalItems.length + warningItems.length) + ')')}
            </button>
            <button
              disabled={submitting || !isComplete}
              onClick={handleSubmitForApproval}
              title={!isComplete ? translatePortalText("Complete all critical items first") : translatePortalText("Submit for review")}
              className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-black uppercase tracking-wider transition shadow-sm ${
                isComplete
                  ? 'btn-primary !bg-gradient-to-r !from-emerald-600 !to-teal-600 !text-white animate-pulse-soft'
                  : 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed border border-slate-300/50'
              }`}
            >
              <Sparkles size={14} />
              {submitting ? translatePortalText('Submitting…') : translatePortalText('Submit for Verification')}
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="relative h-2 w-full overflow-hidden rounded-full bg-amber-200/60 dark:bg-amber-950/80">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${score}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className={`h-full rounded-full ${
              score >= 90
                ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
                : score >= 50
                ? 'bg-gradient-to-r from-amber-500 to-orange-400'
                : 'bg-gradient-to-r from-rose-500 to-amber-500'
            }`}
          />
        </div>

        {/* Interactive Quick-Fix Pills */}
        {criticalItems.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-amber-900/70 dark:text-amber-300/70 me-1">
              {translatePortalText("Fix now:\n            ")}</span>
            {criticalItems.slice(0, 6).map((item) => {
              const Icon = CATEGORY_ICONS[item.category] || AlertTriangle;
              return (
                <button
                  key={item.id}
                  onClick={() => handleQuickFix(item)}
                  className="group inline-flex items-center gap-1.5 rounded-lg border border-amber-300/90 bg-white/95 dark:bg-amber-950/90 px-2.5 py-1 text-xs font-bold text-amber-950 dark:text-amber-200 hover:border-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/60 shadow-2xs transition"
                >
                  <Icon size={13} className="text-amber-600 group-hover:scale-110 transition-transform" />
                  <span>{translatePortalText(item.actionLabel || item.title)}</span>
                  <ArrowRight size={11} className="text-amber-700 dark:text-amber-400 group-hover:translate-x-0.5 transition-transform" />
                </button>
              );
            })}

            {criticalItems.length > 6 && (
              <button
                onClick={() => setChecklistOpen(true)}
                className="text-[11px] font-extrabold text-amber-800 dark:text-amber-300 hover:underline ps-1"
              >
                {translatePortalText('+' + (criticalItems.length - 6) + ' more')}</button>
            )}
          </div>
        )}
      </div>

      <ReadinessModal
        open={checklistOpen}
        onClose={() => setChecklistOpen(false)}
        score={score}
        isComplete={isComplete}
        criticalItems={criticalItems}
        warningItems={warningItems}
        onQuickFix={handleQuickFix}
      />
    </div>
  );
}

// ── Detailed Readiness Modal ────────────────────────────────────────────────
function ReadinessModal({
  open,
  onClose,
  score,
  isComplete,
  criticalItems,
  warningItems,
  onQuickFix,
}: {
  open: boolean;
  onClose: () => void;
  score: number;
  isComplete: boolean;
  criticalItems: MissingDetailItem[];
  warningItems: MissingDetailItem[];
  onQuickFix: (item: MissingDetailItem) => void;
}) {
  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} title={translatePortalText("Marina Publishing & Verification Readiness")}>
      <div className="space-y-6">
        {/* Score Card */}
        <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-sand/40 p-5 dark:border-slate-800 dark:from-slate-900 dark:to-slate-950">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{translatePortalText("Readiness Score")}</p>
              <h3 className="font-display text-2xl font-black text-deep-900 dark:text-white">
                {translatePortalText(score + '% Complete')}</h3>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-black uppercase tracking-wider ${
                isComplete ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
              }`}
            >
              {translatePortalText(isComplete ? 'Ready for Verification' : `${criticalItems.length} Blockers`)}
            </span>
          </div>

          <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div
              className={`h-full rounded-full ${
                score >= 90 ? 'bg-emerald-500' : score >= 50 ? 'bg-amber-500' : 'bg-rose-500'
              }`}
              style={{ width: `${score}%` }}
            />
          </div>
        </div>

        {/* Critical Blockers */}
        {criticalItems.length > 0 && (
          <div>
            <h4 className="font-display text-sm font-extrabold text-rose-950 dark:text-rose-300 flex items-center gap-1.5 mb-3">
              <AlertTriangle size={16} className="text-rose-500" />
              {translatePortalText("Critical Requirements (Must fix before publishing)\n            ")}</h4>
            <div className="space-y-2.5">
              {criticalItems.map((item) => {
                const Icon = CATEGORY_ICONS[item.category] || AlertTriangle;
                return (
                  <div
                    key={item.id}
                    className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-xl border border-rose-200/80 bg-rose-50/50 p-3.5 dark:border-rose-900/60 dark:bg-rose-950/20"
                  >
                    <div className="flex items-start gap-3">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-rose-500/15 text-rose-600 mt-0.5">
                        <Icon size={15} />
                      </span>
                      <div>
                        <p className="text-xs font-bold text-deep-900 dark:text-white leading-tight">
                          {translatePortalText(item.title)}
                        </p>
                        <p className="text-[11.5px] text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
                          {translatePortalText(item.description)}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => onQuickFix(item)}
                      className="btn-primary !bg-rose-600 hover:!bg-rose-700 !text-white !py-1.5 !px-3 !text-xs shrink-0 self-end sm:self-auto font-bold flex items-center gap-1 shadow-2xs"
                    >
                      <span>{translatePortalText(item.actionLabel)}</span>
                      <ArrowRight size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Recommended Warnings */}
        {warningItems.length > 0 && (
          <div>
            <h4 className="font-display text-sm font-extrabold text-amber-950 dark:text-amber-300 flex items-center gap-1.5 mb-3">
              <Sparkles size={16} className="text-amber-500" />
              {translatePortalText("Recommended Improvements\n            ")}</h4>
            <div className="space-y-2">
              {warningItems.map((item) => {
                const Icon = CATEGORY_ICONS[item.category] || Sparkles;
                return (
                  <div
                    key={item.id}
                    className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-xl border border-amber-200/70 bg-amber-50/40 p-3 dark:border-amber-900/40 dark:bg-amber-950/20"
                  >
                    <div className="flex items-start gap-2.5">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-amber-500/15 text-amber-600 mt-0.5">
                        <Icon size={14} />
                      </span>
                      <div>
                        <p className="text-xs font-bold text-deep-900 dark:text-white leading-tight">
                          {translatePortalText(item.title)}
                        </p>
                        <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                          {translatePortalText(item.description)}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => onQuickFix(item)}
                      className="btn-ghost !border !border-amber-300/80 !bg-white !py-1 !px-2.5 !text-xs shrink-0 self-end sm:self-auto font-bold text-amber-950 dark:text-amber-200"
                    >
                      {translatePortalText(item.actionLabel)}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {criticalItems.length === 0 && warningItems.length === 0 && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-6 text-center">
            <CheckCircle2 size={36} className="text-emerald-500 mx-auto mb-2" />
            <h4 className="font-display text-sm font-black text-emerald-950">
              {translatePortalText("All Details Complete!\n            ")}</h4>
            <p className="text-xs text-emerald-800 mt-1">
              {translatePortalText("Your marina profile has all required specifications, berths, pricing, and emergency details.\n            ")}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
