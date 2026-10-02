import React from 'react';
import { ChevronDown, Search, Star, X } from 'lucide-react';
import { parseDecimal, parseInteger } from '../utils/typeSystem';
import { useMarinaOptional } from '../live';
import { translatePortalText } from '../i18n/runtime'


// ---------------------------------------------------------------------------
// Semantic form controls.
//
// One control per *meaning*, not per HTML input type. The point is that a field
// declares what its value is — an integer, a price, a calendar date, an entity
// reference — and the control then owns the correct input affordance, the correct
// mobile keyboard, the parse back to a real JS type, and the empty-vs-zero
// distinction. Screens stop hand-rolling `Number(e.target.value)` (which turns a
// cleared field into 0) and stop asking users to type dates as text.
//
// Conventions that hold across every control here:
//
//  · Blank means **null**, never 0 (§26). `Number('')` is 0, and a cleared
//    "engine count" must not be stored as zero engines.
//  · The stored value is unformatted. Currency is a plain number; a `﷼` prefix
//    is drawn beside the input, never merged into the value (§28).
//  · A date-only field is a `YYYY-MM-DD` **string**, never a `Date` — a `Date`
//    for "11 Aug 2026" is midnight UTC, which renders as 10 Aug west of
//    Greenwich (§9).
//  · Typing is never fought (§27). Numeric controls keep a local text buffer, so
//    a half-typed "12." or "-" or "0." survives; the parsed value is reported
//    alongside it, and the buffer is only re-synced from props when the *number*
//    actually changed elsewhere.
//  · Styling reuses the portal's existing `.input` / `.label` utilities from
//    index.css, so these match every other field in the app (§34 — no redesign).
//
// -- A note on `type="number"` for decimals --------------------------------
// Integer and year controls use `type="number"`. Decimal, currency and
// percentage controls deliberately use `type="text"` with
// `inputMode="decimal"`, which still raises the numeric keypad on mobile but
// avoids `<input type=number>`'s intermediate-state behaviour: while a user is
// partway through typing "12." or "-", browsers report `.value` as `''`, and
// echoing that back erases what they typed. §27 explicitly forbids
// "disappearing decimal points" and "inability to type 0.5", so the behavioural
// guarantee wins over the tag name. Digits are still enforced, and the value
// handed to `onChange` is a real number.
// ---------------------------------------------------------------------------

let fieldSeq = 0;
const useFieldId = (provided?: string) => {
  const [generated] = React.useState(() => `f${++fieldSeq}`);
  return provided ?? generated;
};

// ── shared shell ───────────────────────────────────────────────
interface FieldShellProps {
  id: string;
  label?: string;
  error?: string;
  helper?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}

/**
 * Label + control + message, wired for accessibility.
 *
 * The error is `role="alert"` and referenced by `aria-describedby`, so a screen
 * reader hears why the field was rejected rather than only seeing a red border
 * (§28 — never rely on colour alone). Inline messages are used for field-level
 * validation; toasts are for operation outcomes (§36).
 */
