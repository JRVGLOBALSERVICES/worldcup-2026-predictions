import type { Metadata } from "next";
import { SiteNav } from "@/components/SiteNav";
import { getStats, STAT_CATEGORIES, type StatRow } from "@/lib/stats";

// Snapshotted from ESPN by scripts/build-stats.mjs and committed; re-read the
// file every 30 min on Vercel so a fresh push surfaces without a full redeploy.
export const revalidate = 1800;

export const metadata: Metadata = {
  title: "Tournament Stats — World Cup 2026 Leaders",
  description:
    "Live World Cup 2026 leaderboards in Malaysia time — top scorers, assists, clean sheets, yellow & red cards, and penalties scored vs missed. Pulled from the official match feed.",
};

// Accent → static class strings (no dynamic concatenation, so Tailwind keeps them).
const ACCENT: Record<string, { text: string; chip: string; bar: string }> = {
  acid: { text: "text-acid", chip: "bg-acid text-on-acid", bar: "bg-acid" },
  mint: { text: "text-mint", chip: "bg-mint text-pitch", bar: "bg-mint" },
  amber: { text: "text-amber", chip: "bg-amber text-pitch", bar: "bg-amber" },
  rose: { text: "text-rose", chip: "bg-rose text-ink", bar: "bg-rose" },
};

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

export default function StatsPage() {
  const { meta, categories } = getStats();
  const updated = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(meta.generatedAt));

  const [scorers, ...rest] = STAT_CATEGORIES;

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
        <SiteNav active="stats" />
      </header>

      <section className="stripes overflow-hidden rounded-3xl border border-line bg-pitch-2/60 p-6 sm:p-10">
        <p className="mb-4 font-mono text-[0.72rem] uppercase tracking-[0.24em] text-acid">
          World Cup 2026 · tournament leaders
        </p>
        <h1 className="max-w-3xl font-display text-4xl font-black uppercase leading-[0.95] tracking-tight sm:text-6xl">
          The race for the Golden Boot.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
          Top scorers, assists, clean sheets, the cards table and penalties scored vs missed —
          every board pulled straight from the official match feed and ranked top ten, in Malaysia
          time.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-2 font-mono text-[0.7rem] text-faint">
          <span className="rounded-full border border-line px-2.5 py-1">Updated {updated} MYT</span>
          <span className="rounded-full border border-line px-2.5 py-1">
            {meta.finished} matches counted
          </span>
        </div>
      </section>

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

      <p className="mt-10 font-mono text-[0.62rem] uppercase leading-relaxed tracking-[0.1em] text-ink/35">
        Source: {meta.source}. Clean sheets credited to the team that kept the opponent scoreless.
        Boards refresh as results come in.
      </p>
    </main>
  );
}
