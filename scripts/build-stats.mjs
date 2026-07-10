#!/usr/bin/env node
/**
 * Tournament stat leaderboards (Golden Boot race + discipline + penalties),
 * snapshotted from ESPN's keyless FIFA World Cup feeds into data/stats.json so
 * the /stats page can render seven top-10 tables without a live fetch.
 *
 *   node scripts/build-stats.mjs            # write data/stats.json
 *   node scripts/build-stats.mjs --check     # report only, no write (exit 2 on change)
 *
 * Seven categories, three sources (each merged toward "never under-report"):
 *   • scorers                → per-match scoreboard `details` scoring plays
 *                             (authoritative + current), merged-max with ESPN's
 *                             season `/statistics` goalsLeaders for appearances.
 *   • assists                → per-match summary `keyEvents` (participant[1] of a
 *                             non-own Goal), merged-max with ESPN's assistsLeaders
 *                             aggregate (covers out-of-window games + appearances).
 *   • cleanSheets, yellow,
 *     red, penaltyScored     → aggregated from the per-date scoreboard events'
 *                             `competitions[].details` (goals + cards), the same
 *                             array build-results.mjs reads — no extra fetch.
 *   • penaltyMissed          → per-match summary `keyEvents` (a "Penalty - Saved"
 *                             / "Penalty - Missed" play is never in `details`).
 *                             Assists + penalty-misses share one per-event summary
 *                             cache so the cron only hits a summary once per match.
 *   • tackles, blocks        → ESPN core API per-athlete event statistics (Opta
 *                             defensive totalTackles / blockedShots) — the summary
 *                             feed carries NO per-player tackle/block data. One
 *                             request per player who featured, swept once per
 *                             finished match and cached (`coreDone`), so only new
 *                             + live matches cost requests on later runs.
 *   • gkSaves                → per-keeper `saves` off the summary `rosters` player
 *                             stats (verified equal to the core API goalKeeping
 *                             count) — rides the existing summary fetch for free.
 *
 * Reuses the exact ALIAS/normalise rules as lib/live.ts & build-results.mjs —
 * keep the ALIAS maps in sync.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { aliveTeamKeys } from "./lib/alive.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = join(__dirname, "..", "data", "fixtures.json");
const RESULTS_PATH = join(__dirname, "..", "data", "results.json");
const STATS_PATH = join(__dirname, "..", "data", "stats.json");

const ESPN_BASE =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";
const ESPN_SUMMARY =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary";
const ESPN_STATS =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/statistics";
// Core API — per-athlete per-event Opta stats (same endpoint lib/live.ts uses to
// grade playerTacklesOver legs). The only keyless source of tackles + blocks.
const ESPN_CORE_EVENT =
  "https://sports.core.api.espn.com/v2/sports/soccer/leagues/fifa.world/events";
// The core host temp-bans an IP (403 on everything) after a burst of ~1000
// requests, so the sweep stays polite: low concurrency, a hard per-run cap, and
// an early bail once the ban pattern (consecutive 403s) shows. Failures stay
// null and retry, so the historical backfill just converges across cron runs.
const CORE_CONCURRENCY = 6;
const CORE_MAX_JOBS_PER_RUN = 800;
const CORE_BAN_TRIP = 25; // consecutive 403s → we're banned, stop wasting the window

const CHECK_ONLY = process.argv.includes("--check");
const TOP_N = 10;

// Mirror of lib/live.ts ALIAS — ESPN spells a few nations differently.
const ALIAS = {
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
const norm = (s) => {
  const a = String(s).toLowerCase().replace(/[^a-z]/g, "");
  return ALIAS[a] ?? a;
};

function dateParam(d) {
  return [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, "0"),
    String(d.getUTCDate()).padStart(2, "0"),
  ].join("");
}

async function getJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "matchday-edge/1.0" },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`ESPN ${res.status} for ${url}`);
  return res.json();
}

const fetchDate = (param) => getJson(`${ESPN_BASE}?dates=${param}`).then((d) => d.events ?? []);
const fetchSummary = (eventId) => getJson(`${ESPN_SUMMARY}?event=${eventId}`);

/** Player-keyed tally → { "name|team": { name, team, value } }. */
function tallyAdd(map, name, team, n = 1) {
  if (!name || name === "Unknown") return;
  const key = `${name}|${team ?? ""}`;
  const row = (map[key] ??= { name, team: team ?? "", value: 0 });
  row.value += n;
}

