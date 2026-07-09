import type { Metadata } from "next";
import { SiteNav } from "@/components/SiteNav";
import { StatsExplorer } from "@/components/StatsExplorer";
import { getStats } from "@/lib/stats";

// Snapshotted from ESPN by scripts/build-stats.mjs and committed; re-read the
// file every 30 min on Vercel so a fresh push surfaces without a full redeploy.
// The in-page "Force update" button recomputes everything live via /api/stats.
export const revalidate = 1800;

export const metadata: Metadata = {
  title: "Player & Team Stats — World Cup 2026 Squad Sheets",
  description:
    "Every World Cup 2026 player's stats compiled across all games played — goals, assists, tackles, blocks, passes, keeper saves and cards, grouped by team, for the sides still alive in the competition. Plus tournament leaderboards and team completion boards, straight from the official feed in Malaysia time.",
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
          World Cup 2026 · player &amp; team stats
        </p>
        <h1 className="max-w-3xl font-display text-4xl font-black uppercase leading-[0.95] tracking-tight sm:text-6xl">
          Every player. Every number.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
          One stat sheet per team still in the competition — every player&apos;s goals, assists,
          tackles, blocks, passes, keeper saves and cards, added up across every game they&apos;ve
          played so far. Lose today and you&apos;re off the board tomorrow. Tap Force update for the
          numbers as of now.
        </p>
      </section>

      <StatsExplorer initial={initial} />

      <p className="mt-10 font-mono text-[0.7rem] uppercase leading-relaxed tracking-[0.1em] text-ink/50">
        Source: {initial.meta.source}. Player sheets compile counting stats across every game a
        player has featured in; only teams still alive in the competition are shown. Numbers refresh
        as results come in — tap Force update for the latest.
      </p>
    </main>
  );
}
