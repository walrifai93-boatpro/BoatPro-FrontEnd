import React from 'react'
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { MarinaProvider } from './live'
import { CurrencyProvider } from './currency'
import { OpsProvider } from './opsStore'
import { AuthProvider, useAuth, useMarinaPermissions, roleAllowsPortal, needsOnboarding, type PortalRole } from './auth'
import { marinaRouteAllowed } from './marinaAccess'
import type { FuelWorkerPermission } from './fuel/fuelApi'
import type { MaintenanceWorkerPermission } from './api'
import { CFGS } from './admin/pages/ProviderDomainConfig'
import { LoadingOverlay } from './async'
import { LanguageToggle } from './i18n/LanguageToggle'
import { translatePortalText } from './i18n/runtime'

function RouteLoading() {
  return <div className="grid min-h-[40vh] place-items-center" role="status" aria-label="Loading section">
    <span className="h-8 w-8 animate-spin rounded-full border-2 border-ocean-200 border-t-ocean-600" />
  </div>
}

// The app used to import every screen up front. That made even the sign-in page
// download and parse all four provider portals plus the entire Admin console.
// Each route now fetches its screen only when opened; the boundary sits inside
// the route element, so an already visible shell remains mounted on navigation.
function lazyPage<P extends object>(loader: () => Promise<{ default: React.ComponentType<P> }>) {
  const Page = React.lazy(loader) as React.ComponentType<P>
  return (props: P) => <React.Suspense fallback={<RouteLoading />}><Page {...props} /></React.Suspense>
}

const Layout = lazyPage(() => import('./Layout'))
const Login = lazyPage(() => import('./pages/Login'))
const WorkerAcceptInvite = lazyPage(() => import('./pages/WorkerAcceptInvite'))
const SupportAgentInvite = lazyPage(() => import('./pages/SupportAgentInvite'))
const SupportAgentHome = lazyPage(() => import('./pages/SupportAgentHome'))
const PlanInvite = lazyPage(() => import('./pages/PlanInvite'))
const Onboarding = lazyPage(() => import('./pages/Onboarding'))
const PaymentResult = lazyPage(() => import('./pages/PaymentResult'))
const Dashboard = lazyPage(() => import('./pages/Dashboard'))
const LiveMap = lazyPage(() => import('./pages/LiveMap'))
const FleetTracker = lazyPage(() => import('./pages/FleetTracker'))
const Berths = lazyPage(() => import('./pages/Berths'))
const Reservations = lazyPage(() => import('./pages/Reservations'))
const ReservationTable = lazyPage(() => import('./pages/ReservationTable'))
const Movements = lazyPage(() => import('./pages/Movements'))
const Maintenance = lazyPage(() => import('./pages/OpsMore').then(m => ({ default: m.Maintenance })))
const Services = lazyPage(() => import('./pages/OpsMore').then(m => ({ default: m.Services })))
const Facilities = lazyPage(() => import('./pages/OpsMore').then(m => ({ default: m.Facilities })))
const Utilities = lazyPage(() => import('./pages/OpsMore').then(m => ({ default: m.Utilities })))
const Customers = lazyPage(() => import('./pages/People').then(m => ({ default: m.Customers })))
const Boats = lazyPage(() => import('./pages/People').then(m => ({ default: m.Boats })))
const Billing = lazyPage(() => import('./pages/Finance').then(m => ({ default: m.Billing })))
const Reports = lazyPage(() => import('./pages/Finance').then(m => ({ default: m.Reports })))
const Calendar = lazyPage(() => import('./pages/Finance').then(m => ({ default: m.Calendar })))
const Reviews = lazyPage(() => import('./pages/Engage').then(m => ({ default: m.Reviews })))
const NotificationsPage = lazyPage(() => import('./pages/Engage').then(m => ({ default: m.NotificationsPage })))
const Profile = lazyPage(() => import('./pages/Admin').then(m => ({ default: m.Profile })))
const Documents = lazyPage(() => import('./pages/Admin').then(m => ({ default: m.Documents })))
const Settings = lazyPage(() => import('./pages/Admin').then(m => ({ default: m.Settings })))
const Emergency = lazyPage(() => import('./pages/Admin').then(m => ({ default: m.Emergency })))
const Integrations = lazyPage(() => import('./pages/Admin').then(m => ({ default: m.Integrations })))
const DocumentVault = lazyPage(() => import('./pages/DocumentVault').then(m => ({ default: m.DocumentVault })))
const MarinaStaff = lazyPage(() => import('./pages/MarinaStaff'))
const ProviderInbox = lazyPage(() => import('./shared/ProviderInbox'))
// Risk score, the events behind it, decisions and appeals — the same page in every provider console.
const AccountStanding = lazyPage(() => import('./shared/AccountStanding'))
const ReviewsPanel = lazyPage(() => import('./shared/ReviewsPanel'))

