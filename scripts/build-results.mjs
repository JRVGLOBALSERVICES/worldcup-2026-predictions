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
const ESPN_SUMMARY =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary";

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

async function fetchSummary(eventId) {
  const res = await fetch(`${ESPN_SUMMARY}?event=${eventId}`, {
    headers: { "User-Agent": "matchday-edge/1.0" },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`ESPN summary ${res.status} for ${eventId}`);
  return res.json();
}

/** Pull a named stat (e.g. "wonCorners") off one boxscore team, as a number. */
function statVal(team, name) {
  const s = (team?.statistics ?? []).find((x) => x.name === name);
  const n = s ? Number(s.displayValue ?? s.value) : NaN;
  return Number.isFinite(n) ? n : 0;
}

/**
 * Verified team stats from a per-event ESPN summary, oriented to our fixture's
 * home/away. Full-match totals come from boxscore.teams[].statistics; the
 * per-half corner / shots-on-target splits are tallied from commentary[] plays
 * (each carries team.displayName + period.number). Returns null if the summary
 * has no usable boxscore yet (e.g. just kicked off).
 */
function statsFromSummary(summary, fixture) {
  const teams = summary?.boxscore?.teams;
  if (!Array.isArray(teams) || teams.length < 2) return null;
  const homeName = norm(fixture.home.name);
  const ours = (espnName) => (norm(espnName) === homeName ? "home" : "away");

  const byName = {};
  for (const t of teams) byName[ours(t.team?.displayName)] = t;
  const home = byName.home;
  const away = byName.away;
  if (!home || !away) return null;

  const corners = { home: statVal(home, "wonCorners"), away: statVal(away, "wonCorners") };
  const sot = { home: statVal(home, "shotsOnTarget"), away: statVal(away, "shotsOnTarget") };
  const shots = { home: statVal(home, "totalShots"), away: statVal(away, "totalShots") };
  const yellow = { home: statVal(home, "yellowCards"), away: statVal(away, "yellowCards") };
  const red = { home: statVal(home, "redCards"), away: statVal(away, "redCards") };
  const cards = { home: yellow.home + red.home, away: yellow.away + red.away };

  // Per-half splits from the play-by-play commentary. period.number 1 → first
  // half (index 0), anything else → second half (index 1). Group stage has no ET.
  const cornersByHalf = { home: [0, 0], away: [0, 0] };
  const sotByHalf = { home: [0, 0], away: [0, 0] };
  // Per-shooter shots-on-target — keyed by ESPN displayName, for player SOT props.
  const playerSot = {};
  for (const c of summary.commentary ?? []) {
    const p = c.play;
    const text = p?.type?.text;
    if (text !== "Corner Awarded" && text !== "Shot On Target") continue;
    const side = p.team?.displayName ? ours(p.team.displayName) : null;
    if (!side) continue;
    const idx = (p.period?.number ?? 1) === 1 ? 0 : 1;
    if (text === "Corner Awarded") {
      cornersByHalf[side][idx] += 1;
    } else {
      sotByHalf[side][idx] += 1;
      const shooter = p.participants?.[0]?.athlete?.displayName;
      if (shooter) playerSot[shooter] = (playerSot[shooter] ?? 0) + 1;
    }
  }

  const wbH1 = waterBreakAction(summary.commentary, 1);
  const wbH2 = waterBreakAction(summary.commentary, 2);

  return {
    corners, sot, shots, yellow, red, cards, cornersByHalf, sotByHalf, playerSot,
    firstGoalMethod: firstGoalMethod(summary.keyEvents),
    firstPenalty: firstPenaltyTeam(summary.keyEvents, ours),
    waterBreak: { ...(wbH1 ? { h1: wbH1 } : {}), ...(wbH2 ? { h2: wbH2 } : {}) },
  };
}

/**
 * Opta phrasing for a penalty actually TAKEN but not scored ("Penalty - Missed/
 * Saved"); scored pens carry the structured `penaltyKick` flag instead. Strict
 * `penalty - …` so it never fires on "penalty area" prose. Mirrors lib/live.ts.
 */
const PENALTY_TAKEN = /penalty\s*-\s*(missed|saved|scored)/i;

/**
 * Which side took the match's FIRST penalty kick — scored, missed, or saved —
 * from the summary keyEvents (earliest by period→clock), oriented via `ours`.
 * Mirrors lib/live.ts firstPenaltyTeam — keep in sync. null until one is taken
 * (and all match if none, in which case the "first penalty" market voids).
 */
function firstPenaltyTeam(keyEvents, ours) {
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
  return ours(name);
}

/** Break anchor in match-minutes under FIFA's 2026 rule: 22' into each half. */
const WATER_BREAK_ANCHOR = { 1: 22, 2: 67 };
const NON_ACTION_TYPES = new Set([
  "Kickoff", "Start 1st Half", "Start 2nd Half", "End 1st Half", "End 2nd Half",
  "Half Time", "End Regular Time", "Full Time", "Start Delay", "End Delay",
  "Substitution", "VAR Decision",
]);

/** Break-end second from the Start/End Delay pair near the anchor. See lib/live.ts. */
function resolveBreakEndSec(commentary, half, anchorMinute) {
  const winLo = (anchorMinute - 1) * 60;
  const winHi = (anchorMinute + 9) * 60;
  const expectedEnd = (anchorMinute + 3.5) * 60;
  const ends = (commentary ?? [])
    .map((c) => c.play)
    .filter(
      (p) =>
        !!p &&
        (p.period?.number ?? 1) === half &&
        p.type?.text === "End Delay" &&
        typeof p.clock?.value === "number" &&
        p.clock.value >= winLo &&
        p.clock.value <= winHi,
    );
  if (!ends.length) return null;
  ends.sort(
    (a, b) => Math.abs(a.clock.value - expectedEnd) - Math.abs(b.clock.value - expectedEnd),
  );
  return ends[0].clock.value ?? null;
}

/**
 * First commentary ACTION strictly after a half's hydration break.
 * Mirrors lib/live.ts waterBreakAction — keep in sync. Anchors on the actual
 * logged break end (Start/End Delay pair) when present, else the fixed 2026
 * minute. Returns null until a qualifying action past the break is logged.
 */
function waterBreakAction(commentary, half, anchorMinute = WATER_BREAK_ANCHOR[half]) {
  const breakEndSec = resolveBreakEndSec(commentary, half, anchorMinute);
  const cutoffSec = breakEndSec ?? anchorMinute * 60;
  const candidates = (commentary ?? [])
    .map((c) => c.play)
    .filter(
      (p) =>
        !!p &&
        (p.period?.number ?? 1) === half &&
        typeof p.clock?.value === "number" &&
        p.clock.value > cutoffSec &&
        !!p.type?.text &&
        !NON_ACTION_TYPES.has(p.type.text),
    )
    .sort((a, b) => (a.clock?.value ?? 0) - (b.clock?.value ?? 0));
  const first = candidates[0];
  if (!first) return null;
  const isCorner = first.type.text === "Corner Awarded";
  return {
    half,
    anchorMinute,
    source: breakEndSec !== null ? "delay" : "anchor",
    breakEndMinute: breakEndSec !== null ? Math.round(breakEndSec / 60) : null,
    firstActionType: first.type.text ?? null,
    firstActionMinute: Math.round((first.clock.value ?? 0) / 60),
    isCorner,
    reliable: !isCorner,
  };
}

/**
 * How the FIRST goal was scored, from the summary keyEvents (earliest scoring
 * play by period→clock). Mirrors lib/live.ts firstGoalMethod — keep in sync.
 * Returns null when no goal has been scored yet.
 */
function firstGoalMethod(keyEvents) {
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
  if (/direct free kick/.test(text) || (/free kick/.test(text) && !/assisted by/.test(text)))
    return "freekick";
  return "shot";
}

/**
 * Opta prose for a goal struck from beyond the box — mirror of lib/live.ts
 * SCORED_OUTSIDE_BOX, keep in sync. Lets the "score from outside the penalty
 * area" market auto-settle off the per-event summary commentary.
 */
const OUTSIDE_BOX_RE =
  /outside (the |of the )?(box|area|penalty area)|from (long range|distance)|long[- ]range (effort|strike|goal|shot)/i;

/**
 * Tag each goal that the summary keyEvents describe as scored from outside the
 * box. Matches a scoring keyEvent to a goal by scorer name + nearby minute (the
 * scoreboard `details` carry no location prose; only the summary does). Mutates
 * `goals` in place, setting `outsideBox: true` where the prose says so.
 */
function tagOutsideBox(goals, keyEvents) {
  const longRange = (keyEvents ?? [])
    .filter((e) => e.scoringPlay && e.ownGoal !== true && OUTSIDE_BOX_RE.test(e.text ?? ""))
    .map((e) => ({
      scorer: norm(e.participants?.[0]?.athlete?.displayName ?? ""),
      minute: e.clock?.value != null ? Math.round(e.clock.value / 60) : null,
    }));
  if (!longRange.length) return;
  for (const g of goals) {
    if (g.ownGoal) continue;
    const gn = norm(g.scorer ?? "");
    const hit = longRange.some(
      (lr) =>
        lr.scorer &&
        (gn === lr.scorer || gn.includes(lr.scorer) || lr.scorer.includes(gn)) &&
        (lr.minute == null || g.minute == null || Math.abs(lr.minute - g.minute) <= 2),
    );
    if (hit) g.outsideBox = true;
  }
}

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
    eventId: ev.id ?? null, // for the per-event summary (corner/SOT/card) fetch
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
  bets.matchStats ??= {};

  for (const [id, r] of Object.entries(results)) {
    // Verified stats are shared truth (corner/SOT/card combos read them). Write
    // them for live AND finished matches so an in-play page can show counts, and
    // refresh while live since the numbers climb (final values lock at FT).
    if (r.stats) {
      const before = JSON.stringify(bets.matchStats[id]);
      if (before !== JSON.stringify(r.stats)) {
        bets.matchStats[id] = r.stats;
        changed = true;
      }
    }

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
          ...(g.outsideBox === true ? { outsideBox: true } : {}),
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

  // ── Verified stats pass (corners / shots-on-target / cards) ────────────────
  // The scoreboard above carries goals + cards only; the corner/SOT/card COUNTS
  // a build-a-bet needs live in each match's `summary` endpoint. Fetch it for
  // every live or finished match — but reuse an already-final snapshot from the
  // previous results.json so the hourly cron only hits summaries for the day's
  // active games, not all 104 finished matches by tournament's end.
  let prevStats = {};
  try {
    const prev = JSON.parse(readFileSync(RESULTS_PATH, "utf8"));
    for (const [id, r] of Object.entries(prev.results ?? {})) {
      if (r.state === "finished" && r.stats) prevStats[id] = r.stats;
    }
  } catch {
    /* first run — no prior stats */
  }
  const fixById = Object.fromEntries(fixtures.map((f) => [f.id, f]));
  const needStats = Object.entries(results).filter(
    ([id, r]) => r.eventId && !(r.state === "finished" && prevStats[id]),
  );
  const fetchedStats = await Promise.allSettled(
    needStats.map(([, r]) => fetchSummary(r.eventId)),
  );
  let statsCount = 0;
  needStats.forEach(([id, r], i) => {
    const b = fetchedStats[i];
    if (b.status !== "fulfilled") return;
    const s = statsFromSummary(b.value, fixById[id]);
    if (s) {
      r.stats = s;
      statsCount++;
    }
    // Tag long-range goals from the same summary, so the "score from outside the
    // box" market settles off real commentary (scoreboard details carry no location).
    if (Array.isArray(r.goals)) tagOutsideBox(r.goals, b.value?.keyEvents);
  });
  // Carry forward reused final snapshots for matches we deliberately didn't refetch.
  for (const [id, r] of Object.entries(results)) {
    if (!r.stats && prevStats[id]) r.stats = prevStats[id];
  }
  // eventId was only needed for the summary fetch — drop it from the persisted shape.
  for (const r of Object.values(results)) delete r.eventId;

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
