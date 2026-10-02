import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { useFormErrors, FieldError, FormErrorSummary, submitFailureMessage } from '../shared/formErrors'
import { TableToolbar, useTableFilters, NoFilterMatches, TablePagination, type TableFiltersConfig } from '../shared/TableFilters'
import { motion } from 'framer-motion'
import {
  UserRound, FileCheck2, Siren, Settings as SettingsIcon, Plug, MapPin, Clock, Phone, Mail, Upload,
  Trash2, PhoneCall, ShieldAlert, RefreshCw, Plus, Radio, Percent, Save, Image as ImageIcon, ExternalLink,
  CreditCard, Calendar, Building2,
} from 'lucide-react'
import {
  PageHeader, Badge, Section, Toggle, toast, Modal, AsyncBlock, Avatar, EmptyState, StatCard, pickFiles, copyText, Spinner, LoadingState,
} from '../ui'
import MarinaLocationPicker, { type PickedPoint } from '../components/MarinaLocationPicker'
import { useAsync, useMarina, fmtDate, fmtDateTime, fmtRelative, humanize, daysUntil, todayIso } from '../live'
import { useOps } from '../opsStore'
import { confirmAndRun } from '../async'
import { Link, useLocation } from 'react-router-dom'
import {
  API_URL, getToken, marinaApi, portalApi, marinaDocsApi, incidentsApi, earningsApi, fileUrl, profileApi,
  type ApiIncident, type ApiMarinaDocument, type EmergencyContact, type MarinaSettings,
} from '../api'
import { useAuth } from '../auth'
import BrandLogoManager from '../components/BrandLogoManager'
import VendorLogoBadge from '../components/VendorLogoBadge'
import { BankDetailsFields } from '../components/BankDetailsFields'
import {
  EMPTY_BANK_DETAILS,
  bankPayload,
  validateBankDetails,
  type BankDetailsErrors,
  type BankDetailsValue,
} from '../utils/iban'
import { BASE_CURRENCY, SUPPORTED_CURRENCIES, useCurrency } from '../currency'
import { CurrencyIcon } from '../CurrencyToggle'
import { canonicalField, formatPortalNumber, isPortalArabic, localizedEnum, localizedField, translatePortalText } from '../i18n/runtime'


// Same gallery sections offered in the registration wizard, so photos taken
// there and photos added later on this page live in one consistent layout.
// "cover" is first and, when it holds more than one photo, renders as an
// auto-rotating carousel — the hero image boaters see cycles between them.
const PHOTO_CATEGORIES = ['cover', 'logo', 'entrance', 'dock', 'pontoon', 'office', 'facilities', 'washrooms', 'parking', 'lounge']
const PHOTO_CATEGORY_LABELS: Record<string, string> = {
  cover: 'Cover', logo: 'Logo', entrance: 'Entrance', dock: 'Dock', pontoon: 'Pontoon', office: 'Office',
  facilities: 'Facilities', washrooms: 'Washrooms', parking: 'Parking', lounge: 'Lounge',
}

