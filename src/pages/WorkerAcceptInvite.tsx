import React, { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Eye, EyeOff, Lock, ShieldCheck, ArrowRight } from 'lucide-react'
import { toast, FieldWarning } from '../ui'
import { ThemeToggle } from '../theme'
import { workerInviteApi, maintWorkerInviteApi, crewInviteApi } from '../api'
import { useAuth, type PortalRole } from '../auth'
import { translatePortalText } from '../i18n/runtime'


/**
 * `done` is the terminal state for an invitee who has no portal to enter — see
 * `dest: null` below.
 */
type Stage = 'checking' | 'ready' | 'invalid' | 'pending' | 'done'
type InvitePortal = 'fuel' | 'maint' | 'crew'

const PORTAL_CFG: Record<InvitePortal, {
  label: string
  gradient: string
  button: string
  ownerNoun: string
  /**
   * Portal to drop them into once the password is set, or null when this invitee
   * does not belong in the portal at all.
   *
   * Crew are the null case: their job is scanning boarding passes at the gangway,
   * so they work in the provider mobile app. Signing them into a web portal with
   * no pages they may open would be a dead end.
   */
  dest: PortalRole | null
  api: typeof workerInviteApi
}> = {
  fuel: { label: 'Fuel Portal', gradient: 'bg-fuel-gradient', button: 'btn-fuel', ownerNoun: 'fuel station owner', dest: 'fuel', api: workerInviteApi },
  maint: { label: 'Maintenance Portal', gradient: 'bg-maint-gradient', button: 'btn-maint', ownerNoun: 'workshop owner', dest: 'maint', api: maintWorkerInviteApi },
  crew: { label: 'Vessel Crew', gradient: 'bg-fuel-gradient', button: 'btn-fuel', ownerNoun: 'boat owner', dest: null, api: crewInviteApi },
}

