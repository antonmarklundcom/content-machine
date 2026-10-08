# Phase O4 — Verification foundation. OPUS 5.5 session (effort medium, §1.37). Lane 1.

Read ONLY: this file, `PLAN.md` §1, §4, §5.O4, the phase table and §9 index.
Do not read `docs/PLAN-v1-build1.md` or the archived prompts. Execute under
the autonomy protocol §4. Build nothing outside the plan.

Owns (the only paths you may create or modify, plus the §4.9 exceptions):
- `src/db/index.ts`, `src/db/migrate.ts`, `src/db/seed.ts`, `drizzle.config.ts`
- `package.json`, `package-lock.json`, `.env.example`
- `.github/**`, `tests/**` (new), `docs/log/o4.md`
- `README.md`: one paragraph under Setup about `pg` locally / `vercel-build`.

Budget: one session, ≤ 90 min. When the exit criteria pass, open the PR that
turn (§4.13).

Phase rules:
- Branch `phase/o4-verify-foundation` off latest main (or the harness-pinned
  branch; note it in the log).
- Load the `claude-api` skill only if you touch `src/lib/ai.ts` — you should
  not. Load `nextjs-deploy-hostinger`? No — home is Vercel.
- The session has `postgresql-16` installed. Start it, create a database,
  export `DATABASE_URL=postgres://…localhost…`, and use it for `test:db`.
  Production stays on Neon HTTP: prove with a unit test on the driver
  chooser that `*.neon.tech` picks neon and `localhost` picks `pg`.
- `drizzle-orm` 0.38 ships `drizzle-orm/node-postgres`; add `pg` and
  `@types/pg`. Do not upgrade drizzle or Next in this phase.
- Integration tests use `node:test` + `tsx`, same as the unit tests, in
  `tests/integration/*.test.ts`, run by `npm run test:db`. A shared
  `setup.ts` migrates once and truncates tables between files. ≥ 12 tests
  covering spend (record/reserve/cap/release), clips save (upsert, note
  coalesce, created flag), promote verbatim, bridge reads, seed idempotence.
  Nothing that calls Gemini — that is O5.
- CI: `.github/workflows/ci.yml` — Node 22, `postgres:16` service,
  `npm ci`, typecheck, test, db:migrate, test:db, build. Placeholder env for
  build (`SESSION_SECRET` 64 chars, `DATABASE_URL` to the service). Add a
  `screenshots` job scaffold (Playwright, `tests/screenshots.mjs`, uploads
  `docs/screenshots/` as an artifact; page list can be `/youtube/login` for
  now — S5 fills it). `docs/screenshots/` is already git-ignored.
- Scripts: `verify` = `typecheck && test && test:db && build`;
  `vercel-build` = `db:migrate && db:seed && next build`.
- Re-runnable; minor issues → `docs/log/o4.md`; stop only per §4.4.

Exit: CI green on the PR with `test:db` running ≥ 12 integration tests in
the service container; `npm run verify` green locally; `vercel-build`
script present; driver chooser unit-tested; PR merged; `docs/log/o4.md`
written; §9 index line added.

## After this phase
Follow `prompts/_handoff.md`. Next: `prompts/opus-5-gemini-double-smoke.md`,
model `claude-opus-5-5`.
