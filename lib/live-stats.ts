import fixturesJson from "@/data/fixtures.json";
import resultsJson from "@/data/results.json";
import statsJson from "@/data/stats.json";
import { aliveTeamKeys } from "./tournament";
import type {
  StatRow,
  StatCategoryKey,
  StatsFile,
  TeamPerfKey,
  TeamPerfRow,
  PlayerStatLine,
  TeamPlayerSheet,
} from "./stats";

/**
 * On-demand recompute of the tournament stat leaderboards (the /stats boards:
 * top scorers, assists, clean sheets, cards, penalties scored/missed) straight
 * from ESPN's keyless feeds — the server-side twin of scripts/build-stats.mjs.
 *
 * The committed data/stats.json is a cron snapshot; this lets the /stats page's
 * "Force update" button pull the leaders AS OF NOW without waiting for the cron.
 * Keep the ALIAS / norm / topN rules in sync with build-stats.mjs & lib/live.ts.
 *
 * Server-only: it fetches ESPN at request time. Never import into a client file.
 */

type Fixture = {
  id: string;
  home: { name: string; flag: string };
  away: { name: string; flag: string };
  kickoffUTC: string;
};
const fixtures = fixturesJson as Fixture[];

const ESPN_BASE =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";
const ESPN_SUMMARY =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary";
const ESPN_STATS =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/statistics";
// Core API — per-athlete per-event Opta stats (tackles/blocks; see build-stats.mjs).
const ESPN_CORE_EVENT =
  "https://sports.core.api.espn.com/v2/sports/soccer/leagues/fifa.world/events";
const CORE_CONCURRENCY = 12;
// The cron owns the historical backfill; a live recompute must stay inside one
// serverless invocation, so cap the per-player sweep at roughly one matchday.
const CORE_MAX_JOBS = 150;

const TOP_N = 10;

// Mirror of lib/live.ts ALIAS — ESPN spells a few nations differently.
const ALIAS: Record<string, string> = {
  congodr: "drcongo",
  drc: "drcongo",
  korearepublic: "southkorea",
  iranislamicrepublic: "iran",
  iriran: "iran",
  turkiye: "turkey",
  trkiye: "turkey",
  unitedstates: "usa",
  unitedstatesofamerica: "usa",
  czechia: "czechrepublic",
  capeverde: "caboverde",
  cotedivoire: "ivorycoast",
  bosniaherzegovina: "bosnia",
  curaao: "curacao",
};
const norm = (s: string): string => {
  const a = String(s).toLowerCase().replace(/[^a-z]/g, "");
  return ALIAS[a] ?? a;
};

function dateParam(d: Date): string {
  return [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, "0"),
    String(d.getUTCDate()).padStart(2, "0"),
  ].join("");
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { "User-Agent": "matchday-edge/1.0" },
    signal: AbortSignal.timeout(12000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`ESPN ${res.status} for ${url}`);
  return res.json() as Promise<T>;
}

// ── Loose ESPN shapes (only the fields we read) ──────────────────────────────
type EspnAthlete = { displayName?: string; team?: { displayName?: string } };
type EspnDetail = {
  team?: { id?: string };
  scoringPlay?: boolean;
  penaltyKick?: boolean;
  ownGoal?: boolean;
  yellowCard?: boolean;
  redCard?: boolean;
  athletesInvolved?: EspnAthlete[];
};
type EspnCompetitor = {
  homeAway?: "home" | "away";
  score?: string;
  team?: { id?: string; displayName?: string };
};
type EspnEvent = {
  id?: string;
  status?: { type?: { state?: string } };
  competitions?: { competitors?: EspnCompetitor[]; details?: EspnDetail[] }[];
};
type EspnLeader = { value?: number; athlete?: EspnAthlete & { statistics?: { name?: string; value?: number }[] } };
type EspnStatsBlock = { name?: string; leaders?: EspnLeader[] };
type EspnKeyEvent = {
  type?: { text?: string };
  team?: { id?: string; displayName?: string };
  participants?: { athlete?: { displayName?: string } }[];
};
type EspnBoxTeam = {
  team?: { displayName?: string };
  statistics?: { name?: string; displayValue?: string }[];
};
type EspnRosterEntry = {
  starter?: boolean;
  subbedIn?: boolean;
  position?: { abbreviation?: string };
  athlete?: { id?: string; displayName?: string };
  stats?: { name?: string; value?: number }[];
};
type EspnRosterTeam = { team?: { id?: string; displayName?: string }; roster?: EspnRosterEntry[] };
type EspnSummary = {
  keyEvents?: EspnKeyEvent[];
  boxscore?: { teams?: EspnBoxTeam[] };
  rosters?: EspnRosterTeam[];
};

