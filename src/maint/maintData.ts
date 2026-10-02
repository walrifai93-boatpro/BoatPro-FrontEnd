// ─────────────────────────────────────────────────────────────
// BoatPro Maintenance Provider Portal — shared presentation
// constants & view-model types. Record data comes from the real
// backend via maintenancePortalApi in ../../api.
// ─────────────────────────────────────────────────────────────
export { avatar, compactMoney, money } from '../format'
import { fileUrl } from '../api'

// Grantable technician-worker permissions, labeled to match the sidebar item
// they gate (MaintLayout.tsx's NAV) — shared by the sidebar's own filtering
// and the Technicians page's invite/access editor so the two never drift.
export const MAINT_PERMISSION_LABELS: Record<string, string> = {
  calendar: 'Maintenance Calendar',
  mobile: 'Technician Tracker',
  requests: 'Requests',
  technicians: 'Technicians & Labor',
  parts: 'Parts & Inventory',
  billing: 'Billing & Payments',
  reports: 'Reports',
  messages: 'Communication',
  notifications: 'Notifications',
  workshop: 'Workshop Profile',
  settings: 'Settings',
}

export const MIMG = {
  hero: 'https://images.unsplash.com/photo-1605281317010-fe5ffe798166?w=1600&q=75&auto=format&fit=crop',
  workshop: 'https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?w=1200&q=70&auto=format&fit=crop',
  engine: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=1200&q=70&auto=format&fit=crop',
  hull: 'https://images.unsplash.com/photo-1567899378494-47b22a2ae96a?w=1200&q=70&auto=format&fit=crop',
  tools: 'https://images.unsplash.com/photo-1530124566582-a618bc2615dc?w=1200&q=70&auto=format&fit=crop',
  mechanic: 'https://images.unsplash.com/photo-1621905251189-08b45d6a269e?w=1200&q=70&auto=format&fit=crop',
  electrical: 'https://images.unsplash.com/photo-1620283085439-39620a1e21c4?w=1200&q=70&auto=format&fit=crop',
  propeller: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=1200&q=70&auto=format&fit=crop',
  dock: 'https://images.unsplash.com/photo-1519302959554-a75be0afc82a?w=1200&q=70&auto=format&fit=crop',
  parts: 'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?w=1200&q=70&auto=format&fit=crop',
  yacht: 'https://images.unsplash.com/photo-1559827260-dc66d52bef19?w=1200&q=70&auto=format&fit=crop',
  van: 'https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?w=1200&q=70&auto=format&fit=crop',
  paint: 'https://images.unsplash.com/photo-1607000975231-4b0e0f8f7b3a?w=1200&q=70&auto=format&fit=crop',
  gauges: 'https://images.unsplash.com/photo-1581092160562-40aa08e78837?w=1200&q=70&auto=format&fit=crop',
  ocean: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&q=70&auto=format&fit=crop',
}

/**
 * The workshop's "cover" gallery photos, for chrome that rotates through them
 * (the dashboard hero and sidebar card). Falls back to the shop's first
 * uploaded photo, then to stock photography, so chrome never renders empty.
 */
export function shopCoverPhotos(shop: { images?: string[]; imagesCategorized?: { url: string; category?: string }[] } | null | undefined): string[] {
  const covers = (shop?.imagesCategorized || [])
    .filter((i) => i.category === 'cover')
    .map((i) => fileUrl(i.url))
    .filter((u): u is string => !!u)
  if (covers.length) return covers
  const first = shop?.images?.[0]
  return [first ? fileUrl(first)! : MIMG.hero]
}

// ── Service categories & technician roles — unified taxonomy shared across pages ──
export const ALL_MARINE_SPECIALTIES = [
  'Inboard Engines',
  'Outboard Engines',
  'Marine Electronics & Radar',
  'Hull & Gelcoat Refit',
  'Electrical & Lithium Systems',
  'Rigging & Sail Maintenance',
  'Hydraulics & Steering Systems',
  'Marine HVAC & Climate Control',
  'Underwater Antifouling & Zincs',
  'Propeller & Drive Alignment',
  'Plumbing, Heads & Watermakers',
  'Diagnostic Survey & Inspection',
]

