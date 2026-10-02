// ---------------------------------------------------------------------------
// Global confirmation dialog — the §14 destructive-action flow, in one call.
//
//   Delete berth A-12?  [Cancel] [Delete]
//        ↓  user confirms
//   [ ◌ Deleting… ]         ← the dialog's own button, still open, both disabled
//        ↓
//   ✓ Berth deleted successfully   ← toast; dialog closes
//
// Why this and not `window.confirm`: the native dialog blocks the JS thread
// (nothing repaints, no toast can appear, animations freeze), cannot be styled to
// match the portal, and closes the instant a button is clicked — so the delete
// that follows happens with no visible state at all. It is also unstyleable on
// mobile Safari and reads as a browser-level warning rather than as part of the
// app.
//
// `confirm()` resolves a boolean for the simple case; `confirmAndRun()` keeps the
// dialog open across the operation, which is what §14 actually asks for.
// ---------------------------------------------------------------------------
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { toast } from './toast';
import { errorMessage } from './errors';
import { translatePortalText } from '../i18n/runtime';

export interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /**
   * Turns the dialog into a prompt: renders a text field whose value is passed
   * to `run` and resolved to the caller.
   *
   * This replaces `window.prompt`, which blocks the JS thread, cannot be
   * validated, cannot be styled, and offers no way to mark an input required or
   * multi-line. Decline reasons and payout references go through here.
   */
  input?: {
    label?: string;
    placeholder?: string;
    /** Prefilled value. */
    initial?: string;
    /** Blocks confirm until something is entered. */
    required?: boolean;
    multiline?: boolean;
    maxLength?: number;
    /**
     * Checks what was typed, blocking confirm while it returns a message.
     *
     * Added for the admin payout-account prompt, where the value is somebody
     * else's IBAN: a wrong one sends real money to the wrong person, and the
     * dialog closing on confirm meant the mistake was only discoverable from the
     * API's error toast, with the digits already gone from the screen. Return
     * `null` (or nothing) when the value is acceptable.
     */
    validate?: (value: string) => string | null | undefined;
    /** Rewrites each keystroke — canonicalising as the operator types. */
    transform?: (value: string) => string;
  };

  /** A second text value for one confirmation that needs paired information. */
  additionalInput?: {
    label?: string;
    placeholder?: string;
    required?: boolean;
    multiline?: boolean;
    maxLength?: number;
    dir?: 'ltr' | 'rtl' | 'auto';
  };

  /**
   * Attaches a file picker to the dialog, handed to `run` alongside the text.
   *
   * Added for marking a payout paid, where the bank's transfer receipt is
   * required: without a document, "paid" is one admin's unverifiable claim, and
   * the provider being paid has nothing to check it against. Asking for the
   * reference and the receipt in two separate steps invites the second being
   * skipped, so they are one confirmation.
   */
  file?: {
    label?: string;
    /** `accept` for the input — e.g. `'image/*,application/pdf'`. */
    accept?: string;
    /** Blocks confirm until a file is chosen. */
    required?: boolean;
    /** Refused above this, before the request is made. */
    maxBytes?: number;
    hint?: string;
  };
}

/**
 * Outcome of the bound work.
 *
 * A flat shape rather than a discriminated union on purpose: this package
 * compiles with `strict: false`, under which TypeScript will not narrow
 * `{ok: true; value} | {ok: false; error}` through a `!outcome.ok` guard.
 */
interface RunOutcome {
  ok: boolean;
  value?: unknown;
  error?: unknown;
}

interface ConfirmResolution {
  confirmed: boolean;
  outcome?: RunOutcome;
  /** What the user typed, when the request declared an `input`. */
  text?: string;
  additionalText?: string;
  /** What the user picked, when the request declared a `file`. */
  file?: File | null;
}

interface PendingConfirm extends ConfirmRequest {
  id: number;
  /** Label swapped in while the bound action runs ("Deleting…"). */
  busyLabel?: string;
  busy: boolean;
  resolve: (r: ConfirmResolution) => void;
  /** Bound work — when present the dialog stays open until it settles. */
  run?: (text: string, file?: File | null, additionalText?: string) => Promise<unknown>;
}

// A tiny external store so `confirm()` is callable from anywhere, including
// non-component code such as a store action.
let pending: PendingConfirm | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getSnapshot = () => pending;

