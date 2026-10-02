import React, { useState, useEffect } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  BarChart3, Radar, Bot, Shield,
  ShieldAlert, Ban, Eye, Sparkles, Cpu, ArrowRight, SlidersHorizontal,
} from 'lucide-react'
import { AIMG } from '../adminData'
import { PageWrap } from './_shared'
import { AIInstructionsModal } from './AIInstructions'
import { Section, toast, Toggle, Img } from '../../ui'
import { AdminHeader } from '../adminUi'
import { adminPortalApi } from '../../api'
import type { ReportCatalogEntry } from '../../api/platform'
import { translatePortalText, translatePortalTemplate, formatPortalNumber } from '../../i18n/runtime'
import { ReportsCenter, type CustomReport } from '../../shared/reports/ReportsCenter'
import { AdminReportsSnapshot } from './AdminReportsSnapshot'
import { ProviderReport } from '../../shared/reports/ProviderReport'

// ══════════ REPORTS & ANALYTICS (§17, §33) ══════════
const FinancialReports = React.lazy(() => import('./AdminMoney').then(m => ({ default: m.AdminFinancialReports })))

/**
 * The Excel revenue workbook, listed beside the registry reports.
 *
 * It used to be a "Finance" tab next to an "Analytics" tab, two views of the same
 * page that both showed revenue by service. It has its own screen and its own
 * multi-sheet download that no registry report reproduces, so it stays — as one
 * entry in the same list as every other report, opened the same way.
 */
const FINANCE_SUMMARY: ReportCatalogEntry = {
  key: 'finance-summary',
  label: 'Platform revenue statement',
  group: 'finance',
  vertical: 'admin',
  description: 'Commission and subscription revenue for a period, by service line, payment model and provider — with a multi-sheet Excel download.',
  dateRanged: false,
}

/**
 * Reports & Analytics: an overview, and every report the platform can run.
 *
 * This page used to be the overview, a grid of sixteen shortcut tiles, a second
 * "Finance" tab, and — under all of it — the forty-eight-report library with its own
 * index and its own toolbar. Three ways in to the same reports, and no way to tell
 * which one to use. It is now one path: glance at the numbers, find a report, open
 * it, download it. See `ReportsCenter`.
 */
export function AdminReports() {
  const [params] = useSearchParams()
  // The old Finance tab lives at /admin/reports/finance-summary now; links and
  // bookmarks to `?tab=finance` still land on it.
  if (params.get('tab') === 'finance') return <Navigate to="/admin/reports/finance-summary" replace />

  const custom: CustomReport[] = [
    {
      entry: FINANCE_SUMMARY,
      render: () => (
        <React.Suspense fallback={<div className="card h-72 animate-pulse bg-slate-50" />}>
          <FinancialReports />
        </React.Suspense>
      ),
    },
    // One provider, everything about them. A server report with a screen of its
    // own: the provider picker is the whole point, not a filter behind a button.
    { serverKey: 'provider-profile', render: () => <ProviderReport tone="emerald" /> },
  ]

  return (
    <ReportsCenter
      portal="admin"
      basePath="/admin/reports"
      tone="emerald"
      custom={custom}
      header={
        <AdminHeader
          title="Reports & Analytics"
          sub="How the platform is doing at a glance, and every report you can open or download."
          icon={<BarChart3 className="text-emerald-500" />}
        />
      }
      snapshot={<AdminReportsSnapshot />}
    />
  )
}

// ══════════ FRAUD & SECURITY (§30, §37) ══════════
type SecurityCategory = 'signin' | 'reset' | 'signup' | 'policies';

const SECURITY_CATEGORIES: { id: SecurityCategory; label: string; icon: string; desc: string }[] = [
  { id: 'signin', label: 'Sign-in Methods', icon: '🔑', desc: 'Credentials and passwordless options users can authenticate with' },
  { id: 'reset', label: 'Password Recovery', icon: '🔄', desc: 'Verification channels available when a user requests a password reset' },
  { id: 'signup', label: 'Registration', icon: '📝', desc: 'Allowed onboarding methods for new customer accounts' },
  { id: 'policies', label: 'Security Policies', icon: '🛡️', desc: 'Enterprise password rules, session controls, and brute-force protection' },
];