export const SENIORITY_ROLES = [
  'Lead Technician',
  'Marine Mechanic',
  'Safety Inspector',
]

export const DEFAULT_TECHNICIAN_ROLES = [
  ...ALL_MARINE_SPECIALTIES,
  ...SENIORITY_ROLES,
]

export interface ServiceCat { key: string; name: string; icon: string; color: string; jobs: number; short?: string }
export const SERVICE_CATS: ServiceCat[] = [
  { key: 'engine',    name: 'Inboard & Outboard Engines', icon: '⚙️', color: '#8b5cf6', jobs: 0 },
  { key: 'electrical', name: 'Electrical & Lithium Systems', icon: '⚡', color: '#6366f1', jobs: 0 },
  { key: 'hull',      name: 'Hull & Gelcoat Refit',   icon: '🛥️', color: '#0ea5e9', jobs: 0 },
  { key: 'steering',  name: 'Hydraulics & Steering Systems', icon: '🎛️', color: '#14b8a6', jobs: 0 },
  { key: 'plumbing',  name: 'Plumbing, Heads & Watermakers', icon: '🚰', color: '#38bdf8', jobs: 0 },
  { key: 'hvac',      name: 'Marine HVAC & Climate Control', icon: '❄️', color: '#06b6d4', jobs: 0 },
  { key: 'nav',       name: 'Marine Electronics & Radar', icon: '📡', color: '#a78bfa', jobs: 0 },
  { key: 'antifouling', name: 'Underwater Antifouling & Zincs', icon: '⚓', color: '#0284c7', jobs: 0 },
  { key: 'propeller', name: 'Propeller & Drive Alignment', icon: '🔄', color: '#ec4899', jobs: 0 },
  { key: 'rigging',   name: 'Rigging & Sail Maintenance', icon: '⛵', color: '#22c55e', jobs: 0 },
  { key: 'survey',    name: 'Diagnostic Survey & Inspection', icon: '🔍', color: '#f43f5e', jobs: 0 },
]

/**
 * The backend `MAINTENANCE_CATEGORIES` enum (models/MaintenanceRequest.ts) — the
 * exact set the API accepts for a technician's `skills` and a job's `category`.
 *
 * SERVICE_CATS above is a *display* grouping and keys navigation as 'nav', which
 * the API rejects, so nothing built from it may be submitted. Anything sent to
 * the API — and every skill picker — comes from this list instead.
 */
export const MAINT_CATEGORIES: ServiceCat[] = [
  { key: 'engine',      name: 'Inboard & Outboard Engines',     icon: '⚙️', color: '#8b5cf6', jobs: 0, short: 'Engines' },
  { key: 'electrical',  name: 'Electrical & Lithium Systems',   icon: '⚡', color: '#6366f1', jobs: 0, short: 'Electrical' },
  { key: 'hull',        name: 'Hull & Gelcoat Refit',           icon: '🛥️', color: '#0ea5e9', jobs: 0, short: 'Hull' },
  { key: 'steering',    name: 'Hydraulics & Steering Systems',  icon: '🎛️', color: '#14b8a6', jobs: 0, short: 'Steering' },
  { key: 'plumbing',    name: 'Plumbing, Heads & Watermakers',  icon: '🚰', color: '#38bdf8', jobs: 0, short: 'Plumbing' },
  { key: 'hvac',        name: 'Marine HVAC & Climate Control',  icon: '❄️', color: '#06b6d4', jobs: 0, short: 'HVAC' },
  { key: 'fuel',        name: 'Fuel System',                    icon: '⛽', color: '#f59e0b', jobs: 0, short: 'Fuel' },
  { key: 'navigation',  name: 'Marine Electronics & Radar',     icon: '📡', color: '#a78bfa', jobs: 0, short: 'Electronics' },
  { key: 'safety',      name: 'Safety Equipment',               icon: '🦺', color: '#ef4444', jobs: 0, short: 'Safety' },
  { key: 'paint',       name: 'Paint & Varnish',                icon: '🎨', color: '#f97316', jobs: 0, short: 'Paint' },
  { key: 'rigging',     name: 'Rigging & Sail Maintenance',     icon: '⛵', color: '#22c55e', jobs: 0, short: 'Rigging' },
  { key: 'cleaning',    name: 'Cleaning & Detailing',           icon: '🧼', color: '#84cc16', jobs: 0, short: 'Cleaning' },
  { key: 'inspection',  name: 'Inspection & Compliance',        icon: '📋', color: '#eab308', jobs: 0, short: 'Inspection' },
  { key: 'survey',      name: 'Diagnostic Survey',              icon: '🔍', color: '#f43f5e', jobs: 0, short: 'Survey' },
  { key: 'antifouling', name: 'Underwater Antifouling & Zincs', icon: '⚓', color: '#0284c7', jobs: 0, short: 'Antifouling' },
  { key: 'propeller',   name: 'Propeller & Drive Alignment',    icon: '🔄', color: '#ec4899', jobs: 0, short: 'Propeller' },
  { key: 'other',       name: 'Other / General',                icon: '🔧', color: '#64748b', jobs: 0, short: 'General' },
]
export const MAINT_CATEGORY_KEYS: string[] = MAINT_CATEGORIES.map(c => c.key)

