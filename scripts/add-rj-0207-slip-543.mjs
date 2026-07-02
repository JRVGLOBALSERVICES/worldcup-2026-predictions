// One-off: append Rj's REAL 1xBet acca slip 83866867543 (02/07 slate, accepted 18:07) to data/bets.json.
// Image-confirmed 3-leg acca @ 7.158, RM70 → RM501.08. DISTINCT from the 10-leg slips.
// Uses COMBO markets: "1X And BTTS" is one bookie market = two AND legs (doubleChance 1X + btts).
//   1  Portugal–Croatia   1X & BTTS Yes   2.06  -> doubleChance 1X (Portugal) + btts
//   2  Spain–Austria      Total Under 3.5 1.43  -> totalUnder 3.5
//   3  Switzerland–Algeria 1X & BTTS Yes  2.43  -> doubleChance 1X (Switzerland) + btts
// Odds product: 2.06 * 1.43 * 2.43 = 7.158 (exact).
import { readFileSync, writeFileSync } from "node:fs";

const path = new URL("../data/bets.json", import.meta.url);
const b = JSON.parse(readFileSync(path, "utf8"));
b.specials = b.specials || [];

const slipNo = "83866867543";
const have = new Set((b.specials || []).map((x) => x.slipNo));

if (have.has(slipNo)) {
  console.log("slip already present — no-op");
} else {
  b.specials.push({
    id: `sp-${slipNo}`,
    slipNo,
    matchId: "por-cro-2026-07-02",
    player: "Portugal/Spain/Switzerland",
    market: "Accumulator (3)",
    label:
      "REAL 1xBet acca (slip 83866867543, accepted 02/07 18:07) — 3 legs @ 7.158, RM70 → RM501.08. " +
      "Por/Cro 1X & BTTS · Esp/Aut Under 3.5 · Swi/Alg 1X & BTTS.",
    odds: 7.158,
    stake: 70,
    placedAt: "02/07 18:07",
    grade: {
      type: "multiLeg",
      legs: [
        { matchId: "por-cro-2026-07-02", kind: "doubleChance", outcome: "1X" }, // 2.06 combo
        { matchId: "por-cro-2026-07-02", kind: "btts" },                        //   (same market)
        { matchId: "esp-aut-2026-07-02", kind: "totalUnder", line: 3.5 },       // 1.43
        { matchId: "sui-alg-2026-07-03", kind: "doubleChance", outcome: "1X" }, // 2.43 combo
        { matchId: "sui-alg-2026-07-03", kind: "btts" },                        //   (same market)
      ],
    },
  });
  writeFileSync(path, JSON.stringify(b, null, 2) + "\n");
  console.log("added slip", slipNo, "| specials now:", b.specials.length);
}
