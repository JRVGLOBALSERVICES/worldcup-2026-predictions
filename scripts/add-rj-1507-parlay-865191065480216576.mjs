import { readFileSync, writeFileSync, copyFileSync } from "node:fs";

// --- Rj's MATCH PARLAY placed 15/07 19:20 (1xBet) — England v Argentina ---
// Single-match parlay on the England v Argentina semi
// (eng-arg-2026-07-15, England home, Argentina away, 16/07 03:00 MYT).
// One flat multiLeg acca; the whole slip wins only if EVERY leg lands.
// Every leg kind is already auto-gradable (result, totalOver, btts,
// scoredOrAssisted, gkSavesOver) → settles off ESPN at FT, no engine changes.
const P = "data/bets.json";
copyFileSync(P, `${P}.bak-1507-865191`);
const b = JSON.parse(readFileSync(P, "utf8"));
b.specials = b.specials ?? [];

const EA = "eng-arg-2026-07-15";

const slips = [
  // #865191065480216576 — Match Parlay @22.28, RM100 -> RM2,228.00. 6 legs.
  {
    id: "sp-865191065480216576",
    slipNo: "865191065480216576",
    matchId: EA,
    player: "Match Parlay · England/Argentina",
    market: "Match Parlay · 6 legs",
    label:
      "REAL 1xBet MATCH PARLAY 865191065480216576 (15/07) @22.28, RM100 -> RM2,228.00. " +
      "[ENG-ARG] Argentina (FT 1X2) · Total O1.5 · BTTS Yes · Messi score-or-assist · " +
      "Bellingham score-or-assist · E.Martínez O1.5 GK saves.",
    odds: 22.28,
    stake: 100,
    placedAt: "15/07 19:20",
    grade: {
      type: "multiLeg",
      legs: [
        { matchId: EA, kind: "result", outcome: "2" }, // Argentina win in 90
        { matchId: EA, kind: "totalOver", line: 1.5 },
        { matchId: EA, kind: "btts" },
        { matchId: EA, kind: "scoredOrAssisted", player: "Lionel Messi" },
        { matchId: EA, kind: "scoredOrAssisted", player: "Jude Bellingham" },
        { matchId: EA, kind: "gkSavesOver", player: "Emiliano Martínez", side: "away", line: 1.5 },
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
    console.log("ADDED:", slip.slipNo, "| legs:", slip.grade.legs.length);
  }
}
writeFileSync(P, JSON.stringify(b, null, 2) + "\n");
console.log("specials:", b.specials.length);
