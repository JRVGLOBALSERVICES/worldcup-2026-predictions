"use client";

import { useEffect, useRef, useState } from "react";
import { useLiveMatch } from "./LiveProvider";
import { KickoffClock } from "./KickoffClock";
import type { LiveMatch } from "@/lib/live";

/**
 * A live number that pops (scale + brightness flash) whenever its value
 * changes — every stat on a live view runs through this, so shots / passes /
 * tackles visibly TICK as ESPN's counts climb. The pop replays via a key
 * remount; reduced-motion users just see the number change.
 */
function AnimatedNum({ value, className }: { value: number; className?: string }) {
  const prev = useRef(value);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    if (prev.current !== value) {
      prev.current = value;
      setBump((b) => b + 1);
    }
  }, [value]);
  return (
    <span key={bump} className={`${className ?? ""} ${bump > 0 ? "stat-pop" : ""}`}>
      {value}
    </span>
  );
}

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
    <div className="mt-3 rounded-xl border border-line/70 bg-pitch-2/50 px-3 py-2">
      <div className="flex items-center justify-between">
        <StateTag lm={lm} />
        <div
          className={`tnum font-display text-2xl font-black leading-none ${hot ? "text-ink" : "text-muted"}`}
        >
          <AnimatedNum value={lm.score.home} />
          <span className="px-1.5 text-faint">–</span>
          <AnimatedNum value={lm.score.away} />
        </div>
      </div>
      {lm.goals.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-line/50 pt-2">
          {lm.goals.map((g, i) => (
            <li key={i} className="flex items-center gap-1 font-mono text-[0.6rem] leading-none">
              <span className="tnum text-faint">{g.minute != null ? `${g.minute}'` : "•"}</span>
              <span className={g.team === "home" ? "text-acid" : "text-mint"}>{g.scorer}</span>
              {g.penalty && <span className="text-amber">(P)</span>}
              {g.ownGoal && <span className="text-rose">(OG)</span>}
            </li>
          ))}
        </ul>
      )}
      {lm.stats && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-line/50 pt-2 font-mono text-[0.58rem] uppercase leading-none tracking-wider">
          <StatPair label="Cor" h={lm.stats.corners.home} a={lm.stats.corners.away} />
          <StatPair label="SOT" h={lm.stats.sot.home} a={lm.stats.sot.away} />
          <StatPair label="Sh" h={lm.stats.shots.home} a={lm.stats.shots.away} />
          <StatPair
            label="Crd"
            h={lm.stats.cards.home}
            a={lm.stats.cards.away}
            sub={`${lm.stats.yellow.home + lm.stats.yellow.away}Y ${lm.stats.red.home + lm.stats.red.away}R`}
          />
        </div>
      )}
    </div>
  );
}

/** One home–away stat token shared by the card row and the detail block.
 * Values animate (pop) when a live poll moves them. */
function StatPair({ label, h, a, sub }: { label: string; h: number; a: number; sub?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-faint">{label}</span>
      <AnimatedNum value={h} className="tnum text-acid" />
      <span className="text-faint">–</span>
      <AnimatedNum value={a} className="tnum text-mint" />
      {sub && <span className="text-faint">({sub})</span>}
    </span>
  );
}

/**
 * Animated possession bar — home (acid) fills from the left, away (cyan) from
 * the right, widths easing on every poll so the swing is visible as motion.
 */
function PossessionBar({ home, away }: { home: number; away: number }) {
  const total = home + away || 1;
  const hPct = (home / total) * 100;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between font-mono text-[0.62rem] uppercase tracking-[0.16em]">
        <AnimatedNum value={Math.round(home)} className="tnum text-acid text-[0.78rem] font-semibold" />
        <span className="text-faint">Possession %</span>
        <AnimatedNum value={Math.round(away)} className="tnum text-mint text-[0.78rem] font-semibold" />
      </div>
      {/* One full-width cyan track with an acid overlay scaled to the home share —
       * animating transform, never width (layout), per the motion rules. */}
      <div className="relative h-1.5 overflow-hidden rounded-full bg-mint/70">
        <span
          className="absolute inset-0 origin-left rounded-full bg-acid transition-transform duration-700 ease-out"
          style={{ transform: `scaleX(${hPct / 100})` }}
        />
      </div>
    </div>
  );
}

