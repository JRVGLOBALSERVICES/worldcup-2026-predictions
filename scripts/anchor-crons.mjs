#!/usr/bin/env node
// anchor-crons.mjs — retime the WC2026 bridge crons to be GAME-ANCHORED.
//
// Rj's rule (semis/final phase): stop all-day polling. Only pull line-ups
// ~30 min BEFORE each match, and settle stats ~30 min AFTER each match ends.
//
// This reads data/fixtures.json + data/results.json, works out the kick-off
// hours (Asia/Kuala_Lumpur, UTC+8, no DST) of the matches in the next ~40h,
// and PATCHes the two polling crons to fire only in the pre-match and
// post-match windows. On a day with NO matches it disables them entirely.
// Run daily (wired into the fixture-time-check cron) so the semi-final and
// final auto-anchor the moment their fixtures are dated — no hardcoding.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = process.env.SCHED_API || 'http://localhost:7777';
const TOKEN = process.env.API_TOKEN || process.env.WA_API_TOKEN || '';

// Bridge cron ids (stable — created once, we only edit their schedules).
const LINEUP_CRON = 'abe86726-4e66-4a96-8a60-cdd6e7232292'; // in-depth on line-up release
const SETTLE_CRON = '1272e11d-da9a-4f09-8d12-f046bcc62929'; // result settlement + stats

const KL_OFFSET = 8; // UTC+8, no DST
const klHour = (ms) => Math.floor(((new Date(ms).getUTCHours() + KL_OFFSET) % 24 + 24) % 24);

function readJson(p) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
}

function main() {
  const fx = readJson('data/fixtures.json');
  const fixtures = Array.isArray(fx) ? fx : (fx.matches || fx.fixtures || []);
  let finished = new Set();
  try {
    const rj = readJson('data/results.json');
    const R = rj.results || rj || {};
    finished = new Set(Object.entries(R).filter(([, v]) => v && v.finished).map(([k]) => k));
  } catch { /* results.json may not exist yet */ }

  const now = Date.now();
  const H = 3600e3;
  const lineupHours = new Set();
  const settleHours = new Set();

  for (const m of fixtures) {
    const t = Date.parse(m.kickoffUTC || m.kickoff || m.date || '');
    if (isNaN(t)) continue;
    const done = finished.has(m.id);

    // LINE-UPS: fire ~30-60 min before kick-off. Match must be upcoming
    // (kick-off within the next 40h) and not already finished.
    if (!done && t > now && t < now + 40 * H) {
      lineupHours.add(klHour(t - H));  // up to 60 min before
      lineupHours.add(klHour(t));       // through kick-off
    }

    // SETTLE + STATS: fire ~30 min after the match ENDS — never mid-match
    // (a mid-match fire would redeploy on live-stat drift, the churn we're
    // killing). Regulation ends ~kick-off+2h15; knockout extra-time+pens can
    // push to ~+3h15. Start at +3h (safely post-match even after ET) through
    // +4h. Keep for matches that ended in the last ~5h too, so a just-
    // finished match still gets its post-match settle.
    if (t > now - 5 * H && t < now + 40 * H) {
      settleHours.add(klHour(t + 3 * H));
      settleHours.add(klHour(t + 4 * H));
    }
  }

  const cronFrom = (hours) => {
    const hs = [...hours].sort((a, b) => a - b);
    return `0,30 ${hs.join(',')} * * *`;
  };

  const patches = [];
  if (lineupHours.size)
    patches.push([LINEUP_CRON, 'line-up pull', { schedule: cronFrom(lineupHours), enabled: true }]);
  else
    patches.push([LINEUP_CRON, 'line-up pull', { schedule: '0 4 * * *', enabled: false }]);

  if (settleHours.size)
    patches.push([SETTLE_CRON, 'settle+stats', { schedule: cronFrom(settleHours), enabled: true }]);
  else
    patches.push([SETTLE_CRON, 'settle+stats', { schedule: '0 4 * * *', enabled: false }]);

  return patches;
}

async function apply(patches) {
  const lines = [];
  for (const [id, label, patch] of patches) {
    const r = await fetch(`${API}/api/scheduled/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
      body: JSON.stringify(patch),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || !body.ok) {
      lines.push(`FAIL ${label}: HTTP ${r.status} ${JSON.stringify(body)}`);
    } else {
      lines.push(`${label}: ${patch.enabled ? patch.schedule : 'DISABLED (no matches)'}`);
    }
  }
  return lines;
}

const patches = main();
const lines = await apply(patches);
console.log('WC2026 cron anchor —');
for (const l of lines) console.log('  ' + l);
if (lines.some((l) => l.startsWith('FAIL'))) process.exit(1);
