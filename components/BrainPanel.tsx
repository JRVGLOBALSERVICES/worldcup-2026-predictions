import type { Prediction, BrainSummary, PitchReport, ValueSpot, TrapDetector } from "@/lib/types";

/**
 * The Brain — the three frameworks (read · price · honest filter) distilled to a
 * plain-English call anyone can read in a glance. The verdict + one sentence lead;
 * three one-liners back it; the full reasoning hides behind a disclosure for anyone
 * who wants it. One accent (acid) leads, amber = caution, rose = bad / sprung trap.
 */
export function BrainPanel({ pred }: { pred: Prediction }) {
  if (!pred.brainSummary) return null;
  return (
    <BrainSummaryCard pred={pred} />
  );
}

/* ── the simple summary — what a phone reader actually needs ─────────────────── */

export function BrainSummaryCard({ pred }: { pred: Prediction }) {
  const s = pred.brainSummary;
  if (!s) return null;

  return (
    <section className="overflow-hidden rounded-3xl border border-line bg-pitch-2/50">
      {/* verdict + the one-line call */}
      <div className="border-b border-line bg-card/40 px-5 py-5 sm:px-7">
        <div className="flex items-center gap-2.5">
          <h2 className="font-display text-xl font-black uppercase tracking-tight text-ink sm:text-2xl">
            The call
          </h2>
          <VerdictStamp v={s.verdict} />
        </div>
        <p className="mt-1.5 text-[0.72rem] leading-snug text-ink/50">
          {verdictGloss[s.verdict]}
        </p>
        <p className="mt-3 max-w-2xl text-[0.95rem] leading-relaxed text-ink sm:text-base">{s.call}</p>
      </div>

      {/* three one-liners: read · price · filter */}
      <dl className="divide-y divide-line/60">
        <SummaryRow n="1" label="The read" caption="What we expect to happen" tag={s.read.tag} tagTone={pitchTone(s.read.tag)}>
          {s.read.line}
        </SummaryRow>
        <SummaryRow n="2" label="The price" caption="Whether the odds are worth it" tag={s.price.tag} tagTone={priceTone(s.price.tag)}>
          {s.price.line}
        </SummaryRow>
        <SummaryRow n="3" label="The catch" caption="What could go wrong" tag={s.trap.tag} tagTone={trapTone(s.trap.tag)}>
          {s.trap.line}
        </SummaryRow>
      </dl>

      {/* depth on demand — never shown by default */}
      {(pred.pitchReport || pred.valueSpot || pred.trapDetector) && (
        <details className="group border-t border-line">
          <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3.5 text-sm font-medium text-muted transition-colors hover:text-ink sm:px-7">
            <span>See the full reasoning</span>
            <span className="font-mono text-[0.7rem] text-faint transition-transform group-open:rotate-90">▸</span>
          </summary>
          <div className="space-y-7 px-5 pb-7 pt-1 sm:px-7">
            {pred.pitchReport && <DetailPitch r={pred.pitchReport} />}
            {pred.valueSpot && <DetailValue v={pred.valueSpot} />}
            {pred.trapDetector && <DetailTrap t={pred.trapDetector} />}
          </div>
        </details>
      )}
    </section>
  );
}

function SummaryRow({
  n,
  label,
  caption,
  tag,
  tagTone,
  children,
}: {
  n: string;
  label: string;
  caption?: string;
  tag: string;
  tagTone: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3.5 px-5 py-4 sm:px-7">
      <span className="tnum mt-0.5 shrink-0 font-mono text-[0.78rem] font-bold text-acid">{n}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <dt className="font-mono text-[0.72rem] uppercase tracking-[0.2em] text-ink/60">{label}</dt>
          <span className={`rounded-full border px-2 py-0.5 font-mono text-[0.7rem] font-semibold uppercase tracking-wider ${tagTone}`}>
            {tag}
          </span>
        </div>
        {caption && <p className="mt-1 text-[0.72rem] leading-snug text-ink/50">{caption}</p>}
        <dd className="mt-1 text-sm leading-relaxed text-muted">{children}</dd>
      </div>
    </div>
  );
}

const verdictGloss: Record<BrainSummary["verdict"], string> = {
  PLAYABLE: "Playable — worth a bet at these odds.",
  LEAN: "Lean — a mild edge; keep the stake small.",
  PASS: "Pass — no edge here; sit this one out.",
};

function VerdictStamp({ v }: { v: BrainSummary["verdict"] }) {
  const map = {
    PLAYABLE: "border-acid-dim bg-acid/10 text-acid",
    LEAN: "border-amber/50 bg-amber/10 text-amber",
    PASS: "border-rose-dim bg-rose/10 text-rose",
  } as const;
  return (
    <span className={`rounded-lg border px-2.5 py-1 font-display text-base font-black uppercase leading-none tracking-tight ${map[v]}`}>
      {v}
    </span>
  );
}

/* ── tag tones ──────────────────────────────────────────────────────────────── */

