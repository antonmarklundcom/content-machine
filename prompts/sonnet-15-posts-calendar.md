# Phase S15 — Posts, calendar, post pack. Opus 5.5 med session. Lane 2, runs in parallel with the other S13–S19 phases.

Read ONLY: this file, `PLAN.md` §1 (items 39+), §2, §4, §6.S15, the phase table and §9 index,
and `docs/log/<dep>.md` for each phase in Depends on: O11. Do not read the archived plans.
Execute under the autonomy protocol §4. Build nothing outside the plan.

Owns (the only paths you may create or modify, plus the §4.9 exceptions):
`src/app/posts/**` (new), `src/app/calendar/**` (new), `src/components/{Post,Calendar}*.tsx` (new), `src/lib/posts.actions.ts` (new), `src/lib/i18n/dict/posts.ts`, `tests/integration/posts-ui.test.ts`, `docs/log/s15.md`

Lane 2 hard limits (§4.7): no schema, migration, auth, spend-cap or `src/lib/ai.ts` changes.
Data only through `src/lib/bridge/`, O10's `src/lib/storage/` + `src/lib/media/`, and O11's
`src/lib/posts/`. Blocked by a limit → workaround + a §10 line in your log, keep going.

Budget: one session, ≤ 90 min. When the exit criteria pass, open the PR that turn (§4.13).

Phase rules:
- Branch `phase/s15-posts-calendar` off latest main (or the harness's `claude/…` branch). WIP commit every 30 min.
- Skills: none beyond the design system.
- The post pack page is phone-first: big copy button, assets in order, works on a 375px screen.
- Calendar drag-to-reschedule is progressive: a date input fallback is enough if drag is fiddly.
- Status transitions go through O11's `setStatus`; never write `posts.status` directly.
- Re-runnable: check what exists first, continue from the first unmet exit criterion.
  Minor issues → `docs/log/s15.md`; stop only per §4.4.

Exit (§6.S15): create/attach/reorder/schedule/mark-posted integration tests; verify green; PR merged. Screenshots: CI artifact only.

## After this phase
Follow `prompts/_handoff.md`. Spawn S20 only if every other lane 2 PR is merged and S20 has not started (see `_handoff.md`).
