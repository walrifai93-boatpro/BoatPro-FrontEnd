import { activeCurrency as displayCurrency, convert } from '../currency'
// ─────────────────────────────────────────────────────────────
// BoatPro Fuel Provider Portal — view-model layer.
//
// The portal renders live data from /api/v1/fuel-portal. This module owns the
// shapes the screens draw with and the mapping from the wire types in
// `fuelApi.ts` to those shapes (mostly enum → display label, so the shared
// `FBadge`/`TankGauge` components keep working unchanged).
// ─────────────────────────────────────────────────────────────
import { avatar } from '../format'
import { fileUrl } from '../api'
import { formatPortalCurrency, formatPortalDate, formatPortalTime, getPortalLanguage, portalLocale } from '../i18n/runtime'
import type {
  ApiCreditAccount,
  ApiFuelBooking,
  ApiFuelDelivery,
  ApiFuelDispense,
  ApiFuelInvoice,
  ApiFuelProduct,
  ApiFuelPump,
  ApiFuelStaff,
  ApiFuelSupplier,
  ApiFuelTank,
  ApiFuelVehicle,
  ApiPriceRule,
  ApiStationLicense,
  BookingApiStatus,
  DeliveryStatus,
  FuelMethod,
  FuelPriority,
} from './fuelApi'

export { avatar } from '../format'

// Grantable worker permissions, labeled to match the sidebar item they gate
// (FuelLayout.tsx's NAV) — shared by the sidebar's own filtering and the
// Team & Access invite/edit form so the two never drift apart.
export const FUEL_PERMISSION_LABELS: Record<string, string> = {
  calendar: 'Fuel Calendar',
  tracking: 'Live Tracking',
  bookings: 'Fuel Booking Request',
  deliveries: 'Fuel Booking Management',
  inventory: 'Inventory & Tanks',
  pricing: 'Pricing',
  billing: 'Billing & Payments',
  reports: 'Reports & Analytics',
  messages: 'Communication',
  notifications: 'Notifications',
  station: 'Station Profile',
}

/** Decorative photography for hero panels and empty fleet cards. */
export const FIMG = {
  hero: 'https://images.unsplash.com/photo-1518623489648-a173ef7824f3?w=1600&q=75&auto=format&fit=crop',
  fuelDock: 'https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=1200&q=70&auto=format&fit=crop',
  barge: 'https://images.unsplash.com/photo-1494412574643-ff11b0a5c1c3?w=1200&q=70&auto=format&fit=crop',
  tanker: 'https://images.unsplash.com/photo-1578575437130-527eed3abbec?w=1200&q=70&auto=format&fit=crop',
  truck: 'https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?w=1200&q=70&auto=format&fit=crop',
  marina: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=1200&q=70&auto=format&fit=crop',
  harbor: 'https://images.unsplash.com/photo-1516796181074-bf453fbfa3e6?w=1200&q=70&auto=format&fit=crop',
  ocean: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&q=70&auto=format&fit=crop',
  yacht: 'https://images.unsplash.com/photo-1559827260-dc66d52bef19?w=1200&q=70&auto=format&fit=crop',
  night: 'https://images.unsplash.com/photo-1493558103817-58b2924bce98?w=1200&q=70&auto=format&fit=crop',
  pipes: 'https://images.unsplash.com/photo-1513828583688-c52646db42da?w=1200&q=70&auto=format&fit=crop',
  gauges: 'https://images.unsplash.com/photo-1581092160562-40aa08e78837?w=1200&q=70&auto=format&fit=crop',
  station1: 'https://images.unsplash.com/photo-1545558014-8692077e9b5c?w=1200&q=70&auto=format&fit=crop',
  station2: 'https://images.unsplash.com/photo-1567899378494-47b22a2ae96a?w=1200&q=70&auto=format&fit=crop',
  sea: 'https://images.unsplash.com/photo-1505118380757-91f5f5632de0?w=1200&q=70&auto=format&fit=crop',
}

/**
 * The station's "cover" gallery photos, for chrome that rotates through them
 * (the dashboard hero and sidebar card). Falls back to the station's first
 * uploaded photo, then to stock photography, so chrome never renders empty.
 */
