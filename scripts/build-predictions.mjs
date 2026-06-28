#!/usr/bin/env node
/**
 * Data-driven match-prediction engine for the upcoming (not-yet-finished)
 * fixtures. Replaces the hand-written, per-match research for live calls with a
 * reproducible model fed by everything the tournament already gave us:
 *
 *   • data/standings.json  → each team's group GF / GA / points / form (3 games)
 *   • data/results.json    → real finished scorelines (league goal baseline)
 *   • data/stats.json      → who actually scored / assisted (byTeam) → scorer odds
 *   • data/research.json   → recent W-D-L form line (extra recency signal)
 *
 * THE MODEL (bivariate Poisson, the standard for football scorelines):
 *   1. League baseline μ  = mean goals-for-per-game across all 48 teams.
 *   2. Attack  A_t        = shrunk (GF/g) / μ      (Bayesian shrink, prior = μ)
 *      Defence D_t        = shrunk (GA/g) / μ
 *      both nudged ±15% by a form/quality factor (points-per-game + recent W-D-L).
 *   3. Expected goals      λ_home = μ·A_home·D_away·HFA ,  λ_away = μ·A_away·D_home/HFA
 *   4. Poisson score grid  P(i,j)=pois(i,λh)·pois(j,λa) over 0..7 →
 *        win/draw/loss probs, most-likely full-time score, fair odds = 1/p.
 *   5. Half-time           same grid on λ·HT_SHARE (≈44% of goals fall in H1).
 *   6. Scorers / assists   λ_player = λ_team · (player goals / team goals) →
 *        anytime prob = 1−e^(−λ_player). Top man = banker.
 *   7. Strength / confidence derived from the favourite's win probability.
 *
 * Usage:
 *   node scripts/build-predictions.mjs            # write data/predictions.json
 *   node scripts/build-predictions.mjs --check    # report only (exit 2 on change)
 *   node scripts/build-predictions.mjs --backtest # score the model on finished games
 *
 * Strictly additive: finished matches keep their existing (researched) predictions;
 * a not-finished match whose prediction already has CONFIRMED lineups (near-kickoff
 * hand research) is also left untouched. Everything else gets a fresh model call.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "..", "data");
const P = (f) => join(DATA, f);

const CHECK_ONLY = process.argv.includes("--check");
const BACKTEST = process.argv.includes("--backtest");

// ── name normalisation (mirror of build-lineups.mjs / lib/live.ts) ──────────
const ALIAS = {
  congodr: "drcongo", drc: "drcongo", korearepublic: "southkorea",
  iranislamicrepublic: "iran", iriran: "iran", turkiye: "turkey", trkiye: "turkey",
  unitedstates: "usa", unitedstatesofamerica: "usa", czechia: "czechrepublic",
  capeverde: "caboverde", cotedivoire: "ivorycoast", bosniaherzegovina: "bosnia",
  curaao: "curacao",
};
const norm = (s) => {
  const a = String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");
  return ALIAS[a] ?? a;
};

// ── tuning constants ────────────────────────────────────────────────────────
const SHRINK = 2.0;     // prior strength: pretend each team also played 2 league-average games
const HT_SHARE = 0.44;  // share of goals scored in the first half (FIFA long-run ≈ 44%)
const HFA = 1.06;       // mild edge for the nominal "home" side (neutral WC venues)
const FORM_TILT = 0.15; // max ± attack/defence nudge from form+quality
const MAXG = 7;         // Poisson grid ceiling

// ── Poisson helpers ─────────────────────────────────────────────────────────
function factorial(n) { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }
function pois(k, lambda) { return (Math.exp(-lambda) * lambda ** k) / factorial(k); }
function odds(p) { return p > 0 ? (1 / p).toFixed(2) : "99.0"; }

/** Full 0..MAXG score grid + derived win/draw/loss + most-likely score. */
function scoreGrid(lh, la) {
  const grid = [];
  let pHome = 0, pDraw = 0, pAway = 0, best = { p: -1, h: 0, a: 0 };
  for (let h = 0; h <= MAXG; h++) {
    for (let a = 0; a <= MAXG; a++) {
      const p = pois(h, lh) * pois(a, la);
      grid.push({ h, a, p });
      if (h > a) pHome += p; else if (h === a) pDraw += p; else pAway += p;
      if (p > best.p) best = { p, h, a };
    }
  }
  return { pHome, pDraw, pAway, best };
}

