/**
 * IBAN validation for the marina/fuel/workshop portal.
 *
 * Mirrors `boatpro-backend/src/utils/iban.ts` — the server is the authority, and
 * this exists so an operator sees a typo while the digits are still on screen
 * rather than as a bounced wire weeks later. Bank details are entered in four
 * places in this portal (marina onboarding, and the fuel, workshop and admin
 * money screens); all four go through here.
 *
 * Unlike the provider app's copy this returns finished English strings, because
 * the portal is not localised.
 */

export interface SaudiBank {
  nameEn: string;
  nameAr: string;
  swift: string;
}

/** Saudi bank codes — digits 5-6 of the IBAN. Suggests only; never rejects. */
export const SAUDI_BANKS: Record<string, SaudiBank> = {
  '05': { nameEn: 'Alinma Bank', nameAr: 'مصرف الإنماء', swift: 'INMASARI' },
  '10': { nameEn: 'Saudi National Bank', nameAr: 'البنك الأهلي السعودي', swift: 'NCBKSAJE' },
  '15': { nameEn: 'Bank AlJazira', nameAr: 'بنك الجزيرة', swift: 'BJAZSAJE' },
  '20': { nameEn: 'Riyad Bank', nameAr: 'بنك الرياض', swift: 'RIBLSARI' },
  '30': { nameEn: 'Arab National Bank', nameAr: 'البنك العربي الوطني', swift: 'ARNBSARI' },
  '40': { nameEn: 'Samba (Saudi National Bank)', nameAr: 'سامبا (البنك الأهلي السعودي)', swift: 'SAMBSARI' },
  '45': { nameEn: 'Saudi Investment Bank', nameAr: 'البنك السعودي للاستثمار', swift: 'SIBCSARI' },
  '50': { nameEn: 'Alawwal Bank (SABB)', nameAr: 'البنك الأول (ساب)', swift: 'AAALSARI' },
  '55': { nameEn: 'Banque Saudi Fransi', nameAr: 'البنك السعودي الفرنسي', swift: 'BSFRSARI' },
  '60': { nameEn: 'Saudi British Bank (SABB)', nameAr: 'البنك السعودي البريطاني (ساب)', swift: 'SABBSARI' },
  '76': { nameEn: 'Bank Albilad', nameAr: 'بنك البلاد', swift: 'ALBISARI' },
  '80': { nameEn: 'Al Rajhi Bank', nameAr: 'مصرف الراجحي', swift: 'RJHISARI' },
};

/** Strips the spacing people copy off a bank statement and upper-cases. */
export function normalizeIban(raw: string | null | undefined): string {
  return String(raw ?? '').replace(/[\s\-_]+/g, '').toUpperCase();
}

/** Groups of four, the way a bank prints it — what makes a transposition visible. */
export function formatIban(raw: string | null | undefined): string {
  return normalizeIban(raw).replace(/(.{4})/g, '$1 ').trim();
}

/** ISO 13616 mod-97: rotate the first four characters to the end, A=10…Z=35, mod 97 === 1. */
export function ibanChecksumValid(raw: string | null | undefined): boolean {
  const v = normalizeIban(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{1,30}$/.test(v)) return false;
  const rearranged = v.slice(4) + v.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    const value = code >= 65 ? code - 55 : code - 48;
    remainder = value > 9 ? (remainder * 100 + value) % 97 : (remainder * 10 + value) % 97;
  }
  return remainder === 1;
}

/** Bank name + SWIFT for a Saudi IBAN, when the code is one we know. */
export function describeSaudiBank(raw: string | null | undefined): SaudiBank | null {
  const v = normalizeIban(raw);
  if (!/^SA\d{22}$/.test(v)) return null;
  return SAUDI_BANKS[v.slice(4, 6)] ?? null;
}

export interface IbanCheck {
  ok: boolean;
  normalized: string;
  error?: string;
  bank?: SaudiBank | null;
}

