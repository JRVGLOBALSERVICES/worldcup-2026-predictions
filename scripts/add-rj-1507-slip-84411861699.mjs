import { readFileSync, writeFileSync, copyFileSync } from "node:fs";

// --- Rj's 1xBet SINGLE special placed 15/07 00:39 — Enhanced Daily Special ---
// Slip 84411861699 · odds 26 · stake RM30 · max winnings RM780.
// Selection: "Each team to have 2+ shots on target in EACH HALF in the World Cup
//   2026 matches — Yes" (Accumulator Outcomes France-Spain, England-Argentina).
// This is the SOT twin of the GK-saves acca 84405934229. Per-half SOT IS carried
// by the ESPN summary feed (sotByHalf), so unlike the GK-saves market this one
// auto-grades via a multiLeg combo of `eachTeamSotEachHalfAtLeast` (line 2), one
// leg per match. Anchored to the France-Spain match so it lands on the featured
// card and counts toward the running total.
const P = "data/bets.json";
copyFileSync(P, `${P}.bak-1507-84411861699`);
const b = JSON.parse(readFileSync(P, "utf8"));
b.specials = b.specials ?? [];

const slipNo = "84411861699";
if (b.specials.some((s) => s.slipNo === slipNo)) {
  console.log("already present — no-op");
  process.exit(0);
}

b.specials.push({
  id: `sp-${slipNo}`,
  slipNo,
  matchId: "fra-esp-2026-07-14",
  player: "Enhanced Daily Special",
  market: "Each team 2+ shots on target each half — acca (FRA-ESP + ENG-ARG)",
  label:
    "REAL 1xBet ACCA 84411861699 (15/07) @26, RM30.00 -> RM780.00. Enhanced " +
    "Daily Special: each team to have 2+ shots on target in EACH HALF — " +
    "France-Spain + England-Argentina. Auto-grades off ESPN per-half SOT.",
  odds: 26,
  stake: 30,
  placedAt: "15/07 00:39",
  grade: {
    type: "multiLeg",
    legs: [
      { matchId: "fra-esp-2026-07-14", kind: "eachTeamSotEachHalfAtLeast", line: 2 },
      { matchId: "eng-arg-2026-07-15", kind: "eachTeamSotEachHalfAtLeast", line: 2 },
    ],
  },
  reliable: false,
});

writeFileSync(P, JSON.stringify(b, null, 2) + "\n");
console.log("added special", slipNo, "· total specials:", b.specials.length);
