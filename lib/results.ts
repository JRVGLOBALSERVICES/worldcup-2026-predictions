import type { Fixture, Prediction } from "./types";
import resultsFile from "@/data/results.json";

/** A goal as persisted by scripts/build-results.mjs (oriented to our home/away). */
export type ResultGoal = {
  team: "home" | "away";
  scorer: string;
  minute: number | null;
  assist: string | null;
  penalty: boolean;
  ownGoal: boolean;
  /** Real goal scored in extra time — excluded from 90-minute scorer/score markets. */
  et?: boolean;
};

export type MatchResult = {
  state: "live" | "finished";
  ht: { home: number; away: number } | null;
  ft: { home: number; away: number } | null;
  /** 90-minute scoreline (ET goals removed). Equals `ft` for regulation/group games. */
  ft90?: { home: number; away: number } | null;
  /** ESPN-verified match-end phase. Absent/regulation for group games. */
  finishPhase?: "regulation" | "extra_time" | "penalties" | null;
  score: { home: number; away: number };
  goals: ResultGoal[];
  updatedAt: string;
};

type ResultsFile = { meta: unknown; results: Record<string, MatchResult> };

export function getResult(matchId: string): MatchResult | null {
  return (resultsFile as ResultsFile).results[matchId] ?? null;
}

export type Verdict = "hit" | "miss" | "pending";

export type MarketVerdict = {
  label: string;
  predicted: string;
  actual: string;
  verdict: Verdict;
};

export type ScorerVerdict = { name: string; scored: boolean };

export type PredictionGrade = {
  state: "live" | "finished";
  finalLabel: string; // "England 4–2 Croatia" style scoreline
  markets: MarketVerdict[];
  scorers: ScorerVerdict[];
  /** Actual goalscorers the model did NOT name. */
  surprises: string[];
  hitCount: number;
  gradedCount: number; // markets that are settled (not pending)
};

/* ---------- parsing helpers ---------- */

function parseScore(s: string): { home: number; away: number } | null {
  const m = s.replace(/[–—]/g, "-").match(/(\d+)\s*-\s*(\d+)/);
  if (!m) return null;
  return { home: parseInt(m[1], 10), away: parseInt(m[2], 10) };
}

function outcome(sc: { home: number; away: number }): "home" | "away" | "draw" {
  if (sc.home > sc.away) return "home";
  if (sc.away > sc.home) return "away";
  return "draw";
}

/** Map a pick string ("England" / "Draw" / "Uzbekistan to win") to a side. */
function pickSide(pick: string, fx: Fixture): "home" | "away" | "draw" | null {
  const p = pick.toLowerCase();
  if (p.includes("draw")) return "draw";
  if (p.includes(fx.home.name.toLowerCase())) return "home";
  if (p.includes(fx.away.name.toLowerCase())) return "away";
  return null;
}

function sideLabel(side: "home" | "away" | "draw", fx: Fixture): string {
  return side === "home" ? fx.home.name : side === "away" ? fx.away.name : "Draw";
}

/** Normalise a player name to a comparable surname token set. */
function nameKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s]/g, "")
    .trim();
}
function surname(name: string): string {
  const k = nameKey(name);
  const parts = k.split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] ?? k;
}

function scorerScored(predicted: string, goals: ResultGoal[]): boolean {
  const ps = surname(predicted);
  const pk = nameKey(predicted);
  return goals.some((g) => {
    if (g.ownGoal || g.et) return false; // own goals + ET goals aren't a 90-min scorer hit
    const gs = surname(g.scorer);
    const gk = nameKey(g.scorer);
    return gs === ps || gk === pk || gk.includes(ps) || pk.includes(gs);
  });
}

/* ---------- the grader ---------- */

/**
 * Compare the AI's prediction to the actual (live or finished) result, market by
 * market. Returns null when there is no result yet (pre-kickoff) so the caller
 * can simply not render the verdict block. While a match is live, FT-derived
 * markets read "pending"; anytime-scorer picks already settle hit the moment the
 * named player scores.
 */