// ── load data ───────────────────────────────────────────────────────────────
const fixturesRaw = JSON.parse(readFileSync(P("fixtures.json"), "utf8"));
const fixtures = Object.values(fixturesRaw).flat().filter((x) => x && x.id);
const standings = JSON.parse(readFileSync(P("standings.json"), "utf8"));
const resultsFile = JSON.parse(readFileSync(P("results.json"), "utf8"));
const results = resultsFile.results ?? {};
const statsFile = JSON.parse(readFileSync(P("stats.json"), "utf8"));
const byTeam = statsFile.byTeam ?? {};
const researchFile = JSON.parse(readFileSync(P("research.json"), "utf8"));
const research = researchFile.research ?? {};
const predFile = JSON.parse(readFileSync(P("predictions.json"), "utf8"));
const predictions = predFile.predictions ?? {};

// ── team table: GF/GA/pts/form keyed by normalised name ─────────────────────
const teamRows = {};
for (const g of standings.groups ?? []) {
  for (const r of g.rows ?? []) teamRows[norm(r.name)] = r;
}
// stats byTeam keyed by normalised team name
const teamStats = {};
for (const [k, v] of Object.entries(byTeam)) teamStats[norm(k)] = v;

// league baseline μ + average points-per-game (for the quality nudge)
const allRows = Object.values(teamRows).filter((r) => r.played > 0);
const MU = allRows.reduce((s, r) => s + r.goalsFor / r.played, 0) / allRows.length;
const PPG_AVG = allRows.reduce((s, r) => s + r.points / r.played, 0) / allRows.length;

/** Recent-form score 0..1 from a "WDLWW…" line (newest-first, recency-weighted). */
function formScore(line) {
  if (!line) return 0.5;
  let num = 0, den = 0;
  const chars = [...line].slice(0, 6); // last 6 results
  chars.forEach((c, i) => {
    const w = Math.pow(0.85, i);       // newer games weigh more
    den += w;
    num += w * (c === "W" ? 1 : c === "D" ? 0.5 : 0);
  });
  return den ? num / den : 0.5;
}

/**
 * League-average ratings for a team we have no group data on yet (e.g. a future
 * knockout fixture whose teams haven't been keyed into standings). Returns a
 * neutral, perfectly-average side so buildPrediction NEVER fails — every fixture
 * with a bet on it always gets a tracked prediction, even on a thin data day.
 */
function baselineRatings() {
  return { row: null, attack: 1, defence: 1, gfg: MU, gag: MU, ppg: PPG_AVG, fs: 0.5, baseline: true };
}

/** Per-team attack/defence ratings with Bayesian shrink + form/quality tilt. */
function ratings(name) {
  const r = teamRows[norm(name)];
  if (!r || !r.played) return baselineRatings();
  const gfg = (r.goalsFor + MU * SHRINK) / (r.played + SHRINK);
  const gag = (r.goalsAgainst + MU * SHRINK) / (r.played + SHRINK);
  // quality: blend points-per-game (vs field) and recent form line from research
  const ppg = r.points / r.played;
  const formLine = r.form ? [...r.form].reverse().join("") : ""; // standings form is oldest-first
  const fs = formScore(formLine);
  const quality = 0.5 * ((ppg - PPG_AVG) / Math.max(PPG_AVG, 0.5)) + 0.5 * (fs - 0.5) * 2;
  const tilt = Math.max(-1, Math.min(1, quality)); // clamp
  return {
    row: r,
    attack: (gfg / MU) * (1 + FORM_TILT * tilt),
    defence: (gag / MU) * (1 - FORM_TILT * tilt),
    gfg, gag, ppg, fs,
  };
}

