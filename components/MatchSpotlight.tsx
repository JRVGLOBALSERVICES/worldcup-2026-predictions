"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { LiveMatch } from "@/lib/live";
import { fixtures } from "@/lib/data";
import { diffLiveEvents, type LiveEvent, type LiveEventKind } from "@/lib/liveEvents";

/**
 * The match-FX section — the tracker's live centrepiece. It always fronts ONE
 * match:
 *   • no game on yet → the next fixture with a live countdown ticking to kick-off
 *     (days / hours / mins / secs), the two sides, venue + MYT time. On your slip
 *     matches carry a tag.
 *   • the moment it starts → the same card flips to LIVE: big scoreline, match
 *     minute, a verified stats grid (possession / shots / SOT / corners / fouls /
 *     cards straight off ESPN's summary), and a rolling inline feed of what's
 *     happening (goals, shots on target, corners, cards, whistles) diffed off
 *     the /api/live poll — the same deltas that drive the full-screen
 *     firecracker FX, kept here as a persistent play-by-play.
 * Fixtures are static, so kickoff picking is deterministic; the live half reads
 * the poll map the tracker already holds. Countdown digits render only after
 * mount so SSR and client agree (no hydration drift on the clock).
 */

// Sorted once — fixtures never change at runtime.
const BY_KICKOFF = [...fixtures].sort(
  (a, b) => new Date(a.kickoffUTC).getTime() - new Date(b.kickoffUTC).getTime(),
);

const teamCode = (name: string) => name.replace(/[^a-z]/gi, "").slice(0, 3).toUpperCase();

const mytTime = (utc: string) =>
  new Date(utc).toLocaleString("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

/** Presentational vocabulary for the inline feed. Mirrors LiveFX's chip set but
 *  self-contained (no cross-import coupling); goals get the headline treatment. */
const FEED: Record<LiveEventKind, { glyph: string; label: string }> = {
  goal: { glyph: "⚽", label: "Goal" },
  sot: { glyph: "🎯", label: "Shot on target" },
  shotOff: { glyph: "💨", label: "Shot off target" },
  blocked: { glyph: "🧱", label: "Shot blocked" },
  save: { glyph: "🧤", label: "Save" },
  corner: { glyph: "🚩", label: "Corner" },
  yellow: { glyph: "🟨", label: "Yellow card" },
  red: { glyph: "🟥", label: "Red card" },
  foul: { glyph: "❗", label: "Foul" },
  offside: { glyph: "🚫", label: "Offside" },
  possession: { glyph: "📈", label: "Possession swing" },
  kickoff: { glyph: "▶", label: "Kick-off" },
  halftime: { glyph: "⏸", label: "Half-time" },
  fulltime: { glyph: "🏁", label: "Full time" },
};

type FeedRow = { id: number; ev: LiveEvent };
let feedId = 1;

function countdownParts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return {
    d: Math.floor(s / 86400),
    h: Math.floor((s % 86400) / 3600),
    m: Math.floor((s % 3600) / 60),
    s: s % 60,
  };
}

function Seg({ value, label, dim }: { value: number; label: string; dim?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className={`grid min-w-[2.9rem] place-items-center rounded-xl border px-2.5 py-2.5 font-display text-[1.7rem] font-black leading-none tnum sm:min-w-[3.4rem] sm:text-[2.15rem] ${
          dim
            ? "border-line bg-card/40 text-faint/50"
            : "border-acid-dim/40 bg-acid/[0.07] text-ink shadow-[inset_0_0_20px_-10px_var(--color-acid)]"
        }`}
      >
        {String(value).padStart(2, "0")}
      </div>
      <span className="font-mono text-[0.52rem] font-semibold uppercase tracking-[0.18em] text-faint/60">
        {label}
      </span>
    </div>
  );
}

