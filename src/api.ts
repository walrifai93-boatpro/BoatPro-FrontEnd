// ---------------------------------------------------------------------------
// BoatPro backend API client (marina portal)
//
// Talks to the real BoatPro backend — no dummy data.
//
// The base URL is resolved by `getApiUrl` below, in order: VITE_API_URL, then
// the LAN/localhost guess when VITE_USE_LOCAL is set, then PROD_API_URL. The
// header used to say it defaulted to "the deployed Render instance", which had
// not been true since the API moved off Render — the one host the code still
// mentions by name is a *legacy upload* origin, not the API.
// ---------------------------------------------------------------------------

import { ApiError, apiErrorFromResponse } from './async/errors';
import { beginActivity, endActivity } from './async/activity';
import type { DocumentReview } from './admin/DocumentFindings'
import { getPortalLanguage } from './i18n/runtime'

/**
 * Where the portal talks to when nothing else is configured.
 *
 * Overridable at build time with `VITE_PROD_API_URL`, so pointing a build at a
 * new deployment (or an ngrok tunnel for device testing) is a `.env` change
 * rather than an edit to this file — which is what the commented-out ngrok URL
 * that used to sit on the next line really was.
 *
 * `VITE_API_URL` still wins over this; see `getApiUrl`.
 */
const PROD_API_URL =
  (import.meta as any).env?.VITE_PROD_API_URL || 'https://boatpro.kyptronix.net/api/v1';

const getApiUrl = (): string => {
  const envUrl = (import.meta as any).env?.VITE_API_URL;
  if (envUrl) return envUrl;
  const useLocal = (import.meta as any).env?.VITE_USE_LOCAL === 'true';
  if (useLocal && typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:5000/api/v1';
    }
    if (/^192\.168\.\d+\.\d+$/.test(hostname) || /^10\.\d+\.\d+\.\d+$/.test(hostname)) {
      return `http://${hostname}:5000/api/v1`;
    }
  }
  return PROD_API_URL;
};

export const API_URL: string = getApiUrl();

/** A dead deployment that stored absolute upload URLs. See `fileUrl`. */
const LEGACY_UPLOAD_ORIGIN = /^https?:\/\/boatpro-1\.onrender\.com/i;

/** Absolute URL for a server-relative upload path (`/uploads/...`). */
export function fileUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  // Rows written while the API lived on Render still hold absolute URLs to a
  // host that no longer serves them. Rewritten to *this build's* origin rather
  // than to a second hardcoded hostname, so the fixup keeps working wherever
  // the API is pointed next.
  let cleanPath = path.replace(LEGACY_UPLOAD_ORIGIN, API_URL.replace(/\/api\/v1\/?$/, ''));
  if (/^https?:\/\//i.test(cleanPath)) return cleanPath;
  return `${API_URL.replace(/\/api\/v1\/?$/, '')}${cleanPath.startsWith('/') ? '' : '/'}${cleanPath}`;
}

/**
 * Sent on every request, for the same reason the two mobile apps send it.
 *
 * The API is reached through an ngrok tunnel during development. ngrok's free
 * tier answers *browser* requests with an HTML interstitial before the request
 * ever reaches the backend, and that page carries no CORS headers — so Chrome
 * reports `net::ERR_FAILED` plus "No 'Access-Control-Allow-Origin' header", which
 * reads as a backend CORS fault when the backend was never asked. curl is not a
 * browser, so it sees the real API and the same URL looks perfectly healthy from
 * the terminal.
 *
 * `boatpro/src/api/client.ts` and `boatpro-provider/src/api/client.ts` have
 * always sent this; the portal was the one client that did not, which is why it
 * alone showed an empty dashboard against a tunnel the phones could reach.
 */
export const TUNNEL_HEADERS = { 'ngrok-skip-browser-warning': 'true' } as const;

const TOKEN_KEY = 'bp-token';
const REFRESH_KEY = 'bp-refresh';
/** Set when the operator asked to stay signed in past this browser session. */
const PERSIST_KEY = 'bp-persist';

/**
 * Where this session's tokens live.
 *
 * Both tokens used to go to `localStorage` unconditionally, which made the
 * sign-in screen's "Remember me" checkbox decorative: `Login.tsx` read the
 * state into a variable and never used it, so the session outlived the browser
 * whether the box was ticked or not. On a shared dockside machine that is the
 * wrong default to apply silently, and a security control that visibly exists
 * and quietly does not is worse than not offering one.
 *
 * Unticked now means `sessionStorage`, which the browser drops when the tab
 * closes. The marker itself lives in `localStorage` so the choice survives the
 * thing it governs — a session-scoped marker would be gone exactly when the
 * next load needs to know where to look.
 */
function wantsPersistence(): boolean {
  try {
    return localStorage.getItem(PERSIST_KEY) !== 'false';
  } catch {
    // Private mode or blocked storage: treat as the safer, non-persistent case.
    return false;
  }
}

function tokenStore(): Storage {
  return wantsPersistence() ? localStorage : sessionStorage;
}

/**
 * Records the operator's choice and moves any token already issued.
 *
 * Called by the sign-in form *before* it signs in, so the tokens the login
 * response produces are written to the right store straight away.
 */
export function setSessionPersistence(persist: boolean) {
  try {
    localStorage.setItem(PERSIST_KEY, persist ? 'true' : 'false');
  } catch {
    /* nothing to record against — the getter's fallback covers it */
  }
  // Migrate whatever is already held, so flipping the choice mid-session does
  // not strand a token in the store that is no longer being read.
  const from = persist ? sessionStorage : localStorage;
  const to = persist ? localStorage : sessionStorage;
  for (const key of [TOKEN_KEY, REFRESH_KEY]) {
    try {
      const value = from.getItem(key);
      if (value !== null) {
        to.setItem(key, value);
        from.removeItem(key);
      }
    } catch {
      /* best effort */
    }
  }
}

/**
 * Reads from both stores rather than only the configured one.
 *
 * A session signed in before this existed has its tokens in `localStorage` with
 * no marker, and `wantsPersistence()` defaults to true for exactly that case —
 * but reading both is what makes the switch itself safe, in either direction,
 * at any point in a session.
 */
function readToken(key: string): string | null {
  try {
    return sessionStorage.getItem(key) ?? localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeToken(key: string, value: string | null) {
  try {
    // Cleared from both stores whichever way round they are, so a token can
    // never survive in the one that is not currently being written.
    sessionStorage.removeItem(key);
    localStorage.removeItem(key);
    if (value) tokenStore().setItem(key, value);
  } catch {
    /* storage unavailable — the session simply does not survive a reload */
  }
}

export function getToken(): string | null {
  return readToken(TOKEN_KEY);
}
export function setToken(token: string | null) {
  writeToken(TOKEN_KEY, token);
}
export function setRefreshToken(token: string | null) {
  writeToken(REFRESH_KEY, token);
}
export function getRefreshToken(): string | null {
  return readToken(REFRESH_KEY);
}

export type QueryPrimitive = string | number | boolean;
export type QueryValue = QueryPrimitive | readonly QueryPrimitive[] | null | undefined;
export type QueryParams = Record<string, QueryValue>;

/**
 * Serializes typed query values without losing meaningful `false`/`0` values.
 * Arrays use the comma-separated wire form understood by the API query parser;
 * blank array members are removed so `[]` never becomes an accidental filter.
 */
export function buildQueryString(params?: QueryParams): string {
  if (!params) return '';
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      const items = value.map(String).map(item => item.trim()).filter(Boolean);
      if (items.length > 0) sp.set(key, items.join(','));
      continue;
    }
    sp.set(key, String(value));
  }
  const search = sp.toString();
  return search ? `?${search}` : '';
}

export const qs = buildQueryString;

/**
 * Options this layer understands beyond the standard `RequestInit`.
 */
export interface ApiRequestOptions extends RequestInit {
  /**
   * Keep this request out of the global route/activity bar. Use it for polling,
   * typeaheads and background refreshes — anything the user did not explicitly
   * trigger and does not need told about (§21).
   */
  silent?: boolean;
  /**
   * Keep this request from raising the full-screen LoadingOverlay while still
   * showing the top bar — for long work that has its own progress UI.
   * Multipart bodies are excluded automatically.
   */
  noOverlay?: boolean;
}

let isRefreshing = false;
let refreshQueue: Array<(token: string | null) => void> = [];

// ── Session expiry ──────────────────────────────────────────────────────────
// Clearing the stored tokens is not the same as ending the session, and this
// layer used to do only the first. When a refresh was refused, both tokens were
// dropped from localStorage and nothing told `AuthProvider`, which kept
// `status: 'authed'` and a populated `user` — so `RequireRole` went on
// rendering the console while every request in it went out unauthenticated,
// 401'd, found no refresh token and threw. The operator was left looking at a
// fully drawn portal where each panel showed an error, and the only way back to
// the sign-in screen was to reload by hand.
//
// A subscription rather than an import of the auth module, because `auth.tsx`
// already imports this file; the dependency has to point one way.
type SessionExpiredHandler = () => void;
const sessionExpiredHandlers = new Set<SessionExpiredHandler>();

/** Notified when the refresh token is refused, i.e. the session is over. */
export function onSessionExpired(handler: SessionExpiredHandler): () => void {
  sessionExpiredHandlers.add(handler);
  return () => {
    sessionExpiredHandlers.delete(handler);
  };
}

function endSession() {
  setToken(null);
  setRefreshToken(null);
  for (const handler of sessionExpiredHandlers) handler();
}

async function performTokenRefresh(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
  try {
    const res = await fetch(`${API_URL}/auth/refresh-token`, {
      method: 'POST',
      headers: { ...TUNNEL_HEADERS, 'Accept-Language': getPortalLanguage(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      endSession();
      return null;
    }
    const data = await res.json();
    const newAccessToken = data.data?.accessToken;
    const newRefreshToken = data.data?.refreshToken;
    if (newAccessToken) {
      setToken(newAccessToken);
      if (newRefreshToken) setRefreshToken(newRefreshToken);
      return newAccessToken;
    }
    // A 200 with no token in it is as dead as a refusal — there is nothing to
    // retry with, so say so rather than leaving the session half-alive.
    endSession();
    return null;
  } catch {
    // Deliberately *not* `endSession()`: this branch is a network failure, not
    // a rejected credential. Signing someone out because their Wi-Fi dropped
    // for one request would be the wrong answer, and the stored refresh token
    // is still good when they come back.
    return null;
  }
}

export async function request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const token = getToken();
  const isForm = options.body instanceof FormData;
  const { silent, noOverlay, ...init } = options;
  // Reads already render their own skeleton or keep the previous data while
  // refreshing. A global blur over every GET makes the entire portal appear to
  // reload whenever a dashboard, badge or notification poll runs.
  const method = (init.method ?? 'GET').toUpperCase();
  const overlay = !isForm && !noOverlay && method !== 'GET' && method !== 'HEAD';

  // Drives the global activity bar. The bar waits ~400ms before appearing, so
  // short requests never make it flash.
  if (!silent) beginActivity({ overlay });

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        ...TUNNEL_HEADERS,
        'Accept-Language': getPortalLanguage(),
        // FormData must set its own multipart boundary.
        ...(isForm ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers || {}),
      },
    });
  } catch (e) {
    if (!silent) endActivity({ overlay });
    // `fetch` rejects the same way for offline, DNS failure and CORS, so this is
    // as specific as the platform allows. An abort is not a failure.
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new ApiError('Cancelled.', 'cancelled');
    }
    throw new ApiError(
      'Unable to connect to the server. Please check your internet connection and try again.',
      'network'
    );
  }

  if (!silent) endActivity({ overlay });

  let body: any = {};
  try {
    body = await res.json();
  } catch {
    /* empty / non-JSON body */
  }

  if (res.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/refresh-token') && !path.startsWith('/auth/register')) {
    const refreshToken = getRefreshToken();
    if (refreshToken) {
      if (!isRefreshing) {
        isRefreshing = true;
        const newToken = await performTokenRefresh();
        isRefreshing = false;
        refreshQueue.forEach((cb) => cb(newToken));
        refreshQueue = [];

        if (newToken) {
          return request<T>(path, options);
        }
      } else {
        return new Promise<T>((resolve, reject) => {
          refreshQueue.push((newToken) => {
            if (newToken) {
              resolve(request<T>(path, options));
            } else {
              reject(apiErrorFromResponse(401, body));
            }
          });
        });
      }
    }
  }

  if (!res.ok) {
    // `apiErrorFromResponse` keeps the status and picks user-safe copy: it
    // trusts the backend's own wording for 4xx (written for the user) but never
    // for 5xx or auth, where it is an internal detail — except a sign-in's own
    // refusal, which is addressed to the user.
    throw apiErrorFromResponse(res.status, body, { signIn: path.startsWith('/auth/') });
  }
  return body as T;
}

/**
 * Multipart upload with *real*, measured progress.
 *
 * `fetch` cannot report upload progress — there is no request-body progress
 * event in the Fetch API, which is why every upload in this portal was
 * previously a silent wait. `XMLHttpRequest` does expose `upload.onprogress`,
 * so file uploads go through this instead.
 *
 * `onProgress` reaches 100 when the bytes are away. Whatever the server does
 * next (Cloudinary transcode, PDF generation) has no knowable duration, so
 * callers must present that phase as an indeterminate "Processing…" rather than
 * padding the percentage (§8/§38).
 */
export function uploadWithProgress<T>(
  path: string,
  form: FormData,
  opts: {
    method?: 'POST' | 'PATCH' | 'PUT';
    onProgress?: (pct: number) => void;
    /** Lets a caller cancel an in-flight upload. */
    signal?: AbortSignal;
    silent?: boolean;
  } = {}
): Promise<T> {
  const { method = 'POST', onProgress, signal, silent } = opts;

  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        if (!silent) endActivity({ overlay: false });
      }
    };

    // Uploads draw their own progress, so they never raise the overlay.
    if (!silent) beginActivity({ overlay: false });

    xhr.open(method, `${API_URL}${path}`);
    const token = getToken();
    for (const [k, v] of Object.entries(TUNNEL_HEADERS)) xhr.setRequestHeader(k, v);
    xhr.setRequestHeader('Accept-Language', getPortalLanguage());
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    // Deliberately no Content-Type: the browser must set the multipart boundary.

    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        // `lengthComputable` false means the total is unknown — report nothing
        // rather than inventing a denominator.
        if (!e.lengthComputable || e.total <= 0) return;
        onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
      };
    }

    xhr.onload = () => {
      finish();
      let body: any = {};
      try {
        body = JSON.parse(xhr.responseText || '{}');
      } catch {
        /* empty / non-JSON body */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as T);
      else reject(apiErrorFromResponse(xhr.status, body));
    };

    xhr.onerror = () => {
      finish();
      reject(
        new ApiError(
          'Unable to connect to the server. Please check your internet connection and try again.',
          'network'
        )
      );
    };

    xhr.ontimeout = () => {
      finish();
      reject(new ApiError('The upload took too long. Please try again.', 'timeout'));
    };

    xhr.onabort = () => {
      finish();
      reject(new ApiError('Cancelled.', 'cancelled'));
    };

    if (signal) {
      if (signal.aborted) {
        finish();
        reject(new ApiError('Cancelled.', 'cancelled'));
        return;
      }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }

    xhr.send(form);
  });
}

// Exported so the newer feature modules (see api/platform.ts) can reuse the
// same auth handling, refresh-on-401 and error shaping rather than growing a
// second, subtly different HTTP layer beside this one.
export const get = <T>(path: string, params?: QueryParams, options: ApiRequestOptions = {}) =>
  request<T>(`${path}${buildQueryString(params)}`, { ...options, method: 'GET' });
export const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body ?? {}) });
export const patch = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'PATCH', body: body instanceof FormData ? body : JSON.stringify(body ?? {}) });
const put = <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) });
export const del = <T>(path: string) => request<T>(path, { method: 'DELETE' });

export interface Paginated<T> {
  items: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}