type Tally = { name: string; team: string; value: number; matches?: number | null };

// Raw per-match team counters behind the completion boards.
type TeamBox = {
  team: string;
  possessionPct: number | null;
  accuratePasses: number | null;
  totalPasses: number | null;
  shotsOnTarget: number | null;
  totalShots: number | null;
  effectiveTackles: number | null;
  totalTackles: number | null;
  accurateCrosses: number | null;
  totalCrosses: number | null;
  accurateLongBalls: number | null;
  totalLongBalls: number | null;
};

type TeamAgg = {
  team: string;
  matches: number;
  possessionSum: number;
  possessionN: number;
  accuratePasses: number;
  totalPasses: number;
  shotsOnTarget: number;
  totalShots: number;
  effectiveTackles: number;
  totalTackles: number;
  accurateCrosses: number;
  totalCrosses: number;
  accurateLongBalls: number;
  totalLongBalls: number;
};

const fetchDate = (param: string) =>
  getJson<{ events?: EspnEvent[] }>(`${ESPN_BASE}?dates=${param}`).then((d) => d.events ?? []);
const fetchSummary = (eventId: string) => getJson<EspnSummary>(`${ESPN_SUMMARY}?event=${eventId}`);

function tallyAdd(map: Record<string, Tally>, name: string | undefined, team: string, n = 1) {
  if (!name || name === "Unknown") return;
  const key = `${name}|${team ?? ""}`;
  const row = (map[key] ??= { name, team: team ?? "", value: 0 });
  row.value += n;
}

function topN(rows: Tally[], flagFor: (t: string) => string, n = TOP_N): StatRow[] {
  const sorted = rows
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
    .slice(0, n);
  return sorted.map((r) => ({
    rank: 1 + sorted.filter((o) => o.value > r.value).length,
    name: r.name,
    team: r.team,
    flag: flagFor(r.team),
    value: r.value,
    ...(r.matches != null ? { matches: r.matches } : {}),
  }));
}

function topTeams(rows: { team: string; value: number }[], flagFor: (t: string) => string, n = TOP_N): StatRow[] {
  const sorted = rows
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value || a.team.localeCompare(b.team))
    .slice(0, n);
  return sorted.map((r) => ({
    rank: 1 + sorted.filter((o) => o.value > r.value).length,
    team: r.team,
    flag: flagFor(r.team),
    value: r.value,
  }));
}

function aggregateTeamBox(byEvent: Record<string, { teamBox?: TeamBox[] }>): Record<string, TeamAgg> {
  const agg: Record<string, TeamAgg> = {};
  for (const rec of Object.values(byEvent)) {
    for (const tb of rec.teamBox ?? []) {
      if (!tb.team) continue;
      const key = norm(tb.team);
      const a = (agg[key] ??= {
        team: tb.team,
        matches: 0,
        possessionSum: 0,
        possessionN: 0,
        accuratePasses: 0,
        totalPasses: 0,
        shotsOnTarget: 0,
        totalShots: 0,
        effectiveTackles: 0,
        totalTackles: 0,
        accurateCrosses: 0,
        totalCrosses: 0,
        accurateLongBalls: 0,
        totalLongBalls: 0,
      });
      a.matches += 1;
      if (tb.possessionPct != null) {
        a.possessionSum += tb.possessionPct;
        a.possessionN += 1;
      }
      const fields = [
        "accuratePasses",
        "totalPasses",
        "shotsOnTarget",
        "totalShots",
        "effectiveTackles",
        "totalTackles",
        "accurateCrosses",
        "totalCrosses",
        "accurateLongBalls",
        "totalLongBalls",
      ] as const;
      for (const f of fields) {
        const v = tb[f];
        if (v != null) a[f] += v;
      }
    }
  }
  return agg;
}

