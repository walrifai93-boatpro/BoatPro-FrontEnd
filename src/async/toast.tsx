// ---------------------------------------------------------------------------
// Centralized toast bus (marina portal)
//
// Replaces the original `toast(msg, tone)` event-bus in ui.tsx. That version
// could only announce — it had no way to say "this is still happening", so an
// upload reported nothing until it finished, and a slow save looked like a
// no-op.
//
// BACKWARD COMPATIBILITY IS LOAD-BEARING: ~450 existing call sites do
// `toast('Saved')` or `toast('Check the form', 'warn')`. `toast` is therefore
// still a plain callable with exactly that signature, and the new lifecycle
// hangs off it as methods:
//
//   toast('Saved')                                  // ← unchanged
//   toast('Check the form', 'warn')                 // ← unchanged
//   const id = toast.loading('Uploading image…')
//   toast.success('Image uploaded successfully', { id })   // ← same pill, updated
//   await toast.promise(save(), { loading: 'Saving…', success: 'Saved' })
//
// Other deliberate design points:
//  · Loading toasts never auto-dismiss. Everything else does, on a per-tone
//    timer (§7); an error carrying a retry action sticks until dismissed,
//    because it is asking a question.
//  · Identical message+tone inside DEDUPE_WINDOW refreshes the existing toast
//    rather than stacking (§35) — a burst of five failed row-saves reports once.
//  · Lives outside React, so the API layer and stores can report without a hook.
// ---------------------------------------------------------------------------
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, AlertTriangle, Info, XCircle, Loader2 } from 'lucide-react';
import { errorMessage } from './errors';
import { translatePortalText } from '../i18n/runtime';

/** `warn` is the legacy spelling used by ~374 call sites; `warning` is the alias. */
export type ToastTone = 'success' | 'info' | 'warn' | 'warning' | 'error' | 'loading';

/** Canonical set after normalizing the `warn`/`warning` pair. */
type Tone = 'success' | 'info' | 'warning' | 'error' | 'loading';

const normalizeTone = (t: ToastTone): Tone => (t === 'warn' ? 'warning' : t);

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: string;
  tone: Tone;
  msg: string;
  /** Optional second line — the "why" behind an error, or a file name. */
  description?: string;
  /**
   * Determinate progress, 0–100. Only ever set from a real measured source
   * (the XHR upload helper); never faked to make a spinner look busy.
   */
  progress?: number;
  action?: ToastAction;
  /** ms until auto-dismiss, or null to stick until dismissed/settled. */
  duration: number | null;
  createdAt: number;
}

/** How long each tone stays up. Errors get longer because they carry more to read. */
export const TOAST_DURATION: Record<Tone, number | null> = {
  loading: null,
  success: 3500,
  info: 4000,
  warning: 5000,
  error: 6000,
};

const MAX_VISIBLE = 4;
/** Identical message+tone inside this window is treated as the same event. */
const DEDUPE_WINDOW = 4000;

// ── store ─────────────────────────────────────────────────────
// A tiny hand-rolled store rather than a dependency: the portal has no state
// library and this needs to be callable from outside React.
let items: ToastItem[] = [];
const listeners = new Set<() => void>();

function emit() {
  // New array identity each time so `useSyncExternalStore` sees the change.
  items = [...items];
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

const getSnapshot = () => items;

// ── timers ────────────────────────────────────────────────────
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function clearTimer(id: string) {
  const t = timers.get(id);
  if (t) {
    clearTimeout(t);
    timers.delete(id);
  }
}

function arm(id: string, duration: number | null) {
  clearTimer(id);
  if (duration == null) return;
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      dismiss(id);
    }, duration)
  );
}

let seq = 0;
const nextId = () => `t${++seq}`;

// ── core ──────────────────────────────────────────────────────
export interface ShowOptions {
  /** Reuse (and mutate) an existing toast — this is how loading→success works. */
  id?: string;
  description?: string;
  action?: ToastAction;
  /** Override the tone's default duration. `null` sticks until dismissed. */
  duration?: number | null;
  progress?: number;
  /** Opt out of dedupe for a message that genuinely repeats. */
  noDedupe?: boolean;
}

