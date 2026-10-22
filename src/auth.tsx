// ---------------------------------------------------------------------------
// Authentication context for the marina portal.
//
// Backs every portal (marina / fuel / maintenance / admin) with the real
// BoatPro backend: email + password sign-in, registration, session hydration
// from a persisted token, and logout.
//
// Backend role model: the API supports `marina_provider` (all operational
// providers) and `admin` (seeded, never self-registered). There is no separate
// fuel / maintenance role yet, so those operational portals authorize a
// `marina_provider`; the admin portal is gated strictly.
// ---------------------------------------------------------------------------
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { toast } from './async/toast';
import { translatePortalText } from './i18n/runtime';
import {
  authApi,
  getToken,
  getRefreshToken,
  maintenancePortalApi,
  onboardingApi,
  onSessionExpired,
  portalApi,
  setRefreshToken,
  setToken,
  MARINA_STAFF_PERMISSIONS,
  type ApiMaintAccess,
  type ApiMarinaAccess,
  type ApiUser,
  type MarinaStaffPermission,
} from './api';
import { fuelApi, type ApiFuelAccess } from './fuel/fuelApi';
import { clearMarinaCache } from './live';
import { clearPendingInvite } from './shared/pendingInvite';
import { connectSocket, disconnectSocket } from './socket';

export type PortalRole = 'marina' | 'fuel' | 'maint' | 'boat' | 'admin' | 'agent';
type Status = 'loading' | 'authed' | 'guest';

const ROLE_KEY = 'bp-role';

// Each portal now maps to a dedicated backend provider role. `fuel_worker` is
// a sub-account invited by a fuel_provider owner (see FuelWorkers.tsx) — it
// gets into the fuel portal too, just scoped to whatever pages it was granted.
// `marina_worker` is the same for the marina console (see MarinaStaff.tsx):
// it signs in through the Marina option and sees only its granted pages.
const PORTAL_TO_ROLE: Record<PortalRole, string> = {
  marina: 'marina_provider',
  fuel: 'fuel_provider',
  maint: 'maintenance_provider',
  boat: 'boat_provider',
  admin: 'admin',
  agent: 'support_agent',
};

/** Map each backend user role to its designated primary portal. */
export function portalForRole(backendRole: string | undefined): PortalRole {
  if (backendRole === 'admin') return 'admin';
  if (backendRole === 'support_agent') return 'agent';
  if (backendRole === 'fuel_provider' || backendRole === 'fuel_worker') return 'fuel';
  if (backendRole === 'maintenance_provider' || backendRole === 'maintenance_worker') return 'maint';
  if (backendRole === 'boat_provider') return 'boat';
  // marina_provider and marina_worker (invited marina staff)
  return 'marina';
}

/** Whether a backend user role may access a given portal. Each role strictly maps to its portal. */
export function roleAllowsPortal(backendRole: string | undefined, portal: PortalRole): boolean {
  if (!backendRole) return false;
  if (portal === 'admin') return backendRole === 'admin';
  if (portal === 'agent') return backendRole === 'support_agent';
  if (portal === 'marina') return backendRole === 'marina_provider' || backendRole === 'marina_worker';
  if (portal === 'fuel') return backendRole === 'fuel_provider' || backendRole === 'fuel_worker';
  if (portal === 'maint') return backendRole === 'maintenance_provider' || backendRole === 'maintenance_worker';
  if (portal === 'boat') return backendRole === 'boat_provider';
  return false;
}

/** Backend role to register a new account with, based on the chosen portal. */
export function backendRoleForPortal(portal: PortalRole): string {
  return PORTAL_TO_ROLE[portal];
}

/** Provider portals require onboarding + admin approval before use. */
export function needsOnboarding(user: ApiUser | null): boolean {
  if (!user || user.role === 'admin') return false;
  const s = user.onboarding?.status;
  // A subscriber suspended only because the plan lapsed keeps the console: the
  // backend still lets them run existing bookings, and the renewal is offered
  // from a banner (Layout → /onboarding shows the renewal screen). Sending them
  // to the 10-step wizard locked them out of arrivals, departures and billing.
  if (isLapsedSubscription(user)) return false;
  return !!s && s !== 'approved';
}