function pctBoard(
  agg: Record<string, TeamAgg>,
  pick: (a: TeamAgg) => number | null,
  flagFor: (t: string) => string,
  n = TOP_N,
): TeamPerfRow[] {
  const rows = Object.values(agg)
    .map((a) => {
      const value = pick(a);
      return value == null || !Number.isFinite(value)
        ? null
        : { team: a.team, value: Math.round(value * 10) / 10, matches: a.matches };
    })
    .filter((r): r is { team: string; value: number; matches: number } => r !== null)
    .sort((x, y) => y.value - x.value || x.team.localeCompare(y.team))
    .slice(0, n);
  return rows.map((r) => ({
    rank: 1 + rows.filter((o) => o.value > r.value).length,
    team: r.team,
    flag: flagFor(r.team),
    value: r.value,
    display: `${r.value.toFixed(1)}%`,
    matches: r.matches,
  }));
}

const ratio = (num: number, den: number) => (den > 0 ? (num / den) * 100 : null);

function buildTeamStats(
  byEvent: Record<string, { teamBox?: TeamBox[] }>,
  flagFor: (t: string) => string,
  alive: Set<string>,
): Record<TeamPerfKey, TeamPerfRow[]> {
  const agg = aggregateTeamBox(byEvent);
  // Keep only sides still in the competition (agg is keyed on the normalised
  // team name). Empty set → leave everything, so a glitch never blanks the boards.
  if (alive.size > 0) {
    for (const key of Object.keys(agg)) if (!alive.has(key)) delete agg[key];
  }
  return {
    passCompletion: pctBoard(agg, (a) => ratio(a.accuratePasses, a.totalPasses), flagFor),
    possession: pctBoard(agg, (a) => (a.possessionN > 0 ? a.possessionSum / a.possessionN : null), flagFor),
    shotAccuracy: pctBoard(agg, (a) => ratio(a.shotsOnTarget, a.totalShots), flagFor),
    tackleSuccess: pctBoard(agg, (a) => ratio(a.effectiveTackles, a.totalTackles), flagFor),
    crossCompletion: pctBoard(agg, (a) => ratio(a.accurateCrosses, a.totalCrosses), flagFor),
    longBallAccuracy: pctBoard(agg, (a) => ratio(a.accurateLongBalls, a.totalLongBalls), flagFor),
  };
}

/**
 * Recompute every leaderboard from ESPN. penaltyMissed reuses the committed
 * cron cache (per-event summary "Penalty - Saved/Missed" plays) and only hits
 * summaries for currently-live events plus any finished event not yet cached —
 * the same incremental model as the cron, so one button press stays cheap.
 */
