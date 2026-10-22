import React, { useEffect, useRef, useState } from 'react'
import { ImageUp, Wand2 } from 'lucide-react'
import { Modal, Spinner, toast } from '../ui'
import { translatePortalText } from '../i18n/runtime'

/**
 * Upload a logo for a vessel category / trip type, background removed.
 *
 * Runs entirely in the browser on a canvas — no service, no model download:
 *  1. Already transparent (a PNG with a clear surround)? Kept as it is.
 *  2. Otherwise the background colour is read off the image's border, and every
 *     pixel connected to the border within the tolerance becomes transparent
 *     (a flood fill from the outside in, so white details *inside* the logo —
 *     windows, a sail — survive). Pixels just past the tolerance get partial
 *     alpha so the edge stays smooth instead of jagged.
 *  3. The result is trimmed to the artwork and centred on a 512×512 transparent
 *     square, which is what the apps draw in their category strips.
 * Logos on a flat or near-flat background come out clean; a photo with a busy
 * background will not — the preview shows it before anything is saved.
 */

const OUT = 512

type Rgb = [number, number, number]
const dist = (a: Rgb, r: number, g: number, b: number) => Math.sqrt((a[0] - r) ** 2 + (a[1] - g) ** 2 + (a[2] - b) ** 2)

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    // The pixels are copied onto a canvas straight away, so the blob URL is
    // done with once decoded either way — it was never released.
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not an image the browser can read')) }
    img.src = url
  })
}

/** Median colour and transparency share of the outermost pixel ring. */
function borderStats(d: Uint8ClampedArray, w: number, h: number): { bg: Rgb; transparentShare: number } {
  const rs: number[] = [], gs: number[] = [], bs: number[] = []
  let clear = 0, n = 0
  const take = (x: number, y: number) => {
    const i = (y * w + x) * 4
    n++
    if (d[i + 3] < 250) clear++
    rs.push(d[i]); gs.push(d[i + 1]); bs.push(d[i + 2])
  }
  for (let x = 0; x < w; x++) { take(x, 0); take(x, h - 1) }
  for (let y = 1; y < h - 1; y++) { take(0, y); take(w - 1, y) }
  const med = (v: number[]) => v.sort((a, b) => a - b)[Math.floor(v.length / 2)]
  return { bg: [med(rs), med(gs), med(bs)], transparentShare: clear / Math.max(1, n) }
}

function removeBackground(d: Uint8ClampedArray, w: number, h: number, bg: Rgb, tol: number) {
  const soft = tol * 1.6
  const seen = new Uint8Array(w * h)
  const queue: number[] = []
  const push = (p: number) => {
    if (seen[p]) return
    const i = p * 4
    const dd = dist(bg, d[i], d[i + 1], d[i + 2])
    if (d[i + 3] < 10 || dd <= tol) {
      seen[p] = 1
      queue.push(p)
    } else if (dd <= soft) {
      // Edge pixel: fade it rather than cut it.
      seen[p] = 2
      d[i + 3] = Math.round(d[i + 3] * ((dd - tol) / (soft - tol)))
    }
  }
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x) }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1) }
  while (queue.length) {
    const p = queue.pop()!
    d[p * 4 + 3] = 0
    const x = p % w, y = (p - x) / w
    if (x > 0) push(p - 1)
    if (x < w - 1) push(p + 1)
    if (y > 0) push(p - w)
    if (y < h - 1) push(p + w)
  }
}

/** Draws `img` processed onto a fresh 512×512 transparent canvas. */
export function prepare(img: HTMLImageElement, opts: { remove: boolean; tol: number }): { canvas: HTMLCanvasElement; alreadyClear: boolean; empty?: boolean } {
  const scale = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const work = document.createElement('canvas')
  work.width = w
  work.height = h
  const ctx = work.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h)
  const { bg, transparentShare } = borderStats(data.data, w, h)
  const alreadyClear = transparentShare > 0.5
  if (opts.remove && !alreadyClear) removeBackground(data.data, w, h, bg, opts.tol)
  ctx.putImageData(data, 0, 0)

  // Trim to what is left, with a little breathing room.
  let minX = w, minY = h, maxX = -1, maxY = -1
  const px = data.data
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (px[(y * w + x) * 4 + 3] > 12) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  const out = document.createElement('canvas')
  out.width = OUT
  out.height = OUT
  // Nothing left — the removal took the whole image. Flagged so the dialog can
  // refuse to save a blank square as the logo.
  if (maxX < 0) return { canvas: out, alreadyClear, empty: true }
  const bw = maxX - minX + 1, bh = maxY - minY + 1
  const fit = (OUT * 0.92) / Math.max(bw, bh)
  const dw = bw * fit, dh = bh * fit
  const octx = out.getContext('2d')!
  octx.imageSmoothingQuality = 'high'
  octx.drawImage(work, minX, minY, bw, bh, (OUT - dw) / 2, (OUT - dh) / 2, dw, dh)
  return { canvas: out, alreadyClear }
}

