# Phase S17 — Clip fetch + transcript. Opus 5.5 low session. Lane 2, runs in parallel with the other S13–S19 phases.

Read ONLY: this file, `PLAN.md` §1 (items 39+), §2, §4, §1.44, §6.S17, the phase table and §9 index,
and `docs/log/<dep>.md` for each phase in Depends on: O11. Do not read the archived plans.
Execute under the autonomy protocol §4. Build nothing outside the plan.

Owns (the only paths you may create or modify, plus the §4.9 exceptions):
`src/lib/clips/fetch/**` (new), `scripts/clips-fetch.ts` (new), `src/app/clips/[id]/**` (new), `src/components/ClipMedia*.tsx` (new), `src/lib/clip-fetch.actions.ts` (new), `tests/integration/clip-fetch.test.ts`, `docs/log/s17.md`

Lane 2 hard limits (§4.7): no schema, migration, auth, spend-cap or `src/lib/ai.ts` changes.
Data only through `src/lib/bridge/`, O10's `src/lib/storage/` + `src/lib/media/`, and O11's
`src/lib/posts/`. Blocked by a limit → workaround + a §10 line in your log, keep going.

Budget: one session, ≤ 90 min. When the exit criteria pass, open the PR that turn (§4.13).

Phase rules:
- Branch `phase/s17-clip-fetch` off latest main (or the harness's `claude/…` branch). WIP commit every 30 min.
- Skills: none.
- yt-dlp and ffmpeg are external binaries: detect them, and fail the clip with a clear `error` when missing.
- Only clips with purpose `fact_check`/`competitor`, or an owner click, are fetched (§1.44).
- Tests use a fake yt-dlp script in `tests/` and the Gemini fake; no network.
- Re-runnable: check what exists first, continue from the first unmet exit criterion.
  Minor issues → `docs/log/s17.md`; stop only per §4.4.

Exit (§6.S17): fetch + transcribe integration test; verify green; PR merged. Screenshots: CI artifact only.

## After this phase
Follow `prompts/_handoff.md`. Spawn S20 only if every other lane 2 PR is merged and S20 has not started (see `_handoff.md`).
