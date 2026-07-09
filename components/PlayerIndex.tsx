"use client";

/* The tournament Player Index — the programme's master stat table. Every player
 * on every alive team in one sortable, filterable sheet: click a column to rank
 * the whole field by that stat, filter by team / position, or search a name.
 * This is the "sort by goals, assists…" surface the whole redesign turns on. */

import { useMemo, useState } from "react";
import type { PlayerStatLine, TeamPlayerSheet } from "@/lib/stats";
import {
  STAT_COLUMNS,
  ACCENT_TEXT,
  comparePlayers,
  type IndexPlayer,
} from "@/lib/playerColumns";

type Pos = "all" | "out" | "gk";
type SortKey = keyof PlayerStatLine;

function SortArrow({ dir }: { dir: "asc" | "desc" }) {
  return (
    <span aria-hidden className="ml-1 inline-block text-[0.8em] leading-none text-acid">
      {dir === "desc" ? "▾" : "▴"}
    </span>
  );
}

export function PlayerIndex({ teams }: { teams: TeamPlayerSheet[] }) {
  const all = useMemo<IndexPlayer[]>(
    () =>
      teams.flatMap((t) =>
        t.players.map((p) => ({ ...p, team: t.team, flag: t.flag })),
      ),
    [teams],
  );

  const [query, setQuery] = useState("");
  const [team, setTeam] = useState<string>("all");
  const [pos, setPos] = useState<Pos>("all");
  const [sortKey, setSortKey] = useState<SortKey>("goals");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = all.filter((p) => {
      if (team !== "all" && p.team !== team) return false;
      if (pos === "gk" && !p.gk) return false;
      if (pos === "out" && p.gk) return false;
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
    return filtered.sort((a, b) => comparePlayers(a, b, sortKey, dir));
  }, [all, query, team, pos, sortKey, dir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      // Cards read most naturally low-to-high context, but default every stat to
      // "best first" (desc) — the leader is what you scan for.
      setDir("desc");
    }
  };

  const teamNames = useMemo(
    () => Array.from(new Set(all.map((p) => p.team))).sort(),
    [all],
  );

  return (
    <div className="flex flex-col gap-4">
      {/* ── Filter + sort control bar ─────────────────────────────────────── */}
      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-card/40 p-3.5 sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {/* search */}
          <label className="relative flex-1">
            <span className="sr-only">Search player</span>
            <span
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint/60"
            >
              ⌕
            </span>
            <input
              type="search"
              inputMode="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search any player…"
              className="w-full rounded-xl border border-line bg-pitch/50 py-2.5 pl-9 pr-3 font-sans text-sm text-ink placeholder:text-faint/50 focus:border-acid/60 focus:outline-none"
            />
          </label>

          {/* team select */}
          <label className="relative shrink-0">
            <span className="sr-only">Filter by team</span>
            <select
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              className="w-full appearance-none rounded-xl border border-line bg-pitch/50 py-2.5 pl-3 pr-9 font-mono text-[0.78rem] uppercase tracking-wide text-ink focus:border-acid/60 focus:outline-none sm:w-auto"
            >
              <option value="all">All teams</option>
              {teamNames.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <span
              aria-hidden
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-faint/60"
            >
              ▾
            </span>
          </label>

          {/* position segmented toggle */}
          <div
            role="group"
            aria-label="Filter by position"
            className="inline-flex shrink-0 overflow-hidden rounded-xl border border-line"
          >
            {(
              [
                ["all", "All"],
                ["out", "Outfield"],
                ["gk", "Keepers"],
              ] as [Pos, string][]
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setPos(val)}
                aria-pressed={pos === val}
                className={[
                  "px-3 py-2.5 font-mono text-[0.72rem] uppercase tracking-wide transition-colors",
                  pos === val
                    ? "bg-acid text-on-acid"
                    : "bg-pitch/40 text-faint hover:text-ink",
                ].join(" ")}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* mobile-first sort select (mirrors the clickable headers) + count */}
        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 lg:hidden">
            <span className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-faint/70">
              Sort
            </span>
            <span className="relative">
              <select
                value={sortKey}
                onChange={(e) => {
                  setSortKey(e.target.value as SortKey);
                  setDir("desc");
                }}
                className="appearance-none rounded-lg border border-line bg-pitch/50 py-1.5 pl-2.5 pr-7 font-mono text-[0.74rem] uppercase tracking-wide text-ink focus:border-acid/60 focus:outline-none"
              >
                {STAT_COLUMNS.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.full}
                  </option>
                ))}
              </select>
              <span
                aria-hidden
                className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-faint/60"
              >
                ▾
              </span>
            </span>
            <button
              type="button"
              onClick={() => setDir((d) => (d === "desc" ? "asc" : "desc"))}
              className="rounded-lg border border-line px-2 py-1.5 font-mono text-[0.74rem] text-acid"
              aria-label={dir === "desc" ? "Sort ascending" : "Sort descending"}
            >
              {dir === "desc" ? "▾ High" : "▴ Low"}
            </button>
          </label>
          <span className="ml-auto font-mono text-[0.68rem] uppercase tracking-[0.12em] text-faint/70">
            {rows.length} {rows.length === 1 ? "player" : "players"}
          </span>
        </div>
      </div>

      {/* ── The table ─────────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl border border-line bg-card/40">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] border-collapse">
            <thead>
              <tr className="border-b-2 border-line/70">
                <th className="sticky left-0 z-10 bg-card px-3 py-2.5 text-left font-mono text-[0.58rem] uppercase tracking-[0.14em] text-faint/70">
                  <span className="inline-block w-6" />Player
                </th>
                {STAT_COLUMNS.map((c) => {
                  const active = c.key === sortKey;
                  return (
                    <th
                      key={c.key}
                      className="px-1 py-2 text-center"
                      aria-sort={active ? (dir === "desc" ? "descending" : "ascending") : "none"}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(c.key as SortKey)}
                        title={`Sort by ${c.full}`}
                        className={[
                          "inline-flex items-center rounded-md px-1.5 py-1 font-mono text-[0.62rem] uppercase tracking-[0.08em] transition-colors hover:text-acid",
                          active ? "text-acid" : "text-faint/70",
                        ].join(" ")}
                      >
                        {c.short}
                        {active && <SortArrow dir={dir} />}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={STAT_COLUMNS.length + 1}
                    className="px-4 py-10 text-center font-mono text-[0.72rem] uppercase tracking-[0.12em] text-faint/60"
                  >
                    No players match — clear a filter
                  </td>
                </tr>
              ) : (
                rows.map((p, i) => {
                  const pk = p.penScored + p.penMissed;
                  return (
                    <tr
                      key={`${p.team}-${p.name}-${i}`}
                      className="[&:not(:last-child)]:border-b [&:not(:last-child)]:border-line/40 hover:bg-pitch/30"
                    >
                      <td className="sticky left-0 z-10 bg-card px-3 py-2.5">
                        <span className="flex items-center gap-2.5">
                          <span className="w-6 shrink-0 text-right font-mono text-[0.72rem] tabular-nums text-faint/60">
                            {i + 1}
                          </span>
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate font-display text-[0.9rem] font-bold uppercase tracking-tight text-ink">
                                {p.name}
                              </span>
                              {p.gk && (
                                <span className="shrink-0 rounded bg-line/60 px-1 py-px font-mono text-[0.5rem] font-bold uppercase tracking-wider text-ink/70">
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
                            <span className="mt-0.5 flex items-center gap-1.5 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-faint/70">
                              <span className="text-sm leading-none">{p.flag}</span>
                              {p.team}
                            </span>
                          </span>
                        </span>
                      </td>
                      {STAT_COLUMNS.map((c) => {
                        const v = p[c.key] as number;
                        const blank = c.gkOnly && !p.gk;
                        const active = c.key === sortKey;
                        const zero = v === 0;
                        const tint =
                          c.accent && !zero && !blank ? ACCENT_TEXT[c.accent] : "";
                        return (
                          <td
                            key={c.key}
                            className={[
                              "px-1 py-2.5 text-center font-mono text-[0.82rem] tabular-nums",
                              active ? "bg-acid/[0.06]" : "",
                              blank || zero ? "text-faint/30" : tint || "text-ink",
                              tint ? "font-bold" : "",
                            ].join(" ")}
                          >
                            {blank ? "·" : v}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
