import { readFileSync, writeFileSync } from "node:fs";

// --- 1. Fixture: France - Morocco QF (ESPN-verified 2026-07-09T20:00Z, Gillette Stadium) ---
const FP = "data/fixtures.json";
const fixtures = JSON.parse(readFileSync(FP, "utf8"));
const FRA_MAR = "fra-mar-2026-07-09";
if (!fixtures.some((f) => f.id === FRA_MAR)) {
  const fx = {
    id: FRA_MAR,
    group: "",
    round: "Quarter-final",
    home: { name: "France", flag: "🇫🇷" },
    away: { name: "Morocco", flag: "🇲🇦" },
    venue: "Gillette Stadium",
    city: "Foxborough, Massachusetts",
    kickoffUTC: "2026-07-09T20:00:00.000Z",
    etLabel: "16:00 ET",
  };
  // insert in kickoff order
  const idx = fixtures.findIndex((f) => f.kickoffUTC > fx.kickoffUTC);
  if (idx === -1) fixtures.push(fx);
  else fixtures.splice(idx, 0, fx);
  writeFileSync(FP, JSON.stringify(fixtures, null, 2) + "\n");
  console.log("FIXTURE ADDED:", FRA_MAR);
} else {
  console.log("FIXTURE ALREADY PRESENT:", FRA_MAR);
}

// --- 2. Slip 84054834813 (Rj, 06/07 11:11, RM100 5-fold @ 25.931) ---
const P = "data/bets.json";
const b = JSON.parse(readFileSync(P, "utf8"));

const M = {
  porEsp: "por-esp-2026-07-06",
  usaBel: "usa-bel-2026-07-07",
  argEgy: "arg-egy-2026-07-07",
  suiCol: "sui-col-2026-07-07",
  fraMar: FRA_MAR,
};

const slip = {
  id: "sp-84054834813",
  slipNo: "84054834813",
  matchId: M.porEsp,
  player: "5-game acca",
  market: "Accumulator (5) — Player G+A / BTTS",
  label:
    "REAL 1xBet slip 84054834813 (06/07 11:11) — 5-fold @ 25.931, RM100 -> RM2593.14. " +
    "Por/Esp Mikel Oyarzabal Goals+Assists Over 0.5 (1.95) · USA/Bel Folarin Balogun Goals+Assists Over 0.5 (2.25) · " +
    "Arg/Egy Lionel Messi Goals+Assists Over 0.5 (1.5) · Sui/Col Both Teams To Score Yes (1.98) · " +
    "Fra/Mar Both Teams To Score Yes (1.99).",
  odds: 25.931,
  stake: 100,
  placedAt: "06/07 11:11",
  grade: {
    type: "multiLeg",
    legs: [
      { matchId: M.porEsp, kind: "goalsAssistsOver", player: "Mikel Oyarzabal", line: 0.5, odds: 1.95 },
      { matchId: M.usaBel, kind: "goalsAssistsOver", player: "Folarin Balogun", line: 0.5, odds: 2.25 },
      { matchId: M.argEgy, kind: "goalsAssistsOver", player: "Lionel Messi", line: 0.5, odds: 1.5 },
      { matchId: M.suiCol, kind: "btts", odds: 1.98 },
      { matchId: M.fraMar, kind: "btts", odds: 1.99 },
    ],
  },
};

const existing = new Set(b.specials.map((s) => s.slipNo));
if (existing.has(slip.slipNo)) {
  console.log("SKIP (already present):", slip.slipNo);
} else {
  b.specials.push(slip);
  writeFileSync(P, JSON.stringify(b, null, 2) + "\n");
  console.log("ADDED:", slip.slipNo);
}
console.log(`specials: ${b.specials.length}`);
