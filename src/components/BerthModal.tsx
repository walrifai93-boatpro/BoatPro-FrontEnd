import React, { useState, useEffect } from 'react'
import { useFormErrors, FieldError, submitFailureMessage } from '../shared/formErrors'
import { Plus, Trash2, Loader2, ImageOff, UploadCloud, X, Eye } from 'lucide-react'
import { Modal, toast, pickFiles } from '../ui'
import { useMarina, humanize } from '../live'
import { marinaApi, fileUrl, type ApiBerthMapEntry, type ApiPontoon, type SlotCategory } from '../api'
import { useLimitAwareAction, usePackageUsage } from '../shared/packageLimit'
import { canonicalField, translatePortalText } from '../i18n/runtime'


const CATEGORIES: SlotCategory[] = ['standard', 'premium', 'superyacht', 'catamaran', 'day_dock']
const POWER = ['16A', '32A', '63A', '3-phase 125A']

export interface BerthFormData {
  dock: string
  num: number
  category: SlotCategory
  maxLength?: number
  maxBeam?: number
  maxDraft?: number
  maxWeight?: number
  power?: string
  water: boolean
  wifi: boolean
  monthlyPrice?: number
  notes?: string
  images: string[]
}

interface BerthModalProps {
  open: boolean
  onClose: () => void
  berth: ApiBerthMapEntry | null // null when adding
  pontoons: ApiPontoon[]
  docks: string[]
  onSaved: () => Promise<void>
  initialDock?: string
  /** The marina's berths, so a duplicate number is caught here rather than as "Duplicate value for: pontoon, code". */
  berths?: ApiBerthMapEntry[]
}

const num = (v: string) => (v === '' ? undefined : Number(v))

