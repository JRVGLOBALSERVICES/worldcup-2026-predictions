import type { Metadata } from "next";
import { SiteNav } from "@/components/SiteNav";
import { StatLeaderboards } from "@/components/StatLeaderboards";
import { groupTables, type GroupTable, type StandingRow } from "@/lib/standings";
import { getStats } from "@/lib/stats";

export const revalidate = 1800;

export const metadata: Metadata = {
  title: "Group Standings & Player Leaders — World Cup 2026 Tables",
  description:
    "Live World Cup 2026 group standings — all twelve groups A–L with points, played, goal difference and recent form — plus the player leaderboards: top scorers, assists, clean sheets, cards and penalties. Built straight from the official match feed.",
};

export default function StandingsPage() {
  const tables = groupTables();
  const totalPlayed = tables.reduce((n, t) => n + t.played, 0);
  const totalGames = tables.reduce((n, t) => n + t.total, 0);
  const stats = getStats();

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
          All twelve groups, A to L — built straight from the official match feed.
          {" "}<span className="text-ink">{totalPlayed} of {totalGames}</span> group games played so far.
        </p>

        {/* Plain-English primer — the format itself, so "4/6 played" never reads as a bug. */}
        <div className="mt-6 max-w-2xl rounded-xl border border-line/70 bg-pitch/40 p-4 font-mono text-[0.7rem] leading-relaxed text-muted sm:text-[0.74rem]">
          <span className="text-acid">How it works → </span>
          Each group has <span className="text-ink">4 teams</span>{" "}who all play each other once —
          that&apos;s <span className="text-ink">6 games per group</span>, 3 each. The
          {" "}<span className="text-acid">top 2</span> of every group go through, plus the
          {" "}<span className="text-amber">8 best 3rd-placed</span> teams.
          A group showing <span className="text-ink">4/6</span>{" "}just hasn&apos;t finished its last
          round yet — <span className="text-ink">6/6</span>{" "}means it&apos;s done.
        </div>

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

      {/* Player leaderboards — relocated here from the Stats page (now completion
          stats only). Server-rendered from the committed ESPN snapshot. */}
      <section className="mt-16 border-t border-line/60 pt-10">
        <p className="mb-3 font-mono text-[0.72rem] uppercase tracking-[0.24em] text-acid">
          World Cup 2026 · tournament leaders
        </p>
        <h2 className="max-w-3xl font-display text-3xl font-black uppercase leading-[0.95] tracking-tight sm:text-4xl">
          The race for the Golden Boot.
        </h2>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted sm:text-base">
          Top scorers, assists, clean sheets, the cards table and penalties scored vs missed — every
          name ranked top ten straight from the official match feed.{" "}
          <span className="text-ink">{stats.meta.finished}</span> matches counted so far.
        </p>

        <div className="mt-8">
          <StatLeaderboards categories={stats.categories} />
        </div>
      </section>

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
  const left = table.total - table.played;
  const done = left <= 0;
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card/50">
      <div className="flex items-center justify-between border-b border-line/70 px-4 py-3">
        <h2 className="font-display text-sm font-extrabold uppercase tracking-[0.14em]">
          Group {table.group}
        </h2>
        {/* status reads as words, not a bare fraction — "Complete" or "N to play" */}
        <span className="flex items-center gap-1.5 font-mono text-[0.62rem] uppercase tracking-wider">
          <span className="text-faint">{table.played}/{table.total}</span>
          <span className={done ? "text-acid" : "text-amber"}>
            {done ? "· Complete" : `· ${left} to play`}
          </span>
        </span>
      </div>

      {/* column header — grid kept identical to rows so numbers align and never overflow.
          Full P W D L GD Pts show at EVERY width; the mobile grid is tighter (narrow
          stat columns + smaller gaps) so the whole league line fits on a phone. */}
      <div className="grid grid-cols-[1rem_minmax(0,1fr)_1.05rem_1.05rem_1.05rem_1.05rem_1.6rem_1.7rem] items-center gap-x-1 px-3 py-2 font-mono text-[0.58rem] uppercase tracking-wider text-faint sm:grid-cols-[1.25rem_minmax(0,1fr)_1.5rem_1.25rem_1.25rem_1.25rem_1.75rem_2rem] sm:gap-x-2 sm:px-4">
        <span className="text-center">#</span>
        <span>Team</span>
        <span className="text-center" title="Games played">P</span>
        <span className="text-center" title="Won">W</span>
        <span className="text-center" title="Drawn">D</span>
        <span className="text-center" title="Lost">L</span>
        <span className="text-right">GD</span>
        <span className="text-right">Pts</span>
      </div>

      <ul>
        {table.rows.map((row, i) => (
          <Row key={row.name} row={row} rank={i + 1} />
        ))}
      </ul>

      <NextUp rows={table.rows} />
    </section>
  );
}

