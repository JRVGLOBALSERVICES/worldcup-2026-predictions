#!/usr/bin/env node
/**
 * Group standings, snapshotted from ESPN's AUTHORITATIVE standings endpoint into
 * data/standings.json so the /standings page renders the real tournament table —
 * not one re-derived from our local fixtures list.
 *
 *   node scripts/build-standings.mjs            # write data/standings.json
 *   node scripts/build-standings.mjs --check     # report only (exit 2 on change)
 *
 * Why not compute from data/results.json (like the page used to)?  Our fixtures
 * table is a hand-maintained projection and drifts from the real schedule — ESPN
 * had 60 group games played while our list knew 40, so France/Norway showed one
 * win instead of two.  ESPN's standings endpoint already applies the full FIFA
 * tiebreak chain (points → GD → GF → head-to-head → fair-play) and carries the
 * official "advance" note + colour per row, so we mirror it verbatim and only
 * add newest-first W/D/L form computed from the same feed's finished matches.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STANDINGS_PATH = join(__dirname, "..", "data", "standings.json");
const FIXTURES_SRC = join(__dirname, "build-fixtures.mjs");

const ESPN_STANDINGS =
  "https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings";
const ESPN_BASE =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";

const CHECK_ONLY = process.argv.includes("--check");

// Reuse the EXACT flag emoji set from build-fixtures.mjs (single source of truth).
const FLAGS = (() => {
  const src = readFileSync(FIXTURES_SRC, "utf8");
  const block = src.match(/const FLAGS = \{([\s\S]*?)\};/)[1];
  const map = {};
  // eslint-disable-next-line no-eval
  const obj = eval("({" + block + "})");
  for (const [k, v] of Object.entries(obj)) map[norm(k)] = v;
  return map;
})();

function norm(s) {
  return (s || "").toLowerCase().replace(/[^a-z]/g, "");
}

// ESPN spells a few nations differently from our table — map both to our flag key.
const NAME_ALIAS = {
  bosniaherzegovina: "bosnia",
  trkiye: "turkiye",
  turkey: "turkiye",
  curaao: "curacao",
  unitedstates: "usa",
  unitedstatesofamerica: "usa",
  congodr: "drcongo",
  drc: "drcongo",
  korearepublic: "southkorea",
  iranislamicrepublic: "iran",
  czechia: "czechia",
  capeverde: "capeverde",
  cotedivoire: "ivorycoast",
};
const key = (name) => {
  const n = norm(name);
  return NAME_ALIAS[n] || n;
};

// Display names: keep ESPN's, but normalise the few we render shorter.
const DISPLAY = {
  "Bosnia-Herzegovina": "Bosnia",
  "United States": "USA",
  Türkiye: "Turkiye",
};

const flagFor = (name) => FLAGS[key(name)] || "🏳️";

const dateParam = (d) => {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
};

async function fetchJson(url) {
  const r = await fetch(url, { headers: { "user-agent": "matchday-edge/standings" } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

// Sweep the tournament window once to build newest-first W/D/L form per team.
async function buildForm() {
  const dates = [];
  for (let d = 11; d <= 30; d++)
    dates.push(dateParam(new Date(Date.UTC(2026, 5, d))));
  const batches = await Promise.allSettled(
    dates.map((dt) => fetchJson(`${ESPN_BASE}?dates=${dt}`)),
  );
  const matches = [];
  for (const b of batches) {
    if (b.status !== "fulfilled") continue;
    for (const ev of b.value.events || []) {
      if (ev.status?.type?.state !== "post") continue;
      const cs = ev.competitions?.[0]?.competitors || [];
      const h = cs.find((c) => c.homeAway === "home");
      const a = cs.find((c) => c.homeAway === "away");
      if (!h || !a) continue;
      matches.push({
        date: ev.date,
        home: key(h.team.displayName),
        away: key(a.team.displayName),
        hs: Number(h.score),
        as: Number(a.score),
      });
    }
  }
  matches.sort((x, y) => x.date.localeCompare(y.date));
  const form = {}; // teamKey -> ["W","D","L"...] oldest-first
  const push = (t, r) => (form[t] = [...(form[t] || []), r]);
  for (const m of matches) {
    if (m.hs > m.as) {
      push(m.home, "W");
      push(m.away, "L");
    } else if (m.as > m.hs) {
      push(m.home, "L");
      push(m.away, "W");
    } else {
      push(m.home, "D");
      push(m.away, "D");
    }
  }
  return form;
}

function statOf(entry, name) {
  const s = (entry.stats || []).find((x) => x.name === name);
  return s ? Number(s.value) : 0;
}

// Map ESPN's per-date season slug to the short round badge we show.
const ROUND_LABEL = {
  "group-stage": "Group",
  "round-of-32": "Round of 32",
  "round-of-16": "Round of 16",
  quarterfinals: "Quarter-final",
  semifinals: "Semi-final",
  "third-place": "Third place",
  final: "Final",
};

// A knockout slot ESPN hasn't resolved yet ("Third Place Group C/E/F/H/I",
// "Group I Winner", "Group K 2nd Place") — no real nation, so no flag. Shorten
// the verbose ESPN label to something that fits a chip.
function placeholderOpponent(displayName) {
  if (!/group|winner|place|round of/i.test(displayName)) return null;
  return displayName
    .replace(/^Third Place Group\s*/i, "3rd: ")
    .replace(/^Group\s+([A-L])\s+Winner$/i, "Winner Grp $1")
    .replace(/^Group\s+([A-L])\s+2nd Place$/i, "2nd Grp $1")
    .replace(/^Round of 32\s+(\d+)\s+Winner$/i, "R32-$1 Winner")
    .replace(/^Round of 16\s+(\d+)\s+Winner$/i, "R16-$1 Winner");
}

