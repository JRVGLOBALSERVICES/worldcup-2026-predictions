import type { Metadata } from "next";
import { SiteNav } from "@/components/SiteNav";
import { StatsBoards } from "@/components/StatsBoards";
import { getStats } from "@/lib/stats";

// Snapshotted from ESPN by scripts/build-stats.mjs and committed; re-read the
// file every 30 min on Vercel so a fresh push surfaces without a full redeploy.
// The in-page "Force update" button recomputes the boards live via /api/stats.
export const revalidate = 1800;

export const metadata: Metadata = {
  title: "Team Completion Stats — World Cup 2026 Control & Accuracy",
  description:
    "Live World Cup 2026 team completion stats in Malaysia time — pass completion, possession, shot accuracy, tackle success, cross and long-ball accuracy. True aggregates across every finished match, pulled from the official feed. Player leaderboards live on the Standings page.",
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
          World Cup 2026 · completion &amp; control
        </p>
        <h1 className="max-w-3xl font-display text-4xl font-black uppercase leading-[0.95] tracking-tight sm:text-6xl">
          Who keeps the ball — and finds the target.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
          Pass completion, possession, shot accuracy, tackle success, cross and long-ball accuracy —
          every percentage aggregated across all of a side&apos;s finished matches, not a single-game
          flash. Ranked top ten per board, highest first, in Malaysia time. Looking for top scorers
          and the cards table? They&apos;ve moved to the{" "}
          <a href="/standings" className="text-acid underline underline-offset-2 hover:text-ink">
            Standings page
          </a>
          .
        </p>
      </section>

      <StatsBoards initial={initial} />

      <p className="mt-10 font-mono text-[0.62rem] uppercase leading-relaxed tracking-[0.1em] text-ink/35">
        Source: {initial.meta.source}. Completion boards are true aggregates — total completed ÷
        total attempted across every finished match, not an average of per-game rates. Boards refresh
        as results come in — tap Force update for the latest.
      </p>
    </main>
  );
}
