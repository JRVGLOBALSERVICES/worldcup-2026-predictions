"use client";

import { useMemo, useState } from "react";
import type { PlayerStatLine, TeamPlayerSheet } from "@/lib/stats";
import { STAT_COLUMNS, ACCENT_TEXT, comparePlayers } from "@/lib/playerColumns";

/**
 * Per-team squad stat sheets — one card per alive team, each a compact table of
 * every player's counting stats across all games played. Column headers are
 * sortable: click a stat to re-rank every squad by it at once (a programme-style
 * "sort all squads by goals" control). The player column stays pinned while the
 * stat grid scrolls horizontally on a phone, so the full line is always reachable.
 */

type SortKey = keyof PlayerStatLine;

const slug = (team: string) => team.toLowerCase().replace(/[^a-z]/g, "");

function StatCell({
  player,
  col,
  active,
}: {
  player: PlayerStatLine;
  col: (typeof STAT_COLUMNS)[number];
  active: boolean;
}) {
  const v = player[col.key] as number;
  const blank = col.gkOnly && !player.gk;
  const zero = v === 0;
  const tint = col.accent && !zero && !blank ? ACCENT_TEXT[col.accent] : "";
  return (
    <td
      className={[
        "px-1.5 py-2 text-center font-mono text-[0.78rem] tabular-nums",
        active ? "bg-acid/[0.06]" : "",
        blank || zero ? "text-ink/25" : tint || "text-ink",
        tint ? "font-bold" : "",
      ].join(" ")}
    >
      {blank ? "·" : v}
    </td>
  );
}

function TeamCard({
  sheet,
  sortKey,
  dir,
  onSort,
}: {
  sheet: TeamPlayerSheet;
  sortKey: SortKey;
  dir: "asc" | "desc";
  onSort: (k: SortKey) => void;
}) {
  const apps = sheet.players.reduce((n, p) => Math.max(n, p.apps), 0);
  const players = useMemo(
    () => [...sheet.players].sort((a, b) => comparePlayers(a, b, sortKey, dir)),
    [sheet.players, sortKey, dir],
  );
  return (
    <section
      id={`team-${slug(sheet.team)}`}
      className="cv-card surface scroll-mt-24 overflow-hidden rounded-2xl border border-line"
    >
      <header className="flex items-center justify-between gap-2 border-b border-line/70 bg-pitch/30 px-4 py-3">
        <h3 className="flex items-center gap-2.5">
          <span className="text-lg leading-none">{sheet.flag}</span>
          <span className="font-display text-base font-black uppercase tracking-tight text-ink">
            {sheet.team}
          </span>
        </h3>
        <span className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-ink/45">
          {sheet.players.length} players · {apps} {apps === 1 ? "match" : "matches"}
        </span>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] border-collapse">
          <thead>
            <tr className="border-b border-line/60">
              <th className="sticky left-0 z-10 bg-card px-4 py-2 text-left font-mono text-[0.58rem] uppercase tracking-[0.14em] text-ink/45">
                Player
              </th>
              {STAT_COLUMNS.map((c) => {
                const active = c.key === sortKey;
                return (
                  <th
                    key={c.key}
                    className="px-0.5 py-1.5 text-center"
                    aria-sort={active ? (dir === "desc" ? "descending" : "ascending") : "none"}
                  >
                    <button
                      type="button"
                      onClick={() => onSort(c.key)}
                      title={`Sort every squad by ${c.full}`}
                      className={[
                        "inline-flex items-center rounded px-1 py-1 font-mono text-[0.56rem] uppercase tracking-[0.08em] transition-colors hover:text-acid",
                        active ? "text-acid" : "text-ink/45",
                      ].join(" ")}
                    >
                      {c.short}
                      {active && (
                        <span aria-hidden className="ml-0.5 text-[0.9em] leading-none text-acid">
                          {dir === "desc" ? "▾" : "▴"}
                        </span>
                      )}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {players.map((p, i) => {
              const pk = p.penScored + p.penMissed;
              return (
                <tr
                  key={`${p.name}-${i}`}
                  className="[&:not(:last-child)]:border-b [&:not(:last-child)]:border-line/40"
                >
                  <td className="sticky left-0 z-10 bg-card px-4 py-2">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-display text-[0.86rem] font-bold uppercase tracking-tight text-ink">
                        {p.name}
                      </span>
                      {p.gk && (
                        <span className="shrink-0 rounded bg-line/60 px-1 py-px font-mono text-[0.5rem] font-bold uppercase tracking-wider text-ink/60">
                          GK
                        </span>
                      )}
                      {pk > 0 && (
                        <span
                          title={`Penalties: ${p.penScored} scored, ${p.penMissed} missed`}
                          className="shrink-0 rounded bg-acid/15 px-1 py-px font-mono text-[0.5rem] font-bold uppercase tracking-wider text-acid"
                        >
                          PK {p.penScored}
                          {p.penMissed > 0 ? `/${p.penMissed}✕` : ""}
                        </span>
                      )}
                    </span>
                  </td>
                  {STAT_COLUMNS.map((c) => (
                    <StatCell key={c.key} player={p} col={c} active={c.key === sortKey} />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function TeamPlayerSheets({ teams }: { teams: TeamPlayerSheet[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("goals");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const onSort = (k: SortKey) => {
    if (k === sortKey) setDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortKey(k);
      setDir("desc");
    }
  };

  if (!teams || teams.length === 0) {
    return (
      <p className="rounded-2xl border border-line bg-card/40 p-6 text-center font-mono text-[0.7rem] uppercase tracking-[0.12em] text-ink/40">
        No player stats counted yet — the sheets fill as matches finish
      </p>
    );
  }

  const activeCol = STAT_COLUMNS.find((c) => c.key === sortKey);

  return (
    <div className="flex flex-col gap-6">
      {/* Jump chips + the shared sort read-out. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav className="flex flex-wrap gap-1.5">
          {teams.map((t) => (
            <a
              key={t.team}
              href={`#team-${slug(t.team)}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 font-mono text-[0.62rem] uppercase tracking-[0.1em] text-faint transition-colors hover:border-acid/50 hover:text-ink"
            >
              <span className="text-sm leading-none">{t.flag}</span>
              {t.team}
            </a>
          ))}
        </nav>
        <span className="shrink-0 font-mono text-[0.62rem] uppercase tracking-[0.12em] text-faint/70">
          Sorted by{" "}
          <span className="text-acid">{activeCol?.full ?? "Goals"}</span>{" "}
          {dir === "desc" ? "high→low" : "low→high"}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {teams.map((t) => (
          <TeamCard key={t.team} sheet={t} sortKey={sortKey} dir={dir} onSort={onSort} />
        ))}
      </div>
    </div>
  );
}
