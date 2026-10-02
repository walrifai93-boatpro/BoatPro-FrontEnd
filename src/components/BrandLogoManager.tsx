import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Upload, Trash2, Sparkles, Image as ImageIcon, Eye, CheckCircle2, ShieldCheck, Sun, Moon } from 'lucide-react';
import { fileUrl } from '../api';
import { pickFiles, Spinner, toast } from '../ui';
import { translatePortalText } from '../i18n/runtime'


interface BrandLogoManagerProps {
  logoUrl?: string;
  providerName?: string;
  categoryLabel?: string; // e.g. "Marina", "Fuel Station", "Workshop", "Boat Fleet"
  onUpload: (file: File) => Promise<void>;
  onRemove: (url: string) => Promise<void>;
  disabled?: boolean;
}

export default function BrandLogoManager({
  logoUrl,
  providerName: providerNameProp,
  categoryLabel = 'Provider',
  onUpload,
  onRemove,
  disabled = false,
}: BrandLogoManagerProps) {
  // The fallback is interface copy; a real business name is shown as entered.
  const providerName = providerNameProp || translatePortalText('Your Brand');
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [previewTab, setPreviewTab] = useState<'checkerboard' | 'light' | 'dark'>('checkerboard');

  const handlePick = async () => {
    const files = await pickFiles('image/png,image/webp,image/svg+xml,image/jpeg', false);
    if (!files.length) return;
    const file = files[0];

    // Check if format is non-png / non-webp to provide a gentle hint
    if (!file.type.includes('png') && !file.type.includes('webp') && !file.type.includes('svg')) {
      toast(translatePortalText('Tip: For best branding, upload a PNG or WebP with a transparent background!'), 'info');
    }

    setUploading(true);
    try {
      await onUpload(file);
      toast(translatePortalText('Brand logo uploaded and updated across all partner cards! ✨'), 'success');
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Logo upload failed'), 'warn');
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    if (!logoUrl) return;
    setDeleting(true);
    try {
      await onRemove(logoUrl);
      toast(translatePortalText('Brand logo removed'), 'info');
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not remove logo'), 'warn');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden mb-6">
      {/* Header Banner */}
      <div className="portal-dark-workspace bg-gradient-to-r from-ocean-950 via-deep-900 to-ocean-900 p-4 sm:p-5 text-white">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ocean-500/20 text-ocean-400 border border-ocean-400/30">
              <Sparkles size={20} className="animate-pulse-soft" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-display text-base font-extrabold tracking-tight text-white">
                  {translatePortalText("Official Brand Logo & Emblem\n                ")}</h3>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 border border-emerald-500/30 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-emerald-300">
                  <ShieldCheck size={11} /> {translatePortalText("Reputation Asset\n                ")}</span>
              </div>
              <p className="text-xs text-slate-300 mt-1 max-w-2xl leading-relaxed">
                {translatePortalText("Upload a ")}<span className="font-bold text-ocean-300 underline underline-offset-2">{translatePortalText("backgroundless/transparent logo")}</span> {translatePortalText("(.PNG or .WebP). \n                Your official logo gives your brand credibility and appears on search cards, reservation sheets, quotes, and partner vendor manifests.\n              ")}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={disabled || uploading || deleting}
              onClick={handlePick}
              className="inline-flex items-center gap-2 rounded-xl bg-ocean-500 hover:bg-ocean-400 active:scale-95 text-white font-bold text-xs px-4 py-2.5 shadow-glow transition disabled:opacity-50"
            >
              {uploading ? (
                <>
                  <Spinner size={14} /> {translatePortalText("Uploading…\n                ")}</>
              ) : (
                <>
                  <Upload size={14} /> {translatePortalText(logoUrl ? 'Replace Logo' : 'Upload Transparent Logo')}
                </>
              )}
            </button>

            {logoUrl && (
              <button
                type="button"
                disabled={disabled || uploading || deleting}
                onClick={handleRemove}
                title={translatePortalText("Remove logo")}
                className="inline-flex items-center justify-center h-9 w-9 rounded-xl bg-white/10 hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 border border-white/15 hover:border-rose-400/30 transition disabled:opacity-50"
              >
                {deleting ? <Spinner size={13} /> : <Trash2 size={15} />}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content & Live Card Preview */}
      <div className="p-4 sm:p-5">
        {logoUrl ? (
          <div className="grid gap-5 lg:grid-cols-12 items-center">
            {/* Left: Raw Logo on Checkerboard Background */}
            <div className="lg:col-span-5 flex flex-col items-center">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                {translatePortalText("Transparency Inspector\n              ")}</p>
              <div className="relative w-full h-44 rounded-2xl border border-slate-200 dark:border-slate-800 flex items-center justify-center p-4 overflow-hidden bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] dark:bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:12px_12px] bg-slate-50 dark:bg-slate-950/80 shadow-inner">
                <img
                  src={fileUrl(logoUrl)}
                  alt={translatePortalText("Brand Logo")}
                  className="max-h-32 max-w-[80%] object-contain drop-shadow-md transition duration-300 hover:scale-105"
                />
                <span className="absolute bottom-2 end-3 text-[10px] font-bold text-slate-400 bg-white/80 dark:bg-slate-900/80 px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-800">
                  {translatePortalText("Transparent Canvas\n                ")}</span>
              </div>
            </div>

            {/* Right: Real-World Multi-Theme Card Previews */}
            <div className="lg:col-span-7">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  {translatePortalText("Live Cross-Portal Card Preview\n                ")}</p>
                <div className="flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setPreviewTab('light')}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md font-bold transition ${
                      previewTab === 'light'
                        ? 'bg-white dark:bg-slate-700 text-deep-900 dark:text-white shadow-xs'
                        : 'text-slate-500 hover:text-deep-900'
                    }`}
                  >
                    <Sun size={12} className="text-amber-500" /> {translatePortalText("Light Card\n                  ")}</button>
                  <button
                    type="button"
                    onClick={() => setPreviewTab('dark')}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md font-bold transition ${
                      previewTab === 'dark'
                        ? 'bg-white dark:bg-slate-700 text-deep-900 dark:text-white shadow-xs'
                        : 'text-slate-500 hover:text-deep-900'
                    }`}
                  >
                    <Moon size={12} className="text-indigo-700 dark:text-indigo-300" /> {translatePortalText("Dark Card\n                  ")}</button>
                  <button
                    type="button"
                    onClick={() => setPreviewTab('checkerboard')}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md font-bold transition ${
                      previewTab === 'checkerboard'
                        ? 'bg-white dark:bg-slate-700 text-deep-900 dark:text-white shadow-xs'
                        : 'text-slate-500 hover:text-deep-900'
                    }`}
                  >
                    <Eye size={12} /> {translatePortalText("Badge\n                  ")}</button>
                </div>
              </div>

              {/* Dynamic Preview Container */}
              {previewTab === 'light' ? (
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center gap-3.5">
                    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white border border-slate-200/80 p-1.5 shadow-sm">
                      <img src={fileUrl(logoUrl)} alt="" className="h-full w-full object-contain" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-sm font-extrabold text-deep-900">{providerName}</p>
                        <CheckCircle2 size={13} className="text-ocean-500 shrink-0" />
                      </div>
              <p className="text-[11px] text-slate-500">{translatePortalText("Verified ")}{translatePortalText(categoryLabel)} {translatePortalText("· Visible to all boaters")}</p>
                    </div>
                    <span className="shrink-0 rounded-lg bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200">
                      {translatePortalText("Live Rating 4.9 ★\n                    ")}</span>
                  </div>
                </div>
              ) : previewTab === 'dark' ? (
                <div className="portal-dark-workspace rounded-xl border border-ocean-900/60 bg-gradient-to-r from-[#091726] to-[#0d2238] p-4 text-white shadow-md">
                  <div className="flex items-center gap-3.5">
                    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white/10 backdrop-blur-md border border-white/15 p-1.5 shadow-sm">
                      <img src={fileUrl(logoUrl)} alt="" className="h-full w-full object-contain" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-sm font-extrabold text-white">{providerName}</p>
                        <CheckCircle2 size={13} className="text-cyan-400 shrink-0" />
                      </div>
                      <p className="text-[11px] text-slate-300">{translatePortalText("Official Charter & Berthing Network Partner")}</p>
                    </div>
                    <span className="shrink-0 rounded-lg bg-cyan-500/20 px-2 py-1 text-[10px] font-bold text-cyan-300 border border-cyan-400/30">
                      {translatePortalText("Partner Portal\n                    ")}</span>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-sand/60 p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2 rounded-full bg-white px-3 py-1.5 border border-slate-200 shadow-2xs">
                      <img src={fileUrl(logoUrl)} alt="" className="h-5 w-5 object-contain" />
                      <span className="text-xs font-bold text-deep-900">{providerName}</span>
                    </div>
                    <div className="flex items-center gap-2 rounded-full bg-deep-900 px-3 py-1.5 text-white shadow-2xs">
                      <img src={fileUrl(logoUrl)} alt="" className="h-5 w-5 object-contain brightness-110" />
                      <span className="text-xs font-bold">{providerName}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Empty State: No Logo Uploaded Yet */
          <div
            onClick={disabled ? undefined : handlePick}
            className={`group cursor-pointer rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-ocean-500 dark:hover:border-ocean-400 bg-slate-50/60 dark:bg-slate-900/40 p-8 text-center transition ${
              disabled ? 'pointer-events-none opacity-60' : ''
            }`}
          >
            <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-ocean-600 dark:text-ocean-400 shadow-sm transition group-hover:scale-110 group-hover:shadow-glow">
              <Upload size={24} />
            </div>
            <h4 className="text-sm font-extrabold text-deep-900 dark:text-white">
              {translatePortalText("Upload Transparent Brand Logo\n            ")}</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto mt-1 leading-relaxed">
              {translatePortalText("PNG, WebP, or SVG format with transparent background is strongly recommended (max 5MB).\n            ")}</p>
            <div className="mt-4 flex justify-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-ocean-50 dark:bg-ocean-950/60 border border-ocean-200 dark:border-ocean-800 px-3 py-1 text-[11px] font-bold text-ocean-700 dark:text-ocean-300">
                {translatePortalText("✨ Shown on all Search & Partner Cards\n              ")}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
