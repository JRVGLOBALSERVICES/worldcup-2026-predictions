#!/usr/bin/env bash
# Deterministic results auto-refresh — the thing that makes the tracker populate
# itself. Runs the generated-data build chain, and ONLY when a score-bearing
# value actually changed, commits + pushes (which triggers a Vercel redeploy so
# the static results.json the tracker settles off is fresh). No LLM in the loop.
#
# Scoped to the generated data files only — it never stages or reverts the
# hand-curated bet slips (data/bets*.json), so adding a slip by hand is safe
# even if a refresh fires mid-edit.
set -uo pipefail

REPO="/root/repos/worldcup-2026"
cd "$REPO" || exit 1
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"
LOG="$REPO/data/auto-refresh.log"
GEN="data/results.json data/standings.json data/stats.json data/odds.json data/predictions.json data/history.json data/acca-recs.json"

stamp() { date -u +%FT%TZ; }
log() { echo "$(stamp) $*" >> "$LOG"; }

# Only one refresh at a time (a slow ESPN fetch must not overlap the next tick).
exec 9>"$REPO/data/.auto-refresh.lock"
if ! flock -n 9; then
  log "skip — previous refresh still running"
  exit 0
fi

# Game-window gate — only refresh from 30 min before kickoff to 30 min after
# full time. Outside a live match nothing changes, so skip the whole build
# chain (and the redeploy it would trigger). Override with FORCE_REFRESH=1.
if [ "${FORCE_REFRESH:-0}" != "1" ]; then
  if ! window="$(node scripts/in-game-window.mjs 2>>"$LOG")"; then
    log "skip — $window"
    exit 0
  fi
  log "$window"
fi

before="$(node scripts/content-hash.mjs 2>>"$LOG")"

# Fail-soft chain — build-odds is already fail-soft on a geo-block; if any step
# errors we still re-hash and only commit a genuine change.
node scripts/build-results.mjs     >>"$LOG" 2>&1
node scripts/build-standings.mjs   >>"$LOG" 2>&1
node scripts/build-stats.mjs       >>"$LOG" 2>&1
node scripts/build-odds.mjs        >>"$LOG" 2>&1
node scripts/build-predictions.mjs >>"$LOG" 2>&1
node scripts/build-history.mjs     >>"$LOG" 2>&1
node scripts/build-acca-recs.mjs   >>"$LOG" 2>&1

after="$(node scripts/content-hash.mjs 2>>"$LOG")"

if [ -n "$before" ] && [ "$before" = "$after" ]; then
  # Timestamp-only churn — drop it so we don't spam redeploys.
  git checkout -- $GEN 2>>"$LOG"
  log "no meaningful change"
  exit 0
fi

git add $GEN 2>>"$LOG"
if git diff --cached --quiet; then
  log "no staged change after rebuild"
  exit 0
fi

git commit -q -m "data: auto-refresh results/standings/stats/predictions ($(stamp))" 2>>"$LOG"
if git push -q origin HEAD 2>>"$LOG"; then
  log "pushed refresh -> Vercel redeploy"
else
  log "PUSH FAILED — left commit local for next run"
fi
