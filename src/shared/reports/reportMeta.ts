import type { ReportCatalogEntry, ReportPortal } from '../../api/platform'

/**
 * How the Reports Center organises what the server's catalog offers.
 *
 * The server knows a report by a key, a group and a vertical — an accountant's
 * filing system. A person looking for "how much did I earn" does not think in
 * groups and verticals, so this file is the translation layer: plain-English
 * topics, one-line descriptions, a short "Start here" list per console, and the
 * period presets a report is read over.
 *
 * Everything here is *presentation over the catalog*, never a second list of
 * reports. A report the server offers that this file has never heard of still
 * appears (filed under the topic its server group implies, with the server's own
 * description), so a report added on the backend shows up here with no change —
 * and one that is removed simply disappears.
 *
 * No React and no i18n imports on purpose: the copy is passed through
 * `translatePortalText` where it is rendered, and this stays testable on its own.
 */

export type Tone = 'emerald' | 'ocean' | 'amber' | 'violet'

// ─────────────────────────────────────────────────────────────
// Topics
// ─────────────────────────────────────────────────────────────

export type TopicId = 'money' | 'activity' | 'customers' | 'team' | 'compliance' | 'platform'

export interface Topic {
  id: TopicId
  /** The heading over a topic's reports. */
  label: string
  /** The shorter form on a filter chip. */
  chip: string
}

export const TOPICS: readonly Topic[] = [
  { id: 'money', label: 'Money', chip: 'Money' },
  { id: 'activity', label: 'Bookings & activity', chip: 'Bookings' },
  { id: 'customers', label: 'Customers', chip: 'Customers' },
  { id: 'team', label: 'Team & stock', chip: 'Team & stock' },
  { id: 'compliance', label: 'Compliance & safety', chip: 'Compliance' },
  { id: 'platform', label: 'Platform', chip: 'Platform' },
]

/**
 * Which reports sit under each topic, in the order they are shown.
 *
 * Ordered by how often the question is asked, not alphabetically: "revenue" before
 * "trip profitability", "bookings" before "trip ledger". A report missing from the
 * catalog (another console's, or not yet built) is skipped at render time.
 */
const TOPIC_REPORTS: Record<TopicId, readonly string[]> = {
  money: [
    'revenue', 'finance-summary', 'commission', 'provider-earnings', 'payouts', 'refunds',
    'commission-statements', 'tax-summary', 'berth-revenue', 'dock-subscriptions',
    'fuel-margin', 'maintenance-income', 'maintenance-unbilled', 'trip-profitability', 'boat-profitability',
    'subscriptions', 'coupons',
  ],
  activity: [
    'bookings', 'cancellations', 'fleet-utilisation', 'marina-occupancy', 'fuel-sales',
    'maintenance-jobs', 'marina-services', 'fuel-deliveries', 'maintenance-funnel',
    'demand-pattern', 'arrivals', 'no-shows', 'trip-ledger',
  ],
  customers: ['customers', 'retention', 'reviews', 'loyalty'],
  team: [
    'technician-productivity', 'staff-attendance', 'maintenance-parts', 'fuel-inventory',
    'maintenance-catalogue',
  ],
  compliance: [
    'document-expiry', 'fleet-compliance', 'maintenance-warranty', 'marina-incidents',
    'ai-verification', 'risk-fraud',
  ],
  platform: [
    'executive', 'provider-profile', 'boat-provider-performance', 'marina-provider-performance',
    'fuel-provider-performance', 'maintenance-provider-performance', 'support-tickets',
  ],
}

const TOPIC_OF: Record<string, TopicId> = {}
const RANK: Record<string, number> = {}
for (const [topic, keys] of Object.entries(TOPIC_REPORTS) as [TopicId, readonly string[]][]) {
  keys.forEach((key, i) => {
    TOPIC_OF[key] = topic
    RANK[key] = i
  })
}

/** For a report this file has not met: the topic its server group implies. */
const GROUP_TOPIC: Record<string, TopicId> = {
  finance: 'money',
  operations: 'activity',
  customers: 'customers',
  compliance: 'compliance',
  executive: 'platform',
}

