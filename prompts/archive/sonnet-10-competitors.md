# Phase S10 — Competitor research. OPUS 5.5 session (effort low, §1.37). Lane 2, parallel with S5, S6, S8, S11, S12.

Read ONLY: this file, `PLAN.md` §1, §4, §6.S10, the phase table and §9
index, `docs/log/o7.md`, `docs/log/o8.md`. Execute under §4.

Owns: `src/app/research/**` (new), `src/components/Research*.tsx` (new),
`src/lib/research.actions.ts` (new), `src/lib/i18n/dict/research.ts`,
`tests/integration/research-ui.test.ts`, `docs/log/s10.md`.

HARD LIMITS (§4.7): no schema, auth, spend-cap, pipeline or `ai.ts` changes.
Data only through `src/lib/bridge/research.ts` and existing actions (source
add, analyse). No nav edit — S9 adds the link. Use the S5 tokens if on main,
otherwise the existing `surface-card` classes.

Budget: one session, ≤ 90 min. Open the PR the turn the exit criteria pass.

Phase rules:
- Branch `phase/s10-competitors` off latest main.
- Build exactly PLAN §6.S10 items 1–4. Brand picker via `?brand=` so links
  are shareable. Server components for lists; client islands only for the
  add-channel form and role toggle.
- "Use as reference" links to `/studio/new?brand=<id>&ref=<videoId>` — S12
  reads that; do not import anything from S12.
- Empty states say what to do next ("Paste a competitor's channel URL").
- Copy in en + sv via `dict/research.ts`.
- Re-runnable; minor issues → `docs/log/s10.md`; stop only per §4.4.

Exit: actions integration test (link, unlink, role toggle); `/research`
renders with seeded data; one screenshot pass (CI artifact); `npm run
verify` green; PR merged; log + §9 line.

## After this phase
Follow `prompts/_handoff.md`. Spawn nothing.
