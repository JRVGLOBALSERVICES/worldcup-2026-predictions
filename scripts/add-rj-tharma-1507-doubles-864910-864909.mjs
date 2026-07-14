import { readFileSync, writeFileSync } from "node:fs";

// --- Rj + Tharma SHARED 50/50 — 2 "Doubles" placed 15/07 00:43–00:44 (1xBet) ---
// Each ticket is a double across two semis: England v Argentina + France v Spain.
// The book calls each event a "Match Parlay" of two players "to Score or Assist";
// the double wins only if ALL players score-or-assist in their own match.
// Flat multiLeg (4 legs) — every leg must land. scoredOrAssisted auto-grades off
// ESPN goal+assist events (accent-safe via deburr).
const P = "data/bets.json";
const b = JSON.parse(readFileSync(P, "utf8"));

const ARG = "eng-arg-2026-07-15"; // England v Argentina, 16/07 03:00 MYT
const FRA = "fra-esp-2026-07-14"; // France v Spain, 15/07 03:00 MYT

const slips = [
  // #864910173079748608 — Double @21.18, RM40 -> RM847.31
  {
    id: "sp-864910173079748608",
    slipNo: "864910173079748608",
    matchId: FRA,
    player: "—",
    market: "Double · Score-or-Assist · 4 legs",
    label:
      "REAL 1xBet DOUBLE 864910173079748608 (15/07 00:44) @21.18, RM40 -> RM847.31 — " +
      "SHARED Rj + Tharma 50/50. [ENG-ARG @5.39] Jude Bellingham to score or assist · " +
      "Lionel Messi to score or assist. [FRA-ESP @3.93] Kylian Mbappé to score or assist · " +
      "Lamine Yamal to score or assist.",
    odds: 21.18,
    stake: 40,
    placedAt: "15/07 00:44",
    punter: "Rj + Tharma · 50/50 (RM20 / RM20)",
    grade: {
      type: "multiLeg",
      legs: [
        { matchId: ARG, kind: "scoredOrAssisted", player: "Jude Bellingham" },
        { matchId: ARG, kind: "scoredOrAssisted", player: "Lionel Messi" },
        { matchId: FRA, kind: "scoredOrAssisted", player: "Kylian Mbappé" },
        { matchId: FRA, kind: "scoredOrAssisted", player: "Lamine Yamal" },
      ],
    },
  },

  // #864909991382573056 — Double @28.84, RM60 -> RM1,730.77
  {
    id: "sp-864909991382573056",
    slipNo: "864909991382573056",
    matchId: FRA,
    player: "—",
    market: "Double · Score-or-Assist · 4 legs",
    label:
      "REAL 1xBet DOUBLE 864909991382573056 (15/07 00:43) @28.84, RM60 -> RM1,730.77 — " +
      "SHARED Rj + Tharma 50/50. [ENG-ARG @7.34] Julián Álvarez to score or assist · " +
      "Jude Bellingham to score or assist. [FRA-ESP @3.93] Kylian Mbappé to score or assist · " +
      "Lamine Yamal to score or assist.",
    odds: 28.84,
    stake: 60,
    placedAt: "15/07 00:43",
    punter: "Rj + Tharma · 50/50 (RM30 / RM30)",
    grade: {
      type: "multiLeg",
      legs: [
        { matchId: ARG, kind: "scoredOrAssisted", player: "Julián Álvarez" },
        { matchId: ARG, kind: "scoredOrAssisted", player: "Jude Bellingham" },
        { matchId: FRA, kind: "scoredOrAssisted", player: "Kylian Mbappé" },
        { matchId: FRA, kind: "scoredOrAssisted", player: "Lamine Yamal" },
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
    console.log("ADDED:", slip.slipNo, "| legs:", slip.grade.legs.length, "|", slip.punter);
  }
}

writeFileSync(P, JSON.stringify(b, null, 2));
console.log("bets.json written. specials count:", b.specials.length);
