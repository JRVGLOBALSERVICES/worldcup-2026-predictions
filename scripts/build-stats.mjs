#!/usr/bin/env node
/**
 * Tournament stat leaderboards (Golden Boot race + discipline + penalties),
 * snapshotted from ESPN's keyless FIFA World Cup feeds into data/stats.json so
 * the /stats page can render seven top-10 tables without a live fetch.
 *
 *   node scripts/build-stats.mjs            # write data/stats.json
 *   node scripts/build-stats.mjs --check     # report only, no write (exit 2 on change)
 *
 * Seven categories, two sources:
 *   • scorers, assists      → ESPN season `/statistics` leaders (resolved names,
 *                             tournament-wide aggregation, with appearances).
 *   • cleanSheets, yellow,
 *     red, penaltyScored     → aggregated from the per-date scoreboard events'
 *                             `competitions[].details` (goals + cards), the same
 *                             array build-results.mjs reads — no extra fetch.
 *   • penaltyMissed          → per-match summary `keyEvents` (a "Penalty - Saved"
 *                             / "Penalty - Missed" play is never in `details`).
 *                             Cached per finished event so the cron only hits a
 *                             summary once per match, not all of them hourly.
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

  // ── Pass 1: scoreboard details → cards, penalties scored, clean sheets ──────
  const yellow = {};
  const red = {};
  const penScored = {};
  const cleanSheets = {}; // team(norm) → { team, value }
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

  // ── Pass 3: penalty MISSED from summary keyEvents (cached per event) ─────────
  // Reuse cached per-event misses for events already final in the prior run; only
  // hit summaries for events not yet cached (newly finished / still live today).
  let cache = {};
  try {
    cache = JSON.parse(readFileSync(STATS_PATH, "utf8")).cache?.penMissByEvent ?? {};
  } catch {
    /* first run */
  }
  const liveEventIds = [...eventById.values()]
    .filter((ev) => (ev.status?.type?.state ?? "pre") === "in")
    .map((ev) => ev.id);
  const needSummary = [...new Set([...finishedEventIds, ...liveEventIds])].filter(
    (id) => liveEventIds.includes(id) || cache[id] == null,
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
    for (const e of b.value?.keyEvents ?? []) {
      if (!PEN_MISS.test(e.type?.text ?? "")) continue;
      const p = (e.participants ?? [])[0]?.athlete?.displayName;
      const team = teamName[e.team?.id] ?? teamName[e.team?.displayName] ?? "";
      if (p) misses.push({ name: p, team });
    }
    cache[id] = misses; // [] is a valid "checked, none" answer
  });
  // Drop cache entries for events no longer in our window (keeps the file tight).
  const validIds = new Set([...eventById.keys()]);
  for (const id of Object.keys(cache)) if (!validIds.has(id)) delete cache[id];

  const penMissed = {};
  for (const misses of Object.values(cache)) {
    for (const m of misses) tallyAdd(penMissed, m.name, m.team);
  }

  // ── Assemble payload ────────────────────────────────────────────────────────
  const categories = {
    scorers: topN(Object.values(scorers), flagFor),
    assists: topN(Object.values(assists), flagFor),
    cleanSheets: topTeams(Object.values(cleanSheets), flagFor),
    yellowCards: topN(Object.values(yellow), flagFor),
    redCards: topN(Object.values(red), flagFor),
    penaltyScored: topN(Object.values(penScored), flagFor),
    penaltyMissed: topN(Object.values(penMissed), flagFor),
  };

  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      source: "ESPN keyless FIFA World Cup feed (statistics + scoreboard + summary)",
      finished: finishedEventIds.length,
    },
    categories,
    cache: { penMissByEvent: cache },
  };

  // Change-detection ignores the timestamp + cache (cache is plumbing, not output).
  const sig = (p) => JSON.stringify(p.categories);
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