export function stationCoverPhotos(station: { images?: string[]; imagesCategorized?: { url: string; category?: string }[] } | null | undefined): string[] {
  const covers = (station?.imagesCategorized || [])
    .filter((i) => i.category === 'cover')
    .map((i) => fileUrl(i.url))
    .filter((u): u is string => !!u)
  if (covers.length) return covers
  const first = station?.images?.[0]
  return [first ? fileUrl(first)! : FIMG.hero]
}

// ─────────────────────────────────────────────────────────────
// Currency
// ─────────────────────────────────────────────────────────────

// The station's currency, published once the portal store has loaded. Kept as
// module state so `money()` stays a plain call at every render site.
let activeCurrency = 'USD'
export function setFuelCurrency(code?: string | null) {
  if (code) activeCurrency = code.toUpperCase()
}
export function fuelCurrency(): string {
  return activeCurrency
}

/**
 * An amount the station holds, in the currency the operator reads in.
 *
 * `activeCurrency` above is the *station's* currency — what its fuel is priced
 * in — and stays the source. The display currency is the operator's own
 * preference, so the figure is converted before it is labelled. Conflating the
 * two is what would put a dollar sign on a riyal-per-litre price.
 */
export const money = (n: number) => {
  const display = displayCurrency()
  const value = convert(n ?? 0, activeCurrency, display)
  return formatPortalCurrency(value, display)
}

// ─────────────────────────────────────────────────────────────
// Dates
// ─────────────────────────────────────────────────────────────

/** "Jul 20" — the compact date the tables use. */
export function shortDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : formatPortalDate(d, { month: 'short', day: '2-digit' })
}

/** "08:30" in 24-hour time. */
export function shortTime(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : formatPortalTime(d)
}

/** "Sep 2026" — the coarse expiry label on batches and licences. */
export function monthYear(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : formatPortalDate(d, { month: 'short', year: 'numeric' })
}

/** "2 min ago" / "Yesterday" — relative time for the notification feed. */
export function relativeTime(iso?: string | null): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const mins = Math.round((Date.now() - then) / 60000)
  const formatter = new Intl.RelativeTimeFormat(portalLocale(), { numeric: 'auto' })
  if (mins < 1) return formatter.format(0, 'minute')
  if (mins < 60) return formatter.format(-mins, 'minute')
  const hours = Math.round(mins / 60)
  if (hours < 24) return formatter.format(-hours, 'hour')
  const days = Math.round(hours / 24)
  if (days < 7) return formatter.format(-days, 'day')
  return shortDate(iso)
}

