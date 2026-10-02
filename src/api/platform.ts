// ---------------------------------------------------------------------------
// Platform modules — booking engine, document intelligence, reputation,
// notification preferences and exports.
//
// Kept beside the main api.ts rather than inside it: that file is already over
// a thousand lines, and these are self-contained feature areas that a reader
// should be able to take in without scrolling past the whole legacy surface.
// The HTTP helpers are imported from api.ts so both share one auth path,
// one refresh-on-401, and one error shape.
// ---------------------------------------------------------------------------

import { API_URL, del, get, getToken, Ok, Paginated, patch, post, qs, TUNNEL_HEADERS } from '../api';

// ── Booking engine ──────────────────────────────────────────────────────────

export type ReservationStatus =
  | 'pending_payment'
  | 'confirmed'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_show'
  | 'expired';

/** Why a window is unbookable. Surfaced verbatim so the UI can explain rather than just refuse. */
export interface BookingConflict {
  code:
    | 'resource_inactive'
    | 'not_accepting_bookings'
    | 'too_soon'
    | 'too_far_ahead'
    | 'too_short'
    | 'too_long'
    | 'outside_opening_hours'
    | 'blackout'
    | 'slot_misaligned'
    | 'at_capacity'
    | 'invalid_window';
  message: string;
  detail?: Record<string, unknown>;
}

export interface QuotedLeg {
  resourceId: string;
  resourceName: string;
  provider: string;
  kind: string;
  startAt: string;
  endAt: string;
  quantity: number;
  basePrice: number;
  adjustedPrice: number;
  discount: number;
  total: number;
  rulesApplied: { name: string; type: string; multiplier: number; days: number }[];
  available: boolean;
  conflicts: BookingConflict[];
  remainingCapacity: number;
  cancellationPolicy: string[];
}

export interface Quote {
  legs: QuotedLeg[];
  bookable: boolean;
  currency: string;
  subtotal: number;
  discount: number;
  vat: number;
  total: number;
  couponCode?: string;
  holdMinutes: number;
}

export interface ReservationLeg {
  resource: string;
  provider: string;
  kind: string;
  resourceName: string;
  startAt: string;
  endAt: string;
  quantity: number;
  status: 'held' | 'confirmed' | 'cancelled' | 'completed' | 'no_show';
  basePrice: number;
  adjustedPrice: number;
  discount: number;
  total: number;
  checkedInAt?: string;
  completedAt?: string;
}

export interface ReservationEvent {
  type: string;
  at: string;
  actor?: { id: string; name?: string; role?: string } | string;
  reason?: string;
  detail?: Record<string, unknown>;
}

export interface Reservation {
  id: string;
  code: string;
  customer: string | { id: string; name?: string; email?: string; phone?: string; avatar?: string };
  legs: ReservationLeg[];
  startAt: string;
  endAt: string;
  status: ReservationStatus;
  currency: string;
  subtotal: number;
  discount: number;
  vat: number;
  total: number;
  couponCode?: string;
  paidAt?: string;
  holdExpiresAt?: string;
  refund: {
    status: 'none' | 'pending' | 'processing' | 'completed' | 'failed';
    amount: number;
    fee: number;
    policyLabel?: string;
    policyRefundPct?: number;
    failureReason?: string;
  };
  noShow?: { markedAt: string; chargedAmount: number; disputable: boolean };
  events: ReservationEvent[];
  createdAt: string;
}

export interface FreeWindow {
  startAt: string;
  endAt: string;
  remainingCapacity: number;
}

export interface RefundQuote {
  refundPct: number;
  grossRefund: number;
  fee: number;
  netRefund: number;
  retained: number;
  label: string;
  hoursBeforeStart: number;
  nothingToRefund: boolean;
}

export interface LegInput {
  resourceId: string;
  startAt: string;
  endAt: string;
  quantity?: number;
}

