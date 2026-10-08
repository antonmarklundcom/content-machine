# Phase O13 — Publishing. Opus 5.5 med session. Lane 3 (gated on PLAN.md §7).

Read ONLY: this file, `PLAN.md` §1 (items 39+), §2, §4, §5.O13, the phase table and §9 index,
and `docs/log/<dep>.md` for each phase in Depends on: O12. Do not read the archived plans.
Execute under the autonomy protocol §4. Build nothing outside the plan.

Owns (the only paths you may create or modify, plus the §4.9 exceptions):
`src/lib/publish/**` (new), `scripts/publish-due.ts` (new), `src/app/api/cron/publish/**` (new), `src/components/PublishNow*.tsx` (new), `tests/integration/**`, `docs/log/o13.md`

Lane 3 hard limits (§4.7): no schema, migration, auth or spend-cap changes. The schema already
holds every column this phase needs (§2).

Budget: one session, ≤ 90 min. When the exit criteria pass, open the PR that turn (§4.13).

Phase rules:
- Branch `phase/o13-publishing` off latest main (or the harness's `claude/…` branch). WIP commit every 30 min.
- Skills: none.
- Publishing is an external, irreversible action: it happens only for posts in `scheduled` with a time in the past, or on an explicit owner click.
- Public copies come from `publishCopy()`; a post whose assets lack a public URL fails with a clear error.
- Use the lease (§1.19) so two runs never publish the same post.
- Re-runnable: check what exists first, continue from the first unmet exit criterion.
  Minor issues → `docs/log/o13.md`; stop only per §4.4.

Exit (§5.O13): fixture tests for each media type and failure path; verify green; PR merged; spawn O14. Screenshots: CI artifact only.

## After this phase
Follow `prompts/_handoff.md`. Next: spawn O14.
