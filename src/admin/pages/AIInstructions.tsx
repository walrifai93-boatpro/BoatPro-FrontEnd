import React, { useEffect, useState } from 'react'
import { Ban, CheckCircle2, Eye, Lock, Plus, RefreshCw, RotateCcw, X } from 'lucide-react'
import { LoadingButton, LoadingState, Modal, toast } from '../../ui'
import { adminPortalApi, type ApiAIPrompt, type ApiAIPromptDraft, type ApiAIPromptLimits } from '../../api'
import { formatPortalDate, formatPortalNumber, translatePortalTemplate, translatePortalText } from '../../i18n/runtime'

/**
 * AI Management → Instructions: rewrite the editable parts of a module's AI
 * prompts and set what the AI must always and never do.
 *
 * The server owns the prompts — defaults, the parts that stay locked, and the
 * assembled preview — so this editor only ever holds a draft of the admin's
 * edits. A section saved back unchanged is stored as "built-in", which is why
 * resetting is just putting the default text back.
 */

type Draft = { sections: Record<string, string>; do: string[]; dont: string[] }

const t = translatePortalText
const tidyRule = (r: string) => r.replace(/\s+/g, ' ').trim()
const tidyRules = (rules: string[]) => rules.map(tidyRule).filter(Boolean)
/** Rows for a section's text, counting wrapped lines too — several defaults are one long paragraph. */
const rowsFor = (text: string) =>
  Math.min(16, Math.max(5, text.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 95)), 0) + 1))
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i])

const toDraft = (p: ApiAIPrompt): Draft => ({
  sections: Object.fromEntries(p.sections.map(s => [s.id, s.value])),
  do: [...p.do],
  dont: [...p.dont],
})
const toPayload = (d: Draft): ApiAIPromptDraft => ({ sections: d.sections, do: tidyRules(d.do), dont: tidyRules(d.dont) })
const isDirty = (p: ApiAIPrompt, d: Draft | undefined) => !!d && (
  p.sections.some(s => (d.sections[s.id] ?? '').trim() !== s.value.trim()) ||
  !sameList(tidyRules(d.do), p.do) || !sameList(tidyRules(d.dont), p.dont)
)

