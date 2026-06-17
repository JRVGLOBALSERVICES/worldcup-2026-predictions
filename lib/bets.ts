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

/** One scraped goal. `team` is relative to the fixture's listed home/away sides.
 *  Goals are stored in chronological scoring order — first non-own-goal = first scorer. */
export type Goal = {
  team: "home" | "away";
  scorer: string;
  minute?: number;
  assist?: string | null;
  freeKick?: boolean;
  penalty?: boolean;
  ownGoal?: boolean;
};

export type MatchEvents = { status: "scheduled" | "live" | "finished"; goals: Goal[] };

/** Machine-gradable rule attached to each special so the cron settles it without a human. */
export type SpecialGrade =
  | { type: "scored"; player: string }
  | { type: "scoreAndAssist"; player: string }
  | { type: "assistsOver"; player: string; line: number }
  | { type: "firstScorer"; player: string }
  | { type: "firstScorerAndScore"; player: string; home: number; away: number }
  | { type: "scoredAndScore"; player: string; home: number; away: number }
  | { type: "drawAndFirstScorer"; player: string }
  | { type: "freeKickGoal"; player: string }
  | { type: "bttsEachOver"; line: number }
  | { type: "htft"; ht: "1" | "X" | "2"; ft: "1" | "X" | "2" };

/** A real 1xBet single-bet player prop — auto-graded off matchEvents + final score. */
export type Special = {
  id: string;
  slipNo: string;
  matchId: string;
  player: string;
  market: string;
  label: string;
  odds: number;
  stake: number;
  placedAt: string;
  grade?: SpecialGrade;
  /** Manual safety valve: overrides the auto-grade if a scrape was wrong. */
  statusOverride?: BetStatus;
};

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
  matchEventsNote?: string;
  matchEvents?: Record<string, MatchEvents>;
  bets: Bet[];
  specialsNote?: string;
  specials?: Special[];
};

export const betSlip = betsJson as BetSlipFile;

export function getResult(matchId: string): MatchResult {
  return betSlip.results[matchId] ?? { ht: null, ft: null };
}

export function getEvents(matchId: string): MatchEvents {
  return betSlip.matchEvents?.[matchId] ?? { status: "scheduled", goals: [] };
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

// ── Specials (1xBet player props, auto-graded off scraped match events) ──────

export type SettledSpecial = Special & {
  status: BetStatus;
  fixture: Fixture | undefined;
  potential: number;
  /** +profit on a win, −stake on a loss, 0 while pending. */
  pnl: number;
};

/** Loose name match — "Ronaldo" matches "Cristiano Ronaldo", case-insensitive, either direction. */
function nameMatch(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  return x === y || x.includes(y) || y.includes(x);
}

const realGoals = (goals: Goal[]) => goals.filter((g) => !g.ownGoal);
const goalsBy = (goals: Goal[], player: string) =>
  realGoals(goals).filter((g) => nameMatch(g.scorer, player));
const assistsBy = (goals: Goal[], player: string) =>
  goals.filter((g) => g.assist && nameMatch(g.assist, player));
const firstScorer = (goals: Goal[]): string | null => realGoals(goals)[0]?.scorer ?? null;
const isFinalScore = (ft: Score, home: number, away: number) =>
  !!ft && ft.home === home && ft.away === away;
const isDraw = (ft: Score) => !!ft && ft.home === ft.away;

/**
 * Auto-grade a single special off scraped match events + the final score.
 * Returns "pending" until the match is finished (events.status === "finished").
 * A manual `statusOverride` always wins (bad-scrape safety valve).
 */
export function gradeSpecial(special: Special): BetStatus {
  if (special.statusOverride) return special.statusOverride;
  const g = special.grade;
  if (!g) return "pending";

  const events = getEvents(special.matchId);
  const ft = getResult(special.matchId).ft;
  if (events.status !== "finished") return "pending";

  const { goals } = events;
  let hit = false;
  switch (g.type) {
    case "scored":
      hit = goalsBy(goals, g.player).length > 0;
      break;
    case "scoreAndAssist":
      hit = goalsBy(goals, g.player).length > 0 && assistsBy(goals, g.player).length > 0;
      break;
    case "assistsOver":
      hit = assistsBy(goals, g.player).length > g.line;
      break;
    case "firstScorer":
      hit = !!firstScorer(goals) && nameMatch(firstScorer(goals)!, g.player);
      break;
    case "firstScorerAndScore":
      hit =
        !!firstScorer(goals) &&
        nameMatch(firstScorer(goals)!, g.player) &&
        isFinalScore(ft, g.home, g.away);
      break;
    case "scoredAndScore":
      hit = goalsBy(goals, g.player).length > 0 && isFinalScore(ft, g.home, g.away);
      break;
    case "drawAndFirstScorer":
      hit = isDraw(ft) && !!firstScorer(goals) && nameMatch(firstScorer(goals)!, g.player);
      break;
    case "freeKickGoal":
      hit = goalsBy(goals, g.player).some((gl) => gl.freeKick === true);
      break;
    case "bttsEachOver": {
      // Both teams score strictly more than `line` goals (line=1 → 2+ each).
      const home = goals.filter((gl) => gl.team === "home" && !gl.ownGoal).length;
      const away = goals.filter((gl) => gl.team === "away" && !gl.ownGoal).length;
      hit = home > g.line && away > g.line;
      break;
    }
    case "htft": {
      // Half-time AND full-time 1X2 outcome must both match.
      const ht = getResult(special.matchId).ht;
      if (!ht || !ft) break;
      const outcome = (s: { home: number; away: number }) =>
        s.home > s.away ? "1" : s.home < s.away ? "2" : "X";
      hit = outcome(ht) === g.ht && outcome(ft) === g.ft;
      break;
    }
  }
  return hit ? "won" : "lost";
}

export function settleSpecials(): SettledSpecial[] {
  return (betSlip.specials ?? []).map((s) => {
    const status = gradeSpecial(s);
    return {
      ...s,
      status,
      fixture: getFixture(s.matchId),
      potential: s.stake * s.odds,
      pnl: status === "won" ? s.stake * (s.odds - 1) : status === "lost" ? -s.stake : 0,
    };
  });
}

export function specialsTotals(settled: SettledSpecial[]): SlipTotals {
  return slipTotals(settled as unknown as SettledBet[]);
}

/** Merge two totals into one — used to fold player props into the slip-wide / per-day summary. */
export function mergeTotals(a: SlipTotals, b: SlipTotals): SlipTotals {
  return {
    count: a.count + b.count,
    staked: a.staked + b.staked,
    potential: a.potential + b.potential,
    won: a.won + b.won,
    lost: a.lost + b.lost,
    pending: a.pending + b.pending,
    settledPnl: a.settledPnl + b.settledPnl,
    settledStake: a.settledStake + b.settledStake,
    returned: a.returned + b.returned,
  };
}
