import React, { useEffect, useState } from 'react';
import {
  FileText,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Clock,
  UploadCloud,
  Search,
  Filter,
  Sparkles,
  Eye,
  RefreshCw,
  ExternalLink,
  Plus,
  Layers,
  ChevronRight,
  FolderOpen,
  Calendar,
  Anchor,
  Loader2,
  FileCheck,
  User,
} from 'lucide-react';
import {
  aiDocumentApi,
  AIDocument,
  VaultSummary,
  VaultCategoryGroup
} from '../api';
import { AiDocumentVerificationModal } from '../components/AiDocumentVerificationModal';
import { formatPortalDate, formatPortalNumber, translatePortalText } from '../i18n/runtime'
import { toast } from '../ui'

/** The API's own limits for `/ai-documents` (`docUpload`): images or PDF, 15 MB. */
const VAULT_FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
const VAULT_MAX_BYTES = 15 * 1024 * 1024;

/** The eight types the upload accepts (`AI_DOC_TYPES`), as offered in the form below. */
const DECLARABLE_TYPES = [
  'national_id', 'iqama', 'commercial_registration', 'vat_certificate', 'national_address',
  'boat_registration', 'boat_license', 'captain_license',
];

/**
 * What the form starts on. A marina operator files business papers — it has
 * no boat registration of its own, which is what this form used to default to.
 */
const DEFAULT_DECLARED_TYPE = 'commercial_registration';


