// ─────────────────────────────────────────────────────────────
// BoatPro Super Admin Portal — shared presentation constants
// (icons, images, label lookups). All record data comes from the
// real backend via adminPortalApi / adminApi / documentsApi in ../../api.
// ─────────────────────────────────────────────────────────────
export { avatar, money } from '../format'

export const AIMG = {
  hero: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1600&q=75&auto=format&fit=crop',
  marina: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=1200&q=70&auto=format&fit=crop',
  yacht: 'https://images.unsplash.com/photo-1559827260-dc66d52bef19?w=1200&q=70&auto=format&fit=crop',
  harbor: 'https://images.unsplash.com/photo-1516796181074-bf453fbfa3e6?w=1200&q=70&auto=format&fit=crop',
  fuel: 'https://images.unsplash.com/photo-1518623489648-a173ef7824f3?w=1200&q=70&auto=format&fit=crop',
  workshop: 'https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?w=1200&q=70&auto=format&fit=crop',
  ocean: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&q=70&auto=format&fit=crop',
  city: 'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=1200&q=70&auto=format&fit=crop',
  servers: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200&q=70&auto=format&fit=crop',
  night: 'https://images.unsplash.com/photo-1493558103817-58b2924bce98?w=1200&q=70&auto=format&fit=crop',
  sail: 'https://images.unsplash.com/photo-1534854638093-bada1813ca19?w=1200&q=70&auto=format&fit=crop',
  dock: 'https://images.unsplash.com/photo-1519302959554-a75be0afc82a?w=1200&q=70&auto=format&fit=crop',
}

// Role icon lookup — decorates real role counts from adminPortalApi.dashboard()/users().
export type UserRole = 'Customer' | 'Boat Owner' | 'Boat Provider' | 'Marina Provider' | 'Fuel Provider' | 'Maintenance Provider' | 'Vendor Staff' | 'Admin' | 'Sub Admin' | 'Moderator'
export const USER_ROLES: { role: UserRole; icon: string }[] = [
  { role: 'Customer', icon: '🧑‍✈️' }, { role: 'Boat Owner', icon: '🛥️' },
  { role: 'Boat Provider', icon: '⛵' }, { role: 'Marina Provider', icon: '⚓' },
  { role: 'Fuel Provider', icon: '⛽' }, { role: 'Maintenance Provider', icon: '🔧' },
  { role: 'Vendor Staff', icon: '🧰' }, { role: 'Admin', icon: '🛡️' },
  { role: 'Sub Admin', icon: '🗂️' }, { role: 'Moderator', icon: '🧿' },
]

// Provider-kind type shared across the vertical directory/listings/reviews pages.
export interface Provider { id: string; name: string; kind: 'Boat' | 'Marina' | 'Fuel' | 'Maintenance'; icon: string; owner: string; avatar: string; status: 'Live' | 'Pending' | 'Suspended' | 'Rejected'; verified: boolean; rating: number; revenue: number; bookings: number; staff: number; plan: 'Free' | 'Basic' | 'Premium' | 'Enterprise'; joined: string; manager: string; image: string }

// Booking-kind type shared by ProviderDomain's per-vertical booking config.
export interface ABooking { id: string; customer: string; avatar: string; kind: 'Boat rental' | 'Berth' | 'Fuel' | 'Maintenance' | 'Cleaning' | 'Rescue'; icon: string; item: string; provider: string; date: string; amount: number; commission: number; status: 'Confirmed' | 'Pending' | 'Completed' | 'Cancelled' | 'Refunded' | 'Disputed' }

// KYC document-kind type shared by AdminPeople's KYC queue and _shared's review-target mapping.
export interface KycItem { id: string; who: string; avatar: string; kind: 'Identity' | 'Business' | 'License' | 'Insurance' | 'Tax'; doc: string; submitted: string; status: 'Pending' | 'Approved' | 'Rejected' | 'Expiring'; note?: string; providerKind?: Provider['kind'] }
