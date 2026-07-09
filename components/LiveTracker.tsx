"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { LiveMatch } from "@/lib/live";
import type { BetStatus, SpecialGrade } from "@/lib/bets";
import type { Fixture } from "@/lib/types";
import fixturesJson from "@/data/fixtures.json";
import { inPlayBet, inPlaySpecial, inPlayMultiScorers, inPlayMultiLeg, liveLeans, realisedLeans, type InPlay, type LiveVerdict } from "@/lib/inplay";
import { RefreshCountdown, ForceRefreshButton } from "./RefreshCountdown";
import { LiveEventFX } from "./LiveFX";
import { diffLegEvents, legKey, type LegSnap, type LegEvent } from "@/lib/legEvents";
import { SiteNav, type NavKey } from "./SiteNav";
import { ChapterHead } from "./ProgrammeKit";
import { SpotlightCard, type SpotTone } from "./SpotlightCard";
import MatchSpotlight from "./MatchSpotlight";
import { PlayerSheetBody, PlayerSheetFootnote } from "./LiveScore";
import { StatAbbr, StatCell, Legend } from "./atoms";

/** Keys of legs that just settled this poll — the tracker fills it and every
 * rendered leg row reads it to flash. Empty by default (e.g. the leg grid on
 * a shared card outside the live tracker). */
const LegFlashContext = createContext<Set<string>>(new Set());
const useLegFlash = () => useContext(LegFlashContext);

/** Map a live verdict to the glass card's glow + edge tone: green when it's
 *  winning/won, amber while it's still alive / not started / refunded, red once
 *  it can't land. Keeps the spotlight telling the same story as the pill. */
function verdictTone(v: LiveVerdict): SpotTone {
  if (v === "won" || v === "winning") return "acid";
  if (v === "lost" || v === "dead") return "rose";
  return "amber";
}

// ── round lookup, shared by the round-grouped parlay roll-up and the all-games
//    knockout section. A parlay's "headline round" = the round of its anchor
//    match (the real, non-mirror copy lives on its first leg). Group-stage
//    fixtures leave `round` undefined → bucketed as "Group stage".
const FIXTURES = fixturesJson as Fixture[];
const ROUND_BY_MATCH = new Map(FIXTURES.map((f) => [f.id, f.round]));
// Knockout rounds lead (most-advanced first), group stage trails. Lower = shown
// earlier. Currently this World Cup's first knockout round is the Round of 32.
const ROUND_ORDER = ["Final", "Third place", "Semi-finals", "Quarter-finals", "Round of 16", "Round of 32"];
function roundLabel(r: string | undefined): string {
  return r && r.trim() ? r : "Group stage";
}
function roundRank(label: string): number {
  // Tolerant match: the data labels a round "Quarter-final" (singular) while
  // ROUND_ORDER carries "Quarter-finals" — an exact indexOf misses, so the round
  // ranked as "unknown" (least-advanced) and the active-round grid wrongly showed
  // it. Normalise a trailing plural 's' + case so singular/plural always align.
  const norm = (x: string) => x.toLowerCase().replace(/s$/, "");
  const i = ROUND_ORDER.findIndex((o) => norm(o) === norm(label));
  return i === -1 ? ROUND_ORDER.length + 1 : i; // still unknown → ranked after group
}

// Rj (2026-07-07): the tracker shows slips from the LAST 7 DAYS only — a rolling
// window anchored on the server-set featured day key (never Date.now() in render,
// so server + client produce identical HTML). Anything older — wins AND losses
// alike — drops from view: whole day sections, plus parlays whose latest leg
// kicked off before the window. Money summaries keep grading the full unfiltered
// slip, so staked / returned / net P&L stay truthful. (Supersedes the earlier
// hide-pre-R16-losses rule.)
const WINDOW_DAYS = 7;
function windowCutoffKey(featuredKey: string): string {
  // Pure calendar arithmetic on the MYT day key ("2026-07-07" − 7d) — the key is
  // already the local betting day, so UTC parse/format is just date math.
  const t = Date.parse(`${featuredKey}T00:00:00Z`);
  if (Number.isNaN(t)) return ""; // "tbd"/malformed featured key → keep everything
  return new Date(t - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
}

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
  // Present when a leg voided (whole-line push) and the acca was repriced. Carries
  // the BEFORE odds/return so the card shows previous → current on every device.
  reprice?: {
    prevOdds: number;
    prevReturn: number;
    voidLegs: number;
    note: string;
  };
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
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[0.62rem] font-semibold uppercase tracking-wider ring-1 ring-inset ring-white/10 ${s.cls}`}
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
  // ↺ = whole-line push → the leg voids and its odds drop out of the acca
  // (stake portion returns); it must be recognised or one refunded leg
  // collapses the entire slip to a raw-text fallback.
  // ½✓ / ½✗ = Asian quarter-line half-win / half-loss — the leg survives the
  // acca but reprices the payout, so it must read as a half, never a clean ✓.
  const known = new Set(["✓", "✗", "⋯", "—", "↺", "½✓", "½✗"]);
  return legs.every((l) => known.has(l.glyph)) && legs.length > 0 ? legs : null;
}

const LEG_GLYPH: Record<string, { cls: string; dot: string; pulse?: boolean }> = {
  "✓": { cls: "text-acid", dot: "bg-acid" },
  "✗": { cls: "text-rose", dot: "bg-rose" },
  "⋯": { cls: "text-acid", dot: "bg-acid", pulse: true },
  "—": { cls: "text-faint/60", dot: "bg-faint/40" },
  "↺": { cls: "text-amber", dot: "bg-amber" },
  "½✓": { cls: "text-amber", dot: "bg-amber" },
  "½✗": { cls: "text-amber", dot: "bg-amber" },
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

// ── live game-stat header — the score/total/minute context Rj wants on top of
//    every slip. Keyed off a match a slip is tied to, so a multi-game acca shows
//    each leg's live game state (current score, total goals, minute, verified
//    stats) directly above that leg's line. ────────────────────────────────────
type TeamMeta = { name: string; flag: string; code: string };
type MatchMeta = { home: TeamMeta; away: TeamMeta; kickoffLabel: string };

function matchMeta(matchId: string): MatchMeta | null {
  const fx = FIXTURES.find((f) => f.id === matchId);
  if (!fx) return null;
  return {
    home: { name: fx.home.name, flag: fx.home.flag, code: teamCode(fx.home.name) },
    away: { name: fx.away.name, flag: fx.away.flag, code: teamCode(fx.away.name) },
    kickoffLabel: `${mytKick(fx.kickoffUTC)} MYT`,
  };
}

// Light name matcher for the per-player tally on player legs — mirrors lib/inplay
// deburr+includes so the count shown never disagrees with settlement.
const deburrLite = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
function nameHit(a: string, b: string): boolean {
  const x = deburrLite(a), y = deburrLite(b);
  return x === y || x.includes(y) || y.includes(x);
}
function playerTally(lm: LiveMatch, player: string): { goals: number; assists: number } {
  const goals = lm.goals.filter((gl) => !gl.ownGoal && nameHit(gl.scorer, player)).length;
  const assists = lm.goals.filter((gl) => gl.assist && nameHit(gl.assist, player)).length;
  return { goals, assists };
}

function liveStatus(lm: LiveMatch): { label: string; cls: string; pulse: boolean } {
  if (lm.state === "live") return { label: lm.minute != null ? `${lm.minute}'` : "LIVE", cls: "text-amber", pulse: true };
  if (lm.state === "halftime") return { label: "HALF-TIME", cls: "text-mint", pulse: false };
  if (lm.state === "finished") return { label: lm.statusDetail || "FULL-TIME", cls: "text-faint", pulse: false };
  return { label: "Not started", cls: "text-faint", pulse: false };
}