/** Suspended with a subscription plan whose paid period has run out. */
export function isLapsedSubscription(user: ApiUser | null): boolean {
  const ob = user?.onboarding as { status?: string; billingModel?: string; subscriptionExpiresAt?: string; subscriptionExpiry?: string } | undefined;
  if (!ob || ob.status !== 'suspended' || ob.billingModel !== 'subscription') return false;
  const until = ob.subscriptionExpiresAt ?? ob.subscriptionExpiry;
  return !!until && new Date(until).getTime() <= Date.now();
}

/**
 * A password sign-in that still owes the 6-digit code emailed to the account —
 * what `login` resolves to for an admin or support agent while the
 * "Two-Factor Authentication" security policy is on. `completeMfaLogin`
 * finishes it. `devCode` only ever comes back from a development server.
 */
export interface MfaChallenge {
  mfaRequired: true;
  mfaToken: string;
  emailHint: string;
  devCode?: string;
}
export type LoginOutcome = ApiUser | MfaChallenge;
export function isMfaChallenge(outcome: LoginOutcome | null | undefined): outcome is MfaChallenge {
  return !!outcome && (outcome as MfaChallenge).mfaRequired === true;
}

/**
 * Roles the server's "Inactivity Session Timeout" applies to — everyone who
 * works from this portal. Customers, boat providers and crew are mobile-app
 * roles and exempt (see `IDLE_TIMEOUT_ROLES` on the backend).
 */
const IDLE_TIMEOUT_ROLES = [
  'admin', 'support_agent', 'marina_provider', 'fuel_provider', 'maintenance_provider', 'fuel_worker', 'maintenance_worker',
  'marina_worker',
];
/** Shared by every tab, so working in one keeps the others signed in. */
const LAST_ACTIVITY_KEY = 'bp-last-activity';
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'wheel', 'touchstart'] as const;
const HEARTBEAT_MS = 5 * 60_000;

function readLastActivity(): number {
  try {
    return Number(localStorage.getItem(LAST_ACTIVITY_KEY)) || 0;
  } catch {
    return 0;
  }
}
function writeLastActivity(at: number): void {
  try {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(at));
  } catch {
    /* storage blocked — the in-tab timer still works from this tab's events */
  }
}
const isIdleTimeoutError = (err: unknown) =>
  (err as { details?: { code?: string } } | null)?.details?.code === 'SESSION_IDLE_TIMEOUT';

/** Roles that resolve to a fuel-portal provider context (owner, worker, or admin acting on one). */
const FUEL_PORTAL_ROLES = ['fuel_provider', 'fuel_worker', 'admin'];
/** Roles that resolve to a maintenance-portal provider context (owner, technician-worker, or admin). */
const MAINT_PORTAL_ROLES = ['maintenance_provider', 'maintenance_worker', 'admin'];
/** Roles that work in the marina console (the owner, or invited marina staff). */
const MARINA_PORTAL_ROLES = ['marina_provider', 'marina_worker'];

/**
 * What the signed-in account may open in the marina console.
 *
 * The owner holds everything. A `marina_worker` holds exactly the permissions
 * their owner granted; until `my-access` answers they hold nothing, so the
 * console never flashes pages it is about to take away. The server enforces
 * the same permissions on every endpoint — this only shapes the screens.
 */
export interface MarinaPermissions {
  /** `my-access` has answered (always true for an owner). */
  loaded: boolean;
  isOwner: boolean;
  isStaff: boolean;
  permissions: readonly MarinaStaffPermission[];
  /** True when the account holds any of `perms` (no argument: the owner only). */
  can: (...perms: MarinaStaffPermission[]) => boolean;
}

