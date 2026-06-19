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
    <h3 className="mb-3 font-mono text-[0.7rem] uppercase tracking-[0.22em] text-faint">
      {children}
    </h3>
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