export const reservationApi = {
  /** Free windows for one resource. The backend caps the range at 31 days. */
  availability: (params: {
    resourceId: string;
    from: string;
    to: string;
    durationMinutes: number;
    quantity?: number;
  }) =>
    get<
      Ok<{
        resource: { id: string; name: string; kind: string; capacity: number };
        windows: FreeWindow[];
        cancellationPolicy: string[];
      }>
    >('/reservations/availability', params),

  /** Is this exact window bookable, and if not, why. Reserves nothing. */
  check: (legs: LegInput[]) =>
    post<Ok<{ legs: (BookingConflict[] & Record<string, unknown>)[]; bookable: boolean }>>(
      '/reservations/check',
      { legs }
    ),

  /** Price and availability without taking capacity off the market. */
  quote: (legs: LegInput[], couponCode?: string) =>
    post<Ok<{ quote: Quote }>>('/reservations/quote', { legs, couponCode }),

  /**
   * Takes the holds and opens the payment window. The response carries
   * `holdExpiresAt` — surface it, because capacity is released when it passes.
   */
  create: (body: { legs: LegInput[]; couponCode?: string; notes?: string; waitlistEntryId?: string }) =>
    post<Ok<{ reservation: Reservation; holdExpiresAt: string; message: string }>>('/reservations', body),

  /**
   * Records a payment taken at the desk (cash, card machine). Marina staff and
   * admins only — the server skips the gateway check for them precisely because
   * the money did not come through the gateway. A customer paying by card goes
   * through the app's own checkout, which verifies against HyperPay first.
   */
  confirm: (id: string) => post<Ok<{ reservation: Reservation }>>(`/reservations/${id}/confirm`, {}),

  /** For a customer stuck in a 3-D Secure challenge. Bounded server-side. */
  extendHold: (id: string) => post<Ok<{ holdExpiresAt: string }>>(`/reservations/${id}/extend-hold`),

  modify: (id: string, legs: LegInput[], reason?: string) =>
    patch<
      Ok<{
        reservation: Reservation;
        priceDelta: number;
        settlement: 'additional_payment_due' | 'refund_due' | 'no_change';
      }>
    >(`/reservations/${id}`, { legs, reason }),

  /** What cancelling would cost — show this before the customer commits. */
  cancellationQuote: (id: string) =>
    get<Ok<{ quote: RefundQuote; policy: string[] }>>(`/reservations/${id}/cancellation-quote`),

  cancel: (id: string, reason?: string) =>
    del<Ok<{ reservation: Reservation; refund: RefundQuote }>>(
      `/reservations/${id}${reason ? `?reason=${encodeURIComponent(reason)}` : ''}`
    ),

  checkIn: (id: string, resourceId?: string) =>
    post<Ok<{ reservation: Reservation }>>(`/reservations/${id}/check-in`, { resourceId }),

  complete: (id: string) => post<Ok<{ reservation: Reservation }>>(`/reservations/${id}/complete`),

  waiveNoShow: (id: string, reason: string) =>
    post<Ok<{ reservation: Reservation }>>(`/reservations/${id}/waive-no-show`, { reason }),

  mine: (params?: { status?: ReservationStatus; from?: string; to?: string; page?: number; limit?: number }) =>
    get<Ok<Paginated<Reservation>>>('/reservations/my', params),

  /** The provider's diary — bookings against them, soonest first. */
  provider: (params?: {
    status?: ReservationStatus;
    resourceId?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }) => get<Ok<Paginated<Reservation>>>('/reservations/provider', params),

  detail: (id: string) => get<Ok<{ reservation: Reservation }>>(`/reservations/${id}`),

  // Waiting list
  joinWaitlist: (body: {
    resourceId: string;
    desiredStartAt: string;
    desiredEndAt: string;
    quantity?: number;
    flexibilityMinutes?: number;
  }) => post<Ok<{ entry: Record<string, unknown>; position: number }>>('/reservations/waitlist', body),

  myWaitlist: () =>
    get<Ok<{ entries: { entry: Record<string, unknown>; position: number }[] }>>('/reservations/waitlist/my'),

  leaveWaitlist: (id: string) => del<Ok<{ removed: boolean }>>(`/reservations/waitlist/${id}`),
};

