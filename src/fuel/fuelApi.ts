// ---------------------------------------------------------------------------
// Fuel provider portal — backend API client.
//
// Exposes the /fuel-portal surface on top of the shared transport in
// `src/api.ts`. No dummy data: every value the fuel portal renders comes from
// these calls.
//
// This file used to carry its own `fetch` wrapper, whose header claimed it
// mirrored `src/api.ts` "(same base URL, token and error handling)". It did
// not, and the four differences all landed on the operator:
//
//  · **No 401 refresh.** `api.ts` refreshes the access token and replays the
//    request; this one just threw. With `JWT_ACCESS_EXPIRES` at an hour, a
//    fuel operator was hard-failed on every call an hour into their shift,
//    with no way out but a reload.
//  · **Bare `Error`, not `ApiError`.** Every `kind`/`status` branch in
//    `async/errors.ts` was inert here — including the `cancelled` check
//    `useAsync` relies on to avoid reporting a superseded request as a failure.
//  · **Server text shown verbatim, at every status.** `apiErrorFromResponse`
//    deliberately does not trust 5xx or auth messages because they are internal
//    detail; the fuel portal put them in front of the user.
//  · **No activity tracking**, so the global route-progress bar never moved for
//    anything the fuel portal did.
//
// `api/platform.ts` already did this correctly and says why: one auth path, one
// refresh-on-401, one error shape. This is that, for /fuel-portal.
// ---------------------------------------------------------------------------
import {
  buildQueryString,
  qs,
  request as apiRequest,
  type ApiRequestOptions,
  type QueryParams,
} from '../api'

/** Every path here is relative to the portal's own mount point. */
const request = <T,>(path: string, options: ApiRequestOptions = {}): Promise<T> =>
  apiRequest<T>(`/fuel-portal${path}`, options)

const get = <T>(p: string, params?: QueryParams, options: ApiRequestOptions = {}) =>
  request<T>(`${p}${buildQueryString(params)}`, { ...options, method: 'GET' })
const post = <T>(p: string, b?: unknown) =>
  request<T>(p, { method: 'POST', body: b instanceof FormData ? b : JSON.stringify(b ?? {}) })
// FormData passes straight through, exactly as `post` already does. Stringifying
// it produced the literal "[object FormData]" as the request body, so any PATCH
// carrying a file — the worker avatar upload below is the first — silently sent
// nothing. `request` already omits Content-Type for form bodies so the browser
// can set its own multipart boundary.
const patch = <T>(p: string, b?: unknown) =>
  request<T>(p, { method: 'PATCH', body: b instanceof FormData ? b : JSON.stringify(b ?? {}) })
const put = <T>(p: string, b?: unknown) => request<T>(p, { method: 'PUT', body: JSON.stringify(b ?? {}) })
const del = <T>(p: string) => request<T>(p, { method: 'DELETE' })

interface Ok<T> {
  success: boolean
  data: T
}
export interface Paged<T> {
  items: T[]
  pagination: { page: number; limit: number; total: number; totalPages: number }
}

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------
export type ProductUnit = 'gal' | 'L' | 'kg' | 'kWh' | 'qt'

export interface ApiFuelProduct {
  _id: string
  id?: string
  key: string
  name: string
  nameAr?: string
  icon: string
  color: string
  price: number
  unit: ProductUnit
  bulk: boolean
  isActive: boolean
  sortOrder: number
}

export type TankStatus = 'healthy' | 'low' | 'critical' | 'maintenance'

export interface ApiFuelTank {
  _id: string
  id?: string
  code: string
  station?: { _id: string; id?: string; name: string; city?: string } | string
  productKey: string
  capacity: number
  stock: number
  reorderAt: number
  batch?: string
  supplier?: { _id: string; name: string; leadTimeHours?: number } | string
  location?: string
  lastRefillAt?: string
  expiresAt?: string
  temperatureC?: number
  waterPct?: number
  sensorSyncedAt?: string
  underMaintenance: boolean
  status: TankStatus
}

export interface ApiFuelSupplier {
  _id: string
  id?: string
  name: string
  contactName?: string
  phone?: string
  email?: string
  productKeys: string[]
  rating: number
  leadTimeHours: number
  wholesalePrice?: number
  notes?: string
  lastOrderAt?: string
  isActive: boolean
}

export type VehicleType = 'barge' | 'truck' | 'mobile_unit'
export type VehicleStatus = 'available' | 'on_delivery' | 'refilling' | 'maintenance'

export interface ApiFuelVehicle {
  _id: string
  id?: string
  name: string
  type: VehicleType
  plate?: string
  capacity: number
  load: number
  productKey?: string
  status: VehicleStatus
  driver?: { _id: string; name: string; avatar?: string; phone?: string } | string
  driverName?: string
  latitude?: number
  longitude?: number
  speed?: number
  speedUnit?: string
  positionAt?: string
  image?: string
}

