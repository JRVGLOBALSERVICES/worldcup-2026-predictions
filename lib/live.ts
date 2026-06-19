import { fixtures } from "./data";
import type { Goal, Card, MatchStats } from "./bets";
import resultsFile from "@/data/results.json";

/** Persisted ESPN snapshots (written by scripts/build-results.mjs). */
type PersistedResult = {
  state: "live" | "finished";
  ht: { home: number; away: number } | null;
  ft: { home: number; away: number } | null;
  score: { home: number; away: number };
  goals: {
    team: "home" | "away";
    scorer: string;
    minute: number | null;
    assist: string | null;
    penalty: boolean;
    ownGoal: boolean;
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

const ESPN_SUMMARY =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary";

/** Verified corner/SOT/card counts from a per-event summary, oriented to our home/away. */
async function fetchStats(eventId: string, matchId: string): Promise<MatchStats | null> {
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
  const teams = data.boxscore?.teams;
  if (!Array.isArray(teams) || teams.length < 2) return null;
  const homeName = norm(fx.home.name);
  const side = (espnName?: string) => (norm(espnName ?? "") === homeName ? "home" : "away");
  const stat = (t: EspnStatTeam | undefined, name: string): number => {
    const s = (t?.statistics ?? []).find((x) => x.name === name);
    const n = s ? Number(s.displayValue ?? s.value) : NaN;
    return Number.isFinite(n) ? n : 0;
  };

  const byName: Partial<Record<"home" | "away", EspnStatTeam>> = {};
  for (const t of teams) byName[side(t.team?.displayName)] = t;
  const h = byName.home;
  const a = byName.away;
  if (!h || !a) return null;

  const yellow = { home: stat(h, "yellowCards"), away: stat(a, "yellowCards") };
  const red = { home: stat(h, "redCards"), away: stat(a, "redCards") };

  const cornersByHalf = { home: [0, 0] as [number, number], away: [0, 0] as [number, number] };
  const sotByHalf = { home: [0, 0] as [number, number], away: [0, 0] as [number, number] };
  const playerSot: Record<string, number> = {};
  for (const c of data.commentary ?? []) {
    const p = c.play;
    const text = p?.type?.text;
    if (text !== "Corner Awarded" && text !== "Shot On Target") continue;
    if (!p?.team?.displayName) continue;
    const s = side(p.team.displayName);
    const idx = (p.period?.number ?? 1) === 1 ? 0 : 1;
    if (text === "Corner Awarded") {
      cornersByHalf[s][idx] += 1;
    } else {
      sotByHalf[s][idx] += 1;
      // Attribute the shot to its taker (the first participant) for per-player props.
      const shooter = p.participants?.[0]?.athlete?.displayName;
      if (shooter) playerSot[shooter] = (playerSot[shooter] ?? 0) + 1;
    }
  }

  return {
    corners: { home: stat(h, "wonCorners"), away: stat(a, "wonCorners") },
    sot: { home: stat(h, "shotsOnTarget"), away: stat(a, "shotsOnTarget") },
    shots: { home: stat(h, "totalShots"), away: stat(a, "totalShots") },
    yellow,
    red,
    cards: { home: yellow.home + red.home, away: yellow.away + red.away },
    cornersByHalf,
    sotByHalf,
    playerSot,
  };
}

/** Map a durable persisted result into the LiveMatch shape the UI consumes. */
function persistedToLiveMatch(matchId: string, r: PersistedResult): LiveMatch {
  const score = r.ft ?? r.score;
  return {
    matchId,
    state: r.state,
    statusDetail: r.state === "finished" ? "FT" : "Live",
    minute: null,
    period: 2,
    score,
    htScore: r.ht,
    ftScore: r.ft ?? (r.state === "finished" ? score : null),
    goals: r.goals.map((g) => ({
      team: g.team,
      scorer: g.scorer,
      minute: g.minute ?? undefined,
      assist: g.assist,
      penalty: g.penalty,
      ownGoal: g.ownGoal,
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
  goals: Goal[];
  cards: Card[];
  /** Verified corner/SOT/card counts — present once the summary endpoint has data. */
  stats?: MatchStats;
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
type EspnSummary = {
  boxscore?: { teams?: EspnStatTeam[] };
  commentary?: {
    play?: {
      type?: { text?: string };
      period?: { number?: number };
      team?: { displayName?: string };
      participants?: { athlete?: { displayName?: string } }[];
    };
  }[];
};

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

  const score = {
    home: parseInt(ourHome.score ?? "0", 10) || 0,
    away: parseInt(ourAway.score ?? "0", 10) || 0,
  };

  // Build chronological goal list oriented to our home/away.
  const details = (comp?.details ?? []).filter((d) => d.scoringPlay);
  const goals: Goal[] = details.map((d) => {
    const side: "home" | "away" = d.team?.id === homeId ? "home" : "away";
    const athletes = d.athletesInvolved ?? [];
    return {
      team: side,
      scorer: athletes[0]?.displayName ?? "Unknown",
      minute: d.clock?.value != null ? Math.round(d.clock.value / 60) : undefined,
      assist: athletes[1]?.displayName ?? null,
      penalty: d.penaltyKick === true,
      ownGoal: d.ownGoal === true,
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
      ? "FT"
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
  const WINDOW_BEFORE = 15 * 60 * 1000;
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
        out[m.matchId] = m;
        if (ev.id) eventIdByMatch[m.matchId] = ev.id;
      }
    }
  }

  // Verified stats (corners / shots-on-target / cards) ride a separate per-event
  // summary call. Fetch them only for matches that have actually kicked off this
  // poll — live, at the break, or just finished — so the counts climb in real
  // time. Older finished matches keep the stats baked into results.json above.
  const liveIds = Object.entries(out)
    .filter(([id, m]) => m.state !== "scheduled" && eventIdByMatch[id])
    .map(([id]) => id);
  if (liveIds.length) {
    const statBatches = await Promise.allSettled(
      liveIds.map((id) => fetchStats(eventIdByMatch[id], id)),
    );
    liveIds.forEach((id, i) => {
      const b = statBatches[i];
      if (b.status === "fulfilled" && b.value) out[id].stats = b.value;
    });
  }
  return out;
}