function FieldShell({ id, label, error, helper, required, children, className = '' }: FieldShellProps) {
  const msgId = `${id}-msg`;
  return (
    <div className={`w-full ${className}`}>
      {!!label && (
        <label htmlFor={id} className="label">
          {label ? translatePortalText(label) : label}
          {required && <span className="ms-0.5 text-rose-500">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p id={msgId} role="alert" className="mt-1 text-[11.5px] font-semibold text-rose-500">
          {error ? translatePortalText(error) : error}
        </p>
      ) : helper ? (
        <p id={msgId} className="mt-1 text-[11.5px] font-medium text-slate-400">
          {helper ? translatePortalText(helper) : helper}
        </p>
      ) : null}
    </div>
  );
}

const inputClass = (error?: string, extra = '') =>
  `input ${error ? 'border-rose-400 focus:border-rose-400 focus:ring-rose-100' : ''} ${extra}`.trim();

/** `aria-invalid` + `aria-describedby`, applied identically by every control. */
const a11y = (id: string, error?: string, helper?: string) => ({
  id,
  'aria-invalid': error ? true : undefined,
  'aria-describedby': error || helper ? `${id}-msg` : undefined,
});

/**
 * Stops the scroll wheel from silently changing a focused number input — a
 * genuine data-corruption hazard on a long form, where scrolling the page over a
 * focused price field edits it without the user noticing.
 */
const blockWheel = (e: React.WheelEvent<HTMLInputElement>) => {
  (e.target as HTMLInputElement).blur();
};

// ---------------------------------------------------------------------------
// Numeric buffer
// ---------------------------------------------------------------------------
/**
 * Keeps a text buffer beside the numeric value so partially-typed input is never
 * destroyed by a re-render.
 *
 * The buffer is re-seeded from the prop only when the incoming number differs
 * from what the buffer already parses to. Without that check, typing "12."
 * (parses to 12) would be overwritten by the parent echoing back "12" — the
 * decimal point vanishes mid-keystroke and the field becomes unusable.
 */
function useNumericBuffer(value: number | null | undefined, parse: (raw: string) => number | null) {
  const [buffer, setBuffer] = React.useState(() => (value === null || value === undefined ? '' : String(value)));
  const bufferRef = React.useRef(buffer);
  bufferRef.current = buffer;

  React.useEffect(() => {
    const parsedBuffer = parse(bufferRef.current);
    const incoming = value === null || value === undefined ? null : value;
    if (parsedBuffer !== incoming) {
      setBuffer(incoming === null ? '' : String(incoming));
    }
    // `parse` is stable per control; buffer is read via ref on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return [buffer, setBuffer] as const;
}

// ---------------------------------------------------------------------------
// IntegerField — whole numbers: capacity, cabins, engines, passenger count
// ---------------------------------------------------------------------------
export interface IntegerFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: number | null | undefined;
  onChange: (val: number | null) => void;
  label?: string;
  error?: string;
  helper?: string;
}

export const IntegerField: React.FC<IntegerFieldProps> = ({
  value,
  onChange,
  label,
  error,
  helper,
  className = '',
  required,
  id: idProp,
  min,
  max,
  ...props
}) => {
  const id = useFieldId(idProp);
  const [buffer, setBuffer] = useNumericBuffer(value, (raw) => parseInteger(raw));

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    // Allow an empty field and a lone minus sign as in-progress states.
    if (raw === '' || raw === '-') {
      setBuffer(raw);
      onChange(null);
      return;
    }
    if (!/^-?\d+$/.test(raw)) return; // reject stray characters without clobbering
    setBuffer(raw);
    onChange(parseInteger(raw));
  };

  return (
    <FieldShell id={id} label={label} error={error} helper={helper} required={required} className={className}>
      <input
        {...a11y(id, error, helper)}
        type="number"
        inputMode="numeric"
        step={1}
        min={min}
        max={max}
        value={buffer}
        onChange={handleChange}
        onWheel={blockWheel}
        required={required}
        className={inputClass(error)}
        {...props}
      />
    </FieldShell>
  );
};

// ---------------------------------------------------------------------------
// DecimalField — measurements: length, beam, draft, weight, engine power
// ---------------------------------------------------------------------------
export interface DecimalFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: number | null | undefined;
  onChange: (val: number | null) => void;
  label?: string;
  error?: string;
  helper?: string;
  /** Rendered inside the field's trailing edge — "ft", "m", "kg", "L". */
  unit?: string;
}

/** Accepts an in-progress decimal: '', '-', '12.', '.5', '-0.'. */
const PARTIAL_DECIMAL = /^-?(\d+\.?\d*|\.\d*)?$/;

export const DecimalField: React.FC<DecimalFieldProps> = ({
  value,
  onChange,
  label,
  error,
  helper,
  unit,
  className = '',
  required,
  id: idProp,
  ...props
}) => {
  const id = useFieldId(idProp);
  const [buffer, setBuffer] = useNumericBuffer(value, (raw) => parseDecimal(raw));

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.trim();
    if (!PARTIAL_DECIMAL.test(raw)) return; // ignore invalid keystroke, keep buffer
    setBuffer(raw);
    // '', '-', '.' and '12.' are not yet numbers — report null rather than
    // guessing, but leave the buffer showing what was typed.
    onChange(parseDecimal(raw));
  };

  return (
    <FieldShell id={id} label={label} error={error} helper={helper} required={required} className={className}>
      <div className="relative flex items-center">
        <input
          {...a11y(id, error, helper)}
          // See the header note: text + inputMode keeps the numeric keypad while
          // letting a half-typed "12." survive.
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={buffer}
          onChange={handleChange}
          required={required}
          className={inputClass(error, unit ? 'pe-12' : '')}
          {...props}
        />
        {!!unit && (
          <span className="pointer-events-none absolute end-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">
            {unit}
          </span>
        )}
      </div>
    </FieldShell>
  );
};