const SECURITY_META: Record<string, { name: string; desc: string; icon: string; category: SecurityCategory; badge: string }> = {
  auth_email_password: {
    category: 'signin',
    name: 'Email & Password Sign-in',
    desc: 'Allow users to sign in with email address and password',
    icon: '🔑',
    badge: 'Standard',
  },
  auth_phone_otp: {
    category: 'signin',
    name: 'Phone & SMS OTP Sign-in',
    desc: 'Allow users to sign in with mobile number and instant SMS verification code',
    icon: '📱',
    badge: 'Mobile-first',
  },
  auth_email_otp: {
    category: 'signin',
    name: 'Email OTP & Magic Link Sign-in',
    desc: 'Send a 6-digit code and direct magic link to the user email (disabled by default)',
    icon: '✉️',
    badge: 'Passwordless',
  },
  reset_password_email: {
    category: 'reset',
    name: 'Reset via Email Code / Link',
    desc: 'Send a 6-digit password reset code to user verified email address',
    icon: '📧',
    badge: 'Primary Recovery',
  },
  reset_password_phone_sms: {
    category: 'reset',
    name: 'Reset via Phone SMS OTP',
    desc: 'Allow users to recover account and set new password using Firebase SMS verification',
    icon: '💬',
    badge: 'SMS Recovery',
  },
  signup_email_password: {
    category: 'signup',
    name: 'Customer Signup via Email',
    desc: 'Allow new customers to register using an email address and password',
    icon: '📨',
    badge: 'Customer Onboarding',
  },
  signup_phone_otp: {
    category: 'signup',
    name: 'Customer Signup via Phone Number',
    desc: 'Allow new customers to register by verifying their phone number via SMS OTP',
    icon: '📲',
    badge: 'Verified Mobile',
  },
  require_strong_password: {
    category: 'policies',
    name: 'Enforce Strong Password Complexity',
    desc: 'Require at least 8 characters with uppercase, lowercase, numbers, and symbols',
    icon: '💪',
    badge: 'NIST Standard',
  },
  single_session_enforcement: {
    category: 'policies',
    name: 'Single Active Session Enforcement',
    desc: 'Automatically revoke other active sessions when a user signs in on a new device',
    icon: '🛑',
    badge: 'Anti-Sharing',
  },
  failed_login_lockout: {
    category: 'policies',
    name: 'Automated Failed-Login Lockout',
    desc: 'Temporarily lock accounts after 5 consecutive incorrect password attempts',
    icon: '🚫',
    badge: 'Brute-Force Guard',
  },
  two_factor_required: {
    category: 'policies',
    name: 'Two-Factor Authentication (2FA)',
    desc: 'Mandatory 2FA code requirement for all administrator and marina staff roles',
    icon: '🔐',
    badge: 'Admin Only',
  },
  session_timeout: {
    category: 'policies',
    name: 'Inactivity Session Timeout',
    desc: 'Automatically sign out idle sessions after 30 minutes of inactivity',
    icon: '⏱️',
    badge: 'Compliance',
  },
  password_rotation: {
    category: 'policies',
    name: 'Periodic Password Rotation',
    desc: 'Prompt users to change passwords every 90 days',
    icon: '🔁',
    badge: 'Enterprise',
  },
  ip_whitelisting: {
    category: 'policies',
    name: 'IP CIDR Whitelisting',
    desc: 'Restrict super-admin portal access to designated corporate IP ranges',
    icon: '🌐',
    badge: 'Network Guard',
  },
};

/**
 * Security & Auth — sign-in options, recovery channels and platform security
 * policies.
 *
 * This page used to be "Fraud & Security" and also carried the customer fraud
 * alerts (chargeback patterns, cancel/rebook bots, refund abuse). Those moved to
 * Risk & Fraud → Customers, next to every other fraud decision, so an admin
 * looking for fraud does not have to know it was filed under sign-in settings.
 */
