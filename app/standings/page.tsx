import type { Metadata } from "next";
import { SiteNav } from "@/components/SiteNav";
import { groupTables, type GroupTable, type StandingRow } from "@/lib/standings";

export const revalidate = 1800;

export const metadata: Metadata = {
  title: "Group Standings — World Cup 2026 Tables",
  description:
    "Live World Cup 2026 group standings — all twelve groups A–L with points, played, goal difference and recent form, built straight from the official match feed.",
};

export default function StandingsPage() {
  const tables = groupTables();
  const totalPlayed = tables.reduce((n, t) => n + t.played, 0);
  const totalGames = tables.reduce((n, t) => n + t.total, 0);

  return (
    <main className="mx-auto max-w-5xl px-4 pb-24 sm:px-6">
      <header className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-acid font-display text-lg font-black text-pitch">
            ⚽
          </span>
          <span className="font-display text-base font-extrabold uppercase tracking-tight">
            Matchday Edge
          </span>
        </div>
        <SiteNav active="standings" />
      </header>

      <section className="stripes overflow-hidden rounded-3xl border border-line bg-pitch-2/60 p-6 sm:p-10">
        <p className="mb-4 font-mono text-[0.72rem] uppercase tracking-[0.24em] text-acid">
          World Cup 2026 · group stage
        </p>
        <h1 className="max-w-3xl font-display text-4xl font-black uppercase leading-[0.95] tracking-tight sm:text-6xl">
          The road out of the groups.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
          All twelve groups, A to L — points, played, goal difference and recent form, built
          straight from the official match feed. {totalPlayed} of {totalGames} group games counted.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[0.66rem] uppercase tracking-[0.16em] text-faint">
          <Legend swatch="bg-acid" label="Top 2 — through" />
          <Legend swatch="bg-amber" label="3rd — best-third race" />
        </div>
      </section>

      <div className="mt-8 grid gap-4 sm:mt-10 sm:grid-cols-2">
        {tables.map((t) => (
          <GroupCard key={t.group} table={t} />
        ))}
      </div>

      <footer className="mt-12 border-t border-line pt-6 text-sm text-faint">
        <p className="leading-relaxed text-muted">
          Tables count finished matches only, mirrored from the official feed&apos;s standings — so
          ordering already reflects the full FIFA tiebreak chain (points, goal difference, goals
          scored, then head-to-head and fair-play).
        </p>
      </footer>
    </main>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`h-3 w-1 rounded-[1px] ${swatch}`} />
      {label}
    </span>
  );
}

function GroupCard({ table }: { table: GroupTable }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card/50">
      <div className="flex items-center justify-between border-b border-line/70 px-4 py-3">
        <h2 className="font-display text-sm font-extrabold uppercase tracking-[0.14em]">
          Group {table.group}
        </h2>
        <span className="font-mono text-[0.62rem] uppercase tracking-wider text-faint">
          {table.played}/{table.total} played
        </span>
      </div>

      {/* column header — grid kept identical to rows so numbers align and never overflow */}
      <div className="grid grid-cols-[1.25rem_minmax(0,1fr)_1.25rem_1.25rem_1.25rem_1.75rem_2rem] items-center gap-x-1.5 px-3 py-2 font-mono text-[0.58rem] uppercase tracking-wider text-faint sm:gap-x-2 sm:px-4">
        <span className="text-center">#</span>
        <span>Team</span>
        <span className="hidden text-center sm:block">W</span>
        <span className="hidden text-center sm:block">D</span>
        <span className="hidden text-center sm:block">L</span>
        <span className="text-right">GD</span>
        <span className="text-right">Pts</span>
      </div>

      <ul>
        {table.rows.map((row, i) => (
          <Row key={row.name} row={row} rank={i + 1} />
        ))}
      </ul>
    </section>
  );
}

function Row({ row, rank }: { row: StandingRow; rank: number }) {
  // Top 2 qualify directly; 3rd is in the best-third race. Tint the rank marker
  // and add a hairline accent so qualification reads at a glance.
  const zone =
    rank <= 2 ? { bar: "bg-acid", num: "text-acid" } : rank === 3 ? { bar: "bg-amber", num: "text-amber" } : { bar: "bg-transparent", num: "text-faint" };

  return (
    <li className="grid grid-cols-[1.25rem_minmax(0,1fr)_1.25rem_1.25rem_1.25rem_1.75rem_2rem] items-center gap-x-1.5 px-3 py-2.5 text-sm [&:not(:last-child)]:border-b [&:not(:last-child)]:border-line/60 sm:gap-x-2 sm:px-4">
      <span className="relative grid place-items-center">
        <span className={`absolute -left-3 h-full w-0.5 rounded-full ${zone.bar}`} aria-hidden />
        <span className={`tnum font-mono text-[0.72rem] font-bold ${zone.num}`}>{rank}</span>
      </span>

      <span className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-base leading-none">{row.flag}</span>
        <span className="truncate font-display text-[0.92rem] font-bold uppercase tracking-tight text-ink">
          {row.name}
        </span>
        <FormDots form={row.form} />
      </span>

      <span className="hidden tnum text-center font-mono text-[0.78rem] text-acid sm:block">{row.won}</span>
      <span className="hidden tnum text-center font-mono text-[0.78rem] text-muted sm:block">{row.drawn}</span>
      <span className="hidden tnum text-center font-mono text-[0.78rem] text-rose sm:block">{row.lost}</span>
      <span className="tnum text-right font-mono text-[0.78rem] text-muted">
        {row.goalDiff > 0 ? "+" : ""}
        {row.goalDiff}
      </span>
      <span className="tnum text-right font-display text-base font-black text-ink">{row.points}</span>
    </li>
  );
}

/** Compact recent-form strip (newest-first), hidden on the tightest widths so the
 * row never overflows — the data is decorative here, the table is the point. */
function FormDots({ form }: { form: ("W" | "D" | "L")[] }) {
  if (form.length === 0) return null;
  const cls: Record<string, string> = { W: "bg-acid", D: "bg-faint", L: "bg-rose" };
  return (
    <span className="ml-1 hidden items-center gap-[3px] md:inline-flex" title={`Form: ${form.join("")} (newest first)`}>
      {form.map((c, i) => (
        <span key={i} className={`size-1.5 rounded-full ${cls[c] ?? "bg-line"}`} aria-hidden />
      ))}
    </span>
  );
}
