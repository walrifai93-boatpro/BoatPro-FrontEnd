import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { DEFAULT_COORDS } from '../../shared/geoDefaults'
import { TableToolbar, useTableFilters, NoFilterMatches, TablePagination, type TableFiltersConfig } from '../../shared/TableFilters'
import { useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { MapPin, Phone, Mail, Globe, Radio, Clock, Upload, Navigation, Siren, Camera, Plus, Trash2, ShieldCheck, CheckCircle2, AlertTriangle, Layers, X, Building2, ArrowRight, Edit3, Settings2, Clock3, Sparkles, Check } from 'lucide-react'
import { stationCoverPhotos, toLicence, type Licence } from '../fuelData'
import { fuelApi, type ApiFuelStation, type ApiStationLicense, type ApiStationContact, type ApiStationSummary } from '../fuelApi'
import { useFuel, useFuelResource, ALL_STATIONS } from '../fuelStore'
import { fileUrl, profileApi } from '../../api'
import { useAuth } from '../../auth'
import { listingPhoto } from '../../images'
import { Section, Img, CoverPhoto, LoadingState, ErrorState, LoadingButton, toast, Modal, pickFiles, Toggle } from '../../ui'
import MarinaLocationPicker, { type PickedPoint } from '../../components/MarinaLocationPicker'
import { FuelHeader, FBadge, Metric } from '../fuelUi'
import { confirmAndRun } from '../../async'
import BrandLogoManager from '../../components/BrandLogoManager'
import VendorLogoBadge from '../../components/VendorLogoBadge'
import { useLimitAwareAction } from '../../shared/packageLimit'
import { formatPortalNumber, localizedField, portalLocale, translatePortalText } from '../../i18n/runtime'


// Same gallery sections offered in the registration wizard, so photos taken
// there and photos added later on this page live in one consistent layout.
// No 'delivery_vehicle' section: fuel is served at the station only. Its label
// stays below so photos filed there before still show a heading.
const PHOTO_CATEGORIES = ['cover', 'logo', 'fuel_pumps', 'storage_area', 'office', 'safety_equipment']
const PHOTO_CATEGORY_LABELS: Record<string, string> = {
  cover: 'Cover', logo: 'Logo', fuel_pumps: 'Fuel pumps', storage_area: 'Storage area',
  delivery_vehicle: 'Delivery vehicle', office: 'Office', safety_equipment: 'Safety equipment',
}

interface StationDraft {
  name: string
  nameAr: string
  tagline: string
  stationType: string
  phone: string
  email: string
  website: string
  vhf: string
  address: string
  city: string
  region: string
  latitude: number
  longitude: number
  open24h: boolean
  hours: { label: string; hours: string }[]
  emergencyEmail: string
  emergencyProceduresText: string
}

export default function FuelStation() {
  const location = useLocation()
  const { refresh, products, currentStationId, isAllStations, setCurrentStationId, reloadStations } = useFuel()

  const res = useFuelResource(
    () => fuelApi.station(currentStationId && !isAllStations ? { stationId: currentStationId } : undefined).then(r => r.data),
    [currentStationId, isAllStations],
  )
  const overviewRes = useFuelResource(
    () => (isAllStations ? fuelApi.stationsOverview().then(r => r.data) : Promise.resolve(null)),
    [isAllStations],
  )

  const { logout, user, refreshMe } = useAuth()
  const createStationAction = useLimitAwareAction(fuelApi.saveStation)
  const [previewOpen, setPreviewOpen] = useState(false)

  const [editOpen, setEditOpen] = useState(false)
  const [editTab, setEditTab] = useState<'general' | 'location' | 'hours'>('general')
  const [addAreaOpen, setAddAreaOpen] = useState(false)
  const [createStationOpen, setCreateStationOpen] = useState(false)
  const [addLicenseOpen, setAddLicenseOpen] = useState(false)
  const [addContactOpen, setAddContactOpen] = useState(false)
  const [parentProfileOpen, setParentProfileOpen] = useState(false)
  const [editParentOpen, setEditParentOpen] = useState(false)
  const [uploadingCategory, setUploadingCategory] = useState<string | null>(null)
  const [viewPhoto, setViewPhoto] = useState<{ url: string; category?: string } | null>(null)
  const [photosOpen, setPhotosOpen] = useState(false)

  const focusTarget = useCallback((id: string) => {
    if (id === 'photos' || id === 'gallery_photos' || id === 'section-photos') {
      setPhotosOpen(true)
      const el = document.getElementById('section-photos') || document.getElementById('photos')
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.add('ring-4', 'ring-amber-500', 'ring-offset-2', 'rounded-2xl', 'transition-all', 'duration-500')
        setTimeout(() => el.classList.remove('ring-4', 'ring-amber-500', 'ring-offset-2'), 2500)
      }
      return
    }
    if (id === 'name' || id === 'name_ar' || id === 'tagline' || id === 'phone') {
      setEditOpen(true)
      setEditTab('general')
      return
    }
    if (id === 'address' || id === 'city' || id === 'location' || id === 'gps') {
      setEditOpen(true)
      setEditTab('location')
      return
    }
    if (id === 'hours' || id === 'operating_hours' || id === 'vhf' || id === 'radius' || id === 'safety') {
      setEditOpen(true)
      setEditTab('hours')
      return
    }
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.focus?.()
      el.classList.add('ring-4', 'ring-amber-500', 'ring-offset-2', 'transition-all', 'duration-500')
      setTimeout(() => el.classList.remove('ring-4', 'ring-amber-500', 'ring-offset-2'), 2500)
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

  // Operating hour creation helper states
  const [newHourLabel, setNewHourLabel] = useState('')
  const [newHourVal, setNewHourVal] = useState('')

  const [parentForm, setParentForm] = useState({
    name: user?.name || '',
    phone: user?.phone || user?.business?.contactNumber || '',
    businessName: user?.business?.businessName || '',
    address: user?.business?.address || '',
    description: user?.business?.description || '',
  })

  useEffect(() => {
    if (user) {
      setParentForm({
        name: user.name || '',
        phone: user.phone || user.business?.contactNumber || '',
        businessName: user.business?.businessName || '',
        address: user.business?.address || '',
        description: user.business?.description || '',
      })
    }
  }, [user])

  const [newArea, setNewArea] = useState('')
  const [busy, setBusy] = useState(false)

  // Draft state for station profile editing
  const [draft, setDraft] = useState<StationDraft>({
    name: '',
    nameAr: '',
    tagline: '',
    stationType: 'Marine Fuel Station',
    phone: '',
    email: '',
    website: '',
    vhf: '',
    address: '',
    city: '',
    region: '',
    latitude: DEFAULT_COORDS.latitude,
    longitude: DEFAULT_COORDS.longitude,
    open24h: false,
    hours: [],
    emergencyEmail: '',
    emergencyProceduresText: '',
  })

  // New License Form
  const [newLic, setNewLic] = useState({ name: '', reference: '', expiresAt: '' })

  // New Contact Form
  const [newContact, setNewContact] = useState({ name: '', phone: '', kind: 'Harbor Control / Safety' })

  // New Station Location Form
  const [newStationForm, setNewStationForm] = useState({
    name: '', address: '', city: '',
    latitude: DEFAULT_COORDS.latitude, longitude: DEFAULT_COORDS.longitude,
    contactNumber: '', currency: 'SAR'
  })

  const station: ApiFuelStation | null = res.data?.station ?? null
  const stations: ApiFuelStation[] = res.data?.stations ?? []

  const info = useMemo(() => ({
    name: (localizedField<string>(station, 'name') as string | undefined) ?? station?.name ?? '',
    tagline: localizedField<string>(station, 'tagline', station?.tagline) ?? '',
    stationType: station?.stationType ?? 'Marine Fuel Station',
    phone: station?.contactNumber ?? '—',
    email: station?.email ?? '—',
    website: station?.website ?? '—',
    vhf: station?.vhfChannel ?? '—',
    address: localizedField<string>(station, 'address', station?.address) ?? '',
    city: localizedField<string>(station, 'city', station?.city) ?? '',
    latitude: station?.latitude ?? DEFAULT_COORDS.latitude,
    longitude: station?.longitude ?? DEFAULT_COORDS.longitude,
    open24h: station?.open24h ?? false,
  }), [station])

  const licenses: Licence[] = useMemo(() => (station?.licenses ?? []).map(toLicence), [station])
  const areas = station?.serviceAreas ?? []
  const hours = station?.hours ?? []
  const emergencyContacts = station?.emergencyContacts ?? []
  const coverPhotos = stationCoverPhotos(station)
  // A photograph of someone else's bunkering dock stood in for a station
  // that has uploaded none, on the page whose whole subject is this station.
  const coverUrl = coverPhotos[0] ?? listingPhoto(station?.name, 'fuel')

  const save = async (patch: Partial<ApiFuelStation> & { createMode?: boolean; stationId?: string }, msg: string) => {
    setBusy(true)
    try {
      await fuelApi.saveStation(patch, station?.id ? { stationId: station.id } : undefined)
      await res.reload()
      void refresh()
      window.dispatchEvent(new CustomEvent('boatpro-station-updated'))
      toast(translatePortalText(msg))
      return true
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not save'), 'warn')
      return false
    } finally {
      setBusy(false)
    }
  }

  const openEdit = (tab: 'general' | 'location' | 'hours' = 'general') => {
    if (!station) return
    setEditTab(tab)
    setDraft({
      name: station.name || '',
      nameAr: station.nameAr || '',
      tagline: station.tagline || '',
      stationType: station.stationType || 'Marine Fuel Station',
      phone: station.contactNumber || '',
      email: station.email || '',
      website: station.website || '',
      vhf: station.vhfChannel || '',
      address: station.address || '',
      city: station.city || '',
      region: station.region || '',
      latitude: station.latitude ?? DEFAULT_COORDS.latitude,
      longitude: station.longitude ?? DEFAULT_COORDS.longitude,
      open24h: station.open24h ?? false,
      hours: station.hours ? station.hours.map(h => ({ ...h })) : [],
      emergencyEmail: station.emergencyEmail || '',
      emergencyProceduresText: station.emergencyProceduresText || '',
    })
    setEditOpen(true)
  }

  const saveEdit = async () => {
    if (!station) return
    if (!draft.name.trim() || !draft.address.trim()) {
      toast(translatePortalText("Station name and address are required"), 'warn')
      return
    }
    const ok = await save(
      {
        stationId: station.id,
        name: draft.name.trim(),
        nameAr: draft.nameAr.trim() || undefined,
        tagline: draft.tagline.trim() || undefined,
        stationType: draft.stationType,
        contactNumber: draft.phone.trim() || undefined,
        email: draft.email.trim() || undefined,
        website: draft.website.trim() || undefined,
        vhfChannel: draft.vhf.trim() || undefined,
        address: draft.address.trim(),
        city: draft.city.trim() || undefined,
        region: draft.region.trim() || undefined,
        latitude: draft.latitude,
        longitude: draft.longitude,
        open24h: draft.open24h,
        hours: draft.hours,
        emergencyEmail: draft.emergencyEmail.trim() || undefined,
        emergencyProceduresText: draft.emergencyProceduresText.trim() || undefined,
      },
      `Station profile for "${draft.name}" saved!`,
    )
    if (ok) {
      setEditOpen(false)
      await reloadStations()
    }
  }

  const createNewStation = async () => {
    if (!newStationForm.name.trim() || !newStationForm.address.trim()) {
      toast(translatePortalText("Station name and address are required"), 'warn')
      return
    }
    setBusy(true)
    try {
      const resData = await createStationAction.run({
        createMode: true,
        name: newStationForm.name.trim(),
        address: newStationForm.address.trim(),
        city: newStationForm.city.trim() || undefined,
        latitude: newStationForm.latitude,
        longitude: newStationForm.longitude,
        contactNumber: newStationForm.contactNumber.trim() || undefined,
        currency: newStationForm.currency,
      })
      if (!resData) return
      toast(translatePortalText("New fuel station location created!"))
      setCreateStationOpen(false)
      setNewStationForm({
        name: '', address: '', city: '',
        latitude: DEFAULT_COORDS.latitude, longitude: DEFAULT_COORDS.longitude,
        contactNumber: '', currency: 'SAR',
      })
      if (resData.data.station?.id) {
        setCurrentStationId(resData.data.station.id)
      }
      await res.reload()
      await reloadStations()
      void refresh()
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Failed to create station'), 'warn')
    } finally {
      setBusy(false)
    }
  }


  const deleteStationLocation = (stId: string, name: string) =>
    confirmAndRun({
      title: translatePortalText(`Remove station location "${name}"?`),
      body: 'Its tanks, pumps and stock records go with it. This cannot be undone.',
      confirmLabel: translatePortalText("Remove"),
      busyLabel: 'Removing...',
      danger: true,
      run: async () => {
        setBusy(true)
        try {
          await fuelApi.deleteStationLocation(stId)
          setCurrentStationId(null)
          await res.reload()
          await reloadStations()
          void refresh()
        } finally { setBusy(false) }
      },
      success: translatePortalText(`Station location "${name}" removed successfully`),
      error: translatePortalText("Could not remove the station location. Please try again."),
    })

  const changeCover = async () => {
    const files = await pickFiles('image/*', true)
    if (!files.length) return
    setUploadingCategory('cover')
    try {
      await fuelApi.uploadStationImages(files, station?.id, 'cover')
      await res.reload()
      toast(translatePortalText("Cover photo updated"))
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Upload failed'), 'warn')
    } finally {
      setUploadingCategory(null)
    }
  }

  const uploadMedia = async (category: string) => {
    const files = await pickFiles('image/*', true)
    if (!files.length) return
    setUploadingCategory(category)
    try {
      await fuelApi.uploadStationImages(files, station?.id, category)
      await res.reload()
      toast(translatePortalText(`Added ${files.length} photo${files.length > 1 ? 's' : ''}`))
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Upload failed'), 'warn')
    } finally {
      setUploadingCategory(null)
    }
  }

  const removePhoto = async (url: string) => {
    try {
      await fuelApi.deleteStationImage(url, station?.id)
      await res.reload()
      toast(translatePortalText("Photo removed"), 'info')
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not remove that photo'), 'warn')
    }
  }

  const addArea = async () => {
    const v = newArea.trim()
    if (!v) return
    const ok = await save({ serviceAreas: [...areas, v] }, 'Service area added')
    if (ok) { setNewArea(''); setAddAreaOpen(false) }
  }

  const removeArea = async (target: string) => {
    await save({ serviceAreas: areas.filter(a => a !== target) }, 'Service area removed')
  }

  const addLicense = async () => {
    if (!newLic.name.trim()) { toast(translatePortalText("License name is required"), 'warn'); return }
    const licItem: ApiStationLicense = {
      name: newLic.name.trim(),
      reference: newLic.reference.trim() || undefined,
      expiresAt: newLic.expiresAt ? new Date(newLic.expiresAt).toISOString() : undefined,
      issuedAt: new Date().toISOString(),
    }
    const currentLics: ApiStationLicense[] = station?.licenses ?? []
    const ok = await save({ licenses: [...currentLics, licItem] }, 'License added')
    if (ok) { setNewLic({ name: '', reference: '', expiresAt: '' }); setAddLicenseOpen(false) }
  }

  const removeLicense = async (index: number) => {
    const currentLics: ApiStationLicense[] = station?.licenses ?? []
    const updated = currentLics.filter((_, i) => i !== index)
    await save({ licenses: updated }, 'License removed')
  }

  const addEmergencyContact = async () => {
    if (!newContact.name.trim() || !newContact.phone.trim()) {
      toast(translatePortalText("Name and phone number are required"), 'warn')
      return
    }
    const contactItem: ApiStationContact = {
      name: newContact.name.trim(),
      phone: newContact.phone.trim(),
      kind: newContact.kind.trim() || 'Emergency Contact',
    }
    const currentContacts: ApiStationContact[] = station?.emergencyContacts ?? []
    const ok = await save({ emergencyContacts: [...currentContacts, contactItem] }, 'Emergency contact added')
    if (ok) { setNewContact({ name: '', phone: '', kind: 'Harbor Control / Safety' }); setAddContactOpen(false) }
  }

  const removeEmergencyContact = async (index: number) => {
    const currentContacts: ApiStationContact[] = station?.emergencyContacts ?? []
    const updated = currentContacts.filter((_, i) => i !== index)
    await save({ emergencyContacts: updated }, 'Emergency contact removed')
  }

  const saveParentProfile = async () => {
    setBusy(true)
    try {
      if (parentForm.name || parentForm.phone) {
        await profileApi.update({ name: parentForm.name, phone: parentForm.phone })
      }
      await profileApi.updateBusiness({
        businessName: parentForm.businessName,
        contactNumber: parentForm.phone,
        address: parentForm.address,
        description: parentForm.description,
      })
      if (refreshMe) await refreshMe()
      toast(translatePortalText("Parent company profile updated successfully!"))
      setEditParentOpen(false)
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not update parent profile'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  const renewExpired = async () => {
    if (!station) return
    const stale = station.licenses.filter(l => toLicence(l).status !== 'Valid')
    if (!stale.length) { toast(translatePortalText("All licenses already valid")); return }
    const next = station.licenses.map(l => {
      if (toLicence(l).status === 'Valid') return l
      const base = l.expiresAt ? new Date(l.expiresAt) : new Date()
      base.setFullYear(base.getFullYear() + 1)
      return { ...l, expiresAt: base.toISOString() }
    })
    await save({ licenses: next }, `Renewed ${stale.length} license${stale.length > 1 ? 's' : ''}`)
  }

  if (res.loading && !res.data) return <LoadingState label={translatePortalText("Loading station profile…")} rows={5} />
  if (res.error) return <ErrorState error={translatePortalText(res.error)} onRetry={() => void res.reload()} />

  if (!station) {
    return (
      <div className="space-y-5">
        <FuelHeader title={translatePortalText("Fuel Station Profile")} sub={translatePortalText("Business identity, floating station details, licenses & emergency readiness")}
          icon={<span className="text-2xl">⛽</span>} />
        <Section title={translatePortalText("Set up your station")} sub={translatePortalText("Your public profile hasn't been created yet")}>
          <StationSetup onCreated={async () => { await res.reload(); void refresh() }} />
        </Section>
      </div>
    )
  }

  const gps = `${station.latitude.toFixed(4)}° , ${station.longitude.toFixed(4)}°`

  return (
    <div className="space-y-5">
      {/* Station Location Switcher Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 p-3.5 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-500 text-white font-extrabold shadow-sm text-lg">
            ⛽
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-amber-700">{translatePortalText("Fuel Station Location")}</span>
              {stations.length > 1 && (
                <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-extrabold text-amber-800">
                  {stations.length}{translatePortalText(" Locations Managed")}</span>
              )}
            </div>
            <select
              className="mt-0.5 bg-transparent font-display text-base font-extrabold text-deep-900 cursor-pointer focus:outline-none"
              value={currentStationId ?? station.id}
              onChange={(e) => setCurrentStationId(e.target.value)}
            >
              {stations.length > 1 && (
                <option value={ALL_STATIONS} className="text-deep-900 font-bold">{translatePortalText("🏢 All Stations (Parent Overview)")}</option>
              )}
              {stations.map((st) => (
                <option key={st.id} value={st.id} className="text-deep-900 font-bold">
                  {st.approvalStatus === 'pending' ? translatePortalText("⏳ [Pending Approval] ") : st.approvalStatus === 'rejected' ? translatePortalText("❌ [Rejected] ") : translatePortalText("📍 ")}
                  {st.name} {st.city ? `(${st.city})` : translatePortalText("")}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isAllStations && (
            <button
              className="btn-ghost !py-1.5 !px-3 text-xs text-deep-900 border border-slate-200 bg-white/90 hover:bg-white hover:border-amber-400 font-bold"
              onClick={() => openEdit('general')}
            >
              <Edit3 size={13} />{translatePortalText(" Edit This Station")}</button>
          )}
          <button
            className="btn-fuel !py-1.5 !px-3 text-xs"
            onClick={() => setCreateStationOpen(true)}
          >
            <Plus size={14} />{translatePortalText(" Add Fuel Station Location")}</button>
          {!isAllStations && stations.length > 1 && (
            <button
              className="btn-ghost !py-1.5 !px-2.5 text-xs !text-rose-600 hover:!bg-rose-50"
              title={translatePortalText("Delete this station location")}
              disabled={busy}
              onClick={() => deleteStationLocation(station.id, station.name)}
            >
              <Trash2 size={14} />{translatePortalText(" Remove Location")}</button>
          )}
        </div>
      </div>

      {isAllStations ? (
        <AllStationsOverview
          rows={overviewRes.data?.stations ?? []}
          totals={overviewRes.data?.totals ?? null}
          loading={overviewRes.loading}
          currency={station.currency}
          onManage={(id) => setCurrentStationId(id)}
        />
      ) : (
      <>
      {/* Approval Status Notification Banner */}
      {station.approvalStatus === 'pending' && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50/90 p-4 text-amber-900 dark:border-amber-400/40 dark:bg-amber-950/30 dark:text-amber-200 shadow-sm flex items-start gap-3.5">
          <span className="text-2xl mt-0.5">⏳</span>
          <div className="flex-1">
            <h4 className="font-extrabold text-sm text-amber-950 dark:text-amber-100">{translatePortalText("Awaiting Platform Admin Approval")}</h4>
            <p className="text-xs text-amber-800 dark:text-amber-200 mt-0.5 leading-relaxed">{translatePortalText("This fuel station location was recently added and is currently pending review by platform administrators. Once approved, it will automatically go live on customer marine maps and begin accepting fuel orders.")}</p>
          </div>
          <span className="rounded-full bg-amber-200/80 dark:bg-amber-950/70 px-3 py-1 text-[11px] font-extrabold text-amber-900 dark:text-amber-200 uppercase tracking-wide">{translatePortalText("Pending Review")}</span>
        </div>
      )}

      {station.approvalStatus === 'rejected' && (
        <div className="rounded-2xl border border-rose-300 bg-rose-50/90 p-4 text-rose-900 dark:border-rose-400/40 dark:bg-rose-950/30 dark:text-rose-200 shadow-sm flex items-start gap-3.5">
          <span className="text-2xl mt-0.5">❌</span>
          <div className="flex-1">
            <h4 className="font-extrabold text-sm text-rose-950 dark:text-rose-100">{translatePortalText("Station Location Request Rejected")}</h4>
            <p className="text-xs text-rose-800 dark:text-rose-200 mt-0.5 leading-relaxed">{translatePortalText("This station location request was reviewed and rejected by platform administrators.")}</p>
            {station.rejectionReason && (
              <p className="mt-2 rounded-xl bg-white/80 dark:bg-rose-950/70 p-2.5 text-xs font-semibold text-rose-900 dark:text-rose-200 border border-rose-200 dark:border-rose-400/40">{translatePortalText("Reason: ")}{station.rejectionReason}
              </p>
            )}
          </div>
          <span className="rounded-full bg-rose-200/80 dark:bg-rose-950/70 px-3 py-1 text-[11px] font-extrabold text-rose-900 dark:text-rose-200 uppercase tracking-wide">{translatePortalText("Rejected")}</span>
        </div>
      )}

      <FuelHeader title={translatePortalText("Fuel Station Profile")} sub={translatePortalText(`Managing details, contact, GPS coordinates & operations for ${info.name}`)}
        icon={<span className="text-2xl">⛽</span>}
        actions={<>
          <button className="btn-ghost !bg-amber-500/10 !text-amber-800 border border-amber-500/20" onClick={() => setParentProfileOpen(true)}>{translatePortalText("🏢 Parent Company Profile")}</button>
          <button className="btn-ghost" onClick={() => setPreviewOpen(true)}>{translatePortalText("👁️ Preview public page")}</button>
          <button className="btn-fuel !px-4" onClick={() => openEdit('general')}><Edit3 size={14} />{translatePortalText(" Edit Station Profile")}</button>
        </>} />

      {/* cover */}
      <motion.div initial={{ opacity: 0, scale: 0.99 }} animate={{ opacity: 1, scale: 1 }}
        className="relative h-64 overflow-hidden rounded-3xl shadow-lift">
        <CoverPhoto srcs={coverPhotos} className="absolute inset-0 h-full w-full" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#120a04]/90 via-[#120a04]/25 to-transparent" />
        <button onClick={changeCover} disabled={busy} className="absolute end-4 top-4 btn-ghost !bg-white/85 backdrop-blur !py-1.5 !px-3 text-xs">
          <Camera size={14} />{translatePortalText(" Change cover photo")}</button>
        <div className="absolute bottom-5 start-6 text-white">
          <p className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.2em] text-amber-300">
            {translatePortalText(station.stationType ?? 'Marine Fuel Station')} · {info.city || translatePortalText('Coastal Waterway')}
          </p>
          <h2 className="font-display text-2xl md:text-3xl font-extrabold">{info.name}</h2>
          <p className="mt-1 text-sm text-white/80">{info.tagline || station.address}</p>
        </div>
        <div className="absolute bottom-5 end-6 hidden items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-xs font-bold text-white backdrop-blur md:flex ring-1 ring-white/20">
          {station.approvalStatus === 'pending' ? (
            <>
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
              <span>{translatePortalText("Awaiting Admin Approval")}</span>
            </>
          ) : station.approvalStatus === 'rejected' ? (
            <>
              <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
              <span>{translatePortalText("Admin Rejected")}</span>
            </>
          ) : (
            <>
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative h-2.5 w-2.5 rounded-full bg-emerald-400" />
              </span>
              {station.open24h ? translatePortalText("Open 24/7") : station.isActive ? translatePortalText("Open Now") : translatePortalText("Currently Closed")}
            </>
          )}
        </div>
      </motion.div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* contact + gps */}
        <Section
          title={translatePortalText("Contact & GPS location")}
          sub={translatePortalText("How customers reach and navigate to your dock")}
          actions={
            <button className="btn-fuel !py-1 !px-2.5 text-xs" onClick={() => openEdit('location')}>
              <Edit3 size={12} />{translatePortalText(" Edit Details & Map")}</button>
          }
        >
          <div className="space-y-2.5 text-[13px] font-semibold text-deep-800">
            {[
              { icon: <MapPin size={15} className="text-amber-500" />, v: info.address || translatePortalText('Address not set') },
              { icon: <Navigation size={15} className="text-amber-500" />, v: translatePortalText(`Coordinates: ${gps}`) },
              { icon: <Radio size={15} className="text-amber-500" />, v: info.vhf && info.vhf !== '—' ? translatePortalText(`VHF Channel ${info.vhf}`) : translatePortalText('VHF channel not set') },
              { icon: <Phone size={15} className="text-amber-500" />, v: info.phone },
              { icon: <Mail size={15} className="text-amber-500" />, v: info.email },
              { icon: <Globe size={15} className="text-amber-500" />, v: info.website && info.website !== '—' ? info.website : translatePortalText('Website not set') },
            ].map((r, i) => (
              <motion.div key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                className="flex items-center gap-3 rounded-xl border border-slate-100 px-3.5 py-2.5 bg-sand/30">
                {r.icon}{r.v}
              </motion.div>
            ))}
          </div>

          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">{translatePortalText("Serviced Areas & Piers")}</span>
              <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => setAddAreaOpen(true)}>
                <Plus size={13} />{translatePortalText(" Add Area")}</button>
            </div>
            <div className="flex flex-wrap gap-2">
              {areas.length === 0 && <span className="text-xs text-slate-400 italic">{translatePortalText("No service areas specified.")}</span>}
              {areas.map(a => (
                <span key={a} className="chip bg-amber-50 text-amber-800 ring-1 ring-amber-200/80 flex items-center gap-1.5">
                  📍 {a}
                  <button onClick={() => removeArea(a)} className="hover:text-rose-600 transition" title={translatePortalText("Remove area")}><X size={12} /></button>
                </span>
              ))}
            </div>
          </div>
        </Section>

        {/* hours & metrics */}
        <Section
          title={translatePortalText("Operating hours & metrics")}
          sub={translatePortalText("Fueling windows & active station capacity")}
          actions={
            <button className="btn-fuel !py-1 !px-2.5 text-xs" onClick={() => openEdit('hours')}>
              <Edit3 size={12} />{translatePortalText(" Edit Hours & Fees")}</button>
          }
        >
          <div className="space-y-2">
            {hours.length === 0 && <p className="rounded-xl bg-sand px-3 py-4 text-center text-xs font-semibold text-slate-400">{translatePortalText("No custom opening hours set — station is active by default.")}</p>}
            {hours.map((h, i) => (
              <motion.div key={h.label + i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                className={`flex items-center justify-between rounded-xl px-3.5 py-2.5 text-[13px] ${/emergency/i.test(h.label) ? 'bg-rose-50 text-rose-700 font-bold' : 'bg-sand font-semibold'}`}>
                <span className="flex items-center gap-2">{/emergency/i.test(h.label) ? <Siren size={14} /> : <Clock size={14} className="text-amber-500" />}{translatePortalText(h.label)}</span>
                <b>{h.hours}</b>
              </motion.div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <Metric icon="⚓" label={translatePortalText("Fuel service")} value={translatePortalText("At the fuel dock")} />
            <Metric icon="⭐" label={translatePortalText("Public Rating")} value={res.data?.stats?.rating ? `${res.data.stats.rating.toFixed(1)} (${formatPortalNumber(res.data.stats.ratingCount)})` : translatePortalText("New Station")} />
            <Metric icon="⛽" label={translatePortalText("Active Pumps & Tanks")} value={`${formatPortalNumber(res.data?.stats?.pumps || 0)} ${translatePortalText("Pumps")} · ${formatPortalNumber(res.data?.stats?.tanks || 0)} ${translatePortalText("Tanks")}`} />
            <Metric icon="📻" label={translatePortalText("VHF Channel")} value={station.vhfChannel || translatePortalText("—")} />
          </div>
        </Section>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* emergency contacts */}
        <Section title={translatePortalText("Emergency contacts")} sub={translatePortalText("Always visible to on-duty staff")}
          actions={<button className="btn-ghost !py-1 !px-2.5 text-xs text-rose-600" onClick={() => setAddContactOpen(true)}><Plus size={13} />{translatePortalText(" Add Contact")}</button>}>
          <div className="space-y-2">
            {emergencyContacts.length === 0 && <p className="rounded-xl bg-sand px-3 py-6 text-center text-xs font-semibold text-slate-400">{translatePortalText("No emergency contacts set.")}</p>}
            {emergencyContacts.map((e, i) => (
              <motion.div key={e.name + i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }}
                className="flex items-center gap-3 rounded-xl bg-rose-50/70 border border-rose-100 px-3.5 py-2.5">
                <Siren size={16} className="text-rose-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-extrabold text-deep-900 truncate">{e.name}</p>
                  <p className="text-[11px] text-slate-500 truncate">{translatePortalText(e.kind || 'Emergency Contact')}</p>
                </div>
                <a className="text-[13px] font-extrabold text-rose-600 hover:underline" href={`tel:${e.phone}`}>{e.phone}</a>
                <button onClick={() => removeEmergencyContact(i)} className="text-slate-400 hover:text-rose-600 p-1" title={translatePortalText("Delete contact")}><X size={13} /></button>
              </motion.div>
            ))}
          </div>
        </Section>

        {/* licenses */}
        <Section title={translatePortalText("Licenses & Certificates")} sub={translatePortalText("Compliance and operating permits")}
          actions={<>
            <button className="btn-ghost !py-1 !px-2 text-xs" onClick={renewExpired} title={translatePortalText("Renew expired permits")}>{translatePortalText("Renew")}</button>
            <button className="btn-fuel !py-1 !px-2.5 text-xs" onClick={() => setAddLicenseOpen(true)}><Plus size={13} />{translatePortalText(" Add Permit")}</button>
          </>}>
          <div className="space-y-2">
            {licenses.length === 0 && <p className="rounded-xl bg-sand px-3 py-6 text-center text-xs font-semibold text-slate-400">{translatePortalText("No permits uploaded.")}</p>}
            {licenses.map((l, i) => (
              <div key={l.name + i} className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 px-3.5 py-2.5 bg-white text-[13px]">
                <div className="min-w-0 flex-1">
                  <p className="font-extrabold text-deep-900 truncate">{l.name}</p>
                  <p className="text-[11px] text-slate-400">{l.no && l.no !== '—' ? `Ref: ${l.no}` : translatePortalText("Permit")}</p>
                </div>
                <FBadge dot={l.status !== 'Valid'}>{l.status}</FBadge>
                <button onClick={() => removeLicense(i)} className="text-slate-300 hover:text-rose-600 p-1" title={translatePortalText("Delete license")}><X size={13} /></button>
              </div>
            ))}
          </div>
        </Section>

      </div>

      {/* gallery */}
      <div id="section-photos" className="transition-all duration-500 rounded-2xl">
        <Section title={translatePortalText("Photos & Brand Logo")} sub={translatePortalText(`${station.imagesCategorized?.length ?? station.images.length} photos · Official Logo & Station Bunkering Views`)}
          actions={<button id="photos" className="btn-fuel !py-1.5 !px-3 text-xs" onClick={() => setPhotosOpen(true)}>{translatePortalText("Manage Photos & Logo")}</button>}>
          <div className="flex items-center gap-4">
            {station.logo || station.imagesCategorized?.find(i => i.category === 'logo')?.url ? (
              <div className="relative h-14 w-14 shrink-0 rounded-xl border border-slate-200 dark:border-slate-800 p-1.5 bg-slate-50 dark:bg-slate-900 flex items-center justify-center shadow-2xs" title={translatePortalText("Official Brand Logo")}>
                <img src={fileUrl((station.logo || station.imagesCategorized?.find(i => i.category === 'logo')?.url)!)} alt={translatePortalText("Logo")} className="max-h-full max-w-full object-contain" />
                <span className="absolute -bottom-1 -end-1 rounded-md bg-amber-500 text-[8px] font-black text-white px-1">{translatePortalText("LOGO")}</span>
              </div>
            ) : (
              <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-sand border border-dashed border-slate-300 text-[10px] font-bold text-slate-400">{translatePortalText("No Logo")}</div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-deep-900 dark:text-white">
                {station.logo || station.imagesCategorized?.find(i => i.category === 'logo')?.url ? translatePortalText("Brand Logo Active ✨") : translatePortalText("No Brand Logo Uploaded Yet")}
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">{translatePortalText("Upload a transparent logo (.png/.webp) so boaters recognise your station on the map.")}</p>
            </div>
          </div>
        </Section>
      </div>
      </>
      )}

      <Modal open={photosOpen} onClose={() => setPhotosOpen(false)} title={translatePortalText("📷 Manage Photos & Brand Logo")} wide>
        <div className="space-y-6 max-h-[75vh] overflow-y-auto pe-1">
          <BrandLogoManager
            logoUrl={station.logo || station.imagesCategorized?.find(i => i.category === 'logo')?.url}
            providerName={info.name || translatePortalText('Fuel Station')}
            categoryLabel={translatePortalText('Fuel Station')}
            onUpload={async (file) => {
              await fuelApi.uploadStationImages([file], station?.id, 'logo')
              await res.reload()
            }}
            onRemove={async (url) => {
              await fuelApi.deleteStationImage(url, station?.id)
              await res.reload()
            }}
          />

          <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-400 mb-4">{translatePortalText("Station & Wharf Gallery Sections")}</h4>
            <div className="space-y-5">
              {PHOTO_CATEGORIES.filter(c => c !== 'logo').map((cat) => {
                const imgs = (station.imagesCategorized || []).filter((i) => (i.category || 'other') === cat)
                const label = PHOTO_CATEGORY_LABELS[cat] || cat
                return (
                  <div key={cat}>
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                        {translatePortalText(label)}{cat === 'cover' ? translatePortalText(" (rotating)") : translatePortalText("")} <span className="font-normal normal-case text-slate-300">· {formatPortalNumber(imgs.length)}</span>
                      </p>
                      <button className="btn-fuel !py-1 !px-2 text-[11px]" disabled={uploadingCategory === cat} onClick={() => uploadMedia(cat)}>
                        <Upload size={11} />{translatePortalText(" Add")}</button>
                    </div>
                    {imgs.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 py-6 text-center text-[11px] text-slate-400">{translatePortalText("No ")}{label.toLowerCase()}{translatePortalText(" photos yet")}</div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                        {imgs.map((img, i) => (
                          <motion.button key={img.url} type="button" initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.05 }}
                            whileHover={{ scale: 1.03 }} onClick={() => setViewPhoto(img)}
                            className="group relative h-24 cursor-pointer overflow-hidden rounded-2xl border border-slate-100 text-left">
                            <Img src={fileUrl(img.url)!} className="h-full w-full object-cover transition duration-500 group-hover:scale-110" />
                            <span onClick={(e) => { e.stopPropagation(); removePhoto(img.url) }}
                              className="absolute end-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-lg bg-white/90 text-rose-500 opacity-0 transition group-hover:opacity-100">
                              <Trash2 size={13} />
                            </span>
                          </motion.button>
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
                <Trash2 size={13} />{translatePortalText(" Remove photo")}</button>
            </div>
          </div>
        )}
      </Modal>

      {/* preview public page modal */}
      <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} title={translatePortalText("Public Page Preview")} wide>
        <div className="space-y-4">
          <div className="relative h-48 overflow-hidden rounded-2xl">
            <Img src={coverUrl} className="h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#120a04]/90 via-transparent to-transparent" />
            <div className="absolute bottom-4 start-5 text-white">
              <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-amber-300">{translatePortalText(station.stationType ?? 'Marine Fuel Station')}</p>
              <h3 className="font-display text-2xl font-extrabold">{info.name}</h3>
              <p className="mt-0.5 text-xs text-white/80">{info.tagline || station.address}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">{translatePortalText("Contact Details")}</p>
              <div className="space-y-1.5 text-xs font-semibold text-deep-900 bg-sand p-3 rounded-xl">
                <p>📍 {info.address}</p>
                <p>📞 {info.phone}</p>
                <p>✉️ {info.email}</p>
                <p>{translatePortalText("📻 VHF Channel ")}{info.vhf}</p>
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">{translatePortalText("Operating Hours")}</p>
              <div className="space-y-1.5">
                {hours.map((h, i) => (
                  <div key={h.label + i} className="flex items-center justify-between rounded-xl bg-sand px-3 py-2 text-[13px]">
                    <span className="font-bold">{h.label}</span><b>{h.hours}</b>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button className="btn-ghost" onClick={() => setPreviewOpen(false)}>{translatePortalText("Close Preview")}</button>
          </div>
        </div>
      </Modal>

      {/* edit station info modal */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={translatePortalText(`✏️ Edit Station Profile — ${info.name}`)} wide>
        <div className="space-y-4">
          {/* Tab Selector */}
          <div className="flex rounded-xl bg-sand/60 p-1 border border-slate-200/70 text-xs font-extrabold text-deep-800">
            <button
              type="button"
              onClick={() => setEditTab('general')}
              className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-1.5 transition ${
                editTab === 'general' ? 'bg-white shadow-xs text-amber-900 border border-slate-100' : 'text-slate-500 hover:text-deep-900'
              }`}
            >
              <span>📍</span>{translatePortalText(" General & Contact")}</button>
            <button
              type="button"
              onClick={() => setEditTab('location')}
              className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-1.5 transition ${
                editTab === 'location' ? 'bg-white shadow-xs text-amber-900 border border-slate-100' : 'text-slate-500 hover:text-deep-900'
              }`}
            >
              <span>🗺️</span>{translatePortalText(" GPS & Map")}</button>
            <button
              type="button"
              onClick={() => setEditTab('hours')}
              className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-1.5 transition ${
                editTab === 'hours' ? 'bg-white shadow-xs text-amber-900 border border-slate-100' : 'text-slate-500 hover:text-deep-900'
              }`}
            >
              <span>⏱️</span>{translatePortalText(" Operations")}</button>
          </div>

          {/* TAB 1: General & Contact */}
          {editTab === 'general' && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="label">{translatePortalText("Station Location Name (English) *")}</label>
                  <input
                    id="name"
                    className="input"
                    placeholder={translatePortalText("e.g. Marina East Fuel Dock")}
                    value={draft.name}
                    onChange={e => setDraft({ ...draft, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">{translatePortalText("Arabic Station Name (الاسم بالعربي)")}</label>
                  <input
                    id="name_ar"
                    dir="rtl"
                    className="input font-arabic"
                    placeholder="مثال: محطة وقود مارينا الشرقية"
                    value={draft.nameAr}
                    onChange={e => setDraft({ ...draft, nameAr: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">{translatePortalText("Station Type")}</label>
                  <select className="input" value={draft.stationType} onChange={e => setDraft({ ...draft, stationType: e.target.value })}>
                    <option value="Marine Fuel Station">{translatePortalText("Marine Fuel Station")}</option>
                    <option value="Floating Fuel Barge">{translatePortalText("Floating Fuel Barge")}</option>
                    <option value="Dockside Fuel Pier">{translatePortalText("Dockside Fuel Pier")}</option>
                    <option value="Harbor Depot">{translatePortalText("Harbor Depot")}</option>
                  </select>
                </div>
                <div>
                  <label className="label">{translatePortalText("Direct Contact Phone")}</label>
                  <input
                    id="phone"
                    className="input font-mono"
                    placeholder="+966 50 123 4567"
                    value={draft.phone}
                    onChange={e => setDraft({ ...draft, phone: e.target.value })}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="label">{translatePortalText("Tagline & Station Overview")}</label>
                  <input
                    id="tagline"
                    className="input"
                    placeholder={translatePortalText("e.g. High-speed commercial diesel & marine gas dispensing at our fuel dock")}
                    value={draft.tagline}
                    onChange={e => setDraft({ ...draft, tagline: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">{translatePortalText("Station Email Address")}</label>
                  <input className="input" placeholder={translatePortalText("dock@marinapro.com")} value={draft.email} onChange={e => setDraft({ ...draft, email: e.target.value })} />
                </div>
                <div>
                  <label className="label">{translatePortalText("Public Website / Portal Link")}</label>
                  <input className="input" placeholder={translatePortalText("https://...")} value={draft.website} onChange={e => setDraft({ ...draft, website: e.target.value })} />
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: GPS & Map */}
          {editTab === 'location' && (
            <div className="space-y-3">
              <div id="location" className="rounded-2xl border border-amber-200/80 bg-amber-50/40 p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-deep-900 mb-1">
                  <span className="flex items-center gap-1.5"><MapPin size={14} className="text-amber-500" />{translatePortalText(" Interactive Marine Location Picker")}</span>
                  <span className="text-[11px] font-normal text-slate-500">{translatePortalText("Drag or click the map pin to update coordinates")}</span>
                </div>
                <MarinaLocationPicker
                  value={{
                    latitude: draft.latitude || DEFAULT_COORDS.latitude,
                    longitude: draft.longitude || DEFAULT_COORDS.longitude,
                    address: draft.address,
                  }}
                  onChange={(p) => {
                    const parts = p.address.split(',').map(s => s.trim()).filter(Boolean)
                    const cityGuess = parts.length >= 2 ? parts[parts.length - 2] : parts[0] ?? ''
                    setDraft(s => ({
                      ...s,
                      address: p.address,
                      city: s.city || cityGuess,
                      latitude: p.latitude,
                      longitude: p.longitude,
                    }))
                    toast(translatePortalText("Coordinates updated from map pin"), 'info')
                  }}
                  height={240}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="md:col-span-2">
                  <label className="label">{translatePortalText("Physical Address / Dock Berth *")}</label>
                  <input
                    id="address"
                    className="input"
                    placeholder={translatePortalText("Dock 4, Marina North Coast, Jeddah")}
                    value={draft.address}
                    onChange={e => setDraft({ ...draft, address: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">{translatePortalText("City / Port Region *")}</label>
                  <input
                    id="city"
                    className="input"
                    placeholder={translatePortalText("e.g. Jeddah, Yanbu, Dammam, Dubai")}
                    value={draft.city}
                    onChange={e => setDraft({ ...draft, city: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">{translatePortalText("Region / Province")}</label>
                  <input
                    id="region"
                    className="input"
                    placeholder={translatePortalText("e.g. Makkah Province, Eastern Province")}
                    value={draft.region}
                    onChange={e => setDraft({ ...draft, region: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 md:col-span-2">
                  <div>
                    <label className="label">{translatePortalText("Latitude")}</label>
                    <input
                      id="gps_lat"
                      className="input font-mono"
                      type="number"
                      step="0.000001"
                      value={draft.latitude}
                      onChange={e => setDraft({ ...draft, latitude: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                  <div>
                    <label className="label">{translatePortalText("Longitude")}</label>
                    <input
                      id="gps_lng"
                      className="input font-mono"
                      type="number"
                      step="0.000001"
                      value={draft.longitude}
                      onChange={e => setDraft({ ...draft, longitude: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: Operations */}
          {editTab === 'hours' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div id="hours" className="rounded-2xl border border-slate-100 bg-sand/40 p-3.5 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-extrabold text-deep-900">{translatePortalText("24/7 Operating Hours")}</p>
                    <p className="text-[11px] text-slate-400">{translatePortalText("Open around the clock for bunkering")}</p>
                  </div>
                  <Toggle on={draft.open24h} onChange={(v) => setDraft({ ...draft, open24h: v })} />
                </div>

              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">{translatePortalText("Marine VHF Channel")}</label>
                  <input
                    id="vhf"
                    className="input font-mono"
                    placeholder={translatePortalText("e.g. Ch 16, Ch 68, Ch 09")}
                    value={draft.vhf}
                    onChange={e => setDraft({ ...draft, vhf: e.target.value })}
                  />
                </div>
              </div>

              <div id="safety" className="rounded-2xl border border-amber-200/80 bg-amber-50/30 p-3.5 space-y-3">
                <p className="text-xs font-bold text-amber-900 uppercase tracking-wider">{translatePortalText("Environmental Safety & Spill Response Protocol")}</p>
                <div>
                  <label className="label">{translatePortalText("Emergency Response Email")}</label>
                  <input
                    className="input bg-white"
                    placeholder={translatePortalText("emergency@harborpointfuel.com")}
                    value={draft.emergencyEmail}
                    onChange={e => setDraft({ ...draft, emergencyEmail: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">{translatePortalText("Spill Response SOP & Environmental Guidelines")}</label>
                  <textarea
                    className="input bg-white h-20 py-2 resize-none text-xs"
                    placeholder={translatePortalText("Immediate containment with absorbent booms (Class 1 Marine Spill Protocol). Notify Port Authority on VHF Ch 16 immediately...")}
                    value={draft.emergencyProceduresText}
                    onChange={e => setDraft({ ...draft, emergencyProceduresText: e.target.value })}
                  />
                </div>
              </div>

              {/* Operating Hours List Manager */}
              <div className="rounded-2xl border border-slate-100 bg-sand/20 p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-extrabold text-deep-900">{translatePortalText("Custom Operating Schedule")}</p>
                    <p className="text-[11px] text-slate-400">{translatePortalText("Displayed to vessels on nautical charts")}</p>
                  </div>
                </div>

                {draft.hours.length === 0 ? (
                  <p className="text-xs text-slate-400 italic py-2">{translatePortalText("No custom schedules added (station is marked open by default).")}</p>
                ) : (
                  <div className="space-y-2">
                    {draft.hours.map((h, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 rounded-xl bg-white border border-slate-100 p-2.5 text-xs font-semibold">
                        <span className="font-extrabold text-deep-900">{h.label}</span>
                        <span className="text-slate-500 font-mono">{h.hours}</span>
                        <button
                          type="button"
                          onClick={() => setDraft({ ...draft, hours: draft.hours.filter((_, idx) => idx !== i) })}
                          className="p-1 text-slate-400 hover:text-rose-600 transition"
                          title={translatePortalText("Delete schedule")}
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <input
                    className="input !py-1.5 text-xs flex-1"
                    placeholder={translatePortalText("Schedule name (e.g. Weekdays)")}
                    value={newHourLabel}
                    onChange={e => setNewHourLabel(e.target.value)}
                  />
                  <input
                    className="input !py-1.5 text-xs flex-1"
                    placeholder={translatePortalText("Hours (e.g. 06:00 - 22:00)")}
                    value={newHourVal}
                    onChange={e => setNewHourVal(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-fuel !py-1.5 !px-3 text-xs shrink-0"
                    onClick={() => {
                      if (!newHourLabel.trim() || !newHourVal.trim()) {
                        toast(translatePortalText("Schedule name and hours are required"), 'warn')
                        return
                      }
                      setDraft({
                        ...draft,
                        hours: [...draft.hours, { label: newHourLabel.trim(), hours: newHourVal.trim() }],
                      })
                      setNewHourLabel('')
                      setNewHourVal('')
                    }}
                  >
                    <Plus size={13} />{translatePortalText(" Add")}</button>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-slate-100 pt-3">
            <p className="text-[11px] text-slate-400">{translatePortalText("Editing profile for location: ")}<strong className="text-deep-900"><bdi dir="auto">{info.name}</bdi></strong>
            </p>
            <div className="flex gap-2">
              <button className="btn-ghost" onClick={() => setEditOpen(false)}>{translatePortalText("Cancel")}</button>
              <LoadingButton loading={busy} className="btn-fuel" onClick={saveEdit}>{translatePortalText("Save Profile Changes")}</LoadingButton>
            </div>
          </div>
        </div>
      </Modal>

      {/* Add New Station Location Modal */}
      <Modal open={createStationOpen} onClose={() => setCreateStationOpen(false)} title={translatePortalText("Add New Fuel Station Location")} wide>
        <div className="space-y-4">
          <p className="text-xs font-semibold text-slate-500">{translatePortalText("Create a new floating or dockside fuel station location for your account. You can manage inventory, staff, and pricing per location.")}</p>

          <div className="rounded-2xl border border-amber-200/80 bg-amber-50/40 p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-deep-900 mb-1">
              <span className="flex items-center gap-1.5"><MapPin size={14} className="text-amber-500" />{translatePortalText(" Interactive Location Picker")}</span>
              <span className="text-[11px] font-normal text-slate-500">{translatePortalText("Click map to set Address, City, Lat & Lng")}</span>
            </div>
            <MarinaLocationPicker
              value={{
                latitude: newStationForm.latitude,
                longitude: newStationForm.longitude,
                address: newStationForm.address,
              }}
              onChange={(p) => {
                const parts = p.address.split(',').map(s => s.trim()).filter(Boolean)
                const cityGuess = parts.length >= 2 ? parts[parts.length - 2] : parts[0] ?? ''
                setNewStationForm(s => ({
                  ...s,
                  address: p.address,
                  city: s.city || cityGuess,
                  latitude: p.latitude,
                  longitude: p.longitude,
                }))
                toast(translatePortalText("Address & coordinates updated from map"), 'info')
              }}
              height={220}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="label">{translatePortalText("Station Location Name")}</label>
              <input className="input" placeholder={translatePortalText("e.g. Yas Marina Fuel Dock, Palm Jumeirah Fuel Station")} value={newStationForm.name} onChange={e => setNewStationForm(s => ({ ...s, name: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <label className="label">{translatePortalText("Address")}</label>
              <input className="input" placeholder={translatePortalText("e.g. Berth 4, East Marina Dock")} value={newStationForm.address} onChange={e => setNewStationForm(s => ({ ...s, address: e.target.value }))} />
            </div>
            <div>
              <label className="label">{translatePortalText("City")}</label>
              <input className="input" placeholder={translatePortalText("e.g. Abu Dhabi, Dubai")} value={newStationForm.city} onChange={e => setNewStationForm(s => ({ ...s, city: e.target.value }))} />
            </div>
            <div>
              <label className="label">{translatePortalText("Contact Phone")}</label>
              <input className="input" placeholder="+966 50 123 4567" value={newStationForm.contactNumber} onChange={e => setNewStationForm(s => ({ ...s, contactNumber: e.target.value }))} />
            </div>
            <div>
              <label className="label">{translatePortalText("Currency")}</label>
              <select className="input" value={newStationForm.currency} onChange={e => setNewStationForm(s => ({ ...s, currency: e.target.value }))}>
                {['SAR', 'AED', 'USD', 'EUR', 'GBP'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-ghost" onClick={() => setCreateStationOpen(false)}>{translatePortalText("Cancel")}</button>
            <LoadingButton loading={busy} className="btn-fuel" onClick={createNewStation}>{translatePortalText("Create Station Location")}</LoadingButton>
          </div>
        </div>
      </Modal>

      {/* Add License Modal */}
      <Modal open={addLicenseOpen} onClose={() => setAddLicenseOpen(false)} title={translatePortalText("Add Operating Permit / License")}>
        <div className="space-y-3">
          <div>
            <label className="label">{translatePortalText("Permit / License Name")}</label>
            <input className="input" placeholder={translatePortalText("e.g. Environmental Agency Bunkering Permit")} value={newLic.name} onChange={e => setNewLic({ ...newLic, name: e.target.value })} />
          </div>
          <div>
            <label className="label">{translatePortalText("Reference / License Number")}</label>
            <input className="input" placeholder={translatePortalText("e.g. UAE-MAR-2026-904")} value={newLic.reference} onChange={e => setNewLic({ ...newLic, reference: e.target.value })} />
          </div>
          <div>
            <label className="label">{translatePortalText("Expiration Date")}</label>
            <input className="input" type="date" value={newLic.expiresAt} onChange={e => setNewLic({ ...newLic, expiresAt: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button className="btn-ghost" onClick={() => setAddLicenseOpen(false)}>{translatePortalText("Cancel")}</button>
            <button className="btn-fuel" disabled={busy} onClick={addLicense}>{translatePortalText("Add Permit")}</button>
          </div>
        </div>
      </Modal>

      {/* Add Emergency Contact Modal */}
      <Modal open={addContactOpen} onClose={() => setAddContactOpen(false)} title={translatePortalText("Add Emergency Contact")}>
        <div className="space-y-3">
          <div>
            <label className="label">{translatePortalText("Contact Name / Entity")}</label>
            <input className="input" placeholder={translatePortalText("e.g. Coast Guard Emergency Response")} value={newContact.name} onChange={e => setNewContact({ ...newContact, name: e.target.value })} />
          </div>
          <div>
            <label className="label">{translatePortalText("Phone Number")}</label>
            <input className="input" placeholder={translatePortalText("e.g. 997 or +966 12 123 4567")} value={newContact.phone} onChange={e => setNewContact({ ...newContact, phone: e.target.value })} />
          </div>
          <div>
            <label className="label">{translatePortalText("Role / Category")}</label>
            <input className="input" placeholder={translatePortalText("e.g. Harbor Master, Fire Safety, Spill Control")} value={newContact.kind} onChange={e => setNewContact({ ...newContact, kind: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button className="btn-ghost" onClick={() => setAddContactOpen(false)}>{translatePortalText("Cancel")}</button>
            <button className="btn-fuel" disabled={busy} onClick={addEmergencyContact}>{translatePortalText("Add Emergency Contact")}</button>
          </div>
        </div>
      </Modal>

      {/* add service area modal */}
      <Modal open={addAreaOpen} onClose={() => setAddAreaOpen(false)} title={translatePortalText("Add Service Area")}>
        <div className="space-y-3">
          <div>
            <label className="label">{translatePortalText("Area / Marina Name")}</label>
            <input className="input" autoFocus placeholder={translatePortalText("e.g. Port Rashid Marine Dock")} value={newArea}
              onChange={e => setNewArea(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void addArea() }} />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button className="btn-ghost" onClick={() => setAddAreaOpen(false)}>{translatePortalText("Cancel")}</button>
            <button className="btn-fuel" disabled={busy} onClick={addArea}>{translatePortalText("Add Area")}</button>
          </div>
        </div>
      </Modal>

      {/* Parent Company Profile Modal */}
      <Modal open={parentProfileOpen} onClose={() => { setParentProfileOpen(false); setEditParentOpen(false) }} title={translatePortalText("Parent Company & Account Profile")} wide>
        <div className="space-y-5">
          <div className="flex items-center justify-between rounded-2xl bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-transparent p-4 border border-amber-500/20">
            <div className="flex items-center gap-3.5">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-amber-500 text-white font-extrabold text-2xl shadow-soft">
                🏢
              </div>
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-widest text-amber-700">{translatePortalText("Parent Provider Account")}</p>
                <h3 className="font-display text-xl font-extrabold text-deep-900">{user?.business?.businessName || user?.name || translatePortalText('Fuel Provider')}</h3>
                <p className="text-xs text-slate-500 font-semibold">{user?.email || translatePortalText('Not provided')} · {user?.role === 'fuel_provider' ? translatePortalText("Fuel Provider (Owner Account)") : translatePortalText(user?.role || 'Owner Account')}</p>
              </div>
            </div>
            <button
              onClick={() => setEditParentOpen(!editParentOpen)}
              className={`btn-ghost !py-1.5 !px-3 text-xs font-bold ${editParentOpen ? '!bg-slate-200 !text-deep-900' : '!bg-amber-500 !text-white hover:!bg-amber-600'}`}
            >
              {editParentOpen ? translatePortalText("Cancel Edit") : translatePortalText("✏️ Edit Parent Profile")}
            </button>
          </div>

          {editParentOpen ? (
            <div className="space-y-4 rounded-2xl border border-amber-200 bg-amber-50/40 p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-amber-800">{translatePortalText("Edit Parent Business Details")}</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="label">{translatePortalText("Parent Business / Company Name")}</label>
                  <input
                    className="input bg-white"
                    placeholder={translatePortalText("e.g. Red Sea Marine Fueling LLC")}
                    value={parentForm.businessName}
                    onChange={(e) => setParentForm((s) => ({ ...s, businessName: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">{translatePortalText("Account Owner Name")}</label>
                  <input
                    className="input bg-white"
                    placeholder={translatePortalText("e.g. Fuel Provider")}
                    value={parentForm.name}
                    onChange={(e) => setParentForm((s) => ({ ...s, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">{translatePortalText("Contact Phone Number")}</label>
                  <input
                    className="input bg-white"
                    placeholder="+966 50 000 0003"
                    value={parentForm.phone}
                    onChange={(e) => setParentForm((s) => ({ ...s, phone: e.target.value }))}
                  />
                </div>
                <div className="col-span-2">
                  <label className="label">{translatePortalText("Headquarters / Official Address")}</label>
                  <input
                    className="input bg-white"
                    placeholder={translatePortalText("e.g. Building 4, Marine Trade Zone, Dubai")}
                    value={parentForm.address}
                    onChange={(e) => setParentForm((s) => ({ ...s, address: e.target.value }))}
                  />
                </div>
                <div className="col-span-2">
                  <label className="label">{translatePortalText("Company Bio / Description")}</label>
                  <textarea
                    className="input bg-white h-20 py-2 resize-none"
                    placeholder={translatePortalText("Leading marine fuel supplier...")}
                    value={parentForm.description}
                    onChange={(e) => setParentForm((s) => ({ ...s, description: e.target.value }))}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-amber-200/60">
                <button className="btn-ghost" onClick={() => setEditParentOpen(false)}>{translatePortalText("Cancel")}</button>
                <LoadingButton loading={busy} className="btn-fuel" onClick={saveParentProfile}>{translatePortalText("💾 Save Parent Profile")}</LoadingButton>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-slate-100 bg-sand p-3.5 space-y-1">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">{translatePortalText("Account Owner")}</p>
                <p className="text-sm font-extrabold text-deep-900">{user?.name || 'Fuel Provider'}</p>
              </div>
              <div className="rounded-xl border border-slate-100 bg-sand p-3.5 space-y-1">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">{translatePortalText("Official Email")}</p>
                {/* Not `|| 'ops@harborpointfuel.com'` — an address at a company
                    that does not exist, shown to the operator as their own. */}
                <p className="text-sm font-extrabold text-deep-900">{user?.email || '—'}</p>
              </div>
              <div className="rounded-xl border border-slate-100 bg-sand p-3.5 space-y-1">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">{translatePortalText("Phone Number")}</p>
                {/* Not `|| '+971 4 800 3835'` — a UAE landline belonging to
                    nobody here, printed as this station's contact number. */}
                <p className="text-sm font-extrabold text-deep-900">{user?.phone || user?.business?.contactNumber || '—'}</p>
              </div>
              <div className="rounded-xl border border-slate-100 bg-sand p-3.5 space-y-1">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">{translatePortalText("Account Status")}</p>
                {/* The real onboarding state. This was the literal string
                    "Active & Verified" with a shield, so a pending, rejected or
                    suspended account was told it was verified. */}
                {(() => {
                  const st = user?.onboarding?.status
                  const label =
                    st === 'approved' ? 'Active & Verified'
                    : st === 'pending' ? 'Pending review'
                    : st === 'rejected' ? 'Rejected'
                    : st === 'suspended' ? 'Suspended'
                    : st === 'incomplete' ? 'Onboarding incomplete'
                    : '—'
                  return st === 'approved'
                    ? <p className="text-sm font-extrabold text-emerald-600 flex items-center gap-1"><ShieldCheck size={16} /> {translatePortalText(label)}</p>
                    : <p className="text-sm font-extrabold text-amber-600 flex items-center gap-1"><Clock size={16} /> {translatePortalText(label)}</p>
                })()}
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{translatePortalText("Managed Fuel Station Locations (")}{stations.length})</p>
              <button className="text-xs font-bold text-amber-600 hover:underline" onClick={() => { setParentProfileOpen(false); setCreateStationOpen(true) }}>{translatePortalText("+ Add Location")}</button>
            </div>
            <div className="space-y-2">
              {stations.map(st => (
                <div key={st.id}
                  onClick={() => { setCurrentStationId(st.id); setParentProfileOpen(false) }}
                  className={`flex items-center justify-between rounded-xl border p-3 cursor-pointer transition ${st.id === station.id ? 'border-amber-400 bg-amber-50/50 shadow-soft' : 'border-slate-100 hover:border-amber-200 bg-white'}`}>
                  <div>
                    <p className="font-extrabold text-deep-900 text-sm">📍 {st.name}</p>
                    <p className="text-xs text-slate-400">{st.address} {st.city ? `· ${st.city}` : translatePortalText("")}</p>
                  </div>
                  <FBadge dot={st.id === station.id}>{st.id === station.id ? translatePortalText("Active Location") : translatePortalText("Switch Location")}</FBadge>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <button className="btn-ghost" onClick={() => { setParentProfileOpen(false); setEditParentOpen(false) }}>{translatePortalText("Close Profile")}</button>
          </div>
        </div>
      </Modal>
      {createStationAction.modal}
    </div>
  )
}

/** First-run form shown until the provider has created their station record. */
function StationSetup({ onCreated }: { onCreated: () => Promise<void> }) {
  // Prefilled with Dubai Marina as strings before this — on the form that
  // creates a station, so the coordinates were saved unless someone noticed.
  const [form, setForm] = useState({
    name: '', address: '', city: '',
    latitude: String(DEFAULT_COORDS.latitude), longitude: String(DEFAULT_COORDS.longitude),
    contactNumber: '', currency: 'SAR',
  })
  const [showMap, setShowMap] = useState(true)
  const [busy, setBusy] = useState(false)
  const [ferrs, setFerrs] = useState<{ name?: string; address?: string }>({})
  const clrFerr = (k: keyof typeof ferrs) => setFerrs(p => ({ ...p, [k]: undefined }))

  const handlePickLocation = (p: PickedPoint) => {
    const parts = p.address.split(',').map(s => s.trim()).filter(Boolean)
    const cityGuess = parts.length >= 2 ? parts[parts.length - 2] : parts[0] ?? ''

    setForm(s => ({
      ...s,
      address: p.address,
      city: s.city || cityGuess,
      latitude: p.latitude.toFixed(6),
      longitude: p.longitude.toFixed(6),
    }))
    toast(translatePortalText("Address & coordinates updated from map"), 'info')
  }

  const submit = async () => {
    const errs: typeof ferrs = {}
    if (!form.name.trim()) errs.name = 'Station name is required'
    if (!form.address.trim()) errs.address = 'Address is required'
    if (Object.keys(errs).length) { setFerrs(errs); return }
    setFerrs({})
    setBusy(true)
    try {
      await fuelApi.saveStation({
        name: form.name.trim(),
        address: form.address.trim(),
        city: form.city.trim() || undefined,
        latitude: parseFloat(form.latitude) || DEFAULT_COORDS.latitude,
        longitude: parseFloat(form.longitude) || DEFAULT_COORDS.longitude,
        contactNumber: form.contactNumber.trim() || undefined,
        currency: form.currency,
      })
      await onCreated()
      toast(translatePortalText("Station created"))
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not create the station'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500 font-semibold">{translatePortalText("Fill out your station details or pick a point on the map below to auto-fill location fields.")}</p>
        <button type="button" onClick={() => setShowMap(!showMap)} className="btn-ghost !py-1 !px-2.5 text-xs">
          <MapPin size={13} className="text-amber-500" /> {showMap ? translatePortalText("Hide map") : translatePortalText("Show map picker")}
        </button>
      </div>

      {showMap && (
        <div className="rounded-2xl border border-amber-200/80 bg-amber-50/40 p-3.5 space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-deep-900 mb-1">
            <span className="flex items-center gap-1.5"><MapPin size={14} className="text-amber-500" />{translatePortalText(" Interactive Map Picker")}</span>
            <span className="text-[11px] font-normal text-slate-500">{translatePortalText("Search place, click map, or drag ⚓ pin to auto-fill Address, City, Lat & Lng")}</span>
          </div>
          <MarinaLocationPicker
            value={{
              latitude: parseFloat(form.latitude) || DEFAULT_COORDS.latitude,
              longitude: parseFloat(form.longitude) || DEFAULT_COORDS.longitude,
              address: form.address,
            }}
            onChange={handlePickLocation}
            height={260}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="label">{translatePortalText("Station name *")}</label>
          <input className={`input ${ferrs.name ? '!border-rose-400 !ring-2 !ring-rose-100' : ''}`} placeholder={translatePortalText("Harbor Point Fuel & Bunkering")} value={form.name}
            onChange={e => { setForm(s => ({ ...s, name: e.target.value })); clrFerr('name') }} />
          {ferrs.name && <p className="mt-1 text-xs font-semibold text-rose-500">{translatePortalText(ferrs.name)}</p>}
        </div>
        <div className="col-span-2">
          <label className="label">{translatePortalText("Address *")}</label>
          <input className={`input ${ferrs.address ? '!border-rose-400 !ring-2 !ring-rose-100' : ''}`} placeholder={translatePortalText("2 Fuel Pier Road")} value={form.address}
            onChange={e => { setForm(s => ({ ...s, address: e.target.value })); clrFerr('address') }} />
          {ferrs.address && <p className="mt-1 text-xs font-semibold text-rose-500">{translatePortalText(ferrs.address)}</p>}
        </div>
        <div><label className="label">{translatePortalText("City")}</label>
          <input className="input" placeholder={translatePortalText("e.g. Jeddah, Dammam, Yanbu")} value={form.city} onChange={e => setForm(s => ({ ...s, city: e.target.value }))} /></div>
        <div><label className="label">{translatePortalText("Phone")}</label>
          <input className="input" placeholder="+966 50 123 4567" value={form.contactNumber} onChange={e => setForm(s => ({ ...s, contactNumber: e.target.value }))} /></div>
        <div><label className="label">{translatePortalText("Latitude")}</label>
          <input className="input" type="number" step="0.000001" placeholder="21.4858" value={form.latitude} onChange={e => setForm(s => ({ ...s, latitude: e.target.value }))} /></div>
        <div><label className="label">{translatePortalText("Longitude")}</label>
          <input className="input" type="number" step="0.000001" placeholder="39.1925" value={form.longitude} onChange={e => setForm(s => ({ ...s, longitude: e.target.value }))} /></div>
        <div><label className="label">{translatePortalText("Currency")}</label>
          <select className="input" value={form.currency} onChange={e => setForm(s => ({ ...s, currency: e.target.value }))}>
            {['SAR', 'AED', 'USD', 'EUR', 'GBP'].map(c => <option key={c} value={c}>{c}</option>)}
          </select></div>
      </div>
      <LoadingButton loading={busy} className="btn-fuel w-full !justify-center !py-2.5" onClick={submit}>{translatePortalText("Create station")}</LoadingButton>
    </div>
  )
}

/**
 * The parent-company rollup — every station side by side, so an operator with
 * several locations can see the whole business at a glance instead of
 * clicking through each one.
 */
function AllStationsOverview({
  rows,
  totals,
  loading,
  currency,
  onManage,
}: {
  rows: ApiStationSummary[]
  totals: { tanks: number; lowStockTanks: number; pumps: number; staff: number; pendingBookings: number; revenueMonth: number; netMonth: number } | null
  loading: boolean
  currency: string
  onManage: (stationId: string) => void
}) {
  const money = (n: number) => `${currency} ${n.toLocaleString(portalLocale())}`

  const locCfg: TableFiltersConfig<ApiStationSummary> = useMemo(() => ({
    searchFields: (st) => [st.name, st.city],
    filters: [
      { key: 'city', label: translatePortalText("City"), get: (st) => st.city },
      {
        key: 'active',
        label: translatePortalText("Status"),
        options: [
          { value: 'active', label: translatePortalText("Active") },
          { value: 'inactive', label: translatePortalText("Inactive") },
        ],
        get: (st) => (st.isActive ? 'active' : 'inactive'),
      },
      {
        key: 'stock',
        label: translatePortalText("Tank stock"),
        options: [
          { value: 'low', label: translatePortalText("Has low tanks") },
          { value: 'ok', label: translatePortalText("All tanks healthy") },
        ],
        // The operational reason to scan this list is finding what needs refilling.
        get: (st) => ((st.lowStockTanks ?? 0) > 0 ? 'low' : 'ok'),
      },
    ],
  }), [])
  const locTf = useTableFilters(rows, locCfg)

  return (
    <div className="space-y-5">
      <FuelHeader
        title={translatePortalText("Parent Company Overview")}
        sub={translatePortalText(`Combined snapshot across ${rows.length} fuel station location${rows.length === 1 ? '' : 's'}`)}
        icon={<Building2 size={24} className="text-amber-500" />}
      />

      {totals && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Metric icon="🛢️" label={translatePortalText("Tanks (company-wide)")} value={formatPortalNumber(totals.tanks)} />
          <Metric icon="📉" label={translatePortalText("Below Reorder Point")} value={formatPortalNumber(totals.lowStockTanks)} />
          <Metric icon="⛽" label={translatePortalText("Pumps")} value={formatPortalNumber(totals.pumps)} />
          <Metric icon="👷" label={translatePortalText("Crew")} value={formatPortalNumber(totals.staff)} />
          <Metric icon="🧾" label={translatePortalText("Pending Orders")} value={formatPortalNumber(totals.pendingBookings)} />
          <Metric icon="💵" label={translatePortalText("Revenue This Month")} value={money(totals.revenueMonth)} />
        </div>
      )}

      <Section title={translatePortalText("Locations")} sub={translatePortalText("Every fuel station this account manages")}>
        {rows.length > 0 && (
          <TableToolbar state={locTf} config={locCfg} rows={rows} noun="locations"
            searchPlaceholder="Search locations by name or city..." />
        )}
        {loading ? (
          <LoadingState label={translatePortalText("Loading locations…")} rows={3} />
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">{translatePortalText("No fuel station locations yet.")}</p>
        ) : locTf.filtered.length === 0 ? (
          <NoFilterMatches noun="locations" onClear={locTf.clear} />
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full min-w-[850px] text-left text-[13px]">
              <thead>
                <tr className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  <th className="pb-2 pe-3">{translatePortalText("Location")}</th>
                  <th className="pb-2 pe-3">{translatePortalText("Status")}</th>
                  <th className="pb-2 pe-3">{translatePortalText("Tanks")}</th>
                  <th className="pb-2 pe-3">{translatePortalText("Pumps")}</th>
                  <th className="pb-2 pe-3">{translatePortalText("Crew")}</th>
                  <th className="pb-2 pe-3">{translatePortalText("Pending")}</th>
                  <th className="pb-2 pe-3">{translatePortalText("Revenue (month)")}</th>
                  <th className="pb-2 pe-3" />
                </tr>
              </thead>
              <tbody>
                {locTf.pagedRows.map((st) => (
                  <tr key={st.id} className="border-t border-slate-100">
                    <td className="py-2.5 pe-3">
                      <p className="font-extrabold text-deep-900">📍 {st.name}</p>
                      <p className="text-[11px] text-slate-400">{st.city || st.address}</p>
                    </td>
                    <td className="py-2.5 pe-3">
                      <FBadge dot={!st.isActive}>{st.isActive ? translatePortalText("Active") : translatePortalText("Inactive")}</FBadge>
                    </td>
                    <td className="py-2.5 pe-3 font-semibold text-deep-900">
                      {st.tanks}
                      {st.lowStockTanks > 0 && <span className="ms-1.5 rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-600">{st.lowStockTanks}{translatePortalText(" low")}</span>}
                    </td>
                    <td className="py-2.5 pe-3 font-semibold text-deep-900">{st.pumps}</td>
                    <td className="py-2.5 pe-3 font-semibold text-deep-900">{st.staff}</td>
                    <td className="py-2.5 pe-3 font-semibold text-deep-900">{st.pendingBookings}</td>
                    <td className="py-2.5 pe-3 font-semibold text-deep-900">{`${st.currency} ${st.revenueMonth.toLocaleString(portalLocale())}`}</td>
                    <td className="py-2.5 pe-3">
                      <button className="btn-ghost !py-1 !px-2.5 text-xs" onClick={() => onManage(st.id)}>{translatePortalText("Manage ")}<ArrowRight size={13} className="rtl:rotate-180" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <TablePagination state={locTf} noun="locations" />
      </Section>
    </div>
  )
}
