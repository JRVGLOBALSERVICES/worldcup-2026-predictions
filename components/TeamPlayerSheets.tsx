import type { PlayerStatLine, TeamPlayerSheet } from "@/lib/stats";

/**
 * Per-team squad stat sheets — the hero of the /stats page. One card per alive
 * team, each a compact table of every player's counting stats compiled across
 * all games played. The stat grid scrolls horizontally on a phone (the player
 * column stays pinned) so the full line is always reachable without truncation.
 */

// Column defs — key on the player line, short header, accent, and a title for
// the hover tooltip. `gkOnly` columns (saves) render muted for outfielders.
const COLS: {
  key: keyof PlayerStatLine;
  head: string;
  title: string;
  accent?: string;
}[] = [
  { key: "apps", head: "Ap", title: "Appearances (games played)" },
  { key: "goals", head: "G", title: "Goals", accent: "text-acid" },
  { key: "assists", head: "A", title: "Assists", accent: "text-mint" },
  { key: "tackles", head: "Tk", title: "Tackles" },
  { key: "blocks", head: "Bk", title: "Blocks" },
  { key: "passes", head: "Pass", title: "Passes played" },
  { key: "saves", head: "Sv", title: "Keeper saves" },
  { key: "yellow", head: "Y", title: "Yellow cards", accent: "text-amber" },
  { key: "red", head: "R", title: "Red cards", accent: "text-rose" },
];

const slug = (team: string) => team.toLowerCase().replace(/[^a-z]/g, "");

function StatCell({ player, col }: { player: PlayerStatLine; col: (typeof COLS)[number] }) {
  const v = player[col.key] as number;
  // Saves only mean anything for keepers; blank the column for everyone else so
  // the table doesn't read as "every outfielder made 0 saves".
  const blank = col.key === "saves" && !player.gk;
  const zero = v === 0;
  return (
    <td
      className={[
        "px-1.5 py-2 text-center font-mono text-[0.78rem] tabular-nums",
        blank || zero ? "text-ink/25" : col.accent ?? "text-ink",
        col.accent && !zero ? "font-bold" : "",
      ].join(" ")}
    >
      {blank ? "·" : v}
    </td>
  );
}

function TeamCard({ sheet }: { sheet: TeamPlayerSheet }) {
  const apps = sheet.players.reduce((n, p) => Math.max(n, p.apps), 0);
  return (
    <section
      id={`team-${slug(sheet.team)}`}
      className="scroll-mt-24 overflow-hidden rounded-2xl border border-line bg-card/40"
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

      {/* Horizontal scroll on narrow screens; the player name column is pinned. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] border-collapse">
          <thead>
            <tr className="border-b border-line/60">
              <th className="sticky left-0 z-10 bg-card/95 px-4 py-2 text-left font-mono text-[0.58rem] uppercase tracking-[0.14em] text-ink/45 backdrop-blur">
                Player
              </th>
              {COLS.map((c) => (
                <th
                  key={c.key}
                  title={c.title}
                  className="px-1.5 py-2 text-center font-mono text-[0.58rem] uppercase tracking-[0.1em] text-ink/45"
                >
                  {c.head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.players.map((p, i) => {
              const pk = p.penScored + p.penMissed;
              return (
                <tr
                  key={`${p.name}-${i}`}
                  className="[&:not(:last-child)]:border-b [&:not(:last-child)]:border-line/40"
                >
                  <td className="sticky left-0 z-10 bg-card/95 px-4 py-2 backdrop-blur">
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
                  {COLS.map((c) => (
                    <StatCell key={c.key} player={p} col={c} />
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
  if (!teams || teams.length === 0) {
    return (
      <p className="rounded-2xl border border-line bg-card/40 p-6 text-center font-mono text-[0.7rem] uppercase tracking-[0.12em] text-ink/40">
        No player stats counted yet — the sheets fill as matches finish
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {/* Jump chips — quick anchor nav across the alive teams. */}
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

      <div className="grid gap-4 lg:grid-cols-2">
        {teams.map((t) => (
          <TeamCard key={t.team} sheet={t} />
        ))}
      </div>
    </div>
  );
}