const SHORT_ROUND: Record<string, string> = {
  "Round of 32": "R32",
  "Round of 16": "R16",
  "Quarter-final": "QF",
  "Semi-final": "SF",
  "Third place": "3RD",
  Final: "FIN",
  Group: "GRP",
};

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(iso));
}

/**
 * "Next up" strip — each surviving team's next scheduled game, straight from the
 * feed. Group teams show their final group match; advancing teams show their
 * Round-of-32 tie (a real nation once drawn, or an unresolved bracket slot like
 * "3rd: C/E/F/H/I" before the draw resolves). Eliminated teams are omitted, so
 * the strip only ever lists who is still playing.
 */
function NextUp({ rows }: { rows: StandingRow[] }) {
  const items = rows
    .map((r) => {
      if (r.next) return { name: r.name, flag: r.flag, ...r.next, date: r.next.kickoffUTC };
      // Qualified but the bracket slot isn't drawn yet (best-third race):
      // surface it honestly as a Round-of-32 spot with the opponent still TBD.
      const advancing = /advance|best/i.test(r.advance?.label ?? "");
      if (advancing)
        return {
          name: r.name,
          flag: r.flag,
          round: "Round of 32",
          opponent: "To be drawn",
          opponentFlag: null,
          home: true,
          placeholder: true,
          date: "",
        };
      return null;
    })
    .filter(Boolean) as Array<{
    name: string;
    flag: string;
    round: string;
    opponent: string;
    opponentFlag: string | null;
    home: boolean;
    placeholder: boolean;
    date: string;
  }>;

  if (items.length === 0) return null;

  return (
    <div className="border-t border-line/70 bg-pitch/30 px-3 py-3 sm:px-4">
      <p className="mb-2 font-mono text-[0.56rem] uppercase tracking-[0.2em] text-faint">
        Next up
      </p>
      <ul className="flex flex-col gap-1.5">
        {items.map((it) => (
          <li key={it.name} className="flex items-center gap-2 text-[0.78rem]">
            {/* who */}
            <span className="flex min-w-0 shrink items-center gap-1.5">
              <span className="shrink-0 text-sm leading-none">{it.flag}</span>
              <span className="truncate font-display text-[0.8rem] font-bold uppercase tracking-tight text-ink">
                {it.name}
              </span>
            </span>

            {/* round badge */}
            <span className="shrink-0 rounded bg-acid/15 px-1.5 py-0.5 font-mono text-[0.56rem] font-bold uppercase tracking-wider text-acid">
              {SHORT_ROUND[it.round] ?? it.round}
            </span>

            {/* opponent + date, right-aligned */}
            <span className="ml-auto flex min-w-0 items-center justify-end gap-1.5 text-right">
              <span className="shrink-0 font-mono text-[0.6rem] uppercase tracking-wider text-faint">
                {it.home ? "vs" : "@"}
              </span>
              {it.opponentFlag && (
                <span className="shrink-0 text-sm leading-none">{it.opponentFlag}</span>
              )}
              <span
                className={`truncate font-display text-[0.78rem] font-bold uppercase tracking-tight ${
                  it.placeholder ? "text-muted" : "text-ink"
                }`}
              >
                {it.opponent}
              </span>
              {it.date && (
                <span className="shrink-0 font-mono text-[0.58rem] uppercase tracking-wider text-faint">
                  · {fmtDate(it.date)}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Row({ row, rank }: { row: StandingRow; rank: number }) {
  // Top 2 qualify directly; 3rd is in the best-third race. Tint the rank marker
  // and add a hairline accent so qualification reads at a glance.
  const zone =
    rank <= 2 ? { bar: "bg-acid", num: "text-acid" } : rank === 3 ? { bar: "bg-amber", num: "text-amber" } : { bar: "bg-transparent", num: "text-faint" };

  return (
    <li className="grid grid-cols-[1rem_minmax(0,1fr)_1.05rem_1.05rem_1.05rem_1.05rem_1.6rem_1.7rem] items-center gap-x-1 px-3 py-2.5 text-sm [&:not(:last-child)]:border-b [&:not(:last-child)]:border-line/60 sm:grid-cols-[1.25rem_minmax(0,1fr)_1.5rem_1.25rem_1.25rem_1.25rem_1.75rem_2rem] sm:gap-x-2 sm:px-4">
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

      <span className="tnum text-center font-mono text-[0.72rem] text-muted sm:text-[0.78rem]">{row.played}</span>
      <span className="tnum text-center font-mono text-[0.72rem] text-acid sm:text-[0.78rem]">{row.won}</span>
      <span className="tnum text-center font-mono text-[0.72rem] text-muted sm:text-[0.78rem]">{row.drawn}</span>
      <span className="tnum text-center font-mono text-[0.72rem] text-rose sm:text-[0.78rem]">{row.lost}</span>
      <span className="tnum text-right font-mono text-[0.72rem] text-muted sm:text-[0.78rem]">
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
