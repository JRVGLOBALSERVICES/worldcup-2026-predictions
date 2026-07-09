import type { Prediction } from "@/lib/types";

export function OddsPill({ odds, tone = "default" }: { odds: string; tone?: "default" | "acid" | "amber" }) {
  const map = {
    default: "border-line text-muted",
    acid: "border-acid-dim text-acid",
    amber: "border-amber/50 text-amber",
  } as const;
  return (
    <span
      className={`tnum inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 font-mono text-[0.72rem] leading-none ${map[tone]}`}
    >
      {odds}
    </span>
  );
}

/**
 * 1–5 conviction meter — the rating Rj reads instead of odds. Five segments
 * fill to `value`; tone shifts acid (strong) → amber (mid) → faint (weak).
 * `size="sm"` is the inline variant used in lists; default carries a label.
 */
export function StrengthMeter({
  value,
  label,
  size = "md",
}: {
  value: number;
  label?: string;
  size?: "sm" | "md";
}) {
  const v = Math.max(1, Math.min(5, Math.round(value)));
  const tone = v >= 4 ? "acid" : v === 3 ? "amber" : "plain";
  const fill = { acid: "bg-acid", amber: "bg-amber", plain: "bg-ink" } as const;
  const text = { acid: "text-acid", amber: "text-amber", plain: "text-ink" } as const;
  const seg = size === "sm" ? "h-2 w-1" : "h-3 w-1.5";
  return (
    <span className="inline-flex shrink-0 items-center gap-2" title={`Strength ${v} of 5${label ? ` — ${label}` : ""}`}>
      <span className="inline-flex items-end gap-[3px]" aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className={`${seg} rounded-[1px] ${i <= v ? fill[tone] : "bg-line"}`}
          />
        ))}
      </span>
      <span className={`tnum font-mono text-[0.78rem] font-semibold leading-none ${text[tone]}`}>
        {v}
        {label && size === "md" && <span className="ml-1.5 uppercase tracking-wider">{label}</span>}
      </span>
    </span>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-3 font-mono text-[0.78rem] uppercase tracking-[0.18em] text-ink/70">
      {children}
    </h3>
  );
}

/**
 * Plain-English names for the cryptic football / betting shorthand that used to
 * appear bare across the app ("3sh", "Gls·Ast·Sh·On·Pas…", "HTFT", "MYT"). Every
 * abbreviation renders through <StatAbbr> so hover / long-press spells it out and
 * screen readers announce the full term — the single source of truth for labels.
 */
export const STAT_TERMS: Record<string, string> = {
  Gls: "Goals",
  Ast: "Assists",
  Sh: "Shots",
  Shots: "Shots",
  On: "Shots on target",
  "On tgt": "Shots on target",
  Off: "Shots off target",
  Blk: "Blocks",
  Blocks: "Blocks",
  Pas: "Passes completed",
  Tkl: "Tackles",
  Tackles: "Tackles",
  Sv: "Saves",
  Saves: "Saves",
  Fls: "Fouls",
  Fouls: "Fouls",
  Crd: "Cards (yellow / red)",
  Cards: "Cards (yellow / red)",
  Cor: "Corners",
  Corners: "Corners",
  SOT: "Shots on target",
  Pos: "Possession",
  W: "Won",
  D: "Drawn",
  L: "Lost",
  R: "Refunded",
  Y: "Yellow card",
  G: "Goals",
  A: "Assists",
  MYT: "Malaysia time (GMT+8)",
  ET: "US Eastern time",
  HT: "Half-time",
  FT: "Full-time",
  "HT/FT": "Half-time result then full-time result",
  H2H: "Head-to-head — recent meetings",
};

/**
 * A stat abbreviation rendered as a real <abbr>: the full term is one hover /
 * long-press away and read out by assistive tech, so the column can stay compact
 * without being a mystery. Use for every 2–3 letter code in a header or chip.
 */
export function StatAbbr({ code, className = "" }: { code: string; className?: string }) {
  const full = STAT_TERMS[code] ?? code;
  return (
    <abbr
      title={full}
      className={`cursor-help font-mono uppercase tracking-[0.08em] no-underline decoration-dotted underline-offset-2 hover:underline ${className}`}
    >
      {code}
    </abbr>
  );
}

/**
 * A tabular number paired with its own small caption underneath — the pattern
 * that replaces jammed notation like "3sh" or "≈2(3)". The number leads, the
 * label sits quietly below it, so a value is never ambiguous about what it counts.
 */
export function StatCell({
  value,
  label,
  tone = "plain",
  hint,
}: {
  value: React.ReactNode;
  label: string;
  tone?: "plain" | "acid" | "amber" | "mint" | "muted";
  hint?: string;
}) {
  const text = {
    plain: "text-ink",
    acid: "text-acid",
    amber: "text-amber",
    mint: "text-mint",
    muted: "text-ink/45",
  }[tone];
  return (
    <span className="inline-flex flex-col items-center gap-0.5" title={hint}>
      <span className={`tnum font-mono text-[0.95rem] font-semibold leading-none ${text}`}>{value}</span>
      <span className="text-[0.6rem] uppercase leading-none tracking-[0.1em] text-ink/40">{label}</span>
    </span>
  );
}

/**
 * A visible, readable legend row — chips that spell out what a colour or code
 * means, replacing the near-invisible `text-ink/35` footnotes. Pass swatch tones
 * to draw the dot in that colour.
 */
export function Legend({ items }: { items: { swatch?: "acid" | "amber" | "mint" | "rose" | "muted"; term: string }[] }) {
  const dot = {
    acid: "bg-acid",
    amber: "bg-amber",
    mint: "bg-mint",
    rose: "bg-rose",
    muted: "bg-ink/40",
  };
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.72rem] leading-relaxed text-ink/55">
      {items.map((it, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          {it.swatch && <span className={`size-1.5 rounded-full ${dot[it.swatch]}`} aria-hidden />}
          {it.term}
        </span>
      ))}
    </div>
  );
}

export function Banker() {
  return (
    <span className="rounded-sm bg-acid/15 px-1.5 py-0.5 font-mono text-[0.6rem] font-semibold uppercase tracking-wider text-acid">
      Banker
    </span>
  );
}

const CONF: Record<Prediction["confidence"], { label: string; cls: string }> = {
  high: { label: "High confidence", cls: "text-acid border-acid-dim" },
  medium: { label: "Medium confidence", cls: "text-amber border-amber/50" },
  low: { label: "Low confidence", cls: "text-faint border-line" },
};

export function Confidence({ level }: { level: Prediction["confidence"] }) {
  const c = CONF[level];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.7rem] ${c.cls}`}>
      <span className="size-1.5 rounded-full bg-current" />
      {c.label}
    </span>
  );
}

export function StatusBadge({ status }: { status: Prediction["lineups"]["status"] }) {
  if (status === "confirmed")
    return (
      <span className="rounded-full bg-acid/15 px-2 py-0.5 font-mono text-[0.62rem] uppercase tracking-wider text-acid">
        XI confirmed
      </span>
    );
  if (status === "probable")
    return (
      <span className="rounded-full bg-amber/15 px-2 py-0.5 font-mono text-[0.62rem] uppercase tracking-wider text-amber">
        Probable XI
      </span>
    );
  return (
    <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[0.62rem] uppercase tracking-wider text-faint">
      XI pending
    </span>
  );
}
