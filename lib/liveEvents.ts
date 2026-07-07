import type { LiveMatch } from "./live";

/**
 * Discrete match happenings derived by DIFFING two consecutive /api/live
 * snapshots of the same fixture (the poller runs every 5s while live). Pure
 * data — components/LiveFX.tsx turns these into firecrackers / banners / event
 * chips. Every event is backed by a real feed delta (goal list grew, a boxscore
 * counter climbed, the match state flipped); nothing here is inferred from
 * wall-clock guesswork.
 */
export type LiveEventKind =
  | "goal"          // firecrackers — the headline moment
  | "sot"           // shot on target (Δ shotsOnTarget)
  | "shotOff"       // shot missed — off target (Δ shots − Δ SOT − Δ blocked)
  | "blocked"       // shot blocked (Δ blockedShots)
  | "save"          // keeper save — credited to the SAVING side (Δ saves)
  | "corner"        // Δ wonCorners
  | "yellow"        // new entry in the cards list
  | "red"
  | "foul"          // Δ foulsCommitted
  | "offside"       // Δ offsides
  | "possession"    // possession swung ≥ POSSESSION_SWING points toward a side
  | "sub"           // substitution (stats.subs list grew) — injury flag when ESPN says so
  | "lineups"       // confirmed team sheets landed (lineups appeared on the match)
  | "kickoff"       // state scheduled → live
  | "halftime"      // state live → halftime
  | "fulltime";     // state → finished

export type LiveEvent = {
  kind: LiveEventKind;
  /** Side the event belongs to (the scorer / shooter / booked side; for a save,
   * the side MAKING the save). Absent for whole-match moments (HT/FT). */
  team?: "home" | "away";
  /** Player name when the feed carries one (goals, cards; for a sub, the player
   * coming ON). */
  player?: string;
  minute?: number;
  /** Goal decoration. */
  penalty?: boolean;
  ownGoal?: boolean;
  assist?: string | null;
  /** possession: the new leader's share, rounded. */
  value?: number;
  /** sub: the player going OFF, and whether it was an injury change. */
  playerOff?: string;
  injury?: boolean;
};

/** Minimum poll-to-poll possession swing (percentage points) worth a chip. */
const POSSESSION_SWING = 5;

/** Cap on non-goal chips per diff — a tab waking from sleep can carry an hour
 * of deltas in one poll; spraying 20 chips reads as a bug, not a match. Goals
 * always survive the cap. */
const MAX_MINOR_EVENTS = 4;

const delta = (
  next: { home: number; away: number } | undefined,
  prev: { home: number; away: number } | undefined,
  side: "home" | "away",
): number => Math.max(0, (next?.[side] ?? 0) - (prev?.[side] ?? 0));

/**
 * Everything that happened between two snapshots, ordered headline-first
 * (goals → state flips → play events → possession). `prev` undefined (first
 * snapshot after mount) yields [] — the baseline is never announced.
 */
