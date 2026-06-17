import Link from "next/link";
import type { Metadata } from "next";
import { mytTime, etTime, mytDayLabel, mytDayKey, kickoffState } from "@/lib/data";
import {
  betSlip,
  settleAll,
  slipTotals,
  groupByMatch,
  settleSpecials,
  specialsTotals,
  mergeTotals,
  money,
  type SettledBet,
  type MatchResult,
} from "@/lib/bets";
import type { Fixture } from "@/lib/types";

export const revalidate = 300; // re-settle every 5 min as results land

export const metadata: Metadata = {
  title: "Bet Tracker",
  description:
    "Live correct-score bet tracker in Malaysia time — stake, odds, potential return and win/loss settled off the final and half-time scores.",
  robots: { index: false, follow: true },
};

function code(name: string): string {
  return name.replace(/[^a-z]/gi, "").slice(0, 3).toUpperCase();
}

function StatusPill({ status }: { status: SettledBet["status"] }) {
  if (status === "won")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-acid/15 px-2.5 py-0.5 font-mono text-[0.62rem] font-semibold uppercase tracking-wider text-acid">
        <span className="size-1.5 rounded-full bg-acid" /> Won
      </span>
    );
  if (status === "lost")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-rose/15 px-2.5 py-0.5 font-mono text-[0.62rem] font-semibold uppercase tracking-wider text-rose">
        <span className="size-1.5 rounded-full bg-rose" /> Lost
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5 font-mono text-[0.62rem] uppercase tracking-wider text-faint">
      <span className="size-1.5 rounded-full bg-faint" /> Pending
    </span>
  );
}

function ScoreReadout({ result, fixture }: { result: MatchResult; fixture: Fixture | undefined }) {
  if (!fixture) return null;
  const h = code(fixture.home.name);
  const a = code(fixture.away.name);
  const cell = (s: { home: number; away: number } | null, label: string) => (
    <div className="flex items-baseline gap-2">
      <span className="font-mono text-[0.6rem] uppercase tracking-wider text-faint">{label}</span>
      <span className="tnum font-mono text-sm text-ink">
        {s ? `${s.home}–${s.away}` : "––"}
      </span>
    </div>
  );
  return (
    <div className="flex items-center gap-4">
      {cell(result.ht, "HT")}
      {cell(result.ft, "FT")}
      <span className="font-mono text-[0.6rem] text-faint">
        {h}–{a}
      </span>
    </div>
  );
}

function KickoffState({ iso, nowMs }: { iso: string; nowMs: number }) {
  const { state } = kickoffState(iso, nowMs);
  if (state === "live")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber/15 px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-wider text-amber">
        <span className="size-1.5 animate-pulse rounded-full bg-amber" /> Live
      </span>
    );
  if (state === "finished")
    return (
      <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-wider text-faint">
        Finished
      </span>
    );
  return (
    <span className="rounded-full border border-acid-dim px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-wider text-acid">
      Upcoming
    </span>
  );
}

function Chevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="size-4 shrink-0 text-faint transition-transform duration-300 group-open:rotate-180"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function Stat({ label, value, tone = "ink" }: { label: string; value: string; tone?: "ink" | "acid" | "rose" | "muted" }) {
  const toneMap = { ink: "text-ink", acid: "text-acid", rose: "text-rose", muted: "text-muted" } as const;
  return (
    <div className="rounded-2xl border border-line bg-card/50 px-4 py-3">
      <p className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-faint">{label}</p>
      <p className={`tnum mt-1 font-display text-2xl font-black tracking-tight ${toneMap[tone]}`}>{value}</p>
    </div>
  );
}

