import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, X, Plus, Tags, EyeOff, Eye, RefreshCw, ImageUp, RotateCcw } from 'lucide-react'
import { PageWrap } from './_shared'
import { AdminHeader, ABadge } from '../adminUi'
import { Modal, toast, Spinner } from '../../ui'
import { translatePortalText, formatPortalDate } from '../../i18n/runtime'
import { fileUrl, taxonomyAdminApi, type ApiTaxonomyManaged, type ApiTaxonomyRow, type HullFormKey, type TaxonomyListType } from '../../api'
import { LogoUploadModal } from '../LogoUploadModal'
import { BOAT_CATEGORIES, TRIP_TYPES } from '../../constants/vesselTaxonomy'

// ══════════ VESSEL & TRIP TYPES ══════════
//
// The platform owns one list of vessel categories, trip types and equipment,
// shared by every provider and customer — the marketplace norm. Providers can
// no longer mint their own entries (that produced "motor_boat" beside
// "motorboat", and rows like "hi"); they pick from the list, use "Other" with a
// description, and request what is missing. This page is where those requests
// are approved into the list or declined with a reason.

const TYPE_LABEL: Record<TaxonomyListType, string> = {
  boat_category: 'Vessel category',
  trip_type: 'Trip type',
  engine_type: 'Engine type',
  hull_material: 'Hull material',
  navigation_equipment: 'Navigation equipment',
  safety_equipment: 'Safety equipment',
}

const HULL_FORMS: { key: HullFormKey; label: string }[] = [
  { key: 'power', label: 'Powerboat' },
  { key: 'sail', label: 'Sailboat' },
  { key: 'multihull', label: 'Catamaran / multihull' },
  { key: 'pwc', label: 'Jet ski / PWC' },
]

type Tab = 'vessels' | 'trips' | 'pending' | 'approved' | 'rejected'

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60)

function requester(r: ApiTaxonomyRow): string {
  const c = r.createdBy
  if (!c || typeof c === 'string') return '—'
  return c.business?.businessName || c.name || c.email || '—'
}