export interface Ok<T> {
  success: boolean;
  data: T;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export interface ApiUser {
  _id: string;
  id?: string;
  name: string;
  email: string;
  role: string;
  phone?: string;
  avatar?: string;
  business?: {
    businessName?: string;
    contactNumber?: string;
    address?: string;
    description?: string;
    country?: string;
    city?: string;
    latitude?: number;
    longitude?: number;
    vhfChannel?: string;
  };
  onboarding?: {
    status: 'incomplete' | 'pending' | 'approved' | 'rejected' | 'suspended';
    providerType?: 'boat_provider' | 'marina_provider' | 'fuel_provider' | 'maintenance_provider';
    billingModel?: 'subscription' | 'commission';
    commissionRate?: number;
    walletBalance?: number;
    rejectionReason?: string;
    subscriptionExpiresAt?: string;
    subscriptionExpiry?: string;
  };
}

interface AuthResponse {
  success: boolean;
  data: { user: ApiUser; accessToken: string; refreshToken?: string };
}

interface WorkerInviteAcceptResponse {
  success: boolean;
  data: { user: ApiUser; accessToken?: string; refreshToken?: string; pendingApproval?: boolean };
}

export const authApi = {
  login: (email: string, password: string) => post<AuthResponse>('/auth/login', { email, password }),

  /** `emailOtpCode` — the 6-digit code from `sendSignupEmailOtp`; the API refuses email sign-up without it. */
  register: (data: { name: string; email: string; password: string; phone?: string; role: string; emailOtpCode?: string }) =>
    post<AuthResponse>('/auth/register', data),

  /** Emails a 6-digit sign-up code (10-minute TTL). Portal roles are all providers, hence `app: 'provider'`. */
  sendSignupEmailOtp: (email: string) =>
    post<{ success: boolean; message: string; devCode?: string }>('/auth/signup/send-email-otp', { email, app: 'provider' }),

  me: () => get<Ok<{ user: ApiUser }>>('/auth/me'),

  refreshToken: (refreshToken: string) =>
    post<AuthResponse>('/auth/refresh-token', { refreshToken }),

  logout: (refreshToken?: string) =>
    post('/auth/logout', { refreshToken }).catch(() => {
      /* logout is best-effort; always clear locally regardless */
    }),

  forgotPassword: (email: string) => post<{ success: boolean; message: string; devResetCode?: string }>('/auth/forgot-password', { email }),
  resetPassword: (email: string, code: string, newPassword: string) => post<{ success: boolean; message: string }>('/auth/reset-password', { email, code, newPassword }),

  changePassword: (currentPassword: string, newPassword: string) =>
    patch<Ok<unknown>>('/auth/change-password', { currentPassword, newPassword }),
};

export const workerInviteApi = {
  verify: (token: string) => post<Ok<{ name: string; email: string }>>('/auth/worker-invite/verify', { token }),
  accept: (token: string, password: string) => post<WorkerInviteAcceptResponse>('/auth/worker-invite/accept', { token, password }),
};

export const maintWorkerInviteApi = {
  verify: (token: string) => post<Ok<{ name: string; email: string }>>('/auth/maint-invite/verify', { token }),
  accept: (token: string, password: string) => post<WorkerInviteAcceptResponse>('/auth/maint-invite/accept', { token, password }),
};

/**
 * Vessel crew invites.
 *
 * The accept page is shared with the two worker portals, but crew are not portal
 * users: they finish here and then work in the BoatPro Provider mobile app, which
 * is where the boarding-pass scanner lives. So this sets their password and stops
 * — `WorkerAcceptInvite` shows them a "now open the app" panel rather than
 * adopting a portal session.
 */
export const crewInviteApi = {
  verify: (token: string) => post<Ok<{ name: string; email: string }>>('/auth/crew-invite/verify', { token }),
  accept: (token: string, password: string) => post<WorkerInviteAcceptResponse>('/auth/crew-invite/accept', { token, password }),
};

export const profileApi = {
  update: (data: { name?: string; phone?: string }) => patch<Ok<{ user: ApiUser }>>('/profile', data),
  uploadAvatar: (file: File) => {
    const fd = new FormData();
    fd.append('avatar', file);
    return patch<Ok<{ user: ApiUser }>>('/profile/avatar', fd);
  },
  uploadBusinessLogo: (file: File) => {
    const fd = new FormData();
    fd.append('logo', file);
    return patch<Ok<{ logo: string; business: ApiUser['business']; user: ApiUser }>>('/profile/business/logo', fd);
  },
  uploadBusinessImages: (files: File[], category?: string) => {
    const fd = new FormData();
    files.forEach((f) => fd.append('images', f));
    if (category) fd.append('category', category);
    return post<Ok<{ logo?: string; covers?: string[]; images: string[]; imagesCategorized: { url: string; category?: string }[]; business: ApiUser['business'] }>>('/profile/business/images', fd);
  },
  deleteBusinessImage: (url: string) =>
    del<Ok<{ logo?: string; covers?: string[]; images: string[]; imagesCategorized: { url: string; category?: string }[]; business: ApiUser['business'] }>>(`/profile/business/images?url=${encodeURIComponent(url)}`),
  updateBusiness: (data: { businessName?: string; businessNameAr?: string; logo?: string; contactNumber?: string; contactPhone?: string; address?: string; description?: string; descriptionAr?: string; city?: string; country?: string; region?: string; latitude?: number; longitude?: number; vhfChannel?: string }) =>
    patch<Ok<{ business: ApiUser['business'] }>>('/profile/business', data),
};

export const uploadApi = {
  image: async (file: File) => {
    const res = await profileApi.uploadBusinessLogo(file);
    return { data: { url: res.data.logo } };
  },
  avatar: async (file: File) => {
    const res = await profileApi.uploadAvatar(file);
    return { data: { url: res.data.user.avatar || '' } };
  },
};

// ---------------------------------------------------------------------------
// Marina + berth inventory
// ---------------------------------------------------------------------------
export type FacilityKey =
  | 'fuel' | 'electricity' | 'water' | 'waste' | 'pumpout' | 'showers' | 'restrooms' | 'laundry'
  | 'wifi' | 'restaurant' | 'cafe' | 'parking' | 'security' | 'cctv' | 'pool' | 'gym'
  | 'supermarket' | 'boatlift' | 'crane' | 'customs' | 'prayer_room' | 'lounge';

export interface MarinaFacility {
  key: FacilityKey;
  available: boolean;
  detail?: string;
}

export interface MarinaSettings {
  currency: string;
  vatRate: number;
  autoApproveReservations: boolean;
  checkInTime: string;
  checkOutTime: string;
  vhfChannel?: string;
  cancellationWindowHours: number;
  electricityRate?: number;
  waterRate?: number;
  notifyByEmail: boolean;
  notifyBySms: boolean;
}

export interface EmergencyContact {
  name: string;
  phone: string;
  kind?: string;
  kindEn?: string;
}

export type MarinaApprovalStatus = 'draft' | 'pending' | 'approved' | 'rejected';

export interface MissingDetailItem {
  id: string;
  title: string;
  category: 'identity' | 'location' | 'media' | 'specs' | 'berths' | 'safety' | 'finance' | 'contact';
  severity: 'critical' | 'warning';
  description: string;
  fixUrl: string;
  actionLabel: string;
}

export interface MarinaCompletenessReport {
  score: number;
  isComplete: boolean;
  criticalCount: number;
  warningCount: number;
  totalChecks: number;
  passedChecks: number;
  missingItems: MissingDetailItem[];
  stats: {
    pontoonsCount: number;
    slotsCount: number;
    pricedSlotsCount: number;
    imagesCount: number;
  };
}

export interface ApiMarina {
  _id: string;
  id?: string;
  name: string;
  nameAr?: string;
  logo?: string;
  address: string;
  city?: string;
  latitude: number;
  longitude: number;
  contactNumber?: string;
  email?: string;
  description?: string;
  descriptionAr?: string;
  amenities: string[];
  facilities: MarinaFacility[];
  depthM?: number;
  maxLoaFt?: number;
  images: string[];
  imagesCategorized: { url: string; category?: string }[];
  settings: MarinaSettings;
  operatingHours?: {
    workingDays: number[];
    openTime?: string;
    closeTime?: string;
    open24h: boolean;
  };
  bank?: {
    bankName?: string;
    accountHolderName?: string;
    iban?: string;
    accountNumber?: string;
    swiftCode?: string;
  };
  emergencyContacts: EmergencyContact[];
  approvalStatus?: MarinaApprovalStatus;
  approvalReason?: string;
  isPublished?: boolean;
  publishedAt?: string;
  reviewedAt?: string;
  completeness?: MarinaCompletenessReport;
  isActive: boolean;
}

export type SlotStatus = 'available' | 'reserved' | 'booked' | 'maintenance' | 'blocked';
export type SlotCategory = 'standard' | 'premium' | 'superyacht' | 'catamaran' | 'day_dock';

export interface ApiPontoon {
  _id: string;
  id?: string;
  marina?: string;
  code: string;
  name?: string;
  description?: string;
}

export interface ApiDockSlot {
  _id: string;
  pontoon: { _id: string; code: string; name?: string } | string;
  marina: string;
  code: string;
  category: SlotCategory;
  status: SlotStatus;
  maxLength?: number;
  maxWidth?: number;
  maxDepth?: number;
  maxWeightTon?: number;
  hasWater: boolean;
  hasWifi: boolean;
  powerSupply?: string;
  monthlyPrice?: number;
  notes?: string;
  images?: string[];
}

export interface DockPlan {
  id: string;
  marina: string;
  name: string;
  days: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export const marinaApi = {
  /** The signed-in provider's marina (auto-provisioned on first call). */
  mine: () =>
    get<Ok<{ marina: ApiMarina; pontoons: ApiPontoon[]; slots: ApiDockSlot[]; slotSummary: Record<string, number>; completeness?: MarinaCompletenessReport }>>(
      '/marinas/mine'
    ),

  update: (id: string, patchBody: Partial<ApiMarina>) => patch<Ok<{ marina: ApiMarina; completeness?: MarinaCompletenessReport }>>(`/marinas/${id}`, patchBody),

  getCompleteness: (id: string) => get<Ok<{ completeness: MarinaCompletenessReport }>>(`/marinas/${id}/completeness`),
  submitForApproval: (id: string) => post<Ok<{ marina: ApiMarina; completeness: MarinaCompletenessReport }>>(`/marinas/${id}/submit-for-approval`),
  publish: (id: string) => post<Ok<{ marina: ApiMarina; completeness: MarinaCompletenessReport }>>(`/marinas/${id}/publish`),
  unpublish: (id: string) => post<Ok<{ marina: ApiMarina }>>(`/marinas/${id}/unpublish`),

  uploadImages: (id: string, files: File[], category?: string) => {
    const fd = new FormData();
    files.forEach((f) => fd.append('images', f));
    if (category) fd.append('category', category);
    return post<Ok<{ images: string[]; imagesCategorized: { url: string; category?: string }[] }>>(`/marinas/${id}/images`, fd);
  },
  deleteImage: (id: string, url: string) =>
    del<Ok<{ images: string[]; imagesCategorized: { url: string; category?: string }[] }>>(`/marinas/${id}/images${qs({ url })}`),

  createPontoon: (marinaId: string, data: { code: string; name?: string; description?: string }) =>
    post<Ok<{ pontoon: ApiPontoon }>>(`/marinas/${marinaId}/pontoons`, data),
  updatePontoon: (id: string, data: { code?: string; name?: string; description?: string }) =>
    patch<Ok<{ pontoon: ApiPontoon }>>(`/pontoons/${id}`, data),
  deletePontoon: (id: string) => del<Ok<unknown>>(`/pontoons/${id}`),

  createSlot: (pontoonId: string, data: Partial<ApiDockSlot> & { code: string }) =>
    post<Ok<{ slot: ApiDockSlot }>>(`/pontoons/${pontoonId}/slots`, data),
  updateSlot: (id: string, data: Partial<ApiDockSlot>) => patch<Ok<{ slot: ApiDockSlot }>>(`/slots/${id}`, data),
  setSlotStatus: (id: string, status: SlotStatus, notes?: string) =>
    patch<Ok<{ slot: ApiDockSlot }>>(`/slots/${id}/status`, { status, notes }),
  deleteSlot: (id: string) => del<Ok<unknown>>(`/slots/${id}`),
  uploadSlotImages: (id: string, files: File[]) => {
    const fd = new FormData();
    files.forEach((f) => fd.append('images', f));
    return post<Ok<{ images: string[] }>>(`/slots/${id}/images`, fd);
  },
  deleteSlotImage: (id: string, url: string) =>
    del<Ok<{ images: string[] }>>(`/slots/${id}/images${qs({ url })}`),

  dockPlans: {
    mine: () => get<Ok<{ plans: DockPlan[] }>>('/dock-subscriptions/plans/mine'),
    create: (data: { name: string; days: number; isActive?: boolean }) =>
      post<Ok<{ plan: DockPlan }>>('/dock-subscriptions/plans', data),
    update: (id: string, data: Partial<{ name: string; days: number; isActive: boolean }>) =>
      patch<Ok<{ plan: DockPlan }>>(`/dock-subscriptions/plans/${id}`, data),
    delete: (id: string) => del<Ok<{ id: string }>>(`/dock-subscriptions/plans/${id}`),
  },
};

// ---------------------------------------------------------------------------
// Berth reservations (the boat-provider → marina booking workflow)
// ---------------------------------------------------------------------------
export type ReservationStatus =
  | 'pending_approval'
  | 'pending_payment'
  | 'declined'
  | 'active'
  | 'completed'
  | 'cancelled'
  | 'expired';

/**
 * The id of anything the API returns, whichever field it arrived under.
 *
 * Mongo documents cross the wire with `_id`. The virtual `id` is only present on
 * payloads serialised with it, which is why every one of these types declares
 * `_id` as required and `id` as optional — and why reading `id` alone silently
 * yields `undefined` for exactly the objects that matter most, the session user
 * among them.
 *
 * Comparing an empty id against a real one is always false, and the screens that
 * did it failed *quietly*: "the participant who is not me" matched the first
 * participant, so conversations were labelled with the reader's own name, and
 * every message the reader sent rendered as though it had been received. Use this
 * anywhere two ids are compared.
 */
export const idOf = (x: { _id?: string; id?: string } | string | null | undefined): string =>
  typeof x === 'string' ? x : String(x?._id ?? x?.id ?? '');

export interface ApiSubscriber {
  _id: string;
  id?: string;
  name: string;
  email: string;
  phone?: string;
  avatar?: string;
  role?: string;
  /**
   * Populated on chat and support payloads.
   *
   * A desk answering a marina wants the trade name, not the name of whoever
   * happens to hold the login — "Jeddah Marina" rather than "Ahmed".
   */
  business?: { businessName?: string; city?: string; logo?: string };
}

export interface ApiReservation {
  _id: string;
  id: string;
  reservationNo: string;
  subscriptionId: string;
  subscriber: ApiSubscriber | string;
  marina: string;
  marinaName: string;
  pontoon: string;
  slot: number;
  slotRef?: string;
  boatType: string;
  boatName: string;
  plate: string;
  unit: 'ft' | 'm';
  lengthFt: number;
  widthFt: number;
  draftFt: number;
  months: number;
  priceSar: number;
  vatSar: number;
  totalSar: number;
  startDate: string;
  endDate: string;
  status: ReservationStatus;
  payMethod: string;
  payments: { paymentId: string; date: string; amountSar: number; method: string; kind: string }[];
  documents: { key: string; name: string; url: string; uploadedAt: string }[];
  notes?: string;
  requestedAt: string;
  approvedAt?: string;
  declinedAt?: string;
  declineReason?: string;
  paidAt?: string;
  /** The boater's card held with the request — approving captures it. */
  cardHold?: { status: 'held' | 'captured' | 'released' | 'failed'; amountSar: number; heldAt?: string; note?: string };
  cancelledAt?: string;
  cancelReason?: string;
  completedAt?: string;
  createdAt: string;
}

export const reservationsApi = {
  list: (params?: { status?: string; search?: string; page?: number; limit?: number }) =>
    get<Ok<Paginated<ApiReservation> & { statusCounts: Record<string, number> }>>(
      '/dock-subscriptions/provider',
      params
    ),

  one: (id: string) => get<Ok<{ subscription: ApiReservation; movements: ApiMovement[] }>>(`/dock-subscriptions/${id}`),

  /** A booking the marina keys in at the desk for an existing BoatPro account. */
  walkIn: (data: {
    subscriberEmail: string;
    pontoon: string;
    slot: number;
    boatName: string;
    plate: string;
    boatType?: string;
    lengthFt?: number;
    widthFt?: number;
    draftFt?: number;
    months: number;
    priceSar?: number;
    payMethod?: string;
    startDate?: string;
    notes?: string;
  }) => post<Ok<{ subscription: ApiReservation; nextStep: 'payment' }>>('/dock-subscriptions/walk-in', data),

  /** `cardHold` says what approving did with the boater's held card, when there was one. */
  approve: (id: string, move?: { pontoon: string; slot: number }) =>
    patch<Ok<{ subscription: ApiReservation; cardHold?: 'captured' | 'failed' | null }>>(`/dock-subscriptions/${id}/approve`, move ?? {}),

  decline: (id: string, reason?: string) =>
    patch<Ok<{ subscription: ApiReservation }>>(`/dock-subscriptions/${id}/decline`, { reason }),

  /** Settle at the desk (cash / bank transfer) — the same endpoint the app pays through. */
  markPaid: (id: string, method: string) =>
    post<Ok<{ subscription: ApiReservation }>>(`/dock-subscriptions/${id}/pay`, { method }),

  cancel: (id: string, reason?: string) =>
    patch<Ok<{ subscription: ApiReservation }>>(`/dock-subscriptions/${id}/cancel`, { reason }),

  /**
   * Refused with `details.code === 'BOAT_ALONGSIDE'` while the boat is still
   * checked in; `checkOut: true` checks it out (billing utilities) and completes.
   */
  complete: (id: string, opts?: { checkOut?: boolean }) =>
    patch<Ok<{ subscription: ApiReservation }>>(`/dock-subscriptions/${id}/complete`, opts?.checkOut ? { checkOut: true } : {}),

  renew: (id: string, months: number) => patch<Ok<{ subscription: ApiReservation }>>(`/dock-subscriptions/${id}/renew`, { months }),

  transfer: (id: string, pontoon: string, slot: number) =>
    patch<Ok<{ subscription: ApiReservation }>>(`/dock-subscriptions/${id}/transfer`, { pontoon, slot }),

  expireDue: () => post<Ok<{ expired: number }>>('/dock-subscriptions/expire-due'),

  availability: (marinaId: string) =>
    get<
      Ok<{
        pontoons: { id: string; pontoonId: string; name?: string; slots: AvailabilitySlot[] }[];
        summary: Record<string, number>;
        vatRate: number;
        currency: string;
        autoApprove: boolean;
      }>
    >('/dock-subscriptions/availability', { marinaId }),
};

export interface AvailabilitySlot {
  id: string;
  no: number;
  code: string;
  status: SlotStatus;
  booked: boolean;
  category: SlotCategory;
  maxLength?: number;
  maxWidth?: number;
  maxDepth?: number;
  maxWeightTon?: number;
  hasWater: boolean;
  hasWifi: boolean;
  powerSupply?: string;
  monthlyPrice?: number;
  images?: string[];
}

// ---------------------------------------------------------------------------
// Marina portal aggregates
// ---------------------------------------------------------------------------
export interface ApiMovement {
  _id: string;
  id: string;
  marina: string;
  subscription?: { _id: string; id?: string; reservationNo?: string; boatType?: string; endDate?: string; status?: string } | string;
  slotRef?: string;
  pontoon?: string;
  slot?: number;
  boatName: string;
  plate?: string;
  boater?: ApiSubscriber | string;
  direction: 'arrival' | 'departure';
  status: 'expected' | 'en_route' | 'checked_in' | 'checked_out' | 'no_show' | 'cancelled';
  /**
   * The single-stay booking behind this movement, when there is one.
   *
   * Populated alongside `subscription`: a movement comes either from a monthly
   * `DockSubscription` or from a paid `BerthBooking`, never both. Only paid,
   * confirmed stays produce these — an unpaid reservation never reaches the
   * arrivals board.
   */
  berthBooking?: {
    _id: string;
    bookingRef: string;
    berthName: string;
    marinaName: string;
    checkIn: string;
    checkOut: string;
    priceBreakdown?: { berthFee: number; cleaningFee: number; platformFee: number; vatAmount: number; total: number };
    status: string;
  } | string;
  scheduledAt: string;
  distanceNm?: number;
  actualAt?: string;
  documentsVerified: boolean;
  securityCleared: boolean;
  charges?: { dock: number; utility: number; services: number };
  notes?: string;
}

export interface ApiWorkOrder {
  _id: string;
  id: string;
  code: string;
  title: string;
  asset: string;
  kind: 'dock' | 'berth' | 'facility' | 'equipment' | 'vessel';
  slotRef?: string;
  blocksBerth: boolean;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'scheduled' | 'in_progress' | 'done' | 'cancelled';
  assignee?: { _id: string; role: string; user?: { name?: string; avatar?: string; phone?: string } } | string;
  dueDate?: string;
  cost: number;
  description?: string;
  photos: string[];
  completedAt?: string;
  createdAt: string;
}

export interface ApiUtilityReading {
  _id: string;
  id: string;
  kind: 'electricity' | 'water';
  pontoon?: string;
  slot?: number;
  subscription?: { _id: string; id?: string; boatName?: string; plate?: string; pontoon?: string; slot?: number } | string;
  readingDate: string;
  previousReading: number;
  currentReading: number;
  consumption: number;
  unitRate: number;
  amount: number;
  billed: boolean;
  notes?: string;
}

export interface ApiIncident {
  _id: string;
  id: string;
  code: string;
  title: string;
  kind: 'sos' | 'environmental' | 'security' | 'safety' | 'damage' | 'other';
  severity: 'low' | 'medium' | 'high';
  status: 'open' | 'investigating' | 'resolved';
  occurredAt: string;
  description?: string;
  actionsTaken?: string;
  boatName?: string;
  reportedBy?: { name?: string; avatar?: string } | string;
  resolvedAt?: string;
  photos: string[];
}

export interface ApiMarinaDocument {
  _id: string;
  id: string;
  name: string;
  type: 'license' | 'insurance' | 'safety' | 'environmental' | 'inspection' | 'tariff' | 'other';
  fileUrl?: string;
  fileSize?: number;
  issuedAt?: string;
  expiresAt?: string;
  reference?: string;
  notes?: string;
  status: 'valid' | 'expiring_soon' | 'expired' | 'no_expiry';
  createdAt: string;
}

/** Day-by-day series behind the dashboard's sparklines and weekly occupancy bar. */
export interface ApiTrends {
  days: string[];
  arrivals: number[];
  departures: number[];
  requests: number[];
  workOrders: number[];
  occupiedBerths: number[];
  occupancyRate: number[];
  /** Gross revenue per month over the last 12. */
  revenue: number[];
}

export interface ApiOverview {
  marina: ApiMarina;
  berths: Record<string, number>;
  occupancyRate: number;
  trends: ApiTrends;
  activeSubscriptions: number;
  reservationStatusCounts: Record<string, number>;
  pendingRequests: ApiReservation[];
  arrivals: ApiMovement[];
  departures: ApiMovement[];
  revenue: {
    month: { gross: number; net: number; count: number; byType: Record<string, number> };
    series: { month: string; docking: number; services: number; fuel: number; other: number }[];
    currency: string;
  };
  workOrders: ApiWorkOrder[];
  openIncidents: number;
  serviceRequests: number;
  expiringDocuments: number;
  staffCount: number;
  rating: { average: number; count: number };
  alerts: ApiNotification[];
}

export interface ApiBerthMapEntry {
  id: string;
  code: string;
  number: number;
  pontoon: string;
  pontoonId: string;
  pontoonName?: string;
  category: SlotCategory;
  status: SlotStatus;
  maxLength?: number;
  maxWidth?: number;
  maxDepth?: number;
  maxWeightTon?: number;
  hasWater: boolean;
  hasWifi: boolean;
  powerSupply?: string;
  monthlyPrice?: number;
  notes?: string;
  images?: string[];
  reservation: {
    id: string;
    reservationNo: string;
    status: ReservationStatus;
    boatName: string;
    boatType: string;
    plate: string;
    lengthFt: number;
    widthFt: number;
    draftFt: number;
    startDate: string;
    endDate: string;
    totalSar: number;
    subscriber: ApiSubscriber | string;
  } | null;
  workOrder: { _id: string; code: string; title: string; priority: string; status: string; dueDate?: string } | null;
}

export interface ApiWeather {
  temperature: number | null;
  windSpeed: number | null;
  windGust: number | null;
  windDirection: number | null;
  humidity: number | null;
  visibilityKm: number | null;
  weatherCode: number | null;
  isDay: boolean;
  sunrise: string | null;
  sunset: string | null;
  uvIndex: number | null;
  waveHeight: number | null;
  seaTemperature: number | null;
  tides: { time: string; height: number }[];
  warning: string | null;
  updatedAt: string;
}

export interface ApiMarinaCustomer {
  id: string;
  name: string;
  email: string;
  phone?: string;
  avatar?: string;
  role?: string;
  memberSince: string;
  lastSeen: string;
  reservations: number;
  activeReservations: number;
  berthSpend: number;
  serviceSpend: number;
  totalSpend: number;
  boats: { name: string; plate: string; type: string; lengthFt: number }[];
}

export interface ApiMarinaBoat {
  name: string;
  plate: string;
  boatType: string;
  lengthFt: number;
  widthFt: number;
  draftFt: number;
  stays: number;
  spend: number;
  lastStay: string;
  currentBerth: { pontoon: string; slot: number; endDate: string } | null;
  owner: { id: string; name: string; email: string; phone?: string; avatar?: string } | null;
}

export interface ApiCalendarEvent {
  date: string;
  kind: string;
  label: string;
  tone: 'info' | 'success' | 'warn' | 'danger' | string;
  refId?: string;
}

export interface ApiReports {
  range: { from: string; to: string };
  currency: string;
  revenueByStream: { stream: string; gross: number; commission: number; net: number; count: number }[];
  revenueByMonth: { month: string; gross: number; net: number; count: number }[];
  reservations: Record<string, { count: number; revenue: number; months: number }>;
  utilities: Record<string, { consumption: number; amount: number }>;
  topCustomers: { name: string; email: string; avatar?: string; spend: number; stays: number }[];
  berthCount: number;
  occupancyByDay: { date: string; occupied: number }[];
}

export interface ApiServiceBooking {
  _id: string;
  id?: string;
  customer: ApiSubscriber | string;
  service: { _id: string; id?: string; name: string; category: string; price: number; pricingUnit: string } | string;
  startAt?: string;
  endAt?: string;
  quantity: number;
  amount: number;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
  notes?: string;
  createdAt: string;
}

export interface ApiMarinaService {
  _id: string;
  id?: string;
  name: string;
  category: string;
  description?: string;
  price: number;
  pricingUnit: 'per_use' | 'hourly' | 'daily' | 'flat';
  isAvailable: boolean;
  ratingAvg: number;
  ratingCount: number;
}

export interface ApiInvoice {
  _id: string;
  id?: string;
  invoiceNumber: string;
  bookingType: string;
  customer: ApiSubscriber | string;
  items: { description: string; quantity: number; unitPrice: number; total: number }[];
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  currency: string;
  pdfUrl?: string;
  payment?: { status: string; method: string; paidAt?: string; amount: number } | string;
  createdAt: string;
  /** `invoice` when absent. Credit notes (CN-…) are the tax documents for refunds. */
  kind?: 'invoice' | 'credit_note';
  /** Refund state of the document itself (not the payment). Absent on older invoices. */
  status?: 'issued' | 'partially_refunded' | 'refunded';
  /** The row status the billing endpoint derives from the invoice and its payment. */
  displayStatus?: 'credit_note' | 'refunded' | 'partially_refunded' | 'paid' | 'pending';
  refundedTotal?: number;
  originalInvoiceNumber?: string;
  reason?: string;
  buyerName?: string;
  issuedAt?: string;
  zatcaReady?: boolean;
}

export interface ApiStaffMember {
  id: string;
  role: string;
  permissions: string[];
  isActive: boolean;
  user: { _id: string; id?: string; name: string; email: string; phone?: string; avatar?: string; role?: string } | string;
  today: { clockIn?: string; clockOut?: string; shift?: string; leaveType?: string } | null;
  openWorkOrders: number;
}

export interface ApiReview {
  _id: string;
  id: string;
  author: { _id: string; name: string; email?: string; avatar?: string } | string;
  targetType?: 'boat' | 'marina' | 'fuel_station' | 'maintenance_shop' | 'captain' | 'trip' | 'staff';
  boat?: { _id: string; name: string } | string;
  marina?: { _id: string; name: string } | string;
  fuelStation?: { _id: string; name: string } | string;
  maintenanceShop?: { _id: string; nameEn: string } | string;
  captain?: { _id: string; name: string } | string;
  trip?: { _id: string; title: string } | string;
  /** The individual reviewed, when `targetType` is `staff`. */
  staff?: { _id: string; name: string; avatar?: string } | string;
  /** Which staff collection `staff` points at. */
  staffModel?: 'MarinaStaff' | 'FuelWorker' | 'MaintenanceTechnician' | 'BoatCrew';
  /** The business the review reflects on — set for every target type. */
  provider?: string;
  rating: number;
  comment?: string;
  reply?: { text: string; date: string };
  reported?: boolean;
  reportReason?: string;
  /** True when a completed transaction was verified at write time. */
  verifiedPurchase?: boolean;
  /**
   * Moderation state. A hidden review stays in the collection — it is the
   * evidence a dispute is argued from — but drops out of every public listing
   * and every star average.
   */
  moderation?: {
    status: 'visible' | 'under_review' | 'hidden';
    reportCount?: number;
    hiddenAt?: string;
    hiddenBy?: string;
    reason?: string;
  };
  createdAt: string;
}

export interface ApiAdminPayment {
  _id: string;
  bookingType?: 'dock' | 'trip' | 'fuel' | 'service' | 'maintenance';
  customer: { _id: string; name: string; email?: string; avatar?: string } | string;
  provider?: { _id: string; name: string; business?: { businessName?: string } } | string | null;
  amount: number;
  commissionAmount?: number;
  providerNet?: number;
  currency: string;
  method: string;
  status: 'pending' | 'paid' | 'failed' | 'refunded' | 'partially_refunded';
  transactionId: string;
  paidAt?: string;
  refundAmount?: number;
  refundedAt?: string;
  notes?: string;
  /** The booking behind a trip payment: its code, the trip's title, the boat. */
  booking?: { code?: string; title?: string; boat?: string };
  createdAt: string;
}

/** One vertical's earned revenue — the definition every admin revenue page shares. */
export interface ApiRevenueTotals { gross: number; commission: number; providerNet: number; count: number }

export interface ApiCommissionRevenueRow {
  _id: string;
  name: string;
  businessName?: string;
  role?: string;
  billingModel?: 'subscription' | 'commission';
  commissionRate?: number;
  commissionType?: 'percentage' | 'fixed';
  commissionFixedAmount?: number;
  /** Billing models the charges were actually taken under. */
  chargedUnder: string[];
  gross: number;
  commission: number;
  count: number;
}

export interface ApiPackageRevenue {
  mrr: number;
  arr: number;
  subscribersCount: number;
  catalogue: { id: string; name: string; price: number; months: number; duration?: string; features: string[]; subscribers: number }[];
  providers: {
    _id: string;
    name: string;
    business?: { businessName?: string };
    providerKind?: string;
    createdAt?: string;
    plan: { id: string; name: string; price: number; months: number } | null;
    state: 'paid' | 'awaiting_payment' | 'expired' | 'no_package';
    expiresAt?: string | null;
  }[];
}

export interface ApiNotification {
  _id: string;
  id?: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  isRead: boolean;
  createdAt: string;
}

export const portalApi = {
  overview: (options?: ApiRequestOptions) => get<Ok<ApiOverview>>('/marina-portal/overview', undefined, options),
  berthMap: () =>
    get<
      Ok<{
        marina: { id: string; name: string; latitude: number; longitude: number; address: string; vhfChannel?: string };
        pontoons: ApiPontoon[];
        berths: ApiBerthMapEntry[];
      }>
    >('/marina-portal/berth-map'),
  customers: (params?: { search?: string; page?: number; limit?: number }) =>
    get<Ok<Paginated<ApiMarinaCustomer> & { currency: string }>>('/marina-portal/customers', params),
  boats: (params?: { search?: string; page?: number; limit?: number }) =>
    get<Ok<Paginated<ApiMarinaBoat>>>('/marina-portal/boats', params),
  calendar: (month?: string) => get<Ok<{ month: string; events: ApiCalendarEvent[] }>>('/marina-portal/calendar', { month }),
  reports: (params?: { from?: string; to?: string }) => get<Ok<ApiReports>>('/marina-portal/reports', params),
  weather: (options?: ApiRequestOptions) => get<Ok<{ weather: ApiWeather; cached?: boolean }>>('/marina-portal/weather', undefined, options),
  search: (q: string) =>
    get<Ok<{ results: { kind: string; id: string; title: string; subtitle?: string; href: string; avatar?: string }[] }>>(
      '/marina-portal/search',
      { q }
    ),
  serviceRequests: (params?: { status?: string; page?: number; limit?: number }) =>
    get<
      Ok<
        Paginated<ApiServiceBooking> & {
          statusCounts: Record<string, number>;
          revenue: number;
          services: ApiMarinaService[];
          currency: string;
        }
      >
    >('/marina-portal/service-requests', params),
  billing: (params?: { bookingType?: string; page?: number; limit?: number }) =>
    get<
      Ok<
        Paginated<ApiInvoice> & {
          totals: { gross: number; commission: number; net: number; count: number };
          outstanding: { items: ApiReservation[]; amount: number };
          currency: string;
        }
      >
    >('/marina-portal/billing', params),
  reviews: (params?: { unanswered?: boolean; page?: number; limit?: number }) =>
    get<Ok<Paginated<ApiReview> & { distribution: Record<string, number>; average: number; ratingCount: number }>>(
      '/marina-portal/reviews',
      params
    ),
  staff: () => get<Ok<{ items: ApiStaffMember[]; total: number }>>('/marina-portal/staff'),

  settings: () =>
    get<
      Ok<{
        marina: ApiMarina;
        facilityKeys: FacilityKey[];
        settings: MarinaSettings;
        facilities: MarinaFacility[];
        emergencyContacts: EmergencyContact[];
      }>
    >('/marina-portal/settings'),
  updateSettings: (data: Partial<MarinaSettings>) => patch<Ok<{ settings: MarinaSettings }>>('/marina-portal/settings', data),
  setFacilities: (facilities: MarinaFacility[]) =>
    put<Ok<{ facilities: MarinaFacility[] }>>('/marina-portal/facilities', { facilities }),

  bulkBerths: (data: {
    pontoonCode: string;
    pontoonName?: string;
    count: number;
    startAt?: number;
    category?: SlotCategory;
    maxLength?: number;
    maxWidth?: number;
    maxDepth?: number;
    maxWeightTon?: number;
    powerSupply?: string;
    hasWater?: boolean;
    hasWifi?: boolean;
    monthlyPrice?: number;
  }) => post<Ok<{ pontoon: ApiPontoon; created: number; skipped: number }>>('/marina-portal/berths/bulk', data),
};

// ---------------------------------------------------------------------------
// Arrivals & departures
// ---------------------------------------------------------------------------
export const movementsApi = {
  list: (params?: { date?: string; direction?: string; status?: string; from?: string; to?: string; limit?: number }) =>
    get<Ok<Paginated<ApiMovement>>>('/berth-movements', params),
  create: (data: {
    subscriptionId?: string;
    direction: 'arrival' | 'departure';
    scheduledAt: string;
    boatName?: string;
    plate?: string;
    distanceNm?: number;
    notes?: string;
  }) => post<Ok<{ movement: ApiMovement }>>('/berth-movements', data),
  update: (id: string, data: Partial<Pick<ApiMovement, 'scheduledAt' | 'status' | 'distanceNm' | 'documentsVerified' | 'securityCleared' | 'notes' | 'charges'>>) =>
    patch<Ok<{ movement: ApiMovement }>>(`/berth-movements/${id}`, data),
  checkIn: (id: string, force?: boolean) => patch<Ok<{ movement: ApiMovement }>>(`/berth-movements/${id}/check-in`, { force }),
  checkOut: (id: string) =>
    patch<Ok<{ movement: ApiMovement; utilities: ApiUtilityReading[]; services: ApiServiceBooking[] }>>(
      `/berth-movements/${id}/check-out`
    ),
  enRoute: (id: string, distanceNm?: number, eta?: string) =>
    patch<Ok<{ movement: ApiMovement }>>(`/berth-movements/${id}/en-route`, { distanceNm, eta }),
  noShow: (id: string) => patch<Ok<{ movement: ApiMovement }>>(`/berth-movements/${id}/no-show`),
  remove: (id: string) => del<Ok<unknown>>(`/berth-movements/${id}`),
};

// ---------------------------------------------------------------------------
// Maintenance, utilities, incidents, documents
// ---------------------------------------------------------------------------
export const workOrdersApi = {
  list: (params?: { status?: string; priority?: string; kind?: string; search?: string; limit?: number }) =>
    get<Ok<Paginated<ApiWorkOrder> & { statusCounts: Record<string, number>; openCost: number }>>('/work-orders', params),
  create: (data: Partial<ApiWorkOrder> & { title: string; asset: string; assignee?: string; slotRef?: string }) =>
    post<Ok<{ workOrder: ApiWorkOrder }>>('/work-orders', data),
  update: (id: string, data: Partial<ApiWorkOrder> & { assignee?: string | null }) =>
    patch<Ok<{ workOrder: ApiWorkOrder }>>(`/work-orders/${id}`, data),
  remove: (id: string) => del<Ok<unknown>>(`/work-orders/${id}`),
};

export const utilitiesApi = {
  list: (params?: { kind?: string; billed?: boolean; from?: string; to?: string; limit?: number }) =>
    get<
      Ok<
        Paginated<ApiUtilityReading> & {
          monthly: { month: string; electricity: number; water: number; amount: number }[];
          unbilled: Record<string, { amount: number; count: number }>;
          rates: { electricity: number | null; water: number | null; currency: string };
        }
      >
    >('/utilities', params),
  create: (data: {
    slotRef?: string;
    subscriptionId?: string;
    kind: 'electricity' | 'water';
    currentReading: number;
    previousReading?: number;
    readingDate?: string;
    unitRate?: number;
    notes?: string;
  }) => post<Ok<{ reading: ApiUtilityReading }>>('/utilities', data),
  update: (id: string, data: Partial<ApiUtilityReading>) => patch<Ok<{ reading: ApiUtilityReading }>>(`/utilities/${id}`, data),
  bill: (data: { subscriptionId?: string; readingIds?: string[] }) =>
    post<Ok<{ invoice: ApiInvoice; billed: number }>>('/utilities/bill', data),
  remove: (id: string) => del<Ok<unknown>>(`/utilities/${id}`),
};

export const incidentsApi = {
  list: (params?: { status?: string; kind?: string; severity?: string; limit?: number }) =>
    get<
      Ok<
        Paginated<ApiIncident> & {
          statusCounts: Record<string, number>;
          emergencyContacts: EmergencyContact[];
          activeSos: { _id: string; type: string; latitude: number; longitude: number; message?: string; status: string; createdAt: string; user?: ApiSubscriber }[];
        }
      >
    >('/incidents', params),
  create: (data: Partial<ApiIncident> & { title: string }) => post<Ok<{ incident: ApiIncident }>>('/incidents', data),
  update: (id: string, data: Partial<ApiIncident>) => patch<Ok<{ incident: ApiIncident }>>(`/incidents/${id}`, data),
  remove: (id: string) => del<Ok<unknown>>(`/incidents/${id}`),
  setContacts: (contacts: EmergencyContact[]) =>
    put<Ok<{ emergencyContacts: EmergencyContact[] }>>('/incidents/emergency-contacts', { contacts }),
};

export const marinaDocsApi = {
  list: (params?: { type?: string; limit?: number }) =>
    get<Ok<Paginated<ApiMarinaDocument> & { statusCounts: Record<string, number> }>>('/marina-documents', params),
  create: (data: {
    name: string;
    type?: string;
    issuedAt?: string;
    expiresAt?: string;
    reference?: string;
    notes?: string;
    file?: File | null;
  }) => {
    const fd = new FormData();
    fd.append('name', data.name);
    if (data.type) fd.append('type', data.type);
    if (data.issuedAt) fd.append('issuedAt', data.issuedAt);
    if (data.expiresAt) fd.append('expiresAt', data.expiresAt);
    if (data.reference) fd.append('reference', data.reference);
    if (data.notes) fd.append('notes', data.notes);
    if (data.file) fd.append('file', data.file);
    return post<Ok<{ document: ApiMarinaDocument }>>('/marina-documents', fd);
  },
  update: (id: string, data: Partial<ApiMarinaDocument> & { file?: File | null }) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(data)) {
      if (k === 'file' || v === undefined || v === null) continue;
      fd.append(k, String(v));
    }
    if (data.file) fd.append('file', data.file);
    return patch<Ok<{ document: ApiMarinaDocument }>>(`/marina-documents/${id}`, fd);
  },
  remove: (id: string) => del<Ok<unknown>>(`/marina-documents/${id}`),
};

