import type { MatchForm, TeamForm, FormLeader } from "@/lib/form";
import { SectionLabel } from "./atoms";
import { Fragment } from "react";

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
      <SectionLabel>Form going in — last game &amp; what to expect</SectionLabel>
      <div className="grid gap-4 sm:grid-cols-2">
        <TeamCard team={form.home} tone="acid" />
        <TeamCard team={form.away} tone="mint" />
      </div>
      <p className="mt-3 text-[0.78rem] leading-relaxed text-ink/55">
        Each row reads left to right: how many the player managed in their{" "}
        <span className="text-ink/80">last game</span>, our{" "}
        <span className="text-acid">estimate for the next one</span>, and their{" "}
        <span className="text-ink/80">best in any single game</span> so far. The estimate
        leans on recent form (60% season average, 40% last game).
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
        <div className="space-y-5">
          <Board title="Shots" rows={team.shooters} accent={accent} />
          <Board title="Shots on target" rows={team.onTarget} accent={accent} />
          <Board title="Tackles" rows={team.tacklers} accent={accent} />
          <Board title="Keeper saves" rows={team.keepers} accent={accent} />
        </div>
      ) : (
        <p className="text-sm text-ink/50">No completed match yet.</p>
      )}
    </div>
  );
}

function Board({
  title,
  rows,
  accent,
}: {
  title: string;
  rows: FormLeader[];
  accent: string;
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h4 className="mb-2 font-mono text-[0.7rem] font-bold uppercase tracking-[0.14em] text-ink/60">
        {title}
      </h4>
      <div className="grid grid-cols-[1fr_auto_auto_auto] items-baseline gap-x-4 gap-y-1.5">
        <span aria-hidden />
        <span className="text-right text-[0.62rem] uppercase tracking-[0.1em] text-ink/40">Last</span>
        <span className={`text-right text-[0.62rem] uppercase tracking-[0.1em] ${accent}/90`}>Est</span>
        <span className="text-right text-[0.62rem] uppercase tracking-[0.1em] text-ink/40">Best</span>
        {rows.map((r) => (
          <Fragment key={r.name}>
            <span className="flex min-w-0 items-baseline gap-2">
              {r.num != null && (
                <span className="tnum w-5 shrink-0 text-right font-mono text-[0.72rem] text-ink/35">{r.num}</span>
              )}
              <span className="truncate text-[0.9rem] text-ink">{r.name}</span>
            </span>
            <span className="tnum text-right font-mono text-[0.92rem] text-ink/70">{r.last}</span>
            <span className={`tnum text-right font-mono text-[0.92rem] font-semibold ${accent}`}>{r.proj}</span>
            <span className="tnum text-right font-mono text-[0.92rem] text-ink/50">{r.high}</span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
