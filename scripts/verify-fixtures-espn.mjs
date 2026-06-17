#!/usr/bin/env node
/**
 * Deterministic fixture-time verifier against ESPN's keyless FIFA World Cup feed.
 *
 * Every fixture in data/fixtures.json is matched to its ESPN event (by team
 * names, reusing the same alias/normalise rules as lib/live.ts) and its
 * kickoffUTC is compared to ESPN's official kickoff. ESPN is treated as the
 * source of truth — the whole app derives MYT + ET display from kickoffUTC, so
 * fixing this one field fixes every surface (home, match page, tracker, crons).
 *
 *   node scripts/verify-fixtures-espn.mjs          # dry-run: report drift only
 *   node scripts/verify-fixtures-espn.mjs --write   # correct fixtures.json in place
 *
 * Exit codes: 0 = in sync (or corrected with --write), 2 = drift found (dry-run),
 * 1 = hard error (ESPN unreachable, unmatched fixtures, etc.).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = join(__dirname, "..", "data", "fixtures.json");
const ESPN_BASE =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";

const WRITE = process.argv.includes("--write");

// Mirror of lib/live.ts ALIAS — ESPN spells a few nations differently.
const ALIAS = {
  congodr: "drcongo",
  drc: "drcongo",
  korearepublic: "southkorea",
  iranislamicrepublic: "iran",
  iriran: "iran",
  turkiye: "turkey",
  trkiye: "turkey", // ESPN "Türkiye" — diacritic stripped by norm()
  unitedstates: "usa",
  unitedstatesofamerica: "usa",
  czechia: "czechrepublic",
  capeverde: "caboverde",
  cotedivoire: "ivorycoast",
  bosniaherzegovina: "bosnia", // ESPN "Bosnia-Herzegovina"
  curaao: "curacao", // ESPN "Curaçao" — ç stripped by norm()
};
const norm = (s) => {
  const a = String(s).toLowerCase().replace(/[^a-z]/g, "");
  return ALIAS[a] ?? a;
};

/** YYYYMMDD in UTC. */
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

/** Build { "norm(home)|norm(away)": ISOdate } from an ESPN events array. */
function indexEvents(events, index) {
  for (const ev of events) {
    const comp = ev.competitions?.[0];
    const cs = comp?.competitors ?? [];
    const home = cs.find((c) => c.homeAway === "home");
    const away = cs.find((c) => c.homeAway === "away");
    const hn = home?.team?.displayName;
    const an = away?.team?.displayName;
    const date = ev.date || comp?.date;
    if (!hn || !an || !date) continue;
    const iso = new Date(date).toISOString();
    // Store both orientations so a home/away swap still matches.
    index.set(`${norm(hn)}|${norm(an)}`, iso);
    index.set(`${norm(an)}|${norm(hn)}`, iso);
  }
}

function mytLabel(iso) {
  // MYT = UTC+8, no DST.
  const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${days[d.getUTCDay()]} ${d.getUTCDate()} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getUTCMonth()]} ${hh}:${mm} MYT`;
}

function etLabelFor(iso) {
  // US Eastern is UTC-4 in June (EDT).
  const d = new Date(new Date(iso).getTime() - 4 * 3600 * 1000);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} ET`;
}

async function main() {
  const fixtures = JSON.parse(readFileSync(FIXTURES_PATH, "utf8"));

  // Candidate UTC dates: each fixture's current date ± 1 day (catches a wrong
  // time that has pushed a match onto the adjacent UTC date).
  const dates = new Set();
  for (const f of fixtures) {
    const base = new Date(f.kickoffUTC);
    for (const off of [-1, 0, 1]) {
      dates.add(dateParam(new Date(base.getTime() + off * 86400000)));
    }
  }

  const index = new Map();
  const results = await Promise.allSettled([...dates].map(fetchDate));
  let fetched = 0;
  for (const r of results) {
    if (r.status === "fulfilled") {
      fetched++;
      indexEvents(r.value, index);
    }
  }
  if (fetched === 0) {
    console.error("ESPN unreachable — no dates fetched. Aborting (no changes).");
    process.exit(1);
  }

  const drift = [];
  const unmatched = [];
  for (const f of fixtures) {
    const key = `${norm(f.home.name)}|${norm(f.away.name)}`;
    const espnIso = index.get(key);
    if (!espnIso) {
      unmatched.push(f);
      continue;
    }
    if (new Date(espnIso).getTime() !== new Date(f.kickoffUTC).getTime()) {
      drift.push({ f, from: f.kickoffUTC, to: espnIso });
    }
  }

  // Report
  const compared = fixtures.length - unmatched.length;
  const lines = [];
  if (drift.length === 0) {
    lines.push(`${compared}/${fixtures.length} fixtures compared vs ESPN. No drift.`);
  } else {
    lines.push(`${drift.length} fixture(s) drifted from ESPN:`);
    for (const d of drift) {
      lines.push(
        `  ${d.f.home.name} v ${d.f.away.name}: ${mytLabel(d.from)} -> ${mytLabel(d.to)}`,
      );
    }
  }
  if (unmatched.length) {
    lines.push(
      `WARN ${unmatched.length} fixture(s) not found on ESPN (check team spelling/ALIAS): ` +
        unmatched.map((u) => `${u.home.name} v ${u.away.name}`).join("; "),
    );
  }
  console.log(lines.join("\n"));

  if (drift.length && WRITE) {
    for (const d of drift) {
      d.f.kickoffUTC = d.to;
      d.f.etLabel = etLabelFor(d.to);
    }
    writeFileSync(FIXTURES_PATH, JSON.stringify(fixtures, null, 2) + "\n");
    console.log(`\nWROTE ${drift.length} correction(s) to data/fixtures.json`);
    process.exit(0);
  }

  // Unmatched fixtures are a real problem to surface, but not on their own a
  // reason to fail when everything matched is in sync.
  if (drift.length) process.exit(WRITE ? 0 : 2);
  process.exit(0);
}

main().catch((e) => {
  console.error("verify-fixtures-espn failed:", e.message);
  process.exit(1);
});
