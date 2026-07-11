// Game-window gate for the auto-refresh cron.
//
// Rj's rule: only actually refresh (and redeploy) around live matches —
// from 30 min BEFORE kickoff to 30 min AFTER full time. Outside that window
// nothing on the pitch changes, so there's no reason to hammer ESPN or spam
// Vercel redeploys.
//
// Exit 0  => at least one fixture is inside its window right now (refresh).
// Exit 3  => no match near => caller should skip the build chain.
//
// Match length: a knockout game can run 90' + stoppage + extra time +
// penalties, so we budget a generous 150 min of wall-clock from kickoff
// before applying the 30-min post-game tail (end = kickoff + 180 min).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const PRE_MIN = 30;        // start window 30 min before kickoff
const GAME_MIN = 150;      // wall-clock budget for a full match (incl. ET + pens)
const POST_MIN = 30;       // keep refreshing 30 min after full time

const fixtures = JSON.parse(readFileSync(join(DIR, '..', 'data', 'fixtures.json'), 'utf8'));
const now = Date.now();

let live = null;
for (const fx of fixtures) {
  const ko = new Date(fx.kickoffUTC).getTime();
  if (Number.isNaN(ko)) continue;
  const start = ko - PRE_MIN * 60_000;
  const end = ko + (GAME_MIN + POST_MIN) * 60_000;
  if (now >= start && now <= end) { live = fx; break; }
}

if (live) {
  const mins = Math.round((now - new Date(live.kickoffUTC).getTime()) / 60_000);
  const rel = mins < 0 ? `${-mins}m to kickoff` : `${mins}m since kickoff`;
  console.log(`in-window: ${live.id} (${rel})`);
  process.exit(0);
}

console.log('no match in window');
process.exit(3);