// ---------------------------------------------------------------------------
// CurrencyField — prices, deposits, fees, refunds
// ---------------------------------------------------------------------------
export interface CurrencyFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: number | null | undefined;
  onChange: (val: number | null) => void;
  /**
   * Defaults to the operator's own marina currency, not a hardcoded symbol.
   * (This previously defaulted to `₹` in a portal that prices in SAR.)
   */
  currency?: string;
  label?: string;
  error?: string;
  helper?: string;
}

export const CurrencyField: React.FC<CurrencyFieldProps> = ({
  value,
  onChange,
  currency,
  label,
  error,
  helper,
  className = '',
  required,
  id: idProp,
  ...props
}) => {
  const id = useFieldId(idProp);
  const marina = useMarinaOptional();
  const code = currency ?? marina?.currency ?? 'SAR';
  const [buffer, setBuffer] = useNumericBuffer(value, (raw) => parseDecimal(raw));

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Tolerate a pasted "﷼ 25,000": separators and symbols are presentation and
    // must never reach the stored value.
    const raw = e.target.value.replace(/[^\d.-]/g, '');
    if (!PARTIAL_DECIMAL.test(raw)) return;
    setBuffer(raw);
    onChange(parseDecimal(raw));
  };

  return (
    <FieldShell id={id} label={label} error={error} helper={helper} required={required} className={className}>
      <div className="relative flex items-center">
        <span className="pointer-events-none absolute start-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">
          {code}
        </span>
        <input
          {...a11y(id, error, helper)}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={buffer}
          onChange={handleChange}
          required={required}
          className={inputClass(error, 'ps-12')}
          {...props}
        />
      </div>
    </FieldShell>
  );
};

// ---------------------------------------------------------------------------
// PercentageField — VAT, commission, discount
// ---------------------------------------------------------------------------
export interface PercentageFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  /** Whole-number form: `15` means 15%. This is the app-wide convention (§8). */
  value: number | null | undefined;
  onChange: (val: number | null) => void;
  label?: string;
  error?: string;
  helper?: string;
  max?: number;
}

export const PercentageField: React.FC<PercentageFieldProps> = ({
  value,
  onChange,
  label,
  error,
  helper,
  max = 100,
  className = '',
  required,
  id: idProp,
  ...props
}) => {
  const id = useFieldId(idProp);
  const [buffer, setBuffer] = useNumericBuffer(value, (raw) => parseDecimal(raw));

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/%\s*$/, '').trim();
    if (!PARTIAL_DECIMAL.test(raw)) return;
    setBuffer(raw);
    const parsed = parseDecimal(raw);
    // Clamp on commit rather than mid-keystroke, so typing "100" does not get
    // truncated to "10" the moment the second character lands.
    onChange(parsed === null ? null : Math.min(Math.max(parsed, 0), max));
  };

  return (
    <FieldShell id={id} label={label} error={error} helper={helper} required={required} className={className}>
      <div className="relative flex items-center">
        <input
          {...a11y(id, error, helper)}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={buffer}
          onChange={handleChange}
          required={required}
          className={inputClass(error, 'pe-8')}
          {...props}
        />
        <span className="pointer-events-none absolute end-3 text-[12px] font-bold text-slate-400">%</span>
      </div>
    </FieldShell>
  );
};

// ---------------------------------------------------------------------------
// SwitchField / CheckboxField — booleans
// ---------------------------------------------------------------------------
export interface SwitchFieldProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  className?: string;
}

