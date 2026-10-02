/**
 * The workshop asking an owner to move a job.
 *
 * WHY THIS EXISTS ALONGSIDE `updateRequest`
 * `maintenancePortalApi.updateRequest` can already write `preferredDate` and
 * `preferredSlot` outright, and that is what a shop reached for when it could
 * not make a slot. It moves a time the owner agreed to without asking them: the
 * boat is somewhere else on the day the shop picked, and the owner finds out
 * from a notification after the fact. This is the consented path — the job does
 * not move until the owner accepts from their own app.
 *
 * WHY THE DAY AND SLOT ARE CONSTRAINED, NOT FREE TEXT
 * The backend rejects a slot that is not on this shop's configured grid, and a
 * day the shop is closed on. Offering a free date field would just produce a
 * round trip that fails with a message the shop can do nothing about, so both
 * inputs are drawn from the shop's own `settings` — the same source the check
 * uses.
 *
 * WHY THE REASON IS PROMINENT AND STILL OPTIONAL
 * "The crane is booked that morning" is the difference between an owner
 * accepting and an owner cancelling; a bare time change reads as arbitrary.
 * Mandatory free text produces "n/a", which is worse than blank because it
 * looks like an answer.
 */
import { todayIso } from '../../live'
import React from 'react'
import { Modal } from '../../ui'
import { maintenancePortalApi, type MaintenanceSettings } from '../../api'
import { formatPortalDate, localizedField, translatePortalText } from '../../i18n/runtime'
import { maintToast } from '../maintUi'

/** Lowest lead time the server will accept, mirrored so the shop is told here. */
const MIN_LEAD_MS = 60 * 60 * 1000

/**
 * Build a local instant from a `YYYY-MM-DD` day and an `HH:mm` slot.
 *
 * Field by field rather than `new Date(`${day}T${slot}`)`: the bare form is
 * parsed as UTC, and this portal's operators are at UTC+3, so every proposal
 * would be sent dated a day early.
 */
function combineLocal(dayISO: string, hhmm: string): Date | null {
  if (!dayISO || !hhmm) return null
  const [y, mo, d] = dayISO.split('-').map(Number)
  const [h, mi] = hhmm.split(':').map(Number)
  if ([y, mo, d, h, mi].some(n => !Number.isFinite(n))) return null
  return new Date(y, mo - 1, d, h, mi, 0, 0)
}

