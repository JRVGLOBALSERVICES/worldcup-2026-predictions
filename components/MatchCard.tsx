import Link from "next/link";
import type { Fixture } from "@/lib/types";
import { mytTime, etTime, getPrediction, overallStrength } from "@/lib/data";
import { LiveScore, LiveStatusLine } from "./LiveScore";
import { StrengthMeter, StatusBadge, StatAbbr } from "./atoms";
import { BrainVerdictChip } from "./BrainPanel";

/**
 * The fixture card, framed as a broadcast SCOREBUG: a fixture-board metadata
 * strip up top (stage · city / kickoff flap), two team rows carrying a rail
 * edge — the predicted winner's rail lights acid, the broadcast "who we've got"
 * tell — then the call on a lower-third nameplate. The sharp top accent bar
 * (`.scorebug::before`) is the TV-graphics cue laid over the rounded programme
 * card. Live matches flip the bug to amber and inject the running score.
 */
export function MatchCard({ fixture }: { fixture: Fixture }) {
  const pred = getPrediction(fixture.id);
  const pickHome = pred?.win.pick === fixture.home.name;
  const pickAway = pred?.win.pick === fixture.away.name;

  return (
    <Link
      href={`/match/${fixture.id}`}
      className="scorebug group block overflow-hidden rounded-2xl border border-line transition-colors hover:border-acid-dim"
    >
      {/* fixture-board strip — stage · city / kickoff flap */}
      <div className="board-strip flex items-stretch justify-between font-mono text-[0.66rem] uppercase tracking-[0.16em] text-faint">
        <span
          className="min-w-0 truncate px-4 py-2"
          title="Tournament stage (QF = quarter-final, SF = semi-final) and host city"
        >
          {fixture.round ?? `Group ${fixture.group}`}
          <span className="text-faint/50"> · {fixture.city}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2 px-4 py-2 text-ink/70">
          <span className="tnum">{mytTime(fixture.kickoffUTC)}</span>
          <StatAbbr code="MYT" className="text-acid-dim" />
        </span>
      </div>

      {/* team rows — rail edge lights acid on the predicted winner */}
      <div>
        <TeamRow flag={fixture.home.flag} name={fixture.home.name} pick={pickHome} divider />
        <TeamRow flag={fixture.away.flag} name={fixture.away.name} pick={pickAway} />
      </div>

      {/* the call — a broadcast lower-third nameplate */}
      <div className="flex items-center justify-between gap-3 border-t border-line/70 px-4 py-3">
        {pred ? (
          <>
            <div className="lower-third min-w-0">
              <div className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-faint/70">
                Our call
              </div>
              <div className="text-balance font-display text-sm font-extrabold uppercase leading-tight tracking-tight text-acid">
                {pred.win.pick}
              </div>
            </div>
            <StrengthMeter value={overallStrength(pred)} size="sm" />
          </>
        ) : (
          <span className="font-mono text-[0.66rem] uppercase tracking-[0.18em] text-faint/70">
            Prediction dropping soon
          </span>
        )}
      </div>

      <div className="px-4 pb-1">
        <LiveScore matchId={fixture.id} />
      </div>

      {/* status ledger */}
      <div className="flex items-center justify-between gap-2 border-t border-line/70 px-4 py-2.5 text-[0.72rem]">
        <LiveStatusLine matchId={fixture.id} kickoffUTC={fixture.kickoffUTC} />
        <div className="flex items-center gap-2">
          {pred && <BrainVerdictChip pred={pred} />}
          {pred && <StatusBadge status={pred.lineups.status} />}
          <span className="tnum font-mono text-faint">
            {etTime(fixture.kickoffUTC)} <StatAbbr code="ET" />
          </span>
        </div>
      </div>
    </Link>
  );
}

function TeamRow({
  flag,
  name,
  pick,
  divider = false,
}: {
  flag: string;
  name: string;
  pick?: boolean;
  divider?: boolean;
}) {
  return (
    <div
      className={[
        "team-rail flex items-center gap-2.5 px-4 py-2.5",
        pick ? "team-rail--pick bg-acid/[0.05]" : "",
        divider ? "border-b border-line/50" : "",
      ].join(" ")}
    >
      <span className="text-xl leading-none">{flag}</span>
      <span className="truncate font-display text-lg font-black uppercase leading-none tracking-tight text-ink">
        {name}
      </span>
      {pick && (
        <span className="ml-auto shrink-0 font-mono text-[0.58rem] font-bold uppercase tracking-[0.16em] text-acid">
          ▸ Pick
        </span>
      )}
    </div>
  );
}
