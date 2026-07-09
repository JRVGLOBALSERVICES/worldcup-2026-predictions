/* Hallmark · macrostructure: Almanac (numbered chapters) · tone: editorial-programme
 * anchor hue: ink-blue 265 ground · electric-lime 123 single hero accent
 * Redesign layer only — preserves the existing token system + Archivo display.
 * The matchday-programme voice: a ruled masthead strip, ordinal chapter marks,
 * and hairline rules that frame the stat tables like a printed match programme.
 * pre-emit critique: P5 H5 E4 S4 R5 V4 */

import type { ReactNode } from "react";

/**
 * The programme masthead — a printed-programme strip that heads a page. Double
 * hairline rules top and bottom, a centred "official programme" wordmark, and
 * edition metadata (issue label · date) hung in the corners like a real cover.
 * Ordinal, editorial, restrained — the loud work is left to one lime accent.
 */
export function Masthead({
  kicker,
  title,
  edition,
  meta,
}: {
  kicker: string;
  title: string;
  edition: string;
  meta?: string;
}) {
  return (
    <div className="stripes overflow-hidden rounded-3xl border border-line bg-pitch-2/60">
      {/* top edition strip */}
      <div className="flex items-center justify-between gap-3 border-b border-line/70 px-5 py-2.5 sm:px-8">
        <span className="font-mono text-[0.6rem] uppercase tracking-[0.24em] text-acid">
          {edition}
        </span>
        <span className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-faint/70">
          Official Programme
        </span>
        {meta ? (
          <span className="hidden font-mono text-[0.6rem] uppercase tracking-[0.2em] text-faint/70 sm:inline">
            {meta}
          </span>
        ) : (
          <span className="hidden sm:inline sm:w-24" aria-hidden />
        )}
      </div>

      {/* masthead body */}
      <div className="px-5 py-8 text-center sm:px-8 sm:py-12">
        <p className="mb-3 font-mono text-[0.66rem] uppercase tracking-[0.28em] text-acid">
          {kicker}
        </p>
        <h1 className="mx-auto max-w-4xl font-display text-4xl font-black uppercase leading-[0.92] tracking-tight [overflow-wrap:anywhere] sm:text-6xl">
          {title}
        </h1>
        {/* centred rule + ball, programme-cover style */}
        <div className="mx-auto mt-6 flex max-w-xs items-center gap-3">
          <span className="h-px flex-1 bg-line" />
          <span className="text-sm leading-none text-faint/70" aria-hidden>
            ⚽
          </span>
          <span className="h-px flex-1 bg-line" />
        </div>
      </div>
    </div>
  );
}

/**
 * A numbered chapter divider — the programme's ordinal section mark. A big lime
 * page-number, a rule, and the section title stacked underneath (never the
 * banned tag-left / heading-right split). This is genuine ordinal content, so
 * the numbering is earned, not decorative.
 */
export function ChapterHead({
  no,
  title,
  sub,
  action,
}: {
  no: string;
  title: string;
  sub?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-7">
      <div className="flex items-end justify-between gap-4 border-b-2 border-line pb-3">
        <div className="flex items-end gap-4">
          <span className="font-display text-4xl font-black leading-[0.8] tracking-tight text-acid tabular-nums sm:text-5xl">
            {no}
          </span>
          <span className="mb-1 hidden h-8 w-px bg-line sm:block" aria-hidden />
          <h2 className="font-display text-2xl font-black uppercase leading-[0.95] tracking-tight [overflow-wrap:anywhere] sm:text-3xl">
            {title}
          </h2>
        </div>
        {action ? <div className="mb-1 hidden shrink-0 sm:block">{action}</div> : null}
      </div>
      {sub ? (
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">{sub}</p>
      ) : null}
      {action ? <div className="mt-3 sm:hidden">{action}</div> : null}
    </div>
  );
}

/**
 * The "in this issue" contents index — quick jump chips to each chapter, framed
 * as a programme contents strip. Pure anchors; no client JS.
 */
export function Contents({ items }: { items: { no: string; label: string; href: string }[] }) {
  return (
    <nav
      aria-label="In this issue"
      className="rounded-2xl border border-line bg-card/40 px-4 py-3.5 sm:px-5"
    >
      <p className="mb-2.5 font-mono text-[0.6rem] uppercase tracking-[0.22em] text-faint/70">
        In this issue
      </p>
      <ul className="flex flex-col divide-y divide-line/40 sm:flex-row sm:divide-y-0">
        {items.map((it) => (
          <li key={it.href} className="sm:flex-1">
            <a
              href={it.href}
              className="group flex items-baseline gap-2.5 py-2 transition-colors hover:text-acid sm:px-3"
            >
              <span className="font-display text-sm font-black tabular-nums text-acid/80">
                {it.no}
              </span>
              <span className="font-display text-sm font-bold uppercase tracking-tight text-ink group-hover:text-acid">
                {it.label}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
