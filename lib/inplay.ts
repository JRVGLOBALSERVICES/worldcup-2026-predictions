import type { Goal, Card, Score, SpecialGrade, BetStatus, MultiLegCond } from "./bets";
import { comboDead, evalCombo, playerSotCount, playerStarted, wholeLinePush } from "./bets";
import type { LiveMatch } from "./live";
import fixturesJson from "@/data/fixtures.json";
import type { Fixture } from "./types";

// matchId → fixture, so acca legs can read with real team names instead of
// uppercased id slugs ("Croatia v Ghana", not "CRO v GHA").
const FX_BY_ID = new Map((fixturesJson as Fixture[]).map((f) => [f.id, f]));
function legTeams(id: string): { home: string; away: string } {
  const fx = FX_BY_ID.get(id);
  if (fx) return { home: fx.home.name, away: fx.away.name };
  const [h, a] = id.split("-");
  return { home: (h ?? "").toUpperCase(), away: (a ?? "").toUpperCase() };
}

/**
 * Plain-English label for one acca leg — what the slip grid shows.
 * No bookmaker shorthand ("o2.5", "W1+BTTS", "U3"): every leg reads as a
 * sentence a human can scan. MUST NOT contain " · " (the grader joins legs on
 * that token, and the UI parser splits the note on it). The trailing status
 * glyph (✓/✗/⋯/—) is appended by the caller, separated by a single space.
 */
export function legLabelFor(leg: MultiLegCond): string {
  const { home: h, away: a } = legTeams(leg.matchId);
  const m = `${h} v ${a}`;
  const side = (s: "home" | "away") => (s === "home" ? h : a);
  // goals+assists "over X.5" → the whole-number threshold the punter needs.
  const plus = (line: number) => `${Math.floor(line) + 1}+`;
  switch (leg.kind) {
    case "result":
      return leg.outcome === "X"
        ? `${m} — draw (90 min)`
        : `${leg.outcome === "1" ? h : a} to win (90 min)`;
    case "qualify":
      return `${side(leg.side)} to qualify`;
    case "correctScore":
      return `${m} — exactly ${leg.home}-${leg.away}`;
    case "btts":
      return `${m} — both teams to score${leg.negate ? " (no)" : ""}`;
    case "cleanSheet":
      return `${side(leg.side)} to keep a clean sheet`;
    case "resultBtts": {
      const r = leg.outcome === "1" ? `${h} win` : leg.outcome === "2" ? `${a} win` : "draw";
      return `${m} — ${r} + both teams score${leg.negate ? " (no)" : ""}`;
    }
    case "bttsEachOver":
      return `${m} — each team ${leg.line + 1}+ goals${leg.negate ? " (no)" : ""}`;
    case "totalUnder":
      return `${m} — under ${leg.line} goals`;
    case "totalOver":
      return `${m} — over ${leg.line} goals`;
    case "doubleChance": {
      const dc =
        leg.outcome === "1X"
          ? `${h} win or draw`
          : leg.outcome === "X2"
            ? `${a} win or draw`
            : `${h} or ${a} to win`;
      return `${m} — ${dc}`;
    }
    case "resultFirstHalf":
      return leg.outcome === "X"
        ? `${m} — level at half-time`
        : `${leg.outcome === "1" ? h : a} to lead at half-time`;
    case "resultAndTotalUnder":
      return `${leg.outcome === "X" ? `${m} draw` : `${leg.outcome === "1" ? h : a} win`} + under ${leg.line} goals`;
    case "resultAndTotalOver":
      return `${leg.outcome === "X" ? `${m} draw` : `${leg.outcome === "1" ? h : a} win`} + over ${leg.line} goals`;
    case "individualTotalUnder":
      return `${side(leg.side)} to score under ${leg.line}`;
    case "individualTotalOver":
      return `${side(leg.side)} to score over ${leg.line}`;
    case "winsAtLeastOneHalf":
      return `${side(leg.side)} to win a half`;
    case "brace":
      return `${m} — a player to score twice`;
    case "htft": {
      const lab = (o: "1" | "X" | "2") => (o === "1" ? h : o === "2" ? a : "draw");
      return `${m} — ${lab(leg.ht)} at half-time then ${lab(leg.ft)} at full-time`;
    }
    case "winByMargin":
      return `${m} — win by ${leg.line}+ goals`;
    case "handicap":
      return `${side(leg.side)} ${leg.line >= 0 ? "+" : ""}${leg.line} handicap`;
    case "firstPenalty":
      return `${side(leg.side)} — first penalty of the match`;
    case "goalsAssistsOver":
      return `${leg.player} — ${plus(leg.line)} goals & assists`;
    case "goalsOver":
      return `${leg.player} — ${plus(leg.line)} goals`;
    case "scoredOrAssisted":
      return `${leg.player} to score or assist`;
    case "assisted":
      return leg.negate ? `${leg.player} not to assist` : `${leg.player} to provide an assist`;
    case "doubleChanceBtts": {
      const dc =
        leg.outcome === "1X"
          ? `${h} win or draw`
          : leg.outcome === "X2"
            ? `${a} win or draw`
            : `${h} or ${a} to win`;
      return `${m} — ${dc} + both teams score${leg.negate ? " (no)" : ""}`;
    }
    case "notBttsAndTotalOver":
      return `${m} — a team to blank + over ${leg.line} goals`;
    case "scored":
      return leg.negate ? `${leg.player} not to score` : `${leg.player} to score`;
    case "scoredAndScoreOneOf":
      return `${leg.player} to score`;
    case "manual":
      return `${m} — settled by hand`;
    default:
      return (leg as { player?: string }).player ?? `${h} v ${a}`;
  }
}

/** Minimal shapes the graders read — so both the full Bet/Special and the
 *  serialisable client rows satisfy them without casts. */
export type BetLike = { period: "HT" | "FT"; home: number; away: number };
export type SpecialLike = { matchId?: string; grade?: SpecialGrade; statusOverride?: BetStatus };

/**
 * In-play (live) grading. Unlike the static settle in bets.ts — which only knows
 * "pending / won / lost" off final scores — this reads the live match and reports
 * whether each line is currently winning, still alive, or already out of reach,
 * so the tracker can update second-by-second while a game is on.
 *
 *  won      — locked win (can't be undone)
 *  lost     — locked loss
 *  winning  — on track right now (would win if it ended this second)
 *  alive    — still mathematically possible, but not winning right now
 *  dead     — no longer possible (will settle as a loss)
 *  void     — refunded (stake returned), e.g. first-scorer pick that didn't start
 *  scheduled— not kicked off yet
 */
export type LiveVerdict = "won" | "lost" | "winning" | "alive" | "dead" | "void" | "scheduled";

/** First-goalscorer grade types that refund when the named player doesn't start. */
const FIRST_SCORER_VOID_TYPES = new Set<SpecialGrade["type"]>([
  "firstScorer",
  "firstScorerAndScore",
  "firstScorerAndScoreOther",
  "firstScorerAndResult",
  "drawAndFirstScorer",
]);

export type InPlay = { verdict: LiveVerdict; note: string };

const eq = (s: Score, h: number, a: number) => !!s && s.home === h && s.away === a;
/** A correct-score target is still reachable while neither side has overshot it. */
const reachable = (cur: { home: number; away: number }, h: number, a: number) =>
  cur.home <= h && cur.away <= a;

// ── name + goal helpers (mirror bets.ts so live and final agree) ──────────────
const deburr = (s: string): string =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
function nameMatch(a: string, b: string): boolean {
  const x = deburr(a);
  const y = deburr(b);
  return x === y || x.includes(y) || y.includes(x);
}
const realGoals = (g: Goal[]) => g.filter((x) => !x.ownGoal);
const goalsBy = (g: Goal[], p: string) => realGoals(g).filter((x) => nameMatch(x.scorer, p));
const assistsBy = (g: Goal[], p: string) => g.filter((x) => x.assist && nameMatch(x.assist, p));
const firstScorer = (g: Goal[]): string | null => realGoals(g)[0]?.scorer ?? null;
const cardsBy = (c: Card[], p: string) => c.filter((x) => nameMatch(x.player, p));

/**
 * Live equivalent of bets.ts `ft90` — the 90-MINUTE scoreline of a match, with
 * extra-time goals (minute > 90, or the `et` flag once finished) stripped off.
 * Equals the live score for any match that hasn't gone past 90, so it's safe to
 * call unconditionally. Every 90-minute market (1X2, BTTS, totals, correct score,
 * double chance, margins, HT-FT) settles on THIS, not the AET score — so a tie
 * that wins in extra time still grades the 90-min "to win" leg as lost.
 */
