import { readFileSync, writeFileSync } from "node:fs";

// --- Rj, 08/07 evening — two REAL 1xBet slips ---
//  1) 862643967945744385: FRA-MAR Match Parlay (10 legs) @54.04, RM50 -> RM2702
//  2) 862640332998410241: 4-fold of match parlays @47.07, RM50 -> RM2353.94
//     FRA-MAR @3.82 · NOR-ENG @5.04 · ARG-SUI @2.09 · ESP-BEL @1.17
// Also adds the arg-swi-2026-07-12 QF fixture (verified vs ESPN scoreboard:
// Switzerland at Argentina, 2026-07-12T01:00Z, Arrowhead Stadium, Kansas City).

const FRA = "fra-mar-2026-07-09";
const NOR = "nor-eng-2026-07-11";
const ARG = "arg-swi-2026-07-12";
const ESP = "esp-bel-2026-07-10";

// ---- fixture: Argentina vs Switzerland QF ----
const FP = "data/fixtures.json";
const fixtures = JSON.parse(readFileSync(FP, "utf8"));
if (!fixtures.some((f) => f.id === ARG)) {
  fixtures.push({
    id: ARG,
    group: "",
    round: "Quarter-final",
    home: { name: "Argentina", flag: "🇦🇷" },
    away: { name: "Switzerland", flag: "🇨🇭" },
    venue: "GEHA Field at Arrowhead Stadium",
    city: "Kansas City, Missouri",
    kickoffUTC: "2026-07-12T01:00:00.000Z",
    etLabel: "21:00 ET",
  });
  writeFileSync(FP, JSON.stringify(fixtures, null, 2) + "\n");
  console.log("FIXTURE ADDED:", ARG);
} else {
  console.log("FIXTURE ALREADY PRESENT:", ARG);
}

// ---- slips ----
const P = "data/bets.json";
const b = JSON.parse(readFileSync(P, "utf8"));

const slips = [
  {
    id: "sp-862643967945744385",
    slipNo: "862643967945744385",
    matchId: FRA,
    player: "—",
    market: "Match Parlay · 10 legs",
    label:
      "FRA-MAR Match Parlay — U5.5 · France or draw · O0.5 · France qualify · " +
      "Olise score/assist · Mbappe scores · Rabiot 1+ shot · BTTS · " +
      "Bouaddi 1+ SOT · Over 3.5 cards (10 legs)",
    odds: 54.04,
    stake: 50,
    placedAt: "08/07 18:39",
    grade: {
      type: "multiLeg",
      legs: [
        { matchId: FRA, kind: "totalUnder", line: 5.5 },
        { matchId: FRA, kind: "doubleChance", outcome: "1X" },
        { matchId: FRA, kind: "totalOver", line: 0.5 },
        { matchId: FRA, kind: "qualify", side: "home" },
        { matchId: FRA, kind: "scoredOrAssisted", player: "Michael Olise" },
        { matchId: FRA, kind: "scored", player: "Kylian Mbappe" },
        { matchId: FRA, kind: "playerShotsOver", player: "Adrien Rabiot", line: 0.5 },
        { matchId: FRA, kind: "btts" },
        { matchId: FRA, kind: "playerSotOver", player: "Ayyoub Bouaddi", line: 0.5 },
        { matchId: FRA, kind: "cardsTotalOver", line: 3.5 },
      ],
    },
  },
  {
    id: "sp-862640332998410241",
    slipNo: "862640332998410241",
    matchId: FRA,
    player: "—",
    market: "4-fold · 4 match parlays · 16 legs",
    label:
      "4-fold of match parlays — FRA-MAR @3.82 (Olise score/assist · Mbappe scores · " +
      "Bounou 2+ saves · France or draw · O1.5 · France qualify) · NOR-ENG @5.04 " +
      "(Kane score/assist · Haaland score/assist · Nusa 1+ shot · U5.5) · ARG-SUI @2.09 " +
      "(Messi scores · Argentina or draw · Argentina qualify) · ESP-BEL @1.17 " +
      "(Courtois 2+ saves · O0.5 · U5.5). Per-parlay prices as on the slip; " +
      "per-leg prices not shown by the book.",
    odds: 47.07,
    stake: 50,
    placedAt: "08/07 18:24",
    grade: {
      type: "multiLeg",
      legs: [
        // FRA-MAR parlay @3.82
        { matchId: FRA, kind: "scoredOrAssisted", player: "Michael Olise" },
        { matchId: FRA, kind: "scored", player: "Kylian Mbappe" },
        { matchId: FRA, kind: "gkSavesOver", player: "Yassine Bounou", side: "away", line: 1.5 },
        { matchId: FRA, kind: "doubleChance", outcome: "1X" },
        { matchId: FRA, kind: "totalOver", line: 1.5 },
        { matchId: FRA, kind: "qualify", side: "home" },
        // NOR-ENG parlay @5.04
        { matchId: NOR, kind: "scoredOrAssisted", player: "Harry Kane" },
        { matchId: NOR, kind: "scoredOrAssisted", player: "Erling Haaland" },
        { matchId: NOR, kind: "playerShotsOver", player: "Antonio Nusa", line: 0.5 },
        { matchId: NOR, kind: "totalUnder", line: 5.5 },
        // ARG-SUI parlay @2.09
        { matchId: ARG, kind: "scored", player: "Lionel Messi" },
        { matchId: ARG, kind: "doubleChance", outcome: "1X" },
        { matchId: ARG, kind: "qualify", side: "home" },
        // ESP-BEL parlay @1.17
        { matchId: ESP, kind: "gkSavesOver", player: "Thibaut Courtois", side: "away", line: 1.5 },
        { matchId: ESP, kind: "totalOver", line: 0.5 },
        { matchId: ESP, kind: "totalUnder", line: 5.5 },
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
    console.log("ADDED:", slip.slipNo, "| legs:", slip.grade.legs.length, "| odds:", slip.odds);
  }
}
writeFileSync(P, JSON.stringify(b, null, 2) + "\n");
console.log("specials:", b.specials.length);
