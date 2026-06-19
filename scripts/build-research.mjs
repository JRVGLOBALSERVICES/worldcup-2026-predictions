/**
 * build-research.mjs — pull REAL match research from ESPN's free WC2026 feed.
 *
 * For each fixture this assembles an evidence bundle (no invented odds):
 *   - both squads' last-10 form across all competitions + W/D/L record
 *   - head-to-head history
 *   - top scorers / assist / pass / save leaders
 *   - probable/confirmed lineup availability
 *   - discipline: yellow/red cards from key events
 *
 * Form is pulled from each team's full schedule (scope `all`, so friendlies +
 * qualifiers + Nations League all count), not the 5-game `lastFiveGames` block
 * on the match summary — that block caps at five and only sees one competition.
 *
 * Usage:
 *   node scripts/build-research.mjs <fixtureId>   # one fixture, prints bundle
 *   node scripts/build-research.mjs --all         # every fixture -> data/research.json
 */
import { readFileSync, writeFileSync } from "node:fs";

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world";
const ESPN_ALL = "https://site.api.espn.com/apis/site/v2/sports/soccer/all";
const FIXTURES = new URL("../data/fixtures.json", import.meta.url);
const OUT = new URL("../data/research.json", import.meta.url);

const ALIAS = {
  congodr: "drcongo", drc: "drcongo", korearepublic: "southkorea",
  iranislamicrepublic: "iran", iriran: "iran", turkiye: "turkey", trkiye: "turkey",
  unitedstates: "usa", unitedstatesofamerica: "usa", czechia: "czechrepublic",
  capeverde: "caboverde", cotedivoire: "ivorycoast", bosniaherzegovina: "bosnia",
  curaao: "curacao",
};
const norm = (s) => { const a = String(s).toLowerCase().replace(/[^a-z]/g, ""); return ALIAS[a] ?? a; };
const dateParam = (d) => [d.getUTCFullYear(), String(d.getUTCMonth() + 1).padStart(2, "0"), String(d.getUTCDate()).padStart(2, "0")].join("");