const FuelLayout = lazyPage(() => import('./fuel/FuelLayout'))
const FuelDashboard = lazyPage(() => import('./fuel/pages/FuelDashboard'))
const FuelCalendar = lazyPage(() => import('./fuel/pages/FuelCalendar'))
const FuelStation = lazyPage(() => import('./fuel/pages/FuelStation'))
const FuelInventory = lazyPage(() => import('./fuel/pages/FuelInventory'))
const FuelBookings = lazyPage(() => import('./fuel/pages/FuelOps').then(m => ({ default: m.FuelBookings })))
const FuelDeliveries = lazyPage(() => import('./fuel/pages/FuelOps').then(m => ({ default: m.FuelDeliveries })))
const FuelPricing = lazyPage(() => import('./fuel/pages/FuelMoney').then(m => ({ default: m.FuelPricing })))
const FuelBilling = lazyPage(() => import('./fuel/pages/FuelMoney').then(m => ({ default: m.FuelBilling })))
const FuelReports = lazyPage(() => import('./fuel/pages/FuelMoney').then(m => ({ default: m.FuelReports })))
const FuelNotificationsPage = lazyPage(() => import('./fuel/pages/FuelEngage').then(m => ({ default: m.FuelNotificationsPage })))
const FuelSettings = lazyPage(() => import('./fuel/pages/FuelEngage').then(m => ({ default: m.FuelSettings })))
const FuelWorkers = lazyPage(() => import('./fuel/pages/FuelWorkers'))

const BoatLayout = lazyPage(() => import('./boat/BoatLayout'))
const BoatDashboard = lazyPage(() => import('./boat/pages/BoatDashboard'))
const BoatBilling = lazyPage(() => import('./boat/pages/BoatBilling'))
const BoatCrew = lazyPage(() => import('./boat/pages/BoatCrew'))

const MaintLayout = lazyPage(() => import('./maint/MaintLayout'))
const MaintDashboard = lazyPage(() => import('./maint/pages/MaintDashboard'))
const MaintCalendar = lazyPage(() => import('./maint/pages/MaintCalendar'))
const MaintRequests = lazyPage(() => import('./maint/pages/MaintOps').then(m => ({ default: m.MaintRequests })))
const MaintWorkOrders = lazyPage(() => import('./maint/pages/MaintOps').then(m => ({ default: m.MaintWorkOrders })))
const MaintInspections = lazyPage(() => import('./maint/pages/MaintOps').then(m => ({ default: m.MaintInspections })))
const MaintSchedule = lazyPage(() => import('./maint/pages/MaintOps').then(m => ({ default: m.MaintSchedule })))
const MaintTechnicians = lazyPage(() => import('./maint/pages/MaintResources').then(m => ({ default: m.MaintTechnicians })))
const MaintParts = lazyPage(() => import('./maint/pages/MaintResources').then(m => ({ default: m.MaintParts })))
const MaintQuality = lazyPage(() => import('./maint/pages/MaintCare').then(m => ({ default: m.MaintQuality })))
const MaintHistory = lazyPage(() => import('./maint/pages/MaintCare').then(m => ({ default: m.MaintHistory })))
const MaintFleet = lazyPage(() => import('./maint/pages/MaintCare').then(m => ({ default: m.MaintFleet })))
const MaintBilling = lazyPage(() => import('./maint/pages/MaintMoney').then(m => ({ default: m.MaintBilling })))
const MaintReports = lazyPage(() => import('./maint/pages/MaintMoney').then(m => ({ default: m.MaintReports })))
const MaintMobile = lazyPage(() => import('./maint/pages/MaintEngage').then(m => ({ default: m.MaintMobile })))
const MaintNotificationsPage = lazyPage(() => import('./maint/pages/MaintEngage').then(m => ({ default: m.MaintNotificationsPage })))
const MaintWorkshop = lazyPage(() => import('./maint/pages/MaintEngage').then(m => ({ default: m.MaintWorkshop })))
const MaintAudit = lazyPage(() => import('./maint/pages/MaintEngage').then(m => ({ default: m.MaintAudit })))
const MaintSettings = lazyPage(() => import('./maint/pages/MaintEngage').then(m => ({ default: m.MaintSettings })))