function show(rawTone: ToastTone, msg: string, opts: ShowOptions = {}): string {
  const tone = normalizeTone(rawTone);
  const duration =
    opts.duration !== undefined
      ? opts.duration
      : // An error offering a recovery action is a question, not an
        // announcement — it waits for an answer.
        tone === 'error' && opts.action
        ? null
        : TOAST_DURATION[tone];

  const now = Date.now();

  // Updating a specific toast in place (the loading→settled transition).
  if (opts.id) {
    let found = false;
    items = items.map((it) => {
      if (it.id !== opts.id) return it;
      found = true;
      return {
        ...it,
        tone,
        msg,
        description: opts.description,
        action: opts.action,
        // A settled toast must not keep a stale progress bar.
        progress: tone === 'loading' ? opts.progress ?? it.progress : opts.progress,
        duration,
      };
    });
    if (found) {
      emit();
      arm(opts.id, duration);
      return opts.id;
    }
    // The loading toast was dismissed by hand — fall through and announce the
    // outcome as a fresh one rather than silently dropping it.
  }

  // Dedupe: same tone + same text, still on screen and still recent.
  if (!opts.noDedupe && tone !== 'loading') {
    const dupe = items.find((it) => it.tone === tone && it.msg === msg && now - it.createdAt < DEDUPE_WINDOW);
    if (dupe) {
      items = items.map((it) =>
        it.id === dupe.id ? { ...it, createdAt: now, action: opts.action ?? it.action } : it
      );
      emit();
      arm(dupe.id, duration);
      return dupe.id;
    }
  }

  const id = nextId();
  items = [
    ...items,
    {
      id,
      tone,
      msg,
      description: opts.description,
      action: opts.action,
      progress: opts.progress,
      duration,
      createdAt: now,
    },
  ];

  // Evict oldest *settled* toasts first — an in-flight operation's status must
  // not be pushed off screen by the results of faster ones.
  while (items.length > MAX_VISIBLE) {
    const victim = items.find((it) => it.tone !== 'loading') ?? items[0];
    clearTimer(victim.id);
    items = items.filter((it) => it.id !== victim.id);
  }

  emit();
  arm(id, duration);
  return id;
}

export function dismiss(id?: string) {
  if (!id) {
    timers.forEach((t) => clearTimeout(t));
    timers.clear();
    items = [];
    emit();
    return;
  }
  clearTimer(id);
  items = items.filter((it) => it.id !== id);
  emit();
}

/** Push real, measured progress onto a loading toast (0–100). */
function progress(id: string, pct: number) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  items = items.map((it) => (it.id === id ? { ...it, progress: clamped } : it));
  emit();
}

/** Patch any field of a live toast (message text mid-upload, say). */
function update(id: string, patch: Partial<Omit<ToastItem, 'id' | 'createdAt'>>) {
  items = items.map((it) => (it.id === id ? { ...it, ...patch } : it));
  emit();
  if (patch.duration !== undefined) arm(id, patch.duration);
}

export interface PromiseToastCopy<T> {
  /** Shown immediately, e.g. "Sending verification email…". */
  loading: string;
  /** Settled copy — a function so it can name what actually came back. */
  success: string | ((value: T) => string);
  /** Defaults to the normalized `ApiError` message. */
  error?: string | ((err: unknown) => string);
  /** Offer a retry on failure; the toast then sticks until dismissed. */
  retry?: () => void;
}

/**
 * Runs a promise inside one toast that moves loading → success/error.
 * Rethrows on failure — the toast is feedback, not flow control.
 */
async function promise<T>(work: Promise<T>, copy: PromiseToastCopy<T>): Promise<T> {
  const id = show('loading', copy.loading);
  try {
    const value = await work;
    show('success', typeof copy.success === 'function' ? copy.success(value) : copy.success, { id });
    return value;
  } catch (err) {
    const msg = typeof copy.error === 'function' ? copy.error(err) : copy.error ?? errorMessage(err);
    show('error', msg, { id, action: copy.retry ? { label: 'Retry', onClick: copy.retry } : undefined });
    throw err;
  }
}

// ── the public `toast` ────────────────────────────────────────
// Callable *and* namespaced, so every legacy `toast(msg, tone)` call keeps
// working untouched while new code gets the lifecycle API.
interface ToastFn {
  (msg: string, tone?: ToastTone): string;
  loading: (msg: string, opts?: ShowOptions) => string;
  success: (msg: string, opts?: ShowOptions) => string;
  error: (msg: string, opts?: ShowOptions) => string;
  warning: (msg: string, opts?: ShowOptions) => string;
  info: (msg: string, opts?: ShowOptions) => string;
  /** Report a caught throwable with safe, human copy (never a stack trace). */
  fromError: (err: unknown, opts?: ShowOptions) => string;
  update: typeof update;
  progress: typeof progress;
  dismiss: typeof dismiss;
  promise: typeof promise;
}

const toastFn = ((msg: string, tone: ToastTone = 'success') => show(tone, msg)) as ToastFn;