// ===========================================================================
// Marina profile — the listing boaters see
// ===========================================================================
export function Profile() {
  const location = useLocation()
  const { marina, loading, error, reload, applyMarina } = useMarina()
  const [form, setForm] = useState({
    name: '', nameAr: '', description: '', descriptionAr: '', contactNumber: '', email: '',
    city: '', depthM: '', maxLoaFt: '',
  })
  const [point, setPoint] = useState<PickedPoint>({ latitude: 21.4858, longitude: 39.1925, address: '' })
  const [busy, setBusy] = useState(false)
  /**
   * `rename` exists because the API and this form do not spell everything the
   * same. A rejection naming `contactNumber` has to land on the input labelled
   * Phone, or it lands nowhere and the user is told a field is wrong without
   * being told which.
   */
  const fe = useFormErrors({
    rename: { contactNumber: 'phone', depthM: 'depth', maxLoaFt: 'maxLoa' },
  })
  const [uploadingCategory, setUploadingCategory] = useState<string | null>(null)
  const [viewPhoto, setViewPhoto] = useState<{ url: string; category?: string } | null>(null)
  const [photosOpen, setPhotosOpen] = useState(false)

  const focusTarget = useCallback((id: string) => {
    if (id === 'photos' || id === 'gallery_photos' || id === 'section-photos') {
      setPhotosOpen(true)
      const el = document.getElementById('section-photos') || document.getElementById('photos')
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.add('ring-4', 'ring-cyan-500', 'ring-offset-2', 'rounded-2xl', 'transition-all', 'duration-500')
        setTimeout(() => el.classList.remove('ring-4', 'ring-cyan-500', 'ring-offset-2'), 2500)
      }
      return
    }
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.focus?.()
      el.classList.add('ring-4', 'ring-cyan-500', 'ring-offset-2', 'transition-all', 'duration-500')
      setTimeout(() => el.classList.remove('ring-4', 'ring-cyan-500', 'ring-offset-2'), 2500)
    }
  }, [])

  useEffect(() => {
    const hash = location.hash.replace(/^#/, '')
    if (hash) {
      const timer = setTimeout(() => focusTarget(hash), 250)
      return () => clearTimeout(timer)
    }
  }, [location.hash, focusTarget])

  useEffect(() => {
    const handler = (e: any) => {
      if (e.detail?.id) focusTarget(e.detail.id)
    }
    window.addEventListener('boatpro-focus-field', handler)
    return () => window.removeEventListener('boatpro-focus-field', handler)
  }, [focusTarget])

  useEffect(() => {
    if (!marina) return
    setForm({
      name: canonicalField<string>(marina, 'name') ?? '',
      nameAr: marina.nameAr ?? '',
      description: canonicalField<string>(marina, 'description') ?? '',
      descriptionAr: marina.descriptionAr ?? '',
      contactNumber: marina.contactNumber ?? '',
      email: marina.email ?? '',
      city: canonicalField<string>(marina, 'city') ?? '',
      depthM: marina.depthM != null ? String(marina.depthM) : '',
      maxLoaFt: marina.maxLoaFt != null ? String(marina.maxLoaFt) : '',
    })
    setPoint({ latitude: marina.latitude, longitude: marina.longitude, address: marina.address ?? '' })
  }, [marina])

  const save = async () => {
    if (!marina) return
    const marinaId = marina.id || marina._id
    if (!marinaId) { toast(translatePortalText('Marina ID missing'), 'warn'); return }
    const errs: Record<string, string | undefined> = {}
    if (!form.name.trim()) errs.name = 'Marina name is required'
    if (!point.address.trim()) errs.address = 'Address is required'
    if (form.email.trim() && !/^\S+@\S+\.\S+$/.test(form.email.trim())) errs.email = 'Enter a valid email address'
    /**
     * Checked here as well as on the server so the number is questioned while the
     * cursor is still in the field, rather than after a round trip.
     */
    if (form.depthM !== '' && (Number(form.depthM) < 0 || Number(form.depthM) > 100)) {
      errs.depth = 'Entrance depth must be between 0 and 100 m'
    }
    if (form.maxLoaFt !== '' && Number(form.maxLoaFt) < 0) {
      errs.maxLoa = 'Maximum LOA cannot be negative'
    }
    if (fe.fail(errs)) { toast(translatePortalText('Please fix the highlighted fields'), 'warn'); return }
    fe.clear()
    setBusy(true)
    try {
      const res = await marinaApi.update(marinaId, {
        name: form.name.trim(),
        nameAr: form.nameAr.trim() || undefined,
        description: form.description.trim() || undefined,
        descriptionAr: form.descriptionAr.trim() || undefined,
        contactNumber: form.contactNumber.trim() || undefined,
        email: form.email.trim() || undefined,
        city: form.city.trim() || undefined,
        depthM: form.depthM === '' ? undefined : Number(form.depthM),
        maxLoaFt: form.maxLoaFt === '' ? undefined : Number(form.maxLoaFt),
        address: point.address.trim(),
        latitude: point.latitude,
        longitude: point.longitude,
      })
      applyMarina(res.data.marina)
      toast(translatePortalText('Marina profile saved'), 'success')
    } catch (e) {
      /**
       * The server's field-level rejections get pinned to their inputs; the toast
       * only speaks for what could not be pinned. Before this, a bad entrance
       * depth produced "Number must be less than or equal to 100" adrift at the
       * bottom of the screen with sixteen inputs above it and no way to tell which
       * one it meant.
       */
      const result = fe.capture(e)
      const message = submitFailureMessage(result, e)
      if (message) toast(translatePortalText(message), 'warn')
    } finally { setBusy(false) }
  }

  const addPhotos = async (category: string) => {
    if (!marina) return
    const marinaId = marina.id || marina._id
    if (!marinaId) return
    const files = await pickFiles('image/*', true)
    if (!files.length) return
    setUploadingCategory(category)
    try {
      await marinaApi.uploadImages(marinaId, files, category)
      toast(translatePortalText(`${files.length} photo${files.length === 1 ? '' : 's'} uploaded`), 'success')
      await reload()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Upload failed'), 'warn')
    } finally { setUploadingCategory(null) }
  }

  const removePhoto = async (url: string) => {
    if (!marina) return
    const marinaId = marina.id || marina._id
    if (!marinaId) return
    try {
      await marinaApi.deleteImage(marinaId, url)
      toast(translatePortalText('Photo removed'), 'warn')
      await reload()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not remove that photo'), 'warn')
    }
  }

  const toggleActive = async () => {
    if (!marina) return
    const marinaId = marina.id || marina._id
    if (!marinaId) return
    try {
      const res = await marinaApi.update(marinaId, { isActive: !marina.isActive })
      applyMarina(res.data.marina)
      toast(translatePortalText(res.data.marina.isActive ? 'Marina is open for reservations' : 'Marina closed — no new berth requests'), res.data.marina.isActive ? 'success' : 'warn')
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not change that'), 'warn')
    }
  }

  const logoUrl = marina?.logo || marina?.imagesCategorized?.find((img: any) => img.category === 'logo')?.url

  const handleUploadLogo = async (file: File) => {
    if (!marina) return
    const marinaId = marina.id || marina._id
    if (!marinaId) return
    await marinaApi.uploadImages(marinaId, [file], 'logo')
    await reload()
  }

  const handleRemoveLogo = async () => {
    if (!marina || !logoUrl) return
    const marinaId = marina.id || marina._id
    if (!marinaId) return
    await marinaApi.deleteImage(marinaId, logoUrl)
    await reload()
  }

  if (loading && !marina) return <LoadingState label="Loading your marina…" rows={5} />
  if (error && !marina) return <div className="card"><EmptyState icon="⚠️" text={error} /></div>
  if (!marina) return null

  const F = (label: string, node: React.ReactNode) => <div><label className="label">{translatePortalText(label)}</label>{node}</div>

  return (
    <div>
      <PageHeader title={translatePortalText("Marina Profile")} icon={<UserRound className="text-ocean-500" />}
        sub="Your public listing — what boaters see when they search for a berth."
        actions={<>
          <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-1.5 ring-1 ring-slate-200 text-xs">
            <span className="font-bold text-slate-500">{translatePortalText("Status:")}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-black uppercase tracking-wider ${
                marina.approvalStatus === 'approved'
                  ? 'bg-emerald-100 text-emerald-800'
                  : marina.approvalStatus === 'pending'
                  ? 'bg-amber-100 text-amber-800'
                  : marina.approvalStatus === 'rejected'
                  ? 'bg-rose-100 text-rose-800'
                  : 'bg-slate-100 text-slate-700'
              }`}
            >
              {translatePortalText(marina.approvalStatus === 'approved' ? (marina.isPublished ? 'Verified & Live' : 'Approved (Unpublished)') : marina.approvalStatus === 'pending' ? 'In Admin Review' : marina.approvalStatus === 'rejected' ? 'Changes Needed' : 'Draft Incomplete')}
            </span>
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
            <Toggle on={marina.isActive} onChange={toggleActive} />
            <span className="text-xs font-bold text-slate-600">{translatePortalText(marina.isActive ? 'Open' : 'Closed')}</span>
          </div>
          <button className="btn-primary" disabled={busy} onClick={save}><Save size={15} /> {translatePortalText(busy ? 'Saving…' : 'Save profile')}</button>
        </>} />

      <FormErrorSummary
        errors={fe}
        labels={{
          name: 'Marina name',
          email: 'Email',
          phone: 'Phone',
          city: 'City',
          depth: 'Depth at entrance',
          maxLoa: 'Max LOA accepted',
          address: 'Address',
        }}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title={translatePortalText("Identity")} sub="Name and description, in English and Arabic">
          <div className="grid gap-4">
            <div>
              {F('Marina name *', <input id="name" {...fe.fieldWith('name', 'input')} value={form.name} onChange={e => { setForm(f => ({ ...f, name: e.target.value })); fe.clear('name') }} />)}
              <FieldError errors={fe} name="name" />
            </div>
            {F('Name (Arabic)', <input id="name_ar" className="input" dir="rtl" value={form.nameAr} onChange={e => setForm(f => ({ ...f, nameAr: e.target.value }))} />)}
            {F('Description', <textarea id="description" className="input min-h-[110px]" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />)}
            {F('Description (Arabic)', <textarea id="description_ar" className="input min-h-[90px]" dir="rtl" value={form.descriptionAr} onChange={e => setForm(f => ({ ...f, descriptionAr: e.target.value }))} />)}
          </div>
        </Section>

        <div className="space-y-5">
          <Section title={translatePortalText("Contact & harbour specs")} sub="How boaters reach you, and what fits">
            <div className="grid grid-cols-2 gap-4">
              <div>
                {F('Phone', <input id="phone" {...fe.fieldWith('phone', 'input')} value={form.contactNumber} onChange={e => { setForm(f => ({ ...f, contactNumber: e.target.value })); fe.clear('phone') }} />)}
                <FieldError errors={fe} name="phone" />
              </div>
              <div>
                {F('Email', <input id="email" {...fe.fieldWith('email', 'input')} type="email" value={form.email} onChange={e => { setForm(f => ({ ...f, email: e.target.value })); fe.clear('email') }} />)}
                <FieldError errors={fe} name="email" />
              </div>
              <div>
                {F('City', <input id="city" {...fe.fieldWith('city', 'input')} value={form.city} onChange={e => { setForm(f => ({ ...f, city: e.target.value })); fe.clear('city') }} />)}
                <FieldError errors={fe} name="city" />
              </div>
              <div>
                {F('Depth at entrance (m)', <input id="depth" {...fe.fieldWith('depth', 'input')} type="number" step="0.1" min={0} max={100} value={form.depthM} onChange={e => { setForm(f => ({ ...f, depthM: e.target.value })); fe.clear('depth') }} />)}
                <FieldError errors={fe} name="depth" />
              </div>
              <div>
                {F('Max LOA accepted (ft)', <input id="max_loa" {...fe.fieldWith('maxLoa', 'input')} type="number" min={0} value={form.maxLoaFt} onChange={e => { setForm(f => ({ ...f, maxLoaFt: e.target.value })); fe.clear('maxLoa') }} />)}
                <FieldError errors={fe} name="maxLoa" />
              </div>
              <div className="flex items-end">
                <p className="text-[11px] text-slate-400">{translatePortalText("VHF channel and tariffs live in Settings.")}</p>
              </div>
            </div>
          </Section>

          <div id="section-photos" className="transition-all duration-500 rounded-2xl">
            <Section title={translatePortalText("Photos & Brand Logo")} sub={`${marina.imagesCategorized?.length ?? marina.images.length} photo${(marina.imagesCategorized?.length ?? marina.images.length) === 1 ? '' : 's'} · Official Logo & Gallery`}
              actions={<button id="photos" className="btn-primary !py-1.5 !px-3 text-xs" onClick={() => setPhotosOpen(true)}>{translatePortalText("Manage Photos & Logo")}</button>}>
              <div className="flex items-center gap-4">
                {logoUrl ? (
                  <div className="relative h-14 w-14 shrink-0 rounded-xl border border-slate-200 p-1.5 bg-slate-50 flex items-center justify-center shadow-2xs" title={translatePortalText("Official Logo")}>
                    <img src={fileUrl(logoUrl)} alt={translatePortalText("Logo")} className="max-h-full max-w-full object-contain" />
                    <span className="absolute -bottom-1 -end-1 rounded-md bg-ocean-500 text-[8px] font-black text-white px-1">{translatePortalText("LOGO")}</span>
                  </div>
                ) : (
                  <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-sand border border-dashed border-slate-300 text-[10px] font-bold text-slate-400">
                    {translatePortalText("No Logo\r\n                  ")}</div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-deep-900">{translatePortalText(logoUrl ? 'Brand Logo Active ✨' : 'No Logo Uploaded Yet')}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">{translatePortalText("Upload a transparent logo (.png/.webp) and harbour gallery photos.")}</p>
                </div>
              </div>
            </Section>
          </div>
        </div>
      </div>

      <Modal open={photosOpen} onClose={() => setPhotosOpen(false)} title={translatePortalText("📷 Manage Photos & Brand Logo")} wide>
        <div className="space-y-6 max-h-[75vh] overflow-y-auto pe-1">
          <BrandLogoManager
            logoUrl={logoUrl}
              providerName={localizedField<string>(marina, 'name') ?? translatePortalText('Marina')}
            categoryLabel={translatePortalText('Marina')}
            onUpload={handleUploadLogo}
            onRemove={handleRemoveLogo}
          />

          <div className="border-t border-slate-100 pt-4">
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-400 mb-4">
              {translatePortalText("Harbour Gallery Sections\r\n            ")}</h4>
            <div className="space-y-5">
              {PHOTO_CATEGORIES.filter(c => c !== 'logo').map((cat) => {
                const imgs = (marina.imagesCategorized || []).filter((i) => (i.category || 'other') === cat)
                const label = translatePortalText(PHOTO_CATEGORY_LABELS[cat] || cat)
                return (
                  <div key={cat}>
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                        {label}{cat === 'cover' ? translatePortalText(' (rotating)') : ''} <span className="font-normal normal-case text-slate-300">· {formatPortalNumber(imgs.length)}</span>
                      </p>
                      <button className="btn-ghost !py-1 !px-2 text-[11px]" disabled={uploadingCategory === cat} onClick={() => addPhotos(cat)}>
                        {uploadingCategory === cat ? <Spinner size={11} /> : <Upload size={11} />} {translatePortalText("Add\r\n                      ")}</button>
                    </div>
                    {imgs.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 py-6 text-center text-[11px] text-slate-400">
                        {translatePortalText(`No ${PHOTO_CATEGORY_LABELS[cat] || cat} photos yet`)}</div>
                    ) : (
                      <div className="grid grid-cols-3 gap-2">
                        {imgs.map((img) => (
                          <button key={img.url} type="button" onClick={() => setViewPhoto(img)}
                            className="group relative overflow-hidden rounded-xl text-left">
                            <img src={fileUrl(img.url)} alt="" className="h-24 w-full object-cover" />
                            <span onClick={(e) => { e.stopPropagation(); removePhoto(img.url) }}
                              className="absolute end-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-lg bg-white/90 text-rose-500 opacity-0 transition group-hover:opacity-100">
                              <Trash2 size={13} />
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </Modal>

      <Modal open={!!viewPhoto} onClose={() => setViewPhoto(null)}
        title={translatePortalText(viewPhoto ? PHOTO_CATEGORY_LABELS[viewPhoto.category || 'other'] || 'Photo' : 'Photo')} wide>
        {viewPhoto && (
          <div className="space-y-3">
            <img src={fileUrl(viewPhoto.url)} alt="" className="max-h-[65vh] w-full rounded-xl bg-slate-50 object-contain" />
            <div className="flex justify-end">
              <button className="btn-ghost text-xs text-rose-500" onClick={() => { removePhoto(viewPhoto.url); setViewPhoto(null) }}>
                <Trash2 size={13} /> {translatePortalText("Remove photo\r\n              ")}</button>
            </div>
          </div>
        )}
      </Modal>

      <div id="location" className="mt-5 grid gap-5 lg:grid-cols-3 transition-all duration-500 rounded-2xl">
        <Section title={translatePortalText("Location")} sub="Exactly where boaters arrive — used by the app's map and distance search" className="lg:col-span-2">
          <div id="address">
            <MarinaLocationPicker value={point} onChange={setPoint} />
          </div>
        </Section>

        <div className="space-y-5">
          <Section title={translatePortalText("Operating hours")} actions={<Clock size={16} className="text-slate-300" />}>
            <div className="space-y-2 text-sm">
              <p className="flex justify-between rounded-xl bg-sand px-3 py-2.5">
                <span className="text-slate-500">{translatePortalText("Check-in from")}</span>
                <b className="text-deep-900">{marina.settings?.checkInTime ?? '14:00'}</b>
              </p>
              <p className="flex justify-between rounded-xl bg-sand px-3 py-2.5">
                <span className="text-slate-500">{translatePortalText("Check-out by")}</span>
                <b className="text-deep-900">{marina.settings?.checkOutTime ?? '11:00'}</b>
              </p>
              <p className="flex justify-between rounded-xl bg-sand px-3 py-2.5">
                <span className="text-slate-500">{translatePortalText("Harbour office VHF")}</span>
                <b className="text-deep-900">{marina.settings?.vhfChannel ? `Ch ${marina.settings.vhfChannel}` : translatePortalText('not set')}</b>
              </p>
              <p className="flex justify-between rounded-xl bg-sand px-3 py-2.5">
                <span className="text-slate-500">{translatePortalText("96% refund until")}</span>
                <b className="text-deep-900">{marina.settings?.cancellationWindowHours ?? 48} {translatePortalText("h before")}</b>
              </p>
            </div>
            <Link to="/settings" className="btn-ghost mt-3 w-full justify-center text-xs">{translatePortalText("Change in Settings")}</Link>
          </Section>

          <Section title={translatePortalText("Emergency contacts")} actions={<Phone size={16} className="text-slate-300" />}>
            {marina.emergencyContacts.length === 0 ? (
              <EmptyState icon="📞" text="No contacts yet" />
            ) : (
              <div className="space-y-1.5">
                {marina.emergencyContacts.map((c, i) => (
                  <a key={i} href={`tel:${c.phone}`} className="flex items-center gap-2 rounded-xl border border-slate-100 px-3 py-2 text-xs transition hover:bg-sand">
                    <span className="font-bold text-deep-900">{c.name}</span>
                    <span className="ms-auto text-slate-400">{c.phone}</span>
                  </a>
                ))}
              </div>
            )}
            <Link to="/emergency" className="btn-ghost mt-3 w-full justify-center text-xs">{translatePortalText("Manage call list")}</Link>
          </Section>
        </div>
      </div>

      <Section title={translatePortalText("Facilities on your listing")} sub="Synced from Facilities management" className="mt-5"
        actions={<Link to="/facilities" className="btn-ghost !py-1.5 !px-3 text-xs">{translatePortalText("Manage facilities")}</Link>}>
        {marina.facilities.filter(f => f.available).length === 0 ? (
          <EmptyState icon="🏗️" text="Nothing listed yet — tick what your marina offers on the Facilities page." />
        ) : (
          <div className="flex flex-wrap gap-2">
            {marina.facilities.filter(f => f.available).map(f => (
              <span key={f.key} title={f.detail} className="chip bg-ocean-50 text-ocean-700 ring-1 ring-ocean-200">
                {translatePortalText(humanize(f.key))}{f.detail ? ` · ${f.detail}` : ''}
              </span>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}

// ===========================================================================
// Documents & compliance
// ===========================================================================
const DOC_TYPES = ['license', 'insurance', 'safety', 'environmental', 'inspection', 'tariff', 'other'] as const
const DOC_STATUS_LABEL: Record<string, string> = {
  valid: 'Valid', expiring_soon: 'Expiring soon', expired: 'Expired', no_expiry: 'No expiry',
}

export function Documents() {
  const { reloadOverview } = useOps()
  const [type, setType] = useState('all')
  const [adding, setAdding] = useState(false)

  const state = useAsync(() => marinaDocsApi.list({ type: type === 'all' ? undefined : type, limit: 100 }).then(r => r.data), [type])
  const allDocs = state.data?.items ?? []
  const counts = state.data?.statusCounts ?? {}

  /**
   * Expiry is the filter that matters here: a compliance table is read to find
   * what lapses next, not to admire what is already valid.
   */
  const docCfg: TableFiltersConfig<ApiMarinaDocument> = useMemo(() => ({
    searchFields: (d) => [d.name, d.type, d.reference],
    filters: [
      { key: 'type', label: 'Type', get: (d) => d.type },
      { key: 'status', label: 'Status', get: (d) => d.status },
      {
        key: 'expiry',
        label: 'Expiry',
        options: [
          { value: 'expired', label: 'Already expired' },
          { value: 'soon', label: 'Within 30 days' },
          { value: 'ok', label: 'More than 30 days' },
          { value: 'none', label: 'No expiry date' },
        ],
        get: (d) => d.expiresAt ?? '',
        match: (d, v) => {
          if (!d.expiresAt) return v === 'none'
          const days = Math.ceil((new Date(d.expiresAt).getTime() - Date.now()) / 86400000)
          if (v === 'expired') return days < 0
          if (v === 'soon') return days >= 0 && days <= 30
          if (v === 'ok') return days > 30
          return false
        },
      },
    ],
  }), [])
  const docTf = useTableFilters(allDocs, docCfg)
  const rows = docTf.pagedRows

  const remove = (d: ApiMarinaDocument) =>
    confirmAndRun({
      title: `Delete "${d.name}"?`,
      body: 'The file and its expiry tracking are removed. This cannot be undone.',
      confirmLabel: 'Delete',
      busyLabel: 'Deleting...',
      danger: true,
      run: async () => {
        await marinaDocsApi.remove(d.id)
        await state.reload()
        await reloadOverview()
      },
      success: `"${d.name}" deleted successfully`,
      error: 'Could not delete the document. Please try again.',
    })

  return (
    <div>
      <PageHeader title={translatePortalText("Documents & Compliance")} icon={<FileCheck2 className="text-ocean-500" />}
        sub="Your operating licence, insurance and inspection certificates, with expiry tracking."
        actions={<>
          <button className="btn-ghost" onClick={() => state.reload()}><RefreshCw size={14} /> {translatePortalText("Refresh")}</button>
          <button className="btn-primary" onClick={() => setAdding(true)}><Plus size={15} /> {translatePortalText("Add document")}</button>
        </>} />

      <div className="mb-5 grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard i={0} label="Valid" value={counts.valid ?? 0} icon={<FileCheck2 size={17} />} tone="green" />
        <StatCard i={1} label="Expiring soon" value={counts.expiring_soon ?? 0} icon={<Clock size={17} />} tone="amber" />
        <StatCard i={2} label="Expired" value={counts.expired ?? 0} icon={<ShieldAlert size={17} />} tone="rose" />
        <StatCard i={3} label="On file" value={rows.length} icon={<FileCheck2 size={17} />} tone="navy" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button onClick={() => setType('all')} className={`chip transition ${type === 'all' ? 'bg-deep-900 text-white' : 'bg-white ring-1 ring-slate-200 text-slate-500 hover:ring-ocean-300'}`}>{translatePortalText("All types")}</button>
        {DOC_TYPES.map(t => (
          <button key={t} onClick={() => setType(t)} className={`chip transition ${type === t ? 'bg-deep-900 text-white' : 'bg-white ring-1 ring-slate-200 text-slate-500 hover:ring-ocean-300'}`}>
            {translatePortalText(humanize(t))}
          </button>
        ))}
      </div>

      <TableToolbar
        state={docTf}
        config={docCfg}
        rows={allDocs}
        noun="documents"
        searchPlaceholder="Search documents by name, type or reference..."
      />

      <AsyncBlock state={state} loadingLabel="Loading documents…"
        empty={d => d.items.length === 0 ? { icon: '📄', text: 'No documents on file — add your licence and insurance to stay compliant.' } : null}>
        {() => allDocs.length > 0 && rows.length === 0 ? (
          <NoFilterMatches noun="documents" onClear={docTf.clear} />
        ) : (
          <div className="card overflow-hidden !p-0">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full min-w-[920px]">
                <thead><tr className="border-b border-slate-100 bg-sand/50">
                  <th className="th">{translatePortalText("Document")}</th><th className="th">{translatePortalText("Type")}</th><th className="th">{translatePortalText("Issued")}</th>
                  <th className="th">{translatePortalText("Expires")}</th><th className="th">{translatePortalText("Status")}</th><th className="th text-right">{translatePortalText("Actions")}</th>
                </tr></thead>
                <tbody>
                  {rows.map((d, i) => {
                    const left = daysUntil(d.expiresAt)
                    return (
                      <motion.tr key={d.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i * 0.03, 0.4) }}
                        className="border-b border-slate-50 transition hover:bg-sand/60">
                        <td className="td">
                          <p className="font-bold text-deep-900">{d.name}</p>
                          <p className="text-[11px] text-slate-400">
                            {d.reference ? `${translatePortalText('Ref')} ${d.reference} · ` : ''}
                            {d.fileSize ? `${formatPortalNumber(Math.round(d.fileSize / 1024))} KB` : translatePortalText('no file attached')}
                          </p>
                        </td>
                        <td className="td text-xs text-slate-500">{translatePortalText(humanize(d.type))}</td>
                        <td className="td whitespace-nowrap text-xs text-slate-500">{d.issuedAt ? fmtDate(d.issuedAt) : '—'}</td>
                        <td className="td whitespace-nowrap text-xs text-slate-500">
                          {d.expiresAt ? fmtDate(d.expiresAt) : '—'}
                          {left !== null && <p className={`text-[10px] font-semibold ${left < 0 ? 'text-rose-500' : left < 60 ? 'text-amber-600' : 'text-slate-400'}`}>
                            {translatePortalText(left < 0 ? `${Math.abs(left)} days overdue` : `${left} days left`)}
                          </p>}
                        </td>
                        <td className="td"><Badge>{translatePortalText(DOC_STATUS_LABEL[d.status] ?? d.status)}</Badge></td>
                        <td className="td">
                          <div className="flex justify-end gap-1.5">
                            {d.fileUrl && (
                              <a className="btn-ghost !p-2" title={translatePortalText("Open")} href={fileUrl(d.fileUrl)} target="_blank" rel="noreferrer"><ExternalLink size={14} /></a>
                            )}
                            <button className="btn-ghost !p-2 hover:!bg-rose-50 hover:!border-rose-200 hover:text-rose-500" onClick={() => remove(d)}><Trash2 size={14} /></button>
                          </div>
                        </td>
                      </motion.tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <TablePagination state={docTf} noun="documents" />
          </div>
        )}
      </AsyncBlock>

      <AddDocumentModal open={adding} onClose={() => setAdding(false)} onDone={async () => { await state.reload(); await reloadOverview() }} />
    </div>
  )
}

function AddDocumentModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [f, setF] = useState({ name: '', type: 'license', issuedAt: '', expiresAt: '', reference: '', notes: '' })
  const [file, setFile] = useState<File | null>(null)

  const submit = async () => {
    if (!f.name.trim()) { toast(translatePortalText('Give the document a name'), 'warn'); return }
    setBusy(true)
    try {
      await marinaDocsApi.create({
        name: f.name.trim(), type: f.type,
        issuedAt: f.issuedAt || undefined, expiresAt: f.expiresAt || undefined,
        reference: f.reference.trim() || undefined, notes: f.notes.trim() || undefined,
        file,
      })
      toast(translatePortalText(`${f.name} added`))
      onClose()
      setF({ name: '', type: 'license', issuedAt: '', expiresAt: '', reference: '', notes: '' })
      setFile(null)
      await onDone()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not add the document'), 'warn')
    } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title={translatePortalText("📄 Add a document")}>
      <div className="space-y-4">
        <div><label className="label">{translatePortalText("Name")}</label><input className="input" value={f.name} onChange={e => setF(s => ({ ...s, name: e.target.value }))} placeholder={translatePortalText("Marina operating licence")} /></div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="label">{translatePortalText("Type")}</label>
            <select className="input" value={f.type} onChange={e => setF(s => ({ ...s, type: e.target.value }))}>
              {DOC_TYPES.map(t => <option key={t} value={t}>{translatePortalText(humanize(t))}</option>)}
            </select>
          </div>
          <div><label className="label">{translatePortalText("Reference")}</label><input className="input" value={f.reference} onChange={e => setF(s => ({ ...s, reference: e.target.value }))} /></div>
          <div><label className="label">{translatePortalText("Issued")}</label><input type="date" className="input" value={f.issuedAt} onChange={e => setF(s => ({ ...s, issuedAt: e.target.value }))} /></div>
          <div><label className="label">{translatePortalText("Expires")}</label><input type="date" className="input" value={f.expiresAt} onChange={e => setF(s => ({ ...s, expiresAt: e.target.value }))} /></div>
        </div>
        <div><label className="label">{translatePortalText("Notes")}</label><textarea className="input min-h-[70px]" value={f.notes} onChange={e => setF(s => ({ ...s, notes: e.target.value }))} /></div>
        <div>
          <label className="label">{translatePortalText("Scan or PDF (optional)")}</label>
          <button type="button" className="btn-ghost w-full justify-center" onClick={async () => {
            const picked = await pickFiles('image/*,application/pdf', false)
            if (picked.length) setFile(picked[0])
          }}>
            <Upload size={14} /> {file ? file.name : translatePortalText('Choose a file')}
          </button>
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>{translatePortalText("Cancel")}</button>
        <button className="btn-primary" disabled={busy} onClick={submit}>{translatePortalText(busy ? 'Saving…' : 'Add document')}</button>
      </div>
    </Modal>
  )
}

// ===========================================================================
// Operating settings
// ===========================================================================
const WORKING_DAYS_OPTIONS = [
  { key: 0, label: 'Sun', full: 'Sunday' },
  { key: 1, label: 'Mon', full: 'Monday' },
  { key: 2, label: 'Tue', full: 'Tuesday' },
  { key: 3, label: 'Wed', full: 'Wednesday' },
  { key: 4, label: 'Thu', full: 'Thursday' },
  { key: 5, label: 'Fri', full: 'Friday' },
  { key: 6, label: 'Sat', full: 'Saturday' },
]

export function Settings() {
  const location = useLocation()
  const { currency: displayCurrency, setCurrency: setDisplayCurrency } = useCurrency()
  const { user, logout, refreshMe } = useAuth()
  const [avatarBusy, setAvatarBusy] = useState(false)
  const { marina, reload: reloadMarina, applyMarina } = useMarina()
  const state = useAsync(() => portalApi.settings().then(r => r.data), [])
  const [draft, setDraft] = useState<Partial<MarinaSettings>>({})
  const [hours, setHours] = useState<{
    open24h: boolean;
    workingDays: number[];
    openTime: string;
    closeTime: string;
  }>({
    open24h: false,
    workingDays: [0, 1, 2, 3, 4, 5, 6],
    openTime: '08:00',
    closeTime: '20:00',
  })
  const [bank, setBank] = useState<BankDetailsValue>(EMPTY_BANK_DETAILS)
  const [bankErrors, setBankErrors] = useState<BankDetailsErrors>({})
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)

  const focusTarget = useCallback((id: string) => {
    if (id === 'hours' || id === 'operating_hours' || id === 'section-hours') {
      const el = document.getElementById('section-hours') || document.getElementById('hours')
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.add('ring-4', 'ring-cyan-500', 'ring-offset-2', 'rounded-2xl', 'transition-all', 'duration-500')
        setTimeout(() => el.classList.remove('ring-4', 'ring-cyan-500', 'ring-offset-2'), 2500)
      }
      return
    }
    if (id === 'bank' || id === 'bank_details' || id === 'section-bank') {
      const el = document.getElementById('section-bank') || document.getElementById('bank')
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.add('ring-4', 'ring-cyan-500', 'ring-offset-2', 'rounded-2xl', 'transition-all', 'duration-500')
        setTimeout(() => el.classList.remove('ring-4', 'ring-cyan-500', 'ring-offset-2'), 2500)
      }
      return
    }
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.focus?.()
      el.classList.add('ring-4', 'ring-cyan-500', 'ring-offset-2', 'transition-all', 'duration-500')
      setTimeout(() => el.classList.remove('ring-4', 'ring-cyan-500', 'ring-offset-2'), 2500)
    }
  }, [])

  useEffect(() => {
    const hash = location.hash.replace(/^#/, '')
    if (hash) {
      const timer = setTimeout(() => focusTarget(hash), 250)
      return () => clearTimeout(timer)
    }
  }, [location.hash, focusTarget])

  useEffect(() => {
    const handler = (e: any) => {
      if (e.detail?.id) focusTarget(e.detail.id)
    }
    window.addEventListener('boatpro-focus-field', handler)
    return () => window.removeEventListener('boatpro-focus-field', handler)
  }, [focusTarget])

  useEffect(() => {
    if (state.data) {
      setDraft(state.data.settings)
    }
  }, [state.data])

  useEffect(() => {
    if (marina) {
      if (marina.operatingHours) {
        setHours({
          open24h: !!marina.operatingHours.open24h,
          workingDays: Array.isArray(marina.operatingHours.workingDays) && marina.operatingHours.workingDays.length > 0 ? marina.operatingHours.workingDays : [0, 1, 2, 3, 4, 5, 6],
          openTime: marina.operatingHours.openTime || '08:00',
          closeTime: marina.operatingHours.closeTime || '20:00',
        })
      }
      if (marina.bank) {
        setBank({
          bankName: marina.bank.bankName || '',
          accountHolderName: marina.bank.accountHolderName || '',
          iban: marina.bank.iban || '',
          accountNumber: marina.bank.accountNumber || '',
          swiftCode: marina.bank.swiftCode || '',
        })
      }
    }
  }, [marina])

  const set = <K extends keyof MarinaSettings>(key: K, value: MarinaSettings[K]) => {
    setDraft(d => ({ ...d, [key]: value }))
    setDirty(true)
  }

  const setHoursField = (updater: (prev: typeof hours) => typeof hours) => {
    setHours(updater)
    setDirty(true)
  }

  const setBankField = (updater: (prev: typeof bank) => typeof bank) => {
    setBank(updater)
    setDirty(true)
  }

  const toggleDay = (dayKey: number) => {
    setHoursField(prev => {
      const exists = prev.workingDays.includes(dayKey)
      const nextDays = exists ? prev.workingDays.filter(d => d !== dayKey) : [...prev.workingDays, dayKey].sort((a, b) => a - b)
      return { ...prev, workingDays: nextDays }
    })
  }

  const save = async () => {
    /**
     * Checked before anything is sent: this saves the portal settings and the
     * marina in two calls, so an IBAN the API rejects would leave the first
     * applied and the second not.
     */
    const bankIssues = validateBankDetails(bank)
    setBankErrors(bankIssues)
    if (Object.keys(bankIssues).length) {
      toast(translatePortalText('Check the bank settlement details before saving'), 'warn')
      return
    }

    setBusy(true)
    try {
      await portalApi.updateSettings(draft)
      const marinaId = marina?.id || marina?._id
      if (marinaId) {
        const res = await marinaApi.update(marinaId, {
          operatingHours: {
            open24h: hours.open24h,
            workingDays: hours.workingDays,
            openTime: hours.open24h ? undefined : hours.openTime,
            closeTime: hours.open24h ? undefined : hours.closeTime,
          },
          bank: bankPayload(bank),
        })
        if (res.data?.marina) {
          applyMarina(res.data.marina)
        }
      }
      toast(translatePortalText('Operating schedule and settings saved successfully! ✨'), 'success')
      setDirty(false)
      await state.reload()
      await reloadMarina()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not save your settings'), 'warn')
    } finally { setBusy(false) }
  }

  const F = (label: string, node: React.ReactNode, hint?: string) => (
    <div><label className="label">{translatePortalText(label)}</label>{node}{hint && <p className="mt-1 text-[11px] text-slate-400">{translatePortalText(hint)}</p>}</div>
  )

  return (
    <div>
      <PageHeader title={translatePortalText("Settings")} icon={<SettingsIcon className="text-ocean-500" />}
        sub="How your marina operates: operating hours, clearance, tariffs, VAT, check-in and bank settlement."
        actions={<button className="btn-primary" disabled={!dirty || busy} onClick={save}><Save size={15} /> {translatePortalText(busy ? 'Saving…' : dirty ? 'Save changes' : 'Saved')}</button>} />

      <AsyncBlock state={state} loadingLabel="Loading settings…">
        {() => (
          <div className="grid gap-5 lg:grid-cols-2">
            {/* 1. Operating Hours & Schedule */}
            <div id="section-hours" className="transition-all duration-500 rounded-2xl">
              <Section
                title={translatePortalText("Operating Hours & Harbour Access")}
                sub="When the harbour office and docks are manned for boater arrivals and clearance."
              >
                <div id="hours" className="space-y-4">
                  <div className="flex items-start justify-between gap-3 rounded-xl bg-sand p-3.5 border border-slate-100">
                    <div className="flex items-start gap-3">
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ocean-50 text-ocean-600 font-bold">
                        <Clock size={18} />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-deep-900">{translatePortalText("24/7 Harbour Operations")}</p>
                        <p className="text-[11px] text-slate-500 leading-relaxed mt-0.5">
                          {translatePortalText("Turn on if dockmasters and security permit round-the-clock arrival, departure, and berthing.\r\n                        ")}</p>
                      </div>
                    </div>
                    <Toggle on={hours.open24h} onChange={v => setHoursField(prev => ({ ...prev, open24h: v }))} />
                  </div>

                  {hours.open24h ? (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3.5 flex items-center gap-3 text-xs text-emerald-800 font-medium">
                      <span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-500 text-white shrink-0 text-xs">✓</span>
                      <span>{translatePortalText("Harbour is marked as ")}<strong>{translatePortalText("Open 24 Hours / 7 Days")}</strong>{translatePortalText(". Visiting yachts can clear customs and dock at any time.")}</span>
                    </div>
                  ) : (
                    <div className="space-y-4 pt-1">
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="label !mb-0">{translatePortalText(`Working Days (${hours.workingDays.length} active)`)}</label>
                          <div className="flex items-center gap-1.5 text-[11px]">
                            <button type="button" onClick={() => setHoursField(p => ({ ...p, workingDays: [0, 1, 2, 3, 4, 5, 6] }))}
                              className="text-ocean-600 font-semibold hover:underline cursor-pointer">{translatePortalText("All Days")}</button>
                            <span className="text-slate-300">·</span>
                            <button type="button" onClick={() => setHoursField(p => ({ ...p, workingDays: [0, 1, 2, 3, 4] }))}
                              className="text-ocean-600 font-semibold hover:underline cursor-pointer">{translatePortalText("Sun–Thu")}</button>
                            <span className="text-slate-300">·</span>
                            <button type="button" onClick={() => setHoursField(p => ({ ...p, workingDays: [5, 6] }))}
                              className="text-ocean-600 font-semibold hover:underline cursor-pointer">{translatePortalText("Fri–Sat")}</button>
                          </div>
                        </div>
                        <div className="grid grid-cols-7 gap-1.5">
                          {WORKING_DAYS_OPTIONS.map(d => {
                            const active = hours.workingDays.includes(d.key)
                            return (
                              <button
                                key={d.key}
                                type="button"
                                onClick={() => toggleDay(d.key)}
                                className={`py-2 px-1 rounded-xl text-xs font-bold transition flex flex-col items-center justify-center border cursor-pointer ${
                                  active
                                    ? 'bg-ocean-500 text-white border-ocean-600 shadow-2xs'
                                    : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300 hover:text-slate-600'
                                }`}
                              >
                                <span>{translatePortalText(d.label)}</span>
                              </button>
                            )
                          })}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        {F('Opening Time',
                          <input type="time" className="input font-mono" value={hours.openTime} onChange={e => setHoursField(p => ({ ...p, openTime: e.target.value }))} />,
                          'Harbour gates & staff open')}
                        {F('Closing Time',
                          <input type="time" className="input font-mono" value={hours.closeTime} onChange={e => setHoursField(p => ({ ...p, closeTime: e.target.value }))} />,
                          'Standard daily lockup')}
                      </div>
                    </div>
                  )}
                </div>
              </Section>
            </div>

            {/* 2. Berth Requests & Navigation */}
            <Section title={translatePortalText("Berth requests")} sub="How incoming berth requests are handled">
              <div className="space-y-4">
                <div className="flex items-start gap-3 rounded-xl bg-sand px-3.5 py-3">
                  <Toggle on={!!draft.autoApproveReservations} onChange={v => set('autoApproveReservations', v)} />
                  <div>
                    <p className="text-sm font-bold text-deep-900">{translatePortalText("Auto-approve requests")}</p>
                    <p className="text-[11px] text-slate-500">
                      {translatePortalText("On: a request skips your review and goes straight to payment. Off: you approve or decline each one first.\r\n                    ")}</p>
                  </div>
                </div>
                {F('96% refund window (hours)',
                  <input type="number" min={0} className="input" value={draft.cancellationWindowHours ?? 48}
                    onChange={e => set('cancellationWindowHours', Number(e.target.value))} />,
                  'A boater who cancels more than this many hours before check-in is refunded 96% (the other 4% is the non-returnable bank/app transaction fee). Closer than that, the first day\'s fee or 25% of the total rental value is deducted, whichever is higher. BoatPro\'s published standard is 48 hours.')}
                <div id="checkin" className="grid grid-cols-2 gap-4 rounded-xl transition-all duration-500">
                  {F('Check-in from', <input type="time" className="input" value={draft.checkInTime ?? '14:00'} onChange={e => set('checkInTime', e.target.value)} />)}
                  {F('Check-out by', <input type="time" className="input" value={draft.checkOutTime ?? '11:00'} onChange={e => set('checkOutTime', e.target.value)} />)}
                </div>
                {F('VHF hailing channel', <input id="vhf" className="input" value={draft.vhfChannel ?? ''} onChange={e => set('vhfChannel', e.target.value)} placeholder={translatePortalText("e.g. Ch 16, Ch 68, Ch 72")} />, 'Primary marine VHF channel used by arriving yachts')}
              </div>
            </Section>

            {/* 3. Bank Payout Details */}
            <div id="section-bank" className="transition-all duration-500 rounded-2xl">
              <Section
                title={translatePortalText("Bank Payout Details")}
                sub="Account details for automatic direct bank settlement of berth reservation payments."
              >
                <div id="bank">
                  <BankDetailsFields
                    value={bank}
                    onChange={next => setBankField(() => next)}
                    errors={bankErrors}
                    showAccountNumber
                  />
                </div>
              </Section>
            </div>

            {/* 4. Tariffs & Financial Rules */}
            <div id="money" className="transition-all duration-500 rounded-2xl">
              <Section title={translatePortalText("Money & Utility Tariffs")} sub="Currency, tax and meter utility rates">
                <div className="grid grid-cols-2 gap-4">
                  {F('Currency', <input className="input uppercase" maxLength={3} value={draft.currency ?? 'SAR'} onChange={e => set('currency', e.target.value.toUpperCase())} />)}
                  {/* VAT is set by BoatPro's admins, not by each marina: the server ignores a
                      marina's own value (one had typed 84%) and this shows the rate actually
                      charged. Only an admin acting for the marina can assign an override. */}
                  {F('VAT rate (%)', user?.role === 'admin'
                    ? <input type="number" min={0} max={100} step="0.5" className="input" value={draft.vatRate ?? 15} onChange={e => set('vatRate', Number(e.target.value))} />
                    : <input type="number" className="input cursor-not-allowed bg-slate-50 text-slate-500" value={draft.vatRate ?? 15} readOnly aria-readonly="true" title={translatePortalText('Set by BoatPro')} />)}
                  {F(`Electricity (${draft.currency ?? 'SAR'}/kWh)`,
                    <input type="number" step="0.01" className="input" value={draft.electricityRate ?? ''} onChange={e => set('electricityRate', e.target.value === '' ? undefined : Number(e.target.value))} />)}
                  {F(`Water (${draft.currency ?? 'SAR'}/m³)`,
                    <input type="number" step="0.01" className="input" value={draft.waterRate ?? ''} onChange={e => set('waterRate', e.target.value === '' ? undefined : Number(e.target.value))} />)}
                </div>
                <p className="mt-3 flex items-start gap-2 rounded-xl bg-sand px-3 py-2 text-[11px] text-slate-500">
                  <Percent size={14} className="mt-0.5 shrink-0 text-ocean-500" />
                  {translatePortalText("VAT is added on top of every berth quote and utility invoice. Berth tariffs themselves are set per berth on the\r\n                  Berth Management page.\r\n                ")}</p>

                {/*
                  Two different things live in this section and they are easy to
                  confuse, so they are separated and labelled as such.

                  The field above is the marina's OWN currency — a stored
                  setting that says what its tariffs are denominated in and what
                  its invoices are raised in. Changing it changes the business.

                  This is a per-operator reading preference held in this
                  browser. It converts what is on screen and nothing else: no
                  tariff, invoice, payout or charge moves.
                */}
                <div className="mt-4 border-t border-slate-100 pt-4">
                  <p className="text-xs font-extrabold text-deep-900">{translatePortalText("Display currency")}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {translatePortalText("Just for you, on this browser. Converts what you see — tariffs, invoices and payouts are\r\n                    unaffected.\r\n                  ")}</p>
                  <div className="mt-2.5 inline-flex rounded-full bg-slate-100 p-1">
                    {SUPPORTED_CURRENCIES.map(code => {
                      const active = displayCurrency === code
                      return (
                        <button
                          key={code}
                          type="button"
                          onClick={() => setDisplayCurrency(code)}
                          aria-pressed={active}
                          className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
                            active ? 'bg-white text-deep-900 shadow-soft' : 'text-slate-500 hover:text-deep-900'
                          }`}
                        >
                          <CurrencyIcon currency={code} size={14} />
                          {code}
                        </button>
                      )
                    })}
                  </div>
                  {displayCurrency !== BASE_CURRENCY && (
                    <p className="mt-2 text-[11px] text-slate-400">
                      {translatePortalText("Converted at the SAMA peg, 3.75 SAR = 1 USD. Invoice totals stay in the currency they were\r\n                      issued in.\r\n                    ")}</p>
                  )}
                </div>
              </Section>
            </div>

            {/* 5. Alerts & Notifications */}
            <Section title={translatePortalText("Alerts")} sub="How the platform reaches you">
              <div className="space-y-3">
                {([['notifyByEmail', 'Email me', 'Berth requests, payments and expiring documents by email.'],
                   ['notifyBySms', 'Text me', 'Urgent items by SMS (arrivals, incidents).']] as const).map(([key, title, hint]) => (
                  <div key={key} className="flex items-start gap-3 rounded-xl border border-slate-100 px-3.5 py-3">
                    <Toggle on={!!draft[key]} onChange={v => set(key, v)} />
                    <div>
                      <p className="text-sm font-bold text-deep-900">{translatePortalText(title)}</p>
                      <p className="text-[11px] text-slate-500">{translatePortalText(hint)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            {/* 6. Your Account */}
            <Section title={translatePortalText("Your account")} sub="The operator signed in right now">
              <div className="flex items-center gap-4">
                <div className="relative group">
                  <Avatar name={user?.name} src={user?.avatar} size={54} />
                  <label className="absolute inset-0 flex items-center justify-center bg-black/40 text-white rounded-full opacity-0 group-hover:opacity-100 transition cursor-pointer" title={translatePortalText("Change photo")}>
                    <Upload size={16} />
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={avatarBusy}
                      onChange={async (e) => {
                        const file = e.target.files?.[0]
                        e.target.value = ''
                        if (!file) return
                        setAvatarBusy(true)
                        try {
                          await profileApi.uploadAvatar(file)
                          await refreshMe()
                          toast(translatePortalText('Profile photo updated'), 'success')
                        } catch (err) {
                          toast(translatePortalText(err instanceof Error ? err.message : 'Could not upload photo'), 'warn')
                        } finally {
                          setAvatarBusy(false)
                        }
                      }}
                    />
                  </label>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-deep-900">{user?.name}</p>
                  <p className="truncate text-xs text-slate-500">{user?.email}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">{translatePortalText(humanize(user?.role))}{user?.onboarding?.billingModel ? ` · ${translatePortalText(humanize(user.onboarding.billingModel))} ${translatePortalText('billing')}` : ''}</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <label className="btn-ghost text-xs cursor-pointer inline-flex items-center gap-1.5">
                  <Upload size={13} /> {translatePortalText(avatarBusy ? 'Uploading…' : user?.avatar ? 'Change photo' : 'Upload photo')}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={avatarBusy}
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      if (!file) return
                      setAvatarBusy(true)
                      try {
                        await profileApi.uploadAvatar(file)
                        await refreshMe()
                        toast(translatePortalText('Profile photo updated'), 'success')
                      } catch (err) {
                        toast(translatePortalText(err instanceof Error ? err.message : 'Could not upload photo'), 'warn')
                      } finally {
                        setAvatarBusy(false)
                      }
                    }}
                  />
                </label>
                <button className="btn-ghost" onClick={async () => {
                  const ok = await copyText(user?.email ?? '')
                  toast(translatePortalText(ok ? 'Email copied' : 'Could not copy'), ok ? 'success' : 'warn')
                }}><Mail size={14} /> {translatePortalText("Copy email")}</button>
                <button className="btn-ghost hover:!bg-rose-50 hover:!border-rose-200 hover:text-rose-600 cursor-pointer" onClick={logout}>{translatePortalText("Sign out")}</button>
              </div>
            </Section>
          </div>
        )}
      </AsyncBlock>
    </div>
  )
}

