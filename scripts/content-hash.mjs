#!/usr/bin/env node
// Stable content hash of the GENERATED data files, ignoring volatile timestamps.
// Used by auto-refresh.sh to decide whether a rebuild actually changed any
// score-bearing data — so we only commit (and trigger a Vercel redeploy) on a
// real change, never on a timestamp-only rewrite.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Only the deterministically-generated files — NEVER the hand-curated bet slips
// (bets.json / bets-ruhan.json), which this pipeline must never touch.
const FILES = [
  "data/results.json",
  "data/standings.json",
  "data/stats.json",
  "data/odds.json",
  "data/predictions.json",
];

// Recursively drop keys that change every run without any real data change.
// generatedAt/modelUpdatedAt = build timestamps; ageMin = odds "minutes since
// fetch" freshness, which drifts continuously without any real odds change.
const VOLATILE = new Set([
  "generatedAt",
  "updatedAt",
  "fetchedAt",
  "builtAt",
  "modelUpdatedAt",
  "ageMin",
]);
function strip(v) {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) {
      if (VOLATILE.has(k)) continue;
      out[k] = strip(v[k]);
    }
    return out;
  }
  return v;
}

const h = createHash("sha256");
for (const f of FILES) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(join(root, f), "utf8"));
  } catch {
    raw = null; // missing/unreadable file hashes as null — a later appearance is a real change
  }
  h.update(f + "\n" + JSON.stringify(strip(raw)) + "\n");
}
process.stdout.write(h.digest("hex"));
