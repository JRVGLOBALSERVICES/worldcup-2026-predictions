import type { Metadata } from "next";
import { siveshSlip } from "@/lib/bets";
import { buildTrackerBase } from "@/lib/tracker";
import LiveTracker from "@/components/LiveTracker";

// Static shell; the live layer hydrates and polls /api/live every 5s in-play.
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Sivesh's Bet Tracker",
  description:
    "Sivesh's live bet tracker in Malaysia time — every line updates second-by-second while the match is on, then settles on the final whistle.",
  robots: { index: false, follow: true },
};

export default function SiveshTrackerPage() {
  return <LiveTracker base={buildTrackerBase(siveshSlip)} activeNav="sivesh" />;
}