// ---------------------------------------------------------------------------
// Marina services catalogue (what boaters can order)
// ---------------------------------------------------------------------------
export const servicesApi = {
  // The backend only creates under the marina it belongs to (`POST /manage/:marinaId`,
  // which also checks ownership); a bare `POST /marina-services` has no route and 404'd.
  create: ({ marinaId, ...data }: { marinaId: string; name: string; category: string; price: number; pricingUnit?: string; description?: string }) =>
    post<Ok<{ service: ApiMarinaService }>>(`/marina-services/manage/${marinaId}`, data),
  update: (id: string, data: Partial<ApiMarinaService>) => patch<Ok<{ service: ApiMarinaService }>>(`/marina-services/${id}`, data),
  remove: (id: string) => del<Ok<unknown>>(`/marina-services/${id}`),
  setBookingStatus: (id: string, status: 'pending' | 'confirmed' | 'completed' | 'cancelled') =>
    patch<Ok<{ booking: ApiServiceBooking }>>(`/marina-services/bookings/${id}/status`, { status }),
};

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------
export const staffApi = {
  add: (data: { userId: string; marinaId: string; role: string; permissions?: string[] }) =>
    post<Ok<{ staff: unknown }>>('/staff', data),
  update: (id: string, data: { role?: string; permissions?: string[]; isActive?: boolean }) =>
    patch<Ok<{ staff: unknown }>>(`/staff/${id}`, data),
  remove: (id: string) => del<Ok<unknown>>(`/staff/${id}`),
};

// ---------------------------------------------------------------------------
// Chat, reviews, notifications, invoices
// ---------------------------------------------------------------------------
export type SupportDesk = 'admin' | 'marina' | 'fuel' | 'maintenance' | 'boat';
export type SupportStatus = 'open' | 'pending' | 'resolved';
export type SupportPriority = 'low' | 'normal' | 'high' | 'urgent';

/**
 * The support half of a chat thread.
 *
 * Support is not a separate ticket table — it is a `Chat` with this block
 * attached, which is what lets one reply appear both in the desk's console and
 * in the customer's inbox. `status` says who the ball is with: `open` is waiting
 * on the desk, `pending` is waiting on the person who asked.
 */
export interface ApiSupport {
  desk: SupportDesk;
  deskOwner?: ApiSubscriber | string;
  status: SupportStatus;
  priority: SupportPriority;
  category?: string;
  reference: string;
  openedBy: ApiSubscriber | string;
  assignedTo?: ApiSubscriber | string;
  handlingState?: 'ai_active' | 'queued' | 'assigned' | 'in_progress' | 'waiting_customer' |
    'waiting_provider' | 'waiting_internal' | 'resolved' | 'closed';
  sourceChat?: string;
  firstResponseAt?: string;
  resolvedAt?: string;
}

/** What a booking thread is about, for the header above the conversation. */
export interface ApiChatContext {
  kind: string;
  booking: string;
  code?: string;
  boat?: string;
  provider?: string;
  startAt?: string;
}

export interface ApiChat {
  _id: string;
  id?: string;
  type?: 'direct' | 'system' | 'support' | 'booking';
  subject?: string;
  participants: ApiSubscriber[];
  lastMessage?: { text?: string; sender?: string; at?: string };
  unreadCount?: number;
  support?: ApiSupport;
  context?: ApiChatContext;
  roles?: Record<string, 'customer' | 'provider' | 'crew' | 'agent'>;
  createdAt?: string;
  updatedAt: string;
}
/** Where a shared report came from — see `ApiMessage.report`. */
export interface ApiMessageReport {
  key: string;
  label: string;
  format: 'csv' | 'excel' | 'pdf';
  from?: string;
  to?: string;
  filters?: Record<string, string>;
  rowCount?: number;
  /** Headline figures, so a bubble can state the totals without a download. */
  summary?: { label: string; value: string }[];
}

export interface ApiMessage {
  _id: string;
  id?: string;
  chat: string;
  sender: ApiSubscriber | string;
  /** `report` is a platform-generated report file, not an upload. */
  type: 'text' | 'image' | 'file' | 'voice' | 'report';
  text?: string;
  mediaUrl?: string;
  fileName?: string;
  fileSize?: number;
  duration?: number;
  /**
   * The message this one answers, snapshotted when the reply was written.
   *
   * A snapshot rather than a reference: the quote has to survive its parent being
   * edited or deleted, and one that silently re-reads the parent changes meaning
   * after the fact.
   */
  replyTo?: {
    message: string;
    text?: string;
    senderName?: string;
    type: ApiMessage['type'];
  };
  /** Labels any participant put on the message, for finding it again. */
  tags?: string[];
  report?: ApiMessageReport;
  readBy?: string[];
  /**
   * Whether the *caller* sent this, decided by the server.
   *
   * Authoritative, and the reason it exists: every client re-derived this by
   * comparing the sender to its own session, a comparison with three ways to go
   * wrong that all fail identically — nothing matches, every message renders as the
   * other person's, and two clients viewing one thread disagree about who spoke.
   * Absent on socket-delivered messages, which are broadcast to a room and so
   * cannot carry a per-recipient flag.
   */
  mine?: boolean;
  createdAt: string;
}

export const chatApi = {
  /** `unreadTotal` counts every thread, not just this page — use it for the badge. */
  myChats: (options?: ApiRequestOptions) => get<Ok<Paginated<ApiChat> & { unreadTotal?: number }>>('/chats', { limit: 50 }, options),
  myMessageChats: () => get<Ok<Paginated<ApiChat> & { unreadTotal?: number }>>('/chats', { excludeType: 'support', limit: 100 }),
  myDirectChats: () => get<Ok<Paginated<ApiChat> & { unreadTotal?: number }>>('/chats', { type: 'direct', limit: 100 }),
  /** Include more support threads so an older help request is not hidden behind direct chats. */
  mySupportChats: () => get<Ok<Paginated<ApiChat> & { unreadTotal?: number }>>('/chats', { type: 'support', openedBy: 'me', limit: 100 }),
  /**
   * Thread history.
   *
   * `tag` and `attachmentsOnly` are the server's own narrowing — the reason
   * tagging exists is that scrolling is otherwise the only way back to the one
   * message in a three-week thread that mattered.
   */
  messages: (chatId: string, opts?: { tag?: string; attachmentsOnly?: boolean }) =>
    get<Ok<Paginated<ApiMessage>>>(`/chats/${chatId}/messages`, {
      limit: 100,
      ...(opts?.tag ? { tag: opts.tag } : {}),
      ...(opts?.attachmentsOnly ? { attachmentsOnly: true } : {}),
    }),
  send: (chatId: string, text: string, opts?: { replyTo?: string; tags?: string[] }) =>
    post<Ok<{ message: ApiMessage }>>(`/chats/${chatId}/messages`, {
      text,
      ...(opts?.replyTo ? { replyTo: opts.replyTo } : {}),
      ...(opts?.tags?.length ? { tags: opts.tags } : {}),
    }),
  /**
   * An image or document, as multipart.
   *
   * The reply id and tags travel as form fields rather than JSON — the server
   * accepts a comma-separated `tags` string for exactly this reason, since a
   * multipart body has no way to carry an array.
   */
  sendMedia: (
    chatId: string,
    file: File,
    opts?: { type?: 'image' | 'file'; text?: string; replyTo?: string; tags?: string[] }
  ) => {
    const form = new FormData();
    form.append('file', file);
    form.append('type', opts?.type ?? (file.type.startsWith('image/') ? 'image' : 'file'));
    if (opts?.text) form.append('text', opts.text);
    if (opts?.replyTo) form.append('replyTo', opts.replyTo);
    if (opts?.tags?.length) form.append('tags', opts.tags.join(','));
    return post<Ok<{ message: ApiMessage }>>(`/chats/${chatId}/media`, form);
  },
  /** Retags one message. Any participant may tag any message in their thread. */
  setMessageTags: (chatId: string, messageId: string, body: { tags?: string[]; add?: string[]; remove?: string[] }) =>
    patch<Ok<{ messageId: string; tags: string[] }>>(`/chats/${chatId}/messages/${messageId}/tags`, body),
  /** Every tag used in the thread, with counts — what a filter row is built from. */
  tags: (chatId: string) => get<Ok<{ tags: { tag: string; count: number }[] }>>(`/chats/${chatId}/tags`),
  /**
   * Shares one of this account's own reports into the thread as a file.
   *
   * Generated server-side from a real report run under this session, so it can
   * never contain rows the sender could not already see — and so the attachment is
   * the same bytes as the download.
   */
  shareReport: (
    chatId: string,
    body: {
      key: string;
      format?: 'csv' | 'excel' | 'pdf';
      from?: string;
      to?: string;
      filters?: Record<string, string>;
      note?: string;
      replyTo?: string;
      tags?: string[];
    }
  ) => post<Ok<{ message: ApiMessage }>>(`/chats/${chatId}/report`, body),
  /**
   * What is worth sharing into *this* conversation.
   *
   * Narrowed to the vertical of whoever is on the other end — a thread with a boat
   * operator has no use for fuel margin or berth revenue. `counterpart` comes back
   * so the picker can name whose figures these will be.
   */
  chatShareableReports: (chatId: string) =>
    get<
      Ok<{
        reports: { key: string; label: string; group: string; description: string; dateRanged: boolean }[];
        formats: ('csv' | 'excel' | 'pdf')[];
        groups: string[];
        counterpart: { id: string; name: string; role: string; vertical: string } | null;
      }>
    >(`/chats/${chatId}/shareable-reports`),
  /** The account-wide list, for a picker with no conversation in view. */
  shareableReports: () =>
    get<
      Ok<{
        reports: { key: string; label: string; group: string; description: string; dateRanged: boolean }[];
        formats: ('csv' | 'excel' | 'pdf')[];
        groups: string[];
      }>
    >('/chats/shareable-reports'),
  markRead: (chatId: string) => patch<Ok<{ modifiedCount: number }>>(`/chats/${chatId}/read`),
  create: (participantId: string) => post<Ok<{ chat: ApiChat }>>('/chats', { participantId }),
  status: (chatId: string) => get<Ok<{ chatId: string; otherUserId?: string; online: boolean }>>(`/chats/${chatId}/status`),
  chat: (chatId: string) => get<Ok<{ chat: ApiChat }>>(`/chats/${chatId}`),
  participants: (chatId: string) =>
    get<Ok<{ participants: { id: string; name: string; avatar?: string; accountRole: string; chatRole: string | null; online: boolean }[] }>>(
      `/chats/${chatId}/participants`
    ),
};

/**
 * Free-text translation (chat messages). The server reads the source language
 * off the text and caches the result, so asking twice costs one model call.
 * `configured: false` means no translation provider is set up on the server.
 */
export const translateApi = {
  text: (text: string, to: 'en' | 'ar') =>
    request<Ok<{ configured: boolean; translation: string; from?: 'en' | 'ar' | null; to?: 'en' | 'ar' }>>('/translate', {
      method: 'POST',
      body: JSON.stringify({ text, to }),
      silent: true,
    }),
};

export const aiSupportApi = {
  status: () =>
    get<Ok<{ enabled: boolean; model: string | null; activeSessions: number }>>('/ai-support/status'),
  startConversation: (subject?: string, category?: string) =>
    post<Ok<{ chat: ApiChat; aiSession: { mode: string; status: string; aiEnabled: boolean } }>>('/ai-support/conversations', { subject, category }),
  sendMessage: (chatId: string, text: string) =>
    post<Ok<{ userMessage: ApiMessage; aiResponse: { handled: boolean; message?: ApiMessage; reason?: string } }>>(
      `/ai-support/conversations/${chatId}/messages`,
      { text }
    ),
  getSession: (chatId: string) =>
    get<
      Ok<{
        aiEnabled: boolean;
        session: {
          mode: 'ai' | 'human' | 'hybrid';
          status: string;
          activeContext: Record<string, string>;
          escalation?: { reason: string; category: string; escalatedAt: string; escalatedBy: string };
          tokenUsage: { totalInput: number; totalOutput: number; requestCount: number };
          hasPendingConfirmation: boolean;
          createdAt: string;
          updatedAt: string;
        } | null;
      }>
    >(`/ai-support/conversations/${chatId}/session`),
  escalate: (chatId: string, reason?: string) =>
    post<Ok<{ mode: string; message: string }>>(`/ai-support/conversations/${chatId}/escalate`, { reason }),
  resumeAI: (chatId: string) =>
    post<Ok<{ mode: string; message: string }>>(`/ai-support/conversations/${chatId}/resume`, {}),
};

/** Desk-side stats, computed server-side over the whole queue rather than the page. */
export interface SupportQueueStats {
  open: number;
  pending: number;
  resolvedToday: number;
  unassigned: number;
  avgFirstResponseMins: number;
}

/**
 * The support desk.
 *
 * One set of endpoints for both desk shapes: signed in as an admin the queue is
 * the platform's, signed in as a provider it is that business's own. The server
 * decides which from the token, so nothing here takes a desk id.
 */
export interface ProviderBalanceRow {
  _id: string;
  name: string;
  email: string;
  business?: { businessName?: string };
  onboarding?: {
    providerType?: string;
    commissionDue?: number;
    cashCreditLimit?: number;
    cashSalesTotal?: number;
  };
  enforcement?: {
    state?: string;
    reason?: string;
    cashBlocked?: boolean;
    cashBlockedReason?: string;
    riskScore?: number;
    riskSignals?: string[];
    /** good / warning / limit_reached / overdue / restricted — what the numbers say. */
    financialState?: string;
  };
}

export interface ObligationSummary {
  total: number;
  byVertical: Record<string, number>;
  nextAt?: string;
}

/**
 * Cash commission collections.
 *
 * The debt runs the other way from `payouts`: this is money providers owe the
 * platform for cash they collected themselves, rather than money the platform
 * owes them for online sales it collected.
 */
export const commissionApi = {
  providers: (params?: { page?: number; limit?: number; cashBlocked?: boolean }) =>
    get<Ok<Paginated<ProviderBalanceRow> & { stats: {
      totalOutstanding: number; currency: string; providersOwing: number; overdueStatements: number;
    } }>>('/commission/admin/providers', params),

  provider: (providerId: string) =>
    get<Ok<{ provider: any; balance: any; statements: any[]; entries: any[] }>>(
      `/commission/admin/providers/${providerId}`
    ),

  /** A manual adjustment, write-off, or an off-platform settlement being recorded. */
  addEntry: (providerId: string, body: { entryType: 'adjustment' | 'write_off' | 'commission_payment'; amount: number; note: string }) =>
    post<Ok<{ balance: any; statementsSettled: string[] }>>(
      `/commission/admin/providers/${providerId}/entries`,
      body
    ),

  /** `null` restores the platform default. */
  setCashLimit: (providerId: string, limit: number | null) =>
    patch<Ok<{ balance: any }>>(`/commission/admin/providers/${providerId}/cash-limit`, { limit }),

  buildStatement: (providerId: string, body?: { year?: number; month?: number; issue?: boolean }) =>
    post<Ok<{ statement: any; billed: number }>>(
      `/commission/admin/providers/${providerId}/statements`,
      body ?? {}
    ),
  runStatements: (body?: { year?: number; month?: number; issue?: boolean }) =>
    post<Ok<{ providers: number; issued: number; period: string }>>(
      '/commission/admin/statements/run',
      body ?? {}
    ),
  sweepOverdue: () => post<Ok<{ flagged: number }>>('/commission/admin/statements/sweep-overdue', {}),
};

export interface RiskEventRow {
  _id: string;
  type: string;
  weight: number;
  detail: string;
  bookingType?: string;
  bookingRef?: string;
  meta?: Record<string, unknown>;
  dismissedAt?: string;
  dismissReason?: string;
  createdAt: string;
}

export interface RiskAssessmentView {
  score: number;
  financialState: string;
  events: RiskEventRow[];
  breakdown: { type: string; count: number; contribution: number }[];
  cashShouldBeWithdrawn: boolean;
  needsReview: boolean;
  reasons: string[];
}

/**
 * The fraud/risk console.
 *
 * The score is never the whole answer — every read returns the events behind it,
 * because an admin about to restrict somebody needs to see *what happened*, and a
 * provider who appeals needs to be told. Events can be dismissed, which keeps them
 * on the record but stops them counting.
 */
export const riskApi = {
  queue: (params?: { minScore?: number; financialState?: string; page?: number; limit?: number }) =>
    get<Ok<Paginated<ProviderBalanceRow> & { thresholds: Record<string, number> }>>(
      '/provider-control/admin/risk',
      params
    ),

  /** The assessment comes back flat, with the dismissed events alongside it. */
  provider: (providerId: string) =>
    get<Ok<RiskAssessmentView & { dismissedEvents: RiskEventRow[]; thresholds: Record<string, number> }>>(
      `/provider-control/admin/providers/${providerId}/risk`
    ),

  /** Record something a detector cannot see — an upheld complaint, a chargeback. */
  addEvent: (body: { providerId: string; type: string; detail: string; bookingType?: string; bookingRef?: string }) =>
    post<Ok<{ event: RiskEventRow; risk: RiskAssessmentView; capabilities: unknown }>>(
      '/provider-control/admin/risk-events',
      body
    ),

  /** Clears an event judged not to be the provider's fault; rescores immediately. */
  dismissEvent: (eventId: string, reason: string) =>
    post<Ok<{ event: RiskEventRow; risk: RiskAssessmentView }>>(
      `/provider-control/admin/risk-events/${eventId}/dismiss`,
      { reason }
    ),

  /** Runs the pattern detectors across every provider with recent activity. */
  sweep: () => post<Ok<{ providers: number; raised: number }>>('/provider-control/admin/risk/sweep', {}),

  /**
   * The Risk & Fraud queues. `group: 'flags'` is what AI Management and the
   * detectors raised; `'customers'` is customer abuse from payment history.
   */
  flags: (params?: {
    group?: 'flags' | 'customers'; kind?: ContentFlagKind; state?: 'open' | 'resolved' | 'all';
    mine?: boolean; ai?: 'likely_fraud' | 'likely_innocent' | 'unclear' | 'none'; page?: number; limit?: number
  }) => get<Ok<Paginated<ContentFlag> & { counts: ContentFlagCounts }>>('/admin-portal/risk/flags', params),

  /** One case with its notes and timeline. */
  flag: (id: string) => get<Ok<{ alert: ContentFlag }>>(`/admin-portal/risk/flags/${id}`),

  /** confirm: the finding was right. clear: it was wrong. What each does depends on the kind. */
  decideFlag: (id: string, decision: 'confirm' | 'clear', note?: string) =>
    post<Ok<{ alert: ContentFlag }>>(`/admin-portal/risk/flags/${id}/decide`, { decision, note }),

  /** Decide up to 200 cases at once — each exactly as it would be alone. */
  decideFlags: (ids: string[], decision: 'confirm' | 'clear', note?: string) =>
    post<Ok<{ done: number; failed: { id: string; error: string }[] }>>('/admin-portal/risk/flags/bulk-decide', { ids, decision, note }),

  /** A fresh AI second opinion on one case. */
  aiReview: (id: string) => post<Ok<{ alert: ContentFlag }>>(`/admin-portal/risk/flags/${id}/ai-review`, {}),

  /** Second opinions for every open case that has none yet (runs in the background). */
  aiReviewBacklog: () => post<Ok<{ queued: number }>>('/admin-portal/risk/flags/ai-review-backlog', {}),

  /** 'me' takes the case (and starts the investigation), 'none' releases it. */
  assignFlag: (id: string, assignee: 'me' | 'none' | string) =>
    post<Ok<{ alert: ContentFlag }>>(`/admin-portal/risk/flags/${id}/assign`, { assignee }),

  addFlagNote: (id: string, text: string) =>
    post<Ok<{ alert: ContentFlag }>>(`/admin-portal/risk/flags/${id}/notes`, { text }),

  appeals: (state: 'pending' | 'all' = 'pending') => get<Ok<{ items: RiskAppealRow[] }>>('/admin-portal/risk/appeals', { state }),

  decideAppeal: (target: 'event' | 'decision', id: string, decision: 'uphold' | 'reject', response?: string) =>
    post<Ok<unknown>>(`/admin-portal/risk/appeals/${target}/${id}/decide`, { decision, response }),

  settings: () => get<Ok<{ settings: RiskSettingsView }>>('/admin-portal/risk/settings'),
  saveSettings: (patch: Partial<RiskSettingsView>) => put<Ok<{ settings: RiskSettingsView }>>('/admin-portal/risk/settings', patch),
  stats: () => get<Ok<RiskFlagStats>>('/admin-portal/risk/stats'),

  /** Every detector: customer scan, provider signals, linked accounts, review rings, listings. */
  sweepAll: () => post<Ok<Record<string, unknown>>>('/admin-portal/risk/sweep', {}),
};

export type ContentFlagKind =
  | 'abusive_review' | 'suspicious_document' | 'off_platform_contact' | 'abusive_chat'
  | 'linked_accounts' | 'review_ring' | 'listing_photo_reuse' | 'listing_price_anomaly' | 'provider_risk'
  | 'chargeback_pattern' | 'cancellation_bot' | 'refund_abuse';

export interface RiskAppeal {
  text: string;
  at: string;
  status: 'pending' | 'upheld' | 'rejected';
  response?: string;
  decidedAt?: string;
  by?: { _id: string; name: string } | string;
  decidedBy?: { _id: string; name: string } | string;
}

export interface RiskAppealRow {
  target: 'event' | 'decision';
  id: string;
  kind: string;
  title: string;
  detail: string;
  weight?: number;
  decisionNote?: string;
  decidedAt?: string;
  provider?: { _id: string; name: string; email?: string; business?: { businessName?: string } };
  appeal: RiskAppeal;
}

export interface RiskSettingsView {
  thresholds: { WARNING: number; CASH_WITHDRAWN: number; REVIEW: number };
  moderation: { extraTerms: { term: string; severity: 'Medium' | 'High' | 'Critical' }[]; allowTerms: string[] };
  detectors: {
    chatContactThreshold: number; chatAbuseThreshold: number; reviewRingCount: number; reviewRingWindowDays: number;
    newAccountDays: number; priceFloorRatio: number; priceMinComparables: number; photoHashDistance: number;
  };
  ai: { chatScreening: boolean; secondOpinion: boolean };
}

