import betsJson from "@/data/bets.json";
import { getFixture } from "./data";
import type { Fixture } from "./types";

export type BetPeriod = "HT" | "FT";
export type BetStatus = "pending" | "won" | "lost";

export type Bet = {
  id: string;
  matchId: string;
  side: string;
  period: BetPeriod;
  label: string;
  home: number;
  away: number;
  odds: number;
  stake: number;
};

export type Score = { home: number; away: number } | null;
export type MatchResult = { ht: Score; ft: Score };

export type BetSlipFile = {
  meta: {
    owner: string;
    placedAt: string;
    currency: string;
    unitStake: number;
    note: string;
    disclaimer: string;
  };
  results: Record<string, MatchResult>;
  bets: Bet[];
};

export const betSlip = betsJson as BetSlipFile;

export function getResult(matchId: string): MatchResult {
  return betSlip.results[matchId] ?? { ht: null, ft: null };
}

/** Settle one correct-score bet against the relevant period's score. */
export function settleBet(bet: Bet): BetStatus {
  const result = getResult(bet.matchId);
  const score = bet.period === "HT" ? result.ht : result.ft;
  if (!score) return "pending";
  return score.home === bet.home && score.away === bet.away ? "won" : "lost";
}

/** Total returned if the bet wins (stake + profit). */
export function potentialReturn(bet: Bet): number {
  return bet.stake * bet.odds;
}

export function profit(bet: Bet): number {
  return bet.stake * (bet.odds - 1);
}

export type SettledBet = Bet & {
  status: BetStatus;
  fixture: Fixture | undefined;
  potential: number;
  /** Realised P&L once settled: +profit on a win, −stake on a loss, 0 while pending. */
  pnl: number;
};

export function settleAll(): SettledBet[] {
  return betSlip.bets.map((bet) => {
    const status = settleBet(bet);
    const pnl = status === "won" ? profit(bet) : status === "lost" ? -bet.stake : 0;
    return {
      ...bet,
      status,
      fixture: getFixture(bet.matchId),
      potential: potentialReturn(bet),
      pnl,
    };
  });
}

export type SlipTotals = {
  count: number;
  staked: number;
  potential: number;
  won: number;
  lost: number;
  pending: number;
  settledPnl: number;
  settledStake: number;
  returned: number;
};

export function slipTotals(settled: SettledBet[]): SlipTotals {
  const t: SlipTotals = {
    count: settled.length,
    staked: settled.reduce((s, b) => s + b.stake, 0),
    potential: settled.reduce((s, b) => s + b.potential, 0),
    won: settled.filter((b) => b.status === "won").length,
    lost: settled.filter((b) => b.status === "lost").length,
    pending: settled.filter((b) => b.status === "pending").length,
    settledPnl: settled.reduce((s, b) => s + b.pnl, 0),
    settledStake: settled.filter((b) => b.status !== "pending").reduce((s, b) => s + b.stake, 0),
    returned: settled.filter((b) => b.status === "won").reduce((s, b) => s + b.potential, 0),
  };
  return t;
}

/** Group settled bets by match, preserving kickoff order. */
export type MatchGroup = {
  matchId: string;
  fixture: Fixture | undefined;
  result: MatchResult;
  bets: SettledBet[];
};

export function groupByMatch(settled: SettledBet[]): MatchGroup[] {
  const order: string[] = [];
  const map = new Map<string, SettledBet[]>();
  for (const b of settled) {
    if (!map.has(b.matchId)) {
      map.set(b.matchId, []);
      order.push(b.matchId);
    }
    map.get(b.matchId)!.push(b);
  }
  return order
    .map((matchId) => ({
      matchId,
      fixture: getFixture(matchId),
      result: getResult(matchId),
      bets: map.get(matchId)!,
    }))
    .sort((a, b) => {
      const ta = a.fixture ? new Date(a.fixture.kickoffUTC).getTime() : 0;
      const tb = b.fixture ? new Date(b.fixture.kickoffUTC).getTime() : 0;
      return ta - tb;
    });
}

export function money(n: number, currency = betSlip.meta.currency): string {
  return `${currency}${n.toFixed(2)}`;
}
