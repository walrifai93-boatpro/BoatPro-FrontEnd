// ---------------------------------------------------------------------------
// Shared state for the fuel provider portal.
//
// Holds the things every screen needs (the station, the product catalogue, the
// currency, live counters for the sidebar badges) so each page only fetches
// what is genuinely its own. `useFuelResource` is the small loader every page
// uses for that page-specific data.
// ---------------------------------------------------------------------------
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { fuelApi, type ApiFuelNotification, type ApiFuelOverview, type ApiFuelStation } from './fuelApi'
import { productLookup, setFuelCurrency, toFuelType, type FuelType } from './fuelData'
import { getSocket, onSocket } from '../socket'
import { BASE_CURRENCY } from '../currency'

interface FuelContextValue {
  loading: boolean
  error: string | null
  station: ApiFuelStation | null
  products: FuelType[]
  /** Product lookup by key, with a neutral fallback for unknown keys. */
  fuelByKey: (key: string) => FuelType
  currency: string
  overview: ApiFuelOverview | null
  notifications: ApiFuelNotification[]
  ticker: string[]
  counts: {
    pendingOrders: number
    activeDeliveries: number
    lowStock: number
    unread: number
    emergencies: number
  }
  refresh: () => Promise<void>
  /** Every fuel station location this parent account manages. */
  stations: ApiFuelStation[]
  /**
   * The location currently selected across the portal (Team & Access, Station
   * Profile, dashboard, …) — a real station id, `ALL_STATIONS` for the
   * combined parent view, or `null` only transiently before the first load.
   */
  currentStationId: string | null
  /** True when the portal-wide selection is the combined "All Stations" view. */
  isAllStations: boolean
  currentStation: ApiFuelStation | null
  setCurrentStationId: (id: string | null) => void
  /** Re-fetches the station list — call after creating/renaming/deleting a location. */
  reloadStations: () => Promise<void>
}

/** Sentinel for "every station combined", stored/compared just like a real station id. */
export const ALL_STATIONS = '__all__'

const CURRENT_STATION_STORAGE_KEY = 'fuel_current_station_id'

/** A real Mongo id, or our reserved all-stations sentinel — never a stale label or garbage string. */
function isValidStationSelection(value: string | null): value is string {
  return value === ALL_STATIONS || (!!value && /^[a-f\d]{24}$/i.test(value))
}

const FuelContext = createContext<FuelContextValue | null>(null)

export function useFuel(): FuelContextValue {
  const ctx = useContext(FuelContext)
  if (!ctx) throw new Error('useFuel must be used inside <FuelProvider>')
  return ctx
}

/** How often the shell re-polls for new orders and fleet movement. */
const POLL_MS = 60_000

