// One-off: append Rj's 13 slips for the 28/06 slate (placed 27/06) to data/bets.json.
// 7 correct-score 1st-half singles → bets[]; 5 accas + 1 hat-trick → specials[].
import { readFileSync, writeFileSync } from "node:fs";

const path = new URL("../data/bets.json", import.meta.url);
const b = JSON.parse(readFileSync(path, "utf8"));

const M = {
  PANENG: "pan-eng-2026-06-27", // Panama (H) v England (A)
  CROGHA: "cro-gha-2026-06-27", // Croatia (H) v Ghana (A)
  COLPOR: "col-por-2026-06-27", // Colombia (H) v Portugal (A)
  DRCUZB: "drc-uzb-2026-06-27", // DR Congo (H) v Uzbekistan (A)
  JORARG: "jor-arg-2026-06-27", // Jordan (H) v Argentina (A)
  ALGAUS: "alg-aus-2026-06-27", // Algeria (H) v Austria (A)
};

const have = new Set([
  ...b.bets.map((x) => x.slipNo).filter(Boolean),
  ...(b.specials || []).map((x) => x.slipNo),
]);

// ── 7 correct-score 1st-half singles ────────────────────────────────────────
const singles = [
  { slipNo: "83641497373", matchId: M.COLPOR, h: 0, a: 3, odds: 29, stake: 10, t: "27/06 14:07" },
  { slipNo: "83641495535", matchId: M.COLPOR, h: 1, a: 3, odds: 50, stake: 10, t: "27/06 14:07" },
  { slipNo: "83641492013", matchId: M.COLPOR, h: 2, a: 2, odds: 50, stake: 10, t: "27/06 14:07" },
  { slipNo: "83641490011", matchId: M.COLPOR, h: 1, a: 1, odds: 8, stake: 40, t: "27/06 14:07" },
  { slipNo: "83641478257", matchId: M.PANENG, h: 0, a: 3, odds: 11, stake: 20, t: "27/06 14:07" },
  { slipNo: "83641474245", matchId: M.PANENG, h: 0, a: 2, odds: 5, stake: 30, t: "27/06 14:06" },
  { slipNo: "83641469741", matchId: M.PANENG, h: 1, a: 1, odds: 11, stake: 20, t: "27/06 14:06" },
];
for (const s of singles) {
  if (have.has(s.slipNo)) continue;
  b.bets.push({
    id: `b-${s.slipNo}`,
    slipNo: s.slipNo,
    matchId: s.matchId,
    side: "CS",
    period: "HT",
    label: `Correct Score ${s.h}-${s.a} (1st half)`,
    home: s.h,
    away: s.a,
    odds: s.odds,
    stake: s.stake,
    placedAt: s.t,
  });
}