/** One AI prompt an admin can edit on AI Management → Instructions. */
export interface ApiAIPrompt {
  id: string;
  label: string;
  description: string;
  /** Editable text. `value` is the admin's version, or `default` when `modified` is false. */
  sections: { id: string; label: string; hint: string; required: boolean; default: string; value: string; modified: boolean }[];
  do: string[];
  dont: string[];
  /** Plain-words summary of what the admin cannot change. */
  locked: string[];
  doExample: string;
  dontExample: string;
  previewLabel: string;
  /** The whole prompt as the model receives it, with placeholders for live data. */
  preview: string;
  customised: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** A whole prompt edit. A section sent as its default, or as null, goes back to the built-in text. */
export interface ApiAIPromptDraft {
  sections: Record<string, string | null>;
  do: string[];
  dont: string[];
}

export interface ApiAIPromptLimits { sectionChars: number; rules: number; ruleChars: number }

export interface RiskFlagStats {
  windowDays: number;
  overall: { confirmed: number; cleared: number; confirmRate: number | null };
  /** How often admins agreed with the AI's likely-fraud / likely-innocent opinion. */
  aiAgreement?: { agreed: number; disagreed: number; rate: number | null };
  byKind: { kind: string; raised: number; confirmed: number; cleared: number; open: number; confirmRate: number | null }[];
  reviewModerationBySource: { source: string; confirmed: number; cleared: number; confirmRate: number | null }[];
  appeals: Record<string, number>;
}

/**
 * A provider's own standing — the score, the events behind it, decisions made
 * about them, and their appeals. Used by the provider consoles.
 */
export interface AccountStanding {
  score: number;
  financialState: string;
  cashBlocked: boolean;
  cashBlockedReason?: string;
  underReview: boolean;
  thresholds: { WARNING: number; CASH_WITHDRAWN: number; REVIEW: number };
  breakdown: { type: string; count: number; contribution: number }[];
  events: { _id: string; type: string; weight: number; detail: string; createdAt: string; appeal?: RiskAppeal }[];
  dismissedEvents: { _id: string; type: string; detail: string; createdAt: string; dismissedAt?: string; dismissReason?: string; appeal?: RiskAppeal }[];
  decisions: { _id: string; kind: string; summary: string; note?: string; decidedAt?: string; appeal?: RiskAppeal }[];
}

export const standingApi = {
  mine: () => get<Ok<AccountStanding>>('/provider-control/me/standing'),
  appeal: (target: 'event' | 'decision', id: string, text: string) =>
    post<Ok<unknown>>('/provider-control/me/appeals', { target, id, text }),
};

export interface ContentFlagReason {
  code: string;
  severity: 'Medium' | 'High' | 'Critical';
  detail: string;
}

export interface ContentFlag {
  _id: string;
  kind: ContentFlagKind;
  title: string;
  desc: string;
  severity: 'Medium' | 'High' | 'Critical';
  status: 'Open' | 'Investigating' | 'Blocked' | 'Dismissed';
  user?: { _id: string; name: string; email?: string; avatar?: string; role?: string; isActive?: boolean; business?: { businessName?: string } };
  /** Live state of the review (visible/hidden/deleted) or document (needs_review/rejected/…). */
  subjectStatus?: string;
  assignedTo?: { _id: string; name: string } | string;
  notes?: { by?: { _id: string; name: string } | string; text: string; at: string }[];
  history?: { at: string; by?: { _id: string; name: string } | string; action: string; note?: string }[];
  appeal?: RiskAppeal;
  evidence?: {
    /** The AI's second opinion, when it has given one. */
    ai?: AiOpinion;
    // Detector findings — shapes vary by kind; the queue renders what is present.
    count?: number;
    threadCount?: number;
    paymentRoute?: boolean;
    samples?: { messageId: string; chatId: string; at: string; kinds?: string[]; text: string; aiReason?: string }[];
    accounts?: { id: string; name: string; email?: string; role?: string; blocked?: boolean; createdAt?: string }[];
    matches?: {
      type?: string; masked?: string; sources?: string[]; url?: string; otherUrl?: string; exact?: boolean; distance?: number | null;
      listing?: { kind: string; id: string; name: string }; other?: { kind: string; id: string; name: string };
    }[];
    reviews?: { id: string; authorName?: string; at: string; reason: string; accountAgeDays: number; excerpt: string }[];
    listing?: { kind: 'boat' | 'trip'; id: string; name: string };
    /** Grouped listing cases: every listing the case covers. Price cases carry the price fields. */
    listings?: {
      kind: 'boat' | 'trip'; id: string; name: string;
      price?: number; currency?: string; unit?: string; median?: number; pctOfMedian?: number; comparables?: number; city?: string;
    }[];
    originalProvider?: { id: string; name?: string };
    rate?: number;
    median?: number;
    unit?: string;
    city?: string;
    comparables?: number;
    pctOfMedian?: number;
    score?: number;
    breakdown?: { type: string; count: number; contribution: number }[];
    // abusive_review
    reviewId?: string;
    excerpt?: string;
    rating?: number;
    targetType?: string;
    categories?: string[];
    terms?: string[];
    source?: 'wordlist' | 'ai';
    // suspicious_document
    aiDocumentId?: string;
    label?: string;
    docType?: string;
    fileUrl?: string;
    fileName?: string;
    fraudScore?: number;
    reasons?: ContentFlagReason[];
    decisionNote?: string;
  };
  resolvedAt?: string;
  createdAt: string;
}

export interface AiOpinion {
  verdict: 'likely_fraud' | 'likely_innocent' | 'unclear';
  confidence: number;
  summary: string;
  suggestedAction: 'confirm' | 'clear' | 'investigate';
  at: string;
}

export interface ContentFlagCounts {
  /** Open cases in the queue by AI opinion; `none` = not reviewed yet. */
  openByAi?: Record<string, number>;
  openByKind: Record<string, number>;
  openFlags: number;
  openCustomers: number;
  openDocuments: number;
  openReviews: number;
  pendingAppeals: number;
  confirmedThisMonth: number;
  clearedThisMonth: number;
}

/**
 * Provider lifecycle enforcement.
 *
 * Several named actions rather than one deactivate switch, because the choice
 * between them *is* the decision — see `providerControl.service.ts` on the
 * backend. `obligations` comes back with every read so the console can show how
 * many customers an action would affect before anybody takes it.
 */
export const providerControlApi = {
  list: (params?: { state?: string; providerType?: string; page?: number; limit?: number }) =>
    get<Ok<Paginated<ProviderBalanceRow>>>('/provider-control/admin/providers', params),

  detail: (providerId: string) =>
    get<Ok<{
      provider: any;
      enforcement: any;
      capabilities: any;
      obligations: ObligationSummary;
      commission: any;
    }>>(`/provider-control/admin/providers/${providerId}`),

  /**
   * `acknowledgeCustomerImpact` is required to emergency-suspend over live
   * bookings — the backend 409s without it and returns the obligation counts, so
   * the UI can show what it is about to interrupt.
   */
  setState: (
    providerId: string,
    body: { state: string; reason: string; acknowledgeCustomerImpact?: boolean }
  ) =>
    patch<Ok<{ enforcement: any; capabilities: any; obligations: ObligationSummary }>>(
      `/provider-control/admin/providers/${providerId}/state`,
      body
    ),

  /** Cash withheld independently of the account's state — the graduated control. */
  setCashBlocked: (providerId: string, blocked: boolean, reason?: string) =>
    patch<Ok<{ enforcement: any; capabilities: any }>>(
      `/provider-control/admin/providers/${providerId}/cash`,
      { blocked, reason }
    ),
};

export const supportApi = {
  queue: (params?: {
    status?: SupportStatus;
    desk?: SupportDesk;
    priority?: SupportPriority;
    unassigned?: boolean;
    assignedTo?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) => get<Ok<Paginated<ApiChat> & { stats: SupportQueueStats }>>('/chats/support/queue', params),

  /** Desks this account may itself write to — providers raising their own tickets. */
  desks: () => get<Ok<{ desks: { desk: SupportDesk; requiresProvider: boolean }[] }>>('/chats/support/desks'),

  deskProviders: (desk: SupportDesk, search?: string) =>
    get<Ok<{ providers: ApiSubscriber[] }>>('/chats/support/providers', { desk, ...(search ? { search } : {}) }),

  open: (body: {
    subject: string;
    message?: string;
    desk?: SupportDesk;
    deskOwnerId?: string;
    category?: string;
    priority?: SupportPriority;
  }) => post<Ok<{ chat: ApiChat }>>('/chats/support', { desk: 'admin', ...body }),

  /** Assigns to the caller when `assignedTo` is omitted, which is the common case. */
  assign: (chatId: string, assignedTo?: string) =>
    patch<Ok<{ chat: ApiChat }>>(`/chats/${chatId}/support/assign`, { assignedTo }),
  setStatus: (chatId: string, status: SupportStatus) =>
    patch<Ok<{ chat: ApiChat }>>(`/chats/${chatId}/support/status`, { status }),
  setPriority: (chatId: string, priority: SupportPriority) =>
    patch<Ok<{ chat: ApiChat }>>(`/chats/${chatId}/support/priority`, { priority }),
  context: (chatId: string) => get<Ok<{ chatId: string; reference: string; opener: ApiUser;
    handlingState: string; sourceChatId?: string; handoff?: { reason: string; category: string;
      summary?: string; context?: Record<string, string>; completedTools?: { tool: string; at: string; result?: Record<string, unknown> }[] } | null }>>(`/support/cases/${chatId}/context`),
  notes: (chatId: string) => get<Ok<{ items: { _id: string; body: string; actor: ApiSubscriber; createdAt: string }[] }>>(`/support/cases/${chatId}/notes`),
  addNote: (chatId: string, body: string) => post<Ok<{ note: { _id: string; body: string; createdAt: string } }>>(`/support/cases/${chatId}/notes`, { body }),
  suggestReply: (chatId: string) => post<Ok<{ text: string }>>(`/support/cases/${chatId}/suggest-reply`, {}),
  setHandlingState: (chatId: string, state: string) => patch<Ok<{ chat: ApiChat }>>(`/support/cases/${chatId}/state`, { state }),
  transfer: (chatId: string, assignedTo: string) => post<Ok<{ chat: ApiChat }>>(`/support/cases/${chatId}/transfer`, { assignedTo }),
  actionPreview: (chatId: string, key: string, entityId: string, input: Record<string, unknown> = {}) =>
    post<Ok<{ action: string; entity: Record<string, unknown>; executable: boolean; requiresApproval?: boolean }>>(
      `/support/cases/${chatId}/actions/${key}/preview`, { entityId, input }),
  actionExecute: (chatId: string, key: string, entityId: string, input: Record<string, unknown>, reason: string, idempotencyKey: string) =>
    post<Ok<{ action: { _id: string; status: string; result?: Record<string, unknown> } }>>(
      `/support/cases/${chatId}/actions/${key}`, { entityId, input, reason, idempotencyKey }),
  availability: (available: boolean) => patch<Ok<{ available: boolean }>>('/support/me/availability', { available }),
  myAvailability: () => get<Ok<{ available: boolean; capacity: number; scopes: ApiSupportScope[] }>>('/support/me/availability'),
  agents: () => get<Ok<{ items: ApiSupportAgent[] }>>('/support/agents'),
  createAgent: (body: { name: string; email: string; scopes: ApiSupportScope[]; skills: string[]; capacity: number }) =>
    post<Ok<{ agent: ApiSupportAgent; emailSent: boolean; inviteUrl?: string }>>('/support/agents', body),
  updateAgent: (id: string, body: { scopes?: ApiSupportScope[]; skills?: string[]; capacity?: number; status?: 'active' | 'disabled' }) =>
    patch<Ok<{ agent: ApiSupportAgent }>>(`/support/agents/${id}`, body),
  resendAgentInvite: (id: string) => post<Ok<{ emailSent: boolean; inviteUrl?: string }>>(`/support/agents/${id}/resend-invite`, {}),
  acceptAgentInvite: (token: string, password: string) => post<Ok<{ accepted: boolean }>>(`/support/invite/${token}/accept`, { password }),
  pendingActions: () => get<Ok<{ items: ApiSupportApproval[] }>>('/support/actions/pending'),
  supportMetrics: () => get<Ok<{ unassigned: number; failedActions: number; incompleteAudits: number; avgAssignmentMins: number }>>('/support/metrics'),
  decideAction: (id: string, approve: boolean) => post<Ok<{ action: ApiSupportApproval }>>(`/support/actions/${id}/decision`, { approve }),
};

export type ApiSupportScope = { desk: SupportDesk; ownerId?: string; requesterId?: string;
  grants: string[]; refundLimit: number };
export type ApiSupportAgent = { _id: string; user: ApiSubscriber; status: 'invited' | 'active' | 'disabled';
  scopes: (ApiSupportScope & { owner?: string; requester?: string })[]; skills: string[];
  available: boolean; capacity: number; policyVersion: number };
export type ApiSupportApproval = { _id: string; actor: ApiSubscriber;
  chat?: { _id: string; subject?: string; support?: { reference?: string; desk?: SupportDesk } };
  action: string; entityId: string;
  reason: string; input: Record<string, unknown>; status: string; createdAt: string };

export const reviewsApi = {
  /**
   * Everything written about the signed-in business, including reviews of its
   * own staff — one endpoint for every provider type, backed by the review's
   * denormalised `provider`. `unanswered` narrows to the ones still owed a
   * reply, which is the view a desk actually works from.
   */
  aboutMe: (params?: { unanswered?: boolean; page?: number; limit?: number }) =>
    get<Ok<Paginated<ApiReview> & { summary: { average: number; count: number } }>>(
      '/reviews/about-me',
      params
    ),
  reply: (id: string, text: string) => patch<Ok<{ review: ApiReview }>>(`/reviews/${id}/reply`, { text }),
};

export const notificationsApi = {
  list: (params?: { unread?: boolean; limit?: number; page?: number }, options?: ApiRequestOptions) =>
    get<Ok<Paginated<ApiNotification> & { unreadCount: number }>>('/notifications', params, options),
  markRead: (id: string) => patch<Ok<unknown>>(`/notifications/${id}/read`),
  markAllRead: () => patch<Ok<unknown>>('/notifications/read-all'),
};

export const invoicesApi = {
  download: (id: string) => get<Ok<{ url?: string; pdfUrl?: string }>>(`/invoices/${id}/download`),
  email: (id: string) => post<Ok<unknown>>(`/invoices/${id}/email`),
};

// ---------------------------------------------------------------------------
// Platform plans + provider onboarding (self-service)
// ---------------------------------------------------------------------------
export interface PlatformPlan {
  _id: string;
  name: string;
  tier: string;
  interval: 'monthly' | 'yearly';
  /** @deprecated Stored in the settlement currency despite the name — prefer `price`. */
  priceAed: number;
  /** The same figure, with no currency claim in the name. Absent on legacy responses. */
  price?: number;
  commissionRate: number;
  features: string[];
}
export const plansApi = {
  list: (role?: string) => get<Ok<{ plans: PlatformPlan[] }>>('/platform-plans', { role }),
};
export const onboardingApi = {
  me: () => get<Ok<{ onboarding: ApiUser['onboarding']; business: ApiUser['business'] }>>('/onboarding/me'),
  submit: (data: {
    billingModel: 'subscription' | 'commission';
    planId?: string;
    subscriptionPackageId?: string;
    commissionPackageId?: string;
    businessName: string;
    contactNumber: string;
    address: string;
    country: string;
    city?: string;
    description?: string;
    latitude?: number;
    longitude?: number;
    vhfChannel?: string;
  }) => post<Ok<{ user: ApiUser }>>('/onboarding/submit', data),
  subscriptionCheckout: (packageId?: string, shopperResultUrl?: string, opts?: CheckoutGatewayChoice) =>
    post<Ok<GatewayCheckoutData & { package: { id: string; name: string; price: number; durationMonths: number } }>>(
      '/onboarding/subscription-checkout',
      { packageId, shopperResultUrl, ...opts }
    ),


  paySubscription: (checkoutId?: string) =>
    post<Ok<{ user: ApiUser; message: string; subscriptionExpiry?: string }>>('/onboarding/pay-subscription', { checkoutId }),
};

// ---------------------------------------------------------------------------
// Provider registration wizard (marina/fuel/maintenance) — draft, section-save,
// document/image uploads, and final submit. See boatpro-backend
// src/models/ProviderRegistration.ts for the authoritative shape.
// ---------------------------------------------------------------------------
export interface ApiRegistrationImage { url: string; category?: string }
export interface ApiChecklistIssue { section: string; message: string }
/** One thing the automated reading found wrong, already phrased for the uploader. */
export interface ApiAiReviewFlag {
  code: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  field?: string;
}

/** A value the reading pulled off the page — expiry date, ID number, holder name. */
export interface ApiAiReviewField {
  key: string;
  label: string;
  value: string;
  confidence: number;
}

/** The machine reading of one uploaded document, as every client renders it. */
export interface ApiAiReview {
  status: string;
  severity: 'clear' | 'warning' | 'critical';
  headline?: string;
  flags: ApiAiReviewFlag[];
  fields: ApiAiReviewField[];
  confidence: number;
  analyzedAt?: string;
  documentId?: string;
}

export interface ApiUploadedDocument {
  id: string;
  docType: string;
  label: string;
  status: 'pending' | 'approved' | 'rejected';
  fileName?: string;
  fileUrl: string;
  uploadedAt: string;
  ai: ApiAiReview;
  expiresAt?: string;
  acknowledgedAt?: string;
  acknowledgedNote?: string;
  reminder?: { message: string; requestedAt: string; count: number; resolvedAt?: string };
  rejectionReason?: string;
}

export interface ApiDocumentChecklist {
  required: string[];
  optional: string[];
  uploaded: ApiUploadedDocument[];
}
export interface ApiProviderRegistration {
  _id: string;
  user: string;
  providerType: 'marina_provider' | 'fuel_provider' | 'maintenance_provider';
  status: 'draft' | 'pending' | 'approved' | 'rejected';
  account?: { identityType?: string; identityDocUrl?: string; profilePhotoUrl?: string };
  business?: {
    category?: string; businessNameEn?: string; businessNameAr?: string; crNumber?: string; vatNumber?: string;
    /** "Do you have a VAT certificate?" — `false` takes it off the required documents; absent = not answered. */
    hasVatCertificate?: boolean;
    businessEmail?: string; businessPhone?: string; website?: string; vhfChannel?: string; crDocUrl?: string; vatDocUrl?: string;
  };
  entity?: {
    nameEn?: string; nameAr?: string; descriptionEn?: string; descriptionAr?: string; region?: string; city?: string;
    address?: string; latitude?: number; longitude?: number; vhfChannel?: string; marinaRef?: string; serviceCategories?: string[];
    /**
     * Maintenance registrations only, and required for them — a vendor picks
     * "normal maintenance" or "boat ramp" before they can submit. It was
     * missing from this type, so the KYC queue rendered every maintenance
     * application as a workshop and a reviewer approving a boat ramp had no
     * way to see that is what they were approving.
     */
    serviceType?: 'maintenance' | 'boat_ramp';
  };
  capacity?: { numPontoons?: number; totalBerths?: number; maxBoatLengthFt?: number; maxBoatWidthFt?: number; maxBoatDraftFt?: number };
  facilities: { key: string; available: boolean; detail?: string }[];
  fuelOfferings?: { fuelTypes?: string[]; serviceTypes?: string[] };
  dockPackages: { name: string; cadence: string; priceSar: number; isActive: boolean }[];
  fuelPricing?: { deliveryFeeSar?: number; emergencyDeliveryFeeSar?: number; minOrderQtyLiters?: number; perType?: { type: string; pricePerLiter: number }[] };
  maintenancePricing?: { hourlyRateSar?: number; inspectionFeeSar?: number; emergencyVisitFeeSar?: number; servicePrices?: { serviceKey: string; label: string; priceSar: number }[] };
  operatingHours?: { workingDays?: number[]; openTime?: string; closeTime?: string; open24h?: boolean };
  bank?: { bankName?: string; accountHolderName?: string; iban?: string; accountNumber?: string; swiftCode?: string };
  payment?: {
    billingModel?: 'subscription' | 'commission'
    subscriptionPackageId?: string
    commissionPackageId?: string
    planId?: string
    /** Set when the provider arrived through an admin's invite link instead of picking a plan. */
    inviteCode?: string
    inviteConsumedAt?: string
  };
  images: ApiRegistrationImage[];
  emergency?: { contactNumber?: string; responsiblePersonName?: string; email?: string; proceduresText?: string };
  rejectionReason?: string;
}
export interface ApiRegistrationState {
  registration: ApiProviderRegistration;
  issues: ApiChecklistIssue[];
  complete: boolean;
  documentChecklist: ApiDocumentChecklist;
}
export const providerRegistrationApi = {
  me: () => get<Ok<ApiRegistrationState>>('/provider-registration/me'),
  saveSection: (section: string, data: Record<string, unknown>) =>
    patch<Ok<ApiRegistrationState>>(`/provider-registration/section/${section}`, data),
  uploadIdDocument: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return post<Ok<{ registration: ApiProviderRegistration }>>('/provider-registration/uploads/id-document', fd);
  },
  uploadProfilePhoto: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return post<Ok<{ registration: ApiProviderRegistration }>>('/provider-registration/uploads/profile-photo', fd);
  },
  uploadCrDocument: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return post<Ok<{ registration: ApiProviderRegistration }>>('/provider-registration/uploads/cr-document', fd);
  },
  uploadVatDocument: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return post<Ok<{ registration: ApiProviderRegistration }>>('/provider-registration/uploads/vat-document', fd);
  },
  uploadDocument: (docType: string, file: File) => {
    const fd = new FormData();
    fd.append('docType', docType);
    fd.append('file', file);
    return post<Ok<{ document: ApiUploadedDocument }>>('/provider-registration/uploads/documents', fd);
  },
  uploadImages: (files: File[], category?: string) => {
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f));
    if (category) fd.append('category', category);
    return post<Ok<{ images: ApiRegistrationImage[] }>>('/provider-registration/uploads/images', fd);
  },
  deleteImage: (index: number) => del<Ok<{ images: ApiRegistrationImage[] }>>(`/provider-registration/images/${index}`),
  submit: () => post<Ok<{ registration: ApiProviderRegistration }>>('/provider-registration/submit'),
};

// ---------------------------------------------------------------------------
// Admin — provider onboarding approvals.
// ---------------------------------------------------------------------------
export interface AdminProvider {
  _id: string;
  id?: string;
  name: string;
  email: string;
  phone?: string;
  role: 'boat_provider' | 'marina_provider' | 'fuel_provider' | 'maintenance_provider';
  /**
   * `scuba_diver` for an independent diving operator — a `boat_provider` that
   * signs up without commercial paperwork and may only list diving trips.
   * Absent means a standard provider. See PROVIDER_KINDS on the API.
   */
  providerKind?: 'standard' | 'scuba_diver';
  avatar?: string;
  createdAt: string;
  business?: {
    businessName?: string;
    businessNameAr?: string;
    logo?: string;
    contactNumber?: string;
    contactPhone?: string;
    address?: string;
    description?: string;
    descriptionAr?: string;
    country?: string;
    city?: string;
    region?: string;
    latitude?: number;
    longitude?: number;
    vhfChannel?: string;
    /** The provider's answer to "do you have a VAT certificate?"; absent = never asked. */
    hasVatCertificate?: boolean;
  };
  onboarding?: {
    status: 'incomplete' | 'pending' | 'pending_subscription_payment' | 'approved' | 'rejected' | 'suspended';
    billingModel?: 'subscription' | 'commission';
    subscriptionPlan?: { _id: string; name: string; tier: string; priceAed: number; price?: number; interval: string } | string;
    subscriptionPackageId?: { _id: string; name: string; price: number; durationMonths: number } | string;
    subscriptionPaid?: boolean;
    commissionRate?: number;
    commissionType?: 'percentage' | 'fixed';
    commissionFixedAmount?: number;
    submittedAt?: string;
    reviewedAt?: string;
    rejectionReason?: string;
    subscriptionExpiresAt?: string;
  };
  /** From `/admin/providers` only: earned revenue, bookings and live rating. */
  stats?: { bookings: number; gross: number; commission: number; rating: number; reviewCount: number };
  subscriptionInfo?: { status: string; daysUntilExpiry: number | null; isExpiringSoon: boolean; isExpired: boolean };
}

export interface AdminBoatApproval {
  _id: string;
  id?: string;
  name: string;
  nameAr?: string;
  tagline?: string;
  code: string;
  category: string;
  manufacturer?: string;
  model?: string;
  yearBuilt?: number;
  status: string;
  approvalStatus: 'pending' | 'approved' | 'rejected';
  approvalReason?: string;
  approvalAt?: string;
  images: string[];
  documents: {
    label: string;
    type?: string;
    fileUrl: string;
    fileName?: string;
    uploadedAt: string;
    aiDocumentId?: string;
    verifiedByAdmin?: boolean;
    reviewStatus?: 'needs_review' | 'approved' | 'rejected' | 'failed';
    confidence?: number;
    extractedData?: Record<string, { value: unknown; confidence: number; verbatim?: string }>;
    rawOcrText?: string;
  }[];
  capacity: number;
  crewCapacity?: number;
  lengthFt: number;
  beamFt?: number;
  draftFt?: number;
  grossTonnage?: number;
  displacementKg?: number;
  cabins?: number;
  berths?: number;
  heads?: number;
  maxSpeedKn?: number;
  cruiseSpeedKn?: number;
  
  // Machinery & Engine
  engine?: {
    type?: string;
    count?: number;
    manufacturer?: string;
    model?: string;
    horsepowerHp?: number;
    fuelType?: string;
    engineHours?: number;
    year?: number;
    serialNumbers?: string[];
  };
  hullMaterial?: string;
  fuelCapacityL?: number;
  freshWaterCapacityL?: number;
  blackWaterCapacityL?: number;
  rangeNm?: number;

  // Registration & Legal
  ownerName?: string;
  ownerId?: string;
  vesselLicense?: string;
  registrationNumber?: string;
  hullId?: string;
  mmsi?: string;
  imo?: string;
  callSign?: string;
  portOfRegistry?: string;
  flag: string;
  countryOfOrigin?: string;
  vhfChannel?: string;
  insuranceProvider?: string;
  insurancePolicyNumber?: string;
  insuranceExpiry?: string;
  registrationExpiry?: string;
  lastInspectionAt?: string;
  nextInspectionDueAt?: string;
  
