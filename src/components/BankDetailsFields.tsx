import { useState } from 'react'
import { CheckCircle2 } from 'lucide-react'

import {
  checkIban,
  describeSaudiBank,
  formatIban,
  ibanErrorWhileTyping,
  normalizeIban,
  type BankDetailsErrors,
  type BankDetailsValue,
} from '../utils/iban'
import { translatePortalText } from '../i18n/runtime'


/**
 * The bank-account fields, in one component all four portal screens share.
 *
 * They used to be four hand-rolled copies — marina onboarding, the fuel and
 * workshop profile editors, and the admin money screen — none of which checked
 * the IBAN. That matters more than it looks: `resolvePayoutBank` on the API falls
 * back to the bank details stored on the *asset*, so an IBAN typed into a fuel
 * station's profile can become the destination of a real transfer without ever
 * passing through a screen that validated it.
 *
 * Validation, grouping-as-you-type and bank auto-detection therefore live here
 * once, and every screen gets them by construction.
 */

export interface BankDetailsFieldsProps {
  value: BankDetailsValue
  onChange: (next: BankDetailsValue) => void
  /** Submit-time messages from `validateBankDetails`. */
  errors?: BankDetailsErrors
  /** Shows the SWIFT/BIC input — wanted where international wires are a case. */
  showSwift?: boolean
  /** Shows the account-number input, for banks that issue no IBAN. */
  showAccountNumber?: boolean
}

export function BankDetailsFields({
  value,
  onChange,
  errors,
  showSwift = true,
  showAccountNumber = false,
}: BankDetailsFieldsProps) {
  const [ibanTouched, setIbanTouched] = useState(false)

  const bank = describeSaudiBank(value.iban)
  const ibanOk = !!value.iban && checkIban(value.iban).ok
  // The submit-time error wins: that is the one the operator already tried to
  // move past, so it must not be replaced by the softer while-typing rule.
  const ibanError = errors?.iban ?? (ibanTouched ? ibanErrorWhileTyping(value.iban) : null)

  /**
   * Typing the IBAN.
   *
   * Normalised on the way in — a paste off a bank statement arrives spaced, and
   * lower case is common — with the bank name and SWIFT derived from the bank
   * code as soon as it is recognisable. Both only where the operator has not
   * typed their own value: overwriting a human's entry from a table that may be
   * out of date is exactly backwards.
   */
  const onIban = (raw: string) => {
    const iban = normalizeIban(raw).slice(0, 34)
    const next: BankDetailsValue = { ...value, iban }
    const detected = describeSaudiBank(iban)
    const previous = describeSaudiBank(value.iban)
    if (detected) {
      // Replaced when empty or when it was itself auto-filled, so fixing a
      // mistyped digit re-derives rather than leaving the old bank behind.
      if (!next.bankName || next.bankName === previous?.nameEn) next.bankName = detected.nameEn
      if (!next.swiftCode || next.swiftCode === previous?.swift) next.swiftCode = detected.swift
    }
    onChange(next)
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="label block">{translatePortalText("IBAN")}</label>
        <input
          className={`input font-mono ${ibanError ? '!border-rose-300 !ring-rose-100' : ''}`}
          value={formatIban(value.iban)}
          onChange={(e) => onIban(e.target.value)}
          onBlur={() => setIbanTouched(true)}
          placeholder={translatePortalText("SA00 0000 0000 0000 0000 0000")}
          spellCheck={false}
          autoComplete="off"
          maxLength={42}
        />
        {ibanError ? (
          <p className="mt-1 text-[11px] font-semibold text-rose-500">{translatePortalText(ibanError)}</p>
        ) : ibanOk ? (
          /* Confirmation the digits landed as intended: the IBAN itself is
             unreadable at a glance, but a bank name is something the operator
             recognises as right or wrong immediately. */
          <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
            <CheckCircle2 size={12} />
            {bank ? `${translatePortalText('Recognised as')} ${bank.nameEn}` : translatePortalText('Valid IBAN — add the bank name')}
          </p>
        ) : null}
      </div>

      <div>
        <label className="label block">{translatePortalText("Account holder name")}</label>
        <input
          className={`input ${errors?.accountHolderName ? '!border-rose-300 !ring-rose-100' : ''}`}
          value={value.accountHolderName}
          onChange={(e) => onChange({ ...value, accountHolderName: e.target.value })}
          placeholder={translatePortalText("Name exactly as the bank has it")}
          maxLength={150}
        />
        {errors?.accountHolderName ? (
          <p className="mt-1 text-[11px] font-semibold text-rose-500">{translatePortalText(errors.accountHolderName)}</p>
        ) : (
          <p className="mt-1 text-[11px] text-slate-400">
            {translatePortalText("Must match the IBAN, or the bank will return the transfer.\r\n          ")}</p>
        )}
      </div>

      <div>
        <label className="label block">{translatePortalText("Bank name")}</label>
        <input
          className="input"
          value={value.bankName}
          onChange={(e) => onChange({ ...value, bankName: e.target.value })}
          placeholder={translatePortalText("e.g. Al Rajhi Bank")}
          maxLength={150}
        />
      </div>

      {showSwift && (
        <div>
          <label className="label block">{translatePortalText("SWIFT / BIC (optional)")}</label>
          <input
            className="input font-mono"
            value={value.swiftCode}
            onChange={(e) => onChange({ ...value, swiftCode: normalizeIban(e.target.value) })}
            placeholder={translatePortalText("e.g. RJHISARI")}
            spellCheck={false}
            autoComplete="off"
            maxLength={20}
          />
          {value.swiftCode && value.swiftCode === bank?.swift && (
            <p className="mt-1 text-[11px] text-slate-400">
              {translatePortalText("Filled in from the IBAN. Edit it if the bank said otherwise.\r\n            ")}</p>
          )}
        </div>
      )}

      {showAccountNumber && (
        <div>
          <label className="label block">{translatePortalText("Account number (optional)")}</label>
          <input
            className="input font-mono"
            value={value.accountNumber}
            onChange={(e) => onChange({ ...value, accountNumber: e.target.value })}
            spellCheck={false}
            autoComplete="off"
            maxLength={60}
          />
        </div>
      )}
    </div>
  )
}
