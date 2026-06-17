import { fetchLiveMatches, type LiveMatch } from "@/lib/live";

// Always run at request time — this is a live feed, never prerender or cache it.
export const dynamic = "force-dynamic";

// Tiny in-process memo so many 5-second pollers don't hammer ESPN. ESPN updates
// roughly every ~15-30s anyway, so a 4s shared cache is invisible to the user.
let memo: { at: number; data: Record<string, LiveMatch> } | null = null;
const MEMO_MS = 4000;

export async function GET() {
  const now = Date.now();
  try {
    if (!memo || now - memo.at > MEMO_MS) {
      memo = { at: now, data: await fetchLiveMatches(now) };
    }
    const anyLive = Object.values(memo.data).some(
      (m) => m.state === "live" || m.state === "halftime",
    );
    return Response.json(
      { updatedAt: now, anyLive, matches: memo.data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    // Never break the page on an upstream hiccup — return empty, UI keeps static state.
    return Response.json(
      { updatedAt: now, anyLive: false, matches: {}, error: "upstream" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
