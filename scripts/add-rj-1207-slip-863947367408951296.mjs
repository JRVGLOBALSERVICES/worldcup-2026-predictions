import { readFileSync, writeFileSync } from "node:fs";

// --- Rj's DOUBLE placed 12/07 (1xBet) — ticket 863947367408951296 ---
// Two same-match parlays folded into one double; the whole slip wins only if
// EVERY leg across both matches lands → one flat multiLeg acca, each leg
// carrying its own matchId (grader settles per-leg, lib/bets.ts multiLeg).
// Double @11.22 = 2.82 (ARG-SUI parlay) × 3.98 (FRA-ESP parlay).
//   RM100 -> RM1,122.36 max.
// Fixtures: Argentina v Switzerland  arg-sui-2026-07-12 (Argentina home,
//   09:00 MYT — NOTE: fixture id is arg-SUI, not arg-swi) · France v Spain
//   fra-esp-2026-07-14 (France home, semi-final, 15/07 03:00 MYT).
const P = "data/bets.json";
const b = JSON.parse(readFileSync(P, "utf8"));

const ARG = "arg-sui-2026-07-12";
const FRA = "fra-esp-2026-07-14";

const slip = {
  id: "sp-863947367408951296",
  slipNo: "863947367408951296",
  matchId: ARG,
  player: "Double · Argentina/Switzerland + France/Spain",
  market: "Double (2 parlays) · 16 legs",
  label:
    "REAL 1xBet DOUBLE 863947367408951296 (12/07) @11.22, RM100 -> RM1,122.36. " +
    "2 parlays: [ARG-SUI @2.82] Messi score/assist · Mac Allister O0.5 tackles · " +
    "Embolo O0.5 shots · Ndoye O0.5 shots · Total U5.5 · Argentina to qualify · " +
    "Argentina team-total O0.5 · Switzerland team-total U2.5 · Argentina-or-Tie 1H DC · " +
    "Argentina to win either half. " +
    "[FRA-ESP @3.98] Mbappe score/assist · Rabiot O0.5 shots · Oyarzabal O0.5 shots · " +
    "Upamecano O0.5 tackles · Total U5.5 · France-or-Tie DC.",
  odds: 11.22,
  stake: 100,
  placedAt: "12/07",
  grade: {
    type: "multiLeg",
    legs: [
      // Argentina v Switzerland (@2.82)
      { matchId: ARG, kind: "scoredOrAssisted", player: "Lionel Messi" },
      { matchId: ARG, kind: "playerTacklesOver", player: "Alexis Mac Allister", line: 0.5 },
      { matchId: ARG, kind: "playerShotsOver", player: "Breel Embolo", line: 0.5 },
      { matchId: ARG, kind: "playerShotsOver", player: "Dan Ndoye", line: 0.5 },
      { matchId: ARG, kind: "totalUnder", line: 5.5 },
      { matchId: ARG, kind: "qualify", side: "home" },
      { matchId: ARG, kind: "individualTotalOver", side: "home", line: 0.5 },
      { matchId: ARG, kind: "individualTotalUnder", side: "away", line: 2.5 },
      { matchId: ARG, kind: "firstHalfDoubleChance", outcome: "1X" },
      { matchId: ARG, kind: "winsAtLeastOneHalf", side: "home" },
      // France v Spain (@3.98)
      { matchId: FRA, kind: "scoredOrAssisted", player: "Kylian Mbappe" },
      { matchId: FRA, kind: "playerShotsOver", player: "Adrien Rabiot", line: 0.5 },
      { matchId: FRA, kind: "playerShotsOver", player: "Mikel Oyarzabal", line: 0.5 },
      { matchId: FRA, kind: "playerTacklesOver", player: "Dayot Upamecano", line: 0.5 },
      { matchId: FRA, kind: "totalUnder", line: 5.5 },
      { matchId: FRA, kind: "doubleChance", outcome: "1X" },
    ],
  },
};

const existing = new Set(b.specials.map((s) => s.slipNo));
if (existing.has(slip.slipNo)) {
  console.log("SKIP (already present):", slip.slipNo);
} else {
  b.specials.push(slip);
  writeFileSync(P, JSON.stringify(b, null, 2) + "\n");
  console.log("ADDED:", slip.slipNo, "| legs:", slip.grade.legs.length);
}
console.log("specials:", b.specials.length);