const AdminLayout = lazyPage(() => import('./admin/AdminLayout'))
const AdminDashboard = lazyPage(() => import('./admin/pages/AdminDashboard'))
const AdminCalendar = lazyPage(() => import('./admin/pages/AdminCalendar'))
const AdminUsers = lazyPage(() => import('./admin/pages/AdminPeople').then(m => ({ default: m.AdminUsers })))
const AdminKyc = lazyPage(() => import('./admin/pages/ProviderApprovals').then(m => ({ default: m.AdminKyc })))
const AdminPayments = lazyPage(() => import('./admin/pages/AdminMoney').then(m => ({ default: m.AdminPayments })))
const AdminSubscriptions = lazyPage(() => import('./admin/pages/AdminMoney').then(m => ({ default: m.AdminSubscriptions })))
const AdminRisk = lazyPage(() => import('./admin/pages/AdminRisk').then(m => ({ default: m.AdminRisk })))
const AdminReviews = lazyPage(() => import('./admin/pages/AdminEngage').then(m => ({ default: m.AdminReviews })))
const AdminSupport = lazyPage(() => import('./admin/pages/AdminEngage').then(m => ({ default: m.AdminSupport })))
const AdminNotifCenter = lazyPage(() => import('./admin/pages/AdminEngage').then(m => ({ default: m.AdminNotifCenter })))
const AdminEmergency = lazyPage(() => import('./admin/pages/AdminEngage').then(m => ({ default: m.AdminEmergency })))
const AdminReports = lazyPage(() => import('./admin/pages/AdminIntel').then(m => ({ default: m.AdminReports })))
const AdminAI = lazyPage(() => import('./admin/pages/AdminIntel').then(m => ({ default: m.AdminAI })))
const AdminFraud = lazyPage(() => import('./admin/pages/AdminIntel').then(m => ({ default: m.AdminFraud })))
const AdminCustomers = lazyPage(() => import('./admin/pages/AdminCustomers').then(m => ({ default: m.AdminCustomers })))
const CustomerBookings = lazyPage(() => import('./admin/pages/CustomerDomain').then(m => ({ default: m.CustomerBookings })))
const CustomerReviews = lazyPage(() => import('./admin/pages/CustomerDomain').then(m => ({ default: m.CustomerReviews })))
const ProviderDirectory = lazyPage(() => import('./admin/pages/ProviderDomain').then(m => ({ default: m.ProviderDirectory })))
const ProviderListings = lazyPage(() => import('./admin/pages/ProviderDomain').then(m => ({ default: m.ProviderListings })))
const ProviderBookings = lazyPage(() => import('./admin/pages/ProviderDomain').then(m => ({ default: m.ProviderBookings })))
const ProviderReviews = lazyPage(() => import('./admin/pages/ProviderDomain').then(m => ({ default: m.ProviderReviews })))
const ProviderKyc = lazyPage(() => import('./admin/pages/ProviderDomain').then(m => ({ default: m.ProviderKyc })))
const ProviderAnalytics = lazyPage(() => import('./admin/pages/ProviderDomain').then(m => ({ default: m.ProviderAnalytics })))
const ProviderCommissionRevenue = lazyPage(() => import('./admin/pages/ProviderDomain').then(m => ({ default: m.ProviderCommissionRevenue })))
const ProviderPackageRevenue = lazyPage(() => import('./admin/pages/ProviderDomain').then(m => ({ default: m.ProviderPackageRevenue })))
const ProviderWorkers = lazyPage(() => import('./admin/pages/ProviderWorkers').then(m => ({ default: m.ProviderWorkers })))
const AdminBoatApprovals = lazyPage(() => import('./admin/pages/AdminBoatApprovals'))
const AdminFuelStationApprovals = lazyPage(() => import('./admin/pages/AdminFuelStationApprovals'))
const AdminMarinaApprovals = lazyPage(() => import('./admin/pages/AdminMarinaApprovals'))
const AdminMaintShopApprovals = lazyPage(() => import('./admin/pages/AdminMaintShopApprovals'))
const AdminAddOnRequests = lazyPage(() => import('./admin/pages/AdminAddOnRequests'))
const AdminFeaturedListings = lazyPage(() => import('./admin/pages/AdminFeaturedListings'))
const AdminSupportAgents = lazyPage(() => import('./admin/pages/AdminSupportAgents'))
const AdminRequiredDocuments = lazyPage(() => import('./admin/pages/AdminRequiredDocuments').then(m => ({ default: m.AdminRequiredDocuments })))
const AdminTestingTools = lazyPage(() => import('./admin/pages/AdminTestingTools').then(m => ({ default: m.AdminTestingTools })))
const AdminTaxonomy = lazyPage(() => import('./admin/pages/AdminTaxonomy').then(m => ({ default: m.AdminTaxonomy })))

