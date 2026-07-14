import { readFileSync, writeFileSync } from "node:fs";

// --- Rj's 2 MATCH PARLAYS placed 14/07 19:05–19:08 (1xBet) — France v Spain ---
// Single-match parlays (not doubles). Each is one flat multiLeg acca on the
// France v Spain semi; the whole slip wins only if EVERY leg lands.
// Fixture: France v Spain fra-esp-2026-07-14 (France home, semi, 15/07 03:00 MYT).
const P = "data/bets.json";
const b = JSON.parse(readFileSync(P, "utf8"));

const FRA = "fra-esp-2026-07-14";

const slips = [
  // #864825629777477633 — Match Parlay @13.35, RM100 -> RM1,335.00. 9 legs, all FRA.
  {
    id: "sp-864825629777477633",
    slipNo: "864825629777477633",
    matchId: FRA,
    player: "Match Parlay · France/Spain",
    market: "Match Parlay · 9 legs",
    label:
      "REAL 1xBet MATCH PARLAY 864825629777477633 (14/07) @13.35, RM100 -> RM1,335.00. " +
      "[FRA-ESP] Yamal O0.5 SOT · Dembele O0.5 SOT · Upamecano O0.5 tackles · " +
      "France to qualify · Total U5.5 · Mbappe anytime scorer · Doue O0.5 SOT · " +
      "Oyarzabal O0.5 SOT · France to win (FT 1X2).",
    odds: 13.35,
    stake: 100,
    placedAt: "14/07",
    grade: {
      type: "multiLeg",
      legs: [
        { matchId: FRA, kind: "playerSotOver", player: "Lamine Yamal", line: 0.5 },
        { matchId: FRA, kind: "playerSotOver", player: "Ousmane Dembélé", line: 0.5 },
        { matchId: FRA, kind: "playerTacklesOver", player: "Dayot Upamecano", line: 0.5 },
        { matchId: FRA, kind: "qualify", side: "home" },
        { matchId: FRA, kind: "totalUnder", line: 5.5 },
        { matchId: FRA, kind: "scored", player: "Kylian Mbappe" },
        { matchId: FRA, kind: "playerSotOver", player: "Désiré Doué", line: 0.5 },
        { matchId: FRA, kind: "playerSotOver", player: "Mikel Oyarzabal", line: 0.5 },
        { matchId: FRA, kind: "result", outcome: "1" }, // France (home) to win in 90
      ],
    },
  },

  // #864825025936187393 — Match Parlay @13.04, RM100 -> RM1,304.00. 6 legs, all FRA.
  {
    id: "sp-864825025936187393",
    slipNo: "864825025936187393",
    matchId: FRA,
    player: "Match Parlay · France/Spain",
    market: "Match Parlay · 6 legs",
    label:
      "REAL 1xBet MATCH PARLAY 864825025936187393 (14/07) @13.04, RM100 -> RM1,304.00. " +
      "[FRA-ESP] Total U3.5 · Mbappe O1.5 SOT · Yamal O0.5 SOT · Dembele O0.5 SOT · " +
      "Draw (FT 1X2) · Upamecano O0.5 tackles.",
    odds: 13.04,
    stake: 100,
    placedAt: "14/07",
    grade: {
      type: "multiLeg",
      legs: [
        { matchId: FRA, kind: "totalUnder", line: 3.5 },
        { matchId: FRA, kind: "playerSotOver", player: "Kylian Mbappe", line: 1.5 },
        { matchId: FRA, kind: "playerSotOver", player: "Lamine Yamal", line: 0.5 },
        { matchId: FRA, kind: "playerSotOver", player: "Ousmane Dembélé", line: 0.5 },
        { matchId: FRA, kind: "result", outcome: "X" }, // Draw in 90
        { matchId: FRA, kind: "playerTacklesOver", player: "Dayot Upamecano", line: 0.5 },
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
