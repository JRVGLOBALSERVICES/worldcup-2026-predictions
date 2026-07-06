"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveMatch } from "@/lib/live";
import { diffLiveEvents, type LiveEvent } from "@/lib/liveEvents";
import type { LegEvent } from "@/lib/legEvents";
import { fixtures } from "@/lib/data";
import { useLive, useLiveMatch } from "./LiveProvider";

/**
 * Live-event reactions. Watches /api/live snapshots, diffs poll-to-poll via
 * lib/liveEvents.ts, and celebrates what actually happened:
 *   goal            → full-screen firecracker bursts in the scoring side's
 *                     accent + a GOAL banner (scorer · minute)
 *   everything else → terminal-style event chips sliding up from the bottom
 *                     (on/off target, blocked, save, corner, cards, foul,
 *                     offside, possession swing, KO/HT/FT)
 * Colour language follows the system: home = acid lime, away = cyan, cards in
 * amber/rose. Reduced-motion users get no particles and no animated chips —
 * the stat grid still updates. Append `?fxdemo=1` to any match URL to replay a
 * scripted sequence (visual QA without waiting for a live goal).
 */

// Canvas fillStyle can't read CSS custom properties, so the particle colours
// are hex twins of the oklch tokens in globals.css — the ONLY place raw values
// are allowed. Everything DOM-rendered references var(--color-*) tokens.
const TEAM = {
  home: { hex: "#c3f13d", text: "text-acid", edge: "var(--color-acid)" }, // acid
  away: { hex: "#83cbe0", text: "text-mint", edge: "var(--color-mint)" }, // mint (cyan)
} as const;
const AMBER = "var(--color-amber)";
const ROSE = "var(--color-rose)";

/** Leg-settlement chip vocabulary — the EXPLICIT parlay link. When a live event
 * settles a leg on your slip, this is what says so ("⚡ Leg clinched — Over 1.25").
 * Distinct from the match chips: a bolder glyph + a verdict-coloured edge, and
 * always the pick label so you know exactly which leg moved. */
const LEG_CHIP: Record<
  LegEvent["kind"],
  { glyph: string; label: string; edge: string }
> = {
  clinched: { glyph: "⚡", label: "Leg clinched", edge: "var(--color-acid)" },
  dead: { glyph: "✗", label: "Leg dead", edge: ROSE },
  halfWin: { glyph: "½", label: "Leg half-covered", edge: AMBER },
  halfLoss: { glyph: "½", label: "Leg half-down", edge: AMBER },
  void: { glyph: "↺", label: "Leg void · refunded", edge: AMBER },
};

const sentence = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const CHIP: Record<
  Exclude<LiveEvent["kind"], "goal">,
  { glyph: string; label: string }
