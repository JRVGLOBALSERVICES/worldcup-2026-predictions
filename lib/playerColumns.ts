import type { PlayerStatLine } from "@/lib/stats";

// A player row carrying its team + flag, for the combined tournament index.
export type IndexPlayer = PlayerStatLine & { team: string; flag: string };

// Sortable stat columns shared by the per-team sheets and the combined index.
// `key` matches the numeric field on PlayerStatLine; `short` heads the compact
// table column, `full` is the plain-English term (tooltip + sort-menu label),
// `accent` tints the money columns (goals/assists/cards) so a scan finds them.
export type StatColumn = {
  key: keyof PlayerStatLine;
  short: string;
  full: string;
  accent?: "acid" | "mint" | "amber" | "rose";
  gkOnly?: boolean;
};

export const STAT_COLUMNS: StatColumn[] = [
  { key: "apps", short: "Apps", full: "Appearances" },
  { key: "goals", short: "Goals", full: "Goals", accent: "acid" },
  { key: "assists", short: "Assists", full: "Assists", accent: "mint" },
  { key: "shots", short: "Shots", full: "Shots taken" },
  { key: "sot", short: "SOT", full: "Shots on target", accent: "acid" },
  { key: "tackles", short: "Tackles", full: "Tackles" },
  { key: "blocks", short: "Blocks", full: "Blocks" },
  { key: "passes", short: "Passes", full: "Passes completed" },
  { key: "saves", short: "Saves", full: "Keeper saves", gkOnly: true },
  { key: "yellow", short: "Yellow", full: "Yellow cards", accent: "amber" },
  { key: "red", short: "Red", full: "Red cards", accent: "rose" },
];

export const ACCENT_TEXT: Record<NonNullable<StatColumn["accent"]>, string> = {
  acid: "text-acid",
  mint: "text-mint",
  amber: "text-amber",
  rose: "text-rose",
};

// Compare two players on a stat, descending by default. Ties fall back to
// goals → assists → apps → name so the order is always stable + sensible.
export function comparePlayers<T extends PlayerStatLine>(
  a: T,
  b: T,
  key: keyof PlayerStatLine,
  dir: "asc" | "desc",
): number {
  const av = a[key];
  const bv = b[key];
  let d = 0;
  if (typeof av === "number" && typeof bv === "number") d = av - bv;
  else d = String(av).localeCompare(String(bv));
  if (d === 0 && key !== "goals") d = a.goals - b.goals;
  if (d === 0 && key !== "assists") d = a.assists - b.assists;
  if (d === 0 && key !== "apps") d = a.apps - b.apps;
  if (d === 0) d = b.name.localeCompare(a.name);
  return dir === "desc" ? -d : d;
}