/** Validates an IBAN. Saudi gets the exact length rule; other countries the generic shape. */
export function checkIban(raw: string | null | undefined): IbanCheck {
  const normalized = normalizeIban(raw);
  if (!normalized) return { ok: false, normalized, error: 'Enter the IBAN that should receive payouts' };
  if (!/^[A-Z]{2}/.test(normalized)) {
    return { ok: false, normalized, error: 'An IBAN starts with a two-letter country code, e.g. SA for Saudi Arabia' };
  }
  if (normalized.startsWith('SA')) {
    if (!/^SA\d{22}$/.test(normalized)) {
      return {
        ok: false,
        normalized,
        error: `A Saudi IBAN is SA followed by 22 digits (24 characters in total); this one has ${normalized.length}`,
      };
    }
  } else if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(normalized)) {
    return { ok: false, normalized, error: 'This does not look like a valid IBAN' };
  }
  if (!ibanChecksumValid(normalized)) {
    return {
      ok: false,
      normalized,
      error: 'This IBAN fails its check-digit test, so at least one character is wrong. Compare it with the bank statement.',
    };
  }
  return { ok: true, normalized, bank: describeSaudiBank(normalized) };
}

/**
 * Whether to complain *while the operator is still typing*.
 *
 * Nothing is said until the value is long enough to judge — a half-typed IBAN is
 * invalid at every keystroke, and flagging it from character one teaches people
 * to ignore the message.
 */
export function ibanErrorWhileTyping(raw: string | null | undefined): string | null {
  const v = normalizeIban(raw);
  if (!v) return null;
  if (v.startsWith('SA') ? v.length < 24 : v.length < 15) return null;
  return checkIban(v).error ?? null;
}

export interface BankDetailsValue {
  bankName: string;
  accountHolderName: string;
  iban: string;
  accountNumber: string;
  swiftCode: string;
}

export const EMPTY_BANK_DETAILS: BankDetailsValue = {
  bankName: '',
  accountHolderName: '',
  iban: '',
  accountNumber: '',
  swiftCode: '',
};

export interface BankDetailsErrors {
  iban?: string;
  accountHolderName?: string;
}

/**
 * Whether these details can be saved, and why not.
 *
 * `require` separates the two cases honestly: the onboarding wizard and the
 * profile editors must let a half-finished form be saved and returned to, while
 * a screen whose whole purpose is the payout destination cannot save a blank.
 * In both cases a *partly* filled block is refused — a holder name with no
 * destination, or an IBAN with no name, is the form that silently fails later.
 */
export function validateBankDetails(value: BankDetailsValue, opts?: { require?: boolean }): BankDetailsErrors {
  const mustBeComplete = !!opts?.require;
  const errors: BankDetailsErrors = {};
  const iban = normalizeIban(value.iban);
  const holder = value.accountHolderName.trim();
  const hasAnything = !!(iban || holder || value.accountNumber.trim());

  if (!mustBeComplete && !hasAnything) return errors;

  if (iban) {
    const check = checkIban(iban);
    if (!check.ok) errors.iban = check.error;
  } else if (!value.accountNumber.trim()) {
    errors.iban = 'Enter an IBAN so the transfer has a destination';
  }

  if (!holder) errors.accountHolderName = 'Enter the account holder name exactly as the bank has it';

  return errors;
}

/**
 * Canonicalises for sending, and fills the bank name and SWIFT from the Saudi
 * bank code when they were left blank — the IBAN already encodes the bank, and
 * asking an operator to look up a BIC is how that field ends up wrong. Never
 * overwrites what a person actually typed.
 *
 * Returns `undefined` when there is nothing to send, which is what the profile
 * editors already pass for "no bank details".
 */
export function bankPayload(value: BankDetailsValue): BankDetailsValue | undefined {
  const iban = normalizeIban(value.iban);
  const accountNumber = value.accountNumber.trim().replace(/[\s-]+/g, '');
  if (!iban && !accountNumber) return undefined;

  const detected = describeSaudiBank(iban);
  return {
    bankName: value.bankName.trim() || detected?.nameEn || '',
    accountHolderName: value.accountHolderName.trim().replace(/\s+/g, ' '),
    iban,
    accountNumber,
    swiftCode: normalizeIban(value.swiftCode) || detected?.swift || '',
  };
}
