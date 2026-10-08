# Phase O12 — Meta connect + insights. Opus 5.5 med session. Lane 3 (gated on PLAN.md §7).

Read ONLY: this file, `PLAN.md` §1 (items 39+), §2, §4, §5.O12, the phase table and §9 index,
and `docs/log/<dep>.md` for each phase in Depends on: S20. Do not read the archived plans.
Execute under the autonomy protocol §4. Build nothing outside the plan.

Owns (the only paths you may create or modify, plus the §4.9 exceptions):
`src/lib/meta/**` (new), `src/lib/crypto.ts` (new), `src/app/api/meta/**` (new), `src/app/settings/**` (Meta section), `scripts/meta-sync.ts` (new), `src/lib/posts/what-worked.ts` (new), `src/lib/ai.ts` (prompt input only), `tests/integration/**`, `docs/log/o12.md`

Lane 3 hard limits (§4.7): no schema, migration, auth or spend-cap changes. The schema already
holds every column this phase needs (§2).

Budget: one session, ≤ 90 min. When the exit criteria pass, open the PR that turn (§4.13).

Phase rules:
- Branch `phase/o12-meta-insights` off latest main (or the harness's `claude/…` branch). WIP commit every 30 min.
- Skills: `claude-api` not needed. Meta Graph API docs via WebFetch; record fixtures, never call Meta in tests.
- Tokens are stored only encrypted (§1.50); never log them.
- Insights metrics differ per media type (reel vs image vs carousel): map them into `post_metrics` columns and keep the full response in `raw`.
- If §7 item 7 is not done, build against fixtures and mark the live path UNVERIFIED in the log.
- Re-runnable: check what exists first, continue from the first unmet exit criterion.
  Minor issues → `docs/log/o12.md`; stop only per §4.4.

Exit (§5.O12): fixture tests; verify green; PR merged; spawn O13 and S21. Screenshots: CI artifact only.

## After this phase
Follow `prompts/_handoff.md`. Next: spawn O13 and S21.
