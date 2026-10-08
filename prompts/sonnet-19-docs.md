# Phase S19 — Docs + local setup. Opus 5.5 low session. Lane 2, runs in parallel with the other S13–S19 phases.

Read ONLY: this file, `PLAN.md` §1 (items 39+), §2, §4, §6.S19, the phase table and §9 index,
and `docs/log/<dep>.md` for each phase in Depends on: O11. Do not read the archived plans.
Execute under the autonomy protocol §4. Build nothing outside the plan.

Owns (the only paths you may create or modify, plus the §4.9 exceptions):
`README.md`, `docs/LOCAL-SETUP.md`, `docs/STORAGE.md` (new), `docs/SOCIAL-OS.md` (new), `setup.ps1`, `.env.example` (comments only), `docs/log/s19.md`

Lane 2 hard limits (§4.7): no schema, migration, auth, spend-cap or `src/lib/ai.ts` changes.
Data only through `src/lib/bridge/`, O10's `src/lib/storage/` + `src/lib/media/`, and O11's
`src/lib/posts/`. Blocked by a limit → workaround + a §10 line in your log, keep going.

Budget: one session, ≤ 90 min. When the exit criteria pass, open the PR that turn (§4.13).

Phase rules:
- Branch `phase/s19-docs` off latest main (or the harness's `claude/…` branch). WIP commit every 30 min.
- Skills: `nextjs-deploy-hostinger` (§4 PowerShell pitfalls) for the setup docs.
- Write for Anton on Windows, one command per step.
- Only reference commands and env vars that exist on main when you open the PR; others are marked 'arrives with <phase>'.
- Keep `setup.ps1`'s existing winget fallback behaviour.
- Re-runnable: check what exists first, continue from the first unmet exit criterion.
  Minor issues → `docs/log/s19.md`; stop only per §4.4.

Exit (§6.S19): docs consistent with main; verify green; PR merged. Screenshots: CI artifact only.

## After this phase
Follow `prompts/_handoff.md`. Spawn S20 only if every other lane 2 PR is merged and S20 has not started (see `_handoff.md`).
