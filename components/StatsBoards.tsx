"use client";

import { useCallback, useState } from "react";
import { ForceRefreshButton } from "./RefreshCountdown";
import {
  STAT_CATEGORIES,
  TEAM_PERF_CATEGORIES,
  type StatRow,
  type StatsFile,
  type TeamPerfRow,
} from "@/lib/stats";

// Accent → static class strings (no dynamic concatenation, so Tailwind keeps them).
const ACCENT: Record<string, { text: string; chip: string; bar: string }> = {
  acid: { text: "text-acid", chip: "bg-acid text-on-acid", bar: "bg-acid" },
  mint: { text: "text-mint", chip: "bg-mint text-pitch", bar: "bg-mint" },
  amber: { text: "text-amber", chip: "bg-amber text-pitch", bar: "bg-amber" },
  rose: { text: "text-rose", chip: "bg-rose text-ink", bar: "bg-rose" },
};

const fmtMyt = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

function Row({
  row,
  entity,
  accent,
  max,
}: {
  row: StatRow;
  entity: "player" | "team";
  accent: string;
  max: number;
}) {
  const a = ACCENT[accent];
  const lead = row.rank === 1;
  return (
    <li className="flex items-center gap-3 py-2">
      <span
        className={[
          "grid size-6 shrink-0 place-items-center rounded-md font-mono text-[0.7rem] font-bold tabular-nums",
          lead ? a.chip : "border border-line text-ink/55",
        ].join(" ")}
      >
        {row.rank}
      </span>
      <span className="shrink-0 text-base leading-none">{row.flag}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-sm font-bold uppercase tracking-tight text-ink">
          {entity === "team" ? row.team : row.name}
        </span>
        {entity === "player" && (
          <span className="block truncate font-mono text-[0.62rem] uppercase tracking-[0.12em] text-ink/45">
            {row.team}
            {row.matches != null ? ` · ${row.matches} app` : ""}
          </span>
        )}
      </span>
      {/* tiny share-of-leader bar — gives the column a visual race read */}
      <span className="hidden h-1 w-12 overflow-hidden rounded-full bg-line/50 sm:block">
        <span
          className={["block h-full rounded-full", a.bar].join(" ")}
          style={{ width: `${Math.max(8, Math.round((row.value / max) * 100))}%` }}
        />
      </span>
      <span className={["w-7 shrink-0 text-right font-display text-lg font-black tabular-nums", a.text].join(" ")}>
        {row.value}
      </span>
    </li>
  );
}

function Board({
  label,
  unit,
  entity,
  accent,
  rows,
  featured = false,
}: {
  label: string;
  unit: string;
  entity: "player" | "team";
  accent: string;
  rows: StatRow[];
  featured?: boolean;
}) {
  const a = ACCENT[accent];
  const max = rows.length ? rows[0].value : 1;
  return (
    <section
      className={[
        "rounded-2xl border border-line bg-card/40 p-4 sm:p-5",
        featured ? "sm:col-span-2 lg:col-span-3" : "",
      ].join(" ")}
    >
      <header className="mb-1 flex items-baseline justify-between gap-2 border-b border-line/60 pb-3">
        <h2 className={["font-display text-base font-black uppercase tracking-tight", a.text].join(" ")}>
          {label}
        </h2>
        <span className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-ink/45">{unit}</span>
      </header>
      {rows.length === 0 ? (
        <p className="py-6 text-center font-mono text-[0.7rem] uppercase tracking-[0.12em] text-ink/40">
          None yet — group stage just kicked off
        </p>
      ) : (
        <ul className={["divide-y divide-line/40", featured ? "sm:columns-2 sm:gap-x-8 [&_li]:break-inside-avoid" : ""].join(" ")}>
          {rows.map((r, i) => (
            <Row key={`${r.name ?? r.team}-${i}`} row={r} entity={entity} accent={accent} max={max} />
          ))}
        </ul>
      )}
    </section>
  );
}