export function AdminTaxonomy() {
  const [tab, setTab] = useState<Tab>('vessels')
  const [rows, setRows] = useState<ApiTaxonomyRow[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [approving, setApproving] = useState<ApiTaxonomyRow | null>(null)
  const [rejecting, setRejecting] = useState<ApiTaxonomyRow | null>(null)
  const [adding, setAdding] = useState(false)
  /** Bumped after an add so the Vessel / Trip types grid refetches. */
  const [listVersion, setListVersion] = useState(0)

  const load = async () => {
    if (tab === 'vessels' || tab === 'trips') {
      setLoading(false)
      // Keep the request badge fresh while browsing the lists.
      taxonomyAdminApi.list('pending').then((r) => setPendingCount(r.data.counts.pending)).catch(() => {})
      return
    }
    setLoading(true)
    try {
      const res = await taxonomyAdminApi.list(tab)
      setRows(res.data.items)
      setPendingCount(res.data.counts.pending)
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not load the list'), 'warn')
    } finally {
      setLoading(false)
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [tab])

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'vessels', label: 'Vessel types' },
    { key: 'trips', label: 'Trip types' },
    { key: 'pending', label: 'Requests', count: pendingCount },
    { key: 'approved', label: 'Added to the list' },
    { key: 'rejected', label: 'Declined' },
  ]

  const toggleActive = async (r: ApiTaxonomyRow) => {
    try {
      await taxonomyAdminApi.setActive(r._id, !r.isActive)
      toast(translatePortalText(r.isActive ? `"${r.labelEn}" hidden — providers can no longer pick it` : `"${r.labelEn}" restored`))
      await load()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not update'), 'warn')
    }
  }

  return (
    <PageWrap>
      <AdminHeader
        title="Vessel & Trip Types"
        sub="One curated list for every provider and customer. Approve requests into it, decline with a reason, or add entries yourself."
        icon={<Tags className="text-emerald-600" />}
        actions={<>
          <button className="btn-ghost" onClick={() => void load()}><RefreshCw size={14} /> {translatePortalText('Refresh')}</button>
          <button className="btn-admin" onClick={() => setAdding(true)}>
            <Plus size={15} /> {translatePortalText(tab === 'vessels' ? 'Add vessel type' : tab === 'trips' ? 'Add trip type' : 'Add entry')}
          </button>
        </>}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`rounded-full px-4 py-2 text-sm font-bold transition ${tab === t.key ? 'bg-emerald-600 text-white shadow' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:ring-emerald-300'}`}>
            {translatePortalText(t.label)}{t.count ? ` · ${t.count}` : ''}
          </button>
        ))}
      </div>

      {tab === 'vessels' || tab === 'trips' ? (
        <ManagedList key={`${tab}-${listVersion}`} type={tab === 'vessels' ? 'boat_category' : 'trip_type'} />
      ) : loading ? (
        <div className="card grid place-items-center p-10"><Spinner size={22} /></div>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center text-sm text-slate-500">
          {translatePortalText(tab === 'pending' ? 'No requests waiting. Providers ask for missing types from the boat and trip forms.' : 'Nothing here yet.')}
        </div>
      ) : (
        <div className="card overflow-hidden !p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead><tr className="border-b border-slate-100 bg-sand/50 text-left">
                <th className="th">{translatePortalText('Name')}</th>
                <th className="th">{translatePortalText('List')}</th>
                <th className="th">{translatePortalText(tab === 'approved' ? 'Key' : 'Requested by')}</th>
                <th className="th">{translatePortalText(tab === 'rejected' ? 'Reason' : 'Details')}</th>
                <th className="th">{translatePortalText('Date')}</th>
                <th className="th text-right">{translatePortalText('Actions')}</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <motion.tr key={r._id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="border-b border-slate-50 last:border-b-0">
                    <td className="td">
                      <p className="font-bold text-deep-900">{r.labelEn}</p>
                      {r.labelAr && r.labelAr !== r.labelEn && <p className="text-xs text-slate-500" dir="rtl">{r.labelAr}</p>}
                    </td>
                    <td className="td text-xs">
                      {translatePortalText(TYPE_LABEL[r.type])}
                      {r.type === 'boat_category' && r.hullForm && <p className="text-[11px] text-slate-400">{translatePortalText(HULL_FORMS.find((h) => h.key === r.hullForm)?.label || r.hullForm)}</p>}
                    </td>
                    <td className="td text-xs">{tab === 'approved' ? <code className="rounded bg-slate-100 px-1.5 py-0.5">{r.key}</code> : requester(r)}</td>
                    <td className="td max-w-[280px] text-xs text-slate-500">{tab === 'rejected' ? r.reviewNote : r.description || '—'}</td>
                    <td className="td whitespace-nowrap text-xs text-slate-500">{formatPortalDate(r.createdAt)}</td>
                    <td className="td">
                      <div className="flex justify-end gap-1.5">
                        {tab === 'pending' && (<>
                          <button className="btn-admin !py-1.5 !text-[12px]" onClick={() => setApproving(r)}><Check size={13} /> {translatePortalText('Approve')}</button>
                          <button className="btn-ghost !py-1.5 !text-[12px] !text-rose-500" onClick={() => setRejecting(r)}><X size={13} /> {translatePortalText('Decline')}</button>
                        </>)}
                        {tab === 'approved' && (
                          <button className="btn-ghost !py-1.5 !text-[12px]" onClick={() => void toggleActive(r)}>
                            {r.isActive ? <><EyeOff size={13} /> {translatePortalText('Hide')}</> : <><Eye size={13} /> {translatePortalText('Restore')}</>}
                          </button>
                        )}
                        {tab === 'approved' && !r.isActive && <ABadge>{translatePortalText('Hidden')}</ABadge>}
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ApproveModal row={approving} onClose={() => setApproving(null)} onDone={async () => { setApproving(null); await load() }} />
      <RejectModal row={rejecting} onClose={() => setRejecting(null)} onDone={async () => { setRejecting(null); await load() }} />
      <AddModal
        open={adding}
        initialType={tab === 'trips' ? 'trip_type' : 'boat_category'}
        onClose={() => setAdding(false)}
        onDone={async () => {
          setAdding(false)
          // From a list tab, stay on it and show the new card; otherwise go to the additions.
          if (tab === 'vessels' || tab === 'trips') setListVersion((v) => v + 1)
          else { setTab('approved'); await load() }
        }}
      />
    </PageWrap>
  )
}

/**
 * Every entry of one list — built-in and approved — as cards with their logo.
 * Built-ins show the artwork the apps draw today until an admin uploads a
 * replacement; "Reset" goes back to it.
 */
function ManagedList({ type }: { type: 'boat_category' | 'trip_type' }) {
  const [items, setItems] = useState<ApiTaxonomyManaged[] | null>(null)
  const [uploading, setUploading] = useState<ApiTaxonomyManaged | null>(null)
  const [stamp, setStamp] = useState(0)

  const load = async () => {
    try {
      const res = await taxonomyAdminApi.manage(type)
      setItems(res.data.items)
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not load the list'), 'warn')
      setItems([])
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setItems(null); void load() }, [type])

  // The apps' own artwork for built-ins, exported by scripts/export-vessel-logos.mjs.
  const defaultArt = (key: string) => {
    if (key === 'other') return undefined
    if (type === 'boat_category') return BOAT_CATEGORIES.some((c) => c.key === key) ? `/vessel-logos/${key}.svg` : undefined
    return TRIP_TYPES.some((t) => t.key === key) ? `/trip-logos/${key}.svg` : undefined
  }

  const resetLogo = async (e: ApiTaxonomyManaged) => {
    try {
      await taxonomyAdminApi.removeLogo(type, e.key)
      toast(translatePortalText(`"${e.labelEn}" uses the app's own artwork again`))
      await load()
    } catch (err) {
      toast(translatePortalText(err instanceof Error ? err.message : 'Could not reset'), 'warn')
    }
  }
  const toggle = async (e: ApiTaxonomyManaged) => {
    if (!e.id) return
    try {
      await taxonomyAdminApi.setActive(e.id, !e.isActive)
      toast(translatePortalText(e.isActive ? `"${e.labelEn}" hidden — providers can no longer pick it` : `"${e.labelEn}" restored`))
      await load()
    } catch (err) {
      toast(translatePortalText(err instanceof Error ? err.message : 'Could not update'), 'warn')
    }
  }

  if (!items) return <div className="card grid place-items-center p-10"><Spinner size={22} /></div>

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {items.map((e) => {
          const art = e.logoUrl ? `${fileUrl(e.logoUrl)}?v=${stamp}` : defaultArt(e.key)
          return (
            <motion.div key={e.key} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              className={`card flex flex-col gap-3 p-4 ${e.isActive ? '' : 'opacity-60'}`}>
              <div className="grid h-28 place-items-center rounded-xl bg-sand">
                {art
                  ? <img src={art} alt="" className="max-h-[84px] max-w-[85%] object-contain" />
                  : <span className="text-xs font-semibold text-slate-400">{translatePortalText(e.key === 'other' ? 'Generic mark in the apps' : 'No logo yet')}</span>}
              </div>
              <div>
                <p className="font-bold text-deep-900">{e.labelEn}</p>
                <p className="text-xs text-slate-500" dir="rtl">{e.labelAr}</p>
              </div>
              <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold">
                <span className={`rounded-full px-2 py-0.5 ${e.source === 'built_in' ? 'bg-slate-100 text-slate-600' : 'bg-emerald-50 text-emerald-700'}`}>{translatePortalText(e.source === 'built_in' ? 'Built-in' : 'Added')}</span>
                {e.hullForm && <span className="rounded-full bg-sky-50 px-2 py-0.5 text-sky-700">{translatePortalText(HULL_FORMS.find((h) => h.key === e.hullForm)?.label || e.hullForm)}</span>}
                <span className="rounded-full bg-slate-50 px-2 py-0.5 text-slate-500">{e.usage} {translatePortalText(type === 'boat_category' ? (e.usage === 1 ? 'boat' : 'boats') : (e.usage === 1 ? 'trip' : 'trips'))}</span>
                {e.logoUrl && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-violet-700">{translatePortalText('Custom logo')}</span>}
                {!e.isActive && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">{translatePortalText('Hidden')}</span>}
              </div>
              <div className="mt-auto flex flex-wrap gap-1.5">
                <button className="btn-admin !py-1.5 !text-[12px]" onClick={() => setUploading(e)}><ImageUp size={13} /> {translatePortalText(e.logoUrl ? 'Replace logo' : 'Upload logo')}</button>
                {e.logoUrl && <button className="btn-ghost !py-1.5 !text-[12px]" onClick={() => void resetLogo(e)}><RotateCcw size={13} /> {translatePortalText('Reset')}</button>}
                {e.source === 'approved' && (
                  <button className="btn-ghost !py-1.5 !text-[12px]" onClick={() => void toggle(e)}>
                    {e.isActive ? <><EyeOff size={13} /> {translatePortalText('Hide')}</> : <><Eye size={13} /> {translatePortalText('Restore')}</>}
                  </button>
                )}
              </div>
            </motion.div>
          )
        })}
      </div>
      <LogoUploadModal
        open={!!uploading}
        title={translatePortalText(`Logo for "${uploading?.labelEn ?? ''}"`)}
        onClose={() => setUploading(null)}
        onSave={async (png) => {
          if (!uploading) return
          await taxonomyAdminApi.uploadLogo(type, uploading.key, png)
          toast(translatePortalText(`Logo saved — the apps show it for "${uploading.labelEn}"`))
          setUploading(null)
          setStamp(Date.now())
          await load()
        }}
      />
    </>
  )
}

const CHECKER = 'repeating-conic-gradient(#e2e8f0 0% 25%, #ffffff 0% 50%) 50% / 14px 14px'

/**
 * Optional logo inside the Add / Approve dialogs — the same background
 * removal as the cards' "Upload logo", held until the entry exists and then
 * uploaded against its key.
 */
function LogoField({ value, onChange, name }: { value: Blob | null; onChange: (b: Blob | null) => void; name: string }) {
  const [open, setOpen] = useState(false)
  const url = useMemo(() => (value ? URL.createObjectURL(value) : null), [value])
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])
  return (
    <div className="block text-xs font-bold text-slate-500">
      {translatePortalText('Logo (optional)')}
      <div className="mt-1 flex items-center gap-3">
        <div className="grid h-16 w-16 shrink-0 place-items-center rounded-xl ring-1 ring-slate-200" style={{ background: CHECKER }}>
          {url ? <img src={url} alt="" className="h-[80%] w-[80%] object-contain" /> : <ImageUp size={18} className="text-slate-300" />}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className="btn-ghost !py-1.5 !text-[12px]" onClick={() => setOpen(true)}>
            <ImageUp size={13} /> {translatePortalText(value ? 'Change logo' : 'Choose logo')}
          </button>
          {value && <button type="button" className="btn-ghost !py-1.5 !text-[12px] !text-rose-500" onClick={() => onChange(null)}><X size={13} /> {translatePortalText('Remove')}</button>}
        </div>
      </div>
      <p className="mt-1 text-[11px] font-normal text-slate-400">{translatePortalText('The background is removed for you. Without a logo the apps show a generic mark.')}</p>
      <LogoUploadModal
        open={open}
        title={translatePortalText(`Logo for "${name || 'new entry'}"`)}
        onClose={() => setOpen(false)}
        onSave={async (png) => { onChange(png); setOpen(false) }}
      />
    </div>
  )
}

