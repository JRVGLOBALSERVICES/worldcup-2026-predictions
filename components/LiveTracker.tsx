"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { LiveMatch } from "@/lib/live";
import type { BetStatus, SpecialGrade } from "@/lib/bets";
import { inPlayBet, inPlaySpecial, liveLeans, type InPlay, type LiveVerdict } from "@/lib/inplay";
import { RefreshCountdown } from "./RefreshCountdown";

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
};
export type MatchRow = {
  matchId: string;
  home: { name: string; flag: string; code: string };
  away: { name: string; flag: string; code: string };
  group: string;
  kickoffUTC: string;
  kickoffLabel: string; // "21:00 MYT (9:00 PM ET)"
  staticResult: { ht: { home: number; away: number } | null; ft: { home: number; away: number } | null };
  bets: BetRow[];
  specials: SpecialRow[];
};
export type DayRow = { key: string; label: string; matches: MatchRow[] };
export type TrackerBase = {
  meta: { owner: string; currency: string; note: string; disclaimer: string; placedLabel: string };
  counts: { score: number; props: number };
  staked: number;
  potential: number;
  days: DayRow[];
};

// ─────────────────────────────────────────────────────────────────────────────
function money(n: number, currency: string) {
  return `${currency}${n.toFixed(2)}`;
}

/** Static fallback when no live feed exists — read the cron-filled JSON status. */
function fromStatic(s: BetStatus): InPlay {
  return {
    verdict: s === "won" ? "won" : s === "lost" ? "lost" : "scheduled",
    note: s === "won" ? "Won" : s === "lost" ? "Lost" : "Awaiting result",
  };
}
function gradeBet(b: BetRow, lm: LiveMatch | undefined): InPlay {
  return lm ? inPlayBet(b, lm) : fromStatic(b.staticStatus);
}
function gradeSpecial(s: SpecialRow, lm: LiveMatch | undefined): InPlay {
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
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      let anyLive = false;
      try {
        const res = await fetch("/api/live", { cache: "no-store" });
        if (res.ok) {
          const data: LivePayload = await res.json();
          if (!cancelled) {
            setLive(data.matches ?? {});
            setUpdatedAt(data.updatedAt ?? Date.now());
            anyLive = !!data.anyLive;
          }
        }
      } catch {
        /* keep last known; try again next tick */
      }
      if (cancelled) return;
      const near = nearLiveWindow(base.days, Date.now());
      const fast = anyLive || near;
      setPollFast(fast);
      // Stop entirely once nothing is live and nothing is near (saves the idle heartbeat).
      const delay = fast ? 5000 : near ? 30000 : 0;
      if (delay > 0) {
        setNextRefreshAt(Date.now() + delay);
        timer.current = setTimeout(tick, delay);
      } else {
        setNextRefreshAt(null);
      }
    }

    tick();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [base.days]);

  return { live, updatedAt, pollFast, nextRefreshAt };
}

