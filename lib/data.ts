import fixturesJson from "@/data/fixtures.json";
import predictionsJson from "@/data/predictions.json";
import researchJson from "@/data/research.json";
import type { Fixture, Prediction, PredictionFile, Research, ResearchFile } from "./types";

const MYT = "Asia/Kuala_Lumpur";

export const fixtures = fixturesJson as Fixture[];
export const predictionFile = predictionsJson as PredictionFile;
export const researchFile = researchJson as ResearchFile;

export function getFixture(id: string): Fixture | undefined {
  return fixtures.find((f) => f.id === id);
}

export function getPrediction(id: string): Prediction | undefined {
  return predictionFile.predictions[id];
}

export function hasPrediction(id: string): boolean {
  return Boolean(predictionFile.predictions[id]);
}

/** Real match research (form, record, leaders, discipline, H2H) for a fixture. */
export function getResearch(id: string): Research | undefined {
  const r = (researchFile.research as Record<string, Research>)[id];
  return r && !r.error ? r : undefined;
}

/**
 * 1–5 conviction rating — what Rj reads instead of decimal odds. Lower fair
 * odds = a more likely call = a stronger rating. Deterministic so the meter is
 * stable across renders; an explicit `strength` on the data always wins.
 */
export function strengthFromOdds(odds: string | number | undefined, explicit?: number): number {
  if (explicit && explicit >= 1 && explicit <= 5) return Math.round(explicit);
  const o = typeof odds === "string" ? parseFloat(odds.replace(/[^\d.]/g, "")) : odds;
  if (!o || !Number.isFinite(o) || o <= 0) return 3;
  if (o <= 1.5) return 5;
  if (o <= 2.0) return 4;
  if (o <= 3.0) return 3;
  if (o <= 5.0) return 2;
  return 1;
}

const STRENGTH_LABEL = ["", "Long shot", "Outside call", "Solid call", "Strong call", "Banker"];
export function strengthLabel(n: number): string {
  return STRENGTH_LABEL[Math.max(1, Math.min(5, Math.round(n)))] ?? "";
}

/** Overall headline conviction: explicit pred.strength, else derived from the win pick. */
export function overallStrength(pred: Prediction): number {
  return strengthFromOdds(pred.win.fairOdds, pred.strength);
}

/** Day key in MYT, e.g. "2026-06-18" — used to group the schedule the way Rj sees it. */
export function mytDayKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MYT,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** Current day key in MYT — the "today" the tracker buckets and features against. */
export function nowMytDayKey(): string {
  return mytDayKey(new Date().toISOString());
}

export function mytDayLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: MYT,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(iso));
}

export function mytTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: MYT,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export function etTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

export type DayGroup = { key: string; label: string; fixtures: Fixture[] };

export function fixturesByMytDay(): DayGroup[] {
  const sorted = [...fixtures].sort(
    (a, b) => new Date(a.kickoffUTC).getTime() - new Date(b.kickoffUTC).getTime(),
  );
  const map = new Map<string, Fixture[]>();
  for (const f of sorted) {
    const key = mytDayKey(f.kickoffUTC);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(f);
  }
  return [...map.entries()].map(([key, fx]) => ({
    key,
    label: mytDayLabel(fx[0].kickoffUTC),
    fixtures: fx,
  }));
}

/** Kickoff state relative to a reference instant (server render time). */
export function kickoffState(iso: string, nowMs: number) {
  const ko = new Date(iso).getTime();
  const diff = ko - nowMs;
  const liveWindowMs = 115 * 60 * 1000; // ~kickoff..full-time
  if (diff <= 0 && diff > -liveWindowMs) return { state: "live" as const, diff };
  if (diff <= -liveWindowMs) return { state: "finished" as const, diff };
  return { state: "upcoming" as const, diff };
}