export function diffLiveEvents(prev: LiveMatch | undefined, next: LiveMatch): LiveEvent[] {
  if (!prev || prev.matchId !== next.matchId) return [];
  const out: LiveEvent[] = [];

  // ── Goals — from the chronological goal list growing.
  if (next.goals.length > prev.goals.length) {
    for (const g of next.goals.slice(prev.goals.length)) {
      out.push({
        kind: "goal",
        team: g.team,
        player: g.scorer !== "Unknown" ? g.scorer : undefined,
        minute: g.minute,
        penalty: g.penalty,
        ownGoal: g.ownGoal,
        assist: g.assist,
      });
    }
  } else {
    // Scoreboard can bump the score a poll or two before the scoring play lands
    // in the details list — still celebrate on the score alone.
    for (const side of ["home", "away"] as const) {
      const d = delta(next.score, prev.score, side);
      for (let i = 0; i < d; i++) out.push({ kind: "goal", team: side, minute: next.minute ?? undefined });
    }
  }

  // ── Substitutions — the subs list growing. Headline-tier (never capped):
  // a roster change freezes/starts a player's shot line, which is exactly what
  // a shots-prop slip needs to know the moment it happens.
  const prevSubs = prev.stats?.subs?.length ?? 0;
  for (const s of (next.stats?.subs ?? []).slice(prevSubs)) {
    out.push({
      kind: "sub",
      team: s.team,
      player: s.on || undefined,
      playerOff: s.off || undefined,
      minute: s.minute ?? undefined,
      injury: s.injury,
    });
  }

  // ── Confirmed line-ups landing (pre-kickoff team sheets published).
  if (!prev.lineups && next.lineups) out.push({ kind: "lineups" });

  // ── State flips.
  if (prev.state !== next.state) {
    if (prev.state === "scheduled" && (next.state === "live" || next.state === "halftime"))
      out.push({ kind: "kickoff" });
    else if (next.state === "halftime") out.push({ kind: "halftime" });
    else if (next.state === "finished") out.push({ kind: "fulltime" });
  }

  // ── Play events — boxscore counter deltas. Both snapshots need stats; the
  // first summary landing mid-match is a baseline, not 14 shots at once.
  const ps = prev.stats;
  const ns = next.stats;
  const minor: LiveEvent[] = [];
  if (ps && ns) {
    for (const team of ["home", "away"] as const) {
      // New cards carry player names via the cards list; counter deltas are the
      // fallback when the list lags the boxscore.
      const newCards = next.cards.slice(prev.cards.length).filter((c) => c.team === team);
      for (const c of newCards)
        minor.push({ kind: c.type === "red" ? "red" : "yellow", team, player: c.player, minute: c.minute });
      const dYellow = delta(ns.yellow, ps.yellow, team) - newCards.filter((c) => c.type === "yellow").length;
      const dRed = delta(ns.red, ps.red, team) - newCards.filter((c) => c.type === "red").length;
      for (let i = 0; i < dYellow; i++) minor.push({ kind: "yellow", team });
      for (let i = 0; i < dRed; i++) minor.push({ kind: "red", team });

      const dSot = delta(ns.sot, ps.sot, team);
      const dBlocked = delta(ns.tempo?.blockedShots, ps.tempo?.blockedShots, team);
      // Off-target = total shot attempts not on target and not blocked. Goals
      // are SOT, so they never double-count here.
      const dOff = Math.max(0, delta(ns.shots, ps.shots, team) - dSot - dBlocked);
      // An SOT that produced a goal this same diff is already celebrated as the
      // goal — don't chase the firecrackers with an "ON TARGET" chip.
      const goalsThisDiff = out.filter((e) => e.kind === "goal" && e.team === team).length;
      for (let i = 0; i < Math.max(0, dSot - goalsThisDiff); i++) minor.push({ kind: "sot", team });
      for (let i = 0; i < dOff; i++) minor.push({ kind: "shotOff", team });
      for (let i = 0; i < dBlocked; i++) minor.push({ kind: "blocked", team });
      for (let i = 0; i < delta(ns.tempo?.saves, ps.tempo?.saves, team); i++)
        minor.push({ kind: "save", team });
      for (let i = 0; i < delta(ns.corners, ps.corners, team); i++) minor.push({ kind: "corner", team });
      for (let i = 0; i < delta(ns.fouls, ps.fouls, team); i++) minor.push({ kind: "foul", team });
      for (let i = 0; i < delta(ns.tempo?.offsides, ps.tempo?.offsides, team); i++)
        minor.push({ kind: "offside", team });
    }

    // ── Possession swing — one chip for the side that gained ≥ threshold.
    const pPos = ps.tempo?.possession;
    const nPos = ns.tempo?.possession;
    if (pPos && nPos && (pPos.home > 0 || pPos.away > 0)) {
      const swing = nPos.home - pPos.home;
      if (Math.abs(swing) >= POSSESSION_SWING) {
        const team = swing > 0 ? "home" : "away";
        minor.push({ kind: "possession", team, value: Math.round(nPos[team]) });
      }
    }
  }

  return [...out, ...minor.slice(0, MAX_MINOR_EVENTS)];
}