function ft90Of(lm: LiveMatch): { home: number; away: number } {
  let home = lm.score.home;
  let away = lm.score.away;
  for (const g of lm.goals) {
    if (g.et === true || (g.minute ?? 0) > 90) {
      if (g.team === "home") home -= 1;
      else away -= 1;
    }
  }
  return { home: Math.max(0, home), away: Math.max(0, away) };
}

/** A knockout tie has crossed into extra time (ESPN period 3/4) or penalties (5):
 *  no further 90-minute goals are possible, so every 90-minute market is decided. */
const inExtraTimeNow = (lm: LiveMatch): boolean => lm.state === "live" && lm.period >= 3;

// ── correct-score bets ────────────────────────────────────────────────────────
export function inPlayBet(bet: BetLike, live: LiveMatch | undefined): InPlay {
  if (!live || live.state === "scheduled") return { verdict: "scheduled", note: "Not started" };

  const cur = live.score;
  if (bet.period === "HT") {
    // Once we're at the break or past it, the half-time score is final for this bet.
    const ht = live.htScore;
    if (ht) {
      return eq(ht, bet.home, bet.away)
        ? { verdict: "won", note: `Won — HT ${ht.home}–${ht.away}` }
        : { verdict: "lost", note: `Lost — HT ${ht.home}–${ht.away}` };
    }
    // First half still in play.
    if (eq(cur, bet.home, bet.away)) return { verdict: "winning", note: `On track — ${cur.home}–${cur.away}` };
    if (reachable(cur, bet.home, bet.away)) return { verdict: "alive", note: `Live ${cur.home}–${cur.away} · still on` };
    return { verdict: "dead", note: `Out of reach — ${cur.home}–${cur.away}` };
  }

  // FT correct-score bet — a 90-minute market: settles on the 90-min line the
  // instant the match ends OR crosses into extra time (ET goals never count).
  if (live.state === "finished" || inExtraTimeNow(live)) {
    const ft = ft90Of(live);
    return eq(ft, bet.home, bet.away)
      ? { verdict: "won", note: `Won — FT ${ft.home}–${ft.away}` }
      : { verdict: "lost", note: `Lost — FT ${ft.home}–${ft.away}` };
  }
  if (eq(cur, bet.home, bet.away)) return { verdict: "winning", note: `On track — ${cur.home}–${cur.away}` };
  if (reachable(cur, bet.home, bet.away)) return { verdict: "alive", note: `Live ${cur.home}–${cur.away} · still on` };
  return { verdict: "dead", note: `Out of reach — ${cur.home}–${cur.away}` };
}

