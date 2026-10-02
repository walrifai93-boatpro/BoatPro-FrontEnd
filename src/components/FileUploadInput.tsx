import React, { useState } from 'react'
import { UploadCloud, CheckCircle2, Loader2, FileText } from 'lucide-react'
import { fileUrl } from '../api'
import { pickFiles, toast } from '../ui'
import { translatePortalText } from '../i18n/runtime'

/** Single-file upload control (ID photo, CR/VAT certificate, profile photo, …). */
export default function FileUploadInput({
  label, hint, value, accept = 'image/*,application/pdf', onUpload,
}: {
  label: string
  hint?: string
  value?: string | null
  accept?: string
  onUpload: (file: File) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const url = fileUrl(value)
  const isImage = !!value && /\.(png|jpe?g|webp|gif)$/i.test(value)

  const pick = async () => {
    const files = await pickFiles(accept, false)
    if (!files.length) return
    setBusy(true)
    try {
      await onUpload(files[0])
      toast(`${translatePortalText('Uploaded')} ${translatePortalText(label)}`)
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Upload failed'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <label className="label">{translatePortalText(label)}</label>
      <button type="button" onClick={pick} disabled={busy}
        className={`flex w-full items-center gap-3 rounded-xl border-2 border-dashed p-3 text-left transition ${value ? 'border-emerald-300 bg-emerald-50/40' : 'border-slate-200 hover:border-ocean-300'}`}>
        {isImage && url ? (
          <img src={url} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover ring-1 ring-slate-200" />
        ) : (
          <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-lg ${value ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
            {value ? <FileText size={20} /> : <UploadCloud size={20} />}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-deep-900">
            {busy ? translatePortalText('Uploading…') : value ? translatePortalText('File uploaded — tap to replace') : `${translatePortalText('Upload')} ${translatePortalText(label)}`}
          </span>
          {hint && <span className="block text-[11px] text-slate-400">{translatePortalText(hint)}</span>}
        </span>
        {busy ? <Loader2 size={18} className="shrink-0 animate-spin text-ocean-500" /> : value ? <CheckCircle2 size={18} className="shrink-0 text-emerald-500" /> : null}
      </button>
    </div>
  )
}
