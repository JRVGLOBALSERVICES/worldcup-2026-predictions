import { readFileSync, writeFileSync } from "node:fs";

// --- Slip 84055479289 (Rj, 06/07 11:43, RM50 5-fold @ 70.641 -> RM3532.05) ---
const P = "data/bets.json";
const b = JSON.parse(readFileSync(P, "utf8"));

const M = {
  porEsp: "por-esp-2026-07-06",
  usaBel: "usa-bel-2026-07-07",
  argEgy: "arg-egy-2026-07-07",
  suiCol: "sui-col-2026-07-07",
  fraMar: "fra-mar-2026-07-09",
};

const slip = {
  id: "sp-84055479289",
  slipNo: "84055479289",
  matchId: M.porEsp,
  player: "5-game acca",
  market: "Accumulator (5) — Anytime Scorer / 1X+BTTS / Player G+A",
  label:
    "REAL 1xBet slip 84055479289 (06/07 11:43) — 5-fold @ 70.641, RM50 -> RM3532.05. " +
    "Por/Esp Mikel Oyarzabal To Score At Any Time Yes (2.43) · USA/Bel Romelu Lukaku To Score At Any Time Yes (2.25) · " +
    "Arg/Egy Lionel Messi To Score At Any Time Yes (1.82) · Fra/Mar 1X And Both Teams To Score Yes (2.29) · " +
    "Sui/Col Breel Embolo Total Goals + Assists Combined Over 0.5 (3.1).",
  odds: 70.641,
  stake: 50,
  placedAt: "06/07 11:43",
  grade: {
    type: "multiLeg",
    legs: [
      { matchId: M.porEsp, kind: "scored", player: "Mikel Oyarzabal", odds: 2.43 },
      { matchId: M.usaBel, kind: "scored", player: "Romelu Lukaku", odds: 2.25 },
      { matchId: M.argEgy, kind: "scored", player: "Lionel Messi", odds: 1.82 },
      { matchId: M.fraMar, kind: "doubleChanceBtts", outcome: "1X", odds: 2.29 },
      { matchId: M.suiCol, kind: "goalsAssistsOver", player: "Breel Embolo", line: 0.5, odds: 3.1 },
    ],
  },
};

// sanity: per-leg product must reproduce the slip odds
const product = slip.grade.legs.reduce((a, l) => a * l.odds, 1);
if (Math.abs(product - slip.odds) > 0.01) {
  throw new Error(`odds mismatch: legs product ${product.toFixed(4)} vs slip ${slip.odds}`);
}

const existing = new Set(b.specials.map((s) => s.slipNo));
if (existing.has(slip.slipNo)) {
  console.log("SKIP (already present):", slip.slipNo);
} else {
  b.specials.push(slip);
  writeFileSync(P, JSON.stringify(b, null, 2) + "\n");
  console.log("ADDED:", slip.slipNo, "| legs product", product.toFixed(4));
}
console.log(`specials: ${b.specials.length}`);
