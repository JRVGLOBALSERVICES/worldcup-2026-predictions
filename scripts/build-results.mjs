#!/usr/bin/env node
/**
 * Deterministic results snapshotter against ESPN's keyless FIFA World Cup feed.
 *
 * The live feed (/api/live, lib/live.ts) only resolves a fixture inside a window
 * around kickoff, so once a match is hours old the page loses its final score and
 * goal log. This script persists the finished state to data/results.json so the
 * match page can render a permanent "AI call vs what happened" verdict long after
 * full time — and so a verdict survives even when ESPN's live window has moved on.
 *
 *   node scripts/build-results.mjs           # write data/results.json
 *   node scripts/build-results.mjs --check    # report only, no write (exit 2 on change)
 *
 * Reuses the exact ALIAS/normalise + home/away re-orientation rules as lib/live.ts.
 * Only FINISHED matches (and in-progress, for completeness) are written; scheduled
 * matches are skipped so a pre-match page stays purely static.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = join(__dirname, "..", "data", "fixtures.json");
const RESULTS_PATH = join(__dirname, "..", "data", "results.json");
const BETS_PATH = join(__dirname, "..", "data", "bets.json");
const ESPN_BASE =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";

const CHECK_ONLY = process.argv.includes("--check");

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

async function fetchDate(param) {
  const res = await fetch(`${ESPN_BASE}?dates=${param}`, {
    headers: { "User-Agent": "matchday-edge/1.0" },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`ESPN ${res.status} for ${param}`);
  const data = await res.json();
  return data.events ?? [];
}

const isFirstHalf = (displayValue) => {
  const base = displayValue ? parseInt(displayValue, 10) : NaN;
  return Number.isFinite(base) && base <= 45;
};

/** Convert one ESPN event to our result shape, oriented to the fixture's home/away. */
function resultFromEvent(ev, fixture) {
  const comp = ev.competitions?.[0];
  const cs = comp?.competitors ?? [];
  const espnHome = cs.find((c) => c.homeAway === "home");
  const espnAway = cs.find((c) => c.homeAway === "away");
  if (!espnHome?.team?.displayName || !espnAway?.team?.displayName) return null;

  const ourHomeIsEspnHome = norm(fixture.home.name) === norm(espnHome.team.displayName);
  const ourHome = ourHomeIsEspnHome ? espnHome : espnAway;
  const ourAway = ourHomeIsEspnHome ? espnAway : espnHome;
  const homeId = ourHome.team?.id;

  const espnState = ev.status?.type?.state ?? "pre";
  const state = espnState === "post" ? "finished" : espnState === "in" ? "live" : "scheduled";
  if (state === "scheduled") return null; // nothing to persist pre-kickoff

  const score = {
    home: parseInt(ourHome.score ?? "0", 10) || 0,
    away: parseInt(ourAway.score ?? "0", 10) || 0,
  };

  const details = (comp?.details ?? []).filter((d) => d.scoringPlay);
  const goals = details.map((d) => {
    const side = d.team?.id === homeId ? "home" : "away";
    const athletes = d.athletesInvolved ?? [];
    return {
      team: side,
      scorer: athletes[0]?.displayName ?? "Unknown",
      minute: d.clock?.value != null ? Math.round(d.clock.value / 60) : null,
      assist: athletes[1]?.displayName ?? null,
      penalty: d.penaltyKick === true,
      ownGoal: d.ownGoal === true,
    };
  });

  // Bookings ride the same details array (filtered out of `goals` by !scoringPlay).
  // redCard covers straight reds AND second-yellow dismissals — check it first.
  const cards = (comp?.details ?? [])
    .filter((d) => d.yellowCard || d.redCard)
    .map((d) => ({
      team: d.team?.id === homeId ? "home" : "away",
      player: (d.athletesInvolved ?? [])[0]?.displayName ?? "Unknown",
      minute: d.clock?.value != null ? Math.round(d.clock.value / 60) : null,
      type: d.redCard ? "red" : "yellow",
    }));

  const reachedHt = state === "finished" || (ev.status?.period ?? 0) >= 2;
  let ht = null;
  if (reachedHt) {
    ht = { home: 0, away: 0 };
    for (const d of details) {
      if (isFirstHalf(d.clock?.displayValue)) {
        const side = d.team?.id === homeId ? "home" : "away";
        ht[side] += 1;
      }
    }
  }

  return {
    state,
    ht,
    ft: state === "finished" ? score : null,
    score,
    goals,
    cards,
    updatedAt: new Date(ev.date ?? Date.now()).toISOString(),
  };
}

/**
 * Settle the bet slip (`data/bets.json`) deterministically from the same ESPN
 * results, so the tracker flips Won/Lost the moment a match is final — without
 * waiting for the hourly AI settlement cron, which can run mid-match and leave a
 * late-finishing game stuck on "Awaiting result" until its next pass.
 *
 * Strictly ADDITIVE: only fills what's empty. It never overwrites a score that's
 * already set, never downgrades a `matchEvents` entry the AI cron filled with
 * richer data (assists from BBC/Flashscore that ESPN's feed lacks), and never
 * touches per-special `statusOverride` hand-corrections. Returns true if it
 * changed anything. Mutates `bets` in place.
 */
