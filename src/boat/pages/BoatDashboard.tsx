import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Compass, Plus, Ship, Trash2, TriangleAlert, Upload } from 'lucide-react'
import { PageHeader, Section, Modal, LoadingButton, toast, EmptyState, LoadingState, Spinner, pickFiles } from '../../ui'
import {
  boatApi,
  tripApi,
  fileUrl,
  BOAT_CATEGORIES,
  BOAT_SERVICE_CATEGORIES,
  BOOKING_MODE_BY_PRICING_MODEL,
  ENGINE_TYPES,
  FUEL_TYPES,
  RATE_UNIT_LABEL,
  TRIP_PRICING_MODELS,
  type ApiBoat,
  type ApiTrip,
  type TripScheduleResult,
} from '../../api'
import { useLimitAwareAction, usePackageUsage, UsageMeter } from '../../shared/packageLimit'
import { useAuth } from '../../auth'
import { confirmAndRun } from '../../async'
import { profileApi } from '../../api'
import BrandLogoManager from '../../components/BrandLogoManager'
import VendorLogoBadge from '../../components/VendorLogoBadge'
import { formatPortalDate, formatPortalNumber, isPortalArabic, localizedField, localizedEnum, portalWeekdayLabels, translatePortalText } from '../../i18n/runtime'

const FLEET_PHOTO_CATEGORIES = ['cover', 'fleet', 'experience', 'crew', 'other'] as const
const FLEET_PHOTO_CATEGORY_LABELS: Record<string, string> = {
  cover: 'Cover Photos (Rotating)',
  fleet: 'Vessels & Fleet Showcase',
  experience: 'Onboard Guest Experience',
  crew: 'Captains & Crew in Action',
  other: 'Other Media',
}

/**
 * The boat provider's web dashboard.
 *
 * Two lists, deliberately: **boats** are the vessels they own, **trips** are what
 * those vessels are sold as. A boat with no trip earns nothing — it isn't
 * bookable at all — so that state is called out rather than left for the provider
 * to deduce from an empty bookings list.
 *
 * The full wizard (schedules, itineraries, promo windows, departure blocking)
 * lives in the mobile app; this is the self-serve web surface, so it collects the
 * fields a trip needs to exist and go on sale.
 */

const CATEGORY_LABELS: Record<string, string> = {
  sailing_boat: 'Sailing Boat', motorboat: 'Motorboat', yacht: 'Yacht', jet_ski: 'Jet Ski',
  car_jet: 'Car Jet', sports_jet_boat: 'Sports Jet Boat', floating_restaurant: 'Floating Restaurant',
  water_bus: 'Water Bus', cruise_ship: 'Cruise Ship',
}

const PRICING_MODEL_LABELS: Record<string, string> = {
  hourly: 'Hourly charter',
  per_person: 'Private, per person',
  package: 'Package (flat price)',
  per_ticket: 'Tickets (shared sailing)',
}

const emptyBoatForm = {
  name: '', nameAr: '', category: 'motorboat',
  lengthFt: '', capacity: '', crewCapacity: '', cabins: '', maxSpeedKn: '',
  engineType: '', engineCount: '1', horsepowerHp: '', fuelType: '',
  hullMaterial: '', fuelCapacityL: '', vesselLicense: '', turnaroundMinutes: '30',
  description: '', descriptionAr: '', city: '', marina: '', flag: '',
}

const emptyTripForm = {
  boatId: '', title: '', titleAr: '', tripType: 'leisure', pricingModel: 'hourly',
  basePrice: '', promoPrice: '', durationHours: '4', minHours: '2', maxHours: '8',
  maxGuests: '', minGuests: '1', description: '', descriptionAr: '',
  daysOfWeek: [0, 1, 2, 3, 4, 5, 6] as number[],
  startTime: '09:00', seasonDays: '60',
  publish: true,
}

function sundayFirstWeekdayLabels(): string[] {
  const mondayFirst = portalWeekdayLabels()
  return [mondayFirst[6], ...mondayFirst.slice(0, 6)]
}

function addDaysISO(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  // Local date parts. `toISOString()` converts to UTC first, so at +3 every
  // window this produces began a day earlier than the label claimed.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function boatIdOf(trip: ApiTrip): string {
  return typeof trip.boatId === 'object' ? String(trip.boatId.id ?? trip.boatId._id ?? '') : String(trip.boatId)
}

