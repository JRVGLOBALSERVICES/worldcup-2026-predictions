import { computeStats } from "@/lib/live-stats";
import { getStats } from "@/lib/stats";
import type { StatsFile } from "@/lib/stats";

// Recompute the tournament leaderboards from ESPN at request time — this backs
// the /stats page's "Force update" button. Never prerender or edge-cache it.
export const dynamic = "force-dynamic";

// Short in-process memo so rapid taps don't refetch ESPN; the tournament boards
// move slowly, so ~30s between live recomputes is plenty.
let memo: { at: number; data: StatsFile } | null = null;
const MEMO_MS = 30_000;

export async function GET() {
  const now = Date.now();
  try {
    if (!memo || now - memo.at > MEMO_MS) {
      memo = { at: now, data: await computeStats(now) };
    }
    return Response.json(memo.data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // Upstream hiccup — fall back to the committed cron snapshot, never error out.
    return Response.json(
      { ...getStats(), stale: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
