import type { Fixture } from "@/lib/types";
import { getTeamStats, type TeamStatBoards, type TeamStatLeader } from "@/lib/stats";
import { SectionLabel, Legend } from "./atoms";

// Accent → static class strings (no dynamic concatenation, so Tailwind keeps
// them). Mirrors components/StatsBoards.tsx so the per-team boards read as the
// same family as the tournament leaderboards.
const ACCENT = {
  acid: { text: "text-acid", chip: "bg-acid text-on-acid", bar: "bg-acid" },
  mint: { text: "text-mint", chip: "bg-mint text-pitch", bar: "bg-mint" },
  amber: { text: "text-amber", chip: "bg-amber text-pitch", bar: "bg-amber" },
  rose: { text: "text-rose", chip: "bg-rose text-ink", bar: "bg-rose" },
} as const;

type AccentKey = keyof typeof ACCENT;

const BOARDS: { key: keyof TeamStatBoards; label: string; unit: string; accent: AccentKey }[] = [
  { key: "scorers", label: "Top scorers", unit: "goals", accent: "acid" },
  { key: "assists", label: "Top assists", unit: "assists", accent: "mint" },
  { key: "yellowCards", label: "Yellow cards", unit: "yellows", accent: "amber" },
  { key: "redCards", label: "Red cards", unit: "reds", accent: "rose" },
];

/**
 * Each side's current tournament-to-date top 5 — scorers, assisters, yellows,
 * reds — for a fixture. Snapshotted from ESPN into data/stats.json (byTeam) by
 * scripts/build-stats.mjs, so it grows match by match. Renders nothing until at
 * least one side has a tally, so an all-zero early fixture degrades cleanly.
 */
export function MatchTeamStats({ fixture }: { fixture: Fixture }) {
  const home = getTeamStats(fixture.home.name);
  const away = getTeamStats(fixture.away.name);
  const any = (t?: TeamStatBoards) =>
    t && BOARDS.some((b) => (t[b.key] as TeamStatLeader[]).length > 0);
  if (!any(home) && !any(away)) return null;

  return (
    <section className="mt-10 space-y-5 border-t border-line pt-8">
      <div>
        <SectionLabel>Team leaders</SectionLabel>
        <p className="mt-1 text-[0.8rem] leading-relaxed text-ink/60">
          Each side&rsquo;s top 5 this tournament — top scorers, assists and cards.
        </p>
        <Legend
          items={[
            { swatch: "acid", term: "Goals" },
            { swatch: "mint", term: "Assists" },
            { swatch: "amber", term: "Yellow cards" },
            { swatch: "rose", term: "Red cards" },
          ]}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <TeamColumn team={fixture.home} stats={home} />
        <TeamColumn team={fixture.away} stats={away} />
      </div>
    </section>
  );
}

function TeamColumn({
  team,
  stats,
}: {
  team: { name: string; flag: string };
  stats?: TeamStatBoards;
}) {
  return (
    <div className="rounded-2xl border border-line bg-card/50 p-4 sm:p-5">
      <div className="mb-4 flex items-center gap-2 border-b border-line/60 pb-3">
        <span className="text-lg leading-none">{team.flag}</span>
        <span className="font-display text-sm font-bold uppercase tracking-wide text-ink">
          {team.name}
        </span>
      </div>

      <div className="space-y-4">
        {BOARDS.map((b) => (
          <Board
            key={b.key}
            label={b.label}
            unit={b.unit}
            accent={b.accent}
            rows={(stats?.[b.key] as TeamStatLeader[]) ?? []}
          />
        ))}
      </div>
    </div>
  );
}

function Board({
  label,
  unit,
  accent,
  rows,
}: {
  label: string;
  unit: string;
  accent: AccentKey;
  rows: TeamStatLeader[];
}) {
  const a = ACCENT[accent];
  const max = rows.length ? rows[0].value : 1;
  return (
    <div>
      <header className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h3 className={["font-display text-[0.8rem] font-black uppercase tracking-tight", a.text].join(" ")}>
          {label}
        </h3>
        <span className="font-mono text-[0.7rem] normal-case tracking-normal text-ink/55">— {unit}</span>
      </header>
      {rows.length === 0 ? (
        <p className="py-1.5 font-mono text-[0.64rem] uppercase tracking-[0.12em] text-ink/40">
          None yet
        </p>
      ) : (
        <ul className="divide-y divide-line/40">
          {rows.map((r, i) => (
            <Row key={`${r.name}-${i}`} rank={i + 1} row={r} accent={accent} max={max} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({
  rank,
  row,
  accent,
  max,
}: {
  rank: number;
  row: TeamStatLeader;
  accent: AccentKey;
  max: number;
}) {
  const a = ACCENT[accent];
  const lead = rank === 1;
  return (
    <li className="flex items-center gap-2.5 py-1.5">
      <span
        className={[
          "grid size-5 shrink-0 place-items-center rounded font-mono text-[0.62rem] font-bold tabular-nums",
          lead ? a.chip : "border border-line text-ink/55",
        ].join(" ")}
      >
        {rank}
      </span>
      <span className="min-w-0 flex-1 truncate text-[0.82rem] font-semibold text-ink">
        {row.name}
        {row.matches != null ? (
          <span
            className="ml-1.5 font-mono text-[0.7rem] normal-case tracking-normal text-ink/55"
            title={`${row.matches} appearances this tournament`}
          >
            {row.matches} {row.matches === 1 ? "app" : "apps"}
          </span>
        ) : null}
      </span>
      {/* tiny share-of-leader bar — same visual race read as the global boards */}
      <span className="hidden h-1 w-10 overflow-hidden rounded-full bg-line/50 sm:block">
        <span
          className={["block h-full rounded-full", a.bar].join(" ")}
          style={{ width: `${Math.max(8, Math.round((row.value / max) * 100))}%` }}
        />
      </span>
      <span className={["w-5 shrink-0 text-right font-display text-base font-black tabular-nums", a.text].join(" ")}>
        {row.value}
      </span>
    </li>
  );
}