// ===========================================================================
// Incidents & emergency
// ===========================================================================
const INCIDENT_KINDS = ['sos', 'environmental', 'security', 'safety', 'damage', 'other'] as const
const INCIDENT_SEVERITIES = ['low', 'medium', 'high'] as const
const INCIDENT_STATUSES = ['open', 'investigating', 'resolved'] as const
const INCIDENT_STATUS_LABEL: Record<string, string> = { open: 'Open', investigating: 'Investigating', resolved: 'Resolved' }
const SEVERITY_LABEL: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High' }

export function Emergency() {
  const location = useLocation()
  const { reloadOverview } = useOps()
  const { reload: reloadMarina } = useMarina()
  const [status, setStatus] = useState('all')
  const [adding, setAdding] = useState(false)
  const [editingContacts, setEditingContacts] = useState(false)

  useEffect(() => {
    const hash = location.hash.replace(/^#/, '')
    if (hash === 'contacts' || hash === 'emergency_contacts') {
      setEditingContacts(true)
    }
  }, [location.hash])

  useEffect(() => {
    const handler = (e: any) => {
      if (e.detail?.id === 'contacts' || e.detail?.id === 'emergency_contacts' || e.detail?.id === 'emergency') {
        setEditingContacts(true)
      }
    }
    window.addEventListener('boatpro-focus-field', handler)
    return () => window.removeEventListener('boatpro-focus-field', handler)
  }, [])

  const state = useAsync(() => incidentsApi.list({ status: status === 'all' ? undefined : status, limit: 100 }).then(r => r.data), [status])
  const allIncidents = state.data?.items ?? []

  const incCfg: TableFiltersConfig<ApiIncident> = useMemo(() => ({
    searchFields: (inc) => [
      inc.code,
      inc.title,
      inc.boatName,
      inc.description,
      typeof inc.reportedBy === 'object' ? inc.reportedBy?.name : inc.reportedBy,
    ],
    filters: [
      { key: 'kind', label: 'Kind', get: (inc) => inc.kind },
      { key: 'severity', label: 'Severity', get: (inc) => inc.severity },
      { key: 'boat', label: 'Vessel', get: (inc) => inc.boatName },
    ],
  }), [])
  const incTf = useTableFilters(allIncidents, incCfg)
  const rows = incTf.pagedRows
  const counts = state.data?.statusCounts ?? {}
  const contacts = state.data?.emergencyContacts ?? []
  const activeSos = state.data?.activeSos ?? []

  const setIncidentStatus = async (inc: ApiIncident, next: string) => {
    try {
      await incidentsApi.update(inc.id, { status: next as ApiIncident['status'] })
      toast(`${inc.code} → ${translatePortalText(INCIDENT_STATUS_LABEL[next])}`)
      await state.reload()
      await reloadOverview()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not update the incident'), 'warn')
    }
  }

  const remove = (inc: ApiIncident) =>
    confirmAndRun({
      title: `Delete incident ${inc.code}?`,
      body: 'It is removed from the harbour master log. This cannot be undone.',
      confirmLabel: 'Delete',
      busyLabel: 'Deleting...',
      danger: true,
      run: async () => {
        await incidentsApi.remove(inc.id)
        await state.reload()
        await reloadOverview()
      },
      success: `Incident ${inc.code} deleted successfully`,
      error: 'Could not delete the incident. Please try again.',
    })

  return (
    <div>
      <PageHeader title={translatePortalText("Incidents & Emergency")} icon={<Siren className="text-rose-500" />}
        sub="The harbour master's log — SOS calls, spills, security and safety events, plus your emergency call list."
        actions={<>
          <button className="btn-primary !bg-rose-500 hover:!bg-rose-600" onClick={() => setEditingContacts(true)}><PhoneCall size={14} /> {translatePortalText(contacts.length ? 'Emergency Call List' : '+ Add Emergency Contact')}</button>
          <button className="btn-ghost" onClick={() => setAdding(true)}><Plus size={15} /> {translatePortalText("Log incident")}</button>
        </>} />

      {activeSos.length > 0 && (
        <Section title={translatePortalText("Live SOS calls")} sub="Boaters currently signalling for help on the BoatPro network" className="mb-5">
          <div className="space-y-2">
            {activeSos.map(s => (
              <div key={s._id} className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3">
                <Avatar name={s.user?.name} src={s.user?.avatar} size={34} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-rose-800">{s.user?.name ?? translatePortalText('Boater')} · {translatePortalText(humanize(s.type))}</p>
                  <p className="truncate text-[11px] text-rose-700/80">{s.message || translatePortalText('No message')} · {fmtRelative(s.createdAt)}</p>
                </div>
                <a className="chip bg-white text-rose-700 ring-1 ring-rose-200"
                  href={`https://www.openstreetmap.org/?mlat=${s.latitude}&mlon=${s.longitude}#map=10/${s.latitude}/${s.longitude}`}
                  target="_blank" rel="noreferrer">
                  <MapPin size={12} /> {formatPortalNumber(s.latitude, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}, {formatPortalNumber(s.longitude, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
                </a>
                {s.user?.phone && <a className="chip bg-white text-rose-700 ring-1 ring-rose-200" href={`tel:${s.user.phone}`}><Phone size={12} /> {translatePortalText("Call")}</a>}
              </div>
            ))}
          </div>
        </Section>
      )}

      <div className="mb-5 grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard i={0} label="Open" value={counts.open ?? 0} icon={<ShieldAlert size={17} />} tone="rose" />
        <StatCard i={1} label="Investigating" value={counts.investigating ?? 0} icon={<Siren size={17} />} tone="violet" />
        <StatCard i={2} label="Resolved" value={counts.resolved ?? 0} icon={<FileCheck2 size={17} />} tone="green" />
        <StatCard i={3} label="Emergency contacts" value={contacts.length} icon={<PhoneCall size={17} />} tone="navy" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button onClick={() => setStatus('all')} className={`chip transition ${status === 'all' ? 'bg-deep-900 text-white' : 'bg-white ring-1 ring-slate-200 text-slate-500 hover:ring-ocean-300'}`}>{translatePortalText("All")}</button>
            {INCIDENT_STATUSES.map(s => (
              <button key={s} onClick={() => setStatus(s)} className={`chip transition ${status === s ? 'bg-deep-900 text-white' : 'bg-white ring-1 ring-slate-200 text-slate-500 hover:ring-ocean-300'}`}>
                {translatePortalText(INCIDENT_STATUS_LABEL[s])}{counts[s] ? ` · ${formatPortalNumber(counts[s])}` : ''}
              </button>
            ))}
          </div>

          <TableToolbar
            state={incTf}
            config={incCfg}
            rows={allIncidents}
            noun="incidents"
            searchPlaceholder="Search incidents by code, title, vessel or reporter..."
          />

          <AsyncBlock state={state} loadingLabel="Loading the incident log…"
            empty={d => d.items.length === 0 ? { icon: '🛟', text: 'No incidents logged — long may it last.' } : null}>
            {() => allIncidents.length > 0 && rows.length === 0 ? (
              <NoFilterMatches noun="incidents" onClear={incTf.clear} />
            ) : (
              <div className="space-y-3">
                {rows.map((inc, i) => (
                  <motion.div key={inc.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.04, 0.4) }}
                    className="card p-5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="truncate font-display text-base font-extrabold text-deep-900">{inc.title}</h3>
                        <p className="truncate text-xs text-slate-400">
                          {inc.code} · {translatePortalText(humanize(inc.kind))} · {fmtDateTime(inc.occurredAt)}
                          {inc.boatName ? ` · ${inc.boatName}` : ''}
                        </p>
                      </div>
                      <Badge>{translatePortalText(SEVERITY_LABEL[inc.severity])}</Badge>
                    </div>
                    {inc.description && <p className="mt-2 text-sm text-slate-600">{inc.description}</p>}
                    {inc.actionsTaken && (
                      <p className="mt-2 rounded-xl bg-sand px-3 py-2 text-xs text-slate-600"><b>{translatePortalText("Action taken:")}</b> {inc.actionsTaken}</p>
                    )}
                    <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
                      <select value={inc.status} onChange={e => setIncidentStatus(inc, e.target.value)} className="input !w-auto !py-1.5 text-xs font-semibold">
                        {INCIDENT_STATUSES.map(s => <option key={s} value={s}>{translatePortalText(INCIDENT_STATUS_LABEL[s])}</option>)}
                      </select>
                      {inc.resolvedAt && <span className="text-[11px] text-slate-400">{translatePortalText("Resolved ")}{fmtRelative(inc.resolvedAt)}</span>}
                      <button className="btn-ghost !ms-auto !p-2 hover:!bg-rose-50 hover:!border-rose-200 hover:text-rose-500" onClick={() => remove(inc)}><Trash2 size={14} /></button>
                    </div>
                  </motion.div>
                ))}
                <TablePagination state={incTf} noun="incidents" />
              </div>
            )}
          </AsyncBlock>
        </div>

        <div id="contacts" className="transition-all duration-500 rounded-2xl">
          <Section
            title={translatePortalText("Emergency call list")}
            sub="Who the crew rings first"
            actions={<button className="btn-primary !py-1.5 !px-2.5 text-xs !bg-rose-500 hover:!bg-rose-600" onClick={() => setEditingContacts(true)}><Plus size={13} /> {translatePortalText(contacts.length ? 'Edit List' : 'Add Contact')}</button>}
          >
            {contacts.length ? (
              <div className="space-y-2">
                {contacts.map((c, i) => (
                  <a key={i} href={`tel:${c.phone}`} className="flex items-center gap-3 rounded-xl border border-slate-100 p-3 transition hover:bg-sand">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-500"><Phone size={15} /></span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-deep-900">{translatePortalText(c.name)}</p>
                      <p className="truncate text-[11px] text-slate-400">{c.phone}{c.kind ? ` · ${translatePortalText(c.kind)}` : ''}</p>
                    </div>
                  </a>
                ))}
                <button className="btn-ghost w-full mt-2 justify-center text-xs" onClick={() => setEditingContacts(true)}>
                  <Plus size={13} /> {translatePortalText("Add another number\r\n                ")}</button>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center">
                <p className="text-2xl mb-1.5">📞</p>
                <p className="text-sm font-bold text-deep-900">{translatePortalText("No emergency contacts yet")}</p>
                <p className="text-xs text-slate-400 mt-1 mb-4">{translatePortalText("Add your dockmaster, coast guard, marine police, or fire department numbers.")}</p>
                <button className="btn-primary !bg-rose-500 hover:!bg-rose-600 !py-2 !px-4 text-xs mx-auto justify-center" onClick={() => setEditingContacts(true)}>
                  <Plus size={14} /> {translatePortalText("Add Emergency Contact\r\n                ")}</button>
              </div>
            )}
          </Section>
        </div>
      </div>

      <LogIncidentModal open={adding} onClose={() => setAdding(false)} onDone={async () => { await state.reload(); await reloadOverview() }} />
      <ContactsModal open={editingContacts} onClose={() => setEditingContacts(false)} initial={contacts} onDone={async () => { await state.reload(); await reloadMarina() }} />
    </div>
  )
}

function LogIncidentModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [f, setF] = useState({
    title: '', kind: 'other', severity: 'low', status: 'open',
    occurredAt: new Date().toISOString().slice(0, 16), description: '', actionsTaken: '', boatName: '',
  })

  const submit = async () => {
    if (!f.title.trim()) { toast(translatePortalText('Give the incident a title'), 'warn'); return }
    setBusy(true)
    try {
      await incidentsApi.create({
        title: f.title.trim(),
        kind: f.kind as ApiIncident['kind'],
        severity: f.severity as ApiIncident['severity'],
        status: f.status as ApiIncident['status'],
        occurredAt: new Date(f.occurredAt).toISOString(),
        description: f.description.trim() || undefined,
        actionsTaken: f.actionsTaken.trim() || undefined,
        boatName: f.boatName.trim() || undefined,
      })
      toast(translatePortalText('Incident logged'))
      onClose()
      setF({ title: '', kind: 'other', severity: 'low', status: 'open', occurredAt: new Date().toISOString().slice(0, 16), description: '', actionsTaken: '', boatName: '' })
      await onDone()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not log the incident'), 'warn')
    } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title={translatePortalText("🚨 Log an incident")} wide>
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2"><label className="label">{translatePortalText("What happened")}</label><input className="input" value={f.title} onChange={e => setF(s => ({ ...s, title: e.target.value }))} placeholder={translatePortalText("Diesel sheen at the fuel dock")} /></div>
        <div><label className="label">{translatePortalText("Kind")}</label>
          <select className="input" value={f.kind} onChange={e => setF(s => ({ ...s, kind: e.target.value }))}>
            {INCIDENT_KINDS.map(k => <option key={k} value={k}>{translatePortalText(humanize(k))}</option>)}
          </select>
        </div>
        <div><label className="label">{translatePortalText("Severity")}</label>
          <select className="input" value={f.severity} onChange={e => setF(s => ({ ...s, severity: e.target.value }))}>
            {INCIDENT_SEVERITIES.map(s => <option key={s} value={s}>{translatePortalText(SEVERITY_LABEL[s])}</option>)}
          </select>
        </div>
        <div><label className="label">{translatePortalText("When")}</label><input type="datetime-local" className="input" value={f.occurredAt} onChange={e => setF(s => ({ ...s, occurredAt: e.target.value }))} /></div>
        <div><label className="label">{translatePortalText("Boat involved")}</label><input className="input" value={f.boatName} onChange={e => setF(s => ({ ...s, boatName: e.target.value }))} /></div>
        <div className="col-span-2"><label className="label">{translatePortalText("Description")}</label><textarea className="input min-h-[80px]" value={f.description} onChange={e => setF(s => ({ ...s, description: e.target.value }))} /></div>
        <div className="col-span-2"><label className="label">{translatePortalText("Action taken")}</label><textarea className="input min-h-[70px]" value={f.actionsTaken} onChange={e => setF(s => ({ ...s, actionsTaken: e.target.value }))} /></div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>{translatePortalText("Cancel")}</button>
        <button className="btn-primary !bg-rose-500 hover:!bg-rose-600" disabled={busy} onClick={submit}>{translatePortalText(busy ? 'Saving…' : 'Log incident')}</button>
      </div>
    </Modal>
  )
}

function ContactsModal({ open, onClose, initial, onDone }: {
  open: boolean; onClose: () => void; initial: EmergencyContact[]; onDone: () => Promise<void>
}) {
  const [rows, setRows] = useState<EmergencyContact[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setRows(initial.length ? initial.map((contact) => ({ ...contact })) : [{ name: '', phone: '', kind: '' }])
    }
  }, [open, initial])

  const addPreset = (name: string, phone: string, kind: string) => {
    setRows(s => {
      const filtered = s.filter(r => r.name.trim() || r.phone.trim())
      return [...filtered, { name, phone, kind }]
    })
  }

  const save = async () => {
    const validRows = rows.filter(r => r.name.trim() && r.phone.trim())
    if (!validRows.length) {
      toast(translatePortalText('Please enter at least one contact name and phone number'), 'warn')
      return
    }
    setBusy(true)
    try {
      await incidentsApi.setContacts(validRows.map((contact) => ({
        name: contact.name,
        phone: contact.phone,
        kind: canonicalField<string>(contact, 'kind') ?? '',
      })))
      toast(translatePortalText('Emergency call list saved! 🎉'), 'success')
      onClose()
      await onDone()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not save the call list'), 'warn')
    } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title={translatePortalText("📞 Emergency Call List & Contacts")} wide>
      <div className="space-y-4">
        <p className="text-xs text-slate-500">
          {translatePortalText("Add direct telephone numbers for maritime rescue, coast guard, port security, and dockmaster duty staff.\r\n        ")}</p>

        {/* Quick Add Presets */}
        <div>
          <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 block">{translatePortalText("Quick Add Maritime Presets")}</label>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => addPreset('Coast Guard', '994', 'Maritime Search & Rescue')}
              className="chip bg-sand hover:bg-ocean-50 hover:text-ocean-700 text-xs font-semibold ring-1 ring-slate-200">
              {translatePortalText("⚓ Coast Guard (994)\r\n            ")}</button>
            <button type="button" onClick={() => addPreset('Emergency Police / SOS', '999', 'National Emergency')}
              className="chip bg-sand hover:bg-ocean-50 hover:text-ocean-700 text-xs font-semibold ring-1 ring-slate-200">
              {translatePortalText("🚨 Emergency (999)\r\n            ")}</button>
            <button type="button" onClick={() => addPreset('Ambulance / Medical', '997', 'Medical Emergency')}
              className="chip bg-sand hover:bg-ocean-50 hover:text-ocean-700 text-xs font-semibold ring-1 ring-slate-200">
              {translatePortalText("🚑 Ambulance (997)\r\n            ")}</button>
            <button type="button" onClick={() => addPreset('Fire & Safety', '998', 'Fire Emergency')}
              className="chip bg-sand hover:bg-ocean-50 hover:text-ocean-700 text-xs font-semibold ring-1 ring-slate-200">
              {translatePortalText("🚒 Fire (998)\r\n            ")}</button>
            <button type="button" onClick={() => addPreset('Dockmaster Duty Phone', '+966 50 000 0000', 'Harbour Operations')}
              className="chip bg-sand hover:bg-ocean-50 hover:text-ocean-700 text-xs font-semibold ring-1 ring-slate-200">
              {translatePortalText("🛥️ Dockmaster Duty\r\n            ")}</button>
          </div>
        </div>

        {/* Contact Rows */}
        <div className="overflow-x-auto custom-scrollbar border-t border-slate-100 pt-3">
          <div className="space-y-2 min-w-[520px]">
            <div className="grid grid-cols-[1fr_1fr_130px_36px] gap-2 px-1 text-[11px] font-bold text-slate-400 uppercase">
              <span>{translatePortalText("Contact Name / Service")}</span>
              <span>{translatePortalText("Phone Number")}</span>
              <span>{translatePortalText("Role / Dept")}</span>
              <span></span>
            </div>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_130px_36px] gap-2 items-center">
              <input
                className="input text-xs"
                placeholder={translatePortalText("e.g. Coast Guard")}
                value={r.name}
                onChange={e => setRows(s => s.map((x, k) => k === i ? { ...x, name: e.target.value } : x))}
              />
              <input
                className="input text-xs font-mono"
                placeholder={translatePortalText("e.g. +966 50 123 4567 or 994")}
                value={r.phone}
                onChange={e => setRows(s => s.map((x, k) => k === i ? { ...x, phone: e.target.value } : x))}
              />
              <input
                className="input text-xs"
                placeholder={translatePortalText("e.g. Rescue / Security")}
                value={r.kind ?? ''}
                onChange={e => setRows(s => s.map((x, k) => k === i ? { ...x, kind: e.target.value, kindEn: e.target.value } : x))}
              />
              <button
                type="button"
                className="btn-ghost !p-2 hover:!bg-rose-50 hover:text-rose-500 h-9 w-9 grid place-items-center cursor-pointer"
                title={translatePortalText("Remove row")}
                onClick={() => setRows(s => s.length > 1 ? s.filter((_, k) => k !== i) : [{ name: '', phone: '', kind: '' }])}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          </div>
        </div>

        <button
          type="button"
          className="btn-ghost text-xs font-bold text-ocean-600"
          onClick={() => setRows(s => [...s, { name: '', phone: '', kind: '' }])}
        >
          <Plus size={14} /> {translatePortalText("Add Another Contact Row\r\n        ")}</button>
      </div>

      <div className="mt-6 flex justify-end gap-2 border-t border-slate-100 pt-4">
        <button className="btn-ghost" onClick={onClose}>{translatePortalText("Cancel")}</button>
        <button className="btn-primary !bg-rose-500 hover:!bg-rose-600" disabled={busy} onClick={save}>
          {translatePortalText(busy ? 'Saving…' : 'Save Emergency Contacts')}
        </button>
      </div>
    </Modal>
  )
}