// ── Document intelligence ───────────────────────────────────────────────────

export type AIDocumentStatus =
  | 'queued'
  | 'analyzing'
  | 'analyzed'
  | 'needs_review'
  | 'approved'
  | 'rejected'
  | 'failed';

export interface AIDocument {
  id: string;
  owner: string | { id: string; name?: string; email?: string };
  fileUrl: string;
  fileName?: string;
  docType: string;
  typeConfidence: number;
  status: AIDocumentStatus;
  failureReason?: string;
  fields: { key: string; label: string; value: string; normalized?: string; confidence: number }[];
  missingFields: { key: string; label: string; required: boolean }[];
  validation: {
    code: string;
    severity: 'info' | 'warning' | 'critical';
    field?: string;
    message: string;
    source: 'model' | 'rules';
  }[];
  confidence: { overall: number; classification: number; requiredFieldsMean: number };
  identity?: { scheme: string; verified: boolean; checks: { name: string; status: string; detail: string }[] };
  fraud: {
    score: number;
    level: 'low' | 'medium' | 'high' | 'critical';
    signals: { code: string; severity: string; detail: string; weight: number }[];
  };
  duplicate?: { isDuplicate: boolean; matchType: 'file' | 'content'; matchedDocument: string };
  expiry: {
    issuedAt?: string;
    expiresAt?: string;
    status: 'valid' | 'expiring_soon' | 'expired' | 'no_expiry' | 'unknown';
    daysRemaining?: number;
  };
  compliance: { score: number; level: string; deductions: { reason: string; points: number }[] };
  renewal: { status: string; autoRenew: boolean; dueAt?: string };
  analysis?: { ocrText?: string; languages: string[]; legibility: number; notes?: string; modelId: string };
  review?: { reviewedBy: string; reviewedAt: string; decision: 'approved' | 'rejected'; reason?: string };
  createdAt: string;
}

export interface ComplianceGap {
  docType: string;
  label: string;
  reason: 'never_submitted' | 'expired' | 'rejected' | 'awaiting_review' | 'expiring_soon';
  detail: string;
  points: number;
  documentId?: string;
  expiresAt?: string;
}

export interface HolderCompliance {
  score: number;
  level: 'low' | 'medium' | 'high' | 'critical';
  compliant: boolean;
  documentsHeld: number;
  gaps: ComplianceGap[];
  nextExpiry?: { docType: string; expiresAt: string; daysRemaining: number };
}

export const aiDocumentApi = {
  /**
   * Uploads for analysis. Returns 202 — the vision pass runs in the background,
   * so poll `detail` or watch for the compliance alert rather than expecting
   * results on this response.
   */
  upload: (file: File, meta?: { declaredType?: string; boat?: string; marina?: string; fuelStation?: string; renewalOf?: string }) => {
    const form = new FormData();
    form.append('file', file);
    for (const [key, value] of Object.entries(meta ?? {})) {
      if (value) form.append(key, value);
    }
    return post<Ok<{ document: AIDocument; analysis: string }>>('/ai-documents', form);
  },

  mine: (params?: { status?: AIDocumentStatus; docType?: string; expiring?: 'true'; page?: number; limit?: number }) =>
    get<Ok<Paginated<AIDocument>>>('/ai-documents/my', params),

  /** Admin review queue, riskiest first. */
  queue: (params?: { status?: AIDocumentStatus; docType?: string; owner?: string; page?: number; limit?: number }) =>
    get<Ok<Paginated<AIDocument>>>('/ai-documents', params),

  detail: (id: string) => get<Ok<{ document: AIDocument }>>(`/ai-documents/${id}`),

  reanalyze: (id: string) => post<Ok<{ document: AIDocument }>>(`/ai-documents/${id}/reanalyze`),

  review: (id: string, decision: 'approved' | 'rejected', reason?: string) =>
    patch<Ok<{ document: AIDocument }>>(`/ai-documents/${id}/review`, { decision, reason }),

  /** "May this account operate today" — a different question from any one document's score. */
  compliance: (params?: { owner?: string; providerType?: string }) =>
    get<Ok<{ compliance: HolderCompliance; providerType: string | null }>>('/ai-documents/compliance', params),

  /** The catalogue, so upload forms are not hardcoded per client. */
  specs: () =>
    get<
      Ok<{
        types: {
          key: string;
          label: string;
          description: string;
          expires: boolean;
          autoRenew: boolean;
          leadDays: number;
          fields: { key: string; label: string; kind: string; required: boolean }[];
        }[];
      }>
    >('/ai-documents/specs'),
};