/** One mirrored stat row — bars grow toward each side from the centre label. */
function StatRow({ label, h, a }: { label: string; h: number; a: number }) {
  const max = Math.max(h, a, 1);
  return (
    <div className="grid grid-cols-[2.2rem_1fr_minmax(5.5rem,auto)_1fr_2.2rem] items-center gap-2">
      <AnimatedNum value={h} className="tnum text-right text-[0.8rem] font-semibold text-acid" />
      {/* Bars grow toward the centre label via scaleX — transform-only motion. */}
      <div className="h-1 overflow-hidden rounded-full bg-raised/50">
        <span
          className="block h-full origin-right rounded-full bg-acid transition-transform duration-700 ease-out"
          style={{ transform: `scaleX(${h / max})` }}
        />
      </div>
      <span className="text-center font-mono text-[0.6rem] uppercase tracking-[0.14em] text-faint">
        {label}
      </span>
      <div className="h-1 overflow-hidden rounded-full bg-raised/50">
        <span
          className="block h-full origin-left rounded-full bg-mint/80 transition-transform duration-700 ease-out"
          style={{ transform: `scaleX(${a / max})` }}
        />
      </div>
      <AnimatedNum value={a} className="tnum text-[0.8rem] font-semibold text-mint" />
    </div>
  );
}

/**
 * Verified ESPN match stats for the match-detail page — the settling counts
 * (corners / SOT / shots / cards) plus the tempo block (possession / passes /
 * tackles / saves / offsides / blocked / interceptions / clearances) when the
 * feed carries it. Every number ticks live; bars ease on each 5s poll.
 */
export function LiveStats({ matchId }: { matchId: string }) {
  const lm = useLiveMatch(matchId);
  if (!lm || lm.state === "scheduled" || !lm.stats) return null;
  const s = lm.stats;
  const t = s.tempo;
  return (
    <div className="mt-6 rounded-2xl border border-line bg-card/50 p-5">
      <h3 className="mb-4 font-mono text-[0.7rem] uppercase tracking-[0.22em] text-faint">
        Match stats {lm.state === "finished" ? "(full time)" : "(live)"} · verified vs ESPN
      </h3>

      {t && (t.possession.home > 0 || t.possession.away > 0) && (
        <div className="mb-4">
          <PossessionBar home={t.possession.home} away={t.possession.away} />
        </div>
      )}

      <div className="space-y-2.5">
        <StatRow label="Shots" h={s.shots.home} a={s.shots.away} />
        <StatRow label="On target" h={s.sot.home} a={s.sot.away} />
        {t && <StatRow label="Blocked" h={t.blockedShots.home} a={t.blockedShots.away} />}
        <StatRow label="Corners" h={s.corners.home} a={s.corners.away} />
        {t && <StatRow label="Saves" h={t.saves.home} a={t.saves.away} />}
        {t && <StatRow label="Passes" h={t.passes.home} a={t.passes.away} />}
        {t && <StatRow label="Tackles" h={t.tackles.home} a={t.tackles.away} />}
        {t && <StatRow label="Interceptions" h={t.interceptions.home} a={t.interceptions.away} />}
        {t && <StatRow label="Clearances" h={t.clearances.home} a={t.clearances.away} />}
        {s.fouls && <StatRow label="Fouls" h={s.fouls.home} a={s.fouls.away} />}
        {t && <StatRow label="Offsides" h={t.offsides.home} a={t.offsides.away} />}
        <StatRow label="Cards" h={s.cards.home} a={s.cards.away} />
      </div>

      <p className="mt-3 border-t border-line/50 pt-2 font-mono text-[0.56rem] uppercase tracking-[0.14em] text-ink/35">
        {s.yellow.home + s.yellow.away} yellow · {s.red.home + s.red.away} red
        {lm.state !== "finished" ? " · numbers tick live every 5s" : ""}
      </p>
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
          <AnimatedNum value={lm.score.home} />
          <span className="px-2 text-faint">–</span>
          <AnimatedNum value={lm.score.away} />
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