/** A real `role="switch"`, producing `true`/`false` — never `"true"`/`"yes"`/`1`. */
export const SwitchField: React.FC<SwitchFieldProps> = ({
  checked,
  onChange,
  label,
  description,
  disabled,
  className = '',
}) => {
  const id = useFieldId();
  return (
    <div className={`flex items-center justify-between gap-3 ${disabled ? 'opacity-50' : ''} ${className}`}>
      {(label || description) && (
        <div className="flex flex-col">
          {!!label && (
            <label htmlFor={id} className="text-[13px] font-semibold text-deep-900">
              {translatePortalText(label)}
            </label>
          )}
          {!!description && <span className="text-[11.5px] font-medium text-slate-500">{translatePortalText(description)}</span>}
        </div>
      )}
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label ? translatePortalText(label) : undefined}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-4 focus-visible:ring-ocean-100 ${
          checked ? 'bg-emerald-500' : 'bg-slate-200'
        } ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200 ${
            checked ? 'translate-x-[22px]' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
};

export const CheckboxField: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  className?: string;
}> = ({ checked, onChange, label, description, disabled, className = '' }) => {
  const id = useFieldId();
  return (
    <div className={`flex items-start gap-2.5 ${className}`}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-ocean-500 focus:ring-ocean-200"
      />
      <div className="flex flex-col">
        <label htmlFor={id} className="text-[13px] font-semibold text-deep-900">
          {translatePortalText(label)}
        </label>
        {!!description && <span className="text-[11.5px] font-medium text-slate-500">{translatePortalText(description)}</span>}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// DateField / DateTimeField / TimeField / MonthField
// ---------------------------------------------------------------------------
export interface DateFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  /** `YYYY-MM-DD`. A datetime is accepted and truncated to its date part. */
  value: string | null | undefined;
  onChange: (iso: string) => void;
  label?: string;
  error?: string;
  helper?: string;
}

/**
 * A real date picker producing a `YYYY-MM-DD` string.
 *
 * Kept as a string on purpose: a date-only value has no time and no zone, and
 * routing it through `new Date()` shifts the day for anyone west of Greenwich.
 */
export const DateField: React.FC<DateFieldProps> = ({
  value,
  onChange,
  label,
  error,
  helper,
  className = '',
  required,
  id: idProp,
  ...props
}) => {
  const id = useFieldId(idProp);
  const cleanVal = value ? String(value).slice(0, 10) : '';
  return (
    <FieldShell id={id} label={label} error={error} helper={helper} required={required} className={className}>
      <input
        {...a11y(id, error, helper)}
        type="date"
        value={cleanVal}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className={inputClass(error)}
        {...props}
      />
    </FieldShell>
  );
};

/**
 * An exact point in time. Emits a full ISO-8601 string *with* the local offset,
 * so the instant survives the trip to the server (§10) instead of being
 * reinterpreted as UTC.
 */
export const DateTimeField: React.FC<{
  value: string | null | undefined;
  onChange: (iso: string) => void;
  label?: string;
  error?: string;
  helper?: string;
  className?: string;
  required?: boolean;
  min?: string;
  max?: string;
  disabled?: boolean;
}> = ({ value, onChange, label, error, helper, className = '', required, min, max, disabled }) => {
  const id = useFieldId();

  // `datetime-local` wants "YYYY-MM-DDTHH:mm" in *local* time. Formatting the
  // parts by hand avoids `toISOString()`, which would convert to UTC and show
  // the wrong wall-clock time in the picker.
  const local = React.useMemo(() => {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }, [value]);

  return (
    <FieldShell id={id} label={label} error={error} helper={helper} required={required} className={className}>
      <input
        {...a11y(id, error, helper)}
        type="datetime-local"
        value={local}
        min={min}
        max={max}
        required={required}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.target.value;
          if (!raw) {
            onChange('');
            return;
          }
          // `new Date('2026-08-11T22:30')` is parsed as local time, and
          // `toISOString()` then carries the correct instant in UTC.
          const d = new Date(raw);
          onChange(Number.isNaN(d.getTime()) ? '' : d.toISOString());
        }}
        className={inputClass(error)}
      />
    </FieldShell>
  );
};

/** A wall-clock time as `HH:mm` — opening hours, check-in/out, departures. */
export const TimeField: React.FC<{
  value: string | null | undefined;
  onChange: (hhmm: string) => void;
  label?: string;
  error?: string;
  helper?: string;
  className?: string;
  required?: boolean;
  step?: number;
  disabled?: boolean;
}> = ({ value, onChange, label, error, helper, className = '', required, step, disabled }) => {
  const id = useFieldId();
  // Normalise "9:05" → "09:05" so the native control accepts it and so string
  // comparison orders times correctly.
  const clean = React.useMemo(() => {
    if (!value) return '';
    const m = String(value).match(/^(\d{1,2}):(\d{2})/);
    return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
  }, [value]);

  return (
    <FieldShell id={id} label={label} error={error} helper={helper} required={required} className={className}>
      <input
        {...a11y(id, error, helper)}
        type="time"
        value={clean}
        step={step}
        required={required}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass(error)}
      />
    </FieldShell>
  );
};