// ── Reputation and moderation ───────────────────────────────────────────────

export interface ReputationBreakdown {
  score: number;
  components: {
    rating: number;
    volume: number;
    recency: number;
    responsiveness: number;
    reliability: number;
    compliance: number;
  };
  explanation: { component: string; value: number; weight: number; contribution: number; note: string }[];
  rank: number | null;
  rankPercentile: number | null;
  previousRank: number | null;
  badges: string[];
  ratingStats?: { count: number; mean: number; bayesianMean: number; verifiedCount: number };
  reliabilityStats?: { completed: number; cancelledByProvider: number; noShows: number; totalBookings: number };
  responsivenessStats?: { reviewsReplied: number; reviewsEligible: number; medianReplyHours?: number };
}

export const reputationApi = {
  /** The provider's own view, recomputed on demand and with the breakdown. */
  me: () => get<Ok<ReputationBreakdown>>('/reputation/me'),

  /** The public view — narrower on purpose; components stay private. */
  provider: (providerId: string) =>
    get<
      Ok<{
        provider: { id: string; name: string; avatar?: string };
        score: number;
        rank: number | null;
        rankPercentile: number | null;
        badges: string[];
        ratingStats: { count: number; mean: number; distribution: Record<string, number>; verifiedCount: number };
        computedAt: string;
      }>
    >(`/reputation/${providerId}`),

  ranking: (providerType: string, limit = 20) =>
    get<
      Ok<{
        providerType: string;
        ranking: {
          rank: number;
          provider: { id: string; name: string; avatar?: string };
          score: number;
          badges: string[];
          reviewCount: number;
          meanRating: number;
        }[];
      }>
    >('/reputation/ranking', { providerType, limit }),

  /** Public listing — hidden reviews are excluded server-side. */
  reviews: (params?: { captain?: string; marina?: string; fuelStation?: string; boat?: string; page?: number; limit?: number }) =>
    get<Ok<Paginated<Record<string, unknown>>>>('/reputation/reviews', params),

  reportReview: (
    reviewId: string,
    reason:
      | 'spam'
      | 'offensive'
      | 'fake'
      | 'personal_information'
      | 'off_topic'
      | 'not_a_customer'
      | 'conflict_of_interest'
      | 'other',
    detail?: string
  ) =>
    post<Ok<{ reportCount: number; moderationStatus: string }>>(`/reputation/reviews/${reviewId}/report`, {
      reason,
      detail,
    }),

  // Admin
  moderationQueue: (params?: { page?: number; limit?: number }) =>
    get<Ok<Paginated<{ review: Record<string, unknown> | null; reportCount: number; reasons: string[] }>>>(
      '/reputation/moderation/queue',
      params
    ),

  /** Upholding hides the review; a note is required so the decision is defensible. */
  resolveReports: (reviewId: string, decision: 'upheld' | 'dismissed', note?: string) =>
    patch<Ok<{ review: Record<string, unknown> }>>(`/reputation/moderation/${reviewId}`, { decision, note }),

  listAll: (params?: { providerType?: string; page?: number; limit?: number }) =>
    get<Ok<Paginated<Record<string, unknown>>>>('/reputation/providers', params),

  recompute: (providerId: string) => post<Ok<ReputationBreakdown>>(`/reputation/${providerId}/recompute`),
};