// ── 1xBet player-prop specials ────────────────────────────────────────────────
export function inPlaySpecial(special: SpecialLike, live: LiveMatch | undefined): InPlay {
  if (special.statusOverride) {
    if (special.statusOverride === "won") return { verdict: "won", note: "Won (confirmed)" };
    if (special.statusOverride === "void") return { verdict: "void", note: "Refunded (confirmed)" };
    return { verdict: "lost", note: "Lost (confirmed)" };
  }
  const g = special.grade;
  if (!g || !live || live.state === "scheduled") return { verdict: "scheduled", note: "Not started" };

  // First-goalscorer refund: a named player who isn't in the confirmed XI can't
  // be the first scorer, so the leg voids (stake returned) — mirror the settle.
  if (special.matchId) {
    if (FIRST_SCORER_VOID_TYPES.has(g.type) && "player" in g && playerStarted(special.matchId, g.player) === false) {
      return { verdict: "void", note: `${g.player} didn't start — refunded` };
    }
    if (g.type === "firstScorerEither") {
      const states = g.players.map((p) => playerStarted(special.matchId!, p));
      if (states.length > 0 && states.every((s) => s === false)) {
        return { verdict: "void", note: "None of the picks started — refunded" };
      }
    }
  }

  const goals = live.goals;
  const cards = live.cards;
  const done = live.state === "finished";
  const cur = live.score;
  // 90-minute view for the score-based specials (1X2, BTTS, totals, combos): a
  // knockout tie that goes to extra time settles them now, on the ET-stripped
  // line. `cur90` == `cur` in regulation, so it's safe to use throughout.
  const done90 = done || inExtraTimeNow(live);
  const cur90 = ft90Of(live);
  const player = "player" in g ? g.player : "";
  const scored = goalsBy(goals, player).length;
  const assists = assistsBy(goals, player).length;
  const first = firstScorer(goals);

  switch (g.type) {
    case "scored":
      if (scored > 0) return { verdict: "won", note: `${player} scored ✓` };
      return done ? { verdict: "lost", note: `${player} didn't score` } : { verdict: "alive", note: `${player} yet to score` };

    case "scoreAndAssist":
      if (scored > 0 && assists > 0) return { verdict: "won", note: `${player}: goal + assist ✓` };
      if (done) return { verdict: "lost", note: `${player}: ${scored}g ${assists}a` };
      return { verdict: "alive", note: `${player}: ${scored}g ${assists}a (need both)` };

    case "assistsOver":
      if (assists > g.line) return { verdict: "won", note: `${player}: ${assists} assists ✓` };
      return done
        ? { verdict: "lost", note: `${player}: ${assists} assists` }
        : { verdict: "alive", note: `${player}: ${assists}/${Math.ceil(g.line + 0.5)} assists` };

    case "firstScorer":
      if (first) {
        return nameMatch(first, player)
          ? { verdict: "won", note: `${player} scored first ✓` }
          : { verdict: "lost", note: `First goal: ${first}` };
      }
      return { verdict: "alive", note: "No goals yet" };

    case "firstScorerAndScore":
      if (first && !nameMatch(first, player)) return { verdict: "lost", note: `First goal: ${first}` };
      if (done) {
        return first && nameMatch(first, player) && eq(cur, g.home, g.away)
          ? { verdict: "won", note: `${player} 1st + ${g.home}–${g.away} ✓` }
          : { verdict: "lost", note: `FT ${cur.home}–${cur.away}` };
      }
      if (first && nameMatch(first, player) && eq(cur, g.home, g.away))
        return { verdict: "winning", note: `${player} 1st · ${cur.home}–${cur.away}` };
      if (reachable(cur, g.home, g.away))
        return { verdict: "alive", note: first ? `${player} 1st · ${cur.home}–${cur.away}` : `${cur.home}–${cur.away}` };
      return { verdict: "dead", note: `Score out of reach` };

    case "firstScorerAndScoreOther": {
      // Wins if the player scores first AND the final score lands OUTSIDE the
      // bookmaker's listed grid ("Any Other Score"). Mirror of the case above
      // with the grid test inverted. Until FT the score can still drift on/off
      // the grid, so it stays "alive" rather than ever dying early.
      if (first && !nameMatch(first, player)) return { verdict: "lost", note: `First goal: ${first}` };
      const onGrid = (h: number, a: number) =>
        g.excludeScores.some((s) => s.home === h && s.away === a);
      if (done) {
        return first && nameMatch(first, player) && !onGrid(cur.home, cur.away)
          ? { verdict: "won", note: `${player} 1st + ${cur.home}–${cur.away} (other) ✓` }
          : { verdict: "lost", note: `FT ${cur.home}–${cur.away}` };
      }
      if (first && nameMatch(first, player) && !onGrid(cur.home, cur.away))
        return { verdict: "winning", note: `${player} 1st · ${cur.home}–${cur.away} (other)` };
      return {
        verdict: "alive",
        note: first ? `${player} 1st · ${cur.home}–${cur.away}` : `${cur.home}–${cur.away}`,
      };
    }

    case "scoredAndScore":
      if (done) {
        return scored > 0 && eq(cur, g.home, g.away)
          ? { verdict: "won", note: `${player} scored · ${g.home}–${g.away} ✓` }
          : { verdict: "lost", note: `FT ${cur.home}–${cur.away}` };
      }
      if (scored > 0 && eq(cur, g.home, g.away)) return { verdict: "winning", note: `${player} scored · ${cur.home}–${cur.away}` };
      if (reachable(cur, g.home, g.away)) return { verdict: "alive", note: scored > 0 ? `${player} scored · need ${g.home}–${g.away}` : `Live ${cur.home}–${cur.away}` };
      return { verdict: "dead", note: "Score out of reach" };

    case "scoredAndScoreOther": {
      // Player scores anytime AND the final score lands OUTSIDE the listed grid.
      const onGrid = (h: number, a: number) =>
        g.excludeScores.some((s) => s.home === h && s.away === a);
      if (done) {
        return scored > 0 && !onGrid(cur.home, cur.away)
          ? { verdict: "won", note: `${player} scored + ${cur.home}–${cur.away} (other) ✓` }
          : { verdict: "lost", note: `FT ${cur.home}–${cur.away}` };
      }
      if (scored > 0 && !onGrid(cur.home, cur.away))
        return { verdict: "winning", note: `${player} scored · ${cur.home}–${cur.away} (other)` };
      return {
        verdict: "alive",
        note: scored > 0 ? `${player} scored · ${cur.home}–${cur.away}` : `${player} yet to score`,
      };
    }

    case "scoredAndScoreOneOf": {
      // Player scores anytime AND the final score is ONE OF the listed scorelines.
      const onGrid = g.scores.some((s) => eq(cur, s.home, s.away));
      const anyReach = g.scores.some((s) => reachable(cur, s.home, s.away));
      if (done) {
        return scored > 0 && onGrid
          ? { verdict: "won", note: `${player} scored · ${cur.home}–${cur.away} ✓` }
          : { verdict: "lost", note: `FT ${cur.home}–${cur.away}` };
      }
      if (scored > 0 && onGrid)
        return { verdict: "winning", note: `${player} scored · ${cur.home}–${cur.away}` };
      if (anyReach)
        return {
          verdict: "alive",
          note: scored > 0 ? `${player} scored · need a listed score` : `Live ${cur.home}–${cur.away}`,
        };
      return { verdict: "dead", note: "Score out of reach" };
    }

    case "firstScorerAndResult": {
      // Player scores first AND the full-time 1X2 result matches. The first-goal
      // leg locks lost the moment someone else scores; the result swings between
      // winning/alive until the whistle (a side can still get the result).
      const out = (h: number, a: number) => (h > a ? "1" : h < a ? "2" : "X");
      const sideLabel = g.outcome === "1" ? "home win" : g.outcome === "2" ? "away win" : "draw";
      if (first && !nameMatch(first, player)) return { verdict: "lost", note: `First goal: ${first}` };
      if (done) {
        return first && nameMatch(first, player) && out(cur.home, cur.away) === g.outcome
          ? { verdict: "won", note: `${player} 1st + ${sideLabel} ✓` }
          : { verdict: "lost", note: `FT ${cur.home}–${cur.away}` };
      }
      if (first && nameMatch(first, player) && out(cur.home, cur.away) === g.outcome)
        return { verdict: "winning", note: `${player} 1st · ${sideLabel} on track ${cur.home}–${cur.away}` };
      return {
        verdict: "alive",
        note: first ? `${player} 1st · need ${sideLabel} · ${cur.home}–${cur.away}` : `No goals yet · need ${sideLabel}`,
      };
    }

    case "secondHalfScore": {
      // Correct score of the second half alone (current minus the half-time score).
      const ht = live.htScore;
      if (!ht) return { verdict: "alive", note: "2nd-half score — settles after the break" };
      const sh = { home: cur.home - ht.home, away: cur.away - ht.away };
      if (done) {
        return sh.home === g.home && sh.away === g.away
          ? { verdict: "won", note: `2nd half ${sh.home}–${sh.away} ✓` }
          : { verdict: "lost", note: `2nd half ${sh.home}–${sh.away}` };
      }
      if (sh.home === g.home && sh.away === g.away)
        return { verdict: "winning", note: `2nd half ${sh.home}–${sh.away} on track` };
      if (sh.home <= g.home && sh.away <= g.away)
        return { verdict: "alive", note: `2nd half ${sh.home}–${sh.away} · still on` };
      return { verdict: "dead", note: `2nd half ${sh.home}–${sh.away} — out of reach` };
    }

    case "bothScored": {
      // Every listed player must score. Goals only accrue, so once all have
      // scored it's a locked win; settles lost if FT arrives with any short.
      const tally = g.players.map((p) => ({ p, n: goalsBy(goals, p).length }));
      if (tally.every((t) => t.n > 0)) return { verdict: "won", note: `Both scored ✓` };
      const missing = tally.filter((t) => t.n === 0).map((t) => t.p).join(", ");
      return done
        ? { verdict: "lost", note: `${missing} didn't score` }
        : { verdict: "alive", note: tally.map((t) => `${t.p} ${t.n > 0 ? "✓" : "—"}`).join(" · ") };
    }

    case "eitherAssists": {
      // At least one of the named players assists. Assists only accrue, so once
      // any lands it's a locked win; settles lost if FT arrives with none.
      const tally = g.players.map((p) => ({ p, n: assistsBy(goals, p).length }));
      if (tally.some((t) => t.n > 0)) return { verdict: "won", note: `Assist ✓` };
      return done
        ? { verdict: "lost", note: `No assist (${g.players.join(" / ")})` }
        : { verdict: "alive", note: tally.map((t) => `${t.p} ${t.n > 0 ? "✓" : "—"}`).join(" · ") };
    }

    case "scoredBothHalves": {
      // Player must score in each half — a goal ≤45' AND one >45'. Goals only
      // accrue, so once both land it's a locked win.
      const mine = goalsBy(goals, player);
      const firstHalf = mine.some((gl) => gl.minute != null && gl.minute <= 45);
      const secondHalf = mine.some((gl) => gl.minute != null && gl.minute > 45);
      if (firstHalf && secondHalf) return { verdict: "won", note: `${player}: scored both halves ✓` };
      return done
        ? { verdict: "lost", note: `${player}: ${firstHalf ? "1st ✓" : "1st —"} ${secondHalf ? "2nd ✓" : "2nd —"}` }
        : { verdict: "alive", note: `${player}: ${firstHalf ? "1st ✓" : "1st —"} · ${secondHalf ? "2nd ✓" : "2nd —"}` };
    }

    case "resultAndBtts": {
      // 1X2 outcome AND both teams score. Like matchResult, the winner isn't
      // locked until FT, so before the whistle it only swings winning/alive.
      const out = (h: number, a: number) => (h > a ? "1" : h < a ? "2" : "X");
      const sideLabel = g.outcome === "1" ? "home win" : g.outcome === "2" ? "away win" : "draw";
      const btts = cur90.home >= 1 && cur90.away >= 1;
      const onTrack = out(cur90.home, cur90.away) === g.outcome && btts;
      if (done90) {
        return onTrack
          ? { verdict: "won", note: `${sideLabel} + both scored ✓ (${cur90.home}–${cur90.away})` }
          : { verdict: "lost", note: `FT ${cur90.home}–${cur90.away}` };
      }
      return onTrack
        ? { verdict: "winning", note: `${sideLabel} + BTTS on track · ${cur.home}–${cur.away}` }
        : { verdict: "alive", note: `Need ${sideLabel} + both to score · ${cur.home}–${cur.away}` };
    }

    case "drawAndFirstScorer":
      if (first && !nameMatch(first, player)) return { verdict: "lost", note: `First goal: ${first}` };
      if (done) {
        return cur.home === cur.away && first && nameMatch(first, player)
          ? { verdict: "won", note: `Draw + ${player} 1st ✓` }
          : { verdict: "lost", note: `FT ${cur.home}–${cur.away}` };
      }
      if (cur.home === cur.away && first && nameMatch(first, player))
        return { verdict: "winning", note: `${player} 1st · level ${cur.home}–${cur.away}` };
      return { verdict: "alive", note: first ? `${player} 1st · ${cur.home}–${cur.away}` : `${cur.home}–${cur.away}` };

    case "freeKickGoal":
      // ESPN's scoreboard feed doesn't flag free-kick goals; confirmed post-match by the cron.
      if (goals.some((gl) => goalsBy([gl], player).length > 0 && gl.freeKick === true))
        return { verdict: "won", note: `${player} free-kick ✓` };
      return done
        ? { verdict: "lost", note: "No free-kick goal" }
        : { verdict: "alive", note: `${player} free-kick — confirmed at FT` };

    case "firstScorerEither": {
      // First goal by ANY of the named players ("Ronaldo or Neto to score 1st").
      if (first) {
        return g.players.some((p) => nameMatch(first, p))
          ? { verdict: "won", note: `${first} scored first ✓` }
          : { verdict: "lost", note: `First goal: ${first}` };
      }
      return { verdict: "alive", note: "No goals yet" };
    }

    case "scoredPenaltyAndResult": {
      // Player scores a penalty AND the 1X2 result lands. ESPN flags penaltyKick
      // on the scoring play, so the pen leg can read live; the result swings until
      // the whistle. Both must hold at FT.
      const out = (h: number, a: number) => (h > a ? "1" : h < a ? "2" : "X");
      const sideLabel = g.outcome === "1" ? "home win" : g.outcome === "2" ? "away win" : "draw";
      const pen = goalsBy(goals, player).some((gl) => gl.penalty === true);
      const resultOk = out(cur.home, cur.away) === g.outcome;
      if (done) {
        return pen && resultOk
          ? { verdict: "won", note: `${player} penalty + ${sideLabel} ✓` }
          : { verdict: "lost", note: `FT ${cur.home}–${cur.away}${pen ? " · pen ✓" : ""}` };
      }
      return pen && resultOk
        ? { verdict: "winning", note: `${player} pen ✓ · ${sideLabel} on track ${cur.home}–${cur.away}` }
        : { verdict: "alive", note: `${player} pen + ${sideLabel} · ${cur.home}–${cur.away}` };
    }

    case "firstGoalMethod": {
      // "Goal Number (1) — header / free kick / own goal". The method is parsed
      // from the summary keyEvents; it lands with the verified stats pass, so it
      // can resolve mid-match the moment the first goal is recorded.
      const labels: Record<string, string> = {
        header: "header",
        freekick: "direct free kick",
        penalty: "penalty",
        owngoal: "own goal",
        shot: "shot",
      };
      const want = labels[g.method] ?? g.method;
      const method = live.stats?.firstGoalMethod;
      if (method) {
        return method === g.method
          ? { verdict: "won", note: `1st goal: ${want} ✓` }
          : { verdict: "lost", note: `1st goal was a ${labels[method] ?? method}` };
      }
      if (done) return { verdict: "lost", note: cur.home + cur.away === 0 ? "0–0, no goal" : "No 1st-goal data" };
      return cur.home + cur.away > 0
        ? { verdict: "alive", note: `1st goal in — ${want}? confirmed with stats` }
        : { verdict: "alive", note: `${want} — confirmed when 1st goal lands` };
    }

    case "waterBreakCorner": {
      // "First action after the (1st/2nd-half) water break = corner — Yes".
      // Resolves the moment the verified stats pass logs an action past the
      // fixed 2026 break anchor (22' H1 / 67' H2). Until then it's alive — the
      // half may not have reached the break yet, or no action is logged past it.
      const half = g.half === 1 ? "1st" : "2nd";
      const wb = live.stats?.waterBreak?.[g.half === 1 ? "h1" : "h2"];
      if (wb && wb.firstActionType) {
        const flag = wb.isCorner && !wb.reliable ? " (verify no throw-in first)" : "";
        return wb.isCorner
          ? { verdict: "won", note: `${half} post-break: corner at ${wb.firstActionMinute}' ✓${flag}` }
          : { verdict: "lost", note: `${half} post-break: ${wb.firstActionType} at ${wb.firstActionMinute}'` };
      }
      if (done) return { verdict: "lost", note: `No post-break action logged (${half})` };
      return { verdict: "alive", note: `${half}-half break ≈${g.half === 1 ? 22 : 67}' — settles on first action after` };
    }

    case "goalsOver":
      // Player scores strictly more than `line` (line 1.5 → 2+). Goals only
      // accrue, so once over the line it's a locked win.
      if (scored > g.line) return { verdict: "won", note: `${player}: ${scored} goals ✓` };
      return done
        ? { verdict: "lost", note: `${player}: ${scored} goals` }
        : { verdict: "alive", note: `${player}: ${scored}/${Math.ceil(g.line + 0.5)} goals` };

    case "scoredOutsideBox": {
      // Locks won the moment a logged goal of his is flagged outside-the-box;
      // until then stays alive (an inside-box goal doesn't kill it — a later
      // long-ranger still can), loses at FT with no qualifying goal.
      const out = goalsBy(goals, g.player).some((gl) => gl.outsideBox === true);
      if (out) return { verdict: "won", note: `${g.player}: scored from outside the box ✓` };
      return done
        ? { verdict: "lost", note: `${g.player}: no goal from outside the box` }
        : { verdict: "alive", note: `${g.player}: needs a goal from outside the box` };
    }

    case "bttsEachOver": {
      // Both teams strictly over `line` each (line 1 → 2+ each). 90-minute market —
      // extra-time goals (minute > 90) don't count. Locked once both clear it.
      const reg = (gl: Goal) => !gl.ownGoal && (gl.minute ?? 0) <= 90;
      const home = goals.filter((gl) => gl.team === "home" && reg(gl)).length;
      const away = goals.filter((gl) => gl.team === "away" && reg(gl)).length;
      const need = Math.ceil(g.line + 0.5);
      if (home > g.line && away > g.line) return { verdict: "won", note: `Both ${need}+ ✓ (${home}–${away})` };
      return done90
        ? { verdict: "lost", note: `Ended ${home}–${away} (need ${need} each)` }
        : { verdict: "alive", note: `${home}–${away} · need ${need} each` };
    }

    case "htft": {
      // HT 1X2 AND FT 1X2 must both match. The HT leg locks at the break: if the
      // half-time result is wrong it's dead, no matter the full-time score.
      const out = (h: number, a: number) => (h > a ? "1" : h < a ? "2" : "X");
      const lab = (o: string) => (o === "1" ? "home" : o === "2" ? "away" : "draw");
      const ht = live.htScore;
      if (ht && out(ht.home, ht.away) !== g.ht)
        return { verdict: "dead", note: `HT ${ht.home}–${ht.away} — needed ${lab(g.ht)} at the break` };
      if (done) {
        return ht && out(ht.home, ht.away) === g.ht && out(cur.home, cur.away) === g.ft
          ? { verdict: "won", note: `${lab(g.ht)}/${lab(g.ft)} ✓` }
          : { verdict: "lost", note: `FT ${cur.home}–${cur.away}` };
      }
      if (ht) {
        // Half-time leg already correct — down to the full-time result now.
        return out(cur.home, cur.away) === g.ft
          ? { verdict: "winning", note: `HT ${lab(g.ht)} ✓ · FT on track ${cur.home}–${cur.away}` }
          : { verdict: "alive", note: `HT ${lab(g.ht)} ✓ · need ${lab(g.ft)} · ${cur.home}–${cur.away}` };
      }
      // First half still in play.
      return out(cur.home, cur.away) === g.ht
        ? { verdict: "winning", note: `1st-half ${lab(g.ht)} on track · ${cur.home}–${cur.away}` }
        : { verdict: "alive", note: `Need ${lab(g.ht)} at HT · ${cur.home}–${cur.away}` };
    }

    case "matchResult": {
      // Full-time 1X2. A match winner is never locked until FT — a side that's
      // behind or level can still get the result — so before FT it only swings
      // between "winning" (current 1X2 matches) and "alive", never "dead".
      const out = (h: number, a: number) => (h > a ? "1" : h < a ? "2" : "X");
      const sideLabel = g.outcome === "1" ? "home win" : g.outcome === "2" ? "away win" : "draw";
      if (done90) {
        return out(cur90.home, cur90.away) === g.outcome
          ? { verdict: "won", note: `${sideLabel} ✓ (${cur90.home}–${cur90.away})` }
          : { verdict: "lost", note: `FT ${cur90.home}–${cur90.away}` };
      }
      return out(cur.home, cur.away) === g.outcome
        ? { verdict: "winning", note: `Need ${sideLabel} · live ${cur.home}–${cur.away}` }
        : { verdict: "alive", note: `Need ${sideLabel} · live ${cur.home}–${cur.away}` };
    }

    case "carded": {
      // Player shown any card. Once booked it's a locked win — bookings don't get
      // taken back mid-match. Stays alive until then, settles lost if FT with none.
      const playerCards = cardsBy(cards, player);
      if (playerCards.length > 0) {
        const red = playerCards.some((c) => c.type === "red");
        return { verdict: "won", note: `${player} ${red ? "sent off" : "booked"} ✓` };
      }
      return done
        ? { verdict: "lost", note: `${player} not booked` }
        : { verdict: "alive", note: `${player} not booked yet` };
    }

    case "sentOff": {
      // Player dismissed (red — straight or second yellow). Locked win once red.
      if (cardsBy(cards, player).some((c) => c.type === "red"))
        return { verdict: "won", note: `${player} sent off ✓` };
      return done
        ? { verdict: "lost", note: `${player} not sent off` }
        : { verdict: "alive", note: `${player} on the pitch` };
    }

    case "matchGoalsOver": {
      // Total goals (both teams) over the line — a 90-minute market: extra-time
      // goals don't count. Once the 90-min line is cleared it's a locked win.
      const total = cur90.home + cur90.away;
      const need = Math.ceil(g.line + 0.5);
      if (total > g.line) return { verdict: "won", note: `${total} goals ✓ (${cur90.home}–${cur90.away})` };
      return done90
        ? { verdict: "lost", note: `Ended ${cur90.home}–${cur90.away} · ${total} goals (need ${need})` }
        : { verdict: "alive", note: `${total}/${need} goals · ${cur90.home}–${cur90.away}` };
    }

    case "combo": {
      // Build-a-bet: AND every leg off the live score + verified ESPN stats.
      // Accruing legs (goals/corners/cards over) can only improve, but result /
      // most-corners / most-cards legs can still flip, so a not-yet-true combo
      // stays "alive" rather than dying before the whistle.
      const r = evalCombo(g.conds, cur90, live.htScore, live.stats ?? null);
      const st = live.stats;
      const note = st
        ? `${cur90.home}–${cur90.away} · cnr ${st.corners.home}-${st.corners.away} · sot ${st.sot.home}-${st.sot.away} · crd ${st.cards.home}-${st.cards.away}`
        : `${cur90.home}–${cur90.away} · stats pending`;
      if (done90) {
        if (r === true) return { verdict: "won", note: `All legs ✓ · ${note}` };
        if (r === false) return { verdict: "lost", note };
        return { verdict: "alive", note: `Awaiting ESPN stats · ${note}` };
      }
      // A per-half leg locks the moment its half ends — if one is already
      // impossible, the combo is dead now (won't flip back), don't show "still on".
      if (comboDead(g.conds, live.htScore, live.stats ?? null))
        return { verdict: "dead", note: `Out of reach — ${note}` };
      return r === true
        ? { verdict: "winning", note: `All legs on track · ${note}` }
        : { verdict: "alive", note };
    }

    case "comboWithScorer": {
      // Build-a-bet with an extra "named player scores anytime" leg. Stat legs
      // can still flip and stats lag, so a not-yet-complete bet stays alive.
      const r = evalCombo(g.conds, cur90, live.htScore, live.stats ?? null);
      // Anytime-scorer is a 90-minute leg too — an extra-time goal doesn't count.
      const sc = goalsBy(goals, player).some((gl) => (gl.minute ?? 0) <= 90);
      const st = live.stats;
      const legNote = st
        ? `${cur90.home}–${cur90.away} · cnr ${st.corners.home}-${st.corners.away}`
        : `${cur90.home}–${cur90.away} · stats pending`;
      const note = `${player} ${sc ? "scored ✓" : "yet to score"} · ${legNote}`;
      if (done90) {
        if (r === true && sc) return { verdict: "won", note: `All legs ✓ · ${note}` };
        if (r === false || (r === true && !sc)) return { verdict: "lost", note };
        return { verdict: "alive", note: `Awaiting ESPN stats · ${note}` };
      }
      // A per-half leg locks at its half's whistle — if one's already gone, the
      // whole acca is dead now even with the scorer leg still live.
      if (comboDead(g.conds, live.htScore, live.stats ?? null))
        return { verdict: "dead", note: `Out of reach — ${note}` };
      return r === true && sc
        ? { verdict: "winning", note: `On track · ${note}` }
        : { verdict: "alive", note };
    }

    case "playerSotOver": {
      // Per-player shots on target Over `line`. Accrues monotonically — once the
      // player clears the line it's locked won; otherwise it stays alive until FT
      // (pending the ESPN per-shooter tally, which lands with the summary stats).
      const need = Math.ceil(g.line + 0.5);
      const st = live.stats;
      if (!st?.playerSot)
        return done
          ? { verdict: "lost", note: `${player}: SOT stat unavailable` }
          : { verdict: "alive", note: `${player}: awaiting SOT data (need ${need})` };
      const sot = playerSotCount(st, player);
      if (sot > g.line) return { verdict: "won", note: `${player}: ${sot} shots on target ✓` };
      return done
        ? { verdict: "lost", note: `${player}: ${sot} shots on target (need ${need})` }
        : { verdict: "alive", note: `${player}: ${sot}/${need} shots on target` };
    }

    case "goalsAssistsOver": {
      // Player goals + assists combined, Over `line`. Both accrue monotonically,
      // so once the combined tally clears the line it's a locked win.
      const ga = scored + assists;
      const need = Math.ceil(g.line + 0.5);
      if (ga > g.line) return { verdict: "won", note: `${player}: ${scored}g+${assists}a = ${ga} ✓` };
      return done
        ? { verdict: "lost", note: `${player}: ${scored}g+${assists}a = ${ga} (need ${need})` }
        : { verdict: "alive", note: `${player}: ${scored}g+${assists}a = ${ga}/${need}` };
    }

    case "manual":
      // ESPN can't verify this qualifier — surface it as awaiting a manual settle,
      // both live and at FT (never auto won/lost). Mirrors the static "pending".
      return { verdict: "alive", note: g.note };

    default:
      return { verdict: "scheduled", note: "Not started" };
  }
}

