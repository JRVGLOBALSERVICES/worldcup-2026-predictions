import { readFileSync, writeFileSync } from "node:fs";

// --- Rj's two cross-match TREBLES placed 10/07 22:15 & 22:19 (1xBet) ---
// Each "treble" combines 3 same-match parlays across 3 QF/R16 fixtures.
// Combined treble odds = product of the 3 sub-parlay odds; whole treble wins
// only if EVERY leg across all 3 matches lands → one flat multiLeg acca, each
// leg carrying its own matchId (grader settles per-leg, per lib/bets.ts:390).
// Fixtures: Spain v Belgium esp-bel-2026-07-10 (Spain home) ·
//           Norway v England nor-eng-2026-07-11 (Norway home) ·
//           Argentina v Switzerland arg-swi-2026-07-12 (Argentina home).
const P = "data/bets.json";
const b = JSON.parse(readFileSync(P, "utf8"));

const ESP = "esp-bel-2026-07-10";
const NOR = "nor-eng-2026-07-11";
const ARG = "arg-swi-2026-07-12";

const slips = [
  {
    // Treble @25.95 = 1.55 (ESP-BEL) × 5.35 (NOR-ENG) × 3.13 (ARG-SWI)
    id: "sp-863423200079003649",
    slipNo: "863423200079003649",
    matchId: ESP,
    player: "Treble · Spain/Belgium + Norway/England + Argentina/Switzerland",
    market: "Treble (3 parlays) · 17 legs",
    label:
      "REAL 1xBet TREBLE 863423200079003649 (10/07 22:15) @25.95, RM100 -> RM2,595.55. " +
      "3 same-match parlays: [ESP-BEL @1.55] Unai Simón O0.5 saves · Pedro Porro O1.5 tackles · " +
      "Spain-or-tie DC · Total U5.5 · Total O0.5 · Spain to qualify. " +
      "[NOR-ENG @5.35] Kane score/assist · Total U5.5 · Nusa O0.5 shots · Nyland O1.5 saves · " +
      "Haaland score/assist. [ARG-SWI @3.13] Messi score/assist · Mac Allister O0.5 tackles · " +
      "Arg-or-tie DC · Argentina to qualify · Total U5.5 · Argentina corners O4.5.",
    odds: 25.95,
    stake: 100,
    placedAt: "10/07 22:15",
    grade: {
      type: "multiLeg",
      legs: [
        // Spain v Belgium (@1.55)
        { matchId: ESP, kind: "gkSavesOver", player: "Unai Simon", side: "home", line: 0.5 },
        { matchId: ESP, kind: "playerTacklesOver", player: "Pedro Porro", line: 1.5 },
        { matchId: ESP, kind: "doubleChance", outcome: "1X" },
        { matchId: ESP, kind: "totalUnder", line: 5.5 },
        { matchId: ESP, kind: "totalOver", line: 0.5 },
        { matchId: ESP, kind: "qualify", side: "home" },
        // Norway v England (@5.35)
        { matchId: NOR, kind: "scoredOrAssisted", player: "Harry Kane" },
        { matchId: NOR, kind: "totalUnder", line: 5.5 },
        { matchId: NOR, kind: "playerShotsOver", player: "Antonio Nusa", line: 0.5 },
        { matchId: NOR, kind: "gkSavesOver", player: "Orjan Nyland", side: "home", line: 1.5 },
        { matchId: NOR, kind: "scoredOrAssisted", player: "Erling Haaland" },
        // Argentina v Switzerland (@3.13)
        { matchId: ARG, kind: "scoredOrAssisted", player: "Lionel Messi" },
        { matchId: ARG, kind: "playerTacklesOver", player: "Alexis Mac Allister", line: 0.5 },
        { matchId: ARG, kind: "doubleChance", outcome: "1X" },
        { matchId: ARG, kind: "qualify", side: "home" },
        { matchId: ARG, kind: "totalUnder", line: 5.5 },
        { matchId: ARG, kind: "teamCornersOver", side: "home", line: 4.5 },
      ],
    },
  },
  {
    // Treble @74.06 = 5.01 (ESP-BEL) × 3.36 (NOR-ENG) × 4.40 (ARG-SWI)
    id: "sp-863424127393554433",
    slipNo: "863424127393554433",
    matchId: ESP,
    player: "Treble · Spain/Belgium + Norway/England + Argentina/Switzerland",
    market: "Treble (3 parlays) · 6 scorer legs",
    label:
      "REAL 1xBet TREBLE 863424127393554433 (10/07 22:19) @74.06, RM10 -> RM740.68. " +
      "3 to-score-or-assist parlays: [ESP-BEL @5.01] Lamine Yamal · Leandro Trossard. " +
      "[NOR-ENG @3.36] Harry Kane · Erling Haaland. " +
      "[ARG-SWI @4.40] Messi anytime scorer · Lautaro Martínez score/assist.",
    odds: 74.06,
    stake: 10,
    placedAt: "10/07 22:19",
    grade: {
      type: "multiLeg",
      legs: [
        // Spain v Belgium (@5.01)
        { matchId: ESP, kind: "scoredOrAssisted", player: "Lamine Yamal" },
        { matchId: ESP, kind: "scoredOrAssisted", player: "Leandro Trossard" },
        // Norway v England (@3.36)
        { matchId: NOR, kind: "scoredOrAssisted", player: "Harry Kane" },
        { matchId: NOR, kind: "scoredOrAssisted", player: "Erling Haaland" },
        // Argentina v Switzerland (@4.40)
        { matchId: ARG, kind: "scored", player: "Lionel Messi" },
        { matchId: ARG, kind: "scoredOrAssisted", player: "Lautaro Martinez" },
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