/** A `YYYY-MM` month key — reporting periods, calendar navigation. */
export const MonthField: React.FC<{
  value: string | null | undefined;
  onChange: (month: string) => void;
  label?: string;
  error?: string;
  helper?: string;
  className?: string;
  min?: string;
  max?: string;
}> = ({ value, onChange, label, error, helper, className = '', min, max }) => {
  const id = useFieldId();
  return (
    <FieldShell id={id} label={label} error={error} helper={helper} className={className}>
      <input
        {...a11y(id, error, helper)}
        type="month"
        value={value ? String(value).slice(0, 7) : ''}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass(error)}
      />
    </FieldShell>
  );
};

/**
 * YearField — a year as a number.
 *
 * A plain number input rather than a date picker: "year built" is a year, and a
 * full calendar picker would force the user to invent a month and a day.
 */
export interface YearFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: number | string | null | undefined;
  onChange: (year: number | null) => void;
  label?: string;
  error?: string;
  helper?: string;
}

export const YearField: React.FC<YearFieldProps> = ({
  value,
  onChange,
  label,
  error,
  helper,
  className = '',
  required,
  id: idProp,
  ...props
}) => {
  const id = useFieldId(idProp);
  const numeric = value === null || value === undefined || value === '' ? null : Number(value);
  const [buffer, setBuffer] = useNumericBuffer(Number.isFinite(numeric as number) ? (numeric as number) : null, (raw) =>
    parseInteger(raw)
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (raw === '') {
      setBuffer('');
      onChange(null);
      return;
    }
    if (!/^\d{0,4}$/.test(raw)) return;
    setBuffer(raw);
    // Only commit a plausible 4-digit year; "20" mid-typing must not be stored.
    onChange(raw.length === 4 ? parseInteger(raw) : null);
  };

  return (
    <FieldShell id={id} label={label} error={error} helper={helper} required={required} className={className}>
      <input
        {...a11y(id, error, helper)}
        type="number"
        inputMode="numeric"
        step={1}
        min={1800}
        max={new Date().getFullYear() + 2}
        placeholder="2019"
        value={buffer}
        onChange={handleChange}
        onWheel={blockWheel}
        required={required}
        className={inputClass(error)}
        {...props}
      />
    </FieldShell>
  );
};

// ---------------------------------------------------------------------------
// SelectField / SegmentedField — enums
// ---------------------------------------------------------------------------
export interface Option<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

/**
 * A dropdown over a controlled value set.
 *
 * The UI shows `label`, the app stores `value` — so "Sailing Boat" is displayed
 * while `"sailing_boat"` is what reaches the database (§13). Never store the
 * user-facing label.
 */
export function SelectField<T extends string = string>({
  value,
  onChange,
  options,
  label,
  error,
  helper,
  placeholder = 'Select…',
  className = '',
  required,
  disabled,
  allowEmpty = true,
}: {
  value: T | null | undefined;
  onChange: (val: T | null) => void;
  options: readonly Option<T>[];
  label?: string;
  error?: string;
  helper?: string;
  placeholder?: string;
  className?: string;
  required?: boolean;
  disabled?: boolean;
  allowEmpty?: boolean;
}) {
  const id = useFieldId();
  return (
    <FieldShell id={id} label={label} error={error} helper={helper} required={required} className={className}>
      <div className="relative flex items-center">
        <select
          {...a11y(id, error, helper)}
          value={value ?? ''}
          required={required}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value === '' ? null : (e.target.value as T))}
          className={inputClass(error, 'appearance-none pe-9')}
        >
          {allowEmpty && <option value="">{translatePortalText(placeholder)}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {translatePortalText(o.label)}
            </option>
          ))}
        </select>
        <ChevronDown size={15} className="pointer-events-none absolute end-3 text-slate-400" />
      </div>
    </FieldShell>
  );
}

