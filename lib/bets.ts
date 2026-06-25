import betsJson from "@/data/bets.json";
import ruhanJson from "@/data/bets-ruhan.json";
import { getFixture, getPrediction } from "./data";
import type { Fixture } from "./types";

export type BetPeriod = "HT" | "FT";
// "void" = stake returned (refund). First-goalscorer markets void when the named
// player doesn't start — universal bookmaker rule (a non-starter can't be first
// scorer, so the leg is dead and the bet refunds rather than losing).
export type BetStatus = "pending" | "won" | "lost" | "void";

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

/** One scraped booking. `team` is relative to the fixture's listed home/away.
 *  `type: "red"` covers a straight red OR a second-yellow dismissal. */
export type Card = {
  team: "home" | "away";
  player: string;
  minute?: number;
  type: "yellow" | "red";
};

export type MatchEvents = {
  status: "scheduled" | "live" | "finished";
  goals: Goal[];
  cards?: Card[];
};

/** Per-side count, oriented to the fixture's listed home/away. */
export type SideCount = { home: number; away: number };
/** Per-side, per-half count: [firstHalf, secondHalf]. */
export type SideHalfCount = { home: number[]; away: number[] };

/**
 * Verified match statistics pulled from ESPN's per-event `summary` endpoint —
 * the data the lighter scoreboard feed (lib/live.ts) does NOT carry. Full-match
 * team totals come from `boxscore.teams[].statistics` (wonCorners, shotsOnTarget,
 * yellow/redCards); the per-half splits are tallied from `commentary[]` plays
 * ("Corner Awarded" / "Shot On Target", each tagged with team + period). This is
 * what lets corner / shots-on-target / card bet legs auto-settle against real
 * numbers instead of a hand-graded guess. Written by scripts/build-results.mjs.
 */
export type MatchStats = {
  corners: SideCount;
  sot: SideCount;
  shots: SideCount;
  yellow: SideCount;
  red: SideCount;
  /** Total bookings per side (yellow + red) — the count card markets settle on. */
  cards: SideCount;
  cornersByHalf?: SideHalfCount;
  sotByHalf?: SideHalfCount;
  /**
   * Per-PLAYER shots-on-target, keyed by the player's ESPN displayName. Tallied
   * from `commentary[]` "Shot On Target" plays, each of which names the shooter
   * via `participants[0].athlete.displayName`. This is what lets per-player SOT
   * props ("Player X Over 3.5 shots on target") auto-settle — the team-level
   * `sot` totals can't be attributed to a single player on their own.
   */
  playerSot?: Record<string, number>;
  /**
   * How the FIRST goal of the match was scored — parsed from the summary
   * `keyEvents[]` of the earliest scoring play (Opta commentary text + the
   * structured `penaltyKick`/`ownGoal` flags). This is what lets the
   * "Goal Number (1) — header / direct free kick / own goal" markets auto-settle;
   * the lighter scoreboard feed carries the penalty/own-goal flags but NOT the
   * header / free-kick prose. `null` until the first goal is in. Written by
   * scripts/build-results.mjs (final) and lib/live.ts fetchStats (in-play).
   */
  firstGoalMethod?: GoalMethod | null;
  /**
   * First logged on-pitch action AFTER each half's mandatory hydration break.
   * FIFA's 2026 rule fixes the break at a set point in every match — 22' into
   * the first half, 22' into the second (≈67'), regardless of weather — so the
   * anchor is a known constant, not a guess. ESPN never logs the break itself,
   * but every corner/foul/shot/offside in the play-by-play carries a clock, so
   * we take the earliest ACTION strictly after the anchor minute. This is what
   * lets "first action after the water break to be a corner" auto-settle.
   * Keyed h1/h2; absent until commentary has a play past that half's anchor.
   * Written by lib/live.ts fetchStats (in-play) and scripts/build-results.mjs.
   */
  waterBreak?: Partial<Record<"h1" | "h2", WaterBreakAction>>;
};

/** How a goal was scored, derived from ESPN's per-event summary commentary. */
export type GoalMethod = "header" | "freekick" | "penalty" | "owngoal" | "shot";

/**
 * The first commentary ACTION after a half's hydration break, used to settle the
 * "first action after the water break = corner" market off real ESPN data.
 *
 * Honesty caveat baked into `reliable`: ESPN's commentary logs corners, fouls,
 * shots, offsides and cards — but NOT throw-ins or goal kicks, the two commonest
 * restarts. So a non-corner first logged action ("No") is solid (a corner would
 * have been logged). A corner first logged action ("Yes") is strong but not
 * airtight — an unlogged throw-in could have been the true first action — so it
 * is flagged `reliable:false` for a human eye, with `statusOverride` as the
 * final say.
 */
