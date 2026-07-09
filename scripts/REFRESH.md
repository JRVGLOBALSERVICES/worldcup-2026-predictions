# Prediction refresh runbook (Friday)

This is the procedure the scheduled Friday spawn follows to keep predictions current.
Repo lives at `/root/repos/worldcup-2026` on the VPS.

## Model baseline (deterministic — run FIRST, every refresh)

`scripts/build-predictions.mjs` generates a full `Prediction` for **every
not-yet-finished fixture** from data the tournament already produced — no web
search, no blank knockout matches. This is the floor: a match always has a
proper scoreline / scorers / 1X2 call.

```
node scripts/build-results.mjs && node scripts/build-standings.mjs && \
node scripts/build-stats.mjs && node scripts/build-odds.mjs && \
node scripts/build-predictions.mjs
```

`build-odds.mjs` pulls real bookmaker prices into `data/odds.json` (powers the
Value Spot). It hits 1xBet's open LineFeed API (`Get1x2_VZip`) — **no auth, the
only gate is geography**: the feed 302→/block any US-flagged egress, which this
VPS is. So it is FAIL-SOFT: on a geo-block it writes nothing new, logs the
reason, exits 0 (the chain never breaks). To turn the live 1xBet pull on, give
it a non-US egress via env before the call:
  • `ONEXBET_BASE`  — a 1xBet base reachable from a MY/SG/etc. IP, or
  • `HTTPS_PROXY`   — a CONNECT proxy in a 1xBet-allowed geo.
Meanwhile `data/odds-manual.json` (hand-captured real prices, honest `source`
label per entry) fills any fixture the live pull didn't — a live 1xBet price
always overrides the manual one.

### The Brain (per-match, deterministic — added 2026-06-28)

`build-predictions.mjs` now also attaches **The Brain** to every upcoming call
(thelocktalk framework deck): a **Pitch Report** (10-point structured read), a
**Value Spot** (model vs the real `odds.json` price — implied → fair → edge), and
a **TRAP Detector** (7-flag weak-bet filter → PLAYABLE / LEAN / PASS). Strictly
additive: it aligns each layer to the prediction's own `win.pick`, so a
hand-researched call keeps its headline and just gains the three layers. Rendered
by `components/BrainPanel.tsx` on every `/match/[id]`.

The model (bivariate Poisson) reads `standings.json` (group GF/GA/pts/form),
`results.json` (goal baseline) and `stats.json` (real per-team scorers) →
expected goals per side → most-likely score, win/draw/loss fair odds, anytime
scorer/assist odds (regressed + capped so a hot 2-game striker isn't priced at
1.04). It is **strictly additive**: finished matches keep their researched
calls, and any upcoming match already carrying a **confirmed** XI (near-kickoff
hand research) is left untouched. Sanity-check the engine any time with
`node scripts/build-predictions.mjs --backtest` (scores it on finished games).

The web-search research steps below now **enrich** the model baseline near
kickoff (confirmed XIs, injury/suspension news, set-piece/penalty takers) — they
are no longer what stops a knockout match from being blank.

## Daily refresh (runs ~08:00 MYT)

1. Run the model baseline above so every upcoming fixture has a prediction.
2. From `data/fixtures.json`, find every fixture whose MYT match-day is **today or
   tomorrow** and that is not yet finished.
2. For each, spawn a research agent (one per match, in parallel) that does live web
   search on BOTH squads: probable XI, injuries/suspensions/squad news, recent form,
   set-piece + penalty takers. It returns the `Prediction` JSON shape (see
   `lib/types.ts`).
3. Merge results into `data/predictions.json` under the correct `matchId`. Set
   `meta.generatedAt` to now (ISO). Keep older days' predictions intact.
4. `npm run build` to verify it compiles, then commit + push:
   `git commit -am "data: predictions refresh <date>" && git push`.
   Vercel auto-deploys from `main`.
5. Post a WhatsApp summary to Rj (jid `47687122567393@lid`, `admin_override:true`)
   with today's headline picks + the live URL.