// ─────────────────────────────────────────────────────────────
// Plain-English descriptions
// ─────────────────────────────────────────────────────────────

/**
 * One line each, written for someone who has never opened the report.
 *
 * The server's descriptions are accurate and written for an analyst ("Transient
 * berth income split into berth fee, utilities, chargeable services and VAT, net of
 * refunds — by marina, operator, berth, stay type or month"). That is the right text
 * *inside* a report; on a card that has to be understood in a glance it is a wall.
 * The server's wording is still what a report page shows underneath.
 */
const PLAIN: Record<string, string> = {
  executive: 'Platform-wide money, supply and what needs attention today.',
  'provider-profile': 'Pick any provider and see everything about them — listings, bookings, money and documents.',
  revenue: 'Money coming in from bookings, by service.',
  'finance-summary': 'Commission and subscription income by period and provider, as an Excel workbook.',
  commission: 'Fees charged on bookings — collected and still owed.',
  'provider-earnings': 'Gross sales, fees and net earnings, month by month.',
  payouts: 'Money paid out, and money waiting to be paid.',
  refunds: 'Refunded bookings and how much was returned.',
  'commission-statements': 'Monthly fee statements — billed, settled and still owed.',
  'tax-summary': 'Sales, VAT collected and totals, ready for filing.',
  'berth-revenue': 'Berth income — fees, utilities, services and VAT.',
  'dock-subscriptions': 'Long-stay dock contracts and what they bring in.',
  'fuel-margin': 'Fuel sold against fuel bought — the margin per product.',
  'maintenance-income': 'Work billed, collected and still outstanding.',
  'maintenance-unbilled': 'Finished jobs that have not been invoiced yet.',
  'trip-profitability': 'What each trip earned after fuel, marina and repair costs.',
  'boat-profitability': 'What each boat earned and cost, trip and general running costs together.',
  subscriptions: 'Active and expired plans, with monthly recurring revenue.',
  coupons: 'Discount codes used and the discount given.',

  bookings: 'Every trip booking with its value and outcome.',
  cancellations: 'Cancellations, rejections and no-shows — and the value lost.',
  'fleet-utilisation': 'How much each boat is booked against how much it could be.',
  'marina-occupancy': 'Berth capacity, occupancy and revenue.',
  'fuel-sales': 'Fuel orders, volume sold and revenue.',
  'maintenance-jobs': 'Work orders by technician and how they ended.',
  'marina-services': 'Bookings and income from marina services.',
  'fuel-deliveries': 'Dockside fuel runs — timing, volume and delays.',
  'maintenance-funnel': 'Enquiries quoted, accepted, declined and completed.',
  'demand-pattern': 'The busiest days and hours for bookings.',
  arrivals: 'Guests checked in at the gangway.',
  'no-shows': 'Bookings where the guest did not turn up.',
  'trip-ledger': 'A simple list of every trip booking.',

  customers: 'Who booked in this period, with lifetime spend.',
  retention: 'How many customers come back after their first booking.',
  reviews: 'Ratings, star breakdown and reply rate.',
  loyalty: 'Loyalty tiers, points earned and redeemed.',

  'technician-productivity': 'Jobs, hours and value produced by each technician.',
  'staff-attendance': 'Marina staff shifts, hours and absences.',
  'maintenance-parts': 'Parts stock against minimum levels, and the cost to restock.',
  'fuel-inventory': 'Tank levels against capacity and reorder points.',
  'maintenance-catalogue': 'Your advertised services — price, jobs and rating.',

  'document-expiry': 'Documents and licences by how soon they expire.',
  'fleet-compliance': 'Documents held per boat — expiring or lapsed.',
  'maintenance-warranty': 'Warranties and when their cover ends.',
  'marina-incidents': 'Safety, security and damage incidents.',
  'ai-verification': 'How document checks performed, and what needed a person.',
  'risk-fraud': 'Fraud alerts, disputes and risk events per provider.',

  'support-tickets': 'Support volume, response and resolution times.',
}

// ─────────────────────────────────────────────────────────────
// Families — several catalog entries shown as one
// ─────────────────────────────────────────────────────────────

