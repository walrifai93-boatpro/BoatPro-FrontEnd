import React, { useState } from 'react'
import { useFormErrors, submitFailureMessage } from '../shared/formErrors'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Anchor, Fuel, Wrench, Crown, Eye, EyeOff, Lock, Mail, ArrowRight, ShieldCheck,
  Waves, Sparkles, Check, Building2, User, Compass, Zap, ChevronDown, Ship, Phone } from 'lucide-react'
import { toast, ToastStack, Modal, FieldWarning } from '../ui'
import { ThemeToggle } from '../theme'
import { useAuth, isMfaChallenge, type PortalRole } from '../auth'
import type { ApiUser } from '../api'
import { authApi, planInviteApi, setSessionPersistence } from '../api'
import { getPendingInvite } from '../shared/pendingInvite'
import { FakeFillButton, useFakeFillEnabled } from '../shared/FakeFillButton'
import { fakeProvider, type FakeTrade } from '../shared/fakeFill'
import { translatePortalText } from '../i18n/runtime'


type Role = PortalRole
type Mode = 'signin' | 'signup'

interface RoleCfg {
  key: Role; title: string; sub: string; icon: React.ReactNode; img: string
  accent: string; btn: string; textGrad: string; bg: string; glow: string
  word: string; features: string[]; email: string; blurb: string
}

const ROLES: RoleCfg[] = [
  {
    key: 'agent', title: 'Support Agent', sub: 'Assigned cases', icon: <ShieldCheck size={18} />,
    img: 'https://images.unsplash.com/photo-1556761175-b413da4baf72?w=1100&q=75&auto=format&fit=crop',
    accent: 'from-teal-500 to-cyan-400', btn: 'btn-admin', textGrad: 'text-gradient-admin', bg: 'bg-admin-gradient',
    glow: '16,185,129', word: 'support',
    features: ['Assigned support cases', 'Customer and provider context', 'Controlled support actions'],
    email: '', blurb: 'Help BoatPro customers and providers.',
  },
  {
    key: 'marina', title: 'Marina Provider', sub: 'Berths & dock ops', icon: <Anchor size={18} />,
    img: 'https://images.unsplash.com/photo-1559827260-dc66d52bef19?w=1100&q=75&auto=format&fit=crop',
    accent: 'from-ocean-500 to-ocean-300', btn: 'btn-primary', textGrad: 'text-gradient', bg: 'bg-hero-gradient',
    glow: '55,184,217', word: 'marina',
    features: ['Live dock map & berth control', 'Reservations, billing & invoicing', 'Facilities, utilities & staff'],
    email: 'gary@azurebaymarina.com', blurb: 'Manage berths, reservations & harbor operations.',
  },
  {
    key: 'fuel', title: 'Fuel Provider', sub: 'Bunkering & delivery', icon: <Fuel size={18} />,
    img: 'https://images.unsplash.com/photo-1518623489648-a173ef7824f3?w=1100&q=75&auto=format&fit=crop',
    accent: 'from-amber-500 to-orange-400', btn: 'btn-fuel', textGrad: 'text-gradient-fuel', bg: 'bg-fuel-gradient',
    glow: '251,146,60', word: 'fuel',
    features: ['Tank inventory & stock levels', 'Delivery dispatch & live GPS', 'Dispensing, pricing & billing'],
    email: 'ops@harborpointfuel.com', blurb: 'Manage tanks, deliveries, dispensing & billing.',
  },
  {
    key: 'maint', title: 'Maintenance', sub: 'Repairs & service', icon: <Wrench size={18} />,
    img: 'https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?w=1100&q=75&auto=format&fit=crop',
    accent: 'from-violet-500 to-indigo-400', btn: 'btn-maint', textGrad: 'text-gradient-maint', bg: 'bg-maint-gradient',
    glow: '139,92,246', word: 'maintenance',
    features: ['Work orders & inspections', 'Technicians, parts & GPS', 'Quality, billing & AI insights'],
    email: 'service@harbortechmarine.com', blurb: 'Manage work orders, technicians, parts & billing.',
  },
  {
    key: 'admin', title: 'Super Admin', sub: 'Platform control', icon: <Crown size={18} />,
    img: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1100&q=75&auto=format&fit=crop',
    accent: 'from-emerald-500 to-teal-400', btn: 'btn-admin', textGrad: 'text-gradient-admin', bg: 'bg-admin-gradient',
    glow: '16,185,129', word: 'platform',
    features: ['Users, providers & KYC', 'Payments, commission & payouts', 'Fraud, AI & platform analytics'],
    email: 'tom.w@boatpro.io', blurb: 'Control users, providers, payments, fraud & the whole platform.',
  },
]

const DEST: Record<Role, string> = { marina: '/', fuel: '/fuel', maint: '/maint', boat: '/boat', admin: '/admin', agent: '/agent' }
/** Which kind of sample business the Fake fill button invents for each portal. */
const FAKE_TRADE: Partial<Record<Role, FakeTrade>> = { marina: 'marina', fuel: 'fuel', maint: 'maintenance', boat: 'boat' }
/**
 * What the platform is, rather than invented metrics about it.
 *
 * These three tiles used to read "120+ Harbors live", "$4.8M Processed / mo"
 * and "99.98% Uptime". None was measured, and the middle one was wrong twice
 * over: it quoted dollars for a platform that settles exclusively in riyals,
 * at a volume the platform has not done in its entire history. Every provider
 * sees this panel when they sign in, so these were claims made to users, not
 * just numbers on an internal dashboard.
 *
 * Replaced with facts that are true and stay true, rather than plausible
 * figures that need a data source nobody built.
 */