export type WaterBreakAction = {
  half: 1 | 2;
  /** Nominal break anchor in minutes (22 for H1, 67 for H2 under the 2026 rule). */
  anchorMinute: number;
  /**
   * How the anchor was resolved. "delay" = ESPN logged the break as a
   * Start Delay→End Delay pair near the nominal minute and we anchored on its
   * actual end (the accurate path — ESPN logs the break ~every match). "anchor"
   * = no delay pair found, fell back to the fixed nominal minute.
   */
  source: "delay" | "anchor";
  /** Match minute the break ended (the resolved anchor), when source = "delay". */
  breakEndMinute: number | null;
  /** ESPN play-type text of the first action after the break, e.g. "Corner Awarded". */
  firstActionType: string | null;
  /** Match minute of that first action. */
  firstActionMinute: number | null;
  /** True when the first logged action is a corner. */
  isCorner: boolean;
  /** False when the verdict could be wrong due to an unlogged restart — see type doc. */
  reliable: boolean;
};

/** Machine-gradable rule attached to each special so the cron settles it without a human. */
export type SpecialGrade =
  | { type: "scored"; player: string }
  | { type: "scoreAndAssist"; player: string }
  | { type: "assistsOver"; player: string; line: number }
  | { type: "firstScorer"; player: string }
  | { type: "firstScorerAndScore"; player: string; home: number; away: number }
  | { type: "scoredAndScore"; player: string; home: number; away: number }
  // Player scores at any time AND the final score is ONE OF the listed scorelines
  // (bookmaker "score AND match score 0-2, 1-2 or 1-3" OR-of-grids markets).
  | { type: "scoredAndScoreOneOf"; player: string; scores: { home: number; away: number }[] }
  | { type: "drawAndFirstScorer"; player: string }
  | { type: "freeKickGoal"; player: string }
  // How the FIRST goal of the match was scored ("Goal Number (1) — Header /
  // Direct Free Kick / Own Goal"). Settled off MatchStats.firstGoalMethod,
  // parsed from the summary keyEvents of the earliest scoring play.
  | { type: "firstGoalMethod"; method: GoalMethod }
  // "First action after the (1st/2nd-half) water break to be a corner — Yes".
  // Settled off MatchStats.waterBreak[hN], the first commentary action strictly
  // after the FIFA-2026 break anchor (22' / 67'). half = which break.
  | { type: "waterBreakCorner"; half: 1 | 2 }
  | { type: "bttsEachOver"; line: number }
  | { type: "goalsOver"; player: string; line: number }
  | { type: "htft"; ht: "1" | "X" | "2"; ft: "1" | "X" | "2" }
  | { type: "matchResult"; outcome: "1" | "X" | "2" }
  | { type: "firstScorerAndScoreOther"; player: string; excludeScores: { home: number; away: number }[] }
  // Player scores first AND a 1X2 outcome (1 = home win, X = draw, 2 = away win).
  | { type: "firstScorerAndResult"; player: string; outcome: "1" | "X" | "2" }
  // First goal of the match is scored by ANY ONE of the named players ("Ronaldo
  // OR Neto to score the first goal"). Wins iff the first scorer matches a leg.
  | { type: "firstScorerEither"; players: string[] }
  // Player scores a PENALTY goal AND the 1X2 result matches ("Ronaldo To Win And
  // Score A Penalty - Yes"). Needs a goal flagged penalty AND the outcome.
  | { type: "scoredPenaltyAndResult"; player: string; outcome: "1" | "X" | "2" }
  // Cross-match accumulator: every named player scores anytime in their OWN match.
  // Each leg carries its own matchId, so it's graded off that match's events — NOT
  // the special's single matchId. Loses the instant any leg's match ends with the
  // player off the scoresheet; pending until then; wins once all have scored.
  | { type: "multiScorers"; legs: { matchId: string; player: string }[] }
  // Generalised cross-match accumulator — like multiScorers, but each leg can be
  // a plain "player scores anytime" (kind:"scored") OR "player scores anytime AND
  // that match's final score is one of a listed set" (kind:"scoredAndScoreOneOf").
  // Each leg is graded off its OWN match. Loses the instant any leg is permanently
  // dead; pending until every leg is decidable; wins once all legs have landed.
  | { type: "multiLeg"; legs: MultiLegCond[] }
  // Player scores at any time AND the final score is NOT any listed scoreline ("Any Other Score").
  | { type: "scoredAndScoreOther"; player: string; excludeScores: { home: number; away: number }[] }
  // Correct score of the SECOND HALF alone (full-time minus half-time goals).
  | { type: "secondHalfScore"; home: number; away: number }
  // Both named players each score at any time ("Both Players To Score - Yes").
  | { type: "bothScored"; players: string[] }
  // At least ONE of the named players records an assist ("… At Least One To Make An Assist").
  | { type: "eitherAssists"; players: string[] }
  // Player scores in BOTH halves — ≥1 goal at minute ≤45 AND ≥1 at minute >45.
  | { type: "scoredBothHalves"; player: string }
  // A 1X2 outcome AND both teams score ("W1/W2/Draw + Both Teams To Score - Yes").
  | { type: "resultAndBtts"; outcome: "1" | "X" | "2" }
  // Card markets — graded off the same accent-safe nameMatch as scorers/assists.
  // "carded" = player shown any card (yellow or red); "sentOff" = player dismissed (red).
  | { type: "carded"; player: string }
  | { type: "sentOff"; player: string }
  // Match TOTAL goals (both teams) strictly over `line` — "Total Over (2.5)".
  | { type: "matchGoalsOver"; line: number }
  // A named player's shots on target strictly over `line` ("Player X Over 3.5
  // shots on target"). Settled off MatchStats.playerSot, tallied per-shooter
  // from ESPN commentary "Shot On Target" plays.
  | { type: "playerSotOver"; player: string; line: number }
  // Multi-leg build-a-bet — ALL `conds` must hold (a 1xBet accumulator single).
  // Each leg is graded off the final score (goals/result/btts) or the verified
  // ESPN MatchStats (corners / shots-on-target / cards). Pending until every
  // referenced datum is available — never a partial guess on an unseen leg.
  | { type: "combo"; conds: StatCond[] }
  // Like `combo`, but with an extra "named player scores anytime" leg the
  // stat-only StatConds can't express (evalStatCond has no events access).
  // ANDs the player goal with evalCombo(conds). Used for 1xBet accumulators
  // like "Team win each half + Player scores + Team most corners each half".
  | { type: "comboWithScorer"; player: string; conds: StatCond[] };

