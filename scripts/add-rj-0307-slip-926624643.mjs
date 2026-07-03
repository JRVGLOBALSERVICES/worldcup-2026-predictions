// One-off: append Rj's 03/07 slip 83926624643 to data/bets.json — a REAL
// image-confirmed 1xBet 3-fold accumulator (RM100 @ 15.72 -> RM1,572.00).
// Placed 03/07 23:20. Odds check: 3.2 * 2.5 * 1.965 = 15.72 ✓.
//
// Legs 1 & 2 are the single "Double Chance + Both Teams To Score" market, which
// the multiLeg grader expresses directly as `doubleChanceBtts` (DC outcome AND
// both teams score, decided at FT). Leg 3 is a combined "scorer AND match total"
// leg with no atomic kind, so it's decomposed into its two sub-conditions
// (scored + totalOver) as separate legs — exactly equivalent for a fixed-odds
// acca (the ticket wins iff EVERY condition holds). The combined per-leg price is
// attached to the primary sub-leg for void/refund reconcile.
//
//   Leg 1  Aus/Egy  Double Chance 1X + Both Teams To Score - Yes   @ 3.2
//          -> doubleChanceBtts(1X)   [Australia = home]
//   Leg 2  Col/Gha  Double Chance 1X + Both Teams To Score - Yes   @ 2.5
//          -> doubleChanceBtts(1X)   [Colombia = home]
//   Leg 3  Arg/CpV  Lionel Messi To Score AND Match Total Over 2.5 @ 1.965
//          -> scored(Lionel Messi) + totalOver(2.5)
//
// Idempotent by slipNo.
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";

const path = new URL("../data/bets.json", import.meta.url);
const b = JSON.parse(readFileSync(path, "utf8"));
b.specials = b.specials || [];
const have = new Set(b.specials.map((x) => x.slipNo));

copyFileSync(path, new URL(`../data/bets.json.bak-0307-926624643`, import.meta.url));

const slip = {
  id: "sp-83926624643",
  slipNo: "83926624643",
  matchId: "aus-egy-2026-07-03",
  player: "3-game acca",
  market: "Accumulator (3) — DC+BTTS / scorer combos",
  label:
    "REAL 1xBet slip 83926624643 (03/07 23:20) — 3-fold @ 15.72, RM100 -> RM1,572.00. " +
    "Aus/Egy Double Chance 1X + Both Teams To Score - Yes (3.2) · " +
    "Col/Gha Double Chance 1X + Both Teams To Score - Yes (2.5) · " +
    "Arg/CpV Lionel Messi to score + Match Total Over 2.5 (1.965).",
  odds: 15.72,
  stake: 100,
  placedAt: "03/07",
  grade: {
    type: "multiLeg",
    legs: [
      // Leg 1 — Aus/Egy: Double Chance 1X (Australia home win or draw) AND both teams score
      { matchId: "aus-egy-2026-07-03", kind: "doubleChanceBtts", outcome: "1X", odds: 3.2 },
      // Leg 2 — Col/Gha: Double Chance 1X (Colombia home win or draw) AND both teams score
      { matchId: "col-gha-2026-07-04", kind: "doubleChanceBtts", outcome: "1X", odds: 2.5 },
      // Leg 3 — Arg/CpV: Lionel Messi scores AND match total over 2.5
      { matchId: "arg-cpv-2026-07-03", kind: "scored", player: "Lionel Messi", odds: 1.965 },
      { matchId: "arg-cpv-2026-07-03", kind: "totalOver", line: 2.5 },
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
