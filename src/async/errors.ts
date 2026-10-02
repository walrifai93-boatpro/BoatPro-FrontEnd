// ---------------------------------------------------------------------------
// Normalized API errors (marina portal)
//
// The `fetch` wrapper in api.ts used to throw `new Error(body.message ||
// 'Request failed (500)')`, which threw away the status code and, on a 5xx,
// happily rendered whatever the backend leaked straight into the UI.
//
// `ApiError` keeps the status, a coarse `kind` for branching, and a
// human-readable `message` that is safe to put in front of a user. It extends
// `Error`, so every existing `catch (e) { toast(e.message) }` call site keeps
// working — it just gets better copy.
// ---------------------------------------------------------------------------

import { translatePortalText } from '../i18n/runtime';

export type ApiErrorKind =
  /** Request never reached the server (offline, DNS, CORS, connection refused). */
  | 'network'
  /** Server accepted the connection but did not answer in time. */
  | 'timeout'
  /** 401/403 — session expired or the account may not do this. */
  | 'auth'
  /** 400/409/422 — the request was rejected; `details` may hold field errors. */
  | 'validation'
  /** 404 — the thing asked for is not there. */
  | 'notFound'
  /** 429 — rate limited. */
  | 'rateLimit'
  /** 5xx — the server broke. */
  | 'server'
  /** Aborted by the caller (unmount, superseded request) — never worth showing. */
  | 'cancelled'
  | 'unknown';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  /** Backend field-level errors, when it sent any (`body.errors`). */
  readonly details?: unknown;

  constructor(message: string, kind: ApiErrorKind, status?: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.details = details;
  }

  /** True when retrying the exact same request could plausibly succeed. */
  get retryable() {
    return this.kind === 'network' || this.kind === 'timeout' || this.kind === 'server' || this.kind === 'rateLimit';
  }
}

/** Copy for each failure class. Deliberately non-technical and actionable. */
const MESSAGES: Record<ApiErrorKind, string> = {
  network: 'Unable to connect to the server. Please check your internet connection and try again.',
  timeout: 'The server took too long to respond. Please try again.',
  auth: 'Your session has expired. Please sign in again.',
  notFound: "We couldn't find what you were looking for.",
  rateLimit: 'Too many attempts. Please wait a moment and try again.',
  server: 'Something went wrong on our end. Please try again in a moment.',
  validation: 'Please check the information you entered and try again.',
  cancelled: 'Cancelled.',
  unknown: 'Something went wrong. Please try again.',
};

export function kindForStatus(status: number): ApiErrorKind {
  if (status === 401) return 'auth';
  if (status === 403) return 'auth';
  if (status === 404) return 'notFound';
  if (status === 429) return 'rateLimit';
  if (status >= 500) return 'server';
  if (status >= 400) return 'validation';
  return 'unknown';
}


/**
 * Human labels for the API's field names.
 *
 * The point of this table is that a validation message has to say *which field*.
 * Zod's defaults do not: a bad entrance depth produces "Number must be less than
 * or equal to 100", which on a sixteen-input form tells the user nothing they can
 * act on. Prefixed with a label it becomes "Depth at entrance: Number must be less
 * than or equal to 100", which they can.
 *
 * Only entries whose de-camelised form would be wrong or cryptic need to be here —
 * `humanizeField` handles `firstName` → "First name" on its own. `depthM` would
 * become "Depth m", so it is listed; `city` would become "City", so it is not.
 */
const FIELD_LABELS: Record<string, string> = {
  depthM: 'Depth at entrance',
  maxLoaFt: 'Max LOA accepted',
  contactNumber: 'Phone',
  nameAr: 'Name (Arabic)',
  descriptionAr: 'Description (Arabic)',
  loaFt: 'Length overall',
  beamFt: 'Beam',
  draftFt: 'Draft',
  pricePerHour: 'Price per hour',
  pricePerDay: 'Price per day',
  priceSar: 'Price',
  vhfChannel: 'VHF channel',
  cashCreditLimit: 'Cash credit limit',
  commissionRate: 'Commission rate',
  maxLoa: 'Max LOA accepted',
  bookingType: 'Service line',
  providerId: 'Provider',
  boatId: 'Boat',
  marinaId: 'Marina',
  stationId: 'Station',
  berthId: 'Berth',
  sku: 'SKU',
  minStock: 'Minimum stock',
  leadTimeDays: 'Lead time (days)',
  expiresAt: 'Expiry date',
  issuedAt: 'Issue date',
  startAt: 'Start time',
  endAt: 'End time',
  etaAt: 'ETA',
  etdAt: 'ETD',
};

/**
 * `maxLoaFt` → "Max LOA accepted"; `firstName` → "First name".
 *
 * Nested paths keep only their last segment, since `address.city` is the City
 * field as far as anyone filling in the form is concerned, and array indices are
 * dropped for the same reason — "Dock 1 name" would be better, but "Name" beats
 * "Docks.0.name".
 */
