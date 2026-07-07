"use client";

import type { Fixture, Prediction } from "@/lib/types";
import { useLiveMatch } from "./LiveProvider";
import { LineupPitch } from "./LineupPitch";

/**
 * Live-aware wrapper around the formation board. The static path (predictions
 * .json, refreshed by the build-lineups cron) can lag ESPN's team-sheet drop by
 * up to a cron cycle; the /api/live poll now carries the confirmed XIs the
 * moment they're published (~1h pre-kickoff). When the live feed has them, this
 * swaps the probable/board data for the REAL sheet — real numbers, formation,
 * positions — without waiting for a rebuild. Falls back to the static lineups
 * (probable or cron-confirmed) until then.
 */
export function LiveLineup({ fixture, lineups }: { fixture: Fixture; lineups: Prediction["lineups"] }) {
  const lm = useLiveMatch(fixture.id);
  const live = lm?.lineups;
  const merged = live
    ? {
        ...lineups,
        status: "confirmed" as const,
        homeXI: live.home,
        awayXI: live.away,
        home: live.home.players.map((p) => p.name).join(", "),
        away: live.away.players.map((p) => p.name).join(", "),
      }
    : lineups;
  return <LineupPitch fixture={fixture} lineups={merged} />;
}
