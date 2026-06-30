// One-off: append Ruhan's 3 twelve-fold accumulators for the 01–04/07 slate
// (placed 30/06 23:53) to data/bets-ruhan.json. All three are RUHAN's, not Rj's.
//   Slip A 83787652141 — 50 RM — all-Unders            — odds 80.847
//   Slip B 83787672233 — 25 RM — mixed (Mex/Ecu 2X)    — odds 106.511
//   Slip C 83787691205 — 25 RM — mixed (Mex/Ecu 1X)    — odds 79.789
// All legs auto-settle off ESPN match totals / 1X2 / BTTS — no player legs.
import { readFileSync, writeFileSync } from "node:fs";

const path = new URL("../data/bets-ruhan.json", import.meta.url);
const b = JSON.parse(readFileSync(path, "utf8"));

const M = {
  CIVNOR: "civ-nor-2026-06-30", // Ivory Coast v Norway
  FRASWE: "fra-swe-2026-06-30", // France v Sweden
  MEXECU: "mex-ecu-2026-07-01", // Mexico v Ecuador
  ENGCOD: "eng-cod-2026-07-01", // England v DR Congo
  BELSEN: "bel-sen-2026-07-01", // Belgium v Senegal
  USABIH: "usa-bih-2026-07-02", // USA v Bosnia & Herzegovina
  ESPAUT: "esp-aut-2026-07-02", // Spain v Austria
  PORCRO: "por-cro-2026-07-02", // Portugal v Croatia
  SUIALG: "sui-alg-2026-07-03", // Switzerland v Algeria (slip printed "Nigeria"; total leg is opponent-agnostic)
  AUSEGY: "aus-egy-2026-07-03", // Australia v Egypt
  ARGCPV: "arg-cpv-2026-07-03", // Argentina v Cape Verde
  COLGHA: "col-gha-2026-07-04", // Colombia v Ghana
};

const have = new Set([
  ...b.bets.map((x) => x.slipNo).filter(Boolean),
  ...(b.specials || []).map((x) => x.slipNo),
]);

b.specials = b.specials || [];

const accas = [
  {
    slipNo: "83787652141",
    odds: 80.847,
    stake: 50,
    t: "30/06 23:53",
    market: "Accumulator (12) — all Unders",
    label:
      "12-fold all-Unders — CIV/NOR U3.5 + FRA/SWE U3.5 + MEX/ECU U2.5 + ENG/COD U2.5 + BEL/SEN U3.5 + USA/BIH U4 + ESP/AUT U3.5 + POR/CRO U3.5 + SUI U4.5 + AUS/EGY U2.5 + ARG/CPV U2.5 + COL/GHA U2.5",
    legs: [
      { matchId: M.CIVNOR, kind: "totalUnder", line: 3.5 },
      { matchId: M.FRASWE, kind: "totalUnder", line: 3.5 },
      { matchId: M.MEXECU, kind: "totalUnder", line: 2.5 },
      { matchId: M.ENGCOD, kind: "totalUnder", line: 2.5 },
      { matchId: M.BELSEN, kind: "totalUnder", line: 3.5 },
      { matchId: M.USABIH, kind: "totalUnder", line: 4 },
      { matchId: M.ESPAUT, kind: "totalUnder", line: 3.5 },
      { matchId: M.PORCRO, kind: "totalUnder", line: 3.5 },
      { matchId: M.SUIALG, kind: "totalUnder", line: 4.5 },
      { matchId: M.AUSEGY, kind: "totalUnder", line: 2.5 },
      { matchId: M.ARGCPV, kind: "totalUnder", line: 2.5 },
      { matchId: M.COLGHA, kind: "totalUnder", line: 2.5 },
    ],
  },
  {
    slipNo: "83787672233",
    odds: 106.511,
    stake: 25,
    t: "30/06 23:53",
    market: "Accumulator (12) — mixed",
    label:
      "12-fold mixed — CIV/NOR O1.5 + FRA/SWE O2.5 + MEX/ECU 2X + ENG/COD U3 + BEL/SEN BTTS + USA/BIH O1.5 + ESP/AUT U3.25 + POR/CRO O1.5 + SUI O2.5 + AUS/EGY U3 + ARG/CPV U3 + COL/GHA O1.5",
    legs: [
      { matchId: M.CIVNOR, kind: "totalOver", line: 1.5 },
      { matchId: M.FRASWE, kind: "totalOver", line: 2.5 },
      { matchId: M.MEXECU, kind: "doubleChance", outcome: "X2" }, // 1xBet "2X" = draw or away
      { matchId: M.ENGCOD, kind: "totalUnder", line: 3 },
      { matchId: M.BELSEN, kind: "btts" },
      { matchId: M.USABIH, kind: "totalOver", line: 1.5 },
      { matchId: M.ESPAUT, kind: "totalUnder", line: 3.25 },
      { matchId: M.PORCRO, kind: "totalOver", line: 1.5 },
      { matchId: M.SUIALG, kind: "totalOver", line: 2.5 },
      { matchId: M.AUSEGY, kind: "totalUnder", line: 3 },
      { matchId: M.ARGCPV, kind: "totalUnder", line: 3 },
      { matchId: M.COLGHA, kind: "totalOver", line: 1.5 },
    ],
  },
  {
    slipNo: "83787691205",
    odds: 79.789,
    stake: 25,
    t: "30/06 23:53",
    market: "Accumulator (12) — mixed",
    label:
      "12-fold mixed — CIV/NOR O1.5 + FRA/SWE O2.5 + MEX/ECU 1X + ENG/COD U3 + BEL/SEN BTTS + USA/BIH O1.5 + ESP/AUT U3.25 + POR/CRO O1.5 + SUI O2.5 + AUS/EGY U3 + ARG/CPV U3 + COL/GHA O1.5",
    legs: [
      { matchId: M.CIVNOR, kind: "totalOver", line: 1.5 },
      { matchId: M.FRASWE, kind: "totalOver", line: 2.5 },
      { matchId: M.MEXECU, kind: "doubleChance", outcome: "1X" }, // 1xBet "1X" = home or draw
      { matchId: M.ENGCOD, kind: "totalUnder", line: 3 },
      { matchId: M.BELSEN, kind: "btts" },
      { matchId: M.USABIH, kind: "totalOver", line: 1.5 },
      { matchId: M.ESPAUT, kind: "totalUnder", line: 3.25 },
      { matchId: M.PORCRO, kind: "totalOver", line: 1.5 },
      { matchId: M.SUIALG, kind: "totalOver", line: 2.5 },
      { matchId: M.AUSEGY, kind: "totalUnder", line: 3 },
      { matchId: M.ARGCPV, kind: "totalUnder", line: 3 },
      { matchId: M.COLGHA, kind: "totalOver", line: 1.5 },
    ],
  },
];

let added = 0;
for (const a of accas) {
  if (have.has(a.slipNo)) continue;
  b.specials.push({
    id: `sp-${a.slipNo}`,
    slipNo: a.slipNo,
    matchId: a.legs[0].matchId,
    player: "12-leg acca",
    market: a.market,
    label: a.label,
    odds: a.odds,
    stake: a.stake,
    placedAt: a.t,
    grade: { type: "multiLeg", legs: a.legs },
  });
  added++;
}

writeFileSync(path, JSON.stringify(b, null, 2) + "\n");
console.log("added:", added, "| specials now:", b.specials.length);
