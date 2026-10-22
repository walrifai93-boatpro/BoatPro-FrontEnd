// ---------------------------------------------------------------------------
// Which marina-console screens each staff permission opens.
//
// One table, read by the route guard (App.tsx → RequireMarinaPermission), the
// sidebar and quick actions (Layout.tsx) and the Staff page's permission
// picker, so the three can never disagree about what a permission means. The
// backend enforces the same permissions on every endpoint behind these
// screens; this only decides what a staff member is shown.
//
// `[]` = every signed-in member of the marina (dashboard, inbox, alerts…);
// `'owner'` = the marina's owner only (their business profile, payouts,
// integrations, account standing).
// ---------------------------------------------------------------------------
import type { MarinaStaffPermission } from './api'
import type { MarinaPermissions } from './auth'

export type MarinaRouteRule = readonly MarinaStaffPermission[] | 'owner'

export const MARINA_ROUTE_ACCESS: Record<string, MarinaRouteRule> = {
  '/': [],
  '/live': ['manage_slots', 'check_in', 'manage_bookings'],
  '/fleet-map': ['check_in', 'manage_bookings', 'manage_slots'],
  '/calendar': ['manage_bookings'],
  '/reservations': ['manage_bookings'],
  '/reservation-table': ['manage_bookings'],
  '/movements': ['check_in', 'manage_bookings'],
  '/services': ['manage_services'],
  '/maintenance': ['manage_slots', 'manage_services'],
  '/facilities': ['manage_services'],
  '/utilities': ['manage_slots', 'manage_bookings', 'check_in'],
  '/emergency': [],
  '/integrations': 'owner',
  '/berths': ['manage_slots', 'manage_pricing'],
  '/profile': 'owner',
  '/customers': ['manage_bookings'],
  '/boats': ['manage_bookings'],
  '/billing': ['view_reports'],
  '/reports': ['view_reports'],
  '/inbox': [],
  '/messages': [],
  '/support': [],
  '/standing': 'owner',
  '/reviews': [],
  '/notifications': [],
  '/documents': ['manage_staff'],
  '/documents/vault': 'owner',
  '/vault': 'owner',
  '/settings': 'owner',
  '/staff': ['manage_staff'],
}

/** The rule for a console path (`/reports/berth-revenue` follows `/reports`). */
export function marinaRouteRule(path: string): MarinaRouteRule {
  const clean = (path.split(/[?#]/)[0] || '/').replace(/\/+$/, '') || '/'
  if (clean in MARINA_ROUTE_ACCESS) return MARINA_ROUTE_ACCESS[clean]
  const parent = '/' + (clean.split('/')[1] ?? '')
  return MARINA_ROUTE_ACCESS[parent] ?? []
}

/** May this account open `path`? Owners open everything. */
export function marinaRouteAllowed(path: string, access: MarinaPermissions): boolean {
  if (access.isOwner) return true
  const rule = marinaRouteRule(path)
  if (rule === 'owner') return false
  return rule.length === 0 || access.can(...rule)
}

/** Plain-language labels for the Staff page's permission picker. */
export const MARINA_PERMISSION_INFO: Record<MarinaStaffPermission, { label: string; detail: string }> = {
  manage_bookings: { label: 'Bookings & reservations', detail: 'Reservations, calendar, boat providers, boats and review replies' },
  check_in: { label: 'Arrivals & check-in', detail: 'Arrivals & departures board, check-in / check-out, live maps' },
  manage_slots: { label: 'Berths & live map', detail: 'Berths, pontoons, berth status, dock plans and work orders' },
  manage_pricing: { label: 'Pricing', detail: 'Berth prices and marina tariffs' },
  manage_services: { label: 'Services & facilities', detail: 'Service catalogue, service requests and facilities' },
  manage_fuel: { label: 'Fuel', detail: 'Fuel dock operations' },
  view_reports: { label: 'Billing & reports', detail: 'Revenue, invoices, payments and reports — the only way to see money' },
  manage_staff: { label: 'Staff & documents', detail: 'Invite and manage staff (within their own access) and compliance documents' },
}