function pitchTone(tag: string) {
  if (tag === "Bet") return "border-acid-dim text-acid";
  if (tag === "Lean") return "border-amber/50 text-amber";
  return "border-line text-faint";
}
function priceTone(tag: string) {
  if (tag.startsWith("Good price")) return "border-acid-dim text-acid";
  if (tag.startsWith("Value:")) return "border-amber/50 text-amber";
  if (tag.endsWith("overpriced")) return "border-rose-dim text-rose";
  return "border-line text-muted";
}
function trapTone(tag: string) {
  if (tag === "Clean") return "border-acid-dim text-acid";
  return "border-amber/50 text-amber";
}

/* ── full reasoning (disclosure only) — simplified, no math wall ─────────────── */

function DetailPitch({ r }: { r: PitchReport }) {
  return (
    <div>
      <DetailHead>The read in full</DetailHead>
      <div className="grid gap-5 sm:grid-cols-2">
        <PointList label="Why the call" tone="acid" mark="✓" items={r.caseFor} />
        <PointList label="What could go wrong" tone="rose" mark="✕" items={r.caseAgainst} />
      </div>
      <dl className="mt-4 grid gap-x-6 gap-y-3 rounded-2xl border border-line bg-card/40 p-4 sm:grid-cols-2">
        <KV k="Likely shape">{r.xgRead}</KV>
        <KV k="Draw risk">{r.drawRisk}</KV>
        <KV k="What flips it" full>{r.changeMind}</KV>
      </dl>
    </div>
  );
}

function DetailValue({ v }: { v: ValueSpot }) {
  return (
    <div>
      <DetailHead>The price, side by side</DetailHead>
      <p className="mb-3 text-sm leading-relaxed text-muted">{v.headline}</p>
      <ul className="overflow-hidden rounded-2xl border border-line">
        {v.legs.map((l) => {
          const tone = l.verdict === "good" ? "text-acid" : l.verdict === "bad" ? "text-rose" : "text-ink";
          const tag = l.verdict === "good" ? "value" : l.verdict === "bad" ? "poor" : "fair";
          return (
            <li
              key={`${l.market}-${l.side}`}
              className={`flex items-center justify-between gap-3 px-4 py-2.5 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-line/70 ${
                l.side === v.bestSide ? "bg-acid/[0.07]" : "bg-card/50"
              }`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="font-mono text-[0.7rem] uppercase tracking-wider text-ink/50">{l.market}</span>
                <span className={`truncate font-semibold ${tone}`}>{l.side}</span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className={`font-mono text-[0.7rem] uppercase tracking-wider ${tone}`}>{tag}</span>
                <span className="tnum font-display text-base font-extrabold leading-none text-ink">{l.price}</span>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 font-mono text-[0.6rem] uppercase tracking-wider text-faint">
        Odds: {v.source} · book margin +{v.overroundPct}%
      </p>
    </div>
  );
}

function DetailTrap({ t }: { t: TrapDetector }) {
  const tripped = t.flags.filter((f) => f.tripped);
  return (
    <div>
      <DetailHead>The honest filter</DetailHead>
      {tripped.length === 0 ? (
        <p className="text-sm leading-relaxed text-muted">
          None of the {t.flags.length} weak-bet checks trip — nothing here to talk you out of.
        </p>
      ) : (
        <ul className="space-y-2">
          {tripped.map((f) => (
            <li key={f.name} className="flex items-start gap-2.5">
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-amber/15 text-[0.7rem] font-black text-amber">
                !
              </span>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-amber">{f.name}</div>
                <p className="text-[0.8rem] leading-snug text-muted">{f.why}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <blockquote className="mt-4 border-l-2 border-acid-dim pl-4 text-sm italic leading-relaxed text-muted">
        {t.discipline}
      </blockquote>
    </div>
  );
}

function DetailHead({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-3 font-mono text-[0.72rem] uppercase tracking-[0.22em] text-ink/60">{children}</h3>
  );
}

function PointList({ label, tone, mark, items }: { label: string; tone: "acid" | "rose"; mark: string; items: string[] }) {
  const dot = tone === "acid" ? "bg-acid" : "bg-rose";
  const glyph = tone === "acid" ? "text-acid" : "text-rose";
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className={`size-1.5 rounded-full ${dot}`} />
        <span className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-faint">{label}</span>
      </div>
      <ul className="space-y-1.5">
        {items.map((c, i) => (
          <li key={i} className="flex gap-2 text-sm leading-snug text-muted">
            <span className={`shrink-0 font-mono ${glyph}`}>{mark}</span>
            <span>{c}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function KV({ k, children, full = false }: { k: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <dt className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-faint">{k}</dt>
      <dd className="mt-0.5 text-sm leading-snug text-muted">{children}</dd>
    </div>
  );
}

/** Compact signal for the match-list card: the bottom-line verdict. */
export function BrainVerdictChip({ pred }: { pred: Prediction }) {
  const v = pred.brainSummary?.verdict ?? pred.trapDetector?.verdict;
  if (!v) return null;
  const map = {
    PLAYABLE: "text-acid border-acid-dim",
    LEAN: "text-amber border-amber/50",
    PASS: "text-rose border-rose-dim",
  } as const;
  return (
    <span className={`rounded-full border px-2 py-0.5 font-mono text-[0.58rem] font-bold uppercase tracking-wider ${map[v]}`}>
      {v}
    </span>
  );
}
