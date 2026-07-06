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
  const fouls = { home: statVal(home, "foulsCommitted"), away: statVal(away, "foulsCommitted") };

  // Per-half splits from the play-by-play commentary. period.number 1 → first
  // half (index 0), period 2 → second half (index 1); ET periods (≥ 3) are
  // skipped — the per-half markets settle on regulation 90 only.
  const cornersByHalf = { home: [0, 0], away: [0, 0] };
  const sotByHalf = { home: [0, 0], away: [0, 0] };
  // Per-shooter shots-on-target — keyed by ESPN displayName, for player SOT props.
  const playerSot = {};
  // Per-shooter TOTAL shots — any shot attempt ("Shot On Target/Off Target/
  // Blocked/Hit Woodwork") or a goal (own goals excluded — not a shot for the
  // "scorer"). Matches the boxscore totalShots team stat; feeds playerShotsOver.
  const playerShots = {};
  const isShotPlay = (t) =>
    t.startsWith("Shot") || (t.startsWith("Goal") && !t.includes("Own")) || t === "Penalty - Scored";
  for (const c of summary.commentary ?? []) {
    const p = c.play;
    const text = p?.type?.text;
    if (text && isShotPlay(text)) {
      const taker = p.participants?.[0]?.athlete?.displayName;
      if (taker) playerShots[taker] = (playerShots[taker] ?? 0) + 1;
    }
    if (text !== "Corner Awarded" && text !== "Shot On Target") continue;
    const side = p.team?.displayName ? ours(p.team.displayName) : null;
    if (!side) continue;
    // ET plays (period ≥ 3) stay OUT of the per-half buckets — half markets
    // and the FT corner-count 1X2 are regulation-90 (book rule). Per-player
    // tallies keep the whole match (they mirror the boxscore team totals).
    const period = p.period?.number ?? 1;
    const idx = period === 1 ? 0 : 1;
    if (text === "Corner Awarded") {
      if (period <= 2) cornersByHalf[side][idx] += 1;
    } else {
      if (period <= 2) sotByHalf[side][idx] += 1;
      const shooter = p.participants?.[0]?.athlete?.displayName;
      if (shooter) playerSot[shooter] = (playerSot[shooter] ?? 0) + 1;
    }
  }

  const wbH1 = waterBreakAction(summary.commentary, 1);
  const wbH2 = waterBreakAction(summary.commentary, 2);

  return {
    corners, sot, shots, yellow, red, cards, fouls, cornersByHalf, sotByHalf, playerSot, playerShots,
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

/**
 * Opta prose naming the assister ("… Assisted by Achraf Hakimi following a set
 * piece situation."). The scoreboard `details` athletesInvolved carry the scorer
 * only — across 207 settled goals not one had athletesInvolved[1] — so the
 * assist has to come from the summary keyEvents: participants[1] when present,
 * else parsed from the text. Mirror of lib/live.ts goalsFromKeyEvents.
 */
const ASSISTED_BY_RE = /Assisted by\s+(.+?)(?=\s+(?:with|following|after)\b|[.,]|$)/;

/**
 * Fill each goal's `assist` from the summary keyEvents, matched by scorer name
 * + nearby minute (same pairing rule as tagOutsideBox). Mutates `goals` in
 * place; never overwrites an assist already set, never touches own goals —
 * feeds scoredOrAssisted / assisted / goalsAssistsOver settlement.
 */
function enrichAssists(goals, keyEvents) {
  const rich = (keyEvents ?? [])
    .filter((e) => e.scoringPlay && e.ownGoal !== true)
    .map((e) => ({
      scorer: norm(e.participants?.[0]?.athlete?.displayName ?? ""),
      minute: e.clock?.value != null ? Math.round(e.clock.value / 60) : null,
      assist:
        e.participants?.[1]?.athlete?.displayName ??
        ASSISTED_BY_RE.exec(e.text ?? "")?.[1]?.trim() ??
        null,
    }))
    .filter((r) => r.assist);
  if (!rich.length) return;
  for (const g of goals) {
    if (g.ownGoal || g.assist) continue;
    const gn = norm(g.scorer ?? "");
    const hit = rich.find(
      (r) =>
        r.scorer &&
        (gn === r.scorer || gn.includes(r.scorer) || r.scorer.includes(gn)) &&
        (r.minute == null || g.minute == null || Math.abs(r.minute - g.minute) <= 2),
    );
    if (hit) g.assist = hit.assist;
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

  // Match-end phase, cross-checked against ESPN's AUTHORITATIVE status.type — a
  // knockout decided in extra time or a shootout carries a different status name
  // (and id) than a regulation finish, and lists its shootout kicks as 120' goals:
  //   STATUS_FINAL_PEN (id 47, "FT-Pens") → penalties
  //   STATUS_FINAL_AET (id 45, "AET")     → extra_time
  //   STATUS_FULL_TIME (id 28, "FT")      → regulation
  // `period` is the backup signal (5 = shootout, 3|4 = ET halves, ≤2 = regulation).
  const typeName = ev.status?.type?.name ?? "";
  const period = ev.status?.period ?? 0;
  let finishPhase = null;
  if (state === "finished") {
    if (typeName === "STATUS_FINAL_PEN" || period === 5) finishPhase = "penalties";
    else if (typeName === "STATUS_FINAL_AET" || period === 3 || period === 4)
      finishPhase = "extra_time";
    else finishPhase = "regulation";
  }
  const wentToEt = finishPhase === "extra_time" || finishPhase === "penalties";

  const score = {
    home: parseInt(ourHome.score ?? "0", 10) || 0,
    away: parseInt(ourAway.score ?? "0", 10) || 0,
  };

  // Drop shootout kicks: ESPN lists every penalty in a shootout as a 120' scoring
  // play flagged `shootout:true`. They are NOT goals — counting them would credit
  // each taker with a goal and wreck first/anytime-scorer + total-goals markets.
  // (The aggregate `score` already excludes them — it stays the post-ET scoreline.)
  const details = (comp?.details ?? []).filter((d) => d.scoringPlay && d.shootout !== true);
  const goals = details.map((d) => {
    const side = d.team?.id === homeId ? "home" : "away";
    const athletes = d.athletesInvolved ?? [];
    const minute = d.clock?.value != null ? Math.round(d.clock.value / 60) : null;
    return {
      team: side,
      scorer: athletes[0]?.displayName ?? "Unknown",
      minute,
      assist: athletes[1]?.displayName ?? null,
      penalty: d.penaltyKick === true,
      ownGoal: d.ownGoal === true,
      // Real goal struck in extra time (minute > 90 in an ET/pens match). Tagged so
      // 90-minute markets (1X2, correct score, first/anytime scorer, totals) can
      // exclude it; only "to qualify" counts goals beyond 90. Regulation/group
      // games never set this (no ET played).
      ...(wentToEt && minute != null && minute > 90 ? { et: true } : {}),
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

  // Knockout advancement — which side PROGRESSED, by any route (90-min win, ET, or
  // shootout). ESPN sets `advance:true` on the progressing competitor for most
  // ties, but on some finals it leaves `advance` undefined and only sets
  // `winner:true` (verified on the 2022 final payload) — so accept either. Absent
  // on an undecided/level game → null. Settles "to qualify" independently of 1X2.
  const advanced =
    state === "finished"
      ? ourHome.advance === true || ourHome.winner === true
        ? "home"
        : ourAway.advance === true || ourAway.winner === true
          ? "away"
          : null
      : null;

  // 90-minute scoreline: the shootout-free ESPN aggregate MINUS any extra-time
  // goal. For a regulation/group game this equals `ft`. Every 90-minute market
  // settles on this; full `ft` (incl. ET) + `advanced` cover the qualify markets.
  let ft90 = null;
  if (state === "finished") {
    const etHome = goals.filter((g) => g.et && g.team === "home").length;
    const etAway = goals.filter((g) => g.et && g.team === "away").length;
    ft90 = { home: Math.max(0, score.home - etHome), away: Math.max(0, score.away - etAway) };
  }

  return {
    state,
    ht,
    ft: state === "finished" ? score : null,
    ft90,
    finishPhase,
    score,
    advanced,
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
    // 90-minute scoreline + the ESPN-verified finish phase (regulation/ET/pens),
    // so every 90-minute market settles on ft90 while qualify reads `advanced`.
    if (rec.ft90 == null && r.ft90) {
      rec.ft90 = { home: r.ft90.home, away: r.ft90.away };
      changed = true;
    }
    if (rec.finishPhase == null && r.finishPhase) {
      rec.finishPhase = r.finishPhase;
      changed = true;
    }
    if (rec.ht == null && r.ht) {
      rec.ht = { home: r.ht.home, away: r.ht.away };
      changed = true;
    }
    // Advancement layer — fill once ESPN flags the side that progressed (incl.
    // ET/pens). Lets "to qualify" legs settle even when the 90-min score was a
    // draw. Additive: never overwrite a value already set.
    if (rec.advanced == null && r.advanced) {
      rec.advanced = r.advanced;
      changed = true;
    }

    // Player-prop layer: only fill when not already finished, so we never clobber
    // an AI-enriched goal list (with assists) by overwriting it with ESPN's.
    const ev = bets.matchEvents[id];
    if (ev && ev.status === "finished" && Array.isArray(ev.goals)) {
      // Additive assist backfill: if the entry locked on a run where the summary
      // fetch failed (assists null), layer them in from this run's enriched goals
      // — matched by team + scorer + nearby minute, never overwriting a set value.
      for (const g of ev.goals) {
        if (g.assist || g.ownGoal) continue;
        const src = r.goals.find(
          (x) =>
            x.assist &&
            x.team === g.team &&
            norm(x.scorer ?? "") === norm(g.scorer ?? "") &&
            (x.minute == null || g.minute == null || Math.abs(x.minute - g.minute) <= 2),
        );
        if (src) {
          g.assist = src.assist;
          changed = true;
        }
      }
    }
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
          ...(g.et === true ? { et: true } : {}),
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
  // Prior finished records whose summary was successfully fetched at least once
  // (assistsChecked) — their goal enrichment (assist / outsideBox) is carried
  // forward instead of refetched. Goals are rebuilt from the scoreboard every
  // run (scoreboard carries NO assists), so without this carry-forward an
  // enriched assist survives exactly one run before being wiped.
  let prevChecked = {};
  try {
    const prev = JSON.parse(readFileSync(RESULTS_PATH, "utf8"));
    for (const [id, r] of Object.entries(prev.results ?? {})) {
      if (r.state === "finished" && r.stats) prevStats[id] = r.stats;
      if (r.state === "finished" && r.assistsChecked === true) prevChecked[id] = r.goals ?? [];
    }
  } catch {
    /* first run — no prior stats */
  }
  const fixById = Object.fromEntries(fixtures.map((f) => [f.id, f]));
  // Refetch a finished match's summary until BOTH its stats snapshot exists AND
  // its goals have been assist-checked once. Matches finished before the
  // assistsChecked flag existed lack it → one-time backfill fetch, then locked.
  const needStats = Object.entries(results).filter(
    ([id, r]) => r.eventId && !(r.state === "finished" && prevStats[id] && prevChecked[id]),
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
    // Tag long-range goals + fill assists from the same summary — the scoreboard
    // details carry neither location prose nor the assister; only keyEvents do.
    if (Array.isArray(r.goals)) {
      tagOutsideBox(r.goals, b.value?.keyEvents);
      enrichAssists(r.goals, b.value?.keyEvents);
    }
    // Mark finished matches as assist-checked so the hourly cron stops
    // refetching them. A failed fetch leaves the flag off → retried next run.
    if (r.state === "finished" && Array.isArray(b.value?.keyEvents)) {
      r.assistsChecked = true;
    }
  });
  // Carry forward reused final snapshots for matches we deliberately didn't refetch.
  for (const [id, r] of Object.entries(results)) {
    if (!r.stats && prevStats[id]) r.stats = prevStats[id];
    // Re-apply prior enrichment onto the freshly rebuilt (assist-less) goals.
    const prevGoals = prevChecked[id];
    if (r.state === "finished" && !r.assistsChecked && prevGoals) {
      for (const g of r.goals ?? []) {
        const src = prevGoals.find(
          (x) =>
            x.team === g.team &&
            norm(x.scorer ?? "") === norm(g.scorer ?? "") &&
            (x.minute == null || g.minute == null || Math.abs(x.minute - g.minute) <= 2),
        );
        if (src) {
          if (src.assist && !g.assist && !g.ownGoal) g.assist = src.assist;
          if (src.outsideBox === true) g.outsideBox = true;
        }
      }
      r.assistsChecked = true;
    }
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

// Export the pure transform so it can be unit-tested against captured ESPN
// payloads; only run the side-effecting main() when invoked as a script.
export { resultFromEvent };

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e?.message ?? e);
    process.exit(1);
  });
}
