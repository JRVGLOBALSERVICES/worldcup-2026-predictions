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
// Real bookmaker prices (1xBet LineFeed + hand-captured fallback) → the Value Spot.
let oddsBook = {};
try {
  const of = JSON.parse(readFileSync(P("odds.json"), "utf8"));
  oddsBook = of.odds ?? {};
} catch { /* no odds yet — Value Spot degrades to "no live market" */ }

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

// ════════════════════════════════════════════════════════════════════════════
//  THE BRAIN — three reasoning layers per match (thelocktalk framework deck)
//  analyse the match (Pitch Report) → price it (Value Spot) → trap-filter it.
//  All deterministic, derived from the model + standings + stats + real odds.
// ════════════════════════════════════════════════════════════════════════════

// 2026 host-city climate read — heat/altitude is a real WC-26 edge the model
// can't see in goal rates. Keyed by city substring (matches fixtures.json city).
const HOST_CITY = [
  [/mexico city/i, { kind: "altitude", note: "Mexico City sits at ~2,240m — thin air saps high-press legs after the hour; the deeper-block side tires less." }],
  [/guadalajara/i, { kind: "altitude", note: "Guadalajara altitude (~1,560m) takes the sting out of a high press late on." }],
  [/houston|arlington|dallas/i, { kind: "heat", note: "Texas summer heat/humidity — afternoon kickoffs slow the tempo and favour the patient, lower-block side." }],
  [/miami/i, { kind: "heat", note: "Miami humidity drags the second-half tempo; hydration breaks reset momentum." }],
  [/monterrey/i, { kind: "heat", note: "Monterrey runs hot and dry — energy management beats gegenpressing here." }],
  [/atlanta|kansas/i, { kind: "heat", note: "Warm, humid venue — expect a hydration break and a cagier final 20." }],
  [/inglewood|los angeles|santa clara|san francisco|seattle|vancouver|foxborough|boston/i, { kind: "mild", note: "Temperate, controlled venue — climate is neutral; the football decides it." }],
];
function cityFactor(city) {
  for (const [re, v] of HOST_CITY) if (re.test(city || "")) return v;
  return { kind: "neutral", note: "Climate broadly neutral at this venue — no heat/altitude tilt to price in." };
}

const pct = (x) => Math.round(x * 1000) / 10; // 0.567 → 56.7
/** P(total goals ≥ n) from the sum-Poisson (sum of two Poissons is Poisson(λh+λa)). */
function pOverTotal(lh, la, n) {
  const lam = lh + la;
  let cdf = 0;
  for (let k = 0; k < n; k++) cdf += pois(k, lam);
  return 1 - cdf;
}