/**
 * Label + icon for a category key. Tries the display grouping first (so pages
 * that colour-code by SERVICE_CATS keep their existing look), then the backend
 * enum — without that second pass, the six categories SERVICE_CATS has no entry
 * for ('fuel', 'safety', 'paint', 'cleaning', 'inspection', 'other') rendered
 * as the raw lowercase key.
 */
export const catByKey = (k: string) => {
  if (!k) return SERVICE_CATS[0]
  const normalized = k.toLowerCase().trim()
  const found = SERVICE_CATS.find(c => c.key === normalized || c.name.toLowerCase() === normalized || c.key.includes(normalized) || normalized.includes(c.key))
  if (found) return found
  const canonical = MAINT_CATEGORIES.find(c => c.key === normalized)
  if (canonical) return canonical
  return {
    key: normalized,
    name: k,
    icon: '🔧',
    color: '#8b5cf6',
    jobs: 0,
  }
}

/** Chip-sized label for a category — the roster's skill pills have room for
 * one word, not "Underwater Antifouling & Zincs". */
export const catChipLabel = (k: string) => { const c = catByKey(k); return c.short ?? c.name.split(' ')[0] }

// ── Job statuses ─────────────────────────────────────────────
export type JobStatus =
  | 'Pending' | 'Approved' | 'Scheduled' | 'Assigned' | 'En route' | 'Inspection'
  | 'Diagnosis' | 'Awaiting approval' | 'Waiting parts' | 'In progress'
  | 'Quality check' | 'Completed' | 'Delivered' | 'Cancelled'

// ── View-model types (backend records are mapped onto these for display) ──
export type Priority = 'Low' | 'Medium' | 'High' | 'Critical'
export interface MaintRequest {
  id: string; customer: string; avatar: string; boat: string; boatType: string; boatLen: string
  cat: string; title: string; desc: string; date: string; time: string
  /** Canonical source values used when an Arabic list row is opened for editing. */
  sourceTitle?: string; sourceDesc?: string
  priority: Priority; status: JobStatus; emergency?: boolean; photos: number; source: string
  location: string; est?: number; notes?: string
}

export interface WorkOrder {
  id: string; reqId: string; boat: string; customer: string; avatar: string; cat: string
  title: string; tech: string; techAvatar: string; team?: string; priority: Priority
  status: JobStatus; created: string; due: string; progress: number; hours: number; estHours: number
  labor: number; parts: number; paused?: boolean
  /**
   * VAT on this job, computed server-side.
   *
   * Present so the printable work order can show a tax line before an invoice
   * exists. Optional because a cached or older response may not carry it —
   * callers fall back to labour + parts rather than rendering NaN.
   */
  vat?: { subtotal: number; vatRate: number; vatAmount: number; total: number }
  /** Human-readable code (e.g. MWO-000012) for display — `id` is the DB id used for API calls. */
  code?: string
  /** Raw backend status enum (e.g. 'in_progress') — `status` above is the Title Case display form. */
  statusKey?: string
  /** Which of the technician's roles this job is booked at. */
  bookedRole?: string
  bookedRoleAr?: string
  /** Rate frozen at assignment; labour = hours × this, derived server-side. */
  hourlyRate?: number
  /** Who worked which trade, for how long. When this is non-empty it — not
   * `hours` × `hourlyRate` — is what the job bills at. */
  assignments?: { role: string; roleAr?: string; technician: string; hourlyRate: number; hours: number }[]
  /** Formatted scheduled date (e.g. Aug 17, 2026). */
  date?: string
  /** Formatted scheduled start time (e.g. 11:30 AM). */
  time?: string
  /** Raw ISO timestamp when the job is scheduled to begin. */
  scheduledFor?: string
  /** Payment status from customer via HyperPay ('unpaid' | 'paid'). */
  paymentStatus?: 'unpaid' | 'paid'
  /** Linked invoice details */
  invoice?: { id: string; code?: string; status?: string; total?: number; paidAt?: string }
}

