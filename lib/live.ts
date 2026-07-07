import { fixtures } from "./data";
import type {
  Goal,
  Card,
  MatchStats,
  GoalMethod,
  WaterBreakAction,
  PlayerShotLine,
  Substitution,
} from "./bets";
import type { LineupXI } from "./types";
import resultsFile from "@/data/results.json";

/** Persisted ESPN snapshots (written by scripts/build-results.mjs). */
type PersistedResult = {
  state: "live" | "finished";
  ht: { home: number; away: number } | null;
  ft: { home: number; away: number } | null;
  ft90?: { home: number; away: number } | null;
  finishPhase?: "regulation" | "extra_time" | "penalties" | null;
  /** Knockout: which side PROGRESSED (set by build-results.mjs once the tie,
   * incl. ET/pens, is final). This is the only signal that resolves a level
   * final — a 1–1 decided on penalties leaves the score tied, so a "to qualify"
   * leg can only settle off `advanced`, never the scoreline. */
  advanced?: "home" | "away" | null;
  score: { home: number; away: number };
  goals: {
    team: "home" | "away";
    scorer: string;
    minute: number | null;
    assist: string | null;
    penalty: boolean;
    ownGoal: boolean;
    et?: boolean;
  }[];
  cards?: {
    team: "home" | "away";
    player: string;
    minute: number | null;
    type: "yellow" | "red";
  }[];
  stats?: MatchStats;
  updatedAt: string;
};
const persistedResults = (resultsFile as { results: Record<string, PersistedResult> }).results;

/**
 * Static (build-time) check against the official feed: is this match persisted
 * as FINISHED in results.json? Lets server components decide a day/match is over
 * from real final state instead of a blind "kickoff + N minutes" guess. The time
 * guess is wrong by construction — a match runs 90' + ~15' HT + stoppage (~130'
 * wall-clock for a group game) and a knockout can reach ~3 h with extra time and
 * penalties — so any fixed window fires while the match is still being played.
 */
export function isMatchFinished(matchId: string): boolean {
  return persistedResults[matchId]?.state === "finished";
}

const ESPN_SUMMARY =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary";

/** Confirmed XIs off ESPN's published team sheet, oriented to our home/away. */
export type LiveLineups = { home: LineupXI; away: LineupXI };

/**
 * Per-event summary feed. Returns the verified stats (corners / SOT / cards),
 * the richer goal list — scorer + assister + minute — which the cheap
 * scoreboard `details` feed omits during live play, and the confirmed line-ups
 * once ESPN publishes the team sheet (~1h pre-kickoff). `stats` is null when
 * the boxscore hasn't populated yet (incl. pre-kickoff); `goals` rides on the
 * keyEvents; `lineups` is null until the sheet is out. All oriented to our
 * home/away.
 */