/** The team-vs-team title row, shared by both modes. */
function Versus({
  home,
  away,
  score,
  live,
}: {
  home: { name: string; flag: string };
  away: { name: string; flag: string };
  score?: { home: number; away: number };
  live?: boolean;
}) {
  return (
    <div className="flex items-center justify-center gap-3 sm:gap-5">
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2.5 text-right">
        <div className="min-w-0">
          <p className="tnum font-display text-lg font-black uppercase leading-none tracking-tight text-ink sm:text-xl">
            {teamCode(home.name)}
          </p>
          <p className="mt-1 truncate font-mono text-[0.6rem] uppercase tracking-wider text-faint/60">{home.name}</p>
        </div>
        <span aria-hidden className="text-[1.65rem] leading-none sm:text-[2rem]">{home.flag}</span>
      </div>

      {score ? (
        <div className={`tnum shrink-0 font-display text-[2.1rem] font-black leading-none sm:text-[2.6rem] ${live ? "text-ink" : "text-muted"}`}>
          {score.home}
          <span className="px-1.5 text-xl font-semibold text-faint/50 sm:px-2 sm:text-2xl">–</span>
          {score.away}
        </div>
      ) : (
        <span className="shrink-0 font-mono text-[0.62rem] font-semibold uppercase tracking-[0.24em] text-faint/50">
          vs
        </span>
      )}

      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <span aria-hidden className="text-[1.65rem] leading-none sm:text-[2rem]">{away.flag}</span>
        <div className="min-w-0">
          <p className="tnum font-display text-lg font-black uppercase leading-none tracking-tight text-ink sm:text-xl">
            {teamCode(away.name)}
          </p>
          <p className="mt-1 truncate font-mono text-[0.6rem] uppercase tracking-wider text-faint/60">{away.name}</p>
        </div>
      </div>
    </div>
  );
}

/** One mirrored stat row for the spotlight — bars grow toward the centre label,
 *  home in acid on the left, away in mint on the right. Transform-only motion
 *  (scaleX) so each 5s poll eases the bars without layout work. */
function SpotStatRow({ label, h, a }: { label: string; h: number; a: number }) {
  const max = Math.max(h, a, 1);
  return (
    <div className="grid grid-cols-[2rem_1fr_minmax(5rem,auto)_1fr_2rem] items-center gap-2">
      <span className="tnum text-right font-mono text-[0.74rem] font-semibold text-acid">{h}</span>
      <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]">
        <span
          className="block h-full origin-right rounded-full bg-acid transition-transform duration-700 ease-out"
          style={{ transform: `scaleX(${h / max})` }}
        />
      </div>
      <span className="text-center font-mono text-[0.56rem] uppercase tracking-[0.14em] text-faint/70">{label}</span>
      <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]">
        <span
          className="block h-full origin-left rounded-full bg-mint/80 transition-transform duration-700 ease-out"
          style={{ transform: `scaleX(${a / max})` }}
        />
      </div>
      <span className="tnum font-mono text-[0.74rem] font-semibold text-mint">{a}</span>
    </div>
  );
}

/** Live stats block for the spotlight — the settling counts (shots / SOT /
 *  corners / fouls / cards) plus a possession strip when ESPN's summary carries
 *  tempo. Reads the LiveMatch the tracker already polls (no provider needed —
 *  the tracker isn't wrapped in LiveProvider, so no useLiveMatch here). Renders
 *  nothing until the summary endpoint has verified numbers. */
function SpotStats({ lm }: { lm: LiveMatch }) {
  const s = lm.stats;
  if (!s) return null;
  const t = s.tempo;
  const hasPossession = t && (t.possession.home > 0 || t.possession.away > 0);
  const posTotal = hasPossession ? t.possession.home + t.possession.away || 1 : 1;
  return (
    <div className="mt-4 border-t border-white/[0.07] pt-4">
      {hasPossession && (
        <div className="mb-3">
          <div className="mb-1 flex items-baseline justify-between font-mono text-[0.58rem] uppercase tracking-[0.16em]">
            <span className="tnum text-[0.72rem] font-semibold text-acid">{Math.round(t.possession.home)}</span>
            <span className="text-faint/60">Possession %</span>
            <span className="tnum text-[0.72rem] font-semibold text-mint">{Math.round(t.possession.away)}</span>
          </div>
          <div className="relative h-1.5 overflow-hidden rounded-full bg-mint/70">
            <span
              className="absolute inset-0 origin-left rounded-full bg-acid transition-transform duration-700 ease-out"
              style={{ transform: `scaleX(${t.possession.home / posTotal})` }}
            />
          </div>
        </div>
      )}
      <div className="space-y-2">
        <SpotStatRow label="Shots" h={s.shots.home} a={s.shots.away} />
        <SpotStatRow label="On target" h={s.sot.home} a={s.sot.away} />
        <SpotStatRow label="Corners" h={s.corners.home} a={s.corners.away} />
        {s.fouls && <SpotStatRow label="Fouls" h={s.fouls.home} a={s.fouls.away} />}
        {t && <SpotStatRow label="Offsides" h={t.offsides.home} a={t.offsides.away} />}
        <SpotStatRow label="Cards" h={s.cards.home} a={s.cards.away} />
      </div>
      <p className="mt-2.5 text-center font-mono text-[0.52rem] uppercase tracking-[0.14em] text-faint/40">
        Verified vs ESPN · ticks live every 5s
      </p>
    </div>
  );
}

