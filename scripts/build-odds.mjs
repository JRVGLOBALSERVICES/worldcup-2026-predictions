#!/usr/bin/env node
/**
 * 1xBet odds snapshotter → data/odds.json.
 *
 * Powers the Value Spot (lib/types ValueSpot): real bookmaker prices the model
 * is checked against. 1xBet's LineFeed API is open (no auth) — the only gate is
 * geography: the feed 302→/block any US-flagged egress (which this VPS is). So
 * this script is built to be EGRESS-AGNOSTIC and FAIL-SOFT:
 *
 *   1. Live pull — hit the LineFeed `Get1x2_VZip` (prematch list) on a 1xBet
 *      base reachable from wherever it runs. Configure egress via env:
 *        ONEXBET_BASE   e.g. https://1xbet.com  (default below)
 *        ONEXBET_PROXY  full http(s) proxy URL in a 1xBet-allowed geo (MY/SG/…)
 *      Parse the compact 1X2 + Over/Under coefficients, match each 1xBet event
 *      to our fixture by normalised team names (+ kickoff within 36h).
 *   2. Manual seed — merge data/odds-manual.json (hand-captured real prices,
 *      e.g. off Rj's own slip) for any fixture the live pull didn't fill. Each
 *      entry keeps its honest `source` label.
 *   3. Fail-soft — on geo-block / network error, write nothing new and exit 0
 *      so the deterministic refresh chain (results→standings→stats→odds→
 *      predictions) never breaks. The Value Spot simply shows "no live market"
 *      for un-priced fixtures.
 *
 * Strictly additive: never deletes a previously-captured price; a fresher live
 * price overwrites an older one for the same fixture+source.
 *
 * Usage:
 *   node scripts/build-odds.mjs            # fetch + merge + write data/odds.json
 *   node scripts/build-odds.mjs --check    # report only (exit 2 if it would change)
 */
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "..", "data");
const P = (f) => join(DATA, f);
const CHECK_ONLY = process.argv.includes("--check");

const BASE = (process.env.ONEXBET_BASE || "https://1xbet.com").replace(/\/$/, "");
const PROXY = process.env.ONEXBET_PROXY || "";
const TIMEOUT_MS = 12000;

// ── name normalisation (mirror of build-predictions.mjs / lib/live.ts) ──────
const ALIAS = {
  congodr: "drcongo", drc: "drcongo", korearepublic: "southkorea",
  iranislamicrepublic: "iran", iriran: "iran", turkiye: "turkey", trkiye: "turkey",
  unitedstates: "usa", unitedstatesofamerica: "usa", czechia: "czechrepublic",
  capeverde: "caboverde", cotedivoire: "ivorycoast", bosniaherzegovina: "bosnia",
  curaao: "curacao", republicofkorea: "southkorea", korearep: "southkorea",
  southafricarepublic: "southafrica",
};
const norm = (s) => {
  const a = String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");
  return ALIAS[a] ?? a;
};

// ── load fixtures (to map 1xBet events → our ids) ───────────────────────────
const fixturesRaw = JSON.parse(readFileSync(P("fixtures.json"), "utf8"));
const fixtures = Object.values(fixturesRaw).flat().filter((x) => x && x.id);
const fixByTeams = new Map(); // "homeNorm|awayNorm" → fixture (+ reverse)
for (const f of fixtures) {
  const h = norm(f.home?.name), a = norm(f.away?.name);
  fixByTeams.set(`${h}|${a}`, f);
  fixByTeams.set(`${a}|${h}`, f); // 1xBet may list the sides either way
}

// ── existing odds (additive merge target) ───────────────────────────────────
let prev = { generatedAt: null, source: "1xBet LineFeed", odds: {} };
if (existsSync(P("odds.json"))) {
  try { prev = JSON.parse(readFileSync(P("odds.json"), "utf8")); } catch { /* fresh */ }
}
const odds = { ...(prev.odds || {}) };

// ── live pull ───────────────────────────────────────────────────────────────
async function getJSON(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const opts = {
      signal: ctrl.signal,
      redirect: "manual",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en",
      },
    };
    // Optional proxy in an allowed geo (Node 20+ supports the `dispatcher` via undici, but
    // to stay dependency-free we only honour ONEXBET_PROXY when it's an http(s) CONNECT proxy
    // exported as HTTPS_PROXY by the caller). Documented in REFRESH.md.
    const res = await fetch(url, opts);
    if (res.status >= 300 && res.status < 400) return { blocked: true, reason: `redirect ${res.status} (geo-block)` };
    if (res.status === 203) return { blocked: true, reason: "203 technical/block page (geo-block)" };
    if (!res.ok) return { blocked: true, reason: `HTTP ${res.status}` };
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("json")) {
      const head = (await res.text()).slice(0, 60);
      return { blocked: true, reason: `non-JSON (${ct || "?"}) "${head}…"` };
    }
    return { data: await res.json() };
  } catch (e) {
    return { blocked: true, reason: e.name === "AbortError" ? "timeout" : e.message };
  } finally {
    clearTimeout(t);
  }
}

