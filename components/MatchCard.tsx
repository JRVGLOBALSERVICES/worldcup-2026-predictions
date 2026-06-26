import Link from "next/link";
import type { Fixture } from "@/lib/types";
import { mytTime, etTime, getPrediction, overallStrength } from "@/lib/data";
import { LiveScore, LiveStatusLine } from "./LiveScore";
import { StrengthMeter, StatusBadge } from "./atoms";

export function MatchCard({ fixture }: { fixture: Fixture }) {
  const pred = getPrediction(fixture.id);

  return (
    <Link
      href={`/match/${fixture.id}`}
      className="group block rounded-2xl border border-line bg-card/60 p-4 transition-colors hover:border-acid-dim hover:bg-card sm:p-5"
    >
      <div className="mb-3 flex items-center justify-between text-[0.7rem] text-faint">
        <span className="font-mono uppercase tracking-[0.18em]">
          Group {fixture.group} · {fixture.city}
        </span>
        <span className="tnum font-mono">
          {mytTime(fixture.kickoffUTC)} <span className="text-acid-dim">MYT</span>
        </span>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <Side flag={fixture.home.flag} name={fixture.home.name} />
          <Side flag={fixture.away.flag} name={fixture.away.name} />
        </div>

        <div className="max-w-[46%] shrink-0 text-right sm:max-w-[50%]">
          {pred ? (
            <div className="flex flex-col items-end space-y-1">
              <div className="font-mono text-[0.62rem] uppercase tracking-wider text-faint">Pick</div>
              <div className="text-balance text-sm font-semibold leading-tight text-acid">{pred.win.pick}</div>
              <StrengthMeter value={overallStrength(pred)} size="sm" />
            </div>
          ) : (
            <span className="font-mono text-[0.66rem] uppercase tracking-wider text-faint">
              Prediction soon
            </span>
          )}
        </div>
      </div>

      <LiveScore matchId={fixture.id} />

      <div className="mt-4 flex items-center justify-between border-t border-line/70 pt-3 text-[0.72rem]">
        <LiveStatusLine matchId={fixture.id} kickoffUTC={fixture.kickoffUTC} />
        <div className="flex items-center gap-2">
          {pred && <StatusBadge status={pred.lineups.status} />}
          <span className="tnum font-mono text-faint">{etTime(fixture.kickoffUTC)} ET</span>
        </div>
      </div>
    </Link>
  );
}

function Side({ flag, name }: { flag: string; name: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-xl leading-none">{flag}</span>
      <span className="truncate font-display text-lg font-extrabold uppercase leading-none tracking-tight text-ink">
        {name}
      </span>
    </div>
  );
}
