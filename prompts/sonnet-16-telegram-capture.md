# Phase S16 — Telegram capture. Opus 5.5 low session. Lane 2, runs in parallel with the other S13–S19 phases.

Read ONLY: this file, `PLAN.md` §1 (items 39+), §2, §4, §1.43, §6.S16, the phase table and §9 index,
and `docs/log/<dep>.md` for each phase in Depends on: O11. Do not read the archived plans.
Execute under the autonomy protocol §4. Build nothing outside the plan.

Owns (the only paths you may create or modify, plus the §4.9 exceptions):
`workers/telegram-capture/**` (new, own `package.json`), `src/app/inbox/**`, `src/app/share/**`, `src/app/api/clips/route.ts`, `src/lib/clips/save.ts`, `src/components/{ClipRow,ClipFilters,QuickAddClipForm}.tsx`, `src/lib/clips.actions.ts`, `src/lib/i18n/dict/{inbox,capture}.ts`, `docs/CAPTURE.md`, `tests/integration/capture-ui.test.ts`, `docs/log/s16.md`

Lane 2 hard limits (§4.7): no schema, migration, auth, spend-cap or `src/lib/ai.ts` changes.
Data only through `src/lib/bridge/`, O10's `src/lib/storage/` + `src/lib/media/`, and O11's
`src/lib/posts/`. Blocked by a limit → workaround + a §10 line in your log, keep going.

Budget: one session, ≤ 90 min. When the exit criteria pass, open the PR that turn (§4.13).

Phase rules:
- Branch `phase/s16-telegram-capture` off latest main (or the harness's `claude/…` branch). WIP commit every 30 min.
- Skills: none; Cloudflare Workers + Wrangler docs if needed (WebFetch).
- The Worker imports `src/lib/clips/url.ts` and `src/lib/clips/telegram.ts` by relative path; O9 already excludes `workers/**` from the root typecheck, ESLint and Prettier; give the Worker its own `tsconfig.json` and a `test` script.
- Verify Telegram's `X-Telegram-Bot-Api-Secret-Token` with a constant-time compare; ignore chats not in the allowlist silently.
- The single SQL statement mirrors `saveClip()`'s upsert semantics (a re-save updates the note only).
- Re-runnable: check what exists first, continue from the first unmet exit criterion.
  Minor issues → `docs/log/s16.md`; stop only per §4.4.

Exit (§6.S16): Worker unit tests + inbox filter integration test; verify green; PR merged. Screenshots: CI artifact only.

## After this phase
Follow `prompts/_handoff.md`. Spawn S20 only if every other lane 2 PR is merged and S20 has not started (see `_handoff.md`).