const CHECKER = 'repeating-conic-gradient(#e2e8f0 0% 25%, #ffffff 0% 50%) 50% / 18px 18px'

export function LogoUploadModal({ open, title, onClose, onSave }: {
  open: boolean
  title: string
  onClose: () => void
  /** Receives the prepared transparent PNG. */
  onSave: (png: Blob) => Promise<void>
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [remove, setRemove] = useState(true)
  const [tol, setTol] = useState(38)
  const [preview, setPreview] = useState<string | null>(null)
  const [alreadyClear, setAlreadyClear] = useState(false)
  const [empty, setEmpty] = useState(false)
  const [saving, setSaving] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (!open) { setImg(null); setPreview(null); setRemove(true); setTol(38); setEmpty(false) }
  }, [open])

  useEffect(() => {
    if (!img) return
    const { canvas, alreadyClear: clear, empty: blank } = prepare(img, { remove, tol })
    canvasRef.current = canvas
    setAlreadyClear(clear)
    setEmpty(!!blank)
    setPreview(canvas.toDataURL('image/png'))
  }, [img, remove, tol])

  const pick = async (file?: File | null) => {
    if (!file) return
    // `accept` is only a hint to the picker; "All files" gets past it.
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { toast(translatePortalText('Choose a PNG, JPG or WebP image'), 'warn'); return }
    if (file.size > 8 * 1024 * 1024) { toast(translatePortalText('Keep the image under 8 MB'), 'warn'); return }
    try {
      setImg(await loadImage(file))
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not read that image'), 'warn')
    }
  }

  const save = async () => {
    const canvas = canvasRef.current
    if (!canvas || empty || saving) return
    setSaving(true)
    try {
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
      if (!blob) throw new Error('Could not prepare the PNG')
      await onSave(blob)
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Upload failed'), 'warn')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={title}>
      {/* Value cleared after each pick, or choosing the same file again fires no change. */}
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void pick(f) }} />
      {!img ? (
        <button type="button" onClick={() => inputRef.current?.click()}
          className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 p-8 text-slate-500 transition hover:border-emerald-300 hover:text-emerald-700">
          <ImageUp size={28} />
          <span className="text-sm font-bold">{translatePortalText('Choose a logo image')}</span>
          <span className="text-xs">{translatePortalText('PNG, JPG or WebP. The background is removed for you — logos on a plain background work best.')}</span>
        </button>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {[{ label: 'Transparent', bg: CHECKER }, { label: 'On light', bg: '#ffffff' }, { label: 'On dark', bg: '#0b2238' }].map((v) => (
              <div key={v.label} className="text-center">
                <div className="grid aspect-square place-items-center rounded-xl ring-1 ring-slate-200" style={{ background: v.bg }}>
                  {preview && <img src={preview} alt="" className="h-[80%] w-[80%] object-contain" />}
                </div>
                <p className="mt-1 text-[11px] font-semibold text-slate-400">{translatePortalText(v.label)}</p>
              </div>
            ))}
          </div>

          {empty && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{translatePortalText('Nothing is left after removing the background — lower the strength or turn removal off.')}</p>
          )}

          {alreadyClear ? (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">{translatePortalText('This image already has a transparent background — kept as it is.')}</p>
          ) : (
            <div className="space-y-2 rounded-xl bg-sand px-3 py-3">
              <label className="flex items-center gap-2 text-sm font-bold text-deep-900">
                <input type="checkbox" checked={remove} onChange={(e) => setRemove(e.target.checked)} />
                <Wand2 size={14} className="text-emerald-600" /> {translatePortalText('Remove background')}
              </label>
              {remove && (
                <label className="block text-xs font-semibold text-slate-500">
                  {translatePortalText('Strength')} — {tol}
                  <input type="range" min={5} max={120} value={tol} onChange={(e) => setTol(Number(e.target.value))} className="mt-1 w-full" />
                  <span className="block text-[11px] font-normal text-slate-400">{translatePortalText('Raise it if a halo of the old background is left; lower it if parts of the logo disappear.')}</span>
                </label>
              )}
            </div>
          )}

          <div className="flex justify-between gap-2">
            <button className="btn-ghost" onClick={() => inputRef.current?.click()}>{translatePortalText('Choose another')}</button>
            <div className="flex gap-2">
              <button className="btn-ghost" onClick={onClose}>{translatePortalText('Cancel')}</button>
              <button className="btn-admin" disabled={saving || !preview || empty} onClick={() => void save()}>{saving ? <Spinner size={14} /> : <ImageUp size={14} />} {translatePortalText('Save logo')}</button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
