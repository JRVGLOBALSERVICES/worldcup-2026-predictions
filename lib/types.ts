export type Team = { name: string; flag: string };

export type Fixture = {
  id: string;
  group: string;
  // Knockout ties carry a round label ("Round of 32", "Quarter-final", …) and an
  // empty `group`; group-stage fixtures leave `round` undefined.
  round?: string;
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

// A confirmed XI lifted from ESPN's published team sheet. `players` are
// position-ordered (GK first, then D → M → F) so the pitch can chunk them by the
// formation's row sizes; `num` is the real shirt number (null only if ESPN omits it).
export type LineupPlayer = { num: number | null; name: string; pos: string };
export type LineupXI = { formation: string; players: LineupPlayer[] };

// ── The Brain — three reasoning layers baked onto each prediction ──────────────
// Distilled from thelocktalk's framework deck: analyse the match (Pitch Report),
// price the market against the model (Value Spot), then filter for weak bets
// (TRAP Detector). All three are computed deterministically by
// scripts/build-predictions.mjs so the page reads like a disciplined tipster,
// not a probability dump.

/** Pitch Report — the 10-point structured read (slide 3/6). */
export type PitchReport = {
  facts: string[];        // verifiable, from standings/results/stats
  assumptions: string[];  // what the model is projecting
  lineups: string;        // status + rotation risk
  motivation: string;     // must-win / dead-rubber / cautious-knockout read
  xgRead: string;         // who creates the better chances (λ home–away)
  drawRisk: string;       // how cagey / low-scoring
  travel: string;         // host-city heat / altitude / kickoff factor
  caseFor: string[];      // max 3 for the model's pick
  caseAgainst: string[];  // max 3 against it
  verdict: "Bet" | "Lean" | "Pass";
  changeMind: string;     // what would flip the call
};

/** One market priced against the model. */
export type ValueLeg = {
  market: string;         // "Match result", "Over/Under 2.5", …
  side: string;           // "Canada", "Draw", "Over 2.5"
  price: string;          // decimal odds as shown by the book
  impliedPct: number;     // 100/price
  fairPct: number;        // margin-stripped
  modelPct: number;       // the engine's own estimate
  edgePts: number;        // model − fair (positive = value)
  verdict: "good" | "fair" | "bad";
};

/** Value Spot — odds value check (slide 4/6). null when no market is captured. */
export type ValueSpot = {
  source: string;         // "1xBet" | "1xBet (LIVE)" | "FanDuel" | …
  overroundPct: number;   // book margin on the 3-way
  legs: ValueLeg[];
  bestSide: string | null;   // the one genuine value side, or null
  headline: string;       // one-line verdict on the price
  capturedAt: string;
  // present only when this price is a live in-play snapshot (1xBet LiveFeed):
  // the market is moving minute-by-minute, so the UI can flag it as live.
  live?: {
    inGame: boolean;
    score: { home: number; away: number };
    minute: number | null;       // 65
    minuteLabel: string | null;  // "65 minutes"
    period: string | null;       // "2nd half"
  } | null;
};

/** One trap flag (slide 5/6). */
export type TrapFlag = { name: string; tripped: boolean; why: string };

/** TRAP Detector — talk-me-out-of-a-weak-bet filter (slide 5/6). */
export type TrapDetector = {
  flags: TrapFlag[];
  trapsTripped: number;
  edge: "real edge" | "edge-leaning" | "narrative-leaning" | "pure narrative";
  verdict: "PLAYABLE" | "LEAN" | "PASS";
  discipline: string;     // one sentence of tournament discipline
};

/**
 * Brain summary — the three frameworks distilled into one plain-English call.
 * This is what leads the AI prediction so the whole read fits in a glance;
 * the detailed Pitch / Value / Trap blocks sit below it for anyone who wants them.
 */
export type BrainSummary = {
  verdict: "PLAYABLE" | "LEAN" | "PASS"; // the bottom-line call (from the Trap filter)
  call: string;                          // one plain sentence fusing read + price + traps
  read: { tag: "Bet" | "Lean" | "Pass"; line: string };  // the match read
  price: { tag: string; line: string };  // the value check
  trap: { tag: string; line: string };   // the honest filter
};

/**
 * How a KNOCKOUT tie is settled — the three routes a level game can take:
 * decided inside 90 minutes, in extra time, or on penalties. The percentages
 * sum to ~100. Undefined on group-stage matches (a draw simply stands there).
 * Computed in build-predictions.mjs: extra time is modelled as a ⅓-length match
 * on the same expected goals; penalties is the chance it's still level at 120.
 */
export type Resolution = {
  ninety: number;        // % decided in regulation (someone wins the 90)
  extraTime: number;     // % level at 90, then decided in extra time
  penalties: number;     // % still level after 120 → shootout
  mostLikely: "Regulation" | "Extra time" | "Penalties";
  etWinner: string;      // who's favoured if it reaches extra time
  shootout: string;      // the shootout read (near coin-flip / slight edge)
  note: string;          // one plain-English line tying it together
};

export type Prediction = {
  win: { pick: string; fairOdds: string; reason: string; strength?: number };
  halfTime: { score: string; fairOdds: string; alt: string; altOdds: string; strength?: number };
  htft: { pick: string; fairOdds: string; strength?: number };
  fullTime: { score: string; fairOdds: string; strength?: number };
  /** Knockout route to a result — 90 / extra time / penalties. Knockout-only. */
  resolution?: Resolution;
  scorers: Pick[];
  assists: Pick[];
  penalty: { likelihood: string; taker: string; backup: string; note: string };
  lineups: {
    home: string;
    away: string;
    status: "confirmed" | "probable" | "unconfirmed";
    homeXI?: LineupXI;
    awayXI?: LineupXI;
  };
  playerNotes: { player: string; team: string; note: string }[];
  confidence: "high" | "medium" | "low";
  /** Overall 1–5 conviction in the headline call. Optional; derived from the win pick when absent. */
  strength?: number;
  /** The Brain — analyse → price → trap-filter. Optional; present on upcoming model calls. */
  pitchReport?: PitchReport;
  valueSpot?: ValueSpot | null;
  trapDetector?: TrapDetector;
  /** Plain-English distillation of the three frameworks — leads the AI call. */
  brainSummary?: BrainSummary;
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
