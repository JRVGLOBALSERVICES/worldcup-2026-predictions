import type { Fixture } from "./types";
import { fixtures } from "./data";
import { getResult } from "./results";

/** One team's row in a group table. */
export type StandingRow = {
  name: string;
  flag: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
  /** Newest-first W/D/L for the matches this team has actually completed. */
  form: ("W" | "D" | "L")[];
};

export type GroupTable = {
  group: string;
  rows: StandingRow[];
  /** Matches counted (finished) vs total scheduled in the group. */
  played: number;
  total: number;
};

function blankRow(team: { name: string; flag: string }): StandingRow {
  return {
    name: team.name,
    flag: team.flag,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDiff: 0,
    points: 0,
    form: [],
  };
}

/**
 * Build all twelve group tables (A–L) from the fixtures list and the persisted
 * results. Only FINISHED matches count toward the table — a live match is shown
 * elsewhere and would otherwise churn the standings mid-game. Ordering follows
 * the FIFA group-stage rule that we can compute from the free feed: points, then
 * goal difference, then goals scored, then alphabetical (head-to-head and
 * fair-play tiebreaks need data the feed doesn't expose). Returns groups in A→L
 * order, each with rows already sorted top to bottom.
 */
export function groupTables(): GroupTable[] {
  // Bucket fixtures by group, seeding a row per team as we first see them.
  const groups = new Map<string, { rows: Map<string, StandingRow>; total: number; played: number }>();

  const ensure = (g: string) => {
    let bucket = groups.get(g);
    if (!bucket) {
      bucket = { rows: new Map(), total: 0, played: 0 };
      groups.set(g, bucket);
    }
    return bucket;
  };
  const ensureRow = (bucket: ReturnType<typeof ensure>, team: { name: string; flag: string }) => {
    let row = bucket.rows.get(team.name);
    if (!row) {
      row = blankRow(team);
      bucket.rows.set(team.name, row);
    }
    return row;
  };

  for (const fx of fixtures as Fixture[]) {
    const bucket = ensure(fx.group);
    bucket.total += 1;
    // Seed both teams even before they play, so a not-yet-started team still
    // appears in its table on 0 points rather than vanishing.
    const homeRow = ensureRow(bucket, fx.home);
    const awayRow = ensureRow(bucket, fx.away);

    const res = getResult(fx.id);
    if (!res || res.state !== "finished") continue;
    const sc = res.ft ?? res.score;
    if (!sc) continue;

    bucket.played += 1;
    homeRow.played += 1;
    awayRow.played += 1;
    homeRow.goalsFor += sc.home;
    homeRow.goalsAgainst += sc.away;
    awayRow.goalsFor += sc.away;
    awayRow.goalsAgainst += sc.home;

    if (sc.home > sc.away) {
      homeRow.won += 1;
      homeRow.points += 3;
      awayRow.lost += 1;
      homeRow.form.push("W");
      awayRow.form.push("L");
    } else if (sc.away > sc.home) {
      awayRow.won += 1;
      awayRow.points += 3;
      homeRow.lost += 1;
      awayRow.form.push("W");
      homeRow.form.push("L");
    } else {
      homeRow.drawn += 1;
      awayRow.drawn += 1;
      homeRow.points += 1;
      awayRow.points += 1;
      homeRow.form.push("D");
      awayRow.form.push("D");
    }
  }

  const tables: GroupTable[] = [];
  for (const [group, bucket] of groups) {
    const rows = [...bucket.rows.values()].map((r) => ({
      ...r,
      goalDiff: r.goalsFor - r.goalsAgainst,
      form: r.form.slice(-5).reverse() as ("W" | "D" | "L")[],
    }));
    rows.sort(
      (a, b) =>
        b.points - a.points ||
        b.goalDiff - a.goalDiff ||
        b.goalsFor - a.goalsFor ||
        a.name.localeCompare(b.name),
    );
    tables.push({ group, rows, played: bucket.played, total: bucket.total });
  }

  tables.sort((a, b) => a.group.localeCompare(b.group));
  return tables;
}