export interface ReportFamily {
  id: string
  label: string
  plain: string
  topic: TopicId
  /** In switcher order. `label` is the short name on the switcher. */
  members: readonly { key: string; label: string }[]
}

/**
 * Four provider-performance reports are the same report about four kinds of
 * provider. Listed as four they read as four things to learn; as one card with a
 * switcher on the report itself they read as one thing with four views.
 */
export const FAMILIES: readonly ReportFamily[] = [
  {
    id: 'provider-performance',
    label: 'Provider performance',
    plain: 'Compare providers on bookings, revenue and costs.',
    topic: 'platform',
    members: [
      { key: 'boat-provider-performance', label: 'Boats' },
      { key: 'marina-provider-performance', label: 'Marinas' },
      { key: 'fuel-provider-performance', label: 'Fuel' },
      { key: 'maintenance-provider-performance', label: 'Maintenance' },
    ],
  },
]

export function familyOf(key: string): ReportFamily | undefined {
  return FAMILIES.find(f => f.members.some(m => m.key === key))
}

// ─────────────────────────────────────────────────────────────
// Start here
// ─────────────────────────────────────────────────────────────

/**
 * The few reports each console opens on.
 *
 * Editorial, not statistical — this is "where would I start if I had never been
 * here", and it is what keeps the first screen to six or nine cards instead of
 * forty-nine. Anything a console can run that is not on this list is one click
 * away under its topic, or under "All".
 */
export const START_HERE: Record<ReportPortal, readonly string[]> = {
  admin: [
    'executive', 'provider-profile', 'revenue', 'commission', 'finance-summary', 'payouts',
    'bookings', 'boat-provider-performance', 'document-expiry',
  ],
  boat: ['revenue', 'bookings', 'payouts', 'fleet-utilisation', 'cancellations', 'reviews'],
  marina: ['revenue', 'berth-revenue', 'payouts', 'marina-occupancy', 'cancellations', 'reviews'],
  fuel: ['revenue', 'fuel-sales', 'fuel-margin', 'payouts', 'fuel-deliveries', 'fuel-inventory'],
  maintenance: [
    'revenue', 'maintenance-jobs', 'maintenance-income', 'maintenance-unbilled', 'payouts',
    'technician-productivity',
  ],
}

// ─────────────────────────────────────────────────────────────
// Hidden from a console's finder
// ─────────────────────────────────────────────────────────────

/**
 * Reports a console leaves off its list, though the server still offers them.
 *
 * The admin console could run all forty-six, and a list that long made the few
 * reports people actually open hard to find. These are either a provider's own
 * day-to-day reports (a technician's hours, one station's tank levels — the
 * provider consoles still list them), a near-copy of a report that stays (trip
 * ledger vs bookings, no-shows vs cancellations), or covered by a page of its own
 * in the admin menu (Risk & Fraud, Inbox & Support). Everything about one provider
 * is on the Provider report now.
 *
 * Hidden, not removed: a drill-through or a bookmark still opens them, and taking
 * a key off this list brings its card back.
 */
const HIDDEN_IN: Partial<Record<ReportPortal, readonly string[]>> = {
  admin: [
    // Money: covered by revenue, commission, payouts and the revenue statement.
    'provider-earnings', 'commission-statements', 'berth-revenue', 'dock-subscriptions',
    'fuel-margin', 'maintenance-income', 'maintenance-unbilled', 'coupons',
    // Bookings: near-copies, or one provider's own operations.
    'trip-ledger', 'no-shows', 'arrivals', 'demand-pattern', 'marina-services',
    'fuel-deliveries', 'maintenance-funnel',
    // Customers: niche.
    'retention', 'loyalty',
    // Team & stock: a provider's own staff and stock.
    'technician-productivity', 'staff-attendance', 'maintenance-parts', 'fuel-inventory',
    'maintenance-catalogue',
    // Compliance / platform: niche, or a page of their own in the admin menu.
    'maintenance-warranty', 'marina-incidents', 'risk-fraud', 'support-tickets',
  ],
}

