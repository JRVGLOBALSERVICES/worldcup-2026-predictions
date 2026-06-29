"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { LiveMatch } from "@/lib/live";
import type { BetStatus, SpecialGrade } from "@/lib/bets";
import { inPlayBet, inPlaySpecial, inPlayMultiScorers, inPlayMultiLeg, liveLeans, type InPlay, type LiveVerdict } from "@/lib/inplay";
import { RefreshCountdown, ForceRefreshButton } from "./RefreshCountdown";
import { SiteNav, type NavKey } from "./SiteNav";

// ── serialisable payload the server page hands down (no functions/classes) ────
export type BetRow = {
  id: string;
  period: "HT" | "FT";
  label: string;
  home: number;
  away: number;
  odds: number;
  stake: number;
  potential: number;
  staticStatus: BetStatus;
};
export type SpecialRow = {
  id: string;
  market: string;
  label: string;
  slipNo: string;
  placedAt: string;
  odds: number;
  stake: number;
  potential: number;
  staticStatus: BetStatus;
  grade?: SpecialGrade;
  statusOverride?: BetStatus;
  // Whose bet this is (collection tag). Shown as an amber pill on the card so
  // it's clear who to collect from / pay out. Absent = Rj's own.
  punter?: string;
  // True when this row is a display mirror of a cross-match acca shown on another
  // card. Renders for visibility but is excluded from all stake/return/count sums.
  mirror?: boolean;
};
export type MatchRow = {
  matchId: string;
  home: { name: string; flag: string; code: string };
  away: { name: string; flag: string; code: string };
  group: string;
  round?: string;
  kickoffUTC: string;
  kickoffLabel: string; // "21:00 MYT (9:00 PM ET)"
  staticResult: { ht: { home: number; away: number } | null; ft: { home: number; away: number } | null };
  form?: {
    home: { line: string; record: { w: number; d: number; l: number } };
    away: { line: string; record: { w: number; d: number; l: number } };
  };
  bets: BetRow[];
  specials: SpecialRow[];
};
export type DayRow = { key: string; label: string; matches: MatchRow[]; isFeatured?: boolean };
export type TrackerBase = {
  meta: { owner: string; currency: string; note: string; disclaimer: string; placedLabel: string };
  counts: { score: number; props: number };
  staked: number;
  potential: number;
  season: { counts: { score: number; props: number }; staked: number; potential: number };
  featuredKey: string;
  days: DayRow[];
};

// ─────────────────────────────────────────────────────────────────────────────
function money(n: number, currency: string) {
  return `${currency}${n.toFixed(2)}`;
}

/** A special is an "acca" when it carries a multi-leg grade; a "parlay" is the
 *  subset with 2+ legs (the kind that gets mirrored across game cards). A lone
 *  1-leg acca (e.g. a single correct-score dressed as multiLeg) stays in its
 *  game card. `mirror` copies are display dupes and never count as the source. */
function isAccaRow(r: SpecialRow): boolean {
  return !!r.grade && "legs" in r.grade && Array.isArray((r.grade as { legs?: unknown[] }).legs);
}
function isParlayRow(r: SpecialRow): boolean {
  return !r.mirror && isAccaRow(r) && ((r.grade as { legs: unknown[] }).legs.length >= 2);
}

/** Static fallback when no live feed exists — read the cron-filled JSON status. */
function fromStatic(s: BetStatus): InPlay {
  if (s === "won") return { verdict: "won", note: "Won" };
  if (s === "lost") return { verdict: "lost", note: "Lost" };
  if (s === "void") return { verdict: "void", note: "Refunded — stake returned" };
  return { verdict: "scheduled", note: "Awaiting result" };
}
function gradeBet(b: BetRow, lm: LiveMatch | undefined): InPlay {
  return lm ? inPlayBet(b, lm) : fromStatic(b.staticStatus);
}
function gradeSpecial(
  s: SpecialRow,
  lm: LiveMatch | undefined,
  live: Record<string, LiveMatch | undefined>,
): InPlay {
  // Cross-match accumulator needs the WHOLE live map (one match per leg), not the
  // single match this special is bucketed under.
  if (s.grade?.type === "multiScorers") return inPlayMultiScorers(s.grade.legs, live, s.statusOverride);
  if (s.grade?.type === "multiLeg") return inPlayMultiLeg(s.grade.legs, live, s.statusOverride);
  return lm ? inPlaySpecial(s, lm) : fromStatic(s.staticStatus);
}

// Poll cadence: fast while a match is on or about to be, idle otherwise.
function nearLiveWindow(days: DayRow[], nowMs: number): boolean {
  return days.some((d) =>
    d.matches.some((m) => {
      const ko = new Date(m.kickoffUTC).getTime();
      return nowMs >= ko - 15 * 60 * 1000 && nowMs <= ko + 3 * 60 * 60 * 1000;
    }),
  );
}

type LivePayload = { updatedAt: number; anyLive: boolean; matches: Record<string, LiveMatch> };