/** Upper-case the first alphabetical character of a leg label so a market word
 *  reads as a proper sentence start once the "Home v Away — " prefix is stripped
 *  ("both teams to score" → "Both teams to score", "under 2.5 goals" → "Under
 *  2.5 goals"). One place, every market — not per-case in the label builder. */
function sentenceCase(s: string): string {
  const i = s.search(/[a-z]/i);
  return i < 0 ? s : s.slice(0, i) + s.charAt(i).toUpperCase() + s.slice(i + 1);
}

/** Small stat cell for the live stat strip (home-acid / away-warm). */
function MiniStat({ label, h, a }: { label: string; h: number; a: number }) {
  return (
    <span className="inline-flex flex-col items-center gap-1">
      <span className="inline-flex items-baseline gap-1.5">
        <span className="tnum font-semibold text-acid">{h}</span>
        <span className="text-faint/50">–</span>
        <span className="tnum font-semibold text-mint">{a}</span>
      </span>
      <StatAbbr code={label} className="text-[0.7rem] text-ink/55" />
    </span>
  );
}

/** Collapsed-by-default per-player sheet under a match's stat strip. The body
 *  only MOUNTS while open — with several matches on the feed, ~300 ticking
 *  cells per sheet would otherwise re-render on every 5s poll for nothing. */