// A 2-3 game sample makes a hot striker look like a 95% lock. Regress each
// player's goal/assist share toward a prior and cap the anytime probability at a
// realistic ceiling (even the best WC strikers sit ~55-65% anytime).
const SHARE_PRIOR = 2.0;   // ghost goals/assists added to the team pool
const SCORER_CAP = 0.66;
const ASSIST_CAP = 0.58;

/** Top anytime scorers for a team given its expected goals λ. */
function scorerPicks(name, lambda, team, limit = 4) {
  const st = teamStats[norm(name)];
  if (!st || !st.scorers || !st.scorers.length) return [];
  const totalGoals = st.scorers.reduce((s, p) => s + p.value, 0);
  return st.scorers
    .map((p) => {
      const share = (p.value + 0.5) / (totalGoals + SHARE_PRIOR); // regressed share
      const lamP = lambda * share;                                // player xG this match
      const prob = Math.min(SCORER_CAP, 1 - Math.exp(-lamP));
      return { player: p.name, prob, goals: p.value, matches: p.matches, team };
    })
    .sort((a, b) => b.prob - a.prob)
    .slice(0, limit)
    .map((p) => ({
      player: p.player,
      team: p.team,
      fairOdds: odds(p.prob),
      banker: false,
      note: `${p.goals} goal${p.goals === 1 ? "" : "s"} in ${p.matches} group game${p.matches === 1 ? "" : "s"}; ${(p.prob * 100).toFixed(0)}% modelled anytime chance on ${lambda.toFixed(1)} team xG.`,
      strength: strengthFromProb(p.prob, true),
    }));
}

/** Assists scale with the team's expected goals — no team goal, no assist. */
function assistPicks(name, lambda, team, limit = 3) {
  const st = teamStats[norm(name)];
  if (!st || !st.assists || !st.assists.length) return [];
  const totalAssists = st.assists.reduce((s, p) => s + p.value, 0);
  return st.assists
    .map((p) => {
      const share = (p.value + 0.4) / (totalAssists + SHARE_PRIOR);
      const prob = Math.min(ASSIST_CAP, 1 - Math.exp(-lambda * share));
      return { player: p.name, prob, value: p.value, team };
    })
    .sort((a, b) => b.prob - a.prob)
    .slice(0, limit)
    .map((p) => ({
      player: p.player,
      team: p.team,
      fairOdds: odds(p.prob),
      banker: false,
      note: `${p.value} assist${p.value === 1 ? "" : "s"} in the group stage; ${(p.prob * 100).toFixed(0)}% modelled chance to set one up.`,
    }));
}

function strengthFromProb(p, scorer = false) {
  if (scorer) { // anytime-scorer scale is lower
    if (p >= 0.55) return 5; if (p >= 0.45) return 4; if (p >= 0.35) return 3; if (p >= 0.25) return 2; return 1;
  }
  if (p >= 0.60) return 5; if (p >= 0.50) return 4; if (p >= 0.42) return 3; if (p >= 0.36) return 2; return 1;
}
// Rj's standing call: every pick reads "medium" — never high/low (see commit
// 1a4946e). The granular conviction the model computes is surfaced through the
// 1–5 strength meter instead, so confidence stays a flat, honest "medium".
// eslint-disable-next-line no-unused-vars
function confidenceFromProb(p) { return "medium"; }

/** Reuse a team's most recent confirmed/probable XI from earlier predictions. */
function lastKnownXI(name) {
  const want = norm(name);
  // newest finished fixture first
  const fins = fixtures
    .filter((f) => results[f.id]?.state === "finished" && predictions[f.id])
    .sort((a, b) => (b.kickoffUTC || "").localeCompare(a.kickoffUTC || ""));
  for (const f of fins) {
    const p = predictions[f.id];
    if (norm(f.home.name) === want && p.lineups?.homeXI) return { str: p.lineups.home, xi: p.lineups.homeXI };
    if (norm(f.away.name) === want && p.lineups?.awayXI) return { str: p.lineups.away, xi: p.lineups.awayXI };
  }
  return null;
}

