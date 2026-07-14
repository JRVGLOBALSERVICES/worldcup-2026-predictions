import betsJson from "@/data/bets.json";
import ruhanJson from "@/data/bets-ruhan.json";
import thasyanJson from "@/data/bets-thasyan.json";
import siveshJson from "@/data/bets-sivesh.json";
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
// `advanced` = which side PROGRESSED to the next round (knockout only), by any
// means — 90-min win, extra time, or penalty shootout. Captured by
// scripts/build-results.mjs once a tie is final; absent/null for group games and
// ties not yet decided. This is what separates a "to qualify" market (settles on
// advancement) from a 1X2 "to win" market (settles on the 90-minute score).
// `ft` is the full-time score INCLUDING extra time (so a 2-1 AET reads 2-1); `ft90`
// is the 90-minute scoreline (ET goals removed) that every 90-minute market settles
// on. `finishPhase` is ESPN's authoritative match-end phase. For group/regulation
// games ft90 === ft and finishPhase === "regulation".
export type MatchResult = {
  ht: Score;
  ft: Score;
  ft90?: Score;
  advanced?: "home" | "away" | null;
  finishPhase?: "regulation" | "extra_time" | "penalties" | null;
};

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
  /**
   * Real goal scored in EXTRA TIME (minute > 90 of an ET/pens knockout). Excluded
   * from every 90-minute market (1X2, correct score, first/anytime scorer, totals)
   * — only "to qualify" counts goals beyond 90. Never set on a group/regulation
   * game (no ET played). Shootout kicks are dropped entirely upstream, not flagged.
   */
  et?: boolean;
  /**
   * Goal struck from OUTSIDE the penalty area. Parsed from ESPN's per-event
   * summary keyEvents commentary prose ("…with a right footed shot from outside
   * the box"). The lighter scoreboard feed carries no location, so this is only
   * set once the summary is read (scripts/build-results.mjs + lib/live.ts).
   * Absent/false = inside the box or not yet determined. This is what lets the
   * "Player to score from outside the penalty area" market auto-settle.
   */
  outsideBox?: boolean;
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
/**
 * One shooter's full live shot line. `sot` counts "Shot On Target" plays PLUS
 * goals (a goal is always on target — mirrors the boxscore shotsOnTarget
 * convention); `off` includes woodwork; `shots` = sot + off + blocked (the
 * same attempts the playerShots settling tally counts).
 */
export type PlayerShotLine = {
  team: "home" | "away";
  shots: number;
  sot: number;
  off: number;
  blocked: number;
  goals: number;
};

/** One substitution, parsed from ESPN commentary "Substitution" plays. */
export type Substitution = {
  team: "home" | "away";
  minute: number | null;
  /** Player coming ON. */
  on: string;
  /** Player going OFF. */
  off: string;
  /** ESPN's prose flagged it as an injury change ("because of an injury"). */
  injury: boolean;
};

export type MatchStats = {
  corners: SideCount;
  sot: SideCount;
  shots: SideCount;
  yellow: SideCount;
  red: SideCount;
  /** Total bookings per side (yellow + red) — the count card markets settle on. */
  cards: SideCount;
  /**
   * Fouls committed per side, from `boxscore.teams[].statistics` foulsCommitted.
   * This is what lets "Total Match Fouls O/U" legs auto-settle. Optional because
   * stats snapshotted before 2026-07-06 never captured it.
   */
  fouls?: SideCount;
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
   * Per-PLAYER TOTAL shots (on target + off target + blocked + woodwork + goals),
   * keyed by the player's ESPN displayName. Tallied from `commentary[]` shot-type
   * plays ("Shot On Target/Off Target/Blocked/Hit Woodwork") plus goal plays
   * (excluding own goals — a goal is always a shot). Verified against the
   * boxscore `totalShots` team totals. This is what lets per-player SHOTS props
   * ("Player X Over 0.5 shots") auto-settle — `playerSot` alone can't, since an
   * off-target attempt is a shot but not an SOT.
   */
  playerShots?: Record<string, number>;
  /**
   * Full per-player shot breakdown — one PlayerShotLine per shooter (total /
   * on target / off target / blocked / goals + which side he plays for).
   * Superset of `playerSot`/`playerShots` (those stay the settling maps); this
   * feeds the live player-shots board so shots props track shot by shot.
   */
  playerShotBreakdown?: Record<string, PlayerShotLine>;
  /**
   * Per-player TACKLE counts (Opta totalTackles) — keyed by ESPN displayName.
   * The summary boxscore/commentary carry NO per-player tackle data; these come
   * from ESPN's core API (sports.core.api.espn.com …/competitors/<team>/roster/
   * <athleteId>/statistics/0 → defensive.totalTackles), fetched ONLY for players
   * named in a playerTacklesOver leg (bounded request count). A key that's
   * PRESENT is a verified count (0 included); a missing key means the core fetch
   * hasn't landed — graders must hold pending, never blind-lose, on absence.
   * Written by scripts/build-results.mjs (final) and lib/live.ts (in-play).
   */
  playerTackles?: Record<string, number>;
  /**
   * Substitutions in match order — who came on / went off, the minute, and
   * whether ESPN's prose flags an injury. Drives the subs log + feed chips
   * (a subbed-off player's shot line is frozen — critical for shots props).
   */
  subs?: Substitution[];
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
   * Which side took the match's FIRST penalty kick — scored, missed, OR saved —
   * parsed from the summary `keyEvents` (a scored pen carries `penaltyKick:true`;
   * a miss/save only shows as a "Penalty - Missed/Saved" play). Earliest by
   * period→clock, oriented to our home/away. Lets the "Team to take/be awarded
   * the first penalty" market auto-settle. `null` until a penalty is taken (and
   * stays null all match if none is — that market then voids). Written by
   * scripts/build-results.mjs (final) and lib/live.ts fetchStats (in-play).
   */
  firstPenalty?: "home" | "away" | null;
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
  /**
   * Tempo / territory stats from the same `boxscore.teams[].statistics` block —
   * possessionPct, totalPasses, totalTackles, saves, offsides, blockedShots,
   * interceptions, effectiveClearance. No bet market settles on these (yet);
   * they exist so the live match view can show — and animate — the full picture
   * of a game, not just the settling counts. Optional because stats snapshotted
   * before 2026-07-06 never captured them.
   */
  tempo?: TempoStats;
  /**
   * The COMPLETE ESPN boxscore statistics list, home/away zipped per entry —
   * everything the summary publishes (28 lines as of R16: shots, pass counts +
   * completion %, crosses, long balls, tackles, clearances, penalty counts…),
   * with ESPN's own label and displayValue strings so percents survive intact.
   * Display-only ("all match stats" boards under the live feed); settlement
   * keeps reading the typed counts above. Optional — snapshots before
   * 2026-07-07 never captured it.
   */
  full?: FullStatLine[];
  /**
   * Per-player match sheet — one line per player who FEATURED (started or came
   * on), both teams, oriented to our home/away. The G/A/shots/SOT/fouls/cards/
   * saves counts come off the summary team sheet (`rosters[].roster[].stats`)
   * so they tick live on the poll; passes/tackles/blocks only exist in ESPN's
   * core API (one fetch per athlete — see lib/live-stats.ts core sweep) and are
   * merged in by scripts/build-results.mjs from the data/stats.json cache, so
   * they're absent (`undefined`, render "–") until the hourly sweep covers the
   * match. Display-only; settlement keeps reading the maps above. Optional —
   * snapshots before 2026-07-09 never captured it.
   */
  players?: PlayerStatLine[];
};

/**
 * One player's line on the per-match sheet — see MatchStats.players. Compact
 * keys on purpose: ~30 lines ride every match in results.json AND the 5s
 * /api/live payload. A missing tk/bk/ps means "core sweep hasn't covered this
 * match yet" (0 is a real verified count), mirroring the playerTackles rule.
 */
export type PlayerStatLine = {
  team: "home" | "away";
  name: string;
  /** Position code off the team sheet (G/D/M/F). */
  pos: string;
  /** Shirt number (null if unlisted). */
  num: number | null;
  /** true = started; false = came on as a sub. */
  starter: boolean;
  /** ESPN athlete id — the merge key for the core-API sweep backfill. */
  aid?: string;
  /** Keeper flag — sv/gc only carry meaning on these lines. */
  gk?: boolean;
  /** Goals · assists · total shots · shots on target. */
  g: number;
  a: number;
  sh: number;
  sot: number;
  /** Fouls committed · fouls suffered · yellows · reds · offsides. */
  fc: number;
  fs: number;
  yc: number;
  rc: number;
  off: number;
  og?: number;
  /** Keeper: saves · goals conceded. */
  sv?: number;
  gc?: number;
  /** Core-sweep Opta counts: tackles · blocked shots · passes. */
  tk?: number;
  bk?: number;
  ps?: number;
};

/** One line of the complete ESPN boxscore — see MatchStats.full. */
export type FullStatLine = {
  /** ESPN stat name, e.g. "totalPasses", "shotPct". */
  key: string;
  /** ESPN's human label, e.g. "Pass Completion %". */
  label: string;
  home: string;
  away: string;
};

