import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { fixtures, getFixture, getPrediction, getResearch, mytTime, mytDayLabel, etTime, predictionFile } from "@/lib/data";
import { PredictionView } from "@/components/PredictionView";
import { BrainPanel } from "@/components/BrainPanel";
import { MatchTeamStats } from "@/components/MatchTeamStats";
import { ResearchPanel } from "@/components/ResearchPanel";
import { VerdictBlock } from "@/components/Verdict";
import { LiveProvider } from "@/components/LiveProvider";
import { MatchHeaderScore, LiveStatusLine, LiveGoalLog, LiveStats } from "@/components/LiveScore";
import { LiveRefreshPill } from "@/components/RefreshCountdown";

export function generateStaticParams() {
  return fixtures.map((f) => ({ id: f.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const f = getFixture(id);
  if (!f) return { title: "Match not found" };
  const pred = getPrediction(id);
  const title = `${f.home.name} vs ${f.away.name} prediction`;
  const desc = pred
    ? `${f.home.name} vs ${f.away.name}: ${pred.win.pick} to win, ${pred.fullTime.score}. Scorers, assists & penalty taker — ${mytTime(f.kickoffUTC)} MYT.`
    : `${f.home.name} vs ${f.away.name} — World Cup 2026 ${f.round ?? `Group ${f.group}`}, ${mytTime(f.kickoffUTC)} MYT. Prediction coming soon.`;
  return { title, description: desc, openGraph: { title, description: desc } };
}

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const fixture = getFixture(id);
  if (!fixture) notFound();
  const pred = getPrediction(id);
  const research = getResearch(id);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    name: `${fixture.home.name} vs ${fixture.away.name}`,
    sport: "Football",
    startDate: fixture.kickoffUTC,
    eventStatus: "https://schema.org/EventScheduled",
    location: { "@type": "Place", name: `${fixture.venue}, ${fixture.city}` },
    competitor: [
      { "@type": "SportsTeam", name: fixture.home.name },
      { "@type": "SportsTeam", name: fixture.away.name },
    ],
    superEvent: { "@type": "SportsEvent", name: "FIFA World Cup 2026" },
  };

  return (
    <LiveProvider kickoffs={[fixture.kickoffUTC]}>
    <main className="mx-auto max-w-3xl px-4 pb-24 sm:px-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="py-6">
        <Link
          href="/"
          className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-faint transition-colors hover:text-acid"
        >
          ← All matches
        </Link>
      </div>

      {/* match header */}
      <header className="stripes overflow-hidden rounded-3xl border border-line bg-pitch-2/60 p-6 sm:p-8">
        <div className="mb-5 flex items-center justify-between font-mono text-[0.7rem] uppercase tracking-[0.18em] text-faint">
          <span>
            {fixture.round ?? `Group ${fixture.group}`} · {fixture.venue}, {fixture.city}
          </span>
          <span>{mytDayLabel(fixture.kickoffUTC)}</span>
        </div>

        <div className="flex items-center justify-between gap-4">
          <Team flag={fixture.home.flag} name={fixture.home.name} />
          <MatchHeaderScore
            matchId={fixture.id}
            mytLabel={mytTime(fixture.kickoffUTC)}
            etLabel={etTime(fixture.kickoffUTC)}
          />
          <Team flag={fixture.away.flag} name={fixture.away.name} align="right" />
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-line/70 pt-3 text-center text-sm">
          <LiveStatusLine matchId={fixture.id} kickoffUTC={fixture.kickoffUTC} />
          <LiveRefreshPill />
        </div>
      </header>

      <LiveGoalLog matchId={fixture.id} />

      <LiveStats matchId={fixture.id} />

      {pred && (
        <div className="mt-8">
          <VerdictBlock fixture={fixture} pred={pred} />
        </div>
      )}

      {pred?.pitchReport && (
        <div className="mt-8">
          <BrainPanel pred={pred} />
        </div>
      )}

      <div className="mt-8">
        {pred ? (
          <PredictionView fixture={fixture} pred={pred} />
        ) : (
          <div className="rounded-2xl border border-line bg-card/50 p-8 text-center">
            <p className="font-display text-xl font-extrabold uppercase tracking-tight">
              Prediction dropping soon
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
              Full call lands the morning of the match and refreshes when the line-ups are confirmed
              — win, HT/FT, scorers, assists and the penalty taker, all from live squad research.
            </p>
          </div>
        )}
      </div>

      <MatchTeamStats fixture={fixture} />

      {research && (
        <div className="mt-10 border-t border-line pt-8">
          <ResearchPanel fixture={fixture} research={research} />
        </div>
      )}

      <footer className="mt-12 border-t border-line pt-6 text-sm text-faint">
        <p className="leading-relaxed text-muted">⚠️ {predictionFile.meta.disclaimer}</p>
      </footer>
    </main>
    </LiveProvider>
  );
}

function Team({
  flag,
  name,
  align = "left",
}: {
  flag: string;
  name: string;
  align?: "left" | "right";
}) {
  return (
    <div className={`min-w-0 flex-1 ${align === "right" ? "text-right" : ""}`}>
      <div className={`text-4xl leading-none ${align === "right" ? "text-right" : ""}`}>{flag}</div>
      <div className="mt-2 font-display text-xl font-black uppercase leading-[0.95] tracking-tight sm:text-2xl">
        {name}
      </div>
    </div>
  );
}
