// One-off: append Rj's 03/07 slate to data/bets.json — the THREE real 1xBet
// slips he placed (image-confirmed) PLUS the model's own recommended "safe core"
// 4-leg parlay (paper slip, not staked) so /tracker can compare his real slips
// against Friday's model board. "Log all 4" = 3 real + 1 model.
//
// Combo legs ("player to score + total") are encoded as TWO AND-legs, same
// AND-logic a multiLeg acca needs (every leg must win) — matching the 02/07
// slip-343 precedent. Per-leg `odds` captured for every leg (needed to
// reconcile any future void/refund).
//
// Two Round-of-16 legs — Portugal v Spain + USA v Belgium — reference the
// ESPN-canonical matchIds (por-esp-2026-07-06 / usa-bel-2026-07-07). Both
// fixtures now exist in data/fixtures.json (materialised by
// build-knockout-fixtures.mjs) so these legs render with flags + a match card.
// NOTE: por-esp is 07-06 (kickoff 19:00Z), not 07-07 — ESPN's UTC date drives
// the id suffix. The grader stays null-safe if a fixture is ever missing.
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";

const path = new URL("../data/bets.json", import.meta.url);
const b = JSON.parse(readFileSync(path, "utf8"));
b.specials = b.specials || [];
const have = new Set(b.specials.map((x) => x.slipNo));

// backup once
copyFileSync(path, new URL(`../data/bets.json.bak-0307slips`, import.meta.url));

