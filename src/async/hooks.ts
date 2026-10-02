// ---------------------------------------------------------------------------
// useAsyncAction + useDelayedFlag (marina portal)
//
// The portal already had `useAsync` for *reads* (see live.tsx). What it had no
// abstraction for at all was *writes*: every page hand-rolled a
// `const [saving, setSaving] = useState(false)` pair, and most forgot at least
// one of — resetting it in a `finally`, disabling the button, guarding a double
// click, or reporting the failure. `useAsyncAction` does all four in one place.
// ---------------------------------------------------------------------------
import React from 'react';
import { toApiError, type ApiError } from './errors';
import { toast } from './toast';

export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error';

export interface AsyncActionOptions<TArgs extends unknown[], TResult> {
  /**
   * Present-participle copy shown while it runs — "Approving…", "Sending
   * invoice email…". Supplying it opts into the single-toast loading→settled
   * lifecycle. Omit it when the button's own spinner is feedback enough.
   */
  loading?: string | ((...args: TArgs) => string);
  /** Confirmation copy. Be specific: "Reservation approved", not "Success" (§32). */
  success?: string | ((result: TResult, ...args: TArgs) => string);
  /** Defaults to the normalized error message — override only to add context. */
  error?: string | ((err: ApiError, ...args: TArgs) => string);
  /**
   * Report failures via toast. On by default. Turn it off for forms that show
   * the failure inline instead (§36 — toasts for outcomes, inline for fields).
   */
  toastError?: boolean;
  /** Adds a [Retry] to the error toast that re-runs with the same arguments. */
  retryable?: boolean;
  onSuccess?: (result: TResult, ...args: TArgs) => void;
  onError?: (err: ApiError, ...args: TArgs) => void;
  /** How long the button holds its "✓ done" state. 0 keeps it until reset. */
  successHold?: number;
}

export interface AsyncActionState<TArgs extends unknown[], TResult> {
  /** Fire it. Resolves with the result, or `undefined` if it failed or was blocked. */
  run: (...args: TArgs) => Promise<TResult | undefined>;
  status: AsyncStatus;
  /** Feed straight into `<LoadingButton loading={…} />`. */
  isLoading: boolean;
  isSuccess: boolean;
  error: ApiError | null;
  /** Back to idle and clear the error — e.g. when the user edits the form again. */
  reset: () => void;
}

/**
 * Wraps one user-triggered async operation.
 *
 * The duplicate-submission guard is a ref, not the `status` state: two clicks
 * inside the same React batch would both observe `status === 'idle'` and both
 * fire. The ref is written synchronously, so the second click is dropped even
 * before the re-render (§31 — the backend must still be idempotent, which is a
 * separate concern).
 */
export function useAsyncAction<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options: AsyncActionOptions<TArgs, TResult> = {}
): AsyncActionState<TArgs, TResult> {
  const [status, setStatus] = React.useState<AsyncStatus>('idle');
  const [error, setError] = React.useState<ApiError | null>(null);

  const inFlight = React.useRef(false);
  const mounted = React.useRef(true);
  const holdTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Latest fn/options without making `run` a new function every render.
  const fnRef = React.useRef(fn);
  fnRef.current = fn;
  const optsRef = React.useRef(options);
  optsRef.current = options;

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (holdTimer.current) clearTimeout(holdTimer.current);
    };
  }, []);

  const reset = React.useCallback(() => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    setStatus('idle');
    setError(null);
  }, []);

  const run = React.useCallback(async (...args: TArgs): Promise<TResult | undefined> => {
    if (inFlight.current) return undefined; // ← the duplicate-click guard
    inFlight.current = true;

    const opts = optsRef.current;
    if (holdTimer.current) clearTimeout(holdTimer.current);
    setStatus('loading');
    setError(null);

    const loadingCopy = typeof opts.loading === 'function' ? opts.loading(...args) : opts.loading;
    const toastId = loadingCopy ? toast.loading(loadingCopy) : undefined;

    try {
      const result = await fnRef.current(...args);
      const successCopy = typeof opts.success === 'function' ? opts.success(result, ...args) : opts.success;

      if (toastId) {
        // Settle the *same* pill. Without success copy it is simply retired —
        // never left spinning forever.
        if (successCopy) toast.success(successCopy, { id: toastId });
        else toast.dismiss(toastId);
      } else if (successCopy) {
        toast.success(successCopy);
      }

      // The component may have unmounted mid-flight (navigated away after save).
      // The operation still completed and was still reported — only the local
      // state update is skipped.
      if (mounted.current) {
        setStatus('success');
        if (opts.successHold !== 0) {
          holdTimer.current = setTimeout(() => {
            if (mounted.current) setStatus('idle');
          }, opts.successHold ?? 1600);
        }
      }

      opts.onSuccess?.(result, ...args);
      return result;
    } catch (raw) {
      const err = toApiError(raw);

      // An aborted request is not a failure the user needs told about.
      if (err.kind === 'cancelled') {
        if (toastId) toast.dismiss(toastId);
        if (mounted.current) setStatus('idle');
        return undefined;
      }

      const errorCopy = typeof opts.error === 'function' ? opts.error(err, ...args) : opts.error ?? err.message;
      const shouldToast = opts.toastError !== false;
      const action = opts.retryable ? { label: 'Retry', onClick: () => void run(...args) } : undefined;

      if (toastId) {
        if (shouldToast) toast.error(errorCopy, { id: toastId, action });
        else toast.dismiss(toastId);
      } else if (shouldToast) {
        toast.error(errorCopy, { action });
      }

      if (mounted.current) {
        // Back to `error`, never stuck disabled — §12: a failed Approve must be
        // clickable again.
        setStatus('error');
        setError(err);
      }
      opts.onError?.(err, ...args);
      return undefined;
    } finally {
      inFlight.current = false;
    }
  }, []);

  return { run, status, isLoading: status === 'loading', isSuccess: status === 'success', error, reset };
}

/**
 * Follows `active` but only turns *on* after `delay` ms.
 *
 * A 90ms request would otherwise flash a skeleton for three frames, which reads
 * as a glitch rather than as loading (§22). Turning off is immediate — once
 * content is ready there is no reason to hold a placeholder.
 */
export function useDelayedFlag(active: boolean, delay = 250): boolean {
  const [shown, setShown] = React.useState(active && delay === 0);

  React.useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    if (delay === 0) {
      setShown(true);
      return;
    }
    const t = setTimeout(() => setShown(true), delay);
    return () => clearTimeout(t);
  }, [active, delay]);

  return shown;
}

/**
 * Blocks the browser's tab-close / reload prompt while `active`.
 *
 * §26: an in-flight document upload or a form with unsaved edits must not be
 * silently thrown away. In-app route changes are guarded separately (React
 * Router owns those); this covers the hard-navigation case the app cannot
 * intercept.
 */
export function useUnloadGuard(active: boolean) {
  React.useEffect(() => {
    if (!active) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Browsers ignore custom text now and show their own copy, but a
      // non-empty returnValue is still what triggers the prompt at all.
      e.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [active]);
}