  // Captain & Operations
  captain?: {
    name?: string;
    nameAr?: string;
    avatar?: string;
    licenseNumber?: string;
    licenseExpiry?: string;
    yearsExperience?: number;
    phone?: string;
  };
  turnaroundMinutes?: number;
  operatingWindow?: { from?: string; to?: string };
  homeBerth?: string;
  pickupAddress?: string;
  city: string;
  marina: string;

  // Equipment & Amenities
  navigationEquipment?: string[];
  safetyEquipment?: string[];
  lifeJacketCount?: number;
  amenities?: { icon?: string; label: string; labelAr?: string }[];

  description?: string;
  createdAt: string;
  /**
   * The owning provider, populated by `GET /admin/boats`. The server populates
   * it onto `providerId` and renames the key on the way out, so `providerId` is
   * not a field this type has.
   *
   * `providerKind` is `scuba_diver` for a diving operator — the one account
   * that owes no vessel paperwork. See PROVIDER_KINDS on the API.
   */
  provider?: { _id: string; name: string; email: string; providerKind?: string; business?: { businessName?: string } };
}

export const adminApi = {
  listProviders: (params?: { role?: string; status?: string }) =>
    get<Ok<{ providers: AdminProvider[]; statusCounts: Record<string, number> }>>('/admin/providers', params),
  approve: (id: string, options?: { forceBypassPayment?: boolean }) =>
    patch<Ok<{ user: AdminProvider }>>(`/admin/providers/${id}/approve`, options),
  getRegistration: (id: string) =>
    get<
      Ok<{
        registration: ApiProviderRegistration | null
        documents: {
          _id: string
          docType: string
          status: string
          fileUrl: string
          fileName?: string
          aiSeverity?: 'clear' | 'warning' | 'critical'
          aiFlags?: { code: string; severity: 'info' | 'warning' | 'critical'; message: string; field?: string; detail?: string }[]
          acknowledgedAt?: string
          acknowledgedNote?: string
        }[]
        /** The document findings, gathered for whoever reviews the application. */
        documentReview?: DocumentReview
        /** This applicant's documents against the checklist as Admin → Required Documents has it today. */
        documentChecklist?: ApiApplicantDocChecklist
      }>
    >(`/admin/providers/${id}/registration`),
  reject: (id: string, reason: string) => patch<Ok<{ user: AdminProvider }>>(`/admin/providers/${id}/reject`, { reason }),
  suspend: (id: string) => patch<Ok<{ user: AdminProvider }>>(`/admin/providers/${id}/suspend`),
  sendSubscriptionReminder: (id: string, message?: string) =>
    post<Ok<{ recipient: string; title: string; body: string; status: string }>>(`/admin/providers/${id}/subscription-reminder`, { message }),
  verifyDocument: (docId: string, status: 'approved' | 'rejected', rejectionReason?: string) => 
    patch<Ok<void>>(`/documents/${docId}/verify`, { status, rejectionReason }),
  platformEarnings: () =>
    get<
      Ok<{
        totals: { grossVolume: number; platformCommission: number; paidToProviders: number; count: number };
        byProvider: {
          commission: number;
          gross: number;
          count: number;
          provider?: { name?: string; email?: string; role?: string; business?: { businessName?: string } };
        }[];
      }>
    >('/payments/platform-earnings'),

  // ── Boat Approval Workflow ─────────────────────────────────────────────────
  listBoatApprovals: (params?: { approvalStatus?: string; page?: number; limit?: number }) =>
    get<Ok<{ boats: AdminBoatApproval[]; total: number; statusCounts: Record<string, number> }>>('/admin/boats', params),
  approveBoat: (id: string) =>
    patch<Ok<{ boat: AdminBoatApproval }>>(`/admin/boats/${id}/approve`),
  rejectBoat: (id: string, reason: string) =>
    patch<Ok<{ boat: AdminBoatApproval }>>(`/admin/boats/${id}/reject`, { reason }),

  // ── Marina Approval Workflow ───────────────────────────────────────────────
  listMarinaApprovals: (params?: { approvalStatus?: string; page?: number; limit?: number }) =>

    get<Ok<{ marinas: AdminMarinaApproval[]; total: number; statusCounts: Record<string, number> }>>('/admin-portal/marina-approvals', params),
  approveMarina: (id: string) =>
    patch<Ok<{ marina: AdminMarinaApproval }>>(`/admin-portal/marina-approvals/${id}/approve`),
  rejectMarina: (id: string, reason: string) =>
    patch<Ok<{ marina: AdminMarinaApproval }>>(`/admin-portal/marina-approvals/${id}/reject`, { reason }),

  // ── Maintenance Shop Approval Workflow ─────────────────────────────────────
  listMaintShopApprovals: (params?: { approvalStatus?: string; serviceType?: 'maintenance' | 'boat_ramp'; page?: number; limit?: number }) =>
    get<Ok<{ shops: AdminMaintShopApproval[]; total: number; statusCounts: Record<string, number> }>>('/admin-portal/maint-shop-approvals', params),
  approveMaintShop: (id: string) =>
    patch<Ok<{ shop: AdminMaintShopApproval; message: string }>>(`/admin-portal/maint-shop-approvals/${id}/approve`),
  rejectMaintShop: (id: string, reason: string) =>
    patch<Ok<{ shop: AdminMaintShopApproval; message: string }>>(`/admin-portal/maint-shop-approvals/${id}/reject`, { reason }),
};

export interface AdminMarinaApproval extends ApiMarina {
  owner?: { _id?: string; name?: string; email?: string; avatar?: string; phone?: string; business?: { businessName?: string } };
  pontoonsCount?: number;
  slotsCount?: number;
  /** Pontoon slots plus stand-alone berths — every berth the marina has. */
  berthCount?: number;
  pricedSlotsCount?: number;
  minPrice?: number | null;
  complianceDocs?: ApiMarinaDocument[];
}


// ---------------------------------------------------------------------------
// Provider earnings (this provider's revenue & platform commission).
// ---------------------------------------------------------------------------
export interface ProviderEarnings {
  billingModel: 'subscription' | 'commission' | null;
  commissionRate: number | null;
  /** Which of the three deals — `commission` covers both a percentage and a flat fee. */
  planKind?: PlanKind;
  /** The terms in one line, already worded for the plan's own kind. */
  planLabel?: string;
  /** The flat cut per transaction on a fixed-fee plan; 0 otherwise. */
  feePerTransaction?: number;
  totals: { gross: number; commission: number; net: number; count: number };
  month: { gross: number; net: number; count: number };
  recent: {
    _id: string;
    amount: number;
    commissionAmount?: number;
    providerNet?: number;
    bookingType?: string;
    currency?: string;
    paidAt?: string;
    customer?: { name?: string; avatar?: string };
  }[];
}
export const earningsApi = {
  mine: () => get<Ok<ProviderEarnings>>('/payments/provider/earnings'),
};

// Geocoding (backend proxies OpenStreetMap Nominatim — no API key needed).
export interface GeoResult {
  label: string;
  latitude: number;
  longitude: number;
  type?: string;
}
export const mapsApi = {
  geocode: (q: string) => get<Ok<{ results: GeoResult[] }>>('/maps/geocode', { q }),
  reverse: (lat: number, lng: number) =>
    get<Ok<{ address: string; latitude: number; longitude: number }>>('/maps/reverse', { lat, lng }),
};

// ---------------------------------------------------------------------------
// Maintenance provider portal
// ---------------------------------------------------------------------------
/** One trade the customer asked for, with the hours they estimated. */
export interface MaintenanceRequestItem { category: string; name: string; hours: number }
export interface MaintenanceProviderRequest {
  id: string; _id?: string; boatName: string; boatLengthFt?: number; category: string; title: string; description: string;
  titleAr?: string; descriptionAr?: string;
  priority: string; status: string; location?: string; requestedAt: string; quotedAmount?: number; quoteNotes?: string; quoteNotesAr?: string; scheduledFor?: string;
  /** The customer's answer to `quotedAmount`; absent while they have not answered. */
  customerQuoteResponse?: 'accepted' | 'declined';
  declineReason?: string; declineReasonAr?: string;
  /** Photos the owner attached to the request. */
  photos?: string[];
  /** Per-trade breakdown, and the customer's own total estimate. */
  items?: MaintenanceRequestItem[];
  itemsAr?: (MaintenanceRequestItem & { nameAr?: string })[];
  estimatedHours?: number;
  /** The day and time the customer asked for — `scheduledFor` is what we committed to. */
  preferredDate?: string;
  preferredSlot?: string;
  /**
   * This shop's outstanding request to move the job, if any.
   *
   * Distinct from `preferredDate`/`preferredSlot` above, which are what is
   * *agreed*. A pending proposal changes neither until the owner accepts.
   */
  rescheduleProposal?: {
    status: 'pending' | 'accepted' | 'declined' | 'withdrawn';
    proposedStartAt: string;
    proposedSlot?: string;
    reason?: string;
    reasonAr?: string;
    previousStartAt?: string;
  };
  customer?: { id?: string; _id?: string; name?: string; avatar?: string; email?: string; phone?: string };
  /** The real vessel, when the request came from a fleet the owner keeps in BoatPro. */
  boat?: { id?: string; _id?: string; name?: string; category?: string; lengthFt?: number; capacity?: number; engineHours?: number; fuelCapacityL?: number };
  workOrder?: { id?: string; _id?: string; code?: string; status?: string };
}
/** The workshop's own booking rules, driving what customers can book. */
export interface MaintenanceSettings {
  id?: string;
  /** 0 = Sunday … 6 = Saturday. */
  workingDays: number[];
  /** Bookable start times, 24h "HH:mm". */
  slots: string[];
  slotMinutes: number;
  maxAdvanceDays: number;
}
// 'workorders' is deliberately absent — Work Orders always shows just a
// technician's own assigned jobs, with no full-board/dispatcher upgrade.
export const MAINTENANCE_WORKER_PERMISSIONS = [
  'calendar', 'mobile', 'requests', 'technicians', 'parts', 'billing', 'reports', 'messages', 'notifications', 'workshop', 'settings',
] as const;
export type MaintenanceWorkerPermission = (typeof MAINTENANCE_WORKER_PERMISSIONS)[number];
export type MaintenanceAccountStatus = 'none' | 'invited' | 'pending_approval' | 'active' | 'disabled';
export type WorkerApprovalStatus = 'pending' | 'approved' | 'rejected';
export interface ApiMaintAccess { isOwner: boolean; permissions: MaintenanceWorkerPermission[] }
/** One trade the technician bills for, at their own rate for it. */
export interface TechnicianRole { role: string; roleAr?: string; hourlyRate: number }
export interface MaintenanceTechnician {
  id: string; _id?: string; name: string; phone?: string; email?: string; avatar?: string; role: string; roleAr?: string; skills: string[]; tags?: string[]; tagsAr?: string[]; certifications: string[]; certificationsAr?: string[];
  status: 'on_duty' | 'off_duty' | 'on_leave'; mobile: boolean;
  /** Source of truth for rates. `role` is the " · "-joined display string derived from this. */
  roles: TechnicianRole[];
  /** Legacy flat rate, only present on technicians created before per-role rates. */
  hourlyRate?: number;
  permissions: MaintenanceWorkerPermission[]; accountStatus: MaintenanceAccountStatus;
  approvalStatus?: WorkerApprovalStatus; rejectionReason?: string; rejectionReasonAr?: string;
  user?: { _id: string; name: string; email: string; avatar?: string; isActive: boolean } | string;
  /**
   * Last position reported by the technician's own phone, while on duty.
   *
   * Absent for a technician who has never reported one, or who is not a mobile
   * technician — which the tracker must show as "no location" rather than
   * inventing a pin.
   */
  lastLocation?: {
    latitude?: number;
    longitude?: number;
    accuracy?: number;
    heading?: number;
    speed?: number;
    /** Device clock. What "last seen" is measured against. */
    recordedAt?: string;
  };
}

/** A position older than this is shown as a last-known pin, not a live one. */
export const STALE_LOCATION_MS = 15 * 60 * 1000;
/** A trade a workshop staffs. See MaintenanceRole on the API. */
export interface MaintenanceRoleData {
  id: string
  name: string
  nameAr?: string
  /** One of MAINT_CATEGORIES — the shelf the trade sits on. */
  category: string
  /** The workshop's own search terms; a boater finds the trade by these. */
  keywords: string[]
  keywordsAr?: string[]
  defaultHourlyRate: number
  active: boolean
  /** How many technicians hold it — what makes retiring one a real decision. */
  technicians?: number
}

export interface MaintenanceWorkOrder { id: string; _id?: string; code: string; boatName: string; customerName?: string; category: string; title: string; titleAr?: string; description?: string; descriptionAr?: string; priority: string; status: string; technician?: MaintenanceTechnician; scheduledFor?: string; dueDate?: string; estimatedHours: number; workedHours: number; progress: number; laborCost: number; partsCost: number; paused: boolean; createdAt: string;
  /** Which of the technician's roles this job is booked at. */
  bookedRole?: string; bookedRoleAr?: string;
  /** Rate frozen at assignment. Labour = workedHours × this, derived server-side. */
  hourlyRate?: number;
  /** Who worked which trade, for how long — each at that person's own rate for
   * it. Empty on single-person single-trade jobs. */
  assignments?: { role: string; roleAr?: string; technician: string; hourlyRate: number; hours: number }[];
}
export interface MaintenancePart { id: string; _id?: string; sku: string; name: string; nameAr?: string; category?: string; stock: number; minimumStock: number; unitCost: number; supplier?: string; location?: string }
export interface MaintenanceInvoice { id: string; _id?: string; code: string; customerName: string; boatName: string; labor: number; parts: number; tax: number; discount: number; total: number; status: string; refundedAmount?: number; notes?: string; notesAr?: string; assignments?: { role: string; roleAr?: string }[]; dueDate?: string; paidAt?: string; createdAt: string; customer?: { name?: string; avatar?: string; email?: string }
  /** Taxable amount before VAT. Optional: invoices issued before VAT was applied have none. */
  subtotal?: number
  /** VAT percentage stamped at issue (15 = 15%) — `tax` is the amount it produced. */
  vatRate?: number }
export interface MaintenanceInspection { id: string; _id?: string; boatName: string; type: string; typeAr?: string; status: 'scheduled' | 'in_progress' | 'completed'; score?: number; items: { label: string; labelAr?: string; result: string; note?: string; noteAr?: string }[]; notes?: string; notesAr?: string; performedAt?: string; createdAt: string; updatedAt?: string; technician?: MaintenanceTechnician; workOrder?: MaintenanceWorkOrder }
export interface MaintenanceOverview {
  requests: MaintenanceProviderRequest[];
  workOrders: MaintenanceWorkOrder[];
  technicians: MaintenanceTechnician[];
  parts: MaintenancePart[];
  invoices: MaintenanceInvoice[];
  metrics: {
    requestCounts: Record<string, number>;
    workOrderCounts: Record<string, number>;
    revenue: number;
    /** Parts at or below their minimum stock level. */
    lowStock: number;
    /** Technicians currently marked on duty. */
    onDuty: number;
    /**
     * Work orders short of a terminal state, and requests nobody has
     * dispositioned. Summed server-side so every surface that shows "active
     * jobs" agrees, rather than each client re-deriving it from the per-status
     * maps above and drifting when a status is added.
     *
     * Scoped exactly like `GET /work-orders`: provider-wide for an owner, the
     * technician's own assigned jobs for a worker.
     */
    activeWorkOrders: number;
    openRequests: number;
    pendingRequests: number;
    /** Critical-priority work orders that are still open. */
    emergencies: number;
  };
}
export interface MaintenanceCustomer { id: string; name: string; email: string; phone?: string; avatar?: string; role: 'customer' | 'boat_provider' }

// A shop's own advertised service menu — distinct from a customer's
// MaintenanceProviderRequest or an assigned MaintenanceWorkOrder.
export interface MaintenanceServiceCatalogItem { id: string; _id?: string; name: string; nameAr?: string; category: string; priceFrom: number; turnaroundLabel?: string; turnaroundLabelAr?: string; status: 'active' | 'paused'; jobsCompletedCount: number; rating: number; createdAt?: string }
export interface MaintenanceWarranty { id: string; _id?: string; boatName: string; item: string; itemAr?: string; kind: 'parts' | 'service'; vendor?: string; startDate?: string; expiryDate?: string; status: 'active' | 'expiring' | 'expired' | 'claimed' }
export interface MaintenanceServiceHistoryEntry { id: string; _id?: string; boatName: string; performedAt: string; title: string; titleAr?: string; category: string; technician?: { _id?: string; name?: string; avatar?: string }; cost: number; partsUsed: string[]; partsUsedAr?: string[] }
export interface BoatHealthSystem { name: string; nameAr?: string; score: number; note: string; noteAr?: string; performedAt?: string }
export interface BoatHealth { boatName: string; overall: number; systems: BoatHealthSystem[]; trend: { month: string; score: number }[]; historySummary: { totalCost: number; entryCount: number; lastServiceAt: string | null } }
export interface ApiFleetAccount {
  id: string;
  company: string;
  boats: number;
  boatNames: string[];
  contract: string;
  contractAr?: string;
  status: 'Good standing' | 'Watch' | 'On hold';
  spendYTD: number;
  health: number;
  nextService: string;
  nextServiceAt?: string | null;
}
export interface MaintenanceTool { id: string; _id?: string; name: string; nameAr?: string; kind: 'tool' | 'equipment'; status: 'available' | 'in_use' | 'calibration_due' | 'lost'; assignee?: { _id?: string; name?: string; avatar?: string }; lastCalibratedAt?: string }
export interface MaintenanceSupplier { id: string; _id?: string; name: string; contactName?: string; phone?: string; partsCategories: string[]; partsCategoriesAr?: string[]; rating: number; leadTimeDays: number; lastOrderAt?: string }
export interface MaintenanceAuditLogEntry { id: string; _id?: string; actor?: { _id?: string; name?: string; email?: string; avatar?: string }; action: string; resource: string; resourceId: string; oldValue?: Record<string, unknown>; newValue?: Record<string, unknown>; createdAt: string }

export interface ApiMaintenanceShop {
  _id: string;
  id?: string;
  nameEn: string;
  nameAr?: string;
  descriptionEn?: string;
  descriptionAr?: string;
  /**
   * Normal maintenance or a boat ramp. Absent on every shop approved before
   * the field existed — all of which are workshops — so read it as
   * `serviceType === 'boat_ramp' ? … : 'maintenance'` rather than trusting it
   * to be set.
   */
  serviceType?: 'maintenance' | 'boat_ramp';
  serviceCategories: string[];
  region?: string;
  city?: string;
  address?: string;
  latitude: number;
  longitude: number;
  images: string[];
  imagesCategorized: { url: string; category?: string }[];
  contactNumber?: string;
  email?: string;
  website?: string;
  hourlyRateSar?: number;
  inspectionFeeSar?: number;
  emergencyVisitFeeSar?: number;
  approvalStatus?: 'draft' | 'pending' | 'approved' | 'rejected';
  approvalReason?: string;
  rejectionReason?: string;
  approvalReasonAr?: string;
  rejectionReasonAr?: string;
  reviewedBy?: any;
  reviewedAt?: string;
  isPublished?: boolean;
  publishedAt?: string;
  completeness?: any;
  bank?: any;
  operatingHours?: any;
  servicePrices?: { serviceKey: string; label: string; labelAr?: string; priceSar: number }[];
  emergencyContacts?: { name: string; phone: string; kind?: string; kindAr?: string }[];
  emergencyEmail?: string;
  emergencyProceduresText?: string;
  emergencyProceduresTextAr?: string;
  logo?: string;
  isActive: boolean;
}

/**
 * A maintenance shop's readiness, as the admin queue and the shop's own portal
 * both read it. Mirrors `MaintCompletenessReport` in
 * `services/maintCompleteness.service.ts`.
 */
export interface MaintMissingItem {
  id: string;
  title: string;
  category: 'identity' | 'location' | 'media' | 'pricing' | 'staff' | 'specs' | 'safety' | 'finance';
  severity: 'critical' | 'warning';
  description: string;
  fixUrl: string;
  actionLabel: string;
}

export interface MaintCompletenessReport {
  score: number;
  isComplete: boolean;
  criticalCount: number;
  warningCount: number;
  totalChecks: number;
  passedChecks: number;
  missingItems: MaintMissingItem[];
  stats: { servicesCount: number; techniciansCount: number; imagesCount: number };
}

/** A row of `GET /admin-portal/maint-shop-approvals`. */
export interface AdminMaintShopApproval extends ApiMaintenanceShop {
  provider?: { _id?: string; name?: string; email?: string; avatar?: string; business?: { businessName?: string } };
  completeness?: MaintCompletenessReport;
  createdAt?: string;
}

export const maintenanceShopApi = {
  mine: () => get<Ok<{ shop: ApiMaintenanceShop; completeness?: any }>>('/maintenance-portal/shop'),
  update: (patchBody: Partial<ApiMaintenanceShop>) => patch<Ok<{ shop: ApiMaintenanceShop; completeness?: any }>>('/maintenance-portal/shop', patchBody),
  submitForApproval: () => post<Ok<{ shop: ApiMaintenanceShop; completeness: any; message: string }>>('/maintenance-portal/shop/submit-for-approval'),
  publish: () => post<Ok<{ shop: ApiMaintenanceShop; completeness: any; message: string }>>('/maintenance-portal/shop/publish'),
  unpublish: () => post<Ok<{ shop: ApiMaintenanceShop; completeness: any; message: string }>>('/maintenance-portal/shop/unpublish'),
  uploadImages: (files: File[], category?: string) => {
    const fd = new FormData();
    files.forEach((f) => fd.append('images', f));
    if (category) fd.append('category', category);
    return post<Ok<{ images: string[]; imagesCategorized: { url: string; category?: string }[] }>>('/maintenance-portal/shop/images', fd);
  },
  deleteImage: (url: string) =>
    del<Ok<{ images: string[]; imagesCategorized: { url: string; category?: string }[] }>>(`/maintenance-portal/shop/images${qs({ url })}`),
};

