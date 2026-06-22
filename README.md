# Matchday Edge — World Cup 2026 Predictions

A daily-updating prediction web app for the 2026 FIFA World Cup. Every group-stage
fixture is called the way Rj bets it — **win, half-time & full-time score, anytime
scorers, anytime assists, and the penalty + likely taker** — all in **Malaysia time
(MYT)**, built from live team-news research on both squads and refreshed daily (and
again near kickoff when line-ups are confirmed).

Live: https://worldcup-2026-orpin-zeta.vercel.app

## Stack

- **Next.js 16** (App Router, Turbopack) + **React 19** — fully static/SSG; every
  match page is prerendered, the home page revalidates every 30 min (ISR) to re-pick
  "Today".
- **Tailwind v4** (CSS-first `@theme` tokens, OKLCH palette).
- **TypeScript**, `next/font` (Archivo + Geist + Geist Mono, self-hosted, zero CLS).
- **Vercel** hosting. No client 3D/WebGL — it's a data app, so it's fast and
  SEO-complete (real HTML, `SportsEvent` JSON-LD, sitemap, robots).

## Design system

Floodlit-pitch editorial — dark, broadcast-graphic feel, one accent doing the work.

| Token | Value | Role |
|-------|-------|------|
| `--color-pitch` | `oklch(0.17 0.015 160)` | near-black green base |
| `--color-card` | `oklch(0.235 0.018 165)` | surfaces |
| `--color-line` | `oklch(0.32 0.02 165)` | borders |
| `--color-ink` | `oklch(0.97 0.01 150)` | primary text |
| `--color-muted` / `--color-faint` | `oklch(0.72…)` / `oklch(0.56…)` | secondary text |
| `--color-acid` | `oklch(0.87 0.21 135)` | electric lime — picks, bankers, live |
| `--color-amber` | `oklch(0.81 0.15 72)` | penalties |

- **Type:** Archivo (800/900, uppercase, tight tracking) for display + team names;
  Geist for body; **Geist Mono with `tabular-nums`** for every odds figure and clock.
- **Motion:** restrained. One live `setInterval` countdown clock; `prefers-reduced-motion`
  honoured globally.
- Anti-AI-slop checks applied (`design-3d-stack.md` §anti-slop, §5, §8): no bento
  default, asymmetric editorial hero, single accent, OKLCH, specific copy.

## Data model

```
data/fixtures.json     — all 52 group-stage matches (kickoffs stored as UTC ISO;
                         the client renders MYT via Intl + Asia/Kuala_Lumpur)
data/predictions.json  — { meta, predictions: { <matchId>: Prediction } }
data/results.json      — { meta, results: { <matchId>: snapshotted final/live } }
data/stats.json        — { meta, categories } tournament leaderboards (see /stats)
```

A `Prediction` carries: `win`, `halfTime`, `fullTime`, `htft`, `scorers[]`,
`assists[]`, `penalty` (likelihood + taker + backup), `lineups` (probable XIs +
status), `playerNotes[]` (deep per-player research), `confidence`, `sources[]`.

`matchId` format: `<home3>-<away3>-<YYYY-MM-DD>`, e.g. `por-drc-2026-06-17`.

## How predictions are generated

Per fixture, deep live research on **both** squads — probable starting XI, injuries
/ suspensions / squad news, recent form, set-piece + penalty takers — via web search,
then reasoned analytical estimates (NOT live bookmaker prices) in Rj's fixed market
order. Example of live research changing the call: Ghana's Kudus (injury) and Partey
(visa) were ruled out, so Jordan Ayew became the banker scorer + penalty taker;
Colombia's Jhon Durán was dropped from the squad, moving Luis Suárez to lead the line.

### Daily / near-kickoff refresh

`scripts/build-fixtures.mjs` regenerates `data/fixtures.json` from a compact table.
Prediction refresh is driven by Friday (the WhatsApp bridge) on a schedule:
- **Daily** (morning MYT): regenerate predictions for that day's fixtures, commit, push
  → Vercel redeploys.
- **Near kickoff**: re-run the affected matches when confirmed XIs drop, flip
  `lineups.status` to `confirmed`, push.

See `scripts/REFRESH.md` for the operator runbook.

### Tournament stats (`/stats`)

Seven top-10 leaderboards — **top scorers, assists, clean sheets, yellow cards,
red cards, penalties scored, penalties missed** — built by
`scripts/build-stats.mjs` straight from ESPN's keyless FIFA World Cup feeds
(season `statistics` leaders for scorers/assists; per-date scoreboard `details`
for cards/penalties-scored/clean-sheets; per-match summary `keyEvents` for
penalties missed). It writes `data/stats.json`; the page is static + revalidates
every 30 min. The hourly result-settlement cron runs it alongside
`build-results.mjs`, so the boards stay live as matches finish. Clean sheets are
credited to the team that kept the opponent scoreless.

## Local dev

```bash
npm install
node scripts/build-fixtures.mjs   # (re)build fixtures.json
npm run dev                        # http://localhost:3000
npm run build && npm run start     # production build
```

## Disclaimer

All predictions are reasoned analytical estimates from research, **not** live
bookmaker prices. Fun-money only — always check the actual odds before staking.