// ── Notification preferences and delivery log ───────────────────────────────

export type DeliveryChannel = 'in_app' | 'push' | 'email' | 'sms';
export type AlertCategory =
  | 'booking'
  | 'payment'
  | 'compliance'
  | 'chat'
  | 'operations'
  | 'marketing'
  | 'emergency';

export const notificationPreferenceApi = {
  /**
   * Returns effective settings, not stored ones — a user who has never opened
   * this screen still gets the defaults they are actually subject to.
   * `locked.emergency` explains why that row cannot be switched off.
   */
  get: () =>
    get<
      Ok<{
        channels: Record<AlertCategory, DeliveryChannel[]>;
        quietHours: { enabled: boolean; startMinute: number; endMinute: number; timezoneOffsetMinutes: number };
        marketingUnsubscribed: boolean;
        availableChannels: DeliveryChannel[];
        locked: { emergency: string };
      }>
    >('/notifications/preferences'),

  update: (body: {
    channels?: Partial<Record<Exclude<AlertCategory, 'emergency'>, DeliveryChannel[]>>;
    quietHours?: { enabled: boolean; startMinute: number; endMinute: number; timezoneOffsetMinutes?: number };
    marketingUnsubscribed?: boolean;
  }) => patch<Ok<{ preferences: Record<string, unknown> }>>('/notifications/preferences', body),

  /** Per-channel delivery record. Destinations come back masked. */
  deliveries: (params?: { channel?: DeliveryChannel; status?: string; page?: number; limit?: number }) =>
    get<
      Ok<
        Paginated<{
          id: string;
          notification?: { type: string; title: string; createdAt: string };
          category: string;
          channel: DeliveryChannel;
          status: 'queued' | 'sent' | 'failed' | 'suppressed';
          attempts: number;
          destination?: string;
          suppressReason?: string;
          error?: string;
          sentAt?: string;
          createdAt: string;
        }>
      >
    >('/notifications/deliveries', params),
};

// ── Inbox ───────────────────────────────────────────────────────────────────

export const inboxApi = {
  /** One query for the app-icon badge. */
  unreadTotal: () => get<Ok<{ unreadTotal: number }>>('/chats/unread'),

  openSupport: (subject: string, message?: string) =>
    post<Ok<{ chat: Record<string, unknown> }>>('/chats/support', { subject, message }),

  archive: (chatId: string, archived: boolean) =>
    patch<Ok<{ archived: boolean }>>(`/chats/${chatId}/archive`, { archived }),

  mute: (chatId: string, muted: boolean) => patch<Ok<{ muted: boolean }>>(`/chats/${chatId}/mute`, { muted }),
};

// ── Exports ─────────────────────────────────────────────────────────────────

export type ExportFormat = 'csv' | 'excel' | 'pdf';

/**
 * Exports stream a file rather than returning JSON, so they bypass the shared
 * `request` helper and are fetched directly with the auth header attached.
 * Triggering a download this way (rather than by pointing the browser at the
 * URL) keeps the bearer token out of the address bar and out of history.
 */
async function downloadExport(path: string, params: Record<string, unknown>, fallbackName: string): Promise<void> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }

  const response = await fetch(`${API_URL}${path}?${search.toString()}`, {
    // Bypasses `request`, so it needs the tunnel header itself — without it
    // ngrok answers the browser with its interstitial and the download fails as
    // "Failed to fetch" long before the backend is asked for a file.
    headers: { ...TUNNEL_HEADERS, Authorization: `Bearer ${getToken() ?? ''}` },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.message ?? `Export failed (${response.status})`);
  }

  // Prefer the server's filename — it carries the date the export covers.
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = match?.[1] ?? fallbackName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Which side of the business a report is about — a second axis alongside `group`.
 *
 * With forty-odd reports, `group` alone is not enough structure: fourteen
 * unstructured finance entries is a list nobody finds anything in. The vertical is
 * what turns it into "Platform / Boats / Marina / Fuel / Maintenance" inside each
 * group.
 */
