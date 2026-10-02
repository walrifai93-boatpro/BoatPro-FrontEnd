import React, { useCallback, useMemo, useRef, useState } from 'react'
import { fieldErrors as extractFieldErrors, errorMessage } from '../async'
import { translatePortalText } from '../i18n/runtime'

/**
 * Field-level error reporting for every form in the portal.
 *
 * The backend has always sent the information needed to do this properly. Zod
 * validation failures come back as `errors: [{ field, message }]`, and
 * `fieldErrors()` has been able to turn that into `{ field: message }` since it
 * was written — but nothing called it. Every form caught the error, passed
 * `e.message` to a toast, and dropped the field on the floor. So a marina profile
 * with a bad entrance depth showed "Number must be less than or equal to 100"
 * floating at the bottom of the screen, next to nothing, with sixteen inputs above
 * it and no indication of which one was wrong. On a long form the offending field
 * is frequently not even scrolled into view.
 *
 * This hook closes that gap and makes the behaviour uniform:
 *
 *   • the field gets a red border and an inline message directly beneath it
 *   • the first bad field is scrolled into view and focused
 *   • the toast becomes a count ("3 fields need attention") instead of one raw
 *     validator string, because the specifics now live next to the inputs
 *   • editing a field clears its error immediately, so the form stops accusing
 *     you of something you have already fixed
 *   • `aria-invalid` and `aria-describedby` are wired, so the message is announced
 *     rather than merely coloured — red alone is not a signal everyone receives
 *
 * The one rule worth stating explicitly: an error for a field this form does not
 * render must never disappear silently. `capture` reports what it could not place
 * so the caller can still surface it. Swallowing it would turn a clear rejection
 * into a save that looks like it worked.
 */

/** What `capture` did with a server error, so the caller can respond sensibly. */
export interface CaptureResult {
  /** Errors that were matched to a field on this form. */
  placed: Record<string, string>
  /**
   * Errors naming a field this form has no input for.
   *
   * These are the dangerous ones — a rejection nobody can see. The caller must
   * still show them, which is why they are returned rather than discarded.
   */
  unplaced: Record<string, string>
  /** True when at least one error was pinned to a field. */
  anyPlaced: boolean
}

export interface FormErrors {
  errors: Record<string, string>
  /** True when the named field is currently in error. */
  has: (name: string) => boolean
  /** The message for a field, if any. */
  messageFor: (name: string) => string | undefined
  /** How many fields are currently flagged. */
  count: number

  /**
   * Records client-side validation results and focuses the first offender.
   * Returns true when there was at least one error, so callers can `if (fail(...)) return`.
   */
  fail: (errs: Record<string, string | undefined>) => boolean
  /** Pulls field errors out of a rejected request. See `CaptureResult`. */
  capture: (err: unknown) => CaptureResult
  /** Clears one field, or all of them when called with no argument. */
  clear: (name?: string) => void
  /** Registers the field names this form renders, so `capture` knows what it can place. */
  register: (names: string[]) => void

  /**
   * Spread onto an input, select or textarea.
   *
   * Supplies the red styling, the accessibility wiring and the `data-field`
   * attribute the scroll-and-focus uses to find the element.
   */
  field: (name: string) => {
    'data-field': string
    'aria-invalid': boolean | undefined
    'aria-describedby': string | undefined
    className: string
  }
  /** Same as `field`, with extra classes of your own appended. */
  fieldWith: (name: string, extra: string) => ReturnType<FormErrors['field']>
}

const ERROR_CLASS = '!border-rose-400 !ring-2 !ring-rose-100 focus:!ring-rose-200'

/**
 * Brings the first bad field into view and puts the cursor in it.
 *
 * Deferred a frame because the error state has to render before the element
 * carrying `data-field` exists to be found.
 */
function focusFirst(names: string[]) {
  if (!names.length) return
  requestAnimationFrame(() => {
    for (const name of names) {
      const el = document.querySelector<HTMLElement>(`[data-field="${CSS.escape(name)}"]`)
      if (!el) continue
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      // `preventScroll` so focus does not fight the smooth scroll above.
      if (typeof (el as HTMLInputElement).focus === 'function') {
        ;(el as HTMLInputElement).focus({ preventScroll: true })
      }
      return
    }
  })
}

/**
 * Maps a backend field path to the name this form uses.
 *
 * Needed because the two are not always spelled the same: the API takes
 * `contactNumber` where a form calls it `phone`, and nested paths arrive dotted
 * (`address.city`). Without the tail fallback those errors would land nowhere.
 */
export function resolveName(path: string, rename: Record<string, string>, known: Set<string>): string | null {
  if (rename[path]) return rename[path]
  if (known.has(path)) return path

  // `address.city` → try `city`, since that is usually the input's own name.
  const tail = path.split('.').filter(Boolean).pop()
  if (tail && rename[tail]) return rename[tail]
  if (tail && known.has(tail)) return tail

  // Array indices: `docks.0.name` → `docks.name`, then `name`.
  const collapsed = path.replace(/\.\d+/g, '')
  if (rename[collapsed]) return rename[collapsed]
  if (known.has(collapsed)) return collapsed

  return null
}