async function getJSON(url) {
  const res = await fetch(url, { headers: { "User-Agent": "matchday-edge/1.0" }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`ESPN ${res.status} ${url}`);
  return res.json();
}

/** Find the ESPN event id for a fixture by team names across its date ±1. */
async function findEventId(f) {
  const base = new Date(f.kickoffUTC);
  const dates = [...new Set([-1, 0, 1].map((o) => dateParam(new Date(base.getTime() + o * 86400000))))];
  const index = new Map();
  for (const dp of dates) {
    let events = [];
    try { events = (await getJSON(`${ESPN}/scoreboard?dates=${dp}`)).events ?? []; } catch { continue; }
    for (const ev of events) {
      const cs = ev.competitions?.[0]?.competitors ?? [];
      const hn = cs.find((c) => c.homeAway === "home")?.team?.displayName;
      const an = cs.find((c) => c.homeAway === "away")?.team?.displayName;
      if (!hn || !an) continue;
      index.set(`${norm(hn)}|${norm(an)}`, ev.id);
      index.set(`${norm(an)}|${norm(hn)}`, ev.id);
    }
  }
  return index.get(`${norm(f.home.name)}|${norm(f.away.name)}`) ?? null;
}

// match an ESPN block ({ team:{displayName} }) to a fixture side by name
const blockFor = (blocks = [], teamName) =>
  blocks.find((b) => norm(b.team?.displayName) === norm(teamName));

/** Resolve ESPN team ids for both sides from the match summary boxscore. */
function teamIdsFrom(summary, f) {
  const teams = summary.boxscore?.teams ?? [];
  const pick = (name) => teams.find((t) => norm(t.team?.displayName) === norm(name))?.team?.id;
  return { home: pick(f.home.name), away: pick(f.away.name) };
}

const num = (v) => (typeof v === "object" ? v?.value ?? v?.displayValue : v);

/**
 * Last-N completed games for one ESPN team id, newest first, with W/D/L record.
 * Reads the `all`-scope schedule so cross-competition form is captured.
 */
async function formForTeamId(teamId, n = 10) {
  if (!teamId) return { line: "—", record: { w: 0, d: 0, l: 0 }, games: [] };
  let events = [];
  try { events = (await getJSON(`${ESPN_ALL}/teams/${teamId}/schedule?season=2026`)).events ?? []; } catch { /* fall through */ }
  if (events.length < 3) {
    try {
      const more = (await getJSON(`${ESPN_ALL}/teams/${teamId}/schedule`)).events ?? [];
      const seen = new Set(events.map((e) => e.id));
      events = [...events, ...more.filter((e) => !seen.has(e.id))];
    } catch { /* ignore */ }
  }

  const done = events
    .map((ev) => ev.competitions?.[0])
    .filter((c) => c?.status?.type?.completed)
    .sort((a, b) => new Date(b.date) - new Date(a.date)); // newest first

  const games = [];
  const record = { w: 0, d: 0, l: 0 };
  for (const c of done.slice(0, n)) {
    const me = c.competitors?.find((x) => x.team?.id === teamId);
    const opp = c.competitors?.find((x) => x.team?.id !== teamId);
    if (!me || !opp) continue;
    const myScore = Number(num(me.score));
    const opScore = Number(num(opp.score));
    let result = "D";
    if (Number.isFinite(myScore) && Number.isFinite(opScore)) {
      result = myScore > opScore ? "W" : myScore < opScore ? "L" : "D";
    } else if (me.winner === true) result = "W";
    else if (opp.winner === true) result = "L";
    record[result.toLowerCase()]++;
    games.push({
      result,
      score: Number.isFinite(myScore) && Number.isFinite(opScore) ? `${myScore}-${opScore}` : (num(me.score) ?? "—"),
      opponent: opp.team?.displayName ?? opp.team?.shortDisplayName ?? "—",
      homeAway: me.homeAway,
      date: (c.date ?? "").slice(0, 10),
      comp: c.leagues?.[0]?.name ?? c.notes?.[0]?.headline ?? null,
    });
  }
  return { line: games.map((g) => g.result).join("") || "—", record, games };
}

function leadersFor(summary, teamName) {
  const block = blockFor(summary.leaders, teamName);
  const out = {};
  for (const cat of block?.leaders ?? []) {
    const top = cat.leaders?.[0];
    if (top?.athlete) out[cat.name] = `${top.athlete.displayName} (${top.displayValue ?? top.value})`;
  }
  return out;
}

function cardsFor(summary) {
  const cards = [];
  for (const kp of summary.keyEvents ?? summary.commentary ?? []) {
    const t = (kp.type?.text || "").toLowerCase();
    if (t.includes("card")) cards.push({ minute: kp.clock?.displayValue, type: kp.type?.text, player: kp.athletesInvolved?.[0]?.displayName });
  }
  return cards;
}

async function research(f) {
  const eventId = await findEventId(f);
  if (!eventId) return { fixtureId: f.id, error: "no ESPN event match" };
  const s = await getJSON(`${ESPN}/summary?event=${eventId}`);
  const ids = teamIdsFrom(s, f);
  const [homeForm, awayForm] = await Promise.all([
    formForTeamId(ids.home, 10),
    formForTeamId(ids.away, 10),
  ]);
  return {
    fixtureId: f.id,
    eventId,
    teamIds: ids,
    form: { home: homeForm, away: awayForm },
    headToHead: (s.headToHeadGames?.[0]?.events ?? []).slice(0, 6).map((g) => ({
      date: g.gameDate?.slice(0, 10), score: g.score, result: g.gameResult,
    })),
    leaders: { home: leadersFor(s, f.home.name), away: leadersFor(s, f.away.name) },
    cards: cardsFor(s),
    lineupStatus: s.rosters?.length ? "available" : "unavailable",
  };
}

async function main() {
  const fixtures = JSON.parse(readFileSync(FIXTURES, "utf8"));
  const arg = process.argv[2];
  if (arg && arg !== "--all") {
    const f = fixtures.find((x) => x.id === arg);
    if (!f) { console.error("fixture not found:", arg); process.exit(1); }
    console.log(JSON.stringify(await research(f), null, 2));
    return;
  }
  const out = {};
  for (const f of fixtures) {
    try { out[f.id] = await research(f); } catch (e) { out[f.id] = { fixtureId: f.id, error: String(e.message) }; }
    process.stderr.write(".");
  }
  writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), research: out }, null, 2));
  console.error(`\nwrote ${OUT.pathname}`);
}
main();
