import { MatchCard } from "@/components/MatchCard";
import { LiveProvider } from "@/components/LiveProvider";
import { LiveRefreshPill } from "@/components/RefreshCountdown";
import { SiteNav } from "@/components/SiteNav";
import { fixtures, fixturesByMytDay, predictionFile, mytDayKey, hasPrediction } from "@/lib/data";

export const revalidate = 1800; // re-pick "today" every 30 min on Vercel

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

export default function Home() {
  const days = fixturesByMytDay();
  const now = Date.now();
  const liveWindow = 115 * 60 * 1000;

  // Featured day = earliest MYT day whose last match hasn't finished yet.
  const featured =
    days.find((d) => {
      const last = d.fixtures[d.fixtures.length - 1];
      return new Date(last.kickoffUTC).getTime() + liveWindow > now;
    }) ?? days[days.length - 1];

  const dayHasEnded = (d: (typeof days)[number]) => {
    const last = d.fixtures[d.fixtures.length - 1];
    return new Date(last.kickoffUTC).getTime() + liveWindow <= now;
  };
  // Ended days drop to the bottom of the schedule; live/upcoming days stay on
  // top in kickoff order, finished ones trail after (also in kickoff order).
  const rest = days.filter((d) => d.key !== featured.key);
  const upcoming = [...rest.filter((d) => !dayHasEnded(d)), ...rest.filter(dayHasEnded)];
  const updated = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(predictionFile.meta.generatedAt));

  const isToday = (key: string) => key === mytDayKey(new Date(now).toISOString());

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
        <SiteNav active="predictions" />
      </header>

      <section className="stripes overflow-hidden rounded-3xl border border-line bg-pitch-2/60 p-6 sm:p-10">
        <p className="mb-4 font-mono text-[0.72rem] uppercase tracking-[0.24em] text-acid">
          World Cup 2026 · daily predictions
        </p>
        <h1 className="max-w-3xl font-display text-4xl font-black uppercase leading-[0.95] tracking-tight sm:text-6xl">
          Every fixture, called the way you bet it.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
          Win, half-time &amp; full-time scores, anytime scorers, assists and penalty takers — built
          from live team-news research on both squads, in Malaysia time, refreshed daily and again
          when line-ups drop.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-2 font-mono text-[0.7rem] text-faint">
          <span className="rounded-full border border-line px-2.5 py-1">Updated {updated} MYT</span>
          <span className="rounded-full border border-line px-2.5 py-1">
            {Object.keys(predictionFile.predictions).length} matches called
          </span>
        </div>
      </section>

      <LiveProvider kickoffs={fixtures.map((f) => f.kickoffUTC)}>
      <section className="mt-12">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h2 className="font-display text-2xl font-black uppercase tracking-tight text-acid">
              {isToday(featured.key) ? "Today" : "Next up"}
            </h2>
            <span className="font-mono text-sm text-muted">{featured.label}</span>
          </div>
          <LiveRefreshPill />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {featured.fixtures.map((f) => (
            <MatchCard key={f.id} fixture={f} />
          ))}
        </div>
      </section>

      <h2 className="mb-4 mt-14 font-display text-sm font-bold uppercase tracking-[0.18em] text-faint">
        Full group-stage schedule
      </h2>
      <div className="space-y-5">
        {upcoming.map((d) => {
          const dayFinished = dayHasEnded(d);
          return (
            <details
              key={d.key}
              open={!dayFinished}
              className="group rounded-2xl [&_summary::-webkit-details-marker]:hidden"
            >
              <summary className="mb-3 flex cursor-pointer select-none items-baseline justify-between border-b border-line/60 pb-2">
                <span className="flex items-baseline gap-3">
                  <h3 className="font-display text-lg font-extrabold uppercase tracking-tight text-ink">
                    {d.label}
                  </h3>
                  {dayFinished && (
                    <span className="font-mono text-[0.62rem] uppercase tracking-wider text-faint">
                      finished
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-mono text-[0.66rem] uppercase tracking-wider text-faint">
                    {d.fixtures.filter((f) => hasPrediction(f.id)).length} of {d.fixtures.length} called
                  </span>
                  <Chevron />
                </span>
              </summary>
              <div className="grid gap-3 pt-1 sm:grid-cols-2">
                {d.fixtures.map((f) => (
                  <MatchCard key={f.id} fixture={f} />
                ))}
              </div>
            </details>
          );
        })}
      </div>
      </LiveProvider>

      <footer className="mt-20 border-t border-line pt-8 text-sm text-faint">
        <p className="max-w-2xl leading-relaxed">{predictionFile.meta.method}</p>
        <p className="mt-3 max-w-2xl leading-relaxed text-muted">
          ⚠️ {predictionFile.meta.disclaimer}
        </p>
        <p className="mt-6 font-mono text-[0.66rem] uppercase tracking-[0.18em]">
          Matchday Edge · built by Friday · fun-money only
        </p>
      </footer>
    </main>
  );
}
