import { readFileSync, writeFileSync } from "node:fs";

// --- Slip 863077516947718145 (Suriyati via Rj's tracker, 09/07 23:21) ---
// 1xBet same-match parlay on FRA-MAR, RM60 @2.10 -> RM126.
// Purchase ticket 863077516947718144 / bet ticket 863077516947718145.
const P = "data/bets.json";
const b = JSON.parse(readFileSync(P, "utf8"));

const slip = {
  id: "sp-863077516947718145",
  slipNo: "863077516947718145",
  matchId: "fra-mar-2026-07-09",
  player: "—",
  market: "Same-match parlay · Over 0.5 + France to qualify + Under 5.5 + Mbappe anytime",
  label:
    "REAL 1xBet slip 863077516947718145 (09/07 23:21) — same-match parlay on FRA-MAR " +
    "@2.10, RM60 -> RM126. Legs: Total Goals Over 0.5 · France To Qualify (any means " +
    "incl. ET/pens) · Total Goals Under 5.5 · Kylian Mbappe anytime scorer.",
  odds: 2.1,
  stake: 60,
  placedAt: "09/07 23:21",
  punter: "Suriyati",
  grade: {
    type: "multiLeg",
    legs: [
      { matchId: "fra-mar-2026-07-09", kind: "totalOver", line: 0.5 },
      { matchId: "fra-mar-2026-07-09", kind: "qualify", side: "home" },
      { matchId: "fra-mar-2026-07-09", kind: "totalUnder", line: 5.5 },
      { matchId: "fra-mar-2026-07-09", kind: "scored", player: "Kylian Mbappe" },
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
