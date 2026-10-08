# Phase S12 — Script studio UI + Higgsfield hand-off. OPUS 5.5 session (effort medium, §1.37). Lane 2, parallel with S5, S6, S8, S10, S11.

Read ONLY: this file, `PLAN.md` §1 (esp. 32–34), §4, §6.S12, the phase table
and §9 index, `docs/log/o7.md`, `docs/log/o8.md`. Execute under §4.

Owns: `src/app/studio/**` (new), `src/components/Studio*.tsx` (new),
`src/lib/studio.actions.ts` (new), `src/lib/i18n/dict/scripts.ts`,
`.claude/commands/higgsfield-shots.md` (new), `docs/HIGGSFIELD.md` (new),
`tests/integration/studio-ui.test.ts`, `docs/log/s12.md`.

HARD LIMITS (§4.7): no schema, auth, spend-cap or `ai.ts` changes; use the
O8 routes and `bridge/scripts.ts` + `validateScriptBody` only. No nav edit.

Budget: one session, ≤ 90 min. Open the PR the turn the exit criteria pass.

Phase rules:
- Branch `phase/s12-script-studio` off latest main.
- Build exactly PLAN §6.S12 items 1–4. `/studio/new` reads `?brand=` and
  repeated `?ref=<videoId>` (from S10) and preselects them.
- Editor saves through `validateScriptBody`; show its errors inline, never
  save an invalid body.
- Teleprompter: spoken lines only, large type, adjustable speed and font
  size, space = pause, works full screen on a laptop; no extra libraries.
- Show a visible "verify before recording" badge on flagged sections.
- `.claude/commands/higgsfield-shots.md` per §6.S12 item 3: it must tell the
  session to call Higgsfield's `models_explore` recommend step before the
  first generation, batch independent shots, wait with `jobs_wait`, and
  write `media/<script-id>/manifest.json` (shot → file/url → prompt). Text
  only — no Higgsfield call happens in this phase.
- Copy in en + sv. Re-runnable; minor issues → log; stop only per §4.4.

Exit: create → edit → status → export integration test; teleprompter
renders; `npm run verify` green; PR merged; log + §9 line.

## After this phase
Follow `prompts/_handoff.md`. Spawn nothing.
