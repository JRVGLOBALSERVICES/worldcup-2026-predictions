import fixturesJson from "@/data/fixtures.json";
import predictionsJson from "@/data/predictions.json";
import type { Fixture, Prediction, PredictionFile } from "./types";

const MYT = "Asia/Kuala_Lumpur";

export const fixtures = fixturesJson as Fixture[];
export const predictionFile = predictionsJson as PredictionFile;

export function getFixture(id: string): Fixture | undefined {
  return fixtures.find((f) => f.id === id);
}

export function getPrediction(id: string): Prediction | undefined {
  return predictionFile.predictions[id];
}

export function hasPrediction(id: string): boolean {
  return Boolean(predictionFile.predictions[id]);
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