export function useFormErrors(opts?: {
  /** Backend field path → this form's field name, for the ones that differ. */
  rename?: Record<string, string>
  /** Field names this form renders. Also collected automatically by `field()`. */
  fields?: string[]
}): FormErrors {
  const [errors, setErrors] = useState<Record<string, string>>({})
  const rename = opts?.rename ?? {}

  /**
   * Every field name this form has rendered.
   *
   * A ref rather than state because it is written during render by `field()` and
   * must not itself cause one. It grows as the form mounts, which is exactly when
   * `capture` needs it — by the time a request can fail, every input exists.
   */
  const known = useRef<Set<string>>(new Set(opts?.fields ?? []))

  const register = useCallback((names: string[]) => {
    names.forEach(n => known.current.add(n))
  }, [])

  const clear = useCallback((name?: string) => {
    setErrors(prev => {
      if (!name) return {}
      if (!(name in prev)) return prev
      const next = { ...prev }
      delete next[name]
      return next
    })
  }, [])

  const fail = useCallback((errs: Record<string, string | undefined>) => {
    const clean: Record<string, string> = {}
    for (const [k, v] of Object.entries(errs)) if (v) clean[k] = v
    setErrors(clean)
    focusFirst(Object.keys(clean))
    return Object.keys(clean).length > 0
  }, [])

  const capture = useCallback(
    (err: unknown): CaptureResult => {
      const raw = extractFieldErrors(err)
      const placed: Record<string, string> = {}
      const unplaced: Record<string, string> = {}

      for (const [path, message] of Object.entries(raw)) {
        const name = resolveName(path, rename, known.current)
        if (name) placed[name] = message
        else unplaced[path] = message
      }

      if (Object.keys(placed).length) {
        setErrors(placed)
        focusFirst(Object.keys(placed))
      }
      return { placed, unplaced, anyPlaced: Object.keys(placed).length > 0 }
    },
    [rename]
  )

  const field = useCallback(
    (name: string) => {
      known.current.add(name)
      const bad = !!errors[name]
      return {
        'data-field': name,
        'aria-invalid': bad || undefined,
        'aria-describedby': bad ? `err-${name}` : undefined,
        className: bad ? ERROR_CLASS : '',
      }
    },
    [errors]
  )

  const fieldWith = useCallback(
    (name: string, extra: string) => {
      const base = field(name)
      return { ...base, className: `${extra} ${base.className}`.trim() }
    },
    [field]
  )

  return useMemo(
    () => ({
      errors,
      has: (name: string) => !!errors[name],
      messageFor: (name: string) => errors[name],
      count: Object.keys(errors).length,
      fail,
      capture,
      clear,
      register,
      field,
      fieldWith,
    }),
    [errors, fail, capture, clear, register, field, fieldWith]
  )
}

/**
 * The message under a field.
 *
 * `role="alert"` so a screen reader announces it when it appears, and the id
 * matches the `aria-describedby` that `field()` sets.
 */
export function FieldError({ errors, name }: { errors: FormErrors; name: string }) {
  const message = errors.messageFor(name)
  if (!message) return null
  return (
    <p id={`err-${name}`} role="alert" className="mt-1 flex items-start gap-1 text-xs font-semibold text-rose-500">
      <span aria-hidden="true">⚠</span>
      <span>{translatePortalText(message)}</span>
    </p>
  )
}

/**
 * A summary banner for forms long enough that the bad field may be off-screen.
 *
 * Each entry is a button that jumps to its field, which is the difference between
 * "something is wrong somewhere" and "here, this one".
 */
export function FormErrorSummary({
  errors,
  labels = {},
  className = '',
}: {
  errors: FormErrors
  /** Field name → human label, so the summary does not read like a schema. */
  labels?: Record<string, string>
  className?: string
}) {
  const entries = Object.entries(errors.errors)
  if (!entries.length) return null
  return (
    <div
      role="alert"
      className={`mb-4 rounded-2xl border border-rose-200 bg-rose-50 p-3.5 ${className}`}
    >
      <p className="text-[13px] font-extrabold text-rose-700">
        {translatePortalText(entries.length === 1 ? 'One field needs attention' : `${entries.length} fields need attention`)}
      </p>
      <ul className="mt-1.5 space-y-1">
        {entries.map(([name, message]) => (
          <li key={name}>
            <button
              type="button"
              onClick={() => focusFirst([name])}
              className="text-left text-[12px] font-semibold text-rose-600 underline decoration-rose-300 underline-offset-2 hover:text-rose-700"
            >
              {translatePortalText(labels[name] ?? name)}: {translatePortalText(message)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Turns a failed submit into the right user-facing message.
 *
 * Pinned errors need no toast — the fields say it better, and a toast repeating
 * one of them just competes with itself. Anything that could not be pinned still
 * has to be spoken aloud, because an unseen rejection reads as a successful save.
 */
export function submitFailureMessage(result: CaptureResult, err: unknown): string | null {
  const unplaced = Object.values(result.unplaced)
  if (unplaced.length) return unplaced.join(' · ')
  if (result.anyPlaced) {
    const n = Object.keys(result.placed).length
    return n === 1 ? 'Please fix the highlighted field.' : `Please fix the ${n} highlighted fields.`
  }
  return errorMessage(err)
}