export const maintenancePortalApi = {
  dashboard: (options?: ApiRequestOptions) => get<Ok<MaintenanceOverview>>('/maintenance-portal/dashboard', undefined, options),
  requests: (params?: Record<string, string | number | boolean | undefined>) => get<Ok<Paginated<MaintenanceProviderRequest>>>('/maintenance-portal/requests', params),
  customers: (params?: Record<string, string | number | boolean | undefined>) => get<Ok<{ customers: MaintenanceCustomer[] }>>('/maintenance-portal/customers', params),
  createManualRequest: (body: Record<string, unknown>) => post<Ok<{ request: MaintenanceProviderRequest }>>('/maintenance-portal/requests/manual', body),
  updateRequest: (id: string, body: Partial<MaintenanceProviderRequest>) => patch<Ok<{ request: MaintenanceProviderRequest }>>(`/maintenance-portal/requests/${id}`, body),
  /**
   * Ask the owner to move a job, and take the ask back.
   *
   * Distinct from `updateRequest`, which CAN write `preferredDate` directly.
   * That path moves a time the owner agreed to without asking them, so it is no
   * longer the only one: this stores a proposal, leaves the booking where it is,
   * and the owner accepts or declines from their app.
   *
   * There is no `respond` here on purpose — answering is the owner's, on a
   * customer-scoped route this portal has no business calling.
   */
  proposeReschedule: (id: string, body: { proposedStartAt: string; proposedSlot: string; reason?: string }) =>
    patch<Ok<{ request: MaintenanceProviderRequest }>>(`/maintenance-portal/requests/${id}/reschedule-proposal`, body),
  withdrawReschedule: (id: string) =>
    patch<Ok<{ request: MaintenanceProviderRequest }>>(`/maintenance-portal/requests/${id}/reschedule-proposal/withdraw`, {}),
  workOrders: (params?: Record<string, string | number | boolean | undefined>) => get<Ok<Paginated<MaintenanceWorkOrder>>>('/maintenance-portal/work-orders', params),
  createWorkOrder: (body: Record<string, unknown>) => post<Ok<{ workOrder: MaintenanceWorkOrder }>>('/maintenance-portal/work-orders', body),
  updateWorkOrder: (id: string, body: Record<string, unknown>) => patch<Ok<{ workOrder: MaintenanceWorkOrder }>>(`/maintenance-portal/work-orders/${id}`, body),
  sendPaymentReminder: (id: string) => post<Ok<{ message: string }>>(`/maintenance-portal/work-orders/${id}/remind-payment`, {}),
  technicians: () => get<Ok<{ technicians: MaintenanceTechnician[] }>>('/maintenance-portal/technicians'),
  createTechnician: (body: Record<string, unknown>) => post<Ok<{ technician: MaintenanceTechnician }>>('/maintenance-portal/technicians', body),
  updateTechnician: (id: string, body: Record<string, unknown>) => patch<Ok<{ technician: MaintenanceTechnician }>>(`/maintenance-portal/technicians/${id}`, body),
  /**
   * Roles — the trades this workshop staffs. A technician's `skills` are derived
   * from the roles they hold, so this is where a trade is actually defined:
   * its category (which shelf a customer browses it under), the keywords they
   * will find it by, and the rate a new holder starts at.
   */
  listRoles: (params?: { includeInactive?: boolean }) =>
    get<Ok<{ roles: MaintenanceRoleData[] }>>('/maintenance-portal/roles', params),
  createRole: (body: { name: string; category: string; keywords?: string[]; defaultHourlyRate: number }) =>
    post<Ok<{ role: MaintenanceRoleData }>>('/maintenance-portal/roles', body),
  updateRole: (id: string, body: Record<string, unknown>) =>
    patch<Ok<{ role: MaintenanceRoleData }>>(`/maintenance-portal/roles/${id}`, body),
  deleteRole: (id: string) => del<Ok<{ role: MaintenanceRoleData }> & { message?: string }>(`/maintenance-portal/roles/${id}`),
  /** Technician photo. Multipart, so it is its own endpoint rather than a field on `updateTechnician`. */
  uploadTechnicianAvatar: (id: string, file: File) => {
    const fd = new FormData();
    fd.append('avatar', file);
    return patch<Ok<{ technician: MaintenanceTechnician }>>(`/maintenance-portal/technicians/${id}/avatar`, fd);
  },
  parts: () => get<Ok<{ parts: MaintenancePart[]; lowStock: MaintenancePart[] }>>('/maintenance-portal/parts'),
  createPart: (body: Record<string, unknown>) => post<Ok<{ part: MaintenancePart }>>('/maintenance-portal/parts', body),
  updatePart: (id: string, body: Record<string, unknown>) => patch<Ok<{ part: MaintenancePart }>>(`/maintenance-portal/parts/${id}`, body),
  invoices: (params?: Record<string, string | number | boolean | undefined>) => get<Ok<Paginated<MaintenanceInvoice>>>('/maintenance-portal/invoices', params),
  createInvoice: (body: Record<string, unknown>) => post<Ok<{ invoice: MaintenanceInvoice }>>('/maintenance-portal/invoices', body),
  updateInvoice: (id: string, body: Record<string, unknown>) => patch<Ok<{ invoice: MaintenanceInvoice }>>(`/maintenance-portal/invoices/${id}`, body),
  /** Returns money on a paid invoice — through the gateway, or recorded for a desk payment. Omit `amount` for everything refundable. */
  refundInvoice: (id: string, body: { amount?: number; reason?: string }) =>
    post<Ok<{ invoice: MaintenanceInvoice; refund: { amountSar: number; refundedSar: number; refundableSar: number; settlementBusinessDays: { min: number; max: number } } }>>(`/maintenance-portal/invoices/${id}/refund`, body),
  generatePaymentQr: (id: string) => get<Ok<{ qrDataUrl: string; payUrl: string; reference: string; amount: number; currency: string }>>(`/maintenance-portal/invoices/${id}/payment-qr`),
  inspections: (params?: Record<string, string | number | boolean | undefined>) => get<Ok<Paginated<MaintenanceInspection>>>('/maintenance-portal/inspections', params),
  createInspection: (body: Record<string, unknown>) => post<Ok<{ inspection: MaintenanceInspection }>>('/maintenance-portal/inspections', body),
  updateInspection: (id: string, body: Record<string, unknown>) => patch<Ok<{ inspection: MaintenanceInspection }>>(`/maintenance-portal/inspections/${id}`, body),

  // Booking rules — what days and times customers can request.
  // `vatRatePct` is the platform VAT rate, read-only — the workshop can see
  // what its invoices will charge but cannot set it (the PATCH ignores it).
  settings: () => get<Ok<{ settings: MaintenanceSettings; vatRatePct: number }>>('/maintenance-portal/settings'),
  updateSettings: (body: Partial<MaintenanceSettings>) =>
    patch<Ok<{ settings: MaintenanceSettings }>>('/maintenance-portal/settings', body),

  // Team & access
  myAccess: () => get<Ok<ApiMaintAccess>>('/maintenance-portal/my-access'),
  inviteTechnician: (id: string, permissions: MaintenanceWorkerPermission[]) =>
    post<Ok<{ technician: MaintenanceTechnician; devInviteToken?: string }>>(`/maintenance-portal/technicians/${id}/invite`, { permissions }),
  resendTechnicianInvite: (id: string) => post<Ok<{ devInviteToken?: string }>>(`/maintenance-portal/technicians/${id}/resend-invite`),
  updateTechnicianAccess: (id: string, permissions: MaintenanceWorkerPermission[]) =>
    patch<Ok<{ technician: MaintenanceTechnician }>>(`/maintenance-portal/technicians/${id}/access`, { permissions }),
  setTechnicianAccountStatus: (id: string, status: 'active' | 'disabled') =>
    patch<Ok<{ technician: MaintenanceTechnician }>>(`/maintenance-portal/technicians/${id}/account-status`, { status }),

  // Service catalogue — the shop's own advertised services.
  serviceCatalogue: () => get<Ok<{ items: MaintenanceServiceCatalogItem[] }>>('/maintenance-portal/service-catalogue'),
  createServiceCatalogueItem: (body: Record<string, unknown>) => post<Ok<{ item: MaintenanceServiceCatalogItem }>>('/maintenance-portal/service-catalogue', body),
  updateServiceCatalogueItem: (id: string, body: Record<string, unknown>) => patch<Ok<{ item: MaintenanceServiceCatalogItem }>>(`/maintenance-portal/service-catalogue/${id}`, body),
  deleteServiceCatalogueItem: (id: string) => del<Ok<null>>(`/maintenance-portal/service-catalogue/${id}`),

  // Warranties
  warranties: () => get<Ok<{ warranties: MaintenanceWarranty[] }>>('/maintenance-portal/warranties'),
  createWarranty: (body: Record<string, unknown>) => post<Ok<{ warranty: MaintenanceWarranty }>>('/maintenance-portal/warranties', body),
  updateWarranty: (id: string, body: Record<string, unknown>) => patch<Ok<{ warranty: MaintenanceWarranty }>>(`/maintenance-portal/warranties/${id}`, body),
  deleteWarranty: (id: string) => del<Ok<null>>(`/maintenance-portal/warranties/${id}`),

  // Service history & derived boat health
  history: (params?: Record<string, string | number | boolean | undefined>) => get<Ok<Paginated<MaintenanceServiceHistoryEntry>>>('/maintenance-portal/history', params),
  createHistoryEntry: (body: Record<string, unknown>) => post<Ok<{ entry: MaintenanceServiceHistoryEntry }>>('/maintenance-portal/history', body),
  updateHistoryEntry: (id: string, body: Record<string, unknown>) => patch<Ok<{ entry: MaintenanceServiceHistoryEntry }>>(`/maintenance-portal/history/${id}`, body),
  deleteHistoryEntry: (id: string) => del<Ok<null>>(`/maintenance-portal/history/${id}`),
  boatHealth: (boatName: string) => get<Ok<BoatHealth>>('/maintenance-portal/boat-health', { boatName }),
  fleetAccounts: () => get<Ok<{ fleetAccounts: ApiFleetAccount[] }>>('/maintenance-portal/fleet-accounts'),
  createFleetAccount: (body: { company: string; boatNames?: string[]; contract: string; status?: ApiFleetAccount['status'] }) => post<Ok<{ fleetAccount: ApiFleetAccount }>>('/maintenance-portal/fleet-accounts', body),
  updateFleetAccount: (id: string, body: Partial<{ company: string; boatNames: string[]; contract: string; status: ApiFleetAccount['status'] }>) => patch<Ok<{ fleetAccount: ApiFleetAccount }>>(`/maintenance-portal/fleet-accounts/${id}`, body),
  removeFleetAccount: (id: string) => del<Ok<unknown>>(`/maintenance-portal/fleet-accounts/${id}`),

  // Tools & equipment
  tools: () => get<Ok<{ tools: MaintenanceTool[] }>>('/maintenance-portal/tools'),
  createTool: (body: Record<string, unknown>) => post<Ok<{ tool: MaintenanceTool }>>('/maintenance-portal/tools', body),
  updateTool: (id: string, body: Record<string, unknown>) => patch<Ok<{ tool: MaintenanceTool }>>(`/maintenance-portal/tools/${id}`, body),
  deleteTool: (id: string) => del<Ok<null>>(`/maintenance-portal/tools/${id}`),

  // Suppliers
  suppliers: () => get<Ok<{ suppliers: MaintenanceSupplier[] }>>('/maintenance-portal/suppliers'),
  createSupplier: (body: Record<string, unknown>) => post<Ok<{ supplier: MaintenanceSupplier }>>('/maintenance-portal/suppliers', body),
  updateSupplier: (id: string, body: Record<string, unknown>) => patch<Ok<{ supplier: MaintenanceSupplier }>>(`/maintenance-portal/suppliers/${id}`, body),
  deleteSupplier: (id: string) => del<Ok<null>>(`/maintenance-portal/suppliers/${id}`),

  // Audit log — read-only; MaintEngage.tsx's Audit Log page still needs wiring to this.
  auditLog: (params?: Record<string, string | number | boolean | undefined>) => get<Ok<Paginated<MaintenanceAuditLogEntry>>>('/maintenance-portal/audit-log', params),
};

// ---------------------------------------------------------------------------
// Super-admin portal
// ---------------------------------------------------------------------------
export interface AdminPortalUser extends ApiUser {
  isActive: boolean
  createdAt: string
  /** When the phone number was proven by OTP — a customer's verification. */
  phoneVerifiedAt?: string
}

/** What one person has actually bought — real figures, netted for refunds. */
export interface AdminUserStats {
  bookings: number
  /** Lifetime spend in the settlement currency, after refunds. */
  spend: number
  /** ISO date of their most recent charge, or null if they have never paid. */
  lastOrderAt: string | null
}
export interface AdminWorkerApproval {
  id: string;
  kind: 'marina' | 'maintenance' | 'fuel' | 'boat';
  name: string;
  email?: string;
  role: string;
  providerName: string;
  /** Where they work: a crew member's boats, a station, a marina. */
  location?: string;
  status: WorkerApprovalStatus;
  rejectionReason?: string;
  createdAt: string;
}

export interface ApiVendor {
  _id: string;
  id?: string;
  name: string;
  category: 'spare_parts' | 'cleaning' | 'rescue' | 'provisioning' | 'media' | 'other';
  icon: string;
  status: 'approved' | 'pending' | 'suspended';
  rating: number;
  revenueTotal: number;
  commissionPct: number;
  branches: number;
  docsStatus: 'complete' | 'missing';
  createdAt: string;
  updatedAt: string;
}

/** The real platform-wide SOS record — a customer-triggered emergency, not scoped to one marina. */
export interface ApiAdminEmergency {
  _id: string;
  id?: string;
  type: 'sos' | 'medical' | 'coast_guard';
  latitude: number;
  longitude: number;
  message?: string;
  status: 'active' | 'responding' | 'resolved';
  user?: { name?: string; avatar?: string; email?: string; phone?: string } | string;
  resolvedBy?: { name?: string } | string;
  resolvedAt?: string;
  createdAt: string;
}

