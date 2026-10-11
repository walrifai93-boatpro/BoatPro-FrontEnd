import React, { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, BadgeCheck, Receipt, ShieldCheck } from 'lucide-react'
import { ThemeToggle } from '../theme'
import { planInviteApi, type PlanSummary } from '../api'
import { useAuth } from '../auth'
import { setPendingInvite } from '../shared/pendingInvite'
import { formatPortalNumber, translatePortalText } from '../i18n/runtime'


/**
 * The page an admin's invite link opens.
 *
 * Its whole job is to show the provider the deal before they commit to
 * anything, and to make sure the code survives whatever they have to do next —
 * sign up, or sign in — so the onboarding wizard can apply it without them
 * choosing a plan at all. That is the point of the link: the plan is already
 * decided.
 *
 * Resolving the code needs no session, so an unauthenticated visitor sees the
 * real terms rather than a login wall with no explanation of what they were
 * sent.
 */

const PROVIDER_TYPE_LABELS: Record<string, string> = {
  boat_provider: 'Boat Provider',
  marina_provider: 'Marina Provider',
  fuel_provider: 'Fuel Provider',
  maintenance_provider: 'Maintenance Provider',
}

type Stage = 'checking' | 'ready' | 'invalid'

export default function PlanInvite() {
  const { code = '' } = useParams()
  const nav = useNavigate()
  const { user, status } = useAuth()

  const [stage, setStage] = useState<Stage>('checking')
  const [plan, setPlan] = useState<PlanSummary | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!code) { setStage('invalid'); setError('This link is missing its invite code.'); return }
    // Stored before the plan even resolves: if the provider closes this page
    // and comes back through a bookmarked login, the code is still theirs.
    setPendingInvite(code)
    planInviteApi.resolve(code)
      .then((r) => { setPlan(r.data.plan); setStage('ready') })
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'This invite link is no longer valid.')
        setStage('invalid')
      })
  }, [code])

  const isFixedFee = plan?.kind === 'fixed_fee'
  const signedIn = status === 'authed' && !!user
  /**
   * Boat providers have no registration wizard in this portal — they onboard in
   * the BoatPro Provider mobile app (see the note in `Onboarding.tsx`). Sending
   * them to `/onboarding` would land them in the marina wizard, so this page
   * hands them the code to enter in the app instead of a dead end.
   */
  const isMobileOnly = plan?.providerType === 'boat_provider'

  const proceed = () => {
    // A signed-in provider goes straight to the wizard, which picks the code up
    // from session storage. Everyone else registers first.
    nav(signedIn ? '/onboarding' : '/login', { replace: false })
  }

  return (
    <div className="bg-hero-gradient relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-[0.18]"
        style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.5) 1px, transparent 1px)', backgroundSize: '26px 26px' }} />
      <div className="absolute end-4 top-4 z-30"><ThemeToggle onDark /></div>

      <div className="relative z-10 mx-auto flex min-h-screen max-w-md items-center px-5 py-10">
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="w-full">
          <div className="mb-6 text-center">
            <img src="logo.png" alt={translatePortalText("BoatPro")} className="mx-auto h-14 w-14 object-contain drop-shadow-[0_0_18px_rgba(255,255,255,0.35)]"
              onError={e => ((e.target as HTMLImageElement).style.display = 'none')} />
            <p className="mt-2 font-display text-2xl font-extrabold text-white">{translatePortalText("Your BoatPro plan")}</p>
          </div>

          <div className="card !rounded-[28px] p-6 md:p-7 shadow-lift">
            {stage === 'checking' && (
              <div className="py-10 text-center">
                <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-ocean-200 border-t-ocean-500" />
                <p className="mt-4 text-sm text-slate-400">{translatePortalText("Checking your invite…")}</p>
              </div>
            )}

            {stage === 'invalid' && (
              <div className="py-6 text-center">
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-rose-100 text-rose-700 ring-1 ring-rose-200">
                  <ShieldCheck size={22} />
                </span>
                <p className="mt-4 font-display text-lg font-bold text-deep-900">{translatePortalText("This invite link doesn’t work")}</p>
                <p className="mt-2 text-sm text-slate-500">{translatePortalText(error)}</p>
                <p className="mt-3 text-xs text-slate-400">
                  {translatePortalText("Ask the BoatPro team for a fresh link — the one you have may have expired or been used up.\r\n                ")}</p>
                <button onClick={() => nav('/login')} className="btn-ghost mt-5">{translatePortalText("Go to sign in")}</button>
              </div>
            )}

            {stage === 'ready' && plan && (
              <>
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-amber-500 to-amber-400 text-white shadow-glow">
                  <Receipt size={22} />
                </span>
                <p className="mt-4 font-display text-xl font-extrabold text-deep-900">{plan.name}</p>
                <p className="mt-1 text-xs font-bold uppercase tracking-wider text-slate-400">
                  {translatePortalText(PROVIDER_TYPE_LABELS[plan.providerType] || plan.providerType)}
                </p>

                {isFixedFee ? (
                  <div className="mt-5 rounded-2xl bg-amber-50 px-4 py-4 ring-1 ring-amber-100">
                    <p className="font-display text-3xl font-extrabold text-amber-700">
                      {plan.currency} {formatPortalNumber(plan.feePerTransaction)}
                      <span className="ms-1 text-sm font-bold text-amber-700 dark:text-amber-300">{translatePortalText("per transaction")}</span>
                    </p>
                    <div className="mt-3 space-y-1.5 text-[12px] font-semibold text-amber-800/90 dark:text-amber-200">
                      <p className="flex items-center gap-1.5"><BadgeCheck size={13} className="shrink-0" /> {translatePortalText("No commission percentage")}</p>
                      <p className="flex items-center gap-1.5"><BadgeCheck size={13} className="shrink-0" /> {translatePortalText("No monthly subscription")}</p>
                      <p className="flex items-center gap-1.5"><BadgeCheck size={13} className="shrink-0" /> {translatePortalText("Never more than the booking itself")}</p>
                    </div>
                  </div>
                ) : (
                  <div className="mt-5 rounded-2xl bg-ocean-50 px-4 py-4 ring-1 ring-ocean-100">
                    <p className="font-display text-xl font-extrabold text-ocean-700">{plan.label}</p>
                  </div>
                )}

                {isMobileOnly ? (
                  <>
                    <p className="mt-5 text-sm leading-relaxed text-slate-500">
                      {translatePortalText("Boat providers register in the ")}<strong>{translatePortalText("BoatPro Provider")}</strong> {translatePortalText("app. Install it, create your\r\n                      account, and enter this code on the payment step — you will be put on this plan and will not be\r\n                      asked to choose a subscription or commission plan.\r\n                    ")}</p>
                    <div className="mt-4 rounded-2xl bg-sand px-4 py-4 text-center ring-1 ring-slate-100">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText("Your invite code")}</p>
                      <p className="mt-1 font-display text-2xl font-extrabold tracking-wide text-deep-900">{code.toUpperCase()}</p>
                    </div>
                    <button
                      onClick={async () => {
                        // Best-effort: on a desktop browser there is nothing to
                        // copy into, so the code stays legible above regardless.
                        try { await navigator.clipboard.writeText(code.toUpperCase()) } catch { /* shown above anyway */ }
                      }}
                      className="btn-ghost mt-4 w-full"
                    >
                      {translatePortalText("Copy code\r\n                    ")}</button>
                  </>
                ) : (
                  <>
                    <p className="mt-5 text-sm leading-relaxed text-slate-500">
                      {translatePortalText(signedIn
                        ? 'Continue your registration and this plan will be applied automatically. You do not need to choose a subscription or commission plan.'
                        : 'Create your BoatPro account to continue. This plan will be applied automatically. You do not need to choose a subscription or commission plan.')}
                    </p>

                    <button onClick={proceed} className="btn-primary mt-5 w-full">
                      {translatePortalText(signedIn ? 'Continue registration' : 'Create my account')} <ArrowRight size={15} />
                    </button>
                    <p className="mt-3 text-center text-[11px] text-slate-400">
                      {translatePortalText("Invite code ")}<code className="rounded bg-sand px-1.5 py-0.5 font-extrabold text-deep-900">{code.toUpperCase()}</code>
                    </p>
                  </>
                )}
              </>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  )
}
