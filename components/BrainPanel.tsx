import type { Prediction, PitchReport, ValueSpot, ValueLeg, TrapDetector } from "@/lib/types";

/**
 * The Brain — three reasoning layers (thelocktalk framework deck) rendered as a
 * single analyse → price → trap-filter narrative, not a bento of identical cards.
 * Server component: fully SSR for SEO + AI-citation. One accent (acid) leads;
 * amber = caution / value-watch, rose = bad price / sprung trap.
 */
export function BrainPanel({ pred }: { pred: Prediction }) {
  const { pitchReport, valueSpot, trapDetector } = pred;
  if (!pitchReport && !valueSpot && !trapDetector) return null;

  return (
    <section className="overflow-hidden rounded-3xl border border-line bg-pitch-2/50">
      {/* header band */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-card/40 px-5 py-4 sm:px-7">
        <div>
          <div className="flex items-baseline gap-2.5">
            <h2 className="font-display text-xl font-black uppercase tracking-tight text-ink sm:text-2xl">
              The Brain
            </h2>
            <span className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-faint">
              analyse · price · trap-filter
            </span>
          </div>
          <p className="mt-1 max-w-md text-sm leading-snug text-muted">
            The read, the price, and the honest filter — in that order.
          </p>
        </div>
        {trapDetector && <VerdictStamp v={trapDetector.verdict} />}
      </div>

      <div className="space-y-0">
        {pitchReport && <Stage n="01" title="Pitch Report" tag="the read"><PitchBlock r={pitchReport} /></Stage>}
        {valueSpot !== undefined && (
          <Stage n="02" title="Value Spot" tag="the price">
            <ValueBlock v={valueSpot ?? null} />
          </Stage>
        )}
        {trapDetector && <Stage n="03" title="TRAP Detector" tag="the filter"><TrapBlock t={trapDetector} /></Stage>}
      </div>
    </section>
  );
}

/* ── shells ──────────────────────────────────────────────────────────────── */

function Stage({ n, title, tag, children }: { n: string; title: string; tag: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-line/60 px-5 py-6 first:border-t-0 sm:px-7">
      <div className="mb-4 flex items-center gap-3">
        <span className="tnum font-mono text-[0.8rem] font-bold text-acid">{n}</span>
        <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-ink">{title}</h3>
        <span className="font-mono text-[0.58rem] uppercase tracking-[0.22em] text-faint">{tag}</span>
      </div>
      {children}
    </div>
  );
}

function VerdictStamp({ v }: { v: TrapDetector["verdict"] }) {
  const map = {
    PLAYABLE: "border-acid-dim bg-acid/10 text-acid",
    LEAN: "border-amber/50 bg-amber/10 text-amber",
    PASS: "border-rose-dim bg-rose/10 text-rose",
  } as const;
  return (
    <span className={`rounded-xl border px-3.5 py-2 font-display text-lg font-black uppercase leading-none tracking-tight ${map[v]}`}>
      {v}
    </span>
  );
}

/* ── 01 · Pitch Report ───────────────────────────────────────────────────── */

function PitchBlock({ r }: { r: PitchReport }) {
  return (
    <div className="space-y-5">
      {/* facts vs assumptions — fact and projection kept visibly separate */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Column label="Known facts" tone="acid">
          {r.facts.map((f, i) => <LedgerLine key={i} mark="fact">{f}</LedgerLine>)}
        </Column>
        <Column label="Assumptions" tone="amber">
          {r.assumptions.map((a, i) => <LedgerLine key={i} mark="model">{a}</LedgerLine>)}
        </Column>
      </div>

      {/* the read — labelled rows */}
      <dl className="grid gap-x-6 gap-y-3 rounded-2xl border border-line bg-card/40 p-4 sm:grid-cols-2">
        <Row k="Style & xG">{r.xgRead}</Row>
        <Row k="Draw risk">{r.drawRisk}</Row>
        <Row k="Motivation">{r.motivation}</Row>
        <Row k="Lineups">{r.lineups}</Row>
        <Row k="Conditions" full>{r.travel}</Row>
      </dl>

      {/* case for / against the call */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Column label="Case for the call" tone="acid">
          {r.caseFor.map((c, i) => <LedgerLine key={i} mark="for">{c}</LedgerLine>)}
        </Column>
        <Column label="Case against" tone="rose">
          {r.caseAgainst.map((c, i) => <LedgerLine key={i} mark="against">{c}</LedgerLine>)}
        </Column>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-faint">Verdict</span>
        <PitchVerdict v={r.verdict} />
        <span className="text-sm text-muted">
          <span className="text-faint">Changes if:</span> {r.changeMind}
        </span>
      </div>
    </div>
  );
}

function PitchVerdict({ v }: { v: PitchReport["verdict"] }) {
  const map = { Bet: "text-acid border-acid-dim", Lean: "text-amber border-amber/50", Pass: "text-faint border-line" } as const;
  return (
    <span className={`rounded-full border px-2.5 py-0.5 font-display text-sm font-extrabold uppercase tracking-tight ${map[v]}`}>
      {v}
    </span>
  );
}

/* ── 02 · Value Spot ─────────────────────────────────────────────────────── */

function ValueBlock({ v }: { v: ValueSpot | null }) {
  if (!v) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-card/30 p-5 text-sm leading-relaxed text-muted">
        <span className="font-semibold text-ink">No live market captured for this tie yet.</span>{" "}
        The Value Spot prices the model against real 1xBet numbers — it lights up the moment the
        feed has this fixture. Until then the call above is model-only.
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-muted">
          Model vs <span className="font-semibold text-ink">{v.source}</span> price
        </span>
        <span className="tnum font-mono text-[0.72rem] uppercase tracking-wider text-faint">
          Book margin <span className={v.overroundPct <= 6 ? "text-acid" : "text-amber"}>+{v.overroundPct}%</span>
        </span>
      </div>

      <ul className="space-y-px overflow-hidden rounded-2xl border border-line">
        {v.legs.map((l) => <ValueRow key={`${l.market}-${l.side}`} l={l} isBest={l.side === v.bestSide} />)}
      </ul>

      <p className="rounded-xl border border-line bg-card/40 px-4 py-3 text-sm leading-relaxed text-muted">
        <span className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-faint">Verdict · </span>
        {v.headline}
      </p>
    </div>
  );
}

function ValueRow({ l, isBest }: { l: ValueLeg; isBest: boolean }) {
  const tone =
    l.verdict === "good" ? "text-acid" : l.verdict === "bad" ? "text-rose" : "text-ink";
  const edgeTone = l.edgePts > 0 ? "text-acid" : l.edgePts < 0 ? "text-rose" : "text-faint";
  return (
    <li
      className={`flex flex-col gap-1.5 px-4 py-3 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-line/70 ${
        isBest ? "bg-acid/[0.07]" : "bg-card/50"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-mono text-[0.58rem] uppercase tracking-wider text-faint">{l.market}</span>
          <span className={`truncate font-semibold ${tone}`}>{l.side}</span>
          {isBest && (
            <span className="shrink-0 rounded-sm bg-acid/15 px-1.5 py-0.5 font-mono text-[0.55rem] font-bold uppercase tracking-wider text-acid">
              value
            </span>
          )}
        </div>
        <span className="tnum shrink-0 font-display text-lg font-extrabold leading-none text-ink">{l.price}</span>
      </div>
      <div className="tnum flex items-center gap-x-3 gap-y-1 font-mono text-[0.68rem] text-muted">
        <span>implied <span className="text-ink">{l.impliedPct}%</span></span>
        <span className="text-faint">·</span>
        <span>fair <span className="text-ink">{l.fairPct}%</span></span>
        <span className="text-faint">·</span>
        <span>model <span className="text-ink">{l.modelPct}%</span></span>
        <span className="ml-auto font-semibold">
          edge <span className={edgeTone}>{l.edgePts > 0 ? "+" : ""}{l.edgePts}</span>
        </span>
      </div>
    </li>
  );
}

/* ── 03 · TRAP Detector ──────────────────────────────────────────────────── */

const EDGE_LABEL: Record<TrapDetector["edge"], string> = {
  "real edge": "Real edge",
  "edge-leaning": "Edge-leaning",
  "narrative-leaning": "Narrative-leaning",
  "pure narrative": "Pure narrative",
};

function TrapBlock({ t }: { t: TrapDetector }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="tnum font-mono text-[0.72rem] uppercase tracking-wider text-faint">
          {t.trapsTripped} of {t.flags.length} traps tripped
        </span>
        <span className="font-mono text-[0.72rem] uppercase tracking-wider text-faint">
          ·{" "}
          <span className={t.edge === "real edge" ? "text-acid" : t.edge.includes("narrative") ? "text-rose" : "text-amber"}>
            {EDGE_LABEL[t.edge]}
          </span>
        </span>
      </div>

      <ul className="space-y-px overflow-hidden rounded-2xl border border-line">
        {t.flags.map((f) => (
          <li
            key={f.name}
            className="flex items-start gap-3 bg-card/50 px-4 py-2.5 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-line/70"
          >
            <FlagMark tripped={f.tripped} />
            <div className="min-w-0">
              <div className={`text-sm font-semibold ${f.tripped ? "text-amber" : "text-ink"}`}>{f.name}</div>
              <p className="text-[0.8rem] leading-snug text-muted">{f.why}</p>
            </div>
          </li>
        ))}
      </ul>

      <blockquote className="border-l-2 border-acid-dim pl-4 text-sm italic leading-relaxed text-muted">
        {t.discipline}
      </blockquote>
    </div>
  );
}

function FlagMark({ tripped }: { tripped: boolean }) {
  return tripped ? (
    <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-amber/15 text-[0.7rem] font-black text-amber">
      !
    </span>
  ) : (
    <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-acid/15 text-[0.7rem] font-black text-acid">
      ✓
    </span>
  );
}

/* ── small shared bits ───────────────────────────────────────────────────── */

function Column({ label, tone, children }: { label: string; tone: "acid" | "amber" | "rose"; children: React.ReactNode }) {
  const dot = { acid: "bg-acid", amber: "bg-amber", rose: "bg-rose" } as const;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className={`size-1.5 rounded-full ${dot[tone]}`} />
        <span className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-faint">{label}</span>
      </div>
      <ul className="space-y-1.5">{children}</ul>
    </div>
  );
}

function LedgerLine({ mark, children }: { mark: "fact" | "model" | "for" | "against"; children: React.ReactNode }) {
  const glyph = { fact: "›", model: "~", for: "✓", against: "✕" } as const;
  const tone = { fact: "text-acid", model: "text-amber", for: "text-acid", against: "text-rose" } as const;
  return (
    <li className="flex gap-2 text-sm leading-snug text-muted">
      <span className={`shrink-0 font-mono ${tone[mark]}`}>{glyph[mark]}</span>
      <span>{children}</span>
    </li>
  );
}

function Row({ k, children, full = false }: { k: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <dt className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-faint">{k}</dt>
      <dd className="mt-0.5 text-sm leading-snug text-muted">{children}</dd>
    </div>
  );
}

/** Compact signal for the match-list card: trap verdict + value side. */
export function BrainVerdictChip({ pred }: { pred: Prediction }) {
  const t = pred.trapDetector;
  if (!t) return null;
  const map = { PLAYABLE: "text-acid border-acid-dim", LEAN: "text-amber border-amber/50", PASS: "text-rose border-rose-dim" } as const;
  return (
    <span className={`rounded-full border px-2 py-0.5 font-mono text-[0.58rem] font-bold uppercase tracking-wider ${map[t.verdict]}`}>
      {t.verdict}
    </span>
  );
}