/** Slide 3/6 — the 10-point structured read. */
function buildPitchReport(f, ctx) {
  const { rh, ra, lh, la, ft, fav, isKnockout, lineupStatus } = ctx;
  const home = f.home.name, away = f.away.name;
  const rowH = teamRows[norm(home)], rowA = teamRows[norm(away)];
  const stH = teamStats[norm(home)], stA = teamStats[norm(away)];
  const drawPct = pct(ft.pDraw), totalXg = lh + la;

  // 1. facts — verifiable only
  const facts = [];
  const gd = (r) => (r ? (r.goalsFor - r.goalsAgainst >= 0 ? "+" : "") + (r.goalsFor - r.goalsAgainst) : null);
  if (rowH?.played) facts.push(`${home}: ${rowH.points} pts, ${gd(rowH)} GD across ${rowH.played} group game${rowH.played === 1 ? "" : "s"} (${rowH.goalsFor} for / ${rowH.goalsAgainst} against).`);
  if (rowA?.played) facts.push(`${away}: ${rowA.points} pts, ${gd(rowA)} GD across ${rowA.played} group game${rowA.played === 1 ? "" : "s"} (${rowA.goalsFor} for / ${rowA.goalsAgainst} against).`);
  const topH = stH?.scorers?.[0], topA = stA?.scorers?.[0];
  if (topH) facts.push(`${home}'s ${topH.name} leads them with ${topH.value} goal${topH.value === 1 ? "" : "s"} in ${topH.matches} game${topH.matches === 1 ? "" : "s"}.`);
  if (topA) facts.push(`${away}'s ${topA.name} leads them with ${topA.value} goal${topA.value === 1 ? "" : "s"} in ${topA.matches} game${topA.matches === 1 ? "" : "s"}.`);
  if (!facts.length) facts.push(`Both sides arrive via the knockout bracket; group goal-rates are the only hard data so far.`);

  // 2. assumptions — what the model projects
  const favName = fav.pick === "Draw" ? (lh >= la ? home : away) : fav.pick;
  const dogName = favName === home ? away : home;
  const assumptions = [
    `Model projects ${favName} to carry more of the ball and the better chances (higher attack rating); ${dogName} to sit compact and play on the break.`,
    `Goal expectancy ${lh.toFixed(1)}–${la.toFixed(1)} (${home}–${away}) assumes group-stage scoring rates hold — a big regression risk on a 2–3 game sample.`,
  ];

  // 3. lineups
  const lineups = lineupStatus === "confirmed"
    ? "XIs confirmed — picks below are tuned to the actual starters."
    : `XIs not yet confirmed${isKnockout ? " — but it's win-or-out, so expect both strongest available XI" : " — group rotation possible if a side is already through"}. Treat lineup-dependent props as provisional.`;

  // 4. motivation
  const motivation = isKnockout
    ? `Knockout — win or go home. Neither side rotates; both will accept a cagey, low-risk game over an open one, which compresses goals and lifts draw/extra-time risk.`
    : `Group stage — motivation depends on the table; a side already qualified may rest legs, an eliminated side may throw caution out. Check standings before staking lineup-sensitive props.`;

  // 5. style & xG read
  const xgRead = lh > la + 0.25
    ? `${home} shade the chance-creation (${lh.toFixed(1)} vs ${la.toFixed(1)} xG) — they should make the running.`
    : la > lh + 0.25
      ? `${away} shade the chance-creation (${la.toFixed(1)} vs ${lh.toFixed(1)} xG) — they should make the running.`
      : `Chances project close (${lh.toFixed(1)}–${la.toFixed(1)} xG) — a true coin-flip for territory; small margins decide it.`;

  // 6. draw risk
  const drawRisk = totalXg < 2.3
    ? `High. Low combined xG (${totalXg.toFixed(1)}) and a ${drawPct}% modelled draw — this profiles as a 1-0 / 1-1 that can drift to extra time.`
    : drawPct >= 28
      ? `Elevated — ${drawPct}% draw with goals on offer; a level game is very much in play.`
      : `Moderate — ${drawPct}% modelled draw; not a stalemate profile, but never dismiss it in a knockout.`;

  // 7. travel / climate
  const travel = cityFactor(f.city).note;

  // 8. case FOR / AGAINST the model's pick
  const pickIsDraw = fav.pick === "Draw";
  const caseFor = [];
  const caseAgainst = [];
  if (pickIsDraw) {
    caseFor.push(`Tightest projection on the board — ${drawPct}% draw on low combined xG.`, `Knockout caution pulls both sides toward a level 90 minutes.`);
    caseAgainst.push(`One moment of quality (set-piece, individual) breaks any draw.`, `Draw is the lowest-confidence headline call there is.`);
  } else {
    caseFor.push(`${favName} are the model's ${pct(fav.p)}% favourite — higher attack rating and the better recent goal-rate.`);
    if ((favName === home ? topH : topA)) caseFor.push(`A genuine match-winner in ${(favName === home ? topH : topA).name} carrying the scoring load.`);
    caseFor.push(cityFactor(f.city).kind === "mild" || cityFactor(f.city).kind === "neutral" ? `Neutral conditions let the better side's quality tell.` : `Conditions (${cityFactor(f.city).kind}) suit a controlled game ${favName} can manage.`);
    caseAgainst.push(`${drawPct}% draw + ${dogName}'s deep block — a classic possession-favourite-vs-low-block out-xG trap.`);
    caseAgainst.push(`Group goal-rates are a tiny sample; ${favName}'s number may be inflated by one result.`);
    if (!isKnockout) caseAgainst.push(`Rotation/motivation risk if the table is already settled.`);
  }

  // 9 + 10. verdict + change-of-mind — "prefer Pass over a weak bet, never
  // ignore the draw" (slide 3 rules). A live knockout draw or thin goals pulls a
  // strong favourite down to a Lean, keeping all three brain layers coherent.
  const drawLive = isKnockout && drawPct >= 23;
  const verdict = fav.p < 0.45 || (pickIsDraw && drawPct < 30)
    ? "Pass"
    : fav.p >= 0.55 && totalXg >= 2.3 && !drawLive
      ? "Bet"
      : "Lean";
  const changeMind = lineupStatus === "confirmed"
    ? `An early goal flips the game state — the block either cracks open or locks shut.`
    : `A confirmed XI resting ${favName === home ? (topH?.name ?? "a key starter") : (topA?.name ?? "a key starter")}, or news the underdog is missing a defensive linchpin.`;

  return {
    facts: facts.slice(0, 4),
    assumptions,
    lineups,
    motivation,
    xgRead,
    drawRisk,
    travel,
    caseFor: caseFor.slice(0, 3),
    caseAgainst: caseAgainst.slice(0, 3),
    verdict,
    changeMind,
  };
}