export default function WorkerAcceptInvite() {
  const { portal, token = '' } = useParams()
  const cfg = PORTAL_CFG[portal as InvitePortal] ?? PORTAL_CFG.fuel
  const nav = useNavigate()
  const { adoptSession } = useAuth()

  const [stage, setStage] = useState<Stage>('checking')
  const [invite, setInvite] = useState<{ name: string; email: string } | null>(null)
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [busy, setBusy] = useState(false)
  const pwTooShort = pw.length > 0 && pw.length < 8
  const pwMismatch = confirm.length > 0 && pw !== confirm

  useEffect(() => {
    cfg.api
      .verify(token)
      .then((res) => {
        setInvite(res.data)
        setStage('ready')
      })
      .catch(() => setStage('invalid'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, portal])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pw !== confirm) {
      toast('Passwords do not match.', 'warn')
      return
    }
    setBusy(true)
    try {
      const res = await cfg.api.accept(token, pw)
      if (res.data.pendingApproval) {
        toast('Your account is waiting for admin approval.', 'info')
        setStage('pending')
        return
      }
      if (!cfg.dest) {
        // No portal for this invitee (crew). The account is created and the
        // password is set; they continue in the mobile app.
        toast(`Your account is ready, ${res.data.user.name} 🎉`)
        setStage('done')
        return
      }
      if (!res.data.accessToken) throw new Error('Portal access has not been issued yet.')
      await adoptSession({ ...res.data, accessToken: res.data.accessToken }, cfg.dest)
      toast(`Welcome to the team, ${res.data.user.name} 🎉`)
      nav(`/${cfg.dest}`, { replace: true })
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not complete signup. Please try again.', 'warn')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`${cfg.gradient} relative min-h-screen overflow-hidden`}>
      <div className="pointer-events-none absolute inset-0 opacity-[0.18]"
        style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.5) 1px, transparent 1px)', backgroundSize: '26px 26px' }} />
      <div className="absolute end-4 top-4 z-30"><ThemeToggle onDark /></div>

      <div className="relative z-10 mx-auto flex min-h-screen max-w-md items-center px-5 py-10">
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="w-full">
          <div className="mb-6 text-center">
            <img src="/logo.png" alt={translatePortalText("BoatPro")} className="mx-auto h-14 w-14 object-contain drop-shadow-[0_0_18px_rgba(255,255,255,0.35)]" onError={e => ((e.target as HTMLImageElement).style.display = 'none')} />
            <p className="mt-2 font-display text-2xl font-extrabold text-white">{cfg.label}</p>
          </div>

          <div className="card !rounded-[28px] p-6 md:p-7 shadow-lift">
            {stage === 'checking' && (
              <div className="py-10 text-center">
                <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-amber-200 border-t-amber-500" />
                <p className="mt-4 text-sm text-slate-400">{translatePortalText("Checking your invite…")}</p>
              </div>
            )}

            {stage === 'pending' && (
              <div className="py-6 text-center">
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-amber-100 text-amber-700 ring-1 ring-amber-200">
                  <ShieldCheck size={22} />
                </span>
                <p className="mt-4 font-display text-lg font-bold text-deep-900">{translatePortalText("Waiting for admin approval")}</p>
                <p className="mt-2 text-sm text-slate-500">
                  {translatePortalText("Your password is set, but an admin must approve your worker account before you can use the provider portal. You can sign in after your provider confirms approval.\r\n                ")}</p>
              </div>
            )}

            {stage === 'done' && (
              <div className="py-6 text-center">
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-400 text-white shadow-glow">
                  <ShieldCheck size={22} />
                </span>
                <p className="mt-4 font-display text-lg font-bold text-deep-900">{translatePortalText("Your password is set")}</p>
                <p className="mt-2 text-sm text-slate-500">
                  {translatePortalText("Open the ")}<strong>{translatePortalText("BoatPro Provider")}</strong> {translatePortalText("app and sign in with your email address and this\r\n                  password. You will see the vessels you have been assigned to, today’s departures, and the\r\n                  scanner for checking passengers aboard.\r\n                ")}</p>
              </div>
            )}

            {stage === 'invalid' && (
              <div className="py-6 text-center">
                <p className="font-display text-lg font-bold text-deep-900">{translatePortalText("This invite link is invalid or has expired")}</p>
                <p className="mt-2 text-sm text-slate-500">{translatePortalText(`Ask your ${cfg.ownerNoun} to resend the invite.`)}</p>
              </div>
            )}

            {stage === 'ready' && invite && (
              <>
                <div className="flex items-center gap-2.5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-400 text-white shadow-glow"><ShieldCheck size={18} /></span>
                  <div>
                    <h2 className="font-display text-lg font-extrabold text-deep-900">{translatePortalText("Welcome, ")}{invite.name}</h2>
                    <p className="text-xs text-slate-400">{invite.email}</p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-slate-500">{translatePortalText("Set a password to finish joining the ")}{cfg.label.toLowerCase()} {translatePortalText("team.")}</p>

                <form onSubmit={submit} className="mt-5 space-y-4">
                  <div>
                    <label className="label">{translatePortalText("Password")}</label>
                    <div className="relative">
                      <Lock size={15} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input required type={showPw ? 'text' : 'password'} value={pw} onChange={e => setPw(e.target.value)}
                        placeholder="••••••••" className={`input ps-10 pe-11 ${pwTooShort ? '!border-rose-300 !ring-rose-100' : ''}`} />
                      <button type="button" onClick={() => setShowPw(s => !s)} className="absolute end-3 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-deep-900">
                        {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    <AnimatePresence>{pwTooShort && <FieldWarning>{translatePortalText("Password must be at least 8 characters")}</FieldWarning>}</AnimatePresence>
                  </div>
                  <div>
                    <label className="label">{translatePortalText("Confirm password")}</label>
                    <input required type={showPw ? 'text' : 'password'} value={confirm} onChange={e => setConfirm(e.target.value)}
                      placeholder="••••••••" className={`input ${pwMismatch ? '!border-rose-300 !ring-rose-100' : ''}`} />
                    <AnimatePresence>{pwMismatch && <FieldWarning>{translatePortalText("Passwords don't match")}</FieldWarning>}</AnimatePresence>
                  </div>
                  <motion.button whileTap={{ scale: 0.97 }} type="submit" disabled={busy || pwMismatch || pwTooShort} className={`${cfg.button} w-full !justify-center !py-3 !text-sm disabled:opacity-70`}>
                    {busy ? (
                      <span className="flex items-center gap-2"><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> {translatePortalText("Creating your account…")}</span>
                    ) : (
                      <>{translatePortalText("Join the team ")}<ArrowRight size={16} /></>
                    )}
                  </motion.button>
                </form>
              </>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  )
}