export async function computeStats(now: number): Promise<StatsFile> {
  const flagByTeam: Record<string, string> = {};
  const nameByTeam: Record<string, string> = {};
  for (const f of fixtures) {
    for (const t of [f.home, f.away]) {
      flagByTeam[norm(t.name)] = t.flag;
      nameByTeam[norm(t.name)] = t.name;
    }
  }
  const flagFor = (team: string) => flagByTeam[norm(team)] ?? "🏳️";

  // Leaderboards only feature teams still in the competition — a top scorer whose
  // side is knocked out drops off the board. Mirrors scripts/build-stats.mjs.
  const alive = aliveTeamKeys(
    fixturesJson as Parameters<typeof aliveTeamKeys>[0],
    // Cast through `unknown`: a scheduled match legitimately carries `ft: null`
    // (not yet played), which no longer structurally matches MinResult's optional
    // `ft`. aliveTeamKeys only reads team identity, never the scoreline, so this
    // is runtime-safe — the strict overlap check was the only thing failing.
    (resultsJson.results ?? {}) as unknown as Parameters<typeof aliveTeamKeys>[1],
    norm,
  );
  const aliveRow = (r: { team: string }) => alive.size === 0 || alive.has(norm(r.team));

  const dates = new Set<string>();
  for (const f of fixtures) {
    const base = new Date(f.kickoffUTC);
    for (const off of [-1, 0]) dates.add(dateParam(new Date(base.getTime() + off * 86400000)));
  }

  const batches = await Promise.allSettled([...dates].map(fetchDate));
  const events: EspnEvent[] = [];
  let fetched = 0;
  for (const b of batches) {
    if (b.status === "fulfilled") {
      fetched++;
      events.push(...b.value);
    }
  }
  if (fetched === 0) throw new Error("ESPN unreachable — no dates fetched");

  const eventById = new Map<string, EspnEvent>();
  for (const ev of events) if (ev.id) eventById.set(ev.id, ev);

  // ── Pass 1: scoreboard details → goals, cards, penalties scored, clean sheets ─
  const yellow: Record<string, Tally> = {};
  const red: Record<string, Tally> = {};
  const penScored: Record<string, Tally> = {};
  const cleanSheets: Record<string, { team: string; value: number }> = {};
  // Goals straight from the per-match scoring events (authoritative + current).
  // ESPN's /statistics goalsLeaders aggregate lags a match or two behind these,
  // so we tally goals here and only use /statistics to backfill appearances.
  const goalsByPlayer: Record<string, { name: string; team: string; value: number; matchIds: Set<string> }> = {};
  const finishedEventIds: string[] = [];

  for (const ev of eventById.values()) {
    const comp = ev.competitions?.[0];
    const cs = comp?.competitors ?? [];
    if (cs.length < 2) continue;
    const state = ev.status?.type?.state ?? "pre";
    if (state === "pre") continue;

    const teamName: Record<string, string> = {};
    for (const c of cs) {
      const disp = c.team?.displayName ?? "";
      if (c.team?.id) teamName[c.team.id] = nameByTeam[norm(disp)] ?? disp;
    }

    for (const d of comp?.details ?? []) {
      const who = (d.athletesInvolved ?? [])[0]?.displayName;
      const team = (d.team?.id && teamName[d.team.id]) || "";
      if (d.yellowCard && !d.redCard) tallyAdd(yellow, who, team);
      if (d.redCard) tallyAdd(red, who, team);
      if (d.scoringPlay && d.penaltyKick && !d.ownGoal) tallyAdd(penScored, who, team);
      // Every non-own-goal scoring play (open play + converted penalties) is a goal
      // for the scorer — the Golden Boot count.
      if (d.scoringPlay && !d.ownGoal && who && who !== "Unknown" && team && ev.id) {
        const k = `${who}|${team}`;
        const g = (goalsByPlayer[k] ??= { name: who, team, value: 0, matchIds: new Set<string>() });
        g.value += 1;
        g.matchIds.add(ev.id);
      }
    }

    if (state === "post" && ev.id) {
      finishedEventIds.push(ev.id);
      const home = cs.find((c) => c.homeAway === "home");
      const away = cs.find((c) => c.homeAway === "away");
      const hg = parseInt(home?.score ?? "0", 10) || 0;
      const ag = parseInt(away?.score ?? "0", 10) || 0;
      const credit = (teamId: string | undefined) => {
        if (!teamId) return;
        const team = teamName[teamId];
        const key = norm(team);
        const row = (cleanSheets[key] ??= { team, value: 0 });
        row.value += 1;
      };
      if (ag === 0) credit(home?.team?.id);
      if (hg === 0) credit(away?.team?.id);
    }
  }

  // ── Pass 2: season /statistics leaders → scorers, assists ───────────────────
  const scorers: Record<string, Tally> = {};
  const assists: Record<string, Tally> = {};
  try {
    const stats = await getJson<{ stats?: EspnStatsBlock[] }>(ESPN_STATS);
    const blocks = stats?.stats ?? [];
    const matchesOf = (ath: EspnLeader["athlete"]) =>
      (ath?.statistics ?? []).find((s) => s.name === "appearances")?.value ?? null;
    for (const blk of blocks) {
      const into = blk.name === "goalsLeaders" ? scorers : blk.name === "assistsLeaders" ? assists : null;
      if (!into) continue;
      for (const l of blk.leaders ?? []) {
        const ath = l.athlete;
        const name = ath?.displayName;
        if (!name) continue;
        const team = nameByTeam[norm(ath?.team?.displayName ?? "")] ?? ath?.team?.displayName ?? "";
        into[`${name}|${team}`] = { name, team, value: l.value ?? 0, matches: matchesOf(ath) };
      }
    }
  } catch {
    /* scorers/assists may be empty if the endpoint hiccups */
  }

  // Merge live per-match goals (authoritative, current) with ESPN's leaders
  // aggregate (lags behind, but carries the official appearances stat). Take the
  // higher goal AND appearance count so the board never under-reports the pitch.
  const mergedScorers: Record<string, Tally> = {};
  for (const g of Object.values(goalsByPlayer)) {
    mergedScorers[`${g.name}|${g.team}`] = { name: g.name, team: g.team, value: g.value, matches: g.matchIds.size };
  }
  for (const [key, r] of Object.entries(scorers)) {
    const m = mergedScorers[key];
    if (m) {
      m.value = Math.max(m.value, r.value);
      m.matches = Math.max(m.matches ?? 0, r.matches ?? 0) || null;
    } else {
      mergedScorers[key] = r;
    }
  }

  // ── Pass 3: penalty MISSED + ASSISTS from summary keyEvents (cached per event) ─
  // The assister isn't in the cheap scoreboard `details` (only the scorer is), so
  // assists are read from each match's keyEvents (participant[1] of a non-own
  // Goal) alongside penalty-miss plays. Both ride one per-event summary cache.
  // Compact per-player record (mirrors build-stats.mjs): n/t name+team, aid/tid
  // the core-API ids, gk keeper flag, sv saves, tk/bk tackles+blocks (null until
  // the core sweep fills them).
  type PlayerRec = {
    n: string;
    t: string;
    aid: string;
    tid: string;
    gk?: number;
    sv?: number;
    tk?: number;
    bk?: number;
    ps?: number;
    sh?: number;
  };
  type EventCache = {
    penMiss?: { name: string; team: string }[];
    assists?: { name: string; team: string }[];
    teamBox?: TeamBox[];
    players?: PlayerRec[];
    coreDone?: number;
  };
  const rawCache =
    (statsJson as {
      cache?: { byEvent?: Record<string, EventCache>; penMissByEvent?: Record<string, { name: string; team: string }[]> };
    }).cache ?? {};
  const byEvent: Record<string, EventCache> = {};
  if (rawCache.byEvent) Object.assign(byEvent, rawCache.byEvent);
  else if (rawCache.penMissByEvent)
    for (const [id, penMiss] of Object.entries(rawCache.penMissByEvent)) byEvent[id] = { penMiss };
  const liveEventIds = [...eventById.values()]
    .filter((ev) => (ev.status?.type?.state ?? "pre") === "in")
    .map((ev) => ev.id!)
    .filter(Boolean);
  // Refetch when live, never cached, or cached before assists / teamBox / players existed.
  const needSummary = [...new Set([...finishedEventIds, ...liveEventIds])].filter(
    (id) =>
      liveEventIds.includes(id) ||
      byEvent[id]?.assists == null ||
      byEvent[id]?.teamBox == null ||
      byEvent[id]?.players == null,
  );
  const summaries = await Promise.allSettled(needSummary.map(fetchSummary));
  const PEN_MISS = /penalty\s*-\s*(missed|saved)/i;
  needSummary.forEach((id, i) => {
    const b = summaries[i];
    if (b.status !== "fulfilled") return;
    const ev = eventById.get(id);
    const cs = ev?.competitions?.[0]?.competitors ?? [];
    const teamName: Record<string, string> = {};
    for (const c of cs) {
      const disp = c.team?.displayName ?? "";
      if (c.team?.id) teamName[c.team.id] = nameByTeam[norm(disp)] ?? disp;
    }
    const misses: { name: string; team: string }[] = [];
    const assistsArr: { name: string; team: string }[] = [];
    for (const e of b.value?.keyEvents ?? []) {
      const t = e.type?.text ?? "";
      const team = (e.team?.id && teamName[e.team.id]) || "";
      if (PEN_MISS.test(t)) {
        const p = (e.participants ?? [])[0]?.athlete?.displayName;
        if (p) misses.push({ name: p, team });
      } else if (/goal/i.test(t) && !/own/i.test(t)) {
        // participant[0] = scorer, [1] = assister (absent on solo / penalty goals).
        const a = (e.participants ?? [])[1]?.athlete?.displayName;
        if (a) assistsArr.push({ name: a, team });
      }
    }
    // Per-match team boxscore → raw counters for the completion boards.
    const teamBox: TeamBox[] = (b.value?.boxscore?.teams ?? []).map((tm) => {
      const disp = tm.team?.displayName ?? "";
      const get = (n: string): number | null => {
        const v = (tm.statistics ?? []).find((s) => s.name === n)?.displayValue;
        const f = parseFloat(v ?? "");
        return Number.isFinite(f) ? f : null;
      };
      return {
        team: nameByTeam[norm(disp)] ?? disp,
        possessionPct: get("possessionPct"),
        accuratePasses: get("accuratePasses"),
        totalPasses: get("totalPasses"),
        shotsOnTarget: get("shotsOnTarget"),
        totalShots: get("totalShots"),
        effectiveTackles: get("effectiveTackles"),
        totalTackles: get("totalTackles"),
        accurateCrosses: get("accurateCrosses"),
        totalCrosses: get("totalCrosses"),
        accurateLongBalls: get("accurateLongBalls"),
        totalLongBalls: get("totalLongBalls"),
      };
    });
    // Players who featured — identity for the core tackles/blocks sweep + keeper
    // saves. Carry previously-swept tk/bk across a live-match refetch.
    const prevPlayers = new Map((byEvent[id]?.players ?? []).map((p) => [p.aid, p]));
    const players: PlayerRec[] = [];
    for (const t of b.value?.rosters ?? []) {
      const tid = t.team?.id;
      const disp = t.team?.displayName ?? "";
      const team = (tid && teamName[tid]) || nameByTeam[norm(disp)] || disp;
      if (!tid) continue;
      for (const p of t.roster ?? []) {
        if (!p.starter && !p.subbedIn) continue; // unused subs have no match stats
        const name = p.athlete?.displayName;
        const aid = p.athlete?.id;
        if (!name || !aid) continue;
        const gk = p.position?.abbreviation === "G";
        const rec: PlayerRec = { n: name, t: team, aid, tid, ...(gk ? { gk: 1 } : {}) };
        if (gk) {
          const sv = (p.stats ?? []).find((s) => s.name === "saves")?.value;
          if (typeof sv === "number" && Number.isFinite(sv)) rec.sv = sv;
        }
        const prev = prevPlayers.get(aid);
        if (prev?.tk != null) rec.tk = prev.tk;
        if (prev?.bk != null) rec.bk = prev.bk;
        if (prev?.ps != null) rec.ps = prev.ps;
        if (prev?.sh != null) rec.sh = prev.sh;
        players.push(rec);
      }
    }
    byEvent[id] = { penMiss: misses, assists: assistsArr, teamBox, players };
  });
  const validIds = new Set([...eventById.keys()]);
  for (const id of Object.keys(byEvent)) if (!validIds.has(id)) delete byEvent[id];

  // ── Core sweep: per-player tackles + blocks (mirrors build-stats.mjs Pass 4) ──
  // The committed cron cache normally carries every finished match (`coreDone`),
  // so this only pays for live matches + anything that finished since the last
  // cron run — capped so a cold cache can't blow the serverless budget.
  const coreJobs: { id: string; p: PlayerRec }[] = [];
  for (const [id, rec] of Object.entries(byEvent)) {
    const live = liveEventIds.includes(id);
    // ps (passes — added 2026-07-09) postdates many coreDone-frozen matches;
    // treat a freeze as valid only when every player carries it (mirrors
    // build-stats.mjs unfreeze).
    const frozen = rec.coreDone && (rec.players ?? []).every((p) => p.ps != null && p.sh != null);
    if (!rec.players?.length || (frozen && !live)) continue;
    for (const p of rec.players) {
      if (!live && p.tk != null && p.bk != null && p.ps != null && p.sh != null) continue;
      coreJobs.push({ id, p });
    }
  }
  coreJobs.sort((a, b) => Number(liveEventIds.includes(b.id)) - Number(liveEventIds.includes(a.id)));
  const capped = coreJobs.slice(0, CORE_MAX_JOBS);
  let ban403 = 0; // consecutive 403s → the core host has temp-banned this IP; stop
  const fetchCore = async ({ id, p }: { id: string; p: PlayerRec }) => {
    const url = `${ESPN_CORE_EVENT}/${id}/competitions/${id}/competitors/${p.tid}/roster/${p.aid}/statistics/0`;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "matchday-edge/1.0" },
        signal: AbortSignal.timeout(10000),
        cache: "no-store",
      });
      if (res.status === 404) {
        ban403 = 0;
        p.tk = 0;
        p.bk = 0;
        p.ps = 0;
        p.sh = 0;
        return;
      }
      if (res.status === 403) {
        ban403++;
        return; // leave null → that game just doesn't count yet
      }
      if (!res.ok) return; // leave null → that game just doesn't count yet
      const data = (await res.json()) as {
        splits?: { categories?: { name?: string; stats?: { name?: string; value?: number }[] }[] };
      };
      const cat = (name: string) =>
        (data.splits?.categories ?? []).find((c) => c.name === name);
      const stat = (c: ReturnType<typeof cat>, n: string) => {
        const v = (c?.stats ?? []).find((s) => s.name === n)?.value;
        return typeof v === "number" && Number.isFinite(v) ? v : 0;
      };
      const def = cat("defensive");
      const off = cat("offensive");
      p.tk = stat(def, "totalTackles");
      p.bk = stat(def, "blockedShots");
      p.ps = stat(off, "totalPasses");
      p.sh = stat(off, "totalShots");
      ban403 = 0;
    } catch {
      /* leave null — the cron backfills */
    }
  };
  if (capped.length) {
    let next = 0;
    const worker = async () => {
      while (next < capped.length && ban403 < 25) await fetchCore(capped[next++]);
    };
    await Promise.all(Array.from({ length: Math.min(CORE_CONCURRENCY, capped.length) }, worker));
  }

  const penMissed: Record<string, Tally> = {};
  const assistsByPlayer: Record<string, { name: string; team: string; value: number; matchIds: Set<string> }> = {};
  for (const [id, rec] of Object.entries(byEvent)) {
    for (const m of rec.penMiss ?? []) tallyAdd(penMissed, m.name, m.team);
    for (const a of rec.assists ?? []) {
      if (!a.name || a.name === "Unknown") continue;
      const k = `${a.name}|${a.team ?? ""}`;
      const row = (assistsByPlayer[k] ??= { name: a.name, team: a.team ?? "", value: 0, matchIds: new Set<string>() });
      row.value += 1;
      row.matchIds.add(id);
    }
  }

  // Merge live per-match assists (authoritative for in-window games) with ESPN's
  // assistsLeaders aggregate (out-of-window games + appearances). Max of both so
  // the board never under-reports — mirrors the scorers merge above.
  const mergedAssists: Record<string, Tally> = {};
  for (const a of Object.values(assistsByPlayer)) {
    mergedAssists[`${a.name}|${a.team}`] = { name: a.name, team: a.team, value: a.value, matches: a.matchIds.size };
  }
  for (const [key, r] of Object.entries(assists)) {
    const m = mergedAssists[key];
    if (m) {
      m.value = Math.max(m.value, r.value);
      m.matches = Math.max(m.matches ?? 0, r.matches ?? 0) || null;
    } else {
      mergedAssists[key] = r;
    }
  }

  // Tackles / blocks / keeper saves — tournament totals per player. `matches`
  // counts only games where the stat was actually fetched (null ≠ 0).
  const tackles: Record<string, Tally> = {};
  const blocksTally: Record<string, Tally> = {};
  const gkSaves: Record<string, Tally> = {};
  const statAdd = (map: Record<string, Tally>, p: PlayerRec, v: number | undefined) => {
    if (v == null) return;
    const row = (map[`${p.n}|${p.t}`] ??= { name: p.n, team: p.t, value: 0, matches: 0 });
    row.value += v;
    row.matches = (row.matches ?? 0) + 1;
  };
  for (const rec of Object.values(byEvent)) {
    for (const p of rec.players ?? []) {
      statAdd(tackles, p, p.tk);
      statAdd(blocksTally, p, p.bk);
      if (p.gk) statAdd(gkSaves, p, p.sv);
    }
  }

  // Filter each pool to alive teams BEFORE topN slices to ten, so every board is
  // the true top ten among sides still in the tournament.
  const categories: Record<StatCategoryKey, StatRow[]> = {
    scorers: topN(Object.values(mergedScorers).filter(aliveRow), flagFor),
    assists: topN(Object.values(mergedAssists).filter(aliveRow), flagFor),
    cleanSheets: topTeams(Object.values(cleanSheets).filter(aliveRow), flagFor),
    yellowCards: topN(Object.values(yellow).filter(aliveRow), flagFor),
    redCards: topN(Object.values(red).filter(aliveRow), flagFor),
    penaltyScored: topN(Object.values(penScored).filter(aliveRow), flagFor),
    penaltyMissed: topN(Object.values(penMissed).filter(aliveRow), flagFor),
    tackles: topN(Object.values(tackles).filter(aliveRow), flagFor),
    blocks: topN(Object.values(blocksTally).filter(aliveRow), flagFor),
    gkSaves: topN(Object.values(gkSaves).filter(aliveRow), flagFor),
  };

  // ── Per-team squad stat sheets (mirrors build-stats.mjs buildPlayersByTeam) ──
  // Every player on every alive team, counting stats compiled across all games.
  const lines: Record<string, PlayerStatLine & { team: string }> = {};
  const line = (name: string, team: string) =>
    (lines[`${name}|${team}`] ??= {
      name,
      apps: 0,
      goals: 0,
      assists: 0,
      shots: 0,
      tackles: 0,
      blocks: 0,
      passes: 0,
      saves: 0,
      yellow: 0,
      red: 0,
      penScored: 0,
      penMissed: 0,
      gk: false,
      team,
    });
  for (const rec of Object.values(byEvent)) {
    for (const p of rec.players ?? []) {
      if (!p.n || !p.t) continue;
      const l = line(p.n, p.t);
      l.apps += 1;
      if (p.gk) l.gk = true;
      if (p.sh != null) l.shots += p.sh;
      if (p.tk != null) l.tackles += p.tk;
      if (p.bk != null) l.blocks += p.bk;
      if (p.ps != null) l.passes += p.ps;
      if (p.sv != null) l.saves += p.sv;
    }
  }
  for (const r of Object.values(mergedScorers)) if (r.name && r.team) line(r.name, r.team).goals = r.value;
  for (const r of Object.values(mergedAssists)) if (r.name && r.team) line(r.name, r.team).assists = r.value;
  for (const r of Object.values(yellow)) if (r.name && r.team) line(r.name, r.team).yellow = r.value;
  for (const r of Object.values(red)) if (r.name && r.team) line(r.name, r.team).red = r.value;
  for (const r of Object.values(penScored)) if (r.name && r.team) line(r.name, r.team).penScored = r.value;
  for (const r of Object.values(penMissed)) if (r.name && r.team) line(r.name, r.team).penMissed = r.value;

  const teamsMap: Record<string, TeamPlayerSheet> = {};
  for (const l of Object.values(lines)) {
    const key = norm(l.team);
    if (alive.size > 0 && !alive.has(key)) continue;
    const { team, ...rest } = l;
    (teamsMap[key] ??= { team, flag: flagFor(team), players: [] }).players.push(rest);
  }
  const playersByTeam: TeamPlayerSheet[] = Object.values(teamsMap)
    .map((t) => ({
      team: t.team,
      flag: t.flag,
      players: t.players
        .filter((p) => p.apps > 0 || p.goals > 0 || p.assists > 0 || p.yellow > 0 || p.red > 0)
        .sort(
          (a, b) =>
            b.goals - a.goals ||
            b.assists - a.assists ||
            b.apps - a.apps ||
            b.tackles - a.tackles ||
            a.name.localeCompare(b.name),
        ),
    }))
    .filter((t) => t.players.length > 0)
    .sort((a, b) => a.team.localeCompare(b.team));

  return {
    meta: {
      generatedAt: new Date(now).toISOString(),
      source: "ESPN keyless FIFA World Cup feed (statistics + scoreboard + summary)",
      finished: finishedEventIds.length,
    },
    categories,
    teamStats: buildTeamStats(byEvent, flagFor, alive),
    playersByTeam,
  };
}
