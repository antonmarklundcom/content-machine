# Phase S18 — Facts import + hooks library. Opus 5.5 low session. Lane 2, runs in parallel with the other S13–S19 phases.

Read ONLY: this file, `PLAN.md` §1 (items 39+), §2, §4, §1.48, §6.S18, the phase table and §9 index,
and `docs/log/<dep>.md` for each phase in Depends on: O11. Do not read the archived plans.
Execute under the autonomy protocol §4. Build nothing outside the plan.

Owns (the only paths you may create or modify, plus the §4.9 exceptions):
`scripts/facts-import.ts` (new), `src/lib/facts/import.ts` (new), `src/app/facts/**`, `src/app/hooks/**` (new), `src/components/{Fact,Hook}*.tsx`, `src/lib/facts.actions.ts`, `src/lib/i18n/dict/facts.ts`, `tests/integration/facts-import.test.ts`, `docs/log/s18.md`

Lane 2 hard limits (§4.7): no schema, migration, auth, spend-cap or `src/lib/ai.ts` changes.
Data only through `src/lib/bridge/`, O10's `src/lib/storage/` + `src/lib/media/`, and O11's
`src/lib/posts/`. Blocked by a limit → workaround + a §10 line in your log, keep going.

Budget: one session, ≤ 90 min. When the exit criteria pass, open the PR that turn (§4.13).

Phase rules:
- Branch `phase/s18-facts-hooks` off latest main (or the harness's `claude/…` branch). WIP commit every 30 min.
- Skills: none.
- The fixture is already on main: `tests/fixtures/paraguayresidency-facts.ts.txt` (5 facts, the real file shape; `.txt` so root typecheck/lint skip it). Cloud sessions cannot clone paraguayresidency, so never try; the live source for `--source` is its raw GitHub URL, read over HTTPS at run time on Anton's PC.
- Unverified facts store the hedged text; the facts page shows a visible 'unverified' badge.
- `/hooks` reuses `lessons`; no new table.
- Re-runnable: check what exists first, continue from the first unmet exit criterion.
  Minor issues → `docs/log/s18.md`; stop only per §4.4.

Exit (§6.S18): import test passes; verify green; PR merged. Screenshots: CI artifact only.

## After this phase
Follow `prompts/_handoff.md`. Spawn S20 only if every other lane 2 PR is merged and S20 has not started (see `_handoff.md`).
