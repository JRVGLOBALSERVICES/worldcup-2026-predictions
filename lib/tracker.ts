import { mytTime, etTime, mytDayKey, mytDayLabel, getFixture, getResearch } from "@/lib/data";
import {
  settleAll,
  settleSpecials,
  slipTotals,
  groupByMatch,
  getResult,
  specialsTotals,
  mergeTotals,
  type BetSlipFile,
} from "@/lib/bets";
import type { TrackerBase, MatchRow, DayRow } from "@/components/LiveTracker";

function code(name: string): string {
  return name.replace(/[^a-z]/gi, "").slice(0, 3).toUpperCase();
}

/**
 * Build the serialisable tracker payload for ONE owner's slip. Settling reads the
 * slip's own bets/specials, but the underlying scraped truth (scores, goal logs)
 * is shared across owners — see lib/bets.ts. Used by both /tracker (Rj) and
 * /tracker/ruhan, so the two stay perfectly in lockstep.
 */
export function buildTrackerBase(slip: BetSlipFile): TrackerBase {
  const settled = settleAll(slip);
  const specials = settleSpecials(slip);
  const totals = slipTotals(settled);
  const allTotals = mergeTotals(totals, specialsTotals(specials));
  const groups = groupByMatch(settled);

  // Mirror flag lets a single special show on more than one match card without
  // its stake/return being counted twice (see the `.mirror` guards downstream).
  type SpecialBucket = (typeof specials)[number] & { mirror?: boolean };
  const specialsByMatch = new Map<string, SpecialBucket[]>();
  const pushSpecial = (matchId: string, s: SpecialBucket) => {
    if (!specialsByMatch.has(matchId)) specialsByMatch.set(matchId, []);
    specialsByMatch.get(matchId)!.push(s);
  };
  // All leg matchIds for a cross-match acca (multiScorers / multiLeg carry a
  // `legs` array, each leg with its own matchId); empty for single-match specials.
  const legMatchIds = (s: SpecialBucket): string[] => {
    const legs = (s.grade as { legs?: { matchId?: string }[] } | undefined)?.legs;
    return Array.isArray(legs)
      ? legs.map((l) => l.matchId).filter((x): x is string => !!x)
      : [];
  };
  for (const s of specials) {
    // A cross-match accumulator (e.g. Ronaldo + Kane + Budimir, one leg per game)
    // is anchored to its first leg's match (the real, counted copy) AND mirrored
    // onto every OTHER leg's match card with mirror:true — so the acca is visible
    // from every game it touches without its stake/return being double-counted
    // (the `!s.mirror` guards downstream drop the copies from totals).
    pushSpecial(s.matchId, s);
    // Once an acca is LOST, it's dead — don't carry it forward onto the later
    // games' cards. A failed acca stays tracked on its anchor (first) game only;
    // mirroring a dead slip onto matches it can no longer affect is just noise.
    if (s.status === "lost") continue;
    const seen = new Set<string>([s.matchId]);
    for (const id of legMatchIds(s)) {
      if (!seen.has(id)) {
        seen.add(id);
        pushSpecial(id, { ...s, mirror: true });
      }
    }
  }

  // A match with ONLY specials (e.g. first-goal+score combos and no regular
  // correct-score bet) never appears in groupByMatch(settled), which is keyed
  // off regular bets — so its slips would silently vanish. Synthesize an
  // empty-bets group for every specials-only match, then re-sort by kickoff.
  const groupIds = new Set(groups.map((g) => g.matchId));
  const specialsOnly = [...specialsByMatch.keys()]
    .filter((id) => !groupIds.has(id))
    .map((matchId) => ({
      matchId,
      fixture: getFixture(matchId),
      result: getResult(matchId),
      bets: [] as (typeof groups)[number]["bets"],
    }));
  const allGroups = [...groups, ...specialsOnly].sort((a, b) => {
    const ta = a.fixture ? new Date(a.fixture.kickoffUTC).getTime() : 0;
    const tb = b.fixture ? new Date(b.fixture.kickoffUTC).getTime() : 0;
    return ta - tb;
  });

  // Build matchId-ordered match rows, then bucket into MYT days.
  const matchRows: MatchRow[] = allGroups.map((g) => {
    const f = g.fixture;
    const sp = specialsByMatch.get(g.matchId) ?? [];
    const research = getResearch(g.matchId);
    const form = research?.form
      ? {
          home: { line: research.form.home.line, record: research.form.home.record },
          away: { line: research.form.away.line, record: research.form.away.record },
        }
      : undefined;
    return {
      matchId: g.matchId,
      home: { name: f?.home.name ?? "?", flag: f?.home.flag ?? "", code: f ? code(f.home.name) : "?" },
      away: { name: f?.away.name ?? "?", flag: f?.away.flag ?? "", code: f ? code(f.away.name) : "?" },
      group: f?.group ?? "—",
      round: f?.round,
      kickoffUTC: f?.kickoffUTC ?? "",
      kickoffLabel: f ? `${mytTime(f.kickoffUTC)} MYT (${etTime(f.kickoffUTC)} ET)` : "Time TBC",
      staticResult: g.result,
      form,
      bets: g.bets.map((b) => ({
        id: b.id,
        period: b.period,
        label: b.label,
        home: b.home,
        away: b.away,
        odds: b.odds,
        stake: b.stake,
        potential: b.potential,
        staticStatus: b.status,
      })),
      specials: sp.map((s) => ({
        id: s.id,
        market: s.market,
        label: s.label,
        slipNo: s.slipNo,
        placedAt: s.placedAt,
        odds: s.odds,
        stake: s.stake,
        potential: s.potential,
        staticStatus: s.status,
        grade: s.grade,
        statusOverride: s.statusOverride,
        punter: s.punter,
        mirror: s.mirror ?? false,
      })),
    };
  });

  const dayOrder: string[] = [];
  const dayMap = new Map<string, DayRow>();
  for (const m of matchRows) {
    const key = m.kickoffUTC ? mytDayKey(m.kickoffUTC) : "tbd";
    if (!dayMap.has(key)) {
      dayMap.set(key, { key, label: m.kickoffUTC ? mytDayLabel(m.kickoffUTC) : "Date TBC", matches: [] });
      dayOrder.push(key);
    }
    dayMap.get(key)!.matches.push(m);
  }

  // Featured day = the live/upcoming slate the owner is actively betting on, NOT
  // the calendar date. Bets placed late at night (MYT) for matches that kick off
  // after midnight bucket into the NEXT MYT day, so "today's bets" = the next
  // active matchday. Mirror the home page: earliest dated day whose last match
  // hasn't finished yet (115-min live window); else the most recent dated day.
  const now = Date.now();
  const liveWindow = 115 * 60 * 1000;
  const lastKickoff = (k: string) =>
    dayMap.get(k)!.matches.reduce((mx, m) => {
      const t = m.kickoffUTC ? new Date(m.kickoffUTC).getTime() : 0;
      return t > mx ? t : mx;
    }, 0);
  const datedKeys = dayOrder.filter((k) => k !== "tbd").sort(); // ascending
  const featuredKey =
    datedKeys.find((k) => lastKickoff(k) + liveWindow > now) ??
    datedKeys[datedKeys.length - 1] ??
    "tbd";

  // Featured day pinned first, then remaining days newest-first; "tbd" bucket last.
  const days = dayOrder
    .map((k) => {
      const d = dayMap.get(k)!;
      const isFeatured = k === featuredKey;
      return { ...d, isFeatured };
    })
    .sort((a, b) => {
      if (a.isFeatured) return -1;
      if (b.isFeatured) return 1;
      if (a.key === "tbd") return 1;
      if (b.key === "tbd") return -1;
      return b.key.localeCompare(a.key);
    });

  // Hero summary is scoped to the featured (today's) bets — staked / max return /
  // counts off today, not the whole season. Season-to-date is shown as a sub-line.
  const featuredDay = days.find((d) => d.isFeatured);
  // Exclude mirror copies (same acca shown on multiple cards) so the hero
  // staked/return/count figures don't multi-count it.
  const featuredRows = (featuredDay?.matches ?? []).flatMap((m) => [...m.bets, ...m.specials.filter((s) => !s.mirror)]);
  // An accumulator is a single combined slip carrying its full payout in one
  // line (e.g. a 7290.0-odds 5-fold pays RM72,900 off a RM10 stake). Folding
  // those lottery-ticket potentials into "Max return" balloons it into a
  // meaningless number that dwarfs the realistic single-bet returns, so the
  // hero Max-return figure counts SINGLES only — accas are still tracked and
  // settled individually on their own cards. A bet is identified as an acca by
  // its multi-leg grade (multiLeg / multiScorers carry a `legs` array).
  const isAcca = (r: (typeof featuredRows)[number]): boolean =>
    "grade" in r && Array.isArray((r as { grade?: { legs?: unknown[] } }).grade?.legs);
  // Max return = best still-achievable payout: drop already-lost / refunded
  // (void) lines, and drop accas per the rule above.
  const winnable = (r: (typeof featuredRows)[number]): boolean =>
    r.staticStatus !== "lost" && r.staticStatus !== "void";
  const todayTotals = {
    staked: featuredRows.reduce((s, r) => s + r.stake, 0),
    potential: featuredRows
      .filter((r) => !isAcca(r) && winnable(r))
      .reduce((s, r) => s + r.potential, 0),
    score: (featuredDay?.matches ?? []).reduce((n, m) => n + m.bets.length, 0),
    props: (featuredDay?.matches ?? []).reduce((n, m) => n + m.specials.filter((s) => !s.mirror).length, 0),
  };

  const placedLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(slip.meta.placedAt));

  return {
    meta: {
      owner: slip.meta.owner,
      currency: slip.meta.currency,
      note: slip.meta.note,
      disclaimer: slip.meta.disclaimer,
      placedLabel,
    },
    // Hero counts/totals = today's slate; season is the all-time roll-up below it.
    counts: { score: todayTotals.score, props: todayTotals.props },
    staked: todayTotals.staked,
    potential: todayTotals.potential,
    season: {
      counts: { score: settled.length, props: specials.length },
      staked: allTotals.staked,
      potential: allTotals.potential,
    },
    featuredKey,
    days,
  };
}
