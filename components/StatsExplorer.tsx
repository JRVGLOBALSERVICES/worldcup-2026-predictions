"use client";

import { useCallback, useState } from "react";
import { ForceRefreshButton } from "./RefreshCountdown";
import { StatLeaderboards } from "./StatLeaderboards";
import { TeamPlayerSheets } from "./TeamPlayerSheets";
import {
  TEAM_PERF_CATEGORIES,
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

function SectionHead({ kicker, title, sub }: { kicker: string; title: string; sub: string }) {
  return (
    <div className="mb-6">
      <p className="mb-2 font-mono text-[0.66rem] uppercase tracking-[0.24em] text-acid">{kicker}</p>
      <h2 className="max-w-3xl font-display text-2xl font-black uppercase leading-[0.98] tracking-tight sm:text-3xl">
        {title}
      </h2>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">{sub}</p>
    </div>
  );
}

/**
 * The whole Stats page body: per-team player stat sheets (the hero), the
 * tournament leaderboards, and the team completion/control boards — all fed
 * from one StatsFile and all refreshable together via the "Force update"
 * button, which recomputes everything from ESPN as-of-now (via /api/stats).
 * SSR renders the committed cron snapshot for SEO/first paint.
 */
export function StatsExplorer({ initial }: { initial: StatsFile }) {
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
        // Keep the whole file — dropping teamStats/playersByTeam here would blank
        // those sections after a refresh.
        setStats(data);
        setStale(Boolean(data.stale));
      }
    } catch {
      /* keep the current boards on a failed fetch */
    } finally {
      setRefreshing(false);
    }
  }, [refreshing]);

  const { meta, categories, teamStats, playersByTeam } = stats;

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

      {/* ── Hero: per-team squad stat sheets ─────────────────────────────── */}
      <section className="mt-10">
        <SectionHead
          kicker="World Cup 2026 · squad sheets"
          title="Every player. Every number."
          sub="One table per team still in the competition — goals, assists, tackles, blocks, passes, keeper saves and cards, compiled across every game each player has featured in. A knocked-out side drops off entirely."
        />
        <TeamPlayerSheets teams={playersByTeam ?? []} />
      </section>

      {/* ── Tournament leaderboards ──────────────────────────────────────── */}
      <section className="mt-16 border-t border-line/60 pt-10">
        <SectionHead
          kicker="World Cup 2026 · tournament leaders"
          title="The race for the Golden Boot."
          sub="Top scorers, assists, clean sheets, the cards table, penalties scored vs missed, tackles, blocks and keeper saves — ranked top ten among the sides still alive."
        />
        <StatLeaderboards categories={categories} />
      </section>

      {/* ── Team completion / control boards ─────────────────────────────── */}
      <section className="mt-16 border-t border-line/60 pt-10">
        <SectionHead
          kicker="World Cup 2026 · completion & control"
          title="Who keeps the ball — and finds the target."
          sub="Pass completion, possession, shot accuracy, tackle success, cross and long-ball accuracy — true aggregates across every finished match, not an average of per-game rates."
        />
        {teamStats ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {TEAM_PERF_CATEGORIES.map((c) => (
              <PerfBoard key={c.key} label={c.label} unit={c.unit} accent={c.accent} rows={teamStats[c.key] ?? []} />
            ))}
          </div>
        ) : (
          <p className="rounded-2xl border border-line bg-card/40 p-6 text-center font-mono text-[0.7rem] uppercase tracking-[0.12em] text-ink/40">
            No completion stats counted yet — boards fill as matches finish
          </p>
        )}
      </section>
    </>
  );
}
