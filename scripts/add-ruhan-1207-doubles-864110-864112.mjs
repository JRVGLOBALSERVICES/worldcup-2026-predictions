// One-off: append RUHAN's three DOUBLES placed 12/07 (1xBet) — semi-final slate —
// to data/bets-ruhan.json (his scoped file, NOT Rj's bets.json).
// Each double = two match-parlays folded into one flat multiLeg acca; the whole
// slip wins only if EVERY leg lands. Each leg carries its own matchId.
//   Slip 1 864110157557837824 — RM60  @27.46 -> RM1,648.08 (13 legs)
//   Slip 2 864110849685159936 — RM45  @48.28 -> RM2,172.95 (9 legs)
//   Slip 3 864112172149121024 — RM45  @38.22 -> RM1,720.06 (11 legs)
// Fixtures: England v Argentina eng-arg-2026-07-15 (England home) ·
//           France v Spain     fra-esp-2026-07-14 (France home, semi).
// Every leg maps to an existing auto-grading kind — verified against the grader
// this session; no new grader kind needed.
import { readFileSync, writeFileSync } from "node:fs";

const path = new URL("../data/bets-ruhan.json", import.meta.url);
const b = JSON.parse(readFileSync(path, "utf8"));
b.specials = b.specials || [];

const ENG = "eng-arg-2026-07-15"; // England (home) v Argentina (away)
const FRA = "fra-esp-2026-07-14"; // France (home) v Spain (away)

const have = new Set([
  ...(b.bets || []).map((x) => x.slipNo).filter(Boolean),
  ...b.specials.map((x) => x.slipNo),
]);

