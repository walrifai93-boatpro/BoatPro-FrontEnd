/**
 * Display currency for the portal — the SAR ⇄ USD switch.
 *
 * WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
 *
 * A *presentation* preference. The platform settles in one currency — the one
 * the HyperPay entity is provisioned for (`env.HYPERPAY_CURRENCY`, SAR) — and
 * `payment.controller.ts` refuses a client-named currency outright, because
 * naming a different one just produces a rejected or mis-booked charge. So
 * switching to USD changes what a figure *reads as*, never what is invoiced,
 * charged or paid out.
 *
 * That distinction matters more here than in either app: this portal is where
 * an operator reconciles takings against a bank statement. Two rules follow —
 *
 *   1. Amounts are always *converted*, never relabelled. `convert()` is the
 *      only way a number changes currency.
 *   2. Anything an operator files or reconciles against an external document —
 *      an invoice total, a VAT figure — keeps the settlement currency whatever
 *      the preference says, by passing `BASE_CURRENCY` explicitly. A ZATCA
 *      invoice is a riyal document; showing its total as dollars would put a
 *      number on screen that appears nowhere in the filing.
 *
 * ON THE RATE
 *
 * The riyal has been pegged to the dollar at 3.75 SAR = 1 USD since 1986 and is
 * held there by SAMA, so the constant is the published peg rather than a stale
 * FX quote. `setRates` exists so the backend can push a correction (or a third
 * currency) without a redeploy.
 *
 * Mirrors `boatpro/src/lib/currency.ts` and `boatpro-provider/src/lib/currency.ts`,
 * so one booking spells its price the same way in all three.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { isPortalArabic } from './i18n/runtime';

/** Currencies the switcher offers. Ordered as they appear in the UI. */
export const SUPPORTED_CURRENCIES = ['SAR', 'USD'] as const;
export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

/**
 * The currency the backend stores amounts in and HyperPay settles in.
 *
 * Every bare number that crosses the API is in this currency unless the record
 * carries its own `currency` field saying otherwise.
 */
export const BASE_CURRENCY: CurrencyCode = 'SAR';

export function isSupportedCurrency(code?: string | null): code is CurrencyCode {
  return !!code && (SUPPORTED_CURRENCIES as readonly string[]).includes(code.toUpperCase());
}

/** Units of each currency per 1 unit of {@link BASE_CURRENCY}. */
const RATES: Record<string, number> = {
  SAR: 1,
  USD: 1 / 3.75, // the SAMA peg, inverted: 3.75 SAR buys 1 USD
};

/**
 * Replace or extend the rate table — e.g. from `GET /api/config/currency`.
 *
 * Merges rather than overwrites, and ignores anything that is not a finite
 * positive number: a bad payload should leave figures as they were, not turn
 * them into `NaN`.
 */
export function setRates(rates: Record<string, number>): void {
  for (const [code, rate] of Object.entries(rates)) {
    if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) {
      RATES[code.toUpperCase()] = rate;
    }
  }
  RATES[BASE_CURRENCY] = 1;
}

export function getRates(): Readonly<Record<string, number>> {
  return { ...RATES };
}

/**
 * Convert between currencies.
 *
 * Returns the amount untouched when the currencies match, when either is
 * unknown, or when the amount is unusable — a missing rate must show the
 * original figure rather than a confidently wrong one.
 */
export function convert(
  amount: number | null | undefined,
  from: string = BASE_CURRENCY,
  to: string = BASE_CURRENCY,
): number {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return 0;
  const src = (from || BASE_CURRENCY).toUpperCase();
  const dst = (to || BASE_CURRENCY).toUpperCase();
  if (src === dst) return amount;
  const fromRate = RATES[src];
  const toRate = RATES[dst];
  if (!fromRate || !toRate) return amount;
  return (amount / fromRate) * toRate;
}

/**
 * How many decimals an amount in this currency is quoted to.
 *
 * Riyal figures here are whole-riyal by convention, but a dollar amount
 * converted off a riyal one lands mid-unit almost every time — SAR 1,500 is
 * $400.00, SAR 1,450 is $386.67 — so USD keeps its cents, or a reconciliation
 * column stops adding up.
 */