export interface ApiCoupon {
  _id: string;
  code: string;
  description?: string;
  discountPct: number;
  maxDiscount?: number;
  scope: 'all' | 'dock' | 'trip' | 'fuel' | 'service';
  applicableTripId?: string;
  expiresAt?: string;
  usageLimit?: number;
  usedCount: number;
  perUserLimit: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
export const couponsApi = {
  list: (params?: { page?: number; limit?: number }) => get<Ok<Paginated<ApiCoupon>>>('/coupons', params),
  create: (data: {
    code: string;
    description?: string;
    discountPct: number;
    maxDiscount?: number;
    scope?: ApiCoupon['scope'];
    applicableTripId?: string;
    expiresAt?: string;
    usageLimit?: number;
    perUserLimit?: number;
    isActive?: boolean;
  }) => post<Ok<{ coupon: ApiCoupon }>>('/coupons', data),
  update: (id: string, data: Partial<{
    code: string;
    description: string;
    discountPct: number;
    maxDiscount: number;
    scope: ApiCoupon['scope'];
    expiresAt: string;
    usageLimit: number;
    perUserLimit: number;
    isActive: boolean;
  }>) => patch<Ok<{ coupon: ApiCoupon }>>(`/coupons/${id}`, data),
  remove: (id: string) => del<Ok<{ coupon?: ApiCoupon }>>(`/coupons/${id}`),
  usageAnalytics: () =>
    get<Ok<{ stats: { couponId: string; code: string; scope: string; redemptions: number; totalDiscount: number }[] }>>(
      '/coupons/analytics/usage'
    ),
};

export interface ApiKycDocument {
  _id: string;
  owner: { _id: string; name: string; email?: string; phone?: string; role?: string; avatar?: string } | string;
  docType: string;
  fileUrl: string;
  fileName?: string;
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason?: string;
  expiresAt?: string;
  providerType?: 'marina_provider' | 'fuel_provider' | 'maintenance_provider';
  createdAt: string;
}

/** Provider types with a document checklist. Scuba divers are exempt by design and never listed. */
export type DocumentedProviderType = 'boat_provider' | 'marina_provider' | 'fuel_provider' | 'maintenance_provider';

/** One provider type's checklist. A document in neither list is not asked for. */
export interface DocRequirementRule {
  required: string[];
  optional: string[];
}

/** One checklist slot for one applicant, as the reviewer sees it. */
export interface ApiApplicantDocSlot {
  docType: string;
  label: string;
  status: 'missing' | 'pending' | 'approved' | 'rejected';
}

export interface ApiApplicantDocChecklist {
  required: ApiApplicantDocSlot[];
  optional: ApiApplicantDocSlot[];
  /** Required slots with nothing acceptable on file — missing or rejected. */
  outstanding: string[];
}

/** Admin → Required documents: the live rules, the catalogue they pick from, and the defaults. */
export interface ApiDocRequirements {
  providerTypes: DocumentedProviderType[];
  catalogue: {
    docType: string;
    label: string;
    description?: string;
    group: 'identity' | 'business' | 'crew' | 'boat';
    /** The catalogue says a person should check this type, not the automated reading alone. */
    reviewRecommended?: boolean;
  }[];
  rules: Record<DocumentedProviderType, DocRequirementRule>;
  defaults: Record<DocumentedProviderType, DocRequirementRule>;
  /** Types the admin has saved; the rest are on the defaults. */
  customised: DocumentedProviderType[];
  /** Per document type: does a clean automated reading approve the upload without a person? */
  autoApprove: Record<string, boolean>;
  updatedAt?: string;
}

/** Admin → Testing tools: the switches, with who last changed them. */
export interface ApiTestingTools {
  fakeFillEnabled: boolean;
  updatedAt?: string;
  updatedBy?: { _id: string; name?: string; email?: string } | null;
}

export const testingToolsApi = {
  /**
   * Public — the signup form asks before there is a token. Silent, because a
   * failed read only means the button stays hidden.
   */
  get: () => request<Ok<{ fakeFillEnabled: boolean }>>('/testing-tools', { silent: true }),
  /** Admin: the switches plus who last changed them. */
  adminGet: () => get<Ok<ApiTestingTools>>('/testing-tools/admin'),
  /** Admin: switch the "Fake fill" button on the provider signup forms on or off. */
  update: (data: { fakeFillEnabled: boolean }) => patch<Ok<ApiTestingTools>>('/testing-tools', data),
};

// ---------------------------------------------------------------------------
// Curated vessel / trip / equipment lists — the admin side of "Request a new type".
// ---------------------------------------------------------------------------
export type TaxonomyListType =
  | 'boat_category'
  | 'trip_type'
  | 'engine_type'
  | 'hull_material'
  | 'navigation_equipment'
  | 'safety_equipment'

export type HullFormKey = 'power' | 'sail' | 'multihull' | 'pwc'

export interface ApiTaxonomyRow {
  _id: string
  type: TaxonomyListType
  key: string
  labelEn: string
  labelAr: string
  description?: string
  hullForm?: HullFormKey
  status?: 'pending' | 'approved' | 'rejected'
  isActive: boolean
  isCustom: boolean
  reviewNote?: string
  reviewedAt?: string
  createdAt: string
  createdBy?: { _id: string; name?: string; email?: string; role?: string; business?: { businessName?: string } } | string
}

export interface ApiTaxonomyManaged {
  /** Present on approved additions only (built-ins live in code). */
  id?: string
  key: string
  labelEn: string
  labelAr: string
  source: 'built_in' | 'approved'
  isActive: boolean
  logoUrl?: string
  hullForm?: HullFormKey
  /** Boats (or trips) currently using it. */
  usage: number
}

export const taxonomyAdminApi = {
  /** pending = the request queue · approved = additions in the shared list · rejected = declined requests. */
  list: (status: 'pending' | 'approved' | 'rejected') =>
    get<Ok<{ items: ApiTaxonomyRow[]; counts: { pending: number } }>>('/content/taxonomy/requests', { status }),
  approve: (id: string, data: { labelEn: string; labelAr: string; key?: string; hullForm?: HullFormKey }) =>
    patch<Ok<{ item: ApiTaxonomyRow }>>(`/content/taxonomy/requests/${id}/approve`, data),
  reject: (id: string, reason: string) =>
    patch<Ok<{ item: ApiTaxonomyRow }>>(`/content/taxonomy/requests/${id}/reject`, { reason }),
  /** Retire (hide) or restore an approved addition. */
  setActive: (id: string, isActive: boolean) => patch<Ok<{ item: ApiTaxonomyRow }>>(`/content/taxonomy/${id}/active`, { isActive }),
  /** Built-in entries and approved additions together, with logo, hull form and usage. */
  manage: (type: 'boat_category' | 'trip_type') =>
    get<Ok<{ type: string; items: ApiTaxonomyManaged[] }>>('/content/taxonomy/manage', { type }),
  /** A transparent PNG, prepared (background removed, trimmed) in the browser. */
  uploadLogo: (type: 'boat_category' | 'trip_type', key: string, png: Blob) => {
    const fd = new FormData()
    fd.append('type', type)
    fd.append('key', key)
    fd.append('logo', png, `${key}.png`)
    return post<Ok<{ type: string; key: string; logoUrl: string }>>('/content/taxonomy/logo', fd)
  },
  removeLogo: (type: 'boat_category' | 'trip_type', key: string) =>
    del<Ok<{ type: string; key: string }>>(`/content/taxonomy/logo?type=${type}&key=${encodeURIComponent(key)}`),
  /** An admin adding an entry directly — answers `exists` when the list already has it. */
  create: (data: { type: TaxonomyListType; labelEn: string; labelAr?: string; hullForm?: HullFormKey }) =>
    post<Ok<{ status: 'exists' | 'approved'; match?: { key: string; labelEn: string; labelAr: string }; item?: ApiTaxonomyRow }>>('/content/taxonomy', data),
}

export const documentsApi = {
  /** Admin: which documents each provider type is asked for. */
  requirements: () => get<Ok<ApiDocRequirements>>('/documents/requirements'),
  /**
   * Admin: change the checklist for the provider types named (`null` puts a type
   * back on the defaults) and/or automatic approval for the document types named.
   * Each rule is sent whole, so two admins cannot interleave edits inside one
   * provider type's list.
   */
  updateRequirements: (changes: {
    rules?: Partial<Record<DocumentedProviderType, DocRequirementRule | null>>;
    autoApprove?: Record<string, boolean>;
  }) => put<Ok<ApiDocRequirements>>('/documents/requirements', changes),
  pending: (params?: { limit?: number; page?: number }) => get<Ok<Paginated<ApiKycDocument>>>('/documents/pending', params),
  all: (params?: { limit?: number; page?: number; status?: string }) => get<Ok<Paginated<ApiKycDocument>>>('/documents/all', params),
  verify: (id: string, body: { status: 'approved' | 'rejected'; rejectionReason?: string }) =>
    patch<Ok<{ document: ApiKycDocument }>>(`/documents/${id}/verify`, body),
  /** Admin: ask the holder to upload this one again, with a reason. Not a rejection. */
  requestReupload: (id: string, message: string) =>
    post<Ok<{ document: ApiUploadedDocument }>>(`/documents/${id}/remind`, { message }),
  /** Owner: "I have read the warnings on my own upload, submit it anyway." */
  acknowledge: (id: string, note?: string) =>
    post<Ok<{ document: ApiUploadedDocument }>>(`/documents/${id}/acknowledge`, note ? { note } : {}),
};

export interface CrossValidationCheck {
  rule: string;
  target: string;
  status: 'match' | 'mismatch' | 'unverifiable';
  detail: string;
  expected?: string;
  actual?: string;
}

export interface CrossValidationResult {
  passed: boolean;
  score: number;
  checks: CrossValidationCheck[];
  flags: string[];
}

export interface FraudSignal {
  code: string;
  severity: 'info' | 'warning' | 'critical';
  detail: string;
  weight: number;
}

export interface AIDocument {
  id?: string;
  _id?: string;
  fileUrl: string;
  fileName?: string;
  docType: string;
  declaredType?: string;
  status: 'queued' | 'analyzing' | 'analyzed' | 'needs_review' | 'approved' | 'rejected' | 'failed';
  failureReason?: string;
  fields: { key: string; label: string; value: string; confidence: number }[];
  missingFields: { key: string; label: string; required: boolean }[];
  validation: {
    code: string
    severity: 'info' | 'warning' | 'critical'
    message: string
    source?: 'model' | 'rules'
    /** Why the reading concluded this — what it read, and what it compared. */
    explanation?: string
  }[];
  mimeType?: string;
  identity?: {
    scheme?: string
    verified?: boolean
    checks?: { name: string; status: string; detail: string }[]
  };
  confidence?: { overall: number; classification?: number; requiredFieldsMean?: number };
  crossValidation?: CrossValidationResult;
  fraud?: {
    score: number;
    level: 'low' | 'medium' | 'high' | 'critical';
    signals: FraudSignal[];
  };
  analysis?: {
    ocrText?: string;
    legibility?: number;
    languages?: string[];
    notes?: string;
    modelId?: string;
    latencyMs?: number;
    inputTokens?: number;
    outputTokens?: number;
    analyzedAt?: string;
  };
  expiry?: {
    issuedAt?: string;
    expiresAt?: string;
    status: 'valid' | 'expiring_soon' | 'expired' | 'no_expiry' | 'unknown';
    daysRemaining?: number;
  };
  compliance?: { score: number; level: string; deductions: { reason: string; points: number }[] };
  renewal?: { status: string; autoRenew: boolean; dueAt?: string };
  createdAt: string;
  owner?: { _id: string; name: string; email?: string; phone?: string; avatar?: string; role?: string } | string;
  review?: {
    reviewedBy?: string;
    reviewedAt?: string;
    decision?: 'approved' | 'rejected';
    reason?: string;
  };
}

export interface VaultSummary {
  total: number;
  verifiedCount: number;
  needsReviewCount: number;
  expiringSoonCount: number;
  expiredCount: number;
  complianceScore: number;
}

export interface VaultCategoryGroup {
  category: 'vessel_ownership' | 'insurance' | 'licenses_permits' | 'safety_customs' | 'identity';
  label: string;
  docTypes: string[];
  documents: AIDocument[];
}

export interface MarinaRequirementItem {
  docType: string;
  label: string;
  description: string;
  required: boolean;
  status: 'verified' | 'suggested' | 'flagged' | 'expired' | 'missing';
  matchedDocument?: AIDocument;
  reason?: string;
}

export interface MarinaRequirementsEvaluation {
  marinaId: string;
  marinaName: string;
  isEligible: boolean;
  allowManualReview: boolean;
  totalRequired: number;
  satisfiedCount: number;
  missingCount: number;
  flaggedCount: number;
  expiredCount: number;
  requirements: MarinaRequirementItem[];
  suggestedDocumentIds: string[];
}

export const aiDocumentApi = {
  /** `providerType` narrows to one vertical's accounts. `limit` is capped at 100 by the API. */
  list: (params?: { status?: string; docType?: string; owner?: string; providerType?: string; expiring?: 'true'; page?: number; limit?: number }) =>
    get<Ok<Paginated<AIDocument>>>('/ai-documents', params),
  my: (params?: { status?: string; docType?: string; expiring?: 'true'; page?: number; limit?: number }) =>
    get<Ok<Paginated<AIDocument>>>('/ai-documents/my', params),
  detail: (id: string) => get<Ok<{ document: AIDocument }>>(`/ai-documents/${id}`),
  get: (id: string) => get<Ok<{ document: AIDocument }>>(`/ai-documents/${id}`),
  review: (id: string, decision: 'approved' | 'rejected', reason?: string) =>
    patch<Ok<{ document: AIDocument }>>(`/ai-documents/${id}/review`, { decision, reason }),
  vault: (boatId?: string) =>
    get<Ok<{ summary: VaultSummary; categories: VaultCategoryGroup[]; documents: AIDocument[] }>>(
      '/ai-documents/vault',
      boatId ? { boat: boatId } : undefined
    ),
  bookingRequirements: (marinaId: string, boatId?: string) =>
    get<Ok<MarinaRequirementsEvaluation>>(
      `/ai-documents/booking-requirements/${marinaId}`,
      boatId ? { boat: boatId } : undefined
    ),
  upload: (file: File, declaredType?: string, boatId?: string) => {
    const fd = new FormData();
    fd.append('file', file);
    if (declaredType) fd.append('declaredType', declaredType);
    if (boatId) fd.append('boat', boatId);
    return post<Ok<{ document: AIDocument; analysis: string }>>('/ai-documents', fd);
  },
  attachToBooking: (bookingId: string, documentIds: string[]) =>
    post<Ok<{ booking: any }>>(`/berth-bookings/${bookingId}/documents`, { documentIds }),
  reviewBookingDocument: (bookingId: string, docType: string, decision: 'approved' | 'rejected', reason?: string) =>
    patch<Ok<{ booking: any }>>(`/berth-bookings/${bookingId}/documents/${docType}/review`, { decision, reason }),
};

export const adminPortalApi = {
  /**
   * `range` bounds the flow figures — revenue, bookings, peak hours, locations.
   * Inventory counts stay all-time. Accepts '24h' | '7d' | '30d' | '12mo' |
   * 'ytd' | 'all'; the response echoes the window it applied.
   */
  dashboard: (range?: string) => get<Ok<any>>('/admin-portal/dashboard', range && range !== 'all' ? { range } : undefined),
  /**
   * Live figures for the console chrome. Deliberately small: only what the
   * platform actually measures, which is why there is no error rate or region
   * count here.
   */
  platformPulse: () =>
    get<Ok<{ onlineNow: number; activeProviders: number; pendingApprovals: number; processUptimeSeconds: number }>>(
      '/admin-portal/platform-pulse'
    ),
  /** `role` scopes the trend to one vertical's providers, like its other revenue figures. */
  revenueTrend: (type?: string, role?: string) => get<Ok<{ months: { _id: { y: number; m: number }; gross: number; commission: number; count: number }[] }>>('/admin-portal/revenue-trend', type || role ? { ...(type ? { type } : {}), ...(role ? { role } : {}) } : undefined),
  /**
   * Pass `withStats: true` to get real per-user purchase figures in `stats`,
   * keyed by user id. Empty otherwise — it costs two extra aggregates, so only
   * the screens that display spend ask for it.
   */
  users: (params?: Record<string, string | number | boolean | undefined>) => get<Ok<Paginated<AdminPortalUser> & { roleCounts: Record<string, number>; stats: Record<string, AdminUserStats> }>>('/admin-portal/users', params),
  updateUser: (id: string, body: { isActive?: boolean; onboardingStatus?: string }) => patch<Ok<{ user: AdminPortalUser }>>(`/admin-portal/users/${id}`, body),
  workerApprovals: (status: WorkerApprovalStatus | 'all' = 'pending', kind?: AdminWorkerApproval['kind'] | 'all') =>
    get<Ok<{ items: AdminWorkerApproval[]; total: number }>>('/admin-portal/worker-approvals', {
      status,
      ...(kind && kind !== 'all' ? { kind } : {}),
    }),
  reviewWorker: (kind: AdminWorkerApproval['kind'], id: string, decision: 'approved' | 'rejected', reason?: string) =>
    patch<Ok<{ id: string; kind: string; status: WorkerApprovalStatus }>>(`/admin-portal/worker-approvals/${kind}/${id}`, { decision, reason }),
  // 100, the API's cap — without it the queue served its default of 20.
  fuelStationApprovals: (approvalStatus?: string) =>
    get<Ok<{ stations: any[]; total: number; statusCounts: Record<string, number> }>>('/admin-portal/fuel-station-approvals', { limit: 100, ...(approvalStatus ? { approvalStatus } : {}) }),
  approveFuelStation: (id: string) => patch<Ok<{ station: any }>>(`/admin-portal/fuel-station-approvals/${id}/approve`),
  rejectFuelStation: (id: string, reason: string) => patch<Ok<{ station: any }>>(`/admin-portal/fuel-station-approvals/${id}/reject`, { reason }),
  marinaApprovals: (approvalStatus?: string) =>
    get<Ok<{ marinas: AdminMarinaApproval[]; total: number; statusCounts: Record<string, number> }>>('/admin-portal/marina-approvals', approvalStatus ? { approvalStatus } : undefined),
  approveMarina: (id: string) => patch<Ok<{ marina: AdminMarinaApproval }>>(`/admin-portal/marina-approvals/${id}/approve`),
  rejectMarina: (id: string, reason: string) => patch<Ok<{ marina: AdminMarinaApproval }>>(`/admin-portal/marina-approvals/${id}/reject`, { reason }),
  payments: (params?: Record<string, string | number | boolean | undefined>) =>
    // `earned`: what was collected in this scope, whatever the status filter.
    get<Ok<Paginated<ApiAdminPayment> & { totals: ApiRevenueTotals; earned?: ApiRevenueTotals }>>(
      '/admin-portal/payments',
      params
    ),
  listings: (params?: Record<string, string | number | boolean | undefined>) => get<Ok<any>>('/admin-portal/listings', params),
  maintenance: (params?: Record<string, string | number | boolean | undefined>) => get<Ok<any>>('/admin-portal/maintenance', params),
  reviews: (params?: Record<string, string | number | boolean | undefined>) => get<Ok<Paginated<ApiReview>>>('/admin-portal/reviews', params),
  removeReview: (id: string) => del<Ok<unknown>>(`/admin-portal/reviews/${id}`),
  /**
   * Hide a review from the public without destroying it — the normal moderation
   * action, and reversible. The reason is required: it is what the author is
   * told and what the audit trail has to be able to show later.
   */
  takedownReview: (id: string, reason: string) =>
    patch<Ok<{ review: ApiReview }>>(`/admin-portal/reviews/${id}/takedown`, { reason }),
  /** Put a taken-down review back, and clear any reports against it. */
  restoreReview: (id: string) => patch<Ok<{ review: ApiReview }>>(`/admin-portal/reviews/${id}/restore`),
  approveReview: (id: string) => patch<Ok<{ review: ApiReview }>>(`/admin-portal/reviews/${id}/approve`),
  flagReview: (id: string, reason?: string) => post<Ok<unknown>>(`/reviews/${id}/report`, { reason }),
  audit: (params?: Record<string, string | number | boolean | undefined>) => get<Ok<any>>('/admin-portal/audit', params),
  plans: () => get<Ok<{ plans: any[] }>>('/admin-portal/plans'),
  createPlan: (body: Record<string, unknown>) => post<Ok<{ plan: any }>>('/admin-portal/plans', body),
  updatePlan: (id: string, body: Record<string, unknown>) => patch<Ok<{ plan: any }>>(`/admin-portal/plans/${id}`, body),
  vendors: (params?: Record<string, string | number | boolean | undefined>) => get<Ok<Paginated<ApiVendor>>>('/admin-portal/vendors', params),
  createVendor: (body: Partial<ApiVendor>) => post<Ok<{ vendor: ApiVendor }>>('/admin-portal/vendors', body),
  updateVendor: (id: string, body: Partial<ApiVendor>) => patch<Ok<{ vendor: ApiVendor }>>(`/admin-portal/vendors/${id}`, body),
  removeVendor: (id: string) => del<Ok<unknown>>(`/admin-portal/vendors/${id}`),
  emergencies: (params?: Record<string, string | number | boolean | undefined>) =>
    get<Ok<Paginated<ApiAdminEmergency> & { statusCounts: Record<string, number> }>>('/admin-portal/emergencies', params),
  // Admin resolves an SOS — hits the existing customer-emergency endpoint (not admin-portal-prefixed).
  resolveEmergency: (id: string) => patch<Ok<{ emergency: ApiAdminEmergency }>>(`/emergency/${id}/resolve`),
  announce: (body: { title: string; body: string; titleAr?: string; bodyAr?: string; role?: string }) => post<Ok<{ recipients: number }>>('/admin-portal/announcements', body),
  reports: () => get<Ok<any>>('/admin-portal/reports'),
  commissionRevenue: (params?: { role?: string }) => get<Ok<{ totals: ApiRevenueTotals; providers: ApiCommissionRevenueRow[] }>>('/admin-portal/revenue/commission', params),
  packageRevenue: (params?: { role?: string }) => get<Ok<ApiPackageRevenue>>('/admin-portal/revenue/packages', params),
  notifications: (params?: { unread?: boolean; page?: number; limit?: number }, options?: ApiRequestOptions) =>
    get<Ok<Paginated<ApiNotification> & { unreadCount: number }>>('/admin-portal/notifications', params, options),
  markNotificationRead: (id: string) => patch<Ok<{ notification: ApiNotification }>>(`/admin-portal/notifications/${id}/read`),
  markAllNotificationsRead: () => patch<Ok<{ ok: boolean }>>('/admin-portal/notifications/read-all'),
  notificationSendStats: () => get<Ok<{ pushSent24h: number; emailsSent24h: number; smsSent24h: number; openRatePct: number }>>('/admin-portal/notifications/send-stats'),
  fraudAlerts: (params?: { status?: string; page?: number; limit?: number }) =>
    get<Ok<Paginated<ApiFraudAlert> & { openCount: number; blockedThisMonth: number; suspiciousReportsFiled: number; kycCompletionPct: number; risk: { score: number; label: 'Low' | 'Medium' | 'High' } }>>('/admin-portal/fraud/alerts', params),
  scanForFraud: () => post<Ok<{ created: number; updated: number }>>('/admin-portal/fraud/scan'),
  updateFraudAlert: (id: string, status: ApiFraudAlert['status']) => patch<Ok<{ alert: ApiFraudAlert }>>(`/admin-portal/fraud/alerts/${id}`, { status }),
  securitySettings: () => get<Ok<{ settings: { key: string; enabled: boolean }[] }>>('/admin-portal/security-settings'),
  updateSecuritySetting: (key: string, enabled: boolean) => patch<Ok<{ setting: { key: string; enabled: boolean } }>>(`/admin-portal/security-settings/${key}`, { enabled }),
  /** `switchable: false` (document reading): listed for its instructions only — it has no on/off switch. */
  aiModules: () => get<Ok<{ modules: { key: string; enabled: boolean; switchable?: boolean; metric: string; instructions?: { prompts: number; customised: number; rules: number } }[] }>>('/admin-portal/ai-modules'),
  /** `handedOff`: open AI chats moved to people when the chat assistant is switched off. */
  updateAIModule: (key: string, enabled: boolean) => patch<Ok<{ module: { key: string; enabled: boolean }; handedOff?: number; reclaimed?: number }>>(`/admin-portal/ai-modules/${key}`, { enabled }),
  aiPrompts: (key: string) => get<Ok<{ prompts: ApiAIPrompt[]; limits: ApiAIPromptLimits }>>(`/admin-portal/ai-modules/${key}/prompts`),
  saveAIPrompt: (key: string, promptId: string, draft: ApiAIPromptDraft) =>
    put<Ok<{ prompt: ApiAIPrompt }>>(`/admin-portal/ai-modules/${key}/prompts/${promptId}`, draft),
  /** The whole prompt an unsaved draft would produce. Stores nothing. */
  previewAIPrompt: (key: string, promptId: string, draft: ApiAIPromptDraft) =>
    post<Ok<{ preview: string }>>(`/admin-portal/ai-modules/${key}/prompts/${promptId}/preview`, draft),
  ads: () => get<Ok<{ ads: ApiAd[] }>>('/admin-portal/ads'),
  createAd: (data: Partial<ApiAd>) => post<Ok<{ ad: ApiAd }>>('/admin-portal/ads', data),
  updateAd: (id: string, data: Partial<ApiAd>) => patch<Ok<{ ad: ApiAd }>>(`/admin-portal/ads/${id}`, data),
  removeAd: (id: string) => del<Ok<unknown>>(`/admin-portal/ads/${id}`),
  updateBoatListing: (id: string, body: { status?: string; featured?: boolean }) => patch<Ok<{ boat: any }>>(`/admin-portal/listings/boat/${id}`, body),
  updateMarinaListing: (id: string, body: { isActive?: boolean }) => patch<Ok<{ marina: any }>>(`/admin-portal/listings/marina/${id}`, body),
  updateFuelStationListing: (id: string, body: { isActive?: boolean; pricePerLiter?: number }) => patch<Ok<{ station: any }>>(`/admin-portal/listings/fuel/${id}`, body),
  updateMaintenanceServiceListing: (id: string, body: { status?: string; priceFrom?: number }) => patch<Ok<{ item: any }>>(`/admin-portal/listings/maintenance-catalogue/${id}`, body),
  refundPayment: (id: string, amount?: number) => post<Ok<{ payment: ApiAdminPayment }>>(`/admin-portal/payments/${id}/refund`, { amount }),
  cancelBookingPayment: (id: string) => post<Ok<{ booking: any }>>(`/admin-portal/payments/${id}/cancel-booking`),
};

export interface ApiAd {
  _id: string;
  name: string;
  advertiser: string;
  slot: 'Homepage Banner' | 'Featured Providers' | 'Sponsored Listings';
  status: 'Running' | 'Paused';
  spend: number;
  impressions: number;
  clicks: number;
  createdAt: string;
}

export interface ApiFraudAlert {
  _id: string;
  kind: 'chargeback_pattern' | 'cancellation_bot' | 'refund_abuse';
  title: string;
  desc: string;
  severity: 'Medium' | 'High' | 'Critical';
  status: 'Open' | 'Investigating' | 'Blocked' | 'Dismissed';
  user?: { _id: string; name: string; email?: string; avatar?: string } | string;
  evidence?: Record<string, unknown>;
  createdAt: string;
}

/** Admin-configured resource caps, keyed by the vocabulary in `packageLimitApi.limitKeys()`. `null` = unlimited. */
export type PackageLimits = Record<string, number | null>;

export interface SubscriptionPackageData {
  _id?: string;
  id?: string;
  providerType: 'boat_provider' | 'marina_provider' | 'fuel_provider' | 'maintenance_provider';
  name: string;
  duration?: string;
  durationMonths?: number;
  price: number;
  description?: string;
  limits?: PackageLimits;
  sortOrder?: number;
  isActive?: boolean;
  /** false = hidden — only selectable via a `PlanInvite` code. */
  isPublic?: boolean;
}

export type CommissionType = 'percentage' | 'fixed';

export interface CommissionPackageData {
  _id?: string;
  id?: string;
  providerType: 'boat_provider' | 'marina_provider' | 'fuel_provider' | 'maintenance_provider';
  name: string;
  commissionType?: CommissionType;
  commissionPercentage?: number;
  /** Flat deduction per completed booking, when commissionType = 'fixed'. */
  fixedAmountSar?: number;
  description?: string;
  limits?: PackageLimits;
  sortOrder?: number;
  isActive?: boolean;
  /** false = hidden — only selectable via a `PlanInvite` code. */
  isPublic?: boolean;
}

export type ProviderTypeKey = 'boat_provider' | 'marina_provider' | 'fuel_provider' | 'maintenance_provider';

/** A provider row in the monetization overview. */
export interface MonetizationProvider {
  id: string;
  name: string;
  email: string;
  businessName: string;
  role: string;
  providerType: ProviderTypeKey;
  paymentModel: 'subscription' | 'commission';
  status: string;
  subscriptionPackage?: SubscriptionPackageData | null;
  commissionPackage?: CommissionPackageData | null;
  subscriptionExpiry?: string | null;
  /** The recorded rate, or `null` when the account has none — never an invented default. */
  commissionRate: number | null;
  /** Which of the three deals — `commission` covers both a percentage and a flat fee. */
  planKind?: PlanKind;
  commissionType?: 'percentage' | 'fixed';
  /** The flat cut per transaction on a fixed-fee plan; 0 otherwise. */
  commissionFixedAmount?: number;
  walletBalance: number;
}

export interface MonetizationStats {
  totalProviders: number;
  subscriptionCount: number;
  commissionCount: number;
  /** Providers on a flat per-transaction fee — a subset of `commissionCount`. */
  fixedFeeCount?: number;
  expiredSubscriptionCount: number;
  totalWalletBalance: number;
  /** Providers with a wallet balance owed, awaiting a manual bank-transfer payout. */
  awaitingPayoutCount: number;
  totalCommissionEarned: number;
  totalGrossVolume: number;
}

/** One provider's monthly settlement line. HyperPay has no payout API, so
 *  payouts are paid by bank transfer off-platform and recorded manually. */
/** Where a provider's payout bank details were found. See `payout.service`. */
export type PayoutBankSource = 'account' | 'registration' | 'marina' | 'fuel_station' | 'maintenance_shop';

export interface Settlement {
  payoutId: string | null;
  providerId: string;
  providerName: string;
  businessName: string;
  providerType: ProviderTypeKey;
  /**
   * Payouts are not a commission-model concern: HyperPay collects every charge
   * on the platform's side whatever plan the provider is on, so a subscription
   * provider's 100% accrues to the same wallet and needs the same transfer.
   */
  billingModel: 'subscription' | 'commission';
  commissionPercentage: number;
  planKind?: PlanKind;
  /** The flat cut per transaction on a fixed-fee plan; 0 otherwise. */
  feePerTransaction?: number;
  walletBalance: number;
  /**
   * Cash commission this provider owes the platform — shown beside the payout,
   * never deducted from it. The two are settled through different instruments,
   * so netting them silently would short-pay a provider who has just cleared
   * their statement.
   */
  commissionOwed: number;
  month: number;
  year: number;
  grossAmount: number;
  commissionAmount: number;
  netAmount: number;
  /** Acquirer fees on this week's refunds, recharged to the provider. */
  refundFeeDeduction?: number;
  /** `netAmount` less the fees — what the bank transfer is actually worth. */
  payableAmount?: number;
  /** The Monday of the settled week. */
  periodStart?: string;
  periodEnd?: string;
  /** How many settled bookings the figures were summed from. */
  transactionCount: number;
  currency: string;
  status: 'pending' | 'approved' | 'paid' | 'rejected' | 'none';
  /** False when there is nowhere to send the money — approval will refuse. */
  bankReady: boolean;
  bankSource: PayoutBankSource | null;
  paidAt?: string;
  approvedAt?: string;
  failureReason?: string;
  /** Bank-transfer reference the admin recorded when marking this paid. */
  payoutReference?: string;
  /** The bank transfer receipt/image uploaded by admin when marked paid. */
  transferProof?: {
    url: string;
    originalName?: string;
    mimeType?: string;
    sizeBytes?: number;
    uploadedAt?: string;
  };
}

export interface PayoutRecord {
  _id: string;
  providerId: string | { _id: string; name: string; email: string; avatar?: string; business?: { businessName?: string } };
  periodStart: string;
  periodEnd: string;
  month: number;
  year: number;
  grossAmount: number;
  commissionAmount: number;
  netAmount: number;
  refundFeeDeduction?: number;
  payableAmount?: number;
  status: 'pending' | 'approved' | 'paid' | 'rejected';
  paidAt?: string;
  approvedAt?: string;
  currency?: string;
  payoutReference?: string;
  transferProof?: {
    url: string;
    originalName?: string;
    mimeType?: string;
    sizeBytes?: number;
    uploadedAt: string;
  };
  failureReason?: string;
  transactionCount?: number;
  bankAccount?: {
    last4?: string;
    bankName?: string;
    accountHolderName?: string;
  };
  createdAt: string;
  updatedAt: string;
}

/** The masked view of a payout account — never the full IBAN. */
export interface PayoutBankView {
  configured: boolean;
  source: PayoutBankSource | null;
  bank: {
    bankName?: string;
    accountHolderName?: string;
    ibanLast4?: string;
    accountNumberLast4?: string;
    swiftCode?: string;
  } | null;
}

export interface PayoutBankInput {
  accountHolderName: string;
  iban?: string;
  accountNumber?: string;
  bankName?: string;
  swiftCode?: string;
  /** Admin only — fix an account on a provider's behalf. */
  providerId?: string;
}

export interface ModelChangeRequest {
  _id: string;
  providerId: { _id: string; name: string; email: string; role: string; business?: { businessName?: string } } | string;
  fromModel?: 'subscription' | 'commission';
  toModel: 'subscription' | 'commission';
  requestedPackageId?: string;
  reason?: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  rejectionReason?: string;
  reviewedAt?: string;
  createdAt: string;
}

export interface FinancialReport {
  period: { from: string; to: string };
  currency: string;
  totals: {
    grossVolume: number; platformCommission: number; providerNet: number; bookings: number;
    subscriptionRevenue: number; subscriptionRenewals: number; platformRevenue: number;
    payoutsPaid: number; payoutCount: number;
  };
  byVertical: { _id: string; gross: number; commission: number; net: number; count: number }[];
  byModel: { _id: string; gross: number; commission: number; count: number }[];
  byProvider: {
    _id: string; gross: number; commission: number; net: number; count: number;
    /** The billing models these transactions were actually charged under. */
    models?: string[];
    /** False when the provider account has been deleted since — the row is orphaned. */
    providerExists?: boolean;
    provider?: { name?: string; email?: string; role?: string; business?: { businessName?: string }; onboarding?: { billingModel?: string } };
  }[];
}

// ---------------------------------------------------------------------------
// Boat provider — listings. The boat_provider role has no web portal
// elsewhere in this app (boat providers otherwise only use the boatpro-provider
// mobile app); this is a minimal self-serve listing surface so the package
// limit engine has somewhere to enforce/display `maxBoats` on the web.
// ---------------------------------------------------------------------------
/**
 * A vessel. Nothing commercial lives here — price, schedule and cancellation
 * terms belong to a Trip built on the boat (see `ApiTrip`), because one hull can
 * back several differently-priced offerings at once.
 */
export interface ApiBoat {
  id: string;
  _id?: string;
  code?: string;
  name: string;
  nameAr?: string;
  logo?: string;
  category: string;
  manufacturer?: string;
  model?: string;
  yearBuilt?: number;
  lengthFt: number;
  capacity: number;
  crewCapacity?: number;
  cabins?: number;
  maxSpeedKn?: number;
  engine?: {
    type?: string;
    count?: number;
    manufacturer?: string;
    model?: string;
    horsepowerHp?: number;
    fuelType?: string;
    engineHours?: number;
  };
  hullMaterial?: string;
  fuelCapacityL?: number;
  vesselLicense?: string;
  registrationNumber?: string;
  turnaroundMinutes?: number;
  description?: string;
  descriptionAr?: string;
  city: string;
  marina: string;
  flag: string;
  status: string;
  visibility?: string;
  images: string[];
  approvalStatus?: 'draft' | 'pending' | 'approved' | 'rejected';
  approvalReason?: string;
  isPublished?: boolean;
  publishedAt?: string;
  completeness?: any;
  documents?: any[];
  safetyEquipment?: string[];
  lifeJacketCount?: number;
  /** Returned by /boats/my so the UI can flag a hull with nothing on sale. */
  tripCounts?: { total: number; active: number };
  createdAt?: string;
}

/** The sellable product, running on one boat. */
export interface ApiTrip {
  id: string;
  code: string;
  boatId: string | { id?: string; _id?: string; name?: string; nameAr?: string; images?: string[]; capacity?: number };
  title: string;
  titleAr?: string;
  tripType: string;
  pricingModel: 'hourly' | 'per_person' | 'package' | 'per_ticket';
  /** Derived from `pricingModel` server-side; never sent by a client. */
  bookingMode: 'exclusive' | 'shared';
  currency?: string;
  basePrice: number;
  /** Promotional rate — available for every pricing model. */
  promoPrice?: number;
  promoStartsAt?: string;
  promoEndsAt?: string;
  promoLabel?: string;
  durationMinutes: number;
  minHours?: number;
  maxHours?: number;
  maxGuests: number;
  minGuests: number;
  status: 'draft' | 'active' | 'paused' | 'archived';
  visibility?: string;
  rating?: number;
  reviewCount?: number;
  bookingCount?: number;
  departureStats?: { upcoming: number; blocked: number; soldOut: number };
  createdAt?: string;
}

/** What the scheduler reports back after generating a trip's departures. */
export interface TripScheduleResult {
  created: number;
  blocked: number;
  unblocked: number;
  removed: number;
  kept: number;
  conflicts: { dateISO: string; startTime: string; reason: string; note?: string }[];
  retainedSoldOut: { dateISO: string; startTime: string; departureId: string }[];
}

export interface ApiTripDeparture {
  id: string;
  dateISO: string;
  startTime: string;
  startAt: string;
  endAt: string;
  status: string;
  capacity: number;
  seatsBooked: number;
  seatsHeld: number;
  remainingSeats?: number;
  blockReason?: string;
  blockNote?: string;
}

export const BOAT_CATEGORIES = ['sailing_boat', 'motorboat', 'yacht', 'jet_ski', 'car_jet', 'sports_jet_boat', 'floating_restaurant', 'water_bus', 'cruise_ship'] as const;
/** Trip types. Named `BOAT_SERVICE_CATEGORIES` historically; these belong to a trip now. */
export const BOAT_SERVICE_CATEGORIES = ['leisure', 'fishing', 'diving', 'water_taxi', 'water_sports', 'travel_recreation', 'dining'] as const;
export const TRIP_PRICING_MODELS = ['hourly', 'per_person', 'package', 'per_ticket'] as const;
export const ENGINE_TYPES = ['outboard', 'inboard', 'sterndrive', 'jet_drive', 'pod_drive', 'sail', 'sail_with_auxiliary', 'electric', 'hybrid'] as const;
export const FUEL_TYPES = ['petrol', 'diesel', 'electric', 'hybrid', 'lpg', 'none'] as const;

/**
 * `exclusive` — one party takes the whole departure. `shared` — separate
 * customers buy seats on the same one. The server's derivation is authoritative;
 * this mirror exists so the UI can label the consequence before saving.
 */
export const BOOKING_MODE_BY_PRICING_MODEL: Record<string, 'exclusive' | 'shared'> = {
  hourly: 'exclusive',
  per_person: 'exclusive',
  package: 'exclusive',
  per_ticket: 'shared',
};

/** What one unit of a trip's rate buys, per pricing model. */
export const RATE_UNIT_LABEL: Record<string, string> = {
  hourly: 'per hour',
  per_person: 'per person',
  package: 'total',
  per_ticket: 'per ticket',
};

export const boatApi = {
  mine: (params?: { page?: number; limit?: number }) => get<Ok<Paginated<ApiBoat>>>('/boats/my', params),
  submitForApproval: (id: string) => post<Ok<{ boat: ApiBoat; completeness: any; message: string }>>(`/boats/${id}/submit-for-approval`),
  publish: (id: string) => post<Ok<{ boat: ApiBoat; completeness: any; message: string }>>(`/boats/${id}/publish`),
  unpublish: (id: string) => post<Ok<{ boat: ApiBoat; completeness: any; message: string }>>(`/boats/${id}/unpublish`),
  create: (data: {
    name: string;
    nameAr?: string;
    category: string;
    lengthFt: number;
    capacity: number;
    crewCapacity?: number;
    cabins?: number;
    maxSpeedKn?: number;
    engine?: { type?: string; count?: number; horsepowerHp?: number; fuelType?: string };
    hullMaterial?: string;
    fuelCapacityL?: number;
    vesselLicense?: string;
    turnaroundMinutes?: number;
    description?: string;
    descriptionAr?: string;
    city: string;
    marina: string;
    flag: string;
  }) => post<Ok<{ boat: ApiBoat }>>('/boats', { ...data, map: { x: 50, y: 50 } }),
  update: (id: string, data: Partial<ApiBoat>) => patch<Ok<{ boat: ApiBoat }>>(`/boats/${id}`, data),
  remove: (id: string) => del<Ok<{ message: string }>>(`/boats/${id}`),
};

export const tripApi = {
  mine: (params?: { page?: number; limit?: number; status?: string; boatId?: string }) =>
    get<Ok<Paginated<ApiTrip>>>('/trips/my', params),
  create: (data: {
    boatId: string;
    title: string;
    titleAr?: string;
    tripType: string;
    pricingModel: string;
    basePrice: number;
    promoPrice?: number;
    durationMinutes: number;
    minHours?: number;
    maxHours?: number;
    maxGuests: number;
    minGuests?: number;
    description?: string;
    descriptionAr?: string;
    status?: string;
    recurrence?: {
      kind: 'dates' | 'weekly';
      dates?: { date: string; startTime?: string }[];
      daysOfWeek?: number[];
      startTimes?: string[];
      seasonStartISO?: string;
      seasonEndISO?: string;
    };
  }) => post<Ok<{ trip: ApiTrip; schedule: TripScheduleResult | null }>>('/trips', data),
  update: (id: string, data: Record<string, unknown>) =>
    patch<Ok<{ trip: ApiTrip; schedule: TripScheduleResult | null }>>(`/trips/${id}`, data),
  remove: (id: string) => del<Ok<{ message: string }>>(`/trips/${id}`),
  regenerateSchedule: (id: string) => post<Ok<{ schedule: TripScheduleResult }>>(`/trips/${id}/schedule`),
  departures: (id: string, params?: { fromISO?: string; toISO?: string }) =>
    get<Ok<{ departures: ApiTripDeparture[] }>>(`/trips/${id}/departures`, params),
};

export const monetizationApi = {
  listSubscriptionPackages: (providerType?: string, activeOnly?: boolean) => get<Ok<{ packages: SubscriptionPackageData[] }>>('/monetization/subscription-packages', { providerType, activeOnly }),
  createSubscriptionPackage: (data: Partial<SubscriptionPackageData>) => post<Ok<{ package: SubscriptionPackageData }>>('/monetization/subscription-packages', data),
  updateSubscriptionPackage: (id: string, data: Partial<SubscriptionPackageData>) => patch<Ok<{ package: SubscriptionPackageData }>>(`/monetization/subscription-packages/${id}`, data),
  deleteSubscriptionPackage: (id: string) => del<Ok<{ message: string }>>(`/monetization/subscription-packages/${id}`),

  listCommissionPackages: (providerType?: string, activeOnly?: boolean) => get<Ok<{ packages: CommissionPackageData[] }>>('/monetization/commission-packages', { providerType, activeOnly }),
  createCommissionPackage: (data: Partial<CommissionPackageData>) => post<Ok<{ package: CommissionPackageData }>>('/monetization/commission-packages', data),
  updateCommissionPackage: (id: string, data: Partial<CommissionPackageData>) => patch<Ok<{ package: CommissionPackageData }>>(`/monetization/commission-packages/${id}`, data),
  deleteCommissionPackage: (id: string) => del<Ok<{ message: string }>>(`/monetization/commission-packages/${id}`),

  overview: (params?: Record<string, string | number | boolean | undefined>) =>
    get<Ok<{ stats: MonetizationStats; providers: MonetizationProvider[] }>>('/monetization/overview', params),
  /** The signed-in provider's own subscription/commission dashboard (plan, usage-adjacent revenue, renewal/payout history). */
  providerDashboard: () => get<Ok<Record<string, any>>>('/monetization/provider-dashboard'),
  renewSubscription: (providerId: string, durationMonths = 1, packageId?: string) => post<Ok<any>>('/monetization/renew-subscription', { providerId, durationMonths, packageId }),
  suspendExpired: () => post<Ok<{ suspendedCount: number }>>('/monetization/suspend-expired'),
  /**
   * One week's payouts, built on demand.
   *
   * `start` is the week's Monday as `YYYY-MM-DD`. Omitted, the server answers
   * for the week just gone — the one there is a decision to make about, since
   * the current week is still accruing. Nothing prepares these on a timer any
   * more: asking is what builds them.
   */
  settlements: (start?: string) =>
    get<Ok<{
      periodStart: string;
      periodEnd: string;
      periodLabel: string;
      /** False while the week is still in progress. */
      periodClosed: boolean;
      settlements: Settlement[];
    }>>('/monetization/settlements', { start }),
  /**
   * Every week still carrying unpaid money, newest first.
   *
   * `settlements` answers for one week; this says which weeks are worth asking
   * about, so the console can offer real ones instead of guessing a Monday.
   */
  settlementPeriods: () =>
    get<Ok<{ periods: { periodStart: string; periodEnd: string; providers: number; payable: number; gross: number; statuses: string[] }[] }>>(
      '/monetization/settlement-periods'
    ),
  /** Freezes the figure and snapshots the destination account. Refuses without one. */
  approvePayout: (id: string) => patch<Ok<{ payout: any }>>(`/monetization/payouts/${id}/approve`),
  /**
   * Records the transfer that paid this out, with the bank's receipt.
   *
   * There is no gateway disbursement API, so this document is the only evidence
   * the money left — and the provider is shown it. The server refuses without
   * one, which is why `proof` is required here rather than optional: a caller
   * that forgets it would get a 400 it could not explain.
   *
   * Sent as multipart; `patch` passes a `FormData` body straight through.
   */
  markPayoutPaid: (id: string, payoutReference: string, proof: File, notes?: string) => {
    const form = new FormData();
    form.append('payoutReference', payoutReference);
    if (notes) form.append('notes', notes);
    form.append('proof', proof);
    return patch<Ok<{ payout: any }>>(`/monetization/payouts/${id}/mark-paid`, form);
  },
  /**
   * A transfer that could not be sent — a bounced IBAN, a compliance hold.
   * The earnings stay in the provider's wallet: a rejected payout is a transfer
   * that has not happened, not money that has been cancelled.
   */
  rejectPayout: (id: string, reason: string) => patch<Ok<{ payout: any }>>(`/monetization/payouts/${id}/reject`, { reason }),
  /** The resolved payout account — own, or admin `?providerId=`. IBAN comes back masked. */
  payoutBank: (providerId?: string) => get<Ok<PayoutBankView>>('/monetization/payout-bank', { providerId }),
  setPayoutBank: (data: PayoutBankInput) => put<Ok<{ bank: PayoutBankView['bank'] }>>('/monetization/payout-bank', data),
  /** Self-serve platform subscription (re)payment — prepares a HyperPay checkout. */
  subscriptionCheckout: (packageId?: string, opts?: CheckoutGatewayChoice) =>
    post<Ok<GatewayCheckoutData & { package: { id: string; name: string; price: number; durationMonths: number } }>>(
      '/monetization/subscription/checkout',
      { packageId, ...opts }
    ),
  confirmSubscriptionPayment: (checkoutId: string, packageId?: string) =>
    post<Ok<{ subscriptionExpiry: string; modelSwitched: boolean }>>('/monetization/subscription/confirm', { checkoutId, packageId }),

  // Renewal history — omit providerId for your own, admin may pass one.
  renewals: (providerId?: string) => get<Ok<{ items: any[]; total: number }>>('/monetization/renewals', { providerId }),

  // Weekly Payout history — returns own payouts for vendors/providers, or all for admin
  payouts: (params?: { page?: number; limit?: number; status?: string; start?: string; providerId?: string }) =>
    get<Ok<{ items: PayoutRecord[]; total: number; byStatus?: Record<string, { net: number; count: number }> }>>('/monetization/payouts', params),

  // Billing-model change requests (provider raises, Super Admin decides).
  listModelChanges: (status?: string) => get<Ok<{ requests: ModelChangeRequest[] }>>('/monetization/model-change', { status }),
  reviewModelChange: (id: string, approve: boolean, rejectionReason?: string, immediate?: boolean) =>
    patch<Ok<{ request: ModelChangeRequest; appliedImmediately: boolean; effectiveAt?: string }>>(
      `/monetization/model-change/${id}`,
      { approve, rejectionReason, immediate }
    ),

  report: (params?: { from?: string; to?: string; paymentModel?: string }) =>
    get<Ok<FinancialReport>>('/monetization/reports', params),
  /**
   * Downloads the Excel report. Goes through fetch rather than a plain link so
   * the Bearer token is sent — the endpoint is admin-only.
   */
  downloadReport: async (params?: { from?: string; to?: string }): Promise<void> => {
    const token = getToken();
    const res = await fetch(`${API_URL}/monetization/reports${qs({ ...params, format: 'xlsx' })}`, {
      headers: { ...TUNNEL_HEADERS, 'Accept-Language': getPortalLanguage(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (!res.ok) throw new Error(`Export failed (${res.status})`);

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `boatpro-financial-report-${params?.from ?? 'all'}_${params?.to ?? 'now'}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};

// ---------------------------------------------------------------------------
// Package limit engine — usage, upgrade/downgrade/cancel, history, settings.
// Shared by all four provider portals; see src/shared/packageLimit.tsx.
// ---------------------------------------------------------------------------

export interface LimitKeyDef {
  key: string;
  label: string;
}

export interface UsageRow {
  key: string;
  label: string;
  usage: number;
  limit: number | null;
}

export interface AvailableAddOn {
  id: string;
  name: string;
  resourceKey: string;
  incrementAmount: number;
  pricePerMonth: number;
}

export interface AddOnTypeData {
  _id?: string;
  id?: string;
  providerType: ProviderTypeKey;
  resourceKey: string;
  name: string;
  incrementAmount: number;
  pricePerMonth: number;
  description?: string;
  descriptionAr?: string;
  isActive: boolean;
}

export interface ProviderAddOnData {
  _id?: string;
  id?: string;
  provider: string;
  addOnType: AddOnTypeData | string;
  resourceKey: string;
  incrementAmount: number;
  pricePaid: number;
  purchasedAt: string;
  status: 'active' | 'cancelled';
}

/**
 * What the platform charges under a plan, normalized by the backend.
 *
 * `fixed_fee` is the invite-link product: a flat cut per transaction, with no
 * commission percentage and no subscription. It is stored on the commission
 * rails (that is where the flat-fee arithmetic already lives) but it is a
 * different deal, and no screen should describe it as a commission.
 */
export type PlanKind = 'fixed_fee' | 'commission' | 'subscription'

export interface PlanSummary {
  kind: PlanKind
  packageId: string
  name: string
  providerType: string
  /** `fixed_fee` — the flat amount taken from every transaction. */
  feePerTransaction?: number
  /** `commission` — percentage points. */
  commissionPercentage?: number
  /** `subscription` — recurring price and period. */
  price?: number
  durationMonths?: number
  label: string
  currency: string
}

export interface PlanInviteData {
  _id?: string;
  id?: string;
  code: string;
  packageType: 'subscription' | 'commission';
  packageId: string;
  maxUses?: number;
  usedCount: number;
  expiresAt?: string;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  /** The full link to hand the provider — built server-side from PORTAL_URL. */
  url?: string;
  /** Resolved server-side; null if the package behind the link is gone. */
  plan?: PlanSummary | null;
}

/** The shape of `err.details` on a 403 whose body is `{ errors: { code: 'PACKAGE_LIMIT_REACHED', ... } }`. */
export interface PackageLimitReachedDetails {
  code: 'PACKAGE_LIMIT_REACHED';
  resource: string;
  resourceLabel?: string;
  currentUsage: number;
  limit: number;
  currentPackage: { id?: string; name?: string; billingModel?: string } | null;
  addOnAvailable: boolean;
  availableAddOns: AvailableAddOn[];
}

export function isPackageLimitError(err: unknown): err is Error & { details: PackageLimitReachedDetails } {
  const details = (err as Error & { details?: unknown } | undefined)?.details as { code?: string } | undefined;
  return details?.code === 'PACKAGE_LIMIT_REACHED';
}

export interface PackageHistoryEntry {
  _id: string;
  providerId: string;
  changeType: string;
  fromBillingModel?: string;
  toBillingModel?: string;
  fromPackageId?: string;
  fromPackageName?: string;
  toPackageId?: string;
  toPackageName?: string;
  amountCharged?: number;
  currency?: string;
  effectiveAt: string;
  status: 'completed' | 'scheduled' | 'failed';
  notes?: string;
  createdAt: string;
}

/** The booking verticals Tamara can be switched on for, per the backend enum. */
export const TAMARA_BOOKING_SURFACES = ['trip', 'berth', 'dock', 'fuel', 'service', 'maintenance'] as const;
/** What the platform bills its own merchants for, as opposed to a booking. */
export const TAMARA_PLATFORM_SURFACES = ['subscription', 'addon', 'addon-req'] as const;
export const TAMARA_SURFACES = [...TAMARA_BOOKING_SURFACES, ...TAMARA_PLATFORM_SURFACES] as const;
export type TamaraSurface = (typeof TAMARA_SURFACES)[number];

/** How each surface is labelled for an admin, who does not think in enum keys. */
export const TAMARA_SURFACE_LABELS: Record<TamaraSurface, { title: string; who: string }> = {
  trip: { title: 'Trip bookings', who: 'Customers booking a trip' },
  berth: { title: 'Berth stays', who: 'Boat operators paying a marina' },
  dock: { title: 'Dock subscriptions', who: 'Boat operators paying a marina' },
  fuel: { title: 'Fuel orders', who: 'Boat operators paying a fuel station' },
  service: { title: 'Marina services', who: 'Customers and operators paying a marina' },
  maintenance: { title: 'Maintenance invoices', who: 'Boat owners paying a workshop' },
  subscription: { title: 'Provider subscriptions', who: 'Providers paying BoatPro' },
  addon: { title: 'Capacity add-ons', who: 'Providers paying BoatPro' },
  'addon-req': { title: 'Custom add-on requests', who: 'Providers paying BoatPro' },
};

/**
 * Which gateway to open a platform-billing checkout with.
 *
 * Omitted means card, which is what every caller did before Tamara existed -
 * so an untouched call site keeps its exact behaviour.
 */
export type CheckoutGatewayChoice = { gateway?: 'hyperpay' | 'tamara'; locale?: 'en' | 'ar' }

/**
 * What a checkout endpoint answers with.
 *
 * `mode: 'tamara'` means the provider must be sent to `checkoutUrl`; anything
 * else is the HyperPay widget flow and carries `hyperpayBaseUrl`. `orderId` is
 * the handle the confirm call needs afterwards, and is what gets stashed
 * against the pending purchase before the browser leaves.
 *
 * `tamaraUnavailable` is present on a card response and says, in words meant
 * for the provider, why instalments were not an option - so the button can be
 * hidden with a reason rather than silently absent.
 */
export interface GatewayCheckoutData {
  mode?: 'tamara'
  checkoutId: string
  entityId?: string
  hyperpayBaseUrl?: string
  testMode?: boolean
  orderId?: string
  checkoutUrl?: string
  amount: number
  currency: string
  tamaraUnavailable?: string | null
}

export interface BillingSettingsData {
  allowImmediateModelSwitch: boolean;
  defaultModelOnCancel: 'commission' | 'none';
  /** Where Tamara (buy now, pay later) is offered. Empty means card only. */
  tamaraSurfaces: TamaraSurface[];
  /** Card processing fee. Unset = the server's env config. `null` in a PATCH clears it. */
  processingFeePct?: number | null;
  processingFeeFixedSar?: number | null;
  processingFeeBearer?: 'platform' | 'provider' | null;
  /** Commission % for a commission provider without a package. Unset = 15. */
  defaultCommissionPct?: number | null;
}

/** The fee and default commission actually in force, fallbacks included. */
export interface EffectivePlatformPolicy {
  processingFeePct: number;
  processingFeeFixedSar: number;
  processingFeeBearer: 'platform' | 'provider' | 'customer';
  defaultCommissionPct: number;
}

export const packageLimitApi = {
  limitKeys: () => get<Ok<{ limitKeys: Record<ProviderTypeKey, LimitKeyDef[]> }>>('/monetization/limit-keys'),
  usage: () => get<Ok<{ usage: UsageRow[] }>>('/monetization/usage'),

  scheduleDowngrade: (packageId: string) =>
    post<Ok<{ effectiveAt: string; warning?: string }>>('/monetization/package/downgrade', { packageId }),
  cancelScheduledDowngrade: () => post<Ok<{ message: string }>>('/monetization/package/downgrade/cancel'),

  cancelSubscription: () => post<Ok<{ periodEnd: string | null }>>('/monetization/subscription/cancel'),
  reactivateSubscription: () => post<Ok<{ message: string }>>('/monetization/subscription/reactivate'),

  history: (providerId?: string) => get<Ok<Paginated<PackageHistoryEntry>>>('/monetization/package-history', { providerId }),

  getBillingSettings: () =>
    get<Ok<{ settings: BillingSettingsData; effective?: EffectivePlatformPolicy }>>('/monetization/billing-settings'),
  updateBillingSettings: (data: Partial<BillingSettingsData>) =>
    patch<Ok<{ settings: BillingSettingsData; effective?: EffectivePlatformPolicy }>>('/monetization/billing-settings', data),
};

// ── Add-on marketplace & hidden-plan invite links ──────────────────────────
// How a provider raises one package limit (add-ons) or unlocks a private plan
// (invites) now that self-serve mid-cycle "upgrade" has been removed.
export const addOnApi = {
  list: (params?: { providerType?: string; resourceKey?: string }) =>
    get<Ok<{ addOns: AddOnTypeData[] }>>('/monetization/add-ons', params),
  create: (data: Partial<AddOnTypeData>) => post<Ok<{ addOn: AddOnTypeData }>>('/monetization/add-ons', data),
  update: (id: string, data: Partial<AddOnTypeData>) => patch<Ok<{ addOn: AddOnTypeData }>>(`/monetization/add-ons/${id}`, data),
  remove: (id: string) => del<Ok<{ message: string }>>(`/monetization/add-ons/${id}`),
  mine: () => get<Ok<{ addOns: ProviderAddOnData[] }>>('/monetization/my-add-ons'),
  purchaseCheckout: (id: string, opts?: CheckoutGatewayChoice) =>
    post<Ok<GatewayCheckoutData>>(`/monetization/add-ons/${id}/purchase/checkout`, opts),
  purchaseConfirm: (id: string, checkoutId: string) =>
    post<Ok<{ addOn: ProviderAddOnData }>>(`/monetization/add-ons/${id}/purchase/confirm`, { checkoutId }),
  request: (data: { resourceKey: string; quantity?: number; note?: string }) =>
    post<Ok<{ message: string }>>('/monetization/add-ons/request', data),
};

export const planInviteApi = {
  list: () => get<Ok<{ invites: PlanInviteData[] }>>('/monetization/invites'),
  create: (data: { packageType: 'subscription' | 'commission'; packageId: string; maxUses?: number; expiresAt?: string }) =>
    post<Ok<{ invite: PlanInviteData }>>('/monetization/invites', data),
  /**
   * Mints a fixed-fee plan and its link in one call.
   *
   * One request, because it is one decision — and because creating the package
   * and the link separately could leave a hidden package behind that nothing
   * pointed at if the second call failed.
   */
  createFixedFee: (data: {
    providerType: string
    name: string
    feePerTransaction: number
    maxUses?: number
    expiresAt?: string
  }) => post<Ok<{ invite: PlanInviteData; package: CommissionPackageData }>>('/monetization/invites/fixed-fee', data),
  update: (id: string, data: Partial<{ isActive: boolean; maxUses: number; expiresAt: string }>) =>
    patch<Ok<{ invite: PlanInviteData }>>(`/monetization/invites/${id}`, data),
  resolve: (code: string) =>
    get<Ok<{ packageType: 'subscription' | 'commission'; package: SubscriptionPackageData | CommissionPackageData; plan: PlanSummary }>>(
      `/monetization/invite/${code}`
    ),
  redeem: (code: string, checkoutId?: string) =>
    post<Ok<{ package: SubscriptionPackageData | CommissionPackageData; plan: PlanSummary }>>(`/monetization/invite/${code}/redeem`, { checkoutId }),
};


export interface AddOnRequestData {
  _id: string;
  id?: string;
  provider: {
    _id: string;
    id?: string;
    name: string;
    email: string;
    phone?: string;
    role: string;
    business?: { businessName?: string; name?: string; contactPhone?: string };
    onboarding?: { providerType?: string };
  } | string;
  providerType: ProviderTypeKey;
  resourceKey: string;
  resourceLabel?: string;
  quantity: number;
  price?: number;
  currency: string;
  note?: string;
  adminNotes?: string;
  status: 'pending' | 'approved' | 'rejected' | 'paid' | 'cancelled';
  approvedAt?: string;
  approvedBy?: { _id: string; name: string; email: string } | string;
  rejectedAt?: string;
  rejectedReason?: string;
  paidAt?: string;
  checkoutId?: string;
  providerAddOn?: string;
  createdAt: string;
  updatedAt: string;
}

export const addOnRequestApi = {
  create: (data: { resourceKey: string; quantity: number; note?: string }) =>
    post<Ok<{ request: AddOnRequestData }>>('/monetization/add-on-requests', data),
  myRequests: () =>
    get<Ok<{ requests: AddOnRequestData[] }>>('/monetization/my-add-on-requests'),
  adminList: (params?: { providerType?: string; status?: string }) =>
    get<Ok<{ requests: AddOnRequestData[]; statusCounts: Record<string, number> }>>(
      '/monetization/admin/add-on-requests',
      params
    ),
  adminApprove: (id: string, data: { price: number; adminNotes?: string }) =>
    patch<Ok<{ request: AddOnRequestData }>>(`/monetization/admin/add-on-requests/${id}/approve`, data),
  adminReject: (id: string, data: { reason?: string }) =>
    patch<Ok<{ request: AddOnRequestData }>>(`/monetization/admin/add-on-requests/${id}/reject`, data),
  purchaseCheckout: (id: string, opts?: CheckoutGatewayChoice) =>
    post<Ok<GatewayCheckoutData>>(`/monetization/add-on-requests/${id}/purchase/checkout`, opts),
  purchaseConfirm: (id: string, checkoutId: string) =>
    post<Ok<{ request: AddOnRequestData; addOn: ProviderAddOnData }>>(
      `/monetization/add-on-requests/${id}/purchase/confirm`,
      { checkoutId }
    ),
};

// ---------------------------------------------------------------------------
// Boat Crew Management
// ---------------------------------------------------------------------------
export type BoatCrewPermission = 'scan' | 'manifest' | 'trip_lifecycle';
export type BoatCrewStatus = 'invited' | 'active' | 'disabled';

export interface ApiBoatCrew {
  _id: string;
  id?: string;
  owner: string;
  user?: { _id: string; name: string; email: string; avatar?: string; isActive?: boolean } | string;
  name: string;
  email: string;
  phone?: string;
  avatar?: string;
  position: 'crew';
  roleTitle?: string;
  shiftStartTime?: string;
  shiftEndTime?: string;
  workingDays?: string[];
  licenseNo?: string;
  licenseExpiry?: string;
  certifications?: string[];
  notes?: string;
  boats: { _id: string; id?: string; name: string; code?: string; capacity?: number; status?: string }[];
  permissions: BoatCrewPermission[];
  status: BoatCrewStatus;
  invitedAt: string;
  acceptedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBoatCrewPayload {
  name: string;
  email: string;
  phone?: string;
  roleTitle?: string;
  shiftStartTime?: string;
  shiftEndTime?: string;
  workingDays?: string[];
  licenseNo?: string;
  licenseExpiry?: string;
  certifications?: string[];
  notes?: string;
  boats?: string[];
  permissions?: BoatCrewPermission[];
}

export interface UpdateBoatCrewPayload {
  name?: string;
  phone?: string;
  avatar?: string;
  roleTitle?: string;
  shiftStartTime?: string;
  shiftEndTime?: string;
  workingDays?: string[];
  licenseNo?: string;
  licenseExpiry?: string;
  certifications?: string[];
  notes?: string;
  boats?: string[];
  permissions?: BoatCrewPermission[];
}

export const boatCrewApi = {
  list: (params?: { boatId?: string }) =>
    get<Ok<{ crew: ApiBoatCrew[]; permissionKeys: BoatCrewPermission[]; positions: string[] }>>('/boat-crew', params),
  invite: (data: CreateBoatCrewPayload) =>
    post<Ok<{ crew: ApiBoatCrew; emailSent: boolean; devInviteToken?: string }>>('/boat-crew', data),
  update: (id: string, data: UpdateBoatCrewPayload) =>
    patch<Ok<{ crew: ApiBoatCrew }>>(`/boat-crew/${id}`, data),
  uploadAvatar: (id: string, file: File) => {
    const fd = new FormData();
    fd.append('avatar', file);
    return patch<Ok<{ crew: ApiBoatCrew }>>(`/boat-crew/${id}/avatar`, fd);
  },
  setStatus: (id: string, status: 'active' | 'disabled') =>
    patch<Ok<{ crew: ApiBoatCrew }>>(`/boat-crew/${id}/status`, { status }),
  resendInvite: (id: string) =>
    post<Ok<{ emailSent: boolean; devInviteToken?: string }>>(`/boat-crew/${id}/resend`),
  remove: (id: string) => del<Ok<{ message: string }>>(`/boat-crew/${id}`),
};


// ---------------------------------------------------------------------------
// Featured listings — the one route into the customer app's promotion banner,
// and a limited one. Apply → admin approves, which claims a slot and sets a
// price → provider pays → it runs for the days bought → the slot returns to the
// queue.
//
// The banner is a fixed number of places the admin sets (100 by default), not a
// quantity bundled into anybody's subscription package. Approving is therefore
// allocating, and it is allocated in the order providers asked.
// ---------------------------------------------------------------------------
export type FeaturedListingStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'active'
  | 'expired'
  | 'cancelled'
  /** Approved, but the held slot expired before the provider paid for it. */
  | 'lapsed'

/** One placement's inventory: how big it is, and how much of it is spoken for. */
export interface FeaturedSlotState {
  placement: 'home_banner' | 'trips_banner'
  capacity: number
  /** Approved-and-unpaid plus running — both hold a place. */
  used: number
  free: number
  /** When the earliest running placement ends, i.e. when a slot next frees. */
  nextFreeAt?: string | null
  /** Applications queued behind a full pool. */
  waiting: number
  /** Days an approval holds its slot before it goes back to the queue. */
  reservationDays: number
}

export interface FeaturedListingData {
  id: string
  placement: 'home_banner' | 'trips_banner'
  requestedDays: number
  note?: string
  /** Admin-set. Absent until approved — the platform prices each application. */
  price?: number
  currency: string
  adminNotes?: string
  status: FeaturedListingStatus
  /** Whether it is paid for *and* inside its window, which is not the same as
   * `status === 'active'` once the end date has passed. */
  running?: boolean
  approvedAt?: string
  /** When an approval's hold on its slot runs out if it is not paid for. */
  reservedUntil?: string
  rejectedAt?: string
  rejectedReason?: string
  paidAt?: string
  startsAt?: string
  endsAt?: string
  createdAt: string
  trip?: { id: string; title: string; titleAr?: string; images?: string[]; basePrice?: number; status?: string; visibility?: string }
  provider?: { id: string; name: string; email?: string; phone?: string; business?: { businessName?: string } }
}

export const featuredListingApi = {
  adminList: (params?: { status?: string; placement?: string }) =>
    get<Ok<{ listings: FeaturedListingData[]; pending: number; slots: FeaturedSlotState[]; reservationDays: number }>>(
      '/featured-listings/admin/all',
      params
    ),
  adminApprove: (id: string, data: { price: number; days?: number; adminNotes?: string }) =>
    patch<Ok<{ listing: FeaturedListingData; slots: FeaturedSlotState }>>(
      `/featured-listings/admin/${id}/approve`,
      data
    ),
  adminReject: (id: string, data: { reason?: string }) =>
    patch<Ok<{ listing: FeaturedListingData }>>(`/featured-listings/admin/${id}/reject`, data),
  adminStop: (id: string, data: { reason?: string }) =>
    patch<Ok<{ listing: FeaturedListingData }>>(`/featured-listings/admin/${id}/stop`, data),
  /** Resize the pool, or change how long an approval holds its place. */
  adminSetSlots: (data: {
    capacities?: Partial<Record<'home_banner' | 'trips_banner', number>>
    reservationDays?: number
  }) =>
    patch<Ok<{ slots: FeaturedSlotState[]; reservationDays: number }>>('/featured-listings/admin/settings', data),
}
