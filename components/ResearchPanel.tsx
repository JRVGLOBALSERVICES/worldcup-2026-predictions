import type { Fixture, Research, TeamForm, FormGame } from "@/lib/types";
import { SectionLabel } from "./atoms";

const LEADER_LABEL: Record<string, string> = {
  totalShots: "Most shots",
  accuratePasses: "Passes",
  defensiveInterventions: "Defensive",
  saves: "Saves",
  goals: "Goals",
  assists: "Assists",
};

/**
 * The evidence behind the call — last-10 form + W/D/L record for both sides,
 * statistical leaders, discipline and head-to-head. Pulled from ESPN's free feed
 * (data/research.json), shown for every fixture, finished or upcoming. Returns
 * null when there's no research bundle so the page degrades cleanly.
 */
export function ResearchPanel({ fixture, research }: { fixture: Fixture; research?: Research }) {
  if (!research?.form) return null;
  const { home, away } = research.form;
  const hasLeaders =
    research.leaders &&
    (Object.keys(research.leaders.home ?? {}).length || Object.keys(research.leaders.away ?? {}).length);

  return (
    <section className="space-y-7">
      <div className="flex items-center gap-3">
        <SectionLabel>The research</SectionLabel>
        <span className="font-mono text-[0.6rem] uppercase tracking-wider text-faint">
          Last 10 · form · leaders · H2H
        </span>
      </div>

      {/* form + record, side by side */}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormCard team={fixture.home} form={home} />
        <FormCard team={fixture.away} form={away} />
      </div>

      {/* statistical leaders */}
      {hasLeaders ? (
        <div>
          <SectionLabel>Statistical leaders</SectionLabel>
          <div className="grid gap-3 sm:grid-cols-2">
            <LeaderCard team={fixture.home} leaders={research.leaders!.home} />
            <LeaderCard team={fixture.away} leaders={research.leaders!.away} />
          </div>
        </div>
      ) : null}

      {/* head-to-head */}
      {research.headToHead && research.headToHead.length > 0 ? (
        <div>
          <SectionLabel>Recent head-to-head</SectionLabel>
          <ul className="overflow-hidden rounded-xl border border-line">
            {research.headToHead.map((g, i) => (
              <li
                key={`${g.date}-${i}`}
                className="flex items-center justify-between gap-3 bg-card/40 px-4 py-2.5 text-sm [&:not(:last-child)]:border-b [&:not(:last-child)]:border-line/70"
              >
                <span className="font-mono text-[0.7rem] text-faint">{g.date}</span>
                <span className="tnum font-semibold text-ink">{g.score}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* discipline from the latest data */}
      {research.cards && research.cards.length > 0 ? (
        <div>
          <SectionLabel>Discipline — latest meeting</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {research.cards.map((c, i) => {
              const red = (c.type ?? "").toLowerCase().includes("red");
              return (
                <span
                  key={i}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm ${
                    red ? "border-rose/50 text-rose" : "border-amber/50 text-amber"
                  }`}
                >
                  <span className={`h-3 w-2 rounded-[1px] ${red ? "bg-rose" : "bg-amber"}`} />
                  {c.minute ?? ""}
                  {c.player ? ` · ${c.player}` : ""}
                </span>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function FormCard({ team, form }: { team: { name: string; flag: string }; form: TeamForm }) {
  const { w, d, l } = form.record;
  const total = w + d + l || 1;
  return (
    <div className="rounded-2xl border border-line bg-card/50 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-lg leading-none">{team.flag}</span>
          <span className="font-display text-sm font-bold uppercase tracking-wide text-ink">{team.name}</span>
        </div>
        <FormDots line={form.line} />
      </div>

      {/* W / D / L record */}
      <div className="mb-3 flex items-center gap-4 font-mono text-[0.72rem] uppercase tracking-wider">
        <span className="text-acid">{w}W</span>
        <span className="text-muted">{d}D</span>
        <span className="text-rose">{l}L</span>
        <span className="ml-auto text-faint">last {total}</span>
      </div>

      {/* recent results */}
      <ul className="space-y-1">
        {form.games.slice(0, 6).map((g, i) => (
          <li key={`${g.date}-${i}`} className="flex items-center gap-2.5 text-[0.82rem]">
            <ResultChip result={g.result} />
            <span className="min-w-0 flex-1 truncate text-muted">
              <span className="text-faint">{g.homeAway === "away" ? "@ " : "vs "}</span>
              {g.opponent}
            </span>
            <span className="tnum font-semibold text-ink">{g.score}</span>
            <span className="tnum w-12 shrink-0 text-right font-mono text-[0.66rem] text-faint">
              {g.date?.slice(5)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LeaderCard({ team, leaders }: { team: { name: string; flag: string }; leaders: Record<string, string> }) {
  const entries = Object.entries(leaders ?? {});
  return (
    <div className="rounded-xl border border-line bg-card/40 p-4">
      <div className="mb-2.5 flex items-center gap-2">
        <span className="text-base leading-none">{team.flag}</span>
        <span className="font-display text-sm font-bold uppercase tracking-wide text-ink">{team.name}</span>
      </div>
      {entries.length === 0 ? (
        <p className="text-sm text-faint">No leader data yet.</p>
      ) : (
        <dl className="space-y-1.5">
          {entries.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3 text-sm">
              <dt className="shrink-0 font-mono text-[0.62rem] uppercase tracking-wider text-faint">
                {LEADER_LABEL[k] ?? k}
              </dt>
              <dd className="truncate text-right text-muted">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/** Inline W/D/L dot strip — newest-first, capped to 10. */
export function FormDots({ line }: { line: string }) {
  const chars = line.replace(/[^WDL]/gi, "").toUpperCase().slice(0, 10).split("");
  if (chars.length === 0) return <span className="font-mono text-[0.66rem] text-faint">—</span>;
  const cls: Record<string, string> = { W: "bg-acid", D: "bg-faint", L: "bg-rose" };
  return (
    <span className="inline-flex items-center gap-[3px]" title={`Form: ${chars.join("")} (newest first)`}>
      {chars.map((c, i) => (
        <span key={i} className={`size-2 rounded-full ${cls[c] ?? "bg-line"}`} />
      ))}
    </span>
  );
}

function ResultChip({ result }: { result: FormGame["result"] }) {
  const map = {
    W: "bg-acid/15 text-acid",
    D: "bg-card text-muted",
    L: "bg-rose/15 text-rose",
  } as const;
  return (
    <span className={`grid size-5 shrink-0 place-items-center rounded font-mono text-[0.62rem] font-bold ${map[result] ?? "bg-card text-faint"}`}>
      {result}
    </span>
  );
}
