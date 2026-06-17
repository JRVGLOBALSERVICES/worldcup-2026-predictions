"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { LiveMatch } from "@/lib/live";

/**
 * Site-wide live-score context. One poller for the whole page (home grid or a
 * match detail page) drives every card via `useLive()`. Mirrors the /tracker
 * cadence: 5s while anything is live or near kickoff, 30s when only near, and
 * fully idle otherwise so we never hammer ESPN out of season.
 */
type LiveCtx = { matches: Record<string, LiveMatch>; updatedAt: number | null };
const Ctx = createContext<LiveCtx>({ matches: {}, updatedAt: null });

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
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      let anyLive = false;
      try {
        const res = await fetch("/api/live", { cache: "no-store" });
        if (res.ok) {
          const data: LivePayload = await res.json();
          if (!cancelled) {
            setMatches(data.matches ?? {});
            setUpdatedAt(data.updatedAt ?? Date.now());
            anyLive = !!data.anyLive;
          }
        }
      } catch {
        /* keep last known; retry next tick */
      }
      if (cancelled) return;
      const near = nearWindow(kickoffs, Date.now());
      // Fast (5s) while a match is actually live; slow (30s) when only near
      // kickoff; stop entirely when nothing is live and nothing is near.
      const delay = anyLive ? 5000 : near ? 30000 : 0;
      if (delay > 0) timer.current = setTimeout(tick, delay);
    }

    tick();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [kickoffs]);

  return <Ctx.Provider value={{ matches, updatedAt }}>{children}</Ctx.Provider>;
}

export function useLive(): LiveCtx {
  return useContext(Ctx);
}

/** Convenience: the live record for one fixture (undefined until it appears). */
export function useLiveMatch(matchId: string): LiveMatch | undefined {
  return useContext(Ctx).matches[matchId];
}
