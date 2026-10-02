import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Sparkles,
  ChevronRight,
  ShieldCheck,
  Eye,
  Send,
  XCircle,
  HelpCircle,
  ExternalLink,
  Info,
} from 'lucide-react';
import { fuelApi, type ApiFuelStation } from '../fuelApi';
import { toast, Modal } from '../../ui';
import { translatePortalText } from '../../i18n/runtime'

export interface MissingDetailItem {
  id: string;
  title: string;
  category: 'identity' | 'location' | 'media' | 'pricing' | 'inventory' | 'specs' | 'safety' | 'finance';
  severity: 'critical' | 'warning';
  description: string;
  fixUrl: string;
  actionLabel: string;
}

export interface FuelCompletenessReport {
  score: number;
  isComplete: boolean;
  criticalCount: number;
  warningCount: number;
  totalChecks: number;
  passedChecks: number;
  missingItems: MissingDetailItem[];
  stats?: {
    productsCount: number;
    tanksCount: number;
    imagesCount: number;
  };
}

interface FuelStatusBannerProps {
  station: ApiFuelStation | null;
  completeness?: FuelCompletenessReport | null;
  onRefresh?: () => Promise<any> | void;
}

export default function FuelStatusBanner({
  station,
  completeness: propCompleteness,
  onRefresh,
}: FuelStatusBannerProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [publishing, setPublishing] = useState(false);

  if (!station) return null;

  const stationId = station.id || (station as any)._id;
  const approvalStatus = station.approvalStatus || 'draft';
  const isPublished = Boolean(station.isPublished);

  // Use embedded completeness or fallback
  const completeness: FuelCompletenessReport = propCompleteness ||
    station.completeness || {
      score: station.name && station.address ? 70 : 30,
      isComplete: false,
      criticalCount: 1,
      warningCount: 1,
      totalChecks: 10,
      passedChecks: 6,
      missingItems: [],
    };

  const score = completeness.score ?? 0;
  const missingItems = completeness.missingItems || [];
  const criticalItems = missingItems.filter((i) => i.severity === 'critical');
  const warningItems = missingItems.filter((i) => i.severity === 'warning');

  const handleSubmitForVerification = async () => {
    if (!stationId) return;
    setSubmitting(true);
    try {
      const res = await fuelApi.submitStationForApproval(stationId);
      toast(translatePortalText(res.data.message || 'Fuel station submitted for admin verification!'), 'success');
      if (onRefresh) await onRefresh();
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Submission failed'), 'warn');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePublish = async () => {
    if (!stationId) return;
    setPublishing(true);
    try {
      const res = await fuelApi.publishStation(stationId);
      toast(translatePortalText(res.data.message || 'Fuel station published live!'), 'success');
      if (onRefresh) await onRefresh();
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Publish failed'), 'warn');
    } finally {
      setPublishing(false);
    }
  };

  const handleUnpublish = async () => {
    if (!stationId) return;
    setPublishing(true);
    try {
      const res = await fuelApi.unpublishStation(stationId);
      toast(translatePortalText(res.data.message || 'Fuel station unpublished'), 'warn');
      if (onRefresh) await onRefresh();
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

  // Status 1: In Review (Pending Admin Verification)
  if (approvalStatus === 'pending') {
    return (
      <div className="relative border-b border-amber-300/60 bg-gradient-to-r from-amber-500/10 via-amber-400/15 to-amber-500/10 dark:from-amber-950/40 dark:via-amber-900/30 dark:to-amber-950/40 py-3 px-4 md:px-7 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/30 animate-pulse">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-display text-sm font-bold text-amber-950 dark:text-amber-100">{translatePortalText("Verification in Progress")}</span>
                <span className="inline-flex items-center rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-black uppercase tracking-wider text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/30">{translatePortalText("Under Admin Review")}</span>
              </div>
              <p className="text-xs text-amber-800/80 dark:text-amber-300/80">{translatePortalText("Your fuel dock profile and tank specifications have been submitted to BoatPro Port Authority. You will be notified once reviewed.")}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setChecklistOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-white/80 dark:bg-slate-900/80 px-3 py-1.5 text-xs font-semibold text-amber-900 dark:text-amber-200 shadow-xs hover:bg-amber-50 dark:hover:bg-amber-950 transition"
            >
              <Eye size={14} />{translatePortalText(" View Submitted Details")}</button>
          </div>
        </div>
      </div>
    );
  }

  // Status 2: Changes Requested (Rejected)
  if (approvalStatus === 'rejected') {
    return (
      <div className="relative border-b border-rose-300/80 bg-gradient-to-r from-rose-500/15 via-rose-400/10 to-rose-500/15 dark:from-rose-950/50 dark:via-rose-900/30 dark:to-rose-950/50 py-3 px-4 md:px-7 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 max-w-7xl mx-auto">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-500/20 text-rose-600 dark:text-rose-400 ring-1 ring-rose-500/30">
              <XCircle className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-display text-sm font-bold text-rose-950 dark:text-rose-100">{translatePortalText("Verification Changes Requested")}</span>
                <span className="inline-flex items-center rounded-full bg-rose-500/20 px-2 py-0.5 text-[11px] font-black uppercase tracking-wider text-rose-700 dark:text-rose-300 ring-1 ring-rose-500/30">{translatePortalText("Action Required")}</span>
              </div>
              <p className="text-xs text-rose-900/90 dark:text-rose-200/90 mt-0.5">
                <span className="font-semibold">{translatePortalText("Feedback:")}</span> {station.rejectionReason || translatePortalText('Please review missing details and resubmit.')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setChecklistOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-rose-400/40 bg-white/80 dark:bg-slate-900/80 px-3 py-1.5 text-xs font-semibold text-rose-900 dark:text-rose-200 shadow-xs hover:bg-rose-50 dark:hover:bg-rose-950 transition"
            >{translatePortalText("Fix Details (")}{criticalItems.length})
            </button>
            <button
              disabled={submitting || !completeness.isComplete}
              onClick={handleSubmitForVerification}
              className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white px-3.5 py-1.5 text-xs font-bold shadow-xs transition disabled:opacity-50"
            >
              <Send size={13} /> {submitting ? translatePortalText("Submitting…") : translatePortalText("Re-submit for Review")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Status 3: Approved & Live (Published)
  if (approvalStatus === 'approved' && isPublished) {
    return (
      <div className="relative border-b border-emerald-300/60 bg-gradient-to-r from-emerald-500/10 via-teal-400/10 to-emerald-500/10 dark:from-emerald-950/40 dark:via-teal-900/30 dark:to-emerald-950/40 py-2.5 px-4 md:px-7 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/30">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-display text-xs font-bold text-emerald-950 dark:text-emerald-100">{translatePortalText("Fuel Station Verified & Live")}</span>
                <span className="inline-flex items-center rounded-full bg-emerald-500/20 px-2 py-0.2 text-[10px] font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/30">{translatePortalText("Published")}</span>
              </div>
              <p className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80">{translatePortalText("Your marine fuel dock and products are live on BoatPro search and coastal chart discovery.")}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setChecklistOpen(true)}
              className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-white/70 dark:bg-slate-900/70 px-2.5 py-1 text-[11px] font-medium text-emerald-900 dark:text-emerald-200 hover:bg-emerald-50 transition"
            >{translatePortalText("Profile Score: ")}{score}%
            </button>
            <button
              disabled={publishing}
              onClick={handleUnpublish}
              className="text-[11px] font-semibold text-slate-500 hover:text-rose-600 px-2 py-1 transition"
            >{translatePortalText("Unpublish")}</button>
          </div>
        </div>
      </div>
    );
  }

  // Status 4: Approved (Unpublished)
  if (approvalStatus === 'approved' && !isPublished) {
    return (
      <div className="relative border-b border-indigo-300/60 bg-gradient-to-r from-indigo-500/10 via-blue-400/10 to-indigo-500/10 dark:from-indigo-950/40 dark:via-blue-900/30 dark:to-indigo-950/40 py-3 px-4 md:px-7 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 ring-1 ring-indigo-500/30">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-display text-sm font-bold text-indigo-950 dark:text-indigo-100">{translatePortalText("Approved by BoatPro Admin!")}</span>
                <span className="inline-flex items-center rounded-full bg-indigo-500/20 px-2 py-0.5 text-[11px] font-black uppercase tracking-wider text-indigo-700 dark:text-indigo-300 ring-1 ring-indigo-500/30">{translatePortalText("Ready to Publish")}</span>
              </div>
              <p className="text-xs text-indigo-800/80 dark:text-indigo-300/80">{translatePortalText("Your station is verified. Publish now to make your fuel docks and prices visible to boaters.")}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              disabled={publishing}
              onClick={handlePublish}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-1.5 text-xs font-bold shadow-xs transition"
            >
              <Send size={13} /> {publishing ? translatePortalText("Publishing…") : translatePortalText("🚀 Publish Station Now")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Status 5: Draft / Incomplete (Default Profile Wizard Banner)
  return (
    <>
      <div className="relative border-b border-amber-300/70 bg-gradient-to-r from-amber-500/15 via-orange-400/10 to-amber-500/15 dark:from-amber-950/50 dark:via-orange-950/30 dark:to-amber-950/50 py-3 px-4 md:px-7 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3.5 max-w-7xl mx-auto">
          {/* Left: Indicator & Progress */}
          <div className="flex items-start sm:items-center gap-3.5">
            <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/30">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display text-sm font-bold text-amber-950 dark:text-amber-100">{translatePortalText("Fuel Station Incomplete (")}{score}{translatePortalText("% Ready)")}</span>
                {completeness.isComplete && score >= 80 ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/30">
                    <CheckCircle2 size={11} />{translatePortalText(" Ready for Verification")}</span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-amber-800 dark:text-amber-300 ring-1 ring-amber-500/30">
                    {criticalItems.length}{translatePortalText(" Critical ")}{criticalItems.length === 1 ? translatePortalText("Item") : translatePortalText("Items")}{translatePortalText(" Missing")}</span>
                )}
              </div>

              {/* Progress bar */}
              <div className="mt-1.5 flex items-center gap-2.5">
                <div className="h-2 w-36 sm:w-52 rounded-full bg-amber-950/10 dark:bg-amber-100/10 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      score >= 80 ? 'bg-emerald-500' : score >= 50 ? 'bg-amber-500' : 'bg-rose-500'
                    }`}
                    style={{ width: `${Math.max(5, score)}%` }}
                  />
                </div>
                <span className="text-[11px] font-semibold text-amber-900/80 dark:text-amber-200/80">
                  {completeness.passedChecks}/{completeness.totalChecks}{translatePortalText(" requirements")}</span>
              </div>
            </div>
          </div>

          {/* Right: Quick Fix Action Pills & Submit */}
          <div className="flex flex-wrap items-center gap-2">
            {criticalItems.slice(0, 2).map((item) => (
              <button
                key={item.id}
                onClick={() => handleQuickFix(item)}
                className="group inline-flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-white/90 dark:bg-slate-900/90 px-3 py-1.5 text-xs font-semibold text-amber-950 dark:text-amber-100 shadow-xs hover:border-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950 transition"
              >
                <span>{translatePortalText("FIX: ")}{translatePortalText(item.title)}</span>
                <ChevronRight size={13} className="text-amber-600 group-hover:translate-x-0.5 transition-transform rtl:rotate-180" />
              </button>
            ))}

            <button
              onClick={() => setChecklistOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-amber-600/30 bg-amber-500/10 dark:bg-amber-950/30 px-3 py-1.5 text-xs font-bold text-amber-950 dark:text-amber-200 hover:bg-amber-500/20 transition"
            >{translatePortalText("Checklist (")}{missingItems.length})
            </button>

            {completeness.isComplete && score >= 80 && (
              <button
                disabled={submitting}
                onClick={handleSubmitForVerification}
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white px-3.5 py-1.5 text-xs font-black uppercase tracking-wider shadow-sm transition animate-pulse"
              >
                <Sparkles size={14} /> {submitting ? translatePortalText("Submitting…") : translatePortalText("✨ Submit for Verification")}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Slide-out / Modal Checklist */}
      <Modal open={checklistOpen} onClose={() => setChecklistOpen(false)} title={translatePortalText("⚓ Fuel Station Readiness Checklist")} wide>
        <div className="space-y-6">
          <div className="rounded-2xl bg-slate-50 dark:bg-slate-900/50 p-4 border border-slate-200/80 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-display font-bold text-slate-900 dark:text-white">{translatePortalText("Profile Readiness Score")}</h4>
                <p className="text-xs text-slate-500">
                  {score >= 80
                    ? translatePortalText("🎉 Your station satisfies all mandatory criteria for admin verification!")
                    : translatePortalText("Complete all critical items to submit your station for verification.")}
                </p>
              </div>
              <div className="text-right">
                <span className="font-display text-2xl font-black text-slate-900 dark:text-white">{score}%</span>
                <span className="block text-[10px] uppercase tracking-wider font-bold text-slate-400">{translatePortalText("Readiness")}</span>
              </div>
            </div>
            <div className="mt-3 h-2.5 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${
                  score >= 80 ? 'bg-emerald-500' : score >= 50 ? 'bg-amber-500' : 'bg-rose-500'
                }`}
                style={{ width: `${score}%` }}
              />
            </div>
          </div>

          {/* Missing Items List */}
          <div className="space-y-3">
            <h5 className="font-display text-xs font-bold uppercase tracking-wider text-slate-400">{translatePortalText("Items Requiring Attention (")}{missingItems.length})
            </h5>

            {missingItems.length === 0 ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 text-center text-sm font-semibold text-emerald-800 dark:text-emerald-300">{translatePortalText("✨ All checklist requirements satisfied! You are ready to submit for verification.")}</div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
                {missingItems.map((item) => (
                  <div key={item.id} className="p-3.5 flex items-start justify-between gap-3 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition">
                    <div className="flex items-start gap-3">
                      <span
                        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-xs font-black ${
                          item.severity === 'critical'
                            ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                        }`}
                      >
                        {item.severity === 'critical' ? '!' : 'i'}
                      </span>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-slate-900 dark:text-white">{translatePortalText(item.title)}</span>
                          <span
                            className={`rounded-full px-2 py-0.2 text-[10px] font-black uppercase ${
                              item.severity === 'critical'
                                ? 'bg-rose-50 text-rose-600 ring-1 ring-rose-200'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {translatePortalText(item.severity)}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">{translatePortalText(item.description)}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleQuickFix(item)}
                      className="shrink-0 rounded-lg bg-sand dark:bg-slate-800 hover:bg-ocean-100 dark:hover:bg-ocean-950 text-ocean-700 dark:text-ocean-300 px-3 py-1.5 text-xs font-bold transition flex items-center gap-1"
                    >
                      {translatePortalText(item.actionLabel)} <ChevronRight size={12} className="rtl:rotate-180" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Verification CTA in modal */}
          {completeness.isComplete && score >= 80 && (
            <div className="rounded-xl bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-emerald-500/10 p-4 border border-emerald-300/40 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-emerald-950 dark:text-emerald-100">{translatePortalText("Ready for Launch!")}</p>
                <p className="text-xs text-emerald-800/80 dark:text-emerald-300/80">{translatePortalText("Submit your station to begin receiving fuel delivery and bunkering bookings.")}</p>
              </div>
              <button
                disabled={submitting}
                onClick={handleSubmitForVerification}
                className="btn-primary !bg-emerald-600 hover:!bg-emerald-700 !text-white text-xs font-bold py-2 px-4 shrink-0"
              >
                <Send size={14} />{translatePortalText(" Submit Now")}</button>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
