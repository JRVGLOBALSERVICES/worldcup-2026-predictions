import type { MatchForm, TeamForm, FormLeader } from "@/lib/form";
import { SectionLabel } from "./atoms";

/**
 * Pre-match "form going in" panel for the prediction pages — for each side, the
 * players who featured in that team's LAST game, as simple leaderboards (top
 * shooters, on-target, tacklers, keeper saves) with a projection for the next
 * game. Server-rendered from lib/form (data/results.json), so it's static and
 * matches everywhere.
 */
export function FormProjection({ form }: { form: MatchForm }) {
  if (!form) return null;
  return (
    <div>
      <SectionLabel>Form going in — last game & projection</SectionLabel>
      <div className="grid gap-4 sm:grid-cols-2">
        <TeamCard team={form.home} tone="acid" />
        <TeamCard team={form.away} tone="mint" />
      </div>
      <p className="mt-3 font-mono text-[0.6rem] uppercase tracking-[0.14em] text-ink/35">
        Last = that stat in the team&apos;s last game · Next ≈ projection for this match
        (recency-weighted average) · (n) = ceiling, their best single game
      </p>
    </div>
  );
}

const RESULT_TONE: Record<"W" | "D" | "L", string> = {
  W: "border-acid-dim text-acid",
  D: "border-line text-muted",
  L: "border-rose-400/50 text-rose-300",
};

function TeamCard({ team, tone }: { team: TeamForm; tone: "acid" | "mint" }) {
  const accent = tone === "acid" ? "text-acid" : "text-mint";
  return (
    <div className="rounded-2xl border border-line bg-card/50 p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden className="text-lg leading-none">{team.flag}</span>
          <span className={`truncate font-display text-lg font-black uppercase leading-none tracking-tight ${accent}`}>
            {team.team}
          </span>
        </div>
        {team.lastMatch && (
          <span
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[0.66rem] leading-none ${RESULT_TONE[team.lastMatch.result]}`}
          >
            {team.lastMatch.result} {team.lastMatch.scoreLine}
            <span className="text-faint">
              v {team.lastMatch.opponentFlag}
            </span>
          </span>
        )}
      </div>

      {team.lastMatch ? (
        <div className="space-y-4">
          <Board title="Shots" unit="sh" rows={team.shooters} accent={accent} />
          <Board title="On target" unit="on" rows={team.onTarget} accent={accent} />
          <Board title="Tackles" unit="tk" rows={team.tacklers} accent={accent} />
          <Board title="Keeper saves" unit="sv" rows={team.keepers} accent={accent} />
        </div>
      ) : (
        <p className="text-sm text-muted">No completed match yet.</p>
      )}
    </div>
  );
}

function Board({
  title,
  unit,
  rows,
  accent,
}: {
  title: string;
  unit: string;
  rows: FormLeader[];
  accent: string;
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="font-mono text-[0.62rem] font-bold uppercase tracking-[0.16em] text-faint">
          {title}
        </span>
        <span className="font-mono text-[0.55rem] uppercase tracking-[0.12em] text-ink/30">
          last · next
        </span>
      </div>
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.name} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-baseline gap-1.5">
              {r.num != null && (
                <span className="tnum shrink-0 font-mono text-[0.62rem] text-faint">{r.num}</span>
              )}
              <span className="truncate text-[0.84rem] text-ink">{r.name}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2.5 font-mono text-[0.72rem] leading-none">
              <span className="tnum text-muted">
                {r.last}
                <span className="ml-0.5 text-[0.6rem] text-faint">{unit}</span>
              </span>
              <span className={`tnum ${accent}`}>
                ≈{r.proj}
                {r.high > r.proj && (
                  <span className="ml-0.5 text-[0.6rem] text-faint">({r.high})</span>
                )}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