toastFn.loading = (msg, opts) => show('loading', msg, opts);
toastFn.success = (msg, opts) => show('success', msg, opts);
toastFn.error = (msg, opts) => show('error', msg, opts);
toastFn.warning = (msg, opts) => show('warning', msg, opts);
toastFn.info = (msg, opts) => show('info', msg, opts);
toastFn.fromError = (err, opts) => show('error', errorMessage(err), opts);
toastFn.update = update;
toastFn.progress = progress;
toastFn.dismiss = dismiss;
toastFn.promise = promise;

export const toast = toastFn;

// ── UI ────────────────────────────────────────────────────────
const STYLE: Record<Tone, { bar: string; iconBg: string; iconColor: string; Icon: React.ElementType }> = {
  success: { bar: 'bg-emerald-500', iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600', Icon: Check },
  info: { bar: 'bg-sky-500', iconBg: 'bg-sky-50', iconColor: 'text-sky-600', Icon: Info },
  warning: { bar: 'bg-amber-500', iconBg: 'bg-amber-50', iconColor: 'text-amber-600', Icon: AlertTriangle },
  error: { bar: 'bg-rose-500', iconBg: 'bg-rose-50', iconColor: 'text-rose-600', Icon: XCircle },
  loading: { bar: 'bg-ocean-500', iconBg: 'bg-ocean-50', iconColor: 'text-ocean-600', Icon: Loader2 },
};

/** Spoken tone prefix, so meaning survives without colour or icon (§28). */
const SPOKEN: Record<Tone, string> = {
  loading: 'In progress',
  success: 'Success',
  error: 'Error',
  warning: 'Warning',
  info: 'Information',
};

/**
 * Mount once per layout. Already present in Layout / AdminLayout / FuelLayout /
 * MaintLayout / BoatLayout / Onboarding.
 */
export function ToastStack() {
  const list = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return (
    <div
      className="fixed bottom-6 right-6 z-[9999] pointer-events-none flex w-full max-w-sm flex-col gap-2.5"
      // Screen readers get the same announcements sighted users do.
      role="status"
      aria-live="polite"
      aria-atomic="false"
    >
      <AnimatePresence>
        {list.map((t) => {
          const s = STYLE[t.tone] ?? STYLE.info;
          const pct = typeof t.progress === 'number' ? t.progress : null;
          const busy = t.tone === 'loading';

          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 24, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 60, transition: { duration: 0.2 } }}
              transition={{ type: 'spring', damping: 24, stiffness: 300 }}
              className="group pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-2xl bg-white py-3 pl-4 pr-3 shadow-lift ring-1 ring-slate-900/10"
              aria-busy={busy}
              aria-label={[SPOKEN[t.tone], t.msg, t.description, pct !== null ? `${pct} percent` : null]
                .filter((part): part is string => typeof part === 'string' && Boolean(part))
                .map(part => translatePortalText(part))
                .join('. ')}
            >
              <span className={`absolute inset-y-0 left-0 w-1 ${s.bar}`} />

              <span
                className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${s.iconBg} ${s.iconColor}`}
              >
                <s.Icon size={15} strokeWidth={3} className={busy ? 'animate-spin' : ''} />
              </span>

              <div className="flex-1 pt-0.5">
                <p className="text-[13px] font-semibold leading-snug text-deep-900">{translatePortalText(t.msg)}</p>
                {!!t.description && <p className="mt-0.5 text-[11.5px] font-medium text-slate-500">{translatePortalText(t.description)}</p>}

                {/* Real progress only. Nothing indeterminate masquerades as a
                    percentage — if we don't know, we don't draw a bar (§8). */}
                {pct !== null && (
                  <div
                    className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div className={`h-full rounded-full transition-[width] duration-200 ${s.bar}`} style={{ width: `${pct}%` }} />
                  </div>
                )}

                {!!t.action && (
                  <button
                    type="button"
                    onClick={() => {
                      const { onClick } = t.action!;
                      dismiss(t.id);
                      onClick();
                    }}
                    className={`mt-1.5 text-[12px] font-bold underline underline-offset-2 ${s.iconColor}`}
                  >
                    {translatePortalText(t.action.label)}
                  </button>
                )}
              </div>

              {/* A loading toast has no dismiss affordance: the operation is
                  still running and hiding it would lose its outcome. */}
              {!busy && (
                <button
                  type="button"
                  onClick={() => dismiss(t.id)}
                  aria-label={translatePortalText('Dismiss notification')}
                  className="mt-0.5 shrink-0 text-slate-300 opacity-0 transition-opacity hover:text-slate-500 group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <X size={14} />
                </button>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