/**
 * Live grade for a cross-match accumulator ("multiScorers") — every named player
 * must score anytime in their OWN match. Unlike inPlaySpecial this needs the WHOLE
 * live map (one match per leg), so it's graded in the component, which holds it.
 *   won      — all legs' players have scored
 *   lost     — at least one leg's match finished with the player off the sheet
 *   winning  — some have scored, none dead, the rest still in play
 *   alive    — none scored yet but all still in play
 *   scheduled— nothing kicked off yet
 */
export function inPlayMultiScorers(
  legs: { matchId: string; player: string }[],
  live: Record<string, LiveMatch | undefined>,
  statusOverride?: BetStatus,
): InPlay {
  if (statusOverride) {
    return statusOverride === "won"
      ? { verdict: "won", note: "Won (confirmed)" }
      : { verdict: "lost", note: "Lost (confirmed)" };
  }
  let scoredCount = 0;
  let dead = false;
  let anyLive = false;
  const parts: string[] = [];
  for (const leg of legs) {
    const lm = live[leg.matchId];
    if (!lm || lm.state === "scheduled") {
      parts.push(`${leg.player} —`);
      continue;
    }
    anyLive = true;
    if (goalsBy(lm.goals, leg.player).length > 0) {
      scoredCount++;
      parts.push(`${leg.player} ✓`);
    } else if (lm.state === "finished") {
      dead = true;
      parts.push(`${leg.player} ✗`);
    } else {
      parts.push(`${leg.player} —`);
    }
  }
  const note = parts.join(" · ");
  if (dead) return { verdict: "lost", note };
  if (scoredCount === legs.length) return { verdict: "won", note };
  if (!anyLive) return { verdict: "scheduled", note };
  return { verdict: scoredCount > 0 ? "winning" : "alive", note };
}