// ===========================================================================
// Platform connections — what this marina is actually plugged into
// ===========================================================================
export function Integrations() {
  const { marina, currency } = useMarina()
  const { user } = useAuth()
  const [showToken, setShowToken] = useState(false)
  const settings = useAsync(() => portalApi.settings().then(r => r.data), [])
  const earnings = useAsync(() => earningsApi.mine().then(r => r.data), [])

  const rows = [
    {
      name: 'BoatPro boat-provider app',
      icon: '⚓',
      desc: 'Berth requests arrive here from boat providers and owners searching for a slip.',
      connected: !!marina?.isActive,
      meta: translatePortalText(marina?.isActive ? 'Live — accepting berth requests' : 'Marina closed — turn it on in your profile'),
    },
    {
      name: 'Payments & payouts',
      icon: '💳',
      desc: 'Card and wallet payments on berth contracts, with the platform commission split automatically.',
      connected: !!earnings.data,
      meta: earnings.data
        // `planLabel` comes from the server already worded for the plan's own
        // kind. The old line appended `${commissionRate}%`, which is 0 on a
        // fixed-fee plan and read as "Commission billing · 0%".
        ? `${localizedEnum(earnings.data.planLabel ?? (earnings.data.billingModel === 'subscription' ? 'Subscription' : 'Commission'))} · ${formatPortalNumber(earnings.data.totals.count)} ${translatePortalText('settled payments')}`
        : translatePortalText('Loading…'),
    },
    {
      name: 'VAT invoicing',
      icon: '🧾',
      desc: 'Every paid berth and utility bill generates a numbered VAT invoice PDF for the boater.',
      connected: true,
      meta: `${formatPortalNumber(settings.data?.settings.vatRate ?? 15)}${isPortalArabic() ? '٪' : '%'} ${translatePortalText('VAT')} · ${currency}`,
    },
    {
      name: 'Marine weather & tides',
      icon: '🌤️',
      desc: 'Live wind, sea state and tide curve for your exact coordinates, on your dashboard.',
      connected: true,
      meta: marina ? `${formatPortalNumber(marina.latitude, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}, ${formatPortalNumber(marina.longitude, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}` : '—',
    },
    {
      name: 'Maps & geocoding',
      icon: '🗺️',
      desc: 'Places your marina on the map boaters search, and resolves your address.',
      connected: true,
      meta: 'OpenStreetMap',
    },
    {
      name: 'Email alerts',
      icon: '✉️',
      desc: 'Berth requests, payments and expiring documents delivered to your inbox.',
      connected: !!settings.data?.settings.notifyByEmail,
      meta: settings.data?.settings.notifyByEmail ? (user?.email ?? translatePortalText('enabled')) : translatePortalText('Off — switch it on in Settings'),
    },
    {
      name: 'SMS alerts',
      icon: '📱',
      desc: 'Urgent items by text: arrivals, incidents and SOS calls.',
      connected: !!settings.data?.settings.notifyBySms,
      meta: settings.data?.settings.notifyBySms ? (user?.phone ?? translatePortalText('enabled')) : translatePortalText('Off — switch it on in Settings'),
    },
    {
      name: 'Live chat',
      icon: '💬',
      desc: 'Real-time messaging with berth holders, shared with the mobile apps.',
      connected: true,
      meta: translatePortalText('Socket connection active'),
    },
  ]

  return (
    <div>
      <PageHeader title={translatePortalText("APIs & Integrations")} icon={<Plug className="text-ocean-500" />}
        sub="What your marina is plugged into across the BoatPro platform." />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((r, i) => (
          <motion.div key={r.name} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.04, 0.4) }}
            className="card p-5">
            <div className="flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-sand text-xl">{r.icon}</span>
              <div className="min-w-0 flex-1">
                <h3 className="truncate font-display text-base font-extrabold text-deep-900">{translatePortalText(r.name)}</h3>
                <p className="mt-0.5 text-xs text-slate-500">{translatePortalText(r.desc)}</p>
              </div>
              <span className={`chip ${r.connected ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-slate-100 text-slate-500'}`}>
                {translatePortalText(r.connected ? 'Connected' : 'Off')}
              </span>
            </div>
            <p className="mt-3 border-t border-slate-100 pt-3 text-[11px] font-semibold text-slate-400">{r.meta}</p>
          </motion.div>
        ))}
      </div>

      <Section title={translatePortalText("API access")} sub="For custom integrations against the BoatPro REST API" className="mt-6">
        <div className="space-y-3 text-sm">
          <div>
            <label className="label">{translatePortalText("Base URL")}</label>
            <div className="flex gap-2">
              <input className="input font-mono text-xs" readOnly value={API_URL} />
              <button className="btn-ghost shrink-0" onClick={async () => {
                const ok = await copyText(API_URL)
                toast(translatePortalText(ok ? 'Base URL copied' : 'Could not copy'), ok ? 'success' : 'warn')
              }}>{translatePortalText("Copy")}</button>
            </div>
          </div>
          <div>
            <label className="label">{translatePortalText("Your access token")}</label>
            <div className="flex gap-2">
              <input className="input font-mono text-xs" readOnly type={showToken ? 'text' : 'password'} value={getToken() ?? ''} />
              <button className="btn-ghost shrink-0" onClick={() => setShowToken(v => !v)}>{translatePortalText(showToken ? 'Hide' : 'Reveal')}</button>
              <button className="btn-ghost shrink-0" onClick={async () => {
                const ok = await copyText(getToken() ?? '')
                toast(translatePortalText(ok ? 'Token copied — treat it like a password' : 'Could not copy'), ok ? 'success' : 'warn')
              }}>{translatePortalText("Copy")}</button>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              {translatePortalText("Send it as ")}<span className="font-mono">{translatePortalText("Authorization: Bearer …")}</span>{translatePortalText(". It is your own session token — anyone holding it\r\n              can act as you, and it stops working when you sign out.\r\n            ")}</p>
          </div>
          <div className="rounded-xl bg-sand p-3 font-mono text-[11px] text-slate-600">
            {translatePortalText("curl -H \"Authorization: Bearer $TOKEN\" ")}{API_URL}{translatePortalText("/marina-portal/overview\r\n          ")}</div>
        </div>
      </Section>
    </div>
  )
}