const hasLogo = (t: TaxonomyListType): t is 'boat_category' | 'trip_type' => t === 'boat_category' || t === 'trip_type'

function ApproveModal({ row, onClose, onDone }: { row: ApiTaxonomyRow | null; onClose: () => void; onDone: () => void }) {
  const [labelEn, setLabelEn] = useState('')
  const [labelAr, setLabelAr] = useState('')
  const [key, setKey] = useState('')
  const [hullForm, setHullForm] = useState<HullFormKey>('power')
  const [logo, setLogo] = useState<Blob | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!row) return
    setLogo(null)
    setLabelEn(row.labelEn)
    setLabelAr(row.labelAr && row.labelAr !== row.labelEn ? row.labelAr : '')
    setKey(row.key)
    setHullForm(row.hullForm ?? 'power')
  }, [row])
  const valid = labelEn.trim().length >= 2 && labelAr.trim().length >= 2 && labelAr.trim() !== labelEn.trim() && slug(key).length > 0
  const submit = async () => {
    if (!row || !valid) return
    setBusy(true)
    try {
      const res = await taxonomyAdminApi.approve(row._id, { labelEn: labelEn.trim(), labelAr: labelAr.trim(), key: slug(key), ...(row.type === 'boat_category' ? { hullForm } : {}) })
      if (logo && hasLogo(row.type)) {
        try {
          await taxonomyAdminApi.uploadLogo(row.type, res.data.item.key, logo)
        } catch (e) {
          toast(translatePortalText(`Approved, but the logo did not upload: ${e instanceof Error ? e.message : 'error'} — add it from the card`), 'warn')
        }
      }
      toast(translatePortalText(`"${labelEn.trim()}" added — the provider was notified`))
      onDone()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not approve'), 'warn')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={!!row} onClose={onClose} title={translatePortalText(`Add to ${row ? TYPE_LABEL[row.type].toLowerCase() : ''} list`)}>
      {row && (
        <div className="space-y-3">
          {row.description && <p className="rounded-lg bg-sand px-3 py-2 text-xs text-slate-600"><b>{translatePortalText('Provider said:')}</b> {row.description}</p>}
          <label className="block text-xs font-bold text-slate-500">{translatePortalText('English name')}
            <input className="input mt-1" value={labelEn} onChange={(e) => setLabelEn(e.target.value)} maxLength={60} />
          </label>
          <label className="block text-xs font-bold text-slate-500">{translatePortalText('Arabic name (required)')}
            <input className="input mt-1" dir="rtl" value={labelAr} onChange={(e) => setLabelAr(e.target.value)} maxLength={60} />
          </label>
          <label className="block text-xs font-bold text-slate-500">{translatePortalText('Key (stored on listings — cannot change later)')}
            <input className="input mt-1 font-mono" value={key} onChange={(e) => setKey(e.target.value)} />
            <span className="mt-1 block text-[11px] font-normal text-slate-400">{slug(key) || '—'}</span>
          </label>
          {row.type === 'boat_category' && (
            <label className="block text-xs font-bold text-slate-500">{translatePortalText('Hull form (how marinas berth it)')}
              <select className="input mt-1" value={hullForm} onChange={(e) => setHullForm(e.target.value as HullFormKey)}>
                {HULL_FORMS.map((h) => <option key={h.key} value={h.key}>{translatePortalText(h.label)}</option>)}
              </select>
            </label>
          )}
          {hasLogo(row.type) && <LogoField value={logo} onChange={setLogo} name={labelEn} />}
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-ghost" onClick={onClose}>{translatePortalText('Cancel')}</button>
            <button className="btn-admin" disabled={!valid || busy} onClick={() => void submit()}>{busy ? <Spinner size={14} /> : <Check size={14} />} {translatePortalText('Approve & add')}</button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function RejectModal({ row, onClose, onDone }: { row: ApiTaxonomyRow | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (row) setReason('') }, [row])
  const submit = async () => {
    if (!row || reason.trim().length < 3) return
    setBusy(true)
    try {
      await taxonomyAdminApi.reject(row._id, reason.trim())
      toast(translatePortalText(`Request declined — the provider was told why`), 'warn')
      onDone()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not decline'), 'warn')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={!!row} onClose={onClose} title={translatePortalText(`Decline "${row?.labelEn ?? ''}"`)}>
      <p className="mb-2 text-sm text-slate-500">{translatePortalText('Tell the provider why — e.g. which existing entry to use instead.')}</p>
      <textarea className="input min-h-[90px]" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={translatePortalText('e.g. Use "Motorboat" — it covers speed boats and RIBs.')} />
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>{translatePortalText('Cancel')}</button>
        <button className="btn-admin !bg-gradient-to-r !from-rose-500 !to-rose-600" disabled={reason.trim().length < 3 || busy} onClick={() => void submit()}>{translatePortalText('Decline request')}</button>
      </div>
    </Modal>
  )
}

function AddModal({ open, initialType = 'boat_category', onClose, onDone }: { open: boolean; initialType?: TaxonomyListType; onClose: () => void; onDone: () => void }) {
  const [type, setType] = useState<TaxonomyListType>('boat_category')
  const [labelEn, setLabelEn] = useState('')
  const [labelAr, setLabelAr] = useState('')
  const [hullForm, setHullForm] = useState<HullFormKey>('power')
  const [logo, setLogo] = useState<Blob | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) { setType(initialType); setLabelEn(''); setLabelAr(''); setHullForm('power'); setLogo(null) } }, [open, initialType])
  const valid = useMemo(() => labelEn.trim().length >= 2 && labelAr.trim().length >= 2 && labelAr.trim() !== labelEn.trim(), [labelEn, labelAr])
  const submit = async () => {
    if (!valid) return
    setBusy(true)
    try {
      const res = await taxonomyAdminApi.create({ type, labelEn: labelEn.trim(), labelAr: labelAr.trim(), ...(type === 'boat_category' ? { hullForm } : {}) })
      if (res.data.status === 'exists' && res.data.match) {
        toast(translatePortalText(`Already in the list as "${res.data.match.labelEn}"`), 'warn')
        return
      }
      const addedKey = res.data.item?.key
      if (logo && hasLogo(type) && addedKey) {
        try {
          await taxonomyAdminApi.uploadLogo(type, addedKey, logo)
        } catch (e) {
          toast(translatePortalText(`Added, but the logo did not upload: ${e instanceof Error ? e.message : 'error'} — add it from the card`), 'warn')
        }
      }
      toast(translatePortalText(`"${labelEn.trim()}" added to the list`))
      onDone()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not add'), 'warn')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={open} onClose={onClose} title={translatePortalText(type === 'boat_category' ? 'Add a vessel type' : type === 'trip_type' ? 'Add a trip type' : 'Add an entry to a list')}>
      <div className="space-y-3">
        <label className="block text-xs font-bold text-slate-500">{translatePortalText('List')}
          <select className="input mt-1" value={type} onChange={(e) => setType(e.target.value as TaxonomyListType)}>
            {(Object.keys(TYPE_LABEL) as TaxonomyListType[]).map((t) => <option key={t} value={t}>{translatePortalText(TYPE_LABEL[t])}</option>)}
          </select>
        </label>
        <label className="block text-xs font-bold text-slate-500">{translatePortalText('English name')}
          <input className="input mt-1" value={labelEn} onChange={(e) => setLabelEn(e.target.value)} maxLength={60} />
        </label>
        <label className="block text-xs font-bold text-slate-500">{translatePortalText('Arabic name')}
          <input className="input mt-1" dir="rtl" value={labelAr} onChange={(e) => setLabelAr(e.target.value)} maxLength={60} />
        </label>
        {type === 'boat_category' && (
          <label className="block text-xs font-bold text-slate-500">{translatePortalText('Hull form (how marinas berth it)')}
            <select className="input mt-1" value={hullForm} onChange={(e) => setHullForm(e.target.value as HullFormKey)}>
              {HULL_FORMS.map((h) => <option key={h.key} value={h.key}>{translatePortalText(h.label)}</option>)}
            </select>
          </label>
        )}
        {hasLogo(type) && <LogoField value={logo} onChange={setLogo} name={labelEn} />}
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={onClose}>{translatePortalText('Cancel')}</button>
          <button className="btn-admin" disabled={!valid || busy} onClick={() => void submit()}>{busy ? <Spinner size={14} /> : <Plus size={14} />} {translatePortalText('Add')}</button>
        </div>
      </div>
    </Modal>
  )
}
