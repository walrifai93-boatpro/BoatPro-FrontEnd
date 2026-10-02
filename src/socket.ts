// ---------------------------------------------------------------------------
// The portal's live connection.
//
// Until this existed the portal had no socket at all: it polled the overview
// and alert feeds on a 60-second timer, so every berth request, movement and
// distress signal was up to a minute stale. Polling stays as the fallback —
// a dropped socket must degrade to "a minute behind", never to "silent" — but
// the socket is what makes the desk feel live.
//
// One long-lived connection for the whole tab, created lazily and reused across
// sign-in/sign-out rather than recreated, so listeners registered once keep
// working across reconnects instead of being silently dropped.
// ---------------------------------------------------------------------------

import { io, type Socket } from 'socket.io-client';
import { API_URL, getToken } from './api';

/** Socket.IO attaches to the server origin, not the `/api/v1` REST base. */
const SOCKET_ORIGIN = API_URL.replace(/\/api\/v\d+\/?$/, '');

let socket: Socket | null = null;

function ensureSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_ORIGIN, {
      autoConnect: false,
      // The portal runs in a browser behind whatever proxy the deployment sits
      // on, so polling has to stay available as a transport fallback — unlike
      // the mobile apps, which can assume websockets.
      transports: ['websocket', 'polling'],
    });
  }
  return socket;
}

/**
 * Connects, or reconnects with a fresh token.
 *
 * Safe to call on every auth change: an existing connection is torn down first
 * so the handshake carries the current token rather than a stale one.
 */
export function connectSocket(token?: string | null): Socket | null {
  const auth = token ?? getToken();
  if (!auth) return null;

  const s = ensureSocket();
  s.auth = { token: auth };
  if (s.connected) s.disconnect();
  s.connect();
  return s;
}

export function disconnectSocket(): void {
  socket?.disconnect();
}

/**
 * The tab's socket, created on first ask rather than on first connect.
 *
 * This used to return the module-level `socket` as-is, which is `null` until
 * `connectSocket()` has run — and `connectSocket()` runs in `AuthProvider`'s
 * `useEffect([status])`, a *parent* effect. React runs effects child-first, so
 * on the commit where `status` becomes `authed` the portal shell mounts and
 * every store registers its listeners *before* the provider's effect creates
 * the socket. They all got `null` back, `onSocket` returned a no-op, and not
 * one listener was ever registered: `opsStore`, `AdminLayout`, `MaintLayout`,
 * `fuelStore`, `maintLive` and `ProviderApprovals` alike.
 *
 * None of those providers remounts on in-portal navigation, so the live layer
 * stayed dead for the whole session — the desk silently fell back to the
 * 60-second poll that was only ever meant to be the floor, which is why it was
 * not obvious: the numbers did still move, just a minute late, including the
 * `emergency:sos` the socket exists for.
 *
 * Creating it here is safe because `autoConnect` is false: this hands back an
 * idle socket that carries no handshake until `connectSocket()` supplies a
 * token. Handlers attached to it now survive that connect, every reconnect and
 * every sign-out/sign-in, which is exactly the lifetime the callers assume.
 */
export function getSocket(): Socket {
  return ensureSocket();
}

/**
 * Registers a handler and returns its unsubscribe.
 *
 * Written to be called from an effect: returning the cleanup directly is what
 * stops React's strict-mode double-invoke from stacking two copies of every
 * listener, which would double-count each alert.
 */
export function onSocket(event: string, handler: (payload: never) => void): () => void {
  const s = ensureSocket();
  s.on(event, handler as (...args: unknown[]) => void);
  return () => {
    s.off(event, handler as (...args: unknown[]) => void);
  };
}