export function FuelProvider({ children }: { children: React.ReactNode }) {
  const [overview, setOverview] = useState<ApiFuelOverview | null>(null)
  const [ticker, setTicker] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)

  const [stations, setStations] = useState<ApiFuelStation[]>([])
  const [currentStationId, setCurrentStationIdState] = useState<string | null>(() => {
    try {
      const stored = localStorage.getItem(CURRENT_STATION_STORAGE_KEY)
      // A pre-fix build could have written a garbled label (e.g. a station's
      // display text) instead of a real id — never trust it back in.
      return isValidStationSelection(stored) ? stored : null
    } catch {
      return null
    }
  })

  const persist = (id: string | null) => {
    try {
      if (id) localStorage.setItem(CURRENT_STATION_STORAGE_KEY, id)
      else localStorage.removeItem(CURRENT_STATION_STORAGE_KEY)
    } catch {
      /* storage unavailable — selection still works for this session */
    }
  }

  const setCurrentStationId = useCallback((id: string | null) => {
    setCurrentStationIdState(id)
    persist(id)
  }, [])

  const loadStations = useCallback(async () => {
    try {
      const r = await fuelApi.station()
      if (!mounted.current) return
      const list = r.data.stations
      setStations(list)
      setCurrentStationIdState((prev) => {
        const serverStationId = r.data.station?.id
        if (serverStationId && list.some((s) => s.id === serverStationId)) {
          persist(serverStationId)
          return serverStationId
        }
        if (prev === ALL_STATIONS) return prev
        if (prev && list.some((s) => s.id === prev)) return prev
        const fallback = serverStationId ?? list[0]?.id ?? null
        persist(fallback)
        return fallback
      })
    } catch {
      /* the dashboard still works without the location switcher hydrated */
    }
  }, [])

  const load = useCallback(async (background = false) => {
    try {
      const all = currentStationId === ALL_STATIONS
      const stationId = all ? undefined : currentStationId ?? undefined
      const [ov, tk] = await Promise.all([
        fuelApi.overview(stationId, all, { silent: background }),
        fuelApi.ticker(stationId, all, { silent: background }).catch(() => null),
      ])
      if (!mounted.current) return
      setOverview(ov.data)
      setFuelCurrency(ov.data.currency)
      if (tk) setTicker(tk.data.ticker)
      setError(null)
    } catch (e) {
      if (!mounted.current) return
      setError(e instanceof Error ? e.message : 'Could not load the fuel portal')
    } finally {
      if (mounted.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStationId])

  useEffect(() => {
    mounted.current = true
    void load()
    // Polling is the floor, not the mechanism. The socket below is what makes
    // the board live; if it drops, the desk falls back to a minute behind
    // rather than going silent.
    const refresh = () => {
      if (document.visibilityState === 'visible') void load(true)
    }
    const t = setInterval(refresh, POLL_MS)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      mounted.current = false
      clearInterval(t)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [load])

  // ── Live feed ────────────────────────────────────────────────────────────
  // Everything on this portal is served through one `overview` payload —
  // orders, alerts, emergency counts, the dispatch board — so every event
  // re-reads it rather than half-patching a shape the server owns.
  //
  // This matters most for an emergency order: the fuel portal is a browser tab
  // with no push channel, so before this the only path to the operator was the
  // 60-second poll above.
  useEffect(() => {
    const reload = () => void load(true)

    const offOrderNew = onSocket('fuel:order:new', reload)
    const offOrderUpdated = onSocket('fuel:order:updated', reload)
    const offDelivery = onSocket('fuel:delivery:updated', reload)
    const offLowStock = onSocket('fuel:stock:low', reload)
    // The alert drawer reads `overview.alerts`, so a new notification only
    // appears once the overview is re-read.
    const offNotification = onSocket('notification:new', reload)

    // A reconnect means an unknown span offline — re-read rather than trust
    // the events that may have been missed.
    const socket = getSocket()
    socket?.on('connect', reload)

    return () => {
      offOrderNew()
      offOrderUpdated()
      offDelivery()
      offLowStock()
      offNotification()
      socket?.off('connect', reload)
    }
  }, [load])

  useEffect(() => {
    void loadStations()
    const handleStationUpdated = () => {
      void load()
      void loadStations()
    }
    window.addEventListener('boatpro-station-updated', handleStationUpdated)
    return () => window.removeEventListener('boatpro-station-updated', handleStationUpdated)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, loadStations])

  const products = useMemo<FuelType[]>(() => {
    if (!overview) return []
    return overview.products.map((p) =>
      toFuelType(
        p,
        overview.tanks
          .filter((t) => t.productKey === p.key)
          .reduce(
            (acc, t) => ({ stock: acc.stock + t.stock, capacity: acc.capacity + t.capacity }),
            { stock: 0, capacity: 0 },
          ),
        overview.charts.soldToday[p.key] ?? 0,
      ),
    )
  }, [overview])

  const fuelByKey = useMemo(() => productLookup(products), [products])

  const currentStation = useMemo(
    () => stations.find((s) => s.id === currentStationId) ?? null,
    [stations, currentStationId],
  )

  const value = useMemo<FuelContextValue>(
    () => ({
      loading,
      error,
      station: overview?.station ?? null,
      products,
      fuelByKey,
      /**
       * The station's own currency, falling back to what the platform stores
       * in — not to dollars.
       *
       * `FuelStation.currency` defaults to SAR on the model ("the fuel vertical
       * prices in the same currency as the rest of the platform"), so `'USD'`
       * here made every amount wear a dollar sign for the first render after a
       * reload, and permanently for any station whose field was never set.
       */
      currency: overview?.currency ?? BASE_CURRENCY,
      overview,
      notifications: overview?.alerts ?? [],
      ticker,
      counts: {
        pendingOrders: overview?.kpis.pendingOrders ?? 0,
        activeDeliveries: overview?.kpis.activeDeliveries ?? 0,
        lowStock: overview?.kpis.lowStockAlerts ?? 0,
        unread: overview?.alerts.filter((n) => !n.isRead).length ?? 0,
        emergencies: overview?.emergencyBooking ? 1 : 0,
      },
      refresh: load,
      stations,
      currentStationId,
      isAllStations: currentStationId === ALL_STATIONS,
      currentStation,
      setCurrentStationId,
      reloadStations: loadStations,
    }),
    [loading, error, overview, products, fuelByKey, ticker, load, stations, currentStationId, currentStation, setCurrentStationId, loadStations],
  )

  return <FuelContext.Provider value={value}>{children}</FuelContext.Provider>
}

// ---------------------------------------------------------------------------
// Per-page loader
// ---------------------------------------------------------------------------

export interface Resource<T> {
  data: T | null
  loading: boolean
  error: string | null
  /** Re-runs the loader; awaited so callers can chain a toast after a mutation. */
  reload: () => Promise<void>
  /** Optimistically replaces the loaded value without a round trip. */
  set: (updater: (current: T) => T) => void
}

/**
 * Loads one page's data.
 *
 * `deps` behaves like a `useEffect` dependency list — change it and the loader
 * re-runs. Out-of-order responses are discarded so a fast filter change can't
 * be overwritten by a slower earlier request.
 */
export function useFuelResource<T>(loader: () => Promise<T>, deps: unknown[] = []): Resource<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)
  const loaderRef = useRef(loader)
  loaderRef.current = loader

  const run = useCallback(async () => {
    const id = ++requestId.current
    setLoading(true)
    try {
      const result = await loaderRef.current()
      if (id !== requestId.current) return
      setData(result)
      setError(null)
    } catch (e) {
      if (id !== requestId.current) return
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void run()
    return () => {
      // Abandon whatever is in flight when the deps change or we unmount.
      requestId.current++
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  const set = useCallback((updater: (current: T) => T) => {
    setData((current) => (current === null ? current : updater(current)))
  }, [])

  return { data, loading, error, reload: run, set }
}
