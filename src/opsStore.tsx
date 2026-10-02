// ---------------------------------------------------------------------------
// Shared operations state for the marina portal.
//
// One place holds the things the whole shell needs — the dashboard overview,
// live marine conditions and the operator's notification feed — so the sidebar
// badges, the ticker and every page agree on the same numbers. Pages call
// `reloadOverview()` after a mutation instead of keeping their own copy.
// ---------------------------------------------------------------------------
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { chatApi, notificationsApi, portalApi, type ApiNotification, type ApiOverview, type ApiWeather } from './api'
import { getSocket, onSocket } from './socket'

interface OpsContextValue {
  overview: ApiOverview | null
  weather: ApiWeather | null
  alerts: ApiNotification[]
  unread: number
  /** Unread chat messages across every conversation. */
  unreadMessages: number
  /** Sidebar counters keyed by nav badgeKey. */
  badges: Record<string, number>
  loading: boolean
  error: string | null
  reloadOverview: (options?: { silent?: boolean }) => Promise<void>
  reloadAlerts: (options?: { silent?: boolean }) => Promise<void>
}

const OpsContext = createContext<OpsContextValue>(null as any)

const OVERVIEW_REFRESH_MS = 60_000
const WEATHER_REFRESH_MS = 10 * 60_000

/** Unwrap the notifications endpoint, which paginates or returns a bare list. */
function readNotifications(data: any): { items: ApiNotification[]; unread: number } {
  const items: ApiNotification[] = data?.items ?? data?.notifications ?? []
  const unread = typeof data?.unreadCount === 'number' ? data.unreadCount : items.filter((n) => !n.isRead).length
  return { items, unread }
}

export function OpsProvider({ children }: { children: React.ReactNode }) {
  const [overview, setOverview] = useState<ApiOverview | null>(null)
  const [weather, setWeather] = useState<ApiWeather | null>(null)
  const [alerts, setAlerts] = useState<ApiNotification[]>([])
  const [unread, setUnread] = useState(0)
  const [unreadMessages, setUnreadMessages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reloadOverview = useCallback(async (options?: { silent?: boolean }) => {
    try {
      const res = await portalApi.overview(options)
      setOverview(res.data)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load marina overview')
    } finally {
      setLoading(false)
    }
  }, [])

  const reloadAlerts = useCallback(async (options?: { silent?: boolean }) => {
    const [notifications, chats] = await Promise.allSettled([
      notificationsApi.list({ limit: 30 }, options),
      chatApi.myChats(options),
    ])
    if (notifications.status === 'fulfilled') {
      const { items, unread: u } = readNotifications(notifications.value.data)
      setAlerts(items)
      setUnread(u)
    }
    if (chats.status === 'fulfilled') {
      // The server totals this across every thread, including archived ones and
      // any beyond the page just fetched. Summing the page undercounted.
      setUnreadMessages(
        typeof chats.value.data.unreadTotal === 'number'
          ? chats.value.data.unreadTotal
          : (chats.value.data.items ?? []).reduce((sum, c) => sum + (c.unreadCount ?? 0), 0),
      )
    }
  }, [])

  const reloadWeather = useCallback(async (options?: { silent?: boolean }) => {
    try {
      const res = await portalApi.weather(options)
      setWeather(res.data.weather)
    } catch {
      /* conditions are best-effort; the shell renders without them */
    }
  }, [])

  useEffect(() => {
    void reloadOverview()
    void reloadAlerts()
    void reloadWeather()
    // Background checks keep data live without a progress indicator or work in
    // hidden tabs. The visibility event catches up after an operator returns.
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      void reloadOverview({ silent: true })
      void reloadAlerts({ silent: true })
    }
    const refreshWeather = () => {
      if (document.visibilityState === 'visible') void reloadWeather({ silent: true })
    }
    const a = setInterval(refresh, OVERVIEW_REFRESH_MS)
    const c = setInterval(refreshWeather, WEATHER_REFRESH_MS)
    document.addEventListener('visibilitychange', refresh)
    return () => { clearInterval(a); clearInterval(c); document.removeEventListener('visibilitychange', refresh) }
  }, [reloadOverview, reloadAlerts, reloadWeather])

  // ── Live feed ────────────────────────────────────────────────────────────
  // Everything the marina needs to see in seconds rather than up to a minute:
  // a berth request waiting on a human, a boat inbound, a distress signal.
  useEffect(() => {
    // A notification is already a complete record, so it goes straight into the
    // feed — no refetch, and the badge moves on the same tick.
    const offNotification = onSocket('notification:new', (payload: ApiNotification) => {
      if (!payload?.id) return
      setAlerts((prev) => (prev.some((n) => n.id === payload.id) ? prev : [payload, ...prev].slice(0, 30)))
      setUnread((n) => n + 1)
    })

    // These carry an id and a status, not the row the board renders, so the
    // honest move is to re-read the overview rather than half-patch it.
    const offBerthRequested = onSocket('berth:requested', () => void reloadOverview({ silent: true }))
    const offBerthUpdated = onSocket('berth:updated', () => void reloadOverview({ silent: true }))
    const offMovement = onSocket('movement:updated', () => void reloadOverview({ silent: true }))
    const offIncident = onSocket('incident:new', () => void reloadOverview({ silent: true }))

    // An SOS reaches the operator as a notification too, but the overview
    // carries the open-incident count the sidebar badges read.
    const offEmergency = onSocket('emergency:sos', () => {
      void reloadOverview({ silent: true })
      void reloadAlerts({ silent: true })
    })

    // A reconnect means we were offline for an unknown span, so re-read
    // everything rather than trusting the events we may have missed.
    const socket = getSocket()
    const onReconnect = () => {
      void reloadOverview({ silent: true })
      void reloadAlerts({ silent: true })
    }
    socket?.on('connect', onReconnect)

    return () => {
      offNotification()
      offBerthRequested()
      offBerthUpdated()
      offMovement()
      offIncident()
      offEmergency()
      socket?.off('connect', onReconnect)
    }
  }, [reloadOverview, reloadAlerts])

  const badges = useMemo<Record<string, number>>(() => {
    if (!overview) return {}
    const counts = overview.reservationStatusCounts ?? {}
    const openMovements = [...overview.arrivals, ...overview.departures].filter(
      (m) => m.status === 'expected' || m.status === 'en_route',
    ).length
    return {
      pending: (counts.pending_approval ?? 0) + (counts.pending_payment ?? 0),
      movements: openMovements,
      services: overview.serviceRequests ?? 0,
      workOrders: overview.workOrders?.length ?? 0,
      documents: overview.expiringDocuments ?? 0,
      incidents: overview.openIncidents ?? 0,
      alerts: unread,
      messages: unreadMessages,
    }
  }, [overview, unread, unreadMessages])

  const value = useMemo(
    () => ({ overview, weather, alerts, unread, unreadMessages, badges, loading, error, reloadOverview, reloadAlerts }),
    [overview, weather, alerts, unread, unreadMessages, badges, loading, error, reloadOverview, reloadAlerts],
  )

  return <OpsContext.Provider value={value}>{children}</OpsContext.Provider>
}

export function useOps(): OpsContextValue {
  const ctx = useContext(OpsContext)
  if (!ctx) throw new Error('useOps must be used inside <OpsProvider>')
  return ctx
}
