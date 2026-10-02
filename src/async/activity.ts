// ---------------------------------------------------------------------------
// In-flight request counter, for the global top progress bar.
//
// §21 wants a global indicator; it also warns against showing one for "every
// tiny request". Both are satisfied by two gates:
//
//  1. Opt-out per request — a poller, a typeahead or a background refresh passes
//     `{ silent: true }` and never touches the counter. Chat polling lighting up
//     a page-level bar every 5s would be pure noise.
//  2. A delay before the bar appears (see RouteProgressBar). A 120ms request
//     finishes before the bar is ever drawn.
//
// This is a counter rather than a boolean because concurrent requests are the
// norm on a dashboard: five parallel fetches must not have the first one to
// return switch the bar off while four are still running.
// ---------------------------------------------------------------------------
import { useSyncExternalStore } from 'react';

let count = 0;
/**
 * The subset of `count` that may raise the full-screen LoadingOverlay. Uploads
 * are left out — they draw their own progress, and a blur over a progress bar
 * would hide the one thing worth watching.
 */
let overlayCount = 0;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((l) => l());

/** `overlay: false` counts the request for the top bar only. */
export function beginActivity(opts: { overlay?: boolean } = {}) {
  count += 1;
  if (opts.overlay !== false) overlayCount += 1;
  notify();
}

/** Must be called with the same `overlay` the matching `beginActivity` had. */
export function endActivity(opts: { overlay?: boolean } = {}) {
  count = Math.max(0, count - 1);
  if (opts.overlay !== false) overlayCount = Math.max(0, overlayCount - 1);
  notify();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

const getSnapshot = () => count > 0;

/** True while any tracked request is in flight. */
export function useIsNetworkBusy(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

const getOverlaySnapshot = () => overlayCount > 0;

/** True while a request that may cover the screen is in flight — see LoadingOverlay. */
export function useIsOverlayBusy(): boolean {
  return useSyncExternalStore(subscribe, getOverlaySnapshot, getOverlaySnapshot);
}

/** Escape hatch for non-`request()` async work that should still drive the bar. */
export async function withActivity<T>(work: Promise<T>): Promise<T> {
  beginActivity();
  try {
    return await work;
  } finally {
    endActivity();
  }
}

// ---------------------------------------------------------------------------
// Blocking-operation registry (§26 — navigation protection)
//
// An in-flight document upload or a form with unsaved edits must not be
// discarded because the user clicked a nav link. Screens register while such
// work is pending; `useUnloadGuard` and the in-app link guard consult this.
// ---------------------------------------------------------------------------
const reasons = new Map<string, string>();
const blockListeners = new Set<() => void>();

const notifyBlock = () => blockListeners.forEach((l) => l());

/** Declare that leaving now would lose work. Returns the release function. */
export function blockNavigation(id: string, reason: string): () => void {
  reasons.set(id, reason);
  notifyBlock();
  return () => {
    reasons.delete(id);
    notifyBlock();
  };
}

function subscribeBlock(l: () => void) {
  blockListeners.add(l);
  return () => blockListeners.delete(l);
}

/** The first active reason, or null when it is safe to navigate. */
export function getNavigationBlockReason(): string | null {
  const first = reasons.values().next();
  return first.done ? null : first.value;
}

export function useNavigationBlockReason(): string | null {
  return useSyncExternalStore(subscribeBlock, getNavigationBlockReason, getNavigationBlockReason);
}
