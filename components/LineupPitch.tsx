import type { Fixture, LineupXI, Prediction } from "@/lib/types";
import { StatusBadge } from "./atoms";

/* ─────────────────────────────────────────────────────────────────────────
 * LineupPitch — a real formation board (FotMob/ESPN style), not a name list.
 *
 * Two data paths:
 *   1. CONFIRMED XI (lineups.homeXI/awayXI) — lifted from ESPN's published team
 *      sheet by scripts/build-lineups.mjs. Carries the REAL formation, REAL shirt
 *      numbers and per-player position codes (CD-L, LB, AM-R, F …). We band each
 *      player by position to order them back-to-front / left-to-right, then chunk
 *      by the formation's row sizes so the board reads true.
 *   2. PROBABLE XI (lineups.home/away strings) — the pre-match research guess, no
 *      real numbers. We infer a shape from the name order and badge players with
 *      conventional POSITIONAL numbers, clearly labelled as such.
 * ──────────────────────────────────────────────────────────────────────── */

type Slot = { name: string; surname: string; number: number | null };
type Shape = { gk: Slot | null; lines: Slot[][]; formation: string };

// Nobiliary particles that belong WITH the surname ("De Bruyne", "van Dijk",
// "Van der Berg"). Without this, last-word-only clips them to "Bruyne"/"Dijk".
const PARTICLES = new Set([
  "de", "del", "della", "di", "da", "das", "dos", "van", "von", "der", "den",
  "ten", "ter", "la", "le", "du", "bin", "al", "af", "y", "e", "el", "abu",
]);

function surnameOf(full: string): string {
  const parts = full.trim().split(/\s+/);
  if (parts.length <= 1) return full;
  let i = parts.length - 1;
  // Walk left over particles, but never consume the first-name token.
  while (i - 1 >= 1 && PARTICLES.has(parts[i - 1].toLowerCase())) i--;
  return parts.slice(i).join(" ") || full;
}

/* ── Path 1: real confirmed XI ─────────────────────────────────────────── */

// Vertical band of a position code, back (0) → front (4). Used only to ORDER
// players; the formation string sets the actual row boundaries.
function bandRank(pos: string): number {
  const base = pos.toUpperCase().replace(/[-\s]?[LRC]$/, "");
  if (base === "G" || base === "GK") return 0;
  if (/^(D|CD|CB|LB|RB|LWB|RWB|WB|SW|RCB|LCB|FB)$/.test(base)) return 1;
  if (/^(DM|CDM|DMF|M|CM|LM|RM|MF|RDM|LDM|RCM|LCM)$/.test(base)) return 2;
  if (/^(AM|CAM|AMF|SS)$/.test(base)) return 3;
  return 4; // F, CF, ST, FW, LW, RW, W, LF, RF, …
}

// Left (0) → right (4) ordering within a band, from the position code.
function sideScore(pos: string): number {
  const m = pos.toUpperCase().match(/-?([LRC])$/);
  const suffix = m ? m[1] : "";
  const base = pos.toUpperCase().replace(/[-\s]?[LRC]$/, "");
  if (/^L/.test(base)) return 0; // LB, LM, LW, LWB…
  if (/^R/.test(base)) return 4; // RB, RM, RW, RWB…
  if (suffix === "L") return 1;
  if (suffix === "R") return 3;
  return 2; // central / unmarked
}

