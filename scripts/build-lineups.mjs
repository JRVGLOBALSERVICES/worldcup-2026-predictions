#!/usr/bin/env node
/**
 * Deterministic line-up snapshotter against ESPN's keyless FIFA World Cup feed.
 *
 * The predictions in data/predictions.json carry a *probable* XI as a hand-written
 * name string (no real shirt numbers, no real formation). Once ESPN publishes the
 * official team sheet (~1h before kickoff), its per-event `summary` endpoint
 * exposes the confirmed XI with REAL jersey numbers, positions and the actual
 * formation. This script pulls that and writes a structured `homeXI` / `awayXI`
 * into each prediction so the formation board renders truth, not inference.
 *
 *   node scripts/build-lineups.mjs           # write data/predictions.json
 *   node scripts/build-lineups.mjs --check    # report only, no write (exit 2 on change)
 *
 * Reuses the exact ALIAS/normalise + home/away re-orientation rules as lib/live.ts.
 * Strictly additive per match: a confirmed XI overwrites that match's XI fields and
 * the name strings + bumps status to "confirmed"; matches with no published sheet
 * are left exactly as they were (probable strings intact).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = join(__dirname, "..", "data", "fixtures.json");
const PRED_PATH = join(__dirname, "..", "data", "predictions.json");
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

async function fetchSummary(eventId) {
  const res = await fetch(`${ESPN_SUMMARY}?event=${eventId}`, {
    headers: { "User-Agent": "matchday-edge/1.0" },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`ESPN summary ${res.status} for ${eventId}`);
  return res.json();
}

/**
 * Build a structured XI for one team from an ESPN roster block, or null if the
 * sheet isn't published yet. ESPN lists the roster position-grouped (G → D → M →
 * F); we keep exactly the 11 starters in that order so the web pitch can chunk
 * them by the formation's row sizes. Numbers + formation are ESPN's real values.
 */
function teamXI(rosterTeam) {
  if (!rosterTeam) return null;
  const starters = (rosterTeam.roster ?? []).filter((p) => p.starter);
  if (starters.length < 11) return null; // sheet not confirmed yet

  // GK first (defensive — ESPN already orders it so), then the rest as listed.
  const ordered = [
    ...starters.filter((p) => (p.position?.abbreviation ?? "") === "G"),
    ...starters.filter((p) => (p.position?.abbreviation ?? "") !== "G"),
  ];

  const players = ordered.map((p) => {
    const num = parseInt(p.jersey ?? p.athlete?.jersey ?? "", 10);
    return {
      num: Number.isFinite(num) ? num : null,
      name: p.athlete?.displayName ?? p.athlete?.fullName ?? "Unknown",
      pos: p.position?.abbreviation ?? "",
    };
  });

  const formation =
    typeof rosterTeam.formation === "string" && /^\d(-\d){1,3}$/.test(rosterTeam.formation)
      ? rosterTeam.formation
      : players
          .slice(1)
          .reduce(
            (acc, p) => {
              acc[p.pos === "D" ? 0 : p.pos === "F" ? 2 : 1]++;
              return acc;
            },
            [0, 0, 0],
          )
          .filter((n) => n > 0)
          .join("-");

  return { formation, players };
}

/** Both XIs for a fixture, oriented to OUR home/away, or null if not published. */
function lineupsFromSummary(summary, fixture) {
  const rosters = summary?.rosters;
  if (!Array.isArray(rosters) || rosters.length < 2) return null;

  const ourHome = norm(fixture.home.name);
  const byOurSide = {};
  for (const t of rosters) {
    const side = norm(t.team?.displayName) === ourHome ? "home" : "away";
    byOurSide[side] = t;
  }
  const homeXI = teamXI(byOurSide.home);
  const awayXI = teamXI(byOurSide.away);
  if (!homeXI || !awayXI) return null;
  return { homeXI, awayXI };
}

async function main() {
  const fixtures = JSON.parse(readFileSync(FIXTURES_PATH, "utf8"));
  const predFile = JSON.parse(readFileSync(PRED_PATH, "utf8"));
  const preds = predFile.predictions ?? {};

  // Only fixtures we actually predict are worth a lookup, and only around their
  // kickoff window (today + the day before, for ESPN's US-date bucketing).
  const wanted = fixtures.filter((f) => preds[f.id]);
  const dates = new Set();
  for (const f of wanted) {
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

  // Index events both orientations → event id.
  const index = new Map();
  for (const ev of events) {
    const cs = ev.competitions?.[0]?.competitors ?? [];
    const h = cs.find((c) => c.homeAway === "home")?.team?.displayName;
    const a = cs.find((c) => c.homeAway === "away")?.team?.displayName;
    if (!h || !a) continue;
    index.set(`${norm(h)}|${norm(a)}`, ev.id);
    index.set(`${norm(a)}|${norm(h)}`, ev.id);
  }

  // Resolve each wanted fixture to an event id, fetch summaries in parallel.
  const targets = wanted
    .map((f) => ({ f, eventId: index.get(`${norm(f.home.name)}|${norm(f.away.name)}`) }))
    .filter((t) => t.eventId);
  const summaries = await Promise.allSettled(targets.map((t) => fetchSummary(t.eventId)));

  const before = JSON.stringify(preds);
  let confirmed = 0;
  targets.forEach((t, i) => {
    const b = summaries[i];
    if (b.status !== "fulfilled") return;
    const xis = lineupsFromSummary(b.value, t.f);
    if (!xis) return;
    const pred = preds[t.f.id];
    if (!pred?.lineups) return;
    // Real sheet wins: structured XI + refreshed name strings + confirmed status.
    pred.lineups.homeXI = xis.homeXI;
    pred.lineups.awayXI = xis.awayXI;
    pred.lineups.home = xis.homeXI.players.map((p) => p.name).join(", ");
    pred.lineups.away = xis.awayXI.players.map((p) => p.name).join(", ");
    pred.lineups.status = "confirmed";
    confirmed++;
  });

  const changed = JSON.stringify(preds) !== before;
  console.log(`Line-ups: ${confirmed} confirmed XI(s) resolved from ESPN across ${targets.length} match(es) in window.`);

  if (CHECK_ONLY) {
    console.log(changed ? "predictions.json CHANGED (use without --check to write)." : "predictions.json clean.");
    process.exit(changed ? 2 : 0);
  }
  if (!changed) {
    console.log("No confirmed XI changes; nothing written.");
    return;
  }
  writeFileSync(PRED_PATH, JSON.stringify(predFile, null, 2) + "\n");
  console.log(`Wrote ${PRED_PATH}`);
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
