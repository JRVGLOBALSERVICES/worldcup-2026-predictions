import fixturesJson from "@/data/fixtures.json";
import statsJson from "@/data/stats.json";
import type { StatRow, StatCategoryKey, StatsFile } from "./stats";

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
type EspnSummary = { keyEvents?: EspnKeyEvent[] };

type Tally = { name: string; team: string; value: number; matches?: number | null };

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

  // ── Pass 3: penalty MISSED from summary keyEvents (cached per event) ─────────
  const cache: Record<string, { name: string; team: string }[]> = {
    ...((statsJson as { cache?: { penMissByEvent?: Record<string, { name: string; team: string }[]> } }).cache
      ?.penMissByEvent ?? {}),
  };
  const liveEventIds = [...eventById.values()]
    .filter((ev) => (ev.status?.type?.state ?? "pre") === "in")
    .map((ev) => ev.id!)
    .filter(Boolean);
  const needSummary = [...new Set([...finishedEventIds, ...liveEventIds])].filter(
    (id) => liveEventIds.includes(id) || cache[id] == null,
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
    for (const e of b.value?.keyEvents ?? []) {
      if (!PEN_MISS.test(e.type?.text ?? "")) continue;
      const p = (e.participants ?? [])[0]?.athlete?.displayName;
      const team = (e.team?.id && teamName[e.team.id]) || "";
      if (p) misses.push({ name: p, team });
    }
    cache[id] = misses;
  });
  const validIds = new Set([...eventById.keys()]);
  for (const id of Object.keys(cache)) if (!validIds.has(id)) delete cache[id];

  const penMissed: Record<string, Tally> = {};
  for (const misses of Object.values(cache)) {
    for (const m of misses) tallyAdd(penMissed, m.name, m.team);
  }

  const categories: Record<StatCategoryKey, StatRow[]> = {
    scorers: topN(Object.values(mergedScorers), flagFor),
    assists: topN(Object.values(assists), flagFor),
    cleanSheets: topTeams(Object.values(cleanSheets), flagFor),
    yellowCards: topN(Object.values(yellow), flagFor),
    redCards: topN(Object.values(red), flagFor),
    penaltyScored: topN(Object.values(penScored), flagFor),
    penaltyMissed: topN(Object.values(penMissed), flagFor),
  };

  return {
    meta: {
      generatedAt: new Date(now).toISOString(),
      source: "ESPN keyless FIFA World Cup feed (statistics + scoreboard + summary)",
      finished: finishedEventIds.length,
    },
    categories,
  };
}
