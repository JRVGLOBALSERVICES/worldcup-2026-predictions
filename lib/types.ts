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

export type Pick = { player: string; fairOdds: string; banker: boolean; note: string };

export type Prediction = {
  win: { pick: string; fairOdds: string; reason: string };
  halfTime: { score: string; fairOdds: string; alt: string; altOdds: string };
  htft: { pick: string; fairOdds: string };
  fullTime: { score: string; fairOdds: string };
  scorers: Pick[];
  assists: Pick[];
  penalty: { likelihood: string; taker: string; backup: string; note: string };
  lineups: { home: string; away: string; status: "confirmed" | "probable" | "unconfirmed" };
  playerNotes: { player: string; team: string; note: string }[];
  confidence: "high" | "medium" | "low";
  sources: string[];
};

export type PredictionFile = {
  meta: { generatedAt: string; disclaimer: string; method: string };
  predictions: Record<string, Prediction>;
};
