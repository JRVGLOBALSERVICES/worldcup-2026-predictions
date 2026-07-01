"use client";

import { useCallback, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

/** Emerald / amber / rose glow tints — the spotlight colour keyed to a slip's
 *  status, so the light that follows the cursor reads the same story as the
 *  verdict pill (winning = green, still-on = amber, lost = red). */
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
  none: "transparent",
};

export type SpotTone = keyof typeof SPOT;

/**
 * Glass card with a cursor-tracked spotlight — the Aceternity `card-spotlight`
 * interaction, re-implemented canvas-free (CSS custom properties + one
 * rAF-throttled pointer handler) so it costs ~nothing across a page full of live
 * slips. Wraps its children in `.glass` + `.spot`; `tone` colours both the glow
 * and the left status edge. `edge` toggles the verdict edge bar.
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
      el.style.setProperty("--mx", `${clientX - r.left}px`);
      el.style.setProperty("--my", `${clientY - r.top}px`);
    });
  }, []);

  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      style={{ "--spot": SPOT[tone], "--edge": EDGE[tone] } as CSSProperties}
      className={`glass spot ${edge ? "glass-edge" : ""} ${className}`}
    >
      <span className="spot-glow" aria-hidden />
      <div className="relative">{children}</div>
    </div>
  );
}
