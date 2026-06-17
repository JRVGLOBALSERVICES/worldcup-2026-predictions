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
