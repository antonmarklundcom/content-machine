# Phase S21 — IG competitors + weekly report. Opus 5.5 low session. Lane 3 (gated on PLAN.md §7).

Read ONLY: this file, `PLAN.md` §1 (items 39+), §2, §4, §6.S21, the phase table and §9 index,
and `docs/log/<dep>.md` for each phase in Depends on: O12. Do not read the archived plans.
Execute under the autonomy protocol §4. Build nothing outside the plan.

Owns (the only paths you may create or modify, plus the §4.9 exceptions):
`src/lib/meta/discovery.ts` (new), `src/app/research/instagram/**` (new), `src/components/IgCompetitor*.tsx` (new), `scripts/ig-competitors.ts` (new), `tests/integration/ig-competitors.test.ts`, `docs/log/s21.md`

Lane 3 hard limits (§4.7): no schema, migration, auth or spend-cap changes. The schema already
holds every column this phase needs (§2).

Budget: one session, ≤ 90 min. When the exit criteria pass, open the PR that turn (§4.13).

Phase rules:
- Branch `phase/s21-ig-competitors` off latest main (or the harness's `claude/…` branch). WIP commit every 30 min.
- Skills: none; Business Discovery API docs via WebFetch.
- Business Discovery only sees Business/Creator accounts; others are shown as 'not available'.
- Rank competitor posts against that competitor's own median engagement (same idea as §1.30).
- Fixtures only in tests.
- Re-runnable: check what exists first, continue from the first unmet exit criterion.
  Minor issues → `docs/log/s21.md`; stop only per §4.4.

Exit (§6.S21): fixture tests; verify green; PR merged. Screenshots: CI artifact only.

## After this phase
Follow `prompts/_handoff.md`. Spawn nothing; report.