function PlayerSheetToggle({
  lm,
  home,
  away,
}: {
  lm: LiveMatch;
  home: { name: string; flag: string };
  away: { name: string; flag: string };
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 rounded-full border border-line bg-card/40 px-2 py-0.5 font-mono text-[0.56rem] font-semibold uppercase tracking-wider text-muted transition-colors hover:text-acid"
      >
        Player stats
        <span className={`transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>
      {open && (
        <div className="mt-2 rounded-xl border border-line/60 bg-card/30 p-2.5">
          <PlayerSheetBody lm={lm} home={home} away={away} />
          <PlayerSheetFootnote finished={lm.state === "finished"} />
        </div>
      )}
    </div>
  );
}

/** The score header row that opens a match panel — NOT a boxed strip, but the
 *  top row of one cohesive panel whose legs sit beneath it. Score dominates
 *  (the live number is the point); a flag + quiet team code flanks each side. Reads
 *  the kickoff time before the match is on; the whole panel tints amber live. */
function MatchScoreLine({ matchId, live }: { matchId: string; live: Record<string, LiveMatch | undefined> }) {
  const meta = matchMeta(matchId);
  if (!meta) return null;
  const lm = live[matchId];
  const on = lm && lm.state !== "scheduled";
  if (!on) {
    return (
      <div className="match-scoreline flex items-center gap-2.5 px-3.5 py-2.5">
        <span aria-hidden className="text-sm leading-none">{meta.home.flag}</span>
        <span className="tnum text-sm font-bold tracking-tight text-muted">{meta.home.code}</span>
        <span className="text-[0.6rem] uppercase tracking-[0.2em] text-faint/50">v</span>
        <span aria-hidden className="text-sm leading-none">{meta.away.flag}</span>
        <span className="tnum text-sm font-bold tracking-tight text-muted">{meta.away.code}</span>
        <span className="ml-2 font-mono text-[0.62rem] text-faint/70">{meta.kickoffLabel}</span>
        <span className="ml-auto rounded-full border border-line px-2 py-0.5 font-mono text-[0.56rem] font-semibold uppercase tracking-wider text-faint">
          Not started
        </span>
      </div>
    );
  }
  const s = lm!.score;
  const total = s.home + s.away;
  const st = liveStatus(lm!);
  const stats = lm!.stats;
  return (
    <div className="match-scoreline px-3.5 py-2.5">
      <div className="flex items-center gap-x-2.5 gap-y-1">
        <span aria-hidden className="text-base leading-none">{meta.home.flag}</span>
        <span className="tnum text-[0.7rem] font-bold uppercase tracking-wider text-muted">{meta.home.code}</span>
        <span className="tnum text-xl font-extrabold leading-none tracking-tight text-ink">
          {s.home}<span className="px-1.5 text-base font-semibold text-faint/60">–</span>{s.away}
        </span>
        <span className="tnum text-[0.7rem] font-bold uppercase tracking-wider text-muted">{meta.away.code}</span>
        <span aria-hidden className="text-base leading-none">{meta.away.flag}</span>
        <span className={`ml-1 inline-flex items-center gap-1 font-mono text-[0.6rem] font-semibold uppercase tracking-wider ${st.cls}`}>
          {st.pulse && <span className="size-1.5 animate-pulse rounded-full bg-amber motion-reduce:animate-none" />}
          {st.label}
        </span>
        <span className="ml-auto rounded-full border border-line bg-card/40 px-2 py-0.5 font-mono text-[0.56rem] font-semibold uppercase tracking-wider text-muted tnum">
          {total} goal{total === 1 ? "" : "s"}
        </span>
      </div>
      {stats && (
        <div className="mt-2.5">
          <div className="mb-1.5 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-ink/50">
            Match stats — <span className="text-acid">{meta.home.code}</span> vs{" "}
            <span className="text-mint">{meta.away.code}</span>
          </div>
          <div className="flex flex-wrap items-start gap-x-5 gap-y-2.5 font-mono">
            <MiniStat label="On tgt" h={stats.sot.home} a={stats.sot.away} />
            <MiniStat label="Corners" h={stats.corners.home} a={stats.corners.away} />
            <MiniStat label="Shots" h={stats.shots.home} a={stats.shots.away} />
            {stats.tempo && (
              <>
                <MiniStat label="Tackles" h={stats.tempo.tackles.home} a={stats.tempo.tackles.away} />
                <MiniStat label="Blocks" h={stats.tempo.blockedShots.home} a={stats.tempo.blockedShots.away} />
                <MiniStat label="Saves" h={stats.tempo.saves.home} a={stats.tempo.saves.away} />
              </>
            )}
            {stats.fouls && <MiniStat label="Fouls" h={stats.fouls.home} a={stats.fouls.away} />}
            <MiniStat label="Cards" h={stats.cards.home} a={stats.cards.away} />
          </div>
        </div>
      )}
      {stats?.players?.length ? (
        <PlayerSheetToggle
          lm={lm!}
          home={{ name: meta.home.name, flag: meta.home.flag }}
          away={{ name: meta.away.name, flag: meta.away.flag }}
        />
      ) : null}
    </div>
  );
}

/** One acca leg — a single tight row (status dot · the pick · optional player
 *  tally · verdict glyph), living inside its match panel beneath the score line.
 *  A player leg ("Mbappé — 2+ goals") carries that player's live goal/assist
 *  tally so a scorer bet reads its own match involvement inline. */
function LegLine({ leg, lm, flash }: { leg: { label: string; glyph: string; player?: string }; lm: LiveMatch | undefined; flash?: boolean }) {
  const g = LEG_GLYPH[leg.glyph] ?? LEG_GLYPH["—"];
  const tally = leg.player && lm && lm.state !== "scheduled" ? playerTally(lm, leg.player) : null;
  return (
    <li className={`leg-line flex items-center gap-2.5 px-3.5 py-2 transition-colors hover:bg-[var(--ui-fill)] ${flash ? "leg-flash" : ""}`}>
      <span className={`size-1.5 shrink-0 rounded-full ${g.dot} ${g.pulse ? "animate-pulse motion-reduce:animate-none" : ""}`} />
      <span className="min-w-0 flex-1 break-words text-[0.82rem] leading-snug text-ink">
        {sentenceCase(leg.label)}
      </span>
      {tally && (
        <span className="shrink-0 whitespace-nowrap rounded border border-mint/25 bg-mint/[0.06] px-2 py-0.5 font-mono text-[0.7rem] font-semibold text-mint tnum">
          {tally.goals} goal{tally.goals === 1 ? "" : "s"}
          {tally.assists > 0 ? ` · ${tally.assists} assist${tally.assists === 1 ? "" : "s"}` : ""}
        </span>
      )}
      <span className={`shrink-0 font-mono text-sm font-bold leading-none ${g.cls}`}>{leg.glyph}</span>
    </li>
  );
}

/** A single game inside an accumulator, as ONE cohesive panel: the score line on
 *  top, that game's leg(s) beneath a hairline — so a leg visibly belongs to its
 *  match instead of floating as a disconnected bar. `withHeader` is false for a
 *  lone inline acca inside a day match-card (which already shows the score above). */
function MatchGroup({
  matchId,
  legs,
  live,
  withHeader,
}: {
  matchId: string;
  legs: { label: string; glyph: string; player?: string }[];
  live: Record<string, LiveMatch | undefined>;
  withHeader: boolean;
}) {
  const meta = matchMeta(matchId);
  const lm = live[matchId];
  const hot = lm?.state === "live" || lm?.state === "halftime";
  const flashed = useLegFlash();
  return (
    <div className={`match-panel ${hot ? "match-panel--hot" : ""}`}>
      {withHeader && <MatchScoreLine matchId={matchId} live={live} />}
      <ul>
        {legs.map((l, i) => (
          <LegLine
            key={i}
            // Flash key uses the UNSTRIPPED label — the same one the snapshot in
            // LiveTracker keys on — so the row that flashes is the leg that settled.
            flash={flashed.has(legKey(matchId, l.label))}
            leg={{ ...l, label: withHeader ? stripMatchPrefix(l.label, meta) : l.label }}
            lm={lm}
          />
        ))}
      </ul>
    </div>
  );
}

/** Strip the "Home v Away — " (or "Home v Away ") prefix off a leg label when
 *  it's shown under a game-stat header that already names the teams, so the leg
 *  reads "under 2.5 goals" not "England v Congo — under 2.5 goals". */
function stripMatchPrefix(label: string, meta: MatchMeta | null): string {
  if (!meta) return label;
  const p = `${meta.home.name} v ${meta.away.name}`;
  if (label.startsWith(p)) return label.slice(p.length).replace(/^\s*(—\s*)?/, "").trim() || label;
  return label;
}

/** Accumulator card — grouped by the match each leg is tied to. Each match gets
 *  ONE live game-stat header (score / total goals / minute / verified stats) with
 *  its legs beneath, so a cross-game acca reads game-by-game. `withGameHeader` is
 *  false for a lone inline acca inside a day match-card (the card already shows
 *  the match's live header right above it). */
function AccaCard({
  special,
  verdict,
  currency,
  live,
  withGameHeader = true,
}: {
  special: SpecialRow;
  verdict: InPlay;
  currency: string;
  live: Record<string, LiveMatch | undefined>;
  withGameHeader?: boolean;
}) {
  const parsed = parseLegs(verdict.note);
  const rawLegs = (
    special.grade && "legs" in special.grade ? (special.grade.legs as unknown[]) : []
  ) as { matchId?: string; player?: string }[];
  const legCount = rawLegs.length || parsed?.length || 0;

  // Zip the raw legs (which carry matchId + optional player) with the parsed
  // display legs (label + glyph, same order) and group by match. Only possible
  // when both lists line up and every leg names a match.
  const canGroup = !!parsed && rawLegs.length === parsed.length && rawLegs.every((l) => l.matchId);
  const groups: { matchId: string; legs: { label: string; glyph: string; player?: string }[] }[] = [];
  if (canGroup && parsed) {
    for (let i = 0; i < rawLegs.length; i++) {
      const mid = rawLegs[i].matchId!;
      let grp = groups.find((x) => x.matchId === mid);
      if (!grp) { grp = { matchId: mid, legs: [] }; groups.push(grp); }
      grp.legs.push({ label: parsed[i].label, glyph: parsed[i].glyph, player: rawLegs[i].player });
    }
  }

  // How many legs are already home vs still to play — a tiny progress read on the
  // header so a part-played acca shows "2/4 legs in" at a glance.
  const landed = (parsed ?? []).filter((l) => l.glyph === "✓" || l.glyph === "↺").length;

  return (
    <SpotlightCard tone={verdictTone(verdict.verdict)} className="overflow-hidden rounded-2xl">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3.5 pl-5 sm:px-5 sm:pl-6">
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
      {special.reprice && (
        <div className="border-t border-amber/15 bg-amber/[0.04] px-4 py-2.5 pl-5 sm:px-5 sm:pl-6">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[0.62rem]">
            <span className="rounded-full bg-amber/15 px-2 py-0.5 font-semibold uppercase tracking-wider text-amber">
              {special.reprice.voidLegs} leg refunded
            </span>
            <span className="text-faint/55">previous</span>
            <span className="tnum text-faint/70 line-through">
              @{special.reprice.prevOdds.toFixed(2)} · {money(special.reprice.prevReturn, currency)}
            </span>
            <span className="text-faint/55">→ now</span>
            <span className="tnum font-semibold text-acid">
              @{special.odds.toFixed(2)} · {money(special.potential, currency)}
            </span>
          </div>
          <p className="mt-1 text-[0.7rem] leading-snug text-faint/60">{special.reprice.note}</p>
        </div>
      )}
      {legCount > 1 && (parsed?.length ?? 0) > 0 && (
        <div className="flex items-center gap-2 px-4 pb-3 pl-5 sm:px-5 sm:pl-6">
          <span className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--ui-track)]">
            <span
              className="block h-full rounded-full bg-gradient-to-r from-acid-dim to-acid transition-[width] duration-500"
              style={{ width: `${Math.round((landed / legCount) * 100)}%` }}
            />
          </span>
          <span className="tnum font-mono text-[0.7rem] uppercase tracking-wider text-faint/60">{landed}/{legCount} in</span>
        </div>
      )}
      {groups.length > 0 ? (
        <div className="space-y-2.5 border-t border-white/[0.07] px-4 py-3.5 pl-5 sm:px-5 sm:pl-6">
          {groups.map((grp) => (
            <MatchGroup key={grp.matchId} matchId={grp.matchId} legs={grp.legs} live={live} withHeader={withGameHeader} />
          ))}
        </div>
      ) : parsed ? (
        <div className="border-t border-white/[0.07] px-4 py-3.5 pl-5 sm:px-5 sm:pl-6">
          <ul className="match-panel">
            {parsed.map((l, i) => <LegLine key={i} leg={l} lm={undefined} />)}
          </ul>
        </div>
      ) : (
        verdict.note && <p className="border-t border-white/[0.07] px-4 py-3 pl-5 font-mono text-[0.7rem] text-faint/70 sm:px-5 sm:pl-6">{verdict.note}</p>
      )}
    </SpotlightCard>
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
    // Order by winning amount (potential payout) high → low so the biggest
    // return sits on top; verdict (winning → alive → settled) breaks ties.
    .sort(
      (a, b) =>
        b.special.potential - a.special.potential ||
        VERDICT_ORDER[a.verdict.verdict] - VERDICT_ORDER[b.verdict.verdict],
    );
  // Running = not yet decided: winning now, still mathematically on, or not kicked
  // off. Settled = the book is closed (won / refunded / can't-win / lost).
  const isRunning = (v: LiveVerdict) => v === "winning" || v === "alive" || v === "scheduled";
  const running = graded.filter((p) => isRunning(p.verdict.verdict));
  const settled = graded.filter((p) => !isRunning(p.verdict.verdict));
  // Staked sum covers the VISIBLE parlays only, matching the count badge —
  // out-of-window parlays (filtered at the call site) keep their money in the
  // global Net P&L headline.
  const stake = graded.reduce((s, p) => s + p.special.stake, 0);
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
            <span className="flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-wider">
              {liveCount > 0 && <span className="text-acid">{liveCount} live</span>}
              {won > 0 && <span className="text-acid">{won} <StatAbbr code="W" className="text-acid" /></span>}
              {lost > 0 && <span className="text-rose">{lost} <StatAbbr code="L" className="text-rose" /></span>}
            </span>
          )}
        </div>
        <span className="tnum font-mono text-[0.68rem] text-faint/70">
          {money(stake, currency)} staked
          {secured > 0 && <> · <span className="font-semibold text-acid">{money(secured, currency)} secured</span></>}
        </span>
      </div>

      {running.length > 0 ? (
        <div className="space-y-5">
          <p className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-faint/70">
            Running · {running.length}
          </p>
          {/* Grouped by knockout round so e.g. all Round-of-32 parlays sit
              together under one labelled header — they no longer scatter by
              whichever calendar day each one's first leg happens to fall on. */}
          {(() => {
            const groups = new Map<string, typeof running>();
            for (const p of running) {
              const label = roundLabel(ROUND_BY_MATCH.get(p.anchorMatchId));
              if (!groups.has(label)) groups.set(label, []);
              groups.get(label)!.push(p);
            }
            // Order the round groups by their biggest parlay (high → low) so the
            // group holding the largest potential win sits on top, matching the
            // within-group descending order. Round rank breaks ties.
            const groupTop = (ps: typeof running) =>
              ps.reduce((mx, p) => Math.max(mx, p.special.potential), 0);
            const ordered = [...groups.entries()].sort(
              (a, b) => groupTop(b[1]) - groupTop(a[1]) || roundRank(a[0]) - roundRank(b[0]),
            );
            return ordered.map(([label, ps]) => (
              <div key={label} className="space-y-3">
                <p className="flex items-center gap-2 font-mono text-[0.6rem] uppercase tracking-[0.18em] text-acid">
                  {label}
                  <span className="rounded-full border border-acid-dim/50 bg-acid/10 px-1.5 py-0.5 text-[0.56rem] font-semibold tnum text-acid">
                    {ps.length}
                  </span>
                </p>
                {ps.map((p) => (
                  <AccaCard key={p.special.id} special={p.special} verdict={p.verdict} currency={currency} live={live} />
                ))}
              </div>
            ));
          })()}
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
            <span className="flex items-center gap-2.5 font-mono text-[0.7rem] uppercase tracking-wider">
              {won > 0 && <span className="text-acid">{won} <StatAbbr code="W" className="text-acid" /></span>}
              {lost > 0 && <span className="text-rose">{lost} <StatAbbr code="L" className="text-rose" /></span>}
              <span className="text-faint/70">{showSettled ? "Hide" : "Show"}</span>
            </span>
          </button>
          {showSettled && (
            <div className="mt-3 space-y-3">
              {settled.map((p) => (
                <AccaCard key={p.special.id} special={p.special} verdict={p.verdict} currency={currency} live={live} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** Compact MYT label for a fixture not on the betting slip (betted matches carry
 *  their own server-built kickoffLabel). Intl with an explicit timeZone is stable
 *  across SSR + client, so no hydration drift. */
function mytKick(utc: string): string {
  if (!utc) return "Time TBC";
  return new Date(utc).toLocaleString("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** A 3-letter code for a team name, mirroring the server's code() so non-betted
 *  fixtures read the same as betted ones. */
function teamCode(name: string): string {
  return name.replace(/[^a-z]/gi, "").slice(0, 3).toUpperCase();
}

/** Every game in a knockout round, shown ONCE — including fixtures with no bet on
 *  the slip (those never become a MatchRow, so the day sections below can't show
 *  them). Answers "show all games for the round": all 16 ties, live score when a
 *  match is on, kickoff time otherwise, and a marker for the ones carrying action. */
function RoundGames({
  round,
  live,
  days,
  parlays,
}: {
  round: string;
  live: Record<string, LiveMatch | undefined>;
  days: DayRow[];
  parlays: { special: SpecialRow; anchorMatchId: string }[];
}) {
  const fixtures = FIXTURES.filter((f) => f.round === round).sort(
    (a, b) => new Date(a.kickoffUTC).getTime() - new Date(b.kickoffUTC).getTime(),
  );
  if (fixtures.length === 0) return null;

  // Everything in this round-grid is scoped to Rj's LATEST placement batch — the
  // set of (non-mirror) specials sharing the most-recent placedAt date. Per-match
  // badges therefore reconcile with the "latest batch · N parlays · M singles"
  // chip below, instead of summing every slip ever placed. (placedAt is
  // "DD/MM HH:MM"; rank by MM*100+DD so 01/07 sorts after 30/06.)
  const dateRank = (p: string) => {
    const [dd, mm] = (p.split(" ")[0] ?? "").split("/").map(Number);
    return (mm || 0) * 100 + (dd || 0);
  };
  const allSpecials = days.flatMap((d) => d.matches.flatMap((m) => m.specials)).filter((s) => !s.mirror);
  const latest = allSpecials.length ? Math.max(...allSpecials.map((s) => dateRank(s.placedAt))) : -1;
  const inBatch = (s: SpecialRow) => dateRank(s.placedAt) === latest;

  // Singles per match: this match's own non-parlay specials from the latest batch.
  // (Regular score bets are an earlier, undated slip — out of batch, not counted.)
  const singlesByMatch = new Map<string, number>();
  for (const d of days)
    for (const m of d.matches) {
      const n = m.specials.filter((s) => !s.mirror && !isParlayRow(s) && inBatch(s)).length;
      if (n > 0) singlesByMatch.set(m.matchId, (singlesByMatch.get(m.matchId) ?? 0) + n);
    }
  // Parlays per match: only latest-batch parlays that use the tie as a leg.
  const parlaysByMatch = new Map<string, number>();
  for (const p of parlays) {
    if (!inBatch(p.special)) continue;
    const legs = (p.special.grade as { legs?: { matchId?: string }[] }).legs ?? [];
    const touched = new Set(legs.map((l) => l.matchId).filter(Boolean) as string[]);
    for (const id of touched) parlaysByMatch.set(id, (parlaysByMatch.get(id) ?? 0) + 1);
  }

  const withAction = fixtures.filter((f) => singlesByMatch.has(f.id) || parlaysByMatch.has(f.id)).length;

  // Header chip split for the latest batch (de-duped by slip).
  let batchParlays = 0;
  let batchSingles = 0;
  if (latest >= 0) {
    const seen = new Set<string>();
    for (const s of allSpecials) {
      if (!inBatch(s) || seen.has(s.slipNo)) continue;
      seen.add(s.slipNo);
      if (isParlayRow(s)) batchParlays++;
      else batchSingles++;
    }
  }

  return (
    <section className="rounded-3xl border border-line bg-pitch-2/40 p-4 sm:p-6">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line/60 pb-3.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="font-mono text-[0.66rem] uppercase tracking-[0.2em] text-acid">{round}</span>
          <span className="rounded-full border border-line bg-card/40 px-2 py-0.5 font-mono text-[0.58rem] font-semibold uppercase tracking-wider text-faint">
            {fixtures.length} games
          </span>
          {(batchParlays > 0 || batchSingles > 0) && (
            <span className="rounded-full border border-acid-dim/50 bg-acid/10 px-2 py-0.5 font-mono text-[0.58rem] font-semibold uppercase tracking-wider text-acid">
              latest batch · {batchParlays} parlay{batchParlays !== 1 ? "s" : ""} · {batchSingles} single
              {batchSingles !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <span className="font-mono text-[0.66rem] tracking-wider text-faint/70 tnum">
          {withAction} with a bet on
        </span>
      </div>
      <p className="mb-4 font-mono text-[0.6rem] leading-relaxed text-faint/60">
        Per-match badges show your latest batch only — the parlays and singles you just placed. Earlier slips and
        standalone score bets aren&apos;t counted here.
      </p>

      <ul className="divide-y divide-line/50">
        {fixtures.map((f) => {
          const lm = live[f.id];
          const sc = lm?.score;
          const finished = lm?.state === "finished";
          const onNow = lm?.state === "live" || lm?.state === "halftime";
          const singles = singlesByMatch.get(f.id) ?? 0;
          const inParlays = parlaysByMatch.get(f.id) ?? 0;
          return (
            <li key={f.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-semibold text-ink">
                  <span aria-hidden>{f.home.flag}</span>
                  <span className="tnum">{teamCode(f.home.name)}</span>
                  <span className="text-faint">v</span>
                  <span aria-hidden>{f.away.flag}</span>
                  <span className="tnum">{teamCode(f.away.name)}</span>
                </p>
                <p className="mt-0.5 truncate font-mono text-[0.64rem] text-faint/70">
                  {mytKick(f.kickoffUTC)} MYT · {f.city}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2.5">
                {singles > 0 && (
                  <span className="rounded-full border border-acid-dim/50 bg-acid/10 px-2 py-0.5 font-mono text-[0.56rem] font-semibold uppercase tracking-wider text-acid">
                    {singles} bet{singles > 1 ? "s" : ""}
                  </span>
                )}
                {inParlays > 0 && (
                  <span className="rounded-full border border-line bg-card/40 px-2 py-0.5 font-mono text-[0.56rem] uppercase tracking-wider text-muted">
                    {inParlays} parlay{inParlays > 1 ? "s" : ""}
                  </span>
                )}
                {sc ? (
                  <span
                    className={`tnum font-mono text-sm font-semibold ${finished ? "text-ink" : onNow ? "text-amber" : "text-faint"}`}
                  >
                    {sc.home}–{sc.away}
                    <span className="ml-1.5 text-[0.7rem] uppercase tracking-wider text-faint/70">
                      {finished ? <StatAbbr code="FT" className="text-faint/70" /> : onNow ? (lm?.minute ? `${lm.minute}'` : "live") : ""}
                    </span>
                  </span>
                ) : (
                  <span className="font-mono text-[0.64rem] uppercase tracking-wider text-faint">
                    {new Date(f.kickoffUTC).toLocaleString("en-GB", {
                      timeZone: "Asia/Kuala_Lumpur",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    })}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
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
  lm,
}: {
  special: SpecialRow;
  verdict: InPlay;
  currency: string;
  lm?: LiveMatch | undefined;
}) {
  const dim = verdict.verdict === "lost" || verdict.verdict === "dead";
  // Player-prop live involvement — for a scorer/assist prop, show the named
  // player's goal + assist tally straight off the match feed, so the slip
  // carries its own "how's my player doing" line, not just the verdict note.
  const player = special.grade && "player" in special.grade ? special.grade.player : undefined;
  const tally = player && lm && lm.state !== "scheduled" ? playerTally(lm, player) : null;
  return (
    <SpotlightCard tone={verdictTone(verdict.verdict)} className="rounded-2xl p-4 pl-5 sm:p-5 sm:pl-6">
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
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {tally && (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-mint/30 bg-mint/[0.07] px-2 py-0.5 font-mono text-[0.7rem] font-semibold text-mint tnum">
            {player}: {tally.goals} goal{tally.goals === 1 ? "" : "s"} · {tally.assists} assist{tally.assists === 1 ? "" : "s"}
          </span>
        )}
        {verdict.note && (
          <span className="font-mono text-[0.66rem] text-faint/70">{verdict.note}</span>
        )}
      </div>
    </SpotlightCard>
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
    <SpotlightCard tone={verdictTone(verdict.verdict)} className="rounded-2xl p-4 pl-5 sm:p-5 sm:pl-6">
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
    </SpotlightCard>
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
          {g.penalty && <span className="text-amber" title="Penalty">(pen)</span>}
          {g.ownGoal && <span className="text-rose" title="Own goal">(own goal)</span>}
          {g.assist && <span className="text-faint">· {g.assist}</span>}
        </li>
      ))}
    </ul>
  );
}