// ── build one prediction from the model ─────────────────────────────────────
function buildPrediction(f) {
  const rh = ratings(f.home.name);
  const ra = ratings(f.away.name);
  if (!rh || !ra) return null; // defensive only — ratings() now falls back to a league-average side

  const lh = MU * rh.attack * ra.defence * HFA;
  const la = MU * ra.attack * rh.defence / HFA;
  const ft = scoreGrid(lh, la);
  const ht = scoreGrid(lh * HT_SHARE, la * HT_SHARE);

  // headline result
  const probs = [
    { pick: f.home.name, p: ft.pHome },
    { pick: "Draw", p: ft.pDraw },
    { pick: f.away.name, p: ft.pAway },
  ].sort((a, b) => b.p - a.p);
  const fav = probs[0];

  // HT/FT pick
  const htLeader = ht.best.h > ht.best.a ? f.home.name : ht.best.h < ht.best.a ? f.away.name : "Draw";
  const ftLeader = fav.pick;
  const htft = `${htLeader === "Draw" ? "Draw" : htLeader}/${ftLeader === "Draw" ? "Draw" : ftLeader}`;

  // scorers/assists for both teams, merged + ranked
  const scorers = [...scorerPicks(f.home.name, lh, f.home.name), ...scorerPicks(f.away.name, la, f.away.name)]
    .sort((a, b) => Number(a.fairOdds) - Number(b.fairOdds)).slice(0, 5);
  if (scorers.length) scorers.forEach((s, i) => (s.banker = i === 0));
  const assists = [...assistPicks(f.home.name, lh, f.home.name), ...assistPicks(f.away.name, la, f.away.name)]
    .sort((a, b) => Number(a.fairOdds) - Number(b.fairOdds)).slice(0, 4);
  if (assists.length) assists.forEach((s, i) => (s.banker = i === 0));

  // penalty: tighter game ⇒ likelier to matter; taker = fav's top scorer
  const tight = Math.abs(ft.pHome - ft.pAway) < 0.18;
  const favStats = teamStats[norm(fav.pick === "Draw" ? f.home.name : fav.pick)];
  const taker = favStats?.scorers?.[0]?.name ?? scorers[0]?.player ?? "TBC";
  const backup = favStats?.scorers?.[1]?.name ?? scorers[1]?.player ?? "TBC";

  // probable lineups from each side's last known XI
  const homeXI = lastKnownXI(f.home.name);
  const awayXI = lastKnownXI(f.away.name);

  const reason =
    `Model: ${fav.pick === "Draw" ? "a draw" : fav.pick + " to win"} at ${(fav.p * 100).toFixed(0)}% ` +
    `(${f.home.name} ${(ft.pHome * 100).toFixed(0)}% / draw ${(ft.pDraw * 100).toFixed(0)}% / ${f.away.name} ${(ft.pAway * 100).toFixed(0)}%). ` +
    `Expected goals ${lh.toFixed(1)}–${la.toFixed(1)} from group-stage attack/defence rates ` +
    `(${f.home.name} ${rh.gfg.toFixed(1)} for / ${rh.gag.toFixed(1)} against per game, ${f.away.name} ${ra.gfg.toFixed(1)} / ${ra.gag.toFixed(1)}). ` +
    `Most likely score ${ft.best.h}-${ft.best.a}.`;

  return {
    win: { pick: fav.pick, fairOdds: odds(fav.p), reason, strength: strengthFromProb(fav.p) },
    halfTime: {
      score: `${ht.best.h}-${ht.best.a}`,
      fairOdds: odds(ht.best.p),
      alt: htLeader === "Draw" ? `${ht.best.h + 1}-${ht.best.a}` : "0-0",
      altOdds: odds(Math.max(ht.pDraw, 0.2) * 0.5),
    },
    htft: { pick: htft, fairOdds: odds(fav.p * (htLeader === ftLeader ? 0.8 : 0.4)) },
    fullTime: { score: `${ft.best.h}-${ft.best.a}`, fairOdds: odds(ft.best.p) },
    scorers,
    assists,
    penalty: {
      likelihood: tight ? "medium" : "low",
      taker, backup,
      note: tight
        ? `Tight model margin (${(Math.abs(ft.pHome - ft.pAway) * 100).toFixed(0)} pts) raises the odds a spot-kick decides it; ${taker} is ${fav.pick}'s group-stage top scorer and likely taker.`
        : `${fav.pick} favoured to control the game, so a penalty is less pivotal; ${taker} would take one if awarded.`,
    },
    lineups: {
      home: homeXI?.str ?? "",
      away: awayXI?.str ?? "",
      status: "unconfirmed",
      ...(homeXI?.xi ? { homeXI: homeXI.xi } : {}),
      ...(awayXI?.xi ? { awayXI: awayXI.xi } : {}),
    },
    playerNotes: [...scorers.slice(0, 2), ...assists.slice(0, 1)].map((p) => ({
      player: p.player,
      team: p.team ?? "",
      note: p.note,
    })),
    confidence: confidenceFromProb(fav.p),
    strength: strengthFromProb(fav.p),
    sources: [
      "Model: bivariate-Poisson xG from ESPN group-stage GF/GA + recency-weighted form",
      "Scorer odds: ESPN per-team goal data (data/stats.json)",
      "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/standings",
    ],
  };
}