export function gradePrediction(
  pred: Prediction,
  result: MatchResult,
  fx: Fixture,
): PredictionGrade {
  const settled = result.state === "finished";
  // Grade on the 90-minute scoreline (every market the model predicts is a 90-min
  // market). The displayed scoreline shows the REAL final (incl. ET) plus a phase
  // tag, so a knockout that went the distance reads e.g. "2–1 (AET)".
  const score = result.ft90 ?? result.ft ?? result.score;
  const shown = result.ft ?? result.score;
  const phaseTag =
    result.finishPhase === "penalties"
      ? " (pens)"
      : result.finishPhase === "extra_time"
        ? " (AET)"
        : "";
  const scoreLabel = `${fx.home.name} ${shown.home}–${shown.away} ${fx.away.name}${phaseTag}`;

  const markets: MarketVerdict[] = [];

  // Match result
  {
    const predSide = pickSide(pred.win.pick, fx);
    const actualSide = outcome(score);
    const verdict: Verdict = !settled
      ? "pending"
      : predSide && predSide === actualSide
        ? "hit"
        : "miss";
    markets.push({
      label: "Match result",
      predicted: pred.win.pick,
      actual: sideLabel(actualSide, fx),
      verdict,
    });
  }

  // Full-time score (exact)
  {
    const predFt = parseScore(pred.fullTime.score);
    const verdict: Verdict = !settled
      ? "pending"
      : predFt && predFt.home === score.home && predFt.away === score.away
        ? "hit"
        : "miss";
    markets.push({
      label: "Full-time score",
      predicted: pred.fullTime.score,
      actual: `${score.home}–${score.away}`,
      verdict,
    });
  }

  // Half-time score (exact) — only settles once HT is known
  {
    const predHt = parseScore(pred.halfTime.score);
    const ht = result.ht;
    const verdict: Verdict = !ht
      ? "pending"
      : predHt && predHt.home === ht.home && predHt.away === ht.away
        ? "hit"
        : "miss";
    markets.push({
      label: "Half-time score",
      predicted: pred.halfTime.score,
      actual: ht ? `${ht.home}–${ht.away}` : "—",
      verdict,
    });
  }

  // Half-time / full-time (winner at the break / winner at the end)
  {
    const ht = result.ht;
    const [predHtRaw, predFtRaw] = pred.htft.pick.split("/").map((s) => s.trim());
    const actualHtLabel = ht ? sideLabel(outcome(ht), fx) : "—";
    const actualFtLabel = sideLabel(outcome(score), fx);
    const matchPart = (p: string | undefined, actualLabel: string) =>
      p && actualLabel !== "—" && p.toLowerCase() === actualLabel.toLowerCase();
    const verdict: Verdict =
      !settled || !ht
        ? "pending"
        : matchPart(predHtRaw, actualHtLabel) && matchPart(predFtRaw, actualFtLabel)
          ? "hit"
          : "miss";
    markets.push({
      label: "Half-time / full-time",
      predicted: pred.htft.pick,
      actual: `${actualHtLabel} / ${actualFtLabel}`,
      verdict,
    });
  }

  // Anytime scorers
  const scorers: ScorerVerdict[] = pred.scorers.map((s) => ({
    name: s.player,
    scored: scorerScored(s.player, result.goals),
  }));

  // Goalscorers the model didn't name (excluding own goals)
  const namedKeys = new Set(pred.scorers.map((s) => surname(s.player)));
  const surprises = result.goals
    .filter((g) => !g.ownGoal && !g.et && !namedKeys.has(surname(g.scorer)))
    .map((g) => g.scorer);

  const hitCount = markets.filter((m) => m.verdict === "hit").length;
  const gradedCount = markets.filter((m) => m.verdict !== "pending").length;

  return {
    state: result.state,
    finalLabel: scoreLabel,
    markets,
    scorers,
    surprises: [...new Set(surprises)],
    hitCount,
    gradedCount,
  };
}
