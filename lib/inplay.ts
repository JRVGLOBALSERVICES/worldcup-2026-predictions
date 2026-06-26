import type { Goal, Card, Score, SpecialGrade, BetStatus } from "./bets";
import { comboDead, evalCombo, playerSotCount, playerStarted } from "./bets";
import type { LiveMatch } from "./live";

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

  // FT correct-score bet.
  if (live.state === "finished") {
    const ft = live.ftScore ?? cur;
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
      const btts = cur.home >= 1 && cur.away >= 1;
      const onTrack = out(cur.home, cur.away) === g.outcome && btts;
      if (done) {
        return onTrack
          ? { verdict: "won", note: `${sideLabel} + both scored ✓ (${cur.home}–${cur.away})` }
          : { verdict: "lost", note: `FT ${cur.home}–${cur.away}` };
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

    case "bttsEachOver": {
      // Both teams strictly over `line` each (line 1 → 2+ each). Locked once met.
      const home = goals.filter((gl) => gl.team === "home" && !gl.ownGoal).length;
      const away = goals.filter((gl) => gl.team === "away" && !gl.ownGoal).length;
      const need = Math.ceil(g.line + 0.5);
      if (home > g.line && away > g.line) return { verdict: "won", note: `Both ${need}+ ✓ (${home}–${away})` };
      return done
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
      if (done) {
        return out(cur.home, cur.away) === g.outcome
          ? { verdict: "won", note: `${sideLabel} ✓ (${cur.home}–${cur.away})` }
          : { verdict: "lost", note: `FT ${cur.home}–${cur.away}` };
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
      // Total goals (both teams) over the line. Goals only accrue, so once the
      // line is cleared it's a locked win; until then it climbs winning/alive.
      const total = cur.home + cur.away;
      const need = Math.ceil(g.line + 0.5);
      if (total > g.line) return { verdict: "won", note: `${total} goals ✓ (${cur.home}–${cur.away})` };
      return done
        ? { verdict: "lost", note: `Ended ${cur.home}–${cur.away} · ${total} goals (need ${need})` }
        : { verdict: "alive", note: `${total}/${need} goals · ${cur.home}–${cur.away}` };
    }

    case "combo": {
      // Build-a-bet: AND every leg off the live score + verified ESPN stats.
      // Accruing legs (goals/corners/cards over) can only improve, but result /
      // most-corners / most-cards legs can still flip, so a not-yet-true combo
      // stays "alive" rather than dying before the whistle.
      const r = evalCombo(g.conds, cur, live.htScore, live.stats ?? null);
      const st = live.stats;
      const note = st
        ? `${cur.home}–${cur.away} · cnr ${st.corners.home}-${st.corners.away} · sot ${st.sot.home}-${st.sot.away} · crd ${st.cards.home}-${st.cards.away}`
        : `${cur.home}–${cur.away} · stats pending`;
      if (done) {
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
      const r = evalCombo(g.conds, cur, live.htScore, live.stats ?? null);
      const sc = scored > 0;
      const st = live.stats;
      const legNote = st
        ? `${cur.home}–${cur.away} · cnr ${st.corners.home}-${st.corners.away}`
        : `${cur.home}–${cur.away} · stats pending`;
      const note = `${player} ${sc ? "scored ✓" : "yet to score"} · ${legNote}`;
      if (done) {
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
  // Short fallback label for legs without a player (result / correctScore):
  // "SWI v CAN" from the matchId prefix.
  const matchCode = (id: string) => {
    const [h, a] = id.split("-");
    return `${(h ?? "").toUpperCase()} v ${(a ?? "").toUpperCase()}`;
  };
  for (const leg of legs) {
    // Per-leg display label: scorer legs show the player; result/CS legs show
    // the match code + the pick.
    const w1x2 = (o: "1" | "X" | "2") => (o === "X" ? "X" : o === "1" ? "W1" : "W2");
    const legLabel =
      leg.kind === "result"
        ? `${matchCode(leg.matchId)} ${w1x2(leg.outcome)}`
        : leg.kind === "correctScore"
          ? `${matchCode(leg.matchId)} ${leg.home}-${leg.away}`
          : leg.kind === "btts"
            ? `${matchCode(leg.matchId)} BTTS${leg.negate ? " (No)" : ""}`
            : leg.kind === "cleanSheet"
              ? `${matchCode(leg.matchId)} ${leg.side === "home" ? "H" : "A"}-CS`
              : leg.kind === "resultBtts"
                ? `${matchCode(leg.matchId)} ${w1x2(leg.outcome)}+BTTS${leg.negate ? " (No)" : ""}`
                : leg.kind === "bttsEachOver"
                  ? `${matchCode(leg.matchId)} Each ${leg.line + 1}+${leg.negate ? " (No)" : ""}`
                  : leg.kind === "totalUnder"
                    ? `${matchCode(leg.matchId)} U${leg.line}`
                    : leg.kind === "doubleChance"
                      ? `${matchCode(leg.matchId)} ${leg.outcome}`
                      : leg.kind === "resultFirstHalf"
                        ? `${matchCode(leg.matchId)} ${w1x2(leg.outcome)} 1H`
                        : leg.kind === "resultAndTotalUnder"
                          ? `${matchCode(leg.matchId)} ${w1x2(leg.outcome)}+U${leg.line}`
                          : leg.kind === "individualTotalUnder"
                            ? `${matchCode(leg.matchId)} ${leg.side === "home" ? "H" : "A"} U${leg.line}`
                            : leg.kind === "scored" && leg.negate
                              ? `No ${leg.player}`
                              : leg.player;
    const lm = live[leg.matchId];
    if (!lm || lm.state === "scheduled") {
      parts.push(`${legLabel} —`);
      continue;
    }
    anyLive = true;
    const done = lm.state === "finished";
    const cur = lm.score;

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
      // Total goals under line. Goals only accrue → dies the moment the running
      // total reaches the line; locks WON at FT if still under.
      const total = cur.home + cur.away;
      if (!(total < leg.line)) {
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
      if (!(total < leg.line)) {
        dead = true;
        parts.push(`${legLabel} ✗`);
        continue;
      }
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

    if (leg.kind === "individualTotalUnder") {
      // One side's goals under line. Goals only accrue → dies the moment that
      // side reaches the line; locks WON at FT if still under.
      const sideGoals = leg.side === "home" ? cur.home : cur.away;
      if (!(sideGoals < leg.line)) {
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

    const scored = goalsBy(lm.goals, leg.player).length > 0;
    if (leg.kind === "scored") {
      if (leg.negate) {
        // "- No": must NOT score. Dies the instant he scores; locks won at FT
        // blank. Currently-blank shows ⋯ (on track) rather than — (neutral).
        if (scored) {
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
      if (scored) {
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
    // scoredAndScoreOneOf
    const onGrid = leg.scores.some((s) => eq(cur, s.home, s.away));
    const anyReach = leg.scores.some((s) => reachable(cur, s.home, s.away));
    if (done) {
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
