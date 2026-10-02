import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Clock,
  UploadCloud,
  Sparkles,
  FileCheck,
  ShieldAlert,
  Loader2,
  RefreshCw,
  Eye,
  Info
} from 'lucide-react';
import {
  aiDocumentApi,
  MarinaRequirementsEvaluation,
  MarinaRequirementItem,
  AIDocument
} from '../api';
import { AiDocumentVerificationModal } from './AiDocumentVerificationModal';
import { translatePortalText } from '../i18n/runtime'


interface DocumentVaultPickerProps {
  marinaId: string;
  boatId?: string;
  onSelectionChanged?: (selectedDocIds: string[], isEligible: boolean) => void;
}

export const DocumentVaultPicker: React.FC<DocumentVaultPickerProps> = ({
  marinaId,
  boatId,
  onSelectionChanged,
}) => {
  const [loading, setLoading] = useState(true);
  const [evaluation, setEvaluation] = useState<MarinaRequirementsEvaluation | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [uploadingDocType, setUploadingDocType] = useState<string | null>(null);
  const [inspectingDoc, setInspectingDoc] = useState<AIDocument | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchRequirements = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await aiDocumentApi.bookingRequirements(marinaId, boatId);
      if (res.data) {
        setEvaluation(res.data);
        const autoSelected = res.data.suggestedDocumentIds || [];
        setSelectedIds(autoSelected);
        if (onSelectionChanged) {
          onSelectionChanged(autoSelected, res.data.isEligible);
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to evaluate marina document requirements');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (marinaId) {
      fetchRequirements();
    }
  }, [marinaId, boatId]);

  const handleFileUpload = async (reqType: string, file: File) => {
    try {
      setUploadingDocType(reqType);
      const res = await aiDocumentApi.upload(file, reqType, boatId);
      if (res.data?.document) {
        // Refresh requirements to reflect newly uploaded document
        await fetchRequirements();
      }
    } catch (err: any) {
      alert(translatePortalText(err?.message || 'Failed to upload document for AI analysis'));
    } finally {
      setUploadingDocType(null);
    }
  };

  const toggleSelectDoc = (docId: string) => {
    const next = selectedIds.includes(docId)
      ? selectedIds.filter((id) => id !== docId)
      : [...selectedIds, docId];
    setSelectedIds(next);
    if (onSelectionChanged && evaluation) {
      const isStillEligible = evaluation.totalRequired <= next.length && evaluation.isEligible;
      onSelectionChanged(next, isStillEligible);
    }
  };

  if (loading) {
    return (
      <div className="p-6 rounded-2xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center text-center space-y-3">
        <Loader2 className="w-8 h-8 text-cyan-700 dark:text-cyan-400 animate-spin" />
        <div className="text-sm font-semibold text-deep-900">{translatePortalText("Matching with Document Vault...")}</div>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          {translatePortalText("Checking your previously verified certificates and policies for this marina.\n        ")}</p>
      </div>
    );
  }

  if (error || !evaluation) {
    return (
      <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-500/30 text-xs text-rose-800 dark:text-rose-300 flex items-center justify-between">
        <span>{translatePortalText(error || 'Could not load required documents.')}</span>
        <button
          onClick={fetchRequirements}
          className="px-2.5 py-1 rounded-lg bg-rose-700 hover:bg-rose-800 text-white font-medium flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" /> {translatePortalText("Retry\n        ")}</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header Eligibility Alert */}
      <div
        className={`p-4 rounded-2xl border flex items-start gap-3.5 transition-all ${
          evaluation.isEligible
            ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-500/30'
            : 'bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-500/30'
        }`}
      >
        {evaluation.isEligible ? (
          <div className="p-2 rounded-xl bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        ) : (
          <div className="p-2 rounded-xl bg-amber-100 dark:bg-amber-500/10 text-amber-800 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20">
            <AlertTriangle className="w-5 h-5" />
          </div>
        )}

        <div className="flex-1">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-deep-900">
              {evaluation.isEligible
                ? translatePortalText('All Marina Document Requirements Satisfied')
                : translatePortalText('Action Needed: Missing or Expired Documents')}
            </h4>
            <span className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300">
              {evaluation.satisfiedCount}/{evaluation.totalRequired} {translatePortalText("Ready\n            ")}</span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
            {evaluation.isEligible
              ? translatePortalText('Previously approved documents from your Document Vault have been automatically pre-selected.')
              : translatePortalText('Please upload the missing or expired documents below. Our AI engine will analyze and extract the fields instantly.')}
          </p>
        </div>
      </div>

      {/* Requirements List */}
      <div className="space-y-2.5">
        {evaluation.requirements.map((req: MarinaRequirementItem, idx: number) => {
          const matched = req.matchedDocument;
          const isSelected = matched && selectedIds.includes(matched._id || matched.id || '');
          const isUploading = uploadingDocType === req.docType;

          return (
            <div
              key={idx}
              className={`p-4 rounded-xl border transition-all ${
                req.status === 'verified'
                  ? 'bg-white dark:bg-slate-900/80 border-emerald-300 dark:border-emerald-500/30'
                  : req.status === 'flagged'
                  ? 'bg-white dark:bg-slate-900/80 border-amber-300 dark:border-amber-500/30'
                  : req.status === 'expired'
                  ? 'bg-white dark:bg-slate-900/80 border-rose-300 dark:border-rose-500/30'
                  : 'bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div
                    className={`p-2 rounded-lg mt-0.5 ${
                      req.status === 'verified'
                        ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                        : req.status === 'flagged'
                        ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-400'
                        : 'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400'
                    }`}
                  >
                    {req.status === 'verified' ? (
                      <FileCheck className="w-4 h-4" />
                    ) : req.status === 'flagged' ? (
                      <AlertTriangle className="w-4 h-4" />
                    ) : (
                      <Clock className="w-4 h-4" />
                    )}
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-deep-900">{translatePortalText(req.label)}</span>
                      {req.status === 'verified' && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20 flex items-center gap-1">
                          <Sparkles className="w-3 h-3" /> {translatePortalText("Auto-Matched\n                        ")}</span>
                      )}
                      {req.status === 'flagged' && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20">
                          {translatePortalText("Staff Review\n                        ")}</span>
                      )}
                      {req.status === 'expired' && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-500/20">
                          {translatePortalText("Expired\n                        ")}</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">{translatePortalText(req.reason || req.description)}</p>
                  </div>
                </div>

                {/* Actions: View / Toggle / Upload */}
                <div className="flex items-center gap-2">
                  {matched && (
                    <button
                      type="button"
                      onClick={() => setInspectingDoc(matched)}
                      className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 hover:text-deep-900 dark:hover:text-white transition-colors"
                      title={translatePortalText("Inspect AI extraction")}
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                  )}

                  {req.status === 'verified' || req.status === 'flagged' ? (
                    <button
                      type="button"
                      onClick={() => matched && toggleSelectDoc(matched._id || matched.id || '')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                        isSelected
                          ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-deep-900 dark:hover:text-white'
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {translatePortalText(isSelected ? 'Selected' : 'Select')}
                    </button>
                  ) : (
                    <label
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 ${
                        isUploading
                          ? 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 cursor-not-allowed'
                          : 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-md shadow-cyan-950'
                      }`}
                    >
                      {isUploading ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" /> {translatePortalText("Analyzing...\n                        ")}</>
                      ) : (
                        <>
                          <UploadCloud className="w-3.5 h-3.5" /> {translatePortalText("Upload Now\n                        ")}</>
                      )}
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        className="hidden"
                        disabled={isUploading}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleFileUpload(req.docType, file);
                        }}
                      />
                    </label>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* AI Side-by-Side Inspection Modal */}
      {inspectingDoc && (
        <AiDocumentVerificationModal
          document={inspectingDoc}
          isOpen={Boolean(inspectingDoc)}
          onClose={() => setInspectingDoc(null)}
        />
      )}
    </div>
  );
};
