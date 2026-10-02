import { formatMoney } from '../live'
import { formatPortalDate, formatPortalNumber, isPortalArabic, portalLocale, translatePortalText } from '../i18n/runtime'
// ---------------------------------------------------------------------------
// Centralized type system & typecasting utilities — marina portal.
//
// This is the single source for turning "whatever a control or an API response
// gave us" into a correctly-typed value, and back into display text. Kept
// deliberately identical in shape to boatpro/src/utils/typeSystem.ts and
// boatpro-provider/src/lib/typeSystem.ts, so a rule learned in one app holds in
// the others.
//
// Two rules run through all of it:
//
//  1. **Empty is not zero** (§26). `Number('')` is `0`, so a cleared "monthly
//     price" naively coerced becomes free berthing. Every parser here returns
//     `null` for blank input, and callers keep `null` rather than defaulting.
//
//  2. **Storage and display are different things** (§28). The stored value is a
//     plain number or a `YYYY-MM-DD` string; the currency code, thousands
//     separators, `%` sign and localized month name are added only on the way
//     out, by the `format*` functions.
//
// On currency: `formatCurrency` takes the code explicitly and defaults to SAR,
// the portal's own default (`DEFAULT_SETTINGS.currency` in live.tsx). It used to
// default to `'AED'`, which silently mislabelled every unqualified amount. In a
// component, prefer `useMarina().money(...)` — that reads the operator's actual
// configured currency rather than any default.
// ---------------------------------------------------------------------------

/**
 * The semantic type of a form field. Drives which control is rendered, which
 * parser runs, and which keyboard a device shows.
 */
export type FieldType =
  | 'text'
  | 'integer'
  | 'decimal'
  | 'currency'
  | 'percentage'
  | 'date'
  | 'datetime'
  | 'time'
  | 'boolean'
  | 'enum'
  | 'id'
  | 'array'
  | 'url'
  | 'email'
  | 'phone'
  | 'coordinates';

/** `''`, `null` and `undefined` all mean "not provided". */
const isBlank = (v: unknown): boolean =>
  v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

/** Convert Arabic/Persian digits and separators before parsing form input. */
function normalizeLocalizedDigits(value: string): string {
  return value
    .replace(/[٠-٩۰-۹]/g, digit => {
      const code = digit.charCodeAt(0)
      return String(code - (code >= 1776 ? 1776 : 1632))
    })
    .replace(/[٬٫،]/g, match => match === '٫' ? '.' : ',')
}

// ── numbers ────────────────────────────────────────────────────
/**
 * A whole number, or `null`.
 *
 * Rounds a fractional input rather than rejecting it, because this also
 * sanitises values already sitting in records. Reject "12.5" at the point of
 * entry with field-level validation instead.
 */
export function parseInteger(val: unknown, fallback: number | null = null): number | null {
  if (isBlank(val)) return fallback;
  const num = typeof val === 'number' ? val : Number(normalizeLocalizedDigits(String(val).trim()).replace(/,/g, ''));
  return Number.isFinite(num) ? Math.round(num) : fallback;
}

/** A decimal number, or `null`. No rounding — precision is the caller's call. */
export function parseDecimal(val: unknown, fallback: number | null = null): number | null {
  if (isBlank(val)) return fallback;
  const num = typeof val === 'number' ? val : Number(normalizeLocalizedDigits(String(val).trim()).replace(/,/g, ''));
  return Number.isFinite(num) ? num : fallback;
}

/**
 * A monetary amount as a plain number.
 *
 * Strips grouping separators and currency symbols, so a value that was displayed
 * as "SAR 25,000" round-trips back to `25000` rather than `NaN`.
 */