/**
 * Each team's NEXT scheduled game, mirrored from the same ESPN scoreboard feed:
 * sweep every not-yet-played fixture from today through the final and, per team,
 * keep the earliest one they appear in. Group teams resolve to their last group
 * match; advanced teams resolve to a concrete Round-of-32 tie (or an unresolved
 * placeholder slot when the bracket position isn't filled yet). Returns a map of
 * teamKey -> { round, opponent, opponentFlag, kickoffUTC, home, placeholder }.
 */
async function buildNextMatches() {
  const dates = [];
  for (let d = 11; d <= 30; d++)
    dates.push(dateParam(new Date(Date.UTC(2026, 5, d))));
  for (let d = 1; d <= 19; d++)
    dates.push(dateParam(new Date(Date.UTC(2026, 6, d))));

  const batches = await Promise.allSettled(
    dates.map((dt) => fetchJson(`${ESPN_BASE}?dates=${dt}`)),
  );

  const next = {}; // teamKey -> fixture (earliest pre match)
  const consider = (teamKey, fixture) => {
    const cur = next[teamKey];
    if (!cur || fixture.kickoffUTC < cur.kickoffUTC) next[teamKey] = fixture;
  };

  for (const b of batches) {
    if (b.status !== "fulfilled") continue;
    const round = ROUND_LABEL[b.value.events?.[0]?.season?.slug] || "Group";
    for (const ev of b.value.events || []) {
      // Only games not yet played count as a "next" fixture.
      if (ev.status?.type?.state !== "pre") continue;
      const cs = ev.competitions?.[0]?.competitors || [];
      const h = cs.find((c) => c.homeAway === "home");
      const a = cs.find((c) => c.homeAway === "away");
      if (!h || !a) continue;

      const rnd = ROUND_LABEL[ev.season?.slug] || round;
      const sides = [
        [h, a, true],
        [a, h, false],
      ];
      for (const [self, opp, home] of sides) {
        const ph = placeholderOpponent(opp.team.displayName);
        if (placeholderOpponent(self.team.displayName)) continue; // skip placeholder rows
        consider(key(self.team.displayName), {
          round: rnd,
          opponent: ph || DISPLAY[opp.team.displayName] || opp.team.displayName,
          opponentFlag: ph ? null : flagFor(opp.team.displayName),
          kickoffUTC: ev.date,
          home,
          placeholder: Boolean(ph),
        });
      }
    }
  }
  return next;
}

async function main() {
  const [standings, form, nextMatches] = await Promise.all([
    fetchJson(ESPN_STANDINGS),
    buildForm(),
    buildNextMatches(),
  ]);

  const groups = [];
  for (const child of standings.children || []) {
    const letter = (child.name || "").replace(/^Group\s+/i, "").trim();
    const entries = (child.standings?.entries || []).slice();
    // ESPN already ranks with the full FIFA tiebreak chain — preserve its order.
    entries.sort((a, b) => statOf(a, "rank") - statOf(b, "rank"));

    let played = 0;
    const rows = entries.map((e) => {
      const name = e.team.displayName;
      const gp = statOf(e, "gamesPlayed");
      played += gp;
      const note = e.note || {};
      return {
        name: DISPLAY[name] || name,
        flag: flagFor(name),
        played: gp,
        won: statOf(e, "wins"),
        drawn: statOf(e, "ties"),
        lost: statOf(e, "losses"),
        goalsFor: statOf(e, "pointsFor"),
        goalsAgainst: statOf(e, "pointsAgainst"),
        goalDiff: statOf(e, "pointDifferential"),
        points: statOf(e, "points"),
        rank: statOf(e, "rank"),
        advance: note.description
          ? { label: note.description, color: note.color || null }
          : null,
        form: (form[key(name)] || []).slice(-5).reverse(),
        next: nextMatches[key(name)] || null,
      };
    });

    groups.push({
      group: letter,
      total: 6, // four teams → six round-robin games per group
      played: Math.round(played / 2),
      rows,
    });
  }
  groups.sort((a, b) => a.group.localeCompare(b.group));

  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      source: "ESPN keyless FIFA World Cup standings endpoint (authoritative)",
      groups: groups.length,
    },
    groups,
  };

  let prev = "";
  try {
    prev = readFileSync(STANDINGS_PATH, "utf8");
  } catch {
    /* first run */
  }
  const prevGroups = prev ? JSON.stringify(JSON.parse(prev).groups) : "";
  const changed = prevGroups !== JSON.stringify(groups);

  if (CHECK_ONLY) {
    console.log(changed ? "Standings changed." : "No standings change.");
    process.exit(changed ? 2 : 0);
  }

  writeFileSync(STANDINGS_PATH, JSON.stringify(payload, null, 2) + "\n");
  const counted = groups.reduce((n, g) => n + g.played, 0);
  console.log(
    `Standings: ${groups.length} groups, ${counted} group games counted${changed ? "" : " (no change; refreshed timestamp)"}.`,
  );
}

main().catch((e) => {
  console.error("build-standings failed:", e.message);
  process.exit(1);
});
