// One-off: append Rj's 03/07 slip 83910863597 to data/bets.json — a REAL
// image-confirmed 1xBet 3-fold accumulator (RM50 @ 28.061 -> RM1,403.08).
// Placed 03/07 16:21. Odds check: 2.053 * 2.398 * 5.7 = 28.06 ✓.
//
// All three 1xBet legs are COMBINED (two conditions each). The multiLeg grader
// has no "scored AND X" leg kind, so each combined leg is decomposed into its
// atomic sub-conditions as separate legs. This is exactly equivalent for a
// fixed-odds acca: the ticket wins iff EVERY atomic condition holds, and a
// combined leg wins iff BOTH its parts hold — same AND. The combined per-leg
// price is attached to the primary sub-leg for void/refund reconcile.
//
//   Leg 1  Arg/CpV  Messi To Score AND Total Under 4.5   @ 2.053
//          -> scored(Lionel Messi) + totalUnder(4.5)
//   Leg 2  Col/Gha  Luis Diaz To Score AND Team 1 (Colombia=home) Not To Lose  @ 2.398
//          -> scored(Luis Diaz) + doubleChance(1X)  [not to lose = home win or draw]
//   Leg 3  Aus/Egy  W1 (Australia=home win) AND Total 1 Over (1.5)  @ 5.7
//          -> result(1) + individualTotalOver(home, 1.5)  [Australia 2+ own goals]
//
// Idempotent by slipNo.
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";

const path = new URL("../data/bets.json", import.meta.url);
const b = JSON.parse(readFileSync(path, "utf8"));
b.specials = b.specials || [];
const have = new Set(b.specials.map((x) => x.slipNo));

copyFileSync(path, new URL(`../data/bets.json.bak-0307-863597`, import.meta.url));

const slip = {
  id: "sp-83910863597",
  slipNo: "83910863597",
  matchId: "arg-cpv-2026-07-03",
  player: "3-game acca",
  market: "Accumulator (3) — scorer combos",
  label:
    "REAL 1xBet slip 83910863597 (03/07 16:21) — 3-fold @ 28.061, RM50 -> RM1,403.08. " +
    "Arg/CpV Messi to score + Total Under 4.5 (2.053) · " +
    "Col/Gha Luis Diaz to score + Colombia not to lose 1X (2.398) · " +
    "Aus/Egy Australia win + Australia over 1.5 goals (5.7).",
  odds: 28.061,
  stake: 50,
  placedAt: "03/07",
  grade: {
    type: "multiLeg",
    legs: [
      // Leg 1 — Arg/CpV: Messi scores AND match total under 4.5
      { matchId: "arg-cpv-2026-07-03", kind: "scored", player: "Lionel Messi", odds: 2.053 },
      { matchId: "arg-cpv-2026-07-03", kind: "totalUnder", line: 4.5 },
      // Leg 2 — Col/Gha: Luis Diaz scores AND Colombia (home) not to lose (1X)
      { matchId: "col-gha-2026-07-04", kind: "scored", player: "Luis Diaz", odds: 2.398 },
      { matchId: "col-gha-2026-07-04", kind: "doubleChance", outcome: "1X" },
      // Leg 3 — Aus/Egy: Australia (home) win AND Australia's own goals over 1.5
      { matchId: "aus-egy-2026-07-03", kind: "result", outcome: "1", odds: 5.7 },
      { matchId: "aus-egy-2026-07-03", kind: "individualTotalOver", side: "home", line: 1.5 },
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