## Near-kickoff refresh (match days, ~90 min before each KO)

1. For matches kicking off in the next ~2h, re-run the research agent with an
   emphasis on **confirmed** line-ups.
2. If the XI is confirmed, set `lineups.status: "confirmed"` and tighten the
   scorer/assist/penalty picks to the actual starters.
3. Build, commit, push. Optionally ping Rj only if a pick materially changed.

## Result settlement — the Bet Tracker (`/tracker`)

`data/bets.json` holds Rj's correct-score slip and a `results` map keyed by
`matchId`. The tracker page settles each bet (won/lost/pending) by comparing the
bet's `home`/`away` target to the real score, so **the cron must fill real scores
in** for the tracker to settle.

> **Auto-settle (deterministic, since 2026-06-18).** `scripts/build-results.mjs`
> now ALSO settles `bets.json` straight from ESPN — it fills `results.<id>.ht/ft`
> and `matchEvents.<id>` (goals + cards) for any **finished** fixture on the slip.
> This closes the timing hole where a match finished between hourly cron passes
> and sat on "Awaiting result". It is strictly **additive**: it only fills empty
> slots, never overwrites a score or a richer AI-filled goal list (assists), and
> never touches a special's `statusOverride`. So just running the snapshotter
> settles the slip; the AI steps below are now only for **enrichment** (assists
> ESPN omits, a mis-scrape correction) — not for the core settle. Run it on a
> tight cadence on match days and the tracker flips Won/Lost at full time.

On every refresh run, for any match in `data/bets.json.results` that has **kicked
off or finished**, do live web search for the score and update its entry:

- At/after half-time → set `results.<matchId>.ht = { "home": H, "away": A }`
  (goals in **home–away** order, exactly as the fixture lists home/away — note
  Colombia is the *away* side vs Uzbekistan).
- At/after full-time → set `results.<matchId>.ft = { "home": H, "away": A }`.
- Leave `null` until that period's score is real. Never guess a score.

### Player-prop specials auto-settle — fill `matchEvents` after full-time

The `/tracker` specials (real 1xBet player props on Portugal v DR Congo) are
**no longer hand-flipped**. They carry a machine `grade` rule and settle off
`data/bets.json.matchEvents` automatically. The cron's only job after a match
ends is to **scrape the goal-by-goal events and fill them in** — the grader
(`lib/bets.ts gradeSpecial`) does the rest.

When a match with specials is **finished**, do live web search (BBC/FIFA/
Flashscore/ESPN match report) for the full goal list, then set
`matchEvents.<matchId>`:

```json
"por-drc-2026-06-17": {
  "status": "finished",
  "goals": [
    { "team": "home", "scorer": "Cristiano Ronaldo", "minute": 12, "assist": null, "penalty": true },
    { "team": "home", "scorer": "Rafael Leao", "minute": 34, "assist": "Bruno Fernandes" }
  ]
}
```

Rules for `matchEvents`:
- `goals` MUST be in **chronological scoring order** — the grader treats the
  first non-own-goal as the *first scorer*.