/** One home–away count cell in the StatLine strip. Module-scope (not inline in
 *  StatLine) so React doesn't remount it — and lint doesn't flag it — per render. */
function Cell({ label, h, a, sub }: { label: string; h: number; a: number; sub?: string }) {
  return (
    <span className="inline-flex flex-col items-center gap-1">
      <span className="inline-flex items-baseline gap-1.5">
        <span className="text-acid tnum font-semibold">{h}</span>
        <span className="text-faint">–</span>
        <span className="text-mint tnum font-semibold">{a}</span>
      </span>
      <StatAbbr code={label} className="text-[0.7rem] text-ink/55" />
      {sub && <span className="text-[0.7rem] text-ink/50">{sub}</span>}
    </span>
  );
}

/** Verified ESPN counts (corners / on-target / shots / cards) for a match. */
function StatLine({ live, m }: { live: LiveMatch; m: MatchRow }) {
  const s = live.stats;
  if (!s) return null;
  const yel = s.yellow.home + s.yellow.away;
  const red = s.red.home + s.red.away;
  const cardSub = [
    yel > 0 ? `${yel} yellow` : null,
    red > 0 ? `${red} red` : null,
  ].filter(Boolean).join(" · ");
  return (
    <div className="mt-2.5 font-mono">
      <div className="mb-1.5 text-[0.7rem] uppercase tracking-[0.14em] text-ink/55">
        Match stats — <span className="text-acid">{m.home.code}</span> (home) vs{" "}
        <span className="text-mint">{m.away.code}</span> (away)
      </div>
      <div className="flex flex-wrap items-start gap-x-5 gap-y-2.5 text-[0.66rem]">
        <Cell label="Corners" h={s.corners.home} a={s.corners.away} />
        <Cell label="On target" h={s.sot.home} a={s.sot.away} />
        <Cell label="Shots" h={s.shots.home} a={s.shots.away} />
        {s.tempo && (
          <>
            <Cell label="Tackles" h={s.tempo.tackles.home} a={s.tempo.tackles.away} />
            <Cell label="Blocks" h={s.tempo.blockedShots.home} a={s.tempo.blockedShots.away} />
            <Cell label="Saves" h={s.tempo.saves.home} a={s.tempo.saves.away} />
          </>
        )}
        {s.fouls && <Cell label="Fouls" h={s.fouls.home} a={s.fouls.away} />}
        <Cell label="Cards" h={s.cards.home} a={s.cards.away} sub={cardSub || undefined} />
      </div>
    </div>
  );
}