/** Full-picture team stats for the live view — see MatchStats.tempo. */
export type TempoStats = {
  /** Possession percent per side (ESPN possessionPct, e.g. 66.4). */
  possession: SideCount;
  passes: SideCount;
  tackles: SideCount;
  saves: SideCount;
  offsides: SideCount;
  blockedShots: SideCount;
  interceptions: SideCount;
  clearances: SideCount;
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
  // Player scores a goal struck from OUTSIDE the penalty area ("Player To Score
  // From Outside The Penalty Area — Yes"). Settled off the per-goal `outsideBox`
  // flag parsed from the summary keyEvents prose. Loses at FT if no such goal.
  | { type: "scoredOutsideBox"; player: string }
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
  // A named player's GOALS + ASSISTS combined strictly over `line` ("Mbappe
  // Total Goals + Assists Combined Over 2.5" → needs 3+). Settled off the same
  // goalsBy / assistsBy tallies used by goalsOver and assistsOver.
  | { type: "goalsAssistsOver"; player: string; line: number }
  // A bookmaker qualifier ESPN's feed cannot verify ("Team to score a penalty
  // FOR A FOUL ON <player>"): the penalty goal and scorer are in the feed, but
  // the foul-drawn-by attribution is not. Never auto-resolved — stays pending
  // for a human to settle by eye. `note` says what to check.
  | { type: "manual"; note: string }
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
 *   - "bttsEachOver": EACH team scores strictly more than `line` non-own goals
 *     ("Each Team To Score (2) Or More" → line:1 → 2+ each). negate = the "- No".
 *   - "totalUnder": that match's TOTAL goals are under `line` ("Asian Total
 *     Under 2.25" → line:2.25 → won at ≤2, lost at ≥3). Integer goals mean a
 *     plain `total < line` is exact for whole/quarter lines and is directionally
 *     correct for the .25 push-leg (a 2-goal game still nets positive on Under
 *     2.25), which is all a binary acca leg needs.
 *
 * `negate:true` (on "scored", "resultBtts" or "bttsEachOver") inverts the leg — the bookmaker's
 * "- No" pick. A negated "scored" leg WINS iff the player does NOT score (dies
 * the instant he does); a negated "resultBtts" WINS iff NOT(outcome AND btts).
 *
 * `odds` (optional) = this individual leg's decimal price AT PLACEMENT, as shown
 * on the slip before any settlement. CAPTURE IT for every leg when entering a
 * slip — it's the only way to reconcile a refund/void: when a leg voids, 1xBet
 * replaces its price with 1.00 in the acca (new total = placement odds ÷ this
 * leg's `odds`), and without the original per-leg price that recalculation can't
 * be reproduced from stored data. Absent on legacy legs entered before this field
 * existed (their prices were never recorded); present going forward.
 */
export type MultiLegCond = { odds?: number } & (
  | { matchId: string; kind: "scored"; player: string; negate?: boolean }
  // EITHER of the named players scores at any time ("Who Will Score A Goal At
  // Any Time: A Or B — Yes"). 1xBet settles this off "Player stats (including
  // extra time)", so ET goals COUNT (unlike `scored`, a 90-minute market) —
  // own goals still don't. Clinches the moment either player scores; dead only
  // at the true final whistle with both blank.
  | { matchId: string; kind: "eitherScored"; players: string[] }
  | {
      matchId: string;
      kind: "scoredAndScoreOneOf";
      player: string;
      scores: { home: number; away: number }[];
    }
  | { matchId: string; kind: "result"; outcome: "1" | "X" | "2" }
  // Knockout ADVANCEMENT — the named side reaches the next round, by ANY means
  // (90-min win, extra time, OR penalty shootout). Distinct from `result` (a
  // 90-minute 1X2 win): a side that draws after 90 and goes through on penalties
  // WINS a `qualify` leg but LOSES a `result` leg. Settles off `advanced` (who
  // progressed); falls back to the FT score only when one side wins in regulation.
  | { matchId: string; kind: "qualify"; side: "home" | "away" }
  | { matchId: string; kind: "correctScore"; home: number; away: number }
  | { matchId: string; kind: "btts"; negate?: boolean }
  | { matchId: string; kind: "cleanSheet"; side: "home" | "away"; negate?: boolean }
  | { matchId: string; kind: "resultBtts"; outcome: "1" | "X" | "2"; negate?: boolean }
  | { matchId: string; kind: "bttsEachOver"; line: number; negate?: boolean }
  | { matchId: string; kind: "totalUnder"; line: number }
  // Total match goals (both teams) strictly over `line` ("Total Over (2)" →
  // line:2 → won at 3+, lost at ≤2). Mirror of `totalUnder`; integer goals make
  // `total > line` exact for whole/half lines (a 2-goal game grades identically
  // for line 2 and 2.5), so the displayed line drives the label.
  | { matchId: string; kind: "totalOver"; line: number }
  // Double chance — FT outcome is one of two ("1X" = home or draw, "12" = home
  // or away, "X2" = draw or away), oriented to the leg match's home/away.
  | { matchId: string; kind: "doubleChance"; outcome: "1X" | "12" | "X2" }
  // 1X2 off the HALF-TIME score ("1X2 … 1st half"), oriented to home/away.
  | { matchId: string; kind: "resultFirstHalf"; outcome: "1" | "X" | "2" }
  // Double chance on the 1st-half result only ("Argentina or Tie" 1st Half
  // Double Chance → outcome:"1X"). Covers two of the three HT outcomes.
  | { matchId: string; kind: "firstHalfDoubleChance"; outcome: "1X" | "12" | "X2" }
  // Result + Total: a 1X2 outcome AND the match total is under `line`
  // ("Team 2 To Win And Total < (2.5)" → outcome:"2", line:2.5).
  | { matchId: string; kind: "resultAndTotalUnder"; outcome: "1" | "X" | "2"; line: number }
  // Individual Total — one side's own goals under `line` ("Individual Total 2
  // Under (3.5)" → side:"away", line:3.5).
  | { matchId: string; kind: "individualTotalUnder"; side: "home" | "away"; line: number }
  // Individual Total — one side's own goals OVER `line` ("Individual Total 1
  // Over (2)" → side:"home", line:2 → won at 3+; a whole-line exact tally is a
  // push → voids and passes through the fixed-odds acca). Mirror of the Under.
  | { matchId: string; kind: "individualTotalOver"; side: "home" | "away"; line: number }
  // Total goals scored on or before minute `minute`, over `line` ("Total Over
  // 0.5 In 15 Minute" → minute:15, line:0.5 → won the moment any goal lands by
  // min 15). Counts EVERY goal in the window (own goals included — it's a match
  // total), regulation only since the window is < 90. Clinches mid-match; holds
  // pending until finished, then loses if the window stayed empty.
  | { matchId: string; kind: "totalOverByMinute"; minute: number; line: number }
  // Side wins AT LEAST ONE half ("Team 1/2 To Win At Least One Half — Yes").
  // A half is won when that side outscores the opponent in it: H1 off the HT
  // score, H2 off FT−HT. Wins iff the side takes H1 OR H2. Needs ht + ft.
  | { matchId: string; kind: "winsAtLeastOneHalf"; side: "home" | "away" }
  // Brace — ANY single player scores 2+ (non-own) goals in that match ("A Player
  // To Score Two Goals — Yes"). Graded off the leg match's own goal list at FT.
  | { matchId: string; kind: "brace" }
  // Half-time/full-time double result ("HT-FT W2X" etc.), oriented to the leg
  // match's home/away. ht + ft are each a 1X2 outcome that must both match.
  | { matchId: string; kind: "htft"; ht: "1" | "X" | "2"; ft: "1" | "X" | "2" }
  // Player's goals + assists combined strictly over `line` ("Total Goals +
  // Assists Combined Over 1.5" → line:1.5 → won at 2+). Can clinch mid-match the
  // moment the tally clears the line (graded like `scored`), loses only at FT.
  | { matchId: string; kind: "goalsAssistsOver"; player: string; line: number }
  // Player to score OR provide an assist ("To Score Or To Provide An Assist —
  // Yes"). Won the moment he's involved in a goal; loses at FT if never.
  | { matchId: string; kind: "scoredOrAssisted"; player: string }
  // Player to provide an ASSIST ("<Player> to provide an assist — Yes"). Graded
  // off the summary keyEvents assister (g.assist), accent-safe. Clinches the
  // moment he records an assist; loses at FT if never. `negate:true` is the
  // "- No" pick (WINS iff he never assists, dies the instant he does).
  | { matchId: string; kind: "assisted"; player: string; negate?: boolean }
  // Result + Total: a 1X2 outcome AND the match total is over `line` ("Team 2 To
  // Win And Total > (3.5)" → outcome:"2", line:3.5). Over-mirror of
  // resultAndTotalUnder.
  | { matchId: string; kind: "resultAndTotalOver"; outcome: "1" | "X" | "2"; line: number }
  // Double Chance + Total OVER: a DC outcome ("1X"/"12"/"X2") AND the match total
  // is over `line` ("1X And TO(1.5)" → outcome:"1X", line:1.5). DC-mirror of
  // resultAndTotalOver — the result part covers two outcomes, not one.
  | { matchId: string; kind: "doubleChanceAndTotalOver"; outcome: "1X" | "12" | "X2"; line: number }
  // Double Chance + Total UNDER ("2X And TU(3.5)" → outcome:"X2", line:3.5).
  // DC-mirror of resultAndTotalUnder.
  | { matchId: string; kind: "doubleChanceAndTotalUnder"; outcome: "1X" | "12" | "X2"; line: number }
  // Any team to win by a margin of `line` or more ("Win With Difference Of (3)
  // Or More Goals — Yes" → line:3). Decided off the absolute FT goal difference.
  | { matchId: string; kind: "winByMargin"; line: number }
  // The named side takes the match's FIRST penalty kick ("Team to be awarded /
  // take the first penalty"), settled off MatchStats.firstPenalty. `side` is
  // that match's home/away. Clinches the moment the first pen is taken; if the
  // match ends with NO penalty the market voids — in a fixed-odds acca a void
  // leg passes through (the stored combined odds already don't reprice).
  | { matchId: string; kind: "firstPenalty"; side: "home" | "away" }
  // Named player scores strictly over `line` GOALS only (not assists) — "To
  // Score Two Goals (Brace) — Yes" → line:1.5 → won at 2+. Clinches mid-match
  // the moment his goal tally clears the line (graded like `scored`), loses at FT.
  | { matchId: string; kind: "goalsOver"; player: string; line: number }
  // Named player's TOTAL shots (on + off target + blocked + woodwork + goals)
  // strictly over `line` ("Bruno Fernandes Over 0.5 — Player Over Shots" →
  // line:0.5 → won at 1+). Graded off MatchStats.playerShots (with the goal
  // list as a backstop — a goal is always a shot). Clinches mid-match; if the
  // per-shooter tally never lands, holds pending rather than blind-grading.
  | { matchId: string; kind: "playerShotsOver"; player: string; line: number }
  // Named player's TACKLES strictly over `line` ("Achraf Hakimi Over 1.5 —
  // Player Over Tackles" → line:1.5 → won at 2+). Graded off
  // MatchStats.playerTackles — ESPN's core API per-athlete defensive stats
  // (Opta totalTackles), fetched per targeted player since the summary carries
  // no per-player tackle data. Tackles only accrue → clinches mid-match once
  // the count clears the line; dies when the player subs off still under it
  // (tally frozen, no re-entry); a missing entry (core fetch never landed)
  // holds pending rather than blind-grading.
  | { matchId: string; kind: "playerTacklesOver"; player: string; line: number }
  // Named player's shots ON TARGET strictly over `line` ("Mikel Oyarzabal Over
  // 1.5 — Player Over Shots on Target" → line:1.5 → won at 2+). Graded off
  // MatchStats.playerSot, tallied per-shooter from ESPN "Shot On Target"
  // commentary plays (with the goal list as a backstop — a real goal is always
  // on target). Clinches mid-match; if the per-shooter tally never lands,
  // holds pending rather than blind-grading.
  | { matchId: string; kind: "playerSotOver"; player: string; line: number }
  // Which side scores the match's FIRST goal, as a three-way 1X2 ("First To
  // Score 1X2 — Spain" → outcome:"2"; "X" = no goals). Own goals count for the
  // side CREDITED on the scoreboard (Goal.team is the benefiting team); ET
  // goals excluded (90-minute market). A team pick decides the instant the
  // first goal lands; the "X" pick can only win at a goalless FT.
  | { matchId: string; kind: "firstToScore"; outcome: "1" | "X" | "2" }
  // Total FIRST-HALF goals (any team, own goals included) over `line` ("Over
  // 0.5 — 1st Half Total Goals" → line:0.5). Graded off the HT score, so it
  // DECIDES at the half-time whistle either way; a goal inside the first 45
  // clinches it even before the HT snapshot lands.
  | { matchId: string; kind: "firstHalfTotalOver"; line: number }
  // Total FIRST-HALF goals UNDER `line` ("Under 2.5 — 1st Half Total Goals" →
  // line:2.5) — mirror of firstHalfTotalOver. The HT score decides it at the
  // half-time whistle; goals piling past the line inside the first 45 kill it
  // even before the HT snapshot lands. A finished match with no HT snapshot
  // holds pending (never blind-grades a win off goal minutes alone).
  | { matchId: string; kind: "firstHalfTotalUnder"; line: number }
  // Which half produces MORE goals ("Half With Most Goals — 2nd Half" →
  // half:"2"). Three-way market: the picked half must strictly outscore the
  // other — a tie loses. H1 off the HT score, H2 off FT − HT, both authoritative
  // snapshots; a "2nd half" pick clinches mid-H2 the moment H2 goals exceed the
  // fixed H1 count (goals only accrue), a "1st half" pick dies the same way.
  | { matchId: string; kind: "halfWithMostGoals"; half: "1" | "2" }
  // The named side scores in BOTH halves ("Team To Score In Both Halves"):
  // H1 off the HT score, H2 off FT − HT. `negate:true` is the "- No" pick.
  // An H1 blank decides it at the half-time whistle (kills the Yes / clinches
  // the No); otherwise it needs the 90-minute final score.
  | { matchId: string; kind: "teamScoresBothHalves"; side: "home" | "away"; negate?: boolean }
  // Double Chance + Both Teams To Score — a DC outcome ("1X"/"12"/"X2") AND both
  // teams score ("1X And Both Teams To Score — Yes" → outcome:"1X"). Decides at
  // FT (the result swings until then); negate flips it ("- No").
  | { matchId: string; kind: "doubleChanceBtts"; outcome: "1X" | "12" | "X2"; negate?: boolean }
  // At Least One Team Not To Score + Total Over — NOT both-teams-score (one side
  // blanks) AND the match total is over `line` ("At Least One Team Will Not Score
  // + Total Over (2.5) — Yes" → line:2.5). Decided off the FT score.
  | { matchId: string; kind: "notBttsAndTotalOver"; line: number }
  // Asian/European handicap applied to `side` — that side's FT goals get `line`
  // added, then compared to the opponent ("Handicap 1 (-2)" → side:"home",
  // line:-2 → home must win by 3+; an exact 2-goal home win is a PUSH → VOIDs).
  // 90-minute score; a void leg passes through a fixed-odds acca (won't reprice).
  | { matchId: string; kind: "handicap"; side: "home" | "away"; line: number }
  // Total fouls committed by BOTH sides UNDER the line, from MatchStats.fouls
  // (boxscore foulsCommitted). Fouls only accrue, so it dies mid-match the
  // moment the running total goes over; wins only at FT. A finished match with
  // no fouls snapshot holds pending for a human (older snapshots lack it).
  | { matchId: string; kind: "totalFoulsUnder"; line: number }
  // Total shots by BOTH sides UNDER the line ("Under 24.5 — Total Match Shots"),
  // from MatchStats.shots (boxscore totalShots). Shots only accrue, so it dies
  // mid-match the moment the running total goes over; wins only at FT. A
  // finished match with no stats snapshot holds pending for a human.
  | { matchId: string; kind: "totalShotsUnder"; line: number }
  // Total shots by BOTH sides OVER the line ("Over 22.5 — Total Match Shots"),
  // from MatchStats.shots (boxscore totalShots). Mirror of totalShotsUnder:
  // shots only accrue, so this CLINCHES mid-match the moment the running total
  // clears the line; at FT a total still at/under the line is lost. A finished
  // match with no stats snapshot holds pending for a human.
  | { matchId: string; kind: "totalShotsOver"; line: number }
  // Corners (both sides) in ONE half OVER the line, from MatchStats.cornersByHalf
  // (tallied per-period from ESPN commentary). Accrues → clinches mid-match the
  // moment the half's total clears the line; the H1 line locks dead at the HT
  // whistle (H1 split is final once `ht` is in), the H2 line only at FT.
  | { matchId: string; kind: "halfCornersOver"; half: 1 | 2; line: number }
  // Corner-count 1X2 at FT ("Corners FT 1X2 — Spain" → side:"away"): the picked
  // side must take strictly MORE corners than the opponent — a tie loses (the
  // tie is the market's "X"). Regulation-90 market (book rule), so it settles
  // off the per-half commentary tally (ET plays never land in those buckets);
  // falls back to boxscore corners only when the match ended in 90. Corners
  // accrue for BOTH sides, so the lead can flip any minute — nothing clinches
  // or dies before the FT whistle.
  | { matchId: string; kind: "mostCorners"; side: "home" | "away" }
  // Full-match corners (both sides) total over/under `line`, from MatchStats.corners
  // (the running commentary tally). Over accrues → clinches mid-match the moment the
  // running total clears the line, dead at FT if it stayed short. Under dies the
  // instant the running total goes over, wins only at FT with the total short. No
  // stats snapshot → pending for a human. Book corner lines are half lines (10.5),
  // so no whole-line push arises.
  | { matchId: string; kind: "cornersTotalOver"; line: number }
  | { matchId: string; kind: "cornersTotalUnder"; line: number }
  // ONE side's own corner count strictly over `line` ("Morocco: Total Team
  // Corners Over (3.5)" → side:"away", line:3.5), from that side's
  // MatchStats.corners tally. Corners accrue → clinches mid-match the moment
  // the side's count clears the line; at FT still short it's dead; no stats
  // snapshot → pending for a human.
  | { matchId: string; kind: "teamCornersOver"; side: "home" | "away"; line: number }
  // Named GOALKEEPER's saves strictly over `line` ("Yassine Bounou Over 1.5 —
  // Goalkeeper Over Saves" → line:1.5 → won at 2+). ESPN has no per-player save
  // tally, but a team's saves ARE its keeper's saves, so it settles off
  // MatchStats.tempo.saves for the keeper's `side`. `player` is display/audit.
  // Saves only accrue → clinches mid-match the moment the count clears the
  // line; at FT still short it's dead; no tempo snapshot (pre-2026-07-06 shape)
  // → holds pending for a human rather than blind-grading.
  | { matchId: string; kind: "gkSavesOver"; player: string; side: "home" | "away"; line: number }
  // "Each team to have N+ goalkeeper saves in EACH half" (1xBet Enhanced Daily
  // Special — one leg per match in the acca; `line` is the AT-LEAST threshold,
  // e.g. 2 for "2+"). A keeper's saves in a half = the OPPONENT's on-target-
  // but-not-goal shots that half — precisely what sotByHalf buckets, since a
  // scored shot logs as its own "Goal" event and never lands in the SOT tally.
  // So "both keepers clear the line in both halves" ⟺ sotByHalf for BOTH sides
  // ≥ line in each half. Saves only accrue → clinches the moment both halves are
  // cleared; the H1 requirement locks dead at the HT whistle (H1 split final once
  // `ht` is in); at FT a half short of the line is a loss; no by-half snapshot →
  // pending for a human. (Off-the-line clearances count as SOT but aren't keeper
  // saves — a rare ±1 at the boundary; the slip is flagged for an eyeball.)
  | { matchId: string; kind: "eachTeamKeeperSavesEachHalfAtLeast"; line: number }
  // Total cards BOTH sides (yellow + red, same MatchStats.cards count the combo
  // cardsTotalOver StatCond settles on) strictly over `line` ("Over 3.5 — Cards
  // FT O/U"). Cards only accrue → clinches mid-match once the running total
  // clears the line; at FT still short it's dead; no stats snapshot → pending.
  | { matchId: string; kind: "cardsTotalOver"; line: number }
  // ONE side's own cards (yellow + red) strictly over `line` ("Morocco: Team
  // Total Cards Over (1.5)" → side:"away", line:1.5), from that side's
  // MatchStats.cards count. Same accrue clinch/dead logic as cardsTotalOver,
  // side-scoped.
  | { matchId: string; kind: "teamCardsOver"; side: "home" | "away"; line: number }
  // Truly unverifiable from ESPN (e.g. "penalty FOR A FOUL ON <player>" — the
  // pen + scorer are in the feed but not who was fouled). Never blind-grades —
  // holds the acca pending for a human to settle by hand.
  | { matchId: string; kind: "manual" }
);

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
  /** Optional co-punter badge for a shared slip (absent = owner's own bet). */
  punter?: string;
  /**
   * Set when a leg voided (whole-line push / refund) and the acca was repriced.
   * `odds`/`stake`→`potential` already reflect the NEW price; this carries the
   * BEFORE figures so the card can show previous → current on every device.
   */
  reprice?: {
    prevOdds: number;
    prevReturn: number;
    voidLegs: number;
    note: string;
  };
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

// Thasyan's slip — own meta/specials, reads the shared truth above.
export const thasyanSlip = thasyanJson as BetSlipFile;

// Sivesh's slip — own meta/specials, reads the shared truth above.
export const siveshSlip = siveshJson as BetSlipFile;

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

/**
 * The 90-MINUTE full-time score every standard FT market settles on. Falls back to
 * `ft` (= ft90 for group/regulation games, where no ET was played). A knockout
 * decided in ET/pens has ft (incl. ET) ≠ ft90, and the bookmaker grades 1X2 /
 * correct score / BTTS / totals / HT-FT on the 90-minute line — this returns it.
 */
export function ft90(matchId: string): Score {
  const r = getResult(matchId);
  return r.ft90 ?? r.ft;
}

/** Settle one correct-score bet against the relevant period's score. */
export function settleBet(bet: Bet): BetStatus {
  const result = getResult(bet.matchId);
  // Full-time correct score is a 90-minute market (ET goals excluded).
  const score = bet.period === "HT" ? result.ht : (result.ft90 ?? result.ft);
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
  /** Asian half-result / push repricing multiplier on the combined odds
   *  (1 = every leg settled whole; < 1 = payout reduced — see PayoutAdj). */
  payoutFactor: number;
};

/** Strip diacritics so ESPN's "Luis Díaz" / "Daniel Muñoz" match plain-ASCII picks. */
const deburr = (s: string): string =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

/** Loose name match — "Ronaldo" matches "Cristiano Ronaldo", case- and accent-insensitive, either direction. */
export function nameMatch(a: string, b: string): boolean {
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

/** Sum a player's TOTAL shots from the per-shooter map, matching names accent-safe. */
export const playerShotsCount = (stats: MatchStats | null, player: string): number => {
  const map = stats?.playerShots;
  if (!map) return 0;
  return Object.entries(map).reduce(
    (n, [name, count]) => (nameMatch(name, player) ? n + count : n),
    0,
  );
};

/**
 * A player's verified TACKLE count from the core-API map, or null when his
 * entry hasn't landed (fetch failed / not yet run). Null ≠ 0: a present key is
 * a verified count, an absent one means "no data — hold pending". Matching is
 * accent-safe (nameMatch), same as the shots/SOT lookups.
 */
export const playerTacklesCount = (stats: MatchStats | null, player: string): number | null => {
  const map = stats?.playerTackles;
  if (!map) return null;
  const hits = Object.entries(map).filter(([name]) => nameMatch(name, player));
  if (hits.length === 0) return null;
  return hits.reduce((n, [, count]) => n + count, 0);
};

/** Was `player` substituted OFF (per the subs log)? Football has no re-entry,
 *  so a subbed-off player's shot line is FROZEN — an under-the-line shots/SOT
 *  prop can never recover and locks dead the moment he walks. */
export const subbedOff = (stats: MatchStats | null, player: string): boolean =>
  (stats?.subs ?? []).some((s) => nameMatch(s.off, player));

// `realGoals` = the 90-minute scoring goals: no own goals, no extra-time goals.
// Every scorer/first-scorer/brace/total market reads through this, so they all
// settle on regulation only — matching the bookmaker rule that those markets are
// 90 minutes. (Shootout kicks are already dropped at scrape time.)
const realGoals = (goals: Goal[]) => goals.filter((g) => !g.ownGoal && !g.et);
const goalsBy = (goals: Goal[], player: string) =>
  realGoals(goals).filter((g) => nameMatch(g.scorer, player));
const assistsBy = (goals: Goal[], player: string) =>
  goals.filter((g) => g.assist && !g.et && nameMatch(g.assist, player));
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

/**
 * Whole-line Asian total push. A WHOLE (integer) Over/Under line that the
 * integer goal total lands exactly on — Under 4 / Over 4 in a 4-goal game —
 * voids: the stake is returned, exactly as a bookmaker (1xBet etc.) settles a
 * whole-line Asian total. A void leg neither wins nor loses, so it passes
 * through a fixed-odds acca unchanged.
 *
 * Half lines (3.5) and quarter lines (4.25) can NEVER be hit exactly by an
 * integer total, so this only ever fires on whole lines — which is precisely
 * the edge that used to read "Lost" where a book would refund. Returns true
 * when the leg should PUSH. Mirrors the same logic already used by
 * `individualTotalOver` and `handicap`.
 */
export const wholeLinePush = (total: number, line: number): boolean =>
  Number.isInteger(line) && total === line;
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
/**
 * Payout-adjustment accumulator threaded through multiLeg grading. Asian
 * quarter lines settle as TWO half-bets, so a leg can HALF-win / HALF-lose /
 * push without killing the acca — but then it must not pay full leg odds
 * either. Each such leg (with a known per-leg price) multiplies `factor` by
 * adjustedLegOdds / originalLegOdds:
 *   push       → 1 / odds            (leg voids, its odds drop out)
 *   half-loss  → 0.5 / odds          (half stake lost, half voided)
 *   half-win   → ((odds+1)/2) / odds (half at full odds, half voided)
 * Effective payout = stake × slip.odds × factor — scaling the stored combined
 * odds keeps any acca bonus baked into them proportional, which matches how
 * 1xBet settled slip 83906844771 (RM100.81, not the full RM1,206.98).
 * Legs without a stored per-leg price can't be repriced — they pass through at
 * full odds (pre-existing behaviour) and `unpriced` counts them for a human eye.
 */
export type PayoutAdj = { factor: number; unpriced: number };

/** Fold one push / half-result leg into the adjustment (no-op without a leg price). */
function adjustLeg(
  adj: PayoutAdj | undefined,
  odds: number | undefined,
  kind: "push" | "halfLoss" | "halfWin",
): void {
  if (!adj) return;
  if (!odds || odds <= 1) {
    adj.unpriced += 1;
    return;
  }
  adj.factor *= kind === "push" ? 1 / odds : kind === "halfLoss" ? 0.5 / odds : (odds + 1) / 2 / odds;
}

export function gradeSpecial(special: Special, adj?: PayoutAdj): BetStatus {
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

      if (leg.kind === "eitherScored") {
        // Either named player scores anytime — book settles on player stats
        // INCLUDING extra time, so ET goals count (own goals never). Clinches
        // mid-match on either's first goal; dead only at the true final
        // whistle with both blank.
        const scoredIt = ev.goals.some(
          (gl) => !gl.ownGoal && leg.players.some((p) => nameMatch(gl.scorer, p)),
        );
        if (scoredIt) continue; // leg won, even mid-match
        if (finished) return "lost"; // tie fully over (incl. ET), both blank → acca dead
        pending = true;
        continue;
      }

      if (leg.kind === "goalsAssistsOver") {
        // Goals + assists combined over the line — can clinch mid-match like
        // `scored`; dies only when the match ends short of the line.
        const tally =
          goalsBy(ev.goals, leg.player).length + assistsBy(ev.goals, leg.player).length;
        if (tally > leg.line) continue; // leg won, even mid-match
        if (finished) return "lost"; // match over, never cleared → acca dead
        pending = true;
        continue;
      }

      if (leg.kind === "scoredOrAssisted") {
        // Involved in a goal (scored OR assisted) at least once.
        const involved =
          goalsBy(ev.goals, leg.player).length + assistsBy(ev.goals, leg.player).length;
        if (involved > 0) continue; // leg won
        if (finished) return "lost";
        pending = true;
        continue;
      }

      if (leg.kind === "assisted") {
        // Player records an assist — graded off the summary keyEvents assister
        // (g.assist), accent-safe via assistsBy. Clinches mid-match like `scored`.
        const assistedIt = assistsBy(ev.goals, leg.player).length > 0;
        if (leg.negate) {
          // "- No": he must NOT assist. Dies the instant he does; wins at FT blank.
          if (assistedIt) return "lost";
          if (finished) continue; // match over, never assisted → leg won
          pending = true;
          continue;
        }
        if (assistedIt) continue; // leg won, even mid-match
        if (finished) return "lost"; // his match ended, no assist → whole acca dead
        pending = true;
        continue;
      }

      if (leg.kind === "goalsOver") {
        // Named player's GOALS only (no assists) over the line — clinches
        // mid-match like `scored`; dies only when the match ends short.
        if (goalsBy(ev.goals, leg.player).length > leg.line) continue; // leg won
        if (finished) return "lost";
        pending = true;
        continue;
      }

      if (leg.kind === "totalOverByMinute") {
        // Goals (any team, own goals included) on or before `minute`, over `line`.
        // Clinches the instant the window fills; otherwise pending until finished,
        // then lost if it stayed empty.
        const inWindow = ev.goals.filter(
          (gl) => !gl.et && gl.minute != null && gl.minute <= leg.minute,
        ).length;
        if (inWindow > leg.line) continue; // leg won
        if (finished) return "lost";
        pending = true;
        continue;
      }

      if (leg.kind === "firstPenalty") {
        // Which side took the match's first penalty (scored/missed/saved), from
        // MatchStats.firstPenalty. Clinches mid-match the moment a pen is taken.
        const fp = getStats(leg.matchId)?.firstPenalty ?? null;
        if (fp === leg.side) continue; // our side took the first pen → leg won
        if (fp) return "lost"; // the other side took it first → acca dead
        // No penalty taken yet. At FT with still none, the market voids; a void
        // leg in a fixed-odds acca neither wins nor loses, so pass it through.
        if (finished) continue;
        pending = true;
        continue;
      }

      if (leg.kind === "playerShotsOver") {
        // Player's TOTAL shots over the line, from the per-shooter tally. A goal
        // is always a shot, so the goal list backstops a missing/behind tally.
        // Clinches mid-match; at FT with no tally at all, holds pending for a
        // human rather than blind-losing on unseen data.
        const st = getStats(leg.matchId);
        const shots = Math.max(
          playerShotsCount(st, leg.player),
          goalsBy(ev.goals, leg.player).length,
        );
        if (shots > leg.line) continue; // leg won, even mid-match
        // Subbed off still under the line → his tally is frozen, acca dead —
        // but only trust it when the shot map was actually snapshotted.
        if (st?.playerShots && subbedOff(st, leg.player)) return "lost";
        if (finished) {
          if (!st?.playerShots) {
            pending = true; // stats never snapshotted → manual settle
            continue;
          }
          return "lost";
        }
        pending = true;
        continue;
      }

      if (leg.kind === "playerSotOver") {
        // Player's shots ON TARGET over the line, from the per-shooter SOT
        // tally. A real goal is always on target, so the goal list backstops
        // a missing/behind tally. Clinches mid-match; at FT with no tally at
        // all, holds pending for a human rather than blind-losing on unseen
        // data (mirror of playerShotsOver).
        const st = getStats(leg.matchId);
        const sot = Math.max(
          playerSotCount(st, leg.player),
          goalsBy(ev.goals, leg.player).length,
        );
        if (sot > leg.line) continue; // leg won, even mid-match
        // Subbed off still under the line → his tally is frozen, acca dead —
        // but only trust it when the SOT map was actually snapshotted.
        if (st?.playerSot && subbedOff(st, leg.player)) return "lost";
        if (finished) {
          if (!st?.playerSot) {
            pending = true; // stats never snapshotted → manual settle
            continue;
          }
          return "lost";
        }
        pending = true;
        continue;
      }

      if (leg.kind === "playerTacklesOver") {
        // Player's TACKLES over the line, from the core-API per-athlete map.
        // A present entry is a verified count (0 included); an absent one means
        // the core fetch never landed → hold pending, never blind-lose.
        const st = getStats(leg.matchId);
        const tackles = playerTacklesCount(st, leg.player);
        if (tackles != null && tackles > leg.line) continue; // leg won, even mid-match
        // Subbed off still under the line → his tally is frozen, acca dead —
        // but only trust it when his tackle count was actually verified.
        if (tackles != null && subbedOff(st, leg.player)) return "lost";
        if (finished) {
          if (tackles == null) {
            pending = true; // count never landed → manual settle
            continue;
          }
          return "lost";
        }
        pending = true;
        continue;
      }

      if (leg.kind === "totalFoulsUnder") {
        // Combined fouls UNDER the line. Fouls only accrue, so a running total
        // already over the line kills the acca mid-match; the win only settles
        // at FT. A finished match with no fouls snapshot holds pending for a
        // human (stats written before the field existed never captured it).
        const f = getStats(leg.matchId)?.fouls;
        const total = f ? f.home + f.away : null;
        if (total != null && total > leg.line) return "lost";
        if (finished) {
          if (total == null) {
            pending = true; // stats never snapshotted → manual settle
            continue;
          }
          continue; // under at the whistle → leg won
        }
        pending = true;
        continue;
      }

      if (leg.kind === "totalShotsUnder") {
        // Combined shots UNDER the line — mirror of totalFoulsUnder. Shots only
        // accrue, so a running total already over the line kills the acca
        // mid-match; the win only settles at FT. A finished match with no stats
        // snapshot holds pending for a human.
        const s = getStats(leg.matchId)?.shots;
        const total = s ? s.home + s.away : null;
        if (total != null && total > leg.line) return "lost";
        if (finished) {
          if (total == null) {
            pending = true; // stats never snapshotted → manual settle
            continue;
          }
          continue; // under at the whistle → leg won
        }
        pending = true;
        continue;
      }

      if (leg.kind === "totalShotsOver") {
        // Combined shots OVER the line — mirror of totalShotsUnder. Shots only
        // accrue, so the running total clearing the line clinches the leg
        // mid-match; at FT a total still at/under the line is lost. A finished
        // match with no stats snapshot holds pending for a human.
        const s = getStats(leg.matchId)?.shots;
        const total = s ? s.home + s.away : null;
        if (total != null && total > leg.line) continue; // cleared → leg won
        if (finished) {
          if (total == null) {
            pending = true; // stats never snapshotted → manual settle
            continue;
          }
          return "lost"; // FT total at/under the line → leg lost
        }
        pending = true;
        continue;
      }

      if (leg.kind === "halfCornersOver") {
        // Corners in ONE half over the line, from the per-half commentary tally.
        // Accrues → clinches mid-match once the half's total clears the line.
        // The H1 line locks dead at the HT whistle (H1 split is final once `ht`
        // is in — same lock comboDead applies to per-half combo legs); the H2
        // line dies only at FT. No by-half snapshot at FT → pending for a human.
        const ch = getStats(leg.matchId)?.cornersByHalf;
        const idx = leg.half === 1 ? 0 : 1;
        const tot = ch ? ch.home[idx] + ch.away[idx] : null;
        if (tot != null && tot > leg.line) continue; // cleared the line → leg won
        if (finished) {
          if (tot == null) {
            pending = true; // stats never snapshotted → manual settle
            continue;
          }
          return "lost";
        }
        // H1 portion is fixed the instant the half ends — short then is dead.
        if (leg.half === 1 && tot != null && getResult(leg.matchId).ht) return "lost";
        pending = true;
        continue;
      }

      if (leg.kind === "eachTeamKeeperSavesEachHalfAtLeast") {
        // "Each team 2+ GK saves in each half" for THIS match. A keeper's saves
        // in a half = the opponent's on-target-non-goal shots that half, which is
        // exactly sotByHalf (goals log separately, never in this bucket). So the
        // leg wins iff BOTH sides' sotByHalf ≥ line in BOTH halves. Saves accrue,
        // so it clinches once both halves are cleared; H1 locks at the HT whistle.
        const s = getStats(leg.matchId)?.sotByHalf;
        const ht = getResult(leg.matchId).ht;
        const okH1 = s ? s.home[0] >= leg.line && s.away[0] >= leg.line : null;
        const okH2 = s ? s.home[1] >= leg.line && s.away[1] >= leg.line : null;
        // H1 portion is fixed the instant the half ends — a keeper short then is dead.
        if (ht && okH1 === false) return "lost";
        if (okH1 && okH2) continue; // both keepers cleared both halves → leg won
        if (finished) {
          if (s == null) {
            pending = true; // stats never snapshotted → manual settle
            continue;
          }
          return "lost"; // FT and a half fell short of the line → acca dead
        }
        pending = true;
        continue;
      }

      if (leg.kind === "mostCorners") {
        // Corner-count 1X2 at FT — strictly more corners than the opponent
        // (a tie loses). Regulation-90 market: the per-half tally is the
        // source (ET plays never land in it); boxscore corners only back it
        // up when the match ended in 90 (a post-ET boxscore includes ET
        // corners). Both sides accrue, so nothing decides before the whistle.
        if (!finished) {
          pending = true;
          continue;
        }
        const st = getStats(leg.matchId);
        const opp = leg.side === "home" ? "away" : "home";
        const ch = st?.cornersByHalf;
        let mine: number | null = null;
        let theirs: number | null = null;
        if (ch) {
          mine = ch[leg.side][0] + ch[leg.side][1];
          theirs = ch[opp][0] + ch[opp][1];
        } else if (st && getResult(leg.matchId).finishPhase === "regulation") {
          mine = st.corners[leg.side];
          theirs = st.corners[opp];
        }
        if (mine == null || theirs == null) {
          pending = true; // stats never snapshotted → manual settle
          continue;
        }
        if (mine > theirs) continue; // strictly more at the whistle → leg won
        return "lost";
      }

      if (leg.kind === "cornersTotalOver") {
        // Full-match corner total over `line`, from the running MatchStats tally.
        // Corners accrue → clinches the moment the total clears the line; at FT a
        // total still short is dead; no snapshot → pending for a human.
        const cs = getStats(leg.matchId)?.corners;
        const tot = cs ? cs.home + cs.away : null;
        if (tot != null && tot > leg.line) continue; // cleared → won, even mid-match
        if (finished) {
          if (tot == null) {
            pending = true; // stats never snapshotted → manual settle
            continue;
          }
          return "lost";
        }
        pending = true;
        continue;
      }

      if (leg.kind === "cornersTotalUnder") {
        // Full-match corner total under `line`. Corners only accrue, so it dies
        // the instant the running total goes over; wins only at FT with the total
        // short; no snapshot at FT → pending for a human.
        const cs = getStats(leg.matchId)?.corners;
        const tot = cs ? cs.home + cs.away : null;
        if (tot != null && tot > leg.line) return "lost"; // busted → dead, even mid-match
        if (finished) {
          if (tot == null) {
            pending = true; // stats never snapshotted → manual settle
            continue;
          }
          continue; // total stayed under → won
        }
        pending = true;
        continue;
      }

      if (leg.kind === "teamCornersOver") {
        // One side's own corner count over `line` — corners accrue, so it
        // clinches the moment the side's tally clears the line; at FT still
        // short it's dead; no stats snapshot → pending for a human.
        const cs = getStats(leg.matchId)?.corners;
        const n = cs ? cs[leg.side] : null;
        if (n != null && n > leg.line) continue; // cleared → won, even mid-match
        if (finished) {
          if (n == null) {
            pending = true; // stats never snapshotted → manual settle
            continue;
          }
          return "lost";
        }
        pending = true;
        continue;
      }

      if (leg.kind === "gkSavesOver") {
        // Named keeper's saves over the line — settled off his side's team save
        // count (a team's saves are its keeper's saves). Saves only accrue, so
        // it clinches mid-match once the count clears the line; at FT still
        // short it's dead; no tempo snapshot → pending for a human.
        const sv = getStats(leg.matchId)?.tempo?.saves;
        const n = sv ? sv[leg.side] : null;
        if (n != null && n > leg.line) continue; // cleared → leg won, even mid-match
        if (finished) {
          if (n == null) {
            pending = true; // tempo never snapshotted → manual settle
            continue;
          }
          return "lost";
        }
        pending = true;
        continue;
      }

      if (leg.kind === "cardsTotalOver") {
        // Combined cards (yellow + red, both sides) over the line. Cards only
        // accrue → clinches the moment the total clears the line; at FT a total
        // still short is dead; no stats snapshot → pending for a human.
        const cd = getStats(leg.matchId)?.cards;
        const tot = cd ? cd.home + cd.away : null;
        if (tot != null && tot > leg.line) continue; // cleared → won, even mid-match
        if (finished) {
          if (tot == null) {
            pending = true; // stats never snapshotted → manual settle
            continue;
          }
          return "lost";
        }
        pending = true;
        continue;
      }

      if (leg.kind === "teamCardsOver") {
        // One side's own cards (yellow + red) over `line` — cards accrue, so it
        // clinches the moment the side's count clears the line; at FT still
        // short it's dead; no stats snapshot → pending for a human.
        const cd = getStats(leg.matchId)?.cards;
        const n = cd ? cd[leg.side] : null;
        if (n != null && n > leg.line) continue; // cleared → won, even mid-match
        if (finished) {
          if (n == null) {
            pending = true; // stats never snapshotted → manual settle
            continue;
          }
          return "lost";
        }
        pending = true;
        continue;
      }

      if (leg.kind === "firstToScore") {
        // Three-way first-to-score: the side credited with the match's first
        // 90-minute goal (own goals count for the benefiting side), "X" = no
        // goals. The first goal fixes it forever, so a team pick decides the
        // instant it lands; the "X" pick needs a goalless FT.
        const first = ev.goals.find((gl) => !gl.et);
        if (first) {
          if ((first.team === "home" ? "1" : "2") !== leg.outcome) return "lost";
          continue; // right side struck first → leg won, even mid-match
        }
        if (finished) {
          if (leg.outcome !== "X") return "lost"; // goalless FT → only "X" wins
          continue;
        }
        pending = true;
        continue;
      }

      if (leg.kind === "firstHalfTotalOver") {
        // First-half total over the line — the HT score decides it at the
        // half-time whistle either way; a goal inside the first 45 clinches
        // early, before the HT snapshot lands.
        const ht = getResult(leg.matchId).ht;
        if (ht) {
          const total = ht.home + ht.away;
          if (total > leg.line) continue; // over → won
          if (wholeLinePush(total, leg.line)) continue; // exact whole line → push
          return "lost"; // the half ended under → dead, even mid-match
        }
        const h1 = ev.goals.filter(
          (gl) => !gl.et && gl.minute != null && gl.minute <= 45,
        ).length;
        if (h1 > leg.line) continue; // clinched before the HT snapshot
        if (finished) return "lost";
        pending = true;
        continue;
      }

      if (leg.kind === "firstHalfTotalUnder") {
        // First-half total UNDER the line — the HT score decides it at the
        // half-time whistle; goals piling past the line inside the first 45
        // kill it before the snapshot. A finished match with no HT snapshot
        // holds pending (never blind-grades a win off goal minutes alone).
        const ht = getResult(leg.matchId).ht;
        if (ht) {
          const total = ht.home + ht.away;
          if (total < leg.line) continue; // under → won
          if (wholeLinePush(total, leg.line)) continue; // exact whole line → push
          return "lost"; // the half ended over → dead, even mid-match
        }
        const h1 = ev.goals.filter(
          (gl) => !gl.et && gl.minute != null && gl.minute <= 45,
        ).length;
        if (h1 > leg.line) return "lost"; // busted before the HT snapshot
        pending = true; // still in H1, or finished with no snapshot → manual
        continue;
      }

      if (leg.kind === "teamScoresBothHalves") {
        // Side scores in BOTH halves: H1 off the HT score, H2 off FT − HT.
        // negate = "- No". An H1 blank decides it the moment HT is in; a
        // finished match with no HT snapshot holds pending (never blind-grades).
        const r = getResult(leg.matchId);
        const fts = ft90(leg.matchId);
        let both: boolean | null = null;
        if (r.ht) {
          const h1 = (leg.side === "home" ? r.ht.home : r.ht.away) >= 1;
          if (!h1) both = false; // blank first half → "both" already impossible
          else if (finished && fts) {
            both =
              (leg.side === "home" ? fts.home - r.ht.home : fts.away - r.ht.away) >= 1;
          }
        }
        if (both == null) {
          pending = true;
          continue;
        }
        if (leg.negate ? both : !both) return "lost";
        continue;
      }

      if (leg.kind === "manual") {
        // Truly unverifiable from ESPN (e.g. "penalty for a foul on <player>") —
        // hold the whole acca pending so a human settles it; never blind-grade.
        pending = true;
        continue;
      }

      // Every remaining leg kind needs the FINAL score, so it can't decide
      // until the leg match is finished.
      if (!finished) {
        pending = true;
        continue;
      }
      const ft = ft90(leg.matchId); // 90-minute scoreline; ET goals excluded

      if (leg.kind === "scoredAndScoreOneOf") {
        const scoredIt = goalsBy(ev.goals, leg.player).length > 0;
        const onGrid = leg.scores.some((s) => isFinalScore(ft, s.home, s.away));
        if (!(scoredIt && onGrid)) return "lost";
        continue;
      }

      if (leg.kind === "result") {
        // 1X2: full-time outcome oriented to the leg match's home/away. This is a
        // 90-MINUTE win — a draw after 90 loses, regardless of any ET/pens result.
        if (!ft) return "lost";
        const outcome = ft.home > ft.away ? "1" : ft.home < ft.away ? "2" : "X";
        if (outcome !== leg.outcome) return "lost";
        continue;
      }

      if (leg.kind === "qualify") {
        // Knockout advancement — the side PROGRESSES by any route. Prefer the
        // recorded `advanced` (set once the tie, incl. ET/pens, is final). If a
        // knockout is final but advancement wasn't captured, fall back to the FT
        // score: a regulation winner is the side that went through; a level FT
        // means it went to ET/pens we can't yet read, so hold the acca pending.
        const adv = getResult(leg.matchId).advanced;
        if (adv) {
          if (adv !== leg.side) return "lost";
          continue;
        }
        if (!ft) return "lost";
        const winner = ft.home > ft.away ? "home" : ft.home < ft.away ? "away" : null;
        if (winner == null) {
          pending = true;
          continue;
        }
        if (winner !== leg.side) return "lost";
        continue;
      }

      if (leg.kind === "correctScore") {
        if (!isFinalScore(ft, leg.home, leg.away)) return "lost";
        continue;
      }

      if (leg.kind === "btts") {
        // Both teams scored in that match. negate = "BTTS - No".
        if (!ft) return "lost";
        const raw = ft.home >= 1 && ft.away >= 1;
        if (!(leg.negate ? !raw : raw)) return "lost";
        continue;
      }

      if (leg.kind === "cleanSheet") {
        // The named side conceded zero (the OTHER side scored 0). negate =
        // "Team Clean Sheet - No": the side DOES concede at least once.
        if (!ft) return "lost";
        const conceded = leg.side === "home" ? ft.away : ft.home;
        const raw = conceded === 0;
        if (leg.negate ? raw : !raw) return "lost";
        continue;
      }

      if (leg.kind === "halfWithMostGoals") {
        // Which half produced more goals — the picked half must strictly
        // outscore the other (a tie loses the three-way market). H1 off the
        // HT snapshot, H2 off FT − HT; a finished match with no HT snapshot
        // holds pending (never blind-grades off goal minutes alone).
        const ht = getResult(leg.matchId).ht;
        if (!ht || !ft) {
          pending = true;
          continue;
        }
        const h1 = ht.home + ht.away;
        const h2 = ft.home + ft.away - h1;
        if (!(leg.half === "2" ? h2 > h1 : h1 > h2)) return "lost";
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

      if (leg.kind === "doubleChanceBtts") {
        // DC outcome (one of the covered pair) AND both teams scored. negate
        // flips it ("- No": NOT(dc AND btts)).
        if (!ft) return "lost";
        const outcome = ft.home > ft.away ? "1" : ft.home < ft.away ? "2" : "X";
        const raw = leg.outcome.includes(outcome) && ft.home >= 1 && ft.away >= 1;
        if (!(leg.negate ? !raw : raw)) return "lost";
        continue;
      }

      if (leg.kind === "notBttsAndTotalOver") {
        // At least one team failed to score (NOT btts) AND total over `line`.
        // NOT-btts fails → lost; else over → won, whole-line exact total → combo
        // voids, under → lost.
        if (!ft) return "lost";
        const oneBlank = ft.home === 0 || ft.away === 0;
        if (!oneBlank) return "lost";
        const total = ft.home + ft.away;
        if (total > leg.line) continue; // both parts hit → won
        if (wholeLinePush(total, leg.line)) {
          adjustLeg(adj, leg.odds, "push"); // total pushes → combo voids, odds drop out
          continue;
        }
        return "lost"; // total under → lost
      }

      if (leg.kind === "bttsEachOver") {
        // Each team scores strictly more than `line` non-own goals.
        if (!ft) return "lost";
        const raw = ft.home > leg.line && ft.away > leg.line;
        if (!(leg.negate ? !raw : raw)) return "lost";
        continue;
      }

      if (leg.kind === "totalUnder") {
        // Total match goals under `line`. Asian quarter lines (x.25/x.75) are
        // TWO half-bets: a total landing 0.25 from the line half-wins or
        // half-loses instead of settling whole — either passes through the
        // acca (repriced), only a clear miss kills it. diff = line − total:
        //   ≥ 0.5 full win · +0.25 half-win (U3.25, 3 goals) · 0 push ·
        //   −0.25 half-loss (U3.75, 4 goals) · ≤ −0.5 lost.
        if (!ft) return "lost";
        const diff = leg.line - (ft.home + ft.away);
        if (diff >= 0.5) continue; // clear under → full win
        if (diff === 0.25) adjustLeg(adj, leg.odds, "halfWin");
        else if (diff === 0) adjustLeg(adj, leg.odds, "push"); // whole-line exact
        else if (diff === -0.25) adjustLeg(adj, leg.odds, "halfLoss");
        else return "lost"; // clear over
        continue;
      }

      if (leg.kind === "totalOver") {
        // Total match goals over `line` (mirror of totalUnder, same Asian
        // quarter-line halves). diff = total − line:
        //   ≥ 0.5 full win · +0.25 half-win (O1.75, 2 goals) · 0 push ·
        //   −0.25 half-loss (O1.25, 1 goal) · ≤ −0.5 lost.
        if (!ft) return "lost";
        const diff = ft.home + ft.away - leg.line;
        if (diff >= 0.5) continue; // clear over → full win
        if (diff === 0.25) adjustLeg(adj, leg.odds, "halfWin");
        else if (diff === 0) adjustLeg(adj, leg.odds, "push"); // whole-line exact
        else if (diff === -0.25) adjustLeg(adj, leg.odds, "halfLoss");
        else return "lost"; // clear under
        continue;
      }

      if (leg.kind === "doubleChance") {
        // FT outcome must be one of the two covered ("1X"/"12"/"X2").
        if (!ft) return "lost";
        const outcome = ft.home > ft.away ? "1" : ft.home < ft.away ? "2" : "X";
        if (!leg.outcome.includes(outcome)) return "lost";
        continue;
      }

      if (leg.kind === "resultFirstHalf") {
        // 1X2 off the HALF-TIME score, oriented to the leg match's home/away.
        const ht = getResult(leg.matchId).ht;
        if (!ht) return "lost";
        const outcome = ht.home > ht.away ? "1" : ht.home < ht.away ? "2" : "X";
        if (outcome !== leg.outcome) return "lost";
        continue;
      }

      if (leg.kind === "firstHalfDoubleChance") {
        // Double chance off the HALF-TIME score — the HT 1X2 outcome must be one
        // of the two covered ("1X"/"12"/"X2"), oriented to the leg match.
        const ht = getResult(leg.matchId).ht;
        if (!ht) return "lost";
        const outcome = ht.home > ht.away ? "1" : ht.home < ht.away ? "2" : "X";
        if (!leg.outcome.includes(outcome)) return "lost";
        continue;
      }

      if (leg.kind === "resultAndTotalUnder") {
        // 1X2 outcome AND total goals under `line`. Result part fails → lost. If
        // it holds, the total decides: under → won; whole-line exact total →
        // the total component pushes so the combined market voids; over → lost.
        if (!ft) return "lost";
        const outcome = ft.home > ft.away ? "1" : ft.home < ft.away ? "2" : "X";
        if (outcome !== leg.outcome) return "lost";
        const total = ft.home + ft.away;
        if (total < leg.line) continue; // both parts hit → won
        if (wholeLinePush(total, leg.line)) {
          adjustLeg(adj, leg.odds, "push"); // total pushes → combo voids, odds drop out
          continue;
        }
        return "lost"; // total over → lost
      }

      if (leg.kind === "individualTotalUnder") {
        // One side's own goals under `line` — same Asian quarter-line halves
        // as totalUnder, off that side's tally. Mirror of individualTotalOver.
        if (!ft) return "lost";
        const scored = leg.side === "home" ? ft.home : ft.away;
        const diff = leg.line - scored;
        if (diff >= 0.5) continue; // clear under → full win
        if (diff === 0.25) adjustLeg(adj, leg.odds, "halfWin");
        else if (diff === 0) adjustLeg(adj, leg.odds, "push"); // exact whole line
        else if (diff === -0.25) adjustLeg(adj, leg.odds, "halfLoss");
        else return "lost"; // clear over
        continue;
      }

      if (leg.kind === "individualTotalOver") {
        // One side's own goals over `line` — same Asian quarter-line halves
        // as totalOver, off that side's tally.
        if (!ft) return "lost";
        const scored = leg.side === "home" ? ft.home : ft.away;
        const diff = scored - leg.line;
        if (diff >= 0.5) continue; // clear over → full win
        if (diff === 0.25) adjustLeg(adj, leg.odds, "halfWin");
        else if (diff === 0) adjustLeg(adj, leg.odds, "push"); // exact whole line
        else if (diff === -0.25) adjustLeg(adj, leg.odds, "halfLoss");
        else return "lost"; // clear under
        continue;
      }

      if (leg.kind === "winsAtLeastOneHalf") {
        // Won iff the side outscores the opponent in H1 (HT) OR H2 (FT − HT).
        const ht = getResult(leg.matchId).ht;
        if (!ht || !ft) return "lost";
        const wonH1 = leg.side === "home" ? ht.home > ht.away : ht.away > ht.home;
        const sh = ft.home - ht.home;
        const sa = ft.away - ht.away;
        const wonH2 = leg.side === "home" ? sh > sa : sa > sh;
        if (!(wonH1 || wonH2)) return "lost";
        continue;
      }

      if (leg.kind === "brace") {
        // Any single player scored 2+ non-own goals in that match.
        const counts = new Map<string, number>();
        for (const gl of realGoals(ev.goals)) {
          const k = deburr(gl.scorer);
          counts.set(k, (counts.get(k) ?? 0) + 1);
        }
        if (![...counts.values()].some((n) => n >= 2)) return "lost";
        continue;
      }

      if (leg.kind === "htft") {
        // HT and FT 1X2 outcomes must both match, oriented to the leg's home/away.
        const ht = getResult(leg.matchId).ht;
        if (!ht || !ft) return "lost";
        const o = (s: Score) => (!s ? "" : s.home > s.away ? "1" : s.home < s.away ? "2" : "X");
        if (!(o(ht) === leg.ht && o(ft) === leg.ft)) return "lost";
        continue;
      }

      if (leg.kind === "resultAndTotalOver") {
        // 1X2 outcome AND total goals over `line` (over-mirror of
        // resultAndTotalUnder). Result fails → lost; else over → won, whole-line
        // exact total → combo voids, under → lost.
        if (!ft) return "lost";
        const outcome = ft.home > ft.away ? "1" : ft.home < ft.away ? "2" : "X";
        if (outcome !== leg.outcome) return "lost";
        const total = ft.home + ft.away;
        if (total > leg.line) continue; // both parts hit → won
        if (wholeLinePush(total, leg.line)) {
          adjustLeg(adj, leg.odds, "push"); // total pushes → combo voids, odds drop out
          continue;
        }
        return "lost"; // total under → lost
      }

      if (leg.kind === "doubleChanceAndTotalOver") {
        // Double chance (one of the covered pair) AND total over `line`. Result
        // part fails → lost; else over → won, whole-line exact total → combo
        // voids, under → lost. DC-mirror of resultAndTotalOver.
        if (!ft) return "lost";
        const outcome = ft.home > ft.away ? "1" : ft.home < ft.away ? "2" : "X";
        if (!leg.outcome.includes(outcome)) return "lost";
        const total = ft.home + ft.away;
        if (total > leg.line) continue; // both parts hit → won
        if (wholeLinePush(total, leg.line)) {
          adjustLeg(adj, leg.odds, "push"); // total pushes → combo voids, odds drop out
          continue;
        }
        return "lost"; // total under → lost
      }

      if (leg.kind === "doubleChanceAndTotalUnder") {
        // Double chance (one of the covered pair) AND total under `line`.
        // DC-mirror of resultAndTotalUnder.
        if (!ft) return "lost";
        const outcome = ft.home > ft.away ? "1" : ft.home < ft.away ? "2" : "X";
        if (!leg.outcome.includes(outcome)) return "lost";
        const total = ft.home + ft.away;
        if (total < leg.line) continue; // both parts hit → won
        if (wholeLinePush(total, leg.line)) {
          adjustLeg(adj, leg.odds, "push"); // total pushes → combo voids, odds drop out
          continue;
        }
        return "lost"; // total over → lost
      }

      if (leg.kind === "winByMargin") {
        // Either side wins by `line`+ goals — absolute FT goal difference.
        if (!ft) return "lost";
        if (Math.abs(ft.home - ft.away) < leg.line) return "lost";
        continue;
      }

      if (leg.kind === "handicap") {
        // Handicap on `side`: add `line` to that side's FT goals, compare to the
        // opponent. diff = mine + line − opp (90-minute score).
        //
        // Quarter lines (.25/.75) are TWO half-bets, so a near miss is a HALF
        // result, not a full one — the acca survives it:
        //   diff <= -0.5 → fully beaten → lost.
        //   -0.5 < diff < 0 → HALF-LOSS / 50% refund (e.g. +0.75 losing by 1:
        //     the +1.0 half pushes, the +0.5 half loses). Does NOT kill the acca
        //     — passes through, repriced via `adj` (settleSpecials applies it).
        //   diff === 0 → push → void, passes through repriced.
        //   diff >= 0.5 → fully covered at full leg odds; a +0.25 half-win
        //     passes through repriced to (odds+1)/2.
        if (!ft) return "lost";
        const mine = leg.side === "home" ? ft.home : ft.away;
        const opp = leg.side === "home" ? ft.away : ft.home;
        const diff = mine + leg.line - opp;
        if (diff <= -0.5) return "lost"; // fully failed to cover
        // Half-loss / push / half-win pass through the acca but reprice it —
        // full leg odds only apply when the cover clears by ≥ 0.5.
        if (diff < 0) adjustLeg(adj, leg.odds, "halfLoss"); // −0.25: +x.75 losing by 1
        else if (diff === 0) adjustLeg(adj, leg.odds, "push"); // whole-line exact
        else if (diff < 0.5) adjustLeg(adj, leg.odds, "halfWin"); // +0.25: −x.75 winning by 1
        continue;
      }

      // Unrecognised leg kind — never blind-win; hold the acca pending so a
      // human notices and settles it rather than silently grading it "won".
      pending = true;
    }
    return pending ? "pending" : "won";
  }

  const events = getEvents(special.matchId);
  const ft = ft90(special.matchId); // 90-minute scoreline; ET goals excluded

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
    case "scoredOutsideBox":
      // Player scores ≥1 (non-own) goal struck from outside the penalty area.
      // outsideBox is parsed from the summary keyEvents prose by the scraper.
      hit = goalsBy(goals, g.player).some((gl) => gl.outsideBox === true);
      break;
    case "goalsAssistsOver":
      // Player's goals + assists combined strictly over the line (2.5 → 3+).
      hit = goalsBy(goals, g.player).length + assistsBy(goals, g.player).length > g.line;
      break;
    case "manual":
      // Unverifiable bookmaker qualifier (e.g. foul-drawn-by) — never auto-graded;
      // always pending so a human settles it. ESPN carries no such datum.
      return "pending";
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
    const adj: PayoutAdj = { factor: 1, unpriced: 0 };
    const status = gradeSpecial(s, adj);
    // Effective combined odds after Asian half-results / pushes reprice their
    // legs (factor 1 when every leg settled whole). Scaling the stored slip
    // odds keeps any acca bonus baked into them proportional — matches the
    // book's actual payout (e.g. 83906844771: half-loss × half-win → RM100.81).
    // A slip carrying a manual `reprice` already folded its void into `odds` —
    // applying the factor again would double-count it, so the human reprice wins.
    const eff = s.reprice ? s.odds : s.odds * adj.factor;
    return {
      ...s,
      status,
      fixture: getFixture(s.matchId),
      payoutFactor: s.reprice ? 1 : adj.factor,
      potential: s.stake * eff,
      pnl: status === "won" ? s.stake * (eff - 1) : status === "lost" ? -s.stake : 0,
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