/** Pull the compact 1X2 + O/U coefficients out of a LineFeed event's `E` array. */
function parseEvent(ev) {
  const E = ev.E || ev.AE?.flatMap((g) => g.ME || []) || [];
  let home, draw, away;
  const totals = {}; // line → { over, under }
  for (const m of E) {
    const T = m.T, C = m.C, Pn = m.P;
    if (m.G === 1 || home === undefined) {
      if (T === 1) home = C; else if (T === 2) draw = C; else if (T === 3) away = C;
    }
    if (T === 9 && Pn != null) (totals[Pn] ??= {}).over = C;   // Over (line P)
    if (T === 10 && Pn != null) (totals[Pn] ??= {}).under = C; // Under (line P)
  }
  const tArr = Object.entries(totals)
    .filter(([, v]) => v.over && v.under)
    .map(([line, v]) => ({ line: Number(line), over: v.over, under: v.under }))
    .sort((a, b) => Math.abs(a.line - 2.5) - Math.abs(b.line - 2.5));
  return { home, draw, away, totals: tArr };
}

/** Match a LineFeed `Value` event array against our fixtures and write odds. */
function ingestEvents(events, stamp, sourceLabel = "1xBet") {
  let matched = 0;
  for (const ev of events) {
    const h = norm(ev.O1 || ev.HomeTeam), a = norm(ev.O2 || ev.AwayTeam);
    const fx = fixByTeams.get(`${h}|${a}`);
    if (!fx) continue;
    // kickoff sanity: 1xBet S is a unix-seconds start; keep if within 36h of ours
    if (ev.S && fx.kickoffUTC) {
      const dh = Math.abs(ev.S * 1000 - new Date(fx.kickoffUTC).getTime()) / 3.6e6;
      if (dh > 36) continue;
    }
    const flipped = norm(ev.O1) === norm(fx.away?.name); // 1xBet listed sides reversed
    const p = parseEvent(ev);
    const h2h = flipped
      ? { home: p.away, draw: p.draw, away: p.home }
      : { home: p.home, draw: p.draw, away: p.away };
    if (!h2h.home || !h2h.draw || !h2h.away) continue;
    odds[fx.id] = {
      source: sourceLabel,
      h2h: { home: round(h2h.home), draw: round(h2h.draw), away: round(h2h.away) },
      ...(p.totals.length ? { totals: p.totals.map((t) => ({ ...t, over: round(t.over), under: round(t.under) })) } : {}),
      capturedAt: stamp,
    };
    matched++;
  }
  return matched;
}

/**
 * Raw-file pull — ingest a LineFeed Get1x2_VZip response Taildropped from an
 * allowed-geo machine (Rj's Malaysia desktop). The PC does the ONE geo-unblocked
 * fetch and `tailscale file cp`s the raw JSON here; the VPS does all parsing.
 * Path via env ONEXBET_RAW_FILE, default /root/blender-incoming/onexbet-raw.json.
 * Honoured only if the file is fresh (mtime within ONEXBET_RAW_MAX_AGE_H, def 12h).
 */
function rawFilePull() {
  const file = process.env.ONEXBET_RAW_FILE || "/root/blender-incoming/onexbet-raw.json";
  if (!existsSync(file)) return { ok: false, reason: "no raw file", count: 0 };
  let stat, data;
  try {
    stat = statSync(file);
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) { return { ok: false, reason: `raw file unreadable: ${e.message}`, count: 0 }; }
  const maxAgeH = Number(process.env.ONEXBET_RAW_MAX_AGE_H || 12);
  const ageH = (Date.now() - stat.mtimeMs) / 3.6e6;
  if (ageH > maxAgeH) return { ok: false, reason: `raw file stale (${ageH.toFixed(1)}h > ${maxAgeH}h)`, count: 0 };
  const events = data?.Value || data?.value || [];
  if (!events.length) return { ok: false, reason: "raw file has no events", count: 0 };
  const matched = ingestEvents(events, new Date(stat.mtimeMs).toISOString(), "1xBet (PC)");
  return { ok: true, count: matched, ageH };
}