export type PumpStatus = 'online' | 'dispensing' | 'offline'

export interface ApiFuelPump {
  _id: string
  id?: string
  code: string
  name: string
  productKey: string
  status: PumpStatus
  flowRate?: number
  flowUnit?: string
  totalizer: number
  calibrationDueAt?: string
  lastCalibratedAt?: string
  calibrationOverdue: boolean
}

export interface ApiFuelDispense {
  _id: string
  id?: string
  code: string
  pump?: { _id: string; code: string; name: string } | string
  productKey: string
  quantity: number
  unitPrice: number
  amount: number
  totalizerBefore: number
  totalizerAfter: number
  operatorName?: string
  customerName?: string
  boatName?: string
  dispensedAt: string
}

export type BookingApiStatus =
  | 'pending'
  | 'accepted'
  | 'scheduled'
  | 'rejected'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
export type FuelMethod = 'dockside' | 'barge' | 'truck' | 'mobile_unit'
export type FuelPriority = 'low' | 'medium' | 'high' | 'critical'

export interface ApiFuelBooking {
  _id: string
  id?: string
  bookingNo?: string
  customer?: { _id: string; name: string; email?: string; phone?: string; avatar?: string } | string
  customerName?: string
  boatName?: string
  boatLengthFt?: number
  fuelType: string
  quantity: number
  pricePerLiter: number
  totalAmount: number
  method: FuelMethod
  priority: FuelPriority
  emergency: boolean
  location?: string
  scheduledAt?: string
  /**
   * This station's outstanding request to move the fill.
   *
   * Separate from `scheduledAt`, which is what is *agreed*. A pending proposal
   * leaves `scheduledAt` exactly where it was until the owner accepts.
   */
  rescheduleProposal?: {
    status: 'pending' | 'accepted' | 'declined' | 'withdrawn'
    proposedStartAt: string
    reason?: string
    previousStartAt?: string
  }
  status: BookingApiStatus
  payment?: any
  notes?: string
  createdAt: string
  completedAt?: string
}

export type DeliveryStatus = 'assigned' | 'en_route' | 'fueling' | 'completed' | 'delayed' | 'cancelled'

export interface ApiFuelDelivery {
  _id: string
  id?: string
  code: string
  booking:
    | (Pick<ApiFuelBooking, '_id' | 'bookingNo' | 'boatName' | 'customerName' | 'location' | 'quantity' | 'fuelType'> & {
        customer?: { name?: string; avatar?: string }
      })
    | string
  vehicle?: { _id: string; name: string; type: VehicleType; latitude?: number; longitude?: number } | string
  pump?: { _id: string; code: string; name: string } | string
  driver?: { _id: string; name: string; avatar?: string; phone?: string } | string
  driverName?: string
  productKey: string
  quantity: number
  status: DeliveryStatus
  progress: number
  etaAt?: string
  distanceNm?: number
  route?: string
  completedAt?: string
}

export interface ApiPurchaseOrder {
  _id: string
  id?: string
  code: string
  supplier?: { _id: string; name: string; leadTimeHours?: number } | string
  supplierName?: string
  tank?: { _id: string; code: string; productKey: string } | string
  productKey: string
  quantity: number
  unitCost?: number
  totalCost?: number
  batch?: string
  deliveryWindow?: string
  expectedAt?: string
  status: 'draft' | 'sent' | 'confirmed' | 'delivered' | 'cancelled'
  receivedQuantity?: number
  notes?: string
  createdAt: string
}

export type StaffRole =
  | 'dock_fueler'
  | 'barge_captain'
  | 'barge_mate'
  | 'truck_driver'
  | 'mobile_operator'
  | 'dispatcher'
  | 'compliance_officer'
  | 'manager'
export type StaffStatus = 'on_duty' | 'off_duty' | 'on_leave'

export interface ApiFuelStaff {
  _id: string
  id?: string
  name: string
  role: StaffRole
  status: StaffStatus
  phone?: string
  email?: string
  avatar?: string
  shift?: string
  certifications: string[]
}

export interface ApiPriceRule {
  _id: string
  id?: string
  name: string
  icon: string
  description?: string
  kind: 'percent' | 'fixed' | 'index'
  value: number
  productKeys: string[]
  minQuantity?: number
  memberTiers: string[]
  commercialOnly: boolean
  afterHoursOnly: boolean
  priority: number
  isActive: boolean
}

export interface ApiFuelCoupon {
  _id: string
  code: string
  description?: string
  discountPct: number
  scope: string
  expiresAt?: string
  usageLimit?: number
  usedCount: number
  isActive: boolean
}

