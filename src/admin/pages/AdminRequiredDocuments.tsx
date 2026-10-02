import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, Anchor, Bot, FileCheck2, Fuel, Info, RotateCcw, Sailboat, Save, Wrench } from 'lucide-react'
import { AdminHeader } from '../adminUi'
import { PageWrap } from './_shared'
import { Spinner, Toggle, toast } from '../../ui'
import { translatePortalText, formatPortalNumber  , formatPortalDate, isPortalArabic } from '../../i18n/runtime'
import { confirm } from '../../async'
import { errorMessage } from '../../async/errors'
import {
  documentsApi,
  type ApiDocRequirements,
  type DocRequirementRule,
  type DocumentedProviderType,
} from '../../api'

// ══════════ REQUIRED DOCUMENTS ══════════
//
// Where the admin decides what each kind of provider must upload. The server
// owns the rule — every signup gate, the apps' checklists and the compliance
// score read it on the next request — so this page only edits it; nothing here
// is a second copy of the list.

type Level = 'required' | 'optional' | 'off'
type Draft = Record<DocumentedProviderType, Record<string, Level>>

const TYPE_META: Record<DocumentedProviderType, { label: string; short: string; icon: React.ReactNode }> = {
  boat_provider: { label: 'Boat providers', short: 'Boat', icon: <Sailboat size={15} /> },
  marina_provider: { label: 'Marina providers', short: 'Marina', icon: <Anchor size={15} /> },
  fuel_provider: { label: 'Fuel providers', short: 'Fuel', icon: <Fuel size={15} /> },
  maintenance_provider: { label: 'Maintenance vendors', short: 'Maintenance', icon: <Wrench size={15} /> },
}

const GROUP_LABEL: Record<ApiDocRequirements['catalogue'][number]['group'], string> = {
  identity: 'Identity',
  business: 'Business',
  crew: 'Captain & crew',
  boat: 'Boat',
}

/** What an admin needs to know before changing a particular document, where there is something. */
const DOC_HINT: Record<string, string> = {
  national_id: 'Residents upload their Iqama in this slot, so this covers Saudis and residents alike.',
  iqama: 'Only residents hold one. Requiring it on its own shuts out every Saudi applicant.',
  vat_certificate: 'A provider who answers “no VAT certificate” is never asked for it, whatever is set here.',
}

const LEVELS: { key: Level; label: string }[] = [
  { key: 'required', label: 'Required' },
  { key: 'optional', label: 'Optional' },
  { key: 'off', label: 'Not asked' },
]

function toDraft(rules: ApiDocRequirements['rules'], types: DocumentedProviderType[], catalogue: string[]): Draft {
  const draft = {} as Draft
  for (const t of types) {
    const rule = rules[t] ?? { required: [], optional: [] }
    draft[t] = Object.fromEntries(
      catalogue.map((d) => [d, rule.required.includes(d) ? 'required' : rule.optional.includes(d) ? 'optional' : 'off'])
    )
  }
  return draft
}

/** Back to the wire shape, in catalogue order so a save does not reshuffle the provider's checklist. */
function toRule(levels: Record<string, Level>, catalogue: string[]): DocRequirementRule {
  return {
    required: catalogue.filter((d) => levels[d] === 'required'),
    optional: catalogue.filter((d) => levels[d] === 'optional'),
  }
}

/** Order-blind: the saved lists need not be in catalogue order, and order is not what the admin changed. */
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((d) => b.includes(d))
const sameRule = (a: DocRequirementRule, b: DocRequirementRule) =>
  sameSet(a.required, b.required) && sameSet(a.optional, b.optional)