export function marinaPermissionsFor(user: ApiUser | null, access: ApiMarinaAccess | null): MarinaPermissions {
  const isStaff = user?.role === 'marina_worker';
  // An owner whose marina is still being provisioned (my-access 404s) is still the owner.
  const isOwner = !isStaff && (access ? access.isOwner : true);
  const permissions: readonly MarinaStaffPermission[] = isOwner ? MARINA_STAFF_PERMISSIONS : access?.permissions ?? [];
  return {
    loaded: !isStaff || !!access,
    isOwner,
    isStaff,
    permissions,
    can: (...perms) => isOwner || (perms.length > 0 && perms.some((p) => permissions.includes(p))),
  };
}

interface AuthContextValue {
  status: Status;
  user: ApiUser | null;
  portal: PortalRole | null;
  /** Which fuel-portal pages this session may use — null until fetched, or n/a to this portal. */
  fuelAccess: ApiFuelAccess | null;
  /** Which maintenance-portal pages this session may use — null until fetched, or n/a to this portal. */
  maintAccess: ApiMaintAccess | null;
  /** The account's standing at its marina — null until fetched, or n/a to this portal. */
  marinaAccess: ApiMarinaAccess | null;
  choosePortal?: (portal: PortalRole) => void;
  /** Resolves to the signed-in user, or to an `MfaChallenge` when an emailed code is still owed. */
  login: (email: string, password: string, portal: PortalRole) => Promise<LoginOutcome>;
  /** Second step of a two-factor sign-in: the code from the email. */
  completeMfaLogin: (mfaToken: string, code: string, portal: PortalRole) => Promise<ApiUser>;
  register: (
    data: { name: string; email: string; password: string; phone?: string; emailOtpCode?: string },
    portal: PortalRole,
  ) => Promise<void>;
  /** Adopts an already-issued session (a worker accepting their invite) straight into the given portal. */
  adoptSession: (data: { user: ApiUser; accessToken: string; refreshToken?: string }, portal: PortalRole) => Promise<void>;
  submitOnboarding: (data: {
    billingModel: 'subscription' | 'commission';
    planId?: string;
    businessName: string;
    contactNumber: string;
    address: string;
    country: string;
    city?: string;
    description?: string;
    latitude?: number;
    longitude?: number;
  }) => Promise<void>;
  /** `false` when the refresh failed. */
  refreshMe: () => Promise<boolean>;
  logout: () => void;
}

const defaultAuthContext: AuthContextValue = {
  status: 'loading',
  user: null,
  portal: null,
  fuelAccess: null,
  maintAccess: null,
  marinaAccess: null,
  choosePortal: () => {},
  /*
   * Only reached when a screen renders outside <AuthProvider> — in dev, after a
   * hot reload left two copies of this module. It used to resolve with `{}`, so
   * the login page took it for a marina sign-in, navigated to `/`, was bounced
   * back to /login and cleared the form: "Sign in" silently did nothing
   * (2026-10-15). Fail out loud instead.
   */
  login: async () => {
    throw new Error('Sign-in is not ready — please reload the page and try again.');
  },
  completeMfaLogin: async () => {
    throw new Error('Sign-in is not ready — please reload the page and try again.');
  },
  register: async () => {
    throw new Error('Sign-up is not ready — please reload the page and try again.');
  },
  adoptSession: async () => {},
  submitOnboarding: async () => {},
  refreshMe: async () => false,
  logout: () => {},
};

const AuthContext = createContext<AuthContextValue>(defaultAuthContext);
export const useAuth = () => useContext(AuthContext) || defaultAuthContext;

