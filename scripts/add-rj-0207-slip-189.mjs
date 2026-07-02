// One-off: append Rj's REAL 1xBet acca slip 83860189147 (02/07 slate) to data/bets.json.
// Image-confirmed 10-leg acca @ 65.025, RM50 → RM3,251.25. Sibling of 83860211343
// but leg 10 differs: here it's Messi to score ANYTIME @1.52 alone (no match U4.5 combo),
// so it's a single `scored` leg. Legs 1–9 are identical to 343.
import { readFileSync, writeFileSync } from "node:fs";

const path = new URL("../data/bets.json", import.meta.url);
const b = JSON.parse(readFileSync(path, "utf8"));
b.specials = b.specials || [];

const slipNo = "83860189147";
const have = new Set((b.specials || []).map((x) => x.slipNo));

if (have.has(slipNo)) {
  console.log("slip already present — no-op");
} else {
  b.specials.push({
    id: `sp-${slipNo}`,
    slipNo,
    matchId: "esp-aut-2026-07-02",
    player:
      "Spain/Portugal/Switzerland/Australia/Colombia/Canada/Brazil/Mexico/Paraguay/Argentina",
    market: "Accumulator (10)",
    label:
      "REAL 1xBet acca (slip 83860189147, 02/07) — 10 legs @ 65.025, RM50 → RM3,251.25. " +
      "Spain 1X · Por/Cro BTTS · Swi/Alg O1.5 · Aus/Egy O1.5 · Col/Gha U2.5 · Can/Mar BTTS · " +
      "Bra/Nor BTTS · Mex/Eng O1.5 · Par/Fra O2.0 · Messi to score anytime. " +
      "(Sibling of 83860211343; leg 10 is Messi anytime @1.52 only, no U4.5.)",
    odds: 65.025,
    stake: 50,
    placedAt: "02/07",
    grade: {
      type: "multiLeg",
      legs: [
        { matchId: "esp-aut-2026-07-02", kind: "doubleChance", outcome: "1X" }, // 1.069
        { matchId: "por-cro-2026-07-02", kind: "btts" }, // 1.75
        { matchId: "sui-alg-2026-07-03", kind: "totalOver", line: 1.5 }, // 1.36
        { matchId: "aus-egy-2026-07-03", kind: "totalOver", line: 1.5 }, // 1.599
        { matchId: "col-gha-2026-07-04", kind: "totalUnder", line: 2.5 }, // 1.703
        { matchId: "can-mar-2026-07-04", kind: "btts" }, // 2.09
        { matchId: "bra-nor-2026-07-05", kind: "btts" }, // 1.65
        { matchId: "mex-eng-2026-07-06", kind: "totalOver", line: 1.5 }, // 1.444
        { matchId: "par-fra-2026-07-04", kind: "totalOver", line: 2 }, // 1.24
        { matchId: "arg-cpv-2026-07-03", kind: "scored", player: "Lionel Messi" }, // 1.52
      ],
    },
  });
  writeFileSync(path, JSON.stringify(b, null, 2) + "\n");
  console.log("added slip", slipNo, "| specials now:", b.specials.length);
}