// ── 5 accas + 1 hat-trick → specials[] ───────────────────────────────────────
b.specials = b.specials || [];
const accas = [
  {
    slipNo: "83641753589",
    odds: 171.417,
    stake: 24,
    t: "27/06 14:20",
    player: "5-leg acca",
    market: "Accumulator (5)",
    label:
      "Acca — Kane G+A o1.5 + Musa G+A o0.5 + Ronaldo G+A o0.5 + Messi G+A o2.5 + Gouiri to score/assist (5 legs)",
    legs: [
      { matchId: M.PANENG, kind: "goalsAssistsOver", player: "Harry Kane", line: 1.5 },
      { matchId: M.CROGHA, kind: "goalsAssistsOver", player: "Petar Musa", line: 0.5 },
      { matchId: M.COLPOR, kind: "goalsAssistsOver", player: "Cristiano Ronaldo", line: 0.5 },
      { matchId: M.JORARG, kind: "goalsAssistsOver", player: "Lionel Messi", line: 2.5 },
      { matchId: M.ALGAUS, kind: "scoredOrAssisted", player: "Amine Gouiri" },
    ],
  },
  {
    slipNo: "83641608561",
    odds: 15.083,
    stake: 100,
    t: "27/06 14:13",
    player: "6-leg acca",
    market: "Accumulator (6)",
    label:
      "Acca — England win + Croatia 1X + Col/Por BTTS + DRC/Uzb Under 2.25 + Austria/draw (2X) + Argentina win & total >3.5 (6 legs)",
    legs: [
      { matchId: M.PANENG, kind: "result", outcome: "2" },
      { matchId: M.CROGHA, kind: "doubleChance", outcome: "1X" },
      { matchId: M.COLPOR, kind: "btts" },
      { matchId: M.DRCUZB, kind: "totalUnder", line: 2.25 },
      { matchId: M.ALGAUS, kind: "doubleChance", outcome: "X2" },
      { matchId: M.JORARG, kind: "resultAndTotalOver", outcome: "2", line: 3.5 },
    ],
  },
  {
    slipNo: "83641457473",
    odds: 40.207,
    stake: 50,
    t: "27/06 14:06",
    player: "6-leg acca",
    market: "Accumulator (6)",
    label:
      "Acca — England take first penalty + Croatia 1X + Col/Por BTTS + DRC/Uzb Under 2.25 + Austria/draw (2X) + any team win by 3+ (Jor/Arg) (6 legs)",
    legs: [
      { matchId: M.PANENG, kind: "firstPenalty", side: "away" }, // England (away) take the first pen — auto-grades off ESPN keyEvents
      { matchId: M.CROGHA, kind: "doubleChance", outcome: "1X" },
      { matchId: M.COLPOR, kind: "btts" },
      { matchId: M.DRCUZB, kind: "totalUnder", line: 2.25 },
      { matchId: M.ALGAUS, kind: "doubleChance", outcome: "X2" },
      { matchId: M.JORARG, kind: "winByMargin", line: 3 },
    ],
  },
  {
    slipNo: "83641165433",
    odds: 30.834,
    stake: 48,
    t: "27/06 13:52",
    player: "3-leg acca",
    market: "Accumulator (3)",
    label: "Acca — Kane G+A o1.5 + Ronaldo G+A o0.5 + Messi G+A o2.5 (3 legs)",
    legs: [
      { matchId: M.PANENG, kind: "goalsAssistsOver", player: "Harry Kane", line: 1.5 },
      { matchId: M.COLPOR, kind: "goalsAssistsOver", player: "Cristiano Ronaldo", line: 0.5 },
      { matchId: M.JORARG, kind: "goalsAssistsOver", player: "Lionel Messi", line: 2.5 },
    ],
  },
  {
    slipNo: "83641116405",
    odds: 981.36,
    stake: 38,
    t: "27/06 13:49",
    player: "6-leg acca",
    market: "Accumulator (6)",
    label:
      "Acca — Kane G+A o2.5 + Croatia win & BTTS + DRC/Uzb Under 3 + Col/Por BTTS + Messi G+A o2.5 + Alg/Aus BTTS (6 legs)",
    legs: [
      { matchId: M.PANENG, kind: "goalsAssistsOver", player: "Harry Kane", line: 2.5 },
      { matchId: M.CROGHA, kind: "resultBtts", outcome: "1" },
      { matchId: M.DRCUZB, kind: "totalUnder", line: 3 },
      { matchId: M.COLPOR, kind: "btts" },
      { matchId: M.JORARG, kind: "goalsAssistsOver", player: "Lionel Messi", line: 2.5 },
      { matchId: M.ALGAUS, kind: "btts" },
    ],
  },
];
for (const a of accas) {
  if (have.has(a.slipNo)) continue;
  b.specials.push({
    id: `sp-${a.slipNo}`,
    slipNo: a.slipNo,
    matchId: a.legs[0].matchId,
    player: a.player,
    market: a.market,
    label: a.label,
    odds: a.odds,
    stake: a.stake,
    placedAt: a.t,
    grade: { type: "multiLeg", legs: a.legs },
  });
}

// Messi hat-trick single — 3+ goals = goalsOver line 2.5, exactly like Kane's
// hat-trick. Auto-grades off the per-player goal tally (ESPN keyEvents).
if (!have.has("83641249801")) {
  b.specials.push({
    id: "sp-83641249801",
    slipNo: "83641249801",
    matchId: M.JORARG,
    player: "Lionel Messi",
    market: "To score a hat-trick",
    label: "Lionel Messi to score a hat-trick (3+ goals, Jordan v Argentina)",
    odds: 13.5,
    stake: 50,
    placedAt: "27/06 13:56",
    grade: { type: "goalsOver", player: "Lionel Messi", line: 2.5 },
  });
}

writeFileSync(path, JSON.stringify(b, null, 2) + "\n");
console.log("bets now:", b.bets.length, "| specials now:", b.specials.length);
