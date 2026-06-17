"use client";

import { useEffect, useState } from "react";
import { useLive } from "./LiveProvider";

/**
 * Visible "next refresh" countdown — ticks 5,4,3,2,1 then a brief "refreshing"
 * pulse, synced to the live poller's next fetch (`nextAt`). Renders nothing when
 * nothing is live, since the poller idles then and there's nothing to count to.
 * Pure visual: it never fetches; it just reads when the next poll is scheduled.
 */
export function RefreshCountdown({
  nextAt,
  active,
  interval = 5000,
}: {
  nextAt: number | null;
  active: boolean;
  interval?: number;
}) {
  // `now` stays null until mounted on the client, so SSR and first paint match.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!active) {
      setNow(null);
      return;
    }
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [active, nextAt]);

  if (!active || nextAt == null || now == null) return null;

  const remaining = nextAt - now;
  const refreshing = remaining <= 0;
  const secs = Math.max(0, Math.min(Math.round(interval / 1000), Math.ceil(remaining / 1000)));
  const frac = Math.max(0, Math.min(1, remaining / interval));

  const R = 9;
  const C = 2 * Math.PI * R;

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-acid-dim px-2.5 py-1 font-mono text-[0.62rem] uppercase tracking-wider text-acid"
      aria-live="off"
      title="Live scores auto-refresh every 5 seconds"
    >
      <span className="relative grid size-5 place-items-center">
        <svg viewBox="0 0 24 24" className="absolute inset-0 -rotate-90" aria-hidden>
          <circle cx="12" cy="12" r={R} fill="none" stroke="currentColor" strokeOpacity={0.18} strokeWidth={2.5} />
          <circle
            cx="12"
            cy="12"
            r={R}
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - frac)}
            className="transition-[stroke-dashoffset] duration-200 ease-linear motion-reduce:transition-none"
          />
        </svg>
        <span className="tnum text-[0.6rem] font-bold leading-none">{refreshing ? "↻" : secs}</span>
      </span>
      {refreshing ? "Refreshing…" : "Next refresh"}
    </span>
  );
}

/** Context-connected variant for pages wrapped in <LiveProvider> (home, match). */
export function LiveRefreshPill() {
  const { nextRefreshAt, anyLive } = useLive();
  return <RefreshCountdown nextAt={nextRefreshAt} active={anyLive} />;
}
