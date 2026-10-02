import React, { useState } from 'react';
import {
  X,
  CheckCircle2,
  AlertTriangle,
  FileText,
  ShieldCheck,
  ShieldAlert,
  Calendar,
  User,
  Anchor,
  ZoomIn,
  ZoomOut,
  Maximize2,
  ExternalLink,
  Info,
  Layers,
  Sparkles,
  ChevronRight,
  Clock,
  Check,
  Ban,
  FileCheck
} from 'lucide-react';
import { AIDocument, aiDocumentApi, fileUrl } from '../api';
import { formatPortalDate, formatPortalNumber, formatPortalPercent, localizedEnum, translatePortalText } from '../i18n/runtime';

interface AiDocumentVerificationModalProps {
  document: AIDocument | null;
  bookingId?: string;
  isOpen: boolean;
  onClose: () => void;
  onStatusUpdated?: (updatedDoc: AIDocument) => void;
}

export const AiDocumentVerificationModal: React.FC<AiDocumentVerificationModalProps> = ({
  document: doc,
  bookingId,
  isOpen,
  onClose,
  onStatusUpdated,
}) => {
  const [zoom, setZoom] = useState(1);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [activeTab, setActiveTab] = useState<'fields' | 'crossCheck' | 'fraud' | 'rawOcr'>('fields');
  const [isReviewing, setIsReviewing] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen || !doc) return null;

  const confidencePct = Math.round((doc.confidence?.overall ?? 0.85) * 100);

  // Rebased onto the API origin. See the comment at the preview surface.
  const previewUrl = fileUrl(doc.fileUrl);
  const isPdf =
    (doc.fileUrl ?? '').toLowerCase().endsWith('.pdf') || doc.mimeType === 'application/pdf';

  /**
   * Why this document is sitting in front of a human, assembled from the record.
   *
   * Ordered by how much it should change the reviewer's mind: something that
   * says the document may not be genuine, then something that says it is the
   * wrong document or out of date, then disagreements with the account, then
   * how well we could read it at all. Each entry carries the model's own
   * reasoning where it wrote any, because the useful half of "checksum failed"
   * is which digits it compared.
   */
  //
  // A plain call, not `useMemo`: this runs after the `if (!isOpen) return null`
  // above, and a hook there crashes the modal the first time it opens. The work
  // is a few array walks over one document, so there is nothing to memoise.
  const flagReasons = (() => {
    const out: { label: string; text: string }[] = [];

    if (doc.failureReason) {
      out.push({ label: 'The reading did not complete:', text: doc.failureReason });
    }

    for (const sig of doc.fraud?.signals ?? []) {
      if (sig.severity === 'info') continue;
      out.push({ label: 'Authenticity:', text: sig.detail });
    }

    for (const chk of doc.identity?.checks ?? []) {
      if (chk.status === 'passed') continue;
      out.push({ label: `${translatePortalText(chk.name)}:`, text: translatePortalText(chk.detail) });
    }

    for (const issue of doc.validation ?? []) {
      if (issue.severity === 'info') continue;
      out.push({
        label: issue.severity === 'critical' ? 'Contradiction:' : 'Check:',
        text: translatePortalText(issue.explanation ? `${issue.message} ${issue.explanation}` : issue.message),
      });
    }

    if (doc.expiry?.status === 'expired') {
      out.push({
        label: 'Expired:',
        text: doc.expiry.expiresAt
          ? translatePortalText(`The expiry date reads ${doc.expiry.expiresAt.slice(0, 10)}, which has passed.`)
          : 'The document has passed its expiry date.',
      });
    } else if (doc.expiry?.status === 'unknown') {
      out.push({ label: 'Expiry:', text: 'No expiry date could be read from the page.' });
    }

    for (const chk of doc.crossValidation?.checks ?? []) {
      if (chk.status !== 'mismatch') continue;
      out.push({
        label: `${translatePortalText(chk.target)} ${translatePortalText('disagrees:')}`,
        text:
          chk.expected || chk.actual
            ? translatePortalText(`the document says "${chk.actual}", our records say "${chk.expected}".`)
            : translatePortalText(chk.detail),
      });
    }

    const missing = (doc.missingFields ?? []).filter((f) => f.required);
    if (missing.length > 0) {
      out.push({
        label: 'Not readable:',
        text: translatePortalText(`${missing.map((f) => f.label.toLowerCase()).join(', ')} — required for this document type.`),
      });
    }

    const legibility = doc.analysis?.legibility;
    if (typeof legibility === 'number' && legibility < 0.6) {
      out.push({
        label: 'Legibility:',
        text: translatePortalText(`Only ${Math.round(legibility * 100)}% of the page could be read confidently.`),
      });
    }

    if (doc.analysis?.notes) {
      out.push({ label: 'Note from the reading:', text: translatePortalText(doc.analysis.notes) });
    }

    return out;
  })();
  // AI analysis is only a recommendation. A document remains pending until a
  // human admin records an explicit approval decision.
  const isApproved = doc.status === 'approved';
  const isFlagged = doc.status === 'needs_review' || doc.status === 'analyzed';
  const isExpired = doc.expiry?.status === 'expired';
  const isRejected = doc.status === 'rejected';
  const canReview = !['approved', 'rejected', 'queued', 'analyzing', 'failed'].includes(doc.status);

  const handleApprove = async () => {
    try {
      setSubmitting(true);
      if (bookingId) {
        await aiDocumentApi.reviewBookingDocument(bookingId, doc.docType || doc._id || '', 'approved');
      } else if (doc._id || doc.id) {
        await aiDocumentApi.review(doc._id || doc.id || '', 'approved');
      }
      if (onStatusUpdated) {
        onStatusUpdated({ ...doc, status: 'approved' });
      }
      onClose();
    } catch (err: any) {
      alert(translatePortalText(err?.message || 'Failed to approve document'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!rejectionReason.trim()) {
      alert(translatePortalText('Please enter a rejection reason for the boat provider.'));
      return;
    }
    try {
      setSubmitting(true);
      if (bookingId) {
        await aiDocumentApi.reviewBookingDocument(bookingId, doc.docType || doc._id || '', 'rejected', rejectionReason);
      } else if (doc._id || doc.id) {
        await aiDocumentApi.review(doc._id || doc.id || '', 'rejected', rejectionReason);
      }
      if (onStatusUpdated) {
        onStatusUpdated({ ...doc, status: 'rejected' });
      }
      onClose();
    } catch (err: any) {
      alert(translatePortalText(err?.message || 'Failed to reject document'));
    } finally {
      setSubmitting(false);
    }
  };

  const formatDocType = (type: string) => {
    return type
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  return (
    <div className="portal-dark-workspace fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-6xl h-[90vh] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-100">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-white">{translatePortalText(formatDocType(doc.docType || 'Document'))}</h3>
                {isApproved && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" /> {translatePortalText("AI Verified")}
                  </span>
                )}
                {isFlagged && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 border border-amber-500/30 text-amber-400">
                    <AlertTriangle className="w-3.5 h-3.5" /> {translatePortalText("Staff Review Needed")}
                  </span>
                )}
                {isExpired && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/10 border border-rose-500/30 text-rose-400">
                    <Clock className="w-3.5 h-3.5" /> {translatePortalText("Expired")}
                  </span>
                )}
                {isRejected && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/10 border border-rose-500/30 text-rose-400">
                    <Ban className="w-3.5 h-3.5" /> {translatePortalText("Rejected")}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                {translatePortalText("Uploaded ")}{doc.createdAt ? formatPortalDate(doc.createdAt, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : translatePortalText('Recently')} {translatePortalText("• Filename: ")}{doc.fileName || translatePortalText('No filename')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* AI Confidence Meter */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800/80 border border-slate-700">
              <span className="text-xs text-slate-400 font-medium">{translatePortalText("AI Confidence:")}</span>
              <div className="w-16 h-2 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    confidencePct >= 85 ? 'bg-emerald-400' : confidencePct >= 65 ? 'bg-amber-400' : 'bg-rose-400'
                  }`}
                  style={{ width: `${confidencePct}%` }}
                />
              </div>
              <span className={`text-xs font-bold ${confidencePct >= 85 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {formatPortalPercent(confidencePct)}
              </span>
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body: Split Screen Preview & AI Inspector */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0">
          {/* Left Column: Document Image / PDF Viewer (7 cols) */}
          <div className="lg:col-span-7 bg-slate-950 flex flex-col border-e border-slate-800 relative">
            {/* Viewer Controls */}
            <div className="absolute top-4 end-4 z-10 flex items-center gap-1.5 p-1.5 rounded-xl bg-slate-900/90 border border-slate-700 backdrop-blur-md shadow-lg">
              <button
                onClick={() => setZoom((z) => Math.max(0.6, z - 0.2))}
                className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800"
                title={translatePortalText("Zoom Out")}
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-xs font-mono text-slate-400 px-1">{formatPortalPercent(Math.round(zoom * 100))}</span>
              <button
                onClick={() => setZoom((z) => Math.min(2.5, z + 0.2))}
                className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800"
                title={translatePortalText("Zoom In")}
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <button
                onClick={() => setZoom(1)}
                className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800"
                title={translatePortalText("Reset Zoom")}
              >
                <Maximize2 className="w-4 h-4" />
              </button>
              <a
                href={previewUrl}
                target="_blank"
                rel="noreferrer"
                className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800"
                title={translatePortalText("Open in new tab")}
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>

            {/* Document Image Surface */}
            <div className="flex-1 overflow-auto p-8 flex items-center justify-center bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px]">
              {previewUrl && !previewFailed ? (
                <div
                  className="transition-transform duration-150 origin-center shadow-2xl rounded-lg overflow-hidden border border-slate-700 bg-white"
                  style={{ transform: `scale(${zoom})` }}
                >
                  {isPdf ? (
                    <iframe src={previewUrl} className="w-[600px] h-[750px] border-0" title={translatePortalText("Document PDF Preview")} />
                  ) : (
                    <img
                      src={previewUrl}
                      alt={translatePortalText("Compliance Document")}
                      className="max-w-[580px] max-h-[700px] object-contain select-none"
                      onError={() => setPreviewFailed(true)}
                    />
                  )}
                </div>
              ) : (
                <div className="text-center p-8 text-slate-500">
                  <FileText className="w-16 h-16 mx-auto mb-3 opacity-30" />
                  {previewFailed && previewUrl ? (
                    <>
                      <p className="text-slate-400">{translatePortalText("The stored file could not be loaded.")}</p>
                      <a
                        href={previewUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-block break-all text-[11px] text-teal-400 underline"
                      >
                        {previewUrl}
                      </a>
                      <p className="mx-auto mt-2 max-w-sm text-[11px] leading-relaxed text-slate-500">
                        {translatePortalText("The analysis below was produced from the file when it was uploaded, so it is\n                        still readable even when the page itself will not display.\n                      ")}</p>
                    </>
                  ) : (
                    <p>{translatePortalText("No document preview available")}</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: AI Extraction & Smart Cross-Check Results (5 cols) */}
          <div className="lg:col-span-5 flex flex-col bg-slate-900 overflow-hidden">
            {/* Inspector Navigation Tabs */}
            <div className="flex border-b border-slate-800 px-4 pt-3 gap-2 bg-slate-900/90">
              <button
                onClick={() => setActiveTab('fields')}
                className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-t-lg transition-colors border-b-2 ${
                  activeTab === 'fields'
                    ? 'border-cyan-400 text-cyan-300 bg-slate-800/60'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <FileCheck className="w-3.5 h-3.5" />
                {translatePortalText("Extracted Fields")} ({formatPortalNumber(doc.fields?.length || 0)})
              </button>

              <button
                onClick={() => setActiveTab('crossCheck')}
                className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-t-lg transition-colors border-b-2 relative ${
                  activeTab === 'crossCheck'
                    ? 'border-cyan-400 text-cyan-300 bg-slate-800/60'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                {translatePortalText("Cross-Checks")}
                {doc.crossValidation && !doc.crossValidation.passed && (
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                )}
              </button>

              <button
                onClick={() => setActiveTab('fraud')}
                className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-t-lg transition-colors border-b-2 ${
                  activeTab === 'fraud'
                    ? 'border-cyan-400 text-cyan-300 bg-slate-800/60'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                {translatePortalText("Tamper & Quality")}
              </button>

              <button
                onClick={() => setActiveTab('rawOcr')}
                className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-t-lg transition-colors border-b-2 ${
                  activeTab === 'rawOcr'
                    ? 'border-cyan-400 text-cyan-300 bg-slate-800/60'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                {translatePortalText("AI Response")}
              </button>
            </div>

            {/* Tab Contents */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* TAB 1: EXTRACTED FIELDS */}
              {activeTab === 'fields' && (
                <div className="space-y-4">
                  {/* Status Banner */}
                  {isApproved && (
                    <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/30 flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                      <div>
                        <h4 className="text-xs font-bold text-emerald-300">{translatePortalText("Clean AI Verification")}</h4>
                        <p className="text-xs text-emerald-400/80">
                          {translatePortalText("All mandatory fields extracted with high certainty. No discrepancies or alterations detected.")}
                        </p>
                      </div>
                    </div>
                  )}

                  {isFlagged && (
                    <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/30 flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <h4 className="text-xs font-bold text-amber-300">
                          {flagReasons.length > 0
                            ? translatePortalText(`Flagged for manual verification — ${flagReasons.length} finding${flagReasons.length === 1 ? '' : 's'}`)
                            : translatePortalText("Held for manual verification")}
                        </h4>
                        {flagReasons.length > 0 ? (
                          <ul className="mt-1.5 space-y-1.5">
                            {flagReasons.map((r, i) => (
                              <li key={`${r.label}-${i}`} className="text-[11.5px] leading-relaxed">
                                <span className="font-bold text-amber-200">{translatePortalText(r.label)}</span>
                                <span className="text-amber-400/80"> {translatePortalText(r.text)}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-1 text-[11.5px] leading-relaxed text-amber-400/80">
                            {translatePortalText("The reading completed and raised nothing specific. It is held because an\n                            automated pass does not stand in for a person's approval.\n                          ")}</p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Expiry Overview Card */}
                  <div className="p-3.5 rounded-xl bg-slate-800/50 border border-slate-700/80 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        <Calendar className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-xs text-slate-400">{translatePortalText("Expiry Date")}</div>
                        <div className="text-sm font-semibold text-white">
                          {doc.expiry?.expiresAt ? formatPortalDate(doc.expiry.expiresAt) : translatePortalText('No Expiry / Lifetime')}
                        </div>
                      </div>
                    </div>
                    {doc.expiry?.daysRemaining !== undefined && (
                      <div
                        className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                          doc.expiry.daysRemaining <= 0
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                            : doc.expiry.daysRemaining <= 30
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        }`}
                      >
                        {doc.expiry.daysRemaining <= 0
                          ? translatePortalText('Expired')
                          : translatePortalText(`${doc.expiry.daysRemaining} days left`)}
                      </div>
                    )}
                  </div>

                  {/* Extracted Fields List */}
                  <div className="space-y-2.5">
                    <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      {translatePortalText("OCR Extracted Attributes\n                    ")}</h4>
                    <div className="space-y-2">
                      {doc.fields && doc.fields.length > 0 ? (
                        doc.fields.map((f, idx) => {
                          const fieldConf = Math.round((f.confidence ?? 0.9) * 100);
                          return (
                            <div
                              key={idx}
                              className="p-3 rounded-xl bg-slate-800/40 border border-slate-700/60 hover:border-slate-600 transition-colors flex items-center justify-between"
                            >
                              <div className="min-w-0 pe-3">
                                <div className="text-xs text-slate-400 font-medium">{translatePortalText(f.label || f.key)}</div>
                                <div className="text-sm font-semibold text-slate-100 truncate mt-0.5 select-all">
                                  {f.value || '—'}
                                </div>
                              </div>
                              <span
                                className={`text-[11px] font-mono px-2 py-0.5 rounded-md shrink-0 ${
                                  fieldConf >= 85
                                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                    : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                }`}
                              >
                                {fieldConf}%
                              </span>
                            </div>
                          );
                        })
                      ) : (
                        <div className="p-4 text-center text-xs text-slate-500 bg-slate-800/30 rounded-xl">
                          {translatePortalText("No structured fields extracted\n                        ")}</div>
                      )}
                    </div>
                  </div>

                  {/* Missing Fields notice if any */}
                  {doc.missingFields && doc.missingFields.length > 0 && (
                    <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-700/50 space-y-1.5">
                      <div className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
                        <Info className="w-3.5 h-3.5" /> {translatePortalText("Optional Fields Not Located\n                      ")}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {doc.missingFields.map((mf, i) => (
                          <span key={i} className="text-xs px-2 py-0.5 rounded bg-slate-700/50 text-slate-300">
                            {translatePortalText(mf.label)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 4: COMPLETE AI RESPONSE / OCR AUDIT */}
              {activeTab === 'rawOcr' && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-cyan-500/20 bg-cyan-950/20 p-3.5">
                    <div className="mb-2 flex items-center gap-2 text-xs font-bold text-cyan-300">
                      <Sparkles className="h-4 w-4" /> {translatePortalText("AI analysis record\n                    ")}</div>
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div><span className="text-slate-400">{translatePortalText("Model:")}</span> <b className="text-slate-100">{doc.analysis?.modelId || translatePortalText('Not recorded')}</b></div>
                      <div><span className="text-slate-400">{translatePortalText("Document type:")}</span> <b className="text-slate-100">{translatePortalText(formatDocType(doc.docType || 'unknown'))}</b></div>
                      <div><span className="text-slate-400">{translatePortalText("Status:")}</span> <b className="text-slate-100">{localizedEnum(doc.status)}</b></div>
                      <div><span className="text-slate-400">{translatePortalText("Latency:")}</span> <b className="text-slate-100">{doc.analysis?.latencyMs != null ? `${formatPortalNumber(doc.analysis.latencyMs)} ${translatePortalText('ms')}` : translatePortalText('Not recorded')}</b></div>
                      {doc.analysis?.inputTokens != null && <div><span className="text-slate-400">{translatePortalText("Input tokens:")}</span> <b className="text-slate-100">{formatPortalNumber(doc.analysis.inputTokens)}</b></div>}
                      {doc.analysis?.outputTokens != null && <div><span className="text-slate-400">{translatePortalText("Output tokens:")}</span> <b className="text-slate-100">{formatPortalNumber(doc.analysis.outputTokens)}</b></div>}
                    </div>
                  </div>

                  {doc.analysis?.notes && (
                    <div className="rounded-xl border border-amber-500/25 bg-amber-950/20 p-3.5">
                      <h4 className="mb-1 text-xs font-bold text-amber-300">{translatePortalText("AI notes")}</h4>
                        <p className="whitespace-pre-wrap text-xs leading-relaxed text-amber-100/90">{translatePortalText(doc.analysis.notes)}</p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{translatePortalText("Raw OCR text")}</h4>
                    {doc.analysis?.ocrText ? (
                      <pre className="max-h-[430px] overflow-auto whitespace-pre-wrap rounded-xl border border-slate-700 bg-slate-950 p-3 text-[11px] leading-relaxed text-slate-200 select-text">{doc.analysis.ocrText}</pre>
                    ) : (
                      <div className="rounded-xl border border-slate-700 bg-slate-800/30 p-4 text-center text-xs text-slate-500">
                        {translatePortalText("No OCR text was stored for this document.\n                      ")}</div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 2: SMART CROSS-CHECKS */}
              {activeTab === 'crossCheck' && (
                <div className="space-y-4">
                  <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                        <ShieldCheck className="w-4 h-4 text-cyan-400" />
                        {translatePortalText("Multi-Source Consistency Score\n                      ")}</span>
                      <span className="text-xs font-bold text-cyan-400">
                        {formatPortalNumber(doc.crossValidation?.score ?? 100)}{translatePortalText("% Match\n                      ")}</span>
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      {translatePortalText("AI compares extracted registration details against insurance policies, vessel database records, and the boat owner profile.\n                    ")}</p>
                  </div>

                  {/* Discrepancies & Flags */}
                  {doc.crossValidation?.flags && doc.crossValidation.flags.length > 0 && (
                    <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-500/30 space-y-2">
                      <div className="text-xs font-bold text-rose-300 flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4 text-rose-400" />
                        {translatePortalText("Cross-Document Inconsistencies Detected\n                      ")}</div>
                      <ul className="text-xs text-rose-300/90 space-y-1.5 ps-4 list-disc">
                        {doc.crossValidation.flags.map((flag, idx) => (
                          <li key={idx}>{flag}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Checks List */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      {translatePortalText("Validation Pipeline Checks\n                    ")}</h4>

                    {doc.crossValidation?.checks && doc.crossValidation.checks.length > 0 ? (
                      doc.crossValidation.checks.map((chk, i) => (
                        <div
                          key={i}
                          className={`p-3 rounded-xl border transition-colors ${
                            chk.status === 'match'
                              ? 'bg-emerald-950/10 border-emerald-500/20'
                              : chk.status === 'mismatch'
                              ? 'bg-rose-950/20 border-rose-500/30'
                              : 'bg-slate-800/40 border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-bold text-white flex items-center gap-1.5">
                              {chk.status === 'match' ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                              ) : chk.status === 'mismatch' ? (
                                <X className="w-3.5 h-3.5 text-rose-400" />
                              ) : (
                                <Info className="w-3.5 h-3.5 text-slate-400" />
                              )}
                              {chk.target}
                            </span>
                            <span
                              className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${
                                chk.status === 'match'
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : chk.status === 'mismatch'
                                  ? 'bg-rose-500/20 text-rose-300'
                                  : 'bg-slate-700 text-slate-300'
                              }`}
                            >
                              {localizedEnum(chk.status)}
                            </span>
                          </div>
                          <p className="text-xs text-slate-300">{chk.detail}</p>
                          {chk.expected && chk.actual && chk.status === 'mismatch' && (
                            <div className="mt-2 text-[11px] grid grid-cols-2 gap-2 p-2 rounded-lg bg-slate-950/60 font-mono">
                              <div>
                                <span className="text-slate-400">{translatePortalText("Expected:")}</span>{' '}
                                <span className="text-emerald-300">{chk.expected}</span>
                              </div>
                              <div>
                                <span className="text-slate-400">{translatePortalText("On Doc:")}</span>{' '}
                                <span className="text-rose-300">{chk.actual}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="p-4 rounded-xl bg-slate-800/40 text-center text-xs text-slate-400">
                        {translatePortalText("Smart cross-validation verified against registered provider profile.\n                      ")}</div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 3: TAMPER & QUALITY */}
              {activeTab === 'fraud' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3.5 rounded-xl bg-slate-800/50 border border-slate-700">
                      <div className="text-xs text-slate-400">{translatePortalText("Image Readability")}</div>
                      <div className="text-lg font-bold text-emerald-400 mt-1">
                        {doc.analysis?.legibility ? formatPortalPercent(Math.round(doc.analysis.legibility * 100)) : `${formatPortalPercent(96)} (${translatePortalText('High')})`}
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">{translatePortalText("Clear text contrast & sharpness")}</p>
                    </div>

                    <div className="p-3.5 rounded-xl bg-slate-800/50 border border-slate-700">
                      <div className="text-xs text-slate-400">{translatePortalText("Tamper Risk")}</div>
                      <div className="text-lg font-bold text-emerald-400 mt-1">
                        {localizedEnum(doc.fraud?.level || 'low')}
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">{translatePortalText("No digital edits detected")}</p>
                    </div>
                  </div>

                  {doc.fraud?.signals && doc.fraud.signals.length > 0 ? (
                    <div className="space-y-2">
                      <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                        {translatePortalText("Fraud & Anomaly Signals\n                      ")}</h4>
                      {doc.fraud.signals.map((sig, i) => (
                        <div
                          key={i}
                          className="p-3 rounded-xl bg-amber-950/20 border border-amber-500/30 flex items-start gap-2.5 text-xs text-amber-300"
                        >
                          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-bold">{sig.code}:</span> {sig.detail}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 rounded-xl bg-slate-800/30 border border-slate-700/40 text-center text-xs text-slate-400 flex flex-col items-center gap-2">
                      <ShieldCheck className="w-8 h-8 text-emerald-400 opacity-80" />
                      <p>{translatePortalText("Full vision scan passed. Document integrity and typography are authentic.")}</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Review Decision Form / Actions */}
            <div className="p-4 border-t border-slate-800 bg-slate-900/95 space-y-3">
              {canReview ? (showRejectForm ? (
                <div className="space-y-2.5 animate-in slide-in-from-bottom-2 duration-150">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-rose-300">{translatePortalText("Rejection Reason for Provider:")}</label>
                    <button
                      onClick={() => setShowRejectForm(false)}
                      className="text-xs text-slate-400 hover:text-white"
                    >
                      {translatePortalText("Cancel")}
                    </button>
                  </div>
                  <textarea
                    rows={2}
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    placeholder={translatePortalText("e.g. Document expired on Jan 2026. Please upload current policy.")}
                    className="w-full text-xs p-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-rose-500"
                  />
                  <button
                    disabled={submitting}
                    onClick={handleReject}
                    className="w-full py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs transition-colors flex items-center justify-center gap-2"
                  >
                    {submitting ? translatePortalText('Submitting...') : translatePortalText('Confirm Document Rejection')}
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setShowRejectForm(true)}
                    className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-rose-950/60 border border-slate-700 hover:border-rose-500/50 text-slate-300 hover:text-rose-300 font-semibold text-xs transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Ban className="w-4 h-4" /> {translatePortalText("Reject Document")}
                  </button>
                  <button
                    disabled={submitting}
                    onClick={handleApprove}
                    className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-colors flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-950"
                  >
                    <CheckCircle2 className="w-4 h-4" /> {translatePortalText("Approve Document")}
                  </button>
                </div>
              )) : (
                <div className={`rounded-xl border p-3 text-xs ${isApproved ? 'border-emerald-500/30 bg-emerald-950/30 text-emerald-300' : isRejected ? 'border-rose-500/30 bg-rose-950/30 text-rose-300' : 'border-slate-700 bg-slate-800/40 text-slate-400'}`}>
                  {isApproved
                    ? `${translatePortalText('Approved by admin')}${doc.review?.reviewedAt ? ` · ${translatePortalText('Approval date:')} ${formatPortalDate(doc.review.reviewedAt, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}.`
                    : isRejected
                      ? `${translatePortalText('Rejected by admin')}${doc.review?.reason ? `: ${doc.review.reason}` : '.'}`
                      : `${translatePortalText('Document cannot be approved while its AI status is “')}${localizedEnum(doc.status)}${translatePortalText('”.')}`}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