function PerfRow({ row, accent, max }: { row: TeamPerfRow; accent: string; max: number }) {
  const a = ACCENT[accent];
  const lead = row.rank === 1;
  return (
    <li className="flex items-center gap-3 py-2">
      <span
        className={[
          "grid size-6 shrink-0 place-items-center rounded-md font-mono text-[0.7rem] font-bold tabular-nums",
          lead ? a.chip : "border border-line text-ink/55",
        ].join(" ")}
      >
        {row.rank}
      </span>
      <span className="shrink-0 text-base leading-none">{row.flag}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-sm font-bold uppercase tracking-tight text-ink">
          {row.team}
        </span>
        <span className="block truncate font-mono text-[0.62rem] uppercase tracking-[0.12em] text-ink/45">
          {row.matches} {row.matches === 1 ? "match" : "matches"}
        </span>
      </span>
      <span className="hidden h-1 w-12 overflow-hidden rounded-full bg-line/50 sm:block">
        <span
          className={["block h-full rounded-full", a.bar].join(" ")}
          style={{ width: `${Math.max(8, Math.round((row.value / max) * 100))}%` }}
        />
      </span>
      <span className={["w-14 shrink-0 text-right font-display text-lg font-black tabular-nums", a.text].join(" ")}>
        {row.display}
      </span>
    </li>
  );
}

function PerfBoard({
  label,
  unit,
  accent,
  rows,
}: {
  label: string;
  unit: string;
  accent: string;
  rows: TeamPerfRow[];
}) {
  const a = ACCENT[accent];
  const max = rows.length ? rows[0].value : 1;
  return (
    <section className="rounded-2xl border border-line bg-card/40 p-4 sm:p-5">
      <header className="mb-1 flex items-baseline justify-between gap-2 border-b border-line/60 pb-3">
        <h3 className={["font-display text-base font-black uppercase tracking-tight", a.text].join(" ")}>
          {label}
        </h3>
        <span className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-ink/45">{unit}</span>
      </header>
      {rows.length === 0 ? (
        <p className="py-6 text-center font-mono text-[0.7rem] uppercase tracking-[0.12em] text-ink/40">
          No match stats counted yet
        </p>
      ) : (
        <ul className="divide-y divide-line/40">
          {rows.map((r, i) => (
            <PerfRow key={`${r.team}-${i}`} row={r} accent={accent} max={max} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The seven tournament leaderboards + the team completion/control boards + a
 * "Force update" button that recomputes them all from ESPN on demand (via
 * /api/stats). SSR renders the committed cron snapshot for SEO/first paint; the
 * button swaps in the as-of-now numbers.
 */
export function StatsBoards({ initial }: { initial: StatsFile }) {
  const [stats, setStats] = useState<StatsFile>(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [stale, setStale] = useState(false);

  const refresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const res = await fetch("/api/stats", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as StatsFile & { stale?: boolean };
        setStats({ meta: data.meta, categories: data.categories });
        setStale(Boolean(data.stale));
      }
    } catch {
      /* keep the current boards on a failed fetch */
    } finally {
      setRefreshing(false);
    }
  }, [refreshing]);

  const { meta, categories, teamStats } = stats;
  const [scorers, ...rest] = STAT_CATEGORIES;

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-2 font-mono text-[0.7rem] text-faint">
        <span className="rounded-full border border-line px-2.5 py-1">
          Updated {fmtMyt(meta.generatedAt)} MYT
        </span>
        <span className="rounded-full border border-line px-2.5 py-1">
          {meta.finished} matches counted
        </span>
        <ForceRefreshButton onRefresh={refresh} refreshing={refreshing} />
        {stale && (
          <span className="rounded-full border border-amber/40 px-2.5 py-1 text-amber">
            Feed busy — showing last snapshot
          </span>
        )}
      </div>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Board
          label={scorers.label}
          unit={scorers.unit}
          entity={scorers.entity}
          accent={scorers.accent}
          rows={categories[scorers.key]}
          featured
        />
        {rest.map((c) => (
          <Board
            key={c.key}
            label={c.label}
            unit={c.unit}
            entity={c.entity}
            accent={c.accent}
            rows={categories[c.key]}
          />
        ))}
      </div>

      {teamStats && (
        <>
          <div className="mt-16 border-t border-line/60 pt-8">
            <p className="mb-3 font-mono text-[0.72rem] uppercase tracking-[0.24em] text-acid">
              Team performance · completion & control
            </p>
            <h2 className="max-w-3xl font-display text-3xl font-black uppercase leading-[0.95] tracking-tight sm:text-4xl">
              Who keeps the ball — and finds the target.
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted sm:text-base">
              Pass, shot, tackle, cross and long-ball completion plus possession — every percentage
              aggregated across all of a side&apos;s finished matches, not a single-game flash. Top
              ten per board, highest first.
            </p>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {TEAM_PERF_CATEGORIES.map((c) => (
              <PerfBoard
                key={c.key}
                label={c.label}
                unit={c.unit}
                accent={c.accent}
                rows={teamStats[c.key] ?? []}
              />
            ))}
          </div>
        </>
      )}
    </>
  );
}
