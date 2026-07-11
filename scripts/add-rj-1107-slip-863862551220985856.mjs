import { readFileSync, writeFileSync } from "node:fs";

// --- Rj's DOUBLE placed 11/07 (1xBet) — ticket 863862551220985856 ---
// Two same-match parlays folded into one double; the whole slip wins only if
// EVERY leg across both matches lands → one flat multiLeg acca, each leg
// carrying its own matchId (grader settles per-leg, lib/bets.ts multiLeg).
// Double @101.04 = 12.71 (NOR-ENG) × 7.95 (ARG-SWI), RM25 -> RM2,526.11.
// Fixtures: Norway v England  nor-eng-2026-07-11 (Norway home, England away,
//             05:00 MYT) · Argentina v Switz. arg-swi-2026-07-12 (Argentina
//             home, 09:00 MYT).
const P = "data/bets.json";
const b = JSON.parse(readFileSync(P, "utf8"));

const NOR = "nor-eng-2026-07-11";
const ARG = "arg-swi-2026-07-12";

const slip = {
  id: "sp-863862551220985856",
  slipNo: "863862551220985856",
  matchId: NOR,
  player: "Double · Norway/England + Argentina/Switzerland",
  market: "Double (2 parlays) · 18 legs",
  label:
    "REAL 1xBet DOUBLE 863862551220985856 (11/07) @101.04, RM25 -> RM2,526.11. " +
    "2 parlays: [NOR-ENG @12.71] Haaland score/assist · Pickford O1.5 saves · " +
    "Total U6.5 · Corners FT O9.5 · Norway-or-England DC · Bellingham O0.5 SoT · " +
    "Kane O1.5 SoT · Elliot Anderson O0.5 tackles · 1H Total O0.5. " +
    "[ARG-SWI @7.95] Argentina to qualify · Total O0.5 · Total U5.5 · Messi scorer · " +
    "Embolo O0.5 shots · Mac Allister O0.5 tackles · Lautaro score/assist · " +
    "Ndoye O0.5 shots · Argentina to win either half.",
  odds: 101.04,
  stake: 25,
  placedAt: "11/07",
  grade: {
    type: "multiLeg",
    legs: [
      // Norway v England (@12.71)
      { matchId: NOR, kind: "scoredOrAssisted", player: "Erling Haaland" },
      { matchId: NOR, kind: "gkSavesOver", player: "Jordan Pickford", side: "away", line: 1.5 },
      { matchId: NOR, kind: "totalUnder", line: 6.5 },
      { matchId: NOR, kind: "cornersTotalOver", line: 9.5 },
      { matchId: NOR, kind: "doubleChance", outcome: "12" },
      { matchId: NOR, kind: "playerSotOver", player: "Jude Bellingham", line: 0.5 },
      { matchId: NOR, kind: "playerSotOver", player: "Harry Kane", line: 1.5 },
      { matchId: NOR, kind: "playerTacklesOver", player: "Elliot Anderson", line: 0.5 },
      { matchId: NOR, kind: "firstHalfTotalOver", line: 0.5 },
      // Argentina v Switzerland (@7.95)
      { matchId: ARG, kind: "qualify", side: "home" },
      { matchId: ARG, kind: "totalOver", line: 0.5 },
      { matchId: ARG, kind: "totalUnder", line: 5.5 },
      { matchId: ARG, kind: "scored", player: "Lionel Messi" },
      { matchId: ARG, kind: "playerShotsOver", player: "Breel Embolo", line: 0.5 },
      { matchId: ARG, kind: "playerTacklesOver", player: "Alexis Mac Allister", line: 0.5 },
      { matchId: ARG, kind: "scoredOrAssisted", player: "Lautaro Martinez" },
      { matchId: ARG, kind: "playerShotsOver", player: "Dan Ndoye", line: 0.5 },
      { matchId: ARG, kind: "winsAtLeastOneHalf", side: "home" },
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
