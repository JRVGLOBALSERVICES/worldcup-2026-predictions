import type { Fixture, Prediction, Pick, Resolution } from "@/lib/types";
import { strengthFromOdds, strengthLabel, overallStrength } from "@/lib/data";
import { SectionLabel, Banker, Confidence, StrengthMeter } from "./atoms";
import { LiveLineup } from "./LiveLineup";

/** Split a penalty-likelihood string into a short grade token + optional reason.
 * Data is inconsistent: most are a bare grade ("medium", "low-medium"), but some
 * pack a full sentence after a dash ("medium — Senegal's attacking edge…"). The
 * pill must only ever carry the short grade, or a long value blows out the row
 * width and forces page-wide horizontal scroll on mobile. */
function splitLikelihood(raw: string): { grade: string; reason: string } {
  const m = (raw ?? "").match(/^\s*(.+?)\s*(?:—|–|-{1,2}|:)\s+(.+)$/);
  if (m) return { grade: m[1].trim(), reason: m[2].trim() };
  return { grade: (raw ?? "").trim(), reason: "" };
}

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
          big={pred.htft.pick.replace(/\s*\/\s*/g, " → ")}
          strength={strengthFromOdds(pred.htft.fairOdds, pred.htft.strength)}
        />
      </div>

      {/* knockout: how the tie is settled — 90 / extra time / penalties */}
      {pred.resolution && <ResolutionPanel res={pred.resolution} />}

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
      {(() => {
        const { grade, reason } = splitLikelihood(pred.penalty.likelihood);
        return (
          <div className="rounded-2xl border border-amber/40 bg-amber/[0.06] p-5">
            <div className="mb-2 flex items-center justify-between gap-3">
              <SectionLabel>Penalty</SectionLabel>
              <span className="tnum inline-flex max-w-[55%] shrink-0 items-center truncate rounded-full border border-amber/50 px-2 py-0.5 font-mono text-[0.72rem] uppercase leading-none text-amber">
                {grade}
              </span>
            </div>
            {reason && <p className="mb-2 text-sm leading-relaxed text-muted">{reason}</p>}
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-sm text-muted">Taker</span>
              <span className="font-display text-xl font-extrabold uppercase tracking-tight text-amber">
                {pred.penalty.taker}
              </span>
              <span className="text-sm text-faint">backup: {pred.penalty.backup}</span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted">{pred.penalty.note}</p>
          </div>
        );
      })()}

      {/* lineups — formation board */}
      <LiveLineup fixture={fixture} lineups={pred.lineups} />

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

/** Knockout-only: a single segmented route-bar — regulation / extra time /
 * penalties — with the most-likely route leading in the acid accent. One bar,
 * three semantic colours (acid → amber → rose), not three identical cards. */
function ResolutionPanel({ res }: { res: Resolution }) {
  const routes = [
    { key: "Regulation", sub: "decided in 90", pct: res.ninety, bar: "bg-acid", text: "text-acid", chip: "border-acid-dim text-acid" },
    { key: "Extra time", sub: "level at 90", pct: res.extraTime, bar: "bg-amber", text: "text-amber", chip: "border-amber/50 text-amber" },
    { key: "Penalties", sub: "level at 120", pct: res.penalties, bar: "bg-rose-400", text: "text-rose-300", chip: "border-rose-400/50 text-rose-300" },
  ] as const;
  return (
    <div className="rounded-2xl border border-line bg-card/50 p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <SectionLabel>How it&apos;s settled</SectionLabel>
        <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 font-mono text-[0.72rem] uppercase leading-none ${routes.find((r) => r.key === res.mostLikely)?.chip ?? "border-line text-muted"}`}>
          {res.mostLikely}
        </span>
      </div>

      {/* one segmented bar — width = probability of each route */}
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-line/60">
        {routes.map((r) => (
          <div key={r.key} className={r.bar} style={{ width: `${r.pct}%` }} aria-label={`${r.key} ${r.pct}%`} />
        ))}
      </div>

      {/* the three routes as a legend row — number leading, label under */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        {routes.map((r) => (
          <div key={r.key}>
            <div className={`tnum font-display text-2xl font-extrabold leading-none tracking-tight ${r.text}`}>
              {r.pct}%
            </div>
            <div className="mt-1 text-[0.82rem] font-semibold text-ink">{r.key}</div>
            <div className="text-[0.72rem] text-faint">{r.sub}</div>
          </div>
        ))}
      </div>

      <p className="mt-4 text-sm leading-relaxed text-muted">{res.note}</p>

      {/* extra-time favourite + shootout read */}
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 border-t border-line pt-3 text-sm">
        <span className="text-muted">
          <span className="text-faint">If extra time: </span>
          <span className="font-semibold text-ink">{res.etWinner}</span> favoured
        </span>
        <span className="text-muted">
          <span className="text-faint">Shootout: </span>
          {res.shootout}
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