export function AdminFraud() { return <SecurityPage /> }
function SecurityPage() {
  const [settings, setSettings] = useState<{ key: string; enabled: boolean }[]>([])
  const [activeCategory, setActiveCategory] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const navigate = useNavigate()

  useEffect(() => {
    adminPortalApi.securitySettings().then(res => setSettings(res.data.settings)).catch(() => toast(translatePortalText('Could not load security settings'), 'warn'))
  }, [])

  const toggleSetting = (key: string, v: boolean) => {
    adminPortalApi.updateSecuritySetting(key, v).then(() => { setSettings(p => p.map(s => s.key === key ? { ...s, enabled: v } : s)); toast(translatePortalText(`${SECURITY_META[key]?.name || key} ${v ? 'enabled' : 'disabled'}`)) }).catch(() => toast(translatePortalText('Could not update setting'), 'warn'))
  }

  return (
    <PageWrap>
      <AdminHeader
        title={translatePortalText('Security & Auth')}
        sub={translatePortalText('Sign-in options, password recovery channels, onboarding methods and platform security policies')}
        icon={<Radar className="text-emerald-500" />}
        actions={<button className="btn-ghost" onClick={() => navigate('/admin/risk?tab=customers')}><ShieldAlert size={15} /> {translatePortalText('Customer fraud alerts moved to Risk & Fraud')}</button>}
      />

      <Section
        title={translatePortalText('Authentication & Security Command Center')}
        sub={translatePortalText('Control user sign-in options, password recovery channels, onboarding methods, and platform security policies')}
        actions={
          <div className="flex items-center gap-2">
            <div className="relative">
              <input
                type="text"
                placeholder={translatePortalText('Search settings...')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-48 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 placeholder-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute end-2.5 top-1.5 text-xs text-slate-400 hover:text-slate-600"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        }
      >
        {/* Category Filter Tabs */}
        <div className="mb-6 flex flex-wrap items-center gap-2 border-b border-slate-100 pb-4">
          <button
            onClick={() => setActiveCategory('all')}
            className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition-all ${
              activeCategory === 'all'
                ? 'bg-deep-900 text-white shadow-soft'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <span>🌐</span>
            <span>{translatePortalText('All Settings')}</span>
            <span className={`ms-1 rounded-full px-1.5 py-0.5 text-[10px] ${activeCategory === 'all' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'}`}>
              {formatPortalNumber(settings.length)}
            </span>
          </button>

          {SECURITY_CATEGORIES.map((cat) => {
            const count = settings.filter((s) => SECURITY_META[s.key]?.category === cat.id).length;
            const enabledCount = settings.filter((s) => SECURITY_META[s.key]?.category === cat.id && s.enabled).length;
            const active = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition-all ${
                  active
                    ? 'bg-deep-900 text-white shadow-soft'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <span>{cat.icon}</span>
                <span>{translatePortalText(cat.label)}</span>
                <span className={`ms-1 rounded-full px-1.5 py-0.5 text-[10px] ${active ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'}`}>
                  {formatPortalNumber(enabledCount)}/{formatPortalNumber(count)}
                </span>
              </button>
            );
          })}
        </div>

        {/* Grouped Category Sections */}
        <div className="space-y-6">
          {(activeCategory === 'all' ? SECURITY_CATEGORIES : SECURITY_CATEGORIES.filter((c) => c.id === activeCategory)).map((cat) => {
            const catSettings = settings.filter((s) => {
              const meta = SECURITY_META[s.key];
              if (!meta || meta.category !== cat.id) return false;
              if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase();
                const name = translatePortalText(meta.name);
                const desc = translatePortalText(meta.desc);
                return meta.name.toLowerCase().includes(q) || meta.desc.toLowerCase().includes(q) || name.toLowerCase().includes(q) || desc.toLowerCase().includes(q);
              }
              return true;
            });

            if (catSettings.length === 0) return null;
            const enabledCount = catSettings.filter((s) => s.enabled).length;

            return (
              <div key={cat.id} className="rounded-2xl border border-slate-100 bg-white p-5 shadow-soft">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-lg">{cat.icon}</span>
                    <div>
                      <h3 className="text-sm font-extrabold text-deep-900">{translatePortalText(cat.label)}</h3>
                      <p className="text-xs text-slate-400">{translatePortalText(cat.desc)}</p>
                    </div>
                  </div>
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                    {formatPortalNumber(enabledCount)} {translatePortalText('of')} {formatPortalNumber(catSettings.length)} {translatePortalText('active')}
                  </span>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  {catSettings.map((s) => {
                    const meta = SECURITY_META[s.key] || { name: s.key, desc: '', icon: '⚙️', badge: '', category: 'policies' };
                    return (
                      <div
                        key={s.key}
                        className={`flex items-start justify-between gap-4 rounded-xl border p-4 transition-all ${
                          s.enabled ? 'border-slate-200/80 bg-slate-50/40 hover:bg-slate-50' : 'border-slate-100 bg-white opacity-80'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-xl shadow-soft">
                            {meta.icon}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-bold text-deep-900">{translatePortalText(meta.name)}</p>
                              {meta.badge && (
                                <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                                  {translatePortalText(meta.badge)}
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-xs leading-relaxed text-slate-500">{translatePortalText(meta.desc)}</p>
                            <div className="mt-2.5 flex items-center gap-2">
                              <span
                                className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
                                  s.enabled ? 'text-emerald-600' : 'text-slate-400'
                                }`}
                              >
                                <span className={`h-1.5 w-1.5 rounded-full ${s.enabled ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                                {s.enabled ? translatePortalText('Service Enabled') : translatePortalText('Disabled')}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="pt-1">
                          <Toggle on={s.enabled} onChange={(v) => toggleSetting(s.key, v)} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </Section>
    </PageWrap>
  )
}

// ══════════ AI MANAGEMENT (§32) ══════════
/**
 * The AI systems an admin can switch. Each toggle changes live behaviour:
 * the chat assistant answering support threads, document fraud screening, and
 * review screening. Anything the server returns that is not listed here is
 * ignored, so a module retired on the backend cannot reappear as a dead switch.
 *
 * Document reading is listed too, for its instructions only: uploads always
 * have to be read, so the server marks it `switchable: false` and it shows
 * "Always on" instead of a toggle.
 */
const AI_META: Record<string, { name: string; desc: string; off: string; icon: string }> = {
  chat_assistant: {
    name: 'AI Chat Assistant',
    desc: 'Answers support chats first and hands off to a person when asked',
    off: 'Off: every support message goes straight to an available agent, or to the admin desk when none is online',
    icon: '💬',
  },
  fraud_detection: {
    name: 'Fraud detection',
    desc: 'Flags false documents, deals moved off BoatPro in chat, linked provider accounts, fake review rings, and copied or bait-priced listings',
    off: 'Off: none of these are flagged to Risk & Fraud; uploads are still read and checked for review',
    icon: '🛡️',
  },
  content_moderation: {
    name: 'Content moderation',
    desc: 'Screens every review (hiding the ones that cross the line) and every chat for abusive language',
    off: 'Off: reviews publish as written and chats are not screened; admins can still take reviews down by hand',
    icon: '🧿',
  },
  document_reading: {
    name: 'Document reading',
    desc: 'Reads uploaded documents, boat papers, crew licences and vessel photos: fills in their details and checks them before anyone reviews them',
    off: '',
    icon: '📄',
  },
}
export function AdminAI() { return <AIPage /> }
function AIPage() {
  const navigate = useNavigate()
  const [mods, setMods] = useState<{ key: string; enabled: boolean; switchable?: boolean; metric: string; instructions?: { prompts: number; customised: number; rules: number } }[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const loadModules = () => adminPortalApi.aiModules().then(res => setMods(res.data.modules.filter(m => AI_META[m.key]))).catch(() => toast(translatePortalText('Could not load AI modules'), 'warn'))
  useEffect(() => { loadModules() }, [])
  const toggle = (key: string, v: boolean) => {
    adminPortalApi.updateAIModule(key, v).then(res => {
      setMods(p => p.map(m => m.key === key ? { ...m, enabled: v } : m))
      const moved = res.data.handedOff ?? 0
      const back = res.data.reclaimed ?? 0
      toast(translatePortalText(`${AI_META[key]?.name || key} ${v ? 'enabled' : 'disabled'}`) +
        (moved ? ` — ${formatPortalNumber(moved)} ${translatePortalText('open chats handed to support agents')}` : '') +
        (back ? ` — ${formatPortalNumber(back)} ${translatePortalText('chats given back to the AI')}` : ''))
    }).catch(() => toast(translatePortalText('Could not update module'), 'warn'))
  }
  // The banner counts switches; document reading has none.
  const switches = mods.filter(m => m.switchable !== false)
  const enabledCount = switches.filter(m => m.enabled).length
  return (
    <PageWrap>
      <AdminHeader
        title={translatePortalText('AI Management')}
        sub={translatePortalText('Support chat assistant, document fraud screening & review moderation')}
        icon={<Bot className="text-emerald-500" />}
      />

      {/* hero banner */}
      <motion.div initial={{ opacity: 0, scale: 0.99 }} animate={{ opacity: 1, scale: 1 }} className="relative mb-5 overflow-hidden rounded-3xl text-white shadow-lift">
        <Img src={AIMG.servers} className="absolute inset-0 h-full w-full opacity-30" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#041410]/90 via-[#062b22]/60 to-transparent" />
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-6 p-6 md:p-8">
          <div>
            <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.22em] text-emerald-300"><Sparkles size={14} /> {translatePortalText('BoatPro Intelligence')}</p>
            <h2 className="mt-2 font-display text-2xl font-extrabold md:text-3xl">{formatPortalNumber(enabledCount)} {translatePortalText('of')} {formatPortalNumber(switches.length)} {translatePortalText('AI systems enabled')}</h2>
            <p className="mt-1 max-w-lg text-sm text-white/70">{translatePortalText('Every switch takes effect immediately. Flagged documents and reviews land in Risk & Fraud for an admin to confirm or clear.')}</p>
          </div>
        </div>
      </motion.div>

      <div className="grid gap-4 md:grid-cols-2">
        {mods.map((m, i) => (
          <motion.div key={m.key} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="card p-5">
            <div className="flex items-start gap-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500/15 to-teal-500/10 text-2xl">{AI_META[m.key]?.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><p className="font-display text-[15px] font-extrabold text-deep-900">{translatePortalText(AI_META[m.key]?.name || m.key)}</p></div>
                <p className="mt-0.5 text-xs text-slate-500">{translatePortalText(AI_META[m.key]?.desc || '')}</p>
                {!m.enabled && <p className="mt-1.5 text-[11px] font-semibold text-amber-600">{translatePortalText(AI_META[m.key]?.off || '')}</p>}
              </div>
              {m.switchable === false
                ? <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">{translatePortalText('Always on')}</span>
                : <Toggle on={m.enabled} onChange={v => toggle(m.key, v)} />}
            </div>
            <div className="mt-4 flex items-center justify-between rounded-xl bg-sand px-3 py-2.5">
              <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400"><Shield size={12} /> {translatePortalText('Activity')}</span>
              <b className="text-sm text-emerald-600">{translatePortalText(m.metric)}</b>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <button onClick={() => setEditing(m.key)} className="btn-ghost !py-1.5 !px-2.5 !text-[11px]">
                  <SlidersHorizontal size={12} /> {translatePortalText('Instructions')}
                </button>
                {m.instructions && (
                  <span className={`truncate text-[11px] font-semibold ${m.instructions.customised ? 'text-amber-700' : 'text-slate-400'}`}>
                    {!m.instructions.customised
                      ? translatePortalText('Built-in')
                      : m.instructions.rules === 0
                        ? translatePortalText('Customised')
                        : m.instructions.rules === 1
                        ? translatePortalText('Customised · 1 rule')
                        : translatePortalTemplate('Customised · {{count}} rules', { count: formatPortalNumber(m.instructions.rules) })}
                  </span>
                )}
              </div>
              {(m.key === 'fraud_detection' || m.key === 'content_moderation') && (
                <button onClick={() => navigate('/admin/risk')} className="inline-flex items-center gap-1 text-[11px] font-bold text-ocean-700 hover:underline">
                  {translatePortalText('Open Risk & Fraud')} <ArrowRight size={11} />
                </button>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      <AIInstructionsModal
        moduleKey={editing}
        moduleName={(editing && AI_META[editing]?.name) || ''}
        onClose={() => setEditing(null)}
        onSaved={loadModules}
      />
    </PageWrap>
  )
}
