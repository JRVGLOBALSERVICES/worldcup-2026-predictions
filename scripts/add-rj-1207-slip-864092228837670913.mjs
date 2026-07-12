import { readFileSync, writeFileSync } from "node:fs";

// --- Rj's DOUBLE placed 12/07 18:34 (1xBet) — semi-final slate ---
// Two match-parlays folded into one double (flat multiLeg acca; whole slip wins
// only if EVERY leg lands). Each leg carries its own matchId.
// Fixtures: England v Argentina eng-arg-2026-07-15 (England home, 16/07 03:00
//   MYT) · France v Spain fra-esp-2026-07-14 (France home, semi, 15/07 03:00).
const P = "data/bets.json";
const b = JSON.parse(readFileSync(P, "utf8"));

const ENG = "eng-arg-2026-07-15";
const FRA = "fra-esp-2026-07-14";

// Bet Ticket #864092228837670913 (Purchase 864092228837670912) —
//   Double @48.46 = 6.36 (ENG-ARG) × 7.62 (FRA-ESP). RM50 -> RM2,423.16.
const slip = {
  id: "sp-864092228837670913",
  slipNo: "864092228837670913",
  matchId: ENG,
  player: "Double · England/Argentina + France/Spain",
  market: "Double (2 parlays) · 11 legs",
  label:
    "REAL 1xBet DOUBLE 864092228837670913 (12/07) @48.46, RM50 -> RM2,423.16. " +
    "2 parlays: [ENG-ARG @6.36] Draw (X) · Total U3.5 · Bellingham O0.5 SOT · " +
    "Messi O0.5 SOT. " +
    "[FRA-ESP @7.62] France to qualify · Total U4.5 · Doue O0.5 SOT · " +
    "Mbappe O0.5 SOT · Dembele O0.5 SOT · Oyarzabal O0.5 shots · " +
    "France team corners O4.5.",
  odds: 48.46,
  stake: 50,
  placedAt: "12/07",
  grade: {
    type: "multiLeg",
    legs: [
      // England v Argentina (@6.36)
      { matchId: ENG, kind: "result", outcome: "X" },
      { matchId: ENG, kind: "totalUnder", line: 3.5 },
      { matchId: ENG, kind: "playerSotOver", player: "Jude Bellingham", line: 0.5 },
      { matchId: ENG, kind: "playerSotOver", player: "Lionel Messi", line: 0.5 },
      // France v Spain (@7.62) — France home
      { matchId: FRA, kind: "qualify", side: "home" },
      { matchId: FRA, kind: "totalUnder", line: 4.5 },
      { matchId: FRA, kind: "playerSotOver", player: "Désiré Doué", line: 0.5 },
      { matchId: FRA, kind: "playerSotOver", player: "Kylian Mbappe", line: 0.5 },
      { matchId: FRA, kind: "playerSotOver", player: "Ousmane Dembélé", line: 0.5 },
      { matchId: FRA, kind: "playerShotsOver", player: "Mikel Oyarzabal", line: 0.5 },
      { matchId: FRA, kind: "teamCornersOver", side: "home", line: 4.5 }, // France team corners O4.5
    ],
  },
};

const existing = new Set(b.specials.map((s) => s.slipNo));
if (existing.has(slip.slipNo)) {
  console.log("SKIP (already present):", slip.slipNo);
} else {
  b.specials.push(slip);
  console.log("ADDED:", slip.slipNo, "| legs:", slip.grade.legs.length);
}
writeFileSync(P, JSON.stringify(b, null, 2) + "\n");
console.log("specials:", b.specials.length);
