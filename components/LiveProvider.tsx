"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { LiveMatch } from "@/lib/live";

/**
 * Site-wide live-score context. One poller for the whole page (home grid or a
 * match detail page) drives every card via `useLive()`. Mirrors the /tracker
 * cadence: 5s while anything is live or near kickoff, 30s when only near, and
 * fully idle otherwise so we never hammer ESPN out of season.
 */
type LiveCtx = {
  matches: Record<string, LiveMatch>;
  updatedAt: number | null;
  /** Epoch ms when the next poll fires — drives the visible refresh countdown. */
  nextRefreshAt: number | null;
  /** True while any tracked fixture is live or at half-time (fast 5s cadence). */
  anyLive: boolean;
  /** Force an immediate fetch now, bypassing the poll cadence. */
  refresh: () => void;
  /** True while a manual force-update fetch is in flight. */
  refreshing: boolean;
};
const Ctx = createContext<LiveCtx>({
  matches: {},
  updatedAt: null,
  nextRefreshAt: null,
  anyLive: false,
  refresh: () => {},
  refreshing: false,
});

type LivePayload = { updatedAt: number; anyLive: boolean; matches: Record<string, LiveMatch> };

function nearWindow(kickoffs: string[], nowMs: number): boolean {
  return kickoffs.some((iso) => {
    const ko = new Date(iso).getTime();
    return nowMs >= ko - 15 * 60 * 1000 && nowMs <= ko + 3 * 60 * 60 * 1000;
  });
}

export function LiveProvider({
  kickoffs,
  children,
}: {
  kickoffs: string[];
  children: React.ReactNode;
}) {
  const [matches, setMatches] = useState<Record<string, LiveMatch>>({});
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [nextRefreshAt, setNextRefreshAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelled = useRef(false);
  const inFlight = useRef(false);

  // One fetch + reschedule, held in a ref so the auto-poller and the manual
  // force-update button run the exact same path. Assigned in an effect (commit
  // phase, never during render) and kept fresh each render so it always closes
  // over the latest `kickoffs`. `manual` flips the spinner and is what lets the
  // button pull data even when the poller has idled.
  const tick = useRef<(manual?: boolean) => Promise<void>>(async () => {});
  useEffect(() => {
    tick.current = async (manual = false) => {
      if (inFlight.current) return; // never overlap fetches
      inFlight.current = true;
      if (manual) setRefreshing(true);
      let anyLive = false;
      try {
        const res = await fetch("/api/live", { cache: "no-store" });
        if (res.ok) {
          const data: LivePayload = await res.json();
          if (!cancelled.current) {
            setMatches(data.matches ?? {});
            setUpdatedAt(data.updatedAt ?? Date.now());
            anyLive = !!data.anyLive;
          }
        }
      } catch {
        /* keep last known; retry next tick */
      } finally {
        inFlight.current = false;
        if (manual) setRefreshing(false);
      }
      if (cancelled.current) return;
      const near = nearWindow(kickoffs, Date.now());
      // Fast (5s) while a match is actually live; slow (30s) when only near
      // kickoff; stop entirely when nothing is live and nothing is near.
      const delay = anyLive ? 5000 : near ? 30000 : 0;
      if (timer.current) clearTimeout(timer.current);
      if (delay > 0) {
        setNextRefreshAt(Date.now() + delay);
        timer.current = setTimeout(() => tick.current(), delay);
      } else {
        setNextRefreshAt(null);
      }
    };
  });

  useEffect(() => {
    cancelled.current = false;
    tick.current();
    return () => {
      cancelled.current = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [kickoffs]);

  // Manual pull: cancel the pending tick and fetch right now.
  const refresh = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    tick.current(true);
  }, []);

  const anyLive = Object.values(matches).some(
    (m) => m.state === "live" || m.state === "halftime",
  );

  return (
    <Ctx.Provider value={{ matches, updatedAt, nextRefreshAt, anyLive, refresh, refreshing }}>{children}</Ctx.Provider>
  );
}

export function useLive(): LiveCtx {
  return useContext(Ctx);
}

/** Convenience: the live record for one fixture (undefined until it appears). */
export function useLiveMatch(matchId: string): LiveMatch | undefined {
  return useContext(Ctx).matches[matchId];
}
