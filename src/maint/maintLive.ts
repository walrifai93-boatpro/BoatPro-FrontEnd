// ---------------------------------------------------------------------------
// Live updates for the maintenance portal.
//
// Unlike the marina and fuel portals, this one has no shared store — every page
// owns its own `useState` + `useEffect` fetch. Rather than rewrite seven pages
// onto a store just to get sockets, this is the small piece they opt into: give
// it your existing reload function and it runs on the relevant events.
//
// Polling stays wherever it already is. The socket makes the board live; if it
// drops, the desk falls back to a minute behind rather than going silent.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from 'react'
import { getSocket, onSocket } from '../socket'

/** Events the maintenance portal reacts to, mirroring the server's emitters. */
export const MAINT_EVENTS = [
  'maint:request:new',
  'maint:request:updated',
  'maint:workorder:updated',
  'maint:invoice:updated',
] as const

export type MaintLiveEvent = (typeof MAINT_EVENTS)[number]

/**
 * Re-runs `reload` whenever one of `events` arrives, and once on reconnect.
 *
 * `reload` is held in a ref so a caller can pass an inline arrow without
 * re-subscribing on every render — the usual way this kind of hook ends up
 * stacking listeners and firing a fetch storm.
 */
export function useMaintLive(reload: () => void, events: readonly MaintLiveEvent[] = MAINT_EVENTS): void {
  const reloadRef = useRef(reload)
  reloadRef.current = reload

  // Joined so a caller passing an inline array does not resubscribe each render.
  const key = events.join('|')

  useEffect(() => {
    const run = () => reloadRef.current()
    const offs = key.split('|').map((event) => onSocket(event, run))

    // A reconnect means an unknown span offline, so re-read rather than trust
    // the events that may have been missed while the socket was down.
    const socket = getSocket()
    socket?.on('connect', run)

    return () => {
      offs.forEach((off) => off())
      socket?.off('connect', run)
    }
  }, [key])
}
