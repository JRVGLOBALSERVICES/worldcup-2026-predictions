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
  | "penaltyMissed"
  | "tackles"
  | "blocks"
  | "gkSaves";

// One team row on a completion/accuracy board. `value` is the numeric % (for
// sort + the share bar), `display` is the formatted "87.4%", `matches` is how
// many finished games fed the aggregate.
export type TeamPerfRow = {
  rank: number;
  team: string;
  flag: string;
  value: number;
  display: string;
  matches: number;
};

export type TeamPerfKey =
  | "passCompletion"
  | "possession"
  | "shotAccuracy"
  | "tackleSuccess"
  | "crossCompletion"
  | "longBallAccuracy";

// One player line on a per-team mini-board (no rank/flag — the team owns those).
export type TeamStatLeader = { name: string; value: number; matches?: number };

// A single player's full stat line, compiled across every game they've played
// so far. Counting stats only (no derived %); `apps` is games featured in.
// `gk` flags a keeper so the table can surface saves prominently for them.
export type PlayerStatLine = {
  name: string;
  apps: number;
  goals: number;
  assists: number;
  tackles: number;
  blocks: number;
  passes: number;
  saves: number;
  yellow: number;
  red: number;
  penScored: number;
  penMissed: number;
  gk: boolean;
};

// One alive team's full squad with per-player stat lines. Teams sorted
// alphabetically; players sorted by goals → assists → apps within the team.
export type TeamPlayerSheet = {
  team: string;
  flag: string;
  players: PlayerStatLine[];
};

// A single team's current top-5 boards, for the match prediction pages.
export type TeamStatBoards = {
  team: string;
  flag: string;
  scorers: TeamStatLeader[];
  assists: TeamStatLeader[];
  yellowCards: TeamStatLeader[];
  redCards: TeamStatLeader[];
};

export type StatsFile = {
  meta: { generatedAt: string; source: string; finished: number };
  categories: Record<StatCategoryKey, StatRow[]>;
  // The completion / control boards (pass %, possession, shot/tackle/cross/
  // long-ball accuracy), aggregated per team across every finished match.
  // Optional so an older stats.json snapshot without the block still type-checks.
  teamStats?: Record<TeamPerfKey, TeamPerfRow[]>;
  // Keyed on the normalised team name (see teamKey below). Optional so an older
  // stats.json snapshot without the block still type-checks.
  byTeam?: Record<string, TeamStatBoards>;
  // Per-team squad stat sheets — every player on every alive team with their
  // full counting-stat line compiled across all games played. The hero of the
  // /stats page. Optional so an older snapshot without it still type-checks.
  playersByTeam?: TeamPlayerSheet[];
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
  // Per-player Opta counts off ESPN's core API (tackles/blocks) + the summary
  // team-sheet saves stat — see build-stats.mjs Pass 4.
  { key: "tackles", label: "Tackles", unit: "tackles made", entity: "player", accent: "mint" },
  { key: "blocks", label: "Blocks", unit: "shots blocked", entity: "player", accent: "amber" },
  { key: "gkSaves", label: "Keeper Saves", unit: "saves", entity: "player", accent: "acid" },
];

// Display order + copy for the completion / control boards. Every value is a
// percentage where higher = sharper; `passCompletion` is featured (full width).
export const TEAM_PERF_CATEGORIES: {
  key: TeamPerfKey;
  label: string;
  unit: string;
  accent: "acid" | "mint" | "amber" | "rose";
}[] = [
  { key: "passCompletion", label: "Pass Completion", unit: "of passes found a teammate", accent: "acid" },
  { key: "possession", label: "Possession", unit: "average share of the ball", accent: "mint" },
  { key: "shotAccuracy", label: "Shot Accuracy", unit: "of shots on target", accent: "amber" },
  { key: "tackleSuccess", label: "Tackle Success", unit: "of tackles won the ball", accent: "acid" },
  { key: "crossCompletion", label: "Cross Completion", unit: "of crosses picked out a man", accent: "mint" },
  { key: "longBallAccuracy", label: "Long-Ball Accuracy", unit: "of long balls reached a teammate", accent: "rose" },
];

export function getStats(): StatsFile {
  return statsFile;
}

// Mirror of build-stats.mjs ALIAS/norm — turns a fixture team name into the
// key build-stats.mjs used for the byTeam block. Keep in sync with that script
// (and lib/live.ts). Without the alias map, ESPN-spelling teams like "Czechia"
// or "Türkiye" wouldn't line up with our canonical fixtures spelling.
const ALIAS: Record<string, string> = {
  congodr: "drcongo",
  drc: "drcongo",
  korearepublic: "southkorea",
  iranislamicrepublic: "iran",
  iriran: "iran",
  turkiye: "turkey",
  trkiye: "turkey",
  unitedstates: "usa",
  unitedstatesofamerica: "usa",
  czechia: "czechrepublic",
  capeverde: "caboverde",
  cotedivoire: "ivorycoast",
  bosniaherzegovina: "bosnia",
  curaao: "curacao",
};
const teamKey = (s: string): string => {
  const a = s.toLowerCase().replace(/[^a-z]/g, "");
  return ALIAS[a] ?? a;
};

/** Current top-5 scorers / assisters / yellows / reds for one team, or undefined. */
export function getTeamStats(teamName: string): TeamStatBoards | undefined {
  return statsFile.byTeam?.[teamKey(teamName)];
}
