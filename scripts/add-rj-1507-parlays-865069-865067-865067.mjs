import { readFileSync, writeFileSync, copyFileSync } from "node:fs";

// --- Rj's 3 MATCH PARLAYS placed 15/07 11:07–11:18 (1xBet) — England v Argentina ---
// All three are single-match parlays on the England v Argentina semi
// (eng-arg-2026-07-15, England home, Argentina away, 16/07 03:00 MYT).
// Each is one flat multiLeg acca; the whole slip wins only if EVERY leg lands.
// Every leg kind here is already auto-gradable (playerSotOver, playerTacklesOver,
// totalOver, totalUnder, btts, result, scoredOrAssisted) → will settle off ESPN
// at FT with no engine changes.
const P = "data/bets.json";
copyFileSync(P, `${P}.bak-1507-865069-865067`);
const b = JSON.parse(readFileSync(P, "utf8"));
b.specials = b.specials ?? [];

const EA = "eng-arg-2026-07-15";

const slips = [
  // #865069779194175488 — Match Parlay @22.50, RM100 -> RM2,250.00. 8 legs.
  {
    id: "sp-865069779194175488",
    slipNo: "865069779194175488",
    matchId: EA,
    player: "Match Parlay · England/Argentina",
    market: "Match Parlay · 8 legs",
    label:
      "REAL 1xBet MATCH PARLAY 865069779194175488 (15/07) @22.50, RM100 -> RM2,250.00. " +
      "[ENG-ARG] Total O0.5 · Total U4.5 · Kane O0.5 SOT · Álvarez O0.5 SOT · " +
      "Bellingham O1.5 SOT · L.Martínez O1.5 tackles · BTTS Yes · Messi score-or-assist.",
    odds: 22.5,
    stake: 100,
    placedAt: "15/07 11:18",
    grade: {
      type: "multiLeg",
      legs: [
        { matchId: EA, kind: "totalOver", line: 0.5 },
        { matchId: EA, kind: "totalUnder", line: 4.5 },
        { matchId: EA, kind: "playerSotOver", player: "Harry Kane", line: 0.5 },
        { matchId: EA, kind: "playerSotOver", player: "Julián Álvarez", line: 0.5 },
        { matchId: EA, kind: "playerSotOver", player: "Jude Bellingham", line: 1.5 },
        { matchId: EA, kind: "playerTacklesOver", player: "Lisandro Martínez", line: 1.5 },
        { matchId: EA, kind: "btts" },
        { matchId: EA, kind: "scoredOrAssisted", player: "Lionel Messi" },
      ],
    },
  },

  // #865067968789970944 — Match Parlay @36.58, RM75 -> RM2,743.50. 7 legs.
  {
    id: "sp-865067968789970944",
    slipNo: "865067968789970944",
    matchId: EA,
    player: "Match Parlay · England/Argentina",
    market: "Match Parlay · 7 legs",
    label:
      "REAL 1xBet MATCH PARLAY 865067968789970944 (15/07) @36.58, RM75 -> RM2,743.50. " +
      "[ENG-ARG] Kane O0.5 SOT · Álvarez O0.5 SOT · L.Martínez O0.5 tackles · " +
      "Bellingham score-or-assist · Total O1.5 · Draw (FT 1X2) · Messi score-or-assist.",
    odds: 36.58,
    stake: 75,
    placedAt: "15/07 11:11",
    grade: {
      type: "multiLeg",
      legs: [
        { matchId: EA, kind: "playerSotOver", player: "Harry Kane", line: 0.5 },
        { matchId: EA, kind: "playerSotOver", player: "Julián Álvarez", line: 0.5 },
        { matchId: EA, kind: "playerTacklesOver", player: "Lisandro Martínez", line: 0.5 },
        { matchId: EA, kind: "scoredOrAssisted", player: "Jude Bellingham" },
        { matchId: EA, kind: "totalOver", line: 1.5 },
        { matchId: EA, kind: "result", outcome: "X" }, // Draw in 90
        { matchId: EA, kind: "scoredOrAssisted", player: "Lionel Messi" },
      ],
    },
  },

  // #865067102833967104 — Match Parlay @37.17, RM75 -> RM2,787.75. 7 legs.
  {
    id: "sp-865067102833967104",
    slipNo: "865067102833967104",
    matchId: EA,
    player: "Match Parlay · England/Argentina",
    market: "Match Parlay · 7 legs",
    label:
      "REAL 1xBet MATCH PARLAY 865067102833967104 (15/07) @37.17, RM75 -> RM2,787.75. " +
      "[ENG-ARG] Draw (FT 1X2) · BTTS Yes · Kane O0.5 SOT · Álvarez O0.5 SOT · " +
      "Messi score-or-assist · Bellingham score-or-assist · L.Martínez O0.5 tackles.",
    odds: 37.17,
    stake: 75,
    placedAt: "15/07 11:07",
    grade: {
      type: "multiLeg",
      legs: [
        { matchId: EA, kind: "result", outcome: "X" }, // Draw in 90
        { matchId: EA, kind: "btts" },
        { matchId: EA, kind: "playerSotOver", player: "Harry Kane", line: 0.5 },
        { matchId: EA, kind: "playerSotOver", player: "Julián Álvarez", line: 0.5 },
        { matchId: EA, kind: "scoredOrAssisted", player: "Lionel Messi" },
        { matchId: EA, kind: "scoredOrAssisted", player: "Jude Bellingham" },
        { matchId: EA, kind: "playerTacklesOver", player: "Lisandro Martínez", line: 0.5 },
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
