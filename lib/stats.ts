import statsJson from "@/data/stats.json";

// One leaderboard row. `name` is absent on team-only boards (clean sheets);
// `matches` (appearances) only rides the scorer/assist boards from ESPN's
// season statistics. `flag` is the emoji resolved from our fixtures list.
export type StatRow = {
  rank: number;
  name?: string;
  team: string;
  flag: string;
  value: number;
  matches?: number;
};

export type StatCategoryKey =
  | "scorers"
  | "assists"
  | "cleanSheets"
  | "yellowCards"
  | "redCards"
  | "penaltyScored"
  | "penaltyMissed";

export type StatsFile = {
  meta: { generatedAt: string; source: string; finished: number };
  categories: Record<StatCategoryKey, StatRow[]>;
};

// `cache` (penalty-miss plumbing for the builder) is intentionally not typed —
// the page never reads it.
export const statsFile = statsJson as unknown as StatsFile;

// Display order + copy for the seven boards. `entity` drives the column header
// (a player board shows the player; clean sheets is a team board).
export const STAT_CATEGORIES: {
  key: StatCategoryKey;
  label: string;
  unit: string;
  entity: "player" | "team";
  accent: "acid" | "mint" | "amber" | "rose";
}[] = [
  { key: "scorers", label: "Top Scorers", unit: "goals", entity: "player", accent: "acid" },
  { key: "assists", label: "Assists", unit: "assists", entity: "player", accent: "mint" },
  { key: "cleanSheets", label: "Clean Sheets", unit: "clean sheets", entity: "team", accent: "mint" },
  { key: "yellowCards", label: "Yellow Cards", unit: "yellows", entity: "player", accent: "amber" },
  { key: "redCards", label: "Red Cards", unit: "reds", entity: "player", accent: "rose" },
  { key: "penaltyScored", label: "Penalties Scored", unit: "scored", entity: "player", accent: "acid" },
  { key: "penaltyMissed", label: "Penalties Missed", unit: "missed", entity: "player", accent: "rose" },
];

export function getStats(): StatsFile {
  return statsFile;
}
