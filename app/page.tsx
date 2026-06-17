import Link from "next/link";
import { MatchCard } from "@/components/MatchCard";
import { fixturesByMytDay, predictionFile, mytDayKey, hasPrediction } from "@/lib/data";

export const revalidate = 1800; // re-pick "today" every 30 min on Vercel

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

  const upcoming = days.filter((d) => d.key !== featured.key);
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
      <header className="flex items-center justify-between py-6">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-acid font-display text-lg font-black text-pitch">
            ⚽
          </span>
          <span className="font-display text-base font-extrabold uppercase tracking-tight">
            Matchday Edge
          </span>
        </div>
        <nav className="flex items-center gap-4 font-mono text-[0.66rem] uppercase tracking-[0.18em]">
          <span className="text-acid">Predictions</span>
          <Link href="/tracker" className="text-faint transition-colors hover:text-ink">
            Tracker
          </Link>
        </nav>
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

      <section className="mt-12">
        <div className="mb-4 flex items-baseline gap-3">
          <h2 className="font-display text-2xl font-black uppercase tracking-tight text-acid">
            {isToday(featured.key) ? "Today" : "Next up"}
          </h2>
          <span className="font-mono text-sm text-muted">{featured.label}</span>
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
      <div className="space-y-10">
        {upcoming.map((d) => (
          <div key={d.key}>
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="font-display text-lg font-extrabold uppercase tracking-tight">
                {d.label}
              </h3>
              <span className="font-mono text-[0.66rem] uppercase tracking-wider text-faint">
                {d.fixtures.filter((f) => hasPrediction(f.id)).length}/{d.fixtures.length} called
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {d.fixtures.map((f) => (
                <MatchCard key={f.id} fixture={f} />
              ))}
            </div>
          </div>
        ))}
      </div>

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