/**
 * Live grade for a generalised cross-match accumulator ("multiLeg") — each leg is
 * either a plain "scores anytime" or "scores anytime AND that match's final score
 * is one of a set". A leg can lock WON early only when it's a pure scorer (a score
 * leg can't lock until FT, since the scoreline can still change). Mirrors the
 * static settle in bets.ts so live and final never disagree.
 */
export function inPlayMultiLeg(
  legs: import("./bets").MultiLegCond[],
  live: Record<string, LiveMatch | undefined>,
  statusOverride?: BetStatus,
): InPlay {
  if (statusOverride) {
    return statusOverride === "won"
      ? { verdict: "won", note: "Won (confirmed)" }
      : { verdict: "lost", note: "Lost (confirmed)" };
  }
  let wonCount = 0; // legs LOCKED won (pure scorer who's scored, or score-leg at FT)
  let onTrack = false; // a leg currently winning but not yet locked
  let dead = false;
  let anyLive = false;
  const parts: string[] = [];
  for (const leg of legs) {
    // Plain-English leg label — built by legLabel() so the slip grid reads as
    // sentences ("Croatia to win + both teams score") instead of bookmaker
    // shorthand. The status glyph is appended below with a single space.
    const legLabel = legLabelFor(leg);
    const lm = live[leg.matchId];
    if (!lm || lm.state === "scheduled") {
      parts.push(`${legLabel} —`);
      continue;
    }
    anyLive = true;
    // Full-time view (incl. extra time / penalties): advancement + scorer legs,
    // which only resolve at the true match end.
    const doneFull = lm.state === "finished";
    const curFull = lm.score;
    // 90-minute view — the DEFAULT for this loop, since most leg kinds are
    // 90-minute markets. A knockout tie crossing into extra time settles them all
    // immediately on the ET-stripped scoreline; `cur` == `curFull` in regulation.
    const done = doneFull || inExtraTimeNow(lm);
    const cur = ft90Of(lm);

    if (leg.kind === "result") {
      // 1X2 oriented to our fixture home/away — only locks at FT, never "dead"
      // mid-match (any current standing can still swing).
      const outcome = cur.home > cur.away ? "1" : cur.home < cur.away ? "2" : "X";
      const hitting = outcome === leg.outcome;
      if (done) {
        if (hitting) {
          wonCount++;
          parts.push(`${legLabel} ✓`);
        } else {
          dead = true;
          parts.push(`${legLabel} ✗`);
        }
      } else if (hitting) {
        onTrack = true;
        parts.push(`${legLabel} ⋯`);
      } else {
        parts.push(`${legLabel} —`);
      }
      continue;
    }

    if (leg.kind === "qualify") {
      // Advancement — can't lock from the live score alone (ET/pens decide a
      // level tie), so this never goes "dead" mid-match: a side level or behind
      // can still go through. Leading → on track. At FINAL, a decisive score
      // implies who advanced; a level final reads the captured `advanced`
      // (penalty/AET winner from build-results.mjs). Only when advancement is
      // genuinely not yet captured does it stay pending (⋯).
      const ours = leg.side === "home" ? curFull.home : curFull.away;
      const theirs = leg.side === "home" ? curFull.away : curFull.home;
      const adv = lm.advanced ?? null;
      if (doneFull) {
        if (ours > theirs || (ours === theirs && adv === leg.side)) {
          wonCount++;
          parts.push(`${legLabel} ✓`);
        } else if (ours < theirs || (ours === theirs && adv != null && adv !== leg.side)) {
          dead = true;
          parts.push(`${legLabel} ✗`);
        } else {
          // Level final, advancement not captured yet — defer to the static settle.
          onTrack = true;
          parts.push(`${legLabel} ⋯`);
        }
      } else if (ours > theirs) {
        onTrack = true;
        parts.push(`${legLabel} ⋯`);
      } else {
        parts.push(`${legLabel} —`);
      }
      continue;
    }

    if (leg.kind === "correctScore") {
      const onScore = eq(cur, leg.home, leg.away);
      if (done) {
        if (onScore) {
          wonCount++;
          parts.push(`${legLabel} ✓`);
        } else {
          dead = true;
          parts.push(`${legLabel} ✗`);
        }
      } else if (!reachable(cur, leg.home, leg.away)) {
        dead = true; // exact scoreline now out of reach
        parts.push(`${legLabel} ✗`);
      } else if (onScore) {
        onTrack = true;
        parts.push(`${legLabel} ⋯`);
      } else {
        parts.push(`${legLabel} —`);
      }
      continue;
    }

    if (leg.kind === "btts") {
      // Both teams score — goals only accrue. For "Yes" it locks WON once both
      // have scored; can't die early, lost at FT short. For "No" (negate) the
      // mirror: dies the instant both have scored, locks WON at FT if short.
      const raw = cur.home >= 1 && cur.away >= 1;
      if (leg.negate) {
        if (raw) {
          dead = true;
          parts.push(`${legLabel} ✗`);
        } else if (done) {
          wonCount++;
          parts.push(`${legLabel} ✓`);
        } else {
          onTrack = true;
          parts.push(`${legLabel} ⋯`);
        }
      } else if (raw) {
        wonCount++;
        parts.push(`${legLabel} ✓`);
      } else if (done) {
        dead = true;
        parts.push(`${legLabel} ✗`);
      } else {
        parts.push(`${legLabel} —`);
      }
      continue;
    }

    if (leg.kind === "cleanSheet") {
      // Named side keeps a clean sheet — dies the instant the other side scores
      // (goals don't come off), locks WON only at FT with the other side on 0.
      const conceded = leg.side === "home" ? cur.away : cur.home;
      if (conceded > 0) {
        dead = true;
        parts.push(`${legLabel} ✗`);
      } else if (done) {
        wonCount++;
        parts.push(`${legLabel} ✓`);
      } else {
        onTrack = true;
        parts.push(`${legLabel} ⋯`);
      }
      continue;
    }

    if (leg.kind === "resultBtts") {
      // 1X2 + both-teams-score, only decidable at FT (any current standing can
      // swing). negate flips it ("- No"). Mirrors the `result` leg's lock rules.
      const outcome = cur.home > cur.away ? "1" : cur.home < cur.away ? "2" : "X";
      const raw = outcome === leg.outcome && cur.home >= 1 && cur.away >= 1;
      const hitting = leg.negate ? !raw : raw;
      if (done) {
        if (hitting) {
          wonCount++;
          parts.push(`${legLabel} ✓`);
        } else {
          dead = true;
          parts.push(`${legLabel} ✗`);
        }
      } else if (hitting) {
        onTrack = true;
        parts.push(`${legLabel} ⋯`);
      } else {
        parts.push(`${legLabel} —`);
      }
      continue;
    }

    if (leg.kind === "doubleChanceBtts") {
      // DC pair + both-teams-score. Like `resultBtts`, only decidable at FT (the
      // result can swing into/out of the pair), so it never dies early. negate flips it.
      const outcome = cur.home > cur.away ? "1" : cur.home < cur.away ? "2" : "X";
      const raw = leg.outcome.includes(outcome) && cur.home >= 1 && cur.away >= 1;
      const hitting = leg.negate ? !raw : raw;
      if (done) {
        if (hitting) {
          wonCount++;
          parts.push(`${legLabel} ✓`);
        } else {
          dead = true;
          parts.push(`${legLabel} ✗`);
        }
      } else if (hitting) {
        onTrack = true;
        parts.push(`${legLabel} ⋯`);
      } else {
        parts.push(`${legLabel} —`);
      }
      continue;
    }

    if (leg.kind === "notBttsAndTotalOver") {
      // At least one team blanks AND total over line. Dies the instant BOTH
      // teams have scored (the blank can't come back); the over only accrues but
      // the blank-side can still score, so it locks WON only at FT.
      if (cur.home >= 1 && cur.away >= 1) {
        dead = true;
        parts.push(`${legLabel} ✗`);
        continue;
      }
      const total = cur.home + cur.away; // one side is on 0 here
      const hitting = total > leg.line;
      if (done) {
        if (hitting) {
          wonCount++;
          parts.push(`${legLabel} ✓`);
        } else if (wholeLinePush(total, leg.line)) {
          wonCount++;
          parts.push(`${legLabel} ↺`); // total pushes → combo voids, passes through
        } else {
          dead = true;
          parts.push(`${legLabel} ✗`);
        }
      } else if (hitting) {
        onTrack = true;
        parts.push(`${legLabel} ⋯`);
      } else {
        parts.push(`${legLabel} —`);
      }
      continue;
    }

    if (leg.kind === "bttsEachOver") {
      // Each team scores > line goals. Goals only accrue, so for "Yes" it locks
      // WON the moment both sides clear the line; for "No" it dies the instant
      // both clear it. Decides short at FT.
      const raw = cur.home > leg.line && cur.away > leg.line;
      if (leg.negate) {
        if (raw) {
          dead = true;
          parts.push(`${legLabel} ✗`);
        } else if (done) {
          wonCount++;
          parts.push(`${legLabel} ✓`);
        } else {
          onTrack = true;
          parts.push(`${legLabel} ⋯`);
        }
      } else if (raw) {
        wonCount++;
        parts.push(`${legLabel} ✓`);
      } else if (done) {
        dead = true;
        parts.push(`${legLabel} ✗`);
      } else {
        parts.push(`${legLabel} —`);
      }
      continue;
    }

    if (leg.kind === "totalUnder") {
      // Total goals under line. Dies only when the running total goes STRICTLY
      // OVER the line — a whole-line exact total (4 goals on Under 4) is a push
      // that voids and passes through the fixed-odds acca (same as handicap), so
      // it stays alive at 4 and only dies on a 5th goal. Locks at FT.
      const total = cur.home + cur.away;
      if (total > leg.line) {
        dead = true;
        parts.push(`${legLabel} ✗`);
      } else if (done) {
        // total <= line at FT: under → won; exact whole line → push (passes through)
        wonCount++;
        parts.push(`${legLabel} ${wholeLinePush(total, leg.line) ? "↺" : "✓"}`);
      } else {
        onTrack = true;
        parts.push(`${legLabel} ⋯`);
      }
      continue;
    }

    if (leg.kind === "totalOver") {
      // Total goals over line. Goals only accrue → locks WON the moment the
      // running total clears the line; while still short it shows neutral. At FT
      // a whole-line exact total (4 goals on Over 4) is a push → voids and passes
      // through the fixed-odds acca; strictly under is dead.
      const total = cur.home + cur.away;
      if (total > leg.line) {
        wonCount++;
        parts.push(`${legLabel} ✓`);
      } else if (done) {
        if (wholeLinePush(total, leg.line)) {
          wonCount++;
          parts.push(`${legLabel} ↺`); // push → void, passes through
        } else {
          dead = true;
          parts.push(`${legLabel} ✗`);
        }
      } else {
        parts.push(`${legLabel} —`);
      }
      continue;
    }

    if (leg.kind === "totalOverByMinute") {
      // Goals (any team, own goals included) on or before `minute`, over `line`.
      // Locks WON the instant a goal lands in the window; while it's still empty
      // it's currently losing (neutral —); dead at FT if the window stayed empty.
      const inWindow = lm.goals.filter(
        (gl) => !gl.et && gl.minute != null && gl.minute <= leg.minute,
      ).length;
      if (inWindow > leg.line) {
        wonCount++;
        parts.push(`${legLabel} ✓`);
      } else if (done) {
        dead = true;
        parts.push(`${legLabel} ✗`);
      } else {
        parts.push(`${legLabel} —`);
      }
      continue;
    }

    if (leg.kind === "doubleChance") {
      // FT in the covered pair — like `result`, only locks at FT, never dead
      // mid-match (any current standing can still swing into the pair).
      const outcome = cur.home > cur.away ? "1" : cur.home < cur.away ? "2" : "X";
      const hitting = leg.outcome.includes(outcome);
      if (done) {
        if (hitting) {
          wonCount++;
          parts.push(`${legLabel} ✓`);
        } else {
          dead = true;
          parts.push(`${legLabel} ✗`);
        }
      } else if (hitting) {
        onTrack = true;
        parts.push(`${legLabel} ⋯`);
      } else {
        parts.push(`${legLabel} —`);
      }
      continue;
    }

    if (leg.kind === "resultFirstHalf") {
      // 1X2 off the HALF-TIME score. Locks the instant HT is known.
      const ht = lm.htScore;
      const o = (h: number, a: number) => (h > a ? "1" : h < a ? "2" : "X");
      if (ht) {
        if (o(ht.home, ht.away) === leg.outcome) {
          wonCount++;
          parts.push(`${legLabel} ✓`);
        } else {
          dead = true;
          parts.push(`${legLabel} ✗`);
        }
      } else if (o(cur.home, cur.away) === leg.outcome) {
        onTrack = true; // first half still running, currently on the right side
        parts.push(`${legLabel} ⋯`);
      } else {
        parts.push(`${legLabel} —`);
      }
      continue;
    }

    if (leg.kind === "resultAndTotalUnder") {
      // 1X2 AND total under line. The total can only die early (goals accrue);
      // the result swings until FT, so the combo locks only at FT.
      const total = cur.home + cur.away;
      if (total > leg.line) {
        // Strictly over — the under-part can't come back, so the combo is dead.
        dead = true;
        parts.push(`${legLabel} ✗`);
        continue;
      }
      const outcome = cur.home > cur.away ? "1" : cur.home < cur.away ? "2" : "X";
      const hitting = outcome === leg.outcome;
      const totalPush = wholeLinePush(total, leg.line); // exact whole line → total voids
      if (done) {
        if (hitting && total < leg.line) {
          wonCount++;
          parts.push(`${legLabel} ✓`);
        } else if (hitting && totalPush) {
          wonCount++;
          parts.push(`${legLabel} ↺`); // total component pushes → combo voids
        } else {
          dead = true;
          parts.push(`${legLabel} ✗`);
        }
      } else if (hitting && total < leg.line) {
        onTrack = true;
        parts.push(`${legLabel} ⋯`);
      } else {
        parts.push(`${legLabel} —`);
      }
      continue;
    }

    if (leg.kind === "individualTotalUnder") {
      // One side's goals under line. Dies only when that side goes STRICTLY OVER
      // the line — a whole-line exact tally (2 goals on Under 2) is a push that
      // voids and passes through. Locks at FT.
      const sideGoals = leg.side === "home" ? cur.home : cur.away;
      if (sideGoals > leg.line) {
        dead = true;
        parts.push(`${legLabel} ✗`);
      } else if (done) {
        wonCount++;
        parts.push(`${legLabel} ${wholeLinePush(sideGoals, leg.line) ? "↺" : "✓"}`);
      } else {
        onTrack = true;
        parts.push(`${legLabel} ⋯`);
      }
      continue;
    }

    if (leg.kind === "individualTotalOver") {
      // One side's goals over line. Goals only accrue → locks WON the moment
      // that side clears the line; while still short it's currently losing
      // (neutral —). At FT a whole-line exact tally is a push → voids and
      // passes through as neutral; strictly under is dead.
      const sideGoals = leg.side === "home" ? cur.home : cur.away;
      if (sideGoals > leg.line) {
        wonCount++;
        parts.push(`${legLabel} ✓`);
      } else if (done) {
        if (wholeLinePush(sideGoals, leg.line)) {
          wonCount++; // push → void, passes through (must count so the acca can settle)
          parts.push(`${legLabel} ↺`);
        } else {
          dead = true;
          parts.push(`${legLabel} ✗`);
        }
      } else {
        parts.push(`${legLabel} —`);
      }
      continue;
    }

    if (leg.kind === "winsAtLeastOneHalf") {
      // Won iff the side takes H1 (HT) OR H2 (FT−HT). H1 locks at the break, so a
      // half won there is banked immediately; otherwise the leg can still win on
      // H2 right up to FT, so it never dies early.
      const ht = lm.htScore;
      const wonH1 = ht ? (leg.side === "home" ? ht.home > ht.away : ht.away > ht.home) : false;
      if (wonH1) {
        wonCount++;
        parts.push(`${legLabel} ✓`);
        continue;
      }
      if (done) {
        const sh = ht ? cur.home - ht.home : cur.home;
        const sa = ht ? cur.away - ht.away : cur.away;
        const wonH2 = leg.side === "home" ? sh > sa : sa > sh;
        if (wonH2) {
          wonCount++;
          parts.push(`${legLabel} ✓`);
        } else {
          dead = true;
          parts.push(`${legLabel} ✗`);
        }
        continue;
      }
      // Live: leading the half currently in play → on track.
      const sh = ht ? cur.home - ht.home : cur.home;
      const sa = ht ? cur.away - ht.away : cur.away;
      const leading = leg.side === "home" ? sh > sa : sa > sh;
      if (leading) onTrack = true;
      parts.push(`${legLabel} ${leading ? "⋯" : "—"}`);
      continue;
    }

    if (leg.kind === "brace") {
      // Any single scorer on 2+ non-own goals. Locks won immediately; lost at FT.
      const counts = new Map<string, number>();
      for (const gl of realGoals(lm.goals)) {
        const k = deburr(gl.scorer);
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      const max = counts.size ? Math.max(...counts.values()) : 0;
      if (max >= 2) {
        wonCount++;
        parts.push(`${legLabel} ✓`);
      } else if (doneFull) {
        dead = true;
        parts.push(`${legLabel} ✗`);
      } else if (max === 1) {
        onTrack = true;
        parts.push(`${legLabel} ⋯`);
      } else {
        parts.push(`${legLabel} —`);
      }
      continue;
    }

    if (leg.kind === "htft") {
      // HT + FT 1X2 double. Wrong HT outcome at the break kills it; otherwise
      // locks at FT.
      const ht = lm.htScore;
      const out = (s: { home: number; away: number }) =>
        s.home > s.away ? "1" : s.home < s.away ? "2" : "X";
      if (ht && out(ht) !== leg.ht) {
        dead = true;
        parts.push(`${legLabel} ✗`);
        continue;
      }
      if (done) {
        if (ht && out(ht) === leg.ht && out(cur) === leg.ft) {
          wonCount++;
          parts.push(`${legLabel} ✓`);
        } else {
          dead = true;
          parts.push(`${legLabel} ✗`);
        }
        continue;
      }
      if (ht && out(ht) === leg.ht && out(cur) === leg.ft) {
        onTrack = true;
        parts.push(`${legLabel} ⋯`);
      } else {
        parts.push(`${legLabel} —`);
      }
      continue;
    }

    if (leg.kind === "resultAndTotalOver") {
      // 1X2 AND total over line. The total only accrues (the over-part, once hit,
      // is banked), but the result swings until FT, so the combo locks only at FT.
      const total = cur.home + cur.away;
      const outcome = cur.home > cur.away ? "1" : cur.home < cur.away ? "2" : "X";
      const resultOk = outcome === leg.outcome;
      const hitting = total > leg.line && resultOk;
      const totalPush = wholeLinePush(total, leg.line); // exact whole line → total voids
      if (done) {
        if (hitting) {
          wonCount++;
          parts.push(`${legLabel} ✓`);
        } else if (resultOk && totalPush) {
          wonCount++;
          parts.push(`${legLabel} ↺`); // total component pushes → combo voids
        } else {
          dead = true;
          parts.push(`${legLabel} ✗`);
        }
      } else if (hitting) {
        onTrack = true;
        parts.push(`${legLabel} ⋯`);
      } else {
        parts.push(`${legLabel} —`);
      }
      continue;
    }

    if (leg.kind === "winByMargin") {
      // Any side wins by line+ goals — absolute FT goal difference. The margin
      // swings both ways until FT, so it never dies early.
      const hitting = Math.abs(cur.home - cur.away) >= leg.line;
      if (done) {
        if (hitting) {
          wonCount++;
          parts.push(`${legLabel} ✓`);
        } else {
          dead = true;
          parts.push(`${legLabel} ✗`);
        }
      } else if (hitting) {
        onTrack = true;
        parts.push(`${legLabel} ⋯`);
      } else {
        parts.push(`${legLabel} —`);
      }
      continue;
    }

    if (leg.kind === "handicap") {
      // Handicap on `side`: add `line` to that side's running goals, compare to
      // the opponent. The adjusted margin swings both ways until FT, so it never
      // dies early; locks at FT (exact push voids → passes through as neutral).
      const mine = leg.side === "home" ? cur.home : cur.away;
      const opp = leg.side === "home" ? cur.away : cur.home;
      const covered = mine + leg.line >= opp; // ahead or level (push) = not dead
      if (done) {
        if (covered) {
          wonCount++;
          parts.push(`${legLabel} ✓`);
        } else {
          dead = true;
          parts.push(`${legLabel} ✗`);
        }
      } else if (mine + leg.line > opp) {
        onTrack = true;
        parts.push(`${legLabel} ⋯`);
      } else {
        parts.push(`${legLabel} —`);
      }
      continue;
    }

    if (leg.kind === "firstPenalty") {
      // Which side took the match's first penalty (scored/missed/saved), from
      // live.stats.firstPenalty. Clinches WON the instant our side takes it; if
      // the other side takes it first the acca dies; no pen by FT → voids, which
      // in a fixed-odds acca passes through as on-track/neutral (never kills it).
      const fp = lm.stats?.firstPenalty ?? null;
      if (fp === leg.side) {
        wonCount++;
        parts.push(`${legLabel} ✓`);
      } else if (fp) {
        dead = true;
        parts.push(`${legLabel} ✗`);
      } else {
        parts.push(`${legLabel} —`);
      }
      continue;
    }

    if (leg.kind === "manual") {
      // Truly unverifiable from ESPN (e.g. "penalty for a foul on <player>") —
      // never auto-graded; shows neutral and the whole acca holds for a human.
      parts.push(`${legLabel} —`);
      continue;
    }

    if (leg.kind === "goalsAssistsOver") {
      // Goals + assists combined over line — clinches WON the moment the tally
      // clears the line; dies only at FT short of it.
      const tally =
        goalsBy(lm.goals, leg.player).length + assistsBy(lm.goals, leg.player).length;
      if (tally > leg.line) {
        wonCount++;
        parts.push(`${legLabel} ✓`);
      } else if (doneFull) {
        dead = true;
        parts.push(`${legLabel} ✗`);
      } else {
        parts.push(`${legLabel} —`);
      }
      continue;
    }

    if (leg.kind === "goalsOver") {
      // Named player's GOALS only over line — clinches WON the moment his goal
      // tally clears the line; dies only at FT short of it.
      if (goalsBy(lm.goals, leg.player).length > leg.line) {
        wonCount++;
        parts.push(`${legLabel} ✓`);
      } else if (doneFull) {
        dead = true;
        parts.push(`${legLabel} ✗`);
      } else {
        parts.push(`${legLabel} —`);
      }
      continue;
    }

    if (leg.kind === "scoredOrAssisted") {
      // Involved in a goal (scored OR assisted) at least once — clinches WON on
      // first involvement; dies at FT if never involved.
      const involved =
        goalsBy(lm.goals, leg.player).length + assistsBy(lm.goals, leg.player).length;
      if (involved > 0) {
        wonCount++;
        parts.push(`${legLabel} ✓`);
      } else if (doneFull) {
        dead = true;
        parts.push(`${legLabel} ✗`);
      } else {
        parts.push(`${legLabel} —`);
      }
      continue;
    }

    if (leg.kind === "assisted") {
      // Player to provide an assist — clinches WON on first assist; dies at FT
      // if never. `negate` is the "- No" pick (blank-while-live shows ⋯).
      const assisted = assistsBy(lm.goals, leg.player).length > 0;
      if (leg.negate) {
        if (assisted) {
          dead = true;
          parts.push(`${legLabel} ✗`);
        } else if (doneFull) {
          wonCount++;
          parts.push(`${legLabel} ✓`);
        } else {
          onTrack = true;
          parts.push(`${legLabel} ⋯`);
        }
        continue;
      }
      if (assisted) {
        wonCount++;
        parts.push(`${legLabel} ✓`);
      } else if (doneFull) {
        dead = true;
        parts.push(`${legLabel} ✗`);
      } else {
        parts.push(`${legLabel} —`);
      }
      continue;
    }

    const scored = goalsBy(lm.goals, leg.player).length > 0;
    if (leg.kind === "scored") {
      if (leg.negate) {
        // "- No": must NOT score. Dies the instant he scores; locks won at FT
        // blank. Currently-blank shows ⋯ (on track) rather than — (neutral).
        if (scored) {
          dead = true;
          parts.push(`${legLabel} ✗`);
        } else if (doneFull) {
          wonCount++;
          parts.push(`${legLabel} ✓`);
        } else {
          onTrack = true;
          parts.push(`${legLabel} ⋯`);
        }
        continue;
      }
      if (scored) {
        wonCount++;
        parts.push(`${legLabel} ✓`);
      } else if (doneFull) {
        dead = true;
        parts.push(`${legLabel} ✗`);
      } else {
        parts.push(`${legLabel} —`);
      }
      continue;
    }
    // scoredAndScoreOneOf — score grid is a 90-minute market (uses `cur`), but the
    // scorer half resolves only at the true whistle, so gate on `doneFull`.
    const onGrid = leg.scores.some((s) => eq(cur, s.home, s.away));
    const anyReach = leg.scores.some((s) => reachable(cur, s.home, s.away));
    if (doneFull) {
      if (scored && onGrid) {
        wonCount++;
        parts.push(`${legLabel} ✓`);
      } else {
        dead = true;
        parts.push(`${legLabel} ✗`);
      }
    } else if (scored && !anyReach) {
      dead = true; // scored but the listed scorelines are now out of reach
      parts.push(`${legLabel} ✗`);
    } else if (scored && onGrid) {
      onTrack = true;
      parts.push(`${legLabel} ⋯`);
    } else {
      parts.push(`${legLabel} —`);
    }
  }
  const note = parts.join(" · ");
  if (dead) return { verdict: "lost", note };
  if (wonCount === legs.length) return { verdict: "won", note };
  if (!anyLive) return { verdict: "scheduled", note };
  return { verdict: wonCount > 0 || onTrack ? "winning" : "alive", note };
}

// ── helpers for the live tally ────────────────────────────────────────────────
/** "If it ended right now": winning/won pay out, everything else loses its stake. */
export function liveLeans(v: LiveVerdict): "win" | "lose" | "neutral" {
  if (v === "won" || v === "winning") return "win";
  if (v === "scheduled" || v === "void") return "neutral"; // void = stake back, no P&L
  return "lose"; // lost, dead, alive all lose if the whistle goes now
}