export type ReportVertical = 'platform' | 'admin' | 'boat' | 'marina' | 'fuel' | 'maintenance';

/** The console asking for a catalog. `admin` is the whole platform. */
export type ReportPortal = 'admin' | 'boat' | 'marina' | 'fuel' | 'maintenance';

export interface ReportCatalogEntry {
  key: string;
  label: string;
  group: 'finance' | 'operations' | 'compliance' | 'customers' | 'executive';
  vertical: ReportVertical;
  description: string;
  dateRanged: boolean;
}

export interface ReportMetric {
  key: string;
  label: string;
  value: number | string;
  kind?: 'currency' | 'percent' | 'count' | 'duration' | 'text';
  delta?: number;
  /** What the figure actually counts — rendered as a tooltip on the card. */
  hint?: string;
}

/**
 * A chart series.
 *
 * `kind` is a hint, not an instruction: bars are always a correct fallback, but a
 * trend over time reads badly as bars and the server is the only thing that knows
 * which its x axis is.
 */
export interface ReportSeries {
  label: string;
  points: { x: string; y: number }[];
  kind?: 'bar' | 'line';
  valueKind?: 'currency' | 'percent' | 'count' | 'duration';
}

/** The grain of a trend series. `auto` lets the server pick from the span. */
export type Granularity = 'auto' | 'day' | 'week' | 'month';

export type ReportFilterKind = 'select' | 'multiselect' | 'text' | 'number' | 'date' | 'boolean';

/**
 * Something a report can do with the rows currently on screen.
 *
 * Declared by the server alongside the filters, so a report that gains an action
 * gets a working button here with no client change — the same property that lets
 * one screen render every report's columns.
 */
export interface ReportActionDef {
  key: string;
  label: string;
  description?: string;
  /** Shown for confirmation before it fires. Absent runs on the first click. */
  confirm?: string;
}

export interface ReportFilterDef {
  key: string;
  label: string;
  kind: ReportFilterKind;
  /** `group` is an optional heading (the provider type, in a provider picker); `image` a picture such as a logo. */
  options: { value: string; label: string; group?: string; image?: string }[];
  placeholder?: string;
  hint?: string;
}

/**
 * Where a row goes when it is clicked — a report key and the filters to arrive
 * with. Declared by the server alongside the row, so this client never has to know
 * which figure is broken down by which report.
 */
export interface ReportRowLink {
  report: string;
  filters?: Record<string, string>;
}

/** The row key a drill-through travels under. Mirrors `ROW_LINK` on the server. */
export const ROW_LINK = '_link';

export interface ReportRun {
  key: string;
  label: string;
  group: string;
  title: string;
  subtitle?: string;
  /** A picture of the report's subject — one provider's logo — or null. Often `/uploads/…`. */
  image?: string | null;
  /** Column order and headers come with the data, so one screen renders any report. */
  /**
   * `width` is the report's own declared column width — the number that sizes
   * the exported spreadsheet. The table uses it as a ratio so a business name
   * gets more room than a guest count.
   */
  columns: { key: string; header: string; width?: number }[];
  rows: Record<string, unknown>[];
  metrics: ReportMetric[];
  series: ReportSeries[];
  /**
   * A totals row for the table footer, keyed by column.
   *
   * Covers the whole matched set rather than the page on screen — which is exactly
   * why it comes from the server. Summing the rows this client holds would total
   * one page and look like the total.
   */
  totals: Record<string, string | number> | null;
  truncated: boolean;
  /** Rows on this page. */
  rowCount: number;
  /** Rows the filters and search left, across every page. */
  matchedRows: number;
  /** Rows before the free-text search narrowed them, so a client can say "12 of 340". */
  totalRows: number;
  sort: { key: string | null; dir: 'asc' | 'desc' };
  page: { page: number; pageSize: number; pages: number; from: number; to: number };
  granularity: Granularity;
}