/** The cards a console's finder shows: everything it can run, less what it hides. */
export function finderItemsFor(items: readonly FinderItem[], portal: ReportPortal): FinderItem[] {
  const hidden = new Set(HIDDEN_IN[portal] ?? [])
  return items.filter(i => !hidden.has(i.key))
}

// ─────────────────────────────────────────────────────────────
// Finder items
// ─────────────────────────────────────────────────────────────

/** What one card on the finder is. */
export interface FinderItem {
  /** The report to open. For a family, its first member this account can run. */
  key: string
  label: string
  plain: string
  topic: TopicId
  family?: ReportFamily
  /** The catalog entry behind it — for the server's own wording and `dateRanged`. */
  entry: ReportCatalogEntry
}

/**
 * Turns the catalog into cards: friendlier wording, family members folded into one
 * card, and a stable order (topic order first, then the curated rank within it,
 * then whatever the server sent for anything this file does not know).
 */
export function buildFinderItems(catalog: readonly ReportCatalogEntry[]): FinderItem[] {
  const seenFamilies = new Set<string>()
  const items: FinderItem[] = []

  for (const entry of catalog) {
    const family = familyOf(entry.key)
    if (family) {
      if (seenFamilies.has(family.id)) continue
      seenFamilies.add(family.id)
      const openWith =
        family.members.map(m => catalog.find(c => c.key === m.key)).find(Boolean) ?? entry
      items.push({
        key: openWith.key,
        label: family.label,
        plain: family.plain,
        topic: family.topic,
        family,
        entry: openWith,
      })
      continue
    }
    items.push({
      key: entry.key,
      label: entry.label,
      plain: PLAIN[entry.key] ?? entry.description,
      topic: TOPIC_OF[entry.key] ?? GROUP_TOPIC[entry.group] ?? 'activity',
      entry,
    })
  }

  const topicOrder = (t: TopicId) => TOPICS.findIndex(x => x.id === t)
  const rank = (i: FinderItem) => RANK[i.family?.members[0].key ?? i.key] ?? 999
  // `sort` is stable, so unknown reports (all rank 999) keep the server's order.
  return items.sort((a, b) => topicOrder(a.topic) - topicOrder(b.topic) || rank(a) - rank(b))
}

/** The console's "Start here" cards, in the curated order; falls back to the first few. */
export function startHereItems(items: readonly FinderItem[], portal: ReportPortal): FinderItem[] {
  const picked: FinderItem[] = []
  for (const key of START_HERE[portal] ?? []) {
    const item = items.find(i => i.key === key || i.family?.members.some(m => m.key === key))
    if (item && !picked.includes(item)) picked.push(item)
  }
  // An account whose catalog matches none of the curated keys (a new role, a
  // renamed report) should still open on something rather than on nothing.
  return picked.length >= 3 ? picked : items.slice(0, 6)
}

/** How many cards each topic holds, in topic order, leaving out empty topics. */
export function topicCounts(items: readonly FinderItem[]): { topic: Topic; count: number }[] {
  return TOPICS.map(topic => ({ topic, count: items.filter(i => i.topic === topic.id).length })).filter(
    t => t.count > 0
  )
}

/**
 * Case-, accent- and Arabic-diacritic-insensitive text for matching.
 *
 * A search box that treats "Payouts" and "payouts" differently is a search box
 * people stop trusting, and Arabic text carries optional vowel marks that nobody
 * types into a search field.
 */
export function fold(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ًͯ-ٰٟ]/g, '')
    .toLowerCase()
}

/** Every word of the query must appear somewhere in the text — so "fuel pay" finds "fuel … payouts". */
export function matchesQuery(haystack: string, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = fold(haystack)
  return words.every(w => hay.includes(w))
}

// ─────────────────────────────────────────────────────────────
// Periods
// ─────────────────────────────────────────────────────────────

export type PeriodKey = '7d' | '30d' | 'month' | 'lastMonth' | '90d' | 'ytd' | 'custom'

export const PERIODS: readonly { key: PeriodKey; label: string }[] = [
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'month', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: '90d', label: '3 months' },
  { key: 'ytd', label: 'This year' },
  { key: 'custom', label: 'Custom' },
]

export const DEFAULT_PERIOD: PeriodKey = '30d'

