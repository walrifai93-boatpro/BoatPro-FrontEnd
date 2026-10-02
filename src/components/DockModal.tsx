import React, { useState, useEffect, useMemo } from 'react'
import { useFormErrors, FieldError, submitFailureMessage } from '../shared/formErrors'
import { Plus, Anchor, Layers, Zap, Droplets, Wifi, Check, Loader2, Sparkles } from 'lucide-react'
import { Modal, toast } from '../ui'
import { useMarina, humanize } from '../live'
import { marinaApi, type ApiPontoon, type SlotCategory } from '../api'
import { useLimitAwareAction, usePackageUsage } from '../shared/packageLimit'
import { translatePortalText } from '../i18n/runtime'


const CATEGORIES: { value: SlotCategory; label: string; desc: string }[] = [
  { value: 'standard', label: 'Standard', desc: 'Mono-hull up to 14m' },
  { value: 'premium', label: 'Premium', desc: 'Prime location, deep draft' },
  { value: 'superyacht', label: 'Superyacht', desc: 'Vessels > 24m LOA' },
  { value: 'catamaran', label: 'Catamaran', desc: 'Wide beam berths' },
  { value: 'day_dock', label: 'Day Dock', desc: 'Short-stay & transit' },
]

const POWER_OPTIONS = ['16A', '32A', '63A', '3-phase 125A']

interface DockModalProps {
  open: boolean
  onClose: () => void
  pontoons: ApiPontoon[]
  docks: string[]
  onSaved: () => Promise<void>
}

/**
 * Calculates the next alphabetical or numbered dock code,
 * e.g., if ['A', 'B', 'C', 'D', 'E'] exist -> suggests 'F'.
 */
function getNextDockCode(existingDocks: string[]): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
  for (const l of letters) {
    if (!existingDocks.some(d => d.trim().toUpperCase() === l)) {
      return l
    }
  }
  // Fallback to P01, P02...
  for (let i = 1; i <= 99; i++) {
    const code = `P${String(i).padStart(2, '0')}`
    if (!existingDocks.some(d => d.trim().toUpperCase() === code)) {
      return code
    }
  }
  return 'NEW'
}

