import fixturesJson from "@/data/fixtures.json";
import resultsFile from "@/data/results.json";
import type { Fixture } from "./types";
import type { PlayerStatLine, MatchStats } from "./bets";
import { teamKey } from "./stats";

/**
 * Pre-match "form" read for the prediction pages: for each side of an upcoming
 * fixture, compile the players who featured in that TEAM'S LAST finished game
 * into simple leaderboards (top shooters, on-target, tacklers, keeper saves)
 * with a projection for how many they could do in the next game.
 *
 * Everything is computed at request time from the committed data/results.json
 * snapshot (the same file the /stats and match pages read) — no cron, no extra
 * fetch. The cron that refreshes results.json keeps this current automatically.
 */

type PersistedResult = {
  state: "live" | "finished";
  ft?: { home: number; away: number } | null;
  score?: { home: number; away: number };
  stats?: MatchStats;
};

const results = (resultsFile as { results: Record<string, PersistedResult> }).results;
const fixtures = fixturesJson as Fixture[];
const fixtureById: Record<string, Fixture> = Object.fromEntries(
  fixtures.map((f) => [f.id, f]),
);

/** One finished game a team played, with that team's per-player lines only. */
type TeamGame = {
  matchId: string;
  kickoffUTC: string;
  opponent: string;
  opponentFlag: string;
  side: "home" | "away";
  scoreLine: string;
  result: "W" | "D" | "L";
  players: PlayerStatLine[];
};

/** Every finished game a team has played, newest first, with their own lines. */
function teamGames(teamName: string): TeamGame[] {
  const k = teamKey(teamName);
  const out: TeamGame[] = [];
  for (const [id, r] of Object.entries(results)) {
    if (r.state !== "finished") continue;
    const fx = fixtureById[id];
    if (!fx) continue;
    const side: "home" | "away" | null =
      teamKey(fx.home.name) === k ? "home" : teamKey(fx.away.name) === k ? "away" : null;
    if (!side) continue;
    const opp = side === "home" ? fx.away : fx.home;
    const sc = r.ft ?? r.score ?? { home: 0, away: 0 };
    const mine = side === "home" ? sc.home : sc.away;
    const theirs = side === "home" ? sc.away : sc.home;
    out.push({
      matchId: id,
      kickoffUTC: fx.kickoffUTC,
      opponent: opp.name,
      opponentFlag: opp.flag,
      side,
      scoreLine: `${mine}–${theirs}`,
      result: mine > theirs ? "W" : mine < theirs ? "L" : "D",
      players: (r.stats?.players ?? []).filter((p) => p.team === side),
    });
  }
  out.sort((a, b) => +new Date(b.kickoffUTC) - +new Date(a.kickoffUTC));
  return out;
}

export type FormLeader = {
  name: string;
  num: number | null;
  /** Count in the team's last game. */
  last: number;
  /** Projected next-game count (recency-weighted mean, rounded). */
  proj: number;
  /** Ceiling — the player's best single game in this run. */
  high: number;
  /** Per-game average across games featured (1 dp). */
  avg: number;
  /** Games featured (for the "n gms" context). */
  games: number;
};

export type TeamForm = {
  team: string;
  flag: string;
  lastMatch: {
    opponent: string;
    opponentFlag: string;
    date: string;
    scoreLine: string;
    result: "W" | "D" | "L";
  } | null;
  shooters: FormLeader[];
  onTarget: FormLeader[];
  tacklers: FormLeader[];
  keepers: FormLeader[];
};

export type MatchForm = { home: TeamForm; away: TeamForm } | null;

type StatKey = "sh" | "sot" | "tk" | "sv";
const val = (p: PlayerStatLine, k: StatKey): number | undefined => {
  const v = (p as Record<string, unknown>)[k];
  return typeof v === "number" ? v : undefined;
};

/**
 * Build a leaderboard for one stat: top players from the LAST game, each with a
 * projection blended from their season-per-game average (60%) and last game
 * (40%) — recency-weighted, so a hot last game nudges the call up but doesn't
 * override the body of evidence. `high` is the ceiling (best single game).
 */
function leaders(
  games: TeamGame[],
  key: StatKey,
  { topN, keeperOnly = false }: { topN: number; keeperOnly?: boolean },
): FormLeader[] {
  const last = games[0];
  if (!last) return [];

  // Per-player season series for this stat (only games where it's a real count).
  const series = new Map<string, number[]>();
  for (const g of games) {
    for (const p of g.players) {
      if (keeperOnly && !isKeeper(p)) continue;
      const v = val(p, key);
      if (v == null) continue;
      const arr = series.get(p.name) ?? [];
      arr.push(v);
      series.set(p.name, arr);
    }
  }

  const pool = last.players
    .filter((p) => (keeperOnly ? isKeeper(p) : true))
    .map((p) => {
      const lastVal = val(p, key) ?? 0;
      const s = series.get(p.name) ?? [lastVal];
      const avg = s.reduce((a, b) => a + b, 0) / s.length;
      const high = Math.max(...s, lastVal);
      const proj = Math.max(0, Math.round(0.6 * avg + 0.4 * lastVal));
      return {
        name: p.name,
        num: p.num,
        last: lastVal,
        proj,
        high: Math.max(high, proj),
        avg: Math.round(avg * 10) / 10,
        games: s.length,
      };
    })
    // Keeper board keeps the keeper even on a quiet (0-save) game; the outfield
    // boards drop anyone who didn't register the stat at all last time.
    .filter((l) => keeperOnly || l.last > 0)
    .sort((a, b) => b.last - a.last || b.proj - a.proj);

  return pool.slice(0, topN);
}

function isKeeper(p: PlayerStatLine): boolean {
  return p.gk === true || p.pos === "G" || val(p, "sv") != null;
}

function buildTeamForm(teamName: string, flag: string): TeamForm {
  const games = teamGames(teamName);
  const last = games[0] ?? null;
  return {
    team: teamName,
    flag,
    lastMatch: last
      ? {
          opponent: last.opponent,
          opponentFlag: last.opponentFlag,
          date: last.kickoffUTC,
          scoreLine: last.scoreLine,
          result: last.result,
        }
      : null,
    shooters: leaders(games, "sh", { topN: 3 }),
    onTarget: leaders(games, "sot", { topN: 3 }),
    tacklers: leaders(games, "tk", { topN: 3 }),
    keepers: leaders(games, "sv", { topN: 1, keeperOnly: true }),
  };
}

/**
 * Pre-match form + projection for both sides of a fixture. Returns null when
 * neither side has a finished game with a player sheet to compile from (early in
 * the tournament), so the caller can simply omit the panel.
 */
export function matchForm(fixture: Fixture): MatchForm {
  const home = buildTeamForm(fixture.home.name, fixture.home.flag);
  const away = buildTeamForm(fixture.away.name, fixture.away.flag);
  const empty = (t: TeamForm) =>
    !t.lastMatch ||
    (t.shooters.length === 0 &&
      t.onTarget.length === 0 &&
      t.tacklers.length === 0 &&
      t.keepers.length === 0);
  if (empty(home) && empty(away)) return null;
  return { home, away };
}
