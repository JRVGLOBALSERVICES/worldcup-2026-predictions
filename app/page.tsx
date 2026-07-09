import { MatchCard } from "@/components/MatchCard";
import { LiveProvider } from "@/components/LiveProvider";
import { AllMatchesEventFX } from "@/components/LiveFX";
import { LiveRefreshPill } from "@/components/RefreshCountdown";
import { SiteNav } from "@/components/SiteNav";
import { Masthead } from "@/components/ProgrammeKit";
import { fixtures, fixturesByMytDay, predictionFile, mytDayKey, hasPrediction } from "@/lib/data";
import { isMatchFinished } from "@/lib/live";

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

  // A day is over only once its matches are ACTUALLY finished per the official
  // feed — never a blind kickoff+N-minutes window, which fires mid-match (a
  // knockout can run ~3 h with extra time + penalties, so a live game would get
  // wrongly collapsed as "finished"). Fallback: 3.5 h past the last kickoff, an
  // upper bound that can't be reached while a match is still being played, for
  // any fixture the feed never persisted.
  const finishedFallback = 3.5 * 60 * 60 * 1000;
  const dayHasEnded = (d: (typeof days)[number]) => {
    const last = d.fixtures[d.fixtures.length - 1];
    const fallbackElapsed = new Date(last.kickoffUTC).getTime() + finishedFallback <= now;
    return fallbackElapsed || d.fixtures.every((f) => isMatchFinished(f.id));
  };

  // Featured day = earliest MYT day that hasn't ended yet.
  const featured = days.find((d) => !dayHasEnded(d)) ?? days[days.length - 1];
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

      <Masthead
        kicker="World Cup 2026 · the matchday programme"
        title="Every Fixture, Called the Way You Bet It."
        edition={`${Object.keys(predictionFile.predictions).length} matches called`}
        meta={`Updated ${updated} MYT`}
      />
      <p className="mx-auto mt-6 max-w-2xl text-center text-base leading-relaxed text-muted sm:text-lg">
        Win, half-time &amp; full-time scores, anytime scorers, assists and penalty takers — built
        from live team-news research on both squads, in Malaysia time, refreshed daily and again when
        line-ups drop.
      </p>

      <LiveProvider kickoffs={fixtures.map((f) => f.kickoffUTC)}>
      {/* Live-event reactions across today's grid — goals firecracker, the rest chip in. */}
      <AllMatchesEventFX />
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
        Full tournament schedule
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
                    <span className="font-mono text-[0.7rem] uppercase tracking-wider text-faint">
                      finished
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-mono text-[0.7rem] uppercase tracking-wider text-faint">
                    {d.fixtures.filter((f) => hasPrediction(f.id)).length} of {d.fixtures.length} matches predicted
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