export interface ApiStationTax {
  name: string
  ratePct?: number
  fixedPerUnit?: number
  productKeys: string[]
}

export interface ApiStationLicense {
  name: string
  reference?: string
  issuedAt?: string
  expiresAt?: string
  fileUrl?: string
}

export interface ApiStationHours {
  label: string
  hours: string
}

export interface ApiStationContact {
  name: string
  phone: string
  kind?: string
}

export interface ApiFuelStation {
  /** FuelStation is the one fuel model whose toJSON renames `_id` to `id` — never read `._id` on it. */
  id: string
  name: string
  nameAr?: string
  legalName?: string
  stationType?: string
  tagline?: string
  foundedYear?: number
  address: string
  area?: string
  city?: string
  region?: string
  logo?: string
  latitude: number
  longitude: number
  contactNumber?: string
  email?: string
  website?: string
  vhfChannel?: string
  operatingHours?: string
  open24h: boolean
  delivery: boolean
  deliveryFeeSar: number
  serviceRadius?: string
  serviceAreas: string[]
  hours: ApiStationHours[]
  licenses: ApiStationLicense[]
  emergencyContacts: ApiStationContact[]
  taxes: ApiStationTax[]
  currency: string
  wholesaleIndex?: number
  images: string[]
  imagesCategorized: { url: string; category?: string }[]
  services: string[]
  ratingAvg: number
  ratingCount: number
  isActive: boolean
  approvalStatus?: 'draft' | 'pending' | 'approved' | 'rejected'
  approvalReason?: string
  reviewedBy?: any
  reviewedAt?: string
  rejectionReason?: string
  isPublished?: boolean
  publishedAt?: string
  completeness?: any
  bank?: any
  emergencyEmail?: string
  emergencyProceduresText?: string
  emergencyDeliveryFeeSar?: number
}

/** One row of the parent-company "All Stations" rollup — a snapshot, not the full profile. */
export interface ApiStationSummary {
  id: string
  name: string
  city?: string
  address: string
  isActive: boolean
  currency: string
  tanks: number
  lowStockTanks: number
  pumps: number
  staff: number
  pendingBookings: number
  revenueMonth: number
  netMonth: number
}

export interface ApiStationsOverviewTotals {
  tanks: number
  lowStockTanks: number
  pumps: number
  staff: number
  pendingBookings: number
  revenueMonth: number
  netMonth: number
}

export interface ApiFuelInvoice {
  _id: string
  id?: string
  invoiceNumber: string
  customer?: { _id: string; name: string; email?: string; avatar?: string } | string
  customerName?: string
  items: { description: string; quantity: number; unitPrice: number; total: number }[]
  subtotal: number
  vatRate: number
  vatAmount: number
  total: number
  currency: string
  dueAt?: string
  method?: string
  payment?: { status: string; method?: string; paidAt?: string } | string
  pdfUrl?: string
  createdAt: string
  /** Server-derived: paid · pending · overdue · refunded. */
  status: 'paid' | 'pending' | 'overdue' | 'refunded'
}

export interface ApiCreditAccount {
  _id: string
  id?: string
  code: string
  company: string
  customer?: { _id: string; name: string; email?: string; avatar?: string } | string
  contactName?: string
  phone?: string
  email?: string
  creditLimit: number
  balance: number
  available: number
  termsDays: number
  status: 'good_standing' | 'watch' | 'on_hold'
}

export interface ApiFuelWeather {
  temperature: number | null
  windSpeed: number | null
  windGust: number | null
  windDirection: number | null
  humidity: number | null
  visibilityKm: number | null
  weatherCode: number | null
  isDay: boolean
  sunrise: string | null
  sunset: string | null
  uvIndex: number | null
  waveHeight: number | null
  seaTemperature: number | null
  warning: string | null
  updatedAt: string
}

export interface ApiFuelNotification {
  _id: string
  type: string
  title: string
  titleAr?: string
  body: string
  bodyAr?: string
  data?: Record<string, unknown>
  isRead: boolean
  createdAt: string
}

export interface ApiFuelOverview {
  station: ApiFuelStation | null
  currency: string
  products: ApiFuelProduct[]
  tanks: ApiFuelTank[]
  pumps: ApiFuelPump[]
  vehicles: ApiFuelVehicle[]
  staff: ApiFuelStaff[]
  onDutyStaff: number
  pendingBookings: ApiFuelBooking[]
  emergencyBooking: ApiFuelBooking | null
  activeDeliveries: ApiFuelDelivery[]
  /** Accepted, scheduled or fuelling — boats due at, or alongside, the fuel dock. */
  openOrders?: ApiFuelBooking[]
  alerts: ApiFuelNotification[]
  kpis: {
    revenueMonth: number
    netMonth: number
    salesToday: number
    volumeToday: number
    pendingOrders: number
    /** Orders taken and not yet finished. Absent from a backend older than station-only fuel. */
    openOrders?: number
    activeDeliveries: number
    completedToday: number
    lowStockAlerts: number
    openPurchaseOrders: number
    calibrationOverdue: number
  }
  charts: {
    hourly: { h: string; gal: number; amount: number }[]
    monthly: { m: string; diesel: number; petrol: number; other: number }[]
    soldToday: Record<string, number>
  }
}