/**
 * One leg of a `multiLeg` cross-match accumulator. Each leg names its own match
 * and the condition that match must satisfy:
 *   - "scored": the player scores any (non-own) goal in that match.
 *   - "scoredAndScoreOneOf": the player scores AND that match's final score is one
 *     of the listed scorelines (the bookmaker "score a goal AND match score …"
 *     OR-of-grids leg). `scores` is oriented to the leg match's listed home/away.
 *   - "result": that match's full-time 1X2 outcome ("1" home win / "X" draw /
 *     "2" away win), oriented to the leg match's listed home/away.
 *   - "correctScore": that match's exact full-time score, oriented to the leg
 *     match's listed home/away.
 *   - "btts": both teams score in that match (final shows ≥1 each).
 *   - "cleanSheet": the named side keeps a clean sheet — the OTHER side scores 0
 *     ("Team 2 To Keep Clean Sheet" → side:"away", home scores 0). Oriented to
 *     the leg match's listed home/away.
 *   - "resultBtts": a 1X2 outcome AND both teams score in that match ("W2 + Both
 *     Teams To Score"). Oriented to the leg match's listed home/away.
 *
 * `negate:true` (on "scored" or "resultBtts") inverts the leg — the bookmaker's
 * "- No" pick. A negated "scored" leg WINS iff the player does NOT score (dies
 * the instant he does); a negated "resultBtts" WINS iff NOT(outcome AND btts).
 */
export type MultiLegCond =
  | { matchId: string; kind: "scored"; player: string; negate?: boolean }
  | {
      matchId: string;
      kind: "scoredAndScoreOneOf";
      player: string;
      scores: { home: number; away: number }[];
    }
  | { matchId: string; kind: "result"; outcome: "1" | "X" | "2" }
  | { matchId: string; kind: "correctScore"; home: number; away: number }
  | { matchId: string; kind: "btts" }
  | { matchId: string; kind: "cleanSheet"; side: "home" | "away" }
  | { matchId: string; kind: "resultBtts"; outcome: "1" | "X" | "2"; negate?: boolean };

/**
 * One leg of a `combo` build-a-bet. `side`/`outcome` are oriented to the
 * fixture's listed home/away ("1" = home win, "2" = away win, "X" = draw).
 * `eval*` returns true/false when decidable, or null when the needed datum
 * (final score or MatchStats) isn't in yet — which floats the whole combo to
 * "pending" rather than grading a leg blind.
 */
