import { readFileSync, writeFileSync } from "node:fs";

// --- Slip 862196710024871936 (Rj, 07/07 ~04:35, RM200 Arg/Egy Match Parlay @14.35 -> RM2870) ---
const P = "data/bets.json";
const b = JSON.parse(readFileSync(P, "utf8"));
const ARG = "arg-egy-2026-07-07";

const slip = {
  id: "sp-862196710024871937",
  slipNo: "862196710024871937",
  matchId: ARG,
  player: "Match Parlay (9)",
  market: "Match Parlay (9) — Arg/Egy: DC + Qualify + Totals + Scorer + Shots + Score/Assist",
  label:
    "REAL 1xBet slip 862196710024871937 (07/07) — Arg/Egy Match Parlay @14.35, RM200 -> RM2870. " +
    "Argentina or Tie (Double Chance) · Argentina To Qualify · Under 5.5 Total Goals · " +
    "Lionel Messi Anytime Scorer · Over 1.5 Total Goals · Mahmoud Saber 1+ Shots · " +
    "Mohamed Salah 1+ Shots · Emam Ashour 1+ Shots · Alexis Mac Allister To Score Or Assist.",
  odds: 14.35,
  stake: 200,
  placedAt: "07/07 04:35",
  grade: {
    type: "multiLeg",
    legs: [
      { matchId: ARG, kind: "doubleChance", outcome: "1X" },
      { matchId: ARG, kind: "qualify", side: "home" },
      { matchId: ARG, kind: "totalUnder", line: 5.5 },
      { matchId: ARG, kind: "scored", player: "Lionel Messi" },
      { matchId: ARG, kind: "totalOver", line: 1.5 },
      { matchId: ARG, kind: "playerShotsOver", line: 0.5, player: "Mahmoud Saber" },
      { matchId: ARG, kind: "playerShotsOver", line: 0.5, player: "Mohamed Salah" },
      { matchId: ARG, kind: "playerShotsOver", line: 0.5, player: "Emam Ashour" },
      { matchId: ARG, kind: "scoredOrAssisted", player: "Alexis Mac Allister" },
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