/** Rolling inline play-by-play for the live match. Diffs each poll and keeps the
 *  last ~7 happenings, newest on top, so the section reads what's going on even
 *  between the transient full-screen bursts. */
function LiveFeed({ lm, home, away }: { lm: LiveMatch; home: { flag: string; name: string }; away: { flag: string; name: string } }) {
  const [rows, setRows] = useState<FeedRow[]>([]);
  const prev = useRef<LiveMatch | undefined>(undefined);
  const seededFor = useRef<string | null>(null);

  useEffect(() => {
    // New match in the spotlight → reset the log and reseed the baseline so we
    // don't replay an hour of history as one burst on first sight.
    if (seededFor.current !== lm.matchId) {
      seededFor.current = lm.matchId;
      prev.current = undefined;
      setRows([]);
    }
    const evs = diffLiveEvents(prev.current, lm);
    prev.current = lm;
    if (evs.length) {
      const fresh = evs.map((ev) => ({ id: feedId++, ev }));
      setRows((cur) => [...fresh.reverse(), ...cur].slice(0, 7));
    }
  }, [lm]);

  if (rows.length === 0) {
    return (
      <p className="mt-4 border-t border-white/[0.07] pt-4 text-center font-mono text-[0.66rem] uppercase tracking-[0.16em] text-faint/50">
        Watching the feed · events appear here as they happen
      </p>
    );
  }

  return (
    <ul className="mt-4 space-y-1.5 border-t border-white/[0.07] pt-4">
      {rows.map((r) => {
        const meta = FEED[r.ev.kind];
        const isGoal = r.ev.kind === "goal";
        const flag = r.ev.team === "home" ? home.flag : r.ev.team === "away" ? away.flag : "";
        const side = r.ev.team === "home" ? home.name : r.ev.team === "away" ? away.name : "";
        const detail =
          r.ev.kind === "possession" && r.ev.value != null
            ? `${side} ${r.ev.value}%`
            : [r.ev.player ?? side, r.ev.minute != null ? `${r.ev.minute}'` : ""].filter(Boolean).join(" · ");
        return (
          <li
            key={r.id}
            className={`chip-in flex items-center gap-2.5 rounded-lg px-3 py-2 ${
              isGoal ? "border border-acid-dim/40 bg-acid/[0.08]" : "bg-white/[0.025]"
            }`}
          >
            <span className="text-sm leading-none">{meta.glyph}</span>
            {flag && <span aria-hidden className="text-sm leading-none">{flag}</span>}
            <span className={`font-mono text-[0.68rem] font-semibold uppercase tracking-wider ${isGoal ? "text-acid" : "text-ink"}`}>
              {meta.label}
            </span>
            {detail && <span className="ml-auto truncate font-mono text-[0.64rem] text-faint/70">{detail}</span>}
          </li>
        );
      })}
    </ul>
  );
}