export interface Technician {
  id: string; name: string; avatar: string; role: string; skills: string[]
  status: 'On duty' | 'Off duty' | 'On leave' | 'Pending Approval' | 'Rejected' | 'Invited'
  approvalStatus?: 'pending' | 'approved' | 'rejected'
  rejectionReason?: string
  rating: number; jobsToday: number; utilization: number; certs: string; shift: string; phone: string
  hoursWeek: number; overtime: number; pos: { x: number; y: number }; mobile?: boolean
  /**
   * Last position the technician's phone reported while on duty.
   *
   * `pos` above is the old percent-of-panel layout the tracker used before real
   * coordinates existed; it is kept only for the sample data that still draws
   * the roster grid. Anything on a map reads this instead, and shows the
   * technician as unlocated when it is absent.
   */
  lastLocation?: { latitude?: number; longitude?: number; recordedAt?: string }
}

export type CheckResult = 'Pass' | 'Fail' | 'Attention' | 'Pending'
export interface InspItem { label: string; result: CheckResult; note?: string }
export interface Inspection {
  id: string; woId: string; boat: string; type: string; icon: string; tech: string; techAvatar: string
  date: string; status: 'Completed' | 'In progress' | 'Scheduled'; score: number; photos: number; items: InspItem[]
}
export const INSPECTION_TYPES = [
  { key: 'pre', name: 'Pre-Service', icon: '📋' }, { key: 'engine', name: 'Engine', icon: '⚙️' },
  { key: 'hull', name: 'Hull', icon: '🛥️' }, { key: 'prop', name: 'Propeller', icon: '🌀' },
  { key: 'steering', name: 'Steering', icon: '🎮' }, { key: 'fuel', name: 'Fuel System', icon: '⛽' },
  { key: 'elec', name: 'Electrical', icon: '🔌' }, { key: 'battery', name: 'Battery', icon: '🔋' },
  { key: 'plumb', name: 'Plumbing', icon: '🚰' }, { key: 'safety', name: 'Safety Equip.', icon: '🦺' },
  { key: 'nav', name: 'Navigation', icon: '📡' }, { key: 'interior', name: 'Interior', icon: '🛋️' },
  { key: 'exterior', name: 'Exterior', icon: '✨' },
]

export interface Part { id: string; name: string; sku: string; cat: string; stock: number; min: number; price: number; supplier: string; location: string; barcode: string }
export interface MaintInvoice { id: string; woId: string; customer: string; avatar: string; boat: string; date: string; due: string; labor: number; parts: number; tax: number; discount: number; total: number; status: 'Paid' | 'Pending' | 'Overdue' | 'Refunded'; method: string
  /** Taxable amount before VAT — `tax` is the VAT it produced, `total` the sum. */
  subtotal?: number
  /** The VAT percentage stamped on the invoice; absent on ones issued before VAT applied. */
  vatRate?: number }
export interface Warranty { id: string; boat: string; item: string; kind: 'Parts' | 'Service'; provider: string; start: string; expiry: string; status: 'Active' | 'Expiring' | 'Expired' | 'Claim open' }
export interface SchedItem { id: string; time: string; boat: string; job: string; tech: string; techAvatar: string; cat: string; kind: 'Workshop' | 'Mobile' | 'Dockside'; dur: string }