const STATS = [
  { icon: <Compass size={15} />, value: '4', label: 'Service verticals' },
  { icon: <Waves size={15} />, value: 'SAR', label: 'Settled in riyals' },
  /**
   * Narrowed from "Fully bilingual", which was not true of the thing the tile
   * sits on. The backend ships en + ar locales and both mobile apps are fully
   * translated, but this console — marina, fuel, maintenance, boat and admin
   * alike — has no i18n at all: no library, no locale files, no `t()`, no RTL.
   * A provider signing in here read "Fully bilingual" and then got an
   * English-only, left-to-right console, which is the same category of claim as
   * the three invented metrics this block already replaced.
   */
  { icon: <Zap size={15} />, value: 'AR · EN', label: 'Bilingual mobile apps' },
]

/** Which portal a plan's provider type signs up through. */
const PORTAL_FOR_PROVIDER_TYPE: Record<string, Role | undefined> = {
  marina_provider: 'marina',
  fuel_provider: 'fuel',
  maintenance_provider: 'maint',
  // Boat providers register in the mobile app — see `PlanInvite.tsx`.
  boat_provider: undefined,
}

export default function Login() {
  const nav = useNavigate()
  const { status, user, login, completeMfaLogin, register } = useAuth()

  React.useEffect(() => {
    if (status === 'authed' && user) {
      if (user.role === 'admin') nav('/admin', { replace: true })
      else if (user.role === 'support_agent') nav('/agent', { replace: true })
      else if (user.role === 'fuel_provider' || user.role === 'fuel_worker') nav('/fuel', { replace: true })
      else if (user.role === 'maintenance_provider' || user.role === 'maintenance_worker') nav('/maint', { replace: true })
      else if (user.role === 'boat_provider') nav('/boat', { replace: true })
      else nav('/', { replace: true })
    }
  }, [status, user, nav])

  const [role, setRole] = useState<Role>('marina')
  const [roleOpen, setRoleOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('signin')

  /**
   * Arriving from an admin's plan-invite link.
   *
   * The plan is issued for one provider type, so the account being created has
   * to be that type — signing up as a Marina when the plan is for a Fuel
   * Provider produces an account the invite will refuse. Landing on Sign up
   * rather than Sign in is the same reasoning: someone following an invite
   * almost never has an account yet.
   */
  const pendingInvite = getPendingInvite()
  const invitePreselectRef = React.useRef(false)
  React.useEffect(() => {
    if (!pendingInvite || invitePreselectRef.current) return
    invitePreselectRef.current = true
    setMode('signup')
    planInviteApi.resolve(pendingInvite)
      .then((r) => {
        const portal = PORTAL_FOR_PROVIDER_TYPE[r.data.plan.providerType]
        if (portal) setRole(portal)
      })
      // A dead code is the invite page's problem to report, not this screen's;
      // it has already shown the provider what went wrong.
      .catch(() => {})
  }, [pendingInvite])
  const [org, setOrg] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [remember, setRemember] = useState(true)
  /**
   * Consent to the Terms and Privacy Policy, actually held.
   *
   * The checkbox was `defaultChecked` and uncontrolled, and `submit()` never
   * looked at it — so unticking it and pressing the button created the account
   * anyway. The agreement was a picture of a gate, not a gate.
   */
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [busy, setBusy] = useState(false)
  /**
   * Email verification for sign-up.
   *
   * The API refuses `/auth/register` without an `emailOtpCode` unless the number
   * was proven by Firebase, and this portal has no phone step — so every marina,
   * fuel and maintenance sign-up was rejected with a 400 naming a field this
   * form never rendered. The code is tied to the address it was sent to: editing
   * the email afterwards drops back to "send code".
   */
  const [otpSentTo, setOtpSentTo] = useState<string | null>(null)
  const [otpCode, setOtpCode] = useState('')
  const [otpSending, setOtpSending] = useState(false)
  const otpStep = mode === 'signup' && otpSentTo !== null && otpSentTo === email.trim().toLowerCase()
  const active = ROLES.find(r => r.key === role)!
  const roleWord = active.title
  const pwMismatch = mode === 'signup' && confirm.length > 0 && pw !== confirm
  const pwTooShort = mode === 'signup' && pw.length > 0 && pw.length < 8
  /**
   * The API calls these `password` and `name`; this screen calls them `pw` and
   * `org`. Without the mapping a rejected password would highlight nothing.
   */
  const fe = useFormErrors({ rename: { password: 'pw', name: 'org' }, fields: ['email', 'pw', 'org', 'confirm', 'emailOtpCode'] })
  const fieldErrors = fe.errors
  const clearErr = (k: string) => fe.clear(k)

  const fakeFillOn = useFakeFillEnabled()
  /** Testing only — see FakeFillButton. Email, password and consent stay with the tester. */
  const fakeFill = () => {
    const p = fakeProvider({ trade: FAKE_TRADE[role] ?? 'marina' })
    setOrg(p.businessNameEn)
    setPhone(p.mobile)
    clearErr('org')
    clearErr('phone')
  }

  const [forgotOpen, setForgotOpen] = useState(false)
  const [forgotStep, setForgotStep] = useState<'email' | 'code'>('email')
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotCode, setForgotCode] = useState('')
  const [forgotNewPw, setForgotNewPw] = useState('')
  const [forgotBusy, setForgotBusy] = useState(false)

  const openForgot = () => { setForgotOpen(true); setForgotStep('email'); setForgotEmail(email); setForgotCode(''); setForgotNewPw('') }
  const sendResetCode = async () => {
    if (!forgotEmail.trim()) { toast(translatePortalText('Enter your email address'), 'warn'); return }
    setForgotBusy(true)
    try {
      const res = await authApi.forgotPassword(forgotEmail.trim())
      toast(translatePortalText(res.message))
      if (res.devResetCode) setForgotCode(res.devResetCode) // dev-only convenience, never present in production
      setForgotStep('code')
    } catch (e) { toast(translatePortalText(e instanceof Error ? e.message : 'Could not send reset code'), 'warn') }
    finally { setForgotBusy(false) }
  }
  const submitReset = async () => {
    if (!forgotCode.trim() || !forgotNewPw.trim()) { toast(translatePortalText('Enter the reset code and a new password'), 'warn'); return }
    setForgotBusy(true)
    try {
      const res = await authApi.resetPassword(forgotEmail.trim(), forgotCode.trim(), forgotNewPw.trim())
      toast(translatePortalText(res.message))
      setForgotOpen(false)
    } catch (e) { toast(translatePortalText(e instanceof Error ? e.message : 'Could not reset password'), 'warn') }
    finally { setForgotBusy(false) }
  }

  /**
   * Two-factor sign-in (admins and support agents, while the security policy
   * requires it). The password was right; the server emailed a 6-digit code
   * and handed back a short-lived `mfaToken` that is not a session. This step
   * trades the two for one.
   */
  const [mfa, setMfa] = useState<{ token: string; emailHint: string } | null>(null)
  const [mfaCode, setMfaCode] = useState('')
  const [mfaBusy, setMfaBusy] = useState(false)
  const [mfaResending, setMfaResending] = useState(false)
  const [resendIn, setResendIn] = useState(0)
  React.useEffect(() => {
    if (!mfa || resendIn <= 0) return
    const t = window.setTimeout(() => setResendIn(s => Math.max(0, s - 1)), 1000)
    return () => window.clearTimeout(t)
  }, [mfa, resendIn])

  const errorCode = (err: unknown) => (err as { details?: { code?: string; retryAfter?: number } } | null)?.details
  const leaveMfa = () => { setMfa(null); setMfaCode(''); setResendIn(0) }

  /** Where a finished sign-in lands, and what it says on the way in. */
  const welcome = (loggedUser: ApiUser | undefined) => {
    const targetRole: Role = loggedUser?.role === 'admin' ? 'admin' : loggedUser?.role === 'support_agent' ? 'agent' : role
    const msg: Record<Role, string> = {
      marina: 'Welcome back to the Marina Portal ⚓', fuel: 'Welcome back to the Fuel Portal ⛽',
      maint: 'Welcome back to the Maintenance Portal 🔧', boat: 'Welcome back to the Boat Provider Portal 🚤',
      admin: 'Welcome to the Super Admin Control Center 👑',
      agent: 'Welcome to BoatPro Support',
    }
    toast(translatePortalText(msg[targetRole] || msg.admin))
    nav(DEST[targetRole], { replace: true })
  }

  const submitMfa = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!mfa) return
    const code = mfaCode.trim()
    if (!/^\d{6}$/.test(code)) {
      fe.fail({ mfaCode: 'Enter the 6-digit code from the email' })
      return
    }
    setMfaBusy(true)
    try {
      welcome(await completeMfaLogin(mfa.token, code, role))
    } catch (err) {
      const details = errorCode(err)
      // The pending sign-in is gone (expired, used up, or the account locked):
      // the only way forward is the password again.
      if (details?.code === 'MFA_EXPIRED' || details?.code === 'ACCOUNT_LOCKED') leaveMfa()
      if (details?.code === 'MFA_CODE_INVALID') setMfaCode('')
      toast(translatePortalText(err instanceof Error ? err.message : 'Could not verify the code'), 'warn')
    } finally {
      setMfaBusy(false)
    }
  }

  const resendMfa = async () => {
    if (!mfa || resendIn > 0 || mfaResending) return
    setMfaResending(true)
    try {
      const res = await authApi.resendLoginMfa(mfa.token)
      setResendIn(res.data.resendAvailableIn || 60)
      setMfaCode(res.devCode ?? '') // dev-only convenience, never present in production
      toast(translatePortalText('A new code is on its way'))
    } catch (err) {
      const details = errorCode(err)
      if (details?.code === 'MFA_RESEND_COOLDOWN') setResendIn(details.retryAfter || 60)
      else if (details?.code === 'MFA_EXPIRED' || details?.code === 'MFA_RESEND_LIMIT') leaveMfa()
      toast(translatePortalText(err instanceof Error ? err.message : 'Could not send a new code'), 'warn')
    } finally {
      setMfaResending(false)
    }
  }

  const sendSignupCode = async () => {
    const addr = email.trim().toLowerCase()
    setOtpSending(true)
    try {
      const res = await authApi.sendSignupEmailOtp(addr)
      setOtpSentTo(addr)
      setOtpCode(res.devCode ?? '') // dev-only convenience, never present in production
      clearErr('emailOtpCode')
      toast(translatePortalText(`We emailed a 6-digit code to ${addr}`))
    } catch (err) {
      const result = fe.capture(err)
      const msg = submitFailureMessage(result, err)
      if (msg) toast(translatePortalText(msg), 'warn')
    } finally {
      setOtpSending(false)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()

    // The backend provisions Super Admin accounts via seeding — they cannot be
    // created through public sign-up.
    if (mode === 'signup' && (role === 'admin' || role === 'agent')) {
      toast(translatePortalText('Staff accounts are created by BoatPro Admin. Please sign in with your invitation.'), 'warn')
      return
    }

    // Field-level validation with inline errors
    const errs: Record<string, string | undefined> = {}
    if (!email.trim()) errs.email = 'Email address is required'
    else if (!/^\S+@\S+\.\S+$/.test(email.trim())) errs.email = 'Enter a valid email address'
    if (!pw) errs.pw = 'Password is required'
    if (mode === 'signup') {
      if (!org.trim()) errs.org = 'Business name is required'
      // Collected here because this was the only signup surface that asked for
      // no number at all — both mobile apps already require one, and it is what
      // the payment gateway is sent as customer.mobile.
      if (!phone.trim()) errs.phone = 'Mobile number is required'
      else if (!/^\+?\d{5,19}$/.test(phone.replace(/[\s()\-.]/g, ''))) {
        errs.phone = 'Enter a valid mobile number, e.g. +966501234567'
      }
      if (pw.length < 8) errs.pw = 'Password must be at least 8 characters'
      if (!confirm) errs.confirm = 'Please confirm your password'
      else if (pw !== confirm) errs.confirm = 'Passwords do not match'
      if (!acceptedTerms) errs.terms = 'Please accept the Terms of Service and Privacy Policy to continue'
      if (otpStep && !/^\d{6}$/.test(otpCode.trim())) errs.emailOtpCode = 'Enter the 6-digit code we emailed you'
    }
    if (fe.fail(errs)) return
    fe.clear()

    // First press on sign-up sends the code; the account is created on the next.
    if (mode === 'signup' && !otpStep) {
      await sendSignupCode()
      return
    }

    setBusy(true)
    // Recorded before the call, so the tokens the response produces are written
    // to the store the operator actually chose rather than migrated afterwards.
    // A new account always persists: there is no "remember me" on the sign-up
    // form to say otherwise.
    setSessionPersistence(mode === 'signup' ? true : remember)
    try {
      if (mode === 'signup') {
        await register({ name: org.trim() || email.split('@')[0], email: email.trim(), password: pw, phone: phone.trim(), emailOtpCode: otpCode.trim() }, role)
        toast(translatePortalText(`Welcome to BoatPro, ${org || 'new provider'} — account created 🎉`))
        nav(DEST[role], { replace: true })
      } else {
        const outcome = await login(email.trim(), pw, role)
        if (isMfaChallenge(outcome)) {
          setMfa({ token: outcome.mfaToken, emailHint: outcome.emailHint })
          setMfaCode(outcome.devCode ?? '') // dev-only convenience, never present in production
          setResendIn(60)
          fe.clear()
          return
        }
        welcome(outcome)
      }
    } catch (err) {
      /* 403s are rewritten to a generic "no permission" by the API layer, which
         for this one would hide the actual reason: the network, not the account. */
      if (errorCode(err)?.code === 'IP_NOT_ALLOWED') {
        toast(translatePortalText('Admin sign-in is not allowed from this network'), 'warn')
        return
      }
      /**
       * This used to pin every failure to the email field, so a wrong password —
       * or a server being down — put a red ring around a perfectly good address
       * and told the user to look at it. Now only errors the API actually attributes
       * to a field mark that field; everything else stays in the toast, where a
       * problem with no field of its own belongs.
       */
      const result = fe.capture(err)
      const msg = submitFailureMessage(result, err)
      if (msg) toast(translatePortalText(msg), 'warn')
    } finally {
      setBusy(false)
    }
  }

  return (
    // `overflow-clip`, not `overflow-hidden`: the wave SVGs below are 200% wide, and
    // a hidden-overflow box is still a scroll container — focusing a field after a
    // provider-type switch scrolled it ~116px sideways, cutting off the hero and
    // leaving a blank strip at the end. Clip has nothing to scroll.
    <div className="relative min-h-screen overflow-clip">
      {/* The stack lives in each console layout, and this page is outside all of
          them — so every toast here (a wrong password, a reset code sent, a
          sign-up refused) was raised and never drawn. */}
      <ToastStack />
      {/* ── role-themed background cross-dissolve ── */}
      <AnimatePresence>
        <motion.div key={role} className={`absolute inset-0 ${active.bg}`}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.7 }} />
      </AnimatePresence>

      {/* ── dot grid texture ── */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.18]"
        style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.5) 1px, transparent 1px)', backgroundSize: '26px 26px' }} />

      {/* ── drifting glow orbs (role-tinted) ── */}
      <div className="animate-orb pointer-events-none absolute -top-32 -start-24 h-[440px] w-[440px] rounded-full blur-3xl" style={{ background: `rgba(${active.glow},0.22)` }} />
      <div className="animate-orb pointer-events-none absolute -bottom-40 end-[-120px] h-[520px] w-[520px] rounded-full blur-3xl" style={{ background: `rgba(${active.glow},0.16)`, animationDelay: '-6s' }} />
      <div className="animate-orb pointer-events-none absolute top-1/3 end-1/3 h-64 w-64 rounded-full blur-3xl" style={{ background: 'rgba(255,255,255,0.06)', animationDelay: '-3s' }} />

      {/* ── animated waves ── */}
      <svg className="pointer-events-none absolute bottom-0 start-0 h-28 w-[200%] animate-wave text-white/5" viewBox="0 0 1200 60" preserveAspectRatio="none">
        <path d="M0 38 Q150 12 300 38 T600 38 T900 38 T1200 38 V60 H0 Z" fill="currentColor" />
      </svg>
      <svg className="pointer-events-none absolute bottom-0 start-0 h-20 w-[200%] animate-wave text-white/10" style={{ animationDuration: '7s' }} viewBox="0 0 1200 60" preserveAspectRatio="none">
        <path d="M0 42 Q150 20 300 42 T600 42 T900 42 T1200 42 V60 H0 Z" fill="currentColor" />
      </svg>

      <div className="absolute end-4 top-4 z-30"><ThemeToggle onDark /></div>

      <div className="relative z-10 mx-auto grid min-h-screen max-w-6xl items-center gap-12 px-5 py-10 lg:grid-cols-[1.05fr_1fr]">
        {/* ══════════ LEFT — brand story ══════════ */}
        <motion.div initial={{ opacity: 0, x: -28 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.6 }} className="hidden text-white lg:block">
          <div className="mb-9 flex items-center gap-3">
            <div className="relative">
              <img src="logo.png" alt={translatePortalText("BoatPro")} className="h-14 w-14 object-contain drop-shadow-[0_0_22px_rgba(255,255,255,0.35)]" onError={e => ((e.target as HTMLImageElement).style.display = 'none')} />
            </div>
            <div>
              <p className="font-display text-3xl font-extrabold tracking-tight">BoatPro</p>
              <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-white/50">{translatePortalText("Provider Console")}</p>
            </div>
          </div>

          <h1 className="font-display text-[2.9rem] font-extrabold leading-[1.05]">
            {translatePortalText("One harbor.")}<br />
            <span className={active.textGrad}>{translatePortalText("Every provider.")}</span>
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-white/60">
            {translatePortalText("A single sign-in for marina operators, marine fuel suppliers and maintenance yards —\r\n            dock management, bunkering, repairs, billing and analytics in one connected platform.\r\n          ")}</p>

          {/* Continuous Promo video background */}
          <div className="relative mt-8 overflow-hidden rounded-[26px] border border-white/15 shadow-lift">
            <video src="videos/promo.mp4" autoPlay loop muted playsInline className="absolute inset-0 h-full w-full object-cover" />
            
            {/* crossfading role badge overlay */}
            <AnimatePresence mode="wait">
              <motion.div key={role} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }} className="relative h-52 w-full">
                <div className="absolute inset-0 bg-gradient-to-t from-deep-950 via-deep-950/40 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-5">
                  <p className="flex items-center gap-2.5 font-display text-lg font-bold">
                    <span className={`grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br ${active.accent} text-white shadow-glow`}>{active.icon}</span>
                    {translatePortalText(active.title)}
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {active.features.map((f, i) => (
                      <motion.span key={f} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 + i * 0.07 }}
                        className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[10.5px] font-semibold text-white/85 backdrop-blur ring-1 ring-white/15">
                        <Check size={11} className="text-white/70" />{translatePortalText(f)}
                      </motion.span>
                    ))}
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* live stats */}
          <div className="mt-7 grid grid-cols-3 gap-3">
            {STATS.map((s, i) => (
              <motion.div key={s.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 + i * 0.08 }}
                className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 backdrop-blur">
                <span className="mb-1 flex text-white/50">{s.icon}</span>
                <p className="font-display text-xl font-extrabold leading-none">{s.value}</p>
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-white/65">{translatePortalText(s.label)}</p>
              </motion.div>
            ))}
          </div>

          <div className="mt-6 flex items-center gap-5 text-[11px] font-semibold text-white/65">
            {/*
              "SOC 2 secured" was here. The platform holds no such attestation,
              and a SOC 2 claim is not decoration — it is a representation about
              an audit that either happened or did not, relied on by exactly the
              enterprise customers most likely to check. Replaced with what is
              actually true of every request: TLS, and support that genuinely
              exists in-app rather than a staffing promise nobody has made.
            */}
            <span className="flex items-center gap-1.5"><ShieldCheck size={14} className="text-emerald-400" /> {translatePortalText("Encrypted in transit")}</span>
            <span className="flex items-center gap-1.5"><Sparkles size={14} className="text-amber-300" /> {translatePortalText("In-app support")}</span>
          </div>
        </motion.div>

        {/* ══════════ RIGHT — auth card ══════════ */}
        <motion.div initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.1 }}
          className="mx-auto w-full max-w-[430px]">
          <div className="mb-6 text-center lg:hidden">
            <img src="logo.png" alt={translatePortalText("BoatPro")} className="mx-auto h-14 w-14 object-contain drop-shadow-[0_0_18px_rgba(255,255,255,0.35)]" onError={e => ((e.target as HTMLImageElement).style.display = 'none')} />
            <p className="mt-2 font-display text-2xl font-extrabold text-white">{translatePortalText("BoatPro Console")}</p>
          </div>

          <div className="card relative overflow-hidden !rounded-[28px] shadow-lift">
            {/* role-accent top bar */}
            <div className={`h-1.5 w-full bg-gradient-to-r ${active.accent}`} />

            <div className="p-6 md:p-7">
              {/* ── role dropdown (multi-user selector) ── */}
              <label className="label">{translatePortalText("Provider type")}</label>
              <div className="relative">
                <button type="button" onClick={() => setRoleOpen(o => !o)}
                  className={`flex w-full items-center gap-3 rounded-xl border bg-white px-3 py-2.5 text-left transition dark:bg-transparent ${roleOpen ? 'border-ocean-400 ring-4 ring-ocean-100' : 'border-slate-200 hover:border-ocean-300'}`}>
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br ${active.accent} text-white shadow-glow`}>{active.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-extrabold text-deep-900">{translatePortalText(active.title)}</span>
                    <span className="block text-[11px] text-slate-400">{translatePortalText(active.sub)}</span>
                  </span>
                  <ChevronDown size={18} className={`shrink-0 text-slate-400 transition-transform duration-300 ${roleOpen ? 'rotate-180' : ''}`} />
                </button>

                <AnimatePresence>
                  {roleOpen && (
                    <>
                      <div className="fixed inset-0 z-20" onClick={() => setRoleOpen(false)} />
                      <motion.div initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.98 }}
                        transition={{ duration: 0.16 }}
                        className="card absolute start-0 end-0 top-full z-30 mt-2 overflow-hidden !rounded-xl !p-1.5 shadow-lift">
                        {ROLES.map(r => (
                          <button key={r.key} type="button" onClick={() => { setRole(r.key); setRoleOpen(false) }}
                            className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition ${role === r.key ? 'bg-ocean-50/70' : 'hover:bg-sand'}`}>
                            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br ${r.accent} text-white`}>{r.icon}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[13px] font-extrabold text-deep-900">{translatePortalText(r.title)}</span>
                              <span className="block text-[11px] text-slate-400">{translatePortalText(r.sub)}</span>
                            </span>
                            {role === r.key && <Check size={16} className="shrink-0 text-ocean-600" />}
                          </button>
                        ))}
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>

              {/* Why the role and the tab were chosen for them. Without this
                  the pre-selection reads as the screen guessing. */}
              {!!pendingInvite && (
                <div className="mt-4 rounded-xl bg-amber-50 px-3.5 py-3 ring-1 ring-amber-100">
                  <p className="text-[12px] font-extrabold text-amber-800">{translatePortalText("You’re joining on an invited plan")}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-amber-700">
                    {translatePortalText("Create your account and your plan is applied automatically — code")}{' '}
                    <code className="font-extrabold">{pendingInvite}</code>
                  </p>
                </div>
              )}

              {/* mode tabs */}
              <div className="mt-5 flex rounded-xl bg-sand p-1 text-[13px] font-bold">
                {(['signin', 'signup'] as Mode[]).map(m => (
                  <button key={m} type="button" onClick={() => setMode(m)}
                    className={`relative flex-1 rounded-lg py-2 transition-colors ${mode === m ? 'text-deep-900' : 'text-slate-400 hover:text-deep-800'}`}>
                    {mode === m && <motion.span layoutId="mode-pill" transition={{ type: 'spring', damping: 26, stiffness: 320 }} className="absolute inset-0 rounded-lg bg-white shadow-soft dark:bg-white/10" />}
                    <span className="relative z-10">{translatePortalText(m === 'signin' ? 'Sign in' : 'Create account')}</span>
                  </button>
                ))}
              </div>

              <div className="mt-5">
                <h2 className="font-display text-xl font-extrabold text-deep-900">
                  {translatePortalText(mode === 'signin' ? `Sign in to ${roleWord}` : `Create your ${roleWord} account`)}
                </h2>
                <p className="mt-1 text-xs text-slate-400">{translatePortalText(active.blurb)}</p>
                {/* Not for Super Admin: that account cannot be created here at all. */}
                {fakeFillOn && mode === 'signup' && role !== 'admin' && role !== 'agent' && (
                  <FakeFillButton onClick={fakeFill} className="mt-3" />
                )}
              </div>

              {mfa ? (
                <form onSubmit={submitMfa} className="mt-5 space-y-4">
                  <div className="rounded-xl bg-emerald-50 px-3.5 py-3 ring-1 ring-emerald-100 dark:bg-emerald-500/10 dark:ring-emerald-500/20">
                    <p className="flex items-center gap-2 text-[13px] font-extrabold text-emerald-800 dark:text-emerald-300">
                      <ShieldCheck size={15} /> {translatePortalText('Check your email')}
                    </p>
                    <p className="mt-1 text-[12px] leading-relaxed text-emerald-700 dark:text-emerald-200/80">
                      {translatePortalText('We sent a 6-digit sign-in code to')}{' '}
                      <span dir="ltr" className="font-bold">{mfa.emailHint}</span>.{' '}
                      {translatePortalText('It expires in 10 minutes.')}
                    </p>
                  </div>

                  <div>
                    <label className="label" htmlFor="mfa-code">{translatePortalText('Sign-in code')}</label>
                    <div className="relative">
                      <Lock size={15} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input {...fe.field('mfaCode')} id="mfa-code" autoFocus required inputMode="numeric" autoComplete="one-time-code" maxLength={6} dir="ltr"
                        value={mfaCode} onChange={e => { setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6)); clearErr('mfaCode') }} placeholder="123456"
                        className={`input ps-10 text-lg font-bold tracking-[0.4em] ${fieldErrors.mfaCode ? '!border-rose-400 !ring-2 !ring-rose-100' : ''}`} />
                    </div>
                    <AnimatePresence>{fieldErrors.mfaCode && <FieldWarning>{fieldErrors.mfaCode}</FieldWarning>}</AnimatePresence>
                    <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                      <span>{translatePortalText("Didn't get it? Check spam, or")}</span>
                      <button type="button" onClick={() => void resendMfa()} disabled={resendIn > 0 || mfaResending}
                        className="font-bold text-ocean-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline">
                        {mfaResending
                          ? translatePortalText('Sending…')
                          : resendIn > 0
                            ? `${translatePortalText('Resend code in')} ${Math.floor(resendIn / 60)}:${String(resendIn % 60).padStart(2, '0')}`
                            : translatePortalText('Resend code')}
                      </button>
                    </div>
                  </div>

                  <motion.button whileTap={{ scale: 0.97 }} type="submit" disabled={mfaBusy || mfaCode.length !== 6}
                    className={`${active.btn} w-full !justify-center !py-3 !text-sm disabled:opacity-70`}>
                    {mfaBusy ? (
                      <span className="flex items-center gap-2"><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> {translatePortalText('Verifying…')}</span>
                    ) : (
                      <>{translatePortalText('Verify and sign in')} <ArrowRight size={16} /></>
                    )}
                  </motion.button>

                  <button type="button" onClick={leaveMfa} className="w-full text-center text-xs font-bold text-slate-500 hover:text-deep-900 hover:underline">
                    {translatePortalText('← Back to sign in')}
                  </button>
                </form>
              ) : (
              <form onSubmit={submit} className="mt-5 space-y-4">
                <AnimatePresence initial={false}>
                  {mode === 'signup' && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                      <label className="label">{translatePortalText("Business name")}</label>
                      <div className="relative">
                        <Building2 size={15} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input required={mode === 'signup'} value={org} onChange={e => { setOrg(e.target.value); clearErr('org') }} placeholder={translatePortalText("Azure Bay Marina")}
                          className={`input ps-10 ${fieldErrors.org ? '!border-rose-400 !ring-2 !ring-rose-100' : ''}`} />
                      </div>
                      <AnimatePresence>{fieldErrors.org && <FieldWarning>{fieldErrors.org}</FieldWarning>}</AnimatePresence>
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence initial={false}>
                  {mode === 'signup' && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                      <label className="label">{translatePortalText("Mobile number")}</label>
                      <div className="relative">
                        <Phone size={15} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input required={mode === 'signup'} type="tel" value={phone} onChange={e => { setPhone(e.target.value); clearErr('phone') }} placeholder="+966 50 123 4567"
                          className={`input ps-10 ${fieldErrors.phone ? '!border-rose-400 !ring-2 !ring-rose-100' : ''}`} />
                      </div>
                      <AnimatePresence>{fieldErrors.phone && <FieldWarning>{fieldErrors.phone}</FieldWarning>}</AnimatePresence>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div>
                  <label className="label">{translatePortalText("Email address")}</label>
                  <div className="relative">
                    <Mail size={15} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input required type="email" value={email} onChange={e => { setEmail(e.target.value); clearErr('email') }} placeholder={active.email}
                      className={`input ps-10 ${fieldErrors.email ? '!border-rose-400 !ring-2 !ring-rose-100' : ''}`} />
                  </div>
                  <AnimatePresence>{fieldErrors.email && <FieldWarning>{fieldErrors.email}</FieldWarning>}</AnimatePresence>
                </div>

                <div>
                  <label className="label">{translatePortalText("Password")}</label>
                  <div className="relative">
                    <Lock size={15} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input required type={showPw ? 'text' : 'password'} value={pw} onChange={e => { setPw(e.target.value); clearErr('pw') }}
                      placeholder="••••••••" className={`input ps-10 pe-11 ${pwTooShort || fieldErrors.pw ? '!border-rose-400 !ring-2 !ring-rose-100' : ''}`} />
                    <button type="button" onClick={() => setShowPw(s => !s)} className="absolute end-3 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-deep-900">
                      {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <AnimatePresence>{(pwTooShort || fieldErrors.pw) && <FieldWarning>{fieldErrors.pw || 'Password must be at least 8 characters'}</FieldWarning>}</AnimatePresence>
                </div>

                <AnimatePresence initial={false}>
                  {mode === 'signup' && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                      <label className="label">{translatePortalText("Confirm password")}</label>
                      <div className="relative">
                        <Lock size={15} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input required={mode === 'signup'} type={showPw ? 'text' : 'password'} value={confirm} onChange={e => { setConfirm(e.target.value); clearErr('confirm') }}
                          placeholder="••••••••" className={`input ps-10 ${pwMismatch || fieldErrors.confirm ? '!border-rose-400 !ring-2 !ring-rose-100' : ''}`} />
                      </div>
                      <AnimatePresence>{(pwMismatch || fieldErrors.confirm) && <FieldWarning>{fieldErrors.confirm || "Passwords don't match"}</FieldWarning>}</AnimatePresence>
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence initial={false}>
                  {otpStep && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                      <label className="label">{translatePortalText("Email verification code")}</label>
                      <div className="relative">
                        <ShieldCheck size={15} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input {...fe.field('emailOtpCode')} required inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                          value={otpCode} onChange={e => { setOtpCode(e.target.value.replace(/\D/g, '')); clearErr('emailOtpCode') }} placeholder="123456"
                          className={`input ps-10 tracking-[0.3em] ${fieldErrors.emailOtpCode ? '!border-rose-400 !ring-2 !ring-rose-100' : ''}`} />
                      </div>
                      <AnimatePresence>{fieldErrors.emailOtpCode && <FieldWarning>{fieldErrors.emailOtpCode}</FieldWarning>}</AnimatePresence>
                      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                        <span>{translatePortalText("Sent to your email · expires in 10 minutes")}</span>
                        <button type="button" onClick={() => void sendSignupCode()} disabled={otpSending} className="font-bold text-ocean-600 hover:underline disabled:opacity-60">
                          {translatePortalText(otpSending ? 'Sending…' : 'Resend code')}
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {mode === 'signin' ? (
                  <div className="flex items-center justify-between text-xs">
                    <label className="flex cursor-pointer items-center gap-2 font-semibold text-slate-500">
                      {/* Now actually applied — see `setSessionPersistence` in api.ts.
                          Unticked keeps the session in `sessionStorage`, so closing
                          the browser ends it, which is what a shared dockside
                          machine needs and what this control has always implied. */}
                      <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 accent-ocean-500" />
                      {translatePortalText("Keep me signed in on this device\r\n                    ")}</label>
                    <button type="button" onClick={openForgot} className="font-bold text-ocean-600 hover:underline">{translatePortalText("Forgot password?")}</button>
                  </div>
                ) : (
                  <div>
                    <label className="flex cursor-pointer items-start gap-2 text-[11px] leading-snug text-slate-500">
                      <input
                        id="terms"
                        type="checkbox"
                        checked={acceptedTerms}
                        onChange={e => { setAcceptedTerms(e.target.checked); clearErr('terms') }}
                        className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded accent-ocean-500 ${fieldErrors.terms ? 'border-rose-400 ring-2 ring-rose-100' : 'border-slate-300'}`}
                      />
                      <span>
                        {translatePortalText("I agree to BoatPro's")}{' '}
                        {/*
                          The Terms are deliberately not a link. Both of these used
                          to be link-coloured `<span>`s with no `href` — a provider
                          was asked to agree to two documents neither of which they
                          could open. The Privacy Policy ships with this portal
                          (`public/privacy.html`) and the backend publishes it at
                          `/privacy`, so that one becomes a real link. There is no
                          published Terms of Service anywhere on the platform yet —
                          only unconverted .docx files in the repository — and a
                          link to a 404 is not better than plain text. Publish it
                          and this becomes an anchor like the one beside it.
                        */}
                        <span className="font-semibold text-slate-600 dark:text-slate-300">{translatePortalText("Terms of Service")}</span> &amp;{' '}
                        <a
                          href="privacy.html"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-bold text-ocean-600 underline decoration-ocean-300 underline-offset-2 hover:decoration-ocean-600"
                        >
                          {translatePortalText("Privacy Policy\r\n                        ")}</a>
                        .
                      </span>
                    </label>
                    <AnimatePresence>{fieldErrors.terms && <FieldWarning>{fieldErrors.terms}</FieldWarning>}</AnimatePresence>
                  </div>
                )}

                <motion.button whileTap={{ scale: 0.97 }} type="submit" disabled={busy || otpSending || pwMismatch || pwTooShort}
                  className={`${active.btn} w-full !justify-center !py-3 !text-sm disabled:opacity-70`}>
                  {busy || otpSending ? (
                    <span className="flex items-center gap-2"><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> {translatePortalText(mode === 'signin' ? 'Signing in…' : otpSending ? 'Sending code…' : 'Creating account…')}</span>
                  ) : (
                    <>{translatePortalText(mode === 'signin' ? `Sign in as ${active.title}` : otpStep ? `Create ${active.title} account` : 'Verify email to continue')} <ArrowRight size={16} /></>
                  )}
                </motion.button>
              </form>
              )}

              {/*
                An "or continue with" divider sat here over two buttons —
                "Single Sign-On" and "Phone OTP" — that answered with "coming
                soon". Neither method exists: there is no identity provider
                configured and no OTP flow in the API.

                Saying "coming soon" is at least honest about the click, but the
                buttons themselves are not: a provider arriving at this screen
                is shown three ways in and only one of them is real, and the two
                that are not are the ones somebody locked out of their password
                will reach for first. Removed until there is something behind
                them — password sign-in and the reset link below both work.
              */}

              <p className="mt-5 text-center text-xs text-slate-400">
                {mode === 'signin' ? (
                  <>{translatePortalText("New to BoatPro? ")}<button type="button" onClick={() => setMode('signup')} className="font-bold text-ocean-600 hover:underline">{translatePortalText("Create an account")}</button></>
                ) : (
                  <>{translatePortalText("Already have an account? ")}<button type="button" onClick={() => setMode('signin')} className="font-bold text-ocean-600 hover:underline">{translatePortalText("Sign in")}</button></>
                )}
              </p>
            </div>
          </div>

          {/* `2026` was hardcoded here while `Layout.tsx` already derived it; a
              footer that starts lying at midnight on new year is not worth the
              three characters it saves. "Privacy" is an anchor for the same
              reason as the one on the consent line above. */}
          <p className="mt-5 flex items-center justify-center gap-2 text-center text-[11px] text-white/65">
            <User size={12} /> © {new Date().getFullYear()} <a href="https://boatpro.club" target="_blank" rel="noopener noreferrer" className="hover:text-white">BoatPro</a> · {translatePortalText("Provider Console")} ·{' '}
            <a href="privacy.html" target="_blank" rel="noopener noreferrer" className="underline hover:text-white/70">{translatePortalText("Privacy")}</a>
          </p>
        </motion.div>
      </div>

      <Modal open={forgotOpen} onClose={() => setForgotOpen(false)} title={translatePortalText("🔑 Reset your password")}>
        {forgotStep === 'email' ? (
          <div className="space-y-3">
            <p className="text-xs text-slate-400">{translatePortalText("Enter the email on your account — we'll send a reset code.")}</p>
            <input type="email" className="input" value={forgotEmail} onChange={e => setForgotEmail(e.target.value)} placeholder={translatePortalText("you@company.com")} />
            <button onClick={sendResetCode} disabled={forgotBusy} className="btn-primary w-full !justify-center disabled:opacity-70">{translatePortalText(forgotBusy ? 'Sending…' : 'Send Reset Code')}</button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-slate-400">{translatePortalText("Enter the code sent to ")}{forgotEmail} {translatePortalText("and choose a new password.")}</p>
            <input className="input" value={forgotCode} onChange={e => setForgotCode(e.target.value)} placeholder={translatePortalText("Reset code")} />
            <input type="password" className="input" value={forgotNewPw} onChange={e => setForgotNewPw(e.target.value)} placeholder={translatePortalText("New password")} />
            <button onClick={submitReset} disabled={forgotBusy} className="btn-primary w-full !justify-center disabled:opacity-70">{translatePortalText(forgotBusy ? 'Resetting…' : 'Reset password')}</button>
          </div>
        )}
      </Modal>
    </div>
  )
}
