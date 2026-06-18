import type { Fixture, Prediction } from "@/lib/types";
import { getResult, gradePrediction, type Verdict as V } from "@/lib/results";
import { SectionLabel } from "./atoms";

/**
 * "How the AI call landed" — renders the model's prediction graded against the
 * actual ESPN result, market by market. Server component reading the persisted
 * data/results.json, so it survives long after the live feed window closes.
 * Returns null pre-kickoff (no result yet) so the page stays purely forward-
 * looking until there's something to grade.
 */
export function VerdictBlock({ fixture, pred }: { fixture: Fixture; pred: Prediction }) {
  const result = getResult(fixture.id);
  if (!result) return null;

  const g = gradePrediction(pred, result, fixture);
  const live = g.state === "live";
  const scored = g.scorers.filter((s) => s.scored).length;

  return (
    <section className="rounded-3xl border border-acid-dim/60 bg-acid/[0.04] p-6 sm:p-7">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <SectionLabel>{live ? "Call vs live result" : "How the call landed"}</SectionLabel>
          {live ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose/15 px-2 py-0.5 font-mono text-[0.58rem] font-semibold uppercase tracking-wider text-rose">
              <span className="size-1.5 rounded-full bg-rose motion-safe:animate-pulse" />
              In progress
            </span>
          ) : (
            <span
              className={`rounded-full px-2 py-0.5 font-mono text-[0.62rem] font-bold uppercase tracking-wider ${
                g.hitCount >= 2 ? "bg-acid/15 text-acid" : "bg-card text-muted"
              }`}
            >
              {g.hitCount}/{g.gradedCount} markets hit
            </span>
          )}
        </div>
        <div className="tnum font-display text-2xl font-black leading-none text-ink">
          {g.finalLabel.match(/\d+–\d+/)?.[0]}
        </div>
      </div>

      {/* markets graded */}
      <ul className="space-y-px overflow-hidden rounded-2xl border border-line">
        {g.markets.map((m) => (
          <li
            key={m.label}
            className="flex items-center gap-3 bg-card/50 px-4 py-3 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-line/70"
          >
            <VerdictMark v={m.verdict} />
            <span className="w-28 shrink-0 font-mono text-[0.66rem] uppercase tracking-wider text-faint sm:w-36">
              {m.label}
            </span>
            <span
              className={`font-semibold ${
                m.verdict === "hit" ? "text-acid" : m.verdict === "miss" ? "text-muted line-through decoration-rose/60" : "text-ink"
              }`}
            >
              {m.predicted}
            </span>
            <span className="ml-auto text-right">
              <span className="font-mono text-[0.62rem] uppercase tracking-wider text-faint">
                {m.verdict === "pending" ? "so far" : "actual"}{" "}
              </span>
              <span className="tnum font-semibold text-ink">{m.actual}</span>
            </span>
          </li>
        ))}
      </ul>

      {/* anytime scorers graded */}
      <div className="mt-5">
        <div className="mb-2.5 flex items-baseline justify-between">
          <SectionLabel>Anytime scorers</SectionLabel>
          <span className="font-mono text-[0.62rem] uppercase tracking-wider text-faint">
            {scored}/{g.scorers.length} {live ? "scored so far" : "landed"}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {g.scorers.map((s) => (
            <span
              key={s.name}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium ${
                s.scored
                  ? "border-acid-dim bg-acid/10 text-acid"
                  : "border-line bg-card/50 text-muted"
              }`}
            >
              <VerdictMark v={s.scored ? "hit" : live ? "pending" : "miss"} small />
              {s.name}
            </span>
          ))}
        </div>
        {g.surprises.length > 0 && (
          <p className="mt-3 text-sm text-muted">
            <span className="font-mono text-[0.62rem] uppercase tracking-wider text-faint">
              Also scored ·{" "}
            </span>
            {g.surprises.join(", ")}
            <span className="text-faint"> — not on the model&rsquo;s card</span>
          </p>
        )}
      </div>
    </section>
  );
}

function VerdictMark({ v, small = false }: { v: V; small?: boolean }) {
  const size = small ? "size-3.5 text-[0.6rem]" : "size-5 text-[0.7rem]";
  if (v === "hit")
    return (
      <span className={`grid shrink-0 place-items-center rounded-full bg-acid/20 font-black text-acid ${size}`}>
        ✓
      </span>
    );
  if (v === "miss")
    return (
      <span className={`grid shrink-0 place-items-center rounded-full bg-rose/15 font-black text-rose ${size}`}>
        ✕
      </span>
    );
  return (
    <span className={`grid shrink-0 place-items-center rounded-full bg-card font-black text-faint ${size}`}>
      ·
    </span>
  );
}
