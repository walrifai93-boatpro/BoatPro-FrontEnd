// ---------------------------------------------------------------------------
// Live marina data layer — real backend data, no local seed.
//
// `MarinaProvider` owns the one thing every page needs (the operator's marina
// and its settings) and `useAsync` handles per-page fetching with loading,
// error and reload state. Nothing here caches stale writes: any mutation calls
// `reload()` on the affected query.
// ---------------------------------------------------------------------------
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { fileUrl, marinaApi, portalApi, type ApiMarina, type MarinaSettings } from './api';
import { IMG } from './images';
import { toApiError, type ApiError } from './async/errors';
import { toast } from './async/toast';
import { useDelayedFlag } from './async/hooks';
import { activeCurrency, BASE_CURRENCY, convert, currencySign, useCurrency } from './currency';
import { formatPortalCurrency, formatPortalDate, formatPortalNumber, isPortalArabic, portalLocale, translatePortalText } from './i18n/runtime';

// ── generic async query ─────────────────────────────────────
export interface AsyncState<T> {
  data: T | null;
  /**
   * True while a *first* load is in flight and past the flicker threshold.
   * Drive skeletons off this.
   *
   * Deliberately false during a reload that already has data on screen: a
   * refresh must not collapse a populated page back to placeholders under the
   * user (§C — stable layout). Use `refreshing` for that case.
   */
  loading: boolean;
  /** True while re-fetching with content already on screen. */
  refreshing: boolean;
  /** Human-readable, never a stack trace. */
  error: string | null;
  /** The normalized error, when branching on `kind`/`status` is needed. */
  errorDetail: ApiError | null;
  reload: (opts?: { silent?: boolean }) => Promise<T | null>;
  /** Patch the loaded value locally (optimistic UI) without a refetch. */
  set: (updater: (current: T) => T) => void;
}

export interface UseAsyncOptions {
  /** ms before `loading` flips true. Default 250. Pass 0 to show it immediately. */
  loadingDelay?: number;
  /** Also report load failures via toast. Off by default — the inline error state is primary. */
  toastError?: boolean;
}

/**
 * Runs `fn` on mount and whenever `deps` change. Late responses from a
 * superseded run are dropped, so fast filter changes can't flash old data.
 *
 * Three behaviours worth knowing:
 *  · `loading` is delayed ~250ms, so a fast response never flashes a skeleton.
 *  · A reload with data already present sets `refreshing`, not `loading` — the
 *    page keeps its content instead of blinking back to placeholders.
 *  · Errors are normalized (`ApiError`), so `error` is always presentable copy
 *    rather than "Request failed (500)" or a leaked backend string.
 */
export function useAsync<T>(
  fn: () => Promise<T>,
  deps: unknown[] = [],
  options: UseAsyncOptions = {}
): AsyncState<T> {
  const { loadingDelay = 250, toastError = false } = options;

  const [data, setData] = useState<T | null>(null);
  const [pending, setPending] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorDetail, setErrorDetail] = useState<ApiError | null>(null);
  const runId = useRef(0);
  const hasData = useRef(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async (opts?: { silent?: boolean }) => {
    const id = ++runId.current;
    const silent = opts?.silent ?? false;

    if (!silent) {
      if (hasData.current) setRefreshing(true);
      else setPending(true);
    }
    setErrorDetail(null);
    try {
      const result = await fnRef.current();
      if (id === runId.current) {
        hasData.current = true;
        setData(result);
      }
      return result;
    } catch (e) {
      const err = toApiError(e);
      // A superseded/aborted run is not a failure to report.
      if (id === runId.current && err.kind !== 'cancelled') {
        setErrorDetail(err);
        if (toastError) toast.error(err.message);
      }
      return null;
    } finally {
      if (id === runId.current) {
        setPending(false);
        setRefreshing(false);
      }
    }
  }, [toastError]);

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const set = useCallback((updater: (current: T) => T) => {
    setData((current) => (current === null ? current : updater(current)));
  }, []);

  const loading = useDelayedFlag(pending && !refreshing, loadingDelay);

  return {
    data,
    loading,
    refreshing,
    error: errorDetail?.message ?? null,
    errorDetail,
    reload: run,
    set,
  };
}

