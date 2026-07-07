"use client";

import { useEffect, useRef, useState } from "react";
import { useLiveMatch } from "./LiveProvider";
import { KickoffClock } from "./KickoffClock";
import type { LiveMatch } from "@/lib/live";
import type { FullStatLine, PlayerShotLine, Substitution } from "@/lib/bets";
import { nameMatch } from "@/lib/bets";

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
          {lm.stats.fouls && (
            <StatPair label="Fls" h={lm.stats.fouls.home} a={lm.stats.fouls.away} />
          )}
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

/** One mirrored stat row — bars grow toward each side from the centre label.
 * `pct` rows render a % suffix (the bars still race on the same numbers). */
function StatRow({ label, h, a, pct }: { label: string; h: number; a: number; pct?: boolean }) {
  const max = Math.max(h, a, 1);
  return (
    <div className="grid grid-cols-[2.6rem_1fr_minmax(5.5rem,auto)_1fr_2.6rem] items-center gap-2">
      <span className="tnum text-right text-[0.8rem] font-semibold text-acid">
        <AnimatedNum value={h} />
        {pct && <span className="text-[0.6rem] text-acid/70">%</span>}
      </span>
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
      <span className="tnum text-[0.8rem] font-semibold text-mint">
        <AnimatedNum value={a} />
        {pct && <span className="text-[0.6rem] text-mint/70">%</span>}
      </span>
    </div>
  );
}

/* ── The COMPLETE boxscore board ────────────────────────────────────────────
 * Everything ESPN publishes per team (28 lines as of R16), grouped for reading:
 * attack → set pieces/keeping → passing → defending → discipline. Unknown new
 * keys ESPN adds later keep their feed order at the end — never silently
 * dropped. Possession is excluded here (it IS the bar above the board). */

const FULL_ORDER = [
  // attack
  "totalShots", "shotsOnTarget", "blockedShots", "shotPct",
  "penaltyKickGoals", "penaltyKickShots",
  // set pieces + keeping
  "wonCorners", "offsides", "saves",
  // passing
  "totalPasses", "accuratePasses", "passPct",
  "totalCrosses", "accurateCrosses", "crossPct",
  "totalLongBalls", "accurateLongBalls", "longballPct",
  // defending
  "totalTackles", "effectiveTackles", "tacklePct",
  "interceptions", "totalClearance", "effectiveClearance",
  // discipline
  "foulsCommitted", "yellowCards", "redCards",
];

export type FullStatRow = { key: string; label: string; h: number; a: number; pct: boolean };

/** Numeric rows from the raw ESPN lines. Ratio stats arrive as fractions
 * (shotPct 0.2 → 20%); possessionPct is already 0–100 and is filtered out. */
export function buildFullStatRows(full: FullStatLine[]): FullStatRow[] {
  const rank = (k: string) => {
    const i = FULL_ORDER.indexOf(k);
    return i === -1 ? FULL_ORDER.length : i;
  };
  return full
    .filter((l) => l.key !== "possessionPct")
    .map((l) => {
      const pct = /Pct$/.test(l.key);
      const num = (s: string) => {
        const v = parseFloat(s);
        if (!Number.isFinite(v)) return 0;
        return pct && v <= 1 ? Math.round(v * 100) : Math.round(v * 10) / 10;
      };
      return { key: l.key, label: l.label, h: num(l.home), a: num(l.away), pct };
    })
    .sort((x, y) => rank(x.key) - rank(y.key)); // stable → unknowns keep feed order
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
  // The complete ESPN list when the snapshot carries it; curated fallback for
  // matches snapshotted before `full` existed (pre 2026-07-07).
  const full = s.full?.length ? buildFullStatRows(s.full) : null;
  return (
    <div className="mt-6 rounded-2xl border border-line bg-card/50 p-5">
      <h3 className="mb-4 font-mono text-[0.7rem] uppercase tracking-[0.22em] text-faint">
        {full ? "All match stats" : "Match stats"} {lm.state === "finished" ? "(full time)" : "(live)"} · verified vs ESPN
      </h3>

      {t && (t.possession.home > 0 || t.possession.away > 0) && (
        <div className="mb-4">
          <PossessionBar home={t.possession.home} away={t.possession.away} />
        </div>
      )}

      {full ? (
        <div className="space-y-2.5">
          {full.map((r) => (
            <StatRow key={r.key} label={r.label} h={r.h} a={r.a} pct={r.pct} />
          ))}
        </div>
      ) : (
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
      )}

      <p className="mt-3 border-t border-line/50 pt-2 font-mono text-[0.56rem] uppercase tracking-[0.14em] text-ink/35">
        {s.yellow.home + s.yellow.away} yellow · {s.red.home + s.red.away} red
        {lm.state !== "finished" ? " · numbers tick live every 5s" : ""}
      </p>
    </div>
  );
}