export interface ApiFuelReports {
  range: { from: string; to: string }
  currency: string
  products: Pick<ApiFuelProduct, 'key' | 'name' | 'icon' | 'color' | 'unit'>[]
  byProduct: { productKey: string; quantity: number; revenue: number; fills: number }[]
  byMonth: { month: string; quantity: number; revenue: number }[]
  byHour: { hour: number; quantity: number; revenue: number }[]
  byWeek: { week: string; productKey: string; quantity: number }[]
  topCustomers: { id: string | null; name: string; email?: string; avatar?: string; quantity: number; spend: number; fills: number }[]
  deliveryPerformance: { d: string; onTime: number; late: number }[]
  totals: { quantity: number; revenue: number; fills: number; deliveries: number; onTimeRate: number }
}

export interface ApiFuelCalendarEvent {
  date: string
  kind: string
  label: string
  tone: string
  refId?: string
}

export type FuelEventKind = 'barge' | 'truck' | 'refill' | 'pricing' | 'maintenance'

/** An event the operator booked by hand, as opposed to one derived from a record. */
export interface ApiScheduledEvent {
  _id: string
  id?: string
  title: string
  kind: FuelEventKind
  startsAt: string
  endsAt?: string
  notes?: string
  done: boolean
}

export const FUEL_WORKER_PERMISSIONS = [
  'calendar',
  'tracking',
  'bookings',
  'deliveries',
  'inventory',
  'pricing',
  'billing',
  'reports',
  'messages',
  'notifications',
  'station',
] as const
export type FuelWorkerPermission = (typeof FUEL_WORKER_PERMISSIONS)[number]
export type FuelWorkerStatus = 'invited' | 'pending_approval' | 'active' | 'disabled'
export type FuelWorkerApprovalStatus = 'pending' | 'approved' | 'rejected'

export interface ApiWorkerStation {
  id: string
  name: string
  nameAr?: string
  city?: string
  cityAr?: string
  address?: string
}

export interface ApiFuelWorker {
  _id: string
  id?: string
  name: string
  email: string
  avatar?: string
  phone?: string
  role?: string
  dutyStatus?: 'on_duty' | 'off_duty' | 'on_leave'
  /** Populated by the API as an object; only ever sent back to the API as an id string. */
  station?: ApiWorkerStation | string
  licenseNo?: string
  certifications?: string[]
  notes?: string
  permissions: FuelWorkerPermission[]
  status: FuelWorkerStatus
  approvalStatus?: FuelWorkerApprovalStatus
  reviewedBy?: string
  reviewedAt?: string
  rejectionReason?: string
  invitedAt: string
  acceptedAt?: string
  user?: { _id: string; name: string; email: string; avatar?: string; isActive: boolean } | string
}

export interface ApiFuelAccess {
  isOwner: boolean
  permissions: FuelWorkerPermission[]
}

