import type { Metadata } from "next";
import { thasyanSlip } from "@/lib/bets";
import { buildTrackerBase } from "@/lib/tracker";
import LiveTracker from "@/components/LiveTracker";

// Static shell; the live layer hydrates and polls /api/live every 5s in-play.
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Thasyan's Bet Tracker",
  description:
    "Thasyan's live bet tracker in Malaysia time — every line updates second-by-second while the match is on, then settles on the final whistle.",
  robots: { index: false, follow: true },
};

export default function ThasyanTrackerPage() {
  return <LiveTracker base={buildTrackerBase(thasyanSlip)} activeNav="thasyan" />;
}