export type StatCond =
  // Final-score legs (need the FT score only).
  | { c: "result"; outcome: "1" | "X" | "2" }
  | { c: "goalsOver"; line: number } // total match goals (both teams) > line
  | { c: "btts" } // both teams scored (FT shows ≥1 each)
  // Corner legs (need MatchStats.corners).
  | { c: "cornersTotalOver"; line: number }
  | { c: "cornersTotalUnder"; line: number }
  | { c: "cornersTotalBetween"; lo: number; hi: number } // inclusive range
  | { c: "eachTeamCornersAtLeast"; n: number }
  | { c: "mostCorners"; side: "home" | "away" } // strictly more (a tie loses)
  // Card legs (need MatchStats.cards = yellow + red per side).
  | { c: "cardsTotalOver"; line: number }
  | { c: "cardsTotalUnder"; line: number }
  | { c: "eachTeamCardsAtLeast"; n: number }
  | { c: "mostCards"; side: "home" | "away" } // strictly more (a tie loses)
  // Per-half legs (need the by-half splits from commentary).
  | { c: "eachTeamCornersEachHalfAtLeast"; n: number }
  | { c: "eachTeamSotEachHalfAtLeast"; n: number }
  // Side wins BOTH halves (1st half off the HT score; 2nd half off FT − HT).
  | { c: "winEachHalf"; side: "home" | "away" }
  // Side takes MORE corners than the opponent in BOTH halves (strict; tie loses).
  | { c: "mostCornersEachHalf"; side: "home" | "away" };

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
  /** Verified ESPN summary stats per match — shared truth, fills the corner/SOT/card gap. */
  matchStats?: Record<string, MatchStats>;
  bets: Bet[];
  specialsNote?: string;
  specials?: Special[];
};

// Rj's slip. This file ALSO doubles as the canonical store of shared scraped
// truth (`results` + `matchEvents`) — the build-results cron fills it for EVERY
// finished match, not just Rj's bets — so any other owner's slip can borrow that
// truth at runtime and only carry its own `bets`/`specials`.
export const betSlip = betsJson as BetSlipFile;

// Ruhan's slip — own meta/bets/specials, reads the shared truth above.
export const ruhanSlip = ruhanJson as BetSlipFile;

export function getResult(matchId: string): MatchResult {
  return betSlip.results[matchId] ?? { ht: null, ft: null };
}

export function getEvents(matchId: string): MatchEvents {
  return betSlip.matchEvents?.[matchId] ?? { status: "scheduled", goals: [] };
}

