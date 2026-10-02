import React, { useState } from 'react'
import { Plus, Trash2, Loader2, ImageOff } from 'lucide-react'
import { fileUrl } from '../api'
import { pickFiles, toast } from '../ui'
import { translatePortalText } from '../i18n/runtime'


export default function ImageGalleryUpload({
  images, categories, min = 5, max = 20, onUpload, onDelete,
}: {
  images: { url: string; category?: string }[]
  categories: string[]
  min?: number
  max?: number
  onUpload: (files: File[], category?: string) => Promise<void>
  onDelete: (index: number) => Promise<void>
}) {
  const [category, setCategory] = useState(categories[0] || '')
  const [busy, setBusy] = useState(false)
  const [deletingAt, setDeletingAt] = useState<number | null>(null)

  const add = async () => {
    const room = Math.max(0, max - images.length)
    if (room === 0) { toast(translatePortalText(`Maximum ${max} images reached`), 'warn'); return }
    const files = await pickFiles('image/*', true)
    if (!files.length) return
    setBusy(true)
    try {
      await onUpload(files.slice(0, room), category || undefined)
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Upload failed'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (i: number) => {
    setDeletingAt(i)
    try {
      await onDelete(i)
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not remove image'), 'warn')
    } finally {
      setDeletingAt(null)
    }
  }

  const short = images.length < min

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={`text-xs font-bold ${short ? 'text-amber-600' : 'text-emerald-600'}`}>
          {translatePortalText(`${images.length} / ${max} images uploaded${short ? ` (minimum ${min} required)` : ''}`)}
        </p>
        <div className="flex items-center gap-2">
          {categories.length > 0 && (
            <select className="input !py-1.5 !text-xs" value={category} onChange={(e) => setCategory(e.target.value)}>
              {categories.map((c) => <option key={c} value={c}>{translatePortalText(c.replace(/_/g, ' '))}</option>)}
            </select>
          )}
          <button type="button" onClick={add} disabled={busy || images.length >= max}
            className="btn-ghost !py-1.5 !px-3 text-xs disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} {translatePortalText("Add images\n          ")}</button>
        </div>
      </div>

      {images.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-200 py-10 text-slate-400">
          <ImageOff size={28} />
          <p className="text-xs font-medium">{translatePortalText("No images yet")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {images.map((img, i) => (
            <div key={`${img.url}-${i}`} className="group relative aspect-square overflow-hidden rounded-xl ring-1 ring-slate-200">
              <img src={fileUrl(img.url)} alt="" className="h-full w-full object-cover" />
              {img.category && <span className="absolute bottom-1 start-1 rounded-full bg-black/60 px-2 py-0.5 text-[9px] font-bold uppercase text-white">{translatePortalText(img.category.replace(/_/g, ' '))}</span>}
              <button type="button" onClick={() => remove(i)} disabled={deletingAt === i}
                className="absolute end-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white opacity-0 transition group-hover:opacity-100">
                {deletingAt === i ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
