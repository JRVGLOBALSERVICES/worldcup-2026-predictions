"use client";

import { useEffect, useState } from "react";

function fmt(diff: number) {
  if (diff <= 0) return null;
  const s = Math.floor(diff / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function KickoffClock({ kickoffUTC }: { kickoffUTC: string }) {
  const ko = new Date(kickoffUTC).getTime();
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  if (now === null) return <span className="text-faint">—</span>;

  const diff = ko - now;
  const liveWindow = 115 * 60 * 1000;

  if (diff <= 0 && diff > -liveWindow)
    return (
      <span className="inline-flex items-center gap-1.5 text-acid">
        <span className="size-2 animate-pulse rounded-full bg-acid" />
        Live now
      </span>
    );
  if (diff <= -liveWindow) return <span className="text-faint">Full time</span>;

  return (
    <span className="text-muted">
      Kickoff in <span className="tnum font-mono text-ink">{fmt(diff)}</span>
    </span>
  );
}
