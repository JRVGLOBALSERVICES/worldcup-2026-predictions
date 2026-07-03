// One-off: append Rj's 03/07 slip 83910897465 to data/bets.json — a REAL
// image-confirmed 1xBet 3-fold accumulator (RM50 @ 16.733 -> RM836.70).
// Placed 03/07 16:22. Odds check: 1.122 * 3.635 * 3.73 * 1.1 (acca bonus) = 16.73 ✓.
//
// All three legs are Asian lines (quarter). The grader treats quarter lines
// directionally (strictly cover -> won, behind -> lost; whole-line exact ===
// pushes). No half-win/half-loss split — the established convention in this repo.
//
//   Leg 1  Aus/Egy  Total Over 0.75            @ 1.122 -> totalOver(0.75)
//   Leg 2  Arg/CpV  Handicap 1 (-3.25)         @ 3.635 -> handicap(home, -3.25)  [Argentina -3.25]
//   Leg 3  Col/Gha  Handicap 2 (+0.25)         @ 3.73  -> handicap(away,  0.25)  [Ghana +0.25]
//
// Idempotent by slipNo.
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";

const path = new URL("../data/bets.json", import.meta.url);
const b = JSON.parse(readFileSync(path, "utf8"));
b.specials = b.specials || [];
const have = new Set(b.specials.map((x) => x.slipNo));

copyFileSync(path, new URL(`../data/bets.json.bak-0307-897465`, import.meta.url));

const slip = {
  id: "sp-83910897465",
  slipNo: "83910897465",
  matchId: "aus-egy-2026-07-03",
  player: "3-game acca",
  market: "Accumulator (3) — totals/handicaps",
  label:
    "REAL 1xBet slip 83910897465 (03/07 16:22) — 3-fold @ 16.733, RM50 -> RM836.70. " +
    "Aus/Egy Total Over 0.75 (1.122) · " +
    "Arg/CpV Argentina -3.25 handicap (3.635) · " +
    "Col/Gha Ghana +0.25 handicap (3.73). Includes 1.1x accumulator bonus.",
  odds: 16.733,
  stake: 50,
  placedAt: "03/07",
  grade: {
    type: "multiLeg",
    legs: [
      // Leg 1 — Aus/Egy: match total over 0.75
      { matchId: "aus-egy-2026-07-03", kind: "totalOver", line: 0.75, odds: 1.122 },
      // Leg 2 — Arg/CpV: Argentina (home) -3.25 Asian handicap
      { matchId: "arg-cpv-2026-07-03", kind: "handicap", side: "home", line: -3.25, odds: 3.635 },
      // Leg 3 — Col/Gha: Ghana (away) +0.25 Asian handicap
      { matchId: "col-gha-2026-07-04", kind: "handicap", side: "away", line: 0.25, odds: 3.73 },
    ],
  },
};

let added = 0;
if (have.has(slip.slipNo)) {
  console.log("skip (already present):", slip.slipNo);
} else {
  b.specials.push(slip);
  added++;
  console.log("added:", slip.slipNo);
}

writeFileSync(path, JSON.stringify(b, null, 2) + "\n");
console.log(`\ndone — added ${added} slip(s) | specials now: ${b.specials.length}`);
