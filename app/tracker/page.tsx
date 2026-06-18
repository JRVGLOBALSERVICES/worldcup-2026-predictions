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
  // Most recent day first (today on top), then previous days; "tbd" bucket last.
  const days = dayOrder
    .map((k) => dayMap.get(k)!)
    .sort((a, b) => {
      if (a.key === "tbd") return 1;
      if (b.key === "tbd") return -1;
      return b.key.localeCompare(a.key);
    });

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
    counts: { score: settled.length, props: specials.length },
    staked: allTotals.staked,
    potential: allTotals.potential,
    days,
  };

  return <LiveTracker base={base} />;
}