/** Chip/segmented picker — for 2–5 options where the choices are worth showing. */
export function SegmentedField<T extends string = string>({
  value,
  onChange,
  options,
  label,
  error,
  helper,
  className = '',
  disabled,
}: {
  value: T | null | undefined;
  onChange: (val: T) => void;
  options: readonly Option<T>[];
  label?: string;
  error?: string;
  helper?: string;
  className?: string;
  disabled?: boolean;
}) {
  const id = useFieldId();
  return (
    <FieldShell id={id} label={label} error={error} helper={helper} className={className}>
      <div role="radiogroup" aria-label={label ? translatePortalText(label) : undefined} className="flex flex-wrap gap-2">
        {options.map((o) => {
          const active = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled || o.disabled}
              onClick={() => onChange(o.value)}
              className={`rounded-lg border px-3 py-1.5 text-[12.5px] font-bold transition-all disabled:opacity-40 ${
                active
                  ? 'border-ocean-400 bg-ocean-50 text-ocean-700 shadow-soft'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-ocean-200 hover:bg-sand'
              }`}
            >
              {translatePortalText(o.label)}
            </button>
          );
        })}
      </div>
    </FieldShell>
  );
}

/**
 * MultiSelectField — produces an **array**, never a joined string.
 *
 * Amenities are `['wifi','kitchen','toilet']`; asking a user to type
 * "wifi,kitchen,toilet" is exactly what §15 and the smart-input rule forbid.
 */
