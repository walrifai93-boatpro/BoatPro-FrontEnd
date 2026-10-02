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
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  authApi,
  getToken,
  getRefreshToken,
  maintenancePortalApi,
  onboardingApi,
  onSessionExpired,
  setRefreshToken,
  setToken,
  type ApiMaintAccess,
  type ApiUser,
} from './api';
import { fuelApi, type ApiFuelAccess } from './fuel/fuelApi';
import { clearMarinaCache } from './live';
import { connectSocket, disconnectSocket } from './socket';

export type PortalRole = 'marina' | 'fuel' | 'maint' | 'boat' | 'admin' | 'agent';
type Status = 'loading' | 'authed' | 'guest';

const ROLE_KEY = 'bp-role';

// Each portal now maps to a dedicated backend provider role. `fuel_worker` is
// a sub-account invited by a fuel_provider owner (see FuelWorkers.tsx) — it
// gets into the fuel portal too, just scoped to whatever pages it was granted.
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
  return 'marina';
}

/** Whether a backend user role may access a given portal. Each role strictly maps to its portal. */
export function roleAllowsPortal(backendRole: string | undefined, portal: PortalRole): boolean {
  if (!backendRole) return false;
  if (portal === 'admin') return backendRole === 'admin';
  if (portal === 'agent') return backendRole === 'support_agent';
  if (portal === 'marina') return backendRole === 'marina_provider';
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
  return !!s && s !== 'approved';
}

/** Roles that resolve to a fuel-portal provider context (owner, worker, or admin acting on one). */
const FUEL_PORTAL_ROLES = ['fuel_provider', 'fuel_worker', 'admin'];
/** Roles that resolve to a maintenance-portal provider context (owner, technician-worker, or admin). */
const MAINT_PORTAL_ROLES = ['maintenance_provider', 'maintenance_worker', 'admin'];

interface AuthContextValue {
  status: Status;
  user: ApiUser | null;
  portal: PortalRole | null;
  /** Which fuel-portal pages this session may use — null until fetched, or n/a to this portal. */
  fuelAccess: ApiFuelAccess | null;
  /** Which maintenance-portal pages this session may use — null until fetched, or n/a to this portal. */
  maintAccess: ApiMaintAccess | null;
  choosePortal?: (portal: PortalRole) => void;
  login: (email: string, password: string, portal: PortalRole) => Promise<ApiUser>;
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
  refreshMe: () => Promise<void>;
  logout: () => void;
}

const defaultAuthContext: AuthContextValue = {
  status: 'loading',
  user: null,
  portal: null,
  fuelAccess: null,
  maintAccess: null,
  choosePortal: () => {},
  login: async () => ({} as ApiUser),
  register: async () => {},
  adoptSession: async () => {},
  submitOnboarding: async () => {},
  refreshMe: async () => {},
  logout: () => {},
};

const AuthContext = createContext<AuthContextValue>(defaultAuthContext);
export const useAuth = () => useContext(AuthContext) || defaultAuthContext;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<ApiUser | null>(null);
  const [fuelAccess, setFuelAccess] = useState<ApiFuelAccess | null>(null);
  const [maintAccess, setMaintAccess] = useState<ApiMaintAccess | null>(null);
  const [portal, setPortal] = useState<PortalRole | null>(
    () => (localStorage.getItem(ROLE_KEY) as PortalRole) || null,
  );

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

  const loadPortalAccess = useCallback(
    (role: string) => Promise.all([loadFuelAccess(role), loadMaintAccess(role)]),
    [loadFuelAccess, loadMaintAccess],
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
        } catch {
          // Refresh token also expired or invalid
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
  }, [loadPortalAccess]);

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
        clearMarinaCache();
        setUser(null);
        setFuelAccess(null);
        setMaintAccess(null);
        setPortal(null);
        localStorage.removeItem(ROLE_KEY);
        setStatus('guest');
      }),
    [],
  );

  const login = useCallback(async (email: string, password: string, p: PortalRole) => {
    const res = await authApi.login(email, password);
    const userRole = res.data.user.role;
    // An admin account always maps to the admin portal
    const effectivePortal: PortalRole = userRole === 'admin' ? 'admin' : userRole === 'support_agent' ? 'agent' : p;
    if (userRole !== 'admin' && userRole !== 'support_agent' && !roleAllowsPortal(userRole, p)) {
      const label = p === 'admin' ? 'Super Admin' : `${p} provider`;
      throw new Error(`This account is not authorized as a ${label}.`);
    }
    setToken(res.data.accessToken);
    if (res.data.refreshToken) setRefreshToken(res.data.refreshToken);
    localStorage.setItem(ROLE_KEY, effectivePortal);
    setUser(res.data.user);
    setPortal(effectivePortal);
    setStatus('authed');
    await loadPortalAccess(res.data.user.role);
    return res.data.user;
  }, [loadPortalAccess]);

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

  const refreshMe = useCallback(async () => {
    try {
      const res = await authApi.me();
      setUser(res.data.user);
    } catch {
      /* ignore — keep current state */
    }
  }, []);

  const logout = useCallback(() => {
    authApi.logout(getRefreshToken() || undefined);
    setToken(null);
    setRefreshToken(null);
    localStorage.removeItem(ROLE_KEY);
    clearMarinaCache();
    setUser(null);
    setFuelAccess(null);
    setMaintAccess(null);
    setPortal(null);
    setStatus('guest');
  }, []);

  return (
    <AuthContext.Provider
      value={{
        status, user, portal, fuelAccess, maintAccess,
        login, register, adoptSession, submitOnboarding, refreshMe, logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