function useLive(base: TrackerBase) {
  const [live, setLive] = useState<Record<string, LiveMatch>>({});
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [pollFast, setPollFast] = useState(false);
  const [nextRefreshAt, setNextRefreshAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelled = useRef(false);
  const inFlight = useRef(false);

  // One fetch + reschedule, shared by the auto-poller and the force-update
  // button. Held in a ref and assigned in an effect (commit phase, never during
  // render) so it always closes over the latest `base.days`. `manual` flips the
  // spinner — it just runs the same tick now, which is what makes the button
  // work after the poller has idled.
  const tick = useRef<(manual?: boolean) => Promise<void>>(async () => {});
  useEffect(() => {
    tick.current = async (manual = false) => {
      if (inFlight.current) return; // never overlap fetches
      inFlight.current = true;
      if (manual) setRefreshing(true);
      let anyLive = false;
      try {
        const res = await fetch("/api/live", { cache: "no-store" });
        if (res.ok) {
          const data: LivePayload = await res.json();
          if (!cancelled.current) {
            setLive(data.matches ?? {});
            setUpdatedAt(data.updatedAt ?? Date.now());
            anyLive = !!data.anyLive;
          }
        }
      } catch {
        /* keep last known; try again next tick */
      } finally {
        inFlight.current = false;
        if (manual) setRefreshing(false);
      }
      if (cancelled.current) return;
      const near = nearLiveWindow(base.days, Date.now());
      const fast = anyLive || near;
      setPollFast(fast);
      // Stop entirely once nothing is live and nothing is near (saves the idle heartbeat).
      const delay = fast ? 5000 : near ? 30000 : 0;
      if (timer.current) clearTimeout(timer.current);
      if (delay > 0) {
        setNextRefreshAt(Date.now() + delay);
        timer.current = setTimeout(() => tick.current(), delay);
      } else {
        setNextRefreshAt(null);
      }
    };
  });

  useEffect(() => {
    cancelled.current = false;
    tick.current();
    return () => {
      cancelled.current = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [base.days]);

  // Manual pull: cancel the pending tick and fetch right now.
  const refresh = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    tick.current(true);
  }, []);

  return { live, updatedAt, pollFast, nextRefreshAt, refreshing, refresh };
}

// ── pills ─────────────────────────────────────────────────────────────────────
function VerdictPill({ verdict }: { verdict: LiveVerdict }) {
  const map: Record<LiveVerdict, { label: string; cls: string; dot: string; pulse?: boolean }> = {
    won: { label: "Won", cls: "bg-acid/15 text-acid", dot: "bg-acid" },
    lost: { label: "Lost", cls: "bg-rose/15 text-rose", dot: "bg-rose" },
    winning: { label: "Winning now", cls: "bg-acid/15 text-acid", dot: "bg-acid", pulse: true },
    alive: { label: "Still on", cls: "bg-amber/15 text-amber", dot: "bg-amber", pulse: true },
    dead: { label: "Can't win now", cls: "bg-rose/10 text-rose", dot: "bg-rose" },
    void: { label: "Refunded", cls: "bg-amber/15 text-amber", dot: "bg-amber" },
    scheduled: { label: "Not started", cls: "border border-line text-faint", dot: "bg-faint" },
  };
  const s = map[verdict];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[0.62rem] font-semibold uppercase tracking-wider ${s.cls}`}
    >
      <span className={`size-1.5 rounded-full ${s.dot} ${s.pulse ? "animate-pulse motion-reduce:animate-none" : ""}`} /> {s.label}
    </span>
  );
}

function LiveBadge({ live }: { live: LiveMatch | undefined }) {
  if (!live) return null;
  if (live.state === "live")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber/15 px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-wider text-amber">
        <span className="size-1.5 animate-pulse rounded-full bg-amber motion-reduce:animate-none" /> {live.statusDetail}
      </span>
    );
  if (live.state === "halftime")
    return (
      <span className="rounded-full bg-mint/15 px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-wider text-mint">
        Half-time
      </span>
    );
  if (live.state === "finished")
    return (
      <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-wider text-faint">
        Full-time
      </span>
    );
  return (
    <span className="rounded-full border border-acid-dim px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-wider text-acid">
      Upcoming
    </span>
  );
}

/** Compact last-10 form: team code, W/D/L dots (newest-first), W-D-L record. */
function FormStrip({ code, f }: { code: string; f: { line: string; record: { w: number; d: number; l: number } } }) {
  const dots = f.line.replace(/[^WDL]/gi, "").toUpperCase().slice(0, 10).split("");
  const cls: Record<string, string> = { W: "bg-acid", D: "bg-faint", L: "bg-rose" };
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono text-[0.62rem] font-semibold uppercase tracking-wider text-muted">{code}</span>
      <span className="inline-flex items-center gap-[2px]" title={`${f.line} · ${f.record.w}W ${f.record.d}D ${f.record.l}L`}>
        {dots.map((c, i) => (
          <span key={i} className={`size-1.5 rounded-full ${cls[c] ?? "bg-line"}`} />
        ))}
      </span>
      <span className="tnum font-mono text-[0.6rem] text-faint">
        {f.record.w}-{f.record.d}-{f.record.l}
      </span>
    </span>
  );
}

function LiveScore({ live, m }: { live: LiveMatch | undefined; m: MatchRow }) {
  // Prefer the live scoreline; fall back to the static FT/HT result from bets.json.
  const cur = live?.score ?? m.staticResult.ft ?? m.staticResult.ht;
  if (!cur) return <span className="font-mono text-sm text-faint">vs</span>;
  const hot = live && (live.state === "live" || live.state === "halftime");
  return (
    <span className={`tnum font-mono text-lg font-bold ${hot ? "text-ink" : "text-muted"}`}>
      {cur.home}<span className="px-1 text-faint">–</span>{cur.away}
    </span>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = "ink",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "ink" | "acid" | "rose" | "muted" | "amber";
}) {
  const toneMap = { ink: "text-ink", acid: "text-acid", rose: "text-rose", muted: "text-muted", amber: "text-amber" } as const;
  return (
    <div className="rounded-2xl border border-line bg-pitch/55 px-5 py-4">
      <p className="font-mono text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-faint/55">{label}</p>
      <p className={`tnum mt-2 font-mono text-[1.7rem] font-bold leading-none tracking-tight ${toneMap[tone]}`}>{value}</p>
      {sub && <p className="mt-1.5 text-[0.72rem] leading-snug text-faint/55">{sub}</p>}
    </div>
  );
}

/** Per-leg live status parsed from the acca grader's note string (`label ✓/✗/⋯/—`).
 *  Reuses the exact verdicts lib/inplay produces, so the grid never disagrees with
 *  settlement. Returns null when the note carries no leg parts (confirmed override). */
function parseLegs(note: string): { label: string; glyph: string }[] | null {
  if (!note) return null;
  const parts = note.split(" · ").map((p) => p.trim()).filter(Boolean);
  const legs = parts.map((p) => {
    const i = p.lastIndexOf(" ");
    const glyph = i >= 0 ? p.slice(i + 1) : "";
    const label = i >= 0 ? p.slice(0, i) : p;
    return { label, glyph };
  });
  // Only treat as a leg grid when every part ends in a known status glyph.
  const known = new Set(["✓", "✗", "⋯", "—"]);
  return legs.every((l) => known.has(l.glyph)) && legs.length > 0 ? legs : null;
}

const LEG_GLYPH: Record<string, { cls: string; dot: string; pulse?: boolean }> = {
  "✓": { cls: "text-acid", dot: "bg-acid" },
  "✗": { cls: "text-rose", dot: "bg-rose" },
  "⋯": { cls: "text-acid", dot: "bg-acid", pulse: true },
  "—": { cls: "text-faint/60", dot: "bg-faint/40" },
};

/** Collection tag — whose bet this slip is, so it's clear who to collect from /
 *  pay out. Amber to read as "money / collect", distinct from the green+orange
 *  verdict accents. */
function PunterTag({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber/40 bg-amber/10 px-2 py-0.5 font-mono text-[0.56rem] font-semibold uppercase tracking-wider text-amber">
      <span className="size-1.5 rounded-full bg-amber" />
      {name}
    </span>
  );
}

/** Accumulator card — the slip-card leg grid, live-graded. One per non-mirror acca. */
function AccaCard({
  special,
  verdict,
  currency,
}: {
  special: SpecialRow;
  verdict: InPlay;
  currency: string;
}) {
  const legs = parseLegs(verdict.note);
  const legCount = special.grade && "legs" in special.grade ? special.grade.legs.length : legs?.length ?? 0;
  return (
    <div className="rounded-2xl border border-line bg-pitch-2/50 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex items-center gap-2.5">
          <span className="rounded-full border border-acid-dim/50 bg-acid/10 px-2.5 py-0.5 font-mono text-[0.56rem] font-semibold uppercase tracking-wider text-acid">
            {legCount} legs
          </span>
          <span className="text-sm font-semibold text-ink">{special.market}</span>
          {special.punter && <PunterTag name={special.punter} />}
        </div>
        <div className="flex items-center gap-3">
          <span className="tnum font-mono text-[0.7rem] text-faint/70">
            @{special.odds.toFixed(2)} · {money(special.stake, currency)} →{" "}
            <span className="font-semibold text-acid">{money(special.potential, currency)}</span>
          </span>
          <VerdictPill verdict={verdict.verdict} />
        </div>
      </div>
      {legs ? (
        <ul className="mt-3.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {legs.map((l, i) => {
            const g = LEG_GLYPH[l.glyph] ?? LEG_GLYPH["—"];
            return (
              <li
                key={i}
                className="flex items-center gap-2.5 rounded-lg border border-line/70 bg-card/40 px-3 py-2"
              >
                <span className={`size-1.5 shrink-0 rounded-full ${g.dot} ${g.pulse ? "animate-pulse motion-reduce:animate-none" : ""}`} />
                <span className="min-w-0 flex-1 truncate text-[0.8rem] text-ink">{l.label}</span>
                <span className={`shrink-0 font-mono text-xs font-bold ${g.cls}`}>{l.glyph}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        verdict.note && <p className="mt-3 font-mono text-[0.7rem] text-faint/70">{verdict.note}</p>
      )}
    </div>
  );
}

/** Whole-slate parlay roll-up. EVERY multi-leg acca across all days is shown ONCE
 *  here, at the top of the tracker — not scattered per day by which day its first
 *  leg happens to fall on (the old behaviour, which split the R16 "to qualify"
 *  parlays across two days so only the 4 starting today were visible together).
 *  Still-running parlays (winning / still-on / not-started) lead; settled ones
 *  (won / lost / refunded) collapse into a togglable drawer below so the live
 *  picture isn't buried under concluded group-stage slips. */
function GlobalParlays({
  parlays,
  live,
  currency,
}: {
  parlays: { special: SpecialRow; anchorMatchId: string }[];
  live: Record<string, LiveMatch | undefined>;
  currency: string;
}) {
  const [showSettled, setShowSettled] = useState(false);
  if (parlays.length === 0) return null;
  const graded = parlays
    .map((p) => ({ ...p, verdict: gradeSpecial(p.special, live[p.anchorMatchId], live) }))
    .sort((a, b) => VERDICT_ORDER[a.verdict.verdict] - VERDICT_ORDER[b.verdict.verdict]);
  // Running = not yet decided: winning now, still mathematically on, or not kicked
  // off. Settled = the book is closed (won / refunded / can't-win / lost).
  const isRunning = (v: LiveVerdict) => v === "winning" || v === "alive" || v === "scheduled";
  const running = graded.filter((p) => isRunning(p.verdict.verdict));
  const settled = graded.filter((p) => !isRunning(p.verdict.verdict));
  const stake = parlays.reduce((s, p) => s + p.special.stake, 0);
  const secured = graded.reduce((s, p) => {
    if (p.verdict.verdict === "won") return s + p.special.potential;
    if (p.verdict.verdict === "void") return s + p.special.stake;
    return s;
  }, 0);
  const liveCount = graded.filter((p) => p.verdict.verdict === "winning" || p.verdict.verdict === "alive").length;
  const won = graded.filter((p) => p.verdict.verdict === "won").length;
  const lost = graded.filter((p) => p.verdict.verdict === "lost" || p.verdict.verdict === "dead").length;
  return (
    <section className="rounded-3xl border border-acid-dim/40 bg-pitch-2/40 p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line/60 pb-3.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="font-mono text-[0.66rem] uppercase tracking-[0.2em] text-acid">All parlays</span>
          <span className="rounded-full border border-acid-dim/50 bg-acid/10 px-2 py-0.5 font-mono text-[0.58rem] font-semibold uppercase tracking-wider text-acid">
            {graded.length}
          </span>
          {(liveCount > 0 || won > 0 || lost > 0) && (
            <span className="flex items-center gap-1.5 font-mono text-[0.62rem] uppercase tracking-wider">
              {liveCount > 0 && <span className="text-acid">{liveCount} live</span>}
              {won > 0 && <span className="text-acid">{won}W</span>}
              {lost > 0 && <span className="text-rose">{lost}L</span>}
            </span>
          )}
        </div>
        <span className="tnum font-mono text-[0.68rem] text-faint/70">
          {money(stake, currency)} staked
          {secured > 0 && <> · <span className="font-semibold text-acid">{money(secured, currency)} secured</span></>}
        </span>
      </div>

      {running.length > 0 ? (
        <div className="space-y-3">
          <p className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-faint/70">
            Running · {running.length}
          </p>
          {running.map((p) => (
            <AccaCard key={p.special.id} special={p.special} verdict={p.verdict} currency={currency} />
          ))}
        </div>
      ) : (
        <p className="font-mono text-[0.7rem] text-faint/70">No parlays still running — all settled below.</p>
      )}

      {settled.length > 0 && (
        <div className={running.length > 0 ? "mt-5 border-t border-line/60 pt-4" : "mt-1"}>
          <button
            type="button"
            onClick={() => setShowSettled((v) => !v)}
            aria-expanded={showSettled}
            className="flex w-full items-center justify-between gap-3 rounded-xl border border-line/70 bg-card/30 px-4 py-2.5 text-left transition-colors hover:border-line hover:bg-card/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acid/60"
          >
            <span className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-faint">
              Settled · {settled.length}
            </span>
            <span className="flex items-center gap-2.5 font-mono text-[0.62rem] uppercase tracking-wider">
              {won > 0 && <span className="text-acid">{won}W</span>}
              {lost > 0 && <span className="text-rose">{lost}L</span>}
              <span className="text-faint/70">{showSettled ? "Hide" : "Show"}</span>
            </span>
          </button>
          {showSettled && (
            <div className="mt-3 space-y-3">
              {settled.map((p) => (
                <AccaCard key={p.special.id} special={p.special} verdict={p.verdict} currency={currency} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** Single-leg player prop, carded to match AccaCard — so the props block reads
 *  as cards like accumulators, not the old flat row list. Uses the warm (mint→amber)
 *  accent family to stay distinct from the green accas. */
function PropCard({
  special,
  verdict,
  currency,
}: {
  special: SpecialRow;
  verdict: InPlay;
  currency: string;
}) {
  const dim = verdict.verdict === "lost" || verdict.verdict === "dead";
  return (
    <div className="rounded-2xl border border-line bg-pitch-2/50 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex items-center gap-2.5">
          <span className="rounded-full border border-mint/40 bg-mint/10 px-2.5 py-0.5 font-mono text-[0.56rem] font-semibold uppercase tracking-wider text-mint">
            {special.market}
          </span>
          {special.punter && <PunterTag name={special.punter} />}
        </div>
        <div className="flex items-center gap-3">
          <span className="tnum font-mono text-[0.7rem] text-faint/70">
            @{special.odds.toFixed(2)} · {money(special.stake, currency)} →{" "}
            <span className={`font-semibold ${verdict.verdict === "won" ? "text-acid" : dim ? "text-faint line-through" : "text-ink"}`}>
              {money(special.potential, currency)}
            </span>
          </span>
          <VerdictPill verdict={verdict.verdict} />
        </div>
      </div>
      <p className="mt-3 text-sm text-ink">{special.label}</p>
      {verdict.note && (
        <p className="mt-2 font-mono text-[0.66rem] text-faint/70">{verdict.note}</p>
      )}
    </div>
  );
}

/** Match-score bet, carded to match AccaCard/PropCard — so the score block reads
 *  as cards like accumulators, not the old flat row list. Carries the HT/FT period
 *  chip and the predicted scoreline chip up top, the bet label below. */
function BetCard({
  bet,
  verdict,
  currency,
}: {
  bet: BetRow;
  verdict: InPlay;
  currency: string;
}) {
  const dim = verdict.verdict === "lost" || verdict.verdict === "dead";
  const periodCls = bet.period === "HT" ? "border-mint/40 bg-mint/10 text-mint" : "border-acid-dim/50 bg-acid/10 text-acid";
  return (
    <div className="rounded-2xl border border-line bg-pitch-2/50 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex items-center gap-2.5">
          <span className={`rounded-full border px-2.5 py-0.5 font-mono text-[0.56rem] font-semibold uppercase tracking-wider ${periodCls}`}>
            {bet.period}
          </span>
          <span className="tnum rounded-md border border-line bg-card/50 px-2 py-0.5 font-mono text-[0.72rem] font-bold text-ink">
            {bet.home}–{bet.away}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="tnum font-mono text-[0.7rem] text-faint/70">
            @{bet.odds.toFixed(2)} · {money(bet.stake, currency)} →{" "}
            <span className={`font-semibold ${verdict.verdict === "won" ? "text-acid" : dim ? "text-faint line-through" : "text-ink"}`}>
              {money(bet.potential, currency)}
            </span>
          </span>
          <VerdictPill verdict={verdict.verdict} />
        </div>
      </div>
      <p className="mt-3 text-sm text-ink">{bet.label}</p>
      {verdict.note && (
        <p className="mt-2 font-mono text-[0.66rem] text-faint/70">{verdict.note}</p>
      )}
    </div>
  );
}

/** Slip breakdown band — singles vs accas vs total for the featured (today's) slate,
 *  the live analogue of the bet-slip card's footer split. */
function SlipBreakdown({ days, currency }: { days: DayRow[]; currency: string }) {
  const featured = days.filter((d) => d.isFeatured);
  let sStake = 0, sRet = 0, aStake = 0, aRet = 0;
  for (const d of featured) {
    for (const m of d.matches) {
      for (const b of m.bets) {
        sStake += b.stake;
        sRet += b.potential;
      }
      for (const s of m.specials) {
        if (s.mirror) continue;
        const isAcca = !!s.grade && "legs" in s.grade && Array.isArray((s.grade as { legs?: unknown[] }).legs);
        if (isAcca) {
          aStake += s.stake;
          aRet += s.potential;
        } else {
          sStake += s.stake;
          sRet += s.potential;
        }
      }
    }
  }
  if (sStake + aStake === 0) return null;
  const col = (k: string, stake: number, ret: number, tone: "muted" | "acid") => (
    <div className="flex-1">
      <p className="font-mono text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-faint/55">{k}</p>
      <p className="tnum mt-1.5 font-mono text-sm">
        <span className="text-ink">{money(stake, currency)}</span>
        <span className="px-1.5 text-faint/40">→</span>
        <span className={tone === "acid" ? "font-bold text-acid" : "text-ink"}>{money(ret, currency)}</span>
      </p>
    </div>
  );
  const divider = <span className="hidden h-9 w-px shrink-0 bg-line sm:block" />;
  return (
    <div className="mt-4 flex flex-col gap-4 rounded-2xl border border-line bg-pitch/40 px-5 py-4 sm:flex-row sm:items-center">
      {col("Singles", sStake, sRet, "muted")}
      {aStake > 0 && (
        <>
          {divider}
          {col("Accas", aStake, aRet, "muted")}
        </>
      )}
      {divider}
      {col("Total", sStake + aStake, sRet + aRet, "acid")}
    </div>
  );
}

function Chevron() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-4 shrink-0 text-faint transition-transform duration-300 group-open:rotate-180">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

// ── goal log + end-of-game performance (shown once a match is finished) ────────
function GoalLog({ live, m }: { live: LiveMatch; m: MatchRow }) {
  if (live.goals.length === 0)
    return <p className="font-mono text-[0.66rem] uppercase tracking-wider text-faint">No goals</p>;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
      {live.goals.map((g, i) => (
        <li key={i} className="flex items-center gap-1.5 font-mono text-[0.68rem]">
          <span className="text-faint">{g.minute != null ? `${g.minute}'` : "•"}</span>
          <span className={g.team === "home" ? "text-acid" : "text-mint"}>
            {g.team === "home" ? m.home.code : m.away.code}
          </span>
          <span className="text-ink">{g.scorer}</span>
          {g.penalty && <span className="text-amber">(P)</span>}
          {g.ownGoal && <span className="text-rose">(OG)</span>}
          {g.assist && <span className="text-faint">· {g.assist}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Verified ESPN counts (corners / on-target / shots / cards) for a match. */
function StatLine({ live, m }: { live: LiveMatch; m: MatchRow }) {
  const s = live.stats;
  if (!s) return null;
  const Cell = ({ label, h, a, sub }: { label: string; h: number; a: number; sub?: string }) => (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-faint uppercase tracking-wider">{label}</span>
      <span className="text-acid tnum">{h}</span>
      <span className="text-faint">–</span>
      <span className="text-mint tnum">{a}</span>
      {sub && <span className="text-faint">{sub}</span>}
    </span>
  );
  const yel = s.yellow.home + s.yellow.away;
  const red = s.red.home + s.red.away;
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 font-mono text-[0.66rem]">
      <span className="text-faint uppercase tracking-[0.16em]">
        {m.home.code} <span className="text-acid">▮</span> · <span className="text-mint">▮</span> {m.away.code}
      </span>
      <Cell label="Corners" h={s.corners.home} a={s.corners.away} />
      <Cell label="On target" h={s.sot.home} a={s.sot.away} />
      <Cell label="Shots" h={s.shots.home} a={s.shots.away} />
      <Cell label="Cards" h={s.cards.home} a={s.cards.away} sub={`(${yel}Y ${red}R)`} />
    </div>
  );
}

function Performance({ rows }: { rows: InPlay[] }) {
  const won = rows.filter((r) => r.verdict === "won").length;
  const lost = rows.filter((r) => r.verdict === "lost" || r.verdict === "dead").length;
  const refunded = rows.filter((r) => r.verdict === "void").length;
  return (
    <span className="font-mono text-[0.66rem] uppercase tracking-wider">
      <span className="text-acid">{won}W</span> · <span className="text-rose">{lost}L</span>
      {refunded > 0 && <> · <span className="text-amber">{refunded}R</span></>}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export default function LiveTracker({ base, activeNav }: { base: TrackerBase; activeNav: NavKey }) {
  const { live, updatedAt, pollFast, nextRefreshAt, refreshing, refresh } = useLive(base);
  const cur = base.meta.currency;
  const totalToday = base.counts.score + base.counts.props;
  const totalSeason = base.season.counts.score + base.season.counts.props;
  const empty = totalSeason === 0;

  // Every multi-leg parlay across ALL days, surfaced ONCE in a single top-level
  // roll-up (GlobalParlays). `isParlayRow` keeps the real copy only (drops the
  // cross-match mirrors) and excludes lone 1-leg "accas", which stay inline on
  // their own game card. Anchored to the match the real copy lives on.
  const allParlays = base.days.flatMap((d) =>
    d.matches.flatMap((m) =>
      m.specials.filter((s) => isParlayRow(s)).map((s) => ({ special: s, anchorMatchId: m.matchId })),
    ),
  );

  // Live "if it ended now" P&L — scoped to today's featured slate, matching the
  // staked / max-return figures in the hero (season roll-up lives below).
  const heroDays = base.days.filter((d) => d.isFeatured);
  let livePnl = 0;
  let securedReturns = 0;
  let anyMatchLive = false;
  for (const d of heroDays) {
    for (const m of d.matches) {
      const lm = live[m.matchId];
      if (lm && (lm.state === "live" || lm.state === "halftime")) anyMatchLive = true;
      for (const b of m.bets) {
        const v = gradeBet(b, lm).verdict;
        const lean = liveLeans(v);
        if (lean === "win") livePnl += b.potential - b.stake;
        else if (lean === "lose") livePnl -= b.stake;
        if (v === "won") securedReturns += b.potential;
        else if (v === "void") securedReturns += b.stake; // refund — stake handed back
      }
      for (const s of m.specials) {
        if (s.mirror) continue; // counted on its home card only
        const v = gradeSpecial(s, lm, live).verdict;
        const lean = liveLeans(v);
        if (lean === "win") livePnl += s.potential - s.stake;
        else if (lean === "lose") livePnl -= s.stake;
        if (v === "won") securedReturns += s.potential;
        else if (v === "void") securedReturns += s.stake; // refund — stake handed back
      }
    }
  }

  const pnlTone = livePnl > 0 ? "acid" : livePnl < 0 ? "rose" : "muted";
  const pnlValue = `${livePnl > 0 ? "+" : ""}${money(livePnl, cur)}`;

  return (
    <main className="mx-auto max-w-5xl px-4 pb-24 sm:px-6">
      <header className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between">
        <Link href="/" className="flex w-fit items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-acid font-display text-lg font-black text-pitch">⚽</span>
          <span className="font-display text-base font-extrabold uppercase tracking-tight">Matchday Edge</span>
        </Link>
        <SiteNav active={activeNav} />
      </header>

      <section className="slip-bloom relative overflow-hidden rounded-3xl border border-line bg-pitch-2/60 p-6 pl-7 sm:p-10 sm:pl-12">
        <div className="accent-bar pointer-events-none absolute inset-y-0 left-0 w-1.5" aria-hidden />
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <p className="inline-flex items-center gap-2 font-mono text-[0.72rem] uppercase tracking-[0.24em] text-acid">
            <span className="size-2 rounded-full bg-acid shadow-[0_0_12px_var(--color-acid)]" />
            Bet tracker · {base.meta.owner}&rsquo;s slip
          </p>
          {anyMatchLive && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber/15 px-2.5 py-0.5 font-mono text-[0.62rem] font-semibold uppercase tracking-wider text-amber">
              <span className="size-1.5 animate-pulse rounded-full bg-amber motion-reduce:animate-none" /> Live · updating every 5s
            </span>
          )}
        </div>
        <h1 className="max-w-3xl font-display text-4xl font-black uppercase leading-[0.95] tracking-tight sm:text-5xl">
          {empty
            ? `${base.meta.owner}’s live bet tracker.`
            : `${totalToday} bets today. Settled live.`}
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted">
          {empty ? (
            <>
              No bets on the slip yet. Once they&rsquo;re added, every line tracks in Malaysia time —
              green when it&rsquo;s winning, amber while it&rsquo;s still alive, red once it can&rsquo;t land.
            </>
          ) : (
            <>
              Today&rsquo;s slate, tracked in Malaysia time. While a match is on, each line updates second-by-second —
              green when it&rsquo;s winning, amber while it&rsquo;s still alive, red once it can&rsquo;t land. Previous
              days sit below.
            </>
          )}
        </p>

        <div className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat
            label={anyMatchLive ? "If it ended now" : "Net P&L"}
            value={pnlValue}
            sub={`${totalToday} bets · staked ${money(base.staked, cur)}`}
            tone={pnlTone}
          />
          <Stat label="Secured returns" value={money(securedReturns, cur)} sub="locked in so far" tone="acid" />
          <Stat label="Max return" value={money(base.potential, cur)} sub="singles, if they all land" tone="acid" />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 font-mono text-[0.66rem] text-faint">
          <span className="rounded-full border border-line px-2.5 py-1">Placed {base.meta.placedLabel} MYT</span>
          <span className="rounded-full border border-line px-2.5 py-1">{base.counts.score} score · {base.counts.props} props today</span>
          <span className="rounded-full border border-line px-2.5 py-1 text-faint">
            Season: {base.season.counts.score + base.season.counts.props} bets · staked {money(base.season.staked, cur)}
          </span>
          {updatedAt && (
            <span className="rounded-full border border-line px-2.5 py-1">
              Updated {new Date(updatedAt).toLocaleTimeString("en-GB", { timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit", second: "2-digit" })} MYT
            </span>
          )}
          {anyMatchLive ? (
            <RefreshCountdown nextAt={nextRefreshAt} active={anyMatchLive} />
          ) : (
            pollFast && <span className="rounded-full border border-acid-dim px-2.5 py-1 text-acid">● auto-refresh on</span>
          )}
          <ForceRefreshButton onRefresh={refresh} refreshing={refreshing} />
        </div>

        {!empty && <SlipBreakdown days={base.days} currency={cur} />}
      </section>

      {empty && (
        <section className="mt-10 rounded-3xl border border-dashed border-line bg-card/30 px-6 py-16 text-center">
          <p className="font-mono text-[0.66rem] uppercase tracking-[0.24em] text-acid">No bets tracked yet</p>
          <h2 className="mx-auto mt-4 max-w-xl font-display text-2xl font-black uppercase tracking-tight">
            {base.meta.owner}&rsquo;s slip is empty — for now.
          </h2>
          <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-muted">
            Send your bets to Friday on WhatsApp and they&rsquo;ll show up here, settling live off the
            real scores the moment each match kicks off.
          </p>
        </section>
      )}

      {!empty && allParlays.length > 0 && (
        <div className="mt-10">
          <GlobalParlays parlays={allParlays} live={live} currency={cur} />
        </div>
      )}

      <div className="mt-10 space-y-12">
        {(() => {
          const renderDay = (day: DayRow) => {
          const sorted = [...day.matches].sort((a, b) => rank(live[a.matchId]) - rank(live[b.matchId]));
          // Multi-leg parlays are no longer rolled up per day — they all live in the
          // single top-level GlobalParlays section, so a parlay whose legs span
          // several days (e.g. the R16 "to qualify" accas) shows up ONCE rather
          // than only on whichever day its first leg falls. Each day now renders
          // only its own games + singles. `legParlays` (below) still points a pure
          // parlay-leg game back to that global section.
          const singleCount = day.matches.reduce(
            (n, m) => n + m.bets.length + m.specials.filter((s) => !s.mirror && !isParlayRow(s)).length,
            0,
          );
          return (
            <section key={day.key}>
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line/60 pb-2">
                <h2 className="flex items-baseline gap-2.5 font-display text-lg font-extrabold uppercase tracking-tight text-ink">
                  {day.isFeatured && (
                    <span className="self-center rounded-full bg-acid px-2 py-0.5 font-mono text-[0.56rem] font-semibold uppercase tracking-wider text-pitch">Today</span>
                  )}
                  {day.label}
                </h2>
                <span className="font-mono text-[0.66rem] uppercase tracking-wider text-faint tnum">
                  {singleCount} bets
                </span>
              </div>

              <div className="space-y-4">
                {sorted.map((m, mi) => {
                  const lm = live[m.matchId];
                  const finished = lm?.state === "finished";
                  const betVerdicts = m.bets.map((b) => gradeBet(b, lm));
                  const spVerdicts = m.specials.map((s) => gradeSpecial(s, lm, live));
                  const allV = [...betVerdicts, ...spVerdicts];
                  // Float winning lines to the top, still-on next, losses last.
                  const orderedBets = orderByVerdict(m.bets, betVerdicts);
                  const orderedSpecials = orderByVerdict(m.specials, spVerdicts);
                  // Multi-leg parlays no longer render inside the game card — they're
                  // rolled up ONCE at the top of the day (DayParlays), so a 6-leg acca
                  // isn't repeated across 6 cards. What stays here: this game's own
                  // singles. A lone 1-leg "acca" (no real parlay) keeps its leg-grid
                  // card inline; mirror copies render nowhere (their source is up top).
                  const isInlineAcca = (r: SpecialRow) =>
                    isAccaRow(r) && !r.mirror && (r.grade as { legs: unknown[] }).legs.length < 2;
                  const accaIdx = orderedSpecials.rows
                    .map((_, i) => i)
                    .filter((i) => isInlineAcca(orderedSpecials.rows[i] as SpecialRow));
                  const accaRows = accaIdx.map((i) => orderedSpecials.rows[i]) as SpecialRow[];
                  const accaVerdicts = accaIdx.map((i) => orderedSpecials.verdicts[i]);
                  const propIdx = orderedSpecials.rows
                    .map((_, i) => i)
                    .filter((i) => !isAccaRow(orderedSpecials.rows[i] as SpecialRow));
                  const propRows = propIdx.map((i) => orderedSpecials.rows[i]);
                  const propVerdicts = propIdx.map((i) => orderedSpecials.verdicts[i]);
                  // Whether this game carries any of Rj's OWN lines (singles / props /
                  // inline 1-leg acca). Games with none are pure parlay legs — kept
                  // visible for the live score but collapsed, with a pointer to the
                  // parlays above instead of an empty body.
                  const hasOwnBets =
                    orderedBets.rows.length > 0 || accaRows.length > 0 || propRows.length > 0;
                  const liveNow = lm?.state === "live" || lm?.state === "halftime";
                  // Which parlays use this match as a leg (for the pointer note) —
                  // checked against the whole-slate list now, not just this day's.
                  const legParlays = allParlays.filter((p) =>
                    ((p.special.grade as { legs?: { matchId?: string }[] }).legs ?? []).some(
                      (l) => l.matchId === m.matchId,
                    ),
                  );
                  // Mirror rows (cross-match acca shown on another card) are excluded
                  // from this card's money totals — their stake/return live on the home card.
                  const moneyRows = [...m.bets, ...m.specials];
                  const matchStaked = moneyRows.reduce((x, r) => ((r as SpecialRow).mirror ? x : x + r.stake), 0);
                  const matchReturned = moneyRows.reduce((x, r, i) => {
                    if ((r as SpecialRow).mirror) return x;
                    const v = allV[i]?.verdict;
                    if (v === "won") return x + r.potential; // full payout
                    if (v === "void") return x + r.stake; // refund — stake back
                    return x;
                  }, 0);

                  return (
                    <details key={m.matchId} open={liveNow || (!finished && hasOwnBets)} className="group overflow-hidden rounded-3xl border border-line bg-card/40 [&_summary::-webkit-details-marker]:hidden">
                      <summary className="flex cursor-pointer select-none flex-wrap items-center justify-between gap-3 bg-pitch-2/40 px-5 py-4">
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="mt-0.5 shrink-0 rounded-md border border-line bg-card/50 px-2 py-1 font-mono text-[0.62rem] font-bold tabular-nums text-acid">
                            {String(mi + 1).padStart(2, "0")}
                          </span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-display text-lg font-extrabold uppercase tracking-tight">{m.home.flag} {m.home.name}</span>
                              <LiveScore live={lm} m={m} />
                              <span className="font-display text-lg font-extrabold uppercase tracking-tight">{m.away.name} {m.away.flag}</span>
                            </div>
                            <p className="mt-1 font-mono text-[0.66rem] uppercase tracking-wider text-faint">
                              {m.round ?? `Group ${m.group}`} · {m.kickoffLabel}
                            </p>
                            {m.form && (
                              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                                <FormStrip code={m.home.code} f={m.form.home} />
                                <FormStrip code={m.away.code} f={m.form.away} />
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <LiveBadge live={lm} />
                          <Chevron />
                        </div>
                      </summary>

                      <div className="border-t border-line">
                        {/* Live goal feed — scorers, assists & minutes while the match is on */}
                        {lm && (lm.state === "live" || lm.state === "halftime") && (
                          <div className="border-b border-line bg-pitch-2/40 px-5 py-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="inline-flex items-center gap-1.5 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-amber">
                                <span className="size-1.5 animate-pulse rounded-full bg-amber motion-reduce:animate-none" />
                                {lm.state === "halftime" ? "Half-time" : `Live ${lm.statusDetail}`} · goals so far
                              </span>
                              <Performance rows={allV} />
                            </div>
                            <div className="mt-2.5">
                              <GoalLog live={lm} m={m} />
                            </div>
                            <StatLine live={lm} m={m} />
                          </div>
                        )}

                        {/* End-of-game performance banner */}
                        {finished && lm && (
                          <div className="border-b border-line bg-pitch-2/50 px-5 py-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-acid">Full-time · how it landed</span>
                              <Performance rows={allV} />
                            </div>
                            <div className="mt-2.5">
                              <GoalLog live={lm} m={m} />
                            </div>
                            <StatLine live={lm} m={m} />
                            <p className="mt-2.5 font-mono text-[0.66rem] uppercase tracking-wider text-faint tnum">
                              Staked {money(matchStaked, cur)} ·{" "}
                              {matchReturned > 0 ? <span className="text-acid">returned {money(matchReturned, cur)}</span> : <span className="text-rose">returned {money(0, cur)}</span>}
                              {" · net "}
                              <span className={matchReturned - matchStaked >= 0 ? "text-acid" : "text-rose"}>
                                {matchReturned - matchStaked >= 0 ? "+" : ""}{money(matchReturned - matchStaked, cur)}
                              </span>
                            </p>
                          </div>
                        )}

                        {orderedBets.rows.length > 0 && (
                          <div>
                            <div className="flex items-center gap-2 bg-pitch-2/50 px-5 py-2.5">
                              <span className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-acid">Match score</span>
                              <span className="rounded-full border border-acid-dim/50 px-2 py-0.5 font-mono text-[0.56rem] uppercase tracking-wider text-acid">HT · FT · live grade</span>
                            </div>
                            <div className="space-y-3 px-5 py-4">
                              {(orderedBets.rows as BetRow[]).map((r, i) => (
                                <BetCard key={r.id} bet={r} verdict={orderedBets.verdicts[i]} currency={cur} />
                              ))}
                            </div>
                          </div>
                        )}

                        {accaRows.length > 0 && (
                          <div className="border-t border-line">
                            <div className="flex items-center gap-2 bg-pitch-2/50 px-5 py-2.5">
                              <span className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-acid">Accumulators</span>
                              <span className="rounded-full border border-acid-dim/50 px-2 py-0.5 font-mono text-[0.56rem] uppercase tracking-wider text-acid">live leg grid</span>
                            </div>
                            <div className="space-y-3 px-5 py-4">
                              {accaRows.map((r, i) => (
                                <AccaCard key={r.id} special={r} verdict={accaVerdicts[i]} currency={cur} />
                              ))}
                            </div>
                          </div>
                        )}

                        {propRows.length > 0 && (
                          <div className="border-t border-line">
                            <div className="flex items-center gap-2 bg-pitch-2/50 px-5 py-2.5">
                              <span className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-mint">Player props</span>
                              <span className="rounded-full border border-mint/40 px-2 py-0.5 font-mono text-[0.56rem] uppercase tracking-wider text-mint">1xBet · live grade</span>
                            </div>
                            <div className="space-y-3 px-5 py-4">
                              {propRows.map((r, i) => (
                                <PropCard key={r.id} special={r as SpecialRow} verdict={propVerdicts[i]} currency={cur} />
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Pure parlay-leg game — no singles of its own. Point back to
                            the parlays above instead of an empty body. */}
                        {!hasOwnBets && (
                          <div className="px-5 py-4">
                            <p className="font-mono text-[0.66rem] uppercase tracking-wider text-faint">
                              No singles here —{" "}
                              {legParlays.length > 0 ? (
                                <span className="text-acid">
                                  leg in {legParlays.length} parlay{legParlays.length > 1 ? "s" : ""} above
                                </span>
                              ) : (
                                "on the slate for the live score"
                              )}
                              .
                            </p>
                          </div>
                        )}
                      </div>
                    </details>
                  );
                })}
              </div>
            </section>
          );
          };
          // Active day is pinned at top; UPCOMING days (future round dates, not
          // yet played) stay visible below it. Only days that finished BEFORE the
          // active slate (key < featuredKey) are "earlier rounds" — those collapse
          // into a folded accordion so settled history doesn't clutter the current
          // round. Key comparison is deterministic (no Date.now → no hydration drift).
          const isPast = (d: DayRow) => d.key !== "tbd" && d.key < base.featuredKey;
          const featured = base.days.filter((d) => d.isFeatured);
          const upcoming = base.days.filter((d) => !d.isFeatured && !isPast(d));
          const past = base.days.filter((d) => !d.isFeatured && isPast(d));
          const pastBets = past.reduce(
            (s, d) => s + d.matches.reduce((x, m) => x + m.bets.length + m.specials.filter((sp) => !sp.mirror).length, 0),
            0,
          );
          return (
            <>
              {featured.map(renderDay)}
              {upcoming.map(renderDay)}
              {past.length > 0 && (
                <details className="group/earlier">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 border-b border-line/60 pb-2 font-display text-lg font-extrabold uppercase tracking-tight text-muted transition-colors hover:text-ink">
                    <span className="flex items-baseline gap-2.5">
                      <span className="self-center rounded-full border border-line px-2 py-0.5 font-mono text-[0.56rem] font-semibold uppercase tracking-wider text-faint">Settled</span>
                      Earlier rounds
                    </span>
                    <span className="flex items-center gap-2 font-mono text-[0.66rem] tracking-wider text-faint tnum">
                      {pastBets} bets
                      <span className="transition-transform group-open/earlier:rotate-180" aria-hidden>▾</span>
                    </span>
                  </summary>
                  <div className="mt-8 space-y-12">{past.map(renderDay)}</div>
                </details>
              )}
            </>
          );
        })()}
      </div>

      <footer className="mt-16 border-t border-line pt-8 text-sm text-faint">
        <p className="max-w-2xl leading-relaxed text-muted">{base.meta.note}</p>
        <p className="mt-3 max-w-2xl leading-relaxed">⚠️ {base.meta.disclaimer}</p>
        <p className="mt-2 font-mono text-[0.62rem] leading-relaxed text-faint">
          Live scores via ESPN. In-play status is provisional and settles on the final whistle.
        </p>
        <p className="mt-6 font-mono text-[0.66rem] uppercase tracking-[0.18em]">Matchday Edge · {base.meta.owner}&rsquo;s slip · fun-money only</p>
      </footer>
    </main>
  );
}

// Live/half-time first, upcoming next, finished last.
function rank(live: LiveMatch | undefined): number {
  if (!live) return 1;
  if (live.state === "live" || live.state === "halftime") return 0;
  if (live.state === "finished") return 2;
  return 1;
}

// Order bet rows by live status: winning first, then still-on, then losses.
//   winning  → on track now / already won (green)
//   still on → mathematically alive, or not yet kicked off (amber/idle)
//   loss     → out of reach now, or already lost (red)
const VERDICT_ORDER: Record<LiveVerdict, number> = {
  winning: 0,
  won: 1,
  alive: 2,
  scheduled: 3,
  void: 4,
  dead: 5,
  lost: 6,
};

/** Re-order rows and their verdicts together by status. Stable within a bucket,
 *  so a match's original bet order is preserved among equal verdicts. */
function orderByVerdict<T>(rows: T[], verdicts: InPlay[]): { rows: T[]; verdicts: InPlay[] } {
  const idx = rows.map((_, i) => i);
  idx.sort((a, b) => VERDICT_ORDER[verdicts[a].verdict] - VERDICT_ORDER[verdicts[b].verdict]);
  return { rows: idx.map((i) => rows[i]), verdicts: idx.map((i) => verdicts[i]) };
}