/** Lead time in hours rendered the way suppliers quote it — "24 h" / "5 d". */
export function leadTimeLabel(hours: number): string {
  if (!hours) return '—'
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} d`
}

// ─────────────────────────────────────────────────────────────
// Products
// ─────────────────────────────────────────────────────────────

export interface FuelType {
  key: string
  name: string
  icon: string
  color: string
  price: number
  unit: string
  stock: number
  capacity: number
  sold: number
  bulk: boolean
  id: string
}

export function toFuelType(
  p: ApiFuelProduct,
  stock?: { stock: number; capacity: number },
  sold = 0,
): FuelType {
  return {
    id: p._id,
    key: p.key,
    name: getPortalLanguage() === 'ar' && p.nameAr ? p.nameAr : p.name,
    icon: p.icon,
    color: p.color,
    price: p.price,
    unit: p.unit,
    stock: stock?.stock ?? 0,
    capacity: stock?.capacity ?? 0,
    sold,
    bulk: p.bulk,
  }
}

/**
 * Looks a product up by key, falling back to a neutral placeholder so a tank or
 * order referencing a product that was since removed still renders.
 */
export function productLookup(products: FuelType[]) {
  const byKey = new Map(products.map((p) => [p.key, p]))
  return (key: string): FuelType =>
    byKey.get(key) ?? {
      id: key,
      key,
      name: key,
      icon: '⛽',
      color: '#94a3b8',
      price: 0,
      unit: 'gal',
      stock: 0,
      capacity: 0,
      sold: 0,
      bulk: true,
    }
}

// ─────────────────────────────────────────────────────────────
// Tanks
// ─────────────────────────────────────────────────────────────

export type TankStatusLabel = 'Healthy' | 'Low' | 'Critical' | 'Maintenance'

const TANK_STATUS: Record<string, TankStatusLabel> = {
  healthy: 'Healthy',
  low: 'Low',
  critical: 'Critical',
  maintenance: 'Maintenance',
}

export interface Tank {
  id: string
  code: string
  stationId?: string
  stationName?: string
  fuel: string
  capacity: number
  stock: number
  batch: string
  supplier: string
  supplierId?: string
  lastRefill: string
  expiry: string
  status: TankStatusLabel
  reorderAt: number
  temp: number
  water: number
  location?: string
}

export function toTank(t: ApiFuelTank): Tank {
  const supplier = typeof t.supplier === 'object' && t.supplier ? t.supplier : null
  const station = typeof t.station === 'object' && t.station ? t.station : null
  return {
    id: t._id,
    code: t.code,
    stationId: station?._id ?? station?.id ?? (typeof t.station === 'string' ? t.station : undefined),
    stationName: station?.name,
    fuel: t.productKey,
    capacity: t.capacity,
    stock: t.stock,
    batch: t.batch || '—',
    supplier: supplier?.name ?? '—',
    supplierId: supplier?._id ?? (typeof t.supplier === 'string' ? t.supplier : undefined),
    lastRefill: shortDate(t.lastRefillAt),
    expiry: monthYear(t.expiresAt),
    status: TANK_STATUS[t.status] ?? 'Healthy',
    reorderAt: t.reorderAt,
    temp: t.temperatureC ?? 0,
    water: t.waterPct ?? 0,
    location: t.location,
  }
}

// ─────────────────────────────────────────────────────────────
// Suppliers
// ─────────────────────────────────────────────────────────────

export interface Supplier {
  id: string
  name: string
  contact: string
  phone: string
  fuels: string
  rating: number
  leadTime: string
  lastOrder: string
}

export function toSupplier(s: ApiFuelSupplier, productName: (key: string) => string): Supplier {
  return {
    id: s._id,
    name: s.name,
    contact: s.contactName || '—',
    phone: s.phone || '—',
    fuels: s.productKeys.length ? s.productKeys.map(productName).join(' · ') : 'All products',
    rating: Math.round(s.rating),
    leadTime: leadTimeLabel(s.leadTimeHours),
    lastOrder: shortDate(s.lastOrderAt),
  }
}

// ─────────────────────────────────────────────────────────────
// Bookings
// ─────────────────────────────────────────────────────────────

export type BookingStatus = 'New' | 'Accepted' | 'Scheduled' | 'In progress' | 'Completed' | 'Cancelled'

const BOOKING_STATUS: Record<BookingApiStatus, BookingStatus> = {
  pending: 'New',
  accepted: 'Accepted',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  rejected: 'Cancelled',
}

/** The action to send for a status the operator picked in the UI. */
export const BOOKING_ACTION: Record<string, 'accept' | 'reject' | 'schedule' | 'start' | 'complete' | 'cancel'> = {
  Accepted: 'accept',
  Scheduled: 'schedule',
  'In progress': 'start',
  Completed: 'complete',
  Cancelled: 'cancel',
}

export type BookingMethodLabel = 'Dockside' | 'Fuel Barge' | 'Fuel Truck' | 'Mobile Unit'

const METHOD_LABEL: Record<FuelMethod, BookingMethodLabel> = {
  dockside: 'Dockside',
  barge: 'Fuel Barge',
  truck: 'Fuel Truck',
  mobile_unit: 'Mobile Unit',
}
export const METHOD_VALUE: Record<BookingMethodLabel, FuelMethod> = {
  Dockside: 'dockside',
  'Fuel Barge': 'barge',
  'Fuel Truck': 'truck',
  'Mobile Unit': 'mobile_unit',
}
export const METHOD_LABELS = Object.keys(METHOD_VALUE) as BookingMethodLabel[]

const PRIORITY_LABEL: Record<FuelPriority, 'Low' | 'Medium' | 'High' | 'Critical'> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
}

export interface FuelBooking {
  id: string
  ref: string
  customer: string
  customerId?: string
  avatar: string
  boat: string
  boatLen: string
  fuel: string
  qty: number
  method: BookingMethodLabel
  location: string
  date: string
  time: string
  /** ISO of the scheduled slot, for round-tripping a reschedule. */
  scheduledAt?: string
  /**
   * The station's outstanding request to move this fill.
   *
   * Carried through the mapper explicitly — it lists every field it keeps, so
   * anything unnamed is dropped and the station loses both the reminder that it
   * asked and the only way to withdraw.
   */
  rescheduleProposal?: {
    status: 'pending' | 'accepted' | 'declined' | 'withdrawn'
    proposedStartAt: string
    reason?: string
    previousStartAt?: string
  }
  status: BookingStatus
  priority: 'Low' | 'Medium' | 'High' | 'Critical'
  emergency?: boolean
  amount: number
  notes?: string
  createdAt: string
  /** Whether the fuel order has been paid via HyperPay / settled */
  paid?: boolean
  paymentId?: string
}

/** A stable portrait for a record, so the same customer always looks the same. */
function portraitFor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  return avatar((hash % 70) + 1)
}

export function toBooking(b: ApiFuelBooking): FuelBooking {
  const customer = typeof b.customer === 'object' && b.customer ? b.customer : null
  const name = customer?.name ?? b.customerName ?? 'Walk-in'
  const isPaid = !!b.payment || (b as any).paymentStatus === 'paid' || b.status === 'completed'
  return {
    id: b._id,
    ref: b.bookingNo ?? b._id.slice(-6).toUpperCase(),
    customer: name,
    customerId: customer?._id,
    avatar: (customer?.avatar ? fileUrl(customer.avatar) : null) || portraitFor(customer?._id ?? name),
    boat: b.boatName ?? '—',
    boatLen: b.boatLengthFt ? `${b.boatLengthFt} ft` : '—',
    fuel: b.fuelType,
    qty: b.quantity,
    method: METHOD_LABEL[b.method] ?? 'Dockside',
    location: b.location ?? '—',
    date: shortDate(b.scheduledAt ?? b.createdAt),
    time: b.scheduledAt ? shortTime(b.scheduledAt) : b.emergency ? 'ASAP' : '—',
    scheduledAt: b.scheduledAt,
    rescheduleProposal: b.rescheduleProposal,
    status: BOOKING_STATUS[b.status] ?? 'New',
    priority: PRIORITY_LABEL[b.priority] ?? 'Medium',
    emergency: b.emergency,
    amount: b.totalAmount,
    notes: b.notes,
    createdAt: b.createdAt,
    paid: isPaid,
    paymentId: typeof b.payment === 'string' ? b.payment : (b.payment as any)?._id,
  }
}

// ─────────────────────────────────────────────────────────────
// Fleet & deliveries
// ─────────────────────────────────────────────────────────────

export type VehicleTypeLabel = 'Fuel Barge' | 'Fuel Truck' | 'Mobile Unit'
export type VehicleStatusLabel = 'On delivery' | 'Available' | 'Refilling' | 'Maintenance'

const VEHICLE_TYPE: Record<string, VehicleTypeLabel> = {
  barge: 'Fuel Barge',
  truck: 'Fuel Truck',
  mobile_unit: 'Mobile Unit',
}
export const VEHICLE_TYPE_VALUE: Record<VehicleTypeLabel, 'barge' | 'truck' | 'mobile_unit'> = {
  'Fuel Barge': 'barge',
  'Fuel Truck': 'truck',
  'Mobile Unit': 'mobile_unit',
}
const VEHICLE_STATUS: Record<string, VehicleStatusLabel> = {
  on_delivery: 'On delivery',
  available: 'Available',
  refilling: 'Refilling',
  maintenance: 'Maintenance',
}
const VEHICLE_ICON: Record<VehicleTypeLabel, string> = {
  'Fuel Barge': '🛳️',
  'Fuel Truck': '🚚',
  'Mobile Unit': '🛻',
}
const VEHICLE_IMAGE: Record<VehicleTypeLabel, string> = {
  'Fuel Barge': FIMG.barge,
  'Fuel Truck': FIMG.truck,
  'Mobile Unit': FIMG.station1,
}

export interface Vehicle {
  id: string
  name: string
  type: VehicleTypeLabel
  icon: string
  plate: string
  capacity: number
  load: number
  fuel: string
  status: VehicleStatusLabel
  driver: string
  driverAvatar: string
  speed: string
  lat: number
  lng: number
  image: string
}

export function toVehicle(v: ApiFuelVehicle): Vehicle {
  const driver = typeof v.driver === 'object' && v.driver ? v.driver : null
  const type = VEHICLE_TYPE[v.type] ?? 'Fuel Truck'
  const driverName = driver?.name ?? v.driverName ?? '—'
  return {
    id: v._id,
    name: v.name,
    type,
    icon: VEHICLE_ICON[type],
    plate: v.plate ?? '—',
    capacity: v.capacity,
    load: v.load,
    fuel: v.productKey ?? '',
    status: VEHICLE_STATUS[v.status] ?? 'Available',
    driver: driverName,
    driverAvatar: (driver?.avatar ? fileUrl(driver.avatar) : null) || portraitFor(driverName),
    speed: v.speed != null ? `${v.speed} ${v.speedUnit ?? 'kn'}` : '0 kn',
    lat: v.latitude ?? 0,
    lng: v.longitude ?? 0,
    image: (v.image ? fileUrl(v.image) : null) || VEHICLE_IMAGE[type],
  }
}

export type DeliveryStatusLabel = 'Assigned' | 'En route' | 'Fueling' | 'Completed' | 'Delayed' | 'Cancelled'

const DELIVERY_STATUS: Record<DeliveryStatus, DeliveryStatusLabel> = {
  assigned: 'Assigned',
  en_route: 'En route',
  fueling: 'Fueling',
  completed: 'Completed',
  delayed: 'Delayed',
  cancelled: 'Cancelled',
}
export const DELIVERY_STATUS_VALUE: Record<string, DeliveryStatus> = {
  Assigned: 'assigned',
  'En route': 'en_route',
  Fueling: 'fueling',
  Completed: 'completed',
  Delayed: 'delayed',
  Cancelled: 'cancelled',
}

export interface Delivery {
  id: string
  code: string
  bookingId: string
  bookingRef: string
  customer: string
  boat: string
  vehicle: string
  driver: string
  driverAvatar: string
  fuel: string
  qty: number
  status: DeliveryStatusLabel
  eta: string
  progress: number
  distance: string
  route: string
}

export function toDelivery(d: ApiFuelDelivery): Delivery {
  const booking = typeof d.booking === 'object' && d.booking ? d.booking : null
  const vehicle = typeof d.vehicle === 'object' && d.vehicle ? d.vehicle : null
  const pump = typeof d.pump === 'object' && d.pump ? d.pump : null
  const driver = typeof d.driver === 'object' && d.driver ? d.driver : null
  const driverName = driver?.name ?? d.driverName ?? '—'
  return {
    id: d._id,
    code: d.code,
    bookingId: booking?._id ?? (typeof d.booking === 'string' ? d.booking : ''),
    bookingRef: booking?.bookingNo ?? '—',
    customer: booking?.customer?.name ?? booking?.customerName ?? '—',
    boat: booking?.boatName ?? '—',
    // A dockside fill is dispatched to a pump rather than a vehicle.
    vehicle: vehicle?.name ?? pump?.name ?? 'Dockside',
    driver: driverName,
    driverAvatar: (driver?.avatar ? fileUrl(driver.avatar) : null) || portraitFor(driverName),
    fuel: d.productKey,
    qty: d.quantity,
    status: DELIVERY_STATUS[d.status] ?? 'Assigned',
    eta: d.status === 'fueling' ? 'now' : d.etaAt ? shortTime(d.etaAt) : '—',
    progress: d.progress,
    distance: d.distanceNm != null ? `${d.distanceNm} nm` : '—',
    route: d.route ?? (pump ? `Dockside · ${pump.name}` : '—'),
  }
}

// ─────────────────────────────────────────────────────────────
// Pumps & dispensing
// ─────────────────────────────────────────────────────────────

export type PumpStatusLabel = 'Online' | 'Dispensing' | 'Offline' | 'Calibration due'

export interface Pump {
  id: string
  code: string
  name: string
  fuel: string
  status: PumpStatusLabel
  flow: string
  totalizer: number
  calDue: string
  calibrationOverdue: boolean
}

export function toPump(p: ApiFuelPump): Pump {
  const label: Record<string, PumpStatusLabel> = { online: 'Online', dispensing: 'Dispensing', offline: 'Offline' }
  return {
    id: p._id,
    code: p.code,
    name: p.name,
    fuel: p.productKey,
    // Overdue calibration overrides whatever the operator last set — the
    // backend refuses to dispense through it either way.
    status: p.calibrationOverdue ? 'Calibration due' : (label[p.status] ?? 'Offline'),
    flow: p.flowRate != null ? `${p.flowRate} ${p.flowUnit ?? 'gal/min'}` : '—',
    totalizer: p.totalizer,
    calDue: p.calibrationDueAt ? shortDate(p.calibrationDueAt) : '—',
    calibrationOverdue: p.calibrationOverdue,
  }
}

export interface DispenseEntry {
  id: string
  code: string
  time: string
  pump: string
  fuel: string
  qty: number
  before: number
  after: number
  amount: number
  operator: string
  customer: string
  boat: string
}

export function toDispense(d: ApiFuelDispense): DispenseEntry {
  const pump = typeof d.pump === 'object' && d.pump ? d.pump : null
  const sameDay = new Date(d.dispensedAt).toDateString() === new Date().toDateString()
  return {
    id: d._id,
    code: d.code,
    time: sameDay ? shortTime(d.dispensedAt) : shortDate(d.dispensedAt),
    pump: pump?.code ?? '—',
    fuel: d.productKey,
    qty: d.quantity,
    before: d.totalizerBefore,
    after: d.totalizerAfter,
    amount: d.amount,
    operator: d.operatorName ?? '—',
    customer: d.customerName ?? 'Walk-in',
    boat: d.boatName ?? '—',
  }
}

// ─────────────────────────────────────────────────────────────
// Crew
// ─────────────────────────────────────────────────────────────

export const STAFF_ROLE_LABEL: Record<string, string> = {
  dock_fueler: 'Dock Fueler',
  barge_captain: 'Barge Captain',
  barge_mate: 'Barge Mate',
  truck_driver: 'Truck Driver',
  mobile_operator: 'Mobile Operator',
  dispatcher: 'Dispatcher',
  compliance_officer: 'Compliance Officer',
  manager: 'Manager',
}
export const STAFF_ROLE_VALUE = Object.fromEntries(
  Object.entries(STAFF_ROLE_LABEL).map(([k, v]) => [v, k]),
) as Record<string, string>

const STAFF_STATUS: Record<string, 'On duty' | 'Off duty' | 'On leave'> = {
  on_duty: 'On duty',
  off_duty: 'Off duty',
  on_leave: 'On leave',
}

export interface FuelStaff {
  id: string
  name: string
  role: string
  avatar: string
  status: 'On duty' | 'Off duty' | 'On leave'
  shift: string
  certs: string
}

export function toStaff(s: ApiFuelStaff): FuelStaff {
  return {
    id: s._id,
    name: s.name,
    role: STAFF_ROLE_LABEL[s.role] ?? s.role,
    avatar: (s.avatar ? fileUrl(s.avatar) : null) || portraitFor(s._id),
    status: STAFF_STATUS[s.status] ?? 'Off duty',
    shift: s.shift || '—',
    certs: s.certifications.length ? s.certifications.join(' · ') : '—',
  }
}

// ─────────────────────────────────────────────────────────────
// Billing
// ─────────────────────────────────────────────────────────────

export interface FuelInvoice {
  id: string
  number: string
  customer: string
  avatar: string
  date: string
  due: string
  items: string
  amount: number
  status: 'Paid' | 'Pending' | 'Overdue' | 'Refunded'
  method: string
  pdfUrl?: string
}

const INVOICE_STATUS: Record<string, FuelInvoice['status']> = {
  paid: 'Paid',
  pending: 'Pending',
  overdue: 'Overdue',
  refunded: 'Refunded',
}

export function toInvoice(i: ApiFuelInvoice): FuelInvoice {
  const customer = typeof i.customer === 'object' && i.customer ? i.customer : null
  const name = customer?.name ?? i.customerName ?? 'Walk-in'
  return {
    id: i._id,
    number: i.invoiceNumber,
    customer: name,
    avatar: (customer?.avatar ? fileUrl(customer.avatar) : null) || portraitFor(customer?._id ?? name),
    date: shortDate(i.createdAt),
    due: shortDate(i.dueAt),
    items: i.items.map((it) => it.description).join(' · ') || '—',
    amount: i.total,
    status: INVOICE_STATUS[i.status] ?? 'Pending',
    method: i.method || '—',
    pdfUrl: i.pdfUrl,
  }
}

export interface CreditAccount {
  id: string
  code: string
  company: string
  limit: number
  balance: number
  terms: string
  status: 'Good standing' | 'Watch' | 'On hold'
}

const CREDIT_STATUS: Record<string, CreditAccount['status']> = {
  good_standing: 'Good standing',
  watch: 'Watch',
  on_hold: 'On hold',
}
export const CREDIT_STATUS_VALUE = Object.fromEntries(
  Object.entries(CREDIT_STATUS).map(([k, v]) => [v, k]),
) as Record<string, string>

export function toCreditAccount(a: ApiCreditAccount): CreditAccount {
  return {
    id: a._id,
    code: a.code,
    company: a.company,
    limit: a.creditLimit,
    balance: a.balance,
    terms: `Net ${a.termsDays}`,
    status: CREDIT_STATUS[a.status] ?? 'Good standing',
  }
}

// ─────────────────────────────────────────────────────────────
// Pricing
// ─────────────────────────────────────────────────────────────

export interface PriceRule {
  id: string
  name: string
  icon: string
  desc: string
  value: string
  active: boolean
  kind: string
  raw: number
}

export function toPriceRule(r: ApiPriceRule): PriceRule {
  const sign = r.value > 0 ? '+' : r.value < 0 ? '−' : ''
  const magnitude = Math.abs(r.value)
  return {
    id: r._id,
    name: r.name,
    icon: r.icon,
    desc: r.description ?? '',
    // Index rules bound automatic movement in both directions, so they read ±.
    value: r.kind === 'percent' ? `${sign}${magnitude}%` : r.kind === 'index' ? `±${magnitude}%` : `${sign}${money(magnitude)}`,
    active: r.isActive,
    kind: r.kind,
    raw: r.value,
  }
}

// ─────────────────────────────────────────────────────────────
// Licences
// ─────────────────────────────────────────────────────────────

export type LicenceStatus = 'Valid' | 'Expiring soon' | 'Expired'

/** Licences inside 60 days of expiry are flagged before they lapse. */
export function licenceStatus(expiresAt?: string): LicenceStatus {
  if (!expiresAt) return 'Valid'
  const ms = new Date(expiresAt).getTime() - Date.now()
  if (Number.isNaN(ms)) return 'Valid'
  if (ms < 0) return 'Expired'
  return ms < 60 * 24 * 60 * 60 * 1000 ? 'Expiring soon' : 'Valid'
}

export interface Licence {
  name: string
  no: string
  exp: string
  status: LicenceStatus
  fileUrl?: string
}

export function toLicence(l: ApiStationLicense): Licence {
  return {
    name: l.name,
    no: l.reference ?? '—',
    exp: monthYear(l.expiresAt),
    status: licenceStatus(l.expiresAt),
    fileUrl: l.fileUrl,
  }
}

// ─────────────────────────────────────────────────────────────
// Notifications
// ─────────────────────────────────────────────────────────────

/** Icon + tone for a backend notification type, for the alert feed. */
export const NOTIF_STYLE: Record<string, { icon: string; tone: 'info' | 'success' | 'warn' | 'danger'; kind: string }> = {
  fuel_request: { icon: '⛽', tone: 'info', kind: 'New order' },
  booking_request: { icon: '⛽', tone: 'info', kind: 'New order' },
  booking_confirmed: { icon: '✅', tone: 'success', kind: 'Confirmed' },
  booking_cancelled: { icon: '🚫', tone: 'warn', kind: 'Cancelled' },
  booking_completed: { icon: '✅', tone: 'success', kind: 'Completed' },
  booking_modified: { icon: '✏️', tone: 'info', kind: 'Modified' },
  fuel_arriving: { icon: '🛳️', tone: 'info', kind: 'Delivery' },
  payment_success: { icon: '💵', tone: 'success', kind: 'Payment' },
  payment_refund: { icon: '↩️', tone: 'warn', kind: 'Refund' },
  emergency_sos: { icon: '🚨', tone: 'danger', kind: 'Emergency' },
  documents_expiring: { icon: '⚠️', tone: 'danger', kind: 'Compliance' },
  incident_reported: { icon: '⚠️', tone: 'danger', kind: 'Safety' },
  review_received: { icon: '⭐', tone: 'info', kind: 'Review' },
  staff_assigned: { icon: '👷', tone: 'info', kind: 'Crew' },
  general: { icon: '🔔', tone: 'info', kind: 'Notice' },
}

export function notifStyle(type: string) {
  return NOTIF_STYLE[type] ?? NOTIF_STYLE.general
}