/* ── Player shots board + subs log ──────────────────────────────────────────
 * The per-player layer under the team stats: every shooter's full line (total /
 * on / off / blocked / goals), live sub markers, and the substitution log with
 * injury flags. This is the view that tracks a "Player Over X shots" leg shot
 * by shot — the counts ARE the settling tallies from lib/live.ts. */

export type ShotRow = {
  player: string;
  line: PlayerShotLine;
  /** Substitution touching this player, if any. */
  subbedOff?: number | null;
  subbedOn?: number | null;
  injuredOff?: boolean;
  /** Player is named in an open bet leg (shots / SOT prop) — highlight. */
  tracked?: boolean;
};

/** Sub markers per player name (accent-safe), from the match's subs list. */
function subMarks(subs: Substitution[] | undefined, player: string) {
  let subbedOff: number | null | undefined;
  let subbedOn: number | null | undefined;
  let injuredOff = false;
  for (const s of subs ?? []) {
    if (s.off && nameMatch(s.off, player)) {
      subbedOff = s.minute;
      injuredOff = s.injury;
    }
    if (s.on && nameMatch(s.on, player)) subbedOn = s.minute;
  }
  return { subbedOff, subbedOn, injuredOff };
}

/**
 * Build the board rows for one match: every player with a shot attempt, PLUS
 * any tracked player (matched against open shots-prop bet LABELS — a label
 * contains the player's name) from the confirmed XI / subs even at 0 attempts,
 * so a tracked line reads 0, not "missing". `tracked` entries may be full bet
 * labels; matching is accent-safe containment either way (lib/bets nameMatch).
 */
export function buildShotRows(lm: LiveMatch, tracked: string[] = []): ShotRow[] {
  const breakdown = lm.stats?.playerShotBreakdown ?? {};
  const subs = lm.stats?.subs;
  const rows: ShotRow[] = Object.entries(breakdown).map(([player, line]) => ({
    player,
    line,
    ...subMarks(subs, player),
    tracked: tracked.some((t) => nameMatch(t, player)),
  }));

  // Zero-rows for tracked players who haven't attempted yet — resolved to the
  // REAL sheet name via the confirmed XI or the subs list (came on later), so
  // a raw bet label never renders as a player name. One tracked entry can name
  // SEVERAL players (a parlay label with five player legs), so collect EVERY
  // sheet hit per entry — resolving just the first pins one player and
  // silently drops the rest of the slip.
  const have = (name: string) => rows.some((r) => nameMatch(r.player, name));
  for (const t of tracked) {
    const hits: { team: "home" | "away"; name: string }[] = [];
    for (const side of ["home", "away"] as const)
      for (const p of lm.lineups?.[side]?.players ?? [])
        if (nameMatch(t, p.name)) hits.push({ team: side, name: p.name });
    if (hits.length === 0)
      for (const s of subs ?? [])
        if (s.on && nameMatch(t, s.on)) hits.push({ team: s.team, name: s.on });
    for (const hit of hits) {
      // not on the sheet (yet) → no hit → nothing truthful to show
      if (have(hit.name)) continue; // already shooting / two labels on one player → one row
      rows.push({
        player: hit.name,
        line: { team: hit.team, shots: 0, sot: 0, off: 0, blocked: 0, goals: 0 },
        ...subMarks(subs, hit.name),
        tracked: true,
      });
    }
  }

  // Tracked lines first, then by shots desc, then on-target desc.
  return rows.sort(
    (a, b) =>
      Number(b.tracked ?? false) - Number(a.tracked ?? false) ||
      b.line.shots - a.line.shots ||
      b.line.sot - a.line.sot ||
      a.player.localeCompare(b.player),
  );
}