const slips = [
  // ─────────── REAL SLIP 1 — scorer punt (RM40 @ 146.88) ───────────
  {
    id: "sp-83906759195",
    slipNo: "83906759195",
    matchId: "aus-egy-2026-07-03",
    player: "Australia/Argentina/Colombia",
    market: "Accumulator (3) — scorers",
    label:
      "REAL 1xBet slip 83906759195 (03/07 13:27) — 3-fold scorer punt @ 146.88, RM40 -> RM5,875.20. " +
      "Mostafa Ziko anytime (4.8) · Messi to score TWO (5.1) · Daniel Munoz anytime (6.0).",
    odds: 146.88,
    stake: 40,
    placedAt: "03/07",
    grade: {
      type: "multiLeg",
      legs: [
        { matchId: "aus-egy-2026-07-03", kind: "scored", player: "Mostafa Ziko", odds: 4.8 },
        { matchId: "arg-cpv-2026-07-03", kind: "goalsOver", player: "Lionel Messi", line: 1.5, odds: 5.1 }, // "score TWO" = 2+
        { matchId: "col-gha-2026-07-04", kind: "scored", player: "Daniel Munoz", odds: 6.0 },
      ],
    },
  },

  // ─────────── REAL SLIP 2 — handicaps (RM50 @ 24.139, incl 1.1 acca bonus) ───────────
  {
    id: "sp-83906844771",
    slipNo: "83906844771",
    matchId: "can-mar-2026-07-04",
    player: "Canada/Paraguay/Brazil",
    market: "Accumulator (3) — totals/handicaps",
    label:
      "REAL 1xBet slip 83906844771 (03/07 13:31) — 3-fold @ 24.139 (incl. 1.1 acca bonus), RM50 -> RM1,206.98. " +
      "Canada-Morocco Total Over 1.25 (1.227) · Paraguay +0.75 handicap (3.595) · Norway -0.75 handicap (4.975).",
    odds: 24.139,
    stake: 50,
    placedAt: "03/07",
    grade: {
      type: "multiLeg",
      legs: [
        { matchId: "can-mar-2026-07-04", kind: "totalOver", line: 1.25, odds: 1.227 },
        { matchId: "par-fra-2026-07-04", kind: "handicap", side: "home", line: 0.75, odds: 3.595 }, // Handicap 1 = Paraguay +0.75
        { matchId: "bra-nor-2026-07-05", kind: "handicap", side: "away", line: -0.75, odds: 4.975 }, // Handicap 2 = Norway -0.75
      ],
    },
  },

  // ─────────── REAL SLIP 3 — 9-fold (RM50 @ 51.949) ───────────
  {
    id: "sp-83907429597",
    slipNo: "83907429597",
    matchId: "aus-egy-2026-07-03",
    player: "9-game acca",
    market: "Accumulator (9)",
    label:
      "REAL 1xBet slip 83907429597 (03/07 13:57) — 9-fold @ 51.949, RM50 -> RM2,597.45. " +
      "Aus/Egy U3.25 (1.135) · Col/Gha U2.5 (1.761) · Can/Mar O1.5 (1.37) · " +
      "Par/Fra: Mbappe score + O2.5 (2.053) · Bra/Nor 1X (1.255) · Mex/Eng 1X (1.59) · " +
      "Por/Spa U2.5 (1.89) · USA/Bel O1.5 (1.21) · Arg/CpV: Messi score + U4.5 (2.025). " +
      "(Legs 4 & 9 each encoded as two AND-legs. Por/Spa + USA/Bel are Jul-7 QFs not yet in fixtures — those legs hold pending.)",
    odds: 51.949,
    stake: 50,
    placedAt: "03/07",
    grade: {
      type: "multiLeg",
      legs: [
        { matchId: "aus-egy-2026-07-03", kind: "totalUnder", line: 3.25, odds: 1.135 },
        { matchId: "col-gha-2026-07-04", kind: "totalUnder", line: 2.5, odds: 1.761 },
        { matchId: "can-mar-2026-07-04", kind: "totalOver", line: 1.5, odds: 1.37 },
        { matchId: "par-fra-2026-07-04", kind: "scored", player: "Kylian Mbappe", odds: 2.053 }, // combo half A
        { matchId: "par-fra-2026-07-04", kind: "totalOver", line: 2.5 }, //                        combo half B (+O2.5)
        { matchId: "bra-nor-2026-07-05", kind: "doubleChance", outcome: "1X", odds: 1.255 },
        { matchId: "mex-eng-2026-07-06", kind: "doubleChance", outcome: "1X", odds: 1.59 },
        { matchId: "por-esp-2026-07-06", kind: "totalUnder", line: 2.5, odds: 1.89 }, // R16 — fixture materialised
        { matchId: "usa-bel-2026-07-07", kind: "totalOver", line: 1.5, odds: 1.21 }, //  QF — no fixture yet
        { matchId: "arg-cpv-2026-07-03", kind: "scored", player: "Lionel Messi", odds: 2.025 }, // combo half A
        { matchId: "arg-cpv-2026-07-03", kind: "totalUnder", line: 4.5 }, //                       combo half B (+U4.5)
      ],
    },
  },

  // ─────────── SLIP 4 — MODEL safe core (paper, NOT staked) ───────────
  {
    id: "sp-MODEL-safecore-0307",
    slipNo: "MODEL-safecore-0307",
    matchId: "arg-cpv-2026-07-03",
    player: "Friday model board",
    market: "Model safe core (4) — paper",
    label:
      "FRIDAY MODEL safe-core parlay (03/07, NOT a real 1xBet slip — recommendation logged for comparison). " +
      "4 legs @ ~2.55, notional RM150 -> ~RM382, joint model prob ~58%. " +
      "France 2X (~1.08, 93%) · Argentina 1X (~1.09, 92%) · Aus/Egy Asian Under 3.0 (~1.25, 85%) · Col/Gha Under 2.5 (~1.72, 80%).",
    odds: 2.55,
    stake: 150,
    placedAt: "03/07",
    grade: {
      type: "multiLeg",
      legs: [
        { matchId: "par-fra-2026-07-04", kind: "doubleChance", outcome: "X2", odds: 1.08 }, // France (away) or draw
        { matchId: "arg-cpv-2026-07-03", kind: "doubleChance", outcome: "1X", odds: 1.09 }, // Argentina (home) or draw
        { matchId: "aus-egy-2026-07-03", kind: "totalUnder", line: 3.0, odds: 1.25 },
        { matchId: "col-gha-2026-07-04", kind: "totalUnder", line: 2.5, odds: 1.72 },
      ],
    },
  },
];

let added = 0;
for (const s of slips) {
  if (have.has(s.slipNo)) {
    console.log("skip (already present):", s.slipNo);
    continue;
  }
  b.specials.push(s);
  added++;
  console.log("added:", s.slipNo);
}

writeFileSync(path, JSON.stringify(b, null, 2) + "\n");
console.log(`\ndone — added ${added} slip(s) | specials now: ${b.specials.length}`);