/**
 * Reporting & business intelligence.
 *
 * The catalog is what the UI renders its index from, and every report returns its
 * own columns — so a report added on the backend appears here with no client
 * change, and the export is the same `run()` the table came from rather than a
 * second query that could disagree with it.
 */
export const reportApi = {
  /**
   * The report index for one console.
   *
   * `portal` is what a role cannot express: an admin may run every report on the
   * platform, so without it the marina console offered them fleet utilisation and
   * fuel sales alongside berth revenue. Platform-wide reports come back in every
   * portal; vertical ones only in their own.
   */
  catalog: (portal?: ReportPortal) =>
    get<Ok<{
      reports: ReportCatalogEntry[];
      groups: string[];
      verticals: ReportVertical[];
      portal: ReportPortal | null;
      formats: ExportFormat[];
      rowLimit: number;
    }>>('/reports/catalog', portal ? { portal } : undefined),

  /**
   * The filter controls for one report, with option lists resolved for this caller.
   *
   * Separate from the catalog because caller-scoped options (their vessels, their
   * marinas) cost a query each — worth paying when somebody opens a report, not
   * across the whole index.
   */
  filters: (key: string) =>
    get<
      Ok<{
        key: string;
        dateRanged: boolean;
        searchable: boolean;
        filters: ReportFilterDef[];
        actions: ReportActionDef[];
        /** Empty for a report with no time axis, so no grain picker is drawn. */
        granularities: Granularity[];
        defaultPageSize: number;
        maxPageSize: number;
      }>
    >(`/reports/run/${key}/filters`),

  run: (key: string, params?: Record<string, string | undefined>) =>
    get<Ok<ReportRun>>(`/reports/run/${key}`, params),

  /**
   * Performs a declared action against the rows the same params select.
   *
   * Takes the identical query the run and the export take, which is what makes
   * "act on this table" address the table on screen rather than a fresh query.
   */
  action: (key: string, actionKey: string, params?: Record<string, string | undefined>) =>
    post<Ok<{ message: string; count: number }>>(
      // The filters ride in the query string, exactly as they do for the run and
      // the export — same shape in, same rows out.
      `/reports/run/${key}/actions/${actionKey}${qs(params)}`
    ),

  /** Streams the same rows the table shows, as CSV, Excel or PDF. */
  download: (key: string, params: { format: ExportFormat } & Record<string, unknown>) =>
    downloadExport(
      `/reports/run/${key}/export`,
      params,
      `${key}.${params.format === 'excel' ? 'xlsx' : params.format}`
    ),
};

export const exportApi = {
  reservations: (params: { format: ExportFormat; status?: string; from?: string; to?: string; provider?: string; customer?: string }) =>
    downloadExport('/exports/reservations', params, `reservations.${params.format === 'excel' ? 'xlsx' : params.format}`),

  reviews: (params: { format: ExportFormat; providerId?: string; from?: string; to?: string }) =>
    downloadExport('/exports/reviews', params, `reviews.${params.format === 'excel' ? 'xlsx' : params.format}`),

  documents: (params: { format: ExportFormat; owner?: string; status?: string; expiring?: 'true' }) =>
    downloadExport('/exports/documents', params, `compliance.${params.format === 'excel' ? 'xlsx' : params.format}`),

  reputation: (params: { format: ExportFormat; providerType?: string }) =>
    downloadExport('/exports/reputation', params, `reputation.${params.format === 'excel' ? 'xlsx' : params.format}`),
};
