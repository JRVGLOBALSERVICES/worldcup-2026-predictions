import { readFileSync, writeFileSync } from "node:fs";

// --- Rj's TREBLE + DOUBLE placed 11/07 (1xBet) ---
// Each "sub-parlay" is a same-match build-a-bet; the whole slip wins only if
// EVERY leg across all its matches lands → one flat multiLeg acca, each leg
// carrying its own matchId (grader settles per-leg, lib/bets.ts multiLeg).
// Fixtures: Norway v England  nor-eng-2026-07-11 (Norway home, England away) ·
//           Argentina v Switz. arg-swi-2026-07-12 (Argentina home) ·
//           France v Spain     fra-esp-2026-07-14 (SEMIFINAL — not scheduled
//             yet; the Mbappe leg stays pending until that match resolves).
const P = "data/bets.json";
const b = JSON.parse(readFileSync(P, "utf8"));

const NOR = "nor-eng-2026-07-11";
const ARG = "arg-swi-2026-07-12";
const FRA = "fra-esp-2026-07-14"; // France v Spain SF, 15/07 03:00 MYT = 14/07 19:00 UTC

const slips = [
  {
    // Treble @154.51 = 21.47 (NOR-ENG) × 3.46 (ARG-SWI) × 2.08 (FRA-ESP)
    id: "sp-863586258462093313",
    slipNo: "863586258462093313",
    matchId: NOR,
    player: "Treble · Norway/England + Argentina/Switzerland + France/Spain",
    market: "Treble (3 parlays) · 17 legs",
    label:
      "REAL 1xBet TREBLE 863586258462093313 (11/07 09:03) @154.51, RM8 -> RM1,236.12. " +
      "3 parlays: [NOR-ENG @21.47] Total O1.5 · 1H Total O0.5 · BTTS Yes · Kane scorer · " +
      "Haaland scorer · Norway-or-England DC · Bellingham score/assist · Pickford O1.5 saves · " +
      "Patrick Berg O1.5 tackles. [ARG-SWI @3.46] Total O1.5 · Argentina to qualify · " +
      "Messi scorer · Embolo O0.5 shots · Ndoye O0.5 shots · Lautaro O0.5 shots · " +
      "Romero O0.5 tackles. [FRA-ESP @2.08] Mbappé anytime scorer.",
    odds: 154.51,
    stake: 8,
    placedAt: "11/07 09:03",
    grade: {
      type: "multiLeg",
      legs: [
        // Norway v England (@21.47)
        { matchId: NOR, kind: "totalOver", line: 1.5 },
        { matchId: NOR, kind: "firstHalfTotalOver", line: 0.5 },
        { matchId: NOR, kind: "btts" },
        { matchId: NOR, kind: "scored", player: "Harry Kane" },
        { matchId: NOR, kind: "scored", player: "Erling Haaland" },
        { matchId: NOR, kind: "doubleChance", outcome: "12" },
        { matchId: NOR, kind: "scoredOrAssisted", player: "Jude Bellingham" },
        { matchId: NOR, kind: "gkSavesOver", player: "Jordan Pickford", side: "away", line: 1.5 },
        { matchId: NOR, kind: "playerTacklesOver", player: "Patrick Berg", line: 1.5 },
        // Argentina v Switzerland (@3.46)
        { matchId: ARG, kind: "totalOver", line: 1.5 },
        { matchId: ARG, kind: "qualify", side: "home" },
        { matchId: ARG, kind: "scored", player: "Lionel Messi" },
        { matchId: ARG, kind: "playerShotsOver", player: "Breel Embolo", line: 0.5 },
        { matchId: ARG, kind: "playerShotsOver", player: "Dan Ndoye", line: 0.5 },
        { matchId: ARG, kind: "playerShotsOver", player: "Lautaro Martinez", line: 0.5 },
        { matchId: ARG, kind: "playerTacklesOver", player: "Cristian Romero", line: 0.5 },
        // France v Spain (@2.08) — SF, pending until scheduled/played
        { matchId: FRA, kind: "scored", player: "Kylian Mbappe" },
      ],
    },
  },
  {
    // Double @12.24 = 3.46 (NOR-ENG) × 3.54 (ARG-SWI)
    id: "sp-863580958073962497",
    slipNo: "863580958073962497",
    matchId: NOR,
    player: "Double · Norway/England + Argentina/Switzerland",
    market: "Double (2 parlays) · 13 legs",
    label:
      "REAL 1xBet DOUBLE 863580958073962497 (11/07 08:42) @12.24, RM242 -> RM2,964.11. " +
      "2 parlays: [NOR-ENG @3.46] Pickford O1.5 saves · Elliot Anderson O1.5 tackles · " +
      "Bellingham O0.5 shots · Anthony Gordon O0.5 SoT · Kane score/assist · Total O1.5. " +
      "[ARG-SWI @3.54] Argentina to qualify · Total O0.5 · Messi scorer · Embolo O0.5 shots · " +
      "Argentina-or-Switzerland DC · Lautaro O0.5 SoT · Ndoye O0.5 shots.",
    odds: 12.24,
    stake: 242,
    placedAt: "11/07 08:42",
    grade: {
      type: "multiLeg",
      legs: [
        // Norway v England (@3.46)
        { matchId: NOR, kind: "gkSavesOver", player: "Jordan Pickford", side: "away", line: 1.5 },
        { matchId: NOR, kind: "playerTacklesOver", player: "Elliot Anderson", line: 1.5 },
        { matchId: NOR, kind: "playerShotsOver", player: "Jude Bellingham", line: 0.5 },
        { matchId: NOR, kind: "playerSotOver", player: "Anthony Gordon", line: 0.5 },
        { matchId: NOR, kind: "scoredOrAssisted", player: "Harry Kane" },
        { matchId: NOR, kind: "totalOver", line: 1.5 },
        // Argentina v Switzerland (@3.54)
        { matchId: ARG, kind: "qualify", side: "home" },
        { matchId: ARG, kind: "totalOver", line: 0.5 },
        { matchId: ARG, kind: "scored", player: "Lionel Messi" },
        { matchId: ARG, kind: "playerShotsOver", player: "Breel Embolo", line: 0.5 },
        { matchId: ARG, kind: "doubleChance", outcome: "12" },
        { matchId: ARG, kind: "playerSotOver", player: "Lautaro Martinez", line: 0.5 },
        { matchId: ARG, kind: "playerShotsOver", player: "Dan Ndoye", line: 0.5 },
      ],
    },
  },
];

const existing = new Set(b.specials.map((s) => s.slipNo));
for (const slip of slips) {
  if (existing.has(slip.slipNo)) {
    console.log("SKIP (already present):", slip.slipNo);
    continue;
  }
  b.specials.push(slip);
  console.log("ADDED:", slip.slipNo, "| legs:", slip.grade.legs.length);
}
writeFileSync(P, JSON.stringify(b, null, 2) + "\n");
console.log("specials:", b.specials.length);
