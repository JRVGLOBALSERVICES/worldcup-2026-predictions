// One-off: append Rj's 05/07 Paraguay v France Mbappe singles to data/bets.json.
// Two REAL image-confirmed 1xBet singles on par-fra-2026-07-04 (05/07 05:00 KO):
//   83995353009 (04:07) — Mbappe to score TWO goals (brace) @ 4.0, RM65 -> RM260.
//   83995285715 (04:05) — Mbappe Goals+Assists combined Over 2.5 @ 7.5, RM35 -> RM262.5.
// Encodings: "brace/score two" = goalsOver line 1.5 (>1.5 => 2+, per code comment);
// "G+A combined Over 2.5" = goalsAssistsOver line 2.5 (>2.5 => 3+). Idempotent by slipNo.
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";

const path = new URL("../data/bets.json", import.meta.url);
const b = JSON.parse(readFileSync(path, "utf8"));
b.specials = b.specials || [];
const have = new Set(b.specials.map((x) => x.slipNo));

copyFileSync(path, new URL(`../data/bets.json.bak-0507-mbappe`, import.meta.url));

const MID = "par-fra-2026-07-04";
const slips = [
  {
    id: "sp-83995353009",
    slipNo: "83995353009",
    matchId: MID,
    player: "Kylian Mbappe",
    market: "Player to score two goals (brace)",
    label:
      "REAL 1xBet single 83995353009 (05/07 04:07) — Kylian Mbappe to score TWO goals " +
      "(brace) vs Paraguay @ 4.0, RM65 -> RM260.",
    odds: 4,
    stake: 65,
    placedAt: "05/07 04:07",
    grade: { type: "goalsOver", player: "Kylian Mbappe", line: 1.5 }, // >1.5 = 2+ = brace
  },
  {
    id: "sp-83995285715",
    slipNo: "83995285715",
    matchId: MID,
    player: "Kylian Mbappe",
    market: "Player goals + assists combined Over 2.5",
    label:
      "REAL 1xBet single 83995285715 (05/07 04:05) — Kylian Mbappe Goals+Assists combined " +
      "Over 2.5 vs Paraguay @ 7.5, RM35 -> RM262.5.",
    odds: 7.5,
    stake: 35,
    placedAt: "05/07 04:05",
    grade: { type: "goalsAssistsOver", player: "Kylian Mbappe", line: 2.5 }, // >2.5 = 3+
  },
];

let added = 0;
for (const slip of slips) {
  if (have.has(slip.slipNo)) {
    console.log("skip (already present):", slip.slipNo);
  } else {
    b.specials.push(slip);
    added++;
    console.log("added:", slip.slipNo);
  }
}

writeFileSync(path, JSON.stringify(b, null, 2) + "\n");
console.log(`\ndone — added ${added} slip(s) | specials now: ${b.specials.length}`);