export default function BerthModal({
  open,
  onClose,
  berth,
  pontoons,
  docks,
  onSaved,
  initialDock,
  berths = [],
}: BerthModalProps) {
  const { currency } = useMarina()
  const createSlot = useLimitAwareAction(marinaApi.createSlot)
  const usage = usePackageUsage()

  const [form, setForm] = useState<BerthFormData>({
    dock: '',
    num: 1,
    category: 'standard',
    water: true,
    wifi: true,
    power: '32A',
    images: [],
  })
  const [busy, setBusy] = useState(false)
  const [uploadingImages, setUploadingImages] = useState(false)
  const [stagedFiles, setStagedFiles] = useState<File[]>([])
  const [previewImage, setPreviewImage] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setStagedFiles([])
      setPreviewImage(null)
      return
    }

    if (berth) {
      setForm({
        dock: berth.pontoon,
        num: berth.number,
        category: berth.category,
        maxLength: berth.maxLength,
        maxBeam: berth.maxWidth,
        maxDraft: berth.maxDepth,
        maxWeight: berth.maxWeightTon,
        power: berth.powerSupply ?? '32A',
        water: berth.hasWater,
        wifi: berth.hasWifi,
        monthlyPrice: berth.monthlyPrice,
        notes: canonicalField<string>(berth, 'notes'),
        images: berth.images || [],
      })
    } else {
      const defaultDock = initialDock || docks[0] || ''
      setForm({
        dock: defaultDock,
        num: 1,
        category: 'standard',
        water: true,
        wifi: true,
        power: '32A',
        images: [],
      })
    }
  }, [open, berth, initialDock, docks])

  const handlePickImages = async () => {
    const files = await pickFiles('image/*', true)
    if (!files.length) return

    if (berth?.id) {
      // Direct upload if editing existing berth
      setUploadingImages(true)
      try {
        const res = await marinaApi.uploadSlotImages(berth.id, files)
        const updatedImages = res.data.images || []
        setForm((f) => ({ ...f, images: updatedImages }))
        toast(translatePortalText(`Uploaded ${files.length} berth photo${files.length > 1 ? 's' : ''}`), 'success')
      } catch (e) {
        toast(translatePortalText(e instanceof Error ? e.message : 'Image upload failed'), 'warn')
      } finally {
        setUploadingImages(false)
      }
    } else {
      // Stage files for new berth creation
      setStagedFiles((prev) => [...prev, ...files])
      // Create local preview URLs for staged files
      const localUrls = files.map((f) => URL.createObjectURL(f))
      setForm((f) => ({ ...f, images: [...f.images, ...localUrls] }))
      toast(translatePortalText(`Added ${files.length} photo${files.length > 1 ? 's' : ''} to upload upon saving`), 'info')
    }
  }

  const handleRemoveImage = async (index: number) => {
    const targetUrl = form.images[index]
    if (!targetUrl) return

    if (berth?.id && !targetUrl.startsWith('blob:')) {
      setUploadingImages(true)
      try {
        const res = await marinaApi.deleteSlotImage(berth.id, targetUrl)
        setForm((f) => ({ ...f, images: res.data.images || [] }))
        toast(translatePortalText('Berth photo removed'), 'info')
      } catch (e) {
        toast(translatePortalText(e instanceof Error ? e.message : 'Could not remove image'), 'warn')
      } finally {
        setUploadingImages(false)
      }
    } else {
      // Remove from staged
      setForm((f) => ({ ...f, images: f.images.filter((_, i) => i !== index) }))
      setStagedFiles((prev) => prev.filter((_, i) => i !== index))
    }
  }

  const save = async () => {
    if (busy) return
    /**
     * Checked before anything is written. The server accepts 0 for every
     * measurement and for the rate, so a 0 m berth (which no boat fits) or a
     * cleared rate saved without complaint; a negative one came back as a raw
     * validation error. A berth number of 0, -1 or 2.5 became the codes "S00",
     * "S-1" and "S2.5".
     */
    const problems: Record<string, string> = {}
    if (!berth && (!Number.isInteger(form.num) || form.num < 1)) problems.num = 'Berth number must be a whole number from 1'
    if (form.maxLength !== undefined && !(form.maxLength > 0)) problems.maxLength = 'Max length must be more than 0 m'
    if (form.maxBeam !== undefined && !(form.maxBeam > 0)) problems.maxBeam = 'Max beam must be more than 0 m'
    if (form.monthlyPrice !== undefined && !(form.monthlyPrice >= 0)) problems.monthlyPrice = 'Monthly rate cannot be negative'
    if (!berth && !problems.num) {
      const dockCode = form.dock || docks[0]
      const taken = berths.some(b => b.pontoon === dockCode && b.number === form.num)
      if (taken) problems.num = `Berth ${dockCode}-${String(form.num).padStart(2, '0')} already exists`
    }
    if (Object.keys(problems).length) { fe.fail(problems); return }
    if (form.maxDraft !== undefined && !(form.maxDraft > 0)) { toast(translatePortalText('Max draft must be more than 0 m'), 'warn'); return }
    if (form.maxWeight !== undefined && !(form.maxWeight >= 0)) { toast(translatePortalText('Weight capacity cannot be negative'), 'warn'); return }

    setBusy(true)
    const validImages = form.images.filter((img) => !img.startsWith('blob:'))
    const specs = {
      category: form.category ?? 'standard',
      maxLength: form.maxLength,
      maxWidth: form.maxBeam,
      maxDepth: form.maxDraft,
      maxWeightTon: form.maxWeight,
      powerSupply: form.power,
      hasWater: form.water ?? true,
      hasWifi: form.wifi ?? true,
      monthlyPrice: form.monthlyPrice,
      notes: form.notes,
      images: validImages,
    }

    try {
      if (!berth) {
        // Adding new berth
        const pontoon = pontoons.find((p) => p.code === (form.dock || docks[0]))
        if (!pontoon) {
          fe.fail({ dock: 'Choose the dock this berth belongs to' })
          setBusy(false)
          return
        }

        const slotCode = `S${String(form.num ?? 1).padStart(2, '0')}`
        const created = await createSlot.run(pontoon.id ?? (pontoon as any)._id, {
          code: slotCode,
          ...specs,
        })
        if (!created) {
          setBusy(false)
          return
        }

        // If staged files exist, upload them to newly created slot
        const createdId = created.data?.slot?._id ?? (created.data?.slot as { id?: string } | undefined)?.id
        if (stagedFiles.length > 0 && createdId) {
          try {
            await marinaApi.uploadSlotImages(createdId, stagedFiles)
          } catch {
            toast(translatePortalText('Berth created, but some images failed to upload'), 'warn')
          }
        }

        await usage.reload()
        toast(translatePortalText(`Berth ${form.dock}-${String(form.num ?? 1).padStart(2, '0')} created successfully!`), 'success')
      } else {
        // Updating existing berth
        await marinaApi.updateSlot(berth.id, specs)

        // If staged files exist, upload them too
        if (stagedFiles.length > 0) {
          try {
            await marinaApi.uploadSlotImages(berth.id, stagedFiles)
          } catch {
            toast(translatePortalText('Berth saved, but some images failed to upload'), 'warn')
          }
        }

        toast(translatePortalText(`Berth ${berth.pontoon}-${String(berth.number).padStart(2, '0')} updated successfully!`), 'success')
      }

      onClose()
      await onSaved()
    } catch (e) {
      const result = fe.capture(e)
      const msg = submitFailureMessage(result, e)
      if (msg) toast(translatePortalText(msg), 'warn')
    } finally {
      setBusy(false)
    }
  }

  /**
   * `name` is optional so the untouched fields keep working unchanged; supplying it
   * puts the field's own message directly beneath it.
   */
  const fe = useFormErrors({
    // The API's names for the same three measurements.
    rename: { maxWidth: 'maxBeam', maxDepth: 'maxDraft', code: 'num' },
  })

  const F = (label: string, node: React.ReactNode, name?: string) => (
    <div>
      <label className="label">{translatePortalText(label)}</label>
      {node}
      {name ? <FieldError errors={fe} name={name} /> : null}
    </div>
  )

  const isAdding = !berth

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={isAdding ? translatePortalText("➕ Add New Berth") : translatePortalText(`✏️ Edit Berth ${berth.pontoon}-${String(berth.number).padStart(2, '0')}`)}
      >
        <div className="space-y-4">
          {/* Main Specifications Grid */}
          <div className="grid grid-cols-2 gap-3.5">
            {F(
              'Dock / Pontoon',
              <select
                {...fe.fieldWith('dock', 'input')}
                value={form.dock || docks[0] || ''}
                disabled={!isAdding}
                onChange={(e) => { setForm((f) => ({ ...f, dock: e.target.value })); fe.clear('dock') }}
              >
                {docks.length === 0 && <option value="">{translatePortalText("No docks yet")}</option>}
                {docks.map((d) => (
                  <option key={d} value={d}>
                    {translatePortalText("Dock ")}{d}
                  </option>
                ))}
              </select>,
              'dock'
            )}
            {F(
              'Berth Number',
              <input
                type="number"
                min="1"
                {...fe.fieldWith('num', 'input')}
                value={form.num ?? ''}
                disabled={!isAdding}
                onChange={(e) => { setForm((f) => ({ ...f, num: +e.target.value })); fe.clear('num') }}
                placeholder="1"
              />,
              'num'
            )}
            {F(
              'Category',
              <select
                className="input"
                value={form.category ?? 'standard'}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as SlotCategory }))}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {humanize(c)}
                  </option>
                ))}
              </select>
            )}
            {F(
              `Monthly Rate (${currency})`,
              <input
                type="number"
                {...fe.fieldWith('monthlyPrice', 'input')}
                value={form.monthlyPrice ?? ''}
                onChange={(e) => { setForm((f) => ({ ...f, monthlyPrice: num(e.target.value) })); fe.clear('monthlyPrice') }}
                placeholder={translatePortalText('e.g. 2500')}
              />,
              'monthlyPrice'
            )}
            {F(
              'Max Length (LOA in m)',
              <input
                type="number"
                step="0.1"
                {...fe.fieldWith('maxLength', 'input')}
                value={form.maxLength ?? ''}
                onChange={(e) => { setForm((f) => ({ ...f, maxLength: num(e.target.value) })); fe.clear('maxLength') }}
                placeholder={translatePortalText('e.g. 15.5')}
              />,
              'maxLength'
            )}
            {F(
              'Max Beam (m)',
              <input
                type="number"
                step="0.1"
                {...fe.fieldWith('maxBeam', 'input')}
                value={form.maxBeam ?? ''}
                onChange={(e) => { setForm((f) => ({ ...f, maxBeam: num(e.target.value) })); fe.clear('maxBeam') }}
                placeholder={translatePortalText('e.g. 4.8')}
              />,
              'maxBeam'
            )}
            {F(
              'Max Draft (m)',
              <input
                type="number"
                step="0.1"
                className="input"
                value={form.maxDraft ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, maxDraft: num(e.target.value) }))}
                placeholder={translatePortalText('e.g. 2.2')}
              />
            )}
            {F(
              'Weight Capacity (tons)',
              <input
                type="number"
                className="input"
                value={form.maxWeight ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, maxWeight: num(e.target.value) }))}
                placeholder={translatePortalText('e.g. 25')}
              />
            )}
            {F(
              'Power Supply',
              <select
                className="input"
                value={form.power ?? '32A'}
                onChange={(e) => setForm((f) => ({ ...f, power: e.target.value }))}
              >
                <option value="">{translatePortalText("Not available")}</option>
                {POWER.map((p) => (
                  <option key={p} value={p}>
                    {translatePortalText(p)}
                  </option>
                ))}
              </select>
            )}
            {F(
              'Utility Hookups',
              <div className="flex gap-4 pt-2.5 text-xs font-bold text-deep-900">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    className="rounded border-slate-300 text-ocean-500 focus:ring-ocean-500"
                    checked={form.water ?? true}
                    onChange={(e) => setForm((f) => ({ ...f, water: e.target.checked }))}
                  />{' '}
                  {translatePortalText("💧 Fresh Water\r\n                ")}</label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    className="rounded border-slate-300 text-emerald-500 focus:ring-emerald-500"
                    checked={form.wifi ?? true}
                    onChange={(e) => setForm((f) => ({ ...f, wifi: e.target.checked }))}
                  />{' '}
                  {translatePortalText("📶 Dock Wi-Fi\r\n                ")}</label>
              </div>
            )}
          </div>

          {/* Notes */}
          {F(
            'Notes & Berth Description',
            <textarea
              className="input min-h-[60px]"
              value={form.notes ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder={translatePortalText("e.g. Deep water berth near harbour master, easy turning circle...")}
            />
          )}

          {/* Berth Photos / Image Upload Section */}
          <div className="rounded-2xl border border-slate-200 bg-sand/30 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{translatePortalText("📸 Berth Photos")}</p>
                <p className="text-[11px] text-slate-400">
                  {translatePortalText("Visible to boat providers when viewing the dock map and selecting berths\r\n                ")}</p>
              </div>
              <button
                type="button"
                onClick={handlePickImages}
                disabled={uploadingImages || busy}
                className="btn-secondary !py-1.5 !px-3 text-xs flex items-center gap-1.5"
              >
                {uploadingImages ? <Loader2 size={13} className="animate-spin" /> : <UploadCloud size={13} />}
                {translatePortalText("Upload Photos\r\n              ")}</button>
            </div>

            {form.images.length === 0 ? (
              <div
                onClick={handlePickImages}
                className="flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-200 bg-white py-6 text-slate-400 cursor-pointer hover:border-ocean-300 hover:bg-ocean-50/30 transition"
              >
                <ImageOff size={22} className="text-slate-300" />
                <p className="text-xs font-semibold text-slate-500">{translatePortalText("No photos uploaded for this berth")}</p>
                <p className="text-[10px] text-slate-400">{translatePortalText("Click to upload slip photos, pedestal view, or clearance angles")}</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
                {form.images.map((imgUrl, i) => {
                  const resolved = imgUrl.startsWith('blob:') ? imgUrl : fileUrl(imgUrl)
                  return (
                    <div
                      key={`${imgUrl}-${i}`}
                      className="group relative aspect-square overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-200"
                    >
                      <img src={resolved} alt="" className="h-full w-full object-cover" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => setPreviewImage(resolved)}
                          className="grid h-7 w-7 place-items-center rounded-full bg-white/90 text-deep-900 shadow hover:bg-white transition"
                          title={translatePortalText("View photo")}
                        >
                          <Eye size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveImage(i)}
                          disabled={uploadingImages}
                          className="grid h-7 w-7 place-items-center rounded-full bg-rose-500 text-white shadow hover:bg-rose-600 transition"
                          title={translatePortalText("Delete photo")}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button className="btn-ghost" onClick={onClose} disabled={busy || uploadingImages}>
              {translatePortalText("Cancel\r\n            ")}</button>
            <button className="btn-primary" disabled={busy || uploadingImages} onClick={save}>
              {busy ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> {translatePortalText("Saving…\r\n                ")}</>
              ) : isAdding ? (
                translatePortalText('Add Berth')
              ) : (
                translatePortalText('Save Changes')
              )}
            </button>
          </div>
        </div>
      </Modal>

      {/* Full Photo Preview Lightbox */}
      {previewImage && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-h-[85vh] max-w-[90vw] overflow-hidden rounded-2xl bg-black" onClick={(e) => e.stopPropagation()}>
            <img src={previewImage} alt={translatePortalText("Berth preview")} className="max-h-[80vh] max-w-[85vw] object-contain rounded-xl" />
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute end-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white hover:bg-black/90 transition"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}


      {/* Limit Reached Warning & Add-On Purchase Modal */}
      {createSlot.modal}
    </>
  )
}