let confirmSeq = 0;

function open(req: ConfirmRequest & { run?: (text: string, file?: File | null, additionalText?: string) => Promise<unknown>; busyLabel?: string }): Promise<ConfirmResolution> {
  return new Promise<ConfirmResolution>((resolve) => {
    // A second request replaces the first rather than queueing: two stacked
    // confirmations is never the intended UX, and the abandoned one must still
    // settle its promise or its caller would hang forever.
    pending?.resolve({ confirmed: false });
    pending = { ...req, id: ++confirmSeq, busy: false, resolve };
    notify();
  });
}

/**
 * Ask, and resolve true/false. The dialog closes as soon as a button is clicked —
 * use this only when what follows has its own visible state (a `LoadingButton`,
 * say). Otherwise use `confirmAndRun`.
 */
export async function confirm(req: ConfirmRequest): Promise<boolean> {
  const { confirmed } = await open(req);
  return confirmed;
}

export interface ConfirmAndRunOptions<T> extends ConfirmRequest {
  /**
   * Receives whatever was typed into `input` (or `''`), and whatever was picked
   * for `file` (or `null`).
   */
  run: (text: string, file?: File | null, additionalText?: string) => Promise<T>;
  /** Dialog button copy while it runs — "Deleting…", "Approving…". */
  busyLabel?: string;
  /** Toast copy on success. Be specific (§32). */
  success?: string | ((result: T) => string);
  /** Toast copy on failure. Defaults to the normalized error message. */
  error?: string | ((err: unknown) => string);
  /** Offer a Retry on the failure toast, re-running the whole flow. */
  retryable?: boolean;
}

/**
 * Confirm, then run with the dialog held open and both buttons disabled, then
 * report via toast. Resolves the result, or `undefined` if the user cancelled or
 * the work failed.
 */
export async function confirmAndRun<T>(opts: ConfirmAndRunOptions<T>): Promise<T | undefined> {
  const { run, busyLabel, success, error, retryable, ...req } = opts;

  const { confirmed, outcome } = await open({ ...req, busyLabel, run: run as (text: string) => Promise<unknown> });
  if (!confirmed || !outcome) return undefined;

  if (!outcome.ok) {
    const msg = typeof error === 'function' ? error(outcome.error) : error ?? errorMessage(outcome.error);
    toast.error(translatePortalText(msg), { action: retryable ? { label: translatePortalText('Retry'), onClick: () => void confirmAndRun(opts) } : undefined });
    return undefined;
  }

  const value = outcome.value as T;
  const successCopy = typeof success === 'function' ? success(value) : success;
  if (successCopy) toast.success(translatePortalText(successCopy));
  return value;
}

