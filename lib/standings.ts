import standingsSnapshot from "@/data/standings.json";

/** One team's row in a group table. */
export type StandingRow = {
  name: string;
  flag: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
  /** Newest-first W/D/L for the matches this team has actually completed. */
  form: ("W" | "D" | "L")[];
  /** ESPN's official advance note for this row, e.g. "Advance to Round of 32". */
  advance?: { label: string; color: string | null } | null;
};

export type GroupTable = {
  group: string;
  rows: StandingRow[];
  /** Matches counted (finished) vs total scheduled in the group. */
  played: number;
  total: number;
};

/**
 * All twelve group tables (A–L), mirrored from ESPN's authoritative standings
 * endpoint via scripts/build-standings.mjs → data/standings.json. We no longer
 * recompute from our local fixtures list because that list is a hand-maintained
 * projection that drifts from the real schedule (it knew 40 of the 60 games
 * actually played, so leaders showed one win instead of two). ESPN's snapshot
 * already applies the full FIFA tiebreak chain and carries each row in final
 * rank order, so we hand it straight through.
 */
export function groupTables(): GroupTable[] {
  return (standingsSnapshot.groups as GroupTable[]).map((g) => ({
    group: g.group,
    rows: g.rows.map((r) => ({
      ...r,
      form: (r.form ?? []) as ("W" | "D" | "L")[],
    })),
    played: g.played,
    total: g.total,
  }));
}
