// One-off: append Rj's REAL 1xBet acca slip 83866961601 (02/07 slate, accepted 18:10) to data/bets.json.
// Image-confirmed 5-leg acca @ 27.783, RM30 → RM833.51. DISTINCT from the four earlier slips.
//   1  Portugal–Croatia     1X & BTTS Yes    2.06  -> doubleChanceBtts "1X"
//   2  Spain–Austria        Total Under 3.5  1.43  -> totalUnder 3.5
//   3  Switzerland–Algeria  Total Over 2.5   2.214 -> totalOver 2.5
//   4  Australia–Egypt      2X & BTTS Yes    2.84  -> doubleChanceBtts "X2" (draw or Egypt)
//   5  Argentina–Cape Verde Any Team Win To Nil Yes 1.5 -> notBttsAndTotalOver 0.5
//        (win-to-nil = one team blank AND >=1 goal = decisive result, loser scored 0)
// Odds product: 2.06 * 1.43 * 2.214 * 2.84 * 1.5 = 27.784 (rounds to 27.783). RM30 -> RM833.51.
import { readFileSync, writeFileSync } from "node:fs";

const path = new URL("../data/bets.json", import.meta.url);
const b = JSON.parse(readFileSync(path, "utf8"));
b.specials = b.specials || [];

const slipNo = "83866961601";
const have = new Set((b.specials || []).map((x) => x.slipNo));

if (have.has(slipNo)) {
  console.log("slip already present — no-op");
} else {
  b.specials.push({
    id: `sp-${slipNo}`,
    slipNo,
    matchId: "por-cro-2026-07-02",
    player: "Portugal/Spain/Switzerland/Australia/Argentina",
    market: "Accumulator (5)",
    label:
      "REAL 1xBet acca (slip 83866961601, accepted 02/07 18:10) — 5 legs @ 27.783, RM30 → RM833.51. " +
      "Por/Cro 1X & BTTS · Esp/Aut Under 3.5 · Swi/Alg Over 2.5 · Aus/Egy 2X & BTTS · Arg/CPV any team win-to-nil.",
    odds: 27.783,
    stake: 30,
    placedAt: "02/07 18:10",
    grade: {
      type: "multiLeg",
      legs: [
        { matchId: "por-cro-2026-07-02", kind: "doubleChanceBtts", outcome: "1X" },   // 2.06
        { matchId: "esp-aut-2026-07-02", kind: "totalUnder", line: 3.5 },             // 1.43
        { matchId: "sui-alg-2026-07-03", kind: "totalOver", line: 2.5 },              // 2.214
        { matchId: "aus-egy-2026-07-03", kind: "doubleChanceBtts", outcome: "X2" },   // 2.84 (draw or Egypt)
        { matchId: "arg-cpv-2026-07-03", kind: "notBttsAndTotalOver", line: 0.5 },    // 1.5 (any win-to-nil)
      ],
    },
  });
  writeFileSync(path, JSON.stringify(b, null, 2) + "\n");
  console.log("added slip", slipNo, "| specials now:", b.specials.length);
}
