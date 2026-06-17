"use client";

import { useLiveMatch } from "./LiveProvider";
import { KickoffClock } from "./KickoffClock";
import type { LiveMatch } from "@/lib/live";

/** Live/HT/FT badge — null when there's no live feed for this fixture. */
function StateTag({ lm }: { lm: LiveMatch }) {
  if (lm.state === "live")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose/15 px-1.5 py-0.5 font-mono text-[0.58rem] font-semibold uppercase tracking-wider text-rose">
        <span className="size-1.5 rounded-full bg-rose motion-safe:animate-pulse" />
        {lm.statusDetail || "Live"}
      </span>
    );
  if (lm.state === "halftime")
    return (
      <span className="rounded-full bg-amber/15 px-1.5 py-0.5 font-mono text-[0.58rem] font-semibold uppercase tracking-wider text-amber">
        Half-time
      </span>
    );
  return (
    <span className="rounded-full bg-card px-1.5 py-0.5 font-mono text-[0.58rem] font-semibold uppercase tracking-wider text-faint">
      Full time
    </span>
  );
}

/**
 * Compact live scoreboard for a match card. Renders nothing until ESPN has a
 * state for this fixture, so the static card layout is untouched pre-kickoff.
 */
export function LiveScore({ matchId }: { matchId: string }) {
  const lm = useLiveMatch(matchId);
  if (!lm || lm.state === "scheduled") return null;
  const hot = lm.state === "live" || lm.state === "halftime";
  return (
    <div className="mt-3 flex items-center justify-between rounded-xl border border-line/70 bg-pitch-2/50 px-3 py-2">
      <StateTag lm={lm} />
      <div
        className={`tnum font-display text-2xl font-black leading-none ${hot ? "text-ink" : "text-muted"}`}
      >
        {lm.score.home}
        <span className="px-1.5 text-faint">–</span>
        {lm.score.away}
      </div>
    </div>
  );
}

/**
 * Big centre block for the match-detail header. Shows the live/FT scoreline in
 * place of the kickoff time once a match is under way; otherwise the static
 * kickoff time the server rendered.
 */
export function MatchHeaderScore({
  matchId,
  mytLabel,
  etLabel,
}: {
  matchId: string;
  mytLabel: string;
  etLabel: string;
}) {
  const lm = useLiveMatch(matchId);

  if (lm && lm.state !== "scheduled") {
    const tone =
      lm.state === "live" ? "text-rose" : lm.state === "halftime" ? "text-amber" : "text-acid";
    return (
      <div className="shrink-0 text-center">
        <div className={`tnum font-display text-4xl font-black sm:text-5xl ${tone}`}>
          {lm.score.home}
          <span className="px-2 text-faint">–</span>
          {lm.score.away}
        </div>
        <div className="mt-1 inline-flex items-center gap-1.5 font-mono text-[0.62rem] uppercase tracking-wider text-faint">
          {lm.state === "live" && (
            <span className="size-1.5 rounded-full bg-rose motion-safe:animate-pulse" />
          )}
          {lm.state === "live"
            ? lm.statusDetail || "Live"
            : lm.state === "halftime"
              ? "Half-time"
              : "Full time"}
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0 text-center">
      <div className="tnum font-display text-3xl font-black text-acid sm:text-4xl">{mytLabel}</div>
      <div className="font-mono text-[0.62rem] uppercase tracking-wider text-faint">
        MYT · {etLabel} ET
      </div>
    </div>
  );
}

/** Chronological goal log — renders once a match has any goals. */
export function LiveGoalLog({ matchId }: { matchId: string }) {
  const lm = useLiveMatch(matchId);
  if (!lm || lm.state === "scheduled" || lm.goals.length === 0) return null;
  return (
    <div className="mt-6 rounded-2xl border border-line bg-card/50 p-5">
      <h3 className="mb-3 font-mono text-[0.7rem] uppercase tracking-[0.22em] text-faint">
        Goals {lm.state === "finished" ? "(full time)" : "(live)"}
      </h3>
      <ul className="space-y-2">
        {lm.goals.map((g, i) => (
          <li key={i} className="flex items-center gap-3 text-sm">
            <span className="tnum w-9 shrink-0 font-mono text-faint">
              {g.minute != null ? `${g.minute}'` : "—"}
            </span>
            <span className={`size-2 shrink-0 rounded-full ${g.team === "home" ? "bg-acid" : "bg-mint"}`} />
            <span className="font-semibold text-ink">{g.scorer}</span>
            {g.penalty && <span className="font-mono text-[0.62rem] uppercase text-amber">pen</span>}
            {g.ownGoal && <span className="font-mono text-[0.62rem] uppercase text-rose">OG</span>}
            {g.assist && <span className="text-muted">· assist {g.assist}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Status line for the card footer / match header. Falls back to the static
 * kickoff countdown when there's no live data yet.
 */
export function LiveStatusLine({
  matchId,
  kickoffUTC,
}: {
  matchId: string;
  kickoffUTC: string;
}) {
  const lm = useLiveMatch(matchId);
  if (!lm || lm.state === "scheduled") return <KickoffClock kickoffUTC={kickoffUTC} />;

  if (lm.state === "live")
    return (
      <span className="inline-flex items-center gap-1.5 text-rose">
        <span className="size-2 rounded-full bg-rose motion-safe:animate-pulse" />
        <span className="tnum font-mono">
          {lm.score.home}–{lm.score.away}
        </span>
        <span className="text-faint">·</span>
        <span className="font-mono">{lm.statusDetail || "Live"}</span>
      </span>
    );
  if (lm.state === "halftime")
    return (
      <span className="inline-flex items-center gap-1.5 text-amber">
        <span className="tnum font-mono">
          {lm.score.home}–{lm.score.away}
        </span>
        <span className="text-faint">·</span>
        <span className="font-mono">Half-time</span>
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 text-muted">
      <span className="tnum font-mono text-ink">
        {lm.score.home}–{lm.score.away}
      </span>
      <span className="text-faint">·</span>
      <span className="font-mono">Full time</span>
    </span>
  );
}