// ── the operator's marina ───────────────────────────────────
interface MarinaContextValue {
  marina: ApiMarina | null;
  settings: MarinaSettings | null;
  currency: string;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  /**
   * Format an amount the marina holds, in the currency the operator reads in.
   * Pass `display` to pin it — invoice and VAT figures pin to `BASE_CURRENCY`.
   */
  money: (n: number | null | undefined, opts?: { compact?: boolean; display?: string }) => string;
  applyMarina: (marina: ApiMarina) => void;
}

const DEFAULT_SETTINGS: MarinaSettings = {
  currency: 'SAR',
  vatRate: 15,
  autoApproveReservations: false,
  checkInTime: '14:00',
  checkOutTime: '11:00',
  cancellationWindowHours: 48,
  notifyByEmail: true,
  notifyBySms: false,
};

const MarinaContext = createContext<MarinaContextValue>(null as any);

let cachedMarina: ApiMarina | null = null;

export function clearMarinaCache() {
  cachedMarina = null;
}

export function MarinaProvider({ children }: { children: React.ReactNode }) {
  const [marina, setMarina] = useState<ApiMarina | null>(cachedMarina);
  const [loading, setLoading] = useState(!cachedMarina);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await marinaApi.mine();
      const m = res.data.marina;
      const mId = m.id || m._id;
      const loadedMarina: ApiMarina = {
        ...m,
        id: mId,
        _id: m._id || mId,
        completeness: (res.data as any).completeness || m.completeness,
      };
      cachedMarina = loadedMarina;
      setMarina(loadedMarina);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your marina');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!cachedMarina) void reload();
  }, [reload]);

  const applyMarina = useCallback((next: ApiMarina) => {
    const nextId = next.id || next._id;
    const normalized = {
      ...next,
      id: nextId,
      _id: next._id || nextId,
    };
    cachedMarina = normalized;
    setMarina(normalized);
  }, []);

  const settings = marina?.settings ?? null;
  const currency = settings?.currency ?? DEFAULT_SETTINGS.currency;
  const { currency: displayCurrency } = useCurrency();

  // `displayCurrency` is in the dependency list so every consumer of the context
  // re-renders on a switch; `currency` stays the *source* the marina prices in.
  const money = useCallback(
    (n: number | null | undefined, opts?: { compact?: boolean; display?: string }) =>
      formatMoney(n, currency, opts),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currency, displayCurrency],
  );

  const value = useMemo(
    () => ({ marina, settings, currency, loading, error, reload, money, applyMarina }),
    [marina, settings, currency, loading, error, reload, money, applyMarina],
  );

  return <MarinaContext.Provider value={value}>{children}</MarinaContext.Provider>;
}

export function useMarina(): MarinaContextValue {
  const ctx = useContext(MarinaContext);
  if (!ctx) throw new Error('useMarina must be used inside <MarinaProvider>');
  return ctx;
}

/**
 * Same context, but safe outside the marina portal — shared chrome (page
 * headers, avatars) renders in the fuel/maintenance/admin portals too, where
 * there is no marina to load.
 */
export function useMarinaOptional(): MarinaContextValue | null {
  return useContext(MarinaContext) ?? null;
}