/**
 * `2026-08-19` in the reader's own day.
 *
 * Not `toISOString().slice(0, 10)`: that converts to UTC first, which at +3 is the
 * previous day for the first three hours after midnight — so a report opened early
 * in the morning covered a window shifted a day back from the one on screen.
 */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const isIsoDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/** The `from`/`to` a period means, as inclusive local days. */
export function resolvePeriod(
  key: PeriodKey,
  custom?: { from?: string; to?: string },
  now: Date = new Date()
): { from: string; to: string } {
  const y = now.getFullYear()
  const m = now.getMonth()
  const d = now.getDate()
  const today = isoDay(now)
  const daysBack = (n: number) => isoDay(new Date(y, m, d - n))

  switch (key) {
    case '7d':
      return { from: daysBack(6), to: today }
    case '30d':
      return { from: daysBack(29), to: today }
    case '90d':
      return { from: daysBack(89), to: today }
    case 'month':
      return { from: isoDay(new Date(y, m, 1)), to: today }
    case 'lastMonth':
      // Day 0 of this month is the last day of the previous one.
      return { from: isoDay(new Date(y, m - 1, 1)), to: isoDay(new Date(y, m, 0)) }
    case 'ytd':
      return { from: isoDay(new Date(y, 0, 1)), to: today }
    case 'custom': {
      const from = isIsoDay(custom?.from) ? custom!.from! : daysBack(29)
      const to = isIsoDay(custom?.to) ? custom!.to! : today
      // A reversed range would return nothing and look like a broken report.
      return from <= to ? { from, to } : { from: to, to: from }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Tone → class names
// ─────────────────────────────────────────────────────────────

export interface ToneClasses {
  /** A filled chip or badge. White text is legible on every one. */
  solid: string
  /** A tinted tile behind an icon. */
  soft: string
  /** Accent text on a light or dark surface. */
  text: string
  /** The console's own primary button (`btn-admin`, `btn-primary`, …). */
  button: string
  hoverBorder: string
  groupHoverText: string
  /** A tab or chip that is on, in the quiet style. */
  activeSoft: string
}

/**
 * Written out in full rather than assembled (`bg-${tone}-600`) because Tailwind
 * only generates classes it can find as whole strings in the source.
 */
export const TONE: Record<Tone, ToneClasses> = {
  emerald: {
    solid: 'bg-emerald-700 text-white',
    soft: 'bg-emerald-50 text-emerald-700',
    text: 'text-emerald-700',
    button: 'btn-admin',
    hoverBorder: 'hover:border-emerald-300',
    groupHoverText: 'group-hover:text-emerald-600',
    activeSoft: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  },
  ocean: {
    solid: 'bg-ocean-600 text-white',
    soft: 'bg-ocean-50 text-ocean-700',
    text: 'text-ocean-700',
    button: 'btn-primary',
    hoverBorder: 'hover:border-ocean-300',
    groupHoverText: 'group-hover:text-ocean-600',
    activeSoft: 'bg-ocean-50 text-ocean-700 ring-ocean-200',
  },
  amber: {
    solid: 'bg-amber-700 text-white',
    soft: 'bg-amber-50 text-amber-700',
    text: 'text-amber-700',
    button: 'btn-fuel',
    hoverBorder: 'hover:border-amber-300',
    groupHoverText: 'group-hover:text-amber-600',
    activeSoft: 'bg-amber-50 text-amber-700 ring-amber-200',
  },
  violet: {
    solid: 'bg-violet-600 text-white',
    soft: 'bg-violet-50 text-violet-700',
    text: 'text-violet-700',
    button: 'btn-maint',
    hoverBorder: 'hover:border-violet-300',
    groupHoverText: 'group-hover:text-violet-600',
    activeSoft: 'bg-violet-50 text-violet-700 ring-violet-200',
  },
}

/** Which tone a console wears, for callers that only know the portal. */
export const PORTAL_TONE: Record<ReportPortal, Tone> = {
  admin: 'emerald',
  boat: 'ocean',
  marina: 'ocean',
  fuel: 'amber',
  maintenance: 'violet',
}