async function fetchStats(
  eventId: string,
  matchId: string,
): Promise<{ stats: MatchStats | null; goals: Goal[]; lineups: LiveLineups | null } | null> {
  const fx = fixtures.find((f) => f.id === matchId);
  if (!fx) return null;
  let data: EspnSummary;
  try {
    const res = await fetch(`${ESPN_SUMMARY}?event=${eventId}`, {
      cache: "no-store",
      headers: { "User-Agent": "matchday-edge/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    data = (await res.json()) as EspnSummary;
  } catch {
    return null;
  }
  const homeName = norm(fx.home.name);
  const goals = goalsFromKeyEvents(data.keyEvents, homeName);
  const lineups = lineupsFromRosters(data.rosters, homeName);

  const teams = data.boxscore?.teams;
  if (!Array.isArray(teams) || teams.length < 2) return { stats: null, goals, lineups };
  const side = (espnName?: string) => (norm(espnName ?? "") === homeName ? "home" : "away");
  const stat = (t: EspnStatTeam | undefined, name: string): number => {
    const s = (t?.statistics ?? []).find((x) => x.name === name);
    const n = s ? Number(s.displayValue ?? s.value) : NaN;
    return Number.isFinite(n) ? n : 0;
  };

  const wbH1 = waterBreakAction(data.commentary, 1);
  const wbH2 = waterBreakAction(data.commentary, 2);

  const byName: Partial<Record<"home" | "away", EspnStatTeam>> = {};
  for (const t of teams) byName[side(t.team?.displayName)] = t;
  const h = byName.home;
  const a = byName.away;
  if (!h || !a) return { stats: null, goals, lineups };

  const yellow = { home: stat(h, "yellowCards"), away: stat(a, "yellowCards") };
  const red = { home: stat(h, "redCards"), away: stat(a, "redCards") };

  const cornersByHalf = { home: [0, 0] as [number, number], away: [0, 0] as [number, number] };
  const sotByHalf = { home: [0, 0] as [number, number], away: [0, 0] as [number, number] };
  const playerSot: Record<string, number> = {};
  const playerShots: Record<string, number> = {};
  const playerShotBreakdown: Record<string, PlayerShotLine> = {};
  const subs: Substitution[] = [];
  // A play counts toward TOTAL shots if it's any shot attempt ("Shot On Target/
  // Off Target/Blocked/Hit Woodwork") or a goal (own goals excluded — not a shot
  // for the "scorer"). This tally matches the boxscore totalShots team stat.
  const isShotPlay = (t: string) =>
    t.startsWith("Shot") || (t.startsWith("Goal") && !t.includes("Own")) || t === "Penalty - Scored";
  for (const c of data.commentary ?? []) {
    const p = c.play;
    const text = p?.type?.text;
    if (!text || !p?.team?.displayName) continue;
    if (isShotPlay(text)) {
      // Attribute the attempt to its taker for the per-player TOTAL shots tally.
      const taker = p.participants?.[0]?.athlete?.displayName;
      if (taker) {
        playerShots[taker] = (playerShots[taker] ?? 0) + 1;
        // Full breakdown line for the live player-shots board. A goal counts as
        // on target (boxscore convention); woodwork counts as off target.
        const line = (playerShotBreakdown[taker] ??= {
          team: side(p.team.displayName),
          shots: 0,
          sot: 0,
          off: 0,
          blocked: 0,
          goals: 0,
        });
        line.shots += 1;
        if (text.startsWith("Goal") || text === "Penalty - Scored") {
          line.goals += 1;
          line.sot += 1;
        } else if (text === "Shot On Target") line.sot += 1;
        else if (text.startsWith("Shot Blocked")) line.blocked += 1;
        else line.off += 1; // Shot Off Target / Shot Hit Woodwork
      }
    }
    if (text === "Substitution") {
      // Opta prose: "Substitution, <Team>. <On> replaces <Off>." — injury
      // changes end "… because of an injury." The prose is the reliable order;
      // participants back it up ([0] = coming on, [1] = going off).
      const prose = c.text ?? "";
      const m = prose.match(/([^,.]+?)\s+replaces\s+([^,.]+?)(?:\s+because of an injury)?\s*\.?\s*$/i);
      const pa = p.participants ?? [];
      const on = m?.[1]?.trim() ?? pa[0]?.athlete?.displayName ?? "";
      const off = m?.[2]?.trim() ?? pa[1]?.athlete?.displayName ?? "";
      if (on || off) {
        subs.push({
          team: side(p.team.displayName),
          minute: p.clock?.value != null ? Math.round(p.clock.value / 60) : null,
          on,
          off,
          injury: /injur/i.test(prose),
        });
      }
    }
    if (text !== "Corner Awarded" && text !== "Shot On Target") continue;
    const s = side(p.team.displayName);
    // ET plays (period ≥ 3) stay OUT of the per-half buckets — half markets
    // and the FT corner-count 1X2 are regulation-90 (book rule). Per-player
    // tallies keep the whole match (they mirror the boxscore team totals).
    const period = p.period?.number ?? 1;
    const idx = period === 1 ? 0 : 1;
    if (text === "Corner Awarded") {
      if (period <= 2) cornersByHalf[s][idx] += 1;
    } else {
      if (period <= 2) sotByHalf[s][idx] += 1;
      // Attribute the shot to its taker (the first participant) for per-player props.
      const shooter = p.participants?.[0]?.athlete?.displayName;
      if (shooter) playerSot[shooter] = (playerSot[shooter] ?? 0) + 1;
    }
  }

  return {
    stats: {
      corners: { home: stat(h, "wonCorners"), away: stat(a, "wonCorners") },
      sot: { home: stat(h, "shotsOnTarget"), away: stat(a, "shotsOnTarget") },
      shots: { home: stat(h, "totalShots"), away: stat(a, "totalShots") },
      yellow,
      red,
      cards: { home: yellow.home + red.home, away: yellow.away + red.away },
      fouls: { home: stat(h, "foulsCommitted"), away: stat(a, "foulsCommitted") },
      cornersByHalf,
      sotByHalf,
      playerSot,
      playerShots,
      playerShotBreakdown,
      // Commentary arrives newest-first; the subs log reads oldest-first.
      subs: subs.sort((x, y) => (x.minute ?? 999) - (y.minute ?? 999)),
      firstGoalMethod: firstGoalMethod(data.keyEvents),
      firstPenalty: firstPenaltyTeam(data.keyEvents, homeName),
      waterBreak: { ...(wbH1 ? { h1: wbH1 } : {}), ...(wbH2 ? { h2: wbH2 } : {}) },
      // Tempo block — the full-picture stats the live view animates. Same
      // boxscore statistics list as the settling counts above; keep the names
      // in sync with scripts/build-results.mjs statsFromSummary.
      tempo: {
        possession: { home: stat(h, "possessionPct"), away: stat(a, "possessionPct") },
        passes: { home: stat(h, "totalPasses"), away: stat(a, "totalPasses") },
        tackles: { home: stat(h, "totalTackles"), away: stat(a, "totalTackles") },
        saves: { home: stat(h, "saves"), away: stat(a, "saves") },
        offsides: { home: stat(h, "offsides"), away: stat(a, "offsides") },
        blockedShots: { home: stat(h, "blockedShots"), away: stat(a, "blockedShots") },
        interceptions: { home: stat(h, "interceptions"), away: stat(a, "interceptions") },
        clearances: { home: stat(h, "effectiveClearance"), away: stat(a, "effectiveClearance") },
      },
    },
    goals,
    lineups,
  };
}

/**
 * Confirmed XIs from the summary `rosters` — real formation, shirt numbers and
 * position codes, oriented to our home/away. Null until ESPN publishes BOTH
 * team sheets (~1h pre-kickoff). Mirrors scripts/build-lineups.mjs teamXI —
 * keep the two in sync.
 */
function lineupsFromRosters(
  rosters: EspnRosterTeam[] | undefined,
  homeName: string,
): LiveLineups | null {
  if (!Array.isArray(rosters) || rosters.length < 2) return null;

  const teamXI = (rt: EspnRosterTeam | undefined): LineupXI | null => {
    if (!rt) return null;
    const starters = (rt.roster ?? []).filter((p) => p.starter);
    if (starters.length < 11) return null; // sheet not confirmed yet

    // GK first (defensive — ESPN already orders it so), then the rest as listed.
    const ordered = [
      ...starters.filter((p) => (p.position?.abbreviation ?? "") === "G"),
      ...starters.filter((p) => (p.position?.abbreviation ?? "") !== "G"),
    ];
    const players = ordered.map((p) => {
      const num = parseInt(p.jersey ?? p.athlete?.jersey ?? "", 10);
      return {
        num: Number.isFinite(num) ? num : null,
        name: p.athlete?.displayName ?? p.athlete?.fullName ?? "Unknown",
        pos: p.position?.abbreviation ?? "",
      };
    });

    const formation =
      typeof rt.formation === "string" && /^\d(-\d){1,3}$/.test(rt.formation)
        ? rt.formation
        : players
            .slice(1)
            .reduce(
              (acc, p) => {
                acc[p.pos === "D" ? 0 : p.pos === "F" ? 2 : 1]++;
                return acc;
              },
              [0, 0, 0],
            )
            .filter((n) => n > 0)
            .join("-");

    return { formation, players };
  };

  const bySide: Partial<Record<"home" | "away", EspnRosterTeam>> = {};
  for (const t of rosters) {
    bySide[norm(t.team?.displayName ?? "") === homeName ? "home" : "away"] = t;
  }
  const home = teamXI(bySide.home);
  const away = teamXI(bySide.away);
  if (!home || !away) return null;
  return { home, away };
}

/** Map a durable persisted result into the LiveMatch shape the UI consumes. */
function persistedToLiveMatch(matchId: string, r: PersistedResult): LiveMatch {
  const score = r.ft ?? r.score;
  return {
    matchId,
    state: r.state,
    statusDetail:
      r.state === "finished"
        ? r.finishPhase === "penalties"
          ? "FT (pens)"
          : r.finishPhase === "extra_time"
            ? "FT (AET)"
            : "FT"
        : "Live",
    minute: null,
    period: 2,
    score,
    htScore: r.ht,
    ftScore: r.ft ?? (r.state === "finished" ? score : null),
    finishPhase: r.finishPhase ?? null,
    advanced: r.advanced ?? null,
    goals: r.goals.map((g) => ({
      team: g.team,
      scorer: g.scorer,
      minute: g.minute ?? undefined,
      assist: g.assist,
      penalty: g.penalty,
      ownGoal: g.ownGoal,
      ...(g.et === true ? { et: true } : {}),
    })),
    cards: (r.cards ?? []).map((c) => ({
      team: c.team,
      player: c.player,
      minute: c.minute ?? undefined,
      type: c.type,
    })),
    stats: r.stats,
  };
}

/**
 * Live score ingestion from ESPN's public, keyless soccer scoreboard.
 * Endpoint: site.api.espn.com/.../soccer/fifa.world/scoreboard?dates=YYYYMMDD
 * It returns every World-Cup fixture for a date with status, current score and a
 * `details` array of scoring plays (scorer + assist via athletesInvolved, minute,
 * penalty/own-goal flags) — everything we need to settle bets in-play without a
 * heavier per-match summary call. Server-only (called from the /api/live route).
 */

const ESPN_BASE =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";

export type LiveState = "scheduled" | "live" | "halftime" | "finished";

export type LiveMatch = {
  matchId: string;
  state: LiveState;
  /** Short status, e.g. "23'", "HT", "FT", or a kickoff time string. */
  statusDetail: string;
  /** Parsed match minute when live, else null. */
  minute: number | null;
  period: number;
  /** Scores oriented to OUR fixture's home/away (ESPN orientation is normalised). */
  score: { home: number; away: number };
  htScore: { home: number; away: number } | null;
  ftScore: { home: number; away: number } | null;
  /** ESPN-verified match-end phase (knockout only). Absent until finished. */
  finishPhase?: "regulation" | "extra_time" | "penalties" | null;
  /** Knockout: which side advanced (ET/pens aware). Carries the persisted
   * `advanced` so the live grader can settle a level final's "to qualify" leg. */
  advanced?: "home" | "away" | null;
  goals: Goal[];
  cards: Card[];
  /** Verified corner/SOT/card counts — present once the summary endpoint has data. */
  stats?: MatchStats;
  /** Confirmed XIs — present from the moment ESPN publishes the team sheet
   * (~1h pre-kickoff), including on a still-scheduled match. */
  lineups?: LiveLineups | null;
};

// ESPN occasionally spells a nation differently from our fixtures. Map the few
// that don't survive a plain alpha-strip comparison.
const ALIAS: Record<string, string> = {
  congodr: "drcongo",
  drc: "drcongo",
  korearepublic: "southkorea",
  iranislamicrepublic: "iran",
  iriran: "iran",
  turkiye: "turkey",
  trkiye: "turkey", // ESPN "Türkiye" — diacritic stripped by norm()
  unitedstates: "usa",
  unitedstatesofamerica: "usa",
  czechia: "czechrepublic",
  capeverde: "caboverde",
  cotedivoire: "ivorycoast",
  bosniaherzegovina: "bosnia", // ESPN "Bosnia-Herzegovina"
  curaao: "curacao", // ESPN "Curaçao" — ç stripped by norm()
};

const norm = (s: string): string => {
  const a = s.toLowerCase().replace(/[^a-z]/g, "");
  return ALIAS[a] ?? a;
};

/** YYYYMMDD in UTC, the param ESPN's scoreboard expects. */
function dateParam(d: Date): string {
  return [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, "0"),
    String(d.getUTCDate()).padStart(2, "0"),
  ].join("");
}

/** Resolve which ESPN competitor name belongs to our fixture's home / away. */
function matchFixture(homeName: string, awayName: string): string | null {
  const h = norm(homeName);
  const a = norm(awayName);
  for (const f of fixtures) {
    const fh = norm(f.home.name);
    const fa = norm(f.away.name);
    if (fh === h && fa === a) return f.id;
    // ESPN lists the pairing either way round; accept the swap and we re-orient.
    if (fh === a && fa === h) return f.id;
  }
  return null;
}

type EspnAthlete = { displayName?: string };
type EspnDetail = {
  type?: { text?: string };
  clock?: { value?: number; displayValue?: string };
  team?: { id?: string };
  scoringPlay?: boolean;
  penaltyKick?: boolean;
  ownGoal?: boolean;
  shootout?: boolean;
  yellowCard?: boolean;
  redCard?: boolean;
  athletesInvolved?: EspnAthlete[];
};
type EspnCompetitor = {
  homeAway: "home" | "away";
  score?: string;
  team?: { id?: string; displayName?: string };
};
type EspnEvent = {
  id?: string;
  status?: {
    period?: number;
    displayClock?: string;
    type?: { state?: string; name?: string; detail?: string; shortDetail?: string };
  };
  competitions?: {
    competitors?: EspnCompetitor[];
    details?: EspnDetail[];
  }[];
};

// Per-event summary shapes (corners / shots-on-target / cards).
type EspnStatTeam = {
  team?: { displayName?: string };
  statistics?: { name?: string; displayValue?: string; value?: number }[];
};
type EspnKeyEvent = {
  scoringPlay?: boolean;
  ownGoal?: boolean;
  penaltyKick?: boolean;
  text?: string;
  period?: { number?: number };
  clock?: { value?: number };
  team?: { displayName?: string; id?: string };
  // [0] = scorer, [1] = assister (absent on solo / penalty goals). The cheap
  // scoreboard `details` feed omits this during live play — assists (and often
  // even the scorer's name) only land here, in the summary keyEvents.
  participants?: { athlete?: { displayName?: string } }[];
};
// Team-sheet roster block (line-ups). `starter` marks the XI; formation is real.
type EspnRosterTeam = {
  team?: { displayName?: string };
  formation?: string;
  roster?: {
    starter?: boolean;
    jersey?: string;
    athlete?: { displayName?: string; fullName?: string; jersey?: string };
    position?: { abbreviation?: string };
  }[];
};
type EspnSummary = {
  boxscore?: { teams?: EspnStatTeam[] };
  rosters?: EspnRosterTeam[];
  commentary?: {
    /** Opta prose for the play ("Substitution, Spain. X replaces Y."). */
    text?: string;
    play?: {
      type?: { text?: string };
      period?: { number?: number };
      // Match clock of the play. `value` is seconds from kickoff and keeps
      // counting across half-time (45' = 2700s, 67' = 4020s), so it doubles as
      // an absolute match-minute and a stable chronological sort key.
      clock?: { value?: number; displayValue?: string };
      team?: { displayName?: string };
      participants?: { athlete?: { displayName?: string } }[];
    };
  }[];
  keyEvents?: EspnKeyEvent[];
};

/**
 * Goals — with assister — from the summary `keyEvents`, oriented to our
 * home/away. This is the only live feed that carries the assist (participant
 * [1]); the cheap scoreboard `details` omits it, and frequently omits the
 * scorer's name too. Solo / penalty goals have no assister → null.
 */
/**
 * Opta prose for a goal scored from beyond the 18-yard box. Covers ESPN's usual
 * phrasings: "from outside the box", "from outside the area", "from long range",
 * "from distance", "a long-range effort". Deliberately NOT matched: "edge of the
 * box" (ambiguous) — only clearly-outside phrasings settle Yes.
 */
const SCORED_OUTSIDE_BOX =
  /outside (the |of the )?(box|area|penalty area)|from (long range|distance)|long[- ]range (effort|strike|goal|shot)/i;

export function goalsFromKeyEvents(
  keyEvents: EspnKeyEvent[] | undefined,
  homeName: string,
): Goal[] {
  return (keyEvents ?? [])
    .filter((e) => e.scoringPlay)
    .map((e) => {
      const p = e.participants ?? [];
      return {
        team: (norm(e.team?.displayName ?? "") === homeName ? "home" : "away") as
          | "home"
          | "away",
        scorer: p[0]?.athlete?.displayName ?? "Unknown",
        minute: e.clock?.value != null ? Math.round(e.clock.value / 60) : undefined,
        assist: e.ownGoal ? null : p[1]?.athlete?.displayName ?? null,
        penalty: e.penaltyKick === true,
        ownGoal: e.ownGoal === true,
        // Long-range goal — read from the Opta prose ("…from outside the box").
        // Lets the "score from outside the penalty area" market auto-settle.
        outsideBox: e.ownGoal !== true && SCORED_OUTSIDE_BOX.test(e.text ?? ""),
      };
    });
}

/**
 * Fill assists (and repair "Unknown" scorers) on the scoreboard goal list from
 * the richer summary goals, matched by team + nearest minute. Never adds or
 * drops a goal — the scoreboard list stays the score-of-record; this only
 * layers in the detail the scoreboard feed lacks.
 */
function enrichGoals(base: Goal[], rich: Goal[]): Goal[] {
  if (!rich.length) return base;
  const used = new Set<number>();
  return base.map((g) => {
    let best = -1;
    let bestDiff = Infinity;
    rich.forEach((r, i) => {
      if (used.has(i) || r.team !== g.team) return;
      const diff = Math.abs((r.minute ?? -99) - (g.minute ?? 999));
      if (diff < bestDiff) {
        bestDiff = diff;
        best = i;
      }
    });
    if (best < 0 || bestDiff > 2) return g;
    used.add(best);
    const r = rich[best];
    return {
      ...g,
      scorer: g.scorer && g.scorer !== "Unknown" ? g.scorer : r.scorer,
      assist: g.assist ?? r.assist,
      // Goal location rides ONLY on the summary prose, so layer it in from rich.
      outsideBox: g.outsideBox || r.outsideBox,
    };
  });
}

/**
 * How the FIRST goal of the match was scored, from the summary `keyEvents`.
 * Picks the earliest scoring play (by period then clock — defensive against
 * feed ordering) and classifies it off the structured flags + Opta prose.
 * Order matters: own-goal and penalty take precedence over header/free-kick.
 * Returns null when no goal has been scored yet.
 */
export function firstGoalMethod(keyEvents: EspnKeyEvent[] | undefined): GoalMethod | null {
  const scoring = (keyEvents ?? []).filter((e) => e.scoringPlay);
  if (!scoring.length) return null;
  const first = scoring.slice().sort((a, b) => {
    const pa = a.period?.number ?? 1;
    const pb = b.period?.number ?? 1;
    if (pa !== pb) return pa - pb;
    return (a.clock?.value ?? 0) - (b.clock?.value ?? 0);
  })[0];
  const text = (first.text ?? "").toLowerCase();
  if (first.ownGoal === true || text.includes("own goal")) return "owngoal";
  if (first.penaltyKick === true || /\bpenalty\b/.test(text)) return "penalty";
  if (/\bheader\b|\bheaded\b|with the head/.test(text)) return "header";
  // Direct free kick: Opta phrases it "from a free kick" / "direct free kick"
  // with NO assist (an assisted goal off a free-kick cross is a normal shot or
  // header, already handled above).
  if (/direct free kick/.test(text) || (/free kick/.test(text) && !/assisted by/.test(text)))
    return "freekick";
  return "shot";
}

/**
 * Opta phrasing for a penalty that was actually TAKEN but not scored — "Penalty
 * - Missed" / "Penalty - Saved". A scored penalty is caught separately by the
 * structured `penaltyKick` flag, so this regex only needs the miss/save plays.
 * Deliberately strict (`penalty - …`) so it never fires on "penalty area" prose
 * in an ordinary goal description.
 */
const PENALTY_TAKEN = /penalty\s*-\s*(missed|saved|scored)/i;

/**
 * Which side took the match's FIRST penalty kick — scored, missed, or saved —
 * from the summary `keyEvents` (earliest by period→clock). A scored penalty
 * carries `penaltyKick:true`; a miss/save only appears as a "Penalty - …" play.
 * Oriented to our home/away. Mirrors scripts/build-results.mjs firstPenaltyTeam
 * — keep in sync. Returns null until a penalty is taken (and all match if none).
 */
export function firstPenaltyTeam(
  keyEvents: EspnKeyEvent[] | undefined,
  homeName: string,
): "home" | "away" | null {
  const pens = (keyEvents ?? []).filter(
    (e) => e.penaltyKick === true || PENALTY_TAKEN.test(e.text ?? ""),
  );
  if (!pens.length) return null;
  const first = pens.slice().sort((a, b) => {
    const pa = a.period?.number ?? 1;
    const pb = b.period?.number ?? 1;
    if (pa !== pb) return pa - pb;
    return (a.clock?.value ?? 0) - (b.clock?.value ?? 0);
  })[0];
  const name = first.team?.displayName;
  if (!name) return null;
  return norm(name) === homeName ? "home" : "away";
}

/** Break anchor in match-minutes under FIFA's 2026 rule: 22' into each half. */
const WATER_BREAK_ANCHOR: Record<1 | 2, number> = { 1: 22, 2: 67 };

/**
 * Commentary play-types that are NOT an on-pitch "action" — structural markers
 * (kickoff, half boundaries, VAR/clock delays) and substitutions. Everything
 * else (Foul, Corner Awarded, Offside, Shot *, cards, Handball, Goal, …) counts
 * as the kind of restart/event a "first action after the break" market settles on.
 */
const NON_ACTION_TYPES = new Set([
  "Kickoff",
  "Start 1st Half",
  "Start 2nd Half",
  "End 1st Half",
  "End 2nd Half",
  "Half Time",
  "End Regular Time",
  "Full Time",
  "Start Delay",
  "End Delay",
  "Substitution",
  "VAR Decision",
]);

/**
 * Resolve the second a half's hydration break ENDED. FIFA's 2026 rule fixes the
 * break near a known minute (22' / 67'), and ESPN logs it — empirically every
 * match — as a Start Delay→End Delay pair lasting ~2-3 min in that window. We
 * take the End Delay nearest the expected break-end (anchor + ~3.5') within a
 * tolerant window, ignoring stray injury/VAR delays elsewhere in the half.
 * Returns the break-end clock (seconds) or null when no delay pair was logged.
 */
function resolveBreakEndSec(
  commentary: EspnSummary["commentary"],
  half: 1 | 2,
  anchorMinute: number,
): number | null {
  const winLo = (anchorMinute - 1) * 60;
  const winHi = (anchorMinute + 9) * 60;
  const expectedEnd = (anchorMinute + 3.5) * 60;
  const ends = (commentary ?? [])
    .map((c) => c.play)
    .filter(
      (p): p is NonNullable<typeof p> =>
        !!p &&
        (p.period?.number ?? 1) === half &&
        p.type?.text === "End Delay" &&
        typeof p.clock?.value === "number" &&
        p.clock.value >= winLo &&
        p.clock.value <= winHi,
    );
  if (!ends.length) return null;
  ends.sort(
    (a, b) =>
      Math.abs((a.clock!.value ?? 0) - expectedEnd) - Math.abs((b.clock!.value ?? 0) - expectedEnd),
  );
  return ends[0].clock!.value ?? null;
}

/**
 * First commentary ACTION strictly after a half's hydration break — the datum
 * that settles the "first action after the water break = corner" market.
 *
 * Anchor resolution is two-tier: prefer the ACTUAL break end ESPN logs as a
 * Start/End Delay pair near the nominal minute (accurate — happens ~every
 * match); fall back to the FIFA-2026 fixed minute (22' / 67') only when no delay
 * pair is present. We then scan the play-by-play (sorted by clock, which counts
 * through half-time) for the earliest action of that half strictly after the
 * resolved anchor. `reliable` is true for a "No" (a corner would have been
 * logged) and drops to false only on a "Yes", because ESPN doesn't log throw-ins
 * / goal kicks and one could have been the true first action — that case wants a
 * human eye (statusOverride).
 *
 * Returns null when no action past the anchor has been logged yet (→ pending).
 */
export function waterBreakAction(
  commentary: EspnSummary["commentary"],
  half: 1 | 2,
  anchorMinute: number = WATER_BREAK_ANCHOR[half],
): WaterBreakAction | null {
  const breakEndSec = resolveBreakEndSec(commentary, half, anchorMinute);
  const cutoffSec = breakEndSec ?? anchorMinute * 60;

  const candidates = (commentary ?? [])
    .map((c) => c.play)
    .filter(
      (p): p is NonNullable<typeof p> =>
        !!p &&
        (p.period?.number ?? 1) === half &&
        typeof p.clock?.value === "number" &&
        p.clock.value > cutoffSec &&
        !!p.type?.text &&
        !NON_ACTION_TYPES.has(p.type.text),
    )
    .sort((a, b) => (a.clock!.value ?? 0) - (b.clock!.value ?? 0));

  const first = candidates[0];
  if (!first) return null;

  const isCorner = first.type!.text === "Corner Awarded";
  return {
    half,
    anchorMinute,
    source: breakEndSec !== null ? "delay" : "anchor",
    breakEndMinute: breakEndSec !== null ? Math.round(breakEndSec / 60) : null,
    firstActionType: first.type!.text ?? null,
    firstActionMinute: Math.round((first.clock!.value ?? 0) / 60),
    isCorner,
    // A logged corner could still be preceded by an unlogged throw-in/goal kick;
    // anything else is reliable (corners are always logged, so none means "No").
    reliable: !isCorner,
  };
}

function parseMinute(displayClock?: string): number | null {
  if (!displayClock) return null;
  const m = displayClock.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

/** First-half goal if its base minute is ≤ 45 (covers "45'+x" stoppage). */
function isFirstHalf(displayValue?: string): boolean {
  const base = displayValue ? parseInt(displayValue, 10) : NaN;
  return Number.isFinite(base) && base <= 45;
}

function normaliseEvent(ev: EspnEvent): LiveMatch | null {
  const comp = ev.competitions?.[0];
  const cs = comp?.competitors ?? [];
  const espnHome = cs.find((c) => c.homeAway === "home");
  const espnAway = cs.find((c) => c.homeAway === "away");
  if (!espnHome?.team?.displayName || !espnAway?.team?.displayName) return null;

  const matchId = matchFixture(espnHome.team.displayName, espnAway.team.displayName);
  if (!matchId) return null;

  // Re-orient ESPN's home/away to OUR fixture's listed home/away.
  const fx = fixtures.find((f) => f.id === matchId)!;
  const ourHomeIsEspnHome = norm(fx.home.name) === norm(espnHome.team.displayName);
  const ourHome = ourHomeIsEspnHome ? espnHome : espnAway;
  const ourAway = ourHomeIsEspnHome ? espnAway : espnHome;
  const homeId = ourHome.team?.id;

  const espnState = ev.status?.type?.state ?? "pre";
  const isHalftime = ev.status?.type?.name === "STATUS_HALFTIME";
  const state: LiveState =
    espnState === "post"
      ? "finished"
      : espnState === "in"
        ? isHalftime
          ? "halftime"
          : "live"
        : "scheduled";

  // Match-end phase, cross-checked against ESPN's authoritative status.type (same
  // mapping as scripts/build-results.mjs). Drives the FT label + ET-goal tagging.
  const typeName = ev.status?.type?.name ?? "";
  const periodNo = ev.status?.period ?? 0;
  let finishPhase: LiveMatch["finishPhase"] = null;
  if (state === "finished") {
    if (typeName === "STATUS_FINAL_PEN" || periodNo === 5) finishPhase = "penalties";
    else if (typeName === "STATUS_FINAL_AET" || periodNo === 3 || periodNo === 4)
      finishPhase = "extra_time";
    else finishPhase = "regulation";
  }
  const wentToEt = finishPhase === "extra_time" || finishPhase === "penalties";

  const score = {
    home: parseInt(ourHome.score ?? "0", 10) || 0,
    away: parseInt(ourAway.score ?? "0", 10) || 0,
  };

  // Build chronological goal list oriented to our home/away. Shootout kicks (ESPN
  // lists them as 120' scoring plays) are dropped — they are not goals. Real ET
  // goals (minute > 90) are tagged so 90-minute markets can exclude them.
  const details = (comp?.details ?? []).filter((d) => d.scoringPlay && d.shootout !== true);
  const goals: Goal[] = details.map((d) => {
    const side: "home" | "away" = d.team?.id === homeId ? "home" : "away";
    const athletes = d.athletesInvolved ?? [];
    const minute = d.clock?.value != null ? Math.round(d.clock.value / 60) : undefined;
    return {
      team: side,
      scorer: athletes[0]?.displayName ?? "Unknown",
      minute,
      assist: athletes[1]?.displayName ?? null,
      penalty: d.penaltyKick === true,
      ownGoal: d.ownGoal === true,
      ...(wentToEt && minute != null && minute > 90 ? { et: true } : {}),
    };
  });

  // Bookings, oriented to our home/away. ESPN flags second-yellow dismissals with
  // redCard:true (often alongside yellowCard:true) — check red first so they grade
  // as "sent off", not just "carded".
  const cards: Card[] = (comp?.details ?? [])
    .filter((d) => d.yellowCard || d.redCard)
    .map((d) => {
      const side: "home" | "away" = d.team?.id === homeId ? "home" : "away";
      return {
        team: side,
        player: d.athletesInvolved?.[0]?.displayName ?? "Unknown",
        minute: d.clock?.value != null ? Math.round(d.clock.value / 60) : undefined,
        type: d.redCard ? "red" : "yellow",
      };
    });

  // Half-time score: derivable once we've reached the break or beyond.
  const reachedHt = state === "halftime" || state === "finished" || (ev.status?.period ?? 0) >= 2;
  let htScore: LiveMatch["htScore"] = null;
  if (reachedHt) {
    htScore = { home: 0, away: 0 };
    for (const d of details) {
      if (isFirstHalf(d.clock?.displayValue)) {
        const side: "home" | "away" = d.team?.id === homeId ? "home" : "away";
        htScore[side] += 1;
      }
    }
  }

  const statusDetail =
    state === "finished"
      ? finishPhase === "penalties"
        ? "FT (pens)"
        : finishPhase === "extra_time"
          ? "FT (AET)"
          : "FT"
      : state === "halftime"
        ? "HT"
        : state === "live"
          ? ev.status?.displayClock ?? "LIVE"
          : ev.status?.type?.shortDetail ?? "Upcoming";

  return {
    matchId,
    state,
    statusDetail,
    minute: state === "live" ? parseMinute(ev.status?.displayClock) : null,
    period: ev.status?.period ?? 0,
    score,
    htScore,
    ftScore: state === "finished" ? score : null,
    finishPhase,
    goals,
    cards,
  };
}

async function fetchDate(param: string): Promise<EspnEvent[]> {
  const res = await fetch(`${ESPN_BASE}?dates=${param}`, {
    cache: "no-store",
    headers: { "User-Agent": "matchday-edge/1.0" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`ESPN ${res.status}`);
  const data = (await res.json()) as { events?: EspnEvent[] };
  return data.events ?? [];
}

/**
 * Pull live state for any of our fixtures kicking off inside a window around now
 * (kickoff − 15 min … kickoff + 3 h). Returns a matchId-keyed map; matches with
 * no ESPN data simply don't appear (the UI falls back to its static state).
 */
export async function fetchLiveMatches(nowMs: number = Date.now()): Promise<Record<string, LiveMatch>> {
  // 75 min ahead, not 15 — ESPN publishes the confirmed team sheets ~1h before
  // kickoff, and the line-up flow (spotlight "line-ups confirmed", live pitch
  // board) needs the summary fetch running through that window.
  const WINDOW_BEFORE = 75 * 60 * 1000;
  // Keep resolving a match well past the whistle (≈3h game + buffer) so the
  // final score + goal log stay on the page for hours after full time, not just
  // during play. Below ~6h, a match that ended would silently revert to its
  // static "kickoff time" card.
  const WINDOW_AFTER = 6 * 60 * 60 * 1000;
  const relevant = fixtures.filter((f) => {
    const ko = new Date(f.kickoffUTC).getTime();
    return nowMs >= ko - WINDOW_BEFORE && nowMs <= ko + WINDOW_AFTER;
  });

  // Durable base layer: every persisted result (finished matches that have
  // fallen out of the live window above). ESPN data fetched below overwrites
  // these for anything still inside the window, so live/just-ended matches stay
  // fresh while older finished matches keep their final score + goal log forever
  // (until results.json is pruned). This is what stops a day-old match — e.g.
  // Portugal–DR Congo — from silently reverting to its static kickoff time.
  const out: Record<string, LiveMatch> = {};
  for (const [id, r] of Object.entries(persistedResults)) {
    out[id] = persistedToLiveMatch(id, r);
  }

  if (relevant.length === 0) return out;

  // ESPN buckets a fixture under its US-local match date, which for any kickoff
  // in the 00:00–~05:00 UTC window is the PREVIOUS calendar day from our UTC
  // date (e.g. Uzbekistan–Colombia at 02:00Z is on ESPN's prior day). Query both
  // the kickoff UTC date and the day before, then dedupe — cheap insurance that
  // late-UTC kickoffs actually match an ESPN event instead of returning empty.
  const DAY_MS = 24 * 60 * 60 * 1000;
  const params = [
    ...new Set(
      relevant.flatMap((f) => {
        const ko = new Date(f.kickoffUTC);
        return [dateParam(ko), dateParam(new Date(ko.getTime() - DAY_MS))];
      }),
    ),
  ];
  const wantIds = new Set(relevant.map((f) => f.id));

  const batches = await Promise.allSettled(params.map(fetchDate));
  const eventIdByMatch: Record<string, string> = {};
  for (const b of batches) {
    if (b.status !== "fulfilled") continue;
    for (const ev of b.value) {
      const m = normaliseEvent(ev);
      if (m && wantIds.has(m.matchId)) {
        // The live scoreboard never reports the shootout winner, so keep the
        // persisted `advanced` (written by build-results.mjs) when the fresh
        // ESPN event lacks it — otherwise a just-decided level tie loses its
        // advancement and its "to qualify" legs revert to pending.
        if (m.advanced == null && persistedResults[m.matchId]?.advanced) {
          m.advanced = persistedResults[m.matchId].advanced;
        }
        out[m.matchId] = m;
        if (ev.id) eventIdByMatch[m.matchId] = ev.id;
      }
    }
  }

  // Verified stats (corners / shots-on-target / cards) ride a separate per-event
  // summary call. Fetch them for matches that have kicked off this poll — live,
  // at the break, or just finished — so the counts climb in real time, PLUS
  // still-scheduled matches inside the pre-kickoff window: their summary carries
  // the confirmed team sheet the moment ESPN publishes it (~1h before KO).
  // Older finished matches keep the stats baked into results.json above.
  const preKo = (id: string) => {
    const fx = fixtures.find((f) => f.id === id);
    if (!fx) return false;
    const ko = new Date(fx.kickoffUTC).getTime();
    return nowMs >= ko - WINDOW_BEFORE && nowMs <= ko + WINDOW_AFTER;
  };
  const liveIds = Object.entries(out)
    .filter(([id, m]) => eventIdByMatch[id] && (m.state !== "scheduled" || preKo(id)))
    .map(([id]) => id);
  if (liveIds.length) {
    const statBatches = await Promise.allSettled(
      liveIds.map((id) => fetchStats(eventIdByMatch[id], id)),
    );
    liveIds.forEach((id, i) => {
      const b = statBatches[i];
      if (b.status === "fulfilled" && b.value) {
        if (b.value.stats) out[id].stats = b.value.stats;
        if (b.value.lineups) out[id].lineups = b.value.lineups;
        // Layer the summary's scorer/assist detail onto the scoreboard goals,
        // which carry neither during live play.
        out[id].goals = enrichGoals(out[id].goals, b.value.goals);
      }
    });
  }
  return out;
}