async function livePull() {
  // sports=1 → soccer; champ filter omitted so the WC champ events come through.
  const url = `${BASE}/LineFeed/Get1x2_VZip?sports=1&count=600&lng=en&mode=4&country=1&partner=51&getEmpty=true&virtualSports=false`;
  const { data, blocked, reason } = await getJSON(url);
  if (blocked) return { ok: false, reason, count: 0 };
  const events = data?.Value || data?.value || [];
  let matched = 0;
  const stamp = new Date().toISOString();
  for (const ev of events) {
    const h = norm(ev.O1 || ev.HomeTeam), a = norm(ev.O2 || ev.AwayTeam);
    const fx = fixByTeams.get(`${h}|${a}`);
    if (!fx) continue;
    // kickoff sanity: 1xBet S is a unix-seconds start; keep if within 36h of ours
    if (ev.S && fx.kickoffUTC) {
      const dh = Math.abs(ev.S * 1000 - new Date(fx.kickoffUTC).getTime()) / 3.6e6;
      if (dh > 36) continue;
    }
    const flipped = norm(ev.O1) === norm(fx.away?.name); // 1xBet listed sides reversed
    const p = parseEvent(ev);
    const h2h = flipped
      ? { home: p.away, draw: p.draw, away: p.home }
      : { home: p.home, draw: p.draw, away: p.away };
    if (!h2h.home || !h2h.draw || !h2h.away) continue;
    odds[fx.id] = {
      source: "1xBet",
      h2h: { home: round(h2h.home), draw: round(h2h.draw), away: round(h2h.away) },
      ...(p.totals.length ? { totals: p.totals.map((t) => ({ ...t, over: round(t.over), under: round(t.under) })) } : {}),
      capturedAt: stamp,
    };
    matched++;
  }
  return { ok: true, count: matched };
}
const round = (n) => Number(Number(n).toFixed(3));

// ── manual seed merge (real hand-captured prices) ───────────────────────────
function mergeManual() {
  if (!existsSync(P("odds-manual.json"))) return 0;
  let seed;
  try { seed = JSON.parse(readFileSync(P("odds-manual.json"), "utf8")); } catch { return 0; }
  const entries = seed.odds || seed;
  let n = 0;
  for (const [id, val] of Object.entries(entries)) {
    if (!val || !val.h2h) continue;
    // live 1xBet pull wins; manual fills only the gaps (or refreshes a stale manual entry)
    const existing = odds[id];
    if (existing && /^1xBet/.test(existing.source || "") && existing.capturedAt) continue;
    odds[id] = { source: val.source || "manual", h2h: val.h2h, ...(val.totals ? { totals: val.totals } : {}), capturedAt: val.capturedAt || new Date().toISOString() };
    n++;
  }
  return n;
}

// ── run ──────────────────────────────────────────────────────────────────────
// Raw-file pull first — the authoritative real source: Rj's Malaysia desktop
// runs headless Chromium against the 1xBet lite mirror (anti-bot passed by the
// SPA), captures the WC2026 champ Get1x2_VZip feed, and Taildrops the raw JSON
// here. The VPS itself is US-geo-blocked, so livePull() below is kept only as a
// fail-soft path for runs from an allowed geo.
const raw = rawFilePull();
if (raw.ok) console.log(`  raw file (PC, Malaysia): matched ${raw.count} fixture(s) [${raw.ageH.toFixed(1)}h old]`);
else console.log(`  raw file: skipped — ${raw.reason}`);
const live = await livePull();
if (live.ok) console.log(`  live 1xBet: matched ${live.count} fixture(s)`);
else console.log(`  live 1xBet: unreachable — ${live.reason} (fail-soft; using raw + cached + manual)`);
const seeded = mergeManual();
if (seeded) console.log(`  manual seed: filled ${seeded} fixture(s)`);

const out = {
  generatedAt: new Date().toISOString(),
  source: "1xBet LineFeed (Get1x2_VZip) + hand-captured fallback",
  lastLive: live.ok ? new Date().toISOString() : prev.lastLive ?? null,
  liveReachable: live.ok,
  liveNote: live.ok ? `${live.count} matched` : live.reason,
  odds,
};

if (CHECK_ONLY) {
  const changed = JSON.stringify(prev.odds || {}) !== JSON.stringify(odds);
  console.log(changed ? `odds.json WOULD CHANGE (${Object.keys(odds).length} priced).` : "odds.json clean.");
  process.exit(changed ? 2 : 0);
}

writeFileSync(P("odds.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`\nWrote ${Object.keys(odds).length} priced fixture(s) → data/odds.json`);