export function ProposeRescheduleModal({
  open,
  onClose,
  requestId,
  jobLabel,
  currentWhen,
  onDone,
}: {
  open: boolean
  onClose: () => void
  requestId: string
  /** "Sea Breeze — Engine service", for the confirmation copy. */
  jobLabel: string
  /** The time being replaced, so the shop can see what it is changing. */
  currentWhen?: string
  onDone: () => void
}) {
  const [settings, setSettings] = React.useState<MaintenanceSettings | null>(null)
  const [dayISO, setDayISO] = React.useState('')
  const [slot, setSlot] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  // Loaded on open rather than on mount: the grid is the shop's own and can be
  // edited in another tab while this list is on screen.
  React.useEffect(() => {
    if (!open) return
    setDayISO('')
    setSlot('')
    setReason('')
    maintenancePortalApi
      .settings()
      .then(r => setSettings(r.data.settings))
      .catch(() => setSettings(null))
  }, [open])

  const slots = settings?.slots ?? []
  const workingDays = settings?.workingDays ?? []
  const startAt = combineLocal(dayISO, slot)

  /**
   * Why this cannot be sent, or null.
   *
   * Every branch mirrors a server-side guard, so the shop is corrected while
   * choosing instead of by a rejected request.
   */
  const problem: string | null = (() => {
    if (!dayISO) return 'Pick a day'
    if (workingDays.length && !workingDays.includes(new Date(dayISO + 'T00:00:00').getDay())) {
      return 'Your workshop is closed that day'
    }
    if (!slot) return 'Pick one of your opening times'
    if (!startAt) return 'That day and time did not parse'
    if (startAt.getTime() - Date.now() < MIN_LEAD_MS) {
      return 'Propose a time at least an hour from now'
    }
    return null
  })()

  const submit = async () => {
    if (problem || !startAt || busy) return
    setBusy(true)
    try {
      await maintenancePortalApi.proposeReschedule(requestId, {
        proposedStartAt: startAt.toISOString(),
        proposedSlot: slot,
        reason: reason.trim() || undefined,
      })
      maintToast('Request sent. The job stays as it is until the owner accepts.', 'success')
      onDone()
      onClose()
    } catch (error) {
      maintToast(error instanceof Error ? error.message : 'Could not send the request', 'warn')
    } finally {
      setBusy(false)
    }
  }

  /*
    The shared helper now does this, so the workaround is gone.

    Its old comment said `toISOString()` "would give yesterday for the second
    half of the day at UTC+3" — the right instinct, wrong window: at a positive
    offset it is the *first* three hours of the local day that convert back to
    yesterday, not the last twelve.
  */
  const todayISO = todayIso()

  return (
    <Modal open={open} onClose={onClose} title={translatePortalText("Propose a new time")}>
      <div className="space-y-5">
        <div className="rounded-xl bg-slate-50 px-4 py-3">
          <p className="text-sm font-semibold text-deep-900">{jobLabel}</p>
          {currentWhen && (
            <p className="mt-0.5 text-xs text-slate-500">{translatePortalText("Currently booked for")} {currentWhen}</p>
          )}
        </div>

        <p className="text-xs leading-relaxed text-slate-500">
          {translatePortalText("The job stays exactly as it is until the owner accepts. They can also decline and keep\r\n          the original time — so this is a request, not a change.")}
        </p>

        <div>
          <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
            {translatePortalText("New day")}
          </label>
          <input
            type="date"
            value={dayISO}
            min={todayISO}
            onChange={e => setDayISO(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
            {translatePortalText("Opening time")}
          </label>
          {slots.length === 0 ? (
            <p className="text-xs text-slate-400">
              {translatePortalText("No opening times are configured yet — set them under Resources before proposing a\r\n              time.")}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {slots.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSlot(s)}
                  aria-pressed={slot === s}
                  className={`rounded-full border px-4 py-2 text-xs font-bold transition ${
                    slot === s
                      ? 'border-brand-500 bg-brand-500 text-white'
                      : 'border-slate-200 bg-white text-deep-900 hover:border-brand-300'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
            {translatePortalText("Why?")} <span className="font-medium normal-case text-slate-400">{translatePortalText("(optional)")}</span>
          </label>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder={translatePortalText("e.g. the crane is booked that morning")}
            className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
          />
          <p className="mt-1 text-[11px] text-slate-400">
            {translatePortalText("Owners are far more likely to accept a time change that explains itself.")}
          </p>
        </div>

        {problem && <p className="text-xs font-semibold text-rose-600">{translatePortalText(problem)}</p>}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-deep-900 transition hover:bg-slate-50 disabled:opacity-50"
          >
            {translatePortalText("Cancel")}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!!problem || busy}
            className="flex-[2] rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? translatePortalText("Sending…") : translatePortalText("Send request")}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * The shop's view of its own outstanding request.
 *
 * Shown only while `pending`: once answered, the job's own dates tell the story
 * and a stale banner would sit above a time nobody is disputing.
 */
export function AwaitingRescheduleReply({
  proposal,
  requestId,
  onDone,
}: {
  proposal?: {
    status: string
    proposedStartAt: string
    proposedSlot?: string
    reason?: string
    reasonAr?: string
  } | null
  requestId: string
  onDone: () => void
}) {
  const [busy, setBusy] = React.useState(false)
  if (!proposal || proposal.status !== 'pending') return null

  const when = proposal.proposedSlot
    ? `${formatPortalDate(proposal.proposedStartAt)} · ${proposal.proposedSlot}`
    : formatPortalDate(proposal.proposedStartAt, { dateStyle: 'short', timeStyle: 'short' })

  const withdraw = async () => {
    if (busy) return
    setBusy(true)
    try {
      await maintenancePortalApi.withdrawReschedule(requestId)
      maintToast('Request withdrawn. The original time stands.', 'success')
      onDone()
    } catch (error) {
      maintToast(error instanceof Error ? error.message : 'Could not withdraw the request', 'warn')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
      <p className="text-xs font-bold text-amber-900">{translatePortalText("Waiting on the owner")}</p>
      <p className="mt-1 text-sm font-semibold text-deep-900">{when}</p>
      {proposal.reason && <p className="mt-1 text-xs text-slate-600">{localizedField(proposal, 'reason') ?? proposal.reason}</p>}
      <p className="mt-1.5 text-[11px] text-slate-500">
        {translatePortalText("The job is still booked for its original time until they accept.")}
      </p>
      <button
        type="button"
        onClick={withdraw}
        disabled={busy}
        className="mt-2 text-xs font-bold text-amber-900 underline disabled:opacity-50"
      >
        {busy ? translatePortalText("Withdrawing…") : translatePortalText("Withdraw request")}
      </button>
    </div>
  )
}