export function AdminRequiredDocuments() {
  const [data, setData] = useState<ApiDocRequirements | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  // Per document type, and global across provider types, so kept apart from `draft`.
  const [autoDraft, setAutoDraft] = useState<Record<string, boolean>>({})
  const [active, setActive] = useState<DocumentedProviderType>('boat_provider')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const catalogueKeys = useMemo(() => data?.catalogue.map((c) => c.docType) ?? [], [data])

  const apply = (next: ApiDocRequirements) => {
    setData(next)
    setDraft(toDraft(next.rules, next.providerTypes, next.catalogue.map((c) => c.docType)))
    setAutoDraft({ ...next.autoApprove })
  }

  const load = () => {
    setLoadError(null)
    documentsApi
      .requirements()
      .then((res) => apply(res.data))
      .catch((err) => setLoadError(errorMessage(err)))
  }
  useEffect(load, [])

  /** The provider types whose draft differs from what is saved. */
  const dirty = useMemo(() => {
    if (!data || !draft) return [] as DocumentedProviderType[]
    return data.providerTypes.filter((t) => !sameRule(toRule(draft[t], catalogueKeys), data.rules[t]))
  }, [data, draft, catalogueKeys])

  /** Document types whose automatic-approval switch differs from what is saved. */
  const dirtyAuto = useMemo(
    () => (data ? catalogueKeys.filter((d) => (autoDraft[d] ?? true) !== (data.autoApprove?.[d] ?? true)) : []),
    [data, autoDraft, catalogueKeys]
  )
  const changeCount = dirty.length + dirtyAuto.length

  if (loadError) {
    return (
      <PageWrap>
        <Header />
        <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-sm text-rose-600">{translatePortalText("Could not load document requirements: ")}{loadError}</p>
          <button className="btn-ghost" onClick={load}>{translatePortalText("Try again")}</button>
        </div>
      </PageWrap>
    )
  }
  if (!data || !draft) {
    return (
      <PageWrap>
        <Header />
        <div className="card flex items-center gap-3 p-6 text-sm text-slate-500"><Spinner /> {translatePortalText(" Loading document requirements…")}</div>
      </PageWrap>
    )
  }

  const levels = draft[active]
  const rule = toRule(levels, catalogueKeys)
  const isCustom = data.customised.includes(active)
  const onDefaults = sameRule(rule, data.defaults[active])

  const setLevel = (docType: string, level: Level) =>
    setDraft((d) => (d ? { ...d, [active]: { ...d[active], [docType]: level } } : d))

  const resetToDefaults = () =>
    setDraft((d) =>
      d ? { ...d, [active]: toDraft({ [active]: data.defaults[active] } as ApiDocRequirements['rules'], [active], catalogueKeys)[active] } : d
    )

  const discard = () => apply(data)

  const save = async () => {
    if (!changeCount) return
    const names = dirty.map((t) => translatePortalText(TYPE_META[t].label)).join(isPortalArabic() ? '، ' : ', ')
    const parts: string[] = []
    if (dirty.length) {
      parts.push(translatePortalText(
        `This changes what ${names} must upload. It applies straight away to every new submission and every provider's ` +
          'checklist in the apps and the portal. Providers who are already approved stay approved; a document you have ' +
          'just made required shows up as outstanding on their checklist.'
      ))
    }
    if (dirtyAuto.length) {
      const off = dirtyAuto.filter((d) => autoDraft[d] === false).length
      const on = dirtyAuto.length - off
      const clauses = [
        on ? translatePortalText(`${on} document type${on > 1 ? 's' : ''} will be approved automatically on a clean reading`) : '',
        off ? translatePortalText(`${off} document type${off > 1 ? 's' : ''} will wait for a person to review`) : '',
      ].filter(Boolean)
      parts.push(translatePortalText(`${clauses.join(isPortalArabic() ? '؛ ' : '; ')}. This applies to uploads from now on; nothing already approved or pending changes.`))
    }
    const ok = await confirm({
      title: 'Save document settings?',
      body: parts.join(' '),
      confirmLabel: 'Save changes',
    })
    if (!ok) return

    // A type the admin has put back exactly on the defaults is saved as "use the
    // defaults" rather than a copy of them, so a later change to the defaults
    // reaches it too.
    const rules: Partial<Record<DocumentedProviderType, DocRequirementRule | null>> = {}
    for (const t of dirty) {
      const next = toRule(draft[t], catalogueKeys)
      rules[t] = sameRule(next, data.defaults[t]) ? null : next
    }
    const autoApprove = Object.fromEntries(dirtyAuto.map((d) => [d, autoDraft[d] ?? true]))

    setSaving(true)
    try {
      const res = await documentsApi.updateRequirements({
        ...(dirty.length ? { rules } : {}),
        ...(dirtyAuto.length ? { autoApprove } : {}),
      })
      apply(res.data)
      toast(translatePortalText('Document settings saved'))
    } catch (err) {
      toast(translatePortalText(`Could not save: ${translatePortalText(errorMessage(err))}`), 'warn')
    } finally {
      setSaving(false)
    }
  }

  const warnings: string[] = []
  if (rule.required.includes('national_id') && rule.required.includes('iqama')) {
    warnings.push('National ID and Iqama are both required. Nobody holds both, so no one could submit. Require National ID alone — residents upload their Iqama in that slot.')
  } else if (rule.required.includes('iqama') && !rule.required.includes('national_id')) {
    warnings.push('Iqama is required without National ID. Saudi applicants do not hold an Iqama and would be unable to submit.')
  }
  if (rule.required.length === 0) {
    warnings.push(`${TYPE_META[active].label} can submit their application without uploading any document.`)
  }

  const groups = (['identity', 'business', 'crew', 'boat'] as const)
    .map((g) => ({ group: g, items: data.catalogue.filter((c) => c.group === g) }))
    .filter((g) => g.items.length)

  return (
    <PageWrap>
      <Header
        actions={
          <>
            <button className="btn-ghost disabled:opacity-50" onClick={discard} disabled={!changeCount || saving}>{translatePortalText("Discard")}</button>
            <button className="btn-primary disabled:opacity-50" onClick={save} disabled={!changeCount || saving}>
              {saving ? <Spinner size={14} /> : <Save size={14} />} {translatePortalText("Save changes")}{changeCount ? ` (${formatPortalNumber(changeCount)})` : ''}
            </button>
          </>
        }
      />

      <div className="card mb-4 flex items-start gap-3 p-4 text-[13px] text-slate-600">
        <Info size={16} className="mt-0.5 shrink-0 text-ocean-500" />
        <p>
          {translatePortalText('Required documents must be uploaded before a provider can submit their application. Optional ones are offered and reviewed when supplied. Not asked ones are left off the checklist entirely. Scuba-diver operators sign up without documents and are not affected.')}
        </p>
      </div>

      {/* Provider type tabs */}
      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label={translatePortalText("Provider type")}>
        {data.providerTypes.map((t) => {
          const r = toRule(draft[t], catalogueKeys)
          const on = t === active
          return (
            <button
              key={t}
              role="tab"
              aria-selected={on}
              onClick={() => setActive(t)}
              className={`flex items-center gap-2 rounded-xl border px-3.5 py-2 text-[13px] font-semibold transition ${
                on ? 'border-ocean-400 bg-ocean-50 text-deep-900' : 'border-slate-200 bg-white text-slate-600 hover:border-ocean-300'
              }`}
            >
              {TYPE_META[t].icon}
              {translatePortalText(TYPE_META[t].label)}
              <span className="text-[11px] font-bold text-slate-400">{formatPortalNumber(r.required.length)} {translatePortalText('req')}</span>
              {dirty.includes(t) && <span className="h-2 w-2 rounded-full bg-amber-500" title={translatePortalText("Unsaved changes")} />}
            </button>
          )
        })}
      </div>

      <motion.div key={active} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 font-display text-[16px] font-extrabold text-deep-900">
              {TYPE_META[active].icon} {translatePortalText(TYPE_META[active].label)}
              {isCustom
                ? <span className="chip bg-ocean-50 text-ocean-700 ring-1 ring-ocean-200">{translatePortalText('Custom')}</span>
                : <span className="chip bg-slate-100 text-slate-600">{translatePortalText('Default')}</span>}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {formatPortalNumber(rule.required.length)} {translatePortalText('Required')} · {formatPortalNumber(rule.optional.length)} {translatePortalText('Optional')} ·{' '}
              {formatPortalNumber(catalogueKeys.length - rule.required.length - rule.optional.length)} {translatePortalText('Not asked')}
            </p>
          </div>
          <button className="btn-ghost disabled:opacity-50" onClick={resetToDefaults} disabled={onDefaults}>
            <RotateCcw size={14} /> {translatePortalText("Reset to defaults")}
          </button>
        </div>

        {warnings.map((w) => (
          <div key={w} className="mb-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-800">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {translatePortalText(w)}
          </div>
        ))}

        <div className="space-y-5">
          {groups.map(({ group, items }) => (
            <div key={group}>
              <p className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.2em] text-slate-400">{translatePortalText(GROUP_LABEL[group])}</p>
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200/70">
                {items.map((item) => {
                  const level = levels[item.docType] ?? 'off'
                  const changed = level !== (data.rules[active].required.includes(item.docType)
                    ? 'required'
                    : data.rules[active].optional.includes(item.docType) ? 'optional' : 'off')
                  return (
                    <div key={item.docType} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1 basis-56">
                        <p className="flex items-center gap-2 text-[14px] font-semibold text-deep-900">
                          {translatePortalText(item.label)}
                          {changed && <span className="text-[11px] font-bold text-amber-600">{translatePortalText("Unsaved")}</span>}
                        </p>
                        {DOC_HINT[item.docType] && <p className="mt-0.5 text-xs text-slate-500">{translatePortalText(DOC_HINT[item.docType])}</p>}
                      </div>
                      <div className="flex shrink-0 rounded-lg border border-slate-200 bg-sand p-0.5" role="radiogroup" aria-label={`${translatePortalText(item.label)} requirement`}>
                        {LEVELS.map((l) => {
                          const on = level === l.key
                          const tone =
                            l.key === 'required' ? 'bg-ocean-600 text-white' : l.key === 'optional' ? 'bg-emerald-600 text-white' : 'bg-slate-500 text-white'
                          return (
                            <button
                              key={l.key}
                              role="radio"
                              aria-checked={on}
                              onClick={() => setLevel(item.docType, l.key)}
                              className={`rounded-md px-3 py-1.5 text-[12px] font-semibold transition ${on ? tone : 'text-slate-500 hover:text-deep-900'}`}
                            >
                              {translatePortalText(l.label)}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {data.updatedAt && (
          <p className="mt-4 text-[11px] text-slate-400">{translatePortalText('Last changed')} {formatPortalDate(new Date(data.updatedAt), { dateStyle: 'medium', timeStyle: 'short' })}</p>
        )}
      </motion.div>

      {/* Automatic approval: per document type, the same for every provider type. */}
      <div className="card mt-4 p-5">
        <p className="flex items-center gap-2 font-display text-[16px] font-extrabold text-deep-900">
          <Bot size={16} className="text-emerald-500" /> {translatePortalText('Automatic approval')}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          {translatePortalText("When a document is uploaded from the app and the automated reading finds nothing wrong, it can be approved straight away. Switch a type off to have a person review every upload of it. Applies to all provider types.")}
        </p>
        <div className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200/70">
          {data.catalogue.map((item) => {
            const on = autoDraft[item.docType] ?? true
            const changed = dirtyAuto.includes(item.docType)
            return (
              <div key={item.docType} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-deep-900">
                    {translatePortalText(item.label)}
                    {changed && <span className="text-[11px] font-bold text-amber-600">{translatePortalText('Unsaved')}</span>}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {translatePortalText(on ? 'Approved automatically on a clean reading' : 'Always waits for a person')}
                    {item.reviewRecommended && on && (
                      <span className="ms-1 font-semibold text-amber-700">· {translatePortalText("Human review recommended for this type")}</span>
                    )}
                  </p>
                </div>
                <Toggle on={on} onChange={(v) => setAutoDraft((d) => ({ ...d, [item.docType]: v }))} />
              </div>
            )
          })}
        </div>
      </div>
    </PageWrap>
  )
}

function Header({ actions }: { actions?: React.ReactNode }) {
  return (
    <AdminHeader
      title={translatePortalText("Required Documents")}
      sub={translatePortalText("Choose which documents each kind of provider must upload before they can submit their application")}
      icon={<FileCheck2 className="text-emerald-500" />}
      actions={actions}
    />
  )
}
