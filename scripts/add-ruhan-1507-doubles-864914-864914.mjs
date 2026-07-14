// One-off: append RUHAN's two DOUBLES placed 15/07 (1xBet) — semi-final slate —
// to data/bets-ruhan.json (his scoped file, NOT Rj's bets.json).
// Each double = two match-parlays (score-or-assist doubles) folded into one flat
// multiLeg acca; the whole slip wins only if EVERY leg lands. Each leg carries
// its own matchId. All legs use scoredOrAssisted, verified auto-grading + accent-
// safe this session against the FRA-ESP + ENG-ARG cards.
//   Slip 1 864914105696927744 — RM30 @28.69 -> RM860.98 (4 legs)
//   Slip 2 864914018220515328 — RM20 @21.02 -> RM420.42 (4 legs)
// Fixtures: France v Spain fra-esp-2026-07-14 (France home) ·
//           England v Argentina eng-arg-2026-07-15 (England home).
import { readFileSync, writeFileSync } from "node:fs";

const path = new URL("../data/bets-ruhan.json", import.meta.url);
const b = JSON.parse(readFileSync(path, "utf8"));
b.specials = b.specials || [];

const FRA = "fra-esp-2026-07-14"; // France (home) v Spain (away), 15/07 03:00 MYT
const ENG = "eng-arg-2026-07-15"; // England (home) v Argentina (away), 16/07 03:00 MYT

const have = new Set([
  ...(b.bets || []).map((x) => x.slipNo).filter(Boolean),
  ...b.specials.map((x) => x.slipNo),
]);

const slips = [
  // Slip 1 — Double @28.69 = 3.91 (FRA-ESP) × 7.34 (ENG-ARG). RM30 -> RM860.98
  {
    slipNo: "864914105696927744",
    matchId: FRA,
    player: "Double · France/Spain + England/Argentina",
    market: "Double (2 parlays) · 4 legs · score or assist",
    odds: 28.69,
    stake: 30,
    placedAt: "15/07",
    label:
      "REAL 1xBet DOUBLE 864914105696927744 (15/07) @28.69, RM30 -> RM860.98. " +
      "2 parlays: [FRA-ESP @3.91] Mbappé score or assist · Yamal score or assist. " +
      "[ENG-ARG @7.34] Bellingham score or assist · Álvarez score or assist.",
    legs: [
      { matchId: FRA, kind: "scoredOrAssisted", player: "Kylian Mbappé" },
      { matchId: FRA, kind: "scoredOrAssisted", player: "Lamine Yamal" },
      { matchId: ENG, kind: "scoredOrAssisted", player: "Jude Bellingham" },
      { matchId: ENG, kind: "scoredOrAssisted", player: "Julián Álvarez" },
    ],
  },
  // Slip 2 — Double @21.02 = 3.90 (FRA-ESP) × 5.39 (ENG-ARG). RM20 -> RM420.42
  {
    slipNo: "864914018220515328",
    matchId: FRA,
    player: "Double · France/Spain + England/Argentina",
    market: "Double (2 parlays) · 4 legs · score or assist",
    odds: 21.02,
    stake: 20,
    placedAt: "15/07",
    label:
      "REAL 1xBet DOUBLE 864914018220515328 (15/07) @21.02, RM20 -> RM420.42. " +
      "2 parlays: [FRA-ESP @3.90] Mbappé score or assist · Yamal score or assist. " +
      "[ENG-ARG @5.39] Messi score or assist · Bellingham score or assist.",
    legs: [
      { matchId: FRA, kind: "scoredOrAssisted", player: "Kylian Mbappé" },
      { matchId: FRA, kind: "scoredOrAssisted", player: "Lamine Yamal" },
      { matchId: ENG, kind: "scoredOrAssisted", player: "Lionel Messi" },
      { matchId: ENG, kind: "scoredOrAssisted", player: "Jude Bellingham" },
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