export function parseCurrency(val: unknown, fallback: number | null = null): number | null {
  if (isBlank(val)) return fallback;
  if (typeof val === 'number') return Number.isFinite(val) ? val : fallback;
  const cleaned = normalizeLocalizedDigits(String(val)).replace(/,/g, '').replace(/[^\d.-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return fallback;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : fallback;
}

/**
 * A percentage in **whole-number form**: `15` means 15%.
 *
 * The app-wide convention (§8), matching the backend's `vatRate`,
 * `commissionRate` and `discountPct`. `0.15` here is 0.15%, not 15%.
 */
export function parsePercentage(val: unknown, fallback: number | null = null): number | null {
  if (isBlank(val)) return fallback;
  const cleaned = typeof val === 'number' ? val : Number(normalizeLocalizedDigits(String(val).replace(/[%٪]\s*$/, '').trim()).replace(/,/g, ''));
  if (!Number.isFinite(cleaned)) return fallback;
  return Math.min(Math.max(cleaned, 0), 100);
}

// ── booleans ───────────────────────────────────────────────────
/**
 * A real boolean from any wire form.
 *
 * Returns `false` for blank input. When "not provided" must stay distinguishable
 * from `false` — a PATCH body, a filter that may be unset — use
 * `parseBooleanOrNull`.
 */
export function parseBoolean(val: unknown): boolean {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val !== 0;
  if (typeof val === 'string') {
    const lower = val.trim().toLowerCase();
    return lower === 'true' || lower === '1' || lower === 'yes' || lower === 'on';
  }
  return false;
}

/** As `parseBoolean`, but blank yields `null` so "unset" survives (§26). */
export function parseBooleanOrNull(val: unknown): boolean | null {
  if (isBlank(val)) return null;
  return parseBoolean(val);
}

// ── dates & times ──────────────────────────────────────────────
/**
 * A calendar date as `YYYY-MM-DD`, or `null`.
 *
 * Deliberately a string, not a `Date`: a date-only value has no time and no
 * zone, and `new Date('2026-08-11')` is midnight *UTC*, which renders as
 * 10 August anywhere west of Greenwich (§9). Expiry dates and document dates
 * stay strings end to end.
 */
export function parseDateOnly(val: unknown): string | null {
  if (isBlank(val)) return null;
  if (val instanceof Date) {
    if (Number.isNaN(val.getTime())) return null;
    // Local parts, not `toISOString()` — the latter would shift the day.
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const match = normalizeLocalizedDigits(String(val)).match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) return null;
  // The regex only proves the *shape*. `2026-02-31` and `2026-13-01` match it but
  // are not days that exist, and Mongoose would coerce them by rolling over into
  // the next month, storing a date the user never picked. Round-tripping through
  // local calendar parts rejects them instead.
  const [y, m, d] = match[1].split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const probe = new Date(y, m - 1, d);
  if (probe.getFullYear() !== y || probe.getMonth() !== m - 1 || probe.getDate() !== d) return null;
  return match[1];
}

/**
 * Whether a value is a usable calendar date, treating blank as acceptable so
 * optional fields pass. Use for "is this field valid" checks; use
 * `parseDateOnly` when you want the normalized value.
 */
export function isValidDateOnly(val: unknown): boolean {
  if (isBlank(val)) return true;
  return parseDateOnly(val) !== null;
}

/** An exact point in time as an ISO-8601 string with offset, or `null`. */
export function parseDateTime(val: unknown): string | null {
  if (isBlank(val)) return null;
  const d = val instanceof Date ? val : new Date(String(val));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** A wall-clock `HH:mm`, zero-padded so string comparison orders correctly. */
export function parseTime(val: unknown): string | null {
  if (isBlank(val)) return null;
  const m = normalizeLocalizedDigits(String(val).trim()).match(/^(\d{1,2})[:٫](\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

// ── collections & references ───────────────────────────────────
/**
 * A string array, accepting the comma-separated form a query string or
 * multipart body is limited to (§15). Blank yields `[]`, never `['']`.
 */
export function parseArray<T = string>(val: unknown): T[] {
  if (Array.isArray(val)) return val as T[];
  if (typeof val === 'string' && val.trim().length > 0) {
    return val
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean) as unknown as T[];
  }
  return [];
}

/** A 24-character hex Mongo id, or `null` — guards against sending a name (§14). */
export function parseId(val: unknown): string | null {
  if (isBlank(val)) return null;
  const s = String(val).trim();
  return /^[a-f\d]{24}$/i.test(s) ? s : null;
}

/** A phone number stays a **string** — leading zeros and `+` are meaningful (§18). */
export function parsePhone(val: unknown): string | null {
  if (isBlank(val)) return null;
  const s = normalizeLocalizedDigits(String(val).trim()).replace(/[\s()\-.]/g, '');
  return /^\+?\d{6,15}$/.test(s) ? s : null;
}

/** Validated to real geographic ranges (§16); both halves required. */
export function parseCoordinates(lat: unknown, lng: unknown): { latitude: number; longitude: number } | null {
  const latitude = parseDecimal(lat);
  const longitude = parseDecimal(lng);
  if (latitude === null || longitude === null) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

// ── display formatting ─────────────────────────────────────────
// These never mutate the stored value — they are the presentation half of §28.

/**
 * "SAR 25,000" — or "USD 6,666.67", if that is what the operator is reading in.
 *
 * `currency` names what the stored amount is denominated in, not what to render
 * it as; the display currency comes from the switch (see `src/currency.tsx`).
 *
 * Prefer `useMarina().money(...)` inside components: it defaults the source to
 * the operator's own configured currency, and re-renders on a switch.
 */
export function formatCurrency(amount: number | null | undefined, currency = 'SAR'): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '—'
  return formatMoney(amount, currency)
}

/** "15%" from the stored `15`. */
export function formatPercentage(val: number | null | undefined, decimals = 0): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  return `${formatPortalNumber(val, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${isPortalArabic() ? '٪' : '%'}`;
}

/** "11 Aug 2026" — from a `YYYY-MM-DD` string, without a UTC round-trip. */
export function formatDate(val: unknown): string {
  const parsed = parseDateOnly(val);
  if (!parsed) return '—';
  const [y, m, d] = parsed.split('-').map(Number);
  // Constructed from local parts so the rendered day matches the stored one.
  return formatPortalDate(new Date(y, m - 1, d), { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "11 Aug 2026, 22:30". 24-hour, matching marine/booking convention. */
export function formatDateTime(val: unknown): string {
  if (isBlank(val)) return '—';
  const d = val instanceof Date ? val : new Date(String(val));
  if (Number.isNaN(d.getTime())) return '—';
  return formatPortalDate(d, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** "22:30" from a stored `HH:mm`. Returned as-is once normalized. */
export function formatTime(val: unknown): string {
  const value = parseTime(val);
  return value && isPortalArabic() ? value.replace(/[0-9]/g, digit => '٠١٢٣٤٥٦٧٨٩'[Number(digit)]) : value ?? '—';
}

/** Thousands-separated number. */
export function formatNumber(val: number | null | undefined, decimals = 0): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  try {
    return new Intl.NumberFormat(portalLocale(), {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(val);
  } catch {
    return String(val);
  }
}

/** A measurement with its unit — "12.75 ft". Trailing zeros dropped. */
export function formatMeasure(val: number | null | undefined, unit: string, decimals = 2): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  const n = Number(val.toFixed(decimals));
  return `${formatNumber(n, Number.isInteger(n) ? 0 : decimals)} ${translatePortalText(unit)}`;
}
