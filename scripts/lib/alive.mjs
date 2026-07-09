/**
 * Which teams are STILL ALIVE in the competition.
 *
 * Pure, data-only. Given the fixtures list, the results map and a name
 * `norm`-aliser, returns a Set of normalised team keys that have NOT been
 * knocked out yet. Used to keep the stat leaderboards (top scorers, cards,
 * completion boards, …) to players/teams that are still in the tournament.
 *
 *   • Before the knockouts begin (no round-labelled fixtures): everyone in the
 *     fixtures list is alive.
 *   • Once the knockouts start: the alive universe is every team that reached
 *     the knockouts — the widest / entry knockout round (Round of 32) — minus
 *     the loser of every FINISHED knockout tie (from results `advanced`, or the
 *     score as a fallback).
 *
 * KEEP IN SYNC with lib/tournament.ts (the TypeScript twin the live recompute
 * uses). Same rule, two runtimes — the .mjs cron builder can't import the .ts.
 */
export function aliveTeamKeys(fixtures, results, norm) {
  const ko = (fixtures ?? []).filter((f) => f.round);

  // Pure group stage — nobody is out yet.
  if (ko.length === 0) {
    return new Set(
      (fixtures ?? []).flatMap((f) => [norm(f.home.name), norm(f.away.name)]),
    );
  }

  // Entry round = the knockout round with the most fixtures (widest = earliest,
  // e.g. Round of 32). Its participants are the real group-stage qualifiers.
  const byRound = {};
  for (const f of ko) (byRound[f.round] ??= []).push(f);
  const entry = Object.values(byRound).sort((a, b) => b.length - a.length)[0];
  const universe = new Set(
    entry.flatMap((f) => [norm(f.home.name), norm(f.away.name)]),
  );

  // Drop the loser of every finished knockout tie.
  const koById = {};
  for (const f of ko) koById[f.id] = f;
  const eliminated = new Set();
  for (const [id, r] of Object.entries(results ?? {})) {
    const f = koById[id];
    if (!f || r.state !== "finished") continue;
    let loser = null;
    if (r.advanced === "home") loser = f.away.name;
    else if (r.advanced === "away") loser = f.home.name;
    else {
      const s = r.ft ?? r.score;
      if (s && s.home !== s.away) loser = s.home > s.away ? f.away.name : f.home.name;
    }
    if (loser) eliminated.add(norm(loser));
  }

  const alive = new Set();
  for (const t of universe) if (!eliminated.has(t)) alive.add(t);
  return alive;
}
