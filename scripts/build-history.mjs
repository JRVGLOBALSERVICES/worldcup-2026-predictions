#!/usr/bin/env node
/**
 * 8-year historical priors from the martj42/international_results dataset
 * (all international matches + goalscorers, live-updated).
 *
 * Produces data/history.json:
 *   meta: { window, mu8 (goals/team/match in window) }
 *   teams[normName]: { name, elo, games, att, def, bttsRate, over25Rate,
 *                      cleanSheetRate, fhShare, fhConcededShare }
 *   players[normName]: { name, team, goals4y, teamGames4y, gpg, penShare }
 *
 * - Elo computed from 2010 onward (all teams, K by competition, MoV multiplier).
 * - Team rates: last 8 years, exponential time decay (half-life 2.5y),
 *   friendlies half-weight, opponent-Elo adjustment on goals for/against.
 * - fhShare: fraction of the team's goals scored in min <= 45 (from the
 *   goalscorers file) — drives per-fixture 1st-half goal share.
 * - Player priors: last 4 years, goals per TEAM match (appearance data is not
 *   in the dataset, so this understates rate for rotation players — used as a
 *   prior only, blended with current-tournament share downstream).
 *
 * Sources are cached at /tmp/intl-results.csv + /tmp/intl-scorers.csv and
 * downloaded from GitHub raw if missing. Corners/fouls/cards are NOT in this
 * dataset — those markets stay on current-tournament observed counts.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "..", "data");

const SRC = {
  results: ["/tmp/intl-results.csv", "https://raw.githubusercontent.com/martj42/international_results/master/results.csv"],
  scorers: ["/tmp/intl-scorers.csv", "https://raw.githubusercontent.com/martj42/international_results/master/goalscorers.csv"],
};
for (const [path, url] of Object.values(SRC))
  if (!existsSync(path)) execSync(`curl -sL -o ${path} ${url}`, { stdio: "inherit" });

// minimal CSV line parser (handles quoted fields)
function parseCsv(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const row = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
        else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ",") { row.push(cur); cur = ""; }
      else cur += ch;
    }
    row.push(cur);
    rows.push(row);
  }
  return rows.slice(1); // drop header
}

const strip = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
const normTeam = (s) => strip(s).toLowerCase().replace(/[^a-z]/g, "").replace(/^unitedstates(ofamerica)?$/, "usa");
const normPlayer = (s) => strip(s).toLowerCase().replace(/[^a-z]/g, "");

const results = parseCsv(readFileSync(SRC.results[0], "utf8"))
  .map(([date, home, away, hs, as, tournament, , , neutral]) => ({
    date, home, away, hs: +hs, as: +as, tournament, neutral: neutral === "TRUE",
  }))
  .filter((m) => Number.isFinite(m.hs) && Number.isFinite(m.as)); // drop unplayed (NA)

const WINDOW_START = "2018-07-07", ELO_START = "2010-01-01", PLAYER_START = "2022-07-07";
const NOW = new Date(results[results.length - 1].date); // dataset horizon, deterministic

// ── Elo (from 2010, all teams) ───────────────────────────────────────────────
const elo = {};
const E = (t) => (elo[t] ??= 1500);
const kFor = (t) =>
  t === "FIFA World Cup" ? 60
  : /World Cup qualification/.test(t) ? 40
  : /Friendly/.test(t) ? 20
  : /qualification/.test(t) ? 35
  : 50; // continental finals + Nations Leagues
for (const m of results) {
  if (m.date < ELO_START) continue;
  const h = normTeam(m.home), a = normTeam(m.away);
  const eh = E(h) + (m.neutral ? 0 : 80), ea = E(a);
  const exp = 1 / (1 + 10 ** ((ea - eh) / 400));
  const res = m.hs > m.as ? 1 : m.hs === m.as ? 0.5 : 0;
  const mov = Math.log(Math.abs(m.hs - m.as) + 1) || 1;
  const delta = kFor(m.tournament) * mov * (res - exp);
  elo[h] = E(h) + delta;
  elo[a] = E(a) - delta;
  m.eloH = elo[h]; m.eloA = elo[a]; // post-match snapshot (used for opp adjustment)
}

// ── 8-year team rates ────────────────────────────────────────────────────────
const HALF_LIFE_DAYS = 913; // 2.5y
const decay = (date) => 0.5 ** ((NOW - new Date(date)) / 86400000 / HALF_LIFE_DAYS);
const compW = (t) => (/Friendly/.test(t) ? 0.5 : /FIFA World Cup$/.test(t) ? 1.3 : 1.0);
const oppStrength = (oppElo) => Math.min(1.6, Math.max(0.6, 1 + (oppElo - 1500) / 1000));

const T = {};
const team = (n, raw) => (T[n] ??= { name: raw, w: 0, gf: 0, ga: 0, btts: 0, o25: 0, cs: 0, games: 0 });
for (const m of results) {
  if (m.date < WINDOW_START) continue;
  const w = decay(m.date) * compW(m.tournament);
  const h = normTeam(m.home), a = normTeam(m.away);
  const sh = oppStrength(m.eloA ?? 1500), sa = oppStrength(m.eloH ?? 1500);
  const th = team(h, m.home), ta = team(a, m.away);
  th.w += w; ta.w += w; th.games++; ta.games++;
  th.gf += w * m.hs * sh; th.ga += w * (m.as / sh);
  ta.gf += w * m.as * sa; ta.ga += w * (m.hs / sa);
  const btts = m.hs > 0 && m.as > 0 ? 1 : 0, o25 = m.hs + m.as > 2.5 ? 1 : 0;
  th.btts += w * btts; ta.btts += w * btts;
  th.o25 += w * o25; ta.o25 += w * o25;
  th.cs += w * (m.as === 0 ? 1 : 0); ta.cs += w * (m.hs === 0 ? 1 : 0);
}

// ── first-half goal share + player priors from goalscorers ──────────────────
const scorers = parseCsv(readFileSync(SRC.scorers[0], "utf8"))
  .map(([date, home, away, tteam, scorer, minute, og, pen]) => ({
    date, home, away, team: tteam, scorer, minute: +minute, og: og === "TRUE", pen: pen === "TRUE",
  }));
const fh = {}; // team -> {fh, total} (own goals scored, regulation only)
const P = {}; // player -> {name, team, goals, pens}
for (const g of scorers) {
  if (g.date < WINDOW_START || !Number.isFinite(g.minute) || g.minute > 90 || g.og) continue;
  const t = normTeam(g.team);
  (fh[t] ??= { fh: 0, total: 0 });
  fh[t].total++;
  if (g.minute <= 45) fh[t].fh++;
  if (g.date >= PLAYER_START) {
    const p = (P[normPlayer(g.scorer)] ??= { name: strip(g.scorer), team: t, goals: 0, pens: 0 });
    p.goals++; if (g.pen) p.pens++;
  }
}
// team matches in the player window (denominator for goals-per-team-match)
const tm4 = {};
for (const m of results) {
  if (m.date < PLAYER_START) continue;
  tm4[normTeam(m.home)] = (tm4[normTeam(m.home)] ?? 0) + 1;
  tm4[normTeam(m.away)] = (tm4[normTeam(m.away)] ?? 0) + 1;
}

// ── assemble ─────────────────────────────────────────────────────────────────
const teamsOut = {};
let muNum = 0, muDen = 0;
for (const [n, t] of Object.entries(T)) {
  if (t.games < 15) continue; // too thin for a prior
  const gfr = t.gf / t.w, gar = t.ga / t.w;
  muNum += gfr; muDen++;
  teamsOut[n] = {
    name: t.name, elo: Math.round(elo[n] ?? 1500), games: t.games,
    gfRate: +gfr.toFixed(3), gaRate: +gar.toFixed(3),
    bttsRate: +(t.btts / t.w).toFixed(3), over25Rate: +(t.o25 / t.w).toFixed(3),
    cleanSheetRate: +(t.cs / t.w).toFixed(3),
    fhShare: fh[n] && fh[n].total >= 20 ? +(fh[n].fh / fh[n].total).toFixed(3) : null,
  };
}
const mu8 = muNum / muDen;
for (const t of Object.values(teamsOut)) {
  t.att = +(t.gfRate / mu8).toFixed(3);
  t.def = +(t.gaRate / mu8).toFixed(3);
}
const playersOut = {};
for (const [k, p] of Object.entries(P)) {
  const g = tm4[p.team] ?? 0;
  if (p.goals < 3 || g < 10) continue;
  playersOut[k] = { name: p.name, team: p.team, goals4y: p.goals, teamGames4y: g, gpg: +(p.goals / g).toFixed(3), penShare: +(p.pens / p.goals).toFixed(2) };
}

writeFileSync(join(DATA, "history.json"), JSON.stringify({
  meta: { window: `${WINDOW_START}..${NOW.toISOString().slice(0, 10)}`, playerWindow: PLAYER_START, mu8: +mu8.toFixed(3), teams: Object.keys(teamsOut).length, players: Object.keys(playersOut).length },
  teams: teamsOut, players: playersOut,
}, null, 2));

console.log(`mu8=${mu8.toFixed(3)} goals/team/match · ${Object.keys(teamsOut).length} teams · ${Object.keys(playersOut).length} players`);
for (const n of ["argentina", "egypt", "switzerland", "colombia", "france", "morocco", "norway", "england", "spain", "belgium"]) {
  const t = teamsOut[n];
  console.log(`${t.name.padEnd(12)} elo=${t.elo} att=${t.att} def=${t.def} btts=${t.bttsRate} o2.5=${t.over25Rate} cs=${t.cleanSheetRate} fh=${t.fhShare}`);
}
for (const k of ["lionelmessi", "kylianmbappe", "erlinghaaland", "harrykane", "mohamedsalah", "breelembolo", "luisdiaz"])
  console.log(k, JSON.stringify(playersOut[k]));