> = {
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

type FlagPair = { home: string; away: string; homeName: string; awayName: string };
const flagsFor = (matchId: string): FlagPair => {
  const f = fixtures.find((x) => x.id === matchId);
  return {
    home: f?.home.flag ?? "",
    away: f?.away.flag ?? "",
    homeName: f?.home.name ?? "Home",
    awayName: f?.away.name ?? "Away",
  };
};

/* ── Firecracker particles ─────────────────────────────────────────────────
 * Hand-rolled (zero-dep) canvas burst: shells explode into ~70 sparks with
 * gravity + drag + end-of-life twinkle. A goal fires four shells staggered
 * across the top half of the viewport in the scoring side's accent + white. */
type Spark = {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; size: number; color: string;
};

function useFireworks() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sparks = useRef<Spark[]>([]);
  const raf = useRef<number>(0);
  const [active, setActive] = useState(false);

  // Frame function held in a ref and assigned in an effect (house pattern —
  // mirrors LiveProvider's `tick`) so it can re-schedule itself without a
  // self-referencing useCallback, which the react-hooks compiler rejects.
  const frame = useRef<() => void>(() => {});
  useEffect(() => {
    frame.current = () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const alive: Spark[] = [];
      for (const s of sparks.current) {
        s.life += 1;
        s.vy += 0.055; // gravity
        s.vx *= 0.985; // drag
        s.vy *= 0.985;
        s.x += s.vx;
        s.y += s.vy;
        const t = s.life / s.maxLife;
        if (t >= 1) continue;
        // fade out; twinkle in the last third
        let alpha = 1 - t;
        if (t > 0.66 && Math.random() < 0.35) alpha *= 0.3;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size * (1 - t * 0.5), 0, Math.PI * 2);
        ctx.fill();
        alive.push(s);
      }
      ctx.globalAlpha = 1;
      sparks.current = alive;
      if (alive.length) raf.current = requestAnimationFrame(() => frame.current());
      else setActive(false);
    };
  });

  const burst = useCallback(
    (color: string) => {
      if (typeof window === "undefined") return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      setActive(true);
      // Canvas mounts on the state flip — size + fire on the next frame.
      requestAnimationFrame(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
        canvas.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
        const shell = (delay: number) =>
          setTimeout(() => {
            const cx = (0.2 + Math.random() * 0.6) * window.innerWidth;
            const cy = (0.18 + Math.random() * 0.35) * window.innerHeight;
            const palette = [color, "#ffffff", color, color];
            for (let i = 0; i < 72; i++) {
              const ang = Math.random() * Math.PI * 2;
              const speed = 1.5 + Math.random() * 5.5;
              sparks.current.push({
                x: cx,
                y: cy,
                vx: Math.cos(ang) * speed,
                vy: Math.sin(ang) * speed - 0.8,
                life: 0,
                maxLife: 60 + Math.random() * 45,
                size: 1.6 + Math.random() * 1.8,
                color: palette[i % palette.length],
              });
            }
            cancelAnimationFrame(raf.current);
            raf.current = requestAnimationFrame(() => frame.current());
          }, delay);
        [0, 260, 520, 820].forEach(shell);
      });
    },
    [],
  );

  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  return { canvasRef, burst, active };
}

/* ── Overlay state ───────────────────────────────────────────────────────── */
type Chip = { id: number; out: boolean } & (
  | { ev: LiveEvent; flags: FlagPair; leg?: undefined }
  | { leg: LegEvent; ev?: undefined; flags?: undefined }
);
type Banner = {
  id: number;
  team: "home" | "away";
  title: string;
  detail: string;
  flags: FlagPair;
};

let nextId = 1;

/**
 * The FX engine. Feed it every live match visible on the page — it keeps a
 * per-match previous snapshot, diffs on each poll, and renders one shared
 * overlay (banner top, chips bottom, fireworks full-screen).
 */
