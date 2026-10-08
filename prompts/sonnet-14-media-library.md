# Phase S14 — Media library + Higgsfield commands. Opus 5.5 med session. Lane 2, runs in parallel with the other S13–S19 phases.

Read ONLY: this file, `PLAN.md` §1 (items 39+), §2, §4, §6.S14, the phase table and §9 index,
and `docs/log/<dep>.md` for each phase in Depends on: O11. Do not read the archived plans.
Execute under the autonomy protocol §4. Build nothing outside the plan.

Owns (the only paths you may create or modify, plus the §4.9 exceptions):
`src/app/media/**` (new), `src/components/Media*.tsx` (new), `src/lib/media.actions.ts` (new), `src/lib/i18n/dict/media.ts`, `.claude/commands/higgsfield-post.md` (new), `.claude/commands/higgsfield-import.md` (new), `docs/HIGGSFIELD.md`, `tests/integration/media-ui.test.ts`, `docs/log/s14.md`

Lane 2 hard limits (§4.7): no schema, migration, auth, spend-cap or `src/lib/ai.ts` changes.
Data only through `src/lib/bridge/`, O10's `src/lib/storage/` + `src/lib/media/`, and O11's
`src/lib/posts/`. Blocked by a limit → workaround + a §10 line in your log, keep going.

Budget: one session, ≤ 90 min. When the exit criteria pass, open the PR that turn (§4.13).

Phase rules:
- Branch `phase/s14-media-library` off latest main (or the harness's `claude/…` branch). WIP commit every 30 min.
- Skills: read `.claude/commands/higgsfield-shots.md` and `docs/HIGGSFIELD.md` (build 2) and extend their conventions.
- Thumbnails come from O10's `thumb_path`; never load full-size files in the grid.
- The unsorted inbox is where `higgsfield-import` lands: assigning brand/account moves the file into the §1.41 layout via the storage module.
- The commands state clearly they run in Claude Code on the PC (they write to `MEDIA_ROOT`), and always `models_explore` recommend before generating.
- Re-runnable: check what exists first, continue from the first unmet exit criterion.
  Minor issues → `docs/log/s14.md`; stop only per §4.4.

Exit (§6.S14): filter + bulk-action integration tests; verify green; PR merged. Screenshots: CI artifact only.

## After this phase
Follow `prompts/_handoff.md`. Spawn S20 only if every other lane 2 PR is merged and S20 has not started (see `_handoff.md`).
