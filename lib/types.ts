export type Team = { name: string; flag: string };

export type Fixture = {
  id: string;
  group: string;
  home: Team;
  away: Team;
  venue: string;
  city: string;
  kickoffUTC: string;
  etLabel: string;
};

// `strength` is the 1–5 conviction rating Rj reads instead of odds. It is
// optional on the data: where a prediction doesn't carry an explicit value we
// derive it from `fairOdds` (see strengthFromOdds in lib/data.ts), so odds stay
// the internal signal and the UI only ever shows 1–5.
export type Pick = { player: string; fairOdds: string; banker: boolean; note: string; strength?: number };

export type Prediction = {
  win: { pick: string; fairOdds: string; reason: string; strength?: number };
  halfTime: { score: string; fairOdds: string; alt: string; altOdds: string; strength?: number };
  htft: { pick: string; fairOdds: string; strength?: number };
  fullTime: { score: string; fairOdds: string; strength?: number };
  scorers: Pick[];
  assists: Pick[];
  penalty: { likelihood: string; taker: string; backup: string; note: string };
  lineups: { home: string; away: string; status: "confirmed" | "probable" | "unconfirmed" };
  playerNotes: { player: string; team: string; note: string }[];
  confidence: "high" | "medium" | "low";
  /** Overall 1–5 conviction in the headline call. Optional; derived from the win pick when absent. */
  strength?: number;
  sources: string[];
};

export type PredictionFile = {
  meta: { generatedAt: string; disclaimer: string; method: string };
  predictions: Record<string, Prediction>;
};

// ── Research bundle (data/research.json, built by scripts/build-research.mjs) ──
export type FormGame = {
  result: "W" | "D" | "L";
  score: string;
  opponent: string;
  homeAway?: "home" | "away";
  date: string;
  comp?: string | null;
};

export type TeamForm = {
  line: string; // e.g. "WDWWL" newest-first
  record: { w: number; d: number; l: number };
  games: FormGame[];
};

export type Research = {
  fixtureId: string;
  eventId?: string;
  teamIds?: { home?: string; away?: string };
  form?: { home: TeamForm; away: TeamForm };
  headToHead?: { date: string; score: string; result: string }[];
  leaders?: { home: Record<string, string>; away: Record<string, string> };
  cards?: { minute?: string; type?: string; player?: string }[];
  lineupStatus?: string;
  error?: string;
};

export type ResearchFile = {
  generatedAt: string;
  research: Record<string, Research>;
};
