import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, Check, FlaskConical, Minus, Monitor, Smartphone } from 'lucide-react'
import { AdminHeader } from '../adminUi'
import { PageWrap } from './_shared'
import { Spinner, toast } from '../../ui'
import { translatePortalText  , formatPortalDate} from '../../i18n/runtime'
import { confirm } from '../../async'
import { errorMessage } from '../../async/errors'
import { testingToolsApi, type ApiTestingTools } from '../../api'

// ══════════ TESTING TOOLS ══════════
//
// Switches for tools that only exist to make manual testing faster. Today that
// is the "Fake fill" button on the provider signup and registration forms. The
// server owns the switch (TestingToolsSettings) and the forms read it every time
// they open, so a change here reaches the next form anyone opens — no deploy, no
// app update.

/** Where the button shows up, so an admin knows what they are switching on. */
const SURFACES: { app: string; icon: React.ReactNode; forms: string[] }[] = [
  {
    app: 'Provider app',
    icon: <Smartphone size={15} />,
    forms: ['Sign up (charter operators and scuba divers)', 'Provider onboarding — business, documents, billing', 'Marina, fuel and maintenance registration wizard'],
  },
  {
    app: 'Vendor portal',
    icon: <Monitor size={15} />,
    forms: ['Create account (marina, fuel, maintenance)', 'Registration wizard — every step from identity to emergency info'],
  },
]

const FILLS = [
  'Owner and business names, in English and Arabic',
  'Mobile and emergency numbers in the right country format',
  'CR number, website and VHF channel',
  'The VAT certificate question — yes or no at random, with a VAT number only on a yes',
  'A real coastal location, city and region',
  'Working days and opening hours',
  'Bank details with a valid Saudi IBAN',
  'A payment model and package',
  'Descriptions and emergency procedures',
]

const LEAVES = [
  'Email addresses and passwords — the tester signs in with these',
  'Terms and privacy consent',
  'Photos and documents — uploads stay manual',
  'Invite codes',
]

export function AdminTestingTools() {
  const [data, setData] = useState<ApiTestingTools | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = () => {
    setLoadError(null)
    testingToolsApi
      .adminGet()
      .then((res) => setData(res.data))
      .catch((err) => setLoadError(errorMessage(err)))
  }
  useEffect(load, [])

  const setFakeFill = async (next: boolean) => {
    if (!data || saving) return
    // Switching on changes what every provider signing up is shown, so it asks
    // first. Switching off only ever removes the button, so it does not.
    if (next) {
      const ok = await confirm({
        title: 'Turn on Fake fill?',
        body:
          'Everyone who opens a provider signup or registration form will see a "Fake fill" button until you switch it off — real providers included. Use it on test and staging platforms, or briefly for a test session.',
        confirmLabel: 'Turn on',
      })
      if (!ok) return
    }
    setSaving(true)
    try {
      const res = await testingToolsApi.update({ fakeFillEnabled: next })
      setData((d) => ({ ...(d ?? {}), ...res.data }))
      toast(translatePortalText(next ? 'Fake fill is on — the button shows on the next form opened' : 'Fake fill is off'))
      // Picks up "who changed it" for the line under the switch.
      load()
    } catch (err) {
      toast(translatePortalText(`Could not save: ${errorMessage(err)}`), 'warn')
    } finally {
      setSaving(false)
    }
  }

  if (loadError) {
    return (
      <PageWrap>
        <Header />
        <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-sm text-rose-600">{translatePortalText("Could not load testing tools: ")}{loadError}</p>
          <button className="btn-ghost" onClick={load}>{translatePortalText("Try again")}</button>
        </div>
      </PageWrap>
    )
  }
  if (!data) {
    return (
      <PageWrap>
        <Header />
        <div className="card flex items-center gap-3 p-6 text-sm text-slate-500"><Spinner /> {translatePortalText(" Loading testing tools…")}</div>
      </PageWrap>
    )
  }

  const on = data.fakeFillEnabled
  const changedBy = data.updatedBy?.name || data.updatedBy?.email

  return (
    <PageWrap>
      <Header />

      {on && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <p>
            <b>{translatePortalText("Fake fill is on.")}</b> {translatePortalText(" Every provider signing up can see the button right now. Switch it off before the platform\n            goes live or when your test session is over.\n          ")}</p>
        </div>
      )}

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-1 basis-72 items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-600 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:ring-amber-900/50">
              <FlaskConical size={18} />
            </span>
            <div className="min-w-0">
              <p className="flex items-center gap-2 font-display text-[16px] font-extrabold text-deep-900">
                {translatePortalText("Fake fill button")}
                {on
                  ? <span className="chip bg-amber-100 text-amber-800 ring-1 ring-amber-200">{translatePortalText("On")}</span>
                  : <span className="chip bg-slate-100 text-slate-600">{translatePortalText("Off")}</span>}
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-slate-600">
                {translatePortalText("\n                Adds a button to the provider signup and registration forms that fills them with realistic sample data — a\n                different business every press — so a test account takes seconds instead of minutes.\n              ")}</p>
            </div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={translatePortalText("Fake fill button")}
            disabled={saving}
            onClick={() => setFakeFill(!on)}
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${on ? 'bg-amber-500' : 'bg-slate-300 dark:bg-slate-600'}`}
          >
            <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`} />
            {saving && <span className="absolute -end-7"><Spinner size={14} /></span>}
          </button>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200/70 p-4">
            <p className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.2em] text-slate-400">{translatePortalText("Where it appears")}</p>
            <div className="space-y-3">
              {SURFACES.map((s) => (
                <div key={s.app}>
                  <p className="flex items-center gap-1.5 text-[13px] font-semibold text-deep-900">{s.icon}{translatePortalText(s.app)}</p>
                  <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
                    {s.forms.map((f) => <li key={f}>· {translatePortalText(f)}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200/70 p-4">
            <p className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.2em] text-slate-400">{translatePortalText("Fills in")}</p>
            <ul className="space-y-1 text-xs text-slate-600">
              {FILLS.map((f) => <li key={f} className="flex items-start gap-1.5"><Check size={13} className="mt-0.5 shrink-0 text-emerald-500" />{translatePortalText(f)}</li>)}
            </ul>
          </div>
          <div className="rounded-xl border border-slate-200/70 p-4">
            <p className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.2em] text-slate-400">{translatePortalText("Leaves for the tester")}</p>
            <ul className="space-y-1 text-xs text-slate-600">
              {LEAVES.map((f) => <li key={f} className="flex items-start gap-1.5"><Minus size={13} className="mt-0.5 shrink-0 text-slate-400" />{translatePortalText(f)}</li>)}
            </ul>
          </div>
        </div>

        <p className="mt-4 text-[11px] text-slate-400">
          {translatePortalText("\n          Nothing is saved by the button itself — each form step still saves through its own Continue, and is checked by\n          the server exactly like typed input.\n          ")}{data.updatedAt && <> {translatePortalText(" Last changed ")}{formatPortalDate(new Date(data.updatedAt), { dateStyle: 'medium', timeStyle: 'short' })}{changedBy ? ` by ${changedBy}` : ''}.</>}
        </p>
      </motion.div>
    </PageWrap>
  )
}

function Header() {
  return (
    <AdminHeader
      title={translatePortalText("Testing Tools")}
      sub={translatePortalText("Switch on helpers that speed up manual testing of provider signup")}
      icon={<FlaskConical className="text-amber-500" />}
    />
  )
}