// ── pills ─────────────────────────────────────────────────────────────────────
function VerdictPill({ verdict }: { verdict: LiveVerdict }) {
  const map: Record<LiveVerdict, { label: string; cls: string; dot: string; pulse?: boolean }> = {
    won: { label: "Won", cls: "bg-acid/15 text-acid", dot: "bg-acid" },
    lost: { label: "Lost", cls: "bg-rose/15 text-rose", dot: "bg-rose" },
    winning: { label: "Winning now", cls: "bg-acid/15 text-acid", dot: "bg-acid", pulse: true },
    alive: { label: "Still on", cls: "bg-amber/15 text-amber", dot: "bg-amber", pulse: true },
    dead: { label: "Can't win now", cls: "bg-rose/10 text-rose", dot: "bg-rose" },
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

function Stat({ label, value, tone = "ink" }: { label: string; value: string; tone?: "ink" | "acid" | "rose" | "muted" | "amber" }) {
  const toneMap = { ink: "text-ink", acid: "text-acid", rose: "text-rose", muted: "text-muted", amber: "text-amber" } as const;
  return (
    <div className="rounded-2xl border border-line bg-card/50 px-4 py-3">
      <p className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-faint">{label}</p>
      <p className={`tnum mt-1 font-display text-2xl font-black tracking-tight ${toneMap[tone]}`}>{value}</p>
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

function Performance({ rows }: { rows: InPlay[] }) {
  const won = rows.filter((r) => r.verdict === "won").length;
  const lost = rows.filter((r) => r.verdict === "lost" || r.verdict === "dead").length;
  return (
    <span className="font-mono text-[0.66rem] uppercase tracking-wider">
      <span className="text-acid">{won}W</span> · <span className="text-rose">{lost}L</span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export default function LiveTracker({ base }: { base: TrackerBase }) {
  const { live, updatedAt, pollFast, nextRefreshAt } = useLive(base);
  const cur = base.meta.currency;

  // Live "if it ended now" P&L across every line that has a verdict.
  let livePnl = 0;
  let securedReturns = 0;
  let anyMatchLive = false;
  for (const d of base.days) {
    for (const m of d.matches) {
      const lm = live[m.matchId];
      if (lm && (lm.state === "live" || lm.state === "halftime")) anyMatchLive = true;
      for (const b of m.bets) {
        const v = gradeBet(b, lm).verdict;
        const lean = liveLeans(v);
        if (lean === "win") livePnl += b.potential - b.stake;
        else if (lean === "lose") livePnl -= b.stake;
        if (v === "won") securedReturns += b.potential;
      }
      for (const s of m.specials) {
        const v = gradeSpecial(s, lm).verdict;
        const lean = liveLeans(v);
        if (lean === "win") livePnl += s.potential - s.stake;
        else if (lean === "lose") livePnl -= s.stake;
        if (v === "won") securedReturns += s.potential;
      }
    }
  }

  const pnlTone = livePnl > 0 ? "acid" : livePnl < 0 ? "rose" : "muted";
  const pnlValue = `${livePnl > 0 ? "+" : ""}${money(livePnl, cur)}`;

  return (
    <main className="mx-auto max-w-5xl px-4 pb-24 sm:px-6">
      <header className="flex items-center justify-between py-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-acid font-display text-lg font-black text-pitch">⚽</span>
          <span className="font-display text-base font-extrabold uppercase tracking-tight">Matchday Edge</span>
        </Link>
        <nav className="flex items-center gap-4 font-mono text-[0.66rem] uppercase tracking-[0.18em]">
          <Link href="/" className="text-faint transition-colors hover:text-ink">Predictions</Link>
          <span className="text-acid">Tracker</span>
        </nav>
      </header>

      <section className="stripes overflow-hidden rounded-3xl border border-line bg-pitch-2/60 p-6 sm:p-10">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <p className="font-mono text-[0.72rem] uppercase tracking-[0.24em] text-acid">
            Bet tracker · {base.meta.owner}&rsquo;s slip
          </p>
          {anyMatchLive && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber/15 px-2.5 py-0.5 font-mono text-[0.62rem] font-semibold uppercase tracking-wider text-amber">
              <span className="size-1.5 animate-pulse rounded-full bg-amber motion-reduce:animate-none" /> Live · updating every 5s
            </span>
          )}
        </div>
        <h1 className="max-w-3xl font-display text-4xl font-black uppercase leading-[0.95] tracking-tight sm:text-5xl">
          {base.counts.score + base.counts.props} bets. One slip. Settled live.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted">
          Every stake tracked in Malaysia time. While a match is on, each line updates second-by-second —
          green when it&rsquo;s winning, amber while it&rsquo;s still alive, red once it can&rsquo;t land.
        </p>

        <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Total staked" value={money(base.staked, cur)} />
          <Stat label={anyMatchLive ? "If it ended now" : "Net P&L"} value={pnlValue} tone={pnlTone} />
          <Stat label="Secured returns" value={money(securedReturns, cur)} tone="acid" />
          <Stat label="Max return" value={money(base.potential, cur)} tone="acid" />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 font-mono text-[0.66rem] text-faint">
          <span className="rounded-full border border-line px-2.5 py-1">Placed {base.meta.placedLabel} MYT</span>
          <span className="rounded-full border border-line px-2.5 py-1">{base.counts.score} score · {base.counts.props} props</span>
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
        </div>
      </section>

      <div className="mt-10 space-y-12">
        {base.days.map((day) => {
          const sorted = [...day.matches].sort((a, b) => rank(live[a.matchId]) - rank(live[b.matchId]));
          return (
            <section key={day.key}>
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line/60 pb-2">
                <h2 className="font-display text-lg font-extrabold uppercase tracking-tight text-ink">{day.label}</h2>
                <span className="font-mono text-[0.66rem] uppercase tracking-wider text-faint tnum">
                  {day.matches.reduce((n, m) => n + m.bets.length + m.specials.length, 0)} bets
                </span>
              </div>

              <div className="space-y-4">
                {sorted.map((m) => {
                  const lm = live[m.matchId];
                  const finished = lm?.state === "finished";
                  const betVerdicts = m.bets.map((b) => gradeBet(b, lm));
                  const spVerdicts = m.specials.map((s) => gradeSpecial(s, lm));
                  const allV = [...betVerdicts, ...spVerdicts];
                  // Float winning lines to the top, still-on next, losses last.
                  const orderedBets = orderByVerdict(m.bets, betVerdicts);
                  const orderedSpecials = orderByVerdict(m.specials, spVerdicts);
                  const matchStaked = [...m.bets, ...m.specials].reduce((x, r) => x + r.stake, 0);
                  const matchReturned = [...m.bets, ...m.specials].filter((_, i) => allV[i]?.verdict === "won").reduce((x, r) => x + r.potential, 0);

                  return (
                    <details key={m.matchId} open={!finished} className="group overflow-hidden rounded-3xl border border-line bg-card/40 [&_summary::-webkit-details-marker]:hidden">
                      <summary className="flex cursor-pointer select-none flex-wrap items-center justify-between gap-3 bg-pitch-2/40 px-5 py-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-display text-lg font-extrabold uppercase tracking-tight">{m.home.flag} {m.home.name}</span>
                            <LiveScore live={lm} m={m} />
                            <span className="font-display text-lg font-extrabold uppercase tracking-tight">{m.away.name} {m.away.flag}</span>
                          </div>
                          <p className="mt-1 font-mono text-[0.66rem] uppercase tracking-wider text-faint">
                            Group {m.group} · {m.kickoffLabel}
                          </p>
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

                        <RowList title={null} rows={orderedBets.rows} verdicts={orderedBets.verdicts} currency={cur} chip={(r) => (r as BetRow).period} chipCls={(r) => ((r as BetRow).period === "HT" ? "bg-mint/15 text-mint" : "bg-acid/15 text-acid")} />

                        {m.specials.length > 0 && (
                          <div className="border-t border-line">
                            <div className="flex items-center gap-2 bg-pitch-2/50 px-5 py-2.5">
                              <span className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-mint">Player props</span>
                              <span className="rounded-full border border-mint/40 px-2 py-0.5 font-mono text-[0.56rem] uppercase tracking-wider text-mint">1xBet · live grade</span>
                            </div>
                            <RowList title={null} rows={orderedSpecials.rows} verdicts={orderedSpecials.verdicts} currency={cur} chip={(r) => (r as SpecialRow).market} chipCls={() => "bg-mint/15 text-mint"} />
                          </div>
                        )}
                      </div>
                    </details>
                  );
                })}
              </div>
            </section>
          );
        })}
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
  dead: 4,
  lost: 5,
};

/** Re-order rows and their verdicts together by status. Stable within a bucket,
 *  so a match's original bet order is preserved among equal verdicts. */
function orderByVerdict<T>(rows: T[], verdicts: InPlay[]): { rows: T[]; verdicts: InPlay[] } {
  const idx = rows.map((_, i) => i);
  idx.sort((a, b) => VERDICT_ORDER[verdicts[a].verdict] - VERDICT_ORDER[verdicts[b].verdict]);
  return { rows: idx.map((i) => rows[i]), verdicts: idx.map((i) => verdicts[i]) };
}

function RowList({
  rows,
  verdicts,
  currency,
  chip,
  chipCls,
}: {
  title: string | null;
  rows: (BetRow | SpecialRow)[];
  verdicts: InPlay[];
  currency: string;
  chip: (r: BetRow | SpecialRow) => string;
  chipCls: (r: BetRow | SpecialRow) => string;
}) {
  return (
    <ul className="divide-y divide-line/60">
      {rows.map((r, i) => {
        const v = verdicts[i] ?? { verdict: "scheduled" as LiveVerdict, note: "" };
        const dim = v.verdict === "lost" || v.verdict === "dead";
        return (
          <li key={r.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 px-5 py-3.5 sm:grid-cols-[1fr_auto_auto_auto]">
            <div className="min-w-0">
              <div className="flex items-start gap-2">
                <span className={`mt-0.5 shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[0.58rem] font-semibold uppercase tracking-wider ${chipCls(r)}`}>{chip(r)}</span>
                <span className="text-sm text-ink">{r.label}</span>
              </div>
              {v.note && (
                <span className="mt-1 block font-mono text-[0.62rem] text-faint">{v.note}</span>
              )}
              <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[0.62rem] sm:hidden">
                <span className="text-faint">Stake <span className="tnum text-muted">{money(r.stake, currency)}</span></span>
                <span className="text-faint">@ <span className="tnum text-muted">{r.odds.toFixed(2)}</span></span>
                <span className="text-faint">Win <span className={`tnum ${v.verdict === "won" ? "text-acid" : dim ? "text-faint line-through" : "text-ink"}`}>{money(r.potential, currency)}</span></span>
              </span>
            </div>
            <span className="tnum order-2 hidden text-right font-mono text-sm text-muted sm:order-none sm:block">{r.odds.toFixed(2)}</span>
            <span className={`tnum hidden text-right font-mono text-sm sm:block ${v.verdict === "won" ? "text-acid" : dim ? "text-faint line-through" : "text-ink"}`}>{money(r.potential, currency)}</span>
            <span className="order-3 flex justify-end sm:order-none"><VerdictPill verdict={v.verdict} /></span>
          </li>
        );
      })}
    </ul>
  );
}
