import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Anchor, Fuel, Wrench, Building2, Phone, MapPin, Check, Loader2, Hourglass, ArrowRight, ArrowLeft,
  RefreshCw, Plus, Trash2, ShieldCheck, ImageIcon, AlertTriangle, CreditCard, Sparkles,
  ScanLine, CalendarClock, BellRing, FileWarning, UploadCloud, Receipt, Info,
} from 'lucide-react'
import { useAuth, backendRoleForPortal, type PortalRole } from '../auth'
import {
  providerRegistrationApi, monetizationApi, onboardingApi, documentsApi, planInviteApi,
  type ApiProviderRegistration, type ApiChecklistIssue, type ApiDocumentChecklist,
  type ApiUploadedDocument, type SubscriptionPackageData, type CommissionPackageData,
  type PlanSummary,
} from '../api'
import { HyperpayCheckoutModal, type HyperpayCheckoutInfo, stashPendingCheckout } from '../payments/HyperpayCheckout'
import MarinaLocationPicker, { type PickedPoint } from '../components/MarinaLocationPicker'
import FileUploadInput from '../components/FileUploadInput'
import ImageGalleryUpload from '../components/ImageGalleryUpload'
import CheckboxGroup from '../components/CheckboxGroup'
import { BankDetailsFields } from '../components/BankDetailsFields'
import {
  EMPTY_BANK_DETAILS,
  validateBankDetails,
  type BankDetailsErrors,
  type BankDetailsValue,
} from '../utils/iban'
import { ToastStack, toast, FormSkeleton } from '../ui'
import { ConfirmHost, RouteProgressBar } from '../async'
import { ThemeToggle } from '../theme'
import { clearPendingInvite, getPendingInvite } from '../shared/pendingInvite'
import { FakeFillButton, useFakeFillEnabled } from '../shared/FakeFillButton'
import { fakeProvider, pick, type FakeTrade } from '../shared/fakeFill'
import { formatPortalDate, formatPortalNumber, isPortalArabic, translatePortalText } from '../i18n/runtime'


type ProviderType = 'marina_provider' | 'fuel_provider' | 'maintenance_provider'

const DEST: Record<PortalRole, string> = { marina: '/', fuel: '/fuel', maint: '/maint', boat: '/boat', admin: '/admin', agent: '/agent' }
const PORTAL_META: Record<Exclude<PortalRole, 'admin' | 'agent'>, { label: string; icon: React.ReactNode }> = {
  marina: { label: 'Marina Provider', icon: <Anchor size={18} /> },
  fuel: { label: 'Fuel Provider', icon: <Fuel size={18} /> },
  maint: { label: 'Maintenance Provider', icon: <Wrench size={18} /> },
  // Boat providers have no registration wizard here (they onboard via the
  // boatpro-provider mobile app / admin) — this entry exists only so the
  // shared PortalRole-keyed maps below stay exhaustive and type-check.
  boat: { label: 'Boat Provider', icon: <ShieldCheck size={18} /> },
}
const RIYADH: PickedPoint = { latitude: 24.7136, longitude: 46.6753, address: '' }

const EMAIL_RX = /^\S+@\S+\.\S+$/
const PHONE_RX = /^[+\d][\d\s-]{6,}$/
const emailError = (v: string) => (v.trim() && !EMAIL_RX.test(v.trim()) ? 'Enter a valid email address' : undefined)
const phoneError = (v: string) => (v.trim() && !PHONE_RX.test(v.trim()) ? 'Enter a valid phone number' : undefined)
// Saudi formats. Neither the form nor the API checked them, so "12AB" went
// through as a CR and "123" as a VAT number and only surfaced at document review.
const crError = (v: string) => (v.trim() && !/^\d{10}$/.test(v.trim()) ? 'A CR number is 10 digits' : undefined)
const vatError = (v: string) => (v.trim() && !/^3\d{13}3$/.test(v.trim()) ? 'A VAT number is 15 digits, starting and ending with 3' : undefined)

const IDENTITY_TYPES = [
  { key: 'saudi_citizen', label: 'Saudi citizen' },
  { key: 'resident_iqama', label: 'Resident (Iqama)' },
  { key: 'company', label: 'Company' },
]

const BUSINESS_CATEGORIES: Record<ProviderType, { key: string; label: string }[]> = {
  marina_provider: [
    { key: 'marina_company', label: 'Marina company' },
    { key: 'marina_owner', label: 'Marina owner' },
    { key: 'government_marina', label: 'Government marina' },
    { key: 'port_authority', label: 'Port authority' },
  ],
  fuel_provider: [
    { key: 'fuel_station', label: 'Fuel station' },
    { key: 'mobile_fuel_delivery', label: 'Mobile fuel delivery' },
    { key: 'marina_fuel_station', label: 'Marina fuel station' },
    { key: 'marine_fuel_company', label: 'Marine fuel company' },
  ],
  maintenance_provider: [
    { key: 'individual_technician', label: 'Individual technician' },
    { key: 'maintenance_company', label: 'Maintenance company' },
    { key: 'marine_workshop', label: 'Marine workshop' },
    { key: 'service_center', label: 'Service center' },
  ],
}

const WORKING_DAYS = [
  { key: 0, label: 'Sun' }, { key: 1, label: 'Mon' }, { key: 2, label: 'Tue' }, { key: 3, label: 'Wed' },
  { key: 4, label: 'Thu' }, { key: 5, label: 'Fri' }, { key: 6, label: 'Sat' },
]

/**
 * The document list itself comes from the API (`documentChecklist.required` /
 * `.optional` on `/provider-registration/me`), not from a copy kept here: it
 * depends on the provider's answer to the VAT question, and a local copy would
 * keep asking for a certificate the server had already stopped requiring.
 */
const DOC_LABELS: Record<string, string> = {
  national_id: 'National ID',
  iqama: 'Iqama (residency ID)',
  commercial_registration: 'Commercial Registration (CR)',
  vat_certificate: 'VAT Certificate',
  national_address: 'National Address',
  captain_license: 'Captain Licence',
  boat_registration: 'Boat Registration',
  boat_license: 'Boat Licence',
}

const IMAGE_CATEGORIES: Record<ProviderType, string[]> = {
  marina_provider: ['logo', 'cover', 'entrance', 'dock', 'pontoon', 'office', 'facilities', 'washrooms', 'parking', 'lounge'],
  fuel_provider: ['logo', 'cover', 'fuel_pumps', 'storage_area', 'delivery_vehicle', 'office', 'safety_equipment'],
  maintenance_provider: ['cover', 'logo', 'workshop', 'equipment', 'completed_work', 'team', 'vehicle'],
}

const STEPS_BY_TYPE: Record<ProviderType, string[]> = {
  marina_provider: ['account', 'business', 'entity', 'operatingHours', 'documents', 'bank', 'payment', 'images', 'emergency', 'review'],
  fuel_provider: ['account', 'business', 'entity', 'operatingHours', 'documents', 'bank', 'payment', 'images', 'emergency', 'review'],
  maintenance_provider: ['account', 'business', 'entity', 'operatingHours', 'documents', 'bank', 'payment', 'images', 'emergency', 'review'],
}
const STEP_TITLES: Record<string, string> = {
  account: 'Account & identity', business: 'Business details', entity: 'Details', capacity: 'Capacity',
  facilities: 'Facilities', dockPackages: 'Dock subscription', fuelOfferings: 'Fuel & services',
  fuelPricing: 'Pricing', maintenancePricing: 'Pricing', operatingHours: 'Operating hours',
  documents: 'Documents', bank: 'Bank information', payment: 'Payment model', images: 'Photos',
  emergency: 'Emergency information', review: 'Review & submit',
}

const LIMIT_LABELS: Record<string, string> = {
  maxMarinas: 'Marinas', maxPontoons: 'Docks', maxBerths: 'Berths', maxWorkers: 'Staff',
  maxBoats: 'Boats', maxTrips: 'Trips', maxCrew: 'Crew',
  maxPhotosPerBoat: 'Photos/Boat',
  maxFeaturedListings: 'Featured', maxStations: 'Stations', maxWorkersPerStation: 'Workers/Station',
  maxFuelTypes: 'Fuel Types', maxDailyOrders: 'Daily Orders', maxDeliveryVehicles: 'Vehicles',
  maxActiveJobs: 'Active Jobs',
}