export function MultiSelectField<T extends string = string>({
  value,
  onChange,
  options,
  label,
  error,
  helper,
  className = '',
  disabled,
  max,
}: {
  value: readonly T[] | null | undefined;
  onChange: (val: T[]) => void;
  options: readonly Option<T>[];
  label?: string;
  error?: string;
  helper?: string;
  className?: string;
  disabled?: boolean;
  max?: number;
}) {
  const id = useFieldId();
  const selected = value ?? [];

  const toggle = (v: T) => {
    if (selected.includes(v)) {
      onChange(selected.filter((s) => s !== v));
      return;
    }
    if (max !== undefined && selected.length >= max) return;
    onChange([...selected, v]);
  };

  return (
    <FieldShell
      id={id}
      label={label}
      error={error}
      helper={helper ?? (max ? `Choose up to ${max}` : undefined)}
      className={className}
    >
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const active = selected.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              role="checkbox"
              aria-checked={active}
              disabled={disabled || o.disabled || (!active && max !== undefined && selected.length >= max)}
              onClick={() => toggle(o.value)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-bold transition-all disabled:opacity-40 ${
                active
                  ? 'border-ocean-400 bg-ocean-50 text-ocean-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-ocean-200 hover:bg-sand'
              }`}
            >
              {translatePortalText(o.label)}
              {active && <X size={11} />}
            </button>
          );
        })}
      </div>
    </FieldShell>
  );
}

// ---------------------------------------------------------------------------
// Text-ish fields
// ---------------------------------------------------------------------------
export const TextField: React.FC<
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
    value: string | null | undefined;
    onChange: (val: string) => void;
    label?: string;
    error?: string;
    helper?: string;
    /** Trim on blur rather than while typing, so a mid-word space survives. */
    trimOnBlur?: boolean;
  }
> = ({ value, onChange, label, error, helper, className = '', required, trimOnBlur = true, id: idProp, ...props }) => {
  const id = useFieldId(idProp);
  const { placeholder, title, 'aria-label': ariaLabel, ...inputProps } = props;
  return (
    <FieldShell id={id} label={label} error={error} helper={helper} required={required} className={className}>
      <input
        {...a11y(id, error, helper)}
        type="text"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => {
          if (trimOnBlur && e.target.value !== e.target.value.trim()) onChange(e.target.value.trim());
        }}
        required={required}
        className={inputClass(error)}
        placeholder={placeholder ? translatePortalText(placeholder) : placeholder}
        title={title ? translatePortalText(title) : title}
        aria-label={ariaLabel ? translatePortalText(ariaLabel) : ariaLabel}
        {...inputProps}
      />
    </FieldShell>
  );
};

export const TextAreaField: React.FC<
  Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
    value: string | null | undefined;
    onChange: (val: string) => void;
    label?: string;
    error?: string;
    helper?: string;
    /** Shows a live "123 / 500" counter. */
    maxLength?: number;
  }
> = ({ value, onChange, label, error, helper, className = '', required, maxLength, rows = 3, id: idProp, ...props }) => {
  const id = useFieldId(idProp);
  const { placeholder, title, 'aria-label': ariaLabel, ...textareaProps } = props;
  const len = (value ?? '').length;
  return (
    <FieldShell
      id={id}
      label={label}
      error={error}
      helper={helper ?? (maxLength ? `${len} / ${maxLength}` : undefined)}
      required={required}
      className={className}
    >
      <textarea
        {...a11y(id, error, helper)}
        value={value ?? ''}
        rows={rows}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className={inputClass(error, 'resize-y')}
        placeholder={placeholder ? translatePortalText(placeholder) : placeholder}
        title={title ? translatePortalText(title) : title}
        aria-label={ariaLabel ? translatePortalText(ariaLabel) : ariaLabel}
        {...textareaProps}
      />
    </FieldShell>
  );
};

export const EmailField: React.FC<{
  value: string | null | undefined;
  onChange: (val: string) => void;
  label?: string;
  error?: string;
  helper?: string;
  className?: string;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
}> = ({ value, onChange, label, error, helper, className = '', required, placeholder, disabled }) => {
  const id = useFieldId();
  return (
    <FieldShell id={id} label={label} error={error} helper={helper} required={required} className={className}>
      <input
        {...a11y(id, error, helper)}
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        value={value ?? ''}
        placeholder={placeholder ? translatePortalText(placeholder) : undefined}
        required={required}
        disabled={disabled}
        // Lower-cased on blur: addresses are case-insensitive in practice, and a
        // stray capital is a common cause of "no account found".
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onChange(e.target.value.trim().toLowerCase())}
        className={inputClass(error)}
      />
    </FieldShell>
  );
};

/**
 * A phone number, kept as a **string**.
 *
 * Never numeric (§18): leading zeros are meaningful, `+` is part of the country
 * code, and `Number('+966 50 123 4567')` is `NaN`.
 */
export const PhoneField: React.FC<{
  value: string | null | undefined;
  onChange: (val: string) => void;
  label?: string;
  error?: string;
  helper?: string;
  className?: string;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
}> = ({ value, onChange, label, error, helper, className = '', required, placeholder = '+966 5X XXX XXXX', disabled }) => {
  const id = useFieldId();
  return (
    <FieldShell id={id} label={label} error={error} helper={helper} required={required} className={className}>
      <input
        {...a11y(id, error, helper)}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={value ?? ''}
        placeholder={translatePortalText(placeholder)}
        required={required}
        disabled={disabled}
        // Permit digits, spaces and the usual separators; block letters so a
        // typo cannot become an unreachable number.
        onChange={(e) => onChange(e.target.value.replace(/[^\d+\s()\-.]/g, ''))}
        className={inputClass(error)}
      />
    </FieldShell>
  );
};

export const UrlField: React.FC<{
  value: string | null | undefined;
  onChange: (val: string) => void;
  label?: string;
  error?: string;
  helper?: string;
  className?: string;
  required?: boolean;
  placeholder?: string;
}> = ({ value, onChange, label, error, helper, className = '', required, placeholder = 'https://…' }) => {
  const id = useFieldId();
  return (
    <FieldShell id={id} label={label} error={error} helper={helper} required={required} className={className}>
      <input
        {...a11y(id, error, helper)}
        type="url"
        inputMode="url"
        autoCapitalize="none"
        spellCheck={false}
        value={value ?? ''}
        placeholder={translatePortalText(placeholder)}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => {
          // A bare "example.com" is not a URL; assume https rather than failing
          // validation on something the user clearly meant.
          const v = e.target.value.trim();
          if (v && !/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) onChange(`https://${v}`);
        }}
        className={inputClass(error)}
      />
    </FieldShell>
  );
};

// ---------------------------------------------------------------------------
// RatingField — stars, not a typed number
// ---------------------------------------------------------------------------
export const RatingField: React.FC<{
  value: number | null | undefined;
  onChange: (val: number | null) => void;
  label?: string;
  error?: string;
  helper?: string;
  max?: number;
  className?: string;
  disabled?: boolean;
}> = ({ value, onChange, label, error, helper, max = 5, className = '', disabled }) => {
  const id = useFieldId();
  const current = value ?? 0;
  return (
    <FieldShell id={id} label={label} error={error} helper={helper} className={className}>
      <div role="radiogroup" aria-label={translatePortalText(label ?? 'Rating')} className="flex items-center gap-1">
        {Array.from({ length: max }).map((_, i) => {
          const star = i + 1;
          const filled = star <= current;
          return (
            <button
              key={star}
              type="button"
              role="radio"
              aria-checked={current === star}
              aria-label={translatePortalText(`${star} of ${max}`)}
              disabled={disabled}
              // Clicking the current rating clears it, so a mis-tap is recoverable.
              onClick={() => onChange(current === star ? null : star)}
              className="p-0.5 transition-transform hover:scale-110 disabled:opacity-40"
            >
              <Star
                size={20}
                className={filled ? 'fill-amber-700 text-amber-700 dark:fill-amber-400 dark:text-amber-400' : 'text-slate-400'}
                strokeWidth={2}
              />
            </button>
          );
        })}
        {current > 0 && <span className="ms-1.5 text-[12px] font-bold text-slate-500">{current}</span>}
      </div>
    </FieldShell>
  );
};