export const DocumentVault: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<VaultSummary | null>(null);
  const [categories, setCategories] = useState<VaultCategoryGroup[]>([]);
  const [allDocs, setAllDocs] = useState<AIDocument[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedDocForInspect, setSelectedDocForInspect] = useState<AIDocument | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [declaredType, setDeclaredType] = useState(DEFAULT_DECLARED_TYPE);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  // A failed load used to leave the zeros and "No documents found" on screen,
  // which reads as an empty vault rather than a vault that did not answer.
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchVault = async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const res = await aiDocumentApi.vault();
      if (res.data) {
        setSummary(res.data.summary);
        setCategories(res.data.categories || []);
        setAllDocs(res.data.documents || []);
      }
    } catch (err: any) {
      console.error('Failed to load Document Vault:', err);
      setLoadError(err?.message || 'Could not load your document vault');
    } finally {
      setLoading(false);
    }
  };

  const openUpload = (type: string = DEFAULT_DECLARED_TYPE) => {
    setDeclaredType(type);
    setUploadFile(null);
    setUploadModalOpen(true);
  };

  const closeUpload = () => {
    // Closing mid-upload would leave the request running with no sign of it.
    if (isUploading) return;
    setUploadModalOpen(false);
    setUploadFile(null);
  };

  // The API's type and size limits, checked on pick so a HEIC from a phone or
  // a 40 MB scan is refused with a reason instead of a bare 400.
  const pickUploadFile = (file: File | null) => {
    if (!file) { setUploadFile(null); return; }
    if (!VAULT_FILE_TYPES.includes(file.type)) {
      toast(translatePortalText('Use a PDF, JPG, PNG, WebP or GIF file'), 'warn');
      setUploadFile(null);
      return;
    }
    if (file.size > VAULT_MAX_BYTES) {
      toast(translatePortalText('That file is larger than 15 MB'), 'warn');
      setUploadFile(null);
      return;
    }
    setUploadFile(file);
  };

  useEffect(() => {
    fetchVault();
  }, []);

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile || isUploading) return;
    try {
      setIsUploading(true);
      await aiDocumentApi.upload(uploadFile, declaredType);
      setUploadModalOpen(false);
      setUploadFile(null);
      toast(translatePortalText('Uploaded — the AI check runs in the background'), 'success');
      await fetchVault();
    } catch (err: any) {
      toast(translatePortalText(err?.message || 'Upload failed'), 'warn');
    } finally {
      setIsUploading(false);
    }
  };

  /**
   * Documents the API's categories do not cover — an Iqama, a national address,
   * a boat licence, or a scan the classifier could not place ("unknown", which
   * is where every marina compliance upload starts). They were reachable only
   * under "All", and silently absent from every tab.
   */
  const categorisedTypes = new Set(categories.flatMap((c) => c.docTypes));
  const uncategorised = allDocs.filter((d) => !categorisedTypes.has(d.docType));

  // Filter documents
  const filteredDocs = allDocs.filter((doc) => {
    if (selectedCategory === 'other') {
      if (categorisedTypes.has(doc.docType)) return false;
    } else if (selectedCategory !== 'all') {
      const cat = categories.find((c) => c.category === selectedCategory);
      if (cat && !cat.docTypes.includes(doc.docType)) return false;
    }
    if (statusFilter !== 'all') {
      // Same rule as the card's "Verified" pill and the summary count: an
      // analysed document that has expired is not verified.
      if (statusFilter === 'verified' && doc.status !== 'approved' && !(doc.status === 'analyzed' && doc.expiry?.status !== 'expired')) return false;
      if (statusFilter === 'needs_review' && doc.status !== 'needs_review') return false;
      if (statusFilter === 'expired' && doc.expiry?.status !== 'expired') return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchType = doc.docType?.toLowerCase().includes(q);
      const matchName = doc.fileName?.toLowerCase().includes(q);
      const matchField = doc.fields?.some((f) => f.value?.toLowerCase().includes(q));
      if (!matchType && !matchName && !matchField) return false;
    }
    return true;
  });

  const formatDocType = (type: string) => {
    return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 text-deep-900">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
              <div className="p-2.5 rounded-xl bg-cyan-50 dark:bg-cyan-500/10 border border-cyan-200 dark:border-cyan-500/20 text-cyan-700 dark:text-cyan-400">
              <FolderOpen className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-deep-900 tracking-tight">{translatePortalText("Compliance Document Vault")}</h1>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                {translatePortalText("Centralized vault for identity, business and vessel documents with AI OCR & auto-reuse.\r\n              ")}</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchVault}
            className="p-2.5 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 hover:text-deep-900 dark:hover:text-white border border-slate-200 dark:border-slate-700 transition-colors"
            title={translatePortalText("Refresh Vault")}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => openUpload()}
            className="px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs transition-colors flex items-center gap-2 shadow-lg shadow-cyan-950"
          >
            <Plus className="w-4 h-4" /> {translatePortalText("Upload Document\r\n          ")}</button>
        </div>
      </div>

      {/* KPI Stats Overview */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        <div className="card p-4 relative overflow-hidden">
          <div className="text-xs font-medium text-slate-600 dark:text-slate-400">{translatePortalText("Total In Vault")}</div>
          <div className="text-2xl font-bold text-deep-900 mt-1">{formatPortalNumber(summary?.total ?? 0)}</div>
          <div className="text-[11px] text-slate-500 mt-1">{translatePortalText("Stored certificates")}</div>
        </div>

        <div className="card p-4 relative overflow-hidden">
          <div className="text-xs font-medium text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" /> {translatePortalText("AI Verified\r\n          ")}</div>
          <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400 mt-1">{formatPortalNumber(summary?.verifiedCount ?? 0)}</div>
          <div className="text-[11px] text-slate-500 mt-1">{translatePortalText("Ready for auto-reuse")}</div>
        </div>

        <div className="card p-4 relative overflow-hidden">
          <div className="text-xs font-medium text-amber-700 dark:text-amber-400 flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" /> {translatePortalText("Staff Review\r\n          ")}</div>
          <div className="text-2xl font-bold text-amber-700 dark:text-amber-400 mt-1">{formatPortalNumber(summary?.needsReviewCount ?? 0)}</div>
          <div className="text-[11px] text-slate-500 mt-1">{translatePortalText("Flagged for inspection")}</div>
        </div>

        <div className="card p-4 relative overflow-hidden">
          <div className="text-xs font-medium text-blue-700 dark:text-blue-400 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" /> {translatePortalText("Expiring Soon\r\n          ")}</div>
          <div className="text-2xl font-bold text-blue-700 dark:text-blue-400 mt-1">{formatPortalNumber(summary?.expiringSoonCount ?? 0)}</div>
          <div className="text-[11px] text-slate-500 mt-1">{translatePortalText("Next 30 days")}</div>
        </div>

        <div className="card p-4 relative overflow-hidden">
          <div className="text-xs font-medium text-rose-700 dark:text-rose-400 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" /> {translatePortalText("Expired\r\n          ")}</div>
          <div className="text-2xl font-bold text-rose-700 dark:text-rose-400 mt-1">{formatPortalNumber(summary?.expiredCount ?? 0)}</div>
          <div className="text-[11px] text-slate-500 mt-1">{translatePortalText("Requires renewal")}</div>
        </div>
      </div>

      {/* Category Tabs & Filter Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-2 md:pb-0">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors ${
              selectedCategory === 'all'
                ? 'bg-cyan-50 text-cyan-800 border border-cyan-200 dark:bg-cyan-500/20 dark:text-cyan-300 dark:border-cyan-500/30'
                : 'bg-white dark:bg-slate-900/60 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:text-white border border-slate-200 dark:border-slate-800'
            }`}
          >
            {translatePortalText("All Categories (")}{formatPortalNumber(allDocs.length)})
          </button>
          {categories.map((cat) => (
            <button
              key={cat.category}
              onClick={() => setSelectedCategory(cat.category)}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors ${
                selectedCategory === cat.category
                  ? 'bg-cyan-50 text-cyan-800 border border-cyan-200 dark:bg-cyan-500/20 dark:text-cyan-300 dark:border-cyan-500/30'
                  : 'bg-white dark:bg-slate-900/60 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:text-white border border-slate-200 dark:border-slate-800'
              }`}
            >
              {translatePortalText(cat.label)} ({formatPortalNumber(cat.documents?.length || 0)})
            </button>
          ))}
          {uncategorised.length > 0 && (
            <button
              onClick={() => setSelectedCategory('other')}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors ${
                selectedCategory === 'other'
                  ? 'bg-cyan-50 text-cyan-800 border border-cyan-200 dark:bg-cyan-500/20 dark:text-cyan-300 dark:border-cyan-500/30'
                  : 'bg-white dark:bg-slate-900/60 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:text-white border border-slate-200 dark:border-slate-800'
              }`}
            >
              {translatePortalText('Other documents')} ({formatPortalNumber(uncategorised.length)})
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1 sm:w-64">
              <Search className="w-4 h-4 text-slate-500 dark:text-slate-400 absolute start-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={translatePortalText("Search documents or fields...")}
              className="w-full ps-9 pe-3 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-deep-900 placeholder:text-slate-400 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-deep-900 focus:outline-none focus:border-cyan-500"
          >
            <option value="all">{translatePortalText("All Statuses")}</option>
            <option value="verified">{translatePortalText("Verified")}</option>
            <option value="needs_review">{translatePortalText("Needs Review")}</option>
            <option value="expired">{translatePortalText("Expired")}</option>
          </select>
        </div>
      </div>

      {/* Documents Grid */}
      {loading ? (
        <div className="p-12 text-center text-slate-500">
          <Loader2 className="w-8 h-8 mx-auto animate-spin text-cyan-700 dark:text-cyan-400 mb-2" />
          {translatePortalText("Loading document vault...\r\n        ")}</div>
      ) : loadError ? (
        <div className="p-12 text-center bg-white dark:bg-slate-900/40 rounded-2xl border border-rose-200 space-y-3">
          <ShieldAlert className="w-10 h-10 mx-auto text-rose-400" />
          <div className="text-sm font-semibold text-deep-800">{translatePortalText('Could not load your document vault')}</div>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">{translatePortalText(loadError)}</p>
          <button onClick={fetchVault} className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            {translatePortalText('Try again')}
          </button>
        </div>
      ) : allDocs.length > 0 && filteredDocs.length === 0 ? (
        <div className="p-12 text-center text-slate-500 bg-white dark:bg-slate-900/40 rounded-2xl border border-slate-200 dark:border-slate-800/80 space-y-3">
          <Filter className="w-10 h-10 mx-auto opacity-30 text-slate-400" />
          <div className="text-sm font-semibold text-deep-800">{translatePortalText('No documents match these filters')}</div>
          <button
            onClick={() => { setSelectedCategory('all'); setStatusFilter('all'); setSearchQuery(''); }}
            className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            {translatePortalText('Clear filters')}
          </button>
        </div>
      ) : filteredDocs.length === 0 ? (
        <div className="p-12 text-center text-slate-500 bg-white dark:bg-slate-900/40 rounded-2xl border border-slate-200 dark:border-slate-800/80 space-y-3">
          <FileText className="w-12 h-12 mx-auto opacity-30 text-slate-400" />
          <div className="text-sm font-semibold text-deep-800">{translatePortalText("No documents found")}</div>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            {translatePortalText('Upload your commercial registration, VAT certificate or national address. BoatPro’s AI reads each one and flags anything that needs a second look.')}</p>
          <button
            onClick={() => openUpload()}
            className="px-4 py-2 rounded-xl bg-cyan-50 dark:bg-cyan-600/20 text-cyan-800 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-500/30 text-xs font-semibold hover:bg-cyan-100 dark:hover:bg-cyan-600/30"
          >
            {translatePortalText("Upload First Document\r\n          ")}</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredDocs.map((doc) => {
            const isVerified = doc.status === 'approved' || (doc.status === 'analyzed' && doc.expiry?.status !== 'expired');
            const isFlagged = doc.status === 'needs_review';
            const isExpired = doc.expiry?.status === 'expired';
            const isRejected = doc.status === 'rejected';
            const isFailed = doc.status === 'failed';
            const isPending = doc.status === 'queued' || doc.status === 'analyzing';
            // No invented score: a document the AI has not read (or could not)
            // showed "AI Score: 85%" from a fallback. It now shows a dash.
            const confidencePct = !isPending && !isFailed && typeof doc.confidence?.overall === 'number'
              ? Math.round(doc.confidence.overall * 100)
              : null;
            // The flag that sent it to review — wrong document type, possible
            // forgery, a duplicate — so the owner knows what to fix. These are
            // cleared only by BoatPro's review, never from this page.
            const topFlag = (doc.validation ?? []).find((v) => v.severity === 'critical') ?? (doc.validation ?? []).find((v) => v.severity === 'warning');
            const canReplace = isRejected || isFailed || isExpired || isFlagged;
            const replaceType = DECLARABLE_TYPES.includes(doc.declaredType ?? '')
              ? (doc.declaredType as string)
              : DECLARABLE_TYPES.includes(doc.docType) ? doc.docType : DEFAULT_DECLARED_TYPE;

            const vesselField = doc.fields?.find((f) => f.key === 'vesselName' || f.key === 'insuredVessel')?.value;
            const regField = doc.fields?.find((f) => f.key === 'registrationNumber' || f.key === 'policyNumber' || f.key === 'licenseNumber')?.value;
            const holderField = doc.fields?.find((f) => f.key === 'holderName')?.value;

            return (
              <div
                key={doc._id || doc.id}
                className="card p-5 hover:border-slate-300 dark:hover:border-slate-700 transition-all flex flex-col justify-between group"
              >
                <div className="space-y-3.5">
                  {/* Card Top */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 rounded-xl bg-cyan-50 dark:bg-slate-800 text-cyan-700 dark:text-cyan-400 border border-cyan-100 dark:border-slate-700">
                        <FileCheck className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-deep-900 group-hover:text-cyan-700 dark:group-hover:text-cyan-300 transition-colors">
                          {translatePortalText(formatDocType(doc.docType))}
                        </h3>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[170px]">
                          {doc.fileName || translatePortalText('No filename')}
                        </div>
                      </div>
                    </div>

                    {/* Status Pill */}
                    {isVerified && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> {translatePortalText("Verified\r\n                      ")}</span>
                    )}
                    {isFlagged && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> {translatePortalText("Review\r\n                      ")}</span>
                    )}
                    {isExpired && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-500/20 flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {translatePortalText("Expired\r\n                      ")}</span>
                    )}
                    {/* Rejected, failed and in-progress documents carried no pill at all. */}
                    {isRejected && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 flex items-center gap-1">
                        <ShieldAlert className="w-3 h-3" /> {translatePortalText('Rejected')}</span>
                    )}
                    {isFailed && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> {translatePortalText('Could not be read')}</span>
                    )}
                    {isPending && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-50 text-slate-600 border border-slate-200 flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" /> {translatePortalText('Analysing')}</span>
                    )}
                  </div>

                  {(isRejected || isFlagged || isFailed) && (doc.review?.reason || topFlag?.message || doc.failureReason) && (
                    <p className={`rounded-lg px-2.5 py-1.5 text-[11px] leading-snug break-words ${isRejected ? 'bg-rose-50 text-rose-700' : isFailed ? 'bg-slate-50 text-slate-600' : 'bg-amber-50 text-amber-800'}`}>
                      {isRejected ? (doc.review?.reason || topFlag?.message) : isFailed ? (doc.failureReason || topFlag?.message) : topFlag?.message}
                    </p>
                  )}

                  {/* Metadata Chips */}
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 space-y-1.5 text-xs">
                    {vesselField && (
                      <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                        <span className="flex items-center gap-1">
                          <Anchor className="w-3 h-3 text-slate-500" /> {translatePortalText("Vessel:\r\n                        ")}</span>
                        <span className="font-semibold text-deep-900 truncate max-w-[140px]">{vesselField}</span>
                      </div>
                    )}
                    {regField && (
                      <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                        <span>{translatePortalText("Identifier:")}</span>
                        <span className="font-mono text-slate-700 dark:text-slate-200">{regField}</span>
                      </div>
                    )}
                    {holderField && (
                      <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                        <span className="flex items-center gap-1">
                          <User className="w-3 h-3 text-slate-500" /> {translatePortalText("Holder:\r\n                        ")}</span>
                        <span className="text-slate-700 dark:text-slate-200 truncate max-w-[140px]">{holderField}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-slate-600 dark:text-slate-400 pt-1 border-t border-slate-200 dark:border-slate-800/60">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-slate-500" /> {translatePortalText("Expiry:\r\n                      ")}</span>
                      <span className={doc.expiry?.status === 'expired' ? 'text-rose-700 dark:text-rose-400 font-bold' : 'text-slate-700 dark:text-slate-200'}>
                        {doc.expiry?.expiresAt ? formatPortalDate(doc.expiry.expiresAt) : translatePortalText('No Expiry')}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Card Bottom / Actions */}
                <div className="pt-4 mt-3 border-t border-slate-200 dark:border-slate-800/80 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-400">
                    <span>{translatePortalText("AI Score:")}</span>
                    <span className={`font-bold ${confidencePct === null ? 'text-slate-400' : confidencePct >= 80 ? 'text-emerald-700 dark:text-emerald-400' : confidencePct >= 50 ? 'text-amber-700' : 'text-rose-700'}`}>
                      {confidencePct === null ? '—' : `${formatPortalNumber(confidencePct)}%`}
                    </span>
                  </div>

                  {/* A fresh copy after a rejection, a failed read, a flag or an
                      expiry — the vault had no way back from any of them. */}
                  {canReplace && (
                    <button
                      onClick={() => openUpload(replaceType)}
                      className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors flex items-center gap-1.5"
                      title={translatePortalText('Upload a corrected or renewed copy')}
                    >
                      <UploadCloud className="w-3.5 h-3.5" /> {translatePortalText('Replace')}
                    </button>
                  )}

                  <button
                    onClick={() => setSelectedDocForInspect(doc)}
                    className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-semibold text-cyan-700 dark:text-cyan-300 hover:text-cyan-900 dark:hover:text-white transition-colors flex items-center gap-1.5"
                  >
                    <Eye className="w-3.5 h-3.5" /> {translatePortalText("Inspect AI\r\n                  ")}</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Upload Modal */}
      {uploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-deep-950/55 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="card w-full max-w-md rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-500/20">
                  <Sparkles className="w-5 h-5" />
                </div>
                <h3 className="text-base font-bold text-deep-900">{translatePortalText("Upload Compliance Document")}</h3>
              </div>
              <button
                onClick={closeUpload}
                disabled={isUploading}
                className="text-slate-500 hover:text-deep-900 dark:text-slate-400 dark:hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleUploadSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5 block">{translatePortalText("Document Type")}</label>
                <select
                  value={declaredType}
                  onChange={(e) => setDeclaredType(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-xs text-deep-900 focus:outline-none focus:border-cyan-500"
                >
                  {/* The eight the API accepts. Anything else is rejected on
                      upload, so offering it here would only produce a 400. */}
                  <option value="national_id">{translatePortalText("National ID")}</option>
                  <option value="iqama">{translatePortalText("Iqama (residency ID)")}</option>
                  <option value="commercial_registration">{translatePortalText("Commercial Registration (CR)")}</option>
                  <option value="vat_certificate">{translatePortalText("VAT Certificate")}</option>
                  <option value="national_address">{translatePortalText("National Address")}</option>
                  <option value="boat_registration">{translatePortalText("Boat Registration")}</option>
                  <option value="boat_license">{translatePortalText("Boat Licence — reviewed by admin")}</option>
                  <option value="captain_license">{translatePortalText("Captain Licence — reviewed by admin")}</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5 block">{translatePortalText("Select File (PDF / Image)")}</label>
                <div className="p-6 border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-cyan-500/60 rounded-xl bg-slate-50 dark:bg-slate-950/60 text-center cursor-pointer relative">
                  <input
                    type="file"
                    required
                    accept={VAULT_FILE_TYPES.join(',')}
                    onChange={(e) => { pickUploadFile(e.target.files?.[0] || null); e.target.value = ''; }}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                  <UploadCloud className="w-8 h-8 mx-auto text-slate-500 dark:text-slate-400 mb-2" />
                  {uploadFile ? (
                    <div className="text-xs text-cyan-800 dark:text-cyan-300 font-semibold truncate">{uploadFile.name}</div>
                  ) : (
                    <>
                      <div className="text-xs font-semibold text-deep-900">{translatePortalText("Click or drag file here")}</div>
                      <div className="text-[11px] text-slate-500 mt-1">{translatePortalText("Supports JPG, PNG, PDF up to 15MB")}</div>
                    </>
                  )}
                </div>
              </div>

              <p className="text-[11px] leading-snug text-slate-500">
                {translatePortalText('If the AI check flags a wrong document type, a possible forgery or a duplicate, only BoatPro’s review can clear it — upload the correct document rather than the same file again.')}
              </p>

              <button
                type="submit"
                disabled={isUploading || !uploadFile}
                className="w-full py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-bold text-xs transition-colors flex items-center justify-center gap-2 shadow-lg shadow-cyan-950"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> {translatePortalText("Scanning with AI Vision...\r\n                  ")}</>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" /> {translatePortalText("Upload & Extract Fields\r\n                  ")}</>
                )}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Side-by-Side AI Inspection Modal */}
      {selectedDocForInspect && (
        <AiDocumentVerificationModal
          document={selectedDocForInspect}
          isOpen={Boolean(selectedDocForInspect)}
          onClose={() => setSelectedDocForInspect(null)}
          onStatusUpdated={() => fetchVault()}
          reviewable={false}
        />
      )}
    </div>
  );
};