/** Slide 4/6 — odds value check against real bookmaker prices. null if unpriced. */
function buildValueSpot(f, ctx) {
  const book = oddsBook[f.id];
  if (!book || !book.h2h || !book.h2h.home || !book.h2h.draw || !book.h2h.away) return null;
  const { ft, lh, la } = ctx;
  const home = f.home.name, away = f.away.name;
  const o = book.h2h;
  // implied fractions + overround
  const impH = 1 / o.home, impD = 1 / o.draw, impA = 1 / o.away;
  const sum = impH + impD + impA;
  const overroundPct = Math.round((sum - 1) * 1000) / 10;
  const mk = (market, side, price, impFrac, modelP) => {
    const fairFrac = impFrac / sum;
    const edgePts = Math.round((modelP * 100 - fairFrac * 100) * 10) / 10;
    const verdict = edgePts >= 1.5 ? "good" : edgePts <= -1.5 ? "bad" : "fair";
    return { market, side, price: String(price), impliedPct: pct(impFrac), fairPct: pct(fairFrac), modelPct: pct(modelP), edgePts, verdict };
  };
  const legs = [
    mk("Match result", home, o.home, impH, ft.pHome),
    mk("Match result", "Draw", o.draw, impD, ft.pDraw),
    mk("Match result", away, o.away, impA, ft.pAway),
  ];
  // totals leg if the book gave a ~2.5 line
  const t = (book.totals || []).find((x) => Math.abs(x.line - 2.5) < 0.01);
  if (t && t.over && t.under) {
    const pOver = pOverTotal(lh, la, Math.ceil(t.line)); // ≥3 for the 2.5 line
    const io = 1 / t.over, iu = 1 / t.under, s2 = io + iu;
    const eo = Math.round((pOver * 100 - (io / s2) * 100) * 10) / 10;
    const eu = Math.round(((1 - pOver) * 100 - (iu / s2) * 100) * 10) / 10;
    const tv = (e) => (e >= 1.5 ? "good" : e <= -1.5 ? "bad" : "fair");
    legs.push({ market: `Over ${t.line}`, side: `Over ${t.line}`, price: String(t.over), impliedPct: pct(io), fairPct: pct(io / s2), modelPct: pct(pOver), edgePts: eo, verdict: tv(eo) });
    legs.push({ market: `Under ${t.line}`, side: `Under ${t.line}`, price: String(t.under), impliedPct: pct(iu), fairPct: pct(iu / s2), modelPct: pct(1 - pOver), edgePts: eu, verdict: tv(eu) });
  }
  const valued = legs.filter((l) => l.verdict === "good").sort((a, b) => b.edgePts - a.edgePts);
  const bestSide = valued[0]?.side ?? null;
  const fav = legs.slice(0, 3).reduce((m, l) => (l.modelPct > m.modelPct ? l : m));
  const headline = bestSide
    ? `${bestSide} is the one number with positive value (+${valued[0].edgePts} pts over fair). ${fav.verdict === "bad" ? `The favourite (${fav.side}) is a bad price — you'd overpay.` : ""}`.trim()
    : `No positive-value side — the book has this priced efficiently (${overroundPct}% margin). ${fav.verdict === "bad" ? `Favourite ${fav.side} is a poor price.` : `Fair all round; nothing to beat.`}`;
  return {
    source: book.source || "book",
    overroundPct,
    legs,
    bestSide,
    headline,
    capturedAt: book.capturedAt || new Date().toISOString(),
  };
}