export interface ApiFuelQuote {
  productKey: string
  unit: string
  quantity: number
  listUnitPrice: number
  netUnitPrice: number
  gross: number
  adjustments: { name: string; icon: string; kind: string; value: number; amount: number }[]
  taxes: { name: string; amount: number }[]
  taxTotal: number
  total: number
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------
export const fuelApi = {
  // Dashboard & live ops
  overview: (stationId?: string, all?: boolean, options?: ApiRequestOptions) =>
    get<Ok<ApiFuelOverview>>('/overview', { stationId, all }, options),
  tracking: (stationId?: string) =>
    get<
      Ok<{
        depot: { name: string; latitude: number; longitude: number; address: string } | null
        vehicles: ApiFuelVehicle[]
        deliveries: ApiFuelDelivery[]
      }>
    >('/tracking', { stationId }),
  weather: () => get<Ok<{ weather: ApiFuelWeather; cached?: boolean }>>('/weather'),
  ticker: (stationId?: string, all?: boolean, options?: ApiRequestOptions) =>
    get<Ok<{ ticker: string[] }>>('/ticker', { stationId, all }, options),
  search: (q: string) =>
    get<Ok<{ results: { kind: string; id: string; title: string; subtitle?: string; href: string }[] }>>('/search', { q }),
  calendar: (month?: string) =>
    get<
      Ok<{
        month: string
        events: ApiFuelCalendarEvent[]
        scheduled: ApiScheduledEvent[]
        /** Dispensed volume keyed by YYYY-MM-DD, for the demand heatmap. */
        demand: Record<string, number>
      }>
    >('/calendar', { month }),
  createCalendarEvent: (data: { title: string; kind: FuelEventKind; startsAt: string; notes?: string }) =>
    post<Ok<{ event: ApiScheduledEvent }>>('/calendar/events', data),
  updateCalendarEvent: (id: string, data: Partial<ApiScheduledEvent>) =>
    patch<Ok<{ event: ApiScheduledEvent }>>(`/calendar/events/${id}`, data),
  deleteCalendarEvent: (id: string) => del<Ok<unknown>>(`/calendar/events/${id}`),
  reports: (params?: { from?: string; to?: string; stationId?: string; all?: boolean }) => get<Ok<ApiFuelReports>>('/reports', params),

  // Station profile & settings
  station: (params?: { stationId?: string }) =>
    get<Ok<{ station: ApiFuelStation | null; stations: ApiFuelStation[]; stats: { pumps: number; tanks: number; staff: number; rating: number; ratingCount: number } }>>(
      '/station',
      params,
    ),
  /** Parent-company rollup: one summary row per station, for the "All Stations" overview. */
  stationsOverview: () => get<Ok<{ stations: ApiStationSummary[]; totals: ApiStationsOverviewTotals }>>('/stations-overview'),
  saveStation: (data: Partial<ApiFuelStation> & { createMode?: boolean; stationId?: string }, params?: { stationId?: string }) =>
    post<Ok<{ station: ApiFuelStation; stations: ApiFuelStation[] }>>(`/station${qs(params)}`, data),
  deleteStationLocation: (id: string) => del<Ok<{ stations: ApiFuelStation[] }>>(`/stations/${id}`),
  uploadStationImages: (files: File[], stationId?: string, category?: string) => {
    const fd = new FormData()
    files.forEach((f) => fd.append('images', f))
    if (category) fd.append('category', category)
    return post<Ok<{ images: string[]; imagesCategorized: { url: string; category?: string }[] }>>(`/station/images${qs({ stationId })}`, fd)
  },
  deleteStationImage: (url: string, stationId?: string) =>
    del<Ok<{ images: string[]; imagesCategorized: { url: string; category?: string }[] }>>(`/station/images${qs({ stationId, url })}`),
  submitStationForApproval: (stationId?: string) =>
    post<Ok<{ station: ApiFuelStation; completeness: any; message: string }>>('/station/submit-for-approval', { stationId }),
  publishStation: (stationId?: string) =>
    post<Ok<{ station: ApiFuelStation; completeness: any; message: string }>>('/station/publish', { stationId }),
  unpublishStation: (stationId?: string) =>
    post<Ok<{ station: ApiFuelStation; completeness: any; message: string }>>('/station/unpublish', { stationId }),
  settings: (stationId?: string) => get<Ok<{ station: ApiFuelStation | null; user: any; suppliers: ApiFuelSupplier[] }>>('/settings', { stationId }),
  updateSettings: (data: Partial<ApiFuelStation> & { stationId?: string }) => patch<Ok<{ station: ApiFuelStation }>>('/settings', data),

  // Catalogue
  products: () => get<Ok<{ products: ApiFuelProduct[] }>>('/products'),
  createProduct: (data: Partial<ApiFuelProduct> & { key: string; name: string; price: number }) =>
    post<Ok<{ product: ApiFuelProduct }>>('/products', data),
  updateProduct: (id: string, data: Partial<ApiFuelProduct>) => patch<Ok<{ product: ApiFuelProduct }>>(`/products/${id}`, data),
  deleteProduct: (id: string) => del<Ok<unknown>>(`/products/${id}`),

  // Suppliers
  suppliers: () => get<Ok<{ suppliers: ApiFuelSupplier[] }>>('/suppliers'),
  createSupplier: (data: Partial<ApiFuelSupplier> & { name: string }) => post<Ok<{ supplier: ApiFuelSupplier }>>('/suppliers', data),
  updateSupplier: (id: string, data: Partial<ApiFuelSupplier>) => patch<Ok<{ supplier: ApiFuelSupplier }>>(`/suppliers/${id}`, data),
  deleteSupplier: (id: string) => del<Ok<unknown>>(`/suppliers/${id}`),

  // Inventory
  inventory: (stationId?: string, all?: boolean) =>
    get<
      Ok<{
        station: ApiFuelStation | null
        stations?: ApiFuelStation[]
        products: ApiFuelProduct[]
        tanks: ApiFuelTank[]
        suppliers: ApiFuelSupplier[]
        openOrders: ApiPurchaseOrder[]
        stockByProduct: Record<string, { stock: number; capacity: number }>
        soldByProduct: Record<string, number>
        totals: { stock: number; capacity: number; tanks: number; lowTanks: number }
      }>
    >('/inventory', { stationId, all }),
  createTank: (data: {
    code: string
    stationId: string // REQUIRED: Every tank must belong to a specific station
    productKey: string
    capacity: number
    stock?: number
    reorderAt?: number
    supplier?: string
    location?: string
    batch?: string
    expiresAt?: string
    temperatureC?: number
    waterPct?: number
  }) => post<Ok<{ tank: ApiFuelTank }>>('/tanks', data),
  updateTank: (id: string, data: Partial<ApiFuelTank> & { supplier?: string; stationId?: string; station?: string }) => patch<Ok<{ tank: ApiFuelTank }>>(`/tanks/${id}`, data),
  deleteTank: (id: string) => del<Ok<unknown>>(`/tanks/${id}`),
  syncSensors: (readings: { tankId?: string; code?: string; stock?: number; temperatureC?: number; waterPct?: number }[] = []) =>
    post<Ok<{ tanks: ApiFuelTank[]; updated: number; syncedAt: string }>>('/tanks/sync-sensors', { readings }),
  tankLog: (id: string) =>
    get<Ok<{ tank: ApiFuelTank; refills: ApiPurchaseOrder[]; dispenses: ApiFuelDispense[] }>>(`/tanks/${id}/log`),

  // Purchase orders
  purchaseOrders: (params?: { status?: string; stationId?: string; page?: number; limit?: number }) =>
    get<Ok<Paged<ApiPurchaseOrder>>>('/purchase-orders', params),
  createPurchaseOrder: (data: {
    tankId?: string
    tankIds?: string[]
    supplierId?: string
    quantity?: number
    batch?: string
    deliveryWindow?: string
    notes?: string
  }) => post<Ok<{ orders: ApiPurchaseOrder[]; count: number }>>('/purchase-orders', data),
  receivePurchaseOrder: (id: string, data?: { receivedQuantity?: number; batch?: string; expiresAt?: string }) =>
    post<Ok<{ order: ApiPurchaseOrder; tank: ApiFuelTank | null }>>(`/purchase-orders/${id}/receive`, data ?? {}),
  cancelPurchaseOrder: (id: string) => del<Ok<{ order: ApiPurchaseOrder }>>(`/purchase-orders/${id}`),

  // Pumps & dispensing
  pumps: (stationId?: string) => get<Ok<{ pumps: ApiFuelPump[] }>>('/pumps', { stationId }),
  createPump: (data: { code: string; stationId?: string; name: string; productKey: string; flowRate?: number; flowUnit?: string }) =>
    post<Ok<{ pump: ApiFuelPump }>>('/pumps', data),
  updatePump: (id: string, data: Partial<ApiFuelPump>) => patch<Ok<{ pump: ApiFuelPump }>>(`/pumps/${id}`, data),
  calibratePump: (id: string, nextDueAt?: string) => post<Ok<{ pump: ApiFuelPump }>>(`/pumps/${id}/calibrate`, { nextDueAt }),
  deletePump: (id: string) => del<Ok<unknown>>(`/pumps/${id}`),
  dispenses: (params?: { pumpId?: string; productKey?: string; stationId?: string; page?: number; limit?: number }) =>
    get<Ok<Paged<ApiFuelDispense>>>('/dispenses', params),
  recordDispense: (data: {
    stationId?: string
    pumpId?: string
    tankId?: string
    bookingId?: string
    productKey?: string
    quantity: number
    customerName?: string
    boatName?: string
    operatorName?: string
  }) => post<Ok<{ dispense: ApiFuelDispense; quote: ApiFuelQuote }>>('/dispenses', data),

  // Fleet
  vehicles: (stationId?: string) =>
    get<Ok<{ vehicles: ApiFuelVehicle[]; depot: { name: string; latitude: number; longitude: number } | null }>>('/vehicles', { stationId }),
  createVehicle: (data: Partial<ApiFuelVehicle> & { name: string; type: VehicleType; capacity: number }) =>
    post<Ok<{ vehicle: ApiFuelVehicle }>>('/vehicles', data),
  updateVehicle: (id: string, data: Partial<ApiFuelVehicle> & { driver?: string }) =>
    patch<Ok<{ vehicle: ApiFuelVehicle }>>(`/vehicles/${id}`, data),
  updateVehiclePosition: (id: string, data: { latitude?: number; longitude?: number; speed?: number; progress?: number }) =>
    patch<Ok<{ vehicle: ApiFuelVehicle }>>(`/vehicles/${id}/position`, data),
  deleteVehicle: (id: string) => del<Ok<unknown>>(`/vehicles/${id}`),

  // Dispatch
  deliveries: (params?: { status?: string; stationId?: string; page?: number; limit?: number }) =>
    get<Ok<Paged<ApiFuelDelivery> & { statusCounts: Record<string, number> }>>('/deliveries', params),
  createDelivery: (data: {
    bookingId: string
    vehicleId?: string
    pumpId?: string
    driverId?: string
    etaAt?: string
    distanceNm?: number
    route?: string
    notes?: string
  }) => post<Ok<{ delivery: ApiFuelDelivery }>>('/deliveries', data),
  updateDelivery: (id: string, data: { status?: DeliveryStatus; progress?: number; etaAt?: string; route?: string; delayReason?: string }) =>
    patch<Ok<{ delivery: ApiFuelDelivery }>>(`/deliveries/${id}`, data),
  deleteDelivery: (id: string) => del<Ok<unknown>>(`/deliveries/${id}`),

  // Order desk
  bookings: (params?: { status?: string; search?: string; emergency?: boolean; stationId?: string; page?: number; limit?: number }) =>
    get<
      Ok<Paged<ApiFuelBooking> & { statusCounts: Record<string, number>; deliveryByBooking: Record<string, ApiFuelDelivery> }>
    >('/bookings', params),
  booking: (id: string) =>
    get<Ok<{ booking: ApiFuelBooking; deliveries: ApiFuelDelivery[]; dispenses: ApiFuelDispense[] }>>(`/bookings/${id}`),
  createBooking: (data: {
    stationId?: string
    productKey: string
    quantity: number
    customerName?: string
    customerEmail?: string
    boatName?: string
    boatLengthFt?: number
    method?: FuelMethod
    priority?: FuelPriority
    emergency?: boolean
    location?: string
    scheduledAt?: string
    notes?: string
  }) => post<Ok<{ booking: ApiFuelBooking; quote: ApiFuelQuote }>>('/bookings', data),
  updateBooking: (id: string, data: Partial<Pick<ApiFuelBooking, 'quantity' | 'location' | 'method' | 'priority' | 'notes' | 'boatName' | 'customerName'>> & { scheduledAt?: string }) =>
    patch<Ok<{ booking: ApiFuelBooking }>>(`/bookings/${id}`, data),
  bookingAction: (
    id: string,
    action: 'accept' | 'reject' | 'schedule' | 'start' | 'complete' | 'cancel',
    extra?: { reason?: string; scheduledAt?: string; method?: string },
  ) => patch<Ok<{ booking: ApiFuelBooking }>>(`/bookings/${id}/status`, { action, ...extra }),
  /**
   * Ask the owner to move a fill, and take the ask back.
   *
   * `updateBooking` above accepts a `scheduledAt` and rewrites it outright —
   * that moves a delivery the owner planned around, and they only learn of it
   * afterwards. These leave `scheduledAt` alone until the owner accepts from
   * their own app. There is no `respond` here: that route is the owner's.
   */
  proposeBookingReschedule: (id: string, body: { proposedStartAt: string; reason?: string }) =>
    patch<Ok<{ booking: ApiFuelBooking }>>(`/bookings/${id}/reschedule-proposal`, body),
  withdrawBookingReschedule: (id: string) =>
    patch<Ok<{ booking: ApiFuelBooking }>>(`/bookings/${id}/reschedule-proposal/withdraw`, {}),
  sendBookingPaymentReminder: (bookingId: string) => post<Ok<{ message: string }>>(`/bookings/${bookingId}/remind-payment`, {}),
  sendDeliveryPaymentReminder: (deliveryId: string) => post<Ok<{ message: string }>>(`/deliveries/${deliveryId}/remind-payment`, {}),

  // Staff (on-duty roster)
  staff: (stationId?: string) => get<Ok<{ staff: ApiFuelStaff[] }>>('/staff', { stationId }),
  createStaff: (data: Partial<ApiFuelStaff> & { name: string; role: string; stationId?: string }) => post<Ok<{ staff: ApiFuelStaff }>>('/staff', data),
  updateStaff: (id: string, data: Partial<ApiFuelStaff>) => patch<Ok<{ staff: ApiFuelStaff }>>(`/staff/${id}`, data),
  deleteStaff: (id: string) => del<Ok<unknown>>(`/staff/${id}`),

  // Pricing
  pricing: (stationId?: string, all?: boolean) =>
    get<
      Ok<{
        products: ApiFuelProduct[]
        rules: ApiPriceRule[]
        coupons: ApiFuelCoupon[]
        taxes: ApiStationTax[]
        currency: string
        wholesaleIndex: number | null
      }>
    >('/pricing', { stationId, all }),
  quote: (data: { stationId?: string; productKey: string; quantity: number; commercial?: boolean; memberTier?: string }) =>
    post<Ok<{ quote: ApiFuelQuote; currency: string }>>('/pricing/quote', data),
  createPriceRule: (data: Partial<ApiPriceRule> & { name: string; kind: string; value: number }) =>
    post<Ok<{ rule: ApiPriceRule }>>('/pricing/rules', data),
  updatePriceRule: (id: string, data: Partial<ApiPriceRule>) => patch<Ok<{ rule: ApiPriceRule }>>(`/pricing/rules/${id}`, data),
  deletePriceRule: (id: string) => del<Ok<unknown>>(`/pricing/rules/${id}`),
  setTaxes: (taxes: ApiStationTax[]) => put<Ok<{ taxes: ApiStationTax[] }>>('/pricing/taxes', { taxes }),
  createCoupon: (data: { code: string; description?: string; discountPct: number; expiresAt?: string; usageLimit?: number }) =>
    post<Ok<{ coupon: ApiFuelCoupon }>>('/pricing/coupons', data),
  updateCoupon: (id: string, data: Partial<ApiFuelCoupon>) => patch<Ok<{ coupon: ApiFuelCoupon }>>(`/pricing/coupons/${id}`, data),
  deleteCoupon: (id: string) => del<Ok<unknown>>(`/pricing/coupons/${id}`),

  // Billing
  billing: (params?: { page?: number; limit?: number }) =>
    get<
      Ok<
        Paged<ApiFuelInvoice> & {
          creditAccounts: ApiCreditAccount[]
          currency: string
          totals: {
            month: number
            commission: number
            net: number
            count: number
            outstanding: number
            creditExposure: number
          }
        }
      >
    >('/billing', params),
  createInvoice: (data: {
    bookingId?: string
    customerId?: string
    customerName?: string
    creditAccountId?: string
    method?: string
    termsDays?: number
    items?: { description: string; quantity: number; unitPrice: number; total: number }[]
  }) => post<Ok<{ invoice: ApiFuelInvoice }>>('/billing/invoices', data),
  payInvoice: (id: string, method?: string, creditAccountId?: string) =>
    post<Ok<{ invoice: ApiFuelInvoice }>>(`/billing/invoices/${id}/pay`, { method, creditAccountId }),
  refundInvoice: (id: string, amount?: number) => post<Ok<{ invoice: ApiFuelInvoice }>>(`/billing/invoices/${id}/refund`, { amount }),

  createCreditAccount: (data: Partial<ApiCreditAccount> & { company: string; creditLimit: number }) =>
    post<Ok<{ account: ApiCreditAccount }>>('/credit-accounts', data),
  updateCreditAccount: (id: string, data: Partial<ApiCreditAccount>) =>
    patch<Ok<{ account: ApiCreditAccount }>>(`/credit-accounts/${id}`, data),
  deleteCreditAccount: (id: string) => del<Ok<unknown>>(`/credit-accounts/${id}`),

  // Team & access
  myAccess: () => get<Ok<ApiFuelAccess>>('/my-access'),
}

export const fuelWorkersApi = {
  list: (params?: { stationId?: string }) =>
    get<Ok<{ workers: ApiFuelWorker[]; permissionKeys: FuelWorkerPermission[] }>>('/workers', params),
  invite: (data: {
    name: string
    email: string
    permissions: FuelWorkerPermission[]
    avatar?: string
    phone?: string
    role?: string
    dutyStatus?: 'on_duty' | 'off_duty' | 'on_leave'
    station?: string
    licenseNo?: string
    notes?: string
  }) => post<Ok<{ worker: ApiFuelWorker; devInviteToken?: string }>>('/workers', data),
  update: (
    id: string,
    data: {
      name?: string
      email?: string
      permissions?: FuelWorkerPermission[]
      avatar?: string
      phone?: string
      role?: string
      dutyStatus?: 'on_duty' | 'off_duty' | 'on_leave'
      station?: string
      licenseNo?: string
      notes?: string
    }
  ) => patch<Ok<{ worker: ApiFuelWorker }>>(`/workers/${id}`, data),
  reassign: (id: string, stationId: string) =>
    patch<Ok<{ worker: ApiFuelWorker }>>(`/workers/${id}/reassign`, { stationId }),
  setStatus: (id: string, status: 'active' | 'disabled') =>
    patch<Ok<{ worker: ApiFuelWorker }>>(`/workers/${id}/status`, { status }),
  resendInvite: (id: string) => post<Ok<{ devInviteToken?: string }>>(`/workers/${id}/resend-invite`),
  /** Worker photo. Multipart, so it is its own endpoint rather than a field on `update`. */
  uploadAvatar: (id: string, file: File) => {
    const fd = new FormData()
    fd.append('avatar', file)
    return patch<Ok<{ worker: ApiFuelWorker }>>(`/workers/${id}/avatar`, fd)
  },
  remove: (id: string) => del<Ok<unknown>>(`/workers/${id}`),
}