/** The marina console's view of what this account may open — see `marinaPermissionsFor`. */
export function useMarinaPermissions(): MarinaPermissions {
  const { user, marinaAccess } = useAuth();
  return marinaPermissionsFor(user, marinaAccess);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<ApiUser | null>(null);
  const [fuelAccess, setFuelAccess] = useState<ApiFuelAccess | null>(null);
  const [maintAccess, setMaintAccess] = useState<ApiMaintAccess | null>(null);
  const [marinaAccess, setMarinaAccess] = useState<ApiMarinaAccess | null>(null);
  const [portal, setPortal] = useState<PortalRole | null>(
    () => (localStorage.getItem(ROLE_KEY) as PortalRole) || null,
  );
  /** The server's inactivity policy, when it is on and applies to this role. */
  const [idlePolicy, setIdlePolicy] = useState<{ minutes: number } | null>(null);
  const idlePolicyRef = useRef(idlePolicy);
  idlePolicyRef.current = idlePolicy;
  /** One "signed out after inactivity" toast per sign-out, however many paths notice it. */
  const idleNoticeShown = useRef(false);

  const announceIdleSignOut = useCallback((minutes: number) => {
    if (idleNoticeShown.current) return;
    idleNoticeShown.current = true;
    toast(translatePortalText(`Signed out after ${minutes} minutes of inactivity`), 'warn');
  }, []);

  const loadFuelAccess = useCallback(async (role: string) => {
    if (!FUEL_PORTAL_ROLES.includes(role)) {
      setFuelAccess(null);
      return;
    }
    try {
      const res = await fuelApi.myAccess();
      setFuelAccess(res.data);
    } catch {
      setFuelAccess(null);
    }
  }, []);

  const loadMaintAccess = useCallback(async (role: string) => {
    if (!MAINT_PORTAL_ROLES.includes(role)) {
      setMaintAccess(null);
      return;
    }
    try {
      const res = await maintenancePortalApi.myAccess();
      setMaintAccess(res.data);
    } catch {
      setMaintAccess(null);
    }
  }, []);

  const loadMarinaAccess = useCallback(async (role: string) => {
    if (!MARINA_PORTAL_ROLES.includes(role)) {
      setMarinaAccess(null);
      return;
    }
    try {
      const res = await portalApi.myAccess();
      setMarinaAccess(res.data);
    } catch {
      setMarinaAccess(null);
    }
  }, []);

  const loadPortalAccess = useCallback(
    (role: string) => Promise.all([loadFuelAccess(role), loadMaintAccess(role), loadMarinaAccess(role)]),
    [loadFuelAccess, loadMaintAccess, loadMarinaAccess],
  );

  // Restore the session from a persisted token on first load.
  useEffect(() => {
    const token = getToken();
    const refresh = getRefreshToken();
    if (!token && !refresh) {
      setStatus('guest');
      return;
    }

    let isMounted = true;

    const restoreSession = async () => {
      if (token) {
        try {
          const res = await authApi.me();
          if (!isMounted) return;
          const u = res.data.user;
          setUser(u);
          const effectivePortal = portalForRole(u.role);
          setPortal(effectivePortal);
          localStorage.setItem(ROLE_KEY, effectivePortal);
          setStatus('authed');
          void loadPortalAccess(u.role);
          return;
        } catch {
          // Access token may be expired, attempt refresh
        }
      }

      if (refresh) {
        try {
          const refRes = await authApi.refreshToken(refresh);
          if (!isMounted) return;
          setToken(refRes.data.accessToken);
          if (refRes.data.refreshToken) setRefreshToken(refRes.data.refreshToken);
          const u = refRes.data.user;
          setUser(u);
          const effectivePortal = portalForRole(u.role);
          setPortal(effectivePortal);
          localStorage.setItem(ROLE_KEY, effectivePortal);
          setStatus('authed');
          void loadPortalAccess(u.role);
          return;
        } catch (err) {
          // Refresh token also expired or invalid — or, with the inactivity
          // policy on, the tab was left closed past the limit: say so.
          if (isMounted && isIdleTimeoutError(err)) announceIdleSignOut(30);
        }
      }

      if (!isMounted) return;
      setToken(null);
      setRefreshToken(null);
      setStatus('guest');
    };

    restoreSession();

    return () => {
      isMounted = false;
    };
  }, [loadPortalAccess, announceIdleSignOut]);

  // One place to open and close the live connection, rather than a call in each
  // of login/register/adoptSession/logout — four sites is four chances to leave
  // a socket authenticated as the previous user.
  useEffect(() => {
    if (status === 'authed') connectSocket();
    else disconnectSocket();
  }, [status]);

  /**
   * The API layer refused a refresh — the session is over, whatever this
   * component still believes.
   *
   * `performTokenRefresh` cleared both tokens from storage but had no way to
   * say so, so `status` stayed `'authed'` and `RequireRole` kept rendering a
   * console whose every request was now unauthenticated. The operator was left
   * with a screen full of errors and no route back to sign-in short of a manual
   * reload. This closes that gap: the same state reset as `logout`, minus the
   * server call, because the credential it would present has already been
   * refused once.
   */
  useEffect(
    () =>
      onSessionExpired(() => {
        // The API layer cannot say *why* the refresh was refused. If the
        // inactivity policy is on and this browser has seen no input for the
        // whole limit, that is the reason (the server answered
        // SESSION_IDLE_TIMEOUT) — tell the operator rather than just dropping
        // them on the sign-in page.
        const policy = idlePolicyRef.current;
        const idle = !!policy && Date.now() - readLastActivity() >= policy.minutes * 60_000 - 60_000;
        clearMarinaCache();
        setUser(null);
        setFuelAccess(null);
        setMaintAccess(null);
        setMarinaAccess(null);
        setPortal(null);
        localStorage.removeItem(ROLE_KEY);
        setStatus('guest');
        if (idle && policy) announceIdleSignOut(policy.minutes);
      }),
    [announceIdleSignOut],
  );

  /** Adopts the session a finished sign-in (one step or two) handed back. */
  const finishLogin = useCallback(
    async (data: { user: ApiUser; accessToken: string; refreshToken?: string }, p: PortalRole) => {
      const userRole = data.user.role;
      // An admin account always maps to the admin portal
      const effectivePortal: PortalRole = userRole === 'admin' ? 'admin' : userRole === 'support_agent' ? 'agent' : p;
      if (userRole !== 'admin' && userRole !== 'support_agent' && !roleAllowsPortal(userRole, p)) {
        const label = p === 'admin' ? 'Super Admin' : `${p} provider`;
        throw new Error(`This account is not authorized as a ${label}.`);
      }
      setToken(data.accessToken);
      if (data.refreshToken) setRefreshToken(data.refreshToken);
      localStorage.setItem(ROLE_KEY, effectivePortal);
      writeLastActivity(Date.now());
      idleNoticeShown.current = false;
      setUser(data.user);
      setPortal(effectivePortal);
      setStatus('authed');
      await loadPortalAccess(data.user.role);
      return data.user;
    },
    [loadPortalAccess],
  );

  const login = useCallback(async (email: string, password: string, p: PortalRole): Promise<LoginOutcome> => {
    const res = await authApi.login(email, password);
    // Admins and support agents, while two-factor sign-in is required: no
    // session yet, only the pending step for `completeMfaLogin`.
    if ('mfaRequired' in res.data) {
      const devCode = 'devCode' in res ? res.devCode : undefined;
      return {
        mfaRequired: true,
        mfaToken: res.data.mfaToken,
        emailHint: res.data.emailHint,
        ...(devCode ? { devCode } : {}),
      };
    }
    return finishLogin(res.data, p);
  }, [finishLogin]);

  const completeMfaLogin = useCallback(async (mfaToken: string, code: string, p: PortalRole) => {
    const res = await authApi.loginMfa(mfaToken, code);
    return finishLogin(res.data, p);
  }, [finishLogin]);

  const register = useCallback(
    async (
      data: { name: string; email: string; password: string; phone?: string; emailOtpCode?: string },
      p: PortalRole,
    ) => {
      const res = await authApi.register({ ...data, role: backendRoleForPortal(p) });
      setToken(res.data.accessToken);
      if (res.data.refreshToken) setRefreshToken(res.data.refreshToken);
      localStorage.setItem(ROLE_KEY, p);
      setUser(res.data.user);
      setPortal(p);
      setStatus('authed');
      await loadPortalAccess(res.data.user.role);
    },
    [loadPortalAccess],
  );

  const adoptSession = useCallback(
    async (data: { user: ApiUser; accessToken: string; refreshToken?: string }, p: PortalRole) => {
      setToken(data.accessToken);
      if (data.refreshToken) setRefreshToken(data.refreshToken);
      localStorage.setItem(ROLE_KEY, p);
      setUser(data.user);
      setPortal(p);
      setStatus('authed');
      await loadPortalAccess(data.user.role);
    },
    [loadPortalAccess],
  );

  const submitOnboarding = useCallback(async (data: Parameters<AuthContextValue['submitOnboarding']>[0]) => {
    const res = await onboardingApi.submit(data);
    setUser(res.data.user);
  }, []);

  /** Resolves `false` when the refresh failed, so callers do not announce stale data as refreshed. */
  const refreshMe = useCallback(async (): Promise<boolean> => {
    try {
      const res = await authApi.me();
      setUser(res.data.user);
      return true;
    } catch {
      /* keep current state */
      return false;
    }
  }, []);

  const logout = useCallback(() => {
    authApi.logout(getRefreshToken() || undefined);
    setToken(null);
    setRefreshToken(null);
    localStorage.removeItem(ROLE_KEY);
    clearMarinaCache();
    // The next account on this browser must not inherit an invite code.
    clearPendingInvite();
    setUser(null);
    setFuelAccess(null);
    setMaintAccess(null);
    setMarinaAccess(null);
    setPortal(null);
    setStatus('guest');
  }, []);

  /**
   * "Inactivity Session Timeout", the browser's half.
   *
   * The server refuses a portal session that has made no request for the
   * limit — but an open console polls (notifications, dashboards), so to the
   * server an operator who walked away from an open tab never goes idle. Only
   * the browser can tell input from polling, so it watches for input and signs
   * out itself. While the operator is working without making requests (a long
   * form), a heartbeat every few minutes keeps the server's clock in step.
   */
  const userRole = user?.role;
  useEffect(() => {
    if (status !== 'authed' || !userRole || !IDLE_TIMEOUT_ROLES.includes(userRole)) {
      setIdlePolicy(null);
      return;
    }
    let alive = true;
    const load = () =>
      authApi
        .methods()
        .then((res) => {
          if (!alive) return;
          const p = res.policies;
          const minutes = p?.sessionIdleTimeoutMinutes || 30;
          setIdlePolicy((prev) => (p?.sessionTimeout ? (prev?.minutes === minutes ? prev : { minutes }) : null));
        })
        .catch(() => {
          /* keep whatever was known — the server enforces regardless */
        });
    void load();
    // Picks up the switch being flipped while this console is open.
    const timer = window.setInterval(load, 5 * 60_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [status, userRole]);

  useEffect(() => {
    if (!idlePolicy) return;
    const limitMs = idlePolicy.minutes * 60_000;
    // Signing in, reloading, or the policy just being turned on is not idleness.
    writeLastActivity(Date.now());
    let lastWrite = 0;
    let lastBeat = Date.now();

    const onActivity = () => {
      const now = Date.now();
      if (now - lastWrite > 5_000) {
        lastWrite = now;
        writeLastActivity(now);
      }
      if (now - lastBeat > HEARTBEAT_MS) {
        lastBeat = now;
        void authApi.heartbeat().catch(() => {
          /* a refused session is handled by onSessionExpired */
        });
      }
    };
    const check = () => {
      if (Date.now() - readLastActivity() < limitMs) return;
      logout();
      announceIdleSignOut(idlePolicy.minutes);
    };

    for (const e of ACTIVITY_EVENTS) document.addEventListener(e, onActivity, { capture: true, passive: true });
    // A laptop waking from sleep fires no timer until it is visible again.
    document.addEventListener('visibilitychange', check);
    const timer = window.setInterval(check, 15_000);
    return () => {
      for (const e of ACTIVITY_EVENTS) document.removeEventListener(e, onActivity, { capture: true });
      document.removeEventListener('visibilitychange', check);
      window.clearInterval(timer);
    };
  }, [idlePolicy, logout, announceIdleSignOut]);

  return (
    <AuthContext.Provider
      value={{
        status, user, portal, fuelAccess, maintAccess, marinaAccess,
        login, completeMfaLogin, register, adoptSession, submitOnboarding, refreshMe, logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
