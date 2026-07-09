import { readFileSync, writeFileSync } from "node:fs";

// --- Slip 84198156743 (Rj, 09/07 23:03, RM10 4-fold 1X+BTTS-Yes acca @31.181 -> RM311.81) ---
const P = "data/bets.json";
const b = JSON.parse(readFileSync(P, "utf8"));

const slip = {
  id: "sp-84198156743",
  slipNo: "84198156743",
  matchId: "fra-mar-2026-07-09",
  player: "—",
  market: "4-fold · 1X + Both Teams To Score — Yes",
  label:
    "REAL 1xBet slip 84198156743 (09/07 23:03) — 4-fold acca @31.181, RM10 -> RM311.81. " +
    "Every leg: Double Chance 1X AND Both Teams To Score - Yes. " +
    "France/Draw + BTTS (FRA-MAR @2.3) · Spain/Draw + BTTS (ESP-BEL @2.04) · " +
    "Norway/Draw + BTTS (NOR-ENG @2.84) · Argentina/Draw + BTTS (ARG-SUI @2.34).",
  odds: 31.181,
  stake: 10,
  placedAt: "09/07 23:03",
  grade: {
    type: "multiLeg",
    legs: [
      { matchId: "fra-mar-2026-07-09", kind: "doubleChanceBtts", outcome: "1X", odds: 2.3 },
      { matchId: "esp-bel-2026-07-10", kind: "doubleChanceBtts", outcome: "1X", odds: 2.04 },
      { matchId: "nor-eng-2026-07-11", kind: "doubleChanceBtts", outcome: "1X", odds: 2.84 },
      { matchId: "arg-swi-2026-07-12", kind: "doubleChanceBtts", outcome: "1X", odds: 2.34 },
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