export function LiveEventFX({
  matches,
  legBatch,
}: {
  matches: LiveMatch[];
  /** Freshly-diffed leg settlements from the tracker. `id` bumps only when a
   * new batch arrives, so re-renders never re-announce a stale batch. */
  legBatch?: { id: number; events: LegEvent[] };
}) {
  const prev = useRef<Record<string, LiveMatch>>({});
  const [chips, setChips] = useState<Chip[]>([]);
  const [banner, setBanner] = useState<Banner | null>(null);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { canvasRef, burst, active } = useFireworks();

  // Leg-settlement chips — the explicit slip link. Pushed onto the same bottom
  // chip stack as match events, styled distinctly (LEG_CHIP). A leg dying gets a
  // longer dwell than an on-target chip: it's money, not tempo. One callback for
  // the whole batch (mirrors `announce`) so the effect calls setState once.
  const showLegChips = useCallback((legs: LegEvent[]) => {
    for (const leg of legs) {
      const chip: Chip = { id: nextId++, leg, out: false };
      setChips((cs) => [...cs.slice(-4), chip]);
      setTimeout(() => setChips((cs) => cs.map((c) => (c.id === chip.id ? { ...c, out: true } : c))), 5200);
      setTimeout(() => setChips((cs) => cs.filter((c) => c.id !== chip.id)), 5700);
    }
  }, []);

  const lastLegBatch = useRef(0);
  useEffect(() => {
    if (!legBatch || legBatch.id === lastLegBatch.current) return;
    lastLegBatch.current = legBatch.id;
    showLegChips(legBatch.events);
  }, [legBatch, showLegChips]);

  const announce = useCallback(
    (evs: LiveEvent[], matchId: string) => {
      const flags = flagsFor(matchId);
      for (const ev of evs) {
        if (ev.kind === "goal") {
          const team = ev.team ?? "home";
          burst(TEAM[team].hex);
          const title = ev.ownGoal ? "OWN GOAL" : ev.penalty ? "PENALTY GOAL" : "GOAL";
          const scorer = ev.player ? ev.player : team === "home" ? flags.homeName : flags.awayName;
          const detail = [
            team === "home" ? flags.home : flags.away,
            scorer,
            ev.minute != null ? `${ev.minute}'` : "",
            ev.assist ? `· assist ${ev.assist}` : "",
          ]
            .filter(Boolean)
            .join(" ");
          if (bannerTimer.current) clearTimeout(bannerTimer.current);
          const b: Banner = { id: nextId++, team, title, detail, flags };
          setBanner(b);
          bannerTimer.current = setTimeout(() => setBanner((cur) => (cur?.id === b.id ? null : cur)), 4600);
        } else {
          const chip: Chip = { id: nextId++, ev, flags, out: false };
          setChips((cs) => [...cs.slice(-4), chip]);
          setTimeout(() => setChips((cs) => cs.map((c) => (c.id === chip.id ? { ...c, out: true } : c))), 4200);
          setTimeout(() => setChips((cs) => cs.filter((c) => c.id !== chip.id)), 4700);
        }
      }
    },
    [burst],
  );

  // Diff every visible match on each poll. First sighting of a match is the
  // baseline (diffLiveEvents returns [] without a prev) — never announced.
  const matchesRef = useRef(matches);
  useEffect(() => {
    matchesRef.current = matches;
    for (const m of matches) {
      const evs = diffLiveEvents(prev.current[m.matchId], m);
      prev.current[m.matchId] = m;
      if (evs.length) announce(evs, m.matchId);
    }
  }, [matches, announce]);

  // ?fxdemo=1 — scripted sequence for visual QA (no live goal required).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!new URLSearchParams(window.location.search).has("fxdemo")) return;
    // Resolve the fixture at FIRE time (via ref) — the first poll usually
    // hasn't landed when this mounts, and a mount-time capture would fall
    // back to fixtures[0] and flag the wrong teams.
    const matchId = () => matchesRef.current[0]?.matchId ?? fixtures[0].id;
    const seq: [number, LiveEvent][] = [
      [600, { kind: "kickoff" }],
      [1400, { kind: "goal", team: "home", player: "Demo Striker", minute: 23, assist: "Demo Winger" }],
      [3200, { kind: "sot", team: "away" }],
      [4400, { kind: "shotOff", team: "home" }],
      [5600, { kind: "save", team: "away" }],
      [6800, { kind: "corner", team: "home" }],
      [8000, { kind: "yellow", team: "away", player: "Demo Enforcer", minute: 41 }],
      [9200, { kind: "possession", team: "home", value: 61 }],
      [10400, { kind: "goal", team: "away", player: "Demo Poacher", minute: 55, penalty: true }],
    ];
    const timers = seq.map(([t, ev]) => setTimeout(() => announce([ev], matchId()), t));
    // Leg-settlement chips — the explicit slip link — replayed alongside.
    const legSeq: [number, LegEvent][] = [
      [2100, { kind: "clinched", matchId: matchId(), label: "Over 1.25 goals", glyph: "✓", slipNo: "3", market: "Acca (3)" }],
      [7400, { kind: "halfWin", matchId: matchId(), label: "Paraguay +0.75", glyph: "½✓", slipNo: "3", market: "Acca (3)" }],
      [11200, { kind: "dead", matchId: matchId(), label: "Norway -0.75", glyph: "✗", slipNo: "3", market: "Acca (3)" }],
    ];
    const legTimers = legSeq.map(([t, ev]) => setTimeout(() => showLegChips([ev]), t));
    return () => [...timers, ...legTimers].forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {active && (
        <canvas
          ref={canvasRef}
          aria-hidden
          className="pointer-events-none fixed inset-0 z-[70] h-full w-full"
        />
      )}

      {banner && (
        <div
          key={banner.id}
          aria-live="polite"
          className="goal-banner pointer-events-none fixed inset-x-0 top-[16vh] z-[71] flex flex-col items-center px-4 text-center"
        >
          <div
            className={`font-display text-[clamp(2.4rem,12vw,4.75rem)] font-black uppercase leading-none tracking-tight ${TEAM[banner.team].text}`}
            style={{
              textShadow: `0 0 42px color-mix(in oklch, ${TEAM[banner.team].edge} 40%, transparent), 0 0 12px color-mix(in oklch, ${TEAM[banner.team].edge} 27%, transparent)`,
            }}
          >
            {banner.title}
          </div>
          <div className="mt-3 rounded-full border border-line bg-pitch-2/90 px-4 py-1.5 font-mono text-[0.72rem] uppercase tracking-[0.16em] text-ink backdrop-blur">
            {banner.detail}
          </div>
        </div>
      )}

      {chips.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[71] flex flex-col items-center gap-1.5 px-4">
          {chips.map((c) => (
            <EventChip key={c.id} chip={c} />
          ))}
        </div>
      )}
    </>
  );
}