function shapeFromXI(xi: LineupXI): Shape {
  const slots: (Slot & { pos: string })[] = xi.players.map((p) => ({
    name: p.name,
    surname: surnameOf(p.name),
    number: p.num,
    pos: p.pos,
  }));

  const gk = slots.find((s) => bandRank(s.pos) === 0) ?? slots[0] ?? null;
  const outfield = slots.filter((s) => s !== gk);

  const sorted = outfield
    .map((s, i) => ({ s, i }))
    .sort(
      (a, b) =>
        bandRank(a.s.pos) - bandRank(b.s.pos) ||
        sideScore(a.s.pos) - sideScore(b.s.pos) ||
        a.i - b.i,
    )
    .map((x) => x.s);

  // Row sizes come from the real formation; only if they don't add up (odd data)
  // do we fall back to grouping by the position bands themselves.
  let rows = (xi.formation || "").split("-").map(Number).filter((n) => n > 0);
  if (rows.reduce((a, b) => a + b, 0) !== sorted.length) {
    const byBand: Record<number, number> = {};
    for (const s of sorted) byBand[bandRank(s.pos)] = (byBand[bandRank(s.pos)] ?? 0) + 1;
    rows = Object.keys(byBand)
      .sort()
      .map((k) => byBand[Number(k)]);
  }

  const lines: Slot[][] = [];
  let c = 0;
  for (const n of rows) {
    lines.push(sorted.slice(c, c + n).map(({ name, surname, number }) => ({ name, surname, number })));
    c += n;
  }
  return { gk: gk ? { name: gk.name, surname: gk.surname, number: gk.number } : null, lines, formation: xi.formation };
}

/* ── Path 2: probable XI from a name string (fallback) ──────────────────── */

// Real formations for full/partial XIs; defence-heavy even split otherwise.
function lineSplit(outfield: number): number[] {
  const known: Record<number, number[]> = {
    10: [4, 3, 3], 9: [4, 3, 2], 8: [3, 3, 2], 7: [3, 2, 2],
    6: [3, 2, 1], 5: [2, 2, 1], 4: [2, 1, 1], 3: [1, 1, 1], 2: [1, 1], 1: [1],
  };
  if (known[outfield]) return known[outfield];
  const base = Math.floor(outfield / 3);
  const lines = [base, base, base];
  let rem = outfield - base * 3;
  for (let i = 0; rem > 0; i++, rem--) lines[i % 3]++;
  return lines.filter((n) => n > 0);
}

// Parse a line-up string into a keeper + ordered outfield lines. Semi-structured:
// lines may be ";"-separated (GK first), the formation may sit as a "3-5-2:" prefix
// or "(4-2-3-1)" suffix, and trailing bench/injury notes hang off a " - ".
function parseLineup(raw: string): { gk: string; lines: string[][]; formation: string } {
  let s = (raw || "").trim();
  if (!s) return { gk: "", lines: [], formation: "" };

  // Drop trailing bench/injury notes (" - …").
  s = s.split(/\s[-–—]\s/)[0].trim();

  // A formation can sit as a "3-5-2:" prefix, inside "(4-2-3-1)", or behind a
  // team-name label like "Bosnia (4-4-2):". Grab the first formation token, then
  // strip a leading "<label>:" prefix, any parentheticals, and a leftover bare
  // formation token so only the player names remain.
  let formation = "";
  const fm = s.match(/(\d(?:-\d){1,3})/);
  if (fm) formation = fm[1];
  s = s.replace(/^[^:]{0,40}:\s*/, "");
  s = s.replace(/\([^)]*\)/g, " ").trim();
  s = s.replace(/^\s*\d(?:-\d){1,3}\s*/, "").trim();

  // Build a semicolon grouping AND a fully-flat name list (split on ; or ,).
  const semiGroups = s
    .split(";")
    .map((g) => g.split(",").map((x) => x.trim()).filter(Boolean))
    .filter((g) => g.length);
  const flat = s.split(/[;,]/).map((x) => x.trim()).filter(Boolean);

  // Trust the semicolon grouping ONLY when it reads like real formation lines: a
  // lone keeper, then 2–4 outfield rows of 1–5 each. Strings that put a ";"
  // between EVERY player (→ 10 one-man rows / "1-1-1-1…") or only after the GK
  // (→ one 10-man row) fail this and fall back to formation/lineSplit chunking.
  const outGroups = semiGroups.slice(1);
  const validGrouping =
    semiGroups.length >= 3 &&
    semiGroups[0].length === 1 &&
    outGroups.length >= 2 &&
    outGroups.length <= 4 &&
    outGroups.every((g) => g.length >= 1 && g.length <= 5);

  let gk = "";
  let lines: string[][] = [];
  if (validGrouping) {
    gk = semiGroups[0][0];
    lines = outGroups;
  } else {
    gk = flat.shift() ?? "";
    const fRows = formation.split("-").map(Number).filter((n) => n > 0);
    const rows = fRows.reduce((a, b) => a + b, 0) === flat.length ? fRows : lineSplit(flat.length);
    let cursor = 0;
    for (const count of rows) {
      lines.push(flat.slice(cursor, cursor + count));
      cursor += count;
    }
  }

  if (!formation) formation = lines.map((l) => l.length).join("-");
  return { gk, lines, formation };
}