function settleBetsFromResults(bets, results) {
  let changed = false;
  bets.results ??= {};
  bets.matchEvents ??= {};

  for (const [id, r] of Object.entries(results)) {
    if (r.state !== "finished") continue; // only settle final scores

    // Correct-score layer: fill ht/ft only where still null (a real score is a
    // fact; once set, leave it — the AI cron or a hand-fix may have refined it).
    const rec = (bets.results[id] ??= { ht: null, ft: null });
    if (rec.ft == null && r.ft) {
      rec.ft = { home: r.ft.home, away: r.ft.away };
      changed = true;
    }
    if (rec.ht == null && r.ht) {
      rec.ht = { home: r.ht.home, away: r.ht.away };
      changed = true;
    }

    // Player-prop layer: only fill when not already finished, so we never clobber
    // an AI-enriched goal list (with assists) by overwriting it with ESPN's.
    const ev = bets.matchEvents[id];
    if (!ev || ev.status !== "finished") {
      bets.matchEvents[id] = {
        status: "finished",
        goals: r.goals.map((g) => ({
          team: g.team,
          scorer: g.scorer,
          minute: g.minute,
          assist: g.assist,
          penalty: g.penalty === true,
          ownGoal: g.ownGoal === true,
        })),
        cards: (r.cards ?? []).map((c) => ({
          team: c.team,
          player: c.player,
          minute: c.minute,
          type: c.type,
        })),
      };
      changed = true;
    }
  }
  return changed;
}

async function main() {
  const fixtures = JSON.parse(readFileSync(FIXTURES_PATH, "utf8"));

  // Query each kicked-off fixture's UTC date AND the day before (ESPN US-date
  // bucketing), deduped — same insurance lib/live.ts applies.
  const dates = new Set();
  for (const f of fixtures) {
    const base = new Date(f.kickoffUTC);
    for (const off of [-1, 0]) {
      dates.add(dateParam(new Date(base.getTime() + off * 86400000)));
    }
  }

  const events = [];
  const batches = await Promise.allSettled([...dates].map(fetchDate));
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

  // Index ESPN events by both team-name orientations.
  const index = new Map();
  for (const ev of events) {
    const cs = ev.competitions?.[0]?.competitors ?? [];
    const h = cs.find((c) => c.homeAway === "home")?.team?.displayName;
    const a = cs.find((c) => c.homeAway === "away")?.team?.displayName;
    if (!h || !a) continue;
    index.set(`${norm(h)}|${norm(a)}`, ev);
    index.set(`${norm(a)}|${norm(h)}`, ev);
  }

  const results = {};
  let finished = 0;
  let live = 0;
  for (const f of fixtures) {
    const ev = index.get(`${norm(f.home.name)}|${norm(f.away.name)}`);
    if (!ev) continue;
    const r = resultFromEvent(ev, f);
    if (!r) continue;
    results[f.id] = r;
    if (r.state === "finished") finished++;
    else if (r.state === "live") live++;
  }

  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      source: "ESPN keyless FIFA World Cup scoreboard",
      finished,
      live,
    },
    results,
  };
  const next = JSON.stringify(payload, null, 2) + "\n";

  let prevResults = "";
  try {
    const prev = JSON.parse(readFileSync(RESULTS_PATH, "utf8"));
    prevResults = JSON.stringify(prev.results ?? {});
  } catch {
    /* first run */
  }
  const changed = prevResults !== JSON.stringify(results);

  // Settle the bet slip from these same results (additive — fills only gaps).
  let bets = null;
  let betsChanged = false;
  try {
    bets = JSON.parse(readFileSync(BETS_PATH, "utf8"));
    const before = JSON.stringify(bets);
    settleBetsFromResults(bets, results);
    betsChanged = JSON.stringify(bets) !== before;
  } catch {
    /* no bet slip (or unreadable) — results.json still gets written below */
  }

  console.log(`Results: ${finished} finished, ${live} live, ${Object.keys(results).length} total.`);
  if (CHECK_ONLY) {
    const any = changed || betsChanged;
    console.log(
      `${changed ? "results.json CHANGED" : "results.json clean"}; ${betsChanged ? "bets.json CHANGED" : "bets.json clean"}` +
        (any ? " (use without --check to write)." : "."),
    );
    process.exit(any ? 2 : 0);
  }
  writeFileSync(RESULTS_PATH, next);
  console.log(changed ? `Wrote ${RESULTS_PATH}` : `No change; rewrote ${RESULTS_PATH} anyway (timestamp).`);
  if (bets && betsChanged) {
    writeFileSync(BETS_PATH, JSON.stringify(bets, null, 2) + "\n");
    console.log(`Settled bet slip → wrote ${BETS_PATH}`);
  } else if (bets) {
    console.log("Bet slip already settled for all finished matches; no change.");
  }
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
