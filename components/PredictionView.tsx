import type { Fixture, Prediction, Pick } from "@/lib/types";
import { strengthFromOdds, strengthLabel, overallStrength } from "@/lib/data";
import { SectionLabel, Banker, Confidence, StatusBadge, StrengthMeter } from "./atoms";

export function PredictionView({ fixture, pred }: { fixture: Fixture; pred: Prediction }) {
  const overall = overallStrength(pred);
  return (
    <div className="space-y-8">
      {/* overall conviction — the 1–5 call strength, front and centre */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-card/40 px-5 py-4">
        <div>
          <SectionLabel>Call strength</SectionLabel>
          <p className="text-sm text-muted">
            How strong this prediction is — 1 (coin-flip) to 5 (banker).
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StrengthMeter value={overall} label={strengthLabel(overall)} />
        </div>
      </div>

      {/* headline markets */}
      <div className="grid gap-3 sm:grid-cols-2">
        <MarketTile
          label="Match result"
          big={pred.win.pick}
          strength={strengthFromOdds(pred.win.fairOdds, pred.win.strength)}
          tone="acid"
        >
          {pred.win.reason}
        </MarketTile>
        <MarketTile
          label="Full-time score"
          big={pred.fullTime.score}
          strength={strengthFromOdds(pred.fullTime.fairOdds, pred.fullTime.strength)}
        />
        <MarketTile
          label="Half-time score"
          big={pred.halfTime.score}
          strength={strengthFromOdds(pred.halfTime.fairOdds, pred.halfTime.strength)}
        >
          <span className="inline-flex items-center gap-2">
            Alt: {pred.halfTime.alt}
            <StrengthMeter value={strengthFromOdds(pred.halfTime.altOdds)} size="sm" />
          </span>
        </MarketTile>
        <MarketTile
          label="Half-time / full-time"
          big={pred.htft.pick}
          strength={strengthFromOdds(pred.htft.fairOdds, pred.htft.strength)}
        />
      </div>

      {/* scorers + assists */}
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <SectionLabel>Anytime scorers</SectionLabel>
          <PickList picks={pred.scorers} />
        </div>
        <div>
          <SectionLabel>Anytime assists</SectionLabel>
          <PickList picks={pred.assists} />
        </div>
      </div>

      {/* penalty */}
      <div className="rounded-2xl border border-amber/40 bg-amber/[0.06] p-5">
        <div className="mb-2 flex items-center justify-between">
          <SectionLabel>Penalty</SectionLabel>
          <span className="tnum inline-flex shrink-0 items-center rounded-full border border-amber/50 px-2 py-0.5 font-mono text-[0.72rem] leading-none text-amber">
            {pred.penalty.likelihood}
          </span>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-sm text-muted">Taker</span>
          <span className="font-display text-xl font-extrabold uppercase tracking-tight text-amber">
            {pred.penalty.taker}
          </span>
          <span className="text-sm text-faint">backup: {pred.penalty.backup}</span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted">{pred.penalty.note}</p>
      </div>

      {/* lineups */}
      <div>
        <div className="mb-3 flex items-center gap-3">
          <SectionLabel>
            {pred.lineups.status === "confirmed"
              ? "Confirmed line-ups"
              : pred.lineups.status === "unconfirmed"
                ? "Line-ups (TBC)"
                : "Probable line-ups"}
          </SectionLabel>
          <StatusBadge status={pred.lineups.status} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Lineup team={fixture.home.name} flag={fixture.home.flag} xi={pred.lineups.home} />
          <Lineup team={fixture.away.name} flag={fixture.away.flag} xi={pred.lineups.away} />
        </div>
      </div>

      {/* deep player research */}
      <div>
        <SectionLabel>Key players — research notes</SectionLabel>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {pred.playerNotes.map((p) => (
            <div key={p.player} className="rounded-xl border border-line bg-card/50 p-3.5">
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="font-semibold text-ink">{p.player}</span>
                <span className="font-mono text-[0.62rem] uppercase tracking-wider text-faint">
                  {p.team}
                </span>
              </div>
              <p className="text-sm leading-relaxed text-muted">{p.note}</p>
            </div>
          ))}
        </div>
      </div>

      {/* meta */}
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
        <Confidence level={pred.confidence} />
        <span className="text-[0.72rem] text-faint">
          Sources: {pred.sources.join(" · ")}
        </span>
      </div>
    </div>
  );
}

function MarketTile({
  label,
  big,
  strength,
  tone = "default",
  children,
}: {
  label: string;
  big: string;
  strength: number;
  tone?: "default" | "acid";
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-line bg-card/50 p-5">
      <div className="mb-2 flex items-start justify-between gap-3">
        <SectionLabel>{label}</SectionLabel>
        <StrengthMeter value={strength} size="sm" />
      </div>
      <div
        className={`font-display text-2xl font-extrabold uppercase leading-none tracking-tight ${
          tone === "acid" ? "text-acid" : "text-ink"
        }`}
      >
        {big}
      </div>
      {children && <p className="mt-2 text-sm leading-relaxed text-muted">{children}</p>}
    </div>
  );
}

function PickList({ picks }: { picks: Pick[] }) {
  return (
    <ul className="space-y-2">
      {picks.map((p) => (
        <li
          key={p.player}
          className={`rounded-xl border bg-card/40 p-3 ${
            p.banker ? "border-acid-dim" : "border-line"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className={`font-semibold ${p.banker ? "text-acid" : "text-ink"}`}>
                {p.player}
              </span>
              {p.banker && <Banker />}
            </div>
            <StrengthMeter value={strengthFromOdds(p.fairOdds, p.strength)} size="sm" />
          </div>
          <p className="mt-1 text-[0.82rem] leading-snug text-muted">{p.note}</p>
        </li>
      ))}
    </ul>
  );
}

function Lineup({ team, flag, xi }: { team: string; flag: string; xi: string }) {
  return (
    <div className="rounded-xl border border-line bg-card/40 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-lg">{flag}</span>
        <span className="font-display text-sm font-bold uppercase tracking-wide text-ink">{team}</span>
      </div>
      <p className="text-sm leading-relaxed text-muted">{xi}</p>
    </div>
  );
}
