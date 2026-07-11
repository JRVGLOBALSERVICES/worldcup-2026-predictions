import { readFileSync, writeFileSync } from "node:fs";

// --- Rj's ACCUMULATOR placed 12/07 (1xBet) — ticket 84305015491 ---
// 3-leg acca across three knockout matches; whole slip wins only if EVERY leg
// lands (one flat multiLeg, each leg carries its own matchId → grader settles
// per-leg via lib/bets.ts multiLeg).
// Odds @37.254 = 3.875 (NOR-ENG draw) × 2.3 (ARG hcap -1) × 3.8 (FRA total O2)
//   × 1.1 (accumulator bonus). RM50 -> RM1,862.71 max.
// Fixtures: Norway v England  nor-eng-2026-07-11 (Norway home, 05:00 MYT) ·
//   Argentina v Switzerland   arg-sui-2026-07-12 (Argentina home, 09:00 MYT —
//   NOTE: fixture id is arg-SUI, not arg-swi) · France v Spain
//   fra-esp-2026-07-14 (France home, semi-final, 15/07 03:00 MYT).
const P = "data/bets.json";
const b = JSON.parse(readFileSync(P, "utf8"));

const NOR = "nor-eng-2026-07-11";
const ARG = "arg-sui-2026-07-12";
const FRA = "fra-esp-2026-07-14";

const slip = {
  id: "sp-84305015491",
  slipNo: "84305015491",
  matchId: NOR,
  player: "Accumulator · Norway/England + Argentina/Switzerland + France/Spain",
  market: "Accumulator · 3 legs",
  label:
    "REAL 1xBet ACCUMULATOR 84305015491 (12/07) @37.254 (incl. 1.1 acca bonus), " +
    "RM50 -> RM1,862.71. 3 legs: [NOR-ENG @3.875] Draw (X) · " +
    "[ARG-SWI @2.3] Argentina Handicap -1 · " +
    "[FRA-ESP @3.8] France Individual Total Over 2.",
  odds: 37.254,
  stake: 50,
  placedAt: "12/07",
  grade: {
    type: "multiLeg",
    legs: [
      { matchId: NOR, kind: "result", outcome: "X", odds: 3.875 },
      { matchId: ARG, kind: "handicap", side: "home", line: -1, odds: 2.3 },
      { matchId: FRA, kind: "individualTotalOver", side: "home", line: 2, odds: 3.8 },
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