/** Marina settings with defaults filled in, for pages that read them directly. */
export function useMarinaSettings(): MarinaSettings {
  const { settings } = useMarina();
  return { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
}

// ── formatters ──────────────────────────────────────────────
/**
 * The portal's money formatter.
 *
 * `currency` names what the amount is *already* denominated in — the marina's
 * own currency, or whatever a record carries — and the figure is then converted
 * into the currency the operator has chosen to read in. The two were the same
 * thing while there was one currency; they are not any more, and conflating
 * them is exactly how a riyal figure ends up wearing a dollar label.
 *
 * Pass `display` explicitly to pin an amount to a particular currency — the
 * invoice and VAT figures do, because those are reconciled against a ZATCA
 * filing that is denominated in riyals.
 */
export function formatMoney(
  n: number | null | undefined,
  // Widened to `string`: the source is whatever a marina or a record says it
  // prices in, which is not constrained to the two the switcher offers.
  currency: string = BASE_CURRENCY,
  opts?: { compact?: boolean; display?: string },
): string {
  const display = opts?.display ?? activeCurrency();
  const raw = typeof n === 'number' && isFinite(n) ? n : 0;
  const value = convert(raw, currency, display);
  const sign = currencySign(display);
  if (opts?.compact && Math.abs(value) >= 1000) {
    const units: [number, string, string][] = isPortalArabic()
      ? [[1e9, 'مليار', 'B'], [1e6, 'مليون', 'M'], [1e3, 'ألف', 'k']]
      : [[1e9, 'B', 'B'], [1e6, 'M', 'M'], [1e3, 'k', 'k']];
    for (const [size, suffix] of units) {
      if (Math.abs(value) >= size) {
        const number = formatPortalNumber(value / size, { maximumFractionDigits: value / size >= 10 ? 0 : 1 });
        return isPortalArabic() ? `${number} ${suffix} ${sign}` : `${sign} ${number}${suffix}`;
      }
    }
  }
  // A whole riyal figure stays whole; a converted dollar one lands mid-unit and
  // keeps its cents. The existing `value % 1` rule already draws that line, now
  // that it is applied to the *converted* value rather than the stored one.
  return formatPortalCurrency(value, display);
}

/**
 * An amount left in the currency it was issued in, whatever the operator has
 * the switch set to.
 *
 * For figures that exist on a document outside this portal — an invoice
 * subtotal, its VAT line, its total. A ZATCA invoice is a riyal document; if
 * the operator is reading in dollars and the modal obliges, the number on
 * screen appears nowhere in the filing, and the one thing this screen is for
 * is checking that it does. Revenue charts and KPI tiles have no such
 * counterpart and follow the preference like everything else.
 */
export function asIssued(n: number | null | undefined, currency: string = BASE_CURRENCY): string {
  return formatMoney(n, currency, { display: currency });
}

export function fmtDate(value?: string | Date | null): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? '—' : formatPortalDate(d, { day: '2-digit', month: 'short', year: 'numeric' });
}
export function fmtTime(value?: string | Date | null): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat(portalLocale(), { hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}
export function fmtDateTime(value?: string | Date | null): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? '—' : `${fmtDate(d)} · ${fmtTime(d)}`;
}
/** "3 days ago" / "in 2 h" — relative, for feeds and activity lists. */
export function fmtRelative(value?: string | Date | null): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return '—';
  const diff = d.getTime() - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  if (mins < 1) return isPortalArabic() ? 'الآن' : translatePortalText('just now');
  const formatter = new Intl.RelativeTimeFormat(portalLocale(), { numeric: 'auto' });
  if (mins < 60) return formatter.format(Math.sign(diff) * mins, 'minute');
  const hours = Math.round(mins / 60);
  if (hours < 24) return formatter.format(Math.sign(diff) * hours, 'hour');
  const days = Math.round(hours / 24);
  if (days < 30) return formatter.format(Math.sign(diff) * days, 'day');
  return formatter.format(Math.sign(diff) * Math.round(days / 30), 'month');
}
export function daysUntil(isoDate?: string | null): number | null {
  if (!isoDate) return null;
  const d = new Date(`${isoDate}T00:00:00`);
  if (isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}
/**
 * Today as `YYYY-MM-DD`, in the operator's own day — not UTC's.
 *
 * This was `new Date().toISOString().slice(0, 10)`, which converts to UTC
 * before taking the date. At UTC+3 that is a different calendar day for the
 * first three hours of every local day: at 01:00 in Jeddah it answers
 * yesterday.
 *
 * Three hours a day sounds small until you look at what reads it. The dock
 * monitoring screen asks `movements.list({ date: todayIso() })`, so an early
 * shift saw yesterday's arrivals and departures. `Movements` builds a checkout
 * timestamp as `${todayIso()}T${checkOutTime}` — that one is *written*, so a
 * boat cleared out at 01:30 was recorded as leaving the day before. The
 * utilities page takes `todayIso().slice(0, 7)` as the current month, so on the
 * first of a month it billed against the previous one. And a new reservation's
 * start date defaulted into the past, where the server is entitled to reject
 * it.
 *
 * Built from the local date parts instead, which is the only way to get the
 * day the person in front of the screen is actually having.
 */
export const todayIso = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};

