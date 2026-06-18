import type { Metadata } from "next";
import { mytTime, etTime, mytDayKey, mytDayLabel } from "@/lib/data";
import {
  betSlip,
  settleAll,
  slipTotals,
  groupByMatch,
  settleSpecials,
  specialsTotals,
  mergeTotals,
} from "@/lib/bets";
import LiveTracker, { type TrackerBase, type MatchRow, type DayRow } from "@/components/LiveTracker";

// Static shell; the live layer hydrates and polls /api/live every 5s in-play.
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Bet Tracker",
  description:
    "Live correct-score bet tracker in Malaysia time — every line updates second-by-second while the match is on, then settles on the final whistle.",
  robots: { index: false, follow: true },
};

function code(name: string): string {
  return name.replace(/[^a-z]/gi, "").slice(0, 3).toUpperCase();
}

export default function TrackerPage() {
  const settled = settleAll();
  const specials = settleSpecials();
  const totals = slipTotals(settled);
  const allTotals = mergeTotals(totals, specialsTotals(specials));
  const groups = groupByMatch(settled);

  const specialsByMatch = new Map<string, typeof specials>();
  for (const s of specials) {
    if (!specialsByMatch.has(s.matchId)) specialsByMatch.set(s.matchId, []);
    specialsByMatch.get(s.matchId)!.push(s);
  }

  // Build matchId-ordered match rows, then bucket into MYT days.
  const matchRows: MatchRow[] = groups.map((g) => {
    const f = g.fixture;
    const sp = specialsByMatch.get(g.matchId) ?? [];
    return {
      matchId: g.matchId,
      home: { name: f?.home.name ?? "?", flag: f?.home.flag ?? "", code: f ? code(f.home.name) : "?" },
      away: { name: f?.away.name ?? "?", flag: f?.away.flag ?? "", code: f ? code(f.away.name) : "?" },
      group: f?.group ?? "—",
      kickoffUTC: f?.kickoffUTC ?? "",
      kickoffLabel: f ? `${mytTime(f.kickoffUTC)} MYT (${etTime(f.kickoffUTC)} ET)` : "Time TBC",
      staticResult: g.result,
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

  // Featured day = the live/upcoming slate Rj is actively betting on, NOT the
  // calendar date. Bets placed late at night (MYT) for matches that kick off
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
  const featuredRows = (featuredDay?.matches ?? []).flatMap((m) => [...m.bets, ...m.specials]);
  const todayTotals = {
    staked: featuredRows.reduce((s, r) => s + r.stake, 0),
    potential: featuredRows.reduce((s, r) => s + r.potential, 0),
    score: (featuredDay?.matches ?? []).reduce((n, m) => n + m.bets.length, 0),
    props: (featuredDay?.matches ?? []).reduce((n, m) => n + m.specials.length, 0),
  };

  const placedLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(betSlip.meta.placedAt));

  const base: TrackerBase = {
    meta: {
      owner: betSlip.meta.owner,
      currency: betSlip.meta.currency,
      note: betSlip.meta.note,
      disclaimer: betSlip.meta.disclaimer,
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

  return <LiveTracker base={base} />;
}