/** Slide 5/6 — talk-me-out-of-a-weak-bet filter on the model's headline pick. */
function buildTrapDetector(f, ctx, valueSpot) {
  const { ft, lh, la, fav, isKnockout, lineupStatus } = ctx;
  const drawPct = pct(ft.pDraw), totalXg = lh + la;
  const pickIsDraw = fav.pick === "Draw";
  const favName = pickIsDraw ? null : fav.pick;
  const tight = Math.abs(ft.pHome - ft.pAway) < 0.18;
  // value on the pick, if priced
  const pickLeg = valueSpot?.legs?.find((l) => l.market === "Match result" && l.side === fav.pick);
  const overpaying = pickLeg ? pickLeg.verdict === "bad" : false;
  // hot-streak: is the pick's top scorer's tally concentrated in one game?
  const stPick = favName ? teamStats[norm(favName)] : null;
  const topPick = stPick?.scorers?.[0];
  const hotStreak = !!(topPick && topPick.value >= 3 && (topPick.matches ?? 3) <= 2);

  const flags = [
    {
      name: "Favourite on reputation / at a poor price",
      tripped: !pickIsDraw && (overpaying || (pickLeg && pickLeg.modelPct < pickLeg.impliedPct - 3)),
      why: overpaying
        ? `You're paying ${pickLeg.impliedPct}% for a ${pickLeg.modelPct}% thing — negative value on the favourite.`
        : pickLeg
          ? `Price broadly fair (${pickLeg.impliedPct}% implied vs ${pickLeg.modelPct}% model).`
          : `Not priced — can't confirm the favourite is good value.`,
    },
    {
      name: "Dead rubber / rotation risk",
      tripped: !isKnockout,
      why: isKnockout ? `Knockout — both name strongest XI, no rotation.` : `Group stage — qualification state could trigger rotation; check the table.`,
    },
    {
      name: "Built on one result / a short hot streak",
      tripped: hotStreak,
      why: hotStreak
        ? `${topPick.name}'s ${topPick.value} goals lean on ~1 big game — strip it and the attack looks ordinary.`
        : `Scoring spread across games, not one rout — sample is thin but not a single-game mirage.`,
    },
    {
      name: "Cagey knockout the market underrates",
      tripped: isKnockout && totalXg < 2.5 && tight,
      why: isKnockout && totalXg < 2.5 && tight
        ? `Low combined xG (${totalXg.toFixed(1)}) + tight margin in a knockout — this is built for 1-0 / pens, not a comfortable win.`
        : `Goals/margin profile doesn't scream stalemate.`,
    },
    {
      name: "Lineups unconfirmed and the bet depends on them",
      tripped: lineupStatus !== "confirmed",
      why: lineupStatus === "confirmed" ? `XIs confirmed — no lineup risk.` : `XIs not out — any scorer/lineup-dependent angle is provisional.`,
    },
    {
      // a knockout draw sends it to extra-time/pens and kills a 90-min win bet,
      // so the bar to "respect the draw" is lower in knockouts than the group.
      name: "Ignoring the draw",
      tripped: !pickIsDraw && drawPct >= (isKnockout ? 23 : 28),
      why: !pickIsDraw && drawPct >= (isKnockout ? 23 : 28)
        ? `${drawPct}% draw is live${isKnockout ? " — and a level 90 then pens kills a straight win bet even if your side advances" : ""}.`
        : pickIsDraw ? `The pick IS the draw — fully accounted for.` : `Draw chance (${drawPct}%) is low enough to discount.`,
    },
    {
      name: "Emotional / a chase / just for action",
      tripped: false,
      why: `Model call — no tilt, no chase. (Only you can answer this one honestly for your own stake.)`,
    },
  ];

  const trapsTripped = flags.filter((x) => x.tripped).length;
  // edge characterisation
  let edge;
  if (valueSpot?.bestSide === fav.pick) edge = "real edge";
  else if (overpaying) edge = "narrative-leaning";
  else if (!valueSpot) edge = pickIsDraw ? "narrative-leaning" : "edge-leaning";
  else edge = "edge-leaning";
  // verdict on the WIN pick
  const drawTripped = flags.find((x) => x.name === "Ignoring the draw")?.tripped;
  const pickValueGood = valueSpot?.bestSide === fav.pick;
  let verdict;
  if (trapsTripped >= 4 || (overpaying && trapsTripped >= 3)) verdict = "PASS";
  else if (overpaying || trapsTripped >= 2 || pickIsDraw || (isKnockout && drawTripped && !pickValueGood)) verdict = "LEAN";
  else verdict = "PLAYABLE";

  const discipline = isKnockout
    ? `Being the better team and being a good bet are two different things — in a knockout, respect the draw, don't overpay the favourite, and never chase goals in a game built to produce few.`
    : `Price beats prediction: only stake when the number is wrong, not when the team is good. When in doubt, pass — there's another match tomorrow.`;

  return { flags, trapsTripped, edge, verdict, discipline };
}

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

