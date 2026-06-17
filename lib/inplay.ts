import type { Goal, Score, SpecialGrade, BetStatus } from "./bets";
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
function nameMatch(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  return x === y || x.includes(y) || y.includes(x);
}
const realGoals = (g: Goal[]) => g.filter((x) => !x.ownGoal);
const goalsBy = (g: Goal[], p: string) => realGoals(g).filter((x) => nameMatch(x.scorer, p));
const assistsBy = (g: Goal[], p: string) => g.filter((x) => x.assist && nameMatch(x.assist, p));
const firstScorer = (g: Goal[]): string | null => realGoals(g)[0]?.scorer ?? null;

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

    case "scoredAndScore":
      if (done) {
        return scored > 0 && eq(cur, g.home, g.away)
          ? { verdict: "won", note: `${player} scored · ${g.home}–${g.away} ✓` }
          : { verdict: "lost", note: `FT ${cur.home}–${cur.away}` };
      }
      if (scored > 0 && eq(cur, g.home, g.away)) return { verdict: "winning", note: `${player} scored · ${cur.home}–${cur.away}` };
      if (reachable(cur, g.home, g.away)) return { verdict: "alive", note: scored > 0 ? `${player} scored · need ${g.home}–${g.away}` : `Live ${cur.home}–${cur.away}` };
      return { verdict: "dead", note: "Score out of reach" };

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