export default function Tracker() {
  const settled = settleAll();
  const totals = slipTotals(settled);
  const groups = groupByMatch(settled);
  const specials = settleSpecials();
  const now = Date.now();

  // Slip-wide totals INCLUDING player props — the top bar must show the true
  // all-in figure (score bets + props), not just the 12 correct-score lines.
  const allTotals = mergeTotals(totals, specialsTotals(specials));

  // Player props belong UNDER the match they're on — bucket them by matchId so
  // each match card carries its own props instead of a detached section.
  const specialsByMatch = new Map<string, typeof specials>();
  for (const s of specials) {
    if (!specialsByMatch.has(s.matchId)) specialsByMatch.set(s.matchId, []);
    specialsByMatch.get(s.matchId)!.push(s);
  }

  // Bucket matches into MYT days (kickoff order preserved from groupByMatch).
  const dayOrder: string[] = [];
  const dayMap = new Map<string, { label: string; groups: typeof groups }>();
  for (const g of groups) {
    const iso = g.fixture?.kickoffUTC;
    const key = iso ? mytDayKey(iso) : "tbd";
    if (!dayMap.has(key)) {
      dayMap.set(key, { label: iso ? mytDayLabel(iso) : "Date TBC", groups: [] });
      dayOrder.push(key);
    }
    dayMap.get(key)!.groups.push(g);
  }
  const days = dayOrder.map((key) => ({ key, ...dayMap.get(key)! }));

  const placed = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(betSlip.meta.placedAt));

  const settledPnlTone = allTotals.settledPnl > 0 ? "acid" : allTotals.settledPnl < 0 ? "rose" : "muted";
  const pnlValue = `${allTotals.settledPnl > 0 ? "+" : ""}${money(allTotals.settledPnl)}`;

  return (
    <main className="mx-auto max-w-5xl px-4 pb-24 sm:px-6">
      <header className="flex items-center justify-between py-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-acid font-display text-lg font-black text-pitch">
            ⚽
          </span>
          <span className="font-display text-base font-extrabold uppercase tracking-tight">
            Matchday Edge
          </span>
        </Link>
        <nav className="flex items-center gap-4 font-mono text-[0.66rem] uppercase tracking-[0.18em]">
          <Link href="/" className="text-faint transition-colors hover:text-ink">
            Predictions
          </Link>
          <span className="text-acid">Tracker</span>
        </nav>
      </header>

      <section className="stripes overflow-hidden rounded-3xl border border-line bg-pitch-2/60 p-6 sm:p-10">
        <p className="mb-4 font-mono text-[0.72rem] uppercase tracking-[0.24em] text-acid">
          Bet tracker · {betSlip.meta.owner}&rsquo;s slip
        </p>
        <h1 className="max-w-3xl font-display text-4xl font-black uppercase leading-[0.95] tracking-tight sm:text-5xl">
          {allTotals.count} bets. One slip. Settled in real time.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted">
          Every stake placed on the four Jun 18 fixtures, tracked in Malaysia time. Each line settles
          itself the moment the half-time and full-time scores are in — green for a hit, red for a
          miss.
        </p>

        <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Total staked" value={money(allTotals.staked)} />
          <Stat label="Total bets" value={`${allTotals.count}`} tone="ink" />
          <Stat label="Max return" value={money(allTotals.potential)} tone="acid" />
          <Stat label="Settled P&L" value={pnlValue} tone={settledPnlTone} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 font-mono text-[0.66rem] text-faint">
          <span className="rounded-full border border-line px-2.5 py-1">Placed {placed} MYT</span>
          <span className="rounded-full border border-line px-2.5 py-1">
            {totals.count} score · {specials.length} props · all RM10
          </span>
          <span className="rounded-full border border-line px-2.5 py-1">
            {allTotals.won}W · {allTotals.lost}L · {allTotals.pending}P
          </span>
          <span className="rounded-full border border-line px-2.5 py-1">Returns = stake × odds</span>
        </div>
      </section>

      <div className="mt-10 space-y-12">
        {days.map((day) => {
          const settledInDay = day.groups.filter(
            (g) => g.fixture && kickoffState(g.fixture.kickoffUTC, now).state === "finished",
          ).length;
          // Day-level summary (score bets + player props) — "total for today".
          const dayLines = [
            ...day.groups.flatMap((g) => g.bets),
            ...day.groups.flatMap((g) => specialsByMatch.get(g.matchId) ?? []),
          ];
          const dayCount = dayLines.length;
          const dayStaked = dayLines.reduce((s, b) => s + b.stake, 0);
          const dayPotential = dayLines.reduce((s, b) => s + b.potential, 0);
          return (
            <section key={day.key}>
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line/60 pb-2">
                <h2 className="font-display text-lg font-extrabold uppercase tracking-tight text-ink">
                  {day.label}
                </h2>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[0.66rem] uppercase tracking-wider text-faint">
                  <span className="tnum">
                    {dayCount} bets · staked <span className="text-muted">{money(dayStaked)}</span>
                  </span>
                  <span className="tnum">
                    max win <span className="text-acid">{money(dayPotential)}</span>
                  </span>
                  <span>{settledInDay}/{day.groups.length} settled</span>
                </div>
              </div>

              <div className="space-y-4">
                {[...day.groups]
                  .sort((a, b) => {
                    // Ended matches sink to the bottom; live/upcoming stay on top
                    // (kickoff order preserved within each bucket).
                    const ended = (g: (typeof day.groups)[number]) =>
                      g.fixture && kickoffState(g.fixture.kickoffUTC, now).state === "finished" ? 1 : 0;
                    return ended(a) - ended(b);
                  })
                  .map((g) => {
                  const f = g.fixture;
                  const finished = f ? kickoffState(f.kickoffUTC, now).state === "finished" : false;
                  const won = g.bets.filter((b) => b.status === "won").length;
                  const lost = g.bets.filter((b) => b.status === "lost").length;
                  const matchStaked = g.bets.reduce((s, b) => s + b.stake, 0);
                  const matchReturned = g.bets
                    .filter((b) => b.status === "won")
                    .reduce((s, b) => s + b.potential, 0);
                  const matchSpecials = specialsByMatch.get(g.matchId) ?? [];
                  const mSpStaked = matchSpecials.reduce((s, b) => s + b.stake, 0);
                  const mSpReturned = matchSpecials
                    .filter((b) => b.status === "won")
                    .reduce((s, b) => s + b.potential, 0);
                  const mSpPotential = matchSpecials.reduce((s, b) => s + b.potential, 0);
                  return (
                    <details
                      key={g.matchId}
                      open={!finished}
                      className="group overflow-hidden rounded-3xl border border-line bg-card/40 [&_summary::-webkit-details-marker]:hidden"
                    >
                      <summary className="flex cursor-pointer select-none flex-wrap items-center justify-between gap-3 bg-pitch-2/40 px-5 py-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-display text-lg font-extrabold uppercase tracking-tight">
                              {f ? `${f.home.flag} ${f.home.name}` : g.matchId}
                            </span>
                            <span className="font-mono text-xs text-faint">v</span>
                            <span className="font-display text-lg font-extrabold uppercase tracking-tight">
                              {f ? `${f.away.name} ${f.away.flag}` : ""}
                            </span>
                          </div>
                          {f && (
                            <p className="mt-1 font-mono text-[0.66rem] uppercase tracking-wider text-faint">
                              Group {f.group} · {mytTime(f.kickoffUTC)} MYT
                              <span className="text-muted"> ({etTime(f.kickoffUTC)} ET)</span>
                              {finished && (
                                <span className="text-muted">
                                  {" · "}
                                  <span className="text-acid">{won}W</span>
                                  {" · "}
                                  <span className="text-rose">{lost}L</span>
                                </span>
                              )}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex flex-col items-end gap-2">
                            {f && <KickoffState iso={f.kickoffUTC} nowMs={now} />}
                            <ScoreReadout result={g.result} fixture={f} />
                          </div>
                          <Chevron />
                        </div>
                      </summary>

                      <div className="border-t border-line">
                        <div className="hidden grid-cols-[1fr_auto_auto_auto_auto] gap-4 px-5 py-2.5 font-mono text-[0.6rem] uppercase tracking-wider text-faint sm:grid">
                          <span>Pick</span>
                          <span className="text-right">Odds</span>
                          <span className="text-right">Stake</span>
                          <span className="text-right">Returns</span>
                          <span className="text-right">Status</span>
                        </div>

                        <ul className="divide-y divide-line/60">
                          {g.bets.map((b) => (
                            <li
                              key={b.id}
                              className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 px-5 py-3.5 sm:grid-cols-[1fr_auto_auto_auto_auto]"
                            >
                              <div className="min-w-0">
                                <div className="flex items-start gap-2">
                                  <span
                                    className={`mt-0.5 shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[0.58rem] font-semibold uppercase tracking-wider ${
                                      b.period === "HT" ? "bg-mint/15 text-mint" : "bg-acid/15 text-acid"
                                    }`}
                                  >
                                    {b.period}
                                  </span>
                                  <span className="text-sm text-ink">{b.label}</span>
                                </div>
                                <span className="mt-1 block font-mono text-[0.62rem] text-faint">
                                  Target {f ? `${code(f.home.name)} ` : ""}
                                  <span className="tnum text-muted">
                                    {b.home}
                                    {"–"}
                                    {b.away}
                                  </span>
                                  {f ? ` ${code(f.away.name)}` : ""}
                                </span>
                                <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[0.62rem] sm:hidden">
                                  <span className="text-faint">
                                    Stake <span className="tnum text-muted">{money(b.stake)}</span>
                                  </span>
                                  <span className="text-faint">
                                    @ <span className="tnum text-muted">{b.odds.toFixed(2)}</span>
                                  </span>
                                  <span className="text-faint">
                                    Win{" "}
                                    <span
                                      className={`tnum ${
                                        b.status === "won"
                                          ? "text-acid"
                                          : b.status === "lost"
                                            ? "text-faint line-through"
                                            : "text-ink"
                                      }`}
                                    >
                                      {money(b.potential)}
                                    </span>
                                  </span>
                                </span>
                              </div>

                              <span className="tnum order-2 text-right font-mono text-sm text-muted sm:order-none">
                                {b.odds.toFixed(2)}
                              </span>
                              <span className="tnum hidden text-right font-mono text-sm text-muted sm:block">
                                {money(b.stake)}
                              </span>
                              <span
                                className={`tnum hidden text-right font-mono text-sm sm:block ${
                                  b.status === "won"
                                    ? "text-acid"
                                    : b.status === "lost"
                                      ? "text-faint line-through"
                                      : "text-ink"
                                }`}
                              >
                                {money(b.potential)}
                              </span>
                              <span className="order-3 flex justify-end sm:order-none">
                                <StatusPill status={b.status} />
                              </span>
                            </li>
                          ))}
                        </ul>

                        <div className="flex items-center justify-between border-t border-line bg-pitch-2/30 px-5 py-3 font-mono text-[0.66rem] text-faint">
                          <span className="uppercase tracking-wider">
                            {g.bets.length} bets · staked {money(matchStaked)}
                          </span>
                          <span className="tnum">
                            {matchReturned > 0 ? (
                              <span className="text-acid">Returned {money(matchReturned)}</span>
                            ) : (
                              <span>Max return {money(g.bets.reduce((s, b) => s + b.potential, 0))}</span>
                            )}
                          </span>
                        </div>

                        {matchSpecials.length > 0 && (
                          <div className="border-t border-line">
                            <div className="flex items-center gap-2 bg-pitch-2/50 px-5 py-2.5">
                              <span className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-mint">
                                Player props
                              </span>
                              <span className="rounded-full border border-mint/40 px-2 py-0.5 font-mono text-[0.56rem] uppercase tracking-wider text-mint">
                                1xBet · auto-settle
                              </span>
                              <span className="ml-auto font-mono text-[0.6rem] uppercase tracking-wider text-faint">
                                {matchSpecials.filter((s) => s.status !== "pending").length}/
                                {matchSpecials.length} settled
                              </span>
                            </div>

                            <div className="hidden grid-cols-[1fr_auto_auto_auto_auto] gap-4 px-5 py-2.5 font-mono text-[0.6rem] uppercase tracking-wider text-faint sm:grid">
                              <span>Selection</span>
                              <span className="text-right">Odds</span>
                              <span className="text-right">Stake</span>
                              <span className="text-right">Returns</span>
                              <span className="text-right">Status</span>
                            </div>

                            <ul className="divide-y divide-line/60">
                              {matchSpecials.map((s) => (
                                <li
                                  key={s.id}
                                  className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 px-5 py-3.5 sm:grid-cols-[1fr_auto_auto_auto_auto]"
                                >
                                  <div className="min-w-0">
                                    <div className="flex items-start gap-2">
                                      <span className="mt-0.5 shrink-0 rounded-sm bg-mint/15 px-1.5 py-0.5 font-mono text-[0.58rem] font-semibold uppercase tracking-wider text-mint">
                                        {s.market}
                                      </span>
                                      <span className="text-sm text-ink">{s.label}</span>
                                    </div>
                                    <span className="mt-1 block font-mono text-[0.62rem] text-faint">
                                      Slip №{s.slipNo} · placed {s.placedAt}
                                    </span>
                                    <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[0.62rem] sm:hidden">
                                      <span className="text-faint">
                                        Stake <span className="tnum text-muted">{money(s.stake)}</span>
                                      </span>
                                      <span className="text-faint">
                                        @ <span className="tnum text-muted">{s.odds.toFixed(2)}</span>
                                      </span>
                                      <span className="text-faint">
                                        Win{" "}
                                        <span
                                          className={`tnum ${
                                            s.status === "won"
                                              ? "text-acid"
                                              : s.status === "lost"
                                                ? "text-faint line-through"
                                                : "text-ink"
                                          }`}
                                        >
                                          {money(s.potential)}
                                        </span>
                                      </span>
                                    </span>
                                  </div>

                                  <span className="tnum order-2 text-right font-mono text-sm text-muted sm:order-none">
                                    {s.odds.toFixed(2)}
                                  </span>
                                  <span className="tnum hidden text-right font-mono text-sm text-muted sm:block">
                                    {money(s.stake)}
                                  </span>
                                  <span
                                    className={`tnum hidden text-right font-mono text-sm sm:block ${
                                      s.status === "won"
                                        ? "text-acid"
                                        : s.status === "lost"
                                          ? "text-faint line-through"
                                          : "text-ink"
                                    }`}
                                  >
                                    {money(s.potential)}
                                  </span>
                                  <span className="order-3 flex justify-end sm:order-none">
                                    <StatusPill status={s.status} />
                                  </span>
                                </li>
                              ))}
                            </ul>

                            <div className="flex items-center justify-between border-t border-line bg-pitch-2/30 px-5 py-3 font-mono text-[0.66rem] text-faint">
                              <span className="uppercase tracking-wider">
                                {matchSpecials.length} props · staked {money(mSpStaked)}
                              </span>
                              <span className="tnum">
                                {mSpReturned > 0 ? (
                                  <span className="text-acid">Returned {money(mSpReturned)}</span>
                                ) : (
                                  <span>Max return {money(mSpPotential)}</span>
                                )}
                              </span>
                            </div>
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
        <p className="max-w-2xl leading-relaxed text-muted">{betSlip.meta.note}</p>
        <p className="mt-3 max-w-2xl leading-relaxed">⚠️ {betSlip.meta.disclaimer}</p>
        <p className="mt-6 font-mono text-[0.66rem] uppercase tracking-[0.18em]">
          Matchday Edge · {betSlip.meta.owner}&rsquo;s slip · fun-money only
        </p>
      </footer>
    </main>
  );
}