export default function MatchSpotlight({
  live,
  betMatchIds,
}: {
  live: Record<string, LiveMatch | undefined>;
  betMatchIds?: Set<string>;
}) {
  const [mounted, setMounted] = useState(false);
  const [nowMs, setNowMs] = useState(0);

  useEffect(() => {
    setMounted(true);
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // A live/half-time game wins the spotlight; pick the hottest (most goals, then
  // furthest along). Otherwise the soonest fixture that hasn't finished — which,
  // once its clock passes kickoff, sits in a "kicking off" limbo until the feed
  // flips it live.
  const liveOnes = useMemo(
    () =>
      Object.values(live)
        .filter((m): m is LiveMatch => !!m && (m.state === "live" || m.state === "halftime"))
        .sort((a, b) => b.score.home + b.score.away - (a.score.home + a.score.away) || (b.minute ?? 0) - (a.minute ?? 0)),
    [live],
  );
  const spotlightLive = liveOnes[0];

  const upcoming = useMemo(() => {
    if (spotlightLive) return null;
    return (
      BY_KICKOFF.find((f) => {
        const st = live[f.id]?.state;
        if (st === "finished" || st === "live" || st === "halftime") return false;
        // 20-min grace so a just-kicked match still fronts here (as "kicking off")
        // until ESPN marks it live, instead of jumping to the next fixture.
        return new Date(f.kickoffUTC).getTime() > nowMs - 20 * 60 * 1000;
      }) ?? null
    );
  }, [spotlightLive, live, nowMs]);

  // Nothing live and nothing ahead (tournament done / no data) → render nothing.
  if (!spotlightLive && !upcoming) return null;

  // ── LIVE MODE ──────────────────────────────────────────────────────────────
  if (spotlightLive) {
    const fx = fixtures.find((f) => f.id === spotlightLive.matchId);
    if (!fx) return null;
    const onSlip = betMatchIds?.has(spotlightLive.matchId);
    const st = spotlightLive.state;
    const statusLabel =
      st === "halftime" ? "Half-time" : spotlightLive.minute != null ? `${spotlightLive.minute}'` : spotlightLive.statusDetail || "Live";
    return (
      <section className="relative overflow-hidden rounded-3xl border border-amber/30 bg-pitch-2/60 p-5 shadow-[inset_0_0_60px_-30px_var(--color-amber)] sm:p-7">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2 rounded-full bg-amber/15 px-2.5 py-0.5 font-mono text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-amber">
            <span className="size-1.5 animate-pulse rounded-full bg-amber motion-reduce:animate-none" />
            Live · {statusLabel}
          </span>
          <div className="flex items-center gap-2">
            {liveOnes.length > 1 && (
              <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[0.56rem] uppercase tracking-wider text-faint/70">
                +{liveOnes.length - 1} more live
              </span>
            )}
            {onSlip && (
              <span className="rounded-full border border-acid-dim/50 bg-acid/10 px-2 py-0.5 font-mono text-[0.56rem] font-semibold uppercase tracking-wider text-acid">
                On your slip
              </span>
            )}
          </div>
        </div>

        <Versus home={fx.home} away={fx.away} score={spotlightLive.score} live />

        <p className="mt-4 text-center font-mono text-[0.6rem] uppercase tracking-[0.16em] text-faint/55">
          {fx.round ?? `Group ${fx.group}`} · {fx.venue}, {fx.city}
        </p>

        <SpotStats lm={spotlightLive} />

        <LiveFeed lm={spotlightLive} home={fx.home} away={fx.away} />
      </section>
    );
  }

  // ── COUNTDOWN MODE ─────────────────────────────────────────────────────────
  const fx = upcoming!;
  const ko = new Date(fx.kickoffUTC).getTime();
  const remaining = ko - nowMs;
  const kickingOff = mounted && remaining <= 0;
  const c = countdownParts(remaining);
  const onSlip = betMatchIds?.has(fx.id);

  return (
    <section className="relative overflow-hidden rounded-3xl border border-line bg-pitch-2/50 p-5 sm:p-7">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 font-mono text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-acid">
          <span className="size-1.5 rounded-full bg-acid shadow-[0_0_10px_var(--color-acid)]" />
          Next up · {fx.round ?? `Group ${fx.group}`}
        </span>
        {onSlip && (
          <span className="rounded-full border border-acid-dim/50 bg-acid/10 px-2 py-0.5 font-mono text-[0.56rem] font-semibold uppercase tracking-wider text-acid">
            On your slip
          </span>
        )}
      </div>

      <Versus home={fx.home} away={fx.away} />

      <div className="mt-6 flex flex-col items-center gap-4 sm:flex-row sm:justify-center sm:gap-8">
        {kickingOff ? (
          <p className="inline-flex items-center gap-2.5 rounded-2xl border border-amber/40 bg-amber/10 px-6 py-4 font-display text-xl font-black uppercase tracking-tight text-amber sm:text-2xl">
            <span className="size-2 animate-pulse rounded-full bg-amber motion-reduce:animate-none" />
            Kicking off…
          </p>
        ) : (
          <div className="flex items-end gap-2 sm:gap-3">
            {(mounted ? c.d : 0) > 0 && <Seg value={mounted ? c.d : 0} label="days" />}
            <Seg value={mounted ? c.h : 0} label="hrs" dim={!mounted} />
            <Seg value={mounted ? c.m : 0} label="min" dim={!mounted} />
            <Seg value={mounted ? c.s : 0} label="sec" dim={!mounted} />
          </div>
        )}

        <div className="text-center sm:text-left">
          <p className="font-mono text-[0.56rem] uppercase tracking-[0.18em] text-faint/55">Kicks off</p>
          <p className="mt-1 font-mono text-[0.8rem] font-semibold tracking-wide text-ink tnum">{mytTime(fx.kickoffUTC)} MYT</p>
          <p className="mt-0.5 font-mono text-[0.62rem] text-faint/60">{fx.venue}, {fx.city}</p>
        </div>
      </div>

      <p className="mt-5 border-t border-white/[0.06] pt-3.5 text-center font-mono text-[0.58rem] uppercase tracking-[0.14em] text-faint/45">
        The moment it kicks off, this section goes live — score, full match stats (shots, corners, fouls, cards, possession) and every event as it happens.{" "}
        <Link href={`/match/${fx.id}`} className="text-acid/70 underline-offset-2 hover:underline">
          Match preview →
        </Link>
      </p>
    </section>
  );
}
