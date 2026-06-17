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

Then `npm run build`, commit (`data: settle bet results <date>`), push. Vercel
redeploys and the tracker flips the affected lines to Won (green) / Lost (red).
When all four matches are final, post Rj a one-line settled summary
(W/L count + net P&L from the tracker totals).

## Notes

- Predictions are reasoned estimates, not live odds — keep the disclaimer intact.
- `matchId` = `<home3>-<away3>-<YYYY-MM-DD>` (slug = first 3 letters, a–z only).
- Never delete prior predictions; only add/update.
- Bet results in `bets.json` are FACTS (real final scores) — only ever fill them
  from a verified live source, never from the prediction model.