// ── backtest: score the model against finished matches ──────────────────────
if (BACKTEST) {
  let n = 0, resultHit = 0, scoreHit = 0;
  for (const f of fixtures) {
    const res = results[f.id];
    if (res?.state !== "finished" || !res.ft) continue;
    const pred = buildPrediction(f);
    if (!pred) continue;
    n++;
    const [ph, pa] = pred.fullTime.score.split("-").map(Number);
    const actualWinner = res.ft.home > res.ft.away ? f.home.name : res.ft.home < res.ft.away ? f.away.name : "Draw";
    const predWinner = pred.win.pick;
    if (actualWinner === predWinner) resultHit++;
    if (ph === res.ft.home && pa === res.ft.away) scoreHit++;
  }
  console.log(`Backtest on ${n} finished matches:`);
  console.log(`  Result (1X2) correct : ${resultHit}/${n} = ${((resultHit / n) * 100).toFixed(1)}%  (coin-toss baseline ≈ 33%)`);
  console.log(`  Exact scoreline      : ${scoreHit}/${n} = ${((scoreHit / n) * 100).toFixed(1)}%  (typical model ≈ 8-12%)`);
  process.exit(0);
}

// ── regenerate predictions for not-finished fixtures ────────────────────────
let changed = 0;
const skipped = [];
for (const f of fixtures) {
  const finished = results[f.id]?.state === "finished";
  if (finished) continue; // keep historical/researched calls intact
  const existing = predictions[f.id];
  if (existing?.lineups?.status === "confirmed") { skipped.push(f.id + " (confirmed XI)"); continue; }
  const pred = buildPrediction(f);
  if (!pred) { skipped.push(f.id + " (no group data)"); continue; }
  predictions[f.id] = pred;
  changed++;
  console.log(`  ✓ ${f.id.padEnd(22)} → ${pred.win.pick} ${pred.fullTime.score} (${pred.confidence})`);
}

predFile.predictions = predictions;
predFile.meta = {
  ...predFile.meta,
  generatedAt: predFile.meta?.generatedAt, // preserve unless we write
  modelUpdatedAt: BACKTEST ? predFile.meta?.modelUpdatedAt : new Date().toISOString(),
  method:
    "Upcoming matches: bivariate-Poisson model — expected goals from shrunk group-stage attack/defence rates with a form/quality tilt; scorer odds from real ESPN per-team goal data. Finished matches retain their per-match research.",
};

if (skipped.length) console.log("  skipped:", skipped.join(", "));

if (CHECK_ONLY) {
  console.log(changed ? `predictions.json WOULD CHANGE (${changed} matches).` : "predictions.json clean.");
  process.exit(changed ? 2 : 0);
}

if (changed) {
  predFile.meta.generatedAt = new Date().toISOString();
  writeFileSync(P("predictions.json"), JSON.stringify(predFile, null, 2) + "\n");
  console.log(`\nWrote ${changed} model predictions to data/predictions.json`);
} else {
  console.log("No upcoming matches needed a prediction.");
}
