# Prediction refresh runbook (Friday)

This is the procedure the scheduled Friday spawn follows to keep predictions current.
Repo lives at `/root/repos/worldcup-2026` on the VPS.

## Daily refresh (runs ~08:00 MYT)

1. From `data/fixtures.json`, find every fixture whose MYT match-day is **today or
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

## Notes

- Predictions are reasoned estimates, not live odds — keep the disclaimer intact.
- `matchId` = `<home3>-<away3>-<YYYY-MM-DD>` (slug = first 3 letters, a–z only).
- Never delete prior predictions; only add/update.
- Bet results in `bets.json` are FACTS (real final scores) — only ever fill them
  from a verified live source, never from the prediction model.