/** One player row — name (+ sub/injury markers) and the five ticking counts. */
function ShotRowLine({ row }: { row: ShotRow }) {
  const tone = row.line.team === "home" ? "text-acid" : "text-mint";
  return (
    <div
      className={`grid grid-cols-[1fr_repeat(5,2.1rem)] items-center gap-1 rounded-lg px-2 py-1.5 ${
        row.tracked ? "border border-acid-dim/40 bg-acid/[0.06]" : ""
      }`}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span className={`size-1.5 shrink-0 rounded-full ${row.line.team === "home" ? "bg-acid" : "bg-mint"}`} />
        <span className={`truncate text-[0.78rem] font-semibold ${row.tracked ? tone : "text-ink"}`}>
          {row.player}
        </span>
        {row.tracked && (
          <span className="shrink-0 rounded-full border border-acid-dim/50 px-1 font-mono text-[0.5rem] font-semibold uppercase tracking-wider text-acid">
            slip
          </span>
        )}
        {row.subbedOff != null && (
          <span
            className={`shrink-0 font-mono text-[0.58rem] ${row.injuredOff ? "text-rose" : "text-amber"}`}
            title={row.injuredOff ? "Subbed off injured" : "Subbed off"}
          >
            ⬇{row.subbedOff}&apos;{row.injuredOff ? " ✚" : ""}
          </span>
        )}
        {row.subbedOn != null && row.subbedOff == null && (
          <span className="shrink-0 font-mono text-[0.58rem] text-mint" title="Came on">
            ⬆{row.subbedOn}&apos;
          </span>
        )}
      </span>
      <AnimatedNum value={row.line.shots} className="tnum text-center font-mono text-[0.78rem] font-bold text-ink" />
      <AnimatedNum value={row.line.sot} className="tnum text-center font-mono text-[0.78rem] font-semibold text-acid" />
      <AnimatedNum value={row.line.off} className="tnum text-center font-mono text-[0.78rem] text-muted" />
      <AnimatedNum value={row.line.blocked} className="tnum text-center font-mono text-[0.78rem] text-muted" />
      <AnimatedNum value={row.line.goals} className="tnum text-center font-mono text-[0.78rem] font-semibold text-amber" />
    </div>
  );
}

/** Column header shared by the board wherever it renders. */
function ShotBoardHead() {
  return (
    <div className="grid grid-cols-[1fr_repeat(5,2.1rem)] gap-1 px-2 font-mono text-[0.54rem] uppercase tracking-[0.14em] text-faint">
      <span>Player</span>
      <span className="text-center">Sh</span>
      <span className="text-center">On</span>
      <span className="text-center">Off</span>
      <span className="text-center">Blk</span>
      <span className="text-center">⚽</span>
    </div>
  );
}

/** Shared board body — rows only (caller provides the card + heading). */
export function ShotRowsBlock({ rows }: { rows: ShotRow[] }) {
  return (
    <div className="space-y-0.5">
      <ShotBoardHead />
      {rows.map((r) => (
        <ShotRowLine key={r.player} row={r} />
      ))}
    </div>
  );
}

/**
 * Per-player shots board for the match-detail page. Every shooter's live line —
 * the exact tallies "Player Over X shots / shots on target" legs settle on —
 * with sub markers (⬇ off / ⬆ on, injury in rose). Appears once anyone has an
 * attempt (or a tracked player is on the sheet); every number ticks per poll.
 */
export function PlayerShotsBoard({ matchId, trackedNames }: { matchId: string; trackedNames?: string[] }) {
  const lm = useLiveMatch(matchId);
  if (!lm || lm.state === "scheduled") return null;
  const rows = buildShotRows(lm, trackedNames ?? []);
  if (rows.length === 0) return null;
  return (
    <div className="mt-6 rounded-2xl border border-line bg-card/50 p-5">
      <h3 className="mb-3 font-mono text-[0.7rem] uppercase tracking-[0.22em] text-faint">
        Player shots {lm.state === "finished" ? "(full time)" : "(live)"} · settles the shots props
      </h3>
      <ShotRowsBlock rows={rows} />
      <p className="mt-3 border-t border-line/50 pt-2 font-mono text-[0.56rem] uppercase tracking-[0.14em] text-ink/35">
        Sh total · On target (goals count) · Off target · Blocked · Goals
        {lm.state !== "finished" ? " · ticks live every 5s" : ""} · ⬇ subbed off · ✚ injury
      </p>
    </div>
  );
}

/** Substitution log — who came on / went off, minute, injury flag. */
export function SubsLog({ matchId }: { matchId: string }) {
  const lm = useLiveMatch(matchId);
  const subs = lm?.stats?.subs;
  if (!lm || lm.state === "scheduled" || !subs || subs.length === 0) return null;
  return (
    <div className="mt-6 rounded-2xl border border-line bg-card/50 p-5">
      <h3 className="mb-3 font-mono text-[0.7rem] uppercase tracking-[0.22em] text-faint">
        Substitutions {lm.state === "finished" ? "(full time)" : "(live)"}
      </h3>
      <ul className="space-y-2">
        {subs.map((s, i) => (
          <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
            <span className="tnum w-9 shrink-0 font-mono text-faint">
              {s.minute != null ? `${s.minute}'` : "—"}
            </span>
            <span className={`size-2 shrink-0 rounded-full ${s.team === "home" ? "bg-acid" : "bg-mint"}`} />
            <span className="font-semibold text-ink">⬆ {s.on}</span>
            <span className="text-muted">⬇ {s.off}</span>
            {s.injury && (
              <span className="rounded-full border border-rose/40 bg-rose/10 px-1.5 py-0.5 font-mono text-[0.56rem] font-semibold uppercase tracking-wider text-rose">
                injury
              </span>
            )}
          </li>
        ))}
      </ul>
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
