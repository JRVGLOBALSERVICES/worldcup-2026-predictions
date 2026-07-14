import { readFileSync, writeFileSync, copyFileSync } from "node:fs";

// --- Rj's 1xBet SINGLE special placed 14/07 22:30 — Enhanced Daily Special ---
// Slip 84405934229 · odds 100 · stake RM9.40 · max winnings RM940.
// Selection: "Each team to have 2+ goalkeeper saves in each half in the World
//   Cup 2026 matches — Yes" (Accumulator Outcomes France-Spain, England-Argentina).
// This is a per-half, per-team GK-saves market spanning both matches. The engine
// only carries FULL-MATCH team saves (tempo.saves), NOT a per-half split, so this
// is NOT auto-gradable — same class as the VAR-monitor market. Add WITHOUT a
// grade so it PENDS, then settle via statusOverride once both matches finish.
// Anchored to the France-Spain final (fra-esp-2026-07-14) so it lands on today's
// featured card and counts toward the running total.
const P = "data/bets.json";
copyFileSync(P, `${P}.bak-1407-84405934229`);
const b = JSON.parse(readFileSync(P, "utf8"));
b.specials = b.specials ?? [];

const slipNo = "84405934229";
if (b.specials.some((s) => s.slipNo === slipNo)) {
  console.log("already present — no-op");
  process.exit(0);
}

b.specials.push({
  id: `sp-${slipNo}`,
  slipNo,
  matchId: "fra-esp-2026-07-14",
  player: "Enhanced Daily Special",
  market: "GK saves 2+ each half, each team (both matches)",
  label:
    "REAL 1xBet SINGLE 84405934229 (14/07) @100, RM9.40 -> RM940.00. " +
    "Each team to have 2+ goalkeeper saves in EACH HALF in the World Cup 2026 " +
    "matches — Yes. [FRA-ESP + ENG-ARG]. Ungradable per-half GK split → pends " +
    "until manual settle.",
  odds: 100,
  stake: 9.4,
  placedAt: "14/07 22:30",
  // no grade → pends; resolve with statusOverride ("won"/"lost"/"void") after FT.
});

writeFileSync(P, JSON.stringify(b, null, 2) + "\n");
console.log("added special", slipNo, "· total specials:", b.specials.length);