export default function BoatDashboard() {
  const location = useLocation()
  const { user, refreshMe } = useAuth()
  const [boats, setBoats] = useState<ApiBoat[] | null>(null)
  const [trips, setTrips] = useState<ApiTrip[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [boatOpen, setBoatOpen] = useState(false)
  const [tripOpen, setTripOpen] = useState(false)
  const [logoOpen, setLogoOpen] = useState(false)
  const [uploadingCategory, setUploadingCategory] = useState<string | null>(null)
  const [boatForm, setBoatForm] = useState(emptyBoatForm)
  const [tripForm, setTripForm] = useState(emptyTripForm)
  const [schedule, setSchedule] = useState<TripScheduleResult | null>(null)
  const usage = usePackageUsage()

  const providerLogo = (user?.business as any)?.logo || user?.avatar

  const focusTarget = useCallback((id: string) => {
    if (id === 'trips' || id === 'add-trip' || id === 'trip') {
      setTripOpen(true)
      return
    }
    setBoatOpen(true)
    setTimeout(() => {
      const el = document.getElementById(id)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.focus?.()
        el.classList.add('ring-4', 'ring-ocean-500', 'ring-offset-2', 'transition-all', 'duration-500')
        setTimeout(() => el.classList.remove('ring-4', 'ring-ocean-500', 'ring-offset-2'), 2500)
      }
    }, 150)
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

  const load = async () => {
    setLoading(true)
    try {
      const [boatRes, tripRes] = await Promise.all([boatApi.mine(), tripApi.mine()])
      setBoats(boatRes.data.items)
      setTrips(tripRes.data.items)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not load your fleet', 'warn')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [])

  const createBoat = useLimitAwareAction(boatApi.create)
  const createTrip = useLimitAwareAction(tripApi.create)

  const submitBoat = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!boatForm.name.trim() || !boatForm.city.trim() || !boatForm.marina.trim() || !boatForm.flag.trim()) {
      toast('Name, city, marina and flag are required', 'warn')
      return
    }
    // A powered vessel with a declared engine type but no fuel type is a
    // half-filled form, and the server rejects it — so catch it here.
    if (boatForm.engineType && boatForm.engineType !== 'sail' && !boatForm.fuelType) {
      toast('Tell us what this engine runs on', 'warn')
      return
    }
    const created = await createBoat.run({
      name: boatForm.name.trim(),
      nameAr: boatForm.nameAr.trim() || undefined,
      category: boatForm.category,
      lengthFt: Number(boatForm.lengthFt) || 0,
      capacity: Number(boatForm.capacity) || 1,
      crewCapacity: Number(boatForm.crewCapacity) || undefined,
      cabins: Number(boatForm.cabins) || undefined,
      maxSpeedKn: Number(boatForm.maxSpeedKn) || undefined,
      engine: boatForm.engineType
        ? {
            type: boatForm.engineType,
            count: Number(boatForm.engineCount) || 1,
            horsepowerHp: Number(boatForm.horsepowerHp) || undefined,
            fuelType: boatForm.fuelType || undefined,
          }
        : undefined,
      hullMaterial: boatForm.hullMaterial || undefined,
      fuelCapacityL: Number(boatForm.fuelCapacityL) || undefined,
      vesselLicense: boatForm.vesselLicense.trim() || undefined,
      turnaroundMinutes: Number(boatForm.turnaroundMinutes) || undefined,
      description: boatForm.description.trim() || undefined,
      descriptionAr: boatForm.descriptionAr.trim() || undefined,
      city: boatForm.city.trim(),
      marina: boatForm.marina.trim(),
      flag: boatForm.flag.trim(),
    })
    if (!created) return // package limit reached — modal is showing, will retry on resolution
    toast(`${boatForm.name} added to your fleet — now create a trip on it`)
    setBoatOpen(false)
    setBoatForm(emptyBoatForm)
    await load()
    await usage.reload()
  }

  const submitTrip = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!tripForm.boatId) {
      toast('Pick the boat this trip runs on', 'warn')
      return
    }
    if (!tripForm.title.trim() || !(Number(tripForm.basePrice) > 0)) {
      toast('A title and a price above zero are required', 'warn')
      return
    }
    const promo = Number(tripForm.promoPrice) || 0
    if (promo && promo >= Number(tripForm.basePrice)) {
      toast('The promotional price must be lower than the standard price', 'warn')
      return
    }
    const boat = boats?.find((b) => b.id === tripForm.boatId)
    const maxGuests = Number(tripForm.maxGuests) || boat?.capacity || 1
    if (boat && maxGuests > boat.capacity) {
      toast(`${boat.name} is certified for ${boat.capacity} passengers`, 'warn')
      return
    }
    if (!tripForm.daysOfWeek.length) {
      toast('Pick at least one day of the week', 'warn')
      return
    }

    const created = await createTrip.run({
      boatId: tripForm.boatId,
      title: tripForm.title.trim(),
      titleAr: tripForm.titleAr.trim() || undefined,
      tripType: tripForm.tripType,
      pricingModel: tripForm.pricingModel,
      basePrice: Number(tripForm.basePrice),
      promoPrice: promo || undefined,
      durationMinutes: Math.round((Number(tripForm.durationHours) || 4) * 60),
      minHours: tripForm.pricingModel === 'hourly' ? Number(tripForm.minHours) || undefined : undefined,
      maxHours: tripForm.pricingModel === 'hourly' ? Number(tripForm.maxHours) || undefined : undefined,
      maxGuests,
      // A per-ticket trip sells single seats, so a party minimum is unfulfillable.
      minGuests: tripForm.pricingModel === 'per_ticket' ? 1 : Number(tripForm.minGuests) || 1,
      description: tripForm.description.trim() || undefined,
      descriptionAr: tripForm.descriptionAr.trim() || undefined,
      status: tripForm.publish ? 'active' : 'draft',
      recurrence: {
        kind: 'weekly',
        daysOfWeek: tripForm.daysOfWeek,
        startTimes: [tripForm.startTime],
        seasonStartISO: addDaysISO(1),
        seasonEndISO: addDaysISO(Number(tripForm.seasonDays) || 60),
      },
    })
    if (!created) return
    toast(`${tripForm.title} created`)
    setTripOpen(false)
    setTripForm(emptyTripForm)
    // The scheduler's conflict report is the whole point of generation — a
    // provider who silently got 24 of 30 sailings needs to know which and why.
    setSchedule(created.data.schedule ?? null)
    await load()
    await usage.reload()
  }

  const removeBoat = (b: ApiBoat) => {
    const onThisBoat = (trips ?? []).filter((t) => boatIdOf(t) === b.id)
    return confirmAndRun({
      title: `Remove ${b.name}?`,
      // The cascade is the part that needs weighing, so it gets its own line in
      // the body rather than being appended to a one-line native alert.
      body: onThisBoat.length
        ? `Its ${onThisBoat.length} ${onThisBoat.length === 1 ? 'trip' : 'trips'} will be removed too. This cannot be undone.`
        : 'This cannot be undone.',
      confirmLabel: 'Remove',
      busyLabel: 'Removing…',
      danger: true,
      run: async () => {
        await boatApi.remove(b.id)
        await load()
        await usage.reload()
      },
      success: `${b.name} removed successfully`,
      error: 'Could not remove the boat. Please try again.',
    })
  }

  const removeTrip = (t: ApiTrip) =>
    confirmAndRun({
      title: `Remove ${t.title}?`,
      body: 'Customers will no longer be able to book this trip. This cannot be undone.',
      confirmLabel: 'Remove',
      busyLabel: 'Removing…',
      danger: true,
      run: async () => {
        await tripApi.remove(t.id)
        await load()
      },
      success: `${t.title} removed successfully`,
      error: 'Could not remove the trip. Please try again.',
    })

  const boatsWithoutTrips = (boats ?? []).filter(
    (b) => b.status !== 'out_of_service' && !(trips ?? []).some((t) => boatIdOf(t) === b.id),
  )

  const openTripFor = (boatId: string) => {
    const boat = boats?.find((b) => b.id === boatId)
    setTripForm({ ...emptyTripForm, boatId, maxGuests: boat ? String(boat.capacity) : '' })
    setTripOpen(true)
  }

  const bookingMode = BOOKING_MODE_BY_PRICING_MODEL[tripForm.pricingModel] ?? 'exclusive'

  return (
    <div>
      <PageHeader
        title={`${translatePortalText('Welcome')}, ${localizedField(user?.business, 'businessName') || localizedField(user, 'name') || translatePortalText('Captain')}`}
        sub="Your boats are the vessels; your trips are what customers book on them"
        icon={<Ship className="text-ocean-500" />}
        actions={
          <div className="flex gap-2">
            <button className="btn-ghost !text-xs font-bold" onClick={() => setLogoOpen(true)}>{translatePortalText("✨ Brand Logo")}</button>
            <button className="btn-ghost" onClick={() => setBoatOpen(true)}><Plus size={16} />  {translatePortalText("Add boat")}</button>
            <button
              className="btn-primary"
              onClick={() => openTripFor(boats?.[0]?.id ?? '')}
              disabled={!boats?.length}
            >
              <Plus size={16} />  {translatePortalText("Add trip")}</button>
          </div>
        }
      />

      {usage.usage.length > 0 && (
        <div className="mb-5 grid gap-4 rounded-2xl border border-slate-100 bg-white p-4 sm:grid-cols-2">
          {usage.usage.map((u) => <UsageMeter key={u.key} item={u} />)}
        </div>
      )}

      {/* Boats that cannot be booked because nothing is built on them. */}
      {!loading && boatsWithoutTrips.length > 0 && (
        <div className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <TriangleAlert size={18} className="mt-0.5 shrink-0 text-amber-600" />
          <div className="min-w-0">
            <p className="font-semibold text-amber-900">
              {translatePortalText(`${boatsWithoutTrips.length} ${boatsWithoutTrips.length === 1 ? 'boat' : 'boats'} not earning yet`)}</p>
            <p className="mt-0.5 text-sm text-amber-800">
              {boatsWithoutTrips.map((b) => localizedField<string>(b, 'name') ?? b.name).join(', ')}  {translatePortalText("— a boat isn't bookable until it has a trip.")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {boatsWithoutTrips.slice(0, 4).map((b) => (
                <button key={b.id} className="btn-ghost !py-1 !text-xs" onClick={() => openTripFor(b.id)}>
                  <Plus size={12} />  {translatePortalText("Trip for")} {localizedField<string>(b, 'name') ?? b.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <Section title={translatePortalText("My Trips")} sub={trips ? `${trips.length} listed` : ''}>
        {loading ? (
          <LoadingState label="Loading your trips…" rows={2} />
        ) : !trips || trips.length === 0 ? (
          <EmptyState icon="🧭" text="No trips yet — a trip is what customers actually book." />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {trips.map((t) => {
              const boat = boats?.find((b) => b.id === boatIdOf(t))
              const promoLive =
                t.promoPrice != null &&
                t.promoPrice < t.basePrice &&
                (!t.promoStartsAt || new Date(t.promoStartsAt) <= new Date()) &&
                (!t.promoEndsAt || new Date(t.promoEndsAt) >= new Date())
              const rate = promoLive ? t.promoPrice! : t.basePrice
              const shared = t.bookingMode === 'shared'
              const stats = t.departureStats
              return (
                <div key={t.id} className="card card-hover p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <VendorLogoBadge logoUrl={boat?.logo || providerLogo} name={localizedField<string>(boat, 'name') || user?.business?.businessName} role="boat_provider" size="sm" />
                      <div className="min-w-0">
                        <p className="truncate font-display text-base font-bold text-deep-900">{localizedField<string>(t, 'title') ?? t.title}</p>
                        <p className="text-xs text-slate-400">
                          {localizedField<string>(boat, 'name') ?? boat?.name ?? translatePortalText('Boat removed')} · {localizedEnum(t.tripType)}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => removeTrip(t)}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>

                  <div className="mt-3 flex items-baseline gap-2">
                    {promoLive && <span className="text-xs text-slate-400 line-through">{formatPortalNumber(t.basePrice, { maximumFractionDigits: 2 })}</span>}
                    <span className={`font-display text-lg font-bold ${promoLive ? 'text-rose-600' : 'text-deep-900'}`}>
                      {formatPortalNumber(rate, { maximumFractionDigits: 2 })}
                    </span>
                    <span className="text-xs text-slate-500">{translatePortalText("SAR")} {translatePortalText(RATE_UNIT_LABEL[t.pricingModel] ?? '')}</span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <span
                      className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                        shared ? 'bg-emerald-50 text-emerald-700' : 'bg-sky-50 text-sky-700'
                      }`}
                    >
                      {shared ? `${formatPortalNumber(t.maxGuests)} ${translatePortalText('SEATS')}` : translatePortalText('WHOLE BOAT')}
                    </span>
                    {t.status !== 'active' && (
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                        {localizedEnum(t.status)}
                      </span>
                    )}
                    {!!stats && (
                      <>
                        <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                          {formatPortalNumber(stats.upcoming)}  {translatePortalText("ON SALE")}</span>
                        {stats.soldOut > 0 && (
                          <span className="rounded-md bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700">
                            {formatPortalNumber(stats.soldOut)}  {translatePortalText("SOLD OUT")}</span>
                        )}
                        {stats.blocked > 0 && (
                          <span className="rounded-md bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                            {formatPortalNumber(stats.blocked)}  {translatePortalText("BLOCKED")}</span>
                        )}
                      </>
                    )}
                  </div>

                  {t.status === 'active' && (stats?.upcoming ?? 0) === 0 && (
                    <p className="mt-2 text-xs text-rose-600">
                      {stats && stats.blocked > 0
                        ? translatePortalText('Every upcoming sailing is blocked — the boat is busy elsewhere.')
                        : translatePortalText('No upcoming sailings, so nobody can book this.')}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Section>

      <Section title={translatePortalText("My Boats")} sub={boats ? `${boats.length} in the fleet` : ''}>
        {loading ? (
          <LoadingState label="Loading your boats…" rows={3} />
        ) : !boats || boats.length === 0 ? (
          <EmptyState icon="🚤" text="No boats listed yet — add your first one." />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {boats.map((b) => {
              const onThisBoat = (trips ?? []).filter((t) => boatIdOf(t) === b.id)
              const activeCount = onThisBoat.filter((t) => t.status === 'active').length
              return (
                <div key={b.id} className="card card-hover p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <VendorLogoBadge logoUrl={b.logo || providerLogo} name={localizedField<string>(b, 'name') ?? b.name} role="boat_provider" size="md" />
                      <div className="min-w-0">
                        <p className="truncate font-display text-base font-bold text-deep-900">{localizedField<string>(b, 'name') ?? b.name}</p>
                        <p className="text-xs text-slate-400">{translatePortalText(CATEGORY_LABELS[b.category] || localizedEnum(b.category))} · {localizedField<string>(b, 'city') ?? b.city}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => removeBoat(b)}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-sm">
                    <span className="text-slate-500">{formatPortalNumber(b.capacity)}  {translatePortalText("guests ·")} {formatPortalNumber(b.lengthFt)}  {translatePortalText("ft")}</span>
                    {!!b.engine?.horsepowerHp && (
                      <span className="text-xs text-slate-400">
                        {formatPortalNumber(b.engine.count ?? 1)}× {formatPortalNumber(b.engine.horsepowerHp)}  {translatePortalText("hp")}</span>
                    )}
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                      <Compass size={13} />
                      {onThisBoat.length === 0
                        ? translatePortalText('No trips yet')
                        : translatePortalText(`${activeCount}/${onThisBoat.length} trip(s) on sale`)}
                    </span>
                    <button className="btn-ghost !py-1 !text-xs" onClick={() => openTripFor(b.id)}>
                      <Plus size={12} />  {translatePortalText("Trip")}</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Section>

      {/* ── Add boat: the vessel only ── */}
      <Modal open={boatOpen} onClose={() => setBoatOpen(false)} title={translatePortalText("Add a Boat")}>
        <form onSubmit={submitBoat} className="space-y-4">
          <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
            {translatePortalText("This is the vessel itself. You'll set prices and dates when you create a trip on it.")}</p>
          <div>
            <label className="label">{translatePortalText("Boat name")}</label>
            <input id="name" className="input" value={boatForm.name} onChange={(e) => setBoatForm({ ...boatForm, name: e.target.value })} required />
          </div>
          <div>
            <label className="label">{translatePortalText("Boat name (Arabic)")}</label>
            <input dir="rtl" lang="ar" className="input text-right" value={boatForm.nameAr} onChange={(e) => setBoatForm({ ...boatForm, nameAr: e.target.value })} placeholder="اسم القارب بالعربية" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{translatePortalText("Category")}</label>
              <select id="category" className="input" value={boatForm.category} onChange={(e) => setBoatForm({ ...boatForm, category: e.target.value })}>
                {BOAT_CATEGORIES.map((c) => <option key={c} value={c}>{translatePortalText(CATEGORY_LABELS[c] || localizedEnum(c))}</option>)}
              </select>
            </div>
            <div>
              <label className="label">{translatePortalText("Vessel licence / Registration")}</label>
              <input id="registrationNumber" className="input" placeholder="SA-JED-Y-00000" value={boatForm.vesselLicense} onChange={(e) => setBoatForm({ ...boatForm, vesselLicense: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="label">{translatePortalText("Length (ft)")}</label>
              <input id="lengthFt" type="number" min={0} className="input" value={boatForm.lengthFt} onChange={(e) => setBoatForm({ ...boatForm, lengthFt: e.target.value })} required />
            </div>
            <div>
              <label className="label">{translatePortalText("Passengers")}</label>
              <input id="capacity" type="number" min={1} className="input" value={boatForm.capacity} onChange={(e) => setBoatForm({ ...boatForm, capacity: e.target.value })} required />
            </div>
            <div>
              <label className="label">{translatePortalText("Crew")}</label>
              <input id="crewCapacity" type="number" min={0} className="input" value={boatForm.crewCapacity} onChange={(e) => setBoatForm({ ...boatForm, crewCapacity: e.target.value })} />
            </div>
            <div>
              <label className="label">{translatePortalText("Cabins")}</label>
              <input id="cabins" type="number" min={0} className="input" value={boatForm.cabins} onChange={(e) => setBoatForm({ ...boatForm, cabins: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="label">{translatePortalText("Engine type")}</label>
              <select id="engine" className="input" value={boatForm.engineType} onChange={(e) => setBoatForm({ ...boatForm, engineType: e.target.value })}>
                <option value="">—</option>
                {ENGINE_TYPES.map((t) => <option key={t} value={t}>{localizedEnum(t)}</option>)}
              </select>
            </div>
            <div>
              <label className="label">{translatePortalText("Engines")}</label>
              <input type="number" min={0} max={8} className="input" value={boatForm.engineCount} onChange={(e) => setBoatForm({ ...boatForm, engineCount: e.target.value })} />
            </div>
            <div>
              <label className="label">{translatePortalText("HP each")}</label>
              <input type="number" min={0} className="input" value={boatForm.horsepowerHp} onChange={(e) => setBoatForm({ ...boatForm, horsepowerHp: e.target.value })} />
            </div>
            <div>
              <label className="label">{translatePortalText("Fuel")}</label>
              <select className="input" value={boatForm.fuelType} onChange={(e) => setBoatForm({ ...boatForm, fuelType: e.target.value })}>
                <option value="">—</option>
                {FUEL_TYPES.map((t) => <option key={t} value={t}>{localizedEnum(t)}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">{translatePortalText("Max speed (kn)")}</label>
              <input type="number" min={0} className="input" value={boatForm.maxSpeedKn} onChange={(e) => setBoatForm({ ...boatForm, maxSpeedKn: e.target.value })} />
            </div>
            <div>
              <label className="label">{translatePortalText("Fuel tank (L)")}</label>
              <input type="number" min={0} className="input" value={boatForm.fuelCapacityL} onChange={(e) => setBoatForm({ ...boatForm, fuelCapacityL: e.target.value })} />
            </div>
            <div>
              <label className="label">{translatePortalText("Turnaround (min)")}</label>
              <input
                id="turnaroundMinutes"
                type="number"
                min={0}
                className="input"
                value={boatForm.turnaroundMinutes}
                onChange={(e) => setBoatForm({ ...boatForm, turnaroundMinutes: e.target.value })}
              />
            </div>
          </div>
          <p className="-mt-2 text-xs text-slate-500">
            {translatePortalText("Turnaround is the cleaning and refuelling gap the boat needs — trips can't be scheduled inside it.")}</p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">{translatePortalText("City")}</label>
              <input id="city" className="input" value={boatForm.city} onChange={(e) => setBoatForm({ ...boatForm, city: e.target.value })} required />
            </div>
            <div>
              <label className="label">{translatePortalText("Marina")}</label>
              <input id="marina" className="input" value={boatForm.marina} onChange={(e) => setBoatForm({ ...boatForm, marina: e.target.value })} required />
            </div>
            <div>
              <label className="label">{translatePortalText("Flag")}</label>
              <input id="flag" className="input" placeholder={translatePortalText("e.g. AE")} value={boatForm.flag} onChange={(e) => setBoatForm({ ...boatForm, flag: e.target.value })} required />
            </div>
          </div>
          <div>
            <label className="label">{translatePortalText("Description")}</label>
            <textarea id="description" className="input" rows={3} value={boatForm.description} onChange={(e) => setBoatForm({ ...boatForm, description: e.target.value })} />
          </div>
          <div>
            <label className="label">{translatePortalText("Description (Arabic)")}</label>
            <textarea dir="rtl" lang="ar" className="input text-right" rows={3} value={boatForm.descriptionAr} onChange={(e) => setBoatForm({ ...boatForm, descriptionAr: e.target.value })} placeholder="وصف القارب بالعربية" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setBoatOpen(false)}>{translatePortalText("Cancel")}</button>
            <LoadingButton type="submit" className="btn-primary">{translatePortalText("Add Boat")}</LoadingButton>
          </div>
        </form>
      </Modal>

      {/* ── Add trip: the sellable product ── */}
      <Modal open={tripOpen} onClose={() => setTripOpen(false)} title={translatePortalText("Create a Trip")}>
        <form onSubmit={submitTrip} className="space-y-4">
          <div>
            <label className="label">{translatePortalText("Boat")}</label>
            <select
              className="input"
              value={tripForm.boatId}
              onChange={(e) => {
                const boat = boats?.find((b) => b.id === e.target.value)
                setTripForm({
                  ...tripForm,
                  boatId: e.target.value,
                  maxGuests: boat ? String(boat.capacity) : tripForm.maxGuests,
                })
              }}
              required
            >
              <option value="">{translatePortalText("Pick a boat…")}</option>
              {(boats ?? []).map((b) => (
                <option key={b.id} value={b.id}>{localizedField<string>(b, 'name') ?? b.name} — {formatPortalNumber(b.capacity)}  {translatePortalText("pax")}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">{translatePortalText("Trip title")}</label>
            <input className="input" placeholder={translatePortalText("Sunset cruise along the corniche")} value={tripForm.title} onChange={(e) => setTripForm({ ...tripForm, title: e.target.value })} required />
          </div>
          <div>
            <label className="label">{translatePortalText("Trip title (Arabic)")}</label>
            <input dir="rtl" lang="ar" className="input text-right" placeholder="عنوان الرحلة بالعربية" value={tripForm.titleAr} onChange={(e) => setTripForm({ ...tripForm, titleAr: e.target.value })} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{translatePortalText("Trip type")}</label>
              <select className="input" value={tripForm.tripType} onChange={(e) => setTripForm({ ...tripForm, tripType: e.target.value })}>
                {BOAT_SERVICE_CATEGORIES.map((c) => <option key={c} value={c}>{localizedEnum(c)}</option>)}
              </select>
            </div>
            <div>
              <label className="label">{translatePortalText("Pricing model")}</label>
              <select className="input" value={tripForm.pricingModel} onChange={(e) => setTripForm({ ...tripForm, pricingModel: e.target.value })}>
                {TRIP_PRICING_MODELS.map((m) => <option key={m} value={m}>{translatePortalText(PRICING_MODEL_LABELS[m])}</option>)}
              </select>
            </div>
          </div>

          {/* The exclusivity consequence, stated where it is chosen. */}
          <div
            className={`rounded-xl border p-3 text-xs ${
              bookingMode === 'shared'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : 'border-sky-200 bg-sky-50 text-sky-900'
            }`}
          >
            {bookingMode === 'shared'
              ? translatePortalText('Each sailing sells seats to as many customers as fit. When the last seat goes it shows as sold out.')
              : translatePortalText('Each sailing goes to a single party. Once someone books it, nobody else can — even if seats are unused.')}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{translatePortalText("Rate (")}{translatePortalText(RATE_UNIT_LABEL[tripForm.pricingModel] ?? '')})</label>
              <input type="number" min={0} className="input" value={tripForm.basePrice} onChange={(e) => setTripForm({ ...tripForm, basePrice: e.target.value })} required />
            </div>
            <div>
              <label className="label">{translatePortalText("Promotional rate")}</label>
              <input type="number" min={0} className="input" placeholder={translatePortalText("Optional")} value={tripForm.promoPrice} onChange={(e) => setTripForm({ ...tripForm, promoPrice: e.target.value })} />
            </div>
          </div>
          <p className="-mt-2 text-xs text-slate-500">
            {translatePortalText("The promotional rate replaces the standard one for every booking while it's live — available on all four pricing models.")}</p>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">{translatePortalText("Length (hours)")}</label>
              <input type="number" min={0.5} step={0.5} className="input" value={tripForm.durationHours} onChange={(e) => setTripForm({ ...tripForm, durationHours: e.target.value })} required />
            </div>
            <div>
              <label className="label">{bookingMode === 'shared' ? 'Seats per sailing' : 'Max guests'}</label>
              <input type="number" min={1} className="input" value={tripForm.maxGuests} onChange={(e) => setTripForm({ ...tripForm, maxGuests: e.target.value })} required />
            </div>
            <div>
              <label className="label">{translatePortalText("Min party")}</label>
              <input
                type="number"
                min={1}
                className="input"
                value={tripForm.pricingModel === 'per_ticket' ? '1' : tripForm.minGuests}
                disabled={tripForm.pricingModel === 'per_ticket'}
                onChange={(e) => setTripForm({ ...tripForm, minGuests: e.target.value })}
              />
            </div>
          </div>

          {tripForm.pricingModel === 'hourly' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">{translatePortalText("Minimum hours")}</label>
                <input type="number" min={0.5} step={0.5} className="input" value={tripForm.minHours} onChange={(e) => setTripForm({ ...tripForm, minHours: e.target.value })} />
              </div>
              <div>
                <label className="label">{translatePortalText("Maximum hours")}</label>
                <input type="number" min={0.5} step={0.5} className="input" value={tripForm.maxHours} onChange={(e) => setTripForm({ ...tripForm, maxHours: e.target.value })} />
              </div>
            </div>
          )}

          <div>
            <label className="label">{translatePortalText("Sails on")}</label>
            <div className="flex flex-wrap gap-1.5">
              {sundayFirstWeekdayLabels().map((label, index) => {
                const on = tripForm.daysOfWeek.includes(index)
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() =>
                      setTripForm({
                        ...tripForm,
                        daysOfWeek: on
                          ? tripForm.daysOfWeek.filter((d) => d !== index)
                          : [...tripForm.daysOfWeek, index],
                      })
                    }
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                      on ? 'bg-ocean-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{translatePortalText("Departure time")}</label>
              <input type="time" className="input" value={tripForm.startTime} onChange={(e) => setTripForm({ ...tripForm, startTime: e.target.value })} required />
            </div>
            <div>
              <label className="label">{translatePortalText("Generate for (days)")}</label>
              <input type="number" min={1} max={365} className="input" value={tripForm.seasonDays} onChange={(e) => setTripForm({ ...tripForm, seasonDays: e.target.value })} />
            </div>
          </div>
          <p className="-mt-2 text-xs text-slate-500">
            {translatePortalText("Dates where this boat is already committed to another trip are recorded as blocked, and we'll tell you which.")}</p>

          <div>
            <label className="label">{translatePortalText("Description")}</label>
            <textarea className="input" rows={2} value={tripForm.description} onChange={(e) => setTripForm({ ...tripForm, description: e.target.value })} />
          </div>
          <div>
            <label className="label">{translatePortalText("Description (Arabic)")}</label>
            <textarea dir="rtl" lang="ar" className="input text-right" rows={2} placeholder="وصف الرحلة بالعربية" value={tripForm.descriptionAr} onChange={(e) => setTripForm({ ...tripForm, descriptionAr: e.target.value })} />
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={tripForm.publish}
              onChange={(e) => setTripForm({ ...tripForm, publish: e.target.checked })}
            />
            {translatePortalText("Publish and generate departures now")}</label>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setTripOpen(false)}>{translatePortalText("Cancel")}</button>
            <LoadingButton type="submit" className="btn-primary">{translatePortalText("Create Trip")}</LoadingButton>
          </div>
        </form>
      </Modal>

      {/* The scheduler's report — shown so a partial generation is never silent. */}
      <Modal open={!!schedule} onClose={() => setSchedule(null)} title={translatePortalText("Departures generated")}>
        {schedule && (
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              {isPortalArabic()
                ? translatePortalText(`${schedule.created} sailing(s) are on sale.`)
                : `${formatPortalNumber(schedule.created)} sailing${schedule.created === 1 ? '' : 's'} are on sale.`}
              {schedule.conflicts.length > 0 && ` ${isPortalArabic()
                ? translatePortalText(`${schedule.conflicts.length} could not be scheduled:`)
                : `${formatPortalNumber(schedule.conflicts.length)} could not be scheduled:`}`}
            </p>
            {schedule.conflicts.length > 0 && (
              <ul className="max-h-64 space-y-2 overflow-y-auto">
                {schedule.conflicts.map((conflict, i) => (
                  <li key={`${conflict.dateISO}-${i}`} className="rounded-lg bg-rose-50 p-2.5 text-xs">
                    <span className="font-semibold text-rose-900">
                      {formatPortalDate(conflict.dateISO)}  {translatePortalText("at")} {conflict.startTime}
                    </span>
                    <span className="block text-rose-700">
                  {conflict.note ?? localizedEnum(conflict.reason)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end pt-1">
              <button className="btn-primary" onClick={() => setSchedule(null)}>{translatePortalText("Done")}</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={logoOpen} onClose={() => setLogoOpen(false)} title={translatePortalText("📷 Manage Fleet Photos & Brand Logo")} wide>
        <div className="space-y-6 max-h-[75vh] overflow-y-auto pe-1">
          <BrandLogoManager
            logoUrl={providerLogo}
            providerName={localizedField(user?.business, 'businessName') || localizedField(user, 'name') || translatePortalText('Charter Fleet')}
            categoryLabel={translatePortalText('Charter Fleet Provider')}
            onUpload={async (file) => {
              await profileApi.uploadBusinessLogo(file)
              await refreshMe()
            }}
            onRemove={async () => {
              await profileApi.updateBusiness({ logo: '' })
              await refreshMe()
            }}
          />

          <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-400 mb-4">
              {translatePortalText("Fleet Gallery & Cover Sections (")}{formatPortalNumber(((user?.business as any)?.imagesCategorized || []).filter((i: any) => i.category !== 'logo').length)}  {translatePortalText("Photos)")}</h4>
            <div className="space-y-5">
              {FLEET_PHOTO_CATEGORIES.map((cat) => {
                const categorized = ((user?.business as any)?.imagesCategorized || []) as { url: string; category?: string }[]
                const imgs = categorized.filter((i) => (i.category || 'other') === cat)
                const label = translatePortalText(FLEET_PHOTO_CATEGORY_LABELS[cat] || localizedEnum(cat))
                return (
                  <div key={cat}>
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                        {label}{cat === 'cover' ? ` (${translatePortalText('rotating')})` : ''} <span className="font-normal normal-case text-slate-300">· {formatPortalNumber(imgs.length)}</span>
                      </p>
                      <button
                        className="btn-ghost !py-1 !px-2 text-[11px]"
                        disabled={uploadingCategory === cat}
                        onClick={async () => {
                          const files = await pickFiles('image/*', true)
                          if (!files.length) return
                          setUploadingCategory(cat)
                          try {
                            await profileApi.uploadBusinessImages(files, cat)
                            await refreshMe()
                            toast(`Added ${files.length} ${label.toLowerCase()} photo(s)`, 'success')
                          } catch (e) {
                            toast(e instanceof Error ? e.message : 'Upload failed', 'warn')
                          } finally {
                            setUploadingCategory(null)
                          }
                        }}
                      >
                        {uploadingCategory === cat ? <Spinner size={11} /> : <Upload size={11} />}  {translatePortalText("Add")}</button>
                    </div>
                    {imgs.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 py-6 text-center text-[11px] text-slate-400">
                        {translatePortalText("No")} {label}  {translatePortalText("photos yet")}</div>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {imgs.map((img) => (
                          <div key={img.url} className="group relative overflow-hidden rounded-xl border border-slate-100 dark:border-slate-800 text-left">
                            <img src={fileUrl(img.url)} alt="" className="h-24 w-full object-cover transition duration-300 group-hover:scale-105" />
                            <button
                              type="button"
                              onClick={async (e) => {
                                e.stopPropagation()
                                try {
                                  await profileApi.deleteBusinessImage(img.url)
                                  await refreshMe()
                                  toast('Photo removed', 'info')
                                } catch (e) {
                                  toast(e instanceof Error ? e.message : 'Could not remove photo', 'warn')
                                }
                              }}
                              className="absolute end-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-lg bg-white/90 dark:bg-slate-900/90 text-rose-500 opacity-0 transition group-hover:opacity-100 shadow-sm"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
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

      {createBoat.modal}
      {createTrip.modal}
    </div>
  )
}
