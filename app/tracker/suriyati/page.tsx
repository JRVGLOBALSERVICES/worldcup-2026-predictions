import type { Metadata } from "next";
import { suriyatiSlip } from "@/lib/bets";
import { buildTrackerBase } from "@/lib/tracker";
import LiveTracker from "@/components/LiveTracker";

// Static shell; the live layer hydrates and polls /api/live every 5s in-play.
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Suriyati's Bet Tracker",
  description:
    "Suriyati's live bet tracker in Malaysia time — every line updates second-by-second while the match is on, then settles on the final whistle.",
  robots: { index: false, follow: true },
};

export default function SuriyatiTrackerPage() {
  return <LiveTracker base={buildTrackerBase(suriyatiSlip)} activeNav="suriyati" />;
}