// Conventional role numbers per line, de-duped within a team.
function buildShape(xi: string): Shape {
  const { gk: keeper, lines: rawLines, formation } = parseLineup(xi);
  if (!keeper && rawLines.length === 0) return { gk: null, lines: [], formation: "" };

  const used = new Set<number>();
  const take = (pool: number[], i: number) => {
    let n = pool[i] ?? 12;
    while (used.has(n)) n++;
    used.add(n);
    return n;
  };
  const mk = (name: string, pool: number[], i: number): Slot => ({
    name,
    surname: surnameOf(name),
    number: take(pool, i),
  });

  const pools = [
    [2, 5, 4, 3, 6],
    [6, 8, 10, 14, 16],
    [7, 9, 11, 17, 19],
  ];
  const poolFor = (li: number, total: number) => (li === 0 ? 0 : li === total - 1 ? 2 : 1);

  const gk = keeper ? mk(keeper, [1], 0) : null;
  const lines: Slot[][] = rawLines.map((row, li) =>
    row.map((name, i) => mk(name, pools[poolFor(li, rawLines.length)], i)),
  );

  return { gk, lines, formation };
}

/* ── Render ─────────────────────────────────────────────────────────────── */

function Disc({ slot, tone }: { slot: Slot; tone: "home" | "away" | "gk" }) {
  const skin =
    tone === "gk"
      ? "bg-amber text-pitch ring-1 ring-amber/40"
      : tone === "home"
        ? "bg-acid text-on-acid ring-1 ring-acid/40"
        : "bg-mint text-pitch ring-1 ring-mint/40";
  return (
    <div className="flex w-[4.2rem] flex-col items-center gap-1" title={slot.name}>
      <span
        className={`tnum grid size-8 place-items-center rounded-full font-mono text-[0.72rem] font-bold shadow-[0_1px_4px_rgba(0,0,0,0.45)] sm:size-9 ${skin}`}
        aria-hidden
      >
        {slot.number ?? ""}
      </span>
      <span className="line-clamp-2 max-w-full rounded bg-pitch/65 px-1 text-center text-[0.56rem] font-medium leading-[1.05] text-ink">
        {slot.surname}
      </span>
    </div>
  );
}

function Half({ shape, tone, attackUp }: { shape: Shape; tone: "home" | "away"; attackUp: boolean }) {
  const rows = attackUp ? [...shape.lines].reverse() : shape.lines;
  const gkRow = shape.gk ? (
    <div className="flex justify-center">
      <Disc slot={shape.gk} tone="gk" />
    </div>
  ) : null;

  return (
    <div className="flex flex-1 flex-col justify-between py-2">
      {attackUp ? null : gkRow}
      {rows.map((row, i) => (
        <div key={i} className="flex justify-around px-1">
          {row.map((slot, j) => (
            <Disc key={`${slot.surname}-${slot.number ?? j}`} slot={slot} tone={tone} />
          ))}
        </div>
      ))}
      {attackUp ? gkRow : null}
    </div>
  );
}

