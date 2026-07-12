import { readFileSync, writeFileSync } from "node:fs";

// --- Rj's two DOUBLES placed 12/07 (1xBet) — semi-final slate ---
// Both are two-match parlays folded into one double (flat multiLeg acca; whole
// slip wins only if EVERY leg lands). Each leg carries its own matchId.
// Fixtures: England v Argentina eng-arg-2026-07-15 (England home, 16/07 03:00
//   MYT) · France v Spain fra-esp-2026-07-14 (France home, semi, 15/07 03:00).
const P = "data/bets.json";
const b = JSON.parse(readFileSync(P, "utf8"));

const ENG = "eng-arg-2026-07-15";
const FRA = "fra-esp-2026-07-14";

const slips = [
  // Ticket #864050609417494528 — Double @50.69 = 3.65 (ENG-ARG) × 13.89 (FRA-ESP)
  //   RM50 -> RM2,534.93.
  {
    id: "sp-864050609417494528",
    slipNo: "864050609417494528",
    matchId: ENG,
    player: "Double · England/Argentina + France/Spain",
    market: "Double (2 parlays) · 8 legs",
    label:
      "REAL 1xBet DOUBLE 864050609417494528 (12/07) @50.69, RM50 -> RM2,534.93. " +
      "2 parlays: [ENG-ARG @3.65] Draw (X) · Total U3.5. " +
      "[FRA-ESP @13.89] Draw (X) · Rabiot O0.5 shots · Total U3.5 · " +
      "Mbappe O0.5 SOT · Doue O0.5 SOT · Fabian Ruiz O0.5 shots.",
    odds: 50.69,
    stake: 50,
    placedAt: "12/07",
    grade: {
      type: "multiLeg",
      legs: [
        // England v Argentina (@3.65)
        { matchId: ENG, kind: "result", outcome: "X" },
        { matchId: ENG, kind: "totalUnder", line: 3.5 },
        // France v Spain (@13.89)
        { matchId: FRA, kind: "result", outcome: "X" },
        { matchId: FRA, kind: "playerShotsOver", player: "Adrien Rabiot", line: 0.5 },
        { matchId: FRA, kind: "totalUnder", line: 3.5 },
        { matchId: FRA, kind: "playerSotOver", player: "Kylian Mbappe", line: 0.5 },
        { matchId: FRA, kind: "playerSotOver", player: "Désiré Doué", line: 0.5 },
        { matchId: FRA, kind: "playerShotsOver", player: "Fabián Ruiz", line: 0.5 },
      ],
    },
  },
  // Bet Ticket #864047272873910273 (Purchase 864047272873910272) —
  //   Double @16.98 = 3.48 (FRA-ESP) × 4.88 (ENG-ARG). RM100 -> RM1,698.24.
  {
    id: "sp-864047272873910273",
    slipNo: "864047272873910273",
    matchId: FRA,
    player: "Double · France/Spain + England/Argentina",
    market: "Double (2 parlays) · 13 legs",
    label:
      "REAL 1xBet DOUBLE 864047272873910273 (12/07) @16.98, RM100 -> RM1,698.24. " +
      "2 parlays: [FRA-ESP @3.48] France to qualify · Total O0.5 · Total U5.5 · " +
      "Maignan O1.5 saves · Upamecano O0.5 tackles · Doue O0.5 SOT · " +
      "Mbappe O0.5 SOT · Barcola O0.5 shots. " +
      "[ENG-ARG @4.88] Total O0.5 · Total U4.5 · Total match shots O22.5 · " +
      "Tie-or-Argentina DC · Messi score/assist.",
    odds: 16.98,
    stake: 100,
    placedAt: "12/07",
    grade: {
      type: "multiLeg",
      legs: [
        // France v Spain (@3.48)
        { matchId: FRA, kind: "qualify", side: "home" },
        { matchId: FRA, kind: "totalOver", line: 0.5 },
        { matchId: FRA, kind: "totalUnder", line: 5.5 },
        { matchId: FRA, kind: "gkSavesOver", player: "Mike Maignan", side: "home", line: 1.5 },
        { matchId: FRA, kind: "playerTacklesOver", player: "Dayot Upamecano", line: 0.5 },
        { matchId: FRA, kind: "playerSotOver", player: "Désiré Doué", line: 0.5 },
        { matchId: FRA, kind: "playerSotOver", player: "Kylian Mbappe", line: 0.5 },
        { matchId: FRA, kind: "playerShotsOver", player: "Bradley Barcola", line: 0.5 },
        // England v Argentina (@4.88)
        { matchId: ENG, kind: "totalOver", line: 0.5 },
        { matchId: ENG, kind: "totalUnder", line: 4.5 },
        { matchId: ENG, kind: "totalShotsOver", line: 22.5 },
        { matchId: ENG, kind: "doubleChance", outcome: "X2" }, // Tie or Argentina (away)
        { matchId: ENG, kind: "scoredOrAssisted", player: "Lionel Messi" },
      ],
    },
  },
];

const existing = new Set(b.specials.map((s) => s.slipNo));
for (const slip of slips) {
  if (existing.has(slip.slipNo)) {
    console.log("SKIP (already present):", slip.slipNo);
  } else {
    b.specials.push(slip);
    console.log("ADDED:", slip.slipNo, "| legs:", slip.grade.legs.length);
  }
}
writeFileSync(P, JSON.stringify(b, null, 2) + "\n");
console.log("specials:", b.specials.length);