/**
 * Top-N rows by value (desc), ties broken alphabetically, with standard
 * competition ranking (equal values share a rank, the next rank skips). Adds a
 * `flag` from the fixtures map and carries through any extra fields (`matches`).
 */
function topN(rows, flagFor, n = TOP_N) {
  const sorted = rows
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
    .slice(0, n);
  return sorted.map((r, i) => ({
    rank: 1 + sorted.filter((o) => o.value > r.value).length,
    name: r.name,
    team: r.team,
    flag: flagFor(r.team),
    value: r.value,
    ...(r.matches != null ? { matches: r.matches } : {}),
  }));
}

/** Same as topN but the entity is a team (clean sheets) — no player name. */
function topTeams(rows, flagFor, n = TOP_N) {
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

// Sum every team's per-match boxscore counters into one bucket per team, keyed
// on the normalised name. matches counts only games the team actually featured in.
function aggregateTeamBox(byEvent) {
  const agg = {};
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
      for (const f of [
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
      ]) {
        if (tb[f] != null) a[f] += tb[f];
      }
    }
  }
  return agg;
}

// Rank teams by a derived percentage (true aggregate: Σ accurate / Σ attempted),
// top-N, standard competition ranking. `pick` returns the % or null (no attempts).
function pctBoard(agg, pick, flagFor, n = TOP_N) {
  const rows = Object.values(agg)
    .map((a) => {
      const value = pick(a);
      return value == null || !Number.isFinite(value)
        ? null
        : { team: a.team, value: Math.round(value * 10) / 10, matches: a.matches };
    })
    .filter(Boolean)
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

const ratio = (num, den) => (den > 0 ? (num / den) * 100 : null);

function buildTeamStats(byEvent, flagFor, alive) {
  const agg = aggregateTeamBox(byEvent);
  // Keep only sides still in the competition (agg is keyed on the normalised
  // team name). Empty alive set → leave everything, so a glitch never blanks the
  // completion boards.
  if (alive && alive.size > 0) {
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
 * Per-team squad stat sheets. For every ALIVE team, one row per player who has
 * featured (or scored/assisted/been booked), with their counting stats compiled
 * across every game they've played:
 *   • apps            — games featured in (starter or used sub), from byEvent players[]
 *   • goals / assists — the merged tournament tallies (name|team keyed)
 *   • tackles/blocks/passes/saves — Σ of the per-match core-API values
 *   • yellow/red/penScored/penMissed — the discipline + penalty tallies
 * Teams sorted A→Z; players sorted goals → assists → apps → tackles → name.
 */
function buildPlayersByTeam({ byEvent, mergedScorers, mergedAssists, yellow, red, penScored, penMissed, alive, flagFor }) {
  const lines = {}; // "name|team" → line
  const get = (name, team) =>
    (lines[`${name}|${team}`] ??= {
      name,
      team,
      apps: 0,
      goals: 0,
      assists: 0,
      shots: 0,
      sot: 0,
      tackles: 0,
      blocks: 0,
      passes: 0,
      saves: 0,
      yellow: 0,
      red: 0,
      penScored: 0,
      penMissed: 0,
      gk: false,
    });

  // Per-match player records → appearances + shots/tackles/blocks/passes/saves.
  for (const rec of Object.values(byEvent)) {
    for (const p of rec.players ?? []) {
      if (!p.n || !p.t) continue;
      const l = get(p.n, p.t);
      l.apps += 1;
      if (p.gk) l.gk = true;
      if (p.sh != null) l.shots += p.sh;
      if (p.st != null) l.sot += p.st;
      if (p.tk != null) l.tackles += p.tk;
      if (p.bk != null) l.blocks += p.bk;
      if (p.ps != null) l.passes += p.ps;
      if (p.sv != null) l.saves += p.sv;
    }
  }
  // Goals / assists / cards / penalties (all name|team keyed).
  for (const r of Object.values(mergedScorers)) if (r.name && r.team) get(r.name, r.team).goals = r.value;
  for (const r of Object.values(mergedAssists)) if (r.name && r.team) get(r.name, r.team).assists = r.value;
  for (const r of Object.values(yellow)) if (r.name && r.team) get(r.name, r.team).yellow = r.value;
  for (const r of Object.values(red)) if (r.name && r.team) get(r.name, r.team).red = r.value;
  for (const r of Object.values(penScored)) if (r.name && r.team) get(r.name, r.team).penScored = r.value;
  for (const r of Object.values(penMissed)) if (r.name && r.team) get(r.name, r.team).penMissed = r.value;

  // Group by alive team. Empty alive set (data glitch) → keep everyone.
  const teams = {};
  for (const l of Object.values(lines)) {
    const key = norm(l.team);
    if (alive && alive.size > 0 && !alive.has(key)) continue;
    (teams[key] ??= { team: l.team, flag: flagFor(l.team), players: [] }).players.push(l);
  }

  return Object.values(teams)
    .map((t) => ({
      team: t.team,
      flag: t.flag,
      players: t.players
        // Drop ghosts with literally nothing recorded yet.
        .filter((p) => p.apps > 0 || p.goals > 0 || p.assists > 0 || p.yellow > 0 || p.red > 0)
        .sort(
          (a, b) =>
            b.goals - a.goals ||
            b.assists - a.assists ||
            b.apps - a.apps ||
            b.tackles - a.tackles ||
            a.name.localeCompare(b.name),
        )
        .map((p) => ({
          name: p.name,
          apps: p.apps,
          goals: p.goals,
          assists: p.assists,
          shots: p.shots,
          sot: p.sot,
          tackles: p.tackles,
          blocks: p.blocks,
          passes: p.passes,
          saves: p.saves,
          yellow: p.yellow,
          red: p.red,
          penScored: p.penScored,
          penMissed: p.penMissed,
          gk: p.gk,
        })),
    }))
    .filter((t) => t.players.length > 0)
    .sort((a, b) => a.team.localeCompare(b.team));
}

async function main() {
  const fixtures = JSON.parse(readFileSync(FIXTURES_PATH, "utf8"));
  // Leaderboards only feature teams still in the competition — a top scorer whose
  // side is knocked out drops off the board. `results` carries knockout advancement.
  let results = {};
  try {
    results = JSON.parse(readFileSync(RESULTS_PATH, "utf8")).results ?? {};
  } catch {
    /* no results snapshot yet (pre-tournament) → everyone stays alive */
  }
  const alive = aliveTeamKeys(fixtures, results, norm);
  // Keep a row only if its team is still alive. Empty set (data glitch) → no filter,
  // so a snapshot hiccup never blanks every board.
  const aliveRow = (r) => alive.size === 0 || alive.has(norm(r.team));

  // Flag lookup, keyed on the normalised team name so ESPN's spelling resolves.
  const flagByTeam = {};
  const nameByTeam = {}; // norm → our canonical display name (nicer than ESPN's now and then)
  for (const f of fixtures) {
    for (const t of [f.home, f.away]) {
      flagByTeam[norm(t.name)] = t.flag;
      nameByTeam[norm(t.name)] = t.name;
    }
  }
  const flagFor = (team) => flagByTeam[norm(team)] ?? "🏳️";

  // ── Dates to query (each fixture's UTC day + the day before, ESPN bucketing) ─
  const dates = new Set();
  for (const f of fixtures) {
    const base = new Date(f.kickoffUTC);
    for (const off of [-1, 0]) dates.add(dateParam(new Date(base.getTime() + off * 86400000)));
  }

  const batches = await Promise.allSettled([...dates].map(fetchDate));
  const events = [];
  let fetched = 0;
  for (const b of batches) {
    if (b.status === "fulfilled") {
      fetched++;
      events.push(...b.value);
    }
  }
  if (fetched === 0) {
    console.error("ESPN unreachable — no dates fetched. Aborting (no changes).");
    process.exit(1);
  }

  // De-dup events (the ±1-day windows overlap) by event id.
  const eventById = new Map();
  for (const ev of events) if (ev.id) eventById.set(ev.id, ev);

  // ── Pass 1: scoreboard details → goals, cards, penalties scored, clean sheets ─
  const yellow = {};
  const red = {};
  const penScored = {};
  const cleanSheets = {}; // team(norm) → { team, value }
  // Goals straight from the per-match scoring events (authoritative + current).
  // ESPN's /statistics goalsLeaders aggregate lags a match or two behind these,
  // so we tally goals here and only use /statistics to backfill appearances.
  const goalsByPlayer = {}; // "name|team" → { name, team, value, matchIds:Set }
  const finishedEventIds = [];

  for (const ev of eventById.values()) {
    const comp = ev.competitions?.[0];
    const cs = comp?.competitors ?? [];
    if (cs.length < 2) continue;
    const state = ev.status?.type?.state ?? "pre"; // pre | in | post
    if (state === "pre") continue;

    // team id → display name (prefer our canonical spelling when we know it)
    const teamName = {};
    for (const c of cs) {
      const disp = c.team?.displayName ?? "";
      teamName[c.team?.id] = nameByTeam[norm(disp)] ?? disp;
    }

    for (const d of comp?.details ?? []) {
      const who = (d.athletesInvolved ?? [])[0]?.displayName;
      const team = teamName[d.team?.id];
      if (d.yellowCard && !d.redCard) tallyAdd(yellow, who, team);
      if (d.redCard) tallyAdd(red, who, team);
      if (d.scoringPlay && d.penaltyKick && !d.ownGoal) tallyAdd(penScored, who, team);
      // Every non-own-goal scoring play (open play + converted penalties) is a goal
      // for the scorer — the Golden Boot count.
      if (d.scoringPlay && !d.ownGoal && who && who !== "Unknown" && team) {
        const k = `${who}|${team}`;
        const g = (goalsByPlayer[k] ??= { name: who, team, value: 0, matchIds: new Set() });
        g.value += 1;
        if (ev.id) g.matchIds.add(ev.id);
      }
    }

    if (state === "post") {
      finishedEventIds.push(ev.id);
      // Clean sheet = the side that conceded 0. Credit it to the keeping team.
      const home = cs.find((c) => c.homeAway === "home");
      const away = cs.find((c) => c.homeAway === "away");
      const hg = parseInt(home?.score ?? "0", 10) || 0;
      const ag = parseInt(away?.score ?? "0", 10) || 0;
      const credit = (teamId) => {
        const team = teamName[teamId];
        const key = norm(team);
        const row = (cleanSheets[key] ??= { team, value: 0 });
        row.value += 1;
      };
      if (ag === 0 && home?.team?.id) credit(home.team.id);
      if (hg === 0 && away?.team?.id) credit(away.team.id);
    }
  }

  // ── Pass 2: season /statistics leaders → scorers, assists ───────────────────
  const scorers = {};
  const assists = {};
  try {
    const stats = await getJson(ESPN_STATS);
    const blocks = stats?.stats ?? [];
    const matchesOf = (ath) =>
      (ath?.statistics ?? []).find((s) => s.name === "appearances")?.value ?? null;
    for (const blk of blocks) {
      const into = blk.name === "goalsLeaders" ? scorers : blk.name === "assistsLeaders" ? assists : null;
      if (!into) continue;
      for (const l of blk.leaders ?? []) {
        const ath = l.athlete;
        const name = ath?.displayName;
        if (!name) continue;
        const team = nameByTeam[norm(ath?.team?.displayName ?? "")] ?? ath?.team?.displayName ?? "";
        const key = `${name}|${team}`;
        into[key] = { name, team, value: l.value ?? 0, matches: matchesOf(ath) };
      }
    }
  } catch (e) {
    console.error(`statistics endpoint failed (${e.message}) — scorers/assists may be empty.`);
  }

  // Merge live per-match goals (authoritative, current) with ESPN's leaders
  // aggregate (lags behind, but carries the official appearances stat). Take the
  // higher goal AND appearance count so the board never under-reports the pitch.
  const mergedScorers = {};
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
  // The assister isn't in the cheap scoreboard `details` (only the scorer is) and
  // ESPN's season /statistics assistsLeaders lags a match behind for in-window
  // games — so we read assists straight from each match's keyEvents (participant
  // [1] of a non-own Goal) here, alongside the penalty-miss plays. Both are cached
  // per event so the cron only hits a summary once per finished match.
  //
  // Cache shape: cache.byEvent[id] = { penMiss:[{name,team}], assists:[{name,team}] }.
  // Migrate the older penMissByEvent-only shape (assists then backfill on first run).
  let byEvent = {};
  try {
    const prev = JSON.parse(readFileSync(STATS_PATH, "utf8")).cache ?? {};
    if (prev.byEvent) byEvent = prev.byEvent;
    else if (prev.penMissByEvent)
      for (const [id, penMiss] of Object.entries(prev.penMissByEvent)) byEvent[id] = { penMiss };
  } catch {
    /* first run */
  }
  const liveEventIds = [...eventById.values()]
    .filter((ev) => (ev.status?.type?.state ?? "pre") === "in")
    .map((ev) => ev.id);
  // Refetch a summary when the match is live, never cached, or cached before one
  // of the newer blocks (assists / teamBox / players / per-player shots) existed —
  // so each block backfills exactly once. `sh` (per-player shots, added 2026-07-10)
  // is tallied straight off the commentary feed below, so a match cached before it
  // existed is refetched once here to fill it (cheap — one hit per match on the
  // unthrottled site.api host, vs the rate-limited per-player core sweep).
  const needSummary = [...new Set([...finishedEventIds, ...liveEventIds])].filter(
    (id) =>
      liveEventIds.includes(id) ||
      byEvent[id]?.assists == null ||
      byEvent[id]?.teamBox == null ||
      byEvent[id]?.players == null ||
      (byEvent[id]?.players ?? []).some((p) => p.sh == null || p.st == null),
  );
  const summaries = await Promise.allSettled(needSummary.map(fetchSummary));
  const PEN_MISS = /penalty\s*-\s*(missed|saved)/i;
  needSummary.forEach((id, i) => {
    const b = summaries[i];
    if (b.status !== "fulfilled") return; // keep any prior cache for this id
    const ev = eventById.get(id);
    const cs = ev?.competitions?.[0]?.competitors ?? [];
    const teamName = {};
    for (const c of cs) {
      const disp = c.team?.displayName ?? "";
      teamName[c.team?.id] = nameByTeam[norm(disp)] ?? disp;
      teamName[c.team?.displayName] = nameByTeam[norm(disp)] ?? disp;
    }
    const misses = [];
    const assistsArr = [];
    for (const e of b.value?.keyEvents ?? []) {
      const t = e.type?.text ?? "";
      const team = teamName[e.team?.id] ?? teamName[e.team?.displayName] ?? "";
      if (PEN_MISS.test(t)) {
        const p = (e.participants ?? [])[0]?.athlete?.displayName;
        if (p) misses.push({ name: p, team });
      } else if (/goal/i.test(t) && !/own/i.test(t)) {
        // participant[0] = scorer, [1] = assister (absent on solo / penalty goals).
        const a = (e.participants ?? [])[1]?.athlete?.displayName;
        if (a) assistsArr.push({ name: a, team });
      }
    }
    // Per-match team boxscore → the raw counters behind the completion boards
    // (pass/shot/tackle/cross/long-ball accuracy + possession). Stored as raw
    // sums so the aggregate % is computed over all attempts, not an avg-of-avgs.
    const teamBox = (b.value?.boxscore?.teams ?? []).map((tm) => {
      const disp = tm.team?.displayName ?? "";
      const get = (n) => {
        const v = (tm.statistics ?? []).find((s) => s.name === n)?.displayValue;
        const f = parseFloat(v);
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
    // Per-player TOTAL shots off the commentary plays feed — the same tally
    // lib/live.ts uses for prop grading (attempt = any "Shot …" play or a
    // non-own goal / scored penalty), which matches the boxscore totalShots.
    // Filling shots from this single cheap per-event summary means the player
    // index no longer waits on the rate-limited per-player core sweep.
    const isShotPlay = (t) =>
      t.startsWith("Shot") || (t.startsWith("Goal") && !t.includes("Own")) || t === "Penalty - Scored";
    // On target = a scored non-own goal, a scored penalty, or an explicit
    // "Shot On Target" play (boxscore convention: a goal counts on target;
    // woodwork/blocked/off-target do not). Same feed as the total-shots tally.
    const isOnTarget = (t) =>
      (t.startsWith("Goal") && !t.includes("Own")) || t === "Penalty - Scored" || t === "Shot On Target";
    const shotsByName = {};
    const sotByName = {};
    for (const c of b.value?.commentary ?? []) {
      const pl = c.play;
      const t = pl?.type?.text;
      if (!t || !pl?.team?.displayName || !isShotPlay(t)) continue;
      const taker = pl.participants?.[0]?.athlete?.displayName;
      if (taker) {
        shotsByName[taker] = (shotsByName[taker] ?? 0) + 1;
        if (isOnTarget(t)) sotByName[taker] = (sotByName[taker] ?? 0) + 1;
      }
    }
    // Players who featured (starter or sub used), off the summary team sheet:
    // identity for the core tackles/blocks sweep below + per-keeper saves (`sv`,
    // stored for keepers only — verified identical to the core goalKeeping count).
    // sh (shots) is set here from the commentary tally; tk/bk/ps (tackles/blocks/
    // passes) start absent and are filled by the core sweep — carry any
    // previously-swept values across a live-match refetch.
    const prevPlayers = new Map(
      (byEvent[id]?.players ?? []).map((p) => [p.aid, p]),
    );
    const players = [];
    for (const t of b.value?.rosters ?? []) {
      const tid = t.team?.id;
      const team = (tid && teamName[tid]) || teamName[t.team?.displayName] || "";
      if (!tid) continue;
      for (const p of t.roster ?? []) {
        if (!p.starter && !p.subbedIn) continue; // unused subs have no match stats
        const name = p.athlete?.displayName;
        const aid = p.athlete?.id;
        if (!name || !aid) continue;
        const gk = p.position?.abbreviation === "G";
        const rec = { n: name, t: team, aid, tid, ...(gk ? { gk: 1 } : {}) };
        if (gk) {
          const sv = (p.stats ?? []).find((s) => s.name === "saves")?.value;
          if (typeof sv === "number" && Number.isFinite(sv)) rec.sv = sv;
        }
        rec.sh = shotsByName[name] ?? 0;
        rec.st = sotByName[name] ?? 0;
        const prev = prevPlayers.get(aid);
        if (prev?.tk != null) rec.tk = prev.tk;
        if (prev?.bk != null) rec.bk = prev.bk;
        if (prev?.ps != null) rec.ps = prev.ps;
        players.push(rec);
      }
    }
    byEvent[id] = { penMiss: misses, assists: assistsArr, teamBox, players }; // [] is a valid "checked, none"
  });
  // Drop cache entries for events no longer in our window (keeps the file tight).
  const validIds = new Set([...eventById.keys()]);
  for (const id of Object.keys(byEvent)) if (!validIds.has(id)) delete byEvent[id];

  // ── Pass 4: per-player tackles + blocks off the core API (cached per event) ──
  // One request per player who featured. A finished match is swept until every
  // player has data, then frozen (`coreDone`); live matches re-sweep every run so
  // the boards move with the game. A 404 (no stat page) counts as 0 — it adds
  // nothing and stops eternal refetching; network errors stay null and retry.
  // ps (passes — added 2026-07-09 for the per-match player sheets) postdates
  // many frozen matches: unfreeze any whose players lack it so the sweep
  // backfills the new field (tk/bk already fetched are kept — only ps refetches).
  // (sh/shots is filled from the commentary feed in Pass 3, not here — so it
  // never forces a core-sweep unfreeze.)
  for (const rec of Object.values(byEvent)) {
    if (rec.coreDone && !(rec.players ?? []).every((p) => p.ps != null)) delete rec.coreDone;
  }
  const coreJobs = [];
  for (const [id, rec] of Object.entries(byEvent)) {
    const live = liveEventIds.includes(id);
    if (!rec.players?.length || (rec.coreDone && !live)) continue;
    for (const p of rec.players) {
      if (!live && p.tk != null && p.bk != null && p.ps != null) continue; // finished + already fetched
      coreJobs.push({ id, p });
    }
  }
  let coreFailed = 0;
  let ban403 = 0; // consecutive 403 counter — resets on any success
  const fetchCore = async ({ id, p }) => {
    const url = `${ESPN_CORE_EVENT}/${id}/competitions/${id}/competitors/${p.tid}/roster/${p.aid}/statistics/0`;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "matchday-edge/1.0" },
        signal: AbortSignal.timeout(10000),
      });
      if (res.status === 404) {
        ban403 = 0;
        p.tk = 0;
        p.bk = 0;
        p.ps = 0;
        return;
      }
      if (res.status === 403) {
        ban403++;
        throw new Error("ESPN 403");
      }
      if (!res.ok) throw new Error(`ESPN ${res.status}`);
      const data = await res.json();
      ban403 = 0;
      const cat = (name) => (data.splits?.categories ?? []).find((c) => c.name === name);
      const stat = (c, n) => {
        const v = (c?.stats ?? []).find((s) => s.name === n)?.value;
        return typeof v === "number" && Number.isFinite(v) ? v : 0;
      };
      const def = cat("defensive");
      const off = cat("offensive");
      p.tk = stat(def, "totalTackles");
      p.bk = stat(def, "blockedShots");
      p.ps = stat(off, "totalPasses");
    } catch {
      coreFailed++; // leave null → pending, retried next run
    }
  };
  // Small worker pool. Live-match players jump the queue so an in-play board
  // never starves behind historical backfill under the per-run cap.
  if (coreJobs.length) {
    coreJobs.sort((a, b) => Number(liveEventIds.includes(b.id)) - Number(liveEventIds.includes(a.id)));
    const jobs = coreJobs.slice(0, CORE_MAX_JOBS_PER_RUN);
    let next = 0;
    const worker = async () => {
      while (next < jobs.length && ban403 < CORE_BAN_TRIP) await fetchCore(jobs[next++]);
    };
    await Promise.all(Array.from({ length: Math.min(CORE_CONCURRENCY, jobs.length) }, worker));
    const attempted = Math.min(next, jobs.length);
    const deferred = coreJobs.length - attempted;
    console.log(
      `Core sweep: ${attempted} attempted, ${attempted - coreFailed} ok, ${coreFailed} failed${
        ban403 >= CORE_BAN_TRIP ? " (403-banned, bailed early)" : ""
      }${deferred ? `, ${deferred} deferred to next run` : ""}.`,
    );
  }
  // Freeze finished matches once complete so they never cost requests again.
  for (const [id, rec] of Object.entries(byEvent)) {
    if (liveEventIds.includes(id) || !rec.players?.length) continue;
    if (rec.players.every((p) => p.tk != null && p.bk != null && p.ps != null)) rec.coreDone = 1;
  }

  const penMissed = {};
  const assistsByPlayer = {}; // "name|team" → { name, team, value, matchIds:Set }
  for (const [id, rec] of Object.entries(byEvent)) {
    for (const m of rec.penMiss ?? []) tallyAdd(penMissed, m.name, m.team);
    for (const a of rec.assists ?? []) {
      if (!a.name || a.name === "Unknown") continue;
      const k = `${a.name}|${a.team ?? ""}`;
      const row = (assistsByPlayer[k] ??= { name: a.name, team: a.team ?? "", value: 0, matchIds: new Set() });
      row.value += 1;
      row.matchIds.add(id);
    }
  }

  // Merge live per-match assists (authoritative for in-window games, current) with
  // ESPN's assistsLeaders aggregate (carries out-of-window games + appearances).
  // Max of both so the board never under-reports — mirrors the scorers merge above.
  const mergedAssists = {};
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

  // ── Tackles / blocks / keeper saves — tournament totals per player ──────────
  // Summed over the per-event player records; `matches` counts only games where
  // that stat was actually fetched, so a null (failed fetch) never reads as a 0.
  const tackles = {};
  const blocks = {};
  const gkSaves = {};
  const statAdd = (map, p, v) => {
    if (v == null) return;
    const key = `${p.n}|${p.t}`;
    const row = (map[key] ??= { name: p.n, team: p.t, value: 0, matches: 0 });
    row.value += v;
    row.matches += 1;
  };
  for (const rec of Object.values(byEvent)) {
    for (const p of rec.players ?? []) {
      statAdd(tackles, p, p.tk);
      statAdd(blocks, p, p.bk);
      if (p.gk) statAdd(gkSaves, p, p.sv);
    }
  }

  // ── Assemble payload ────────────────────────────────────────────────────────
  // Filter each pool to alive teams BEFORE topN slices to ten, so every board is
  // the true top ten among sides still in the tournament (not a truncated top ten
  // with the eliminated players simply blanked out).
  const categories = {
    scorers: topN(Object.values(mergedScorers).filter(aliveRow), flagFor),
    assists: topN(Object.values(mergedAssists).filter(aliveRow), flagFor),
    cleanSheets: topTeams(Object.values(cleanSheets).filter(aliveRow), flagFor),
    yellowCards: topN(Object.values(yellow).filter(aliveRow), flagFor),
    redCards: topN(Object.values(red).filter(aliveRow), flagFor),
    penaltyScored: topN(Object.values(penScored).filter(aliveRow), flagFor),
    penaltyMissed: topN(Object.values(penMissed).filter(aliveRow), flagFor),
    tackles: topN(Object.values(tackles).filter(aliveRow), flagFor),
    blocks: topN(Object.values(blocks).filter(aliveRow), flagFor),
    gkSaves: topN(Object.values(gkSaves).filter(aliveRow), flagFor),
  };

  // ── Per-team top-5 boards (for the match prediction "team form" panels) ─────
  // Same player tallies as the global boards above, but grouped by team and
  // capped at 5 each — so a fixture page can show each side's current top
  // scorers / assisters / bookings without a second ESPN pass. Keyed on the
  // normalised team name so the site looks it up from fixtures.home.name.
  const TEAM_TOP = 5;
  const groupByTeam = (rows) => {
    const g = {};
    for (const r of rows) {
      if (!r.name || !(r.value > 0) || !r.team) continue;
      (g[norm(r.team)] ??= { team: r.team, list: [] }).list.push(r);
    }
    return g;
  };
  const top5 = (list) =>
    list
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
      .slice(0, TEAM_TOP)
      .map((r) => ({ name: r.name, value: r.value, ...(r.matches != null ? { matches: r.matches } : {}) }));

  const catByTeam = {
    scorers: groupByTeam(Object.values(mergedScorers)),
    assists: groupByTeam(Object.values(mergedAssists)),
    yellowCards: groupByTeam(Object.values(yellow)),
    redCards: groupByTeam(Object.values(red)),
  };
  const byTeam = {};
  for (const key of new Set(Object.values(catByTeam).flatMap((c) => Object.keys(c)))) {
    const display =
      catByTeam.scorers[key]?.team ??
      catByTeam.assists[key]?.team ??
      catByTeam.yellowCards[key]?.team ??
      catByTeam.redCards[key]?.team ??
      key;
    byTeam[key] = {
      team: display,
      flag: flagFor(display),
      scorers: top5(catByTeam.scorers[key]?.list ?? []),
      assists: top5(catByTeam.assists[key]?.list ?? []),
      yellowCards: top5(catByTeam.yellowCards[key]?.list ?? []),
      redCards: top5(catByTeam.redCards[key]?.list ?? []),
    };
  }

  const teamStats = buildTeamStats(byEvent, flagFor, alive);
  const playersByTeam = buildPlayersByTeam({
    byEvent,
    mergedScorers,
    mergedAssists,
    yellow,
    red,
    penScored,
    penMissed,
    alive,
    flagFor,
  });

  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      source: "ESPN keyless FIFA World Cup feed (statistics + scoreboard + summary)",
      finished: finishedEventIds.length,
    },
    categories,
    teamStats,
    byTeam,
    playersByTeam,
    cache: { byEvent },
  };

  // Change-detection ignores the timestamp + cache (cache is plumbing, not output).
  const sig = (p) =>
    JSON.stringify({ categories: p.categories, teamStats: p.teamStats, byTeam: p.byTeam, playersByTeam: p.playersByTeam });
  let prevSig = "";
  try {
    prevSig = sig(JSON.parse(readFileSync(STATS_PATH, "utf8")));
  } catch {
    /* first run */
  }
  const changed = prevSig !== sig(payload);

  const counts = Object.entries(categories)
    .map(([k, v]) => `${k}:${v.length}`)
    .join(" ");
  console.log(`Stats: ${finishedEventIds.length} finished. ${counts}`);

  if (CHECK_ONLY) {
    console.log(changed ? "stats.json CHANGED (run without --check to write)." : "stats.json clean.");
    process.exit(changed ? 2 : 0);
  }
  writeFileSync(STATS_PATH, JSON.stringify(payload, null, 2) + "\n");
  console.log(changed ? `Wrote ${STATS_PATH}` : `No category change; rewrote ${STATS_PATH} (timestamp).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
