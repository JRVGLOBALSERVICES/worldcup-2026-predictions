import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ChapterHead } from "@/components/ProgrammeKit";
import { fixtures, getFixture, getPrediction, getResearch, mytTime, mytDayLabel, etTime, predictionFile } from "@/lib/data";
import { PredictionView } from "@/components/PredictionView";
import { FormProjection } from "@/components/FormProjection";
import { BrainPanel } from "@/components/BrainPanel";
import { matchForm } from "@/lib/form";
import { getResult } from "@/lib/results";
import { MatchTeamStats } from "@/components/MatchTeamStats";
import { ResearchPanel } from "@/components/ResearchPanel";
import { VerdictBlock } from "@/components/Verdict";
import { LiveProvider } from "@/components/LiveProvider";
import { MatchHeaderScore, LiveStatusLine, LiveGoalLog, LiveStats, PlayerShotsBoard, PlayerMatchSheet, SubsLog } from "@/components/LiveScore";
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
  // Pre-match form + projection: only for matches that haven't finished (it's a
  // "going into this game" read; a finished match already shows its own sheet).
  const result = getResult(id);
  const form = !result || result.state !== "finished" ? matchForm(fixture) : null;

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

      {/* match header — broadcast scorebug: fixture-board rail + big scoreline */}
      <header className="scorebug stripes overflow-hidden rounded-3xl border border-line">
        <div className="board-strip flex items-stretch justify-between border-b border-line/70 font-mono text-[0.66rem] uppercase tracking-[0.16em] text-faint">
          <span className="min-w-0 truncate px-5 py-2.5 sm:px-8">
            {fixture.round ?? `Group ${fixture.group}`}
            <span className="text-faint/50"> · {fixture.venue}, {fixture.city}</span>
          </span>
          <span className="shrink-0 px-5 py-2.5 text-ink/70 sm:px-8">{mytDayLabel(fixture.kickoffUTC)}</span>
        </div>

        <div className="p-6 sm:p-8">
          <div className="flex items-center justify-between gap-4">
            <Team flag={fixture.home.flag} name={fixture.home.name} />
            <MatchHeaderScore
              matchId={fixture.id}
              mytLabel={mytTime(fixture.kickoffUTC)}
              etLabel={etTime(fixture.kickoffUTC)}
            />
            <Team flag={fixture.away.flag} name={fixture.away.name} align="right" />
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-line/70 pt-4 text-center text-sm">
            <LiveStatusLine matchId={fixture.id} kickoffUTC={fixture.kickoffUTC} />
            <LiveRefreshPill />
          </div>
        </div>
      </header>

      <LiveGoalLog matchId={fixture.id} />

      <LiveStats matchId={fixture.id} />

      <PlayerShotsBoard matchId={fixture.id} />

      <PlayerMatchSheet
        matchId={fixture.id}
        home={{ name: fixture.home.name, flag: fixture.home.flag }}
        away={{ name: fixture.away.name, flag: fixture.away.flag }}
      />

      <SubsLog matchId={fixture.id} />

      {/* Analytical blocks as numbered programme chapters — same masthead-and-
       * chapters system as the stats & predictions pages. Built as an ordered
       * list so the numbering stays contiguous whichever blocks are present
       * (pre-match shows Form; a called match shows the Verdict/Brain, etc.). */}
      {(() => {
        const chapters: { key: string; title: string; sub?: string; node: ReactNode }[] = [];
        if (form)
          chapters.push({
            key: "form",
            title: "Form Guide",
            sub: "How both sides arrive — last-ten record, recent results and the projection into this tie.",
            node: <FormProjection form={form} />,
          });
        if (pred)
          chapters.push({
            key: "verdict",
            title: "The Verdict",
            sub: "The headline call — who takes it, the scoreline, and the confidence behind it.",
            node: <VerdictBlock fixture={fixture} pred={pred} />,
          });
        if (pred?.brainSummary)
          chapters.push({
            key: "brain",
            title: "The Brain Room",
            sub: "The read behind the call — the pitch, the value, and the trap to avoid.",
            node: <BrainPanel pred={pred} />,
          });
        chapters.push(
          pred
            ? {
                key: "card",
                title: "The Full Card",
                sub: "Every market called — win, HT/FT scores, scorers, assists and the penalty taker.",
                node: <PredictionView fixture={fixture} pred={pred} />,
              }
            : {
                key: "card",
                title: "The Full Card",
                sub: "The full call lands the morning of the match and refreshes when line-ups drop.",
                node: (
                  <div className="rounded-2xl border border-line bg-card/50 p-8 text-center">
                    <p className="font-display text-xl font-extrabold uppercase tracking-tight">
                      Prediction dropping soon
                    </p>
                    <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
                      Full call lands the morning of the match and refreshes when the line-ups are
                      confirmed — win, HT/FT, scorers, assists and the penalty taker, all from live
                      squad research.
                    </p>
                  </div>
                ),
              },
        );
        chapters.push({
          key: "team",
          title: "Team Numbers",
          sub: "Each side's tournament leaders and board-by-board form, side by side.",
          node: <MatchTeamStats fixture={fixture} />,
        });
        if (research)
          chapters.push({
            key: "research",
            title: "The Research",
            sub: "The squad-news and form notes the call was built from.",
            node: <ResearchPanel fixture={fixture} research={research} />,
          });
        return chapters.map((c, i) => (
          <section
            key={c.key}
            id={`chapter-${c.key}`}
            className={
              i === 0
                ? "mt-10 scroll-mt-24"
                : "mt-14 scroll-mt-24 border-t-2 border-line/60 pt-10"
            }
          >
            <ChapterHead no={String(i + 1).padStart(2, "0")} title={c.title} sub={c.sub} />
            {c.node}
          </section>
        ));
      })()}

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