function TeamTag({ flag, name, formation, align }: { flag: string; name: string; formation: string; align: "start" | "end" }) {
  return (
    <div className={`flex items-center gap-2 ${align === "end" ? "justify-end" : ""}`}>
      <span className="text-base leading-none">{flag}</span>
      <span className="font-display text-sm font-bold uppercase tracking-wide text-ink">{name}</span>
      {formation && (
        <span className="tnum rounded-full border border-line px-1.5 py-0.5 font-mono text-[0.6rem] tracking-wider text-faint">
          {formation}
        </span>
      )}
    </div>
  );
}

export function LineupPitch({ fixture, lineups }: { fixture: Fixture; lineups: Prediction["lineups"] }) {
  // Prefer the confirmed XI (real numbers + formation); fall back to the probable
  // name-string shape (conventional positional numbers) when ESPN hasn't published.
  const home = lineups.homeXI ? shapeFromXI(lineups.homeXI) : buildShape(lineups.home);
  const away = lineups.awayXI ? shapeFromXI(lineups.awayXI) : buildShape(lineups.away);
  const realNumbers = Boolean(lineups.homeXI && lineups.awayXI);

  const label =
    lineups.status === "confirmed" ? "Confirmed line-ups" : lineups.status === "unconfirmed" ? "Line-ups (TBC)" : "Probable line-ups";

  if (!home.gk && !away.gk) {
    return <p className="text-sm text-muted">Line-ups not yet available.</p>;
  }

  return (
    <div className="rounded-2xl border border-line bg-card/40 p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-faint">{label}</h3>
        <StatusBadge status={lineups.status} />
      </div>

      <div className="mx-auto max-w-[360px]">
      <TeamTag flag={fixture.away.flag} name={fixture.away.name} formation={away.formation} align="start" />

      {/* The pitch */}
      <div
        className="relative my-2.5 w-full overflow-hidden rounded-xl border border-white/10"
        style={{
          aspectRatio: "5 / 7",
          background:
            "repeating-linear-gradient(180deg, oklch(0.33 0.052 158) 0px, oklch(0.33 0.052 158) 28px, oklch(0.30 0.05 158) 28px, oklch(0.30 0.05 158) 56px)",
        }}
        role="img"
        aria-label={`${fixture.home.name} versus ${fixture.away.name} line-ups`}
      >
        {/* markings */}
        <svg viewBox="0 0 100 140" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
          <g fill="none" stroke="oklch(1 0 0 / 0.22)" strokeWidth="0.5">
            <rect x="2" y="2" width="96" height="136" rx="1" />
            <line x1="2" y1="70" x2="98" y2="70" />
            <circle cx="50" cy="70" r="9" />
            <circle cx="50" cy="70" r="0.8" fill="oklch(1 0 0 / 0.3)" stroke="none" />
            {/* top (away) box */}
            <rect x="28" y="2" width="44" height="17" />
            <rect x="40" y="2" width="20" height="7" />
            <path d="M 38 19 A 12 12 0 0 0 62 19" />
            {/* bottom (home) box */}
            <rect x="28" y="121" width="44" height="17" />
            <rect x="40" y="131" width="20" height="7" />
            <path d="M 38 121 A 12 12 0 0 1 62 121" />
          </g>
        </svg>

        {/* players */}
        <div className="absolute inset-0 flex flex-col">
          <Half shape={away} tone="away" attackUp={false} />
          <Half shape={home} tone="home" attackUp={true} />
        </div>
      </div>

      <TeamTag flag={fixture.home.flag} name={fixture.home.name} formation={home.formation} align="end" />
      </div>

      <p className="mt-3 text-[0.62rem] leading-snug text-faint">
        {realNumbers
          ? "Confirmed XI — real shirt numbers, formation and positions from the official team sheet (ESPN)."
          : "Probable XI — numbers are positional, not squad numbers (GK 1 · 2/3 full-backs · 4/5 centre-backs · 6/8/10 spine · 7/9/11 front)."}
      </p>
    </div>
  );
}
