# Phase S13 — Brands, families, accounts, kits. Opus 5.5 low session. Lane 2, runs in parallel with the other S13–S19 phases.

Read ONLY: this file, `PLAN.md` §1 (items 39+), §2, §4, §6.S13, the phase table and §9 index,
and `docs/log/<dep>.md` for each phase in Depends on: O11. Do not read the archived plans.
Execute under the autonomy protocol §4. Build nothing outside the plan.

Owns (the only paths you may create or modify, plus the §4.9 exceptions):
`src/app/brands/**` (new), `src/app/accounts/**` (new), `src/app/brand/[id]/kit/**` (new), `src/app/families/**` (new), `src/components/{Account,Family,Kit}*.tsx` (new), `src/lib/accounts.actions.ts` (new), `src/lib/i18n/dict/accounts.ts`, `tests/integration/accounts-ui.test.ts`, `docs/log/s13.md`

Lane 2 hard limits (§4.7): no schema, migration, auth, spend-cap or `src/lib/ai.ts` changes.
Data only through `src/lib/bridge/`, O10's `src/lib/storage/` + `src/lib/media/`, and O11's
`src/lib/posts/`. Blocked by a limit → workaround + a §10 line in your log, keep going.

Budget: one session, ≤ 90 min. When the exit criteria pass, open the PR that turn (§4.13).

Phase rules:
- Branch `phase/s13-brands-accounts` off latest main (or the harness's `claude/…` branch). WIP commit every 30 min.
- Skills: none beyond the repo's design system (`src/components`, Tailwind tokens).
- `/brands` is new; the existing `/brand/[id]` page stays as it is (S20 links them).
- Brand id is the slug and is immutable after create (other tables point at it).
- Kit colours: validate hex, show swatches; logo is picked from assets (bridge), not uploaded here.
- Re-runnable: check what exists first, continue from the first unmet exit criterion.
  Minor issues → `docs/log/s13.md`; stop only per §4.4.

Exit (§6.S13): brand + family + account + kit created in an integration test; verify green; PR merged. Screenshots: CI artifact only.

## After this phase
Follow `prompts/_handoff.md`. Spawn S20 only if every other lane 2 PR is merged and S20 has not started (see `_handoff.md`).
