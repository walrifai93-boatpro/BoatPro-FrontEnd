// ---------------------------------------------------------------------------
// UploadList — one row per file, so a failure is always attributable (§9).
//
//   ✓ marina-front.jpg    Uploaded
//   ⟳ marina-side.jpg     Uploading… 64%   ████████████░░░░░
//   ⋯ pontoon-a.jpg       Waiting…
//   ✕ tariff-2026.pdf     Upload failed — [Retry] [Remove]
//
// The bar is drawn only for `uploading`, where the number is measured bytes.
// `processing` shows a spinner and the word — no bar, because the server-side
// duration is genuinely unknown and a padded percentage would be a lie (§8).
// ---------------------------------------------------------------------------
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Loader2, MoreHorizontal, MinusCircle, XCircle } from 'lucide-react';
import type { UploadItem, UploadStatus, UploadSummary } from './upload';
import { translatePortalText } from '../i18n/runtime'


const DEFAULT_LABELS: Record<UploadStatus, string> = {
  waiting: 'Waiting…',
  uploading: 'Uploading',
  processing: 'Processing…',
  done: 'Uploaded',
  error: 'Upload failed',
  cancelled: 'Cancelled',
};

function StatusGlyph({ status }: { status: UploadStatus }) {
  if (status === 'uploading' || status === 'processing')
    return <Loader2 size={15} className="shrink-0 animate-spin text-ocean-500" />;
  if (status === 'done') return <Check size={15} strokeWidth={3} className="shrink-0 text-emerald-500" />;
  if (status === 'error') return <XCircle size={15} className="shrink-0 text-rose-500" />;
  if (status === 'cancelled') return <MinusCircle size={15} className="shrink-0 text-slate-400" />;
  return <MoreHorizontal size={15} className="shrink-0 text-slate-400" />;
}

export function UploadList<TMeta>({
  items,
  onRetry,
  onRemove,
  labels,
}: {
  items: UploadItem<TMeta>[];
  onRetry?: (id: string) => void;
  onRemove?: (id: string) => void;
  labels?: Partial<Record<UploadStatus, string>>;
}) {
  if (!items.length) return null;
  const copy = { ...DEFAULT_LABELS, ...labels };

  return (
    <div className="space-y-2" role="status" aria-live="polite">
      <AnimatePresence initial={false}>
        {items.map((item) => {
          const showBar = item.status === 'uploading';
          const statusText = item.status === 'uploading' ? `${copy.uploading} ${item.progress}%` : copy[item.status];

          return (
            <motion.div
              key={item.id}
              layout
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0 }}
              className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3"
              aria-busy={item.status === 'uploading' || item.status === 'processing'}
            >
              <span className="mt-0.5">
                <StatusGlyph status={item.status} />
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-bold text-deep-900">{item.name}</p>
                <p
                  className={`text-[11.5px] font-semibold ${
                    item.status === 'error'
                      ? 'text-rose-600'
                      : item.status === 'done'
                        ? 'text-emerald-600'
                        : 'text-slate-500'
                  }`}
                >
                  {item.status === 'error' && item.error ? `${copy.error} — ${item.error}` : statusText}
                </p>

                {showBar && (
                  <div
                    className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-slate-200"
                    role="progressbar"
                    aria-valuenow={item.progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={translatePortalText(`${item.name} upload progress`)}
                  >
                    <div
                      className="h-full rounded-full bg-ocean-500 transition-[width] duration-200"
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                )}

                {item.status === 'error' && (
                  <div className="mt-1.5 flex gap-4">
                    {!!onRetry && (
                      <button
                        type="button"
                        onClick={() => onRetry(item.id)}
                        className="text-[11.5px] font-bold text-ocean-600 underline underline-offset-2"
                      >
                        {translatePortalText("Retry\n                      ")}</button>
                    )}
                    {!!onRemove && (
                      <button
                        type="button"
                        onClick={() => onRemove(item.id)}
                        className="text-[11.5px] font-bold text-slate-500 underline underline-offset-2"
                      >
                        {translatePortalText("Remove\n                      ")}</button>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

/**
 * The batch line for bulk uploads (§25): "8 / 12 uploaded · 2 failed".
 * Only rendered once more than one file is involved.
 */
export function UploadSummaryLine({
  summary,
  onRetryAllFailed,
}: {
  summary: UploadSummary;
  onRetryAllFailed?: () => void;
}) {
  if (summary.total < 2) return null;

  const parts = [`${summary.done} / ${summary.total} uploaded`];
  if (summary.failed) parts.push(`${summary.failed} failed`);

  return (
    <div className="flex items-center justify-between px-1 pt-1" role="status" aria-live="polite">
      <span className="text-[11.5px] font-semibold text-slate-500">{parts.join(' · ')}</span>
      {!!summary.failed && !!onRetryAllFailed && (
        <button
          type="button"
          onClick={onRetryAllFailed}
          className="text-[11.5px] font-bold text-ocean-600 underline underline-offset-2"
        >
          {translatePortalText("Retry failed\n        ")}</button>
      )}
    </div>
  );
}