/**
 * Attach The Brain (Pitch Report + Value Spot + TRAP Detector) to an existing
 * prediction, IN PLACE. Strictly additive to a researched call: it reads the
 * prediction's OWN headline `win.pick` and aligns the frameworks to it, so the
 * three layers never contradict the call shown above them. The model only
 * supplies the probabilities/xG the slides reason over.
 */
function attachBrain(f, pred) {
  const rh = ratings(f.home.name);
  const ra = ratings(f.away.name);
  const lh = MU * rh.attack * ra.defence * HFA;
  const la = MU * ra.attack * rh.defence / HFA;
  const ft = scoreGrid(lh, la);
  const home = f.home.name, away = f.away.name;
  // align the frameworks' "pick" to the prediction's actual headline call
  const pick = pred.win?.pick ?? (ft.pHome >= ft.pAway ? home : away);
  const p = pick === home ? ft.pHome : pick === away ? ft.pAway : ft.pDraw;
  const ctx = {
    rh, ra, lh, la, ft,
    fav: { pick, p },
    isKnockout: Boolean(f.round),
    lineupStatus: pred.lineups?.status ?? "unconfirmed",
  };
  pred.pitchReport = buildPitchReport(f, ctx);
  pred.valueSpot = buildValueSpot(f, ctx);
  pred.trapDetector = buildTrapDetector(f, ctx, pred.valueSpot);
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

// ── The Brain pass: enrich EVERY upcoming prediction (fresh + researched) ───
let brained = 0;
for (const f of fixtures) {
  if (results[f.id]?.state === "finished") continue; // finished calls stay frozen
  const pred = predictions[f.id];
  if (!pred) continue;
  attachBrain(f, pred);
  brained++;
}
if (brained) console.log(`  🧠 brain attached to ${brained} upcoming prediction(s) (pitch · value · trap)`);

predFile.predictions = predictions;
predFile.meta = {
  ...predFile.meta,
  generatedAt: predFile.meta?.generatedAt, // preserve unless we write
  modelUpdatedAt: BACKTEST ? predFile.meta?.modelUpdatedAt : new Date().toISOString(),
  method:
    "Upcoming matches: bivariate-Poisson model — expected goals from shrunk group-stage attack/defence rates with a form/quality tilt; scorer odds from real ESPN per-team goal data. Each upcoming call also carries The Brain — a Pitch Report (10-point read), a Value Spot (model vs real 1xBet/book prices), and a TRAP Detector (weak-bet filter). Finished matches retain their per-match research.",
};

if (skipped.length) console.log("  skipped (kept):", skipped.join(", "));

const touched = changed + brained;
if (CHECK_ONLY) {
  console.log(touched ? `predictions.json WOULD CHANGE (${changed} model, ${brained} brain).` : "predictions.json clean.");
  process.exit(touched ? 2 : 0);
}

if (touched) {
  predFile.meta.generatedAt = new Date().toISOString();
  writeFileSync(P("predictions.json"), JSON.stringify(predFile, null, 2) + "\n");
  console.log(`\nWrote ${changed} fresh model prediction(s) + brain on ${brained} upcoming → data/predictions.json`);
} else {
  console.log("No upcoming matches needed a prediction.");
}
