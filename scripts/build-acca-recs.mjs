#!/usr/bin/env node
/**
 * Acca recommendation engine — per-market probabilities for upcoming fixtures,
 * composed into risk-tiered parlay recommendations.
 *
 * Data: results.json (ALL finished matches incl. knockouts: goals, corners,
 * fouls, cards, playerShots), fixtures.json, stats.json (scorers/assists),
 * standings.json fallback. Poisson core mirrors build-predictions.mjs but
 * rebuilds team rates from the full tournament (recency-weighted) and adds
 * corners / fouls / cards / player-shots markets.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "..", "data");
const J = (f) => JSON.parse(readFileSync(join(DATA, f), "utf8"));

const fixtures = J("fixtures.json");
const results = J("results.json").results;
const stats = J("stats.json");
const normTeam = (s) => String(s ?? "").toLowerCase().replace(/[^a-z]/g, "").replace(/^unitedstates(ofamerica)?$/, "usa");

const fxArr = Array.isArray(fixtures) ? fixtures : fixtures.fixtures || fixtures.matches;
const name = (t) => (typeof t === "string" ? t : t?.name || "?");

// ── per-team tournament rates from finished matches ─────────────────────────
const T = {}; // team -> {g, gf, ga, cf, ca, ff, fa, yf, sf, sa, htf, hta, matches:[{gf,ga,htgf,htga}]}
function team(t) {
  return (T[t] ??= { g: 0, gf: 0, ga: 0, cf: 0, ca: 0, ff: 0, fa: 0, yf: 0, ya: 0, matches: [] });
}
for (const fx of fxArr) {
  const r = results[fx.id];
  if (!r || r.state !== "finished") continue;
  const h = name(fx.home), a = name(fx.away);
  const ft = r.ft90 || r.ft, ht = r.ht || { home: 0, away: 0 };
  const s = r.stats || {};
  const c = s.corners || {}, f = s.fouls || {}, y = s.yellow || {};
  const th = team(h), ta = team(a);
  th.g++; ta.g++;
  th.gf += ft.home; th.ga += ft.away; ta.gf += ft.away; ta.ga += ft.home;
  th.cf += c.home ?? 4.5; th.ca += c.away ?? 4.5; ta.cf += c.away ?? 4.5; ta.ca += c.home ?? 4.5;
  th.ff += f.home ?? 11; th.fa += f.away ?? 11; ta.ff += f.away ?? 11; ta.fa += f.home ?? 11;
  th.yf += y.home ?? 1.8; ta.yf += y.away ?? 1.8;
  th.matches.push({ gf: ft.home, ga: ft.away, htgf: ht.home, htga: ht.away, kick: fx.kickoffUTC });
  ta.matches.push({ gf: ft.away, ga: ft.home, htgf: ht.away, htga: ht.home, kick: fx.kickoffUTC });
}
// league baselines
const teams = Object.values(T).filter((t) => t.g >= 3);
const MU = teams.reduce((s, t) => s + t.gf / t.g, 0) / teams.length; // goals per team per game
const MUC = teams.reduce((s, t) => s + t.cf / t.g, 0) / teams.length; // corners
const MUF = teams.reduce((s, t) => s + t.ff / t.g, 0) / teams.length; // fouls

const SHRINK = 2.0, HT_SHARE = 0.44, HFA = 1.03, MAXG = 8;
function factorial(n) { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }
const pois = (k, l) => (Math.exp(-l) * l ** k) / factorial(k);
const poisCdf = (k, l) => { let s = 0; for (let i = 0; i <= k; i++) s += pois(i, l); return s; };

// recency-weighted rate: last 2 games weight 1.5x
function rates(t) {
  const tm = T[t];
  if (!tm || tm.g < 2) return { att: 1, def: 1, cf: MUC, ca: MUC, ff: MUF, fa: MUF, g: tm?.g ?? 0 };
  const ms = [...tm.matches].sort((a, b) => new Date(a.kick) - new Date(b.kick));
  let wgf = 0, wga = 0, W = 0;
  ms.forEach((m, i) => { const w = i >= ms.length - 2 ? 1.5 : 1; wgf += w * m.gf; wga += w * m.ga; W += w; });
  const att = (wgf / W + SHRINK * MU / tm.g) / ((W + SHRINK) / W) / MU * (W / (W)) ;
  // simpler shrink: blend observed with league mean by SHRINK pseudo-games
  const attS = ((wgf / W) * tm.g + MU * SHRINK) / (tm.g + SHRINK) / MU;
  const defS = ((wga / W) * tm.g + MU * SHRINK) / (tm.g + SHRINK) / MU;
  return { att: attS, def: defS, cf: tm.cf / tm.g, ca: tm.ca / tm.g, ff: tm.ff / tm.g, fa: tm.fa / tm.g, g: tm.g };
}

function grid(lh, la) {
  let pH = 0, pD = 0, pA = 0; const g = [];
  for (let h = 0; h <= MAXG; h++) for (let a = 0; a <= MAXG; a++) {
    const p = pois(h, lh) * pois(a, la); g.push({ h, a, p });
    if (h > a) pH += p; else if (h === a) pD += p; else pA += p;
  }
  return { g, pH, pD, pA };
}
const pTotUnder = (g, line) => g.g.reduce((s, c) => s + (c.h + c.a < line ? c.p : 0), 0);
const pBtts = (g) => g.g.reduce((s, c) => s + (c.h > 0 && c.a > 0 ? c.p : 0), 0);

// player rates
function playerRates() {
  const shots = {}; // player -> {shots, games}
  for (const id of Object.keys(results)) {
    const ps = results[id]?.stats?.playerShots; if (!ps) continue;
    for (const [pl, n] of Object.entries(ps)) { (shots[pl] ??= { shots: 0, games: 0 }); shots[pl].shots += n; shots[pl].games++; }
  }
  return shots;
}
const pShots = playerRates();

function scorerProb(teamName, player, lTeam) {
  const bt = stats.byTeam?.[normTeam(teamName)]; if (!bt) return null;
  const teamGoals = bt.scorers.reduce((s, x) => s + x.value, 0) || 1;
  const p = bt.scorers.find((x) => x.name === player);
  if (!p) return null;
  const lp = lTeam * (p.value / teamGoals);
  return 1 - Math.exp(-lp);
}

// ── build recs for each upcoming fixture ────────────────────────────────────
const upcoming = fxArr
  .filter((m) => !results[m.id] || results[m.id].state !== "finished")
  .sort((a, b) => new Date(a.kickoffUTC) - new Date(b.kickoffUTC));

const out = {};
for (const fx of upcoming) {
  const h = name(fx.home), a = name(fx.away);
  const rh = rates(h), ra = rates(a);
  const lh = MU * rh.att * ra.def * HFA;
  const la = MU * ra.att * rh.def / HFA;
  const G = grid(lh, la);
  const G1 = grid(lh * HT_SHARE, la * HT_SHARE);
  const legs = [];
  const add = (market, pick, p, note) => p != null && legs.push({ market, pick, p: +p.toFixed(3), note });

  // 1X2 / DC / qualify
  add("Result", h, G.pH); add("Result", a, G.pA); add("Result", "Draw", G.pD);
  add("Double Chance", `${h} or Draw`, G.pH + G.pD);
  add("Double Chance", `${a} or Draw`, G.pA + G.pD);
  add("Double Chance", `${h} or ${a}`, G.pH + G.pA);
  const favShare = G.pH / (G.pH + G.pA);
  add("To Qualify", h, G.pH + G.pD * favShare, "90-min win + ET/pens share");
  add("To Qualify", a, G.pA + G.pD * (1 - favShare), "90-min win + ET/pens share");

  // totals
  for (const line of [1.5, 2.5, 3.5, 4.5, 5.5]) {
    add("Total Goals", `Over ${line}`, 1 - pTotUnder(G, line));
    add("Total Goals", `Under ${line}`, pTotUnder(G, line));
  }
  add("Total Goals", "Over 0.5", 1 - pois(0, lh) * pois(0, la));
  // team totals
  add("Team Goals", `${h} Under 2.5`, poisCdf(2, lh)); add("Team Goals", `${a} Under 2.5`, poisCdf(2, la));
  add("Team Goals", `${h} Under 3.5`, poisCdf(3, lh)); add("Team Goals", `${a} Under 3.5`, poisCdf(3, la));
  add("Team Goals", `${h} Over 0.5`, 1 - pois(0, lh)); add("Team Goals", `${a} Over 0.5`, 1 - pois(0, la));
  // BTTS + 1H
  add("BTTS", "Yes", pBtts(G)); add("BTTS", "No", 1 - pBtts(G));
  add("1st Half Goals", "Over 0.5", 1 - pois(0, lh * HT_SHARE) * pois(0, la * HT_SHARE));
  add("1st Half Goals", "Under 1.5", pTotUnder(G1, 1.5));
  add("1st Half Goals", "Under 2.5", pTotUnder(G1, 2.5));
  add("1st Half DC", `${h} or Draw`, G1.pH + G1.pD);
  add("1st Half DC", `${a} or Draw`, G1.pA + G1.pD);

  // corners (Poisson on expected total)
  const expC = (rh.cf + ra.ca) / 2 + (ra.cf + rh.ca) / 2;
  for (const line of [7.5, 8.5, 9.5, 10.5]) {
    add("Corners", `Over ${line}`, 1 - poisCdf(Math.floor(line), expC), `exp ${expC.toFixed(1)}`);
    add("Corners", `Under ${line}`, poisCdf(Math.floor(line), expC), `exp ${expC.toFixed(1)}`);
  }
  // fouls (normal-ish via Poisson, lines around expectation)
  const expF = (rh.ff + ra.fa) / 2 + (ra.ff + rh.fa) / 2;
  for (const line of [18.5, 21.5, 24.5, 27.5]) {
    add("Fouls", `Over ${line}`, 1 - poisCdf(Math.floor(line), expF), `exp ${expF.toFixed(1)}`);
    add("Fouls", `Under ${line}`, poisCdf(Math.floor(line), expF), `exp ${expF.toFixed(1)}`);
  }

  // scorers + shots for top players of each side
  for (const [tn, lt] of [[h, lh], [a, la]]) {
    const bt = stats.byTeam?.[normTeam(tn)]; if (!bt) continue;
    for (const sc of bt.scorers.slice(0, 3)) {
      add("Anytime Scorer", `${sc.name} (${tn})`, scorerProb(tn, sc.name, lt), `${sc.value} goals this WC`);
    }
    // player shots from real per-match shot data
    const cands = Object.entries(pShots)
      .filter(([pl, v]) => v.games >= 3 && (bt.scorers.some((s) => s.name === pl) || bt.assists.some((s) => s.name === pl)))
      .slice(0, 6);
    for (const [pl, v] of cands) {
      const spg = v.shots / v.games;
      add("Player 1+ Shot", `${pl} (${tn})`, Math.min(0.97, 1 - Math.exp(-spg)), `${spg.toFixed(1)} shots/gm over ${v.games} gms`);
    }
  }

  legs.sort((x, y) => y.p - x.p);
  out[fx.id] = {
    match: `${h} vs ${a}`, kickoffUTC: fx.kickoffUTC, stage: fx.stage || fx.round,
    xg: { [h]: +lh.toFixed(2), [a]: +la.toFixed(2) }, expCorners: +expC.toFixed(1), expFouls: +expF.toFixed(1),
    legs,
  };
}
writeFileSync(join(DATA, "acca-recs.json"), JSON.stringify({ meta: { generatedAt: new Date().toISOString(), mu: +MU.toFixed(2) }, recs: out }, null, 2));
console.log("baseline goals/team/game:", MU.toFixed(2), "corners/team:", MUC.toFixed(2), "fouls/team:", MUF.toFixed(2));
for (const [id, r] of Object.entries(out)) {
  console.log(`\n=== ${r.match} (${r.stage}) xG ${JSON.stringify(r.xg)} corners~${r.expCorners} fouls~${r.expFouls}`);
  for (const l of r.legs.filter((l) => l.p >= 0.75).slice(0, 18))
    console.log(`  ${(l.p * 100).toFixed(0)}%  ${l.market}: ${l.pick}${l.note ? "  [" + l.note + "]" : ""}`);
}
