import { readFileSync, writeFileSync, copyFileSync } from "node:fs";

// --- Rj's MATCH PARLAY placed 16/07 00:23 (1xBet) — England v Argentina ---
// Single-match parlay on the England v Argentina semi
// (eng-arg-2026-07-15, England home, Argentina away, 16/07 03:00 MYT).
// One flat multiLeg acca; the whole slip wins only if EVERY leg lands.
// Every leg kind is already auto-gradable (totalOver, btts, scoredOrAssisted,
// gkSavesOver, doubleChance, teamCornersOver) → settles off ESPN at FT,
// no engine changes.
const P = "data/bets.json";
copyFileSync(P, `${P}.bak-1607-865267`);
const b = JSON.parse(readFileSync(P, "utf8"));
b.specials = b.specials ?? [];

const EA = "eng-arg-2026-07-15";

const slips = [
  // #865267429747163136 — Match Parlay @18.85, RM150 -> RM2,827.50. 7 legs.
  {
    id: "sp-865267429747163136",
    slipNo: "865267429747163136",
    matchId: EA,
    player: "Match Parlay · England/Argentina",
    market: "Match Parlay · 7 legs",
    label:
      "REAL 1xBet MATCH PARLAY 865267429747163136 (16/07) @18.85, RM150 -> RM2,827.50. " +
      "[ENG-ARG] Total O1.5 · BTTS Yes · Messi score-or-assist · Bellingham score-or-assist · " +
      "E.Martínez O1.5 GK saves · England-or-Argentina (Double Chance 12) · " +
      "Argentina team corners O3.5.",
    odds: 18.85,
    stake: 150,
    placedAt: "16/07 00:23",
    grade: {
      type: "multiLeg",
      legs: [
        { matchId: EA, kind: "totalOver", line: 1.5 },
        { matchId: EA, kind: "btts" },
        { matchId: EA, kind: "scoredOrAssisted", player: "Lionel Messi" },
        { matchId: EA, kind: "scoredOrAssisted", player: "Jude Bellingham" },
        { matchId: EA, kind: "gkSavesOver", player: "Emiliano Martínez", side: "away", line: 1.5 },
        { matchId: EA, kind: "doubleChance", outcome: "12" }, // England or Argentina (not-draw)
        { matchId: EA, kind: "teamCornersOver", side: "away", line: 3.5 }, // Argentina corners O3.5
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