/** Mount once per layout, beside `<ToastStack />`. */
export function ConfirmHost() {
  const current = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const confirmBtnRef = React.useRef<HTMLButtonElement | null>(null);
  const [text, setText] = React.useState('');
  // `onConfirm` is memoised once, so it reads the current text through a ref
  // rather than closing over a stale value.
  const textRef = React.useRef('');
  textRef.current = text;

  const [additionalText, setAdditionalText] = React.useState('');
  const additionalTextRef = React.useRef('');
  additionalTextRef.current = additionalText;

  const [file, setFile] = React.useState<File | null>(null);
  const fileRef = React.useRef<File | null>(null);
  fileRef.current = file;
  /** Refused before the request, so the operator is not told by a 413. */
  const [fileError, setFileError] = React.useState<string | null>(null);

  // Reseed the field per request (keyed on `id`, so reopening the same dialog
  // starts clean rather than inheriting the previous answer).
  React.useEffect(() => {
    setText(current?.input?.initial ?? '');
    setAdditionalText('');
    setFile(null);
    setFileError(null);
  }, [current?.id]);

  /**
   * The validation message for what is currently typed.
   *
   * Held back until the field has been left once, so a prompt does not open
   * already complaining about an empty box — but shown from then on, on every
   * keystroke, because at that point the operator is correcting something.
   */
  const [inputTouched, setInputTouched] = React.useState(false);
  React.useEffect(() => setInputTouched(false), [current?.id]);
  const inputError = inputTouched && text.trim() ? current?.input?.validate?.(text.trim()) ?? null : null;

  const close = () => {
    pending = null;
    notify();
  };

  const onCancel = React.useCallback(() => {
    if (!pending || pending.busy) return; // mid-operation: not cancellable
    const p = pending;
    close();
    p.resolve({ confirmed: false });
  }, []);

  const onConfirm = React.useCallback(async () => {
    if (!pending || pending.busy) return; // ← duplicate-click guard on the dialog
    const p = pending;
    const typed = textRef.current.trim();
    const additionalTyped = additionalTextRef.current.trim();

    if (p.input?.required && !typed) return; // the button is disabled too; belt and braces
    if (p.additionalInput?.required && !additionalTyped) return;
    if (p.file?.required && !fileRef.current) return;

    // Refused here as well as in the disabled button, because Enter reaches
    // this path directly from the input.
    if (p.input?.validate?.(typed)) return;

    if (!p.run) {
      close();
      p.resolve({ confirmed: true, text: typed, additionalText: additionalTyped });
      return;
    }

    // Flip to busy *before* awaiting, so the spinner is on screen for the whole
    // operation rather than appearing after it.
    pending = { ...p, busy: true };
    notify();

    let outcome: RunOutcome;
    try {
      outcome = { ok: true, value: await p.run(typed, fileRef.current, additionalTyped) };
    } catch (err) {
      outcome = { ok: false, error: err };
    }
    close();
    p.resolve({ confirmed: true, outcome, text: typed, additionalText: additionalTyped, file: fileRef.current });
  }, []);

  // Escape cancels; focus lands on the confirm button so keyboard users are not
  // stranded in a modal with no focus (the native dialog handled this for free).
  React.useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    // With an input present its own `autoFocus` wins; otherwise put focus on the
    // confirm button so keyboard users are not stranded in the modal.
    if (!current.input) confirmBtnRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [current, onCancel]);

  return (
    <AnimatePresence>
      {current && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[10000] grid place-items-center bg-deep-900/45 p-4 backdrop-blur-sm"
          onClick={onCancel}
          role="dialog"
          aria-modal="true"
          aria-labelledby="bp-confirm-title"
          aria-describedby="bp-confirm-body"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 6 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-lift"
          >
            <span
              className={`mx-auto mb-3.5 grid h-14 w-14 place-items-center rounded-2xl ring-1 ${
                current.danger ? 'bg-rose-50 text-rose-600 ring-rose-100' : 'bg-ocean-50 text-ocean-600 ring-ocean-100'
              }`}
            >
              {current.danger ? <Trash2 size={24} /> : <AlertTriangle size={24} />}
            </span>

            <h3 id="bp-confirm-title" className="text-[17px] font-extrabold text-deep-900">
              {translatePortalText(current.title)}
            </h3>
            <p id="bp-confirm-body" className="mt-1.5 text-[13px] font-medium leading-relaxed text-slate-500">
              {translatePortalText(current.body)}
            </p>

            {!!current.input && (
              <div className="mt-4 text-left">
                {!!current.input.label && (
                  <label htmlFor="bp-confirm-input" className="label">
                    {translatePortalText(current.input.label)}
                    {current.input.required && <span className="ml-0.5 text-rose-500">*</span>}
                  </label>
                )}
                {current.input.multiline ? (
                  <textarea
                    id="bp-confirm-input"
                    autoFocus
                    rows={3}
                    value={text}
                    disabled={current.busy}
                    maxLength={current.input.maxLength}
                    placeholder={current.input.placeholder ? translatePortalText(current.input.placeholder) : undefined}
                    onChange={(e) => setText(current.input?.transform?.(e.target.value) ?? e.target.value)}
                    onBlur={() => setInputTouched(true)}
                    className={`input resize-y ${inputError ? '!border-rose-300 !ring-rose-100' : ''}`}
                  />
                ) : (
                  <input
                    id="bp-confirm-input"
                    autoFocus
                    type="text"
                    value={text}
                    disabled={current.busy}
                    maxLength={current.input.maxLength}
                    placeholder={current.input.placeholder ? translatePortalText(current.input.placeholder) : undefined}
                    onChange={(e) => setText(current.input?.transform?.(e.target.value) ?? e.target.value)}
                    onBlur={() => setInputTouched(true)}
                    // Enter submits, which is what a single-line prompt should do.
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void onConfirm();
                      }
                    }}
                    className={`input ${inputError ? '!border-rose-300 !ring-rose-100' : ''}`}
                  />
                )}
                {!!inputError && (
                  <p className="mt-1 text-[11px] font-semibold text-rose-500">{translatePortalText(inputError)}</p>
                )}
              </div>
            )}

            {!!current.additionalInput && (
              <div className="mt-3 text-left">
                {!!current.additionalInput.label && (
                  <label htmlFor="bp-confirm-additional-input" className="label">
                    {translatePortalText(current.additionalInput.label)}
                    {current.additionalInput.required && <span className="ml-0.5 text-rose-500">*</span>}
                  </label>
                )}
                {current.additionalInput.multiline ? (
                  <textarea
                    id="bp-confirm-additional-input"
                    rows={3}
                    dir={current.additionalInput.dir}
                    value={additionalText}
                    disabled={current.busy}
                    maxLength={current.additionalInput.maxLength}
                    placeholder={current.additionalInput.placeholder ? translatePortalText(current.additionalInput.placeholder) : undefined}
                    onChange={(e) => setAdditionalText(e.target.value)}
                    className="input resize-y"
                  />
                ) : (
                  <input
                    id="bp-confirm-additional-input"
                    type="text"
                    dir={current.additionalInput.dir}
                    value={additionalText}
                    disabled={current.busy}
                    maxLength={current.additionalInput.maxLength}
                    placeholder={current.additionalInput.placeholder ? translatePortalText(current.additionalInput.placeholder) : undefined}
                    onChange={(e) => setAdditionalText(e.target.value)}
                    className="input"
                  />
                )}
              </div>
            )}

            {/*
              The attachment, when the request asks for one.

              A plain `<input type="file">` rather than a drop zone: this is one
              document an admin has just downloaded from their bank, the native
              picker is the shortest path to it, and it is keyboard-accessible
              without any work.
            */}
            {!!current.file && (
              <div className="mt-3">
                {current.file.label && (
                  <label className="label mb-1 block" htmlFor="bp-confirm-file">
                    {translatePortalText(current.file.label)}
                    {current.file.required && <span className="ml-0.5 text-rose-500">*</span>}
                  </label>
                )}
                <input
                  id="bp-confirm-file"
                  type="file"
                  disabled={current.busy}
                  accept={current.file.accept}
                  onChange={(e) => {
                    const picked = e.target.files?.[0] ?? null;
                    const max = current.file?.maxBytes;
                    // Checked here so the operator is told by the form rather
                    // than by the server rejecting the upload.
                    if (picked && max && picked.size > max) {
                      setFile(null);
                      setFileError(`That file is ${(picked.size / 1048576).toFixed(1)} MB — the limit is ${(max / 1048576).toFixed(0)} MB.`);
                      return;
                    }
                    setFileError(null);
                    setFile(picked);
                  }}
                  className="input file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold"
                />
                {fileError ? (
                  <p className="mt-1 text-[11px] font-semibold text-rose-500">{translatePortalText(fileError)}</p>
                ) : (
                  !!current.file.hint && (
                    <p className="mt-1 text-[11px] text-slate-400">{translatePortalText(current.file.hint)}</p>
                  )
                )}
              </div>
            )}

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={onCancel}
                disabled={current.busy}
                className="btn-ghost flex-1 justify-center disabled:opacity-50"
              >
                {translatePortalText(current.cancelLabel ?? 'Cancel')}
              </button>
              <button
                ref={confirmBtnRef}
                type="button"
                onClick={onConfirm}
                disabled={
                  current.busy ||
                  (!!current.input?.required && !text.trim()) ||
                  (!!current.additionalInput?.required && !additionalText.trim()) ||
                  !!inputError ||
                  (!!current.file?.required && !file) ||
                  !!fileError
                }
                aria-busy={current.busy}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-bold text-white transition-opacity disabled:opacity-70 ${
                  current.danger ? 'bg-rose-500 hover:bg-rose-600' : 'bg-ocean-500 hover:bg-ocean-600'
                }`}
              >
                {current.busy && <Loader2 size={14} className="animate-spin" />}
                {translatePortalText(current.busy ? current.busyLabel ?? 'Working…' : current.confirmLabel ?? 'Confirm')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
