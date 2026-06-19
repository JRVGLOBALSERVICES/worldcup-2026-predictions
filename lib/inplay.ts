import type { Goal, Card, Score, SpecialGrade, BetStatus } from "./bets";
import type { LiveMatch } from "./live";

/** Minimal shapes the graders read — so both the full Bet/Special and the
 *  serialisable client rows satisfy them without casts. */
export type BetLike = { period: "HT" | "FT"; home: number; away: number };
export type SpecialLike = { grade?: SpecialGrade; statusOverride?: BetStatus };

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
 *  scheduled— not kicked off yet
 */
export type LiveVerdict = "won" | "lost" | "winning" | "alive" | "dead" | "scheduled";

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
    return special.statusOverride === "won"
      ? { verdict: "won", note: "Won (confirmed)" }
      : { verdict: "lost", note: "Lost (confirmed)" };
  }
  const g = special.grade;
  if (!g || !live || live.state === "scheduled") return { verdict: "scheduled", note: "Not started" };

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

    default:
      return { verdict: "scheduled", note: "Not started" };
  }
}

// ── helpers for the live tally ────────────────────────────────────────────────
/** "If it ended right now": winning/won pay out, everything else loses its stake. */
export function liveLeans(v: LiveVerdict): "win" | "lose" | "neutral" {
  if (v === "won" || v === "winning") return "win";
  if (v === "scheduled") return "neutral";
  return "lose"; // lost, dead, alive all lose if the whistle goes now
}