// ---------------------------------------------------------------------------
// EntitySelect — a reference to another record
// ---------------------------------------------------------------------------
export interface EntityOption {
  id: string;
  label: string;
  sublabel?: string;
}

/**
 * Searchable picker over existing records — boat, owner, marina, captain, berth.
 *
 * Displays the human-readable name, stores the **id** (§14). This is what stops
 * a display name being submitted where an ObjectId is expected, and means nobody
 * is ever asked to type a database id by hand.
 */
export const EntitySelect: React.FC<{
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  options: readonly EntityOption[];
  label?: string;
  error?: string;
  helper?: string;
  placeholder?: string;
  className?: string;
  required?: boolean;
  disabled?: boolean;
  /** Set while the option list is being fetched, so the field says so. */
  loading?: boolean;
  emptyText?: string;
}> = ({
  value,
  onChange,
  options,
  label,
  error,
  helper,
  placeholder = 'Search…',
  className = '',
  required,
  disabled,
  loading,
  emptyText = 'No matches',
}) => {
  const id = useFieldId();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const wrapRef = React.useRef<HTMLDivElement | null>(null);

  const selected = options.find((o) => o.id === value) ?? null;

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 50);
    return options
      .filter((o) => o.label.toLowerCase().includes(q) || (o.sublabel ?? '').toLowerCase().includes(q))
      .slice(0, 50);
  }, [options, query]);

  // Close on outside click / Escape, so the panel never strands the page.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <FieldShell id={id} label={label} error={error} helper={helper} required={required} className={className}>
      <div ref={wrapRef} className="relative">
        <button
          {...a11y(id, error, helper)}
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className={`${inputClass(error)} flex items-center justify-between gap-2 text-left disabled:opacity-50`}
        >
          <span className={selected ? 'truncate font-semibold text-deep-900' : 'truncate text-slate-400'}>
            {selected ? selected.label : loading ? translatePortalText('Loading…') : translatePortalText(placeholder)}
          </span>
          <ChevronDown size={15} className="shrink-0 text-slate-400" />
        </button>

        {/* Clearing is a separate affordance so selecting and unselecting are
            not the same click target. */}
        {!!selected && !disabled && (
          <button
            type="button"
            aria-label={translatePortalText("Clear selection")}
            onClick={() => {
              onChange(null);
              setQuery('');
            }}
            className="absolute end-8 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"
          >
            <X size={13} />
          </button>
        )}

        {open && (
          <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lift">
            <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
              <Search size={13} className="shrink-0 text-slate-400" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={translatePortalText(placeholder)}
                className="w-full bg-transparent text-[13px] outline-none placeholder:text-slate-400"
              />
            </div>
            <ul role="listbox" className="max-h-56 overflow-y-auto py-1">
              {loading ? (
                <li className="px-3 py-3 text-[12px] font-semibold text-slate-400">{translatePortalText("Loading…")}</li>
              ) : filtered.length === 0 ? (
                <li className="px-3 py-3 text-[12px] font-semibold text-slate-400">{translatePortalText(emptyText)}</li>
              ) : (
                filtered.map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={o.id === value}
                      onClick={() => {
                        onChange(o.id);
                        setOpen(false);
                        setQuery('');
                      }}
                      className={`flex w-full flex-col items-start px-3 py-2 text-left transition hover:bg-sand ${
                        o.id === value ? 'bg-ocean-50' : ''
                      }`}
                    >
                      <span className="text-[13px] font-semibold text-deep-900">{o.label}</span>
                      {!!o.sublabel && <span className="text-[11px] font-medium text-slate-400">{o.sublabel}</span>}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
      </div>
    </FieldShell>
  );
};