/** The same conversion for an arbitrary date. */
export const localIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Turn a snake_case backend enum into a readable label. */
export function humanize(value?: string | null): string {
  if (!value) return '—';
  return translatePortalText(value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));
}

// ── status label + tone maps shared across pages ────────────
export const RESERVATION_LABELS: Record<string, string> = {
  pending_approval: 'Awaiting review',
  pending_payment: 'Awaiting payment',
  declined: 'Declined',
  active: 'Active',
  completed: 'Completed',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

export const BERTH_LABELS: Record<string, string> = {
  available: 'Available',
  reserved: 'Reserved',
  booked: 'Occupied',
  maintenance: 'Maintenance',
  blocked: 'Blocked',
};

export const MOVEMENT_LABELS: Record<string, string> = {
  expected: 'Expected',
  en_route: 'En route',
  checked_in: 'Checked-in',
  checked_out: 'Checked-out',
  no_show: 'No-show',
  cancelled: 'Cancelled',
};

/** Weather code → short description (WMO codes from Open-Meteo). */
export function weatherText(code: number | null | undefined): string {
  if (code === null || code === undefined) return 'Conditions unavailable';
  if (code === 0) return 'Clear sky';
  if (code <= 2) return 'Mainly clear';
  if (code === 3) return 'Overcast';
  if (code <= 48) return 'Fog';
  if (code <= 57) return 'Drizzle';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Rain showers';
  if (code <= 86) return 'Snow showers';
  return 'Thunderstorm';
}

/** Compass point for a wind bearing. */
export function windDir(deg: number | null | undefined): string {
  if (deg === null || deg === undefined) return '';
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return points[Math.round(deg / 22.5) % 16];
}

/**
 * The marina's own photograph at `index`, falling back to the design's stock
 * harbour imagery so the chrome never renders an empty frame.
 */
export function marinaPhoto(marina: ApiMarina | null | undefined, index = 0): string {
  const own = marina?.images?.[index];
  if (own) return fileUrl(own)!;
  const fallbacks = [IMG.hero, IMG.marina1, IMG.marina2, IMG.marina3, IMG.harbor1];
  return fallbacks[index % fallbacks.length];
}

/**
 * The marina's "cover" gallery photos (as uploaded in Marina Profile /
 * the registration wizard), for chrome that rotates through them — the
 * dashboard hero and sidebar card. Falls back to `marinaPhoto` (a single
 * still image) when no cover photos have been tagged yet.
 */
export function marinaCoverPhotos(marina: ApiMarina | null | undefined): string[] {
  const covers = (marina?.imagesCategorized || [])
    .filter((i) => i.category === 'cover')
    .map((i) => fileUrl(i.url))
    .filter((u): u is string => !!u);
  return covers.length ? covers : [marinaPhoto(marina)];
}

/** Berth label as the crew says it: "A·04". */
export const berthLabel = (pontoon?: string | null, slot?: number | null) =>
  pontoon ? `${pontoon}·${String(slot ?? 0).padStart(2, '0')}` : '—';

/** Pull the populated user off a field that may still be an id. */
export function personOf<T extends { _id?: string; id?: string; name?: string; avatar?: string; email?: string; phone?: string }>(
  value: T | string | null | undefined,
): (T & { id?: string; _id?: string }) | null {
  return value && typeof value === 'object' ? (value as T & { id?: string; _id?: string }) : null;
}

/** Overview refresher other pages can call after a mutation. */
export function useOverview() {
  return useAsync(() => portalApi.overview().then((r) => r.data), []);
}
