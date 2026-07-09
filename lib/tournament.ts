/**
 * Which teams are STILL ALIVE in the competition — the TypeScript twin of
 * scripts/lib/alive.mjs. Same rule, two runtimes: the .mjs cron builder uses
 * the .mjs copy, the live recompute (lib/live-stats.ts) uses this one. KEEP
 * THE TWO IN SYNC.
 *
 * Given the fixtures list, the results map and a name `norm`-aliser, returns a
 * Set of normalised team keys that have NOT been knocked out yet:
 *   • Before the knockouts begin (no round-labelled fixtures): everyone alive.
 *   • Once the knockouts start: the entry knockout round's participants (the
 *     group-stage qualifiers) minus the loser of every FINISHED knockout tie.
 */
type MinFixture = {
  id: string;
  round?: string;
  home: { name: string };
  away: { name: string };
};

type MinResult = {
  state?: string;
  advanced?: "home" | "away" | null;
  ft?: { home: number; away: number };
  score?: { home: number; away: number };
};

export function aliveTeamKeys(
  fixtures: MinFixture[],
  results: Record<string, MinResult>,
  norm: (s: string) => string,
): Set<string> {
  const ko = (fixtures ?? []).filter((f) => f.round);

  if (ko.length === 0) {
    return new Set((fixtures ?? []).flatMap((f) => [norm(f.home.name), norm(f.away.name)]));
  }

  const byRound: Record<string, MinFixture[]> = {};
  for (const f of ko) (byRound[f.round as string] ??= []).push(f);
  const entry = Object.values(byRound).sort((a, b) => b.length - a.length)[0];
  const universe = new Set(entry.flatMap((f) => [norm(f.home.name), norm(f.away.name)]));

  const koById: Record<string, MinFixture> = {};
  for (const f of ko) koById[f.id] = f;
  const eliminated = new Set<string>();
  for (const [id, r] of Object.entries(results ?? {})) {
    const f = koById[id];
    if (!f || r.state !== "finished") continue;
    let loser: string | null = null;
    if (r.advanced === "home") loser = f.away.name;
    else if (r.advanced === "away") loser = f.home.name;
    else {
      const s = r.ft ?? r.score;
      if (s && s.home !== s.away) loser = s.home > s.away ? f.away.name : f.home.name;
    }
    if (loser) eliminated.add(norm(loser));
  }

  const alive = new Set<string>();
  for (const t of universe) if (!eliminated.has(t)) alive.add(t);
  return alive;
}
