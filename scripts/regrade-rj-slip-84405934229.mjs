import { readFileSync, writeFileSync, copyFileSync } from "node:fs";

// Re-grade Rj's 1xBet slip 84405934229 from an "ungradable pending" special to a
// proper AUTO-GRADING 2-leg accumulator. It's an Enhanced Daily Special acca:
// "Each team to have 2+ goalkeeper saves in EACH HALF" across BOTH matches —
// France-Spain (14/07) + England-Argentina (15/07). Every "each team … each half"
// requirement is the keeper-saves twin of the engine's per-half SOT tally
// (keeper saves = opponent's on-target-non-goal shots = sotByHalf), so the new
// `eachTeamKeeperSavesEachHalfAtLeast` multiLeg kind settles it off ESPN with no
// manual step. All legs must come good (evalCombo ANDs) for the RM940 to land.
const P = "data/bets.json";
copyFileSync(P, `${P}.bak-1407-84405934229-regrade`);
const b = JSON.parse(readFileSync(P, "utf8"));

const s = b.specials.find((x) => x.slipNo === "84405934229");
if (!s) {
  console.error("slip 84405934229 not found");
  process.exit(1);
}

s.market = "Each team 2+ GK saves each half — acca (FRA-ESP + ENG-ARG)";
s.label =
  "REAL 1xBet ACCA 84405934229 (14/07) @100, RM9.40 -> RM940.00. Enhanced Daily " +
  "Special: each team to have 2+ goalkeeper saves in EACH HALF — France-Spain + " +
  "England-Argentina. Auto-grades off ESPN per-half saves (sotByHalf).";
s.grade = {
  type: "multiLeg",
  legs: [
    { matchId: "fra-esp-2026-07-14", kind: "eachTeamKeeperSavesEachHalfAtLeast", line: 2 },
    { matchId: "eng-arg-2026-07-15", kind: "eachTeamKeeperSavesEachHalfAtLeast", line: 2 },
  ],
};
// reliable:false → still auto-grades won/lost, but flags the slip for an eyeball
// (off-the-line clearances count as SOT but aren't keeper saves — rare ±1 at the
// "2+" boundary). statusOverride stays the manual escape hatch if ESPN is wrong.
s.reliable = false;

writeFileSync(P, JSON.stringify(b, null, 2) + "\n");
console.log("re-graded slip 84405934229 → multiLeg (2 legs, eachTeamKeeperSavesEachHalfAtLeast, line 2)");
