"use client";

import { useCallback, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

/** Verdict-keyed tints. `spot` = cursor-fill glow, `edge` = left status bar +
 *  conic border sweep, `glow` = the ambient corner light behind the glass (so the
 *  blur has real depth to refract). Green = winning, amber = still-on, red = lost. */
const SPOT: Record<string, string> = {
  acid: "rgb(57 217 138 / 0.16)",
  amber: "rgb(232 183 58 / 0.15)",
  rose: "rgb(196 77 88 / 0.15)",
  none: "rgb(255 255 255 / 0.07)",
};
const EDGE: Record<string, string> = {
  acid: "rgb(57 217 138 / 0.9)",
  amber: "rgb(232 183 58 / 0.85)",
  rose: "rgb(196 77 88 / 0.85)",
  none: "rgb(255 255 255 / 0.35)",
};
const GLOW: Record<string, string> = {
  acid: "rgb(57 217 138 / 0.15)",
  amber: "rgb(232 183 58 / 0.14)",
  rose: "rgb(196 77 88 / 0.13)",
  none: "rgb(120 140 170 / 0.10)",
};

export type SpotTone = keyof typeof SPOT;

/**
 * Glass card with a cursor-tracked spotlight AND an Aceternity-style conic border
 * glow — both re-implemented canvas- and dependency-free. One rAF-throttled
 * pointer handler updates `--mx/--my` (cursor position) and `--ang` (pointer
 * angle from centre, driving the border sweep). `tone` colours the glow, the
 * left status edge and the ambient corner light. Costs ~nothing across a page
 * full of live slips, so it scales where a per-card canvas would not.
 */
export function SpotlightCard({
  children,
  tone = "none",
  edge = true,
  className = "",
}: {
  children: ReactNode;
  tone?: SpotTone;
  edge?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const raf = useRef(0);

  const onMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || raf.current) return;
    const { clientX, clientY } = e;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const r = el.getBoundingClientRect();
      const x = clientX - r.left;
      const y = clientY - r.top;
      el.style.setProperty("--mx", `${x}px`);
      el.style.setProperty("--my", `${y}px`);
      // Pointer angle from the card centre → rotates the conic border sweep so
      // the bright arc trails the cursor (the glowing-effect behaviour).
      const ang = (Math.atan2(y - r.height / 2, x - r.width / 2) * 180) / Math.PI + 90;
      el.style.setProperty("--ang", `${ang}`);
    });
  }, []);

  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      style={{ "--spot": SPOT[tone], "--edge": EDGE[tone], "--glow": GLOW[tone] } as CSSProperties}
      className={`glass spot ${edge ? "glass-edge" : ""} ${className}`}
    >
      <span className="slip-glow" aria-hidden />
      <span className="border-glow" aria-hidden />
      <span className="spot-glow" aria-hidden />
      <div className="relative">{children}</div>
    </div>
  );
}
