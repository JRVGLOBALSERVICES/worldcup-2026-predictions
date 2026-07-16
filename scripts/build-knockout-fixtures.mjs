/**
 * build-knockout-fixtures.mjs — materialise the knockout-bracket fixtures.
 *
 * The group-stage table in build-fixtures.mjs is hand-written and ends at
 * matchday 3. Once the groups resolve, the knockout ties (Round of 32 → Final)
 * become concrete on ESPN's public scoreboard feed. This script pulls those
 * authoritative ties — teams, venue, city, kickoff — and merges them into
 * data/fixtures.json so every page (schedule, match detail, predictions engine)
 * treats a knockout match exactly like a group match, just carrying a `round`
 * label instead of a group letter.
 *
 * Strictly additive: existing group-stage fixtures are preserved untouched; any
 * previously-written knockout fixtures are replaced with the fresh feed so a
 * re-run stays idempotent as later rounds resolve.
 *
 * Run AFTER build-standings.mjs and BEFORE build-predictions.mjs.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const P = (f) => join(__dir, "..", "data", f);

const ESPN_BASE =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";

// ── name normalisation (mirror of build-predictions.mjs) ────────────────────
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

// Knockout-round slug → display label.
const ROUND_LABEL = {
  "round-of-32": "Round of 32",
  "round-of-16": "Round of 16",
  "quarterfinals": "Quarter-final",
  "quarter-finals": "Quarter-final",
  "semifinals": "Semi-final",
  "semi-finals": "Semi-final",
  "third-place": "Third-place play-off",
  "final": "Final",
};
const isKnockoutSlug = (slug) =>
  /round-of|quarter|semi|third-place|^final$/i.test(slug || "");

/**
 * Merge hand-added knockout ties from data/fixtures-manual.json.
 *
 * ESPN only publishes a knockout tie once its slot resolves (both teams known).
 * A bet slip can reference a tie before that — e.g. a third-place play-off whose
 * semis haven't been played — and the slip needs a fixture to render a match
 * header and grade against. This cron rebuilds fixtures.json every tick, keeping
 * only group games (`!f.round`) plus the fresh ESPN knockout feed, so any manual
 * knockout entry is stripped on the next run. This seed survives that: it is
 * re-merged here, deduped by id, so the moment ESPN publishes the real tie (same
 * id) the authoritative entry wins and the manual stub is dropped automatically.
 * Mirrors the odds-manual.json seed pattern in build-odds.mjs.
 */
function mergeManual(merged) {
  const path = P("fixtures-manual.json");
  if (!existsSync(path)) return merged;
  let seed;
  try {
    seed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return merged; // malformed seed never breaks the build
  }
  const ids = new Set(merged.map((f) => f.id));
  const add = (Array.isArray(seed) ? seed : []).filter((f) => f?.id && !ids.has(f.id));
  if (add.length) {
    console.log(
      `fixtures-manual seed: +${add.length}`,
      add.map((f) => `${f.round} · ${f.home?.name} v ${f.away?.name}`).join(", "),
    );
  }
  return [...merged, ...add];
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

/** YYYYMMDD (UTC) list spanning the whole knockout window. */
function knockoutDates() {
  // 28 Jun → 20 Jul 2026 covers R32 through the Final with margin.
  const out = [];
  const start = Date.UTC(2026, 5, 28); // months are 0-based → 5 = June
  const end = Date.UTC(2026, 6, 20);
  for (let t = start; t <= end; t += 86400000) {
    const d = new Date(t);
    out.push(
      `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(
        d.getUTCDate(),
      ).padStart(2, "0")}`,
    );
  }
  return out;
}

const etLabel = (iso) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso)) + " ET";

const ymd = (iso) => new Date(iso).toISOString().slice(0, 10);

async function main() {
  const fixturesRaw = JSON.parse(readFileSync(P("fixtures.json"), "utf8"));
  const existing = Array.isArray(fixturesRaw) ? fixturesRaw : [];
  const standings = JSON.parse(readFileSync(P("standings.json"), "utf8"));

  // norm(name) → emoji flag, lifted from the authoritative standings rows.
  const flagOf = {};
  for (const g of standings.groups ?? [])
    for (const r of g.rows ?? []) flagOf[norm(r.name)] = r.flag;

  const dates = knockoutDates();
  const feeds = await Promise.all(
    dates.map((dt) => fetchJson(`${ESPN_BASE}?dates=${dt}`).catch(() => null)),
  );

  const knockout = [];
  const seen = new Set();
  for (const feed of feeds) {
    for (const e of feed?.events ?? []) {
      const slug = e.season?.slug || "";
      if (!isKnockoutSlug(slug)) continue;
      const c = e.competitions?.[0];
      if (!c) continue;
      const h = c.competitors?.find((x) => x.homeAway === "home");
      const a = c.competitors?.find((x) => x.homeAway === "away");
      if (!h?.team || !a?.team) continue;

      const hName = h.team.displayName;
      const aName = a.team.displayName;
      // Skip unresolved placeholder ties (ESPN labels them e.g. "Winner …").
      if (/winner|runner|group|place/i.test(hName + aName)) continue;

      const iso = new Date(e.date).toISOString();
      const id = `${(h.team.abbreviation || norm(hName)).toLowerCase()}-${(
        a.team.abbreviation || norm(aName)
      ).toLowerCase()}-${ymd(iso)}`;
      if (seen.has(id)) continue;
      seen.add(id);

      knockout.push({
        id,
        group: "", // knockout ties carry no group letter
        round: ROUND_LABEL[slug] || slug,
        home: { name: hName, flag: flagOf[norm(hName)] || "🏳️" },
        away: { name: aName, flag: flagOf[norm(aName)] || "🏳️" },
        venue: c.venue?.fullName || "TBC",
        city:
          [c.venue?.address?.city, c.venue?.address?.state]
            .filter(Boolean)
            .join(", ") || "TBC",
        kickoffUTC: iso,
        etLabel: etLabel(iso),
      });
    }
  }

  knockout.sort((x, y) => x.kickoffUTC.localeCompare(y.kickoffUTC));

  // Keep only the group-stage fixtures from the existing file, then append the
  // freshly-resolved knockout ties.
  const groupStage = existing.filter((f) => !f.round);
  const merged = mergeManual([...groupStage, ...knockout]);

  writeFileSync(P("fixtures.json"), JSON.stringify(merged, null, 2) + "\n");

  const byRound = {};
  for (const k of knockout) byRound[k.round] = (byRound[k.round] || 0) + 1;
  console.log(
    `fixtures.json: ${groupStage.length} group + ${knockout.length} knockout`,
    JSON.stringify(byRound),
  );
  for (const k of knockout)
    console.log(`  ${k.round} · ${k.kickoffUTC} · ${k.home.name} v ${k.away.name}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
