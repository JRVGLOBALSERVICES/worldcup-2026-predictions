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
 *
 * Reuses the exact ALIAS/normalise rules as lib/live.ts & build-results.mjs —
 * keep the ALIAS maps in sync.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = join(__dirname, "..", "data", "fixtures.json");
const STATS_PATH = join(__dirname, "..", "data", "stats.json");

const ESPN_BASE =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";
const ESPN_SUMMARY =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary";
const ESPN_STATS =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/statistics";

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

function buildTeamStats(byEvent, flagFor) {
  const agg = aggregateTeamBox(byEvent);
  return {
    passCompletion: pctBoard(agg, (a) => ratio(a.accuratePasses, a.totalPasses), flagFor),
    possession: pctBoard(agg, (a) => (a.possessionN > 0 ? a.possessionSum / a.possessionN : null), flagFor),
    shotAccuracy: pctBoard(agg, (a) => ratio(a.shotsOnTarget, a.totalShots), flagFor),
    tackleSuccess: pctBoard(agg, (a) => ratio(a.effectiveTackles, a.totalTackles), flagFor),
    crossCompletion: pctBoard(agg, (a) => ratio(a.accurateCrosses, a.totalCrosses), flagFor),
    longBallAccuracy: pctBoard(agg, (a) => ratio(a.accurateLongBalls, a.totalLongBalls), flagFor),
  };
}

async function main() {
  const fixtures = JSON.parse(readFileSync(FIXTURES_PATH, "utf8"));

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
  // Refetch a summary when the match is live, never cached, cached before assists
  // existed (migrated penMiss-only entry), or cached before teamBox existed — so
  // assists and the per-match team boxscore each backfill exactly once.
  const needSummary = [...new Set([...finishedEventIds, ...liveEventIds])].filter(
    (id) =>
      liveEventIds.includes(id) ||
      byEvent[id]?.assists == null ||
      byEvent[id]?.teamBox == null,
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
    byEvent[id] = { penMiss: misses, assists: assistsArr, teamBox }; // [] is a valid "checked, none"
  });
  // Drop cache entries for events no longer in our window (keeps the file tight).
  const validIds = new Set([...eventById.keys()]);
  for (const id of Object.keys(byEvent)) if (!validIds.has(id)) delete byEvent[id];

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

  // ── Assemble payload ────────────────────────────────────────────────────────
  const categories = {
    scorers: topN(Object.values(mergedScorers), flagFor),
    assists: topN(Object.values(mergedAssists), flagFor),
    cleanSheets: topTeams(Object.values(cleanSheets), flagFor),
    yellowCards: topN(Object.values(yellow), flagFor),
    redCards: topN(Object.values(red), flagFor),
    penaltyScored: topN(Object.values(penScored), flagFor),
    penaltyMissed: topN(Object.values(penMissed), flagFor),
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

  const teamStats = buildTeamStats(byEvent, flagFor);

  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      source: "ESPN keyless FIFA World Cup feed (statistics + scoreboard + summary)",
      finished: finishedEventIds.length,
    },
    categories,
    teamStats,
    byTeam,
    cache: { byEvent },
  };

  // Change-detection ignores the timestamp + cache (cache is plumbing, not output).
  const sig = (p) => JSON.stringify({ categories: p.categories, teamStats: p.teamStats, byTeam: p.byTeam });
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