export default function DockModal({
  open,
  onClose,
  pontoons,
  docks,
  onSaved,
}: DockModalProps) {
  const { marina, currency } = useMarina()
  const createPontoon = useLimitAwareAction(marinaApi.createPontoon)
  const createSlot = useLimitAwareAction(marinaApi.createSlot)
  const usage = usePackageUsage()


  const existingCodes = useMemo(() => {
    const list = new Set<string>()
    pontoons.forEach(p => { if (p.code) list.add(p.code.toUpperCase()) })
    docks.forEach(d => { if (d) list.add(d.toUpperCase()) })
    return Array.from(list)
  }, [pontoons, docks])

  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [generateBerths, setGenerateBerths] = useState(true)
  const [berthCount, setBerthCount] = useState(4)
  const [category, setCategory] = useState<SlotCategory>('standard')
  const [maxLength, setMaxLength] = useState<number | undefined>(12)
  const [maxBeam, setMaxBeam] = useState<number | undefined>(4.5)
  const [maxDraft, setMaxDraft] = useState<number | undefined>(2.5)
  const [monthlyPrice, setMonthlyPrice] = useState<number | undefined>(1200)
  const [water, setWater] = useState(true)
  const [wifi, setWifi] = useState(true)
  const [power, setPower] = useState('32A')
  const [busy, setBusy] = useState(false)

  // Initialize form with smart defaults on open
  useEffect(() => {
    if (open) {
      const nextCode = getNextDockCode(existingCodes)
      setCode(nextCode)
      setName(`Pontoon ${nextCode}`)
      setDescription('')
      setGenerateBerths(true)
      setBerthCount(4)
      setCategory('standard')
      setMaxLength(12)
      setMaxBeam(4.5)
      setMaxDraft(2.5)
      setMonthlyPrice(1200)
      setWater(true)
      setWifi(true)
      setPower('32A')
    }
  }, [open, existingCodes])

  const handleCodeChange = (val: string) => {
    const clean = val.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 10)
    setCode(clean)
    if (!name || name.startsWith('Pontoon ')) {
      setName(clean ? `Pontoon ${clean}` : '')
    }
  }

  const fe = useFormErrors({ rename: { pontoonCode: 'code', pontoonName: 'name' } })

  const save = async () => {
    const cleanCode = code.trim().toUpperCase()
    /**
     * Both of these were toast-only, which meant the message named the problem but
     * the empty — or duplicated — box stayed a normal box. They now mark the field
     * they are about, which is the only one on this form they could be about.
     */
    if (!cleanCode) {
      fe.fail({ code: 'Enter a dock identifier, e.g. F, N1 or Pontoon F' })
      return
    }

    if (existingCodes.includes(cleanCode)) {
      fe.fail({ code: `Dock "${cleanCode}" already exists — choose a different code` })
      return
    }
    fe.clear()

    const marinaId = marina?._id || marina?.id
    if (!marinaId) {
      toast(translatePortalText('Marina not loaded yet. Please try again.'), 'warn')
      return
    }

    setBusy(true)
    try {
      // 1. Create the Pontoon record
      const pontoonRes = await createPontoon.run(marinaId, {
        code: cleanCode,
        name: name.trim() || `Pontoon ${cleanCode}`,
        description: description.trim() || undefined,
      })

      if (!pontoonRes) {
        setBusy(false)
        return
      }

      const newPontoon = pontoonRes.data?.pontoon
      const pontoonId = newPontoon?.id ?? (newPontoon as any)?._id


      // 2. If initial berths requested, generate them under the new pontoon
      if (generateBerths && berthCount > 0 && pontoonId) {
        const specs = {
          category,
          maxLength: maxLength || 12,
          maxWidth: maxBeam || 4.5,
          maxDepth: maxDraft || 2.5,
          powerSupply: power,
          hasWater: water,
          hasWifi: wifi,
          monthlyPrice: monthlyPrice || undefined,
        }

        let createdCount = 0
        for (let i = 1; i <= berthCount; i++) {
          const slotCode = `S${String(i).padStart(2, '0')}`
          try {
            await marinaApi.createSlot(pontoonId, {
              code: slotCode,
              ...specs,
            })
            createdCount++
          } catch (slotErr) {
            console.error(`Failed to create slot ${slotCode}:`, slotErr)
          }
        }
        await usage.reload()
        toast(translatePortalText(`✨ Dock ${cleanCode} created with ${createdCount} berths!`), 'success')
      } else {
        toast(translatePortalText(`✨ Dock ${cleanCode} created successfully!`), 'success')
      }

      await onSaved()
      onClose()
    } catch (e) {
      const result = fe.capture(e)
      const msg = submitFailureMessage(result, e)
      if (msg) toast(translatePortalText(msg), 'warn')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Modal

      open={open}
      onClose={() => !busy && onClose()}
      title={
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-ocean-50 text-ocean-600 ring-1 ring-ocean-200">
            <Anchor size={18} />
          </div>
          <div>
            <h3 className="font-display text-base font-extrabold text-deep-900">{translatePortalText("Add New Dock / Pontoon")}</h3>
            <p className="text-xs text-slate-500 font-medium">{translatePortalText("Add a pier structure to your marina and lay out berths")}</p>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Existing Docks Overview */}
        {existingCodes.length > 0 && (
          <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{translatePortalText("Current Marina Docks:")}</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {existingCodes.map(d => (
                <span key={d} className="inline-flex items-center rounded-lg bg-white px-2.5 py-1 text-xs font-extrabold text-deep-900 border border-slate-200 shadow-2xs">
                  {translatePortalText("Dock ")}{d}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Dock Identification */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label flex items-center justify-between">
              <span>{translatePortalText("Dock Code / Letter ")}<b className="text-rose-500">*</b></span>
              <span className="text-[10px] text-slate-400 font-normal">{translatePortalText("e.g. F, N1, VIP")}</span>
            </label>
            <input
              type="text"
              {...fe.fieldWith('code', 'input uppercase font-bold text-deep-900 tracking-wider')}
              placeholder={translatePortalText('e.g. F')}
              value={code}
              onChange={e => { handleCodeChange(e.target.value); fe.clear('code') }}
              disabled={busy}
              maxLength={10}
            />
            <FieldError errors={fe} name="code" />
          </div>

          <div>
            <label className="label">{translatePortalText("Dock Name")}</label>
            <input
              type="text"
              {...fe.fieldWith('name', 'input font-medium')}
              placeholder={translatePortalText("e.g. Pontoon F, North Pier")}
              value={name}
              onChange={e => { setName(e.target.value); fe.clear('name') }}
              disabled={busy}
            />
            <FieldError errors={fe} name="name" />
          </div>
        </div>

        <div>
          <label className="label">{translatePortalText("Description / Notes (Optional)")}</label>
          <input
            type="text"
            className="input text-xs"
            placeholder={translatePortalText("e.g. Heavy timber floating dock for commercial & guest craft")}
            value={description}
            onChange={e => setDescription(e.target.value)}
            disabled={busy}
          />
        </div>

        {/* Toggle Initial Berths */}
        <div className="rounded-2xl border border-ocean-100 bg-gradient-to-br from-ocean-50/50 to-sand/40 p-4 transition">
          <div className="flex items-center justify-between cursor-pointer" onClick={() => setGenerateBerths(b => !b)}>
            <div className="flex items-center gap-3">
              <div className={`flex h-8 w-8 items-center justify-center rounded-xl transition ${generateBerths ? 'bg-ocean-600 text-white shadow-sm' : 'bg-slate-200 text-slate-500'}`}>
                <Sparkles size={16} />
              </div>
              <div>
                <h4 className="text-sm font-bold text-deep-900">{translatePortalText("Auto-Generate Berths on this Dock")}</h4>
                <p className="text-xs text-slate-500">{translatePortalText("Quickly size and populate slips along the new pontoon")}</p>
              </div>
            </div>
            <input
              type="checkbox"
              checked={generateBerths}
              onChange={e => setGenerateBerths(e.target.checked)}
              className="h-5 w-5 rounded border-slate-300 text-ocean-600 focus:ring-ocean-500 cursor-pointer"
            />
          </div>

          {generateBerths && (
            <div className="mt-4 space-y-4 pt-4 border-t border-ocean-100/70">
              {/* Slip Count selector */}
              <div>
                <label className="label">{translatePortalText("Number of Berths to Create")}</label>
                <div className="grid grid-cols-5 gap-2">
                  {[2, 4, 6, 8, 12].map(n => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setBerthCount(n)}
                      className={`rounded-xl py-2 text-xs font-bold transition border ${
                        berthCount === n
                          ? 'bg-deep-900 text-white border-deep-900 shadow-sm'
                          : 'bg-white text-slate-700 border-slate-200 hover:border-ocean-300'
                      }`}
                    >
                      {n} {translatePortalText("berths\r\n                    ")}</button>
                  ))}
                </div>
              </div>

              {/* Category */}
              <div>
                <label className="label">{translatePortalText("Berth Category")}</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {CATEGORIES.map(c => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setCategory(c.value)}
                      className={`rounded-xl p-2.5 text-left transition border ${
                        category === c.value
                          ? 'bg-ocean-50/80 border-ocean-400 ring-1 ring-ocean-400'
                          : 'bg-white border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-deep-900">{translatePortalText(c.label)}</span>
                        {category === c.value && <Check size={14} className="text-ocean-600" />}
                      </div>
                      <span className="text-[10px] text-slate-400 block mt-0.5">{translatePortalText(c.desc)}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Dimensions */}
              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="label text-[11px]">{translatePortalText("Max Length (m)")}</label>
                  <input
                    type="number"
                    step="0.5"
                    className="input text-xs font-semibold"
                    placeholder="12"
                    value={maxLength ?? ''}
                    onChange={e => setMaxLength(e.target.value ? Number(e.target.value) : undefined)}
                  />
                </div>
                <div>
                  <label className="label text-[11px]">{translatePortalText("Max Beam (m)")}</label>
                  <input
                    type="number"
                    step="0.1"
                    className="input text-xs font-semibold"
                    placeholder="4.5"
                    value={maxBeam ?? ''}
                    onChange={e => setMaxBeam(e.target.value ? Number(e.target.value) : undefined)}
                  />
                </div>
                <div>
                  <label className="label text-[11px]">{translatePortalText("Max Draft (m)")}</label>
                  <input
                    type="number"
                    step="0.1"
                    className="input text-xs font-semibold"
                    placeholder="2.5"
                    value={maxDraft ?? ''}
                    onChange={e => setMaxDraft(e.target.value ? Number(e.target.value) : undefined)}
                  />
                </div>
              </div>

              {/* Pricing & Utilities */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label text-[11px]">{translatePortalText("Monthly Price (")}{currency})</label>
                  <input
                    type="number"
                    className="input text-xs font-bold text-deep-900"
                    placeholder="1200"
                    value={monthlyPrice ?? ''}
                    onChange={e => setMonthlyPrice(e.target.value ? Number(e.target.value) : undefined)}
                  />
                </div>
                <div>
                  <label className="label text-[11px]">{translatePortalText("Pedestal Shore Power")}</label>
                  <select
                    className="input text-xs font-semibold"
                    value={power}
                    onChange={e => setPower(e.target.value)}
                  >
                    {POWER_OPTIONS.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Utility checkboxes */}
              <div className="flex flex-wrap gap-4 pt-1">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={water}
                    onChange={e => setWater(e.target.checked)}
                    className="rounded border-slate-300 text-ocean-600 focus:ring-ocean-500"
                  />
                  <Droplets size={14} className="text-ocean-500" /> {translatePortalText("Fresh Water\r\n                ")}</label>
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={wifi}
                    onChange={e => setWifi(e.target.checked)}
                    className="rounded border-slate-300 text-ocean-600 focus:ring-ocean-500"
                  />
                  <Wifi size={14} className="text-ocean-500" /> {translatePortalText("Marina WiFi\r\n                ")}</label>
              </div>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
          <button
            type="button"
            className="btn-ghost"
            onClick={onClose}
            disabled={busy}
          >
            {translatePortalText("Cancel\r\n          ")}</button>
          <button
            type="button"
            className="btn-primary flex items-center gap-2 px-5 py-2.5"
            onClick={save}
            disabled={busy}
          >
            {busy ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>{translatePortalText("Creating dock...")}</span>
              </>
            ) : (
              <>
                <Plus size={16} />
                <span>{translatePortalText("Create Dock ")}{code ? `"${code}"` : ''}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
    {createPontoon.modal}
    {createSlot.modal}
    </>
  )
}

