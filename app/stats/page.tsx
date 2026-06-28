import type { Metadata } from "next";
import { SiteNav } from "@/components/SiteNav";
import { StatsBoards } from "@/components/StatsBoards";
import { getStats } from "@/lib/stats";

// Snapshotted from ESPN by scripts/build-stats.mjs and committed; re-read the
// file every 30 min on Vercel so a fresh push surfaces without a full redeploy.
// The in-page "Force update" button recomputes the boards live via /api/stats.
export const revalidate = 1800;

export const metadata: Metadata = {
  title: "Tournament Stats — World Cup 2026 Leaders",
  description:
    "Live World Cup 2026 leaderboards in Malaysia time — top scorers, assists, clean sheets, cards, penalties, plus team completion stats: pass completion, possession, shot, tackle, cross and long-ball accuracy. Pulled from the official match feed.",
};

export default function StatsPage() {
  const initial = getStats();

  return (
    <main className="mx-auto max-w-5xl px-4 pb-24 sm:px-6">
      <header className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-acid font-display text-lg font-black text-pitch">
            ⚽
          </span>
          <span className="font-display text-base font-extrabold uppercase tracking-tight">
            Matchday Edge
          </span>
        </div>
        <SiteNav active="stats" />
      </header>

      <section className="stripes overflow-hidden rounded-3xl border border-line bg-pitch-2/60 p-6 sm:p-10">
        <p className="mb-4 font-mono text-[0.72rem] uppercase tracking-[0.24em] text-acid">
          World Cup 2026 · tournament leaders
        </p>
        <h1 className="max-w-3xl font-display text-4xl font-black uppercase leading-[0.95] tracking-tight sm:text-6xl">
          The race for the Golden Boot.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
          Top scorers, assists, clean sheets, the cards table and penalties scored vs missed — then
          the team completion boards below: pass, shot, tackle, cross and long-ball accuracy plus
          possession. Every number pulled straight from the official match feed, ranked top ten, in
          Malaysia time.
        </p>
      </section>

      <StatsBoards initial={initial} />

      <p className="mt-10 font-mono text-[0.62rem] uppercase leading-relaxed tracking-[0.1em] text-ink/35">
        Source: {initial.meta.source}. Clean sheets credited to the team that kept the opponent
        scoreless. Completion boards are true aggregates — total completed ÷ total attempted across
        every finished match, not an average of per-game rates. Boards refresh as results come in —
        tap Force update for the latest.
      </p>
    </main>
  );
}