- `team` is `"home"`/`"away"` relative to how the fixture lists the sides.
- Use **full player names** (the matcher is loose: "Ronaldo" ⊆ "Cristiano
  Ronaldo"), include `assist` (full name or `null`), and set `freeKick: true`
  ONLY for a goal scored directly from a free kick, `penalty`/`ownGoal` as they
  apply.
- Set `status: "finished"` only once the match is actually over. Until then the
  specials stay `pending` — never fill events for a match that hasn't ended.
- Also fill `results.<matchId>.ft` (above) so score-dependent specials grade.
- If a scrape is wrong and a line settled incorrectly, set `statusOverride`
  ("won"/"lost") on that special to hand-correct it.

Then `npm run build`, commit (`data: settle bet results <date>`), push. Vercel
redeploys and the tracker flips BOTH the correct-score lines and the player
props to Won (green) / Lost (red) — no manual grading. When all four matches
are final, post Rj a one-line settled summary (W/L count + net P&L from the
tracker totals).

## Result snapshot for the match-page verdict (`data/results.json`)

The match page renders a **"How the call landed"** verdict block (`components/Verdict.tsx`)
grading each AI market against the real result, market by market, plus which named
scorers actually scored. It reads `data/results.json`, which persists FT score +
goal list past the live-feed window (so a verdict stays on the page for days). A
deterministic script pulls this straight from ESPN — never hand-edit it:

    node scripts/build-results.mjs           # write data/results.json
    node scripts/build-results.mjs --check    # report only (exit 2 on change)

On every refresh/settlement run, run `node scripts/build-results.mjs` alongside the
bets settlement above, then build/commit/push. It only writes kicked-off matches
(live + finished); scheduled matches stay absent so pre-match pages stay static.
Same ALIAS/normalise rules as `lib/live.ts` — keep the three ALIAS maps
(`lib/live.ts`, `verify-fixtures-espn.mjs`, `build-results.mjs`) in sync.

## Daily fixture-time check vs ESPN (06:00 MYT, automatic)

The whole app derives MYT + ET display from each fixture's `kickoffUTC`, so a
wrong UTC value shows a wrong time everywhere. To prevent drift, a deterministic
script reconciles every fixture against ESPN's official FIFA feed:

    node scripts/verify-fixtures-espn.mjs          # dry-run, report drift
    node scripts/verify-fixtures-espn.mjs --write   # correct kickoffUTC in place

It matches fixtures to ESPN events by team name (same ALIAS/normalise rules as
`lib/live.ts` — keep the two ALIAS maps in sync) and treats ESPN as truth. The
bridge cron **"WC2026 daily fixture-time check vs ESPN"** (`0 6 * * *` MYT) runs
it with `--write`, and only builds/commits/pushes + messages Rj when something
actually changed (or a fixture can't be matched to ESPN — that needs a new
ALIAS entry). Clean days are silent. Do NOT hand-edit kickoff times; let the
script own them.

## Tournament stat leaderboards (`data/stats.json`, the `/stats` page)

The leaderboards (rendered on `/standings`) are ten top-10 boards (scorers,
assists, clean sheets, yellow cards, red cards, penalties scored, penalties
missed, tackles, blocks, keeper saves). A deterministic script pulls them from
ESPN — never hand-edit `data/stats.json`:

    node scripts/build-stats.mjs            # write data/stats.json
    node scripts/build-stats.mjs --check     # report only (exit 2 on change)

Sources: season `/statistics` leaders (scorers + assists, with appearances);
per-date scoreboard `competitions[].details` (yellow/red cards, penalties scored,
clean sheets from final scores); per-match `/summary` `keyEvents` for penalties
missed + `rosters` for who featured and per-keeper saves (cached per event so the
cron only fetches each match's summary once); the **core API** per-athlete event
statistics for tackles + blocks (the only keyless per-player source — swept once
per finished match, frozen under `coreDone`). The core host 403-bans an IP after
a ~1000-request burst, so the sweep runs 6-wide, caps at 800 fetches/run, and
bails on consecutive 403s — failed players stay `null` (never counted as 0) and
retry next run until the backfill converges.
Same ALIAS/normalise rules as `lib/live.ts` — keep the ALIAS maps in sync.

The hourly **WC2026 result settlement** cron runs this right after
`build-results.mjs`, so the boards refresh in the same commit. Change-detection
ignores the timestamp + the penalty-miss cache, so a no-op run is silent.

## Notes

- Predictions are reasoned estimates, not live odds — keep the disclaimer intact.
- `matchId` = `<home3>-<away3>-<YYYY-MM-DD>` (slug = first 3 letters, a–z only).
- Never delete prior predictions; only add/update.
- Bet results in `bets.json` are FACTS (real final scores) — only ever fill them
  from a verified live source, never from the prediction model.
