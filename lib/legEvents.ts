/**
 * Per-leg settlement transitions — the EXPLICIT thread between a live match
 * event and the parlay leg it moves. LiveFX celebrates what happened on the
 * pitch (a goal, a corner); this celebrates what that did to your slip (a leg
 * clinched, a leg died, a leg half-covered). Pure data — the tracker snapshots
 * every leg's live verdict glyph each poll and diffs two consecutive snapshots.
 *
 * The glyphs are the exact verdicts lib/inplay produces (parsed from the acca
 * grader's note in LiveTracker.parseLegs), so a leg event NEVER disagrees with
 * how the slip is actually settling — it's the same source, surfaced the moment
 * it flips instead of only living in the leg grid.
 */

/** A single leg's live state at one poll, keyed by match + pick label. */
export type LegSnap = {
  matchId: string;
  /** The pick as shown on the slip ("Over 1.25 goals", "Norway -0.75"). */
  label: string;
  /** Live verdict glyph: ✓ won · ✗ dead · ⋯ on track · — not started · ↺ void · ½✓/½✗ Asian half. */
  glyph: string;
  /** Which slip this leg belongs to (for the chip's "· slip 3" tag). */
  slipNo?: string;
  /** The parlay's market name, for context on the chip. */
  market?: string;
};

export type LegEventKind = "clinched" | "dead" | "halfWin" | "halfLoss" | "void";

export type LegEvent = LegSnap & { kind: LegEventKind };

/** Stable identity for a leg across polls AND across the render tree, so the
 * diff engine and the rendered leg row agree on which row to flash. A pick is
 * identified by its match + its label (identical picks on the same match across
 * different slips grade identically, so they share a key and flash together —
 * "this pick moved on every slip it's on", which is the right read). */
export function legKey(matchId: string, label: string): string {
  return `${matchId}::${label.trim().toLowerCase()}`;
}

/** Which glyphs represent a SETTLED (or repriced) leg worth announcing. Landing
 * on ⋯ (on track) or — (not started) is transient churn, never a settlement. */
const SETTLE: Record<string, LegEventKind> = {
  "✓": "clinched",
  "✗": "dead",
  "½✓": "halfWin",
  "½✗": "halfLoss",
  "↺": "void",
};

/**
 * Legs whose verdict glyph changed into a settled state between two snapshots.
 * `prev` null (first snapshot after mount) yields [] — the baseline is never
 * announced. Only real transitions surface: a leg that was already ✓ last poll
 * doesn't re-fire.
 */
export function diffLegEvents(
  prev: Record<string, LegSnap> | null | undefined,
  next: Record<string, LegSnap>,
): LegEvent[] {
  if (!prev) return [];
  const out: LegEvent[] = [];
  for (const key of Object.keys(next)) {
    const n = next[key];
    const p = prev[key];
    if (!p || p.glyph === n.glyph) continue; // new leg this poll, or no change
    const kind = SETTLE[n.glyph];
    if (!kind) continue; // moved into ⋯ / — → churn, not a settlement
    out.push({ ...n, kind });
  }
  return out;
}
