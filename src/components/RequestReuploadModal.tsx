import React, { useState } from 'react';
import { X, BellRing, Loader2, Send } from 'lucide-react';
import { documentsApi } from '../api';
import { toast } from '../ui';
import { formatPortalNumber, translatePortalText } from '../i18n/runtime';

/**
 * Asking a provider for a document again.
 *
 * Reviewers had exactly two buttons — approve and reject — and a rejection ends
 * a signup. So a blurry photograph of a perfectly valid trade licence got the
 * same treatment as a forged one, and the provider was told "rejected" with no
 * idea which of their five documents was at fault or what to do about it.
 *
 * This is the third button. The document stays on file, the registration stays
 * open, and the provider gets a push and an email naming the document and saying
 * what is wrong with it. The reason is mandatory — a re-upload request with no
 * reason produces the same file a second time.
 */

/**
 * The reasons reviewers actually type, as one tap each.
 *
 * They are starting points, not canned messages: each one lands in the textarea
 * for editing rather than sending itself, because "the expiry date is not
 * legible" is nearly always followed by which corner of the scan is cut off.
 */
const QUICK_REASONS = [
  { label: 'Expired', text: 'This document has expired. Please upload a current one.' },
  { label: 'Unreadable', text: 'We could not read this scan clearly. Please upload a sharper photo or PDF, with the whole page visible.' },
  { label: 'Wrong document', text: 'This is not the document we asked for in this slot. Please check and upload the correct one.' },
  { label: 'Page missing', text: 'Part of the document is missing from the file. Please upload every page.' },
  { label: 'Details mismatch', text: 'The details on this document do not match the information on your application. Please upload a document that matches, or correct your application.' },
];

export function RequestReuploadModal({
  documentId,
  documentLabel,
  providerName,
  isOpen,
  onClose,
  onSent,
}: {
  documentId: string;
  documentLabel: string;
  providerName?: string;
  isOpen: boolean;
  onClose: () => void;
  onSent?: () => void;
}) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  if (!isOpen) return null;

  const send = async () => {
    const text = message.trim();
    if (text.length < 5) {
      toast('Say what needs fixing — the provider sees this message', 'warn');
      return;
    }
    setSending(true);
    try {
      await documentsApi.requestReupload(documentId, text);
      toast('Re-upload requested — the provider has been notified');
      setMessage('');
      onSent?.();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not send the request', 'warn');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-deep-900/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lift dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 bg-sand/60 px-5 py-4 dark:border-slate-800 dark:bg-slate-800/40">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl border border-amber-200 bg-amber-50 text-amber-600 dark:border-amber-900/50 dark:bg-amber-950/40">
              <BellRing size={17} />
            </div>
            <div>
              <p className="text-sm font-extrabold text-deep-900 dark:text-slate-100">{translatePortalText("Ask for this document again")}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {translatePortalText(documentLabel)}
                {providerName ? ` · ${providerName}` : ''}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X size={17} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            {translatePortalText("The registration stays open and the document stays on file. The provider gets a notification and an email naming this document, and the signup step reopens for them to replace it.")}
          </p>

          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">{translatePortalText("Common reasons")}</p>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_REASONS.map((r) => (
                <button
                  key={translatePortalText(r.label)}
                  type="button"
                  onClick={() => setMessage(r.text)}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition-colors hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-slate-400">
              {translatePortalText("What the provider will read")}
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              maxLength={500}
              autoFocus
              placeholder={translatePortalText("e.g. The expiry date is cut off in this scan — please upload the full page.")}
              className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-deep-900 outline-none transition-colors focus:border-teal-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
            <p className="mt-1 text-right text-[10px] text-slate-400">{formatPortalNumber(message.length)}/{formatPortalNumber(500)}</p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3.5 dark:border-slate-800">
          <button onClick={onClose} className="btn-ghost !py-1.5 !px-3 text-xs">
            {translatePortalText("Cancel")}
          </button>
          <button onClick={send} disabled={sending || message.trim().length < 5} className="btn-admin !py-1.5 !px-3.5 text-xs">
            {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} {translatePortalText("Send request")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default RequestReuploadModal;