export function decimalsFor(currency: string): number {
  return currency.toUpperCase() === 'SAR' ? 0 : 2;
}

export function currencySign(currency: string): string {
  const code = currency.toUpperCase();
  if (isPortalArabic()) {
    if (code === 'SAR') return 'ر.س';
    if (code === 'USD') return 'دولار أمريكي';
  }
  if (code === 'SAR' || code === 'USD') return code;
  return currency;
}

/** Names for the switcher's own options. */
export const CURRENCY_LABELS: Record<CurrencyCode, string> = {
  SAR: 'Saudi Riyal',
  USD: 'US Dollar',
};

// ---------------------------------------------------------------------------
// The preference
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'boatpro.portal.currency';

/**
 * Module-level mirror of the active currency, for the formatters that run
 * outside React — `format.ts`, `typeSystem.ts`, and the table-cell renderers
 * they feed. `CurrencyProvider` keeps it in step.
 *
 * Seeded from storage rather than to a default so a formatter called during the
 * very first render agrees with what the provider is about to paint.
 */
let current: CurrencyCode = BASE_CURRENCY;

/** The active display currency, readable outside React. */
export function activeCurrency(): CurrencyCode {
  return current;
}

function readStored(): CurrencyCode {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (isSupportedCurrency(raw)) return raw.toUpperCase() as CurrencyCode;
  } catch {
    // private mode, blocked storage — fall through to the base currency
  }
  return BASE_CURRENCY;
}

interface CurrencyContextValue {
  /** The currency figures are displayed in. */
  currency: CurrencyCode;
  setCurrency: (code: CurrencyCode) => void;
  /** True when what is on screen is a conversion rather than the stored figure. */
  isConverted: boolean;
  /** The active currency's sign — "SAR" / "USD". */
  sign: string;
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

current = readStored();

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  // Read synchronously on first render rather than in an effect: a figure that
  // paints in riyals and flips to dollars a frame later reads as money moving.
  const [currency, setCurrencyState] = useState<CurrencyCode>(readStored);

  // Written during render, not in an effect: a formatter called by a child in
  // this same commit must not read last render's currency.
  current = currency;

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, currency);
    } catch {
      // a failed write costs a preference on next load, not a wrong figure now
    }
  }, [currency]);

  // Pick up the server's rate table once, if it answers. Deliberately advisory:
  // the peg baked in above is already correct, so a failure — offline, an older
  // backend without the route — must leave figures exactly as they were.
  // `bump` forces one re-render so anything already painted picks up a
  // correction; without it the new rate would sit unused until something else
  // moved.
  const [, bump] = useState(0);
  useEffect(() => {
    let cancelled = false;
    // `api` is imported lazily rather than at module scope: this file is the
    // bottom of the formatting stack (`live.tsx` and `format.ts` both import
    // it), and a static import back up into the API layer would make that a
    // cycle.
    import('./api')
      .then(({ API_URL }) => fetch(`${API_URL}/currency`))
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        const rates = body?.data?.rates;
        if (cancelled || !rates) return;
        setRates(rates);
        bump((n) => n + 1);
      })
      .catch(() => {
        // keep the peg
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setCurrency = useCallback((code: CurrencyCode) => {
    if (isSupportedCurrency(code)) setCurrencyState(code.toUpperCase() as CurrencyCode);
  }, []);

  const value = useMemo(
    () => ({
      currency,
      setCurrency,
      isConverted: currency !== BASE_CURRENCY,
      sign: currencySign(currency),
    }),
    [currency, setCurrency],
  );

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

/**
 * The active display currency.
 *
 * Falls back to the base currency outside a provider rather than throwing —
 * a missing provider should not blank a finance page, and the base currency is
 * what the numbers already are.
 */
export function useCurrency(): CurrencyContextValue {
  return (
    useContext(CurrencyContext) ?? {
      currency: BASE_CURRENCY,
      setCurrency: () => {},
      isConverted: false,
      sign: currencySign(BASE_CURRENCY),
    }
  );
}