function RequireRole({ role, children }: { role: PortalRole; children: React.ReactNode }) {
  const auth = useAuth()
  const status = auth?.status ?? 'loading'
  const user = auth?.user ?? null

  // Wait for session restore before deciding — avoids flashing /login for an
  // already-authenticated user on a hard refresh.
  if (status === 'loading') {
    return (
      <div className="grid min-h-screen place-items-center bg-sand">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-ocean-200 border-t-ocean-600" />
      </div>
    )
  }

  // Not signed in.
  if (status !== 'authed' || !user) return <Navigate to="/login" replace />
  // Provider hasn't finished onboarding / isn't approved yet.
  if (needsOnboarding(user)) return <Navigate to="/onboarding" replace />
  // Signed in but the account's backend role can't access this portal.
  if (!roleAllowsPortal(user.role, role)) {
    if (user.role === 'admin') return <Navigate to="/admin" replace />
    if (user.role === 'support_agent') return <Navigate to="/agent" replace />
    if (user.role === 'fuel_provider' || user.role === 'fuel_worker') return <Navigate to="/fuel" replace />
    if (user.role === 'maintenance_provider' || user.role === 'maintenance_worker') return <Navigate to="/maint" replace />
    if (user.role === 'boat_provider') return <Navigate to="/boat" replace />
    if (user.role === 'marina_provider' || user.role === 'marina_worker') return <Navigate to="/" replace />
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}

// Deep-link guard for a marina-console page, from the one route → permission
// table in marinaAccess.ts (the sidebar reads the same table). The owner opens
// everything; a staff member is sent to the dashboard from a page their owner
// did not grant. The API enforces the same permissions — this is UX only — so
// it waits for my-access rather than bouncing a staff member who just signed in.
function RequireMarinaPermission({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  const access = useMarinaPermissions()
  if (!access.loaded) return <RouteLoading />
  if (!marinaRouteAllowed(pathname, access)) return <Navigate to="/" replace />
  return <>{children}</>
}

// Deep-link guard for a single fuel-portal page: hides pages a worker wasn't
// granted (nav already filters them, but a direct URL should redirect too).
// The backend's pagePermission middleware is the real enforcement — this is
// UX only, so while fuelAccess is still loading it lets the route through.
function RequireFuelPermission({
  perm,
  ownerOnly,
  children,
}: {
  perm?: FuelWorkerPermission
  ownerOnly?: boolean
  children: React.ReactNode
}) {
  const auth = useAuth()
  const fuelAccess = auth?.fuelAccess ?? null
  if (!fuelAccess) return <>{children}</>
  const allowed = fuelAccess.isOwner || (!ownerOnly && (!perm || fuelAccess.permissions.includes(perm)))
  if (!allowed) return <Navigate to="/fuel" replace />
  return <>{children}</>
}

// Same idea as RequireFuelPermission, for the maintenance portal. There's no
// `ownerOnly` case here — the one page that would need it (Work Orders' full
// board vs a technician's own jobs) narrows itself server-side rather than
// hiding the whole route, so every technician can always reach it.
function RequireMaintPermission({ perm, children }: { perm: MaintenanceWorkerPermission; children: React.ReactNode }) {
  const auth = useAuth()
  const maintAccess = auth?.maintAccess ?? null
  if (!maintAccess) return <>{children}</>
  if (!maintAccess.isOwner && !maintAccess.permissions.includes(perm)) return <Navigate to="/maint" replace />
  return <>{children}</>
}

// Authenticated gate for the onboarding screen itself (no role/approval check).
function RequireAuthed({ children }: { children: React.ReactNode }) {
  const auth = useAuth()
  const status = auth?.status ?? 'loading'
  const user = auth?.user ?? null
  if (status === 'loading') {
    return (
      <div className="grid min-h-screen place-items-center bg-sand">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-ocean-200 border-t-ocean-600" />
      </div>
    )
  }
  if (status !== 'authed' || !user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function CatchAllRedirect() {
  const auth = useAuth()
  const status = auth?.status ?? 'loading'
  const user = auth?.user ?? null

  if (status === 'loading') {
    return (
      <div className="grid min-h-screen place-items-center bg-sand">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-ocean-200 border-t-ocean-600" />
      </div>
    )
  }

  if (status === 'authed' && user) {
    if (user.role === 'admin') return <Navigate to="/admin" replace />
    if (user.role === 'support_agent') return <Navigate to="/agent" replace />
    if (user.role === 'fuel_provider' || user.role === 'fuel_worker') return <Navigate to="/fuel" replace />
    if (user.role === 'maintenance_provider' || user.role === 'maintenance_worker') return <Navigate to="/maint" replace />
    if (user.role === 'boat_provider') return <Navigate to="/boat" replace />
    return <Navigate to="/" replace />
  }

  return <Navigate to="/login" replace />
}

/** Routes without a persistent portal header still need a language control. */
function StandaloneLanguageToggle() {
  const { pathname } = useLocation()
  const hasPortalHeader = pathname === '/' || /^\/(admin|fuel|maint|boat)(\/|$)/.test(pathname)
  if (hasPortalHeader) return null
  return <div className="portal-language-floating"><LanguageToggle /></div>
}

export default function App() {
  return (
    <CurrencyProvider>
    <AuthProvider>
      <HashRouter>
        {/* Long user actions may cover the page; ordinary reads and background
            refreshes keep their current content visible. */}
        <LoadingOverlay />
        <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/worker-invite/:portal/:token" element={<WorkerAcceptInvite />} />
        <Route path="/support-invite/:token" element={<SupportAgentInvite />} />
        <Route path="/agent" element={<RequireRole role="agent"><SupportAgentHome /></RequireRole>} />
        {/* An admin's fixed-fee plan link. Public: the provider it was sent to
            usually has no account yet, and a login wall would tell them
            nothing about what they were offered. */}
        <Route path="/plan-invite/:code" element={<PlanInvite />} />
        <Route path="/onboarding" element={<RequireAuthed><Onboarding /></RequireAuthed>} />
        <Route path="/payment-result" element={<RequireAuthed><PaymentResult /></RequireAuthed>} />

        {/* ── Marina / Port Provider portal ── */}
        <Route element={
          <RequireRole role="marina">
            {/* MarinaProvider owns the operator's marina; OpsProvider the live ops state. */}
            <MarinaProvider><OpsProvider><Layout /></OpsProvider></MarinaProvider>
          </RequireRole>
        }>
          <Route path="/" element={<Dashboard />} />
          <Route path="/live" element={<RequireMarinaPermission><LiveMap /></RequireMarinaPermission>} />
          <Route path="/fleet-map" element={<RequireMarinaPermission><FleetTracker /></RequireMarinaPermission>} />
          <Route path="/calendar" element={<RequireMarinaPermission><Calendar /></RequireMarinaPermission>} />
          <Route path="/reservations" element={<RequireMarinaPermission><Reservations /></RequireMarinaPermission>} />
          <Route path="/reservation-table" element={<RequireMarinaPermission><ReservationTable /></RequireMarinaPermission>} />
          <Route path="/movements" element={<RequireMarinaPermission><Movements /></RequireMarinaPermission>} />
          <Route path="/services" element={<RequireMarinaPermission><Services /></RequireMarinaPermission>} />
          <Route path="/maintenance" element={<RequireMarinaPermission><Maintenance /></RequireMarinaPermission>} />
          <Route path="/facilities" element={<RequireMarinaPermission><Facilities /></RequireMarinaPermission>} />
          <Route path="/utilities" element={<RequireMarinaPermission><Utilities /></RequireMarinaPermission>} />
          <Route path="/emergency" element={<RequireMarinaPermission><Emergency /></RequireMarinaPermission>} />
          <Route path="/integrations" element={<RequireMarinaPermission><Integrations /></RequireMarinaPermission>} />
          <Route path="/berths" element={<RequireMarinaPermission><Berths /></RequireMarinaPermission>} />
          <Route path="/profile" element={<RequireMarinaPermission><Profile /></RequireMarinaPermission>} />
          <Route path="/customers" element={<RequireMarinaPermission><Customers /></RequireMarinaPermission>} />
          <Route path="/boats" element={<RequireMarinaPermission><Boats /></RequireMarinaPermission>} />
          <Route path="/billing" element={<RequireMarinaPermission><Billing /></RequireMarinaPermission>} />
          <Route path="/reports" element={<RequireMarinaPermission><Reports /></RequireMarinaPermission>} />
          {/* A report has its own address — /reports/berth-revenue — so it can be
              linked, bookmarked and reached with the back button. */}
          <Route path="/reports/:reportKey" element={<RequireMarinaPermission><Reports /></RequireMarinaPermission>} />
          <Route path="/inbox" element={<ProviderInbox />} />
          <Route path="/standing" element={<RequireMarinaPermission><AccountStanding /></RequireMarinaPermission>} />
          <Route path="/messages" element={<Navigate to="/inbox?view=messages" replace />} />
          <Route path="/support" element={<Navigate to="/inbox?view=help" replace />} />
          <Route path="/reviews" element={<Reviews />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/documents" element={<RequireMarinaPermission><Documents /></RequireMarinaPermission>} />
          <Route path="/documents/vault" element={<RequireMarinaPermission><DocumentVault /></RequireMarinaPermission>} />
          <Route path="/vault" element={<RequireMarinaPermission><DocumentVault /></RequireMarinaPermission>} />
          <Route path="/settings" element={<RequireMarinaPermission><Settings /></RequireMarinaPermission>} />
          {/* The marina's team: the owner, or staff holding manage_staff. */}
          <Route path="/staff" element={<RequireMarinaPermission><MarinaStaff /></RequireMarinaPermission>} />
        </Route>

        {/* ── Fuel Provider portal ── */}
        <Route path="/fuel" element={<RequireRole role="fuel"><FuelLayout /></RequireRole>}>
          <Route index element={<FuelDashboard />} />
          <Route path="calendar" element={<RequireFuelPermission perm="calendar"><FuelCalendar /></RequireFuelPermission>} />
          <Route path="station" element={<RequireFuelPermission perm="station"><FuelStation /></RequireFuelPermission>} />
          <Route path="inventory" element={<RequireFuelPermission perm="inventory"><FuelInventory /></RequireFuelPermission>} />
          <Route path="bookings" element={<RequireFuelPermission perm="bookings"><FuelBookings /></RequireFuelPermission>} />
          <Route path="deliveries" element={<RequireFuelPermission perm="deliveries"><FuelDeliveries /></RequireFuelPermission>} />
          <Route path="pricing" element={<RequireFuelPermission perm="pricing"><FuelPricing /></RequireFuelPermission>} />
          <Route path="billing" element={<RequireFuelPermission perm="billing"><FuelBilling /></RequireFuelPermission>} />
          <Route path="reports" element={<RequireFuelPermission perm="reports"><FuelReports /></RequireFuelPermission>} />
          <Route path="reports/:reportKey" element={<RequireFuelPermission perm="reports"><FuelReports /></RequireFuelPermission>} />
          {/* Fuel is served at the station only — no fleet out on the water to track. */}
          <Route path="tracking" element={<Navigate to="/fuel" replace />} />
          <Route path="inbox" element={<ProviderInbox />} />
          <Route path="standing" element={<AccountStanding />} />
          <Route path="messages" element={<Navigate to="/fuel/inbox?view=messages" replace />} />
          <Route path="notifications" element={<RequireFuelPermission perm="notifications"><FuelNotificationsPage /></RequireFuelPermission>} />
          <Route path="support" element={<Navigate to="/fuel/inbox?view=help" replace />} />
          {/* Ungated: what customers say about this station is not one team
              member's page to be shut out of, and replying is the only thing
              ReputationScore measures responsiveness on. */}
          <Route path="reviews" element={<div className="card p-5"><h2 className="font-display text-lg font-bold mb-3">{translatePortalText('Reviews')}</h2><ReviewsPanel accentClass="btn-fuel" /></div>} />
          <Route path="settings" element={<RequireFuelPermission perm="station"><FuelSettings /></RequireFuelPermission>} />
          <Route path="workers" element={<RequireFuelPermission ownerOnly><FuelWorkers /></RequireFuelPermission>} />
        </Route>

        {/* ── Boat Provider portal ── */}
        <Route path="/boat" element={<RequireRole role="boat"><BoatLayout /></RequireRole>}>
          <Route index element={<BoatDashboard />} />
          <Route path="crew" element={<BoatCrew />} />
          <Route path="billing" element={<BoatBilling />} />
          {/* Boat providers reach customer messages and platform help in one inbox. */}
          <Route path="inbox" element={<ProviderInbox />} />
          <Route path="standing" element={<AccountStanding />} />
          <Route path="support" element={<Navigate to="/boat/inbox?view=help" replace />} />
        </Route>

        {/* ── Maintenance Provider portal ── */}
        <Route path="/maint" element={<RequireRole role="maint"><MaintLayout /></RequireRole>}>
          <Route index element={<MaintDashboard />} />
          <Route path="calendar" element={<RequireMaintPermission perm="calendar"><MaintCalendar /></RequireMaintPermission>} />
          <Route path="mobile" element={<RequireMaintPermission perm="mobile"><MaintMobile /></RequireMaintPermission>} />
          <Route path="requests" element={<RequireMaintPermission perm="requests"><MaintRequests /></RequireMaintPermission>} />
          {/* Not gated — a technician-worker always reaches their own jobs here; see RequireMaintPermission. */}
          <Route path="workorders" element={<MaintWorkOrders />} />
          <Route path="inspections" element={<RequireMaintPermission perm="requests"><MaintInspections /></RequireMaintPermission>} />
          <Route path="schedule" element={<RequireMaintPermission perm="calendar"><MaintSchedule /></RequireMaintPermission>} />
          <Route path="technicians" element={<RequireMaintPermission perm="technicians"><MaintTechnicians /></RequireMaintPermission>} />
          <Route path="parts" element={<RequireMaintPermission perm="parts"><MaintParts /></RequireMaintPermission>} />
          <Route path="services" element={<RequireMaintPermission perm="parts"><MaintParts defaultTab="Services" /></RequireMaintPermission>} />
          <Route path="emergency" element={<RequireMaintPermission perm="settings"><MaintSettings /></RequireMaintPermission>} />
          <Route path="quality" element={<RequireMaintPermission perm="reports"><MaintQuality /></RequireMaintPermission>} />
          <Route path="history" element={<RequireMaintPermission perm="reports"><MaintHistory /></RequireMaintPermission>} />
          <Route path="fleet" element={<RequireMaintPermission perm="mobile"><MaintFleet /></RequireMaintPermission>} />
          <Route path="billing" element={<RequireMaintPermission perm="billing"><MaintBilling /></RequireMaintPermission>} />
          <Route path="reports" element={<RequireMaintPermission perm="reports"><MaintReports /></RequireMaintPermission>} />
          <Route path="reports/:reportKey" element={<RequireMaintPermission perm="reports"><MaintReports /></RequireMaintPermission>} />
          <Route path="inbox" element={<ProviderInbox />} />
          <Route path="standing" element={<AccountStanding />} />
          <Route path="messages" element={<Navigate to="/maint/inbox?view=messages" replace />} />
          <Route path="notifications" element={<RequireMaintPermission perm="notifications"><MaintNotificationsPage /></RequireMaintPermission>} />
          <Route path="support" element={<Navigate to="/maint/inbox?view=help" replace />} />
          <Route path="reviews" element={<div className="card p-5"><h2 className="font-display text-lg font-bold mb-3">{translatePortalText('Reviews')}</h2><ReviewsPanel accentClass="btn-maint" /></div>} />
          <Route path="workshop" element={<RequireMaintPermission perm="workshop"><MaintWorkshop /></RequireMaintPermission>} />
          <Route path="audit" element={<RequireMaintPermission perm="settings"><MaintAudit /></RequireMaintPermission>} />
          <Route path="settings" element={<RequireMaintPermission perm="settings"><MaintSettings /></RequireMaintPermission>} />
        </Route>

        {/* ── Super Admin portal ── */}
        <Route path="/admin" element={<RequireRole role="admin"><AdminLayout /></RequireRole>}>
          {/* Super Admin panel */}
          <Route index element={<AdminDashboard />} />
          <Route path="addon-requests" element={<AdminAddOnRequests />} />
          <Route path="featured-listings" element={<AdminFeaturedListings />} />
          <Route path="calendar" element={<AdminCalendar />} />
          <Route path="reports" element={<AdminReports />} />
          {/* Each report is addressable — /admin/reports/fuel-sales — so a report
              can be linked, bookmarked and survive a refresh. */}
          <Route path="reports/:reportKey" element={<AdminReports />} />
          {/* Two money screens, not four: Payments & Payouts (money moving) and
              Packages & Pricing (what providers are charged). The screens that
              became tabs keep their old addresses as redirects. */}
          <Route path="payments" element={<AdminPayments />} />
          <Route path="collections" element={<Navigate to="/admin/payments?tab=collections" replace />} />
          <Route path="risk" element={<AdminRisk />} />
          {/* The cross-vertical approvals queue. The dashboard's "Review N approvals",
              "View all" and quick action all link here; with the route gone they fell
              through to the dashboard, so the queue had no way in. */}
          <Route path="kyc" element={<AdminKyc />} />
          <Route path="subscriptions" element={<AdminSubscriptions />} />
          <Route path="model-changes" element={<Navigate to="/admin/subscriptions?tab=requests" replace />} />
          <Route path="financial-reports" element={<Navigate to="/admin/reports?tab=finance" replace />} />
          {/* Coupons & Ads is switched off in the portal; old links land on the dashboard. */}
          <Route path="promotions" element={<Navigate to="/admin" replace />} />
          <Route path="reviews" element={<AdminReviews />} />
          {/*
            The platform's own support desk.

            `AdminSupport` has existed and been fully built for some time — queue,
            conversation, assignment, status — but was exported and never routed,
            so the one desk every role on the platform can write to had nobody able
            to open it. Providers each got a `/support` route; the platform did not.
          */}
          <Route path="support" element={<AdminSupport />} />
          <Route path="support-agents" element={<AdminSupportAgents />} />
          {/* Same story as the desk above: both were built, exported and never
              given a route, so the emergency monitor in particular was a screen
              nobody could reach in the situation it exists for. */}
          <Route path="notifications" element={<AdminNotifCenter />} />
          <Route path="emergency" element={<AdminEmergency />} />
          {/* The only screen anywhere that reads or writes the AI module config,
              which the backend has fully implemented at `/admin-portal/ai-modules`.
              Without a route those toggles could not be reached at all. */}
          <Route path="ai" element={<AdminAI />} />
          <Route path="required-documents" element={<AdminRequiredDocuments />} />
          <Route path="testing-tools" element={<AdminTestingTools />} />
          <Route path="taxonomy" element={<AdminTaxonomy />} />
          <Route path="security" element={<AdminFraud />} />
          {/* Customer fraud alerts now live on Risk & Fraud; this page kept the security settings. */}
          <Route path="fraud" element={<Navigate to="/admin/risk?tab=customers" replace />} />

          {/* Boat Providers panel */}
          <Route path="boat/providers" element={<ProviderDirectory cfg={CFGS.boat} />} />
          <Route path="boat/addon-requests" element={<AdminAddOnRequests defaultProviderType="boat_provider" />} />
          <Route path="boat/featured-listings" element={<AdminFeaturedListings />} />
          <Route path="boat/listings" element={<ProviderListings cfg={CFGS.boat} />} />
          <Route path="boat/bookings" element={<ProviderBookings cfg={CFGS.boat} />} />
          <Route path="boat/workers" element={<ProviderWorkers cfg={CFGS.boat} />} />
          <Route path="boat/commission-revenue" element={<ProviderCommissionRevenue cfg={CFGS.boat} />} />
          <Route path="boat/package-revenue" element={<ProviderPackageRevenue cfg={CFGS.boat} />} />
          <Route path="boat/reviews" element={<ProviderReviews cfg={CFGS.boat} />} />
          <Route path="boat/kyc" element={<ProviderKyc cfg={CFGS.boat} />} />
          <Route path="boat/approvals" element={<AdminBoatApprovals />} />
          <Route path="boat/analytics" element={<ProviderAnalytics cfg={CFGS.boat} />} />

          {/* Marina Providers panel */}
          <Route path="marina/providers" element={<ProviderDirectory cfg={CFGS.marina} />} />
          <Route path="marina/addon-requests" element={<AdminAddOnRequests defaultProviderType="marina_provider" />} />
          <Route path="marina/listings" element={<ProviderListings cfg={CFGS.marina} />} />
          <Route path="marina/bookings" element={<ProviderBookings cfg={CFGS.marina} />} />
          <Route path="marina/workers" element={<ProviderWorkers cfg={CFGS.marina} />} />
          <Route path="marina/approvals" element={<AdminMarinaApprovals />} />
          <Route path="marina/commission-revenue" element={<ProviderCommissionRevenue cfg={CFGS.marina} />} />
          <Route path="marina/package-revenue" element={<ProviderPackageRevenue cfg={CFGS.marina} />} />
          <Route path="marina/reviews" element={<ProviderReviews cfg={CFGS.marina} />} />
          <Route path="marina/kyc" element={<ProviderKyc cfg={CFGS.marina} />} />
          <Route path="marina/analytics" element={<ProviderAnalytics cfg={CFGS.marina} />} />

          {/* Fuel Providers panel */}
          <Route path="fuel/providers" element={<ProviderDirectory cfg={CFGS.fuel} />} />
          <Route path="fuel/addon-requests" element={<AdminAddOnRequests defaultProviderType="fuel_provider" />} />
          <Route path="fuel/listings" element={<ProviderListings cfg={CFGS.fuel} />} />
          <Route path="fuel/bookings" element={<ProviderBookings cfg={CFGS.fuel} />} />
          <Route path="fuel/workers" element={<ProviderWorkers cfg={CFGS.fuel} />} />
          <Route path="fuel/approvals" element={<AdminFuelStationApprovals />} />
          <Route path="fuel/commission-revenue" element={<ProviderCommissionRevenue cfg={CFGS.fuel} />} />
          <Route path="fuel/package-revenue" element={<ProviderPackageRevenue cfg={CFGS.fuel} />} />
          <Route path="fuel/reviews" element={<ProviderReviews cfg={CFGS.fuel} />} />
          <Route path="fuel/kyc" element={<ProviderKyc cfg={CFGS.fuel} />} />
          <Route path="fuel/analytics" element={<ProviderAnalytics cfg={CFGS.fuel} />} />

          {/* Maintenance Providers panel */}
          <Route path="maintenance/providers" element={<ProviderDirectory cfg={CFGS.maintenance} />} />
          <Route path="maintenance/addon-requests" element={<AdminAddOnRequests defaultProviderType="maintenance_provider" />} />
          <Route path="maintenance/listings" element={<ProviderListings cfg={CFGS.maintenance} />} />
          <Route path="maintenance/bookings" element={<ProviderBookings cfg={CFGS.maintenance} />} />
          <Route path="maintenance/workers" element={<ProviderWorkers cfg={CFGS.maintenance} />} />
          <Route path="maintenance/approvals" element={<AdminMaintShopApprovals />} />
          <Route path="maintenance/commission-revenue" element={<ProviderCommissionRevenue cfg={CFGS.maintenance} />} />
          <Route path="maintenance/package-revenue" element={<ProviderPackageRevenue cfg={CFGS.maintenance} />} />
          <Route path="maintenance/reviews" element={<ProviderReviews cfg={CFGS.maintenance} />} />
          <Route path="maintenance/kyc" element={<ProviderKyc cfg={CFGS.maintenance} />} />
          <Route path="maintenance/analytics" element={<ProviderAnalytics cfg={CFGS.maintenance} />} />


          {/* Users (Customer) panel */}
          <Route path="users" element={<AdminUsers />} />
          <Route path="customers" element={<AdminCustomers />} />
          <Route path="customer/bookings" element={<CustomerBookings />} />
          <Route path="customer/reviews" element={<CustomerReviews />} />
        </Route>

        <Route path="*" element={<CatchAllRedirect />} />
        </Routes>
        <StandaloneLanguageToggle />
      </HashRouter>
    </AuthProvider>
    </CurrencyProvider>
  )
}
