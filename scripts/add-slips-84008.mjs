import { readFileSync, writeFileSync } from "node:fs";

const P = "data/bets.json";
const b = JSON.parse(readFileSync(P, "utf8"));

const M = {
  braNor: "bra-nor-2026-07-05",
  mexEng: "mex-eng-2026-07-06",
  porEsp: "por-esp-2026-07-06",
  usaBel: "usa-bel-2026-07-07",
  argEgy: "arg-egy-2026-07-07",
  suiCol: "sui-col-2026-07-07",
};

const slips = [
  {
    id: "sp-84008928011",
    slipNo: "84008928011",
    matchId: M.braNor,
    player: "6-game acca",
    market: "Accumulator (6) — Player G+A / BTTS / DC+BTTS / Totals",
    label:
      "REAL 1xBet slip 84008928011 (05/07 13:11) — 6-fold @ 38.636, RM35 -> RM1352.26. " +
      "Bra/Nor Matheus Cunha Goals+Assists Over 0.5 (2.05) · Mex/Eng Harry Kane Goals+Assists Over 0.5 (2.2) · " +
      "Por/Esp Mikel Oyarzabal Goals+Assists Over 0.5 (2.0) · USA/Bel Both Teams To Score Yes (1.56) · " +
      "Arg/Egy 1X And Both Teams To Score Yes (2.62) · Sui/Col Total Over 0.5 (1.048).",
    odds: 38.636,
    stake: 35,
    placedAt: "05/07 13:11",
    grade: {
      type: "multiLeg",
      legs: [
        { matchId: M.braNor, kind: "goalsAssistsOver", player: "Matheus Cunha", line: 0.5, odds: 2.05 },
        { matchId: M.mexEng, kind: "goalsAssistsOver", player: "Harry Kane", line: 0.5, odds: 2.2 },
        { matchId: M.porEsp, kind: "goalsAssistsOver", player: "Mikel Oyarzabal", line: 0.5, odds: 2.0 },
        { matchId: M.usaBel, kind: "btts", odds: 1.56 },
        { matchId: M.argEgy, kind: "doubleChanceBtts", outcome: "1X", odds: 2.62 },
        { matchId: M.suiCol, kind: "totalOver", line: 0.5, odds: 1.048 },
      ],
    },
  },
  {
    id: "sp-84008869111",
    slipNo: "84008869111",
    matchId: M.braNor,
    player: "2-game acca",
    market: "Accumulator (2) — Correct Score / Scorer+Score",
    label:
      "REAL 1xBet slip 84008869111 (05/07 13:08) — 2-fold @ 91, RM15 -> RM1365. " +
      "Bra/Nor Correct Score 1-1 (6.5) · Mex/Eng Harry Kane To Score And Match Score 1-2 (14).",
    odds: 91,
    stake: 15,
    placedAt: "05/07 13:08",
    grade: {
      type: "multiLeg",
      legs: [
        { matchId: M.braNor, kind: "correctScore", home: 1, away: 1, odds: 6.5 },
        {
          matchId: M.mexEng,
          kind: "scoredAndScoreOneOf",
          player: "Harry Kane",
          scores: [{ home: 1, away: 2 }],
          odds: 14,
        },
      ],
    },
  },
  {
    id: "sp-84008794835",
    slipNo: "84008794835",
    matchId: M.braNor,
    player: "6-game acca",
    market: "Accumulator (6) — Player G+A / Totals",
    label:
      "REAL 1xBet slip 84008794835 (05/07 13:03) — 6-fold @ 34.779, RM50 -> RM1738.95. " +
      "Bra/Nor Erling Haaland Goals+Assists Over 0.5 (2.1) · Mex/Eng Harry Kane Goals+Assists Over 0.5 (2.2) · " +
      "Por/Esp Cristiano Ronaldo Goals+Assists Over 0.5 (2.6) · USA/Bel Romelu Lukaku Goals+Assists Over 0.5 (2.15) · " +
      "Arg/Egy Total Over 1.5 (1.285) · Sui/Col Total Over 0.5 (1.048).",
    odds: 34.779,
    stake: 50,
    placedAt: "05/07 13:03",
    grade: {
      type: "multiLeg",
      legs: [
        { matchId: M.braNor, kind: "goalsAssistsOver", player: "Erling Haaland", line: 0.5, odds: 2.1 },
        { matchId: M.mexEng, kind: "goalsAssistsOver", player: "Harry Kane", line: 0.5, odds: 2.2 },
        { matchId: M.porEsp, kind: "goalsAssistsOver", player: "Cristiano Ronaldo", line: 0.5, odds: 2.6 },
        { matchId: M.usaBel, kind: "goalsAssistsOver", player: "Romelu Lukaku", line: 0.5, odds: 2.15 },
        { matchId: M.argEgy, kind: "totalOver", line: 1.5, odds: 1.285 },
        { matchId: M.suiCol, kind: "totalOver", line: 0.5, odds: 1.048 },
      ],
    },
  },
  {
    id: "sp-84008759541",
    slipNo: "84008759541",
    matchId: M.braNor,
    player: "6-game acca",
    market: "Accumulator (6) — Player G+A / Qualify / Totals",
    label:
      "REAL 1xBet slip 84008759541 (05/07 13:01) — 6-fold @ 20.935, RM50 -> RM1046.77. " +
      "Bra/Nor Matheus Cunha Goals+Assists Over 0.5 (2.05) · Mex/Eng Julian Quinones Goals+Assists Over 0.5 (3.25) · " +
      "Por/Esp Mikel Oyarzabal Goals+Assists Over 0.5 (2.0) · USA/Bel Total Over 0.5 (1.002) · " +
      "Arg/Egy Argentina To Qualify (1.12) · Sui/Col Total Over 1.5 (1.4).",
    odds: 20.935,
    stake: 50,
    placedAt: "05/07 13:01",
    grade: {
      type: "multiLeg",
      legs: [
        { matchId: M.braNor, kind: "goalsAssistsOver", player: "Matheus Cunha", line: 0.5, odds: 2.05 },
        { matchId: M.mexEng, kind: "goalsAssistsOver", player: "Julián Quiñones", line: 0.5, odds: 3.25 },
        { matchId: M.porEsp, kind: "goalsAssistsOver", player: "Mikel Oyarzabal", line: 0.5, odds: 2.0 },
        { matchId: M.usaBel, kind: "totalOver", line: 0.5, odds: 1.002 },
        { matchId: M.argEgy, kind: "qualify", side: "home", odds: 1.12 },
        { matchId: M.suiCol, kind: "totalOver", line: 1.5, odds: 1.4 },
      ],
    },
  },
];

const existing = new Set(b.specials.map((s) => s.slipNo));
let added = 0;
for (const s of slips) {
  if (existing.has(s.slipNo)) {
    console.log("SKIP (already present):", s.slipNo);
    continue;
  }
  b.specials.push(s);
  added++;
  console.log("ADDED:", s.slipNo);
}

writeFileSync(P, JSON.stringify(b, null, 2) + "\n");
console.log(`specials: ${b.specials.length} (added ${added})`);
