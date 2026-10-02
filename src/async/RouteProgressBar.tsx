// ---------------------------------------------------------------------------
// RouteProgressBar — the thin sliver across the top of the portal.
//
//   ━━━━━━━━━━░░░
//
// Indeterminate by design: we do not know how long a request will take, so it
// sweeps rather than claiming a percentage (§38 — never fabricate progress).
//
// It appears only after APPEAR_DELAY of continuous activity, which keeps it from
// strobing on a fast connection where most requests settle in under 150ms, and
// fades out rather than cutting so a finished request reads as "done".
//
// The animation is CSS (see the keyframes injected below) rather than
// framer-motion: this element is mounted for the whole session and must not
// re-render on every frame.
// ---------------------------------------------------------------------------
import React from 'react';
import { useIsNetworkBusy } from './activity';
import { useDelayedFlag } from './hooks';

/** Requests shorter than this never draw the bar at all. */
const APPEAR_DELAY = 400;

export function RouteProgressBar() {
  const busy = useIsNetworkBusy();
  const visible = useDelayedFlag(busy, APPEAR_DELAY);

  return (
    <div
      // Decorative: the operation itself announces via toast or a busy state, so
      // duplicating it here would only make screen readers chatty.
      aria-hidden
      className={`pointer-events-none fixed inset-x-0 top-0 z-[9998] h-[3px] overflow-hidden bg-ocean-500/15 transition-opacity duration-300 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div className="bp-route-sweep h-full w-[45%] rounded-full bg-gradient-to-r from-ocean-400 via-ocean-500 to-ocean-300" />
      <style>{`
        @keyframes bp-route-sweep {
          0%   { transform: translateX(-110%); }
          100% { transform: translateX(240%); }
        }
        .bp-route-sweep { animation: bp-route-sweep 1.15s ease-in-out infinite; }
        /* Reduced motion: a static filled track still conveys "working". */
        @media (prefers-reduced-motion: reduce) {
          .bp-route-sweep { animation: none; width: 100%; opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