const slips = [
  // Slip 1 — Double @27.46 = 4.36 (FRA-ESP) × 6.30 (ENG-ARG). RM60 -> RM1,648.08
  {
    slipNo: "864110157557837824",
    matchId: FRA,
    player: "Double · France/Spain + England/Argentina",
    market: "Double (2 parlays) · 13 legs",
    odds: 27.46,
    stake: 60,
    placedAt: "12/07",
    label:
      "REAL 1xBet DOUBLE 864110157557837824 (12/07) @27.46, RM60 -> RM1,648.08. " +
      "2 parlays: [FRA-ESP @4.36] Total O0.5 · Maignan O1.5 saves · " +
      "Upamecano O0.5 tackles · Doue O0.5 SOT · Mbappe O0.5 SOT · " +
      "Rabiot O0.5 shots · Total U4.5 · France or Tie (DC). " +
      "[ENG-ARG @6.30] Total O0.5 · Tie or Argentina (DC) · " +
      "Messi to score or assist · Mac Allister O0.5 SOT · Total U4.5.",
    legs: [
      // France v Spain (@4.36)
      { matchId: FRA, kind: "totalOver", line: 0.5 },
      { matchId: FRA, kind: "gkSavesOver", player: "Mike Maignan", side: "home", line: 1.5 },
      { matchId: FRA, kind: "playerTacklesOver", player: "Dayot Upamecano", line: 0.5 },
      { matchId: FRA, kind: "playerSotOver", player: "Désiré Doué", line: 0.5 },
      { matchId: FRA, kind: "playerSotOver", player: "Kylian Mbappe", line: 0.5 },
      { matchId: FRA, kind: "playerShotsOver", player: "Adrien Rabiot", line: 0.5 },
      { matchId: FRA, kind: "totalUnder", line: 4.5 },
      { matchId: FRA, kind: "doubleChance", outcome: "1X" }, // France or Tie (France home)
      // England v Argentina (@6.30)
      { matchId: ENG, kind: "totalOver", line: 0.5 },
      { matchId: ENG, kind: "doubleChance", outcome: "X2" }, // Tie or Argentina (Argentina away)
      { matchId: ENG, kind: "scoredOrAssisted", player: "Lionel Messi" },
      { matchId: ENG, kind: "playerSotOver", player: "Alexis Mac Allister", line: 0.5 },
      { matchId: ENG, kind: "totalUnder", line: 4.5 },
    ],
  },
  // Slip 2 — Double @48.28 = 10.34 (FRA-ESP) × 4.67 (ENG-ARG). RM45 -> RM2,172.95
  {
    slipNo: "864110849685159936",
    matchId: FRA,
    player: "Double · France/Spain + England/Argentina",
    market: "Double (2 parlays) · 9 legs",
    odds: 48.28,
    stake: 45,
    placedAt: "12/07",
    label:
      "REAL 1xBet DOUBLE 864110849685159936 (12/07) @48.28, RM45 -> RM2,172.95. " +
      "2 parlays: [FRA-ESP @10.34] Draw (X) · Rabiot O0.5 shots · " +
      "Mbappe O0.5 SOT · Doue O0.5 SOT · Fabian Ruiz O0.5 shots · Total U4.5. " +
      "[ENG-ARG @4.67] Draw (X) · Total U4.5 · Bellingham O0.5 SOT.",
    legs: [
      // France v Spain (@10.34)
      { matchId: FRA, kind: "result", outcome: "X" },
      { matchId: FRA, kind: "playerShotsOver", player: "Adrien Rabiot", line: 0.5 },
      { matchId: FRA, kind: "playerSotOver", player: "Kylian Mbappe", line: 0.5 },
      { matchId: FRA, kind: "playerSotOver", player: "Désiré Doué", line: 0.5 },
      { matchId: FRA, kind: "playerShotsOver", player: "Fabián Ruiz", line: 0.5 },
      { matchId: FRA, kind: "totalUnder", line: 4.5 },
      // England v Argentina (@4.67)
      { matchId: ENG, kind: "result", outcome: "X" },
      { matchId: ENG, kind: "totalUnder", line: 4.5 },
      { matchId: ENG, kind: "playerSotOver", player: "Jude Bellingham", line: 0.5 },
    ],
  },
  // Slip 3 — Double @38.22 = 6.36 (ENG-ARG) × 6.01 (FRA-ESP). RM45 -> RM1,720.06
  {
    slipNo: "864112172149121024",
    matchId: ENG,
    player: "Double · England/Argentina + France/Spain",
    market: "Double (2 parlays) · 11 legs",
    odds: 38.22,
    stake: 45,
    placedAt: "12/07",
    label:
      "REAL 1xBet DOUBLE 864112172149121024 (12/07) @38.22, RM45 -> RM1,720.06. " +
      "2 parlays: [ENG-ARG @6.36] Draw (X) · Bellingham O0.5 SOT · " +
      "Messi O0.5 SOT · Total U3.5. " +
      "[FRA-ESP @6.01] Total U4.5 · France to qualify · Mbappe O0.5 SOT · " +
      "Dembele O0.5 SOT · Oyarzabal O0.5 shots · France team corners O4.5 · " +
      "Upamecano O0.5 tackles.",
    legs: [
      // England v Argentina (@6.36)
      { matchId: ENG, kind: "result", outcome: "X" },
      { matchId: ENG, kind: "playerSotOver", player: "Jude Bellingham", line: 0.5 },
      { matchId: ENG, kind: "playerSotOver", player: "Lionel Messi", line: 0.5 },
      { matchId: ENG, kind: "totalUnder", line: 3.5 },
      // France v Spain (@6.01)
      { matchId: FRA, kind: "totalUnder", line: 4.5 },
      { matchId: FRA, kind: "qualify", side: "home" },
      { matchId: FRA, kind: "playerSotOver", player: "Kylian Mbappe", line: 0.5 },
      { matchId: FRA, kind: "playerSotOver", player: "Ousmane Dembele", line: 0.5 },
      { matchId: FRA, kind: "playerShotsOver", player: "Mikel Oyarzabal", line: 0.5 },
      { matchId: FRA, kind: "teamCornersOver", side: "home", line: 4.5 }, // France team corners O4.5
      { matchId: FRA, kind: "playerTacklesOver", player: "Dayot Upamecano", line: 0.5 },
    ],
  },
];

let added = 0;
for (const s of slips) {
  if (have.has(s.slipNo)) continue;
  b.specials.push({
    id: `sp-${s.slipNo}`,
    slipNo: s.slipNo,
    matchId: s.matchId,
    player: s.player,
    market: s.market,
    label: s.label,
    odds: s.odds,
    stake: s.stake,
    placedAt: s.placedAt,
    grade: { type: "multiLeg", legs: s.legs },
  });
  added++;
}

writeFileSync(path, JSON.stringify(b, null, 2) + "\n");
console.log("added:", added, "| specials now:", b.specials.length);