function EventChip({ chip }: { chip: Chip }) {
  const { out } = chip;

  // Leg-settlement chip — a slip verdict, not a pitch event. Bolder edge, the
  // pick label, and a slip tag so it's unmistakably about YOUR bet.
  if (chip.leg) {
    const leg = chip.leg;
    const m = LEG_CHIP[leg.kind];
    return (
      <div
        className={`chip-in flex items-center gap-2 rounded-full border border-line bg-pitch-2/95 py-1.5 pl-2 pr-3.5 font-mono text-[0.66rem] uppercase tracking-[0.14em] text-ink shadow-lg backdrop-blur transition-[opacity,transform] duration-500 ${out ? "translate-y-2 opacity-0" : ""}`}
        style={{ boxShadow: `inset 3px 0 0 0 ${m.edge}` }}
      >
        <span className="text-sm leading-none" style={{ color: m.edge }}>{m.glyph}</span>
        <span className="font-semibold">{m.label}</span>
        <span className="text-ink/60 normal-case tracking-normal">{sentence(leg.label)}</span>
        {leg.slipNo && <span className="text-faint/50">· slip {leg.slipNo}</span>}
      </div>
    );
  }

  const { ev, flags } = chip;
  const meta = CHIP[ev.kind as keyof typeof CHIP];
  if (!meta) return null;
  const team = ev.team;
  const edge =
    ev.kind === "yellow" ? AMBER : ev.kind === "red" ? ROSE : team ? TEAM[team].edge : "rgb(255 255 255 / 0.25)";
  const detail =
    ev.kind === "possession" && ev.value != null
      ? `${team === "home" ? flags.homeName : flags.awayName} ${ev.value}%`
      : [
          team ? (team === "home" ? flags.home : flags.away) : "",
          ev.player ?? (team ? (team === "home" ? flags.homeName : flags.awayName) : ""),
          ev.minute != null ? `${ev.minute}'` : "",
        ]
          .filter(Boolean)
          .join(" ");
  return (
    <div
      className={`chip-in flex items-center gap-2 rounded-full border border-line bg-pitch-2/95 py-1.5 pl-2 pr-3.5 font-mono text-[0.66rem] uppercase tracking-[0.14em] text-ink shadow-lg backdrop-blur transition-[opacity,transform] duration-500 ${out ? "translate-y-2 opacity-0" : ""}`}
      style={{ boxShadow: `inset 3px 0 0 0 ${edge}` }}
    >
      <span className="text-sm leading-none">{meta.glyph}</span>
      <span className="font-semibold">{meta.label}</span>
      {detail && <span className="text-ink/60">{detail}</span>}
    </div>
  );
}

/** Context wrapper — FX for ONE fixture (match detail page). */
export function MatchEventFX({ matchId }: { matchId: string }) {
  const lm = useLiveMatch(matchId);
  return <LiveEventFX matches={lm ? [lm] : []} />;
}

/** Context wrapper — FX for EVERY live fixture on the page (home grid). */
export function AllMatchesEventFX() {
  const { matches } = useLive();
  return <LiveEventFX matches={Object.values(matches)} />;
}