export function humanizeField(path: string): string {
  const tail = path.replace(/\.\d+/g, '').split('.').filter(Boolean).pop() ?? path;
  if (FIELD_LABELS[tail]) return FIELD_LABELS[tail];
  if (FIELD_LABELS[path]) return FIELD_LABELS[path];
  const words = tail
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return path;
  /**
   * Sentence case, not title case: this label is a prefix to a sentence
   * ("First name: required"), and "First Name: required" reads like a heading
   * that wandered into the middle of one. An all-caps word is left alone so a
   * genuine acronym is not flattened to "Vhf".
   */
  return words
    .map((w, i) => {
      if (w.length > 1 && w === w.toUpperCase()) return w;
      return i === 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase();
    })
    .join(' ');
}

/**
 * "Depth at entrance: Number must be less than or equal to 100".
 *
 * Returns undefined when there is nothing field-shaped to describe, so the caller
 * falls back to the plain message rather than printing an empty prefix.
 */
export function describeFieldErrors(details: unknown, limit = 3): string | undefined {
  if (!details) return undefined;
  const pairs: [string, string][] = [];

  if (Array.isArray(details)) {
    for (const issue of details) {
      const path = Array.isArray(issue?.path)
        ? issue.path.join('.')
        : issue?.field ?? issue?.param;
      if (typeof path === 'string' && path && typeof issue?.message === 'string') {
        pairs.push([path, issue.message]);
      }
    }
  } else if (typeof details === 'object') {
    const flat = (details as { fieldErrors?: Record<string, unknown> }).fieldErrors;
    const source = flat && typeof flat === 'object' ? flat : (details as Record<string, unknown>);
    for (const [k, v] of Object.entries(source)) {
      const msg = Array.isArray(v) ? v[0] : v;
      if (typeof msg === 'string') pairs.push([k, msg]);
    }
  }

  if (!pairs.length) return undefined;
  // Both halves are translated separately: the whole "Label: message" line is
  // never a catalog key, so translating it later would leave it all in English.
  // Validator messages are fixed server copy, so the catalog covers them too.
  const shown = pairs.slice(0, limit).map(([path, msg]) => `${translatePortalText(humanizeField(path))}: ${translatePortalText(msg)}`);
  const extra = pairs.length - shown.length;
  return extra > 0 ? `${shown.join(' · ')} ${translatePortalText(`(+${extra} more)`)}` : shown.join(' · ');
}

/**
 * Builds an `ApiError` from an HTTP response.
 *
 * The backend's own wording is preferred for 4xx — it is written for the user
 * ("That berth was just taken") — but never for 5xx or auth, where it is either
 * an internal detail or less useful than our copy.
 *
 * When the response carries field-level detail, the message names the field. That
 * one change reaches every screen: a form that has not been wired up to highlight
 * its inputs still tells the user *which* input, rather than reciting a validator
 * string with no subject.
 */
export function apiErrorFromResponse(status: number, body: any): ApiError {
  const kind = kindForStatus(status);
  const serverMsg = typeof body?.message === 'string' && body.message.trim() ? body.message : undefined;
  const useServerMsg = !!serverMsg && kind !== 'server' && kind !== 'auth';
  const described = kind === 'validation' ? describeFieldErrors(body?.errors) : undefined;
  const message =
    status === 403
      ? "You don't have permission to do that."
      : described ?? (useServerMsg ? serverMsg! : MESSAGES[kind]);
  return new ApiError(message, kind, status, body?.errors);
}

/** Anything a `catch` can receive → an `ApiError`. */
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;

  if (err instanceof DOMException && err.name === 'AbortError') {
    return new ApiError(MESSAGES.cancelled, 'cancelled');
  }

  if (err instanceof Error) {
    if (/failed to fetch|networkerror|load failed/i.test(err.message)) {
      return new ApiError(MESSAGES.network, 'network');
    }
    if (/timeout|timed out/i.test(err.message)) {
      return new ApiError(MESSAGES.timeout, 'timeout');
    }
    return new ApiError(err.message || MESSAGES.unknown, 'unknown');
  }

  if (typeof err === 'string' && err.trim()) return new ApiError(err, 'unknown');

  return new ApiError(MESSAGES.unknown, 'unknown');
}

/** One-liner for display. Never a stack trace. */
export function errorMessage(err: unknown): string {
  return toApiError(err).message;
}

/**
 * Field-level errors keyed by field name, when the backend sent any.
 * Lets a form show messages inline instead of firing a toast per field (§36).
 */
export function fieldErrors(err: unknown): Record<string, string> {
  const details = toApiError(err).details;
  if (!details) return {};
  const out: Record<string, string> = {};

  // zod flatten() shape: { fieldErrors: { name: ['required'] } }
  const flat = (details as any).fieldErrors;
  if (flat && typeof flat === 'object') {
    for (const [k, v] of Object.entries(flat)) {
      const msg = Array.isArray(v) ? v[0] : v;
      if (typeof msg === 'string') out[k] = translatePortalText(msg);
    }
    return out;
  }

  // zod issues array: [{ path: ['name'], message: 'required' }]
  if (Array.isArray(details)) {
    for (const issue of details) {
      const path = Array.isArray(issue?.path) ? issue.path.join('.') : issue?.field ?? issue?.param;
      if (typeof path === 'string' && typeof issue?.message === 'string' && !out[path]) out[path] = translatePortalText(issue.message);
    }
    return out;
  }

  if (typeof details === 'object') {
    for (const [k, v] of Object.entries(details as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = translatePortalText(v);
    }
  }
  return out;
}