/** Verified ESPN stats for a match (corners/SOT/cards), or null if not snapshotted yet. */
export function getStats(matchId: string): MatchStats | null {
  return betSlip.matchStats?.[matchId] ?? null;
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

export function settleAll(slip: BetSlipFile = betSlip): SettledBet[] {
  return slip.bets.map((bet) => {
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
  /** Bets refunded (stake returned) — e.g. first-scorer pick that didn't start. */
  voided: number;
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
    voided: settled.filter((b) => b.status === "void").length,
    settledPnl: settled.reduce((s, b) => s + b.pnl, 0),
    // A void neither wins nor loses — its stake is no longer at risk, so it
    // doesn't count as settled-and-staked (P&L on it is 0).
    settledStake: settled
      .filter((b) => b.status === "won" || b.status === "lost")
      .reduce((s, b) => s + b.stake, 0),
    // Returns = winners' full payout + voided stakes handed back.
    returned:
      settled.filter((b) => b.status === "won").reduce((s, b) => s + b.potential, 0) +
      settled.filter((b) => b.status === "void").reduce((s, b) => s + b.stake, 0),
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

/** Strip diacritics so ESPN's "Luis Díaz" / "Daniel Muñoz" match plain-ASCII picks. */
const deburr = (s: string): string =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

/** Loose name match — "Ronaldo" matches "Cristiano Ronaldo", case- and accent-insensitive, either direction. */
function nameMatch(a: string, b: string): boolean {
  const x = deburr(a);
  const y = deburr(b);
  return x === y || x.includes(y) || y.includes(x);
}

/** Sum a player's shots-on-target from the per-shooter map, matching names accent-safe. */
export const playerSotCount = (stats: MatchStats | null, player: string): number => {
  const map = stats?.playerSot;
  if (!map) return 0;
  return Object.entries(map).reduce(
    (n, [name, count]) => (nameMatch(name, player) ? n + count : n),
    0,
  );
};

const realGoals = (goals: Goal[]) => goals.filter((g) => !g.ownGoal);
const goalsBy = (goals: Goal[], player: string) =>
  realGoals(goals).filter((g) => nameMatch(g.scorer, player));
const assistsBy = (goals: Goal[], player: string) =>
  goals.filter((g) => g.assist && nameMatch(g.assist, player));
const firstScorer = (goals: Goal[]): string | null => realGoals(goals)[0]?.scorer ?? null;

/**
 * Did `player` start the match? Reads the confirmed XI from predictions.
 *   true  — player is in a confirmed starting XI (home or away)
 *   false — confirmed XIs exist and the player started for NEITHER side
 *   null  — no confirmed lineup yet, so we can't tell (don't void on a guess)
 * First-goalscorer markets VOID (stake returned) when a named player doesn't
 * start; anytime-scorer markets are NOT affected (a sub can still score).
 */
export function playerStarted(matchId: string, player: string): boolean | null {
  const lu = getPrediction(matchId)?.lineups;
  if (!lu || lu.status !== "confirmed") return null;
  const xi = [...(lu.homeXI?.players ?? []), ...(lu.awayXI?.players ?? [])];
  if (xi.length === 0) return null;
  return xi.some((p) => nameMatch(p.name, player));
}

/** First-goalscorer grade types that void when the named player doesn't start. */
const FIRST_SCORER_VOID_TYPES = new Set<SpecialGrade["type"]>([
  "firstScorer",
  "firstScorerAndScore",
  "firstScorerAndScoreOther",
  "firstScorerAndResult",
  "drawAndFirstScorer",
]);

/** Bookings for a player — accent-safe, same matcher as goals/assists. */
const cardsBy = (cards: Card[], player: string) => cards.filter((c) => nameMatch(c.player, player));
const isFinalScore = (ft: Score, home: number, away: number) =>
  !!ft && ft.home === home && ft.away === away;
const isDraw = (ft: Score) => !!ft && ft.home === ft.away;

// ── combo build-a-bet legs (final-score + verified-stats) ────────────────────
/**
 * Evaluate ONE combo leg. Returns:
 *   true  — leg satisfied
 *   false — leg failed
 *   null  — undecidable yet (the score or the ESPN stat it needs isn't in)
 * Shared by the final settle (bets.ts) and the live tracker (inplay.ts) so the
 * two never disagree. `score` is the score to judge against (FT when settling,
 * the live score in-play); stat legs read `stats`.
 */
export function evalStatCond(
  cond: StatCond,
  score: Score,
  ht: Score,
  stats: MatchStats | null,
): boolean | null {
  const c = cond;
  switch (c.c) {
    case "result": {
      if (!score) return null;
      const o = score.home > score.away ? "1" : score.home < score.away ? "2" : "X";
      return o === c.outcome;
    }
    case "goalsOver":
      return score ? score.home + score.away > c.line : null;
    case "btts":
      return score ? score.home >= 1 && score.away >= 1 : null;
    case "cornersTotalOver":
      return stats ? stats.corners.home + stats.corners.away > c.line : null;
    case "cornersTotalUnder":
      return stats ? stats.corners.home + stats.corners.away < c.line : null;
    case "cornersTotalBetween": {
      if (!stats) return null;
      const t = stats.corners.home + stats.corners.away;
      return t >= c.lo && t <= c.hi;
    }
    case "eachTeamCornersAtLeast":
      return stats ? stats.corners.home >= c.n && stats.corners.away >= c.n : null;
    case "mostCorners":
      if (!stats) return null;
      return c.side === "home"
        ? stats.corners.home > stats.corners.away
        : stats.corners.away > stats.corners.home;
    case "cardsTotalOver":
      return stats ? stats.cards.home + stats.cards.away > c.line : null;
    case "cardsTotalUnder":
      return stats ? stats.cards.home + stats.cards.away < c.line : null;
    case "eachTeamCardsAtLeast":
      return stats ? stats.cards.home >= c.n && stats.cards.away >= c.n : null;
    case "mostCards":
      if (!stats) return null;
      return c.side === "home"
        ? stats.cards.home > stats.cards.away
        : stats.cards.away > stats.cards.home;
    case "eachTeamCornersEachHalfAtLeast": {
      const h = stats?.cornersByHalf;
      if (!h) return null;
      return h.home[0] >= c.n && h.home[1] >= c.n && h.away[0] >= c.n && h.away[1] >= c.n;
    }
    case "eachTeamSotEachHalfAtLeast": {
      const s = stats?.sotByHalf;
      if (!s) return null;
      return s.home[0] >= c.n && s.home[1] >= c.n && s.away[0] >= c.n && s.away[1] >= c.n;
    }
    case "winEachHalf": {
      if (!score || !ht) return null;
      const h1 = c.side === "home" ? ht.home > ht.away : ht.away > ht.home;
      const sh = score.home - ht.home;
      const sa = score.away - ht.away;
      const h2 = c.side === "home" ? sh > sa : sa > sh;
      return h1 && h2;
    }
    case "mostCornersEachHalf": {
      const h = stats?.cornersByHalf;
      if (!h) return null;
      return c.side === "home"
        ? h.home[0] > h.away[0] && h.home[1] > h.away[1]
        : h.away[0] > h.home[0] && h.away[1] > h.home[1];
    }
  }
}

/**
 * AND every leg. A single failed leg sinks the combo (false) even if another leg
 * is still pending. If no leg has failed but some are undecidable, the whole
 * combo is pending (null) — we never settle a build-a-bet on a half-seen slip.
 */
export function evalCombo(
  conds: StatCond[],
  score: Score,
  ht: Score,
  stats: MatchStats | null,
): boolean | null {
  let pending = false;
  for (const c of conds) {
    const v = evalStatCond(c, score, ht, stats);
    if (v === false) return false;
    if (v === null) pending = true;
  }
  return pending ? null : true;
}

/**
 * True when at least one combo leg is now PERMANENTLY impossible, so the whole
 * AND can never come good — settle/show it as a loss before the whistle.
 *
 * This is narrower than `evalCombo` returning false: a full-match leg (result,
 * mostCorners, goalsOver…) reads false mid-match but can still flip, so it is
 * NOT dead until FT. Only PER-HALF legs lock early — the first half's portion is
 * fixed the instant the half ends (HT score + H1 by-half splits are final). So
 * the moment H1 is complete (`ht` non-null), a per-half leg whose H1 requirement
 * already failed can never recover, regardless of what happens after the break.
 *
 * Pass the HALF-TIME score as `ht` (null while H1 is still in play → nothing is
 * locked yet, returns false). Only checks the H1 component; the H2 component
 * stays live until FT, where `evalCombo` settles it.
 */
export function comboDead(conds: StatCond[], ht: Score, stats: MatchStats | null): boolean {
  if (!ht) return false; // first half not complete — nothing is locked
  const h = stats?.cornersByHalf;
  const s = stats?.sotByHalf;
  for (const c of conds) {
    switch (c.c) {
      case "winEachHalf": {
        // H1 is final at the HT score; if the side didn't win it, "each half" is dead.
        const wonH1 = c.side === "home" ? ht.home > ht.away : ht.away > ht.home;
        if (!wonH1) return true;
        break;
      }
      case "mostCornersEachHalf": {
        if (!h) break; // H1 corner split not in yet — can't lock it dead
        const wonH1 = c.side === "home" ? h.home[0] > h.away[0] : h.away[0] > h.home[0];
        if (!wonH1) return true;
        break;
      }
      case "eachTeamCornersEachHalfAtLeast":
        if (h && (h.home[0] < c.n || h.away[0] < c.n)) return true;
        break;
      case "eachTeamSotEachHalfAtLeast":
        if (s && (s.home[0] < c.n || s.away[0] < c.n)) return true;
        break;
    }
  }
  return false;
}

/**
 * Auto-grade a single special off scraped match events + the final score.
 * Returns "pending" until the match is finished (events.status === "finished").
 * A manual `statusOverride` always wins (bad-scrape safety valve).
 */
export function gradeSpecial(special: Special): BetStatus {
  if (special.statusOverride) return special.statusOverride;
  const g = special.grade;
  if (!g) return "pending";

  // Cross-match accumulator — graded off EACH leg's own match, so it can't use the
  // single-match events/ft guard below. Resolve it up front.
  if (g.type === "multiScorers") {
    let pending = false;
    for (const leg of g.legs) {
      const ev = getEvents(leg.matchId);
      if (goalsBy(ev.goals, leg.player).length > 0) continue; // leg already won
      if (ev.status === "finished") return "lost"; // his match ended, no goal → dead
      pending = true; // still in play
    }
    return pending ? "pending" : "won";
  }

  // Generalised cross-match accumulator — each leg graded off its OWN match's
  // events + final score, so it can't use the single-match guard below either.
  if (g.type === "multiLeg") {
    let pending = false;
    for (const leg of g.legs) {
      const ev = getEvents(leg.matchId);
      const finished = ev.status === "finished";

      if (leg.kind === "scored") {
        const scoredIt = goalsBy(ev.goals, leg.player).length > 0;
        if (leg.negate) {
          // "- No": he must NOT score. Dies the instant he does; wins at FT blank.
          if (scoredIt) return "lost";
          if (finished) continue; // match over, never scored → leg won
          pending = true;
          continue;
        }
        if (scoredIt) continue; // leg won, even mid-match
        if (finished) return "lost"; // his match ended, no goal → whole acca dead
        pending = true;
        continue;
      }

      // Every remaining leg kind needs the FINAL score, so it can't decide
      // until the leg match is finished.
      if (!finished) {
        pending = true;
        continue;
      }
      const ft = getResult(leg.matchId).ft;

      if (leg.kind === "scoredAndScoreOneOf") {
        const scoredIt = goalsBy(ev.goals, leg.player).length > 0;
        const onGrid = leg.scores.some((s) => isFinalScore(ft, s.home, s.away));
        if (!(scoredIt && onGrid)) return "lost";
        continue;
      }

      if (leg.kind === "result") {
        // 1X2: full-time outcome oriented to the leg match's home/away.
        if (!ft) return "lost";
        const outcome = ft.home > ft.away ? "1" : ft.home < ft.away ? "2" : "X";
        if (outcome !== leg.outcome) return "lost";
        continue;
      }

      if (leg.kind === "correctScore") {
        if (!isFinalScore(ft, leg.home, leg.away)) return "lost";
        continue;
      }

      if (leg.kind === "btts") {
        // Both teams scored in that match.
        if (!ft || !(ft.home >= 1 && ft.away >= 1)) return "lost";
        continue;
      }

      if (leg.kind === "cleanSheet") {
        // The named side conceded zero (the OTHER side scored 0).
        if (!ft) return "lost";
        const conceded = leg.side === "home" ? ft.away : ft.home;
        if (conceded !== 0) return "lost";
        continue;
      }

      if (leg.kind === "resultBtts") {
        // 1X2 outcome AND both teams scored, oriented to the leg match's
        // home/away. negate flips it ("- No": NOT(outcome AND btts)).
        if (!ft) return "lost";
        const outcome = ft.home > ft.away ? "1" : ft.home < ft.away ? "2" : "X";
        const raw = outcome === leg.outcome && ft.home >= 1 && ft.away >= 1;
        if (!(leg.negate ? !raw : raw)) return "lost";
        continue;
      }
    }
    return pending ? "pending" : "won";
  }

  const events = getEvents(special.matchId);
  const ft = getResult(special.matchId).ft;

  // First-goalscorer void is known the MOMENT the XI is confirmed — it does not
  // depend on the match being finished. Resolve it BEFORE the "not finished →
  // pending" gate, so the static/SSR verdict is "void" (Refunded) right away
  // instead of "Awaiting result" until the live poll catches it. Mirrors the
  // ordering in inPlaySpecial, where the void gate also sits before everything.
  if (FIRST_SCORER_VOID_TYPES.has(g.type) && "player" in g) {
    if (playerStarted(special.matchId, g.player) === false) return "void";
  }
  if (g.type === "firstScorerEither") {
    // "A or B to score first" voids only if EVERY named player failed to start.
    // If any started (or any is still unconfirmed), the bet stands.
    const states = g.players.map((p) => playerStarted(special.matchId, p));
    if (states.length > 0 && states.every((s) => s === false)) return "void";
  }

  if (events.status !== "finished") return "pending";

  const { goals } = events;
  const cards = events.cards ?? [];
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
    case "firstScorerAndScoreOther":
      // Player scores first AND the final score is NOT any of the bookmaker's
      // explicitly-listed scorelines ("Any Other Score" catch-all bucket).
      hit =
        !!ft &&
        !!firstScorer(goals) &&
        nameMatch(firstScorer(goals)!, g.player) &&
        !g.excludeScores.some((s) => s.home === ft.home && s.away === ft.away);
      break;
    case "scoredAndScore":
      hit = goalsBy(goals, g.player).length > 0 && isFinalScore(ft, g.home, g.away);
      break;
    case "scoredAndScoreOther":
      // Player scores anytime AND the final score is OUTSIDE the listed grid.
      hit =
        !!ft &&
        goalsBy(goals, g.player).length > 0 &&
        !g.excludeScores.some((s) => s.home === ft.home && s.away === ft.away);
      break;
    case "scoredAndScoreOneOf":
      // Player scores anytime AND the final score is ONE OF the listed scorelines.
      hit =
        goalsBy(goals, g.player).length > 0 &&
        g.scores.some((s) => isFinalScore(ft, s.home, s.away));
      break;
    case "firstScorerAndResult": {
      // Player scores first AND the full-time 1X2 outcome matches.
      if (!ft) break;
      const outcome = ft.home > ft.away ? "1" : ft.home < ft.away ? "2" : "X";
      hit =
        !!firstScorer(goals) &&
        nameMatch(firstScorer(goals)!, g.player) &&
        outcome === g.outcome;
      break;
    }
    case "secondHalfScore": {
      // Correct score of the second half alone = full-time minus half-time goals.
      const ht = getResult(special.matchId).ht;
      if (!ht || !ft) break;
      hit = ft.home - ht.home === g.home && ft.away - ht.away === g.away;
      break;
    }
    case "bothScored":
      // Every listed player scores at least one (non-own) goal.
      hit = g.players.every((p) => goalsBy(goals, p).length > 0);
      break;
    case "eitherAssists":
      // At least one of the named players records an assist.
      hit = g.players.some((p) => assistsBy(goals, p).length > 0);
      break;
    case "scoredBothHalves": {
      // Player scores in each half — a goal at minute ≤45 AND one at minute >45.
      const mine = goalsBy(goals, g.player);
      const firstHalf = mine.some((gl) => gl.minute != null && gl.minute <= 45);
      const secondHalf = mine.some((gl) => gl.minute != null && gl.minute > 45);
      hit = firstHalf && secondHalf;
      break;
    }
    case "resultAndBtts": {
      // 1X2 outcome AND both teams scored (final score shows ≥1 each).
      if (!ft) break;
      const outcome = ft.home > ft.away ? "1" : ft.home < ft.away ? "2" : "X";
      hit = outcome === g.outcome && ft.home >= 1 && ft.away >= 1;
      break;
    }
    case "drawAndFirstScorer":
      hit = isDraw(ft) && !!firstScorer(goals) && nameMatch(firstScorer(goals)!, g.player);
      break;
    case "freeKickGoal":
      hit = goalsBy(goals, g.player).some((gl) => gl.freeKick === true);
      break;
    case "firstScorerEither": {
      const fs = firstScorer(goals);
      hit = !!fs && g.players.some((p) => nameMatch(fs, p));
      break;
    }
    case "scoredPenaltyAndResult": {
      // Player scores a penalty AND the 1X2 result matches.
      if (!ft) break;
      const outcome = ft.home > ft.away ? "1" : ft.home < ft.away ? "2" : "X";
      hit =
        goalsBy(goals, g.player).some((gl) => gl.penalty === true) && outcome === g.outcome;
      break;
    }
    case "firstGoalMethod": {
      // "Goal Number (1) — header / free kick / own goal". Needs the verified
      // first-goal method from the summary. If no goal was scored (0-0), the
      // market loses. Stays pending until the method is parsed.
      const method = getStats(special.matchId)?.firstGoalMethod;
      if (method === undefined || method === null) {
        // FT with a goal but no parsed method shouldn't happen, but never
        // grade blind — leave pending for a manual look.
        return ft && ft.home + ft.away > 0 ? "pending" : "lost";
      }
      hit = method === g.method;
      break;
    }
    case "waterBreakCorner": {
      // "First action after the water break = corner — Yes". Read the first
      // commentary action after the fixed 2026 anchor (22' H1 / 67' H2). Stays
      // pending until that half's commentary has a play past the anchor; then
      // wins iff that action is a corner. statusOverride is the human safety
      // valve for the unlogged-restart edge case (see WaterBreakAction doc).
      const wb = getStats(special.matchId)?.waterBreak?.[g.half === 1 ? "h1" : "h2"];
      if (!wb || wb.firstActionType === null) return "pending";
      hit = wb.isCorner;
      break;
    }
    case "bttsEachOver": {
      // Both teams score strictly more than `line` goals (line=1 → 2+ each).
      const home = goals.filter((gl) => gl.team === "home" && !gl.ownGoal).length;
      const away = goals.filter((gl) => gl.team === "away" && !gl.ownGoal).length;
      hit = home > g.line && away > g.line;
      break;
    }
    case "goalsOver":
      // Player scores strictly more than `line` goals (line=1.5 → 2+ = brace/over-1.5).
      hit = goalsBy(goals, g.player).length > g.line;
      break;
    case "htft": {
      // Half-time AND full-time 1X2 outcome must both match.
      const ht = getResult(special.matchId).ht;
      if (!ht || !ft) break;
      const outcome = (s: { home: number; away: number }) =>
        s.home > s.away ? "1" : s.home < s.away ? "2" : "X";
      hit = outcome(ht) === g.ht && outcome(ft) === g.ft;
      break;
    }
    case "matchResult": {
      // Full-time 1X2 outcome (1 = home win, X = draw, 2 = away win).
      if (!ft) break;
      const outcome = ft.home > ft.away ? "1" : ft.home < ft.away ? "2" : "X";
      hit = outcome === g.outcome;
      break;
    }
    case "matchGoalsOver":
      // Total match goals (both teams, incl. own goals) strictly over the line.
      hit = !!ft && ft.home + ft.away > g.line;
      break;
    case "playerSotOver":
      // Player's shots-on-target strictly over the line, from the per-shooter
      // tally. Settles only at FT here (the live tracker locks an early "won"
      // the moment the count clears the line).
      hit = playerSotCount(getStats(special.matchId), g.player) > g.line;
      break;
    case "combo": {
      // Build-a-bet: AND every leg off the FT score + verified ESPN stats. If a
      // stat leg's data isn't snapshotted yet, the combo stays pending (never a
      // blind loss on an unseen corner/SOT/card leg).
      const verdict = evalCombo(g.conds, ft, getResult(special.matchId).ht, getStats(special.matchId));
      if (verdict === null) return "pending";
      hit = verdict;
      break;
    }
    case "comboWithScorer": {
      // Stat legs AND a "named player scores anytime" leg the StatConds can't
      // hold on their own. Stats pending → whole bet pending (never a blind loss).
      const verdict = evalCombo(g.conds, ft, getResult(special.matchId).ht, getStats(special.matchId));
      if (verdict === null) return "pending";
      hit = verdict && goalsBy(goals, g.player).length > 0;
      break;
    }
    case "carded":
      // Player shown any card during the match (yellow or red).
      hit = cardsBy(cards, g.player).length > 0;
      break;
    case "sentOff":
      // Player dismissed — a red (straight or second-yellow, both stored as "red").
      hit = cardsBy(cards, g.player).some((c) => c.type === "red");
      break;
  }
  return hit ? "won" : "lost";
}

export function settleSpecials(slip: BetSlipFile = betSlip): SettledSpecial[] {
  return (slip.specials ?? []).map((s) => {
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
    voided: a.voided + b.voided,
    settledPnl: a.settledPnl + b.settledPnl,
    settledStake: a.settledStake + b.settledStake,
    returned: a.returned + b.returned,
  };
}