export default function Onboarding() {
  const nav = useNavigate()
  const { user, portal, refreshMe } = useAuth()
  const role = (portal && portal !== 'admin' && portal !== 'agent' ? portal : 'marina') as Exclude<PortalRole, 'admin' | 'agent'>
  const providerType = backendRoleForPortal(role) as ProviderType
  const status = user?.onboarding?.status as string | undefined

  const [loading, setLoading] = useState(true)
  const [reg, setReg] = useState<ApiProviderRegistration | null>(null)
  const [issues, setIssues] = useState<ApiChecklistIssue[]>([])
  const [docChecklist, setDocChecklist] = useState<ApiDocumentChecklist>({ required: [], optional: [], uploaded: [] })
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)

  const [subPkgs, setSubPkgs] = useState<SubscriptionPackageData[]>([])
  const [commPkgs, setCommPkgs] = useState<CommissionPackageData[]>([])

  // ── local draft fields, seeded from the loaded registration ──────────────
  const [identityType, setIdentityType] = useState('')
  const [category, setCategory] = useState('')
  const [businessNameEn, setBusinessNameEn] = useState('')
  const [businessNameAr, setBusinessNameAr] = useState('')
  const [crNumber, setCrNumber] = useState('')
  const [vatNumber, setVatNumber] = useState('')
  /** "Do you have a VAT certificate?" — `undefined` until answered, which the API treats as "yes". */
  const [hasVat, setHasVat] = useState<boolean | undefined>(undefined)
  const [savingVat, setSavingVat] = useState(false)
  const [businessEmail, setBusinessEmail] = useState('')
  const [businessPhone, setBusinessPhone] = useState('')
  const [website, setWebsite] = useState('')

  const [descriptionEn, setDescriptionEn] = useState('')
  const [descriptionAr, setDescriptionAr] = useState('')
  const [region, setRegion] = useState('')
  const [city, setCity] = useState('')
  const [vhfChannel, setVhfChannel] = useState('')
  /**
   * Maintenance only: normal maintenance or a boat ramp.
   *
   * The API requires it for `maintenance_provider` — `validateRegistration`
   * refuses the submission without one — but this page never collected it, so
   * a vendor registering on the portal filled in every step and was then
   * blocked at review by a field no screen had asked them for. Empty until
   * chosen, so the Continue button can require it rather than defaulting a
   * ramp operator into the catalogue as a workshop.
   */
  const [serviceType, setServiceType] = useState<'' | 'maintenance' | 'boat_ramp'>('')
  const [point, setPoint] = useState<PickedPoint>(RIYADH)

  const [workingDays, setWorkingDays] = useState<number[]>([])
  const [openTime, setOpenTime] = useState('08:00')
  const [closeTime, setCloseTime] = useState('20:00')
  const [open24h, setOpen24h] = useState(false)

  /**
   * One object, so `BankDetailsFields` can own the inputs — the same component
   * the fuel and workshop editors use, which is what keeps the IBAN rules from
   * differing between the screens that write the same field.
   */
  const [bank, setBank] = useState<BankDetailsValue>(EMPTY_BANK_DETAILS)
  const [bankErrors, setBankErrors] = useState<BankDetailsErrors>({})

  const [billingModel, setBillingModel] = useState<'subscription' | 'commission'>('commission')
  const [subscriptionPackageId, setSubscriptionPackageId] = useState('')
  const [commissionPackageId, setCommissionPackageId] = useState('')

  /**
   * The plan this provider was invited onto, if they arrived through an admin's
   * link. When it is set there is nothing to pick: the payment step shows the
   * plan and moves on. The code is what gets saved — the backend resolves it
   * again at submit, because a hidden plan is deliberately unreachable from a
   * package id alone.
   */
  const [inviteCode, setInviteCode] = useState('')
  const [invitePlan, setInvitePlan] = useState<PlanSummary | null>(null)
  const [inviteError, setInviteError] = useState('')
  const [inviteChecking, setInviteChecking] = useState(false)

  const [emergContact, setEmergContact] = useState('')
  const [emergPerson, setEmergPerson] = useState('')
  const [emergEmail, setEmergEmail] = useState('')
  const [emergProcedures, setEmergProcedures] = useState('')
  const fakeFillOn = useFakeFillEnabled()

  const [checkoutInfo, setCheckoutInfo] = useState<HyperpayCheckoutInfo | null>(null)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  /*
    Instalments for the activation fee. `tamaraUnavailable` is the server's own
    wording for why they are not on offer; `payAgainWithTamara` re-opens this
    same payment through the same endpoint with `gateway: 'tamara'`, so the
    eligibility rules stay in one place.
  */
  const [tamaraUnavailable, setTamaraUnavailable] = useState<string | null>(null)
  const [tamaraBusy, setTamaraBusy] = useState(false)
  const [payAgainWithTamara, setPayAgainWithTamara] = useState<(() => void) | null>(null)
  const [paying, setPaying] = useState(false)

  const steps = STEPS_BY_TYPE[providerType]
  /** Only maintenance vendors choose between a workshop and a boat ramp. */
  const isMaintenance = providerType === 'maintenance_provider'

  const applyResult = (r: { registration: ApiProviderRegistration; issues: ApiChecklistIssue[]; documentChecklist: ApiDocumentChecklist }) => {
    setReg(r.registration)
    setIssues(r.issues)
    setDocChecklist(r.documentChecklist)
  }

  const reload = async () => {
    const r = await providerRegistrationApi.me()
    applyResult(r.data)
  }

  /**
   * Fill each document card in as its reading lands.
   *
   * Uploads return the moment the file is safe, because a vision pass takes
   * seconds to tens of seconds and holding four HTTP requests open for it turns
   * a slow model into a failed upload on a phone connection. So the verdicts
   * arrive here instead — polled only while something is actually in flight, and
   * stopped the moment nothing is.
   */
  const analysingCount = docChecklist.uploaded.filter(
    (d) => d.ai?.status === 'queued' || d.ai?.status === 'analyzing'
  ).length

  useEffect(() => {
    if (analysingCount === 0) return
    let alive = true
    const timer = window.setInterval(() => {
      if (!alive) return
      // A failed poll is not worth surfacing: the next tick covers it, and a
      // toast per dropped request during a flaky upload is its own problem.
      reload().catch(() => {})
    }, 2500)
    return () => { alive = false; window.clearInterval(timer) }
  }, [analysingCount])

  useEffect(() => {
    providerRegistrationApi.me()
      .then((r) => {
        applyResult(r.data)
        const d = r.data.registration
        setIdentityType(d.account?.identityType || '')
        setCategory(d.business?.category || '')
        setBusinessNameEn(d.business?.businessNameEn || '')
        setBusinessNameAr(d.business?.businessNameAr || '')
        setCrNumber(d.business?.crNumber || '')
        setVatNumber(d.business?.vatNumber || '')
        setHasVat(typeof d.business?.hasVatCertificate === 'boolean' ? d.business.hasVatCertificate : undefined)
        setBusinessEmail(d.business?.businessEmail || '')
        setBusinessPhone(d.business?.businessPhone || user?.phone || '')
        setWebsite(d.business?.website || '')
        setDescriptionEn(d.entity?.descriptionEn || '')
        setDescriptionAr(d.entity?.descriptionAr || '')
        setRegion(d.entity?.region || '')
        setCity(d.entity?.city || '')
        setVhfChannel(d.entity?.vhfChannel || d.business?.vhfChannel || '')
        setServiceType(d.entity?.serviceType || '')
        if (d.entity?.latitude && d.entity?.longitude) {
          setPoint({ latitude: d.entity.latitude, longitude: d.entity.longitude, address: d.entity.address || '' })
        }
        setWorkingDays(d.operatingHours?.workingDays || [])
        setOpenTime(d.operatingHours?.openTime || '08:00')
        setCloseTime(d.operatingHours?.closeTime || '20:00')
        setOpen24h(!!d.operatingHours?.open24h)
        setBank({
          bankName: d.bank?.bankName || '',
          accountHolderName: d.bank?.accountHolderName || '',
          iban: d.bank?.iban || '',
          accountNumber: d.bank?.accountNumber || '',
          swiftCode: d.bank?.swiftCode || '',
        })
        setBillingModel(d.payment?.billingModel || 'commission')
        setSubscriptionPackageId(d.payment?.subscriptionPackageId || '')
        setCommissionPackageId(d.payment?.commissionPackageId || '')
        // A code already on the registration wins over one sitting in session
        // storage: the saved one is what this application will actually be
        // submitted with.
        setInviteCode(d.payment?.inviteCode || getPendingInvite() || '')
        setEmergContact(d.emergency?.contactNumber || '')
        setEmergPerson(d.emergency?.responsiblePersonName || '')
        setEmergEmail(d.emergency?.email || '')
        setEmergProcedures(d.emergency?.proceduresText || '')
      })
      .catch((e) => toast(translatePortalText(e instanceof Error ? e.message : 'Could not load registration'), 'warn'))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    monetizationApi.listSubscriptionPackages(providerType).then((r) => setSubPkgs(r.data.packages.filter((p) => p.isActive !== false))).catch(() => setSubPkgs([]))
    monetizationApi.listCommissionPackages(providerType).then((r) => setCommPkgs(r.data.packages.filter((p) => p.isActive !== false))).catch(() => setCommPkgs([]))
  }, [providerType])

  useEffect(() => {
    if (!inviteCode) { setInvitePlan(null); setInviteError(''); return }
    let alive = true
    setInviteChecking(true)
    planInviteApi.resolve(inviteCode)
      .then((r) => {
        if (!alive) return
        setInvitePlan(r.data.plan)
        setInviteError('')
        // Keep `billingModel` in step with the invited plan so the bank-details
        // requirement (commission plans must be payable) still applies.
        setBillingModel(r.data.plan.kind === 'subscription' ? 'subscription' : 'commission')
      })
      .catch((e) => {
        if (!alive) return
        setInvitePlan(null)
        setInviteError(e instanceof Error ? e.message : 'This invite link is no longer valid.')
      })
      .finally(() => { if (alive) setInviteChecking(false) })
    return () => { alive = false }
  }, [inviteCode])

  useEffect(() => { if (status === 'approved' && portal) nav(DEST[portal], { replace: true }) }, [status, portal, nav])

  const save = async (key: string, data: Record<string, unknown>, opts?: { silent?: boolean }) => {
    setBusy(true)
    try {
      const r = await providerRegistrationApi.saveSection(key, data)
      applyResult(r.data)
      if (!opts?.silent) toast(translatePortalText('Saved'))
      return true
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not save'), 'warn')
      return false
    } finally {
      setBusy(false)
    }
  }

  /**
   * Saved the moment it is picked rather than on Continue, because the answer is
   * what decides whether the API still lists the certificate as required — and
   * the review step's checklist comes from there.
   */
  const answerVat = async (value: boolean) => {
    const previous = hasVat
    setHasVat(value)
    setSavingVat(true)
    if (!(await save('business', { hasVatCertificate: value }, { silent: true }))) setHasVat(previous)
    setSavingVat(false)
  }

  /**
   * Whether this provider is asked the question at all. The document rule is
   * admin-editable, so the certificate may be optional or not asked for; a "no"
   * already on file takes it off both lists, hence the second condition, and a
   * save in flight keeps the box up while the lists catch up with the answer.
   */
  const vatRequired = docChecklist.required.includes('vat_certificate')
  const asksVat = savingVat || hasVat === false || vatRequired || docChecklist.optional.includes('vat_certificate')

  /**
   * Testing only — see FakeFillButton. Fills every step at once; each step still
   * saves through its own Continue, so the API validates exactly what real input
   * would go through. The VAT question is answered too (at random, one click to
   * change) and saved at once like a real click, because it reshapes the
   * document list. Left for the tester: every email address (the business and
   * emergency ones included), photos, documents and an invite code, which
   * replaces the plan pickers.
   */
  const fakeFill = () => {
    const trade: FakeTrade =
      providerType === 'fuel_provider' ? 'fuel' : providerType === 'maintenance_provider' ? 'maintenance' : 'marina'
    const p = fakeProvider({ trade, country: 'Saudi Arabia' })
    setIdentityType(pick(IDENTITY_TYPES).key)
    setCategory(pick(BUSINESS_CATEGORIES[providerType]).key)
    setBusinessNameEn(p.businessNameEn)
    setBusinessNameAr(p.businessNameAr)
    setCrNumber(p.crNumber)
    // Both answers to the VAT question get exercised, and the number exists only
    // for a business that says it holds a certificate. Saved straight away like
    // a tap on the question would be, because it reshapes the document list.
    const vatRegistered = Math.random() < 0.5
    setVatNumber(vatRegistered ? p.vatNumber : '')
    if (asksVat) void answerVat(vatRegistered)
    setBusinessPhone(p.mobile)
    setWebsite(p.website)
    setDescriptionEn(p.descriptionEn)
    setDescriptionAr(p.descriptionAr)
    setRegion(p.location.region)
    setCity(p.location.city)
    setVhfChannel(p.vhfChannel)
    if (isMaintenance) setServiceType(pick(['maintenance', 'boat_ramp'] as const))
    setPoint({ latitude: p.location.latitude, longitude: p.location.longitude, address: p.location.address, city: p.location.city })
    setWorkingDays(p.hours.workingDays)
    setOpen24h(p.hours.open24h)
    setOpenTime(p.hours.openTime)
    setCloseTime(p.hours.closeTime)
    setBank({ ...p.bank, accountNumber: '' })
    setBankErrors({})
    if (!invitePlan) {
      const model = subPkgs.length && commPkgs.length
        ? pick(['subscription', 'commission'] as const)
        : subPkgs.length ? 'subscription' : 'commission'
      setBillingModel(model)
      const pool: { id?: string; _id?: string }[] = model === 'subscription' ? subPkgs : commPkgs
      if (pool.length) {
        const pkg = pick(pool)
        const id = pkg.id || pkg._id || ''
        if (model === 'subscription') setSubscriptionPackageId(id)
        else setCommissionPackageId(id)
      }
    }
    setEmergContact(p.emergencyPhone)
    setEmergPerson(p.emergencyPerson)
    setEmergProcedures(p.emergencyProcedures)
    toast(translatePortalText('Sample data filled in — press Continue on each step to save it'))
  }

  const goNext = (ok: boolean) => { if (ok) setStep((s) => Math.min(s + 1, steps.length - 1)) }
  const goBack = () => setStep((s) => Math.max(s - 1, 0))

  const submitFinal = async () => {
    setBusy(true)
    try {
      await providerRegistrationApi.submit()
      await refreshMe()
      // The code has done its job and been spent server-side; leaving it in
      // session storage would re-offer it on the next registration in this
      // browser.
      clearPendingInvite()
      toast(translatePortalText('Application submitted — awaiting admin approval 🎉'))
    } catch (e) {
      const details = (e as Error & { details?: ApiChecklistIssue[] }).details
      if (details?.length) setIssues(details)
      toast(translatePortalText(e instanceof Error ? e.message : 'Registration is incomplete'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  const handlePaySubscription = async (pkgId?: string, gateway?: 'tamara') => {
    if (gateway) setTamaraBusy(true)
    else setPaying(true)
    try {
      const targetId = pkgId || subscriptionPackageId || subPkgs[0]?._id || subPkgs[0]?.id
      const res = await onboardingApi.subscriptionCheckout(
        targetId,
        undefined,
        gateway ? { gateway } : undefined
      )
      /*
        Stashed against whichever reference the confirm call will carry - the
        checkout id for a card payment, Tamara's order id for instalments - so
        PaymentResult recovers the same intent either way.
      */
      const reference = res.data.orderId || res.data.checkoutId
      stashPendingCheckout(reference, {
        kind: 'onboarding_subscription',
        refId: targetId || '',
        label: `${res.data.package?.name || 'Subscription'} Activation`,
      })
      if (res.data.mode === 'tamara' && res.data.checkoutUrl) {
        window.location.href = res.data.checkoutUrl
        return
      }
      setTamaraUnavailable(res.data.tamaraUnavailable ?? null)
      setPayAgainWithTamara(() => () => void handlePaySubscription(pkgId, 'tamara'))
      setCheckoutInfo({
        checkoutId: res.data.checkoutId,
        hyperpayBaseUrl: res.data.hyperpayBaseUrl!,
      })
      setCheckoutOpen(true)
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Failed to initialize payment'), 'warn')
    } finally {
      setPaying(false)
      if (gateway) setTamaraBusy(false)
    }
  }

  if (loading) {
    return (
      <Shell>
        <FormSkeleton fields={5} />
      </Shell>
    )
  }

  // ── Pending Subscription Payment Screen ──────────────────────────────────
  if (status === 'pending_subscription_payment') {
    const selectedPkg = subPkgs.find((p) => p._id === subscriptionPackageId || p.id === subscriptionPackageId) || subPkgs[0]
    const priceText = selectedPkg
      ? `${formatPortalNumber(selectedPkg.price)} SAR`
      : `${formatPortalNumber(500, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SAR`
    const durationMonths = selectedPkg?.durationMonths ?? 1
    const durationText = `${formatPortalNumber(durationMonths)} ${translatePortalText(durationMonths === 1 ? 'Month' : 'Months')}`

    return (
      <Shell>
        <div className="mx-auto grid h-20 w-20 place-items-center rounded-3xl bg-gradient-to-br from-emerald-400 to-teal-600 text-white shadow-lg shadow-emerald-500/20">
          <ShieldCheck size={42} />
        </div>
        <h1 className="mt-6 text-center font-display text-2xl font-extrabold text-deep-900">{translatePortalText("Application Approved!")}</h1>
        <p className="mx-auto mt-2 max-w-md text-center text-sm text-slate-500">
          {translatePortalText("Congratulations")}{user?.name ? `, ${user.name.split(' ')[0]}` : ''}{translatePortalText("! The platform administrator has accepted your ")}{translatePortalText(PORTAL_META[role].label)} {translatePortalText("registration. Complete your subscription payment to activate your provider portal and go live.\r\n        ")}</p>

        {/* Selected Package Card */}
        <div className="mt-6 overflow-hidden rounded-2xl border border-emerald-100 bg-gradient-to-b from-emerald-50/50 via-white to-sand p-6 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">
                <Sparkles size={11} /> {translatePortalText("Selected Tier\r\n              ")}</span>
              <h2 className="mt-1 font-display text-lg font-bold text-deep-900">{selectedPkg?.name || translatePortalText('Standard Provider Plan')}</h2>
            </div>
            <div className="text-right">
              <p className="font-display text-2xl font-black text-emerald-600">{priceText}</p>
              <p className="text-[11px] font-semibold text-slate-400">{translatePortalText("for ")}{durationText}</p>
            </div>
          </div>

          <div className="mt-4 space-y-2 text-xs text-slate-600">
            <div className="flex items-center gap-2">
              <Check size={14} className="text-emerald-500 shrink-0" />
              <span>{translatePortalText("Full ")}{translatePortalText(PORTAL_META[role].label)} {translatePortalText("operational dashboard & tools")}</span>
            </div>
            <div className="flex items-center gap-2">
              <Check size={14} className="text-emerald-500 shrink-0" />
              <span>{translatePortalText("Live listing on customer mobile app & marketplace")}</span>
            </div>
            <div className="flex items-center gap-2">
              <Check size={14} className="text-emerald-500 shrink-0" />
              <span>{translatePortalText("Direct customer bookings, messaging, and reviews")}</span>
            </div>
            <div className="flex items-center gap-2">
              <Check size={14} className="text-emerald-500 shrink-0" />
              <span>{translatePortalText("Automated invoicing and financial analytics")}</span>
            </div>
            <div className="flex items-center gap-2">
              <Check size={14} className="text-emerald-500 shrink-0" />
              <span>{translatePortalText("Verified Provider Badge with 24/7 priority support")}</span>
            </div>
          </div>
        </div>

        {/* Payment CTA */}
        <button
          disabled={paying}
          onClick={() => handlePaySubscription(selectedPkg?._id || selectedPkg?.id)}
          className="btn-primary mt-6 w-full !justify-center !py-3.5 !text-sm !font-bold shadow-lg shadow-ocean-500/25 transition hover:shadow-ocean-500/40 disabled:opacity-50"
        >
          {paying ? (
            <>
              <Loader2 size={16} className="animate-spin" /> {translatePortalText("Preparing secure checkout…\r\n            ")}</>
          ) : (
            <>
              <CreditCard size={17} /> {translatePortalText("Pay Subscription Fee (")}{priceText})
            </>
          )}
        </button>

        <p className="mt-2 text-center text-[11px] text-slate-400">
          {translatePortalText("Secure payment processed via HyperPay · Supports ")}<span className="font-semibold text-deep-900">{translatePortalText("mada")}</span>, <span className="font-semibold text-deep-900">{translatePortalText("Visa")}</span>, <span className="font-semibold text-deep-900">{translatePortalText("Mastercard")}</span> {translatePortalText("& Apple Pay\r\n        ")}</p>

        <button
          className="btn-ghost mt-4 w-full !justify-center text-xs"
          onClick={async () => {
            await refreshMe()
            toast(translatePortalText('Account status refreshed'))
          }}
        >
          <RefreshCw size={13} /> {translatePortalText("Refresh status\r\n        ")}</button>

        <HyperpayCheckoutModal
          open={checkoutOpen}
          onClose={() => { setCheckoutOpen(false); setTamaraBusy(false) }}
          checkout={checkoutInfo}
          amountLabel={priceText}
          onPayWithTamara={payAgainWithTamara ?? undefined}
          tamaraUnavailable={tamaraUnavailable}
          tamaraBusy={tamaraBusy}
        />
      </Shell>
    )
  }

  // ── Pending screen ───────────────────────────────────────────────────────
  if (status === 'pending') {
    // Documents a reviewer has asked for again. They are the one thing a
    // provider can still act on while the application is frozen, so they come
    // first — above the reassuring timeline, which is otherwise the only thing
    // on this screen and would bury the request that is holding them up.
    const requested = docChecklist.uploaded.filter((d) => d.reminder && !d.reminder.resolvedAt)
    return (
      <Shell wide={requested.length > 0}>
        {/* This screen has its own return, so it needs its own toast host —
            the re-upload rows below raise toasts like any other upload. */}
        <ToastStack />
        {requested.length > 0 && (
          <div className="mb-7 rounded-2xl border border-rose-200 bg-rose-50/60 p-4 dark:border-rose-900/50 dark:bg-rose-950/25">
            <div className="flex items-start gap-2.5">
              <BellRing size={17} className="mt-0.5 shrink-0 text-rose-500" />
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-extrabold text-deep-900 dark:text-slate-100">
                  {translatePortalText(requested.length === 1 ? 'One document needs replacing' : 'Documents need replacing')}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {translatePortalText(requested.length === 1
                    ? 'Our review team asked for this document again. Upload a new file here and your application will continue from where you left off. You do not need to submit it again.'
                    : 'Our review team asked for these documents again. Upload new files here and your application will continue from where you left off. You do not need to submit it again.')}</p>
              </div>
            </div>
            <div className="mt-3 space-y-2.5">
              {requested.map((d) => (
                <DocRow key={d.docType} docType={d.docType} label={translatePortalText(d.label || DOC_LABELS[d.docType] || d.docType)}
                  required uploaded={d}
                  onUpload={async (f) => { await providerRegistrationApi.uploadDocument(d.docType, f); await reload() }}
                  onAcknowledge={async (id, note) => { await documentsApi.acknowledge(id, note); await reload() }} />
              ))}
            </div>
          </div>
        )}
        <div className="mx-auto grid h-20 w-20 place-items-center rounded-3xl bg-ocean-50 text-ocean-500"><Hourglass size={38} /></div>
        <h1 className="mt-6 text-center font-display text-2xl font-extrabold text-deep-900">{translatePortalText("Awaiting admin approval")}</h1>
        <p className="mx-auto mt-2 max-w-md text-center text-sm text-slate-500">
          {translatePortalText("Thanks")}{user?.name ? `, ${user.name.split(' ')[0]}` : ''}{translatePortalText("! Your ")}{translatePortalText(PORTAL_META[role].label)} {translatePortalText("application is under review.\r\n          You'll get full access as soon as an admin approves it.\r\n        ")}</p>
        <div className="mt-6 space-y-3">
          {[['Registered', true], ['Registration submitted', true], ['Admin review', 'active'], ['Go live', false]].map(([label, s]) => (
            <div key={label as string} className="flex items-center gap-3 rounded-xl bg-sand px-4 py-3">
              <span className={`grid h-6 w-6 place-items-center rounded-full ${s === true ? 'bg-emerald-500 text-white' : s === 'active' ? 'bg-ocean-500 text-white' : 'bg-slate-200'}`}>
                {s === true ? <Check size={13} /> : s === 'active' ? <Loader2 size={12} className="animate-spin" /> : null}
              </span>
              <span className={`text-sm font-semibold ${s ? 'text-deep-900' : 'text-slate-400'}`}>{translatePortalText(String(label))}</span>
            </div>
          ))}
        </div>
        <button className="btn-primary mt-6 w-full !justify-center" onClick={refreshMe}><RefreshCw size={15} /> {translatePortalText("Refresh status")}</button>
      </Shell>
    )
  }


  const key = steps[step]

  return (
    <Shell wide>
      <ToastStack />
      {/* Global async-UX hosts. `RouteProgressBar` is the top sliver for
          in-flight requests; `ConfirmHost` renders whatever `confirm()` /
          `confirmAndRun()` asked for, from anywhere in the tree. */}
      <RouteProgressBar />
      <ConfirmHost />
      {status === 'rejected' && (
        <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
          {translatePortalText("Your previous application was rejected")}{reg?.rejectionReason ? `: ${reg.rejectionReason}` : user?.onboarding?.rejectionReason ? `: ${user.onboarding.rejectionReason}` : ''}{translatePortalText(". Please review and resubmit.\r\n        ")}</div>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-ocean-400 to-ocean-600 text-white">{PORTAL_META[role].icon}</span>
        <div>
          <h1 className="font-display text-xl font-extrabold text-deep-900">{translatePortalText("Register your ")}{translatePortalText(PORTAL_META[role].label)}</h1>
          <p className="text-xs text-slate-400">{translatePortalText("Step ")}{formatPortalNumber(step + 1)} {translatePortalText("of ")}{formatPortalNumber(steps.length)} · {translatePortalText(STEP_TITLES[key])}</p>
        </div>
        {fakeFillOn && <FakeFillButton onClick={fakeFill} className="ms-auto shrink-0" />}
      </div>

      <div className="mb-6 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <motion.div className="h-full rounded-full bg-gradient-to-r from-ocean-500 to-ocean-300" animate={{ width: `${((step + 1) / steps.length) * 100}%` }} />
      </div>

      {key === 'account' && (
        <StepBody onBack={step > 0 ? goBack : undefined} onNext={async () => goNext(await save('account', { identityType }))} busy={busy} disabled={!identityType}>
          <FieldLabel>{translatePortalText("Identity type")}</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {IDENTITY_TYPES.map((o) => (
              <button key={o.key} type="button" onClick={() => setIdentityType(o.key)}
                className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition ${identityType === o.key ? 'bg-deep-900 text-white' : 'bg-white text-slate-500 ring-1 ring-slate-200 hover:ring-ocean-300'}`}>{translatePortalText(o.label)}</button>
            ))}
          </div>
          <FileUploadInput label="Profile photo" hint="A clear photo of the account holder" accept="image/*" value={reg?.account?.profilePhotoUrl}
            onUpload={async (f) => { await providerRegistrationApi.uploadProfilePhoto(f); await reload() }} />
        </StepBody>
      )}

      {key === 'business' && (
        <StepBody onBack={goBack} onNext={async () => goNext(await save('business', { category, businessNameEn, businessNameAr: businessNameAr.trim() || undefined, crNumber: crNumber.trim() || undefined, vatNumber: vatNumber.trim() || undefined, businessEmail: businessEmail.trim() || undefined, businessPhone, website: website.trim() || undefined }))} busy={busy}
          disabled={!category || !businessNameEn || !businessPhone || !!emailError(businessEmail) || !!phoneError(businessPhone) || !!crError(crNumber) || !!vatError(vatNumber)}>
          <FieldLabel>{translatePortalText("Business type")}</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {BUSINESS_CATEGORIES[providerType].map((o) => (
              <button key={o.key} type="button" onClick={() => setCategory(o.key)}
                className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition ${category === o.key ? 'bg-deep-900 text-white' : 'bg-white text-slate-500 ring-1 ring-slate-200 hover:ring-ocean-300'}`}>{translatePortalText(o.label)}</button>
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <TextField label="Business name (English)" value={businessNameEn} onChange={setBusinessNameEn} placeholder={translatePortalText("Al Waha Marine Co.")} />
            <TextField label="Business name (Arabic)" value={businessNameAr} onChange={setBusinessNameAr} placeholder="شركة الواحة البحرية" dir="rtl" />
            <TextField label="Commercial Registration (CR) number" value={crNumber} onChange={setCrNumber} placeholder={translatePortalText("1010xxxxxx")} error={crError(crNumber)} />
            <TextField label="VAT registration number (if registered)" value={vatNumber} onChange={setVatNumber} placeholder={translatePortalText("3xxxxxxxxxxxxx")} error={vatError(vatNumber)} />
            <TextField label="Business email" type="email" value={businessEmail} onChange={setBusinessEmail} placeholder={translatePortalText("info@business.sa")} error={emailError(businessEmail)} />
            <TextField label="Business phone" type="tel" value={businessPhone} onChange={setBusinessPhone} placeholder={translatePortalText("+966 5x xxx xxxx")} error={phoneError(businessPhone)} />
            <TextField label="Website (optional)" type="url" value={website} onChange={setWebsite} placeholder={translatePortalText("https://")} />
          </div>
          {/*
            The VAT certificate upload that used to sit here has been removed.
            It wrote to `business.vatDocUrl`, which nothing on the platform ever
            read — not the admin console, not the approval gate, not an export —
            while the Documents step three screens later asked for the same
            certificate again as a required document that is actually reviewed.
            Providers were uploading it twice and having it looked at once.
          */}
          <p className="flex items-center gap-1.5 text-xs text-slate-400">
            <ShieldCheck size={13} /> {translatePortalText("Your VAT certificate, CR and ID are collected in the Documents step, where we check them for you.\r\n          ")}</p>
        </StepBody>
      )}

      {key === 'entity' && (
        <StepBody onBack={goBack} onNext={async () => goNext(await save('entity', {
          nameEn: businessNameEn, nameAr: businessNameAr, descriptionEn, descriptionAr, region, city, vhfChannel, address: point.address, latitude: point.latitude, longitude: point.longitude,
          ...(isMaintenance && serviceType ? { serviceType } : {}),
        }))} busy={busy} disabled={!point.address || !city || (isMaintenance && !serviceType)}>
          {/* First in the step, because it changes what the vendor is: a ramp
              launches and retrieves boats, a workshop repairs them, and boaters
              filter the catalogue on this. */}
          {isMaintenance && (
            <div className="rounded-2xl border border-violet-200 bg-violet-50/50 p-4 dark:border-violet-900/50 dark:bg-violet-950/20">
              <FieldLabel>
                <Wrench size={13} className="me-1 inline text-violet-500" />{translatePortalText("Service type ")}<span className="text-rose-500">*</span>
              </FieldLabel>
              <select
                className="input"
                value={serviceType}
                onChange={(e) => setServiceType(e.target.value as 'maintenance' | 'boat_ramp')}
              >
                <option value="">{translatePortalText("Select a service type…")}</option>
                <option value="maintenance">{translatePortalText("Normal maintenance")}</option>
                <option value="boat_ramp">{translatePortalText("Boat’s ramp")}</option>
              </select>
              <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                {serviceType === 'boat_ramp'
                  ? translatePortalText('Launching and retrieving boats to and from the water by trailer.')
                  : serviceType === 'maintenance'
                    ? translatePortalText('Repairs, servicing and inspections — the trades your technicians hold.')
                    : translatePortalText('Boaters filter by this, so pick the one you actually operate. It cannot be guessed for you.')}
              </p>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div><FieldLabel>{translatePortalText("Description (English)")}</FieldLabel><textarea className="input min-h-[70px]" value={descriptionEn} onChange={(e) => setDescriptionEn(e.target.value)} /></div>
            <div><FieldLabel>{translatePortalText("Description (Arabic)")}</FieldLabel><textarea className="input min-h-[70px]" dir="rtl" value={descriptionAr} onChange={(e) => setDescriptionAr(e.target.value)} /></div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <TextField label="Region" value={region} onChange={setRegion} placeholder={translatePortalText("Makkah")} />
            <TextField label="City" value={city} onChange={setCity} placeholder={translatePortalText("Jeddah")} />
            <TextField label="VHF Channel / Frequency" value={vhfChannel} onChange={setVhfChannel} placeholder={translatePortalText("Ch 16 / 68 (156.8 MHz)")} />
          </div>
          <div>
            <FieldLabel><MapPin size={13} className="me-1 inline text-ocean-500" />{translatePortalText("Location")}</FieldLabel>
            <MarinaLocationPicker value={point} onChange={setPoint} height={260} />
          </div>
        </StepBody>
      )}

      {key === 'operatingHours' && (
        <StepBody onBack={goBack} onNext={async () => goNext(await save('operatingHours', { workingDays, openTime: open24h ? undefined : openTime, closeTime: open24h ? undefined : closeTime, open24h }))} busy={busy} disabled={workingDays.length === 0 || (!open24h && (!openTime || !closeTime))}>
          <FieldLabel>{translatePortalText("Working days")}</FieldLabel>
          <CheckboxGroup options={WORKING_DAYS.map((d) => ({ key: String(d.key), label: translatePortalText(d.label) }))} value={workingDays.map(String)} onChange={(v) => setWorkingDays(v.map(Number))} columns={7} />
          <div className="flex items-center gap-2">
            <input type="checkbox" id="open24h" checked={open24h} onChange={(e) => setOpen24h(e.target.checked)} className="h-4 w-4" />
            <label htmlFor="open24h" className="text-sm font-semibold text-deep-900">{translatePortalText("Open 24 hours")}</label>
          </div>
          {!open24h && (
            <div className="grid gap-4 md:grid-cols-2">
              <TextField label="Opening time" type="time" value={openTime} onChange={setOpenTime} />
              <TextField label="Closing time" type="time" value={closeTime} onChange={setCloseTime} />
            </div>
          )}
        </StepBody>
      )}

      {key === 'documents' && (
        <StepBody onBack={goBack} onNext={() => goNext(true)} busy={busy} disabled={asksVat && hasVat === undefined}>
          <div className="flex items-start gap-2 rounded-xl border border-teal-200 bg-teal-50/60 px-3 py-2.5 dark:border-teal-900/50 dark:bg-teal-950/30">
            <ScanLine size={15} className="mt-0.5 shrink-0 text-teal-600" />
            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              {translatePortalText("Upload the documents needed to verify your business. Each one is read automatically — we check the\r\n              expiry date, the details, and that it is the document we asked for, and tell you straight away if\r\n              something looks wrong.\r\n            ")}</p>
          </div>
          {asksVat && (
            <VatQuestion value={hasVat} onChange={answerVat} disabled={busy}>
              <DocRow docType="vat_certificate" label={DOC_LABELS.vat_certificate} required={vatRequired}
                uploaded={docChecklist.uploaded.find((u) => u.docType === 'vat_certificate')}
                onUpload={async (f) => { await providerRegistrationApi.uploadDocument('vat_certificate', f); await reload() }}
                onAcknowledge={async (id, note) => { await documentsApi.acknowledge(id, note); await reload() }} />
            </VatQuestion>
          )}
          <div className="space-y-2.5">
            {/* The certificate only ever appears inside the question above, so
                it cannot be uploaded (or look demanded) before they answer. */}
            {[...docChecklist.required.map((d) => ({ d, required: true })), ...docChecklist.optional.map((d) => ({ d, required: false }))]
              .filter(({ d }) => d !== 'vat_certificate')
              .map(({ d, required }) => (
                <DocRow key={d} docType={d} label={DOC_LABELS[d] || d} required={required}
                  uploaded={docChecklist.uploaded.find((u) => u.docType === d)}
                  onUpload={async (f) => { await providerRegistrationApi.uploadDocument(d, f); await reload() }}
                  onAcknowledge={async (id, note) => { await documentsApi.acknowledge(id, note); await reload() }} />
              ))}
          </div>
          {asksVat && hasVat === undefined && (
            <p className="text-[11px] text-slate-400">{translatePortalText("Tell us whether you have a VAT certificate to continue.")}</p>
          )}
        </StepBody>
      )}

      {key === 'bank' && (
        <StepBody
          onBack={goBack}
          /**
           * Validated here rather than left to the API, because this step is
           * skippable: an operator who typed a bad IBAN and got a 400 back would
           * reasonably read it as "this optional step is broken" and move on,
           * leaving a wrong fallback payout destination on file.
           */
          onNext={async () => {
            const errors = validateBankDetails(bank)
            setBankErrors(errors)
            if (Object.keys(errors).length) return
            goNext(await save('bank', {
              bankName: bank.bankName || undefined,
              accountHolderName: bank.accountHolderName || undefined,
              iban: bank.iban || undefined,
              swiftCode: bank.swiftCode || undefined,
            }))
          }}
          busy={busy}
        >
          <p className="text-xs text-slate-500">
            {translatePortalText("Optional. BoatPro settles payouts with you directly, so you can add or change your bank details later.")}</p>
          <BankDetailsFields value={bank} onChange={setBank} errors={bankErrors} />
        </StepBody>
      )}

      {key === 'payment' && invitePlan && (
        /* An invited provider has no plan to choose — that is the whole point
           of the link they arrived through. Showing them the pickers anyway
           would invite them to pick something the backend then overrides. */
        <StepBody onBack={goBack} onNext={async () => goNext(await save('payment', {
          inviteCode,
          billingModel: invitePlan.kind === 'subscription' ? 'subscription' : 'commission',
        }))} busy={busy}>
          <div className="rounded-2xl border-2 border-amber-300 bg-amber-50/70 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">{translatePortalText("Your invited plan")}</p>
                <p className="mt-1 font-display text-lg font-extrabold text-deep-900">{invitePlan.name}</p>
              </div>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-500 text-white"><Check size={16} /></span>
            </div>

            {invitePlan.kind === 'fixed_fee' ? (
              <>
                <p className="mt-4 font-display text-3xl font-extrabold text-amber-700">
                  {invitePlan.currency} {formatPortalNumber(invitePlan.feePerTransaction)}
                  <span className="ms-1 text-sm font-bold text-amber-700 dark:text-amber-300">{translatePortalText("per transaction")}</span>
                </p>
                <div className="mt-3 space-y-1.5 text-[12px] font-semibold text-amber-800/90 dark:text-amber-200">
                  <p className="flex items-center gap-1.5"><Check size={13} className="shrink-0" /> {translatePortalText("No commission percentage")}</p>
                  <p className="flex items-center gap-1.5"><Check size={13} className="shrink-0" /> {translatePortalText("No monthly subscription")}</p>
                  <p className="flex items-center gap-1.5"><Check size={13} className="shrink-0" /> {translatePortalText("Never more than the booking itself")}</p>
                  <p className="flex items-center gap-1.5"><Check size={13} className="shrink-0" /> {translatePortalText("Paid out by monthly bank transfer")}</p>
                </div>
              </>
            ) : (
              <p className="mt-4 font-display text-xl font-extrabold text-amber-700">{invitePlan.label}</p>
            )}

            <p className="mt-4 text-[11px] text-amber-800/80 dark:text-amber-200">
              {translatePortalText("Invite code ")}<code className="rounded bg-white/70 px-1.5 py-0.5 font-extrabold">{inviteCode}</code>
            </p>
          </div>

          <button type="button" onClick={() => { setInviteCode(''); clearPendingInvite() }}
            className="mt-1 text-[11px] font-semibold text-slate-400 underline hover:text-slate-600">
            {translatePortalText("Not the right plan? Choose one yourself instead\r\n          ")}</button>
        </StepBody>
      )}

      {key === 'payment' && !invitePlan && (
        <StepBody onBack={goBack} onNext={async () => goNext(await save('payment', {
          billingModel, subscriptionPackageId: billingModel === 'subscription' ? subscriptionPackageId || undefined : undefined,
          commissionPackageId: billingModel === 'commission' ? commissionPackageId || undefined : undefined,
        }))} busy={busy} disabled={billingModel === 'subscription' ? !subscriptionPackageId : !commissionPackageId}>
          {/* A provider who was sent a link but has not opened it yet can still
              enter the code by hand. */}
          <div className="rounded-2xl bg-sand px-4 py-3 ring-1 ring-slate-100">
            <label className="label !mb-1.5">{translatePortalText("Have an invite code?")}</label>
            <div className="flex gap-2">
              <input className="input font-bold uppercase" placeholder={translatePortalText("SP-XXXXXXXX")} value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())} />
              {inviteChecking && <span className="grid w-9 shrink-0 place-items-center"><Loader2 size={16} className="animate-spin text-slate-400" /></span>}
            </div>
            {!!inviteError && <p className="mt-1.5 text-[11px] font-semibold text-rose-600">{translatePortalText(inviteError)}</p>}
            <p className="mt-1.5 text-[11px] text-slate-400">{translatePortalText("A code from the BoatPro team puts you on an agreed plan — leave it blank to choose one below.")}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {(['subscription', 'commission'] as const).map((m) => (
              <button key={m} type="button" onClick={() => setBillingModel(m)}
                className={`rounded-2xl border-2 p-4 text-left transition ${billingModel === m ? 'border-ocean-400 bg-ocean-50/60' : 'border-slate-200 hover:border-ocean-200'}`}>
                <p className="font-display text-[15px] font-extrabold text-deep-900">{translatePortalText(m === 'subscription' ? 'Subscription' : 'Commission')}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">{translatePortalText(m === 'subscription' ? 'Fixed plan, lower per-booking fees' : 'No monthly fee, pay per booking')}</p>
              </button>
            ))}
          </div>

          {billingModel === 'subscription' ? (
            <div className="grid gap-3 sm:grid-cols-3">
              {subPkgs.map((p) => {
                const on = subscriptionPackageId === (p.id || p._id)
                const durationMonths = p.durationMonths ?? 1
                return (
                  <button key={p.id || p._id} type="button" onClick={() => setSubscriptionPackageId(p.id || p._id || '')}
                    className={`relative rounded-2xl border-2 p-4 text-left transition ${on ? 'border-ocean-400 shadow-lift bg-ocean-50/20' : 'border-slate-200 hover:border-ocean-200 bg-white'}`}>
                    {on && <span className="absolute end-3 top-3 grid h-5 w-5 place-items-center rounded-full bg-ocean-500 text-white"><Check size={12} /></span>}
                    <p className="font-display text-base font-extrabold text-deep-900">{p.name}</p>
                    <p className="mt-1 font-display text-lg font-extrabold text-ocean-600">{translatePortalText("SAR ")}{formatPortalNumber(p.price)}<span className="text-[11px] font-semibold text-slate-400">/{formatPortalNumber(durationMonths)} {translatePortalText(durationMonths === 1 ? 'month' : 'months')}</span></p>

                    {p.description && <p className="mt-2 text-xs text-slate-500 leading-relaxed">{p.description}</p>}

                    <div className="mt-3 border-t border-slate-100 pt-2.5 text-xs text-slate-500 space-y-1">
                      <p className="flex items-center gap-1.5 text-[11px]"><Check size={12} className="text-emerald-500 shrink-0" /> {translatePortalText("0% platform commission")}</p>
                      {/* Disclosed, not promised away: the card acquirer's fee on online
                          payments still comes out of the payout ("100% to wallet" was
                          shown here while 3.5% was deducted from every card booking). */}
                      <p className="flex items-center gap-1.5 text-[11px] text-slate-400"><Info size={12} className="shrink-0" /> {translatePortalText("Card-processing fees apply to online payments")}</p>
                    </div>

                    {p.limits && Object.keys(p.limits).length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1 border-t border-slate-100 pt-2.5">
                        {Object.entries(p.limits).map(([k, v]) => (
                          <span key={k} className="rounded-md bg-ocean-50 px-2 py-0.5 text-[10px] font-bold text-ocean-700">
                            {translatePortalText(LIMIT_LABELS[k] || k)}: {v === null ? '∞' : formatPortalNumber(v)}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                )
              })}
              {subPkgs.length === 0 && <p className="text-xs text-slate-400">{translatePortalText("No subscription packages are configured yet — contact support.")}</p>}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              {commPkgs.map((p) => {
                const on = commissionPackageId === (p.id || p._id)
                return (
                  <button key={p.id || p._id} type="button" onClick={() => setCommissionPackageId(p.id || p._id || '')}
                    className={`relative rounded-2xl border-2 p-4 text-left transition ${on ? 'border-ocean-400 shadow-lift bg-ocean-50/20' : 'border-slate-200 hover:border-ocean-200 bg-white'}`}>
                    {on && <span className="absolute end-3 top-3 grid h-5 w-5 place-items-center rounded-full bg-ocean-500 text-white"><Check size={12} /></span>}
                    <p className="font-display text-base font-extrabold text-deep-900">{p.name}</p>
                    <p className="mt-1 font-display text-lg font-extrabold text-ocean-600">
                      {/* "per transaction" everywhere, so one plan is not
                          described two different ways across screens. */}
                      {p.commissionType === 'fixed' ? `SAR ${formatPortalNumber(p.fixedAmountSar)} ${translatePortalText('per transaction')}` : `${formatPortalNumber(p.commissionPercentage)}${isPortalArabic() ? '٪' : '%'}`}
                    </p>

                    {p.description && <p className="mt-2 text-xs text-slate-500 leading-relaxed">{p.description}</p>}

                    <div className="mt-3 border-t border-slate-100 pt-2.5 text-xs text-slate-500 space-y-1">
                      <p className="flex items-center gap-1.5 text-[11px]"><Check size={12} className="text-emerald-500 shrink-0" /> {translatePortalText("Pay per booking")}</p>
                      <p className="flex items-center gap-1.5 text-[11px]"><Check size={12} className="text-emerald-500 shrink-0" /> {translatePortalText("Weekly bank transfer payout")}</p>
                      {p.commissionType === 'fixed' && (
                        <p className="flex items-center gap-1.5 text-[11px]"><Check size={12} className="text-emerald-500 shrink-0" /> {translatePortalText("Flat amount — no commission percentage")}</p>
                      )}
                    </div>

                    {p.limits && Object.keys(p.limits).length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1 border-t border-slate-100 pt-2.5">
                        {Object.entries(p.limits).map(([k, v]) => (
                          <span key={k} className="rounded-md bg-teal-50 px-2 py-0.5 text-[10px] font-bold text-teal-700">
                            {translatePortalText(LIMIT_LABELS[k] || k)}: {v === null ? '∞' : formatPortalNumber(v)}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                )
              })}
              {commPkgs.length === 0 && <p className="text-xs text-slate-400">{translatePortalText("No commission packages are configured yet — contact support.")}</p>}
            </div>
          )}
        </StepBody>
      )}

      {key === 'images' && (
        // Same 5–20 rule the API applies at submit; without it the step waved
        // 4 photos through and the miss only surfaced on the review page.
        <StepBody onBack={goBack} onNext={() => goNext(true)} busy={busy}
          disabled={(reg?.images?.length ?? 0) < 5 || (reg?.images?.length ?? 0) > 20}>
          <p className="text-xs text-slate-500 flex items-center gap-1"><ImageIcon size={13} /> {translatePortalText("Upload 5–20 photos of your ")}{entityLabel(providerType).toLowerCase()}.</p>
          <ImageGalleryUpload images={reg?.images || []} categories={IMAGE_CATEGORIES[providerType]}
            onUpload={async (files, cat) => { await providerRegistrationApi.uploadImages(files, cat); await reload() }}
            onDelete={async (i) => { await providerRegistrationApi.deleteImage(i); await reload() }} />
        </StepBody>
      )}

      {key === 'emergency' && (
        <StepBody onBack={goBack} onNext={async () => goNext(await save('emergency', { contactNumber: emergContact, responsiblePersonName: emergPerson, email: emergEmail.trim() || undefined, proceduresText: emergProcedures }))} busy={busy}
          disabled={!emergContact || !emergPerson || !!emailError(emergEmail) || !!phoneError(emergContact)}>
          <div className="grid gap-4 md:grid-cols-2">
            <TextField label="Emergency contact number" type="tel" value={emergContact} onChange={setEmergContact} error={phoneError(emergContact)} />
            <TextField label="Harbor master / responsible person" value={emergPerson} onChange={setEmergPerson} />
            <TextField label="Emergency email" type="email" value={emergEmail} onChange={setEmergEmail} error={emailError(emergEmail)} />
          </div>
          <div><FieldLabel>{translatePortalText("Emergency procedures")}</FieldLabel><textarea className="input min-h-[90px]" value={emergProcedures} onChange={(e) => setEmergProcedures(e.target.value)} /></div>
        </StepBody>
      )}

      {key === 'review' && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <ReviewRow label="Business name" value={businessNameEn} />
            <ReviewRow label="City" value={city} />
            {/* The field's own placeholder ("Ch 16 / 68 (156.8 MHz)") has people type the
                "Ch", so only add it when they did not — it read "Ch Ch 16 / 68". */}
            <ReviewRow label="VHF Radio Channel" value={vhfChannel ? (/^\s*ch\b/i.test(vhfChannel) ? vhfChannel : `Ch ${vhfChannel}`) : translatePortalText('Not set')} />
            <ReviewRow label="Payment model" value={invitePlan ? translatePortalText(invitePlan.label) : translatePortalText(billingModel === 'subscription' ? 'Subscription' : 'Commission')} />
            <ReviewRow label="Documents uploaded" value={`${formatPortalNumber(docChecklist.uploaded.length)} / ${formatPortalNumber(docChecklist.required.length + docChecklist.optional.length)}`} />
            {asksVat && <ReviewRow label="VAT certificate" value={hasVat === undefined ? translatePortalText('Not answered') : hasVat ? translatePortalText('Yes') : translatePortalText('No — not required')} />}
            <ReviewRow label="Photos" value={`${formatPortalNumber((reg?.images || []).length)} ${translatePortalText('uploaded')}`} />
          </div>

          {issues.length > 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="mb-2 flex items-center gap-2 text-sm font-bold text-amber-700"><AlertTriangle size={16} /> {formatPortalNumber(issues.length)} {translatePortalText(issues.length === 1 ? 'item left to complete' : 'items left to complete')}</p>
              <ul className="space-y-1">
                {issues.map((i, idx) => (
                  <li key={idx} className="flex items-center justify-between text-xs text-amber-700">
                    <span>{translatePortalText(i.message)}</span>
                    <button className="font-bold underline" onClick={() => { const idx2 = steps.indexOf(i.section); if (idx2 >= 0) setStep(idx2) }}>{translatePortalText("Fix")}</button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-700">
              <ShieldCheck size={16} /> {translatePortalText("Everything looks complete — ready to submit.\r\n            ")}</div>
          )}

          <div className="flex gap-3 pt-2">
            <button className="btn-ghost !px-4" onClick={goBack}><ArrowLeft size={16} /> {translatePortalText("Back")}</button>
            <button className="btn-primary flex-1 !justify-center disabled:opacity-60" disabled={busy} onClick={submitFinal}>
              {busy ? <><Loader2 size={15} className="animate-spin" /> {translatePortalText("Submitting…")}</> : <>{translatePortalText("Submit for approval ")}<Check size={16} /></>}
            </button>
          </div>
        </div>
      )}
    </Shell>
  )
}

function entityLabel(t: ProviderType) {
  if (t === 'marina_provider') return 'Marina'
  if (t === 'fuel_provider') return 'Fuel station'
  return 'Workshop'
}

/**
 * "Do you have a VAT certificate?" — the first thing on the Documents step.
 *
 * A business under the ZATCA threshold holds no VAT certificate, so the step
 * used to be impossible to finish for the smallest operators. Only a "yes" puts
 * the certificate on their list, and its upload slot (`children`) sits inside
 * this box so the question and the file it asks for read as one thing.
 */
function VatQuestion({ value, onChange, disabled, children }: {
  value: boolean | undefined
  onChange: (hasVatCertificate: boolean) => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
      <div className="flex items-start gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ocean-50 text-ocean-600 dark:bg-ocean-950/40 dark:text-ocean-300">
          <Receipt size={16} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-deep-900 dark:text-slate-100">
            {translatePortalText("Do you have a VAT registration certificate? ")}<span className="text-rose-500">*</span>
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            {translatePortalText("Issued by ZATCA to VAT-registered businesses. If you have one, you will need to upload it.\r\n          ")}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {([[true, 'Yes, I have one'], [false, 'No']] as const).map(([v, label]) => (
          <button key={String(v)} type="button" disabled={disabled} aria-pressed={value === v} onClick={() => onChange(v)}
            className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition disabled:opacity-60 ${value === v ? 'bg-deep-900 text-white' : 'bg-white text-slate-500 ring-1 ring-slate-200 hover:ring-ocean-300'}`}>
            {translatePortalText(label)}
          </button>
        ))}
      </div>
      {value === true && <div className="mt-3">{children}</div>}
      {value === false && <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{translatePortalText("No problem — you can continue without one.")}</p>}
    </div>
  )
}

function StepBody({ children, onBack, onNext, busy, disabled }: { children: React.ReactNode; onBack?: () => void; onNext: () => void; busy?: boolean; disabled?: boolean }) {
  return (
    <div className="space-y-4">
      {children}
      <div className="flex gap-3 pt-2">
        {onBack && <button type="button" className="btn-ghost !px-4" onClick={onBack}><ArrowLeft size={16} /> {translatePortalText("Back")}</button>}
        <button type="button" className="btn-primary flex-1 !justify-center disabled:opacity-60" disabled={busy || disabled} onClick={onNext}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <>{translatePortalText("Continue ")}<ArrowRight size={16} /></>}
        </button>
      </div>
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="label block">{typeof children === 'string' ? translatePortalText(children) : children}</label>
}

function TextField({ label, value, onChange, placeholder, type = 'text', dir, error }: { label?: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; dir?: 'rtl' | 'ltr'; error?: string }) {
  return (
    <div>
      {label && <FieldLabel>{label}</FieldLabel>}
      <input className={`input ${error ? '!border-rose-300 !ring-rose-100' : ''}`} type={type} dir={dir} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      {error && <p className="mt-1 text-[11px] font-semibold text-rose-500">{translatePortalText(error)}</p>}
    </div>
  )
}

function ReviewRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-xl bg-sand px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{translatePortalText(label)}</p>
      <p className="truncate text-sm font-semibold text-deep-900">{value || '—'}</p>
    </div>
  )
}

/**
 * The verdict palette.
 *
 * Three states, because a signup form can only offer three responses: carry on,
 * have a look at this, and this will not do. Everything the analysis knows
 * beyond that lives in the admin console, where somebody is paid to read it.
 */
const VERDICT_TONE = {
  clear: {
    ring: 'border-emerald-200 dark:border-emerald-900/50',
    wash: 'bg-emerald-50/70 dark:bg-emerald-950/25',
    text: 'text-emerald-700 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  warning: {
    ring: 'border-amber-200 dark:border-amber-900/50',
    wash: 'bg-amber-50/70 dark:bg-amber-950/25',
    text: 'text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  critical: {
    ring: 'border-rose-200 dark:border-rose-900/50',
    wash: 'bg-rose-50/70 dark:bg-rose-950/25',
    text: 'text-rose-700 dark:text-rose-300',
    dot: 'bg-rose-500',
  },
} as const

/** Flags whose whole point is that a person decides — the server refuses to waive these too. */
// Kept in step with the API's UNWAIVABLE_FLAGS: `wrong_document` is a confident
// reading of a different document — replace it, don't acknowledge it.
const UNWAIVABLE = ['fraud_risk', 'duplicate', 'wrong_document']

const fmtDocDate = (iso?: string) =>
  iso ? formatPortalDate(iso, { day: 'numeric', month: 'short', year: 'numeric' }) : ''

/**
 * One document slot, and everything the platform has concluded about what is in it.
 *
 * Deliberately loud when something is wrong and quiet when nothing is. A provider
 * filling this step in has five of these on screen; four of them being a single
 * green line is what makes the fifth one readable.
 */
function DocRow({ label, required, uploaded, onUpload, onAcknowledge }: {
  docType: string; label: string; required: boolean
  uploaded?: ApiUploadedDocument
  onUpload: (file: File) => Promise<void>
  onAcknowledge: (id: string, note?: string) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [waiving, setWaiving] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const ai = uploaded?.ai
  const analysing = !!uploaded && (ai?.status === 'queued' || ai?.status === 'analyzing')
  const severity = analysing ? 'clear' : (ai?.severity ?? 'clear')
  const tone = VERDICT_TONE[severity]
  const flags = ai?.flags ?? []
  const waivable = flags.length > 0 && !flags.some((f) => UNWAIVABLE.includes(f.code))
  const needsAttention = !analysing && severity !== 'clear' && !uploaded?.acknowledgedAt
  const pendingReminder = uploaded?.reminder && !uploaded.reminder.resolvedAt

  // Expiry gets its own line rather than sitting in the field list: it is the one
  // extracted value that decides whether the document is any use at all.
  const expiry = uploaded?.expiresAt
  const otherFields = (ai?.fields ?? []).filter((f) => f.key !== 'expiryDate' && f.value)

  const pick = async () => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = 'image/*,application/pdf'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      setBusy(true)
      try { await onUpload(file); toast(translatePortalText(`${label} uploaded — checking it now`)) }
      catch (e) { toast(translatePortalText(e instanceof Error ? e.message : 'Upload failed'), 'warn') }
      finally { setBusy(false) }
    }
    input.click()
  }

  const waive = async () => {
    if (!uploaded) return
    setWaiving(true)
    try { await onAcknowledge(uploaded.id); toast(translatePortalText('Noted — you can continue with this document')) }
    catch (e) { toast(translatePortalText(e instanceof Error ? e.message : 'Could not save that'), 'warn') }
    finally { setWaiving(false) }
  }

  const showDetail = !!uploaded && !analysing && (flags.length > 0 || !!expiry || otherFields.length > 0)

  return (
    <div className={`overflow-hidden rounded-xl border transition-colors ${uploaded ? tone.ring : 'border-slate-200 dark:border-slate-700'} ${needsAttention || pendingReminder ? tone.wash : ''}`}>
      {/* ── header: what we asked for, and the button to satisfy it ────────── */}
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-deep-900 dark:text-slate-100">
            {translatePortalText(label)} {required && <span className="text-rose-500">*</span>}
          </p>
          <div className="mt-0.5 flex items-center gap-1.5">
            {analysing ? (
              <>
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-400 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-teal-500" />
                </span>
                <p className="text-[11px] font-medium text-teal-600 dark:text-teal-400">{translatePortalText("Reading your document…")}</p>
              </>
            ) : uploaded ? (
              <>
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} />
                <p className={`truncate text-[11px] font-medium ${tone.text}`}>
                  {translatePortalText(uploaded.acknowledgedAt && severity !== 'clear'
                    ? 'You chose to continue with this document'
                    : (ai?.headline || `${translatePortalText('Uploaded')} — ${translatePortalText(uploaded.status.charAt(0).toUpperCase() + uploaded.status.slice(1))}`))}
                </p>
              </>
            ) : (
              <p className="text-[11px] text-slate-400">{translatePortalText(required ? 'Required' : 'Optional')}</p>
            )}
          </div>
        </div>
        <button type="button" onClick={pick} disabled={busy}
          className={`btn-ghost !py-1.5 !px-3 text-xs shrink-0 ${uploaded && severity === 'clear' ? '!text-emerald-600' : ''}`}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : uploaded ? <Check size={13} /> : null} {translatePortalText(uploaded ? 'Replace' : 'Upload')}
        </button>
      </div>

      {/* ── a reviewer has asked for this one again ─────────────────────────── */}
      {pendingReminder && (
        <div className="mx-3 mb-3 rounded-lg border border-rose-200 bg-white/70 p-3 dark:border-rose-900/50 dark:bg-slate-900/40">
          <div className="flex items-start gap-2">
            <BellRing size={14} className="mt-0.5 shrink-0 text-rose-500" />
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wide text-rose-600 dark:text-rose-400">{translatePortalText("Our team asked for this again")}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{translatePortalText(uploaded!.reminder!.message)}</p>
              <button type="button" onClick={pick} className="btn-primary mt-2 !py-1.5 !px-3 text-xs">
                <UploadCloud size={13} /> {translatePortalText("Upload a new file\r\n              ")}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── what the reading found ──────────────────────────────────────────── */}
      {showDetail && (
        <div className="border-t border-slate-200/70 dark:border-slate-700/70">
          <div className="space-y-2.5 px-3 py-2.5">
            {/* Expiry first — the value this whole pass exists to find. */}
            {expiry && (
              <div className="flex items-center gap-1.5 text-xs">
                <CalendarClock size={13} className={tone.text} />
                <span className="text-slate-500 dark:text-slate-400">{translatePortalText("Expires")}</span>
                <span className={`font-semibold ${tone.text}`}>{fmtDocDate(expiry)}</span>
              </div>
            )}

            {flags.map((f, i) => (
              <div key={`${f.code}-${i}`} className="flex items-start gap-2">
                {f.severity === 'critical'
                  ? <FileWarning size={13} className="mt-0.5 shrink-0 text-rose-500" />
                  : <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-500" />}
                <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">{translatePortalText(f.message)}</p>
              </div>
            ))}

            {/* The extracted values, folded away. Shown because a provider who
                disagrees with the verdict deserves to see what we read. */}
            {otherFields.length > 0 && (
              <div>
                <button type="button" onClick={() => setExpanded((v) => !v)}
                  className="text-[11px] font-semibold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                  {translatePortalText(expanded ? 'Hide' : 'Show')} {translatePortalText("what we read from this document\r\n                ")}</button>
                {expanded && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {otherFields.map((f) => (
                      <span key={f.key} className="rounded-md bg-slate-100 px-2 py-1 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        <span className="text-slate-400">{translatePortalText(f.label)}:</span> <span className="font-semibold">{f.value}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── the choice: fix it, or tell us we read it wrong ───────────── */}
            {needsAttention && (
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <button type="button" onClick={pick} disabled={busy} className="btn-primary !py-1.5 !px-3 text-xs">
                  <UploadCloud size={13} /> {translatePortalText("Upload a different file\r\n                ")}</button>
                {waivable ? (
                  <button type="button" onClick={waive} disabled={waiving} className="btn-ghost !py-1.5 !px-3 text-xs">
                    {waiving ? <Loader2 size={13} className="animate-spin" /> : null} {translatePortalText("This is correct — continue\r\n                  ")}</button>
                ) : (
                  <p className="text-[11px] text-slate-400">{translatePortalText("Our team will review this one before your account opens.")}</p>
                )}
              </div>
            )}

            {uploaded.acknowledgedAt && severity !== 'clear' && (
              <p className="text-[11px] text-slate-400">
                {translatePortalText("You told us this document is correct, so we will pass it to a reviewer as it is.\r\n              ")}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Shell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  const { logout } = useAuth()
  const nav = useNavigate()
  return (
    <div className="relative min-h-screen bg-hero-gradient">
      <div className="pointer-events-none absolute inset-0 opacity-[0.15]" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.5) 1px, transparent 1px)', backgroundSize: '26px 26px' }} />
      <div className="absolute end-4 top-4 z-30 flex items-center gap-2">
        <ThemeToggle onDark />
        <button className="btn-ghost !bg-white/10 !border-white/20 !text-white !py-2 text-xs" onClick={() => { logout(); nav('/login') }}>{translatePortalText("Sign out")}</button>
      </div>
      <div className="relative z-10 flex min-h-screen items-center justify-center p-5">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className={`card w-full ${wide ? 'max-w-3xl' : 'max-w-md'} !rounded-3xl p-7 shadow-lift`}>
          {children}
        </motion.div>
      </div>
    </div>
  )
}