export function AIInstructionsModal({ moduleKey, moduleName, onClose, onSaved }: {
  moduleKey: string | null
  moduleName: string
  onClose: () => void
  onSaved: () => void
}) {
  const [prompts, setPrompts] = useState<ApiAIPrompt[] | null>(null)
  const [limits, setLimits] = useState<ApiAIPromptLimits>({ sectionChars: 8000, rules: 25, ruleChars: 300 })
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [active, setActive] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  // A preview of unsaved edits, and the exact draft it was built from — so it is never shown for a different draft.
  const [draftPreview, setDraftPreview] = useState<Record<string, { text: string; of: string }>>({})
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!moduleKey) return
    // `alive`: opening a second module before the first answered wrote the first
    // module's prompts under the second one's title.
    let alive = true
    setPrompts(null); setError(''); setDraftPreview({}); setPreviewOpen(false)
    adminPortalApi.aiPrompts(moduleKey).then(res => {
      if (!alive) return
      setPrompts(res.data.prompts)
      setLimits(res.data.limits)
      setDrafts(Object.fromEntries(res.data.prompts.map(p => [p.id, toDraft(p)])))
      setActive(res.data.prompts[0]?.id ?? '')
    }).catch(err => { if (alive) setError((err as Error)?.message || t('Could not load the instructions')) })
    return () => { alive = false }
  }, [moduleKey, attempt])

  const prompt = prompts?.find(p => p.id === active)
  const draft = prompt ? drafts[prompt.id] : undefined
  const dirty = !!prompt && isDirty(prompt, draft)
  const missingRequired = !!prompt && !!draft && prompt.sections.some(s => s.required && !(draft.sections[s.id] ?? '').trim())
  const anyDirty = !!prompts?.some(p => isDirty(p, drafts[p.id]))

  const close = () => {
    if (anyDirty && !window.confirm(t('Discard your unsaved changes to the instructions?'))) return
    onClose()
  }

  const update = (fn: (d: Draft) => Draft) => {
    if (!prompt || !draft) return
    setDrafts(prev => ({ ...prev, [prompt.id]: fn(draft) }))
  }

  const save = () => {
    if (!moduleKey || !prompt || !draft) return
    setSaving(true)
    adminPortalApi.saveAIPrompt(moduleKey, prompt.id, toPayload(draft)).then(res => {
      const saved = res.data.prompt
      setPrompts(prev => prev?.map(p => p.id === saved.id ? saved : p) ?? null)
      setDrafts(prev => ({ ...prev, [saved.id]: toDraft(saved) }))
      setDraftPreview(prev => { const { [saved.id]: _, ...rest } = prev; return rest })
      toast(t('Instructions saved — the AI uses them within 10 seconds'))
      onSaved()
    }).catch(err => toast((err as Error)?.message || t('Could not save the instructions'), 'warn'))
      .finally(() => setSaving(false))
  }

  const refreshPreview = () => {
    if (!moduleKey || !prompt || !draft) return
    const payload = toPayload(draft)
    setPreviewLoading(true)
    adminPortalApi.previewAIPrompt(moduleKey, prompt.id, payload).then(res => {
      setDraftPreview(prev => ({ ...prev, [prompt.id]: { text: res.data.preview, of: JSON.stringify(payload) } }))
    }).catch(err => toast((err as Error)?.message || t('Could not build the preview'), 'warn'))
      .finally(() => setPreviewLoading(false))
  }

  const freshDraftPreview = prompt && draft && draftPreview[prompt.id]?.of === JSON.stringify(toPayload(draft))
    ? draftPreview[prompt.id].text : null
  const previewText = !dirty ? prompt?.preview : freshDraftPreview

  const restoreBuiltIn = () => {
    if (!prompt) return
    update(() => ({ sections: Object.fromEntries(prompt.sections.map(s => [s.id, s.default])), do: [], dont: [] }))
  }
  const onBuiltIn = !!prompt && !!draft
    && prompt.sections.every(s => (draft.sections[s.id] ?? '').trim() === s.default.trim())
    && !tidyRules(draft.do).length && !tidyRules(draft.dont).length

  return (
    <Modal open={!!moduleKey} onClose={close} wide title={<>{t(moduleName)} · {t('Instructions')}</>}>
      {error ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
          <p className="min-w-0 flex-1">{error}</p>
          <button onClick={() => setAttempt(n => n + 1)} className="btn-ghost !py-1.5 !text-xs">
            <RefreshCw size={12} /> {t('Try again')}
          </button>
        </div>
      ) : !prompts || !prompt || !draft ? (
        <LoadingState label={t('Loading instructions…')} rows={5} />
      ) : (
        <div className="space-y-5">
          {prompts.length > 1 && (
            <div className="flex flex-wrap gap-1.5 rounded-xl bg-slate-100 p-1">
              {prompts.map(p => (
                <button key={p.id} onClick={() => setActive(p.id)}
                  className={`flex-1 rounded-lg px-3 py-1.5 text-[12px] font-bold transition ${p.id === active ? 'bg-white text-deep-900 shadow-soft' : 'text-slate-500 hover:text-deep-900'}`}>
                  {t(p.label)}{isDirty(p, drafts[p.id]) ? ' •' : ''}
                </button>
              ))}
            </div>
          )}

          <div>
            <p className="text-[13px] text-slate-600">{t(prompt.description)}</p>
            <p className="mt-1 text-[11px] font-semibold text-slate-400">
              {prompt.customised
                ? (prompt.updatedBy
                  ? translatePortalTemplate('Customised · last changed by {{name}} on {{date}}', { name: prompt.updatedBy, date: formatPortalDate(prompt.updatedAt) })
                  : t('Customised'))
                : t('Using BoatPro\'s built-in instructions')}
            </p>
          </div>

          {prompt.sections.map(s => {
            const value = draft.sections[s.id] ?? ''
            const edited = value.trim() !== s.default.trim()
            const empty = !value.trim()
            return (
              <div key={s.id}>
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <label htmlFor={`ai-section-${s.id}`} className="text-[13px] font-bold text-deep-900">{t(s.label)}</label>
                    {edited && <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700">{t('Edited')}</span>}
                  </div>
                  {edited && (
                    <button onClick={() => update(d => ({ ...d, sections: { ...d.sections, [s.id]: s.default } }))}
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-ocean-700 hover:underline">
                      <RotateCcw size={11} /> {t('Reset to default')}
                    </button>
                  )}
                </div>
                <p className="mb-2 text-[11px] leading-relaxed text-slate-500">{t(s.hint)}</p>
                <textarea id={`ai-section-${s.id}`} dir="auto" value={value} maxLength={limits.sectionChars}
                  rows={rowsFor(value)}
                  onChange={e => { const v = e.target.value; update(d => ({ ...d, sections: { ...d.sections, [s.id]: v } })) }}
                  className={`input resize-y font-mono !text-[12px] leading-relaxed ${empty && s.required ? '!border-rose-300' : ''}`} />
                <div className="mt-1 flex justify-between gap-3 text-[10px] text-slate-400">
                  <span className={empty && s.required ? 'font-semibold text-rose-600' : ''}>
                    {empty ? (s.required ? t('This part is required — reset it to the default instead of clearing it') : t('Left empty, this part is left out of the prompt')) : ''}
                  </span>
                  <span>{formatPortalNumber(value.length)} / {formatPortalNumber(limits.sectionChars)}</span>
                </div>
              </div>
            )
          })}

          <div className="grid gap-3 md:grid-cols-2">
            <RuleList tone="do" rules={draft.do} example={t(prompt.doExample)} limits={limits}
              onChange={rules => update(d => ({ ...d, do: rules }))} />
            <RuleList tone="dont" rules={draft.dont} example={t(prompt.dontExample)} limits={limits}
              onChange={rules => update(d => ({ ...d, dont: rules }))} />
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
            <p className="flex items-center gap-1.5 text-[12px] font-extrabold text-slate-600"><Lock size={12} /> {t('Always applied — cannot be edited')}</p>
            <p className="mt-0.5 text-[11px] text-slate-500">{t('These keep the AI safe and keep the apps working. Your rules add to them; if one conflicts, these win.')}</p>
            <ul className="mt-2 space-y-1">
              {prompt.locked.map(l => (
                <li key={l} className="flex gap-2 text-[11px] leading-relaxed text-slate-600">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-slate-400" />{t(l)}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-slate-200">
            <button onClick={() => setPreviewOpen(o => !o)} className="flex w-full items-center justify-between px-3.5 py-2.5 text-[12px] font-bold text-deep-900">
              <span className="flex items-center gap-1.5"><Eye size={13} /> {t('See the full prompt the AI receives')}</span>
              <span className="text-[11px] text-slate-400">{previewOpen ? t('Hide') : t('Show')}</span>
            </button>
            {previewOpen && (
              <div className="border-t border-slate-100 p-3.5">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold text-slate-500">
                    {t(prompt.previewLabel)}{dirty && previewText ? ` · ${t('includes your unsaved changes')}` : ''}
                  </p>
                  {dirty && (
                    <LoadingButton loading={previewLoading} onClick={refreshPreview} icon={<RefreshCw size={11} />}
                      className="btn-ghost !py-1 !px-2.5 !text-[11px]">
                      {t('Refresh preview')}
                    </LoadingButton>
                  )}
                </div>
                {previewText ? (
                  <pre dir="auto" className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-mono text-[11px] leading-relaxed text-slate-700">{previewText}</pre>
                ) : (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700">{t('You have unsaved changes. Refresh the preview to see the prompt with them.')}</p>
                )}
              </div>
            )}
          </div>

          <div className="sticky bottom-0 z-10 -mx-6 -mb-6 flex flex-wrap items-center justify-between gap-2 rounded-b-2xl border-t border-slate-100 bg-white/95 px-6 py-3 backdrop-blur">
            <button onClick={restoreBuiltIn} disabled={onBuiltIn}
              className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-deep-900 disabled:opacity-40">
              <RotateCcw size={11} /> {t('Restore built-in instructions')}
            </button>
            <div className="flex items-center gap-2">
              {dirty && (
                <button onClick={() => setDrafts(prev => ({ ...prev, [prompt.id]: toDraft(prompt) }))} className="btn-ghost !py-1.5 !px-3 !text-[12px]">
                  {t('Discard changes')}
                </button>
              )}
              <LoadingButton loading={saving} disabled={!dirty || missingRequired} onClick={save} className="btn-admin !py-1.5 !px-3.5 !text-[12px] disabled:opacity-50">
                {t('Save instructions')}
              </LoadingButton>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

function RuleList({ tone, rules, example, limits, onChange }: {
  tone: 'do' | 'dont'
  rules: string[]
  example: string
  limits: ApiAIPromptLimits
  onChange: (rules: string[]) => void
}) {
  const [text, setText] = useState('')
  const isDo = tone === 'do'
  const full = rules.length >= limits.rules

  const add = () => {
    const rule = tidyRule(text)
    if (!rule) return
    if (rules.some(r => tidyRule(r).toLowerCase() === rule.toLowerCase())) {
      toast(t('That rule is already on the list'), 'warn')
      return
    }
    onChange([...rules, rule])
    setText('')
  }

  return (
    <div className={`rounded-xl border p-3.5 ${isDo ? 'border-emerald-100 bg-emerald-50/40' : 'border-rose-100 bg-rose-50/40'}`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className={`flex items-center gap-1.5 text-[12px] font-extrabold ${isDo ? 'text-emerald-700' : 'text-rose-700'}`}>
          {isDo ? <CheckCircle2 size={13} /> : <Ban size={13} />} {t(isDo ? 'Always do' : 'Never do')}
        </p>
        <span className="text-[10px] font-semibold text-slate-400">{formatPortalNumber(rules.length)} / {formatPortalNumber(limits.rules)}</span>
      </div>
      <p className="mb-2 text-[11px] text-slate-500">
        {t(isDo ? 'Things the AI must always do. One rule per line.' : 'Things the AI must never do. One rule per line.')}
      </p>
      {rules.length > 0 && (
        <ul className="mb-2 space-y-1.5">
          {rules.map((r, i) => (
            <li key={i} className="flex items-center gap-1.5">
              <input dir="auto" value={r} maxLength={limits.ruleChars} aria-label={t(isDo ? 'Always do' : 'Never do')}
                onChange={e => onChange(rules.map((x, j) => (j === i ? e.target.value : x)))}
                className="input !py-1.5 !text-[12px]" />
              <button onClick={() => onChange(rules.filter((_, j) => j !== i))} aria-label={t('Remove rule')}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-white hover:text-rose-600">
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {full ? (
        <p className="text-[11px] font-semibold text-amber-700">{translatePortalTemplate('Up to {{count}} rules — remove one to add another', { count: formatPortalNumber(limits.rules) })}</p>
      ) : (
        <div className="flex gap-1.5">
          <input dir="auto" value={text} maxLength={limits.ruleChars} placeholder={t('Add a rule…')}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
            className="input !py-1.5 !text-[12px]" />
          <button onClick={add} disabled={!text.trim()} className="btn-ghost shrink-0 !py-1.5 !px-2.5 !text-[11px] disabled:opacity-50">
            <Plus size={12} /> {t('Add')}
          </button>
        </div>
      )}
      {rules.length === 0 && <p className="mt-1.5 text-[11px] italic leading-relaxed text-slate-400">{t('e.g.')} {example}</p>}
    </div>
  )
}
