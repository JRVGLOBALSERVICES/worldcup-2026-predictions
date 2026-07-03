// One-off: append Rj's 03/07 slip 83907036017 to data/bets.json — a REAL
// image-confirmed 1xBet 3-fold accumulator (RM60 @ 20.087 -> RM1,205.26).
// Placed 03/07 13:39. Odds check: 2.875 * 5.1 * 1.37 = 20.088 ✓.
//
// Leg 2 "Messi to score TWO goals" = 2+ => goalsOver line 1.5 (same encoding as
// the 759195/429597 precedent). Per-leg odds captured for void/refund reconcile.
// Idempotent by slipNo.
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";

const path = new URL("../data/bets.json", import.meta.url);
const b = JSON.parse(readFileSync(path, "utf8"));
b.specials = b.specials || [];
const have = new Set(b.specials.map((x) => x.slipNo));

copyFileSync(path, new URL(`../data/bets.json.bak-0307-036017`, import.meta.url));

const slip = {
  id: "sp-83907036017",
  slipNo: "83907036017",
  matchId: "aus-egy-2026-07-03",
  player: "3-game acca",
  market: "Accumulator (3) — totals/scorer",
  label:
    "REAL 1xBet slip 83907036017 (03/07 13:39) — 3-fold @ 20.087, RM60 -> RM1,205.26. " +
    "Aus/Egy Total Over 2.5 (2.875) · Arg/CpV Messi to score TWO (5.1) · Col/Gha Total Under 3 (1.37).",
  odds: 20.087,
  stake: 60,
  placedAt: "03/07",
  grade: {
    type: "multiLeg",
    legs: [
      { matchId: "aus-egy-2026-07-03", kind: "totalOver", line: 2.5, odds: 2.875 },
      { matchId: "arg-cpv-2026-07-03", kind: "goalsOver", player: "Lionel Messi", line: 1.5, odds: 5.1 }, // "score TWO" = 2+
      { matchId: "col-gha-2026-07-04", kind: "totalUnder", line: 3.0, odds: 1.37 },
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
