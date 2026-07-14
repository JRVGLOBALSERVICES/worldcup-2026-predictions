import { readFileSync, writeFileSync } from "node:fs";

// --- Rj's 3 DOUBLES placed 14/07 12:14–12:23 (1xBet) — semi-final slate ---
// Each is two match-parlays folded into one double (flat multiLeg acca; the whole
// slip wins only if EVERY leg lands). Each leg carries its own matchId.
// Fixtures: England v Argentina eng-arg-2026-07-15 (England home, 16/07 03:00
//   MYT) · France v Spain fra-esp-2026-07-14 (France home, semi, 15/07 03:00).
const P = "data/bets.json";
const b = JSON.parse(readFileSync(P, "utf8"));

const ENG = "eng-arg-2026-07-15";
const FRA = "fra-esp-2026-07-14";

const slips = [
  // #864723841162326017 — Double @23.60 = 5.28 (ENG-ARG) × 4.47 (FRA-ESP).
  //   RM100 -> RM2,360.16.
  {
    id: "sp-864723841162326017",
    slipNo: "864723841162326017",
    matchId: ENG,
    player: "Double · England/Argentina + France/Spain",
    market: "Double (2 parlays) · 11 legs",
    label:
      "REAL 1xBet DOUBLE 864723841162326017 (14/07) @23.60, RM100 -> RM2,360.16. " +
      "[ENG-ARG @5.28] Kane O0.5 SOT · Messi score/assist · Total U5.5 · " +
      "L.Martinez O0.5 tackles · Bellingham O1.5 SOT. " +
      "[FRA-ESP @4.47] Mbappe score/assist · Yamal O0.5 SOT · Dembele O0.5 SOT · " +
      "Oyarzabal O0.5 SOT · Upamecano O0.5 tackles · Total O1.5.",
    odds: 23.6,
    stake: 100,
    placedAt: "14/07",
    grade: {
      type: "multiLeg",
      legs: [
        // England v Argentina (@5.28) — England home
        { matchId: ENG, kind: "playerSotOver", player: "Harry Kane", line: 0.5 },
        { matchId: ENG, kind: "scoredOrAssisted", player: "Lionel Messi" },
        { matchId: ENG, kind: "totalUnder", line: 5.5 },
        { matchId: ENG, kind: "playerTacklesOver", player: "Lisandro Martínez", line: 0.5 },
        { matchId: ENG, kind: "playerSotOver", player: "Jude Bellingham", line: 1.5 },
        // France v Spain (@4.47) — France home
        { matchId: FRA, kind: "scoredOrAssisted", player: "Kylian Mbappe" },
        { matchId: FRA, kind: "playerSotOver", player: "Lamine Yamal", line: 0.5 },
        { matchId: FRA, kind: "playerSotOver", player: "Ousmane Dembélé", line: 0.5 },
        { matchId: FRA, kind: "playerSotOver", player: "Mikel Oyarzabal", line: 0.5 },
        { matchId: FRA, kind: "playerTacklesOver", player: "Dayot Upamecano", line: 0.5 },
        { matchId: FRA, kind: "totalOver", line: 1.5 },
      ],
    },
  },

  // #864721738633199617 — Double @17.14 = 3.21 (FRA-ESP) × 5.34 (ENG-ARG).
  //   RM125 -> RM2,142.68.
  {
    id: "sp-864721738633199617",
    slipNo: "864721738633199617",
    matchId: FRA,
    player: "Double · France/Spain + England/Argentina",
    market: "Double (2 parlays) · 9 legs",
    label:
      "REAL 1xBet DOUBLE 864721738633199617 (14/07) @17.14, RM125 -> RM2,142.68. " +
      "[FRA-ESP @3.21] France to qualify · Yamal O0.5 SOT · Mbappe O1.5 SOT · " +
      "Dembele O0.5 SOT. " +
      "[ENG-ARG @5.34] Kane O0.5 SOT · Messi O1.5 SOT · J.Alvarez O0.5 SOT · " +
      "Total O1.5 · BTTS Yes.",
    odds: 17.14,
    stake: 125,
    placedAt: "14/07",
    grade: {
      type: "multiLeg",
      legs: [
        // France v Spain (@3.21) — France home
        { matchId: FRA, kind: "qualify", side: "home" },
        { matchId: FRA, kind: "playerSotOver", player: "Lamine Yamal", line: 0.5 },
        { matchId: FRA, kind: "playerSotOver", player: "Kylian Mbappe", line: 1.5 },
        { matchId: FRA, kind: "playerSotOver", player: "Ousmane Dembélé", line: 0.5 },
        // England v Argentina (@5.34) — England home
        { matchId: ENG, kind: "playerSotOver", player: "Harry Kane", line: 0.5 },
        { matchId: ENG, kind: "playerSotOver", player: "Lionel Messi", line: 1.5 },
        { matchId: ENG, kind: "playerSotOver", player: "Julián Álvarez", line: 0.5 },
        { matchId: ENG, kind: "totalOver", line: 1.5 },
        { matchId: ENG, kind: "btts" },
      ],
    },
  },

  // #864721612044939265 — Double @22.69 = 3.21 (FRA-ESP) × 7.07 (ENG-ARG).
  //   RM125 -> RM2,836.84.
  {
    id: "sp-864721612044939265",
    slipNo: "864721612044939265",
    matchId: FRA,
    player: "Double · France/Spain + England/Argentina",
    market: "Double (2 parlays) · 9 legs",
    label:
      "REAL 1xBet DOUBLE 864721612044939265 (14/07) @22.69, RM125 -> RM2,836.84. " +
      "[FRA-ESP @3.21] France to qualify · Yamal O0.5 SOT · Mbappe O1.5 SOT · " +
      "Dembele O0.5 SOT. " +
      "[ENG-ARG @7.07] Kane O0.5 SOT · Messi O1.5 SOT · J.Alvarez O0.5 SOT · " +
      "BTTS Yes · Total U4.5.",
    odds: 22.69,
    stake: 125,
    placedAt: "14/07",
    grade: {
      type: "multiLeg",
      legs: [
        // France v Spain (@3.21) — France home
        { matchId: FRA, kind: "qualify", side: "home" },
        { matchId: FRA, kind: "playerSotOver", player: "Lamine Yamal", line: 0.5 },
        { matchId: FRA, kind: "playerSotOver", player: "Kylian Mbappe", line: 1.5 },
        { matchId: FRA, kind: "playerSotOver", player: "Ousmane Dembélé", line: 0.5 },
        // England v Argentina (@7.07) — England home
        { matchId: ENG, kind: "playerSotOver", player: "Harry Kane", line: 0.5 },
        { matchId: ENG, kind: "playerSotOver", player: "Lionel Messi", line: 1.5 },
        { matchId: ENG, kind: "playerSotOver", player: "Julián Álvarez", line: 0.5 },
        { matchId: ENG, kind: "btts" },
        { matchId: ENG, kind: "totalUnder", line: 4.5 },
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