function Performance({ rows }: { rows: InPlay[] }) {
  const won = rows.filter((r) => r.verdict === "won").length;
  const lost = rows.filter((r) => r.verdict === "lost" || r.verdict === "dead").length;
  const refunded = rows.filter((r) => r.verdict === "void").length;
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[0.72rem] uppercase tracking-wider">
      <span className="text-acid">{won} <StatAbbr code="W" className="text-acid" /></span>
      <span className="text-faint">·</span>
      <span className="text-rose">{lost} <StatAbbr code="L" className="text-rose" /></span>
      {refunded > 0 && (
        <>
          <span className="text-faint">·</span>
          <span className="text-amber">{refunded} <StatAbbr code="R" className="text-amber" /></span>
        </>
      )}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export default function LiveTracker({ base, activeNav }: { base: TrackerBase; activeNav: NavKey }) {
  const { live, updatedAt, pollFast, nextRefreshAt, refreshing, refresh } = useLive(base);

  // ── Explicit parlay ↔ live-event link ──────────────────────────────────────
  // The match FX (goals, chips) fire off the raw feed. THIS ties them to the
  // slip: which fixtures Rj actually has action on, and — the real link — the
  // moment a live event settles a specific leg.

  // The tracker is the live hub: the match FX (goal firecrackers, GOAL banners,
  // tempo chips) fires for EVERY live fixture — exactly what the match/home FX
  // shows — so a burst lands whenever any game is in play, not only when the
  // slip has action. (The explicit slip link is the leg-settlement chips below,
  // which stay scoped to the parlay legs via legBatch.)
  const fxMatches = useMemo(() => Object.values(live), [live]);

  // Every match Rj actually has action on — a single-leg bet/special OR any leg
  // of a cross-match parlay — so the spotlight can tag "On your slip".
  const betMatchIds = useMemo(() => {
    const s = new Set<string>();
    for (const d of base.days)
      for (const m of d.matches) {
        if (m.bets.length > 0 || m.specials.some((x) => !x.mirror)) s.add(m.matchId);
        for (const sp of m.specials) {
          const legs = (sp.grade as { legs?: { matchId?: string }[] } | undefined)?.legs;
          if (Array.isArray(legs)) for (const l of legs) if (l.matchId) s.add(l.matchId);
        }
      }
    return s;
  }, [base.days]);

  // Open bet/special labels per match — the spotlight's player-shots strip
  // matches player names against these to pin + highlight tracked shooters
  // ("Bruno Fernandes Over 0.5 shots" pins Bruno's live line to the top).
  // Cross-match acca labels fan out to every leg's matchId, same as betMatchIds.
  // Per-leg PLAYER names fan out too — a parlay naming five players is one
  // label, and the zero-attempt pin resolves one player per entry, so each
  // player leg must land as its own entry or only the first ever pins.
  const openLabelsByMatch = useMemo(() => {
    const m: Record<string, string[]> = {};
    const add = (id: string, label: string) => (m[id] ??= []).push(label);
    for (const d of base.days)
      for (const g of d.matches) {
        for (const b of g.bets) if (b.staticStatus === "pending") add(g.matchId, b.label);
        for (const sp of g.specials) {
          if (sp.staticStatus !== "pending" || sp.mirror) continue;
          add(g.matchId, sp.label);
          const grade = sp.grade as
            | { player?: string; players?: string[]; legs?: { matchId?: string; player?: string; players?: string[] }[] }
            | undefined;
          if (grade?.player) add(g.matchId, grade.player);
          for (const p of grade?.players ?? []) add(g.matchId, p);
          if (Array.isArray(grade?.legs))
            for (const l of grade.legs) {
              const mid = l.matchId ?? g.matchId;
              if (l.matchId) add(l.matchId, sp.label);
              if (l.player) add(mid, l.player);
              for (const p of l.players ?? []) add(mid, p);
            }
        }
      }
    return m;
  }, [base.days]);

  // Every leg's live verdict glyph this poll, keyed by (match · pick). Reuses the
  // exact grader the leg grid renders from (gradeSpecial → parseLegs), so a leg
  // event can never disagree with how the slip is actually settling.
  const legSnapshot = useMemo(() => {
    const snap: Record<string, LegSnap> = {};
    for (const d of base.days)
      for (const m of d.matches)
        for (const s of m.specials) {
          if (s.mirror || !isAccaRow(s)) continue;
          const ip = gradeSpecial(s, live[m.matchId], live);
          const parsed = parseLegs(ip.note);
          if (!parsed) continue;
          const rawLegs = ((s.grade as { legs?: { matchId?: string }[] }).legs) ?? [];
          if (rawLegs.length !== parsed.length) continue; // can't align → skip
          for (let i = 0; i < parsed.length; i++) {
            const mid = rawLegs[i].matchId;
            if (!mid) continue;
            // A leg settling is a LIVE moment only while its match is in play. Gating
            // here means a leg event fires when a goal/whistle flips it mid-match —
            // not on page load, where every historical leg's not-started→settled
            // hydration would otherwise replay as a burst of stale "leg dead" chips.
            const st = live[mid]?.state;
            if (st !== "live" && st !== "halftime") continue;
            snap[legKey(mid, parsed[i].label)] = {
              matchId: mid,
              label: parsed[i].label,
              glyph: parsed[i].glyph,
              slipNo: s.slipNo,
              market: s.market,
            };
          }
        }
    return snap;
  }, [base.days, live]);

  // Diff poll-to-poll → flash the settled rows + fire leg chips through the FX.
  const prevLegSnap = useRef<Record<string, LegSnap> | null>(null);
  const [flashedLegs, setFlashedLegs] = useState<Set<string>>(() => new Set());
  const [legBatch, setLegBatch] = useState<{ id: number; events: LegEvent[] }>({ id: 0, events: [] });
  useEffect(() => {
    const prev = prevLegSnap.current;
    prevLegSnap.current = legSnapshot;
    const evs = diffLegEvents(prev, legSnapshot);
    if (!evs.length) return;
    const keys = evs.map((e) => legKey(e.matchId, e.label));
    setFlashedLegs((cur) => {
      const n = new Set(cur);
      keys.forEach((k) => n.add(k));
      return n;
    });
    setLegBatch((b) => ({ id: b.id + 1, events: evs }));
    const t = setTimeout(() => {
      setFlashedLegs((cur) => {
        const n = new Set(cur);
        keys.forEach((k) => n.delete(k));
        return n;
      });
    }, 1800);
    return () => clearTimeout(t);
  }, [legSnapshot]);
  const cur = base.meta.currency;
  const totalToday = base.counts.score + base.counts.props;
  const totalSeason = base.season.counts.score + base.season.counts.props;
  const empty = totalSeason === 0;

  // 7-day display window (see windowCutoffKey): day sections and parlays older
  // than the cutoff key don't render. Keyed off base.featuredKey so the same
  // HTML comes out of the server and the client.
  const cutoffKey = windowCutoffKey(base.featuredKey);
  // Which MYT betting day each match sits on — parlays are windowed by their
  // LATEST leg's day, so a slip stays visible as long as any leg is recent.
  const dayKeyByMatch = new Map<string, string>();
  for (const d of base.days) for (const m of d.matches) dayKeyByMatch.set(m.matchId, d.key);
  const inWindow = (matchIds: string[]) => {
    // "tbd" (undated) keys sort after any date string → undated slips stay visible.
    const latest = matchIds.reduce((mx, id) => {
      const k = dayKeyByMatch.get(id) ?? "";
      return k > mx ? k : mx;
    }, "");
    return latest === "" || latest >= cutoffKey;
  };

  // Every multi-leg parlay across ALL days, surfaced ONCE in a single top-level
  // roll-up (GlobalParlays). `isParlayRow` keeps the real copy only (drops the
  // cross-match mirrors) and excludes lone 1-leg "accas", which stay inline on
  // their own game card. Anchored to the match the real copy lives on. Parlays
  // whose every leg predates the 7-day window are dropped from view here.
  // Latest MYT betting day across a parlay's legs (same basis as inWindow).
  const latestDay = (matchIds: string[]) =>
    matchIds.reduce((mx, id) => {
      const k = dayKeyByMatch.get(id) ?? "";
      return k > mx ? k : mx;
    }, "");
  // Rj (2026-07-09): the per-day "Earlier rounds" list hides pre-today LOSSES, but
  // this whole-tournament parlay roll-up kept its OWN "Settled · N" drawer listing
  // every busted group-stage acca — that's the "76 settled bets" still showing. Drop
  // pre-today LOST parlays here too so the two surfaces agree. Today's (featured-day)
  // losses stay visible; money summaries still grade the full slip (display-only).
  const isPastLostParlay = (special: SpecialRow, legIds: string[]) => {
    if (special.staticStatus !== "lost") return false;
    const day = latestDay(legIds.length > 0 ? legIds : []);
    return day !== "" && day < base.featuredKey;
  };
  let hiddenLostParlays = 0;
  const allParlays = base.days
    .flatMap((d) =>
      d.matches.flatMap((m) =>
        m.specials.filter((s) => isParlayRow(s)).map((s) => ({ special: s, anchorMatchId: m.matchId })),
      ),
    )
    .filter((p) => {
      const legIds = ((p.special.grade as { legs?: { matchId?: string }[] }).legs ?? [])
        .map((l) => l.matchId)
        .filter((id): id is string => Boolean(id));
      if (!inWindow(legIds.length > 0 ? legIds : [p.anchorMatchId])) return false;
      if (isPastLostParlay(p.special, legIds.length > 0 ? legIds : [p.anchorMatchId])) {
        hiddenLostParlays += 1;
        return false;
      }
      return true;
    });

  // Live "if it ended now" P&L — scoped to today's featured slate, matching the
  // staked / max-return figures in the hero (season roll-up lives below).
  const heroDays = base.days.filter((d) => d.isFeatured);
  // Liveness drives the P&L basis, so determine it FIRST (before accumulating).
  // Doing it inline meant a late-slate live match couldn't retroactively fix the
  // basis of earlier bets already summed in the same pass.
  let anyMatchLive = false;
  for (const d of heroDays) {
    for (const m of d.matches) {
      const lm = live[m.matchId];
      if (lm && (lm.state === "live" || lm.state === "halftime")) { anyMatchLive = true; break; }
    }
    if (anyMatchLive) break;
  }
  // • A match is live → strict "if it ended now" projection (liveLeans): alive
  //   legs count as losing, on-track legs as winning — the whistle-blows-now view.
  // • Nothing live → realised-only (realisedLeans): a partially-played acca books
  //   0 until every leg finishes, so the "Net P&L" headline is money settled, not
  //   an optimistic best-case from one finished leg of a not-started parlay.
  const leanFn = anyMatchLive ? liveLeans : realisedLeans;
  let livePnl = 0;
  let securedReturns = 0;
  for (const d of heroDays) {
    for (const m of d.matches) {
      const lm = live[m.matchId];
      for (const b of m.bets) {
        const v = gradeBet(b, lm).verdict;
        const lean = leanFn(v);
        if (lean === "win") livePnl += b.potential - b.stake;
        else if (lean === "lose") livePnl -= b.stake;
        if (v === "won") securedReturns += b.potential;
        else if (v === "void") securedReturns += b.stake; // refund — stake handed back
      }
      for (const s of m.specials) {
        if (s.mirror) continue; // counted on its home card only
        const v = gradeSpecial(s, lm, live).verdict;
        const lean = leanFn(v);
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
    <LegFlashContext.Provider value={flashedLegs}>
    <main className="mx-auto max-w-5xl px-4 pb-24 sm:px-6">
      {/* Live-event reactions — the tracker is the live hub: firecrackers on goals
       * + tempo chips for EVERY live fixture (fxMatches), plus leg-settlement
       * chips the moment a live event clinches / kills / half-covers a specific
       * parlay leg on the slip (legBatch — the explicit parlay link). */}
      <LiveEventFX matches={fxMatches} legBatch={legBatch} />
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

      {/* Match-FX section — fronts the next fixture with a live countdown, then
       * flips to a live scoreline + inline play-by-play the moment it kicks off.
       * The full-screen firecracker FX (above) still fires; this is the standing
       * "what's on / what's next" centrepiece. */}
      <div className="mt-8">
        <MatchSpotlight live={live} betMatchIds={betMatchIds} openLabels={openLabelsByMatch} />
      </div>

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
        <section id="chapter-parlays" className="mt-14 scroll-mt-24">
          <ChapterHead
            no="01"
            title="The Parlays"
            sub="Every multi-leg slip across the tournament, biggest potential return first — running slips lead, settled ones tuck into the drawer."
          />
          <GlobalParlays parlays={allParlays} live={live} currency={cur} />
          {hiddenLostParlays > 0 && (
            <p className="mt-3 font-mono text-[0.62rem] uppercase tracking-wider text-faint/70">
              {hiddenLostParlays} lost parlay{hiddenLostParlays > 1 ? "s" : ""} from earlier days hidden
            </p>
          )}
        </section>
      )}

      {/* Every game in the current knockout round, including ties with no bet on
          the slip. The active round = the least-advanced knockout round that still
          has an unfinished game (Round of 32 right now), so it advances on its own
          as the tournament progresses. */}
      {!empty &&
        (() => {
          const knockoutRounds = [...new Set(FIXTURES.map((f) => f.round).filter((r): r is string => !!r))];
          if (knockoutRounds.length === 0) return null;
          const activeRound =
            knockoutRounds
              .sort((a, b) => roundRank(b) - roundRank(a)) // least-advanced first
              .find((r) => FIXTURES.some((f) => f.round === r && live[f.id]?.state !== "finished")) ??
            knockoutRounds.sort((a, b) => roundRank(a) - roundRank(b))[0];
          return (
            <section id="chapter-round" className="mt-16 scroll-mt-24 border-t-2 border-line/60 pt-10">
              <ChapterHead
                no="02"
                title="The Round"
                sub="Every tie in the live knockout round — live score when a match is on, kickoff time otherwise, and which of them your latest slip is riding on."
              />
              <RoundGames round={activeRound} live={live} days={base.days} parlays={allParlays} />
            </section>
          );
        })()}

      {!empty && (
        <div id="chapter-slips" className="mt-16 scroll-mt-24 border-t-2 border-line/60 pt-10">
          <ChapterHead
            no="03"
            title="The Daily Slips"
            sub="Your slate broken out day by day in Malaysia time — each match card settles line by line off the live score, biggest potential return on top."
          />
        </div>
      )}
      <div className="mt-8 space-y-12">
        {(() => {
          const renderDay = (day: DayRow) => {
          // Order cards by their biggest potential winning (high → low) so the
          // largest returns sit on top. A card's winning amount = the max payout
          // across its own non-mirror bets/specials; schedule-only cards (no bet)
          // fall to 0 and sink to the bottom. Kickoff time breaks ties.
          const topPotential = (m: MatchRow) => {
            const rows = [
              ...m.bets,
              ...m.specials.filter((s) => !s.mirror),
            ];
            return rows.reduce((mx, r) => Math.max(mx, r.potential), 0);
          };
          const sorted = [...day.matches].sort(
            (a, b) =>
              topPotential(b) - topPotential(a) ||
              new Date(a.kickoffUTC).getTime() - new Date(b.kickoffUTC).getTime(),
          );
          // Stage badge for the day header: knockout days carry one round (R16 /
          // Quarter-final …); group-stage days show "Group stage". A day that
          // straddles rounds (rare) reads "Knockouts".
          const dayRounds = [...new Set(day.matches.map((m) => m.round).filter(Boolean))] as string[];
          const stageLabel =
            dayRounds.length === 1 ? dayRounds[0] : dayRounds.length > 1 ? "Knockouts" : "Group stage";
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
                  <span className="self-center rounded-full border border-acid-dim/50 bg-acid/10 px-2 py-0.5 font-mono text-[0.56rem] font-semibold uppercase tracking-wider text-acid">
                    {stageLabel}
                  </span>
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
                              <span className="inline-flex items-center gap-1.5 font-mono text-[0.7rem] uppercase tracking-[0.18em] text-amber">
                                <span className="size-1.5 animate-pulse rounded-full bg-amber motion-reduce:animate-none" />
                                {lm.state === "halftime" ? "Half-time" : `Live ${lm.statusDetail}`} · goals so far
                              </span>
                              <Performance rows={allV} />
                            </div>
                            <Legend
                              items={[
                                { swatch: "acid", term: "W — legs won" },
                                { swatch: "rose", term: "L — legs lost" },
                                { swatch: "amber", term: "R — refunded (void)" },
                              ]}
                            />
                            <div className="mt-2.5">
                              <GoalLog live={lm} m={m} />
                            </div>
                            <StatLine live={lm} m={m} />
                            {lm.stats?.players?.length ? (
                              <PlayerSheetToggle lm={lm} home={m.home} away={m.away} />
                            ) : null}
                          </div>
                        )}

                        {/* End-of-game performance banner */}
                        {finished && lm && (
                          <div className="border-b border-line bg-pitch-2/50 px-5 py-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-acid">Full-time · how it landed</span>
                              <Performance rows={allV} />
                            </div>
                            <Legend
                              items={[
                                { swatch: "acid", term: "W — legs won" },
                                { swatch: "rose", term: "L — legs lost" },
                                { swatch: "amber", term: "R — refunded (void)" },
                              ]}
                            />
                            <div className="mt-2.5">
                              <GoalLog live={lm} m={m} />
                            </div>
                            <StatLine live={lm} m={m} />
                            {lm.stats?.players?.length ? (
                              <PlayerSheetToggle lm={lm} home={m.home} away={m.away} />
                            ) : null}
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
                                <AccaCard key={r.id} special={r} verdict={accaVerdicts[i]} currency={cur} live={live} withGameHeader={false} />
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
                                <PropCard key={r.id} special={r as SpecialRow} verdict={propVerdicts[i]} currency={cur} lm={lm} />
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
          // 7-day window: past days older than the cutoff don't render at all —
          // not even inside "Earlier rounds". A faint tally below keeps it honest.
          const inDayWindow = (d: DayRow) => d.key === "tbd" || d.key >= cutoffKey;
          const olderDays = base.days.filter((d) => !d.isFeatured && isPast(d) && !inDayWindow(d));
          const olderBets = olderDays.reduce(
            (s, d) => s + d.matches.reduce((x, m) => x + m.bets.length + m.specials.filter((sp) => !sp.mirror).length, 0),
            0,
          );
          const featured = base.days.filter((d) => d.isFeatured);
          // The forward schedule reads chronologically: today (featured) → soonest
          // upcoming → latest. base.days is stored newest-first, so re-sort the
          // upcoming slate ASCENDING by date key ("tbd" undated bucket sinks last).
          const upcoming = base.days
            .filter((d) => !d.isFeatured && !isPast(d))
            .sort((a, b) =>
              a.key === "tbd" ? 1 : b.key === "tbd" ? -1 : a.key.localeCompare(b.key),
            );
          // Settled history stays newest-first inside the folded "Earlier rounds" —
          // trimmed to the 7-day window; anything older is gone from view.
          // Rj (2026-07-09): hide LOST slips from earlier (pre-today) days — settled
          // losses on past rounds just clutter the history. Wins / pushes / voids on
          // those days stay; today's (featured) day keeps its losses visible so the
          // running result reads true. Money summaries still grade the full slip, so
          // this is display-only — a faint tally below keeps the pruning honest.
          const isLostBet = (b: BetRow) => b.staticStatus === "lost";
          const isLostSpecial = (s: SpecialRow) => s.staticStatus === "lost";
          const stripLostDay = (d: DayRow): DayRow => ({
            ...d,
            matches: d.matches
              .map((m) => ({
                ...m,
                bets: m.bets.filter((b) => !isLostBet(b)),
                specials: m.specials.filter((s) => !isLostSpecial(s)),
              }))
              .filter((m) => m.bets.length + m.specials.length > 0),
          });
          const pastRaw = base.days.filter((d) => !d.isFeatured && isPast(d) && inDayWindow(d));
          const hiddenLost = pastRaw.reduce(
            (s, d) =>
              s +
              d.matches.reduce(
                (x, m) =>
                  x +
                  m.bets.filter(isLostBet).length +
                  m.specials.filter((sp) => !sp.mirror && isLostSpecial(sp)).length,
                0,
              ),
            0,
          );
          const past = pastRaw.map(stripLostDay).filter((d) => d.matches.length > 0);
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
              {/* Out-of-window tally — hidden days still exist in the data (and in
                  every money summary); this one line keeps the pruning honest. */}
              {olderBets > 0 && (
                <p className="font-mono text-[0.62rem] uppercase tracking-wider text-faint/70">
                  {olderBets} older bet{olderBets > 1 ? "s" : ""} hidden · showing last {WINDOW_DAYS} days
                </p>
              )}
              {hiddenLost > 0 && (
                <p className="font-mono text-[0.62rem] uppercase tracking-wider text-faint/70">
                  {hiddenLost} lost bet{hiddenLost > 1 ? "s" : ""} from earlier days hidden
                </p>
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
    </LegFlashContext.Provider>
  );
}

// Live/half-time first, upcoming next, finished last.
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

/** Re-order rows and their verdicts together by winning amount (potential payout),
 *  highest first — so the biggest-return line always sits at the top of a card.
 *  Verdict (won → live → lost) is the tiebreaker among equal payouts, and original
 *  order breaks any remaining ties (stable), so ordering stays deterministic. */
function orderByVerdict<T extends { potential?: number }>(
  rows: T[],
  verdicts: InPlay[],
): { rows: T[]; verdicts: InPlay[] } {
  const idx = rows.map((_, i) => i);
  idx.sort((a, b) => {
    const pa = rows[a].potential ?? 0;
    const pb = rows[b].potential ?? 0;
    if (pb !== pa) return pb - pa; // winning amount, high → low
    return VERDICT_ORDER[verdicts[a].verdict] - VERDICT_ORDER[verdicts[b].verdict];
  });
  return { rows: idx.map((i) => rows[i]), verdicts: idx.map((i) => verdicts[i]) };
}
