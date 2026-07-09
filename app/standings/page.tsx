import { redirect } from "next/navigation";

// Standings has been folded into the Stats page (per-team player sheets +
// leaderboards + completion boards). Keep the route as a permanent redirect so
// any old link / bookmark lands on the live stats hub instead of a 404.
export default function StandingsPage() {
  redirect("/stats");
}
